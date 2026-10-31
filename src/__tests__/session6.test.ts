import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDexieAdapter } from '../db';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
  computeSupplierLedgerDetail,
  computeWalletBalances,
  computeWalletReconciliationDiff,
  computeWalletTimeline,
} from '../domain/accounting';
import { evaluateActiveReminders } from '../domain/reminders';

describe('Phiên 6 — Dòng tiền 3 Ví, Đếm tiền thực tế, Sổ nợ FIFO & 5 Thẻ Nhắc Việc Thông Minh', () => {
  it('1. Giả lập dòng tiền 3 ví, Chuyển quỹ nội bộ & Đếm tiền thực tế (dieu_chinh_vi) không làm lệch Lãi Lỗ', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S6_Cashflow_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');

    // Khởi tạo số dư đầu kỳ cho 3 ví Hiệp Hòa:
    // Tiền mặt: 5.000.000 | TK Mợ Diệp: 0 | TK Chị Nhàn: 2.000.000 => Tổng đầu kỳ = 7.000.000
    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    const wTm = snap.wallets.find((w) => w.id === 'hh_tien_mat')!;
    const wNhan = snap.wallets.find((w) => w.id === 'hh_tk_chi_nhan')!;
    await repo.updateWallet(bo, { ...wTm, so_du_dau_ky: 5_000_000 });
    await repo.updateWallet(bo, { ...wNhan, so_du_dau_ky: 2_000_000 });

    // 1) Ngày 01/10: Báo 200 suất trưa trường (x 25k = 5tr) + 10 suất vãng lai (x 30k = 300k)
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      bua: 'trua',
      suat_truong: 200,
      suat_vang_lai: 10,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // 2) Mua rau trả tiền mặt 800k + Mua thịt GHI SỔ NỢ 2.400.000
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 800_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua rau củ trả luôn',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 2_400_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Lấy thịt lợn ghi sổ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // 3) Chốt thu cuối ngày: Tiền mặt 1.500.000 + CK Chị Nhàn 600.000 (Tổng quầy = 2.1tr; trừ 300k vãng lai => Căn tin = 1.8tr)
    await repo.saveDailyCollection(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      tien_mat: 1_500_000,
      chuyen_khoan: 600_000,
      nguon: 'tay',
    });

    // 4) Ngày 02/10: Chị Nhàn rút 1.000.000 từ TK Chị Nhàn đưa tiền mặt cho Bố đi chợ (Chuyển quỹ)
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-02',
      mang: 'chung',
      loai: 'chuyen_quy',
      category_id: 'cat_chuyen_quy',
      so_tien: 1_000_000,
      wallet_id: 'hh_tk_chi_nhan',
      to_wallet_id: 'hh_tien_mat',
      ghi_chu: 'Chị Nhàn rút đưa Bố',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    let balances = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    const balMap = Object.fromEntries(balances.map((b) => [b.wallet.id, b.so_du_hien_tai]));

    // Kiểm tra số dư từng ví (tuyệt đối KHÔNG trừ 2.4tr mua chịu, KHÔNG cộng 5tr tiền trường chưa về):
    // Tiền mặt: 5.0tr - 0.8tr + 1.5tr + 1.0tr (chuyển quỹ) = 6.700.000
    // TK Mợ Diệp: 0
    // TK Chị Nhàn: 2.0tr + 0.6tr - 1.0tr (chuyển quỹ) = 1.600.000
    expect(balMap.hh_tien_mat).toBe(6_700_000);
    expect(balMap.hh_tk_mo_diep).toBe(0);
    expect(balMap.hh_tk_chi_nhan).toBe(1_600_000);

    // Kiểm tra Dòng thời gian (Timeline) toàn cơ sở & lọc từng ví:
    const allTimeline = computeWalletTimeline(snap);
    // Phải có 4 giao dịch thực tiền (chi rau 800k, thu TM 1.5tr, thu CK 600k, chuyển quỹ 1tr) - KHÔNG có chi_no!
    expect(allTimeline).toHaveLength(4);
    expect(allTimeline.some((e) => e.tx.loai === 'chi_no')).toBe(false);
    // Dòng mới nhất trên cùng có số dư lũy kế bằng đúng tổng tiền 3 ví (6.7tr + 1.6tr = 8.300.000)
    expect(allTimeline[0].so_du_sau_gd).toBe(8_300_000);

    const tmTimeline = computeWalletTimeline(snap, { walletId: 'hh_tien_mat' });
    expect(tmTimeline[0].so_du_sau_gd).toBe(6_700_000);

    const nhanTimeline = computeWalletTimeline(snap, { walletId: 'hh_tk_chi_nhan' });
    expect(nhanTimeline[0].so_du_sau_gd).toBe(1_600_000);

    // Lưu lại Lãi ước tính ngày 01/10 & Lãi ròng tháng 10 trước khi đếm tiền thực tế:
    const dailyBefore = computeDailyReport(snap, '2026-10-01');
    const monthlyBefore = computeMonthlyReport(snap, '2026-10');

    // 5) ĐẾM TIỀN THỰC TẾ TRONG KÉT (Bố đếm Tiền mặt chỉ còn 6.665.000 -> hụt 35.000 tiền lẻ):
    const diffShortage = computeWalletReconciliationDiff(balMap.hh_tien_mat, 6_665_000);
    expect(diffShortage).toEqual({
      so_du_so_sach: 6_700_000,
      tien_dem_thuc_te: 6_665_000,
      chenh_lech: -35_000,
      trang_thai: 'hut',
    });

    const adjMinusTx = await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-02',
      mang: 'chung',
      loai: 'dieu_chinh_vi',
      category_id: 'cat_dieu_chinh_vi',
      so_tien: diffShortage.chenh_lech,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Kiểm két chiều 02/10 lệch tiền lẻ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    balances = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    expect(balances.find((b) => b.wallet.id === 'hh_tien_mat')!.so_du_hien_tai).toBe(
      6_665_000
    );
    expect(
      computeWalletTimeline(snap, { walletId: 'hh_tien_mat' })[0].so_du_sau_gd
    ).toBe(6_665_000);

    // 6) ĐẾM TIỀN THỰC TẾ TRƯỜNG HỢP THỪA (+20.000 trong TK Chị Nhàn do lãi không kỳ hạn):
    const diffSurplus = computeWalletReconciliationDiff(1_600_000, 1_620_000);
    expect(diffSurplus.trang_thai).toBe('thua');
    expect(diffSurplus.chenh_lech).toBe(20_000);

    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-02',
      mang: 'chung',
      loai: 'dieu_chinh_vi',
      category_id: 'cat_dieu_chinh_vi',
      so_tien: diffSurplus.chenh_lech,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'Lãi ngân hàng lẻ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    balances = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    expect(balances.find((b) => b.wallet.id === 'hh_tk_chi_nhan')!.so_du_hien_tai).toBe(
      1_620_000
    );

    // BÁO CÁO LÃI LỖ NGÀY & THÁNG TUYỆT ĐỐI KHÔNG BỊ SAI LỆCH 1 ĐỒNG NÀO!
    const dailyAfter = computeDailyReport(snap, '2026-10-01');
    const monthlyAfter = computeMonthlyReport(snap, '2026-10');
    expect(dailyAfter.bep_an.lai_uoc_tinh_ngay).toBe(dailyBefore.bep_an.lai_uoc_tinh_ngay);
    expect(monthlyAfter.lai_rong_toan_co_so).toBe(monthlyBefore.lai_rong_toan_co_so);

    // Hoàn tác bút toán điều chỉnh -> số dư ví Tiền mặt quay về 6.700.000
    await repo.softDeleteTransaction(bo, 'hiep_hoa', adjMinusTx.id);
    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    balances = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    expect(balances.find((b) => b.wallet.id === 'hh_tien_mat')!.so_du_hien_tai).toBe(
      6_700_000
    );
  });

  it('2. Sổ Nợ Nhà Cung Cấp: Lịch sử lũy kế (du_no_sau_gd), tuổi nợ FIFO chính xác khi trả bớt & trả hết 1 chạm', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S6_DebtFIFO_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');

    // Ngày 01/10: Mua chịu thịt lần 1 = 3.200.000
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 3_200_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Thịt lợn đầu tháng',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // Ngày 10/10: Mua chịu thịt lần 2 = 1.800.000 (Tổng nợ = 5.000.000)
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-10',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 1_800_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Xương ống + ba chỉ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // Kiểm tra tại ngày 16/10: Khoản 01/10 đã 15 ngày
    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    let detail = computeSupplierLedgerDetail(snap, 'sup_hh_thit', '2026-10-16')!;
    expect(detail.con_no).toBe(5_000_000);
    expect(detail.ngay_no_cu_nhat).toBe('2026-10-01');
    expect(detail.so_ngay_no_lau_nhat).toBe(15);

    // TRẢ 1 PHẦN LẦN 1 (1.800.000 ngày 16/10):
    // Chưa trả hết khoản 3.2tr ngày 01/10 (vẫn còn 1.4tr của đơn 01/10) => tuổi nợ vẫn là 15 ngày!
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-16',
      mang: 'chung',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 1_800_000,
      wallet_id: 'hh_tien_mat',
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Trả bớt đợt 1',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    detail = computeSupplierLedgerDetail(snap, 'sup_hh_thit', '2026-10-16')!;
    expect(detail.con_no).toBe(3_200_000);
    expect(detail.ngay_no_cu_nhat).toBe('2026-10-01');
    expect(detail.so_ngay_no_lau_nhat).toBe(15);

    // TRẢ 1 PHẦN LẦN 2 (1.500.000 ngày 17/10 => Tổng đã trả = 3.300.000 > 3.200.000!):
    // Đơn ngày 01/10 ĐÃ TẤT TOÁN XONG 100%! Khoản còn nợ 1.700.000 là của đơn ngày 10/10!
    // Tại ngày 17/10, tuổi nợ FIFO phải tự động lùi về 7 ngày (17/10 - 10/10 = 7 ngày)!
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-17',
      mang: 'chung',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 1_500_000,
      wallet_id: 'hh_tien_mat',
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Trả đứt đơn ngày 1/10 và một phần đơn 10/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    detail = computeSupplierLedgerDetail(snap, 'sup_hh_thit', '2026-10-17')!;
    expect(detail.con_no).toBe(1_700_000);
    expect(detail.ngay_no_cu_nhat).toBe('2026-10-10');
    expect(detail.so_ngay_no_lau_nhat).toBe(7);

    // Kiểm tra lịch sử chi tiết từng lần (mới nhất xếp trên đầu):
    expect(detail.lich_su).toHaveLength(4);
    expect(detail.lich_su[0].du_no_sau_gd).toBe(1_700_000);
    expect(detail.lich_su[1].du_no_sau_gd).toBe(3_200_000);
    expect(detail.lich_su[2].du_no_sau_gd).toBe(5_000_000);
    expect(detail.lich_su[3].du_no_sau_gd).toBe(3_200_000);

    // TRẢ HẾT 1 CHẠM (1.700.000 ngày 20/10):
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-20',
      mang: 'chung',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 1_700_000,
      wallet_id: 'hh_tk_chi_nhan',
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Tất toán 1 chạm',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    detail = computeSupplierLedgerDetail(snap, 'sup_hh_thit', '2026-10-20')!;
    expect(detail.con_no).toBe(0);
    expect(detail.ngay_no_cu_nhat).toBeNull();
    expect(detail.so_ngay_no_lau_nhat).toBe(0);
    expect(detail.lich_su[0].du_no_sau_gd).toBe(0);

    const summary = computeDebtAndPayables(snap, '2026-10', '2026-10-20');
    expect(summary.nha_cung_cap.tong_no_ncc).toBe(0);
  });

  it('3. Giả lập 1 tháng vận hành 5 loại Thẻ Nhắc Việc 🔔: Bật đúng ngày/giờ, tính đúng tiền & Tự tắt 100% khi nhập đủ', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S6_Reminders_${Date.now()}`);
    const me = await repo.loginWithPin('me', '2222');

    // Đổi tên nhà cung cấp mẫu ở Tiên Du thành "Chị Hoa" để kiểm tra đúng câu nhắc mẫu
    await repo.upsertSupplier(me, {
      id: 'sup_td_thit',
      book_id: 'tien_du',
      ten_ncc: 'Chị Hoa',
      mat_hang_chinh: 'Thịt lợn sạch',
      no_dau_ky: 0,
      dang_giao_dich: true,
    });

    // Chuẩn bị hóa đơn tháng 09/2026 ở Tiên Du = 4.800.000 (làm mốc tạm ước tính cho tháng 10)
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 3_000_000,
      wallet_id: 'td_tk_chi_nhan',
      ghi_chu: 'Điện tháng 9 Tiên Du',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_tien_gas',
      so_tien: 1_800_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Gas tháng 9 Tiên Du',
      nguon: 'tay',
      nguoi_tao: 'me',
    });

    // =========================================================================
    // LUẬT 1: NHẮC 18:00 HẰNG NGÀY CHƯA NHẬP SUẤT ĂN / THU CUỐI NGÀY CĂN TIN
    // =========================================================================
    let snap = await repo.getBookSnapshot(me, 'tien_du');
    // Lúc 17:59 ngày 01/10 -> Chưa tới 18:00 nên KHÔNG nhắc
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-01',
        currentTimeHHmm: '17:59',
      }).some((r) => r.loai_nhac === 'nhap_so_ngay')
    ).toBe(false);

    // Đúng 18:00 ngày 01/10 -> Bật nhắc chưa ghi suất ăn & thu cuối ngày
    let rem1800 = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-01',
      currentTimeHHmm: '18:00',
    });
    expect(rem1800.find((r) => r.loai_nhac === 'nhap_so_ngay')?.tieu_de).toContain(
      'Chưa ghi suất ăn & thu cuối ngày'
    );

    // Mẹ nhập 250 suất trưa trường Tiên Du (đơn giá Tiên Du 28k => 7.000.000đ)
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-01',
      bua: 'trua',
      suat_truong: 250,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    rem1800 = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-01',
      currentTimeHHmm: '18:05',
    });
    // Đã có suất ăn nhưng thiếu thu cuối ngày -> Đổi sang nhắc thu cuối ngày Căn tin
    const cardOnlyCt = rem1800.find((r) => r.loai_nhac === 'nhap_so_ngay')!;
    expect(cardOnlyCt.tieu_de).toContain('Chưa nhập tổng thu cuối ngày Căn tin');
    expect(cardOnlyCt.action_target).toEqual({ type: 'form', kind: 'thu_cuoi_ngay' });

    // Mẹ nhập thu cuối ngày Căn tin -> Thẻ nhắc 18:00 TỰ TẮT NGAY LẬP TỨC!
    await repo.saveDailyCollection(me, {
      book_id: 'tien_du',
      ngay: '2026-10-01',
      tien_mat: 1_900_000,
      chuyen_khoan: 500_000,
      nguon: 'tay',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-01',
        currentTimeHHmm: '18:10',
      }).some((r) => r.loai_nhac === 'nhap_so_ngay')
    ).toBe(false);

    // Kiểm tra nút "Hôm nay nghỉ" (bo_qua) vào Chủ Nhật 04/10:
    const sunCard = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-04',
      currentTimeHHmm: '19:00',
    }).find((r) => r.loai_nhac === 'nhap_so_ngay')!;
    expect(sunCard).toBeDefined();

    await repo.upsertReminder(me, {
      book_id: 'tien_du',
      loai_nhac: 'nhap_so_ngay',
      ky_thang: sunCard.ky_thang,
      tieu_de: sunCard.tieu_de,
      noi_dung: sunCard.noi_dung,
      ngay_bat_dau_nhac: '2026-10-04',
      trang_thai: 'bo_qua',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    // Tắt hẳn trong ngày Chủ Nhật 04/10...
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-04',
        currentTimeHHmm: '20:00',
      }).some((r) => r.loai_nhac === 'nhap_so_ngay')
    ).toBe(false);
    // ...nhưng sang Thứ Hai 05/10 lúc 18:00 lại nhắc bình thường!
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-05',
        currentTimeHHmm: '18:00',
      }).some((r) => r.loai_nhac === 'nhap_so_ngay')
    ).toBe(true);

    // =========================================================================
    // LUẬT 5: NỢ NHÀ CUNG CẤP QUÁ 15 NGÀY ("Nợ Chị Hoa 3,2 triệu đã 15 ngày")
    // =========================================================================
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 3_200_000,
      wallet_id: null,
      supplier_id: 'sup_td_thit',
      ghi_chu: 'Mua chịu thịt Chị Hoa đầu tháng',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');

    // Ngày 15/10 (mới 14 ngày) -> Chưa nhắc quá hạn
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-15',
        currentTimeHHmm: '09:00',
      }).some((r) => r.loai_nhac === 'no_qua_han')
    ).toBe(false);

    // Ngày 16/10 (tròn 15 ngày) -> Bật nhắc đúng câu "Nợ Chị Hoa 3,2 triệu đã 15 ngày"
    const debtCards15 = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-16',
      currentTimeHHmm: '09:00',
    });
    const hoaCard = debtCards15.find((r) => r.loai_nhac === 'no_qua_han')!;
    expect(hoaCard).toBeDefined();
    expect(hoaCard.tieu_de).toBe('Nợ Chị Hoa 3,2 triệu đã 15 ngày');
    expect(hoaCard.so_tien_du_kien).toBe(3_200_000);
    expect(hoaCard.action_target).toEqual({
      type: 'tab_no',
      supplierId: 'sup_td_thit',
    });

    // Thử đổi cài đặt hạn nhắc nợ của Sổ Tiên Du lên 18 ngày:
    await repo.updateBookSettings(me, {
      ...snap.book,
      so_ngay_nhac_no_ncc: 18,
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-16',
        currentTimeHHmm: '09:00',
      }).some((r) => r.loai_nhac === 'no_qua_han')
    ).toBe(false);
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-19',
        currentTimeHHmm: '09:00',
      }).find((r) => r.loai_nhac === 'no_qua_han')?.tieu_de
    ).toBe('Nợ Chị Hoa 3,2 triệu đã 18 ngày');

    // Mẹ trả hết 3.200.000 cho Chị Hoa -> Thẻ nhắc nợ quá hạn TỰ TẮT 100%!
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-19',
      mang: 'chung',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 3_200_000,
      wallet_id: 'td_tien_mat',
      supplier_id: 'sup_td_thit',
      ghi_chu: 'Trả hết nợ Chị Hoa',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-19',
        currentTimeHHmm: '10:00',
      }).some((r) => r.loai_nhac === 'no_qua_han')
    ).toBe(false);

    // =========================================================================
    // LUẬT 2: TỪ NGÀY 20 NHẮC TRƯỜNG CHƯA CHUYỂN TIỀN THÁNG 10 KÈM SỐ DỰ KIẾN
    // =========================================================================
    // Đã có 250 suất ngày 01/10, thêm 750 suất ngày 15/10 => Tổng 1.000 suất x 28.000 = 28.000.000đ
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-15',
      bua: 'trua',
      suat_truong: 750,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');

    // Ngày 19/10 -> Chưa tới ngày 20 nên chưa nhắc
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-19',
        currentTimeHHmm: '09:00',
      }).some((r) => r.loai_nhac === 'truong_chuyen_tien')
    ).toBe(false);

    // Ngày 20/10 -> Bật nhắc đúng số tiền dự kiến 28.000.000đ
    let schoolCard = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-20',
      currentTimeHHmm: '09:00',
    }).find((r) => r.loai_nhac === 'truong_chuyen_tien')!;
    expect(schoolCard).toBeDefined();
    expect(schoolCard.so_tien_du_kien).toBe(28_000_000);

    // Trường tạm chuyển đợt 1: 18.000.000 -> Còn nhắc 10.000.000
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-22',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'truong_chuyen',
      category_id: 'cat_truong_chuyen',
      so_tien: 18_000_000,
      wallet_id: 'td_tk_mo_diep',
      ghi_chu: 'Trường chuyển đợt 1',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    schoolCard = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-22',
      currentTimeHHmm: '10:00',
    }).find((r) => r.loai_nhac === 'truong_chuyen_tien')!;
    expect(schoolCard.so_tien_du_kien).toBe(10_000_000);

    // Trường chuyển nốt 10.000.000 ngày 24/10 -> Thẻ nhắc trường chuyển TỰ TẮT 100%!
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-24',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'truong_chuyen',
      category_id: 'cat_truong_chuyen',
      so_tien: 10_000_000,
      wallet_id: 'td_tk_mo_diep',
      ghi_chu: 'Trường chuyển đủ tháng 10',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-24',
        currentTimeHHmm: '11:00',
      }).some((r) => r.loai_nhac === 'truong_chuyen_tien')
    ).toBe(false);

    // =========================================================================
    // LUẬT 3: CUỐI THÁNG (NGÀY >= 25) NHẮC TRẢ LƯƠNG THỢ KÈM SỐ TIỀN GỢI Ý
    // =========================================================================
    // Chấm công Cô Mai 10 công x 260k = 2.600.000, đã ứng 600.000 => Còn gợi ý 2.000.000
    for (let d = 1; d <= 10; d++) {
      const iso = `2026-10-${String(d).padStart(2, '0')}`;
      await repo.upsertAttendance(me, {
        book_id: 'tien_du',
        worker_id: 'wk_td_1',
        ngay: iso,
        so_cong: 1,
        don_gia_cong: 260_000,
      });
    }
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-12',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'tra_luong',
      category_id: 'cat_tra_luong',
      so_tien: 600_000,
      wallet_id: 'td_tien_mat',
      worker_id: 'wk_td_1',
      ghi_chu: 'Cô Mai ứng giữa tháng',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');

    // Ngày 24/10 -> Chưa tới ngày 25 nên chưa nhắc trả lương tháng 10
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-24',
        currentTimeHHmm: '09:00',
      }).some((r) => r.loai_nhac === 'tra_luong')
    ).toBe(false);

    // Ngày 25/10 -> Bật nhắc trả lương kèm số tiền gợi ý 2.000.000đ
    const wageCard = evaluateActiveReminders(snap, {
      referenceDate: '2026-10-25',
      currentTimeHHmm: '09:00',
    }).find((r) => r.loai_nhac === 'tra_luong')!;
    expect(wageCard).toBeDefined();
    expect(wageCard.so_tien_du_kien).toBe(2_000_000);

    // Mẹ trả nốt 2.000.000 lương Cô Mai -> Thẻ nhắc trả lương TỰ TẮT 100%!
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-30',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'tra_luong',
      category_id: 'cat_tra_luong',
      so_tien: 2_000_000,
      wallet_id: 'td_tien_mat',
      worker_id: 'wk_td_1',
      ghi_chu: 'Trả đủ lương Cô Mai tháng 10',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-30',
        currentTimeHHmm: '10:00',
      }).some((r) => r.loai_nhac === 'tra_luong')
    ).toBe(false);

    // =========================================================================
    // LUẬT 4: ĐẦU THÁNG SAU (02/11) NHẮC NHẬP ĐIỆN, NƯỚC, GA, GIA VỊ THÁNG 10
    // =========================================================================
    // Ngày 27/10 -> Chưa tới cuối tháng/đầu tháng sau nên chưa nhắc
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-10-27',
        currentTimeHHmm: '09:00',
      }).some((r) => r.loai_nhac === 'chi_phi_thang')
    ).toBe(false);

    // Đầu tháng sau (02/11/2026) -> Nhắc nhập hóa đơn tháng 10/2026 (báo đang tạm mượn 4.8tr của tháng 9)
    const billCard = evaluateActiveReminders(snap, {
      referenceDate: '2026-11-02',
      currentTimeHHmm: '09:00',
    }).find((r) => r.loai_nhac === 'chi_phi_thang' && r.ky_thang === '2026-10')!;
    expect(billCard).toBeDefined();
    expect(billCard.so_tien_du_kien).toBe(4_800_000);
    expect(billCard.noi_dung).toContain('tạm mượn mức tháng trước');

    // Mẹ nhập hóa đơn điện thực tế của kỳ tháng 10/2026 vào ngày 02/11 -> TỰ TẮT 100%!
    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 3_150_000,
      wallet_id: 'td_tk_chi_nhan',
      ghi_chu: 'Hóa đơn điện tháng 10 Tiên Du',
      nguon: 'tay',
      nguoi_tao: 'me',
    });
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(
      evaluateActiveReminders(snap, {
        referenceDate: '2026-11-02',
        currentTimeHHmm: '09:30',
      }).some((r) => r.loai_nhac === 'chi_phi_thang' && r.ky_thang === '2026-10')
    ).toBe(false);
  });
});
