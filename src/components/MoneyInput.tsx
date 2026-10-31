import React from 'react';
import { X } from 'lucide-react';
import { buildQuickMoneySuggestions, formatCompactVND, formatVND } from '../domain/format';

interface MoneyInputProps {
  label: string;
  value: number;
  onChange: (nextAmount: number) => void;
  placeholder?: string;
  helperText?: string;
}

export const MoneyInput: React.FC<MoneyInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Ví dụ: 450000 hoặc bấm gợi ý bên dưới',
  helperText,
}) => {
  const displayStr = value > 0 ? Math.round(value).toLocaleString('vi-VN') : '';
  const rawDigits = value > 0 ? String(Math.round(value)) : '';
  const suggestions = buildQuickMoneySuggestions(rawDigits);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    if (!digitsOnly) {
      onChange(0);
      return;
    }
    const parsed = Number(digitsOnly);
    if (Number.isFinite(parsed) && parsed <= 9_000_000_000) {
      onChange(parsed);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-lg font-extrabold text-stone-900">{label}</label>
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="numeric"
          value={displayStr}
          onChange={handleTextChange}
          placeholder={placeholder}
          className="w-full rounded-2xl border-2 border-stone-400 focus:border-teal-700 bg-white px-4 py-3.5 pr-20 text-2xl font-extrabold text-stone-950 outline-none"
        />
        <div className="absolute right-3 flex items-center gap-1.5">
          {value > 0 && (
            <button
              type="button"
              onClick={() => onChange(0)}
              aria-label="Xóa số tiền"
              className="p-1.5 rounded-full bg-stone-200 text-stone-700 hover:bg-stone-300"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <span className="text-lg font-bold text-stone-500">đ</span>
        </div>
      </div>

      {value > 0 && (
        <div className="text-base font-bold text-teal-800">
          Đọc là: {formatCompactVND(value)} ({formatVND(value)})
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          {suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => onChange(sug)}
              className="px-3.5 py-2 rounded-xl bg-teal-50 border-2 border-teal-600 text-teal-950 font-extrabold text-base active:bg-teal-200"
            >
              + Chọn {formatVND(sug)}
            </button>
          ))}
        </div>
      )}

      {helperText && <div className="text-base text-stone-600">{helperText}</div>}
    </div>
  );
};
