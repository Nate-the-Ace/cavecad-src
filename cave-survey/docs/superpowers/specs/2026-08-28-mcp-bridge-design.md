# CaveCAD MCP Bridge — design

**Date:** 2026-08-28
**Status:** approved (conversation, 2026-08-28), built same day

## Problem

Headless CaveCAD covers parsing, unit tests, and batch verification, but the
recurring bug family lives GUI-side: wrapper-only widgets, method-vs-property
mismatches, self-confirming message boxes, and anything touching the live
document interface. Today only a human clicking in the app finds those.
Every new dialog pays that tax, and more GUI work is planned.

## Goal

Let an AI agent (Claude Code via MCP) talk to the *running* CaveCAD GUI:
evaluate ECMAScript in the live engine, inspect documents/entities/XDATA,
probe widget construction before designing dialogs, and capture screenshots
of the viewport and dialogs.

## Non-goals

- Not a replacement for the headless test harness (`tests/run_all.sh`).
- Not shipped to users: dev machines only, never in the published
  CaveSurvey package or a CaveCAD release build.
- No remote access of any kind.

## Architecture

Two halves, one line-delimited JSON protocol between them:

```
Claude Code ──stdio/MCP──> mcp_server.py ──TCP 127.0.0.1──> CsMcpBridge.js
                            (Python, uv)                    (add-on inside CaveCAD)
```

### CsMcpBridge.js (ECMAScript add-on)

- Lives at `bridge/CsMcpBridge/CsMcpBridge.js` in this repo; installed by
  `bridge/install.sh` into the per-user scripts folder
  (`~/Library/Application Support/QCAD/CaveCAD/scripts/CsMcpBridge/`),
  sibling of `CaveSurvey/`. Loads at startup like any add-on; registers no
  menu, no toolbar, no actions.
- **Gate:** starts only if the flag file
  `~/Library/Application Support/QCAD/CaveCAD/CsMcpBridge.enabled` exists.
  No flag, no listener — so an accidental copy into a non-dev machine is
  inert.
- Opens `QTcpServer` bound to **127.0.0.1** on port **42283** ("CAVE"),
  falling back to an ephemeral port if taken. Writes
  `CsMcpBridge.port` (JSON: port, pid, version, started) next to the flag
  file so the Python side never guesses.
- All IO through `QTextStream` — probed 2026-08-28: `QByteArray("str")`
  bridges to size 0 (raw byte IO is dead), while QTextStream line IO
  round-trips UTF-8 perfectly and `readyRead`/`newConnection` signals fire.
- Requests are one JSON object per line: `{"id": N, "op": "...", ...}`.
  Responses mirror the id: `{"id": N, "ok": true, "result": ...}` or
  `{"id": N, "ok": false, "error": "..."}`.
- Ops:
  - `ping` — app version, document name, bridge version.
  - `eval` — evaluate a script string in the engine's global scope,
    JSON-serialize the completion value (Qt wrapper objects degrade to
    their `toString()`). Result capped at 1 MB.
  - `screenshot` — grab the main window (or a named child widget) to a
    PNG at a caller-supplied path; returns the path and size.
- Runs on the GUI thread (signal delivery), so eval touches documents and
  widgets safely. One request at a time. A script that calls a modal
  `exec()` blocks the loop until dismissed — bridge scripts must use
  `show()` for dialog probing (documented in bridge README).

### mcp_server.py (MCP stdio server)

- `bridge/mcp_server.py`, PEP 723 inline metadata, run via
  `uv run bridge/mcp_server.py`; depends on the official `mcp` SDK.
- Reads the port file, connects on demand, reconnects per call (stateless
  socket use — survives CaveCAD restarts without restarting the MCP side).
- Tools:
  - `cavecad_status` — is the bridge up, app version, open document.
  - `cavecad_eval` — run ECMAScript in the live GUI engine, return result.
  - `cavecad_screenshot` — capture main window / widget to PNG, return path.
- Registered with Claude Code at user scope:
  `claude mcp add --scope user cavecad -- uv run <abs path>/mcp_server.py`.

### Protocol notes

- Newline-delimited JSON keeps framing trivial under QTextStream's
  `canReadLine()`/`readLine()`.
- The bridge never interprets partial lines; it buffers until newline.
- Errors carry the exception's message and, when present, line number.

## Testing

- `bridge/tests/test_protocol.sh` — starts a headless CaveCAD
  (`-no-gui -autostart` harness that includes CsMcpBridge.js, forces the
  gate open, serves for a bounded window), then a Python client exercises
  ping / eval / error-path and asserts exact values. Same discipline as
  `tests/run_all.sh`: no assertion a broken output would satisfy.
- GUI smoke test: launch CaveCAD, `cavecad_status`, `cavecad_eval("1+1")`,
  screenshot — performed at build time, repeat after engine upgrades.

## Security

Local-only by construction: 127.0.0.1 bind, no authentication (the flag
file is the opt-in), eval is by design arbitrary code — identical power to
the per-user scripts folder itself. Never enable on a shared machine.

## Decisions and alternatives considered

- **Per-user add-on, not baked into cavecad-src:** the installed app lags
  the source tree, and per-user add-ons load identically at startup with
  zero rebuilds. The flag file provides the dev-only gate that a
  build-flavor gate would have provided.
- **TCP, not file mailbox:** mailbox was the fallback if sockets failed
  the engine probe; they didn't. Mailbox remains the fallback design if a
  future Qt upgrade breaks socket wrappers.
- **Small tool surface (status/eval/screenshot):** everything else
  (XDATA queries, entity counts, widget probes) is an eval one-liner;
  premature convenience tools would just drift from the engine.
