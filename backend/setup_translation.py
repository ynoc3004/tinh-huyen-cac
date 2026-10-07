"""Download the translation model once. Books are never uploaded."""
from services.local_translation import MODEL_DIR, MODEL_ID, load_model
from huggingface_hub import snapshot_download

if __name__ == "__main__":
    print("Downloading English–Vietnamese model to", MODEL_DIR, flush=True)
    snapshot_download(repo_id=MODEL_ID, local_dir=str(MODEL_DIR),
                      allow_patterns=["*.json", "*.spm", "*.bin", "*.safetensors"])
    load_model()
    print("Model ready. Restart backend and choose OPUS-MT Anh → Việt.")
