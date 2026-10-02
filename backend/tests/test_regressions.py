"""Regression tests. Real data/app.db is never opened."""
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
TEMP = tempfile.TemporaryDirectory()
db.DB_PATH = Path(TEMP.name) / 'test.db'
from main import app
import main
from fastapi.testclient import TestClient
from routers import arena, library
from services import pairing, sync


class RegressionTests(unittest.TestCase):
    def setUp(self):
        with db.conn() as c:
            for t in ('library_item_tags','library_tags','library_items','arena_players','tournament_players','stage_players','pairings','groups','stages','tournaments','students','games','rating_history'):
                c.execute(f'DELETE FROM {t}')
        self.client = TestClient(app)
        self.ids = self.client.post('/api/students',json=[{'name':f'Player {i}'} for i in range(1,9)]).json()['student_ids']

    def new_arena(self, ids=None):
        return self.client.post('/api/arenas',json={'name':'Test','duration_min':5,'student_ids':self.ids[:6] if ids is None else ids}).json()

    def tour(self, ids=None, fmt='round_robin'):
        return self.client.post('/api/tournaments',json={'name':'Test','group_count':1,'format':fmt,'student_ids':ids or self.ids[:6]}).json()

    def test_independent_group_formats(self):
        r = self.client.post('/api/tournaments/from-draw', json={'name':'Mixed','groups':[self.ids[:4],self.ids[4:]],'group_names':['U6','U7'],'group_formats':['round_robin','swiss']})
        self.assertEqual(r.status_code,200)
        tid = r.json()['tournament_id']
        groups = self.client.get(f'/api/tournaments/{tid}').json()['groups']
        a,b = groups
        self.assertEqual([g['format'] for g in groups],['round_robin','swiss'])
        self.assertEqual(self.client.patch(f'/api/groups/{b["id"]}',json={'name':'U8'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/groups/{a["id"]}',json={'format':'swiss'}).status_code,200)
        self.assertEqual(self.client.patch(f'/api/groups/{a["id"]}',json={'format':'round_robin'}).status_code,200)
        self.client.post(f'/api/groups/{a["id"]}/pair')
        rows = self.client.get(f'/api/groups/{a["id"]}/pairings').json()
        self.assertEqual(len(rows),6)
        self.assertEqual(self.client.patch(f'/api/groups/{a["id"]}',json={'format':'swiss'}).status_code,409)
        self.assertEqual(self.client.get(f'/api/groups/{a["id"]}/pairings').json(),rows)
        self.client.post(f'/api/groups/{b["id"]}/pair')
        self.assertEqual(len(self.client.get(f'/api/groups/{b["id"]}/pairings').json()),2)
        after = self.client.get(f'/api/tournaments/{tid}').json()['groups']
        self.assertEqual([(g['name'],g['format'],len(g['players'])) for g in after],[('U6','round_robin',4),('U8','swiss',4)])
        self.assertEqual(self.client.patch(f'/api/groups/{b["id"]}',json={'format':'bad'}).status_code,400)
        self.assertEqual(self.client.post('/api/tournaments/from-draw',json={'name':'Bad','groups':[[]],'group_names':['U6'],'group_formats':[]}).status_code,400)

    def test_berger_1_to_60(self):
        self.assertEqual(pairing.round_robin([]), [])
        for n in range(1,61):
            colors={i:[] for i in range(n)}; seen=set(); byes={i:0 for i in range(n)}
            for rnd in pairing.round_robin(range(n)):
                present=set()
                for w,b in rnd:
                    self.assertIsNotNone(w)
                    self.assertNotIn(w,present);present.add(w)
                    if b is None:
                        byes[w]+=1
                        continue
                    self.assertNotIn(b,present);present.add(b)
                    pair=frozenset((w,b));self.assertNotIn(pair,seen);seen.add(pair)
                    colors[w].append('w');colors[b].append('b')
                self.assertEqual(len(present),n)
            self.assertEqual(len(seen),n*(n-1)//2)
            for i, cs in colors.items():
                self.assertLessEqual(abs(cs.count('w')-cs.count('b')),1)
                self.assertNotIn('www',''.join(cs));self.assertNotIn('bbb',''.join(cs))
                self.assertEqual(byes[i],n%2)

    def test_pair_protects_results_and_force(self):
        g=self.tour()['groups'][0]['group_id']
        self.assertEqual(self.client.post(f'/api/groups/{g}/pair').status_code,200)
        p=self.client.get(f'/api/groups/{g}/pairings').json()[0]
        self.client.put(f'/api/pairings/{p["id"]}',json={'result':'1-0'})
        self.assertEqual(self.client.post(f'/api/groups/{g}/pair').status_code,409)
        self.assertEqual(self.client.get(f'/api/groups/{g}/pairings').json()[0]['result'],'1-0')
        self.assertEqual(self.client.post(f'/api/groups/{g}/pair?force=true').status_code,200)

    def test_bye_cannot_be_overwritten(self):
        g=self.tour(self.ids[:3])['groups'][0]['group_id'];self.client.post(f'/api/groups/{g}/pair')
        p=next(p for p in self.client.get(f'/api/groups/{g}/pairings').json() if p['black_id'] is None)
        self.assertEqual(self.client.put(f'/api/pairings/{p["id"]}',json={'result':'0-1'}).status_code,400)
        self.assertEqual(next(x for x in self.client.get(f'/api/groups/{g}/pairings').json() if x['id']==p['id'])['result'],'bye')

    def test_swiss_stops_at_recommended_rounds(self):
        g=self.tour(fmt='swiss')['groups'][0]['group_id'];self.client.post(f'/api/groups/{g}/pair')
        for r in range(1,4):
            for p in self.client.get(f'/api/groups/{g}/pairings').json():
                if p['black_id'] is not None and not p['result']:self.client.put(f'/api/pairings/{p["id"]}',json={'result':'1/2'})
            resp=self.client.post(f'/api/groups/{g}/swiss-next')
            self.assertEqual(resp.status_code,200 if r<3 else 409)

    def test_arena_start_and_concurrent_pair(self):
        a=self.new_arena(self.ids[:5]);tid=a['tournament_id']
        self.assertEqual(self.client.post(f'/api/arenas/{tid}/pair').status_code,409)
        self.client.post(f'/api/arenas/{tid}/start')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _: self.client.post(f'/api/arenas/{tid}/pair'),range(2)))
        self.assertTrue(all(r.status_code==200 for r in results))
        games=self.client.get(f'/api/arenas/{tid}').json()['live']
        ids=[sid for p in games for sid in (p['white_id'],p['black_id'])]
        self.assertEqual(len(ids),len(set(ids)));self.assertEqual(len(games),2)
        self.assertEqual(sorted(p['board'] for p in games),[1,2])

    def test_legacy_waiting_players_not_paired_twice(self):
        a=self.new_arena();tid=a['tournament_id'];self.client.post(f'/api/arenas/{tid}/start');self.client.post(f'/api/arenas/{tid}/pair')
        with db.conn() as c:c.execute("UPDATE arena_players SET status='waiting' WHERE tournament_id=?",(tid,))
        r=self.client.post(f'/api/arenas/{tid}/pair').json();self.assertEqual(r['paired'],0)
        self.assertEqual(len(self.client.get(f'/api/arenas/{tid}').json()['live']),3)

    def test_start_preserves_legacy_open_games(self):
        a=self.new_arena();tid=a['tournament_id']
        with db.conn() as c:c.execute('INSERT INTO pairings(group_id,round,board,white_id,black_id) VALUES(?,1,1,?,?)',(a['group_id'],*self.ids[:2]))
        self.client.post(f'/api/arenas/{tid}/start')
        players=self.client.get(f'/api/arenas/{tid}').json()['players']
        self.assertEqual(sum(p['status']=='playing' for p in players),2)
        self.assertEqual(self.client.post(f'/api/arenas/{tid}/pair').json()['paired'],2)

    def test_expired_status_returned_immediately(self):
        tid=self.new_arena()['tournament_id'];self.client.post(f'/api/arenas/{tid}/start')
        with db.conn() as c:c.execute('UPDATE tournaments SET ends_at=? WHERE id=?',((datetime.now(timezone.utc)-timedelta(seconds=2)).isoformat(),tid))
        a=self.client.get(f'/api/arenas/{tid}').json()
        self.assertEqual(a['status'],'finished');self.assertEqual(a['remain_sec'],0)
        self.assertEqual(self.client.post(f'/api/arenas/{tid}/pair').status_code,400)

    def test_removed_player_keeps_name(self):
        tid=self.new_arena()['tournament_id'];self.client.post(f'/api/arenas/{tid}/start');self.client.post(f'/api/arenas/{tid}/pair')
        p=self.client.get(f'/api/arenas/{tid}').json()['live'][0]
        self.client.put(f'/api/arenas/pairings/{p["id"]}',json={'result':'1-0'})
        self.client.delete(f'/api/arenas/{tid}/players/{p["white_id"]}')
        self.assertIn(str(p['white_id']),self.client.get(f'/api/arenas/{tid}').json()['names'])

    def test_bad_inputs_and_duplicate_ids(self):
        for payload in ({'group_count':-1},{'group_size':-1}):
            self.assertEqual(self.client.post('/api/tournaments',json={'name':'bad',**payload}).status_code,422)
            self.assertEqual(self.client.post('/api/draw',json=payload).status_code,422)
        a=self.new_arena([self.ids[0],self.ids[0]])
        self.assertEqual(len(self.client.get(f'/api/arenas/{a["tournament_id"]}').json()['players']),1)
        self.assertEqual(self.client.post('/api/arenas',json={'name':'bad','student_ids':[99999]}).status_code,400)
        self.assertEqual(self.client.post(f'/api/arenas/{a["tournament_id"]}/players',json={'student_ids':[99999]}).status_code,400)
        t=self.tour();tid=t['tournament_id']
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/move',json={'student_id':self.ids[0],'group_id':99999}).status_code,400)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/finals',json={'per_group':-1}).status_code,422)

    def test_duplicate_names_can_be_distinct(self):
        r=self.client.post('/api/students',json=[{'name':'Player 1'}]).json();self.assertEqual(r['skipped'],1);self.assertTrue(r['duplicates'])
        r=self.client.post('/api/students?allow_duplicates=true',json=[{'name':'Player 1'}]).json();self.assertEqual(r['added'],1);self.assertNotEqual(r['student_ids'][0],self.ids[0])

    def test_library_vault_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(library,'LIBRARY_DIR',Path(directory)):
            library.reset_state();root=Path(directory);c=self.client
            st=c.get('/api/library/vault/status').json();self.assertFalse(st['initialized']);self.assertFalse(st['unlocked'])
            self.assertEqual(c.get('/api/library').status_code,401)
            self.assertEqual(c.post('/api/library/vault/setup',json={'password':'short'}).status_code,400)
            self.assertEqual(c.post('/api/library/vault/setup',json={'password':'mat-khau-1'}).status_code,200)
            self.assertEqual(c.post('/api/library/import?name=Khai%20cuoc.txt',content=b'secret-sample').json()['result'],'added')
            self.assertEqual(c.post('/api/library/import?name=copy.txt',content=b'secret-sample').json()['result'],'duplicate')
            self.assertEqual(c.post('/api/library/import?name=bad.exe',content=b'x').status_code,400)
            items=c.get('/api/library').json();self.assertEqual(len(items),1);self.assertNotIn('path',items[0]);self.assertNotIn('blob',items[0])
            self.assertEqual(c.get('/api/library?q=KHAI').json()[0]['id'],items[0]['id'])
            self.assertEqual(c.get(f'/api/library/file/{items[0]["id"]}').content,b'secret-sample')
            for f in root.rglob('*'):
                if f.is_file():self.assertNotIn(b'secret-sample',f.read_bytes())
            (root/'plain.txt').write_text('plain-data')
            r=c.post('/api/library/scan',json={'delete_original':True}).json()
            self.assertEqual((r['added'],r['deleted']),(1,1));self.assertFalse((root/'plain.txt').exists())
            self.assertEqual(len(c.get('/api/library').json()),2)
            c.post('/api/library/vault/lock')
            self.assertEqual(c.get(f'/api/library/file/{items[0]["id"]}').status_code,401)
            self.assertEqual(c.post('/api/library/vault/unlock',json={'password':'sai-mat-khau'}).status_code,401)
            self.assertEqual(c.post('/api/library/vault/unlock',json={'password':'mat-khau-1'}).status_code,200)
            self.assertEqual(c.post('/api/library/vault/password',json={'old':'sai','new':'mat-khau-2'}).status_code,401)
            self.assertEqual(c.post('/api/library/vault/password',json={'old':'mat-khau-1','new':'mat-khau-2'}).status_code,200)
            c.post('/api/library/vault/lock')
            self.assertEqual(c.post('/api/library/vault/unlock',json={'password':'mat-khau-1'}).status_code,401)
            self.assertEqual(c.post('/api/library/vault/unlock',json={'password':'mat-khau-2'}).status_code,200)
            self.assertEqual(c.delete(f'/api/library/{items[0]["id"]}').status_code,200)
            self.assertEqual(c.get('/api/library/vault/status',headers={'host':'evil.example'}).status_code,403)
            library.reset_state()

    def test_platform_failure_isolated(self):
        async def chess(c, cl):
            c.execute("INSERT INTO games(platform,ext_id) VALUES('chesscom','test')");return 1
        async def lichess(c, cl):
            c.execute("INSERT INTO games(platform,ext_id) VALUES('lichess','rollback')");raise KeyError('players')
        with patch.dict('os.environ',{},clear=True), patch.object(sync,'sync_chesscom',chess),patch.object(sync,'sync_lichess',lichess):
            r=asyncio.run(sync.sync_all())
        self.assertEqual(r['chesscom'],1);self.assertIn('lichess',r['errors'])
        with db.conn() as c:self.assertEqual([r['platform'] for r in c.execute('SELECT platform FROM games')],['chesscom'])

    def test_lichess_aborted_and_http_error(self):
        import httpx
        game={'id':'done','status':'draw','players':{'white':{'user':{'name':'me'}},'black':{'user':{'name':'other'}}},'createdAt':1000,'speed':'rapid'}
        def handler(request):
            if '/api/user/' in str(request.url):return httpx.Response(200,json={'perfs':{}})
            return httpx.Response(200,text=json.dumps({'status':'aborted'})+'\n'+json.dumps(game)+'\n')
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as cl:
                with db.conn() as c:return await sync.sync_lichess(c,cl)
        with patch.object(sync,'LICHESS_USER','me'):self.assertEqual(asyncio.run(run()),1)
        async def failing():
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(429,json={'error':'rate limit'}))) as cl:
                with db.conn() as c:await sync.sync_lichess(c,cl)
        with patch.object(sync,'LICHESS_USER','me'),self.assertRaises(httpx.HTTPStatusError):asyncio.run(failing())

    def test_rating_kept_when_games_fail(self):
        import httpx
        def handler(request):
            if '/api/user/' in str(request.url):return httpx.Response(200,json={'perfs':{'bullet':{'games':5,'rating':777}}})
            return httpx.Response(429,json={'error':'rate limit'})
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as cl:
                try:
                    with db.conn() as c:await sync.sync_lichess(c,cl)
                except httpx.HTTPStatusError:pass
        with patch.object(sync,'LICHESS_USER','me'):asyncio.run(run())
        with db.conn() as c:
            row=c.execute("SELECT rating FROM rating_history WHERE platform='lichess' AND time_class='bullet'").fetchone()
        self.assertEqual(row['rating'],777)

    def test_delete_and_missing_admin_password(self):
        tid=self.new_arena()['tournament_id']
        with patch.object(arena,'ADMIN_PASSWORD',''):
            self.assertEqual(self.client.post(f'/api/arenas/{tid}/delete',json={'password':''}).status_code,503)
        with patch.object(arena,'ADMIN_PASSWORD','test-only'):
            self.assertEqual(self.client.post(f'/api/arenas/{tid}/delete',json={'password':'wrong'}).status_code,403)
            self.assertEqual(self.client.post(f'/api/arenas/{tid}/delete',json={'password':'test-only'}).status_code,200)
        with db.conn() as c:self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_optional_authentication(self):
        with patch.object(main,'ACCESS_PASSWORD','test-only'):
            self.assertEqual(self.client.get('/api/students').status_code,401)
            self.assertEqual(self.client.get('/').status_code,401)
            token=base64.b64encode(b'admin:test-only').decode()
            self.assertEqual(self.client.get('/api/students',headers={'Authorization':'Basic '+token}).status_code,200)

    def test_custom_groups_empty_and_arbitrary_rosters(self):
        r=self.client.post('/api/tournaments/from-draw',json={'name':'Giải U','mode':'manual','groups':[[],[]],'group_names':['U6','U7'],'notes':'10 phút + 5 giây. Xếp hạng theo điểm và SB.'})
        self.assertEqual(r.status_code,200)
        tid=r.json()['tournament_id'];t=self.client.get(f'/api/tournaments/{tid}').json()
        self.assertEqual([g['name'] for g in t['groups']],['U6','U7'])
        self.assertEqual(sum(len(g['players']) for g in t['groups']),0)
        self.assertIn('10 phút',t['notes'])
        g1,g2=[g['id'] for g in t['groups']]
        for gid,ids in ((g1,self.ids[:3]),(g2,self.ids[3:])):
            self.assertEqual(self.client.put(f'/api/groups/{gid}/players',json={'student_ids':ids}).status_code,200)
        t=self.client.get(f'/api/tournaments/{tid}').json()
        self.assertEqual([len(g['players']) for g in t['groups']],[3,5])
        self.assertEqual(self.client.put(f'/api/groups/{g2}/players',json={'student_ids':self.ids[:1]}).status_code,409)
        self.client.post(f'/api/groups/{g1}/pair')
        before=self.client.get(f'/api/groups/{g1}/pairings').json()
        self.assertEqual(self.client.put(f'/api/groups/{g1}/players',json={'student_ids':[]}).status_code,409)
        self.assertEqual(self.client.patch(f'/api/groups/{g1}',json={'name':'U6 nữ'}).status_code,200)
        self.assertEqual(self.client.get(f'/api/groups/{g1}/pairings').json(),before)
        self.assertEqual(self.client.delete(f'/api/groups/{g1}').status_code,409)
        self.assertEqual(self.client.patch(f'/api/tournaments/{tid}',json={'notes':'Thể lệ đã sửa','date':'10/10, 8h'}).status_code,200)
        self.assertEqual(self.client.get(f'/api/tournaments/{tid}').json()['notes'],'Thể lệ đã sửa')
        r=self.client.post(f'/api/tournaments/{tid}/groups',json={'name':'U9','format':'swiss'})
        self.assertEqual(r.status_code,200)
        g3=r.json()['group_id']
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/move',json={'student_id':self.ids[3],'group_id':g3}).status_code,200)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/move',json={'student_id':self.ids[3],'group_id':g1}).status_code,409)
        self.assertEqual(self.client.post(f'/api/tournaments/{tid}/move',json={'student_id':self.ids[3],'group_id':g2}).status_code,200)
        self.assertEqual(self.client.delete('/api/groups/'+str(g3)).status_code,200)

    def test_create_tournament_before_groups_or_players(self):
        r=self.client.post('/api/tournaments/from-draw',json={'name':'Chưa chốt','mode':'manual','groups':[],'group_names':[]})
        self.assertEqual(r.status_code,200)
        tid=r.json()['tournament_id']
        self.assertEqual(self.client.get(f'/api/tournaments/{tid}').json()['groups'],[])
        r=self.client.post(f'/api/tournaments/{tid}/groups',json={})
        self.assertEqual(r.status_code,200)
        self.assertEqual(self.client.get(f'/api/tournaments/{tid}').json()['groups'][0]['name'],'Bảng 1')
        self.assertEqual(self.client.post('/api/tournaments/from-draw',json={'name':'bad','groups':[[]],'group_names':[]}).status_code,400)

    def test_import_directly_into_group_atomic_and_idempotent(self):
        tid=self.client.post('/api/tournaments/from-draw',json={'name':'Import','groups':[[],[]],'group_names':['Kids','Masters']}).json()['tournament_id']
        gs=self.client.get(f'/api/tournaments/{tid}').json()['groups'];g1,g2=[g['id'] for g in gs]
        batch=[{'name':'Tên mới','rating':1000,'club':'A'},{'name':'Player 1'}]
        r=self.client.post(f'/api/groups/{g1}/import-students',json=batch)
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['added'],2);self.assertEqual(r.json()['created'],1)
        r=self.client.post(f'/api/groups/{g1}/import-students',json=batch)
        self.assertEqual(r.json()['added'],0);self.assertEqual(r.json()['skipped'],2)
        r=self.client.post(f'/api/groups/{g2}/import-students',json=[{'name':'Không được lưu'},{'name':'Player 1'}])
        self.assertEqual(r.status_code,409)
        self.assertFalse(any(s['name']=='Không được lưu' for s in self.client.get('/api/students').json()))
        self.assertEqual(self.client.get(f'/api/tournaments/{tid}').json()['groups'][1]['players'],[])
        self.client.post(f'/api/groups/{g1}/pair')
        self.assertEqual(self.client.post(f'/api/groups/{g1}/import-students',json=[{'name':'Sau ghép'}]).status_code,409)
        self.assertFalse(any(s['name']=='Sau ghép' for s in self.client.get('/api/students').json()))
        self.assertEqual(self.client.post(f'/api/groups/{g2}/import-students',json=[]).status_code,400)

if __name__=='__main__':unittest.main()
