include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/Help/SendFeedback/FeedbackConfig.js");
load("scripts/Help/SendFeedback/FeedbackCore.js");

var MB = 1024 * 1024;
var seq = [0, 0.1, 0.99, 0.5, 0.25, 0.75], k = 0;
eqs(FeedbackCore.newId(function() { return seq[k++]; }), "01f84c", "id from 6 draws");
ok(/^[0-9a-f]{6}$/.test(FeedbackCore.newId()), "random id is 6 hex");
eqs(FeedbackCore.zipName("2026-09-27", "a7f3c2"), "feedback-2026-09-27-a7f3c2.zip", "zip name");

eqs(FeedbackCore.sizeVerdict(20 * MB), "ok", "20 MB ok");
eqs(FeedbackCore.sizeVerdict(20 * MB + 1), "warn", "over 20 MB warns");
eqs(FeedbackCore.sizeVerdict(30 * MB + 1), "block", "over 30 MB blocks");
ok(FeedbackCore.tooBigToEmail(25 * MB + 1) && !FeedbackCore.tooBigToEmail(25 * MB), "email limit 25 MB");

["scan", "The scanned page", "sketch", "Image", "picture", "PDF", "trim", "outline"].forEach(function(w) {
    ok(FeedbackCore.mentionsScan("my " + w + " is wrong"), "hint on " + w);
});
ok(!FeedbackCore.mentionsScan("the ledge tool crashed"), "no hint without a scan word");

["a.PNG", "b.jpg", "c.jpeg", "d.tif", "e.tiff", "f.bmp", "g.gif", "h.webp", "i.Pdf"].forEach(function(n) {
    ok(FeedbackCore.isScanFile("dir/" + n), "scan file " + n);
});
ok(!FeedbackCore.isScanFile("cave.dxf"), "dxf is not a scan");
eqs(FeedbackCore.surveyFiles(["cave.dxf", "trip1.svx", "scans/p1.png", ".DS_Store", "notes/a.txt", "x.pdf"]).join(","),
    "cave.dxf,trip1.svx,notes/a.txt", "survey files drop scans and dotfiles");
eqs(FeedbackCore.surveyFiles([".git/HEAD", "sub/.svn/x", "a.b/c.svx", "cave.dxf"]).join(","),
    "a.b/c.svx,cave.dxf", "survey files drop any dot path segment, not just the basename");
eqs(FeedbackCore.surveyFiles(["sub\\.git\\x", "sub\\ok.svx"]).join(","),
    "sub\\ok.svx", "survey files check dot segments on backslash paths too");

eqs(FeedbackCore.validate({ type: "bug", summary: "", description: "x" }).join("|"), "summary", "summary required");
eqs(FeedbackCore.validate({ type: "bug", summary: "s", description: " " }).join("|"), "description", "bug needs description");
eqs(FeedbackCore.validate({ type: "idea", summary: "s", description: "" }).length, 0, "idea may skip description");

var r = FeedbackCore.report({
    id: "a7f3c2", type: "bug", summary: "s", description: "d", email: "",
    version: "3.33.0.0", commit: "abc", caveSurvey: "0.9.181.2", os: "macOS 26",
    activeTool: "FeatureTrace", documents: ["Pitfall.dxf"],
    attachments: [{ path: "logs/session-1.log", bytes: 10 }],
    consent: { drawing: true, surveyFiles: false, scans: "none" }, created: "2026-09-27T20:00:00"
});
eqs(Object.keys(r).join(","),
    "schema,id,type,summary,description,email,cavecad,caveSurvey,os,activeTool,documents,attachments,consent,created",
    "report fields");
eqs(r.cavecad.commit, "abc", "commit kept");
eqs(r.consent.scans, "none", "consent kept");

var m = FeedbackCore.mailto("cavecad.app@gmail.com", "a7f3c2", "Trace & crash");
ok(m.indexOf("mailto:cavecad.app@gmail.com?subject=") === 0, "mailto address");
ok(m.indexOf(encodeURIComponent("CaveCAD Feedback a7f3c2: Trace & crash")) > 0, "mailto subject encoded");

// The placeholders themselves, not FeedbackConfig: CI fills the real values in
// before these tests run. tests/test_feedback_config.py guards the repo file.
ok(!FeedbackCore.configured({ ENDPOINT: "@@FEEDBACK_ENDPOINT@@", KEY: "@@FEEDBACK_KEY@@" }), "placeholders are not configured");
ok(FeedbackCore.configured({ ENDPOINT: "https://script.google.com/macros/s/X/exec", KEY: "k" }), "real endpoint configured");
eqs(FeedbackCore.parseReply('{"ok":true,"id":"a7f3c2"}').id, "a7f3c2", "good reply");
ok(!FeedbackCore.parseReply("<html>").ok, "html reply is a failure");
ok(!FeedbackCore.parseReply("").ok, "empty reply is a failure");

var st = {};
FeedbackCore.recordFailure(st, "f.zip"); FeedbackCore.recordFailure(st, "f.zip");
ok(!FeedbackCore.needsNotice(st), "two failures: no notice");
FeedbackCore.recordFailure(st, "f.zip");
ok(FeedbackCore.needsNotice(st), "third failure: notice");
FeedbackCore.recordSuccess(st, "f.zip");
ok(!st.hasOwnProperty("f.zip"), "success forgets the file");
finish("core");
