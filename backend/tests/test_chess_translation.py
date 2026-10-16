"""Regressions for chess vocabulary, diagram text and recovery of old errors."""
import unittest
from unittest.mock import patch
import pymupdf
import test_translation
from routers import translation, library
from services import chess_translation as chess, book_text, local_translation

class ChessTextTests(unittest.TestCase):
    def test_diagram_rows_are_not_prose_and_real_variations_survive(self):
        text='7...O-O\nRb.Rb.Rb.Rb.Rb.Rb.Rb.Rb.\na b c d e f g h\n8.Bd3\nThe bishop controls e4 and points at h7.'
        clean=chess.clean_source(text)
        self.assertNotIn('Rb.Rb',clean);self.assertNotIn('a b c d',clean)
        for phrase in ('7...O-O','8.Bd3','bishop controls e4'):self.assertIn(phrase,clean)
        for text in ('He had a bad headache.', 'He had a bad bag.', '1. d4 d5 2. Nf3 Nf6 3. Bf4 e6','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'):
            self.assertEqual(chess.clean_source(text),text)

    def test_unicode_figures_only_change_inside_moves(self):
        self.assertEqual(chess.clean_source('8.♗d3 ♞f6 ♕xh7+ ♙d4'),'8.Bd3 Nf6 Qxh7+ d4')
        self.assertEqual(chess.clean_source('A decorative ♞'),'A decorative ♞')

    def test_pdf_diagram_font_is_excluded_but_inline_moves_are_kept(self):
        class Page:
            def get_text(self,*args,**kwargs):
                return {'blocks':[{'type':0,'lines':[
                    {'spans':[{'font':'Times-Roman','text':'7...O-O'}]},
                    {'spans':[{'font':'ChessFigurine','text':'Bxh7+'}]},
                    {'spans':[{'font':'ChessAlpha2','text':'Rb.Rb.Rb.Rb.Rb.'}]},
                    {'spans':[{'font':'ChessMerida','text':'♗'},{'font':'Times-Roman','text':'d3 controls e4.'}]},
                    {'spans':[{'font':'Times-Roman','text':'a b c d e f g h'}]}]}]}
        self.assertEqual(book_text.page_text(Page()),'7...O-O\nBxh7+\nBd3 controls e4.')

    def test_actual_pdf_filter_keeps_narrative_on_both_sides_of_diagram(self):
        with pymupdf.open() as doc:
            page=doc.new_page()
            for y,text in [(40,'7...O-O'),(80,'Rb.Rb.Rb.Rb.Rb.Rb.Rb.Rb.'),(120,'a b c d e f g h'),(160,'8.Bd3 The bishop controls e4 and points at h7.')]:
                page.insert_text((40,y),text)
            text=translation.extract_page(doc,0)
        for phrase in ('7...O-O','8.Bd3','bishop controls e4'):self.assertIn(phrase,text)
        self.assertNotIn('Rb.Rb',text)

    def test_explicit_ocr_replaces_nonempty_broken_text_layer(self):
        class Page:
            def get_textpage_ocr(self,**kwargs):self.ocr=kwargs;return 'OCR-PAGE'
            def get_text(self,*args,**kwargs):self.textpage=kwargs['textpage'];return {'blocks':[]}
        page=Page()
        with patch.object(book_text,'find_tessdata',return_value='/fake/tessdata'):
            self.assertEqual(book_text.page_text(page,ocr=True),'')
        self.assertEqual(page.textpage,'OCR-PAGE');self.assertTrue(page.ocr['full'])

    def test_default_and_custom_terms_merge_and_moves_restore(self):
        source='The London System: White plays 7...O-O and 8.Bd3; the bishop controls e4.'
        protected,tokens=chess.protect(source,'bishop=quân tượng; outpost=ô mạnh')
        result=chess.restore(protected,tokens)
        for phrase in ('hệ thống London','quân tượng','7...O-O','8.Bd3','e4'):self.assertIn(phrase,result)
        self.assertIn('endgame',chess.glossary_entries('bishop=quân tượng'))
        with self.assertRaises(ValueError):chess.restore(protected+next(iter(tokens)),tokens)

    def test_local_model_does_not_receive_terms_or_notation(self):
        source='The London System in 12 practical lessons. White plays Nf3 and O-O.'
        def narrative(text,runtime):
            for word in ('Nf3','London','__THC'):self.assertNotIn(word,text)
            return {'in 12':'qua 12','plays':'đi','and':'và'}.get(text,text)
        with patch.object(local_translation,'load_model',return_value=object()),patch.object(local_translation,'_translate_fragment',side_effect=narrative):
            result=local_translation.translate_text(source)
        self.assertIn('hệ thống London qua 12 bài học thực hành',result)
        self.assertIn('Trắng đi Nf3 và O-O.',result);chess.validate_output(source,result)

    def test_title_terms_survive_pdf_line_and_block_breaks(self):
        text='THE LONDON\n\nSYSTEM\nIN 12 PRACTICAL\n\nLESSONS'
        with patch.object(local_translation,'load_model',return_value=object()),patch.object(local_translation,'_translate_fragment',side_effect=lambda text,runtime:text):
            result=local_translation.translate_text(text)
        self.assertIn('hệ thống London',result);self.assertIn('bài học thực hành',result)

    def test_moves_only_and_custom_terms_need_no_model(self):
        with patch.object(local_translation,'load_model') as load:
            self.assertEqual(local_translation.translate_text('1. Nf3 d5 2. O-O Bxh7+'),'1. Nf3 d5 2. O-O Bxh7+')
            self.assertEqual(local_translation.translate_text('bishop','bishop=quân tượng'),'quân tượng')
            load.assert_not_called()

    def test_opening_of_file_is_not_the_opening_phase(self):
        text,tokens=chess.protect('After the opening of the h-file, White attacks.')
        self.assertIn('mở of',chess.restore(text,tokens))

    def test_garbage_loops_and_changed_move_order_are_rejected(self):
        for result in ('Rb.Rb.Rb.Rb.Rb.Rb.','Trắng đi O-O rồi Nf3.','Trắng đi Nf3.','abc '*40):
            with self.subTest(result=result),self.assertRaises(ValueError):
                chess.validate_output('White plays Nf3 and O-O.',result)

