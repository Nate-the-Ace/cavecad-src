include(RSettings.getOriginalArguments()[RSettings.getOriginalArguments().indexOf("-autostart") + 2] + "/tests/updater/harness.js");
load("scripts/library.js");
load("scripts/Help/CheckForUpdates/CcUpdateCommands.js");
load("scripts/Help/CheckForUpdates/CcUpdateRun.js");
load("scripts/Help/SendFeedback/FeedbackCore.js");
load("scripts/Help/SendFeedback/FeedbackCommands.js");
load("scripts/Help/SendFeedback/FeedbackPackage.js");

var root = QDir.tempPath() + "/cc-fbpkg";
(new QDir(root)).removeRecursively();
(new QDir()).mkpath(root + "/logs");
["session-20260901-100000.log", "session-20260927-090000.log", "session-20260915-120000.log"].forEach(function(n) {
    writeFile(root + "/logs/" + n, n);
});
eqs(FeedbackPackage.latestLogs(root + "/logs").map(function(p) { return p.replace(/^.*\//, ""); }).join(","),
    "session-20260927-090000.log,session-20260915-120000.log", "two newest logs, newest first");

// a cave folder with a drawing, a survey file, two scans and a dotfolder
(new QDir()).mkpath(root + "/cave/scans");
(new QDir()).mkpath(root + "/cave/.git");
writeFile(root + "/cave/trip1.svx", "*begin");
writeFile(root + "/cave/scans/p1.png", "png1");
writeFile(root + "/cave/scans/p2.png", "png2");
writeFile(root + "/cave/.git/HEAD", "x");
eqs(FeedbackPackage.listFiles(root + "/cave").sort().join(","), "scans/p1.png,scans/p2.png,trip1.svx", "list skips dotfolders");
ok(!FeedbackPackage.lastListTruncated, "not truncated under the cap");

// listFiles caps out instead of walking forever/huge
var savedMax = FeedbackPackage.LIST_MAX;
FeedbackPackage.LIST_MAX = 3;
eqs(FeedbackPackage.listFiles(root + "/cave").length, 3, "capped list stops at LIST_MAX");
ok(FeedbackPackage.lastListTruncated, "cap sets lastListTruncated");
FeedbackPackage.LIST_MAX = savedMax;

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di = new RDocumentInterface(doc);
var img = new RImageEntity(doc, new RImageData("scans/p1.png", new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), 50, 50, 0));
di.applyOperation(new RAddObjectOperation(img, false));
var img2 = new RImageEntity(doc, new RImageData(root + "/cave/scans/p1.png", new RVector(5, 0), new RVector(1, 0), new RVector(0, 1), 50, 50, 0));
di.applyOperation(new RAddObjectOperation(img2, false));
eqs(FeedbackPackage.usedScans(doc, root + "/cave").join(","), root + "/cave/scans/p1.png", "used scans resolved and de-duplicated");

doc.setFileName(root + "/cave/Pitfall.dxf");
doc.setModified(true);
ok(FeedbackPackage.copyDrawing(di, root + "/copy.dxf"), "drawing copied");
ok(new QFileInfo(root + "/copy.dxf").size() > 0, "copy written");
eqs(String(doc.getFileName()), root + "/cave/Pitfall.dxf", "file name untouched");
ok(doc.isModified(), "modified flag untouched");

var stagingBase = root + "/feedback/staging";
var basicOpts = {
    fields: { type: "bug", summary: "s", description: "d", email: "" },
    meta: { version: "v", commit: "c", caveSurvey: "t", os: "o", activeTool: "a", documents: [], created: "2026-09-27T20:00:00" },
    logs: [], screenshot: null, drawing: null, caveDir: null, surveyFiles: [], scans: []
};

// stage() refuses before it ever calls removeRecursively -- its guard is the
// only thing standing between a blank/malformed id or base and a wipe of the
// staging root (or worse, of "/"). Both refusals must delete nothing.
(new QDir()).mkpath(stagingBase);
writeFile(stagingBase + "/marker", "x");
function withOpts(base, id) {
    var o = {}; for (var k in basicOpts) { o[k] = basicOpts[k]; } o.base = base; o.id = id; return o;
}
eqs(FeedbackPackage.stage(withOpts(stagingBase, "")), null, "refuses an empty id");
ok(new QFileInfo(stagingBase + "/marker").exists(), "empty-id refusal deleted nothing");
eqs(FeedbackPackage.stage(withOpts(stagingBase, "bad-id")), null, "refuses a malformed id");
ok(new QFileInfo(stagingBase + "/marker").exists(), "malformed-id refusal deleted nothing");
eqs(FeedbackPackage.stage(withOpts(root + "/staging", "a7f3c2")), null, "refuses a base not ending in /feedback/staging");
eqs(FeedbackPackage.stage(withOpts("", "a7f3c2")), null, "refuses an empty base");
eqs(FeedbackPackage.stage(withOpts("feedback/staging", "a7f3c2")), null, "refuses a relative base");
ok(new QFileInfo(stagingBase + "/marker").exists(), "bad-base refusals deleted nothing");
(new QDir(stagingBase)).removeRecursively();

var s = FeedbackPackage.stage({
    base: stagingBase, id: "a7f3c2",
    fields: { type: "bug", summary: "s", description: "d", email: "" },
    meta: { version: "v", commit: "c", caveSurvey: "t", os: "o", activeTool: "a", documents: ["Pitfall.dxf"], created: "2026-09-27T20:00:00" },
    logs: FeedbackPackage.latestLogs(root + "/logs"),
    screenshot: null,
    drawing: root + "/copy.dxf",
    caveDir: root + "/cave", surveyFiles: ["trip1.svx"], scans: [root + "/cave/scans/p1.png"], scanMode: "used"
});
ok(s !== null, "well-formed id and base accepted");
var rep = JSON.parse(readFile(s.dir + "/report.json"));
eqs(rep.attachments.map(function(a) { return a.path; }).sort().join(","),
    "cave/scans/p1.png,cave/trip1.svx,drawing.dxf,logs/session-20260915-120000.log,logs/session-20260927-090000.log",
    "attachments listed");
eqs(rep.consent.scans, "used", "scan consent recorded");
ok(rep.consent.drawing && rep.consent.surveyFiles, "drawing and survey consent recorded");
eqs(s.scanBytes, 4, "scan bytes counted separately");
ok(s.bytes > s.scanBytes, "total bytes include everything");

// out-of-cave scans with a colliding basename get suffixed, not merged
(new QDir()).mkpath(root + "/other1");
(new QDir()).mkpath(root + "/other2");
writeFile(root + "/other1/p1.png", "AA");
writeFile(root + "/other2/p1.png", "BBB");
var s2 = FeedbackPackage.stage({
    base: stagingBase, id: "b1c2d3",
    fields: { type: "bug", summary: "s", description: "d", email: "" },
    meta: { version: "v", commit: "c", caveSurvey: "t", os: "o", activeTool: "a", documents: [], created: "2026-09-27T20:00:00" },
    logs: [], screenshot: null, drawing: null,
    caveDir: root + "/cave", surveyFiles: [], scans: [root + "/other1/p1.png", root + "/other2/p1.png"], scanMode: "chosen"
});
ok(s2 !== null, "collision-test stage accepted");
var rep2 = JSON.parse(readFile(s2.dir + "/report.json"));
eqs(rep2.attachments.map(function(a) { return a.path; }).sort().join(","),
    "cave/scans/p1-2.png,cave/scans/p1.png", "colliding basenames suffixed, not merged");
eqs(s2.scanBytes, 5, "both colliding scans counted (2 + 3 bytes)");

var loop = new QEventLoop(), zr = null;
FeedbackPackage.zip(s.dir, root + "/r.zip", function(x) { zr = x; loop.quit(); }); loop.exec();
ok(zr.ok && new QFileInfo(root + "/r.zip").size() > 0, "zipped: " + (zr && zr.error));
(new QDir(root)).removeRecursively();
finish("package");
