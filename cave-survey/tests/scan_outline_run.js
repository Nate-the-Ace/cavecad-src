/**
 * Trimming a scan to a TRACED OUTLINE rather than a box.
 *
 * The derivative is still a rectangle -- the outline's own bounding box
 * -- with everything outside the line made transparent. That is what
 * keeps the rest of the suite working untouched, so this asserts both
 * halves: that the mask is really cut, and that the placement records
 * the same x/y/w/h a boxed crop would.
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

var passed = 0, failures = [];
function ok(c, what) { if (c) { passed++; } else { failures.push(what); } }

// A cave folder with one page in it.
var caveDir = QDir.tempPath() + "/cs_outline_test";
var scansDir = caveDir + "/" + CsCave.SCANS;
new QDir().removeRecursively && new QDir(caveDir).removeRecursively();
new QDir().mkpath(scansDir + "/Trip 1");

var PAGE_W = 300, PAGE_H = 400;
var page = new QImage(PAGE_W, PAGE_H, QImage.Format_RGB32);
page.fill(new QColor(20, 20, 20));          // dark, so "kept" is visible
var pageRel = "Trip 1/page one.png";
ok(page.save(scansDir + "/" + pageRel, "PNG"), "the test page was written");

// An L, concave on purpose: a convex-only mask would keep the notch.
var outline = [{ x: 20, y: 20 }, { x: 220, y: 20 }, { x: 220, y: 120 },
               { x: 120, y: 120 }, { x: 120, y: 320 }, { x: 20, y: 320 }];
var rect = CsScanTrim.outlineBounds(outline);
ok(rect.x === 20 && rect.y === 20 && rect.w === 200 && rect.h === 300,
   "the crop is the outline's bounding box");

var made = CsScanTrim.write(scansDir, pageRel, rect, outline);
ok(made.path !== null, "the masked derivative was written: " + made.error);

if (made.path !== null) {
    ok(made.path.indexOf(CsScanTrim.FOLDER) >= 0,
       "it lives in the Trimmed folder");
    ok(/_p[0-9a-f]{8}\.png$/.test(made.path),
       "and its name carries a tag for the outline");

    var cut = new QImage(made.path);
    ok(!cut.isNull(), "the derivative reads back as an image");
    ok(cut.width() === rect.w && cut.height() === rect.h,
       "it is the size of the box (" + cut.width() + "x" + cut.height() + ")");
    ok(cut.hasAlphaChannel(), "and it carries transparency at all");

    // Inside the top arm, inside the upright, and in the notch. Page
    // coordinates minus the crop origin.
    function alphaAt(px, py) {
        return cut.pixelColor(px - rect.x, py - rect.y).alpha();
    }
    ok(alphaAt(200, 40) === 255, "the top arm is kept (" + alphaAt(200, 40) + ")");
    ok(alphaAt(40, 300) === 255, "the upright is kept (" + alphaAt(40, 300) + ")");
    ok(alphaAt(200, 300) === 0, "the NOTCH is cut away (" + alphaAt(200, 300) + ")");
    ok(alphaAt(25, 25) === 255, "just inside a corner is kept");

    // Cutting the same outline again finds the file already there.
    var again = CsScanTrim.write(scansDir, pageRel, rect, outline);
    ok(again.path === made.path, "the same outline resolves to the same file");

    // ------------------------------------------------------------------
    // Placed, lost, and recovered: the outline has to survive the round
    // trip or relink brings back the whole box with the clutter in it.
    // ------------------------------------------------------------------
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    doc.setFileName(caveDir + "/Test Cave.dxf");

    var op = new RAddObjectsOperation();
    var img = new RImageEntity(doc, new RImageData());
    img.setProperty(RImageEntity.PropertyFileName, made.path);
    CsTags.set(img, "SketchScan", pageRel);
    CsTags.set(img, CsScanTrim.TAG, CsScanTrim.serialize(rect));
    CsTags.set(img, CsScanTrim.OUTLINE_TAG,
        CsScanTrim.serializeOutline(outline));
    op.addObject(img, false);
    di.applyOperation(op);

    var ids = doc.queryAllEntities(false, true, RS.EntityImage);
    var lose = new RModifyObjectsOperation();
    lose.addObject(doc.queryEntity(ids[0]), false);
    doc.queryEntity(ids[0]).setProperty(RImageEntity.PropertyFileName, "");
    var e0 = doc.queryEntity(ids[0]);
    e0.setProperty(RImageEntity.PropertyFileName, "");
    var lose2 = new RModifyObjectsOperation();
    lose2.addObject(e0, false);
    di.applyOperation(lose2);

    QFile.remove(made.path);
    ok(!(new QFileInfo(made.path)).exists(), "the derivative was deleted");

    var r = CsScanRelink.run(doc, di);
    ok(r.relinked === 1, "the scan was relinked (" + r.relinked + ")");
    ok(r.retrimmed === 1, "by cutting its crop again (" + r.retrimmed + ")");
    ok((new QFileInfo(made.path)).exists(),
       "and the re-cut lands on the same file name");

    var recut = new QImage(made.path);
    ok(!recut.isNull() && recut.hasAlphaChannel(),
       "the re-cut file is masked too");
    if (!recut.isNull()) {
        ok(recut.pixelColor(200 - rect.x, 300 - rect.y).alpha() === 0,
           "and its notch is still cut away -- not the whole box back");
    }
}

// ----------------------------------------------------------------------
// LETTING GO OF A STROKE CLOSES THE SHAPE, but a click does not.
//
// CsScanView.strokeCloses is the real rule the release handler asks --
// not a copy of it here. The handler itself needs a live view and a
// real mouse event, which is exactly why the decision sits in a
// function that needs neither.
// ----------------------------------------------------------------------
function atPress(points, strokeAt) {
    return { tracePoints: points, traceStrokeAt: strokeAt };
}

// A stroke: the press laid one point, moving laid more.
ok(CsScanView.strokeCloses(atPress(
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 1)),
   "letting go of a traced stroke closes the shape");

// A click: the press laid the fourth point and nothing moved after it.
ok(!CsScanView.strokeCloses(atPress(
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }], 4)),
   "a click that did not move lays a corner and does NOT close");

// A stroke too short to be a shape.
ok(!CsScanView.strokeCloses(atPress([{ x: 0, y: 0 }, { x: 3, y: 0 }], 1)),
   "two points are not a shape to close");

// Nothing armed, nothing traced.
ok(!CsScanView.strokeCloses(atPress([], null)),
   "no stroke, nothing to close");
ok(!CsScanView.strokeCloses(null), "and no view is not a crash");

// ----------------------------------------------------------------------
// THE MASK SURVIVES THE 3D VIEW'S TEXTURE CAP.
//
// RCave3dTexture scales anything over 2048px with SmoothTransformation
// before upload, and a real survey page is bigger than that. Smooth
// scaling of a masked image is where transparency goes wrong: a
// transparent pixel carries RGB 0,0,0, so a scaler that blends
// unpremultiplied would drag black into the paper along every cut
// edge. This does the same scale and looks.
// ----------------------------------------------------------------------
var bigW = 2600, bigH = 2000;
var bigPage = new QImage(bigW, bigH, QImage.Format_RGB32);
bigPage.fill(new QColor(255, 255, 255));
var bigRel = "Trip 1/big.png";
ok(bigPage.save(scansDir + "/" + bigRel, "PNG"), "a page over the cap was written");

var bigOutline = [{ x: 100, y: 100 }, { x: 2500, y: 100 },
                  { x: 2500, y: 1000 }, { x: 1300, y: 1000 },
                  { x: 1300, y: 1900 }, { x: 100, y: 1900 }];
var bigBox = CsScanTrim.outlineBounds(bigOutline);
var bigCut = CsScanTrim.write(scansDir, bigRel, bigBox, bigOutline);
ok(bigCut.path !== null, "and masked to an outline");

if (bigCut.path !== null) {
    var bigImg = new QImage(bigCut.path);
    // RCave3dTexture::MAX_PX
    var scaled = bigImg.scaled(2048, 2048, Qt.KeepAspectRatio,
        Qt.SmoothTransformation);
    ok(scaled.hasAlphaChannel(),
       "the mask still carries transparency after the downscale");

    function at(fx, fy) {
        return scaled.pixelColor(Math.round(scaled.width() * fx),
                                 Math.round(scaled.height() * fy));
    }
    var deep = at(0.10, 0.10);
    var nearEdge = at(0.47, 0.70);
    var notch = at(0.80, 0.80);
    ok(deep.alpha() === 255, "paper well inside the outline is kept");
    ok(notch.alpha() === 0,
       "and the notch is still cut away (" + notch.alpha() + ")");
    // The edge is where unpremultiplied blending would show as a dark
    // fringe, so compare it against paper far from any cut.
    ok(nearEdge.alpha() === 255 &&
       Math.abs(nearEdge.red() - deep.red()) < 40,
       "paper beside a cut edge is not darkened by the scale (" +
       nearEdge.red() + " against " + deep.red() + ")");
}

// ----------------------------------------------------------------------
// MIDDLE-DRAG PANS WHILE TRACING.
//
// `tracing` is a MODE that stays on for as long as the outline is being
// drawn, while panFrom lasts one drag -- so a tracing test ahead of the
// pan swallows every middle-drag for the whole session and the scan
// cannot be moved while being traced. Which is when it most needs to
// be: the outline runs off the edge of the view.
// ----------------------------------------------------------------------
ok(CsScanView.movePhase({ tracing: true, panFrom: { x: 5, y: 5 } }) === "pan",
   "a pan in progress beats tracing, or the scan cannot be moved while "
    + "it is being drawn round");
ok(CsScanView.movePhase({ tracing: true }) === "trace",
   "with no pan under way, tracing takes the move");
ok(CsScanView.movePhase({ boxing: true, boxFrom: { x: 1, y: 1 } }) === "box",
   "a box in progress takes it");
ok(CsScanView.movePhase({ tracing: true, boxFrom: { x: 1, y: 1 } }) === "trace",
   "tracing beats a stale box");
ok(CsScanView.movePhase({}) === "base",
   "and with nothing in progress the view handles its own move");
ok(CsScanView.movePhase(null) === "base", "no view is not a crash");

var dir = new QDir(caveDir);
dir.removeRecursively();

if (failures.length > 0) {
    print("### SCAN OUTLINE FAILED");
    for (var f = 0; f < failures.length; f++) { print("  - " + failures[f]); }
    QCoreApplication.exit(1);
} else {
    print("### SCAN OUTLINE OK " + passed + " assertions");
    QCoreApplication.exit(0);
}
