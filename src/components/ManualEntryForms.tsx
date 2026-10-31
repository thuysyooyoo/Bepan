import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dbRepo } from '../db';
import {
  computeDailyMealRevenue,
  computeDebtAndPayables,
  findPreviousMealDay,
  getEffectiveMealPrice,
} from '../domain/accounting';
import {
  formatCompactVND,
  formatVND,
  formatVietnameseDate,
  getPreviousYearMonth,
  getYearMonth,
} from '../domain/format';
import type {
  BookSnapshot,
  BusinessSegment,
  MealPeriod,
  Transaction,
} from '../types/models';
import {
  ConfirmationCard,
  type ConfirmationPreviewData,
  type UndoState,
} from './ConfirmationCard';
import { MoneyInput } from './MoneyInput';

export type ManualFormKind =
  | 'suat_an'
  | 'thu_cuoi_ngay'
  | 'chi'
  | 'cham_cong'
  | 'tra_no'
  | 'truong_chuyen'
  | 'tra_luong'
  | 'chi_phi_thang'
  | 'chuyen_quy';

interface ManualEntryFormsProps {
  kind: ManualFormKind;
  selectedDate: string;
  snapshot: BookSnapshot;
  editingTx?: Transaction | null;
  onCancel: () => void;
  onSaved: (undo: UndoState) => Promise<void>;
}

const PERIOD_LABELS: Record<MealPeriod, string> = {
  sang: '🌅 Bữa sáng',
  trua: '☀️ Bữa trưa',
  toi: '🌙 Bữa tối',
};

