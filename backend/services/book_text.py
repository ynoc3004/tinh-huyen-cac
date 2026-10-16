"""Extract narrative PDF text without translating diagram-font board grids."""
import os
import re
import shutil
from pathlib import Path

from services.chess_translation import clean_source, is_diagram_line, SAN

DIAGRAM_FONT = re.compile(r"chess|merida|leipzig|diagram|figurine", re.I)


class OCRSetupError(RuntimeError):
    """Tesseract language data is missing or cannot be loaded."""


def tessdata_candidates():
    """Inspect configured/common locations without downloading or changing env."""
    configured = os.getenv("TESSDATA_PREFIX", "").strip().strip('"')
    if configured:
        folder = Path(os.path.expandvars(configured)).expanduser()
        if folder.name.lower() == "eng.traineddata":
            folder = folder.parent
        yield folder
        yield folder / "tessdata"
    for name, default in (("ProgramW6432", "C:/Program Files"),
                          ("ProgramFiles", "C:/Program Files"),
                          ("ProgramFiles(x86)", "C:/Program Files (x86)")):
        root = Path(os.getenv(name, default))
        yield root / "Tesseract-OCR/tessdata"
    executable = shutil.which("tesseract")
    if executable:
        folder = Path(executable).resolve().parent
        yield folder / "tessdata"
        yield folder.parent / "share/tessdata"
    for folder in ("/usr/share/tesseract-ocr/5/tessdata", "/usr/share/tesseract-ocr/4.00/tessdata",
                   "/usr/share/tessdata", "/usr/local/share/tessdata", "/opt/homebrew/share/tessdata"):
        yield Path(folder)


def find_tessdata():
    for folder in tessdata_candidates():
        try:
            data = folder / "eng.traineddata"
            if data.is_file() and data.stat().st_size:
                with data.open("rb") as stream:
                    stream.read(1)
                return str(folder)
        except OSError:
            continue
    raise OCRSetupError(
        "Không tìm thấy eng.traineddata để OCR tiếng Anh. TESSDATA_PREFIX phải trỏ tới thư mục tessdata "
        "có tệp này, ví dụ C:\\Program Files\\Tesseract-OCR\\tessdata. "
        "Nếu chưa có, cài dữ liệu tiếng Anh của Tesseract. Sau khi sửa .env hoặc biến môi trường, "
        "khởi động lại backend. Có thể tắt OCR trong Tùy chọn để đọc sách và dùng lớp chữ PDF sẵn có.")


def page_text(page, ocr=False):
    import pymupdf
    textpage = None
    if ocr:
        tessdata = find_tessdata()
        # A valid explicit folder overrides a stale TESSDATA_PREFIX in PyMuPDF.
        try:
            textpage = page.get_textpage_ocr(language="eng", dpi=200, full=True, tessdata=tessdata)
        except Exception as exc:
            raise OCRSetupError(
                "Đã tìm thấy eng.traineddata trong " + tessdata +
                " nhưng Tesseract không đọc được. Kiểm tra quyền đọc, cài lại dữ liệu tiếng Anh "
                "nếu tệp bị hỏng, rồi khởi động lại backend. Tạm tắt OCR để dùng lớp chữ PDF sẵn có.") from exc
    flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
    data = page.get_text("dict", sort=True, flags=flags, textpage=textpage)
    paragraphs = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines = []
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            values = []
            for index, span in enumerate(spans):
                text = span.get("text", "")
                if DIAGRAM_FONT.search(span.get("font", "")):
                    # Only keep a recognizable inline figurine before a square;
                    # the same font is also used to draw every cell of a board.
                    tail = "".join(s.get("text", "") for s in spans[index+1:])
                    normalized = clean_source(text)
                    if SAN.fullmatch(normalized):
                        values.append(normalized)
                        continue
                    if not (re.fullmatch(r"[♔-♟KQRBN]", text.strip()) and
                            re.match(r"\s*[a-h]?[1-8]?x?[a-h][1-8]", tail)):
                        continue
                values.append(text)
            text = clean_source("".join(values))
            if text:
                lines.append(text)
        if lines and not is_diagram_line(" ".join(lines)):
            paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs)
