import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseVietnameseCommandLocal } from '../ai/localVnNlu';
import { LocalDexieAdapter } from '../db';
import {
  buildSpokenDailyReport,
  buildSpokenMonthlyReport,
  computeDailyReport,
  computeMonthlyReport,
  computeSevenDaySeries,
} from '../domain/accounting';
import { prepareTextForVietnameseSpeech } from '../ai/voiceEngine';

describe('Phiên 5 — Báo cáo Lãi Ngày, Chuỗi 7 Ngày & Báo cáo Tháng (Khớp 100% Bảng Tính Tay)', () => {
  it('1. Khớp tuyệt đối 100% từng đồng với bảng tính tay 7 ngày, đổi giá giữa kỳ, tạm tính tháng trước & chốt hóa đơn thật', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Session5_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const admin = await repo.loginWithPin('admin', '9999');

    // =========================================================================
    // BƯỚC 1: HÓA ĐƠN CUỐI THÁNG 09/2026 (LÀM MỐC TẠM ƯỚC TÍNH CHO THÁNG 10)
    // Gas 1.8tr + Gia vị 700k (Bếp = 2.5tr) | Điện 2.2tr + Nước 500k (Chung = 2.7tr) -> Tổng = 5.2tr
    // =========================================================================
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-09-28',
      ky_thang: '2026-09',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_tien_gas',
      so_tien: 1_800_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Gas tháng 9',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-09-29',
      ky_thang: '2026-09',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_gia_vi_thang',
      so_tien: 700_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Gia vị mắm dầu tháng 9',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 2_200_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'Tiền điện tháng 9',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-09-30',
      ky_thang: '2026-09',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_nuoc',
      so_tien: 500_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Tiền nước tháng 9',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // =========================================================================
    // BƯỚC 2: NHẬP DỮ LIỆU 7 NGÀY LIÊN TIẾP (25/10/2026 -> 31/10/2026)
    // - 25/10 (CN): Nghỉ học hoàn toàn
    // =========================================================================

    // --- NGÀY 26/10 (Thứ Hai): Nhập gạo đầu tuần 6tr mua chịu -> Lãi ngày tạm âm -400.000đ ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      bua: 'sang',
      suat_truong: 80,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      bua: 'trua',
      suat_truong: 300,
      suat_vang_lai: 10,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_gao_bun_pho',
      so_tien: 6_000_000,
      wallet_id: null,
      supplier_id: 'sup_hh_gao',
      ghi_chu: 'Nhập gạo đầu tuần ghi sổ',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 2_400_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua thịt lợn',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 500_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua rau củ',
      nguon: 'giong',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-26',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-26',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    // Căn tin 26/10: nhập nước 3.2tr; thu cuối ngày 2.1tr TM + 700k CK = 2.8tr (trừ 300k vãng lai -> CT 2.5tr)
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'can_tin',
      loai: 'chi',
      category_id: 'cat_nhap_nuoc_ct',
      so_tien: 3_200_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Nhập nước ngọt sữa hộp',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 2_100_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Tiền mặt quầy cuối ngày',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-26',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 700_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'CK chị Nhàn cuối ngày',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // --- NGÀY 27/10 (Thứ Ba): Lãi Bếp +4.650.000đ ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      bua: 'trua',
      suat_truong: 320,
      suat_vang_lai: 5,
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 2_200_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua thịt',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 450_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua rau',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_trung_dau_gio',
      so_tien: 350_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Trứng đậu phụ',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-27',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-27',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'can_tin',
      loai: 'chi_no',
      category_id: 'cat_nhap_banh_keo_ct',
      so_tien: 1_500_000,
      wallet_id: null,
      supplier_id: 'sup_hh_gao',
      ghi_chu: 'Nhập bánh kẹo ghi sổ',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 1_950_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'TM cuối ngày',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-27',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 500_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'CK cuối ngày',
      nguon: 'chat',
      nguoi_tao: 'bo',
    });

    // --- NGÀY 28/10 (Thứ Tư): Sáng 60 + Trưa 300 + Tối 40 + Đặt cỗ 1.6tr + Trả nợ/Ứng lương/Trường chuyển ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      bua: 'sang',
      suat_truong: 60,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      bua: 'trua',
      suat_truong: 300,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      bua: 'toi',
      suat_truong: 40,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'bep_an',
      loai: 'thu',
      category_id: 'cat_thu_khac_bep',
      so_tien: 1_600_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Giáo viên đặt cỗ liên hoan',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_ca_hai_san',
      so_tien: 2_600_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua cá tôm',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 600_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Rau củ liên hoan',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-28',
      so_cong: 1.5,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-28',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    // Giao dịch Dòng tiền / Sổ nợ KHÔNG ĐƯỢC làm lệch Lãi lỗ:
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'bep_an',
      loai: 'tra_no',
      category_id: 'cat_tra_no_ncc',
      so_tien: 4_000_000,
      wallet_id: 'hh_tien_mat',
      supplier_id: 'sup_hh_gao',
      ghi_chu: 'Trả bớt nợ gạo',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'truong_chuyen',
      category_id: 'cat_truong_chuyen',
      so_tien: 20_000_000,
      wallet_id: 'hh_tk_mo_diep',
      ghi_chu: 'Trường tạm ứng tiền ăn đợt 1',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'tra_luong',
      category_id: 'cat_tra_luong',
      so_tien: 1_000_000,
      wallet_id: 'hh_tien_mat',
      worker_id: 'wk_hh_1',
      ghi_chu: 'Cô Lan ứng lương',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 2_000_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Thu quầy 28/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-28',
      mang: 'can_tin',
      loai: 'thu',
      category_id: 'cat_thu_khac_ct',
      so_tien: 100_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Bán vỏ thùng carton',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // --- NGÀY 29/10 (Thứ Năm): Cảnh báo lệch vãng lai (thu cuối ngày 400k < vãng lai 600k) ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-29',
      bua: 'trua',
      suat_truong: 280,
      suat_vang_lai: 20,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-29',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 1_900_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Thịt 29/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-29',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 400_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Rau 29/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-29',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-29',
      so_cong: 1,
      don_gia_cong: 250_000,
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-29',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 400_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Nhập thiếu tiền thu cuối ngày',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // --- NGÀY 30/10 (Thứ Sáu): Trường tăng giá bữa trưa từ 25k -> 27k áp dụng từ 2026-10-30 ---
    await repo.upsertMealPrice(admin, {
      book_id: 'hiep_hoa',
      bua: 'trua',
      loai_khach: 'truong',
      don_gia: 27_000,
      ap_dung_tu_ngay: '2026-10-30',
    });
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      bua: 'trua',
      suat_truong: 300,
      suat_vang_lai: 10,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      mang: 'bep_an',
      loai: 'chi_no',
      category_id: 'cat_thit',
      so_tien: 2_100_000,
      wallet_id: null,
      supplier_id: 'sup_hh_thit',
      ghi_chu: 'Lấy thịt nợ mối chợ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_trang_mieng',
      so_tien: 600_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Dưa hấu tráng miệng',
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
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      mang: 'can_tin',
      loai: 'chi',
      category_id: 'cat_nhap_an_vat_ct',
      so_tien: 800_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Nhập xúc xích mì hộp',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 1_800_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'TM cuối ngày 30/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-30',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 900_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'CK cuối ngày 30/10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    // --- NGÀY 31/10 (Thứ Bảy): Học nửa ngày + 1 giao dịch xóa mềm không được tính ---
    await repo.upsertMealCount(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-31',
      bua: 'sang',
      suat_truong: 100,
      suat_vang_lai: 0,
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-31',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_gao_bun_pho',
      so_tien: 550_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Mua phở sáng thứ 7',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_1',
      ngay: '2026-10-31',
      so_cong: 0.5,
      don_gia_cong: 250_000,
    });
    await repo.upsertAttendance(bo, {
      book_id: 'hiep_hoa',
      worker_id: 'wk_hh_2',
      ngay: '2026-10-31',
      so_cong: 0.5,
      don_gia_cong: 250_000,
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-31',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 900_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Thu căn tin sáng T7',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    // Giao dịch nhập nhầm rồi bấm Hoàn tác / Xóa mềm -> phải bị loại 100%
    const mistakenTx = await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-10-31',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 9_999_999,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Nhập nhầm đã xóa',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.softDeleteTransaction(bo, 'hiep_hoa', mistakenTx.id);

    // =========================================================================
    // KIỂM ĐỊNH 1: BÁO CÁO TỪNG NGÀY ĐẶC BIỆT
    // =========================================================================
    let snap = await repo.getBookSnapshot(bo, 'hiep_hoa');

    // Ngày nghỉ 25/10: không chia cho 0 (NaN/Infinity)
    const d25 = computeDailyReport(snap, '2026-10-25');
    expect(d25.bep_an.tong_suat).toBe(0);
    expect(d25.bep_an.lai_uoc_tinh_ngay).toBe(0);
    expect(d25.bep_an.gia_von_ngay_moi_suat).toBe(0);
    expect(d25.bep_an.doanh_thu_binh_quan_suat).toBe(0);

    // Ngày 26/10: tách rõ chi trả ngay (2.9tr) vs mua chịu (6tr), lãi tạm âm -400.000đ
    const d26 = computeDailyReport(snap, '2026-10-26');
    expect(d26.bep_an.tong_suat).toBe(390);
    expect(d26.bep_an.tong_doanh_thu).toBe(9_000_000);
    expect(d26.bep_an.chi_cho_tra_ngay).toBe(2_900_000);
    expect(d26.bep_an.chi_cho_mua_chiu).toBe(6_000_000);
    expect(d26.bep_an.chi_nguyen_lieu_ngay).toBe(8_900_000);
    expect(d26.bep_an.chi_cong_tho_ngay).toBe(500_000);
    expect(d26.bep_an.lai_uoc_tinh_ngay).toBe(-400_000);
    expect(d26.can_tin.thu_tien_mat_cuoi_ngay).toBe(2_100_000);
    expect(d26.can_tin.thu_chuyen_khoan_cuoi_ngay).toBe(700_000);
    expect(d26.can_tin.tru_tien_vang_lai).toBe(300_000);
    expect(d26.can_tin.doanh_thu_can_tin).toBe(2_500_000);
    expect(d26.can_tin.chi_nhap_hang_ngay).toBe(3_200_000);

    // Ngày 28/10: kiểm tra đơn giá vốn / suất & không lẫn trả nợ / ứng lương / trường chuyển
    const d28 = computeDailyReport(snap, '2026-10-28');
    expect(d28.bep_an.tong_suat).toBe(400);
    expect(d28.bep_an.tong_doanh_thu).toBe(11_000_000);
    expect(d28.bep_an.tong_so_cong_ngay).toBe(2.5);
    expect(d28.bep_an.tong_chi_ngay).toBe(3_825_000);
    expect(d28.bep_an.lai_uoc_tinh_ngay).toBe(7_175_000);
    expect(d28.bep_an.doanh_thu_binh_quan_suat).toBe(27_500);
    expect(d28.bep_an.gia_von_ngay_moi_suat).toBe(9_563);
    expect(d28.bep_an.lai_ngay_moi_suat).toBe(17_938);
    expect(d28.can_tin.doanh_thu_can_tin).toBe(2_100_000);

    // Ngày 29/10: bật cờ cảnh báo lệch vãng lai & giá bữa trưa trước ngày 30/10 vẫn là 25.000đ
    const d29 = computeDailyReport(snap, '2026-10-29');
    expect(d29.bep_an.chi_tiet_bua.trua.don_gia_truong).toBe(25_000);
    expect(d29.bep_an.doanh_thu_truong).toBe(7_000_000);
    expect(d29.can_tin.canh_bao_lech_vang_lai).toBe(true);
    expect(d29.can_tin.doanh_thu_can_tin).toBe(0);

    // Ngày 30/10: áp dụng giá mới 27.000đ/suất trưa trường
    const d30 = computeDailyReport(snap, '2026-10-30');
    expect(d30.bep_an.chi_tiet_bua.trua.don_gia_truong).toBe(27_000);
    expect(d30.bep_an.doanh_thu_truong).toBe(8_100_000);
    expect(d30.bep_an.lai_uoc_tinh_ngay).toBe(5_200_000);

    // =========================================================================
    // KIỂM ĐỊNH 2: BIỂU ĐỒ CHUỖI 7 NGÀY (25/10 -> 31/10)
    // =========================================================================
    const series = computeSevenDaySeries(snap, '2026-10-31', 7);
    expect(series.tu_ngay).toBe('2026-10-25');
    expect(series.den_ngay).toBe('2026-10-31');
    expect(series.diem_ngay).toHaveLength(7);
    expect(series.so_ngay_co_ghi_chep).toBe(6);
    expect(series.tong_suat_7_ngay).toBe(1_825);
    expect(series.tong_doanh_thu_bep_7_ngay).toBe(45_650_000);
    expect(series.tong_chi_bep_7_ngay).toBe(23_525_000);
    expect(series.tong_lai_bep_7_ngay).toBe(22_125_000);
    expect(series.diem_ngay.map((p) => p.bep_lai_ngay)).toEqual([
      0,
      -400_000,
      4_650_000,
      7_175_000,
      4_800_000,
      5_200_000,
      700_000,
    ]);

    // =========================================================================
    // KIỂM ĐỊNH 3: BÁO CÁO THÁNG 10 KHI CHƯA NHẬP HÓA ĐƠN (TẠM TÍNH TỪ THÁNG 9)
    // =========================================================================
    const octEst = computeMonthlyReport(snap, '2026-10');
    expect(octEst.so_ngay_hoat_dong).toBe(6);
    expect(octEst.la_uoc_tinh_tu_thang_truoc).toBe(true);
    expect(octEst.ky_thang_nguon_chi_thang).toBe('2026-09');
    expect(octEst.tong_chi_cuoi_thang_ap_dung).toBe(5_200_000);

    // Bếp ăn T10:
    expect(octEst.bep_an.tong_suat_truong).toBe(1_780);
    expect(octEst.bep_an.tong_suat_vang_lai).toBe(45);
    expect(octEst.bep_an.tong_suat).toBe(1_825);
    expect(octEst.bep_an.doanh_thu_truong).toBe(42_700_000);
    expect(octEst.bep_an.doanh_thu_vang_lai).toBe(1_350_000);
    expect(octEst.bep_an.thu_khac).toBe(1_600_000);
    expect(octEst.bep_an.doanh_thu).toBe(45_650_000);
    expect(octEst.bep_an.chi_nguyen_lieu_ngay).toBe(20_650_000);
    expect(octEst.bep_an.tong_so_cong).toBe(11.5);
    expect(octEst.bep_an.chi_cong_tho).toBe(2_875_000);
    expect(octEst.bep_an.chi_ngay).toBe(23_525_000);
    expect(octEst.bep_an.chi_cuoi_thang_rieng).toBe(2_500_000);
    expect(octEst.bep_an.lai_bep_an).toBe(19_625_000);

    // Giá vốn / 1 suất ăn T10:
    expect(octEst.bep_an.doanh_thu_binh_quan_suat).toBe(25_014);
    expect(octEst.bep_an.gia_von_nguyen_lieu_cong_moi_suat).toBe(12_890);
    expect(octEst.bep_an.gia_von_bep_day_du_moi_suat).toBe(14_260);
    expect(octEst.bep_an.gia_von_phan_bo_chung_moi_suat).toBe(15_740);
    expect(octEst.bep_an.lai_bep_moi_suat).toBe(10_753);

    // Căn tin T10:
    expect(octEst.can_tin.doanh_thu).toBe(10_200_000);
    expect(octEst.can_tin.chi_nhap_hang).toBe(5_500_000);
    expect(octEst.can_tin.lai_can_tin).toBe(4_700_000);
    expect(octEst.can_tin.ty_suat_lai_phan_tram).toBe(46.1);

    // Lãi ròng & Đẳng thức kế toán tổng thể:
    expect(octEst.chi_cuoi_thang_chung).toBe(2_700_000);
    expect(octEst.tong_doanh_thu_toan_co_so).toBe(55_850_000);
    expect(octEst.tong_chi_toan_co_so).toBe(34_225_000);
    expect(octEst.lai_rong_toan_co_so).toBe(21_625_000);
    expect(octEst.tong_doanh_thu_toan_co_so - octEst.tong_chi_toan_co_so).toBe(
      octEst.lai_rong_toan_co_so
    );

    // Tổng cơ cấu chi theo danh mục phải khớp 100% đến từng đồng với tổng chi toàn cơ sở:
    const sumBreakdownEst = octEst.chi_theo_danh_muc.reduce(
      (s, item) => s + item.so_tien,
      0
    );
    expect(sumBreakdownEst).toBe(octEst.tong_chi_toan_co_so);
    // Danh mục chi lớn nhất tháng 10 phải là Thịt (8.600.000đ)
    expect(octEst.chi_theo_danh_muc[0].category_id).toBe('cat_thit');
    expect(octEst.chi_theo_danh_muc[0].so_tien).toBe(8_600_000);
    // Các khoản mượn từ tháng 9 phải gắn cờ la_uoc_tinh = true
    expect(
      octEst.chi_theo_danh_muc.filter((x) => x.la_uoc_tinh).map((x) => x.so_tien)
    ).toEqual([2_200_000, 1_800_000, 700_000, 500_000]);

    // =========================================================================
    // KIỂM ĐỊNH 4: SANG ĐẦU THÁNG 11 NHẬP HÓA ĐƠN THỰC TẾ CHO KỲ 2026-10
    // Gas 2tr + Gia vị 900k (Bếp = 2.9tr) | Điện 2.4tr + Nước 600k + Rác 300k (Chung = 3.3tr) -> 6.2tr
    // =========================================================================
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_tien_gas',
      so_tien: 2_000_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Gas tháng 10 thực tế',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_gia_vi_thang',
      so_tien: 900_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Gia vị tháng 10 thực tế',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_dien',
      so_tien: 2_400_000,
      wallet_id: 'hh_tk_chi_nhan',
      ghi_chu: 'Điện tháng 10 thực tế',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_tien_nuoc',
      so_tien: 600_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Nước tháng 10 thực tế',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    await repo.addTransaction(bo, {
      book_id: 'hiep_hoa',
      ngay: '2026-11-02',
      ky_thang: '2026-10',
      mang: 'chung',
      loai: 'chi',
      category_id: 'cat_ve_sinh_thang',
      so_tien: 300_000,
      wallet_id: 'hh_tien_mat',
      ghi_chu: 'Tiền rác vệ sinh tháng 10',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });

    snap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    const octReal = computeMonthlyReport(snap, '2026-10');
    expect(octReal.la_uoc_tinh_tu_thang_truoc).toBe(false);
    expect(octReal.ky_thang_nguon_chi_thang).toBe('2026-10');
    expect(octReal.tong_chi_cuoi_thang_ap_dung).toBe(6_200_000);
    expect(octReal.bep_an.lai_bep_an).toBe(19_225_000);
    expect(octReal.lai_rong_toan_co_so).toBe(20_625_000);
    expect(octReal.chi_theo_danh_muc.some((x) => x.la_uoc_tinh)).toBe(false);
    expect(
      octReal.chi_theo_danh_muc.reduce((s, item) => s + item.so_tien, 0)
    ).toBe(35_225_000);

    // Kỳ tháng 11 chưa có suất ăn / thu chi ngày nào -> KHÔNG ĐƯỢC tự trừ nhầm hóa đơn tháng 10 gây lỗ ảo!
    const novEmpty = computeMonthlyReport(snap, '2026-11');
    expect(novEmpty.so_ngay_hoat_dong).toBe(0);
    expect(novEmpty.la_uoc_tinh_tu_thang_truoc).toBe(false);
    expect(novEmpty.lai_rong_toan_co_so).toBe(0);

    // Kiểm tra bản tin đọc to bằng giọng tiếng Việt cho ông bà
    const spokenDay = prepareTextForVietnameseSpeech(buildSpokenDailyReport(snap, d28));
    expect(spokenDay).toContain('400 suất');
    expect(spokenDay).toContain('7 triệu 175 nghìn đồng');

    const spokenMonth = prepareTextForVietnameseSpeech(
      buildSpokenMonthlyReport(snap, octReal)
    );
    expect(spokenMonth).toContain('1825 suất');
    expect(spokenMonth).toContain('20 triệu 625 nghìn đồng');
  });

  it('2. Sổ Tiên Du (Mẹ): Căn tin tuyệt đối không tính lãi ngày, khôi phục giao dịch xóa mềm tự cập nhật lại lãi ngày & tháng', async () => {
    const repo = new LocalDexieAdapter(`TestDB_Session5_TienDu_${Date.now()}`);
    const me = await repo.loginWithPin('me', '2222');

    // Mẹ báo 250 suất trưa trường (x28k = 7.000.000) + 10 suất vãng lai (x35k = 350.000) = 7.350.000
    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-20',
      bua: 'trua',
      suat_truong: 250,
      suat_vang_lai: 10,
      nguon: 'giong',
      nguoi_tao: 'me',
    });

    const txThit = await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-20',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_thit',
      so_tien: 2_350_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Mua thịt gà lợn Tiên Du',
      nguon: 'giong',
      nguoi_tao: 'me',
    });

    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-20',
      mang: 'can_tin',
      loai: 'thu_cuoi_ngay',
      category_id: 'cat_thu_cuoi_ngay',
      so_tien: 3_350_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Thu cuối ngày Tiên Du',
      nguon: 'giong',
      nguoi_tao: 'me',
    });

    await repo.addTransaction(me, {
      book_id: 'tien_du',
      ngay: '2026-10-20',
      mang: 'can_tin',
      loai: 'chi',
      category_id: 'cat_nhap_banh_keo_ct',
      so_tien: 4_200_000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'Nhập thùng sữa bánh lớn bán cả tuần',
      nguon: 'giong',
      nguoi_tao: 'me',
    });

    let snap = await repo.getBookSnapshot(me, 'tien_du');
    let d = computeDailyReport(snap, '2026-10-20');

    // Căn tin trong ngày chỉ có doanh_thu_can_tin (3.000.000) & chi_nhap_hang_ngay (4.200.000), KHÔNG có trường lãi ngày
    expect(d.can_tin.doanh_thu_can_tin).toBe(3_000_000);
    expect(d.can_tin.chi_nhap_hang_ngay).toBe(4_200_000);
    expect('lai_can_tin' in d.can_tin).toBe(false);
    expect(d.bep_an.lai_uoc_tinh_ngay).toBe(5_000_000);

    // Xóa mềm khoản thịt 2.350.000 -> Lãi ngày tăng lên 7.350.000; Khôi phục lại -> quay đúng về 5.000.000
    await repo.softDeleteTransaction(me, 'tien_du', txThit.id);
    snap = await repo.getBookSnapshot(me, 'tien_du');
    expect(computeDailyReport(snap, '2026-10-20').bep_an.lai_uoc_tinh_ngay).toBe(7_350_000);

    await repo.restoreTransaction(me, 'tien_du', txThit.id);
    snap = await repo.getBookSnapshot(me, 'tien_du');
    d = computeDailyReport(snap, '2026-10-20');
    expect(d.bep_an.lai_uoc_tinh_ngay).toBe(5_000_000);

    // Hỏi đáp qua Trợ lý Chat AI cũng trả về khớp đúng con số 5.000.000đ của Báo cáo Ngày
    const qaDay = parseVietnameseCommandLocal('Hôm nay bếp lãi bao nhiêu?', snap, '2026-10-20');
    expect(qaDay.items[0]?.intent).toBe('hoi');
    expect(qaDay.items[0]?.cau_tra_loi).toContain('5.000.000 đ');

    const qaMonth = parseVietnameseCommandLocal('Tháng này lãi bao nhiêu?', snap, '2026-10-20');
    expect(qaMonth.items[0]?.intent).toBe('hoi');
    // Bếp lãi 5.000.000 + Căn tin (3.000.000 - 4.200.000 = -1.200.000) = Lãi ròng 3.800.000 đ
    expect(qaMonth.items[0]?.cau_tra_loi).toContain('3.800.000 đ');
  });
});
