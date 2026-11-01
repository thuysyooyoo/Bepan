import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateId } from '../domain/format';
import type { AiSettings } from '../types/aiSettings';
import { DEFAULT_AI_SETTINGS } from '../types/aiSettings';
import type {
  Attendance,
  AuthSession,
  Book,
  BookId,
  BookSnapshot,
  Category,
  ChatLog,
  MealCount,
  MealPrice,
  Reminder,
  Supplier,
  Transaction,
  Wallet,
  Worker,
} from '../types/models';
import { SoBepDexieDB } from './dexieDb';
import {
  assertAdmin,
  assertCanAccessBook,
  type CloudSyncStatus,
  type DataRepository,
  type LocalToCloudSyncResult,
  PermissionDeniedError,
  type PublicProfileSummary,
} from './interface';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const FALLBACK_PUBLIC_PROFILES: PublicProfileSummary[] = [
  {
    id: 'bo',
    ten_hien_thi: 'Bố — Hiệp Hòa',
    xung_ho: 'Bố',
    mo_ta: 'Sổ Bếp & Căn tin Hiệp Hòa',
    vai_tro: 'owner',
    book_id: 'hiep_hoa',
    avatar_emoji: '',
  },
  {
    id: 'me',
    ten_hien_thi: 'Mẹ — Tiên Du',
    xung_ho: 'Mẹ',
    mo_ta: 'Sổ Bếp & Căn tin Tiên Du',
    vai_tro: 'owner',
    book_id: 'tien_du',
    avatar_emoji: '',
  },
  {
    id: 'admin',
    ten_hien_thi: 'Quản lý (Con)',
    xung_ho: 'Admin',
    mo_ta: 'Xem cả Hiệp Hòa, Tiên Du & Tổng hợp',
    vai_tro: 'admin',
    book_id: null,
    avatar_emoji: '',
  },
];

/**
 * Ánh xạ mã PIN 4 số sang chuỗi mật khẩu chuẩn Bcrypt >= 16 ký tự cho Supabase GoTrue,
 * giữ trải nghiệm bấm đúng 4 số PIN to rõ cho Bố Mẹ.
 */
export function derivePinAuthSecret(profileId: string, pin4Digits: string): string {
  const cleanId = String(profileId || '').trim().toLowerCase();
  const cleanPin = String(pin4Digits || '').trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    throw new Error('Mã PIN phải gồm đúng 4 chữ số.');
  }
  return `SoBep#${cleanId}#PIN#${cleanPin}`;
}

export function virtualEmailForProfile(profileId: string): string {
  const cleanId = String(profileId || '').trim().toLowerCase();
  return `${cleanId}@sobep.local`;
}

// =============================================================================
// BỘ CHUẨN HÓA DÒNG POSTGRESQL (BIGINT / NUMERIC STRING -> NUMBER AN TOÀN)
// =============================================================================

export function normalizeBookRow(r: Record<string, unknown>): Book {
  return {
    id: String(r.id) as BookId,
    ten: String(r.ten ?? ''),
    dia_diem: String(r.dia_diem ?? ''),
    chu_so: String(r.chu_so ?? ''),
    gio_nhac_hang_ngay: String(r.gio_nhac_hang_ngay ?? '18:00'),
    ngay_nhac_truong_chuyen: Number(r.ngay_nhac_truong_chuyen ?? 20),
    so_ngay_nhac_no_ncc: Number(r.so_ngay_nhac_no_ncc ?? 15),
    created_at: String(r.created_at ?? new Date().toISOString()),
  };
}

export function normalizeMealPriceRow(r: Record<string, unknown>): MealPrice {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    bua: String(r.bua) as MealPrice['bua'],
    loai_khach: String(r.loai_khach) as MealPrice['loai_khach'],
    don_gia: Number(r.don_gia ?? 0),
    ap_dung_tu_ngay: String(r.ap_dung_tu_ngay ?? '2026-01-01').slice(0, 10),
    ghi_chu: r.ghi_chu ? String(r.ghi_chu) : undefined,
  };
}

export function normalizeMealCountRow(r: Record<string, unknown>): MealCount {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    ngay: String(r.ngay ?? '').slice(0, 10),
    bua: String(r.bua) as MealCount['bua'],
    suat_truong: Number(r.suat_truong ?? 0),
    suat_vang_lai: Number(r.suat_vang_lai ?? 0),
    ghi_chu: r.ghi_chu ? String(r.ghi_chu) : undefined,
    nguon: (String(r.nguon || 'tay') as MealCount['nguon']),
    nguoi_tao: String(r.nguoi_tao ?? ''),
    updated_at: String(r.updated_at ?? new Date().toISOString()),
  };
}

export function normalizeWorkerRow(r: Record<string, unknown>): Worker {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    ho_ten: String(r.ho_ten ?? ''),
    luong_ngay: Number(r.luong_ngay ?? 0),
    dang_lam: Boolean(r.dang_lam ?? true),
    ghi_chu: r.ghi_chu ? String(r.ghi_chu) : undefined,
  };
}

export function normalizeAttendanceRow(r: Record<string, unknown>): Attendance {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    worker_id: String(r.worker_id),
    ngay: String(r.ngay ?? '').slice(0, 10),
    so_cong: Number(r.so_cong ?? 0) as Attendance['so_cong'],
    don_gia_cong: Number(r.don_gia_cong ?? 0),
    ghi_chu: r.ghi_chu ? String(r.ghi_chu) : undefined,
    updated_at: String(r.updated_at ?? new Date().toISOString()),
  };
}

export function normalizeWalletRow(r: Record<string, unknown>): Wallet {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    loai_vi: String(r.loai_vi) as Wallet['loai_vi'],
    ten_vi: String(r.ten_vi ?? ''),
    chu_tai_khoan: String(r.chu_tai_khoan ?? ''),
    so_du_dau_ky: Number(r.so_du_dau_ky ?? 0),
    thu_tu: Number(r.thu_tu ?? 1),
  };
}

export function normalizeSupplierRow(r: Record<string, unknown>): Supplier {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    ten_ncc: String(r.ten_ncc ?? ''),
    mat_hang_chinh: String(r.mat_hang_chinh ?? ''),
    so_dien_thoai: r.so_dien_thoai ? String(r.so_dien_thoai) : undefined,
    no_dau_ky: Number(r.no_dau_ky ?? 0),
    dang_giao_dich: Boolean(r.dang_giao_dich ?? true),
    ghi_chu: r.ghi_chu ? String(r.ghi_chu) : undefined,
  };
}

