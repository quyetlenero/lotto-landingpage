/**
 * Form THU CŨ ĐỔI MỚI (thucudoimoi.lottosports.vn) → ghi THẲNG vào SỔ BÁN LẺ.
 *
 * Sếp chốt 12/09/2026: cả công ty chỉ dùng HAI sổ — SỔ BÁN LẺ và SỔ BÁN SỈ. Trước đây form ghi vào
 * sổ "Đăng Ký Đổi Giày", rồi 7h sáng hôm sau Apps Script của sổ bán hàng mới gom sang. Nay bỏ chặng
 * giữa: khách điền xong là có mặt trong SỔ BÁN LẺ ngay, đội sale không phải mở sổ thứ ba.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG XOÁ FILE "Đăng Ký Đổi Giày". Mã này GẮN VÀO chính file đó (bound script) —
 * ở Apps Script, xoá file bảng tính là xoá luôn mã nằm trong nó, và form trên website chết ngay.
 * File đó nay chỉ còn là VỎ CHỨA MÃ: không ai nhìn, không nhận dòng mới.
 *
 * GHI THEO TÊN CỘT, KHÔNG theo vị trí. SỔ BÁN LẺ đã đổi bố cục một lần rồi (12/09/2026 chèn thêm
 * hai cột chăm sóc). Ghi theo số thứ tự cột thì lần đổi bố cục sau sẽ đẩy dữ liệu sang nhầm ô —
 * không lỗi nào báo, chỉ có số điện thoại nằm ở cột ghi chú.
 *
 * KHÔNG BAO GIỜ ĐƯỢC MẤT MỘT ĐĂNG KÝ. Ghi sang SỔ BÁN LẺ mà hỏng vì bất cứ lý do gì thì rơi về ghi
 * tại chỗ đúng như bản cũ; lượt gom hằng ngày vẫn vớt được. Thà một dòng thừa còn hơn mất một khách.
 *
 * Đổi mã xong phải: Lưu → Triển khai → Quản lý tùy chọn triển khai → bút chì → Phiên bản mới.
 * Đi đúng đường "Quản lý" thì ĐƯỜNG DẪN GIỮ NGUYÊN, không phải sửa gì trên website.
 */

var SO_BAN_LE_ID = '1IexrAE_A030sOeeVkUVR-ABmTMXc_oPo1RarYTzR6jo';
var TAB_SO_BAN_LE = 'SỔ BÁN LẺ';

/** Đúng bộ từ vựng SỔ BÁN LẺ đang dùng. Gõ khác đi là các nút lọc của sổ đếm sót. */
var TEN_TRANG = 'Thu cũ đổi mới Lotto';
var KENH = 'Landing page thu cũ đổi mới';
var TRANG_THAI_MOI = 'Chưa gọi';

