import type { AiSettings, AiTestResult } from '../types/aiSettings';
import type { BookSnapshot } from '../types/models';
import type { ParsedIntentItem } from './intentSchema';

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

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Tra ve JSON: {"ping": "pong"}' }],
        response_format: { type: 'json_object' },
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(8000),
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

  return `Bạn là trợ lý kế toán cho cơ sở nấu ăn trường học: "${snapshot.book.ten}".
Ngày làm việc hiện tại: ${dateStr}.

Nhiệm vụ của bạn: Phân tích câu nói tiếng Việt của người dùng (Bố/Mẹ) thành cấu trúc JSON danh sách các hành động { "items": [...] }.

DANH MỤC CÓ SẴN:
${catLines}

NHÀ CUNG CẤP:
${supLines}

CÔNG NHÂN PHỤ BẾP:
${workerLines}

VÍ TIỀN:
${walletLines}

CÁC INTENT HỢP LỆ:
- 'chi': Chi tiền mua thực phẩm/đồ dùng hàng ngày trả tiền ngay (ví dụ: 'mua thịt 450 nghìn đã trả tiền mặt')
- 'chi_no': Mua thực phẩm/đồ dùng nhưng chưa trả tiền / mua chịu (ví dụ: 'mua 5 cân thịt 450 nghìn chưa trả tiền' -> intent: 'chi_no', category_id: 'cat_thit', supplier_id: sup_id)
- 'tra_no': Trả nợ cho nhà cung cấp (ví dụ: 'trả nợ thịt 500 nghìn')
- 'thu_can_tin': Thu cuối ngày quầy căn tin
- 'suat_an': Báo số suất ăn trường hoặc vãng lai
- 'cham_cong': Chấm công thợ phụ bếp
- 'hoi': Câu hỏi báo cáo (lãi hôm nay, nợ nần, còn bao nhiêu tiền...)
- 'khong_ro': Câu nói không liên quan hoặc không thể hiểu.

LƯU Ý NGỮ CẢNH HỘI THOẠI TRƯỚC:
Nếu người dùng nói tiếp một câu ngắn (ví dụ: 'khoản đó chưa trả tiền nhé', 'ghi nợ nhé', 'của căn tin nhé', 'sửa thành 500 nghìn'), bạn phải dựa vào tin nhắn trước đó để cập nhật khoản giao dịch tương ứng!

BẮT BUỘC trả về đúng định dạng JSON:
{
  "items": [
    {
      "intent": "chi" | "chi_no" | "tra_no" | "thu_can_tin" | "suat_an" | "cham_cong" | "hoi" | "khong_ro",
      "ngay": "${dateStr}",
      "so_tien": 450000,
      "category_id": "cat_thit",
      "supplier_id": "sup_td_thit",
      "mang": "bep_an",
      "vi": "tien_mat",
      "ghi_chu": "Mua 5 cân thịt"
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

      // Gemini contents format
      contents.push({
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nNgười dùng nói: "Xin chào"` }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: '{"items": []}' }],
      });

      // Thêm lịch sử hội thoại
      for (const h of history.slice(-4)) {
        contents.push({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text }],
        });
      }

      // Lượt nói hiện tại
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

      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed.items) && parsed.items.length > 0) {
        return parsed.items as ParsedIntentItem[];
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

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: settings.temperature ?? 0.1,
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
      console.warn(`${isDeepSeek ? 'DeepSeek' : 'OpenAI'} API trả về mã ${res.status}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) return null;

    const parsed = JSON.parse(rawContent);
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed.items as ParsedIntentItem[];
    }
    return null;
  } catch (err) {
    console.warn('Lỗi gọi Cloud AI:', err);
    return null;
  }
}
