"""Persistent book catalogs, URL validation, one-time seeding and existing data isolation."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import db
from routers import books


class OnlineBooksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_patch = patch.object(db, 'DB_PATH', Path(self.tmp.name) / 'app.db')
        self.db_patch.start(); self.addCleanup(self.db_patch.stop)
        db.init()
        app = FastAPI(); app.include_router(books.router)
        self.client = TestClient(app)
        self.book = dict(title='  Học tàn cuộc  ', author='Tác giả A', subject='Tàn cuộc',
                         description='Ôn mỗi tuần.', url='https://BOOKS.example.org:443/#chapter-01')

    def test_requested_book_seeded_once_and_library_records_unchanged(self):
        with db.conn() as c:
            c.execute("INSERT INTO library_items(title,path) VALUES('Sách PDF cũ','vault:unchanged')")
        first = self.client.get('/api/books').json()
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]['id'], 'winning-chess-strategies')
        self.assertEqual(first[0]['author'], 'Yasser Seirawan')
        self.assertEqual(first[0]['url'], 'https://winning-chess-strategies-viet.exactpony8.chatgpt.site/#chapter-01')
        db.init(); db.init()
        self.assertEqual(self.client.get('/api/books').json(), first)
        with db.conn() as c:
            self.assertEqual(c.execute('SELECT path FROM library_items').fetchone()[0], 'vault:unchanged')

    def test_add_edit_search_and_persistence_for_multiple_books(self):
        response = self.client.post('/api/books', json=self.book)
        self.assertEqual(response.status_code, 201, response.text)
        book = response.json(); book_id = book['id']
        self.assertEqual(book['title'], 'Học tàn cuộc')
        self.assertEqual(book['url'], 'https://books.example.org/#chapter-01')
        self.assertEqual(self.client.get('/api/books?q=TAN CUOC').json(), [book])
        self.assertEqual(self.client.get('/api/books?q=tác giả a').json(), [book])
        new = dict(self.book, title='Kế hoạch trung cuộc', subject='Chiến lược',
                   url='https://second.example.org/#chapter-03')
        self.assertEqual(self.client.put('/api/books/'+book_id, json=new).status_code, 200)
        db.init()
        saved = self.client.get('/api/books/'+book_id).json()
        self.assertEqual(saved['title'], new['title'])
        self.assertEqual(saved['url'], new['url'])
        self.assertEqual(self.client.get('/api/books?q=KE HOACH').json(), [saved])
        self.assertEqual(len(self.client.get('/api/books').json()), 2)

    def test_duplicate_chapter_links_and_edit_conflicts_do_not_corrupt_books(self):
        first = self.client.post('/api/books', json=self.book).json()
        duplicate = dict(self.book, url='https://books.example.org/#chapter-10')
        self.assertEqual(self.client.post('/api/books', json=duplicate).status_code, 409)
        other = self.client.post('/api/books', json=dict(self.book, url='https://other.example.org/')).json()
        self.assertEqual(self.client.put('/api/books/'+other['id'], json=self.book).status_code, 409)
        self.assertEqual(self.client.get('/api/books/'+other['id']).json(), other)
        changed = self.client.put('/api/books/'+first['id'], json=duplicate)
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(changed.json()['url'].endswith('#chapter-10'))

    def test_remove_seed_or_custom_book_does_not_reappear_after_restart(self):
        added = self.client.post('/api/books', json=self.book).json()
        for book_id in ('winning-chess-strategies', added['id']):
            self.assertEqual(self.client.delete('/api/books/'+book_id).status_code, 200)
            self.assertEqual(self.client.get('/api/books/'+book_id).status_code, 404)
        db.init(); db.init()
        self.assertEqual(self.client.get('/api/books').json(), [])
        self.assertEqual(self.client.delete('/api/books/'+added['id']).status_code, 404)
        self.assertEqual(self.client.put('/api/books/missing', json=self.book).status_code, 404)

    def test_reject_invalid_or_executable_links_and_invalid_metadata(self):
        before = self.client.get('/api/books').json()
        for url in ('javascript:alert(1)', 'data:text/html,<script>', '/library.html',
                    'http://example.org', 'https://user:pass@example.org/',
                    'https://example.org:8443/', 'https://example.org\\@evil.org',
                    'https://example.org/\nattack', 'https://-bad.example.org/', 'https://bad_host.example.org/'):
            response = self.client.post('/api/books', json=dict(self.book, url=url))
            self.assertEqual(response.status_code, 422, (url, response.text))
        for field, value in (('title', ' '), ('title', 'x'*161), ('author', 'x'*121),
                             ('subject', 'x'*81), ('description', 'x'*601), ('url', 'https://example.org/'+'a'*2050)):
            self.assertEqual(self.client.post('/api/books', json=dict(self.book, **{field:value})).status_code, 422)
        self.assertEqual(self.client.get('/api/books').json(), before)


if __name__ == '__main__':
    unittest.main()
