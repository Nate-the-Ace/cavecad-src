#!/usr/bin/env python3
"""Proves a built .qm actually translates inside CaveCAD.

    python3 tools/smoke.py build/CaveSurvey_de.qm ts/CaveSurvey_de.ts [...]

Starts CaveCAD headless, installs the .qm the way the add-on loader does
(one QTranslator, answering for every context), then asks CaveCAD to
translate every finished entry in the given catalogs and compares the
answer with the catalog. Exits 1 on any mismatch or if CaveCAD never ran.

A catalog with nothing finished yet passes with "0 checked" -- the
pipeline is sound, there is just nothing to prove.
"""
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

BIN = os.environ.get("CAVECAD_BIN",
                     "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD")

PROBE = r"""
function main() {
    var cases = %(cases)s;
    var t = new QTranslator();
    if (!t.load(%(name)s, %(dir)s)) { print("SMOKE load-failed"); return; }
    QCoreApplication.installTranslator(t);
    var bad = 0;
    for (var i = 0; i < cases.length; ++i) {
        var c = cases[i];
        var got = RSettings.translate(c[0], c[1]);
        if (got !== c[2]) {
            ++bad;
            print("SMOKE mismatch " + JSON.stringify([c[0], c[1], got]));
        }
    }
    print("SMOKE done " + cases.length + " " + bad);
}
if (typeof(including) == 'undefined' || including === false) main();
"""


def finished(ts_paths):
    for path in ts_paths:
        for ctx in ET.parse(path).iter("context"):
            name = ctx.findtext("name")
            for msg in ctx.iter("message"):
                tr = msg.find("translation")
                if tr is None or tr.get("type") or msg.get("numerus") == "yes":
                    continue
                if (tr.text or "").strip():
                    yield name, msg.findtext("source"), tr.text


def main():
    qm, ts_paths = sys.argv[1], sys.argv[2:]
    cases = list(finished(ts_paths))
    qm = os.path.abspath(qm)
    with tempfile.TemporaryDirectory() as tmp:
        probe = os.path.join(tmp, "smoke.js")
        with open(probe, "w", encoding="utf-8") as f:
            f.write(PROBE % {
                "cases": json.dumps(cases),
                "name": json.dumps(os.path.splitext(os.path.basename(qm))[0]),
                "dir": json.dumps(os.path.dirname(qm)),
            })
        out = subprocess.run(
            [BIN, "-no-dock-icon", "-no-gui", "-allow-multiple-instances",
             "-autostart", probe],
            capture_output=True, text=True, timeout=120).stdout
    lines = [l for l in out.splitlines() if l.startswith("SMOKE")]
    for l in lines:
        if not l.startswith("SMOKE done"):
            print(l)
    done = [l for l in lines if l.startswith("SMOKE done")]
    if not done:
        print("smoke: CaveCAD produced no result")
        sys.exit(1)
    _, _, n, bad = done[0].split()
    print("smoke: %s checked, %s wrong" % (n, bad))
    sys.exit(1 if int(bad) else 0)


if __name__ == "__main__":
    main()
