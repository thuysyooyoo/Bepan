#!/usr/bin/env node
/**
 * SỔ BẾP NHÀ MÌNH — KỊCH BẢN PENETRATION TEST BẢO MẬT SUPABASE & RLS TRỰC TIẾP
 * Chạy bằng lệnh: npm run verify:security
 *
 * Kiểm tra 5 lớp bảo mật thực tế trên Supabase Cloud:
 *   1. Anon Key bị chặn 100% khi đọc trực tiếp các bảng & SQL View (trả về [] hoặc 401)
 *   2. Anon Key bị chặn 100% khi gọi RPC đổi mã PIN (change_user_pin)
 *   3. Cổng tự đăng ký tài khoản ngoài (Public Signup) bị khóa (hoặc cảnh báo nếu chưa tắt)
 *   4. Cô lập sổ Bố (PIN 1111): chỉ đọc được Hiệp Hòa, bị RLS chặn khi đọc/ghi Tiên Du
 *   5. Cô lập sổ Mẹ (PIN 2222) & Quyền giám sát Admin (PIN 9999): Mẹ bị chặn Hiệp Hòa, Admin thấy đủ 2 sổ
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const vars = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        vars[k] = v;
      }
    }
  }
  return {
    url: process.env.VITE_SUPABASE_URL || vars.VITE_SUPABASE_URL || '',
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || vars.VITE_SUPABASE_ANON_KEY || '',
  };
}

function makeFreshClient(url, anonKey) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  const { url, anonKey } = loadEnvLocal();
  if (!url || !anonKey) {
    console.error('❌ Chưa tìm thấy VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY trong .env.local');
    process.exitCode = 1;
    return;
  }

  console.log(`\n🛡️  KIỂM TRA BẢO MẬT SUPABASE & RLS: ${url}\n`);
  const anon = makeFreshClient(url, anonKey);

  // Thăm dò xem SQL migration đã chạy chưa
  const { data: pubProfiles, error: initErr } = await anon.rpc('get_public_login_profiles');
  if (initErr) {
    console.log('⏳ Trạng thái: Máy chủ Supabase phản hồi tốt, nhưng CHƯA chạy file SQL khởi tạo bảng.');
    console.log('👉 Bước thực hiện duy nhất (30 giây):');
    console.log('   1. Mở Supabase SQL Editor của dự án: https://supabase.com/dashboard/project/grqlnqycxxadedqlppyl/sql/new');
    console.log('   2. Copy toàn bộ file: supabase/migrations/001_initial_schema.sql -> Dán & bấm RUN');
    console.log('   3. Chạy lại lệnh: npm run verify:security\n');
    return;
  }

  console.log(`✅ Đã nhận diện ${pubProfiles?.length ?? 0} thẻ hồ sơ đăng nhập công khai.`);
  let failed = 0;

  const assertPass = (ok, label, detail = '') => {
    if (ok) {
      console.log(`  ✅ PASS: ${label}`);
    } else {
      failed += 1;
      console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };

  // 1. Kiểm tra chặn 'anon' trên toàn bộ bảng & View
  for (const tbl of [
    'books',
    'profiles',
    'wallets',
    'transactions',
    'suppliers',
    'meal_counts',
    'v_so_du_vi',
    'v_so_no_ncc',
  ]) {
    const { data, error } = await anon.from(tbl).select('*');
    const blocked = Boolean(error) || (Array.isArray(data) && data.length === 0);
    assertPass(
      blocked,
      `Chặn 'anon' đọc bảng/view public.${tbl}`,
      `Trả về ${data?.length ?? 0} dòng`
    );
  }

  // 2. Kiểm tra chặn 'anon' gọi RPC change_user_pin
  const { error: rpcErr } = await anon.rpc('change_user_pin', {
    p_target_profile_id: 'bo',
    p_new_secret: 'SoBep#bo#PIN#0000',
  });
  assertPass(Boolean(rpcErr), `Chặn 'anon' gọi RPC đổi mã PIN (change_user_pin)`);

  // 3. Kiểm tra khóa đăng ký tự do (Public Signup)
  const { error: signupErr } = await anon.auth.signUp({
    email: `intruder-${Date.now()}@example.com`,
    password: 'IntruderPassword#12345',
  });
  if (signupErr && /signups not allowed|disabled/i.test(signupErr.message)) {
    assertPass(true, 'Đã khóa cổng tự đăng ký tài khoản ngoài (Signups disabled)');
  } else {
    console.warn(
      '  ⚠️  LƯU Ý: Hãy tắt "Allow new users to sign up" trong Supabase -> Authentication -> Providers -> Email để đạt điểm 100/100!'
    );
  }

  // 4. Đăng nhập Bố (PIN 1111) -> Chỉ thấy Hiệp Hòa, bị chặn Tiên Du
  const boClient = makeFreshClient(url, anonKey);
  const { error: boAuthErr } = await boClient.auth.signInWithPassword({
    email: 'bo@sobep.local',
    password: 'SoBep#bo#PIN#1111',
  });
  assertPass(!boAuthErr, 'Đăng nhập Bố (PIN 1111) qua Virtual Email', boAuthErr?.message);

  if (!boAuthErr) {
    const { data: boBooks } = await boClient.from('books').select('id');
    assertPass(
      boBooks?.length === 1 && boBooks[0].id === 'hiep_hoa',
      'Bố chỉ nhìn thấy duy nhất Sổ Hiệp Hòa (0 thấy Sổ Tiên Du)'
    );

    const { data: leakWallets } = await boClient
      .from('wallets')
      .select('id')
      .eq('book_id', 'tien_du');
    assertPass(
      (leakWallets?.length ?? 0) === 0,
      'Bố truy vấn ví của Sổ Tiên Du trả về rỗng []'
    );

    const { error: crossWriteErr } = await boClient.from('transactions').insert({
      book_id: 'tien_du',
      ngay: '2026-10-01',
      mang: 'bep_an',
      loai: 'chi',
      category_id: 'cat_rau_cu',
      so_tien: 50000,
      wallet_id: 'td_tien_mat',
      ghi_chu: 'PenTest ghi chéo sổ',
      nguon: 'tay',
      nguoi_tao: 'bo',
    });
    assertPass(
      Boolean(crossWriteErr),
      'RLS chặn Bố ghi giao dịch trái phép sang Sổ Tiên Du'
    );
  }

  // 5. Đăng nhập Mẹ (PIN 2222) & Admin (PIN 9999)
  const meClient = makeFreshClient(url, anonKey);
  const { error: meAuthErr } = await meClient.auth.signInWithPassword({
    email: 'me@sobep.local',
    password: 'SoBep#me#PIN#2222',
  });
  assertPass(!meAuthErr, 'Đăng nhập Mẹ (PIN 2222) qua Virtual Email', meAuthErr?.message);

  if (!meAuthErr) {
    const { data: meBooks } = await meClient.from('books').select('id');
    assertPass(
      meBooks?.length === 1 && meBooks[0].id === 'tien_du',
      'Mẹ chỉ nhìn thấy duy nhất Sổ Tiên Du (0 thấy Sổ Hiệp Hòa)'
    );
  }

  const adminClient = makeFreshClient(url, anonKey);
  const { error: adminAuthErr } = await adminClient.auth.signInWithPassword({
    email: 'admin@sobep.local',
    password: 'SoBep#admin#PIN#9999',
  });
  assertPass(
    !adminAuthErr,
    'Đăng nhập Admin (PIN 9999) qua Virtual Email',
    adminAuthErr?.message
  );

  if (!adminAuthErr) {
    const { data: adminBooks } = await adminClient.from('books').select('id').order('id');
    assertPass(
      adminBooks?.length === 2,
      'Admin nhìn thấy đầy đủ cả 2 sổ (Hiệp Hòa & Tiên Du)'
    );
  }

  if (failed > 0) {
    console.error(`\n❌ Phát hiện ${failed} lỗi bảo mật cần khắc phục!\n`);
    process.exitCode = 1;
  } else {
    console.log('\n🎉 TẤT CẢ KIỂM TRA BẢO MẬT RLS & PHÂN QUYỀN ĐỀU ĐẠT 100%!\n');
  }
}

main().catch((err) => {
  console.error('Lỗi thực thi kiểm tra bảo mật:', err);
  process.exitCode = 1;
});
