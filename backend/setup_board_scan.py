"""Explicit, checksum-verified model setup. Run from backend's virtualenv."""
import hashlib
import sys
import urllib.request
from services import local_board_scan as scan


def main():
    if sys.version_info < (3, 11):
        raise RuntimeError('Quét local cần Python 3.11 trở lên.')
    state = scan.status()
    if not state['installed']:
        raise RuntimeError(scan.INSTALL)
    path = scan.model_path()
    if not state['ready']:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.download')
        digest = hashlib.sha256()
        print('Đang tải model chessvision từ Hugging Face...', flush=True)
        try:
            with urllib.request.urlopen(scan.MODEL_URL, timeout=60) as response, temporary.open('wb') as target:
                for chunk in iter(lambda: response.read(1024 * 1024), b''):
                    target.write(chunk)
                    digest.update(chunk)
            if digest.hexdigest() != scan.MODEL_SHA256:
                raise RuntimeError('Model không khớp SHA-256; không sử dụng file tải lỗi.')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    print(scan.probe()['message'])
    print('Sẵn sàng. Chọn Local · chessvision trong Thư Phòng. Không cần API key.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Không thiết lập được quét local: ' + str(error), file=sys.stderr)
        sys.exit(1)
