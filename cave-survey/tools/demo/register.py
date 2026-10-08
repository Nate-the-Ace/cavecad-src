#!/usr/bin/env python3
"""Put a recorded clip on its Handbook page and in the index.

    .venv/bin/python tools/demo/register.py <page id> <gif name> <caption> [--width 380]

Adds <img src="gif"> under the page's first screenshot (or under its
first paragraph when it has none) and a `shots` entry in index.json
recording the tool file the clip depicts and that file's hash, so the
staleness test treats a clip like any screenshot. Idempotent: a clip
already registered is left alone. The index is edited as TEXT, not
re-serialised, so the diff is the five lines added.
"""
import hashlib
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
IDX = os.path.join(REPO, "docs", "handbook", "index.json")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    width = "380"
    if "--width" in sys.argv:
        width = sys.argv[sys.argv.index("--width") + 1]
        args = [a for a in args if a != width]
    pid, gif, caption = args[0], args[1], args[2]
    data = json.load(open(IDX))
    page = next(p for p in data["pages"] if p["id"] == pid)
    if any(s["image"] == gif for s in page.get("shots", [])):
        print("already registered:", gif)
        return
    if page.get("shots"):
        depicts = page["shots"][0]["depicts"]
    else:
        # the tool's own file: CheckMap -> scripts/CaveSurvey/CheckMap/CheckMap.js
        tool = page["tools"][0]
        depicts = "scripts/CaveSurvey/%s/%s.js" % (tool, tool)
        if not os.path.exists(os.path.join(REPO, depicts)):
            sys.exit("cannot infer the file this clip depicts: " + depicts)
    h = hashlib.sha256(open(os.path.join(REPO, depicts), "rb").read()).hexdigest()

    lines = open(IDX).read().split("\n")
    at = next(i for i, l in enumerate(lines) if l.strip() == '"id": "%s",' % pid)
    start = next(i for i in range(at, len(lines)) if lines[i].strip().startswith('"shots": ['))
    entry = ("    {\n     \"image\": \"%s\",\n     \"depicts\": \"%s\",\n"
             "     \"hash\": \"%s\"\n    }" % (gif, depicts, h))
    if lines[start].strip() == '"shots": [],':
        lines[start] = '   "shots": [\n' + entry + "\n   ],"
    elif lines[start].strip() == '"shots": []':
        lines[start] = '   "shots": [\n' + entry + "\n   ]"
    else:
      end = next(i for i in range(start, len(lines)) if lines[i].strip() == "]")
      assert lines[end - 1].strip() == "}", lines[end - 1]
      lines[end - 1] = ("    },\n    {\n     \"image\": \"%s\",\n     \"depicts\": \"%s\",\n"
                      "     \"hash\": \"%s\"\n    }" % (gif, depicts, h))
    open(IDX, "w").write("\n".join(lines))

    pf = os.path.join(REPO, "docs", "handbook", "pages", page["file"])
    html = open(pf).read()
    block = ('\n<p><img src="%s" width="%s"><br><i>%s</i></p>' % (gif, width, caption))
    m = None
    for m in re.finditer(r'<p><img src="[^"]+\.png"[^>]*>.*?</p>', html, re.S):
        break
    if m is None:
        m = re.search(r"</p>", html)
    html = html[:m.end()] + block + html[m.end():]
    open(pf, "w").write(html)
    print("registered", gif, "on", pid)


main()
