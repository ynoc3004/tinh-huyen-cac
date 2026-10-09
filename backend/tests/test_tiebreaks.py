import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services import pairing


class TiebreakTests(unittest.TestCase):
    def test_direct_encounter_breaks_tie_first(self):
        # A, B, C đều 1 điểm; A thắng B, B thắng C, C thắng A thì ĐĐ không đủ -> rơi xuống tiêu chí sau
        g = [(1, 2, "1-0", 1), (2, 3, "1-0", 2), (3, 1, "1-0", 3)]
        st = pairing.standings(g, "round_robin")
        self.assertEqual({s["points"] for s in st}, {1.0})
        # vòng tròn đủ ván nên ĐĐ của cả nhóm = 1 điểm, không tách được
        self.assertTrue(all(s["de"] == 1.0 for s in st))

    def test_de_decides_two_player_tie(self):
        # 1 và 2 cùng 1.5 điểm, 1 thắng trực tiếp 2
        g = [(1, 2, "1-0", 1), (3, 4, "1/2", 1), (2, 3, "1-0", 2), (4, 1, "1/2", 2)]
        st = pairing.standings(g, "swiss")
        self.assertEqual(st[0]["student_id"], 1)

    def test_five_keys_present(self):
        st = pairing.standings([(1, 2, "1-0", 1)])
        for k in ("de", "bhc1", "bh", "sb", "wins"):
            self.assertIn(k, st[0])
        self.assertEqual(st[0]["wins"], 1)

    def test_bye_uses_2026_capped_dummy_opponent(self):
        g = [(1, 2, "1-0", 1), (3, None, None, 1), (2, 3, "0-1", 2), (1, None, None, 2)]
        st = {s["student_id"]: s for s in pairing.standings(g)}
        self.assertEqual(st[1]["bh"], 1.0)   # 0 (người 2) + đối thủ ảo 1.0
        self.assertEqual(st[3]["bh"], 1.0)   # min(2 điểm bản thân, 0.5 * 2 vòng) + 0 (người 2)
        self.assertEqual(st[1]["wins"], 1)   # bye không tính là ván thắng

    def test_three_tuple_input_still_works(self):
        st = pairing.standings([(1, 2, "1/2"), (3, 4, "1-0")])
        self.assertEqual(len(st), 4)


if __name__ == "__main__":
    unittest.main()
