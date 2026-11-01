import type { BookId, BookSnapshot, ChatLog } from '../types/models';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
  computeWalletBalances,
  type DebtAndPayablesSummary,
  type MonthlyReport,
  type WalletBalanceSummary,
} from './accounting';
import {
  formatVietnameseDate,
  formatVietnameseMonth,
  formatVND,
  getTodayISO,
} from './format';
import {
  evaluateActiveReminders,
  type ActiveReminderCard,
  type EvaluateRemindersOptions,
} from './reminders';

export interface AdminFacilitySummary {
  bookId: BookId;
  bookName: string;
  ownerLabel: string;
  snapshot: BookSnapshot;
  monthly: MonthlyReport;
  wallets: WalletBalanceSummary[];
  tongTienThucCo: number;
  tienMat: number;
  tkMoDiep: number;
  tkChiNhan: number;
  debt: DebtAndPayablesSummary;
  activeReminders: ActiveReminderCard[];
  chatLogs: ChatLog[];
}

export interface CombinedReminderItem {
  bookId: BookId;
  bookName: string;
  ownerLabel: string;
  card: ActiveReminderCard;
}

export interface AdminCombinedSummary {
  kyThang: string;
  referenceDate: string;
  hiepHoa: AdminFacilitySummary;
  tienDu: AdminFacilitySummary;
  tongCong: {
    tongDoanhThu: number;
    tongChi: number;
    laiRong: number;
    tongSuatAn: number;
    laiBepAn: number;
    laiCanTin: number;
    chiCuoiThangApDung: number;
    tongTienThucCo6Vi: number;
    tongTienMat2CoSo: number;
    tongTkMoDiep2CoSo: number;
    tongTkChiNhan2CoSo: number;
    tongNoNhaCungCap: number;
    tongLuongThoChoTra: number;
    tongTienTruongChoVe: number;
    tongSoNhacDangTreo: number;
  };
  combinedReminders: CombinedReminderItem[];
  combinedChatLogs: ChatLog[];
}

const URGENCY_WEIGHT: Record<ActiveReminderCard['muc_do'], number> = {
  khan: 0,
  quan_trong: 1,
  nhac_nho: 2,
};

