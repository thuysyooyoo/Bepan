import type {
  ConfirmationPreviewData,
  UndoState,
} from '../components/ConfirmationCard';
import type { ManualFormKind } from '../components/ManualEntryForms';
import { dbRepo, type DataRepository } from '../db';
import {
  computeDailyMealRevenue,
  computeDebtAndPayables,
  getEffectiveMealPrice,
} from '../domain/accounting';
import {
  formatCompactVND,
  formatVND,
  formatVietnameseDate,
  getYearMonth,
} from '../domain/format';
import type {
  AuthSession,
  BookSnapshot,
  EntrySource,
  MealPeriod,
  Supplier,
  Transaction,
  WalletKind,
} from '../types/models';
import type { AIParseResult, ParsedIntentItem } from './intentSchema';
import { answerReportQuestion, parseVietnameseCommandLocal, stripAccents } from './localVnNlu';
import { normalizeAsrTranscript } from './voiceEngine';
import { callCloudAi } from './cloudAiClient';
import { parseVietnameseMoney } from './vnNumberDateParser';
import type { AiSettings } from '../types/aiSettings';

export interface ChatHistoryEntry {
  userText: string;
  items?: ParsedIntentItem[];
  status?: 'pending' | 'saved' | 'cancelled';
}

export interface ParseUtteranceOptions {
  history?: ChatHistoryEntry[];
  aiSettings?: AiSettings;
}

function buildContextPayload(snapshot: BookSnapshot, referenceDate: string) {
  return {
    referenceDate,
    bookName: snapshot.book.ten,
    categories: snapshot.categories
      .filter((c) => c.nhom === 'chi')
      .map((c) => ({
        id: c.id,
        ten: c.ten_danh_muc,
        kieu_tinh: c.kieu_tinh,
        mang: c.mang_mac_dinh,
      })),
    workers: snapshot.workers
      .filter((w) => w.dang_lam)
      .map((w) => ({ id: w.id, ho_ten: w.ho_ten })),
    suppliers: snapshot.suppliers.map((s) => ({ id: s.id, ten_ncc: s.ten_ncc })),
  };
}

/**
 * Bộ lọc Hybrid Tiết Kiệm Token Thông Minh:
 * - Nếu bộ phân tích Tiếng Việt cục bộ (`localVnNlu`) đã bắt chuẩn 100% ý định rõ ràng,
 *   không có câu mơ hồ, không rơi vào danh mục dự phòng ('cat_do_kho_bep' khi không nói đồ khô)
 *   -> Trả kết quả tức thì (0ms, tốn 0 token!).
 * - Chỉ gọi Cloud Gemini (`gemini-3.8-flash` có `thinkingBudget: 0`) khi câu nói lạ, phương ngữ khó,
 *   nhiều vế phức tạp hoặc câu chưa rõ nghĩa -> Giảm 85-90% chi phí token mà vẫn cực thông minh!
 */
export function shouldDelegateToCloudGemini(
  cleanedText: string,
  localResult: AIParseResult
): boolean {
  if (!cleanedText.trim()) return false;
  if (localResult.items.length === 0) return true;
  if (cleanedText.length > 95 || localResult.items.length >= 3) return true;

  const lower = cleanedText.toLowerCase();
  const explicitDryGoods = /(đồ khô|lạc|đỗ|mộc nhĩ|hạt sen|rong biển|bột)/.test(lower);

  for (const it of localResult.items) {
    if (it.intent === 'khong_ro') return true;
    if (it.cau_hoi_lam_ro) {
      if (it.cau_hoi_lam_ro.includes('Bếp ăn hay Căn tin')) return true;
      if (!it.lua_chon_lam_ro || it.lua_chon_lam_ro.length === 0) return true;
    }
    if (
      (it.intent === 'chi' || it.intent === 'chi_no') &&
      it.category_id === 'cat_do_kho_bep' &&
      !explicitDryGoods
    ) {
      // Câu chi tiêu có mặt hàng lạ ngoài từ điển có sẵn -> nhờ Gemini phân loại chuẩn
      return true;
    }
  }

  return false;
}

export function resolveBestSupplierForCategory(
  snapshot: BookSnapshot,
  categoryId?: string
): Supplier | null {
  const bookSuppliers = snapshot.suppliers.filter(
    (s) => s.book_id === snapshot.book.id && s.dang_giao_dich
  );
  if (bookSuppliers.length === 0) return null;
  if (!categoryId) return bookSuppliers[0];

  const cat = snapshot.categories.find((c) => c.id === categoryId);
  const catNameNoAcc = stripAccents(cat?.ten_danh_muc ?? '').toLowerCase();

  const matched = bookSuppliers.find((s) => {
    const matHangNoAcc = stripAccents(s.mat_hang_chinh).toLowerCase();
    const tenNccNoAcc = stripAccents(s.ten_ncc).toLowerCase();
    return (
      (catNameNoAcc.includes('thit') && (matHangNoAcc.includes('thit') || tenNccNoAcc.includes('thit'))) ||
      (catNameNoAcc.includes('rau') && (matHangNoAcc.includes('rau') || tenNccNoAcc.includes('rau'))) ||
      (catNameNoAcc.includes('gao') && (matHangNoAcc.includes('gao') || tenNccNoAcc.includes('gao'))) ||
      (catNameNoAcc.includes('gas') && (matHangNoAcc.includes('gas') || tenNccNoAcc.includes('gas'))) ||
      (catNameNoAcc.includes('nuoc') && (matHangNoAcc.includes('nuoc') || tenNccNoAcc.includes('nuoc'))) ||
      (catNameNoAcc.includes('banh') && (matHangNoAcc.includes('banh') || tenNccNoAcc.includes('banh')))
    );
  });

  return matched ?? bookSuppliers[0];
}

