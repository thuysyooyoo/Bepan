import React, { useCallback, useEffect, useState } from 'react';
import {
  MessageSquareText,
  BarChart3,
  Wallet,
  BookMarked,
  LogOut,
  Settings,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import { getTodayISO } from '../domain/format';
import type { BookId, BookSnapshot, Transaction } from '../types/models';
import type { UndoState } from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';
import { SettingsModal } from './SettingsModal';
import { DongTienTab, GhiSoTab, HomNayTab, SoNoTab } from './TabViews';

type TabKey = 'ghi_so' | 'hom_nay' | 'tien' | 'no';

export const AppShell: React.FC = () => {
  const { session, activeBookId, setAdminActiveBook, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('ghi_so');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayISO());
  const [snapshot, setSnapshot] = useState<BookSnapshot | null>(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [activeForm, setActiveForm] = useState<{
    kind: ManualFormKind;
    editTx?: Transaction | null;
  } | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const reloadSnapshot = useCallback(async () => {
    if (!session) return;
    try {
      setError('');
      const data = await dbRepo.getBookSnapshot(session, activeBookId);
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải dữ liệu sổ');
    }
  }, [session, activeBookId]);

  useEffect(() => {
    reloadSnapshot();
    setActiveForm(null);
    setUndoState(null);
  }, [reloadSnapshot]);

  if (!session) return null;

  const isHiepHoa = activeBookId === 'hiep_hoa';
  const headerTheme = isHiepHoa
    ? 'bg-teal-800 text-white border-teal-900'
    : 'bg-amber-800 text-white border-amber-900';

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'ghi_so', label: 'Ghi sổ', icon: <MessageSquareText className="w-7 h-7" /> },
    { key: 'hom_nay', label: 'Hôm nay', icon: <BarChart3 className="w-7 h-7" /> },
    { key: 'tien', label: 'Tiền', icon: <Wallet className="w-7 h-7" /> },
    { key: 'no', label: 'Sổ nợ', icon: <BookMarked className="w-7 h-7" /> },
  ];

  const handleJumpToForm = (kind: ManualFormKind, editTx?: Transaction) => {
    setActiveTab('ghi_so');
    setActiveForm({ kind, editTx: editTx ?? null });
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col max-w-md mx-auto shadow-md">
      {/* Thanh tiêu đề cơ sở rõ ràng, có nút Cài đặt & Thoát */}
      <header className={`px-4 py-3 border-b sticky top-0 z-20 ${headerTheme}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xl font-extrabold truncate">
              {snapshot ? snapshot.book.ten : 'Đang mở sổ...'}
            </div>
            <div className="text-sm opacity-90 truncate">
              {session.avatar_emoji} {session.xung_ho} ·{' '}
              {snapshot ? snapshot.book.dia_diem : ''}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Mở cài đặt"
              className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-base inline-flex items-center gap-1"
            >
              <Settings className="w-5 h-5" />
              Cài đặt
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-base inline-flex items-center gap-1"
            >
              <LogOut className="w-5 h-5" />
              Thoát
            </button>
          </div>
        </div>

        {/* Thanh chuyển nhanh 2 cơ sở dành riêng cho tài khoản Admin */}
        {session.vai_tro === 'admin' && (
          <div className="grid grid-cols-2 gap-2 mt-3 bg-black/20 p-1 rounded-xl">
            {(['hiep_hoa', 'tien_du'] as BookId[]).map((bid) => {
              const selected = activeBookId === bid;
              return (
                <button
                  key={bid}
                  type="button"
                  onClick={() => setAdminActiveBook(bid)}
                  className={`py-2 px-3 rounded-lg font-bold text-base transition ${
                    selected
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-white/85 hover:text-white'
                  }`}
                >
                  {bid === 'hiep_hoa' ? '👨‍🍳 Hiệp Hòa (Bố)' : '👩‍🍳 Tiên Du (Mẹ)'}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Nội dung chính */}
      <main className="flex-1 px-4 py-4 pb-26">
        {error ? (
          <div className="p-4 rounded-2xl bg-red-100 border-2 border-red-500 text-red-900 font-bold text-lg">
            {error}
          </div>
        ) : !snapshot ? (
          <div className="text-center py-12 text-xl text-stone-600 font-semibold">
            Đang tải dữ liệu sổ...
          </div>
        ) : (
          <>
            {activeTab === 'ghi_so' && (
              <GhiSoTab
                snapshot={snapshot}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                activeForm={activeForm}
                onOpenForm={(kind, editTx) =>
                  setActiveForm({ kind, editTx: editTx ?? null })
                }
                onCloseForm={() => setActiveForm(null)}
                undoState={undoState}
                onClearUndo={() => setUndoState(null)}
                onDataChanged={async (undo) => {
                  if (undo) setUndoState(undo);
                  await reloadSnapshot();
                }}
              />
            )}
            {activeTab === 'hom_nay' && (
              <HomNayTab snapshot={snapshot} selectedDate={selectedDate} />
            )}
            {activeTab === 'tien' && <DongTienTab snapshot={snapshot} />}
            {activeTab === 'no' && (
              <SoNoTab
                snapshot={snapshot}
                selectedDate={selectedDate}
                onJumpToForm={handleJumpToForm}
              />
            )}
          </>
        )}
      </main>

      {/* 4 Tab dưới đáy kích thước lớn cho người lớn tuổi */}
      <nav
        aria-label="Thanh điều hướng chính"
        className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t-2 border-stone-300 grid grid-cols-4 z-30"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                setActiveForm(null);
              }}
              className={`py-2.5 px-1 flex flex-col items-center justify-center gap-1 font-bold transition ${
                isActive
                  ? 'text-teal-800 bg-teal-50/80 border-t-4 border-teal-700 -mt-[2px]'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              {tab.icon}
              <span className="text-base leading-none">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Cửa sổ Cài đặt toàn diện */}
      {showSettings && snapshot && (
        <SettingsModal
          snapshot={snapshot}
          onClose={() => setShowSettings(false)}
          onChanged={reloadSnapshot}
        />
      )}
    </div>
  );
};
