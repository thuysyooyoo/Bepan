/**
 * Đăng ký Service Worker PWA cho "Sổ Bếp Nhà Mình" để mở app tức thì cả khi mất mạng ở bếp/chợ.
 * Chỉ kích hoạt ở môi trường production HTTPS/localhost, bỏ qua trong môi trường dev HMR hoặc Vitest.
 */
export function registerSoBepServiceWorker(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Bỏ qua êm nếu trình duyệt chặn SW ở chế độ ẩn danh
    });
  });
}
