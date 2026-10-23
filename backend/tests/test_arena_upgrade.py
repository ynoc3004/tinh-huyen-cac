"""Upgrade the actual /arena.html entry point without replacing an existing DB."""
import copy
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
from main import app
from fastapi.testclient import TestClient
from services import pairing


class ArenaUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "legacy.db"
        self.patcher = patch.object(db, "DB_PATH", self.path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        # Exactly the pre-upgrade table shape, 96 existing students and real history.
        with sqlite3.connect(self.path) as c:
            c.executescript(db.SCHEMA)
            c.executemany("INSERT INTO students(id,name,rating,club,note) VALUES(?,?,?,?,?)",
                          [(i, f"Kỳ thủ cũ {i}", 1000+i, f"CLB {i%3}", "Giữ ghi chú") for i in range(1, 97)])
            c.execute("INSERT INTO tournaments(id,name,date,seed,split_mode,status) VALUES(7,'Giải đang lưu','23/10/2026',42,'manual','running')")
            c.execute("INSERT INTO stages VALUES(11,7,1,'Vòng bảng','round_robin')")
            c.execute("INSERT INTO groups VALUES(21,11,'U6')")
            c.executemany("INSERT INTO tournament_players VALUES(7,?,21)", [(i,) for i in (1,2,3)])
            c.executemany("INSERT INTO pairings(id,group_id,round,board,white_id,black_id,result,white_technical_errors) VALUES(?,21,?,?,?,?,?,?)", [
                (31,1,1,1,2,'1-0',2),(32,1,2,3,None,'bye',0),
                (33,2,1,1,3,'1/2',0),(34,2,2,2,None,'bye',0),
                (35,3,1,2,3,'0-1',0),(36,3,2,1,None,'bye',0)])
        self.before = self.legacy_rows()
        db.init()
        self.client = TestClient(app)

    def legacy_rows(self):
        with sqlite3.connect(self.path) as c:
            return {"students": c.execute("SELECT id,name,rating,club,note FROM students ORDER BY id").fetchall(),
                    "pairings": c.execute("SELECT id,group_id,round,board,white_id,black_id,result,white_technical_errors FROM pairings ORDER BY id").fetchall()}

    def test_additive_migration_keeps_96_students_and_all_old_results(self):
        self.assertEqual(self.legacy_rows(), self.before)
        db.init()
        self.assertEqual(self.legacy_rows(), self.before)
        self.assertEqual(len(self.client.get('/api/students').json()), 96)
        tour = self.client.get('/api/tournaments/7').json()
        self.assertEqual(tour['groups'][0]['players'][0]['club'], 'CLB 1')
        self.assertEqual(tour['groups'][0]['pairing_method'], 'app')
        self.assertIsNone(tour['groups'][0]['draw_order'])
        page = self.client.get('/arena.html')
        self.assertEqual(page.status_code, 200)
        self.assertIn('arena-integrated-1', page.text)
        self.assertIn('id="oneName"', page.text)
        self.assertIn('id="tourVenue"', page.text)
        self.assertNotIn('name="thc-main-site"', page.text)

    def test_metadata_updates_existing_tournament_without_moving_history(self):
        data = {'venue':'Nhà thi đấu','organizer':'CLB','chief_arbiter':'Trọng tài A','time_control':'15+10','notes':'Thể lệ thử'}
        self.assertEqual(self.client.patch('/api/tournaments/7', json=data).status_code, 200)
        tour = self.client.get('/api/tournaments/7').json()
        for key, value in data.items():
            self.assertEqual(tour[key], value)
        self.assertEqual(self.legacy_rows(), self.before)
        created = self.client.post('/api/tournaments/from-draw', json={'name':'Giải mới','groups':[[]],'group_names':['U7'],**data})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(self.client.get('/api/tournaments/'+str(created.json()['tournament_id'])).json()['venue'], data['venue'])

    def test_stale_results_and_metrics_are_rejected(self):
        r = self.client.put('/api/pairings/31', json={'result':'0-1','expected_result':None})
        self.assertEqual(r.status_code, 409)
        r = self.client.put('/api/pairings/31', json={'result':'1-0','expected_signature':'1-0|0|0|0|0','white_technical_errors':3})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.legacy_rows(), self.before)
        r = self.client.put('/api/pairings/31', json={'result':'1-0','expected_signature':'1-0|2|0|0|0','white_technical_errors':3})
        self.assertEqual(r.status_code, 200, r.text)

    def test_backup_round_trip_preserves_old_results_with_new_ids(self):
        export = self.client.get('/api/tournaments/7/export')
        self.assertEqual(export.status_code, 200)
        self.assertIn('attachment', export.headers['content-disposition'])
        backup = export.json()
        restored = self.client.post('/api/tournaments/import', json=backup)
        self.assertEqual(restored.status_code, 200, restored.text)
        tid = restored.json()['tournament_id']
        self.assertNotEqual(tid, 7)
        new = self.client.get(f'/api/tournaments/{tid}/export').json()
        self.assertEqual([p['result'] for p in new['tournament']['groups'][0]['pairings']], [p['result'] for p in backup['tournament']['groups'][0]['pairings']])
        self.assertTrue(self.client.get(f'/api/tournaments/{tid}/validate').json()['valid'])
        self.assertEqual(len(self.client.get('/api/students').json()), 99)
        self.assertEqual(self.client.get('/api/tournaments/7/export').json()['tournament'], backup['tournament'])

    def test_corrupt_backup_rolls_back_every_new_record(self):
        backup = self.client.get('/api/tournaments/7/export').json()
        for corrupt in ('gap','duplicate','outside','self','draw'):
            payload = copy.deepcopy(backup)
            g = payload['tournament']['groups'][0]
            if corrupt == 'gap':
                for p in g['pairings']: p['round'] += 1
            elif corrupt == 'duplicate': g['pairings'][1]['board'] = g['pairings'][0]['board']
            elif corrupt == 'outside': g['pairings'][0]['white_id'] = 9999
            elif corrupt == 'self': g['pairings'][0]['black_id'] = g['pairings'][0]['white_id']
            else: g['draw_order'] = [1,1,3]
            r = self.client.post('/api/tournaments/import', json=payload)
            self.assertEqual(r.status_code, 400, (corrupt,r.text))
            self.assertEqual(self.legacy_rows(), self.before)
            self.assertEqual(len(self.client.get('/api/tournaments').json()), 1)

    def test_arbiter_swiss_import_stays_separate_and_checks_repeats(self):
        t = self.client.post('/api/tournaments/from-draw', json={'name':'Swiss','groups':[[4,5,6,7,8]],'group_names':['U7'],'format':'swiss'}).json()['tournament_id']
        g = self.client.get(f'/api/tournaments/{t}').json()['groups'][0]['id']
        self.assertEqual(self.client.patch(f'/api/groups/{g}', json={'pairing_method':'arbiter','swiss_rounds':3}).status_code,200)
        self.assertEqual(self.client.post(f'/api/groups/{g}/pair').status_code,409)
        body={'source':'Trọng tài chính','pairs':[{'white_id':4,'black_id':5},{'white_id':6,'black_id':7},{'white_id':8,'black_id':None}]}
        r=self.client.post(f'/api/groups/{g}/import-pairings',json=body)
        self.assertEqual(r.status_code,200,r.text)
        rows=self.client.get(f'/api/groups/{g}/pairings').json()
        for p in rows:
            if p['black_id'] is not None:
                self.assertEqual(self.client.put(f"/api/pairings/{p['id']}",json={'result':'1/2'}).status_code,200)
        self.assertEqual(self.client.post(f'/api/groups/{g}/swiss-next').status_code,409)
        self.assertEqual(self.client.post(f'/api/groups/{g}/import-pairings',json=body).status_code,409)
        self.assertEqual(len(self.client.get(f'/api/groups/{g}/pairings').json()),3)
        self.assertTrue(self.client.get(f'/api/tournaments/{t}/validate').json()['valid'])

    def test_berger_matches_published_table_for_six_numbers(self):
        self.assertEqual(pairing.round_robin(range(1,7)), [
            [(1,6),(2,5),(3,4)],[(6,4),(5,3),(1,2)],[(2,6),(3,1),(4,5)],
            [(6,5),(1,4),(2,3)],[(3,6),(4,2),(5,1)]])


if __name__ == '__main__':
    unittest.main()
