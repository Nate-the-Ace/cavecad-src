"""Send Feedback's endpoint and key reach builds from CI secrets only.

    python3 -m unittest tests.test_feedback_config -v
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = REPO / "scripts/Help/SendFeedback/FeedbackConfig.js"
TOOL = REPO / "tools/inject_feedback_config.py"


def run(env, path):
    e = {k: v for k, v in os.environ.items() if not k.startswith("FEEDBACK_")}
    e.update(env)
    return subprocess.run([sys.executable, str(TOOL), str(path)], env=e, capture_output=True, text=True)


class TestFeedbackConfig(unittest.TestCase):
    def test_repo_holds_placeholders_only(self):
        text = CONFIG.read_text(encoding="utf-8")
        self.assertIn('ENDPOINT: "@@FEEDBACK_ENDPOINT@@"', text)
        self.assertIn('KEY: "@@FEEDBACK_KEY@@"', text)
        self.assertNotIn("script.google.com", text)

    def test_injects(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/macros/s/X/exec", "FEEDBACK_KEY": "sekret"}, p)
            self.assertEqual(0, r.returncode, r.stderr)
            text = p.read_text(encoding="utf-8")
            self.assertIn('"https://script.google.com/macros/s/X/exec"', text)
            self.assertIn('"sekret"', text)
            self.assertNotIn("sekret", r.stdout + r.stderr)

    def test_missing_secret_keeps_placeholders(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/x"}, p)
            self.assertEqual(0, r.returncode)
            self.assertEqual(CONFIG.read_text(encoding="utf-8"), p.read_text(encoding="utf-8"))
            self.assertIn("::warning::", r.stdout + r.stderr)

    def test_refuses_other_hosts(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://evil.example/x", "FEEDBACK_KEY": "k"}, p)
            self.assertEqual(1, r.returncode)

    def test_refuses_key_with_quote(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/x", "FEEDBACK_KEY": 'ke"y'}, p)
            self.assertEqual(1, r.returncode)

    def test_refuses_key_with_newline(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/x", "FEEDBACK_KEY": "ke\ny"}, p)
            self.assertEqual(1, r.returncode)

    def test_refuses_endpoint_with_quote(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            shutil.copy(CONFIG, p)
            r = run({
                "FEEDBACK_ENDPOINT": 'https://script.google.com/x";alert(1);//',
                "FEEDBACK_KEY": "k",
            }, p)
            self.assertEqual(1, r.returncode)

    def test_refuses_when_placeholders_missing(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.js"
            p.write_text("var FeedbackConfig = { ENDPOINT: \"x\", KEY: \"y\" };", encoding="utf-8")
            r = run({"FEEDBACK_ENDPOINT": "https://script.google.com/x", "FEEDBACK_KEY": "k"}, p)
            self.assertEqual(1, r.returncode)


if __name__ == "__main__":
    unittest.main()
