#!/usr/bin/env python3
"""Bridge protocol tests. Run by test_protocol.sh against a headless CaveCAD
serving via bridge/tests/harness_serve.js. Stdlib only.

Every assertion checks a specific value a broken bridge could not produce.
"""

import json
import socket
import sys
import time
from pathlib import Path


def wait_for_port_file(state_dir: Path, timeout: float = 15.0) -> int:
    deadline = time.time() + timeout
    port_file = state_dir / "CsMcpBridge.port"
    while time.time() < deadline:
        if port_file.exists():
            info = json.loads(port_file.read_text())
            assert info["bridge"] == "0.1.0", info
            assert isinstance(info["port"], int) and info["port"] > 0, info
            return info["port"]
        time.sleep(0.1)
    raise SystemExit(f"FAIL: no port file at {port_file} after {timeout}s")


def recv_line(sock: socket.socket) -> dict:
    buf = b""
    while not buf.endswith(b"\n"):
        chunk = sock.recv(65536)
        if not chunk:
            raise SystemExit("FAIL: bridge closed connection mid-response")
        buf += chunk
    return json.loads(buf)


def call(sock: socket.socket, req: dict) -> dict:
    sock.sendall((json.dumps(req) + "\n").encode("utf-8"))
    return recv_line(sock)


failures = 0


def check(name: str, cond: bool, detail=""):
    global failures
    if cond:
        print(f"ok    {name}")
    else:
        failures += 1
        print(f"FAIL  {name} -- {detail}")


def main():
    state_dir = Path(sys.argv[1])
    port = wait_for_port_file(state_dir)

    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.settimeout(10)

        r = call(s, {"id": 1, "op": "ping"})
        info = json.loads(r["result"])
        check("ping ok", r["ok"] is True and r["id"] == 1, r)
        check("ping app", info["app"] == "CaveCAD", info)
        check("ping headless", info["headless"] is True, info)
        check("ping appVersion", info["appVersion"] == "3.33.0", info)

        r = call(s, {"id": 2, "op": "eval", "script": "1+1"})
        check("eval arithmetic", r["ok"] is True and r["result"] == "2", r)

        r = call(s, {"id": 3, "op": "eval", "script": "({a:[1,2],s:'x'})"})
        check("eval object serialized",
              r["ok"] is True and json.loads(r["result"]) == {"a": [1, 2], "s": "x"}, r)

        r = call(s, {"id": 4, "op": "eval", "script": "typeof CsMcpBridge"})
        check("eval sees bridge global", r["result"] == '"object"', r)

        r = call(s, {"id": 5, "op": "eval", "script": "csDoc()"})
        check("csDoc null headless", r["ok"] is True and r["result"] == "null", r)

        r = call(s, {"id": 6, "op": "eval", "script": "noSuchFunction()"})
        check("eval error path",
              r["ok"] is False and "ReferenceError" in r["error"], r)

        r = call(s, {"id": 7, "op": "nonsense"})
        check("unknown op", r["ok"] is False and "unknown op" in r["error"], r)

        s.sendall(b"this is not json\n")
        r = recv_line(s)
        check("bad json line", r["ok"] is False and "not valid JSON" in r["error"], r)

        # pipelining: two requests in one write, two responses in order
        s.sendall(
            (json.dumps({"id": 8, "op": "eval", "script": "'a'"}) + "\n"
             + json.dumps({"id": 9, "op": "eval", "script": "'b'"}) + "\n").encode())
        r8 = recv_line(s)
        r9 = recv_line(s)
        check("pipelined order",
              r8["id"] == 8 and r8["result"] == '"a"'
              and r9["id"] == 9 and r9["result"] == '"b"', (r8, r9))

        # utf-8 through the whole stack
        r = call(s, {"id": 10, "op": "eval", "script": "'café ✓'"})
        check("utf8 roundtrip", r["result"] == '"café ✓"', r)

        # screenshot must refuse cleanly headless, not crash
        r = call(s, {"id": 11, "op": "screenshot"})
        check("screenshot headless refusal",
              r["ok"] is False and "main window" in r["error"], r)

    # second connection: bridge must accept more than one client over its life
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s2:
        s2.settimeout(10)
        r = call(s2, {"id": 12, "op": "eval", "script": "2*21"})
        check("second connection", r["ok"] is True and r["result"] == "42", r)

    print(f"### {('PROTOCOL OK' if failures == 0 else 'PROTOCOL FAILURES')}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
