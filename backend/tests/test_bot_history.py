"""Regression tests for persistent local bot-game history."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from services import bot_history

class BotHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch("db.DB_PATH", Path(self.tmp.name) / "app.db")
        self.db_patch.start()
        self.game = dict(id="test-game", started_at="2026-10-07T03:00:00Z", opponent="Bot",
                         realm="Luyện Khí", user_color="w", result="*", reason="Đang luận kiếm",
                         pgn="1. e4 *", plies=1)

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_moves_update_same_game_and_survive_new_connections(self):
        bot_history.save(self.game)
        self.game.update(pgn="1. e4 e5 *", plies=2)
        bot_history.save(self.game)
        self.assertEqual(bot_history.listing()["total"], 1)
        self.assertEqual(bot_history.get("test-game")["plies"], 2)

    def test_result_and_undo_replace_snapshot(self):
        bot_history.save(dict(self.game, result="0-1", reason="Chấp thua"))
        self.assertEqual(bot_history.get("test-game")["result"], "0-1")
        bot_history.save(self.game)
        self.assertEqual(bot_history.get("test-game")["result"], "*")

    def test_empty_missing_and_pagination(self):
        self.assertEqual(bot_history.listing()["total"], 0)
        self.assertIsNone(bot_history.get("missing"))
        for i in range(15):
            bot_history.save(dict(self.game, id="game-" + str(i)))
        self.assertEqual(len(bot_history.listing(1)["items"]), 12)
        self.assertEqual(len(bot_history.listing(2)["items"]), 3)

if __name__ == "__main__":
    unittest.main()
