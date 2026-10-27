# Tĩnh Huyền Các

Ứng dụng cờ vua chạy local: đồng bộ ván cờ, quản lý thư viện, giải vòng tròn/Swiss/loại trực tiếp và đấu trường arena.

## Chuẩn bị đối thủ

Mở **menu bát quái → Chuẩn bị đối thủ** (`/opponents.html`). Nhập nick hoặc đường dẫn hồ sơ Chess.com/Lichess, chọn khoảng 30 ngày đến 2 năm, tốc độ cờ và tối đa 500 ván gần nhất. Ứng dụng tải tuần tự bằng API công khai, chỉ giữ ván cờ tiêu chuẩn đã kết thúc và có kỳ phổ hợp lệ; không cần mật khẩu tài khoản hoặc dịch vụ AI trả phí. Có thể nhập bộ PGN tối đa 8 MB thay cho tải qua mạng.

Hồ sơ gồm khai cuộc và nhánh nước đi theo màu quân, kết quả theo tốc độ, rating trong mẫu, thói quen có số ván làm căn cứ, bàn cờ phát lại và kế hoạch chuẩn bị. Mỗi nhận xét có ván dẫn chứng khi có dữ liệu. Tỷ lệ thắng và điểm số được tách riêng; thiếu đồng hồ hoặc đánh giá engine hiện là thiếu dữ liệu, không được coi là không có lỗi. Chọn đúng tốc độ của giải trước khi kết luận; vài ván thua không chứng minh một điểm yếu cố định hoặc dự báo thứ hạng ở giải trực tiếp.

Mở ván dẫn chứng → **Phân tích Stockfish** để tính bằng engine local hiện có. Sau đó về hồ sơ → **Cập nhật từ phân tích đã lưu** để ghép các đánh giá vào cùng mẫu ván, không tải hoặc phân tích lại. Chỉ dùng các kết quả phân tích thường; không đọc các ván trong két mã hóa. Hồ sơ cũng sử dụng đánh giá đã có trong PGN nếu nguồn cung cấp, ghi rõ độ phủ và độ sâu; kết quả chưa đạt độ sâu có nhãn ước tính.

Hồ sơ, tên riêng, ghi chú và kỳ phổ được lưu trong SQLite ở bảng riêng, không trộn với kho ván cá nhân. Mở lại không chạy thu thập. **Cập nhật ván mới** chủ động tải lại cùng bộ lọc; nếu tải lỗi, hồ sơ cũ được giữ. Có tải PGN, in/lưu PDF bằng trình duyệt, đổi tên và xóa riêng từng hồ sơ. Với PGN không rõ rated/casual, bộ nhập không áp dụng bộ lọc rated. Ván thiếu ngày vẫn được ghi rõ là chưa xác minh khoảng thời gian.

Sau khi cập nhật mã, khởi động lại backend để thêm bảng dữ liệu tự động và Ctrl+F5 để nạp menu mới. Chức năng này nằm trong ứng dụng Python chính, chưa có bản triển khai riêng cho Worker trong `sites/arena`.

