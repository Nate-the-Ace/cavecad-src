# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=2"]
# ///
"""CaveCAD MCP server: stdio MCP tools bridged to the CsMcpBridge add-on
running inside the live CaveCAD GUI (TCP, 127.0.0.1 only).

Register once:
    claude mcp add --scope user cavecad -- uv run <abs path>/mcp_server.py

Requires: CaveCAD running with the CsMcpBridge add-on installed and its
flag file present (see bridge/install.sh). Connections are per-call, so
this server survives CaveCAD restarts without being restarted itself.
"""

import json
import os
import socket
import tempfile

from mcp.server.mcpserver import MCPServer

STATE_DIR = os.path.expanduser("~/Library/Application Support/QCAD/CaveCAD")
PORT_FILE = os.environ.get(
    "CSMCP_PORT_FILE", os.path.join(STATE_DIR, "CsMcpBridge.port"))
DEFAULT_PORT = 42283

mcp = MCPServer("cavecad")

_next_id = 0


def _bridge_port() -> int:
    try:
        with open(PORT_FILE, encoding="utf-8") as f:
            return int(json.load(f)["port"])
    except (OSError, ValueError, KeyError):
        return DEFAULT_PORT


def _call(op: str, timeout: float = 15.0, **fields) -> str:
    global _next_id
    _next_id += 1
    request = {"id": _next_id, "op": op, **fields}
    with socket.create_connection(("127.0.0.1", _bridge_port()), timeout=5) as s:
        s.settimeout(timeout)
        s.sendall((json.dumps(request) + "\n").encode("utf-8"))
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                raise RuntimeError("bridge closed the connection mid-response")
            buf += chunk
    response = json.loads(buf)
    if not response.get("ok"):
        raise RuntimeError(f"bridge error: {response.get('error')}")
    return response.get("result", "")


@mcp.tool()
def cavecad_status() -> str:
    """Check whether the live CaveCAD GUI bridge is reachable.

    Returns JSON: app version, open document path, modified flag, headless
    flag. If it reports up=false, CaveCAD is not running or the CsMcpBridge
    add-on is not installed/enabled (run bridge/install.sh, restart CaveCAD).
    """
    try:
        return _call("ping")
    except (OSError, RuntimeError) as e:
        return json.dumps({
            "up": False,
            "error": str(e),
            "hint": ("CaveCAD not running, or CsMcpBridge not installed/"
                     "enabled -- run bridge/install.sh and restart CaveCAD."),
        })


@mcp.tool()
def cavecad_eval(script: str, timeout_s: float = 15.0) -> str:
    """Evaluate ECMAScript inside the RUNNING CaveCAD GUI engine.

    Returns the completion value serialized bridge-side: JSON where
    possible, toString() text for Qt wrapper objects. Helpers available:
    csDoc() -> live RDocument or null, csDi() -> RDocumentInterface or null.
    Never cache a document across calls. NEVER call a modal exec() -- it
    blocks the GUI until a human dismisses it; probe dialogs with show().
    Runs on the GUI thread, so widget and document access are safe.
    """
    return _call("eval", timeout=timeout_s, script=script)


@mcp.tool()
def cavecad_screenshot(widget: str = "", path: str = "") -> str:
    """Capture a PNG of the running CaveCAD GUI; returns JSON {path,width,height}.

    widget: "" = main window (viewport included), "active" = active window or
    modal dialog, anything else = objectName of a child widget of the main
    window. path: PNG destination; default is a temp file.
    """
    if not path:
        fd, path = tempfile.mkstemp(prefix="cavecad-shot-", suffix=".png")
        os.close(fd)
        os.unlink(path)
    return _call("screenshot", widget=widget, path=path)


if __name__ == "__main__":
    mcp.run()
