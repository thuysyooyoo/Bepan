-- ============================================================================
-- 002_receivables.sql: Bổ sung theo dõi Khoản phải thu (ban_chiu & thu_no)
-- Mở rộng CHECK constraint cột 'loai' và thêm cột 'doi_tac' cho bảng transactions
-- ============================================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS doi_tac TEXT DEFAULT '';

-- Cập nhật ràng buộc CHECK constraint cho cột loai
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_loai_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_loai_check CHECK (
    loai IN (
      'thu_cuoi_ngay',
      'thu',
      'chi',
      'chi_no',
      'tra_no',
      'truong_chuyen',
      'tra_luong',
      'chuyen_quy',
      'dieu_chinh_vi',
      'ban_chiu',
      'thu_no'
    )
  );

CREATE INDEX IF NOT EXISTS idx_transactions_doi_tac 
  ON public.transactions (book_id, doi_tac) 
  WHERE doi_tac IS NOT NULL AND doi_tac != '';
