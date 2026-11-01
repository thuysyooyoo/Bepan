import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Pencil,
  PieChart,
  Share2,
  Trash2,
  TrendingUp,
  Volume2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import {
  buildSpokenDailyReport,
  buildSpokenMonthlyReport,
  computeDailyReport,
  computeMonthlyReport,
  computeSevenDaySeries,
  getEffectiveMealPrice,
} from '../domain/accounting';
import { buildZaloDailySummaryText } from '../domain/adminSummary';
import { downloadSingleBookMonthlyExcel } from '../domain/excelExport';
import {
  formatCompactVND,
  formatShortWeekdayDate,
  formatVietnameseDate,
  formatVietnameseMonth,
  formatVND,
  getNextYearMonth,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
  shiftDateISO,
} from '../domain/format';
import type { BookSnapshot, BusinessSegment, MealPeriod, Transaction } from '../types/models';
import { speakVietnameseText, stopVietnameseSpeech, UndoBanner, type UndoState } from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';

export interface ProfitReportViewProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onSelectDate?: (isoDate: string) => void;
  onJumpToForm?: (kind: ManualFormKind) => void;
  onOpenManualForm?: (kind: ManualFormKind, editTx?: Transaction) => void;
  onDataChanged?: (undo?: UndoState) => Promise<void>;
}

function mapTransactionToFormKind(tx: Transaction, snapshot: BookSnapshot): ManualFormKind {
  if (tx.loai === 'thu_cuoi_ngay') return 'thu_cuoi_ngay';
  if (tx.loai === 'tra_no') return 'tra_no';
  if (tx.loai === 'truong_chuyen') return 'truong_chuyen';
  if (tx.loai === 'tra_luong') return 'tra_luong';
  if (tx.loai === 'chuyen_quy') return 'chuyen_quy';
  const cat = snapshot.categories.find((c) => c.id === tx.category_id);
  if (cat?.kieu_tinh === 'theo_thang') return 'chi_phi_thang';
  return 'chi';
}

type ReportMode = 'ngay' | 'thang';

const MEAL_LABELS: Record<MealPeriod, string> = {
  sang: 'Bữa sáng',
  trua: 'Bữa trưa',
  toi: 'Bữa tối',
};

const SEGMENT_BADGES: Record<
  BusinessSegment,
  { label: string; className: string }
