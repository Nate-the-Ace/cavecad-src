include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");

// ---- pure builders (every platform's shape, checked on every platform) ----
var realWinRoot = UpdateCommands.winRoot;
UpdateCommands.winRoot = function() { return "D:\\Win"; };

var mac = UpdateCommands.hash("osx", "/a b/c.zip");
eqs(mac.program, "shasum", "macOS hashes with shasum");
eqs(mac.args.join("|"), "-a|256|--|/a b/c.zip", "path is its own argument, after --");
eqs(UpdateCommands.hash("linux", "/x").args.join("|"), "--|/x", "Linux sha256sum -- path");
var win = UpdateCommands.hash("win", "C:/it's.zip");
eqs(win.program, "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "Windows: absolute powershell under SystemRoot");
ok(win.args.join(" ").indexOf("it's") < 0, "Windows path is not spliced into the command");
eqs(win.env.CAVECAD_HASH_PATH, "C:/it's.zip", "Windows path travels in the environment");
var hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
eqs(UpdateCommands.parseHash(hex + "  /tmp/x\n"), hex, "shasum/sha256sum output");
eqs(UpdateCommands.parseHash(hex.toUpperCase() + "\r\n"), hex, "Get-FileHash output");
ok(UpdateCommands.parseHash("") === null, "empty output is no hash");

eqs(UpdateCommands.fetch("win", "https://u", "C:/o").program, "D:\\Win\\System32\\curl.exe", "Windows: absolute curl.exe");
eqs(UpdateCommands.fetch("osx", "https://u", "/o").args.join("|"),
    "-fsSL|--proto|=https|--proto-redir|=https|--retry|2|-o|/o|https://u", "curl: https only, redirects too");
ok(UpdateCommands.fetch("osx", "file:///x", "/o", { allowFile: true }).args.join("|").indexOf("--proto|=https,file|--proto-redir|=https") >= 0,
    "allowFile permits file:// but not on redirects");
var fb = UpdateCommands.fetchFallback("linux", "https://u", "/o");
eqs(fb.program, "python3", "Linux fallback python");
eqs(fb.args.slice(2).join("|"), "https://u|/o|0", "fallback: url, out, file:// refused");

eqs(UpdateCommands.unzip("osx", "/z.zip", "/d").args.join("|"), "-C|/d|-xf|/z.zip", "tar unzip");
eqs(UpdateCommands.unzip("osx", "/z.zip", "/d").program, "tar", "macOS bsdtar");
eqs(UpdateCommands.unzip("win", "C:/z.zip", "C:/d").program, "D:\\Win\\System32\\tar.exe", "Windows: System32 bsdtar, never an MSYS tar on PATH");
eqs(UpdateCommands.unzip("linux", "/z.zip", "/d").program, "python3", "zipfile on Linux");

eqs(UpdateCommands.detach("osx", "/t/h.sh").program, "/bin/sh", "Unix helper runs under sh");
eqs(UpdateCommands.detach("osx", "/t/h.sh").args.join("|"), "/t/h.sh", "Unix helper path is its own argument");
var helperPath = "C:/Users/O'Brien & Co/AppData/Local/Temp/cavecad-update-1.ps1";
var dw = UpdateCommands.detach("win", helperPath);
eqs(dw.program, "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "Windows helper: absolute powershell, no cmd");
eqs(dw.env.CAVECAD_HELPER, helperPath, "Windows helper path travels in the environment");
var joined = dw.args.join("\n");
ok(joined.indexOf("O'Brien") < 0 && joined.indexOf("cavecad-update") < 0 && joined.indexOf("C:/") < 0,
    "no part of the helper path is in any argument");
ok(dw.args.indexOf("cmd") < 0 && dw.args.indexOf("start") < 0 && dw.args.indexOf("\"\"") < 0, "no cmd /c start");
eqs(dw.args[dw.args.length - 2], "-Command", "PowerShell -Command ...");
ok(dw.args[dw.args.length - 1].indexOf("$env:CAVECAD_HELPER") >= 0, "... reading the path from the environment");
UpdateCommands.winRoot = realWinRoot;

// ---- real runs on this machine ----
var dir = QDir.tempPath() + "/cc upd'test";   // space and apostrophe on purpose
(new QDir(dir)).removeRecursively(); (new QDir()).mkpath(dir);
writeFile(dir + "/abc.txt", "abc");
var loop = new QEventLoop(), got = null, calls = 0;
var once = function(r) { calls++; got = r; loop.quit(); };

UpdateRun.run(UpdateCommands.hash(SYS, dir + "/abc.txt"), 60, once);
loop.exec();
ok(got !== null && got.ok, "hash command ran: " + (got ? got.error : "no callback"));
eqs(got ? UpdateCommands.parseHash(got.stdout) : null, hex, "SHA-256 of abc");

got = null;
UpdateRun.run(UpdateCommands.fetch(SYS, fileUrl(dir + "/abc.txt"), dir + "/copy.txt", { allowFile: true }), 60, once);
loop.exec();
ok(got !== null && got.ok && new QFileInfo(dir + "/copy.txt").size() === 3, "curl fetched a file:// URL: " + (got ? got.error : ""));
got = null;
UpdateRun.run(UpdateCommands.fetch(SYS, fileUrl(dir + "/abc.txt"), dir + "/copy2.txt"), 60, once);
loop.exec();
ok(got !== null && !got.ok && !new QFileInfo(dir + "/copy2.txt").exists(), "without allowFile, file:// is refused");

got = null;
UpdateRun.run(failCmd(), 60, once);
loop.exec();
ok(got !== null && !got.ok && got.error !== "", "a failing program reports ok=false with an error");

got = null;
UpdateRun.run({ program: dir + "/no-such-program", args: [] }, 20, once);
loop.exec();
ok(got !== null && !got.ok, "a missing program reports ok=false");

// timeout: settles once, after the child is gone, and says so
got = null; calls = 0;
var t0 = Date.now();
UpdateRun.run(sleepCmd(8), 1, once);
loop.exec();
spin(1500);   // room for a late second callback
ok(got !== null && !got.ok, "timed-out run reports ok=false");
ok(got !== null && got.error.indexOf("timed out") >= 0, "error says timed out: " + (got ? got.error : ""));
eqs(calls, 1, "callback fires exactly once on a timeout");
ok(Date.now() - t0 < 7500, "the timeout killed the child rather than waiting it out");

// detach: a real helper in a path with a space and an apostrophe starts,
// outlives the launch, and runs to completion
var marker = dir + "/detached-marker.txt";
var helper = dir + "/helper" + (SYS === "win" ? ".ps1" : ".sh");
if (SYS === "win") {
    writeFile(helper, "Set-Content -LiteralPath '" + marker.replace(/'/g, "''") + "' -Value ok\r\n");
} else {
    writeFile(helper, "#!/bin/sh\necho ok > '" + marker.replace(/'/g, "'\\''") + "'\n");
}
var cmd = UpdateCommands.detach(SYS, helper);
cmd.workingDirectory = QDir.tempPath();
var d = UpdateRun.detach(cmd);
ok(d.ok, "detach started: " + d.error);
ok(spin(30000, function() { return new QFileInfo(marker).exists(); }), "the detached helper ran (" + helper + ")");

(new QDir(dir)).removeRecursively();
finish("commands_test.js");