class ChessTranslationAPITests(test_translation.TranslationTests):
    def test_local_glossary_and_force(self):
        body={'text':'White plays Nf3 and O-O.','page':1,'model':local_translation.ENGINE,'glossary':'bishop=quân tượng'}
        with patch.object(local_translation,'translate_text',return_value='Trắng đi Nf3 và O-O.') as translate:
            a=self.client.post(self.base+'/translate',json=body);self.assertEqual(a.status_code,200,a.text)
            self.assertEqual(translate.call_args.args,(body['text'],body['glossary']))
            self.assertTrue(self.client.post(self.base+'/translate',json=body).json()['cached'])
            self.assertFalse(self.client.post(self.base+'/translate',json={**body,'force':True}).json()['cached'])
            self.assertEqual(translate.call_count,2)

    def test_bad_output_is_not_cached_and_failed_retry_keeps_good_cache(self):
        body={'text':'White plays Nf3 and O-O.','page':1,'model':local_translation.ENGINE}
        with patch.object(local_translation,'translate_text',return_value='Rb.Rb.Rb.Rb.Rb.Rb.'):
            self.assertEqual(self.client.post(self.base+'/translate',json=body).status_code,502)
            self.assertIsNone(self.client.post(self.base+'/cached',json=body).json()['translation'])
        with patch.object(local_translation,'translate_text',return_value='Trắng đi Nf3 và O-O.'):
            self.assertEqual(self.client.post(self.base+'/translate',json=body).status_code,200)
        with patch.object(local_translation,'translate_text',return_value='Rb.Rb.Rb.Rb.Rb.Rb.'):
            self.assertEqual(self.client.post(self.base+'/translate',json={**body,'force':True}).status_code,502)
        self.assertEqual(self.client.post(self.base+'/cached',json=body).json()['translation'],'Trắng đi Nf3 và O-O.')

    def test_old_translation_and_batch_are_retained_but_not_reused(self):
        row=translation.book(self.item);key=library._state["key"]
        body={'text':'White plays Nf3 and O-O.','page':1,'model':local_translation.ENGINE}
        old=translation.cache_path(row,key,'v1:1:'+body['model']+':'+body['text'])
        translation.write_cache(old,key,{'translation':'WRONG OLD TEXT'})
        self.assertIsNone(self.client.post(self.base+'/cached',json=body).json()['translation']);self.assertTrue(old.is_file())
        translation.write_cache(translation.job_path(row,key),key,{'model':body['model'],'signature':'old','start':1,'end':2,'phase':'ready'})
        result=self.client.get(self.base+'/batch/page?page=1').json()
        self.assertTrue(result['outdated']);self.assertIsNone(result['translation'])
        self.assertEqual(self.client.post(self.base+'/batch/step').status_code,409)
        job=self.client.post(self.base+'/batch/start',json={'model':body['model'],'start':1,'end':2}).json()
        self.assertEqual(job['pipeline_revision'],chess.REVISION)

    def test_fresh_source_bypasses_but_does_not_destroy_manual_edits(self):
        self.client.post(self.base+'/study/source',json={'page':1,'text':'Manual annotation.'})
        self.assertEqual(self.client.get(self.base+'/page?page=1').json()['text'],'Manual annotation.')
        fresh=self.client.get(self.base+'/page?page=1&fresh=true')
        self.assertEqual(fresh.status_code,200,fresh.text);self.assertIn('White plays Nf3',fresh.json()['text'])
        self.assertEqual(self.client.get(self.base+'/page?page=1').json()['text'],'Manual annotation.')
        self.client.post('/api/library/vault/lock')
        self.assertEqual(self.client.get(self.base+'/page?page=1&fresh=true').status_code,401)

