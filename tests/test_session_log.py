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
            # crumbs are emitted via qDebug (format type 'I'), not qWarning
            self.assertRegex(text, r"\n\d\d:\d\d:\d\d\.\d{3} I \[crumb\] probe 0\n")
            # a plain qWarning must still reach the log (may be quoted by
            # QDebug; only the substring is guaranteed)
            self.assertIn("warn-probe", text)

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

    def test_rotate_never_removes_current_log(self):
        with tempfile.TemporaryDirectory() as d:
            # names that sort AFTER today's session-<yyyyMMdd-...>.log, so a
            # naive "keep newest 5 by name" would evict the file this launch
            # is actively writing to. (These also outrank it in emit.js's own
            # "last by name" self-check, so we verify the real file directly
            # below instead of relying on emit.js's SESSIONLOG OK/FAIL line.)
            for i in range(1, 6):
                (Path(d) / "session-99999999-{:02d}.log".format(i)).write_text("dummy\n")
            launch(d)
            files = logs(d)
            self.assertEqual(5, len(files))
            current = [p for p in files if not p.name.startswith("session-99999999")]
            self.assertEqual(1, len(current))
            self.assertIn("[crumb] probe 0", current[0].read_text(encoding="utf-8"))

    def test_crumbs(self):
        with tempfile.TemporaryDirectory() as d:
            out = launch(d, script="tests/sessionlog/crumbs.js")
            self.assertIn("CRUMBS DONE", out)
            text = logs(d)[-1].read_text(encoding="utf-8")
            self.assertIn("[crumb] action: Crumb Probe", text)
            self.assertRegex(text, r"\[crumb\] save: .*/cc-crumbs/saved\.dxf\n")
            self.assertRegex(text, r"\[crumb\] export copy: .*/cc-crumbs/copy\.dxf\n")
            self.assertRegex(text, r"\[crumb\] undo:")
            self.assertRegex(text, r"\[crumb\] redo:")
            self.assertRegex(text, r"\[crumb\] open: .*/cc-crumbs/saved\.dxf \(1 entities\)\n")


if __name__ == "__main__":
    unittest.main()
