"""Validate portable book data. Packages contain text/media, never executable HTML or JS."""
from io import BytesIO
import json
from pathlib import PurePosixPath
import re
import stat
from zipfile import ZipFile, BadZipFile
from zlib import error as ZlibError

from PIL import Image
from pydantic import ValidationError
from services.online_books import Book

MAX_UPLOAD = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_FILE = 16 * 1024 * 1024
ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,79}$')
MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
        '.pdf':'application/pdf','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain'}


def path_name(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or '\x00' in value:
        raise ValueError('Đường dẫn trong gói sách không hợp lệ.')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or str(path) != value:
        raise ValueError('Đường dẫn trong gói sách không hợp lệ.')
    return value


def json_file(files, name):
    if name not in files or len(files[name]) > 10 * 1024 * 1024:
        raise ValueError('Thiếu hoặc quá lớn: '+name)
    try:
        return json.loads(files[name])
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ValueError('Dữ liệu JSON không hợp lệ: '+name) from exc


def read_package(raw):
    if len(raw) > MAX_UPLOAD:
        raise ValueError('Gói sách vượt quá 64 MB.')
    files = {}
    try:
        with ZipFile(BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 3000 or sum(e.file_size for e in entries) > MAX_EXPANDED:
                raise ValueError('Gói sách có quá nhiều tệp hoặc dung lượng giải nén quá lớn.')
            for entry in entries:
                name = path_name(entry.filename)
                if entry.is_dir() or name in files or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                    raise ValueError('Gói sách có tệp trùng, thư mục, liên kết hoặc tệp mã hóa không được hỗ trợ.')
                if entry.file_size > MAX_FILE:
                    raise ValueError('Một tệp trong gói sách vượt quá 16 MB.')
                if entry.compress_type not in (0, 8):
                    raise ValueError('Gói sách cần dùng định dạng nén ZIP thông thường (deflate).')
                allowed = name == 'manifest.json' or name == 'book.pdf' or (name.startswith('content/') and name.endswith('.json')) or (name.startswith('assets/') and PurePosixPath(name).suffix.lower() in MIME)
                if not allowed:
                    raise ValueError('Gói sách chỉ nhận JSON, hình, phông chữ và PDF; không nhận mã thực thi.')
                files[name] = archive.read(entry)
    except (BadZipFile, OSError, RuntimeError, EOFError, ZlibError) as exc:
        raise ValueError('Không đọc được gói sách. Hãy chọn tệp .thcbook hoặc ZIP hợp lệ.') from exc
    manifest = json_file(files, 'manifest.json')
    if not isinstance(manifest, dict) or manifest.get('format') != 'tinh-huyen-book' or manifest.get('version') != 1:
        raise ValueError('Không đúng định dạng gói sách Tĩnh Huyền Các.')
    try:
        book = Book(title=manifest.get('title'), author=manifest.get('author',''), subject=manifest.get('subject',''),
                    description=manifest.get('description',''), url=manifest.get('source_url'))
    except ValidationError as exc:
        raise ValueError('Thông tin tên sách hoặc nguồn trong gói không hợp lệ.') from exc
    if not isinstance(manifest.get('id'),str) or not ID.fullmatch(manifest['id']):
        raise ValueError('Mã gói sách không hợp lệ.')
    catalog = json_file(files, 'content/catalog.json')
    figures = json_file(files, 'content/figures.json')
    labels = json_file(files, 'content/page-labels.json')
    if not isinstance(catalog,list) or not 1 <= len(catalog) <= 300 or not isinstance(figures,dict) or not isinstance(labels,dict):
        raise ValueError('Mục lục hoặc danh sách hình không hợp lệ.')
    docs, ids, page_count = {}, set(), 0
    for chapter in catalog:
        if not isinstance(chapter,dict) or not isinstance(chapter.get('id'),str) or not ID.fullmatch(chapter['id']) or chapter['id'] in ids | {'home','main','constructor','prototype'}:
            raise ValueError('Mã chương không hợp lệ hoặc bị trùng.')
        if chapter.get('number') is not None and (type(chapter['number']) is not int or not 1 <= chapter['number'] <= 10000):
            raise ValueError('Số thứ tự chương không hợp lệ.')
        cid = chapter['id']; ids.add(cid)
        if not isinstance(chapter.get('title'),str) or not chapter['title'].strip() or len(chapter['title']) > 200:
            raise ValueError('Tiêu đề chương không hợp lệ.')
        if not all(type(chapter.get(k)) is int and 1 <= chapter[k] <= 100000 for k in ('start','end')) or chapter['end'] < chapter['start']:
            raise ValueError('Khoảng trang trong mục lục không hợp lệ.')
        data = json_file(files, f'content/{cid}.json')
        if not isinstance(data,dict) or data.get('id') != cid or not isinstance(data.get('pages'),list) or not data['pages']:
            raise ValueError('Nội dung chương không hợp lệ.')
        seen_pages = set()
        for page in data['pages']:
            if not isinstance(page,dict) or type(page.get('page')) is not int or not chapter['start'] <= page['page'] <= chapter['end'] or page['page'] in seen_pages:
                raise ValueError('Số trang trong chương không hợp lệ hoặc bị trùng.')
            seen_pages.add(page['page']); page_count += 1
            if not isinstance(page.get('blocks'),list) or len(page['blocks']) > 3000:
                raise ValueError('Các đoạn văn trong chương không hợp lệ.')
            for block in page['blocks']:
                if not isinstance(block,dict) or block.get('type') not in ('p','h2','h3','moves','quote','test','figure') or not isinstance(block.get('text',''),str) or len(block.get('text','')) > 100000:
                    raise ValueError('Đoạn văn trong gói sách không hợp lệ.')
        docs[f'{cid}.json'] = data
    if page_count > 10000:
        raise ValueError('Gói sách có quá nhiều trang.')
    if manifest.get('start','home') not in ids | {'home'} or manifest.get('solution_chapter') not in ids | {None}:
        raise ValueError('Chương bắt đầu hoặc chương lời giải không có trong mục lục.')
    assets = []
    for name, data in files.items():
        suffix = PurePosixPath(name).suffix.lower()
        if suffix not in MIME:
            continue
        if suffix in ('.png','.jpg','.jpeg','.webp'):
            try:
                with Image.open(BytesIO(data)) as image:
                    if image.width * image.height > 16_000_000 or image.format not in ('PNG','JPEG','WEBP'):
                        raise ValueError('Hình trong gói quá lớn hoặc sai định dạng.')
                    image.verify()
            except (OSError, SyntaxError, Image.DecompressionBombError) as exc:
                raise ValueError('Hình trong gói sách không hợp lệ.') from exc
        elif suffix == '.pdf' and not data.startswith(b'%PDF-'):
            raise ValueError('PDF trong gói sách không hợp lệ.')
        elif suffix in ('.woff','.woff2') and not data.startswith(b'wOFF' if suffix == '.woff' else b'wOF2'):
            raise ValueError('Phông chữ trong gói sách không hợp lệ.')
        elif suffix == '.txt':
            try:
                data.decode('utf-8')
            except UnicodeError as exc:
                raise ValueError('Tệp giấy phép phông chữ không hợp lệ.') from exc
        assets.append((name,MIME[suffix],data))
    for page, group in figures.items():
        if not str(page).isdigit() or not isinstance(group,list) or len(group) > 300:
            raise ValueError('Danh sách hình trong sách không hợp lệ.')
        for figure in group:
            if not isinstance(figure,dict) or not isinstance(figure.get('id'),str):
                raise ValueError('Thông tin hình không hợp lệ.')
            source = path_name(figure.get('src'))
            if source not in files or PurePosixPath(source).suffix.lower() not in ('.png','.jpg','.jpeg','.webp'):
                raise ValueError('Gói sách bị thiếu hình: '+source)
    for data in docs.values():
        for page in data['pages']:
            found = {f['id'] for f in figures.get(str(page['page']),[])}
            if any(b.get('type') == 'figure' and b.get('figureId') not in found for b in page['blocks']):
                raise ValueError('Gói sách có hình được dẫn chiếu nhưng không có dữ liệu.')
    cover = manifest.get('cover')
    if cover and (path_name(cover) not in files or PurePosixPath(cover).suffix.lower() not in ('.png','.jpg','.jpeg','.webp')):
        raise ValueError('Không tìm thấy ảnh bìa trong gói sách.')
    exercise_count = 0
    if manifest.get('exercise_file') is not None:
        if manifest['exercise_file'] != 'exercises.json':
            raise ValueError('Tên dữ liệu bài tập không hợp lệ.')
        from services.book_exercises import validate_exercises
        exercises = json_file(files, 'content/exercises.json')
        exercise_count = validate_exercises(exercises)
        present_pages = {p['page'] for chapter in docs.values() for p in chapter['pages']}
        if any(e['page'] not in present_pages or e['answer_page'] not in present_pages for e in exercises):
            raise ValueError('Bài tập dẫn tới trang không có trong gói sách.')
        docs['exercises.json'] = exercises
    docs.update({'catalog.json':catalog,'figures.json':figures,'page-labels.json':labels})
    manifest = {**book.model_dump(), 'source_url':book.url, 'id':manifest['id'],
                'start':manifest.get('start','home'), 'solution_chapter':manifest.get('solution_chapter'),
                'notice':str(manifest.get('notice',''))[:2000], 'cover':cover,
                'legacy_backup_app':str(manifest.get('legacy_backup_app',''))[:80],
                'chapters':sum(bool(c.get('number')) for c in catalog), 'pages':page_count,
                'figures':sum(len(v) for v in figures.values()), 'pdf':'book.pdf' in files,
                'assets':[a[0] for a in assets], 'exercises':exercise_count,
                'exercise_file':'exercises.json' if exercise_count else None,
                'edition':str(manifest.get('edition','Bản dịch tiếng Việt'))[:100],
                'language':str(manifest.get('language',''))[:20]}
    return book, manifest, docs, assets
