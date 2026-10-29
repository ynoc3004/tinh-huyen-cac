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

    def correction(self, text, previous='Đọc được khi ngắt mạng.', **extra):
        return {'page':1,'block_index':0,'block_type':'p','previous_text':previous,'text':text,**extra}

    def test_text_corrections_survive_restart_and_preserve_assets_and_other_blocks(self):
        book_id=self.upload().json()['id'];base='/api/books/'+book_id
        before=self.client.get(base+'/content/chapter-01.json').json()
        r=self.client.patch(base+'/content/chapter-01.json',json=self.correction('Đọc được khi không có mạng.'))
        self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['saved']);db.init()
        saved=self.client.get(base+'/content/chapter-01.json')
        self.assertEqual(saved.headers['cache-control'],'no-store')
        self.assertEqual(saved.json()['pages'][0]['blocks'][0]['text'],'Đọc được khi không có mạng.')
        self.assertEqual(saved.json()['pages'][0]['blocks'][1],before['pages'][0]['blocks'][1])
        self.assertEqual(self.client.get(base+'/asset/assets/board.png').content,self.png)
        self.assertEqual(self.client.get(base+'/asset/book.pdf').content,self.files['book.pdf'])
        caption=self.correction('',previous='Thế cờ thứ nhất',block_index=1,block_type='figure')
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=caption).status_code,200)
        self.assertEqual(self.client.get(base+'/content/chapter-01.json').json()['pages'][0]['blocks'][1],{'type':'figure','figureId':'p1','text':''})

    def test_stale_corrections_never_overwrite_a_new_save_and_wrong_targets_are_rejected(self):
        base='/api/books/'+self.upload().json()['id']
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=self.correction('Bản sửa mới')).status_code,200)
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=self.correction('Bản sửa cũ')).status_code,409)
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=self.correction('Sai loại',previous='Bản sửa mới',block_type='moves')).status_code,409)
        for name in ['exercises.json','figures.json','catalog.json','missing.json']:
            self.assertEqual(self.client.patch(base+'/content/'+name,json=self.correction('Không được sửa')).status_code,404)
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=self.correction('x',page=2)).status_code,404)
        self.assertEqual(self.client.patch(base+'/content/chapter-01.json',json=self.correction('x',block_index=99)).status_code,404)
        self.assertEqual(self.client.get(base+'/content/chapter-01.json').json()['pages'][0]['blocks'][0]['text'],'Bản sửa mới')

    def test_simultaneous_edits_to_different_blocks_are_both_saved(self):
        from concurrent.futures import ThreadPoolExecutor
        path='/api/books/'+self.upload().json()['id']+'/content/chapter-01.json'
        edits=[self.correction('Đoạn đã sửa'),self.correction('Chú thích đã sửa',previous='Thế cờ thứ nhất',block_index=1,block_type='figure')]
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda body:self.client.patch(path,json=body),edits))
        self.assertEqual([r.status_code for r in responses],[200,200])
        blocks=self.client.get(path).json()['pages'][0]['blocks']
        self.assertEqual([b['text'] for b in blocks],['Đoạn đã sửa','Chú thích đã sửa'])

    def test_correction_validation_and_book_isolation(self):
        first=self.upload().json()['id'];second=self.upload(self.package({'manifest.json':{**self.manifest,'id':'other','source_url':'https://other.example.org/'}})).json()['id']
        path='/api/books/'+first+'/content/chapter-01.json'
        for data in [self.correction(''),self.correction('x'*100001),self.correction('x',page=True),self.correction('x',block_index='0'),self.correction('x',script='bad')]:
            self.assertEqual(self.client.patch(path,json=data).status_code,422)
        self.assertEqual(self.client.patch(path,content=b'x'*2000001).status_code,413)
        self.assertEqual(self.client.patch('/api/books/missing/content/chapter-01.json',json=self.correction('x')).status_code,404)
        self.assertEqual(self.client.patch(path,json=self.correction('Sửa riêng sách này')).status_code,200)
        self.assertEqual(self.client.get('/api/books/'+second+'/content/chapter-01.json').json(),self.files['content/chapter-01.json'])

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

class ExerciseBookTests(OfflineBooksTests):
    def exercise_package(self, changes=None):
        import chess
        item={'id':'1','number':1,'title':'Bài 1','group':'Khai cuộc','prompt':'Tìm nước đi.',
              'kind':'line','status':'verified','fen':chess.STARTING_FEN,'page':1,'answer_page':1,
              'answer':'1. e4 e5 2. Nf3','tree':[{'move':'e2e4','next':[{'move':'e7e5','next':[{'move':'g1f3','next':[]}]}]}]}
        return self.package({'manifest.json':{**self.manifest,'exercise_file':'exercises.json','edition':'Bài tập tương tác'},
                             'content/exercises.json':[item],**(changes or {})})

    def test_exercise_import_persists_valid_lines_and_metadata(self):
        response=self.upload(self.exercise_package());self.assertEqual(response.status_code,200,response.text)
        book_id=response.json()['id'];db.init()
        meta=self.client.get('/api/books/'+book_id+'/offline').json()
        self.assertEqual(meta['exercises'],1);self.assertEqual(meta['edition'],'Bài tập tương tác')
        self.assertEqual(self.client.get('/api/books/'+book_id+'/content/exercises.json').json()[0]['tree'][0]['move'],'e2e4')
        self.assertEqual(self.client.get('/api/books/'+book_id+'/asset/book.pdf').content,b'%PDF-1.7\nfixture')

    def test_bad_exercise_lines_cannot_replace_good_import(self):
        self.upload(self.exercise_package())
        good=self.client.get('/api/books/winning-chess-strategies/content/exercises.json').json()
        from copy import deepcopy
        cases=[]
        bad=deepcopy(good);bad[0]['tree'][0]['move']='e2e5';cases.append(bad)
        bad=deepcopy(good);bad[0]['tree'][0]['next'][0]['move']='e2e4';cases.append(bad)
        bad=deepcopy(good);bad[0]['tree'].append(deepcopy(bad[0]['tree'][0]));cases.append(bad)
        bad=deepcopy(good);bad[0]['page']=100;cases.append(bad)
        bad=deepcopy(good);bad[0]['fen']='not FEN';cases.append(bad)
        bad=deepcopy(good);bad[0]['tree']=[];cases.append(bad)
        bad=deepcopy(good);bad[0]['tree'][0]['script']='alert(1)';cases.append(bad)
        for case in cases:
            r=self.upload(self.exercise_package({'content/exercises.json':case}));self.assertEqual(r.status_code,400,r.text)
        self.assertEqual(self.client.get('/api/books/winning-chess-strategies/content/exercises.json').json(),good)
