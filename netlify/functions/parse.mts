/**
 * Netlify Serverless Function: POST /api/parse
 * - Giấu kín GEMINI_API_KEY phía server (tuyệt đối không lộ xuống trình duyệt).
 * - Model mặc định cân bằng "Thông minh - Không ngáo - Siêu tiết kiệm token":
 *   `gemini-3.8-flash` (bản Flash chuẩn thế hệ mới, không dùng bản `-lite` dễ ngáo tiếng Việt,
 *   không dùng bản `-pro` đắt đỏ) kết hợp `thinkingBudget: 0` để cắt 100% token suy nghĩ thừa.
 * - Nén gọn danh mục gửi kèm (giảm ~60% input tokens mỗi lượt gọi).
 */

export interface ParseRequestBody {
  text?: string;
  audioBase64?: string;
  audioMimeType?: string;
  referenceDate: string;
  bookName: string;
  categories: Array<{ id: string; ten: string; kieu_tinh: string; mang: string }>;
  workers: Array<{ id: string; ho_ten: string }>;
  suppliers: Array<{ id: string; ten_ncc: string }>;
}

const COMPACT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          intent: {
            type: 'STRING',
            enum: [
              'suat_an',
              'giong_hom_qua',
              'vang_lai',
              'thu_can_tin',
              'chi',
              'chi_no',
              'tra_no',
              'cham_cong',
              'truong_chuyen',
              'tra_luong',
              'chi_phi_thang',
              'chuyen_quy',
              'hoi',
              'khong_ro',
            ],
          },
          ngay: { type: 'STRING' },
          ky_thang: { type: 'STRING' },
          mang: { type: 'STRING', enum: ['bep_an', 'can_tin', 'chung'] },
          category_id: { type: 'STRING' },
          so_tien: { type: 'NUMBER' },
          vi: { type: 'STRING', enum: ['tien_mat', 'tk_mo_diep', 'tk_chi_nhan'] },
          sang_vi: { type: 'STRING', enum: ['tien_mat', 'tk_mo_diep', 'tk_chi_nhan'] },
          supplier_id: { type: 'STRING' },
          ten_ncc_moi: { type: 'STRING' },
          worker_id: { type: 'STRING' },
          ghi_chu: { type: 'STRING' },
          cau_hoi_lam_ro: { type: 'STRING' },
          chu_de_hoi: {
            type: 'STRING',
            enum: [
              'lai_hom_nay',
              'lai_thang',
              'so_du_vi',
              'so_no_ncc',
              'tien_truong',
              'luong_tho',
              'tong_hop',
            ],
          },
          suat_an: {
            type: 'OBJECT',
            properties: {
              sang_truong: { type: 'NUMBER' },
              trua_truong: { type: 'NUMBER' },
              toi_truong: { type: 'NUMBER' },
              sang_vang_lai: { type: 'NUMBER' },
              trua_vang_lai: { type: 'NUMBER' },
              toi_vang_lai: { type: 'NUMBER' },
            },
          },
          thu_cuoi_ngay: {
            type: 'OBJECT',
            properties: {
              tien_mat: { type: 'NUMBER' },
              chuyen_khoan: { type: 'NUMBER' },
            },
          },
          cham_cong: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                worker_id: { type: 'STRING' },
                ho_ten: { type: 'STRING' },
                so_cong: { type: 'NUMBER' },
              },
              required: ['worker_id', 'ho_ten', 'so_cong'],
            },
          },
        },
        required: ['intent', 'ngay', 'ghi_chu'],
      },
    },
  },
  required: ['items'],
};

function buildCompactSystemPrompt(body: ParseRequestBody): string {
  const catLine = body.categories
    .map((c) => `${c.id}:${c.ten}(${c.kieu_tinh === 'theo_thang' ? 'thang' : 'ngay'},${c.mang})`)
    .join('|');
  const workerLine = body.workers.map((w) => `${w.id}:${w.ho_ten}`).join('|') || 'none';
  const supLine = body.suppliers.map((s) => `${s.id}:${s.ten_ncc}`).join('|') || 'none';

  return [
    `Kế toán Sổ Bếp Nhà Mình (${body.bookName}). Hôm nay=${body.referenceDate}.`,
    `Danh mục=${catLine}`,
    `Thợ=${workerLine}`,
    `NCC=${supLine}`,
    `Luật: 1)Mua hàng mặc định intent='chi',vi='tien_mat'; chỉ 'chi_no' khi có từ nợ/chịu/ghi sổ/trả sau(nếu tên NCC chưa có trong NCC thì điền ten_ncc_moi). 2)Không nhầm cân/lít/suất/bình thành tiền. 3)"2 triệu 3"=2300000,"4 trăm rưỡi"=450000,"1 củ 2"=1200000,"8 chục"=80000,"rau 300"=300000. 4)Câu nhiều ý tách nhiều phần tử trong items. 5)Nếu là audio thì chép câu nghe được vào transcript.`,
  ].join('\n');
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userParts: Array<Record<string, unknown>>
): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 700,
        responseMimeType: 'application/json',
        responseSchema: COMPACT_RESPONSE_SCHEMA,
        // Tắt hidden thinking tokens -> tiết kiệm 4-6 lần output tokens & phản hồi < 0.5s
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
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
    const systemPrompt = buildCompactSystemPrompt(body);

    const userParts: Array<Record<string, unknown>> = [];
    if (body.audioBase64) {
      userParts.push({
        inlineData: {
          mimeType: body.audioMimeType || 'audio/webm',
          data: body.audioBase64,
        },
      });
      userParts.push({
        text: 'Nghe giọng nói tiếng Việt này, điền transcript và phân tích vào items.',
      });
    } else {
      userParts.push({ text: body.text ?? '' });
    }

    const preferredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
    const candidateModels =
      preferredModel === 'gemini-flash-latest'
        ? [preferredModel]
        : [preferredModel, 'gemini-flash-latest'];

    let resp: Response | null = null;
    let activeModel = preferredModel;

    for (const m of candidateModels) {
      activeModel = m;
      resp = await callGeminiModel(m, apiKey, systemPrompt, userParts);
      if (resp.status !== 404) break;
    }

    if (!resp || !resp.ok) {
      const status = resp?.status ?? 502;
      const code =
        status === 402
          ? 'GEMINI_PREPAYMENT_DEPLETED'
          : status === 429
          ? 'GEMINI_RATE_LIMIT'
          : `GEMINI_HTTP_${status}`;
      return new Response(JSON.stringify({ error: code, model: activeModel }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const rawJsonText =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"items":[]}';
    const parsed = JSON.parse(rawJsonText);

    return new Response(
      JSON.stringify({
        engine: 'gemini',
        model: activeModel,
        usage: data.usageMetadata,
        ...parsed,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
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
