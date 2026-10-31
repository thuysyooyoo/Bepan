import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildActionCardFromIntent,
  buildTurnSpokenSummary,
  parseUserUtterance,
} from '../ai/chatEngine';
import {
  mergeSpeechResults,
  normalizeAsrTranscript,
  prepareTextForVietnameseSpeech,
  startVietnameseSpeechSession,
  type BrowserSpeechRecognition,
} from '../ai/voiceEngine';
import { LocalDexieAdapter } from '../db';

describe('Phiên 4 — Nhập liệu bằng Giọng nói (Web Speech vi-VN, Khử lặp Android, TTS đọc to & Dự phòng)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('1. Khử lặp chữ lũy kế đặc trưng trên Chrome Android (mergeSpeechResults) & lọc từ đệm (normalizeAsrTranscript)', () => {
    // Giả lập lỗi kinh điển của webkitSpeechRecognition trên Android: trả về chuỗi cộng dồn qua từng nhịp nói
    const androidCumulativeResults = {
      length: 3,
      0: { isFinal: true, 0: { transcript: 'hôm nay mua' } },
      1: { isFinal: true, 0: { transcript: 'hôm nay mua 5 cân thịt' } },
      2: { isFinal: false, 0: { transcript: 'hôm nay mua 5 cân thịt 4 trăm rưỡi' } },
    };

    const merged = mergeSpeechResults(androidCumulativeResults);
    expect(merged.finalText).toBe('hôm nay mua 5 cân thịt');
    expect(merged.combinedText).toBe('hôm nay mua 5 cân thịt 4 trăm rưỡi');

    // Giả lập chuẩn Desktop Chrome: tách từng cụm riêng biệt
    const desktopChunkResults = {
      length: 2,
      0: { isFinal: true, 0: { transcript: 'Sáng 150 suất' } },
      1: { isFinal: true, 0: { transcript: 'trưa 320 suất' } },
    };
    expect(mergeSpeechResults(desktopChunkResults).combinedText).toBe(
      'Sáng 150 suất trưa 320 suất'
    );

    // Lọc từ ngập ngừng đầu câu và lỗi chính tả ASR ("căng-tin", "vãn lai", "₫")
    expect(
      normalizeAsrTranscript('ờ ghi vào sổ cho bố căng-tin hôm nay thu 2,300,000₫')
    ).toBe('căn tin hôm nay thu 2.300.000 đồng');
    expect(
      normalizeAsrTranscript('à ừm hôm nay thêm 5 khách vãn lai ăn trưa')
    ).toBe('hôm nay thêm 5 khách vãng lai ăn trưa');
  });

  it('2. Bộ 24 câu gỡ băng giọng nói thực tế kiểu Google Speech Android đạt >= 90% (100%)', async () => {
    const repo = new LocalDexieAdapter(`TestDB_S4_VoiceCorpus_${Date.now()}`);
    const me = await repo.loginWithPin('me', '2222');
    const refDate = '2026-10-31';

    await repo.upsertMealCount(me, {
      book_id: 'tien_du',
      ngay: '2026-10-30',
      bua: 'trua',
      suat_truong: 280,
      suat_vang_lai: 0,
      nguon: 'giong',
      nguoi_tao: 'me',
    });

    const snap = await repo.getBookSnapshot(me, 'tien_du');

    const voiceUtterances: Array<{
      spoken: string;
      verify: (res: Awaited<ReturnType<typeof parseUserUtterance>>) => boolean;
    }> = [
      {
        spoken: 'ờ hôm nay buổi sáng 130 buổi trưa 290 buổi tối 70',
        verify: (r) =>
          r.items[0]?.intent === 'suat_an' &&
          r.items[0].suat_an?.sang_truong === 130 &&
          r.items[0].suat_an?.trua_truong === 290 &&
          r.items[0].suat_an?.toi_truong === 70,
      },
      {
        spoken: 'ghi cho mẹ hôm nay nấu giống hôm qua',
        verify: (r) =>
          r.items[0]?.intent === 'giong_hom_qua' &&
          r.items[0].suat_an?.trua_truong === 280,
      },
      {
        spoken: 'à trưa nay có thêm 6 khách vãn lai',
        verify: (r) =>
          r.items[0]?.intent === 'vang_lai' && r.items[0].so_suat_vang_lai === 6,
      },
      {
        spoken: 'mua thịt lợn 450,000₫',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_thit' &&
          r.items[0].so_tien === 450_000,
      },
      {
        spoken: 'ghi vào sổ mua 10 cân gạo 220.000 đ',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_gao_bun_pho' &&
          r.items[0].so_tien === 220_000,
      },
      {
        spoken: 'ừm mua cá rô phi bốn trăm rưỡi tiền mặt',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_ca_hai_san' &&
          r.items[0].so_tien === 450_000,
      },
      {
        spoken: 'mua rau cải với cà chua trăm rưỡi',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_rau_cu' &&
          r.items[0].so_tien === 150_000,
      },
      {
        spoken: 'nhập bánh kẹo căng-tin 1,250,000₫ chuyển khoản chị Nhàn',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].mang === 'can_tin' &&
          r.items[0].so_tien === 1_250_000 &&
          r.items[0].vi === 'tk_chi_nhan',
      },
      {
        spoken: 'nhập 5 thùng nước ngọt căng tin 1 triệu 1',
        verify: (r) =>
          r.items[0]?.intent === 'chi' &&
          r.items[0].category_id === 'cat_nhap_nuoc_ct' &&
          r.items[0].so_tien === 1_100_000,
      },
      {
        spoken: 'lấy thịt chợ Tiên Du 2,400,000 ghi nợ',
        verify: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].supplier_id === 'sup_td_thit' &&
          r.items[0].so_tien === 2_400_000,
      },
      {
        spoken: 'lấy đậu phụ bà Năm 180 nghìn mua chịu',
        verify: (r) =>
          r.items[0]?.intent === 'chi_no' &&
          r.items[0].ten_ncc_moi === 'Bà Năm' &&
          r.items[0].so_tien === 180_000,
      },
      {
        spoken: 'trả nợ đại lý bánh nước Tiên Du 1,500,000 chuyển khoản',
        verify: (r) =>
          r.items[0]?.intent === 'tra_no' &&
          r.items[0].supplier_id === 'sup_td_nuoc' &&
          r.items[0].so_tien === 1_500_000 &&
          r.items[0].vi === 'tk_chi_nhan',
      },
      {
        spoken: 'căng-tin hôm nay thu 1,800,000 tiền mặt và 650,000 chuyển khoản',
        verify: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 1_800_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 650_000,
      },
      {
        spoken: 'tổng thu cuối ngày 2,500,000, trong đó chuyển khoản 900,000',
        verify: (r) =>
          r.items[0]?.intent === 'thu_can_tin' &&
          r.items[0].thu_cuoi_ngay?.tien_mat === 1_600_000 &&
          r.items[0].thu_cuoi_ngay?.chuyen_khoan === 900_000,
      },
      {
        spoken: 'hôm nay phụ bếp đi làm đủ hết',
        verify: (r) =>
          r.items[0]?.intent === 'cham_cong' &&
          r.items[0].cham_cong?.every((w) => w.so_cong === 1) === true,
      },
      {
        spoken: 'hôm nay cô Mai nghỉ, chị Hương đi làm',
        verify: (r) => {
          const cc = r.items[0]?.cham_cong;
          return (
            r.items[0]?.intent === 'cham_cong' &&
            cc?.find((w) => w.worker_id === 'wk_td_1')?.so_cong === 0 &&
            cc?.find((w) => w.worker_id === 'wk_td_2')?.so_cong === 1
          );
        },
      },
      {
        spoken: 'trường chuyển tiền ăn tháng 10 148,500,000₫',
        verify: (r) =>
          r.items[0]?.intent === 'truong_chuyen' &&
          r.items[0].so_tien === 148_500_000 &&
          r.items[0].vi === 'tk_mo_diep',
      },
      {
        spoken: 'ứng lương cô Mai 1,500,000 tiền mặt',
        verify: (r) =>
          r.items[0]?.intent === 'tra_luong' &&
          r.items[0].worker_id === 'wk_td_1' &&
          r.items[0].so_tien === 1_500_000,
      },
      {
        spoken: 'rút 4,000,000 từ tài khoản chị Nhàn về tiền mặt',
        verify: (r) =>
          r.items[0]?.intent === 'chuyen_quy' &&
          r.items[0].vi === 'tk_chi_nhan' &&
          r.items[0].sang_vi === 'tien_mat' &&
          r.items[0].so_tien === 4_000_000,
      },
      {
        spoken: 'tiền nước sạch tháng 9 hết 850,000 tiền mặt',
        verify: (r) =>
          r.items[0]?.intent === 'chi_phi_thang' &&
          r.items[0].category_id === 'cat_tien_nuoc' &&
          r.items[0].ky_thang === '2026-09' &&
          r.items[0].so_tien === 850_000,
      },
      {
        spoken: 'con ơi hôm nay lãi bao nhiêu',
        verify: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'lai_hom_nay',
      },
      {
        spoken: 'ờ đang nợ những ai',
        verify: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'so_no_ncc',
      },
      {
        spoken: 'tiền mặt còn bao nhiêu',
        verify: (r) => r.items[0]?.intent === 'hoi' && r.items[0].chu_de_hoi === 'so_du_vi',
      },
      {
        spoken: 'hôm qua mua trứng 280,000₫, mua rau 120,000₫',
        verify: (r) =>
          r.items.length === 2 &&
          r.items[0].ngay === '2026-10-30' &&
          r.items[0].so_tien === 280_000 &&
          r.items[1].so_tien === 120_000,
      },
    ];

    let okCount = 0;
    const errors: string[] = [];
    for (const u of voiceUtterances) {
      const res = await parseUserUtterance(u.spoken, snap, refDate);
      if (u.verify(res)) {
        okCount++;
      } else {
        errors.push(`${u.spoken} => ${JSON.stringify(res.items)}`);
      }
    }

    expect(errors).toEqual([]);
    expect(okCount / voiceUtterances.length).toBeGreaterThanOrEqual(0.9);
  });

  it('3. Chuẩn bị lời đọc to tiếng Việt (TTS): xóa icon, đọc tự nhiên ngày & số tiền VND', async () => {
    const rawReport =
      '📊 Ngày 2026-10-31 (Sổ Hiệp Hòa): 🍲 Bếp ăn: Thu 9.000.000 đ − Chi 1.450.000 đ → Lãi 7.550.000 đ';
    const spoken = prepareTextForVietnameseSpeech(rawReport);

    expect(spoken).not.toContain('📊');
    expect(spoken).not.toContain('🍲');
    expect(spoken).toContain('ngày 31 tháng 10');
    expect(spoken).toContain('9 triệu đồng');
    expect(spoken).toContain('1 triệu 450 nghìn đồng');

    // Kiểm tra tổng hợp đọc nhiều thẻ cùng lúc
    const repo = new LocalDexieAdapter(`TestDB_S4_TTS_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const snap = await repo.getBookSnapshot(bo, 'hiep_hoa');

    const multi = await parseUserUtterance(
      'Mua thịt 1 triệu 2, mua rau 300k',
      snap,
      '2026-10-31'
    );
    const turnSummary = buildTurnSpokenSummary(multi.items, snap, multi.raw_text);
    expect(turnSummary).toContain('Đã nghe rõ 2 mục');
    expect(turnSummary).toContain('Lưu tất cả');
  });

  it('4. Vòng đời phiên Micro 1 chạm: tự dừng khi im lặng 2.4s + bắt đúng lỗi chặn quyền Micro Android + lưu nguồn "giong"', async () => {
    vi.useFakeTimers();

    let activeMockInstance: BrowserSpeechRecognition | null = null;
    class MockSpeechRecognition implements BrowserSpeechRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((ev: { resultIndex: number; results: { length: number; [k: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        activeMockInstance = this;
        this.onstart?.();
      }
      stop() {}
      abort() {}
    }

    vi.stubGlobal('window', {
      isSecureContext: true,
      webkitSpeechRecognition: MockSpeechRecognition,
    });

    // Kịch bản A: Bấm 1 lần -> hiện chữ tạm -> nói xong im lặng 2.4s -> tự động chốt câu!
    const interimUpdates: string[] = [];
    let completedSentence = '';

    const session = startVietnameseSpeechSession({
      silenceTimeoutMs: 2400,
      onTranscriptChange: (live) => interimUpdates.push(live),
      onComplete: (finalClean) => {
        completedSentence = finalClean;
      },
      onError: () => {},
    });

    expect(session).not.toBeNull();
    expect(activeMockInstance).not.toBeNull();

    // Ông bà đang nói dở...
    activeMockInstance!.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: false, 0: { transcript: 'ờ mua 5 cân thịt' } },
      },
    });
    expect(interimUpdates).toEqual(['ờ mua 5 cân thịt']);

    // Ngập ngừng 1 giây rồi nói tiếp (chưa tới 2.4s nên KHÔNG bị ngắt giữa chừng!)
    vi.advanceTimersByTime(1000);
    expect(completedSentence).toBe('');

    activeMockInstance!.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: true, 0: { transcript: 'ờ mua 5 cân thịt 4 trăm rưỡi' } },
      },
    });
    expect(interimUpdates[interimUpdates.length - 1]).toBe('ờ mua 5 cân thịt 4 trăm rưỡi');

    // Im lặng đủ 2.4 giây -> tự động chốt câu và lọc sạch chữ "ờ"
    vi.advanceTimersByTime(2500);
    expect(completedSentence).toBe('mua 5 cân thịt 4 trăm rưỡi');

    // Kịch bản B: Trình duyệt Chrome Android đang chặn quyền Micro ('not-allowed')
    let capturedErrCode = '';
    startVietnameseSpeechSession({
      onComplete: () => {},
      onError: (code) => {
        capturedErrCode = code;
      },
    });
    activeMockInstance!.onerror?.({ error: 'not-allowed' });
    expect(capturedErrCode).toBe('permission_denied');

    // Kịch bản C: Lưu giao dịch từ giọng nói ghi chuẩn nguon = 'giong'
    vi.useRealTimers();
    const repo = new LocalDexieAdapter(`TestDB_S4_SaveVoice_${Date.now()}`);
    const bo = await repo.loginWithPin('bo', '1111');
    const snap = await repo.getBookSnapshot(bo, 'hiep_hoa');

    const parsed = await parseUserUtterance(completedSentence, snap, '2026-10-31');
    await repo.addChatLog(bo, {
      book_id: 'hiep_hoa',
      nguoi_dung: 'bo',
      nguon: 'giong',
      cau_noi: completedSentence,
      ai_json: parsed,
      ket_qua: 'da_luu',
    });

    const card = buildActionCardFromIntent(parsed.items[0], snap, completedSentence, repo);
    await card!.commit(bo, 'giong');

    const afterSnap = await repo.getBookSnapshot(bo, 'hiep_hoa');
    expect(afterSnap.transactions[0].nguon).toBe('giong');
    expect(afterSnap.transactions[0].so_tien).toBe(450_000);
    const logs = await repo.listChatLogs(bo, 'hiep_hoa');
    expect(logs[0].nguon).toBe('giong');
  });
});
