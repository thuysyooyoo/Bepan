import type { BookSnapshot, BusinessSegment, TransactionType } from '../types/models';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
  computeWalletBalances,
  computeWalletTimeline,
} from './accounting';
import { computeAdminCombinedSummary } from './adminSummary';
import { formatVietnameseMonth, getTodayISO, getYearMonth } from './format';

export const EXCEL_FONT_NAME = 'Arial';
export const EXCEL_FONT_SIZE = 10;
export const EXCEL_NUMBER_FMT = '#,##0';
export const EXCEL_PERCENT_FMT = '0.0"%"';
export const EXCEL_DATE_FMT = 'dd/mm/yyyy';

const SEGMENT_LABELS: Record<BusinessSegment, string> = {
  bep_an: 'Bếp ăn',
  can_tin: 'Căn tin',
  chung: 'Chung',
};

const TX_TYPE_LABELS: Record<TransactionType, string> = {
  thu_cuoi_ngay: 'Thu cuối ngày (TM/CK)',
  thu: 'Thu trực tiếp',
  chi: 'Chi trả ngay',
  chi_no: 'Mua chịu (ghi nợ NCC)',
  tra_no: 'Trả nợ nhà cung cấp',
  truong_chuyen: 'Trường chuyển tiền ăn',
  tra_luong: 'Trả/ứng lương thợ',
  chuyen_quy: 'Chuyển quỹ nội bộ',
  dieu_chinh_vi: 'Điều chỉnh kiểm đếm ví',
};

async function loadExcelJS() {
  const mod = await import('exceljs');
  const resolved = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return resolved;
}

/**
 * Chuyển chuỗi YYYY-MM-DD sang đối tượng Date chuẩn UTC 12:00 trưa để Excel
 * hiển thị chính xác `dd/mm/yyyy` trên mọi múi giờ mà không bị lùi 1 ngày.
 */
export function isoDateToExcelDate(isoDate: string | null | undefined): Date | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function applyTableHeaderStyle(row: import('exceljs').Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      name: EXCEL_FONT_NAME,
      size: EXCEL_FONT_SIZE,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 24;
}

function applySectionBannerStyle(row: import('exceljs').Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      name: EXCEL_FONT_NAME,
      size: EXCEL_FONT_SIZE,
      bold: true,
      color: { argb: 'FF134E4A' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFCCFBF1' },
    };
  });
  row.height = 22;
}

function applyTotalRowStyle(row: import('exceljs').Row): void {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      name: EXCEL_FONT_NAME,
      size: EXCEL_FONT_SIZE,
      bold: true,
      color: { argb: 'FF1C1917' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFEF3C7' },
    };
  });
  row.height = 22;
}

/**
 * Khóa cứng quy chuẩn định dạng toàn bộ Workbook:
 * - 100% ô dùng font Arial cỡ 10pt
 * - Viền mỏng chuẩn kế toán cho các ô có dữ liệu
 */
function enforceWorkbookStandardFormatting(wb: import('exceljs').Workbook): void {
  const thinBorder: Partial<import('exceljs').Borders> = {
    top: { style: 'thin', color: { argb: 'FFD6D3D1' } },
    left: { style: 'thin', color: { argb: 'FFD6D3D1' } },
    bottom: { style: 'thin', color: { argb: 'FFD6D3D1' } },
    right: { style: 'thin', color: { argb: 'FFD6D3D1' } },
  };

  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const existingFont = cell.font ?? {};
        cell.font = {
          ...existingFont,
          name: EXCEL_FONT_NAME,
          size: EXCEL_FONT_SIZE,
        };
        if (!cell.border) {
          cell.border = thinBorder;
        }
        if (!cell.alignment) {
          cell.alignment = { vertical: 'middle' };
        }
      });
    });
  });
}

