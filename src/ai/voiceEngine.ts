export type VoiceErrorCode =
  | 'permission_denied'
  | 'no_speech'
  | 'network'
  | 'unsupported'
  | 'insecure_context'
  | 'aborted'
  | 'unknown';

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string; readonly confidence?: number };
}

interface BrowserSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechResultLike;
  };
}

interface BrowserSpeechRecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function isAudioRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator?.mediaDevices?.getUserMedia)
  );
}

/**
 * Gộp danh sách kết quả từ SpeechRecognition, tự khử lỗi lặp chuỗi lũy kế trên Chrome Android
 * (VD: chunk 0 = "mua thịt", chunk 1 = "mua thịt 450 nghìn" -> giữ "mua thịt 450 nghìn" chứ không lặp đôi).
 */
export function mergeSpeechResults(results: {
  readonly length: number;
  [index: number]: SpeechResultLike;
}): { finalText: string; interimText: string; combinedText: string } {
  let finalAcc = '';
  let interimAcc = '';

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const chunk = String(res?.[0]?.transcript ?? '').trim();
    if (!chunk) continue;

    if (res.isFinal) {
      if (!finalAcc) {
        finalAcc = chunk;
      } else if (chunk.toLowerCase().startsWith(finalAcc.toLowerCase())) {
        finalAcc = chunk;
      } else if (!finalAcc.toLowerCase().endsWith(chunk.toLowerCase())) {
        finalAcc = `${finalAcc} ${chunk}`;
      }
    } else {
      interimAcc = interimAcc ? `${interimAcc} ${chunk}` : chunk;
    }
  }

  let combinedText = finalAcc;
  if (interimAcc) {
    if (!finalAcc) {
      combinedText = interimAcc;
    } else if (interimAcc.toLowerCase().startsWith(finalAcc.toLowerCase())) {
      combinedText = interimAcc;
    } else {
      combinedText = `${finalAcc} ${interimAcc}`;
    }
  }

  return {
    finalText: finalAcc.trim(),
    interimText: interimAcc.trim(),
    combinedText: combinedText.replace(/\s+/g, ' ').trim(),
  };
}

function numberToSpokenVietnameseMoney(amount: number): string {
  const n = Math.abs(Math.round(amount));
  if (n === 0) return '0 đồng';
  const trieu = Math.floor(n / 1_000_000);
  const nghin = Math.floor((n % 1_000_000) / 1_000);
  const le = n % 1_000;

  const parts: string[] = [];
  if (trieu > 0) parts.push(`${trieu} triệu`);
  if (nghin > 0) parts.push(`${nghin} nghìn`);
  if (le > 0) parts.push(`${le}`);
  return `${parts.join(' ')} đồng`;
}

/**
 * Chuẩn hóa văn bản thu được từ giọng nói tiếng Việt trên Android trước khi đưa vào AI NLU:
 *  - Đổi dấu phẩy phân cách hàng nghìn của Google Speech ("2,300,000" -> "2.300.000") để không bị tách nhầm mệnh đề
 *  - Bỏ lặp các cụm đệm ngập ngừng đầu câu ("ờ", "à", "ừm", "ghi cho bố", "ghi vào sổ"...)
 *  - Chuẩn hóa từ hay nhận diện lệch ("căng-tin" -> "căn tin", "vãn lai" -> "vãng lai", "₫" -> " đồng")
 */
export function normalizeAsrTranscript(raw: string): string {
  let text = String(raw ?? '')
    .replace(/₫/g, ' đồng ')
    .replace(/(\d),(\d{3}),(\d{3})(?![\d])/g, '$1.$2.$3')
    .replace(
      /(\d),(\d{3})(?![\d]|\s*(?:triệu|tr|củ|nghìn|ngàn|nghin|ngan|k)(?![\p{L}\p{N}]))/giu,
      '$1.$2'
    )
    .replace(/\bcăng[-\s]+tin\b/giu, 'căn tin')
    .replace(/\bcan[-\s]+tin\b/giu, 'căn tin')
    .replace(/\bvãn\s+lai\b/giu, 'vãng lai')
    .replace(/\s+/g, ' ')
    .trim();

  // Loại bỏ liên tiếp các cụm đệm mở đầu khi ông bà bấm nút nói ("ờ ghi vào sổ cho bố...")
  text = text
    .replace(
      /^(?:(?:ờ+|ừm+|à+|ừ+|ơi|này|alo|con ơi|ghi\s+(?:vào\s+)?sổ(?:\s+cho\s+(?:bố|mẹ))?|ghi\s+cho\s+(?:bố|mẹ))[\s,.:;-]+)+/iu,
      ''
    )
    .trim();

  return text;
}