function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents) || {};
  } catch (err) {
    data = {};
  }

  var ketQua = 'success';
  var loi = '';
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    // Không chặn khách vì một cái khoá: cứ ghi tiếp, cùng lắm là một dòng trùng.
  }
  try {
    ketQua = ghiVaoSoBanLe_(data);
  } catch (err) {
    loi = String(err);
    ketQua = 'du-phong';
    try {
      ghiDuPhong_(data, loi);
    } catch (err2) {
      ketQua = 'that-bai';
      loi += ' · dự phòng cũng hỏng: ' + String(err2);
    }
  } finally {
    try { lock.releaseLock(); } catch (err3) {}
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result: ketQua, loi: loi }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Một đăng ký → một dòng SỔ BÁN LẺ. Trả 'success' hoặc 'da-co'. Ném lỗi nếu không ghi được. */
function ghiVaoSoBanLe_(data) {
  var sh = SpreadsheetApp.openById(SO_BAN_LE_ID).getSheetByName(TAB_SO_BAN_LE);
  if (!sh) throw new Error('Không thấy tab "' + TAB_SO_BAN_LE + '" trong SỔ BÁN LẺ');

  var soCot = sh.getLastColumn();
  var tieuDe = sh.getRange(1, 1, 1, soCot).getDisplayValues()[0];
  var cot = function (ten) {
    for (var i = 0; i < tieuDe.length; i++) {
      if (String(tieuDe[i]).trim() === ten) return i;
    }
    throw new Error('SỔ BÁN LẺ không có cột "' + ten + '" — dừng, không ghi gì');
  };
  var iMa = cot('Mã'), iNgay = cot('Ngày'), iKenh = cot('Kênh'), iTrang = cot('Trang/Website'),
    iTen = cot('Họ tên'), iSdt = cot('Số điện thoại'), iTinh = cot('Tỉnh/Thành'),
    iTT = cot('Trạng thái (máy)'), iTTNguoi = cot('Trạng thái'), iGhiChu = cot('Ghi chú');

  var so = chuanSo_(data.so_dien_thoai);
  var ten = String(data.ho_ten || '').trim();
  if (!so && !ten) throw new Error('Đăng ký không có cả tên lẫn số điện thoại');
  var ma = so ? 'doigiay:' + so : 'doigiay:' + new Date().getTime();

  // Không đẻ dòng thứ hai cho cùng một người. Hai dòng cho một khách là hai cuộc gọi cho một người,
  // và nếu nhân viên điền tiền vào cả hai thì doanh thu tính đôi.
  var n = Math.max(sh.getLastRow() - 1, 0);
  if (n > 0) {
    var cu = sh.getRange(2, 1, n, soCot).getDisplayValues();
    for (var r = 0; r < cu.length; r++) {
      if (String(cu[r][iMa]).trim() === ma) return 'da-co';
      if (so && chuanSo_(cu[r][iSdt]) === so) return 'da-co';
    }
  }

  var hang = [];
  for (var c = 0; c < soCot; c++) hang.push('');
  hang[iMa] = ma;
  hang[iNgay] = new Date();
  hang[iKenh] = KENH;
  hang[iTrang] = TEN_TRANG;
  hang[iTen] = ten;
  hang[iSdt] = so;
  hang[iTinh] = String(data.tinh_thanh || '').trim();
  hang[iTT] = TRANG_THAI_MOI;
  // Cột của người: CHỈ điền lúc tạo dòng, sau đó máy không bao giờ đụng vào nữa.
  hang[iTTNguoi] = TRANG_THAI_MOI;
  hang[iGhiChu] = ghiChu_(data);

  sh.appendRow(hang);

  // Số điện thoại phải là CHỮ, nếu không Sheets ăn mất số 0 đầu; Ngày phải là NGÀY THẬT để lọc và
  // sắp xếp theo ngày còn đúng. Đặt lại sau khi ghi vì appendRow đi theo định dạng sẵn có của ô.
  var dong = sh.getLastRow();
  if (so) sh.getRange(dong, iSdt + 1).setNumberFormat('@').setValue(so);
  sh.getRange(dong, iNgay + 1).setNumberFormat('dd/MM/yyyy').setValue(new Date());
  return 'success';
}

/** Sổ lẻ hỏng thì ghi tại chỗ như bản cũ — thà một dòng thừa còn hơn mất một khách. */
function ghiDuPhong_(data, loi) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sh.appendRow([
    new Date(),
    data.ho_ten || '',
    data.so_dien_thoai || '',
    data.tinh_thanh || '',
    data.tinh_trang_giay || '',
    'GHI DỰ PHÒNG — không ghi được sang SỔ BÁN LẺ: ' + String(loi).slice(0, 200)
  ]);
}

function ghiChu_(data) {
  var phan = ['[Form thu cũ đổi mới]'];
  if (String(data.tinh_trang_giay || '').trim()) phan.push('Giày cũ: ' + String(data.tinh_trang_giay).trim());
  return phan.join(' · ');
}

/** Cùng luật chuẩn hoá với sổ bán hàng: bỏ ký tự thừa, 84… về 0…, chỉ nhận 10–11 chữ số. */
function chuanSo_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('84') === 0 && d.length >= 11) d = '0' + d.slice(2);
  if (d && d.charAt(0) !== '0') d = '0' + d;
  return d.length >= 10 && d.length <= 11 ? d : '';
}