export function computeFacilitySummary(
  snapshot: BookSnapshot,
  kyThang: string,
  chatLogs: ChatLog[] = [],
  reminderOptions?: EvaluateRemindersOptions
): AdminFacilitySummary {
  const bookId = snapshot.book.id;
  const refDate = reminderOptions?.referenceDate || getTodayISO();
  const monthly = computeMonthlyReport(snapshot, kyThang);
  const wallets = computeWalletBalances(snapshot.wallets, snapshot.transactions, bookId);
  const debt = computeDebtAndPayables(snapshot, kyThang, refDate);
  const activeReminders = evaluateActiveReminders(snapshot, reminderOptions);

  const tienMat =
    wallets.find((w) => w.wallet.loai_vi === 'tien_mat')?.so_du_hien_tai ?? 0;
  const tkMoDiep =
    wallets.find((w) => w.wallet.loai_vi === 'tk_mo_diep')?.so_du_hien_tai ?? 0;
  const tkChiNhan =
    wallets.find((w) => w.wallet.loai_vi === 'tk_chi_nhan')?.so_du_hien_tai ?? 0;
  const tongTienThucCo = wallets.reduce((s, w) => s + w.so_du_hien_tai, 0);

  const ownerLabel =
    bookId === 'hiep_hoa' ? 'Hiệp Hòa (Bố)' : 'Tiên Du (Mẹ)';

  return {
    bookId,
    bookName: snapshot.book.ten,
    ownerLabel,
    snapshot,
    monthly,
    wallets,
    tongTienThucCo,
    tienMat,
    tkMoDiep,
    tkChiNhan,
    debt,
    activeReminders,
    chatLogs: [...chatLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
  };
}

export function computeAdminCombinedSummary(
  hhSnapshot: BookSnapshot,
  tdSnapshot: BookSnapshot,
  kyThang: string,
  options?: {
    hhChatLogs?: ChatLog[];
    tdChatLogs?: ChatLog[];
    reminderOptions?: EvaluateRemindersOptions;
  }
): AdminCombinedSummary {
  const refDate = options?.reminderOptions?.referenceDate || getTodayISO();
  const hiepHoa = computeFacilitySummary(
    hhSnapshot,
    kyThang,
    options?.hhChatLogs ?? [],
    options?.reminderOptions
  );
  const tienDu = computeFacilitySummary(
    tdSnapshot,
    kyThang,
    options?.tdChatLogs ?? [],
    options?.reminderOptions
  );

  const combinedReminders: CombinedReminderItem[] = [
    ...hiepHoa.activeReminders.map((card) => ({
      bookId: hiepHoa.bookId,
      bookName: hiepHoa.bookName,
      ownerLabel: hiepHoa.ownerLabel,
      card,
    })),
    ...tienDu.activeReminders.map((card) => ({
      bookId: tienDu.bookId,
      bookName: tienDu.bookName,
      ownerLabel: tienDu.ownerLabel,
      card,
    })),
  ].sort((a, b) => URGENCY_WEIGHT[a.card.muc_do] - URGENCY_WEIGHT[b.card.muc_do]);

  const combinedChatLogs = [...hiepHoa.chatLogs, ...tienDu.chatLogs].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  return {
    kyThang,
    referenceDate: refDate,
    hiepHoa,
    tienDu,
    tongCong: {
      tongDoanhThu:
        hiepHoa.monthly.tong_doanh_thu_toan_co_so +
        tienDu.monthly.tong_doanh_thu_toan_co_so,
      tongChi:
        hiepHoa.monthly.tong_chi_toan_co_so + tienDu.monthly.tong_chi_toan_co_so,
      laiRong:
        hiepHoa.monthly.lai_rong_toan_co_so + tienDu.monthly.lai_rong_toan_co_so,
      tongSuatAn: hiepHoa.monthly.bep_an.tong_suat + tienDu.monthly.bep_an.tong_suat,
      laiBepAn: hiepHoa.monthly.bep_an.lai_bep_an + tienDu.monthly.bep_an.lai_bep_an,
      laiCanTin:
        hiepHoa.monthly.can_tin.lai_can_tin + tienDu.monthly.can_tin.lai_can_tin,
      chiCuoiThangApDung:
        hiepHoa.monthly.tong_chi_cuoi_thang_ap_dung +
        tienDu.monthly.tong_chi_cuoi_thang_ap_dung,
      tongTienThucCo6Vi: hiepHoa.tongTienThucCo + tienDu.tongTienThucCo,
      tongTienMat2CoSo: hiepHoa.tienMat + tienDu.tienMat,
      tongTkMoDiep2CoSo: hiepHoa.tkMoDiep + tienDu.tkMoDiep,
      tongTkChiNhan2CoSo: hiepHoa.tkChiNhan + tienDu.tkChiNhan,
      tongNoNhaCungCap:
        hiepHoa.debt.nha_cung_cap.tong_no_ncc + tienDu.debt.nha_cung_cap.tong_no_ncc,
      tongLuongThoChoTra:
        hiepHoa.debt.luong_tho_ky_nay.con_phai_tra +
        tienDu.debt.luong_tho_ky_nay.con_phai_tra,
      tongTienTruongChoVe:
        hiepHoa.debt.tien_truong_ky_nay.con_cho_chuyen +
        tienDu.debt.tien_truong_ky_nay.con_cho_chuyen,
      tongSoNhacDangTreo: combinedReminders.length,
    },
    combinedReminders,
    combinedChatLogs,
  };
}

/**
 * Bóc tách ngày mục tiêu (YYYY-MM-DD) từ một bản ghi `chat_logs` để khi Admin bấm "Sửa hộ"
 * sẽ mở đúng ngày của câu nói đó (ví dụ ông/bà nói "Hôm qua mua thịt..." thì nhảy đúng về hôm qua).
 */
export function extractChatLogTargetDate(log: ChatLog): string {
  try {
    const raw =
      typeof log.ai_json === 'string' ? JSON.parse(log.ai_json) : log.ai_json;
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.ngay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.ngay)) {
        return obj.ngay;
      }
      if (Array.isArray(obj.cards) && obj.cards.length > 0) {
        const first = obj.cards[0] as Record<string, unknown>;
        if (typeof first.ngay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first.ngay)) {
          return first.ngay;
        }
      }
    }
  } catch {
    // Fallback below
  }
  const tsDate = String(log.timestamp || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(tsDate) ? tsDate : getTodayISO();
}

/**
 * Bóc tách tóm tắt ngắn gọn kết quả AI hiểu từ `ai_json` để Admin rà soát nhanh.
 */
