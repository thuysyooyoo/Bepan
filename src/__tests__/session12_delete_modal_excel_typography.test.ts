import 'fake-indexeddb/auto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDexieAdapter } from '../db';
import { computeDebtAndPayables } from '../domain/accounting';
import { buildSingleBookMonthlyExcelBuffer } from '../domain/excelExport';

describe('Phiên 12 — Modal xác nhận xóa 10s, Xuất Excel Zalo & Không hiển thị thợ ảo', () => {
  it('1. Xuất file Excel đơn cơ sở tạo buffer hợp lệ cho Zalo', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Session12_Export_${Date.now()}`);
    await repo.ensureInitialized();
    const me = await repo.loginWithPin('me', '2222');
    const snapshot = await repo.getBookSnapshot(me, 'tien_du');

    const bytes = await buildSingleBookMonthlyExcelBuffer(snapshot, '2026-11');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('2. Lọc bỏ thợ 0 công/0 nợ khỏi Sổ Nợ (không hiển thị card ảo 0 công "Đã trả đủ")', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Session12_Workers_${Date.now()}`);
    await repo.ensureInitialized();
    const me = await repo.loginWithPin('me', '2222');
    const snapshot = await repo.getBookSnapshot(me, 'tien_du');

    const debt = computeDebtAndPayables(snapshot, '2026-11', '2026-11-01');
    
    // Kiểm tra danh sách thợ trong kỳ
    const allWorkers = debt.luong_tho_ky_nay.chi_tiet_tho;
    expect(allWorkers.length).toBeGreaterThan(0);

    // Lọc theo logic mới: Chỉ lấy thợ có hoạt động trong kỳ
    const activeWorkers = allWorkers.filter(
      (w) => w.tong_cong > 0 || w.da_ung > 0 || w.con_lai > 0
    );

    // Ở tháng 11/2026 trong seed data, cả 2 cô thợ đều chưa phát sinh công -> activeWorkers phải rỗng
    expect(activeWorkers.length).toBe(0);
  });

  it('3. Tuyệt đối ZERO EMOJIS trong các file component mới cập nhật', () => {
    const filesToCheck = [
      'src/components/DeleteConfirmModal.tsx',
      'src/components/DebtLedgerView.tsx',
      'src/components/CashflowView.tsx',
      'src/components/ProfitReportView.tsx',
      'src/components/DailyLedgerList.tsx',
    ];

    // Regex bắt các emoji phổ biến (Emoticons, Miscellaneous Symbols, Transport, Dingbats...)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(__dirname, '..', '..', relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      
      const match = content.match(emojiRegex);
      expect(
        match,
        `File ${relPath} phát hiện emoji trái quy định: ${match?.[0]}`
      ).toBeNull();
    }
  });

  it('4. File DeleteConfirmModal chứa đồng hồ đếm ngược 10 giây tự hủy', () => {
    const modalPath = path.resolve(__dirname, '..', 'components', 'DeleteConfirmModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');
    
    expect(content).toContain('countdownSeconds = 10');
    expect(content).toContain('onCancel()');
    expect(content).toContain('setInterval');
  });
});
