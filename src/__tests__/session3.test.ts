import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildActionCardFromIntent } from '../ai/chatEngine';
import { parseVietnameseCommandLocal } from '../ai/localVnNlu';
import {
  parseVietnameseDate,
  parseVietnameseMoney,
  parseVietnameseMonth,
} from '../ai/vnNumberDateParser';
import { LocalDexieAdapter } from '../db';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeWalletBalances,
} from '../domain/accounting';

describe('Phiên 3 — AI Chat hiểu tiếng Việt (Khẩu ngữ Bắc Bộ, 14 Intents, Đa mệnh đề & Hỏi lại)', () => {
  it('1. Chuẩn hóa 30 cách nói số tiền khẩu ngữ tiếng Việt (không nhầm cân/lít/suất/ngày thành tiền)', () => {
    const moneyCases: Array<[string, number, boolean?]> = [
      ['Mua thịt 2 triệu 3', 2_300_000],
      ['Nhập hàng 2tr350', 2_350_000],
      ['Tiền điện 1,5 triệu', 1_500_000],
      ['Tiền nước 1.5tr', 1_500_000],
      ['Mua gạo hai triệu tư', 2_400_000],
      ['Ứng lương 1 củ 2', 1_200_000],
      ['Mua bia 1,2 củ', 1_200_000],
      ['Trả bớt nửa củ', 500_000],
      ['Trả nợ nửa triệu', 500_000],
      ['Mua xương triệu rưỡi', 1_500_000],
      ['Nhập sữa củ rưỡi', 1_500_000],
      ['Mua 5 cân thịt 4 trăm rưỡi', 450_000],
      ['Mua cá bốn trăm rưỡi', 450_000],
      ['Mua tôm ba trăm mốt', 310_000],
      ['Mua gà hai trăm tư', 240_000],
      ['Mua rau trăm rưỡi', 150_000],
      ['Mua hành tỏi tám chục', 80_000],
      ['Mua đá 8 chục rưỡi', 85_000],
      ['Mua ớt chục rưỡi', 15_000],
      ['Mua 5 cân thịt 450k', 450_000],
      ['Mua 5 lít dầu ăn 220 nghìn', 220_000],
      ['Mua trứng bốn trăm năm mươi nghìn', 450_000],
      ['Mua bún một trăm hai mươi lăm nghìn', 125_000],
      ['Mua giò bốn trăm linh năm ngàn', 405_000],
      ['Đổi 3 bình gas 1.200.000đ', 1_200_000],
      ['Trường chuyển 162 triệu', 162_000_000],
      ['Mua rau 300', 300_000, true],
      ['Chuyển khoản 800', 800_000, true],
      ['Ngày 15/10 mua rau 300', 300_000, true],
      ['Tiền điện tháng 10 hết 1800', 1_800_000, true],
    ];

    for (const [utterance, expected, bare] of moneyCases) {
      expect(
        parseVietnameseMoney(utterance, { allowBareThousands: Boolean(bare) }),
        `Câu lỗi: "${utterance}"`
      ).toBe(expected);
    }

    // Câu chỉ có số lượng suất / cân / công mà không có tiền -> trả về null
    expect(parseVietnameseMoney('Hôm nay nấu 320 suất')).toBeNull();
    expect(parseVietnameseMoney('Sáng nay ba trăm suất')).toBeNull();
  });

  it('2. Hiểu 12 cách nói ngày & kỳ tháng tương đối ("hôm qua", "thứ 2 vừa rồi", "tháng trước"...)', () => {
    // Thứ Bảy 2026-10-31 (getDay() = 6)
    const ref = '2026-10-31';

    expect(parseVietnameseDate('Hôm nay mua thịt 500k', ref)).toBe('2026-10-31');
    expect(parseVietnameseDate('Hôm qua mua cá 400k', ref)).toBe('2026-10-30');
    expect(parseVietnameseDate('Tối qua nhập sữa 600k', ref)).toBe('2026-10-30');
    expect(parseVietnameseDate('Hôm kia mua gạo 2 triệu', ref)).toBe('2026-10-29');
    expect(parseVietnameseDate('Thứ 2 vừa rồi mua rau 300k', ref)).toBe('2026-10-26');
    expect(parseVietnameseDate('Thứ sáu vừa rồi mua đậu 200k', ref)).toBe('2026-10-30');
    expect(parseVietnameseDate('Chủ nhật tuần trước nghỉ', ref)).toBe('2026-10-25');
    expect(parseVietnameseDate('Ngày 15/10 mua xoong 500k', ref)).toBe('2026-10-15');
    expect(parseVietnameseDate('05/09/2026 khai giảng', ref)).toBe('2026-09-05');
    expect(parseVietnameseDate('Mùng 5 tháng 10 mua thịt', ref)).toBe('2026-10-05');

    expect(parseVietnameseMonth('Tiền điện tháng trước 2 triệu', ref)).toBe('2026-09');
    expect(parseVietnameseMonth('Trường chuyển tiền ăn tháng 9', ref)).toBe('2026-09');
    expect(parseVietnameseMonth('Trả lương kỳ tháng 10', ref)).toBe('2026-10');
    // Đầu năm (tháng 1/2027) nói "tiền điện tháng 12" -> hiểu là 2026-12
    expect(parseVietnameseMonth('Tiền điện tháng 12 hết 2 triệu', '2027-01-05')).toBe('2026-12');
  });

  it('3. Bộ 52 câu nói thực tế bao phủ đủ 14 Intents (đạt độ chính xác >= 95%)', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S3_Corpus_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const refDate = '2026-10-31';

    // Chuẩn bị dữ liệu nền hôm trước (2026-10-30) để test "Giống hôm qua", "Trả lương", "Hỏi báo cáo"
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'sang',
      suat_truong: 140,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'trua',
      suat_truong: 310,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-30',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-30',
      so_cong: 1,
      don_gia_cong: 250_000,
    });

    const snap = await repo.getBookSnapshot(bo, 'hiep_hoa');

    interface CorpusCase {
      text: string;
      check: (res: ReturnType<typeof parseVietnameseCommandLocal>) => boolean;
    }

    const corpus: CorpusCase[] = [
      // --- SUẤT ĂN & VÃNG LAI & GIỐNG HÔM QUA ---
      {
        text: 'Sáng 150, trưa 320, tối 80',
        check: (r) =>
          r.items[0]?.intent === 'suat_an' &&
          r.items[0].suat_an?.sang_truong === 150 &&
          r.items[0].suat_an?.trua_truong === 320 &&
          r.items[0].suat_an?.toi_truong === 80,
      },
      {
        text: 'sang 120 trua 300 toi 65',
        check: (r) =>
          r.items[0]?.intent === 'suat_an' &&
          r.items[0].suat_an?.sang_truong === 120 &&
          r.items[0].suat_an?.trua_truong === 300 &&
          r.items[0].suat_an?.toi_truong === 65,
      },
      {
        text: 'Hôm nay nấu 320 suất',
        check: (r) =>
          r.items[0]?.intent === 'suat_an' && r.items[0].suat_an?.trua_truong === 320,
      },
      {
        text: 'Trường báo 295 xuất',
        check: (r) =>
          r.items[0]?.intent === 'suat_an' && r.items[0].suat_an?.trua_truong === 295,
      },
      {
        text: 'Sáng 150, trưa 320, vãng lai trưa 5',
        check: (r) =>
          r.items[0]?.intent === 'suat_an' &&
          r.items[0].suat_an?.trua_truong === 320 &&
          r.items[0].suat_an?.trua_vang_lai === 5,
      },
      {
        text: 'Suất ăn giống hôm qua',
        check: (r) =>
          r.items[0]?.intent === 'giong_hom_qua' &&
          r.items[0].suat_an?.sang_truong === 140 &&
          r.items[0].suat_an?.trua_truong === 310,
      },
      {
        text: 'Hôm nay nấu y như hôm qua',
        check: (r) => r.items[0]?.intent === 'giong_hom_qua',
      },
      {
        text: 'Thêm 6 khách vãng lai ăn trưa',
        check: (r) =>
          r.items[0]?.intent === 'vang_lai' &&
          r.items[0].bua_vang_lai === 'trua' &&
          r.items[0].so_suat_vang_lai === 6,
      },
      {
        text: '8 suất vãng lai buổi tối',
        check: (r) =>
          r.items[0]?.intent === 'vang_lai' &&
          r.items[0].bua_vang_lai === 'toi' &&
          r.items[0].so_suat_vang_lai === 8,
      },
      {
        text: '5 người ăn ngoài buổi sáng',
        check: (r) =>
          r.items[0]?.intent === 'vang_lai' &&
          r.items[0].bua_vang_lai === 'sang' &&
          r.items[0].so_suat_vang_lai === 5,
      },

      // --- THU CUỐI NGÀY CĂN TIN (CÁCH A) & CÂU MƠ HỒ ---
      {
        text: 'Căn tin hôm nay thu 2 triệu 3 tiền mặt, chuyển khoản 800',
        check: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 2_300_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 800_000 &&
          !r.items[0].lua_chon_lam_ro,
      },
      {
        text: 'Tổng thu cuối ngày 2 triệu 3, trong đó chuyển khoản 800',
        check: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 1_500_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 800_000,
      },
      {
        text: 'Căn tin bán hàng hôm nay thu 1 triệu 8',
        check: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 1_800_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 0,
      },
      {
        text: 'Căn tin hôm nay 2 triệu 3, chuyển khoản 800',
        check: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          (r.items[0].lua_chon_lam_ro?.length ?? 0) === 2,
      },
      {
        text: 'Tiền quầy hôm qua 1 triệu rưỡi tiền mặt và 450k chuyển khoản chị Nhàn',
        check: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].ngay === '2026-10-30' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 1_500_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 450_000,
      },

      // --- CHI TRẢ LUÔN (BẾP ĂN & CĂN TIN) ---
      {
        text: 'Mua 5 cân thịt lợn 450k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_thit' &&
          r.items[0].mang === 'bep_an' &&
          r.items[0].so_tien === 450_000 &&
          r.items[0].vi === 'tien_mat',
      },
      {
        text: 'mua thit ga 450k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_thit' &&
          r.items[0].so_tien === 450_000,
      },
      {
        text: 'Mua cá chép 380 nghìn chuyển khoản chị Nhàn',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_ca_hai_san' &&
          r.items[0].so_tien === 380_000 &&
          r.items[0].vi === 'tk_chi_nhan',
      },
      {
        text: 'Mua trứng với đậu phụ 320k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_trung_dau_gio' &&
          r.items[0].so_tien === 320_000,
      },
      {
        text: 'Mua rau củ hành tỏi 2 trăm rưỡi',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_rau_cu' &&
          r.items[0].so_tien === 250_000,
      },
      {
        text: 'Mua bún phở sáng 350k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_gao_bun_pho' &&
          r.items[0].so_tien === 350_000,
      },
      {
        text: 'Mua dưa hấu tráng miệng 180k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_trang_mieng' &&
          r.items[0].so_tien === 180_000,
      },
      {
        text: 'Nhập 10 thùng sữa hộp căn tin 2 triệu 4 chuyển khoản',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_nhap_nuoc_ct' &&
          r.items[0].mang === 'can_tin' &&
          r.items[0].so_tien === 2_400_000 &&
          r.items[0].vi === 'tk_chi_nhan',
      },
      {
        text: 'Nhập bánh kẹo bim bim 1 triệu 2',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_nhap_banh_keo_ct' &&
          r.items[0].mang === 'can_tin' &&
          r.items[0].so_tien === 1_200_000,
      },
      {
        text: 'Nhập xúc xích mì tôm 650k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_nhap_an_vat_ct' &&
          r.items[0].mang === 'can_tin' &&
          r.items[0].so_tien === 650_000,
      },
      {
        text: 'Mua đá viên 50k',
        check: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].so_tien === 50_000 &&
          (r.items[0].lua_chon_lam_ro?.length ?? 0) === 2,
      },

      // --- MUA CHỊU / GHI NỢ (chi_no) & PHÁT HIỆN MỐI HÀNG MỚI ---
      {
        text: 'Mua chịu thịt 2 triệu',
        check: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].supplier_id === 'sup_hh_thit' &&
          r.items[0].so_tien === 2_000_000,
      },
      {
        text: 'Lấy gạo 3 triệu 5 ghi nợ',
        check: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].supplier_id === 'sup_hh_gao' &&
          r.items[0].so_tien === 3_500_000,
      },
      {
        text: 'Lấy rau chị Hương 300k ghi nợ',
        check: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].ten_ncc_moi === 'Chị Hương' &&
          r.items[0].so_tien === 300_000,
      },
      {
        text: 'Mua cá cô Hạnh 520k chưa trả',
        check: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].ten_ncc_moi === 'Cô Hạnh' &&
          r.items[0].so_tien === 520_000,
      },
      {
        text: 'Nhập nước ngọt đại lý Minh 1 triệu 8 ghi sổ',
        check: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].ten_ncc_moi === 'Đại lý Minh' &&
          r.items[0].mang === 'can_tin' &&
          r.items[0].so_tien === 1_800_000,
      },

      // --- TRẢ NỢ NHÀ CUNG CẤP (tra_no) ---
      {
        text: 'Trả nợ mối thịt 1 triệu 5',
        check: (r) =>
          r.items[0]?.intent === 'tra_no' &&
          r.items[0].supplier_id === 'sup_hh_thit' &&
          r.items[0].so_tien === 1_500_000 &&
          r.items[0].vi === 'tien_mat',
      },
      {
        text: 'Trả nợ đại lý gạo 2 triệu chuyển khoản chị Nhàn',
        check: (r) =>
          r.items[0]?.intent === 'tra_no' &&
          r.items[0].supplier_id === 'sup_hh_gao' &&
          r.items[0].so_tien === 2_000_000 &&
          r.items[0].vi === 'tk_chi_nhan',
      },
      {
        text: 'Trả chị Hương 300k tiền mặt',
        check: (r) =>
          r.items[0]?.intent === 'tra_no' &&
          r.items[0].ten_ncc_moi === 'Chị Hương' &&
          r.items[0].so_tien === 300_000,
      },

      // --- CHẤM CÔNG & TRẢ LƯƠNG ---
      {
        text: 'Hôm nay thợ đi làm đủ hết',
        check: (r) =>
          r.items[0]?.intent === 'cham_cong' &&
          r.items[0].cham_cong?.length === 2 &&
          r.items[0].cham_cong.every((w) => w.so_cong === 1),
      },
      {
        text: 'Hôm nay cô Lan đi làm, chị Hoa nghỉ',
        check: (r) => {
          const cc = r.items[0]?.cham_cong;
          return (
            r.items[0]?.intent === 'cham_cong' &&
            cc?.find((x) => x.worker_id === 'wk_hh_1')?.so_cong === 1 &&
            cc?.find((x) => x.worker_id === 'wk_hh_2')?.so_cong === 0
          );
        },
      },
      {
        text: 'Chấm công cô Lan nửa buổi, chị Hoa đi làm',
        check: (r) => {
          const cc = r.items[0]?.cham_cong;
          return (
            r.items[0]?.intent === 'cham_cong' &&
            cc?.find((x) => x.worker_id === 'wk_hh_1')?.so_cong === 0.5 &&
            cc?.find((x) => x.worker_id === 'wk_hh_2')?.so_cong === 1
          );
        },
      },
      {
        text: 'Trả lương thợ tháng 10',
        check: (r) =>
          r.items[0]?.intent === 'tra_luong' &&
          r.items[0].ky_thang === '2026-10' &&
          r.items[0].so_tien === 500_000, // Tự điền 2 công * 250k = 500k!
      },
      {
        text: 'Ứng lương cô Lan 1 triệu',
        check: (r) =>
          r.items[0]?.intent === 'tra_luong' &&
          r.items[0].worker_id === 'wk_hh_1' &&
          r.items[0].so_tien === 1_000_000,
      },

      // --- TRƯỜNG CHUYỂN TIỀN & CHUYỂN QUỸ & CHI PHÍ THÁNG ---
      {
        text: 'Trường chuyển tiền ăn tháng 10 162 triệu',
        check: (r) =>
          r.items[0]?.intent === 'truong_chuyen' &&
          r.items[0].ky_thang === '2026-10' &&
          r.items[0].so_tien === 162_000_000 &&
          r.items[0].vi === 'tk_mo_diep',
      },
      {
        text: 'Mợ Diệp nhận tiền ăn trường về 95 triệu',
        check: (r) =>
          r.items[0]?.intent === 'truong_chuyen' &&
          r.items[0].so_tien === 95_000_000 &&
          r.items[0].vi === 'tk_mo_diep',
      },
      {
        text: 'Rút 5 triệu từ TK chị Nhàn về tiền mặt',
        check: (r) =>
          r.items[0]?.intent === 'chuyen_quy' &&
          r.items[0].vi === 'tk_chi_nhan' &&
          r.items[0].sang_vi === 'tien_mat' &&
          r.items[0].so_tien === 5_000_000,
      },
      {
        text: 'Mợ Diệp đưa tiền mặt 10 triệu',
        check: (r) =>
          r.items[0]?.intent === 'chuyen_quy' &&
          r.items[0].vi === 'tk_mo_diep' &&
          r.items[0].sang_vi === 'tien_mat' &&
          r.items[0].so_tien === 10_000_000,
      },
      {
        text: 'Tiền điện tháng 9 hết 2 triệu 4',
        check: (r) =>
          r.items[0]?.intent === 'chi_phi_thang' &&
          r.items[0].category_id === 'cat_tien_dien' &&
          r.items[0].ky_thang === '2026-09' &&
          r.items[0].so_tien === 2_400_000 &&
          (r.items[0].lua_chon_lam_ro?.length ?? 0) === 3,
      },
      {
        text: 'Đổi 2 bình gas 900k tiền mặt',
        check: (r) =>
          r.items[0]?.intent === 'chi_phi_thang' &&
          r.items[0].category_id === 'cat_tien_gas' &&
          r.items[0].so_tien === 900_000 &&
          !r.items[0].lua_chon_lam_ro,
      },
      {
        text: 'Mua 5 lít dầu ăn mắm muối 350k tiền mặt',
        check: (r) =>
          r.items[0]?.intent === 'chi_phi_thang' &&
          r.items[0].category_id === 'cat_gia_vi_thang' &&
          r.items[0].so_tien === 350_000,
      },

      // --- HỎI BÁO CÁO (Q&A) & CÂU MƠ HỒ (khong_ro) ---
      {
        text: 'Hôm nay lãi bao nhiêu?',
        check: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'lai_hom_nay',
      },
      {
        text: 'Tháng này lãi thế nào',
        check: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'lai_thang',
      },
      {
        text: 'Đang nợ những ai',
        check: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'so_no_ncc',
      },
      {
        text: 'Tiền mặt còn bao nhiêu',
        check: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'so_du_vi',
      },
      {
        text: 'Tháng này trường chuyển tiền chưa?',
        check: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'tien_truong',
      },
      {
        text: 'Alo một hai ba thử máy',
        check: (r) => r.items[0]?.intent === 'khong_ro',
      },
    ];

    let passed = 0;
    const failedTexts: string[] = [];
    for (const c of corpus) {
      const res = parseVietnameseCommandLocal(c.text, snap, refDate);
      if (c.check(res)) {
        passed++;
      } else {
        failedTexts.push(`${c.text} => ${JSON.stringify(res.items)}`);
      }
    }

    const accuracy = passed / corpus.length;
    expect(failedTexts).toEqual([]);
    expect(accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('4. Tách câu ghép nhiều việc -> Thực thi lưu hàng loạt + Tự tạo mối hàng mới + Hoàn tác 1 chạm', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S3_MultiCommit_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const ngay = '2026-10-31';

    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');

    // Câu ghép 3 việc: Suất ăn + Mua thịt trả luôn + Mua rau chị Hương ghi nợ (mối mới!)
    const compound =
      'Hôm nay sáng 100, trưa 300, vãng lai trưa 4, mua thịt 1 triệu 2, lấy rau chị Hương 300k ghi nợ';
    const parsed = parseVietnameseCommandLocal(compound, snap, ngay);

    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0].intent).toBe('suat_an');
    expect(parsed.items[1].intent).toBe('chi');
    expect(parsed.items[1].so_tien).toBe(1_200_000);
    expect(parsed.items[2].intent).toBe('chi_no');
    expect(parsed.items[2].ten_ncc_moi).toBe('Chị Hương');
    expect(parsed.items[2].so_tien).toBe(300_000);

    // Ghi log chat_logs và thực thi lưu cả 3 thẻ
    const log = await repo.addChatLog(bo, {
      book_id: 'hiep_hoa',
      nguoi_dung: 'bo',
      nguon: 'chat',
      cau_noi: compound,
      ai_json: parsed,
      ket_qua: 'cho_xac_nhan',
    });

    const undoFns: Array<() => Promise<void>> = [];
    for (const item of parsed.items) {
      const card = buildActionCardFromIntent(item, snap, compound, repo);
      expect(card).not.toBeNull();
      const undo = await card!.commit(bo, 'chat');
      undoFns.push(undo.undoFn);
      snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    }
    await repo.updateChatLogStatus(bo, 'hiep_hoa', log.id, 'da_luu');

    // Kiểm tra 3 Sổ sau khi lưu:
    // Doanh thu Bếp: 100*15k (1.5tr) + 300*25k (7.5tr) + 4*30k (120k) = 9.120.000đ
    // Chi nguyên liệu ngày: 1.2tr (thịt trả luôn) + 300k (rau mua chịu) = 1.500.000đ -> Lãi ước tính = 7.620.000đ
    const daily = computeDailyReport(snap, ngay);
    expect(daily.bep_an.tong_doanh_thu).toBe(9_120_000);
    expect(daily.bep_an.chi_nguyen_lieu_ngay).toBe(1_500_000);
    expect(daily.bep_an.lai_uoc_tinh_ngay).toBe(7_620_000);

    // Dòng tiền thực tế: Ví tiền mặt chỉ trừ 1.200.000đ (khoản 300k ghi nợ chị Hương tuyệt đối không trừ ví!)
    const wallets = computeWalletBalances(snap.wallets, snap.transactions, 'hiep_hoa');
    expect(wallets.find((w) => w.wallet.id === 'hh_tien_mat')!.so_du_hien_tai).toBe(-1_200_000);

    // Sổ nợ: Đã tự động tạo mối hàng mới "Chị Hương" với số dư nợ 300.000đ!
    const debt = computeDebtAndPayables(snap, '2026-10');
    expect(debt.nha_cung_cap.tong_no_ncc).toBe(300_000);
    expect(
      debt.nha_cung_cap.danh_sach.find((d) => d.supplier.ten_ncc === 'Chị Hương')?.con_no
    ).toBe(300_000);

    // Bấm Hoàn tác cả 3 mục -> Sổ Lãi lỗ & Dòng tiền & Sổ nợ quay về 0!
    for (const fn of undoFns.reverse()) {
      await fn();
    }
    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(computeDailyReport(snap, ngay).bep_an.tong_doanh_thu).toBe(0);
    expect(computeDailyReport(snap, ngay).bep_an.chi_nguyen_lieu_ngay).toBe(0);
    expect(computeDebtAndPayables(snap, '2026-10').nha_cung_cap.tong_no_ncc).toBe(0);

    const logs = await repo.listChatLogs(bo, 'hiep_hoa');
    expect(logs[0].ket_qua).toBe('da_luu');
  });
});
