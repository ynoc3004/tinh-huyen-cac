"""Extract narrative PDF text without translating diagram-font board grids."""
import os
import re
from pathlib import Path

from services.chess_translation import clean_source, is_diagram_line, SAN

DIAGRAM_FONT = re.compile(r"chess|merida|leipzig|diagram|figurine", re.I)


def page_text(page, ocr=False):
    import pymupdf
    textpage = None
    if ocr:
        tessdata = os.getenv("TESSDATA_PREFIX")
        if not tessdata:
            for folder in (Path(os.getenv("ProgramFiles", "C:/Program Files")) / "Tesseract-OCR/tessdata",
                           Path("/usr/share/tesseract-ocr/5/tessdata")):
                if (folder / "eng.traineddata").is_file():
                    tessdata = str(folder)
                    break
        # Explicit OCR must replace even a non-empty but broken PDF text layer.
        textpage = page.get_textpage_ocr(language="eng", dpi=200, full=True, tessdata=tessdata)
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