/**
 * Xử lý ngữ cảnh câu nói nối tiếp / điều chỉnh lượt trước (Multi-turn Local Comprehension)
 */
export function resolveFollowUpUtterance(
  cleanedText: string,
  history: ChatHistoryEntry[],
  snapshot: BookSnapshot,
  referenceDate: string
): ParsedIntentItem[] | null {
  if (!history || history.length === 0) return null;

  // Lấy lượt trước gần nhất có action card hợp lệ
  const lastTurn = [...history].reverse().find(
    (h) =>
      h.items &&
      h.items.length > 0 &&
      h.items.some((it) => it.intent !== 'hoi' && it.intent !== 'khong_ro')
  );
  if (!lastTurn || !lastTurn.items || lastTurn.items.length === 0) return null;

  const lastItem = lastTurn.items[lastTurn.items.length - 1];
  const lower = stripAccents(cleanedText.toLowerCase()).trim();

  // 1. CÂU HỎI BÁO CÁO NỐI TIẾP
  if (
    /^(the|vay)?\s*(hom nay|nay)?\s*(lai|lo|loi|tien|no|ai no|thu|chi)/i.test(lower) ||
    lower.includes('lai bao nhieu') ||
    lower.includes('con bao nhieu tien')
  ) {
    return [answerReportQuestion(cleanedText, snapshot, referenceDate)];
  }

  // 2. THEO DÕI MUA CHỊU / GHI SỔ NỢ / CHƯA TRẢ TIỀN
  const isCreditCue =
    /(chua tra|chua tra tien|ghi no|cho vao so no|cho vao no|no nhe|tra sau|no moi|no nha cung cap|no dai ly)/i.test(
      lower
    );
  if (isCreditCue) {
    if (lastItem.intent === 'chi') {
      const sup = resolveBestSupplierForCategory(snapshot, lastItem.category_id);
      return [
        {
          ...lastItem,
          intent: 'chi_no',
          supplier_id: lastItem.supplier_id || sup?.id,
          da_thanh_toan: false,
          ghi_chu: lastItem.ghi_chu.includes('(Ghi nợ)')
            ? lastItem.ghi_chu
            : `${lastItem.ghi_chu} (Ghi nợ/Chưa trả tiền)`,
          cau_hoi_lam_ro: undefined,
          lua_chon_lam_ro: undefined,
        },
      ];
    }
    if (lastItem.intent === 'thu') {
      return [
        {
          ...lastItem,
          intent: 'ban_chiu',
          da_thanh_toan: false,
          ghi_chu: `${lastItem.ghi_chu} (Khách nợ/Chưa trả tiền)`,
          cau_hoi_lam_ro: undefined,
          lua_chon_lam_ro: undefined,
        },
      ];
    }
  }

  // 3. ĐỔI MẢNG: CĂN TIN HAY BẾP ĂN
  if (/(cho can tin|cua can tin|tinh cho can tin|vao can tin|can tin nhe)/i.test(lower)) {
    return [
      {
        ...lastItem,
        mang: 'can_tin',
        ghi_chu: `${lastItem.ghi_chu.replace(/\s*\(Căn tin\)|\s*\(Bếp ăn\)/g, '')} (Căn tin)`,
        cau_hoi_lam_ro: undefined,
        lua_chon_lam_ro: undefined,
      },
    ];
  }
  if (/(cho bep an|cua bep an|tinh cho bep an|vao bep an|bep an nhe)/i.test(lower)) {
    return [
      {
        ...lastItem,
        mang: 'bep_an',
        ghi_chu: `${lastItem.ghi_chu.replace(/\s*\(Căn tin\)|\s*\(Bếp ăn\)/g, '')} (Bếp ăn)`,
        cau_hoi_lam_ro: undefined,
        lua_chon_lam_ro: undefined,
      },
    ];
  }

  // 4. ĐỔI VÍ THANH TOÁN
  if (/(tien mat|bang tien mat|tra tien mat|vi tien mat)/i.test(lower)) {
    return [
      {
        ...lastItem,
        vi: 'tien_mat',
        cau_hoi_lam_ro: undefined,
        lua_chon_lam_ro: undefined,
      },
    ];
  }
  if (/(mo diep|tk mo diep|chuyen khoan mo diep)/i.test(lower)) {
    return [
      {
        ...lastItem,
        vi: 'tk_mo_diep',
        cau_hoi_lam_ro: undefined,
        lua_chon_lam_ro: undefined,
      },
    ];
  }
  if (/(chi nhan|tk chi nhan|chuyen khoan chi nhan)/i.test(lower)) {
    return [
      {
        ...lastItem,
        vi: 'tk_chi_nhan',
        cau_hoi_lam_ro: undefined,
        lua_chon_lam_ro: undefined,
      },
    ];
  }

  // 5. ĐỔI SỐ TIỀN ("sửa lại 500 nghìn", "sửa thành 500k", "là 480 nghìn cơ")
  if (/(sua lai|chinh lai|sua thanh|doi thanh|thanh|la|thuc ra la)\s+/i.test(lower)) {
    const newAmount = parseVietnameseMoney(cleanedText);
    if (newAmount && newAmount > 0) {
      return [
        {
          ...lastItem,
          so_tien: newAmount,
          ghi_chu: `${lastItem.ghi_chu.replace(/\d[\d.,]*\s*(đ|dong|k|nghin)?/gi, '').trim()} ${formatCompactVND(newAmount)}`.trim(),
          cau_hoi_lam_ro: undefined,
          lua_chon_lam_ro: undefined,
        },
      ];
    }
  }

  return null;
}

