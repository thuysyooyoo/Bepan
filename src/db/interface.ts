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
  UserProfile,
  Wallet,
  Worker,
} from '../types/models';

export class PermissionDeniedError extends Error {
  constructor(message = 'Bạn không có quyền truy cập sổ của cơ sở này.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export function assertCanAccessBook(actor: AuthSession | null, targetBookId: BookId): void {
  if (!actor) {
    throw new PermissionDeniedError('Phiên đăng nhập đã hết hạn. Vui lòng nhập lại mã PIN.');
  }
  if (actor.expires_at <= Date.now()) {
    throw new PermissionDeniedError('Phiên đăng nhập 90 ngày đã hết hạn. Vui lòng nhập lại mã PIN.');
  }
  if (actor.vai_tro === 'admin') {
    return;
  }
  if (actor.book_id !== targetBookId) {
    throw new PermissionDeniedError(
      `${actor.xung_ho} chỉ được xem và ghi trên sổ của cơ sở mình.`
    );
  }
}

export function assertAdmin(actor: AuthSession | null): void {
  if (!actor || actor.vai_tro !== 'admin' || actor.expires_at <= Date.now()) {
    throw new PermissionDeniedError('Chỉ tài khoản Quản lý (Admin) mới thực hiện được thao tác này.');
  }
}

export type PublicProfileSummary = Pick<
  UserProfile,
  'id' | 'ten_hien_thi' | 'xung_ho' | 'mo_ta' | 'vai_tro' | 'book_id' | 'avatar_emoji'
>;

export interface CloudSyncStatus {
  configured: boolean;
  connected: boolean;
  mode: 'local' | 'supabase';
  supabaseUrl: string;
  message: string;
}

export interface LocalToCloudSyncResult {
  bookId: BookId;
  pushedCounts: Record<string, number>;
  totalRows: number;
}

export interface OfflineQueueStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DataRepository {
  readonly mode: 'local' | 'supabase';

  /** Khởi tạo CSDL & nạp dữ liệu gốc lần đầu nếu trống */
  ensureInitialized(): Promise<void>;

  /** Lấy danh sách thẻ người dùng hiển thị trên màn hình chọn tài khoản (không lộ hash PIN) */
  listLoginProfiles(): Promise<PublicProfileSummary[]>;

  /** Xác thực bằng mã PIN 4 số -> trả về phiên đăng nhập có hạn 90 ngày */
  loginWithPin(profileId: string, pin: string): Promise<AuthSession>;

  /** Đổi mã PIN (chính chủ hoặc Admin) */
  changePin(actor: AuthSession, targetProfileId: string, newPin: string): Promise<void>;

  /** Lấy danh sách các sổ mà người dùng hiện tại được phép truy cập */
  listAccessibleBooks(actor: AuthSession): Promise<Book[]>;

  /** Lấy toàn bộ dữ liệu của 1 sổ cơ sở (kiểm tra quyền chặt chẽ) */
  getBookSnapshot(actor: AuthSession, bookId: BookId): Promise<BookSnapshot>;

  /** Cập nhật cài đặt chung của sổ (giờ nhắc, ngày nhắc trường chuyển, hạn nhắc nợ...) */
  updateBookSettings(actor: AuthSession, book: Book): Promise<Book>;

  /** Lưu / cập nhật suất ăn trong ngày */
  upsertMealCount(
    actor: AuthSession,
    entry: Omit<MealCount, 'id' | 'updated_at'> & { id?: string }
  ): Promise<MealCount>;

  /** Cài đặt đơn giá suất ăn mới theo ngày áp dụng */
  upsertMealPrice(
    actor: AuthSession,
    price: Omit<MealPrice, 'id'> & { id?: string }
  ): Promise<MealPrice>;

  /** Thêm / cập nhật công nhân */
  upsertWorker(
    actor: AuthSession,
    worker: Omit<Worker, 'id'> & { id?: string }
  ): Promise<Worker>;

