import { getPreviousYearMonth, getYearMonth, shiftDateISO } from '../domain/format';

/**
 * Từ điển chữ số tiếng Việt khẩu ngữ (Bắc Bộ: tư, lăm, mốt, rưỡi, chục, củ...)
 */
const DIGIT_WORDS: Record<string, number> = {
  không: 0,
  linh: 0,
  lẻ: 0,
  một: 1,
  mốt: 1,
  hai: 2,
  ba: 3,
  bốn: 4,
  tư: 4,
  năm: 5,
  lăm: 5,
  nhăm: 5,
  sáu: 6,
  bảy: 7,
  bẩy: 7,
  tám: 8,
  chín: 9,
  mười: 10,
};

/**
 * Chuyển cụm chữ số nhỏ tiếng Việt (1..999) sang số nguyên.
 * VD: "bốn" -> 4, "mười lăm" -> 15, "hai mươi ba" -> 23, "hai ba" -> 23, "bốn trăm năm mươi" -> 450
 */
export function parseSmallVietnameseWords(phrase: string): number | null {
  const clean = phrase
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(clean)) {
    return Number(clean.replace(',', '.'));
  }

  const tokens = clean.split(' ');
  let total = 0;
  let current = 0;
  let matchedAny = false;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === 'mươi') {
      current = (current || 1) * 10;
      matchedAny = true;
    } else if (tk === 'trăm') {
      total += (current || 1) * 100;
      current = 0;
      matchedAny = true;
    } else if (tk in DIGIT_WORDS) {
      const val = DIGIT_WORDS[tk];
      if (tk === 'mười') {
        current += 10;
      } else if (current > 0 && current < 10 && i > 0 && tokens[i - 1] in DIGIT_WORDS) {
        // "hai ba" -> 23
        current = current * 10 + val;
      } else {
        current += val;
      }
      matchedAny = true;
    } else {
      return null;
    }
  }

  return matchedAny ? total + current : null;
}

/**
 * Loại bỏ các cụm đo lường khối lượng / thể tích / số lượng đồ vật và cụm ngày/tháng khỏi câu
 * trước khi bắt tiền, để "5 cân", "5 kg", "5 lít dầu", "3 bình gas", "320 suất", "ngày 15/10", "tháng 10"
 * KHÔNG BAO GIỜ bị nhầm thành tiền!
 */
export function maskPhysicalQuantities(text: string): string {
  return (
    text
      // Che ngày/tháng dạng dd/mm(/yyyy) hoặc "ngày 15 tháng 10", "tháng 10", "thứ 2" (tránh bắt nhầm "cuối ngày 2 triệu")
      .replace(
        /(?<![\p{L}\p{N}])(?:ngày|mùng|mồng)\s+\d{1,2}(?:\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?|\s+tháng\s+\d{1,2})(?![\p{L}\p{N}])/giu,
        ' [DATE] '
      )
      .replace(/(?<![\p{L}\p{N}])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\p{L}\p{N}])/gu, ' [DATE] ')
      .replace(
        /(?<![\p{L}\p{N}])(?:kỳ\s+tháng|tháng)\s*\d{1,2}(?:[/-]\d{4})?(?![\p{L}\p{N}])/giu,
        ' [MONTH] '
      )
      .replace(/(?<![\p{L}\p{N}])thứ\s*(?:[2-7]|hai|ba|tư|năm|sáu|bảy|bẩy)(?![\p{L}\p{N}])/giu, ' [DOW] ')
      // Che định lượng vật lý ("5 cân", "5 kg", "5 lít", "320 suất", "ba trăm suất", "2 thùng"...)
      .replace(
        /(?<![\p{L}\p{N}])(?:\d+(?:[.,]\d+)?|một|hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|mười)(?:\s*trăm)?\s*(?:kg|kí|ký|cân|lạng|gam|g|lít|lit|ml|suất|xuất|phần|người|khách|công|bình|thùng|két|dây|lốc|vỉ|chục\s+trứng|hộp|gói|túi|bao|quả|trái|viên|con|mớ|bó|cây|chai|lon|can)(?![\p{L}\p{N}])/giu,
        ' [QTY] '
      )
  );
}

