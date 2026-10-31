import type {
  Attendance,
  AuthSession,
  Book,
  BookId,
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
import type {
  CloudSyncStatus,
  DataRepository,
  LocalToCloudSyncResult,
} from './interface';
import { LocalDexieAdapter } from './localAdapter';
import { SupabaseAdapter } from './supabaseAdapter';

export class SmartDataRepository implements DataRepository {
  private local: LocalDexieAdapter;
  private cloud: SupabaseAdapter;
  private configuredMode: 'local' | 'supabase' | 'auto';
  private useCloud = false;

  constructor(options?: {
    mode?: 'local' | 'supabase' | 'auto';
    localAdapter?: LocalDexieAdapter;
    cloudAdapter?: SupabaseAdapter;
  }) {
    this.local = options?.localAdapter ?? new LocalDexieAdapter();
    this.cloud =
      options?.cloudAdapter ??
      new SupabaseAdapter({
        localMirrorDb: this.local.getDexieInstance(),
      });

    const isTestEnv = import.meta.env?.MODE === 'test';
    const rawEnvMode = String(
      options?.mode ?? import.meta.env?.VITE_DATA_ADAPTER ?? (isTestEnv ? 'local' : 'auto')
    )
      .trim()
      .toLowerCase();

    if (rawEnvMode === 'supabase') {
      this.configuredMode = 'supabase';
      this.useCloud = true;
    } else if (rawEnvMode === 'local') {
      this.configuredMode = 'local';
      this.useCloud = false;
    } else {
      this.configuredMode = 'auto';
      this.useCloud = false;
    }
  }

  get mode(): 'local' | 'supabase' {
    return this.useCloud ? 'supabase' : 'local';
  }

  private active(): DataRepository {
    return this.useCloud ? this.cloud : this.local;
  }

  async ensureInitialized(): Promise<void> {
    await this.local.ensureInitialized();
    if (this.configuredMode === 'local') {
      this.useCloud = false;
      return;
    }
    if (this.configuredMode === 'supabase') {
      this.useCloud = true;
      await this.cloud.ensureInitialized();
      return;
    }
    // Chế độ 'auto': tự kích hoạt Supabase ngay khi bảng & RLS đã sẵn sàng trên Cloud
    if (this.cloud.isConfigured()) {
      const status = await this.cloud.checkCloudReady();
      this.useCloud = status.connected;
    } else {
      this.useCloud = false;
    }
  }

  async getCloudSyncStatus(forceRefresh = false): Promise<CloudSyncStatus> {
    if (this.configuredMode === 'local') {
      return this.local.getCloudSyncStatus();
    }
    const status = await this.cloud.checkCloudReady(forceRefresh);
    if (this.configuredMode === 'auto') {
      this.useCloud = status.connected;
    }
    return status;
  }

  async hasValidAuthSession(actor: AuthSession): Promise<boolean> {
    const repo = this.active();
    return repo.hasValidAuthSession ? repo.hasValidAuthSession(actor) : true;
  }

  async signOutCloud(): Promise<void> {
    await this.cloud.signOutCloud();
  }

  async syncLocalBookToCloud(
    actor: AuthSession,
    bookId: BookId
  ): Promise<LocalToCloudSyncResult> {
    const status = await this.cloud.checkCloudReady(true);
    if (!status.connected) {
      throw new Error(
        'Bảng dữ liệu trên Supabase chưa sẵn sàng. Bạn hãy chạy file SQL khởi tạo trên Supabase trước nhé!'
      );
    }
    this.useCloud = true;
    return this.cloud.syncLocalBookToCloud(actor, bookId);
  }

  subscribeToBookChanges(bookId: BookId, onChanged: () => void): () => void {
    const repo = this.active();
    return repo.subscribeToBookChanges
      ? repo.subscribeToBookChanges(bookId, onChanged)
      : () => {};
  }

  listLoginProfiles() {
    return this.active().listLoginProfiles();
  }

  loginWithPin(profileId: string, pin: string) {
    return this.active().loginWithPin(profileId, pin);
  }

  changePin(actor: AuthSession, targetProfileId: string, newPin: string) {
    return this.active().changePin(actor, targetProfileId, newPin);
  }

  listAccessibleBooks(actor: AuthSession) {
    return this.active().listAccessibleBooks(actor);
  }

  getBookSnapshot(actor: AuthSession, bookId: BookId) {
    return this.active().getBookSnapshot(actor, bookId);
  }

  updateBookSettings(actor: AuthSession, book: Book) {
    return this.active().updateBookSettings(actor, book);
  }

  upsertMealCount(
    actor: AuthSession,
    entry: Omit<MealCount, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.active().upsertMealCount(actor, entry);
  }

  upsertMealPrice(
    actor: AuthSession,
    price: Omit<MealPrice, 'id'> & { id?: string }
  ) {
    return this.active().upsertMealPrice(actor, price);
  }

  upsertWorker(actor: AuthSession, worker: Omit<Worker, 'id'> & { id?: string }) {
    return this.active().upsertWorker(actor, worker);
  }

  upsertAttendance(
    actor: AuthSession,
    att: Omit<Attendance, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.active().upsertAttendance(actor, att);
  }

  upsertSupplier(
    actor: AuthSession,
    supplier: Omit<Supplier, 'id'> & { id?: string }
  ) {
    return this.active().upsertSupplier(actor, supplier);
  }

  upsertCategory(actor: AuthSession, category: Category) {
    return this.active().upsertCategory(actor, category);
  }

  updateWallet(actor: AuthSession, wallet: Wallet) {
    return this.active().updateWallet(actor, wallet);
  }

  addTransaction(
    actor: AuthSession,
    tx: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'> & {
      id?: string;
      timestamp?: string;
    }
  ) {
    return this.active().addTransaction(actor, tx);
  }

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
  ) {
    return this.active().saveDailyCollection(actor, params);
  }

  updateTransaction(actor: AuthSession, tx: Transaction) {
    return this.active().updateTransaction(actor, tx);
  }

  softDeleteTransaction(actor: AuthSession, bookId: BookId, txId: string) {
    return this.active().softDeleteTransaction(actor, bookId, txId);
  }

  restoreTransaction(actor: AuthSession, bookId: BookId, txId: string) {
    return this.active().restoreTransaction(actor, bookId, txId);
  }

  upsertReminder(
    actor: AuthSession,
    reminder: Omit<Reminder, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.active().upsertReminder(actor, reminder);
  }

  addChatLog(actor: AuthSession, log: Omit<ChatLog, 'id' | 'timestamp'>) {
    return this.active().addChatLog(actor, log);
  }

  updateChatLogStatus(
    actor: AuthSession,
    bookId: BookId,
    logId: string,
    ketQua: ChatLog['ket_qua']
  ) {
    return this.active().updateChatLogStatus(actor, bookId, logId, ketQua);
  }

  listChatLogs(actor: AuthSession, bookId: BookId, limit?: number) {
    return this.active().listChatLogs(actor, bookId, limit);
  }
}

export const dbRepo: DataRepository = new SmartDataRepository();

export * from './interface';
export { LocalDexieAdapter } from './localAdapter';
export { SupabaseAdapter } from './supabaseAdapter';
