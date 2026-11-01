import React, { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Pencil,
  School,
  Trash2,
  Users,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import {
  computeDebtAndPayables,
  computeSupplierLedgerDetail,
  computeWalletBalances,
} from '../domain/accounting';
import {
  formatCompactVND,
  formatVietnameseDate,
  formatVietnameseMonth,
  formatVND,
  getNextYearMonth,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
} from '../domain/format';
import type { BookSnapshot, Transaction } from '../types/models';
import {
  ConfirmationCard,
  UndoBanner,
  speakVietnameseText,
  type ConfirmationPreviewData,
  type UndoState,
} from './ConfirmationCard';
import { MoneyInput } from './MoneyInput';
import type { ManualFormKind } from './ManualEntryForms';

interface DebtLedgerViewProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  focusedSupplierId?: string | null;
  onClearFocusSupplier?: () => void;
  onDataChanged: () => Promise<void>;
  onOpenManualForm?: (kind: ManualFormKind, editTx?: Transaction) => void;
}

type ActivePayAction =
  | { kind: 'tra_no_ncc'; supplierId: string; mode: 'full' | 'partial' }
  | { kind: 'tra_luong_tho'; workerId: string }
  | { kind: 'truong_chuyen' }
  | null;

export const DebtLedgerView: React.FC<DebtLedgerViewProps> = ({
  snapshot,
  selectedDate,
  focusedSupplierId,
  onClearFocusSupplier,
  onDataChanged,
  onOpenManualForm,
}) => {
  const { session } = useAuth();
  const todayISO = selectedDate || getTodayISO();
  const [kyThang, setKyThang] = useState<string>(() => getYearMonth(todayISO));
  const [showAllSuppliers, setShowAllSuppliers] = useState<boolean>(false);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});
  const [activeAction, setActiveAction] = useState<ActivePayAction>(null);
  const [amount, setAmount] = useState<number>(0);
  const [walletId, setWalletId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [confirmStep, setConfirmStep] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const walletBalances = useMemo(
    () =>
      computeWalletBalances(
        snapshot.wallets,
        snapshot.transactions,
        snapshot.book.id
      ),
    [snapshot.wallets, snapshot.transactions, snapshot.book.id]
  );

  const cashWalletId = useMemo(
    () =>
      snapshot.wallets.find(
        (w) => w.book_id === snapshot.book.id && w.loai_vi === 'tien_mat'
      )?.id ??
      snapshot.wallets[0]?.id ??
      '',
    [snapshot.wallets, snapshot.book.id]
  );

  const schoolWalletId = useMemo(
    () =>
      snapshot.wallets.find(
        (w) => w.book_id === snapshot.book.id && w.loai_vi === 'tk_mo_diep'
      )?.id ?? cashWalletId,
    [snapshot.wallets, snapshot.book.id, cashWalletId]
  );

  const debt = useMemo(
    () => computeDebtAndPayables(snapshot, kyThang, todayISO),
    [snapshot, kyThang, todayISO]
  );

  // Tự động bung chi tiết mối hàng khi nhảy từ Thẻ nhắc việc sang
  useEffect(() => {
    if (focusedSupplierId) {
      setShowAllSuppliers(true);
      setExpandedSuppliers((prev) => ({ ...prev, [focusedSupplierId]: true }));
      const supItem = debt.nha_cung_cap.danh_sach.find(
        (d) => d.supplier.id === focusedSupplierId
      );
      if (supItem && supItem.con_no > 0) {
        setActiveAction({
          kind: 'tra_no_ncc',
          supplierId: focusedSupplierId,
          mode: 'full',
        });
        setAmount(supItem.con_no);
        setWalletId(cashWalletId);
        setNote(`Tất toán nợ ${supItem.supplier.ten_ncc}`);
        setConfirmStep(true);
      }
      onClearFocusSupplier?.();
    }
  }, [focusedSupplierId, debt.nha_cung_cap.danh_sach, cashWalletId, onClearFocusSupplier]);

  const closeAction = () => {
    setActiveAction(null);
    setConfirmStep(false);
    setNote('');
  };

  const openPaySupplier = (supplierId: string, mode: 'full' | 'partial') => {
    const item = debt.nha_cung_cap.danh_sach.find(
      (d) => d.supplier.id === supplierId
    );
    if (!item) return;
    setActiveAction({ kind: 'tra_no_ncc', supplierId, mode });
    setAmount(mode === 'full' ? Math.max(0, item.con_no) : 0);
    setWalletId(cashWalletId);
    setNote(
      mode === 'full'
        ? `Trả hết nợ ${item.supplier.ten_ncc}`
        : `Trả bớt nợ ${item.supplier.ten_ncc}`
    );
    setConfirmStep(mode === 'full' && item.con_no > 0);
  };

  const openPayWorker = (workerId: string) => {
    const wItem = debt.luong_tho_ky_nay.chi_tiet_tho.find(
      (w) => w.worker.id === workerId
    );
    if (!wItem) return;
    setActiveAction({ kind: 'tra_luong_tho', workerId });
    setAmount(Math.max(0, wItem.con_lai));
    setWalletId(cashWalletId);
    setNote(`Trả lương ${wItem.worker.ho_ten} (${formatVietnameseMonth(kyThang)})`);
    setConfirmStep(wItem.con_lai > 0);
  };

  const openSchoolTransfer = () => {
    const remaining = Math.max(0, debt.tien_truong_ky_nay.con_cho_chuyen);
    setActiveAction({ kind: 'truong_chuyen' });
    setAmount(remaining);
    setWalletId(schoolWalletId);
    setNote(`Nhà trường chuyển tiền ăn ${formatVietnameseMonth(kyThang)}`);
    setConfirmStep(remaining > 0);
  };

  const selectedWallet = walletBalances.find((b) => b.wallet.id === walletId)?.wallet;

  // Xây dựng dữ liệu Thẻ xác nhận cho hành động đang mở
  const previewData: ConfirmationPreviewData | null = useMemo(() => {
    if (!activeAction || amount <= 0 || !selectedWallet) return null;

    if (activeAction.kind === 'tra_no_ncc') {
      const supItem = debt.nha_cung_cap.danh_sach.find(
        (d) => d.supplier.id === activeAction.supplierId
      );
      if (!supItem) return null;
      const conLaiSauTra = Math.max(0, supItem.con_no - amount);
      return {
        badge:
          conLaiSauTra === 0
            ? 'TẤT TOÁN HẾT NỢ MỐI HÀNG'
            : 'TRẢ BỚT NỢ MỐI HÀNG',
        tone: 'debt',
        title: `Trả nợ ${supItem.supplier.ten_ncc}`,
        headlineAmount: -amount,
        headlineSubtext:
          conLaiSauTra === 0
            ? 'Sau lần này hết sạch nợ (0 đ)!'
            : `Trả xong còn nợ lại: ${formatVND(conLaiSauTra)}`,
        dateLabel: formatVietnameseDate(todayISO),
        rows: [
          {
            label: 'Mối hàng',
            value: `${supItem.supplier.ten_ncc} (${supItem.supplier.mat_hang_chinh})`,
          },
          {
            label: 'Đang nợ trước khi trả',
            value: formatVND(supItem.con_no),
          },
          {
            label: 'Lấy tiền từ ví',
            value: selectedWallet.ten_vi,
            highlight: true,
          },
          {
            label: 'Dư nợ còn lại',
            value: formatVND(conLaiSauTra),
            highlight: true,
          },
        ],
        bookImpactNote: `Trừ ${formatVND(amount)} khỏi ${
          selectedWallet.ten_vi
        } · Giảm nợ ${
          supItem.supplier.ten_ncc
        } · Không trừ trùng vào Lãi lỗ (vì đã tính lúc mua hàng).`,
        spokenText: `Trả nợ ${supItem.supplier.ten_ncc} ${formatCompactVND(
          amount
        )} từ ${selectedWallet.ten_vi}. ${
          conLaiSauTra === 0
            ? 'Hết sạch nợ.'
            : `Còn nợ lại ${formatCompactVND(conLaiSauTra)}.`
        } Đúng không ạ?`,
      };
    }

    if (activeAction.kind === 'tra_luong_tho') {
      const wItem = debt.luong_tho_ky_nay.chi_tiet_tho.find(
        (w) => w.worker.id === activeAction.workerId
      );
      if (!wItem) return null;
      const conLai = Math.max(0, wItem.con_lai - amount);
      return {
        badge: 'TRẢ LƯƠNG PHỤ BẾP',
        tone: 'expense',
        title: `${wItem.worker.ho_ten} (${formatVietnameseMonth(kyThang)})`,
        headlineAmount: -amount,
        headlineSubtext:
          conLai === 0
            ? `Đã thanh toán đủ ${wItem.tong_cong} công kỳ này`
            : `Còn lại chưa trả: ${formatVND(conLai)}`,
        dateLabel: formatVietnameseDate(todayISO),
        rows: [
          {
            label: 'Kỳ tính công',
            value: `${formatVietnameseMonth(kyThang)} (${wItem.tong_cong} công)`,
          },
          {
            label: 'Lấy tiền từ ví',
            value: selectedWallet.ten_vi,
            highlight: true,
          },
          {
            label: 'Lương còn phải trả sau GD',
            value: formatVND(conLai),
            highlight: true,
          },
        ],
        bookImpactNote: `Trừ ${formatVND(amount)} khỏi ${
          selectedWallet.ten_vi
        } · Giảm phải trả lương · Không trừ trùng vào Lãi lỗ (công đã tính theo ngày).`,
        spokenText: `Trả lương ${wItem.worker.ho_ten} ${formatCompactVND(
          amount
        )} cho ${formatVietnameseMonth(kyThang)} từ ${selectedWallet.ten_vi}. Đúng không ạ?`,
      };
    }

    // activeAction.kind === 'truong_chuyen'
    const conCho = Math.max(0, debt.tien_truong_ky_nay.con_cho_chuyen - amount);
    return {
      badge: 'NHÀ TRƯỜNG CHUYỂN TIỀN ĂN',
      tone: 'income',
      title: `Tiền trường ${formatVietnameseMonth(kyThang)}`,
      headlineAmount: amount,
      headlineSubtext:
        conCho === 0
          ? `Đã về đủ 100% (${debt.tien_truong_ky_nay.tong_suat_truong} suất)`
          : `Còn chờ chuyển tiếp: ${formatVND(conCho)}`,
      dateLabel: formatVietnameseDate(todayISO),
      rows: [
        {
          label: 'Kỳ đối soát suất ăn',
          value: `${formatVietnameseMonth(kyThang)} (${
            debt.tien_truong_ky_nay.tong_suat_truong
          } suất)`,
        },
        {
          label: 'Tiền chảy vào tài khoản',
          value: selectedWallet.ten_vi,
          highlight: true,
        },
        {
          label: 'Còn chờ trường chuyển',
          value: formatVND(conCho),
          highlight: true,
        },
      ],
      bookImpactNote: `Cộng ${formatVND(amount)} vào ${
        selectedWallet.ten_vi
      } · Khấu trừ công nợ trường · Không cộng trùng vào Lãi lỗ (doanh thu đã tính theo suất ngày).`,
      spokenText: `Ghi nhận nhà trường chuyển ${formatCompactVND(
        amount
      )} tiền ăn ${formatVietnameseMonth(kyThang)} vào ${
        selectedWallet.ten_vi
      }. Đúng không ạ?`,
    };
  }, [activeAction, amount, selectedWallet, debt, kyThang, todayISO]);

  const handleConfirmSave = async () => {
    if (!session || !activeAction || amount <= 0 || !walletId) return;
    setSaving(true);
    try {
      if (activeAction.kind === 'tra_no_ncc') {
        const isVirtual = activeAction.supplierId === '__unassigned_supplier__';
        const sup = isVirtual
          ? { ten_ncc: 'Mối hàng chợ' }
          : snapshot.suppliers.find((s) => s.id === activeAction.supplierId);
        const saved = await dbRepo.addTransaction(session, {
          book_id: snapshot.book.id,
          ngay: todayISO,
          mang: 'chung',
          loai: 'tra_no',
          category_id: 'cat_tra_no_ncc',
          so_tien: Math.round(amount),
          wallet_id: walletId,
          supplier_id: isVirtual ? null : activeAction.supplierId,
          ghi_chu: note.trim() || `Trả nợ ${sup?.ten_ncc ?? 'mối hàng'}`,
          nguon: 'tay',
          nguoi_tao: session.profile_id,
        });
        closeAction();
        setUndoState({
          message: `Đã ghi trả nợ ${sup?.ten_ncc ?? ''}: ${formatVND(amount)}`,
          undoFn: async () => {
            await dbRepo.softDeleteTransaction(session, snapshot.book.id, saved.id);
          },
        });
      } else if (activeAction.kind === 'tra_luong_tho') {
        const worker = snapshot.workers.find((w) => w.id === activeAction.workerId);
        const saved = await dbRepo.addTransaction(session, {
          book_id: snapshot.book.id,
          ngay: todayISO,
          ky_thang: kyThang,
          mang: 'bep_an',
          loai: 'tra_luong',
          category_id: 'cat_tra_luong',
          so_tien: Math.round(amount),
          wallet_id: walletId,
          worker_id: activeAction.workerId,
          ghi_chu:
            note.trim() ||
            `Trả lương ${worker?.ho_ten ?? ''} (${formatVietnameseMonth(kyThang)})`,
          nguon: 'tay',
          nguoi_tao: session.profile_id,
        });
        closeAction();
        setUndoState({
          message: `Đã ghi trả lương ${worker?.ho_ten ?? ''}: ${formatVND(amount)}`,
          undoFn: async () => {
            await dbRepo.softDeleteTransaction(session, snapshot.book.id, saved.id);
          },
        });
      } else {
        const saved = await dbRepo.addTransaction(session, {
          book_id: snapshot.book.id,
          ngay: todayISO,
          ky_thang: kyThang,
          mang: 'bep_an',
          loai: 'truong_chuyen',
          category_id: 'cat_truong_chuyen',
          so_tien: Math.round(amount),
          wallet_id: walletId,
          ghi_chu:
            note.trim() ||
            `Nhà trường chuyển tiền ăn ${formatVietnameseMonth(kyThang)}`,
          nguon: 'tay',
          nguoi_tao: session.profile_id,
        });
        closeAction();
        setUndoState({
          message: `Đã ghi nhận trường chuyển: ${formatVND(amount)}`,
          undoFn: async () => {
            await dbRepo.softDeleteTransaction(session, snapshot.book.id, saved.id);
          },
        });
      }

      await onDataChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistoryTx = async (txId: string, desc: string) => {
    if (!session) return;
    await dbRepo.softDeleteTransaction(session, snapshot.book.id, txId);
    setUndoState({
      message: `Đã hoàn tác: ${desc}`,
      undoFn: async () => {
        await dbRepo.restoreTransaction(session, snapshot.book.id, txId);
      },
    });
    await onDataChanged();
  };

  const maxDebtDays = Math.max(1, snapshot.book.so_ngay_nhac_no_ncc || 15);
  const owingSuppliers = debt.nha_cung_cap.danh_sach.filter((d) => d.con_no > 0);
  const visibleSuppliers = showAllSuppliers
    ? debt.nha_cung_cap.danh_sach
    : owingSuppliers;

  const spokenSummary = `Sổ công nợ ${snapshot.book.ten}: Đang nợ nhà cung cấp ${formatVND(
    debt.nha_cung_cap.tong_no_ncc
  )}. Lương thợ ${formatVietnameseMonth(kyThang)} còn phải trả ${formatVND(
    debt.luong_tho_ky_nay.con_phai_tra
  )}. Tiền trường ${formatVietnameseMonth(kyThang)} còn chờ về ${formatVND(
    debt.tien_truong_ky_nay.con_cho_chuyen
  )}.`;

  return (
    <div className="space-y-4">
      <UndoBanner
        undoState={undoState}
        onDismiss={() => setUndoState(null)}
        onUndone={async () => {
          setUndoState(null);
          await onDataChanged();
        }}
      />

      {/* HEADER TỔNG QUAN 2 CHIỀU: KHOẢN MÌNH NỢ & KHOẢN NGƯỜI TA NỢ MINH */}
      <div className="rounded-3xl bg-stone-900 text-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xl font-extrabold">
            <BookMarked className="w-6 h-6 text-amber-400 shrink-0" />
            <span>Sổ Nợ & Khoản Phải Thu ({snapshot.book.ten})</span>
          </div>
          <button
            type="button"
            onClick={() => speakVietnameseText(spokenSummary)}
            aria-label="Nghe đọc sổ nợ"
            className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-sm inline-flex items-center gap-1.5 shrink-0"
          >
            <Volume2 className="w-4 h-4" />
            Nghe đọc
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="p-3 rounded-2xl bg-rose-950/80 border border-rose-500/50">
            <div className="text-sm font-bold text-rose-200">Khoản mình nợ (Phải trả)</div>
            <div className="text-2xl font-black text-rose-300 mt-1">
              {formatVND(debt.tong_minh_no)}
            </div>
            <div className="text-xs text-rose-300/80 mt-1">
              NCC: {formatCompactVND(debt.nha_cung_cap.tong_no_ncc)} · Lương: {formatCompactVND(debt.luong_tho_ky_nay.con_phai_tra)}
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-950/80 border border-emerald-500/50">
            <div className="text-sm font-bold text-emerald-200">Người ta nợ mình (Phải thu)</div>
            <div className="text-2xl font-black text-emerald-300 mt-1">
              {formatVND(debt.tong_nguoi_ta_no)}
            </div>
            <div className="text-xs text-emerald-300/80 mt-1">
              Trường: {formatCompactVND(debt.tien_truong_ky_nay.con_cho_chuyen)} · Khách: {formatCompactVND(debt.phai_thu_khach.tong_phai_thu_khach)}
            </div>
          </div>
        </div>
      </div>

      {/* PANEL INLINE: TRẢ NỢ 1 CHẠM / TRẢ 1 PHẦN / TRẢ LƯƠNG / TRƯỜNG CHUYỂN */}
      {activeAction && (
        <div className="rounded-3xl bg-white border-2 border-teal-700 p-4 shadow-md space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xl font-extrabold text-teal-950">
              {activeAction.kind === 'tra_no_ncc'
                ? activeAction.mode === 'full'
                  ? 'Trả hết nợ 1 chạm'
                  : 'Trả một phần nợ mối hàng'
                : activeAction.kind === 'tra_luong_tho'
                ? 'Ghi trả / ứng lương thợ'
                : 'Ghi nhận trường chuyển tiền'}
            </div>
            <button
              type="button"
              onClick={closeAction}
              aria-label="Đóng"
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Cho phép đổi ví nhanh ngay cả ở chế độ 1 chạm */}
          <div>
            <div className="text-sm font-bold text-stone-700 mb-1.5">
              {activeAction.kind === 'truong_chuyen'
                ? 'Tiền trường về tài khoản nào:'
                : 'Lấy tiền từ ví / tài khoản nào:'}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {walletBalances.map(({ wallet, so_du_hien_tai }) => {
                const selected = wallet.id === walletId;
                const shortName =
                  wallet.loai_vi === 'tien_mat'
                    ? 'Tiền mặt'
                    : wallet.loai_vi === 'tk_mo_diep'
                    ? 'Mợ Diệp'
                    : 'Chị Nhàn';
                return (
                  <button
                    key={wallet.id}
                    type="button"
                    onClick={() => setWalletId(wallet.id)}
                    className={`p-2 rounded-2xl border-2 text-center transition ${
                      selected
                        ? 'bg-teal-50 border-teal-700 text-teal-950 font-extrabold'
                        : 'bg-stone-50 border-stone-300 text-stone-700 font-semibold'
                    }`}
                  >
                    <div className="text-sm leading-tight">{shortName}</div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {formatCompactVND(so_du_hien_tai)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {confirmStep && previewData ? (
            <ConfirmationCard
              data={previewData}
              saving={saving}
              onConfirm={handleConfirmSave}
              onEdit={() => setConfirmStep(false)}
            />
          ) : (
            <div className="space-y-3">
              <MoneyInput
                label="Số tiền:"
                value={amount}
                onChange={setAmount}
                placeholder="Nhập số tiền..."
              />

              {activeAction.kind === 'tra_no_ncc' && (() => {
                const supItem = debt.nha_cung_cap.danh_sach.find(
                  (d) => d.supplier.id === activeAction.supplierId
                );
                if (!supItem || supItem.con_no <= 0) return null;
                const half = Math.round(supItem.con_no / 2000) * 1000;
                const roundMillion =
                  supItem.con_no >= 1_000_000
                    ? Math.floor(supItem.con_no / 1_000_000) * 1_000_000
                    : 0;
                return (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAmount(supItem.con_no)}
                      className="px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-400 text-rose-950 font-bold text-base"
                    >
                      Trả hết ({formatCompactVND(supItem.con_no)})
                    </button>
                    {half > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(half)}
                        className="px-3.5 py-2 rounded-xl bg-stone-100 border border-stone-300 text-stone-800 font-bold text-base"
                      >
                        Một nửa ({formatCompactVND(half)})
                      </button>
                    )}
                    {roundMillion > 0 && roundMillion !== supItem.con_no && (
                      <button
                        type="button"
                        onClick={() => setAmount(roundMillion)}
                        className="px-3.5 py-2 rounded-xl bg-stone-100 border border-stone-300 text-stone-800 font-bold text-base"
                      >
                        Chẵn {formatCompactVND(roundMillion)}
                      </button>
                    )}
                  </div>
                );
              })()}

              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú thêm (không bắt buộc)..."
                className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 text-lg text-stone-900"
              />

              <button
                type="button"
                disabled={amount <= 0 || !walletId}
                onClick={() => setConfirmStep(true)}
                className="w-full min-h-[54px] rounded-2xl bg-teal-800 hover:bg-teal-900 disabled:bg-stone-300 text-white font-extrabold text-lg"
              >
                Xem thẻ xác nhận & Lưu sổ
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* NHÓM 1: SỔ NỢ NHÀ CUNG CẤP (MUA CHỊU)                                 */}
      {/* ===================================================================== */}
      <section className="rounded-3xl bg-white border-2 border-rose-300 p-4 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-rose-950">
              1. Nợ nhà cung cấp (Mua chịu)
            </h2>
            <div className="text-3xl font-extrabold text-rose-700 mt-0.5">
              {formatVND(debt.nha_cung_cap.tong_no_ncc)}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowAllSuppliers(false)}
              className={`px-3 py-1.5 rounded-full text-sm font-extrabold border ${
                !showAllSuppliers
                  ? 'bg-rose-800 text-white border-rose-800'
                  : 'bg-stone-100 text-stone-700 border-stone-300'
              }`}
            >
              Đang nợ ({owingSuppliers.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAllSuppliers(true)}
              className={`px-3 py-1.5 rounded-full text-sm font-extrabold border ${
                showAllSuppliers
                  ? 'bg-rose-800 text-white border-rose-800'
                  : 'bg-stone-100 text-stone-700 border-stone-300'
              }`}
            >
              Tất cả ({debt.nha_cung_cap.danh_sach.length})
            </button>
          </div>
        </div>

        {visibleSuppliers.length === 0 ? (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-400 text-emerald-950 flex items-center gap-3">
            <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0" />
            <div className="text-lg font-bold">
              Tuyệt vời! Hiện tại không nợ đồng nào của nhà cung cấp.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleSuppliers.map((item) => {
              const isExpanded = Boolean(expandedSuppliers[item.supplier.id]);
              const isOverdue =
                item.con_no > 0 && item.so_ngay_no_lau_nhat >= maxDebtDays;
              const detail = isExpanded
                ? computeSupplierLedgerDetail(snapshot, item.supplier.id, todayISO)
                : null;

              return (
                <div
                  key={item.supplier.id}
                  className={`rounded-2xl border-2 p-3.5 space-y-3 ${
                    isOverdue
                      ? 'bg-rose-50/70 border-rose-500'
                      : item.con_no > 0
                      ? 'bg-stone-50 border-rose-200'
                      : 'bg-stone-50 border-stone-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xl font-extrabold text-stone-950">
                        {item.supplier.ten_ncc}
                      </div>
                      <div className="text-base text-stone-600 font-medium">
                        {item.supplier.mat_hang_chinh}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-xl font-extrabold ${
                          item.con_no > 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {item.con_no > 0 ? formatVND(item.con_no) : '0 đ (Hết nợ)'}
                      </div>
                      {item.con_no > 0 && item.ngay_no_cu_nhat && (
                        <div
                          className={`inline-flex items-center gap-1 text-xs font-extrabold px-2 py-0.5 rounded-full mt-0.5 ${
                            isOverdue
                              ? 'bg-rose-700 text-white'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {isOverdue
                              ? `Quá hạn: đã ${item.so_ngay_no_lau_nhat} ngày`
                              : `Nợ ${item.so_ngay_no_lau_nhat} ngày`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {item.con_no > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openPaySupplier(item.supplier.id, 'full')}
                        className="min-h-[48px] px-3 py-2 rounded-2xl bg-rose-700 hover:bg-rose-800 text-white font-extrabold text-base inline-flex items-center justify-center gap-1.5 active:scale-[0.99]"
                      >
                        <Zap className="w-4 h-4 shrink-0" />
                        <span>Trả hết 1 chạm</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaySupplier(item.supplier.id, 'partial')}
                        className="min-h-[48px] px-3 py-2 rounded-2xl bg-white hover:bg-rose-50 border-2 border-rose-500 text-rose-900 font-extrabold text-base"
                      >
                        Trả một phần
                      </button>
                    </div>
                  )}

                  {/* Nút bung lịch sử từng lần lấy hàng & trả nợ */}
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSuppliers((prev) => ({
                        ...prev,
                        [item.supplier.id]: !prev[item.supplier.id],
                      }))
                    }
                    className="w-full py-2 px-3 rounded-xl bg-white border border-stone-300 text-stone-800 font-bold text-sm flex items-center justify-between"
                  >
                    <span>
                      Lịch sử lấy hàng & trả nợ (Mua chịu:{' '}
                      {formatCompactVND(item.tong_mua_chiu)} · Đã trả:{' '}
                      {formatCompactVND(item.tong_da_tra)})
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    )}
                  </button>

                  {isExpanded && detail && (
                    <div className="space-y-2 pt-1 border-t border-stone-200">
                      {detail.no_dau_ky > 0 && (
                        <div className="flex justify-between text-sm font-bold text-stone-600 px-2">
                          <span>Nợ đầu kỳ chuyển sang:</span>
                          <span>{formatVND(detail.no_dau_ky)}</span>
                        </div>
                      )}

                      {detail.lich_su.length === 0 ? (
                        <div className="text-sm text-stone-500 italic px-2 py-2">
                          Chưa có giao dịch mua chịu hoặc trả nợ nào với mối hàng này.
                        </div>
                      ) : (
                        detail.lich_su.map((entry) => {
                          const isBorrow = entry.loai_phat_sinh === 'mua_chiu';
                          return (
                            <div
                              key={entry.tx.id}
                              className="p-2.5 rounded-xl bg-white border border-stone-200 space-y-1"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-base font-extrabold text-stone-900">
                                    {isBorrow ? 'Lấy hàng ghi sổ' : 'Đã trả tiền'}
                                    {entry.tx.ghi_chu ? ` — ${entry.tx.ghi_chu}` : ''}
                                  </div>
                                  <div className="text-xs font-semibold text-stone-600">
                                    {entry.tx.ngay.split('-').reverse().join('/')} ·{' '}
                                    {entry.ten_danh_muc_hoac_vi}
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <div
                                    className={`text-base font-extrabold ${
                                      isBorrow ? 'text-rose-700' : 'text-emerald-700'
                                    }`}
                                  >
                                    {isBorrow
                                      ? `+${formatVND(entry.so_tien)}`
                                      : `-${formatVND(entry.so_tien)}`}
                                  </div>
                                  <div className="text-xs font-bold text-stone-500">
                                    Còn nợ: {formatVND(entry.du_no_sau_gd)}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-stone-200/60">
                                {onOpenManualForm && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenManualForm(
                                        entry.loai_phat_sinh === 'tra_no' ? 'tra_no' : 'chi',
                                        entry.tx
                                      )
                                    }
                                    className="px-2 py-0.5 rounded-lg bg-white hover:bg-stone-100 border border-stone-300 text-[11px] font-bold text-stone-700 inline-flex items-center gap-1"
                                  >
                                    <Pencil className="w-3 h-3 text-stone-600" />
                                    Sửa
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteHistoryTx(
                                      entry.tx.id,
                                      isBorrow ? `Mua chịu ${formatVND(entry.so_tien)}` : `Trả nợ ${item.supplier.ten_ncc}`
                                    )
                                  }
                                  className="px-2 py-0.5 rounded-lg bg-stone-50 hover:bg-rose-50 border border-stone-300 text-[11px] font-bold text-stone-600 hover:text-rose-700 inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3 text-rose-600" />
                                  Xóa
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* THANH CHỌN THÁNG CHO LƯƠNG THỢ & TIỀN TRƯỜNG */}
      <div className="rounded-2xl bg-stone-200/80 border border-stone-300 p-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setKyThang((m) => getPreviousYearMonth(m))}
          className="px-3 py-2 rounded-xl bg-white border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1"
        >
          <ChevronLeft className="w-5 h-5" />
          Tháng trước
        </button>

        <div className="text-lg font-extrabold text-stone-950">
          {formatVietnameseMonth(kyThang)}
        </div>

        <button
          type="button"
          onClick={() => setKyThang((m) => getNextYearMonth(m))}
          className="px-3 py-2 rounded-xl bg-white border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1"
        >
          Tháng sau
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* ===================================================================== */}
      {/* NHÓM 2: LƯƠNG THỢ PHỤ BẾP PHẢI TRẢ KỲ THÁNG                           */}
      {/* ===================================================================== */}
      <section className="rounded-3xl bg-white border-2 border-amber-300 p-4 shadow-xs space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-amber-950 flex items-center gap-2">
              <Users className="w-6 h-6 text-amber-700 shrink-0" />
              <span>2. Lương thợ {formatVietnameseMonth(kyThang)}</span>
            </h2>
            <div className="text-3xl font-extrabold text-amber-800 mt-0.5">
              {formatVND(debt.luong_tho_ky_nay.con_phai_tra)}
            </div>
            <div className="text-sm text-stone-600 font-semibold mt-0.5">
              Tổng công: {formatVND(debt.luong_tho_ky_nay.tong_luong_tinh_theo_cong)} ·
              Đã ứng/trả: {formatVND(debt.luong_tho_ky_nay.da_tra_hoac_ung)}
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          {debt.luong_tho_ky_nay.chi_tiet_tho.map((w) => (
            <div
              key={w.worker.id}
              className="p-3 rounded-2xl bg-amber-50/60 border border-amber-300 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-extrabold text-stone-900">
                    {w.worker.ho_ten}
                  </div>
                  <div className="text-sm font-semibold text-stone-600">
                    Chấm công: <strong>{w.tong_cong} công</strong> (
                    {formatVND(w.thanh_tien)})
                    {w.da_ung > 0 ? ` · Đã ứng: ${formatVND(w.da_ung)}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-lg font-extrabold ${
                      w.con_lai > 0 ? 'text-amber-900' : 'text-emerald-700'
                    }`}
                  >
                    {w.con_lai > 0 ? formatVND(w.con_lai) : 'Đã trả đủ'}
                  </div>
                </div>
              </div>

              {w.con_lai > 0 && (
                <button
                  type="button"
                  onClick={() => openPayWorker(w.worker.id)}
                  className="w-full min-h-[46px] px-3 py-2 rounded-2xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-base inline-flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>
                    Trả đủ lương {w.worker.ho_ten} ({formatCompactVND(w.con_lai)})
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ===================================================================== */}
      {/* NHÓM 3: TIỀN TRƯỜNG DỰ KIẾN CHUYỂN VỀ KỲ THÁNG                        */}
      {/* ===================================================================== */}
      <section className="rounded-3xl bg-white border-2 border-sky-300 p-4 shadow-xs space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-sky-950 flex items-center gap-2">
              <School className="w-6 h-6 text-sky-700 shrink-0" />
              <span>3. Tiền trường {formatVietnameseMonth(kyThang)}</span>
            </h2>
            <div className="text-3xl font-extrabold text-sky-800 mt-0.5">
              {formatVND(debt.tien_truong_ky_nay.con_cho_chuyen)}
            </div>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 space-y-1 text-base text-stone-800">
          <div className="flex justify-between">
            <span>Tổng suất trường đã nấu:</span>
            <strong>{debt.tien_truong_ky_nay.tong_suat_truong} suất</strong>
          </div>
          <div className="flex justify-between">
            <span>Tổng tiền dự kiến thu:</span>
            <strong>{formatVND(debt.tien_truong_ky_nay.so_tien_du_kien)}</strong>
          </div>
          <div className="flex justify-between">
            <span>Trường đã chuyển về:</span>
            <strong className="text-emerald-700">
              {formatVND(debt.tien_truong_ky_nay.truong_da_chuyen)}
            </strong>
          </div>
        </div>

        {debt.tien_truong_ky_nay.con_cho_chuyen > 0 ? (
          <button
            type="button"
            onClick={openSchoolTransfer}
            className="w-full min-h-[50px] px-4 py-2.5 rounded-2xl bg-sky-700 hover:bg-sky-800 text-white font-extrabold text-lg inline-flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <Zap className="w-5 h-5 shrink-0" />
            <span>
              Ghi nhận trường chuyển về TK Mợ Diệp (
              {formatCompactVND(debt.tien_truong_ky_nay.con_cho_chuyen)})
            </span>
          </button>
        ) : debt.tien_truong_ky_nay.so_tien_du_kien > 0 ? (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-400 text-emerald-950 font-bold text-base flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
            <span>Nhà trường đã thanh toán đủ 100% tiền ăn kỳ này!</span>
          </div>
        ) : (
          <div className="text-base text-stone-500 italic">
            Chưa có suất ăn trường nào được ghi trong {formatVietnameseMonth(kyThang)}.
          </div>
        )}
      </section>

      {/* 4. KHOẢN PHẢI THU (Khách & Giáo viên ăn chịu, đặt cỗ chưa thanh toán) */}
      <section className="rounded-3xl bg-white border-2 border-emerald-500 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-emerald-950 flex items-center gap-2">
              <Users className="w-6 h-6 text-emerald-700 shrink-0" />
              <span>4. Khách / Giáo viên nợ tiền cơm (Phải thu)</span>
            </h2>
            <div className="text-3xl font-extrabold text-emerald-800 mt-0.5">
              {formatVND(debt.phai_thu_khach.tong_phai_thu_khach)}
            </div>
          </div>
        </div>

        {debt.phai_thu_khach.danh_sach.length === 0 ? (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 font-bold text-base flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
            <span>Hiện không có ai nợ tiền cơm / cỗ / căn tin ạ!</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {debt.phai_thu_khach.danh_sach.map((khach) => (
              <div
                key={khach.doi_tac}
                className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-300 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-lg font-extrabold text-emerald-950">
                    {khach.doi_tac}
                  </div>
                  <div className="text-sm text-stone-600">
                    Đã nợ {formatVND(khach.tong_ban_chiu)} · Đã trả {formatVND(khach.tong_da_thu)}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xl font-black text-rose-700">
                    {formatVND(khach.con_phai_thu)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
