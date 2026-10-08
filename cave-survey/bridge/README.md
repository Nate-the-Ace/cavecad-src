# CaveCAD MCP bridge (dev only)

Lets an AI agent evaluate ECMAScript inside the **running CaveCAD GUI**,
inspect live documents/XDATA, probe widget construction, and capture
screenshots. Complements the headless harness (`tests/run_all.sh`), which
cannot see GUI-only failures (wrapper-only widgets, self-confirming message
boxes, live document interface behavior).

Design: `docs/superpowers/specs/2026-08-28-mcp-bridge-design.md`

## Pieces

- `CsMcpBridge/CsMcpBridge.js` — add-on loaded by CaveCAD at startup.
  Listens on 127.0.0.1:42283 (line-delimited JSON) **only if**
  `~/Library/Application Support/QCAD/CaveCAD/CsMcpBridge.enabled` exists.
- `mcp_server.py` — stdio MCP server (run via `uv run`). Tools:
  `cavecad_status`, `cavecad_eval`, `cavecad_screenshot`.
- `install.sh` — copies the add-on into the per-user scripts folder and
  creates the flag file. `--disable` removes the flag.
- `tests/test_protocol.sh` — exact-value protocol tests against a headless
  CaveCAD serve loop.

## Setup

```bash
./install.sh
# restart CaveCAD
claude mcp add --scope user cavecad -- uv run "$PWD/mcp_server.py"
```

## Rules for eval scripts

- Never call a modal `exec()` — it blocks the GUI until a human dismisses
  it. Probe dialogs with `show()`, inspect, then `close()`.
- Re-resolve the document per call via `csDoc()`/`csDi()`; never cache one
  (a freed RDocument is undetectable and touching it segfaults).
- Results are serialized bridge-side (JSON, or `toString()` for Qt
  wrappers), capped at 1 MB.

## Security

The bridge executes arbitrary script — identical power to the per-user
scripts folder itself. 127.0.0.1 bind only; flag file is the opt-in. Never
enable on a shared machine; never ship in the CaveSurvey package or any
CaveCAD release build.
