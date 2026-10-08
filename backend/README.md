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

AI quét ảnh được chọn riêng trong mục **AI quét** bên bàn cờ; lựa chọn dịch chữ vẫn ở khung Bản dịch. Danh sách Gemini lấy từ backend, khóa `GEMINI_API_KEY` không gửi ra trình duyệt. `GEMINI_SCAN_MODEL` đặt model mặc định cho quét; đổi lựa chọn trên web không đổi model dịch. Quét lại thay kết quả lưu của trang, quét thường mở kết quả đã lưu.

Nút quét và dịch có trạng thái riêng, có thể chạy đồng thời. Đổi sách/trang/OCR tạm khóa khi một tác vụ đang xử lý để kết quả không bị gắn nhầm trang. Chọn ảnh thế cờ để mở bàn cờ; hiệu đính lượt đi/quân và nhập FEN/PGN nằm trong mục mở rộng dưới bàn cờ.

Kiểm tra bổ sung (từ `backend`): `node tests/study-workflow.test.cjs`. Kiểm tra này giả lập DOM và API, xác nhận quét không gọi dịch, model chọn riêng, hai tác vụ đồng thời và sửa quân. Python: `python -m unittest discover -s tests -v`.



Thư Phòng hiện là màn hình đọc/dịch chung; liên kết `translate.html?id=...` chuyển sang `study.html?id=...#batch-panel`. Mục **Dịch nhiều trang** giữ thiết lập khoảng trang, thuật ngữ, OCR, dừng/tiếp tục và xuất bản dịch. Bản gốc hiển thị ảnh đúng trang được chọn để trình xem PDF riêng không lệch trang với thao tác quét.

Trong **AI quét**, nút **Kiểm tra AI với ảnh nhỏ** gửi một ảnh bàn cờ trống 64×64 được tạo ở backend, không gửi sách. Nó kiểm tra model có nhận yêu cầu ảnh lúc đó hay không, không kiểm chứng độ chính xác nhận quân. Nếu ảnh nhỏ cũng trả HTTP 503, chọn model khác hoặc đợi dịch vụ phục hồi; thử lại không bảo đảm khắc phục lỗi nhà cung cấp.
