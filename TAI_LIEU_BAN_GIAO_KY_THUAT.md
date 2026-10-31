# 📘 TÀI LIỆU KỸ THUẬT BÀN GIAO & VẬN HÀNH HỆ THỐNG
# DỰ ÁN: "SỔ BẾP NHÀ MÌNH" (E:\So-Bep-Nha-Minh)

> **Dành cho:** Quản trị viên (Con / Admin)  
> **Phiên bản:** 1.0 (Hoàn tất 9/9 Phiên)  
> **Kho mã nguồn:** [GitHub thuysyooyoo/Bepan](https://github.com/thuysyooyoo/Bepan.git)  
> **Bản chạy thử trực tiếp (Live Demo):** [https://thuysyooyoo.github.io/Bepan/](https://thuysyooyoo.github.io/Bepan/)

---

## 1. TỔNG QUAN HỆ THỐNG & TRIẾT LÝ THIẾT KẾ
Ứng dụng **"Sổ Bếp Nhà Mình"** được may đo đặc thù cho mô hình bếp ăn học đường và căn tin bán lẻ của gia đình:
- **Cơ sở 1:** Bếp ăn & Căn tin trường học tại **Hiệp Hòa** (`book_id: 'hiep_hoa'`) do **Bố** phụ trách.
- **Cơ sở 2:** Bếp ăn & Căn tin trường học tại **Tiên Du** (`book_id: 'tien_du'`) do **Mẹ** phụ trách.
- **Tài khoản Admin (Con):** Giám sát tổng hợp 2 cơ sở, đối chiếu lãi ròng, quản lý 6 ví tiền, rà soát lịch sử chat để sửa hộ ông bà, dạy từ địa phương và sao lưu dữ liệu.

### Triết lý 3 Không dành cho người lớn tuổi:
1. **Không phải gõ chữ:** 100% thao tác có thể thực hiện bằng nút **Micro xanh khổng lồ** hoặc 9 nút nhập tay chữ to (font $\ge 20\text{px}$).
2. **Không phải tính nhẩm:** Tự động tách tiền vãng lai và căn tin theo **Cách A**, tự động tạm tính chi phí tháng, tự động tính công thợ và công nợ FIFO.
3. **Không sợ bấm nhầm:** Mọi giao dịch lưu vào sổ đều có **Thanh hoàn tác 1 chạm (Undo)** và máy đọc to bằng tiếng Việt để kiểm tra lại ngay tức thì.

---

## 2. KIẾN TRÚC 3 SỔ KẾ TOÁN BẤT BIẾN (ACCRUAL vs CASHFLOW vs DEBT)

```
                            ┌────────────────────────────────────────┐
                            │          HÀNH ĐỘNG NHẬP LIỆU           │
                            │  (Nói Micro / Nhập tay / Chốt quầy)    │
                            └───────────────────┬────────────────────┘
                                                │
         ┌──────────────────────────────────────┼──────────────────────────────────────┐
         ▼                                      ▼                                      ▼
┌─────────────────────────┐        ┌─────────────────────────┐        ┌─────────────────────────┐
│   📒 SỔ LÃI LỖ          │        │   💰 SỔ DÒNG TIỀN        │        │   📕 SỔ CÔNG NỢ         │
│   (Accrual P&L)         │        │   (100% Actual Cash)    │        │   (Payables & Accruals) │
├─────────────────────────┤        ├─────────────────────────┤        ├─────────────────────────┤
│ • Bếp ăn: Doanh thu theo│        │ • 3 Ví riêng/cơ sở:     │        │ • Nợ nhà cung cấp:      │
│   suất ăn (trường + VL) │        │   + Tiền mặt két        │        │   Mua chịu (chi_no),    │
│   − Chi chợ ngày        │        │   + TK Mợ Diệp          │        │   trừ dần theo FIFO     │
│   − Công thợ trong ngày │        │   + TK Chị Nhàn         │        │ • Lương thợ kỳ này:     │
│ • Căn tin: KHÔNG CÓ LÃI │        │ • Mua chịu KHÔNG đổi ví │        │   Tạm tính theo chấm    │
│   NGÀY, chỉ tính tháng. │        │ • Trường nợ KHÔNG đổi ví│        │   công trừ đã ứng/trả   │
│ • Chi phí tháng (Điện,  │        │ • Đếm tiền thực tế:     │        │ • Tiền trường dự kiến:  │
│   Nước, Ga, Gia vị):    │        │   Tự cân ví bằng        │        │   Suất trường lũy kế    │
│   CHỈ TRỪ VÀO LÃI THÁNG.│        │   dieu_chinh_vi         │        │   trừ phần trường trả   │
└─────────────────────────┘        └─────────────────────────┘        └─────────────────────────┘
```

### Quy tắc chốt quầy cuối ngày (Cách A):
- Ông bà đếm tiền két + kiểm tra tin nhắn biến động số dư **TK Chị Nhàn**, sau đó chỉ cần báo:
  *Ví dụ:* *"Căn tin hôm nay tiền mặt 2 triệu, chuyển khoản 800 nghìn"*.
- **Về Dòng tiền:** Ví Tiền mặt nhận đúng $+2.000.000$đ; Ví TK Chị Nhàn nhận đúng $+800.000$đ.
- **Về Báo cáo Lãi lỗ:** Hệ thống tự động tính:
  $$\text{Doanh thu Vãng lai} = \sum (\text{Số suất vãng lai trong ngày} \times \text{Đơn giá vãng lai})$$
  Phần doanh thu này được ghi nhận vào **Bếp ăn**.
  $$\text{Doanh thu Căn tin} = (\text{Tổng tiền mặt} + \text{Tổng CK}) - \text{Doanh thu Vãng lai}$$
  Phần còn lại ghi nhận vào doanh thu **Căn tin**. Không làm lệch dù chỉ 1 đồng!

---

## 3. BỘ NÃO HYBRID TIẾT KIỆM TOKEN & XỬ LÝ GIỌNG NÓI
1. **Local Vietnamese NLU (0 token, 0ms latency):**
   - Bộ phân tích ngữ nghĩa tiếng Việt độc quyền `src/ai/localVnNlu.ts` xử lý gọn gàng 14 intents: suất ăn trường, khách vãng lai, chi chợ tiền mặt, mua chịu ghi nợ, trả nợ mối hàng, chấm công nửa buổi/cả ngày, thu cuối ngày, chuyển quỹ...
   - Phân giải chuẩn xác hơn 30 cách nói tiền khẩu ngữ miền Bắc (*"trăm rưỡi"*, *"hai triệu tư"*, *"ba lít"*, *"nửa củ"*, *"sáu chục"*...).
2. **Cloud Gemini 3.8 Flash (`thinkingBudget: 0`):**
   - Chỉ được kích hoạt khi câu nói quá dài ($> 95$ ký tự), có nhiều hơn 3 vế phức tạp hoặc chứa mặt hàng hoàn toàn mới ngoài danh mục.
   - Tiết kiệm hơn **90% chi phí token** so với việc gửi toàn bộ câu lên AI đám mây.
3. **Nút Micro 1 chạm (`voiceEngine.ts`):**
   - Vận hành trên Web Speech API tiếng Việt (`vi-VN`).
   - Tự ngắt thông minh sau **2,4 giây im lặng** (tránh tình trạng ngắt lời khi người lớn tuổi ngập ngừng suy nghĩ 1–2 giây).
   - Tự động khử lỗi nhân đôi từ lũy kế (interim results duplicate) thường gặp trên trình duyệt Google Chrome Android.

---

## 4. BẢO MẬT & ĐỒNG BỘ NGOẠI TUYẾN (OFFLINE-FIRST)
1. **Cơ chế Ngoại tuyến (Offline-First):**
   - Khi mất mạng hoặc sóng 4G chập chờn ở khu vực bếp ăn, toàn bộ thao tác vẫn lưu vào IndexedDB (`dexieDb.ts`).
   - Hàng đợi `offline_outbox` bảo đảm thứ tự nhân quả nghiêm ngặt (FIFO Monotonic Sorting `${iso}#${seq.padStart(8, '0')}`).
   - Khi có mạng trở lại, hệ thống tự động đẩy dữ liệu lên đám mây và đồng bộ Realtime 2 chiều.
2. **Bảo mật phân quyền Row Level Security (RLS):**
   - Vai trò `owner` (Bố/Mẹ) chỉ đọc và ghi duy nhất vào `book_id` của cơ sở mình.
   - Tài khoản `anon` bị chặn hoàn toàn mọi quyền đọc/ghi.
   - Header bảo mật `public/_headers` chỉ cấp quyền micro cho chính ứng dụng (`Permissions-Policy: microphone=(self)`).

---

## 5. HƯỚNG DẪN KÍCH HOẠT SUPABASE ĐÁM MÂY (3 PHÚT)
Khi muốn kích hoạt lưu trữ đám mây chính thức cho bố mẹ:

1. Đăng nhập vào Supabase Dashboard của bạn: [https://supabase.com/dashboard/project/grqlnqycxxadedqlppyl](https://supabase.com/dashboard/project/grqlnqycxxadedqlppyl)
2. Nhấp vào mục **SQL Editor** ở thanh menu bên trái -> Bấm **New query**.
3. Mở file `supabase/migrations/001_initial_schema.sql` trong dự án -> Copy toàn bộ nội dung -> Dán vào SQL Editor -> Bấm **Run** (Ctrl + Enter).
4. Vào mục **Authentication** -> **Providers** -> **Email**:
   - Tắt cờ **Enable signups** (để chặn người lạ đăng ký).
   - Đảm bảo cờ **Confirm email** tắt (vì hệ thống dùng Virtual Email PIN).
5. Mở ứng dụng Sổ Bếp -> Đăng nhập mã PIN **9999** (Admin) -> Vào **Cài đặt** -> Bấm nút:  
   **`Đẩy dữ liệu thử trên máy (cả 2 sổ) lên Đám mây`**.
6. Lúc này đèn trạng thái trên thanh tiêu đề sẽ chuyển thành `☁️ Đã kết nối Supabase (Realtime 2 chiều)`.

---

## 6. THÔNG TIN MÃ PIN MẶC ĐỊNH & THAY ĐỔI
| Người dùng | Vai trò | Mã PIN mặc định | Sổ được quản lý |
|---|---|---|---|
| **👨‍🍳 Bố** | `owner` | **`1111`** | Bếp ăn & Căn tin Hiệp Hòa (`hiep_hoa`) |
| **👩‍🍳 Mẹ** | `owner` | **`2222`** | Bếp ăn & Căn tin Tiên Du (`tien_du`) |
| **🛡️ Con (Admin)** | `admin` | **`9999`** | Cả 2 cơ sở + Bảng Tổng hợp & Phân tích |

> **Cách đổi mã PIN:** Vào mục **⚙️ Cài đặt** -> chọn thẻ **Lịch nhắc & Đổi mã PIN** -> Nhập 4 chữ số mới -> Bấm **Cập nhật mã PIN**. Phiên đăng nhập được duy trì an toàn trong 90 ngày.

---

## 7. QUY TRÌNH 7 NGÀY CHẠY THỬ THỰC TẾ VỚI BỐ MẸ
- **Ngày 1 (Cài đặt):** Mở Chrome trên điện thoại Bố & Mẹ truy cập link ứng dụng -> Bấm menu 3 chấm -> Chọn **"Thêm vào màn hình chính"** (Cài PWA như app native).
- **Ngày 2 (Treo cẩm nang):** In file `public/huong-dan-ong-ba.html` ra 1 tờ giấy A4 dán ngay cửa tủ lạnh hoặc bàn kế toán ở bếp.
- **Ngày 3 (Tập nói Micro):** Hướng dẫn bố mẹ chạm nút Micro tròn xanh, nói thử vài câu đơn giản (báo suất ăn trưa, mua rau chị Hương ghi nợ...).
- **Ngày 4–7 (Rà soát & Dạy từ mới):**
  - Hằng ngày lúc 21h tối, bạn mở app bằng mã PIN `9999` -> Chọn tab `👑 Tổng hợp`.
  - Kéo xuống mục **Lịch sử chat để sửa hộ**: Nếu thấy câu nói nào máy nhận diện chưa đúng tên hàng hoặc mối mới, bấm nút **`➕ Dạy từ / Mối mới`**.
  - Sau khoảng 3–5 ngày dạy từ, AI sẽ ghi nhớ 100% tiếng địa phương của bếp ăn!

---

## 8. QUY ĐỊNH SAO LƯU DỮ LIỆU & XUẤT BÁO CÁO EXCEL (RULE 10 COMPLIANCE)

### A. Sao lưu hằng tuần (.json):
- **TUYỆT ĐỐI TUÂN THỦ RULE 10:** Hệ thống không tạo bất kỳ file backup `.xlsx` nào trên ổ đĩa máy tính.
- **Cơ chế sao lưu kép:**
  1. *Sao lưu tự động:* Cứ mỗi 7 ngày một lần khi mở app, hệ thống tự động chụp ảnh toàn bộ 2 sổ lưu vào bộ nhớ trình duyệt (giữ tối đa 4 tuần quay vòng).
  2. *Tải file về máy/Drive:* Tại màn hình `👑 Tổng hợp` hoặc `⚙️ Cài đặt`, bấm **`Tải sao lưu (.json)`** để lưu file `So_Bep_Nha_Minh_Sao_Luu_YYYY-MM-DD.json`.
  3. *Khôi phục dữ liệu:* Bấm **`Khôi phục file`**, chọn file `.json` đã lưu -> hệ thống kiểm tra checksum và nạp lại an toàn 100%.

### B. Xuất báo cáo Excel tháng:
- Nút **`Xuất Excel 2 cơ sở`** tại Dashboard Admin và **`Xuất Excel tháng`** tại Báo cáo Lãi.
- Chuẩn mực kế toán: **100% các ô font `Arial` cỡ `10`**, định dạng số tiền `#,##0`, ngày tháng `dd/mm/yyyy`.
- Quá trình tạo file thực hiện hoàn toàn trong bộ nhớ RAM và tải trực tiếp về trình duyệt, không sinh bất kỳ tệp tạm nào trên ổ đĩa.

---
*Chúc Bố Mẹ quản lý bếp ăn thảnh thơi, thu chi minh bạch và trọn vẹn niềm vui mỗi ngày!*
