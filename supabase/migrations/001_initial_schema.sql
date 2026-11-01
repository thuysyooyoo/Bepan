-- =============================================================================
-- SỔ BẾP NHÀ MÌNH — SUPABASE POSTGRESQL SCHEMA, RLS, SEED, PIN AUTH & REALTIME
-- Dự án Supabase: https://grqlnqycxxadedqlppyl.supabase.co
-- Tuân thủ chuẩn kiến trúc bảo mật secure-hybrid-web-architect:
--   1. Bật Row Level Security (RLS) trên 100% bảng & View (security_invoker = true)
--   2. Chặn tuyệt đối 'anon' trên toàn bộ bảng dữ liệu thực tế
--   3. Cô lập sổ theo vai trò: Bố chỉ thấy Hiệp Hòa, Mẹ chỉ thấy Tiên Du, Admin thấy cả hai
--   4. Khởi tạo sẵn 2 sổ, 26 danh mục, 6 ví, 12 đơn giá, 4 phụ bếp, 4 mối hàng
--   5. Tạo sẵn 3 tài khoản Virtual Email + Mã PIN mặc định (Bố: 1111, Mẹ: 2222, Admin: 9999)
--   6. Bật sẵn Supabase Realtime 2 chiều trên toàn bộ bảng nghiệp vụ
--
-- HƯỚNG DẪN CHẠY (CHỈ 1 LẦN TRÊN SUPABASE DASHBOARD):
--   Mở SQL Editor -> New Query -> Dán toàn bộ nội dung file này -> Bấm RUN.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. KHỞI TẠO 12 BẢNG DỮ LIỆU CỐT LÕI (HỖ TRỢ ĐỒNG BỘ 1:1 VỚI LOCAL DEXIE)
-- -----------------------------------------------------------------------------

-- 1.1 Sổ cơ sở (Hiệp Hòa / Tiên Du)
CREATE TABLE IF NOT EXISTS public.books (
  id TEXT PRIMARY KEY,
  ten TEXT NOT NULL,
  dia_diem TEXT NOT NULL,
  chu_so TEXT NOT NULL,
  gio_nhac_hang_ngay TEXT NOT NULL DEFAULT '18:00',
  ngay_nhac_truong_chuyen INTEGER NOT NULL DEFAULT 20 CHECK (ngay_nhac_truong_chuyen BETWEEN 1 AND 28),
  so_ngay_nhac_no_ncc INTEGER NOT NULL DEFAULT 15 CHECK (so_ngay_nhac_no_ncc >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.2 Hồ sơ người dùng gắn với auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  ten_hien_thi TEXT NOT NULL,
  xung_ho TEXT NOT NULL,
  mo_ta TEXT NOT NULL DEFAULT '',
  vai_tro TEXT NOT NULL CHECK (vai_tro IN ('owner', 'admin')),
  book_id TEXT REFERENCES public.books(id),
  virtual_email TEXT NOT NULL UNIQUE,
  avatar_emoji TEXT NOT NULL DEFAULT '👤',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owner_must_have_book CHECK (
    (vai_tro = 'admin') OR (vai_tro = 'owner' AND book_id IS NOT NULL)
  )
);

-- 1.3 Đơn giá suất ăn (lưu lịch sử theo ngày áp dụng để đổi giá không sai tháng cũ)
CREATE TABLE IF NOT EXISTS public.meal_prices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  bua TEXT NOT NULL CHECK (bua IN ('sang', 'trua', 'toi')),
  loai_khach TEXT NOT NULL CHECK (loai_khach IN ('truong', 'vang_lai')),
  don_gia BIGINT NOT NULL CHECK (don_gia >= 0),
  ap_dung_tu_ngay DATE NOT NULL,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, bua, loai_khach, ap_dung_tu_ngay)
);
CREATE INDEX IF NOT EXISTS idx_meal_prices_lookup
  ON public.meal_prices (book_id, bua, loai_khach, ap_dung_tu_ngay DESC);

