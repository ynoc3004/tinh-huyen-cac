"""CPU English-to-Vietnamese translation. Never downloads during a book request."""
import os
import re
import threading
from pathlib import Path

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

def translate_text(text):
    with _lock:
        torch, tokenizer, model = load_model()
        paragraphs = []
        for paragraph in text.split("\n\n"):
            translated = []
            for part in segments(paragraph, tokenizer):
                inputs = tokenizer(">>vie<< " + part, return_tensors="pt", truncation=False)
                with torch.inference_mode():
                    output = model.generate(**inputs, num_beams=2, max_new_tokens=512)
                if output.shape[-1] >= 512 and int(output[0, -1]) != model.config.eos_token_id:
                    raise RuntimeError("Đoạn dịch vượt giới hạn đầu ra. Chọn đoạn ngắn hơn.")
                translated.append(tokenizer.decode(output[0], skip_special_tokens=True))
            paragraphs.append(" ".join(translated))
        return "\n\n".join(paragraphs)