export function normalizeCategoryRow(r: Record<string, unknown>): Category {
  const rawKeywords = r.tu_khoa_ai;
  return {
    id: String(r.id),
    ten_danh_muc: String(r.ten_danh_muc ?? ''),
    nhom: String(r.nhom) as Category['nhom'],
    kieu_tinh: String(r.kieu_tinh) as Category['kieu_tinh'],
    mang_mac_dinh: String(r.mang_mac_dinh) as Category['mang_mac_dinh'],
    icon: String(r.icon ?? ''),
    tu_khoa_ai: Array.isArray(rawKeywords) ? rawKeywords.map(String) : [],
    thu_tu: Number(r.thu_tu ?? 100),
  };
}

export function normalizeTransactionRow(r: Record<string, unknown>): Transaction {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    ngay: String(r.ngay ?? '').slice(0, 10),
    timestamp: String(r.timestamp ?? new Date().toISOString()),
    mang: String(r.mang) as Transaction['mang'],
    loai: String(r.loai) as Transaction['loai'],
    category_id: String(r.category_id ?? ''),
    so_tien: Number(r.so_tien ?? 0),
    wallet_id: r.wallet_id ? String(r.wallet_id) : null,
    to_wallet_id: r.to_wallet_id ? String(r.to_wallet_id) : null,
    supplier_id: r.supplier_id ? String(r.supplier_id) : null,
    worker_id: r.worker_id ? String(r.worker_id) : null,
    ky_thang: r.ky_thang ? String(r.ky_thang) : null,
    ghi_chu: String(r.ghi_chu ?? ''),
    cau_noi_goc: r.cau_noi_goc ? String(r.cau_noi_goc) : undefined,
    nguon: (String(r.nguon || 'tay') as Transaction['nguon']),
    nguoi_tao: String(r.nguoi_tao ?? ''),
    da_xoa: Boolean(r.da_xoa ?? false),
    deleted_at: r.deleted_at ? String(r.deleted_at) : null,
  };
}

export function normalizeReminderRow(r: Record<string, unknown>): Reminder {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    loai_nhac: String(r.loai_nhac) as Reminder['loai_nhac'],
    ky_thang: String(r.ky_thang ?? ''),
    tieu_de: String(r.tieu_de ?? ''),
    noi_dung: String(r.noi_dung ?? ''),
    so_tien_du_kien:
      r.so_tien_du_kien !== null && r.so_tien_du_kien !== undefined
        ? Number(r.so_tien_du_kien)
        : undefined,
    ngay_bat_dau_nhac: String(r.ngay_bat_dau_nhac ?? '').slice(0, 10),
    trang_thai: String(r.trang_thai ?? 'dang_nhac') as Reminder['trang_thai'],
    matched_transaction_id: r.matched_transaction_id
      ? String(r.matched_transaction_id)
      : null,
    updated_at: String(r.updated_at ?? new Date().toISOString()),
  };
}

export function normalizeChatLogRow(r: Record<string, unknown>): ChatLog {
  return {
    id: String(r.id),
    book_id: String(r.book_id) as BookId,
    timestamp: String(r.timestamp ?? new Date().toISOString()),
    nguoi_dung: String(r.nguoi_dung ?? ''),
    nguon: (String(r.nguon || 'chat') as ChatLog['nguon']),
    cau_noi: String(r.cau_noi ?? ''),
    ai_json: r.ai_json ?? null,
    ket_qua: String(r.ket_qua ?? 'cho_xac_nhan') as ChatLog['ket_qua'],
  };
}

export interface SupabaseAdapterOptions {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  client?: SupabaseClient;
  localMirrorDb?: SoBepDexieDB;
}

export class SupabaseAdapter implements DataRepository {
  readonly mode = 'supabase' as const;
  private url: string;
  private anonKey: string;
  private client: SupabaseClient | null = null;
  private localDb: SoBepDexieDB;
  private cloudReadyCache: { ready: boolean; checkedAt: number; message: string } | null =
    null;

