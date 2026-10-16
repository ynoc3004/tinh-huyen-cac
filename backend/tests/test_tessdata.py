"""Find readable English OCR data even with an invalid Windows environment."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import pymupdf
from services import book_text
import test_translation

class TessdataTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
    def data(self,folder):
        folder.mkdir(parents=True,exist_ok=True);(folder/'eng.traineddata').write_bytes(b'fake-language-data');return folder
    def test_configured_install_root_is_corrected_to_tessdata(self):
        folder=self.data(self.root/'Tesseract-OCR'/'tessdata')
        with patch.dict(os.environ,{'TESSDATA_PREFIX':str(folder.parent)}):
            self.assertEqual(book_text.find_tessdata(),str(folder))
            self.assertEqual(os.environ['TESSDATA_PREFIX'],str(folder.parent),'Discovery must not change global config')
    def test_explicit_tessdata_folder_is_preferred(self):
        folder=self.data(self.root/'custom-data')
        with patch.dict(os.environ,{'TESSDATA_PREFIX':str(folder)}):
            self.assertEqual(book_text.find_tessdata(),str(folder))
    def test_invalid_x86_prefix_falls_back_to_real_windows_install(self):
        folder=self.data(self.root/'Program Files'/'Tesseract-OCR'/'tessdata')
        with patch.dict(os.environ,{'TESSDATA_PREFIX':str(self.root/'missing-x86'), 'ProgramFiles':str(self.root/'Program Files'), 'ProgramW6432':str(self.root/'missing')}):
            self.assertEqual(book_text.find_tessdata(),str(folder))
    def test_path_installation_can_supply_english_data(self):
        folder=self.data(self.root/'custom-install'/'tessdata')
        with patch.dict(os.environ,{'TESSDATA_PREFIX':''}),patch.object(book_text.shutil,'which',return_value=str(folder.parent/'tesseract.exe')):
            self.assertEqual(book_text.find_tessdata(),str(folder))
    def test_missing_or_empty_language_file_fails_before_ocr(self):
        folder=self.root/'empty';folder.mkdir();(folder/'eng.traineddata').write_bytes(b'')
        with patch.object(book_text,'tessdata_candidates',return_value=iter([folder])):
            with self.assertRaisesRegex(book_text.OCRSetupError,'eng.traineddata'):
                book_text.find_tessdata()
    def test_native_pdf_reading_ignores_invalid_ocr_configuration(self):
        with pymupdf.open() as doc:
            page=doc.new_page();page.insert_text((40,40),'White plays Nf3.')
            with patch.object(book_text,'find_tessdata',side_effect=AssertionError('OCR was not requested')):
                self.assertIn('Nf3',book_text.page_text(page))
    def test_valid_explicit_folder_is_passed_to_engine_and_load_errors_explained(self):
        class Page:
            def get_textpage_ocr(self,**kwargs):
                self.folder=kwargs['tessdata'];raise RuntimeError('language data damaged')
        page=Page()
        with patch.object(book_text,'find_tessdata',return_value='/valid/tessdata'):
            with self.assertRaisesRegex(book_text.OCRSetupError,'Tesseract không đọc được'):
                book_text.page_text(page,ocr=True)
        self.assertEqual(page.folder,'/valid/tessdata')

class OCRApiTests(test_translation.TranslationTests):
    def test_missing_english_data_is_actionable_and_does_not_overwrite_source(self):
        self.client.post(self.base+'/study/source',json={'page':1,'text':'Manual source.'})
        with patch.object(book_text,'find_tessdata',side_effect=book_text.OCRSetupError('Không tìm thấy eng.traineddata; sửa TESSDATA_PREFIX.')):
            response=self.client.get(self.base+'/page?page=1&ocr=true&fresh=true')
        self.assertEqual(response.status_code,503)
        self.assertIn('eng.traineddata',response.json()['detail'])
        self.assertEqual(self.client.get(self.base+'/page?page=1').json()['text'],'Manual source.')
