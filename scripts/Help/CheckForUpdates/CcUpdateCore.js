// CcUpdateCore.js -- the updater's pure logic: nothing here touches the
// network, the disk or the UI, so all of it is unit-tested.

var UpdateCore = {};

// Downloads only ever come from here; the manifest supplies names only.
UpdateCore.BASE = "https://github.com/Nate-the-Ace/cavecad-src/releases/download/latest-build/";
UpdateCore.MANIFEST = "latest.json";
UpdateCore.SETTING_AUTO = "CheckForUpdates/AutoCheck";
UpdateCore.SETTING_SKIP = "CheckForUpdates/SkippedKey";

UpdateCore.has = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

/** Refuses (throws on) any name safeName rejects. */
UpdateCore.assetUrl = function(name) {
    if (!UpdateCore.safeName(name)) { throw new Error("unsafe asset name: " + name); }
    return UpdateCore.BASE + name;
};

/**
 * Dotted integer versions; missing parts are 0. >0 when a is newer.
 * AddOn.compareVersions (scripts/AddOn.js) is a deliberate copy: AddOn.js
 * loads before the updater exists. Change both together.
 */
UpdateCore.compareVersions = function(a, b) {
    var pa = String(a).split("."), pb = String(b).split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
        var x = parseInt(pa[i] || "0", 10) || 0, y = parseInt(pb[i] || "0", 10) || 0;
        if (x !== y) { return x - y; }
    }
    return 0;
};

UpdateCore.isHex64 = function(s) { return /^[0-9a-f]{64}$/.test(String(s)); };

/** A plain file name: letters, digits, . _ - ; not starting with a dot; no "..". */
UpdateCore.safeName = function(s) {
    if (typeof s !== "string") { return false; }
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && s.indexOf("..") < 0;
};

/** A platform entry the updater can act on. */
UpdateCore.validEntry = function(e) {
    return !!e && typeof e === "object" && !!e.app_commit && typeof e.app_commit === "string" &&
        UpdateCore.safeName(e.asset) && UpdateCore.isHex64(e.sha256);
};

/**
 * {ok, error, manifest, dropped}. The tools entry is checked strictly: a
 * bad one fails the whole manifest. A bad PLATFORM entry is only dropped
 * (named in `dropped`), so one broken build cannot stop updates for every
 * other platform. `manifest` is a cleaned copy holding only valid entries;
 * decide() must be given that one.
 */
UpdateCore.validate = function(m) {
    var fail = function(e) { return { ok: false, error: e, manifest: null, dropped: [] }; };
    if (m === null || typeof m !== "object") { return fail("not an object"); }
    if (m.schema !== 1) { return fail("unknown schema " + m.schema); }
    var t = m.tools;
    if (!t || typeof t !== "object" || !t.version || !UpdateCore.safeName(t.asset) || !UpdateCore.isHex64(t.sha256)) {
        return fail("bad tools entry");
    }
    if (!m.platforms || typeof m.platforms !== "object") { return fail("no platforms"); }
    var clean = {}, dropped = [];
    for (var p in m.platforms) {
        if (!UpdateCore.has(m.platforms, p)) { continue; }
        // "__proto__" would re-prototype the copy instead of adding a key
        if (p === "__proto__" || !UpdateCore.validEntry(m.platforms[p])) { dropped.push(p); continue; }
        clean[p] = m.platforms[p];
    }
    var out = {};
    for (var k in m) { if (UpdateCore.has(m, k) && k !== "__proto__") { out[k] = m[k]; } }
    out.platforms = clean;
    return { ok: true, error: "", manifest: out, dropped: dropped };
};

/**
 * local: {platform, appCommit, toolsVersion}. No platform or app commit, or
 * app commit "dev" = a development build (no cavecad-build.json): the
 * updater stays out.
 */
UpdateCore.decide = function(m, local) {
    if (!local || !local.platform || !local.appCommit || String(local.appCommit) === "dev") { return { kind: "dev" }; }
    var ps = m && m.platforms;
    if (!ps || !UpdateCore.has(ps, local.platform)) { return { kind: "none" }; }
    var p = ps[local.platform];
    if (!UpdateCore.validEntry(p)) { return { kind: "none" }; }
    // Direction-blind by design: any app_commit other than our own offers the
    // published build, even if ours is "newer" (a local or older-base
    // build) -- latest-build is the one channel, and what it holds wins.
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

/**
 * "Skip this version" remembers this. It names only the OFFER (a decide()
 * result), so a rebuild for some other platform does not re-prompt;
 * "" for a decision that offers nothing.
 */
UpdateCore.key = function(decision) {
    if (!decision || (decision.kind !== "full" && decision.kind !== "tools")) { return ""; }
    return decision.kind + "|" + decision.asset + "|" + decision.sha256;
};

/** sha256sum format "<hex>  <name>" to lowercase hex, or null. */
UpdateCore.parseSidecar = function(text) {
    var m = /^\s*([0-9a-fA-F]{64})\b/.exec(String(text));
    return m ? m[1].toLowerCase() : null;
};
