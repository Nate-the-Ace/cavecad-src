#!/usr/bin/env python3
"""Prints how much of one or more .ts catalogs is translated.

    python3 tools/stats.py ts/CaveSurvey_de.ts [ts/Cave3D_de.ts ...]
"""
import sys
import xml.etree.ElementTree as ET


def count(paths):
    done = total = 0
    for path in paths:
        for msg in ET.parse(path).iter("message"):
            tr = msg.find("translation")
            kind = tr.get("type") if tr is not None else None
            if kind in ("vanished", "obsolete"):
                continue
            total += 1
            if kind != "unfinished" and tr is not None and (tr.text or "").strip():
                done += 1
    return done, total


if __name__ == "__main__":
    done, total = count(sys.argv[1:])
    pct = 100.0 * done / total if total else 0.0
    print("%d/%d translated (%.0f%%)" % (done, total, pct))
