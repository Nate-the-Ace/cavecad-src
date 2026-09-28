#!/usr/bin/env python3
"""Writes the Send Feedback endpoint and key into FeedbackConfig.js from
the FEEDBACK_ENDPOINT / FEEDBACK_KEY environment (GitHub Actions secrets),
before the build compiles scripts into the binary. Without both, the
placeholders stay and the build can only save reports, not send them.

    python3 tools/inject_feedback_config.py [path/to/FeedbackConfig.js]
"""
import os
import re
import sys
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "scripts/Help/SendFeedback/FeedbackConfig.js"

ENDPOINT_RE = re.compile(r'https://script\.google\.com/[^\s"\\]+')
KEY_RE = re.compile(r'[^\s"\\]+')


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    endpoint = os.environ.get("FEEDBACK_ENDPOINT", "").strip()
    key = os.environ.get("FEEDBACK_KEY", "").strip()
    if not endpoint or not key:
        print("::warning::Send Feedback secrets not set; this build cannot send reports")
        return 0
    if not ENDPOINT_RE.fullmatch(endpoint):
        print("Send Feedback: FEEDBACK_ENDPOINT is not a safe Apps Script URL", file=sys.stderr)
        return 1
    if not KEY_RE.fullmatch(key):
        print("Send Feedback: FEEDBACK_KEY must not contain quotes, backslashes, or whitespace", file=sys.stderr)
        return 1
    text = path.read_text(encoding="utf-8")
    if "@@FEEDBACK_ENDPOINT@@" not in text or "@@FEEDBACK_KEY@@" not in text:
        print("Send Feedback: placeholders missing from %s" % path, file=sys.stderr)
        return 1
    text = text.replace("@@FEEDBACK_ENDPOINT@@", endpoint).replace("@@FEEDBACK_KEY@@", key)
    path.write_text(text, encoding="utf-8")
    print("Send Feedback: endpoint configured")
    return 0


if __name__ == "__main__":
    sys.exit(main())
