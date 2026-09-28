include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/SendFeedback/FeedbackCommands.js");

var realWinRoot = UpdateCommands.winRoot;
UpdateCommands.winRoot = function() { return "D:\\Win"; };
eqs(FeedbackCommands.zip("osx", "/s/a b", "/o/r.zip").args.join("|"), "-c|-k|--norsrc|--noextattr|--noqtn|--noacl|/s/a b|/o/r.zip", "macOS ditto");
eqs(FeedbackCommands.zip("osx", "/s", "/o").program, "/usr/bin/ditto", "macOS ditto path");
eqs(FeedbackCommands.zip("win", "C:/s", "C:/o.zip").program, "D:\\Win\\System32\\tar.exe", "Windows tar");
eqs(FeedbackCommands.zip("win", "C:/s", "C:/o.zip").args.join("|"), "-a|-c|-f|C:/o.zip|-C|C:/s|.", "Windows tar args");
eqs(FeedbackCommands.zip("linux", "/s", "/o").program, "python3", "Linux python zip");
var p = FeedbackCommands.post("osx", "https://h/x?k=1", "/b", "/o");
eqs(p.program, "/usr/bin/curl", "macOS curl");
eqs(p.args.slice(0, 6).join("|"), "-sS|-L|--proto|=https|--proto-redir|=https", "https only, follows the 302");
ok(p.args.join("|").indexOf("--data-binary|@/b") >= 0, "body from file");
ok(p.args.join("|").indexOf("--speed-limit|1024|--speed-time|" + UpdateCommands.STALL_S) >= 0, "stall detection, not a fixed duration cap");
ok(p.args.join("|").indexOf("--max-time|3600") >= 0, "generous overall cap only, exceeds the caller's post timeout");
eqs(p.args[p.args.length - 1], "https://h/x?k=1", "url last");
eqs(FeedbackCommands.post("win", "https://h", "C:/b", "C:/o").program, "D:\\Win\\System32\\curl.exe", "Windows curl");
var w = FeedbackCommands.base64("win", "C:/it's.zip", "C:/o.b64");
ok(w.args.join(" ").indexOf("it's") < 0, "Windows base64 path not in command text");
eqs(w.env.CAVECAD_FB_IN, "C:/it's.zip", "Windows base64 input via env");
eqs(FeedbackCommands.reveal("osx", "/o/f.zip").args.join("|"), "-R|/o/f.zip", "macOS reveal");
eqs(FeedbackCommands.reveal("win", "C:/o/f.zip").args.join("|"), "/select,|C:\\o\\f.zip", "Windows reveal (path its own arg)");
UpdateCommands.winRoot = realWinRoot;

// ---- run them for real on this machine ----
var root = QDir.tempPath() + "/cc-fbcmd";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root + "/stage/logs");
writeFile(root + "/stage/report.json", '{"id":"a7f3c2"}');
writeFile(root + "/stage/logs/s.log", "line\n");
var loop = new QEventLoop(), r = null;
function run(c) { r = null; UpdateRun.run(c, 60, function(x) { r = x; loop.quit(); }); loop.exec(); return r; }
ok(run(FeedbackCommands.zip(SYS, root + "/stage", root + "/r.zip")).ok, "zip ran: " + (r && r.error));
(new QDir()).mkpath(root + "/out");
ok(run(UpdateCommands.unzip(SYS, root + "/r.zip", root + "/out")).ok, "unzip ran");
var back = readFile(root + "/out/report.json") || readFile(root + "/out/./report.json");
eqs(back, '{"id":"a7f3c2"}', "report.json at the zip root");
ok(readFile(root + "/out/logs/s.log") === "line\n", "subfolders kept");
(function() {
    var bad = [];
    function walk(dirPath) {
        var names = (new QDir(dirPath)).entryList([], QDir.AllEntries | QDir.Hidden | QDir.NoDotAndDotDot, 0);
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]), full = dirPath + "/" + name;
            if (name.indexOf("._") === 0) { bad.push(full); }
            if (new QFileInfo(full).isDir()) { walk(full); }
        }
    }
    walk(root + "/out");
    eqs(bad.join(","), "", "no AppleDouble (._*) entries in the archive");
})();
ok(run(FeedbackCommands.base64(SYS, root + "/r.zip", root + "/r.b64")).ok, "base64 ran: " + (r && r.error));
var dec = SYS === "win" ? psCmd("[IO.File]::WriteAllBytes('" + root + "/d.zip', [Convert]::FromBase64String([IO.File]::ReadAllText('" + root + "/r.b64')))")
    : { program: "python3", args: ["-c", "import base64,sys;open(sys.argv[2],'wb').write(base64.b64decode(open(sys.argv[1]).read()))", root + "/r.b64", root + "/d.zip"] };
ok(run(dec).ok, "decoded");
eqs(new QFileInfo(root + "/d.zip").size(), new QFileInfo(root + "/r.zip").size(), "base64 round trip keeps every byte");
(new QDir(root)).removeRecursively();
finish("commands");
