/**
 * Relinking a scan puts back the BOX, not the page.
 *
 * A scan goes into a drawing trimmed to the rectangle the caver drew on
 * it. When the image cross reference is lost, SketchScan says which page
 * it came from and ScanTrim says which part of that page -- and both
 * have to be honoured. Relinking to the page alone puts whole untrimmed
 * sheets back over the map, which is what happened to Truitt Cave the
 * first time this repair was run.
 *
 * This builds a real cave folder with a real page on disk, places an
 * image the way SketchScans does, loses its file reference the way a bad
 * save did, and asks for it back.
 */
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) { passed++; } else { failures.push(what); }
}

// ------------------------------------------------------------------
// A cave folder on disk, with one scanned page in it.
// ------------------------------------------------------------------
var caveDir = QDir.tempPath() + "/cs_relink_test";
var scansDir = caveDir + "/" + CsCave.SCANS;
new QDir().mkpath(scansDir);

var PAGE_W = 400, PAGE_H = 600;
var page = new QImage(PAGE_W, PAGE_H, QImage.Format_RGB32);
page.fill(new QColor(255, 255, 255));
var pageRel = "Trip 1/page one.png";
new QDir().mkpath(scansDir + "/Trip 1");
ok(page.save(scansDir + "/" + pageRel, "PNG"), "the test page was written");

// ------------------------------------------------------------------
// A drawing holding that page, trimmed -- the state SketchScans leaves.
// ------------------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
doc.setFileName(caveDir + "/Test Cave.dxf");

var box = { x: 40, y: 50, w: 120, h: 200 };
var made = CsScanTrim.write(scansDir, pageRel, box);
ok(made.path !== null, "the derivative was cut from the page");

var op = new RAddObjectsOperation();
var img = new RImageEntity(doc, new RImageData());
img.setProperty(RImageEntity.PropertyFileName, made.path);
img.setProperty(RImageEntity.PropertyUX, 1.0);
img.setProperty(RImageEntity.PropertyUY, 0.0);
img.setProperty(RImageEntity.PropertyVX, 0.0);
img.setProperty(RImageEntity.PropertyVY, 1.0);
CsTags.set(img, "SketchScan", pageRel);
CsTags.set(img, CsScanTrim.TAG, CsScanTrim.serialize(box));
op.addObject(img, false);

// A second scan, placed whole: no box was ever drawn on it.
var pageTwoRel = "Trip 1/page two.png";
page.save(scansDir + "/" + pageTwoRel, "PNG");
var whole = new RImageEntity(doc, new RImageData());
whole.setProperty(RImageEntity.PropertyFileName, scansDir + "/" + pageTwoRel);
CsTags.set(whole, "SketchScan", pageTwoRel);
op.addObject(whole, false);

di.applyOperation(op);

// ------------------------------------------------------------------
// Lose both file references, the way the broken reader did.
// ------------------------------------------------------------------
var ids = doc.queryAllEntities(false, true, RS.EntityImage);
ok(ids.length === 2, "two images were placed");
var lose = new RModifyObjectsOperation();
for (var i = 0; i < ids.length; i++) {
    var e = doc.queryEntity(ids[i]);
    e.setProperty(RImageEntity.PropertyFileName, "");
    lose.addObject(e, false);
}
di.applyOperation(lose);

// ------------------------------------------------------------------
// Ask for them back.
// ------------------------------------------------------------------
var r = CsScanRelink.run(doc, di);
ok(r.relinked === 2, "both images were relinked, got " + r.relinked);
ok(r.retrimmed === 1, "one went back to its box, got " + r.retrimmed);
ok(r.missing.length === 0, "nothing was reported missing");

var sawTrim = false, sawWhole = false;
ids = doc.queryAllEntities(false, true, RS.EntityImage);
for (var j = 0; j < ids.length; j++) {
    var got = String(doc.queryEntity(ids[j])
        .getProperty(RImageEntity.PropertyFileName)[0]);
    if (got.indexOf(CsScanTrim.MARK) >= 0) {
        sawTrim = true;
        var back = CsScanTrim.parseName(got);
        ok(back !== null && back.x === box.x && back.y === box.y
           && back.w === box.w && back.h === box.h,
           "the box came back as it was drawn");
        var cut = new QImage(got);
        ok(!cut.isNull() && cut.width() === box.w && cut.height() === box.h,
           "the derivative on disk is the size of the box");
    } else if (got.indexOf("page two") >= 0) {
        sawWhole = true;
    }
}
ok(sawTrim, "the trimmed scan points at its derivative, not the page");
ok(sawWhole, "the untrimmed scan points at its page");

// ------------------------------------------------------------------
// The derivative deleted: it gets cut again rather than the page going
// down whole.
// ------------------------------------------------------------------
var lose2 = new RModifyObjectsOperation();
ids = doc.queryAllEntities(false, true, RS.EntityImage);
for (var k = 0; k < ids.length; k++) {
    var e2 = doc.queryEntity(ids[k]);
    e2.setProperty(RImageEntity.PropertyFileName, "");
    lose2.addObject(e2, false);
}
di.applyOperation(lose2);
QFile.remove(made.path);
ok(!(new QFileInfo(made.path)).exists(), "the derivative was deleted");

var r2 = CsScanRelink.run(doc, di);
ok(r2.retrimmed === 1, "the box was cut again, got " + r2.retrimmed);
ok((new QFileInfo(made.path)).exists(),
   "cutting it again produced the same file name");

// ------------------------------------------------------------------
var dir = new QDir(caveDir);
dir.removeRecursively();

if (failures.length > 0) {
    print("### SCAN RELINK FAILED");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
    QCoreApplication.exit(1);
} else {
    print("### SCAN RELINK OK " + passed + " assertions");
    QCoreApplication.exit(0);
}
