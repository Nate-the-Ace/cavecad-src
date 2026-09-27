#!/usr/bin/env python3
"""Writes latest.json and a .sha256 sidecar for every file in a release dir.

    make_manifest.py [--suffix uNNN] <dist> <tools-version> <tools-commit> <platform>=<commit> ...

The updater reads latest.json to decide what to offer, and checks every
download against both the manifest hash and the sidecar.

With --suffix, every update file is also copied under a per-publish name
(CaveCAD-windows-x64-u123.zip) and latest.json points at THOSE. GitHub's
download links serve stale copies for a while after a file is replaced:
under stable names a cached manifest could pair with new bytes and fail
verification. Per-publish names never change content, and the previous
publishes' files are kept (see prunable), so even a stale manifest points
at files that exist and match. The plain names stay for manual downloads.
"""
import hashlib, json, os, re, sys
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


def versioned(name, suffix):
    """CaveCAD-windows-x64.zip -> CaveCAD-windows-x64-u42.zip."""
    if not suffix:
        return name
    for ext in (".AppImage", ".zip", ".dmg"):
        if name.endswith(ext):
            return name[:-len(ext)] + "-" + suffix + ext
    raise ValueError("no known extension: " + name)


def publish_copies(dist, suffix):
    """Copies every update file present to its per-publish name."""
    import shutil
    made = []
    for name in list(ASSETS.values()) + [TOOLS]:
        src = os.path.join(dist, name)
        if os.path.exists(src):
            dst = versioned(name, suffix)
            shutil.copyfile(src, os.path.join(dist, dst))
            made.append(dst)
    return made


_PUBLISH = re.compile(r"-u(\d+)\.(?:zip|dmg|AppImage)(?:\.sha256)?$")


def prunable(asset_names, keep=3):
    """Per-publish files older than the newest `keep` publishes."""
    ids = sorted({int(m.group(1)) for m in map(_PUBLISH.search, asset_names) if m},
                 reverse=True)
    old = set(ids[keep:])
    return [n for n in asset_names
            if _PUBLISH.search(n) and int(_PUBLISH.search(n).group(1)) in old]


def entry(dist, name):
    p = os.path.join(dist, name)
    return {"asset": name, "sha256": sha256(p), "size": os.path.getsize(p)}


def build(dist, tools_version, tools_commit, app_commits, published=None, suffix=None):
    tools = entry(dist, versioned(TOOLS, suffix))
    tools.update({"version": tools_version, "commit": tools_commit})
    platforms = {}
    for plat, name in ASSETS.items():
        name = versioned(name, suffix)
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
    args = sys.argv[1:]
    suffix = None
    if args and args[0] == "--suffix":
        suffix, args = args[1], args[2:]
    if args and args[0] == "--prunable":
        # names on stdin, one per line; prints the ones to delete
        print("\n".join(prunable([l.strip() for l in sys.stdin if l.strip()])))
        sys.exit(0)
    dist, version, commit = args[0:3]
    commits = dict(a.split("=", 1) for a in args[3:])
    if suffix:
        publish_copies(dist, suffix)
    write(dist, build(dist, version, commit, commits, suffix=suffix))
