import React, { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import { isSupabaseConfigured } from '../db/supabaseClient';
import { getEffectiveMealPrice } from '../domain/accounting';
import { formatVND, generateId, getTodayISO } from '../domain/format';
import type {
  BookSnapshot,
  BusinessSegment,
  CategoryCalcMode,
  GuestType,
  MealPeriod,
} from '../types/models';
import { MoneyInput } from './MoneyInput';

interface SettingsModalProps {
  snapshot: BookSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

type SettingsTab = 'gia_suat' | 'tho' | 'vi' | 'ncc' | 'danh_muc' | 'nhac_pin';

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
  const { session, profiles } = useAuth();
  const [tab, setTab] = useState<SettingsTab>('gia_suat');
  const [toast, setToast] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const today = getTodayISO();
  const bookId = snapshot.book.id;

  const notify = (msg: string) => {
    setErrMsg('');
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
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
  const [catIcon, setCatIcon] = useState('🛒');
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
        icon: catIcon || '🛒',
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
    { key: 'gia_suat', label: '🍚 Đơn giá suất' },
    { key: 'tho', label: '👷 Phụ bếp' },
    { key: 'vi', label: '💰 3 Ví & Số dư' },
    { key: 'ncc', label: '📕 Mối hàng' },
    { key: 'danh_muc', label: '🏷️ Danh mục' },
    { key: 'nhac_pin', label: '🔔 Nhắc & PIN' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-center overflow-y-auto">
      <div className="bg-stone-100 w-full max-w-md min-h-screen flex flex-col">
        {/* Header cài đặt */}
        <div className="bg-stone-900 text-white px-4 py-3.5 flex items-center justify-between sticky top-0 z-20">
          <div>
            <div className="text-xl font-extrabold">⚙️ Cài đặt — {snapshot.book.ten}</div>
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

        {/* Thanh chọn mục cài đặt */}
        <div className="bg-white border-b border-stone-300 px-3 py-2.5 flex gap-2 overflow-x-auto sticky top-[64px] z-10">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setErrMsg('');
              }}
              className={`px-3.5 py-2 rounded-xl font-bold text-base whitespace-nowrap border ${
                tab === t.key
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-stone-100 text-stone-800 border-stone-300'
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
                {snapshot.workers.map((w) => (
                  <WorkerEditCard
                    key={w.id}
                    worker={w}
                    onSave={async (updated) => {
                      await dbRepo.upsertWorker(session, updated);
                      await onChanged();
                      notify(`Đã cập nhật ${updated.ho_ten}`);
                    }}
                  />
                ))}
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

              <div className="rounded-2xl bg-white border border-stone-300 p-4 space-y-2">
                <div className="text-lg font-extrabold text-stone-900">
                  Danh sách {snapshot.categories.length} danh mục chuẩn
                </div>
                {snapshot.categories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-2 border-b border-stone-100 text-base"
                  >
                    <span className="font-bold text-stone-800">
                      {c.icon} {c.ten_danh_muc}
                    </span>
                    <span className="text-sm px-2 py-0.5 rounded-lg bg-stone-100 text-stone-600 font-semibold">
                      {c.kieu_tinh === 'theo_thang'
                        ? 'Cuối tháng'
                        : c.kieu_tinh === 'theo_ngay'
                        ? 'Theo ngày'
                        : 'Dòng tiền'}
                    </span>
                  </div>
                ))}
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
                  🔔 Lịch nhắc việc định kỳ ({snapshot.book.ten})
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
                <h4 className="text-xl font-extrabold text-stone-900">🔐 Đổi mã PIN 4 số</h4>
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

              <div className="rounded-2xl bg-white border border-stone-300 p-4 text-base text-stone-700">
                <div className="font-extrabold text-stone-900 mb-1">☁️ Trạng thái lưu trữ</div>
                {isSupabaseConfigured ? (
                  <p>
                    Đang chạy chế độ <strong>IndexedDB trên thiết bị</strong> (nhanh, offline) và đã
                    gắn sẵn kết nối Supabase (<code>grqlnqycxxadedqlppyl.supabase.co</code>) chờ bật
                    đồng bộ thời gian thực ở Phiên 7.
                  </p>
                ) : (
                  <p>Đang lưu cục bộ trên trình duyệt thiết bị (IndexedDB).</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- CÁC THẺ CHỈNH SỬA CON GỌN GÀNG ---

const WorkerEditCard: React.FC<{
  worker: BookSnapshot['workers'][number];
  onSave: (w: BookSnapshot['workers'][number]) => Promise<void>;
}> = ({ worker, onSave }) => {
  const [name, setName] = useState(worker.ho_ten);
  const [wage, setWage] = useState(worker.luong_ngay);
  const [active, setActive] = useState(worker.dang_lam);

  return (
    <div className="rounded-2xl bg-white border-2 border-stone-200 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-lg font-extrabold"
        />
        <button
          type="button"
          onClick={() => setActive((v) => !v)}
          className={`px-3 py-1.5 rounded-xl font-bold text-sm ${
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
          className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-lg font-bold"
        />
        <span className="text-base text-stone-600">đ/ngày</span>
        <button
          type="button"
          onClick={() => onSave({ ...worker, ho_ten: name, luong_ngay: wage, dang_lam: active })}
          className="px-4 py-2 rounded-xl bg-teal-700 text-white font-bold text-base"
        >
          Lưu
        </button>
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