export async function parseUserUtterance(
  text: string,
  snapshot: BookSnapshot,
  referenceDate: string,
  options?: ParseUtteranceOptions
): Promise<AIParseResult> {
  const cleanedText = normalizeAsrTranscript(text);

  // 1. Phân tích ngữ cảnh đa lượt: câu điều chỉnh / bổ sung cho lượt trước (Multi-turn Local)
  if (options?.history && options.history.length > 0) {
    const followUpItems = resolveFollowUpUtterance(
      cleanedText,
      options.history,
      snapshot,
      referenceDate
    );
    if (followUpItems && followUpItems.length > 0) {
      return {
        engine: 'local_vn',
        raw_text: cleanedText,
        items: followUpItems,
      };
    }
  }

  // 2. Nếu có cấu hình AI đám mây (Gemini, DeepSeek, OpenAI) từ Settings và đang bật
  if (
    options?.aiSettings &&
    options.aiSettings.enabled &&
    options.aiSettings.provider !== 'local' &&
    options.aiSettings.api_key.trim()
  ) {
    try {
      const historyForCloud: Array<{ role: 'user' | 'assistant'; text: string }> = [];
      if (options.history) {
        for (const h of options.history.slice(-3)) {
          historyForCloud.push({ role: 'user', text: h.userText });
          if (h.items && h.items.length > 0) {
            const summary = h.items.map((it) => it.ghi_chu || it.intent).join('; ');
            historyForCloud.push({ role: 'assistant', text: `Đã ghi nhận: ${summary}` });
          }
        }
      }

      const cloudItems = await callCloudAi(cleanedText, {
        settings: options.aiSettings,
        snapshot,
        dateStr: referenceDate,
        history: historyForCloud,
      });

      if (cloudItems && cloudItems.length > 0) {
        const enriched = cloudItems.map((it) =>
          it.intent === 'hoi'
            ? answerReportQuestion(cleanedText, snapshot, referenceDate)
            : it
        );
        const engineType =
          options.aiSettings.provider === 'deepseek'
            ? 'deepseek'
            : options.aiSettings.provider === 'openai'
            ? 'openai'
            : 'gemini';
        return {
          engine: engineType,
          raw_text: cleanedText,
          items: enriched,
        };
      }
    } catch {
      // Rơi êm xuống Local NLU nếu lỗi mạng hoặc hết token
    }
  }

  const localResult = parseVietnameseCommandLocal(cleanedText, snapshot, referenceDate);

  const forceAlwaysGemini = import.meta.env?.VITE_GEMINI_ALWAYS === 'true';
  const geminiEnabled = import.meta.env?.VITE_ENABLE_GEMINI_API === 'true';

  if (
    geminiEnabled &&
    (forceAlwaysGemini || shouldDelegateToCloudGemini(cleanedText, localResult))
  ) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: cleanedText,
          ...buildContextPayload(snapshot, referenceDate),
        }),
      });
      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as { items?: ParsedIntentItem[] };
        if (Array.isArray(json.items) && json.items.length > 0) {
          const enriched = json.items.map((it) =>
            it.intent === 'hoi'
              ? answerReportQuestion(cleanedText, snapshot, referenceDate)
              : it
          );
          return {
            engine: 'gemini',
            raw_text: cleanedText,
            items: enriched,
          };
        }
      }
    } catch {
      // Mạng yếu, hết hạn mức Prepay hoặc chưa chạy server -> tự động rơi êm xuống Local NLU
    }
  }

  return localResult;
}

/**
 * Dự phòng: Gửi file ghi âm trực tiếp lên Gemini 3.8 Flash (/api/parse) để gỡ băng + phân tích JSON
 */
export async function parseUserAudioUtterance(
  audioBase64: string,
  audioMimeType: string,
  snapshot: BookSnapshot,
  referenceDate: string
): Promise<AIParseResult> {
  let errorCode = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        audioBase64,
        audioMimeType,
        ...buildContextPayload(snapshot, referenceDate),
      }),
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = (await res.json()) as {
        transcript?: string;
        items?: ParsedIntentItem[];
      };
      const transcript = normalizeAsrTranscript(json.transcript ?? '');
      if (Array.isArray(json.items) && json.items.length > 0) {
        const enriched = json.items.map((it) =>
          it.intent === 'hoi' && transcript
            ? answerReportQuestion(transcript, snapshot, referenceDate)
            : it
        );
        return {
          engine: 'gemini',
          raw_text: transcript || '(Ghi âm giọng nói)',
          items: enriched,
        };
      }
      if (transcript) {
        return parseVietnameseCommandLocal(transcript, snapshot, referenceDate);
      }
    } else {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      errorCode = errBody.error ?? '';
    }
  } catch {
    // Rơi xuống thông báo thân thiện bên dưới nếu đang chạy bản tĩnh
  }

  const depletedHint =
    errorCode === 'GEMINI_PREPAYMENT_DEPLETED'
      ? 'Tài khoản Gemini API hiện đang hết số dư Prepay (HTTP 402). Ông/bà hãy bấm nút Micro xanh lớn ở giữa để nói trực tiếp miễn phí 100% nhé!'
      : 'Tính năng gửi file ghi âm dự phòng cần máy chủ Gemini đang hoạt động. Trên Chrome Android, ông/bà bấm nút Micro xanh lớn để nói trực tiếp là nhận chữ ngay lập tức ạ!';

  return {
    engine: 'local_vn',
    raw_text: '(Ghi âm dự phòng)',
    items: [
      {
        intent: 'khong_ro',
        ngay: referenceDate,
        ghi_chu: '',
        cau_tra_loi: depletedHint,
      },
    ],
  };
}

