import React, { useEffect, useState } from 'react';
import { Delete, ArrowLeft, Lock, BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { PublicProfileSummary } from '../db';
import { ElderlyGuideModal } from './ElderlyGuideModal';

export const LoginScreen: React.FC = () => {
  const { profiles, lastProfileId, login } = useAuth();
  const [selectedProfile, setSelectedProfile] = useState<PublicProfileSummary | null>(null);
  const [hasSwitchedUser, setHasSwitchedUser] = useState(false);
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Tự chọn sẵn người dùng lần trước trên máy điện thoại này để ông bà đỡ bấm 1 bước (chỉ khi chưa bấm Đổi người dùng)
  useEffect(() => {
    if (!hasSwitchedUser && lastProfileId && profiles.length > 0 && !selectedProfile) {
      const found = profiles.find((p) => p.id === lastProfileId);
      if (found) setSelectedProfile(found);
    }
  }, [hasSwitchedUser, lastProfileId, profiles, selectedProfile]);

  const handleDigit = async (digit: string) => {
    if (submitting || !selectedProfile || pin.length >= 4) return;
    setErrorMsg('');
    const nextPin = pin + digit;
    setPin(nextPin);

    if (nextPin.length === 4) {
      setSubmitting(true);
      try {
        await login(selectedProfile.id, nextPin);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Mã PIN chưa đúng');
        setPin('');
      } finally {
        setSubmitting(false);
      }
    }
  };

  const handleBackspace = () => {
    if (submitting) return;
    setErrorMsg('');
    setPin((prev) => prev.slice(0, -1));
  };

  const getCardStyle = (id: string) => {
    if (id === 'bo') {
      return 'border-teal-600 bg-teal-50/70 hover:bg-teal-100/80 text-teal-950';
    }
    if (id === 'me') {
      return 'border-amber-600 bg-amber-50/70 hover:bg-amber-100/80 text-amber-950';
    }
    return 'border-slate-600 bg-slate-50 hover:bg-slate-100 text-slate-900';
  };

  if (!selectedProfile) {
    return (
      <div className="min-h-screen bg-stone-100 flex flex-col justify-between px-4 py-6 max-w-md mx-auto">
        <div>
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-700 text-white shadow-md mb-3">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-stone-900 tracking-tight">
              Sổ Bếp Nhà Mình
            </h1>
            <p className="text-xl text-stone-700 mt-1 font-medium">
              Mời chọn sổ để bắt đầu ạ
            </p>
          </div>

          <div className="space-y-4">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedProfile(p);
                  setPin('');
                  setErrorMsg('');
                }}
                className={`w-full text-left p-5 rounded-2xl border-2 shadow-sm transition active:scale-[0.99] flex items-center gap-4 ${getCardStyle(
                  p.id
                )}`}
              >
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg shadow-xs shrink-0 ${
                    p.id === 'bo'
                      ? 'bg-teal-700 text-white'
                      : p.id === 'me'
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-700 text-white text-sm'
                  }`}
                >
                  {p.id === 'bo' ? 'BỐ' : p.id === 'me' ? 'MẸ' : 'ADMIN'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-2xl font-bold leading-snug">{p.ten_hien_thi}</div>
                  <div className="text-lg opacity-85 mt-0.5">{p.mo_ta}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-stone-50 border-2 border-teal-700 text-teal-900 font-extrabold text-lg flex items-center justify-center gap-2 shadow-sm transition active:scale-[0.99]"
            >
              <BookOpen className="w-6 h-6 text-teal-700" />
              <span>Xem hướng dẫn 1 trang chữ to</span>
            </button>
          </div>
        </div>

        {(import.meta.env.DEV || import.meta.env.VITE_DEMO_HINT === 'true') && (
          <div className="mt-6 rounded-xl bg-stone-200/80 px-4 py-3 text-center text-base text-stone-700">
            Mã PIN bản thử nghiệm: <strong>Bố 1111</strong> · <strong>Mẹ 2222</strong> ·{' '}
            <strong>Admin 9999</strong>
          </div>
        )}

        <ElderlyGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-between px-4 py-5 max-w-md mx-auto">
      <div>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem('sobep_last_profile');
            setHasSwitchedUser(true);
            setSelectedProfile(null);
            setPin('');
            setErrorMsg('');
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-stone-300 text-stone-700 hover:bg-stone-50 font-bold text-sm shadow-xs transition active:scale-95"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Đổi người dùng</span>
        </button>

        <div className="text-center mt-4">
          <div
            className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center font-black text-lg shadow-sm mb-2 ${
              selectedProfile.id === 'bo'
                ? 'bg-teal-700 text-white'
                : selectedProfile.id === 'me'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-700 text-white text-sm'
            }`}
          >
            {selectedProfile.id === 'bo' ? 'BỐ' : selectedProfile.id === 'me' ? 'MẸ' : 'ADMIN'}
          </div>
          <h2 className="text-xl font-black text-stone-900">
            Xin chào {selectedProfile.xung_ho}!
          </h2>
          <p className="text-sm text-stone-600 mt-1 flex items-center justify-center gap-1.5 font-medium">
            <Lock className="w-4 h-4 text-teal-700" />
            Nhập 4 số mã PIN để mở sổ
          </p>

          {/* 4 ô hiển thị dấu chấm mã PIN to rõ */}
          <div className="flex justify-center gap-3.5 my-4" aria-label="Ô nhập mã PIN">
            {[0, 1, 2, 3].map((idx) => {
              const filled = idx < pin.length;
              return (
                <div
                  key={idx}
                  className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                    filled
                      ? 'border-teal-700 bg-teal-700 text-white scale-105 shadow-xs'
                      : 'border-stone-300 bg-white text-stone-400'
                  }`}
                >
                  {filled ? '●' : ''}
                </div>
              );
            })}
          </div>

          {errorMsg ? (
            <div
              role="alert"
              className="mx-auto mb-2 px-3 py-2 rounded-xl bg-red-100 border border-red-500 text-red-900 font-bold text-sm"
            >
              {errorMsg}
            </div>
          ) : (
            <div className="h-4" />
          )}
        </div>
      </div>

      {/* Bàn phím số rõ ràng, êm mắt */}
      <div className="grid grid-cols-3 gap-2.5 pb-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            disabled={submitting}
            onClick={() => handleDigit(d)}
            className="h-14 rounded-2xl bg-white border border-stone-300 shadow-xs text-2xl font-bold text-stone-900 active:bg-teal-50 active:border-teal-600"
          >
            {d}
          </button>
        ))}

        <div className="flex items-center justify-center text-xs font-medium text-stone-500 px-1 text-center">
          Lưu 90 ngày
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={() => handleDigit('0')}
          className="h-14 rounded-2xl bg-white border border-stone-300 shadow-xs text-2xl font-bold text-stone-900 active:bg-teal-50 active:border-teal-600"
        >
          0
        </button>

        <button
          type="button"
          disabled={submitting || pin.length === 0}
          onClick={handleBackspace}
          aria-label="Xóa 1 số"
          className="h-14 rounded-2xl bg-stone-200 border border-stone-300 text-stone-900 font-bold text-base flex items-center justify-center gap-1 active:bg-stone-300 disabled:opacity-40"
        >
          <Delete className="w-5 h-5" />
          Xóa
        </button>
      </div>

      {(import.meta.env.DEV || import.meta.env.VITE_DEMO_HINT === 'true') && (
        <div className="mt-1 text-center text-xs text-stone-500">
          PIN thử: Bố <b>1111</b> · Mẹ <b>2222</b> · Admin <b>9999</b>
        </div>
      )}

      <div className="mt-2 text-center">
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="text-stone-500 hover:text-stone-800 underline text-xs font-medium"
        >
          Xem hướng dẫn dùng Sổ Bếp
        </button>
      </div>

      <ElderlyGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
};
