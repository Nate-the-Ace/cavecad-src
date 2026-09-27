include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/library.js");
load("scripts/AddOn.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/CheckForUpdates/CcUpdateApply.js");

var root = QDir.tempPath() + "/cc-apply";
(new QDir(root)).removeRecursively();
function mk(p, v) { (new QDir()).mkpath(p); writeFile(p + "/VERSION", v); }
mk(root + "/new/CaveSurvey", "0.9.182.0");
mk(root + "/user/CaveSurvey", "0.9.181.0");
var loop = new QEventLoop(), r = null;
UpdateRun.run(zipCmd(root + "/new", "CaveSurvey", root + "/tools.zip"), 60, function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "made a tools zip: " + r.error);

r = null;
UpdateApply.installTools(root + "/tools.zip", "9.9.9", root + "/user", function(x) { r = x; loop.quit(); }); loop.exec();
ok(!r.ok, "wrong version refused");
eqs(new QDir(root + "/update-tmp").entryList([], QDir.AllEntries | QDir.Hidden | QDir.NoDotAndDotDot, 0).length, 0, "its folder removed after a refusal");
eqs(AddOn.readVersion(root + "/user/CaveSurvey"), "0.9.181.0", "old copy untouched after a refusal");

r = null;
UpdateApply.installTools(root + "/tools.zip", "0.9.182.0", root + "/user", function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "tools installed: " + r.error);
eqs(AddOn.readVersion(root + "/user/CaveSurvey"), "0.9.182.0", "new copy in place");
eqs(new QDir(root + "/user").entryList([], QDir.Dirs | QDir.Hidden | QDir.NoDotAndDotDot, 0).join(","), "CaveSurvey", "nothing but CaveSurvey in the scripts root");
eqs(new QDir(root + "/update-tmp").entryList([], QDir.AllEntries | QDir.Hidden | QDir.NoDotAndDotDot, 0).length, 0, "its folder removed after the swap");
eqs(UpdateApply.workDir(root + "/user"), new QFileInfo(root).absoluteFilePath() + "/update-tmp", "work dir sits beside the scripts root");
eqs(UpdateApply.workDir(root + "/user/"), UpdateApply.workDir(root + "/user"), "a trailing slash changes nothing");

// leftovers: an old one (older than maxAge) is pruned, a young one -- maybe
// another install running right now -- is left alone, as is a kept folder
(new QDir()).mkpath(root + "/update-tmp/tools-old/stage/CaveSurvey");
mk(root + "/update-tmp/other-running", "0.9.1.0");
mk(root + "/new/CaveSurvey", "0.9.183.0");
QFile.remove(root + "/tools.zip");
r = null;
UpdateRun.run(zipCmd(root + "/new", "CaveSurvey", root + "/tools.zip"), 60, function(x) { r = x; loop.quit(); }); loop.exec();
r = null;
UpdateApply.installTools(root + "/tools.zip", "0.9.183.0", root + "/user", function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok, "install beside leftovers: " + r.error);
eqs(AddOn.readVersion(root + "/user/CaveSurvey"), "0.9.183.0", "newest copy in place");
ok(new QFileInfo(root + "/update-tmp/other-running/VERSION").exists(), "a young folder of another install is left alone");
eqs(new QDir(root + "/update-tmp").entryList([], QDir.AllEntries | QDir.Hidden | QDir.NoDotAndDotDot, 0).join(","), "other-running,tools-old",
    "the install removed only its own folder");
spin(1600);
UpdateApply.keep = [root + "/update-tmp/tools-old"];
UpdateApply.prune(root + "/update-tmp", 500);
UpdateApply.keep = [];
eqs(new QDir(root + "/update-tmp").entryList([], QDir.AllEntries | QDir.Hidden | QDir.NoDotAndDotDot, 0).join(","), "tools-old",
    "prune removes what is older than maxAge, except a kept folder");
(new QDir(root + "/update-tmp")).removeRecursively();

// fresh folders are unique and never reuse an existing one
var f1 = UpdateApply.freshDir(root + "/fd", "dl"), f2 = UpdateApply.freshDir(root + "/fd", "dl");
ok(f1 !== null && f2 !== null && f1 !== f2 && new QFileInfo(f1).isDir(), "freshDir makes distinct folders");
ok(!(new QDir(root + "/fd")).mkdir(f1.substring(f1.lastIndexOf("/") + 1)), "QDir.mkdir refuses an existing folder (freshDir relies on it)");
eqs(UpdateApply.tmpBase("/d/x/"), "/d/x/update-tmp", "tmpBase is per-user data/update-tmp");
eqs(UpdateApply.statusPath("/d/x"), "/d/x/update-status.json", "status file in the data location");

// first update on a machine with no per-user scripts folder yet
r = null;
UpdateApply.installTools(root + "/tools.zip", "0.9.183.0", root + "/fresh/scripts", function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok && AddOn.readVersion(root + "/fresh/scripts/CaveSurvey") === "0.9.183.0", "installs into a new scripts root: " + r.error);

