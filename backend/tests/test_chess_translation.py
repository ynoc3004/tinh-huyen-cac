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

    def test_prompt_glossary_handles_wrapped_terms_and_custom_overrides(self):
        terms=chess.glossary_text('special  term=thuật ngữ riêng','The London\nsystem with a bishop.')
        self.assertIn('london system=hệ thống London',terms)
        self.assertIn('bishop=tượng',terms)
        self.assertIn('special term=thuật ngữ riêng',terms)
        self.assertNotIn('endgame=',terms)

    def test_local_model_receives_whole_commentary_without_term_fragments(self):
        source='After the opening of the h-file, White has plenty of attacking possibilities against the black king.'
        expected='Sau khi cột h được mở, Trắng có nhiều cơ hội tấn công vua Đen.'
        with patch.object(local_translation,'load_model',return_value=object()),patch.object(local_translation,'_translate_fragment',return_value=expected) as translate:
            self.assertEqual(local_translation.translate_text(source),expected)
        self.assertEqual(translate.call_args.args[0],source)
        self.assertEqual(translate.call_count,1,'Do not translate isolated of/for the/against the fragments')

    def test_long_variation_is_copied_but_bishop_sentence_keeps_context(self):
        line='8...a6 9.Bxc6 bxc6 10.Qa4 Rb8 11.Qa3 Bxg3 12.hxg3 cxd4 1-0'
        source='The natural square for the bishop. It controls e4 and points at h7.\n\n'+line
        target='Đây là ô triển khai tự nhiên của tượng. Tượng kiểm soát e4 và nhắm vào h7.'
        with patch.object(local_translation,'load_model',return_value=object()),patch.object(local_translation,'_translate_fragment',return_value=target) as translate:
            result=local_translation.translate_text(source)
        self.assertEqual(translate.call_args.args[0],source.split('\n\n')[0]);self.assertEqual(translate.call_count,1)
        self.assertTrue(result.endswith(line));chess.validate_output(source,result)

    def test_moves_only_input_needs_no_model(self):
        with patch.object(local_translation,'load_model') as load:
            self.assertEqual(local_translation.translate_text('1. Nf3 d5 2. O-O Bxh7+'),'1. Nf3 d5 2. O-O Bxh7+')
            load.assert_not_called()

    def test_sentence_splitter_does_not_separate_move_from_its_comment(self):
        class Tokenizer:
            def encode(self,text):return text.split()
        source='8.Bb5!? is another interesting possibility. Its attack is strong.'
        self.assertEqual(local_translation.segments(source,Tokenizer()),['8.Bb5!? is another interesting possibility.','Its attack is strong.'])

    def test_known_non_chess_senses_are_corrected_without_english_word_order(self):
        self.assertEqual(chess.polish_terms('White attacks along the h-file.','Trắng tấn công dọc tập tin h.'),'Trắng tấn công dọc cột h.')
        source='The bishop attacks the black king.'
        self.assertEqual(chess.polish_terms(source,'Tượng tấn công vua Đen.'),'Tượng tấn công vua Đen.')
        self.assertEqual(chess.polish_terms(source,'Giám mục tấn công vua Đen.'),'Tượng tấn công vua Đen.')
        self.assertEqual(chess.polish_terms(source,'Tượng tấn công vua Đen.','bishop=quân tượng'),'Quân tượng tấn công vua Đen.')

    def test_coptic_month_artifact_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'nội dung lỗi'):
            chess.validate_output('After opening the h-file.','Sau khi mở Tháng BaCoptic month 12 - LongName cột h.')

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
        for garbage in ('Rb.Rb.Rb.Rb.Rb.Rb.','Tháng BaCoptic month 12 - LongName Nf3 O-O.'):
            with patch.object(local_translation,'translate_text',return_value=garbage):
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
                return httpx.Response(200,json={'translations':[{'text':json['text'][0].replace('White plays','Trắng đi').replace('with the bishop','với giám mục')}]},request=httpx.Request('POST',url))
        body={'text':'White plays Nf3 with the bishop.','page':1,'model':'deepl:en-vi','glossary':'bishop=quân tượng'}
        with patch.dict(os.environ,{'DEEPL_API_KEY':'test-only'}),patch.object(translation.httpx,'AsyncClient',Client):
            r=self.client.post(self.base+'/translate',json=body)
        self.assertEqual(r.status_code,200,r.text)
        self.assertIn('Trắng đi Nf3',r.json()['translation']);self.assertIn('quân tượng',r.json()['translation'])
        self.assertIn('bishop',calls[0]['text'][0]);self.assertNotIn('__THC_TERM_',calls[0]['text'][0]);self.assertIn('bishop=quân tượng',calls[0]['context'])
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
                text=json['contents'][0]['parts'][0]['text'].replace('White plays','Trắng đi').replace('The London System','hệ thống London')
                return httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':text}]}}]},request=httpx.Request('POST',url))
        body={'text':'White plays Nf3. The London System.','page':1,'model':'gemini:'+translation.GEMINI_MODEL,'glossary':'bishop=quân tượng'}
        with patch.dict(os.environ,{'GEMINI_API_KEY':'test-only'}),patch.object(translation.httpx,'AsyncClient',Client):
            r=self.client.post(self.base+'/translate',json=body)
        self.assertEqual(r.status_code,200,r.text);self.assertIn('hệ thống London',r.json()['translation'])
        self.assertIn('Nf3',r.json()['translation'])
        self.assertIn('The London System',calls[0]['contents'][0]['parts'][0]['text']);self.assertNotIn('__THC_TERM_',calls[0]['contents'][0]['parts'][0]['text'])
        system=calls[0]['systemInstruction']['parts'][0]['text']
        self.assertNotIn('endgame=tàn cuộc',system);self.assertIn('london system=hệ thống London',system);self.assertIn('bishop=quân tượng',system)
