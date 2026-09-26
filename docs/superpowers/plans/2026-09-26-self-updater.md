# CaveCAD Self-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Published CaveCAD builds check the rolling `latest-build` release at startup and from Help > Check for Updates. They offer an ignorable update, download it with silent SHA-256 verification, and install either the Cave Survey tools alone or the whole app.

**Architecture:** Everything runs in CaveCAD's own scripts (`scripts/Help/CheckForUpdates/`), and no C++ changes. The script engine (QJSEngine via cavecadjsapi) has no asynchronous networking, no SHA-256, and a built-in `download()` that does not follow GitHub's redirects. Network, hashing, unzipping and detached launches therefore run as platform programs through `QProcess`: curl, `Get-FileHash`/`shasum`/`sha256sum`, tar or Python zipfile, sh or cmd. The asynchronous parts use `QProcess.finished` and `QTimer`. CI publishes a `latest.json` manifest, a tools-only zip and `.sha256` sidecars, and each packaged app carries `cavecad-build.json`.

**Tech Stack:** QCAD/CaveCAD ECMAScript (QJSEngine bindings), Qt widgets from script, GitHub Actions YAML, Python 3 (manifest generator and its unittest), POSIX sh, PowerShell.

**User decisions (already made):**
- Tools-only update when only the tools changed; full app download only when the app changed.
- Channel: the rolling `latest-build` release only; no channel setting.
- Restart: ask "Update installed. Restart now?"; No means it applies at next start.
- Checksums: a `.sha256` sidecar for every published file, verified silently (one automatic retry; only a second failure is shown).
- Spec: `docs/superpowers/specs/2026-09-26-self-updater-design.md`, approved 2026-09-26.

**Engine facts measured 2026-09-26 (installed CaveCAD, QJSEngine):**
- `QCryptographicHash`, `QNetworkAccessManager`, `QNetworkRequest`: undefined. `QProcess.startDetached`: undefined.
- `download()`/`downloadToFile()` exist but block, and return nothing for a redirecting URL.
- Available: `new QProcess()` with `start`, `finished` (signal), `state`, `readAllStandardOutput`; `QTimer`; `QEventLoop`; `QCoreApplication.applicationPid()`; `QCoreApplication.applicationFilePath()`; `QProcessEnvironment.systemEnvironment().value(k, d)`; `RS.getSystemId()`, which answers `"win"`, `"osx"` or `"linux"`; `RSettings.getApplicationPath()`, which is `…/CaveCAD.app/Contents/Resources` on macOS.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/Help/CheckForUpdates/UpdateCore.js` | pure logic: version compare, manifest validation, decision, sidecar parsing, URLs, settings keys |
| `scripts/Help/CheckForUpdates/UpdateCommands.js` | pure builders of `{program, args}` per platform: fetch, hash, unzip, detach; hash-output parsing |
| `scripts/Help/CheckForUpdates/UpdateRun.js` | runs a command asynchronously (QProcess plus finished), with a timeout |
| `scripts/Help/CheckForUpdates/UpdateDownload.js` | fetch the manifest; download plus verify with one retry; progress by file size |
| `scripts/Help/CheckForUpdates/UpdateApply.js` | tools-only swap; full-update helper scripts (sh, ps1) and their launch; writability check |
| `scripts/Help/CheckForUpdates/CheckForUpdates.js` | menu action plus the UI: prompt, progress, restart (replaces QCAD's) |
| `scripts/Help/CheckForUpdates/CheckForUpdatesPostInit.js` | startup check (replaces QCAD's) |
| `scripts/AddOn.js` | one copy per add-on name across scripts roots, highest VERSION wins |
| `tools/make_manifest.py` | CI: writes `latest.json` plus `*.sha256` from the assembled `dist/` |
| `tests/test_make_manifest.py` | unittest for make_manifest.py |
| `tests/updater/run.sh` | runs every `tests/updater/*_test.js` in CaveCAD headless and reports |
| `tests/updater/*_test.js` | engine tests per module |
| `.github/workflows/{windows,macos,linux}.yml`, `tools/package-macos.sh` | write `cavecad-build.json` into each app |
| `.github/workflows/assemble.yml` | publish `CaveSurvey-tools.zip`, `latest.json` and sidecars; `sha256sum -c` before publishing |

`CheckForUpdatesDialog.ui` is deleted: QCAD's page-browser dialog has no use here.

---

### Task 1: Test harness for scripts

**Goal:** `tests/updater/run.sh` runs each `tests/updater/*_test.js` inside CaveCAD headless and fails on any failed assertion.

**Files:**
- Create: `tests/updater/run.sh`
- Create: `tests/updater/harness.js`
- Create: `tests/updater/smoke_test.js`

**Acceptance Criteria:**
- [ ] `tests/updater/run.sh` prints `### UPDATER OK <n>` per file and exits 0 when all pass
- [ ] a failing assertion prints `### UPDATER FAIL` with the message and exits 1
- [ ] it uses `$CAVECAD` if set, else `debug/CaveCAD.app/Contents/MacOS/CaveCAD`, else `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD`

**Verify:** `tests/updater/run.sh` → `### UPDATER OK 2 (smoke_test.js)`, exit 0

**Steps:**

- [ ] **Step 1: harness.js**

```js
// tests/updater/harness.js -- shared by every updater engine test.
// REPO is the repository root, passed as the first script argument.
var REPO = (function() {
    var args = RSettings.getOriginalArguments();
    for (var i = 0; i < args.length; i++) {
        if (String(args[i]) === "-autostart" && i + 2 < args.length) {
            return String(args[i + 2]);
        }
    }
    return QDir.currentPath();
})();
var passed = 0, failures = [];
function ok(cond, what) { if (cond) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) { ok(a === b, what + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function finish(name) {
    if (failures.length === 0) { print("### UPDATER OK " + passed + " (" + name + ")"); }
    else { print("### UPDATER FAIL " + failures.length + " (" + name + ")\n  " + failures.join("\n  ")); }
}
function load(rel) { include(REPO + "/" + rel); }
```

- [ ] **Step 2: smoke_test.js**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
ok(typeof QProcess === "function", "QProcess exists");
eqs(["win", "osx", "linux"].indexOf(RS.getSystemId()) >= 0, true, "known system id");
finish("smoke_test.js");
```

- [ ] **Step 3: run.sh**

```sh
#!/bin/sh
# Runs every tests/updater/*_test.js inside CaveCAD's own engine, headless.
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
for c in "${CAVECAD:-}" debug/CaveCAD.app/Contents/MacOS/CaveCAD \
         /Applications/CaveCAD.app/Contents/MacOS/CaveCAD; do
    [ -n "$c" ] && [ -x "$c" ] && APP="$c" && break
done
[ -n "${APP:-}" ] || { echo "no CaveCAD binary found; set CAVECAD"; exit 2; }
status=0
for t in tests/updater/*_test.js; do
    out=$("$APP" -no-dock-icon -no-gui -allow-multiple-instances \
          -autostart "$REPO/$t" "$REPO" 2>/dev/null | grep '### UPDATER')
    echo "${out:-### UPDATER FAIL no output ($t)}"
    case "$out" in *"UPDATER OK"*) ;; *) status=1 ;; esac
done
exit $status
```

- [ ] **Step 4: Run** `chmod +x tests/updater/run.sh && tests/updater/run.sh`. Expected: `### UPDATER OK 2 (smoke_test.js)`.
- [ ] **Step 5: Commit** `git add tests/updater && git commit -m "test: headless harness for updater scripts"`

---

### Task 2: UpdateCore (pure decision logic)

**Goal:** A pure module that validates a manifest, compares versions and decides full, tools or none, with unit tests.

**Files:**
- Create: `scripts/Help/CheckForUpdates/UpdateCore.js`
- Test: `tests/updater/core_test.js`

**Acceptance Criteria:**
- [ ] `UpdateCore.compareVersions("0.9.181.0","0.9.180.1") > 0`; equal gives 0; missing parts count as 0
- [ ] `UpdateCore.validate(manifest)` rejects schema ≠ 1, a missing `tools`, and asset names containing `/`, `\\` or `..`; it returns `{ok, error}`
- [ ] `UpdateCore.decide(manifest, local)` returns `{kind:"dev"}` without build info, `{kind:"none"}` when the platform is absent, `{kind:"full", ...}` on an app_commit mismatch, `{kind:"tools", ...}` on a newer tools version, else `{kind:"none"}`
- [ ] `UpdateCore.parseSidecar("<hex>  name")` returns the lowercase hex, or null for anything that is not 64 hex characters
- [ ] `UpdateCore.assetUrl(name)` is `BASE + name`, where `BASE` is the fixed latest-build download URL

**Verify:** `tests/updater/run.sh` → `### UPDATER OK <n> (core_test.js)`

**Steps:**

- [ ] **Step 1: Write core_test.js (failing)**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCore.js");

ok(UpdateCore.compareVersions("0.9.181.0", "0.9.180.1") > 0, "newer is greater");
eqs(UpdateCore.compareVersions("0.9.4", "0.9.4.0"), 0, "missing parts are zero");
ok(UpdateCore.compareVersions("0.9.10.0", "0.9.9.0") > 0, "numeric, not lexical");

var hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
function manifest() {
    return { schema: 1, published: "2026-09-26T05:20:16Z",
        tools: { version: "0.9.181.0", commit: "e7b4095", asset: "CaveSurvey-tools.zip", sha256: hex, size: 10 },
        platforms: { "windows-x64": { app_commit: "bb12aac6", asset: "CaveCAD-windows-x64.zip", sha256: hex, size: 20 } } };
}
ok(UpdateCore.validate(manifest()).ok, "a good manifest validates");
var bad = manifest(); bad.schema = 2;
ok(!UpdateCore.validate(bad).ok, "unknown schema refused");
bad = manifest(); bad.platforms["windows-x64"].asset = "../evil.zip";
ok(!UpdateCore.validate(bad).ok, "path in asset name refused");
bad = manifest(); bad.tools.asset = "a/b.zip";
ok(!UpdateCore.validate(bad).ok, "slash in tools asset refused");
bad = manifest(); bad.tools.sha256 = "xyz";
ok(!UpdateCore.validate(bad).ok, "malformed sha256 refused");

eqs(UpdateCore.decide(manifest(), { platform: null, appCommit: null, toolsVersion: "0.9.181.0" }).kind, "dev", "no build info: dev build");
eqs(UpdateCore.decide(manifest(), { platform: "linux-aarch64", appCommit: "x", toolsVersion: "0" }).kind, "none", "platform not published");
var full = UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" });
eqs(full.kind, "full", "app commit differs: full");
eqs(full.asset, "CaveCAD-windows-x64.zip", "full names the platform asset");
var tools = UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.180.1" });
eqs(tools.kind, "tools", "same app, older tools: tools-only");
eqs(tools.asset, "CaveSurvey-tools.zip", "tools names the tools asset");
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.181.0" }).kind, "none", "up to date");
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.182.0" }).kind, "none", "newer local tools (publish.sh machine): none");

eqs(UpdateCore.parseSidecar(hex.toUpperCase() + "  CaveCAD-windows-x64.zip\n"), hex, "sidecar parsed, lowercased");
ok(UpdateCore.parseSidecar("nope") === null, "junk sidecar is null");
eqs(UpdateCore.assetUrl("latest.json"), "https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/latest.json", "fixed base URL");
eqs(UpdateCore.key(manifest()), "e7b4095|windows-x64=bb12aac6", "skip key covers tools and every platform");
finish("core_test.js");
```

- [ ] **Step 2: Run** `tests/updater/run.sh`. Expected: `### UPDATER FAIL no output (core_test.js)` (UpdateCore is undefined).

- [ ] **Step 3: Implement UpdateCore.js**

```js
// UpdateCore.js -- the updater's pure logic: nothing here touches the
// network, the disk or the UI, so all of it is unit-tested.

var UpdateCore = {};

// Downloads only ever come from here; the manifest supplies names only.
UpdateCore.BASE = "https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/";
UpdateCore.MANIFEST = "latest.json";
UpdateCore.SETTING_AUTO = "CheckForUpdates/AutoCheck";
UpdateCore.SETTING_SKIP = "CheckForUpdates/SkippedKey";

UpdateCore.assetUrl = function(name) { return UpdateCore.BASE + name; };

/** Dotted integer versions; missing parts are 0. >0 when a is newer. */
UpdateCore.compareVersions = function(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var x = parseInt(pa[i] || "0", 10) || 0, y = parseInt(pb[i] || "0", 10) || 0;
        if (x !== y) { return x - y; }
    }
    return 0;
};

