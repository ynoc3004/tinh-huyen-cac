"""Chess vocabulary and notation shared by every book translation provider."""
import re

REVISION = "chess-context-4"
TERMS = {
    "the London system": "hệ thống London", "London system": "hệ thống London",
    "King's Indian defence": "phòng thủ Ấn Độ Vua", "King's Indian defense": "phòng thủ Ấn Độ Vua",
    "Queen's gambit": "gambit Hậu", "Sicilian defence": "phòng thủ Sicilian",
    "Sicilian defense": "phòng thủ Sicilian", "practical lessons": "bài học thực hành",
    "strategic concepts": "các khái niệm chiến lược", "typical plans": "các kế hoạch điển hình",
    "tactical themes": "các chủ đề chiến thuật", "exchange sacrifice": "hy sinh chất",
    "pawn structure": "cấu trúc tốt", "pawn structures": "các cấu trúc tốt",
    "isolated pawn": "tốt cô lập", "doubled pawns": "tốt chồng", "passed pawn": "tốt thông",
    "backward pawn": "tốt chậm tiến", "bishop pair": "cặp tượng", "opposite-coloured bishops": "tượng khác màu",
    "light-squared bishop": "tượng ô trắng", "dark-squared bishop": "tượng ô đen",
    "PGN file": "tệp PGN", "PDF file": "tệp PDF",
    "file": "cột", "files": "các cột", "rank": "hàng ngang", "ranks": "các hàng ngang",
    "square": "ô", "squares": "các ô", "pieces": "các quân cờ", "piece": "quân cờ",
    "strategy": "chiến lược", "tactics": "chiến thuật", "positional play": "lối chơi thế trận",
    "minor pieces": "các quân nhẹ", "major pieces": "các quân nặng",
    "minor piece": "quân nhẹ", "major piece": "quân nặng", "discovered attack": "tấn công mở",
    "double check": "chiếu đôi", "perpetual check": "chiếu vĩnh viễn", "back rank": "hàng ngang cuối",
    "open file": "cột mở", "half-open file": "cột nửa mở", "semi-open file": "cột nửa mở",
    "kingside": "cánh vua", "queenside": "cánh hậu", "castling": "nhập thành",
    "checkmate": "chiếu hết", "stalemate": "hết nước đi (hòa)", "zugzwang": "thế bắt buộc phải đi",
    "opposition": "đối vua", "outpost": "ô tiền đồn", "initiative": "quyền chủ động",
    "fork": "đòn đôi", "pin": "ghim", "skewer": "xiên", "endgame": "tàn cuộc",
    "middlegame": "trung cuộc", "opening": "khai cuộc", "variation": "biến", "variations": "các biến",
    "king": "vua", "queen": "hậu", "rook": "xe", "bishop": "tượng", "knight": "mã", "pawn": "tốt",
    "kings": "các vua", "queens": "các hậu", "rooks": "các xe", "bishops": "các tượng",
    "knights": "các mã", "pawns": "các tốt", "White": "Trắng", "Black": "Đen",
}
for file in "abcdefgh":
    TERMS[f"{file}-file"] = f"cột {file}"
    TERMS[f"the {file}-file"] = f"cột {file}"

SAN = re.compile(r"(?<![\w])(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?[!?]{0,2}(?![\w])")
FIGURINES = str.maketrans({**dict(zip("♔♕♖♗♘♚♛♜♝♞", "KQRBNKQRBN")), "♙": "", "♟": ""})


def glossary_entries(custom=""):
    entries = {k.casefold(): v for k, v in TERMS.items()}
    for line in re.split(r"[;\n]", custom):
        if "=" in line:
            source, target = (part.strip() for part in line.split("=", 1))
            if source and target:
                entries[" ".join(source.split()).casefold()] = target
    return entries


def glossary_text(custom=""):
    return "; ".join(f"{a}={b}" for a, b in glossary_entries(custom).items())


def protected_parts(text, custom=""):
    """Legacy literal glossary substitution; do not use to split model input."""
    entries = glossary_entries(custom)
    terms = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(k).replace(r"\ ", r"\s+") for k in sorted(entries, key=len, reverse=True)) + r")(?!\w)", re.I)
    moves = list(SAN.finditer(text))
    matches = [(m.start(), m.end(), m.group()) for m in moves]
    matches += [(m.start(), m.end(), "mở" if m.group().casefold()=="opening" and re.match(r"\s+of\b", text[m.end():], re.I) else entries[" ".join(m.group().split()).casefold()]) for m in terms.finditer(text)
                if not any(m.start() < move.end() and m.end() > move.start() for move in moves)]
    end = 0
    for start, stop, fixed in sorted(matches):
        if start < end:
            continue
        if start > end:
            yield text[end:start], None
        yield text[start:stop], fixed
        end = stop
    if end < len(text):
        yield text[end:], None


def protect(text, custom=""):
    tokens, output = {}, []
    for source, fixed in protected_parts(text, custom):
        if fixed is None:
            output.append(source)
        else:
            kind = "MOVE" if SAN.fullmatch(source) else "TERM"
            token = f"__THC_{kind}_{len(tokens)}__"
            tokens[token] = fixed
            output.append(token)
    return "".join(output), tokens


