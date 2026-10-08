import os
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock

import test_translation
from services import local_board_scan, board_scan

PLACEMENT = 'rnbqkbnr/pppppppp/8/8/3P1B2/2PBPN2/PP1N1PPP/R2QK2R'


class LocalScanTests(test_translation.TranslationTests):
    def test_local_default_without_api_key_and_provider_caches(self):
        sample = [{'bbox': [10, 10, 490, 490], 'placement': PLACEMENT,
                   'turn': 'unknown', 'orientation': 'white', 'label': '', 'warning': ''}]
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}), patch.object(local_board_scan, 'scan_image', return_value=sample) as local, patch.object(board_scan, 'scan_image', AsyncMock()) as cloud:
            response = self.client.post(self.base + '/study/boards', json={'page': 1})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['engine'], 'local')
            self.assertEqual(response.json()['model'], local_board_scan.ENGINE)
            self.assertEqual(response.json()['boards'][0]['turn'], 'unknown')
            self.assertTrue(local.call_args.args[0].startswith(b'\x89PNG'))
            self.assertTrue(self.client.post(self.base + '/study/boards', json={'page': 1}).json()['cached'])
            self.assertEqual(local.call_count, 1)
            cloud.assert_not_awaited()
        self.assertEqual(self.client.get(self.base + '/study/boards?page=1&engine=gemini').json()['boards'], None)
        self.assertEqual(self.client.get(self.base + '/study/boards?page=1').json()['boards'][0]['placement'], PLACEMENT)
        with patch.object(local_board_scan, 'scan_image', side_effect=RuntimeError('Chạy python setup_board_scan.py.')):
            response = self.client.post(self.base + '/study/boards', json={'page': 1, 'force': True})
            self.assertEqual(response.status_code, 503)
            self.assertIn('setup_board_scan.py', response.json()['detail'])
        self.assertEqual(self.client.get(self.base + '/study/boards?page=1').json()['boards'][0]['placement'], PLACEMENT)
        paths = list((__import__('routers.library', fromlist=['x'])._blob_dir() / 'translations').glob('*.thc'))
        self.assertNotIn(PLACEMENT.encode(), b''.join(path.read_bytes() for path in paths))
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.get('/api/library/translation/study/scan-local').status_code, 401)
        self.assertEqual(self.client.get(self.base + '/study/boards?page=1').status_code, 401)

    def test_local_setup_and_probe_use_no_cloud_calls(self):
        state = {'installed': False, 'ready': False, 'message': local_board_scan.INSTALL}
        with patch.object(local_board_scan, 'status', return_value=state), patch.object(board_scan, 'probe_image', AsyncMock()) as cloud:
            response = self.client.get('/api/library/translation/study/scan-local')
            self.assertEqual(response.json(), state)
            response = self.client.post('/api/library/translation/study/scan-probe', json={'model': 'local:chessvision'})
            self.assertEqual(response.status_code, 503)
            self.assertIn('requirements-scan.txt', response.json()['detail'])
            cloud.assert_not_awaited()
        with patch.object(local_board_scan, 'probe', return_value={'ok': True, 'message': 'Local OK'}):
            self.assertTrue(self.client.post('/api/library/translation/study/scan-probe', json={'model': 'local:chessvision'}).json()['ok'])
        with patch.dict(os.environ, {'GEMINI_API_KEY': ''}):
            models = self.client.get('/api/library/translation/study/scan-models').json()
            self.assertEqual(models['default'], 'local:chessvision')
            self.assertEqual(models['models'], ['local:chessvision'])


class LocalModelTests(unittest.TestCase):
    def test_missing_setup_fails_before_loading_or_downloading(self):
        with patch.object(local_board_scan, 'status', return_value={'ready': False, 'message': 'setup required'}), patch.object(local_board_scan, '_get_predictor') as load:
            with self.assertRaisesRegex(RuntimeError, 'setup required'):
                local_board_scan.scan_image(b'not an image')
            load.assert_not_called()

    @unittest.skipUnless(__import__('importlib.util', fromlist=['x']).find_spec('cv2'), 'Optional local scanner not installed')
    def test_hatched_empty_board_is_detected_and_plain_square_is_rejected(self):
        import numpy as np
        from PIL import Image, ImageDraw
        image = Image.new('RGB', (256, 256), 'white')
        draw = ImageDraw.Draw(image)
        for y in range(256):
            for x in range(256):
                if (x // 32 + y // 32) % 2 and (x + y) % 5 < 2:
                    draw.point((x, y), fill='black')
        self.assertTrue(local_board_scan._is_grid(np.asarray(image.convert('L'))))
        self.assertFalse(local_board_scan._is_grid(np.full((256, 256), 255, dtype=np.uint8)))
        self.assertTrue(local_board_scan._regions(image, ()))

    @unittest.skipUnless(__import__('importlib.util', fromlist=['x']).find_spec('cv2'), 'Optional local scanner not installed')
    def test_detector_grid_alignment_wins_over_larger_fallback(self):
        import numpy as np
        from PIL import Image
        import chessvision
        # A unique texture lets template matching recover the exact crop.
        image = Image.fromarray(np.random.default_rng(42).integers(0, 256, (256, 256, 3), dtype=np.uint8))
        with patch.object(chessvision, 'BoardDetector') as detector, patch.object(local_board_scan, '_is_grid', return_value=True):
            detector.return_value.detect.return_value = [image.crop((10, 10, 246, 246))]
            self.assertEqual(local_board_scan._regions(image, ()), [(10, 10, 246, 246)])

    def test_model_checksum_rejects_corrupt_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'classifier.onnx'
            path.write_bytes(b'corrupt model')
            stat = path.stat()
            self.assertFalse(local_board_scan._verified(str(path), stat.st_size, stat.st_mtime_ns))
