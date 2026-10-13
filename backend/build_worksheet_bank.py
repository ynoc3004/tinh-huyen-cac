"""Enrich an existing worksheet bank with opening tags and underrepresented topics.

Usage: python build_worksheet_bank.py --file lichess_db_puzzle.csv.zst
Keeps existing IDs/positions and adds only legal, unique, well-rated Lichess puzzles.
"""
import argparse
from collections import Counter
import csv
import gzip
import json
from pathlib import Path

import chess
from services.puzzles import _open_text
from services.worksheets import LEVELS, Exercise, validate_exercise
from services.worksheet_themes import THEMES, theme_keys


def build(source, destination, target=96, per_level=24):
    with gzip.open(destination, 'rt', encoding='utf-8') as stream:
        bank = json.load(stream)
    originals = {row['id']: row for row in bank}
    matched = set()
    with _open_text(source) as stream:
        for row in csv.DictReader(stream):
            old = originals.get(row.get('PuzzleId'))
            if old is not None and row.get('OpeningTags') is not None:
                old['opening_tags'] = row['OpeningTags']
                old['plays'] = int(row['NbPlays'])
                matched.add(old['id'])
    if len(matched) != len(originals):
        raise ValueError(f"Source missing {len(originals) - len(matched)} existing IDs; bank unchanged")
    counts, bands, positions = Counter(), [Counter() for _ in LEVELS], set()

    def level(rating):
        return next((i for i, band in enumerate(LEVELS) if band['min'] <= rating <= band['max']), None)

    def account(row):
        keys = theme_keys(row['themes'], row.get('opening_tags', '')) & THEMES.keys()
        counts.update(keys)
        index = level(row['rating'])
        if index is not None:
            bands[index].update(keys)

    for row in bank:
        board = chess.Board(row['fen']);board.push_uci(row['moves'][0])
        positions.add(' '.join(board.fen().split()[:4]))
        account(row)
    rejected = 0
    with _open_text(source) as stream:
        for row in csv.DictReader(stream):
            try:
                if row.get('PuzzleId') in originals or any(value is None for value in row.values()):
                    continue
                rating, popularity, plays = int(row['Rating']), int(row['Popularity']), int(row['NbPlays'])
                index = level(rating)
                if index is None or popularity < 85 or plays < 250:
                    continue
                keys = theme_keys(row['Themes'], row['OpeningTags']) & THEMES.keys()
                if not any(counts[key] < target or bands[index][key] < per_level for key in keys):
                    continue
                moves = row['Moves'].split()
                if not 2 <= len(moves) <= 24:
                    continue
                board = chess.Board(row['FEN']);board.push_uci(moves[0])
                position = ' '.join(board.fen().split()[:4])
                if position in positions:
                    continue
                validate_exercise(Exercise(fen=board.fen(), solution=' '.join(moves[1:])))
                record = {'id': row['PuzzleId'], 'fen': row['FEN'], 'moves': moves, 'rating': rating,
                          'themes': row['Themes'], 'popularity': popularity, 'plays': plays,
                          'url': row['GameUrl'], 'opening_tags': row['OpeningTags']}
                bank.append(record);originals[record['id']] = record;positions.add(position);account(record)
            except (ValueError, KeyError):
                rejected += 1
    payload = json.dumps(bank, ensure_ascii=False, separators=(',', ':')).encode()
    destination.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    return {'count': len(bank), 'rejected': rejected, 'themes': {key: counts[key] for key in THEMES if key}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent / 'services/worksheet_puzzles.json.gz')
    args = parser.parse_args()
    print(json.dumps(build(args.file, args.output), ensure_ascii=False, indent=2))
