"""Worksheet generation, persistence and exact twelve-diagram PDF pagination."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
from main import app
from fastapi.testclient import TestClient
from services import worksheets as service
from services.worksheet_pdf import render_pdf
import chess
import fitz


class WorksheetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_patch = patch.object(db, 'DB_PATH', Path(self.tmp.name) / 'app.db')
        self.db_patch.start(); self.addCleanup(self.db_patch.stop)
        self.bank_patch = patch.object(service.config, 'PUZZLE_DB', Path(self.tmp.name) / 'missing.db')
        self.bank_patch.start(); self.addCleanup(self.bank_patch.stop)
        db.init()
        self.client = TestClient(app)

    def select(self, count=12, **kwargs):
        return self.client.post('/api/worksheets/select',json={'count':count,**kwargs})

    def document(self, count=12):
        return {'title':'BÀI KIỂM TRA - CỜ VUA CĂN BẢN', 'kind':'test','level':'Bước 2 - Lớp thiếu nhi',
                'duration':30,'exercises':self.select(count).json()['exercises']}

    def test_starter_bank_supports_twelve_in_every_difficulty(self):
        options=self.client.get('/api/worksheets/options').json()
        self.assertEqual(options['bank']['count'],192)
        for level in options['levels']:
            response=self.select(min_rating=level['min'],max_rating=level['max'])
            self.assertEqual(response.status_code,200,response.text)
            exercises=response.json()['exercises']
            self.assertEqual(len(exercises),12)
            self.assertEqual(len({e['id'] for e in exercises}),12)
            self.assertEqual(len({' '.join(e['fen'].split()[:4]) for e in exercises}),12)
            self.assertTrue(all(level['min']<=e['rating']<=level['max'] for e in exercises))

    def test_lichess_setup_move_applied_once_and_solution_is_legal(self):
        source={r['id']:r for r in service.starter_bank()}
        for exercise in self.select().json()['exercises']:
            original=source[exercise['id']]
            board=chess.Board(original['fen']);board.push_uci(original['moves'][0])
            self.assertEqual(exercise['fen'],board.fen())
            self.assertEqual(exercise['turn'],'w' if board.turn else 'b')
            san=[]
            for uci in original['moves'][1:]:
                move=board.parse_uci(uci);san.append(board.san(move));board.push(move)
            self.assertEqual(exercise['solution'],' '.join(san))

    def test_exclude_and_exact_theme_without_hidden_fallback(self):
        first=self.select().json()['exercises']
        second=self.select(exclude=[e['id'] for e in first]).json()['exercises']
        self.assertFalse({e['id'] for e in first}&{e['id'] for e in second})
        self.assertEqual(self.select(min_rating=3800,max_rating=3900).status_code,409)
        response=self.select(count=1,min_rating=0,max_rating=4000,theme='mateIn1')
        self.assertEqual(response.status_code,200)
        self.assertIn('mateIn1',response.json()['exercises'][0]['themes'])
        self.assertEqual(self.select(min_rating=2000,max_rating=1000).status_code,422)
        self.assertEqual(self.select(theme='unknown').status_code,422)

    def test_manual_san_uci_move_numbers_and_illegal_answers(self):
        initial=chess.STARTING_FEN
        for solution in ('e2e4 e7e5 g1f3','1. e4 e5 2. Nf3'):
            r=self.client.post('/api/worksheets/validate',json={'fen':initial,'solution':solution,'instruction':'Tìm phương án.'})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['exercise']['solution'],'e4 e5 Nf3')
            self.assertIn('<svg',r.json()['svg'])
        self.assertEqual(self.client.post('/api/worksheets/validate',json={'fen':initial,'solution':'e2e5'}).status_code,400)
        self.assertEqual(self.client.post('/api/worksheets/validate',json={'fen':'8/8/8/8/8/8/8/8 w - - 0 1'}).status_code,400)
        self.assertEqual(self.client.post('/api/worksheets/validate',json={'fen':'invalid'}).status_code,400)

    def test_promotion_and_black_to_move(self):
        r=self.client.post('/api/worksheets/validate',json={'fen':'k7/6P1/8/8/8/8/8/7K w - - 0 1','solution':'g7g8q'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['exercise']['solution'],'g8=Q+')
        r=self.client.post('/api/worksheets/validate',json={'fen':'k7/8/8/8/8/8/6p1/K7 b - - 0 1','solution':'g2g1q'})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['exercise']['turn'],'b')

    def test_save_reopen_restart_and_partial_drafts(self):
        id=str(uuid.uuid4());doc=self.document()
        doc['filters']={'min_rating':1800,'max_rating':2600,'theme':'mateIn2'}
        response=self.client.put('/api/worksheets/'+id,json=doc)
        self.assertEqual(response.status_code,200)
        snapshot=response.json()['document']
        db.init()
        self.assertEqual(TestClient(app).get('/api/worksheets/'+id).json()['document'],snapshot)
        self.assertEqual(snapshot['filters'],doc['filters'])
        self.assertEqual(self.client.get('/api/worksheets').json()[0]['count'],12)
        doc['title']='Đề mới - sửa tiêu đề';doc['exercises']=doc['exercises'][:1]
        self.assertEqual(self.client.put('/api/worksheets/'+id,json=doc).status_code,200)
        self.assertEqual(len(self.client.get('/api/worksheets').json()),1)
        self.assertEqual(self.client.get('/api/worksheets/'+id).json()['document']['title'],doc['title'])
        self.assertEqual(self.client.post('/api/worksheets/pdf',json=doc).status_code,400)
        doc['exercises']=[]
        self.assertEqual(self.client.put('/api/worksheets/'+id,json=doc).status_code,200)

    def test_bad_update_leaves_saved_document_intact(self):
        id=str(uuid.uuid4());doc=self.document();self.client.put('/api/worksheets/'+id,json=doc)
        before=self.client.get('/api/worksheets/'+id).json()
        doc['exercises'][0]['solution']='a1a8'
        self.assertEqual(self.client.put('/api/worksheets/'+id,json=doc).status_code,400)
        self.assertEqual(self.client.get('/api/worksheets/'+id).json(),before)
        self.assertEqual(self.client.put('/api/worksheets/not-a-uuid',json=self.document()).status_code,400)

    def test_student_pdf_has_twelve_per_page_fields_and_no_solutions(self):
        doc=self.document(24)
        response=self.client.post('/api/worksheets/pdf',json=doc)
        self.assertEqual(response.status_code,200,response.text[:100] if response.status_code!=200 else '')
        self.assertEqual(response.headers['content-type'],'application/pdf')
        self.assertIn('attachment',response.headers['content-disposition'])
        pdf=fitz.open(stream=response.content,filetype='pdf')
        self.assertEqual(len(pdf),2)
        for index,page in enumerate(pdf):
            text=page.get_text()
            self.assertIn(doc['title'],text)
            self.assertIn('Họ tên:',text);self.assertIn('Level:',text)
            self.assertIn(doc['level'],text)
            self.assertEqual(text.count('Trắng đi')+text.count('Đen đi'),12)
            self.assertIn(f'Trang {index+1} / 2',text)
            self.assertAlmostEqual(page.rect.width,595.276,places=2)
            self.assertTrue(all(e['solution'] not in text for e in doc['exercises'] if len(e['solution'])>5))
        self.assertFalse(any(page.get_images() for page in pdf),'Diagrams should stay vector for sharp printing')

    def test_answers_are_separate_and_missing_solution_blocks_teacher_export_only(self):
        doc=self.document();response=self.client.post('/api/worksheets/pdf?answers=true',json=doc)
        self.assertEqual(response.status_code,200)
        text=''.join(page.get_text() for page in fitz.open(stream=response.content,filetype='pdf'))
        self.assertIn('ĐÁP ÁN GIÁO VIÊN',text)
        self.assertIn(doc['exercises'][0]['solution'],text)
        doc['exercises'][0]['solution']=''
        self.assertEqual(self.client.post('/api/worksheets/pdf?answers=true',json=doc).status_code,400)
        self.assertEqual(self.client.post('/api/worksheets/pdf',json=doc).status_code,200)

    def test_long_vietnamese_title_stays_in_page_bounds(self):
        doc=self.document();doc['title']='BÀI KIỂM TRA CỜ VUA - KỸ NĂNG TÍNH TOÁN VÀ PHỐI HỢP QUÂN DÀNH CHO HỌC SINH LỚP CƠ BẢN NÂNG CAO'
        doc['instructions']='Học sinh ghi rõ nước đi, phương án đáp trả của đối phương và giải thích ngắn gọn lý do chọn phương án.'
        response=self.client.post('/api/worksheets/pdf',json=doc)
        self.assertEqual(response.status_code,200)
        page=fitz.open(stream=response.content,filetype='pdf')[0]
        for word in page.get_text('words'):
            x0,y0,x1,y1,*_=word
            self.assertGreaterEqual(x0,0);self.assertGreaterEqual(y0,0)
            self.assertLessEqual(x1,page.rect.width);self.assertLessEqual(y1,page.rect.height)

    def test_local_imported_bank_preferred(self):
        import sqlite3
        path=Path(service.config.PUZZLE_DB)
        with sqlite3.connect(path) as bank:
            bank.execute('CREATE TABLE puzzles(id TEXT,fen TEXT,moves TEXT,rating INT,themes TEXT)')
            sample=service.starter_bank()[0]
            bank.execute('INSERT INTO puzzles VALUES(?,?,?,?,?)',('local-test',sample['fen'],' '.join(sample['moves']),sample['rating'],' mateIn1 '))
        self.assertEqual(self.client.get('/api/worksheets/options').json()['bank']['source'],'local')
        result=self.select(count=1).json()['exercises'][0]
        self.assertEqual(result['id'],'local-test')
        self.assertEqual(self.select(count=12).status_code,409,'Must report shortage rather than silently change bank/level')

    def test_pdf_does_not_write_or_mutate_saved_documents(self):
        before=self.client.get('/api/worksheets').json()
        self.assertEqual(self.client.post('/api/worksheets/pdf',json=self.document()).status_code,200)
        self.assertEqual(self.client.get('/api/worksheets').json(),before)


if __name__=='__main__':
    unittest.main()
