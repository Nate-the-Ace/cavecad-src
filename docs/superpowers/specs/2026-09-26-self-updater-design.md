# CaveCAD self-updater

Date: 2026-09-26. Status: design approved in conversation; updated 2026-09-27 after
the final review (safe full-update helper, status file, install-at-quit, per-user
work folders, skip key by version, Preferences page).

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
  **Later** (ask next start) and **Skip this version** (remember the offer's key;
  silent until it changes). It also has a **Check for updates at startup** checkbox.
- The skip key names what the user would get, not the file: `tools|<version>` for
  a tools offer, `full|<app_commit>|<tools version>` for an app offer. Never the
  asset's sha256, which changes on every re-assembly of `latest-build`.
- Setting `CheckForUpdates/AutoCheck` (default on) mirrors the checkbox; it is also
  in Preferences > General > Updates (`PreferencesPage.ui`, box `AutoCheck`).
- Before anything else, the startup reads `<data>/update-status.json` (written by
  the full-update helper, below) once and deletes it. A failure is shown in a
  non-modal message with its reason, and its offer key is stored in
  `CheckForUpdates/FailedKey`: the startup check stays silent about that offer
  (so a helper that fails every time cannot re-offer itself forever), while
  Help > Check for Updates still offers it.

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
- The download goes to a fresh per-user folder with a progress bar:
  `<data>/update-tmp/dl-<unique>` (`<data>` = `RSettings.getDataLocation()`),
  created new; if it already exists it is not used. Never the shared system temp
  folder, where another account could plant or swap files. The manifest is
  fetched there too. Leftovers in `update-tmp` older than a day are removed at
  the next install; younger ones may belong to an install in progress.
- Timeouts: curl gives up when a transfer stalls (under 1 KB/s for 60 s), so a
  slow but moving app download is never cut off; the overall cap is 4 hours.
  Python's fallback uses a 60 s socket timeout. The startup manifest fetch keeps
  its 5 s limit.
- **Hashing:** CaveCAD's script engine has no SHA-256 (`QCryptographicHash` is not
  exposed to scripts; checked 2026-09-26), so the platform's own tool computes it,
  the same way unzipping works: `powershell Get-FileHash -Algorithm SHA256` on
  Windows, `/usr/bin/shasum -a 256` on macOS, `sha256sum` on Linux (every tool by
  absolute path on Windows and macOS: a Homebrew GNU `tar` on PATH cannot read
  zips). The file path is an
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
  root (`<data>/update-tmp/tools-<unique>/stage`; never inside it, since add-on
  discovery recurses there and an interrupted swap would load every tool twice),
  check that it holds `CaveSurvey/VERSION` with the manifest's version, then swap
  it for `…/scripts/CaveSurvey` (the old copy is renamed aside into the same
  `tools-<unique>` folder, which is deleted after the swap). Each install has its
  own folder, so two running at once cannot clear each other's.
- **One copy loads:** `scripts/AddOn.js` (cavecad-src) changes so that when an
  add-on folder name exists in more than one scripts root, only the copy with the
  higher `VERSION` is loaded. That is the per-user copy after an update, and the
  bundled copy once a newer app has arrived. This also ends today's
  double-loading when a publish.sh machine runs a release build.
- Unzip uses `CsPackage.unzipCommand`'s approach (tar on macOS and Windows,
  Python's zipfile on Linux), moved into cavecad-src's scripts so the app owns it.

## Applying a full update

CaveCAD cannot replace itself while running. A helper script is written into the
download's own folder (`<data>/update-tmp/dl-<unique>`), started detached, and
CaveCAD quits. Before anything is downloaded, CaveCAD checks it can replace
itself where it is:

- **Packaged:** on Windows the target is the whole folder `cavecad.exe` sits in,
  so that folder must contain `cavecad-build.json` (proof it is an unpacked
  CaveCAD package, not `D:\Tools` or the Desktop with CaveCAD loose in it); a
  drive root is refused. On macOS the bundle must have
  `Contents/Resources/cavecad-build.json`.
- **Writable:** for example `/Applications` without rights, or `Program Files`.
- If either fails, the prompt says why and opens the release page instead.

The helper (sh on macOS and Linux, PowerShell on Windows):

1. waits for CaveCAD's process to exit: up to 60 s after "Restart now", with no
   limit after "No" (below). If it is still running, **nothing is swapped**
   (status "CaveCAD did not quit").
2. refuses to swap while any other process runs from the target: `pgrep -f` on
   the target's path (macOS, Linux; 10 s grace for an AppImage's FUSE runtime to
   exit), `Get-Process` whose `Path` is inside the target (Windows).
3. re-hashes the download against the SHA-256 baked into the script; a missing
   or changed file fails without a swap.
