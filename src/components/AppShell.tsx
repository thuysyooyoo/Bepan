import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BellRing,
  BookMarked,
  CloudOff,
  Crown,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Settings,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo, type OfflineQueueStatus } from '../db';
import { getTodayISO, getYearMonth } from '../domain/format';
import { evaluateActiveReminders, type ActiveReminderCard } from '../domain/reminders';
import type { BookId, BookSnapshot, Transaction } from '../types/models';
import { AdminDashboardView } from './AdminDashboardView';
import type { UndoState } from './ConfirmationCard';
import type { ManualFormKind } from './ManualEntryForms';
import { PwaInstallBanner } from './PwaInstallBanner';
import { SettingsModal } from './SettingsModal';
import { DongTienTab, GhiSoTab, HomNayTab, SoNoTab } from './TabViews';

type TabKey = 'ghi_so' | 'hom_nay' | 'tien' | 'no';
type AdminViewMode = 'facility' | 'tong_hop';

const ADMIN_VIEW_MODE_KEY = 'sobep_admin_view_mode_v1';

export const AppShell: React.FC = () => {
  const { session, activeBookId, cloudStatus, setAdminActiveBook, logout } = useAuth();
  const [adminViewMode, setAdminViewMode] = useState<AdminViewMode>(() => {
    try {
      return localStorage.getItem(ADMIN_VIEW_MODE_KEY) === 'tong_hop'
        ? 'tong_hop'
        : 'facility';
    } catch {
      return 'facility';
    }
  });
  const [activeTab, setActiveTab] = useState<TabKey>('ghi_so');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayISO());
  const [snapshot, setSnapshot] = useState<BookSnapshot | null>(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [activeForm, setActiveForm] = useState<{
    kind: ManualFormKind;
    editTx?: Transaction | null;
  } | null>(null);
  const [focusedSupplierId, setFocusedSupplierId] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [offlineStatus, setOfflineStatus] = useState<OfflineQueueStatus | null>(null);

  const isAdminCombinedMode =
    session?.vai_tro === 'admin' && adminViewMode === 'tong_hop';

  const switchAdminMode = (nextMode: AdminViewMode) => {
    setAdminViewMode(nextMode);
    try {
      localStorage.setItem(ADMIN_VIEW_MODE_KEY, nextMode);
    } catch {
      // Ignore storage error
    }
  };

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
    void reloadSnapshot();
  }, [reloadSnapshot]);

  // Theo dõi trạng thái mạng & hàng đợi Offline
  useEffect(() => {
    if (!dbRepo.subscribeToOfflineStatus) return;
    const unsub = dbRepo.subscribeToOfflineStatus((st) => {
      setOfflineStatus(st);
    });
    return unsub;
  }, []);

  // Đồng bộ Realtime 2 chiều (Supabase postgres_changes + visibilitychange)
  useEffect(() => {
    if (!session || !dbRepo.subscribeToBookChanges) return;
    const unsubscribe = dbRepo.subscribeToBookChanges(activeBookId, () => {
      void reloadSnapshot();
    });
    return unsubscribe;
  }, [session, activeBookId, cloudStatus?.mode, reloadSnapshot]);

  const activeReminders = useMemo(
    () => (snapshot ? evaluateActiveReminders(snapshot) : []),
    [snapshot]
  );

  const overdueDebtCount = useMemo(
    () => activeReminders.filter((r) => r.loai_nhac === 'no_qua_han').length,
    [activeReminders]
  );

  const clearFocusedSupplier = useCallback(() => {
    setFocusedSupplierId(null);
  }, []);

  if (!session) return null;

  const isHiepHoa = activeBookId === 'hiep_hoa';
  const headerTheme = isAdminCombinedMode
    ? 'bg-indigo-950 text-white border-indigo-900'
    : isHiepHoa
    ? 'bg-teal-800 text-white border-teal-900'
    : 'bg-amber-800 text-white border-amber-900';

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      key: 'ghi_so',
      label: 'Ghi sổ',
      icon: <MessageSquareText className="w-7 h-7" />,
      badge: activeReminders.length,
    },
    { key: 'hom_nay', label: 'Hôm nay', icon: <BarChart3 className="w-7 h-7" /> },
    { key: 'tien', label: 'Tiền', icon: <Wallet className="w-7 h-7" /> },
    {
      key: 'no',
      label: 'Sổ nợ',
      icon: <BookMarked className="w-7 h-7" />,
      badge: overdueDebtCount,
    },
  ];

  const handleJumpToForm = (kind: ManualFormKind, editTx?: Transaction) => {
    setActiveTab('ghi_so');
    setActiveForm({ kind, editTx: editTx ?? null });
  };

  const handleJumpToSupplierDebt = (supplierId?: string) => {
    setActiveForm(null);
    setFocusedSupplierId(supplierId ?? null);
    setActiveTab('no');
  };

  const handleAdminSwitchFacility = (bookId: BookId, targetDate?: string) => {
    setAdminActiveBook(bookId);
    switchAdminMode('facility');
    setActiveForm(null);
    setFocusedSupplierId(null);
    setUndoState(null);
    if (targetDate) {
      setSelectedDate(targetDate);
      setActiveTab('ghi_so');
    }
  };

  const handleAdminActOnReminder = (
    bookId: BookId,
    target: ActiveReminderCard['action_target']
  ) => {
    setAdminActiveBook(bookId);
    switchAdminMode('facility');
    setUndoState(null);
    if (target.type === 'form') {
      setFocusedSupplierId(null);
      setActiveTab('ghi_so');
      setActiveForm({ kind: target.kind, editTx: null });
    } else {
      setActiveForm(null);
      setFocusedSupplierId(target.supplierId ?? null);
      setActiveTab('no');
    }
  };

  const handleManualFlushOffline = async () => {
    if (!dbRepo.flushOfflineOutbox) return;
    await dbRepo.flushOfflineOutbox(session);
    await reloadSnapshot();
  };

  const showOfflineBanner =
    offlineStatus && (!offlineStatus.isOnline || offlineStatus.pendingCount > 0);

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col max-w-md mx-auto shadow-md">
      {/* Thanh tiêu đề cơ sở rõ ràng, có chuông nhắc việc, nút Cài đặt & Thoát */}
      <header className={`px-4 py-3 border-b sticky top-0 z-20 ${headerTheme}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xl font-extrabold truncate">
              {isAdminCombinedMode
                ? '👑 Tổng hợp 2 cơ sở'
                : snapshot
                ? snapshot.book.ten
                : 'Đang mở sổ...'}
            </div>
            <div className="text-sm opacity-90 truncate">
              {session.avatar_emoji} {session.xung_ho} ·{' '}
              {offlineStatus && !offlineStatus.isOnline
                ? '📡 Đang ngoại tuyến'
                : cloudStatus?.connected
                ? '☁️ Đám mây'
                : '📱 Lưu máy'}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isAdminCombinedMode && activeReminders.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveForm(null);
                  setActiveTab('ghi_so');
                }}
                aria-label={`Có ${activeReminders.length} nhắc việc`}
                title="Xem nhắc việc"
                className="px-2.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-extrabold text-sm inline-flex items-center gap-1 shadow-xs"
              >
                <BellRing className="w-4 h-4" />
                <span>{activeReminders.length}</span>
              </button>
            )}

            {!isAdminCombinedMode && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                aria-label="Mở cài đặt"
                className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-base inline-flex items-center gap-1"
              >
                <Settings className="w-5 h-5" />
                Cài đặt
              </button>
            )}
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

        {/* Thanh chuyển nhanh 3 chế độ dành riêng cho tài khoản Admin */}
        {session.vai_tro === 'admin' && (
          <div className="grid grid-cols-3 gap-1.5 mt-3 bg-black/25 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => switchAdminMode('tong_hop')}
              className={`py-2 px-2 rounded-lg font-extrabold text-sm transition inline-flex items-center justify-center gap-1 ${
                isAdminCombinedMode
                  ? 'bg-amber-300 text-stone-950 shadow-xs'
                  : 'text-white/85 hover:text-white'
              }`}
            >
              <Crown className="w-4 h-4 shrink-0" />
              <span>Tổng hợp</span>
            </button>

            {(['hiep_hoa', 'tien_du'] as BookId[]).map((bid) => {
              const selected = !isAdminCombinedMode && activeBookId === bid;
              return (
                <button
                  key={bid}
                  type="button"
                  onClick={() => handleAdminSwitchFacility(bid)}
                  className={`py-2 px-2 rounded-lg font-extrabold text-sm transition ${
                    selected
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-white/85 hover:text-white'
                  }`}
                >
                  {bid === 'hiep_hoa' ? '👨‍🍳 Hiệp Hòa' : '👩‍🍳 Tiên Du'}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Thanh báo trạng thái Offline / Hàng đợi chờ đẩy lên Đám mây */}
      {showOfflineBanner && offlineStatus && (
        <div
          className={`px-4 py-2.5 border-b text-sm font-bold flex items-center justify-between gap-2 ${
            !offlineStatus.isOnline
              ? 'bg-amber-100 border-amber-400 text-amber-950'
              : 'bg-sky-100 border-sky-400 text-sky-950'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {!offlineStatus.isOnline ? (
              <CloudOff className="w-5 h-5 text-amber-800 shrink-0" />
            ) : (
              <RefreshCw
                className={`w-5 h-5 text-sky-800 shrink-0 ${
                  offlineStatus.isSyncing ? 'animate-spin' : ''
                }`}
              />
            )}
            <span className="leading-snug">
              {!offlineStatus.isOnline
                ? offlineStatus.pendingCount > 0
                  ? `Đang mất mạng — đã lưu tạm ${offlineStatus.pendingCount} mục trên máy, có mạng sẽ tự đẩy lên!`
                  : 'Đang mất mạng — ông/bà vẫn ghi sổ bình thường trên máy!'
                : offlineStatus.isSyncing
                ? `Đang đẩy ${offlineStatus.pendingCount} mục lưu tạm lên Đám mây...`
                : `Còn ${offlineStatus.pendingCount} mục lưu tạm chờ đồng bộ Đám mây`}
            </span>
          </div>

          {offlineStatus.isOnline &&
            offlineStatus.pendingCount > 0 &&
            !offlineStatus.isSyncing && (
              <button
                type="button"
                onClick={() => void handleManualFlushOffline()}
                className="px-2.5 py-1.5 rounded-xl bg-sky-800 text-white text-xs font-extrabold shrink-0"
              >
                Đồng bộ
              </button>
            )}
        </div>
      )}

      {/* Nội dung chính */}
      <main
        className={`flex-1 px-4 py-4 ${isAdminCombinedMode ? 'pb-8' : 'pb-26'}`}
      >
        <PwaInstallBanner />

        {isAdminCombinedMode ? (
          <AdminDashboardView
            initialMonth={getYearMonth(selectedDate)}
            onOpenFacilityBook={handleAdminSwitchFacility}
            onActOnFacilityReminder={handleAdminActOnReminder}
          />
        ) : error ? (
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
                activeReminders={activeReminders}
                activeForm={activeForm}
                onOpenForm={(kind, editTx) =>
                  setActiveForm({ kind, editTx: editTx ?? null })
                }
                onCloseForm={() => setActiveForm(null)}
                onJumpToSupplierDebt={handleJumpToSupplierDebt}
                undoState={undoState}
                onClearUndo={() => setUndoState(null)}
                onDataChanged={async (undo) => {
                  if (undo) setUndoState(undo);
                  await reloadSnapshot();
                }}
              />
            )}
            {activeTab === 'hom_nay' && (
              <HomNayTab
                snapshot={snapshot}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onJumpToForm={handleJumpToForm}
              />
            )}
            {activeTab === 'tien' && (
              <DongTienTab
                snapshot={snapshot}
                selectedDate={selectedDate}
                onDataChanged={reloadSnapshot}
              />
            )}
            {activeTab === 'no' && (
              <SoNoTab
                snapshot={snapshot}
                selectedDate={selectedDate}
                focusedSupplierId={focusedSupplierId}
                onClearFocusSupplier={clearFocusedSupplier}
                onDataChanged={reloadSnapshot}
              />
            )}
          </>
        )}
      </main>

      {/* 4 Tab dưới đáy kích thước lớn cho người lớn tuổi (ẩn khi Admin đang xem bảng Tổng hợp 2 cơ sở) */}
      {!isAdminCombinedMode && (
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
                className={`relative py-2.5 px-1 flex flex-col items-center justify-center gap-1 font-bold transition ${
                  isActive
                    ? 'text-teal-800 bg-teal-50/80 border-t-4 border-teal-700 -mt-[2px]'
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                <div className="relative">
                  {tab.icon}
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white text-xs font-extrabold flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className="text-base leading-none">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}

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