UpdateCore.isHex64 = function(s) { return /^[0-9a-f]{64}$/.test(String(s)); };
UpdateCore.safeName = function(s) {
    s = String(s === undefined || s === null ? "" : s);
    return s !== "" && s.indexOf("/") < 0 && s.indexOf("\\") < 0 && s.indexOf("..") < 0;
};

/** {ok, error}: a manifest this updater can trust the shape of. */
UpdateCore.validate = function(m) {
    var fail = function(e) { return { ok: false, error: e }; };
    if (m === null || typeof m !== "object") { return fail("not an object"); }
    if (m.schema !== 1) { return fail("unknown schema " + m.schema); }
    var t = m.tools;
    if (!t || !t.version || !UpdateCore.safeName(t.asset) || !UpdateCore.isHex64(t.sha256)) {
        return fail("bad tools entry");
    }
    if (!m.platforms || typeof m.platforms !== "object") { return fail("no platforms"); }
    for (var p in m.platforms) {
        if (!m.platforms.hasOwnProperty(p)) { continue; }
        var e = m.platforms[p];
        if (!e || !e.app_commit || !UpdateCore.safeName(e.asset) || !UpdateCore.isHex64(e.sha256)) {
            return fail("bad platform entry " + p);
        }
    }
    return { ok: true, error: "" };
};

/**
 * local: {platform, appCommit, toolsVersion}. platform null = a
 * development build (no cavecad-build.json): the updater stays out.
 */
UpdateCore.decide = function(m, local) {
    if (!local || !local.platform || !local.appCommit) { return { kind: "dev" }; }
    var p = m.platforms[local.platform];
    if (!p) { return { kind: "none" }; }
    if (String(p.app_commit) !== String(local.appCommit)) {
        return { kind: "full", asset: p.asset, sha256: p.sha256, size: p.size,
                 toolsVersion: m.tools.version, appCommit: p.app_commit };
    }
    if (UpdateCore.compareVersions(m.tools.version, local.toolsVersion) > 0) {
        return { kind: "tools", asset: m.tools.asset, sha256: m.tools.sha256, size: m.tools.size,
                 toolsVersion: m.tools.version, fromVersion: local.toolsVersion };
    }
    return { kind: "none" };
};

/** "Skip this version" remembers this; any new publish changes it. */
UpdateCore.key = function(m) {
    var parts = [String(m.tools.commit)], names = [];
    for (var p in m.platforms) { if (m.platforms.hasOwnProperty(p)) { names.push(p); } }
    names.sort();
    for (var i = 0; i < names.length; i++) { parts.push(names[i] + "=" + m.platforms[names[i]].app_commit); }
    return parts.join("|");
};

/** sha256sum format "<hex>  <name>" to lowercase hex, or null. */
UpdateCore.parseSidecar = function(text) {
    var m = /^\s*([0-9a-fA-F]{64})\b/.exec(String(text));
    return m ? m[1].toLowerCase() : null;
};
```

- [ ] **Step 4: Run** `tests/updater/run.sh`. Expected: `### UPDATER OK 24 (core_test.js)`.
- [ ] **Step 5: Commit** `git add scripts/Help/CheckForUpdates/UpdateCore.js tests/updater/core_test.js && git commit -m "feat(updater): pure decision logic"`

---

### Task 3: UpdateCommands and UpdateRun (platform programs)

**Goal:** Build and run the platform commands for fetch, hash, unzip and detached launch, with engine tests that really run them on macOS.

**Files:**
- Create: `scripts/Help/CheckForUpdates/UpdateCommands.js`
- Create: `scripts/Help/CheckForUpdates/UpdateRun.js`
- Test: `tests/updater/commands_test.js`

**Acceptance Criteria:**
- [ ] `hash("osx")` is `shasum -a 256 <path>`; `hash("linux")` is `sha256sum <path>`; `hash("win")` is powershell `Get-FileHash` with the path passed through an environment variable, never in the command text
- [ ] `UpdateCommands.parseHash(stdout)` extracts 64 hex from each tool's output format
- [ ] `fetch(system, url, out)` is `curl -fsSL --retry 2 -o out url` (win: `curl.exe`); `fetchFallback("linux", …)` uses python3 urllib
- [ ] `unzip` is tar `-xf zip -C dest` on osx/win, python3 zipfile on linux
- [ ] `detach("osx"|"linux", script)` is `/bin/sh -c 'nohup /bin/sh "$0" >/dev/null 2>&1 &' script`; `detach("win", ps1)` is `cmd /c start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File ps1`
- [ ] engine test: the hash of a file containing `abc` equals `ba7816bf…15ad`; `fetch` of a `file://` URL copies the file; `UpdateRun.run` calls back `{ok:true, stdout}` asynchronously

**Verify:** `tests/updater/run.sh` → `### UPDATER OK <n> (commands_test.js)`

**Steps:**

- [ ] **Step 1: Write commands_test.js (failing)**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");

