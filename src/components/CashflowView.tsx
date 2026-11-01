import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Pencil,
  Scale,
  Trash2,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import {
  computeWalletBalances,
  computeWalletReconciliationDiff,
  computeWalletTimeline,
} from '../domain/accounting';
import {
  formatCompactVND,
  formatVietnameseDate,
  formatVietnameseMonth,
  formatVND,
  getPreviousYearMonth,
  getTodayISO,
  getYearMonth,
} from '../domain/format';
import type { BookSnapshot, Transaction } from '../types/models';
import {
  ConfirmationCard,
  UndoBanner,
  type ConfirmationPreviewData,
  type UndoState,
} from './ConfirmationCard';
import { MoneyInput } from './MoneyInput';
import type { ManualFormKind } from './ManualEntryForms';

interface CashflowViewProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onDataChanged: () => Promise<void>;
  onOpenManualForm?: (kind: ManualFormKind, editTx?: Transaction) => void;
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

type ActiveTool =
  | { kind: 'dem_tien'; walletId: string }
  | { kind: 'chuyen_quy'; fromWalletId: string }
  | null;

export const CashflowView: React.FC<CashflowViewProps> = ({
  snapshot,
  selectedDate,
  onDataChanged,
  onOpenManualForm,
}) => {
  const { session } = useAuth();
  const todayISO = selectedDate || getTodayISO();
  const currentMonth = getYearMonth(todayISO);
  const prevMonth = getPreviousYearMonth(currentMonth);

  const [filterWalletId, setFilterWalletId] = useState<string | null>(null);
  const [filterMonth, setFilterMonth] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  // State cho Đếm tiền thực tế
  const [countedAmount, setCountedAmount] = useState<number>(0);
  const [hasCountedInput, setHasCountedInput] = useState<boolean>(false);
  const [reconcileNote, setReconcileNote] = useState<string>('');
  const [confirmStep, setConfirmStep] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // State cho Chuyển quỹ
  const [toWalletId, setToWalletId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<number>(0);
  const [transferNote, setTransferNote] = useState<string>('');

  const balances = useMemo(
    () =>
      computeWalletBalances(
        snapshot.wallets,
        snapshot.transactions,
        snapshot.book.id
      ),
    [snapshot.wallets, snapshot.transactions, snapshot.book.id]
  );

  const tongTienThucTe = balances.reduce((s, b) => s + b.so_du_hien_tai, 0);

  const timeline = useMemo(
    () =>
      computeWalletTimeline(snapshot, {
        walletId: filterWalletId,
        kyThang: filterMonth,
      }),
    [snapshot, filterWalletId, filterMonth]
  );

  const openReconcileTool = (walletId: string) => {
    const cur =
      balances.find((b) => b.wallet.id === walletId)?.so_du_hien_tai ?? 0;
    setActiveTool({ kind: 'dem_tien', walletId });
    setCountedAmount(Math.max(0, cur));
    setHasCountedInput(true);
    setReconcileNote('');
    setConfirmStep(false);
  };

  const openTransferTool = (fromId: string) => {
    const other =
      snapshot.wallets.find(
        (w) => w.book_id === snapshot.book.id && w.id !== fromId
      )?.id ?? '';
    setActiveTool({ kind: 'chuyen_quy', fromWalletId: fromId });
    setToWalletId(other);
    setTransferAmount(0);
    setTransferNote('');
    setConfirmStep(false);
  };

  const closeTool = () => {
    setActiveTool(null);
    setConfirmStep(false);
  };

  // Xử lý Đếm tiền thực tế (dieu_chinh_vi)
  const reconcileTarget =
    activeTool?.kind === 'dem_tien'
      ? balances.find((b) => b.wallet.id === activeTool.walletId)
      : undefined;

  const reconcileDiff = reconcileTarget
    ? computeWalletReconciliationDiff(
        reconcileTarget.so_du_hien_tai,
        countedAmount
      )
    : null;

  const reconcilePreview: ConfirmationPreviewData | null =
    reconcileTarget && reconcileDiff && reconcileDiff.chenh_lech !== 0
      ? {
          badge: 'ĐIỀU CHỈNH KIỂM ĐẾM THỰC TẾ',
          tone: reconcileDiff.chenh_lech > 0 ? 'income' : 'expense',
          title: reconcileTarget.wallet.ten_vi,
          headlineAmount: reconcileDiff.chenh_lech,
          headlineSubtext:
            reconcileDiff.chenh_lech > 0
              ? `Thừa tiền thực tế so với sổ`
              : `Hụt tiền thực tế so với sổ`,
          dateLabel: formatVietnameseDate(todayISO),
          rows: [
            {
              label: 'Số dư trên sổ trước khi đếm',
              value: formatVND(reconcileDiff.so_du_so_sach),
            },
            {
              label: 'Tiền đếm thực tế hiện có',
              value: formatVND(reconcileDiff.tien_dem_thuc_te),
              highlight: true,
            },
            {
              label: 'Chênh lệch tự điều chỉnh',
              value: formatVND(reconcileDiff.chenh_lech, true),
              highlight: true,
            },
          ],
          bookImpactNote: `Cập nhật ${
            reconcileTarget.wallet.ten_vi
          } khớp đúng ${formatVND(
            reconcileDiff.tien_dem_thuc_te
          )} · Không làm sai lệch báo cáo Lãi lỗ Bếp & Căn tin.`,
          spokenText: `Điều chỉnh ${reconcileTarget.wallet.ten_vi} theo tiền đếm thực tế ${formatCompactVND(
            reconcileDiff.tien_dem_thuc_te
          )}, lệch ${formatCompactVND(Math.abs(reconcileDiff.chenh_lech))}. Đúng không ạ?`,
        }
      : null;

  const handleSaveReconcile = async () => {
    if (!session || !reconcileTarget || !reconcileDiff || reconcileDiff.chenh_lech === 0)
      return;
    setSaving(true);
    try {
      const autoNote =
        reconcileNote.trim() ||
        `Kiểm đếm thực tế ${formatVND(
          reconcileDiff.tien_dem_thuc_te
        )} (sổ cũ ${formatVND(reconcileDiff.so_du_so_sach)})`;

      const saved = await dbRepo.addTransaction(session, {
        book_id: snapshot.book.id,
        ngay: todayISO,
        mang: 'chung',
        loai: 'dieu_chinh_vi',
        category_id: 'cat_dieu_chinh_vi',
        so_tien: reconcileDiff.chenh_lech,
        wallet_id: reconcileTarget.wallet.id,
        ghi_chu: autoNote,
        nguon: 'tay',
        nguoi_tao: session.profile_id,
      });

      closeTool();
      setUndoState({
        message: `Đã điều chỉnh ${reconcileTarget.wallet.ten_vi} về ${formatVND(
          reconcileDiff.tien_dem_thuc_te
        )}`,
        undoFn: async () => {
          await dbRepo.softDeleteTransaction(session, snapshot.book.id, saved.id);
        },
      });
      await onDataChanged();
    } finally {
      setSaving(false);
    }
  };

  // Xử lý Chuyển quỹ nội bộ (chuyen_quy)
  const transferFrom =
    activeTool?.kind === 'chuyen_quy'
      ? balances.find((b) => b.wallet.id === activeTool.fromWalletId)
      : undefined;
  const transferTo = balances.find((b) => b.wallet.id === toWalletId);

  const transferPreview: ConfirmationPreviewData | null =
    transferFrom &&
    transferTo &&
    transferFrom.wallet.id !== transferTo.wallet.id &&
    transferAmount > 0
      ? {
          badge: 'CHUYỂN QUỸ NỘI BỘ',
          tone: 'info',
          title: `${transferFrom.wallet.ten_vi} → ${transferTo.wallet.ten_vi}`,
          headlineAmount: transferAmount,
          dateLabel: formatVietnameseDate(todayISO),
          rows: [
            {
              label: 'Rút ra từ',
              value: `${transferFrom.wallet.ten_vi} (còn ${formatVND(
                transferFrom.so_du_hien_tai - transferAmount
              )})`,
              highlight: true,
            },
            {
              label: 'Đưa sang',
              value: `${transferTo.wallet.ten_vi} (thành ${formatVND(
                transferTo.so_du_hien_tai + transferAmount
              )})`,
              highlight: true,
            },
          ],
          bookImpactNote: `Chuyển tiền giữa 2 ví cùng cơ sở · Tổng tiền và Lãi lỗ không đổi.`,
          spokenText: `Chuyển ${formatCompactVND(transferAmount)} từ ${
            transferFrom.wallet.ten_vi
          } sang ${transferTo.wallet.ten_vi}. Đúng không ạ?`,
        }
      : null;

  const handleSaveTransfer = async () => {
    if (!session || !transferFrom || !transferTo || transferAmount <= 0) return;
    setSaving(true);
    try {
      const note =
        transferNote.trim() ||
        `Chuyển từ ${transferFrom.wallet.ten_vi} sang ${transferTo.wallet.ten_vi}`;
      const saved = await dbRepo.addTransaction(session, {
        book_id: snapshot.book.id,
        ngay: todayISO,
        mang: 'chung',
        loai: 'chuyen_quy',
        category_id: 'cat_chuyen_quy',
        so_tien: Math.round(transferAmount),
        wallet_id: transferFrom.wallet.id,
        to_wallet_id: transferTo.wallet.id,
        ghi_chu: note,
        nguon: 'tay',
        nguoi_tao: session.profile_id,
      });

      closeTool();
      setUndoState({
        message: `Đã chuyển ${formatVND(transferAmount)} sang ${transferTo.wallet.ten_vi}`,
        undoFn: async () => {
          await dbRepo.softDeleteTransaction(session, snapshot.book.id, saved.id);
        },
      });
      await onDataChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTimelineTx = async (txId: string, label: string) => {
    if (!session) return;
    await dbRepo.softDeleteTransaction(session, snapshot.book.id, txId);
    setUndoState({
      message: `Đã xóa: ${label}`,
      undoFn: async () => {
        await dbRepo.restoreTransaction(session, snapshot.book.id, txId);
      },
    });
    await onDataChanged();
  };

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

      {/* THẺ TỔNG TIỀN THỰC TẾ TOÀN CƠ SỞ */}
      <div className="rounded-2xl bg-teal-900 text-white p-3.5 shadow-xs space-y-1">
        <div className="text-xs font-bold opacity-90 uppercase tracking-wide">
          Tổng tiền thực có ({snapshot.book.ten})
        </div>
        <div className="text-lg font-black">{formatVND(tongTienThucTe)}</div>
        <div className="text-[11px] opacity-80">
          100% thực thu thực chi (không cộng tiền trường chưa về, không trừ mua chịu)
        </div>
      </div>

      {/* PANEL INLINE: ĐẾM TIỀN THỰC TẾ HOẶC CHUYỂN QUỸ */}
      {activeTool?.kind === 'dem_tien' && reconcileTarget && (
        <div className="rounded-3xl bg-white border-2 border-teal-700 p-4 shadow-md space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xl font-extrabold text-teal-950 flex items-center gap-2">
              <Scale className="w-6 h-6 text-teal-700" />
              <span>Đếm tiền thực tế: {reconcileTarget.wallet.ten_vi}</span>
            </div>
            <button
              type="button"
              onClick={closeTool}
              aria-label="Đóng"
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-stone-100 border border-stone-300 flex items-center justify-between text-lg">
            <span className="text-stone-700 font-semibold">Số dư trên sổ hiện tại:</span>
            <strong className="text-stone-950 text-xl">
              {formatVND(reconcileTarget.so_du_hien_tai)}
            </strong>
          </div>

          {confirmStep && reconcilePreview ? (
            <ConfirmationCard
              data={reconcilePreview}
              saving={saving}
              onConfirm={handleSaveReconcile}
              onEdit={() => setConfirmStep(false)}
            />
          ) : (
            <div className="space-y-3">
              <MoneyInput
                label="Ông/bà đếm thực tế hiện có bao nhiêu tiền?"
                value={countedAmount}
                onChange={(val) => {
                  setCountedAmount(val);
                  setHasCountedInput(true);
                }}
                placeholder="Nhập tổng tiền đếm được..."
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCountedAmount(0);
                    setHasCountedInput(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 font-bold text-base"
                >
                  Trống két (0 đ)
                </button>
                {reconcileTarget.so_du_hien_tai > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCountedAmount(reconcileTarget.so_du_hien_tai);
                      setHasCountedInput(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 font-bold text-base"
                  >
                    Bằng đúng sổ ({formatCompactVND(reconcileTarget.so_du_hien_tai)})
                  </button>
                )}
              </div>

              {hasCountedInput && reconcileDiff && (
                <>
                  {reconcileDiff.trang_thai === 'khop' ? (
                    <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-500 text-emerald-950 flex items-center gap-3">
                      <CheckCircle2 className="w-7 h-7 text-emerald-700 shrink-0" />
                      <div className="text-lg font-extrabold">
                        Khớp 100% với sổ sách! Không cần điều chỉnh.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div
                        className={`p-3.5 rounded-2xl border-2 ${
                          reconcileDiff.trang_thai === 'thua'
                            ? 'bg-sky-50 border-sky-400 text-sky-950'
                            : 'bg-rose-50 border-rose-400 text-rose-950'
                        }`}
                      >
                        <div className="text-lg font-extrabold">
                          {reconcileDiff.trang_thai === 'thua'
                            ? `Đang THỪA ${formatVND(reconcileDiff.chenh_lech)} so với sổ`
                            : `Đang HỤT ${formatVND(
                                Math.abs(reconcileDiff.chenh_lech)
                              )} so với sổ`}
                        </div>
                        <div className="text-base mt-0.5 opacity-90">
                          App sẽ ghi 1 bút toán điều chỉnh để số dư ví khớp đúng tiền thực tế.
                        </div>
                      </div>

                      <input
                        type="text"
                        value={reconcileNote}
                        onChange={(e) => setReconcileNote(e.target.value)}
                        placeholder="Ghi chú thêm (không bắt buộc, VD: tiền lẻ rơi / sót vặt)"
                        className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 text-lg text-stone-900"
                      />

                      <button
                        type="button"
                        onClick={() => setConfirmStep(true)}
                        className="w-full min-h-[54px] rounded-2xl bg-teal-800 hover:bg-teal-900 text-white font-extrabold text-lg"
                      >
                        Xem thẻ xác nhận điều chỉnh ví
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {activeTool?.kind === 'chuyen_quy' && transferFrom && (
        <div className="rounded-3xl bg-white border-2 border-sky-600 p-4 shadow-md space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xl font-extrabold text-sky-950 flex items-center gap-2">
              <ArrowLeftRight className="w-6 h-6 text-sky-700" />
              <span>Chuyển tiền từ {transferFrom.wallet.ten_vi}</span>
            </div>
            <button
              type="button"
              onClick={closeTool}
              aria-label="Đóng"
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {confirmStep && transferPreview ? (
            <ConfirmationCard
              data={transferPreview}
              saving={saving}
              onConfirm={handleSaveTransfer}
              onEdit={() => setConfirmStep(false)}
            />
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-base font-bold text-stone-700 mb-1.5">
                  Chuyển sang ví / tài khoản nào:
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {balances
                    .filter((b) => b.wallet.id !== transferFrom.wallet.id)
                    .map((b) => (
                      <button
                        key={b.wallet.id}
                        type="button"
                        onClick={() => setToWalletId(b.wallet.id)}
                        className={`p-3 rounded-2xl border-2 text-left flex items-center justify-between ${
                          toWalletId === b.wallet.id
                            ? 'bg-sky-50 border-sky-600 text-sky-950 font-extrabold'
                            : 'bg-stone-50 border-stone-300 text-stone-800 font-semibold'
                        }`}
                      >
                        <span className="text-lg">{b.wallet.ten_vi}</span>
                        <span className="text-base text-stone-600">
                          Đang có: {formatCompactVND(b.so_du_hien_tai)}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              <MoneyInput
                label="Số tiền chuyển:"
                value={transferAmount}
                onChange={setTransferAmount}
                placeholder="Nhập số tiền rút / chuyển..."
              />

              {transferFrom.so_du_hien_tai > 0 && (
                <button
                  type="button"
                  onClick={() => setTransferAmount(transferFrom.so_du_hien_tai)}
                  className="px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-400 text-sky-950 font-bold text-base"
                >
                  Chuyển toàn bộ ({formatVND(transferFrom.so_du_hien_tai)})
                </button>
              )}

              <input
                type="text"
                value={transferNote}
                onChange={(e) => setTransferNote(e.target.value)}
                placeholder="Ghi chú (VD: Chị Nhàn rút tiền mặt đưa Bố đi chợ)"
                className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 text-lg text-stone-900"
              />

              <button
                type="button"
                disabled={transferAmount <= 0 || !toWalletId}
                onClick={() => setConfirmStep(true)}
                className="w-full min-h-[54px] rounded-2xl bg-sky-700 hover:bg-sky-800 disabled:bg-stone-300 text-white font-extrabold text-lg"
              >
                Tiếp tục xác nhận chuyển quỹ
              </button>
            </div>
          )}
        </div>
      )}

      {/* DANH SÁCH 3 VÍ THỰC TẾ */}
      <div className="space-y-3">
        {balances.map(({ wallet, so_du_hien_tai, tong_tien_vao, tong_tien_ra }) => {
          const isSelected = filterWalletId === wallet.id;
          return (
            <div
              key={wallet.id}
              className={`rounded-3xl bg-white border-2 p-4 space-y-3 shadow-xs transition ${
                isSelected ? 'border-teal-700 ring-2 ring-teal-600/30' : 'border-stone-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setFilterWalletId(isSelected ? null : wallet.id)
                  }
                  className="flex items-center gap-3 min-w-0 text-left"
                >
                  <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-800 flex items-center justify-center shrink-0 border border-teal-200">
                    <WalletIcon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xl font-extrabold text-stone-900 truncate">
                      {wallet.ten_vi}
                    </div>
                    <div className="text-base text-stone-600 truncate">
                      {wallet.chu_tai_khoan}
                    </div>
                  </div>
                </button>

                <div className="text-right shrink-0">
                  <div
                    className={`text-xl font-extrabold ${
                      so_du_hien_tai >= 0 ? 'text-stone-950' : 'text-rose-700'
                    }`}
                  >
                    {formatVND(so_du_hien_tai)}
                  </div>
                  {isSelected && (
                    <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-900">
                      Đang lọc
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-2 text-sm text-stone-600 pt-2 border-t border-stone-100">
                <span>Đầu kỳ: {formatVND(wallet.so_du_dau_ky)}</span>
                <span className="text-emerald-700 font-bold">
                  Vào: +{formatVND(tong_tien_vao)}
                </span>
                <span className="text-rose-700 font-bold">
                  Ra: -{formatVND(tong_tien_ra)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => openReconcileTool(wallet.id)}
                  className="min-h-[46px] px-3 py-2 rounded-2xl bg-teal-50 hover:bg-teal-100 border border-teal-500 text-teal-950 font-extrabold text-base inline-flex items-center justify-center gap-1.5"
                >
                  <Scale className="w-4 h-4 shrink-0" />
                  <span>Đếm tiền thực tế</span>
                </button>
                <button
                  type="button"
                  onClick={() => openTransferTool(wallet.id)}
                  className="min-h-[46px] px-3 py-2 rounded-2xl bg-sky-50 hover:bg-sky-100 border border-sky-400 text-sky-950 font-extrabold text-base inline-flex items-center justify-center gap-1.5"
                >
                  <ArrowLeftRight className="w-4 h-4 shrink-0" />
                  <span>Chuyển quỹ</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* DÒNG THỜI GIAN VÀO / RA THỰC TẾ */}
      <div className="rounded-3xl bg-white border-2 border-stone-300 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold text-stone-900">
            Dòng thời gian Vào / Ra
          </h2>
          <span className="text-sm font-bold text-stone-600">
            {timeline.length} giao dịch
          </span>
        </div>

        {/* Bộ lọc Ví & Tháng */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFilterWalletId(null)}
            className={`px-3 py-1.5 rounded-full text-sm font-extrabold border ${
              filterWalletId === null
                ? 'bg-teal-800 text-white border-teal-800'
                : 'bg-stone-100 text-stone-700 border-stone-300'
            }`}
          >
            Tất cả 3 ví
          </button>
          {balances.map(({ wallet }) => (
            <button
              key={wallet.id}
              type="button"
              onClick={() =>
                setFilterWalletId(filterWalletId === wallet.id ? null : wallet.id)
              }
              className={`px-3 py-1.5 rounded-full text-sm font-extrabold border ${
                filterWalletId === wallet.id
                  ? 'bg-teal-800 text-white border-teal-800'
                  : 'bg-stone-100 text-stone-700 border-stone-300'
              }`}
            >
              {wallet.loai_vi === 'tien_mat'
                ? 'Tiền mặt'
                : wallet.loai_vi === 'tk_mo_diep'
                ? 'TK Mợ Diệp'
                : 'TK Chị Nhàn'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { key: null, label: 'Mọi tháng' },
            { key: currentMonth, label: formatVietnameseMonth(currentMonth) },
            { key: prevMonth, label: formatVietnameseMonth(prevMonth) },
          ].map((opt) => (
            <button
              key={opt.key ?? 'all'}
              type="button"
              onClick={() => setFilterMonth(opt.key)}
              className={`px-3 py-1 rounded-full text-sm font-bold border ${
                filterMonth === opt.key
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-stone-50 text-stone-700 border-stone-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {timeline.length === 0 ? (
          <div className="py-6 text-center text-base text-stone-600">
            Chưa có giao dịch tiền vào / ra nào theo bộ lọc này.
          </div>
        ) : (
          <div className="space-y-1.5 pt-0.5">
            {timeline.map((entry) => {
              const amountColor =
                entry.huong === 'vao'
                  ? 'text-emerald-700'
                  : entry.huong === 'ra'
                  ? 'text-rose-700'
                  : 'text-sky-700';

              const amountText =
                entry.huong === 'chuyen_quy'
                  ? `⇄ ${formatVND(entry.tx.so_tien)}`
                  : formatVND(entry.bien_dong, true);

              return (
                <div
                  key={entry.tx.id}
                  className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-stone-900 leading-snug">
                        {entry.tieu_de}
                      </div>
                      <div className="text-[11px] font-medium text-stone-500 mt-0.5">
                        {entry.tx.ngay.split('-').reverse().join('/')} ·{' '}
                        {entry.ten_vi_hien_thi}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`text-xs font-black ${amountColor}`}>
                        {amountText}
                      </div>
                      <div className="text-[10px] font-bold text-stone-400">
                        Dư sau GD: {formatVND(entry.so_du_sau_gd)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-stone-200/60">
                    {onOpenManualForm && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenManualForm(mapTransactionToFormKind(entry.tx, snapshot), entry.tx)
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
                        handleDeleteTimelineTx(entry.tx.id, entry.tieu_de)
                      }
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
    </div>
  );
};
