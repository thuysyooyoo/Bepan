import type { AiSettings, AiTestResult } from '../types/aiSettings';
import type { BookSnapshot } from '../types/models';
import type { ParsedIntentItem } from './intentSchema';
import { extractMealsFromText } from './localVnNlu';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeWalletBalances,
} from '../domain/accounting';
import { formatVND } from '../domain/format';

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
    .map((c) => `- ${c.ten_danh_muc} (id: "${c.id}", mảng: "${c.mang_mac_dinh}", nhóm: "${c.nhom}")`)
    .join('\n');
  const supLines = snapshot.suppliers
    .map((s) => `- ${s.ten_ncc} (id: "${s.id}", mặt hàng: "${s.mat_hang_chinh}")`)
    .join('\n');
  const workerLines = snapshot.workers
    .map((w) => `- ${w.ho_ten} (id: "${w.id}", lương: ${formatVND(w.luong_ngay)}/ngày)`)
    .join('\n');
  const walletLines = snapshot.wallets
    .map((w) => `- ${w.ten_vi} (id: "${w.id}", loại: "${w.loai_vi}")`)
    .join('\n');

  let financialContext = '';
  try {
    const daily = computeDailyReport(snapshot, dateStr);
    const kyThang = dateStr.slice(0, 7);
    const debt = computeDebtAndPayables(snapshot, kyThang, dateStr);
    const walletBalances = computeWalletBalances(
      snapshot.wallets,
      snapshot.transactions,
      snapshot.book.id
    );

    const supDebtLines = debt.nha_cung_cap.danh_sach
      .filter((s) => s.con_no > 0)
      .map((s) => `${s.supplier.ten_ncc}: ${formatVND(s.con_no)}`)
      .join(', ');
    const workerDebtLines = debt.luong_tho_ky_nay.chi_tiet_tho
      .filter((t) => t.con_lai > 0)
      .map((t) => `${t.worker.ho_ten}: ${formatVND(t.con_lai)}`)
      .join(', ');
    const customerDebtLines = debt.phai_thu_khach.danh_sach
      .filter((k) => k.con_phai_thu > 0)
      .map((k) => `${k.doi_tac}: ${formatVND(k.con_phai_thu)}`)
      .join(', ');

    const tongThuNgay = daily.bep_an.tong_doanh_thu + daily.can_tin.doanh_thu_can_tin;
    const tongChiNgay = daily.bep_an.tong_chi_ngay + daily.can_tin.chi_nhap_hang_ngay;
    const laiNgay = daily.bep_an.lai_uoc_tinh_ngay;

    financialContext = `
BỨC TRANH TÀI CHÍNH THỰC TẾ HIỆN TẠI (NGÀY ${dateStr}):
- Suất ăn: Trường ${daily.bep_an.suat_truong} suất, Vãng lai ${daily.bep_an.suat_vang_lai} suất (Tổng: ${daily.bep_an.tong_suat} suất).
- Bếp ăn: Doanh thu ${formatVND(daily.bep_an.tong_doanh_thu)}, Chi chợ & công thợ ${formatVND(daily.bep_an.tong_chi_ngay)}, Lãi ước tính ${formatVND(laiNgay)}.
- Căn tin: Doanh thu thuần ${formatVND(daily.can_tin.doanh_thu_can_tin)}, Chi nhập hàng ${formatVND(daily.can_tin.chi_nhap_hang_ngay)}.
- Toàn cơ sở hôm nay: Tổng thu ${formatVND(tongThuNgay)}, Tổng chi ${formatVND(tongChiNgay)}, Lãi ước tính Bếp: ${formatVND(laiNgay)}.
- Số dư các ví tiền:
${walletBalances.map((w) => `  * ${w.wallet.ten_vi} (${w.wallet.loai_vi}): ${formatVND(w.so_du_hien_tai)}`).join('\n')}
- Tình hình công nợ kỳ ${kyThang}:
  * Nợ nhà cung cấp: Tổng nợ ${formatVND(debt.nha_cung_cap.tong_no_ncc)} (${supDebtLines || 'Không nợ ai'}).
  * Nợ lương thợ chưa trả: Tổng nợ ${formatVND(debt.luong_tho_ky_nay.con_phai_tra)} (${workerDebtLines || 'Đã thanh toán hết'}).
  * Khách/giáo viên nợ tiền cơm: Tổng nợ ${formatVND(debt.phai_thu_khach.tong_phai_thu_khach)} (${customerDebtLines || 'Không ai nợ'}).
`;
  } catch {
    // Không để lỗi tính toán làm gãy system prompt
  }

  return `Bạn là Trợ lý Bếp AI Toàn Năng (Chuyên gia Kế toán & Điều hành Bếp ăn Sổ Bếp Nhà Mình) phục vụ cho cơ sở: "${snapshot.book.ten}".
Ngày làm việc hiện tại: ${dateStr}.
${financialContext}
DANH MỤC CHI TIÊU CÓ SẴN:
${catLines}

NHÀ CUNG CẤP:
${supLines}

CÔNG NHÂN PHỤ BẾP:
${workerLines}

VÍ TIỀN:
${walletLines}

VAI TRÒ VÀ NĂNG LỰC SUY LUẬN TỰ NHIÊN:
Bạn là một AI Trí tuệ Nhân tạo thông minh, trò chuyện và thấu hiểu ngữ cảnh con người tự nhiên (như ChatGPT/Gemini/DeepSeek), KHÔNG PHẢI MÁY MÓC IF/ELSE.
Bạn có khả năng đọc hiểu chuỗi hội thoại đa lượt phía trên (cả lời của user và phản hồi của assistant):

1. HIỂU LỆNH HỦY / HOÀN TÁC (Multi-turn Undo/Cancel):
- Khi người dùng nói: "thôi hủy đi", "hủy đi", "xóa đi", "bỏ đi", "hoàn tác", "đừng lưu nữa", "hủy cái vừa lưu"...:
  + Bạn nhìn vào lượt hội thoại trước đó xem vừa lưu hoặc vừa tạo thao tác gì.
  + BẮT BUỘC gán intent: 'huy'.
  + Trả về câu reply tự nhiên, ân cần: "Dạ, con đã hủy bỏ mục vừa ghi theo yêu cầu của bác rồi ạ!".
  + TUYỆT ĐỐI KHÔNG ĐƯỢC gán nhầm thành 'hoi' hay in ra báo cáo ngày!

2. HIỂU LỆNH ĐIỀU CHỈNH NỐI TIẾP (Multi-turn Adjustment):
- Nếu lượt trước ghi mua hàng hoặc chấm công, lượt này người dùng nói: "chưa trả tiền đâu", "ghi nợ nhé", "trả sau":
  + Bạn hiểu ngay là chuyển sang ghi nợ (intent: 'chi_no' hoặc 'cham_cong' với chua_tra: true).
- Nếu người dùng nói: "sửa thành 500k", "của chú Hiển cơ", "đổi sang tiền mặt":
  + Bạn lấy dữ liệu từ lượt trước, cập nhật lại trường cần sửa, và sinh ra thẻ mới đã điều chỉnh.

3. HIỂU CÂU HỎI BÁO CÁO, TRA CỨU TÀI CHÍNH:
- Khi người dùng hỏi: "Hôm nay lãi bao nhiêu?", "Ai đang nợ mình?", "Còn bao nhiêu tiền mặt?", "Tiền trường thu được bao nhiêu?":
  + Bạn dùng dữ liệu BỨC TRANH TÀI CHÍNH THỰC TẾ ở trên để trả lời chi tiết, tính toán chính xác, giọng điệu lễ phép, đĩnh đạc, rõ ràng.
  + Gán intent: 'hoi', ghi_chu: câu trả lời, và reply: câu trả lời.

4. HIỂU CÁC GIAO DỊCH GHI SỔ MỚI:
- Báo suất ăn: "giáo viên trường ăn trưa hôm nay 30 suất", "nấu 120 suất trường":
  + intent: 'suat_an', so_luong: 30, bua: "trua", loai_khach: "truong", suat_an: { trua_truong: 30 }.
- Tiền công thợ: "tiền công chú hiển hôm nay 500k chưa trả", "công bác Nam 400k":
  + intent: 'cham_cong', ten_tho_moi: "Chú Hiển", so_tien: 500000, chua_tra: true (nếu nói chưa trả/nợ).
- Doanh thu căn tin: "bán được 400k tiền mặt", "bán cantin 500k chuyển khoản":
  + intent: 'thu_can_tin', so_tien: 400000, vi: "tien_mat", mang: "can_tin".
- Mua hàng trả tiền ngay: "mua 5 cân thịt 450k tiền mặt" -> intent: 'chi', category_id: "cat_thit".
- Mua hàng ghi nợ: "lấy 10 cân thịt 900k nợ" -> intent: 'chi_no'.
- Trả nợ NCC: "trả nợ thịt 1 triệu" -> intent: 'tra_no'.
- Khách nợ tiền cơm: "thầy Tuấn nợ 2 suất trưa" -> intent: 'ban_chiu'.

5. TRÒ CHUYỆN & CHÀO HỎI TỰ NHIÊN:
- Nếu người dùng chào hỏi hoặc tâm sự ("chào con", "hôm nay mệt quá"): Hồi đáp lễ phép, ân cần, động viên. Gán intent: 'khong_ro'.

NẾU CÂU NÓI CÓ NHIỀU KHOẢN TIỀN (ĐA MỆNH ĐỀ):
Tự động tách thành nhiều phần tử trong mảng "items".

CẤU TRÚC JSON PHẢN HỒI BẮT BUỘC:
{
  "thought": "Suy luận ngắn gọn của bạn về yêu cầu của người dùng",
  "reply": "Câu trả lời tự nhiên, ân cần của bạn gửi cho bác/bố/mẹ",
  "items": [
    {
      "intent": "cham_cong" | "chi" | "chi_no" | "tra_no" | "ban_chiu" | "thu_no" | "thu_can_tin" | "suat_an" | "hoi" | "huy" | "khong_ro",
      "ngay": "${dateStr}",
      "so_tien": 500000,
      "so_luong": 30,
      "bua": "trua",
      "loai_khach": "truong",
      "suat_an": { "trua_truong": 30 },
      "category_id": "cat_thit",
      "supplier_id": "sup_thit",
      "worker_id": "w1",
      "ten_tho_moi": "Chú Hiển",
      "luong_ngay_moi": 500000,
      "chua_tra": true,
      "mang": "bep_an",
      "vi": "tien_mat",
      "ghi_chu": "Mô tả ngắn gọn",
      "cau_tra_loi": "Câu trả lời riêng nếu là câu hỏi/hủy/trò chuyện"
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

      for (const h of history.slice(-6)) {
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
      const items = extractItemsFromParsedJson(parsed, dateStr);
      if (items.length > 0) return items;
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

    for (const h of history.slice(-6)) {
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
    const items = extractItemsFromParsedJson(parsed, dateStr);
    if (items.length > 0) return items;
    return null;
  } catch (err) {
    console.warn('Lỗi gọi Cloud AI:', err);
    return null;
  }
}

/**
 * Trích xuất danh sách items từ JSON phản hồi của Cloud AI
 */
function extractItemsFromParsedJson(
  parsed: Record<string, unknown>,
  dateStr: string
): ParsedIntentItem[] {
  const replyText = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  let items: ParsedIntentItem[] = [];

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    items = normalizeParsedCloudItems(parsed.items);
    if (replyText) {
      items.forEach((it) => {
        if (!it.cau_tra_loi) it.cau_tra_loi = replyText;
      });
    }
  } else if (replyText) {
    items = [
      {
        intent: 'khong_ro',
        ngay: dateStr,
        ghi_chu: replyText,
        cau_tra_loi: replyText,
      },
    ];
  }

  return items;
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
