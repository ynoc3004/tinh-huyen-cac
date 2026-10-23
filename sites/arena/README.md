# Đấu trường · Tĩnh Huyền Các

Website riêng tư trên Sites; dữ liệu lưu Cloudflare D1, tách theo tài khoản ChatGPT. Không cần chạy máy chủ Python trên máy cá nhân. Mô-đun độc lập có thể đặt ở `sites/arena` trong repo GitHub; dữ liệu và website gốc được giữ nguyên.

## Nguồn

- Repo: https://github.com/ynoc3004/tinh-huyen-cac
- Commit đã kiểm tra: `ee10ee206aa77d8ebf28820b994abe9c2b550edd`.
- Đấu trường (`arena.py`, `pairing.py`, các trang) không thay đổi so với nguồn bản chuyển đổi trước; phần JS/D1 được giữ và kiểm thử đối chiếu với Python hiện tại.
- `upstream/backend/services/pairing.py` giữ thuật toán Python gốc làm tài liệu và kiểm thử đối chiếu; các tệp này không phải máy chủ triển khai. Mã chạy nằm ở `lib/tournament/` và `app/api/`.

## Header gốc

Sử dụng nguyên bản `tien-canh.js`, `tien-canh.css`, `thien-co.js` từ repo: logo âm dương, tên Tĩnh Huyền Quán, bát quái xoay, menu điều hướng, đổi font và thiên sắc. `arena-shell.js` chỉ thêm tiện ích giải và chuyển đường dẫn các mô-đun khác sang website chính; không tạo header khác.

## Chức năng

- Tạo giải rỗng, số bảng và quân số linh hoạt; tự đặt tên U6, U7…
- Chọn vòng tròn / Swiss cho từng bảng, chốt số vòng trước thi đấu.
- Chọn nguồn Swiss: thuật toán ứng dụng hoặc lịch do trọng tài cung cấp.
- Thông tin giải: ngày giờ, địa điểm, thời gian mỗi bên, đơn vị tổ chức, trọng tài và thể lệ.
- Nhập từng kỳ thủ, nhiều dòng, CSV UTF-8, danh sách có sẵn; chuyển bảng trước bốc thăm.
- Trang điều hành riêng; lọc bảng / vòng; nhập kết quả và bốn chỉ số ván; xác nhận hàng loạt; trình chiếu.
- Chung kết loại trực tiếp, Swiss hoặc vòng tròn; chặn suất chọn còn đồng hạng.
- Arena theo thời lượng được giữ nguyên.
- In A4 theo bảng, lịch hoặc xếp hạng, có thông tin giải và vùng ký xác nhận.
- Nhật ký; xuất sao lưu toàn giải; khôi phục thành giải mới.
- Bảo vệ cập nhật đồng thời bằng giao dịch D1, revision và kiểm tra dữ liệu ván trước khi ghi.

## Sửa đúng đắn

Lịch vòng tròn mới dùng đúng thứ tự và màu theo bảng Berger FIDE (mục 13.17), lưu thứ tự số bốc thăm trong giải và nhật ký. Lịch cũ được giữ trong bản sao lưu; không tính lại lịch đã nhập.

Điểm và hệ số giữ nguyên: Swiss ĐĐ → BH-C1 → BH → SB → thắng trên bàn; vòng tròn ĐĐ → SB → thắng trên bàn. SB bằng tổng tích điểm đối thủ với điểm đạt trong ván. Bye Swiss nhận 1 điểm, đối thủ giả bằng điểm bản thân nhưng tối đa nửa số vòng, theo quy tắc hiệu lực 01/03/2026 trong phạm vi dữ liệu hỗ trợ. Vòng tròn nghỉ không cộng điểm. Bằng tất cả tiêu chí vẫn đồng hạng.

Swiss tự động chưa được chứng nhận FIDE Dutch. Ứng dụng không hỗ trợ xử thắng/thua vắng mặt, xin nghỉ, bỏ cuộc, vào muộn, điều chỉnh điểm hoặc hệ số tùy chọn. Giải tính Elo FIDE hoặc có các trường hợp này cần phần mềm trọng tài phù hợp làm nguồn chính thức. Không ghi kết quả xử thắng thành ván đã thi đấu.

## Kiểm thử

```bash
THC_TEST_PYTHON=/path/to/python-with-networkx npm test
node node_modules/typescript/bin/tsc --noEmit
node /path/to/sites/scripts/build-site.mjs
```

Xem `VALIDATION.md` cho kết quả và giới hạn kiểm tra. Không có dữ liệu giải mẫu hoặc kỳ thủ thử nghiệm trong cơ sở dữ liệu triển khai.

## Nguồn quy tắc

- https://handbook.fide.com/files/handbook/C02Standards.pdf — 13.17 Berger.
- https://handbook.fide.com/chapter/TieBreakRegulations032026 — hệ số phụ, điều 16 về ván không thi đấu.