/**
 * Làm sạch văn bản trước khi đọc to bằng giọng tiếng Việt (TTS) để điện thoại đọc tự nhiên:
 *  - Xóa emoji và ký tự trang trí (🍲, 🏪, 📕, 💰, •, →...)
 *  - Đổi ngày ISO "2026-10-31" -> "ngày 31 tháng 10"
 *  - Đổi kỳ tháng "2026-10" -> "tháng 10"
 *  - Đổi số tiền định dạng "1.500.000 đ" -> "1 triệu 500 nghìn đồng"
 */
export function prepareTextForVietnameseSpeech(raw: string): string {
  return String(raw ?? '')
    // Đổi số tiền kiểu "1.200.000 đ" / "450.000 đ" sang lời nói tự nhiên
    .replace(/([+-]?)(\d{1,3}(?:\.\d{3})+)\s*(?:đ|đồng|₫)/giu, (_, sign, digits) => {
      const num = Number(String(digits).replace(/\./g, ''));
      if (!Number.isFinite(num)) return `${digits} đồng`;
      const prefix = sign === '-' ? 'âm ' : '';
      return `${prefix}${numberToSpokenVietnameseMoney(num)}`;
    })
    // Đổi (Ngày) YYYY-MM-DD -> ngày D tháng M (không lặp chữ "Ngày ngày")
    .replace(/(?:ngày\s+)?\b(\d{4})-(\d{2})-(\d{2})\b/giu, (_, _y, m, d) => {
      return `ngày ${Number(d)} tháng ${Number(m)}`;
    })
    // Đổi (Tháng) YYYY-MM -> tháng M
    .replace(/(?:tháng\s+)?\b(\d{4})-(\d{2})\b/giu, (_, _y, m) => {
      return `tháng ${Number(m)}`;
    })
    // Đổi dấu trừ toán học thành chữ "trừ"
    .replace(/\s+[−-]\s+/g, ', trừ ')
    .replace(/→/g, ', ra ')
    // Xóa emoji biểu tượng để Google TTS không đọc tên icon
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .replace(/[•·✓✕✖]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phát âm báo nhẹ + rung nhẹ khi bắt đầu / kết thúc nghe (an toàn tuyệt đối nếu trình duyệt chặn)
 */
export function playGentleMicFeedback(kind: 'start' | 'stop'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'start' ? 35 : [25, 40, 25]);
    }
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'start' ? 587.33 : 440; // D5 khi bật, A4 khi dừng
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 180);
  } catch {
    // Bỏ qua trong môi trường test hoặc trình duyệt không có WebAudio
  }
}

export interface SpeechSessionOptions {
  silenceTimeoutMs?: number;
  maxDurationMs?: number;
  onStart?: () => void;
  onTranscriptChange?: (liveText: string, isFinalChunk: boolean) => void;
  onComplete: (finalCleanText: string) => void;
  onError: (code: VoiceErrorCode, message: string) => void;
}

export interface ActiveSpeechSession {
  /** Dừng nghe và chốt câu vừa nói để gửi AI ngay */
  finishNow: () => void;
  /** Hủy bỏ hoàn toàn, không gửi câu đang nói dở */
  cancel: () => void;
}

/**
 * Khởi chạy phiên nhận diện giọng nói tiếng Việt 1 chạm (Web Speech API `vi-VN`):
 *  - Chữ hiện chạy trực tiếp trong lúc nói
 *  - Tự động dừng & chốt câu khi ông bà ngừng nói `silenceTimeoutMs` (mặc định 2.4 giây)
 */