/**
 * Tạo câu đọc to tiếng Việt tự nhiên cho kết quả phản hồi của 1 lượt nói / chat
 */
export function buildTurnSpokenSummary(
  items: ParsedIntentItem[],
  snapshot: BookSnapshot,
  rawSentence: string
): string {
  if (items.length === 0) return '';

  // 1. Nếu chỉ có 1 thẻ
  if (items.length === 1) {
    const first = items[0];
    if (first.intent === 'hoi' || first.intent === 'khong_ro') {
      return first.cau_tra_loi ?? '';
    }
    const built = buildActionCardFromIntent(first, snapshot, rawSentence);
    if (!built) return '';
    if (first.cau_hoi_lam_ro) {
      return `${built.preview.spokenText.replace(/\s*Đúng không ạ\?$/, '')}. ${first.cau_hoi_lam_ro}`;
    }
    return built.preview.spokenText;
  }

  // 2. Nếu câu ghép sinh ra nhiều thẻ xác nhận cùng lúc
  const parts: string[] = [];
  for (const it of items) {
    const built = buildActionCardFromIntent(it, snapshot, rawSentence);
    if (built) {
      parts.push(built.preview.spokenText.replace(/\s*Đúng không ạ\?$/, ''));
    }
  }
  if (parts.length === 0) return '';
  return `Đã nghe rõ ${parts.length} mục: ${parts.join('; ')}. Ông bà kiểm tra rồi bấm Lưu tất cả nhé!`;
}

export interface BuiltActionCard {
  preview: ConfirmationPreviewData;
  manualFallbackKind: ManualFormKind;
  draftTx?: Transaction;
  commit: (actor: AuthSession, source: EntrySource) => Promise<UndoState>;
}

function getWalletByKind(snapshot: BookSnapshot, kind?: WalletKind) {
  const target = kind ?? 'tien_mat';
  return (
    snapshot.wallets.find((w) => w.loai_vi === target) ??
    snapshot.wallets.find((w) => w.loai_vi === 'tien_mat') ??
    snapshot.wallets[0]
  );
}

/**
 * Biến 1 ParsedIntentItem thành Thẻ xác nhận chuẩn + hàm ghi CSDL có Hoàn tác 1 chạm
 */
