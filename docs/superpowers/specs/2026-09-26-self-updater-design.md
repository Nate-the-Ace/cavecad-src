# CaveCAD self-updater

Date: 2026-09-26. Status: design approved in conversation, awaiting spec review.

## Goal

A published CaveCAD (from the rolling `latest-build` release) finds out by itself
that a newer build exists, offers it, and installs it: the Cave Survey tools alone
when only they changed, the whole app when the app changed. It checks quietly at
startup with a prompt that can be ignored, and Help > Check for Updates does the
same on demand. Every download is verified against a published SHA-256 checksum
without asking the user.

## Decisions (from the user)

- **Granularity:** tools-only updates when possible (~3 MB); full app download only
  when the app itself changed.
- **Channel:** the rolling `latest-build` release only. No channel setting.
- **Restart:** ask "Update installed. Restart now?". Yes means save prompts, quit
  and relaunch. No means the update applies at next start.
- **Verification:** a SHA-256 checksum published beside every download, checked
  silently.

## What gets published (assemble.yml)

Beside the existing downloads on `latest-build`:

| Asset | Content |
|---|---|
| `latest.json` | the manifest, below |
| `CaveSurvey-tools.zip` | the add-on alone: one `CaveSurvey/` folder |
| `<asset>.sha256` | for every download and for the tools zip: `<hex>  <file name>` (sha256sum format) |

`latest.json`:

```json
{
  "schema": 1,
  "published": "2026-09-26T05:20:16Z",
  "tools": { "version": "0.9.181.0", "commit": "e7b4095…",
             "asset": "CaveSurvey-tools.zip", "sha256": "…", "size": 3141592 },
  "platforms": {
    "windows-x64":   { "app_commit": "bb12aac6…", "asset": "CaveCAD-windows-x64.zip",
                       "sha256": "…", "size": 79691776 },
    "windows-arm64": { … }, "macos-arm64": { … },
    "linux-x86_64":  { … }, "linux-aarch64": { … }
  }
}
```

A platform whose build is missing (for example, the optional ARM builds before they
first succeed) is absent from `platforms`. `app_commit` is per platform because
bases can differ while one platform rebuilds.

## What each app knows about itself

Packaging writes `cavecad-build.json` next to the runtime tree: the exe folder on
Windows, `Contents/Resources` on macOS, `usr/bin` in the AppImage.

```json
{ "platform": "windows-arm64", "app_commit": "bb12aac6…" }
```

The installed tools version is the loaded add-on's `CaveSurvey/VERSION`.

## Deciding what to offer

1. No `cavecad-build.json` (a development build): the updater is off. Help > Check
   for Updates says so.
2. Own platform missing from the manifest: nothing to offer.
3. `platforms[p].app_commit` ≠ own `app_commit`: **full update** (it includes the
   current tools).
4. Otherwise, if the manifest's tools version > the loaded tools version (compared
   as dotted integers): **tools-only update**.
5. Otherwise, up to date.

## Startup check

- Runs from `CheckForUpdatesPostInit`, about 3 s after the main window appears,
  using asynchronous networking: it never blocks startup or drawing.
- Timeout 5 s. Offline, an HTTP error or a malformed manifest: silent (logged to
  the command line at debug level only).
- If an update is found, a non-modal prompt names it (e.g. "Cave Survey tools
  0.9.181.0 → 0.9.182.0" or "CaveCAD app update, 76 MB") with **Update now**,
  **Later** (ask next start) and **Skip this version** (remember the manifest key;
  silent until it changes). It also has a **Check for updates at startup** checkbox.
- Setting `CheckForUpdates/AutoCheck` (default on) mirrors the checkbox; it is also
  shown in Preferences.

## Help > Check for Updates

Replaces QCAD's checker, which fetches qcad.org over plain HTTP. It does the same
decision and always answers: "You're up to date (app `bb12aac6`, tools 0.9.181.0)",
the update prompt (skipped versions offered again), or a plain error when the
check itself fails.

## Download and silent verification

- Downloads come only from
  `https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/<asset>`.
  The base is a constant in code; the manifest supplies asset names only, and a
  name containing `/` or `..` is refused.
- The download goes to a temporary file with a progress bar.
- **Hashing:** CaveCAD's script engine has no SHA-256 (`QCryptographicHash` is not
  exposed to scripts; checked 2026-09-26), so the platform's own tool computes it,
  the same way unzipping works: `powershell Get-FileHash -Algorithm SHA256` on
  Windows, `shasum -a 256` on macOS, `sha256sum` on Linux. The file path is an
  argument, never spliced into a command string. A missing tool counts as "could
  not verify", never as "verified".