export const ManualEntryForms: React.FC<ManualEntryFormsProps> = ({
  kind,
  selectedDate,
  snapshot,
  editingTx,
  onCancel,
  onSaved,
}) => {
  const { session } = useAuth();
  const bookId = snapshot.book.id;
  const [ngay, setNgay] = useState(editingTx?.ngay ?? selectedDate);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    preview: ConfirmationPreviewData;
    commitFn: () => Promise<UndoState>;
  } | null>(null);

  // Ví mặc định của cơ sở
  const cashWallet = snapshot.wallets.find((w) => w.loai_vi === 'tien_mat') ?? snapshot.wallets[0];
  const moDiepWallet =
    snapshot.wallets.find((w) => w.loai_vi === 'tk_mo_diep') ?? snapshot.wallets[0];
  const chiNhanWallet =
    snapshot.wallets.find((w) => w.loai_vi === 'tk_chi_nhan') ?? snapshot.wallets[0];

  // --- 1. STATE SUẤT ĂN ---
  const [meals, setMeals] = useState<
    Record<MealPeriod, { truong: number; vang_lai: number }>
  >({
    sang: { truong: 0, vang_lai: 0 },
    trua: { truong: 0, vang_lai: 0 },
    toi: { truong: 0, vang_lai: 0 },
  });
  const [copiedFromDate, setCopiedFromDate] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'suat_an') return;
    const getRec = (bua: MealPeriod) =>
      snapshot.mealCounts.find((m) => m.book_id === bookId && m.ngay === ngay && m.bua === bua);
    setMeals({
      sang: { truong: getRec('sang')?.suat_truong ?? 0, vang_lai: getRec('sang')?.suat_vang_lai ?? 0 },
      trua: { truong: getRec('trua')?.suat_truong ?? 0, vang_lai: getRec('trua')?.suat_vang_lai ?? 0 },
      toi: { truong: getRec('toi')?.suat_truong ?? 0, vang_lai: getRec('toi')?.suat_vang_lai ?? 0 },
    });
    setCopiedFromDate(null);
  }, [kind, ngay, bookId, snapshot.mealCounts]);

  // --- 2. STATE THU CUỐI NGÀY (CÁCH A) ---
  const [thuTienMat, setThuTienMat] = useState(0);
  const [thuChuyenKhoan, setThuChuyenKhoan] = useState(0);
  const [hasExistingCollection, setHasExistingCollection] = useState(false);

  useEffect(() => {
    if (kind !== 'thu_cuoi_ngay') return;
    const todayColls = snapshot.transactions.filter(
      (t) => !t.da_xoa && t.ngay === ngay && t.loai === 'thu_cuoi_ngay'
    );
    const tm = todayColls
      .filter((t) => t.wallet_id === cashWallet?.id)
      .reduce((s, t) => s + t.so_tien, 0);
    const ck = todayColls
      .filter((t) => t.wallet_id === chiNhanWallet?.id)
      .reduce((s, t) => s + t.so_tien, 0);
    setThuTienMat(tm);
    setThuChuyenKhoan(ck);
    setHasExistingCollection(todayColls.length > 0);
  }, [kind, ngay, snapshot.transactions, cashWallet?.id, chiNhanWallet?.id]);

  // --- 3 & 8. STATE CHI NGÀY / CHI THÁNG / SỬA GIAO DỊCH ---
  const [mang, setMang] = useState<BusinessSegment>(editingTx?.mang ?? 'bep_an');
  const [categoryId, setCategoryId] = useState<string>(editingTx?.category_id ?? '');
  const [soTien, setSoTien] = useState<number>(editingTx?.so_tien ?? 0);
  const [hinhThucTra, setHinhThucTra] = useState<'tra_luon' | 'ghi_no'>(
    editingTx?.loai === 'chi_no' ? 'ghi_no' : 'tra_luon'
  );
  const [walletId, setWalletId] = useState<string>(
    editingTx?.wallet_id ?? cashWallet?.id ?? ''
  );
  const [toWalletId, setToWalletId] = useState<string>(
    editingTx?.to_wallet_id ?? cashWallet?.id ?? ''
  );
  const [supplierId, setSupplierId] = useState<string>(
    editingTx?.supplier_id ?? snapshot.suppliers[0]?.id ?? ''
  );
  const [newSupplierName, setNewSupplierName] = useState('');
  const [addingNewSupplier, setAddingNewSupplier] = useState(false);
  const [workerId, setWorkerId] = useState<string>(editingTx?.worker_id ?? '');
  const [kyThang, setKyThang] = useState<string>(
    editingTx?.ky_thang ?? getYearMonth(ngay)
  );
  const [ghiChu, setGhiChu] = useState<string>(editingTx?.ghi_chu ?? '');

  // Tự chọn danh mục đầu tiên phù hợp khi đổi mảng hoặc mở form
  const availableCategories = useMemo(() => {
    if (kind === 'chi') {
      return snapshot.categories.filter(
        (c) => c.nhom === 'chi' && c.kieu_tinh === 'theo_ngay' && c.mang_mac_dinh === mang
      );
    }
    if (kind === 'chi_phi_thang') {
      return snapshot.categories.filter(
        (c) => c.nhom === 'chi' && c.kieu_tinh === 'theo_thang'
      );
    }
    return snapshot.categories;
  }, [kind, mang, snapshot.categories]);

  useEffect(() => {
    if (editingTx) return;
    if ((kind === 'chi' || kind === 'chi_phi_thang') && availableCategories.length > 0) {
      if (!availableCategories.some((c) => c.id === categoryId)) {
        setCategoryId(availableCategories[0].id);
        if (kind === 'chi_phi_thang') {
          setMang(availableCategories[0].mang_mac_dinh);
        }
      }
    }
    if (kind === 'truong_chuyen' && moDiepWallet) {
      setWalletId(moDiepWallet.id);
    }
    if (kind === 'chuyen_quy' && chiNhanWallet && cashWallet) {
      setWalletId(chiNhanWallet.id);
      setToWalletId(cashWallet.id);
    }
  }, [kind, availableCategories, categoryId, editingTx, moDiepWallet, chiNhanWallet, cashWallet]);

  // --- 4. STATE CHẤM CÔNG ---
  const activeWorkers = useMemo(
    () => snapshot.workers.filter((w) => w.dang_lam),
    [snapshot.workers]
  );
  const [congMap, setCongMap] = useState<Record<string, 0 | 0.5 | 1>>({});

  useEffect(() => {
    if (kind !== 'cham_cong') return;
    const next: Record<string, 0 | 0.5 | 1> = {};
    for (const w of activeWorkers) {
      const saved = snapshot.attendance.find(
        (a) => a.worker_id === w.id && a.ngay === ngay
      );
      next[w.id] = (saved?.so_cong as 0 | 0.5 | 1 | undefined) ?? 1;
    }
    setCongMap(next);
  }, [kind, ngay, activeWorkers, snapshot.attendance]);

  // Dữ liệu công nợ / dự kiến của kỳ đang chọn
  const debtSummary = useMemo(
    () => computeDebtAndPayables(snapshot, kyThang),
    [snapshot, kyThang]
  );

  // Doanh thu suất vãng lai của ngày đang chọn (phục vụ Cách A Thu cuối ngày)
  const dayMealRev = useMemo(
    () => computeDailyMealRevenue(snapshot.mealCounts, snapshot.mealPrices, bookId, ngay),
    [snapshot.mealCounts, snapshot.mealPrices, bookId, ngay]
  );

  if (!session) return null;

  // --- XỬ LÝ TẠO THẺ XÁC NHẬN CHO TỪNG FORM ---
  const handlePrepareConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const dateLabel = formatVietnameseDate(ngay);

    // 1. SUẤT ĂN
    if (kind === 'suat_an') {
      const periods: MealPeriod[] = ['sang', 'trua', 'toi'];
      let tongSuatTr = 0;
      let tongSuatVl = 0;
      let tongTien = 0;
      const rows: ConfirmationPreviewData['rows'] = [];

      for (const bua of periods) {
        const st = meals[bua].truong;
        const svl = meals[bua].vang_lai;
        const dgTr = getEffectiveMealPrice(snapshot.mealPrices, bookId, bua, 'truong', ngay);
        const dgVl = getEffectiveMealPrice(snapshot.mealPrices, bookId, bua, 'vang_lai', ngay);
        tongSuatTr += st;
        tongSuatVl += svl;
        const thanhTien = st * dgTr + svl * dgVl;
        tongTien += thanhTien;
        if (st > 0 || svl > 0) {
          rows.push({
            label: PERIOD_LABELS[bua],
            value: `${st} trường${svl > 0 ? ` + ${svl} vãng lai` : ''} (${formatVND(thanhTien)})`,
          });
        }
      }

      if (tongSuatTr === 0 && tongSuatVl === 0) {
        setFormError('Ông/bà nhập ít nhất 1 bữa ăn trước khi lưu nhé!');
        return;
      }

      const prevRecords = snapshot.mealCounts.filter(
        (m) => m.book_id === bookId && m.ngay === ngay
      );

      setConfirmState({
        preview: {
          badge: '🍚 BÁO SUẤT ĂN HÔM NAY',
          tone: 'info',
          title: `Suất ăn ${snapshot.book.ten}`,
          headlineAmount: tongTien,
          headlineSubtext: `Trường: ${tongSuatTr} suất${
            tongSuatVl > 0 ? ` · Vãng lai: ${tongSuatVl} suất` : ''
          }`,
          dateLabel,
          rows,
          bookImpactNote:
            '📒 Tính ngay vào Doanh thu Bếp ăn hôm nay · 📕 Suất trường cộng vào Tiền trường dự kiến về cuối tháng (chưa cộng ví tiền mặt).',
          spokenText: `Ghi suất ăn ngày ${ngay}: ${tongSuatTr} suất trường${
            tongSuatVl > 0 ? ` và ${tongSuatVl} suất vãng lai` : ''
          }, tổng thành tiền ${formatCompactVND(tongTien)}. Đúng chưa ạ?`,
        },
        commitFn: async () => {
          for (const bua of periods) {
            await dbRepo.upsertMealCount(session, {
              book_id: bookId,
              ngay,
              bua,
              suat_truong: meals[bua].truong,
              suat_vang_lai: meals[bua].vang_lai,
              ghi_chu: ghiChu,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            });
          }
          return {
            message: `Đã lưu ${tongSuatTr} suất trường${
              tongSuatVl > 0 ? ` + ${tongSuatVl} vãng lai` : ''
            }`,
            undoFn: async () => {
              for (const bua of periods) {
                const old = prevRecords.find((r) => r.bua === bua);
                await dbRepo.upsertMealCount(session, {
                  book_id: bookId,
                  ngay,
                  bua,
                  suat_truong: old?.suat_truong ?? 0,
                  suat_vang_lai: old?.suat_vang_lai ?? 0,
                  ghi_chu: old?.ghi_chu ?? '',
                  nguon: old?.nguon ?? 'tay',
                  nguoi_tao: session.profile_id,
                });
              }
            },
          };
        },
      });
      return;
    }

    // 2. THU CUỐI NGÀY (CÁCH A)
    if (kind === 'thu_cuoi_ngay') {
      const tongQuay = thuTienMat + thuChuyenKhoan;
      if (tongQuay <= 0) {
        setFormError('Vui lòng nhập số Tiền mặt hoặc Chuyển khoản thu được cuối ngày.');
        return;
      }
      const tienVangLai = dayMealRev.doanh_thu_vang_lai;
      const doanhThuCanTin = Math.max(0, tongQuay - tienVangLai);

      setConfirmState({
        preview: {
          badge: '💵 TỔNG THU CUỐI NGÀY',
          tone: 'income',
          title: 'Thu tiền mặt & CK Chị Nhàn cuối ngày',
          headlineAmount: tongQuay,
          dateLabel,
          rows: [
            { label: 'Tiền mặt đếm được', value: formatVND(thuTienMat), highlight: true },
            { label: 'CK về TK Chị Nhàn', value: formatVND(thuChuyenKhoan), highlight: true },
            { label: 'Trừ tiền suất vãng lai hôm nay', value: `-${formatVND(tienVangLai)}` },
            { label: '→ Doanh thu Căn tin còn lại', value: formatVND(doanhThuCanTin), highlight: true },
          ],
          bookImpactNote: `💰 Ví Tiền mặt +${formatVND(thuTienMat)}, TK Chị Nhàn +${formatVND(
            thuChuyenKhoan
          )} · 📒 Tự tách ${formatVND(tienVangLai)} vãng lai cho Bếp ăn, ${formatVND(
            doanhThuCanTin
          )} cho Căn tin.`,
          spokenText: `Ghi tổng thu cuối ngày ${formatCompactVND(
            tongQuay
          )}, gồm tiền mặt ${formatCompactVND(
            thuTienMat
          )} và chuyển khoản chị Nhàn ${formatCompactVND(thuChuyenKhoan)}. Đúng chưa ạ?`,
        },
        commitFn: async () => {
          const { createdIds, replacedIds } = await dbRepo.saveDailyCollection(session, {
            book_id: bookId,
            ngay,
            tien_mat: thuTienMat,
            chuyen_khoan: thuChuyenKhoan,
            ghi_chu: ghiChu,
            nguon: 'tay',
          });
          return {
            message: `Đã lưu thu cuối ngày ${formatVND(tongQuay)}`,
            undoFn: async () => {
              for (const cid of createdIds) {
                await dbRepo.softDeleteTransaction(session, bookId, cid);
              }
              for (const rid of replacedIds) {
                await dbRepo.restoreTransaction(session, bookId, rid);
              }
            },
          };
        },
      });
      return;
    }

    // 4. CHẤM CÔNG THỢ
    if (kind === 'cham_cong') {
      if (activeWorkers.length === 0) {
        setFormError('Chưa có công nhân nào trong danh sách. Hãy thêm ở Cài đặt.');
        return;
      }
      const tongCong = activeWorkers.reduce((s, w) => s + (congMap[w.id] ?? 0), 0);
      const tongTienCong = activeWorkers.reduce(
        (s, w) => s + (congMap[w.id] ?? 0) * w.luong_ngay,
        0
      );
      const prevAtt = snapshot.attendance.filter(
        (a) => a.book_id === bookId && a.ngay === ngay
      );

      setConfirmState({
        preview: {
          badge: '👷 CHẤM CÔNG PHỤ BẾP',
          tone: 'info',
          title: `Chấm công ngày (${tongCong} công)`,
          headlineAmount: tongTienCong,
          dateLabel,
          rows: activeWorkers.map((w) => {
            const c = congMap[w.id] ?? 0;
            const labelVal =
              c === 1
                ? `Đủ công (${formatVND(w.luong_ngay)})`
                : c === 0.5
                ? `Nửa công (${formatVND(w.luong_ngay * 0.5)})`
                : 'Nghỉ (0 đ)';
            return { label: w.ho_ten, value: labelVal, highlight: c > 0 };
          }),
          bookImpactNote:
            '📒 Trừ vào chi phí Bếp ăn hôm nay để tính đúng lãi ngày · 📕 Cộng vào Lương thợ phải trả cuối tháng (chưa trừ tiền mặt).',
          spokenText: `Ghi chấm công hôm nay tổng cộng ${tongCong} công, thành tiền ${formatCompactVND(
            tongTienCong
          )}. Đúng chưa ạ?`,
        },
        commitFn: async () => {
          for (const w of activeWorkers) {
            await dbRepo.upsertAttendance(session, {
              book_id: bookId,
              worker_id: w.id,
              ngay,
              so_cong: congMap[w.id] ?? 0,
              don_gia_cong: w.luong_ngay,
              ghi_chu: ghiChu,
            });
          }
          return {
            message: `Đã lưu chấm công (${tongCong} công — ${formatVND(tongTienCong)})`,
            undoFn: async () => {
              for (const w of activeWorkers) {
                const old = prevAtt.find((a) => a.worker_id === w.id);
                await dbRepo.upsertAttendance(session, {
                  book_id: bookId,
                  worker_id: w.id,
                  ngay,
                  so_cong: old?.so_cong ?? 0,
                  don_gia_cong: old?.don_gia_cong ?? w.luong_ngay,
                  ghi_chu: old?.ghi_chu ?? '',
                });
              }
            },
          };
        },
      });
      return;
    }

    // Các giao dịch có số tiền còn lại: kiểm tra soTien > 0
    if (soTien <= 0) {
      setFormError('Ông/bà nhập số tiền lớn hơn 0 giúp con nhé!');
      return;
    }

    const persistOrUpdateTx = async (
      payload: Omit<Transaction, 'id' | 'timestamp' | 'da_xoa'>,
      labelMsg: string
    ): Promise<UndoState> => {
      if (editingTx) {
        const prevCopy = { ...editingTx };
        await dbRepo.updateTransaction(session, {
          ...editingTx,
          ...payload,
        });
        return {
          message: `Đã cập nhật ${labelMsg}`,
          undoFn: async () => {
            await dbRepo.updateTransaction(session, prevCopy);
          },
        };
      }
      const saved = await dbRepo.addTransaction(session, payload);
      return {
        message: `Đã lưu ${labelMsg}`,
        undoFn: async () => {
          await dbRepo.softDeleteTransaction(session, bookId, saved.id);
        },
      };
    };

    // 3 & 8. CHI MUA ĐỒ HẰNG NGÀY HOẶC CHI PHÍ CUỐI THÁNG (hoặc SỬA GIAO DỊCH CHI)
    if (kind === 'chi' || kind === 'chi_phi_thang') {
      const cat = snapshot.categories.find((c) => c.id === categoryId);
      if (!cat) {
        setFormError('Vui lòng chọn danh mục chi tiêu.');
        return;
      }

      const isGhiNo = hinhThucTra === 'ghi_no';
      let targetSupplierId = supplierId;
      let targetSupplierName =
        snapshot.suppliers.find((s) => s.id === supplierId)?.ten_ncc ?? '';

      if (isGhiNo) {
        if (addingNewSupplier) {
          if (!newSupplierName.trim()) {
            setFormError('Vui lòng nhập tên người bán để ghi vào Sổ nợ.');
            return;
          }
          targetSupplierName = newSupplierName.trim();
        } else if (!targetSupplierId) {
          setFormError('Vui lòng chọn mối hàng mua chịu hoặc bấm "+ Thêm mối mới".');
          return;
        }
      }

      const selectedWallet = snapshot.wallets.find((w) => w.id === walletId);
      const effectiveMang: BusinessSegment =
        kind === 'chi_phi_thang' ? cat.mang_mac_dinh : mang;
      const mangLabel =
        effectiveMang === 'bep_an'
          ? '🍲 Bếp ăn'
          : effectiveMang === 'can_tin'
          ? '🏪 Căn tin'
          : '🏠 Dùng chung cả cơ sở';

      setConfirmState({
        preview: {
          badge: isGhiNo
            ? '📕 MUA CHỊU (GHI SỔ NỢ)'
            : kind === 'chi_phi_thang'
            ? `⚡ CHI PHÍ THÁNG ${kyThang}`
            : '🥩 CHI TIỀN TRẢ LUÔN',
          tone: isGhiNo ? 'debt' : 'expense',
          title: `${cat.icon} ${cat.ten_danh_muc}`,
          headlineAmount: soTien,
          dateLabel,
          rows: [
            { label: 'Mảng tính chi phí', value: mangLabel },
            ...(kind === 'chi_phi_thang'
              ? [{ label: 'Tính vào lợi nhuận tháng', value: kyThang, highlight: true }]
              : []),
            isGhiNo
              ? { label: 'Ghi nợ người bán', value: targetSupplierName, highlight: true }
              : {
                  label: 'Trừ từ ví',
                  value: selectedWallet?.ten_vi ?? 'Tiền mặt',
                  highlight: true,
                },
            ...(ghiChu ? [{ label: 'Ghi chú', value: ghiChu }] : []),
          ],
          bookImpactNote: isGhiNo
            ? `📒 Tính vào chi phí ${
                kind === 'chi_phi_thang' ? `tháng ${kyThang}` : 'hôm nay'
              } · 📕 Ghi nợ ${targetSupplierName} +${formatVND(
                soTien
              )} · 💰 Tiền trong ví giữ nguyên.`
            : `📒 Tính vào chi phí ${
                kind === 'chi_phi_thang' ? `tháng ${kyThang}` : 'hôm nay'
              } · 💰 Trừ ${selectedWallet?.ten_vi ?? 'ví'} -${formatVND(soTien)}.`,
          spokenText: `Ghi chi ${cat.ten_danh_muc} ${formatCompactVND(soTien)}, ${
            isGhiNo
              ? `mua chịu ghi nợ ${targetSupplierName}`
              : `trả từ ${selectedWallet?.ten_vi ?? 'tiền mặt'}`
          }. Đúng chưa ạ?`,
        },
        commitFn: async () => {
          if (isGhiNo && addingNewSupplier && newSupplierName.trim()) {
            const createdSup = await dbRepo.upsertSupplier(session, {
              book_id: bookId,
              ten_ncc: newSupplierName.trim(),
              mat_hang_chinh: cat.ten_danh_muc,
              no_dau_ky: 0,
              dang_giao_dich: true,
            });
            targetSupplierId = createdSup.id;
          }

          return persistOrUpdateTx(
            {
              book_id: bookId,
              ngay,
              mang: effectiveMang,
              loai: isGhiNo ? 'chi_no' : 'chi',
              category_id: cat.id,
              so_tien: soTien,
              wallet_id: isGhiNo ? null : walletId,
              supplier_id: isGhiNo ? targetSupplierId : null,
              ky_thang: kind === 'chi_phi_thang' ? kyThang : null,
              ghi_chu: ghiChu || cat.ten_danh_muc,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            },
            `${cat.ten_danh_muc} (${formatVND(soTien)})`
          );
        },
      });
      return;
    }

    // 5. TRẢ NỢ NHÀ CUNG CẤP
    if (kind === 'tra_no') {
      const supItem = debtSummary.nha_cung_cap.danh_sach.find(
        (d) => d.supplier.id === supplierId
      );
      if (!supItem) {
        setFormError('Vui lòng chọn mối hàng cần trả nợ.');
        return;
      }
      const selectedWallet = snapshot.wallets.find((w) => w.id === walletId);
      const conLaiSauTra = Math.max(0, supItem.con_no - soTien);

      setConfirmState({
        preview: {
          badge: '🤝 TRẢ NỢ MỐI HÀNG',
          tone: 'expense',
          title: `Trả nợ: ${supItem.supplier.ten_ncc}`,
          headlineAmount: soTien,
          dateLabel,
          rows: [
            { label: 'Đang nợ trước khi trả', value: formatVND(supItem.con_no) },
            { label: 'Trả từ ví', value: selectedWallet?.ten_vi ?? 'Tiền mặt', highlight: true },
            { label: 'Còn nợ lại sau khi trả', value: formatVND(conLaiSauTra), highlight: true },
          ],
          bookImpactNote: `💰 Trừ ${selectedWallet?.ten_vi} -${formatVND(
            soTien
          )} · 📕 Giảm nợ ${supItem.supplier.ten_ncc} · 📒 Không trừ lặp lại vào Lãi lỗ.`,
          spokenText: `Ghi trả nợ ${supItem.supplier.ten_ncc} ${formatCompactVND(
            soTien
          )}, còn nợ lại ${formatCompactVND(conLaiSauTra)}. Đúng chưa ạ?`,
        },
        commitFn: () =>
          persistOrUpdateTx(
            {
              book_id: bookId,
              ngay,
              mang: 'chung',
              loai: 'tra_no',
              category_id: 'cat_tra_no_ncc',
              so_tien: soTien,
              wallet_id: walletId,
              supplier_id: supItem.supplier.id,
              ghi_chu: ghiChu || `Trả nợ ${supItem.supplier.ten_ncc}`,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            },
            `trả nợ ${supItem.supplier.ten_ncc} ${formatVND(soTien)}`
          ),
      });
      return;
    }

    // 6. TRƯỜNG CHUYỂN TIỀN ĂN
    if (kind === 'truong_chuyen') {
      const selectedWallet = snapshot.wallets.find((w) => w.id === walletId);
      setConfirmState({
        preview: {
          badge: '🏫 TRƯỜNG CHUYỂN TIỀN ĂN',
          tone: 'income',
          title: `Nhận tiền ăn kỳ tháng ${kyThang}`,
          headlineAmount: soTien,
          dateLabel,
          rows: [
            { label: 'Tiền vào tài khoản', value: selectedWallet?.ten_vi ?? 'TK Mợ Diệp', highlight: true },
            {
              label: `Dự kiến theo suất tháng ${kyThang}`,
              value: formatVND(debtSummary.tien_truong_ky_nay.so_tien_du_kien),
            },
            ...(ghiChu ? [{ label: 'Ghi chú', value: ghiChu }] : []),
          ],
          bookImpactNote: `💰 Cộng +${formatVND(soTien)} vào ${
            selectedWallet?.ten_vi
          } · 🔔 Đánh dấu trường đã chuyển tiền kỳ ${kyThang} (không cộng trùng vào Lãi lỗ).`,
          spokenText: `Ghi nhận nhà trường chuyển tiền ăn kỳ tháng ${kyThang} số tiền ${formatCompactVND(
            soTien
          )} vào ${selectedWallet?.ten_vi}. Đúng chưa ạ?`,
        },
        commitFn: () =>
          persistOrUpdateTx(
            {
              book_id: bookId,
              ngay,
              mang: 'bep_an',
              loai: 'truong_chuyen',
              category_id: 'cat_truong_chuyen',
              so_tien: soTien,
              wallet_id: walletId,
              ky_thang: kyThang,
              ghi_chu: ghiChu || `Nhà trường chuyển tiền ăn kỳ ${kyThang}`,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            },
            `trường chuyển ${formatVND(soTien)}`
          ),
      });
      return;
    }

    // 7. TRẢ / ỨNG LƯƠNG CÔNG NHÂN
    if (kind === 'tra_luong') {
      const selectedWallet = snapshot.wallets.find((w) => w.id === walletId);
      const selectedWorker = snapshot.workers.find((w) => w.id === workerId);
      const titleText = selectedWorker
        ? `Trả/ứng lương: ${selectedWorker.ho_ten}`
        : `Trả lương đội phụ bếp kỳ ${kyThang}`;

      setConfirmState({
        preview: {
          badge: '💰 TRẢ LƯƠNG PHỤ BẾP',
          tone: 'expense',
          title: titleText,
          headlineAmount: soTien,
          dateLabel,
          rows: [
            { label: 'Kỳ lương tháng', value: kyThang, highlight: true },
            { label: 'Người nhận', value: selectedWorker?.ho_ten ?? 'Cả đội phụ bếp' },
            { label: 'Chi từ ví', value: selectedWallet?.ten_vi ?? 'Tiền mặt', highlight: true },
          ],
          bookImpactNote: `💰 Trừ ${selectedWallet?.ten_vi} -${formatVND(
            soTien
          )} · 📕 Giảm lương còn phải trả kỳ ${kyThang} (không trừ trùng vào Lãi lỗ ngày).`,
          spokenText: `Ghi trả lương kỳ ${kyThang} số tiền ${formatCompactVND(soTien)} từ ${
            selectedWallet?.ten_vi
          }. Đúng chưa ạ?`,
        },
        commitFn: () =>
          persistOrUpdateTx(
            {
              book_id: bookId,
              ngay,
              mang: 'bep_an',
              loai: 'tra_luong',
              category_id: 'cat_tra_luong',
              so_tien: soTien,
              wallet_id: walletId,
              worker_id: workerId || null,
              ky_thang: kyThang,
              ghi_chu: ghiChu || titleText,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            },
            `trả lương ${formatVND(soTien)}`
          ),
      });
      return;
    }

    // 9. CHUYỂN QUỸ NỘI BỘ
    if (kind === 'chuyen_quy') {
      if (walletId === toWalletId) {
        setFormError('Ví chuyển đi và ví nhận về phải khác nhau.');
        return;
      }
      const fromW = snapshot.wallets.find((w) => w.id === walletId);
      const toW = snapshot.wallets.find((w) => w.id === toWalletId);

      setConfirmState({
        preview: {
          badge: '🔄 CHUYỂN QUỸ / RÚT TIỀN',
          tone: 'info',
          title: `${fromW?.ten_vi} → ${toW?.ten_vi}`,
          headlineAmount: soTien,
          dateLabel,
          rows: [
            { label: 'Rút ra từ', value: fromW?.ten_vi ?? '', highlight: true },
            { label: 'Đưa vào', value: toW?.ten_vi ?? '', highlight: true },
            ...(ghiChu ? [{ label: 'Ghi chú', value: ghiChu }] : []),
          ],
          bookImpactNote: `💰 ${fromW?.ten_vi} -${formatVND(soTien)}, ${
            toW?.ten_vi
          } +${formatVND(soTien)} · 📒 Lãi lỗ không thay đổi.`,
          spokenText: `Chuyển ${formatCompactVND(soTien)} từ ${fromW?.ten_vi} sang ${
            toW?.ten_vi
          }. Đúng chưa ạ?`,
        },
        commitFn: () =>
          persistOrUpdateTx(
            {
              book_id: bookId,
              ngay,
              mang: 'chung',
              loai: 'chuyen_quy',
              category_id: 'cat_chuyen_quy',
              so_tien: soTien,
              wallet_id: walletId,
              to_wallet_id: toWalletId,
              ghi_chu: ghiChu || `Chuyển từ ${fromW?.ten_vi} sang ${toW?.ten_vi}`,
              nguon: 'tay',
              nguoi_tao: session.profile_id,
            },
            `chuyển quỹ ${formatVND(soTien)}`
          ),
      });
    }
  };

  const handleConfirmSave = async () => {
    if (!confirmState) return;
    setSaving(true);
    try {
      const undo = await confirmState.commitFn();
      await onSaved(undo);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Có lỗi khi lưu sổ');
      setConfirmState(null);
    } finally {
      setSaving(false);
    }
  };

  // Nếu đang ở bước hiện Thẻ xác nhận
  if (confirmState) {
    return (
      <ConfirmationCard
        data={confirmState.preview}
        saving={saving}
        onConfirm={handleConfirmSave}
        onEdit={() => setConfirmState(null)}
      />
    );
  }

  const prevMealHint = kind === 'suat_an' ? findPreviousMealDay(snapshot.mealCounts, bookId, ngay) : null;

  return (
    <form
      onSubmit={handlePrepareConfirm}
      className="rounded-3xl bg-white border-2 border-stone-300 p-4 shadow-sm space-y-4"
    >
      {/* Nút quay lại */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-200">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold text-lg"
        >
          <ArrowLeft className="w-5 h-5" />
          Đóng
        </button>
        <input
          type="date"
          value={ngay}
          onChange={(e) => setNgay(e.target.value)}
          className="rounded-xl border-2 border-stone-300 px-3 py-1.5 font-bold text-base text-stone-900"
        />
      </div>

      {/* --- GIAO DIỆN FORM 1: BÁO SUẤT ĂN --- */}
      {kind === 'suat_an' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-2xl font-extrabold text-teal-900">🍚 Báo suất ăn trong ngày</h3>
            {prevMealHint && (
              <button
                type="button"
                onClick={() => {
                  setMeals((prev) => ({
                    sang: { ...prev.sang, truong: prevMealHint.sang },
                    trua: { ...prev.trua, truong: prevMealHint.trua },
                    toi: { ...prev.toi, truong: prevMealHint.toi },
                  }));
                  setCopiedFromDate(prevMealHint.ngay);
                }}
                className="px-4 py-2.5 rounded-2xl bg-amber-100 border-2 border-amber-500 text-amber-950 font-extrabold text-lg inline-flex items-center gap-2 active:bg-amber-200"
              >
                <Copy className="w-5 h-5" />
                Giống hôm trước ({prevMealHint.ngay.slice(8, 10)}/{prevMealHint.ngay.slice(5, 7)})
              </button>
            )}
          </div>

          {copiedFromDate && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 px-3.5 py-2 text-base font-semibold text-amber-900">
              ✓ Đã chép số suất trường từ ngày {copiedFromDate}. Ông/bà chỉnh lại nếu hôm nay tăng/giảm nhé!
            </div>
          )}

          {(['sang', 'trua', 'toi'] as MealPeriod[]).map((bua) => {
            const dgTr = getEffectiveMealPrice(snapshot.mealPrices, bookId, bua, 'truong', ngay);
            const dgVl = getEffectiveMealPrice(snapshot.mealPrices, bookId, bua, 'vang_lai', ngay);
            return (
              <div
                key={bua}
                className="rounded-2xl bg-stone-50 border-2 border-stone-200 p-3.5 space-y-2.5"
              >
                <div className="font-extrabold text-xl text-stone-900">{PERIOD_LABELS[bua]}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-base font-bold text-stone-700 mb-1">
                      Suất trường ({formatVND(dgTr)})
                    </label>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={meals[bua].truong || ''}
                      placeholder="0"
                      onChange={(e) =>
                        setMeals((prev) => ({
                          ...prev,
                          [bua]: { ...prev[bua], truong: Math.max(0, Number(e.target.value || 0)) },
                        }))
                      }
                      className="w-full rounded-xl border-2 border-stone-400 bg-white px-3 py-2.5 text-2xl font-extrabold text-stone-950"
                    />
                  </div>
                  <div>
                    <label className="block text-base font-bold text-stone-700 mb-1">
                      Vãng lai ({formatVND(dgVl)})
                    </label>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={meals[bua].vang_lai || ''}
                      placeholder="0"
                      onChange={(e) =>
                        setMeals((prev) => ({
                          ...prev,
                          [bua]: {
                            ...prev[bua],
                            vang_lai: Math.max(0, Number(e.target.value || 0)),
                          },
                        }))
                      }
                      className="w-full rounded-xl border-2 border-stone-400 bg-white px-3 py-2.5 text-2xl font-extrabold text-stone-950"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- GIAO DIỆN FORM 2: THU CUỐI NGÀY (CÁCH A) --- */}
      {kind === 'thu_cuoi_ngay' && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-emerald-900">
            💵 Thu tiền cuối ngày (Căn tin + Vãng lai)
          </h3>
          {hasExistingCollection && (
            <div className="rounded-xl bg-amber-50 border border-amber-400 p-3 text-base font-semibold text-amber-950">
              Ngày này đã có số thu cuối ngày — bấm Lưu sẽ cập nhật thành số mới (không bị cộng trùng).
            </div>
          )}

          <MoneyInput
            label="1. Tiền mặt đếm được cuối ngày"
            value={thuTienMat}
            onChange={setThuTienMat}
          />
          <MoneyInput
            label={`2. Chuyển khoản về ${chiNhanWallet?.ten_vi ?? 'TK Chị Nhàn'}`}
            value={thuChuyenKhoan}
            onChange={setThuChuyenKhoan}
          />

          <div className="rounded-2xl bg-emerald-50 border border-emerald-300 p-3.5 space-y-1 text-base">
            <div className="flex justify-between font-bold text-stone-800">
              <span>Tổng tiền thực thu vào ví:</span>
              <span>{formatVND(thuTienMat + thuChuyenKhoan)}</span>
            </div>
            <div className="flex justify-between text-stone-700">
              <span>Trừ tiền suất vãng lai hôm nay ({dayMealRev.suat_vang_lai} suất):</span>
              <span>-{formatVND(dayMealRev.doanh_thu_vang_lai)}</span>
            </div>
            <div className="flex justify-between font-extrabold text-emerald-900 text-lg pt-1 border-t border-emerald-200">
              <span>→ Doanh thu Căn tin hôm nay:</span>
              <span>
                {formatVND(Math.max(0, thuTienMat + thuChuyenKhoan - dayMealRev.doanh_thu_vang_lai))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 3 & 8: CHI HẰNG NGÀY / CHI CUỐI THÁNG --- */}
      {(kind === 'chi' || kind === 'chi_phi_thang') && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-orange-900">
            {editingTx
              ? '✏️ Sửa khoản chi'
              : kind === 'chi_phi_thang'
              ? '⚡ Ghi chi phí cuối tháng (Điện, Nước, Gas, Gia vị)'
              : '🥩 Ghi tiền đi chợ / nhập hàng'}
          </h3>

          {kind === 'chi' && (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMang('bep_an')}
                className={`py-3 px-3 rounded-2xl border-2 font-extrabold text-lg ${
                  mang === 'bep_an'
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-stone-300 bg-stone-50 text-stone-800'
                }`}
              >
                🍲 Bếp ăn (Đi chợ)
              </button>
              <button
                type="button"
                onClick={() => setMang('can_tin')}
                className={`py-3 px-3 rounded-2xl border-2 font-extrabold text-lg ${
                  mang === 'can_tin'
                    ? 'border-amber-600 bg-amber-600 text-white'
                    : 'border-stone-300 bg-stone-50 text-stone-800'
                }`}
              >
                🏪 Căn tin (Nhập hàng)
              </button>
            </div>
          )}

          {kind === 'chi_phi_thang' && (
            <div>
              <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
                Tính vào lợi nhuận tháng nào?
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="month"
                  value={kyThang}
                  onChange={(e) => setKyThang(e.target.value)}
                  className="rounded-xl border-2 border-stone-400 px-3 py-2 text-lg font-extrabold"
                />
                <button
                  type="button"
                  onClick={() => setKyThang(getPreviousYearMonth(getYearMonth(ngay)))}
                  className="px-3.5 py-2 rounded-xl bg-stone-200 font-bold text-base text-stone-800"
                >
                  Chọn tháng trước ({getPreviousYearMonth(getYearMonth(ngay))})
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-2">
              Chọn mặt hàng / khoản chi:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {availableCategories.map((c) => {
                const selected = c.id === categoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      if (kind === 'chi_phi_thang') setMang(c.mang_mac_dinh);
                    }}
                    className={`p-3 rounded-2xl border-2 text-left flex items-center gap-2 font-bold text-base leading-snug ${
                      selected
                        ? 'border-teal-700 bg-teal-50 text-teal-950 ring-2 ring-teal-600'
                        : 'border-stone-300 bg-white text-stone-800'
                    }`}
                  >
                    <span className="text-2xl shrink-0">{c.icon}</span>
                    <span>{c.ten_danh_muc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <MoneyInput label="Số tiền" value={soTien} onChange={setSoTien} />

          {/* Công tắc Trả tiền luôn vs Mua chịu ghi nợ */}
          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-2">
              Thanh toán thế nào ạ?
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setHinhThucTra('tra_luon')}
                className={`py-3 px-3 rounded-2xl border-2 font-extrabold text-lg ${
                  hinhThucTra === 'tra_luon'
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-stone-300 bg-stone-50 text-stone-800'
                }`}
              >
                💵 Trả tiền luôn
              </button>
              <button
                type="button"
                onClick={() => setHinhThucTra('ghi_no')}
                className={`py-3 px-3 rounded-2xl border-2 font-extrabold text-lg ${
                  hinhThucTra === 'ghi_no'
                    ? 'border-rose-700 bg-rose-700 text-white'
                    : 'border-stone-300 bg-stone-50 text-stone-800'
                }`}
              >
                📕 Mua chịu (Ghi nợ)
              </button>
            </div>
          </div>

          {hinhThucTra === 'tra_luon' ? (
            <div>
              <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
                Lấy tiền từ ví nào?
              </label>
              <select
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold text-stone-900"
              >
                {snapshot.wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.ten_vi}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-2xl bg-rose-50 border border-rose-300 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-lg font-extrabold text-rose-950">
                  Ghi nợ mối hàng nào?
                </label>
                <button
                  type="button"
                  onClick={() => setAddingNewSupplier((v) => !v)}
                  className="text-base font-bold text-rose-800 underline inline-flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  {addingNewSupplier ? 'Chọn mối có sẵn' : 'Thêm mối mới'}
                </button>
              </div>

              {addingNewSupplier ? (
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="Nhập tên người bán (VD: Chị Hạnh bán cá)"
                  className="w-full rounded-xl border-2 border-rose-400 bg-white px-3.5 py-2.5 text-lg font-bold"
                />
              ) : (
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full rounded-xl border-2 border-rose-400 bg-white px-3.5 py-3 text-lg font-bold text-stone-900"
                >
                  {snapshot.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ten_ncc} ({s.mat_hang_chinh})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="block text-base font-bold text-stone-700 mb-1">
              Ghi chú thêm (không bắt buộc)
            </label>
            <input
              type="text"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              placeholder="VD: 5 cân thịt ba chỉ..."
              className="w-full rounded-xl border-2 border-stone-300 px-3.5 py-2.5 text-lg"
            />
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 4: CHẤM CÔNG THỢ --- */}
      {kind === 'cham_cong' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-2xl font-extrabold text-teal-900">👷 Chấm công hôm nay</h3>
            <button
              type="button"
              onClick={() => {
                const allFull: Record<string, 0 | 0.5 | 1> = {};
                for (const w of activeWorkers) allFull[w.id] = 1;
                setCongMap(allFull);
              }}
              className="px-3.5 py-2 rounded-xl bg-teal-100 text-teal-900 font-bold text-base"
            >
              Tất cả làm đủ
            </button>
          </div>

          <div className="space-y-3">
            {activeWorkers.map((w) => {
              const cur = congMap[w.id] ?? 1;
              return (
                <div
                  key={w.id}
                  className="rounded-2xl bg-stone-50 border-2 border-stone-200 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-extrabold text-stone-900">{w.ho_ten}</span>
                    <span className="text-base font-bold text-stone-600">
                      {formatVND(w.luong_ngay)}/ngày
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { val: 0, label: 'Nghỉ (0)' },
                        { val: 0.5, label: 'Nửa buổi' },
                        { val: 1, label: 'Đủ công' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() =>
                          setCongMap((prev) => ({ ...prev, [w.id]: opt.val }))
                        }
                        className={`py-2.5 rounded-xl border-2 font-extrabold text-base ${
                          cur === opt.val
                            ? opt.val === 0
                              ? 'border-stone-700 bg-stone-700 text-white'
                              : 'border-teal-700 bg-teal-700 text-white'
                            : 'border-stone-300 bg-white text-stone-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 5: TRẢ NỢ NHÀ CUNG CẤP --- */}
      {kind === 'tra_no' && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-rose-900">🤝 Trả nợ mối hàng</h3>
          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Chọn mối hàng cần trả:
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {debtSummary.nha_cung_cap.danh_sach.map((d) => (
                <option key={d.supplier.id} value={d.supplier.id}>
                  {d.supplier.ten_ncc} — Đang nợ: {formatVND(d.con_no)}
                </option>
              ))}
            </select>
          </div>

          {(() => {
            const curSup = debtSummary.nha_cung_cap.danh_sach.find(
              (d) => d.supplier.id === supplierId
            );
            return curSup && curSup.con_no > 0 ? (
              <button
                type="button"
                onClick={() => setSoTien(curSup.con_no)}
                className="w-full py-2.5 rounded-xl bg-rose-100 border-2 border-rose-500 text-rose-950 font-extrabold text-lg"
              >
                Bấm trả hết nợ: {formatVND(curSup.con_no)}
              </button>
            ) : null;
          })()}

          <MoneyInput label="Số tiền trả hôm nay" value={soTien} onChange={setSoTien} />

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Trả từ ví nào?
            </label>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {snapshot.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ten_vi}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 6: TRƯỜNG CHUYỂN TIỀN ĂN --- */}
      {kind === 'truong_chuyen' && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-sky-900">
            🏫 Nhà trường chuyển tiền ăn
          </h3>

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Tiền ăn của kỳ tháng nào?
            </label>
            <input
              type="month"
              value={kyThang}
              onChange={(e) => setKyThang(e.target.value)}
              className="rounded-xl border-2 border-stone-400 px-3.5 py-2 text-lg font-extrabold"
            />
          </div>

          <div className="rounded-2xl bg-sky-50 border border-sky-300 p-3.5 space-y-1.5 text-base">
            <div className="flex justify-between">
              <span>Tổng suất trường đã báo kỳ {kyThang}:</span>
              <strong>{debtSummary.tien_truong_ky_nay.tong_suat_truong} suất</strong>
            </div>
            <div className="flex justify-between">
              <span>Số tiền dự kiến:</span>
              <strong>{formatVND(debtSummary.tien_truong_ky_nay.so_tien_du_kien)}</strong>
            </div>
            <div className="flex justify-between text-sky-950 font-extrabold text-lg pt-1 border-t border-sky-200">
              <span>Còn chờ trường chuyển:</span>
              <span>{formatVND(debtSummary.tien_truong_ky_nay.con_cho_chuyen)}</span>
            </div>
            {debtSummary.tien_truong_ky_nay.con_cho_chuyen > 0 && (
              <button
                type="button"
                onClick={() => setSoTien(debtSummary.tien_truong_ky_nay.con_cho_chuyen)}
                className="w-full mt-2 py-2 rounded-xl bg-sky-700 text-white font-bold text-base"
              >
                Điền đúng bằng số dự kiến ({formatVND(debtSummary.tien_truong_ky_nay.con_cho_chuyen)})
              </button>
            )}
          </div>

          <MoneyInput label="Số tiền trường thực chuyển về" value={soTien} onChange={setSoTien} />

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Nhận vào tài khoản nào?
            </label>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {snapshot.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ten_vi}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 7: TRẢ / ỨNG LƯƠNG CÔNG NHÂN --- */}
      {kind === 'tra_luong' && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-amber-900">💰 Trả / ứng lương phụ bếp</h3>
          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Lương của kỳ tháng nào?
            </label>
            <input
              type="month"
              value={kyThang}
              onChange={(e) => setKyThang(e.target.value)}
              className="rounded-xl border-2 border-stone-400 px-3.5 py-2 text-lg font-extrabold"
            />
          </div>

          <div className="rounded-2xl bg-amber-50 border border-amber-300 p-3.5 space-y-2 text-base">
            <div className="font-bold text-amber-950">
              Bảng công tạm tính kỳ {kyThang}: Còn phải trả{' '}
              {formatVND(debtSummary.luong_tho_ky_nay.con_phai_tra)}
            </div>
            {debtSummary.luong_tho_ky_nay.chi_tiet_tho.map((item) => (
              <div key={item.worker.id} className="flex justify-between text-stone-800">
                <span>
                  • {item.worker.ho_ten} ({item.tong_cong} công):
                </span>
                <strong>Còn {formatVND(item.con_lai)}</strong>
              </div>
            ))}
            {debtSummary.luong_tho_ky_nay.con_phai_tra > 0 && (
              <button
                type="button"
                onClick={() => {
                  setWorkerId('');
                  setSoTien(debtSummary.luong_tho_ky_nay.con_phai_tra);
                }}
                className="w-full mt-1 py-2 rounded-xl bg-amber-600 text-white font-bold text-base"
              >
                Điền tổng lương còn lại ({formatVND(debtSummary.luong_tho_ky_nay.con_phai_tra)})
              </button>
            )}
          </div>

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Trả cho ai?
            </label>
            <select
              value={workerId}
              onChange={(e) => {
                const wid = e.target.value;
                setWorkerId(wid);
                const found = debtSummary.luong_tho_ky_nay.chi_tiet_tho.find(
                  (x) => x.worker.id === wid
                );
                if (found && found.con_lai > 0) setSoTien(found.con_lai);
              }}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              <option value="">Trả gộp cả đội phụ bếp</option>
              {snapshot.workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ho_ten}
                </option>
              ))}
            </select>
          </div>

          <MoneyInput label="Số tiền thực trả" value={soTien} onChange={setSoTien} />

          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Chi từ ví nào?
            </label>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {snapshot.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ten_vi}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* --- GIAO DIỆN FORM 9: CHUYỂN QUỸ NỘI BỘ --- */}
      {kind === 'chuyen_quy' && (
        <div className="space-y-4">
          <h3 className="text-2xl font-extrabold text-teal-900">
            🔄 Chuyển tiền giữa các ví / Rút tiền mặt
          </h3>
          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Rút ra từ ví:
            </label>
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {snapshot.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ten_vi}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-lg font-extrabold text-stone-900 mb-1.5">
              Đưa sang ví:
            </label>
            <select
              value={toWalletId}
              onChange={(e) => setToWalletId(e.target.value)}
              className="w-full rounded-2xl border-2 border-stone-400 bg-white px-3.5 py-3 text-lg font-bold"
            >
              {snapshot.wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ten_vi}
                </option>
              ))}
            </select>
          </div>

          <MoneyInput label="Số tiền chuyển" value={soTien} onChange={setSoTien} />
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="rounded-2xl bg-red-100 border-2 border-red-500 p-3.5 text-red-900 font-bold text-lg"
        >
          {formError}
        </div>
      )}

      <button
        type="submit"
        className="w-full min-h-15 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xl py-3.5 shadow-sm"
      >
        Tiếp tục → Xem thẻ kiểm tra
      </button>
    </form>
  );
};
