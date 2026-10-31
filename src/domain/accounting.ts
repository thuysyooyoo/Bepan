import type {
  Attendance,
  BookId,
  BookSnapshot,
  Category,
  GuestType,
  MealCount,
  MealPeriod,
  MealPrice,
  Supplier,
  Transaction,
  Wallet,
  Worker,
} from '../types/models';
import { getPreviousYearMonth, getYearMonth } from './format';

/**
 * 1. Tra cứu đơn giá suất ăn có hiệu lực tại một ngày cụ thể.
 * Giữ nguyên lịch sử: khi trường tăng giá từ tháng 11, số liệu tháng 10 không bị nhảy sai.
 */
export function getEffectiveMealPrice(
  prices: MealPrice[],
  bookId: BookId,
  bua: MealPeriod,
  loaiKhach: GuestType,
  ngay: string
): number {
  const candidates = prices
    .filter(
      (p) =>
        p.book_id === bookId &&
        p.bua === bua &&
        p.loai_khach === loaiKhach &&
        p.ap_dung_tu_ngay <= ngay
    )
    .sort((a, b) => b.ap_dung_tu_ngay.localeCompare(a.ap_dung_tu_ngay));

  if (candidates.length > 0) {
    return candidates[0].don_gia;
  }

  // Nếu vãng lai chưa cài đặt giá riêng, mặc định lấy bằng giá suất trường
  if (loaiKhach === 'vang_lai') {
    return getEffectiveMealPrice(prices, bookId, bua, 'truong', ngay);
  }

  return 0;
}

export interface DailyMealBreakdown {
  suat_truong: number;
  suat_vang_lai: number;
  doanh_thu_truong: number;
  doanh_thu_vang_lai: number;
  tong_doanh_thu_suat_an: number;
  chi_tiet_bua: Record<
    MealPeriod,
    {
      suat_truong: number;
      don_gia_truong: number;
      suat_vang_lai: number;
      don_gia_vang_lai: number;
      thanh_tien_truong: number;
      thanh_tien_vang_lai: number;
    }
  >;
}

export function computeDailyMealRevenue(
  mealCounts: MealCount[],
  mealPrices: MealPrice[],
  bookId: BookId,
  ngay: string
): DailyMealBreakdown {
  const periods: MealPeriod[] = ['sang', 'trua', 'toi'];
  const chi_tiet_bua = {} as DailyMealBreakdown['chi_tiet_bua'];

  let suat_truong = 0;
  let suat_vang_lai = 0;
  let doanh_thu_truong = 0;
  let doanh_thu_vang_lai = 0;

  for (const bua of periods) {
    const rec = mealCounts.find(
      (m) => m.book_id === bookId && m.ngay === ngay && m.bua === bua
    );
    const st = rec?.suat_truong ?? 0;
    const svl = rec?.suat_vang_lai ?? 0;
    const dgTruong = getEffectiveMealPrice(mealPrices, bookId, bua, 'truong', ngay);
    const dgVangLai = getEffectiveMealPrice(mealPrices, bookId, bua, 'vang_lai', ngay);

    const ttTruong = st * dgTruong;
    const ttVangLai = svl * dgVangLai;

    chi_tiet_bua[bua] = {
      suat_truong: st,
      don_gia_truong: dgTruong,
      suat_vang_lai: svl,
      don_gia_vang_lai: dgVangLai,
      thanh_tien_truong: ttTruong,
      thanh_tien_vang_lai: ttVangLai,
    };

    suat_truong += st;
    suat_vang_lai += svl;
    doanh_thu_truong += ttTruong;
    doanh_thu_vang_lai += ttVangLai;
  }

  return {
    suat_truong,
    suat_vang_lai,
    doanh_thu_truong,
    doanh_thu_vang_lai,
    tong_doanh_thu_suat_an: doanh_thu_truong + doanh_thu_vang_lai,
    chi_tiet_bua,
  };
}