var mac = UpdateCommands.hash("osx", "/a b/c.zip");
eqs(mac.program, "shasum", "macOS hashes with shasum");
eqs(mac.args.join("|"), "-a|256|/a b/c.zip", "path is its own argument");
eqs(UpdateCommands.hash("linux", "/x").program, "sha256sum", "Linux sha256sum");
var win = UpdateCommands.hash("win", "C:/it's.zip");
eqs(win.program, "powershell", "Windows Get-FileHash");
ok(win.args.join(" ").indexOf("it's") < 0, "Windows path is not spliced into the command");
eqs(win.env.CAVECAD_HASH_PATH, "C:/it's.zip", "Windows path travels in the environment");
var hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
eqs(UpdateCommands.parseHash(hex + "  /tmp/x\n"), hex, "shasum/sha256sum output");
eqs(UpdateCommands.parseHash(hex.toUpperCase() + "\r\n"), hex, "Get-FileHash output");
ok(UpdateCommands.parseHash("") === null, "empty output is no hash");
eqs(UpdateCommands.fetch("win", "https://u", "C:/o").program, "curl.exe", "Windows uses its curl.exe");
eqs(UpdateCommands.fetch("osx", "https://u", "/o").args.join("|"), "-fsSL|--retry|2|-o|/o|https://u", "curl follows redirects, fails on HTTP errors");
eqs(UpdateCommands.fetchFallback("linux", "https://u", "/o").program, "python3", "Linux fallback python");
eqs(UpdateCommands.unzip("osx", "/z.zip", "/d").args.join("|"), "-xf|/z.zip|-C|/d", "tar unzip");
eqs(UpdateCommands.unzip("linux", "/z.zip", "/d").program, "python3", "zipfile on Linux");
eqs(UpdateCommands.detach("osx", "/t/h.sh").args[1], "nohup /bin/sh \"$0\" >/dev/null 2>&1 &", "detached via nohup");
eqs(UpdateCommands.detach("win", "C:/t/h.ps1").program, "cmd", "detached via start");

// real runs on this machine
var dir = QDir.tempPath() + "/cc-updater-test";
(new QDir(dir)).removeRecursively(); (new QDir()).mkpath(dir);
var f = new QFile(dir + "/abc.txt"); f.open(QIODevice.WriteOnly); f.write(new QByteArray("abc")); f.close();
var loop = new QEventLoop(), got = null;
UpdateRun.run(UpdateCommands.hash(RS.getSystemId(), dir + "/abc.txt"), 20, function(r) { got = r; loop.quit(); });
loop.exec();
ok(got !== null && got.ok, "hash command ran: " + (got ? got.error : "no callback"));
eqs(got ? UpdateCommands.parseHash(got.stdout) : null, hex, "SHA-256 of abc");
got = null;
UpdateRun.run(UpdateCommands.fetch(RS.getSystemId(), "file://" + dir + "/abc.txt", dir + "/copy.txt"), 20, function(r) { got = r; loop.quit(); });
loop.exec();
ok(got !== null && got.ok && new QFileInfo(dir + "/copy.txt").size() === 3, "curl fetched a file:// URL");
got = null;
UpdateRun.run({ program: "false", args: [] }, 20, function(r) { got = r; loop.quit(); });
loop.exec();
ok(got !== null && !got.ok, "a failing program reports ok=false");
(new QDir(dir)).removeRecursively();
finish("commands_test.js");
```

- [ ] **Step 2: Run** `tests/updater/run.sh`. Expected: FAIL for commands_test.js.

- [ ] **Step 3: Implement UpdateCommands.js**

```js
// UpdateCommands.js -- {program, args[, env]} for each platform program the
// updater needs. The script engine has no SHA-256, no redirect-following
// download and no zip library (measured 2026-09-26), so these do the work.
// Paths are always their own arguments (or, on Windows, an environment
// variable), never spliced into command text.

var UpdateCommands = {};

UpdateCommands.isWin = function(s) { return String(s) === "win"; };

UpdateCommands.hash = function(system, path) {
    if (UpdateCommands.isWin(system)) {
        return { program: "powershell", env: { CAVECAD_HASH_PATH: path },
            args: ["-NoProfile", "-NonInteractive", "-Command",
                "(Get-FileHash -Algorithm SHA256 -LiteralPath $env:CAVECAD_HASH_PATH).Hash"] };
    }
    if (String(system) === "osx") { return { program: "shasum", args: ["-a", "256", path] }; }
    return { program: "sha256sum", args: [path] };
};

UpdateCommands.parseHash = function(stdout) {
    var m = /([0-9a-fA-F]{64})/.exec(String(stdout === undefined || stdout === null ? "" : stdout));
    return m ? m[1].toLowerCase() : null;
};

UpdateCommands.fetch = function(system, url, out) {
    return { program: UpdateCommands.isWin(system) ? "curl.exe" : "curl",
             args: ["-fsSL", "--retry", "2", "-o", out, url] };
};

/** Linux without curl: Python's urllib follows redirects too. */
UpdateCommands.fetchFallback = function(system, url, out) {
    return { program: "python3", args: ["-c",
        "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])", url, out] };
};

