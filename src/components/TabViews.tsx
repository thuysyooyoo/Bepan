import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getTodayISO } from '../domain/format';
import type { ActiveReminderCard } from '../domain/reminders';
import type { BookSnapshot, Transaction } from '../types/models';
import { CashflowView } from './CashflowView';
import { ChatAssistantBox } from './ChatAssistantBox';
import { UndoBanner, type UndoState } from './ConfirmationCard';
import { DailyLedgerList } from './DailyLedgerList';
import { DebtLedgerView } from './DebtLedgerView';
import { ManualEntryForms, type ManualFormKind } from './ManualEntryForms';
import { ProfitReportView } from './ProfitReportView';
import { ReminderBannerList } from './ReminderBannerList';

interface GhiSoTabProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onSelectDate: (isoDate: string) => void;
  activeReminders: ActiveReminderCard[];
  activeForm: { kind: ManualFormKind; editTx?: Transaction | null } | null;
  onOpenForm: (kind: ManualFormKind, editTx?: Transaction) => void;
  onCloseForm: () => void;
  onJumpToSupplierDebt: (supplierId?: string) => void;
  undoState: UndoState | null;
  onClearUndo: () => void;
  onDataChanged: (undo?: UndoState) => Promise<void>;
}

export const GhiSoTab: React.FC<GhiSoTabProps> = ({
  snapshot,
  selectedDate,
  onSelectDate,
  activeReminders,
  activeForm,
  onOpenForm,
  onCloseForm,
  onJumpToSupplierDebt,
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

      {/* Thẻ nhắc việc thông minh (tự bật đúng lịch & tự tắt ngay khi nhập đủ) */}
      <ReminderBannerList
        bookId={snapshot.book.id}
        cards={activeReminders}
        onJumpToForm={(kind) => onOpenForm(kind)}
        onJumpToSupplierDebt={onJumpToSupplierDebt}
        onDismissed={() => onDataChanged()}
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
          Hoặc bấm chọn tự nhập nhanh:
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onOpenForm('suat_an')}
            className="p-3.5 rounded-2xl bg-teal-50 hover:bg-teal-100 border-2 border-teal-600 text-left space-y-1 active:scale-[0.99]"
          >
            <div className="text-2xl"></div>
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
            <div className="text-2xl"></div>
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
            <div className="text-2xl"></div>
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
            <div className="text-2xl"></div>
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
              Trả nợ mối hàng
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('truong_chuyen')}
              className="p-3 rounded-xl bg-sky-50 border border-sky-400 font-bold text-base text-sky-950 text-left"
            >
              Trường chuyển tiền
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('tra_luong')}
              className="p-3 rounded-xl bg-amber-50 border border-amber-400 font-bold text-base text-amber-950 text-left"
            >
              Trả lương thợ
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('chi_phi_thang')}
              className="p-3 rounded-xl bg-purple-50 border border-purple-400 font-bold text-base text-purple-950 text-left"
            >
              Điện, Nước, Gas, Gia vị
            </button>
            <button
              type="button"
              onClick={() => onOpenForm('chuyen_quy')}
              className="col-span-2 p-3 rounded-xl bg-stone-100 border border-stone-400 font-bold text-base text-stone-900 text-center"
            >
              Chuyển tiền giữa các ví / Rút tiền mặt
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
  onDataChanged?: () => Promise<void>;
  focusedSupplierId?: string | null;
  onClearFocusSupplier?: () => void;
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

export const DongTienTab: React.FC<TabContentProps> = ({
  snapshot,
  selectedDate,
  onDataChanged,
}) => {
  return (
    <CashflowView
      snapshot={snapshot}
      selectedDate={selectedDate || getTodayISO()}
      onDataChanged={onDataChanged || (async () => {})}
    />
  );
};

export const SoNoTab: React.FC<TabContentProps> = ({
  snapshot,
  selectedDate,
  focusedSupplierId,
  onClearFocusSupplier,
  onDataChanged,
}) => {
  return (
    <DebtLedgerView
      snapshot={snapshot}
      selectedDate={selectedDate || getTodayISO()}
      focusedSupplierId={focusedSupplierId}
      onClearFocusSupplier={onClearFocusSupplier}
      onDataChanged={onDataChanged || (async () => {})}
    />
  );
};
