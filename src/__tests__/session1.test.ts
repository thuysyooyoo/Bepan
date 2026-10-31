import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
  computeWalletBalances,
  getEffectiveMealPrice,
} from '../domain/accounting';
import { LocalDexieAdapter, PermissionDeniedError } from '../db';

describe('Phiên 1 — CSDL, Phân quyền PIN & Động cơ Kế toán 3 Sổ', () => {
  it('1. Khởi tạo seed chuẩn, băm PIN có salt (không lưu plaintext) và cấp phiên 90 ngày', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Auth_${Date.now()}`);
    await repo.ensureInitialized();

    const publicProfiles = await repo.listLoginProfiles();
    expect(publicProfiles.map((p) => p.id)).toEqual(['bo', 'me', 'admin']);
    // Đảm bảo thông tin public không lộ pin_hash
    expect('pin_hash' in publicProfiles[0]).toBe(false);

    // Sai PIN phải báo lỗi
    await expect(repo.loginWithPin('bo', '0000')).rejects.toThrow(/Mã PIN chưa đúng/);

    // Đúng PIN -> trả về phiên 90 ngày
    const boSession = await repo.loginWithPin('bo', '1111');
    expect(boSession.book_id).toBe('hiep_hoa');
    expect(boSession.vai_tro).toBe('owner');
    const daysValid = (boSession.expires_at - boSession.created_at) / (1000 * 60 * 60 * 24);
    expect(Math.round(daysValid)).toBe(90);

    // Kiểm tra raw DB qua quyền Admin: không lưu PIN dạng chữ thô
    const adminSession = await repo.loginWithPin('admin', '9999');
    const rawProfiles = await repo.debugGetRawProfiles(adminSession);
    for (const p of rawProfiles) {
      expect(p.pin_hash).not.toBe('1111');
      expect(p.pin_hash).not.toBe('2222');
      expect(p.pin_hash).not.toBe('9999');
      expect(p.pin_hash).toHaveLength(64); // SHA-256 hex
    }
  });

  it('2. Cô lập quyền truy cập: Bố không đọc/ghi được sổ Mẹ và ngược lại; Admin xem được cả hai', async () => {
    const repo = new LocalDexieAdapter(`TestDB_RBAC_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const me = await repo.loginWithPin('me', '2222');
    const admin = await repo.loginWithPin('admin', '9999');

    // Bố mở sổ Hiệp Hòa thành công, nhưng mở sổ Tiên Du bị chặn
    const hhSnap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(hhSnap.book.id).toBe('hiep_hoa');
    expect(hhSnap.wallets.map((w) => w.id)).toEqual([
      'hh_tien_mat',
      'hh_tk_mo_diep',
      'hh_tk_chi_nhan',
    ]);
    await expect(repo.getBookSnapshot(bo, 'tien_du')).rejects.toBeInstanceOf(
      PermissionDeniedError
    );

    // Mẹ mở sổ Tiên Du thành công, nhưng ghi vào sổ Hiệp Hòa bị chặn
    const tdSnap = await repo.getBookSnapshot(me, 'tien_du');
    expect(tdSnap.book.id).toBe('tien_du');
    await expect(
      repo.upsertMealCount(me, {
        book_id: 'hiep_hoa',
        ngay: '2026-10-31',
        bua: 'trua',
        suat_truong: 200,
        suat_vang_lai: 0,
        nguon: 'tay',
        nguoi_tao: 'me',
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Chặn gắn nhầm ví của Tiên Du vào giao dịch sổ Hiệp Hòa
    await expect(
      repo.addTransaction(bo, {
        book_id: 'hiep_hoa',
        ngay: '2026-10-31',
        mang: 'bep_an',
        loai: 'chi',
        category_id: 'cat_thit',
        so_tien: 300_000,
        wallet_id: 'td_tien_mat',
        ghi_chu: 'Ví sai cơ sở',
        nguon: 'tay',
        nguoi_tao: 'bo',
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Admin xem được cả 2 sổ
    const adminBooks = await repo.listAccessibleBooks(admin);
    expect(adminBooks).toHaveLength(2);
    await expect(repo.getBookSnapshot(admin, 'hiep_hoa')).resolves.toBeDefined();
    await expect(repo.getBookSnapshot(admin, 'tien_du')).resolves.toBeDefined();
  });

  it('3. Đơn giá Sáng/Trưa/Tối riêng từng cơ sở & giữ nguyên lịch sử khi đổi giá', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Prices_${Date.now()}`);
    const admin = await repo.loginWithPin('admin', '9999');

    // Hiệp Hòa tăng giá bữa trưa trường từ 25k lên 27k áp dụng từ 2026-11-01
    await repo.upsertMealPrice(admin, {
      book_id: 'hiep_hoa',
      bua: 'trua',
      loai_khach: 'truong',
      don_gia: 27_000,
      ap_dung_tu_ngay: '2026-11-01',
    });

    const hh = await repo.getBookSnapshot(admin, 'hiep_hoa');
    const td = await repo.getBookSnapshot(admin, 'tien_du');

    // Tháng 10 vẫn giữ giá 25.000đ, sang tháng 11 mới tính 27.000đ
    expect(getEffectiveMealPrice(hh.mealPrices, 'hiep_hoa', 'trua', 'truong', '2026-10-31')).toBe(
      25_000
    );
    expect(getEffectiveMealPrice(hh.mealPrices, 'hiep_hoa', 'trua', 'truong', '2026-11-02')).toBe(
      27_000
    );
    // Tiên Du vẫn độc lập 28.000đ
    expect(getEffectiveMealPrice(td.mealPrices, 'tien_du', 'trua', 'truong', '2026-10-31')).toBe(
      28_000
    );
  });

  it('4. Cách A (tách vãng lai khỏi tổng thu cuối ngày) & Tách bạch tuyệt đối 3 Sổ', async () => {
    const repo = new LocalDexieAdapter(`TestDB_ThreeBooks_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const ngay = '2026-10-31';

    // 1) Bố nhập suất ăn trưa: 300 suất trường (x25k = 7.5tr) + 5 suất vãng lai (x30k = 150k)
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay,
      bua: 'trua',
      suat_truong: 300,
      suat_vang_lai: 5,
      nguon: 'chat',
      nguoi_tao: 'bo',
    });

    // 2) Mua rau trả tiền mặt ngay: 400.000đ
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 400_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua rau buổi sáng',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });

    // 3) Mua chịu thịt 2.000.000đ của Mối thịt chợ Hiệp Hòa ('chi_no' -> không trừ ví!)
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 2_000_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Lấy thịt ghi nợ mối chợ',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });

    // 4) Chấm công 2 cô phụ bếp (2 x 250k = 500k tính vào chi phí ngày, cuối tháng mới trả)
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay,
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay,
      so_cong: 1,
      don_gia_cong: 250_000,
    });

    // 5) Cuối ngày Bố đếm tổng tiền thu (gồm cả căn tin + vãng lai): 2.3tr TM + 800k CK chị Nhàn = 3.1tr
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 2_300_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Thu tiền mặt cuối ngày',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 800_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'Thu CK chị Nhàn cuối ngày',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });

    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    const daily = computeDailyReport(snap, ngay);

    // KIỂM TRA SỔ 1 (LÃI LỖ NGÀY):
    // Bếp ăn: Doanh thu = 7.500.000 + 150.000 = 7.650.000; Chi = 400k + 2.000k + 500k = 2.900.000 -> Lãi = 4.750.000
    expect(daily.bep_an.tong_doanh_thu).toBe(7_650_000);
    expect(daily.bep_an.tong_chi_ngay).toBe(2_900_000);
    expect(daily.bep_an.lai_uoc_tinh_ngay).toBe(4_750_000);

    // Căn tin (Cách A): Tổng thu 3.100.000 tự trừ 150.000 vãng lai -> Doanh thu Căn tin = 2.950.000
    expect(daily.can_tin.tong_thu_quay_cuoi_ngay).toBe(3_100_000);
    expect(daily.can_tin.tru_tien_vang_lai).toBe(150_000);
    expect(daily.can_tin.doanh_thu_can_tin).toBe(2_950_000);

    // KIỂM TRA SỔ 2 (DÒNG TIỀN THỰC):
    let wallets = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    const getBal = (id: string) => wallets.find((w) => w.wallet.id === id)!.so_du_hien_tai;
    expect(getBal('hh_tien_mat')).toBe(1_900_000); // +2.300k - 400k (không trừ 2tr mua chịu, không trừ 500k lương!)
    expect(getBal('hh_tk_chi_nhan')).toBe(800_000);
    expect(getBal('hh_tk_mo_diep')).toBe(0);

    // KIỂM TRA SỔ 3 (SỔ NỢ & PHẢI TRẢ):
    let debt = computeDebtAndPayables(snap, '2026-10');
    expect(debt.nha_cung_cap.tong_no_ncc).toBe(2_000_000);
    expect(debt.luong_tho_ky_nay.con_phai_tra).toBe(500_000);
    expect(debt.tien_truong_ky_nay.con_cho_chuyen).toBe(7_500_000);

    // 6) Bố trả bớt nợ thịt 1.200.000đ bằng tiền mặt -> Giảm ví + giảm nợ, KHÔNG làm lệch lãi lỗ!
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay,
      mang: 'bep_an',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 1_200_000,
      wallet_id: 'hh_tien_mat',
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Trả bớt nợ thịt',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(computeDailyReport(snap, ngay).bep_an.lai_uoc_tinh_ngay).toBe(4_750_000);
    wallets = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    expect(wallets.find((w) => w.wallet.id === 'hh_tien_mat')!.so_du_hien_tai).toBe(700_000);
    debt = computeDebtAndPayables(snap, '2026-10');
    expect(debt.nha_cung_cap.tong_no_ncc).toBe(800_000);
  });

  it('5. Báo cáo tháng: tự tạm ước tính điện/nước/ga/gia vị theo tháng trước cho tới khi nhập số thật', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Monthly_${Date.now()}`);
    const me = await repo.loginWithPin('me', '2222');

    // Tháng 09/2026 có hóa đơn điện + gas = 4.500.000đ
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_tien_gas',
      so_tien: 2_000_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Gas tháng 9',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 2_500_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Điện tháng 9',
      nguon: 'tay',
      nguoi_tao: 'me',
    });

    // Tháng 10/2026 nấu 200 suất trưa x 28k = 5.600.000đ, chưa có hóa đơn điện/gas tháng 10
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-15',
      bua: 'trua',
      suat_truong: 200,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'me',
    });

    let snap = await repo.getBookSnapshot(me, 'tien_du');
    let oct = computeMonthlyReport(snap, '2026-10');
    expect(oct.la_uoc_tinh_tu_thang_truoc).toBe(true);
    expect(oct.tong_chi_cuoi_thang_ap_dung).toBe(4_500_000);
    expect(oct.lai_rong_toan_co_so).toBe(1_100_000); // 5.6tr - 4.5tr tạm tính

    // Đầu tháng 11 Mẹ nhập hóa đơn thật của kỳ 2026-10: tổng 4.800.000đ -> tự chuyển sang số thực tế!
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-11-03',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 4_800_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Điện + gas tháng 10 thực tế',
      nguon: 'tay',
      nguoi_tao: 'me',
    });

    snap = await repo.getBookSnapshot(me, 'tien_du');
    oct = computeMonthlyReport(snap, '2026-10');
    expect(oct.la_uoc_tinh_tu_thang_truoc).toBe(false);
    expect(oct.tong_chi_cuoi_thang_ap_dung).toBe(4_800_000);
    expect(oct.lai_rong_toan_co_so).toBe(800_000);
  });
});
