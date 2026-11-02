import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BellRing,
  BookMarked,
  CloudOff,
  Crown,
  HelpCircle,
  LogOut,
  MessageSquareText,
  MoreVertical,
  RefreshCw,
  Settings,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo, type OfflineQueueStatus } from '../db';
import { getTodayISO, getYearMonth } from '../domain/format';
import { evaluateActiveReminders, type ActiveReminderCard } from '../domain/reminders';
import { runWeeklyAutoSnapshotIfDue } from '../domain/weeklyBackup';
import type { BookId, BookSnapshot, Transaction } from '../types/models';
import { AdminDashboardView } from './AdminDashboardView';
import { UndoBanner, type UndoState } from './ConfirmationCard';
import { ChatAssistantBox } from './ChatAssistantBox';
import { ElderlyGuideModal } from './ElderlyGuideModal';
import { ManualEntryForms, type ManualFormKind } from './ManualEntryForms';
import { PwaInstallBanner } from './PwaInstallBanner';
import { RollyDetailDrawer } from './RollyDetailDrawer';
import { RollyOverviewBanner } from './RollyOverviewBanner';
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
  const [showGuide, setShowGuide] = useState(false);
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [detailDrawer, setDetailDrawer] = useState<'profit' | 'wallets' | 'debts' | null>(null);
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

  // Tự động kiểm tra và chụp ảnh sao lưu tuần nếu đã quá 7 ngày
  useEffect(() => {
    if (!session) return;
    void runWeeklyAutoSnapshotIfDue(dbRepo, session);
  }, [session]);

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
    <div className="h-[100dvh] bg-stone-100 flex flex-col max-w-md mx-auto shadow-md overflow-hidden">
      {/* Thanh tiêu đề cơ sở rõ ràng, có nút Đổi người & Menu tùy chọn */}
      <header className={`px-3.5 py-2.5 border-b shrink-0 z-20 ${headerTheme}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-extrabold truncate">
              {isAdminCombinedMode
                ? 'Tổng hợp 2 cơ sở'
                : snapshot
                ? snapshot.book.ten
                : 'Đang mở sổ...'}
            </div>
            <div className="text-xs opacity-90 truncate">
              {session.xung_ho} ·{' '}
              {offlineStatus && !offlineStatus.isOnline
                ? 'Ngoại tuyến'
                : cloudStatus?.connected
                ? 'Đám mây'
                : 'Lưu máy'}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Nút Đổi người dùng 1 chạm trực tiếp trên header: Không bao giờ bị kẹt */}
            <button
              type="button"
              onClick={logout}
              title="Đổi người dùng (Bố / Mẹ / Admin)"
              aria-label="Đổi người dùng"
              className="px-2.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs flex items-center gap-1 transition active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đổi người</span>
            </button>

            {/* Duy nhất 1 nút menu 3 chấm tinh gọn chống tràn màn hình (kiểu Rolly) */}
            <button
              type="button"
              onClick={() => setShowMainMenu(true)}
              aria-label="Mở menu tùy chọn"
              className="relative w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center font-black transition active:scale-95 shrink-0"
            >
              <MoreVertical className="w-5 h-5" />
              {activeReminders.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-4 px-1 rounded-full bg-amber-400 text-stone-950 text-[10px] font-black flex items-center justify-center">
                  {activeReminders.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Thanh chuyển nhanh 3 chế độ dành riêng cho tài khoản Admin */}
        {session.vai_tro === 'admin' && (
          <div className="grid grid-cols-3 gap-1.5 mt-2 bg-black/25 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => switchAdminMode('tong_hop')}
              className={`py-1.5 px-2 rounded-lg font-bold text-xs transition inline-flex items-center justify-center gap-1 ${
                isAdminCombinedMode
                  ? 'bg-amber-300 text-stone-950 shadow-xs'
                  : 'text-white/85 hover:text-white'
              }`}
            >
              <Crown className="w-3.5 h-3.5 shrink-0" />
              <span>Tổng hợp</span>
            </button>

            {(['hiep_hoa', 'tien_du'] as BookId[]).map((bid) => {
              const selected = !isAdminCombinedMode && activeBookId === bid;
              return (
                <button
                  key={bid}
                  type="button"
                  onClick={() => handleAdminSwitchFacility(bid)}
                  className={`py-1.5 px-2 rounded-lg font-bold text-xs transition ${
                    selected
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-white/85 hover:text-white'
                  }`}
                >
                  {bid === 'hiep_hoa' ? 'Hiệp Hòa' : 'Tiên Du'}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Thanh báo trạng thái Offline / Hàng đợi chờ đẩy lên Đám mây */}
      {showOfflineBanner && offlineStatus && (
        <div
          className={`px-3 py-2 border-b text-xs font-bold shrink-0 flex items-center justify-between gap-2 ${
            !offlineStatus.isOnline
              ? 'bg-amber-100 border-amber-400 text-amber-950'
              : 'bg-sky-100 border-sky-400 text-sky-950'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {!offlineStatus.isOnline ? (
              <CloudOff className="w-4 h-4 text-amber-800 shrink-0" />
            ) : (
              <RefreshCw
                className={`w-4 h-4 text-sky-800 shrink-0 ${
                  offlineStatus.isSyncing ? 'animate-spin' : ''
                }`}
              />
            )}
            <span className="leading-snug truncate">
              {!offlineStatus.isOnline
                ? offlineStatus.pendingCount > 0
                  ? `Đang ngoại tuyến — đã lưu tạm ${offlineStatus.pendingCount} mục trên máy`
                  : 'Đang ngoại tuyến — vẫn ghi sổ bình thường trên máy'
                : offlineStatus.isSyncing
                ? `Đang đồng bộ ${offlineStatus.pendingCount} mục lên Đám mây...`
                : `Còn ${offlineStatus.pendingCount} mục chờ đồng bộ Đám mây`}
            </span>
          </div>

          {offlineStatus.isOnline &&
            offlineStatus.pendingCount > 0 &&
            !offlineStatus.isSyncing && (
              <button
                type="button"
                onClick={() => void handleManualFlushOffline()}
                className="px-2 py-1 rounded-lg bg-sky-800 text-white text-[11px] font-bold shrink-0"
              >
                Đồng bộ
              </button>
            )}
        </div>
      )}

      {/* Nội dung chính */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {isAdminCombinedMode ? (
          <div className="flex-1 overflow-y-auto px-3.5 py-3">
            <PwaInstallBanner />
            <AdminDashboardView
              initialMonth={getYearMonth(selectedDate)}
              onOpenFacilityBook={handleAdminSwitchFacility}
              onActOnFacilityReminder={handleAdminActOnReminder}
            />
          </div>
        ) : error ? (
          <div className="p-3.5 m-3 rounded-2xl bg-red-100 border border-red-500 text-red-900 font-bold text-sm">
            {error}
          </div>
        ) : !snapshot ? (
          <div className="text-center py-12 text-sm text-stone-600 font-semibold">
            Đang tải dữ liệu sổ...
          </div>
        ) : activeForm ? (
          <div className="flex-1 overflow-y-auto px-3.5 py-3">
            <ManualEntryForms
              kind={activeForm.kind}
              selectedDate={selectedDate}
              snapshot={snapshot}
              editingTx={activeForm.editTx}
              onCancel={() => setActiveForm(null)}
              onSaved={async (undo) => {
                setActiveForm(null);
                if (undo) setUndoState(undo);
                await reloadSnapshot();
              }}
            />
          </div>
        ) : session.vai_tro === 'owner' ? (
          /* =========================================================================
           * GIAO DIỆN ROLLY 1 MÀN HÌNH CỐ ĐỊNH CHO BỐ & MẸ:
           * - Header cố định ở trên
           * - Khung xem nhanh RollyOverviewBanner nhỏ gọn ở trên
           * - Vùng hội thoại Chat AI ở giữa (cuộn lên xuống xem lịch sử cũ)
           * - Cụm Micro 1 chạm cố định vững chắc ở đáy
           * ========================================================================= */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-2.5 gap-2">
            {/* Thanh hoàn tác nếu có */}
            {undoState && (
              <div className="shrink-0">
                <UndoBanner
                  undoState={undoState}
                  onDismiss={() => setUndoState(null)}
                  onUndone={async () => {
                    setUndoState(null);
                    await reloadSnapshot();
                  }}
                />
              </div>
            )}

            {/* Khối Rolly Overview: Xem nhanh Lãi hôm nay + Tiền có + Nợ & Phải thu */}
            <div className="shrink-0">
              <RollyOverviewBanner
                snapshot={snapshot}
                selectedDate={selectedDate}
                onOpenProfit={() => setDetailDrawer('profit')}
                onOpenWallets={() => setDetailDrawer('wallets')}
                onOpenDebts={() => setDetailDrawer('debts')}
              />
            </div>

            {/* Trợ lý Giọng nói AI: Bảng chat cuộn độc lập + Micro cố định ở đáy */}
            <ChatAssistantBox
              snapshot={snapshot}
              selectedDate={selectedDate}
              onOpenManualForm={(kind, draftTx) =>
                setActiveForm({ kind, editTx: draftTx ?? null })
              }
              onCommitted={async (undo) => {
                if (undo) setUndoState(undo);
                await reloadSnapshot();
              }}
            />
          </div>
        ) : (
          /* Chế độ Admin: Giữ 4 Tab như cũ */
          <div className="flex-1 overflow-y-auto px-3.5 py-3 pb-24">
            <PwaInstallBanner />
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
          </div>
        )}
      </main>

      {/* 4 Tab dưới đáy chỉ hiển thị cho tài khoản Admin khi xem 1 cơ sở */}
      {session.vai_tro === 'admin' && !isAdminCombinedMode && (
        <nav
          aria-label="Thanh điều hướng chính Admin"
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

      {/* =========================================================================
       * ROLLY DRAWERS: XEM CHI TIẾT 1 CỘT KHÔNG CUỘN NGANG
       * ========================================================================= */}
      {snapshot && (
        <>
          <RollyDetailDrawer
            title={`Lợi nhuận ${snapshot.book.ten}`}
            isOpen={detailDrawer === 'profit'}
            onClose={() => setDetailDrawer(null)}
          >
            <HomNayTab
              snapshot={snapshot}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onJumpToForm={handleJumpToForm}
              onOpenManualForm={(kind, editTx) => {
                setDetailDrawer(null);
                setActiveForm({ kind, editTx: editTx ?? null });
              }}
              onDataChanged={reloadSnapshot}
            />
          </RollyDetailDrawer>

          <RollyDetailDrawer
            title={`Tiền thực tế ${snapshot.book.ten}`}
            isOpen={detailDrawer === 'wallets'}
            onClose={() => setDetailDrawer(null)}
          >
            <DongTienTab
              snapshot={snapshot}
              selectedDate={selectedDate}
              onDataChanged={reloadSnapshot}
              onOpenManualForm={(kind, editTx) => {
                setDetailDrawer(null);
                setActiveForm({ kind, editTx: editTx ?? null });
              }}
            />
          </RollyDetailDrawer>

          <RollyDetailDrawer
            title={`Sổ Nợ & Phải Thu ${snapshot.book.ten}`}
            isOpen={detailDrawer === 'debts'}
            onClose={() => setDetailDrawer(null)}
          >
            <SoNoTab
              snapshot={snapshot}
              selectedDate={selectedDate}
              focusedSupplierId={focusedSupplierId}
              onClearFocusSupplier={clearFocusedSupplier}
              onDataChanged={reloadSnapshot}
              onOpenManualForm={(kind, editTx) => {
                setDetailDrawer(null);
                setActiveForm({ kind, editTx: editTx ?? null });
              }}
            />
          </RollyDetailDrawer>
        </>
      )}

      {/* Menu Modal 3 chấm gọn gàng */}
      {showMainMenu && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 max-w-md mx-auto"
        >
          <div className="w-full bg-white rounded-3xl p-4 shadow-2xl space-y-2.5 border border-stone-200">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="text-sm sm:text-base font-bold text-stone-900">Tùy chọn hệ thống</div>
              <button
                type="button"
                onClick={() => setShowMainMenu(false)}
                className="w-7 h-7 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-700 font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1.5 pt-0.5">
              {activeReminders.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMainMenu(false);
                    setDetailDrawer('debts');
                  }}
                  className="w-full p-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-400 font-bold text-left text-amber-950 flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-2">
                    <BellRing className="w-4 h-4 text-amber-700" />
                    Việc cần làm ngay
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-stone-950 text-[10px] font-bold">
                    {activeReminders.length}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowMainMenu(false);
                  setShowGuide(true);
                }}
                className="w-full p-2.5 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 font-bold text-left text-stone-900 flex items-center gap-2 text-xs"
              >
                <HelpCircle className="w-4 h-4 text-teal-700" />
                Cẩm nang sử dụng cho Bố/Mẹ
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowMainMenu(false);
                  setShowSettings(true);
                }}
                className="w-full p-2.5 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 font-bold text-left text-stone-900 flex items-center gap-2 text-xs"
              >
                <Settings className="w-4 h-4 text-teal-700" />
                Cài đặt sổ (Đơn giá, Thợ, Mối hàng, PIN)
              </button>

              {session.vai_tro === 'admin' && (
                <div className="p-2 rounded-xl bg-stone-100 space-y-1">
                  <div className="text-[10px] font-bold text-stone-500 uppercase">
                    Chuyển cơ sở (Admin)
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMainMenu(false);
                        handleAdminSwitchFacility('hiep_hoa');
                      }}
                      className="p-1.5 rounded-lg bg-white border border-stone-200 font-bold text-xs"
                    >
                      Hiệp Hòa
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMainMenu(false);
                        handleAdminSwitchFacility('tien_du');
                      }}
                      className="p-1.5 rounded-lg bg-white border border-stone-200 font-bold text-xs"
                    >
                      Tiên Du
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowMainMenu(false);
                  logout();
                }}
                className="w-full p-3.5 rounded-2xl bg-rose-50 hover:bg-rose-100 border border-rose-300 font-extrabold text-left text-rose-800 flex items-center gap-2"
              >
                <LogOut className="w-5 h-5 text-rose-700" />
                Đăng xuất / Đổi người dùng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cửa sổ Cài đặt toàn diện */}
      {showSettings && snapshot && (
        <SettingsModal
          snapshot={snapshot}
          onClose={() => setShowSettings(false)}
          onChanged={reloadSnapshot}
        />
      )}

      {/* Hướng dẫn 1 trang chữ to cho Bố & Mẹ */}
      <ElderlyGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
};
