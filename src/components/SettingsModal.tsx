import React, { useRef, useState, useEffect } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DeleteConfirmModal, type DeleteTargetInfo } from './DeleteConfirmModal';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import { getEffectiveMealPrice } from '../domain/accounting';
import { formatVND, generateId, getTodayISO } from '../domain/format';
import {
  downloadBackupJsonFile,
  exportFullSystemBackupPayload,
  restoreFullSystemBackup,
  validateBackupJsonPayload,
} from '../domain/weeklyBackup';
import type {
  BookSnapshot,
  BusinessSegment,
  Category,
  CategoryCalcMode,
  GuestType,
  MealPeriod,
} from '../types/models';
import { testAiConnection } from '../ai/cloudAiClient';
import type { AiProvider, AiSettings, AiTestResult } from '../types/aiSettings';
import { DEFAULT_AI_SETTINGS } from '../types/aiSettings';
import { MoneyInput } from './MoneyInput';

interface SettingsModalProps {
  snapshot: BookSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

type SettingsTab = 'gia_suat' | 'tho' | 'vi' | 'ncc' | 'danh_muc' | 'nhac_pin' | 'ai_config';

const BUA_NAMES: Record<MealPeriod, string> = {
  sang: 'Bữa sáng',
  trua: 'Bữa trưa',
  toi: 'Bữa tối',
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  snapshot,
  onClose,
  onChanged,
}) => {
  const { session, profiles, cloudStatus, refreshCloudStatus } = useAuth();
  const [tab, setTab] = useState<SettingsTab>('gia_suat');
  const [toast, setToast] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [syncingCloud, setSyncingCloud] = useState(false);
  const today = getTodayISO();
  const bookId = snapshot.book.id;

  // --- CẤU HÌNH AI ĐÁM MÂY (GEMINI / DEEPSEEK / OPENAI / LOCAL) ---
  const [aiConfig, setAiConfig] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);
  const [savingAi, setSavingAi] = useState(false);
  const [workerDeleteTarget, setWorkerDeleteTarget] = useState<DeleteTargetInfo | null>(null);

  useEffect(() => {
    let active = true;
    void dbRepo.getAiSettings?.(session).then((res) => {
      if (active && res) setAiConfig(res);
    });
    return () => {
      active = false;
    };
  }, [session]);

  const handleTestAi = async () => {
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await testAiConnection(aiConfig);
      setTestResult(res);
    } finally {
      setTestingAi(false);
    }
  };

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      await dbRepo.saveAiSettings?.(session, aiConfig);
      notify('Đã lưu cấu hình AI lên Supabase và bộ nhớ máy!');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Không thể lưu cấu hình AI.');
    } finally {
      setSavingAi(false);
    }
  };

  const notify = (msg: string) => {
    setErrMsg('');
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = async () => {
    if (!session || exportingBackup) return;
    try {
      setExportingBackup(true);
      const payload = await exportFullSystemBackupPayload(dbRepo, session);
      const filename = downloadBackupJsonFile(payload);
      notify(`Đã tải file sao lưu: ${filename}`);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Không thể xuất file sao lưu.');
    } finally {
      setExportingBackup(false);
    }
  };

  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    const confirmed = window.confirm(
      'Khôi phục bản sao lưu sẽ nạp lại danh mục, mối hàng, phụ bếp, suất ăn, chấm công và các giao dịch từ file .json. Bạn có chắc chắn muốn khôi phục không?'
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }

    try {
      setRestoringBackup(true);
      const text = await file.text();
      const payload = validateBackupJsonPayload(text);
      const summary = await restoreFullSystemBackup(dbRepo, session, payload);
      await onChanged();
      notify(
        `Khôi phục thành công ${summary.totalTransactions} giao dịch & ${summary.totalCategories} danh mục!`
      );
    } catch (err) {
      setErrMsg(
        err instanceof Error
          ? `Lỗi khôi phục: ${err.message}`
          : 'Lỗi không xác định khi đọc file sao lưu.'
      );
    } finally {
      setRestoringBackup(false);
      e.target.value = '';
    }
  };

  // --- TAB 1: ĐƠN GIÁ SUẤT ĂN ---
  const [priceBua, setPriceBua] = useState<MealPeriod>('trua');
  const [priceLoai, setPriceLoai] = useState<GuestType>('truong');
  const [priceValue, setPriceValue] = useState<number>(25_000);
  const [priceFromDate, setPriceFromDate] = useState<string>(today);

  const handleSaveMealPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (priceValue <= 0) {
      setErrMsg('Đơn giá phải lớn hơn 0 đ');
      return;
    }
    const existingSameDay = snapshot.mealPrices.find(
      (p) =>
        p.book_id === bookId &&
        p.bua === priceBua &&
        p.loai_khach === priceLoai &&
        p.ap_dung_tu_ngay === priceFromDate
    );
    await dbRepo.upsertMealPrice(session, {
      id: existingSameDay?.id,
      book_id: bookId,
      bua: priceBua,
      loai_khach: priceLoai,
      don_gia: priceValue,
      ap_dung_tu_ngay: priceFromDate,
    });
    await onChanged();
    notify(`Đã lưu đơn giá ${BUA_NAMES[priceBua]} áp dụng từ ${priceFromDate}`);
  };

  // --- TAB 2: ĐỘI PHỤ BẾP ---
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerWage, setNewWorkerWage] = useState(250_000);

  const handleAddWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !newWorkerName.trim()) return;
    await dbRepo.upsertWorker(session, {
      book_id: bookId,
      ho_ten: newWorkerName.trim(),
      luong_ngay: newWorkerWage,
      dang_lam: true,
    });
    setNewWorkerName('');
    await onChanged();
    notify('Đã thêm phụ bếp mới!');
  };

  // --- TAB 4: NHÀ CUNG CẤP ---
  const [newSupName, setNewSupName] = useState('');
  const [newSupItem, setNewSupItem] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupOpeningDebt, setNewSupOpeningDebt] = useState(0);

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !newSupName.trim()) return;
    await dbRepo.upsertSupplier(session, {
      book_id: bookId,
      ten_ncc: newSupName.trim(),
      mat_hang_chinh: newSupItem.trim() || 'Nguyên liệu',
      so_dien_thoai: newSupPhone.trim(),
      no_dau_ky: newSupOpeningDebt,
      dang_giao_dich: true,
    });
    setNewSupName('');
    setNewSupItem('');
    setNewSupPhone('');
    setNewSupOpeningDebt(0);
    await onChanged();
    notify('Đã thêm mối hàng mới!');
  };

  // --- TAB 5: DANH MỤC (ADMIN) ---
  const [catName, setCatName] = useState('');
  const [catIcon, setCatIcon] = useState('');
  const [catMode, setCatMode] = useState<CategoryCalcMode>('theo_ngay');
  const [catMang, setCatMang] = useState<BusinessSegment>('bep_an');
  const [catKeywords, setCatKeywords] = useState('');

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !catName.trim()) return;
    try {
      await dbRepo.upsertCategory(session, {
        id: `cat_custom_${generateId().slice(0, 8)}`,
        ten_danh_muc: catName.trim(),
        nhom: 'chi',
        kieu_tinh: catMode,
        mang_mac_dinh: catMang,
        icon: catIcon || '',
        tu_khoa_ai: catKeywords
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        thu_tu: 50,
      });
      setCatName('');
      setCatKeywords('');
      await onChanged();
      notify('Đã thêm danh mục mới!');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Lỗi thêm danh mục');
    }
  };

  // --- TAB 6: LỊCH NHẮC & MÃ PIN ---
  const [gioNhac, setGioNhac] = useState(snapshot.book.gio_nhac_hang_ngay);
  const [ngayNhacTruong, setNgayNhacTruong] = useState(snapshot.book.ngay_nhac_truong_chuyen);
  const [soNgayNhacNo, setSoNgayNhacNo] = useState(snapshot.book.so_ngay_nhac_no_ncc);

  const [targetPinProfile, setTargetPinProfile] = useState(session?.profile_id ?? 'bo');
  const [newPin, setNewPin] = useState('');

  const handleSaveReminders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    await dbRepo.updateBookSettings(session, {
      ...snapshot.book,
      gio_nhac_hang_ngay: gioNhac,
      ngay_nhac_truong_chuyen: Math.min(28, Math.max(1, Number(ngayNhacTruong || 20))),
      so_ngay_nhac_no_ncc: Math.max(1, Number(soNgayNhacNo || 15)),
    });
    await onChanged();
    notify('Đã lưu lịch nhắc định kỳ!');
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    try {
      await dbRepo.changePin(session, targetPinProfile, newPin);
      setNewPin('');
      notify('Đã cập nhật mã PIN 4 số thành công!');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Không đổi được PIN');
    }
  };

  if (!session) return null;

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'gia_suat', label: 'Đơn giá' },
    { key: 'tho', label: 'Phụ bếp' },
    { key: 'vi', label: '3 Ví' },
    { key: 'ncc', label: 'Mối hàng' },
    { key: 'danh_muc', label: 'Danh mục' },
    { key: 'nhac_pin', label: 'Nhắc / PIN' },
    { key: 'ai_config', label: 'AI (API Key)' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-center overflow-y-auto">
      <div className="bg-stone-100 w-full max-w-md min-h-screen flex flex-col">
        {/* Header cài đặt */}
        <div className="bg-stone-900 text-white px-4 py-3.5 flex items-center justify-between sticky top-0 z-20">
          <div>
            <div className="text-xl font-extrabold">Cài đặt — {snapshot.book.ten}</div>
            <div className="text-sm opacity-80">Áp dụng riêng cho cơ sở đang mở</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 font-bold text-base inline-flex items-center gap-1"
          >
            <X className="w-5 h-5" />
            Đóng
          </button>
        </div>

        {/* Thanh chọn mục cài đặt cuộn ngang mượt mà */}
        <div className="bg-white border-b border-stone-200 p-1.5 flex gap-1 overflow-x-auto no-scrollbar sticky top-[64px] z-10">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setErrMsg('');
              }}
              className={`py-1.5 px-3 rounded-lg font-bold text-xs whitespace-nowrap border transition-colors ${
                tab === t.key
                  ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                  : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Nội dung cài đặt */}
        <div className="p-4 space-y-4 flex-1 pb-12">
          {toast && (
            <div className="rounded-2xl bg-emerald-700 text-white px-4 py-3 font-bold text-lg flex items-center gap-2">
              <Check className="w-6 h-6 shrink-0" />
              {toast}
            </div>
          )}
          {errMsg && (
            <div className="rounded-2xl bg-red-100 border-2 border-red-500 text-red-900 px-4 py-3 font-bold text-lg">
              {errMsg}
            </div>
          )}

          {/* 1. ĐƠN GIÁ SUẤT ĂN */}
          {tab === 'gia_suat' && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white border-2 border-stone-200 p-4 space-y-2">
                <h3 className="text-xl font-extrabold text-teal-900">
                  Bảng đơn giá đang có hiệu lực hôm nay ({today})
                </h3>
                {(['sang', 'trua', 'toi'] as MealPeriod[]).map((bua) => (
                  <div
                    key={bua}
                    className="flex items-center justify-between py-2 border-b border-stone-100 text-lg"
                  >
                    <span className="font-bold text-stone-800">{BUA_NAMES[bua]}</span>
                    <span className="text-stone-900">
                      Trường:{' '}
                      <strong>
                        {formatVND(
                          getEffectiveMealPrice(snapshot.mealPrices, bookId, bua, 'truong', today)
                        )}
                      </strong>{' '}
                      · VL:{' '}
                      <strong>
                        {formatVND(
                          getEffectiveMealPrice(
                            snapshot.mealPrices,
                            bookId,
                            bua,
                            'vang_lai',
                            today
                          )
                        )}
                      </strong>
                    </span>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleSaveMealPrice}
                className="rounded-2xl bg-white border-2 border-teal-600 p-4 space-y-3"
              >
                <h4 className="text-lg font-extrabold text-stone-900">
                  Cập nhật đơn giá mới (giữ nguyên số liệu các tháng cũ)
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  <select
                    value={priceBua}
                    onChange={(e) => setPriceBua(e.target.value as MealPeriod)}
                    className="rounded-xl border-2 border-stone-400 px-3 py-2.5 font-bold text-lg"
                  >
                    <option value="sang">Bữa sáng</option>
                    <option value="trua">Bữa trưa</option>
                    <option value="toi">Bữa tối</option>
                  </select>
                  <select
                    value={priceLoai}
                    onChange={(e) => setPriceLoai(e.target.value as GuestType)}
                    className="rounded-xl border-2 border-stone-400 px-3 py-2.5 font-bold text-lg"
                  >
                    <option value="truong">Suất trường</option>
                    <option value="vang_lai">Suất vãng lai</option>
                  </select>
                </div>

                <MoneyInput
                  label="Đơn giá 1 suất"
                  value={priceValue}
                  onChange={setPriceValue}
                />

                <div>
                  <label className="block text-base font-bold text-stone-700 mb-1">
                    Áp dụng từ ngày:
                  </label>
                  <input
                    type="date"
                    value={priceFromDate}
                    onChange={(e) => setPriceFromDate(e.target.value)}
                    className="w-full rounded-xl border-2 border-stone-400 px-3.5 py-2.5 text-lg font-bold"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl bg-teal-700 text-white font-extrabold text-lg"
                >
                  Lưu mức giá này
                </button>
              </form>
            </div>
          )}

          {/* 2. ĐỘI PHỤ BẾP */}
          {tab === 'tho' && (
            <div className="space-y-4">
              <div className="space-y-3">
                {snapshot.workers.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-stone-200 p-4 text-center space-y-1">
                    <div className="text-xs font-bold text-stone-800">Chưa có công nhân / phụ bếp nào</div>
                    <div className="text-[11px] text-stone-500">
                      Khi nói hoặc ghi âm có tên người làm (VD: <em>"Tiền công chú Hiển 500k chưa trả"</em>), hệ thống sẽ tự động tạo mới vào danh sách này.
                    </div>
                  </div>
                ) : (
                  snapshot.workers.map((w) => (
                    <WorkerEditCard
                      key={w.id}
                      worker={w}
                      onSave={async (updated) => {
                        await dbRepo.upsertWorker(session, updated);
                        await onChanged();
                        notify(`Đã cập nhật ${updated.ho_ten}`);
                      }}
                      onDelete={() => {
                        setWorkerDeleteTarget({
                          id: w.id,
                          title: w.ho_ten,
                          subtitle: `Tiền công: ${formatVND(w.luong_ngay)}/ngày`,
                        });
                      }}
                    />
                  ))
                )}
              </div>

              <form
                onSubmit={handleAddWorker}
                className="rounded-2xl bg-white border-2 border-teal-600 p-4 space-y-3"
              >
                <h4 className="text-lg font-extrabold text-teal-900 inline-flex items-center gap-1.5">
                  <Plus className="w-5 h-5" />
                  Thêm công nhân / phụ bếp mới
                </h4>
                <input
                  type="text"
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                  placeholder="Họ tên (VD: Cô Hạnh)"
                  className="w-full rounded-xl border-2 border-stone-400 px-3.5 py-2.5 text-lg font-bold"
                />
                <MoneyInput
                  label="Tiền công 1 ngày"
                  value={newWorkerWage}
                  onChange={setNewWorkerWage}
                />
                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl bg-teal-700 text-white font-extrabold text-lg"
                >
                  Thêm phụ bếp
                </button>
              </form>
            </div>
          )}

          {/* 3. VÍ & SỐ DƯ ĐẦU KỲ */}
          {tab === 'vi' && (
            <div className="space-y-3">
              <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-base text-amber-950 font-medium">
                Số dư đầu kỳ là số tiền đang có sẵn trong ví lúc mới bắt đầu dùng phần mềm.
              </div>
              {snapshot.wallets.map((w) => (
                <WalletEditCard
                  key={w.id}
                  wallet={w}
                  onSave={async (updated) => {
                    await dbRepo.updateWallet(session, updated);
                    await onChanged();
                    notify(`Đã lưu ví ${updated.ten_vi}`);
                  }}
                />
              ))}
            </div>
          )}

          {/* 4. MỐI HÀNG / NHÀ CUNG CẤP */}
          {tab === 'ncc' && (
            <div className="space-y-4">
              <div className="space-y-3">
                {snapshot.suppliers.map((s) => (
                  <SupplierEditCard
                    key={s.id}
                    supplier={s}
                    onSave={async (updated) => {
                      await dbRepo.upsertSupplier(session, updated);
                      await onChanged();
                      notify(`Đã lưu mối hàng ${updated.ten_ncc}`);
                    }}
                  />
                ))}
              </div>

              <form
                onSubmit={handleAddSupplier}
                className="rounded-2xl bg-white border-2 border-rose-600 p-4 space-y-3"
              >
                <h4 className="text-lg font-extrabold text-rose-900">
                  + Thêm mối hàng / đại lý mới
                </h4>
                <input
                  type="text"
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  placeholder="Tên người bán / đại lý (VD: Chị Thủy rau)"
                  className="w-full rounded-xl border-2 border-stone-400 px-3.5 py-2.5 text-lg font-bold"
                />
                <input
                  type="text"
                  value={newSupItem}
                  onChange={(e) => setNewSupItem(e.target.value)}
                  placeholder="Mặt hàng chính (VD: Rau củ quả)"
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-lg"
                />
                <input
                  type="tel"
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                  placeholder="Số điện thoại (nếu có)"
                  className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2 text-lg"
                />
                <MoneyInput
                  label="Nợ cũ đầu kỳ (nếu đang còn nợ trước đó)"
                  value={newSupOpeningDebt}
                  onChange={setNewSupOpeningDebt}
                />
                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl bg-rose-700 text-white font-extrabold text-lg"
                >
                  Thêm mối hàng
                </button>
              </form>
            </div>
          )}

          {/* 5. DANH MỤC */}
          {tab === 'danh_muc' && (
            <div className="space-y-4">
              {session.vai_tro === 'admin' && (
                <form
                  onSubmit={handleAddCategory}
                  className="rounded-2xl bg-white border-2 border-teal-600 p-4 space-y-3"
                >
                  <h4 className="text-lg font-extrabold text-teal-900">
                    + Thêm danh mục chi tiêu mới (Quyền Admin)
                  </h4>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={catIcon}
                      onChange={(e) => setCatIcon(e.target.value)}
                      className="w-16 rounded-xl border-2 border-stone-400 text-center text-2xl py-2"
                    />
                    <input
                      type="text"
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                      placeholder="Tên danh mục (VD: Đậu phụ)"
                      className="flex-1 rounded-xl border-2 border-stone-400 px-3 py-2 text-lg font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={catMode}
                      onChange={(e) => setCatMode(e.target.value as CategoryCalcMode)}
                      className="rounded-xl border-2 border-stone-400 px-3 py-2 font-bold text-base"
                    >
                      <option value="theo_ngay">Tính theo ngày</option>
                      <option value="theo_thang">Trừ vào cuối tháng</option>
                    </select>
                    <select
                      value={catMang}
                      onChange={(e) => setCatMang(e.target.value as BusinessSegment)}
                      className="rounded-xl border-2 border-stone-400 px-3 py-2 font-bold text-base"
                    >
                      <option value="bep_an">Mảng Bếp ăn</option>
                      <option value="can_tin">Mảng Căn tin</option>
                      <option value="chung">Chung cả cơ sở</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={catKeywords}
                    onChange={(e) => setCatKeywords(e.target.value)}
                    placeholder="Từ khóa AI cách nhau dấu phẩy (VD: đậu mơ, đậu rán)"
                    className="w-full rounded-xl border-2 border-stone-300 px-3 py-2 text-base"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-teal-700 text-white font-extrabold text-lg"
                  >
                    Lưu danh mục mới
                  </button>
                </form>
              )}

              <div className="rounded-2xl bg-white border border-stone-300 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-extrabold text-stone-900">
                    Danh mục &amp; Từ khóa địa phương ({snapshot.categories.length})
                  </div>
                  <span className="text-xs text-stone-500 font-semibold">
                    Chạm để xem/thêm từ khóa
                  </span>
                </div>
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-0.5">
                  {snapshot.categories.map((c) => (
                    <CategoryEditCard
                      key={c.id}
                      category={c}
                      isAdmin={session.vai_tro === 'admin'}
                      onSave={async (updated) => {
                        await dbRepo.upsertCategory(session, updated);
                        await onChanged();
                        notify(`Đã cập nhật từ khóa cho ${updated.ten_danh_muc}`);
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 6. LỊCH NHẮC & ĐỔI MÃ PIN */}
          {tab === 'nhac_pin' && (
            <div className="space-y-4">
              <form
                onSubmit={handleSaveReminders}
                className="rounded-2xl bg-white border-2 border-stone-300 p-4 space-y-3"
              >
                <h4 className="text-xl font-extrabold text-stone-900">
                  Lịch nhắc việc định kỳ ({snapshot.book.ten})
                </h4>
                <div>
                  <label className="block text-base font-bold text-stone-700 mb-1">
                    Giờ nhắc nhập suất ăn & thu cuối ngày:
                  </label>
                  <input
                    type="time"
                    value={gioNhac}
                    onChange={(e) => setGioNhac(e.target.value)}
                    className="w-full rounded-xl border-2 border-stone-400 px-3 py-2 text-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block text-base font-bold text-stone-700 mb-1">
                    Nhắc "Trường chưa chuyển tiền" từ ngày mấy hàng tháng?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={ngayNhacTruong}
                    onChange={(e) => setNgayNhacTruong(Number(e.target.value))}
                    className="w-full rounded-xl border-2 border-stone-400 px-3 py-2 text-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block text-base font-bold text-stone-700 mb-1">
                    Nhắc khoản nợ mối hàng nếu quá bao nhiêu ngày?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={soNgayNhacNo}
                    onChange={(e) => setSoNgayNhacNo(Number(e.target.value))}
                    className="w-full rounded-xl border-2 border-stone-400 px-3 py-2 text-lg font-bold"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl bg-teal-700 text-white font-extrabold text-lg"
                >
                  Lưu lịch nhắc
                </button>
              </form>

              <form
                onSubmit={handleChangePin}
                className="rounded-2xl bg-white border-2 border-stone-300 p-4 space-y-3"
              >
                <h4 className="text-xl font-extrabold text-stone-900">Đổi mã PIN 4 số</h4>
                {session.vai_tro === 'admin' ? (
                  <div>
                    <label className="block text-base font-bold text-stone-700 mb-1">
                      Đổi PIN cho tài khoản:
                    </label>
                    <select
                      value={targetPinProfile}
                      onChange={(e) => setTargetPinProfile(e.target.value)}
                      className="w-full rounded-xl border-2 border-stone-400 px-3 py-2.5 text-lg font-bold"
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.ten_hien_thi}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="text-base text-stone-700">
                    Đổi mã PIN đăng nhập của <strong>{session.xung_ho}</strong>
                  </div>
                )}

                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Nhập 4 chữ số mới (VD: 5678)"
                  className="w-full rounded-xl border-2 border-stone-400 px-3.5 py-2.5 text-2xl font-extrabold tracking-widest"
                />
                <button
                  type="submit"
                  className="w-full py-3 rounded-2xl bg-stone-900 text-white font-extrabold text-lg"
                >
                  Cập nhật mã PIN
                </button>
              </form>

              <div className="rounded-2xl bg-white border-2 border-sky-400 p-4 space-y-3 text-base text-stone-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-extrabold text-lg text-stone-950">
                    Đám mây Supabase & Realtime
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${
                      cloudStatus?.connected
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-400'
                        : 'bg-amber-100 text-amber-900 border border-amber-400'
                    }`}
                  >
                    {cloudStatus?.connected ? 'ĐÃ BẬT REALTIME' : 'ĐANG LƯU TRÊN MÁY'}
                  </span>
                </div>

                <p className="text-sm text-stone-700 leading-relaxed">
                  {cloudStatus?.message ||
                    'Đang lưu cục bộ trên trình duyệt thiết bị (IndexedDB).'}
                </p>

                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={syncingCloud}
                    onClick={async () => {
                      setSyncingCloud(true);
                      try {
                        const status = await refreshCloudStatus();
                        if (status?.connected) {
                          notify('Đã kết nối thành công với Đám mây Supabase!');
                          await onChanged();
                        } else {
                          setErrMsg(
                            status?.message ||
                              'Chưa tìm thấy bảng trên Supabase. Hãy chạy file SQL trước nhé!'
                          );
                        }
                      } finally {
                        setSyncingCloud(false);
                      }
                    }}
                    className="w-full min-h-[46px] px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-900 font-bold text-base inline-flex items-center justify-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingCloud ? 'animate-spin' : ''}`} />
                    <span>Kiểm tra lại kết nối Supabase</span>
                  </button>

                  {cloudStatus?.connected && dbRepo.syncLocalBookToCloud && (
                    <button
                      type="button"
                      disabled={syncingCloud}
                      onClick={async () => {
                        if (!session || !dbRepo.syncLocalBookToCloud) return;
                        setSyncingCloud(true);
                        try {
                          if (session.vai_tro === 'admin') {
                            const r1 = await dbRepo.syncLocalBookToCloud(session, 'hiep_hoa');
                            const r2 = await dbRepo.syncLocalBookToCloud(session, 'tien_du');
                            await onChanged();
                            notify(
                              `Đã đẩy dữ liệu cả 2 sổ lên Đám mây (${
                                r1.totalRows + r2.totalRows
                              } bản ghi)!`
                            );
                          } else {
                            const res = await dbRepo.syncLocalBookToCloud(session, bookId);
                            await onChanged();
                            notify(
                              `Đã đẩy dữ liệu ${snapshot.book.ten} lên Đám mây (${res.totalRows} bản ghi)!`
                            );
                          }
                        } catch (err) {
                          setErrMsg(
                            err instanceof Error
                              ? err.message
                              : 'Không thể đẩy dữ liệu lên đám mây.'
                          );
                        } finally {
                          setSyncingCloud(false);
                        }
                      }}
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-extrabold text-base inline-flex items-center justify-center gap-2"
                    >
                      <CloudUpload className="w-5 h-5" />
                      <span>
                        {session.vai_tro === 'admin'
                          ? 'Đẩy dữ liệu thử trên máy (cả 2 sổ) lên Đám mây'
                          : `Đẩy dữ liệu thử trên máy (${snapshot.book.ten}) lên Đám mây`}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {session.vai_tro === 'admin' && (
                <div className="rounded-2xl bg-white border-2 border-indigo-400 p-4 space-y-3 text-base text-stone-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold text-lg text-indigo-950 flex items-center gap-1.5">
                      <FileJson className="w-5 h-5 text-indigo-700" />
                      <span>Sao lưu toàn hệ thống (.json)</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-100 text-indigo-950 border border-indigo-300">
                      Chuẩn Rule 10
                    </span>
                  </div>

                  <p className="text-sm text-stone-600 leading-relaxed">
                    Tải về 1 file .json đầy đủ cả 2 cơ sở (Hiệp Hòa &amp; Tiên Du) để lưu trữ an toàn trên Google Drive / máy tính. Tuyệt đối không sinh bất kỳ file sao lưu .xlsx nào trên ổ đĩa.
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={exportingBackup}
                      onClick={handleExportBackup}
                      className="min-h-[46px] px-3 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white font-extrabold text-sm flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      <span>{exportingBackup ? 'Đang tạo...' : 'Tải file .json'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={restoringBackup}
                      onClick={() => backupFileInputRef.current?.click()}
                      className="min-h-[46px] px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-900 font-extrabold text-sm flex items-center justify-center gap-1.5"
                    >
                      <Upload className="w-4 h-4 text-stone-700" />
                      <span>{restoringBackup ? 'Đang đọc...' : 'Khôi phục file'}</span>
                    </button>
                    <input
                      ref={backupFileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleFileRestore}
                      className="hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 7. CẤU HÌNH AI ĐÁM MÂY (GEMINI / DEEPSEEK / OPENAI / LOCAL) */}
          {tab === 'ai_config' && (
            <div className="space-y-3">
              <div className="rounded-2xl bg-white border border-stone-200 p-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-teal-700 shrink-0" />
                  <div>
                    <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide">
                      Cấu hình Trí tuệ nhân tạo (AI Settings)
                    </h3>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      Lưu trên Supabase &amp; bộ nhớ máy để cả gia đình dùng chung. Khi hết token, Admin có thể đổi nhà cung cấp ngay trên điện thoại.
                    </p>
                  </div>
                </div>

                {/* Bật / Tắt AI Đám mây */}
                <div className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-stone-800">
                      Sử dụng AI Đám mây
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {aiConfig.enabled ? 'Đang bật phân tích thông minh' : 'Tắt AI đám mây (Dùng NLU máy 0 token)'}
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiConfig.enabled}
                      onChange={(e) => setAiConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-700"></div>
                  </label>
                </div>

                {/* Nhà cung cấp AI */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700">
                    Nhà cung cấp AI (Provider):
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'gemini', label: 'Google Gemini', desc: 'gemini-3.8-flash' },
                      { id: 'deepseek', label: 'DeepSeek AI', desc: 'Rẻ, thông minh, mượt' },
                      { id: 'openai', label: 'OpenAI / Khác', desc: 'GPT-4o mini, OpenRouter' },
                      { id: 'local', label: 'NLU Cục bộ', desc: '0 token, chạy offline' },
                    ].map((prov) => (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => {
                          const nextProvider = prov.id as AiProvider;
                          const defaultModel =
                            nextProvider === 'gemini'
                              ? 'gemini-3.8-flash'
                              : nextProvider === 'deepseek'
                              ? 'deepseek-chat'
                              : nextProvider === 'openai'
                              ? 'gpt-4o-mini'
                              : '';
                          setAiConfig((prev) => ({
                            ...prev,
                            provider: nextProvider,
                            model: defaultModel,
                          }));
                          setTestResult(null);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          aiConfig.provider === prov.id
                            ? 'bg-teal-50 border-teal-600 text-teal-950 font-bold shadow-xs'
                            : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                        }`}
                      >
                        <div className="text-xs font-bold">{prov.label}</div>
                        <div className="text-[10px] text-stone-500 mt-0.5">{prov.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {aiConfig.provider !== 'local' && (
                  <>
                    {/* API Key */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-stone-700 flex items-center justify-between">
                        <span>API Key:</span>
                        <span className="text-[10px] font-normal text-stone-500">
                          {aiConfig.provider === 'gemini' ? 'Bắt đầu bằng AIza...' : 'Bắt đầu bằng sk-...'}
                        </span>
                      </label>
                      <div className="relative">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={aiConfig.api_key}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, api_key: e.target.value }))}
                          placeholder="Dán API Key vào đây..."
                          className="w-full px-3 py-2 pr-10 rounded-xl border border-stone-300 text-xs font-mono text-stone-900 bg-stone-50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-stone-400 hover:text-stone-700"
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Model Name */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-stone-700">
                        Tên Model:
                      </label>
                      <input
                        type="text"
                        value={aiConfig.model}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, model: e.target.value }))}
                        placeholder="VD: gemini-3.8-flash, deepseek-chat..."
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs font-mono text-stone-900 bg-stone-50"
                      />
                    </div>

                    {/* Endpoint (Optional) */}
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-stone-700 flex items-center justify-between">
                        <span>URL Máy chủ / Endpoint tùy chỉnh (Tùy chọn):</span>
                      </label>
                      <input
                        type="text"
                        value={aiConfig.endpoint || ''}
                        onChange={(e) => setAiConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                        placeholder="Để trống nếu dùng mặc định của nhà cung cấp"
                        className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs text-stone-900 bg-stone-50"
                      />
                    </div>
                  </>
                )}

                {/* Nút Kiểm tra kết nối */}
                <div className="pt-1">
                  <button
                    type="button"
                    disabled={testingAi}
                    onClick={handleTestAi}
                    className="w-full py-2 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
                  >
                    {testingAi ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-stone-600" />
                        <span>Đang kiểm tra kết nối...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                        <span>Kiểm tra kết nối AI ngay</span>
                      </>
                    )}
                  </button>

                  {testResult && (
                    <div
                      className={`mt-2 p-2.5 rounded-xl border text-xs leading-relaxed ${
                        testResult.success
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-medium'
                          : 'bg-rose-50 border-rose-300 text-rose-950 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold mb-0.5">
                        {testResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
                        )}
                        <span>{testResult.success ? 'Kết nối thành công!' : 'Kết nối thất bại!'}</span>
                      </div>
                      <div>{testResult.message}</div>
                    </div>
                  )}
                </div>

                {/* Nút Lưu cấu hình */}
                <div className="pt-2 border-t border-stone-200">
                  <button
                    type="button"
                    disabled={savingAi}
                    onClick={handleSaveAi}
                    className="w-full py-2.5 px-4 rounded-xl bg-teal-800 hover:bg-teal-900 disabled:opacity-50 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.99] shadow-xs"
                  >
                    {savingAi ? (
                      <span>Đang lưu...</span>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Lưu cấu hình AI</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal xác nhận xóa thợ có tự động hủy sau 10s */}
      <DeleteConfirmModal
        target={workerDeleteTarget}
        isOpen={Boolean(workerDeleteTarget)}
        onConfirm={async () => {
          if (!workerDeleteTarget || !session) return;
          try {
            await dbRepo.deleteWorker?.(session, snapshot.book.id, workerDeleteTarget.id);
            await onChanged();
            notify(`Đã xóa phụ bếp ${workerDeleteTarget.title}`);
          } catch (err) {
            setErrMsg(err instanceof Error ? err.message : 'Không thể xóa phụ bếp.');
          } finally {
            setWorkerDeleteTarget(null);
          }
        }}
        onCancel={() => setWorkerDeleteTarget(null)}
      />
    </div>
  );
};

// --- CÁC THẺ CHỈNH SỬA CON GỌN GÀNG ---

const WorkerEditCard: React.FC<{
  worker: BookSnapshot['workers'][number];
  onSave: (w: BookSnapshot['workers'][number]) => Promise<void>;
  onDelete?: () => void;
}> = ({ worker, onSave, onDelete }) => {
  const [name, setName] = useState(worker.ho_ten);
  const [wage, setWage] = useState(worker.luong_ngay);
  const [active, setActive] = useState(worker.dang_lam);

  return (
    <div className="rounded-2xl bg-white border border-stone-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-bold text-stone-900"
        />
        <button
          type="button"
          onClick={() => setActive((v) => !v)}
          className={`px-2.5 py-1 rounded-xl font-bold text-[11px] ${
            active ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-600'
          }`}
        >
          {active ? 'Đang làm' : 'Tạm nghỉ'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={wage}
          onChange={(e) => setWage(Number(e.target.value || 0))}
          className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-xs font-bold text-stone-900"
        />
        <span className="text-xs text-stone-500">đ/ngày</span>
        <button
          type="button"
          onClick={() => onSave({ ...worker, ho_ten: name, luong_ngay: wage, dang_lam: active })}
          className="px-3 py-1.5 rounded-xl bg-teal-700 text-white font-bold text-xs"
        >
          Lưu
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Xóa phụ bếp"
            className="p-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-bold"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

const WalletEditCard: React.FC<{
  wallet: BookSnapshot['wallets'][number];
  onSave: (w: BookSnapshot['wallets'][number]) => Promise<void>;
}> = ({ wallet, onSave }) => {
  const [tenVi, setTenVi] = useState(wallet.ten_vi);
  const [chuTk, setChuTk] = useState(wallet.chu_tai_khoan);
  const [dauKy, setDauKy] = useState(wallet.so_du_dau_ky);

  return (
    <div className="rounded-2xl bg-white border-2 border-stone-200 p-4 space-y-2.5">
      <input
        type="text"
        value={tenVi}
        onChange={(e) => setTenVi(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-lg font-extrabold"
      />
      <input
        type="text"
        value={chuTk}
        onChange={(e) => setChuTk(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-base text-stone-700"
      />
      <MoneyInput label="Số dư đầu kỳ" value={dauKy} onChange={setDauKy} />
      <button
        type="button"
        onClick={() =>
          onSave({ ...wallet, ten_vi: tenVi, chu_tai_khoan: chuTk, so_du_dau_ky: dauKy })
        }
        className="w-full py-2.5 rounded-xl bg-teal-700 text-white font-bold text-lg"
      >
        Lưu ví này
      </button>
    </div>
  );
};

const SupplierEditCard: React.FC<{
  supplier: BookSnapshot['suppliers'][number];
  onSave: (s: BookSnapshot['suppliers'][number]) => Promise<void>;
}> = ({ supplier, onSave }) => {
  const [ten, setTen] = useState(supplier.ten_ncc);
  const [matHang, setMatHang] = useState(supplier.mat_hang_chinh);
  const [noDau, setNoDau] = useState(supplier.no_dau_ky);

  return (
    <div className="rounded-2xl bg-white border-2 border-stone-200 p-3.5 space-y-2">
      <input
        type="text"
        value={ten}
        onChange={(e) => setTen(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-lg font-extrabold"
      />
      <input
        type="text"
        value={matHang}
        onChange={(e) => setMatHang(e.target.value)}
        placeholder="Mặt hàng chính"
        className="w-full rounded-xl border border-stone-300 px-3 py-1.5 text-base text-stone-700"
      />
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-stone-700">Nợ đầu kỳ:</span>
        <input
          type="number"
          inputMode="numeric"
          value={noDau}
          onChange={(e) => setNoDau(Number(e.target.value || 0))}
          className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-base font-bold"
        />
        <button
          type="button"
          onClick={() =>
            onSave({ ...supplier, ten_ncc: ten, mat_hang_chinh: matHang, no_dau_ky: noDau })
          }
          className="px-4 py-1.5 rounded-xl bg-rose-700 text-white font-bold text-base"
        >
          Lưu
        </button>
      </div>
    </div>
  );
};

const CategoryEditCard: React.FC<{
  category: Category;
  isAdmin: boolean;
  onSave: (cat: Category) => Promise<void>;
}> = ({ category, isAdmin, onSave }) => {
  const [expanded, setExpanded] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [keywords, setKeywords] = useState<string[]>(category.tu_khoa_ai || []);

  const handleAddKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw) return;
    if (keywords.includes(kw)) {
      setNewKeyword('');
      return;
    }
    const next = [...keywords, kw];
    setKeywords(next);
    setNewKeyword('');
    void onSave({ ...category, tu_khoa_ai: next });
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    const next = keywords.filter((k) => k !== kwToRemove);
    setKeywords(next);
    void onSave({ ...category, tu_khoa_ai: next });
  };

  return (
    <div className="rounded-2xl bg-white border border-stone-200 p-3 space-y-2">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="font-bold text-stone-900 text-base">
          {category.icon} {category.ten_danh_muc}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-lg bg-stone-100 text-stone-600 font-semibold">
            {keywords.length} từ khóa
          </span>
          <span className="text-stone-400 font-bold">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="pt-2 border-t border-stone-100 space-y-2">
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs font-bold"
              >
                {kw}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveKeyword(kw);
                    }}
                    className="text-stone-400 hover:text-rose-600 font-extrabold ml-0.5"
                    title="Xóa từ khóa này"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>

          {isAdmin && (
            <div className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
                placeholder="Thêm từ địa phương (VD: bìa đậu, revive...)"
                className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-sm font-semibold"
              />
              <button
                type="button"
                onClick={handleAddKeyword}
                className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-sm shrink-0"
              >
                + Thêm
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
