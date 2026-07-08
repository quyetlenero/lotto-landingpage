# Hướng dẫn quản trị Landing Page — Thu Cũ Đổi Mới Lotto 2026

---

## Cấu trúc hệ thống

```
Google Sheets  →  tự động cập nhật  →  Landing Page (Netlify)
   (Team MKT)                            (người dùng thấy)
```

- **Team MKT** chỉ cần sửa Google Sheet — trang tự cập nhật khi người dùng load lại
- **Dev/Admin** mới cần động vào GitHub khi thay đổi layout, màu sắc, thiết kế

---

## PHẦN 1 — Cài đặt lần đầu (Admin thực hiện 1 lần)

### Bước 1: Tạo Google Sheet danh sách đại lý

Tạo Google Sheet mới với **đúng các cột sau** (hàng đầu tiên là tên cột):

| tinh | ten_tinh | quan_huyen | ten_dai_ly | dia_chi | maps_url |
|------|----------|------------|------------|---------|----------|
| thanhhoa | Thanh Hóa | TP Sầm Sơn | Tùng Anh Sport | 173 Lê Lợi, Trường Sơn, TP Sầm Sơn | https://maps.google.com/?q=... |
| lamdong | Lâm Đồng | TP Bảo Lộc | Tâm Sport | 205 Hà Giang, TP Bảo Lộc | https://maps.google.com/?q=... |
| hcm | TP Hồ Chí Minh | Quận Gò Vấp | Đức Tài Sport | 210 Phạm Văn Chiêu, Q. Gò Vấp | https://maps.google.com/?q=... |
| dongthap | Đồng Tháp | TP Cao Lãnh | Minh Luận Sport | 235A Hùng Vương, P1, TP Cao Lãnh | https://maps.google.com/?q=... |
| danang | Đà Nẵng | Quận Hải Châu | 11 Sport | 24 Tố Hữu, Hòa Cường Nam, Q. Hải Châu | https://maps.google.com/?q=... |
| binhdinh | Bình Định | TP Quy Nhơn | TGCB | 274 Nguyễn Thị Định, TP Quy Nhơn | https://maps.google.com/?q=... |
| tuyenquang | Tuyên Quang | TP Tuyên Quang | Dũng Giang | 285 Quang Trung, TP Tuyên Quang | https://maps.google.com/?q=... |
| daklak | Đắk Lắk | Tuy Hòa | Phước Hiền Sport | 291 Trường Chinh, Tuy Hòa | https://maps.google.com/?q=... |
| sonla | Sơn La | TX Sơn La | Sơn La Sport | 299 Đường Chu Văn Thịnh, TX Sơn La | https://maps.google.com/?q=... |

> **Lưu ý cột `tinh`**: Dùng chữ thường, không dấu, không khoảng trắng
> (ví dụ: `hcm`, `danang`, `binhdinh`...)
> Nếu thêm tỉnh mới, tự đặt tên tùy ý theo quy tắc trên.

### Bước 2: Xuất bản Google Sheet ra CSV

1. Mở Google Sheet → **File** → **Chia sẻ** → **Xuất bản lên web**
2. Cột trái chọn tên sheet (ví dụ: "Dai_ly")
3. Cột phải chọn **Giá trị được phân tách bằng dấu phẩy (.csv)**
4. Bấm **Xuất bản** → Copy link được cấp

### Bước 3: Dán link vào index.html

Mở file `index.html`, tìm dòng:
```javascript
const SHEET_DAI_LY = 'PASTE_YOUR_SHEET_CSV_LINK_HERE';
```
Thay bằng link vừa copy:
```javascript
const SHEET_DAI_LY = 'https://docs.google.com/spreadsheets/d/e/xxxxx/pub?output=csv';
```

### Bước 4: Đẩy lên GitHub

```bash
git add index.html
git commit -m "feat: kết nối Google Sheets đại lý"
git push origin main
```

### Bước 5: Deploy Netlify

1. Vào **netlify.com** → Sign up / Login
2. **Add new site** → **Import from Git** → **GitHub**
3. Chọn repo `lotto-landingpage`
4. Build command: *(để trống)*
5. Publish directory: `.` (dấu chấm)
6. **Deploy site**
7. Netlify tự cấp link dạng `https://xxx.netlify.app`
8. Có thể đổi tên thành `https://lotto-thu-cu-doi-moi.netlify.app`

---

## PHẦN 1B — Cài đặt ảnh "Trước & Sau Khi Đổi" (Admin thực hiện 1 lần)

### Bước 1: Tạo Google Sheet ảnh trước/sau

