import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'sobep_pwa_banner_dismissed_at_v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const iosStandalone = Boolean(
    (window.navigator as unknown as { standalone?: boolean }).standalone
  );
  return Boolean(mediaStandalone || iosStandalone);
}

function isIosSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isWebkit;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < SEVEN_DAYS_MS;
  } catch {
    return false;
  }
}

export const PwaInstallBanner: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => wasRecentlyDismissed());
  const [installed, setInstalled] = useState<boolean>(() => isStandaloneMode());

  useEffect(() => {
    if (isStandaloneMode()) {
      setInstalled(true);
      return;
    }

    if (isIosSafariBrowser()) {
      setShowIosGuide(true);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  if (!deferredPrompt && !showIosGuide) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore storage error
    }
    setDismissed(true);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="rounded-3xl bg-teal-50 border-2 border-teal-600 p-3.5 shadow-xs space-y-2.5 mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-teal-800 text-amber-300 flex items-center justify-center shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-extrabold text-teal-950 leading-snug">
              Đặt &ldquo;Sổ Bếp&rdquo; ra màn hình chính
            </div>
            <div className="text-base text-stone-700 leading-snug mt-0.5">
              Bấm mở ngay như ứng dụng thật, chữ to toàn màn hình &amp; dùng được cả khi mất mạng!
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Đóng gợi ý cài ứng dụng"
          className="p-1.5 rounded-xl text-stone-500 hover:bg-teal-100 hover:text-stone-900 shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {deferredPrompt ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleInstallClick}
            className="flex-1 min-h-[50px] px-4 py-2.5 rounded-2xl bg-teal-800 hover:bg-teal-900 text-white font-extrabold text-base inline-flex items-center justify-center gap-2 shadow-xs active:scale-[0.99]"
          >
            <Download className="w-5 h-5 shrink-0" />
            <span>Thêm vào màn hình chính</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="min-h-[50px] px-3.5 py-2.5 rounded-2xl bg-white border border-stone-300 text-stone-700 font-bold text-base"
          >
            Để sau
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-teal-200 p-3 text-base text-stone-800 space-y-1">
          <div className="font-bold text-teal-950 flex items-center gap-1.5">
            <Share className="w-4 h-4 text-teal-700 shrink-0" />
            <span>Trên iPhone / iPad làm 2 chạm:</span>
          </div>
          <div>
            1. Bấm nút <strong>Chia sẻ (ô vuông có mũi tên lên )</strong> ở thanh dưới cùng.
          </div>
          <div>
            2. Chọn <strong>&ldquo;Thêm vào MH chính&rdquo; (Add to Home Screen)</strong>.
          </div>
        </div>
      )}
    </div>
  );
};
