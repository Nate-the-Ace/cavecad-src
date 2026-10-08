#!/usr/bin/env python3
"""Record one Handbook clip from its scenario, end to end.

    .venv/bin/python tools/demo/run.py check-map

Needs CaveCAD running with the CsMcpBridge add-on (see bridge/install.sh).
Loads CsDemo.js and scenarios/<id>.js into the live app, runs the take,
waits for it, then composes the cursor in and writes
docs/handbook/images/<scenario gif name>.

The app's own panel is filmed (floated for the take, then put back) over a
fresh copy of ~/Library/Application Support/QCAD/CaveCAD/demo/Source.dxf,
opened in its own tab and closed after. Never records the map canvas.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
STATE = os.path.expanduser("~/Library/Application Support/QCAD/CaveCAD")


def port():
    try:
        return json.load(open(os.path.join(STATE, "CsMcpBridge.port")))["port"]
    except (OSError, ValueError, KeyError):
        return 42283


def call(script, timeout=30, retries=3):
    req = {"id": 1, "op": "eval", "script": script}
    buf = b""
    for attempt in range(retries):
        try:
            with socket.create_connection(("127.0.0.1", port()), timeout=5) as s:
                s.settimeout(timeout)
                s.sendall((json.dumps(req) + "\n").encode())
                buf = b""
                while not buf.endswith(b"\n"):
                    chunk = s.recv(65536)
                    if not chunk:
                        raise RuntimeError("bridge closed mid-response")
                    buf += chunk
            break
        except socket.timeout:
            # the GUI thread is busy (a frame grab, a panel rebuild):
            # that is "still working", so wait and ask again
            if attempt == retries - 1:
                raise
    r = json.loads(buf)
    if not r.get("ok"):
        raise RuntimeError("bridge error: %s" % r.get("error"))
    return r.get("result", "")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sid = sys.argv[1]
    scen = os.path.join(HERE, "scenarios", sid + ".js")
    if not os.path.exists(scen):
        sys.exit("no scenario: " + scen)
    out = tempfile.mkdtemp(prefix="clip-" + sid + "-")
    source = os.path.join(STATE, "demo", "Source.dxf")
    if not os.path.exists(source):
        sys.exit("no source drawing at %s -- copy a drawing there first" % source)
    fresh = os.path.join(tempfile.mkdtemp(prefix="clipdoc-"), "Demo.dxf")
    shutil.copy(source, fresh)
    # A scenario that needs scans names the folders it wants in a header
    # comment (// demo-scans: 2024 Scans/4-6-24 Survey Scans). They are
    # COPIED beside the temp drawing, never linked: selecting a scan can
    # write previews and page splits next to the original, and the real
    # cave folder lives on Google Drive.
    import re
    wanted = re.findall(r"^// demo-scans: (.+)$", open(scen).read(), re.M)
    if wanted:
        src_root = open(os.path.join(STATE, "demo", "ScansSource.txt")).read().strip()
        for rel in wanted:
            rel = rel.strip()
            dest = os.path.join(os.path.dirname(fresh), "scans", rel)
            shutil.copytree(os.path.join(src_root, rel), dest,
                            ignore=shutil.ignore_patterns(".DS_Store"))
    call(open(os.path.join(HERE, "CsDemo.js")).read())
    call(open(scen).read())
    call("CsDemo.openFresh(%s); 'opened'" % json.dumps(fresh), timeout=180)
    try:
        text = open(scen).read()
        if re.search(r"^\s*modal: true", text, re.M):
            starter = "startModal"
        elif re.search(r"^\s*canvas: true", text, re.M):
            starter = "startCanvas"
        else:
            starter = "start"
        call("CsDemo.%s(CsDemoScenario, %s); 'started'" %
             (starter, json.dumps(out)), timeout=240)
    except Exception:
        # setup refused or threw: the temp tab must not outlive the take
        call("CsDemo.closeFresh(); 'closed'")
        raise
    t0 = time.time()
    while True:
        time.sleep(2)
        # a frame grab keeps the GUI thread busy for seconds at a time: a
        # poll that times out means "still working", not "failed"
        try:
            st = json.loads(json.loads(call("JSON.stringify(CsDemo.state)", timeout=120)))
        except socket.timeout:
            continue
        if st.get("error"):
            call("CsDemo.closeFresh(); 'closed'")
            sys.exit("take failed: " + st["error"])
        if st.get("done"):
            break
        if time.time() - t0 > 900:
            sys.exit("take timed out")
    call("CsDemo.closeFresh(); 'closed'")
    gif = json.loads(json.loads(call("JSON.stringify({g: CsDemoScenario.gif, w: CsDemoScenario.width || 380})")))
    dest = os.path.join(REPO, "docs", "handbook", "images", gif["g"])
    py = os.path.join(REPO, ".venv", "bin", "python")
    subprocess.check_call([py, os.path.join(HERE, "compose.py"), out, dest,
                           "--width", str(gif["w"])])
    print("frames kept in", out)


main()
