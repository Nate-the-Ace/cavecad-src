"""Session log (src/core/RSessionLog): run CaveCAD headless and inspect
the files it leaves. Needs a built binary: debug/CaveCAD.app, or CAVECAD.

    python3 -m unittest tests.test_session_log -v
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def binary():
    for c in (os.environ.get("CAVECAD", ""),
              str(REPO / "debug/CaveCAD.app/Contents/MacOS/CaveCAD"),
              "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"):
        if c and os.access(c, os.X_OK):
            return c
    raise unittest.SkipTest("no CaveCAD binary; set CAVECAD")


def launch(log_dir, count=1, cap=None, script="tests/sessionlog/emit.js", extra=()):
    env = dict(os.environ, CAVECAD_LOG_DIR=str(log_dir))
    if cap is not None:
        env["CAVECAD_LOG_CAP"] = str(cap)
    if sys.platform.startswith("linux"):
        env.setdefault("QT_QPA_PLATFORM", "offscreen")
    out = subprocess.run(
        [binary(), "-no-dock-icon", "-no-gui", "-allow-multiple-instances",
         "-autostart", str(REPO / script), str(REPO), str(count), *extra],
        env=env, capture_output=True, text=True, timeout=120)
    return out.stdout


def logs(d):
    return sorted(p for p in Path(d).glob("session-*.log"))


class TestSessionLog(unittest.TestCase):
    def test_header_and_flushed_crumb(self):
        with tempfile.TemporaryDirectory() as d:
            out = launch(d)
            self.assertIn("SESSIONLOG OK", out)
            files = logs(d)
            self.assertEqual(1, len(files))
            text = files[0].read_text(encoding="utf-8")
            self.assertTrue(text.startswith("# CaveCAD "), text[:80])
            self.assertRegex(text, r"\n\d\d:\d\d:\d\d\.\d{3} W \[crumb\] probe 0\n")

    def test_keeps_five(self):
        with tempfile.TemporaryDirectory() as d:
            for _ in range(6):
                launch(d)
            self.assertEqual(5, len(logs(d)))

    def test_cap_halves_and_keeps_header(self):
        with tempfile.TemporaryDirectory() as d:
            launch(d, count=500, cap=4096)
            path = logs(d)[-1]
            text = path.read_text(encoding="utf-8")
            self.assertLessEqual(path.stat().st_size, 4096 + 200)
            self.assertTrue(text.startswith("# CaveCAD "))
            self.assertTrue(text.rstrip("\n").endswith("[crumb] probe 499"))

    def test_debug_lines_not_written(self):
        with tempfile.TemporaryDirectory() as d:
            launch(d)
            self.assertNotIn("debug-probe", logs(d)[-1].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
