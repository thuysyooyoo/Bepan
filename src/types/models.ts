export type BookId = 'hiep_hoa' | 'tien_du';
export type UserRole = 'owner' | 'admin';
export type MealPeriod = 'sang' | 'trua' | 'toi';
export type GuestType = 'truong' | 'vang_lai';
export type BusinessSegment = 'bep_an' | 'can_tin' | 'chung';
export type WalletKind = 'tien_mat' | 'tk_mo_diep' | 'tk_chi_nhan';
export type EntrySource = 'giong' | 'chat' | 'tay';
export type CategoryGroup = 'thu' | 'chi' | 'dong_tien';
export type CategoryCalcMode = 'theo_ngay' | 'theo_thang' | 'khong_tinh_lai';

export type TransactionType =
  | 'thu_cuoi_ngay' // Tổng tiền thu cuối ngày (Cách A: tự trừ vãng lai ra doanh thu Căn tin)
  | 'thu'           // Thu trực tiếp khác
  | 'chi'           // Chi trả ngay (tính Lãi lỗ + trừ Ví thực tế)
  | 'chi_no'        // Mua chịu nhà cung cấp (tính Lãi lỗ + tăng Sổ nợ, KHÔNG trừ Ví)
  | 'tra_no'        // Trả nợ nhà cung cấp (trừ Ví + giảm Sổ nợ, KHÔNG tính lại Lãi lỗ)
  | 'truong_chuyen' // Nhà trường chuyển tiền ăn về TK mợ Diệp (cộng Ví + đối trừ dự kiến trường)
  | 'tra_luong'     // Trả/ứng lương công nhân (trừ Ví + đối trừ lương phải trả)
  | 'chuyen_quy'    // Chuyển tiền giữa 2 ví cùng cơ sở
  | 'dieu_chinh_vi';// Kiểm đếm thực tế lệch sổ -> điều chỉnh ví

export type ReminderType =
  | 'nhap_so_ngay'
  | 'truong_chuyen_tien'
  | 'tra_luong'
  | 'chi_phi_thang'
  | 'no_qua_han';

export interface Book {
  id: BookId;
  ten: string;
  dia_diem: string;
  chu_so: string;
  gio_nhac_hang_ngay: string; // HH:mm, mặc định '18:00'
  ngay_nhac_truong_chuyen: number; // 1..28, mặc định 20
  so_ngay_nhac_no_ncc: number; // số ngày mua chịu chưa trả sẽ nhắc, mặc định 15
  created_at: string;
}

export interface UserProfile {
  id: string;
  ten_hien_thi: string;
  xung_ho: string; // "Bố", "Mẹ", "Con (Admin)"
  mo_ta: string;
  vai_tro: UserRole;
  book_id: BookId | null; // null cho Admin (xem được cả hai)
  virtual_email: string;
  avatar_emoji: string;
  pin_salt: string;
  pin_hash: string; // SHA-256(salt + ':' + pin), không bao giờ lưu plaintext
}

export interface AuthSession {
  profile_id: string;
  ten_hien_thi: string;
  xung_ho: string;
  vai_tro: UserRole;
  book_id: BookId | null;
  avatar_emoji: string;
  created_at: number;
  expires_at: number; // 90 ngày
}

export interface MealPrice {
  id: string;
  book_id: BookId;
  bua: MealPeriod;
  loai_khach: GuestType;
  don_gia: number;
  ap_dung_tu_ngay: string; // YYYY-MM-DD
  ghi_chu?: string;
}

export interface MealCount {
  id: string;
  book_id: BookId;
  ngay: string; // YYYY-MM-DD
  bua: MealPeriod;
  suat_truong: number;
  suat_vang_lai: number;
  ghi_chu?: string;
  nguon: EntrySource;
  nguoi_tao: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  book_id: BookId;
  ho_ten: string;
  luong_ngay: number;
  dang_lam: boolean;
  ghi_chu?: string;
}

export interface Attendance {
  id: string;
  book_id: BookId;
  worker_id: string;
  ngay: string; // YYYY-MM-DD
  so_cong: 0 | 0.5 | 1 | 1.5 | 2;
  don_gia_cong: number; // Chốt lương/ngày tại thời điểm chấm công
  ghi_chu?: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  book_id: BookId;
  loai_vi: WalletKind;
  ten_vi: string;
  chu_tai_khoan: string;
  so_du_dau_ky: number;
  thu_tu: number;
}

export interface Supplier {
  id: string;
  book_id: BookId;
  ten_ncc: string;
  mat_hang_chinh: string;
  so_dien_thoai?: string;
  no_dau_ky: number;
  dang_giao_dich: boolean;
  ghi_chu?: string;
}

export interface Category {
  id: string;
  ten_danh_muc: string;
  nhom: CategoryGroup;
  kieu_tinh: CategoryCalcMode;
  mang_mac_dinh: BusinessSegment;
  icon: string;
  tu_khoa_ai: string[];
  thu_tu: number;
}

export interface Transaction {
  id: string;
  book_id: BookId;
  ngay: string; // YYYY-MM-DD
  timestamp: string; // ISO string
  mang: BusinessSegment;
  loai: TransactionType;
  category_id: string;
  so_tien: number;
  wallet_id: string | null; // null khi mua chịu (chi_no)
  to_wallet_id?: string | null; // dùng khi chuyen_quy
  supplier_id?: string | null;  // dùng khi chi_no / tra_no
  worker_id?: string | null;    // tùy chọn khi ứng/trả lương
  ky_thang?: string | null;     // YYYY-MM (cho chi phí tháng, trường chuyển, trả lương)
  ghi_chu: string;
  cau_noi_goc?: string;
  nguon: EntrySource;
  nguoi_tao: string;
  da_xoa: boolean;
  deleted_at?: string | null;
}

export interface Reminder {
  id: string;
  book_id: BookId;
  loai_nhac: ReminderType;
  ky_thang: string; // YYYY-MM hoặc YYYY-MM-DD
  tieu_de: string;
  noi_dung: string;
  so_tien_du_kien?: number;
  ngay_bat_dau_nhac: string; // YYYY-MM-DD
  trang_thai: 'dang_nhac' | 'xong' | 'bo_qua';
  matched_transaction_id?: string | null;
  updated_at: string;
}

export interface ChatLog {
  id: string;
  book_id: BookId;
  timestamp: string;
  nguoi_dung: string;
  nguon: 'giong' | 'chat';
  cau_noi: string;
  ai_json: unknown;
  ket_qua: 'cho_xac_nhan' | 'da_luu' | 'da_sua' | 'huy';
}

export interface BookSnapshot {
  book: Book;
  mealPrices: MealPrice[];
  mealCounts: MealCount[];
  workers: Worker[];
  attendance: Attendance[];
  wallets: Wallet[];
  suppliers: Supplier[];
  categories: Category[];
  transactions: Transaction[];
  reminders: Reminder[];
}
