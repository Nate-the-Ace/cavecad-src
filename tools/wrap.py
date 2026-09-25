#!/usr/bin/env python3
"""Wraps literal-only UI strings in qsTr(), in place.

    python3 tools/wrap.py FILE [FILE ...] [--write] [--calls extra,names]

Handles only the mechanical case: an argument (or property value) that is
made ENTIRELY of string literals, optionally joined with +, e.g.

    new QPushButton("Apply")                 -> new QPushButton(qsTr("Apply"))
    w.x.toolTip = "Fill every " +            -> w.x.toolTip = qsTr("Fill every " +
        "trip's estimate.";                          "trip's estimate.");

Anything mixing in a variable needs a %1 placeholder and .arg(), which is a
judgement call -- those are left alone for a person (see audit.py --prose).
Without --write it prints what it would change and touches nothing.
"""
import argparse
import re
import sys

UI_CALLS = {
    # name: which argument positions carry user text (None = all)
    "QPushButton": {0}, "QLabel": {0}, "QCheckBox": {0}, "QRadioButton": {0},
    "QGroupBox": {0}, "QToolButton": {0}, "QDockWidget": {0}, "QAction": {0},
    "QMenu": {0},
    "addAction": {0}, "addMenu": {0}, "addTab": {1}, "setTabText": {1},
    "setText": {0}, "setToolTip": {0}, "setStatusTip": {0},
    "setWindowTitle": {0}, "setPlaceholderText": {0}, "setPlainText": {0},
    "setTitle": {0}, "setWhatsThis": {0}, "showMessage": {0},
    "handleUserMessage": {0}, "handleUserWarning": {0}, "handleUserInfo": {0},
    "setCommandPrompt": {0}, "setLeftMouseTip": {0}, "setRightMouseTip": {0},
    "warning": {1, 2}, "information": {1, 2}, "question": {1, 2},
    "critical": {1, 2}, "about": {1, 2},
    "getItem": {0, 1}, "getText": {0, 1}, "getDouble": {1, 2}, "getInt": {1, 2},
    "@warning": {0}, "@information": {0}, "@question": {0},
    "getOpenFileName": {1}, "getSaveFileName": {1},
    "getExistingDirectory": {1},
}
UI_PROPS = {"toolTip", "statusTip", "placeholderText", "text", "windowTitle",
            "title", "plainText", "whatsThis", "labelText"}
WORDS = re.compile(r'[A-Za-z]{2,}')
OBJECTS = False
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^")


def tokens(code):
    """Yields ('lit', start, end) and ('p', char, pos) for parens/commas/;
    and ('w', word, pos) for identifiers. Comments and regexes skipped."""
    i, n = 0, len(code)
    last, word = "", ""
    while i < n:
        c = code[i]
        if code.startswith("//", i):
            j = code.find("\n", i)
            i = n if j < 0 else j
            continue
        if code.startswith("/*", i):
            j = code.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and (last in REGEX_BEFORE or last == "" or word == "return"):
            j = i + 1
            while j < n and code[j] not in "/\n":
                j += 2 if code[j] == "\\" else 1
            i = j + 1
            last, word = "/", ""
            continue
        if c in "\"'":
            j = i + 1
            while j < n and code[j] != c and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            yield ("lit", i, j + 1)
            i = j + 1
            last, word = c, ""
            continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (code[j].isalnum() or code[j] in "_$"):
                j += 1
            word = code[i:j]
            yield ("w", word, i)
            last = code[j - 1]
            i = j
            continue
        if c in "(),;=+.[]{}:":
            yield ("p", c, i)
        if not c.isspace():
            last = c
            if c != ".":
                word = ""
        i += 1


