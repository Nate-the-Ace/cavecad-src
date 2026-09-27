include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
// RUNS the generated full-update helper (this platform's variant) against a
// fake install: sh on macOS and Linux, PowerShell on Windows. The helper is
// started the way CaveCAD starts it (UpdateCommands.detach's program and
// arguments), but waited for, with the pid of a process that has already
// finished (or, for "did not quit", this test's own pid) and a relaunch
// that only writes a marker file.
//
// macOS: the disk-image step is swapped for a prepared .app (o.stageApp) in
// most cases, since hdiutil create takes ~15 s; one case builds and mounts
// a real .dmg end to end.
load("scripts/library.js");
load("scripts/AddOn.js");
load("scripts/Help/CheckForUpdates/CcUpdateCore.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/CheckForUpdates/CcUpdateApply.js");

// space and apostrophe on purpose. Windows: under the data location, not
// %TEMP%, which can be an 8.3 short path (C:\Users\RUNNER~1\...) that never
// prefix-matches a process's long Path in the helper's busy check.
var root = (SYS === "win" ? String(RSettings.getDataLocation()).replace(/[\\\/]+$/, "") : QDir.tempPath()) + "/cc-helper o'k";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root);

function runSync(cmd, timeoutS) {
    var loop = new QEventLoop(), r = null;
    UpdateRun.run(cmd, timeoutS || 120, function(x) { r = x; loop.quit(); });
    loop.exec();
    return r;
}
function mkdirs(p) { (new QDir()).mkpath(p); }
function exists(p) { return new QFileInfo(p).exists(); }
function sha(p) { var r = runSync(UpdateCommands.hash(SYS, p), 60); return r.ok ? UpdateCommands.parseHash(r.stdout) : null; }
function listNames(dir) { return new QDir(dir).entryList([], QDir.AllEntries | QDir.Hidden | QDir.System | QDir.NoDotAndDotDot, QDir.Name); }

/** The pid of a process that has run and exited. */
function deadPid() {
    var r = runSync(SYS === "win" ? psCmd("$PID") : { program: "/bin/sh", args: ["-c", "echo $$"] }, 60);
    return parseInt(String(r.stdout).trim(), 10);
}

function relaunchLine(marker) {
    return SYS === "win" ? "Set-Content -LiteralPath " + UpdateApply.pq(marker) + " -Value relaunched"
                         : "echo relaunched > " + UpdateApply.q(marker);
}

/**
 * A fake install in root/<name>: target (with a user file where the
 * platform has a folder to keep it in), the new package, the download
 * and its sha256. Returns the helper's o plus paths to check.
 */
