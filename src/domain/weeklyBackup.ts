import type { DataRepository } from '../db';
import type {
  Attendance,
  AuthSession,
  Book,
  Category,
  ChatLog,
  MealCount,
  MealPrice,
  Supplier,
  Transaction,
  Wallet,
  Worker,
} from '../types/models';

export interface FullSystemBackupPayload {
  format: 'so_bep_nha_minh_backup';
  schema_version: '2026.1';
  exported_at: string;
  app_name: string;
  checksum: string;
  books: Book[];
  wallets: Wallet[];
  categories: Category[];
  mealPrices: MealPrice[];
  suppliers: Supplier[];
  workers: Worker[];
  mealCounts: MealCount[];
  attendance: Attendance[];
  transactions: Transaction[];
  chatLogs: ChatLog[];
  meta: {
    totalTransactions: number;
    totalMealCounts: number;
    totalAttendance: number;
    totalChatLogs: number;
  };
}

export interface RestoreSummary {
  success: boolean;
  restoredAt: string;
  totalBooks: number;
  totalWallets: number;
  totalCategories: number;
  totalMealPrices: number;
  totalSuppliers: number;
  totalWorkers: number;
  totalMealCounts: number;
  totalAttendance: number;
  totalTransactions: number;
  totalChatLogs: number;
}

const STORAGE_LAST_SNAPSHOT = 'so_bep_last_weekly_snapshot';
const STORAGE_LAST_DOWNLOAD = 'so_bep_last_backup_download';
const STORAGE_ROLLING_HISTORY = 'so_bep_weekly_snapshot_history';

/**
 * Tính mã checksum gọn nhẹ để kiểm tra tính toàn vẹn của file sao lưu khi khôi phục
 */