4. builds the new copy beside the target as `<target>.new-<stamp>`, renames the
   target to `<target>.old-<stamp>` and the new copy into its place. It only
   ever creates, and so only ever deletes, those uniquely named paths: a `.old`
   or `.new` it did not make is never touched. If the second rename fails, the
   old copy is renamed back.
5. moves every top-level entry of the old folder that the new package does not
   have into the new one (files a user kept beside CaveCAD survive), THEN
   deletes the old copy. If a move or the delete fails, the old copy is kept and
   the status names it.
6. writes its outcome to `<data>/update-status.json`
   (`{"result": "ok"|"failed", "error", "key", "when"}`), deletes the download
   folder, and relaunches CaveCAD ("Restart now" only; after a failure it
   relaunches the old build).

| Platform | Helper | New copy |
|---|---|---|
| Windows | PowerShell, `-LiteralPath` throughout | the zip expanded beside the install folder; its `CaveCAD/` (which must hold `cavecad-build.json`) becomes `<target>.new-<stamp>` |
| macOS | sh | the DMG attached read-only, `ditto` of `CaveCAD.app` to `<target>.new-<stamp>`, detached |
| Linux | sh | the AppImage copied to `<target>.new-<stamp>`, `chmod +x` |

Inside an AppImage, child processes (downloads, hashing, the helper) get an
environment without AppRun's `LD_LIBRARY_PATH` entries under `$APPDIR` and
without its `QT_PLUGIN_PATH`.

## Restart

"Update installed. Restart now?" (tools) / "Update downloaded and verified.
Restart now to install it?" (app).

- **Tools, Yes:** a small helper is written, the standard close-all runs (save
  prompts), and only then is the helper started: it waits for CaveCAD to exit
  and relaunches it. **No:** the tools load at next start.
- **App, Yes:** the helper is written first (if that fails, CaveCAD is still
  running and says so), then the close-all runs, and only once the window has
  closed is the helper started; it installs and relaunches. If a save prompt is
  cancelled, it falls back to "No".
- **App, No:** the verified download is kept. The helper starts at once in its
  wait-for-quit mode: it waits for this CaveCAD with no time limit and installs
  after the user's own quit, without relaunching (they chose to quit). Until
  then, Help > Check for Updates says the update is downloaded and installs at
  quit.

## Components

| Unit | Where | Purpose |
|---|---|---|
| manifest + sidecars | `assemble.yml` | publish `latest.json`, `CaveSurvey-tools.zip`, `*.sha256` |
| build identity | packaging steps in `windows.yml`, `macos.yml`, `linux.yml` | write `cavecad-build.json` |
| `CcUpdateCore.js` | `scripts/Help/CheckForUpdates/` | parse and validate the manifest, decide, skip keys (pure, unit-tested) |
| `CcUpdateCommands.js` / `CcUpdateRun.js` | same folder | the platform programs (hash, fetch, unzip, detach) and a non-blocking runner |
| `CcUpdateDownload.js` | same folder | download with progress; SHA-256 via the platform tool; verify with one retry |
| `CcUpdateApply.js` | same folder | per-user work folders; tools-only swap; full-update helper scripts per platform |
| `CheckForUpdates.js` / `…PostInit.js` / `PreferencesPage.ui` | same folder | menu action, startup check and status report, prompt, settings page |

The module files carry a `Cc` prefix because `include()` dedupes by basename: a
generic `UpdateCore.js` anywhere else in the scripts tree would stop one of the
two from loading.
| add-on precedence | `scripts/AddOn.js` | the highest `VERSION` wins between scripts roots |

## Testing

- Engine test: the platform hash command yields the known SHA-256 of a fixture
  file (and "abc" → `ba7816bf…`).
- Unit: the decision table, version comparison, rejection of unsafe asset names,
  checksum match and mismatch (including the retry path), and parsing of
  `latest.json`/`.sha256`.
- Engine test: add-on precedence with two copies at different versions.
- Engine test (`helper_test.js`): the generated full-update helper for the
  running platform is actually RUN against a fake install, with the pid of a
  finished process and a relaunch that writes a marker: success (swap, user
  files carried over, status ok, download folder deleted, relaunch), a foreign
  `.old`/`.new` left alone, bad hash, missing download, CaveCAD still running,
  another process running from the target, and wait-for-quit (no relaunch). On
  macOS most cases stage a prepared `.app` in place of mounting the DMG
  (`hdiutil create` takes ~15 s); one case builds and mounts a real DMG.
- CI: `assemble.yml` verifies its own sidecars (`sha256sum -c`) before publishing.
- Manual, per platform (Windows x64 and ARM64, macOS, Linux ARM VM): install an
  older `latest-build`, publish a tools-only change and see the prompt, update,
  restart; then an app change for a full update.

## Out of scope

Channel selection, delta patches, signature verification (after SignPath),
automatic background installs without a prompt.
