import io, os, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from services import vault


def enc(key, data, step=7000):
    out = io.BytesIO()
    e = vault.Encryptor(key, out)
    for i in range(0, len(data), step):
        e.write(data[i:i + step])
    e.finish()
    return out.getvalue()


def dec(key, blob):
    return b"".join(vault.decrypt_iter(key, io.BytesIO(blob)))


class VaultCryptoTests(unittest.TestCase):
    def setUp(self):
        self.key = os.urandom(32)

    def test_roundtrip_sizes(self):
        for n in (0, 1, 100, vault.CHUNK - 1, vault.CHUNK, vault.CHUNK + 1, 2 * vault.CHUNK, 2 * vault.CHUNK + 5):
            data = os.urandom(n)
            blob = enc(self.key, data, step=300000)
            self.assertEqual(dec(self.key, blob), data, n)

    def test_ciphertext_hides_plaintext(self):
        blob = enc(self.key, b"khai cuoc co vua " * 100)
        self.assertNotIn(b"khai cuoc", blob)

    def test_tamper_truncate_and_wrong_key_detected(self):
        data = os.urandom(2 * vault.CHUNK + 10)
        blob = enc(self.key, data, step=500000)
        bad = bytearray(blob); bad[100] ^= 1
        with self.assertRaises(ValueError): dec(self.key, bytes(bad))
        with self.assertRaises(ValueError): dec(self.key, blob[: 12 + vault.CHUNK + vault.TAG])  # cắt đúng ranh giới khối
        with self.assertRaises(ValueError): dec(os.urandom(32), blob)
        with self.assertRaises(ValueError): dec(self.key, b"not a vault file")

    def test_password_wrap_and_change(self):
        meta, dk = vault.create_meta("mat-khau-dai-1")
        self.assertEqual(vault.unlock_meta(meta, "mat-khau-dai-1"), dk)
        with self.assertRaises(vault.WrongPassword): vault.unlock_meta(meta, "sai-mat-khau")
        meta2 = vault.rewrap_meta(meta, dk, "mat-khau-moi-22")
        self.assertEqual(vault.unlock_meta(meta2, "mat-khau-moi-22"), dk)
        with self.assertRaises(vault.WrongPassword): vault.unlock_meta(meta2, "mat-khau-dai-1")

    def test_meta_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / ".thc-vault.json"
            self.assertIsNone(vault.read_meta(p))
            meta, _ = vault.create_meta("abcdefgh")
            vault.write_meta(p, meta)
            self.assertEqual(vault.read_meta(p), meta)


if __name__ == "__main__":
    unittest.main()