> = {
  bep_an: {
    label: 'Bếp ăn',
    className: 'bg-teal-100 text-teal-900 border-teal-300',
  },
  can_tin: {
    label: 'Căn tin',
    className: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  chung: {
    label: 'Chung',
    className: 'bg-purple-100 text-purple-900 border-purple-300',
  },
};

export const ProfitReportView: React.FC<ProfitReportViewProps> = ({
  snapshot,
  selectedDate,
  onSelectDate,
  onJumpToForm,
  onOpenManualForm,
  onDataChanged,
}) => {
  const { session } = useAuth();
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const todayISO = getTodayISO();
  const currentYearMonth = getYearMonth(todayISO);

  const [mode, setMode] = useState<ReportMode>('ngay');
  const [localDate, setLocalDate] = useState<string>(selectedDate || todayISO);
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    getYearMonth(selectedDate || todayISO)
  );
  const [exportingExcel, setExportingExcel] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const dayTransactions = snapshot.transactions.filter(
    (t) => t.book_id === snapshot.book.id && t.ngay === localDate && !t.da_xoa
  );

  const handleDeleteTx = async (tx: Transaction) => {
    if (!session) return;
    await dbRepo.softDeleteTransaction(session, snapshot.book.id, tx.id);
    const undo: UndoState = {
      message: `Đã xóa: ${tx.ghi_chu || 'giao dịch'} (${formatVND(tx.so_tien)})`,
      undoFn: async () => {
        await dbRepo.restoreTransaction(session, snapshot.book.id, tx.id);
      },
    };
    setUndoState(undo);
    await onDataChanged?.(undo);
  };

  const showNotice = (msg: string) => {
    setReportNotice(msg);
    setTimeout(() => {
      setReportNotice((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  // Đồng bộ khi ngày được đổi từ tab khác
  useEffect(() => {
    if (selectedDate) {
      setLocalDate(selectedDate);
      setSelectedMonth(getYearMonth(selectedDate));
    }
  }, [selectedDate]);

  useEffect(() => {
    return () => {
      stopVietnameseSpeech();
    };
  }, []);

  const handleChangeDate = (nextIso: string) => {
    if (!nextIso) return;
    setLocalDate(nextIso);
    setSelectedMonth(getYearMonth(nextIso));
    onSelectDate?.(nextIso);
  };

  const daily = computeDailyReport(snapshot, localDate);
  const sevenDays = computeSevenDaySeries(snapshot, localDate, 7);
  const monthly = computeMonthlyReport(snapshot, selectedMonth);

  const handleSpeakReport = () => {
    if (mode === 'ngay') {
      speakVietnameseText(buildSpokenDailyReport(snapshot, daily));
    } else {
      speakVietnameseText(buildSpokenMonthlyReport(snapshot, monthly));
    }
  };

  const handleExportMonthlyExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      const filename = await downloadSingleBookMonthlyExcel(snapshot, selectedMonth);
      showNotice(`Đã xuất báo cáo Excel: ${filename}`);
    } catch (err) {
      showNotice(
        err instanceof Error ? `Lỗi xuất Excel: ${err.message}` : 'Không xuất được Excel.'
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const handleShareZalo = async () => {
    const text =
      mode === 'ngay'
        ? buildZaloDailySummaryText(snapshot, localDate)
        : [
            `BÁO CÁO ${snapshot.book.ten.toUpperCase()} — ${formatVietnameseMonth(selectedMonth).toUpperCase()}`,
            `Lãi ròng tháng: ${formatVND(monthly.lai_rong_toan_co_so, true)}`,
            `• Bếp ăn (${monthly.bep_an.tong_suat} suất): ${formatVND(monthly.bep_an.lai_bep_an, true)}`,
            `• Căn tin: ${formatVND(monthly.can_tin.lai_can_tin, true)}`,
            `• Chi phí cuối tháng: -${formatVND(monthly.tong_chi_cuoi_thang_ap_dung)}`,
          ].join('\n');

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: `Báo cáo ${snapshot.book.ten}`,
          text,
        });
        return;
      }
    } catch {
      // Fallback sang clipboard bên dưới
    }
    try {
      await navigator.clipboard.writeText(text);
      showNotice('Đã chép tóm tắt — mở Zalo dán gửi cho con/gia đình ngay!');
    } catch {
      showNotice('Không chép tự động được, vui lòng thử lại.');
    }
  };

  const maxAbsSevenDayProfit = Math.max(
    1,
    ...sevenDays.diem_ngay.map((p) => Math.abs(p.bep_lai_ngay))
  );

  const giaSangTr = getEffectiveMealPrice(
    snapshot.mealPrices,
    snapshot.book.id,
    'sang',
    'truong',
    localDate
  );
  const giaTruaTr = getEffectiveMealPrice(
    snapshot.mealPrices,
    snapshot.book.id,
    'trua',
    'truong',
    localDate
  );
  const giaToiTr = getEffectiveMealPrice(
    snapshot.mealPrices,
    snapshot.book.id,
    'toi',
    'truong',
    localDate
  );
  const giaTruaVl = getEffectiveMealPrice(
    snapshot.mealPrices,
    snapshot.book.id,
    'trua',
    'vang_lai',
    localDate
  );

  const mealPeriods: MealPeriod[] = ['sang', 'trua', 'toi'];
  const activeMealLines: Array<{ label: string; detail: string; amount: number }> = [];
  for (const bua of mealPeriods) {
    const info = daily.bep_an.chi_tiet_bua[bua];
    if (info.suat_truong > 0) {
      activeMealLines.push({
        label: `${MEAL_LABELS[bua]} (trường)`,
        detail: `${info.suat_truong} suất × ${formatVND(info.don_gia_truong)}`,
        amount: info.thanh_tien_truong,
      });
    }
    if (info.suat_vang_lai > 0) {
      activeMealLines.push({
        label: `${MEAL_LABELS[bua]} (vãng lai)`,
        detail: `${info.suat_vang_lai} suất × ${formatVND(info.don_gia_vang_lai)}`,
        amount: info.thanh_tien_vang_lai,
      });
    }
  }

  return (
    <div className="space-y-3">
      <UndoBanner
        undoState={undoState}
        onDismiss={() => setUndoState(null)}
        onUndone={async () => {
          setUndoState(null);
          await onDataChanged?.();
        }}
      />

      {/* Thanh chuyển đổi Báo cáo Ngày / Báo cáo Tháng + nút Nghe đọc báo cáo */}
      <div className="rounded-2xl bg-white border border-stone-200 p-2 shadow-xs space-y-2">
        <div className="grid grid-cols-2 gap-1.5 bg-stone-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => {
              stopVietnameseSpeech();
              setMode('ngay');
            }}
            className={`min-h-[38px] rounded-lg font-bold text-xs transition flex items-center justify-center gap-1 ${
              mode === 'ngay'
                ? 'bg-teal-800 text-white shadow-xs'
                : 'text-stone-700 hover:bg-stone-200'
            }`}
          >
            Theo Ngày
          </button>
          <button
            type="button"
            onClick={() => {
              stopVietnameseSpeech();
              setMode('thang');
            }}
            className={`min-h-[38px] rounded-lg font-bold text-xs transition flex items-center justify-center gap-1 ${
              mode === 'thang'
                ? 'bg-teal-800 text-white shadow-xs'
                : 'text-stone-700 hover:bg-stone-200'
            }`}
          >
            Theo Tháng
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={handleSpeakReport}
            className="py-1.5 px-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-950 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.99]"
          >
            <Volume2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
            <span>Nghe đọc báo cáo</span>
          </button>

          <button
            type="button"
            onClick={handleShareZalo}
            className="py-1.5 px-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-950 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.99]"
          >
            <Share2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>Gửi tóm tắt Zalo</span>
          </button>
        </div>

        {mode === 'thang' && (
          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportMonthlyExcel}
            className="w-full py-2.5 px-4 rounded-2xl bg-teal-800 hover:bg-teal-900 disabled:opacity-60 text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-xs"
          >
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span>
              {exportingExcel
                ? 'Đang tạo file Excel...'
                : `Xuất Excel báo cáo ${formatVietnameseMonth(selectedMonth)}`}
            </span>
          </button>
        )}

        {reportNotice && (
          <div className="p-2.5 rounded-2xl bg-emerald-900 text-white text-sm font-bold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>{reportNotice}</span>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* CHẾ ĐỘ 1: BÁO CÁO NGÀY + BIỂU ĐỒ 7 NGÀY                           */}
      {/* ================================================================= */}
      {mode === 'ngay' && (
        <div className="space-y-3">
          {/* Bộ chọn ngày gọn gàng */}
          <div className="rounded-2xl bg-white border border-stone-200 p-2.5 shadow-xs space-y-2">
            <div className="flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => handleChangeDate(shiftDateISO(localDate, -1))}
                aria-label="Xem ngày hôm trước"
                className="min-h-[38px] px-2.5 rounded-lg bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-xs text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
                Hôm trước
              </button>

              <div className="text-center min-w-0 flex-1">
                <div className="text-xs font-bold text-stone-900 leading-snug">
                  {formatVietnameseDate(localDate)}
                </div>
                {localDate === todayISO ? (
                  <span className="inline-block mt-0.5 px-2 py-0.2 rounded-full bg-teal-100 text-teal-900 text-[11px] font-bold">
                    Hôm nay
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleChangeDate(todayISO)}
                    className="mt-0.5 px-2 py-0.2 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-bold border border-amber-300"
                  >
                    Về hôm nay
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleChangeDate(shiftDateISO(localDate, 1))}
                aria-label="Xem ngày hôm sau"
                className="min-h-[38px] px-2.5 rounded-lg bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-xs text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                Hôm sau
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1.5 border-t border-stone-100 text-xs">
              <Calendar className="w-4 h-4 text-stone-500 shrink-0" />
              <label htmlFor="profit-date-picker" className="font-semibold text-stone-600">
                Chọn ngày khác:
              </label>
              <input
                id="profit-date-picker"
                type="date"
                value={localDate}
                onChange={(e) => handleChangeDate(e.target.value)}
                className="ml-auto px-2 py-1 rounded-lg border border-stone-300 font-bold text-xs text-stone-900 bg-stone-50"
              />
            </div>
          </div>

          {/* THẺ 1: BẾP ĂN — LÃI ƯỚC TÍNH NGÀY & GIÁ VỐN / SUẤT */}
          <div className="rounded-2xl bg-white border border-teal-600 p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-bold text-teal-950 uppercase tracking-wide">
                Bếp ăn trong ngày
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full bg-teal-100 border border-teal-300 text-xs font-bold text-teal-900">
                  {daily.bep_an.tong_suat} suất
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onOpenManualForm ? onOpenManualForm('suat_an') : onJumpToForm?.('suat_an')
                  }
                  className="px-2 py-0.5 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-300 text-[11px] font-bold text-teal-800 inline-flex items-center gap-0.5"
                >
                  <Pencil className="w-3 h-3" />
                  Sửa suất
                </button>
              </div>
            </div>

            <div
              className={`p-2.5 rounded-xl border ${
                daily.bep_an.lai_uoc_tinh_ngay >= 0
                  ? 'bg-teal-50/70 border-teal-300'
                  : 'bg-rose-50/70 border-rose-300'
              }`}
            >
              <div className="text-xs font-bold text-stone-700">
                Lãi ước tính trong ngày
              </div>
              <div
                className={`text-lg font-black mt-0.5 ${
                  daily.bep_an.lai_uoc_tinh_ngay >= 0
                    ? 'text-teal-900'
                    : 'text-rose-800'
                }`}
              >
                {formatVND(daily.bep_an.lai_uoc_tinh_ngay, true)}
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">
                * Chưa trừ điện, nước, gas, gia vị cuối tháng (xem ở mục Theo Tháng)
              </div>
            </div>

            {/* Chỉ số trên 1 suất ăn trong ngày */}
            {daily.bep_an.tong_suat > 0 && (
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="p-2 rounded-xl bg-stone-50 border border-stone-200">
                  <div className="text-[11px] font-medium text-stone-600">Thu / suất</div>
                  <div className="text-xs font-black text-stone-900 mt-0.5">
                    {formatVND(daily.bep_an.doanh_thu_binh_quan_suat)}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-orange-50/70 border border-orange-200">
                  <div className="text-[11px] font-medium text-orange-900">Vốn ngày / suất</div>
                  <div className="text-xs font-black text-orange-950 mt-0.5">
                    {formatVND(daily.bep_an.gia_von_ngay_moi_suat)}
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="text-[11px] font-medium text-emerald-900">Lãi / suất</div>
                  <div className="text-xs font-black text-emerald-950 mt-0.5">
                    {formatVND(daily.bep_an.lai_ngay_moi_suat, true)}
                  </div>
                </div>
              </div>
            )}

            {/* Bóc tách phép tính Thu - Chi của Bếp ăn */}
            <div className="space-y-2 pt-0.5">
              <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                  <span>1. Tổng thu Bếp ăn</span>
                  <span className="text-xs font-black">+{formatVND(daily.bep_an.tong_doanh_thu)}</span>
                </div>

                {activeMealLines.length > 0 ? (
                  <div className="space-y-1 text-xs text-stone-800 pt-1 border-t border-emerald-200/80">
                    {activeMealLines.map((line) => (
                      <div key={line.label} className="flex justify-between gap-2">
                        <span>
                          • {line.label}: <strong>{line.detail}</strong>
                        </span>
                        <span className="font-bold shrink-0">{formatVND(line.amount)}</span>
                      </div>
                    ))}
                    {daily.bep_an.thu_khac > 0 && (
                      <div className="flex justify-between gap-2">
                        <span>• Thu khác Bếp ăn</span>
                        <span className="font-bold">{formatVND(daily.bep_an.thu_khac)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="pt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-stone-600">
                      Chưa ghi suất ăn ngày này
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenManualForm ? onOpenManualForm('suat_an') : onJumpToForm?.('suat_an')
                      }
                      className="px-2.5 py-1 rounded-lg bg-teal-700 text-white font-bold text-xs shrink-0"
                    >
                      Báo suất ăn
                    </button>
                  </div>
                )}
              </div>

              <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1">
                <div className="flex items-center justify-between text-xs font-bold text-rose-950">
                  <span>2. Chi chợ & công thợ</span>
                  <span className="text-xs font-black">-{formatVND(daily.bep_an.tong_chi_ngay)}</span>
                </div>

                <div className="space-y-1 text-xs text-stone-800 pt-1 border-t border-rose-200/80">
                  <div className="flex justify-between gap-2">
                    <span>• Đi chợ nguyên liệu ngày</span>
                    <span className="font-bold">
                      {formatVND(daily.bep_an.chi_nguyen_lieu_ngay)}
                    </span>
                  </div>
                  {daily.bep_an.chi_cho_mua_chiu > 0 && (
                    <div className="text-[11px] text-stone-600 pl-2">
                      (Trả ngay: {formatVND(daily.bep_an.chi_cho_tra_ngay)} · Mua chịu ghi sổ:{' '}
                      {formatVND(daily.bep_an.chi_cho_mua_chiu)})
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      • Công thợ phụ bếp ({daily.bep_an.tong_so_cong_ngay} công)
                    </span>
                    <div className="inline-flex items-center gap-1.5">
                      <span className="font-bold">
                        {formatVND(daily.bep_an.chi_cong_tho_ngay)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenManualForm ? onOpenManualForm('cham_cong') : onJumpToForm?.('cham_cong')
                        }
                        className="px-1.5 py-0.5 rounded-md bg-white hover:bg-stone-100 border border-stone-300 text-[10px] font-bold text-stone-700 inline-flex items-center gap-0.5"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                        Sửa
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* THẺ 2: CĂN TIN — THU & CHI TRONG NGÀY */}
          <div className="rounded-2xl bg-white border border-amber-400 p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold text-amber-950 uppercase tracking-wide">
                  Căn tin — Thu & Chi trong ngày
                </h2>
                <p className="text-[11px] text-stone-500">
                  Lãi Căn tin được chốt theo tháng
                </p>
              </div>
              {daily.can_tin.tong_thu_quay_cuoi_ngay > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenManualForm ? onOpenManualForm('thu_cuoi_ngay') : onJumpToForm?.('thu_cuoi_ngay')
                  }
                  className="px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-900 inline-flex items-center gap-0.5 shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                  Sửa thu
                </button>
              )}
            </div>

            {daily.can_tin.canh_bao_lech_vang_lai && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <div className="text-xs font-semibold leading-snug">
                  Tổng thu cuối ngày ({formatVND(daily.can_tin.tong_thu_quay_cuoi_ngay)}) đang nhỏ
                  hơn tiền suất vãng lai ({formatVND(daily.bep_an.doanh_thu_vang_lai)}).
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200">
                <div className="text-amber-950 text-[11px] font-semibold">
                  Doanh thu Căn tin
                </div>
                <div className="font-black text-sm text-amber-950 mt-0.5">
                  {formatVND(daily.can_tin.doanh_thu_can_tin)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200">
                <div className="text-stone-700 text-[11px] font-semibold">
                  Chi nhập hàng
                </div>
                <div className="font-black text-sm text-rose-800 mt-0.5">
                  {formatVND(daily.can_tin.chi_nhap_hang_ngay)}
                </div>
              </div>
            </div>

            {daily.can_tin.tong_thu_quay_cuoi_ngay > 0 ? (
              <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1 text-xs text-stone-700">
                <div className="flex justify-between">
                  <span>• Tổng thu quầy cuối ngày:</span>
                  <strong className="text-stone-900">
                    {formatVND(daily.can_tin.tong_thu_quay_cuoi_ngay)}
                  </strong>
                </div>
                <div className="text-[11px] text-stone-500 pl-2">
                  (Tiền mặt: {formatVND(daily.can_tin.thu_tien_mat_cuoi_ngay)} · CK Chị Nhàn:{' '}
                  {formatVND(daily.can_tin.thu_chuyen_khoan_cuoi_ngay)})
                </div>
                {daily.can_tin.tru_tien_vang_lai > 0 && (
                  <div className="flex justify-between text-teal-900">
                    <span>• Tự tách vãng lai sang Bếp ăn:</span>
                    <strong>-{formatVND(daily.can_tin.tru_tien_vang_lai)}</strong>
                  </div>
                )}
                {daily.can_tin.thu_khac_can_tin > 0 && (
                  <div className="flex justify-between">
                    <span>• Thu khác Căn tin:</span>
                    <strong>+{formatVND(daily.can_tin.thu_khac_can_tin)}</strong>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onOpenManualForm ? onOpenManualForm('thu_cuoi_ngay') : onJumpToForm?.('thu_cuoi_ngay')
                }
                className="w-full py-2 px-3 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 font-bold text-xs"
              >
                Nhập tổng thu cuối ngày (TM + CK Chị Nhàn)
              </button>
            )}
          </div>

          {/* THẺ MỚI: DANH SÁCH THU CHI TRONG NGÀY (CÓ NÚT SỬA TAY SỐ LIỆU CHO ADMIN) */}
          <div className="rounded-2xl bg-white border border-stone-200 p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-stone-700 shrink-0" />
                <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                  Các khoản thu chi ngày ({dayTransactions.length} mục)
                </h2>
              </div>
              <span className="text-[11px] text-stone-500 font-semibold">
                {formatVietnameseDate(localDate)}
              </span>
            </div>

            {dayTransactions.length === 0 ? (
              <div className="py-3 text-center text-xs text-stone-500 italic">
                Chưa có giao dịch chi tiêu hoặc thu tiền nào được ghi trong ngày này.
              </div>
            ) : (
              <div className="space-y-1.5">
                {dayTransactions.map((tx) => {
                  const cat = snapshot.categories.find((c) => c.id === tx.category_id);
                  const isIncome =
                    tx.loai === 'thu' ||
                    tx.loai === 'thu_cuoi_ngay' ||
                    tx.loai === 'truong_chuyen' ||
                    tx.loai === 'thu_no';
                  const isDebt = tx.loai === 'chi_no' || tx.loai === 'ban_chiu';
                  const wallet = snapshot.wallets.find((w) => w.id === tx.wallet_id);
                  const sup = snapshot.suppliers.find((s) => s.id === tx.supplier_id);
                  const title = tx.ghi_chu || cat?.ten_danh_muc || 'Giao dịch';

                  return (
                    <div
                      key={tx.id}
                      className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-stone-900 leading-snug">
                            {title}
                          </div>
                          <div className="text-[11px] font-medium text-stone-500 mt-0.5">
                            {cat?.ten_danh_muc ?? ''}
                            {sup ? ` · ${sup.ten_ncc}` : ''}
                            {wallet ? ` · ${wallet.ten_vi}` : ''}
                            {isDebt ? ' · (Mua chịu ghi nợ)' : ''}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`text-xs font-black ${
                              isIncome
                                ? 'text-emerald-700'
                                : isDebt
                                ? 'text-amber-800'
                                : 'text-rose-700'
                            }`}
                          >
                            {isIncome ? `+${formatVND(tx.so_tien)}` : `-${formatVND(tx.so_tien)}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-stone-200/60">
                        {onOpenManualForm && (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenManualForm(mapTransactionToFormKind(tx, snapshot), tx)
                            }
                            className="px-2 py-0.5 rounded-lg bg-white hover:bg-stone-100 border border-stone-300 text-[11px] font-bold text-stone-700 inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3 text-stone-600" />
                            Sửa
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteTx(tx)}
                          className="px-2 py-0.5 rounded-lg bg-white hover:bg-rose-50 border border-stone-300 text-[11px] font-bold text-stone-600 hover:text-rose-700 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3 text-rose-600" />
                          Xóa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* THẺ 3: BIỂU ĐỒ 7 NGÀY GẦN NHẤT */}
          <div className="rounded-2xl bg-white border border-stone-200 p-3 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-teal-800 shrink-0" />
                <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                  Biểu đồ Lãi Bếp 7 ngày
                </h2>
              </div>
              <span className="text-[11px] font-semibold text-stone-500">
                Chạm cột để xem
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 pt-1.5 items-end">
              {sevenDays.diem_ngay.map((pt) => {
                const isSelected = pt.ngay === localDate;
                const { thuNgan, ngayThang } = formatShortWeekdayDate(pt.ngay);
                const ratio = Math.min(
                  1,
                  Math.abs(pt.bep_lai_ngay) / maxAbsSevenDayProfit
                );
                const barHeightPx = pt.co_ghi_chep
                  ? Math.max(12, Math.round(ratio * 68))
                  : 6;

                const barColor = !pt.co_ghi_chep
                  ? 'bg-stone-300'
                  : pt.bep_lai_ngay >= 0
                  ? isSelected
                    ? 'bg-teal-700'
                    : 'bg-teal-500'
                  : isSelected
                  ? 'bg-rose-700'
                  : 'bg-rose-500';

                const shortVal = !pt.co_ghi_chep
                  ? '—'
                  : formatCompactVND(pt.bep_lai_ngay)
                      .replace(' triệu', 'tr')
                      .replace(' nghìn', 'k')
                      .replace(' đ', 'đ');

                return (
                  <button
                    key={pt.ngay}
                    type="button"
                    onClick={() => handleChangeDate(pt.ngay)}
                    aria-label={`Xem ngày ${pt.ngay}`}
                    className={`p-1 rounded-xl flex flex-col items-center justify-end transition ${
                      isSelected
                        ? 'bg-teal-50 ring-2 ring-teal-700'
                        : 'hover:bg-stone-100'
                    }`}
                  >
                    <div
                      className={`text-[10px] font-bold leading-tight mb-0.5 truncate max-w-full ${
                        !pt.co_ghi_chep
                          ? 'text-stone-400'
                          : pt.bep_lai_ngay >= 0
                          ? 'text-teal-900'
                          : 'text-rose-800'
                      }`}
                    >
                      {shortVal}
                    </div>

                    <div className="h-[72px] w-full flex items-end justify-center">
                      <div
                        style={{ height: `${barHeightPx}px` }}
                        className={`w-full max-w-[20px] rounded-t-md transition-all ${barColor}`}
                      />
                    </div>

                    <div
                      className={`mt-1 text-xs font-bold leading-none ${
                        isSelected ? 'text-teal-950' : 'text-stone-800'
                      }`}
                    >
                      {thuNgan}
                    </div>
                    <div className="text-[10px] font-medium text-stone-500 mt-0.5">
                      {ngayThang}
                    </div>
                    <div className="text-[10px] font-bold text-stone-400">
                      {pt.bep_tong_suat > 0 ? `${pt.bep_tong_suat}s` : '·'}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-2 rounded-xl bg-stone-100 border border-stone-200 flex flex-wrap items-center justify-between gap-1 text-xs">
              <span className="text-stone-700 font-medium">
                7 ngày ({sevenDays.so_ngay_co_ghi_chep}/7 ngày ·{' '}
                <strong>{sevenDays.tong_suat_7_ngay} suất</strong>)
              </span>
              <span
                className={`font-black ${
                  sevenDays.tong_lai_bep_7_ngay >= 0
                    ? 'text-teal-900'
                    : 'text-rose-800'
                }`}
              >
                Tổng lãi: {formatVND(sevenDays.tong_lai_bep_7_ngay, true)}
              </span>
            </div>
          </div>

          {/* THẺ 4: ĐƠN GIÁ ÁP DỤNG */}
          <div className="rounded-2xl bg-white border border-stone-200 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-xs text-stone-800 uppercase tracking-wide">
              <BookOpen className="w-3.5 h-3.5 text-teal-700" />
              Đơn giá áp dụng ({localDate.split('-').reverse().join('/')})
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-stone-700">
              <div>
                • Sáng (trường): <strong>{formatVND(giaSangTr)}</strong>
              </div>
              <div>
                • Trưa (trường): <strong>{formatVND(giaTruaTr)}</strong>
              </div>
              <div>
                • Tối (trường): <strong>{formatVND(giaToiTr)}</strong>
              </div>
              <div>
                • Trưa (vãng lai): <strong>{formatVND(giaTruaVl)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* CHẾ ĐỘ 2: BÁO CÁO THÁNG (LÃI RÒNG, CHI PHÍ THÁNG, CƠ CẤU DANH MỤC) */}
      {/* ================================================================= */}
      {mode === 'thang' && (
        <div className="space-y-3">
          {/* Bộ chọn kỳ tháng */}
          <div className="rounded-2xl bg-white border border-stone-200 p-2.5 shadow-xs">
            <div className="flex items-center justify-between gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedMonth(getPreviousYearMonth(selectedMonth))}
                aria-label="Tháng trước"
                className="min-h-[38px] px-2.5 rounded-lg bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-xs text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
                Tháng trước
              </button>

              <div className="text-center min-w-0 flex-1">
                <div className="text-xs font-bold text-stone-900">
                  {formatVietnameseMonth(selectedMonth)}
                </div>
                <div className="text-[11px] font-medium text-stone-500 mt-0.5">
                  {monthly.so_ngay_hoat_dong} ngày có ghi sổ
                </div>
                {selectedMonth !== currentYearMonth && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(currentYearMonth)}
                    className="mt-0.5 px-2 py-0.2 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-bold border border-amber-300"
                  >
                    Về tháng này
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedMonth(getNextYearMonth(selectedMonth))}
                aria-label="Tháng sau"
                className="min-h-[38px] px-2.5 rounded-lg bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-xs text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                Tháng sau
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* THẺ HERO: LÃI RÒNG TOÀN CƠ SỞ */}
          <div
            className={`rounded-2xl p-3 border shadow-xs space-y-2 ${
              monthly.lai_rong_toan_co_so >= 0
                ? 'bg-teal-900 text-white border-teal-950'
                : 'bg-rose-900 text-white border-rose-950'
            }`}
          >
            <div className="text-xs font-bold opacity-90">
              Lãi ròng toàn cơ sở ({formatVietnameseMonth(selectedMonth)})
            </div>
            <div className="text-lg font-black">
              {formatVND(monthly.lai_rong_toan_co_so, true)}
            </div>

            <div className="rounded-xl bg-black/20 p-2.5 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>+ Lãi Bếp ăn cả tháng:</span>
                <strong>{formatVND(monthly.bep_an.lai_bep_an, true)}</strong>
              </div>
              <div className="flex justify-between">
                <span>+ Lãi Căn tin cả tháng:</span>
                <strong>{formatVND(monthly.can_tin.lai_can_tin, true)}</strong>
              </div>
              <div className="flex justify-between">
                <span>− Chi chung cuối tháng:</span>
                <strong>-{formatVND(monthly.chi_cuoi_thang_chung)}</strong>
              </div>
            </div>
          </div>

          {/* THÔNG BÁO TRẠNG THÁI CHI PHÍ CUỐI THÁNG (THỰC TẾ HOẶC ƯỚC TÍNH TỪ THÁNG TRƯỚC) */}
          {monthly.la_uoc_tinh_tu_thang_truoc ? (
            <div className="rounded-3xl bg-amber-50 border-2 border-amber-500 p-4 space-y-2.5">
              <div className="text-lg font-extrabold text-amber-950">
                Đang tạm ước tính điện, nước, gas, gia vị:{' '}
                {formatVND(monthly.tong_chi_cuoi_thang_ap_dung)}
              </div>
              <p className="text-base text-amber-950 leading-relaxed">
                Tháng này chưa nhập hóa đơn cuối tháng nên sổ đang tạm lấy mức của{' '}
                <strong>
                  {formatVietnameseMonth(monthly.ky_thang_nguon_chi_thang || '')}
                </strong>
                . Khi có hóa đơn thật, ông/bà bấm nhập bên dưới sổ sẽ tự đổi sang số thực tế!
              </p>
              {onJumpToForm && (
                <button
                  type="button"
                  onClick={() => onJumpToForm('chi_phi_thang')}
                  className="w-full py-3 px-4 rounded-2xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-base"
                >
                  Nhập hóa đơn điện, nước, gas, gia vị thực tế
                </button>
              )}
            </div>
          ) : monthly.tong_chi_cuoi_thang_ap_dung > 0 ? (
            <div className="rounded-3xl bg-emerald-50 border-2 border-emerald-500 p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-extrabold text-emerald-950">
                  Chi phí cuối tháng thực tế:{' '}
                  {formatVND(monthly.tong_chi_cuoi_thang_ap_dung)}
                </div>
                <div className="text-base text-emerald-900">
                  Đã trừ trực tiếp vào lợi nhuận {formatVietnameseMonth(selectedMonth)}
                </div>
              </div>
              {onJumpToForm && (
                <button
                  type="button"
                  onClick={() => onJumpToForm('chi_phi_thang')}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 text-white font-bold text-base"
                >
                  + Thêm hóa đơn
                </button>
              )}
            </div>
          ) : (
            monthly.so_ngay_hoat_dong > 0 && (
              <div className="rounded-3xl bg-purple-50 border-2 border-purple-400 p-4 space-y-2">
                <div className="text-lg font-extrabold text-purple-950">
                  Chưa có hóa đơn điện, nước, gas, gia vị cuối tháng
                </div>
                <div className="text-base text-purple-900">
                  Cuối tháng có hóa đơn, ông/bà nhập vào đây để tính chuẩn lãi ròng cả tháng.
                </div>
                {onJumpToForm && (
                  <button
                    type="button"
                    onClick={() => onJumpToForm('chi_phi_thang')}
                    className="w-full py-2.5 px-4 rounded-2xl bg-purple-700 text-white font-bold text-base"
                  >
                    Nhập điện, nước, gas, gia vị
                  </button>
                )}
              </div>
            )
          )}

          {/* CHI TIẾT MẢNG 1: BẾP ĂN CẢ THÁNG + GIÁ VỐN / SUẤT */}
          <div className="rounded-3xl bg-white border-2 border-teal-700 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-extrabold text-teal-950">
                Bếp ăn cả tháng
              </h2>
              <span className="px-3 py-1 rounded-full bg-teal-100 border border-teal-300 text-base font-extrabold text-teal-900">
                {monthly.bep_an.tong_suat} suất
              </span>
            </div>

            <div className="space-y-1.5 text-base text-stone-800 bg-stone-50 p-3.5 rounded-2xl border border-stone-200">
              <div className="flex justify-between">
                <span>
                  • Suất trường ({monthly.bep_an.tong_suat_truong} suất):
                </span>
                <strong className="text-emerald-800">
                  +{formatVND(monthly.bep_an.doanh_thu_truong)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>
                  • Suất vãng lai ({monthly.bep_an.tong_suat_vang_lai} suất):
                </span>
                <strong className="text-emerald-800">
                  +{formatVND(monthly.bep_an.doanh_thu_vang_lai)}
                </strong>
              </div>
              {monthly.bep_an.thu_khac > 0 && (
                <div className="flex justify-between">
                  <span>• Thu khác Bếp ăn:</span>
                  <strong className="text-emerald-800">
                    +{formatVND(monthly.bep_an.thu_khac)}
                  </strong>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-stone-200">
                <span>• Chi đi chợ nguyên liệu ngày:</span>
                <strong className="text-rose-800">
                  -{formatVND(monthly.bep_an.chi_nguyen_lieu_ngay)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>
                  • Công thợ phụ bếp ({monthly.bep_an.tong_so_cong} công):
                </span>
                <strong className="text-rose-800">
                  -{formatVND(monthly.bep_an.chi_cong_tho)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>
                  • Gia vị, gas cuối tháng{' '}
                  {monthly.la_uoc_tinh_tu_thang_truoc &&
                  monthly.bep_an.chi_cuoi_thang_rieng > 0
                    ? '(tạm tính)'
                    : ''}
                  :
                </span>
                <strong className="text-rose-800">
                  -{formatVND(monthly.bep_an.chi_cuoi_thang_rieng)}
                </strong>
              </div>
              <div className="flex justify-between pt-2 border-t-2 border-teal-200 text-lg font-extrabold text-teal-950">
                <span>Lãi Bếp ăn tháng:</span>
                <span>{formatVND(monthly.bep_an.lai_bep_an, true)}</span>
              </div>
            </div>

            {/* BẢNG GIÁ VỐN TRÊN 1 SUẤT ĂN */}
            {monthly.bep_an.tong_suat > 0 && (
              <div className="rounded-2xl bg-teal-50 border border-teal-300 p-3.5 space-y-1.5">
                <div className="text-base font-extrabold text-teal-950">
                  Tính bình quân trên 1 suất ăn ({monthly.bep_an.tong_suat} suất):
                </div>
                <div className="space-y-1 text-base text-stone-800">
                  <div className="flex justify-between">
                    <span>• Doanh thu bình quân / suất:</span>
                    <strong>{formatVND(monthly.bep_an.doanh_thu_binh_quan_suat)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>• Giá vốn chợ + công thợ / suất:</span>
                    <strong>
                      {formatVND(monthly.bep_an.gia_von_nguyen_lieu_cong_moi_suat)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>• Giá vốn Bếp đầy đủ (gồm gas, gia vị) / suất:</span>
                    <strong className="text-orange-900">
                      {formatVND(monthly.bep_an.gia_von_bep_day_du_moi_suat)}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>• Giá vốn gộp cả điện nước chung / suất:</span>
                    <strong>
                      {formatVND(monthly.bep_an.gia_von_phan_bo_chung_moi_suat)}
                    </strong>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-teal-200 text-teal-950 font-extrabold">
                    <span>• Lãi Bếp bình quân / suất:</span>
                    <span>{formatVND(monthly.bep_an.lai_bep_moi_suat, true)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CHI TIẾT MẢNG 2: CĂN TIN CẢ THÁNG */}
          <div className="rounded-3xl bg-white border-2 border-amber-500 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-extrabold text-amber-950">
                Căn tin cả tháng
              </h2>
              {monthly.can_tin.doanh_thu > 0 && (
                <span className="px-3 py-1 rounded-full bg-amber-100 border border-amber-300 text-sm font-extrabold text-amber-950">
                  Tỷ suất: {monthly.can_tin.ty_suat_lai_phan_tram}%
                </span>
              )}
            </div>

            <div className="space-y-1.5 text-base text-stone-800 bg-amber-50/50 p-3.5 rounded-2xl border border-amber-200">
              <div className="flex justify-between">
                <span>• Tổng doanh thu Căn tin:</span>
                <strong className="text-emerald-800">
                  +{formatVND(monthly.can_tin.doanh_thu)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>• Tổng chi nhập hàng Căn tin:</span>
                <strong className="text-rose-800">
                  -{formatVND(monthly.can_tin.chi_nhap_hang)}
                </strong>
              </div>
              {monthly.can_tin.chi_cuoi_thang_rieng > 0 && (
                <div className="flex justify-between">
                  <span>• Chi phí tháng riêng Căn tin:</span>
                  <strong className="text-rose-800">
                    -{formatVND(monthly.can_tin.chi_cuoi_thang_rieng)}
                  </strong>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t-2 border-amber-300 text-lg font-extrabold text-amber-950">
                <span>Lãi Căn tin tháng:</span>
                <span>{formatVND(monthly.can_tin.lai_can_tin, true)}</span>
              </div>
            </div>
          </div>

          {/* CHI TIẾT MẢNG 3: CHI PHÍ THEO DANH MỤC */}
          <div className="rounded-3xl bg-white border-2 border-stone-300 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PieChart className="w-6 h-6 text-teal-800 shrink-0" />
                <h2 className="text-xl font-extrabold text-stone-900">
                  Chi theo danh mục
                </h2>
              </div>
              <span className="text-base font-extrabold text-rose-800">
                {formatVND(monthly.tong_chi_toan_co_so)}
              </span>
            </div>

            {monthly.chi_theo_danh_muc.length === 0 ? (
              <div className="text-base text-stone-600 py-4 text-center">
                Chưa có khoản chi nào trong {formatVietnameseMonth(selectedMonth)}.
              </div>
            ) : (
              <div className="space-y-3">
                {monthly.chi_theo_danh_muc.map((item) => {
                  const seg = SEGMENT_BADGES[item.mang];
                  const barWidth = Math.max(4, Math.min(100, item.ty_le_phan_tram));
                  return (
                    <div
                      key={`${item.category_id}-${item.mang}-${item.la_uoc_tinh}`}
                      className="p-3 rounded-2xl bg-stone-50 border border-stone-200 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-base font-extrabold text-stone-900 leading-snug">
                            {item.icon} {item.ten_danh_muc}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold border ${seg.className}`}
                            >
                              {seg.label}
                            </span>
                            {item.la_uoc_tinh && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-950 border border-amber-400">
                                Tạm tính từ tháng trước
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-base font-extrabold text-stone-900">
                            {formatVND(item.so_tien)}
                          </div>
                          <div className="text-sm font-bold text-stone-600">
                            {item.ty_le_phan_tram.toFixed(1).replace('.', ',')}%
                          </div>
                        </div>
                      </div>

                      <div className="w-full h-2.5 bg-stone-200 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${barWidth}%` }}
                          className={`h-full rounded-full ${
                            item.mang === 'bep_an'
                              ? 'bg-teal-600'
                              : item.mang === 'can_tin'
                              ? 'bg-amber-500'
                              : 'bg-purple-600'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