UpdateCommands.unzip = function(system, zip, dest) {
    if (String(system) === "linux") {
        return { program: "python3", args: ["-c",
            "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dest] };
    }
    return { program: "tar", args: ["-xf", zip, "-C", dest] };
};

/** Starts a helper that outlives CaveCAD (QProcess would kill its child). */
UpdateCommands.detach = function(system, script) {
    if (UpdateCommands.isWin(system)) {
        return { program: "cmd", args: ["/c", "start", "\"\"", "/min", "powershell",
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script] };
    }
    return { program: "/bin/sh", args: ["-c", "nohup /bin/sh \"$0\" >/dev/null 2>&1 &", script] };
};
```

- [ ] **Step 4: Implement UpdateRun.js**

```js
// UpdateRun.js -- runs {program, args[, env]} WITHOUT blocking: the answer
// arrives through QProcess.finished. The engine has no async networking,
// so this is how downloads and hashing stay off the UI's back.

var UpdateRun = {};

/** done({ok, code, stdout, error}) is called exactly once. */
UpdateRun.run = function(command, timeoutS, done) {
    var p = new QProcess();
    var settled = false;
    var timer = new QTimer();
    timer.singleShot = true;
    var finish = function(result) {
        if (settled) { return; }
        settled = true;
        timer.stop();
        done(result);
    };
    if (command.env) {
        var env = QProcessEnvironment.systemEnvironment();
        for (var k in command.env) { if (command.env.hasOwnProperty(k)) { env.insert(k, command.env[k]); } }
        p.setProcessEnvironment(env);
    }
    p.finished.connect(function(code, status) {
        var out = String(p.readAllStandardOutput());
        var err = String(p.readAllStandardError());
        finish({ ok: code === 0 && status === QProcess.NormalExit, code: code,
                 stdout: out, error: code === 0 ? "" : (command.program + " exited " + code + ": " + err) });
    });
    p.errorOccurred.connect(function(e) {
        if (e === QProcess.FailedToStart) {
            finish({ ok: false, code: -1, stdout: "", error: command.program + " would not start" });
        }
    });
    timer.timeout.connect(function() {
        p.kill();
        finish({ ok: false, code: -1, stdout: "", error: command.program + " timed out" });
    });
    timer.start((timeoutS || 60) * 1000);
    p.start(command.program, command.args);
    return p;
};
```

- [ ] **Step 5: Run** `tests/updater/run.sh`. Expected: `### UPDATER OK 20 (commands_test.js)`. If `p.errorOccurred` is undefined in the bindings, check with `typeof p.errorOccurred` and drop that block; `finished` still fires with code ≠ 0 on start failure (the `false` case covers it).
- [ ] **Step 6: Commit** `git add scripts/Help/CheckForUpdates/UpdateCommands.js scripts/Help/CheckForUpdates/UpdateRun.js tests/updater/commands_test.js && git commit -m "feat(updater): platform commands and async runner"`

---

### Task 4: UpdateDownload (manifest fetch, verified download, one retry)

**Goal:** Fetch the manifest, and download an asset verified against both the manifest hash and its `.sha256` sidecar, retrying once. Silent unless both attempts fail.

**Files:**
- Create: `scripts/Help/CheckForUpdates/UpdateDownload.js`
- Test: `tests/updater/download_test.js`

**Acceptance Criteria:**
- [ ] `UpdateDownload.manifest(done)` calls `done({ok, manifest, error})`; invalid JSON or a failed `UpdateCore.validate` is `ok:false`
- [ ] `UpdateDownload.verified(asset, expectedHex, dir, onProgress, done)` downloads `asset` and `asset + ".sha256"`, hashes, requires hash == expected == sidecar, and retries once on a mismatch; `done({ok, path, error, attempts})`
- [ ] on a mismatch the bad file is deleted before the retry; after two failures `ok:false` and no file is left
- [ ] `UpdateDownload.base` can be overridden by tests (a `file://` folder)

**Verify:** `tests/updater/run.sh` → `### UPDATER OK <n> (download_test.js)`

**Steps:**

- [ ] **Step 1: Write download_test.js (failing)**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCore.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");
load("scripts/Help/CheckForUpdates/UpdateDownload.js");

var hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
var src = QDir.tempPath() + "/cc-dl-src", dst = QDir.tempPath() + "/cc-dl-dst";
[src, dst].forEach(function(d) { (new QDir(d)).removeRecursively(); (new QDir()).mkpath(d); });
function write(p, s) { var f = new QFile(p); f.open(QIODevice.WriteOnly); f.write(new QByteArray(s)); f.close(); }
write(src + "/good.zip", "abc");
write(src + "/good.zip.sha256", hex + "  good.zip\n");
write(src + "/bad.zip", "abd");
write(src + "/bad.zip.sha256", hex + "  bad.zip\n");
write(src + "/latest.json", JSON.stringify({ schema: 1, tools: { version: "1", commit: "c", asset: "good.zip", sha256: hex, size: 3 }, platforms: {} }));
UpdateDownload.base = "file://" + src + "/";

var loop = new QEventLoop(), r = null;
UpdateDownload.manifest(function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok && r.manifest.tools.version === "1", "manifest fetched and validated: " + r.error);

r = null;
UpdateDownload.verified("good.zip", hex, dst, function() {}, function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "good file verifies: " + r.error);
eqs(r.attempts, 1, "first attempt enough");
ok(new QFileInfo(r.path).exists(), "verified file kept");

r = null;
UpdateDownload.verified("bad.zip", hex, dst, function() {}, function(x) { r = x; loop.quit(); }); loop.exec();
ok(!r.ok, "tampered file refused");
eqs(r.attempts, 2, "retried once");
ok(!new QFileInfo(dst + "/bad.zip").exists(), "refused file deleted");

write(src + "/good.zip.sha256", "0000000000000000000000000000000000000000000000000000000000000000  good.zip\n");
r = null;
UpdateDownload.verified("good.zip", hex, dst, function() {}, function(x) { r = x; loop.quit(); }); loop.exec();
ok(!r.ok, "sidecar disagreeing with the manifest is refused");
[src, dst].forEach(function(d) { (new QDir(d)).removeRecursively(); });
finish("download_test.js");
```

- [ ] **Step 2: Run.** Expected: FAIL for download_test.js.

- [ ] **Step 3: Implement UpdateDownload.js**

```js
// UpdateDownload.js -- fetch latest.json, and download an asset that must
// match BOTH the manifest's SHA-256 and its published .sha256 sidecar.
// Silent: a mismatch deletes the file and downloads once more; only a
// second failure comes back as ok:false. Nothing unverified is kept.

var UpdateDownload = {};
UpdateDownload.base = UpdateCore.BASE;   // tests point this at file://
UpdateDownload.TIMEOUT_S = 900;

UpdateDownload.system = function() { return RS.getSystemId(); };

/** Runs fetch, falling back to Python's urllib on Linux without curl. */
UpdateDownload.fetchTo = function(url, out, done) {
    var sys = UpdateDownload.system();
    UpdateRun.run(UpdateCommands.fetch(sys, url, out), UpdateDownload.TIMEOUT_S, function(r) {
        if (r.ok || sys !== "linux" || r.code !== -1) { done(r); return; }
        UpdateRun.run(UpdateCommands.fetchFallback(sys, url, out), UpdateDownload.TIMEOUT_S, done);
    });
};

UpdateDownload.readText = function(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return null; }
    var t = String(new QTextStream(f).readAll());
    f.close();
    return t;
};

UpdateDownload.manifest = function(done) {
    var out = QDir.tempPath() + "/cavecad-latest-" + (new Date()).getTime() + ".json";
    UpdateDownload.fetchTo(UpdateDownload.base + UpdateCore.MANIFEST, out, function(r) {
        var text = r.ok ? UpdateDownload.readText(out) : null;
        QFile.remove(out);
        if (text === null) { done({ ok: false, manifest: null, error: r.error || "no manifest" }); return; }
        var m;
        try { m = JSON.parse(text); } catch (e) { done({ ok: false, manifest: null, error: "manifest is not JSON" }); return; }
        var v = UpdateCore.validate(m);
        done({ ok: v.ok, manifest: v.ok ? m : null, error: v.error });
    });
};

/** onProgress(bytesSoFar) about twice a second while downloading. */
UpdateDownload.verified = function(asset, expected, dir, onProgress, done) {
    var path = dir + "/" + asset, side = path + ".sha256";
    var attempt = function(n) {
        QFile.remove(path); QFile.remove(side);
        var poll = new QTimer();
        poll.timeout.connect(function() { onProgress(new QFileInfo(path).size()); });
        poll.start(500);
        UpdateDownload.fetchTo(UpdateDownload.base + asset, path, function(r) {
            poll.stop();
            var fail = function(err) {
                QFile.remove(path); QFile.remove(side);
                if (n < 2) { attempt(n + 1); } else { done({ ok: false, path: null, error: err, attempts: n }); }
            };
            if (!r.ok) { fail(r.error); return; }
            UpdateDownload.fetchTo(UpdateDownload.base + asset + ".sha256", side, function(rs) {
                var sidecar = rs.ok ? UpdateCore.parseSidecar(UpdateDownload.readText(side)) : null;
                UpdateRun.run(UpdateCommands.hash(UpdateDownload.system(), path), 300, function(rh) {
                    var actual = rh.ok ? UpdateCommands.parseHash(rh.stdout) : null;
                    QFile.remove(side);
                    if (actual === null) { fail("could not hash the download: " + rh.error); return; }
                    if (actual !== String(expected).toLowerCase() || actual !== sidecar) {
                        fail("checksum mismatch"); return;
                    }
                    done({ ok: true, path: path, error: "", attempts: n });
                });
            });
        });
    };
    attempt(1);
};
```

- [ ] **Step 4: Run.** Expected: `### UPDATER OK 9 (download_test.js)`.
- [ ] **Step 5: Commit** `git add scripts/Help/CheckForUpdates/UpdateDownload.js tests/updater/download_test.js && git commit -m "feat(updater): verified download with one silent retry"`

---

### Task 5: Add-on precedence (one copy per add-on, highest VERSION)

**Goal:** When an add-on folder name exists both in the app's `scripts/` and in the per-user scripts root, only the copy with the higher `VERSION` loads.

**Files:**
- Modify: `scripts/AddOn.js` (`AddOn.isIgnored`, plus a new `AddOn.precedenceIgnores` and `AddOn.readVersion`)
- Test: `tests/updater/precedence_test.js`

**Acceptance Criteria:**
- [ ] `AddOn.precedenceIgnores(appScripts, userScripts)` returns absolute paths to skip: the bundled copy when the user copy is the same or newer, the user copy when the bundled one is newer; names present in only one root are untouched
- [ ] a copy without a `VERSION` file counts as `0`
- [ ] `AddOn.isIgnored(path)` also returns true for any path at or inside a precedence-ignored folder
- [ ] the existing `-ignore` argument behaviour is unchanged

**Verify:** `tests/updater/run.sh` → `### UPDATER OK <n> (precedence_test.js)`

**Steps:**

- [ ] **Step 1: Write precedence_test.js (failing)**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
var root = QDir.tempPath() + "/cc-prec";
(new QDir(root)).removeRecursively();
function mk(p, v) { (new QDir()).mkpath(p); if (v !== null) { var f = new QFile(p + "/VERSION"); f.open(QIODevice.WriteOnly); f.write(new QByteArray(v + "\n")); f.close(); } }
mk(root + "/app/CaveSurvey", "0.9.180.1"); mk(root + "/user/CaveSurvey", "0.9.181.0");
mk(root + "/app/Other", null);
mk(root + "/app/Older", "2.0"); mk(root + "/user/Older", "1.0");
mk(root + "/app/Same", "1.0"); mk(root + "/user/Same", "1.0");
var ign = AddOn.precedenceIgnores(root + "/app", root + "/user");
ok(ign.indexOf(root + "/app/CaveSurvey") >= 0, "older bundled CaveSurvey skipped");
ok(ign.indexOf(root + "/user/Older") >= 0, "older per-user copy skipped");
ok(ign.indexOf(root + "/app/Same") >= 0, "a tie goes to the per-user copy");
ok(ign.indexOf(root + "/app/Other") < 0, "an add-on in one root only is untouched");
eqs(AddOn.readVersion(root + "/app/Other"), "0", "no VERSION reads as 0");
AddOn.precedence = ign;
ok(AddOn.isIgnored(root + "/app/CaveSurvey/Core/CsAll.js"), "files inside a skipped copy are ignored");
ok(!AddOn.isIgnored(root + "/user/CaveSurvey/Core/CsAll.js"), "the winning copy is not");
AddOn.precedence = null;
(new QDir(root)).removeRecursively();
finish("precedence_test.js");
```

- [ ] **Step 2: Run.** Expected: FAIL (`AddOn.precedenceIgnores` undefined; AddOn.js is loaded at startup, so the new functions are visible once added).

- [ ] **Step 3: Implement in scripts/AddOn.js**, just before `AddOn.isIgnored = function(path) {`:

```js
/**
 * CaveCAD: one copy per add-on. The app ships an add-on (CaveSurvey) in
 * its own scripts folder, and the updater installs newer ones into the
 * per-user scripts folder. Loading both registers every tool twice, so
 * for each folder name in both roots only the higher VERSION loads; a tie
 * goes to the per-user copy.
 */
AddOn.readVersion = function(dir) {
    var f = new QFile(dir + "/VERSION");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return "0"; }
    var v = String(new QTextStream(f).readAll()).trim();
    f.close();
    return v === "" ? "0" : v;
};

AddOn.compareVersions = function(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var x = parseInt(pa[i] || "0", 10) || 0, y = parseInt(pb[i] || "0", 10) || 0;
        if (x !== y) { return x - y; }
    }
    return 0;
};

