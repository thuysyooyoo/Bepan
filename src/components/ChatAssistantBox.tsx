import React, { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  CheckCheck,
  HelpCircle,
  Keyboard,
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
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Tự động cuộn xuống tin nhắn mới nhất khi có câu nói mới hoặc kết quả mới
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, voiceState, liveTranscript]);

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
    <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-xs">
      {/* Thanh tiêu đề nhỏ gọn + Nút Bật/Tắt đọc to + Xóa chat */}
      <div className="shrink-0 px-3 py-2 bg-stone-50/90 border-b border-stone-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-teal-950">
          <Sparkles className="w-4 h-4 text-teal-700 shrink-0" />
          <span>Trợ lý Bếp AI</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleAutoSpeak}
            aria-label="Bật hoặc tắt tự động đọc to thẻ xác nhận"
            className={`px-2 py-1 rounded-lg border font-semibold text-xs inline-flex items-center gap-1 transition ${
              autoSpeak
                ? 'bg-teal-50 border-teal-500 text-teal-900'
                : 'bg-white border-stone-300 text-stone-500'
            }`}
          >
            {autoSpeak ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-teal-700" />
                <span>Đọc: Bật</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 text-stone-400" />
                <span>Đọc: Tắt</span>
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
              className="text-xs font-medium text-stone-400 hover:text-stone-700 px-1"
            >
              Xóa chat
            </button>
          )}
        </div>
      </div>

      {/* Vùng cuộn hội thoại độc lập: Cuộn lên xuống thoải mái xem lại lịch sử cũ */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {turns.length === 0 ? (
          <div className="rounded-xl bg-stone-50 border border-stone-200/80 p-3 text-stone-700 space-y-2">
            <div className="font-bold text-stone-900 text-xs sm:text-sm flex items-center gap-1.5">
              <span>🎤</span>
              <span>Bấm nút Micro bên dưới rồi nói tự nhiên:</span>
            </div>
            <div className="space-y-1 text-stone-800">
              <button
                type="button"
                onClick={() => submitUtterance('Hôm nay lãi bao nhiêu?', 'chat')}
                className="w-full text-left p-2 rounded-lg bg-white border border-stone-200 font-medium hover:bg-stone-100 flex items-center justify-between text-xs transition"
              >
                <span>📊 “Hôm nay lãi bao nhiêu?”</span>
                <span className="text-[10px] text-stone-400">Thử</span>
              </button>
              <button
                type="button"
                onClick={() => submitUtterance('Mua 5 cân thịt 4 trăm rưỡi', 'chat')}
                className="w-full text-left p-2 rounded-lg bg-white border border-stone-200 font-medium hover:bg-stone-100 flex items-center justify-between text-xs transition"
              >
                <span>🥩 “Mua 5 cân thịt 4 trăm rưỡi”</span>
                <span className="text-[10px] text-stone-400">Thử</span>
              </button>
              <button
                type="button"
                onClick={() => submitUtterance('Ai đang nợ mình?', 'chat')}
                className="w-full text-left p-2 rounded-lg bg-white border border-stone-200 font-medium hover:bg-stone-100 flex items-center justify-between text-xs transition"
              >
                <span>📗 “Ai đang nợ mình?”</span>
                <span className="text-[10px] text-stone-400">Thử</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {turns.map((turn) => {
              const pendingActionCount = turn.cards.filter(
                (c) =>
                  c.status === 'pending' &&
                  c.item.intent !== 'hoi' &&
                  c.item.intent !== 'khong_ro'
              ).length;

              return (
                <div key={turn.id} className="space-y-2.5">
                  {/* Bong bóng câu nói của người dùng */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-teal-800 text-white px-3.5 py-2 text-xs sm:text-sm font-medium shadow-xs">
                      <span className="mr-1 opacity-80">
                        {turn.source === 'giong' ? '🎤' : '💬'}
                      </span>
                      “{turn.userText}”
                    </div>
                  </div>

                  {/* Phản hồi của AI: trả lời câu hỏi hoặc danh sách Thẻ xác nhận */}
                  <div className="space-y-2">
                    {pendingActionCount >= 2 && (
                      <button
                        type="button"
                        disabled={savingCardId === turn.id}
                        onClick={() => handleSaveAllInTurn(turn)}
                        className="w-full py-2.5 px-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white font-bold text-xs sm:text-sm shadow-xs flex items-center justify-center gap-1.5 transition"
                      >
                        <CheckCheck className="w-4 h-4" />
                        <span>
                          {savingCardId === turn.id
                            ? 'Đang lưu tất cả...'
                            : `Đúng hết cả ${pendingActionCount} mục — Lưu tất cả`}
                        </span>
                      </button>
                    )}

                    {turn.cards.map((card) => {
                      if (card.item.intent === 'hoi' || card.item.intent === 'khong_ro') {
                        const replyText = card.item.cau_tra_loi ?? '';
                        return (
                          <div
                            key={card.cardId}
                            className="rounded-xl rounded-tl-xs bg-stone-100 border border-stone-200 p-2.5 text-xs sm:text-sm text-stone-900 whitespace-pre-line space-y-1.5"
                          >
                            <div className="font-medium leading-relaxed">{replyText}</div>
                            <button
                              type="button"
                              onClick={() => speakVietnameseText(replyText)}
                              className="px-2.5 py-1 rounded-lg bg-white border border-stone-300 text-stone-700 font-semibold text-xs inline-flex items-center gap-1 transition"
                            >
                              <Volume2 className="w-3.5 h-3.5 text-teal-700" />
                              <span>Nghe đọc lại</span>
                            </button>
                          </div>
                        );
                      }

                      if (card.status === 'saved') {
                        return (
                          <div
                            key={card.cardId}
                            className="rounded-xl bg-emerald-50 border border-emerald-400 px-3 py-2 text-emerald-950 font-bold text-xs sm:text-sm flex items-center gap-1.5"
                          >
                            <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                            <span>{card.savedSummary}</span>
                          </div>
                        );
                      }

                      if (card.status === 'cancelled') {
                        return (
                          <div
                            key={card.cardId}
                            className="rounded-lg bg-stone-100 px-3 py-1.5 text-stone-400 text-xs italic"
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
                        <div key={card.cardId} className="space-y-1.5">
                          {card.item.cau_hoi_lam_ro && card.item.lua_chon_lam_ro && (
                            <div className="rounded-xl bg-amber-50 border border-amber-400 p-2.5 space-y-2">
                              <div className="flex items-start gap-1.5 text-xs sm:text-sm font-bold text-amber-950">
                                <HelpCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                                <span>{card.item.cau_hoi_lam_ro}</span>
                              </div>
                              <div className="grid grid-cols-1 gap-1.5">
                                {card.item.lua_chon_lam_ro.map((ch) => (
                                  <button
                                    key={ch.id}
                                    type="button"
                                    onClick={() =>
                                      handleApplyChoice(turn.id, card.cardId, ch)
                                    }
                                    className="py-2 px-3 rounded-lg bg-white hover:bg-amber-100 border border-amber-500 text-amber-950 font-bold text-xs sm:text-sm text-left transition"
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
                            <div className="text-right">
                              <button
                                type="button"
                                onClick={() => handleCancelCard(turn, card.cardId)}
                                className="mt-1 text-xs font-semibold text-stone-400 hover:text-red-700 inline-flex items-center gap-1 px-1 transition"
                              >
                                <X className="w-3 h-3" />
                                <span>Bỏ không lưu thẻ này</span>
                              </button>
                            </div>
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
        <div ref={messagesEndRef} />
      </div>

      {/* Bảng chữ chạy trực tiếp trong lúc đang nói (Web Speech API vi-VN) */}
      {voiceState === 'listening' && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 bg-rose-50 border-t border-rose-300 p-2.5 space-y-2 shadow-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping shrink-0" />
              <span>Đang nghe {session?.xung_ho ?? 'ông/bà'} nói...</span>
            </div>
          </div>

          <div className="min-h-9 rounded-lg bg-white border border-rose-200 p-2 text-xs sm:text-sm font-bold text-stone-900 leading-snug">
            {liveTranscript ? (
              <span>“{liveTranscript}”</span>
            ) : (
              <span className="text-stone-400 font-normal text-xs">
                Mời nói tự nhiên, ví dụ: “Mua 5 cân thịt 4 trăm rưỡi”...
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => speechSessionRef.current?.finishNow()}
              className="py-2 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-1 transition"
            >
              ✅ Xong, gửi luôn
            </button>
            <button
              type="button"
              onClick={handleCancelVoice}
              className="py-2 px-2.5 rounded-lg bg-white hover:bg-stone-100 border border-stone-300 text-stone-700 font-semibold text-xs flex items-center justify-center gap-1 transition"
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
          className="shrink-0 bg-amber-50 border-t border-amber-300 p-2.5 space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
            <AudioLines className="w-4 h-4 text-amber-700 animate-pulse shrink-0" />
            <span>Đang ghi âm gửi AI ({recordingSeconds}s / 20s)...</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleStopFallbackRecording()}
              className="py-2 px-2.5 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs transition"
            >
              ⏹ Dừng & gửi
            </button>
            <button
              type="button"
              onClick={handleCancelVoice}
              className="py-2 px-2.5 rounded-lg bg-white border border-stone-300 text-stone-700 font-semibold text-xs transition"
            >
              ✖ Hủy
            </button>
          </div>
        </div>
      )}

      {/* Thông báo lỗi / gợi ý nếu chưa nghe rõ */}
      {voiceFeedbackMsg && (
        <div className="shrink-0 bg-amber-50 border-t border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-950 flex items-start justify-between gap-2">
          <span>💡 {voiceFeedbackMsg}</span>
          <button
            type="button"
            onClick={() => setVoiceFeedbackMsg(null)}
            className="text-stone-400 hover:text-stone-700 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Vùng nhập liệu cố định ở đáy: Nút Micro 1 chạm hoặc Bàn phím gõ chữ */}
      <div className="shrink-0 bg-stone-50 border-t border-stone-200 p-2">
        {showKeyboardInput ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitUtterance(inputText, 'chat');
            }}
            className="space-y-1.5"
          >
            <div className="flex items-center gap-1.5 bg-white border border-stone-300 focus-within:border-teal-700 rounded-xl px-2.5 py-1">
              <input
                type="text"
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Gõ yêu cầu ghi sổ tại đây..."
                className="flex-1 text-xs sm:text-sm py-1.5 px-1 bg-transparent outline-none text-stone-900 placeholder:text-stone-400 font-medium"
              />
              <button
                type="submit"
                disabled={busy || !inputText.trim()}
                className="h-8 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs inline-flex items-center gap-1 disabled:opacity-45 shrink-0 transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{busy ? '...' : 'Gửi'}</span>
              </button>
            </div>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowKeyboardInput(false)}
                className="text-stone-500 font-semibold text-xs inline-flex items-center gap-1 hover:text-stone-800"
              >
                <Mic className="w-3.5 h-3.5 text-teal-700" />
                <span>Quay lại nút Micro</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-3">
            {/* Nút Micro 1 chạm cố định ở đáy: 80px, êm ái, vừa vặn, không che khuất */}
            <button
              type="button"
              disabled={busy}
              onClick={handleTogglePrimaryMic}
              aria-label={
                voiceState === 'idle' ? 'Bấm 1 lần để bắt đầu nói' : 'Bấm để dừng nghe và gửi'
              }
              className={`w-20 h-20 rounded-full text-white shadow-md flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95 disabled:opacity-50 shrink-0 ${
                voiceState === 'idle'
                  ? 'bg-teal-700 hover:bg-teal-800 border-4 border-teal-100'
                  : 'bg-rose-600 hover:bg-rose-700 border-4 border-rose-100 ring-4 ring-rose-200 animate-pulse'
              }`}
            >
              {voiceState === 'idle' ? (
                <>
                  <Mic className="w-7 h-7" />
                  <span className="text-[10px] font-black tracking-wider">BẤM ĐỂ NÓI</span>
                </>
              ) : (
                <>
                  <Square className="w-6 h-6 fill-current" />
                  <span className="text-[10px] font-black tracking-wider">BẤM XONG</span>
                </>
              )}
            </button>

            {/* Nút bật bàn phím nhỏ gọn bên cạnh */}
            <button
              type="button"
              onClick={() => setShowKeyboardInput(true)}
              title="Gõ chữ nếu không tiện nói"
              aria-label="Mở bàn phím gõ chữ"
              className="w-10 h-10 rounded-xl bg-white hover:bg-stone-100 border border-stone-300 text-stone-600 flex items-center justify-center transition active:scale-95 shrink-0 shadow-xs"
            >
              <Keyboard className="w-5 h-5 text-stone-600" />
            </button>
          </div>
        )}
      </div>

      {/* Hộp thoại hướng dẫn mở quyền Micro trên Chrome Android */}
      <MicPermissionGuideModal
        open={showMicGuide}
        onClose={() => setShowMicGuide(false)}
        onRetryMic={handleTogglePrimaryMic}
      />
    </div>
  );
};