function makeCase(name, opts) {
    opts = opts || {};
    var base = root + "/" + name, c = { base: base };
    mkdirs(base + "/data");
    c.work = UpdateApply.freshDir(UpdateApply.tmpBase(base + "/data"), "dl");
    c.status = UpdateApply.statusPath(base + "/data");
    c.marker = base + "/relaunched.txt";
    if (SYS === "osx") {
        c.target = base + "/Apps/CaveCAD.app";
        mkdirs(c.target + "/Contents/MacOS"); mkdirs(c.target + "/Contents/Resources");
        writeFile(c.target + "/Contents/MacOS/CaveCAD", "old");
        writeFile(c.target + "/Contents/Resources/cavecad-build.json", "{}");
        c.userFile = c.target + "/My notes.txt";
        writeFile(c.userFile, "mine");
        c.pkg = base + "/pkg/CaveCAD.app";
        mkdirs(c.pkg + "/Contents/MacOS"); mkdirs(c.pkg + "/Contents/Resources");
        writeFile(c.pkg + "/Contents/MacOS/CaveCAD", "new");
        writeFile(c.pkg + "/Contents/Resources/cavecad-build.json", "{}");
        c.binary = c.target + "/Contents/MacOS/CaveCAD";
        c.download = c.work + "/CaveCAD-macos-arm64.dmg";
        if (opts.realDmg) {
            var hd = runSync({ program: "/usr/bin/hdiutil", args: ["create", "-quiet", "-srcfolder", base + "/pkg",
                "-volname", "CaveCAD", "-format", "UDZO", "-ov", c.download] }, 180);
            ok(hd.ok, "hdiutil create: " + hd.error);
        } else {
            writeFile(c.download, "stand-in for the disk image");
            c.stageApp = c.pkg;
        }
    } else if (SYS === "win") {
        c.target = base + "/Apps/CaveCAD";
        mkdirs(c.target + "/drawings");
        writeFile(c.target + "/cavecad.exe", "old");
        writeFile(c.target + "/cavecad-build.json", "{}");
        c.userFile = c.target + "/My notes.txt";
        writeFile(c.userFile, "mine");
        writeFile(c.target + "/drawings/cave.dxf", "mine too");
        mkdirs(base + "/pkg/CaveCAD/lib");
        writeFile(base + "/pkg/CaveCAD/cavecad.exe", "new");
        writeFile(base + "/pkg/CaveCAD/cavecad-build.json", "{}");
        writeFile(base + "/pkg/CaveCAD/lib/x.dll", "lib");
        c.binary = c.target + "/cavecad.exe";
        c.download = c.work + "/CaveCAD-windows-x64.zip";
        var z = runSync(zipCmd(base + "/pkg", "CaveCAD", c.download), 60);
        ok(z.ok, "made the package zip: " + z.error);
    } else {
        c.target = base + "/Apps/CaveCAD.AppImage";
        mkdirs(base + "/Apps");
        writeFile(c.target, "old");
        c.userFile = base + "/Apps/My notes.txt";      // a file target: its folder's other files
        writeFile(c.userFile, "mine");
        c.binary = c.target;
        c.download = c.work + "/CaveCAD-linux-x86_64.AppImage";
        writeFile(c.download, "new");
    }
    c.sha = sha(c.download);
    c.o = { mode: opts.mode || "restart", pid: opts.pid || deadPid(), download: c.download, sha256: c.sha,
            target: c.target, relaunch: c.target, work: c.work, status: c.status, key: "full|abc|1.2.3",
            relaunchLine: relaunchLine(c.marker), waitS: 2, busyS: 2 };
    if (c.stageApp) { c.o.stageApp = c.stageApp; }
    return c;
}

function runHelper(c) {
    var path = UpdateApply.writeHelper(SYS, c.o);
    ok(path !== null, c.base + ": helper written");
    var cmd = UpdateCommands.detach(SYS, path);
    cmd.workingDirectory = c.base;
    return runSync(cmd, 240);
}

function status(c) {
    var t = readFile(c.status);
    try { return t === null ? null : JSON.parse(t); } catch (e) { return { result: "unparseable: " + t }; }
}

function leftovers(c) {
    var parent = new QFileInfo(c.target).absolutePath(), leaf = new QFileInfo(c.target).fileName();
    return listNames(parent).filter(function(n) { return n !== leaf && n.indexOf(leaf + ".") === 0; });
}

function assertIntact(c, what) {
    eqs(readFile(c.binary), "old", what + ": the old build is still in place");
    eqs(readFile(c.userFile), "mine", what + ": the user's file is untouched");
    eqs(leftovers(c).join(","), "", what + ": no .new-/.old- left beside the target");
}

// ---- success: swap, user files carried over, status ok, relaunch ----
var c = makeCase("ok");
var r = runHelper(c);
ok(r.ok, "success: helper exit 0: " + r.error);
var st = status(c);
ok(st !== null && st.result === "ok", "success: status ok: " + JSON.stringify(st));
eqs(st ? st.key : null, "full|abc|1.2.3", "success: status names the offer key");
ok(st !== null && typeof st.when === "string" && st.when.length > 0, "success: status has a time");
eqs(readFile(c.binary), "new", "success: the new build is in place");
eqs(readFile(c.userFile), "mine", "success: the user's extra file survived the swap");
if (SYS === "win") {
    eqs(readFile(c.target + "/drawings/cave.dxf"), "mine too", "success: a user folder survived the swap");
    eqs(readFile(c.target + "/lib/x.dll"), "lib", "success: the whole new package arrived");
}
if (SYS === "linux") { ok(new QFileInfo(c.target).isExecutable(), "success: the new AppImage is executable"); }
eqs(leftovers(c).join(","), "", "success: no .new-/.old- left beside the target");
ok(!exists(c.work), "success: the download folder is deleted");
ok(exists(c.marker), "success: CaveCAD relaunched");

