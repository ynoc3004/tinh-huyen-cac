# Tĩnh Huyền Các

Ứng dụng cờ vua chạy local: đồng bộ ván cờ, quản lý thư viện, giải vòng tròn/Swiss/loại trực tiếp và đấu trường arena.

## Chạy trên Windows PowerShell

Repo này nằm trong thư mục `backend`, bên cạnh `data`. Tại thư mục đang chứa `main.py`:

```powershell
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

Tàng Kinh Các là két mã hóa (xem mục “Tàng Kinh Các: két mã hóa” cuối file). Mặc định kho nằm trong `data/library`; bạn có thể liên kết thư mục khác ngay trên giao diện, hoặc đặt trước khi chạy server:

```powershell
$env:LIBRARY_DIR="D:\SachCoVua"
$env:MASTER_URL="http://localhost:1234/chat" # tùy chọn chatbot
```


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

Arena cũ có trạng thái “chờ” sai sẽ được đối chiếu với ván còn mở trước khi ghép tiếp. Bản sửa không tự hủy ván trùng hoặc sửa kết quả cũ. Xem thêm `../FIXES.md`.

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

## Xếp hạng và hệ số phụ (FIDE)

Điểm bằng nhau được phân hạng theo 5 hệ số phụ: ĐĐ (đối đầu), BH-C1 (Buchholz bỏ 1), BH (Buchholz), SB (Sonneborn-Berger), Thắng (số ván thắng trên bàn cờ).
Thụy Sĩ: ĐĐ › BH-C1 › BH › SB › Thắng. Vòng tròn: ĐĐ › SB › Thắng › BH-C1 › BH. ĐĐ chỉ áp dụng khi mọi người trong nhóm bằng điểm đã đấu với nhau.
Ván nghỉ (bye) dùng đối thủ ảo theo quy định FIDE. Ván chưa có kết quả không được tính vào hệ số.

## Xác nhận hàng loạt và in

Trong mỗi vòng, chọn kết quả (và chỉ số nếu cần) cho nhiều ván rồi bấm “Xác nhận tất cả ván đã chọn kết quả”. Các ván thay đổi được tô nền; hệ thống lưu tất cả cùng lúc, lỗi một ván thì không lưu ván nào (`PUT /api/groups/{gid}/results/bulk`).
Mọi bản in mặc định khổ A4 ngang.

## Tàng Kinh Các: két mã hóa

- **Liên kết thư mục:** lần đầu mở /library.html, nhập đường dẫn thư mục trên laptop (ví dụ `D:\TangKinhCac`) và đặt mật khẩu. Thư mục được lưu trong `data/library_link.json` (ưu tiên hơn biến `LIBRARY_DIR`).
- **Mã hóa:** mỗi file được mã hóa AES-256-GCM, đặt tên ngẫu nhiên trong thư mục con `vault`. Mở bằng Explorer chỉ thấy dữ liệu không đọc được. Khóa suy ra từ mật khẩu bằng scrypt; file `.thc-vault.json` chỉ chứa khóa đã bọc.
- **Chỉ qua website local:** API két từ chối mọi yêu cầu không đến từ `localhost`/`127.0.0.1` trên chính máy (đặt `ALLOW_REMOTE_VAULT=1` nếu thật sự cần mở rộng).
- **Mật khẩu:** tự khóa sau 15 phút không hoạt động (`VAULT_IDLE_MIN`), nhập sai 5 lần sẽ bị chặn tạm thời. **Quên mật khẩu = mất dữ liệu**, không có cách khôi phục.
- **Thêm file:** nút “+ Thêm file” hoặc kéo thả. File thường đã nằm sẵn trong thư mục: “Mã hóa file có sẵn trong thư mục” (tùy chọn xóa bản gốc sau khi đã giải mã kiểm tra khớp).
- **Giới hạn:** tên file, ghi chú và nhãn lưu ở `data/app.db` dạng chưa mã hóa. Cần sao lưu cả thư mục két lẫn `data/app.db`. Cần `pip install -r requirements.txt` lại để có thư viện `cryptography`.


## Thư Phòng: quét ảnh và dịch chữ

Thư Phòng là màn hình đọc/dịch chung; `translate.html?id=...` chuyển sang `study.html?id=...#batch-panel`. Mục **Dịch nhiều trang** giữ khoảng trang, thuật ngữ, OCR, dừng/tiếp tục và xuất bản dịch. Bản gốc hiển thị ảnh đúng trang đang chọn.

### Quét local miễn phí

