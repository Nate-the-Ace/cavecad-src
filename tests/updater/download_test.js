include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/UpdateCore.js");
load("scripts/Help/CheckForUpdates/UpdateCommands.js");
load("scripts/Help/CheckForUpdates/UpdateRun.js");
load("scripts/Help/CheckForUpdates/UpdateDownload.js");

var hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
var src = QDir.tempPath() + "/cc-dl-src", dst = QDir.tempPath() + "/cc-dl-dst";
[src, dst].forEach(function(d) { (new QDir(d)).removeRecursively(); (new QDir()).mkpath(d); });
var write = writeFile;
write(src + "/good.zip", "abc");
write(src + "/good.zip.sha256", hex + "  good.zip\n");
write(src + "/bad.zip", "abd");
write(src + "/bad.zip.sha256", hex + "  bad.zip\n");
write(src + "/latest.json", JSON.stringify({ schema: 1, tools: { version: "1", commit: "c", asset: "good.zip", sha256: hex, size: 3 },
    platforms: { "windows-x64": { app_commit: "a", asset: "../x.zip", sha256: hex }, "macos-arm64": { app_commit: "b", asset: "m.dmg", sha256: hex } } }));
UpdateDownload.base = fileUrl(src + "/");
UpdateDownload.allowFile = true;

var loop = new QEventLoop(), r = null;
UpdateDownload.manifest(function(x) { r = x; loop.quit(); }); loop.exec();
ok(r.ok && r.manifest.tools.version === "1", "manifest fetched and validated: " + r.error);
ok(r.ok && !r.manifest.platforms.hasOwnProperty("windows-x64") && r.manifest.platforms.hasOwnProperty("macos-arm64"),
    "a bad platform entry is dropped, the rest kept");

r = null;
UpdateDownload.verified("../good.zip", hex, dst, function() {}, function(x) { r = x; });
ok(r !== null && !r.ok && r.attempts === 0, "an unsafe asset name is refused before any download");

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
