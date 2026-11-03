import type { AiSettings, AiTestResult } from '../types/aiSettings';
import type { BookSnapshot } from '../types/models';
import type { ParsedIntentItem } from './intentSchema';
import { extractMealsFromText } from './localVnNlu';

export interface CloudAiCallOptions {
  settings: AiSettings;
  snapshot: BookSnapshot;
  dateStr: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

/**
 * Kiểm tra kết nối API Key trực tiếp trên trình duyệt
 */
export async function testAiConnection(settings: AiSettings): Promise<AiTestResult> {
  const t0 = Date.now();

  if (settings.provider === 'local') {
    return {
      success: true,
      provider: 'local',
      latencyMs: 0,
      statusCode: 200,
      message: 'Đang dùng NLU cục bộ trên máy (Không tốn token, chạy 100% offline, miễn phí vĩnh viễn).',
    };
  }

  const apiKey = settings.api_key.trim();
  if (!apiKey) {
    return {
      success: false,
      provider: settings.provider,
      latencyMs: 0,
      message: 'Vui lòng nhập API Key để kiểm tra kết nối.',
    };
  }

  if (settings.provider === 'gemini') {
    const model = settings.model.trim() || 'gemini-3.8-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Tra ve JSON: {"ping": "pong"}' }] }],
          generationConfig: {
            maxOutputTokens: 10,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      const latencyMs = Date.now() - t0;
      if (res.ok) {
        return {
          success: true,
          provider: 'gemini',
          latencyMs,
          statusCode: res.status,
          message: `Kết nối Google Gemini thành công (200 OK · ${latencyMs}ms). Model: ${model}`,
        };
      }

      if (res.status === 402) {
        return {
          success: false,
          provider: 'gemini',
          latencyMs,
          statusCode: 402,
          message: 'Hết hạn mức / hết token trả trước (402 Payment Required). Vui lòng nạp thêm token trên Google Cloud hoặc chuyển sang DeepSeek.',
        };
      }

      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return {
          success: false,
          provider: 'gemini',
          latencyMs,
          statusCode: res.status,
          message: `Lỗi xác thực (${res.status}): API Key không hợp lệ hoặc không có quyền truy cập model ${model}.`,
        };
      }

      if (res.status === 404) {
        return {
          success: false,
          provider: 'gemini',
          latencyMs,
          statusCode: 404,
          message: `Model "${model}" không tồn tại hoặc đã ngừng hỗ trợ. Gợi ý: dùng gemini-3.8-flash.`,
        };
      }

      const errText = await res.text();
      return {
        success: false,
        provider: 'gemini',
        latencyMs,
        statusCode: res.status,
        message: `Máy chủ Gemini phản hồi lỗi (${res.status}): ${errText.slice(0, 150)}`,
      };
    } catch (err) {
      return {
        success: false,
        provider: 'gemini',
        latencyMs: Date.now() - t0,
        message: `Không thể kết nối đến Google Gemini (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
  }

  // DEEPSEEK & OPENAI COMPATIBLE
  const isDeepSeek = settings.provider === 'deepseek';
  const defaultEndpoint = isDeepSeek
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const endpoint = settings.endpoint?.trim() || defaultEndpoint;
  const model = settings.model.trim() || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini');

  const isReasoner = model.includes('reasoner') || model.includes('r1');

  try {
    const testBody: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: 'Tra ve JSON: {"ping": "pong"}' }],
      max_tokens: 15,
    };
    if (!isReasoner) {
      testBody.response_format = { type: 'json_object' };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(testBody),
      signal: AbortSignal.timeout(isReasoner ? 20000 : 8000),
    });

    const latencyMs = Date.now() - t0;
    if (res.ok) {
      const providerLabel = isDeepSeek ? 'DeepSeek' : 'OpenAI';
      return {
        success: true,
        provider: settings.provider,
        latencyMs,
        statusCode: res.status,
        message: `Kết nối ${providerLabel} thành công (200 OK · ${latencyMs}ms). Model: ${model}`,
      };
    }

    if (res.status === 401) {
      return {
        success: false,
        provider: settings.provider,
        latencyMs,
        statusCode: 401,
        message: 'Lỗi xác thực (401 Unauthorized): API Key không đúng hoặc đã hết hạn.',
      };
    }

    if (res.status === 402) {
      return {
        success: false,
        provider: settings.provider,
        latencyMs,
        statusCode: 402,
        message: 'Tài khoản hết số dư / token (402 Insufficient Balance). Vui lòng nạp thêm tiền vào tài khoản.',
      };
    }

    const errText = await res.text();
    return {
      success: false,
      provider: settings.provider,
      latencyMs,
      statusCode: res.status,
      message: `Máy chủ phản hồi lỗi (${res.status}): ${errText.slice(0, 150)}`,
    };
  } catch (err) {
    return {
      success: false,
      provider: settings.provider,
      latencyMs: Date.now() - t0,
      message: `Không thể kết nối đến ${endpoint} (${err instanceof Error ? err.message : String(err)}).`,
    };
  }
}

/**
 * Xây dựng system prompt ngữ cảnh ứng dụng Sổ Bếp
 */
function buildSystemPrompt(snapshot: BookSnapshot, dateStr: string): string {
  const catLines = snapshot.categories
    .map((c) => `- id: "${c.id}", ten: "${c.ten_danh_muc}", mang: "${c.mang_mac_dinh}", nhom: "${c.nhom}"`)
    .join('\n');
  const supLines = snapshot.suppliers
    .map((s) => `- id: "${s.id}", ten: "${s.ten_ncc}", mat_hang: "${s.mat_hang_chinh}"`)
    .join('\n');
  const workerLines = snapshot.workers
    .map((w) => `- id: "${w.id}", ten: "${w.ho_ten}", luong: ${w.luong_ngay}`)
    .join('\n');
  const walletLines = snapshot.wallets
    .map((w) => `- id: "${w.id}", loai: "${w.loai_vi}", ten: "${w.ten_vi}"`)
    .join('\n');

  return `Bạn là chuyên gia kế toán và trợ lý thông minh cho cơ sở nấu ăn trường học: "${snapshot.book.ten}".
Ngày làm việc hiện tại: ${dateStr}.

Nhiệm vụ: Phân tích chính xác câu nói tiếng Việt của người quản lý bếp (Bố/Mẹ) thành cấu trúc JSON danh sách các hành động: { "items": [...] }.

DANH MỤC CÓ SẴN:
${catLines}

NHÀ CUNG CẤP:
${supLines}

CÔNG NHÂN PHỤ BẾP HIỆN CÓ:
${workerLines}

VÍ TIỀN:
${walletLines}

CÁC INTENT VÀ QUY TẮC PHÂN LOẠI (TUYỆT ĐỐI TUÂN THỦ):
1. 'cham_cong': Chấm công hoặc ghi nhận tiền công thợ / phụ bếp làm việc:
   - Khi câu nói có từ "tiền công", "công", "lương" kèm tên người (Ví dụ: "công chú hiển hôm nay 500000 chưa trả", "tiền công bác Nam 300k"):
     + BẮT BUỘC intent = 'cham_cong'.
     + Nếu tên người chưa có trong danh sách CÔNG NHÂN PHỤ BẾP -> gán "ten_tho_moi": "Chú Hiển", "luong_ngay_moi": 500000, "so_tien": 500000.
     + Nếu câu nói có "chưa trả", "chưa đưa", "ghi nợ", "nợ" -> BẮT BUỘC "chua_tra": true.
     + TUYỆT ĐỐI KHÔNG ĐƯỢC gán nhầm thành mua đồ khô hay chi mua hàng!
2. 'chi': Mua thực phẩm, gia vị, đồ dùng trả tiền ngay (Ví dụ: "mua 5 cân thịt 450 nghìn đã trả tiền mặt" -> intent: 'chi', category_id: 'cat_thit').
3. 'chi_no': Mua thực phẩm nhưng chưa trả tiền / mua chịu ghi sổ (Ví dụ: "lấy 10 cân thịt 900 nghìn nợ", "mua rau 80k chưa trả" -> intent: 'chi_no').
4. 'tra_no': Trả nợ cho nhà cung cấp (Ví dụ: "trả nợ thịt 1 triệu", "trả cô Hoa rau 500k" -> intent: 'tra_no').
5. 'ban_chiu': Khách / giáo viên ăn cơm nhưng ghi nợ (Ví dụ: "thầy Tuấn nợ 2 suất cơm", "cô Lan nợ tiền cơm 50k" -> intent: 'ban_chiu', doi_tac: "Thầy Tuấn").
6. 'thu_can_tin': Doanh thu bán hàng căn tin / tổng thu cuối ngày:
   - Các câu nói: "bán được 400k tiền mặt", "bán cantin được 400k", "bán căn tin 500k chuyển khoản", "thu quầy hôm nay 800 nghìn", "tổng thu căn tin 1 triệu":
     + BẮT BUỘC intent = 'thu_can_tin'.
     + Gán "so_tien": số tiền nói đến.
     + Nếu nói "tiền mặt" -> "vi": "tien_mat". Nếu nói "chuyển khoản", "ck" -> "vi": "tk_chi_nhan".
     + Gán "mang": "can_tin".
7. 'suat_an': Báo số lượng suất ăn trường hoặc vãng lai nấu trong ngày:
   - Các câu nói: "giáo viên trường ăn trưa hôm nay 30 suất", "hôm nay nấu 150 suất trường", "trưa nay có 5 vãng lai", "ăn trưa 40 suất":
     + BẮT BUỘC intent = 'suat_an'.
     + Gán "so_luong": số suất ăn nói đến (Ví dụ: 30).
     + Gán "bua": "sang", "trua", hoặc "toi" (mặc định "trua" nếu nói "ăn trưa" hoặc không nói bữa).
     + Gán "loai_khach": "truong" (giáo viên, học sinh, suất trường) hoặc "vang_lai" (khách ngoài).
     + BẮT BUỘC gán object "suat_an": { "trua_truong": 30 } (hoặc tương ứng với bữa và loại khách).
8. 'hoi': Tra cứu báo cáo (hôm nay lãi bao nhiêu, ai đang nợ mình...).
9. 'huy': Lệnh hủy bỏ hoặc hoàn tác thao tác vừa ghi / thẻ vừa tạo:
   - Các câu nói: "thôi hủy đi", "hủy đi", "hủy", "xóa đi", "bỏ đi", "hoàn tác", "đừng lưu", "hủy cái vừa lưu", "thôi đừng ghi":
     + BẮT BUỘC intent = 'huy'.
     + Gán "ghi_chu": "Yêu cầu hủy bỏ thao tác vừa ghi".
     + TUYỆT ĐỐI KHÔNG ĐƯỢC gán nhầm thành 'hoi' hay in ra báo cáo ngày!

NẾU CÂU NÓI CÓ NHIỀU KHOẢN TIỀN (ĐA MỆNH ĐỀ):
Tự động tách thành nhiều phần tử trong mảng "items". Ví dụ: "mua thịt 300k, rau 50k, công chú hiển 400k chưa trả" -> 3 items riêng biệt.

ĐỊNH DẠNG JSON BẮT BUỘC:
{
  "items": [
    {
      "intent": "cham_cong" | "chi" | "chi_no" | "tra_no" | "ban_chiu" | "thu_can_tin" | "suat_an" | "hoi" | "huy",
      "ngay": "${dateStr}",
      "so_tien": 500000,
      "so_luong": 30,
      "bua": "trua",
      "loai_khach": "truong",
      "suat_an": {
        "trua_truong": 30
      },
      "ten_tho_moi": "Chú Hiển",
      "luong_ngay_moi": 500000,
      "chua_tra": true,
      "mang": "bep_an",
      "vi": "tien_mat",
      "ghi_chu": "Giáo viên trường ăn trưa 30 suất"
    }
  ]
}`;
}

/**
 * Gọi AI đám mây (Gemini / DeepSeek / OpenAI) với ngữ cảnh đa lượt
 */
export async function callCloudAi(
  userText: string,
  options: CloudAiCallOptions
): Promise<ParsedIntentItem[] | null> {
  const { settings, snapshot, dateStr, history = [] } = options;
  if (!settings.enabled || settings.provider === 'local') return null;

  const apiKey = settings.api_key.trim();
  if (!apiKey) return null;

  const systemPrompt = buildSystemPrompt(snapshot, dateStr);

  try {
    if (settings.provider === 'gemini') {
      const model = settings.model.trim() || 'gemini-3.8-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const contents: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [];

      contents.push({
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nNgười dùng nói: "Xin chào"` }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: '{"items": []}' }],
      });

      for (const h of history.slice(-4)) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }],
        });
      }

      contents.push({
        role: 'user',
        parts: [{ text: userText }],
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: settings.temperature ?? 0.1,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(9000),
      });

      if (!res.ok) {
        console.warn(`Gemini API trả về mã ${res.status}`);
        return null;
      }

      const data = await res.json();
      const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) return null;

      let cleanJson = rawJson.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        return normalizeParsedCloudItems(parsed.items);
      }
      return null;
    }

    // DEEPSEEK & OPENAI COMPATIBLE
    const isDeepSeek = settings.provider === 'deepseek';
    const defaultEndpoint = isDeepSeek
      ? 'https://api.deepseek.com/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const endpoint = settings.endpoint?.trim() || defaultEndpoint;
    const model = settings.model.trim() || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini');
    const isReasoner = model.includes('reasoner') || model.includes('r1');

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const h of history.slice(-4)) {
      messages.push({
        role: h.role,
        content: h.text,
      });
    }

    messages.push({ role: 'user', content: userText });

    const requestBody: Record<string, unknown> = {
      model,
      messages,
    };

    // DeepSeek-reasoner không nhận temperature và response_format
    if (!isReasoner) {
      requestBody.response_format = { type: 'json_object' };
      requestBody.temperature = settings.temperature ?? 0.1;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(isReasoner ? 25000 : 10000),
    });

    if (!res.ok) {
      console.warn(`${isDeepSeek ? 'DeepSeek' : 'OpenAI'} API trả về mã ${res.status}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) return null;

    let cleanJson = String(rawContent).trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    } else {
      // Tìm khối JSON {...} bên trong nếu model trả về text kèm reasoning
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) {
        cleanJson = match[0];
      }
    }

    const parsed = JSON.parse(cleanJson);
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      return normalizeParsedCloudItems(parsed.items);
    }
    return null;
  } catch (err) {
    console.warn('Lỗi gọi Cloud AI:', err);
    return null;
  }
}

/**
 * Chuẩn hóa các trường trả về từ Cloud AI (DeepSeek / Gemini / OpenAI)
 * Xử lý các trường thợ mới (ten_tho_moi / worker_name) và trạng thái chưa trả (chua_tra / paid: false)
 */
function normalizeParsedCloudItems(rawItems: unknown[]): ParsedIntentItem[] {
  return rawItems.map((raw) => {
    const r = raw as Record<string, unknown>;
    const it = { ...r } as unknown as ParsedIntentItem;

    // Chuẩn hóa tên thợ mới nếu model trả về worker_name thay vì ten_tho_moi
    if (!it.ten_tho_moi && r.worker_name && typeof r.worker_name === 'string') {
      it.ten_tho_moi = r.worker_name;
    }

    // Chuẩn hóa trạng thái chưa trả tiền
    if (it.chua_tra === undefined) {
      if (r.paid === false || r.unpaid === true || r.da_tra === false) {
        it.chua_tra = true;
      } else if (typeof it.ghi_chu === 'string' && /(chưa trả|chua tra|ghi nợ|chưa đưa)/i.test(it.ghi_chu)) {
        it.chua_tra = true;
      }
    }

    // Chuẩn hóa intent thu_can_tin / bán căn tin
    if (it.intent === 'thu_can_tin' || (it as unknown as { intent: string }).intent === 'thu') {
      it.intent = 'thu_can_tin';
      it.mang = 'can_tin';
      const amt = Number(it.so_tien || r.amount || 0);
      if (!it.thu_cuoi_ngay && amt > 0) {
        const isCk =
          it.vi === 'tk_chi_nhan' ||
          it.vi === 'tk_mo_diep' ||
          /(chuyển khoản|ck|ngân hàng)/i.test(String(it.ghi_chu || ''));
        it.thu_cuoi_ngay = {
          tien_mat: isCk ? 0 : amt,
          chuyen_khoan: isCk ? amt : 0,
        };
      }
    }

    // Chuẩn hóa intent suat_an
    if (it.intent === 'suat_an' || (it as unknown as { intent: string }).intent === 'suat') {
      it.intent = 'suat_an';
      it.mang = 'bep_an';
      if (!it.suat_an) {
        it.suat_an = {};
      }
      const sa = it.suat_an;
      const totalSa =
        (sa.sang_truong ?? 0) +
        (sa.trua_truong ?? 0) +
        (sa.toi_truong ?? 0) +
        (sa.sang_vang_lai ?? 0) +
        (sa.trua_vang_lai ?? 0) +
        (sa.toi_vang_lai ?? 0);

      if (totalSa === 0) {
        const qty = Number(r.so_luong || r.so_suat || r.quantity || r.suat || 0);
        const bua = String(r.bua || '').toLowerCase();
        const loai = String(r.loai_khach || 'truong').toLowerCase();
        if (qty > 0) {
          if (bua.includes('sang')) {
            if (loai.includes('vang_lai')) sa.sang_vang_lai = qty;
            else sa.sang_truong = qty;
          } else if (bua.includes('toi')) {
            if (loai.includes('vang_lai')) sa.toi_vang_lai = qty;
            else sa.toi_truong = qty;
          } else {
            if (loai.includes('vang_lai')) sa.trua_vang_lai = qty;
            else sa.trua_truong = qty;
          }
        } else if (typeof it.ghi_chu === 'string') {
          const ext = extractMealsFromText(it.ghi_chu);
          if (ext.matched) {
            Object.assign(sa, ext.counts);
          }
        }
      }
    }

    return it;
  });
}