function populateFacilityOverviewSheet(
  ws: import('exceljs').Worksheet,
  snapshot: BookSnapshot,
  kyThang: string,
  referenceDate: string
): void {
  const monthly = computeMonthlyReport(snapshot, kyThang);
  const mLabel = formatVietnameseMonth(kyThang);

  ws.columns = [
    { key: 'c1', width: 8 },
    { key: 'c2', width: 42 },
    { key: 'c3', width: 16 },
    { key: 'c4', width: 20 },
    { key: 'c5', width: 16 },
    { key: 'c6', width: 26 },
  ];

  const titleRow = ws.addRow([
    `BÁO CÁO LÃI LỖ THÁNG — ${snapshot.book.ten.toUpperCase()} (${mLabel.toUpperCase()})`,
  ]);
  ws.mergeCells(`A${titleRow.number}:F${titleRow.number}`);
  titleRow.getCell(1).font = { name: EXCEL_FONT_NAME, size: EXCEL_FONT_SIZE, bold: true };
  titleRow.height = 24;

  const metaRow = ws.addRow([
    'Ngày xuất:',
    isoDateToExcelDate(referenceDate),
    'Chủ sổ:',
    snapshot.book.chu_so,
    'Số ngày ghi sổ:',
    monthly.so_ngay_hoat_dong,
  ]);
  metaRow.getCell(2).numFmt = EXCEL_DATE_FMT;
  metaRow.getCell(6).numFmt = EXCEL_NUMBER_FMT;

  ws.addRow([]);

  // PHẦN I: TỔNG HỢP LÃI LỖ
  const sec1 = ws.addRow(['I', 'TỔNG HỢP LÃI LỖ TOÀN CƠ SỞ', '', '', '', '']);
  applySectionBannerStyle(sec1);

  const hdr1 = ws.addRow(['STT', 'Chỉ tiêu tài chính', 'Mảng', 'Số tiền (VNĐ)', 'Đơn vị / Tỷ lệ', 'Ghi chú']);
  applyTableHeaderStyle(hdr1);

  const summaryRows: Array<[number, string, string, number, number | string, string]> = [
    [
      1,
      'Doanh thu suất ăn trường học',
      'Bếp ăn',
      monthly.bep_an.doanh_thu_truong,
      monthly.bep_an.tong_suat_truong,
      'Suất trường trong tháng',
    ],
    [
      2,
      'Doanh thu suất ăn vãng lai (Cách A)',
      'Bếp ăn',
      monthly.bep_an.doanh_thu_vang_lai,
      monthly.bep_an.tong_suat_vang_lai,
      'Tự tách từ tổng thu cuối ngày',
    ],
    [
      3,
      'Thu trực tiếp khác Bếp ăn',
      'Bếp ăn',
      monthly.bep_an.thu_khac,
      '',
      '',
    ],
    [
      4,
      'Chi đi chợ nguyên liệu hằng ngày',
      'Bếp ăn',
      -monthly.bep_an.chi_nguyen_lieu_ngay,
      '',
      'Gồm cả trả ngay & mua chịu',
    ],
    [
      5,
      'Chi công thợ phụ bếp theo chấm công',
      'Bếp ăn',
      -monthly.bep_an.chi_cong_tho,
      monthly.bep_an.tong_so_cong,
      'Tổng số công trong tháng',
    ],
    [
      6,
      'Chi gia vị, gas cuối tháng (riêng Bếp)',
      'Bếp ăn',
      -monthly.bep_an.chi_cuoi_thang_rieng,
      '',
      monthly.la_uoc_tinh_tu_thang_truoc ? 'Tạm ước tính từ tháng trước' : 'Số thực tế',
    ],
    [
      7,
      'LÃI MẢNG BẾP ĂN TRONG THÁNG',
      'Bếp ăn',
      monthly.bep_an.lai_bep_an,
      monthly.bep_an.tong_suat,
      `Giá vốn đầy đủ/suất: ${monthly.bep_an.gia_von_bep_day_du_moi_suat.toLocaleString('vi-VN')} đ`,
    ],
    [
      8,
      'Doanh thu Căn tin thuần',
      'Căn tin',
      monthly.can_tin.doanh_thu,
      '',
      'Đã trừ phần suất ăn vãng lai',
    ],
    [
      9,
      'Chi nhập hàng Căn tin',
      'Căn tin',
      -monthly.can_tin.chi_nhap_hang,
      '',
      '',
    ],
    [
      10,
      'Chi phí cuối tháng riêng Căn tin',
      'Căn tin',
      -monthly.can_tin.chi_cuoi_thang_rieng,
      '',
      '',
    ],
    [
      11,
      'LÃI MẢNG CĂN TIN TRONG THÁNG',
      'Căn tin',
      monthly.can_tin.lai_can_tin,
      monthly.can_tin.ty_suat_lai_phan_tram,
      'Tỷ suất lãi Căn tin (%)',
    ],
    [
      12,
      'Chi điện, nước, vệ sinh chung cuối tháng',
      'Chung',
      -monthly.chi_cuoi_thang_chung,
      '',
      monthly.la_uoc_tinh_tu_thang_truoc ? 'Tạm ước tính từ tháng trước' : 'Chỉ trừ vào tháng',
    ],
  ];

  for (const r of summaryRows) {
    const added = ws.addRow(r);
    added.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    added.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    added.getCell(4).numFmt = EXCEL_NUMBER_FMT;
    if (typeof r[4] === 'number') {
      added.getCell(5).numFmt = r[0] === 11 ? EXCEL_PERCENT_FMT : EXCEL_NUMBER_FMT;
    }
    if (r[0] === 7 || r[0] === 11) {
      added.eachCell((c) => {
        c.font = { name: EXCEL_FONT_NAME, size: EXCEL_FONT_SIZE, bold: true };
      });
    }
  }

  const netRow = ws.addRow([
    '',
    'TỔNG LÃI RÒNG TOÀN CƠ SỞ',
    'Toàn cơ sở',
    monthly.lai_rong_toan_co_so,
    monthly.bep_an.lai_bep_moi_suat,
    'Cột E: Lãi Bếp bình quân / 1 suất',
  ]);
  applyTotalRowStyle(netRow);
  netRow.getCell(4).numFmt = EXCEL_NUMBER_FMT;
  netRow.getCell(5).numFmt = EXCEL_NUMBER_FMT;

  ws.addRow([]);

  // PHẦN II: CƠ CẤU CHI THEO DANH MỤC
  const sec2 = ws.addRow(['II', 'CƠ CẤU CHI PHÍ THEO DANH MỤC', '', '', '', '']);
  applySectionBannerStyle(sec2);

  const hdr2 = ws.addRow([
    'STT',
    'Tên danh mục chi',
    'Mảng',
    'Số tiền (VNĐ)',
    'Tỷ trọng (%)',
    'Trạng thái',
  ]);
  applyTableHeaderStyle(hdr2);

  monthly.chi_theo_danh_muc.forEach((catItem, idx) => {
    const r = ws.addRow([
      idx + 1,
      catItem.ten_danh_muc,
      SEGMENT_LABELS[catItem.mang],
      catItem.so_tien,
      catItem.ty_le_phan_tram,
      catItem.la_uoc_tinh ? 'Tạm tính từ tháng trước' : 'Thực tế',
    ]);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(4).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(5).numFmt = EXCEL_PERCENT_FMT;
  });

  const totalCatRow = ws.addRow([
    '',
    'TỔNG CHI TOÀN CƠ SỞ',
    '',
    monthly.tong_chi_toan_co_so,
    monthly.tong_chi_toan_co_so > 0 ? 100 : 0,
    '',
  ]);
  applyTotalRowStyle(totalCatRow);
  totalCatRow.getCell(4).numFmt = EXCEL_NUMBER_FMT;
  totalCatRow.getCell(5).numFmt = EXCEL_PERCENT_FMT;
}

