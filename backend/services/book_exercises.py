"""Optional, data-only exercise extension for portable books."""
import re
import chess


def validate_exercises(data):
    if not isinstance(data, list) or not 1 <= len(data) <= 10000:
        raise ValueError('Kho bài tập cần có 1–10.000 bài.')
    ids, total_nodes = set(), 0
    for item in data:
        if not isinstance(item, dict):
            raise ValueError('Dữ liệu bài tập không hợp lệ.')
        eid = item.get('id')
        if not isinstance(eid, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', eid) or eid in ids | {'constructor', 'prototype'}:
            raise ValueError('Mã bài tập không hợp lệ hoặc trùng.')
        ids.add(eid)
        for key, limit in [('title', 200), ('group', 160), ('prompt', 2000), ('answer', 30000), ('answer_vi', 30000), ('rights_note', 500)]:
            if not isinstance(item.get(key, ''), str) or len(item.get(key, '')) > limit:
                raise ValueError('Lời dẫn hoặc đáp án bài tập không hợp lệ.')
        if item.get('status') not in ('verified', 'review') or item.get('kind') not in ('mate1', 'line'):
            raise ValueError('Loại hoặc trạng thái bài tập không hợp lệ.')
        if type(item.get('number')) is not int or not 1 <= item['number'] <= 100000:
            raise ValueError('Số bài tập không hợp lệ.')
        for key in ('page', 'answer_page'):
            if type(item.get(key)) is not int or not 1 <= item[key] <= 100000:
                raise ValueError('Trang nguồn bài tập không hợp lệ.')
        fen = item.get('fen')
        if not isinstance(fen, str) or len(fen) > 150:
            raise ValueError('FEN bài tập không hợp lệ.')
        try:
            board = chess.Board(fen)
        except ValueError as exc:
            raise ValueError('FEN bài tập không hợp lệ.') from exc
        if not isinstance(item.get('tree'), list) or (item['status'] == 'verified' and (not board.is_valid() or not item['tree'])):
            raise ValueError('Bài đã kiểm tra phải có thế cờ và lời giải hợp lệ.')
        stack = [(board, item['tree'], 0)]
        while stack:
            position, choices, depth = stack.pop()
            if not isinstance(choices, list) or len(choices) > 218 or depth > 160:
                raise ValueError('Lời giải bài tập quá sâu hoặc sai cấu trúc.')
            seen = set()
            for node in choices:
                total_nodes += 1
                if total_nodes > 250000 or not isinstance(node, dict) or set(node) != {'move', 'next'}:
                    raise ValueError('Lời giải bài tập quá lớn hoặc sai cấu trúc.')
                move = node['move']
                if not isinstance(move, str) or not re.fullmatch('[a-h][1-8][a-h][1-8][qrbn]?', move) or move in seen:
                    raise ValueError('Nước giải bài tập không hợp lệ hoặc trùng.')
                seen.add(move)
                parsed = chess.Move.from_uci(move)
                if parsed not in position.legal_moves:
                    raise ValueError('Lời giải chứa nước đi không hợp lệ.')
                next_position = position.copy(stack=False)
                next_position.push(parsed)
                stack.append((next_position, node['next'], depth + 1))
    return len(data)
