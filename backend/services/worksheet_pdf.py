"""A4 portrait, twelve vector diagrams per page, embedded Vietnamese font."""
from io import BytesIO
import base64
from pathlib import Path
from threading import Lock

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

from services.worksheets import board_svg, clean_text

FONT = "WorksheetVietnamese"
LOCK = Lock()


def register_font():
    with LOCK:
        if FONT not in pdfmetrics.getRegisteredFontNames():
            path = Path(__file__).resolve().parents[1] / "assets/worksheet/DejaVuSans-Vietnamese.ttf"
            pdfmetrics.registerFont(TTFont(FONT, str(path)))


def wrap(text, width, size):
    words = clean_text(text).split()
    lines, line = [], ""
    for word in words:
        # Long unbroken titles/instructions still fit the available width.
        chunks = []
        chunk = ""
        for char in word:
            if chunk and pdfmetrics.stringWidth(chunk + char, FONT, size) > width:
                chunks.append(chunk); chunk = ""
            chunk += char
        if chunk:
            chunks.append(chunk)
        for part in chunks:
            candidate = (line + " " + part).strip()
            if line and pdfmetrics.stringWidth(candidate, FONT, size) > width:
                lines.append(line); line = part
            else:
                line = candidate
    if line:
        lines.append(line)
    return lines


def text_lines(pdf, text, x, y, width, size=8, leading=11, maximum=None):
    pdf.setFont(FONT, size)
    lines = wrap(text, width, size)
    if maximum is not None and len(lines) > maximum:
        lines = lines[:maximum]
        lines[-1] = lines[-1].rstrip() + "…"
        while pdfmetrics.stringWidth(lines[-1], FONT, size) > width:
            lines[-1] = lines[-1][:-2] + "…"
    for line in lines:
        pdf.drawString(x, y, line); y -= leading
    return y


def header(pdf, document, page, total, answers):
    width, height = A4
    pdf.setFillColorRGB(.15, .15, .15)
    logo = document.get("logo") if page == 1 else None
    heading_width = width - 68 - (88 if logo else 0)
    brand = document.get("header_text")
    if brand is None:
        brand = "TĨNH HUYỀN QUÁN / " + ("ĐÁP ÁN GIÁO VIÊN" if answers else "BÀI KIỂM TRA" if document["kind"] == "test" else "PHIẾU BÀI TẬP")
    brand_size = 7.5
    while brand_size > 5 and len(wrap(brand, heading_width, brand_size)) > 2:
        brand_size -= .5
    text_lines(pdf, brand, 34, height - 30, heading_width, brand_size, 10, 2)
    if logo:
        image = ImageReader(BytesIO(base64.b64decode(logo.split(",", 1)[1])))
        iw, ih = image.getSize()
        scale = min(70 / iw, 58 / ih)
        iw, ih = iw * scale, ih * scale
        pdf.drawImage(image, width - 104 + (70 - iw) / 2, height - 84 + (58 - ih) / 2,
                      width=iw, height=ih, mask="auto")
    title = document["title"]
    size = 16
    while size > 7 and len(wrap(title, heading_width, size)) > 2:
        size -= 1
    text_lines(pdf, title, 34, height - 57, heading_width, size, 17, 2)
    pdf.setFont(FONT, 9)
    if not answers:
        pdf.drawString(34, height - 92, "Họ tên:")
        pdf.line(72, height - 94, 363, height - 94)
        pdf.drawString(383, height - 92, "Level:")
        pdf.line(418, height - 94, width - 34, height - 94)
    detail = []
    if document["level"]:
        detail.append("Dành cho: " + document["level"])
    if document["duration"]:
        detail.append(f"Thời gian: {document['duration']} phút")
    if document["kind"] == "test":
        detail.append(f"Điểm: ____ / {len(document['exercises'])}")
    if detail:
        text_lines(pdf, "  |  ".join(detail), 34, height - 110, width - 68, 8, 10, 1)
    text_lines(pdf, "ĐÁP ÁN GIÁO VIÊN - Chỉ dành cho giáo viên. Không phát kèm đề học sinh." if answers else document["instructions"],
               34, height - 123, width - 68, 7.5, 10, 2)
    pdf.setLineWidth(.5)
    pdf.line(34, height - 142, width - 34, height - 142)
    footer = document.get("footer_text")
    if footer is None:
        footer = "Tĩnh Huyền Quán - " + ("Đáp án" if answers else "12 bài / trang")
    numbering = document.get("page_number_format", "Trang {page} / {total}").replace("{page}", str(page)).replace("{total}", str(total)) if document.get("show_page_numbers", True) else ""
    right_width = min((width - 68) * .45, max(0, pdfmetrics.stringWidth(numbering, FONT, 7)))
    left_width = width - 68 - (right_width + 16 if numbering else 0)
    size = 7
    while size > 4 and len(wrap(footer, left_width, size)) > 2:
        size -= .5
    text_lines(pdf, footer, 34, 20, left_width, size, 8, 2)
    numbering_size = 7
    while numbering_size > 4 and len(wrap(numbering, max(right_width, 1), numbering_size)) > 2:
        numbering_size -= .5
    pdf.setFont(FONT, numbering_size)
    for line, text in enumerate(wrap(numbering, max(right_width, 1), numbering_size)[:2]):
        pdf.drawRightString(width - 34, 20 - line * 8, text)


