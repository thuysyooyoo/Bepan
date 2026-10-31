import React, { useState } from 'react';
import {
  Wallet as WalletIcon,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  computeDebtAndPayables,
  computeWalletBalances,
} from '../domain/accounting';
import { formatVND, getTodayISO, getYearMonth } from '../domain/format';
import type { BookSnapshot, Transaction } from '../types/models';
import { ChatAssistantBox } from './ChatAssistantBox';
import { UndoBanner, type UndoState } from './ConfirmationCard';
import { DailyLedgerList } from './DailyLedgerList';
import { ManualEntryForms, type ManualFormKind } from './ManualEntryForms';
import { ProfitReportView } from './ProfitReportView';

interface GhiSoTabProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onSelectDate: (isoDate: string) => void;
  activeForm: { kind: ManualFormKind; editTx?: Transaction | null } | null;
  onOpenForm: (kind: ManualFormKind, editTx?: Transaction) => void;
  onCloseForm: () => void;
  undoState: UndoState | null;
  onClearUndo: () => void;
  onDataChanged: (undo?: UndoState) => Promise<void>;
}

export const GhiSoTab: React.FC<GhiSoTabProps> = ({
  snapshot,
  selectedDate,
  onSelectDate,
  activeForm,
  onOpenForm,
  onCloseForm,
  undoState,
  onClearUndo,
  onDataChanged,
}) => {
  const [showMoreActions, setShowMoreActions] = useState(false);

  if (activeForm) {
    return (
      <ManualEntryForms
        kind={activeForm.kind}
        selectedDate={selectedDate}
        snapshot={snapshot}
        editingTx={activeForm.editTx}
        onCancel={onCloseForm}
        onSaved={async (undo) => {
          onCloseForm();
          await onDataChanged(undo);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Thanh hoàn tác tức thì sau mỗi lần lưu / xóa */}
      <UndoBanner
        undoState={undoState}
        onDismiss={onClearUndo}
        onUndone={async () => {
          onClearUndo();
          await onDataChanged();
        }}
      />

      {/* Trợ lý Chat AI tiếng Việt ở vị trí trung tâm (kiểu Rolly) */}
      <ChatAssistantBox
        snapshot={snapshot}
        selectedDate={selectedDate}
        onOpenManualForm={(kind, draftTx) => onOpenForm(kind, draftTx)}
        onCommitted={async (undo) => {
          await onDataChanged(undo);
        }}
      />

      {/* 4 việc hằng ngày bấm 1 chạm chữ to (Tự nhập dự phòng song song Chat AI) */}
      <div className="rounded-3xl bg-white border-2 border-stone-200 p-4 shadow-xs space-y-3">
        <div className="text-lg font-extrabold text-stone-800">
          ✍️ Hoặc bấm chọn tự nhập nhanh:
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onOpenForm('suat_an')}
            className="p-3.5 rounded-2xl bg-teal-50 hover:bg-teal-100 border-2 border-teal-600 text-left space-y-1 active:scale-[0.99]"
          >
            <div className="text-2xl">🍚</div>
            <div className="text-lg font-extrabold text-teal-950 leading-snug">
              Báo suất ăn
            </div>
            <div className="text-sm text-teal-800 font-medium">Có nút Giống hôm qua</div>
          </button>

          <button
            type="button"
            onClick={() => onOpenForm('chi')}
            className="p-3.5 rounded-2xl bg-orange-50 hover:bg-orange-100 border-2 border-orange-500 text-left space-y-1 active:scale-[0.99]"
          >
            <div className="text-2xl">🥩</div>
            <div className="text-lg font-extrabold text-orange-950 leading-snug">
              Chi đi chợ / Nhập hàng
            </div>
            <div className="text-sm text-orange-800 font-medium">Trả luôn hoặc Ghi nợ</div>
          </button>

          <button
            type="button"
            onClick={() => onOpenForm('thu_cuoi_ngay')}
            className="p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-600 text-left space-y-1 active:scale-[0.99]"
          >
            <div className="text-2xl">💵</div>
            <div className="text-lg font-extrabold text-emerald-950 leading-snug">
              Thu cuối ngày
            </div>
            <div className="text-sm text-emerald-800 font-medium">TM + CK Chị Nhàn</div>
          </button>

          <button
            type="button"
            onClick={() => onOpenForm('cham_cong')}
            className="p-3.5 rounded-2xl bg-sky-50 hover:bg-sky-100 border-2 border-sky-500 text-left space-y-1 active:scale-[0.99]"
          >
            <div className="text-2xl">👷</div>
            <div className="text-lg font-extrabold text-sky-950 leading-snug">
              Chấm công thợ
            </div>
            <div className="text-sm text-sky-800 font-medium">Đủ / Nửa buổi / Nghỉ</div>
          </button>
        </div>

        {/* Các việc định kỳ / trả nợ / chuyển quỹ */}
        <button
          type="button"
          onClick={() => setShowMoreActions((v) => !v)}
          className="w-full py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 font-bold text-base flex items-center justify-between"
        >
          <span>Các mục khác: Trả nợ · Trường chuyển · Lương · Điện nước...</span>
          {showMoreActions ? (
            <ChevronUp className="w-5 h-5 shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 shrink-0" />
          )}
        </button>

        {showMoreActions && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenForm('tra_no')}
              className="p-3 rounded-xl bg-rose-50 border border-rose-400 font-bold text-base text-rose-950 text-left"
            >
              🤝 Trả nợ mối hàng
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('truong_chuyen')}
              className="p-3 rounded-xl bg-sky-50 border border-sky-400 font-bold text-base text-sky-950 text-left"
            >
              🏫 Trường chuyển tiền
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('tra_luong')}
              className="p-3 rounded-xl bg-amber-50 border border-amber-400 font-bold text-base text-amber-950 text-left"
            >
              💰 Trả lương thợ
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('chi_phi_thang')}
              className="p-3 rounded-xl bg-purple-50 border border-purple-400 font-bold text-base text-purple-950 text-left"
            >
              ⚡ Điện, Nước, Gas, Gia vị
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('chuyen_quy')}
              className="col-span-2 p-3 rounded-xl bg-stone-100 border border-stone-400 font-bold text-base text-stone-900 text-center"
            >
              🔄 Chuyển tiền giữa các ví / Rút tiền mặt
            </button>
          </div>
        )}
      </div>

      {/* Sổ ghi chép theo ngày (xem, sửa, xóa mềm, khôi phục) */}
      <DailyLedgerList
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        snapshot={snapshot}
        onOpenManualForm={onOpenForm}
        onMutated={onDataChanged}
      />
    </div>
  );
};