  /** Lưu chấm công trong ngày */
  upsertAttendance(
    actor: AuthSession,
    att: Omit<Attendance, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Attendance>;

  /** Thêm / cập nhật nhà cung cấp */
  upsertSupplier(
    actor: AuthSession,
    supplier: Omit<Supplier, 'id'> & { id?: string }
  ): Promise<Supplier>;

  /** Thêm / cập nhật danh mục thu chi (chỉ Admin) */
  upsertCategory(actor: AuthSession, category: Category): Promise<Category>;

  /** Cập nhật số dư đầu kỳ hoặc tên ví */
  updateWallet(actor: AuthSession, wallet: Wallet): Promise<Wallet>;

  /** Ghi giao dịch mới (thu, chi, mua chịu, trả nợ, trường chuyển, trả lương, chuyển quỹ...) */
  addTransaction(
    actor: AuthSession,
    tx: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<Transaction>;

  /** Lưu trọn gói Tổng thu cuối ngày (Tiền mặt + CK chị Nhàn) chống trùng lặp trong cùng 1 ngày */
  saveDailyCollection(
    actor: AuthSession,
    params: {
      book_id: BookId;
      ngay: string;
      tien_mat: number;
      chuyen_khoan: number;
      ghi_chu?: string;
      nguon: 'giong' | 'chat' | 'tay';
    }
  ): Promise<{ createdIds: string[]; replacedIds: string[] }>;

  /** Sửa giao dịch */
  updateTransaction(actor: AuthSession, tx: Transaction): Promise<Transaction>;

  /** Xóa mềm giao dịch (có thể hoàn tác) */
  softDeleteTransaction(actor: AuthSession, bookId: BookId, txId: string): Promise<void>;

  /** Khôi phục giao dịch vừa xóa nhầm */
  restoreTransaction(actor: AuthSession, bookId: BookId, txId: string): Promise<void>;

  /** Cập nhật trạng thái thẻ nhắc việc */
  upsertReminder(
    actor: AuthSession,
    reminder: Omit<Reminder, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Reminder>;

  /** Lưu nhật ký AI chat */
  addChatLog(
    actor: AuthSession,
    log: Omit<ChatLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): Promise<ChatLog>;

  /** Cập nhật kết quả xác nhận nhật ký AI chat (đã lưu / đã sửa / hủy) */
  updateChatLogStatus(
    actor: AuthSession,
    bookId: BookId,
    logId: string,
    ketQua: ChatLog['ket_qua']
  ): Promise<void>;

  /** Lấy danh sách nhật ký câu nói AI chat của một cơ sở (mới nhất lên đầu) */
  listChatLogs(actor: AuthSession, bookId: BookId, limit?: number): Promise<ChatLog[]>;

  /** Đăng ký lắng nghe thay đổi Realtime 2 chiều của một sổ cơ sở -> trả về hàm hủy đăng ký */
  subscribeToBookChanges?(bookId: BookId, onChanged: () => void): () => void;

  /** Kiểm tra trạng thái kết nối Đám mây Supabase hiện tại */
  getCloudSyncStatus?(forceRefresh?: boolean): Promise<CloudSyncStatus>;

  /** Đẩy toàn bộ dữ liệu thử đang có trên máy (IndexedDB) của 1 sổ lên Supabase (chống trùng 100%) */
  syncLocalBookToCloud?(
    actor: AuthSession,
    bookId: BookId
  ): Promise<LocalToCloudSyncResult>;

  /** Kiểm tra phiên đăng nhập hiện tại có kèm JWT Supabase hợp lệ không (khi ở chế độ đám mây) */
  hasValidAuthSession?(actor: AuthSession): Promise<boolean>;

  /** Đăng xuất khỏi Supabase Auth (nếu đang dùng đám mây) */
  signOutCloud?(): Promise<void>;

  /** Kiểm tra hàng đợi Offline (số mục lưu tạm trên IndexedDB đang chờ mạng để tự đẩy lên) */
  getOfflineQueueStatus?(): Promise<OfflineQueueStatus>;

  /** Đẩy ngay các mục đang chờ trong hàng đợi Offline lên Supabase theo thứ tự FIFO */
  flushOfflineOutbox?(
    actor: AuthSession
  ): Promise<{ syncedCount: number; remainingCount: number }>;

  /** Lắng nghe sự thay đổi trạng thái mạng / hàng đợi Offline */
  subscribeToOfflineStatus?(listener: (status: OfflineQueueStatus) => void): () => void;
}