def render_pdf(document, answers=False):
    register_font()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(document["title"] + (" - Đáp án" if answers else ""))
    pdf.setAuthor("Tĩnh Huyền Quán")
    pdf.setCreator("Tĩnh Huyền Quán - Trang tạo bài tập")
    exercises = document["exercises"]
    total = len(exercises) // 12
    width, height = A4
    top, bottom = height - 154, 36
    cols, rows = (2, 6) if answers else (3, 4)
    cell_width = (width - 68) / cols
    cell_height = (top - bottom) / rows
    for page in range(total):
        header(pdf, document, page + 1, total, answers)
        for local, exercise in enumerate(exercises[page * 12:(page + 1) * 12]):
            x = 34 + (local % cols) * cell_width
            y = top - (local // cols) * cell_height
            number = page * 12 + local + 1
            turn = "Trắng" if exercise["turn"] == "w" else "Đen"
            pdf.setFillColorRGB(0, 0, 0)
            pdf.setFont(FONT, 8)
            pdf.drawString(x + 6, y - 8, f"{number}. {turn} đi")
            if answers:
                after = text_lines(pdf, exercise["solution"], x + 6, y - 25, cell_width - 18, 9, 12, 5)
                pdf.setFillColorRGB(.4, .4, .4)
                pdf.setFont(FONT, 6.5)
                pdf.drawString(x + 6, min(after - 2, y - cell_height + 10), "Mã bài: " + exercise["id"])
            else:
                # Diagram stays vector; all coordinates and pieces come from the validated FEN.
                drawing = svg2rlg(BytesIO(board_svg(exercise, document["rotate"]).encode()))
                size = 124
                drawing.scale(size / drawing.width, size / drawing.height)
                renderPDF.draw(drawing, pdf, x + (cell_width - size) / 2, y - 138)
                if document.get("show_prompts", True):
                    text_lines(pdf, exercise["instruction"], x + 6, y - 147, cell_width - 12, 6.5, 8, 2)
                pdf.setStrokeColorRGB(.55, .55, .55)
                pdf.setLineWidth(.4)
                pdf.setDash(1, 2)
                pdf.line(x + 6, y - cell_height + 4, x + cell_width - 9, y - cell_height + 4)
                pdf.setDash()
            pdf.setStrokeColorRGB(.85, .85, .85)
            pdf.setLineWidth(.35)
            if local % cols < cols - 1:
                pdf.line(x + cell_width, y + 1, x + cell_width, y - cell_height + 1)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()
