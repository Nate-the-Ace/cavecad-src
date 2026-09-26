#!/usr/bin/env python3
"""Writes latest.json and a .sha256 sidecar for every file in a release dir.

    make_manifest.py <dist> <tools-version> <tools-commit> <platform>=<commit> ...

The updater reads latest.json to decide what to offer, and checks every
download against both the manifest hash and the sidecar.
"""
import hashlib, json, os, sys
from datetime import datetime, timezone

ASSETS = {
    "windows-x64": "CaveCAD-windows-x64.zip",
    "windows-arm64": "CaveCAD-windows-arm64.zip",
    "macos-arm64": "CaveCAD-macos-arm64.dmg",
    "linux-x86_64": "CaveCAD-linux-x86_64.AppImage",
    "linux-aarch64": "CaveCAD-linux-aarch64.AppImage",
}
TOOLS = "CaveSurvey-tools.zip"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def entry(dist, name):
    p = os.path.join(dist, name)
    return {"asset": name, "sha256": sha256(p), "size": os.path.getsize(p)}


def build(dist, tools_version, tools_commit, app_commits, published=None):
    tools = entry(dist, TOOLS)
    tools.update({"version": tools_version, "commit": tools_commit})
    platforms = {}
    for plat, name in ASSETS.items():
        if plat in app_commits and os.path.exists(os.path.join(dist, name)):
            e = entry(dist, name)
            e["app_commit"] = app_commits[plat]
            platforms[plat] = e
    return {"schema": 1,
            "published": published or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tools": tools, "platforms": platforms}


def write(dist, manifest):
    with open(os.path.join(dist, "latest.json"), "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    for name in sorted(os.listdir(dist)):
        if name.endswith(".sha256"):
            continue
        with open(os.path.join(dist, name + ".sha256"), "w") as f:
            f.write("%s  %s\n" % (sha256(os.path.join(dist, name)), name))


if __name__ == "__main__":
    dist, version, commit = sys.argv[1:4]
    commits = dict(a.split("=", 1) for a in sys.argv[4:])
    write(dist, build(dist, version, commit, commits))
