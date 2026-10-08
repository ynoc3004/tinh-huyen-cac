"""Offline diagram recognition using the MIT chessvision ONNX classifier.

Downloading is an explicit setup step, never part of a book scan request.
Only piece placement is returned; side to move and historic rights stay unknown.
"""
import hashlib
import importlib.util
import io
import os
import threading
from functools import lru_cache
from pathlib import Path

ENGINE = 'local:chessvision'
MODEL_NAME = 'chess_piece_classifier.onnx'
MODEL_SHA256 = '66de5d17f07b822fbb5957615c0880ce02a0cab977c83dafa033f3b71eb4a7fc'
MODEL_URL = 'https://huggingface.co/harshitpawar64/chessvision/resolve/main/' + MODEL_NAME
INSTALL = 'Trong thư mục backend, chạy python -m pip install -r requirements-scan.txt rồi python setup_board_scan.py.'
_lock = threading.Lock()
_predictor = None
_predictor_signature = None


def model_path():
    custom = os.getenv('CHESSVISION_MODEL_PATH', '').strip()
    if custom:
        return Path(custom).expanduser()
    from platformdirs import user_cache_path
    return user_cache_path('chessvision', appauthor=False) / MODEL_NAME


@lru_cache(maxsize=4)
def _verified(path, size, modified):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest() == MODEL_SHA256


def status():
    installed = all(importlib.util.find_spec(name) is not None
                    for name in ('chessvision', 'onnxruntime', 'cv2', 'platformdirs', 'chess', 'PIL'))
    ready = False
    if installed:
        try:
            path = model_path()
            stat = path.stat()
            ready = _verified(str(path), stat.st_size, stat.st_mtime_ns)
        except OSError:
            pass
    message = ('Local miễn phí · model đã tải, quét trên CPU và không gửi ảnh ra ngoài.'
               if ready else 'Chưa sẵn sàng quét local. ' + INSTALL)
    return {'installed': installed, 'ready': ready, 'message': message}


def _get_predictor():
    global _predictor, _predictor_signature
    state = status()
    if not state['ready']:
        raise RuntimeError(state['message'])
    path = model_path()
    stat = path.stat()
    signature = (str(path), stat.st_size, stat.st_mtime_ns)
    if _predictor is None or signature != _predictor_signature:
        import onnxruntime as ort
        from chessvision import BoardPredictor, PieceClassifier
        from chessvision.constants import IMAGE_SIZE, PIECE_CLASSES
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        # Use the pinned package's preprocessing, with an explicit CPU session.
        # Avoid its constructor's implicit download and unrestricted threads.
        classifier = PieceClassifier.__new__(PieceClassifier)
        classifier.model_path = path
        classifier.session = ort.InferenceSession(str(path), sess_options=options,
                                                  providers=['CPUExecutionProvider'])
        classifier.input_name = classifier.session.get_inputs()[0].name
        classifier.output_name = classifier.session.get_outputs()[0].name
        classifier.classes = PIECE_CLASSES
        classifier.image_size = IMAGE_SIZE
        _predictor = BoardPredictor(classifier=classifier)
        _predictor_signature = signature
    return _predictor