/**
 * Chuẩn hóa và trích xuất số tiền tiếng Việt từ 1 mệnh đề ngắn:
 * Hỗ trợ:
 *  - "2 triệu 3" / "2tr3" / "2.3 triệu" / "hai triệu ba" -> 2.300.000
 *  - "1 triệu rưỡi" / "triệu rưỡi" / "1tr5" / "1,5tr" -> 1.500.000
 *  - "1 củ 2" / "1,2 củ" -> 1.200.000, "nửa củ" / "nửa triệu" -> 500.000
 *  - "4 trăm rưỡi" / "bốn trăm rưỡi" -> 450.000
 *  - "ba trăm mốt" -> 310.000, "hai trăm tư" -> 240.000
 *  - "tám chục" / "8 chục" -> 80.000, "chục rưỡi" -> 15.000, "trăm rưỡi" -> 150.000
 *  - "450k" / "450 nghìn" / "450 ngàn" / "một trăm hai mươi lăm nghìn" -> 450.000 / 125.000
 *  - "1.200.000" / "450.000đ" -> 1.200.000 / 450.000
 *  - Số trần trong ngữ cảnh tiền ("mua rau 300", "chuyển khoản 800"): nếu allowBareThousands=true -> 300.000 / 800.000
 */
export function parseVietnameseMoney(
  rawClause: string,
  options: { allowBareThousands?: boolean } = {}
): number | null {
  const masked = maskPhysicalQuantities(rawClause.replace(/₫/g, ' đồng'))
    .toLowerCase()
    // Đổi số thập phân triệu/củ trước: "1,5 triệu", "1.5tr", "2,35 củ" -> "1 triệu 5", "1 tr 5", "2 củ 35"
    .replace(
      /(\d+)[.,](\d{1,2})\s*(triệu|tr|củ)(?![\p{L}\p{N}])/gu,
      (_, a, b, u) => `${a} ${u} ${b}`
    )
    // Gộp dấu chấm hoặc dấu phẩy phân cách hàng nghìn (kể cả từ Google Speech Android: 450,000 / 1.200.000)
    .replace(/(\d)[.,](\d{3})[.,](\d{3})(?![\d])/g, '$1$2$3')
    .replace(
      /(\d)[.,](\d{3})(?![\d]|\s*(?:triệu|tr|củ|nghìn|ngàn|nghin|ngan|k)(?![\p{L}\p{N}]))/gu,
      '$1$2'
    );

  // 1. "nửa triệu" / "nửa củ"
  if (/(?<![\p{L}\p{N}])nửa\s*(?:triệu|củ)(?![\p{L}\p{N}])/u.test(masked)) {
    return 500_000;
  }

  // 2. Dạng số + triệu/tr/củ: "2tr350", "2tr3", "1tr rưỡi", "162 triệu", "1 củ 2", "2 triệu tư"
  const numMillionRegex =
    /(?<![\p{L}\p{N}])(\d+)\s*(?:triệu|tr|củ)(?:\s*(rưỡi|mốt|tư|lăm|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|\d{1,3}))?(?:\s*(?:nghìn|ngàn|k))?(?![\p{L}\p{N}])/u;
  const mNumMillion = masked.match(numMillionRegex);
  if (mNumMillion) {
    const main = Number(mNumMillion[1]) * 1_000_000;
    const tail = mNumMillion[2];
    if (!tail) return main;
    if (tail === 'rưỡi') return main + 500_000;
    if (tail in DIGIT_WORDS) return main + DIGIT_WORDS[tail] * 100_000;
    if (/^\d+$/.test(tail)) {
      if (tail.length === 1) return main + Number(tail) * 100_000;
      if (tail.length === 2) return main + Number(tail) * 10_000;
      return main + Number(tail) * 1_000;
    }
    return main;
  }

  // 3. "triệu rưỡi" / "củ rưỡi" (không có số 1 đằng trước)
  if (/(?<![\p{L}\p{N}])(?:triệu|củ)\s*rưỡi(?![\p{L}\p{N}])/u.test(masked)) {
    return 1_500_000;
  }

  // 4. Dạng chữ cho triệu/củ: "hai triệu ba", "một triệu rưỡi", "mười sáu triệu", "hai triệu tư"
  const wordMillionRegex =
    /(?<![\p{L}\p{N}])((?:một|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|trăm|linh|lẻ|\s)+?)\s*(?:triệu|củ)(?:\s*(rưỡi|mốt|tư|lăm|một|hai|ba|bốn|năm|sáu|bảy|bẩy|tám|chín))?(?![\p{L}\p{N}])/u;
  const mWordMillion = masked.match(wordMillionRegex);
  if (mWordMillion) {
    const headVal = parseSmallVietnameseWords(mWordMillion[1]);
    if (headVal !== null && headVal > 0) {
      let amount = headVal * 1_000_000;
      const tailW = mWordMillion[2];
      if (tailW === 'rưỡi') amount += 500_000;
      else if (tailW && tailW in DIGIT_WORDS) amount += DIGIT_WORDS[tailW] * 100_000;
      return amount;
    }
  }

  // 5. Dạng số + nghìn / ngàn / k: "450 nghìn", "450k", "80k", "1200k", "35,5k"
  const kMatch = masked.match(
    /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(?:nghìn|ngàn|nghin|ngan|k)(?:\s*(rưỡi))?(?![\p{L}\p{N}])/u
  );
  if (kMatch) {
    const val = Number(kMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) {
      return Math.round(val * 1_000) + (kMatch[2] ? 500 : 0);
    }
  }

  // 6. Dạng chữ đầy đủ + nghìn / ngàn: "bốn trăm năm mươi nghìn", "một trăm hai mươi lăm nghìn"
  const wordKMatch = masked.match(
    /(?<![\p{L}\p{N}])((?:một|hai|ba|bốn|tư|năm|lăm|nhăm|sáu|bảy|bẩy|tám|chín|mười|mươi|trăm|linh|lẻ|\s)+?)\s*(?:nghìn|ngàn|nghin|ngan)(?![\p{L}\p{N}])/u
  );
  if (wordKMatch) {
    const v = parseSmallVietnameseWords(wordKMatch[1]);
    if (v !== null && v > 0) return v * 1_000;
  }

  // 7. Dạng khẩu ngữ "X trăm rưỡi / mốt / tư..." ngầm hiểu nghìn đồng ("4 trăm rưỡi", "ba trăm mốt", "hai trăm tư")
  const numHundredColloquial = masked.match(
    /(?<![\p{L}\p{N}])(\d+|một|hai|ba|bốn|năm|sáu|bảy|bẩy|tám|chín)\s*trăm(?:\s*(rưỡi|mốt|tư|lăm|một|hai|ba|bốn|năm|sáu|bảy|bẩy|tám|chín))?(?!\s*(?:mươi|linh|lẻ))(?:\s*(?:nghìn|ngàn|k))?(?![\p{L}\p{N}])/u
  );
  if (numHundredColloquial) {
    const hRaw = numHundredColloquial[1];
    const hNum = /^\d+$/.test(hRaw) ? Number(hRaw) : DIGIT_WORDS[hRaw] ?? null;
    if (hNum !== null && hNum > 0 && hNum <= 9) {
      let amount = hNum * 100_000;
      const tail = numHundredColloquial[2];
      if (tail === 'rưỡi') amount += 50_000;
      else if (tail && tail in DIGIT_WORDS) amount += DIGIT_WORDS[tail] * 10_000;
      return amount;
    }
  }

  // 8. "trăm rưỡi" (không có số 1 phía trước -> 150.000)
  if (/(?<![\p{L}\p{N}])trăm\s*rưỡi(?![\p{L}\p{N}])/u.test(masked)) {
    return 150_000;
  }

  // 9. Dạng "chục": "tám chục", "8 chục rưỡi", "hai chục", "chục rưỡi"
  const chucMatch = masked.match(
    /(?<![\p{L}\p{N}])(\d+|một|hai|ba|bốn|năm|sáu|bảy|bẩy|tám|chín)\s*chục(\s*rưỡi)?(?![\p{L}\p{N}])/u
  );
  if (chucMatch) {
    const cRaw = chucMatch[1];
    const cNum = /^\d+$/.test(cRaw) ? Number(cRaw) : DIGIT_WORDS[cRaw] ?? null;
    if (cNum !== null && cNum > 0) {
      return cNum * 10_000 + (chucMatch[2] ? 5_000 : 0);
    }
  }
  if (/(?<![\p{L}\p{N}])chục\s*rưỡi(?![\p{L}\p{N}])/u.test(masked)) {
    return 15_000;
  }

  // 10. Số đầy đủ >= 10.000 (VD: "450000", "450000đ", "1500000 đồng")
  const fullVndMatch = masked.match(/(?<![\p{L}\p{N}])(\d{5,10})\s*(?:đ|đồng|vnd)?(?![\p{L}\p{N}])/u);
  if (fullVndMatch) {
    return Number(fullVndMatch[1]);
  }

  // 11. Số trần (VD: "mua rau 300", "chuyển khoản 800") -> hiểu là nghìn đồng
  if (options.allowBareThousands) {
    const bareMatch = masked.match(
      /(?<![\p{L}\p{N}])(\d{2,4})(?!\s*(?:suất|xuất|công|tháng|ngày|giờ|%))(?![\p{L}\p{N}])/u
    );
    if (bareMatch) {
      const n = Number(bareMatch[1]);
      if (n >= 10 && n <= 9999) {
        return n * 1_000;
      }
    }
  }

  return null;
}

