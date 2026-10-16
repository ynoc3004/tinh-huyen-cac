# Tĩnh Huyền Các

Ứng dụng cờ vua chạy local: đồng bộ ván cờ, quản lý thư viện, giải vòng tròn/Swiss/loại trực tiếp và đấu trường arena.

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

## Dịch Kinh Các: dịch bằng Ollama

Mở sách trong Dịch Kinh Các, kiểm tra chữ gốc rồi chọn **Dịch bằng Ollama**. Mỗi trang được chia thành các đoạn khoảng 600 ký tự; kết quả hiện dần và từng đoạn được lưu trong két. **Tạm dừng** chờ đoạn đang chạy hoàn tất. Nếu quá thời gian chờ, bấm dịch để tiếp tục với các đoạn đã lưu. Tiến trình này độc lập với Dịch nhiều trang.

Nút **Đổi model** cạnh tên bộ dịch mở danh sách model đã cài. Nếu `qwen3:4b` quá chậm và máy đã có `qwen3:1.7b`, có thể chọn bản 1.7b rồi thử lại. Tốc độ và chất lượng còn phụ thuộc model, RAM và phần cứng; kiểm thử tự động không chạy model thật. Chỉ đoạn chữ được gửi tới Ollama trên máy; ký hiệu nước đi được giữ nguyên và bản dịch được kiểm tra trước khi lưu.

## Dịch bằng Claude / Gemini bản chat miễn phí

Trong Dịch Kinh Các, chọn **Chat miễn phí**:

1. Kiểm tra chữ gốc rồi bấm **Sao chép yêu cầu dịch trang này**. Yêu cầu có hướng dẫn văn phong, thuật ngữ cờ vua và giữ nguyên SAN. Nếu trình duyệt chặn clipboard, mở phần yêu cầu và dùng Ctrl+C.
2. Mở **Claude** hoặc **Gemini** bằng liên kết trên trang, đăng nhập bằng tài khoản của bạn, dán yêu cầu và tự gửi trong chat. Model và hạn mức theo gói tài khoản; ứng dụng không chọn hay bảo đảm một model cụ thể. Không cần API key cho cách này.
3. Sao chép phần bản dịch từ chat, dán về ứng dụng, chọn nơi đã dịch và bấm **Lưu bản dịch**. Ứng dụng kiểm tra thứ tự/ký hiệu nước đi trước khi lưu; lỗi giữ nguyên nội dung đang dán để sửa.

Yêu cầu giữ lại trang, chữ gốc và thuật ngữ lúc sao chép: nếu chuyển sang trang khác trước khi dán, bản dịch vẫn được lưu cho trang ban đầu. Muốn dịch trang khác, bấm **Đổi trang dịch**; ứng dụng hỏi trước khi bỏ bản đang dán chưa lưu. Bản nháp trong ô nhập chưa được lưu sẽ mất khi tải lại hoặc đóng trang.

Bản dịch đã lưu được mã hóa trong két, mở lại theo đúng sách/trang và không phụ thuộc Ollama hay phiên bản bộ dịch tự động. Nếu chữ gốc hoặc thuật ngữ đổi, bản cũ được giữ nhưng không hiển thị như bản dịch của nội dung mới. Khi đã lưu, phần nhập thu gọn để đọc sách, tiếng Việt và bàn cờ. **Dịch tự động** vẫn có các bộ dịch cũ và tiến trình dịch nhiều trang riêng.

Ứng dụng không tự gửi chữ/sách, đăng nhập, đọc phản hồi hoặc điều khiển Claude/Gemini. Liên kết mở trang chat trống; bạn tự chọn nội dung gửi. Dùng gói chat miễn phí khác với gọi API dịch tự động.