Tạo Google Sheet mới với **đúng các cột sau** (hàng đầu tiên là tên cột):

| ten_khach | mau_giay | mo_ta | anh_truoc | anh_sau |
|-----------|----------|-------|-----------|---------|
| Anh Tuấn - Sầm Sơn | RAPTOR 300 | Đôi giày cũ mòn đế sau 2 năm sử dụng đã được lên đời thành RAPTOR 300 chính hãng | https://drive.google.com/... | https://drive.google.com/... |
| Chị Lan - Bảo Lộc | MIRAGE 700 | Giày rách mũi được đổi ngay sang MIRAGE 700 mới cứng chỉ trong 15 phút | https://drive.google.com/... | https://drive.google.com/... |

- **ten_khach**: Tên khách hàng hoặc mô tả ngắn (hiển thị dưới ảnh)
- **mau_giay**: Mẫu giày mới khách đã đổi (không bắt buộc)
- **mo_ta**: Câu chuyện / cảm nhận do team viết, hiển thị thành đoạn text nhỏ dưới cùng thẻ (không bắt buộc, để trống sẽ không hiện dòng này)
- **anh_truoc**: Link ảnh đôi giày cũ — xem cách lấy link ở Bước 2
- **anh_sau**: Link ảnh đôi giày mới

> Nếu để trống `anh_truoc` hoặc `anh_sau`, khung ảnh sẽ hiện "Chưa có ảnh" thay vì lỗi.

### Bước 2: Lấy link ảnh public

1. Upload ảnh lên **Google Drive**
2. Chuột phải ảnh → **Chia sẻ** → **Bất kỳ ai có đường liên kết** → Người xem
3. Copy link, đổi định dạng thành link ảnh trực tiếp:
   `https://drive.google.com/uc?export=view&id=FILE_ID`
   (FILE_ID lấy từ link chia sẻ gốc, đoạn giữa `/d/` và `/view`)
4. Dán link này vào cột `anh_truoc` / `anh_sau`

### Bước 3: Xuất bản Sheet ra CSV và dán vào file HTML

1. Mở Sheet → **File** → **Chia sẻ** → **Xuất bản lên web**
2. Chọn sheet vừa tạo → định dạng **CSV** → **Xuất bản** → Copy link
3. Mở file `LandingPage_ThuCuDoiMoi_Lotto2026.html`, tìm dòng:
```javascript
const SHEET_TRUOC_SAU = 'PASTE_YOUR_SHEET_CSV_LINK_HERE';
```
4. Thay bằng link vừa copy, sau đó `git add`, `git commit`, `git push` như Bước 4-5 ở Phần 1

---

## PHẦN 2 — Team MKT cập nhật hàng ngày

### Thêm đại lý mới

1. Mở Google Sheet (đã có link sẵn)
2. Thêm 1 dòng mới với đầy đủ các cột
3. **Lưu là xong** — trang tự cập nhật khi người dùng load lại

### Xóa đại lý

1. Mở Google Sheet
2. Xóa dòng của đại lý cần xóa
3. Lưu là xong

### Sửa thông tin đại lý (địa chỉ, tên...)

1. Mở Google Sheet
2. Sửa trực tiếp ô cần thay đổi
3. Lưu là xong

### Lấy link Google Maps cho đại lý mới

1. Vào **maps.google.com**
2. Tìm địa chỉ đại lý
3. Bấm **Chia sẻ** → Copy link ngắn
4. Dán vào cột `maps_url` trong Sheet

### Thêm ảnh "Trước & Sau Khi Đổi" mới

1. Mở Google Sheet ảnh trước/sau (đã có link sẵn, xem Phần 1B)
2. Thêm 1 dòng mới: tên khách, mẫu giày, link ảnh trước, link ảnh sau
3. **Lưu là xong** — trang tự cập nhật khi người dùng load lại

---

## PHẦN 3 — Thay đổi cần Dev (push lên GitHub)

Các thay đổi sau cần sửa `index.html` và push lên GitHub (Netlify tự deploy):

| Thay đổi | Ví dụ |
|----------|-------|
| Ngày kết thúc chương trình | Đổi countdown date |
| Thông tin sản phẩm / giá | Thêm/xóa mẫu giày |
| Màu sắc, font chữ, layout | Thiết kế lại section |
| Thông tin footer (hotline, địa chỉ) | Đổi SĐT |
| Text hero, tagline | Đổi slogan |

---

## Liên hệ hỗ trợ

- **Hotline nội bộ**: 0964 890 686
- **Email**: contact@nero.com.vn
