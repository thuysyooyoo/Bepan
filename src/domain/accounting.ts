import type {
  Attendance,
  BookId,
  BookSnapshot,
  BusinessSegment,
  Category,
  CategoryCalcMode,
  GuestType,
  MealCount,
  MealPeriod,
  MealPrice,
  Supplier,
  Transaction,
  Wallet,
  Worker,
} from '../types/models';
import {
  daysBetweenISO,
  formatVietnameseDate,
  formatVietnameseMonth,
  formatVND,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
  shiftDateISO,
} from './format';

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
    tong_suat: number;
    chi_tiet_bua: DailyMealBreakdown['chi_tiet_bua'];
    doanh_thu_truong: number;
    doanh_thu_vang_lai: number;
    thu_khac: number;
    tong_doanh_thu: number;
    chi_cho_tra_ngay: number;     // đi chợ trả tiền luôn ('chi')
    chi_cho_mua_chiu: number;     // đi chợ mua chịu ghi nợ ('chi_no')
    chi_nguyen_lieu_ngay: number; // chi_cho_tra_ngay + chi_cho_mua_chiu
    tong_so_cong_ngay: number;
    chi_cong_tho_ngay: number;
    tong_chi_ngay: number;
    lai_uoc_tinh_ngay: number;    // Chưa gồm điện, nước, gas, gia vị cuối tháng
    doanh_thu_binh_quan_suat: number;
    gia_von_ngay_moi_suat: number; // Nguyên liệu + công thợ / 1 suất (chưa gồm chi phí tháng)
    lai_ngay_moi_suat: number;
  };
  can_tin: {
    thu_tien_mat_cuoi_ngay: number;
    thu_chuyen_khoan_cuoi_ngay: number;
    tong_thu_quay_cuoi_ngay: number; // Tổng TM + CK chị Nhàn ông bà báo cuối ngày
    tru_tien_vang_lai: number;       // Phần tiền vãng lai tách sang Bếp ăn (Cách A)
    thu_khac_can_tin: number;
    doanh_thu_can_tin: number;       // Thu thuần của Căn tin sau khi trừ vãng lai + thu khác CT
    chi_nhap_tra_ngay: number;
    chi_nhap_mua_chiu: number;
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
 * - Bếp ăn: có Lãi ước tính ngày (Suất trường + Vãng lai + Thu khác − Tiền chợ ngày − Công thợ ngày).
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

  // Thu khác trực tiếp của Bếp ăn (bao gồm cả bán chịu ghi nhận doanh thu)
  const thuKhacBep = activeTxs
    .filter((t) => (t.loai === 'thu' || t.loai === 'ban_chiu') && t.mang === 'bep_an')
    .reduce((sum, t) => sum + t.so_tien, 0);

  // Chi nguyên liệu theo ngày của Bếp ăn (tách rõ trả ngay 'chi' và mua chịu 'chi_no')
  const chiChoTraNgayBep = activeTxs
    .filter(
      (t) =>
        t.loai === 'chi' &&
        t.mang === 'bep_an' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  const chiChoMuaChiuBep = activeTxs
    .filter(
      (t) =>
        t.loai === 'chi_no' &&
        t.mang === 'bep_an' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  const chiNguyenLieuBep = chiChoTraNgayBep + chiChoMuaChiuBep;

  // Chi công thợ theo chấm công ngày
  const dayAttendances = snapshot.attendance.filter(
    (a) => a.book_id === bookId && a.ngay === ngay
  );
  const tongSoCongNgay = dayAttendances.reduce((sum, a) => sum + a.so_cong, 0);
  const chiCongThoNgay = dayAttendances.reduce(
    (sum, a) => sum + a.so_cong * a.don_gia_cong,
    0
  );

  const tongSuatNgay = mealRev.suat_truong + mealRev.suat_vang_lai;
  const tongDoanhThuBep = mealRev.tong_doanh_thu_suat_an + thuKhacBep;
  const tongChiNgayBep = chiNguyenLieuBep + chiCongThoNgay;
  const laiUocTinhNgayBep = tongDoanhThuBep - tongChiNgayBep;

  const doanhThuBinhQuanSuat =
    tongSuatNgay > 0 ? Math.round(tongDoanhThuBep / tongSuatNgay) : 0;
  const giaVonNgayMoiSuat =
    tongSuatNgay > 0 ? Math.round(tongChiNgayBep / tongSuatNgay) : 0;
  const laiNgayMoiSuat =
    tongSuatNgay > 0 ? Math.round(laiUocTinhNgayBep / tongSuatNgay) : 0;

  // Cách A cho Căn tin: Tổng tiền thu cuối ngày (TM + CK) trừ phần suất vãng lai
  const cashWalletIds = new Set(
    snapshot.wallets
      .filter((w) => w.book_id === bookId && w.loai_vi === 'tien_mat')
      .map((w) => w.id)
  );
  const eodTxs = activeTxs.filter((t) => t.loai === 'thu_cuoi_ngay');
  const thuTienMatCuoiNgay = eodTxs
    .filter((t) => t.wallet_id && cashWalletIds.has(t.wallet_id))
    .reduce((sum, t) => sum + t.so_tien, 0);
  const thuChuyenKhoanCuoiNgay = eodTxs
    .filter((t) => !t.wallet_id || !cashWalletIds.has(t.wallet_id))
    .reduce((sum, t) => sum + t.so_tien, 0);

  const tongThuQuayCuoiNgay = thuTienMatCuoiNgay + thuChuyenKhoanCuoiNgay;

  const thuKhacCanTin = activeTxs
    .filter((t) => (t.loai === 'thu' || t.loai === 'ban_chiu') && t.mang === 'can_tin')
    .reduce((sum, t) => sum + t.so_tien, 0);

  const coNhapThuCuoiNgay = tongThuQuayCuoiNgay > 0;
  const canhBaoLechVangLai =
    coNhapThuCuoiNgay && tongThuQuayCuoiNgay < mealRev.doanh_thu_vang_lai;

  const thuCanTinTuQuay = coNhapThuCuoiNgay
    ? Math.max(0, tongThuQuayCuoiNgay - mealRev.doanh_thu_vang_lai)
    : 0;

  const doanhThuCanTin = thuCanTinTuQuay + thuKhacCanTin;

  const chiNhapTraNgayCt = activeTxs
    .filter(
      (t) =>
        t.loai === 'chi' &&
        t.mang === 'can_tin' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  const chiNhapMuaChiuCt = activeTxs
    .filter(
      (t) =>
        t.loai === 'chi_no' &&
        t.mang === 'can_tin' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((sum, t) => sum + t.so_tien, 0);

  const chiNhapHangCanTin = chiNhapTraNgayCt + chiNhapMuaChiuCt;

  return {
    ngay,
    bep_an: {
      suat_truong: mealRev.suat_truong,
      suat_vang_lai: mealRev.suat_vang_lai,
      tong_suat: tongSuatNgay,
      chi_tiet_bua: mealRev.chi_tiet_bua,
      doanh_thu_truong: mealRev.doanh_thu_truong,
      doanh_thu_vang_lai: mealRev.doanh_thu_vang_lai,
      thu_khac: thuKhacBep,
      tong_doanh_thu: tongDoanhThuBep,
      chi_cho_tra_ngay: chiChoTraNgayBep,
      chi_cho_mua_chiu: chiChoMuaChiuBep,
      chi_nguyen_lieu_ngay: chiNguyenLieuBep,
      tong_so_cong_ngay: tongSoCongNgay,
      chi_cong_tho_ngay: chiCongThoNgay,
      tong_chi_ngay: tongChiNgayBep,
      lai_uoc_tinh_ngay: laiUocTinhNgayBep,
      doanh_thu_binh_quan_suat: doanhThuBinhQuanSuat,
      gia_von_ngay_moi_suat: giaVonNgayMoiSuat,
      lai_ngay_moi_suat: laiNgayMoiSuat,
    },
    can_tin: {
      thu_tien_mat_cuoi_ngay: thuTienMatCuoiNgay,
      thu_chuyen_khoan_cuoi_ngay: thuChuyenKhoanCuoiNgay,
      tong_thu_quay_cuoi_ngay: tongThuQuayCuoiNgay,
      tru_tien_vang_lai: coNhapThuCuoiNgay ? mealRev.doanh_thu_vang_lai : 0,
      thu_khac_can_tin: thuKhacCanTin,
      doanh_thu_can_tin: doanhThuCanTin,
      chi_nhap_tra_ngay: chiNhapTraNgayCt,
      chi_nhap_mua_chiu: chiNhapMuaChiuCt,
      chi_nhap_hang_ngay: chiNhapHangCanTin,
      canh_bao_lech_vang_lai: canhBaoLechVangLai,
    },
  };
}

export interface SevenDayPoint {
  ngay: string;
  co_ghi_chep: boolean;
  bep_tong_suat: number;
  bep_doanh_thu: number;
  bep_chi_ngay: number;
  bep_lai_ngay: number;
  can_tin_thu: number;
  can_tin_chi: number;
}

export interface SevenDaySeriesSummary {
  tu_ngay: string;
  den_ngay: string;
  so_ngay_co_ghi_chep: number;
  tong_suat_7_ngay: number;
  tong_doanh_thu_bep_7_ngay: number;
  tong_chi_bep_7_ngay: number;
  tong_lai_bep_7_ngay: number;
  tong_thu_can_tin_7_ngay: number;
  tong_chi_can_tin_7_ngay: number;
  diem_ngay: SevenDayPoint[];
}

/**
 * 2b. Chuỗi dữ liệu 7 ngày liên tiếp kết thúc tại `endNgay` (phục vụ biểu đồ cột 7 ngày).
 */
export function computeSevenDaySeries(
  snapshot: BookSnapshot,
  endNgay: string,
  days = 7
): SevenDaySeriesSummary {
  const safeDays = Math.max(1, Math.min(31, Math.floor(days)));
  const diem_ngay: SevenDayPoint[] = [];

  let soNgayCoGhiChep = 0;
  let tongSuat7 = 0;
  let tongDoanhThuBep7 = 0;
  let tongChiBep7 = 0;
  let tongLaiBep7 = 0;
  let tongThuCt7 = 0;
  let tongChiCt7 = 0;

  for (let offset = safeDays - 1; offset >= 0; offset--) {
    const d = shiftDateISO(endNgay, -offset);
    const daily = computeDailyReport(snapshot, d);
    const coGhiChep =
      daily.bep_an.tong_suat > 0 ||
      daily.bep_an.tong_doanh_thu > 0 ||
      daily.bep_an.tong_chi_ngay > 0 ||
      daily.can_tin.tong_thu_quay_cuoi_ngay > 0 ||
      daily.can_tin.doanh_thu_can_tin > 0 ||
      daily.can_tin.chi_nhap_hang_ngay > 0;

    if (coGhiChep) soNgayCoGhiChep += 1;
    tongSuat7 += daily.bep_an.tong_suat;
    tongDoanhThuBep7 += daily.bep_an.tong_doanh_thu;
    tongChiBep7 += daily.bep_an.tong_chi_ngay;
    tongLaiBep7 += daily.bep_an.lai_uoc_tinh_ngay;
    tongThuCt7 += daily.can_tin.doanh_thu_can_tin;
    tongChiCt7 += daily.can_tin.chi_nhap_hang_ngay;

    diem_ngay.push({
      ngay: d,
      co_ghi_chep: coGhiChep,
      bep_tong_suat: daily.bep_an.tong_suat,
      bep_doanh_thu: daily.bep_an.tong_doanh_thu,
      bep_chi_ngay: daily.bep_an.tong_chi_ngay,
      bep_lai_ngay: daily.bep_an.lai_uoc_tinh_ngay,
      can_tin_thu: daily.can_tin.doanh_thu_can_tin,
      can_tin_chi: daily.can_tin.chi_nhap_hang_ngay,
    });
  }

  return {
    tu_ngay: diem_ngay[0]?.ngay ?? endNgay,
    den_ngay: endNgay,
    so_ngay_co_ghi_chep: soNgayCoGhiChep,
    tong_suat_7_ngay: tongSuat7,
    tong_doanh_thu_bep_7_ngay: tongDoanhThuBep7,
    tong_chi_bep_7_ngay: tongChiBep7,
    tong_lai_bep_7_ngay: tongLaiBep7,
    tong_thu_can_tin_7_ngay: tongThuCt7,
    tong_chi_can_tin_7_ngay: tongChiCt7,
    diem_ngay,
  };
}

export interface MonthlyExpenseCategoryItem {
  category_id: string;
  ten_danh_muc: string;
  icon: string;
  mang: BusinessSegment;
  kieu_tinh: CategoryCalcMode;
  so_tien: number;
  ty_le_phan_tram: number; // Làm tròn 1 chữ số thập phân (VD: 34.5)
  la_uoc_tinh: boolean;    // True nếu dòng chi phí tháng này lấy tạm từ tháng trước
}

export interface MonthlyReport {
  ky_thang: string; // YYYY-MM
  so_ngay_hoat_dong: number;
  bep_an: {
    tong_suat_truong: number;
    tong_suat_vang_lai: number;
    tong_suat: number;
    doanh_thu_truong: number;
    doanh_thu_vang_lai: number;
    thu_khac: number;
    doanh_thu: number;
    chi_nguyen_lieu_ngay: number;
    tong_so_cong: number;
    chi_cong_tho: number;
    chi_ngay: number; // chi_nguyen_lieu_ngay + chi_cong_tho
    chi_cuoi_thang_rieng: number; // gia vị, gas gắn riêng mảng bếp ăn
    lai_bep_an: number;
    doanh_thu_binh_quan_suat: number;
    gia_von_nguyen_lieu_cong_moi_suat: number; // (chi_ngay) / tong_suat
    gia_von_bep_day_du_moi_suat: number;       // (chi_ngay + chi_cuoi_thang_rieng) / tong_suat
    gia_von_phan_bo_chung_moi_suat: number;    // (chi_ngay + chi_cuoi_thang_rieng + chi_cuoi_thang_chung) / tong_suat
    lai_bep_moi_suat: number;                  // lai_bep_an / tong_suat
  };
  can_tin: {
    doanh_thu: number;
    chi_nhap_hang: number;
    chi_cuoi_thang_rieng: number;
    lai_can_tin: number;
    ty_suat_lai_phan_tram: number;
  };
  chi_cuoi_thang_chung: number; // điện, nước, vệ sinh chung
  tong_chi_cuoi_thang_ap_dung: number;
  la_uoc_tinh_tu_thang_truoc: boolean; // True nếu tháng này chưa nhập chi phí tháng, lấy tạm tháng trước
  ky_thang_nguon_chi_thang: string | null;
  tong_doanh_thu_toan_co_so: number;
  tong_chi_toan_co_so: number;
  lai_rong_toan_co_so: number;
  chi_theo_danh_muc: MonthlyExpenseCategoryItem[];
}

/**
 * 3. Tính báo cáo THÁNG (chỉ trừ chi phí cuối tháng vào lợi nhuận tháng, không chia theo ngày).
 * Nếu tháng đang có hoạt động mà chưa nhập chi phí cuối tháng (gia vị, điện, nước, gas),
 * tự lấy tháng trước làm mức tạm ước tính cho tới khi nhập hóa đơn thực tế.
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

  let soNgayHoatDong = 0;
  let tongSuatTruong = 0;
  let tongSuatVangLai = 0;
  let doanhThuTruong = 0;
  let doanhThuVangLai = 0;
  let thuKhacBep = 0;
  let doanhThuBep = 0;
  let chiNguyenLieuBep = 0;
  let tongSoCong = 0;
  let chiCongTho = 0;
  let chiNgayBep = 0;
  let doanhThuCanTin = 0;
  let chiNhapHangCanTin = 0;

  for (const ngay of dateSet) {
    const daily = computeDailyReport(snapshot, ngay);
    const coHoatDongNgay =
      daily.bep_an.tong_suat > 0 ||
      daily.bep_an.tong_doanh_thu > 0 ||
      daily.bep_an.tong_chi_ngay > 0 ||
      daily.can_tin.tong_thu_quay_cuoi_ngay > 0 ||
      daily.can_tin.doanh_thu_can_tin > 0 ||
      daily.can_tin.chi_nhap_hang_ngay > 0;

    if (coHoatDongNgay) soNgayHoatDong += 1;

    tongSuatTruong += daily.bep_an.suat_truong;
    tongSuatVangLai += daily.bep_an.suat_vang_lai;
    doanhThuTruong += daily.bep_an.doanh_thu_truong;
    doanhThuVangLai += daily.bep_an.doanh_thu_vang_lai;
    thuKhacBep += daily.bep_an.thu_khac;
    doanhThuBep += daily.bep_an.tong_doanh_thu;
    chiNguyenLieuBep += daily.bep_an.chi_nguyen_lieu_ngay;
    tongSoCong += daily.bep_an.tong_so_cong_ngay;
    chiCongTho += daily.bep_an.chi_cong_tho_ngay;
    chiNgayBep += daily.bep_an.tong_chi_ngay;
    doanhThuCanTin += daily.can_tin.doanh_thu_can_tin;
    chiNhapHangCanTin += daily.can_tin.chi_nhap_hang_ngay;
  }

  // Trường hợp hiếm: có khoản chi theo_ngay nhưng gắn mảng 'chung'
  const chiNgayChung = snapshot.transactions
    .filter(
      (t) =>
        t.book_id === bookId &&
        !t.da_xoa &&
        getYearMonth(t.ngay) === kyThang &&
        (t.loai === 'chi' || t.loai === 'chi_no') &&
        t.mang === 'chung' &&
        isDailyCalcCategory(snapshot.categories, t.category_id)
    )
    .reduce((s, t) => s + t.so_tien, 0);

  if (chiNgayChung > 0 && soNgayHoatDong === 0) {
    soNgayHoatDong = 1;
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

    return { txs: monthlyTxs, bep, ct, chung, total: bep + ct + chung };
  };

  const currentOverheads = getMonthlyOverheads(kyThang);
  let appliedOverheads = currentOverheads;
  let laUocTinh = false;
  let kyThangNguonChiThang: string | null =
    currentOverheads.total > 0 ? kyThang : null;

  // Chỉ tạm ước tính từ tháng trước khi tháng này ĐÃ có hoạt động phát sinh mà chưa nhập hóa đơn tháng
  const hasOperationalActivity = soNgayHoatDong > 0;
  if (currentOverheads.total === 0 && hasOperationalActivity) {
    const prevMonth = getPreviousYearMonth(kyThang);
    const prevOverheads = getMonthlyOverheads(prevMonth);
    if (prevOverheads.total > 0) {
      appliedOverheads = prevOverheads;
      laUocTinh = true;
      kyThangNguonChiThang = prevMonth;
    }
  }

  const chiChungTong = appliedOverheads.chung + chiNgayChung;
  const laiBepAn = doanhThuBep - chiNgayBep - appliedOverheads.bep;
  const laiCanTin = doanhThuCanTin - chiNhapHangCanTin - appliedOverheads.ct;
  const laiRongToanCoSo = laiBepAn + laiCanTin - chiChungTong;

  const tongSuatThang = tongSuatTruong + tongSuatVangLai;
  const doanhThuBqSuat =
    tongSuatThang > 0 ? Math.round(doanhThuBep / tongSuatThang) : 0;
  const giaVonNguyenLieuCongSuat =
    tongSuatThang > 0 ? Math.round(chiNgayBep / tongSuatThang) : 0;
  const giaVonBepDayDuSuat =
    tongSuatThang > 0
      ? Math.round((chiNgayBep + appliedOverheads.bep) / tongSuatThang)
      : 0;
  const giaVonPhanBoChungSuat =
    tongSuatThang > 0
      ? Math.round((chiNgayBep + appliedOverheads.bep + chiChungTong) / tongSuatThang)
      : 0;
  const laiBepMoiSuat =
    tongSuatThang > 0 ? Math.round(laiBepAn / tongSuatThang) : 0;

  const tySuatLaiCt =
    doanhThuCanTin > 0
      ? Math.round((laiCanTin / doanhThuCanTin) * 1000) / 10
      : 0;

  const tongDoanhThuToanCoSo = doanhThuBep + doanhThuCanTin;
  const tongChiToanCoSo =
    chiNgayBep + chiNhapHangCanTin + chiNgayChung + appliedOverheads.total;

  // Cơ cấu chi phí theo danh mục (khớp 100% với tongChiToanCoSo)
  const categoryMap = new Map<
    string,
    {
      category_id: string;
      ten_danh_muc: string;
      icon: string;
      mang: BusinessSegment;
      kieu_tinh: CategoryCalcMode;
      so_tien: number;
      la_uoc_tinh: boolean;
    }
  >();

  // a) Toàn bộ giao dịch chi theo_ngay trong tháng
  const dailyExpenseTxs = snapshot.transactions.filter(
    (t) =>
      t.book_id === bookId &&
      !t.da_xoa &&
      getYearMonth(t.ngay) === kyThang &&
      (t.loai === 'chi' || t.loai === 'chi_no') &&
      isDailyCalcCategory(snapshot.categories, t.category_id)
  );

  for (const tx of dailyExpenseTxs) {
    const cat = snapshot.categories.find((c) => c.id === tx.category_id);
    const key = `${tx.category_id}::${tx.mang}::real`;
    const existing = categoryMap.get(key);
    if (existing) {
      existing.so_tien += tx.so_tien;
    } else {
      categoryMap.set(key, {
        category_id: tx.category_id,
        ten_danh_muc: cat?.ten_danh_muc ?? 'Chi phí khác',
        icon: cat?.icon ?? '',
        mang: tx.mang,
        kieu_tinh: 'theo_ngay',
        so_tien: tx.so_tien,
        la_uoc_tinh: false,
      });
    }
  }

  // b) Công thợ phụ bếp theo chấm công
  if (chiCongTho > 0) {
    categoryMap.set('__cong_tho__', {
      category_id: '__cong_tho__',
      ten_danh_muc: `Công thợ phụ bếp (${tongSoCong} công)`,
      icon: '',
      mang: 'bep_an',
      kieu_tinh: 'theo_ngay',
      so_tien: chiCongTho,
      la_uoc_tinh: false,
    });
  }

  // c) Chi phí cuối tháng (thực tế hoặc tạm tính từ tháng trước)
  for (const tx of appliedOverheads.txs) {
    const cat = snapshot.categories.find((c) => c.id === tx.category_id);
    const key = `${tx.category_id}::${tx.mang}::${laUocTinh ? 'est' : 'real'}`;
    const existing = categoryMap.get(key);
    if (existing) {
      existing.so_tien += tx.so_tien;
    } else {
      categoryMap.set(key, {
        category_id: tx.category_id,
        ten_danh_muc: cat?.ten_danh_muc ?? 'Chi phí cuối tháng',
        icon: cat?.icon ?? '',
        mang: tx.mang,
        kieu_tinh: 'theo_thang',
        so_tien: tx.so_tien,
        la_uoc_tinh: laUocTinh,
      });
    }
  }

  const chiTheoDanhMuc: MonthlyExpenseCategoryItem[] = Array.from(
    categoryMap.values()
  )
    .filter((item) => item.so_tien > 0)
    .sort((a, b) => b.so_tien - a.so_tien)
    .map((item) => ({
      ...item,
      ty_le_phan_tram:
        tongChiToanCoSo > 0
          ? Math.round((item.so_tien / tongChiToanCoSo) * 1000) / 10
          : 0,
    }));

  return {
    ky_thang: kyThang,
    so_ngay_hoat_dong: soNgayHoatDong,
    bep_an: {
      tong_suat_truong: tongSuatTruong,
      tong_suat_vang_lai: tongSuatVangLai,
      tong_suat: tongSuatThang,
      doanh_thu_truong: doanhThuTruong,
      doanh_thu_vang_lai: doanhThuVangLai,
      thu_khac: thuKhacBep,
      doanh_thu: doanhThuBep,
      chi_nguyen_lieu_ngay: chiNguyenLieuBep,
      tong_so_cong: tongSoCong,
      chi_cong_tho: chiCongTho,
      chi_ngay: chiNgayBep,
      chi_cuoi_thang_rieng: appliedOverheads.bep,
      lai_bep_an: laiBepAn,
      doanh_thu_binh_quan_suat: doanhThuBqSuat,
      gia_von_nguyen_lieu_cong_moi_suat: giaVonNguyenLieuCongSuat,
      gia_von_bep_day_du_moi_suat: giaVonBepDayDuSuat,
      gia_von_phan_bo_chung_moi_suat: giaVonPhanBoChungSuat,
      lai_bep_moi_suat: laiBepMoiSuat,
    },
    can_tin: {
      doanh_thu: doanhThuCanTin,
      chi_nhap_hang: chiNhapHangCanTin,
      chi_cuoi_thang_rieng: appliedOverheads.ct,
      lai_can_tin: laiCanTin,
      ty_suat_lai_phan_tram: tySuatLaiCt,
    },
    chi_cuoi_thang_chung: chiChungTong,
    tong_chi_cuoi_thang_ap_dung: appliedOverheads.total,
    la_uoc_tinh_tu_thang_truoc: laUocTinh,
    ky_thang_nguon_chi_thang: kyThangNguonChiThang,
    tong_doanh_thu_toan_co_so: tongDoanhThuToanCoSo,
    tong_chi_toan_co_so: tongChiToanCoSo,
    lai_rong_toan_co_so: laiRongToanCoSo,
    chi_theo_danh_muc: chiTheoDanhMuc,
  };
}

/**
 * Tạo câu tóm tắt tiếng Việt tự nhiên để đọc to Báo cáo Ngày cho ông bà nghe.
 */
export function buildSpokenDailyReport(
  snapshot: BookSnapshot,
  daily: DailyReport
): string {
  const tenSo = snapshot.book.ten;
  const ngayLabel = formatVietnameseDate(daily.ngay);
  const { bep_an: b, can_tin: c } = daily;

  if (
    b.tong_suat === 0 &&
    b.tong_doanh_thu === 0 &&
    b.tong_chi_ngay === 0 &&
    c.tong_thu_quay_cuoi_ngay === 0 &&
    c.chi_nhap_hang_ngay === 0
  ) {
    return `${tenSo}, ${ngayLabel}: chưa có ghi chép suất ăn hoặc thu chi nào.`;
  }

  const laiText =
    b.lai_uoc_tinh_ngay >= 0
      ? `lãi ước tính ${formatVND(b.lai_uoc_tinh_ngay)}`
      : `tạm âm ${formatVND(Math.abs(b.lai_uoc_tinh_ngay))}`;

  const parts: string[] = [
    `Báo cáo ${tenSo}, ${ngayLabel}.`,
    `Bếp ăn phục vụ ${b.tong_suat} suất, thu ${formatVND(b.tong_doanh_thu)}, chi chợ và công thợ ${formatVND(b.tong_chi_ngay)}, ${laiText}.`,
  ];

  if (b.tong_suat > 0) {
    parts.push(`Giá vốn trong ngày khoảng ${formatVND(b.gia_von_ngay_moi_suat)} một suất.`);
  }

  if (c.doanh_thu_can_tin > 0 || c.chi_nhap_hang_ngay > 0) {
    parts.push(
      `Căn tin thu ${formatVND(c.doanh_thu_can_tin)}, chi nhập hàng ${formatVND(c.chi_nhap_hang_ngay)}.`
    );
  }

  return parts.join(' ');
}

/**
 * Tạo câu tóm tắt tiếng Việt tự nhiên để đọc to Báo cáo Tháng cho ông bà nghe.
 */
export function buildSpokenMonthlyReport(
  snapshot: BookSnapshot,
  monthly: MonthlyReport
): string {
  const tenSo = snapshot.book.ten;
  const thangLabel = formatVietnameseMonth(monthly.ky_thang);

  if (monthly.so_ngay_hoat_dong === 0 && monthly.tong_chi_cuoi_thang_ap_dung === 0) {
    return `${tenSo}, ${thangLabel}: chưa có số liệu ghi chép trong tháng này.`;
  }

  const laiRongText =
    monthly.lai_rong_toan_co_so >= 0
      ? `lãi ròng toàn cơ sở ${formatVND(monthly.lai_rong_toan_co_so)}`
      : `đang âm ${formatVND(Math.abs(monthly.lai_rong_toan_co_so))}`;

  const parts: string[] = [
    `Báo cáo ${tenSo}, ${thangLabel}.`,
    `Bếp ăn nấu ${monthly.bep_an.tong_suat} suất, lãi ${formatVND(monthly.bep_an.lai_bep_an)}.`,
    `Căn tin lãi ${formatVND(monthly.can_tin.lai_can_tin)}.`,
  ];

  if (monthly.tong_chi_cuoi_thang_ap_dung > 0) {
    parts.push(
      monthly.la_uoc_tinh_tu_thang_truoc
        ? `Chi phí điện, nước, ga, gia vị đang tạm tính theo tháng trước là ${formatVND(monthly.tong_chi_cuoi_thang_ap_dung)}.`
        : `Chi phí điện, nước, ga, gia vị cuối tháng là ${formatVND(monthly.tong_chi_cuoi_thang_ap_dung)}.`
    );
  }

  parts.push(`Tổng kết ${laiRongText}.`);
  return parts.join(' ');
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
        (tx.loai === 'thu_cuoi_ngay' || tx.loai === 'thu' || tx.loai === 'truong_chuyen' || tx.loai === 'thu_no') &&
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

export interface WalletReconciliationDiff {
  so_du_so_sach: number;
  tien_dem_thuc_te: number;
  chenh_lech: number; // dương = thừa tiền so với sổ; âm = hụt tiền so với sổ
  trang_thai: 'khop' | 'thua' | 'hut';
}

/**
 * 4b. Tính chênh lệch khi ông bà đếm tiền thực tế trong két / tài khoản đối chiếu với sổ:
 */
export function computeWalletReconciliationDiff(
  bookBalance: number,
  actualCounted: number
): WalletReconciliationDiff {
  const soDu = Math.round(bookBalance);
  const thucTe = Math.round(actualCounted);
  const diff = thucTe - soDu;
  return {
    so_du_so_sach: soDu,
    tien_dem_thuc_te: thucTe,
    chenh_lech: diff,
    trang_thai: diff === 0 ? 'khop' : diff > 0 ? 'thua' : 'hut',
  };
}

export interface WalletTimelineEntry {
  tx: Transaction;
  huong: 'vao' | 'ra' | 'chuyen_quy';
  bien_dong: number; // +VND, -VND, hoặc 0 khi xem gộp cả 3 ví mà chuyển quỹ nội bộ
  so_du_sau_gd: number;
  icon: string;
  tieu_de: string;
  ten_vi_hien_thi: string;
}

/**
 * 4c. Dòng thời gian tiền vào / tiền ra thực tế kèm số dư lũy kế sau từng giao dịch.
 * Tuyệt đối KHÔNG bao gồm mua chịu ('chi_no').
 */
export function computeWalletTimeline(
  snapshot: BookSnapshot,
  options?: { walletId?: string | null; kyThang?: string | null }
): WalletTimelineEntry[] {
  const bookId = snapshot.book.id;
  const filterWalletId = options?.walletId || null;
  const filterMonth = options?.kyThang || null;

  const walletMap = new Map(
    snapshot.wallets.filter((w) => w.book_id === bookId).map((w) => [w.id, w])
  );
  const catMap = new Map(snapshot.categories.map((c) => [c.id, c]));
  const supMap = new Map(snapshot.suppliers.map((s) => [s.id, s]));
  const workerMap = new Map(snapshot.workers.map((w) => [w.id, w]));

  const openingBalance = filterWalletId
    ? walletMap.get(filterWalletId)?.so_du_dau_ky ?? 0
    : Array.from(walletMap.values()).reduce((s, w) => s + w.so_du_dau_ky, 0);

  // Chỉ lấy giao dịch thực thu thực chi (loại trừ chi_no, ban_chiu và da_xoa)
  const cashTxs = snapshot.transactions
    .filter((t) => {
      if (t.book_id !== bookId || t.da_xoa || t.loai === 'chi_no' || t.loai === 'ban_chiu') return false;
      if (!filterWalletId) return true;
      return (
        t.wallet_id === filterWalletId ||
        (t.loai === 'chuyen_quy' && t.to_wallet_id === filterWalletId)
      );
    })
    .sort((a, b) => {
      const d = a.ngay.localeCompare(b.ngay);
      if (d !== 0) return d;
      return a.timestamp.localeCompare(b.timestamp);
    });

  let running = openingBalance;
  const chronological: WalletTimelineEntry[] = [];

  for (const tx of cashTxs) {
    let huong: WalletTimelineEntry['huong'] = 'ra';
    let bienDong = 0;

    if (
      tx.loai === 'thu_cuoi_ngay' ||
      tx.loai === 'thu' ||
      tx.loai === 'truong_chuyen' ||
      tx.loai === 'thu_no'
    ) {
      huong = 'vao';
      bienDong = tx.so_tien;
    } else if (tx.loai === 'chi' || tx.loai === 'tra_no' || tx.loai === 'tra_luong') {
      huong = 'ra';
      bienDong = -tx.so_tien;
    } else if (tx.loai === 'chuyen_quy') {
      if (filterWalletId) {
        if (tx.wallet_id === filterWalletId && tx.to_wallet_id !== filterWalletId) {
          huong = 'ra';
          bienDong = -tx.so_tien;
        } else if (tx.to_wallet_id === filterWalletId && tx.wallet_id !== filterWalletId) {
          huong = 'vao';
          bienDong = tx.so_tien;
        } else {
          huong = 'chuyen_quy';
          bienDong = 0;
        }
      } else {
        huong = 'chuyen_quy';
        bienDong = 0;
      }
    } else if (tx.loai === 'dieu_chinh_vi') {
      huong = tx.so_tien >= 0 ? 'vao' : 'ra';
      bienDong = tx.so_tien;
    }

    running += bienDong;

    const cat = catMap.get(tx.category_id);
    const fromWallet = tx.wallet_id ? walletMap.get(tx.wallet_id) : undefined;
    const toWallet = tx.to_wallet_id ? walletMap.get(tx.to_wallet_id) : undefined;
    const sup = tx.supplier_id ? supMap.get(tx.supplier_id) : undefined;
    const worker = tx.worker_id ? workerMap.get(tx.worker_id) : undefined;

    let icon = cat?.icon ?? '';
    let tieuDe = tx.ghi_chu || cat?.ten_danh_muc || 'Giao dịch ví';
    if (tx.loai === 'tra_no' && sup) {
      icon = '';
      tieuDe = `Trả nợ ${sup.ten_ncc}${tx.ghi_chu ? ` — ${tx.ghi_chu}` : ''}`;
    } else if (tx.loai === 'tra_luong' && worker) {
      icon = '';
      tieuDe = `Trả/ứng lương ${worker.ho_ten}`;
    } else if (tx.loai === 'chuyen_quy') {
      icon = '';
      tieuDe = tx.ghi_chu || `Chuyển quỹ nội bộ`;
    } else if (tx.loai === 'dieu_chinh_vi') {
      icon = '';
      tieuDe =
        tx.ghi_chu ||
        (tx.so_tien >= 0 ? 'Điều chỉnh thừa tiền khi kiểm két' : 'Điều chỉnh hụt tiền khi kiểm két');
    }

    const tenViHienThi =
      tx.loai === 'chuyen_quy'
        ? `${fromWallet?.ten_vi ?? 'Ví chuyển'} → ${toWallet?.ten_vi ?? 'Ví nhận'}`
        : fromWallet?.ten_vi ?? 'Ví';

    chronological.push({
      tx,
      huong,
      bien_dong: bienDong,
      so_du_sau_gd: running,
      icon,
      tieu_de: tieuDe,
      ten_vi_hien_thi: tenViHienThi,
    });
  }

  const filtered = filterMonth
    ? chronological.filter((e) => getYearMonth(e.tx.ngay) === filterMonth)
    : chronological;

  return filtered.reverse();
}

export interface SupplierLedgerHistoryEntry {
  tx: Transaction;
  loai_phat_sinh: 'mua_chiu' | 'tra_no';
  so_tien: number; // dương
  du_no_sau_gd: number;
  ten_danh_muc_hoac_vi: string;
}

export interface SupplierLedgerDetail {
  supplier: Supplier;
  no_dau_ky: number;
  tong_mua_chiu: number;
  tong_da_tra: number;
  con_no: number;
  ngay_no_cu_nhat: string | null; // Tính theo FIFO: ngày của khoản mua chịu cũ nhất chưa trả hết
  so_ngay_no_lau_nhat: number;
  lich_su: SupplierLedgerHistoryEntry[]; // Mới nhất xếp trên đầu
}

/**
 * 5b. Sổ chi tiết công nợ của 1 Nhà cung cấp (từng lần lấy hàng mua chịu & từng lần trả nợ,
 * tính tuổi nợ theo FIFO chính xác để biết khoản nợ lâu nhất chưa tất toán đã bao nhiêu ngày).
 */
export function computeSupplierLedgerDetail(
  snapshot: BookSnapshot,
  supplierId: string,
  referenceDate: string = getTodayISO()
): SupplierLedgerDetail | null {
  const bookId = snapshot.book.id;
  const supplier = snapshot.suppliers.find(
    (s) => s.id === supplierId && s.book_id === bookId
  );
  if (!supplier) return null;

  const catMap = new Map(snapshot.categories.map((c) => [c.id, c]));
  const walletMap = new Map(snapshot.wallets.map((w) => [w.id, w]));

  const supTxs = snapshot.transactions
    .filter(
      (t) =>
        t.book_id === bookId &&
        !t.da_xoa &&
        t.supplier_id === supplierId &&
        (t.loai === 'chi_no' || t.loai === 'tra_no')
    )
    .sort((a, b) => {
      const d = a.ngay.localeCompare(b.ngay);
      if (d !== 0) return d;
      return a.timestamp.localeCompare(b.timestamp);
    });

  let tongMuaChiu = 0;
  let tongDaTra = 0;
  let runningDebt = supplier.no_dau_ky;

  const buckets: Array<{ ngay: string; remaining: number }> = [];
  if (supplier.no_dau_ky > 0) {
    buckets.push({
      ngay: snapshot.book.created_at.slice(0, 10) || '2026-01-01',
      remaining: supplier.no_dau_ky,
    });
  }

  const chronologicalHistory: SupplierLedgerHistoryEntry[] = [];

  for (const tx of supTxs) {
    if (tx.loai === 'chi_no') {
      tongMuaChiu += tx.so_tien;
      runningDebt += tx.so_tien;
      buckets.push({ ngay: tx.ngay, remaining: tx.so_tien });
      const cat = catMap.get(tx.category_id);
      chronologicalHistory.push({
        tx,
        loai_phat_sinh: 'mua_chiu',
        so_tien: tx.so_tien,
        du_no_sau_gd: runningDebt,
        ten_danh_muc_hoac_vi: cat ? `${cat.icon} ${cat.ten_danh_muc}` : 'Mua chịu hàng',
      });
    } else {
      tongDaTra += tx.so_tien;
      runningDebt -= tx.so_tien;
      const w = tx.wallet_id ? walletMap.get(tx.wallet_id) : undefined;
      chronologicalHistory.push({
        tx,
        loai_phat_sinh: 'tra_no',
        so_tien: tx.so_tien,
        du_no_sau_gd: runningDebt,
        ten_danh_muc_hoac_vi: w ? `Trả từ ${w.ten_vi}` : 'Đã trả tiền',
      });
    }
  }

  // Khấu trừ FIFO các khoản đã trả vào các khoản mua chịu cũ nhất trước
  let paidPool = tongDaTra;
  for (const b of buckets) {
    if (paidPool <= 0) break;
    const deduct = Math.min(paidPool, b.remaining);
    b.remaining -= deduct;
    paidPool -= deduct;
  }

  const conNo = supplier.no_dau_ky + tongMuaChiu - tongDaTra;
  const oldestUnpaidBucket = conNo > 0 ? buckets.find((b) => b.remaining > 0) : undefined;
  const ngayNoCuNhat = oldestUnpaidBucket ? oldestUnpaidBucket.ngay : null;
  const soNgayNoLauNhat = ngayNoCuNhat
    ? Math.max(0, daysBetweenISO(ngayNoCuNhat, referenceDate))
    : 0;

  return {
    supplier,
    no_dau_ky: supplier.no_dau_ky,
    tong_mua_chiu: tongMuaChiu,
    tong_da_tra: tongDaTra,
    con_no: conNo,
    ngay_no_cu_nhat: ngayNoCuNhat,
    so_ngay_no_lau_nhat: soNgayNoLauNhat,
    lich_su: chronologicalHistory.reverse(),
  };
}

export interface SupplierDebtItem {
  supplier: Supplier;
  tong_mua_chiu: number;
  tong_da_tra: number;
  con_no: number;
  ngay_no_cu_nhat: string | null;
  so_ngay_no_lau_nhat: number;
}

export interface CustomerReceivableItem {
  doi_tac: string;
  tong_ban_chiu: number;
  tong_da_thu: number;
  con_phai_thu: number;
  ngay_muon_nhat: string | null;
}

export interface DebtAndPayablesSummary {
  ky_thang: string;
  // 1. Nợ nhà cung cấp (mua chịu - mình nợ người ta)
  nha_cung_cap: {
    danh_sach: SupplierDebtItem[];
    tong_no_ncc: number;
  };
  // 2. Lương thợ phải trả trong kỳ tháng (mình nợ thợ)
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
  // 3. Tiền trường dự kiến về trong kỳ tháng (người ta nợ mình)
  tien_truong_ky_nay: {
    tong_suat_truong: number;
    so_tien_du_kien: number;
    truong_da_chuyen: number;
    con_cho_chuyen: number;
  };
  // 4. Khách / giáo viên ăn chịu, đặt cỗ chưa thanh toán (người ta nợ mình)
  phai_thu_khach: {
    danh_sach: CustomerReceivableItem[];
    tong_phai_thu_khach: number;
  };
  // 5. Tổng hợp 2 chiều: Nợ mình nợ & Người ta nợ mình
  tong_minh_no: number;     // = tong_no_ncc + con_phai_tra_luong
  tong_nguoi_ta_no: number; // = con_cho_chuyen + tong_phai_thu_khach
}

/**
 * 5. SỔ NỢ & PHẢI TRẢ / DỰ KIẾN THU (Tách riêng hoàn toàn khỏi Sổ Dòng Tiền):
 * Gồm 2 bảng rõ ràng:
 * - Khoản mình nợ (Phải trả): Nợ mua chịu nhà cung cấp + Lương thợ lũy kế phải trả.
 * - Khoản người ta nợ mình (Phải thu): Tiền suất ăn trường dự kiến về + Khách/giáo viên ăn chịu.
 */
export function computeDebtAndPayables(
  snapshot: BookSnapshot,
  kyThang: string,
  referenceDate: string = getTodayISO()
): DebtAndPayablesSummary {
  const bookId = snapshot.book.id;
  const activeTxs = snapshot.transactions.filter((t) => t.book_id === bookId && !t.da_xoa);

  // 1. Nợ nhà cung cấp (tính kèm tuổi nợ FIFO)
  const supplierItems: SupplierDebtItem[] = snapshot.suppliers
    .filter((s) => s.book_id === bookId)
    .map((supplier) => {
      const detail = computeSupplierLedgerDetail(snapshot, supplier.id, referenceDate);
      return {
        supplier,
        tong_mua_chiu: detail?.tong_mua_chiu ?? 0,
        tong_da_tra: detail?.tong_da_tra ?? 0,
        con_no: detail?.con_no ?? supplier.no_dau_ky,
        ngay_no_cu_nhat: detail?.ngay_no_cu_nhat ?? null,
        so_ngay_no_lau_nhat: detail?.so_ngay_no_lau_nhat ?? 0,
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
  const luongThoConPhaiTra = Math.max(0, tongLuongCong - tongDaTraLuong);

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
  const tienTruongConCho = Math.max(0, soTienDuKienTruong - truongDaChuyen);

  // 4. Khách / giáo viên ăn chịu & thu nợ (Phải thu khách)
  const receivableMap = new Map<
    string,
    { tong_ban_chiu: number; tong_da_thu: number; ngay_muon_nhat: string | null }
  >();

  for (const tx of activeTxs) {
    if (tx.loai === 'ban_chiu' || tx.loai === 'thu_no') {
      const partner = (tx.doi_tac || tx.ghi_chu || 'Khách vãng lai').trim();
      if (!partner) continue;
      const current = receivableMap.get(partner) || {
        tong_ban_chiu: 0,
        tong_da_thu: 0,
        ngay_muon_nhat: null,
      };
      if (tx.loai === 'ban_chiu') {
        current.tong_ban_chiu += tx.so_tien;
      } else if (tx.loai === 'thu_no') {
        current.tong_da_thu += tx.so_tien;
      }
      if (!current.ngay_muon_nhat || tx.ngay > current.ngay_muon_nhat) {
        current.ngay_muon_nhat = tx.ngay;
      }
      receivableMap.set(partner, current);
    }
  }

  const customerReceivables: CustomerReceivableItem[] = Array.from(receivableMap.entries())
    .map(([doi_tac, info]) => ({
      doi_tac,
      tong_ban_chiu: info.tong_ban_chiu,
      tong_da_thu: info.tong_da_thu,
      con_phai_thu: Math.max(0, info.tong_ban_chiu - info.tong_da_thu),
      ngay_muon_nhat: info.ngay_muon_nhat,
    }))
    .filter((c) => c.con_phai_thu > 0 || c.tong_ban_chiu > 0);

  const tongPhaiThuKhach = customerReceivables.reduce((s, c) => s + c.con_phai_thu, 0);

  return {
    ky_thang: kyThang,
    nha_cung_cap: {
      danh_sach: supplierItems,
      tong_no_ncc: tongNoNcc,
    },
    luong_tho_ky_nay: {
      tong_luong_tinh_theo_cong: tongLuongCong,
      da_tra_hoac_ung: tongDaTraLuong,
      con_phai_tra: luongThoConPhaiTra,
      chi_tiet_tho: chiTietTho,
    },
    tien_truong_ky_nay: {
      tong_suat_truong: tongSuatTruong,
      so_tien_du_kien: soTienDuKienTruong,
      truong_da_chuyen: truongDaChuyen,
      con_cho_chuyen: tienTruongConCho,
    },
    phai_thu_khach: {
      danh_sach: customerReceivables,
      tong_phai_thu_khach: tongPhaiThuKhach,
    },
    tong_minh_no: tongNoNcc + luongThoConPhaiTra,
    tong_nguoi_ta_no: tienTruongConCho + tongPhaiThuKhach,
  };
}