class ProviderChessTests(test_translation.TranslationTests):
    def test_deepl_preserves_xml_terms_moves_and_custom_overrides(self):
        import os, httpx
        calls=[]
        class Client:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,headers,json):
                calls.append(json)
                return httpx.Response(200,json={'translations':[{'text':json['text'][0].replace(' plays ',' đi ')}]},request=httpx.Request('POST',url))
        body={'text':'White plays Nf3 with the bishop.','page':1,'model':'deepl:en-vi','glossary':'bishop=quân tượng'}
        with patch.dict(os.environ,{'DEEPL_API_KEY':'test-only'}),patch.object(translation.httpx,'AsyncClient',Client):
            r=self.client.post(self.base+'/translate',json=body)
        self.assertEqual(r.status_code,200,r.text)
        self.assertIn('Trắng đi Nf3',r.json()['translation']);self.assertIn('quân tượng',r.json()['translation'])
        self.assertNotIn('bishop',calls[0]['text'][0]);self.assertIn('__THC_TERM_',calls[0]['text'][0])
        self.assertIn('move',calls[0]['ignore_tags'])

    def test_gemini_terms_notation_and_supplemental_glossary(self):
        import os,httpx
        calls=[]
        class Client:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,headers,json):
                calls.append(json)
                text=json['contents'][0]['parts'][0]['text'].replace(' plays ',' đi ')
                return httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':text}]}}]},request=httpx.Request('POST',url))
        body={'text':'White plays Nf3. The London System.','page':1,'model':'gemini:'+translation.GEMINI_MODEL,'glossary':'bishop=quân tượng'}
        with patch.dict(os.environ,{'GEMINI_API_KEY':'test-only'}),patch.object(translation.httpx,'AsyncClient',Client):
            r=self.client.post(self.base+'/translate',json=body)
        self.assertEqual(r.status_code,200,r.text);self.assertIn('hệ thống London',r.json()['translation'])
        self.assertIn('Nf3',r.json()['translation'])
        system=calls[0]['systemInstruction']['parts'][0]['text']
        self.assertIn('endgame=tàn cuộc',system);self.assertIn('bishop=quân tượng',system)