eqs(UpdateApply.installTarget("osx", "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD", {}), "/Applications/CaveCAD.app", "macOS replaces the .app");
eqs(UpdateApply.installTarget("win", "C:/Tools/CaveCAD/cavecad.exe", {}), "C:/Tools/CaveCAD", "Windows replaces the exe folder");
eqs(UpdateApply.installTarget("linux", "/tmp/.mount_x/usr/bin/cavecad-bin", { APPIMAGE: "/home/n/CaveCAD.AppImage" }), "/home/n/CaveCAD.AppImage", "Linux replaces $APPIMAGE");
ok(UpdateApply.installTarget("linux", "/usr/bin/cavecad-bin", {}) === null, "Linux outside an AppImage: unknown target");
ok(UpdateApply.writable(root + "/user/CaveSurvey"), "a temp folder is writable");

// full-update blockers (Windows: the folder must prove it is a CaveCAD package)
(new QDir()).mkpath(root + "/Tools/CaveCAD"); writeFile(root + "/Tools/CaveCAD/cavecad.exe", "x");
ok(UpdateApply.fullUpdateBlocker("win", root + "/Tools/CaveCAD") !== null, "Windows: a folder without cavecad-build.json is refused");
writeFile(root + "/Tools/CaveCAD/cavecad-build.json", "{}");
eqs(UpdateApply.fullUpdateBlocker("win", root + "/Tools/CaveCAD"), null, "Windows: a packaged folder may be replaced");
ok(UpdateApply.fullUpdateBlocker("win", "D:") !== null && UpdateApply.fullUpdateBlocker("win", "D:/") !== null, "Windows: a drive root is refused");
ok(UpdateApply.fullUpdateBlocker("osx", root + "/Tools/CaveCAD") !== null, "macOS: a bundle without Contents/Resources/cavecad-build.json is refused");
ok(UpdateApply.fullUpdateBlocker("linux", null) !== null, "no target: refused");

var o = { pid: 4242, download: "/tmp/a b.dmg", sha256: "AB", target: "/Applications/CaveCAD.app", relaunch: "/Applications/CaveCAD.app",
          work: "/w", status: "/s.json", key: "full|c|1", stamp: "77" };
var sh = UpdateApply.helperScript("osx", o);
ok(sh.indexOf("kill -0 4242") >= 0, "helper waits for the pid");
ok(sh.indexOf("'/tmp/a b.dmg'") >= 0, "paths are single-quoted");
ok(sh.indexOf(".old-77") >= 0 && sh.indexOf(".new-77") >= 0 && sh.indexOf("\"$target.old\"") < 0, "unique .old/.new names only");
ok(sh.indexOf("sha='ab'") >= 0, "expected sha256 baked in, lowercased");
ok(sh.indexOf("/usr/bin/open '/Applications/CaveCAD.app'") >= 0, "restart mode relaunches");
o.mode = "atQuit";
var shq = UpdateApply.helperScript("osx", o);
ok(shq.indexOf("/usr/bin/open") < 0 && shq.indexOf("$i -lt") < 0, "atQuit: no time limit, no relaunch");
o.mode = "restart";
var ps = UpdateApply.helperScript("win", { pid: 4242, download: "C:/t/n.zip", sha256: "ab", target: "C:/Tools/CaveCAD", relaunch: "C:/Tools/CaveCAD/cavecad.exe",
    work: "C:/w", status: "C:/s.json", key: "k", stamp: "77" });
ok(ps.indexOf("Get-Process -Id 4242") >= 0 && ps.indexOf("WaitForExit(60000)") >= 0, "Windows helper waits for the pid, 60 s");
ok(ps.indexOf("Set-Location") >= 0 && ps.indexOf("Set-Location") < ps.indexOf("Rename-Item"),
    "Windows helper leaves the install folder before renaming it");
var noLiteral = [], cmdRe = /(Test-Path|Remove-Item|Rename-Item|Move-Item|Expand-Archive|Get-FileHash|Set-Location|Get-ChildItem)\b([^;|})\r\n]*)/g, cm;
while ((cm = cmdRe.exec(ps)) !== null) { if (cm[2].indexOf("-LiteralPath") < 0) { noLiteral.push(cm[0]); } }
eqs(noLiteral.join(" / "), "", "PowerShell: -LiteralPath everywhere");
ok(ps.indexOf("'.old-77'") >= 0 && ps.indexOf("'.old'") < 0, "Windows: unique .old name only");

ok(UpdateApply.helperScript("osx", { mode: "relaunchOnly", pid: 1, relaunch: "/A.app", work: "/w" }).indexOf("open '/A.app'") >= 0, "relaunch-only helper");

// writeHelper: into the install's own folder, the exact text (a
// "new QByteArray(text)" write would be EMPTY in this engine)
(new QDir()).mkpath(root + "/w");
o.work = root + "/w";
var wpath = UpdateApply.writeHelper("osx", o);
ok(wpath !== null && new QFileInfo(wpath).exists() && wpath.indexOf(root + "/w/helper-") === 0, "writeHelper wrote into the work folder");
var written = readFile(wpath);
ok(written !== null && written.length > 0, "written helper file is non-empty");
o.stamp = "77";
eqs(written, UpdateApply.helperScript("osx", o), "written helper matches helperScript() text");

(new QDir(root)).removeRecursively();
finish("apply_test.js");