/**
 * Tìm ngày gần nhất trước `beforeNgay` có báo suất ăn trường (> 0) để nút "Giống hôm qua"
 * hoạt động thông minh cả vào sáng Thứ Hai (tự lấy Thứ Sáu/Thứ Bảy tuần trước nếu Chủ nhật nghỉ).
 */
export function findPreviousMealDay(
  mealCounts: MealCount[],
  bookId: BookId,
  beforeNgay: string
): { ngay: string; sang: number; trua: number; toi: number } | null {
  const prevDates = Array.from(
    new Set(
      mealCounts
        .filter((m) => m.book_id === bookId && m.ngay < beforeNgay && m.suat_truong > 0)
        .map((m) => m.ngay)
    )
  ).sort((a, b) => b.localeCompare(a));

  if (prevDates.length === 0) return null;
  const targetDate = prevDates[0];
  const dayRecs = mealCounts.filter((m) => m.book_id === bookId && m.ngay === targetDate);

  const getCount = (bua: MealPeriod) =>
    dayRecs.find((r) => r.bua === bua)?.suat_truong ?? 0;

  return {
    ngay: targetDate,
    sang: getCount('sang'),
    trua: getCount('trua'),
    toi: getCount('toi'),
  };
}

export interface DailyReport {
  ngay: string;
  bep_an: {
    suat_truong: number;
    suat_vang_lai: number;
    doanh_thu_truong: number;
    doanh_thu_vang_lai: number;
    thu_khac: number;
    tong_doanh_thu: number;
    chi_nguyen_lieu_ngay: number; // gồm cả trả ngay ('chi') và mua chịu ('chi_no') thuộc theo_ngay
    chi_cong_tho_ngay: number;
    tong_chi_ngay: number;
    lai_uoc_tinh_ngay: number; // Chưa gồm điện, nước, gas, gia vị cuối tháng
  };
  can_tin: {
    tong_thu_quay_cuoi_ngay: number; // Tổng TM + CK chị Nhàn ông bà báo cuối ngày
    tru_tien_vang_lai: number;       // Phần tiền vãng lai tách sang Bếp ăn (Cách A)
    doanh_thu_can_tin: number;       // Thu thuần của Căn tin sau khi trừ vãng lai + thu khác CT
    chi_nhap_hang_ngay: number;      // Tiền nhập hàng căn tin phát sinh hôm nay (không tính lãi ngày CT)
    canh_bao_lech_vang_lai: boolean; // True nếu đã nhập thu cuối ngày nhưng nhỏ hơn tiền vãng lai
  };
}

function isDailyCalcCategory(categories: Category[], categoryId: string): boolean {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return true;
  return cat.kieu_tinh === 'theo_ngay';
}

/**
 * 2. Tính báo cáo HÔM NAY:
 * - Bếp ăn: có Lãi ước tính ngày (Suất trường + Vãng lai − Tiền chợ ngày − Công thợ ngày).
 * - Căn tin: theo đúng yêu cầu, chỉ hiện Thu & Chi nhập hàng trong ngày (không tính lãi ngày).
 * - Cách A: Tổng thu quầy cuối ngày tự động trừ đi tiền vãng lai của ngày đó để ra doanh thu Căn tin.
 */
