import {
  computeDailyReport,
  computeDebtAndPayables,
  computeMonthlyReport,
  computeWalletBalances,
  findPreviousMealDay,
  getEffectiveMealPrice,
} from '../domain/accounting';
import { formatVND } from '../domain/format';
import type {
  BookSnapshot,
  BusinessSegment,
  Category,
  MealPeriod,
  Supplier,
  WalletKind,
} from '../types/models';
import type { AIParseResult, ParsedIntentItem } from './intentSchema';
import {
  parseVietnameseDate,
  parseVietnameseMoney,
  parseVietnameseMonth,
} from './vnNumberDateParser';

export function stripAccents(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectWalletKind(clause: string, defaultWallet: WalletKind = 'tien_mat'): WalletKind {
  const noAcc = stripAccents(clause);
  if (/\b(mo diep|tk diep|tai khoan diep)\b/.test(noAcc)) return 'tk_mo_diep';
  if (/\b(chi nhan|tk nhan|tai khoan nhan|chuyen khoan|ck)\b/.test(noAcc)) return 'tk_chi_nhan';
  if (/\b(tien mat|tm)\b/.test(noAcc)) return 'tien_mat';
  return defaultWallet;
}

function isCreditPurchaseText(clause: string): boolean {
  const noAcc = stripAccents(clause);
  return /\b(ghi no|mua chiu|lay chiu|ban chiu|chiu|ghi so|ky so|gui no|chua tra|chua dua tien|chua thanh toan|thieu tien|tra sau|no lai|no chi|no co|no anh|no chu|no ba|no bac|no ong|no dai ly|no moi|ghi vao so)\b/.test(
    noAcc
  );
}

/**
 * Tìm nhà cung cấp khớp tên nhất trong danh sách sẵn có, hoặc trích xuất tên người bán mới
 * Ví dụ: "Lấy rau chị Hương 300k ghi nợ" -> ten_ncc_moi = "Chị Hương"
 */
function resolveSupplierFromClause(
  clause: string,
  suppliers: Supplier[]
): { supplier_id?: string; ten_ncc_moi?: string } {
  const noAccClause = stripAccents(clause);

  // 1. Khớp trực tiếp tên NCC có sẵn (hoặc cụm từ chính như "mối thịt", "đại lý gạo")
  for (const sup of suppliers) {
    const supNoAcc = stripAccents(sup.ten_ncc);
    if (noAccClause.includes(supNoAcc)) {
      return { supplier_id: sup.id };
    }
    const shortWords = supNoAcc.replace(/\b(hiep hoa|tien du|cho)\b/g, '').trim();
    if (shortWords.length >= 6 && noAccClause.includes(shortWords)) {
      return { supplier_id: sup.id };
    }
  }

  // 2. Bóc tách danh xưng người bán mới: "chị Hương", "cô Hạnh", "bà Năm", "anh Tuấn", "chú Bảy", "đại lý Minh"
  const honorificMatch = clause.match(
    /(?<![\p{L}\p{N}])(chị|cô|bà|bác|anh|chú|ông|đại lý|mối|nhà|quầy)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/iu
  );

  if (honorificMatch) {
    const prefix = honorificMatch[1];
    const rawName = honorificMatch[2]
      .replace(
        /(?<![\p{L}\p{N}])(ghi|nợ|no|mua|chịu|chiu|chưa|trả|tra|hết|het|bán|ban|nghìn|ngàn|triệu|trăm|chục|tiền|tien|chợ|cho|bằng|bang|chuyển|chuyen)(?![\p{L}\p{N}]).*$/iu,
        ''
      )
      .trim();

    // Tránh bắt nhầm danh từ mặt hàng phổ biến sau chữ "mối" / "đại lý" (VD: "mối thịt", "đại lý gạo")
    const rawNameNoAcc = stripAccents(rawName);
    const isGenericItemWord = /^(thit|gao|nuoc|banh|rau|ca|sua|trung|dau|hang|cho)$/.test(
      rawNameNoAcc
    );

    if (rawName && !isGenericItemWord) {
      const capPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
      const capName = rawName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const candidateFull = `${capPrefix} ${capName}`.trim();

      const matchedExisting = suppliers.find((s) =>
        stripAccents(s.ten_ncc).includes(stripAccents(candidateFull))
      );
      if (matchedExisting) {
        return { supplier_id: matchedExisting.id };
      }
      return { ten_ncc_moi: candidateFull };
    }
  }

  // 3. Nếu ông bà không nêu tên riêng mà chỉ nói mặt hàng ("Mua chịu gạo 2 triệu", "Trả nợ tiền nước ngọt 1tr")
  //    -> Khớp theo mặt hàng chính (mat_hang_chinh / ten_ncc) của NCC sẵn có trong sổ!
  for (const sup of suppliers) {
    const itemTokens = stripAccents(`${sup.ten_ncc} ${sup.mat_hang_chinh}`)
      .split(/[^a-z0-9]+/)
      .filter(
        (tk) =>
          tk.length >= 3 &&
          !['moi', 'cho', 'dai', 'hiep', 'hoa', 'tien', 'hang', 'can', 'tin'].includes(tk)
      );
    for (const tk of itemTokens) {
      if (new RegExp(`\\b${escapeRegExp(tk)}\\b`).test(noAccClause)) {
        return { supplier_id: sup.id };
      }
    }
  }

  // Nếu không khớp tên hoặc mặt hàng nào, trả về rỗng để hệ thống hỏi lại thay vì tự ý gán bừa
  return {};
}

const BUILTIN_DIALECT_SYNONYMS: Array<{ regex: RegExp; categoryId: string; boost: number }> = [
  // Đậu phụ, giò chả, đồ tươi hàng ngày
  { regex: /\b(bia dau|dau khuon|dau mo|dau phu ran|dau ran|dau hu|dau trang|gio song|cha que|cha lua|moc|gio lua)\b/, categoryId: 'cat_trung_dau_gio', boost: 25 },
  // Gia vị, mắm muối, tương bần, mắm tôm
  { regex: /\b(mam tep|mam tom|tuong ban|mam chat|nuoc mam cot|mi chinh|hat nem|xi dau|dau hao|bot canh)\b/, categoryId: 'cat_gia_vi_thang', boost: 25 },
  // Nước ngọt, sữa, giải khát căn tin
  { regex: /\b(sting|bo huc|redbull|revive|c2|tra xanh|tra chanh|sua chua uong|nuoc suoi|aquafina|lavie)\b/, categoryId: 'cat_nhap_nuoc_ct', boost: 25 },
  // Bánh kẹo, bim bim, kem căn tin
  { regex: /\b(keo mut|banh quy|kem que|kem oc que|thach|oishi|snack|banh gao|chocopie)\b/, categoryId: 'cat_nhap_banh_keo_ct', boost: 25 },
  // Ăn vặt căn tin
  { regex: /\b(xien banh|vien chien|ca vien chien|bo vien|xuc xich ran|banh mi cay)\b/, categoryId: 'cat_nhap_an_vat_ct', boost: 25 },
  // Thức ăn, thực phẩm chung, đi chợ
  { regex: /\b(thuc an|thuc pham|do an|di cho|do nau an)\b/, categoryId: 'cat_thit', boost: 25 },
  // Thịt các loại
  { regex: /\b(thit lon|thit ba chi|thit nac|thit ga|xuong ong|mong gio|thit vit|gio nac)\b/, categoryId: 'cat_thit', boost: 25 },
  // Thủy hải sản
  { regex: /\b(ca ro|ca tram|tom non|tom tuoi|ca dieu hong|ca basa|ca thu)\b/, categoryId: 'cat_ca_hai_san', boost: 25 },
  // Rau củ quả
  { regex: /\b(rau muong|rau ngot|mong toi|bap cai|bi xanh|ca chua|rau cai|cai ngot)\b/, categoryId: 'cat_rau_cu', boost: 25 },
];

/**
 * Nhận diện danh mục chi tiêu chuẩn xác nhất từ câu nói (khớp nguyên từ Unicode an toàn)
 */
function matchCategory(
  clause: string,
  categories: Category[]
): { category: Category; ambiguousSegment: boolean } {
  const lower = clause.toLowerCase();
  const noAcc = stripAccents(clause);

  const explicitCanTin = /\b(can tin|cantin|cang tin|quay)\b/.test(noAcc);
  const explicitBepAn = /\b(bep an|bep|nau com|hoc sinh)\b/.test(noAcc);

  let bestCat: Category | null = null;
  let bestScore = 0;

  const expenseCats = categories.filter((c) => c.nhom === 'chi');

  // 1. Khớp từ điển danh mục động (từ DB và được Admin dạy thêm từ khóa)
  for (const cat of expenseCats) {
    for (const kw of cat.tu_khoa_ai) {
      const kwLower = kw.toLowerCase().trim();
      const kwNoAcc = stripAccents(kwLower);
      const unicodeWordRe = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(kwLower)}(?![\\p{L}\\p{N}])`,
        'iu'
      );

      if (unicodeWordRe.test(lower)) {
        const score =
          kwLower.length + 12 + (explicitCanTin && cat.mang_mac_dinh === 'can_tin' ? 8 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestCat = cat;
        }
      } else if (kwNoAcc.length >= 3) {
        const asciiWordRe = new RegExp(`\\b${escapeRegExp(kwNoAcc)}\\b`);
        if (asciiWordRe.test(noAcc)) {
          const score =
            kwNoAcc.length + 5 + (explicitCanTin && cat.mang_mac_dinh === 'can_tin' ? 8 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestCat = cat;
          }
        }
      }
    }
  }

  // 2. Nếu chưa tìm được danh mục khớp mạnh, đối chiếu từ điển tiếng địa phương dựng sẵn
  if (bestScore < 15) {
    for (const syn of BUILTIN_DIALECT_SYNONYMS) {
      if (syn.regex.test(noAcc)) {
        const found = expenseCats.find((c) => c.id === syn.categoryId);
        if (found) {
          bestCat = found;
          bestScore = syn.boost;
          break;
        }
      }
    }
  }

  // Nếu câu có từ "nhập hàng căn tin" chung chung
  if (!bestCat && explicitCanTin) {
    bestCat =
      expenseCats.find((c) => c.id === 'cat_nhap_banh_keo_ct') ?? expenseCats[0];
  }

  if (!bestCat) {
    bestCat = expenseCats.find((c) => c.id === 'cat_do_kho_bep') ?? expenseCats[0];
  }

  // Mặt hàng dùng chung dễ mơ hồ giữa Bếp ăn & Căn tin (nếu ông bà không nói rõ mảng)
  const ambiguousWords = /\b(da vien|mua da|tui bong|giay an|coc|ong hut)\b/.test(noAcc);
  const ambiguousSegment = ambiguousWords && !explicitCanTin && !explicitBepAn;

  return { category: bestCat, ambiguousSegment };
}

/**
 * Trả lời câu hỏi báo cáo trực tiếp từ số liệu thật của sổ đang mở (KHÔNG ghi sổ)
 */
export function answerReportQuestion(
  clause: string,
  snapshot: BookSnapshot,
  referenceDate: string
): ParsedIntentItem {
  const noAcc = stripAccents(clause);
  const targetDate = parseVietnameseDate(clause, referenceDate);
  const targetMonth = parseVietnameseMonth(clause, referenceDate);

  // 1. Hỏi người ta nợ mình / khoản phải thu ("ai đang nợ mình", "có ai nợ không", "khách nợ bao nhiêu")
  if (/\b(ai dang no|ai no minh|nguoi ta no|khach no|co ai no|phai thu|khoan phai thu)\b/.test(noAcc)) {
    const debt = computeDebtAndPayables(snapshot, targetMonth);
    const khach = debt.phai_thu_khach.danh_sach.filter((d) => d.con_phai_thu > 0);
    const khachLines =
      khach.length === 0
        ? '• Hiện không có khách/giáo viên nào nợ tiền cơm'
        : khach.map((k) => `• ${k.doi_tac}: ${formatVND(k.con_phai_thu)}`).join('\n');
    const truongLine = `• Tiền trường chờ chuyển (kỳ ${targetMonth}): ${formatVND(
      debt.tien_truong_ky_nay.con_cho_chuyen
    )}`;
    return {
      intent: 'hoi',
      ngay: targetDate,
      ky_thang: targetMonth,
      chu_de_hoi: 'ai_no_minh',
      ghi_chu: 'Hỏi người ta nợ mình (khoản phải thu)',
      cau_tra_loi: `📗 Người ta nợ mình (${snapshot.book.ten}): ${formatVND(
        debt.tong_nguoi_ta_no
      )}\n${truongLine}\n${khachLines}`,
    };
  }

  // 2. Hỏi về các khoản mình đang nợ ("đang nợ những ai", "mình nợ ai", "nợ bao nhiêu")
  if (/\b(minh dang no|minh no ai|no nhung ai|dang no|con no|so no|no tien hang|no cho|no bao nhieu|no ai)\b/.test(noAcc)) {
    const debt = computeDebtAndPayables(snapshot, targetMonth);
    const activeDebts = debt.nha_cung_cap.danh_sach.filter((d) => d.con_no > 0);
    const detail =
      activeDebts.length === 0
        ? '• Không nợ tiền hàng nhà cung cấp'
        : activeDebts
            .map((d) => `• ${d.supplier.ten_ncc}: ${formatVND(d.con_no)}`)
            .join('\n');
    const luongLine = `• Lương thợ kỳ ${targetMonth}: còn phải trả ${formatVND(
      debt.luong_tho_ky_nay.con_phai_tra
    )}`;
    return {
      intent: 'hoi',
      ngay: targetDate,
      chu_de_hoi: 'so_no_ncc',
      ghi_chu: 'Hỏi các khoản mình đang nợ',
      cau_tra_loi: `📕 Tổng khoản mình nợ (${snapshot.book.ten}): ${formatVND(
        debt.tong_minh_no
      )}\n${detail}\n${luongLine}`,
    };
  }

  // 2. Hỏi tiền trường chuyển ("tháng này trường chuyển tiền chưa", "tiền trường bao nhiêu")
  if (/\b(truong chuyen|truong tra|tien truong|mo diep nhan)\b/.test(noAcc)) {
    const debt = computeDebtAndPayables(snapshot, targetMonth);
    const t = debt.tien_truong_ky_nay;
    const statusLine =
      t.truong_da_chuyen > 0
        ? `Nhà trường đã chuyển ${formatVND(t.truong_da_chuyen)} (còn chờ ${formatVND(
            t.con_cho_chuyen
          )}).`
        : `Nhà trường chưa chuyển tiền kỳ ${targetMonth} ạ.`;
    return {
      intent: 'hoi',
      ngay: targetDate,
      ky_thang: targetMonth,
      chu_de_hoi: 'tien_truong',
      ghi_chu: `Hỏi tiền trường kỳ ${targetMonth}`,
      cau_tra_loi: `🏫 Kỳ ${targetMonth} (${snapshot.book.ten}):\n• Đã nấu: ${
        t.tong_suat_truong
      } suất trường → Dự kiến ${formatVND(t.so_tien_du_kien)}\n• ${statusLine}`,
    };
  }

  // 3. Hỏi lương thợ ("lương thợ tháng này bao nhiêu", "công thợ")
  if (/\b(luong tho|luong cong nhan|luong phu bep|cong tho|tien luong)\b/.test(noAcc)) {
    const debt = computeDebtAndPayables(snapshot, targetMonth);
    const l = debt.luong_tho_ky_nay;
    return {
      intent: 'hoi',
      ngay: targetDate,
      ky_thang: targetMonth,
      chu_de_hoi: 'luong_tho',
      ghi_chu: `Hỏi lương thợ kỳ ${targetMonth}`,
      cau_tra_loi: `👷 Lương phụ bếp kỳ ${targetMonth}: Tổng tính công ${formatVND(
        l.tong_luong_tinh_theo_cong
      )}, đã trả/ứng ${formatVND(l.da_tra_hoac_ung)}, còn phải trả ${formatVND(
        l.con_phai_tra
      )}.`,
    };
  }

  // 4. Hỏi số dư ví / tiền mặt ("tiền mặt còn bao nhiêu", "trong tài khoản có bao nhiêu")
  if (
    /\b(tien mat|so du|con bao nhieu tien|vi con|tai khoan|tk chi nhan|tk mo diep|dong tien)\b/.test(
      noAcc
    )
  ) {
    const balances = computeWalletBalances(
      snapshot.wallets,
      snapshot.transactions,
      snapshot.book.id
    );
    const lines = balances
      .map((b) => `• ${b.wallet.ten_vi}: ${formatVND(b.so_du_hien_tai)}`)
      .join('\n');
    const total = balances.reduce((s, b) => s + b.so_du_hien_tai, 0);
    return {
      intent: 'hoi',
      ngay: targetDate,
      chu_de_hoi: 'so_du_vi',
      ghi_chu: 'Hỏi số dư tiền thực tế',
      cau_tra_loi: `💰 Tiền thực có tại ${snapshot.book.ten}: ${formatVND(total)}\n${lines}`,
    };
  }

  // 5. Hỏi lãi tháng ("tháng này lãi bao nhiêu", "lợi nhuận tháng")
  if (/\b(thang nay|thang truoc|thang \d+|ca thang|loi nhuan thang)\b/.test(noAcc)) {
    const m = computeMonthlyReport(snapshot, targetMonth);
    return {
      intent: 'hoi',
      ngay: targetDate,
      ky_thang: targetMonth,
      chu_de_hoi: 'lai_thang',
      ghi_chu: `Hỏi lãi tháng ${targetMonth}`,
      cau_tra_loi: `📊 Tháng ${targetMonth} (${snapshot.book.ten}):\n• Lãi Bếp ăn: ${formatVND(
        m.bep_an.lai_bep_an,
        true
      )}\n• Lãi Căn tin: ${formatVND(
        m.can_tin.lai_can_tin,
        true
      )}\n• Chi phí chung cuối tháng: -${formatVND(m.chi_cuoi_thang_chung)}${
        m.la_uoc_tinh_tu_thang_truoc ? ' (tạm tính theo tháng trước)' : ''
      }\n👉 Lãi ròng toàn cơ sở: ${formatVND(m.lai_rong_toan_co_so, true)}`,
    };
  }

  // 6. Mặc định: Hỏi lãi hôm nay / tổng kết ngày cụ thể
  const daily = computeDailyReport(snapshot, targetDate);
  const debt = computeDebtAndPayables(snapshot, targetMonth);
  const balances = computeWalletBalances(snapshot.wallets, snapshot.transactions, snapshot.book.id);
  const totalWallet = balances.reduce((s, b) => s + b.so_du_hien_tai, 0);

  return {
    intent: 'hoi',
    ngay: targetDate,
    chu_de_hoi: 'lai_hom_nay',
    ghi_chu: `Tổng kết ngày ${targetDate}`,
    cau_tra_loi: `📊 Ngày ${targetDate} (${snapshot.book.ten}):\n• 🍲 Bếp ăn: Thu ${formatVND(
      daily.bep_an.tong_doanh_thu
    )} − Chi ${formatVND(daily.bep_an.tong_chi_ngay)} = Lãi ước tính ${formatVND(
      daily.bep_an.lai_uoc_tinh_ngay,
      true
    )}\n• 🏪 Căn tin: Thu ${formatVND(daily.can_tin.doanh_thu_can_tin)} · Nhập ${formatVND(
      daily.can_tin.chi_nhap_hang_ngay
    )}\n• 💰 Tiền thực có: ${formatVND(totalWallet)}\n• 📕 Mình nợ: ${formatVND(
      debt.tong_minh_no
    )} · 📗 Người ta nợ: ${formatVND(debt.tong_nguoi_ta_no)}`,
  };
}

/**
 * Thử bóc tách suất ăn từ 1 đoạn câu (VD: "sáng 150", "trưa 320 suất", "tối 80", "vãng lai trưa 5")
 */
function extractMealsFromText(text: string): {
  matched: boolean;
  counts: NonNullable<ParsedIntentItem['suat_an']>;
} {
  const noAcc = stripAccents(text);
  // Tránh nhầm với câu tiền ("sáng mua thịt 150k", "tối thu 800k")
  if (
    /\b(mua|nhap|lay|tra|no|thu|chuyen khoan|ck|tien mat|trieu|tram|chuc|nghin|ngan|dong|\d+k)\b/.test(
      noAcc
    )
  ) {
    return { matched: false, counts: {} };
  }

  const counts: NonNullable<ParsedIntentItem['suat_an']> = {};
  let matched = false;

  // Bắt vãng lai trước: "vãng lai trưa 5", "trưa vãng lai 5", "thêm 6 khách vãng lai ăn tối", "5 người ăn ngoài buổi sáng"
  const vlPatterns: Array<{ regex: RegExp; key: keyof typeof counts }> = [
    {
      regex:
        /\b(?:vang lai|khach ngoai|an ngoai)\s+(?:an\s+|bua\s+|buoi\s+)?sang\s+(\d{1,4})\b/,
      key: 'sang_vang_lai',
    },
    {
      regex:
        /\bsang\s+(?:co\s+|them\s+)?(?:vang lai|khach ngoai|an ngoai)\s+(\d{1,4})\b/,
      key: 'sang_vang_lai',
    },
    {
      regex:
        /\b(\d{1,4})\s*(?:suat|xuat|nguoi|khach)?\s*(?:vang lai|khach ngoai|an ngoai)\s*(?:an\s+|bua\s+|buoi\s+)?sang\b/,
      key: 'sang_vang_lai',
    },
    {
      regex:
        /\b(?:vang lai|khach ngoai|an ngoai)\s+(?:an\s+|bua\s+|buoi\s+)?trua\s+(\d{1,4})\b/,
      key: 'trua_vang_lai',
    },
    {
      regex:
        /\btrua\s+(?:nay\s+)?(?:co\s+|them\s+)?(?:vang lai|khach ngoai|an ngoai)\s+(\d{1,4})\b/,
      key: 'trua_vang_lai',
    },
    {
      regex:
        /\b(\d{1,4})\s*(?:suat|xuat|nguoi|khach)?\s*(?:vang lai|khach ngoai|an ngoai)\s*(?:an\s+|bua\s+|buoi\s+)?trua\b/,
      key: 'trua_vang_lai',
    },
    {
      regex:
        /\b(?:vang lai|khach ngoai|an ngoai)\s+(?:an\s+|bua\s+|buoi\s+)?toi\s+(\d{1,4})\b/,
      key: 'toi_vang_lai',
    },
    {
      regex:
        /\btoi\s+(?:nay\s+)?(?:co\s+|them\s+)?(?:vang lai|khach ngoai|an ngoai)\s+(\d{1,4})\b/,
      key: 'toi_vang_lai',
    },
    {
      regex:
        /\b(\d{1,4})\s*(?:suat|xuat|nguoi|khach)?\s*(?:vang lai|khach ngoai|an ngoai)\s*(?:an\s+|bua\s+|buoi\s+)?toi\b/,
      key: 'toi_vang_lai',
    },
    { regex: /\b(?:vang lai|khach ngoai|an ngoai)\s+(\d{1,4})\b/, key: 'trua_vang_lai' },
    {
      regex: /\b(\d{1,4})\s*(?:suat|xuat|nguoi|khach)\s*(?:vang lai|khach ngoai|an ngoai)\b/,
      key: 'trua_vang_lai',
    },
  ];

  let cleanedForSchool = noAcc;
  for (const p of vlPatterns) {
    const m = cleanedForSchool.match(p.regex);
    if (m) {
      counts[p.key] = (counts[p.key] ?? 0) + Number(m[1]);
      cleanedForSchool = cleanedForSchool.replace(m[0], ' ');
      matched = true;
    }
  }

  // Bắt suất trường: "sáng 150", "trưa 320 suất", "tối 80"
  const sangM = cleanedForSchool.match(/\b(?:bua\s+|buoi\s+)?sang\s*(?:nau\s*|bao\s*)?(\d{1,4})\b/);
  if (sangM) {
    counts.sang_truong = Number(sangM[1]);
    matched = true;
  }
  const truaM = cleanedForSchool.match(/\b(?:bua\s+|buoi\s+)?trua\s*(?:nau\s*|bao\s*)?(\d{1,4})\b/);
  if (truaM) {
    counts.trua_truong = Number(truaM[1]);
    matched = true;
  }
  const toiM = cleanedForSchool.match(/\b(?:bua\s+|buoi\s+)?toi\s*(?:nau\s*|bao\s*)?(\d{1,4})\b/);
  if (toiM) {
    counts.toi_truong = Number(toiM[1]);
    matched = true;
  }

  // Nếu chỉ nói "Hôm nay nấu 320 suất" hoặc "Trường báo 280 suất" (không nói sáng/trưa/tối) -> mặc định bữa trưa
  if (!matched) {
    const genericMeal = cleanedForSchool.match(
      /\b(?:nau|bao|truong bao)\s+(\d{1,4})\s*(?:suat|xuat)?\b|\b(\d{1,4})\s*(?:suat|xuat)\b/
    );
    if (genericMeal) {
      const n = Number(genericMeal[1] || genericMeal[2]);
      if (n > 0) {
        counts.trua_truong = n;
        matched = true;
      }
    }
  }

  return { matched, counts };
}

/**
 * Thử bóc tách chấm công công nhân từ câu nói
 */
function tryParseAttendance(
  fullText: string,
  snapshot: BookSnapshot,
  ngay: string
): ParsedIntentItem | null {
  const noAcc = stripAccents(fullText);
  const activeWorkers = snapshot.workers.filter((w) => w.dang_lam);
  if (activeWorkers.length === 0) return null;

  if (/\b(tra luong|ung luong|thanh toan luong)\b/.test(noAcc)) return null;

  // Trường hợp 1: "Hôm nay thợ đi làm đủ hết" / "Chấm công đủ cả đội"
  if (
    /\b(di lam du|lam du het|cham cong du|phu bep lam du|tat ca di lam|di lam ca)\b/.test(noAcc)
  ) {
    return {
      intent: 'cham_cong',
      ngay,
      cham_cong: activeWorkers.map((w) => ({
        worker_id: w.id,
        ho_ten: w.ho_ten,
        so_cong: 1,
      })),
      ghi_chu: 'Cả đội phụ bếp đi làm đủ công',
    };
  }

  // Trường hợp 1b: Thuê/chấm công theo số lượng công nhân ("thuê 2 cô công nhân để nấu ăn", "hôm nay có 2 cô phụ bếp", "2 thợ nấu ăn")
  const workerCountMatch = noAcc.match(
    /\b(?:thue|co|cham cong|cham cho)?\s*(\d+)\s*(?:co|nguoi|cong nhan|tho|phu bep)\s*(?:cong nhan\s*)?(?:de\s+)?(?:nau an|lam com|di lam|phu bep|lam bep)?\b/
  );
  if (
    workerCountMatch &&
    /\b(thue|cong nhan|phu bep|nau an|lam bep|di lam|cham cong)\b/.test(noAcc) &&
    parseVietnameseMoney(fullText) === null
  ) {
    const requestedCount = parseInt(workerCountMatch[1], 10);
    if (requestedCount > 0) {
      const selectedWorkers = activeWorkers.slice(0, requestedCount);
      return {
        intent: 'cham_cong',
        ngay,
        cham_cong: selectedWorkers.map((w) => ({
          worker_id: w.id,
          ho_ten: w.ho_ten,
          so_cong: 1,
        })),
        ghi_chu: `Chấm công ${requestedCount} phụ bếp đi làm`,
      };
    }
  }

  const hasAttVerb = /\b(cham cong|di lam|du cong|1 cong|mot cong|nghi|vang|nua buoi|nua cong)\b/.test(
    noAcc
  );
  if (!hasAttVerb) return null;

  // Không được là câu mua hàng có số tiền (VD: "lấy thịt chị Hoa 2 triệu")
  if (parseVietnameseMoney(fullText) !== null) return null;

  const mentionedWorkers: Array<{ id: string; shortKey: string }> = [];
  for (const w of activeWorkers) {
    const cleanName = stripAccents(w.ho_ten.replace(/\(.*?\)/g, '').trim());
    if (cleanName && noAcc.includes(cleanName)) {
      mentionedWorkers.push({ id: w.id, shortKey: cleanName });
    } else {
      const parts = cleanName.split(/\s+/);
      if (parts.length >= 2) {
        const twoLast = parts.slice(-2).join(' ');
        if (noAcc.includes(twoLast)) {
          mentionedWorkers.push({ id: w.id, shortKey: twoLast });
        }
      }
    }
  }

  if (mentionedWorkers.length === 0) return null;

  const segments = noAcc.split(/[,;]|(?:\bnhung\b)|(?:\bcon\b)/);
  const statusMap = new Map<string, 0 | 0.5 | 1>();

  for (const seg of segments) {
    const isOff = /\b(nghi|vang)\b/.test(seg);
    const isHalf = /\b(nua buoi|nua cong|0\.5|0,5)\b/.test(seg);
    const val: 0 | 0.5 | 1 = isOff ? 0 : isHalf ? 0.5 : 1;

    for (const mw of mentionedWorkers) {
      if (seg.includes(mw.shortKey)) {
        statusMap.set(mw.id, val);
      }
    }
  }

  const resultList = activeWorkers.map((w) => ({
    worker_id: w.id,
    ho_ten: w.ho_ten,
    so_cong: statusMap.has(w.id)
      ? statusMap.get(w.id)!
      : Array.from(statusMap.values()).every((v) => v === 0)
      ? (1 as const)
      : (0 as const),
  }));

  return {
    intent: 'cham_cong',
    ngay,
    cham_cong: resultList,
    ghi_chu: fullText.trim(),
  };
}

function hasRealSpendVerb(text: string): boolean {
  const lower = text.toLowerCase();
  const noAcc = stripAccents(text);
  // Phân biệt chữ "chi" (chi tiêu) với "chị" (chị Nhàn, chị Hoa...)
  const literalChi =
    /(?<![\p{L}\p{N}])chi(?!\s+(?:nhan|nhàn|hoa|huong|hương|lan|mai|diep|diệp))(?![\p{L}\p{N}])/u.test(
      lower
    );
  return literalChi || /\b(nhap|mua|lay|tra no|tra luong)\b/.test(noAcc);
}

function isCollectionTriggerClause(text: string): boolean {
  const noAcc = stripAccents(text);
  if (hasRealSpendVerb(text) && !/\b(thu|ban duoc)\b/.test(noAcc)) {
    return false;
  }
  return (
    /\b(can tin|cantin|cang tin|thu cuoi ngay|tong thu|tien quay|ban hang hom nay)\b/.test(
      noAcc
    ) && !/\?|\bbao nhieu\b|\bbn\b/.test(noAcc)
  );
}

/**
 * Thử bóc tách Thu cuối ngày (Căn tin + Vãng lai — Cách A)
 * Đặc biệt xử lý câu mơ hồ: "Căn tin hôm nay 2 triệu 3, chuyển khoản 800" -> Hỏi lại 2 nút!
 */
function tryParseDailyCollection(
  fullText: string,
  ngay: string,
  options: { wholeSentenceMode?: boolean } = {}
): ParsedIntentItem | null {
  const noAcc = stripAccents(fullText);

  // Nếu ở chế độ nguyên câu mà câu có lẫn việc mua chợ / báo suất ăn / chấm công -> để bộ tách đa mệnh đề xử lý!
  if (options.wholeSentenceMode) {
    if (
      hasRealSpendVerb(fullText) ||
      /\b(cham cong|suat|xuat|vang lai)\b/.test(noAcc)
    ) {
      return null;
    }
  } else {
    if (hasRealSpendVerb(fullText) && !/\b(thu|ban duoc)\b/.test(noAcc)) {
      return null;
    }
  }

  if (!isCollectionTriggerClause(fullText)) return null;

  // Tách phần tiền mặt và phần chuyển khoản (dùng Unicode boundary cho "và", "với", "còn")
  const parts = fullText.split(
    /[,;]|(?<![\p{L}\p{N}])(?:và|với|còn)(?![\p{L}\p{N}])/iu
  );
  let explicitCash: number | null = null;
  let explicitCk: number | null = null;
  let explicitTotal: number | null = null;
  let unlabeledFirstAmount: number | null = null;

  for (const part of parts) {
    const pNoAcc = stripAccents(part);
    const amt = parseVietnameseMoney(part, { allowBareThousands: true });
    if (amt === null) continue;

    if (/\b(chuyen khoan|ck|chi nhan|tk nhan)\b/.test(pNoAcc)) {
      explicitCk = (explicitCk ?? 0) + amt;
    } else if (/\b(tien mat|tm)\b/.test(pNoAcc)) {
      explicitCash = (explicitCash ?? 0) + amt;
    } else if (/\b(tong|tat ca|ca ngay|gom)\b/.test(pNoAcc) || /\btrong do\b/.test(noAcc)) {
      explicitTotal = amt;
    } else if (unlabeledFirstAmount === null) {
      unlabeledFirstAmount = amt;
    }
  }

  // Trường hợp 1: Rõ ràng Tiền mặt (và có thể kèm Chuyển khoản)
  if (
    explicitCash !== null ||
    (explicitTotal === null && unlabeledFirstAmount === null && explicitCk !== null)
  ) {
    return {
      intent: 'thu_can_tin',
      ngay,
      thu_cuoi_ngay: {
        tien_mat: explicitCash ?? 0,
        chuyen_khoan: explicitCk ?? 0,
      },
      ghi_chu: fullText.trim(),
    };
  }

  // Trường hợp 2: Nói rõ "Tổng 2 triệu 3, trong đó chuyển khoản 800"
  if (explicitTotal !== null && explicitCk !== null) {
    return {
      intent: 'thu_can_tin',
      ngay,
      thu_cuoi_ngay: {
        tien_mat: Math.max(0, explicitTotal - explicitCk),
        chuyen_khoan: explicitCk,
      },
      ghi_chu: fullText.trim(),
    };
  }

  // Trường hợp 3: Chỉ có 1 con số duy nhất ("Căn tin hôm nay thu 2 triệu 3" / "Tổng thu căn tin 2 triệu")
  const singleAmount = unlabeledFirstAmount ?? explicitTotal;
  if (singleAmount !== null && explicitCk === null) {
    return {
      intent: 'thu_can_tin',
      ngay,
      thu_cuoi_ngay: {
        tien_mat: singleAmount,
        chuyen_khoan: 0,
      },
      ghi_chu: fullText.trim(),
    };
  }

  // Trường hợp 4 (MƠ HỒ KINH ĐIỂN): "Căn tin hôm nay 2 triệu 3, chuyển khoản 800"
  if (unlabeledFirstAmount !== null && explicitCk !== null) {
    const optTotal = unlabeledFirstAmount + explicitCk;
    const optSubCash = Math.max(0, unlabeledFirstAmount - explicitCk);

    return {
      intent: 'thu_can_tin',
      ngay,
      thu_cuoi_ngay: {
        tien_mat: unlabeledFirstAmount,
        chuyen_khoan: explicitCk,
      },
      ghi_chu: fullText.trim(),
      cau_hoi_lam_ro: `Số ${formatVND(
        unlabeledFirstAmount
      )} là riêng Tiền mặt hay là Tổng cả ngày (đã gồm chuyển khoản) ạ?`,
      lua_chon_lam_ro: [
        {
          id: 'rieng_tm',
          label: `Tiền mặt ${formatVND(unlabeledFirstAmount)} + CK ${formatVND(
            explicitCk
          )} (= ${formatVND(optTotal)})`,
          patch: {
            thu_cuoi_ngay: { tien_mat: unlabeledFirstAmount, chuyen_khoan: explicitCk },
          },
        },
        {
          id: 'tong_gom_ck',
          label: `Tổng là ${formatVND(unlabeledFirstAmount)} (TM ${formatVND(
            optSubCash
          )} + CK ${formatVND(explicitCk)})`,
          patch: {
            thu_cuoi_ngay: { tien_mat: optSubCash, chuyen_khoan: explicitCk },
          },
        },
      ],
    };
  }

  return null;
}

/**
 * Thử bóc tách Bán chịu / Khách nợ tiền cơm / Thu nợ từ khách
 */
function tryParseCustomerReceivable(
  clause: string,
  snapshot: BookSnapshot,
  globalDate: string
): ParsedIntentItem | null {
  const clauseNoAcc = stripAccents(clause);

  // 1. Khách trả nợ / Thu nợ: "Cô Lan trả nợ 105k", "Cô Lan trả tiền cơm 105k", "Bác Hùng trả nợ", "Thu nợ cô Lan 105k"
  const isPayDebt =
    /\b(tra no|tra tien com|tra tien an|tra tien co|thanh toan no com|thu no)\b/.test(clauseNoAcc) &&
    !/\b(tra luong|tra tien dien|tra tien nuoc|tra tien gas|tra tien ga|tra tien rac)\b/.test(clauseNoAcc);

  if (isPayDebt) {
    const supRes = resolveSupplierFromClause(clause, snapshot.suppliers);
    const hasNccMatch = !!supRes.supplier_id && !/\b(tien com|tien an|thu no|an chiu)\b/.test(clauseNoAcc);
    if (!hasNccMatch) {
      const amt = parseVietnameseMoney(clause, { allowBareThousands: true });
      const nameMatch =
        clause.match(/(?:cô|bác|chị|anh|chú|bà|ông|thầy|cô giáo)\s+[\p{L}]+/iu) ||
        clause.match(/(?:thu nợ|trả nợ|tiền cơm của)\s+([\p{L}\s]+?)(?:\s+\d|\s+tiền|$)/iu);
      const partnerName = nameMatch
        ? nameMatch[0].replace(/^(thu nợ|trả nợ|tiền cơm của)\s+/iu, '').trim()
        : 'Khách vãng lai';
      const vi = detectWalletKind(clause, 'tien_mat');

      if (amt !== null && amt > 0) {
        return {
          intent: 'thu_no',
          ngay: globalDate,
          doi_tac: partnerName,
          so_tien: amt,
          vi: vi,
          ghi_chu: clause,
        };
      }
    }
  }

  // 2. Bán chịu / Khách nợ: "Cô Lan ăn chịu 3 suất", "Cô Lan nợ tiền cơm 105k", "Bác Hùng nợ tiền cơm 150k", "Bán 20 suất cỗ 1tr5 chưa lấy tiền", "Khách nợ 50k"
  if (/\b(mua|nhap|lay hang|chi|thue)\b/.test(clauseNoAcc)) {
    return null;
  }
  const isCreditSale =
    /\b(an chiu|no tien com|no tien an|no tien co|chua lay tien|no \d+\s*suat|an no)\b/.test(clauseNoAcc) ||
    /(?:cô|bác|chị|anh|chú|bà|ông|khách|giao vien)\s+[\p{L}]+\s+(?:nợ|chiu|chưa trả)/iu.test(clauseNoAcc);

  if (isCreditSale) {
    let amt = parseVietnameseMoney(clause, { allowBareThousands: true });
    if (amt === null || amt === 0) {
      const suatMatch =
        clause.match(/(\d+)\s*(?:suất|xuất|suat|xuat)/iu) ||
        clauseNoAcc.match(/(\d+)\s*suat/i);
      if (suatMatch) {
        const soSuat = parseInt(suatMatch[1], 10);
        const dg = getEffectiveMealPrice(snapshot.mealPrices, snapshot.book.id, 'trua', 'vang_lai', globalDate);
        amt = soSuat * (dg > 0 ? dg : 35000);
      }
    }

    const nameMatch = clause.match(/(?:cô|bác|chị|anh|chú|bà|ông|thầy|cô giáo|khách|bàn)\s+[\p{L}\d]+/iu);
    const partnerName = nameMatch ? nameMatch[0].trim() : 'Khách nợ cơm';
    const isCanTin = /\b(can tin|cantin|cang tin|nuoc|banh|keo)\b/.test(clauseNoAcc);

    if (amt !== null && amt > 0) {
      return {
        intent: 'ban_chiu',
        ngay: globalDate,
        mang: isCanTin ? 'can_tin' : 'bep_an',
        doi_tac: partnerName,
        so_tien: amt,
        ghi_chu: clause,
      };
    }
  }

  return null;
}

/**
 * BỘ PHÂN TÍCH NGÔN NGỮ TỰ NHIÊN TIẾNG VIỆT (LOCAL NLU ENGINE)
 * Xử lý tức thì cả câu đơn, câu ghép nhiều việc, từ địa phương, viết tắt, thiếu dấu.
 */
export function parseVietnameseCommandLocal(
  rawInput: string,
  snapshot: BookSnapshot,
  referenceDate: string
): AIParseResult {
  // Đổi dấu phẩy phân cách hàng nghìn (VD: "1,250,000" từ bàn phím/ASR) thành dấu chấm trước khi tách mệnh đề bằng dấu phẩy
  const trimmed = String(rawInput || '')
    .replace(/(\d),(\d{3}),(\d{3})(?![\d])/g, '$1.$2.$3')
    .replace(
      /(\d),(\d{3})(?![\d]|\s*(?:triệu|tr|củ|nghìn|ngàn|nghin|ngan|k)(?![\p{L}\p{N}]))/giu,
      '$1.$2'
    )
    .trim();
  if (!trimmed) {
    return {
      engine: 'local_vn',
      raw_text: rawInput,
      items: [
        {
          intent: 'khong_ro',
          ngay: referenceDate,
          ghi_chu: '',
          cau_tra_loi: 'Ông/bà gõ hoặc nói nội dung cần ghi sổ giúp con nhé!',
        },
      ],
    };
  }

  const noAccFull = stripAccents(trimmed);
  const globalDate = parseVietnameseDate(trimmed, referenceDate);
  const globalMonth = parseVietnameseMonth(trimmed, referenceDate);

  // 1. CÂU HỎI BÁO CÁO (Trả lời số liệu thật, tuyệt đối không ghi sổ)
  // Phải phân biệt rõ: nếu câu có động từ giao dịch/hành động (mua, bán, thuê, chấm công...) kèm số tiền/số lượng
  // thì ĐÂY LÀ GHI SỔ, TUYỆT ĐỐI KHÔNG BỊ NHẬN NHẦM THÀNH CÂU HỎI BÁO CÁO!
  const hasTransactionAction =
    /\b(vua mua|mua|nhap|lay hang|lay|chi|thue|ban|thu cuoi ngay|cham cong|tra no|tra luong|ung luong)\b/.test(
      noAccFull
    ) &&
    (parseVietnameseMoney(trimmed, { allowBareThousands: true }) !== null ||
      /\b\d+\s*(?:suat|nguoi|co|tho|cong|kg|can)\b/.test(noAccFull));

  const isExplicitQuestion =
    trimmed.includes('?') ||
    /\b(bao nhieu|lai bn|con bn|loi nhuan|bao cao|tong ket|nhung ai|ai no|minh no|may dong|xem lai|xem so|xem no|kiem tra so|the nao|ntn|ra sao|sao roi)\b/.test(
      noAccFull
    ) ||
    (/\b(chuyen tien chua|da chuyen chua|ve chua)\b/.test(noAccFull) &&
      !/\b(chua tra|chua thanh toan|chua dua|chua lay)\b/.test(noAccFull)) ||
    (/^(cho bo hoi|cho me hoi|hoi xem|xem xem)\b/.test(noAccFull) &&
      /\b(bn|the nao|ntn|sao roi|chua)\b/.test(noAccFull));

  const isQuestion = isExplicitQuestion && !hasTransactionAction;

  if (isQuestion) {
    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [answerReportQuestion(trimmed, snapshot, referenceDate)],
    };
  }

  // 2. GIỐNG HÔM QUA ("Suất ăn giống hôm qua", "Nấu giống hôm trước")
  if (/\b(giong hom qua|nhu hom qua|bang hom qua|giong hom truoc|y nhu hom qua)\b/.test(noAccFull)) {
    const prev = findPreviousMealDay(snapshot.mealCounts, snapshot.book.id, globalDate);
    if (prev) {
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [
          {
            intent: 'giong_hom_qua',
            ngay: globalDate,
            suat_an: {
              sang_truong: prev.sang,
              trua_truong: prev.trua,
              toi_truong: prev.toi,
            },
            ghi_chu: `Chép số suất trường từ ngày ${prev.ngay}`,
          },
        ],
      };
    }
    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [
        {
          intent: 'khong_ro',
          ngay: globalDate,
          ghi_chu: trimmed,
          cau_tra_loi:
            'Chưa tìm thấy số suất ăn của các ngày trước trong sổ. Ông/bà nhắn rõ số suất (VD: "Sáng 150, trưa 320") giúp con nhé!',
        },
      ],
    };
  }

  // 3. NHÀ TRƯỜNG CHUYỂN TIỀN ĂN
  if (
    /\b(truong chuyen|truong tra|truong thanh toan|mo diep nhan|tien an truong ve|tien truong ve)\b/.test(
      noAccFull
    )
  ) {
    const amt = parseVietnameseMoney(trimmed, { allowBareThousands: true });
    if (amt !== null && amt > 0) {
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [
          {
            intent: 'truong_chuyen',
            ngay: globalDate,
            ky_thang: globalMonth,
            so_tien: amt,
            vi: detectWalletKind(trimmed, 'tk_mo_diep'),
            ghi_chu: trimmed,
          },
        ],
      };
    }
  }

  // 4. CHUYỂN QUỸ / RÚT TIỀN GIỮA CÁC VÍ
  if (
    /\b(rut .* tu .* ve|rut .* tk|chuyen quy|chi nhan dua tien mat|mo diep dua tien mat|chuyen tu .* sang|nop tien mat vao)\b/.test(
      noAccFull
    )
  ) {
    const amt = parseVietnameseMoney(trimmed, { allowBareThousands: true });
    if (amt !== null && amt > 0) {
      let fromVi: WalletKind = 'tk_chi_nhan';
      let toVi: WalletKind = 'tien_mat';
      if (/\bmo diep\b/.test(noAccFull)) fromVi = 'tk_mo_diep';
      if (/\bnop\b|\bchuyen tu tien mat sang\b|\bchuyen vao tk\b/.test(noAccFull)) {
        fromVi = 'tien_mat';
        toVi = /\bmo diep\b/.test(noAccFull) ? 'tk_mo_diep' : 'tk_chi_nhan';
      }
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [
          {
            intent: 'chuyen_quy',
            ngay: globalDate,
            so_tien: amt,
            vi: fromVi,
            sang_vi: toVi,
            ghi_chu: trimmed,
          },
        ],
      };
    }
  }

  // 5. TRẢ / ỨNG LƯƠNG CÔNG NHÂN ("Trả lương thợ tháng 10", "Ứng lương cô Lan 1 triệu")
  if (/\b(tra luong|ung luong|thanh toan luong)\b/.test(noAccFull)) {
    const debt = computeDebtAndPayables(snapshot, globalMonth);
    let matchedWorkerId: string | undefined;
    for (const w of snapshot.workers) {
      const cleanW = stripAccents(w.ho_ten.replace(/\(.*?\)/g, '').trim());
      const shortW = cleanW.split(/\s+/).slice(-2).join(' ');
      if ((cleanW && noAccFull.includes(cleanW)) || (shortW && noAccFull.includes(shortW))) {
        matchedWorkerId = w.id;
        break;
      }
    }

    let amt = parseVietnameseMoney(trimmed, { allowBareThousands: true });
    if (amt === null) {
      if (matchedWorkerId) {
        amt =
          debt.luong_tho_ky_nay.chi_tiet_tho.find((x) => x.worker.id === matchedWorkerId)
            ?.con_lai ?? 0;
      } else {
        amt = debt.luong_tho_ky_nay.con_phai_tra;
      }
    }

    if (amt !== null && amt > 0) {
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [
          {
            intent: 'tra_luong',
            ngay: globalDate,
            ky_thang: globalMonth,
            so_tien: amt,
            vi: detectWalletKind(trimmed, 'tien_mat'),
            worker_id: matchedWorkerId,
            ghi_chu: trimmed,
          },
        ],
      };
    }

    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [
        {
          intent: 'khong_ro',
          ngay: globalDate,
          ghi_chu: trimmed,
          cau_tra_loi: `Kỳ ${globalMonth} hiện chưa có công thợ chưa trả (0 đ). Ông/bà nói kèm số tiền cụ thể nhé (VD: "Trả lương thợ 12 triệu")!`,
        },
      ],
    };
  }

  // 5b. BÁN CHỊU / THU NỢ KHÁCH NGUYÊN CÂU (Ưu tiên trước trả nợ NCC để không nhầm "Cô Lan trả nợ" thành mình trả nợ)
  const recItem = tryParseCustomerReceivable(trimmed, snapshot, globalDate);
  if (recItem) {
    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [recItem],
    };
  }

  // 6. TRẢ NỢ NHÀ CUNG CẤP ("Trả nợ mối thịt 1 triệu", "Trả chị Hoa 1 triệu")
  const startsWithPay =
    /\b(tra no|thanh toan no|tra tien no|tra bot no)\b/.test(noAccFull) ||
    (/^tra\s+(chi|co|ba|bac|anh|chu|ong|dai ly|moi|tien)\b/.test(noAccFull) &&
      !/\b(tra luong|tra tien dien|tra tien nuoc|tra tien gas|tra tien ga|tra tien rac)\b/.test(
        noAccFull
      ));
  if (startsWithPay) {
    const amt = parseVietnameseMoney(trimmed, { allowBareThousands: true });
    const supRes = resolveSupplierFromClause(trimmed, snapshot.suppliers);
    if (amt !== null && amt > 0) {
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [
          {
            intent: 'tra_no',
            ngay: globalDate,
            so_tien: amt,
            vi: detectWalletKind(trimmed, 'tien_mat'),
            supplier_id: supRes.supplier_id,
            ten_ncc_moi: supRes.ten_ncc_moi,
            ghi_chu: trimmed,
          },
        ],
      };
    }
  }

  // 7. THU CUỐI NGÀY CĂN TIN NGUYÊN CÂU (nếu không lẫn mua chợ / suất ăn)
  const collectionItem = tryParseDailyCollection(trimmed, globalDate, { wholeSentenceMode: true });
  if (collectionItem) {
    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [collectionItem],
    };
  }

  // 8. CHẤM CÔNG THỢ NGUYÊN CÂU (chỉ khi câu không chứa các hành động giao dịch / mua bán khác)
  const hasOtherNonAttActions =
    hasRealSpendVerb(trimmed) ||
    /\b(suat|xuat|thu cuoi ngay|tien quay|ban duoc|tra no)\b/.test(noAccFull);

  if (!hasOtherNonAttActions) {
    const attItem = tryParseAttendance(trimmed, snapshot, globalDate);
    if (attItem) {
      return {
        engine: 'local_vn',
        raw_text: trimmed,
        items: [attItem],
      };
    }
  }

  // 9. TÁCH ĐA MỆNH ĐỀ ("Hôm nay trưa 320 suất, tối 80, mua thịt 1 triệu 2, rau 300")
  const rawClauses = trimmed
    .split(
      /[,;\n]+|(?:\s+và\s+(?=(?:mua|nhập|lấy|chi|sáng|trưa|tối|vãng lai|căn tin|thu)))|(?<=[^\s,;])\s+(?=(?:thuê\s+(?:\d+|cô|người|thợ|công nhân|phụ bếp|bác|chị|anh)|chấm công\b|vừa mua\b|mua\s+|nhập\s+|lấy hàng\b|thu cuối ngày|bán được\s+\d+|trả nợ\s+\d+|trả lương\s+\d+|ứng lương\s+\d+))/iu
    )
    .map((s) => s.trim())
    .filter(Boolean);

  // Gộp các mảnh bổ nghĩa thanh toán (", ghi nợ", ", chuyển khoản") hoặc vế CK của căn tin (", chuyển khoản 800") vào mệnh đề ngay trước nó
  const mergedClauses: string[] = [];
  for (const cl of rawClauses) {
    const clNoAcc = stripAccents(cl);
    const isPureModifier =
      parseVietnameseMoney(cl, { allowBareThousands: false }) === null &&
      !extractMealsFromText(cl).matched &&
      /^(ghi no|mua chiu|chiu|ghi so|chua tra|chua tra tien|chua dua tien|chua thanh toan|tra sau|tien mat|tm|chuyen khoan|ck|tk chi nhan|tk mo diep)$/.test(
        clNoAcc
      );

    const prevClause = mergedClauses.length > 0 ? mergedClauses[mergedClauses.length - 1] : '';
    const isCollectionFollowUp =
      prevClause !== '' &&
      isCollectionTriggerClause(prevClause) &&
      /^(trong do\s+)?(chuyen khoan|ck|tien mat|tm)\b/.test(clNoAcc);

    if ((isPureModifier || isCollectionFollowUp) && mergedClauses.length > 0) {
      mergedClauses[mergedClauses.length - 1] += `, ${cl}`;
    } else {
      mergedClauses.push(cl);
    }
  }

  const parsedItems: ParsedIntentItem[] = [];
  let pendingMeals: NonNullable<ParsedIntentItem['suat_an']> | null = null;
  let seenExpenseContext = false;

  const flushPendingMeals = () => {
    if (!pendingMeals) return;
    const hasSchool =
      (pendingMeals.sang_truong ?? 0) +
        (pendingMeals.trua_truong ?? 0) +
        (pendingMeals.toi_truong ?? 0) >
      0;
    if (!hasSchool) {
      const bua: MealPeriod = pendingMeals.sang_vang_lai
        ? 'sang'
        : pendingMeals.toi_vang_lai
        ? 'toi'
        : 'trua';
      const count =
        pendingMeals.sang_vang_lai ||
        pendingMeals.toi_vang_lai ||
        pendingMeals.trua_vang_lai ||
        0;
      parsedItems.push({
        intent: 'vang_lai',
        ngay: globalDate,
        bua_vang_lai: bua,
        so_suat_vang_lai: count,
        suat_an: pendingMeals,
        ghi_chu: `Khách vãng lai (${count} suất)`,
      });
    } else {
      parsedItems.push({
        intent: 'suat_an',
        ngay: globalDate,
        suat_an: pendingMeals,
        ghi_chu: 'Báo suất ăn trong ngày',
      });
    }
    pendingMeals = null;
  };

  for (const clause of mergedClauses) {
    // 9a0. Kiểm tra bán chịu hoặc thu nợ khách trước (tránh nhầm "ăn chịu 3 suất" thành báo suất ăn trường)
    const subRec = tryParseCustomerReceivable(clause, snapshot, globalDate);
    if (subRec) {
      flushPendingMeals();
      parsedItems.push(subRec);
      continue;
    }

    // 9a. Kiểm tra mệnh đề suất ăn
    const mealRes = extractMealsFromText(clause);
    if (mealRes.matched) {
      pendingMeals = { ...(pendingMeals ?? {}), ...mealRes.counts };
      continue;
    }

    flushPendingMeals();

    // 9b. Kiểm tra mệnh đề thu cuối ngày nằm trong câu ghép
    const subColl = tryParseDailyCollection(clause, globalDate, { wholeSentenceMode: false });
    if (subColl) {
      parsedItems.push(subColl);
      continue;
    }

    // 9c. Kiểm tra mệnh đề chấm công nằm trong câu ghép
    const subAtt = tryParseAttendance(clause, snapshot, globalDate);
    if (subAtt) {
      parsedItems.push(subAtt);
      continue;
    }

    // 9d. Mệnh đề Chi tiêu (chi ngày / mua chịu / chi phí cuối tháng)
    const clauseNoAcc = stripAccents(clause);
    const hasExpenseCue =
      seenExpenseContext ||
      /\b(mua|nhap|lay|chi|het|doi|goi|dong|nop|tra|tien dien|tien nuoc|tien gas|tien ga|gia vi|thuc an|thuc pham|do an|di cho|thit|suon|xuong|bo|ga|vit|ca|tom|rau|cu|gao|bun|pho|trung|dau|gio|cha|sua|nuoc ngot|banh|keo|bim bim|kem|xuc xich|mi tom|da vien|tui bong|giay an)\b/.test(
        clauseNoAcc
      );

    const amount = parseVietnameseMoney(clause, { allowBareThousands: hasExpenseCue });
    if (amount !== null && amount > 0) {
      seenExpenseContext = true;
      const specificClauseDate = parseVietnameseDate(clause, referenceDate);
      const clauseDate =
        specificClauseDate !== referenceDate ? specificClauseDate : globalDate;
      const clauseMonth = parseVietnameseMonth(clause, clauseDate);
      const { category, ambiguousSegment } = matchCategory(clause, snapshot.categories);
      const hasExplicitPayment = /\b(da tra|tra roi|da thanh toan|thanh toan roi|tien mat|tm|chuyen khoan|ck|chi nhan|mo diep)\b/.test(
        clauseNoAcc
      );
      let isCredit = isCreditPurchaseText(clause);
      if (!isCredit && !hasExplicitPayment) {
        // Nếu trong câu có vế nợ ("chưa trả tiền", "ghi nợ") nhưng vế đó không mang số tiền riêng (VD: nằm ở cuối câu hoặc ở vế chấm công)
        const hasUnattachedCreditCue = rawClauses.some(
          (c) => c !== clause && isCreditPurchaseText(c) && parseVietnameseMoney(c) === null
        );
        if (hasUnattachedCreditCue) {
          isCredit = true;
        }
      }
      const walletKind = detectWalletKind(clause, 'tien_mat');

      const explicitMang: BusinessSegment = /\b(can tin|cantin|cang tin)\b/.test(clauseNoAcc)
        ? 'can_tin'
        : /\b(bep an|bep)\b/.test(clauseNoAcc)
        ? 'bep_an'
        : category.mang_mac_dinh;

      if (category.kieu_tinh === 'theo_thang' && !isCredit) {
        const walletMentioned = /\b(tien mat|tm|chuyen khoan|ck|chi nhan|mo diep)\b/.test(
          clauseNoAcc
        );
        parsedItems.push({
          intent: 'chi_phi_thang',
          ngay: clauseDate,
          ky_thang: clauseMonth,
          mang: explicitMang,
          category_id: category.id,
          so_tien: amount,
          vi: walletKind,
          ghi_chu: clause,
          ...(walletMentioned
            ? {}
            : {
                cau_hoi_lam_ro: 'Khoản này trả bằng ví nào ạ?',
                lua_chon_lam_ro: [
                  { id: 'tm', label: '💵 Tiền mặt', patch: { vi: 'tien_mat' } },
                  { id: 'nhan', label: '🏦 TK Chị Nhàn', patch: { vi: 'tk_chi_nhan' } },
                  { id: 'diep', label: '🏦 TK Mợ Diệp', patch: { vi: 'tk_mo_diep' } },
                ],
              }),
        });
        continue;
      }

      if (isCredit) {
        const supRes = resolveSupplierFromClause(clause, snapshot.suppliers);
        const hasSupplierInfo = !!supRes.supplier_id || !!supRes.ten_ncc_moi;
        const supChoices = snapshot.suppliers.slice(0, 4).map((s) => ({
          id: s.id,
          label: s.ten_ncc,
          patch: {
            supplier_id: s.id,
            cau_hoi_lam_ro: undefined,
            lua_chon_lam_ro: undefined,
          },
        }));

        parsedItems.push({
          intent: 'chi_no',
          ngay: clauseDate,
          ky_thang: category.kieu_tinh === 'theo_thang' ? clauseMonth : undefined,
          mang: explicitMang,
          category_id: category.id,
          so_tien: amount,
          supplier_id: supRes.supplier_id,
          ten_ncc_moi: supRes.ten_ncc_moi,
          ghi_chu: clause,
          ...(!hasSupplierInfo
            ? {
                cau_hoi_lam_ro: 'Khoản nợ này của ai ạ?',
                lua_chon_lam_ro: supChoices,
              }
            : {}),
        });
        continue;
      }

      if (ambiguousSegment) {
        parsedItems.push({
          intent: 'chi',
          ngay: clauseDate,
          mang: explicitMang,
          category_id: category.id,
          so_tien: amount,
          vi: walletKind,
          ghi_chu: clause,
          cau_hoi_lam_ro: 'Khoản này dùng cho Bếp ăn hay Căn tin ạ?',
          lua_chon_lam_ro: [
            { id: 'bep', label: '🍲 Bếp ăn', patch: { mang: 'bep_an' } },
            { id: 'ct', label: '🏪 Căn tin', patch: { mang: 'can_tin' } },
          ],
        });
      } else if (hasExplicitPayment) {
        parsedItems.push({
          intent: 'chi',
          ngay: clauseDate,
          mang: explicitMang,
          category_id: category.id,
          so_tien: amount,
          vi: walletKind,
          ghi_chu: clause,
        });
      } else {
        // Chưa nói rõ đã trả tiền hay chưa -> AI hỏi lại 4 nút thông minh
        parsedItems.push({
          intent: 'chi',
          ngay: clauseDate,
          mang: explicitMang,
          category_id: category.id,
          so_tien: amount,
          vi: walletKind,
          ghi_chu: clause,
          cau_hoi_lam_ro: 'Khoản này đã trả tiền chưa ạ?',
          lua_chon_lam_ro: [
            {
              id: 'tm',
              label: '💵 Đã trả Tiền mặt',
              patch: {
                intent: 'chi',
                vi: 'tien_mat',
                cau_hoi_lam_ro: undefined,
                lua_chon_lam_ro: undefined,
              },
            },
            {
              id: 'nhan',
              label: '🏦 Đã CK Chị Nhàn',
              patch: {
                intent: 'chi',
                vi: 'tk_chi_nhan',
                cau_hoi_lam_ro: undefined,
                lua_chon_lam_ro: undefined,
              },
            },
            {
              id: 'diep',
              label: '🏦 Đã CK Mợ Diệp',
              patch: {
                intent: 'chi',
                vi: 'tk_mo_diep',
                cau_hoi_lam_ro: undefined,
                lua_chon_lam_ro: undefined,
              },
            },
            {
              id: 'no',
              label: '⏳ Chưa trả – Ghi nợ',
              patch: {
                intent: 'chi_no',
                vi: undefined,
                cau_hoi_lam_ro: undefined,
                lua_chon_lam_ro: undefined,
              },
            },
          ],
        });
      }
    } else if (hasExpenseCue && amount === null && !extractMealsFromText(clause).matched) {
      const { category } = matchCategory(clause, snapshot.categories);
      parsedItems.push({
        intent: 'chi',
        ngay: globalDate,
        mang: category.mang_mac_dinh,
        category_id: category.id,
        ghi_chu: clause,
        cau_hoi_lam_ro: `Hết bao nhiêu tiền ${category.ten_danh_muc.toLowerCase()} ạ?`,
      });
    }
  }

  flushPendingMeals();

  if (parsedItems.length === 0) {
    return {
      engine: 'local_vn',
      raw_text: trimmed,
      items: [
        {
          intent: 'khong_ro',
          ngay: globalDate,
          ghi_chu: trimmed,
          cau_tra_loi:
            'Con chưa nghe rõ số tiền hoặc số suất ăn trong câu này. Ông/bà nói rõ hơn một chút nhé, ví dụ:\n• "Sáng 150, trưa 320, tối 80"\n• "Mua 5 cân thịt 4 trăm rưỡi"\n• "Căn tin thu 2 triệu 3 tiền mặt, chuyển khoản 800"',
        },
      ],
    };
  }

  return {
    engine: 'local_vn',
    raw_text: trimmed,
    items: parsedItems,
  };
}
