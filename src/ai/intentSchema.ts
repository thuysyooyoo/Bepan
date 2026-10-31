import type { BusinessSegment, MealPeriod, WalletKind } from '../types/models';

export type AIIntentType =
  | 'suat_an'
  | 'giong_hom_qua'
  | 'vang_lai'
  | 'thu_can_tin'
  | 'chi'
  | 'chi_no'
  | 'tra_no'
  | 'cham_cong'
  | 'truong_chuyen'
  | 'tra_luong'
  | 'chi_phi_thang'
  | 'chuyen_quy'
  | 'hoi'
  | 'khong_ro';

export interface ClarificationChoice {
  id: string;
  label: string;
  patch: Partial<ParsedIntentItem>;
}

export interface ParsedIntentItem {
  intent: AIIntentType;
  ngay: string; // YYYY-MM-DD
  ky_thang?: string; // YYYY-MM

  // Cho suat_an / vang_lai
  suat_an?: {
    sang_truong?: number;
    trua_truong?: number;
    toi_truong?: number;
    sang_vang_lai?: number;
    trua_vang_lai?: number;
    toi_vang_lai?: number;
  };
  bua_vang_lai?: MealPeriod;
  so_suat_vang_lai?: number;

  // Cho thu_can_tin (Thu cuối ngày Cách A)
  thu_cuoi_ngay?: {
    tien_mat: number;
    chuyen_khoan: number;
  };

  // Cho chi / chi_no / tra_no / truong_chuyen / tra_luong / chi_phi_thang / chuyen_quy
  mang?: BusinessSegment;
  category_id?: string;
  so_tien?: number;
  vi?: WalletKind;
  sang_vi?: WalletKind;

  // Cho chi_no / tra_no (Nhà cung cấp có sẵn hoặc tên mối mới phát hiện)
  supplier_id?: string;
  ten_ncc_moi?: string;

  // Cho cham_cong / tra_luong
  cham_cong?: Array<{
    worker_id: string;
    ho_ten: string;
    so_cong: 0 | 0.5 | 1;
  }>;
  worker_id?: string;

  // Cho câu hỏi báo cáo ('hoi') hoặc 'khong_ro'
  chu_de_hoi?:
    | 'lai_hom_nay'
    | 'lai_thang'
    | 'so_du_vi'
    | 'so_no_ncc'
    | 'tien_truong'
    | 'luong_tho'
    | 'tong_hop';
  cau_tra_loi?: string;

  ghi_chu: string;

  // Khi thiếu thông tin hoặc câu nói mơ hồ -> hiện nút bấm hỏi lại ông bà
  cau_hoi_lam_ro?: string;
  lua_chon_lam_ro?: ClarificationChoice[];
}

export interface AIParseResult {
  engine: 'gemini' | 'local_vn';
  raw_text: string;
  items: ParsedIntentItem[];
}

/**
 * JSON Schema chuẩn cho Gemini Structured Output (dùng trong Netlify Function /api/parse)
 */
export const GEMINI_PARSE_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
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
        },
        required: ['intent', 'ngay', 'ghi_chu'],
      },
    },
  },
  required: ['items'],
} as const;
