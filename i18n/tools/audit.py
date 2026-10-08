#!/usr/bin/env python3
"""Finds strings in the Cave Survey add-on that cannot be translated yet.

    python3 tools/audit.py [--src DIR] [--only KIND,...] [--fail]

Reads the add-on, never writes it. Reports four kinds of finding:

  UNWRAPPED  a UI call given a bare "literal" -- lupdate never sees it
  DYNAMIC    qsTr(variable) -- lupdate cannot extract a non-literal
  CONCAT     translated fragments joined with + -- word order is fixed
             to English; use qsTr("... %1 ...").arg(x) instead
  NUMBER     parseFloat/Number on a widget's text -- "12,5" typed in a
             comma-decimal locale reads as 12, silently

A line carrying the comment  i18n-ok  is skipped (deliberately English,
e.g. a command alias or a tag key that must never change).

--fail exits 1 when any UNWRAPPED or DYNAMIC finding remains, so the same
script can guard the add-on's test suite once the backlog is cleared.
"""
import argparse
import bisect
import os
import re
import signal
import sys

signal.signal(signal.SIGPIPE, signal.SIG_DFL)   # quiet when piped to head

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LIT = r'''(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')'''

# Calls whose FIRST argument is text a user reads.
UI_FIRST = [
    "setText", "setToolTip", "setStatusTip", "setWindowTitle",
    "setPlaceholderText", "setTitle", "setWhatsThis", "addItem",
    "setCommandPrompt", "setLeftMouseTip", "setRightMouseTip",
    "handleUserMessage", "handleUserWarning", "handleUserInfo",
    "handleUserCommand",
    "QLabel", "QPushButton", "QCheckBox", "QRadioButton", "QGroupBox",
    "QToolButton", "QAction", "RGuiAction",
]
# Calls whose SECOND argument is text (tab titles, message box titles).
UI_SECOND = ["addTab", "insertTab", "setTabText",
             "information", "warning", "critical", "question"]

RE_FIRST = re.compile(r'\b(?:new\s+)?(%s)\(\s*(%s)(\s*,)?' % ("|".join(UI_FIRST), LIT))
# A lone identifier followed by a comma is a widget's objectName handed to a
# helper -- SketchScans.setText("sketchButton", qsTr(...)) -- not UI text.
IDENT = re.compile(r'^[A-Za-z_]\w*$')
RE_SECOND = re.compile(r'\b(%s)\(\s*[^,()]+,\s*(%s)' % ("|".join(UI_SECOND), LIT))
# Property assignments the bridge exposes: dlg.windowTitle = "Declination".
RE_PROP = re.compile(r'\.(windowTitle|toolTip|statusTip|placeholderText|'
                     r'text|title|plainText|whatsThis)\s*=\s*(%s)' % LIT)
RE_DYNAMIC = re.compile(r'\bqsTr\(\s*(?!["\'])([^)]*)\)')
RE_CONCAT = re.compile(r'qsTr\(%s\)\s*\+|\+\s*qsTr\(' % LIT)
RE_WRAPPED = re.compile(r'qsTr\(\s*%s(?:\s*\+\s*%s)*' % (LIT, LIT))
RE_SANDWICH = re.compile(r'qsTr\(%s\)\s*\+\s*[^"\'\s+][^+]*\+\s*qsTr\(' % LIT)
RE_NUMBER = re.compile(r'\b(?:parseFloat|parseInt|Number)\(\s*[\w.\[\]]*\.(?:text|displayText|currentText)\b')
LETTERS = re.compile(r'[A-Za-z]{2,}')


def has_words(literal):
    return bool(LETTERS.search(literal[1:-1]))


def scan_line(line):
    code = line.split("//", 1)[0] if "i18n-ok" not in line else ""
    if not code.strip():
        return
    for m in RE_FIRST.finditer(code):
        if m.group(3) and IDENT.match(m.group(2)[1:-1]):
            continue
        if has_words(m.group(2)):
            yield "UNWRAPPED", m.group(1)
    for m in RE_PROP.finditer(code):
        if has_words(m.group(2)):
            yield "UNWRAPPED", m.group(1)
    for m in RE_SECOND.finditer(code):
        if has_words(m.group(2)):
            yield "UNWRAPPED", m.group(1)
    for m in RE_DYNAMIC.finditer(code):
        yield "DYNAMIC", m.group(1).strip()[:40]
    if RE_CONCAT.search(code):
        # only when words sit OUTSIDE the qsTr -- "\n\n" + qsTr(...) is fine
        # and a value sandwiched between two translated halves is the
        # classic glued sentence: qsTr("Found ") + n + qsTr(" stations")
        rest = RE_WRAPPED.sub("", code)
        if (RE_SANDWICH.search(code) or
                any(has_words(m.group(0)) for m in re.finditer(LIT, rest))):
            yield "CONCAT", ""
    if RE_NUMBER.search(code):
        yield "NUMBER", ""


