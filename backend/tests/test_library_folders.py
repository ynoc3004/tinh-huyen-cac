"""Thư mục, đổi tên, di chuyển, xóa trong Tàng Kinh Các. Không mở database thật."""
from pathlib import Path
import sys, tempfile, unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db
TEMP = tempfile.TemporaryDirectory()
db.DB_PATH = Path(TEMP.name) / 'test.db'
from main import app
from fastapi.testclient import TestClient
from routers import library

A = '/api/library'


class FolderTests(unittest.TestCase):
    def setUp(self):
        db.init()
        with db.conn() as c:
            for t in ('library_item_tags', 'library_tags', 'library_items', 'library_folders'):
                c.execute(f'DELETE FROM {t}')
        self.dir = tempfile.TemporaryDirectory()
        self.p = patch.object(library, 'LIBRARY_DIR', Path(self.dir.name)); self.p.start()
        library.reset_state()
        self.c = TestClient(app)
        self.assertEqual(self.c.post(A + '/vault/setup', json={'password': 'mat-khau-1'}).status_code, 200)

    def tearDown(self):
        self.p.stop(); library.reset_state(); self.dir.cleanup()

    def up(self, name, data, folder=0):
        r = self.c.post(f'{A}/import?name={name}&folder={folder}', content=data)
        self.assertEqual(r.status_code, 200, r.text)
        return next(i['id'] for i in self.c.get(A).json() if i['title'] == Path(name).stem)

    def mk(self, name, parent=None):
        r = self.c.post(A + '/folders', json={'name': name, 'parent_id': parent})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['id']

    def names(self, folder):
        return sorted(i['title'] for i in self.c.get(f'{A}?folder={folder}').json())

    def test_create_rename_nest_and_duplicates(self):
        a = self.mk('Khai cuộc'); b = self.mk('Tàn cuộc')
        self.assertEqual(self.c.post(A + '/folders', json={'name': 'khai cuộc'}).status_code, 409)
        self.assertEqual(self.c.post(A + '/folders', json={'name': '  '}).status_code, 400)
        self.assertEqual(self.c.post(A + '/folders', json={'name': 'x', 'parent_id': 999}).status_code, 404)
        sub = self.mk('London', a)
        self.mk('London', b)  # cùng tên khác cha: được phép
        self.assertEqual(self.c.patch(f'{A}/folders/{a}', json={'name': 'Tàn cuộc'}).status_code, 409)
        self.assertEqual(self.c.patch(f'{A}/folders/{a}', json={'name': 'Khai cuộc 1'}).status_code, 200)
        fs = {f['id']: f for f in self.c.get(A + '/folders').json()['folders']}
        self.assertEqual(fs[a]['name'], 'Khai cuộc 1'); self.assertEqual(fs[sub]['parent_id'], a)

    def test_move_folder_blocks_cycles(self):
        a = self.mk('A'); b = self.mk('B', a); c = self.mk('C', b)
        self.assertEqual(self.c.patch(f'{A}/folders/{a}', json={'parent_id': c}).status_code, 400)
        self.assertEqual(self.c.patch(f'{A}/folders/{a}', json={'parent_id': a}).status_code, 400)
        self.assertEqual(self.c.patch(f'{A}/folders/{c}', json={'parent_id': None}).status_code, 200)
        fs = {f['id']: f for f in self.c.get(A + '/folders').json()['folders']}
        self.assertIsNone(fs[c]['parent_id']); self.assertEqual(fs[b]['parent_id'], a)

    def test_files_rename_move_upload_into_folder(self):
        f = self.mk('Sách')
        x = self.up('one.txt', b'one', folder=f); y = self.up('two.txt', b'two')
        self.assertEqual(self.names(f), ['one']); self.assertEqual(self.names(0), ['two'])
        self.assertEqual(len(self.c.get(A).json()), 2)  # không lọc = tất cả (dùng khi tìm kiếm)
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'title': 'Hai ván'}).status_code, 200)
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'title': '   '}).status_code, 400)
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'title': '../../evil'}).status_code, 200)
        self.assertEqual(self.names(0), ['evil'])
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'folder_id': f}).status_code, 200)
        self.assertEqual(self.names(f), ['evil', 'one'])
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'folder_id': None}).status_code, 200)
        self.assertEqual(self.names(0), ['evil'])
        self.assertEqual(self.c.patch(f'{A}/{y}', json={'folder_id': 999}).status_code, 404)
        self.assertEqual(self.c.post(f'{A}/import?name=n.txt&folder=999', content=b'z').status_code, 404)
        self.assertEqual(self.c.post(A + '/move', json={'item_ids': [x, y], 'folder_id': f}).status_code, 200)
        self.assertEqual(len(self.names(f)), 2)
        self.assertEqual(self.c.patch(f'{A}/{x}', json={'note': 'giữ nguyên'}).status_code, 200)
        self.assertEqual(self.c.get(f'{A}/file/{x}').content, b'one')
        r = self.c.get(f'{A}/file/{x}?download=true')
        self.assertTrue(r.headers['content-disposition'].startswith('attachment'))
        self.assertTrue(self.c.get(f'{A}/file/{x}').headers['content-disposition'].startswith('inline'))

    def test_delete_folder_keep_and_delete_contents(self):
        a = self.mk('A'); b = self.mk('B', a); c = self.mk('Đã có')
        self.up('f1.txt', b'1', a); self.up('f2.txt', b'2', b)
        self.mk('B', None)  # trùng tên với B khi B nhấc lên gốc
        self.assertEqual(self.c.delete(f'{A}/folders/{a}').status_code, 409)  # chặn thay vì gộp lộn xộn
        self.assertEqual(len(self.names(a)), 1)
        self.c.patch(f'{A}/folders/{b}', json={'name': 'B2'})
        self.assertEqual(self.c.delete(f'{A}/folders/{a}?contents=keep').status_code, 200)
        self.assertEqual(self.names(0), ['f1']); self.assertEqual(self.names(b), ['f2'])
        fs = {f['id']: f for f in self.c.get(A + '/folders').json()['folders']}
        self.assertNotIn(a, fs); self.assertIsNone(fs[b]['parent_id'])
        blobs = len(list((Path(self.dir.name) / 'vault').glob('*.thc')))
        r = self.c.delete(f'{A}/folders/{b}?contents=delete').json()
        self.assertEqual(r['deleted_files'], 1)
        self.assertEqual(len(list((Path(self.dir.name) / 'vault').glob('*.thc'))), blobs - 1)
        self.assertEqual(self.names(0), ['f1'])
        self.assertEqual(self.c.delete(f'{A}/folders/{c}?contents=oops').status_code, 400)
        self.assertEqual(self.c.delete(f'{A}/folders/12345').status_code, 404)

    def test_delete_nested_and_bulk(self):
        a = self.mk('A'); b = self.mk('B', a)
        i1 = self.up('a.txt', b'a', a); i2 = self.up('b.txt', b'b', b); i3 = self.up('c.txt', b'c')
        self.assertEqual(self.c.delete(f'{A}/folders/{a}?contents=delete').json()['deleted_files'], 2)
        self.assertEqual(self.c.get(f'{A}/file/{i1}').status_code, 404)
        self.assertEqual(self.c.get(A + '/folders').json()['folders'], [])
        self.assertEqual(self.c.post(A + '/delete-many', json={'item_ids': [i3, 777]}).json()['deleted'], 1)
        self.assertEqual(self.c.get(A).json(), [])

    def test_requires_unlock(self):
        self.c.post(A + '/vault/lock')
        for m, u in (('get', '/folders'), ('post', '/folders'), ('post', '/move'), ('post', '/delete-many')):
            self.assertEqual(getattr(self.c, m)(A + u, **({} if m == 'get' else {'json': {}})).status_code, 401)


if __name__ == '__main__':
    unittest.main()