export function computeDailyReport(snapshot: BookSnapshot, ngay: string): DailyReport {
  const bookId = snapshot.book.id;
  const mealRev = computeDailyMealRevenue(
    snapshot.mealCounts,
    snapshot.mealPrices,
    bookId,
    ngay
  );

  const activeTxs = snapshot.transactions.filter(
    (t) => t.book_id === bookId && !t.da_xoa && t.ngay === ngay
  );

  // Thu khác trực tiếp của Bếp ăn
  const thuKhacBep = activeTxs
    .filter((t) => t.loai === 'thu' && t.mang === 'bep_an')
    .reduce((sum, t) => sum + t.so_tien, 0);

  // Chi nguyên liệu theo ngày của Bếp ăn (cả trả tiền ngay 'chi' lẫn mua chịu 'chi_no')
  const chiNguyenLieuBep = activeTxs
    .filter(
      (t) =>
        (t.loai === 'chi' || t.loai === 'chi_no') &&
        t.mang === 'bep_an' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  // Chi công thợ theo chấm công ngày
  const chiCongThoNgay = snapshot.attendance
    .filter((a) => a.book_id === bookId && a.ngay === ngay)
    .reduce((sum, a) => sum + a.so_cong * a.don_gia_cong, 0);

  const tongDoanhThuBep = mealRev.tong_doanh_thu_suat_an + thuKhacBep;
  const tongChiNgayBep = chiNguyenLieuBep + chiCongThoNgay;
  const laiUocTinhNgayBep = tongDoanhThuBep - tongChiNgayBep;

  // Cách A cho Căn tin: Tổng tiền thu cuối ngày (TM + CK) trừ phần suất vãng lai
  const tongThuQuayCuoiNgay = activeTxs
    .filter((t) => t.loai === 'thu_cuoi_ngay')
    .reduce((sum, t) => sum + t.so_tien, 0);

  const thuKhacCanTin = activeTxs
    .filter((t) => t.loai === 'thu' && t.mang === 'can_tin')
    .reduce((sum, t) => sum + t.so_tien, 0);

  const coNhapThuCuoiNgay = tongThuQuayCuoiNgay > 0;
  const canhBaoLechVangLai =
    coNhapThuCuoiNgay && tongThuQuayCuoiNgay < mealRev.doanh_thu_vang_lai;

  const thuCanTinTuQuay = coNhapThuCuoiNgay
    ? Math.max(0, tongThuQuayCuoiNgay - mealRev.doanh_thu_vang_lai)
    : 0;

  const doanhThuCanTin = thuCanTinTuQuay + thuKhacCanTin;

  const chiNhapHangCanTin = activeTxs
    .filter(
      (t) =>
        (t.loai === 'chi' || t.loai === 'chi_no') &&
        t.mang === 'can_tin' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  return {
    ngay,
    bep_an: {
      suat_truong: mealRev.suat_truong,
      suat_vang_lai: mealRev.suat_vang_lai,
      doanh_thu_truong: mealRev.doanh_thu_truong,
      doanh_thu_vang_lai: mealRev.doanh_thu_vang_lai,
      thu_khac: thuKhacBep,
      tong_doanh_thu: tongDoanhThuBep,
      chi_nguyen_lieu_ngay: chiNguyenLieuBep,
      chi_cong_tho_ngay: chiCongThoNgay,
      tong_chi_ngay: tongChiNgayBep,
      lai_uoc_tinh_ngay: laiUocTinhNgayBep,
    },
    can_tin: {
      tong_thu_quay_cuoi_ngay: tongThuQuayCuoiNgay,
      tru_tien_vang_lai: coNhapThuCuoiNgay ? mealRev.doanh_thu_vang_lai : 0,
      doanh_thu_can_tin: doanhThuCanTin,
      chi_nhap_hang_ngay: chiNhapHangCanTin,
      canh_bao_lech_vang_lai: canhBaoLechVangLai,
    },
  };
}

export interface MonthlyReport {
  ky_thang: string; // YYYY-MM
  bep_an: {
    tong_suat_truong: number;
    tong_suat_vang_lai: number;
    doanh_thu: number;
    chi_ngay: number; // nguyên liệu + công thợ
    chi_cuoi_thang_rieng: number; // gia vị, gas gắn riêng mảng bếp ăn
    lai_bep_an: number;
  };
  can_tin: {
    doanh_thu: number;
    chi_nhap_hang: number;
    chi_cuoi_thang_rieng: number;
    lai_can_tin: number;
  };
  chi_cuoi_thang_chung: number; // điện, nước, vệ sinh chung
  tong_chi_cuoi_thang_ap_dung: number;
  la_uoc_tinh_tu_thang_truoc: boolean; // True nếu tháng này chưa nhập chi phí tháng, lấy tạm tháng trước
  lai_rong_toan_co_so: number;
}

/**
 * 3. Tính báo cáo THÁNG (chỉ trừ chi phí cuối tháng vào lợi nhuận tháng, không chia theo ngày).
 * Nếu tháng hiện tại chưa nhập chi phí cuối tháng (gia vị, điện, nước, gas), tự lấy tháng trước làm mức tạm ước tính.
 */
export function computeMonthlyReport(snapshot: BookSnapshot, kyThang: string): MonthlyReport {
  const bookId = snapshot.book.id;

  // Tập hợp tất cả các ngày có dữ liệu suất ăn, chấm công hoặc giao dịch trong tháng
  const dateSet = new Set<string>();
  for (const m of snapshot.mealCounts) {
    if (m.book_id === bookId && getYearMonth(m.ngay) === kyThang) dateSet.add(m.ngay);
  }
  for (const a of snapshot.attendance) {
    if (a.book_id === bookId && getYearMonth(a.ngay) === kyThang) dateSet.add(a.ngay);
  }
  for (const t of snapshot.transactions) {
    if (t.book_id === bookId && !t.da_xoa && getYearMonth(t.ngay) === kyThang) {
      dateSet.add(t.ngay);
    }
  }

  let tongSuatTruong = 0;
  let tongSuatVangLai = 0;
  let doanhThuBep = 0;
  let chiNgayBep = 0;
  let doanhThuCanTin = 0;
  let chiNhapHangCanTin = 0;

  for (const ngay of dateSet) {
    const daily = computeDailyReport(snapshot, ngay);
    tongSuatTruong += daily.bep_an.suat_truong;
    tongSuatVangLai += daily.bep_an.suat_vang_lai;
    doanhThuBep += daily.bep_an.tong_doanh_thu;
    chiNgayBep += daily.bep_an.tong_chi_ngay;
    doanhThuCanTin += daily.can_tin.doanh_thu_can_tin;
    chiNhapHangCanTin += daily.can_tin.chi_nhap_hang_ngay;
  }

  // Hàm lấy chi phí cuối tháng (theo_thang) của một kỳ
  const getMonthlyOverheads = (targetMonth: string) => {
    const monthlyTxs = snapshot.transactions.filter((t) => {
      if (t.book_id !== bookId || t.da_xoa) return false;
      if (t.loai !== 'chi' && t.loai !== 'chi_no') return false;
      const cat = snapshot.categories.find((c) => c.id === t.category_id);
      if (cat?.kieu_tinh !== 'theo_thang') return false;
      const effectiveMonth = t.ky_thang || getYearMonth(t.ngay);
      return effectiveMonth === targetMonth;
    });

    const bep = monthlyTxs
      .filter((t) => t.mang === 'bep_an')
      .reduce((s, t) => s + t.so_tien, 0);
    const ct = monthlyTxs
      .filter((t) => t.mang === 'can_tin')
      .reduce((s, t) => s + t.so_tien, 0);
    const chung = monthlyTxs
      .filter((t) => t.mang === 'chung')
      .reduce((s, t) => s + t.so_tien, 0);

    return { bep, ct, chung, total: bep + ct + chung };
  };

  const currentOverheads = getMonthlyOverheads(kyThang);
  let appliedOverheads = currentOverheads;
  let laUocTinh = false;

  if (currentOverheads.total === 0) {
    const prevOverheads = getMonthlyOverheads(getPreviousYearMonth(kyThang));
    if (prevOverheads.total > 0) {
      appliedOverheads = prevOverheads;
      laUocTinh = true;
    }
  }

  const laiBepAn = doanhThuBep - chiNgayBep - appliedOverheads.bep;
  const laiCanTin = doanhThuCanTin - chiNhapHangCanTin - appliedOverheads.ct;
  const laiRongToanCoSo = laiBepAn + laiCanTin - appliedOverheads.chung;

  return {
    ky_thang: kyThang,
    bep_an: {
      tong_suat_truong: tongSuatTruong,
      tong_suat_vang_lai: tongSuatVangLai,
      doanh_thu: doanhThuBep,
      chi_ngay: chiNgayBep,
      chi_cuoi_thang_rieng: appliedOverheads.bep,
      lai_bep_an: laiBepAn,
    },
    can_tin: {
      doanh_thu: doanhThuCanTin,
      chi_nhap_hang: chiNhapHangCanTin,
      chi_cuoi_thang_rieng: appliedOverheads.ct,
      lai_can_tin: laiCanTin,
    },
    chi_cuoi_thang_chung: appliedOverheads.chung,
    tong_chi_cuoi_thang_ap_dung: appliedOverheads.total,
    la_uoc_tinh_tu_thang_truoc: laUocTinh,
    lai_rong_toan_co_so: laiRongToanCoSo,
  };
}

export interface WalletBalanceSummary {
  wallet: Wallet;
  tong_tien_vao: number;
  tong_tien_ra: number;
  so_du_hien_tai: number;
}

/**
 * 4. SỔ DÒNG TIỀN (100% Thực thu - Thực chi):
 * Tuyệt đối KHÔNG cộng tiền suất ăn trường chưa về, KHÔNG trừ công thợ chưa trả, KHÔNG trừ mua chịu ('chi_no').
 */
export function computeWalletBalances(
  wallets: Wallet[],
  transactions: Transaction[],
  bookId: BookId
): WalletBalanceSummary[] {
  const bookWallets = wallets
    .filter((w) => w.book_id === bookId)
    .sort((a, b) => a.thu_tu - b.thu_tu);

  const activeTxs = transactions.filter((t) => t.book_id === bookId && !t.da_xoa);

  return bookWallets.map((wallet) => {
    let vao = 0;
    let ra = 0;

    for (const tx of activeTxs) {
      if (
        (tx.loai === 'thu_cuoi_ngay' || tx.loai === 'thu' || tx.loai === 'truong_chuyen') &&
        tx.wallet_id === wallet.id
      ) {
        vao += tx.so_tien;
      } else if (
        (tx.loai === 'chi' || tx.loai === 'tra_no' || tx.loai === 'tra_luong') &&
        tx.wallet_id === wallet.id
      ) {
        ra += tx.so_tien;
      } else if (tx.loai === 'chuyen_quy') {
        if (tx.wallet_id === wallet.id) ra += tx.so_tien;
        if (tx.to_wallet_id === wallet.id) vao += tx.so_tien;
      } else if (tx.loai === 'dieu_chinh_vi' && tx.wallet_id === wallet.id) {
        if (tx.so_tien >= 0) vao += tx.so_tien;
        else ra += Math.abs(tx.so_tien);
      }
    }

    return {
      wallet,
      tong_tien_vao: vao,
      tong_tien_ra: ra,
      so_du_hien_tai: wallet.so_du_dau_ky + vao - ra,
    };
  });
}

export interface SupplierDebtItem {
  supplier: Supplier;
  tong_mua_chiu: number;
  tong_da_tra: number;
  con_no: number;
}

export interface DebtAndPayablesSummary {
  ky_thang: string;
  // 1. Nợ nhà cung cấp (mua chịu)
  nha_cung_cap: {
    danh_sach: SupplierDebtItem[];
    tong_no_ncc: number;
  };
  // 2. Lương thợ phải trả trong kỳ tháng
  luong_tho_ky_nay: {
    tong_luong_tinh_theo_cong: number;
    da_tra_hoac_ung: number;
    con_phai_tra: number;
    chi_tiet_tho: Array<{
      worker: Worker;
      tong_cong: number;
      thanh_tien: number;
      da_ung: number;
      con_lai: number;
    }>;
  };
  // 3. Tiền trường dự kiến về trong kỳ tháng (để đối chiếu & hiện trên thẻ nhắc)
  tien_truong_ky_nay: {
    tong_suat_truong: number;
    so_tien_du_kien: number;
    truong_da_chuyen: number;
    con_cho_chuyen: number;
  };
}

/**
 * 5. SỔ NỢ & PHẢI TRẢ / DỰ KIẾN THU (Tách riêng hoàn toàn khỏi Sổ Dòng Tiền):
 * Gồm: Nợ mua chịu nhà cung cấp + Lương thợ lũy kế phải trả + Tiền suất ăn trường dự kiến về.
 */
export function computeDebtAndPayables(
  snapshot: BookSnapshot,
  kyThang: string
): DebtAndPayablesSummary {
  const bookId = snapshot.book.id;
  const activeTxs = snapshot.transactions.filter((t) => t.book_id === bookId && !t.da_xoa);

  // 1. Nợ nhà cung cấp
  const supplierItems: SupplierDebtItem[] = snapshot.suppliers
    .filter((s) => s.book_id === bookId)
    .map((supplier) => {
      const muaChiu = activeTxs
        .filter((t) => t.loai === 'chi_no' && t.supplier_id === supplier.id)
        .reduce((s, t) => s + t.so_tien, 0);
      const daTra = activeTxs
        .filter((t) => t.loai === 'tra_no' && t.supplier_id === supplier.id)
        .reduce((s, t) => s + t.so_tien, 0);
      return {
        supplier,
        tong_mua_chiu: muaChiu,
        tong_da_tra: daTra,
        con_no: supplier.no_dau_ky + muaChiu - daTra,
      };
    });

  const tongNoNcc = supplierItems.reduce((s, item) => s + Math.max(0, item.con_no), 0);

  // 2. Lương thợ kỳ này
  const monthAttendance: Attendance[] = snapshot.attendance.filter(
    (a) => a.book_id === bookId && getYearMonth(a.ngay) === kyThang
  );
  const wageTxs = activeTxs.filter(
    (t) => t.loai === 'tra_luong' && (t.ky_thang || getYearMonth(t.ngay)) === kyThang
  );

  const chiTietTho = snapshot.workers
    .filter((w) => w.book_id === bookId)
    .map((worker) => {
      const workerAtt = monthAttendance.filter((a) => a.worker_id === worker.id);
      const tongCong = workerAtt.reduce((s, a) => s + a.so_cong, 0);
      const thanhTien = workerAtt.reduce((s, a) => s + a.so_cong * a.don_gia_cong, 0);
      const daUng = wageTxs
        .filter((t) => t.worker_id === worker.id)
        .reduce((s, t) => s + t.so_tien, 0);
      return {
        worker,
        tong_cong: tongCong,
        thanh_tien: thanhTien,
        da_ung: daUng,
        con_lai: Math.max(0, thanhTien - daUng),
      };
    });

  const tongLuongCong = chiTietTho.reduce((s, w) => s + w.thanh_tien, 0);
  const tongDaTraLuong = wageTxs.reduce((s, t) => s + t.so_tien, 0);

  // 3. Tiền trường dự kiến kỳ này
  const monthMeals = snapshot.mealCounts.filter(
    (m) => m.book_id === bookId && getYearMonth(m.ngay) === kyThang
  );
  let tongSuatTruong = 0;
  let soTienDuKienTruong = 0;
  for (const m of monthMeals) {
    const dg = getEffectiveMealPrice(snapshot.mealPrices, bookId, m.bua, 'truong', m.ngay);
    tongSuatTruong += m.suat_truong;
    soTienDuKienTruong += m.suat_truong * dg;
  }

  const truongDaChuyen = activeTxs
    .filter(
      (t) => t.loai === 'truong_chuyen' && (t.ky_thang || getYearMonth(t.ngay)) === kyThang
    )
    .reduce((s, t) => s + t.so_tien, 0);

  return {
    ky_thang: kyThang,
    nha_cung_cap: {
      danh_sach: supplierItems,
      tong_no_ncc: tongNoNcc,
    },
    luong_tho_ky_nay: {
      tong_luong_tinh_theo_cong: tongLuongCong,
      da_tra_hoac_ung: tongDaTraLuong,
      con_phai_tra: Math.max(0, tongLuongCong - tongDaTraLuong),
      chi_tiet_tho: chiTietTho,
    },
    tien_truong_ky_nay: {
      tong_suat_truong: tongSuatTruong,
      so_tien_du_kien: soTienDuKienTruong,
      truong_da_chuyen: truongDaChuyen,
      con_cho_chuyen: Math.max(0, soTienDuKienTruong - truongDaChuyen),
    },
  };
}
