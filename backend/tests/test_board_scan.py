import os
import base64
import httpx
from unittest.mock import patch, AsyncMock
import test_translation
from services import board_scan

PLACEMENT='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
class ScanTests(test_translation.TranslationTests):
    def test_scan_all_cache_bounds_and_lock(self):
        sample=[{'bbox':[10,10,490,490],'placement':PLACEMENT,'turn':'unknown','orientation':'white','label':'One','warning':''},
                {'bbox':[510,510,990,990],'placement':PLACEMENT,'turn':'b','orientation':'black','label':'Two','warning':''}]
        mock=AsyncMock(return_value=sample)
        with patch.dict(os.environ,{'GEMINI_API_KEY':'test-only'}), patch.object(board_scan,'scan_image',mock):
            r=self.client.post(self.base+'/study/boards',json={'page':1,'model':'gemini-selected'})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(len(r.json()['boards']),2)
            self.assertTrue(base64.b64decode(r.json()['boards'][0]['image'].split(',')[1]).startswith(b'\x89PNG'))
            self.assertTrue(self.client.post(self.base+'/study/boards',json={'page':1}).json()['cached'])
            self.assertEqual(mock.await_count,1)
            self.assertEqual(mock.call_args.args[2], "gemini-selected")
            self.assertEqual(self.client.post(self.base+"/study/boards",json={"page":2,"model":"../../bad"}).status_code,422)
            self.assertEqual(self.client.get(self.base+'/study/boards?page=3').status_code,400)
            self.assertEqual(self.client.post(self.base+'/study/boards',json={'page':3}).status_code,400)
            self.assertEqual(len(self.client.get(self.base+'/study/boards?page=1').json()['boards']),2)
        with patch.dict(os.environ,{'GEMINI_API_KEY':''}):
            self.assertTrue(self.client.post(self.base+'/study/boards',json={'page':1}).json()['cached'])
            self.assertEqual(self.client.post(self.base+'/study/boards',json={'page':2}).status_code,503)
        paths=list((__import__('routers.library',fromlist=['x'])._blob_dir()/'translations').glob('*.thc'))
        self.assertTrue(paths)
        self.assertNotIn(PLACEMENT.encode(),b''.join(p.read_bytes() for p in paths))
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.get(self.base+'/study/boards?page=1').status_code,401)
    def test_placement_validation(self):
        self.assertTrue(board_scan.validate_placement(PLACEMENT))
        for s in ['8/8/8/8/8/8/8/8','9/8/8/8/8/8/8/Kk','88/8/8/8/8/8/8/Kk','<script>',None]:
            self.assertFalse(board_scan.validate_placement(s))
    def test_vision_api_validates_and_fails_cleanly(self):
        import asyncio,json
        result={'boards':[{'bbox':[0,0,500,500],'placement':PLACEMENT,'turn':'unknown','orientation':'unknown'}]}
        status=[200]
        class Client:
            def __init__(self,**kw):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,headers,json):
                assert headers['x-goog-api-key']=='test-only'
                assert 'test-only' not in url
                assert json['contents'][0]['parts'][1]['inlineData']['mimeType']=='image/png'
                return httpx.Response(status[0],json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':__import__('json').dumps(result)}]}}]},request=httpx.Request('POST',url))
        with patch.object(board_scan.httpx,'AsyncClient',Client):
            out=asyncio.run(board_scan.scan_image(b'png','test-only','gemini-test'))
            self.assertEqual(out[0]['placement'],PLACEMENT)
            self.assertIn('hướng',out[0]['warning'])
            status[0]=429
            with self.assertRaises(Exception) as e:asyncio.run(board_scan.scan_image(b'png','test-only','gemini-test'))
            self.assertEqual(e.exception.status_code,429)
            status[0]=200;result['boards'][0]['bbox']=[0,0,1001,1001]
            with self.assertRaises(Exception) as e:asyncio.run(board_scan.scan_image(b'png','test-only','gemini-test'))
            self.assertEqual(e.exception.status_code,502)

    def test_scan_model_discovery_separate_from_translation(self):
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url, headers, params):
                assert headers['x-goog-api-key'] == 'test-only'
                assert 'test-only' not in url
                return httpx.Response(200, json={'models':[
                    {'name':'models/gemini-example-flash','supportedGenerationMethods':['generateContent']},
                    {'name':'models/gemini-example-tts','supportedGenerationMethods':['generateContent']},
                    {'name':'models/embedding-example','supportedGenerationMethods':['embedContent']}]}, request=httpx.Request('GET',url))
        with patch.dict(os.environ, {'GEMINI_API_KEY':'test-only'}), patch.object(board_scan.httpx,'AsyncClient',Client):
            result = self.client.get('/api/library/translation/study/scan-models')
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['models'], ['gemini-example-flash'])
            self.assertNotIn('test-only', result.text)
        with patch.dict(os.environ, {'GEMINI_API_KEY':''}):
            self.assertFalse(self.client.get('/api/library/translation/study/scan-models').json()['available'])
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.get('/api/library/translation/study/scan-models').status_code,401)

    def test_transient_scan_retry_and_permanent_failures(self):
        import asyncio
        import json
        from fastapi import HTTPException
        result = {'boards': [{'bbox': [0, 0, 500, 500], 'placement': PLACEMENT}]}
        responses = []
        calls = []
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, url, headers, json):
                calls.append(url)
                status = responses.pop(0)
                return httpx.Response(status, json={'candidates': [{'finishReason': 'STOP',
                    'content': {'parts': [{'text': __import__('json').dumps(result)}]}}]},
                    request=httpx.Request('POST', url))
        sleep = AsyncMock()
        with patch.object(board_scan.httpx, 'AsyncClient', Client), patch.object(board_scan.asyncio, 'sleep', sleep):
            responses[:] = [503, 503, 200]
            out = asyncio.run(board_scan.scan_image(b'png', 'test-only', 'gemini-selected'))
            self.assertEqual(out[0]['placement'], PLACEMENT)
            self.assertEqual(len(calls), 3)
            self.assertEqual(sleep.await_count, 2)
            self.assertTrue(all('gemini-selected:generateContent' in url for url in calls))
            for status in [400, 401, 403, 404, 429, 503]:
                calls.clear(); sleep.reset_mock()
                responses[:] = [status] * (3 if status == 503 else 1)
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(board_scan.scan_image(b'png', 'test-only', 'gemini-selected'))
                self.assertEqual(len(calls), 3 if status == 503 else 1)
                self.assertNotIn('test-only', error.exception.detail)
                if status == 503:
                    self.assertIn('3 lần', error.exception.detail)
                    self.assertIn('AI quét', error.exception.detail)
                else:
                    self.assertEqual(sleep.await_count, 0)

    def test_failed_rescan_preserves_saved_diagrams(self):
        from fastapi import HTTPException
        sample = [{'bbox': [0, 0, 500, 500], 'placement': PLACEMENT,
                   'turn': 'w', 'orientation': 'white', 'label': '', 'warning': ''}]
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-only'}), patch.object(board_scan, 'scan_image', AsyncMock(return_value=sample)):
            self.assertEqual(self.client.post(self.base+'/study/boards', json={'page': 1}).status_code, 200)
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-only'}), patch.object(board_scan, 'scan_image', AsyncMock(side_effect=HTTPException(503, 'Unavailable'))):
            self.assertEqual(self.client.post(self.base+'/study/boards', json={'page': 1, 'force': True}).status_code, 503)
        saved = self.client.get(self.base+'/study/boards?page=1').json()
        self.assertEqual(saved['boards'][0]['placement'], PLACEMENT)

    def test_page_preview_matches_selected_page_and_vault_guard(self):
        first = self.client.get(self.base+'/study/page-image?page=1')
        second = self.client.get(self.base+'/study/page-image?page=2')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers['content-type'], 'image/png')
        self.assertEqual(first.headers['cache-control'], 'no-store')
        self.assertNotEqual(first.content, second.content)
        self.assertTrue(first.content.startswith(b'\x89PNG'))
        self.assertEqual(self.client.get(self.base+'/study/page-image?page=3').status_code, 400)
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.get(self.base+'/study/page-image?page=1').status_code, 401)

    def test_small_image_probe_reports_model_failure_without_retry(self):
        import asyncio
        from fastapi import HTTPException
        status = [200]
        calls = []
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, url, headers, json):
                calls.append(url)
                image = base64.b64decode(json['contents'][0]['parts'][1]['inlineData']['data'])
                self_image = __import__('pymupdf').Pixmap(image)
                assert self_image.width == 64 and self_image.height == 64
                return httpx.Response(status[0], json={'candidates': [{'finishReason': 'STOP'}]}, request=httpx.Request('POST',url))
        with patch.object(board_scan.httpx, 'AsyncClient', Client):
            self.assertTrue(asyncio.run(board_scan.probe_image('test-only', 'gemini-selected'))['ok'])
            calls.clear(); status[0] = 503
            with self.assertRaises(HTTPException) as error:
                asyncio.run(board_scan.probe_image('test-only', 'gemini-selected'))
            self.assertEqual(len(calls), 1)
            self.assertIn('Ảnh thử nhỏ', error.exception.detail)
            self.assertNotIn('test-only', error.exception.detail)
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-only'}), patch.object(board_scan, 'probe_image', AsyncMock(return_value={'ok': True})):
            self.assertEqual(self.client.post('/api/library/translation/study/scan-probe', json={'model':'gemini-selected'}).status_code, 200)
            self.assertEqual(self.client.post('/api/library/translation/study/scan-probe', json={'model':'../bad'}).status_code, 422)
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.post('/api/library/translation/study/scan-probe', json={'model':'gemini-selected'}).status_code, 401)
