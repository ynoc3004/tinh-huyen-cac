# Ghi chú bản sửa

## Đã sửa

- Vòng tròn dùng Berger, cân bằng màu và chuỗi màu; không đổi lịch đã lưu.
- Đồng hồ arena không gọi lại API vô hạn khi bằng 0. Nút In chỉ gắn listener một lần. API trả ngay trạng thái finished khi hết giờ.
- Arena chỉ ghép khi running; nút ghép ẩn trước/sau giải. Ghép cặp dùng transaction khóa ghi, đối chiếu ván còn mở và không xếp một người vào hai ván mới.
- Bắt đầu arena giữ trạng thái playing cho người đang có ván mở từ bản cũ.
- Bảng đã có kết quả trả 409 khi ghép lại; force=true chỉ được giao diện gửi sau xác nhận xóa kết quả.
- Swiss dừng theo recommended_swiss_rounds. Ván nghỉ không nhận kết quả thủ công.
- Arena lọc bye trước khi đánh số bàn. Lịch sử có tên cả người đã bị loại khỏi arena.
- Tham số số bảng, cỡ bảng, số người vào chung kết, thời lượng được kiểm tra bằng Pydantic; danh sách ID được loại trùng và kiểm tra tồn tại. Chuyển bảng kiểm tra giải/bảng/học viên và chặn sau khi đã ghép để không làm lệch lịch đã lưu.
- chess.com và Lichess có transaction riêng. Lỗi HTTP/JSON/dữ liệu từ một nền tảng không rollback nền tảng khác; phản hồi chứa errors. Chỉ lưu ván Lichess đã kết thúc, bỏ aborted/created/started.
- Làm mới tự động bỏ qua khi có dữ liệu form chưa lưu hoặc con trỏ trong input/select/textarea; đồng hồ vẫn chạy. Nút Làm mới thủ công có thể nạp lại dữ liệu.
- Thư viện cập nhật đường dẫn theo SHA1 khi file cũ đã được chuyển/đổi tên, giữ metadata; chặn quét/tải ngoài LIBRARY_DIR, bỏ qua symlink khi quét.
- Học viên trùng tên có lựa chọn Cho phép người trùng tên; phản hồi API nêu rõ tên/ID bị bỏ qua. Thêm người mới vào arena dùng ID vừa tạo, không suy đoán danh tính bằng tên.
- Chế độ cân bằng báo rõ nếu chưa có rating; không tự tạo rating giả.
- Bỏ mật khẩu xóa mặc định. Có ACCESS_PASSWORD tùy chọn bảo vệ giao diện và API bằng HTTP Basic.
- Bỏ mã arena cũ không còn dùng, handler bị gán hai lần, import thừa; escape dữ liệu trang chủ.
- SQLite bật WAL, thêm index pairings(group_id), đóng connection sau mỗi transaction.
- README PowerShell, bộ kiểm thử và gitignore cập nhật. Bỏ theo dõi cache Python. Zip không chứa .venv và cache trong cây làm việc.

## Kiểm tra đã chạy

- 16 bài unittest API/logic đạt, bao gồm Berger cho n=1..60 và ghép arena đồng thời.
- Mô phỏng JavaScript đạt: hết giờ không lặp API, chỉ một listener In, giữ form đang nhập, cú pháp script của bốn trang.
- Database đính kèm so sánh SHA256 với database gốc trong zip, giữ nguyên từng byte.

## Dữ liệu và giới hạn

Không sửa dữ liệu giải cũ, không đổi rating, không tự hủy ván hoặc đổi kết quả. Với arena từng có ván trùng từ bản cũ, hệ thống ngăn ghép thêm những người đang bận; ban tổ chức vẫn cần kiểm tra và giải quyết các ván cũ. Lịch màu cũ chỉ thay đổi nếu chủ động ghép lại (và xác nhận xóa kết quả nếu đã có).

Chưa kiểm thử thao tác in trong trình duyệt thật, kết nối các nền tảng thật, hoặc chạy trên Windows. Các phép thử này dùng FastAPI TestClient, HTTP giả và mô phỏng DOM/timer. Chưa push GitHub; commit chỉ ở repo local trong bản zip.

## Cập nhật giao diện dễ sử dụng

