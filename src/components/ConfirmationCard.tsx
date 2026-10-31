import React from 'react';
import { Check, Pencil, RotateCcw, Volume2 } from 'lucide-react';
import { formatCompactVND, formatVND } from '../domain/format';

export type ConfirmationTone = 'income' | 'expense' | 'debt' | 'info';

export interface ConfirmationPreviewData {
  badge: string;
  tone: ConfirmationTone;
  title: string;
  headlineAmount: number | null;
  headlineSubtext?: string;
  dateLabel: string;
  rows: Array<{
    label: string;
    value: string;
    highlight?: boolean;
  }>;
  bookImpactNote: string;
  spokenText: string;
}

interface ConfirmationCardProps {
  data: ConfirmationPreviewData;
  saving?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}

export function speakVietnameseText(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'vi-VN';
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch {
    // Bỏ qua nếu trình duyệt không hỗ trợ đọc giọng nói
  }
}

export const ConfirmationCard: React.FC<ConfirmationCardProps> = ({
  data,
  saving = false,
  onConfirm,
  onEdit,
}) => {
  const toneClasses: Record<
    ConfirmationTone,
    { border: string; badgeBg: string; amountText: string; boxBg: string }
  > = {
    income: {
      border: 'border-emerald-600',
      badgeBg: 'bg-emerald-700 text-white',
      amountText: 'text-emerald-800',
      boxBg: 'bg-emerald-50/80',
    },
    expense: {
      border: 'border-orange-600',
      badgeBg: 'bg-orange-700 text-white',
      amountText: 'text-orange-800',
      boxBg: 'bg-orange-50/80',
    },
    debt: {
      border: 'border-rose-600',
      badgeBg: 'bg-rose-700 text-white',
      amountText: 'text-rose-800',
      boxBg: 'bg-rose-50/80',
    },
    info: {
      border: 'border-teal-600',
      badgeBg: 'bg-teal-700 text-white',
      amountText: 'text-teal-900',
      boxBg: 'bg-teal-50/80',
    },
  };

  const style = toneClasses[data.tone];

  return (
    <div
      role="region"
      aria-label="Thẻ kiểm tra trước khi lưu"
      className={`rounded-3xl bg-white border-3 ${style.border} p-5 shadow-md space-y-4`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`px-3.5 py-1 rounded-xl text-base font-extrabold ${style.badgeBg}`}>
          {data.badge}
        </span>
        <button
          type="button"
          onClick={() => speakVietnameseText(data.spokenText)}
          className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-base inline-flex items-center gap-1.5"
        >
          <Volume2 className="w-5 h-5 text-teal-700" />
          Nghe đọc lại
        </button>
      </div>

      <div>
        <div className="text-2xl font-extrabold text-stone-900 leading-snug">{data.title}</div>
        <div className="text-base font-semibold text-stone-600 mt-0.5">{data.dateLabel}</div>
      </div>

      {/* Ô số tiền khổng lồ để ông bà nhìn rõ không nhầm số 0 */}
      <div className={`rounded-2xl p-4 border border-stone-200 ${style.boxBg}`}>
        {data.headlineAmount !== null ? (
          <>
            <div className={`text-4xl font-black tracking-tight ${style.amountText}`}>
              {formatVND(data.headlineAmount)}
            </div>
            <div className="text-lg font-bold text-stone-700 mt-1">
              (Bằng chữ gọn: {formatCompactVND(data.headlineAmount)})
            </div>
          </>
        ) : null}
        {data.headlineSubtext && (
          <div className="text-xl font-extrabold text-stone-900 mt-1">
            {data.headlineSubtext}
          </div>
        )}
      </div>

      {/* Chi tiết từng dòng */}
      <div className="space-y-2 border-t border-b border-stone-200 py-3">
        {data.rows.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-3 text-lg">
            <span className="text-stone-600 font-medium">{r.label}:</span>
            <span
              className={`text-right ${
                r.highlight ? 'font-extrabold text-stone-950' : 'font-bold text-stone-800'
              }`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>

      {/* Giải thích dễ hiểu cách ghi vào 3 sổ */}
      <div className="rounded-xl bg-stone-100 px-3.5 py-2.5 text-base text-stone-700 font-medium leading-relaxed">
        {data.bookImpactNote}
      </div>

      {/* 2 nút hành động cỡ lớn */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <button
          type="button"
          disabled={saving}
          onClick={onConfirm}
          className="min-h-15 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white font-extrabold text-xl px-4 py-3.5 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Check className="w-7 h-7 stroke-[3]" />
          {saving ? 'Đang lưu...' : 'Đúng rồi, Lưu sổ'}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={onEdit}
          className="min-h-14 rounded-2xl bg-white hover:bg-stone-100 border-2 border-stone-400 text-stone-900 font-bold text-xl px-4 py-3 flex items-center justify-center gap-2"
        >
          <Pencil className="w-6 h-6" />
          Quay lại sửa
        </button>
      </div>
    </div>
  );
};

export interface UndoState {
  message: string;
  undoFn: () => Promise<void>;
}

export const UndoBanner: React.FC<{
  undoState: UndoState | null;
  onDismiss: () => void;
  onUndone: () => void;
}> = ({ undoState, onDismiss, onUndone }) => {
  const [busy, setBusy] = React.useState(false);

  if (!undoState) return null;

  const handleUndo = async () => {
    setBusy(true);
    try {
      await undoState.undoFn();
      onUndone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="rounded-2xl bg-emerald-900 text-white p-4 shadow-md flex flex-col gap-2.5 border-2 border-emerald-400"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-lg font-bold">✓ {undoState.message}</div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-sm underline opacity-80 hover:opacity-100 shrink-0"
        >
          Đóng
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={handleUndo}
        className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-extrabold text-lg inline-flex items-center justify-center gap-2"
      >
        <RotateCcw className="w-5 h-5" />
        {busy ? 'Đang hoàn tác...' : 'Vừa ghi nhầm, xóa đi'}
      </button>
    </div>
  );
};