AddOn.precedenceIgnores = function(appScripts, userScripts) {
    var out = [];
    var app = new QDir(appScripts), user = new QDir(userScripts);
    if (!app.exists() || !user.exists()) { return out; }
    var names = user.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
    for (var i = 0; i < names.length; i++) {
        var a = app.absolutePath() + "/" + names[i], u = user.absolutePath() + "/" + names[i];
        if (!new QFileInfo(a).isDir()) { continue; }
        out.push(AddOn.compareVersions(AddOn.readVersion(a), AddOn.readVersion(u)) > 0 ? u : a);
    }
    return out;
};

AddOn.precedence = null;
```

In `AddOn.isIgnored`, before the existing `for (var k=0; k<AddOn.ignores.length; ++k)` loop, add:

```js
    if (AddOn.precedence === null) {
        AddOn.precedence = AddOn.precedenceIgnores(
            new QFileInfo("scripts").absoluteFilePath(),
            RSettings.getDataLocation() + "/scripts");
    }
    var abs = new QFileInfo(path).absoluteFilePath();
    for (var q = 0; q < AddOn.precedence.length; ++q) {
        var skip = AddOn.precedence[q];
        if (abs === skip || abs.indexOf(skip + "/") === 0) {
            return true;
        }
    }
```

- [ ] **Step 4: Run.** Expected: `### UPDATER OK 7 (precedence_test.js)`.
- [ ] **Step 5: Live check.** Rebuild (`ninja CaveCAD`), package with `tools/package-macos.sh debug "$(which macdeployqt)" /tmp/pkg`, copy an older `CaveSurvey` (VERSION `0.0.1`) into `/tmp/pkg/CaveCAD.app/Contents/Resources/scripts/`, and run the probe from `/private/tmp/.../probe.js` (the AddOn.getAddOns count). Expected: the CaveSurvey paths come only from the per-user folder (about 31, not 62).
- [ ] **Step 6: Commit** `git add scripts/AddOn.js tests/updater/precedence_test.js && git commit -m "feat: one copy per add-on across scripts roots, highest VERSION wins"`

---

### Task 6: UpdateApply (tools-only swap, full-update helpers)

**Goal:** Install a verified tools zip into the per-user scripts root, and write plus launch the per-platform helper that swaps in a full app after CaveCAD quits.

**Files:**
- Create: `scripts/Help/CheckForUpdates/UpdateApply.js`
- Test: `tests/updater/apply_test.js`

**Acceptance Criteria:**
- [ ] `UpdateApply.installTools(zipPath, expectedVersion, userScripts, done)` unpacks into `userScripts/.update-<stamp>`, requires `CaveSurvey/VERSION == expectedVersion`, renames the old `CaveSurvey` aside, moves the new one in and deletes the old; on any failure the old folder is untouched and the staging folder removed
- [ ] `UpdateApply.installTarget(system, appFilePath, env)` returns what a full update replaces: the exe folder (win), the `.app` (osx), `$APPIMAGE` (linux), or null when unknown
- [ ] `UpdateApply.writable(target)` is true only if the target's parent folder can take a new entry (a probe file is created and removed)
- [ ] `UpdateApply.helperScript(system, {pid, download, target, relaunch})` returns script text that waits for `pid`, installs, relaunches, and on failure leaves the old build and relaunches it; paths are quoted
- [ ] engine test: `installTools` with a real zip made by `ditto`/`zip` replaces a fake old CaveSurvey; the wrong version is refused with the old one intact; the `helperScript("osx", …)` text contains the quoted paths and `kill -0 <pid>`

**Verify:** `tests/updater/run.sh` → `### UPDATER OK <n> (apply_test.js)`

**Steps:**

- [ ] **Step 1: Write apply_test.js (failing)**

```js
include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");
load("scripts/Help/CheckForUpdates/UpdateApply.js");

var root = QDir.tempPath() + "/cc-apply";
(new QDir(root)).removeRecursively();
function mk(p, v) { (new QDir()).mkpath(p); var f = new QFile(p + "/VERSION"); f.open(QIODevice.WriteOnly); f.write(new QByteArray(v)); f.close(); }
mk(root + "/new/CaveSurvey", "0.9.182.0");
mk(root + "/user/CaveSurvey", "0.9.181.0");
var loop = new QEventLoop(), r = null;
var zipCmd = RS.getSystemId() === "osx"
    ? { program: "/usr/bin/ditto", args: ["-c", "-k", "--keepParent", root + "/new/CaveSurvey", root + "/tools.zip"] }
    : { program: "zip", args: ["-r", "-q", root + "/tools.zip", "CaveSurvey"], workingDirectory: root + "/new" };
UpdateRun.run(zipCmd, 30, function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "made a tools zip: " + r.error);

r = null;
UpdateApply.installTools(root + "/tools.zip", "9.9.9", root + "/user", function(x) { r = x; loop.quit(); }); loop.exec();
ok(!r.ok, "wrong version refused");
eqs(AddOn.readVersion(root + "/user/CaveSurvey"), "0.9.181.0", "old copy untouched after a refusal");

r = null;
UpdateApply.installTools(root + "/tools.zip", "0.9.182.0", root + "/user", function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "tools installed: " + r.error);
eqs(AddOn.readVersion(root + "/user/CaveSurvey"), "0.9.182.0", "new copy in place");
eqs(new QDir(root + "/user").entryList([".update-*", "CaveSurvey.old*"], QDir.Dirs | QDir.Hidden, 0).length, 0, "no staging or old folder left");

eqs(UpdateApply.installTarget("osx", "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD", {}), "/Applications/CaveCAD.app", "macOS replaces the .app");
eqs(UpdateApply.installTarget("win", "C:/Tools/CaveCAD/cavecad.exe", {}), "C:/Tools/CaveCAD", "Windows replaces the exe folder");
eqs(UpdateApply.installTarget("linux", "/tmp/.mount_x/usr/bin/cavecad-bin", { APPIMAGE: "/home/n/CaveCAD.AppImage" }), "/home/n/CaveCAD.AppImage", "Linux replaces $APPIMAGE");
ok(UpdateApply.installTarget("linux", "/usr/bin/cavecad-bin", {}) === null, "Linux outside an AppImage: unknown target");
ok(UpdateApply.writable(root + "/user/CaveSurvey"), "a temp folder is writable");

var sh = UpdateApply.helperScript("osx", { pid: 4242, download: "/tmp/a b.dmg", target: "/Applications/CaveCAD.app", relaunch: "/Applications/CaveCAD.app" });
ok(sh.indexOf("kill -0 4242") >= 0, "helper waits for the pid");
ok(sh.indexOf("'/tmp/a b.dmg'") >= 0, "paths are single-quoted");
var ps = UpdateApply.helperScript("win", { pid: 4242, download: "C:/t/n.zip", target: "C:/Tools/CaveCAD", relaunch: "C:/Tools/CaveCAD/cavecad.exe" });
ok(ps.indexOf("Wait-Process -Id 4242") >= 0, "Windows helper waits for the pid");
(new QDir(root)).removeRecursively();
finish("apply_test.js");
```

`AddOn.readVersion` comes from Task 5 (AddOn.js is loaded at startup).

- [ ] **Step 2: Run.** Expected: FAIL for apply_test.js.

- [ ] **Step 3: Implement UpdateApply.js**

