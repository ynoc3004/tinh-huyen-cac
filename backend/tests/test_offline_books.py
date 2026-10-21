from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import db
from routers import books
from services import offline_books


class OfflineBooksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.db_patch = patch.object(db,'DB_PATH',Path(self.tmp.name)/'app.db')
        self.db_patch.start(); self.addCleanup(self.db_patch.stop); db.init()
        app=FastAPI();app.include_router(books.router);self.client=TestClient(app)
        stream=BytesIO();Image.new('RGB',(4,4),'white').save(stream,format='PNG');self.png=stream.getvalue()
        self.manifest={'format':'tinh-huyen-book','version':1,'id':'winning-chess-strategies',
            'title':'Sách đã tải','author':'Tác giả','subject':'Chiến lược',
            'source_url':'https://winning-chess-strategies-viet.exactpony8.chatgpt.site/#chapter-01',
            'start':'chapter-01','cover':'assets/cover.png'}
        self.files={'manifest.json':self.manifest,'content/catalog.json':[{'id':'chapter-01','title':'Kế hoạch','start':1,'end':1,'number':1}],
            'content/figures.json':{'1':[{'id':'p1','src':'assets/board.png'}]},'content/page-labels.json':{'1':'1'},
            'content/chapter-01.json':{'id':'chapter-01','title':'Kế hoạch','pages':[{'page':1,'blocks':[{'type':'p','text':'Đọc được khi ngắt mạng.'},{'type':'figure','figureId':'p1','text':'Thế cờ thứ nhất'}]}]},
            'assets/board.png':self.png,'assets/cover.png':self.png,'book.pdf':b'%PDF-1.7\nfixture'}

    def package(self, changes=None):
        files={**self.files,**(changes or {})}; stream=BytesIO()
        with ZipFile(stream,'w',ZIP_DEFLATED) as archive:
            for name,data in files.items():
                if data is not None:archive.writestr(name,json.dumps(data,ensure_ascii=False).encode() if isinstance(data,(dict,list)) else data)
        return stream.getvalue()

    def upload(self, raw=None):
        return self.client.post('/api/books/import',content=raw or self.package(),headers={'Content-Type':'application/zip'})

    def test_import_upgrades_link_and_all_reads_work_locally_after_restart(self):
        response=self.upload();self.assertEqual(response.status_code,200,response.text)
        result=response.json();self.assertEqual(result['id'],'winning-chess-strategies');self.assertTrue(result['offline'])
        self.assertEqual(result['stats'],{'chapters':1,'pages':1,'figures':1,'pdf':True})
        db.init()
        with patch('httpx.AsyncClient',side_effect=AssertionError('No external network allowed')):
            self.assertTrue(self.client.get('/api/books/'+result['id']).json()['offline'])
            meta=self.client.get('/api/books/'+result['id']+'/offline').json();self.assertEqual(meta['pages'],1)
            content=self.client.get('/api/books/'+result['id']+'/content/chapter-01.json').json()
            self.assertEqual(content,self.files['content/chapter-01.json'])
            image=self.client.get('/api/books/'+result['id']+'/asset/assets/board.png')
            self.assertEqual(image.content,self.png);self.assertTrue(image.headers['content-type'].startswith('image/png'))
            self.assertEqual(image.headers['x-content-type-options'],'nosniff')
            self.assertTrue(self.client.get('/api/books/'+result['id']+'/asset/book.pdf').content.startswith(b'%PDF-'))

    def test_reimport_keeps_one_book_replaces_assets_and_preserves_edited_metadata(self):
        self.upload();book=self.client.get('/api/books/winning-chess-strategies').json();book['title']='Tên riêng của tôi'
        self.assertEqual(self.client.put('/api/books/'+book['id'],json=book).status_code,200)
        self.upload();self.assertEqual(self.client.get('/api/books/'+book['id']).json()['title'],'Tên riêng của tôi')
        with db.conn() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM online_books').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM online_book_packages').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM online_book_assets').fetchone()[0],3)
        book['url']='https://another.example.org/'
        self.assertEqual(self.client.put('/api/books/'+book['id'],json=book).status_code,409)

    def test_multiple_packages_and_delete_are_isolated(self):
        first=self.upload().json()
        second=self.upload(self.package({'manifest.json':{**self.manifest,'id':'second','source_url':'https://second.example.org/'}})).json()
        self.assertNotEqual(first['id'],second['id'])
        self.assertEqual(self.client.delete('/api/books/'+first['id']).status_code,200)
        db.init()
        self.assertEqual(self.client.get('/api/books/'+first['id']+'/offline').status_code,404)
        self.assertEqual(self.client.get('/api/books/'+first['id']+'/asset/book.pdf').status_code,404)
        self.assertEqual(self.client.get('/api/books/'+second['id']+'/asset/book.pdf').status_code,200)
        with db.conn() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM online_book_assets WHERE book_id=?',(first['id'],)).fetchone()[0],0)

    def test_invalid_archives_never_change_a_previous_good_import(self):
        self.upload();before=self.client.get('/api/books/winning-chess-strategies/offline').json()
        cases=[b'not a zip',self.package({'../outside.png':self.png}),self.package({'assets/attack.js':b'alert(1)'}),
            self.package({'content/chapter-01.json':None}),self.package({'assets/board.png':None}),
            self.package({'assets/board.png':b'not an image'}),self.package({'book.pdf':b'not a pdf'}),
            self.package({'content/catalog.json':[]}),self.package({'content/figures.json':{'1':[{'id':'p1','src':'https://remote.example.org/image.png'}]}})]
        for raw in cases:
            response=self.upload(raw);self.assertEqual(response.status_code,400,response.text)
        self.assertEqual(self.client.get('/api/books/winning-chess-strategies/offline').json(),before)
        self.assertEqual(self.client.get('/api/books/winning-chess-strategies/asset/assets/board.png').content,self.png)

    def test_limits_missing_files_and_duplicate_archive_names(self):
        with patch.object(offline_books,'MAX_UPLOAD',10):
            self.assertEqual(self.upload().status_code,413)
        with patch.object(offline_books,'MAX_EXPANDED',10):
            self.assertEqual(self.upload().status_code,400)
        with patch.object(offline_books,'MAX_FILE',10):
            self.assertEqual(self.upload().status_code,400)
        self.assertEqual(self.client.get('/api/books/missing/content/catalog.json').status_code,404)
        stream=BytesIO()
        with ZipFile(stream,'w') as archive:
            archive.writestr('manifest.json','{}');archive.writestr('./manifest.json','{}')
        self.assertEqual(self.upload(stream.getvalue()).status_code,400)


if __name__=='__main__':unittest.main()
