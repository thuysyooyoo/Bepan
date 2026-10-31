import React, { useState } from 'react';
import { CheckCheck, HelpCircle, Mic, Send, Sparkles, Volume2, X } from 'lucide-react';
import { buildActionCardFromIntent, parseUserUtterance } from '../ai/chatEngine';
import type { ClarificationChoice, ParsedIntentItem } from '../ai/intentSchema';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import type { BookSnapshot, EntrySource } from '../types/models';
import {
  ConfirmationCard,
  speakVietnameseText,
  type UndoState,
} from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';

interface ChatCardEntry {
  cardId: string;
  item: ParsedIntentItem;
  status: 'pending' | 'saved' | 'cancelled';
  savedSummary?: string;
}

interface ChatTurn {
  id: string;
  userText: string;
  source: EntrySource;
  logId?: string;
  cards: ChatCardEntry[];
}

interface ChatAssistantBoxProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onOpenManualForm: (kind: ManualFormKind, draftTx?: import('../types/models').Transaction) => void;
  onCommitted: (undo: UndoState) => Promise<void>;
}

const QUICK_PROMPTS = [
  'Hôm nay lãi bao nhiêu?',
  'Đang nợ những ai?',
  'Tiền mặt còn bao nhiêu?',
  'Giống hôm qua',
];

