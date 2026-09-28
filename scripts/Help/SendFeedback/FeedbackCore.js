// FeedbackCore.js -- Send Feedback's decisions, free of UI, files and
// processes, so tests/feedback/core_test.js can check every one.

var FeedbackCore = {};

FeedbackCore.MB = 1024 * 1024;
FeedbackCore.WARN_BYTES = 20 * FeedbackCore.MB;    // base64 makes the POST a third bigger
FeedbackCore.BLOCK_BYTES = 30 * FeedbackCore.MB;   // stays under the receiver's 40 MB body cap
FeedbackCore.EMAIL_BYTES = 25 * FeedbackCore.MB;   // Gmail's attachment limit
FeedbackCore.NOTICE_AFTER = 3;                     // failed launches before the status-bar notice
FeedbackCore.TYPES = ["bug", "idea", "question"];
FeedbackCore.SCAN_EXT = ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "webp", "pdf"];
FeedbackCore.SCAN_WORDS = /\b(scan|sketch|image|picture|pdf|trim|outline)\w*/i;

FeedbackCore.newId = function(rand) {
    rand = rand || Math.random;
    var s = "";
    for (var i = 0; i < 6; i++) { s += "0123456789abcdef".charAt(Math.floor(rand() * 16)); }
    return s;
};

FeedbackCore.zipName = function(date, id) { return "feedback-" + date + "-" + id + ".zip"; };

FeedbackCore.sizeVerdict = function(bytes) {
    if (bytes > FeedbackCore.BLOCK_BYTES) { return "block"; }
    return bytes > FeedbackCore.WARN_BYTES ? "warn" : "ok";
};

FeedbackCore.tooBigToEmail = function(bytes) { return bytes > FeedbackCore.EMAIL_BYTES; };

FeedbackCore.mentionsScan = function(text) { return FeedbackCore.SCAN_WORDS.test(String(text || "")); };

FeedbackCore.isScanFile = function(path) {
    var m = /\.([^.\/\\]+)$/.exec(String(path));
    return m !== null && FeedbackCore.SCAN_EXT.indexOf(m[1].toLowerCase()) >= 0;
};

/** Relative paths of a cave folder -> the ones that are survey files (no scans, no dotfiles). */
FeedbackCore.surveyFiles = function(relPaths) {
    return relPaths.filter(function(p) {
        var base = String(p).replace(/^.*[\/\\]/, "");
        return base.charAt(0) !== "." && !FeedbackCore.isScanFile(p);
    });
};

/** Names of the missing required fields: "summary", "description". */
FeedbackCore.validate = function(f) {
    var out = [];
    if (String(f.summary || "").trim() === "") { out.push("summary"); }
    if (f.type === "bug" && String(f.description || "").trim() === "") { out.push("description"); }
    return out;
};

FeedbackCore.report = function(f) {
    return {
        schema: 1,
        id: f.id,
        type: f.type,
        summary: f.summary,
        description: f.description,
        email: f.email,
        cavecad: { version: f.version, commit: f.commit },
        caveSurvey: f.caveSurvey,
        os: f.os,
        activeTool: f.activeTool,
        documents: f.documents,
        attachments: f.attachments,
        consent: f.consent,
        created: f.created
    };
};

FeedbackCore.mailto = function(email, id, summary) {
    return "mailto:" + email
        + "?subject=" + encodeURIComponent("CaveCAD Feedback " + id + ": " + summary)
        + "&body=" + encodeURIComponent("Please attach the file CaveCAD showed you (it ends in " + id
            + ".zip).\n\nReference: " + id + "\n");
};

FeedbackCore.configured = function(cfg) {
    return /^https:\/\//.test(String(cfg.ENDPOINT)) && String(cfg.KEY).indexOf("@@") < 0 && String(cfg.KEY) !== "";
};

/** Receiver stdout -> {ok, id, error}. */
FeedbackCore.parseReply = function(stdout) {
    try {
        var o = JSON.parse(String(stdout));
        if (o && o.ok === true && /^[0-9a-f]{6}$/.test(String(o.id))) { return { ok: true, id: String(o.id) }; }
        return { ok: false, error: String(o && o.error ? o.error : "refused") };
    } catch (e) {
        return { ok: false, error: "unreadable reply" };
    }
};

// ---- outbox bookkeeping: state is {zipName: {failures: n}} ----
FeedbackCore.recordFailure = function(state, name) {
    state[name] = { failures: (state[name] ? state[name].failures : 0) + 1 };
};
FeedbackCore.recordSuccess = function(state, name) { delete state[name]; };
FeedbackCore.needsNotice = function(state) {
    for (var n in state) {
        if (state.hasOwnProperty(n) && state[n].failures >= FeedbackCore.NOTICE_AFTER) { return true; }
    }
    return false;
};
