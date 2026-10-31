import type { DataRepository } from './interface';

/**
 * Khung kết nối Supabase (sẽ hoàn thiện ở Phiên 7 sau khi khởi tạo tài khoản Supabase + RLS).
 * Toàn bộ UI và logic chỉ gọi qua interface DataRepository nên chuyển đổi sang Supabase
 * ở Phiên 7 không phải sửa bất kỳ màn hình nào.
 */
export class SupabaseAdapterStub implements DataRepository {
  readonly mode = 'supabase' as const;

  private notConfigured(): never {
    throw new Error(
      'Adapter Supabase sẽ được kích hoạt ở Phiên 7. Hiện tại hãy để VITE_DATA_ADAPTER=local.'
    );
  }

  async ensureInitialized() {
    this.notConfigured();
  }
  async listLoginProfiles() {
    return this.notConfigured();
  }
  async loginWithPin() {
    return this.notConfigured();
  }
  async changePin() {
    return this.notConfigured();
  }
  async listAccessibleBooks() {
    return this.notConfigured();
  }
  async getBookSnapshot() {
    return this.notConfigured();
  }
  async updateBookSettings() {
    return this.notConfigured();
  }
  async upsertMealCount() {
    return this.notConfigured();
  }
  async upsertMealPrice() {
    return this.notConfigured();
  }
  async upsertWorker() {
    return this.notConfigured();
  }
  async upsertAttendance() {
    return this.notConfigured();
  }
  async upsertSupplier() {
    return this.notConfigured();
  }
  async upsertCategory() {
    return this.notConfigured();
  }
  async updateWallet() {
    return this.notConfigured();
  }
  async addTransaction() {
    return this.notConfigured();
  }
  async saveDailyCollection() {
    return this.notConfigured();
  }
  async updateTransaction() {
    return this.notConfigured();
  }
  async softDeleteTransaction() {
    return this.notConfigured();
  }
  async restoreTransaction() {
    return this.notConfigured();
  }
  async upsertReminder() {
    return this.notConfigured();
  }
  async addChatLog() {
    return this.notConfigured();
  }
  async updateChatLogStatus() {
    this.notConfigured();
  }
  async listChatLogs() {
    return this.notConfigured();
  }
}
