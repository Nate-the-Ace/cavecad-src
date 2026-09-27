include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
// The update UI's decisions (no dialogs): what the app says it is, which
// tools version it loads, and what a finished check does.
load("scripts/library.js");
load("scripts/AddOn.js");
load("scripts/Help/CheckForUpdates/CcUpdateCore.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/CheckForUpdates/CcUpdateDownload.js");
load("scripts/Help/CheckForUpdates/CcUpdateApply.js");
load("scripts/Help/CheckForUpdates/CheckForUpdates.js");
ok(typeof CheckForUpdates.action === "function", "worktree CheckForUpdates.js loaded");

var root = QDir.tempPath() + "/cc-ui";
(new QDir(root)).removeRecursively();
function mk(p, v) { (new QDir()).mkpath(p); if (v !== null) { writeFile(p + "/VERSION", v + "\n"); } }
var app = root + "/app", data = root + "/data";
(new QDir()).mkpath(app); (new QDir()).mkpath(data);

// ---- local(): build identity ----
var l = CheckForUpdates.local(app, data);
eqs(l.platform, null, "no cavecad-build.json: a dev build");
writeFile(app + "/cavecad-build.json", '{"platform": "macos-arm64", "app_commit": "dev"}\n');
eqs(CheckForUpdates.local(app, data).platform, null, "app_commit dev: a dev build");
writeFile(app + "/cavecad-build.json", "{not json");
eqs(CheckForUpdates.local(app, data).platform, null, "unreadable build file: a dev build");
writeFile(app + "/cavecad-build.json", '{"platform": "macos-arm64"}');
eqs(CheckForUpdates.local(app, data).platform, null, "no app_commit: a dev build");
writeFile(app + "/cavecad-build.json", '{"platform": "macos-arm64", "app_commit": "bb12aac6ffff"}\n');
l = CheckForUpdates.local(app, data);
eqs(l.platform, "macos-arm64", "platform read");
eqs(l.appCommit, "bb12aac6ffff", "app commit read");
eqs(l.toolsVersion, "0", "no tools anywhere: 0");

// ---- local(): the tools version the app actually loads ----
mk(app + "/scripts/CaveSurvey", "0.9.180.0");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.180.0", "bundled only");
mk(data + "/scripts/CaveSurvey", "0.9.181.0");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.181.0", "newer per-user copy wins");
mk(data + "/scripts/CaveSurvey", "0.9.180.0");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.180.0", "tie: same version either way");
mk(data + "/scripts/CaveSurvey", "0.9.179.5");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.180.0", "older per-user copy loses to the bundle");
QFile.remove(data + "/scripts/CaveSurvey/VERSION");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.180.0", "unversioned per-user folder: the bundle's VERSION counts");
QFile.remove(app + "/scripts/CaveSurvey/VERSION");
mk(data + "/scripts/CaveSurvey", "0.9.181.0");
eqs(CheckForUpdates.local(app, data).toolsVersion, "0.9.181.0", "unversioned bundle: the per-user VERSION counts");
eqs(CheckForUpdates.loadedToolsVersion(root + "/none", root + "/none2"), "0", "neither: 0");

// ---- action(): what a finished check does ----
// never a top-level "var tools": it breaks the engine's print()
var toolsOffer = { kind: "tools", asset: "CaveSurvey-tools.zip", sha256: "a", toolsVersion: "2", fromVersion: "1" };
var full = { kind: "full", asset: "CaveCAD-macos-arm64.dmg", sha256: "b", size: 1, toolsVersion: "2", appCommit: "cafe" };
var k = UpdateCore.key(toolsOffer);
eqs(CheckForUpdates.action(toolsOffer, false, ""), "prompt", "startup offers tools");
eqs(CheckForUpdates.action(full, false, ""), "prompt", "startup offers an app update");
eqs(CheckForUpdates.action(toolsOffer, false, k), "silent", "startup: a skipped offer stays silent");
eqs(CheckForUpdates.action(toolsOffer, true, k), "prompt", "menu ignores the skip");
eqs(CheckForUpdates.action(full, false, k), "prompt", "a different offer than the skipped one prompts");
eqs(CheckForUpdates.action({ kind: "tools", asset: "CaveSurvey-tools.zip", sha256: "c", toolsVersion: "3" }, false, k),
    "prompt", "a new tools build after a skip prompts again");
