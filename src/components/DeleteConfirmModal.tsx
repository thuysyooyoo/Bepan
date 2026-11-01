import React, { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Trash2, X } from 'lucide-react';
import { formatCompactVND, formatVND } from '../domain/format';

export interface DeleteTargetInfo {
  id: string;
  title: string;
  amount?: number | null;
  date?: string | null;
  subtitle?: string | null;
}

interface DeleteConfirmModalProps {
  target: DeleteTargetInfo | null;
  isOpen: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  countdownSeconds?: number;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  target,
  isOpen,
  onConfirm,
  onCancel,
  countdownSeconds = 10,
}) => {
  const [timeLeft, setTimeLeft] = useState<number>(countdownSeconds);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      setTimeLeft(countdownSeconds);
      setDeleting(false);
      return;
    }

    setTimeLeft(countdownSeconds);
    setDeleting(false);

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onCancel(); // Hết 10 giây tự động hủy và tắt popup
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, countdownSeconds, onCancel]);

  if (!isOpen || !target) return null;

  const handleConfirm = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white border border-stone-200 p-4 shadow-xl space-y-3 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <h3 id="delete-confirm-title" className="text-xs font-bold uppercase tracking-wide">
              Xác nhận xóa khoản này?
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Đóng hộp thoại"
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nội dung khoản mục cần xóa */}
        <div className="rounded-xl bg-stone-50 border border-stone-200 p-2.5 space-y-1 text-xs">
          <div className="font-bold text-stone-900 line-clamp-2">{target.title}</div>
          {target.amount !== undefined && target.amount !== null && (
            <div className="text-sm font-black text-rose-700">
              {formatVND(target.amount)}
              <span className="text-[11px] font-semibold text-stone-500 ml-1">
                ({formatCompactVND(target.amount)})
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-stone-500 pt-1 border-t border-stone-200/60">
            {target.date && <span>Ngày: {target.date}</span>}
            {target.subtitle && <span>{target.subtitle}</span>}
          </div>
        </div>

        <p className="text-xs text-stone-600 leading-relaxed">
          Khoản này sẽ được gỡ khỏi sổ sách và cập nhật lại số dư ví, lãi lỗ ngay lập tức.
        </p>

        {/* Thanh đếm ngược 10 giây */}
        <div className="flex items-center justify-between text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
            Tự động hủy sau:
          </span>
          <span className="font-extrabold text-amber-900 bg-white px-2 py-0.5 rounded border border-amber-300">
            {timeLeft}s
          </span>
        </div>

        {/* Nút hành động */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="py-2 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs"
          >
            Giữ lại (Hủy)
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleConfirm}
            className="py-2 px-3 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 shadow-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{deleting ? 'Đang xóa...' : 'Xóa thật'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