function populateCashflowSheet(
  ws: import('exceljs').Worksheet,
  snapshot: BookSnapshot,
  kyThang: string
): void {
  const wallets = computeWalletBalances(
    snapshot.wallets,
    snapshot.transactions,
    snapshot.book.id
  );
  const timeline = computeWalletTimeline(snapshot, { kyThang }).slice().reverse();

  ws.columns = [
    { key: 'c1', width: 8 },
    { key: 'c2', width: 15 },
    { key: 'c3', width: 28 },
    { key: 'c4', width: 24 },
    { key: 'c5', width: 20 },
    { key: 'c6', width: 20 },
    { key: 'c7', width: 22 },
  ];

  const sec1 = ws.addRow([
    'I',
    `SỐ DƯ THỰC TẾ 3 VÍ — ${snapshot.book.ten.toUpperCase()}`,
    '',
    '',
    '',
    '',
    '',
  ]);
  applySectionBannerStyle(sec1);

  const hdr1 = ws.addRow([
    'STT',
    'Mã loại',
    'Tên ví / Tài khoản',
    'Người giữ',
    'Số dư đầu kỳ',
    'Biến động ròng',
    'Số dư thực có',
  ]);
  applyTableHeaderStyle(hdr1);

  let sumDauKy = 0;
  let sumBienDong = 0;
  let sumHienTai = 0;

  wallets.forEach((w, idx) => {
    const netChange = w.tong_tien_vao - w.tong_tien_ra;
    sumDauKy += w.wallet.so_du_dau_ky;
    sumBienDong += netChange;
    sumHienTai += w.so_du_hien_tai;

    const r = ws.addRow([
      idx + 1,
      w.wallet.loai_vi,
      w.wallet.ten_vi,
      w.wallet.chu_tai_khoan,
      w.wallet.so_du_dau_ky,
      netChange,
      w.so_du_hien_tai,
    ]);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(5).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(6).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(7).numFmt = EXCEL_NUMBER_FMT;
  });

  const totW = ws.addRow([
    '',
    '',
    'TỔNG TIỀN THỰC CÓ TRONG 3 VÍ',
    '',
    sumDauKy,
    sumBienDong,
    sumHienTai,
  ]);
  applyTotalRowStyle(totW);
  totW.getCell(5).numFmt = EXCEL_NUMBER_FMT;
  totW.getCell(6).numFmt = EXCEL_NUMBER_FMT;
  totW.getCell(7).numFmt = EXCEL_NUMBER_FMT;

  ws.addRow([]);

  const sec2 = ws.addRow([
    'II',
    `DÒNG THỜI GIAN TIỀN VÀO / RA (${formatVietnameseMonth(kyThang)})`,
    '',
    '',
    '',
    '',
    '',
  ]);
  applySectionBannerStyle(sec2);

  const hdr2 = ws.addRow([
    'STT',
    'Ngày',
    'Ví / Tài khoản',
    'Nội dung giao dịch',
    'Hướng dòng tiền',
    'Biến động (VNĐ)',
    'Số dư lũy kế (VNĐ)',
  ]);
  applyTableHeaderStyle(hdr2);

  timeline.forEach((entry, idx) => {
    const r = ws.addRow([
      idx + 1,
      isoDateToExcelDate(entry.tx.ngay),
      entry.ten_vi_hien_thi,
      entry.tieu_de,
      entry.huong === 'vao' ? 'Tiền vào' : entry.huong === 'ra' ? 'Tiền ra' : 'Chuyển quỹ',
      entry.bien_dong,
      entry.so_du_sau_gd,
    ]);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(2).numFmt = EXCEL_DATE_FMT;
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(6).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(7).numFmt = EXCEL_NUMBER_FMT;
  });
}

