import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  Edit3,
  FileJson,
  FileSpreadsheet,
  MessageSquareText,
  Mic,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import {
  buildZaloAdminMonthlySummaryText,
  computeAdminCombinedSummary,
  extractChatLogAiPreview,
  extractChatLogTargetDate,
} from '../domain/adminSummary';
import {
  extractDialectCandidates,
  type DialectCandidate,
} from '../domain/dialectLearner';
import { downloadAdminCombinedMonthlyExcel } from '../domain/excelExport';
import {
  formatCompactVND,
  formatVietnameseMonth,
  formatVND,
  generateId,
  getNextYearMonth,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
} from '../domain/format';
import type { ActiveReminderCard } from '../domain/reminders';
import {
  checkWeeklyBackupStatus,
  downloadBackupJsonFile,
  exportFullSystemBackupPayload,
  restoreFullSystemBackup,
  validateBackupJsonPayload,
} from '../domain/weeklyBackup';
import type { BookId, BookSnapshot, Category, ChatLog, Supplier, Worker } from '../types/models';

export interface AdminDashboardViewProps {
  initialMonth?: string;
  onOpenFacilityBook: (bookId: BookId, targetDate?: string) => void;
  onActOnFacilityReminder: (
    bookId: BookId,
    target: ActiveReminderCard['action_target']
  ) => void;
}

const CHAT_STATUS_BADGE: Record<
  ChatLog['ket_qua'],
  { label: string; className: string }
