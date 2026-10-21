"""An extensible catalog of hosted study books; content stays at the original site."""
import unicodedata
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator


def text(value):
    return unicodedata.normalize('NFC', ' '.join(value.split()))


def normalize_url(value):
    value = value.strip()
    try:
        parts = urlsplit(value)
        host = parts.hostname
        if (parts.scheme.lower() != 'https' or not host or parts.username is not None
                or parts.password is not None or any(c.isspace() or ord(c) < 32 for c in value)
                or '\\' in value or parts.port not in (None, 443)):
            raise ValueError
        host = host.encode('idna').decode('ascii').lower()
        if not all(part and part[0] != '-' and part[-1] != '-' and
                   all(c.isalnum() or c == '-' for c in part) for part in host.split('.')):
            raise ValueError
        return urlunsplit(('https', host, parts.path or '/', parts.query, parts.fragment))
    except (ValueError, UnicodeError) as exc:
        raise ValueError('Nhập đường dẫn HTTPS hợp lệ, không kèm tên đăng nhập hoặc mật khẩu.') from exc


def url_key(value):
    parts = urlsplit(value)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ''))


class Book(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    author: str = Field(default='', max_length=120)
    subject: str = Field(default='', max_length=80)
    description: str = Field(default='', max_length=600)
    url: str = Field(min_length=1, max_length=2048)

    @field_validator('title', 'author', 'subject', 'description')
    @classmethod
    def clean_text(cls, value, info):
        value = text(value)
        if info.field_name == 'title' and not value:
            raise ValueError('Tên sách không được trống.')
        return value

    @field_validator('url')
    @classmethod
    def clean_url(cls, value):
        return normalize_url(value)


def fold(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold().replace('đ', 'd'))
                   if not unicodedata.combining(c))


def seed(db):
    marker = 'online-books-winning-strategies-v1'
    if db.execute('SELECT 1 FROM app_migrations WHERE name=?', (marker,)).fetchone():
        return
    book = Book(title='Winning Chess Strategies', author='Yasser Seirawan', subject='Chiến lược',
                description='Bản dịch tiếng Việt theo chương, kèm hình thế cờ và tiến độ học cá nhân.',
                url='https://winning-chess-strategies-viet.exactpony8.chatgpt.site/#chapter-01')
    db.execute('INSERT OR IGNORE INTO online_books(id,title,author,subject,description,url,url_key) VALUES(?,?,?,?,?,?,?)',
               ('winning-chess-strategies', book.title, book.author, book.subject, book.description, book.url, url_key(book.url)))
    db.execute('INSERT INTO app_migrations(name) VALUES(?)', (marker,))