/**
 * Bóc tách ngày tiếng Việt tương đối so với referenceDate (YYYY-MM-DD):
 *  - "hôm nay", "sáng nay", "trưa nay", "tối nay" -> referenceDate
 *  - "hôm qua", "tối qua", "sáng qua" -> -1 ngày
 *  - "hôm kia" -> -2 ngày
 *  - "thứ 2 vừa rồi", "thứ sáu tuần trước", "chủ nhật vừa rồi"
 *  - "ngày 15/10", "15/10/2026", "mùng 5 tháng 10"
 */
export function parseVietnameseDate(text: string, referenceDate: string): string {
  // Bỏ các cụm so sánh "giống hôm qua / y như hôm qua / bằng hôm trước" để không lùi nhầm ngày mục tiêu!
  const lower = text
    .toLowerCase()
    .replace(
      /(?<![\p{L}\p{N}])(?:giống|giong|y\s+như|y\s+nhu|như|nhu|bằng|bang)\s+(?:hôm\s*qua|hom\s*qua|hôm\s*kia|hom\s*kia|hôm\s*trước|hom\s*truoc)(?![\p{L}\p{N}])/gu,
      ' '
    );

  if (/(?<![\p{L}\p{N}])hôm\s*kia(?![\p{L}\p{N}])/u.test(lower)) {
    return shiftDateISO(referenceDate, -2);
  }
  if (
    /(?<![\p{L}\p{N}])(?:hôm\s*qua|tối\s*qua|sáng\s*qua|trưa\s*qua|chiều\s*qua)(?![\p{L}\p{N}])/u.test(
      lower
    )
  ) {
    return shiftDateISO(referenceDate, -1);
  }

  // Ngày dạng dd/mm/yyyy hoặc dd/mm (không bắt nhầm "tháng 10/2026")
  const dmyMatch = lower.match(
    /(?<![\p{L}\p{N}])(?<!tháng\s)(?:ngày\s+|mùng\s+|mồng\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?(?![\p{L}\p{N}])/u
  );
  if (dmyMatch) {
    const d = Number(dmyMatch[1]);
    const m = Number(dmyMatch[2]);
    const refYear = Number(referenceDate.slice(0, 4));
    const y = dmyMatch[3] ? Number(dmyMatch[3]) : refYear;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2020) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // "mùng 5 tháng 10" hoặc "ngày 28 tháng 9"
  const spokenDateMatch = lower.match(
    /(?<![\p{L}\p{N}])(?:ngày|mùng|mồng)\s+(\d{1,2})\s+tháng\s+(\d{1,2})(?![\p{L}\p{N}])/u
  );
  if (spokenDateMatch) {
    const d = Number(spokenDateMatch[1]);
    const m = Number(spokenDateMatch[2]);
    const refYear = Number(referenceDate.slice(0, 4));
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return `${refYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Thứ trong tuần: "thứ 2 vừa rồi", "thứ sáu tuần trước", "chủ nhật vừa rồi"
  const weekdayMap: Array<{ pattern: RegExp; targetDow: number }> = [
    {
      pattern: /(?<![\p{L}\p{N}])chủ\s*nhật\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 0,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:2|hai)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 1,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:3|ba)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 2,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:4|tư)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 3,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:5|năm)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 4,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:6|sáu)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 5,
    },
    {
      pattern: /(?<![\p{L}\p{N}])thứ\s*(?:7|bảy|bẩy)\s*(?:vừa\s*rồi|tuần\s*trước|trước)(?![\p{L}\p{N}])/u,
      targetDow: 6,
    },
  ];

  const [ry, rm, rd] = referenceDate.split('-').map(Number);
  const refDt = new Date(ry, rm - 1, rd);
  const currentDow = refDt.getDay();

  for (const w of weekdayMap) {
    if (w.pattern.test(lower)) {
      let diff = currentDow - w.targetDow;
      if (diff <= 0) diff += 7;
      return shiftDateISO(referenceDate, -diff);
    }
  }

  return referenceDate;
}

/**
 * Bóc tách kỳ tháng ('YYYY-MM') cho tiền trường chuyển, trả lương, điện nước gas gia vị:
 *  - "tháng trước" -> lùi 1 tháng
 *  - "tháng 9", "t9", "kỳ tháng 10" -> YYYY-MM
 *  - mặc định -> tháng của referenceDate
 */
export function parseVietnameseMonth(text: string, referenceDate: string): string {
  const lower = text.toLowerCase();
  const baseMonth = getYearMonth(referenceDate);

  if (/(?<![\p{L}\p{N}])tháng\s*trước(?![\p{L}\p{N}])/u.test(lower)) {
    return getPreviousYearMonth(baseMonth);
  }

  const explicitMonth = lower.match(
    /(?<![\p{L}\p{N}])(?:tháng|kỳ\s*tháng|t)\s*(\d{1,2})(?:[/-](\d{4}))?(?![\p{L}\p{N}])/u
  );
  if (explicitMonth) {
    const m = Number(explicitMonth[1]);
    if (m >= 1 && m <= 12) {
      const refYear = Number(referenceDate.slice(0, 4));
      const refM = Number(referenceDate.slice(5, 7));
      let y = explicitMonth[2] ? Number(explicitMonth[2]) : refYear;
      // Nếu đang tháng 1 mà nói "tháng 12" -> hiểu là tháng 12 năm ngoái
      if (!explicitMonth[2] && m > refM + 1) {
        y -= 1;
      }
      return `${y}-${String(m).padStart(2, '0')}`;
    }
  }

  return baseMonth;
}
