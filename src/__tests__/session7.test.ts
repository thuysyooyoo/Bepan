import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  LocalDexieAdapter,
  PermissionDeniedError,
  SmartDataRepository,
  SupabaseAdapter,
} from '../db';
import {
  SEED_BOOKS,
  SEED_CATEGORIES,
  SEED_MEAL_PRICES,
  SEED_SUPPLIERS,
  SEED_WALLETS,
  SEED_WORKERS,
} from '../db/seed';
import {
  derivePinAuthSecret,
  normalizeAttendanceRow,
  normalizeTransactionRow,
  virtualEmailForProfile,
} from '../db/supabaseAdapter';
import { computeDailyReport, computeWalletBalances } from '../domain/accounting';

/**
 * Bộ mô phỏng Supabase PostgreSQL + GoTrue Auth + Row Level Security (RLS) + Realtime
 * bám sát 100% chính sách trong supabase/migrations/001_initial_schema.sql.
 */
function createMockRlsSupabase(options?: { schemaReady?: boolean }) {
  let schemaReady = options?.schemaReady ?? true;
  let currentAuthUser: { id: string; email: string } | null = null;

  const authUsers = new Map<string, { id: string; email: string; secret: string }>([
    ['bo@sobep.local', { id: 'uid-bo', email: 'bo@sobep.local', secret: 'SoBep#bo#PIN#1111' }],
    ['me@sobep.local', { id: 'uid-me', email: 'me@sobep.local', secret: 'SoBep#me#PIN#2222' }],
    [
      'admin@sobep.local',
      { id: 'uid-admin', email: 'admin@sobep.local', secret: 'SoBep#admin#PIN#9999' },
    ],
  ]);

  const tables: Record<string, Array<Record<string, unknown>>> = {
    books: structuredClone(SEED_BOOKS) as unknown as Array<Record<string, unknown>>,
    profiles: [
      {
        id: 'bo',
        auth_user_id: 'uid-bo',
        ten_hien_thi: 'Bố — Hiệp Hòa',
        xung_ho: 'Bố',
        mo_ta: 'Sổ Bếp & Căn tin Hiệp Hòa',
        vai_tro: 'owner',
        book_id: 'hiep_hoa',
        virtual_email: 'bo@sobep.local',
        avatar_emoji: '',
      },
      {
        id: 'me',
        auth_user_id: 'uid-me',
        ten_hien_thi: 'Mẹ — Tiên Du',
        xung_ho: 'Mẹ',
        mo_ta: 'Sổ Bếp & Căn tin Tiên Du',
        vai_tro: 'owner',
        book_id: 'tien_du',
        virtual_email: 'me@sobep.local',
        avatar_emoji: '',
      },
      {
        id: 'admin',
        auth_user_id: 'uid-admin',
        ten_hien_thi: 'Quản lý (Con)',
        xung_ho: 'Admin',
        mo_ta: 'Xem cả Hiệp Hòa, Tiên Du & Tổng hợp',
        vai_tro: 'admin',
        book_id: null,
        virtual_email: 'admin@sobep.local',
        avatar_emoji: '',
      },
    ],
    wallets: structuredClone(SEED_WALLETS) as unknown as Array<Record<string, unknown>>,
    meal_prices: structuredClone(SEED_MEAL_PRICES) as unknown as Array<Record<string, unknown>>,
    categories: structuredClone(SEED_CATEGORIES) as unknown as Array<Record<string, unknown>>,
    workers: structuredClone(SEED_WORKERS) as unknown as Array<Record<string, unknown>>,
    suppliers: structuredClone(SEED_SUPPLIERS) as unknown as Array<Record<string, unknown>>,
    meal_counts: [],
    attendance: [],
    transactions: [],
    reminders: [],
    chat_logs: [],
  };

  const realtimeListeners: Array<{
    channelName: string;
    filter?: string;
    table?: string;
    callback: () => void;
  }> = [];

  const getCallerProfile = () => {
    if (!currentAuthUser) return null;
    return tables.profiles.find((p) => p.auth_user_id === currentAuthUser?.id) ?? null;
  };

  const canAccessBook = (bookId: unknown): boolean => {
    const prof = getCallerProfile();
    if (!prof) return false;
    if (prof.vai_tro === 'admin') return true;
    return prof.book_id === bookId;
  };

  const isRowReadable = (table: string, row: Record<string, unknown>): boolean => {
    const prof = getCallerProfile();
    if (!prof) return false; // Chặn tuyệt đối 'anon'!
    if (table === 'categories') return true;
    if (table === 'profiles') {
      return prof.vai_tro === 'admin' || row.auth_user_id === prof.auth_user_id;
    }
    if (table === 'books') {
      return canAccessBook(row.id);
    }
    return canAccessBook(row.book_id);
  };

  const assertRowWritable = (table: string, row: Record<string, unknown>) => {
    const prof = getCallerProfile();
    if (!prof) {
      return { code: '42501', message: 'new row violates row-level security policy (anon)' };
    }
    if (table === 'categories' || table === 'profiles') {
      if (prof.vai_tro !== 'admin') {
        return { code: '42501', message: 'new row violates row-level security policy (admin only)' };
      }
      return null;
    }
    const targetBook = table === 'books' ? row.id : row.book_id;
    if (!canAccessBook(targetBook)) {
      return {
        code: '42501',
        message: `new row violates row-level security policy for table "${table}"`,
      };
    }
    return null;
  };

  const buildQueryBuilder = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payloadData: Array<Record<string, unknown>> = [];
    let patchData: Record<string, unknown> = {};
    let conflictCols: string[] = ['id'];
    const eqFilters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;
    let modeSingle: 'none' | 'single' | 'maybeSingle' = 'none';

    const matchesFilters = (r: Record<string, unknown>) => {
      for (const [k, v] of eqFilters) {
        if (r[k] !== v) return false;
      }
      for (const [k, arr] of inFilters) {
        if (!arr.includes(r[k])) return false;
      }
      return true;
    };

    const execute = async () => {
      if (!schemaReady) {
        return {
          data: null,
          error: { code: 'PGRST205', message: `Could not find the table 'public.${table}'` },
        };
      }

      const store = tables[table];
      if (!store) {
        return { data: null, error: { code: 'PGRST205', message: `Unknown table ${table}` } };
      }

      if (op === 'insert' || op === 'upsert') {
        const savedRows: Array<Record<string, unknown>> = [];
        for (const item of payloadData) {
          const rlsErr = assertRowWritable(table, item);
          if (rlsErr) return { data: null, error: rlsErr };

          if (op === 'upsert') {
            const existingIdx = store.findIndex((existing) =>
              conflictCols.every((c) => existing[c] === item[c])
            );
            if (existingIdx >= 0) {
              const merged = {
                ...store[existingIdx],
                ...item,
                id: store[existingIdx].id ?? item.id,
              };
              store[existingIdx] = merged;
              savedRows.push(merged);
              continue;
            }
          }
          store.push({ ...item });
          savedRows.push({ ...item });
        }

        // Giả lập PostgreSQL trả BIGINT/NUMERIC dạng string như PostgREST thật
        const serialized = savedRows.map((r) => ({
          ...r,
          ...(r.so_tien !== undefined ? { so_tien: String(r.so_tien) } : {}),
          ...(r.don_gia !== undefined ? { don_gia: String(r.don_gia) } : {}),
        }));

        if (modeSingle === 'single' || modeSingle === 'maybeSingle') {
          return { data: serialized[0] ?? null, error: null };
        }
        return { data: serialized, error: null };
      }

      if (op === 'update') {
        const updated: Array<Record<string, unknown>> = [];
        for (let i = 0; i < store.length; i++) {
          const r = store[i];
          if (!matchesFilters(r) || !isRowReadable(table, r)) continue;
          const candidate = { ...r, ...patchData };
          const rlsErr = assertRowWritable(table, candidate);
          if (rlsErr) return { data: null, error: rlsErr };
          store[i] = candidate;
          updated.push(candidate);
        }
        if (modeSingle === 'single') {
          if (updated.length === 0) {
            return { data: null, error: { code: 'PGRST116', message: '0 rows updated' } };
          }
          return { data: updated[0], error: null };
        }
        return { data: updated, error: null };
      }

      // SELECT
      let rows = store.filter((r) => isRowReadable(table, r) && matchesFilters(r));
      if (orderCol) {
        const col = orderCol;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitCount !== null) {
        rows = rows.slice(0, limitCount);
      }

      if (modeSingle === 'single') {
        if (rows.length === 0) {
          return {
            data: null,
            error: { code: '42501', message: 'permission denied or row not found under RLS' },
          };
        }
        return { data: rows[0], error: null };
      }
      if (modeSingle === 'maybeSingle') {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const builder = {
      select: () => builder,
      insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
        op = 'insert';
        payloadData = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      upsert: (
        payload: Record<string, unknown> | Array<Record<string, unknown>>,
        opts?: { onConflict?: string }
      ) => {
        op = 'upsert';
        payloadData = Array.isArray(payload) ? payload : [payload];
        conflictCols = opts?.onConflict
          ? opts.onConflict.split(',').map((s) => s.trim())
          : ['id'];
        return builder;
      },
      update: (patch: Record<string, unknown>) => {
        op = 'update';
        patchData = patch;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        eqFilters.push([col, val]);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        inFilters.push([col, vals]);
        return builder;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return builder;
      },
      limit: (n: number) => {
        limitCount = n;
        return builder;
      },
      single: () => {
        modeSingle = 'single';
        return execute();
      },
      maybeSingle: () => {
        modeSingle = 'maybeSingle';
        return execute();
      },
      then: (
        onFulfilled?: (val: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => execute().then(onFulfilled, onRejected),
    };

    return builder;
  };

  const client = {
    auth: {
      async signInWithPassword({
        email,
        password,
      }: {
        email: string;
        password: string;
      }) {
        const u = authUsers.get(email.toLowerCase());
        if (!u || u.secret !== password) {
          return {
            data: { user: null, session: null },
            error: { message: 'Invalid login credentials' },
          };
        }
        currentAuthUser = { id: u.id, email: u.email };
        return {
          data: {
            user: { id: u.id, email: u.email },
            session: { access_token: `jwt-${u.id}`, user: { id: u.id, email: u.email } },
          },
          error: null,
        };
      },
      async getSession() {
        return {
          data: {
            session: currentAuthUser
              ? { access_token: `jwt-${currentAuthUser.id}`, user: currentAuthUser }
              : null,
          },
          error: null,
        };
      },
      async signOut() {
        currentAuthUser = null;
        return { error: null };
      },
    },
    async rpc(fnName: string, params?: Record<string, unknown>) {
      if (!schemaReady) {
        return {
          data: null,
          error: { code: 'PGRST202', message: `Could not find function public.${fnName}` },
        };
      }
      if (fnName === 'get_public_login_profiles') {
        return {
          data: tables.profiles.map((p) => ({
            id: p.id,
            ten_hien_thi: p.ten_hien_thi,
            xung_ho: p.xung_ho,
            mo_ta: p.mo_ta,
            vai_tro: p.vai_tro,
            book_id: p.book_id,
            avatar_emoji: p.avatar_emoji,
          })),
          error: null,
        };
      }
      if (fnName === 'change_user_pin') {
        const caller = getCallerProfile();
        if (!caller) {
          return { data: null, error: { code: '42501', message: 'permission denied for anon' } };
        }
        const targetId = String(params?.p_target_profile_id ?? '');
        const newSecret = String(params?.p_new_secret ?? '');
        if (caller.vai_tro !== 'admin' && caller.id !== targetId) {
          return { data: null, error: { code: '42501', message: 'permission denied' } };
        }
        const targetProf = tables.profiles.find((p) => p.id === targetId);
        if (!targetProf) {
          return { data: null, error: { message: 'Profile not found' } };
        }
        const u = authUsers.get(String(targetProf.virtual_email));
        if (u) u.secret = newSecret;
        return { data: true, error: null };
      }
      return { data: null, error: { message: `Unknown RPC ${fnName}` } };
    },
    from: (table: string) => buildQueryBuilder(table),
    channel: (name: string) => {
      const ch = {
        on: (
          _type: string,
          opts: { filter?: string; table?: string },
          cb: () => void
        ) => {
          realtimeListeners.push({
            channelName: name,
            filter: opts.filter,
            table: opts.table,
            callback: cb,
          });
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: async (ch: unknown) => {
      void ch;
      realtimeListeners.length = 0;
      return 'ok';
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    tables,
    setSchemaReady: (ready: boolean) => {
      schemaReady = ready;
    },
    setAnon: () => {
      currentAuthUser = null;
    },
    emitRealtimeForBook: (bookId: string, table = 'transactions') => {
      for (const l of realtimeListeners) {
        if (l.table && l.table !== table) continue;
        if (l.filter && !l.filter.includes(bookId)) continue;
        l.callback();
      }
    },
  };
}

describe('Phiên 7 — Đưa lên mạng: Supabase RLS, Virtual Email PIN Auth, Đồng bộ Realtime & Security Hardening', () => {
  it('1. Kiểm toán file cấu hình bảo mật (_headers, netlify.toml, 001_initial_schema.sql) đạt chuẩn 100%', () => {
    const root = process.cwd();
    const headersText = fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8');
    expect(headersText).toContain('X-Frame-Options: DENY');
    expect(headersText).toContain('X-Content-Type-Options: nosniff');
    expect(headersText).toContain('Strict-Transport-Security:');
    expect(headersText).toContain('https://*.supabase.co wss://*.supabase.co');
    // Bắt buộc mở microphone=(self) để Bố Mẹ bấm mic nói trên Chrome Android, khóa camera/geolocation
    expect(headersText).toContain('microphone=(self)');
    expect(headersText).toContain('camera=()');

    const netlifyToml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
    expect(netlifyToml).toContain('from = "/api/*"');
    expect(netlifyToml).toContain('to = "/.netlify/functions/:splat"');

    const sqlText = fs.readFileSync(
      path.join(root, 'supabase', 'migrations', '001_initial_schema.sql'),
      'utf8'
    );
    expect(sqlText).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sqlText).toContain('security_invoker = true');
    expect(sqlText).toContain('supabase_realtime');
    expect(sqlText).toContain(derivePinAuthSecret('bo', '1111'));
    expect(sqlText).toContain(derivePinAuthSecret('me', '2222'));
    expect(sqlText).toContain(derivePinAuthSecret('admin', '9999'));
    expect(virtualEmailForProfile('bo')).toBe('bo@sobep.local');

    // Kiểm tra chuẩn hóa BIGINT / NUMERIC string từ PostgreSQL sang số học JS an toàn
    const tx = normalizeTransactionRow({
      id: 'tx-1',
      book_id: 'hiep_hoa',
      ngay: '2026-10-05',
      timestamp: '2026-10-05T10:00:00Z',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: '3250000',
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua thịt bò',
      nguon: 'tay',
      nguoi_tao: 'bo',
      da_xoa: false,
    });
    expect(tx.so_tien).toBe(3_250_000);
    expect(typeof tx.so_tien).toBe('number');

    const att = normalizeAttendanceRow({
      id: 'att-1',
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-05',
      so_cong: '0.5',
      don_gia_cong: '250000',
    });
    expect(att.so_cong).toBe(0.5);
    expect(att.don_gia_cong).toBe(250_000);
  });

  it('2. Kiểm tra bảo mật RLS & Phân quyền: Chặn anon 100%, Bố không đọc/ghi được sổ Mẹ, Admin giám sát cả 2 sổ & đổi PIN', async () => {
    const mockCloud = createMockRlsSupabase({ schemaReady: true });
    const adapter = new SupabaseAdapter({
      supabaseUrl: 'https://grqlnqycxxadedqlppyl.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
      client: mockCloud.client,
    });

    // A) Khi chưa đăng nhập (anon): truy vấn trực tiếp bảng dữ liệu bị RLS trả về rỗng []
    mockCloud.setAnon();
    const anonBooksRes = await mockCloud.client.from('books').select('*');
    expect(anonBooksRes.data).toEqual([]);
    const anonTxRes = await mockCloud.client.from('transactions').select('*');
    expect(anonTxRes.data).toEqual([]);

    // Nhưng màn hình chọn thẻ Bố / Mẹ / Admin vẫn lấy được 3 thẻ hiển thị an toàn (0 lộ hash/email)
    const loginCards = await adapter.listLoginProfiles();
    expect(loginCards).toHaveLength(3);
    expect(loginCards.map((c) => c.id)).toEqual(['bo', 'me', 'admin']);

    // Nhập sai mã PIN bị từ chối rõ ràng
    await expect(adapter.loginWithPin('bo', '0000')).rejects.toThrow(/Mã PIN chưa đúng/);

    // B) Bố đăng nhập bằng mã PIN 1111 -> Chỉ thấy Sổ Hiệp Hòa, bị chặn tuyệt đối Sổ Tiên Du
    const boSession = await adapter.loginWithPin('bo', '1111');
    expect(boSession.book_id).toBe('hiep_hoa');
    expect(await adapter.hasValidAuthSession(boSession)).toBe(true);

    const boBooks = await adapter.listAccessibleBooks(boSession);
    expect(boBooks.map((b) => b.id)).toEqual(['hiep_hoa']);

    await expect(adapter.getBookSnapshot(boSession, 'tien_du')).rejects.toThrow(
      PermissionDeniedError
    );

    // Kể cả cố tình giả mạo session ở phía trình duyệt để gọi thẳng lên Supabase cho 'tien_du' -> RLS chặn!
    const forgedSession = { ...boSession, book_id: 'tien_du' as const };
    await expect(adapter.getBookSnapshot(forgedSession, 'tien_du')).rejects.toThrow(
      PermissionDeniedError
    );
    await expect(
      adapter.addTransaction(forgedSession, {
        book_id: 'tien_du',
        ngay: '2026-10-10',
        mang: 'bep_an',
        loai: 'chi',
        category_id: 'cat_thit',
        so_tien: 500_000,
        wallet_id: 'td_tien_mat',
        ghi_chu: 'Giả mạo ghi sang Tiên Du',
        nguon: 'tay',
        nguoi_tao: 'bo',
      })
    ).rejects.toThrow(PermissionDeniedError);

    // Bố dùng nhầm ví của Tiên Du trên Sổ Hiệp Hòa cũng bị chặn
    await expect(
      adapter.addTransaction(boSession, {
        book_id: 'hiep_hoa',
        ngay: '2026-10-10',
        mang: 'bep_an',
        loai: 'chi',
        category_id: 'cat_thit',
        so_tien: 500_000,
        wallet_id: 'td_tien_mat',
        ghi_chu: 'Nhầm ví',
        nguon: 'tay',
        nguoi_tao: 'bo',
      })
    ).rejects.toThrow(PermissionDeniedError);

    // C) Mẹ đăng nhập PIN 2222 -> Chỉ thấy Sổ Tiên Du, bị chặn Sổ Hiệp Hòa
    const meSession = await adapter.loginWithPin('me', '2222');
    const meBooks = await adapter.listAccessibleBooks(meSession);
    expect(meBooks.map((b) => b.id)).toEqual(['tien_du']);
    await expect(adapter.getBookSnapshot(meSession, 'hiep_hoa')).rejects.toThrow(
      PermissionDeniedError
    );

    // D) Admin đăng nhập PIN 9999 -> Đọc được cả Hiệp Hòa & Tiên Du, đổi được PIN cho Bố
    const adminSession = await adapter.loginWithPin('admin', '9999');
    const adminBooks = await adapter.listAccessibleBooks(adminSession);
    expect(adminBooks.map((b) => b.id)).toEqual(['hiep_hoa', 'tien_du']);

    await adapter.changePin(adminSession, 'bo', '4567');
    await expect(adapter.loginWithPin('bo', '1111')).rejects.toThrow(/Mã PIN chưa đúng/);
    const boNewSession = await adapter.loginWithPin('bo', '4567');
    expect(boNewSession.profile_id).toBe('bo');
  });

  it('3. SmartDataRepository tự chuyển Local -> Cloud, đẩy dữ liệu thử từ máy lên Supabase không trùng & đồng bộ Realtime 2 chiều', async () => {
    const localAdapter = new LocalDexieAdapter(`TestDB_S7_LocalToCloud_${Date.now()}`);
    const mockCloud = createMockRlsSupabase({ schemaReady: false });
    const cloudAdapter = new SupabaseAdapter({
      supabaseUrl: 'https://grqlnqycxxadedqlppyl.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
      client: mockCloud.client,
      localMirrorDb: localAdapter.getDexieInstance(),
    });

    const smartRepo = new SmartDataRepository({
      mode: 'auto',
      localAdapter,
      cloudAdapter,
    });

    // Giai đoạn 1: Chưa chạy SQL trên Supabase -> SmartRepo tự động chạy êm trên Local IndexedDB
    await smartRepo.ensureInitialized();
    expect(smartRepo.mode).toBe('local');

    const boLocal = await smartRepo.loginWithPin('bo', '1111');
    await smartRepo.upsertMealCount(boLocal, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-12',
      bua: 'trua',
      suat_truong: 220,
      suat_vang_lai: 5,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await smartRepo.addTransaction(boLocal, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-12',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 2_100_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua thịt lợn tại máy trước khi lên mây',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await smartRepo.saveDailyCollection(boLocal, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-12',
      tien_mat: 1_400_000,
      chuyen_khoan: 500_000,
      nguon: 'tay',
    });

    // Giai đoạn 2: Người dùng chạy xong 001_initial_schema.sql trên Supabase -> tự kích hoạt Cloud!
    mockCloud.setSchemaReady(true);
    const status = await smartRepo.getCloudSyncStatus(true);
    expect(status.connected).toBe(true);
    expect(smartRepo.mode).toBe('supabase');

    // Đăng nhập lấy JWT Supabase & đẩy toàn bộ dữ liệu thử trên máy lên Supabase
    const boCloud = await smartRepo.loginWithPin('bo', '1111');
    const sync1 = await smartRepo.syncLocalBookToCloud(boCloud, 'hiep_hoa');
    expect(sync1.pushedCounts.meal_counts).toBe(1);
    expect(sync1.pushedCounts.transactions).toBe(3);

    // Bấm đẩy lần 2 liên tiếp: Idempotent 100%, tuyệt đối KHÔNG nhân đôi giao dịch hay suất ăn!
    await smartRepo.syncLocalBookToCloud(boCloud, 'hiep_hoa');

    const cloudSnap = await smartRepo.getBookSnapshot(boCloud, 'hiep_hoa');
    expect(cloudSnap.mealCounts).toHaveLength(1);
    expect(cloudSnap.transactions).toHaveLength(3);

    // Số liệu Lãi ngày & Số dư 3 ví trên Đám mây khớp 100% với trên máy!
    const daily = computeDailyReport(cloudSnap, '2026-10-12');
    // 220 x 25k (5.5tr) + 5 x 30k (150k) - 2.1tr = 3.550.000đ
    expect(daily.bep_an.lai_uoc_tinh_ngay).toBe(3_550_000);
    // Căn tin: (1.4tr + 500k) - 150k vãng lai = 1.750.000đ
    expect(daily.can_tin.doanh_thu_can_tin).toBe(1_750_000);

    const walletBals = computeWalletBalances(
      cloudSnap.wallets,
      cloudSnap.transactions,
      'hiep_hoa'
    );
    const tmBal = walletBals.find((w) => w.wallet.id === 'hh_tien_mat')!.so_du_hien_tai;
    // 0 đầu kỳ + 1.4tr thu TM - 2.1tr chi chợ = -700.000
    expect(tmBal).toBe(-700_000);

    // Giai đoạn 3: Kiểm tra kênh Đồng bộ Realtime 2 chiều (postgres_changes)
    vi.useFakeTimers();
    try {
      const onRemoteChanged = vi.fn();
      const unsubscribe = smartRepo.subscribeToBookChanges('hiep_hoa', onRemoteChanged);

      mockCloud.emitRealtimeForBook('hiep_hoa');
      vi.advanceTimersByTime(300);
      expect(onRemoteChanged).toHaveBeenCalledTimes(1);

      // Thay đổi ở Sổ Tiên Du KHÔNG kích hoạt nhầm kênh của Sổ Hiệp Hòa
      mockCloud.emitRealtimeForBook('tien_du');
      vi.advanceTimersByTime(300);
      expect(onRemoteChanged).toHaveBeenCalledTimes(1);

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