```js
// UpdateApply.js -- putting a VERIFIED download in place.

var UpdateApply = {};

UpdateApply.stamp = function() { return String((new Date()).getTime()); };

/** Tools-only: unpack beside the per-user CaveSurvey and swap by rename. */
UpdateApply.installTools = function(zipPath, expectedVersion, userScripts, done) {
    var staging = userScripts + "/.update-" + UpdateApply.stamp();
    var fail = function(err) { (new QDir(staging)).removeRecursively(); done({ ok: false, error: err }); };
    if (!(new QDir()).mkpath(staging)) { done({ ok: false, error: "cannot create " + staging }); return; }
    UpdateRun.run(UpdateCommands.unzip(RS.getSystemId(), zipPath, staging), 300, function(r) {
        if (!r.ok) { fail(r.error); return; }
        var fresh = staging + "/CaveSurvey";
        if (AddOn.readVersion(fresh) !== String(expectedVersion)) {
            fail("the download holds tools " + AddOn.readVersion(fresh) + ", expected " + expectedVersion);
            return;
        }
        var dest = userScripts + "/CaveSurvey", old = userScripts + "/CaveSurvey.old-" + UpdateApply.stamp();
        var hadOld = new QFileInfo(dest).exists();
        if (hadOld && !(new QDir()).rename(dest, old)) { fail("cannot move the old tools aside"); return; }
        if (!(new QDir()).rename(fresh, dest)) {
            if (hadOld) { (new QDir()).rename(old, dest); }
            fail("cannot move the new tools into place");
            return;
        }
        if (hadOld) { (new QDir(old)).removeRecursively(); }
        (new QDir(staging)).removeRecursively();
        done({ ok: true, error: "" });
    });
};

/** What a full update replaces, or null if this is not a packaged app. */
UpdateApply.installTarget = function(system, appFilePath, env) {
    var p = String(appFilePath).replace(/\\/g, "/");
    if (system === "osx") {
        var i = p.indexOf(".app/Contents/MacOS/");
        return i < 0 ? null : p.substring(0, i + 4);
    }
    if (system === "win") { return p.substring(0, p.lastIndexOf("/")); }
    var ai = env && env.APPIMAGE ? String(env.APPIMAGE) : "";
    return ai === "" ? null : ai;
};

UpdateApply.writable = function(target) {
    var parent = new QFileInfo(target).absolutePath();
    var probe = parent + "/.cavecad-write-probe-" + UpdateApply.stamp();
    var f = new QFile(probe);
    if (!f.open(QIODevice.WriteOnly)) { return false; }
    f.close();
    return QFile.remove(probe);
};

UpdateApply.q = function(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };      // sh
UpdateApply.pq = function(s) { return "'" + String(s).replace(/'/g, "''") + "'"; };        // PowerShell

/**
 * The helper that runs after CaveCAD quits. o: {pid, download, target,
 * relaunch}. The old build is renamed aside only once the new one is
 * complete, and is put back (and relaunched) if anything fails.
 */
UpdateApply.helperScript = function(system, o) {
    var q = UpdateApply.q;
    if (system === "win") {
        var pq = UpdateApply.pq;
        return [
            "$ErrorActionPreference = 'Stop'",
            "try { Wait-Process -Id " + o.pid + " -Timeout 60 } catch {}",
            "$target = " + pq(o.target) + "; $new = $target + '.new'; $old = $target + '.old'",
            "try {",
            "  if (Test-Path $new) { Remove-Item -Recurse -Force $new }",
            "  $unz = $new + '.unz'; if (Test-Path $unz) { Remove-Item -Recurse -Force $unz }",
            "  Expand-Archive -LiteralPath " + pq(o.download) + " -DestinationPath $unz",
            "  Move-Item (Join-Path $unz 'CaveCAD') $new; Remove-Item -Recurse -Force $unz",
            "  if (Test-Path $old) { Remove-Item -Recurse -Force $old }",
            "  Rename-Item $target (Split-Path $old -Leaf)",
            "  Rename-Item $new (Split-Path $target -Leaf)",
            "  Remove-Item -Recurse -Force $old",
            "} catch {",
            "  if (-not (Test-Path $target) -and (Test-Path $old)) { Rename-Item $old (Split-Path $target -Leaf) }",
            "}",
            "Start-Process " + pq(o.relaunch)
        ].join("\r\n");
    }
    var install = system === "osx" ? [
        "mnt=$(mktemp -d) || exit 1",
        "hdiutil attach -quiet -nobrowse -readonly -mountpoint \"$mnt\" " + q(o.download) + " || exit 1",
        "ditto \"$mnt/CaveCAD.app\" \"$new\"; rc=$?",
        "hdiutil detach -quiet \"$mnt\"",
        "[ $rc -eq 0 ] || exit 1"
    ] : [
        "cp " + q(o.download) + " \"$new\" && chmod +x \"$new\" || exit 1"
    ];
    return [
        "#!/bin/sh",
        "i=0; while kill -0 " + o.pid + " 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done",
        "target=" + q(o.target) + "; new=\"$target.new\"; old=\"$target.old\"",
        "rm -rf \"$new\" \"$old\"",
        "( " + install.join("; ") + " ) && mv \"$target\" \"$old\" && mv \"$new\" \"$target\" && rm -rf \"$old\"",
        "[ -e \"$target\" ] || mv \"$old\" \"$target\"",
        system === "osx" ? "open " + q(o.relaunch) : "nohup " + q(o.relaunch) + " >/dev/null 2>&1 &"
    ].join("\n") + "\n";
};

/** Writes the helper to a temp file and starts it detached. */
UpdateApply.launchHelper = function(system, o, done) {
    var path = QDir.tempPath() + "/cavecad-update-" + UpdateApply.stamp() + (system === "win" ? ".ps1" : ".sh");
    var f = new QFile(path);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) { done({ ok: false, error: "cannot write " + path }); return; }
    f.write(new QByteArray(UpdateApply.helperScript(system, o)));
    f.close();
    UpdateRun.run(UpdateCommands.detach(system, path), 30, done);
};
```

- [ ] **Step 4: Run.** Expected: `### UPDATER OK 14 (apply_test.js)`.
- [ ] **Step 5: Commit** `git add scripts/Help/CheckForUpdates/UpdateApply.js tests/updater/apply_test.js && git commit -m "feat(updater): tools swap and full-update helpers"`

---

### Task 7: CI publishes the manifest, tools zip, sidecars and build identity

**Goal:** Each packaged app carries `cavecad-build.json`, and `latest-build` gains `latest.json`, `CaveSurvey-tools.zip` and a `.sha256` for every file, verified in CI before publishing.

**Files:**
- Create: `tools/make_manifest.py`
- Test: `tests/test_make_manifest.py`
- Modify: `.github/workflows/windows.yml` (Package step), `.github/workflows/linux.yml` (Assemble AppDir step), `tools/package-macos.sh` (after resources are copied), `.github/workflows/assemble.yml` (addon, windows-linux, macos and publish jobs)

**Acceptance Criteria:**
- [ ] `python3 -m unittest tests.test_make_manifest` passes: the manifest schema 1, tools entry, one entry per platform present, `sha256`/`size` right, and sidecars in `sha256sum` format
- [ ] each app's `cavecad-build.json` = `{"platform": "<id>", "app_commit": "<GITHUB_SHA>"}`, written in the Windows exe folder, macOS `Contents/Resources`, and AppImage `usr/bin`
- [ ] assemble publishes `CaveSurvey-tools.zip`, `latest.json` and `*.sha256`, and `sha256sum -c` passes on all sidecars before `gh release create`
- [ ] after a push, `gh release view latest-build` lists `latest.json` and the sidecars

**Verify:** `python3 -m unittest tests.test_make_manifest -v` → OK; after CI, `curl -sL https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/latest.json | python3 -m json.tool` shows every platform

**Steps:**

- [ ] **Step 1: Write tests/test_make_manifest.py (failing)**

