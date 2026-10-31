import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCheck,
  HelpCircle,
  Mic,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  buildActionCardFromIntent,
  buildTurnSpokenSummary,
  parseUserAudioUtterance,
  parseUserUtterance,
} from '../ai/chatEngine';
import type { AIParseResult, ClarificationChoice, ParsedIntentItem } from '../ai/intentSchema';
import {
  isAudioRecorderSupported,
  isWebSpeechSupported,
  startAudioFallbackRecording,
  startVietnameseSpeechSession,
  type ActiveAudioFallbackRecorder,
  type ActiveSpeechSession,
} from '../ai/voiceEngine';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import type { BookSnapshot, EntrySource, Transaction } from '../types/models';
import {
  ConfirmationCard,
  speakVietnameseText,
  stopVietnameseSpeech,
  type UndoState,
} from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';
import { MicPermissionGuideModal } from './MicPermissionGuideModal';

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
  onOpenManualForm: (kind: ManualFormKind, draftTx?: Transaction) => void;
  onCommitted: (undo: UndoState) => Promise<void>;
}

const QUICK_PROMPTS = [
  'Hôm nay lãi bao nhiêu?',
  'Đang nợ những ai?',
  'Tiền mặt còn bao nhiêu?',
  'Suất ăn giống hôm qua',
];

