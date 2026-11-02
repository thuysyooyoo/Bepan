-- ============================================================================
-- 003_ai_settings.sql: Bảng lưu cấu hình AI (Gemini, DeepSeek, OpenAI...)
-- Cho phép Admin đổi API key, model hoặc endpoint trực tiếp từ Web UI
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'gemini', -- 'gemini' | 'deepseek' | 'openai' | 'local'
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  endpoint TEXT NOT NULL DEFAULT '',
  temperature NUMERIC NOT NULL DEFAULT 0.1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT DEFAULT 'admin'
);

-- Bật Row Level Security (RLS)
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

-- Mọi người dùng đã đăng nhập hoặc anon đều có thể đọc cấu hình (để Bố Mẹ gọi AI)
DROP POLICY IF EXISTS "Cho phép đọc cấu hình AI" ON public.ai_settings;
CREATE POLICY "Cho phép đọc cấu hình AI"
  ON public.ai_settings FOR SELECT
  USING (true);

-- Cho phép ghi cấu hình AI (Admin đổi key / model)
DROP POLICY IF EXISTS "Cho phép ghi cấu hình AI" ON public.ai_settings;
CREATE POLICY "Cho phép ghi cấu hình AI"
  ON public.ai_settings FOR ALL
  USING (true)
  WITH CHECK (true);

-- Nạp cấu hình mặc định ban đầu nếu bảng còn trống (Mặc định DeepSeek siêu nhanh và rẻ)
INSERT INTO public.ai_settings (id, provider, api_key, model, endpoint, temperature, enabled)
VALUES ('default', 'deepseek', '', 'deepseek-chat', 'https://api.deepseek.com/chat/completions', 0.1, true)
ON CONFLICT (id) DO NOTHING;
