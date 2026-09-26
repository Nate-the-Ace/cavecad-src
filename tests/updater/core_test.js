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
var toolsUpdate = UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.180.1" });
eqs(toolsUpdate.kind, "tools", "same app, older tools: tools-only");
eqs(toolsUpdate.asset, "CaveSurvey-tools.zip", "tools names the tools asset");
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.181.0" }).kind, "none", "up to date");
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.182.0" }).kind, "none", "newer local tools (publish.sh machine): none");

eqs(UpdateCore.parseSidecar(hex.toUpperCase() + "  CaveCAD-windows-x64.zip\n"), hex, "sidecar parsed, lowercased");
ok(UpdateCore.parseSidecar("nope") === null, "junk sidecar is null");
eqs(UpdateCore.assetUrl("latest.json"), "https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/latest.json", "fixed base URL");
eqs(UpdateCore.key(manifest()), "e7b4095|windows-x64=bb12aac6", "skip key covers tools and every platform");
finish("core_test.js");