interface TabContentProps {
  snapshot: BookSnapshot;
  selectedDate?: string;
  onSelectDate?: (isoDate: string) => void;
  onJumpToForm?: (kind: ManualFormKind) => void;
}

export const HomNayTab: React.FC<TabContentProps> = ({
  snapshot,
  selectedDate,
  onSelectDate,
  onJumpToForm,
}) => {
  return (
    <ProfitReportView
      snapshot={snapshot}
      selectedDate={selectedDate || getTodayISO()}
      onSelectDate={onSelectDate}
      onJumpToForm={onJumpToForm}
    />
  );
};

export const DongTienTab: React.FC<TabContentProps> = ({ snapshot }) => {
  const balances = computeWalletBalances(snapshot.wallets, snapshot.transactions, snapshot.book.id);
  const tongTienThucTe = balances.reduce((s, b) => s + b.so_du_hien_tai, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-teal-800 text-white p-5 shadow-sm">
        <div className="text-lg opacity-90">Tổng tiền thực có ({snapshot.book.ten})</div>
        <div className="text-3xl font-extrabold mt-1">{formatVND(tongTienThucTe)}</div>
        <div className="text-base opacity-85 mt-1">
          100% thực thu thực chi (không trộn tiền mua chịu hay công nợ)
        </div>
      </div>

      <div className="space-y-3">
        {balances.map(({ wallet, so_du_hien_tai, tong_tien_vao, tong_tien_ra }) => (
          <div
            key={wallet.id}
            className="rounded-2xl bg-white border-2 border-stone-200 p-4 space-y-2 shadow-xs"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center shrink-0">
                  <WalletIcon className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-bold text-stone-900 truncate">{wallet.ten_vi}</div>
                  <div className="text-base text-stone-600 truncate">{wallet.chu_tai_khoan}</div>
                </div>
              </div>
              <div className="text-xl font-extrabold text-stone-900 shrink-0">
                {formatVND(so_du_hien_tai)}
              </div>
            </div>
            <div className="flex justify-between text-sm text-stone-600 pt-1 border-t border-stone-100">
              <span>Đầu kỳ: {formatVND(wallet.so_du_dau_ky)}</span>
              <span className="text-emerald-700 font-semibold">+{formatVND(tong_tien_vao)}</span>
              <span className="text-red-700 font-semibold">-{formatVND(tong_tien_ra)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SoNoTab: React.FC<TabContentProps> = ({
  snapshot,
  selectedDate,
  onJumpToForm,
}) => {
  const kyThang = getYearMonth(selectedDate || getTodayISO());
  const debt = computeDebtAndPayables(snapshot, kyThang);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border-2 border-rose-300 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xl font-extrabold text-rose-900">
            📕 Nợ mối hàng (Mua chịu)
          </div>
          {onJumpToForm && (
            <button
              type="button"
              onClick={() => onJumpToForm('tra_no')}
              className="px-3.5 py-1.5 rounded-xl bg-rose-700 text-white font-bold text-base"
            >
              Trả nợ
            </button>
          )}
        </div>
        <div className="text-3xl font-extrabold text-rose-700">
          {formatVND(debt.nha_cung_cap.tong_no_ncc)}
        </div>
        <div className="space-y-2">
          {debt.nha_cung_cap.danh_sach.map((item) => (
            <div
              key={item.supplier.id}
              className="flex items-center justify-between py-2 px-3 rounded-xl bg-stone-100 text-lg"
            >
              <span className="font-semibold text-stone-800">{item.supplier.ten_ncc}</span>
              <span className="font-bold text-rose-800">{formatVND(item.con_no)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white border-2 border-amber-300 p-4 shadow-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xl font-extrabold text-amber-900">
            <Users className="w-6 h-6" />
            Lương thợ phải trả ({kyThang})
          </div>
          {onJumpToForm && (
            <button
              type="button"
              onClick={() => onJumpToForm('tra_luong')}
              className="px-3.5 py-1.5 rounded-xl bg-amber-600 text-white font-bold text-base"
            >
              Trả lương
            </button>
          )}
        </div>
        <div className="text-2xl font-extrabold text-amber-800">
          {formatVND(debt.luong_tho_ky_nay.con_phai_tra)}
        </div>
        <div className="space-y-1 text-base text-stone-700">
          {debt.luong_tho_ky_nay.chi_tiet_tho.map((w) => (
            <div key={w.worker.id} className="flex justify-between">
              <span>
                • {w.worker.ho_ten} ({w.tong_cong} công)
              </span>
              <strong>{formatVND(w.con_lai)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white border-2 border-sky-300 p-4 shadow-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xl font-extrabold text-sky-900">
            🏫 Tiền trường dự kiến ({kyThang})
          </div>
          {onJumpToForm && (
            <button
              type="button"
              onClick={() => onJumpToForm('truong_chuyen')}
              className="px-3.5 py-1.5 rounded-xl bg-sky-700 text-white font-bold text-base"
            >
              Đã nhận
            </button>
          )}
        </div>
        <div className="text-2xl font-extrabold text-sky-800">
          {formatVND(debt.tien_truong_ky_nay.con_cho_chuyen)}
        </div>
        <div className="text-base text-stone-600">
          Đã nấu: <strong>{debt.tien_truong_ky_nay.tong_suat_truong} suất</strong> · Đã chuyển về:{' '}
          <strong>{formatVND(debt.tien_truong_ky_nay.truong_da_chuyen)}</strong>
        </div>
      </div>
    </div>
  );
};