```python
import hashlib, json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import make_manifest


class TestMakeManifest(unittest.TestCase):
    def test_manifest_and_sidecars(self):
        d = tempfile.mkdtemp()
        files = {"CaveCAD-windows-x64.zip": b"win", "CaveCAD-macos-arm64.dmg": b"mac",
                 "CaveSurvey-tools.zip": b"tools"}
        for n, b in files.items():
            open(os.path.join(d, n), "wb").write(b)
        m = make_manifest.build(d, tools_version="0.9.181.0", tools_commit="e7b4095",
                                app_commits={"windows-x64": "aaa", "macos-arm64": "bbb",
                                             "linux-x86_64": "ccc"},
                                published="2026-09-26T00:00:00Z")
        self.assertEqual(m["schema"], 1)
        self.assertEqual(m["tools"]["version"], "0.9.181.0")
        self.assertEqual(m["tools"]["sha256"], hashlib.sha256(b"tools").hexdigest())
        self.assertEqual(set(m["platforms"]), {"windows-x64", "macos-arm64"},
                         "a platform with no file is left out")
        self.assertEqual(m["platforms"]["windows-x64"]["app_commit"], "aaa")
        self.assertEqual(m["platforms"]["macos-arm64"]["size"], 3)
        make_manifest.write(d, m)
        side = open(os.path.join(d, "CaveCAD-windows-x64.zip.sha256")).read()
        self.assertEqual(side, hashlib.sha256(b"win").hexdigest() + "  CaveCAD-windows-x64.zip\n")
        self.assertTrue(os.path.exists(os.path.join(d, "latest.json.sha256")))
        self.assertEqual(json.load(open(os.path.join(d, "latest.json")))["schema"], 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run** `python3 -m unittest tests.test_make_manifest`. Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement tools/make_manifest.py**

```python
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
```

- [ ] **Step 4: Run** `python3 -m unittest tests.test_make_manifest -v`. Expected: OK.

- [ ] **Step 5: Build identity in the packagers.**
  - `tools/package-macos.sh`, after `"$SRC/tools/strip-runtime.sh" "$APP/Contents/Resources"`:
    ```sh
    # what the updater compares against latest.json (dev packages: "dev")
    printf '{"platform": "macos-arm64", "app_commit": "%s"}\n' "${GITHUB_SHA:-dev}" \
        > "$APP/Contents/Resources/cavecad-build.json"
    ```
  - `.github/workflows/linux.yml`, Assemble AppDir step, after `tools/strip-runtime.sh AppDir/usr/bin`:
    ```sh
    printf '{"platform": "linux-%s", "app_commit": "%s"}\n' "$ARCH" "$GITHUB_SHA" > AppDir/usr/bin/cavecad-build.json
    ```
  - `.github/workflows/windows.yml`, the Strip step becomes:
    ```yaml
      - name: Strip
        shell: bash
        run: |
          tools/strip-runtime.sh release
          printf '{"platform": "windows-%s", "app_commit": "%s"}\n' "$ARCH" "$GITHUB_SHA" > release/cavecad-build.json
    ```
  - The updater treats `app_commit` `"dev"` like a missing file (Task 8 reads it that way).

- [ ] **Step 6: assemble.yml.**
  - addon job, after `cat VERSION > addon/VERSION`, add `git rev-parse HEAD > addon/COMMIT`.
  - Publish job, before `ls -l dist`:
    ```sh
    (cd addon && zip -q -9 -r ../dist/CaveSurvey-tools.zip CaveSurvey)
    app() { gh release download app-base -R "$GITHUB_REPOSITORY" -p "base-$1.commit" -O - 2>/dev/null; }
    set --
    for p in windows-x64 windows-arm64 macos-arm64 linux-x86_64 linux-aarch64; do
      c=$(app "$p") && [ -n "$c" ] && set -- "$@" "$p=$c"
    done
    python3 "$GITHUB_WORKSPACE/cavecad-src/tools/make_manifest.py" dist "$(cat addon/VERSION)" "$(cat addon/COMMIT)" "$@"
    (cd dist && sha256sum -c --quiet *.sha256)
    ```
  - The publish job needs this repo checked out for `make_manifest.py`: add `- uses: actions/checkout@v7` with `path: cavecad-src` as its first step.

- [ ] **Step 7:** `actionlint .github/workflows/*.yml` (SC2046 in linux.yml is pre-existing). Commit: `git add tools/make_manifest.py tests/test_make_manifest.py tools/package-macos.sh .github/workflows && git commit -m "ci: publish latest.json, tools zip, sha256 sidecars and build identity"`

---

### Task 8: The update UI (startup check, menu, prompt, progress, restart)

**Goal:** Replace QCAD's checker with CaveCAD's: a quiet startup check and a Help > Check for Updates action, both going through one flow that prompts, downloads with progress, installs and offers a restart.

**Files:**
- Modify (rewrite): `scripts/Help/CheckForUpdates/CheckForUpdates.js`, `scripts/Help/CheckForUpdates/CheckForUpdatesPostInit.js`
- Modify: `scripts/Help/CheckForUpdates/CheckForUpdatesInit.js` (menu text unchanged; keep as is unless the label says QCAD)
- Delete: `scripts/Help/CheckForUpdates/CheckForUpdatesDialog.ui`
- Modify: `src/scripts/scripts.qrc` and `src/scripts/scripts_release.qrc` if they list `CheckForUpdatesDialog.ui` (remove the line)

**Acceptance Criteria:**
- [ ] a startup with `CheckForUpdates/AutoCheck` on fetches the manifest about 3 s after start, and the UI stays responsive while it runs
- [ ] offline or on a malformed manifest the startup check shows nothing; Help > Check for Updates shows "Could not check for updates: <reason>"
- [ ] the prompt shows the kind (tools `a → b`, or app plus size) with Update now, Later and Skip this version, plus a "Check for updates at startup" checkbox bound to `CheckForUpdates/AutoCheck`
- [ ] Skip stores `UpdateCore.key(manifest)` in `CheckForUpdates/SkippedKey`, and the startup check stays silent while the key matches; the menu action ignores the skip
- [ ] Update now shows a progress dialog with MB downloaded; on success the tools are installed or the helper is launched; then "Update installed. Restart now?"
- [ ] a full update to a non-writable target opens the release page instead of downloading
- [ ] a dev build (no `cavecad-build.json`, or `app_commit` "dev") has no startup check, and the menu says "This is a development build; updates come from publish.sh"

**Verify:** Manual on the macOS dev package (Step 5) plus `tests/updater/run.sh` still all OK.

**Steps:**

- [ ] **Step 1: Rewrite CheckForUpdates.js**

```js
// CheckForUpdates.js -- CaveCAD's updater UI (replaces QCAD's, which read
// a news page from qcad.org over plain HTTP). The logic lives in
// UpdateCore / UpdateDownload / UpdateApply; this file is only the flow.

include("scripts/Help/Help.js");
include("UpdateCore.js");
include("UpdateCommands.js");
include("UpdateRun.js");
include("UpdateDownload.js");
include("UpdateApply.js");

function CheckForUpdates(guiAction) { Help.call(this, guiAction); }
CheckForUpdates.prototype = new Help();
CheckForUpdates.RELEASE_PAGE = "https://github.com/Nate-the-Ace/cavecad-src/releases/tag/latest-build";

CheckForUpdates.prototype.beginEvent = function() {
    Help.prototype.beginEvent.call(this);
    CheckForUpdates.run(true);
    this.terminate();
};

/** {platform, appCommit, toolsVersion}; platform null for a dev build. */
CheckForUpdates.local = function() {
    var info = { platform: null, appCommit: null, toolsVersion: "0" };
    var f = new QFile(RSettings.getApplicationPath() + "/cavecad-build.json");
    if (f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        try {
            var j = JSON.parse(String(new QTextStream(f).readAll()));
            if (j.app_commit && j.app_commit !== "dev") { info.platform = j.platform; info.appCommit = j.app_commit; }
        } catch (e) {}
        f.close();
    }
    var user = RSettings.getDataLocation() + "/scripts/CaveSurvey", app = "scripts/CaveSurvey";
    var uv = AddOn.readVersion(user), av = AddOn.readVersion(app);
    info.toolsVersion = AddOn.compareVersions(uv, av) >= 0 && new QFileInfo(user).exists() ? uv : av;
    return info;
};

CheckForUpdates.say = function(text) {
    QMessageBox.information(RMainWindowQt.getMainWindow(), qsTr("CaveCAD Updates"), text);
};

/** interactive: from the menu (always answers). false: startup (silent). */
CheckForUpdates.run = function(interactive) {
    var local = CheckForUpdates.local();
    if (local.platform === null) {
        if (interactive) { CheckForUpdates.say(qsTr("This is a development build; updates come from publish.sh.")); }
        return;
    }
    UpdateDownload.manifest(function(r) {
        if (!r.ok) {
            if (interactive) { CheckForUpdates.say(qsTr("Could not check for updates: %1").arg(r.error)); }
            return;
        }
        var d = UpdateCore.decide(r.manifest, local);
        var key = UpdateCore.key(r.manifest);
        if (d.kind === "none" || d.kind === "dev") {
            if (interactive) {
                CheckForUpdates.say(qsTr("You're up to date (app %1, tools %2).")
                    .arg(String(local.appCommit).substring(0, 8)).arg(local.toolsVersion));
            }
            return;
        }
        if (!interactive && RSettings.getStringValue(UpdateCore.SETTING_SKIP, "") === key) { return; }
        CheckForUpdates.prompt(d, key, local);
    });
};

CheckForUpdates.prompt = function(d, key, local) {
    var win = RMainWindowQt.getMainWindow();
    var box = new QMessageBox(win);
    box.windowTitle = qsTr("CaveCAD Update");
    box.text = d.kind === "tools"
        ? qsTr("Cave Survey tools %1 → %2 is available.").arg(d.fromVersion).arg(d.toolsVersion)
        : qsTr("A CaveCAD app update is available (%1 MB, includes tools %2).")
            .arg(Math.round((d.size || 0) / 1048576)).arg(d.toolsVersion);
    var now = box.addButton(qsTr("Update now"), QMessageBox.AcceptRole);
    box.addButton(qsTr("Later"), QMessageBox.RejectRole);
    var skip = box.addButton(qsTr("Skip this version"), QMessageBox.DestructiveRole);
    var auto = new QCheckBox(qsTr("Check for updates at startup"));
    auto.checked = RSettings.getBoolValue(UpdateCore.SETTING_AUTO, true);
    box.setCheckBox(auto);
    box.exec();
    RSettings.setValue(UpdateCore.SETTING_AUTO, auto.checked);
    var clicked = box.clickedButton();
    destrDialog(box);
    if (clicked === skip) { RSettings.setValue(UpdateCore.SETTING_SKIP, key); return; }
    if (clicked !== now) { return; }
    CheckForUpdates.apply(d);
};

