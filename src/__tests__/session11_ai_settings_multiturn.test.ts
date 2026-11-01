import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { resolveFollowUpUtterance, parseUserUtterance } from '../ai/chatEngine';
import { LocalDexieAdapter } from '../db';
import type { BookSnapshot } from '../types/models';
import type { AiSettings } from '../types/aiSettings';

describe('Phiên 11 — Cấu hình Đa Model AI (Gemini/DeepSeek), Lưu Supabase/Local & Ngữ Cảnh Đa Lượt (Multi-turn)', () => {
  const repo = new LocalDexieAdapter('SoBepSession11TestDB');

  async function getSeededSnapshot(): Promise<BookSnapshot> {
    const session = await repo.loginWithPin('bo', '1111');
    expect(session).not.toBeNull();
    const snap = await repo.getBookSnapshot(session, 'hiep_hoa');
    return snap;
  }

  it('1. Đọc và Lưu cấu hình AI Settings: Hỗ trợ chuyển đổi Gemini, DeepSeek, OpenAI, Local NLU', async () => {
    // A) Mặc định khi chưa lưu: Trả về DEFAULT_AI_SETTINGS
    const defaultSettings = await repo.getAiSettings();
    expect(defaultSettings).toBeDefined();
    expect(defaultSettings.provider).toBe('gemini');
    expect(defaultSettings.model).toBe('gemini-3.8-flash');

    // B) Lưu cấu hình mới sang DeepSeek
    const newSettings: AiSettings = {
      id: 'default',
      provider: 'deepseek',
      api_key: 'sk-deepseek-test-key-12345',
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/chat/completions',
      enabled: true,
      updated_at: '2026-11-01T15:00:00Z',
    };

    await repo.saveAiSettings(newSettings);

    // C) Đọc lại và kiểm tra khớp 100%
    const loaded = await repo.getAiSettings();
    expect(loaded.provider).toBe('deepseek');
    expect(loaded.api_key).toBe('sk-deepseek-test-key-12345');
    expect(loaded.model).toBe('deepseek-chat');
    expect(loaded.endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(loaded.enabled).toBe(true);
  });

  it('2. Ngữ cảnh đa lượt: Lượt 1 "Mua thịt 4 trăm rưỡi", Lượt 2 "Chưa trả tiền đâu" -> Tự động chuyển thành Mua chịu (chi_no)', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    // Lượt 1: Bố nói mua thịt 450k
    const turn1Result = await parseUserUtterance('Mua 5 cân thịt 4 trăm rưỡi', snap, today);
    expect(turn1Result.items).toHaveLength(1);
    const item1 = turn1Result.items[0];
    expect(item1.intent).toBe('chi');
    expect(item1.so_tien).toBe(450_000);

    // Lượt 2: Bố nói "Chưa trả tiền đâu" kèm lịch sử Lượt 1
    const history = [
      {
        userText: 'Mua 5 cân thịt 4 trăm rưỡi',
        items: turn1Result.items,
        timestamp: '2026-11-01T10:00:00Z',
      },
    ];

    const followUp = resolveFollowUpUtterance('Chưa trả tiền đâu', history, snap, today);
    expect(followUp).not.toBeNull();
    expect(followUp).toHaveLength(1);

    const updatedItem = followUp![0];
    expect(updatedItem.intent).toBe('chi_no');
    expect(updatedItem.so_tien).toBe(450_000);
    expect(updatedItem.da_thanh_toan).toBe(false);
    expect(updatedItem.ghi_chu).toContain('Chưa trả tiền');
  });

  it('3. Ngữ cảnh đa lượt: Lượt 1 "Mua 2 thùng nước ngọt 300", Lượt 2 "Của căn tin nhé" -> Đổi mảng sang Căn tin', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const turn1Result = await parseUserUtterance('Mua 2 thùng nước ngọt 300', snap, today);
    expect(turn1Result.items).toHaveLength(1);
    const item1 = turn1Result.items[0];
    expect(item1.intent).toBe('chi');
    expect(item1.so_tien).toBe(300_000);

    const history = [
      {
        userText: 'Mua 2 thùng nước ngọt 300',
        items: turn1Result.items,
        timestamp: '2026-11-01T10:05:00Z',
      },
    ];

    const followUp = resolveFollowUpUtterance('Của căn tin nhé', history, snap, today);
    expect(followUp).not.toBeNull();
    expect(followUp![0].mang).toBe('can_tin');
  });

  it('4. Ngữ cảnh đa lượt: Lượt 1 "Chi 500k tiền gas", Lượt 2 "Chuyển khoản chị Nhàn nhé" -> Đổi ví sang tk_chi_nhan', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const turn1Result = await parseUserUtterance('Chi 500k tiền gas', snap, today);
    expect(turn1Result.items).toHaveLength(1);

    const history = [
      {
        userText: 'Chi 500k tiền gas',
        items: turn1Result.items,
        timestamp: '2026-11-01T10:10:00Z',
      },
    ];

    const followUp = resolveFollowUpUtterance('Chuyển khoản chị Nhàn nhé', history, snap, today);
    expect(followUp).not.toBeNull();
    expect(followUp![0].vi).toBe('tk_chi_nhan');
  });

  it('5. Ngữ cảnh đa lượt: Lượt 1 "Mua rau 150k", Lượt 2 "Nhầm rồi sửa lại 200 nghìn" -> Sửa số tiền thành 200.000đ', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const turn1Result = await parseUserUtterance('Mua rau 150k', snap, today);
    expect(turn1Result.items).toHaveLength(1);
    expect(turn1Result.items[0].so_tien).toBe(150_000);

    const history = [
      {
        userText: 'Mua rau 150k',
        items: turn1Result.items,
        timestamp: '2026-11-01T10:15:00Z',
      },
    ];

    const followUp = resolveFollowUpUtterance('Nhầm rồi sửa lại 200 nghìn', history, snap, today);
    expect(followUp).not.toBeNull();
    expect(followUp![0].so_tien).toBe(200_000);
  });

  it('6. Ngữ cảnh đa lượt: Câu hỏi nối tiếp "Thế hôm nay lãi bao nhiêu" -> Trả lời báo cáo ngày trực tiếp', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const history = [
      {
        userText: 'Mua rau 150k',
        items: [
          {
            intent: 'chi' as const,
            ngay: today,
            so_tien: 150_000,
            ghi_chu: 'Mua rau',
            category_id: 'cat_rau_cu_bep',
            vi: 'tien_mat' as const,
          },
        ],
        timestamp: '2026-11-01T10:20:00Z',
      },
    ];

    const followUp = resolveFollowUpUtterance('Thế hôm nay lãi bao nhiêu', history, snap, today);
    expect(followUp).not.toBeNull();
    expect(followUp![0].intent).toBe('hoi');
    expect(followUp![0].cau_tra_loi).toBeDefined();
    expect(followUp![0].cau_tra_loi).toContain('Bếp ăn: Thu');
  });
});