> = {
  da_luu: {
    label: 'Đã lưu',
    className: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  da_sua: {
    label: 'Đã sửa',
    className: 'bg-sky-100 text-sky-900 border-sky-300',
  },
  cho_xac_nhan: {
    label: 'Chưa lưu',
    className: 'bg-amber-100 text-amber-950 border-amber-400',
  },
  huy: {
    label: 'Đã hủy',
    className: 'bg-rose-100 text-rose-900 border-rose-300',
  },
};

function formatLogTimestamp(isoTs: string): string {
  try {
    const d = new Date(isoTs);
    if (Number.isNaN(d.getTime())) return isoTs.slice(0, 16);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}`;
  } catch {
    return isoTs.slice(0, 16);
  }
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  initialMonth,
  onOpenFacilityBook,
  onActOnFacilityReminder,
}) => {
  const { session } = useAuth();
  const todayISO = getTodayISO();
  const currentYearMonth = getYearMonth(todayISO);

  const [selectedMonth, setSelectedMonth] = useState<string>(
    () => initialMonth || currentYearMonth
  );
  const [hhSnap, setHhSnap] = useState<BookSnapshot | null>(null);
  const [tdSnap, setTdSnap] = useState<BookSnapshot | null>(null);
  const [hhLogs, setHhLogs] = useState<ChatLog[]>([]);
  const [tdLogs, setTdLogs] = useState<ChatLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [exportingExcel, setExportingExcel] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [chatBookFilter, setChatBookFilter] = useState<'all' | BookId>('all');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [chatQuery, setChatQuery] = useState('');

  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [teachingCandidate, setTeachingCandidate] = useState<DialectCandidate | null>(null);
  const [teachingLog, setTeachingLog] = useState<ChatLog | null>(null);
  const [showCandidateReview, setShowCandidateReview] = useState(false);

  const backupStatus = useMemo(
    () => checkWeeklyBackupStatus(),
    [exportingBackup, restoringBackup]
  );

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const loadBothBooks = useCallback(async () => {
    if (!session || session.vai_tro !== 'admin') return;
    try {
      setError('');
      const [hh, td, logsHh, logsTd] = await Promise.all([
        dbRepo.getBookSnapshot(session, 'hiep_hoa'),
        dbRepo.getBookSnapshot(session, 'tien_du'),
        dbRepo.listChatLogs(session, 'hiep_hoa', 120),
        dbRepo.listChatLogs(session, 'tien_du', 120),
      ]);
      setHhSnap(hh);
      setTdSnap(td);
      setHhLogs(logsHh);
      setTdLogs(logsTd);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không tải được dữ liệu tổng hợp 2 cơ sở.'
      );
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadBothBooks();
  }, [loadBothBooks]);

  // Lắng nghe Realtime của cả 2 cơ sở cùng lúc
  useEffect(() => {
    if (!session || !dbRepo.subscribeToBookChanges) return;
    const unsubHh = dbRepo.subscribeToBookChanges('hiep_hoa', () => {
      void loadBothBooks();
    });
    const unsubTd = dbRepo.subscribeToBookChanges('tien_du', () => {
      void loadBothBooks();
    });
    return () => {
      unsubHh();
      unsubTd();
    };
  }, [session, loadBothBooks]);

  const combined = useMemo(() => {
    if (!hhSnap || !tdSnap) return null;
    return computeAdminCombinedSummary(hhSnap, tdSnap, selectedMonth, {
      hhChatLogs: hhLogs,
      tdChatLogs: tdLogs,
    });
  }, [hhSnap, tdSnap, selectedMonth, hhLogs, tdLogs]);

  const filteredChatLogs = useMemo(() => {
    if (!combined) return [];
    const q = chatQuery.trim().toLowerCase();
    return combined.combinedChatLogs.filter((log) => {
      if (chatBookFilter !== 'all' && log.book_id !== chatBookFilter) return false;
      if (
        onlyNeedsReview &&
        log.ket_qua !== 'cho_xac_nhan' &&
        log.ket_qua !== 'huy'
      ) {
        return false;
      }
      if (q && !log.cau_noi.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [combined, chatBookFilter, onlyNeedsReview, chatQuery]);

  const handleExportCombinedExcel = async () => {
    if (!hhSnap || !tdSnap || exportingExcel) return;
    try {
      setExportingExcel(true);
      const filename = await downloadAdminCombinedMonthlyExcel(
        hhSnap,
        tdSnap,
        selectedMonth
      );
      showToast(`Đã tải xuống ${filename}`);
    } catch (err) {
      showToast(
        err instanceof Error ? `Lỗi xuất Excel: ${err.message}` : 'Không xuất được Excel.'
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const handleShareZaloSummary = async () => {
    if (!combined) return;
    const text = buildZaloAdminMonthlySummaryText(combined);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: `Tổng hợp Sổ Bếp ${formatVietnameseMonth(selectedMonth)}`,
          text,
        });
        return;
      }
    } catch {
      // Fallback sang clipboard bên dưới nếu người dùng đóng hộp thoại share
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Đã chép tóm tắt 2 cơ sở — mở nhóm Zalo gia đình dán gửi ngay!');
    } catch {
      showToast('Không chép tự động được, vui lòng thử lại.');
    }
  };

  const handleMarkChatResolved = async (log: ChatLog) => {
    if (!session) return;
    await dbRepo.updateChatLogStatus(session, log.book_id, log.id, 'da_sua');
    await loadBothBooks();
    showToast('Đã đánh dấu câu nói là Đã xử lý / sửa hộ.');
  };

  const handleExportBackup = async () => {
    if (!session || exportingBackup) return;
    try {
      setExportingBackup(true);
      const payload = await exportFullSystemBackupPayload(dbRepo, session);
      const filename = downloadBackupJsonFile(payload);
      showToast(`Đã tải file sao lưu: ${filename}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Không thể xuất file sao lưu.');
    } finally {
      setExportingBackup(false);
    }
  };

  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    const confirmed = window.confirm(
      'Khôi phục bản sao lưu sẽ nạp lại toàn bộ dữ liệu 2 cơ sở từ file .json. Bạn có chắc chắn muốn khôi phục không?'
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }

    try {
      setRestoringBackup(true);
      const text = await file.text();
      const payload = validateBackupJsonPayload(text);
      const summary = await restoreFullSystemBackup(dbRepo, session, payload);
      await loadBothBooks();
      showToast(
        `Đã khôi phục thành công ${summary.totalTransactions} giao dịch & ${summary.totalCategories} danh mục!`
      );
    } catch (err) {
      showToast(
        err instanceof Error ? `Lỗi khôi phục: ${err.message}` : 'Không thể đọc file sao lưu.'
      );
    } finally {
      setRestoringBackup(false);
      e.target.value = '';
    }
  };

  const dialectCandidates = useMemo(() => {
    if (!combined || !hhSnap || !tdSnap) return [];
    return extractDialectCandidates(
      combined.combinedChatLogs,
      hhSnap.categories,
      [...hhSnap.suppliers, ...tdSnap.suppliers],
      [...hhSnap.workers, ...tdSnap.workers]
    );
  }, [combined, hhSnap, tdSnap]);

  if (loading) {
    return (
      <div className="py-12 text-center text-xl font-bold text-stone-600">
        Đang tổng hợp số liệu Hiệp Hòa &amp; Tiên Du...
      </div>
    );
  }

  if (error || !combined) {
    return (
      <div className="p-4 rounded-2xl bg-red-100 border-2 border-red-500 text-red-900 font-bold text-lg">
        {error || 'Chưa tải được dữ liệu tổng hợp.'}
      </div>
    );
  }

  const { hiepHoa: hh, tienDu: td, tongCong: tc } = combined;

  return (
    <div className="space-y-4">
      {toastMsg && (
        <div className="sticky top-18 z-20 p-3.5 rounded-2xl bg-emerald-900 text-white font-bold text-base shadow-md flex items-center gap-2">
          <Check className="w-5 h-5 text-emerald-300 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* BỘ CHỌN KỲ THÁNG + NÚT XUẤT EXCEL TỔNG HỢP & CHIA SẺ ZALO */}
      <div className="rounded-3xl bg-white border-2 border-indigo-200 p-3.5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedMonth(getPreviousYearMonth(selectedMonth))}
            aria-label="Tháng trước"
            className="min-h-[46px] px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-5 h-5" />
            Trước
          </button>

          <div className="text-center flex-1 min-w-0">
            <div className="text-xl font-extrabold text-indigo-950 flex items-center justify-center gap-1.5">
              <Crown className="w-5 h-5 text-amber-500 shrink-0" />
              <span>{formatVietnameseMonth(selectedMonth)}</span>
            </div>
            {selectedMonth !== currentYearMonth && (
              <button
                type="button"
                onClick={() => setSelectedMonth(currentYearMonth)}
                className="mt-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-950 text-xs font-extrabold border border-amber-400"
              >
                Về tháng này
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSelectedMonth(getNextYearMonth(selectedMonth))}
            aria-label="Tháng sau"
            className="min-h-[46px] px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1"
          >
            Sau
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExportCombinedExcel}
            className="min-h-[48px] px-3 py-2 rounded-2xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-xs"
          >
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <span>{exportingExcel ? 'Đang tạo Excel...' : 'Xuất Excel 2 cơ sở'}</span>
          </button>

          <button
            type="button"
            onClick={handleShareZaloSummary}
            className="min-h-[48px] px-3 py-2 rounded-2xl bg-sky-50 hover:bg-sky-100 border-2 border-sky-400 text-sky-950 font-extrabold text-sm flex items-center justify-center gap-1.5"
          >
            <Share2 className="w-5 h-5 text-sky-700 shrink-0" />
            <span>Gửi tóm tắt Zalo</span>
          </button>
        </div>
      </div>

      {/* THẺ SAO LƯU DỮ LIỆU TUẦN (.JSON) - RULE 10 */}
      <div className="rounded-3xl bg-white border-2 border-indigo-200 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileJson className="w-6 h-6 text-indigo-700 shrink-0" />
            <h2 className="text-xl font-extrabold text-stone-900">
              Sao lưu dữ liệu tuần (.json)
            </h2>
          </div>
          {backupStatus.due ? (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-950 text-xs font-extrabold border border-amber-400">
              Đã đến kỳ sao lưu
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-950 text-xs font-extrabold border border-emerald-300">
              Tuần này đã an toàn
            </span>
          )}
        </div>

        <p className="text-sm text-stone-600 leading-relaxed">
          Tải file sao lưu .json lưu trữ toàn bộ số liệu 2 cơ sở (Hiệp Hòa &amp; Tiên Du). Tuân thủ Rule 10: chỉ dùng file .json, tuyệt đối không tạo bất kỳ file backup .xlsx nào trên ổ đĩa.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exportingBackup}
            onClick={handleExportBackup}
            className="min-h-[46px] px-3 py-2 rounded-2xl bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-xs"
          >
            <Download className="w-5 h-5 shrink-0" />
            <span>{exportingBackup ? 'Đang tạo .json...' : 'Tải sao lưu (.json)'}</span>
          </button>

          <button
            type="button"
            disabled={restoringBackup}
            onClick={() => backupFileInputRef.current?.click()}
            className="min-h-[46px] px-3 py-2 rounded-2xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-900 font-extrabold text-sm flex items-center justify-center gap-1.5"
          >
            <Upload className="w-5 h-5 text-stone-700 shrink-0" />
            <span>{restoringBackup ? 'Đang đọc...' : 'Khôi phục file'}</span>
          </button>
          <input
            ref={backupFileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileRestore}
            className="hidden"
          />
        </div>
      </div>

      {/* THẺ HERO: LÃI RÒNG CẢ 2 CƠ SỞ + DÒNG TIỀN 6 VÍ + CÔNG NỢ */}
      <div
        className={`rounded-3xl p-5 border-2 shadow-sm space-y-3.5 ${
          tc.laiRong >= 0
            ? 'bg-indigo-950 text-white border-indigo-900'
            : 'bg-rose-950 text-white border-rose-900'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-bold opacity-90">
            Lãi ròng cả 2 cơ sở ({formatVietnameseMonth(selectedMonth)})
          </span>
          <button
            type="button"
            onClick={() => void loadBothBooks()}
            title="Làm mới số liệu"
            className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="text-3xl font-extrabold">{formatVND(tc.laiRong, true)}</div>

        <div className="grid grid-cols-2 gap-2.5 text-sm">
          <div className="rounded-2xl bg-white/10 p-3 space-y-1">
            <div className="opacity-85">Tổng Bếp ăn ({tc.tongSuatAn} suất)</div>
            <div className="text-lg font-extrabold text-teal-300">
              {formatVND(tc.laiBepAn, true)}
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 p-3 space-y-1">
            <div className="opacity-85">Tổng Căn tin</div>
            <div className="text-lg font-extrabold text-amber-300">
              {formatVND(tc.laiCanTin, true)}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-black/25 p-3.5 space-y-1.5 text-sm">
          <div className="flex items-center justify-between font-bold text-emerald-300 text-base">
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="w-4 h-4" />
              Tiền thực có (6 ví):
            </span>
            <span>{formatVND(tc.tongTienThucCo6Vi)}</span>
          </div>
          <div className="flex justify-between opacity-90">
            <span>• Đang nợ nhà cung cấp:</span>
            <strong className="text-rose-300">{formatVND(tc.tongNoNhaCungCap)}</strong>
          </div>
          <div className="flex justify-between opacity-90">
            <span>• Lương thợ chờ trả kỳ này:</span>
            <strong className="text-amber-200">{formatVND(tc.tongLuongThoChoTra)}</strong>
          </div>
          <div className="flex justify-between opacity-90">
            <span>• Tiền trường chờ về TK Mợ Diệp:</span>
            <strong className="text-sky-200">{formatVND(tc.tongTienTruongChoVe)}</strong>
          </div>
        </div>
      </div>

      {/* BẢNG ĐỐI CHIẾU SONG SONG: HIỆP HÒA (BỐ) vs TIÊN DU (MẸ) */}
      <div className="rounded-3xl bg-white border-2 border-stone-300 p-4 shadow-xs space-y-3">
        <h2 className="text-xl font-extrabold text-stone-900">
          So sánh Hiệp Hòa &amp; Tiên Du
        </h2>

        <div className="grid grid-cols-12 gap-1.5 text-xs font-extrabold uppercase tracking-wide pb-2 border-b-2 border-stone-200">
          <div className="col-span-4 text-stone-600">Chỉ tiêu</div>
          <div className="col-span-4 text-right text-teal-900">Hiệp Hòa</div>
          <div className="col-span-4 text-right text-amber-900">Tiên Du</div>
        </div>

        <div className="divide-y divide-stone-200 text-sm">
          <div className="grid grid-cols-12 gap-1.5 py-2.5 items-center bg-emerald-50/70 px-1.5 rounded-lg font-extrabold">
            <div className="col-span-4 text-stone-900">Lãi ròng tháng</div>
            <div
              className={`col-span-4 text-right ${
                hh.monthly.lai_rong_toan_co_so >= 0 ? 'text-teal-900' : 'text-rose-800'
              }`}
            >
              {formatCompactVND(hh.monthly.lai_rong_toan_co_so)}
            </div>
            <div
              className={`col-span-4 text-right ${
                td.monthly.lai_rong_toan_co_so >= 0 ? 'text-amber-950' : 'text-rose-800'
              }`}
            >
              {formatCompactVND(td.monthly.lai_rong_toan_co_so)}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Tổng suất ăn</div>
            <div className="col-span-4 text-right font-bold text-stone-900">
              {hh.monthly.bep_an.tong_suat.toLocaleString('vi-VN')} suất
            </div>
            <div className="col-span-4 text-right font-bold text-stone-900">
              {td.monthly.bep_an.tong_suat.toLocaleString('vi-VN')} suất
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Lãi Bếp ăn</div>
            <div className="col-span-4 text-right font-bold text-teal-900">
              {formatCompactVND(hh.monthly.bep_an.lai_bep_an)}
            </div>
            <div className="col-span-4 text-right font-bold text-amber-950">
              {formatCompactVND(td.monthly.bep_an.lai_bep_an)}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Giá vốn Bếp/suất</div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {hh.monthly.bep_an.tong_suat > 0
                ? formatVND(hh.monthly.bep_an.gia_von_bep_day_du_moi_suat)
                : '—'}
            </div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {td.monthly.bep_an.tong_suat > 0
                ? formatVND(td.monthly.bep_an.gia_von_bep_day_du_moi_suat)
                : '—'}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Lãi Căn tin</div>
            <div className="col-span-4 text-right font-bold text-teal-900">
              {formatCompactVND(hh.monthly.can_tin.lai_can_tin)}
              {hh.monthly.can_tin.doanh_thu > 0 && (
                <div className="text-[11px] text-stone-500">
                  ({hh.monthly.can_tin.ty_suat_lai_phan_tram}%)
                </div>
              )}
            </div>
            <div className="col-span-4 text-right font-bold text-amber-950">
              {formatCompactVND(td.monthly.can_tin.lai_can_tin)}
              {td.monthly.can_tin.doanh_thu > 0 && (
                <div className="text-[11px] text-stone-500">
                  ({td.monthly.can_tin.ty_suat_lai_phan_tram}%)
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Chi cuối tháng</div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {formatCompactVND(hh.monthly.tong_chi_cuoi_thang_ap_dung)}
              {hh.monthly.la_uoc_tinh_tu_thang_truoc && (
                <div className="text-[11px] text-amber-700">Tạm tính</div>
              )}
            </div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {formatCompactVND(td.monthly.tong_chi_cuoi_thang_ap_dung)}
              {td.monthly.la_uoc_tinh_tu_thang_truoc && (
                <div className="text-[11px] text-amber-700">Tạm tính</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center bg-stone-50 px-1.5 rounded-lg">
            <div className="col-span-4 font-extrabold text-stone-800">Tiền thực 3 ví</div>
            <div className="col-span-4 text-right font-extrabold text-emerald-800">
              {formatCompactVND(hh.tongTienThucCo)}
            </div>
            <div className="col-span-4 text-right font-extrabold text-emerald-800">
              {formatCompactVND(td.tongTienThucCo)}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Đang nợ NCC</div>
            <div className="col-span-4 text-right font-bold text-rose-800">
              {formatCompactVND(hh.debt.nha_cung_cap.tong_no_ncc)}
            </div>
            <div className="col-span-4 text-right font-bold text-rose-800">
              {formatCompactVND(td.debt.nha_cung_cap.tong_no_ncc)}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Lương chờ trả</div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {formatCompactVND(hh.debt.luong_tho_ky_nay.con_phai_tra)}
            </div>
            <div className="col-span-4 text-right font-bold text-stone-800">
              {formatCompactVND(td.debt.luong_tho_ky_nay.con_phai_tra)}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-1.5 py-2 items-center">
            <div className="col-span-4 font-semibold text-stone-700">Trường chờ về</div>
            <div className="col-span-4 text-right font-bold text-sky-900">
              {formatCompactVND(hh.debt.tien_truong_ky_nay.con_cho_chuyen)}
            </div>
            <div className="col-span-4 text-right font-bold text-sky-900">
              {formatCompactVND(td.debt.tien_truong_ky_nay.con_cho_chuyen)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenFacilityBook('hiep_hoa')}
            className="min-h-[46px] px-3 py-2 rounded-2xl bg-teal-800 hover:bg-teal-900 text-white font-bold text-sm"
          >
            Mở sổ Hiệp Hòa →
          </button>
          <button
            type="button"
            onClick={() => onOpenFacilityBook('tien_du')}
            className="min-h-[46px] px-3 py-2 rounded-2xl bg-amber-800 hover:bg-amber-900 text-white font-bold text-sm"
          >
            Mở sổ Tiên Du →
          </button>
        </div>
      </div>

      {/* CÁC NHẮC VIỆC ĐANG TREO Ở CẢ 2 CƠ SỞ */}
      <div className="rounded-3xl bg-white border-2 border-amber-400 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-stone-900 flex items-center gap-2">
            <BellRing className="w-6 h-6 text-amber-600 shrink-0" />
            <span>Nhắc việc đang treo</span>
          </h2>
          <span className="px-3 py-0.5 rounded-full bg-amber-100 border border-amber-400 text-amber-950 font-extrabold text-sm">
            {combined.combinedReminders.length} mục
          </span>
        </div>

        {combined.combinedReminders.length === 0 ? (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 font-semibold text-base flex items-center gap-2.5">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
            <span>
              Tuyệt vời! Cả Bố và Mẹ đều đã nhập đủ sổ, không có việc nào đang treo.
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {combined.combinedReminders.map((item) => {
              const isHh = item.bookId === 'hiep_hoa';
              return (
                <div
                  key={item.card.key}
                  className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-300 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${
                        isHh
                          ? 'bg-teal-100 text-teal-950 border-teal-300'
                          : 'bg-amber-200 text-amber-950 border-amber-400'
                      }`}
                    >
                      {item.ownerLabel}
                    </span>
                    {item.card.so_tien_du_kien !== undefined && (
                      <span className="text-sm font-extrabold text-rose-900">
                        {formatVND(item.card.so_tien_du_kien)}
                      </span>
                    )}
                  </div>

                  <div className="text-base font-extrabold text-stone-900">
                    {item.card.icon} {item.card.tieu_de}
                  </div>
                  <div className="text-sm text-stone-700 leading-snug">
                    {item.card.noi_dung}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onActOnFacilityReminder(item.bookId, item.card.action_target)
                    }
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm"
                  >
                    Vào sổ {isHh ? 'Bố' : 'Mẹ'} xử lý hộ ({item.card.action_label}) →
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* LỊCH SỬ HỘI THOẠI AI (CHAT_LOGS) ĐỂ RÀ SOÁT & SỬA HỘ ÔNG BÀ */}
      <div className="rounded-3xl bg-white border-2 border-stone-300 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-stone-900 flex items-center gap-2">
            <MessageSquareText className="w-6 h-6 text-indigo-700 shrink-0" />
            <span>Lịch sử chat để sửa hộ</span>
          </h2>
          <span className="text-sm font-bold text-stone-600">
            {filteredChatLogs.length} câu
          </span>
        </div>

        {/* Bộ lọc theo cơ sở & trạng thái */}
        <div className="grid grid-cols-3 gap-1.5 bg-stone-100 p-1 rounded-2xl text-sm font-bold">
          {(
            [
              { key: 'all', label: 'Tất cả' },
              { key: 'hiep_hoa', label: 'Hiệp Hòa' },
              { key: 'tien_du', label: 'Tiên Du' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setChatBookFilter(opt.key)}
              className={`py-2 px-2 rounded-xl transition ${
                chatBookFilter === opt.key
                  ? 'bg-indigo-900 text-white shadow-xs'
                  : 'text-stone-700 hover:bg-stone-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-stone-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="Tìm câu nói, tên món, mối hàng..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-300 bg-stone-50 text-sm font-semibold text-stone-900"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyNeedsReview((v) => !v)}
            className={`px-3 py-2 rounded-xl border text-xs font-extrabold transition ${
              onlyNeedsReview
                ? 'bg-amber-500 text-stone-950 border-amber-600'
                : 'bg-stone-100 text-stone-700 border-stone-300'
            }`}
          >
            {onlyNeedsReview ? 'Đang lọc: Chưa lưu/Hủy' : 'Lọc câu chưa lưu'}
          </button>
        </div>

        {dialectCandidates.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-purple-50 border-2 border-purple-300 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-sm text-purple-950 inline-flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Phát hiện {dialectCandidates.length} từ địa phương / mối mới từ chat
              </span>
              <button
                type="button"
                onClick={() => setShowCandidateReview((v) => !v)}
                className="text-xs font-bold text-purple-800 underline"
              >
                {showCandidateReview ? 'Thu gọn' : 'Xem danh sách'}
              </button>
            </div>
            {showCandidateReview && (
              <div className="space-y-1.5 pt-1 max-h-48 overflow-y-auto">
                {dialectCandidates.map((cand) => (
                  <div
                    key={cand.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-white border border-purple-200 text-xs"
                  >
                    <div>
                      <strong className="text-stone-900">{cand.candidateTerm}</strong>{' '}
                      <span className="text-stone-500">
                        (
                        {cand.suggestedType === 'category_keyword'
                          ? `Danh mục: ${cand.suggestedCategoryName || 'Chi'}`
                          : cand.suggestedType === 'new_supplier'
                          ? 'Mối hàng mới'
                          : 'Phụ bếp mới'}
                        )
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTeachingCandidate(cand)}
                      className="px-2.5 py-1 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700"
                    >
                      Dạy ngay
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {filteredChatLogs.length === 0 ? (
          <div className="py-6 text-center text-base text-stone-500 font-semibold">
            Chưa có câu nói AI nào khớp bộ lọc này.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-0.5">
            {filteredChatLogs.map((log) => {
              const isHh = log.book_id === 'hiep_hoa';
              const statusMeta = CHAT_STATUS_BADGE[log.ket_qua] ?? CHAT_STATUS_BADGE.cho_xac_nhan;
              const targetDate = extractChatLogTargetDate(log);
              const aiPreview = extractChatLogAiPreview(log);
              const shortDate = targetDate.split('-').reverse().slice(0, 2).join('/');

              return (
                <div
                  key={log.id}
                  className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-extrabold">
                      <span
                        className={`px-2 py-0.5 rounded-full border ${
                          isHh
                            ? 'bg-teal-100 text-teal-950 border-teal-300'
                            : 'bg-amber-100 text-amber-950 border-amber-300'
                        }`}
                      >
                        {isHh ? 'Bố (Hiệp Hòa)' : 'Mẹ (Tiên Du)'}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-stone-600">
                        {log.nguon === 'giong' ? (
                          <>
                            <Mic className="w-3.5 h-3.5 text-rose-600" /> Giọng nói
                          </>
                        ) : (
                          'Gõ chữ'
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-stone-500 font-semibold">
                        {formatLogTimestamp(log.timestamp)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold border ${statusMeta.className}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                  </div>

                  <div className="text-base font-bold text-stone-900 bg-white p-2.5 rounded-xl border border-stone-200">
                    &ldquo;{log.cau_noi}&rdquo;
                  </div>

                  {aiPreview && (
                    <div className="text-xs font-semibold text-indigo-900 px-1">
                      {aiPreview}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onOpenFacilityBook(log.book_id, targetDate)}
                      className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 text-indigo-950 font-bold text-xs inline-flex items-center justify-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Mở sổ ngày {shortDate} sửa / ghi hộ</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTeachingLog(log)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-300 text-purple-950 font-bold text-xs inline-flex items-center gap-1"
                      title="Dạy từ mới hoặc thêm mối hàng từ câu này"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      <span>Dạy từ / Mối mới</span>
                    </button>

                    {(log.ket_qua === 'cho_xac_nhan' || log.ket_qua === 'huy') && (
                      <button
                        type="button"
                        onClick={() => void handleMarkChatResolved(log)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 font-bold text-xs"
                      >
                        Đã xử lý
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hộp thoại Dạy từ mới / Mối mới */}
      {(teachingLog || teachingCandidate) && hhSnap && (
        <DialectTeachingModal
          isOpen={Boolean(teachingLog || teachingCandidate)}
          onClose={() => {
            setTeachingLog(null);
            setTeachingCandidate(null);
          }}
          utterance={teachingCandidate?.rawUtterance || teachingLog?.cau_noi || ''}
          defaultCandidateTerm={teachingCandidate?.candidateTerm}
          defaultType={teachingCandidate?.suggestedType}
          defaultCategoryId={teachingCandidate?.suggestedCategoryId}
          defaultBookId={teachingCandidate?.bookId || teachingLog?.book_id}
          categories={hhSnap.categories}
          onSaveKeyword={async (catId, kw) => {
            if (!session) return;
            const targetCat = hhSnap.categories.find((c) => c.id === catId);
            if (!targetCat) return;
            const cleanKw = kw.trim().toLowerCase();
            const exists = targetCat.tu_khoa_ai.includes(cleanKw);
            const nextKws = exists ? targetCat.tu_khoa_ai : [...targetCat.tu_khoa_ai, cleanKw];
            await dbRepo.upsertCategory(session, { ...targetCat, tu_khoa_ai: nextKws });
            if (teachingLog) {
              await dbRepo.updateChatLogStatus(
                session,
                teachingLog.book_id,
                teachingLog.id,
                'da_sua'
              );
            }
            await loadBothBooks();
            showToast(`Đã thêm từ "${kw}" vào danh mục ${targetCat.ten_danh_muc}!`);
            setTeachingLog(null);
            setTeachingCandidate(null);
          }}
          onSaveSupplier={async (bId, name, item, openingDebt) => {
            if (!session) return;
            const newSup: Supplier = {
              id: `sup_${bId}_${generateId()}`,
              book_id: bId,
              ten_ncc: name,
              mat_hang_chinh: item,
              so_dien_thoai: '',
              no_dau_ky: openingDebt,
              dang_giao_dich: true,
            };
            await dbRepo.upsertSupplier(session, newSup);
            if (teachingLog) {
              await dbRepo.updateChatLogStatus(
                session,
                teachingLog.book_id,
                teachingLog.id,
                'da_sua'
              );
            }
            await loadBothBooks();
            showToast(`Đã thêm mối hàng "${name}" vào sổ!`);
            setTeachingLog(null);
            setTeachingCandidate(null);
          }}
          onSaveWorker={async (bId, name, wage) => {
            if (!session) return;
            const newWrk: Worker = {
              id: `wrk_${bId}_${generateId()}`,
              book_id: bId,
              ho_ten: name,
              luong_ngay: wage,
              dang_lam: true,
            };
            await dbRepo.upsertWorker(session, newWrk);
            if (teachingLog) {
              await dbRepo.updateChatLogStatus(
                session,
                teachingLog.book_id,
                teachingLog.id,
                'da_sua'
              );
            }
            await loadBothBooks();
            showToast(`Đã thêm phụ bếp "${name}" vào sổ!`);
            setTeachingLog(null);
            setTeachingCandidate(null);
          }}
        />
      )}
    </div>
  );
};

// --- MODAL DẠY TỪ ĐỊA PHƯƠNG, THÊM MỐI HÀNG, THÊM PHỤ BẾP ---

interface DialectTeachingModalProps {
  isOpen: boolean;
  onClose: () => void;
  utterance: string;
  defaultCandidateTerm?: string;
  defaultType?: 'category_keyword' | 'new_supplier' | 'new_worker';
  defaultCategoryId?: string;
  defaultBookId?: BookId;
  categories: Category[];
  onSaveKeyword: (catId: string, kw: string) => Promise<void>;
  onSaveSupplier: (bookId: BookId, name: string, item: string, debt: number) => Promise<void>;
  onSaveWorker: (bookId: BookId, name: string, wage: number) => Promise<void>;
}

const DialectTeachingModal: React.FC<DialectTeachingModalProps> = ({
  isOpen,
  onClose,
  utterance,
  defaultCandidateTerm = '',
  defaultType = 'category_keyword',
  defaultCategoryId,
  defaultBookId = 'hiep_hoa',
  categories,
  onSaveKeyword,
  onSaveSupplier,
  onSaveWorker,
}) => {
  const [mode, setMode] = useState<'keyword' | 'supplier' | 'worker'>(() => {
    if (defaultType === 'new_supplier') return 'supplier';
    if (defaultType === 'new_worker') return 'worker';
    return 'keyword';
  });

  const [keywordTerm, setKeywordTerm] = useState(defaultCandidateTerm);
  const [targetCatId, setTargetCatId] = useState(
    defaultCategoryId || categories.find((c) => c.nhom === 'chi')?.id || categories[0]?.id
  );

  const [targetBookId, setTargetBookId] = useState<BookId>(defaultBookId);
  const [supplierName, setSupplierName] = useState(defaultCandidateTerm);
  const [supplierItem, setSupplierItem] = useState('');
  const [supplierDebt, setSupplierDebt] = useState(0);

  const [workerName, setWorkerName] = useState(defaultCandidateTerm);
  const [workerWage, setWorkerWage] = useState(250_000);

  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'keyword') {
        if (!keywordTerm.trim()) return;
        await onSaveKeyword(targetCatId, keywordTerm.trim());
      } else if (mode === 'supplier') {
        if (!supplierName.trim()) return;
        await onSaveSupplier(targetBookId, supplierName.trim(), supplierItem.trim(), supplierDebt);
      } else {
        if (!workerName.trim()) return;
        await onSaveWorker(targetBookId, workerName.trim(), workerWage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-center overflow-y-auto p-3">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl flex flex-col my-auto border-2 border-purple-400 overflow-hidden">
        {/* Header */}
        <div className="bg-purple-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-300" />
            <div>
              <h3 className="text-xl font-extrabold">Dạy từ mới &amp; Thêm mối hàng</h3>
              <p className="text-xs text-purple-200">Giúp AI hiểu chuẩn xác hơn lần sau</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-2xl bg-stone-50 border border-stone-200 space-y-1">
            <span className="text-xs font-bold text-stone-500 uppercase">Câu nói gốc:</span>
            <div className="text-base font-bold text-stone-900 italic">&ldquo;{utterance}&rdquo;</div>
          </div>

          {/* 3 tabs hành động */}
          <div className="grid grid-cols-3 gap-1.5 bg-stone-100 p-1 rounded-2xl text-xs font-extrabold">
            <button
              type="button"
              onClick={() => setMode('keyword')}
              className={`py-2 px-1 rounded-xl transition ${
                mode === 'keyword'
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-stone-700 hover:bg-stone-200'
              }`}
            >
              Danh mục
            </button>
            <button
              type="button"
              onClick={() => setMode('supplier')}
              className={`py-2 px-1 rounded-xl transition ${
                mode === 'supplier'
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-stone-700 hover:bg-stone-200'
              }`}
            >
              Mối hàng
            </button>
            <button
              type="button"
              onClick={() => setMode('worker')}
              className={`py-2 px-1 rounded-xl transition ${
                mode === 'worker'
                  ? 'bg-purple-700 text-white shadow-xs'
                  : 'text-stone-700 hover:bg-stone-200'
              }`}
            >
              Phụ bếp
            </button>
          </div>

          {/* Mode 1: Gán từ khóa địa phương */}
          {mode === 'keyword' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Từ / Cụm từ tiếng địa phương:
                </label>
                <input
                  type="text"
                  value={keywordTerm}
                  onChange={(e) => setKeywordTerm(e.target.value)}
                  placeholder="VD: bìa đậu, tương bần, sting, revive..."
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2.5 text-base font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Gán vào Danh mục chi tiêu:
                </label>
                <select
                  value={targetCatId}
                  onChange={(e) => setTargetCatId(e.target.value)}
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2.5 text-base font-bold text-stone-900"
                >
                  {categories
                    .filter((c) => c.nhom === 'chi')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.ten_danh_muc} (
                        {c.mang_mac_dinh === 'can_tin' ? 'Căn tin' : 'Bếp ăn'})
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {/* Mode 2: Thêm mối hàng */}
          {mode === 'supplier' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTargetBookId('hiep_hoa')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    targetBookId === 'hiep_hoa'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-stone-50 text-stone-700 border-stone-300'
                  }`}
                >
                  Sổ Hiệp Hòa (Bố)
                </button>
                <button
                  type="button"
                  onClick={() => setTargetBookId('tien_du')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    targetBookId === 'tien_du'
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-stone-50 text-stone-700 border-stone-300'
                  }`}
                >
                  Sổ Tiên Du (Mẹ)
                </button>
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Tên mối hàng / người bán:
                </label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="VD: Chị Hương rau, Đại lý Minh..."
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-base font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Mặt hàng chính (tùy chọn):
                </label>
                <input
                  type="text"
                  value={supplierItem}
                  onChange={(e) => setSupplierItem(e.target.value)}
                  placeholder="VD: Rau củ quả, Thịt lợn..."
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Nợ cũ đầu kỳ (nếu có):
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={supplierDebt}
                  onChange={(e) => setSupplierDebt(Number(e.target.value || 0))}
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-base font-bold"
                />
              </div>
            </div>
          )}

          {/* Mode 3: Thêm phụ bếp */}
          {mode === 'worker' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTargetBookId('hiep_hoa')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    targetBookId === 'hiep_hoa'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-stone-50 text-stone-700 border-stone-300'
                  }`}
                >
                  Sổ Hiệp Hòa (Bố)
                </button>
                <button
                  type="button"
                  onClick={() => setTargetBookId('tien_du')}
                  className={`py-2 rounded-xl text-xs font-bold border ${
                    targetBookId === 'tien_du'
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-stone-50 text-stone-700 border-stone-300'
                  }`}
                >
                  Sổ Tiên Du (Mẹ)
                </button>
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Họ tên phụ bếp:
                </label>
                <input
                  type="text"
                  value={workerName}
                  onChange={(e) => setWorkerName(e.target.value)}
                  placeholder="VD: Cô Mùi, Bác Tiến..."
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-base font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Tiền công 1 ngày:
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={workerWage}
                  onChange={(e) => setWorkerWage(Number(e.target.value || 0))}
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-base font-bold"
                />
              </div>
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold text-base"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-2 py-3 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-base shadow-sm"
            >
              {submitting ? 'Đang lưu...' : 'Lưu vào hệ thống'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
