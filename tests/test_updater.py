import unittest
from studyflow.services.updater import is_newer, version_parts, verified_download
from pathlib import Path


class UpdaterTests(unittest.TestCase):
    def test_versions(self):
        self.assertTrue(is_newer("v0.2.0", "0.1.9"))
        self.assertFalse(is_newer("v0.1.0", "0.1.0"))
        self.assertFalse(is_newer("v0.1.0", "0.2.0"))
        self.assertEqual(version_parts("1.2.3"), (1, 2, 3))

    def test_reject_untrusted_url(self):
        with self.assertRaises(ValueError):
            verified_download("https://example.com/evil.exe", "0" * 64, Path("bad.exe"))

    def test_reject_invalid_checksum(self):
        with self.assertRaises(ValueError):
            verified_download("https://github.com/07xh/StudyFlow/releases/download/v1/app.exe", "invalid", Path("bad.exe"))


if __name__ == "__main__":
    unittest.main()
