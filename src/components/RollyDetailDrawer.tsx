import React from 'react';
import { X } from 'lucide-react';

interface RollyDetailDrawerProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const RollyDetailDrawer: React.FC<RollyDetailDrawerProps> = ({
  title,
  isOpen,
  onClose,
  children,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end max-w-md mx-auto"
    >
      <div className="bg-stone-100 rounded-t-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border-t-2 border-stone-300">
        {/* Thanh Header Drawer */}
        <div className="px-4 py-3 bg-white border-b border-stone-200 flex items-center justify-between shrink-0">
          <div className="text-xl font-black text-stone-900 truncate">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ xem chi tiết"
            className="w-10 h-10 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold flex items-center justify-center text-xl transition active:scale-95"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Nội dung chi tiết cuộn dọc an toàn 1 cột */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
};