export function startVietnameseSpeechSession(
  options: SpeechSessionOptions
): ActiveSpeechSession | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    options.onError(
      'insecure_context',
      'Micro chỉ hoạt động trên kết nối bảo mật HTTPS (như link Demo GitHub/Netlify) hoặc localhost.'
    );
    return null;
  }

  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    options.onError(
      'unsupported',
      'Trình duyệt này không hỗ trợ nhận diện giọng nói trực tiếp. Hãy mở bằng Chrome hoặc bấm nút Ghi âm gửi AI.'
    );
    return null;
  }

  const silenceMs = options.silenceTimeoutMs ?? 2400;
  const maxMs = options.maxDurationMs ?? 28000;

  const recognition = new Ctor();
  recognition.lang = 'vi-VN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let latestCombined = '';
  let settled = false;
  let cancelled = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  const finalizeWithSuccess = () => {
    if (settled || cancelled) return;
    settled = true;
    clearTimers();
    try {
      recognition.stop();
    } catch {
      // ignore
    }
    playGentleMicFeedback('stop');
    const normalized = normalizeAsrTranscript(latestCombined);
    if (normalized) {
      options.onComplete(normalized);
    } else {
      options.onError(
        'no_speech',
        'Con chưa nghe thấy tiếng nói. Ông/bà bấm lại nút Micro và nói gần điện thoại hơn một chút nhé!'
      );
    }
  };

  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (latestCombined.trim()) {
        finalizeWithSuccess();
      }
    }, silenceMs);
  };

  recognition.onstart = () => {
    playGentleMicFeedback('start');
    options.onStart?.();
    maxTimer = setTimeout(() => {
      finalizeWithSuccess();
    }, maxMs);
  };

  recognition.onresult = (event) => {
    if (settled || cancelled) return;
    const merged = mergeSpeechResults(event.results);
    latestCombined = merged.combinedText;
    const lastIdx = event.results.length - 1;
    const isFinalChunk = lastIdx >= 0 ? Boolean(event.results[lastIdx]?.isFinal) : false;
    options.onTranscriptChange?.(latestCombined, isFinalChunk);

    if (latestCombined) {
      resetSilenceTimer();
    }
  };

  recognition.onerror = (event) => {
    if (settled || cancelled) return;
    clearTimers();

    const rawErr = String(event.error || '').toLowerCase();
    // Nếu đã thu được chữ rồi mà gặp no-speech lúc cuối câu -> vẫn chốt thành công!
    if (rawErr === 'no-speech' && latestCombined.trim()) {
      finalizeWithSuccess();
      return;
    }

    settled = true;
    if (rawErr === 'not-allowed' || rawErr === 'service-not-allowed') {
      options.onError(
        'permission_denied',
        'Trình duyệt đang chặn quyền Micro. Ông/bà làm theo hướng dẫn 3 bước trên màn hình để bật Micro nhé!'
      );
    } else if (rawErr === 'no-speech') {
      options.onError(
        'no_speech',
        'Chưa nghe thấy giọng nói. Ông/bà bấm Micro rồi nói luôn nhé!'
      );
    } else if (rawErr === 'network') {
      options.onError(
        'network',
        'Mạng yếu nên bộ nhận giọng của điện thoại bị ngắt. Ông/bà thử lại hoặc bấm Ghi âm gửi AI nhé!'
      );
    } else if (rawErr === 'aborted') {
      options.onError('aborted', 'Đã dừng nghe.');
    } else {
      options.onError(
        'unknown',
        'Không bật được nhận diện giọng nói. Ông/bà thử lại hoặc dùng nút Ghi âm gửi AI nhé!'
      );
    }
  };

  recognition.onend = () => {
    if (settled || cancelled) return;
    if (latestCombined.trim()) {
      finalizeWithSuccess();
    } else {
      settled = true;
      clearTimers();
      options.onError(
        'no_speech',
        'Đã dừng nghe mà chưa có câu nói nào. Ông/bà bấm Micro để nói lại nhé!'
      );
    }
  };

  try {
    recognition.start();
  } catch {
    clearTimers();
    options.onError(
      'unknown',
      'Không khởi động được Micro lúc này. Ông/bà đợi 1 giây rồi bấm lại nhé!'
    );
    return null;
  }

  return {
    finishNow: () => {
      finalizeWithSuccess();
    },
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      settled = true;
      clearTimers();
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}

export interface RecordedAudioPayload {
  base64: string;
  mimeType: string;
  durationMs: number;
}

export interface ActiveAudioFallbackRecorder {
  stopAndGetAudio: () => Promise<RecordedAudioPayload>;
  cancel: () => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Dự phòng: Ghi âm trực tiếp bằng MediaRecorder để gửi file âm thanh lên Gemini 2.5 Flash
 * khi trình duyệt không có Web Speech API hoặc nhận diện giọng mặc định kém.
 */
export async function startAudioFallbackRecording(options: {
  onPermissionDenied?: () => void;
}): Promise<ActiveAudioFallbackRecorder | null> {
  if (!isAudioRecorderSupported()) {
    return null;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    options.onPermissionDenied?.();
    return null;
  }

  const candidateTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  const supportedMime =
    candidateTypes.find((t) =>
      typeof MediaRecorder.isTypeSupported === 'function'
        ? MediaRecorder.isTypeSupported(t)
        : false
    ) ?? '';

  const recorder = supportedMime
    ? new MediaRecorder(stream, { mimeType: supportedMime })
    : new MediaRecorder(stream);

  const chunks: BlobPart[] = [];
  const startedAt = Date.now();

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  playGentleMicFeedback('start');
  recorder.start();

  const stopTracks = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  return {
    stopAndGetAudio: () =>
      new Promise<RecordedAudioPayload>((resolve, reject) => {
        recorder.onstop = async () => {
          stopTracks();
          playGentleMicFeedback('stop');
          try {
            const finalMime = recorder.mimeType || supportedMime || 'audio/webm';
            const blob = new Blob(chunks, { type: finalMime });
            const buf = await blob.arrayBuffer();
            resolve({
              base64: arrayBufferToBase64(buf),
              mimeType: finalMime.split(';')[0] || 'audio/webm',
              durationMs: Date.now() - startedAt,
            });
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = () => {
          stopTracks();
          reject(new Error('Lỗi ghi âm'));
        };
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }),
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {
        // ignore
      }
      stopTracks();
    },
  };
}
