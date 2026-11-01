import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import { computeDailyMealRevenue } from '../domain/accounting';
import {
  formatVND,
  formatVietnameseDate,
  getTodayISO,
  shiftDateISO,
} from '../domain/format';
import type { BookSnapshot, Transaction } from '../types/models';
import type { ManualFormKind } from './ManualEntryForms';
import type { UndoState } from './ConfirmationCard';

interface DailyLedgerListProps {
  selectedDate: string;
  onSelectDate: (isoDate: string) => void;
  snapshot: BookSnapshot;
  onOpenManualForm: (kind: ManualFormKind, editTx?: Transaction) => void;
  onMutated: (undo?: UndoState) => Promise<void>;
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

export const DailyLedgerList: React.FC<DailyLedgerListProps> = ({
  selectedDate,
  onSelectDate,
  snapshot,
  onOpenManualForm,
  onMutated,
}) => {
  const { session } = useAuth();
  const [showDeleted, setShowDeleted] = useState(false);
  const today = getTodayISO();
  const bookId = snapshot.book.id;

  const mealRev = computeDailyMealRevenue(
    snapshot.mealCounts,
    snapshot.mealPrices,
    bookId,
    selectedDate
  );

  const dayAtt = snapshot.attendance.filter(
    (a) => a.book_id === bookId && a.ngay === selectedDate && a.so_cong > 0
  );
  const tongCongNgay = dayAtt.reduce((s, a) => s + a.so_cong, 0);
  const tongTienCongNgay = dayAtt.reduce((s, a) => s + a.so_cong * a.don_gia_cong, 0);

  const dayActiveTxs = snapshot.transactions.filter(
    (t) => t.book_id === bookId && t.ngay === selectedDate && !t.da_xoa
  );
  const dayDeletedTxs = snapshot.transactions.filter(
    (t) => t.book_id === bookId && t.ngay === selectedDate && t.da_xoa
  );

  const handleSoftDelete = async (tx: Transaction) => {
    if (!session) return;
    await dbRepo.softDeleteTransaction(session, bookId, tx.id);
    await onMutated({
      message: `Đã xóa "${tx.ghi_chu || 'giao dịch'}" (${formatVND(tx.so_tien)})`,
      undoFn: async () => {
        await dbRepo.restoreTransaction(session, bookId, tx.id);
      },
    });
  };

  const handleRestore = async (tx: Transaction) => {
    if (!session) return;
    await dbRepo.restoreTransaction(session, bookId, tx.id);
    await onMutated();
  };

  const hasNothingToday =
    mealRev.suat_truong === 0 &&
    mealRev.suat_vang_lai === 0 &&
    dayAtt.length === 0 &&
    dayActiveTxs.length === 0;

  return (
    <div className="space-y-3">
      {/* Thanh chuyển ngày to rõ */}
      <div className="rounded-2xl bg-white border-2 border-stone-300 p-3 shadow-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectDate(shiftDateISO(selectedDate, -1))}
            aria-label="Hôm trước"
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <div className="text-center flex-1">
            <div className="text-lg font-extrabold text-stone-900">
              Sổ ngày: {formatVietnameseDate(selectedDate)}
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && onSelectDate(e.target.value)}
              className="mt-1 text-base font-semibold text-teal-800 bg-teal-50 px-2.5 py-0.5 rounded-lg border border-teal-200"
            />
          </div>

          <button
            type="button"
            onClick={() => onSelectDate(shiftDateISO(selectedDate, 1))}
            aria-label="Hôm sau"
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>

        {selectedDate !== today && (
          <button
            type="button"
            onClick={() => onSelectDate(today)}
            className="w-full py-2 rounded-xl bg-teal-700 text-white font-bold text-base"
          >
            Quay về Hôm nay ({today})
          </button>
        )}
      </div>

      {hasNothingToday ? (
        <div className="rounded-2xl bg-white border border-dashed border-stone-400 p-6 text-center text-lg text-stone-600">
          Ngày này chưa có mục ghi chép nào ạ. Ông/bà bấm các nút bên trên để ghi sổ nhé!
        </div>
      ) : (
        <div className="space-y-3">
          {/* 1. Thẻ suất ăn trong ngày */}
          {(mealRev.suat_truong > 0 || mealRev.suat_vang_lai > 0) && (
            <div className="rounded-2xl bg-white border-2 border-teal-500 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold text-teal-900">
                  Suất ăn: {mealRev.suat_truong} trường
                  {mealRev.suat_vang_lai > 0 ? ` + ${mealRev.suat_vang_lai} vãng lai` : ''}
                </div>
                <div className="text-base text-stone-600 mt-0.5">
                  Sáng {mealRev.chi_tiet_bua.sang.suat_truong} · Trưa{' '}
                  {mealRev.chi_tiet_bua.trua.suat_truong} · Tối{' '}
                  {mealRev.chi_tiet_bua.toi.suat_truong} →{' '}
                  <strong className="text-teal-800">
                    {formatVND(mealRev.tong_doanh_thu_suat_an)}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenManualForm('suat_an')}
                className="px-3.5 py-2 rounded-xl bg-stone-100 border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                <Pencil className="w-4 h-4" />
                Sửa
              </button>
            </div>
          )}

          {/* 2. Thẻ chấm công trong ngày */}
          {dayAtt.length > 0 && (
            <div className="rounded-2xl bg-white border-2 border-sky-400 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold text-sky-950">
                  Phụ bếp đi làm: {tongCongNgay} công
                </div>
                <div className="text-base text-stone-600 mt-0.5">
                  Chi phí công hôm nay:{' '}
                  <strong className="text-orange-800">{formatVND(tongTienCongNgay)}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenManualForm('cham_cong')}
                className="px-3.5 py-2 rounded-xl bg-stone-100 border border-stone-300 font-bold text-base text-stone-800 inline-flex items-center gap-1 shrink-0"
              >
                <Pencil className="w-4 h-4" />
                Sửa
              </button>
            </div>
          )}

          {/* 3. Các dòng giao dịch thu/chi/nợ/chuyển quỹ */}
          {dayActiveTxs.map((tx) => {
            const cat = snapshot.categories.find((c) => c.id === tx.category_id);
            const wallet = snapshot.wallets.find((w) => w.id === tx.wallet_id);
            const supplier = snapshot.suppliers.find((s) => s.id === tx.supplier_id);

            const isIncome =
              tx.loai === 'thu_cuoi_ngay' || tx.loai === 'thu' || tx.loai === 'truong_chuyen';
            const isCreditBuy = tx.loai === 'chi_no';
            const amountColor = isIncome
              ? 'text-emerald-800'
              : isCreditBuy
              ? 'text-rose-700'
              : tx.loai === 'chuyen_quy'
              ? 'text-teal-800'
              : 'text-orange-800';

            const subLine = isCreditBuy
              ? `Mua chịu: ${supplier?.ten_ncc ?? 'Mối hàng'}`
              : tx.loai === 'tra_no'
              ? `Trả nợ ${supplier?.ten_ncc ?? ''} · ${wallet?.ten_vi ?? ''}`
              : tx.loai === 'chuyen_quy'
              ? `Chuyển quỹ (${wallet?.ten_vi ?? ''})`
              : wallet?.ten_vi ?? '';

            return (
              <div
                key={tx.id}
                className="rounded-2xl bg-white border-2 border-stone-200 p-4 shadow-xs space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-lg font-extrabold text-stone-900">
                      {cat?.icon ?? ''} {tx.ghi_chu || cat?.ten_danh_muc}
                    </div>
                    <div className="text-base text-stone-600 mt-0.5">{subLine}</div>
                  </div>
                  <div className={`text-xl font-black shrink-0 ${amountColor}`}>
                    {isIncome ? '+' : tx.loai === 'chuyen_quy' ? '' : '-'}
                    {formatVND(tx.so_tien)}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() =>
                      onOpenManualForm(
                        mapTransactionToFormKind(tx, snapshot),
                        tx.loai === 'thu_cuoi_ngay' ? undefined : tx
                      )
                    }
                    className="px-3.5 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-base text-stone-800 inline-flex items-center gap-1"
                  >
                    <Pencil className="w-4 h-4" />
                    Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSoftDelete(tx)}
                    className="px-3.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 font-bold text-base text-red-800 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Xóa
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Khu vực khôi phục giao dịch đã xóa mềm trong ngày */}
      {dayDeletedTxs.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowDeleted((v) => !v)}
            className="text-base font-bold text-stone-600 underline"
          >
            {showDeleted
              ? 'Ẩn các mục đã xóa'
              : `Xem mục đã xóa trong ngày (${dayDeletedTxs.length})`}
          </button>

          {showDeleted && (
            <div className="mt-2 space-y-2">
              {dayDeletedTxs.map((tx) => (
                <div
                  key={tx.id}
                  className="rounded-xl bg-stone-200/70 border border-stone-300 p-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-base font-bold text-stone-700 line-through truncate">
                      {tx.ghi_chu} — {formatVND(tx.so_tien)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestore(tx)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-stone-400 font-bold text-base text-teal-800 inline-flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Khôi phục
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
