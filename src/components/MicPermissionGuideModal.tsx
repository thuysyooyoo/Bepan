import React, { useState } from 'react';
import { CheckCircle2, Lock, Mic, Settings2, ShieldAlert, X } from 'lucide-react';

interface MicPermissionGuideModalProps {
  open: boolean;
  onClose: () => void;
  onRetryMic: () => void;
}

export const MicPermissionGuideModal: React.FC<MicPermissionGuideModalProps> = ({
  open,
  onClose,
  onRetryMic,
}) => {
  const [testingPerm, setTestingPerm] = useState(false);
  const [permStatus, setPermStatus] = useState<'idle' | 'granted' | 'blocked'>('idle');

  if (!open) return null;

  const isSecure = typeof window !== 'undefined' ? window.isSecureContext : true;

  const handleTestBrowserPermission = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      onClose();
      onRetryMic();
      return;
    }

    setTestingPerm(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      setPermStatus('granted');
      setTimeout(() => {
        onClose();
        onRetryMic();
      }, 650);
    } catch {
      setPermStatus('blocked');
    } finally {
      setTestingPerm(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hướng dẫn bật quyền Micro trên Chrome Android"
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white border-3 border-teal-700 p-5 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-12 h-12 rounded-2xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
              <Mic className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-2xl font-extrabold text-stone-950 leading-tight">
                Cách bật Micro trên điện thoại
              </h3>
              <p className="text-base font-semibold text-stone-600">
                Dành cho trình duyệt Chrome trên Android
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hướng dẫn"
            className="w-11 h-11 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 flex items-center justify-center shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {!isSecure && (
          <div className="rounded-2xl bg-rose-50 border-2 border-rose-500 p-4 text-rose-950 space-y-1">
            <div className="font-extrabold text-lg flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-rose-700 shrink-0" />
              Lưu ý kết nối mạng
            </div>
            <p className="text-base font-medium leading-relaxed">
              Điện thoại chỉ cho phép bật Micro khi mở qua đường link có chữ{' '}
              <strong>https://</strong> (như link Demo chính thức) hoặc trên máy tính{' '}
              <strong>localhost</strong>.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {/* Bước 1 */}
          <div className="rounded-2xl bg-stone-50 border-2 border-stone-200 p-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-teal-700 text-white font-black text-xl flex items-center justify-center shrink-0">
              1
            </div>
            <div className="space-y-1 text-lg text-stone-900">
              <div className="font-extrabold">Bấm biểu tượng góc trái thanh địa chỉ</div>
              <div className="text-base text-stone-700 leading-relaxed flex flex-wrap items-center gap-1.5">
                Nhìn lên trên cùng màn hình Chrome, bấm vào hình{' '}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-stone-300 font-bold text-stone-900">
                  <Settings2 className="w-4 h-4" /> 2 thanh trượt
                </span>{' '}
                hoặc{' '}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-stone-300 font-bold text-stone-900">
                  <Lock className="w-4 h-4" /> Ổ khóa
                </span>{' '}
                ngay trước tên trang web.
              </div>
            </div>
          </div>

          {/* Bước 2 */}
          <div className="rounded-2xl bg-stone-50 border-2 border-stone-200 p-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-teal-700 text-white font-black text-xl flex items-center justify-center shrink-0">
              2
            </div>
            <div className="space-y-1 text-lg text-stone-900">
              <div className="font-extrabold">Chọn mục “Quyền” (Permissions)</div>
              <p className="text-base text-stone-700 leading-relaxed">
                Tìm dòng chữ <strong>Micrô (Microphone)</strong> rồi gạt công tắc sang{' '}
                <strong className="text-emerald-800">Bật / Cho phép (Allow)</strong>.
              </p>
            </div>
          </div>

          {/* Bước 3 */}
          <div className="rounded-2xl bg-stone-50 border-2 border-stone-200 p-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-teal-700 text-white font-black text-xl flex items-center justify-center shrink-0">
              3
            </div>
            <div className="space-y-1 text-lg text-stone-900">
              <div className="font-extrabold">Nếu vẫn chưa được (Bị chặn trong máy)</div>
              <p className="text-base text-stone-700 leading-relaxed">
                Mở <strong>Cài đặt điện thoại</strong> → <strong>Ứng dụng</strong> →{' '}
                <strong>Chrome</strong> → <strong>Quyền</strong> → <strong>Micrô</strong> → chọn{' '}
                <strong>Cho phép khi dùng ứng dụng</strong>.
              </p>
            </div>
          </div>
        </div>

        {permStatus === 'granted' && (
          <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-600 p-3.5 text-emerald-950 font-extrabold text-lg flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
            Tuyệt vời! Micro đã được mở quyền, đang bật nghe...
          </div>
        )}

        {permStatus === 'blocked' && (
          <div className="rounded-2xl bg-amber-50 border-2 border-amber-500 p-3.5 text-amber-950 font-bold text-base">
            ⚠️ Điện thoại vẫn đang khóa quyền Micro. Ông/bà làm theo Bước 1 & Bước 2 ở trên rồi bấm
            thử lại nhé!
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            disabled={testingPerm}
            onClick={handleTestBrowserPermission}
            className="min-h-14 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xl px-4 py-3 flex items-center justify-center gap-2"
          >
            <Mic className="w-6 h-6" />
            {testingPerm ? 'Đang kiểm tra...' : 'Thử bật lại Micro'}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-14 rounded-2xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-900 font-bold text-xl px-4 py-3"
          >
            Đã hiểu, Đóng lại
          </button>
        </div>
      </div>
    </div>
  );
};