# PROSE: any string literal that reads like a sentence and is not inside a
# qsTr(...) call -- the check that catches messages assembled in variables
# and helpers, which the per-line UI-call patterns above never see.
PROSE_TEXT = re.compile(r'[A-Za-z]{2,}\s|\s[A-Za-z]{2,}')
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^")
QUIET_CALLS = ("print", "qDebug", "qWarning", "debug", "include", "require",
               "getCustomProperty", "setCustomProperty", "get", "set",
               "getNumber", "indexOf", "match", "replace", "split")


def js_literals(code):
    """Yields (offset, literal text incl. quotes, enclosing call names) for
    every string literal, skipping comments and regex literals."""
    i, n = 0, len(code)
    stack = []            # names of the calls whose '(' is open
    last = ""             # last significant char, for regex detection
    word = ""
    while i < n:
        c = code[i]
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            j = code.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = code.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and (last in REGEX_BEFORE or last == "" or word == "return"):
            j = i + 1
            while j < n and code[j] != "/" and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            i = j + 1
            last, word = "/", ""
            continue
        if c in "\"'":
            j = i + 1
            while j < n and code[j] != c and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            yield i, code[i:j + 1], list(stack)
            i = j + 1
            last, word = c, ""
            continue
        if c.isalnum() or c in "_$":
            joined = i > 0 and (code[i - 1].isalnum() or code[i - 1] in "_$")
            word = word + c if joined else c
            last = c
        elif c == "(":
            stack.append(word)
            last, word = c, ""
        elif c == ")":
            if stack:
                stack.pop()
            last, word = c, ""
        elif not c.isspace():
            last, word = c, ""
        i += 1


def scan_prose(text):
    lines = text.split("\n")
    starts = [0]
    for l in lines:
        starts.append(starts[-1] + len(l) + 1)
    for off, lit, calls in js_literals(text):
        body = lit[1:-1]
        if not PROSE_TEXT.search(body):
            continue
        if "qsTr" in calls or "translate" in calls or "QT_TR_NOOP" in calls:
            continue
        if calls and calls[-1] in QUIET_CALLS:
            continue
        ln = bisect.bisect_right(starts, off)
        line = lines[ln - 1]
        if "i18n-ok" in line or re.match(r'\s*throw\b', line):
            continue
        yield ln, line


def scan(src, prose=False, only_file=""):
    root = os.path.join(src, "scripts", "CaveSurvey")
    for dirpath, _, files in sorted(os.walk(root)):
        for name in sorted(files):
            if not name.endswith(".js"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, src)
            if only_file and only_file not in rel:
                continue
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
            for n, line in enumerate(text.split("\n"), 1):
                for kind, what in scan_line(line):
                    yield kind, rel, n, what, line.strip()
            if prose:
                for n, line in scan_prose(text):
                    yield "PROSE", rel, n, "", line.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.environ.get(
        "TOOLS_SRC", os.path.join(HERE, "..", "cave-survey")))
    ap.add_argument("--only", default="")
    ap.add_argument("--fail", action="store_true")
    ap.add_argument("--prose", action="store_true",
                    help="also list sentence-like literals outside qsTr")
    ap.add_argument("--file", default="", help="only files whose path contains this")
    args = ap.parse_args()

    only = set(k for k in args.only.upper().split(",") if k)
    counts = {}
    for kind, rel, n, what, text in scan(args.src, args.prose, args.file):
        counts[kind] = counts.get(kind, 0) + 1
        if not only or kind in only:
            print("%-9s %s:%d  %s" % (kind, rel, n, text[:110]))

    print("\n" + "  ".join("%s=%d" % (k, counts.get(k, 0))
                           for k in ("UNWRAPPED", "DYNAMIC", "CONCAT", "NUMBER")) +
          ("  PROSE=%d" % counts.get("PROSE", 0) if args.prose else ""))
    if args.fail and (counts.get("UNWRAPPED") or counts.get("DYNAMIC")):
        sys.exit(1)


if __name__ == "__main__":
    main()