const AUTO_TTS_STORAGE_KEY = 'sobep_auto_tts_v1';

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

  // Trạng thái Giọng nói & Đọc to thẻ xác nhận (Phiên 4)
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_TTS_STORAGE_KEY);
      return saved === null ? true : saved === '1';
    } catch {
      return true;
    }
  });
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'recording_fallback'>(
    'idle'
  );
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceFeedbackMsg, setVoiceFeedbackMsg] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [showMicGuide, setShowMicGuide] = useState(false);

  const speechSessionRef = useRef<ActiveSpeechSession | null>(null);
  const fallbackRecorderRef = useRef<ActiveAudioFallbackRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      speechSessionRef.current?.cancel();
      fallbackRecorderRef.current?.cancel();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      stopVietnameseSpeech();
    };
  }, []);

  const toggleAutoSpeak = () => {
    setAutoSpeak((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_TTS_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      if (!next) {
        stopVietnameseSpeech();
      }
      return next;
    });
  };

  const appendParsedTurn = async (
    displayUserText: string,
    parsed: AIParseResult,
    source: 'chat' | 'giong'
  ) => {
    if (!session) return;
    const chatLog = await dbRepo.addChatLog(session, {
      book_id: snapshot.book.id,
      nguoi_dung: session.profile_id,
      nguon: source,
      cau_noi: displayUserText,
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
      ...prev.slice(-8),
      {
        id: turnId,
        userText: displayUserText,
        source,
        logId: chatLog.id,
        cards,
      },
    ]);

    // Tự động đọc to Thẻ xác nhận / câu trả lời bằng tiếng Việt
    if (autoSpeak) {
      const summary = buildTurnSpokenSummary(parsed.items, snapshot, displayUserText);
      if (summary) {
        speakVietnameseText(summary);
      }
    }
  };

  const submitUtterance = async (rawText: string, source: 'chat' | 'giong' = 'chat') => {
    const clean = rawText.trim();
    if (!clean || !session || busy) return;

    setBusy(true);
    setVoiceFeedbackMsg(null);
    if (source === 'chat') {
      setInputText('');
    }

    try {
      const parsed = await parseUserUtterance(clean, snapshot, selectedDate);
      await appendParsedTurn(parsed.raw_text || clean, parsed, source);
    } finally {
      setBusy(false);
    }
  };

  // --- BẮT ĐẦU / DỪNG NHẬN DIỆN GIỌNG NÓI 1 CHẠM (WEB SPEECH API vi-VN) ---
  const handleTogglePrimaryMic = () => {
    if (busy) return;

    // Đang nghe -> bấm lần nữa để chốt câu ngay lập tức
    if (voiceState === 'listening') {
      speechSessionRef.current?.finishNow();
      return;
    }

    // Đang ghi âm dự phòng -> dừng và gửi AI
    if (voiceState === 'recording_fallback') {
      void handleStopFallbackRecording();
      return;
    }

    // Nếu trình duyệt không có Web Speech API -> tự chuyển sang Ghi âm dự phòng gửi Gemini
    if (!isWebSpeechSupported()) {
      if (isAudioRecorderSupported()) {
        void handleStartFallbackRecording();
      } else {
        setVoiceFeedbackMsg(
          'Trình duyệt này chưa hỗ trợ Micro trực tiếp. Ông/bà hãy mở bằng ứng dụng Google Chrome trên điện thoại nhé!'
        );
      }
      return;
    }

    stopVietnameseSpeech();
    setVoiceFeedbackMsg(null);
    setLiveTranscript('');
    setVoiceState('listening');

    const active = startVietnameseSpeechSession({
      silenceTimeoutMs: 2400,
      maxDurationMs: 28000,
      onTranscriptChange: (live) => {
        setLiveTranscript(live);
      },
      onComplete: (finalCleanText) => {
        speechSessionRef.current = null;
        setVoiceState('idle');
        setLiveTranscript('');
        void submitUtterance(finalCleanText, 'giong');
      },
      onError: (code, message) => {
        speechSessionRef.current = null;
        setVoiceState('idle');
        setLiveTranscript('');
        if (code !== 'aborted') {
          setVoiceFeedbackMsg(message);
        }
        if (code === 'permission_denied' || code === 'insecure_context') {
          setShowMicGuide(true);
        }
      },
    });

    if (!active) {
      setVoiceState('idle');
      return;
    }
    speechSessionRef.current = active;
  };

  const handleCancelVoice = () => {
    speechSessionRef.current?.cancel();
    speechSessionRef.current = null;
    fallbackRecorderRef.current?.cancel();
    fallbackRecorderRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState('idle');
    setLiveTranscript('');
    setRecordingSeconds(0);
  };

  // --- DỰ PHÒNG GHI ÂM FILE AUDIO GỬI GEMINI KHI MÔI TRƯỜNG BẾP ỒN ---
  const handleStartFallbackRecording = async () => {
    if (busy || voiceState !== 'idle') return;
    stopVietnameseSpeech();
    setVoiceFeedbackMsg(null);

    const rec = await startAudioFallbackRecording({
      onPermissionDenied: () => {
        setVoiceFeedbackMsg(
          'Trình duyệt đang chặn quyền Micro. Ông/bà xem hướng dẫn mở quyền Micro trên màn hình nhé!'
        );
        setShowMicGuide(true);
      },
    });

    if (!rec) {
      if (!isAudioRecorderSupported()) {
        setVoiceFeedbackMsg('Thiết bị không hỗ trợ ghi âm dự phòng.');
      }
      return;
    }

    fallbackRecorderRef.current = rec;
    setRecordingSeconds(0);
    setVoiceState('recording_fallback');

    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((prev) => {
        if (prev + 1 >= 20) {
          void handleStopFallbackRecording();
          return 20;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const handleStopFallbackRecording = async () => {
    const rec = fallbackRecorderRef.current;
    if (!rec || !session) return;

    fallbackRecorderRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState('idle');
    setRecordingSeconds(0);
    setBusy(true);

    try {
      const audioPayload = await rec.stopAndGetAudio();
      const parsed = await parseUserAudioUtterance(
        audioPayload.base64,
        audioPayload.mimeType,
        snapshot,
        selectedDate
      );
      await appendParsedTurn(parsed.raw_text, parsed, 'giong');
    } catch {
      setVoiceFeedbackMsg('Không xử lý được đoạn ghi âm. Ông/bà bấm Micro nói lại giúp con nhé!');
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
            const nextItem: ParsedIntentItem = {
              ...c.item,
              ...choice.patch,
              cau_hoi_lam_ro: undefined,
              lua_chon_lam_ro: undefined,
            };
            if (autoSpeak) {
              const built = buildActionCardFromIntent(nextItem, snapshot, t.userText);
              if (built) {
                speakVietnameseText(built.preview.spokenText);
              }
            }
            return {
              ...c,
              item: nextItem,
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
      {/* Thanh tiêu đề + Nút Bật/Tắt đọc to giọng Việt */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xl font-extrabold text-teal-900">
          <Sparkles className="w-6 h-6 text-teal-700 shrink-0" />
          Nói hoặc Nhắn tin ghi sổ
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAutoSpeak}
            aria-label="Bật hoặc tắt tự động đọc to thẻ xác nhận"
            className={`px-3 py-1.5 rounded-xl border font-bold text-sm inline-flex items-center gap-1.5 ${
              autoSpeak
                ? 'bg-teal-50 border-teal-500 text-teal-900'
                : 'bg-stone-100 border-stone-300 text-stone-600'
            }`}
          >
            {autoSpeak ? (
              <>
                <Volume2 className="w-4 h-4 text-teal-700" />
                Đọc to: BẬT
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-stone-500" />
                Đọc to: TẮT
              </>
            )}
          </button>

          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => {
                stopVietnameseSpeech();
                setTurns([]);
              }}
              className="text-sm font-bold text-stone-500 underline px-1"
            >
              Xóa chat
            </button>
          )}
        </div>
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
          <div className="font-bold text-stone-900">
            🎤 Bấm nút Micro tròn to bên dưới rồi nói tự nhiên:
          </div>
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
                    <span className="mr-1.5 opacity-85">
                      {turn.source === 'giong' ? '🎤' : '💬'}
                    </span>
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
                            Nghe đọc lại
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

      {/* Bảng chữ chạy trực tiếp trong lúc ông bà đang nói (Web Speech API vi-VN) */}
      {voiceState === 'listening' && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-rose-50 border-3 border-rose-500 p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-lg font-extrabold text-rose-900">
              <span className="w-3.5 h-3.5 rounded-full bg-rose-600 animate-ping shrink-0" />
              Đang nghe {session?.xung_ho ?? 'ông/bà'} nói... (Ngừng nói tự gửi)
            </div>
          </div>

          <div className="min-h-14 rounded-xl bg-white border border-rose-200 p-3 text-2xl font-extrabold text-stone-950 leading-snug">
            {liveTranscript ? (
              <span>“{liveTranscript}”</span>
            ) : (
              <span className="text-stone-400 font-semibold text-lg">
                Mời nói tự nhiên, ví dụ: “Mua 5 cân thịt 4 trăm rưỡi”...
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => speechSessionRef.current?.finishNow()}
              className="py-3 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-lg"
            >
              ✅ Xong, gửi luôn
            </button>
            <button
              type="button"
              onClick={handleCancelVoice}
              className="py-3 px-3 rounded-xl bg-white hover:bg-stone-100 border-2 border-stone-400 text-stone-800 font-bold text-lg"
            >
              ✖ Hủy nói
            </button>
          </div>
        </div>
      )}

      {/* Bảng trạng thái Ghi âm dự phòng gửi Gemini */}
      {voiceState === 'recording_fallback' && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-amber-50 border-3 border-amber-500 p-4 space-y-3 shadow-sm"
        >
          <div className="flex items-center gap-2 text-lg font-extrabold text-amber-950">
            <AudioLines className="w-6 h-6 text-amber-700 animate-pulse shrink-0" />
            Đang ghi âm gửi AI ({recordingSeconds}s / 20s)...
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void handleStopFallbackRecording()}
              className="py-3 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-lg"
            >
              ⏹ Dừng & gửi AI
            </button>
            <button
              type="button"
              onClick={handleCancelVoice}
              className="py-3 px-3 rounded-xl bg-white border-2 border-stone-400 text-stone-800 font-bold text-lg"
            >
              ✖ Hủy
            </button>
          </div>
        </div>
      )}

      {/* Thông báo lỗi / gợi ý nếu chưa nghe rõ */}
      {voiceFeedbackMsg && (
        <div className="rounded-2xl bg-amber-50 border-2 border-amber-400 p-3.5 text-base font-bold text-amber-950 flex items-start justify-between gap-2">
          <span>💡 {voiceFeedbackMsg}</span>
          <button
            type="button"
            onClick={() => setVoiceFeedbackMsg(null)}
            className="text-stone-500 font-extrabold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Ô nhập chữ + Nút Gửi + Nút Micro 1 chạm khổng lồ >= 112px (w-28 h-28) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitUtterance(inputText, 'chat');
        }}
        className="space-y-3 pt-1"
      >
        <div className="flex items-center gap-2 bg-stone-50 border-2 border-stone-400 focus-within:border-teal-700 rounded-2xl px-3 py-1.5">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Hoặc gõ câu ghi sổ tại đây..."
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

        {/* Cụm nút Micro 1 chạm khổng lồ (112px x 112px > 96px chuẩn người lớn tuổi) */}
        <div className="flex flex-col items-center gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={handleTogglePrimaryMic}
            aria-label={
              voiceState === 'idle' ? 'Bấm 1 lần để bắt đầu nói' : 'Bấm để dừng nghe và gửi'
            }
            className={`w-28 h-28 rounded-full text-white shadow-lg flex flex-col items-center justify-center gap-1 transition-transform active:scale-95 disabled:opacity-50 ${
              voiceState === 'idle'
                ? 'bg-teal-700 hover:bg-teal-800 border-4 border-teal-200'
                : 'bg-rose-600 hover:bg-rose-700 border-4 border-rose-200 ring-8 ring-rose-100 animate-pulse'
            }`}
          >
            {voiceState === 'idle' ? (
              <>
                <Mic className="w-11 h-11" />
                <span className="text-sm font-black tracking-wide">BẤM ĐỂ NÓI</span>
              </>
            ) : (
              <>
                <Square className="w-9 h-9 fill-current" />
                <span className="text-xs font-black tracking-wide">BẤM XONG</span>
              </>
            )}
          </button>

          {/* 2 nút phụ trợ nhỏ gọn: Ghi âm dự phòng gửi AI & Hướng dẫn bật quyền Micro Chrome Android */}
          <div className="flex items-center justify-center gap-3 flex-wrap text-sm">
            {voiceState === 'idle' && isAudioRecorderSupported() && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleStartFallbackRecording()}
                className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 font-bold inline-flex items-center gap-1.5"
              >
                <AudioLines className="w-4 h-4 text-teal-700" />
                Chỗ ồn? Ghi âm gửi AI
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowMicGuide(true)}
              className="px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-700 font-bold inline-flex items-center gap-1"
            >
              <HelpCircle className="w-4 h-4 text-teal-700" />
              Cách bật Micro điện thoại
            </button>
          </div>
        </div>
      </form>

      {/* Hộp thoại hướng dẫn mở quyền Micro trên Chrome Android */}
      <MicPermissionGuideModal
        open={showMicGuide}
        onClose={() => setShowMicGuide(false)}
        onRetryMic={handleTogglePrimaryMic}
      />
    </div>
  );
};