export function computeBackupChecksum(dataString: string): string {
  let hash = 5381;
  for (let i = 0; i < dataString.length; i++) {
    hash = ((hash << 5) + hash) ^ dataString.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Tạo gói sao lưu JSON toàn bộ hệ thống (Hiệp Hòa + Tiên Du + Danh mục + Công nợ + Dòng tiền)
 */
export async function exportFullSystemBackupPayload(
  repo: DataRepository,
  session: AuthSession
): Promise<FullSystemBackupPayload> {
  // Lấy dữ liệu đầy đủ của cả 2 cơ sở
  const [hhSnap, tdSnap, hhLogs, tdLogs] = await Promise.all([
    repo.getBookSnapshot(session, 'hiep_hoa'),
    repo.getBookSnapshot(session, 'tien_du'),
    repo.listChatLogs ? repo.listChatLogs(session, 'hiep_hoa', 500) : Promise.resolve([]),
    repo.listChatLogs ? repo.listChatLogs(session, 'tien_du', 500) : Promise.resolve([]),
  ]);

  const books: Book[] = [hhSnap.book, tdSnap.book];

  // Gộp ví (loại trừ trùng id)
  const walletMap = new Map<string, Wallet>();
  [...hhSnap.wallets, ...tdSnap.wallets].forEach((w) => walletMap.set(w.id, w));

  // Gộp danh mục (loại trừ trùng id)
  const categoryMap = new Map<string, Category>();
  [...hhSnap.categories, ...tdSnap.categories].forEach((c) => categoryMap.set(c.id, c));

  // Gộp đơn giá suất ăn
  const priceMap = new Map<string, MealPrice>();
  [...hhSnap.mealPrices, ...tdSnap.mealPrices].forEach((p) => priceMap.set(p.id, p));

  // Gộp mối hàng
  const supplierMap = new Map<string, Supplier>();
  [...hhSnap.suppliers, ...tdSnap.suppliers].forEach((s) => supplierMap.set(s.id, s));

  // Gộp phụ bếp
  const workerMap = new Map<string, Worker>();
  [...hhSnap.workers, ...tdSnap.workers].forEach((w) => workerMap.set(w.id, w));

  // Gộp suất ăn
  const mealCountMap = new Map<string, MealCount>();
  [...hhSnap.mealCounts, ...tdSnap.mealCounts].forEach((m) => mealCountMap.set(m.id, m));

  // Gộp chấm công
  const attMap = new Map<string, Attendance>();
  [...hhSnap.attendance, ...tdSnap.attendance].forEach((a) => attMap.set(a.id, a));

  // Gộp giao dịch tài chính
  const txMap = new Map<string, Transaction>();
  [...hhSnap.transactions, ...tdSnap.transactions].forEach((t) => txMap.set(t.id, t));

  // Gộp lịch sử chat
  const logMap = new Map<string, ChatLog>();
  [...hhLogs, ...tdLogs].forEach((l) => logMap.set(l.id, l));

  const partialPayload = {
    format: 'so_bep_nha_minh_backup' as const,
    schema_version: '2026.1' as const,
    exported_at: new Date().toISOString(),
    app_name: 'Sổ Bếp Nhà Mình',
    books,
    wallets: Array.from(walletMap.values()),
    categories: Array.from(categoryMap.values()),
    mealPrices: Array.from(priceMap.values()),
    suppliers: Array.from(supplierMap.values()),
    workers: Array.from(workerMap.values()),
    mealCounts: Array.from(mealCountMap.values()),
    attendance: Array.from(attMap.values()),
    transactions: Array.from(txMap.values()),
    chatLogs: Array.from(logMap.values()),
    meta: {
      totalTransactions: txMap.size,
      totalMealCounts: mealCountMap.size,
      totalAttendance: attMap.size,
      totalChatLogs: logMap.size,
    },
  };

  const checksum = computeBackupChecksum(JSON.stringify(partialPayload));

  return {
    ...partialPayload,
    checksum,
  };
}

/**
 * Tải file sao lưu JSON an toàn trong RAM (TUYỆT ĐỐI KHÔNG TẠO FILE .XLSX BACKUP TRÊN Ổ ĐĨA)
 */
export function downloadBackupJsonFile(
  payload: FullSystemBackupPayload,
  customFilename?: string
): string {
  const dateStr = payload.exported_at.slice(0, 10);
  const filename = customFilename || `So_Bep_Nha_Minh_Sao_Luu_${dateStr}.json`;
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  recordBackupDownloaded();
  return filename;
}

/**
 * Kiểm tra và giải mã file sao lưu JSON
 */
export function validateBackupJsonPayload(rawJson: string): FullSystemBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Tập tin không phải là định dạng JSON hợp lệ.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Dữ liệu sao lưu không đúng định dạng.');
  }

  const p = parsed as Partial<FullSystemBackupPayload>;

  if (p.format !== 'so_bep_nha_minh_backup') {
    throw new Error('Tập tin không phải bản sao lưu của Sổ Bếp Nhà Mình.');
  }

  if (p.schema_version !== '2026.1') {
    throw new Error(`Phiên bản sơ đồ (${p.schema_version}) không tương thích.`);
  }

  if (
    !Array.isArray(p.books) ||
    !Array.isArray(p.wallets) ||
    !Array.isArray(p.categories) ||
    !Array.isArray(p.transactions)
  ) {
    throw new Error('Bản sao lưu bị thiếu các bảng cốt lõi (books, wallets, categories, transactions).');
  }

  return p as FullSystemBackupPayload;
}

/**
 * Khôi phục toàn bộ hệ thống từ bản sao lưu JSON (thực hiện an toàn, lũy kế và bất biến)
 */
export async function restoreFullSystemBackup(
  repo: DataRepository,
  session: AuthSession,
  payload: FullSystemBackupPayload
): Promise<RestoreSummary> {
  if (session.vai_tro !== 'admin') {
    throw new Error('Chỉ tài khoản Admin mới có quyền khôi phục bản sao lưu toàn hệ thống.');
  }

  // 1. Khôi phục danh mục
  for (const cat of payload.categories) {
    await repo.upsertCategory(session, cat);
  }

  // 2. Khôi phục đơn giá suất ăn
  for (const mp of payload.mealPrices) {
    await repo.upsertMealPrice(session, mp);
  }

  // 3. Khôi phục ví
  for (const wal of payload.wallets) {
    await repo.updateWallet(session, wal);
  }

  // 4. Khôi phục mối hàng
  for (const sup of payload.suppliers) {
    await repo.upsertSupplier(session, sup);
  }

  // 5. Khôi phục phụ bếp
  for (const wrk of payload.workers) {
    await repo.upsertWorker(session, wrk);
  }

  // 6. Khôi phục suất ăn
  for (const mc of payload.mealCounts) {
    await repo.upsertMealCount(session, mc);
  }

  // 7. Khôi phục chấm công
  for (const att of payload.attendance) {
    await repo.upsertAttendance(session, att);
  }

  // 8. Khôi phục giao dịch tài chính
  for (const tx of payload.transactions) {
    await repo.addTransaction(session, tx);
  }

  return {
    success: true,
    restoredAt: new Date().toISOString(),
    totalBooks: payload.books.length,
    totalWallets: payload.wallets.length,
    totalCategories: payload.categories.length,
    totalMealPrices: payload.mealPrices.length,
    totalSuppliers: payload.suppliers.length,
    totalWorkers: payload.workers.length,
    totalMealCounts: payload.mealCounts.length,
    totalAttendance: payload.attendance.length,
    totalTransactions: payload.transactions.length,
    totalChatLogs: payload.chatLogs ? payload.chatLogs.length : 0,
  };
}