-- 1.4 Số lượng suất ăn từng ngày
CREATE TABLE IF NOT EXISTS public.meal_counts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  ngay DATE NOT NULL,
  bua TEXT NOT NULL CHECK (bua IN ('sang', 'trua', 'toi')),
  suat_truong INTEGER NOT NULL DEFAULT 0 CHECK (suat_truong >= 0),
  suat_vang_lai INTEGER NOT NULL DEFAULT 0 CHECK (suat_vang_lai >= 0),
  ghi_chu TEXT DEFAULT '',
  nguon TEXT NOT NULL DEFAULT 'tay' CHECK (nguon IN ('giong', 'chat', 'tay')),
  nguoi_tao TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, ngay, bua)
);
CREATE INDEX IF NOT EXISTS idx_meal_counts_book_date
  ON public.meal_counts (book_id, ngay DESC);

-- 1.5 Danh sách công nhân / phụ bếp
CREATE TABLE IF NOT EXISTS public.workers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  ho_ten TEXT NOT NULL,
  luong_ngay BIGINT NOT NULL CHECK (luong_ngay >= 0),
  dang_lam BOOLEAN NOT NULL DEFAULT true,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workers_book ON public.workers (book_id, dang_lam);

-- 1.6 Chấm công theo ngày (tính chi phí lương ngày vào Bếp ăn, cuối tháng mới trả)
CREATE TABLE IF NOT EXISTS public.attendance (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  ngay DATE NOT NULL,
  so_cong NUMERIC(3,1) NOT NULL CHECK (so_cong IN (0, 0.5, 1, 1.5, 2)),
  don_gia_cong BIGINT NOT NULL CHECK (don_gia_cong >= 0),
  ghi_chu TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (worker_id, ngay)
);
CREATE INDEX IF NOT EXISTS idx_attendance_book_date
  ON public.attendance (book_id, ngay DESC);

-- 1.7 Ví / Tài khoản thực tế (mỗi cơ sở có 3 ví riêng: Tiền mặt, TK mợ Diệp, TK chị Nhàn)
CREATE TABLE IF NOT EXISTS public.wallets (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  loai_vi TEXT NOT NULL CHECK (loai_vi IN ('tien_mat', 'tk_mo_diep', 'tk_chi_nhan')),
  ten_vi TEXT NOT NULL,
  chu_tai_khoan TEXT NOT NULL DEFAULT '',
  so_du_dau_ky BIGINT NOT NULL DEFAULT 0,
  thu_tu INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, loai_vi)
);

-- 1.8 Nhà cung cấp / tiểu thương ngoài chợ (phục vụ Sổ nợ mua chịu)
CREATE TABLE IF NOT EXISTS public.suppliers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  ten_ncc TEXT NOT NULL,
  mat_hang_chinh TEXT DEFAULT '',
  so_dien_thoai TEXT DEFAULT '',
  no_dau_ky BIGINT NOT NULL DEFAULT 0,
  dang_giao_dich BOOLEAN NOT NULL DEFAULT true,
  ghi_chu TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_book ON public.suppliers (book_id);

-- 1.9 Danh mục thu chi chuẩn (dùng chung toàn hệ thống)
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  ten_danh_muc TEXT NOT NULL,
  nhom TEXT NOT NULL CHECK (nhom IN ('thu', 'chi', 'dong_tien')),
  kieu_tinh TEXT NOT NULL CHECK (kieu_tinh IN ('theo_ngay', 'theo_thang', 'khong_tinh_lai')),
  mang_mac_dinh TEXT NOT NULL CHECK (mang_mac_dinh IN ('bep_an', 'can_tin', 'chung')),
  icon TEXT NOT NULL DEFAULT '📝',
  tu_khoa_ai TEXT[] NOT NULL DEFAULT '{}',
  thu_tu INTEGER NOT NULL DEFAULT 100
);

