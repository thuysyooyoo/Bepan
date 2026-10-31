import { generateId } from '../domain/format';
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
import type { OfflineMutationOp, OfflineOutboxItem } from './dexieDb';
import {
  assertAdmin,
  assertCanAccessBook,
  type CloudSyncStatus,
  type DataRepository,
  type LocalToCloudSyncResult,
  type OfflineQueueStatus,
  PermissionDeniedError,
} from './interface';
import { LocalDexieAdapter } from './localAdapter';
import { SupabaseAdapter } from './supabaseAdapter';

const CLOUD_PAIRED_STORAGE_KEY = 'sobep_cloud_paired_v1';

interface DailyCollectionSyncPayload {
  book_id: BookId;
  ngay: string;
  replacedIds: string[];
  createdTransactions: Transaction[];
}

function readCloudPairedFlag(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(CLOUD_PAIRED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCloudPairedFlag(paired: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (paired) localStorage.setItem(CLOUD_PAIRED_STORAGE_KEY, '1');
    else localStorage.removeItem(CLOUD_PAIRED_STORAGE_KEY);
  } catch {
    // Ignore storage quota / node env
  }
}

export function isLikelyNetworkError(err: unknown): boolean {
  if (err instanceof PermissionDeniedError) return false;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (
    /mã pin|không có quyền|chặn bảo mật rls|không tìm thấy ví|không thuộc sổ/i.test(
      msg
    )
  ) {
    return false;
  }
  return (
    err instanceof TypeError ||
    /failed to fetch|fetch failed|network|offline|timeout|load failed|err_internet|econn|enotfound|socket|502|503|504|mất kết nối/i.test(
      msg
    )
  );
}

export class SmartDataRepository implements DataRepository {
  private local: LocalDexieAdapter;
  private cloud: SupabaseAdapter;
  private configuredMode: 'local' | 'supabase' | 'auto';
  private useCloud = false;
  private onlineChecker: () => boolean;
  private isSyncingOutbox = false;
  private lastSyncedAt: string | null = null;
  private lastSyncError: string | null = null;
  private flushMutex: Promise<{ syncedCount: number; remainingCount: number }> | null =
    null;
  private lastKnownActor: AuthSession | null = null;
  private outboxSeq = 0;
  private offlineListeners = new Set<(status: OfflineQueueStatus) => void>();
  private bookChangeNotifiers = new Map<BookId, Set<() => void>>();

  constructor(options?: {
    mode?: 'local' | 'supabase' | 'auto';
    localAdapter?: LocalDexieAdapter;
    cloudAdapter?: SupabaseAdapter;
    isOnline?: () => boolean;
  }) {
    this.local = options?.localAdapter ?? new LocalDexieAdapter();
    this.cloud =
      options?.cloudAdapter ??
      new SupabaseAdapter({
        localMirrorDb: this.local.getDexieInstance(),
      });

    this.onlineChecker =
      options?.isOnline ??
      (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

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

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.emitOfflineStatus();
        if (this.useCloud && this.lastKnownActor) {
          void this.flushOfflineOutbox(this.lastKnownActor);
        }
      });
      window.addEventListener('offline', () => {
        void this.emitOfflineStatus();
      });
    }
  }

  get mode(): 'local' | 'supabase' {
    return this.useCloud ? 'supabase' : 'local';
  }

  private isNetworkOnline(): boolean {
    try {
      return Boolean(this.onlineChecker());
    } catch {
      return true;
    }
  }

  private rememberActor(actor: AuthSession): void {
    if (actor && actor.expires_at > Date.now()) {
      this.lastKnownActor = actor;
    }
  }

  private notifyBookListeners(bookId: BookId): void {
    const subs = this.bookChangeNotifiers.get(bookId);
    if (!subs) return;
    for (const cb of subs) {
      try {
        cb();
      } catch {
        // Ignore listener error
      }
    }
  }

  async getOfflineQueueStatus(): Promise<OfflineQueueStatus> {
    await this.local.ensureInitialized();
    const outboxTable = this.local.getDexieInstance().offline_outbox;
    const pendingCount = outboxTable ? await outboxTable.count() : 0;
    return {
      isOnline: this.isNetworkOnline(),
      pendingCount,
      isSyncing: this.isSyncingOutbox,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastSyncError,
    };
  }

  private async emitOfflineStatus(): Promise<void> {
    if (this.offlineListeners.size === 0) return;
    const status = await this.getOfflineQueueStatus();
    for (const listener of this.offlineListeners) {
      try {
        listener(status);
      } catch {
        // Ignore subscriber error
      }
    }
  }

  subscribeToOfflineStatus(listener: (status: OfflineQueueStatus) => void): () => void {
    this.offlineListeners.add(listener);
    void this.getOfflineQueueStatus().then((st) => {
      if (this.offlineListeners.has(listener)) {
        listener(st);
      }
    });
    return () => {
      this.offlineListeners.delete(listener);
    };
  }

  private async enqueueOutboxItem(
    actor: AuthSession,
    bookId: BookId,
    op: OfflineMutationOp,
    payload: unknown
  ): Promise<void> {
    const db = this.local.getDexieInstance();
    this.outboxSeq += 1;
    const monotonicCreatedAt = `${new Date().toISOString()}#${String(
      this.outboxSeq
    ).padStart(8, '0')}`;
    const item: OfflineOutboxItem = {
      id: generateId(),
      book_id: bookId,
      op,
      payload,
      actor_profile_id: actor.profile_id,
      created_at: monotonicCreatedAt,
      retry_count: 0,
      last_error: null,
    };
    await db.offline_outbox.put(item);
    await this.emitOfflineStatus();
  }

  private async replaySingleOutboxItem(
    actor: AuthSession,
    item: OfflineOutboxItem
  ): Promise<void> {
    switch (item.op) {
      case 'updateBookSettings':
        await this.cloud.updateBookSettings(actor, item.payload as Book);
        return;
      case 'upsertMealCount':
        await this.cloud.upsertMealCount(actor, item.payload as MealCount);
        return;
      case 'upsertMealPrice':
        await this.cloud.upsertMealPrice(actor, item.payload as MealPrice);
        return;
      case 'upsertWorker':
        await this.cloud.upsertWorker(actor, item.payload as Worker);
        return;
      case 'upsertAttendance':
        await this.cloud.upsertAttendance(actor, item.payload as Attendance);
        return;
      case 'upsertSupplier':
        await this.cloud.upsertSupplier(actor, item.payload as Supplier);
        return;
      case 'upsertCategory':
        await this.cloud.upsertCategory(actor, item.payload as Category);
        return;
      case 'updateWallet':
        await this.cloud.updateWallet(actor, item.payload as Wallet);
        return;
      case 'addTransaction':
        await this.cloud.addTransaction(actor, item.payload as Transaction);
        return;
      case 'saveDailyCollectionSynced':
        await this.cloud.replayOfflineDailyCollection(
          actor,
          item.payload as DailyCollectionSyncPayload
        );
        return;
      case 'updateTransaction':
        await this.cloud.updateTransaction(actor, item.payload as Transaction);
        return;
      case 'softDeleteTransaction': {
        const p = item.payload as { bookId: BookId; txId: string };
        try {
          await this.cloud.softDeleteTransaction(actor, p.bookId, p.txId);
        } catch (err) {
          // Nếu giao dịch tạo offline rồi bị xóa offline trước khi kịp lên mây thì bỏ qua an toàn
          if (!(err instanceof PermissionDeniedError)) throw err;
        }
        return;
      }
      case 'restoreTransaction': {
        const p = item.payload as { bookId: BookId; txId: string };
        await this.cloud.restoreTransaction(actor, p.bookId, p.txId);
        return;
      }
      case 'upsertReminder':
        await this.cloud.upsertReminder(actor, item.payload as Reminder);
        return;
      case 'addChatLog':
        await this.cloud.addChatLog(actor, item.payload as ChatLog);
        return;
      case 'updateChatLogStatus': {
        const p = item.payload as {
          bookId: BookId;
          logId: string;
          ketQua: ChatLog['ket_qua'];
        };
        await this.cloud.updateChatLogStatus(actor, p.bookId, p.logId, p.ketQua);
        return;
      }
    }
  }

  /**
   * Đẩy toàn bộ các mục ghi khi mất mạng trong `offline_outbox` lên Supabase theo đúng thứ tự FIFO.
   * Khóa Mutex chống chạy chồng chéo khi mạng chập chờn.
   */
  async flushOfflineOutbox(
    actor: AuthSession
  ): Promise<{ syncedCount: number; remainingCount: number }> {
    this.rememberActor(actor);
    await this.local.ensureInitialized();
    const db = this.local.getDexieInstance();

    if (!this.useCloud || !this.isNetworkOnline()) {
      const remainingCount = await db.offline_outbox.count();
      return { syncedCount: 0, remainingCount };
    }

    if (this.flushMutex) {
      return this.flushMutex;
    }

    this.flushMutex = (async () => {
      this.isSyncingOutbox = true;
      this.lastSyncError = null;
      await this.emitOfflineStatus();

      let syncedCount = 0;
      const touchedBooks = new Set<BookId>();

      try {
        const allItems = await db.offline_outbox.orderBy('created_at').toArray();
        const accessibleItems = allItems.filter(
          (it) => actor.vai_tro === 'admin' || actor.book_id === it.book_id
        );

        for (const item of accessibleItems) {
          if (!this.isNetworkOnline()) break;
          try {
            await this.replaySingleOutboxItem(actor, item);
            await db.offline_outbox.delete(item.id);
            syncedCount += 1;
            touchedBooks.add(item.book_id);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await db.offline_outbox.update(item.id, {
              retry_count: (item.retry_count ?? 0) + 1,
              last_error: errMsg,
            });
            this.lastSyncError = errMsg;
            // Dừng tại mục lỗi mạng để bảo toàn thứ tự nhân quả (FK) cho lần thử lại tiếp theo
            if (isLikelyNetworkError(err)) {
              break;
            }
          }
        }

        if (syncedCount > 0) {
          this.lastSyncedAt = new Date().toISOString();
        }
      } finally {
        this.isSyncingOutbox = false;
        this.flushMutex = null;
        await this.emitOfflineStatus();
        for (const bid of touchedBooks) {
          this.notifyBookListeners(bid);
        }
      }

      const remainingCount = await db.offline_outbox.count();
      return { syncedCount, remainingCount };
    })();

    return this.flushMutex;
  }

  /**
   * Thực thi ghi dữ liệu chuẩn Offline-First:
   * - Luôn ghi vào IndexedDB trước để kiểm tra quyền & giữ dữ liệu tức thì (< 5ms).
   * - Nếu đang ở chế độ Đám mây và có mạng: đẩy tiếp lên Supabase.
   * - Nếu mất mạng hoặc lỗi đường truyền: xếp vào `offline_outbox` chờ mạng tự đẩy lên sau.
   */
  private async runOfflineCapableWrite<T>(
    actor: AuthSession,
    bookId: BookId,
    op: OfflineMutationOp,
    localWrite: () => Promise<{ result: T; outboxPayload: unknown }>,
    cloudWrite: (localResult: T, outboxPayload: unknown) => Promise<T>
  ): Promise<T> {
    this.rememberActor(actor);
    const { result: localResult, outboxPayload } = await localWrite();

    if (!this.useCloud) {
      return localResult;
    }

    if (!this.isNetworkOnline()) {
      await this.enqueueOutboxItem(actor, bookId, op, outboxPayload);
      return localResult;
    }

    // Nếu còn hàng đợi cũ thì đẩy hết trước để bảo toàn thứ tự FK (VD: thêm mối hàng mới -> mua chịu)
    const pendingBefore = await this.local.getDexieInstance().offline_outbox.count();
    if (pendingBefore > 0) {
      await this.flushOfflineOutbox(actor);
      const stillPending = await this.local.getDexieInstance().offline_outbox.count();
      if (stillPending > 0) {
        await this.enqueueOutboxItem(actor, bookId, op, outboxPayload);
        return localResult;
      }
    }

    try {
      const cloudResult = await cloudWrite(localResult, outboxPayload);
      this.lastSyncedAt = new Date().toISOString();
      this.lastSyncError = null;
      return cloudResult;
    } catch (err) {
      if (err instanceof PermissionDeniedError || !isLikelyNetworkError(err)) {
        throw err;
      }
      await this.enqueueOutboxItem(actor, bookId, op, outboxPayload);
      return localResult;
    }
  }

  async ensureInitialized(): Promise<void> {
    await this.local.ensureInitialized();
    if (this.configuredMode === 'local') {
      this.useCloud = false;
      return;
    }
    if (this.configuredMode === 'supabase') {
      this.useCloud = true;
      if (this.isNetworkOnline()) {
        await this.cloud.ensureInitialized();
      }
      return;
    }
    // Chế độ 'auto': tự kích hoạt Supabase khi bảng sẵn sàng, hoặc giữ chế độ Cloud-Offline nếu đã ghép nối trước đó
    if (this.cloud.isConfigured()) {
      if (!this.isNetworkOnline()) {
        const pending = await this.local.getDexieInstance().offline_outbox.count();
        this.useCloud = readCloudPairedFlag() || pending > 0;
        return;
      }
      const status = await this.cloud.checkCloudReady();
      if (status.connected) {
        writeCloudPairedFlag(true);
        this.useCloud = true;
      } else if (/mất kết nối mạng/i.test(status.message) && readCloudPairedFlag()) {
        this.useCloud = true;
      } else {
        this.useCloud = false;
      }
    } else {
      this.useCloud = false;
    }
  }

  async getCloudSyncStatus(forceRefresh = false): Promise<CloudSyncStatus> {
    if (this.configuredMode === 'local') {
      return this.local.getCloudSyncStatus();
    }
    if (!this.isNetworkOnline() && this.useCloud) {
      const pending = await this.local.getDexieInstance().offline_outbox.count();
      return {
        configured: this.cloud.isConfigured(),
        connected: false,
        mode: 'supabase',
        supabaseUrl: '',
        message:
          pending > 0
            ? `Đang mất mạng — đã lưu an toàn ${pending} mục trên máy, có mạng sẽ tự đẩy lên Đám mây.`
            : 'Đang mất mạng — dùng bản sao trên máy, có mạng sẽ tự đồng bộ Đám mây.',
      };
    }
    const status = await this.cloud.checkCloudReady(forceRefresh);
    if (status.connected) {
      writeCloudPairedFlag(true);
    }
    if (this.configuredMode === 'auto') {
      if (status.connected) {
        this.useCloud = true;
      } else if (!this.isNetworkOnline() && readCloudPairedFlag()) {
        this.useCloud = true;
      } else {
        this.useCloud = false;
      }
    }
    return status;
  }

  async hasValidAuthSession(actor: AuthSession): Promise<boolean> {
    if (!actor || actor.expires_at <= Date.now()) return false;
    this.rememberActor(actor);
    if (!this.useCloud) {
      return this.local.hasValidAuthSession(actor);
    }
    // Khi đang mất mạng, giữ nguyên phiên 90 ngày để ông bà vẫn mở sổ ghi chép bình thường
    if (!this.isNetworkOnline()) {
      return true;
    }
    try {
      return await this.cloud.hasValidAuthSession(actor);
    } catch (err) {
      if (isLikelyNetworkError(err)) return true;
      return false;
    }
  }

  async signOutCloud(): Promise<void> {
    this.lastKnownActor = null;
    if (this.isNetworkOnline()) {
      await this.cloud.signOutCloud();
    }
  }

  async syncLocalBookToCloud(
    actor: AuthSession,
    bookId: BookId
  ): Promise<LocalToCloudSyncResult> {
    this.rememberActor(actor);
    const status = await this.cloud.checkCloudReady(true);
    if (!status.connected) {
      throw new Error(
        'Bảng dữ liệu trên Supabase chưa sẵn sàng. Bạn hãy chạy file SQL khởi tạo trên Supabase trước nhé!'
      );
    }
    writeCloudPairedFlag(true);
    this.useCloud = true;
    const res = await this.cloud.syncLocalBookToCloud(actor, bookId);
    // Xóa các mục outbox của cơ sở này vì toàn bộ dữ liệu mới nhất trên máy vừa được đẩy lên mây
    await this.local
      .getDexieInstance()
      .offline_outbox.where('book_id')
      .equals(bookId)
      .delete();
    await this.emitOfflineStatus();
    return res;
  }

  subscribeToBookChanges(bookId: BookId, onChanged: () => void): () => void {
    let set = this.bookChangeNotifiers.get(bookId);
    if (!set) {
      set = new Set();
      this.bookChangeNotifiers.set(bookId, set);
    }
    set.add(onChanged);

    const repo = this.useCloud ? this.cloud : this.local;
    const unsubUnderlying = repo.subscribeToBookChanges
      ? repo.subscribeToBookChanges(bookId, onChanged)
      : () => {};

    return () => {
      unsubUnderlying();
      const s = this.bookChangeNotifiers.get(bookId);
      if (s) {
        s.delete(onChanged);
        if (s.size === 0) this.bookChangeNotifiers.delete(bookId);
      }
    };
  }

  async listLoginProfiles() {
    if (!this.useCloud || !this.isNetworkOnline()) {
      return this.local.listLoginProfiles();
    }
    try {
      return await this.cloud.listLoginProfiles();
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        return this.local.listLoginProfiles();
      }
      throw err;
    }
  }

  async loginWithPin(profileId: string, pin: string) {
    if (!this.useCloud) {
      const s = await this.local.loginWithPin(profileId, pin);
      this.rememberActor(s);
      return s;
    }
    if (!this.isNetworkOnline()) {
      const s = await this.local.loginWithPin(profileId, pin);
      this.rememberActor(s);
      return s;
    }
    const session = await this.cloud.loginWithPin(profileId, pin);
    this.rememberActor(session);
    void this.flushOfflineOutbox(session);
    return session;
  }

  async changePin(actor: AuthSession, targetProfileId: string, newPin: string) {
    this.rememberActor(actor);
    if (!this.useCloud) {
      return this.local.changePin(actor, targetProfileId, newPin);
    }
    await this.cloud.changePin(actor, targetProfileId, newPin);
    try {
      await this.local.changePin(actor, targetProfileId, newPin);
    } catch {
      // Ignore if local profile table differs
    }
  }

  async listAccessibleBooks(actor: AuthSession) {
    this.rememberActor(actor);
    if (!this.useCloud || !this.isNetworkOnline()) {
      return this.local.listAccessibleBooks(actor);
    }
    try {
      return await this.cloud.listAccessibleBooks(actor);
    } catch (err) {
      if (err instanceof PermissionDeniedError || !isLikelyNetworkError(err)) {
        throw err;
      }
      return this.local.listAccessibleBooks(actor);
    }
  }

  async getBookSnapshot(actor: AuthSession, bookId: BookId): Promise<BookSnapshot> {
    assertCanAccessBook(actor, bookId);
    this.rememberActor(actor);

    if (!this.useCloud) {
      return this.local.getBookSnapshot(actor, bookId);
    }

    const outbox = this.local.getDexieInstance().offline_outbox;

    if (!this.isNetworkOnline()) {
      return this.local.getBookSnapshot(actor, bookId);
    }

    // Nếu còn mục ghi lúc mất mạng thì đẩy lên Supabase trước khi tải snapshot mới
    const pendingTotal = await outbox.count();
    if (pendingTotal > 0) {
      await this.flushOfflineOutbox(actor);
    }

    const pendingForBook = await outbox.where('book_id').equals(bookId).count();
    if (pendingForBook > 0) {
      // Giữ nguyên dữ liệu Read-Your-Own-Writes trên máy cho tới khi hàng đợi đẩy xong 100%
      return this.local.getBookSnapshot(actor, bookId);
    }

    try {
      const cloudSnap = await this.cloud.getBookSnapshot(actor, bookId);
      await this.local.mirrorBookSnapshotFromCloud(cloudSnap);
      return cloudSnap;
    } catch (err) {
      if (err instanceof PermissionDeniedError || !isLikelyNetworkError(err)) {
        throw err;
      }
      return this.local.getBookSnapshot(actor, bookId);
    }
  }

  updateBookSettings(actor: AuthSession, book: Book) {
    return this.runOfflineCapableWrite(
      actor,
      book.id,
      'updateBookSettings',
      async () => {
        const saved = await this.local.updateBookSettings(actor, book);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.updateBookSettings(actor, saved)
    );
  }

  upsertMealCount(
    actor: AuthSession,
    entry: Omit<MealCount, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      entry.book_id,
      'upsertMealCount',
      async () => {
        const saved = await this.local.upsertMealCount(actor, entry);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertMealCount(actor, saved)
    );
  }

  upsertMealPrice(
    actor: AuthSession,
    price: Omit<MealPrice, 'id'> & { id?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      price.book_id,
      'upsertMealPrice',
      async () => {
        const saved = await this.local.upsertMealPrice(actor, price);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertMealPrice(actor, saved)
    );
  }

  upsertWorker(actor: AuthSession, worker: Omit<Worker, 'id'> & { id?: string }) {
    return this.runOfflineCapableWrite(
      actor,
      worker.book_id,
      'upsertWorker',
      async () => {
        const saved = await this.local.upsertWorker(actor, worker);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertWorker(actor, saved)
    );
  }

  upsertAttendance(
    actor: AuthSession,
    att: Omit<Attendance, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      att.book_id,
      'upsertAttendance',
      async () => {
        const saved = await this.local.upsertAttendance(actor, att);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertAttendance(actor, saved)
    );
  }

  upsertSupplier(
    actor: AuthSession,
    supplier: Omit<Supplier, 'id'> & { id?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      supplier.book_id,
      'upsertSupplier',
      async () => {
        const saved = await this.local.upsertSupplier(actor, supplier);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertSupplier(actor, saved)
    );
  }

  upsertCategory(actor: AuthSession, category: Category) {
    assertAdmin(actor);
    return this.runOfflineCapableWrite(
      actor,
      'hiep_hoa',
      'upsertCategory',
      async () => {
        const saved = await this.local.upsertCategory(actor, category);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertCategory(actor, saved)
    );
  }

  updateWallet(actor: AuthSession, wallet: Wallet) {
    return this.runOfflineCapableWrite(
      actor,
      wallet.book_id,
      'updateWallet',
      async () => {
        const saved = await this.local.updateWallet(actor, wallet);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.updateWallet(actor, saved)
    );
  }

  addTransaction(
    actor: AuthSession,
    tx: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'> & {
      id?: string;
      timestamp?: string;
    }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      tx.book_id,
      'addTransaction',
      async () => {
        const saved = await this.local.addTransaction(actor, tx);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.addTransaction(actor, saved)
    );
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
    return this.runOfflineCapableWrite(
      actor,
      params.book_id,
      'saveDailyCollectionSynced',
      async () => {
        const localRes = await this.local.saveDailyCollection(actor, params);
        const db = this.local.getDexieInstance();
        const createdTransactions = (
          await Promise.all(localRes.createdIds.map((id) => db.transactions.get(id)))
        ).filter((t): t is Transaction => Boolean(t));
        const syncPayload: DailyCollectionSyncPayload = {
          book_id: params.book_id,
          ngay: params.ngay,
          replacedIds: localRes.replacedIds,
          createdTransactions,
        };
        return { result: localRes, outboxPayload: syncPayload };
      },
      async (localRes, rawPayload) => {
        await this.cloud.replayOfflineDailyCollection(
          actor,
          rawPayload as DailyCollectionSyncPayload
        );
        return localRes;
      }
    );
  }

  updateTransaction(actor: AuthSession, tx: Transaction) {
    return this.runOfflineCapableWrite(
      actor,
      tx.book_id,
      'updateTransaction',
      async () => {
        const saved = await this.local.updateTransaction(actor, tx);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.updateTransaction(actor, saved)
    );
  }

  softDeleteTransaction(actor: AuthSession, bookId: BookId, txId: string) {
    return this.runOfflineCapableWrite(
      actor,
      bookId,
      'softDeleteTransaction',
      async () => {
        await this.local.softDeleteTransaction(actor, bookId, txId);
        return { result: undefined, outboxPayload: { bookId, txId } };
      },
      () => this.cloud.softDeleteTransaction(actor, bookId, txId)
    );
  }

  restoreTransaction(actor: AuthSession, bookId: BookId, txId: string) {
    return this.runOfflineCapableWrite(
      actor,
      bookId,
      'restoreTransaction',
      async () => {
        await this.local.restoreTransaction(actor, bookId, txId);
        return { result: undefined, outboxPayload: { bookId, txId } };
      },
      () => this.cloud.restoreTransaction(actor, bookId, txId)
    );
  }

  upsertReminder(
    actor: AuthSession,
    reminder: Omit<Reminder, 'id' | 'updated_at'> & { id?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      reminder.book_id,
      'upsertReminder',
      async () => {
        const saved = await this.local.upsertReminder(actor, reminder);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.upsertReminder(actor, saved)
    );
  }

  addChatLog(
    actor: AuthSession,
    log: Omit<ChatLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ) {
    return this.runOfflineCapableWrite(
      actor,
      log.book_id,
      'addChatLog',
      async () => {
        const saved = await this.local.addChatLog(actor, log);
        return { result: saved, outboxPayload: saved };
      },
      (saved) => this.cloud.addChatLog(actor, saved)
    );
  }

  updateChatLogStatus(
    actor: AuthSession,
    bookId: BookId,
    logId: string,
    ketQua: ChatLog['ket_qua']
  ) {
    return this.runOfflineCapableWrite(
      actor,
      bookId,
      'updateChatLogStatus',
      async () => {
        await this.local.updateChatLogStatus(actor, bookId, logId, ketQua);
        return { result: undefined, outboxPayload: { bookId, logId, ketQua } };
      },
      () => this.cloud.updateChatLogStatus(actor, bookId, logId, ketQua)
    );
  }

  async listChatLogs(actor: AuthSession, bookId: BookId, limit = 100) {
    assertCanAccessBook(actor, bookId);
    this.rememberActor(actor);

    if (!this.useCloud || !this.isNetworkOnline()) {
      return this.local.listChatLogs(actor, bookId, limit);
    }

    const pendingTotal = await this.local.getDexieInstance().offline_outbox.count();
    if (pendingTotal > 0) {
      await this.flushOfflineOutbox(actor);
    }

    try {
      const logs = await this.cloud.listChatLogs(actor, bookId, limit);
      if (logs.length > 0) {
        await this.local.getDexieInstance().chat_logs.bulkPut(logs);
      }
      return logs;
    } catch (err) {
      if (err instanceof PermissionDeniedError || !isLikelyNetworkError(err)) {
        throw err;
      }
      return this.local.listChatLogs(actor, bookId, limit);
    }
  }
}

export const dbRepo: DataRepository = new SmartDataRepository();

export * from './interface';
export { LocalDexieAdapter } from './localAdapter';
export { SupabaseAdapter } from './supabaseAdapter';