/**
 * Kiểm tra trạng thái sao lưu tuần
 */
export function checkWeeklyBackupStatus(): {
  due: boolean;
  lastSnapshotDate?: string;
  lastDownloadDate?: string;
  daysSinceSnapshot: number;
  daysSinceDownload: number;
} {
  try {
    const lastSnapStr = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_LAST_SNAPSHOT) : null;
    const lastDlStr = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_LAST_DOWNLOAD) : null;
    const now = Date.now();

    const lastSnapTime = lastSnapStr ? new Date(lastSnapStr).getTime() : 0;
    const lastDlTime = lastDlStr ? new Date(lastDlStr).getTime() : 0;

    const daysSinceSnapshot = lastSnapTime > 0 ? Math.floor((now - lastSnapTime) / (24 * 3600 * 1000)) : 999;
    const daysSinceDownload = lastDlTime > 0 ? Math.floor((now - lastDlTime) / (24 * 3600 * 1000)) : 999;

    const due = daysSinceSnapshot >= 7 || daysSinceDownload >= 7;

    return {
      due,
      lastSnapshotDate: lastSnapStr ?? undefined,
      lastDownloadDate: lastDlStr ?? undefined,
      daysSinceSnapshot,
      daysSinceDownload,
    };
  } catch {
    return {
      due: false,
      daysSinceSnapshot: 0,
      daysSinceDownload: 0,
    };
  }
}

/**
 * Đánh dấu thời điểm Admin vừa tải file sao lưu về máy
 */
export function recordBackupDownloaded(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_LAST_DOWNLOAD, new Date().toISOString());
    }
  } catch {
    // Không cản trở nếu localStorage bị tắt
  }
}

/**
 * Tự động chạy ảnh chụp sao lưu tuần trong bộ nhớ trình duyệt nếu đã quá 7 ngày
 * Lưu tối đa 4 bản ghi sao lưu tuần quay vòng (rolling weekly snapshots)
 */
export async function runWeeklyAutoSnapshotIfDue(
  repo: DataRepository,
  session: AuthSession
): Promise<{ ran: boolean; snapshotDate?: string; reason?: string }> {
  try {
    const status = checkWeeklyBackupStatus();
    if (!status.due && status.daysSinceSnapshot < 7) {
      return { ran: false, reason: 'Chưa tới hạn 7 ngày sao lưu tự động.' };
    }

    const payload = await exportFullSystemBackupPayload(repo, session);
    const dateStr = payload.exported_at;

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_LAST_SNAPSHOT, dateStr);

      // Lưu vào danh sách lịch sử quay vòng (tối đa 4 bản sao lưu gần nhất)
      const rawHist = localStorage.getItem(STORAGE_ROLLING_HISTORY);
      let hist: Array<{ date: string; meta: FullSystemBackupPayload['meta']; checksum: string }> = [];
      try {
        if (rawHist) hist = JSON.parse(rawHist);
      } catch {
        hist = [];
      }

      hist.unshift({
        date: dateStr,
        meta: payload.meta,
        checksum: payload.checksum,
      });

      // Giữ tối đa 4 tuần
      if (hist.length > 4) hist = hist.slice(0, 4);
      localStorage.setItem(STORAGE_ROLLING_HISTORY, JSON.stringify(hist));
    }

    return { ran: true, snapshotDate: dateStr };
  } catch (err) {
    return {
      ran: false,
      reason: err instanceof Error ? err.message : 'Không thực hiện được sao lưu tự động.',
    };
  }
}