def plan(code):
    """Returns [(start, end)] spans of literal-only UI expressions."""
    toks = list(tokens(code))
    spans = []
    stack = []   # [call name, arg index]
    k = 0
    while k < len(toks):
        t = toks[k]
        if t[0] == "p" and t[1] == "(":
            prev = toks[k - 1] if k > 0 else None
            name = prev[1] if prev and prev[0] == "w" else ""
            # bare warning(msg) is QCAD's global, not QMessageBox.warning
            dotted = k > 1 and toks[k - 2][:2] == ("p", ".")
            if name in ("warning", "information", "question") and not dotted:
                name = "@" + name
            stack.append([name, 0])
        elif t[0] == "p" and t[1] == ")":
            if stack:
                stack.pop()
        elif t[0] == "p" and t[1] == "," and stack:
            stack[-1][1] += 1
        elif t[0] == "lit":
            # gather a run: lit (+ lit)*
            j = k
            while (j + 2 < len(toks) and toks[j + 1][:2] == ("p", "+")
                   and toks[j + 2][0] == "lit"):
                j += 2
            start, end = t[1], toks[j][2]
            before = toks[k - 1] if k > 0 else None
            after = toks[j + 1] if j + 1 < len(toks) else None
            opener = "(,=:" if OBJECTS else "(,="
            whole = (before is not None and before[0] == "p"
                     and before[1] in opener and after is not None
                     and after[0] == "p" and after[1] in "),;}")
            text = code[start:end]
            if whole and WORDS.search(re.sub(r'\\u[0-9a-fA-F]{4}|\\[nt]', ' ', text)):
                target = None
                if before[1] == ":":
                    target = "object value"
                elif before[1] == "=":
                    # x.prop = "..."
                    p1 = toks[k - 2] if k > 1 else None
                    p2 = toks[k - 3] if k > 2 else None
                    if (p1 and p1[0] == "w" and p1[1] in UI_PROPS and
                            p2 and p2[:2] == ("p", ".")):
                        target = "prop"
                elif stack:
                    name, idx = stack[-1]
                    if name in UI_CALLS and idx in UI_CALLS[name]:
                        target = name
                inside_qstr = any(s[0] in ("qsTr", "translate") for s in stack)
                line = code[code.rfind("\n", 0, start) + 1:code.find("\n", end)]
                # a lone identifier handed to a helper is an objectName:
                # SketchScans.setText("sketchButton", qsTr(...))
                ident = re.match(r'^["\'][A-Za-z_]\w*["\']$', text) and \
                    after[1] == ","
                if target and not inside_qstr and not ident and \
                        "i18n-ok" not in line:
                    spans.append((start, end))
            k = j + 1
            continue
        k += 1
    return spans


# --- mixed: "text " + x + " more" -> qsTr("text %1 more").arg(String(x)) ---

LIT_ONLY = re.compile(r'^"(?:[^"\\\n]|\\.)*"$')
STRINGY = re.compile(r'(\.toFixed\(\d*\)|^String\(.*\)|\.join\([^()]*\))$')


def split_plus(expr):
    """Top-level '+' terms of expr, or None when expr holds anything this
    rewriter must not guess about (other operators, comments, regexes,
    single-quoted strings)."""
    terms, depth, cur, i, n = [], 0, "", 0, len(expr)
    while i < n:
        c = expr[i]
        if c == '"':
            j = i + 1
            while j < n and expr[j] != '"':
                j += 2 if expr[j] == "\\" else 1
            cur += expr[i:j + 1]
            i = j + 1
            continue
        if c == "'" or expr.startswith("//", i) or expr.startswith("/*", i):
            return None
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif depth == 0 and c == "+":
            terms.append(cur.strip())
            cur = ""
            i += 1
            continue
        elif depth == 0 and c in "?:<>=!&|*/-%,":
            return None
        cur += c
        i += 1
    terms.append(cur.strip())
    return terms if all(terms) else None


def chunk(body, first, width):
    """Splits a string body at spaces: a first piece of about `first`
    characters, then pieces of about `width`."""
    out, cur = [], ""
    for word in re.split(r'(?<= )', body):
        if cur and len(cur) + len(word) > (first if not out else width):
            out.append(cur)
            cur = ""
        cur += word
    if cur:
        out.append(cur)
    return out


