import React from 'react';
import { Check, Pencil, RotateCcw, Volume2 } from 'lucide-react';
import { prepareTextForVietnameseSpeech } from '../ai/voiceEngine';
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
  needsClarification?: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}

export function stopVietnameseSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

export function speakVietnameseText(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const cleanSpeech = prepareTextForVietnameseSpeech(text);
  if (!cleanSpeech) return;

  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(cleanSpeech);
    utter.lang = 'vi-VN';
    utter.rate = 0.94; // Chậm rãi, rõ ràng cho ông bà dễ nghe

    const voices = window.speechSynthesis.getVoices?.() ?? [];
    const viVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith('vi') && v.localService) ??
      voices.find((v) => v.lang.toLowerCase().startsWith('vi'));
    if (viVoice) {
      utter.voice = viVoice;
    }

    window.speechSynthesis.speak(utter);
  } catch {
    // Bỏ qua nếu trình duyệt không hỗ trợ đọc giọng nói
  }
}

export const ConfirmationCard: React.FC<ConfirmationCardProps> = ({
  data,
  saving = false,
  needsClarification = false,
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
      className={`rounded-2xl bg-white border-2 ${style.border} p-3.5 shadow-sm space-y-2.5`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${style.badgeBg}`}>
          {data.badge}
        </span>
        <button
          type="button"
          onClick={() => speakVietnameseText(data.spokenText)}
          className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs inline-flex items-center gap-1 transition"
        >
          <Volume2 className="w-3.5 h-3.5 text-teal-700" />
          <span>Nghe đọc lại</span>
        </button>
      </div>

      <div>
        <div className="text-base font-bold text-stone-900 leading-snug">{data.title}</div>
        <div className="text-xs font-medium text-stone-500 mt-0.5">{data.dateLabel}</div>
      </div>

      {/* Ô số tiền gọn gàng, rõ ràng, không nuốt màn hình */}
      <div className={`rounded-xl p-2.5 border border-stone-200/80 ${style.boxBg}`}>
        {data.headlineAmount !== null ? (
          <>
            <div className={`text-2xl font-black tracking-tight ${style.amountText}`}>
              {formatVND(data.headlineAmount)}
            </div>
            <div className="text-xs font-semibold text-stone-600 mt-0.5">
              (Gọn: {formatCompactVND(data.headlineAmount)})
            </div>
          </>
        ) : null}
        {data.headlineSubtext && (
          <div className="text-sm font-bold text-stone-900 mt-0.5">
            {data.headlineSubtext}
          </div>
        )}
      </div>

      {/* Chi tiết từng dòng */}
      <div className="space-y-1.5 border-t border-b border-stone-200/80 py-2 text-xs sm:text-sm">
        {data.rows.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <span className="text-stone-500 font-medium">{r.label}:</span>
            <span
              className={`text-right ${
                r.highlight ? 'font-black text-stone-950' : 'font-semibold text-stone-800'
              }`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>

      {/* Giải thích dễ hiểu cách ghi vào 3 sổ */}
      <div className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs text-stone-600 font-medium leading-relaxed">
        {data.bookImpactNote}
      </div>

      {/* 2 nút hành động gọn gàng, chuẩn bấm ngón tay */}
      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          type="button"
          disabled={saving || needsClarification}
          onClick={onConfirm}
          className={`py-2.5 px-3 rounded-xl font-bold text-sm shadow-xs flex items-center justify-center gap-1.5 transition ${
            needsClarification
              ? 'bg-amber-100 text-amber-900 border border-amber-300 opacity-90 cursor-not-allowed'
              : 'bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] text-white disabled:opacity-50'
          }`}
        >
          <Check className="w-4 h-4 stroke-[3]" />
          <span>
            {saving
              ? 'Đang lưu...'
              : needsClarification
              ? 'Chọn hình thức ở trên'
              : 'Lưu sổ ngay'}
          </span>
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={onEdit}
          className="py-2.5 px-3 rounded-xl bg-white hover:bg-stone-50 active:scale-[0.98] border border-stone-300 text-stone-700 font-bold text-sm flex items-center justify-center gap-1.5 transition"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>Sửa lại</span>
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