// ---- a .old/.new the helper did not make is never touched ----
c = makeCase("foreign");
var foreignOld = c.target + ".old", foreignNew = c.target + ".new";
mkdirs(foreignOld); writeFile(foreignOld + "/keep.txt", "k");
mkdirs(foreignNew); writeFile(foreignNew + "/keep.txt", "k");
r = runHelper(c);
eqs(status(c) ? status(c).result : null, "ok", "foreign .old/.new: install still succeeds");
ok(readFile(foreignOld + "/keep.txt") === "k" && readFile(foreignNew + "/keep.txt") === "k", "foreign .old/.new: left alone");
eqs(readFile(c.binary), "new", "foreign .old/.new: new build in place");

// ---- the download no longer matches its checksum ----
c = makeCase("badhash");
c.o.sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
r = runHelper(c);
st = status(c);
ok(st !== null && st.result === "failed" && String(st.error).indexOf("checksum") >= 0, "bad hash: status failed, says why: " + JSON.stringify(st));
assertIntact(c, "bad hash");
ok(exists(c.marker), "bad hash: the old CaveCAD is relaunched");
ok(!exists(c.work), "bad hash: the download folder is deleted");

// ---- the download is missing ----
c = makeCase("missing");
QFile.remove(c.download);
r = runHelper(c);
st = status(c);
ok(st !== null && st.result === "failed" && String(st.error).indexOf("missing") >= 0, "missing download: status failed: " + JSON.stringify(st));
assertIntact(c, "missing download");

// ---- CaveCAD never quit: no swap ----
c = makeCase("alive", { pid: QCoreApplication.applicationPid() });
r = runHelper(c);
st = status(c);
ok(st !== null && st.result === "failed" && String(st.error).indexOf("did not quit") >= 0, "still running: status failed 'did not quit': " + JSON.stringify(st));
assertIntact(c, "still running");
ok(!exists(c.marker), "still running: nothing relaunched");

// ---- another process runs from the target: no swap ----
c = makeCase("busy");
var sleeper = null, sleeperCmd;
if (SYS === "win") {
    QFile.copy(winSys32("PING.EXE"), c.target + "/ping.exe");
    sleeperCmd = { program: c.target + "/ping.exe", args: ["-n", "90", "127.0.0.1"] };
} else {
    // its command line names a path inside (macOS) or equal to (Linux) the
    // target; "; exit 0" keeps sh from exec-ing sleep (which would drop it)
    sleeperCmd = { program: "/bin/sh", args: ["-c", "sleep 90; exit 0", SYS === "osx" ? c.target + "/Contents/MacOS/CaveCAD" : c.target] };
}
// The stand-in must outlive the helper's check: PowerShell alone can take
// many seconds to start on a cold CI runner, and a stand-in that ended
// first made the folder legitimately not busy (a false failure on the
// Windows ARM64 runner, 2026-09-27). It lives 90 s, the runner's limit is
// 120 s, and the test asserts it was still running when the helper
// finished, so a timing slip reads as a test problem, not an updater one.
var sleeperProc = UpdateRun.run(sleeperCmd, 120, function(x) { sleeper = x; });
spin(1000);
ok(sleeper === null, "busy target: the stand-in program started and is running");
r = runHelper(c);
ok(sleeper === null, "busy target: the stand-in was still running when the helper finished (else the test, not the updater, is wrong)");
st = status(c);
ok(st !== null && st.result === "failed" && String(st.error).indexOf("still running") >= 0, "busy target: status failed: " + JSON.stringify(st));
assertIntact(c, "busy target");
sleeperProc.kill();
spin(20000, function() { return sleeper !== null; });

// ---- "No" to the restart: installs at quit, never relaunches ----
c = makeCase("atquit", { mode: "atQuit" });
r = runHelper(c);
eqs(status(c) ? status(c).result : null, "ok", "atQuit: installed");
eqs(readFile(c.binary), "new", "atQuit: new build in place");
ok(!exists(c.marker), "atQuit: not relaunched (the user chose to quit)");

// ---- macOS: a real disk image, mounted and copied ----
if (SYS === "osx") {
    c = makeCase("dmg", { realDmg: true });
    r = runHelper(c);
    st = status(c);
    ok(st !== null && st.result === "ok", "real dmg: status ok: " + JSON.stringify(st));
    eqs(readFile(c.binary), "new", "real dmg: the new build is in place");
    eqs(readFile(c.userFile), "mine", "real dmg: the user's file survived");
    ok(exists(c.marker), "real dmg: relaunched");
}

(new QDir(root)).removeRecursively();
finish("helper_test.js");