- **Verification, silent:** the SHA-256 of the downloaded file must equal both
  `latest.json`'s value and the `<asset>.sha256` sidecar. On a mismatch the file is
  deleted and downloaded once more. A second mismatch shows one message:
  "The download didn't verify; nothing was changed", plus a link to the release
  page. Nothing is unpacked or replaced from an unverified file, and what gets
  installed is the file that was hashed.
- **Scope:** this catches corrupt or truncated downloads, altering proxies and
  wrong files. It does not stop someone able to replace both a file and its
  checksum on GitHub; code signing (SignPath, pending) covers that later.

## Applying a tools-only update

- Unpack `CaveSurvey-tools.zip` into a staging folder BESIDE the per-user scripts
  root (`…/QCAD/CaveCAD/update-tmp/stage-<stamp>`; never inside it, since add-on
  discovery recurses there and an interrupted swap would load every tool twice),
  check that it holds `CaveSurvey/VERSION` with the manifest's version, then swap
  it for `…/scripts/CaveSurvey` (the old copy is renamed aside into `update-tmp`
  and deleted after the swap; leftovers are cleared at the start of an install).
- **One copy loads:** `scripts/AddOn.js` (cavecad-src) changes so that when an
  add-on folder name exists in more than one scripts root, only the copy with the
  higher `VERSION` is loaded. That is the per-user copy after an update, and the
  bundled copy once a newer app has arrived. This also ends today's
  double-loading when a publish.sh machine runs a release build.
- Unzip uses `CsPackage.unzipCommand`'s approach (tar on macOS and Windows,
  Python's zipfile on Linux), moved into cavecad-src's scripts so the app owns it.

## Applying a full update

CaveCAD cannot replace itself while running. A helper script is written to a
temporary folder, started detached, and CaveCAD quits. The helper:

1. waits for CaveCAD's process to exit (timeout 60 s),
2. puts the new build in place,
3. relaunches CaveCAD.

| Platform | Helper | Swap |
|---|---|---|
| Windows | PowerShell | the new zip unpacked beside the install folder, then folder renames: old aside, new in, old deleted |
| macOS | sh | the DMG attached, `ditto` to `CaveCAD.app.new`, then renames |
| Linux | sh | the new AppImage written beside `$APPIMAGE`, `chmod +x`, renamed over it |

- **Not writable** (for example `/Applications` without rights, or `Program
  Files`): checked before downloading. If so, the prompt says it cannot update in
  place and opens the release page instead.
- On any helper failure the old build stays in place, since it is only renamed
  aside after the new one is complete, and the helper relaunches the old one.

## Restart

"Update installed. Restart now?" Yes: the standard close-all (save prompts), then
quit. For a full update the helper relaunches; for tools-only CaveCAD relaunches
itself. No: a tools-only update loads next start; for a full update, the helper
waits for the user's own quit.

## Components

| Unit | Where | Purpose |
|---|---|---|
| manifest + sidecars | `assemble.yml` | publish `latest.json`, `CaveSurvey-tools.zip`, `*.sha256` |
| build identity | packaging steps in `windows.yml`, `macos.yml`, `linux.yml` | write `cavecad-build.json` |
| `UpdateCheck.js` | `scripts/Help/CheckForUpdates/` | fetch and parse the manifest, decide (pure, unit-tested) |
| `UpdateDownload.js` | same folder | download with progress; SHA-256 via the platform tool; verify with one retry |
| `UpdateApply.js` | same folder | tools-only swap; full-update helper scripts per platform |
| `CheckForUpdates.js` / `…PostInit.js` | same folder | menu action, startup check, prompt, settings |
| add-on precedence | `scripts/AddOn.js` | the highest `VERSION` wins between scripts roots |

## Testing

- Engine test: the platform hash command yields the known SHA-256 of a fixture
  file (and "abc" → `ba7816bf…`).
- Unit: the decision table, version comparison, rejection of unsafe asset names,
  checksum match and mismatch (including the retry path), and parsing of
  `latest.json`/`.sha256`.
- Engine test: add-on precedence with two copies at different versions.
- CI: `assemble.yml` verifies its own sidecars (`sha256sum -c`) before publishing.
- Manual, per platform (Windows x64 and ARM64, macOS, Linux ARM VM): install an
  older `latest-build`, publish a tools-only change and see the prompt, update,
  restart; then an app change for a full update.

## Out of scope

Channel selection, delta patches, signature verification (after SignPath),
automatic background installs without a prompt.