-- 1.10 Giao dịch thu chi / dòng tiền / công nợ
CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  ngay DATE NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  mang TEXT NOT NULL CHECK (mang IN ('bep_an', 'can_tin', 'chung')),
  loai TEXT NOT NULL CHECK (
    loai IN (
      'thu_cuoi_ngay',
      'thu',
      'chi',
      'chi_no',
      'tra_no',
      'truong_chuyen',
      'tra_luong',
      'chuyen_quy',
      'dieu_chinh_vi'
    )
  ),
  category_id TEXT REFERENCES public.categories(id),
  so_tien BIGINT NOT NULL,
  wallet_id TEXT REFERENCES public.wallets(id),
  to_wallet_id TEXT REFERENCES public.wallets(id),
  supplier_id TEXT REFERENCES public.suppliers(id) ON DELETE SET NULL,
  worker_id TEXT REFERENCES public.workers(id) ON DELETE SET NULL,
  ky_thang TEXT,
  ghi_chu TEXT NOT NULL DEFAULT '',
  cau_noi_goc TEXT DEFAULT '',
  nguon TEXT NOT NULL DEFAULT 'tay' CHECK (nguon IN ('giong', 'chat', 'tay')),
  nguoi_tao TEXT NOT NULL,
  da_xoa BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_transactions_book_ngay
  ON public.transactions (book_id, ngay DESC) WHERE da_xoa = false;
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp
  ON public.transactions (book_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_ky_thang
  ON public.transactions (book_id, ky_thang) WHERE da_xoa = false;

-- 1.11 Nhắc việc định kỳ / trạng thái tạm ẩn (snooze)
CREATE TABLE IF NOT EXISTS public.reminders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  loai_nhac TEXT NOT NULL CHECK (
    loai_nhac IN (
      'nhap_so_ngay',
      'truong_chuyen_tien',
      'tra_luong',
      'chi_phi_thang',
      'no_qua_han'
    )
  ),
  ky_thang TEXT NOT NULL DEFAULT '',
  tieu_de TEXT NOT NULL,
  noi_dung TEXT NOT NULL DEFAULT '',
  so_tien_du_kien BIGINT,
  ngay_bat_dau_nhac DATE NOT NULL,
  trang_thai TEXT NOT NULL DEFAULT 'dang_nhac' CHECK (trang_thai IN ('dang_nhac', 'xong', 'bo_qua')),
  matched_transaction_id TEXT REFERENCES public.transactions(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, loai_nhac, ky_thang)
);
CREATE INDEX IF NOT EXISTS idx_reminders_active
  ON public.reminders (book_id, trang_thai, ngay_bat_dau_nhac);