Mặc định nút **Quét trang** dùng [chessvision](https://github.com/harshitpawar64/chessvision) 0.10.0, dự án mã nguồn mở MIT, khác với dịch vụ Chessvision.ai bên dưới. Cần Python 3.11 trở lên. Từ thư mục backend, trong cùng môi trường Python đang chạy server:

```powershell
python -m pip install -r requirements-scan.txt
python setup_board_scan.py
```

Lệnh setup tải model ONNX từ Hugging Face một lần, kiểm tra SHA-256 rồi chạy thử trên CPU. Sau đó quét không cần mạng, API key hoặc phí theo lượt; ảnh sách không gửi ra ngoài. Nếu tải lỗi, setup báo lỗi và trả exit code 1. Có thể đặt `CHESSVISION_MODEL_PATH` tới cùng model đã tải/kiểm chứng để dùng offline. API quét không tự tải model hoặc tự chuyển sang dịch vụ trả phí. Dependencies quét là tùy chọn; các tính năng khác vẫn hoạt động khi chưa cài.

Backend tìm các hình bàn cờ, tận dụng vùng ảnh nhúng trong PDF, kiểm tra mẫu ô trắng/đen và chọn vùng bên trong viền trước khi nhận diện 64 ô. Model chạy CPU với tối đa hai luồng; các lần nhận diện local được xếp tuần tự. Kết quả và ảnh xem trước lưu trong két mã hóa, cache local riêng với cache Gemini. Quét thường mở cache; **Quét lại** chỉ thay cache khi thành công.

Nhận diện vẫn có thể sai, nhất là kiểu quân khác với dữ liệu huấn luyện. Độ tin cậy model không phải tỷ lệ chính xác đã kiểm chứng. Khi mở thế đã quét, các ô có điểm dưới 0,85 có viền vàng; dùng **Hiệu đính thế cờ** để sửa. Ô không có viền vàng vẫn cần đối chiếu. Hướng bàn cờ được ước lượng từ vị trí quân; lượt đi để chưa rõ và tạm chọn Trắng khi mở. Không suy đoán quyền nhập thành/bắt tốt qua đường từ ảnh. Có thể nhập đầy đủ thông tin trong FEN.

Trong **Bộ quét**, **Kiểm tra bộ quét với ảnh nhỏ** chạy ảnh bàn cờ trống 64 ô. Nó kiểm tra model chạy được, không đo độ chính xác trên sách.

### Dùng thêm Chessvision.ai

Mục **Dùng thêm Chessvision.ai** có liên kết [eBook Reader](https://ebook.chessvision.ai) và tiện ích quét ảnh, nút tải PNG đúng trang đang đọc và nhập FEN/PGN về bàn thực hành. Dùng Reader: tự mở/tải PDF, chọn hình trong Study Creator, xuất PGN rồi dùng **Nhập file PGN / FEN** trong app. Hoặc copy một FEN/PGN vào **Nhập thế cờ / ván đấu**. Hiện nhập một ván/thế mỗi lần; nếu xuất nhiều hình, xuất từng hình để mở riêng.

Đây là luồng chuyển kết quả thủ công, không phải API gọi tự động. Chưa tìm thấy API công khai được nhà cung cấp tài liệu hóa để tích hợp nhận diện trực tiếp. App không tự gửi sách, đăng ký hoặc mua thuê bao. [Reader miễn phí chỉ tương tác với hình trên vài trang đầu mỗi sách](https://chessvision.ai/docs/ebook-reader/subscription/); đầy đủ cần thuê bao riêng. Gói này không đi kèm bộ quét local.

### Gemini tùy chọn và dịch chữ

Có thể chọn Gemini trong **Bộ quét** nếu backend có `GEMINI_API_KEY`. Danh sách model lấy từ Google; khóa không gửi ra trình duyệt. `GEMINI_SCAN_MODEL` là model dự phòng cho API cũ gửi tên model trống. Gemini gửi ảnh trang tới Google, có hạn mức/phí tùy tài khoản. Không tự chuyển từ local sang Gemini. Nút kiểm tra ảnh nhỏ với Gemini gọi một yêu cầu để kiểm tra dịch vụ lúc đó; lỗi 503 từ Google vẫn có thể xảy ra.

AI dịch chữ được chọn riêng trong khung Bản dịch. Quét và dịch có trạng thái riêng, chạy đồng thời được. Đổi sách/trang/OCR tạm khóa trong lúc quét/dịch trang để tránh gắn kết quả nhầm trang. Dịch nhiều trang vẫn cho đọc trang và thử thế cờ.

### Kiểm tra bổ sung

```powershell
python -m unittest discover -s tests -v
node tests/study-workflow.test.cjs
```

API tests dùng PDF/database tạm và phản hồi giả, kiểm tra chọn local không gọi cloud, cache riêng, lỗi quét lại giữ kết quả cũ, ảnh đúng trang và khóa két. Node mô phỏng DOM/API, kiểm tra hai tác vụ độc lập, quét local mặc định, tải ảnh trang và nhập PGN. Model/detector không được tải tự động bởi tests.

Thử thực tế trên PDF London System: nhận diện 20 hình ở các trang PDF 22, 24, 26, 27, 29–44; đã đối chiếu vị trí quân với ảnh. Đây là mẫu một kiểu sách, không đại diện cho mọi PDF. Kiểu quân trong Winning Chess Strategies có trường hợp nhận nhầm; cần hiệu đính hoặc dùng nguồn nhận diện khác.


## Đạo Lộ

Trang `/dao-lo.html` lưu hồ sơ cá nhân: họ tên, đạo hiệu, sinh thần (ngày dương lịch và giờ sinh nếu biết), quê quán, chí hướng và ghi chú. Các mục đều tùy chọn. Bấm **Lưu hồ sơ** để lưu vào `data/app.db`; hồ sơ dùng chung trên các trình duyệt truy cập cùng backend. Database tự thêm bảng hồ sơ khi khởi động, giữ nguyên dữ liệu cờ hiện có.

**Pháp mạch**, **Đăng thiên lộ** và nút đồng bộ chuyển từ trang chủ sang Đạo Lộ. Quy tắc tính căn cơ và cảnh giới giữ nguyên. Trang chủ vẫn có bàn Thiên cơ, thời tiết và cảnh giới hiện tại. Chọn **Đạo lộ** trên header để mở hồ sơ. API mới: `GET /api/profile`, `PUT /api/profile`.

Kiểm tra lưu hồ sơ và nâng cấp database: `python -m unittest discover -s tests -p "test_profile.py" -v`.

## Kỳ phổ

Trang `/history.html` dành riêng cho kỳ phổ; Bí Cảnh giữ câu đố, đấu bot và công pháp. Liên kết cũ `/bi-canh.html#history` tự chuyển đến trang mới.

Chọn **Bullet**, **Blitz**, **Rapid** và nguồn Chess.com/Lichess/bot để tìm ván. Số lượng từng nhóm tính theo nguồn đã chọn; bộ lọc áp dụng trong database trước khi phân trang. Các tốc độ khác hoặc thiếu dữ liệu, cùng ván bot chưa có đồng hồ, nằm trong **Khác / Không đồng hồ**. Phân loại sử dụng dữ liệu tốc độ từ nền tảng, không suy đoán từ số nước đi. Đồng bộ, xem lại, phân tích, tải PGN và lưu vào Tàng Kinh Các vẫn dùng như trước.

Kiểm tra API và lịch sử bot: `python -m unittest discover -s tests -p "test_game_archive.py" -v` và `python -m unittest discover -s tests -p "test_bot_history.py" -v`.

## Diện mạo chung

Tất cả trang dùng `static/tien-canh.css` và `static/tien-canh.js`: màu ngọc/vàng, núi và sương, thanh điều hướng cùng kiểu Cổng môn. Trang chủ giữ hiệu ứng thời tiết và bàn Thiên cơ. Vị trí mặt trời/mặt trăng tính theo chiều cao thực tế của header, kể cả khi đổi font hoặc dùng điện thoại. Menu trên điện thoại cuộn ngang.

Mở **Diện mạo** trên header để chọn **Font toàn hệ thống** hoặc **Thiên sắc**. Font áp dụng cho tiêu đề, nội dung, menu và điều khiển; các tab cùng địa chỉ cập nhật ngay. Trang `/fonts-preview.html` hiển thị mẫu chữ và nút dùng lại mặc định (Charm cho tiêu đề, Noto Serif cho nội dung). Các font được phục vụ từ máy, có khai báo subset cho dấu tiếng Việt. Không cần cài package mới.

Lựa chọn lưu trên trình duyệt bằng `thc-font` và `thc-theme`; lựa chọn font cũ `titleFont` được đọc lại tự động. Thiên sắc mặc định theo mặt trời tại TP. Hồ Chí Minh; chọn ngày/đêm sẽ giữ lựa chọn ở các trang, kể cả trang chủ. Thư Phòng dùng chung thiên sắc, cỡ chữ đọc vẫn chỉnh riêng. Các trang PDF/ảnh giữ nội dung gốc của tài liệu.

Kiểm tra bộ điều khiển diện mạo và các luồng frontend hiện có:

```powershell
node tests/appearance.test.cjs
node tests/study-workflow.test.cjs
node tests/arena-workflow.test.cjs
node tests/arena-clock.test.cjs
node tests/tournament-page.test.cjs
node tests/test_review_math.mjs
```
