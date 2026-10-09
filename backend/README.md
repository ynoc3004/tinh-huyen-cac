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

## Bốc thăm, ghép cặp và hệ số phụ

Bốc thăm chia bảng dùng mã seed và thứ tự đầu vào chuẩn hóa, có thể tái tạo khi danh sách, rating, đơn vị, tùy chọn và phiên bản thuật toán không đổi. Số người tối đa/bảng dùng làm trần; nếu ấn định số bảng thì số bảng được ưu tiên. Tránh cùng đơn vị là nỗ lực giảm xung đột, không bảo đảm tuyệt đối. Xem lại bảng, hạt giống và cảnh báo trước khi chốt.

Swiss dùng ghép toàn bộ bằng Blossom: không tái đấu, không lặp bye, không 3 ván cùng màu liên tiếp, chênh số ván trắng/đen tối đa 2; ưu tiên điểm gần nhau rồi cân bằng màu. Đây là thuật toán riêng **chưa được kiểm định FIDE Dutch**, không có ngoại lệ màu cho topscorer vòng cuối hoặc lịch sử float theo Dutch. Nếu không có lịch hợp lệ, trả lỗi và không ghi vòng; cần trọng tài xử lý, ứng dụng không tự nới điều kiện. Arena dùng logic riêng: được tái đấu, ưu tiên tránh gặp lại gần đây và cân màu, người lẻ tiếp tục chờ không có điểm.

Chốt số vòng Swiss trong thiết lập bảng trước vòng 1 (mặc định `ceil(log2(n))`). Vòng sau chỉ được ghép khi toàn bộ kết quả cũ đầy đủ. Không sửa kết quả Swiss/loại trực tiếp sau khi ghép vòng phụ thuộc; vẫn được sửa chỉ số với cùng kết quả. Không lập chung kết hoặc kết thúc giải khi chưa đủ vòng/kết quả. Vòng bảng khóa khi lập chung kết; giải thường khóa khi kết thúc. Muốn ghép lại từ đầu phải xác nhận; lịch cũ được chụp vào nhật ký trước khi xóa.

Thứ tự hệ số phụ của ứng dụng cần được ghi trong thể lệ trước khi thi đấu:

- Swiss: ĐĐ › BH-C1 › BH › SB › Thắng.
- Vòng tròn: ĐĐ › SB › Thắng (không dùng Buchholz).
- Thắng là số ván thắng trên bàn, không tính bye. Swiss bye được 1 điểm; nghỉ vòng tròn được 0 điểm.
- Swiss bye dùng đối thủ giả bằng điểm bản thân, tối đa nửa số vòng đã chốt, theo điều 16.4.2 của quy định hệ số phụ FIDE áp dụng từ 1/3/2026. Ván chưa có kết quả chưa tính điểm.
- Khi các hệ số vẫn bằng nhau, ứng dụng hiển thị đồng hạng; không dùng ID học viên để quyết định suất vào chung kết. Nếu đồng hạng vắt qua mốc tuyển chọn, cần phân định theo thể lệ; hiện chưa có giao diện nhập quyết định playoff/bốc thăm phân hạng.
- Loại trực tiếp xếp hạng theo mức tiến trong nhánh, nhà vô địch là người thắng ván chung kết, không phải người có tổng điểm cao nhất. Ván hòa chưa xác định người đi tiếp.

Nút **Tải nhật ký giải** xuất JSON chứa mã bốc thăm, danh sách/rating tại thời điểm ghép, lịch, kết quả trước/sau sửa và thời gian. Nhật ký được lưu trong SQLite cùng giao dịch; có thể tải lại sau khi khởi động lại. Nhật ký bắt đầu từ bản cập nhật này, không tái tạo lịch sử trước đó, không phải biên bản ký số/chống sửa database. Sao lưu toàn bộ database trước giải.