- Ba mục riêng: Các giải đấu, Tạo giải mới, Học viên. Mặc định mở danh sách giải.
- Tìm tên, lọc trạng thái, ưu tiên giải đang chạy. Arena chỉ xuất hiện ở danh sách Arena; thao tác xóa nằm trong Tùy chọn.
- Tạo giải theo ba bước: loại giải, thiết lập, người tham gia. Danh sách chọn dùng chung cho giải theo vòng và Arena; số người và tóm tắt cấu hình luôn rõ ràng.
- Thông báo thiếu rating nằm dưới ô chọn; không còn tràn sang cột khác. Số bảng cố định, seed và tránh trùng đơn vị vẫn có trong Tùy chọn bốc thăm.
- Học viên có bảng tìm kiếm riêng, giữ nhập tay, CSV và cho phép người trùng tên.
- Khi điều hành giải, chỉ số kỹ thuật/chiến thuật và danh sách kỳ thủ được thu gọn; vẫn giữ đầy đủ ghép lại, Swiss, chung kết, kết quả, in và trình chiếu.
- Bố cục co về một cột trên điện thoại. Kiểm tra Chromium ở 1200px và 390px: không lỗi JavaScript, không tràn ngang trang. Kiểm thử luồng bốc thăm/chốt giải, lựa chọn Arena, chọn người và tìm học viên đạt. Bộ 16 kiểm thử Python và hai mô phỏng JavaScript đều đạt.

Để chỉ cập nhật giao diện, chép đè `backend/static/arena.html` từ zip rồi nhấn Ctrl+F5 trên trình duyệt. Không cần thay database hoặc sửa cấu hình backend. Không chép đè `data/app.db` đang sử dụng.

## Bảng tùy chọn và thông tin giải

Tạo giải mới mặc định dùng “Tự tạo bảng (U6, U7…)”. Có thể nhập mỗi tên một dòng hoặc để trống để tạo giải trước. Không cần nhập số người, số người mỗi bảng có thể khác nhau, các bảng có thể còn trống.

Mở giải để dùng “Thêm bảng”, “Đổi tên bảng”, “Chọn / thêm người” và “Xóa bảng trống”. Danh sách chỉ sửa được trước khi chính bảng đó ghép cặp. Người đã ở bảng khác không được chọn trùng. Có thể chuyển giữa hai bảng chưa ghép dù bảng khác trong giải đã bắt đầu. Đổi tên không ảnh hưởng lịch hoặc kết quả. Cách bốc thăm tự động vẫn giữ và có thể sửa tên bảng trong phần xem trước.

Thông tin giải lưu tên, ngày/thời gian và ghi chú/thể lệ. Arena cũng có mục lưu ghi chú riêng. Database tự thêm cột notes khi server khởi động; không sửa database gốc trong zip. Đã chạy 18 bài unittest và hai kiểm thử JavaScript, cùng kiểm thử Chromium với API thật qua TestClient trên database tạm: U6/U7 có 3/5 người, không chọn trùng người, sửa ghi chú, thêm bảng, khóa danh sách sau ghép và đổi tên giữ lịch. Kiểm tra màn hình 390px không tràn ngang.

Cập nhật lần này cần thay `backend/db.py`, `backend/routers/arena.py`, `backend/static/arena.html`, `backend/static/arena-live.html`, rồi tắt/chạy lại server và Ctrl+F5. Giữ nguyên database trên máy, không chép app.db từ zip đè lên dữ liệu đang sử dụng.

## Nhập học viên trực tiếp vào từng bảng

Mỗi bảng chưa ghép cặp có ô “Nhập học viên vào bảng”, mở sẵn khi bảng trống. Dán mỗi dòng theo thứ tự tên, rating, đơn vị (rating/đơn vị tùy chọn), rồi bấm “Thêm vào bảng”. Thao tác lưu học viên mới và đưa vào bảng trong một transaction. Học viên đã có được dùng lại, nhập lặp không tạo trùng trong bảng. Nếu người đã thuộc bảng khác hoặc có nhiều người trùng tên/đơn vị, toàn bộ lần nhập bị từ chối và giữ nội dung đang dán để sửa; không để lại học viên mới không được xếp vào bảng. Bảng đã ghép không nhận thêm người.

Đã bỏ nút và API sinh dữ liệu mẫu tự động theo yêu cầu người dùng. Dữ liệu mẫu có thể dán trực tiếp vào các ô mới. Kiểm thử 19 bài Python và hai bài Node đạt; Chromium xác minh nhập trực tiếp, không bỏ sót tên bắt đầu “Học viên”, bỏ qua dòng nhập lặp và giữ nội dung khi người thuộc bảng khác. Màn hình 390px không tràn ngang.

Cập nhật hai file backend/routers/arena.py và backend/static/arena.html, khởi động lại server và Ctrl+F5. Giữ nguyên database đang dùng.

- Mỗi bảng chọn riêng Vòng tròn hoặc Swiss; bỏ thể thức chung khỏi màn hình tạo giải. Bốc thăm cho phép chọn ở từng bảng xem trước. Chỉ đổi trước khi ghép cặp, giữ lịch và kết quả cũ.

- Tách trang điều hành mỗi giải tại tournament.html?id=..., dùng chung arena.js / arena.css. Có tổng quan, lọc bảng, điều hướng nhanh, thu gọn thiết lập và thao tác ghép lại. Bản in A4 riêng cho danh sách / lịch / xếp hạng, theo bảng đã chọn hoặc toàn giải. Đã kiểm tra bằng Chromium với API thật trên DB tạm, xuất PDF và kiểm tra màn hình 390px.