eqs(CheckForUpdates.action({ kind: "none" }, false, ""), "silent", "startup: up to date is silent");
eqs(CheckForUpdates.action({ kind: "none" }, true, ""), "upToDate", "menu: says up to date");
eqs(CheckForUpdates.action({ kind: "dev" }, false, ""), "silent", "startup: dev is silent");
eqs(CheckForUpdates.action({ kind: "dev" }, true, ""), "dev", "menu: says dev build");
eqs(CheckForUpdates.action(null, false, ""), "silent", "no decision: silent");
eqs(CheckForUpdates.action({ kind: "none" }, false, ""), CheckForUpdates.action({ kind: "none" }, false, "x"), "skip key irrelevant with nothing offered");

// failed installs and the pending (install-at-quit) update
var kf = UpdateCore.key(full);
eqs(CheckForUpdates.action(full, false, ["", kf]), "silent", "startup: an offer whose install failed stays silent");
eqs(CheckForUpdates.action(full, true, ["", kf]), "prompt", "menu still offers an offer whose install failed");
eqs(CheckForUpdates.action(toolsOffer, false, [k, kf]), "silent", "a skipped and a failed key both count");
eqs(CheckForUpdates.action(full, true, [], kf), "pending", "menu: an update waiting for quit says so");
eqs(CheckForUpdates.action(full, false, [], kf), "silent", "startup: an update waiting for quit is silent");
eqs(CheckForUpdates.action(toolsOffer, false, [], kf), "prompt", "a different offer than the pending one prompts");

// ---- the helper's status file, read at the next start ----
eqs(CheckForUpdates.statusAction(null).message, null, "no status: nothing to say");
var sa = CheckForUpdates.statusAction({ result: "failed", error: "CaveCAD did not quit", key: kf });
ok(sa.message !== null && sa.message.indexOf("CaveCAD did not quit") >= 0, "a failure is reported with its reason");
eqs(sa.suppressKey, kf, "a failure suppresses that offer at startup");
var sok = CheckForUpdates.statusAction({ result: "ok", error: "", key: kf });
ok(sok.message === null && sok.suppressKey === null, "success: nothing to say, nothing suppressed");
writeFile(root + "/st.json", '{"result":"failed","error":"x","key":"full|a|1","when":"t"}\n');
eqs(CheckForUpdates.readStatus(root + "/st.json").key, "full|a|1", "status file read");
writeFile(root + "/st.json", "{broken");
eqs(CheckForUpdates.readStatus(root + "/st.json").result, "failed", "an unreadable status file counts as a failure");
ok(CheckForUpdates.readStatus(root + "/none.json") === null, "no status file: null");
load("scripts/Help/CheckForUpdates/CheckForUpdatesPostInit.js");
ok(typeof postInit === "function", "CheckForUpdatesPostInit.js parses");

// ---- the end-to-end decision on a real manifest ----
var m = UpdateCore.validate({ schema: 1,
    tools: { version: "0.9.182.0", asset: "CaveSurvey-tools.zip", sha256: new Array(65).join("a") },
    platforms: { "macos-arm64": { app_commit: "bb12aac6ffff", asset: "CaveCAD-macos-arm64.dmg", sha256: new Array(65).join("b") } } }).manifest;
var d = UpdateCore.decide(m, CheckForUpdates.local(app, data));
eqs(d.kind, "tools", "same app commit, newer tools: tools offer");
eqs(d.fromVersion, "0.9.181.0", "offer names the loaded tools version");
eqs(CheckForUpdates.action(d, false, UpdateCore.key(d)), "silent", "skipping that offer silences startup");

// ---- relaunch path ----
eqs(CheckForUpdates.relaunchPath("osx", "/Applications/CaveCAD.app"), "/Applications/CaveCAD.app", "macOS relaunches the bundle");
eqs(CheckForUpdates.relaunchPath("linux", "/home/u/CaveCAD.AppImage"), "/home/u/CaveCAD.AppImage", "Linux relaunches the AppImage");
ok(/^C:\/Tools\/CaveCAD\/[^\/]+$/.test(CheckForUpdates.relaunchPath("win", "C:/Tools/CaveCAD")), "Windows relaunches an exe inside the folder");

(new QDir(root)).removeRecursively();
finish("ui_test.js");
