/**
 * Netlify Serverless Function: POST /api/parse
 * Giấu kín GEMINI_API_KEY phía server (tuyệt đối không lộ xuống trình duyệt).
 * Hỗ trợ cả văn bản (text) VÀ file ghi âm dự phòng (audioBase64 + audioMimeType)
 * để Gemini 2.5 Flash vừa gỡ băng tiếng Việt vừa trả về đúng JSON Schema của Sổ Bếp Nhà Mình.
 */

interface ParseRequestBody {
  text?: string;
  audioBase64?: string;
  audioMimeType?: string;
  referenceDate: string;
  bookName: string;
  categories: Array<{ id: string; ten: string; kieu_tinh: string; mang: string }>;
  workers: Array<{ id: string; ho_ten: string }>;
  suppliers: Array<{ id: string; ten_ncc: string }>;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY_NOT_CONFIGURED' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = (await req.json()) as ParseRequestBody;
    const systemPrompt = `Bạn là trợ lý kế toán Sổ Bếp Nhà Mình cho ông bà quản lý Bếp ăn trường học và Căn tin (${body.bookName}).
Ngày tham chiếu hôm nay: ${body.referenceDate}.
Danh mục chi tiêu hợp lệ: ${JSON.stringify(body.categories)}.
Công nhân phụ bếp hiện có: ${JSON.stringify(body.workers)}.
Nhà cung cấp hiện có: ${JSON.stringify(body.suppliers)}.

Quy tắc bắt buộc:
1. Nếu đầu vào là âm thanh giọng nói tiếng Việt, hãy chép lại chính xác nguyên văn câu nói vào trường "transcript", sau đó phân tích vào mảng "items".
2. Mặc định mua hàng là trả ngay ('chi', vi='tien_mat'). Chỉ dùng 'chi_no' khi câu nói có từ nợ, mua chịu, ghi sổ, chưa trả, trả sau.
3. Tuyệt đối không nhầm đơn vị đo lường (5 cân, 5 lít, 320 suất, 2 bình) thành tiền.
4. Số khẩu ngữ tiếng Việt: "2 triệu 3" = 2300000, "4 trăm rưỡi" = 450000, "1 củ 2" = 1200000, "tám chục" = 80000, "mua rau 300" = 300000.
5. Một câu có nhiều việc phải tách thành nhiều phần tử trong mảng "items".`;

    const userParts: Array<Record<string, unknown>> = [];
    if (body.audioBase64) {
      userParts.push({
        inlineData: {
          mimeType: body.audioMimeType || 'audio/webm',
          data: body.audioBase64,
        },
      });
      userParts.push({
        text: 'Hãy nghe câu nói tiếng Việt này, trả về JSON gồm {"transcript": "<câu nghe được>", "items": [...]}.',
      });
    } else {
      userParts.push({ text: body.text ?? '' });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    const resp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `GEMINI_HTTP_${resp.status}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"items":[]}';
    const parsed = JSON.parse(rawJsonText);

    return new Response(JSON.stringify({ engine: 'gemini', ...parsed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'PARSE_ERROR' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
