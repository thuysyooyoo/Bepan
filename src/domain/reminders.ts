import type { ManualFormKind } from '../components/ManualEntryForms';
import type { BookSnapshot, ReminderType } from '../types/models';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
} from './accounting';
import {
  formatCompactVND,
  formatVietnameseMonth,
  formatVND,
  getNowTimeHHmm,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
} from './format';

export interface ActiveReminderCard {
  key: string;
  loai_nhac: ReminderType;
  ky_thang: string; // YYYY-MM, YYYY-MM-DD, hoặc supplierId::YYYY-MM-DD
  muc_do: 'khan' | 'quan_trong' | 'nhac_nho';
  icon: string;
  tieu_de: string;
  noi_dung: string;
  so_tien_du_kien?: number;
  spoken_text: string;
  action_label: string;
  action_target:
    | { type: 'form'; kind: ManualFormKind }
    | { type: 'tab_no'; supplierId?: string };
}

export interface EvaluateRemindersOptions {
  referenceDate?: string;   // YYYY-MM-DD (mặc định hôm nay)
  currentTimeHHmm?: string; // HH:mm (mặc định giờ hiện tại)
}

/**
 * Động cơ sinh & tắt tự động 5 loại Thẻ Nhắc Việc 🔔 cho Bố (Hiệp Hòa) và Mẹ (Tiên Du):
 *  1) Hằng ngày từ giờ hẹn (mặc định 18:00): chưa nhập suất ăn hoặc chưa nhập thu cuối ngày Căn tin.
 *  2) Từ ngày hẹn (mặc định ngày 20): Trường chưa chuyển đủ tiền ăn tháng X (kèm số tiền dự kiến).
 *  3) Cuối tháng (từ ngày 25 hoặc đầu tháng sau): Trả lương thợ tháng X kèm số tiền gợi ý.
 *  4) Đầu tháng sau (hoặc từ ngày 28 cuối tháng): Nhập điện, nước, ga, gia vị tháng X.
 *  5) Nợ mua chịu nhà cung cấp quá N ngày (mặc định 15 ngày, tính chuẩn theo FIFO): "Nợ chị Hoa 3,2 triệu đã 15 ngày".
 *
 * Tất cả các thẻ đều TỰ ĐỘNG BIẾN MẤT 100% ngay khi dữ liệu tương ứng được nhập đủ!
 */