def rewrite_mixed(expr, indent, col):
    terms = split_plus(expr)
    if terms is None or len(terms) < 2:
        return None
    lits = [bool(LIT_ONLY.match(t)) for t in terms]
    if not any(lits) or all(lits):
        return None
    # left of the first literal, + may be numeric addition: allow at most
    # one term there, so every + that remains is string concatenation
    if lits.index(True) > 1:
        return None
    body, args = "", []
    for t, is_lit in zip(terms, lits):
        if is_lit:
            if re.search(r'%\d', t):
                return None
            body += t[1:-1]
        else:
            if '"' in t or "'" in t:
                return None     # a term with its own text: a person's call
            args.append(t if STRINGY.search(t) else "String(%s)" % t)
            body += "%" + str(len(args))
    # markup alone (an <img> tag) is not text a translator can touch
    if not WORDS.search(re.sub(r'%\d|\\[nt]|<[^>]*>', ' ', body)):
        return None
    arg_text = "".join(".arg(%s)" % a for a in args)
    one_line = 'qsTr("%s")%s' % (body, arg_text)
    if len(one_line) + col <= 78:
        return one_line
    pieces = chunk(body, max(20, 72 - col), max(30, 72 - indent))
    pad = " " * (indent + 4)
    lit = (' +\n' + pad).join('"%s"' % p for p in pieces)
    return 'qsTr(%s)\n%s%s' % (lit, pad,
                               ("\n" + pad).join(".arg(%s)" % a for a in args))


def plan_mixed(code):
    """Returns [(start, end, replacement)] for mixed UI arguments."""
    toks = list(tokens(code))
    edits = []
    stack = []   # [name, idx, arg start offset]

    def consider(name, idx, s, e):
        if name not in UI_CALLS or idx not in UI_CALLS[name]:
            return
        if any(f[0] in ("qsTr", "translate") for f in stack):
            return
        raw = code[s:e]
        lead = len(raw) - len(raw.lstrip())
        expr = raw.strip()
        if not expr or "qsTr(" in expr:
            return
        line_start = code.rfind("\n", 0, s + lead) + 1
        line = code[line_start:code.find("\n", s + lead)]
        if "i18n-ok" in code[line_start:code.find("\n", e)]:
            return
        indent = len(line) - len(line.lstrip())
        rep = rewrite_mixed(expr, indent, s + lead - line_start)
        if rep is not None:
            edits.append((s + lead, s + lead + len(expr), rep))

    for k, t in enumerate(toks):
        if t[0] != "p":
            continue
        if t[1] == "(":
            prev = toks[k - 1] if k > 0 else None
            name = prev[1] if prev and prev[0] == "w" else ""
            dotted = k > 1 and toks[k - 2][:2] == ("p", ".")
            if name in ("warning", "information", "question") and not dotted:
                name = "@" + name
            stack.append([name, 0, t[2] + 1])
        elif t[1] == "," and stack:
            f = stack[-1]
            f_copy = list(f)
            stack.pop()
            consider(f_copy[0], f_copy[1], f_copy[2], t[2])
            stack.append(f)
            f[1] += 1
            f[2] = t[2] + 1
        elif t[1] == ")" and stack:
            f = stack.pop()
            consider(f[0], f[1], f[2], t[2])
    # nested calls can yield overlapping spans: keep the outermost
    edits.sort(key=lambda x: (x[0], -x[1]))
    kept, last_end = [], -1
    for s, e, r in edits:
        if s >= last_end:
            kept.append((s, e, r))
            last_end = e
    return kept


# --- messages carried in data: { error: "..." }, out.error = "..." -------

MSG_PUSH = re.compile(r'\b(?:lines|parts|out|notes|warnings|bits|problems|'
                      r'messages|said|report|summary)\.push\(\s*')
MSG_RETURN = re.compile(r'(?<![\w$.])return\s+(?=["\w(])')
MSG_KEY = re.compile(r'(?<![\w$.])(error|warning|message|why|hint)\s*:\s*(?!:)')
MSG_ASSIGN = re.compile(r'(?:\.(?:error|warning|message)|(?<![\w$.])'
                        r'(?:lastError|errorText|msg|message))\s*=\s*(?![=>])')


