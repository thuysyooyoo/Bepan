/**
 * Các hàm định dạng tiền tệ, ngày tháng thân thiện với người lớn tuổi
 * và hàm băm mã PIN chuẩn SHA-256 có Salt (Web Crypto API).
 */

export function formatVND(amount: number, showSign = false): string {
  const num = Number(amount || 0);
  const absFormatted = Math.round(Math.abs(num)).toLocaleString('vi-VN');
  if (num < 0) return `-${absFormatted} đ`;
  if (showSign && num > 0) return `+${absFormatted} đ`;
  return `${absFormatted} đ`;
}

export function formatCompactVND(amount: number): string {
  const num = Number(amount || 0);
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    const tr = abs / 1_000_000;
    const formatted = Number.isInteger(tr)
      ? tr.toString()
      : tr.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
    return `${sign}${formatted} triệu`;
  }
  if (abs >= 1_000) {
    const k = Math.round(abs / 1_000);
    return `${sign}${k.toLocaleString('vi-VN')} nghìn`;
  }
  return `${sign}${abs} đ`;
}

export function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDateISO(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Gợi ý mệnh giá thông minh cho ông bà khỏi phải đếm số 0:
 * Ví dụ gõ "450" -> gợi ý [450_000, 4_500_000]; gõ "25" -> [25_000, 250_000, 2_500_000]
 */
export function buildQuickMoneySuggestions(rawInput: string): number[] {
  const digits = String(rawInput || '').replace(/\D/g, '');
  if (!digits) return [];
  const val = Number(digits);
  if (!Number.isFinite(val) || val <= 0) return [];
  if (val >= 10_000) return [];

  const candidates = [val * 1_000, val * 10_000, val * 100_000, val * 1_000_000];
  return Array.from(
    new Set(candidates.filter((n) => n >= 5_000 && n <= 500_000_000))
  ).slice(0, 3);
}

export function getYearMonth(isoDate: string): string {
  return String(isoDate || '').slice(0, 7);
}

export function getPreviousYearMonth(kyThang: string): string {
  const [yStr, mStr] = kyThang.split('-');
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m <= 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function formatVietnameseDate(isoDate: string): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const days = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const thu = days[dateObj.getDay()];
  return `${thu}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const normalizedPin = String(pin || '').trim();
  const payload = `${salt}:${normalizedPin}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateId(): string {
  if (globalThis.crypto && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