export function evaluateActiveReminders(
  snapshot: BookSnapshot,
  options?: EvaluateRemindersOptions
): ActiveReminderCard[] {
  const bookId = snapshot.book.id;
  const refDate = options?.referenceDate || getTodayISO();
  const nowHHmm = options?.currentTimeHHmm || getNowTimeHHmm();

  const currentMonth = getYearMonth(refDate);
  const prevMonth = getPreviousYearMonth(currentMonth);
  const dayOfMonth = Number(refDate.split('-')[2] || '1');

  const isDismissed = (loai: ReminderType, ky: string): boolean => {
    return snapshot.reminders.some(
      (r) =>
        r.book_id === bookId &&
        r.loai_nhac === loai &&
        r.ky_thang === ky &&
        (r.trang_thai === 'bo_qua' || r.trang_thai === 'xong')
    );
  };

  const hasRealMonthlyBill = (targetMonth: string): boolean => {
    return snapshot.transactions.some((t) => {
      if (t.book_id !== bookId || t.da_xoa) return false;
      if (t.loai !== 'chi' && t.loai !== 'chi_no') return false;
      const cat = snapshot.categories.find((c) => c.id === t.category_id);
      if (cat?.kieu_tinh !== 'theo_thang') return false;
      return (t.ky_thang || getYearMonth(t.ngay)) === targetMonth;
    });
  };

  const cards: ActiveReminderCard[] = [];

  // ---------------------------------------------------------------------------
  // 1. NHẮC HẰNG NGÀY LÚC 18:00: CHƯA NHẬP SUẤT ĂN HOẶC THU CUỐI NGÀY CĂN TIN
  // ---------------------------------------------------------------------------
  const dailyRemindTime = snapshot.book.gio_nhac_hang_ngay || '18:00';
  if (nowHHmm >= dailyRemindTime && !isDismissed('nhap_so_ngay', refDate)) {
    const daily = computeDailyReport(snapshot, refDate);
    const missingMeals = daily.bep_an.tong_suat === 0;
    const missingCanteen = daily.can_tin.tong_thu_quay_cuoi_ngay === 0;

    if (missingMeals || missingCanteen) {
      let tieuDe = '';
      let noiDung = '';
      let actionLabel = '';
      let formKind: ManualFormKind = 'suat_an';

      if (missingMeals && missingCanteen) {
        tieuDe = 'Chưa ghi suất ăn & thu cuối ngày hôm nay';
        noiDung =
          'Đã qua giờ chốt sổ chiều nay, ông/bà nhớ báo số suất ăn và tổng thu cuối ngày nhé!';
        actionLabel = '🍚 Ghi suất ăn ngay';
        formKind = 'suat_an';
      } else if (missingMeals) {
        tieuDe = 'Hôm nay chưa báo số suất ăn trường';
        noiDung =
          'Ông/bà bấm báo suất ăn (hoặc chọn Giống hôm qua) để sổ tính lãi Bếp ăn hôm nay nhé!';
        actionLabel = '🍚 Báo suất ăn ngay';
        formKind = 'suat_an';
      } else {
        tieuDe = 'Chưa nhập tổng thu cuối ngày Căn tin';
        noiDung =
          'Ông/bà đếm tiền mặt trong quầy + kiểm tra CK Chị Nhàn rồi nhập tổng thu cuối ngày nhé!';
        actionLabel = '💵 Nhập thu cuối ngày';
        formKind = 'thu_cuoi_ngay';
      }

      cards.push({
        key: `rem:${bookId}:nhap_so_ngay:${refDate}`,
        loai_nhac: 'nhap_so_ngay',
        ky_thang: refDate,
        muc_do: 'nhac_nho',
        icon: '🔔',
        tieu_de: tieuDe,
        noi_dung: noiDung,
        spoken_text: `Nhắc việc ${snapshot.book.ten}: ${tieuDe}. ${noiDung}`,
        action_label: actionLabel,
        action_target: { type: 'form', kind: formKind },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. TỪ NGÀY 20 (HOẶC ĐẦU THÁNG SAU NẾU THÁNG TRƯỚC CHƯA VỀ): TRƯỜNG CHUYỂN TIỀN
  // ---------------------------------------------------------------------------
  const schoolRemindDay = snapshot.book.ngay_nhac_truong_chuyen || 20;
  const schoolMonthsToCheck =
    dayOfMonth >= schoolRemindDay ? [prevMonth, currentMonth] : [prevMonth];

  for (const m of schoolMonthsToCheck) {
    if (isDismissed('truong_chuyen_tien', m)) continue;
    const debtM = computeDebtAndPayables(snapshot, m, refDate);
    const { tong_suat_truong, so_tien_du_kien, truong_da_chuyen, con_cho_chuyen } =
      debtM.tien_truong_ky_nay;

    if (so_tien_du_kien > 0 && con_cho_chuyen > 0) {
      const mLabel = formatVietnameseMonth(m);
      const tieuDe = `Trường chưa chuyển tiền ${mLabel}`;
      const noiDung =
        truong_da_chuyen > 0
          ? `Đã nấu ${tong_suat_truong} suất (dự kiến ${formatVND(
              so_tien_du_kien
            )}), trường mới chuyển ${formatVND(
              truong_da_chuyen
            )} · Còn chờ về TK Mợ Diệp: ${formatVND(con_cho_chuyen)}.`
          : `Đã nấu ${tong_suat_truong} suất · Số tiền dự kiến trường chuyển về TK Mợ Diệp: ${formatVND(
              con_cho_chuyen
            )}.`;

      cards.push({
        key: `rem:${bookId}:truong_chuyen_tien:${m}`,
        loai_nhac: 'truong_chuyen_tien',
        ky_thang: m,
        muc_do: m === prevMonth ? 'khan' : 'quan_trong',
        icon: '🏫',
        tieu_de: tieuDe,
        noi_dung: noiDung,
        so_tien_du_kien: con_cho_chuyen,
        spoken_text: `${tieuDe}. Số tiền dự kiến còn chờ về là ${formatVND(con_cho_chuyen)}.`,
        action_label: '🏫 Ghi nhận tiền trường về',
        action_target: { type: 'form', kind: 'truong_chuyen' },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CUỐI THÁNG (NGÀY >= 25 HOẶC THÁNG TRƯỚC CÒN TREO): TRẢ LƯƠNG THỢ KÈM GỢI Ý
  // ---------------------------------------------------------------------------
  const wageMonthsToCheck = dayOfMonth >= 25 ? [prevMonth, currentMonth] : [prevMonth];

  for (const m of wageMonthsToCheck) {
    if (isDismissed('tra_luong', m)) continue;
    const debtM = computeDebtAndPayables(snapshot, m, refDate);
    const { tong_luong_tinh_theo_cong, da_tra_hoac_ung, con_phai_tra } =
      debtM.luong_tho_ky_nay;

    if (con_phai_tra > 0) {
      const mLabel = formatVietnameseMonth(m);
      const tieuDe = `Trả lương thợ ${mLabel}`;
      const noiDung =
        da_tra_hoac_ung > 0
          ? `Tổng công tính lương ${formatVND(
              tong_luong_tinh_theo_cong
            )}, đã ứng ${formatVND(da_tra_hoac_ung)} · Số gợi ý cần trả nốt: ${formatVND(
              con_phai_tra
            )}.`
          : `Tổng lương chấm công của đội phụ bếp · Số tiền gợi ý trả: ${formatVND(
              con_phai_tra
            )}.`;

      cards.push({
        key: `rem:${bookId}:tra_luong:${m}`,
        loai_nhac: 'tra_luong',
        ky_thang: m,
        muc_do: m === prevMonth ? 'khan' : 'quan_trong',
        icon: '👷',
        tieu_de: tieuDe,
        noi_dung: noiDung,
        so_tien_du_kien: con_phai_tra,
        spoken_text: `${tieuDe}. Số tiền gợi ý còn phải trả là ${formatVND(con_phai_tra)}.`,
        action_label: '💰 Ghi trả lương thợ',
        action_target: { type: 'form', kind: 'tra_luong' },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. ĐẦU THÁNG SAU (HOẶC CUỐI THÁNG >= 28): NHẬP ĐIỆN, NƯỚC, GA, GIA VỊ THÁNG X
  // ---------------------------------------------------------------------------
  const billMonthsToCheck = dayOfMonth >= 28 ? [prevMonth, currentMonth] : [prevMonth];

  for (const m of billMonthsToCheck) {
    if (isDismissed('chi_phi_thang', m)) continue;
    const mReport = computeMonthlyReport(snapshot, m);
    if (mReport.so_ngay_hoat_dong > 0 && !hasRealMonthlyBill(m)) {
      const mLabel = formatVietnameseMonth(m);
      const tieuDe = `Nhập điện, nước, ga, gia vị ${mLabel}`;
      const noiDung = mReport.la_uoc_tinh_tu_thang_truoc
        ? `Lãi ${mLabel} đang tạm mượn mức tháng trước (${formatVND(
            mReport.tong_chi_cuoi_thang_ap_dung
          )}). Ông/bà nhập hóa đơn thật để chốt sổ nhé!`
        : `Chưa có hóa đơn điện, nước, ga, gia vị cuối kỳ để tính chuẩn lãi ròng ${mLabel}.`;

      cards.push({
        key: `rem:${bookId}:chi_phi_thang:${m}`,
        loai_nhac: 'chi_phi_thang',
        ky_thang: m,
        muc_do: 'quan_trong',
        icon: '⚡',
        tieu_de: tieuDe,
        noi_dung: noiDung,
        so_tien_du_kien:
          mReport.tong_chi_cuoi_thang_ap_dung > 0
            ? mReport.tong_chi_cuoi_thang_ap_dung
            : undefined,
        spoken_text: `${tieuDe}. ${noiDung}`,
        action_label: '⚡ Nhập hóa đơn tháng',
        action_target: { type: 'form', kind: 'chi_phi_thang' },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. NỢ NHÀ CUNG CẤP QUÁ HẠN (FIFO >= so_ngay_nhac_no_ncc, mặc định 15 ngày)
  // ---------------------------------------------------------------------------
  const maxDebtDays = Math.max(1, snapshot.book.so_ngay_nhac_no_ncc || 15);
  const currentDebt = computeDebtAndPayables(snapshot, currentMonth, refDate);

  for (const item of currentDebt.nha_cung_cap.danh_sach) {
    if (item.con_no > 0 && item.so_ngay_no_lau_nhat >= maxDebtDays) {
      const periodKey = `${item.supplier.id}::${item.ngay_no_cu_nhat || refDate}`;
      if (isDismissed('no_qua_han', periodKey)) continue;

      const compactDebt = formatCompactVND(item.con_no);
      const tieuDe = `Nợ ${item.supplier.ten_ncc} ${compactDebt} đã ${item.so_ngay_no_lau_nhat} ngày`;
      const oldestLabel = item.ngay_no_cu_nhat
        ? item.ngay_no_cu_nhat.split('-').reverse().join('/')
        : '';
      const noiDung = `Khoản lấy hàng ghi sổ từ ngày ${oldestLabel} đến nay đã ${
        item.so_ngay_no_lau_nhat
      } ngày chưa trả hết (tổng đang nợ: ${formatVND(item.con_no)}).`;

      cards.push({
        key: `rem:${bookId}:no_qua_han:${periodKey}`,
        loai_nhac: 'no_qua_han',
        ky_thang: periodKey,
        muc_do: 'khan',
        icon: '📕',
        tieu_de: tieuDe,
        noi_dung: noiDung,
        so_tien_du_kien: item.con_no,
        spoken_text: `${tieuDe}. Tổng số tiền đang nợ là ${formatVND(item.con_no)}.`,
        action_label: '🤝 Trả nợ ngay',
        action_target: { type: 'tab_no', supplierId: item.supplier.id },
      });
    }
  }

  return cards;
}
