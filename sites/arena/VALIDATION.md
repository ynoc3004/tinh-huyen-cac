# Kiểm tra ngày 23/10/2026

## Repo nguồn hiện tại

Commit `ee10ee206aa77d8ebf28820b994abe9c2b550edd`; giữ nguyên mã của các mô-đun khác.

- Python unittest: 236 bài chạy, 234 thành công, 2 bỏ qua theo điều kiện dependency.
- JavaScript: 15/15 thành công, bao gồm các phần khác trong repo để kiểm tra hồi quy.

## Bản Sites riêng

- 30/30 kiểm thử JavaScript / SQLite thành công.
- Lịch Berger: đủ mỗi cặp đúng một lần, cân bằng màu, lượt nghỉ đúng một lần khi lẻ, số người 2–65.
- Đối chiếu chính xác thứ tự bảng Berger FIDE cho 4, 6, 8 số bốc thăm.
- 960 vòng Swiss mô phỏng: đủ người, không tái đấu, không bye lặp, giới hạn màu.
- Thêm bốn vòng ở 128 và 256 kỳ thủ.
- Blossom đối chiếu vét cạn 100 đồ thị nhỏ có trọng số âm.
- BH/SB đối chiếu 28 fixture với Python gốc; thêm fixture tính tay độc lập.
- SQLite chạy các migrations và SQL lưu D1: cách ly người dùng, giao dịch, khôi phục, chung kết, cùng lúc ghép vòng / lưu kết quả.
- Khôi phục từ chối vòng đứt, trùng bàn, tự gặp, thiếu kỳ thủ, thứ tự số bốc thăm sai; không lưu dữ liệu dở dang.
- Mô phỏng luồng trang tạo giải, điều hành, đồng hồ Arena, bản in và escaping.
- HTML không trùng ID; CSS / script / favicon tham chiếu đều tồn tại.
- Migrations áp dụng thành công vào D1 local qua Wrangler.
- TypeScript kiểm tra không phát sinh lỗi. Build Vinext thành công qua các giai đoạn.

## Header gốc

- `tien-canh.js` và `tien-canh.css` có SHA-256 trùng khớp nguyên bản trong repo.
- Thêm kiểm thử thực thi menu bát quái: mở/đóng, Escape, focus, điều hướng, không lặp header, lưu font/thiên sắc.

## Giới hạn

Trình duyệt kiểm tra bị chính sách môi trường chặn truy cập preview. Chưa xác minh trực quan giao diện desktop/mobile hoặc bản in trên trình duyệt/máy in thật. Kiểm thử luồng và bản in ở mức mã/DOM giả lập.

Không chứng nhận FIDE cho thuật toán Swiss. Xem hướng dẫn trong website để biết phạm vi hỗ trợ cho giải chính thức và các trường hợp chưa hỗ trợ.