export const ChatAssistantBox: React.FC<ChatAssistantBoxProps> = ({
  snapshot,
  selectedDate,
  onOpenManualForm,
  onCommitted,
}) => {
  const { session } = useAuth();
  const [inputText, setInputText] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  const submitUtterance = async (rawText: string, source: 'chat' | 'giong' = 'chat') => {
    const clean = rawText.trim();
    if (!clean || !session || busy) return;

    setBusy(true);
    setInputText('');

    try {
      const parsed = await parseUserUtterance(clean, snapshot, selectedDate);
      const chatLog = await dbRepo.addChatLog(session, {
        book_id: snapshot.book.id,
        nguoi_dung: session.profile_id,
        nguon: source,
        cau_noi: clean,
        ai_json: parsed,
        ket_qua: 'cho_xac_nhan',
      });

      const turnId = `turn-${Date.now()}`;
      const cards: ChatCardEntry[] = parsed.items.map((it, idx) => ({
        cardId: `${turnId}-${idx}`,
        item: it,
        status: 'pending',
      }));

      setTurns((prev) => [
        ...prev.slice(-8), // Giữ tối đa 9 lượt gần nhất cho màn hình gọn nhẹ
        {
          id: turnId,
          userText: clean,
          source,
          logId: chatLog.id,
          cards,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleApplyChoice = (
    turnId: string,
    cardId: string,
    choice: ClarificationChoice
  ) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        return {
          ...t,
          cards: t.cards.map((c) => {
            if (c.cardId !== cardId) return c;
            return {
              ...c,
              item: {
                ...c.item,
                ...choice.patch,
                cau_hoi_lam_ro: undefined,
                lua_chon_lam_ro: undefined,
              },
            };
          }),
        };
      })
    );
  };

  const handleSaveSingleCard = async (turn: ChatTurn, card: ChatCardEntry) => {
    if (!session) return;
    const built = buildActionCardFromIntent(card.item, snapshot, turn.userText);
    if (!built) return;

    setSavingCardId(card.cardId);
    try {
      const undo = await built.commit(session, turn.source);
      if (turn.logId) {
        await dbRepo.updateChatLogStatus(session, snapshot.book.id, turn.logId, 'da_luu');
      }

      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turn.id) return t;
          return {
            ...t,
            cards: t.cards.map((c) =>
              c.cardId === card.cardId
                ? { ...c, status: 'saved', savedSummary: undo.message }
                : c
            ),
          };
        })
      );

      await onCommitted(undo);
    } finally {
      setSavingCardId(null);
    }
  };

  const handleSaveAllInTurn = async (turn: ChatTurn) => {
    if (!session) return;
    const pendingActionCards = turn.cards.filter(
      (c) =>
        c.status === 'pending' &&
        c.item.intent !== 'hoi' &&
        c.item.intent !== 'khong_ro'
    );
    if (pendingActionCards.length === 0) return;

    setSavingCardId(turn.id);
    try {
      const undoFns: Array<() => Promise<void>> = [];
      for (const card of pendingActionCards) {
        const built = buildActionCardFromIntent(card.item, snapshot, turn.userText);
        if (built) {
          const u = await built.commit(session, turn.source);
          undoFns.push(u.undoFn);
        }
      }

      if (turn.logId) {
        await dbRepo.updateChatLogStatus(session, snapshot.book.id, turn.logId, 'da_luu');
      }

      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turn.id) return t;
          return {
            ...t,
            cards: t.cards.map((c) =>
              c.status === 'pending' &&
              c.item.intent !== 'hoi' &&
              c.item.intent !== 'khong_ro'
                ? { ...c, status: 'saved', savedSummary: 'Đã lưu vào sổ' }
                : c
            ),
          };
        })
      );

      await onCommitted({
        message: `Đã lưu trọn bộ ${pendingActionCards.length} mục vào sổ`,
        undoFn: async () => {
          for (const fn of undoFns.reverse()) {
            await fn();
          }
        },
      });
    } finally {
      setSavingCardId(null);
    }
  };

  const handleCancelCard = async (turn: ChatTurn, cardId: string) => {
    if (session && turn.logId) {
      await dbRepo.updateChatLogStatus(session, snapshot.book.id, turn.logId, 'huy');
    }
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turn.id
          ? {
              ...t,
              cards: t.cards.map((c) =>
                c.cardId === cardId ? { ...c, status: 'cancelled' } : c
              ),
            }
          : t
      )
    );
  };

  return (
    <div className="rounded-3xl bg-white border-2 border-teal-600 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xl font-extrabold text-teal-900">
          <Sparkles className="w-6 h-6 text-teal-700 shrink-0" />
          Nhắn tin ghi sổ nhanh
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            className="text-sm font-bold text-stone-500 underline"
          >
            Xóa màn hình chat
          </button>
        )}
      </div>

      {/* Các nút câu hỏi / lệnh mẫu 1 chạm */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => submitUtterance(q, 'chat')}
            className="px-3.5 py-1.5 rounded-full bg-teal-50 hover:bg-teal-100 border border-teal-400 text-teal-950 font-bold text-base whitespace-nowrap shrink-0"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Dòng hội thoại & Thẻ xác nhận */}
      {turns.length === 0 ? (
        <div className="rounded-2xl bg-stone-50 border border-stone-200 p-3.5 text-base text-stone-700 space-y-1">
          <div className="font-bold text-stone-900">Ông/bà gõ tự nhiên như nhắn tin:</div>
          <div>• “Sáng 150, trưa 320, tối 80, vãng lai trưa 5”</div>
          <div>• “Mua 5 cân thịt 4 trăm rưỡi, rau 300”</div>
          <div>• “Lấy thịt chị Hoa 2 triệu ghi nợ”</div>
          <div>• “Căn tin hôm nay 2 triệu 3 tiền mặt, chuyển khoản 800”</div>
        </div>
      ) : (
        <div className="space-y-4">
          {turns.map((turn) => {
            const pendingActionCount = turn.cards.filter(
              (c) =>
                c.status === 'pending' &&
                c.item.intent !== 'hoi' &&
                c.item.intent !== 'khong_ro'
            ).length;

            return (
              <div key={turn.id} className="space-y-3">
                {/* Bong bóng câu nói của ông bà */}
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-teal-800 text-white px-4 py-2.5 text-lg font-semibold shadow-xs">
                    “{turn.userText}”
                  </div>
                </div>

                {/* Phản hồi của AI: trả lời câu hỏi hoặc danh sách Thẻ xác nhận */}
                <div className="space-y-3">
                  {pendingActionCount >= 2 && (
                    <button
                      type="button"
                      disabled={savingCardId === turn.id}
                      onClick={() => handleSaveAllInTurn(turn)}
                      className="w-full py-3.5 px-4 rounded-2xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-xl shadow-sm flex items-center justify-center gap-2"
                    >
                      <CheckCheck className="w-7 h-7" />
                      {savingCardId === turn.id
                        ? 'Đang lưu tất cả...'
                        : `Đúng hết cả ${pendingActionCount} mục — Lưu tất cả`}
                    </button>
                  )}

                  {turn.cards.map((card) => {
                    // Câu hỏi báo cáo ('hoi') hoặc câu chưa rõ ('khong_ro')
                    if (card.item.intent === 'hoi' || card.item.intent === 'khong_ro') {
                      const replyText = card.item.cau_tra_loi ?? '';
                      return (
                        <div
                          key={card.cardId}
                          className="rounded-2xl rounded-tl-sm bg-stone-100 border-2 border-stone-300 p-4 text-lg text-stone-900 whitespace-pre-line space-y-2"
                        >
                          <div className="font-semibold leading-relaxed">{replyText}</div>
                          <button
                            type="button"
                            onClick={() => speakVietnameseText(replyText)}
                            className="px-3 py-1.5 rounded-xl bg-white border border-stone-300 text-stone-800 font-bold text-base inline-flex items-center gap-1.5"
                          >
                            <Volume2 className="w-5 h-5 text-teal-700" />
                            Nghe đọc
                          </button>
                        </div>
                      );
                    }

                    if (card.status === 'saved') {
                      return (
                        <div
                          key={card.cardId}
                          className="rounded-2xl bg-emerald-50 border-2 border-emerald-500 px-4 py-3 text-emerald-950 font-bold text-lg"
                        >
                          ✓ {card.savedSummary}
                        </div>
                      );
                    }

                    if (card.status === 'cancelled') {
                      return (
                        <div
                          key={card.cardId}
                          className="rounded-xl bg-stone-100 px-4 py-2 text-stone-500 text-base italic"
                        >
                          Đã bỏ qua mục này.
                        </div>
                      );
                    }

                    const built = buildActionCardFromIntent(
                      card.item,
                      snapshot,
                      turn.userText
                    );
                    if (!built) return null;

                    return (
                      <div key={card.cardId} className="space-y-2">
                        {/* Hộp nút bấm hỏi lại thông minh khi câu nói còn mơ hồ */}
                        {card.item.cau_hoi_lam_ro && card.item.lua_chon_lam_ro && (
                          <div className="rounded-2xl bg-amber-50 border-2 border-amber-500 p-3.5 space-y-2.5">
                            <div className="flex items-start gap-2 text-lg font-extrabold text-amber-950">
                              <HelpCircle className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
                              <span>{card.item.cau_hoi_lam_ro}</span>
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              {card.item.lua_chon_lam_ro.map((ch) => (
                                <button
                                  key={ch.id}
                                  type="button"
                                  onClick={() =>
                                    handleApplyChoice(turn.id, card.cardId, ch)
                                  }
                                  className="py-2.5 px-3.5 rounded-xl bg-white hover:bg-amber-100 border-2 border-amber-600 text-amber-950 font-extrabold text-base text-left"
                                >
                                  👉 {ch.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="relative">
                          <ConfirmationCard
                            data={built.preview}
                            saving={savingCardId === card.cardId}
                            onConfirm={() => handleSaveSingleCard(turn, card)}
                            onEdit={async () => {
                              if (session && turn.logId) {
                                await dbRepo.updateChatLogStatus(
                                  session,
                                  snapshot.book.id,
                                  turn.logId,
                                  'da_sua'
                                );
                              }
                              onOpenManualForm(built.manualFallbackKind, built.draftTx);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleCancelCard(turn, card.cardId)}
                            className="mt-1.5 text-base font-bold text-stone-500 hover:text-red-700 inline-flex items-center gap-1 px-2"
                          >
                            <X className="w-4 h-4" />
                            Bỏ không lưu thẻ này
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ô nhập tin nhắn + Nút Gửi to + Nút Micro >= 96px (kích hoạt giọng nói ở Phiên 4) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitUtterance(inputText, 'chat');
        }}
        className="space-y-3 pt-1"
      >
        <div className="flex items-center gap-2 bg-stone-50 border-2 border-stone-400 focus-within:border-teal-700 rounded-2xl px-3 py-1.5">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Gõ câu ghi sổ hoặc hỏi lãi..."
            className="flex-1 text-xl py-2 px-1 bg-transparent outline-none text-stone-950 placeholder:text-stone-400 font-medium"
          />
          <button
            type="submit"
            disabled={busy || !inputText.trim()}
            className="h-12 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-lg inline-flex items-center gap-1.5 disabled:opacity-45 shrink-0"
          >
            <Send className="w-5 h-5" />
            {busy ? '...' : 'Gửi'}
          </button>
        </div>

        <div className="flex items-center justify-center">
          <button
            type="button"
            disabled
            aria-label="Nút bấm nói bằng giọng (Phiên 4)"
            className="w-24 h-24 rounded-full bg-teal-700 text-white shadow-md border-4 border-teal-200 flex flex-col items-center justify-center gap-1 opacity-80"
          >
            <Mic className="w-9 h-9" />
            <span className="text-xs font-extrabold">NÓI (P.4)</span>
          </button>
        </div>
      </form>
    </div>
  );
};
