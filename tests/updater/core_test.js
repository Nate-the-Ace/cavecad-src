include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/CheckForUpdates/CcUpdateCore.js");

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
bad.platforms["macos-arm64"] = { app_commit: "cc", asset: "CaveCAD-macos-arm64.dmg", sha256: hex, size: 30 };
var vb = UpdateCore.validate(bad);
ok(vb.ok, "one bad platform entry does not fail the manifest");
eqs(vb.dropped.join(","), "windows-x64", "the bad platform entry is dropped");
ok(!UpdateCore.has(vb.manifest.platforms, "windows-x64"), "dropped entry is absent from the cleaned manifest");
eqs(UpdateCore.decide(vb.manifest, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0" }).kind, "none", "decide never sees a dropped entry");
eqs(UpdateCore.decide(vb.manifest, { platform: "macos-arm64", appCommit: "aaaa", toolsVersion: "0" }).kind, "full", "other platforms still update");
eqs(UpdateCore.decide(bad, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0" }).kind, "none", "decide refuses an invalid entry even uncleaned");
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

// the skip key names the offer (what the user would get), not the file
var offer = UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" });
eqs(UpdateCore.key(offer), "full|bb12aac6|0.9.181.0", "full skip key = full|app_commit|tools version");
eqs(UpdateCore.key(toolsUpdate), "tools|0.9.181.0", "tools skip key = tools|version");
var m2 = manifest();
m2.platforms["macos-arm64"] = { app_commit: "zzzz", asset: "CaveCAD-macos-arm64.dmg", sha256: hex, size: 1 };
m2.published = "2026-09-27T00:00:00Z";
eqs(UpdateCore.key(UpdateCore.decide(m2, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" })), UpdateCore.key(offer),
    "an unrelated platform's rebuild does not change the key");
var m3 = manifest(); m3.platforms["windows-x64"].sha256 = "a" + hex.substring(1); m3.tools.sha256 = "b" + hex.substring(1);
eqs(UpdateCore.key(UpdateCore.decide(m3, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" })), UpdateCore.key(offer),
    "a re-assembly (new sha256, same app and tools) keeps the key");
eqs(UpdateCore.key(UpdateCore.decide(m3, { platform: "windows-x64", appCommit: "bb12aac6", toolsVersion: "0.9.180.1" })), UpdateCore.key(toolsUpdate),
    "a re-zipped tools asset keeps the tools key");
var m4 = manifest(); m4.platforms["windows-x64"].app_commit = "cc34";
ok(UpdateCore.key(UpdateCore.decide(m4, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" })) !== UpdateCore.key(offer),
    "a new app commit changes the key");
var m5 = manifest(); m5.tools.version = "0.9.182.0";
ok(UpdateCore.key(UpdateCore.decide(m5, { platform: "windows-x64", appCommit: "aaaa", toolsVersion: "0.9.181.0" })) !== UpdateCore.key(offer),
    "new tools in the same app build change the full key");
eqs(UpdateCore.key({ kind: "none" }), "", "nothing offered: empty key");

// dev builds
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", appCommit: "dev", toolsVersion: "0" }).kind, "dev", "app commit 'dev' is a dev build");
eqs(UpdateCore.decide(manifest(), { platform: "windows-x64", toolsVersion: "0" }).kind, "dev", "missing app commit is a dev build");

// prototype keys are not platforms
eqs(UpdateCore.decide(manifest(), { platform: "constructor", appCommit: "x", toolsVersion: "0" }).kind, "none", "'constructor' is not an inherited platform");
eqs(UpdateCore.decide(manifest(), { platform: "hasOwnProperty", appCommit: "x", toolsVersion: "0" }).kind, "none", "'hasOwnProperty' is not a platform");
var mc = JSON.parse(JSON.stringify(manifest()));
mc.platforms["constructor"] = { app_commit: "c1", asset: "CaveCAD-c.zip", sha256: hex, size: 1 };
var vc = UpdateCore.validate(mc);
eqs(UpdateCore.decide(vc.manifest, { platform: "constructor", appCommit: "c0", toolsVersion: "0" }).asset, "CaveCAD-c.zip", "a real 'constructor' platform key works");
var mp = JSON.parse('{"schema":1,"tools":{"version":"1","asset":"t.zip","sha256":"' + hex + '"},"platforms":{"__proto__":{"app_commit":"x","asset":"a.zip","sha256":"' + hex + '"}}}');
var vp = UpdateCore.validate(mp);
ok(vp.ok && vp.dropped.indexOf("__proto__") >= 0 && Object.getPrototypeOf(vp.manifest.platforms) === Object.prototype, "a '__proto__' platform key is dropped, not applied");

// hostile names
["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "-rf", "a b.zip", "a..zip", "x.zip\n", "C:x", "%2e%2e", "\u0000", "a\u0000b", "é.zip", null, undefined, 5, {}]
    .forEach(function(n) { ok(!UpdateCore.safeName(n), "unsafe name refused: " + JSON.stringify(n)); });
["CaveSurvey-tools.zip", "CaveCAD-windows-x64.zip", "latest.json", "a_b.c-d"]
    .forEach(function(n) { ok(UpdateCore.safeName(n), "safe name accepted: " + n); });
var threw = false; try { UpdateCore.assetUrl("../latest.json"); } catch (e) { threw = true; }
ok(threw, "assetUrl refuses an unsafe name itself");
finish("core_test.js");
