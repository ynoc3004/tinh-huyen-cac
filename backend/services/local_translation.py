"""CPU English-to-Vietnamese translation. Never downloads during a book request."""
import os
import re
import threading
from pathlib import Path
from services.chess_translation import SAN, polish_terms

MODEL_ID = "Helsinki-NLP/opus-mt-en-vi"
ENGINE = "opus-mt-en-vi"
MODEL_DIR = Path(os.environ.get("THC_TRANSLATION_MODEL_DIR", str(Path(__file__).resolve().parents[1] / "models" / ENGINE)))
_lock = threading.Lock()
_loaded = None

def load_model():
    global _loaded
    if _loaded is not None:
        return _loaded
    if not (MODEL_DIR / "config.json").is_file():
        raise RuntimeError("Chưa cài model dịch. Trong backend chạy: python setup_translation.py")
    try:
        import torch
        from transformers import MarianTokenizer, MarianMTModel
    except ImportError:
        raise RuntimeError("Thiếu thư viện dịch. Chạy: pip install -r requirements-translation.txt")
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    tokenizer = MarianTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    model = MarianMTModel.from_pretrained(str(MODEL_DIR), local_files_only=True).to("cpu").eval()
    _loaded = (torch, tokenizer, model)
    return _loaded

MOVE_ITEM = re.compile(r"(?:(?<![\w.])\d+\.(?:\.\.)?\s*)?" + SAN.pattern)


def notation_only(text):
    if not SAN.search(text):
        return False
    remainder = MOVE_ITEM.sub("", text)
    remainder = re.sub(r"1/2-1/2|½-½|1-0|0-1", "", remainder)
    return not re.search(r"[^\s.?!,;:()\[\]{}*+−–-]", remainder)


def notation_runs(text):
    """Copy long variations unchanged; do not split prose at every square/term."""
    matches = list(MOVE_ITEM.finditer(text))
    groups = []
    for match in matches:
        if groups and re.fullmatch(r"[\s()\[\],;]*", text[groups[-1][-1].end():match.start()]):
            groups[-1].append(match)
        else:
            groups.append([match])
    end = 0
    for group in groups:
        if len(group) < 3:
            continue
        start, stop = group[0].start(), group[-1].end()
        result = re.match(r"\s+(?:1/2-1/2|½-½|1-0|0-1)(?!\w)", text[stop:])
        if result:
            stop += result.end()
        if start > end:
            yield text[end:start], False
        yield text[start:stop], True
        end = stop
    if end < len(text):
        yield text[end:], False


def segments(text, tokenizer, limit=400):
    # Keep complete sentences, including a leading move such as 8.Bb5!? .
    output = []
    def add(part):
        if not part:
            return
        if len(tokenizer.encode(">>vie<< " + part)) <= limit:
            output.append(part)
            return
        middle = len(part) // 2
        cut = part.rfind(" ", 0, middle + 1)
        if cut < 1:
            cut = max(1, middle)
        add(part[:cut]); add(part[cut:].lstrip())
    text = text.strip()
    start = 0
    for boundary in re.finditer(r"(?<=[.!?])\s+", text):
        candidate = text[start:boundary.start()].strip()
        if notation_only(candidate):
            continue
        add(candidate)
        start = boundary.end()
    add(text[start:].strip())
    return output


def _translate_fragment(text, runtime):
    torch, tokenizer, model = runtime
    translated = []
    for part in segments(text, tokenizer):
        # The Helsinki-NLP model card requires the >>vie<< target token.
        # https://huggingface.co/Helsinki-NLP/opus-mt-en-vi
        inputs = tokenizer(">>vie<< " + part, return_tensors="pt", truncation=False)
        with torch.inference_mode():
            output = model.generate(**inputs, num_beams=2, max_new_tokens=512,
                                    repetition_penalty=1.15, no_repeat_ngram_size=4)
        if output.shape[-1] >= 512 and int(output[0, -1]) != model.config.eos_token_id:
            raise RuntimeError("Đoạn dịch vượt giới hạn đầu ra. Chọn đoạn ngắn hơn.")
        translated.append(tokenizer.decode(output[0], skip_special_tokens=True))
    return " ".join(translated)


def translate_text(text, glossary=""):
    with _lock:
        runtime = None
        output = []
        for paragraph in re.split(r"(\n\s*\n)", text):
            if not re.search(r"[A-Za-z]", paragraph) or notation_only(paragraph):
                output.append(paragraph)
                continue
            for source, fixed in notation_runs(paragraph):
                if fixed or not re.search(r"[A-Za-z]", source):
                    output.append(source)
                    continue
                if runtime is None:
                    runtime = load_model()
                prefix = re.match(r"^\s*", source).group()
                suffix = re.search(r"\s*$", source).group()
                # Context includes the entire clause: never translate isolated
                # fragments such as 'of', 'for the', or 'against the'.
                output.append(prefix + _translate_fragment(source.strip(), runtime) + suffix)
        return polish_terms(text, "".join(output), glossary)
