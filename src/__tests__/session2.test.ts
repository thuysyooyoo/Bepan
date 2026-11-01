import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDexieAdapter, PermissionDeniedError } from '../db';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeWalletBalances,
  findPreviousMealDay,
} from '../domain/accounting';
import { buildQuickMoneySuggestions } from '../domain/format';

describe('Phiên 2 — Cài đặt, Nhập tay đủ quy trình, Sửa/Xóa mềm & Hoàn tác', () => {
  it('1. Nút "Giống hôm qua" tự tìm ngày đi học gần nhất (kể cả qua Chủ nhật nghỉ)', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S2_PrevMeal_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');

    // Thứ Sáu 2026-10-30 có nấu Sáng 120, Trưa 310, Tối 75
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'sang',
      suat_truong: 120,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'trua',
      suat_truong: 310,
      suat_vang_lai: 4,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'toi',
      suat_truong: 75,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // Sáng Thứ Hai 2026-11-02 bấm "Giống hôm qua" -> lấy đúng Thứ Sáu 2026-10-30
    const snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    const prev = findPreviousMealDay(snap.mealCounts, 'hiep_hoa', '2026-11-02');
    expect(prev).toEqual({
      ngay: '2026-10-30',
      sang: 120,
      trua: 310,
      toi: 75,
    });
  });

  it('2. Thu cuối ngày (saveDailyCollection) chống cộng trùng khi nhập lại & hoàn tác chuẩn 100%', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S2_Collection_${Date.now()}`);
    const me = await repo.loginWithPin('me', '2222');
    const ngay = '2026-10-31';

    // Lần 1: Mẹ nhập thu cuối ngày 2.000.000 TM + 500.000 CK = 2.500.000
    await repo.saveDailyCollection(me, {
      book_id: 'tien_du',
      ngay,
      tien_mat: 2_000_000,
      chuyen_khoan: 500_000,
      nguon: 'tay',
    });

    let snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(computeDailyReport(snap, ngay).can_tin.tong_thu_quay_cuoi_ngay).toBe(2_500_000);

    // Lần 2: Mẹ đếm lại thấy thực ra là 2.300.000 TM + 800.000 CK = 3.100.000 -> cập nhật đè, không cộng dồn thành 5.6tr!
    const secondSave = await repo.saveDailyCollection(me, {
      book_id: 'tien_du',
      ngay,
      tien_mat: 2_300_000,
      chuyen_khoan: 800_000,
      nguon: 'tay',
    });

    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(computeDailyReport(snap, ngay).can_tin.tong_thu_quay_cuoi_ngay).toBe(3_100_000);
    const walletsAfter2 = computeWalletBalances(snap.wallets, snap.transactions, 'tien_du');
    expect(walletsAfter2.find((w) => w.wallet.id === 'td_tien_mat')!.so_du_hien_tai).toBe(
      2_300_000
    );
    expect(walletsAfter2.find((w) => w.wallet.id === 'td_tk_chi_nhan')!.so_du_hien_tai).toBe(
      800_000
    );

    // Mẹ bấm "Vừa ghi nhầm, xóa đi" (Hoàn tác lần 2) -> quay về đúng số lần 1 (2.0tr + 500k)
    for (const cid of secondSave.createdIds) {
      await repo.softDeleteTransaction(me, 'tien_du', cid);
    }
    for (const rid of secondSave.replacedIds) {
      await repo.restoreTransaction(me, 'tien_du', rid);
    }

    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(computeDailyReport(snap, ngay).can_tin.tong_thu_quay_cuoi_ngay).toBe(2_500_000);
  });

  it('3. Luồng Cài đặt + Sửa giao dịch (Trả luôn <-> Ghi nợ) + Chuyển quỹ + Xóa mềm/Khôi phục', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S2_FullFlow_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const admin = await repo.loginWithPin('admin', '9999');
    const ngay = '2026-10-31';

    // 1) Cài số dư đầu kỳ Tiền mặt = 5.000.000đ, TK Chị Nhàn = 3.000.000đ
    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    const cashW = snap.wallets.find((w) => w.id === 'hh_tien_mat')!;
    const nhanW = snap.wallets.find((w) => w.id === 'hh_tk_chi_nhan')!;
    await repo.updateWallet(bo, { ...cashW, so_du_dau_ky: 5_000_000 });
    await repo.updateWallet(bo, { ...nhanW, so_du_dau_ky: 3_000_000 });

    // 2) Chuyển quỹ: Rút 1.000.000đ từ TK Chị Nhàn về Tiền mặt -> TM = 6tr, Nhàn = 2tr, Lãi = 0
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'chung',
      loai: 'chuyen_quy',
      category_id: 'cat_chuyen_quy',
      so_tien: 1_000_000,
      wallet_id: 'hh_tk_chi_nhan',
      to_wallet_id: 'hh_tien_mat',
      ghi_chu: 'Chị Nhàn rút đưa tiền mặt',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // 3) Nhập chi mua thịt 1.500.000đ ban đầu bấm nhầm là "Trả luôn" từ Tiền mặt
    const meatTx = await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 1_500_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua thịt lợn',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(
      computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa').find(
        (w) => w.wallet.id === 'hh_tien_mat'
      )!.so_du_hien_tai
    ).toBe(4_500_000); // 5tr + 1tr - 1.5tr

    // 4) Bấm "Sửa" đổi khoản mua thịt đó sang "Mua chịu" (chi_no) mối thịt chợ Hiệp Hòa
    await repo.updateTransaction(bo, {
      ...meatTx,
      loai: 'chi_no',
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    // Tiền mặt lập tức quay lại 6.000.000đ, Sổ nợ tăng 1.500.000đ, Chi phí Bếp ăn vẫn 1.500.000đ!
    expect(
      computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa').find(
        (w) => w.wallet.id === 'hh_tien_mat'
      )!.so_du_hien_tai
    ).toBe(6_000_000);
    expect(computeDebtAndPayables(snap, '2026-10').nha_cung_cap.tong_no_ncc).toBe(1_500_000);
    expect(computeDailyReport(snap, ngay).bep_an.chi_nguyen_lieu_ngay).toBe(1_500_000);

    // 5) Xóa mềm rồi Khôi phục
    await repo.softDeleteTransaction(bo, 'hiep_hoa', meatTx.id);
    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(computeDebtAndPayables(snap, '2026-10').nha_cung_cap.tong_no_ncc).toBe(0);

    await repo.restoreTransaction(bo, 'hiep_hoa', meatTx.id);
    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(computeDebtAndPayables(snap, '2026-10').nha_cung_cap.tong_no_ncc).toBe(1_500_000);

    // 6) Đổi mã PIN & Phân quyền danh mục (chỉ Admin mới thêm được danh mục hệ thống)
    await expect(
      repo.upsertCategory(bo, {
        id: 'cat_test',
        ten_danh_muc: 'Test',
        nhom: 'chi',
        kieu_tinh: 'theo_ngay',
        mang_mac_dinh: 'bep_an',
        icon: '',
        tu_khoa_ai: [],
        thu_tu: 99,
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      repo.upsertCategory(admin, {
        id: 'cat_test',
        ten_danh_muc: 'Đậu phụ làng Mơ',
        nhom: 'chi',
        kieu_tinh: 'theo_ngay',
        mang_mac_dinh: 'bep_an',
        icon: '',
        tu_khoa_ai: ['đậu mơ'],
        thu_tu: 99,
      })
    ).resolves.toBeDefined();

    // Bố tự đổi mã PIN sang 5678 -> đăng nhập bằng PIN mới thành công
    await repo.changePin(bo, 'bo', '5678');
    await expect(repo.loginWithPin('bo', '1111')).rejects.toThrow();
    await expect(repo.loginWithPin('bo', '5678')).resolves.toBeDefined();
  });

  it('4. Gợi ý nhanh mệnh giá tiền (buildQuickMoneySuggestions) tránh đếm nhầm số 0', () => {
    expect(buildQuickMoneySuggestions('450')).toEqual([450_000, 4_500_000, 45_000_000]);
    expect(buildQuickMoneySuggestions('25')).toEqual([25_000, 250_000, 2_500_000]);
    expect(buildQuickMoneySuggestions('450000')).toEqual([]);
  });
});
