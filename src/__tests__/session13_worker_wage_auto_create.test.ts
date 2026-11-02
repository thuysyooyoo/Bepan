import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseVietnameseCommandLocal } from '../ai/localVnNlu';
import { buildActionCardFromIntent, resolveFollowUpUtterance } from '../ai/chatEngine';
import { computeDebtAndPayables } from '../domain/accounting';
import { LocalDexieAdapter } from '../db/localAdapter';
import type { AuthSession, BookSnapshot } from '../types/models';

describe('Phiên 13 — Tự động tạo thợ mới (Chú Hiển), Ghi nợ lương phải trả (chưa trả) & Xóa thợ mẫu', () => {
  const repo = new LocalDexieAdapter('SoBepSession13TestDB');
  const session: AuthSession = {
    profile_id: 'admin',
    vai_tro: 'admin',
    book_id: 'tien_du',
    ten_hien_thi: 'Admin',
    xung_ho: 'con',
    avatar_emoji: 'admin',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
  };

  async function getSnap(): Promise<BookSnapshot> {
    await repo.ensureInitialized();
    return repo.getBookSnapshot(session, 'tien_du');
  }

  it('1. NLU Local nhận diện câu nói: "Tiền công của chú hiển hôm nay làm bếp là 500.000 chưa trả"', async () => {
    const snap = await getSnap();
    const sentence = 'Tiền công của chú hiển hôm nay làm bếp là 500.000 chưa trả';
    const parsed = parseVietnameseCommandLocal(sentence, snap, '2026-11-02');

    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0];

    expect(item.intent).toBe('cham_cong');
    expect(item.ten_tho_moi).toBe('Chú Hiển');
    expect(item.so_tien).toBe(500_000);
    expect(item.chua_tra).toBe(true);
    expect(item.ghi_chu).toContain('Chú Hiển');
    expect(item.ghi_chu).toContain('Chưa trả');
  });

  it('2. Build Action Card & Commit: Tự động tạo Worker "Chú Hiển", Chấm công 1 công và Ghi nhận Sổ Nợ 500.000đ (Ví giữ nguyên)', async () => {
    const snap = await getSnap();
    const sentence = 'Tiền công của chú hiển hôm nay làm bếp là 500.000 chưa trả';
    const parsed = parseVietnameseCommandLocal(sentence, snap, '2026-11-02');
    const item = parsed.items[0];

    const card = buildActionCardFromIntent(item, snap, sentence, repo);
    expect(card).toBeDefined();
    expect(card!.preview.badge).toBe('TIỀN CÔNG PHỤ BẾP (CHƯA TRẢ)');
    expect(card!.preview.headlineAmount).toBe(500_000);
    expect(card!.preview.rows.some((r) => r.label === 'Trạng thái thanh toán' && r.value.includes('Chưa trả tiền'))).toBe(true);

    // Lưu thẻ vào CSDL
    const res = await card!.commit(session, 'chat');
    expect(res.message).toContain('Chú Hiển');

    // Kiểm tra snapshot mới sau khi lưu
    const nextSnap = await getSnap();
    const createdWorker = nextSnap.workers.find((w) => w.ho_ten.includes('Chú Hiển'));
    expect(createdWorker).toBeDefined();
    expect(createdWorker!.luong_ngay).toBe(500_000);

    // Kiểm tra điểm danh chấm công
    const att = nextSnap.attendance.find((a) => a.worker_id === createdWorker!.id && a.ngay === '2026-11-02');
    expect(att).toBeDefined();
    expect(att!.so_cong).toBe(1);
    expect(att!.don_gia_cong).toBe(500_000);

    // Kiểm tra Sổ Nợ: nợ lương thợ phải tăng đúng 500.000đ
    const debt = computeDebtAndPayables(nextSnap, '2026-11');
    const workerDebt = debt.luong_tho_ky_nay.chi_tiet_tho.find((x) => x.worker.id === createdWorker!.id);
    expect(workerDebt).toBeDefined();
    expect(workerDebt!.thanh_tien).toBe(500_000);
    expect(workerDebt!.da_ung).toBe(0);
    expect(workerDebt!.con_lai).toBe(500_000); // Chưa trả -> Còn phải trả đúng 500k
  });

  it('3. Xóa thợ mẫu khỏi danh mục: deleteWorker xóa sạch Cô Mai và Chị Hương khi người dùng yêu cầu', async () => {
    const snap = await getSnap();
    const coMai = snap.workers.find((w) => w.ho_ten.includes('Cô Mai'));
    const chiHuong = snap.workers.find((w) => w.ho_ten.includes('Chị Hương'));

    if (coMai) {
      await repo.deleteWorker(session, 'tien_du', coMai.id);
    }
    if (chiHuong) {
      await repo.deleteWorker(session, 'tien_du', chiHuong.id);
    }

    const nextSnap = await getSnap();
    expect(nextSnap.workers.some((w) => w.ho_ten.includes('Cô Mai'))).toBe(false);
    expect(nextSnap.workers.some((w) => w.ho_ten.includes('Chị Hương'))).toBe(false);
  });

  it('4. Ngữ cảnh đa lượt: Lượt 1 "Tiền công chú Hiển 500 nghìn", Lượt 2 "Chưa trả tiền đâu nhé" -> Tự động chuyển thành chưa trả', async () => {
    const snap = await getSnap();
    const history = [
      {
        userText: 'Tiền công chú Hiển làm bếp hôm nay 500 nghìn',
        items: [
          {
            intent: 'cham_cong' as const,
            ngay: '2026-11-02',
            so_tien: 500_000,
            ten_tho_moi: 'Chú Hiển',
            chua_tra: false,
            ghi_chu: 'Tiền công Chú Hiển làm bếp: 500.000 đ',
          },
        ],
      },
    ];

    const followUp = resolveFollowUpUtterance('Chưa trả tiền đâu nhé', history, snap, '2026-11-02');
    expect(followUp).toBeDefined();
    expect(followUp!).toHaveLength(1);
    expect(followUp![0].chua_tra).toBe(true);
    expect(followUp![0].ghi_chu).toContain('Chưa trả tiền/Ghi nợ lương');
  });

  it('5. Doanh thu căn tin: "bán được 400k tiền mặt" và "bán cantin được 400k tiền mặt" sinh thẻ xác nhận thu căn tin', async () => {
    const snap = await getSnap();

    // Test 1: NLU Local nhận diện
    const sentence1 = 'bán được 400k tiền mặt';
    const parsed1 = parseVietnameseCommandLocal(sentence1, snap, '2026-11-02');
    expect(parsed1.items).toHaveLength(1);
    expect(parsed1.items[0].intent).toBe('thu_can_tin');
    expect(parsed1.items[0].thu_cuoi_ngay?.tien_mat).toBe(400_000);

    const card1 = buildActionCardFromIntent(parsed1.items[0], snap, sentence1, repo);
    expect(card1).toBeDefined();
    expect(card1!.preview.headlineAmount).toBe(400_000);
    expect(card1!.preview.badge).toContain('TỔNG THU CĂN TIN');

    // Test 2: Dữ liệu phẳng từ Cloud AI (DeepSeek / Gemini: { intent: "thu_can_tin", so_tien: 400000, vi: "tien_mat" })
    const cloudItem = {
      intent: 'thu_can_tin' as const,
      ngay: '2026-11-02',
      so_tien: 400_000,
      vi: 'tien_mat' as const,
      mang: 'can_tin' as const,
      ghi_chu: 'Bán cantin được 400k tiền mặt',
    };
    const card2 = buildActionCardFromIntent(cloudItem, snap, 'bán cantin được 400k tiền mặt', repo);
    expect(card2).toBeDefined();
    expect(card2!.preview.headlineAmount).toBe(400_000);
    expect(card2!.preview.rows.some((r) => r.label.includes('Tiền mặt') && r.value.includes('400.000'))).toBe(true);

    // Commit lưu thẻ
    const res = await card2!.commit(session, 'chat');
    expect(res.message).toContain('400.000');
  });
});