  constructor(options?: SupabaseAdapterOptions) {
    this.url = String(
      options?.supabaseUrl ?? import.meta.env?.VITE_SUPABASE_URL ?? ''
    ).trim();
    this.anonKey = String(
      options?.supabaseAnonKey ?? import.meta.env?.VITE_SUPABASE_ANON_KEY ?? ''
    ).trim();

    if (options?.client) {
      this.client = options.client;
    } else if (this.url && this.anonKey) {
      this.client = createClient(this.url, this.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'sobep_supabase_jwt_v1',
        },
      });
    }

    this.localDb = options?.localMirrorDb ?? new SoBepDexieDB();
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.url && this.anonKey);
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      throw new Error(
        'Chưa cấu hình VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY.'
      );
    }
    return this.client;
  }

  private raiseIfError(error: { message: string; code?: string } | null, context: string): void {
    if (!error) return;
    if (error.code === '42501' || /row-level security|permission denied/i.test(error.message)) {
      throw new PermissionDeniedError(
        `Chặn bảo mật RLS (${context}): Không có quyền truy cập sổ này.`
      );
    }
    throw new Error(`${context}: ${error.message}`);
  }

  /**
   * Thăm dò xem bảng & RPC trên Supabase đã được chạy migration SQL chưa.
   */
  async checkCloudReady(forceRefresh = false): Promise<CloudSyncStatus> {
    if (!this.client || !this.url) {
      return {
        configured: false,
        connected: false,
        mode: 'local',
        supabaseUrl: '',
        message: 'Chưa khai báo địa chỉ Supabase — đang chạy chế độ lưu trên máy.',
      };
    }

    if (
      !forceRefresh &&
      this.cloudReadyCache &&
      Date.now() - this.cloudReadyCache.checkedAt < 15_000
    ) {
      return {
        configured: true,
        connected: this.cloudReadyCache.ready,
        mode: this.cloudReadyCache.ready ? 'supabase' : 'local',
        supabaseUrl: this.url,
        message: this.cloudReadyCache.message,
      };
    }

    try {
      const { data, error } = await this.client.rpc('get_public_login_profiles');
      if (error) {
        const msg =
          error.code === 'PGRST202' || error.code === 'PGRST205' || /not find/i.test(error.message)
            ? 'Đã kết nối máy chủ Supabase nhưng chưa chạy file SQL khởi tạo bảng (001_initial_schema.sql).'
            : `Tạm lưu trên máy (${error.message})`;
        this.cloudReadyCache = { ready: false, checkedAt: Date.now(), message: msg };
        return {
          configured: true,
          connected: false,
          mode: 'local',
          supabaseUrl: this.url,
          message: msg,
        };
      }

      const hasProfiles = Array.isArray(data) && data.length >= 3;
      const msg = hasProfiles
        ? 'Đã kết nối Đám mây Supabase + Đồng bộ Realtime 2 chiều (RLS Bật).'
        : 'Đã có bảng nhưng chưa có đủ 3 tài khoản Bố / Mẹ / Admin.';
      this.cloudReadyCache = {
        ready: hasProfiles,
        checkedAt: Date.now(),
        message: msg,
      };
      return {
        configured: true,
        connected: hasProfiles,
        mode: hasProfiles ? 'supabase' : 'local',
        supabaseUrl: this.url,
        message: msg,
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Mất kết nối mạng tới Supabase (${err.message}) — đang dùng sổ trên máy.`
          : 'Mất kết nối mạng — đang dùng sổ trên máy.';
      this.cloudReadyCache = { ready: false, checkedAt: Date.now(), message: msg };
      return {
        configured: true,
        connected: false,
        mode: 'local',
        supabaseUrl: this.url,
        message: msg,
      };
    }
  }

  async getCloudSyncStatus(forceRefresh = false): Promise<CloudSyncStatus> {
    return this.checkCloudReady(forceRefresh);
  }

  async hasValidAuthSession(actor: AuthSession): Promise<boolean> {
    if (!this.client) return false;
    const { data } = await this.client.auth.getSession();
    const email = data.session?.user?.email?.toLowerCase();
    if (!email) return false;
    return email === virtualEmailForProfile(actor.profile_id);
  }

  async signOutCloud(): Promise<void> {
    if (!this.client) return;
    await this.client.auth.signOut();
  }

  async ensureInitialized(): Promise<void> {
    await this.checkCloudReady();
  }

  async listLoginProfiles(): Promise<PublicProfileSummary[]> {
    const client = this.getClient();
    const { data, error } = await client.rpc('get_public_login_profiles');
    if (error || !Array.isArray(data) || data.length === 0) {
      return FALLBACK_PUBLIC_PROFILES;
    }
    return (data as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      ten_hien_thi: String(p.ten_hien_thi ?? ''),
      xung_ho: String(p.xung_ho ?? ''),
      mo_ta: String(p.mo_ta ?? ''),
      vai_tro: String(p.vai_tro) as PublicProfileSummary['vai_tro'],
      book_id: p.book_id ? (String(p.book_id) as BookId) : null,
      avatar_emoji: '',
    }));
  }

  async loginWithPin(profileId: string, pin: string): Promise<AuthSession> {
    const client = this.getClient();
    const cleanPin = String(pin || '').trim();
    const secret = derivePinAuthSecret(profileId, cleanPin);
    const email = virtualEmailForProfile(profileId);

    const { data: authData, error: authErr } = await client.auth.signInWithPassword({
      email,
      password: secret,
    });

    if (authErr || !authData.user) {
      if (authErr && /invalid login credentials/i.test(authErr.message)) {
        throw new Error('Mã PIN chưa đúng. Ông/bà bấm lại giúp con nhé!');
      }
      throw new Error(authErr?.message || 'Không thể đăng nhập đám mây lúc này.');
    }

    const { data: profRow, error: profErr } = await client
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    this.raiseIfError(profErr, 'Tải hồ sơ người dùng');

    const r = profRow as Record<string, unknown>;
    const now = Date.now();
    return {
      profile_id: String(r.id),
      ten_hien_thi: String(r.ten_hien_thi ?? ''),
      xung_ho: String(r.xung_ho ?? ''),
      vai_tro: String(r.vai_tro) as AuthSession['vai_tro'],
      book_id: r.book_id ? (String(r.book_id) as BookId) : null,
      avatar_emoji: '',
      created_at: now,
      expires_at: now + NINETY_DAYS_MS,
    };
  }

  async changePin(
    actor: AuthSession,
    targetProfileId: string,
    newPin: string
  ): Promise<void> {
    if (actor.vai_tro !== 'admin' && actor.profile_id !== targetProfileId) {
      throw new PermissionDeniedError('Chỉ chính chủ hoặc Admin mới được đổi mã PIN.');
    }
    const secret = derivePinAuthSecret(targetProfileId, newPin);
    const client = this.getClient();
    const { error } = await client.rpc('change_user_pin', {
      p_target_profile_id: targetProfileId,
      p_new_secret: secret,
    });
    this.raiseIfError(error, 'Đổi mã PIN');
  }

  async listAccessibleBooks(actor: AuthSession): Promise<Book[]> {
    if (!actor || actor.expires_at <= Date.now()) {
      throw new PermissionDeniedError('Phiên đăng nhập đã hết hạn.');
    }
    const client = this.getClient();
    const { data, error } = await client.from('books').select('*').order('id');
    this.raiseIfError(error, 'Tải danh sách sổ');
    return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeBookRow);
  }

  async getBookSnapshot(actor: AuthSession, bookId: BookId): Promise<BookSnapshot> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();

    const [
      bookRes,
      mpRes,
      mcRes,
      wkRes,
      attRes,
      walRes,
      supRes,
      catRes,
      txRes,
      remRes,
    ] = await Promise.all([
      client.from('books').select('*').eq('id', bookId).single(),
      client.from('meal_prices').select('*').eq('book_id', bookId),
      client.from('meal_counts').select('*').eq('book_id', bookId),
      client.from('workers').select('*').eq('book_id', bookId),
      client.from('attendance').select('*').eq('book_id', bookId),
      client.from('wallets').select('*').eq('book_id', bookId).order('thu_tu'),
      client.from('suppliers').select('*').eq('book_id', bookId),
      client.from('categories').select('*').order('thu_tu'),
      client
        .from('transactions')
        .select('*')
        .eq('book_id', bookId)
        .order('timestamp', { ascending: false }),
      client.from('reminders').select('*').eq('book_id', bookId),
    ]);

    this.raiseIfError(bookRes.error, `Mở sổ ${bookId}`);
    this.raiseIfError(mpRes.error, 'Tải đơn giá suất ăn');
    this.raiseIfError(mcRes.error, 'Tải suất ăn');
    this.raiseIfError(wkRes.error, 'Tải đội phụ bếp');
    this.raiseIfError(attRes.error, 'Tải chấm công');
    this.raiseIfError(walRes.error, 'Tải danh sách ví');
    this.raiseIfError(supRes.error, 'Tải mối hàng');
    this.raiseIfError(catRes.error, 'Tải danh mục');
    this.raiseIfError(txRes.error, 'Tải giao dịch');
    this.raiseIfError(remRes.error, 'Tải nhắc việc');

    return {
      book: normalizeBookRow(bookRes.data as Record<string, unknown>),
      mealPrices: ((mpRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeMealPriceRow
      ),
      mealCounts: ((mcRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeMealCountRow
      ),
      workers: ((wkRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeWorkerRow
      ),
      attendance: ((attRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeAttendanceRow
      ),
      wallets: ((walRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeWalletRow
      ),
      suppliers: ((supRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeSupplierRow
      ),
      categories: ((catRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeCategoryRow
      ),
      transactions: ((txRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeTransactionRow
      ),
      reminders: ((remRes.data ?? []) as Array<Record<string, unknown>>).map(
        normalizeReminderRow
      ),
    };
  }

  async updateBookSettings(actor: AuthSession, book: Book): Promise<Book> {
    assertCanAccessBook(actor, book.id);
    const client = this.getClient();
    const { data, error } = await client
      .from('books')
      .update({
        ten: book.ten,
        dia_diem: book.dia_diem,
        chu_so: book.chu_so,
        gio_nhac_hang_ngay: book.gio_nhac_hang_ngay,
        ngay_nhac_truong_chuyen: book.ngay_nhac_truong_chuyen,
        so_ngay_nhac_no_ncc: book.so_ngay_nhac_no_ncc,
      })
      .eq('id', book.id)
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu cài đặt sổ');
    return normalizeBookRow(data as Record<string, unknown>);
  }

  async upsertMealCount(
    actor: AuthSession,
    entry: Omit<MealCount, 'id' | 'updated_at'> & { id?: string }
  ): Promise<MealCount> {
    assertCanAccessBook(actor, entry.book_id);
    const client = this.getClient();
    const payload = {
      id: entry.id ?? generateId(),
      book_id: entry.book_id,
      ngay: entry.ngay,
      bua: entry.bua,
      suat_truong: Math.round(entry.suat_truong),
      suat_vang_lai: Math.round(entry.suat_vang_lai),
      ghi_chu: entry.ghi_chu ?? '',
      nguon: entry.nguon,
      nguoi_tao: entry.nguoi_tao,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('meal_counts')
      .upsert(payload, { onConflict: 'book_id,ngay,bua' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu suất ăn');
    return normalizeMealCountRow(data as Record<string, unknown>);
  }

  async upsertMealPrice(
    actor: AuthSession,
    price: Omit<MealPrice, 'id'> & { id?: string }
  ): Promise<MealPrice> {
    assertCanAccessBook(actor, price.book_id);
    const client = this.getClient();
    const payload = {
      id: price.id ?? generateId(),
      book_id: price.book_id,
      bua: price.bua,
      loai_khach: price.loai_khach,
      don_gia: Math.round(price.don_gia),
      ap_dung_tu_ngay: price.ap_dung_tu_ngay,
      ghi_chu: price.ghi_chu ?? '',
    };
    const { data, error } = await client
      .from('meal_prices')
      .upsert(payload, { onConflict: 'book_id,bua,loai_khach,ap_dung_tu_ngay' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu đơn giá suất ăn');
    return normalizeMealPriceRow(data as Record<string, unknown>);
  }

  async upsertWorker(
    actor: AuthSession,
    worker: Omit<Worker, 'id'> & { id?: string }
  ): Promise<Worker> {
    assertCanAccessBook(actor, worker.book_id);
    const client = this.getClient();
    const payload = {
      id: worker.id ?? generateId(),
      book_id: worker.book_id,
      ho_ten: worker.ho_ten,
      luong_ngay: Math.round(worker.luong_ngay),
      dang_lam: worker.dang_lam,
      ghi_chu: worker.ghi_chu ?? '',
    };
    const { data, error } = await client
      .from('workers')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu thông tin phụ bếp');
    return normalizeWorkerRow(data as Record<string, unknown>);
  }

  async upsertAttendance(
    actor: AuthSession,
    att: Omit<Attendance, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Attendance> {
    assertCanAccessBook(actor, att.book_id);
    const client = this.getClient();
    const payload = {
      id: att.id ?? generateId(),
      book_id: att.book_id,
      worker_id: att.worker_id,
      ngay: att.ngay,
      so_cong: att.so_cong,
      don_gia_cong: Math.round(att.don_gia_cong),
      ghi_chu: att.ghi_chu ?? '',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('attendance')
      .upsert(payload, { onConflict: 'worker_id,ngay' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu chấm công');
    return normalizeAttendanceRow(data as Record<string, unknown>);
  }

  async upsertSupplier(
    actor: AuthSession,
    supplier: Omit<Supplier, 'id'> & { id?: string }
  ): Promise<Supplier> {
    assertCanAccessBook(actor, supplier.book_id);
    const client = this.getClient();
    const payload = {
      id: supplier.id ?? generateId(),
      book_id: supplier.book_id,
      ten_ncc: supplier.ten_ncc,
      mat_hang_chinh: supplier.mat_hang_chinh ?? '',
      so_dien_thoai: supplier.so_dien_thoai ?? '',
      no_dau_ky: Math.round(supplier.no_dau_ky ?? 0),
      dang_giao_dich: supplier.dang_giao_dich,
      ghi_chu: supplier.ghi_chu ?? '',
    };
    const { data, error } = await client
      .from('suppliers')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu nhà cung cấp');
    return normalizeSupplierRow(data as Record<string, unknown>);
  }

  async upsertCategory(actor: AuthSession, category: Category): Promise<Category> {
    assertAdmin(actor);
    const client = this.getClient();
    const { data, error } = await client
      .from('categories')
      .upsert(category, { onConflict: 'id' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu danh mục');
    return normalizeCategoryRow(data as Record<string, unknown>);
  }

  async updateWallet(actor: AuthSession, wallet: Wallet): Promise<Wallet> {
    assertCanAccessBook(actor, wallet.book_id);
    const client = this.getClient();
    const { data, error } = await client
      .from('wallets')
      .upsert(
        {
          id: wallet.id,
          book_id: wallet.book_id,
          loai_vi: wallet.loai_vi,
          ten_vi: wallet.ten_vi,
          chu_tai_khoan: wallet.chu_tai_khoan,
          so_du_dau_ky: Math.round(wallet.so_du_dau_ky),
          thu_tu: wallet.thu_tu,
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();
    this.raiseIfError(error, 'Cập nhật ví');
    return normalizeWalletRow(data as Record<string, unknown>);
  }

  async addTransaction(
    actor: AuthSession,
    tx: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<Transaction> {
    assertCanAccessBook(actor, tx.book_id);
    const client = this.getClient();

    if (tx.wallet_id) {
      const { data: wData } = await client
        .from('wallets')
        .select('id, book_id')
        .eq('id', tx.wallet_id)
        .maybeSingle();
      if (!wData || String((wData as Record<string, unknown>).book_id) !== tx.book_id) {
        throw new PermissionDeniedError('Ví được chọn không thuộc sổ của cơ sở này.');
      }
    }

    const payload = {
      id: tx.id ?? generateId(),
      book_id: tx.book_id,
      ngay: tx.ngay,
      timestamp: tx.timestamp ?? new Date().toISOString(),
      mang: tx.mang,
      loai: tx.loai,
      category_id: tx.category_id,
      so_tien: Math.round(tx.so_tien),
      wallet_id: tx.wallet_id ?? null,
      to_wallet_id: tx.to_wallet_id ?? null,
      supplier_id: tx.supplier_id ?? null,
      worker_id: tx.worker_id ?? null,
      ky_thang: tx.ky_thang ?? null,
      ghi_chu: tx.ghi_chu ?? '',
      cau_noi_goc: tx.cau_noi_goc ?? '',
      nguon: tx.nguon,
      nguoi_tao: tx.nguoi_tao,
      da_xoa: false,
      deleted_at: null,
    };

    const { data, error } = await client
      .from('transactions')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu giao dịch');
    return normalizeTransactionRow(data as Record<string, unknown>);
  }

  async saveDailyCollection(
    actor: AuthSession,
    params: {
      book_id: BookId;
      ngay: string;
      tien_mat: number;
      chuyen_khoan: number;
      ghi_chu?: string;
      nguon: 'giong' | 'chat' | 'tay';
    }
  ): Promise<{ createdIds: string[]; replacedIds: string[] }> {
    assertCanAccessBook(actor, params.book_id);
    const client = this.getClient();

    const { data: walletRows, error: wErr } = await client
      .from('wallets')
      .select('*')
      .eq('book_id', params.book_id);
    this.raiseIfError(wErr, 'Tải ví thu cuối ngày');

    const wallets = ((walletRows ?? []) as Array<Record<string, unknown>>).map(
      normalizeWalletRow
    );
    const cashWallet = wallets.find((w) => w.loai_vi === 'tien_mat');
    const transferWallet = wallets.find((w) => w.loai_vi === 'tk_chi_nhan');
    if (!cashWallet || !transferWallet) {
      throw new Error('Không tìm thấy ví Tiền mặt hoặc TK Chị Nhàn của cơ sở này.');
    }

    const { data: oldRows, error: oldErr } = await client
      .from('transactions')
      .select('id')
      .eq('book_id', params.book_id)
      .eq('ngay', params.ngay)
      .eq('loai', 'thu_cuoi_ngay')
      .eq('da_xoa', false);
    this.raiseIfError(oldErr, 'Kiểm tra thu cuối ngày cũ');

    const replacedIds = ((oldRows ?? []) as Array<Record<string, unknown>>).map((r) =>
      String(r.id)
    );
    if (replacedIds.length > 0) {
      const { error: delErr } = await client
        .from('transactions')
        .update({ da_xoa: true, deleted_at: new Date().toISOString() })
        .in('id', replacedIds);
      this.raiseIfError(delErr, 'Ghi đè thu cuối ngày cũ');
    }

    const createdIds: string[] = [];
    const nowIso = new Date().toISOString();
    const toInsert: Array<Record<string, unknown>> = [];

    if (params.tien_mat > 0) {
      const cashId = generateId();
      createdIds.push(cashId);
      toInsert.push({
        id: cashId,
        book_id: params.book_id,
        ngay: params.ngay,
        timestamp: nowIso,
        mang: 'can_tin',
        loai: 'thu_cuoi_ngay',
        category_id: 'cat_thu_cuoi_ngay',
        so_tien: Math.round(params.tien_mat),
        wallet_id: cashWallet.id,
        ghi_chu: params.ghi_chu || 'Thu tiền mặt cuối ngày (Căn tin + Vãng lai)',
        nguon: params.nguon,
        nguoi_tao: actor.profile_id,
        da_xoa: false,
        deleted_at: null,
      });
    }

    if (params.chuyen_khoan > 0) {
      const ckId = generateId();
      createdIds.push(ckId);
      toInsert.push({
        id: ckId,
        book_id: params.book_id,
        ngay: params.ngay,
        timestamp: nowIso,
        mang: 'can_tin',
        loai: 'thu_cuoi_ngay',
        category_id: 'cat_thu_cuoi_ngay',
        so_tien: Math.round(params.chuyen_khoan),
        wallet_id: transferWallet.id,
        ghi_chu: params.ghi_chu || 'Thu CK Chị Nhàn cuối ngày (Căn tin + Vãng lai)',
        nguon: params.nguon,
        nguoi_tao: actor.profile_id,
        da_xoa: false,
        deleted_at: null,
      });
    }

    if (toInsert.length > 0) {
      const { error: insErr } = await client.from('transactions').insert(toInsert);
      this.raiseIfError(insErr, 'Lưu thu cuối ngày');
    }

    return { createdIds, replacedIds };
  }

  async updateTransaction(actor: AuthSession, tx: Transaction): Promise<Transaction> {
    assertCanAccessBook(actor, tx.book_id);
    const client = this.getClient();
    const { data, error } = await client
      .from('transactions')
      .update({
        ngay: tx.ngay,
        mang: tx.mang,
        loai: tx.loai,
        category_id: tx.category_id,
        so_tien: Math.round(tx.so_tien),
        wallet_id: tx.wallet_id ?? null,
        to_wallet_id: tx.to_wallet_id ?? null,
        supplier_id: tx.supplier_id ?? null,
        worker_id: tx.worker_id ?? null,
        ky_thang: tx.ky_thang ?? null,
        ghi_chu: tx.ghi_chu ?? '',
        da_xoa: tx.da_xoa,
        deleted_at: tx.deleted_at ?? null,
      })
      .eq('id', tx.id)
      .eq('book_id', tx.book_id)
      .select('*')
      .single();
    this.raiseIfError(error, 'Sửa giao dịch');
    return normalizeTransactionRow(data as Record<string, unknown>);
  }

  async softDeleteTransaction(
    actor: AuthSession,
    bookId: BookId,
    txId: string
  ): Promise<void> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();
    const { data, error } = await client
      .from('transactions')
      .update({ da_xoa: true, deleted_at: new Date().toISOString() })
      .eq('id', txId)
      .eq('book_id', bookId)
      .select('id');
    this.raiseIfError(error, 'Xóa mềm giao dịch');
    if (!data || data.length === 0) {
      throw new PermissionDeniedError('Không tìm thấy giao dịch cần xóa trong sổ này.');
    }
  }

  async restoreTransaction(
    actor: AuthSession,
    bookId: BookId,
    txId: string
  ): Promise<void> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();
    const { data, error } = await client
      .from('transactions')
      .update({ da_xoa: false, deleted_at: null })
      .eq('id', txId)
      .eq('book_id', bookId)
      .select('id');
    this.raiseIfError(error, 'Khôi phục giao dịch');
    if (!data || data.length === 0) {
      throw new PermissionDeniedError('Không tìm thấy giao dịch cần khôi phục.');
    }
  }

  async upsertReminder(
    actor: AuthSession,
    reminder: Omit<Reminder, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Reminder> {
    assertCanAccessBook(actor, reminder.book_id);
    const client = this.getClient();
    const payload = {
      id: reminder.id ?? generateId(),
      book_id: reminder.book_id,
      loai_nhac: reminder.loai_nhac,
      ky_thang: reminder.ky_thang ?? '',
      tieu_de: reminder.tieu_de,
      noi_dung: reminder.noi_dung ?? '',
      so_tien_du_kien:
        reminder.so_tien_du_kien !== undefined
          ? Math.round(reminder.so_tien_du_kien)
          : null,
      ngay_bat_dau_nhac: reminder.ngay_bat_dau_nhac,
      trang_thai: reminder.trang_thai,
      matched_transaction_id: reminder.matched_transaction_id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('reminders')
      .upsert(payload, { onConflict: 'book_id,loai_nhac,ky_thang' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Cập nhật thẻ nhắc');
    return normalizeReminderRow(data as Record<string, unknown>);
  }

  async addChatLog(
    actor: AuthSession,
    log: Omit<ChatLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): Promise<ChatLog> {
    assertCanAccessBook(actor, log.book_id);
    const client = this.getClient();
    let parsedJson: unknown = log.ai_json ?? null;
    if (typeof log.ai_json === 'string') {
      try {
        parsedJson = JSON.parse(log.ai_json);
      } catch {
        parsedJson = { raw: log.ai_json };
      }
    }
    const payload = {
      id: log.id ?? generateId(),
      book_id: log.book_id,
      timestamp: log.timestamp ?? new Date().toISOString(),
      nguoi_dung: log.nguoi_dung,
      nguon: log.nguon,
      cau_noi: log.cau_noi,
      ai_json: parsedJson,
      ket_qua: log.ket_qua,
    };
    const { data, error } = await client
      .from('chat_logs')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    this.raiseIfError(error, 'Lưu nhật ký hội thoại');
    return normalizeChatLogRow(data as Record<string, unknown>);
  }

  /**
   * Phát lại trọn gói giao dịch Thu cuối ngày từ hàng đợi Offline lên Supabase
   * đảm bảo giữ nguyên ID giao dịch trên máy và xóa mềm bản cũ chống nhân đôi 100%.
   */
  async replayOfflineDailyCollection(
    actor: AuthSession,
    params: {
      book_id: BookId;
      ngay: string;
      replacedIds: string[];
      createdTransactions: Transaction[];
    }
  ): Promise<void> {
    assertCanAccessBook(actor, params.book_id);
    const client = this.getClient();

    const createdIdSet = new Set(params.createdTransactions.map((t) => t.id));
    const { data: oldRows, error: oldErr } = await client
      .from('transactions')
      .select('id')
      .eq('book_id', params.book_id)
      .eq('ngay', params.ngay)
      .eq('loai', 'thu_cuoi_ngay')
      .eq('da_xoa', false);
    this.raiseIfError(oldErr, 'Đối chiếu thu cuối ngày offline');

    const idsToSoftDelete = new Set<string>(params.replacedIds);
    for (const r of (oldRows ?? []) as Array<Record<string, unknown>>) {
      const rid = String(r.id);
      if (!createdIdSet.has(rid)) {
        idsToSoftDelete.add(rid);
      }
    }

    if (idsToSoftDelete.size > 0) {
      const { error: delErr } = await client
        .from('transactions')
        .update({ da_xoa: true, deleted_at: new Date().toISOString() })
        .in('id', Array.from(idsToSoftDelete));
      this.raiseIfError(delErr, 'Xóa mềm thu cuối ngày cũ khi đồng bộ offline');
    }

    if (params.createdTransactions.length > 0) {
      const rows = params.createdTransactions.map((t) => ({
        id: t.id,
        book_id: t.book_id,
        ngay: t.ngay,
        timestamp: t.timestamp,
        mang: t.mang,
        loai: t.loai,
        category_id: t.category_id,
        so_tien: Math.round(t.so_tien),
        wallet_id: t.wallet_id ?? null,
        to_wallet_id: t.to_wallet_id ?? null,
        supplier_id: t.supplier_id ?? null,
        worker_id: t.worker_id ?? null,
        ky_thang: t.ky_thang ?? null,
        ghi_chu: t.ghi_chu ?? '',
        cau_noi_goc: t.cau_noi_goc ?? '',
        nguon: t.nguon,
        nguoi_tao: t.nguoi_tao,
        da_xoa: Boolean(t.da_xoa),
        deleted_at: t.deleted_at ?? null,
      }));
      const { error: upErr } = await client
        .from('transactions')
        .upsert(rows, { onConflict: 'id' });
      this.raiseIfError(upErr, 'Đồng bộ thu cuối ngày offline');
    }
  }

  async updateChatLogStatus(
    actor: AuthSession,
    bookId: BookId,
    logId: string,
    ketQua: ChatLog['ket_qua']
  ): Promise<void> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();
    const { error } = await client
      .from('chat_logs')
      .update({ ket_qua: ketQua })
      .eq('id', logId)
      .eq('book_id', bookId);
    this.raiseIfError(error, 'Cập nhật nhật ký hội thoại');
  }

  async listChatLogs(
    actor: AuthSession,
    bookId: BookId,
    limit = 100
  ): Promise<ChatLog[]> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();
    const { data, error } = await client
      .from('chat_logs')
      .select('*')
      .eq('book_id', bookId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    this.raiseIfError(error, 'Tải nhật ký hội thoại');
    return ((data ?? []) as Array<Record<string, unknown>>).map(normalizeChatLogRow);
  }

  /**
   * ĐỒNG BỘ HAI CHIỀU THỜI GIAN THỰC (SUPABASE REALTIME + VISIBILITY REFRESH):
   * Khi Bố/Mẹ ghi trên điện thoại -> màn hình Admin (hoặc tab khác) tự cập nhật ngay lập tức.
   */
  subscribeToBookChanges(bookId: BookId, onChanged: () => void): () => void {
    if (!this.client) return () => {};
    const client = this.client;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const triggerDebounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onChanged();
      }, 250);
    };

    const channelName = `sobep-realtime-${bookId}-${Date.now()}`;
    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', filter: `book_id=eq.${bookId}` },
        triggerDebounced
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'books', filter: `id=eq.${bookId}` },
        triggerDebounced
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories' },
        triggerDebounced
      )
      .subscribe();

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        triggerDebounced();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      void client.removeChannel(channel);
    };
  }

  /**
   * CHUYỂN DỮ LIỆU THỬ TỪ MÁY (INDEXEDDB) LÊN SUPABASE CLOUD (CHỐNG TRÙNG 100%):
   * Nạp theo đúng thứ tự khóa ngoại (FK): books -> categories -> wallets -> meal_prices ->
   * workers -> suppliers -> meal_counts -> attendance -> transactions -> reminders -> chat_logs.
   */
  async syncLocalBookToCloud(
    actor: AuthSession,
    bookId: BookId
  ): Promise<LocalToCloudSyncResult> {
    assertCanAccessBook(actor, bookId);
    const client = this.getClient();

    const [
      localBook,
      localCategories,
      localWallets,
      localPrices,
      localWorkers,
      localSuppliers,
      localCounts,
      localAtt,
      localTxs,
      localRems,
      localLogs,
    ] = await Promise.all([
      this.localDb.books.get(bookId),
      this.localDb.categories.toArray(),
      this.localDb.wallets.where('book_id').equals(bookId).toArray(),
      this.localDb.meal_prices.where('book_id').equals(bookId).toArray(),
      this.localDb.workers.where('book_id').equals(bookId).toArray(),
      this.localDb.suppliers.where('book_id').equals(bookId).toArray(),
      this.localDb.meal_counts.where('book_id').equals(bookId).toArray(),
      this.localDb.attendance.where('book_id').equals(bookId).toArray(),
      this.localDb.transactions.where('book_id').equals(bookId).toArray(),
      this.localDb.reminders.where('book_id').equals(bookId).toArray(),
      this.localDb.chat_logs.where('book_id').equals(bookId).toArray(),
    ]);

    const pushedCounts: Record<string, number> = {};

    if (localBook) {
      await this.updateBookSettings(actor, localBook);
      pushedCounts.books = 1;
    }

    if (actor.vai_tro === 'admin' && localCategories.length > 0) {
      const { error } = await client
        .from('categories')
        .upsert(localCategories, { onConflict: 'id' });
      this.raiseIfError(error, 'Đồng bộ danh mục');
      pushedCounts.categories = localCategories.length;
    }

    if (localWallets.length > 0) {
      const { error } = await client
        .from('wallets')
        .upsert(localWallets, { onConflict: 'id' });
      this.raiseIfError(error, 'Đồng bộ ví');
      pushedCounts.wallets = localWallets.length;
    }

    if (localPrices.length > 0) {
      const { error } = await client.from('meal_prices').upsert(
        localPrices.map((p) => ({
          id: p.id,
          book_id: p.book_id,
          bua: p.bua,
          loai_khach: p.loai_khach,
          don_gia: Math.round(p.don_gia),
          ap_dung_tu_ngay: p.ap_dung_tu_ngay,
          ghi_chu: p.ghi_chu ?? '',
        })),
        { onConflict: 'book_id,bua,loai_khach,ap_dung_tu_ngay' }
      );
      this.raiseIfError(error, 'Đồng bộ đơn giá suất ăn');
      pushedCounts.meal_prices = localPrices.length;
    }

    if (localWorkers.length > 0) {
      const { error } = await client.from('workers').upsert(
        localWorkers.map((w) => ({
          id: w.id,
          book_id: w.book_id,
          ho_ten: w.ho_ten,
          luong_ngay: Math.round(w.luong_ngay),
          dang_lam: w.dang_lam,
          ghi_chu: w.ghi_chu ?? '',
        })),
        { onConflict: 'id' }
      );
      this.raiseIfError(error, 'Đồng bộ phụ bếp');
      pushedCounts.workers = localWorkers.length;
    }

    if (localSuppliers.length > 0) {
      const { error } = await client.from('suppliers').upsert(
        localSuppliers.map((s) => ({
          id: s.id,
          book_id: s.book_id,
          ten_ncc: s.ten_ncc,
          mat_hang_chinh: s.mat_hang_chinh ?? '',
          so_dien_thoai: s.so_dien_thoai ?? '',
          no_dau_ky: Math.round(s.no_dau_ky ?? 0),
          dang_giao_dich: s.dang_giao_dich,
          ghi_chu: s.ghi_chu ?? '',
        })),
        { onConflict: 'id' }
      );
      this.raiseIfError(error, 'Đồng bộ mối hàng');
      pushedCounts.suppliers = localSuppliers.length;
    }

    if (localCounts.length > 0) {
      const { error } = await client.from('meal_counts').upsert(
        localCounts.map((m) => ({
          id: m.id,
          book_id: m.book_id,
          ngay: m.ngay,
          bua: m.bua,
          suat_truong: Math.round(m.suat_truong),
          suat_vang_lai: Math.round(m.suat_vang_lai),
          ghi_chu: m.ghi_chu ?? '',
          nguon: m.nguon,
          nguoi_tao: m.nguoi_tao,
          updated_at: m.updated_at,
        })),
        { onConflict: 'book_id,ngay,bua' }
      );
      this.raiseIfError(error, 'Đồng bộ suất ăn');
      pushedCounts.meal_counts = localCounts.length;
    }

    if (localAtt.length > 0) {
      const { error } = await client.from('attendance').upsert(
        localAtt.map((a) => ({
          id: a.id,
          book_id: a.book_id,
          worker_id: a.worker_id,
          ngay: a.ngay,
          so_cong: a.so_cong,
          don_gia_cong: Math.round(a.don_gia_cong),
          ghi_chu: a.ghi_chu ?? '',
          updated_at: a.updated_at,
        })),
        { onConflict: 'worker_id,ngay' }
      );
      this.raiseIfError(error, 'Đồng bộ chấm công');
      pushedCounts.attendance = localAtt.length;
    }

    if (localTxs.length > 0) {
      const { error } = await client.from('transactions').upsert(
        localTxs.map((t) => ({
          id: t.id,
          book_id: t.book_id,
          ngay: t.ngay,
          timestamp: t.timestamp,
          mang: t.mang,
          loai: t.loai,
          category_id: t.category_id,
          so_tien: Math.round(t.so_tien),
          wallet_id: t.wallet_id ?? null,
          to_wallet_id: t.to_wallet_id ?? null,
          supplier_id: t.supplier_id ?? null,
          worker_id: t.worker_id ?? null,
          ky_thang: t.ky_thang ?? null,
          ghi_chu: t.ghi_chu ?? '',
          cau_noi_goc: t.cau_noi_goc ?? '',
          nguon: t.nguon,
          nguoi_tao: t.nguoi_tao,
          da_xoa: Boolean(t.da_xoa),
          deleted_at: t.deleted_at ?? null,
        })),
        { onConflict: 'id' }
      );
      this.raiseIfError(error, 'Đồng bộ giao dịch');
      pushedCounts.transactions = localTxs.length;
    }

    if (localRems.length > 0) {
      const { error } = await client.from('reminders').upsert(
        localRems.map((r) => ({
          id: r.id,
          book_id: r.book_id,
          loai_nhac: r.loai_nhac,
          ky_thang: r.ky_thang ?? '',
          tieu_de: r.tieu_de,
          noi_dung: r.noi_dung ?? '',
          so_tien_du_kien: r.so_tien_du_kien ?? null,
          ngay_bat_dau_nhac: r.ngay_bat_dau_nhac,
          trang_thai: r.trang_thai,
          matched_transaction_id: r.matched_transaction_id ?? null,
          updated_at: r.updated_at,
        })),
        { onConflict: 'book_id,loai_nhac,ky_thang' }
      );
      this.raiseIfError(error, 'Đồng bộ thẻ nhắc');
      pushedCounts.reminders = localRems.length;
    }

    if (localLogs.length > 0) {
      const { error } = await client.from('chat_logs').upsert(
        localLogs.map((l) => {
          let parsed: unknown = l.ai_json ?? null;
          if (typeof l.ai_json === 'string') {
            try {
              parsed = JSON.parse(l.ai_json);
            } catch {
              parsed = { raw: l.ai_json };
            }
          }
          return {
            id: l.id,
            book_id: l.book_id,
            timestamp: l.timestamp,
            nguoi_dung: l.nguoi_dung,
            nguon: l.nguon,
            cau_noi: l.cau_noi,
            ai_json: parsed,
            ket_qua: l.ket_qua,
          };
        }),
        { onConflict: 'id' }
      );
      this.raiseIfError(error, 'Đồng bộ nhật ký hội thoại');
      pushedCounts.chat_logs = localLogs.length;
    }

    const totalRows = Object.values(pushedCounts).reduce((s, n) => s + n, 0);
    return {
      bookId,
      pushedCounts,
      totalRows,
    };
  }

  async getAiSettings(_actor?: AuthSession | null): Promise<AiSettings> {
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('ai_settings')
          .select('*')
          .eq('id', 'default')
          .maybeSingle();

        if (!error && data) {
          const settings: AiSettings = {
            id: data.id || 'default',
            provider: data.provider || 'gemini',
            api_key: data.api_key || '',
            model: data.model || 'gemini-3.8-flash',
            endpoint: data.endpoint || '',
            temperature: typeof data.temperature === 'number' ? data.temperature : 0.1,
            enabled: data.enabled ?? true,
            updated_at: data.updated_at,
          };
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('sobep_ai_settings_v1', JSON.stringify(settings));
          }
          return settings;
        }
      } catch {
        // Table chưa tạo hoặc lỗi mạng -> rơi xuống cache máy
      }
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem('sobep_ai_settings_v1');
        if (cached) {
          return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(cached) };
        }
      }
    } catch {
      // Ignore
    }
    return { ...DEFAULT_AI_SETTINGS };
  }

  async saveAiSettings(
    actorOrSettings: AuthSession | null | AiSettings,
    maybeSettings?: AiSettings
  ): Promise<AiSettings> {
    const actor =
      actorOrSettings && typeof actorOrSettings === 'object' && 'vai_tro' in actorOrSettings
        ? (actorOrSettings as AuthSession)
        : null;
    const settings =
      maybeSettings ??
      (actorOrSettings && typeof actorOrSettings === 'object' && 'provider' in actorOrSettings
        ? (actorOrSettings as AiSettings)
        : DEFAULT_AI_SETTINGS);

    const toSave: AiSettings = {
      ...settings,
      id: 'default',
      updated_at: new Date().toISOString(),
    };

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sobep_ai_settings_v1', JSON.stringify(toSave));
      }
    } catch {
      // Ignore
    }

    if (this.client) {
      try {
        const { error } = await this.client.from('ai_settings').upsert(
          {
            id: 'default',
            provider: toSave.provider,
            api_key: toSave.api_key,
            model: toSave.model,
            endpoint: toSave.endpoint || '',
            temperature: toSave.temperature ?? 0.1,
            enabled: toSave.enabled,
            updated_at: toSave.updated_at,
            updated_by: actor?.profile_id || 'admin',
          },
          { onConflict: 'id' }
        );
        if (error) {
          console.warn('Lưu ai_settings lên Supabase:', error.message);
        }
      } catch (err) {
        console.warn('Lỗi mạng khi lưu ai_settings lên Supabase:', err);
      }
    }

    return toSave;
  }
}