Đối chiếu API: [Chess.com PubAPI](https://www.chess.com/news/view/published-data-api), [Lichess API](https://lichess.org/api#tag/Games/operation/apiGamesUser). Chess.com có thể lưu đệm dữ liệu đến 12 giờ; lỗi giới hạn lượt tải được hiển thị để thử sau. Tĩnh Huyền Quán là ứng dụng độc lập, không liên kết với hai nền tảng.

Kiểm tra riêng tính năng: trong `backend`, chạy `python -m unittest discover -s tests -p test_opponents.py -v` và `node tests/opponents-workflow.test.cjs`. Kiểm thử dùng tài khoản/kỳ phổ giả và HTTP mock, không thu thập dữ liệu đối thủ thật.

## Chạy trên Windows PowerShell

Tại thư mục chứa `backend` và `data`:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:ADMIN_PASSWORD="mat-khau-rieng-cua-ban"
# Không cần hai dòng dưới nếu không dùng đồng bộ.
$env:CHESSCOM_USER="username-chesscom"
$env:LICHESS_USER="username-lichess"
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Mở http://localhost:8000. `ADMIN_PASSWORD` không còn giá trị mặc định. Khi chưa cấu hình, thao tác xóa giải bị khóa; các chức năng khác vẫn dùng được. Biến môi trường phải được đặt trước khi khởi động server. `.env` không tự được đọc.

Nếu PowerShell chặn script kích hoạt, có thể dùng trực tiếp `.\.venv\Scripts\python.exe` thay cho `python` trong hai lệnh cài thư viện/chạy server.

## Thư viện và truy cập từ máy khác

Mặc định thư viện nằm trong `data/library`. Muốn dùng thư mục khác, đặt trước khi chạy server:

```powershell
$env:LIBRARY_DIR="D:\SachCoVua"
$env:MASTER_URL="http://localhost:1234/chat" # tùy chọn chatbot
```

API quét chỉ nhận thư mục bên trong `LIBRARY_DIR`. API tải file cũng kiểm tra ranh giới này; file nằm ngoài vùng được cấu hình không được phục vụ. Đổi tên/chuyển file bên trong thư viện rồi quét lại sẽ cập nhật đường dẫn theo SHA1, giữ ID, ghi chú, nhãn và yêu thích. Các bản sao giống hệt nhau dùng một mục thư viện.

Khi cần truy cập qua LAN hoặc tunnel, cấu hình mật khẩu truy cập cho toàn bộ giao diện và API:

```powershell
$env:ACCESS_PASSWORD="mat-khau-truy-cap-rieng"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Trình duyệt sẽ hỏi đăng nhập HTTP Basic (tên đăng nhập có thể nhập `admin`). Nếu không đặt `ACCESS_PASSWORD`, ứng dụng vẫn không yêu cầu đăng nhập; mặc định chỉ chạy trên `127.0.0.1`. HTTP Basic cần HTTPS khi truy cập qua mạng không tin cậy. Mật khẩu xóa giải `ADMIN_PASSWORD` được kiểm tra riêng.

## Cập nhật bản cũ

1. Tắt server và sao lưu `data/app.db` trước khi thay mã nguồn.
2. Chép đè phần mã nguồn `backend`; giữ database và thư viện đang dùng. Bản zip chứa database gốc chưa bị sửa, nhưng không nên chép nó đè lên database mới hơn trên máy bạn.
3. Cài lại dependencies nếu cần; cấu hình `ADMIN_PASSWORD` rồi chạy lại.
4. Lịch đã ghép giữ nguyên. Chỉ lịch vòng tròn tạo mới dùng Berger. Ghép lại bảng đã có kết quả cần xác nhận; API trực tiếp phải có `?force=true`.

Arena cũ có trạng thái “chờ” sai sẽ được đối chiếu với ván còn mở trước khi ghép tiếp. Bản sửa không tự hủy ván trùng hoặc sửa kết quả cũ. Xem thêm `FIXES.md`.

## Kiểm thử

Tại thư mục `backend`:

```powershell
python -m unittest discover -s tests -v
node tests/arena-clock.test.cjs
node tests/arena-workflow.test.cjs
```

Python dùng database tạm, không mở database thật. JavaScript được mô phỏng bằng Node.js, không cần cài package npm. Kiểm thử đồng bộ dùng phản hồi giả, không gọi chess.com/Lichess thật.

## Git

Repo gốc nằm trong `backend/.git`. Bản sửa giữ repo và đã tạo commit local, loại `.pyc` khỏi danh sách được theo dõi. Chưa push GitHub. `backend/.gitignore` bỏ qua `.venv`, cache và `.env`; `.gitignore` ở thư mục ngoài cũng bỏ qua database/WAL và thư viện cá nhân. Không đưa mật khẩu hoặc database vào commit.

## Bảng tự đặt tên và thể lệ

Trong Tạo giải mới, chọn Tự tạo bảng: nhập U6/U7 mỗi tên một dòng hoặc để trống để thêm bảng sau. Mỗi bảng chọn người riêng, không cần biết trước số lượng. Bốc thăm tự động vẫn có trong Cách tạo bảng. Mở giải để sửa tên bảng, thêm người trước khi ghép, và lưu thể lệ/ghi chú. Cập nhật tính năng này cần thay db.py, routers/arena.py và hai trang static/arena.html, static/arena-live.html trong backend, sau đó khởi động lại server. Giữ nguyên database đang dùng.

## Điều hành và in giải

Mở **Đấu Trường → Các giải đấu** rồi chọn giải. Mỗi giải có trang riêng `/tournament.html?id=...`, có thể lưu dấu trang. Chọn **Theo dõi bảng** để xem một bảng hoặc tất cả. **In danh sách**, **In lịch đấu**, **In xếp hạng** dùng phạm vi đang chọn; hộp thoại in của trình duyệt cũng cho phép lưu PDF. Bản in xếp hạng ghi rõ tạm thời khi giải chưa kết thúc. Thể thức và danh sách mỗi bảng được khóa sau khi ghép cặp.

Khi cập nhật giao diện, sao chép đủ `backend/static/arena.html`, `arena.js`, `arena.css` và `tournament.html`, rồi tải lại trang với Ctrl+F5. Giữ nguyên cơ sở dữ liệu hiện có.

## Thư phòng: tủ sách và quét thế cờ

Mở **Thư phòng** để đọc tủ sách mới, nhập sách ngoại tuyến `.thcbook`, tìm kiếm theo tên/chủ đề và thêm sách về sau. Tủ sách không còn đặt trong Tàng Kinh Các. Nội dung đã nhập vẫn dùng cơ sở dữ liệu hiện có.

Bấm **Quét thế cờ từ PDF** để chọn/tải PDF và luyện tập với các hình bàn cờ. Công cụ giữ kết quả quét, ghi chú và dấu sách cũ; mở lại không cần nhận diện lại. Quét không phụ thuộc bộ dịch hoặc OCR. Hướng dẫn cài bộ quét local nằm trong `backend/README.md`.

Giao diện Thư phòng/dịch cũ đã được thay; API và dữ liệu dịch đã lưu vẫn được giữ. Các đường dẫn PDF cũ tự chuyển tới công cụ quét. Sau khi cập nhật toàn bộ mã nguồn, khởi động lại backend và tải lại trang với Ctrl+F5.

Gói `.thcbook` cũng hỗ trợ bài tập tương tác: mở sách → **Vào luyện tập**, giải trên bàn cờ với đáp án ẩn, gợi ý, đáp trả theo lời giải, ghi chú và ôn bài. Nước ngoài lời giải không tự bị chấm là nước xấu. Nguồn chưa xác minh có nhãn riêng và không tự chấm; xem `backend/README.md`.


## Đấu trường mới — thay trực tiếp trang cũ

Trang `/arena.html`, `/tournament.html` và `/arena-live.html` trong `backend/static` đã sử dụng giao diện điều hành mới, giữ header gốc và cùng cơ sở dữ liệu. Danh sách kỳ thủ, mã giải, bảng, lịch đấu, kết quả và chỉ số đã có được giữ nguyên; các cột thông tin giải được bổ sung bằng migration idempotent khi backend khởi động. Không cần chuyển dữ liệu sang website riêng.

Sau khi cập nhật repo bằng `git pull`, khởi động lại backend đang chạy, rồi mở lại `/arena.html`. Nếu tab cũ còn giữ giao diện trước đó, dùng Ctrl+F5. Menu bát quái vẫn mở đúng đường dẫn Đấu trường như trước.

Tính năng bổ sung: thêm từng kỳ thủ, thông tin địa điểm/ban tổ chức/trọng tài/thời gian mỗi bên, chọn nguồn lịch Swiss, kiểm tra lịch, xuất/khôi phục toàn giải và bảo vệ kết quả khi mở nhiều cửa sổ. Mật khẩu quản trị để xóa giải của bản Python được giữ nguyên.

Bản Sites của web chính sử dụng cùng Site ID và D1 đã có; cập nhật mã không cấp lại kho dữ liệu hoặc tài khoản. Mã nguồn mô-đun độc lập vẫn có ở `sites/arena` để tham khảo; phần chạy trong web chính là `backend/static` + `backend/routers/arena.py`.
