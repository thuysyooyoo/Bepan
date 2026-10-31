import React from 'react';
import { CheckCircle2, Mic, Printer, X } from 'lucide-react';

export interface ElderlyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ElderlyGuideModal: React.FC<ElderlyGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-center overflow-y-auto p-2 sm:p-4">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl flex flex-col my-auto border-4 border-teal-700 overflow-hidden">
        {/* Header thân thiện */}
        <div className="bg-teal-800 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-10 print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-3xl">📖</span>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">
                Hướng Dẫn Dùng Sổ Bếp
              </h2>
              <p className="text-base text-teal-100 font-medium">
                Dành cho Bố &amp; Mẹ (1 trang chữ to)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-2xl bg-white/15 hover:bg-white/25 text-white font-bold"
            aria-label="Đóng"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Nội dung 4 thói quen hằng ngày */}
        <div className="p-5 sm:p-6 space-y-5 text-stone-900 flex-1 overflow-y-auto">
          {/* Lời mở đầu ấm áp */}
          <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 flex items-center gap-3">
            <span className="text-4xl shrink-0">🍲</span>
            <div className="text-lg font-bold leading-snug">
              Bố mẹ chỉ cần chạm ngón tay nói bình thường, máy tự tính tiền và chia sổ chuẩn từng đồng ạ!
            </div>
          </div>

          {/* BƯỚC 1: MỞ SỔ */}
          <div className="p-4 rounded-2xl bg-stone-50 border-2 border-stone-300 space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-teal-800 text-white font-extrabold text-xl flex items-center justify-center shrink-0">
                1
              </span>
              <h3 className="text-xl font-extrabold text-teal-950">
                🔓 Mở sổ bằng 4 số PIN
              </h3>
            </div>
            <div className="text-lg text-stone-800 space-y-1.5 pl-11">
              <p>
                • Bố bấm vào hình <strong>👨‍🍳 Bố</strong> rồi bấm <strong>1 1 1 1</strong>.
              </p>
              <p>
                • Mẹ bấm vào hình <strong>👩‍🍳 Mẹ</strong> rồi bấm <strong>2 2 2 2</strong>.
              </p>
              <p className="text-base text-stone-600 italic">
                👉 Điện thoại tự nhớ 3 tháng mới phải bấm lại một lần!
              </p>
            </div>
          </div>

          {/* BƯỚC 2: GHI SỔ BẰNG GIỌNG NÓI */}
          <div className="p-4 rounded-2xl bg-teal-50 border-2 border-teal-500 space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-teal-800 text-white font-extrabold text-xl flex items-center justify-center shrink-0">
                2
              </span>
              <h3 className="text-xl font-extrabold text-teal-950">
                🎙️ Ghi sổ bằng giọng nói
              </h3>
            </div>
            <div className="text-lg text-stone-800 space-y-2 pl-11">
              <div className="flex items-center gap-2 font-bold text-teal-900">
                <span className="p-2 rounded-xl bg-teal-700 text-white shrink-0">
                  <Mic className="w-5 h-5" />
                </span>
                <span>Chạm vào nút Micro tròn to màu xanh ở giữa</span>
              </div>
              <p>Nói tự nhiên như bình thường, ví dụ:</p>
              <div className="p-3 rounded-xl bg-white border border-teal-300 font-bold text-stone-900 italic text-base leading-relaxed">
                &ldquo;Trưa nay 210 suất trường, mua thịt chị Hoa 1 triệu 2 ghi nợ&rdquo;
              </div>
              <p>
                Máy sẽ đọc to lại để bố mẹ nghe. Thấy đúng thì bấm nút xanh{' '}
                <strong className="text-emerald-800">Lưu vào sổ</strong>. Nếu lỡ nói nhầm thì bấm{' '}
                <strong className="text-rose-800">Hoàn tác</strong> là xong!
              </p>
            </div>
          </div>

          {/* BƯỚC 3: CHIỀU TỐI CHỐT QUẦY */}
          <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-amber-700 text-white font-extrabold text-xl flex items-center justify-center shrink-0">
                3
              </span>
              <h3 className="text-xl font-extrabold text-amber-950">
                🌙 Chiều tối chốt quầy (Cách A)
              </h3>
            </div>
            <div className="text-lg text-stone-800 space-y-1.5 pl-11">
              <p>
                Cuối ngày, đếm tiền mặt trong két và xem tin nhắn chuyển khoản TK Chị Nhàn.
              </p>
              <p>
                Bố mẹ chỉ cần bấm nút <strong>Thu cuối ngày</strong> (hoặc nói với máy):
              </p>
              <div className="p-3 rounded-xl bg-white border border-amber-300 font-bold text-stone-900 italic text-base">
                &ldquo;Căn tin hôm nay tiền mặt 2 triệu, chuyển khoản 800 nghìn&rdquo;
              </div>
              <p className="text-base text-amber-900 font-semibold">
                👉 Máy sẽ <strong>tự động trừ phần tiền cơm vãng lai</strong> để ghi vào Bếp, còn lại ghi đúng vào Căn tin. Bố mẹ không cần tính nhẩm!
              </p>
            </div>
          </div>

          {/* BƯỚC 4: XEM TIỀN & SỔ NỢ */}
          <div className="p-4 rounded-2xl bg-indigo-50 border-2 border-indigo-400 space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-indigo-800 text-white font-extrabold text-xl flex items-center justify-center shrink-0">
                4
              </span>
              <h3 className="text-xl font-extrabold text-indigo-950">
                📊 Xem Tiền &amp; Sổ nợ ở 4 nút dưới đáy
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2 pl-11 text-base font-bold">
              <div className="p-2.5 rounded-xl bg-white border border-stone-300">
                💬 <strong>Ghi sổ</strong>: Bấm mic nói
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-stone-300">
                📊 <strong>Hôm nay</strong>: Xem lãi ngày
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-stone-300">
                💰 <strong>Tiền</strong>: Xem 3 ví
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-stone-300">
                📕 <strong>Sổ nợ</strong>: Xem nợ mối hàng
              </div>
            </div>
          </div>
        </div>

        {/* Footer có nút In A4 và nút Đã hiểu */}
        <div className="p-4 bg-stone-100 border-t border-stone-200 flex items-center justify-between gap-3 print:hidden">
          <button
            type="button"
            onClick={handlePrint}
            className="min-h-[48px] px-4 py-2.5 rounded-2xl bg-stone-200 hover:bg-stone-300 text-stone-900 font-extrabold text-base inline-flex items-center gap-2"
          >
            <Printer className="w-5 h-5 text-stone-700" />
            <span>🖨️ In ra giấy A4 dán ở bếp</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] px-5 py-2.5 rounded-2xl bg-teal-800 hover:bg-teal-900 text-white font-extrabold text-lg inline-flex items-center justify-center gap-2 shadow-sm"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>Đã hiểu, vào Sổ ngay!</span>
          </button>
        </div>
      </div>
    </div>
  );
};