export function extractChatLogAiPreview(log: ChatLog): string {
  try {
    const raw =
      typeof log.ai_json === 'string' ? JSON.parse(log.ai_json) : log.ai_json;
    if (!raw || typeof raw !== 'object') return '';
    const obj = raw as Record<string, unknown>;

    if (typeof obj.clarification_question === 'string' && obj.clarification_question) {
      return `AI hỏi lại: ${obj.clarification_question}`;
    }
    if (typeof obj.assistant_reply === 'string' && obj.assistant_reply) {
      return `${obj.assistant_reply}`;
    }
    if (Array.isArray(obj.cards) && obj.cards.length > 0) {
      const titles = obj.cards
        .map((c) => {
          const rec = c as Record<string, unknown>;
          return String(rec.title || rec.tieu_de || rec.kind || '').trim();
        })
        .filter(Boolean);
      if (titles.length > 0) {
        return `Hiểu ${obj.cards.length} mục: ${titles.join(' · ')}`;
      }
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Tạo bản tin tóm tắt cuối ngày chuẩn đẹp để gửi / dán vào nhóm Zalo gia đình.
 */
export function buildZaloDailySummaryText(
  snapshot: BookSnapshot,
  ngay: string
): string {
  const d = computeDailyReport(snapshot, ngay);
  const wallets = computeWalletBalances(
    snapshot.wallets,
    snapshot.transactions,
    snapshot.book.id
  );
  const tongVi = wallets.reduce((s, w) => s + w.so_du_hien_tai, 0);

  return [
    `TÓM TẮT CUỐI NGÀY — ${snapshot.book.ten.toUpperCase()}`,
    `${formatVietnameseDate(ngay)}`,
    `────────────────────`,
    `BẾP ĂN (${d.bep_an.tong_suat} suất):`,
    `• Tổng thu: ${formatVND(d.bep_an.tong_doanh_thu)} (Trường: ${d.bep_an.suat_truong}s · Vãng lai: ${d.bep_an.suat_vang_lai}s)`,
    `• Chi chợ & công thợ: -${formatVND(d.bep_an.tong_chi_ngay)}`,
    `• Lãi ước tính ngày: ${formatVND(d.bep_an.lai_uoc_tinh_ngay, true)}`,
    `CĂN TIN:`,
    `• Doanh thu thuần: ${formatVND(d.can_tin.doanh_thu_can_tin)}`,
    `• Chi nhập hàng: -${formatVND(d.can_tin.chi_nhap_hang_ngay)}`,
    `TIỀN THỰC CÓ TRONG 3 VÍ: ${formatVND(tongVi)}`,
  ].join('\n');
}

/**
 * Tạo bản tin tổng hợp cả 2 cơ sở theo tháng để gửi nhóm Zalo gia đình.
 */
export function buildZaloAdminMonthlySummaryText(
  combined: AdminCombinedSummary
): string {
  const mLabel = formatVietnameseMonth(combined.kyThang);
  const { hiepHoa: hh, tienDu: td, tongCong: tc } = combined;

  return [
    `BÁO CÁO TỔNG HỢP SỔ BẾP NHÀ MÌNH — ${mLabel.toUpperCase()}`,
    `────────────────────`,
    `LÃI RÒNG CẢ 2 CƠ SỞ: ${formatVND(tc.laiRong, true)}`,
    `• Hiệp Hòa (Bố): ${formatVND(hh.monthly.lai_rong_toan_co_so, true)} (${hh.monthly.bep_an.tong_suat} suất)`,
    `• Tiên Du (Mẹ): ${formatVND(td.monthly.lai_rong_toan_co_so, true)} (${td.monthly.bep_an.tong_suat} suất)`,
    `────────────────────`,
    `TỔNG TIỀN THỰC CÓ (6 VÍ): ${formatVND(tc.tongTienThucCo6Vi)}`,
    `• Hiệp Hòa: ${formatVND(hh.tongTienThucCo)} | Tiên Du: ${formatVND(td.tongTienThucCo)}`,
    `CÔNG NỢ & DỰ KIẾN:`,
    `• Đang nợ nhà cung cấp: ${formatVND(tc.tongNoNhaCungCap)}`,
    `• Lương thợ chờ trả: ${formatVND(tc.tongLuongThoChoTra)}`,
    `• Tiền trường chờ về TK Mợ Diệp: ${formatVND(tc.tongTienTruongChoVe)}`,
  ].join('\n');
}