Trước giải chính thức cần chạy thử trọn giải với danh sách thực. Giải tính rating FIDE cần trọng tài kiểm tra và bộ ghép được kiểm định; bản hiện tại chưa hỗ trợ bỏ cuộc, vào muộn, xin nghỉ nửa điểm hoặc kết quả bỏ cuộc riêng, xuất báo cáo TRF, hay phân hạng playoff. Tài liệu đối chiếu: [FIDE Dutch 2026](https://handbook.fide.com/chapter/C0403202602), [FIDE tie-break 2026](https://handbook.fide.com/chapter/TieBreakRegulations032026).

Sau khi cập nhật, chạy `python -m pip install -r requirements.txt` (có thêm NetworkX), rồi khởi động lại server. Database cũ được thêm cột số vòng và bảng nhật ký tự động; không cần tạo lại.

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


## Đạo Đức Kinh mỗi ngày

Trang chủ hiển thị nguyên phần **Hán văn** của một chương Đạo Đức Kinh bên dưới bàn Thiên cơ, thay cho câu tu vi cũ. Nội dung cổ gồm đủ 81 chương, lấy từ các trang `DDK01.htm` đến `DDK81.htm` của [Nhân Tử](https://nhantu.net/TonGiao/DaoDucKinh/DDK01.htm); không sao chép phiên âm, bản dịch hoặc bình giảng hiện đại.

Kho chữ nằm trong `static/dao-duc-kinh.json`, dùng ngay cùng website, không gọi trang nguồn hay AI mỗi ngày. Chu kỳ bắt đầu chương 1 ngày **09/10/2026**, mỗi ngày tăng một chương theo múi giờ **Việt Nam**, hết chương 81 quay về chương 1. Mọi trình duyệt dùng cùng ngày sẽ đọc cùng chương; tải lại trang không đổi chương. Tab đang mở tự cập nhật qua nửa đêm và khi quay lại tab. Nguồn của chương đang đọc được liên kết ngay dưới Hán văn.

Font chữ Hán Noto Serif TC được đóng gói cùng website, thu gọn theo các ký tự trong 81 chương; giấy phép SIL OFL ở `static/fonts/OFL-noto-serif-tc.txt`. Không cần cài package hoặc trả phí để hiển thị.

Kiểm tra dữ liệu và lịch luân phiên: `node tests/daily-dao.test.mjs`.

Nút **Nghe Hán văn** dưới tiêu đề chương đọc phần chữ đang hiển thị bằng giọng tiếng Trung của trình duyệt/máy; bấm lại để dừng. Không tự phát, không cần API key hoặc thêm package. Ô **Giọng đọc** liệt kê các giọng Chinese do trình duyệt cung cấp và lưu lựa chọn trên trình duyệt. Mặc định ưu tiên các giọng nữ nhận diện được theo tên: Xiaoxiao, Xiaoyi, Yaoyao, Huihui, Hanhan, Yating; chỉ hiển thị những giọng thật sự có trong `getVoices()`. Giọng Natural/Neural không được đảm bảo có trên mọi máy. Đổi giọng khi đang đọc sẽ dừng; bấm loa lại để nghe giọng mới. Không thêm dịch vụ TTS bên ngoài; nếu chưa có thì báo để thêm giọng trong cài đặt giọng nói của máy. Tùy giọng được cung cấp, phát âm thanh có thể cần mạng. Đây là cách đọc tiếng Trung, không phải phiên âm Hán Việt.

Chương được chia thành các đoạn ngắn, đọc lần lượt đầy đủ. Rời/ẩn trang hoặc chuyển chương lúc qua nửa đêm sẽ dừng đọc; bấm loa lại sẽ đọc chương đang hiển thị. Lỗi phát hoặc giọng không phản hồi đưa nút về trạng thái có thể thử lại. Kiểm tra nút loa: `node tests/dao-speech.test.mjs`.

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

## Phân tích tài liệu PGN

Tệp `.pgn` trong Tàng Kinh Các mở thẳng `/review.html?item=ID`. Đường dẫn đọc cũ `/reader.html?id=ID` cũng tự chuyển sang bàn phân tích sau khi kiểm tra tài liệu và khóa két. Định dạng PNG vẫn là ảnh, không phải kỳ phổ.

Stockfish local tự phân tích khi mở PGN hoặc nhập/dán một ván mới. Bàn cờ có thanh ưu thế, phím ← →, đảo bàn, nhận diện khai cuộc, nhãn chất lượng từng nước và ba phương án. **Diễn biến ưu thế** cập nhật trong lúc tính; bấm biểu đồ hoặc kéo thanh chọn thời điểm để xem lại. Đồ thị giới hạn ±6 điểm; phần đánh giá vẫn hiển thị điểm thực hoặc chiếu hết. Thống kê chỉ tính những nước đã phân tích; gợi ý trước nước vừa đi lấy từ Stockfish ở thế trước đó. Độ chính xác dùng mô hình công khai của Lichess, vẫn là ước tính và có thể khác Chess.com hoặc Lichess do engine/cấu hình phân tích.

Có thể chọn mức nhanh/tiêu chuẩn/chuyên sâu với mục tiêu độ sâu 12/16/20, dừng rồi tiếp tục. Mỗi lượt tìm giới hạn 0,75/2/5 giây; nước đáng ngờ được tìm lại thêm 4 tầng (hoặc hơn nếu engine đã vượt mục tiêu), với giới hạn thời gian gấp đôi. Nếu chưa đạt độ sâu hoặc hai kết quả lệch độ sâu, trang ghi rõ cần tính sâu hơn. Phân tích chuyên sâu có thể mất vài phút.

Nước đã đi được tìm bằng `searchmoves` từ cùng thế gốc, theo độ sâu thực đạt của nước tốt nhất. Nếu đó chính là nước tốt nhất, dùng cùng đánh giá để tránh tự trừ điểm vì nhiễu tìm kiếm. UCI giữ FEN ban đầu và toàn bộ lịch sử nước đi để engine nhận biết lặp lại thế cờ. Nước mất ít nhất 5 điểm phần trăm cơ hội thắng, mất ít nhất 200 centipawn, đổi trạng thái chiếu hết hoặc có đánh giá cải thiện bất thường được kiểm tra sâu hơn trước khi lưu.

Độ chính xác mỗi nước chuyển centipawn thành cơ hội thắng theo [mô hình Lichess](https://lichess.org/page/accuracy), rồi áp dụng đường cong độ chính xác (kèm mức bù bất định 1 điểm của mô hình hiện hành). Điểm toàn ván kết hợp trung bình có trọng số theo biến động của cửa sổ 2–8 thế cờ và trung bình điều hòa. Cơ hội thắng là chỉ số mô hình, không phải xác suất thắng cá nhân. Nhãn nước đi dùng mức giảm 2/5/10 điểm phần trăm cho chưa chính xác/sai lầm/sai lầm lớn. Đây là cách áp dụng của app, không hứa trùng điểm trên các dịch vụ khác.

**ACPL** là trung bình centipawn mất so với nước tốt nhất của cùng bên; thấp hơn là tốt hơn (100 centipawn = 1 điểm). Chiếu hết dùng kiểu dữ liệu riêng và bên thắng rõ ràng, không quy đổi thành ±10000 centipawn; các so sánh có mate không được tính vào ACPL. Chiếu hết, pat và thiếu vật chất được xử lý riêng; tình huống lặp thế được chuyển cho engine với lịch sử đầy đủ.

Kết quả tự lưu vào database của ứng dụng (`data/app.db`) sau mỗi cặp nước được tính xong, gồm PGN, chất lượng phân tích, điểm từng thế và các phương án. Mục **Ván đã phân tích** có tìm theo tên người chơi/giải đấu, ngày lưu và trạng thái đầy đủ hoặc đang dở; bấm vào để mở lại ngay. Trang Phân tích ưu tiên mở danh sách đã lưu nếu có ván. PGN nhập trực tiếp và kỳ phổ online có đường dẫn `/review.html?saved=HASH`; ván trong két vẫn mở qua `?item=ID`.

Mở lại kết quả đầy đủ hoặc đang dở đều **không tự khởi động Stockfish**. Chỉ bấm **Tiếp tục phân tích** để tính thêm phần còn thiếu, hoặc **Phân tích lại** khi chủ động muốn tính lại/đổi mức. Mỗi cặp chỉ lưu sau khi hoàn tất kiểm tra sâu, nên dừng giữa chừng không biến kết quả chưa xác nhận thành kết quả đầy đủ. Bản lưu tồn tại qua việc khởi động lại backend hoặc xóa dữ liệu trình duyệt, miễn là giữ `data/app.db` và thư mục két.

Kết quả của tài liệu Tàng Kinh Các được nén, mã hóa bằng khóa két và lưu kèm liên kết tài liệu; danh sách và đọc/lưu kết quả đều qua guard của két. Xóa tài liệu sẽ xóa kết quả liên quan bằng khóa ngoại; két khóa không mở được kết quả. PGN nhập trực tiếp/kỳ phổ online lưu trong database theo quyền truy cập thông thường của ứng dụng. Các API `/api/reviews` và `/api/library/reviews` chỉ đọc/lưu kết quả do browser tính, không chạy engine trên server.

Cache v2 trên trình duyệt vẫn là bản dự phòng khi backend lưu thất bại. Kết quả v2 cũ được chuyển vào database khi mở lại ván, không chạy lại engine. Cache v1 theo công thức cũ không được dùng lại. Nếu không lưu được, trang báo rõ và có nút **Thử lưu lại**; nếu không tải được bản lưu từ backend, trang không tự phân tích thay thế. Không thêm package, API key hoặc dịch vụ trả phí.

Nhập mỗi lần một ván, tối đa 2 MB. PGN trống, sai nước, nhiều ván hoặc tài liệu khác định dạng sẽ báo lỗi trước khi chạy engine. Hỗ trợ BOM, chú thích, nhánh phụ và PGN bắt đầu từ FEN. Khi mở tài liệu, trang giữ phiên két hoạt động lúc đang xem; két khóa hoặc file bị xóa sẽ dừng engine và ẩn bàn cờ.

Kiểm tra luồng PGN, chuyển trang đọc cũ, khóa két, tự phân tích, cache, đồ thị và dừng engine:

```powershell
node tests/pgn-review.test.cjs
node tests/test_review_math.mjs
python -m unittest discover -s tests -p test_saved_reviews.py
```

Smoke test với Stockfish thực được đóng gói (Bash):

```bash
REVIEW_REAL_ENGINE=1 node tests/pgn-review.test.cjs
```
