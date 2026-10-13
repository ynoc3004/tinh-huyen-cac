"""Bounded, self-contained worksheet logos; preserve colours and aspect ratio."""
import base64
import binascii
from functools import lru_cache
from io import BytesIO

from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError

MAX_UPLOAD = 5 * 1024 * 1024
MAX_PIXELS = 8_000_000
MAX_SIDE = 512
PREFIX = "data:image/png;base64,"


def encode(image):
    stream = BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return PREFIX + base64.b64encode(stream.getvalue()).decode("ascii")


def prepare_logo(raw):
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError("Logo cần là ảnh PNG, JPG hoặc WebP, dung lượng tối đa 5 MB.")
    try:
        with Image.open(BytesIO(raw), formats=["PNG", "JPEG", "WEBP"]) as source:
            if source.width * source.height > MAX_PIXELS:
                raise ValueError("Logo quá lớn; hãy chọn ảnh không vượt quá 8 triệu điểm ảnh.")
            image = ImageOps.exif_transpose(source).convert("RGBA")
        alpha = image.getchannel("A")
        transparent = alpha.getextrema()[0] < 255
        if transparent:
            bounds = alpha.getbbox()
        else:
            difference = ImageChops.difference(image.convert("RGB"), Image.new("RGB", image.size, "white"))
            bounds = difference.point(lambda value: 255 if value > 8 else 0).getbbox()
        if not bounds:
            raise ValueError("Ảnh logo trống. Hãy chọn ảnh có nội dung nhìn thấy được.")
        image = image.crop(bounds)
        image.thumbnail((MAX_SIDE - 40, MAX_SIDE - 40), Image.Resampling.LANCZOS)
        padding = max(2, round(max(image.size) * .035))
        result = Image.new("RGBA", (image.width + padding * 2, image.height + padding * 2),
                           (255, 255, 255, 0 if transparent else 255))
        result.paste(image, (padding, padding))
        return {"logo": encode(result), "width": result.width, "height": result.height}
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("Không đọc được logo. Hãy chọn ảnh PNG, JPG hoặc WebP hợp lệ.") from exc


@lru_cache(maxsize=16)
def validate_logo(value):
    if not isinstance(value, str) or not value.startswith(PREFIX) or len(value) > 1_500_000:
        raise ValueError("Logo không hợp lệ; hãy tải lại ảnh bằng nút chọn logo.")
    try:
        raw = base64.b64decode(value[len(PREFIX):], validate=True)
        with Image.open(BytesIO(raw), formats=["PNG"]) as image:
            if not (1 <= image.width <= MAX_SIDE and 1 <= image.height <= MAX_SIDE):
                raise ValueError("Logo chưa được xử lý; hãy tải lại ảnh bằng nút chọn logo.")
            # Strip metadata and retain a single frame. Never load a URL or a filesystem path.
            return encode(image.convert("RGBA"))
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Logo không hợp lệ; hãy tải lại ảnh bằng nút chọn logo.") from exc
