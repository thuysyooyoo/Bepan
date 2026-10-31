import type {
  BookId,
  Category,
  ChatLog,
  Supplier,
  Worker,
} from '../types/models';
import { stripAccents } from '../ai/localVnNlu';

export interface DialectCandidate {
  id: string;
  logId: string;
  bookId: BookId;
  rawUtterance: string;
  candidateTerm: string;
  suggestedType: 'category_keyword' | 'new_supplier' | 'new_worker';
  suggestedCategoryId?: string;
  suggestedCategoryName?: string;
  suggestedName?: string;
  confidence: number;
  timestamp: string;
  reason: string;
}

/**
 * Trích xuất các danh từ / cụm từ địa phương tiềm năng từ câu nói chưa được phân loại chuẩn
 * hoặc từ các câu nói bị hủy / chưa lưu trong chat_logs
 */
export function extractDialectCandidates(
  chatLogs: ChatLog[],
  categories: Category[],
  suppliers: Supplier[],
  workers: Worker[]
): DialectCandidate[] {
  const candidates: DialectCandidate[] = [];
  const seenTerms = new Set<string>();

  // Tập hợp các từ khóa đã biết để tránh gợi ý trùng
  const existingKeywords = new Set<string>();
  for (const cat of categories) {
    for (const kw of cat.tu_khoa_ai) {
      existingKeywords.add(stripAccents(kw.toLowerCase().trim()));
    }
  }

  const existingSupplierNames = new Set(
    suppliers.map((s) => stripAccents(s.ten_ncc.toLowerCase().trim()))
  );
  const existingWorkerNames = new Set(
    workers.map((w) => stripAccents(w.ho_ten.toLowerCase().trim()))
  );

  for (const log of chatLogs) {
    const raw = log.cau_noi.trim();
    if (!raw) continue;

    // Ưu tiên các câu chưa lưu (cho_xac_nhan), bị hủy (huy), hoặc câu có kết quả không rõ
    const needsReview =
      log.ket_qua === 'cho_xac_nhan' ||
      log.ket_qua === 'huy' ||
      log.ket_qua === 'da_sua';

    // 1. Tìm ứng viên người bán mới (VD: "chị Hương", "cô Thủy", "đại lý Minh", "bác Hải")
    const supMatch = raw.match(
      /(?<![\p{L}\p{N}])(chị|cô|bà|bác|anh|chú|ông|đại lý|mối|quầy)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/iu
    );
    if (supMatch) {
      const title = supMatch[1].charAt(0).toUpperCase() + supMatch[1].slice(1).toLowerCase();
      const rawName = supMatch[2]
        .replace(
          /(?<![\p{L}\p{N}])(ghi|nợ|no|mua|chịu|chiu|chưa|trả|tra|hết|het|tiền|chợ|rau|thịt|cá|trứng|bánh|kẹo)(?![\p{L}\p{N}]).*$/iu,
          ''
        )
        .trim();
      const capName = rawName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      const fullName = `${title} ${capName}`.trim();
      const normFull = stripAccents(fullName.toLowerCase());

      const isKnown = Array.from(existingSupplierNames).some((sn) =>
        sn.includes(normFull) || normFull.includes(sn)
      );

      if (capName.length >= 2 && !isKnown && !seenTerms.has(normFull)) {
        seenTerms.add(normFull);
        candidates.push({
          id: `cand_sup_${log.id}_${normFull.replace(/\s+/g, '_')}`,
          logId: log.id,
          bookId: log.book_id,
          rawUtterance: raw,
          candidateTerm: fullName,
          suggestedType: 'new_supplier',
          suggestedName: fullName,
          confidence: needsReview ? 0.85 : 0.65,
          timestamp: log.timestamp,
          reason: `Phát hiện tên mối hàng mới trong câu nói: "${fullName}"`,
        });
      }
    }

    // 2. Tìm ứng viên người phụ bếp mới (VD: "chấm công cô Mùi", "bác Tiến đi làm")
    const workerMatch = raw.match(
      /(?:chấm công|công|trả lương|lương)\s+(?:cho\s+)?(cô|bác|chị|anh|chú|bà)\s+([\p{L}]+)/iu
    );
    if (workerMatch) {
      const title = workerMatch[1].charAt(0).toUpperCase() + workerMatch[1].slice(1).toLowerCase();
      const name = workerMatch[2].charAt(0).toUpperCase() + workerMatch[2].slice(1).toLowerCase();
      const fullName = `${title} ${name}`.trim();
      const normFull = stripAccents(fullName.toLowerCase());

      const isKnownWorker = Array.from(existingWorkerNames).some((wn) =>
        wn.includes(normFull) || normFull.includes(wn)
      );

      if (!isKnownWorker && !seenTerms.has(normFull)) {
        seenTerms.add(normFull);
        candidates.push({
          id: `cand_wrk_${log.id}_${normFull.replace(/\s+/g, '_')}`,
          logId: log.id,
          bookId: log.book_id,
          rawUtterance: raw,
          candidateTerm: fullName,
          suggestedType: 'new_worker',
          suggestedName: fullName,
          confidence: 0.9,
          timestamp: log.timestamp,
          reason: `Phát hiện tên phụ bếp mới trong câu chấm công: "${fullName}"`,
        });
      }
    }

    // 3. Tìm ứng viên từ khóa mặt hàng / địa phương mới (VD: "bìa đậu", "đậu khuôn", "mắm tôm", "sting", "bò húc")
    const itemMatch = raw.match(
      /(?:mua|lấy|nhập|hết|tiền|chi)\s+([\p{L}\s]{2,20}?)(?=\s+(?:\d+|chị|cô|bà|anh|chú|mối|đại lý|ghi nợ|tiền mặt|chuyển khoản|hôm nay|sáng|trưa|tối|$))/iu
    );
    if (itemMatch) {
      const term = itemMatch[1].trim();
      const normTerm = stripAccents(term.toLowerCase());

      if (
        term.length >= 3 &&
        !existingKeywords.has(normTerm) &&
        !seenTerms.has(normTerm) &&
        !['cho', 'ngay', 'hom nay', 'tien', 'cong', 'suat', 'bep'].includes(normTerm)
      ) {
        seenTerms.add(normTerm);

        // Gợi ý danh mục phù hợp
        let targetCat = categories.find((c) => c.nhom === 'chi');
        if (/dau|khuon|bia|mo|phu/.test(normTerm)) {
          targetCat = categories.find((c) => c.id === 'cat_trung_dau_gio') ?? targetCat;
        } else if (/mam|tuong|cham|ot|muoi|mam tom/.test(normTerm)) {
          targetCat = categories.find((c) => c.id === 'cat_gia_vi_thang') ?? targetCat;
        } else if (/nuoc|sting|bo huc|revive|c2|pepsi|coca/.test(normTerm)) {
          targetCat = categories.find((c) => c.id === 'cat_nhap_nuoc_ct') ?? targetCat;
        } else if (/banh|keo|bim bim|snack|kem|mut/.test(normTerm)) {
          targetCat = categories.find((c) => c.id === 'cat_nhap_banh_keo_ct') ?? targetCat;
        }

        candidates.push({
          id: `cand_kw_${log.id}_${normTerm.replace(/\s+/g, '_')}`,
          logId: log.id,
          bookId: log.book_id,
          rawUtterance: raw,
          candidateTerm: term,
          suggestedType: 'category_keyword',
          suggestedCategoryId: targetCat?.id,
          suggestedCategoryName: targetCat?.ten_danh_muc,
          confidence: needsReview ? 0.8 : 0.5,
          timestamp: log.timestamp,
          reason: `Từ khóa mặt hàng chưa có trong danh mục: "${term}"`,
        });
      }
    }
  }

  // Sắp xếp ưu tiên độ tin cậy và thời gian gần nhất
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Thêm từ khóa địa phương mới vào danh mục (tự chuẩn hóa, loại bỏ trùng lặp)
 */
export function addDialectKeywordToCategory(
  category: Category,
  newKeyword: string
): Category {
  const cleanKw = newKeyword.trim().toLowerCase();
  if (!cleanKw) return category;

  const cleanNoAcc = stripAccents(cleanKw);
  const exists = category.tu_khoa_ai.some(
    (kw) => stripAccents(kw.toLowerCase()) === cleanNoAcc
  );

  if (exists) return category;

  return {
    ...category,
    tu_khoa_ai: [...category.tu_khoa_ai, cleanKw],
  };
}

/**
 * Xóa từ khóa khỏi danh mục
 */
export function removeDialectKeywordFromCategory(
  category: Category,
  keywordToRemove: string
): Category {
  const targetNoAcc = stripAccents(keywordToRemove.trim().toLowerCase());
  return {
    ...category,
    tu_khoa_ai: category.tu_khoa_ai.filter(
      (kw) => stripAccents(kw.toLowerCase()) !== targetNoAcc
    ),
  };
}
