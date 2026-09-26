// UpdateCore.js -- the updater's pure logic: nothing here touches the
// network, the disk or the UI, so all of it is unit-tested.

var UpdateCore = {};

// Downloads only ever come from here; the manifest supplies names only.
UpdateCore.BASE = "https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/";
UpdateCore.MANIFEST = "latest.json";
UpdateCore.SETTING_AUTO = "CheckForUpdates/AutoCheck";
UpdateCore.SETTING_SKIP = "CheckForUpdates/SkippedKey";

UpdateCore.assetUrl = function(name) { return UpdateCore.BASE + name; };

/** Dotted integer versions; missing parts are 0. >0 when a is newer. */
UpdateCore.compareVersions = function(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var x = parseInt(pa[i] || "0", 10) || 0, y = parseInt(pb[i] || "0", 10) || 0;
        if (x !== y) { return x - y; }
    }
    return 0;
};

UpdateCore.isHex64 = function(s) { return /^[0-9a-f]{64}$/.test(String(s)); };
UpdateCore.safeName = function(s) {
    s = String(s === undefined || s === null ? "" : s);
    return s !== "" && s.indexOf("/") < 0 && s.indexOf("\\") < 0 && s.indexOf("..") < 0;
};

/** {ok, error}: a manifest this updater can trust the shape of. */
UpdateCore.validate = function(m) {
    var fail = function(e) { return { ok: false, error: e }; };
    if (m === null || typeof m !== "object") { return fail("not an object"); }
    if (m.schema !== 1) { return fail("unknown schema " + m.schema); }
    var t = m.tools;
    if (!t || !t.version || !UpdateCore.safeName(t.asset) || !UpdateCore.isHex64(t.sha256)) {
        return fail("bad tools entry");
    }
    if (!m.platforms || typeof m.platforms !== "object") { return fail("no platforms"); }
    for (var p in m.platforms) {
        if (!m.platforms.hasOwnProperty(p)) { continue; }
        var e = m.platforms[p];
        if (!e || !e.app_commit || !UpdateCore.safeName(e.asset) || !UpdateCore.isHex64(e.sha256)) {
            return fail("bad platform entry " + p);
        }
    }
    return { ok: true, error: "" };
};

/**
 * local: {platform, appCommit, toolsVersion}. platform null = a
 * development build (no cavecad-build.json): the updater stays out.
 */
UpdateCore.decide = function(m, local) {
    if (!local || !local.platform || !local.appCommit) { return { kind: "dev" }; }
    var p = m.platforms[local.platform];
    if (!p) { return { kind: "none" }; }
    if (String(p.app_commit) !== String(local.appCommit)) {
        return { kind: "full", asset: p.asset, sha256: p.sha256, size: p.size,
                 toolsVersion: m.tools.version, appCommit: p.app_commit };
    }
    if (UpdateCore.compareVersions(m.tools.version, local.toolsVersion) > 0) {
        return { kind: "tools", asset: m.tools.asset, sha256: m.tools.sha256, size: m.tools.size,
                 toolsVersion: m.tools.version, fromVersion: local.toolsVersion };
    }
    return { kind: "none" };
};

/** "Skip this version" remembers this; any new publish changes it. */
UpdateCore.key = function(m) {
    var parts = [String(m.tools.commit)], names = [];
    for (var p in m.platforms) { if (m.platforms.hasOwnProperty(p)) { names.push(p); } }
    names.sort();
    for (var i = 0; i < names.length; i++) { parts.push(names[i] + "=" + m.platforms[names[i]].app_commit); }
    return parts.join("|");
};

/** sha256sum format "<hex>  <name>" to lowercase hex, or null. */
UpdateCore.parseSidecar = function(text) {
    var m = /^\s*([0-9a-fA-F]{64})\b/.exec(String(text));
    return m ? m[1].toLowerCase() : null;
};