def expr_end(code, i, stops):
    """Offset where the expression starting at i ends: the first char in
    `stops` at bracket depth 0, outside strings. None if a comment or a
    regex gets in the way."""
    depth, n = 0, len(code)
    while i < n:
        c = code[i]
        if c in "\"'":
            j = i + 1
            while j < n and code[j] != c:
                j += 2 if code[j] == "\\" else 1
            i = j + 1
            continue
        if code.startswith("//", i) or code.startswith("/*", i):
            return None
        if c in "([{":
            depth += 1
        elif c in ")]}":
            if depth == 0:
                return i if c in stops else None
            depth -= 1
        elif depth == 0 and c in stops:
            return i
        i += 1
    return None


def plan_messages(code, extra=()):
    edits = []
    for rx, stops in ((MSG_KEY, ",}"), (MSG_ASSIGN, ";")) + tuple(extra):
        for m in rx.finditer(code):
            s = m.end()
            # skip matches inside comments or strings: the line up to here
            ls = code.rfind("\n", 0, m.start()) + 1
            head = code[ls:m.start()]
            if "//" in head or head.lstrip().startswith("*") or \
                    head.count('"') % 2 == 1:
                continue
            e = expr_end(code, s, stops)
            if e is None:
                continue
            raw = code[s:e]
            expr = raw.rstrip()
            if not expr or "qsTr(" in expr or "i18n-ok" in code[ls:code.find("\n", e)]:
                continue
            terms = split_plus(expr)
            if terms is None:
                continue
            lits = [t for t in terms if LIT_ONLY.match(t)]
            # sentence-like only: a machine code ("no-leg") has no space
            if not any(" " in t for t in lits):
                continue
            line = code[ls:code.find("\n", s)]
            indent = len(line) - len(line.lstrip())
            if len(lits) == len(terms):
                rep = "qsTr(" + expr + ")"
            else:
                rep = rewrite_mixed(expr, indent, s - ls)
            if rep is not None:
                edits.append((s, s + len(expr), rep))
    edits.sort()
    return edits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--objects", action="store_true",
                    help="also wrap literal-only object values and ternary "
                         "branches (key: \"...\") -- ONLY on a range known "
                         "to be UI text; use with --lines")
    ap.add_argument("--lines", default="",
                    help="only spans starting within FROM-TO")
    ap.add_argument("--mixed", action="store_true",
                    help="rewrite \"text \" + x + \" more\" arguments as "
                         "qsTr(\"text %1 more\").arg(String(x))")
    ap.add_argument("--messages", action="store_true",
                    help="wrap sentence text carried as { error: ... }, "
                         "x.error = ..., lastError = ...")
    ap.add_argument("--sentences", action="store_true",
                    help="with --messages: also lines.push(...) and "
                         "return ... when the text reads as a sentence")
    ap.add_argument("--calls", default="",
                    help="extra helper names whose FIRST TWO args are UI text")
    args = ap.parse_args()
    global OBJECTS
    OBJECTS = args.objects
    lo, hi = 0, 10 ** 9
    if args.lines:
        lo, hi = (int(x) for x in args.lines.split("-"))
    for extra in filter(None, args.calls.split(",")):
        UI_CALLS[extra] = {0, 1}
    total = 0
    for path in args.files:
        code = open(path, encoding="utf-8").read()
        if args.messages:
            extra = ((MSG_PUSH, ")"), (MSG_RETURN, ";")) if args.sentences else ()
            edits = [x for x in plan_messages(code, extra)
                     if lo <= code.count("\n", 0, x[0]) + 1 <= hi]
        elif args.mixed:
            edits = [x for x in plan_mixed(code)
                     if lo <= code.count("\n", 0, x[0]) + 1 <= hi]
        else:
            edits = [(s, e, "qsTr(" + code[s:e] + ")") for s, e in plan(code)
                     if lo <= code.count("\n", 0, s) + 1 <= hi]
        total += len(edits)
        for s, e, r in edits:
            ln = code.count("\n", 0, s) + 1
            print("%s:%d  %s\n    -> %s" % (path, ln,
                  code[s:e].replace("\n", " ")[:100],
                  r.replace("\n", " ")[:140]))
        if args.write and edits:
            for s, e, r in reversed(edits):
                code = code[:s] + r + code[e:]
            open(path, "w", encoding="utf-8").write(code)
    print("%d span(s)%s" % (total, " wrapped" if args.write else " (dry run)"))


if __name__ == "__main__":
    main()