export function buildActionCardFromIntent(
  item: ParsedIntentItem,
  snapshot: BookSnapshot,
  rawSentence: string,
  repo: DataRepository = dbRepo
): BuiltActionCard | null {
  if (item.intent === 'hoi' || item.intent === 'khong_ro') {
    return null;
  }

  const bookId = snapshot.book.id;
  const ngay = item.ngay;
  const dateLabel = formatVietnameseDate(ngay);
  const kyThang = item.ky_thang || getYearMonth(ngay);

  // 1. SUẤT ĂN TRƯỜNG / GIỐNG HÔM QUA / VÃNG LAI
  if (
    item.intent === 'suat_an' ||
    item.intent === 'giong_hom_qua' ||
    item.intent === 'vang_lai'
  ) {
    const existingDay = snapshot.mealCounts.filter(
      (m) => m.book_id === bookId && m.ngay === ngay
    );
    const getOld = (bua: MealPeriod) => existingDay.find((r) => r.bua === bua);

    const sa = item.suat_an ?? {};
    const nextCounts: Record<MealPeriod, { tr: number; vl: number }> = {
      sang: {
        tr: sa.sang_truong ?? getOld('sang')?.suat_truong ?? 0,
        vl: sa.sang_vang_lai ?? getOld('sang')?.suat_vang_lai ?? 0,
      },
      trua: {
        tr: sa.trua_truong ?? getOld('trua')?.suat_truong ?? 0,
        vl: sa.trua_vang_lai ?? getOld('trua')?.suat_vang_lai ?? 0,
      },
      toi: {
        tr: sa.toi_truong ?? getOld('toi')?.suat_truong ?? 0,
        vl: sa.toi_vang_lai ?? getOld('toi')?.suat_vang_lai ?? 0,
      },
    };

    const periods: MealPeriod[] = ['sang', 'trua', 'toi'];
    const pNames: Record<MealPeriod, string> = {
      sang: 'Bữa sáng',
      trua: 'Bữa trưa',
      toi: 'Bữa tối',
    };

    let tongTr = 0;
    let tongVl = 0;
    let tongTien = 0;
    const rows: ConfirmationPreviewData['rows'] = [];

    for (const b of periods) {
      const st = nextCounts[b].tr;
      const svl = nextCounts[b].vl;
      const dgTr = getEffectiveMealPrice(snapshot.mealPrices, bookId, b, 'truong', ngay);
      const dgVl = getEffectiveMealPrice(snapshot.mealPrices, bookId, b, 'vang_lai', ngay);
      const sub = st * dgTr + svl * dgVl;
      tongTr += st;
      tongVl += svl;
      tongTien += sub;
      if (st > 0 || svl > 0) {
        rows.push({
          label: pNames[b],
          value: `${st} trường${svl > 0 ? ` + ${svl} vãng lai` : ''} (${formatVND(sub)})`,
          highlight: true,
        });
      }
    }

    return {
      manualFallbackKind: 'suat_an',
      preview: {
        badge:
          item.intent === 'giong_hom_qua'
            ? 'SUẤT ĂN GIỐNG HÔM TRƯỚC'
            : item.intent === 'vang_lai'
            ? 'BÁO KHÁCH VÃNG LAI'
            : 'BÁO SUẤT ĂN TRONG NGÀY',
        tone: 'info',
        title: `Suất ăn ${snapshot.book.ten}`,
        headlineAmount: tongTien,
        headlineSubtext: `Trường: ${tongTr} suất${tongVl > 0 ? ` · Vãng lai: ${tongVl} suất` : ''}`,
        dateLabel,
        rows,
        bookImpactNote:
          'Tính vào Doanh thu Bếp ăn ngày · Suất trường cộng vào Tiền trường dự kiến cuối tháng.',
        spokenText: `Ghi suất ăn ngày ${ngay}: ${tongTr} suất trường${
          tongVl > 0 ? ` và ${tongVl} suất vãng lai` : ''
        }, thành tiền ${formatCompactVND(tongTien)}. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        for (const b of periods) {
          await repo.upsertMealCount(actor, {
            book_id: bookId,
            ngay,
            bua: b,
            suat_truong: nextCounts[b].tr,
            suat_vang_lai: nextCounts[b].vl,
            ghi_chu: item.ghi_chu,
            nguon: source,
            nguoi_tao: actor.profile_id,
          });
        }
        return {
          message: `Đã lưu suất ăn (${tongTr} trường${tongVl > 0 ? ` + ${tongVl} VL` : ''})`,
          undoFn: async () => {
            for (const b of periods) {
              const old = getOld(b);
              await repo.upsertMealCount(actor, {
                book_id: bookId,
                ngay,
                bua: b,
                suat_truong: old?.suat_truong ?? 0,
                suat_vang_lai: old?.suat_vang_lai ?? 0,
                ghi_chu: old?.ghi_chu ?? '',
                nguon: old?.nguon ?? source,
                nguoi_tao: actor.profile_id,
              });
            }
          },
        };
      },
    };
  }

  // 2. THU CUỐI NGÀY (CÁCH A: CĂN TIN + VÃNG LAI)
  if (item.intent === 'thu_can_tin' && item.thu_cuoi_ngay) {
    const tm = item.thu_cuoi_ngay.tien_mat;
    const ck = item.thu_cuoi_ngay.chuyen_khoan;
    const tong = tm + ck;
    const mealRev = computeDailyMealRevenue(
      snapshot.mealCounts,
      snapshot.mealPrices,
      bookId,
      ngay
    );
    const vlMoney = mealRev.doanh_thu_vang_lai;
    const ctMoney = Math.max(0, tong - vlMoney);
    const ckWallet = getWalletByKind(snapshot, 'tk_chi_nhan');

    return {
      manualFallbackKind: 'thu_cuoi_ngay',
      preview: {
        badge: 'TỔNG THU CUỐI NGÀY',
        tone: 'income',
        title: 'Thu tiền mặt & CK cuối ngày',
        headlineAmount: tong,
        dateLabel,
        rows: [
          { label: 'Tiền mặt vào ví', value: formatVND(tm), highlight: true },
          { label: `CK vào ${ckWallet.ten_vi}`, value: formatVND(ck), highlight: true },
          { label: 'Trừ tiền suất vãng lai hôm nay', value: `-${formatVND(vlMoney)}` },
          { label: '→ Doanh thu Căn tin còn lại', value: formatVND(ctMoney), highlight: true },
        ],
        bookImpactNote: `Tiền mặt +${formatVND(tm)}, ${ckWallet.ten_vi} +${formatVND(
          ck
        )} · Tự trừ vãng lai ra Doanh thu Căn tin ${formatVND(ctMoney)}.`,
        spokenText: `Ghi tổng thu cuối ngày ${formatCompactVND(tong)}, gồm tiền mặt ${formatCompactVND(
          tm
        )} và chuyển khoản ${formatCompactVND(ck)}. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const { createdIds, replacedIds } = await repo.saveDailyCollection(actor, {
          book_id: bookId,
          ngay,
          tien_mat: tm,
          chuyen_khoan: ck,
          ghi_chu: item.ghi_chu,
          nguon: source,
        });
        return {
          message: `Đã lưu tổng thu cuối ngày ${formatVND(tong)}`,
          undoFn: async () => {
            for (const cid of createdIds) {
              await repo.softDeleteTransaction(actor, bookId, cid);
            }
            for (const rid of replacedIds) {
              await repo.restoreTransaction(actor, bookId, rid);
            }
          },
        };
      },
    };
  }

  // 3. CHẤM CÔNG THỢ
  if (item.intent === 'cham_cong' && item.cham_cong) {
    const list = item.cham_cong;
    const prevAtt = snapshot.attendance.filter(
      (a) => a.book_id === bookId && a.ngay === ngay
    );
    const tongCong = list.reduce((s, x) => s + x.so_cong, 0);
    const tongTien = list.reduce((s, x) => {
      const w = snapshot.workers.find((wk) => wk.id === x.worker_id);
      return s + x.so_cong * (w?.luong_ngay ?? 0);
    }, 0);

    return {
      manualFallbackKind: 'cham_cong',
      preview: {
        badge: 'CHẤM CÔNG PHỤ BẾP',
        tone: 'info',
        title: `Chấm công ngày (${tongCong} công)`,
        headlineAmount: tongTien,
        dateLabel,
        rows: list.map((x) => ({
          label: x.ho_ten,
          value:
            x.so_cong === 1 ? 'Đủ công (1)' : x.so_cong === 0.5 ? 'Nửa buổi (0,5)' : 'Nghỉ (0)',
          highlight: x.so_cong > 0,
        })),
        bookImpactNote:
          'Tính vào chi phí Bếp ăn hôm nay · Cộng dồn vào Lương thợ phải trả cuối tháng.',
        spokenText: `Ghi chấm công hôm nay tổng cộng ${tongCong} công, thành tiền ${formatCompactVND(
          tongTien
        )}. Đúng không ạ?`,
      },
      commit: async (actor) => {
        for (const x of list) {
          const w = snapshot.workers.find((wk) => wk.id === x.worker_id);
          await repo.upsertAttendance(actor, {
            book_id: bookId,
            worker_id: x.worker_id,
            ngay,
            so_cong: x.so_cong,
            don_gia_cong: w?.luong_ngay ?? 250_000,
            ghi_chu: item.ghi_chu,
          });
        }
        return {
          message: `Đã lưu chấm công (${tongCong} công)`,
          undoFn: async () => {
            for (const x of list) {
              const old = prevAtt.find((a) => a.worker_id === x.worker_id);
              const w = snapshot.workers.find((wk) => wk.id === x.worker_id);
              await repo.upsertAttendance(actor, {
                book_id: bookId,
                worker_id: x.worker_id,
                ngay,
                so_cong: old?.so_cong ?? 0,
                don_gia_cong: old?.don_gia_cong ?? w?.luong_ngay ?? 250_000,
              });
            }
          },
        };
      },
    };
  }

  const amount = Math.round(item.so_tien ?? 0);
  if (amount <= 0) return null;

  // 4. CHI HẰNG NGÀY / MUA CHỊU / CHI PHÍ THÁNG
  if (
    item.intent === 'chi' ||
    item.intent === 'chi_no' ||
    item.intent === 'chi_phi_thang'
  ) {
    const cat =
      snapshot.categories.find((c) => c.id === item.category_id) ??
      snapshot.categories.find((c) => c.id === 'cat_do_kho_bep') ??
      snapshot.categories[0];
    const isCredit = item.intent === 'chi_no';
    const isMonthly = item.intent === 'chi_phi_thang' || cat.kieu_tinh === 'theo_thang';
    const mang = item.mang ?? cat.mang_mac_dinh;
    const mangLabel =
      mang === 'bep_an'
        ? 'Bếp ăn'
        : mang === 'can_tin'
        ? 'Căn tin'
        : 'Chung cả cơ sở';

    const wallet = getWalletByKind(snapshot, item.vi);
    const existingSup = snapshot.suppliers.find((s) => s.id === item.supplier_id);
    const matchedSup =
      isCredit && !existingSup && !item.ten_ncc_moi
        ? resolveBestSupplierForCategory(snapshot, cat.id)
        : null;
    const effectiveSup = existingSup ?? matchedSup;
    const supplierLabel = item.ten_ncc_moi
      ? `${item.ten_ncc_moi} (Thêm mới vào danh sách mối hàng)`
      : effectiveSup?.ten_ncc ?? 'Mối hàng chợ';

    return {
      manualFallbackKind: isMonthly ? 'chi_phi_thang' : 'chi',
      draftTx: {
        id: '',
        book_id: bookId,
        ngay,
        timestamp: '',
        mang,
        loai: isCredit ? 'chi_no' : 'chi',
        category_id: cat.id,
        so_tien: amount,
        wallet_id: isCredit ? null : wallet.id,
        supplier_id: isCredit ? (effectiveSup?.id ?? null) : null,
        ky_thang: isMonthly ? kyThang : null,
        ghi_chu: item.ghi_chu || cat.ten_danh_muc,
        cau_noi_goc: rawSentence,
        nguon: 'chat',
        nguoi_tao: '',
        da_xoa: false,
      },
      preview: {
        badge: isCredit
          ? 'MUA CHỊU (GHI NỢ)'
          : isMonthly
          ? `CHI PHÍ THÁNG ${kyThang}`
          : 'CHI TIỀN TRẢ LUÔN',
        tone: isCredit ? 'debt' : 'expense',
        title: `${cat.icon} ${cat.ten_danh_muc}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Mảng tính chi phí', value: mangLabel },
          ...(isMonthly ? [{ label: 'Kỳ lợi nhuận tháng', value: kyThang, highlight: true }] : []),
          isCredit
            ? { label: 'Ghi nợ người bán', value: supplierLabel, highlight: true }
            : { label: 'Trừ từ ví', value: wallet.ten_vi, highlight: true },
          { label: 'Nội dung gốc', value: item.ghi_chu },
        ],
        bookImpactNote: isCredit
          ? `Trừ chi phí ${isMonthly ? `tháng ${kyThang}` : 'hôm nay'} · Tăng Sổ nợ ${supplierLabel} +${formatVND(
              amount
            )} · Tiền trong ví giữ nguyên.`
          : `Trừ chi phí ${isMonthly ? `tháng ${kyThang}` : 'hôm nay'} · Trừ ${
              wallet.ten_vi
            } -${formatVND(amount)}.`,
        spokenText: `Ghi chi ${cat.ten_danh_muc} ${formatCompactVND(amount)}, ${
          isCredit
            ? `mua chịu ghi nợ ${item.ten_ncc_moi ?? effectiveSup?.ten_ncc ?? 'mối hàng'}`
            : `trả bằng ${wallet.ten_vi}`
        }. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        let finalSupplierId = effectiveSup?.id ?? null;
        if (isCredit && item.ten_ncc_moi) {
          const createdSup = await repo.upsertSupplier(actor, {
            book_id: bookId,
            ten_ncc: item.ten_ncc_moi,
            mat_hang_chinh: cat.ten_danh_muc,
            no_dau_ky: 0,
            dang_giao_dich: true,
          });
          finalSupplierId = createdSup.id;
        }

        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang,
          loai: isCredit ? 'chi_no' : 'chi',
          category_id: cat.id,
          so_tien: amount,
          wallet_id: isCredit ? null : wallet.id,
          supplier_id: isCredit ? finalSupplierId : null,
          ky_thang: isMonthly ? kyThang : null,
          ghi_chu: item.ghi_chu || cat.ten_danh_muc,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });

        return {
          message: `Đã lưu ${cat.ten_danh_muc} ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 4b. BÁN CHỊU / GHI NỢ PHẢI THU (Khách/giáo viên nợ tiền cơm, cỗ, căn tin)
  if (item.intent === 'ban_chiu') {
    const partner = item.doi_tac || 'Khách nợ cơm';
    const mang = item.mang ?? 'bep_an';
    const mangLabel = mang === 'can_tin' ? 'Căn tin' : 'Bếp ăn';
    const catId = mang === 'can_tin' ? 'cat_thu_can_tin' : 'cat_doanh_thu_bep';

    return {
      manualFallbackKind: 'thu_cuoi_ngay',
      draftTx: {
        id: '',
        book_id: bookId,
        ngay,
        timestamp: '',
        mang,
        loai: 'ban_chiu',
        category_id: catId,
        so_tien: amount,
        wallet_id: null,
        doi_tac: partner,
        ghi_chu: item.ghi_chu || `Bán chịu / nợ cơm: ${partner}`,
        cau_noi_goc: rawSentence,
        nguon: 'chat',
        nguoi_tao: '',
        da_xoa: false,
      },
      preview: {
        badge: 'BÁN CHỊU / GHI NỢ PHẢI THU',
        tone: 'info',
        title: `Khách nợ: ${partner}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Người nợ (Đối tác)', value: partner, highlight: true },
          { label: 'Mảng ghi nhận doanh thu', value: mangLabel },
          { label: 'Trạng thái tiền ví', value: 'Chưa thu tiền (Ví không đổi)' },
        ],
        bookImpactNote: `Tính doanh thu ${mangLabel} hôm nay +${formatVND(
          amount
        )} · Tăng Sổ phải thu · Tiền trong ví giữ nguyên.`,
        spokenText: `Ghi nhận ${partner} nợ ${formatCompactVND(amount)}, tính vào doanh thu hôm nay. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang,
          loai: 'ban_chiu',
          category_id: catId,
          so_tien: amount,
          wallet_id: null,
          doi_tac: partner,
          ghi_chu: item.ghi_chu || `Bán chịu: ${partner}`,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã ghi ${partner} nợ ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 4c. THU NỢ KHÁCH (Khách / giáo viên trả nợ tiền cơm cũ -> tiền vào ví)
  if (item.intent === 'thu_no') {
    const wallet = getWalletByKind(snapshot, item.vi);
    const partner = item.doi_tac || 'Khách trả nợ';

    return {
      manualFallbackKind: 'thu_cuoi_ngay',
      draftTx: {
        id: '',
        book_id: bookId,
        ngay,
        timestamp: '',
        mang: 'bep_an',
        loai: 'thu_no',
        category_id: 'cat_thu_khac_bep',
        so_tien: amount,
        wallet_id: wallet.id,
        doi_tac: partner,
        ghi_chu: item.ghi_chu || `Thu nợ: ${partner}`,
        cau_noi_goc: rawSentence,
        nguon: 'chat',
        nguoi_tao: '',
        da_xoa: false,
      },
      preview: {
        badge: 'THU NỢ KHÁCH (TIỀN VÀO VÍ)',
        tone: 'income',
        title: `Thu nợ: ${partner}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Người trả nợ', value: partner, highlight: true },
          { label: 'Tiền vào ví', value: wallet.ten_vi, highlight: true },
        ],
        bookImpactNote: `Cộng ${wallet.ten_vi} +${formatVND(
          amount
        )} · Giảm Sổ phải thu · Không tính lại doanh thu để tránh trùng.`,
        spokenText: `Ghi nhận ${partner} trả nợ ${formatCompactVND(amount)} vào ${
          wallet.ten_vi
        }. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang: 'bep_an',
          loai: 'thu_no',
          category_id: 'cat_thu_khac_bep',
          so_tien: amount,
          wallet_id: wallet.id,
          doi_tac: partner,
          ghi_chu: item.ghi_chu || `Thu nợ: ${partner}`,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã thu nợ ${partner} ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 5. TRẢ NỢ NHÀ CUNG CẤP
  if (item.intent === 'tra_no') {
    const wallet = getWalletByKind(snapshot, item.vi);
    const existingSup =
      snapshot.suppliers.find((s) => s.id === item.supplier_id) ?? snapshot.suppliers[0];
    const supName = item.ten_ncc_moi ?? existingSup?.ten_ncc ?? 'Mối hàng';

    return {
      manualFallbackKind: 'tra_no',
      preview: {
        badge: 'TRẢ NỢ MỐI HÀNG',
        tone: 'expense',
        title: `Trả nợ: ${supName}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Người nhận', value: supName, highlight: true },
          { label: 'Trả từ ví', value: wallet.ten_vi, highlight: true },
        ],
        bookImpactNote: `Trừ ${wallet.ten_vi} -${formatVND(
          amount
        )} · Giảm nợ ${supName} · Không trừ trùng Lãi lỗ.`,
        spokenText: `Ghi trả nợ ${supName} ${formatCompactVND(amount)} từ ${
          wallet.ten_vi
        }. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        let supId = existingSup?.id ?? null;
        if (item.ten_ncc_moi && !existingSup) {
          const created = await repo.upsertSupplier(actor, {
            book_id: bookId,
            ten_ncc: item.ten_ncc_moi,
            mat_hang_chinh: 'Nguyên liệu',
            no_dau_ky: 0,
            dang_giao_dich: true,
          });
          supId = created.id;
        }
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang: 'chung',
          loai: 'tra_no',
          category_id: 'cat_tra_no_ncc',
          so_tien: amount,
          wallet_id: wallet.id,
          supplier_id: supId,
          ghi_chu: item.ghi_chu,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã lưu trả nợ ${supName} ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 6. NHÀ TRƯỜNG CHUYỂN TIỀN ĂN
  if (item.intent === 'truong_chuyen') {
    const wallet = getWalletByKind(snapshot, item.vi ?? 'tk_mo_diep');
    const debt = computeDebtAndPayables(snapshot, kyThang);

    return {
      manualFallbackKind: 'truong_chuyen',
      preview: {
        badge: 'TRƯỜNG CHUYỂN TIỀN ĂN',
        tone: 'income',
        title: `Tiền ăn trường chuyển kỳ ${kyThang}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Cộng vào tài khoản', value: wallet.ten_vi, highlight: true },
          {
            label: `Dự kiến theo suất kỳ ${kyThang}`,
            value: formatVND(debt.tien_truong_ky_nay.so_tien_du_kien),
          },
        ],
        bookImpactNote: `Cộng +${formatVND(amount)} vào ${
          wallet.ten_vi
        } · Đánh dấu trường đã chuyển kỳ ${kyThang}.`,
        spokenText: `Ghi nhận trường chuyển tiền ăn kỳ ${kyThang} số tiền ${formatCompactVND(
          amount
        )} vào ${wallet.ten_vi}. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang: 'bep_an',
          loai: 'truong_chuyen',
          category_id: 'cat_truong_chuyen',
          so_tien: amount,
          wallet_id: wallet.id,
          ky_thang: kyThang,
          ghi_chu: item.ghi_chu,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã lưu trường chuyển ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 7. TRẢ / ỨNG LƯƠNG CÔNG NHÂN
  if (item.intent === 'tra_luong') {
    const wallet = getWalletByKind(snapshot, item.vi ?? 'tien_mat');
    const worker = snapshot.workers.find((w) => w.id === item.worker_id);
    const labelTarget = worker ? worker.ho_ten : `Đội phụ bếp kỳ ${kyThang}`;

    return {
      manualFallbackKind: 'tra_luong',
      preview: {
        badge: 'TRẢ LƯƠNG PHỤ BẾP',
        tone: 'expense',
        title: `Trả/ứng lương: ${labelTarget}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Kỳ lương tháng', value: kyThang, highlight: true },
          { label: 'Chi từ ví', value: wallet.ten_vi, highlight: true },
        ],
        bookImpactNote: `Trừ ${wallet.ten_vi} -${formatVND(
          amount
        )} · Giảm lương còn phải trả kỳ ${kyThang}.`,
        spokenText: `Ghi trả lương ${labelTarget} số tiền ${formatCompactVND(amount)} từ ${
          wallet.ten_vi
        }. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang: 'bep_an',
          loai: 'tra_luong',
          category_id: 'cat_tra_luong',
          so_tien: amount,
          wallet_id: wallet.id,
          worker_id: worker?.id ?? null,
          ky_thang: kyThang,
          ghi_chu: item.ghi_chu,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã lưu trả lương ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  // 8. CHUYỂN QUỸ NỘI BỘ
  if (item.intent === 'chuyen_quy') {
    const fromW = getWalletByKind(snapshot, item.vi ?? 'tk_chi_nhan');
    const toW = getWalletByKind(snapshot, item.sang_vi ?? 'tien_mat');

    return {
      manualFallbackKind: 'chuyen_quy',
      preview: {
        badge: 'CHUYỂN QUỸ / RÚT TIỀN',
        tone: 'info',
        title: `${fromW.ten_vi} → ${toW.ten_vi}`,
        headlineAmount: amount,
        dateLabel,
        rows: [
          { label: 'Rút ra từ', value: fromW.ten_vi, highlight: true },
          { label: 'Đưa vào', value: toW.ten_vi, highlight: true },
        ],
        bookImpactNote: `${fromW.ten_vi} -${formatVND(amount)}, ${toW.ten_vi} +${formatVND(
          amount
        )} · Lãi lỗ giữ nguyên.`,
        spokenText: `Chuyển ${formatCompactVND(amount)} từ ${fromW.ten_vi} sang ${
          toW.ten_vi
        }. Đúng không ạ?`,
      },
      commit: async (actor, source) => {
        const saved = await repo.addTransaction(actor, {
          book_id: bookId,
          ngay,
          mang: 'chung',
          loai: 'chuyen_quy',
          category_id: 'cat_chuyen_quy',
          so_tien: amount,
          wallet_id: fromW.id,
          to_wallet_id: toW.id,
          ghi_chu: item.ghi_chu,
          cau_noi_goc: rawSentence,
          nguon: source,
          nguoi_tao: actor.profile_id,
        });
        return {
          message: `Đã chuyển quỹ ${formatVND(amount)}`,
          undoFn: async () => {
            await repo.softDeleteTransaction(actor, bookId, saved.id);
          },
        };
      },
    };
  }

  return null;
}