CheckForUpdates.apply = function(d) {
    var sys = RS.getSystemId();
    var target = null;
    if (d.kind === "full") {
        var env = { APPIMAGE: QProcessEnvironment.systemEnvironment().value("APPIMAGE", "") };
        target = UpdateApply.installTarget(sys, QCoreApplication.applicationFilePath(), env);
        if (target === null || !UpdateApply.writable(target)) {
            CheckForUpdates.say(qsTr("CaveCAD can't replace itself where it is installed. " +
                "The release page will open so you can download it."));
            QDesktopServices.openUrl(new QUrl(CheckForUpdates.RELEASE_PAGE));
            return;
        }
    }
    var progress = new QProgressDialog(qsTr("Downloading..."), "", 0, 0, RMainWindowQt.getMainWindow());
    progress.setCancelButton(null);
    progress.windowTitle = qsTr("CaveCAD Update");
    progress.show();
    var dir = QDir.tempPath() + "/cavecad-update-" + UpdateApply.stamp();
    (new QDir()).mkpath(dir);
    UpdateDownload.verified(d.asset, d.sha256, dir, function(bytes) {
        progress.labelText = qsTr("Downloading... %1 MB").arg((bytes / 1048576).toFixed(1));
    }, function(r) {
        if (!r.ok) {
            progress.close(); destrDialog(progress);
            CheckForUpdates.say(qsTr("The download didn't verify; nothing was changed.\n%1\n\n%2")
                .arg(r.error).arg(CheckForUpdates.RELEASE_PAGE));
            return;
        }
        progress.labelText = qsTr("Installing...");
        if (d.kind === "tools") {
            UpdateApply.installTools(r.path, d.toolsVersion, RSettings.getDataLocation() + "/scripts", function(ir) {
                progress.close(); destrDialog(progress);
                if (!ir.ok) { CheckForUpdates.say(qsTr("The update could not be installed: %1").arg(ir.error)); return; }
                CheckForUpdates.restart(null);
            });
            return;
        }
        progress.close(); destrDialog(progress);
        CheckForUpdates.restart({ pid: QCoreApplication.applicationPid(), download: r.path,
            target: target, relaunch: sys === "osx" ? target : (sys === "win" ? target + "/cavecad.exe" : target) });
    });
};

/** helper null: tools-only (relaunch ourselves); else a full update. */
CheckForUpdates.restart = function(helper) {
    var win = RMainWindowQt.getMainWindow();
    var yes = QMessageBox.question(win, qsTr("CaveCAD Update"),
        qsTr("Update installed. Restart now?"), QMessageBox.Yes | QMessageBox.No) === QMessageBox.Yes;
    var sys = RS.getSystemId();
    if (helper !== null) {
        // The helper waits for this process to exit, whenever that is.
        UpdateApply.launchHelper(sys, helper, function() {});
    }
    if (!yes) { return; }
    if (helper === null) {
        var self = QCoreApplication.applicationFilePath();
        var relaunch = UpdateApply.installTarget(sys, self, { APPIMAGE: QProcessEnvironment.systemEnvironment().value("APPIMAGE", "") }) || self;
        UpdateApply.launchHelper(sys, { pid: QCoreApplication.applicationPid(), download: "", target: "", relaunch: relaunch, relaunchOnly: true }, function() {});
    }
    win.close();
};
```

  Add to `UpdateApply.helperScript` (Task 6 file) at the top of the function:

```js
    if (o.relaunchOnly) {
        if (system === "win") {
            return "try { Wait-Process -Id " + o.pid + " -Timeout 60 } catch {}\r\nStart-Process " + UpdateApply.pq(o.relaunch);
        }
        return "#!/bin/sh\ni=0; while kill -0 " + o.pid + " 2>/dev/null && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done\n" +
            (system === "osx" ? "open " : "nohup ") + UpdateApply.q(o.relaunch) + (system === "osx" ? "\n" : " >/dev/null 2>&1 &\n");
    }
```

  and a matching assertion to apply_test.js: `ok(UpdateApply.helperScript("osx", {pid: 1, relaunch: "/A.app", relaunchOnly: true}).indexOf("open '/A.app'") >= 0, "relaunch-only helper");`

- [ ] **Step 2: Rewrite CheckForUpdatesPostInit.js**

```js
// Startup check: a few seconds after the window is up, never blocking it.
// Silent unless there is something to offer.
function postInit() {
    if (RSettings.hasQuitFlag()) { return; }
    include("scripts/Help/CheckForUpdates/CheckForUpdates.js");
    if (!RSettings.getBoolValue(UpdateCore.SETTING_AUTO, true)) { return; }
    var t = new QTimer(RMainWindowQt.getMainWindow());
    t.singleShot = true;
    t.timeout.connect(function() { CheckForUpdates.run(false); });
    t.start(3000);
}
```

- [ ] **Step 3: Remove the dialog.** `git rm scripts/Help/CheckForUpdates/CheckForUpdatesDialog.ui`; `git grep -n CheckForUpdatesDialog`, and delete any lines in `src/scripts/*.qrc`.

- [ ] **Step 4: Run** `tests/updater/run.sh`. Expected: every file OK (apply_test.js now has one more assertion).

- [ ] **Step 5: Manual macOS check.**
  1. `ninja CaveCAD && tools/package-macos.sh debug "$(which macdeployqt)" /tmp/pkg`.
  2. Write `{"platform":"macos-arm64","app_commit":"0000"}` to `/tmp/pkg/CaveCAD.app/Contents/Resources/cavecad-build.json`, which forces a full offer.
  3. Launch `/tmp/pkg/CaveCAD.app`. Within about 5 s the prompt should offer an app update. Press Later and confirm the UI stayed responsive.
  4. Help > Check for Updates shows the prompt again. Skip, relaunch, and confirm there's no prompt; the menu still offers it.
  5. Set app_commit to the published one and CaveSurvey VERSION to `0.0.1` in the per-user folder. The prompt offers tools; Update now leaves the per-user VERSION equal to the published version, and Restart relaunches.
- [ ] **Step 6: Commit** `git add -A scripts/Help/CheckForUpdates src/scripts tests/updater && git commit -m "feat: CaveCAD's own update check, prompt and installer"`

---

### Task 9: Handbook, README and end-to-end release test

**Goal:** Document the updater, push, and prove a real tools-only and full update on published builds.

**Files:**
- Modify: `README.md` (an "Updates" section: what it checks, how to turn it off, the checksum guarantee and its limit)
- Modify: `NOTICE.md` only if it names QCAD's update checker (check with `git grep -n "qcad.org/qcad/version"`)

**Acceptance Criteria:**
- [ ] README explains the startup check, Help > Check for Updates, Skip, the checkbox, tools-only vs full, and that SHA-256 catches corruption but not a replaced file plus checksum
- [ ] after the push, CI publishes `latest-build` with `latest.json` and sidecars (`sha256sum -c` green in the log)
- [ ] on the Mac: installing the published dmg, then publishing a tools-only change (bumping the tools VERSION and pushing `legacy-map`), results in the prompt at the next start (within the ~30 min assembly cadence) and a working tools update after Restart
- [ ] on the Windows machine: the same tools-only update works, and a full update (after an app push) replaces the folder and relaunches

**Verify:** the release assets list, plus the four manual observations above, reported with screenshots or the version shown in Help > About.

**Steps:**

- [ ] **Step 1:** Write the README section (plain prose, the facts above).
- [ ] **Step 2:** `git push origin cavecad`; watch CI; `gh release view latest-build --json assets -q '.assets[].name'` must include `latest.json`, `CaveSurvey-tools.zip` and the `.sha256` files.
- [ ] **Step 3:** Run the manual update checks in the acceptance criteria, on the Mac and then Windows. Report the results with the releases link: https://github.com/Nate-the-Ace/cavecad-src/releases

---

## Self-review against the spec

- The published manifest, tools zip and sidecars are Task 7; build identity is Task 7 Step 5.
- The decision rules (dev, platform absent, full, tools, none) are Task 2; dev builds are also handled in Task 8.
- Startup (async, 3 s, silent) and the menu are Task 8. Async comes from `QProcess.finished` because the engine has no async networking (measured).
- The fixed base URL and unsafe names are Task 2 (`BASE`, `safeName`). Download with silent verification and one retry, and nothing kept unverified, is Task 4. Hashing via platform tools is Task 3.
- The tools-only swap is Task 6; one copy per add-on is Task 5; full update helpers, the not-writable path and restoring the old build are Task 6 and Task 8. Restart is Task 8.
- Testing: unit and engine tests are Tasks 2–6; the CI `sha256sum -c` is Task 7; manual per-platform checks are Tasks 8 and 9.
- Names are consistent throughout: `UpdateCore.decide/validate/key/parseSidecar/assetUrl/BASE/SETTING_*`, `UpdateCommands.hash/parseHash/fetch/fetchFallback/unzip/detach`, `UpdateRun.run`, `UpdateDownload.manifest/verified/base`, `UpdateApply.installTools/installTarget/writable/helperScript/launchHelper/stamp/q/pq`, and `AddOn.readVersion/compareVersions/precedenceIgnores/precedence`.
