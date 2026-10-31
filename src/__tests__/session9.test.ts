import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseVietnameseCommandLocal } from '../ai/localVnNlu';
import { LocalDexieAdapter } from '../db/localAdapter';
import {
  addDialectKeywordToCategory,
  extractDialectCandidates,
  removeDialectKeywordFromCategory,
} from '../domain/dialectLearner';
import {
  checkWeeklyBackupStatus,
  exportFullSystemBackupPayload,
  restoreFullSystemBackup,
  runWeeklyAutoSnapshotIfDue,
  validateBackupJsonPayload,
} from '../domain/weeklyBackup';
import type { AuthSession, ChatLog } from '../types/models';

const ADMIN_SESSION: AuthSession = {
  profile_id: 'admin',
  ten_hien_thi: 'Con (Quản lý chung)',
  vai_tro: 'admin',
  xung_ho: 'Admin',
  avatar_emoji: '🛡️',
  book_id: null,
  created_at: Date.now(),
  expires_at: Date.now() + 90 * 24 * 3600 * 1000,
};

describe('Phiên 9 — Chạy thử & Bàn giao (Học tiếng địa phương, Hướng dẫn 1 trang A4, Sao lưu tuần .json Rule 10)', () => {
  it('1. Học từ địa phương & Mối hàng mới: Tự động trích xuất từ chat_logs + gán từ khóa danh mục nhận diện tức thì 0-token', async () => {
    const adapter = new LocalDexieAdapter(`session9_test_dialect_${Date.now()}`);
    await adapter.ensureInitialized();

    const hhSnap = await adapter.getBookSnapshot(ADMIN_SESSION, 'hiep_hoa');
    const tdSnap = await adapter.getBookSnapshot(ADMIN_SESSION, 'tien_du');

    // Giả lập lịch sử chat có câu nói phương ngữ lạ và tên người bán mới
    const testLogs: ChatLog[] = [
      {
        id: 'log_d1',
        book_id: 'hiep_hoa',
        cau_noi: 'Mua bìa đậu 120 nghìn',
        ket_qua: 'cho_xac_nhan',
        nguon: 'giong',
        nguoi_dung: 'bo',
        ai_json: '{}',
        timestamp: '2026-03-31T09:00:00Z',
      },
      {
        id: 'log_d2',
        book_id: 'hiep_hoa',
        cau_noi: 'Mua rau cô Mùi 300k ghi nợ',
        ket_qua: 'cho_xac_nhan',
        nguon: 'giong',
        nguoi_dung: 'bo',
        ai_json: '{}',
        timestamp: '2026-03-31T09:05:00Z',
      },
      {
        id: 'log_d3',
        book_id: 'tien_du',
        cau_noi: 'Chấm công cô Huệ nửa ngày',
        ket_qua: 'cho_xac_nhan',
        nguon: 'giong',
        nguoi_dung: 'me',
        ai_json: '{}',
        timestamp: '2026-03-31T09:10:00Z',
      },
    ];

    // Trích xuất ứng viên từ chat_logs
    const candidates = extractDialectCandidates(
      testLogs,
      hhSnap.categories,
      [...hhSnap.suppliers, ...tdSnap.suppliers],
      [...hhSnap.workers, ...tdSnap.workers]
    );

    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Kiểm tra phát hiện mối hàng mới
    const supCandidate = candidates.find((c) => c.suggestedType === 'new_supplier');
    expect(supCandidate).toBeDefined();
    expect(supCandidate?.candidateTerm).toContain('Cô Mùi');

    // Kiểm tra phát hiện phụ bếp mới
    const wrkCandidate = candidates.find((c) => c.suggestedType === 'new_worker');
    expect(wrkCandidate).toBeDefined();
    expect(wrkCandidate?.candidateTerm).toContain('Cô Huệ');

    // Thử dạy từ khóa "bìa đậu" cho danh mục Trứng, đậu phụ
    const targetCat = hhSnap.categories.find((c) => c.id === 'cat_trung_dau_gio')!;
    const updatedCat = addDialectKeywordToCategory(targetCat, 'bìa đậu');
    expect(updatedCat.tu_khoa_ai).toContain('bìa đậu');

    await adapter.upsertCategory(ADMIN_SESSION, updatedCat);
    const refreshedSnap = await adapter.getBookSnapshot(ADMIN_SESSION, 'hiep_hoa');

    // Thử phân tích lại bằng Local NLU -> nhận diện tức thì mà không cần gọi Gemini (0-token!)
    const parsed = parseVietnameseCommandLocal(
      'Mua bìa đậu 150k',
      refreshedSnap,
      '2026-03-31'
    );
    expect(parsed.items[0].intent).toBe('chi');
    expect(parsed.items[0].category_id).toBe('cat_trung_dau_gio');

    // Thử xóa từ khóa
    const revertedCat = removeDialectKeywordFromCategory(updatedCat, 'bìa đậu');
    expect(revertedCat.tu_khoa_ai.includes('bìa đậu')).toBe(false);
  });

  it('2. Sao lưu tuần (.json) & Khôi phục toàn hệ thống chuẩn Rule 10 (Tuyệt đối 0 file .xlsx backup)', async () => {
    const adapter = new LocalDexieAdapter(`session9_test_backup_${Date.now()}`);
    await adapter.ensureInitialized();

    // 1. Tạo gói sao lưu JSON
    const payload = await exportFullSystemBackupPayload(adapter, ADMIN_SESSION);
    expect(payload.format).toBe('so_bep_nha_minh_backup');
    expect(payload.schema_version).toBe('2026.1');
    expect(payload.books.length).toBe(2);
    expect(payload.categories.length).toBeGreaterThan(20);
    expect(payload.checksum).toBeDefined();

    // 2. Kiểm tra tính toàn vẹn Checksum
    const jsonStr = JSON.stringify(payload);
    const validPayload = validateBackupJsonPayload(jsonStr);
    expect(validPayload.checksum).toBe(payload.checksum);

    // 3. Khôi phục sang adapter mới sạch sẽ
    const restoreAdapter = new LocalDexieAdapter(`session9_test_restore_dest_${Date.now()}`);
    await restoreAdapter.ensureInitialized();

    const summary = await restoreFullSystemBackup(restoreAdapter, ADMIN_SESSION, validPayload);
    expect(summary.success).toBe(true);
    expect(summary.totalBooks).toBe(2);
    expect(summary.totalCategories).toBe(payload.categories.length);

    // 4. Đối chiếu số liệu sau khi khôi phục
    const restoredHh = await restoreAdapter.getBookSnapshot(ADMIN_SESSION, 'hiep_hoa');
    const restoredTd = await restoreAdapter.getBookSnapshot(ADMIN_SESSION, 'tien_du');
    expect(restoredHh.categories.length).toBe(payload.categories.length);
    expect(restoredTd.categories.length).toBe(payload.categories.length);

    // 5. Kiểm tra tính năng chạy tự động khi đến hạn 7 ngày
    const autoResult = await runWeeklyAutoSnapshotIfDue(adapter, ADMIN_SESSION);
    expect(typeof autoResult.ran).toBe('boolean');

    const status = checkWeeklyBackupStatus();
    expect(status).toBeDefined();
    expect(typeof status.due).toBe('boolean');
  });

  it('3. Kiểm tra tuân thủ tuyệt đối Rule 10: KHÔNG CÓ BẤT KỲ FILE BACKUP .XLSX NÀO TRÊN Ổ ĐĨA', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const allFiles: string[] = [];

    function scanDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(full);
        } else {
          allFiles.push(full);
        }
      }
    }

    scanDir(projectRoot);

    const backupXlsxFiles = allFiles.filter(
      (f) =>
        f.endsWith('.xlsx') &&
        (f.includes('backup') || f.includes('_backup') || f.includes('Sao_Luu'))
    );

    // Rule 10 cấm tuyệt đối sinh file backup .xlsx
    expect(backupXlsxFiles.length).toBe(0);
  });

  it('4. Kiểm tra đầy đủ tài liệu bàn giao kỹ thuật & cẩm nang in A4 cho Bố Mẹ', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const handoffDocPath = path.join(projectRoot, 'TAI_LIEU_BAN_GIAO_KY_THUAT.md');
    const printGuidePath = path.join(projectRoot, 'public', 'huong-dan-ong-ba.html');

    expect(fs.existsSync(handoffDocPath)).toBe(true);
    expect(fs.existsSync(printGuidePath)).toBe(true);

    const docContent = fs.readFileSync(handoffDocPath, 'utf-8');
    expect(docContent).toContain('Hiệp Hòa');
    expect(docContent).toContain('Tiên Du');
    expect(docContent).toContain('1111');
    expect(docContent).toContain('2222');
    expect(docContent).toContain('9999');
    expect(docContent).toContain('Cách A');
    expect(docContent).toContain('RULE 10 COMPLIANCE');

    const guideContent = fs.readFileSync(printGuidePath, 'utf-8');
    expect(guideContent).toContain('Bố');
    expect(guideContent).toContain('Mẹ');
    expect(guideContent).toContain('1 1 1 1');
    expect(guideContent).toContain('2 2 2 2');
    expect(guideContent).toContain('Micro tròn màu xanh');
  });
});
