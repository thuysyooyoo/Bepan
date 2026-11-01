import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseVietnameseCommandLocal } from '../ai/localVnNlu';
import { LocalDexieAdapter } from '../db';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeWalletBalances,
} from '../domain/accounting';
import type { BookSnapshot, Transaction } from '../types/models';

describe('Phiên 10 — Review & Hoàn Thiện: Tinh Gọn Rolly, Sổ Nợ / Phải Thu & AI Hỏi Lại', () => {
  const repo = new LocalDexieAdapter('SoBepSession10TestDB');

  async function getSeededSnapshot(): Promise<BookSnapshot> {
    const session = await repo.loginWithPin('bo', '1111');
    expect(session).not.toBeNull();
    const snap = await repo.getBookSnapshot(session, 'hiep_hoa');
    return snap;
  }

  it('1. Hạch toán chuẩn 3 sổ: Bán chịu (ban_chiu) ghi nhận Doanh thu + Phải thu, Ví KHÔNG đổi', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const initialDaily = computeDailyReport(snap, today);
    const initialWallets = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    const initialCash = initialWallets.reduce((s, w) => s + w.so_du_hien_tai, 0);
    const initialDebt = computeDebtAndPayables(snap, '2026-11');

    // Thêm giao dịch bán chịu: Cô Lan ăn chịu 105.000đ
    const banChiuTx: Transaction = {
      id: 'tx-ban-chiu-test-1',
      book_id: 'hiep_hoa',
      ngay: today,
      timestamp: '2026-11-01T10:00:00Z',
      mang: 'bep_an',
      loai: 'ban_chiu',
      category_id: 'cat_thu_khac_bep',
      so_tien: 105_000,
      wallet_id: null, // Chưa nhận tiền ví
      doi_tac: 'Cô Lan',
      ghi_chu: 'Cô Lan ăn chịu 3 suất',
      nguon: 'chat',
      nguoi_tao: 'test-user',
      da_xoa: false,
    };

    const snapWithBanChiu: BookSnapshot = {
      ...snap,
      transactions: [...snap.transactions, banChiuTx],
    };

    // 1. Sổ Lãi Lỗ: Phải tăng đúng 105.000đ doanh thu
    const updatedDaily = computeDailyReport(snapWithBanChiu, today);
    expect(updatedDaily.bep_an.tong_doanh_thu - initialDaily.bep_an.tong_doanh_thu).toBe(105_000);
    expect(updatedDaily.bep_an.lai_uoc_tinh_ngay - initialDaily.bep_an.lai_uoc_tinh_ngay).toBe(105_000);

    // 2. Sổ Dòng Tiền: Số dư các ví tiền KHÔNG ĐƯỢC THAY ĐỔI
    const updatedWallets = computeWalletBalances(
      snapWithBanChiu.wallets,
      snapWithBanChiu.transactions,
      'hiep_hoa'
    );
    const updatedCash = updatedWallets.reduce((s, w) => s + w.so_du_hien_tai, 0);
    expect(updatedCash).toBe(initialCash);

    // 3. Sổ Nợ & Phải Thu: Tăng đúng 105.000đ khoản phải thu khách
    const updatedDebt = computeDebtAndPayables(snapWithBanChiu, '2026-11');
    expect(updatedDebt.phai_thu_khach.tong_phai_thu_khach - initialDebt.phai_thu_khach.tong_phai_thu_khach).toBe(105_000);
    const coLanEntry = updatedDebt.phai_thu_khach.danh_sach.find((k) => k.doi_tac === 'Cô Lan');
    expect(coLanEntry).toBeDefined();
    expect(coLanEntry?.con_phai_thu).toBe(105_000);
  });

  it('2. Hạch toán chuẩn 3 sổ: Thu nợ cũ (thu_no) Tiền vào Ví + Giảm Phải thu, KHÔNG tăng Doanh thu', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const banChiuTx: Transaction = {
      id: 'tx-ban-chiu-test-2',
      book_id: 'hiep_hoa',
      ngay: '2026-10-25',
      timestamp: '2026-10-25T10:00:00Z',
      mang: 'bep_an',
      loai: 'ban_chiu',
      category_id: 'cat_thu_khac_bep',
      so_tien: 200_000,
      wallet_id: null,
      doi_tac: 'Bác Hùng',
      ghi_chu: 'Bác Hùng nợ tiền cơm',
      nguon: 'chat',
      nguoi_tao: 'test-user',
      da_xoa: false,
    };

    const cashWallet = snap.wallets.find((w) => w.loai_vi === 'tien_mat')!;
    const thuNoTx: Transaction = {
      id: 'tx-thu-no-test-2',
      book_id: 'hiep_hoa',
      ngay: today,
      timestamp: '2026-11-01T15:00:00Z',
      mang: 'bep_an',
      loai: 'thu_no',
      category_id: 'cat_thu_khac_bep',
      so_tien: 200_000,
      wallet_id: cashWallet.id, // Tiền vào ví tiền mặt
      doi_tac: 'Bác Hùng',
      ghi_chu: 'Bác Hùng trả nợ 200k',
      nguon: 'chat',
      nguoi_tao: 'test-user',
      da_xoa: false,
    };

    const snapWithTransactions: BookSnapshot = {
      ...snap,
      transactions: [...snap.transactions, banChiuTx, thuNoTx],
    };

    // 1. Sổ Lãi Lỗ hôm nay: Không được tính 200.000đ vào doanh thu ngày hôm nay (vì là thu hồi nợ cũ)
    const dailyToday = computeDailyReport(snapWithTransactions, today);
    const snapWithoutThuNo = {
      ...snap,
      transactions: [...snap.transactions, banChiuTx],
    };
    const dailyWithoutThuNo = computeDailyReport(snapWithoutThuNo, today);
    expect(dailyToday.bep_an.tong_doanh_thu).toBe(dailyWithoutThuNo.bep_an.tong_doanh_thu);

    // 2. Sổ Dòng Tiền: Ví tiền mặt phải tăng đúng 200.000đ
    const wallets = computeWalletBalances(
      snapWithTransactions.wallets,
      snapWithTransactions.transactions,
      'hiep_hoa'
    );
    const updatedCashWallet = wallets.find((w) => w.wallet.id === cashWallet.id)!;
    const baseWallets = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    const baseCashWallet = baseWallets.find((w) => w.wallet.id === cashWallet.id)!;
    expect(updatedCashWallet.so_du_hien_tai - baseCashWallet.so_du_hien_tai).toBe(200_000);

    // 3. Sổ Nợ: Bác Hùng đã trả đủ -> còn phải thu = 0
    const debt = computeDebtAndPayables(snapWithTransactions, '2026-11');
    const bacHungEntry = debt.phai_thu_khach.danh_sach.find((k) => k.doi_tac === 'Bác Hùng');
    expect(bacHungEntry?.con_phai_thu).toBe(0);
  });

  it('3. AI NLU nhận diện chuẩn xác Bán chịu & Thu nợ từ câu nói tự nhiên', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    // 1. Bán chịu có số tiền
    const res1 = parseVietnameseCommandLocal('Cô Lan ăn chịu 3 suất 105k', snap, today);
    expect(res1.items[0].intent).toBe('ban_chiu');
    expect(res1.items[0].doi_tac).toBe('Cô Lan');
    expect(res1.items[0].so_tien).toBe(105_000);

    // 2. Bán chịu chỉ nói số suất -> tự tính theo đơn giá vãng lai (3 * 30.000đ = 90.000đ)
    const res2 = parseVietnameseCommandLocal('Cô Lan ăn chịu 3 suất', snap, today);
    expect(res2.items[0].intent).toBe('ban_chiu');
    expect(res2.items[0].doi_tac).toBe('Cô Lan');
    expect(res2.items[0].so_tien).toBe(90_000); // 3 * 30.000đ đơn giá vãng lai Hiệp Hòa

    // 3. Bác Hùng nợ tiền cơm
    const res3 = parseVietnameseCommandLocal('Bác Hùng nợ tiền cơm 150 nghìn', snap, today);
    expect(res3.items[0].intent).toBe('ban_chiu');
    expect(res3.items[0].doi_tac).toBe('Bác Hùng');
    expect(res3.items[0].so_tien).toBe(150_000);

    // 4. Thu nợ từ khách
    const res4 = parseVietnameseCommandLocal('Cô Lan trả nợ 105k', snap, today);
    expect(res4.items[0].intent).toBe('thu_no');
    expect(res4.items[0].doi_tac).toBe('Cô Lan');
    expect(res4.items[0].so_tien).toBe(105_000);

    // 5. Bác Hùng trả tiền cơm
    const res5 = parseVietnameseCommandLocal('Bác Hùng trả tiền cơm 150k', snap, today);
    expect(res5.items[0].intent).toBe('thu_no');
    expect(res5.items[0].doi_tac).toBe('Bác Hùng');
    expect(res5.items[0].so_tien).toBe(150_000);
  });

  it('4. AI Review & Hỏi lại Clarification: 4 nút thanh toán khi chưa rõ trạng thái trả tiền', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    // Câu không nói đã trả tiền hay chưa: "Mua thịt 1 triệu 2"
    const parsed = parseVietnameseCommandLocal('Mua thịt 1 triệu 2', snap, today);
    const item = parsed.items[0];

    expect(item.intent).toBe('chi');
    expect(item.so_tien).toBe(1_200_000);
    expect(item.cau_hoi_lam_ro).toBe('Khoản này đã trả tiền chưa ạ?');
    expect(item.lua_chon_lam_ro).toHaveLength(4);

    const choices = item.lua_chon_lam_ro!;
    expect(choices.some((c) => c.label.includes('Tiền mặt'))).toBe(true);
    expect(choices.some((c) => c.label.includes('Chị Nhàn'))).toBe(true);
    expect(choices.some((c) => c.label.includes('Mợ Diệp'))).toBe(true);
    expect(choices.some((c) => c.label.includes('Chưa trả – Ghi nợ'))).toBe(true);

    // Thử áp dụng lựa chọn "Chưa trả – Ghi nợ"
    const noChoice = choices.find((c) => c.id === 'no')!;
    const patchedItem = { ...item, ...noChoice.patch };
    expect(patchedItem.intent).toBe('chi_no');
    expect(patchedItem.cau_hoi_lam_ro).toBeUndefined();
  });

  it('5. AI Hỏi đáp tổng kết ngày, ai đang nợ mình và mình đang nợ ai', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    // 1. Hỏi ai đang nợ mình
    const qAiNo = parseVietnameseCommandLocal('Ai đang nợ mình?', snap, today);
    expect(qAiNo.items[0].intent).toBe('hoi');
    expect(qAiNo.items[0].chu_de_hoi).toBe('ai_no_minh');
    expect(qAiNo.items[0].cau_tra_loi).toContain('Người ta nợ mình');

    // 2. Hỏi mình đang nợ ai
    const qMinhNo = parseVietnameseCommandLocal('Mình đang nợ ai?', snap, today);
    expect(qMinhNo.items[0].intent).toBe('hoi');
    expect(qMinhNo.items[0].chu_de_hoi).toBe('so_no_ncc');
    expect(qMinhNo.items[0].cau_tra_loi).toContain('Tổng khoản mình nợ');

    // 3. Tổng kết hôm nay
    const qTongKet = parseVietnameseCommandLocal('Tổng kết hôm nay', snap, today);
    expect(qTongKet.items[0].intent).toBe('hoi');
    expect(qTongKet.items[0].chu_de_hoi).toBe('lai_hom_nay');
    expect(qTongKet.items[0].cau_tra_loi).toContain('Bếp ăn: Thu');
    expect(qTongKet.items[0].cau_tra_loi).toContain('Tiền thực có');
  });

  it('6. Kiểm tra cơ chế Đổi người dùng & Cố định bảng chat cuộn độc lập', async () => {
    // 1. Kiểm tra logic đăng xuất & đổi người dùng không bị kẹt lastProfileId trong source code
    const fs = await import('node:fs');
    const authContextContent = fs.readFileSync('src/context/AuthContext.tsx', 'utf8');
    const loginScreenContent = fs.readFileSync('src/components/LoginScreen.tsx', 'utf8');

    // Trong logout(): Bắt buộc xóa cả SESSION_STORAGE_KEY và LAST_PROFILE_KEY
    expect(authContextContent).toContain('localStorage.removeItem(LAST_PROFILE_KEY)');
    expect(authContextContent).toContain('setLastProfileId(null)');

    // Trong LoginScreen: Bấm "Đổi người dùng" phải xóa sobep_last_profile và setHasSwitchedUser(true)
    expect(loginScreenContent).toContain("localStorage.removeItem('sobep_last_profile')");
    expect(loginScreenContent).toContain('setHasSwitchedUser(true)');

    // 2. Kiểm tra CSS cấu trúc AppShell & ChatAssistantBox:
    // Cố định viewport h-[100dvh], bảng chat có flex-1 min-h-0 overflow-y-auto, không trôi nút Mic
    const appShellContent = fs.readFileSync('src/components/AppShell.tsx', 'utf8');
    const chatBoxContent = fs.readFileSync('src/components/ChatAssistantBox.tsx', 'utf8');

    // AppShell phải có layout h-[100dvh] và overflow-hidden
    expect(appShellContent).toContain('h-[100dvh]');
    expect(appShellContent).toContain('overflow-hidden');
    expect(appShellContent).toContain('Đổi người');

    // ChatAssistantBox phải có vùng cuộn độc lập và nút Mic cố định
    expect(chatBoxContent).toContain('flex-1 min-h-0 overflow-y-auto');
    expect(chatBoxContent).toContain('shrink-0 bg-stone-50 border-t');
    expect(chatBoxContent).toContain('w-20 h-20 rounded-full'); // Kích thước nút Mic chuẩn 80px
  });

  it('7. Fix câu nói liên tục không dấu phẩy: "Hôm nay vừa mua 300.000 tiền thức ăn thuê 2 cô công nhân Để nấu ăn Chưa trả tiền"', async () => {
    const snap = await getSeededSnapshot();
    const today = '2026-11-01';

    const raw = 'Hôm nay vừa mua 300.000 tiền thức ăn thuê 2 cô công nhân Để nấu ăn Chưa trả tiền';
    const parsed = parseVietnameseCommandLocal(raw, snap, today);

    // Tuyệt đối không được trả về câu hỏi báo cáo 0đ!
    expect(parsed.items.length).toBe(2);

    // Món 1: Chi nợ 300.000đ thức ăn (cat_thit), hỏi rõ nợ ai
    const item1 = parsed.items[0];
    expect(item1.intent).toBe('chi_no');
    expect(item1.so_tien).toBe(300_000);
    expect(item1.category_id).toBe('cat_thit');
    expect(item1.cau_hoi_lam_ro).toContain('Khoản nợ này của ai');

    // Món 2: Chấm công 2 cô công nhân nấu ăn (1 công)
    const item2 = parsed.items[1];
    expect(item2.intent).toBe('cham_cong');
    expect(item2.cham_cong).toBeDefined();
    expect(item2.cham_cong?.length).toBe(2);
    expect(item2.cham_cong?.every((c) => c.so_cong === 1)).toBe(true);
  });
});
