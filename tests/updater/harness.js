// tests/updater/harness.js -- shared by every updater engine test.
// REPO is the repository root, passed as the first script argument.
var REPO = (function() {
    var args = RSettings.getOriginalArguments();
    for (var i = 0; i < args.length; i++) {
        if (String(args[i]) === "-autostart" && i + 2 < args.length) {
            return String(args[i + 2]).replace(/\\/g, "/");
        }
    }
    return QDir.currentPath();
})();
var SYS = RS.getSystemId();
var passed = 0, failures = [];
function ok(cond, what) { if (cond) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) { ok(a === b, what + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }

// A GUI-subsystem exe's stdout may never reach a console on Windows, so the
// result line also goes to the file named by CAVECAD_TEST_OUT (run_ci.py).
function finish(name) {
    var line = failures.length === 0
        ? "### UPDATER OK " + passed + " (" + name + ")"
        : "### UPDATER FAIL " + failures.length + " (" + name + ")\n  " + failures.join("\n  ");
    print(line);
    var outPath = String(QProcessEnvironment.systemEnvironment().value("CAVECAD_TEST_OUT", ""));
    if (outPath !== "") {
        var f = new QFile(outPath);
        if (f.open(QIODevice.WriteOnly | QIODevice.Append | QIODevice.Text)) { f.write(line + "\n"); f.close(); }
    }
}
function load(rel) { include(REPO + "/" + rel); }

// ---- platform helpers ----
function winSys32(rel) {
    var root = String(QProcessEnvironment.systemEnvironment().value("SystemRoot", "C:\\Windows")).replace(/[\\\/]+$/, "");
    return root + "\\System32\\" + rel;
}
function psCmd(script) {
    return { program: winSys32("WindowsPowerShell\\v1.0\\powershell.exe"), args: ["-NoProfile", "-NonInteractive", "-Command", script] };
}
/** file:// URL for an absolute path: file:///C:/x on Windows, file:///x elsewhere. */
function fileUrl(p) { p = encodeURI(String(p).replace(/\\/g, "/")); return p.charAt(0) === "/" ? "file://" + p : "file:///" + p; }
// new QByteArray("text") is EMPTY in this engine -- write files with plain strings.
function writeFile(p, s) { var f = new QFile(p); if (!f.open(QIODevice.WriteOnly)) { return false; } f.write(s); f.close(); return true; }
function readFile(p) {
    var f = new QFile(p);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) { return null; }
    var t = String(new QTextStream(f).readAll()); f.close(); return t;
}
/** A command that exits non-zero. */
function failCmd() { return SYS === "win" ? psCmd("exit 3") : { program: "/bin/sh", args: ["-c", "exit 3"] }; }
/** A command that runs for s seconds. */
function sleepCmd(s) { return SYS === "win" ? psCmd("Start-Sleep -Seconds " + s) : { program: "sleep", args: [String(s)] }; }
/** Zips parent/name into out with name as the zip's top folder. */
function zipCmd(parent, name, out) {
    if (SYS === "win") { return { program: winSys32("tar.exe"), args: ["-a", "-cf", out, "-C", parent, name] }; }
    if (SYS === "osx") { return { program: "/usr/bin/ditto", args: ["-c", "-k", "--keepParent", parent + "/" + name, out] }; }
    return { program: "python3", args: ["-m", "zipfile", "-c", out, parent + "/" + name] };
}
/** Spins the event loop until pred() holds (checked every 100 ms) or ms pass; returns pred(). */
function spin(ms, pred) {
    var loop = new QEventLoop(), t = new QTimer(), waited = 0;
    var check = function() { return pred ? !!pred() : false; };
    t.timeout.connect(function() { waited += 100; if (waited >= ms || check()) { loop.quit(); } });
    t.start(100);
    if (!check()) { loop.exec(); }
    t.stop();
    return check();
}
