include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/library.js");
load("scripts/AddOn.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");
load("scripts/Help/CheckForUpdates/UpdateApply.js");

var root = QDir.tempPath() + "/cc-apply";
(new QDir(root)).removeRecursively();
// new QByteArray("text") is EMPTY in this engine -- write files with plain strings.
function mk(p, v) { (new QDir()).mkpath(p); var f = new QFile(p + "/VERSION"); f.open(QIODevice.WriteOnly); f.write(v); f.close(); }
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
ok(ps.indexOf("Set-Location $env:TEMP") >= 0 && ps.indexOf("Set-Location") < ps.indexOf("Rename-Item"),
    "Windows helper leaves the install folder before renaming it");

// Task 8 Step 1: the relaunchOnly branch (a tools-only update needs no
// install step in the helper -- just wait for the pid, then relaunch).
ok(UpdateApply.helperScript("osx", { pid: 1, relaunch: "/A.app", relaunchOnly: true }).indexOf("open '/A.app'") >= 0, "relaunch-only helper");

// launchHelper writes the script to a real file before detaching it; the
// plan's "new QByteArray(text)" write would silently produce an EMPTY file
// in this engine, so writeHelper is split out and tested directly here
// without ever launching or running the script.
var wpath = UpdateApply.writeHelper("osx", { pid: 1, download: "/tmp/x.dmg", target: "/Applications/CaveCAD.app", relaunch: "/Applications/CaveCAD.app" });
ok(new QFileInfo(wpath).exists(), "writeHelper wrote a file");
var wf = new QFile(wpath);
wf.open(QIODevice.ReadOnly | QIODevice.Text);
var written = String(new QTextStream(wf).readAll());
wf.close();
ok(written.length > 0, "written helper file is non-empty");
eqs(written, UpdateApply.helperScript("osx", { pid: 1, download: "/tmp/x.dmg", target: "/Applications/CaveCAD.app", relaunch: "/Applications/CaveCAD.app" }), "written helper matches helperScript() text");
(new QFile(wpath)).remove();

(new QDir(root)).removeRecursively();
finish("apply_test.js");
