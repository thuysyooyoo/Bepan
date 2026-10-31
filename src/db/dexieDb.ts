import Dexie, { type Table } from 'dexie';
import type {
  Attendance,
  Book,
  BookId,
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

export type OfflineMutationOp =
  | 'updateBookSettings'
  | 'upsertMealCount'
  | 'upsertMealPrice'
  | 'upsertWorker'
  | 'upsertAttendance'
  | 'upsertSupplier'
  | 'upsertCategory'
  | 'updateWallet'
  | 'addTransaction'
  | 'saveDailyCollectionSynced'
  | 'updateTransaction'
  | 'softDeleteTransaction'
  | 'restoreTransaction'
  | 'upsertReminder'
  | 'addChatLog'
  | 'updateChatLogStatus';

export interface OfflineOutboxItem {
  id: string;
  book_id: BookId;
  op: OfflineMutationOp;
  payload: unknown;
  actor_profile_id: string;
  created_at: string; // Chuỗi ISO đảm bảo thứ tự FIFO chính xác
  retry_count: number;
  last_error?: string | null;
}

const V1_STORES = {
  books: 'id',
  profiles: 'id, vai_tro, book_id, virtual_email',
  meal_prices: 'id, [book_id+bua+loai_khach], [book_id+ap_dung_tu_ngay], book_id',
  meal_counts: 'id, &[book_id+ngay+bua], [book_id+ngay], book_id',
  workers: 'id, book_id, dang_lam',
  attendance: 'id, &[worker_id+ngay], [book_id+ngay], book_id',
  wallets: 'id, &[book_id+loai_vi], book_id',
  suppliers: 'id, book_id, dang_giao_dich',
  categories: 'id, nhom, kieu_tinh, thu_tu',
  transactions: 'id, [book_id+ngay], [book_id+timestamp], book_id, supplier_id, ky_thang',
  reminders: 'id, [book_id+trang_thai], book_id, ky_thang',
  chat_logs: 'id, [book_id+timestamp], book_id',
};

export class SoBepDexieDB extends Dexie {
  books!: Table<Book, string>;
  profiles!: Table<UserProfile, string>;
  meal_prices!: Table<MealPrice, string>;
  meal_counts!: Table<MealCount, string>;
  workers!: Table<Worker, string>;
  attendance!: Table<Attendance, string>;
  wallets!: Table<Wallet, string>;
  suppliers!: Table<Supplier, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  reminders!: Table<Reminder, string>;
  chat_logs!: Table<ChatLog, string>;
  offline_outbox!: Table<OfflineOutboxItem, string>;

  constructor(dbName = 'SoBepNhaMinhDB_v1') {
    super(dbName);

    this.version(1).stores(V1_STORES);

    this.version(2).stores({
      ...V1_STORES,
      offline_outbox: 'id, book_id, created_at',
    });
  }
}
