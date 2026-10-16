"""CPU English-to-Vietnamese translation. Never downloads during a book request."""
import os
import re
import threading
from pathlib import Path
from services.chess_translation import protected_parts

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

def segments(text, tokenizer, limit=400):
    # Split by sentences, then recursively split long sentences; never truncate input.
    output = []
    def add(part):
        if not part: return
        if len(tokenizer.encode(">>vie<< " + part)) <= limit:
            output.append(part); return
        middle = len(part) // 2
        cut = part.rfind(" ", 0, middle + 1)
        if cut < 1: cut = max(1, middle)
        add(part[:cut]); add(part[cut:].lstrip())
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        add(sentence)
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
        output, fragments = [], {}
        # Match names even when a PDF title splits them across lines/blocks.
        for source, fixed in protected_parts(text, glossary):
            if fixed is not None:
                output.append(fixed)
                continue
            for fragment in re.split(r"(\n\s*\n)", source):
                # Copy punctuation, move numbers and whitespace verbatim.
                if not re.search(r"[A-Za-z]", fragment):
                    output.append(fragment)
                    continue
                prefix = re.match(r"^\s*", fragment).group()
                suffix = re.search(r"\s*$", fragment).group()
                core = fragment.strip()
                if core not in fragments:
                    if runtime is None:
                        runtime = load_model()
                    fragments[core] = _translate_fragment(core, runtime)
                output.append(prefix + fragments[core] + suffix)
        return "".join(output)