def restore(text, tokens):
    for token, original in tokens.items():
        if text.count(token) != 1:
            raise ValueError("Bản dịch làm thay đổi ký hiệu nước đi hoặc thuật ngữ. Hãy dịch đoạn ngắn hơn.")
        text = text.replace(token, original)
    if re.search(r"__THC_(?:MOVE|TERM)_\d+__", text):
        raise ValueError("Bản dịch còn ký hiệu chưa được khôi phục.")
    return text


def is_diagram_line(line):
    compact = re.sub(r"\s+", "", line)
    if not compact:
        return False
    if compact.lower() in ("abcdefgh", "hgfedcba", "12345678", "87654321"):
        return True
    # Diagram-font encodings and OCR grids have many single-letter cells or
    # repeated non-moves. Real SAN and FEN lines must remain unchanged.
    if SAN.search(line) or compact.count("/") == 7:
        return False
    if re.fullmatch(r"[KQRBNPkqrbnp.□■]{8}", compact):
        return True
    if len(compact) >= 12 and re.fullmatch(r"[KQRBNPkqrbnpabcdefghABCDEFGH1-8.,:/\\|_\-+□■♔-♟]+", compact):
        words = re.findall(r"[A-Za-z]+", line)
        punctuation = len(re.findall(r"[.,:/\\|_□■]", compact))
        if not words or all(len(word) == 1 for word in words):
            return True
        if punctuation > len(compact) * .15 and all(len(word) <= 3 for word in words):
            return True
    return bool(re.search(r"([A-Za-z]{1,3}[.,])\1{4,}", compact))


def clean_source(text):
    lines = []
    for line in text.splitlines():
        if is_diagram_line(line):
            continue
        # Convert Unicode figurines only next to actual destination squares.
        line = re.sub(r"[♔-♟](?=[a-h]?[1-8]?x?[a-h][1-8])", lambda m: m.group().translate(FIGURINES), line)
        lines.append(line)
    return "\n".join(lines).strip()


def validate_output(source, result):
    if re.search(r"Coptic\s+month|LongName|ShortName|__THC_(?:TERM|MOVE)_", result, re.I) and not re.search(r"Coptic\s+month|LongName|ShortName|__THC_(?:TERM|MOVE)_", source, re.I):
        raise ValueError("Bộ dịch sinh nội dung lỗi ngoài nguyên bản. Bản lỗi chưa được lưu; thử Dịch bằng Ollama hoặc dịch đoạn ngắn hơn.")
    if not result.strip():
        raise ValueError("Bộ dịch trả nội dung trống; bản lỗi chưa được lưu.")
    if any(is_diagram_line(line) for line in result.splitlines()):
        raise ValueError("Bản dịch có chuỗi ký tự bàn cờ bị đọc sai. Bấm Đọc lại chữ gốc trước khi dịch lại.")
    # Reject generative loops without deleting legitimate repeated moves.
    words = result.split()
    if len(words) >= 20 and len(set(words)) / len(words) < .12:
        raise ValueError("Bộ dịch bị lặp nội dung; bản lỗi chưa được lưu. Thử dịch đoạn ngắn hơn.")
    if SAN.findall(source) != SAN.findall(result):
        raise ValueError("Bản dịch làm thay đổi thứ tự hoặc ký hiệu nước đi; bản lỗi chưa được lưu.")
    return result


# Correct only known non-chess senses when the corresponding source term occurs.
# Full sentences, proper names and grammar are left for the translation model.
TERM_CORRECTIONS = {
    "bishop": (r"giám mục", "tượng"),
    "knight": (r"hiệp sĩ|kỵ sĩ", "mã"),
    "rook": (r"tòa tháp|toà tháp|lâu đài", "xe"),
    "queen": (r"nữ hoàng", "hậu"),
    "king": (r"nhà vua|vị vua", "vua"),
    "square": (r"hình vuông", "ô"),
    "rank": (r"cấp bậc", "hàng ngang"),
    "the London system": (r"hệ thống Luân Đôn", "hệ thống London"),
    "London system": (r"hệ thống Luân Đôn", "hệ thống London"),
}

for file in "abcdefgh":
    TERM_CORRECTIONS[f"{file}-file"] = (rf"(?:tệp|tập tin)\s+(?:{file}-file|{file})|{file}-file", f"cột {file}")


def polish_terms(source, result, custom=""):
    entries = glossary_entries(custom)
    for english, (wrong, default) in TERM_CORRECTIONS.items():
        if re.search(r"(?<!\w)" + re.escape(english) + r"s?(?!\w)", source, re.I):
            target = entries.get(english.casefold(), default)
            result = re.sub(r"(?<!\w)(?:" + wrong + r")(?!\w)", lambda m: target[0].upper()+target[1:] if m.group()[0].isupper() else target, result, flags=re.I)
    # Custom entries override known Vietnamese glossary forms after sentence
    # translation, rather than breaking the English sentence into tiny fragments.
    defaults = {k.casefold(): v for k, v in TERMS.items()}
    for english, target in entries.items():
        old = defaults.get(english)
        if old and old != target and target.casefold() not in result.casefold() and re.search(
                r"(?<!\w)" + re.escape(english) + r"(?!\w)", source, re.I):
            result = re.sub(r"(?<!\w)" + re.escape(old) + r"(?!\w)", lambda m: target[0].upper()+target[1:] if m.group()[0].isupper() else target, result, flags=re.I)
    return result