function populateDebtAndPayablesSheet(
  ws: import('exceljs').Worksheet,
  snapshot: BookSnapshot,
  kyThang: string,
  referenceDate: string
): void {
  const debt = computeDebtAndPayables(snapshot, kyThang, referenceDate);

  ws.columns = [
    { key: 'c1', width: 8 },
    { key: 'c2', width: 28 },
    { key: 'c3', width: 22 },
    { key: 'c4', width: 18 },
    { key: 'c5', width: 18 },
    { key: 'c6', width: 18 },
    { key: 'c7', width: 16 },
    { key: 'c8', width: 14 },
  ];

  // BẢNG 1: CÔNG NỢ NHÀ CUNG CẤP
  const s1 = ws.addRow(['I', 'SỔ NỢ NHÀ CUNG CẤP (MUA CHỊU)', '', '', '', '', '', '']);
  applySectionBannerStyle(s1);

  const h1 = ws.addRow([
    'STT',
    'Nhà cung cấp',
    'Mặt hàng chính',
    'Nợ đầu kỳ',
    'Tổng mua chịu',
    'Tổng đã trả',
    'Còn đang nợ',
    'Ngày nợ cũ nhất',
  ]);
  applyTableHeaderStyle(h1);

  debt.nha_cung_cap.danh_sach.forEach((item, idx) => {
    const r = ws.addRow([
      idx + 1,
      item.supplier.ten_ncc,
      item.supplier.mat_hang_chinh,
      item.supplier.no_dau_ky,
      item.tong_mua_chiu,
      item.tong_da_tra,
      item.con_no,
      isoDateToExcelDate(item.ngay_no_cu_nhat),
    ]);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(4).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(5).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(6).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(7).numFmt = EXCEL_NUMBER_FMT;
    if (item.ngay_no_cu_nhat) {
      r.getCell(8).numFmt = EXCEL_DATE_FMT;
      r.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  });

  const totSup = ws.addRow([
    '',
    'TỔNG NỢ NHÀ CUNG CẤP',
    '',
    '',
    '',
    '',
    debt.nha_cung_cap.tong_no_ncc,
    '',
  ]);
  applyTotalRowStyle(totSup);
  totSup.getCell(7).numFmt = EXCEL_NUMBER_FMT;

  ws.addRow([]);

  // BẢNG 2: LƯƠNG THỢ PHẢI TRẢ TRONG KỲ
  const s2 = ws.addRow([
    'II',
    `LƯƠNG THỢ PHỤ BẾP (${formatVietnameseMonth(kyThang)})`,
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  applySectionBannerStyle(s2);

  const h2 = ws.addRow([
    'STT',
    'Họ tên phụ bếp',
    'Lương chuẩn/ngày',
    'Tổng số công',
    'Thành tiền lương',
    'Đã ứng / trả',
    'Còn phải trả',
    '',
  ]);
  applyTableHeaderStyle(h2);

  debt.luong_tho_ky_nay.chi_tiet_tho.forEach((w, idx) => {
    const r = ws.addRow([
      idx + 1,
      w.worker.ho_ten,
      w.worker.luong_ngay,
      w.tong_cong,
      w.thanh_tien,
      w.da_ung,
      w.con_lai,
      '',
    ]);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(3).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(4).numFmt = '#,##0.0';
    r.getCell(5).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(6).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(7).numFmt = EXCEL_NUMBER_FMT;
  });

  const totWage = ws.addRow([
    '',
    'TỔNG LƯƠNG PHẢI TRẢ KỲ NÀY',
    '',
    '',
    debt.luong_tho_ky_nay.tong_luong_tinh_theo_cong,
    debt.luong_tho_ky_nay.da_tra_hoac_ung,
    debt.luong_tho_ky_nay.con_phai_tra,
    '',
  ]);
  applyTotalRowStyle(totWage);
  totWage.getCell(5).numFmt = EXCEL_NUMBER_FMT;
  totWage.getCell(6).numFmt = EXCEL_NUMBER_FMT;
  totWage.getCell(7).numFmt = EXCEL_NUMBER_FMT;

  ws.addRow([]);

  // BẢNG 3: TIỀN TRƯỜNG DỰ KIẾN VỀ
  const s3 = ws.addRow([
    'III',
    `TIỀN SUẤT ĂN TRƯỜNG DỰ KIẾN VỀ (${formatVietnameseMonth(kyThang)})`,
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  applySectionBannerStyle(s3);

  const h3 = ws.addRow([
    'STT',
    'Khoản mục đối chiếu',
    'Tổng suất trường',
    'Số tiền dự kiến',
    'Trường đã chuyển',
    'Còn chờ chuyển',
    '',
    '',
  ]);
  applyTableHeaderStyle(h3);

  const schoolRow = ws.addRow([
    1,
    'Tiền ăn trường chuyển về TK Mợ Diệp',
    debt.tien_truong_ky_nay.tong_suat_truong,
    debt.tien_truong_ky_nay.so_tien_du_kien,
    debt.tien_truong_ky_nay.truong_da_chuyen,
    debt.tien_truong_ky_nay.con_cho_chuyen,
    '',
    '',
  ]);
  schoolRow.getCell(1).numFmt = EXCEL_NUMBER_FMT;
  schoolRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  schoolRow.getCell(3).numFmt = EXCEL_NUMBER_FMT;
  schoolRow.getCell(4).numFmt = EXCEL_NUMBER_FMT;
  schoolRow.getCell(5).numFmt = EXCEL_NUMBER_FMT;
  schoolRow.getCell(6).numFmt = EXCEL_NUMBER_FMT;
}

function populateTransactionsSheet(
  ws: import('exceljs').Worksheet,
  snapshots: BookSnapshot[],
  kyThang: string
): void {
  const includeFacilityCol = snapshots.length > 1;
  ws.columns = includeFacilityCol
    ? [
        { key: 'c1', width: 7 },
        { key: 'c2', width: 22 },
        { key: 'c3', width: 14 },
        { key: 'c4', width: 13 },
        { key: 'c5', width: 24 },
        { key: 'c6', width: 24 },
        { key: 'c7', width: 24 },
        { key: 'c8', width: 18 },
        { key: 'c9', width: 34 },
      ]
    : [
        { key: 'c1', width: 7 },
        { key: 'c2', width: 14 },
        { key: 'c3', width: 13 },
        { key: 'c4', width: 24 },
        { key: 'c5', width: 24 },
        { key: 'c6', width: 24 },
        { key: 'c7', width: 18 },
        { key: 'c8', width: 34 },
      ];

  const headers = includeFacilityCol
    ? [
        'STT',
        'Cơ sở',
        'Ngày',
        'Mảng',
        'Loại giao dịch',
        'Danh mục',
        'Ví / Nhà cung cấp',
        'Số tiền (VNĐ)',
        'Ghi chú',
      ]
    : [
        'STT',
        'Ngày',
        'Mảng',
        'Loại giao dịch',
        'Danh mục',
        'Ví / Nhà cung cấp',
        'Số tiền (VNĐ)',
        'Ghi chú',
      ];

  const hdr = ws.addRow(headers);
  applyTableHeaderStyle(hdr);
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const mergedRows: Array<{
    bookName: string;
    ngay: string;
    timestamp: string;
    mang: string;
    loai: string;
    danhMuc: string;
    viHoacNcc: string;
    soTien: number;
    ghiChu: string;
  }> = [];

  for (const snap of snapshots) {
    const catMap = new Map(snap.categories.map((c) => [c.id, c.ten_danh_muc]));
    const walMap = new Map(snap.wallets.map((w) => [w.id, w.ten_vi]));
    const supMap = new Map(snap.suppliers.map((s) => [s.id, s.ten_ncc]));

    // Bổ sung cả dòng suất ăn hằng ngày để sổ chi tiết đầy đủ
    const mealDates = Array.from(
      new Set(
        snap.mealCounts
          .filter((m) => m.book_id === snap.book.id && getYearMonth(m.ngay) === kyThang)
          .map((m) => m.ngay)
      )
    ).sort();

    for (const d of mealDates) {
      const daily = computeDailyReport(snap, d);
      if (daily.bep_an.tong_suat > 0) {
        mergedRows.push({
          bookName: snap.book.ten,
          ngay: d,
          timestamp: `${d}T06:00:00Z`,
          mang: 'Bếp ăn',
          loai: 'Doanh thu suất ăn ngày',
          danhMuc: `Suất ăn (${daily.bep_an.tong_suat} suất)`,
          viHoacNcc: `Trường: ${daily.bep_an.suat_truong} · Vãng lai: ${daily.bep_an.suat_vang_lai}`,
          soTien: daily.bep_an.doanh_thu_truong + daily.bep_an.doanh_thu_vang_lai,
          ghiChu: 'Tính theo đơn giá hiệu lực trong ngày',
        });
      }
    }

    for (const tx of snap.transactions) {
      if (tx.book_id !== snap.book.id || tx.da_xoa) continue;
      const effectiveMonth = tx.ky_thang || getYearMonth(tx.ngay);
      if (getYearMonth(tx.ngay) !== kyThang && effectiveMonth !== kyThang) continue;

      const walName = tx.wallet_id ? walMap.get(tx.wallet_id) ?? '' : '';
      const supName = tx.supplier_id ? supMap.get(tx.supplier_id) ?? '' : '';
      const targetLabel = [walName, supName].filter(Boolean).join(' · ') || '—';

      mergedRows.push({
        bookName: snap.book.ten,
        ngay: tx.ngay,
        timestamp: tx.timestamp,
        mang: SEGMENT_LABELS[tx.mang],
        loai: TX_TYPE_LABELS[tx.loai] ?? tx.loai,
        danhMuc: catMap.get(tx.category_id) ?? tx.category_id,
        viHoacNcc: targetLabel,
        soTien: tx.so_tien,
        ghiChu: tx.ghi_chu || '',
      });
    }
  }

  mergedRows.sort((a, b) => {
    const c = a.ngay.localeCompare(b.ngay);
    if (c !== 0) return c;
    return a.timestamp.localeCompare(b.timestamp);
  });

  mergedRows.forEach((item, idx) => {
    const excelDate = isoDateToExcelDate(item.ngay);
    const values = includeFacilityCol
      ? [
          idx + 1,
          item.bookName,
          excelDate,
          item.mang,
          item.loai,
          item.danhMuc,
          item.viHoacNcc,
          item.soTien,
          item.ghiChu,
        ]
      : [
          idx + 1,
          excelDate,
          item.mang,
          item.loai,
          item.danhMuc,
          item.viHoacNcc,
          item.soTien,
          item.ghiChu,
        ];

    const r = ws.addRow(values);
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    const dateCol = includeFacilityCol ? 3 : 2;
    const moneyCol = includeFacilityCol ? 8 : 7;

    r.getCell(dateCol).numFmt = EXCEL_DATE_FMT;
    r.getCell(dateCol).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(moneyCol).numFmt = EXCEL_NUMBER_FMT;
  });
}

/**
 * Sinh Buffer `.xlsx` chuẩn kế toán cho 1 cơ sở (Bố - Hiệp Hòa hoặc Mẹ - Tiên Du)
 * ngay trên bộ nhớ RAM — tuyệt đối không ghi file tạm hay file backup ra ổ đĩa.
 */
export async function buildSingleBookMonthlyExcelBuffer(
  snapshot: BookSnapshot,
  kyThang: string,
  referenceDate: string = getTodayISO()
): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sổ Bếp Nhà Mình';
  wb.created = new Date();

  const ws1 = wb.addWorksheet('1_Tong_Hop_Lai_Lo');
  populateFacilityOverviewSheet(ws1, snapshot, kyThang, referenceDate);

  const ws2 = wb.addWorksheet('2_So_Dong_Tien_3_Vi');
  populateCashflowSheet(ws2, snapshot, kyThang);

  const ws3 = wb.addWorksheet('3_So_No_Phai_Tra');
  populateDebtAndPayablesSheet(ws3, snapshot, kyThang, referenceDate);

  const ws4 = wb.addWorksheet('4_Chi_Tiet_Giao_Dich');
  populateTransactionsSheet(ws4, [snapshot], kyThang);

  enforceWorkbookStandardFormatting(wb);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/**
 * Sinh Buffer `.xlsx` Tổng hợp & So sánh cả 2 cơ sở dành cho Admin (Con)
 * ngay trên bộ nhớ RAM — tuyệt đối không sinh file backup.
 */
export async function buildAdminCombinedMonthlyExcelBuffer(
  hhSnapshot: BookSnapshot,
  tdSnapshot: BookSnapshot,
  kyThang: string,
  referenceDate: string = getTodayISO()
): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sổ Bếp Nhà Mình — Admin';
  wb.created = new Date();

  const combined = computeAdminCombinedSummary(hhSnapshot, tdSnapshot, kyThang, {
    reminderOptions: { referenceDate },
  });
  const { hiepHoa: hh, tienDu: td, tongCong: tc } = combined;
  const mLabel = formatVietnameseMonth(kyThang);

  // SHEET 1: BẢNG SO SÁNH 2 CƠ SỞ & TỔNG HỢP CẢ NHÀ
  const wsCompare = wb.addWorksheet('1_So_Sanh_2_Co_So');
  wsCompare.columns = [
    { key: 'c1', width: 8 },
    { key: 'c2', width: 40 },
    { key: 'c3', width: 22 },
    { key: 'c4', width: 22 },
    { key: 'c5', width: 24 },
  ];

  const tRow = wsCompare.addRow([
    `BÁO CÁO TỔNG HỢP 2 CƠ SỞ — SỔ BẾP NHÀ MÌNH (${mLabel.toUpperCase()})`,
  ]);
  wsCompare.mergeCells(`A${tRow.number}:E${tRow.number}`);
  tRow.getCell(1).font = { name: EXCEL_FONT_NAME, size: EXCEL_FONT_SIZE, bold: true };
  tRow.height = 24;

  const dateRow = wsCompare.addRow([
    'Ngày xuất:',
    isoDateToExcelDate(referenceDate),
    '',
    'Kỳ báo cáo:',
    mLabel,
  ]);
  dateRow.getCell(2).numFmt = EXCEL_DATE_FMT;

  wsCompare.addRow([]);

  const hdr = wsCompare.addRow([
    'STT',
    'Chỉ tiêu so sánh',
    'Hiệp Hòa (Bố)',
    'Tiên Du (Mẹ)',
    'Tổng cộng 2 cơ sở',
  ]);
  applyTableHeaderStyle(hdr);

  const comparisonRows: Array<[number, string, number, number, number, boolean?]> = [
    [
      1,
      'Tổng số suất ăn phục vụ (suất)',
      hh.monthly.bep_an.tong_suat,
      td.monthly.bep_an.tong_suat,
      tc.tongSuatAn,
    ],
    [
      2,
      'Tổng doanh thu toàn cơ sở (VNĐ)',
      hh.monthly.tong_doanh_thu_toan_co_so,
      td.monthly.tong_doanh_thu_toan_co_so,
      tc.tongDoanhThu,
    ],
    [
      3,
      'Tổng chi phí toàn cơ sở (VNĐ)',
      hh.monthly.tong_chi_toan_co_so,
      td.monthly.tong_chi_toan_co_so,
      tc.tongChi,
    ],
    [
      4,
      'Lãi mảng Bếp ăn (VNĐ)',
      hh.monthly.bep_an.lai_bep_an,
      td.monthly.bep_an.lai_bep_an,
      tc.laiBepAn,
    ],
    [
      5,
      'Lãi mảng Căn tin (VNĐ)',
      hh.monthly.can_tin.lai_can_tin,
      td.monthly.can_tin.lai_can_tin,
      tc.laiCanTin,
    ],
    [
      6,
      'Chi phí cuối tháng áp dụng (điện, nước, ga, gia vị)',
      hh.monthly.tong_chi_cuoi_thang_ap_dung,
      td.monthly.tong_chi_cuoi_thang_ap_dung,
      tc.chiCuoiThangApDung,
    ],
    [
      7,
      'LÃI RÒNG THÁNG (VNĐ)',
      hh.monthly.lai_rong_toan_co_so,
      td.monthly.lai_rong_toan_co_so,
      tc.laiRong,
      true,
    ],
    [
      8,
      'Tiền mặt thực có trong két (VNĐ)',
      hh.tienMat,
      td.tienMat,
      tc.tongTienMat2CoSo,
    ],
    [
      9,
      'Số dư TK Mợ Diệp — Tiền trường (VNĐ)',
      hh.tkMoDiep,
      td.tkMoDiep,
      tc.tongTkMoDiep2CoSo,
    ],
    [
      10,
      'Số dư TK Chị Nhàn — Căn tin & Vãng lai (VNĐ)',
      hh.tkChiNhan,
      td.tkChiNhan,
      tc.tongTkChiNhan2CoSo,
    ],
    [
      11,
      'TỔNG TIỀN THỰC CÓ TRONG VÍ (VNĐ)',
      hh.tongTienThucCo,
      td.tongTienThucCo,
      tc.tongTienThucCo6Vi,
      true,
    ],
    [
      12,
      'Đang nợ nhà cung cấp (VNĐ)',
      hh.debt.nha_cung_cap.tong_no_ncc,
      td.debt.nha_cung_cap.tong_no_ncc,
      tc.tongNoNhaCungCap,
    ],
    [
      13,
      'Lương thợ phụ bếp còn phải trả (VNĐ)',
      hh.debt.luong_tho_ky_nay.con_phai_tra,
      td.debt.luong_tho_ky_nay.con_phai_tra,
      tc.tongLuongThoChoTra,
    ],
    [
      14,
      'Tiền trường dự kiến còn chờ chuyển về (VNĐ)',
      hh.debt.tien_truong_ky_nay.con_cho_chuyen,
      td.debt.tien_truong_ky_nay.con_cho_chuyen,
      tc.tongTienTruongChoVe,
    ],
  ];

  for (const [stt, label, vHh, vTd, vTotal, highlight] of comparisonRows) {
    const r = wsCompare.addRow([stt, label, vHh, vTd, vTotal]);
    if (highlight) {
      applyTotalRowStyle(r);
    }
    r.getCell(1).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(3).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(4).numFmt = EXCEL_NUMBER_FMT;
    r.getCell(5).numFmt = EXCEL_NUMBER_FMT;
  }

  // SHEET 2 & 3: CHI TIẾT TỪNG CƠ SỞ
  const wsHh = wb.addWorksheet('2_So_Bep_Hiep_Hoa');
  populateFacilityOverviewSheet(wsHh, hhSnapshot, kyThang, referenceDate);

  const wsTd = wb.addWorksheet('3_So_Bep_Tien_Du');
  populateFacilityOverviewSheet(wsTd, tdSnapshot, kyThang, referenceDate);

  // SHEET 4: TẤT CẢ GIAO DỊCH 2 CƠ SỞ TRONG THÁNG
  const wsAllTx = wb.addWorksheet('4_Giao_Dich_2_Co_So');
  populateTransactionsSheet(wsAllTx, [hhSnapshot, tdSnapshot], kyThang);

  enforceWorkbookStandardFormatting(wb);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

export function buildSingleBookExcelFilename(
  bookId: BookSnapshot['book']['id'],
  kyThang: string
): string {
  const [y, m] = kyThang.split('-');
  const slug = bookId === 'hiep_hoa' ? 'Hiep_Hoa' : 'Tien_Du';
  return `So_Bep_${slug}_Thang_${m}_${y}.xlsx`;
}

export function buildAdminCombinedExcelFilename(kyThang: string): string {
  const [y, m] = kyThang.split('-');
  return `So_Bep_Nha_Minh_Tong_Hop_Thang_${m}_${y}.xlsx`;
}

function triggerBrowserXlsxDownload(bytes: Uint8Array, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadSingleBookMonthlyExcel(
  snapshot: BookSnapshot,
  kyThang: string
): Promise<string> {
  const bytes = await buildSingleBookMonthlyExcelBuffer(snapshot, kyThang);
  const filename = buildSingleBookExcelFilename(snapshot.book.id, kyThang);
  triggerBrowserXlsxDownload(bytes, filename);
  return filename;
}

export async function downloadAdminCombinedMonthlyExcel(
  hhSnapshot: BookSnapshot,
  tdSnapshot: BookSnapshot,
  kyThang: string
): Promise<string> {
  const bytes = await buildAdminCombinedMonthlyExcelBuffer(hhSnapshot, tdSnapshot, kyThang);
  const filename = buildAdminCombinedExcelFilename(kyThang);
  triggerBrowserXlsxDownload(bytes, filename);
  return filename;
}
