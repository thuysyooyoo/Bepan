import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
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
import { computeDailyReport, computeWalletBalances } from '../domain/accounting';
import {
  buildZaloAdminMonthlySummaryText,
  buildZaloDailySummaryText,
  computeAdminCombinedSummary,
  extractChatLogAiPreview,
  extractChatLogTargetDate,
} from '../domain/adminSummary';
import {
  buildAdminCombinedMonthlyExcelBuffer,
  buildSingleBookMonthlyExcelBuffer,
  EXCEL_DATE_FMT,
  EXCEL_FONT_NAME,
  EXCEL_FONT_SIZE,
  EXCEL_NUMBER_FMT,
} from '../domain/excelExport';

/**
 * Máy chủ Supabase giả lập có kiểm tra khóa ngoại (FK) cơ bản + RLS để kiểm thử
 * hàng đợi Offline-First (`offline_outbox`) sát thực tế 100%.
 */
function createOfflineTestCloudServer() {
  let networkAvailable = true;
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
        avatar_emoji: '👨‍🍳',
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
        avatar_emoji: '👩‍🍳',
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
        avatar_emoji: '🛡️',
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

  const ensureOnline = () => {
    if (!networkAvailable) {
      throw new TypeError('Failed to fetch (simulated offline network)');
    }
  };

  const getCaller = () =>
    currentAuthUser
      ? tables.profiles.find((p) => p.auth_user_id === currentAuthUser?.id) ?? null
      : null;

  const canAccess = (bookId: unknown) => {
    const prof = getCaller();
    if (!prof) return false;
    return prof.vai_tro === 'admin' || prof.book_id === bookId;
  };

  const buildQuery = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Array<Record<string, unknown>> = [];
    let patch: Record<string, unknown> = {};
    let conflictCols = ['id'];
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let singleMode: 'none' | 'single' | 'maybeSingle' = 'none';

    const match = (r: Record<string, unknown>) =>
      eqs.every(([k, v]) => r[k] === v) && ins.every(([k, arr]) => arr.includes(r[k]));

    const exec = async () => {
      ensureOnline();
      const store = tables[table];

      if (op === 'insert' || op === 'upsert') {
        const saved: Array<Record<string, unknown>> = [];
        for (const row of payload) {
          const targetBook = table === 'books' ? row.id : row.book_id;
          if (table !== 'categories' && !canAccess(targetBook)) {
            return { code: '42501', data: null, error: { code: '42501', message: 'RLS denied' } };
          }
          // Kiểm tra khóa ngoại nhà cung cấp nếu giao dịch tham chiếu supplier_id
          if (table === 'transactions' && row.supplier_id) {
            const supExists = tables.suppliers.some((s) => s.id === row.supplier_id);
            if (!supExists) {
              return {
                data: null,
                error: {
                  code: '23503',
                  message: `Foreign key violation: supplier_id ${String(row.supplier_id)} missing`,
                },
              };
            }
          }
          if (op === 'upsert') {
            const idx = store.findIndex((ex) =>
              conflictCols.every((c) => ex[c] === row[c])
            );
            if (idx >= 0) {
              store[idx] = { ...store[idx], ...row };
              saved.push(store[idx]);
              continue;
            }
          }
          store.push({ ...row });
          saved.push({ ...row });
        }
        if (singleMode !== 'none') return { data: saved[0] ?? null, error: null };
        return { data: saved, error: null };
      }

      if (op === 'update') {
        const updated: Array<Record<string, unknown>> = [];
        for (let i = 0; i < store.length; i++) {
          if (!match(store[i])) continue;
          const next = { ...store[i], ...patch };
          store[i] = next;
          updated.push(next);
        }
        if (singleMode === 'single') return { data: updated[0] ?? null, error: null };
        return { data: updated, error: null };
      }

      const rows = store.filter((r) => {
        if (table === 'categories') return match(r);
        if (table === 'profiles') return match(r);
        const bid = table === 'books' ? r.id : r.book_id;
        return canAccess(bid) && match(r);
      });
      if (singleMode === 'single') return { data: rows[0] ?? null, error: null };
      if (singleMode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };

    const q = {
      select: () => q,
      insert: (d: Record<string, unknown> | Array<Record<string, unknown>>) => {
        op = 'insert';
        payload = Array.isArray(d) ? d : [d];
        return q;
      },
      upsert: (
        d: Record<string, unknown> | Array<Record<string, unknown>>,
        opts?: { onConflict?: string }
      ) => {
        op = 'upsert';
        payload = Array.isArray(d) ? d : [d];
        conflictCols = opts?.onConflict
          ? opts.onConflict.split(',').map((s) => s.trim())
          : ['id'];
        return q;
      },
      update: (p: Record<string, unknown>) => {
        op = 'update';
        patch = p;
        return q;
      },
      eq: (k: string, v: unknown) => {
        eqs.push([k, v]);
        return q;
      },
      in: (k: string, vals: unknown[]) => {
        ins.push([k, vals]);
        return q;
      },
      order: () => q,
      limit: () => q,
      single: () => {
        singleMode = 'single';
        return exec();
      },
      maybeSingle: () => {
        singleMode = 'maybeSingle';
        return exec();
      },
      then: (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => exec().then(onFulfilled, onRejected),
    };
    return q;
  };

  const client = {
    auth: {
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        ensureOnline();
        const u = authUsers.get(email.toLowerCase());
        if (!u || u.secret !== password) {
          return { data: { user: null }, error: { message: 'Invalid login credentials' } };
        }
        currentAuthUser = { id: u.id, email: u.email };
        return { data: { user: currentAuthUser }, error: null };
      },
      async getSession() {
        return {
          data: { session: currentAuthUser ? { user: currentAuthUser } : null },
          error: null,
        };
      },
      async signOut() {
        currentAuthUser = null;
        return { error: null };
      },
    },
    async rpc(fn: string) {
      ensureOnline();
      if (fn === 'get_public_login_profiles') {
        return { data: tables.profiles, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => buildQuery(table),
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: async () => 'ok',
  };

  return {
    client: client as unknown as SupabaseClient,
    tables,
    isOnline: () => networkAvailable,
    setOnline: (online: boolean) => {
      networkAvailable = online;
    },
  };
}

describe('Phiên 8 — Admin tổng hợp 2 cơ sở, Xuất Excel chuẩn kế toán, PWA & Hàng đợi Offline-First', () => {
  it('1. Admin tổng hợp 2 cơ sở: đối chiếu Hiệp Hòa + Tiên Du khớp 100% từng đồng, gộp nhắc việc & trích xuất chat_logs để sửa hộ', async () => {
    const repo = new LocalDexieAdapter(`test_s8_admin_${Date.now()}`);
    await repo.ensureInitialized();

    const bo = await repo.loginWithPin('bo', '1111');
    const me = await repo.loginWithPin('me', '2222');
    const admin = await repo.loginWithPin('admin', '9999');

    // --- Dữ liệu Cơ sở 1: HIỆP HÒA (Bố) tháng 10/2026 ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-10',
      bua: 'trua',
      suat_truong: 200, // 200 × 25.000 = 5.000.000
      suat_vang_lai: 10, // 10 × 30.000 = 300.000
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.saveDailyCollection(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-10',
      tien_mat: 1_500_000,
      chuyen_khoan: 800_000, // Tổng quầy 2.300.000 -> trừ vãng lai 300k => Căn tin thu 2.000.000
      nguon: 'tay',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 2_200_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Mua chịu thịt lợn đầu tháng',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-10',
      so_cong: 1,
      don_gia_cong: 300_000,
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 500_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Tiền điện tháng 10 Hiệp Hòa',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addChatLog(bo, {
      book_id: 'hiep_hoa',
      nguoi_dung: 'bo',
      nguon: 'giong',
      cau_noi: 'Hôm qua lấy chịu thịt chị Hoa hai triệu hai',
      ai_json: {
        cards: [{ kind: 'chi_mua_hang', ngay: '2026-10-09', title: 'Mua chịu thịt 2,2tr' }],
      },
      ket_qua: 'cho_xac_nhan',
    });

    // --- Dữ liệu Cơ sở 2: TIÊN DU (Mẹ) tháng 10/2026 ---
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-12',
      bua: 'trua',
      suat_truong: 150, // 150 × 28.000 (giá Tiên Du) = 4.200.000
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    await repo.saveDailyCollection(me, {
      book_id: 'tien_du',
      ngay: '2026-10-12',
      tien_mat: 1_000_000,
      chuyen_khoan: 500_000, // Căn tin thu 1.500.000
      nguon: 'tay',
    });
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-12',
      mang: 'can_tin',
      loai: 'chi',
      category_id: 'cat_nhap_nuoc_ct',
      so_tien: 600_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Nhập nước ngọt Căn tin Tiên Du',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    await repo.addChatLog(me, {
      book_id: 'tien_du',
      nguoi_dung: 'me',
      nguon: 'chat',
      cau_noi: 'Nhập nước ngọt 600 nghìn tiền mặt',
      ai_json: { assistant_reply: 'Đã tạo thẻ chi nhập hàng Căn tin 600.000 đ' },
      ket_qua: 'da_luu',
    });

    const [hhSnap, tdSnap, hhLogs, tdLogs] = await Promise.all([
      repo.getBookSnapshot(admin, 'hiep_hoa'),
      repo.getBookSnapshot(admin, 'tien_du'),
      repo.listChatLogs(admin, 'hiep_hoa'),
      repo.listChatLogs(admin, 'tien_du'),
    ]);

    const combined = computeAdminCombinedSummary(hhSnap, tdSnap, '2026-10', {
      hhChatLogs: hhLogs,
      tdChatLogs: tdLogs,
      reminderOptions: { referenceDate: '2026-10-26', currentTimeHHmm: '19:00' },
    });

    // Hiệp Hòa: Bếp (5.3tr - 2.2tr - 300k = +2.8tr) + Căn tin (+2.0tr) - Chung (500k) = +4.300.000đ
    expect(combined.hiepHoa.monthly.lai_rong_toan_co_so).toBe(4_300_000);
    // Tiên Du: Bếp (150 × 28k = +4.2tr) + Căn tin (1.5tr - 600k = +900k) = +5.100.000đ
    expect(combined.tienDu.monthly.lai_rong_toan_co_so).toBe(5_100_000);
    // Tổng hợp cả 2 cơ sở khớp tuyệt đối từng đồng:
    expect(combined.tongCong.laiRong).toBe(9_400_000);
    expect(combined.tongCong.tongSuatAn).toBe(360);
    expect(combined.tongCong.tongNoNhaCungCap).toBe(2_200_000);
    expect(combined.tongCong.tongLuongThoChoTra).toBe(300_000);
    expect(combined.tongCong.tongTienTruongChoVe).toBe(9_200_000); // 5.0tr + 4.2tr

    // Tiền thực có 6 ví: Hiệp Hòa (+1.5tr TM + 800k CK - 500k điện = 1.800.000) + Tiên Du (+1.0tr TM + 500k CK - 600k nước = 900.000) = 2.700.000đ
    expect(combined.tongCong.tongTienThucCo6Vi).toBe(2_700_000);

    // Gộp nhắc việc cả 2 cơ sở (nợ quá hạn 25 ngày của chị Hoa xếp ưu tiên 'khan' trên đầu)
    expect(combined.combinedReminders.length).toBeGreaterThanOrEqual(4);
    expect(combined.combinedReminders[0].card.muc_do).toBe('khan');

    // Gộp chat_logs của cả Bố & Mẹ và bóc đúng ngày mục tiêu để Admin bấm sửa hộ
    expect(combined.combinedChatLogs).toHaveLength(2);
    const boLog = combined.combinedChatLogs.find((l) => l.book_id === 'hiep_hoa')!;
    expect(extractChatLogTargetDate(boLog)).toBe('2026-10-09');
    expect(extractChatLogAiPreview(boLog)).toContain('Mua chịu thịt 2,2tr');

    // Bản tin tóm tắt gửi Zalo có đủ thông tin rõ ràng
    const zaloDaily = buildZaloDailySummaryText(hhSnap, '2026-10-10');
    expect(zaloDaily).toContain('210 suất');
    const zaloMonthly = buildZaloAdminMonthlySummaryText(combined);
    expect(zaloMonthly).toContain('9.400.000');
  });

  it('2. Xuất báo cáo Excel (.xlsx): 100% ô chuẩn Arial 10, số #,##0, ngày dd/mm/yyyy & tuyệt đối không sinh file rác trên ổ đĩa', async () => {
    const repo = new LocalDexieAdapter(`test_s8_excel_${Date.now()}`);
    await repo.ensureInitialized();
    const bo = await repo.loginWithPin('bo', '1111');
    const me = await repo.loginWithPin('me', '2222');
    const admin = await repo.loginWithPin('admin', '9999');

    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-15',
      bua: 'trua',
      suat_truong: 180,
      suat_vang_lai: 5,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-15',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_bep_rau_cu',
      so_tien: 1_250_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua rau củ tươi',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-15',
      bua: 'trua',
      suat_truong: 120,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'me',
    });

    const hhSnap = await repo.getBookSnapshot(admin, 'hiep_hoa');
    const tdSnap = await repo.getBookSnapshot(admin, 'tien_du');

    const singleBytes = await buildSingleBookMonthlyExcelBuffer(
      hhSnap,
      '2026-10',
      '2026-10-31'
    );
    const combinedBytes = await buildAdminCombinedMonthlyExcelBuffer(
      hhSnap,
      tdSnap,
      '2026-10',
      '2026-10-31'
    );

    expect(singleBytes.byteLength).toBeGreaterThan(5_000);
    expect(combinedBytes.byteLength).toBeGreaterThan(5_000);

    // Đọc ngược từ Buffer trên RAM bằng ExcelJS để kiểm tra định dạng từng ô
    const wbSingle = new ExcelJS.Workbook();
    await wbSingle.xlsx.load(Buffer.from(singleBytes) as unknown as ExcelJS.Buffer);
    expect(wbSingle.worksheets.map((w) => w.name)).toEqual([
      '1_Tong_Hop_Lai_Lo',
      '2_So_Dong_Tien_3_Vi',
      '3_So_No_Phai_Tra',
      '4_Chi_Tiet_Giao_Dich',
    ]);

    let checkedCellCount = 0;
    let foundNumberFmt = false;
    let foundDateFmt = false;

    wbSingle.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          checkedCellCount += 1;
          expect(cell.font?.name).toBe(EXCEL_FONT_NAME);
          expect(cell.font?.size).toBe(EXCEL_FONT_SIZE);
          if (cell.numFmt === EXCEL_NUMBER_FMT) foundNumberFmt = true;
          if (cell.numFmt === EXCEL_DATE_FMT) {
            foundDateFmt = true;
            expect(cell.value).toBeInstanceOf(Date);
          }
        });
      });
    });

    expect(checkedCellCount).toBeGreaterThan(80);
    expect(foundNumberFmt).toBe(true);
    expect(foundDateFmt).toBe(true);

    const wbCombined = new ExcelJS.Workbook();
    await wbCombined.xlsx.load(Buffer.from(combinedBytes) as unknown as ExcelJS.Buffer);
    expect(wbCombined.worksheets.map((w) => w.name)).toEqual([
      '1_So_Sanh_2_Co_So',
      '2_So_Bep_Hiep_Hoa',
      '3_So_Bep_Tien_Du',
      '4_Giao_Dich_2_Co_So',
    ]);

    wbCombined.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          expect(cell.font?.name).toBe('Arial');
          expect(cell.font?.size).toBe(10);
        });
      });
    });

    // Quy tắc số 10: tuyệt đối không có bất kỳ file .xlsx nào bị ghi ra thư mục dự án
    const rootFiles = fs.readdirSync(process.cwd());
    expect(rootFiles.filter((f) => f.endsWith('.xlsx'))).toEqual([]);
  });

  it('3. Kiểm toán PWA ("Thêm vào màn hình chính"): manifest chuẩn, bộ PNG icon thật đúng kích thước & Service Worker an toàn', () => {
    const root = process.cwd();
    const manifestRaw = fs.readFileSync(
      path.join(root, 'public', 'manifest.webmanifest'),
      'utf8'
    );
    const manifest = JSON.parse(manifestRaw) as {
      short_name: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };

    expect(manifest.short_name).toBe('Sổ Bếp');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(
      true
    );
    expect(
      manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')
    ).toBe(true);

    // Xác thực chữ ký PNG thật và kích thước pixel trong chunk IHDR
    const checkPngDimensions = (filename: string, expectedW: number, expectedH: number) => {
      const buf = fs.readFileSync(path.join(root, 'public', filename));
      expect(buf.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(expectedW);
      expect(height).toBe(expectedH);
    };

    checkPngDimensions('pwa-192x192.png', 192, 192);
    checkPngDimensions('pwa-512x512.png', 512, 512);
    checkPngDimensions('pwa-maskable-512x512.png', 512, 512);
    checkPngDimensions('apple-touch-icon.png', 180, 180);

    const swCode = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
    expect(swCode).toContain("url.pathname.includes('/api/')");
    expect(swCode).toContain('url.origin !== self.location.origin');

    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(indexHtml).toContain('manifest.webmanifest');
    expect(indexHtml).toContain('apple-touch-icon.png');
  });

  it('4. Hàng đợi Offline-First: mất mạng vẫn ghi đầy đủ vào IndexedDB, có mạng tự động đẩy FIFO lên Supabase không mất hay trùng 1 đồng', async () => {
    const cloudServer = createOfflineTestCloudServer();
    const localAdapter = new LocalDexieAdapter(`test_s8_offline_${Date.now()}`);
    await localAdapter.ensureInitialized();

    const cloudAdapter = new SupabaseAdapter({
      supabaseUrl: 'https://grqlnqycxxadedqlppyl.supabase.co',
      supabaseAnonKey: 'sb_publishable_test',
      client: cloudServer.client,
      localMirrorDb: localAdapter.getDexieInstance(),
    });

    const smartRepo = new SmartDataRepository({
      mode: 'supabase',
      localAdapter,
      cloudAdapter,
      isOnline: () => cloudServer.isOnline(),
    });
    await smartRepo.ensureInitialized();

    // 1) Bố đăng nhập khi đang có mạng & mở sổ lần đầu (tự tạo bản gương xuống IndexedDB)
    const boSession = await smartRepo.loginWithPin('bo', '1111');
    const initialSnap = await smartRepo.getBookSnapshot(boSession, 'hiep_hoa');
    expect(initialSnap.book.id).toBe('hiep_hoa');

    // 2) Bố đi chợ / xuống bếp bị MẤT MẠNG hoàn toàn
    cloudServer.setOnline(false);
    expect((await smartRepo.getOfflineQueueStatus()).isOnline).toBe(false);

    // 2a) Thêm mối hàng mới ngay khi mất mạng
    const newSup = await smartRepo.upsertSupplier(boSession, {
      book_id: 'hiep_hoa',
      ten_ncc: 'Chị Mai Cá Tươi',
      mat_hang_chinh: 'Cá chép, cá trắm',
      no_dau_ky: 0,
      dang_giao_dich: true,
    });

    // 2b) Mua chịu cá của mối hàng vừa tạo (kiểm tra bảo toàn thứ tự khóa ngoại FK!)
    await smartRepo.addTransaction(boSession, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_bep_thit_ca',
      so_tien: 950_000,
      wallet_id: null,
      supplier_id: newSup.id,
      ghi_chu: 'Lấy cá trắm mua chịu lúc mất mạng',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });

    // 2c) Báo suất ăn trưa
    await smartRepo.upsertMealCount(boSession, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      bua: 'trua',
      suat_truong: 200,
      suat_vang_lai: 10,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // 2d) Nhập tổng thu cuối ngày lần 1 rồi sửa lại lần 2 ngay khi vẫn đang mất mạng
    await smartRepo.saveDailyCollection(boSession, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      tien_mat: 1_200_000,
      chuyen_khoan: 600_000,
      nguon: 'tay',
    });
    await smartRepo.saveDailyCollection(boSession, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      tien_mat: 1_350_000,
      chuyen_khoan: 650_000,
      nguon: 'tay',
    });

    // 2e) Chấm công thợ phụ bếp
    await smartRepo.upsertAttendance(boSession, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-11-02',
      so_cong: 1,
      don_gia_cong: 300_000,
    });

    // Kiểm tra bảo mật ngay cả khi mất mạng: Bố vẫn bị chặn tuyệt đối nếu chạm vào sổ Tiên Du của Mẹ
    await expect(
      smartRepo.addTransaction(boSession, {
        book_id: 'tien_du',
        ngay: '2026-11-02',
        mang: 'bep_an',
        loai: 'chi',
        category_id: 'cat_bep_rau_cu',
        so_tien: 100_000,
        wallet_id: 'td_tien_mat',
        ghi_chu: 'Thử ghi trái phép lúc offline',
        nguon: 'tay',
        nguoi_tao: 'bo',
      })
    ).rejects.toThrow(PermissionDeniedError);

    // Xác nhận trạng thái lúc đang mất mạng: hàng đợi giữ đúng 6 mục, máy chủ Cloud chưa có giao dịch nào
    const offlineSt = await smartRepo.getOfflineQueueStatus();
    expect(offlineSt.isOnline).toBe(false);
    expect(offlineSt.pendingCount).toBe(6);
    expect(cloudServer.tables.transactions).toHaveLength(0);

    // Bố mở xem báo cáo ngay lúc mất mạng vẫn thấy đầy đủ số vừa nhập (Read-Your-Own-Writes)
    const snapWhileOffline = await smartRepo.getBookSnapshot(boSession, 'hiep_hoa');
    const dailyOffline = computeDailyReport(snapWhileOffline, '2026-11-02');
    expect(dailyOffline.bep_an.tong_suat).toBe(210);
    expect(dailyOffline.can_tin.tong_thu_quay_cuoi_ngay).toBe(2_000_000); // 1.35tr + 650k (không bị nhân đôi lần 1)
    expect(dailyOffline.can_tin.doanh_thu_can_tin).toBe(1_700_000); // 2.0tr - 300k vãng lai

    // 3) ĐIỆN THOẠI CÓ MẠNG TRỞ LẠI -> Tự đẩy sạch hàng đợi FIFO lên Supabase
    cloudServer.setOnline(true);
    const flushRes = await smartRepo.flushOfflineOutbox(boSession);
    expect(flushRes.syncedCount).toBe(6);
    expect(flushRes.remainingCount).toBe(0);
    expect((await smartRepo.getOfflineQueueStatus()).pendingCount).toBe(0);

    // 4) Kiểm tra trực tiếp dữ liệu trên Supabase Cloud khớp 100% với IndexedDB, không trùng 1 đồng
    const cloudSnap = await cloudAdapter.getBookSnapshot(boSession, 'hiep_hoa');
    expect(cloudSnap.suppliers.some((s) => s.ten_ncc === 'Chị Mai Cá Tươi')).toBe(true);

    const activeCloudEod = cloudSnap.transactions.filter(
      (t) => !t.da_xoa && t.loai === 'thu_cuoi_ngay' && t.ngay === '2026-11-02'
    );
    expect(activeCloudEod).toHaveLength(2);
    expect(activeCloudEod.reduce((s, t) => s + t.so_tien, 0)).toBe(2_000_000);

    const cloudDaily = computeDailyReport(cloudSnap, '2026-11-02');
    expect(cloudDaily.bep_an.lai_uoc_tinh_ngay).toBe(dailyOffline.bep_an.lai_uoc_tinh_ngay);
    expect(cloudDaily.can_tin.doanh_thu_can_tin).toBe(1_700_000);

    const cloudWallets = computeWalletBalances(
      cloudSnap.wallets,
      cloudSnap.transactions,
      'hiep_hoa'
    );
    expect(cloudWallets.reduce((s, w) => s + w.so_du_hien_tai, 0)).toBe(2_000_000);
  });
});
