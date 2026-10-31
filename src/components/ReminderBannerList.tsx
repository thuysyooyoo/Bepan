import React, { useState } from 'react';
import { BellRing, Volume2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import type { ActiveReminderCard } from '../domain/reminders';
import { formatVND, getTodayISO } from '../domain/format';
import type { BookId } from '../types/models';
import { speakVietnameseText } from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';

interface ReminderBannerListProps {
  bookId: BookId;
  cards: ActiveReminderCard[];
  onJumpToForm: (kind: ManualFormKind) => void;
  onJumpToSupplierDebt: (supplierId?: string) => void;
  onDismissed: () => Promise<void>;
}

export const ReminderBannerList: React.FC<ReminderBannerListProps> = ({
  bookId,
  cards,
  onJumpToForm,
  onJumpToSupplierDebt,
  onDismissed,
}) => {
  const { session } = useAuth();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (cards.length === 0) return null;

  const handleDismiss = async (card: ActiveReminderCard) => {
    if (!session) return;
    setBusyKey(card.key);
    try {
      await dbRepo.upsertReminder(session, {
        book_id: bookId,
        loai_nhac: card.loai_nhac,
        ky_thang: card.ky_thang,
        tieu_de: card.tieu_de,
        noi_dung: card.noi_dung,
        so_tien_du_kien: card.so_tien_du_kien,
        ngay_bat_dau_nhac: getTodayISO(),
        trang_thai: 'bo_qua',
      });
      await onDismissed();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section aria-label="Nhắc việc định kỳ" className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-lg font-extrabold text-amber-950">
          <BellRing className="w-6 h-6 text-amber-600 shrink-0" />
          <span>Nhắc việc cần lưu ý ({cards.length})</span>
        </div>
      </div>

      {cards.map((card) => {
        const themeClass =
          card.muc_do === 'khan'
            ? 'bg-rose-50 border-rose-500 text-rose-950'
            : card.muc_do === 'quan_trong'
            ? 'bg-amber-50 border-amber-500 text-amber-950'
            : 'bg-teal-50 border-teal-600 text-teal-950';

        const btnClass =
          card.muc_do === 'khan'
            ? 'bg-rose-700 hover:bg-rose-800 text-white'
            : card.muc_do === 'quan_trong'
            ? 'bg-amber-700 hover:bg-amber-800 text-white'
            : 'bg-teal-800 hover:bg-teal-900 text-white';

        return (
          <div
            key={card.key}
            className={`rounded-3xl border-2 p-4 shadow-xs space-y-2.5 ${themeClass}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-lg font-extrabold leading-snug">
                {card.icon} {card.tieu_de}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => speakVietnameseText(card.spoken_text)}
                  aria-label="Nghe đọc thẻ nhắc"
                  className="p-2 rounded-xl bg-white/80 hover:bg-white border border-stone-300 text-stone-800"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={busyKey === card.key}
                  onClick={() => handleDismiss(card)}
                  title="Tạm ẩn nhắc nhở kỳ này"
                  aria-label="Bỏ qua nhắc nhở này"
                  className="p-2 rounded-xl bg-white/80 hover:bg-white border border-stone-300 text-stone-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {typeof card.so_tien_du_kien === 'number' && card.so_tien_du_kien > 0 && (
              <div className="text-2xl font-extrabold">
                {formatVND(card.so_tien_du_kien)}
              </div>
            )}

            <p className="text-base leading-relaxed opacity-95">{card.noi_dung}</p>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (card.action_target.type === 'form') {
                    onJumpToForm(card.action_target.kind);
                  } else {
                    onJumpToSupplierDebt(card.action_target.supplierId);
                  }
                }}
                className={`flex-1 min-h-[48px] px-4 py-2.5 rounded-2xl font-extrabold text-base transition active:scale-[0.99] ${btnClass}`}
              >
                {card.action_label}
              </button>

              <button
                type="button"
                disabled={busyKey === card.key}
                onClick={() => handleDismiss(card)}
                className="min-h-[48px] px-3.5 py-2.5 rounded-2xl bg-white/90 hover:bg-white border border-stone-300 text-stone-700 font-bold text-sm shrink-0"
              >
                {card.loai_nhac === 'nhap_so_ngay' ? 'Hôm nay nghỉ' : 'Tạm ẩn'}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
};
