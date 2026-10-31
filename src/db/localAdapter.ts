import { generateId, hashPinWithSalt } from '../domain/format';
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
  PermissionDeniedError,
  type PublicProfileSummary,
} from './interface';
import {
  buildSeedProfiles,
  SEED_BOOKS,
  SEED_CATEGORIES,
  SEED_MEAL_PRICES,
  SEED_SUPPLIERS,
  SEED_WALLETS,
  SEED_WORKERS,
} from './seed';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export class LocalDexieAdapter implements DataRepository {
  readonly mode = 'local' as const;
  private db: SoBepDexieDB;
  private initPromise: Promise<void> | null = null;

  constructor(dbName?: string) {
    this.db = new SoBepDexieDB(dbName);
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.seedIfEmpty();
    }
    return this.initPromise;
  }

  private async seedIfEmpty(): Promise<void> {
    const count = await this.db.books.count();
    if (count > 0) {
      // Bổ sung danh mục hệ thống mới (nếu nâng cấp phiên bản trên máy đã có dữ liệu)
      const existingIds = new Set((await this.db.categories.toArray()).map((c) => c.id));
      const missingCats = SEED_CATEGORIES.filter((c) => !existingIds.has(c.id));
      if (missingCats.length > 0) {
        await this.db.categories.bulkPut(missingCats);
      }
      return;
    }

    const profiles = await buildSeedProfiles();

    await this.db.transaction(
      'rw',
      [
        this.db.books,
        this.db.profiles,
        this.db.wallets,
        this.db.meal_prices,
        this.db.categories,
        this.db.workers,
        this.db.suppliers,
      ],
      async () => {
        const innerCount = await this.db.books.count();
        if (innerCount > 0) return;
        await this.db.books.bulkPut(SEED_BOOKS);
        await this.db.profiles.bulkPut(profiles);
        await this.db.wallets.bulkPut(SEED_WALLETS);
        await this.db.meal_prices.bulkPut(SEED_MEAL_PRICES);
        await this.db.categories.bulkPut(SEED_CATEGORIES);
        await this.db.workers.bulkPut(SEED_WORKERS);
        await this.db.suppliers.bulkPut(SEED_SUPPLIERS);
      }
    );
  }

  async listLoginProfiles(): Promise<PublicProfileSummary[]> {
    await this.ensureInitialized();
    const all = await this.db.profiles.toArray();
    const order = ['bo', 'me', 'admin'];
    all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return all.map((p) => ({
      id: p.id,
      ten_hien_thi: p.ten_hien_thi,
      xung_ho: p.xung_ho,
      mo_ta: p.mo_ta,
      vai_tro: p.vai_tro,
      book_id: p.book_id,
      avatar_emoji: p.avatar_emoji,
    }));
  }

  async loginWithPin(profileId: string, pin: string): Promise<AuthSession> {
    await this.ensureInitialized();
    const profile = await this.db.profiles.get(profileId);
    if (!profile) {
      throw new Error('Không tìm thấy tài khoản này.');
    }

    const cleanPin = String(pin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new Error('Mã PIN phải gồm đúng 4 chữ số.');
    }

    const inputHash = await hashPinWithSalt(cleanPin, profile.pin_salt);
    if (inputHash !== profile.pin_hash) {
      throw new Error('Mã PIN chưa đúng. Ông/bà bấm lại giúp con nhé!');
    }

    const now = Date.now();
    return {
      profile_id: profile.id,
      ten_hien_thi: profile.ten_hien_thi,
      xung_ho: profile.xung_ho,
      vai_tro: profile.vai_tro,
      book_id: profile.book_id,
      avatar_emoji: profile.avatar_emoji,
      created_at: now,
      expires_at: now + NINETY_DAYS_MS,
    };
  }

  async changePin(actor: AuthSession, targetProfileId: string, newPin: string): Promise<void> {
    await this.ensureInitialized();
    if (actor.vai_tro !== 'admin' && actor.profile_id !== targetProfileId) {
      throw new PermissionDeniedError('Chỉ chính chủ hoặc Admin mới được đổi mã PIN.');
    }
    const cleanPin = String(newPin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      throw new Error('Mã PIN mới phải gồm đúng 4 chữ số.');
    }
    const profile = await this.db.profiles.get(targetProfileId);
    if (!profile) throw new Error('Không tìm thấy tài khoản.');

    const newSalt = `sobep-salt-${targetProfileId}-${Date.now()}`;
    const newHash = await hashPinWithSalt(cleanPin, newSalt);
    await this.db.profiles.update(targetProfileId, {
      pin_salt: newSalt,
      pin_hash: newHash,
    });
  }

  async listAccessibleBooks(actor: AuthSession): Promise<Book[]> {
    await this.ensureInitialized();
    if (!actor || actor.expires_at <= Date.now()) {
      throw new PermissionDeniedError('Phiên đăng nhập đã hết hạn.');
    }
    const allBooks = await this.db.books.toArray();
    if (actor.vai_tro === 'admin') {
      return allBooks;
    }
    return allBooks.filter((b) => b.id === actor.book_id);
  }

  async getBookSnapshot(actor: AuthSession, bookId: BookId): Promise<BookSnapshot> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, bookId);

    const rawBook = await this.db.books.get(bookId);
    if (!rawBook) {
      throw new Error(`Không tìm thấy sổ ${bookId}`);
    }
    const book: Book = {
      ...rawBook,
      gio_nhac_hang_ngay: rawBook.gio_nhac_hang_ngay ?? '18:00',
      ngay_nhac_truong_chuyen: rawBook.ngay_nhac_truong_chuyen ?? 20,
      so_ngay_nhac_no_ncc: rawBook.so_ngay_nhac_no_ncc ?? 15,
    };

    const [
      mealPrices,
      mealCounts,
      workers,
      attendance,
      wallets,
      suppliers,
      categories,
      transactions,
      reminders,
    ] = await Promise.all([
      this.db.meal_prices.where('book_id').equals(bookId).toArray(),
      this.db.meal_counts.where('book_id').equals(bookId).toArray(),
      this.db.workers.where('book_id').equals(bookId).toArray(),
      this.db.attendance.where('book_id').equals(bookId).toArray(),
      this.db.wallets.where('book_id').equals(bookId).toArray(),
      this.db.suppliers.where('book_id').equals(bookId).toArray(),
      this.db.categories.orderBy('thu_tu').toArray(),
      this.db.transactions.where('book_id').equals(bookId).toArray(),
      this.db.reminders.where('book_id').equals(bookId).toArray(),
    ]);

    wallets.sort((a, b) => a.thu_tu - b.thu_tu);
    transactions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return {
      book,
      mealPrices,
      mealCounts,
      workers,
      attendance,
      wallets,
      suppliers,
      categories,
      transactions,
      reminders,
    };
  }

  async updateBookSettings(actor: AuthSession, book: Book): Promise<Book> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, book.id);
    await this.db.books.put(book);
    return book;
  }

  async upsertMealCount(
    actor: AuthSession,
    entry: Omit<MealCount, 'id' | 'updated_at'> & { id?: string }
  ): Promise<MealCount> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, entry.book_id);

    const existing = await this.db.meal_counts
      .where('[book_id+ngay+bua]')
      .equals([entry.book_id, entry.ngay, entry.bua])
      .first();

    const record: MealCount = {
      ...entry,
      id: existing?.id ?? entry.id ?? generateId(),
      updated_at: new Date().toISOString(),
    };
    await this.db.meal_counts.put(record);
    return record;
  }

  async upsertMealPrice(
    actor: AuthSession,
    price: Omit<MealPrice, 'id'> & { id?: string }
  ): Promise<MealPrice> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, price.book_id);

    const record: MealPrice = {
      ...price,
      id: price.id ?? generateId(),
    };
    await this.db.meal_prices.put(record);
    return record;
  }

  async upsertWorker(
    actor: AuthSession,
    worker: Omit<Worker, 'id'> & { id?: string }
  ): Promise<Worker> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, worker.book_id);

    const record: Worker = {
      ...worker,
      id: worker.id ?? generateId(),
    };
    await this.db.workers.put(record);
    return record;
  }

  async upsertAttendance(
    actor: AuthSession,
    att: Omit<Attendance, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Attendance> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, att.book_id);

    const existing = await this.db.attendance
      .where('[worker_id+ngay]')
      .equals([att.worker_id, att.ngay])
      .first();

    const record: Attendance = {
      ...att,
      id: existing?.id ?? att.id ?? generateId(),
      updated_at: new Date().toISOString(),
    };
    await this.db.attendance.put(record);
    return record;
  }

  async upsertSupplier(
    actor: AuthSession,
    supplier: Omit<Supplier, 'id'> & { id?: string }
  ): Promise<Supplier> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, supplier.book_id);

    const record: Supplier = {
      ...supplier,
      id: supplier.id ?? generateId(),
    };
    await this.db.suppliers.put(record);
    return record;
  }

  async upsertCategory(actor: AuthSession, category: Category): Promise<Category> {
    await this.ensureInitialized();
    assertAdmin(actor);
    await this.db.categories.put(category);
    return category;
  }

  async updateWallet(actor: AuthSession, wallet: Wallet): Promise<Wallet> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, wallet.book_id);
    await this.db.wallets.put(wallet);
    return wallet;
  }

  async addTransaction(
    actor: AuthSession,
    tx: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'> & {
      id?: string;
      timestamp?: string;
    }
  ): Promise<Transaction> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, tx.book_id);

    // Kiểm tra ví thuộc đúng cơ sở (tránh nhầm ví cơ sở khác)
    if (tx.wallet_id) {
      const wallet = await this.db.wallets.get(tx.wallet_id);
      if (!wallet || wallet.book_id !== tx.book_id) {
        throw new PermissionDeniedError('Ví được chọn không thuộc sổ của cơ sở này.');
      }
    }

    const record: Transaction = {
      ...tx,
      id: tx.id ?? generateId(),
      timestamp: tx.timestamp ?? new Date().toISOString(),
      da_xoa: false,
      deleted_at: null,
    };
    await this.db.transactions.put(record);
    return record;
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
    await this.ensureInitialized();
    assertCanAccessBook(actor, params.book_id);

    const bookWallets = await this.db.wallets.where('book_id').equals(params.book_id).toArray();
    const cashWallet = bookWallets.find((w) => w.loai_vi === 'tien_mat');
    const transferWallet = bookWallets.find((w) => w.loai_vi === 'tk_chi_nhan');
    if (!cashWallet || !transferWallet) {
      throw new Error('Không tìm thấy ví Tiền mặt hoặc TK Chị Nhàn của cơ sở này.');
    }

    const createdIds: string[] = [];
    const replacedIds: string[] = [];

    await this.db.transaction('rw', this.db.transactions, async () => {
      const existingToday = await this.db.transactions
        .where('[book_id+ngay]')
        .equals([params.book_id, params.ngay])
        .filter((t) => !t.da_xoa && t.loai === 'thu_cuoi_ngay')
        .toArray();

      const deletedAt = new Date().toISOString();
      for (const oldTx of existingToday) {
        replacedIds.push(oldTx.id);
        await this.db.transactions.update(oldTx.id, {
          da_xoa: true,
          deleted_at: deletedAt,
        });
      }

      const nowIso = new Date().toISOString();
      if (params.tien_mat > 0) {
        const cashId = generateId();
        createdIds.push(cashId);
        await this.db.transactions.put({
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
        await this.db.transactions.put({
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
    });

    return { createdIds, replacedIds };
  }

  async updateTransaction(actor: AuthSession, tx: Transaction): Promise<Transaction> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, tx.book_id);
    await this.db.transactions.put(tx);
    return tx;
  }

  async softDeleteTransaction(
    actor: AuthSession,
    bookId: BookId,
    txId: string
  ): Promise<void> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, bookId);
    const existing = await this.db.transactions.get(txId);
    if (!existing || existing.book_id !== bookId) {
      throw new PermissionDeniedError('Không tìm thấy giao dịch cần xóa trong sổ này.');
    }
    await this.db.transactions.update(txId, {
      da_xoa: true,
      deleted_at: new Date().toISOString(),
    });
  }

  async restoreTransaction(
    actor: AuthSession,
    bookId: BookId,
    txId: string
  ): Promise<void> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, bookId);
    const existing = await this.db.transactions.get(txId);
    if (!existing || existing.book_id !== bookId) {
      throw new PermissionDeniedError('Không tìm thấy giao dịch cần khôi phục.');
    }
    await this.db.transactions.update(txId, {
      da_xoa: false,
      deleted_at: null,
    });
  }

  async upsertReminder(
    actor: AuthSession,
    reminder: Omit<Reminder, 'id' | 'updated_at'> & { id?: string }
  ): Promise<Reminder> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, reminder.book_id);

    const record: Reminder = {
      ...reminder,
      id: reminder.id ?? generateId(),
      updated_at: new Date().toISOString(),
    };
    await this.db.reminders.put(record);
    return record;
  }

  async addChatLog(
    actor: AuthSession,
    log: Omit<ChatLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): Promise<ChatLog> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, log.book_id);

    const record: ChatLog = {
      ...log,
      id: log.id ?? generateId(),
      timestamp: log.timestamp ?? new Date().toISOString(),
    };
    await this.db.chat_logs.put(record);
    return record;
  }

  async updateChatLogStatus(
    actor: AuthSession,
    bookId: BookId,
    logId: string,
    ketQua: ChatLog['ket_qua']
  ): Promise<void> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, bookId);
    const existing = await this.db.chat_logs.get(logId);
    if (existing && existing.book_id === bookId) {
      await this.db.chat_logs.update(logId, { ket_qua: ketQua });
    }
  }

  async listChatLogs(
    actor: AuthSession,
    bookId: BookId,
    limit = 100
  ): Promise<ChatLog[]> {
    await this.ensureInitialized();
    assertCanAccessBook(actor, bookId);
    const items = await this.db.chat_logs.where('book_id').equals(bookId).toArray();
    return items
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  /** Trả về thực thể Dexie để đồng bộ dữ liệu trên máy lên Supabase khi kích hoạt Đám mây */
  getDexieInstance(): SoBepDexieDB {
    return this.db;
  }

  /**
   * Sao lưu gương (Mirror) toàn bộ snapshot của 1 cơ sở từ Đám mây xuống IndexedDB
   * để khi mất mạng đột ngột ở bếp/chợ, Bố Mẹ vẫn mở xem & ghi tiếp không gián đoạn.
   */
  async mirrorBookSnapshotFromCloud(snapshot: BookSnapshot): Promise<void> {
    await this.ensureInitialized();
    const bookId = snapshot.book.id;
    await this.db.transaction(
      'rw',
      [
        this.db.books,
        this.db.categories,
        this.db.wallets,
        this.db.meal_prices,
        this.db.workers,
        this.db.suppliers,
        this.db.meal_counts,
        this.db.attendance,
        this.db.transactions,
        this.db.reminders,
      ],
      async () => {
        await this.db.books.put(snapshot.book);
        if (snapshot.categories.length > 0) {
          await this.db.categories.bulkPut(snapshot.categories);
        }

        await this.db.wallets.where('book_id').equals(bookId).delete();
        if (snapshot.wallets.length > 0) await this.db.wallets.bulkPut(snapshot.wallets);

        await this.db.meal_prices.where('book_id').equals(bookId).delete();
        if (snapshot.mealPrices.length > 0) await this.db.meal_prices.bulkPut(snapshot.mealPrices);

        await this.db.workers.where('book_id').equals(bookId).delete();
        if (snapshot.workers.length > 0) await this.db.workers.bulkPut(snapshot.workers);

        await this.db.suppliers.where('book_id').equals(bookId).delete();
        if (snapshot.suppliers.length > 0) await this.db.suppliers.bulkPut(snapshot.suppliers);

        await this.db.meal_counts.where('book_id').equals(bookId).delete();
        if (snapshot.mealCounts.length > 0) await this.db.meal_counts.bulkPut(snapshot.mealCounts);

        await this.db.attendance.where('book_id').equals(bookId).delete();
        if (snapshot.attendance.length > 0) await this.db.attendance.bulkPut(snapshot.attendance);

        await this.db.transactions.where('book_id').equals(bookId).delete();
        if (snapshot.transactions.length > 0) {
          await this.db.transactions.bulkPut(snapshot.transactions);
        }

        await this.db.reminders.where('book_id').equals(bookId).delete();
        if (snapshot.reminders.length > 0) await this.db.reminders.bulkPut(snapshot.reminders);
      }
    );
  }

  async getCloudSyncStatus(): Promise<CloudSyncStatus> {
    return {
      configured: false,
      connected: false,
      mode: 'local',
      supabaseUrl: '',
      message: 'Đang lưu trực tiếp trên bộ nhớ thiết bị (IndexedDB).',
    };
  }

  async hasValidAuthSession(actor: AuthSession): Promise<boolean> {
    return Boolean(actor && actor.expires_at > Date.now());
  }

  async signOutCloud(): Promise<void> {
    // Chế độ local không cần đăng xuất server
  }

  subscribeToBookChanges(_bookId: BookId, onChanged: () => void): () => void {
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        onChanged();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  /** Chỉ dùng cho Admin hoặc bài test cần kiểm tra raw DB */
  async debugGetRawProfiles(actor: AuthSession) {
    assertAdmin(actor);
    return this.db.profiles.toArray();
  }
}