-- 1.12 Nhật ký hội thoại AI (để Admin xem & tinh chỉnh từ địa phương)
CREATE TABLE IF NOT EXISTS public.chat_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  book_id TEXT NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  nguoi_dung TEXT NOT NULL,
  nguon TEXT NOT NULL CHECK (nguon IN ('giong', 'chat')),
  cau_noi TEXT NOT NULL,
  ai_json JSONB,
  ket_qua TEXT NOT NULL DEFAULT 'cho_xac_nhan' CHECK (ket_qua IN ('cho_xac_nhan', 'da_luu', 'da_sua', 'huy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_timestamp
  ON public.chat_logs (book_id, timestamp DESC);

-- -----------------------------------------------------------------------------
-- 2. HÀM PHÂN QUYỀN, ĐỔI MÃ PIN & BẢO MẬT ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_book(target_book_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND (p.vai_tro = 'admin' OR p.book_id = target_book_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.vai_tro = 'admin'
  );
$$;

-- Trả về đúng 3 thẻ chọn tài khoản trên màn hình đăng nhập (KHÔNG lộ email, hash hay dữ liệu sổ)
CREATE OR REPLACE FUNCTION public.get_public_login_profiles()
RETURNS TABLE (
  id TEXT,
  ten_hien_thi TEXT,
  xung_ho TEXT,
  mo_ta TEXT,
  vai_tro TEXT,
  book_id TEXT,
  avatar_emoji TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.ten_hien_thi,
    p.xung_ho,
    p.mo_ta,
    p.vai_tro,
    p.book_id,
    p.avatar_emoji
  FROM public.profiles p
  ORDER BY CASE p.id WHEN 'bo' THEN 1 WHEN 'me' THEN 2 ELSE 3 END;
$$;

REVOKE ALL ON FUNCTION public.get_public_login_profiles() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_login_profiles() TO anon, authenticated;

-- Hàm đổi mã PIN an toàn (chỉ chính chủ hoặc Admin mới thực thi được)
CREATE OR REPLACE FUNCTION public.change_user_pin(
  p_target_profile_id TEXT,
  p_new_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_target_uid UUID;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Bạn chưa đăng nhập.';
  END IF;

  IF p_new_secret IS NULL OR length(p_new_secret) < 12 THEN
    RAISE EXCEPTION 'Mã bí mật PIN không hợp lệ.';
  END IF;

  SELECT p.auth_user_id INTO v_target_uid
  FROM public.profiles p
  WHERE p.id = p_target_profile_id;

  IF v_target_uid IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy hồ sơ người dùng.';
  END IF;

  IF v_target_uid <> v_caller_uid AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permission denied: Chỉ chính chủ hoặc Admin mới được đổi mã PIN.';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_new_secret, extensions.gen_salt('bf')),
    updated_at = now()
  WHERE id = v_target_uid;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.change_user_pin(TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.change_user_pin(TEXT, TEXT) TO authenticated;

-- Bật RLS trên TẤT CẢ 12 bảng
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_logs ENABLE ROW LEVEL SECURITY;

-- Xóa policy cũ nếu chạy lại để đảm bảo idempotent 100%
DROP POLICY IF EXISTS "books_select" ON public.books;
DROP POLICY IF EXISTS "books_owner_update" ON public.books;
DROP POLICY IF EXISTS "books_admin_write" ON public.books;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write" ON public.profiles;
DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "categories_admin_write" ON public.categories;

-- Chính sách books: Bố/Mẹ đọc & chỉnh giờ nhắc của đúng sổ mình; Admin toàn quyền
CREATE POLICY "books_select" ON public.books
  FOR SELECT TO authenticated USING (public.can_access_book(id));
CREATE POLICY "books_owner_update" ON public.books
  FOR UPDATE TO authenticated
  USING (public.can_access_book(id))
  WITH CHECK (public.can_access_book(id));
CREATE POLICY "books_admin_write" ON public.books
  FOR ALL TO authenticated
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- Chính sách profiles: chỉ đọc hồ sơ của chính mình (hoặc Admin đọc tất cả)
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid() OR public.is_admin_user());
CREATE POLICY "profiles_admin_write" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

-- Chính sách categories: người đã đăng nhập đọc được, chỉ Admin thêm/sửa
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_admin_write" ON public.categories
  FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

-- Chính sách cô lập sổ theo book_id cho 9 bảng nghiệp vụ
DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'meal_prices', 'meal_counts', 'workers', 'attendance',
    'wallets', 'suppliers', 'transactions', 'reminders', 'chat_logs'
  ]
  LOOP
    pol := tbl || '_book_isolation';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_access_book(book_id)) WITH CHECK (public.can_access_book(book_id));',
      pol, tbl
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. NẠP DỮ LIỆU GỐC (SEED DATA) CHO HIỆP HÒA & TIÊN DU + 26 DANH MỤC
-- -----------------------------------------------------------------------------

INSERT INTO public.books (id, ten, dia_diem, chu_so, gio_nhac_hang_ngay, ngay_nhac_truong_chuyen, so_ngay_nhac_no_ncc)
VALUES
  ('hiep_hoa', 'Sổ Hiệp Hòa', 'Hiệp Hòa — Bắc Giang', 'Bố', '18:00', 20, 15),
  ('tien_du',  'Sổ Tiên Du',  'Tiên Du — Bắc Ninh',   'Mẹ', '18:00', 20, 15)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wallets (id, book_id, loai_vi, ten_vi, chu_tai_khoan, so_du_dau_ky, thu_tu)
VALUES
  ('hh_tien_mat',    'hiep_hoa', 'tien_mat',    'Tiền mặt (Bố giữ)',       'Bố — Hiệp Hòa',                                  0, 1),
  ('hh_tk_mo_diep',  'hiep_hoa', 'tk_mo_diep',  'TK Mợ Diệp (Hiệp Hòa)',   'Mợ Diệp — Nhận tiền trường Hiệp Hòa',            0, 2),
  ('hh_tk_chi_nhan', 'hiep_hoa', 'tk_chi_nhan', 'TK Chị Nhàn (Hiệp Hòa)',  'Chị Nhàn — Nhận CK căn tin & vãng lai Hiệp Hòa', 0, 3),
  ('td_tien_mat',    'tien_du',  'tien_mat',    'Tiền mặt (Mẹ giữ)',       'Mẹ — Tiên Du',                                   0, 1),
  ('td_tk_mo_diep',  'tien_du',  'tk_mo_diep',  'TK Mợ Diệp (Tiên Du)',    'Mợ Diệp — Nhận tiền trường Tiên Du',             0, 2),
  ('td_tk_chi_nhan', 'tien_du',  'tk_chi_nhan', 'TK Chị Nhàn (Tiên Du)',   'Chị Nhàn — Nhận CK căn tin & vãng lai Tiên Du',  0, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meal_prices (id, book_id, bua, loai_khach, don_gia, ap_dung_tu_ngay)
VALUES
  ('mp_hh_sang_tr', 'hiep_hoa', 'sang', 'truong',   15000, '2026-01-01'),
  ('mp_hh_sang_vl', 'hiep_hoa', 'sang', 'vang_lai', 20000, '2026-01-01'),
  ('mp_hh_trua_tr', 'hiep_hoa', 'trua', 'truong',   25000, '2026-01-01'),
  ('mp_hh_trua_vl', 'hiep_hoa', 'trua', 'vang_lai', 30000, '2026-01-01'),
  ('mp_hh_toi_tr',  'hiep_hoa', 'toi',  'truong',   25000, '2026-01-01'),
  ('mp_hh_toi_vl',  'hiep_hoa', 'toi',  'vang_lai', 30000, '2026-01-01'),
  ('mp_td_sang_tr', 'tien_du',  'sang', 'truong',   18000, '2026-01-01'),
  ('mp_td_sang_vl', 'tien_du',  'sang', 'vang_lai', 20000, '2026-01-01'),
  ('mp_td_trua_tr', 'tien_du',  'trua', 'truong',   28000, '2026-01-01'),
  ('mp_td_trua_vl', 'tien_du',  'trua', 'vang_lai', 35000, '2026-01-01'),
  ('mp_td_toi_tr',  'tien_du',  'toi',  'truong',   28000, '2026-01-01'),
  ('mp_td_toi_vl',  'tien_du',  'toi',  'vang_lai', 35000, '2026-01-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.categories (id, ten_danh_muc, nhom, kieu_tinh, mang_mac_dinh, icon, tu_khoa_ai, thu_tu)
VALUES
  ('cat_thit',            'Thịt (lợn, bò, gà)',                        'chi',       'theo_ngay',      'bep_an',  '🥩', ARRAY['thịt','lợn','heo','bò','gà','vịt','sườn','xương','mỡ'], 1),
  ('cat_ca_hai_san',      'Cá, tôm, hải sản',                          'chi',       'theo_ngay',      'bep_an',  '🐟', ARRAY['cá','tôm','mực','ngao','cua','chả cá','tép'], 2),
  ('cat_trung_dau_gio',   'Trứng, đậu phụ, giò chả',                   'chi',       'theo_ngay',      'bep_an',  '🥚', ARRAY['trứng','đậu','đậu phụ','giò','chả','xúc xích bếp'], 3),
  ('cat_rau_cu',          'Rau củ quả, hành tỏi',                      'chi',       'theo_ngay',      'bep_an',  '🥬', ARRAY['rau','củ','bí','bầu','khoai','cà chua','hành','tỏi','ớt','nấm'], 4),
  ('cat_gao_bun_pho',     'Gạo, bún, phở, mì nấu',                     'chi',       'theo_ngay',      'bep_an',  '🍚', ARRAY['gạo','bún','phở','miến','bánh đa','bánh mì sáng'], 5),
  ('cat_trang_mieng',     'Hoa quả, sữa chua tráng miệng',             'chi',       'theo_ngay',      'bep_an',  '🍉', ARRAY['chuối','dưa hấu','cam','ổi','sữa chua','tráng miệng'], 6),
  ('cat_do_kho_bep',      'Đồ khô, nguyên liệu phụ bếp',               'chi',       'theo_ngay',      'bep_an',  '🥜', ARRAY['lạc','đỗ','mộc nhĩ','hạt sen','rong biển','bột'], 7),
  ('cat_vat_tu_bep',      'Túi hộp, giấy ăn, đá viên bếp',             'chi',       'theo_ngay',      'bep_an',  '🧊', ARRAY['đá viên','túi bóng','hộp xốp','giấy ăn','găng tay','nước rửa bát'], 8),
  ('cat_nhap_nuoc_ct',    'Nhập nước ngọt, sữa, giải khát',            'chi',       'theo_ngay',      'can_tin', '🥤', ARRAY['nước ngọt','sữa hộp','trà xanh','coca','pepsi','nước lọc','giải khát'], 11),
  ('cat_nhap_banh_keo_ct','Nhập bánh kẹo, bim bim, kem',               'chi',       'theo_ngay',      'can_tin', '🍪', ARRAY['bánh','kẹo','bim bim','snack','kem','hàng căn tin'], 12),
  ('cat_nhap_an_vat_ct',  'Nhập xúc xích, mì hộp, đồ ăn vặt',          'chi',       'theo_ngay',      'can_tin', '🌭', ARRAY['xúc xích','mì tôm','mì hộp','cá viên','xiên que','bánh bao'], 13),
  ('cat_vat_tu_ct',       'Cốc nhựa, ống hút, túi căn tin',            'chi',       'theo_ngay',      'can_tin', '🥤', ARRAY['cốc nhựa','ống hút','thìa nhựa','đá căn tin'], 14),
  ('cat_gia_vi_thang',    'Gia vị, mắm muối, dầu ăn (tháng)',          'chi',       'theo_thang',     'bep_an',  '🫙', ARRAY['gia vị','nước mắm','dầu ăn','muối','mì chính','hạt nêm','xì dầu'], 21),
  ('cat_tien_gas',        'Tiền gas / chất đốt (tháng)',               'chi',       'theo_thang',     'bep_an',  '🔥', ARRAY['gas','bình ga','bình gas','tiền ga','tiền gas','đổi ga','đổi gas','than'], 22),
  ('cat_tien_dien',       'Tiền điện (tháng)',                         'chi',       'theo_thang',     'chung',   '⚡', ARRAY['tiền điện','hóa đơn điện','điện tháng'], 23),
  ('cat_tien_nuoc',       'Tiền nước sạch (tháng)',                    'chi',       'theo_thang',     'chung',   '💧', ARRAY['tiền nước','nước sạch','hóa đơn nước'], 24),
  ('cat_ve_sinh_thang',   'Vệ sinh, rác, kiểm định ATTP',              'chi',       'theo_thang',     'chung',   '🧹', ARRAY['tiền rác','vệ sinh','khử khuẩn','kiểm định','mẫu lưu'], 25),
  ('cat_sua_chua_thang',  'Sửa chữa, mua sắm dụng cụ',                 'chi',       'theo_thang',     'chung',   '🔧', ARRAY['sửa tủ','sửa bếp','mua xoong','mua khay','bảo dưỡng'], 26),
  ('cat_chi_khac_thang',  'Chi phí tháng khác / Nộp trường',           'chi',       'theo_thang',     'chung',   '📋', ARRAY['khấu hao','thuê mặt bằng','hỗ trợ trường'], 27),
  ('cat_thu_cuoi_ngay',   'Tổng thu cuối ngày (Căn tin + Vãng lai)',   'thu',       'theo_ngay',      'can_tin', '💵', ARRAY['căn tin thu','thu cuối ngày','bán hàng hôm nay','tiền quầy'], 31),
  ('cat_thu_khac_bep',    'Thu khác Bếp ăn',                           'thu',       'theo_ngay',      'bep_an',  '🍲', ARRAY['đặt cỗ','liên hoan giáo viên','cơm đặt thêm'], 32),
  ('cat_thu_khac_ct',     'Thu khác Căn tin',                          'thu',       'theo_ngay',      'can_tin', '🏪', ARRAY['thanh lý vỏ lon','bìa carton','chiết khấu đại lý'], 33),
  ('cat_truong_chuyen',   'Nhà trường chuyển tiền ăn',                 'dong_tien', 'khong_tinh_lai', 'bep_an',  '🏫', ARRAY['trường chuyển','trường trả','tiền ăn trường về','mợ diệp nhận'], 41),
  ('cat_tra_luong',       'Trả / ứng lương công nhân',                 'dong_tien', 'khong_tinh_lai', 'bep_an',  '👷', ARRAY['trả lương','ứng lương','lương thợ','lương cô'], 42),
  ('cat_tra_no_ncc',      'Trả nợ nhà cung cấp',                       'dong_tien', 'khong_tinh_lai', 'chung',   '🤝', ARRAY['trả nợ','thanh toán nợ','trả tiền thịt cũ','trả đại lý'], 43),
  ('cat_chuyen_quy',      'Chuyển quỹ / Rút tiền mặt',                 'dong_tien', 'khong_tinh_lai', 'chung',   '🔄', ARRAY['rút tiền','chuyển quỹ','chị nhàn đưa tiền mặt','mợ diệp chuyển'], 44),
  ('cat_dieu_chinh_vi',   'Điều chỉnh kiểm đếm thực tế',               'dong_tien', 'khong_tinh_lai', 'chung',   '⚖️', ARRAY['kiểm tiền','đếm tiền lệch','điều chỉnh ví'], 45)
ON CONFLICT (id) DO UPDATE SET
  ten_danh_muc = EXCLUDED.ten_danh_muc,
  tu_khoa_ai = EXCLUDED.tu_khoa_ai,
  thu_tu = EXCLUDED.thu_tu;

INSERT INTO public.workers (id, book_id, ho_ten, luong_ngay, dang_lam)
VALUES
  ('wk_hh_1', 'hiep_hoa', 'Cô Lan (Phụ bếp)',   250000, true),
  ('wk_hh_2', 'hiep_hoa', 'Chị Hoa (Phụ bếp)',  250000, true),
  ('wk_td_1', 'tien_du',  'Cô Mai (Phụ bếp)',   260000, true),
  ('wk_td_2', 'tien_du',  'Chị Hương (Phụ bếp)',260000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, book_id, ten_ncc, mat_hang_chinh, no_dau_ky, dang_giao_dich)
VALUES
  ('sup_hh_thit', 'hiep_hoa', 'Mối thịt chợ Hiệp Hòa',       'Thịt lợn, xương',            0, true),
  ('sup_hh_gao',  'hiep_hoa', 'Đại lý gạo Hiệp Hòa',         'Gạo tẻ, bún khô',            0, true),
  ('sup_td_thit', 'tien_du',  'Mối thịt chợ Tiên Du',        'Thịt lợn, thịt gà',          0, true),
  ('sup_td_nuoc', 'tien_du',  'Đại lý bánh nước Tiên Du',    'Nước ngọt, sữa, bánh căn tin',0, true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. TỰ ĐỘNG TẠO 3 TÀI KHOẢN VIRTUAL EMAIL + MÃ PIN (BỐ 1111, MẸ 2222, ADMIN 9999)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
  v_uid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('bo',    'bo@sobep.local',    'SoBep#bo#PIN#1111',    'Bố — Hiệp Hòa',  'Bố',    'Sổ Bếp & Căn tin Hiệp Hòa',               'owner', 'hiep_hoa', '👨‍🍳'),
      ('me',    'me@sobep.local',    'SoBep#me#PIN#2222',    'Mẹ — Tiên Du',   'Mẹ',    'Sổ Bếp & Căn tin Tiên Du',                'owner', 'tien_du',  '👩‍🍳'),
      ('admin', 'admin@sobep.local', 'SoBep#admin#PIN#9999', 'Quản lý (Con)',  'Admin', 'Xem cả Hiệp Hòa, Tiên Du & Tổng hợp',    'admin', NULL,       '🛡️')
    ) AS t(profile_id, email, secret, ten_hien_thi, xung_ho, mo_ta, vai_tro, book_id, avatar_emoji)
  LOOP
    SELECT u.id INTO v_uid FROM auth.users u WHERE u.email = rec.email LIMIT 1;

    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token,
        is_sso_user, is_anonymous
      ) VALUES (
        v_uid,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        rec.email,
        extensions.crypt(rec.secret, extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('profile_id', rec.profile_id, 'vai_tro', rec.vai_tro, 'book_id', rec.book_id),
        now(),
        now(),
        '', '', '', '',
        false, false
      );

      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        v_uid,
        jsonb_build_object(
          'sub', v_uid::text,
          'email', rec.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        v_uid::text,
        now(), now(), now()
      );
    END IF;

    INSERT INTO public.profiles (
      id, auth_user_id, ten_hien_thi, xung_ho, mo_ta,
      vai_tro, book_id, virtual_email, avatar_emoji
    ) VALUES (
      rec.profile_id, v_uid, rec.ten_hien_thi, rec.xung_ho, rec.mo_ta,
      rec.vai_tro, rec.book_id, rec.email, rec.avatar_emoji
    )
    ON CONFLICT (id) DO UPDATE SET
      auth_user_id = EXCLUDED.auth_user_id,
      ten_hien_thi = EXCLUDED.ten_hien_thi,
      xung_ho = EXCLUDED.xung_ho,
      mo_ta = EXCLUDED.mo_ta,
      vai_tro = EXCLUDED.vai_tro,
      book_id = EXCLUDED.book_id,
      virtual_email = EXCLUDED.virtual_email,
      avatar_emoji = EXCLUDED.avatar_emoji;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5. BẬT SUPABASE REALTIME HAI CHIỀU TRÊN CÁC BẢNG NGHIỆP VỤ
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'books', 'meal_prices', 'meal_counts', 'workers', 'attendance',
    'wallets', 'suppliers', 'categories', 'transactions', 'reminders', 'chat_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', tbl);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. SQL VIEWS BẢO MẬT (SECURITY_INVOKER = TRUE TUÂN THỦ 100% RLS)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_so_du_vi
WITH (security_invoker = true) AS
SELECT
  w.id AS wallet_id,
  w.book_id,
  w.loai_vi,
  w.ten_vi,
  w.so_du_dau_ky
  + COALESCE((
      SELECT SUM(
        CASE
          WHEN t.loai IN ('thu_cuoi_ngay', 'thu', 'truong_chuyen') AND t.wallet_id = w.id THEN t.so_tien
          WHEN t.loai IN ('chi', 'tra_no', 'tra_luong') AND t.wallet_id = w.id THEN -t.so_tien
          WHEN t.loai = 'chuyen_quy' AND t.wallet_id = w.id THEN -t.so_tien
          WHEN t.loai = 'chuyen_quy' AND t.to_wallet_id = w.id THEN t.so_tien
          WHEN t.loai = 'dieu_chinh_vi' AND t.wallet_id = w.id THEN t.so_tien
          ELSE 0
        END
      )
      FROM public.transactions t
      WHERE t.book_id = w.book_id AND t.da_xoa = false
    ), 0) AS so_du_hien_tai
FROM public.wallets w;

CREATE OR REPLACE VIEW public.v_so_no_ncc
WITH (security_invoker = true) AS
SELECT
  s.id AS supplier_id,
  s.book_id,
  s.ten_ncc,
  s.mat_hang_chinh,
  s.no_dau_ky
  + COALESCE((
      SELECT SUM(
        CASE
          WHEN t.loai = 'chi_no' THEN t.so_tien
          WHEN t.loai = 'tra_no' THEN -t.so_tien
          ELSE 0
        END
      )
      FROM public.transactions t
      WHERE t.supplier_id = s.id AND t.da_xoa = false
    ), 0) AS so_tien_dang_no
FROM public.suppliers s;
