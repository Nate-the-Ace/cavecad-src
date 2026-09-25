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
import os
import re
import sys

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
RE_DYNAMIC = re.compile(r'\bqsTr\(\s*(?!["\'])([^)]*)\)')
RE_CONCAT = re.compile(r'qsTr\(%s\)\s*\+|\+\s*qsTr\(' % LIT)
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
    for m in RE_SECOND.finditer(code):
        if has_words(m.group(2)):
            yield "UNWRAPPED", m.group(1)
    for m in RE_DYNAMIC.finditer(code):
        yield "DYNAMIC", m.group(1).strip()[:40]
    if RE_CONCAT.search(code):
        yield "CONCAT", ""
    if RE_NUMBER.search(code):
        yield "NUMBER", ""


def scan(src):
    root = os.path.join(src, "scripts", "CaveSurvey")
    for dirpath, _, files in sorted(os.walk(root)):
        for name in sorted(files):
            if not name.endswith(".js"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, src)
            with open(path, encoding="utf-8", errors="replace") as f:
                for n, line in enumerate(f, 1):
                    for kind, what in scan_line(line):
                        yield kind, rel, n, what, line.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.environ.get(
        "TOOLS_SRC", os.path.join(HERE, "..", "cavecad-tools")))
    ap.add_argument("--only", default="")
    ap.add_argument("--fail", action="store_true")
    args = ap.parse_args()

    only = set(k for k in args.only.upper().split(",") if k)
    counts = {}
    for kind, rel, n, what, text in scan(args.src):
        counts[kind] = counts.get(kind, 0) + 1
        if not only or kind in only:
            print("%-9s %s:%d  %s" % (kind, rel, n, text[:110]))

    print("\n" + "  ".join("%s=%d" % (k, counts.get(k, 0))
                           for k in ("UNWRAPPED", "DYNAMIC", "CONCAT", "NUMBER")))
    if args.fail and (counts.get("UNWRAPPED") or counts.get("DYNAMIC")):
        sys.exit(1)


if __name__ == "__main__":
    main()
