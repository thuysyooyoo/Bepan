import React from 'react';
import { ChevronRight, TrendingUp, TrendingDown, Wallet, BookMarked } from 'lucide-react';
import {
  computeDailyReport,
  computeDebtAndPayables,
  computeWalletBalances,
} from '../domain/accounting';
import { formatCompactVND, formatVietnameseDate, formatVND, getYearMonth } from '../domain/format';
import type { BookSnapshot } from '../types/models';

interface RollyOverviewBannerProps {
  snapshot: BookSnapshot;
  selectedDate: string;
  onOpenProfit: () => void;
  onOpenWallets: () => void;
  onOpenDebts: () => void;
}

export const RollyOverviewBanner: React.FC<RollyOverviewBannerProps> = ({
  snapshot,
  selectedDate,
  onOpenProfit,
  onOpenWallets,
  onOpenDebts,
}) => {
  const daily = computeDailyReport(snapshot, selectedDate);
  const kyThang = getYearMonth(selectedDate);
  const debt = computeDebtAndPayables(snapshot, kyThang);
  const wallets = computeWalletBalances(snapshot.wallets, snapshot.transactions, snapshot.book.id);
  const totalCash = wallets.reduce((s, w) => s + w.so_du_hien_tai, 0);

  const laiNgay = daily.bep_an.lai_uoc_tinh_ngay;
  const tongThuNgay = daily.bep_an.tong_doanh_thu + daily.can_tin.doanh_thu_can_tin;
  const tongChiNgay = daily.bep_an.tong_chi_ngay + daily.can_tin.chi_nhap_hang_ngay;

  const isProfitPositive = laiNgay >= 0;

  return (
    <div className="rounded-2xl bg-white border border-stone-200 p-2.5 shadow-xs space-y-2">
      {/* 1. KHỐI LÃI HÔM NAY (Chạm vào mở xem Lãi Lỗ chi tiết) */}
      <button
        type="button"
        onClick={onOpenProfit}
        className="w-full text-left p-2.5 rounded-xl bg-stone-50 hover:bg-stone-100 border border-stone-200 transition active:scale-[0.99] space-y-0.5"
      >
        <div className="flex items-center justify-between text-[11px] font-bold text-stone-500 uppercase tracking-wide">
          <span>Hôm nay · {formatVietnameseDate(selectedDate)}</span>
          <span className="inline-flex items-center gap-0.5 text-stone-400 font-semibold text-[11px]">
            Chi tiết <ChevronRight className="w-3 h-3" />
          </span>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-bold text-stone-600">Lãi ước tính:</div>
          <div
            className={`text-xl font-black inline-flex items-center gap-1 ${
              isProfitPositive ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {isProfitPositive ? (
              <TrendingUp className="w-4 h-4 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 shrink-0" />
            )}
            <span>{formatVND(laiNgay, true)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] font-semibold text-stone-500 pt-0.5 border-t border-stone-200/80">
          <span>Thu: {formatCompactVND(tongThuNgay)}</span>
          <span>·</span>
          <span>Chi: {formatCompactVND(tongChiNgay)}</span>
          <span>·</span>
          <span>{daily.bep_an.tong_suat} suất</span>
        </div>
      </button>

      {/* 2. HAI Ô XEM NHANH: TIỀN CÓ & SỔ NỢ / PHẢI THU (Chạm vào mở xem chi tiết) */}
      <div className="grid grid-cols-2 gap-2 text-left">
        <button
          type="button"
          onClick={onOpenWallets}
          className="p-2 rounded-xl bg-sky-50/80 hover:bg-sky-100 border border-sky-300 transition active:scale-[0.98] space-y-0.5"
        >
          <div className="flex items-center justify-between text-[11px] font-bold text-sky-900">
            <span className="inline-flex items-center gap-1">
              <Wallet className="w-3 h-3 text-sky-700" />
              Tiền có
            </span>
            <ChevronRight className="w-3 h-3 text-sky-400" />
          </div>
          <div className="text-base font-black text-sky-900 truncate">
            {formatCompactVND(totalCash)}
          </div>
          <div className="text-[10px] text-sky-700 font-medium truncate">
            {wallets.length} ví tại cơ sở
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenDebts}
          className="p-2 rounded-xl bg-amber-50/80 hover:bg-amber-100 border border-amber-300 transition active:scale-[0.98] space-y-0.5"
        >
          <div className="flex items-center justify-between text-[11px] font-bold text-amber-950">
            <span className="inline-flex items-center gap-1">
              <BookMarked className="w-3 h-3 text-amber-800" />
              Nợ & Phải thu
            </span>
            <ChevronRight className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-base font-black text-amber-950 truncate">
            {formatCompactVND(debt.tong_minh_no)}
          </div>
          <div className="text-[10px] text-amber-800 font-medium truncate">
            Phải thu: {formatCompactVND(debt.tong_nguoi_ta_no)}
          </div>
        </button>
      </div>
    </div>
  );
};