def _regions(image, proposals):
    """Recover exact detector crops in page coordinates, including PDF images."""
    import cv2
    import numpy as np
    from chessvision import BoardDetector
    cv2.setNumThreads(2)
    width, height = image.size
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    detector = BoardDetector()
    boxes = []
    preferred = []
    sources = [(0, 0, width, height)]
    for top, left, bottom, right in proposals:
        sources.append((max(0, round(left * width / 1000)), max(0, round(top * height / 1000)),
                        min(width, round(right * width / 1000)), min(height, round(bottom * height / 1000))))
    for left, top, right, bottom in sources:
        if right - left < 64 or bottom - top < 64:
            continue
        area = image.crop((left, top, right, bottom))
        # The upstream detector uses median pixels, which can miss thin
        # hatch-pattern dark squares in monochrome books. Check cell means
        # on square contours as a second detector, before running the model.
        area_gray = gray[top:bottom, left:right]
        if .95 <= area.width / area.height <= 1.05 and _is_grid(area_gray):
            boxes.append((left, top, right, bottom))
        _, binary = cv2.threshold(area_gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        minimum = min(area.width, area.height) * .1
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if w >= max(64, minimum) and h >= max(64, minimum) and .95 <= w / h <= 1.05:
                candidate = area_gray[y:y+h, x:x+w]
                if _is_grid(candidate):
                    boxes.append((left+x, top+y, left+x+w, top+y+h))
        for crop in detector.detect(area):
            needle = cv2.cvtColor(np.asarray(crop), cv2.COLOR_RGB2GRAY)
            source = gray[top:bottom, left:right]
            if needle.shape[0] > source.shape[0] or needle.shape[1] > source.shape[1]:
                continue
            _, score, _, point = cv2.minMaxLoc(cv2.matchTemplate(source, needle, cv2.TM_CCOEFF_NORMED))
            if score < .99:
                continue
            x, y = point
            preferred.append((left + x, top + y, left + x + crop.width, top + y + crop.height))
    # De-duplicate contours and embedded images describing the same board.
    selected = []
    # Preserve the upstream detector's grid alignment when it succeeds.
    # Hatch-pattern fallback only fills regions that it could not detect.
    size = lambda b: (b[2] - b[0]) * (b[3] - b[1])
    for box in sorted(preferred, key=size, reverse=True) + sorted(boxes, key=size, reverse=True):
        x, y, right, bottom = box
        area = (right - x) * (bottom - y)
        duplicate = False
        for a, b, c, d in selected:
            overlap = max(0, min(right, c) - max(x, a)) * max(0, min(bottom, d) - max(y, b))
            other = (c - a) * (d - b)
            if overlap / min(area, other) > .6:
                duplicate = True
                break
        if not duplicate:
            selected.append(box)
    return sorted(selected, key=lambda b: (b[1], b[0]))[:24]


def _is_grid(gray):
    import cv2
    import numpy as np
    resized = cv2.resize(gray, (128, 128), interpolation=cv2.INTER_AREA)
    cells = resized.reshape(8, 16, 8, 16).swapaxes(1, 2)
    means = cells[:, :, 2:14, 2:14].mean(axis=(2, 3))
    parity = (np.arange(8)[:, None] + np.arange(8)) % 2 == 0
    first, second = np.median(means[parity]), np.median(means[~parity])
    if abs(first - second) < 20:
        return False
    # Pieces can cover individual squares; require a coherent checker pattern.
    direction = 1 if first > second else -1
    pairs = (means[:, :-1] - means[:, 1:]) * np.where(parity[:, :-1], 1, -1) * direction
    return float((pairs > 8).mean()) >= .65


def scan_image(image_bytes, proposals=()):
    # Check setup before importing optional heavy dependencies.
    state = status()
    if not state['ready']:
        raise RuntimeError(state['message'])
    from PIL import Image
    from chessvision import Orientation, Turn
    from services.board_scan import validate_placement
    with _lock:
        predictor = _get_predictor()
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        width, height = image.size
        output = []
        for left, top, right, bottom in _regions(image, proposals):
            crop = image.crop((left, top, right, bottom))
            # Printed borders/coordinates must not become part of the 64 cells.
            # Compare inner contours and small insets, without adding/removing
            # pieces based on surrounding prose or guessed opening positions.
            choices = []
            for box in _grid_candidates(crop):
                prediction = predictor.predict(crop.crop(box), orientation=Orientation.AUTO,
                                               turn=Turn.WHITE, castling='-')
                errors = [e for e in prediction.validation_errors if e != 'Side not to move is in check']
                score = float(prediction.confidence) - (.2 if errors else 0)
                choices.append((score, prediction, box, errors))
            _, prediction, box, errors = max(choices, key=lambda choice: choice[0])
            x, y, x2, y2 = box
            right, bottom = left + x2, top + y2
            left, top = left + x, top + y
            placement = prediction.fen.split()[0]
            valid = validate_placement(placement)
            confidence = float(prediction.confidence)
            review_squares = [name for name, square in prediction.squares.items() if float(square.confidence) < .85]
            uncertain = len(review_squares)
            warning = 'Kiểm tra hướng bàn cờ và lượt đi trong sách.'
            if uncertain:
                warning = f'Ô cần kiểm tra: {", ".join(review_squares)}. ' + warning
            if not valid:
                warning = 'Chưa nhận đủ một vua mỗi bên. Nhập/sửa FEN. ' + warning
            elif errors:
                warning = 'Thế nhận diện có quân/vị trí bất thường; cần sửa trước khi học. ' + warning
            output.append({'bbox': [round(top * 1000 / height), round(left * 1000 / width),
                                    round(bottom * 1000 / height), round(right * 1000 / width)],
                           'placement': placement if valid else '', 'turn': 'unknown',
                           'orientation': str(prediction.orientation), 'label': '', 'warning': warning,
                           'confidence': round(confidence, 4), 'uncertain_squares': uncertain,
                           'review_squares': review_squares})
        return output


def _grid_candidates(image):
    import cv2
    import numpy as np
    width, height = image.size
    boxes = [(0, 0, width, height)]
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w >= width * .92 and h >= height * .92 and .95 <= w / h <= 1.05:
            boxes.append((x, y, x + w, y + h))
    for ratio in (.005, .01, .015, .02, .025):
        inset = round(min(width, height) * ratio)
        boxes.append((inset, inset, width - inset, height - inset))
    return list(dict.fromkeys(boxes))[:12]


def probe():
    if not status()['ready']:
        raise RuntimeError(status()['message'])
    from services.board_scan import probe_png
    from PIL import Image
    from chessvision import Orientation, Turn
    with _lock:
        predictor = _get_predictor()
        result = predictor.predict(Image.open(io.BytesIO(probe_png())),
                                   orientation=Orientation.WHITE, turn=Turn.WHITE, castling='-')
        if len(result.squares) != 64:
            raise RuntimeError('Model local không trả đủ 64 ô. Chạy lại python setup_board_scan.py.')
    return {'ok': True, 'model': ENGINE,
            'message': 'Model local chạy được trên CPU với ảnh thử 64 ô. Hãy kiểm tra độ chính xác trên hình trong sách.'}
