// scan_one_station_run.js -- placing a sketch through ONE station.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_one_station_run.js "$PWD"
//
// Prints "### ONE STATION OK" / "### ONE STATION FAIL".
//
// WHY A REAL DOCUMENT. The arithmetic is already covered in
// tests/js_unit.js. What cannot be covered there is whether QCAD PLACES
// the scan where that arithmetic says: the anchor is checked back
// through the placed image's own mapFromImage, the borrowed scale is
// read back off the entity the way placedScales reads it, and the turn
// is the real entity.rotate the tool uses -- the one that must leave
// the anchor station standing still.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(e) {
        return !isNull(e) && typeof e.getType === "function" &&
            e.getType() === RS.EntityImage;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}
if (typeof warning === "undefined") {
    warning = function(msg) { print("WARNING: " + msg); };
}
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}
if (typeof isNumber === "undefined") {
    isNumber = function(v) { return typeof v === "number" && !isNaN(v); };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
function loadRepoScript(rel) {
    var f = new QFile(repoRoot + "/" + rel);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var st = new QTextStream(f);
    var src = String(st.readAll());
    f.close();
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid", "CsUnits", "CsAngles", "CsCave", "CsScanTree", "CsStore",
 "CsTags", "CsLayers", "CsStationOrder", "CsScanFit", "CsScanFrame",
 "CsScanTrim", "CsScanRotate"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

// SketchScans.js is a GUI tool; the same stub scan_trim_run.js uses.
if (typeof EAction === "undefined") {
    EAction = function() {};
    EAction.prototype = {};
    EAction.getDocument = function() { return null; };
    EAction.getDocumentInterface = function() { return null; };
    EAction.handleUserMessage = function() {};
}
// The scans list moved to Core when the Survey Notebook needed the
// same browser; SketchScans reads its tick from there at LOAD time.
loadRepoScript("scripts/CaveSurvey/Core/CsScanList.js");
loadRepoScript("scripts/CaveSurvey/SketchScans/SketchScans.js");
// ScanTurn.js derives from stock Transform, which is not loadable
// headlessly -- but its geometry is static and that is what is under
// test here, so only the two pure functions are lifted out.
(function () {
    var f = new QFile(repoRoot +
        "/scripts/CaveSurvey/SketchScans/ScanTurn.js");
    f.open(QIODevice.ReadOnly | QIODevice.Text);
    var src = String(new QTextStream(f).readAll());
    f.close();
    ScanTurn = {};
    var wanted = ["angleFor", "bearingOf"];
    for (var i = 0; i < wanted.length; i++) {
        var re = new RegExp("ScanTurn\\." + wanted[i] +
            " = function[\\s\\S]*?\\n};", "m");
        var m = re.exec(src);
        if (m === null) {
            throw new Error("ScanTurn." + wanted[i] + " not found");
        }
        (0, eval)(m[0]);
    }
}());

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}
function checkClose(name, a, b, tol) {
    checks++;
    if (!(Math.abs(a - b) <= (tol === undefined ? 0.01 : tol))) {
        failures.push(name + " -- expected " + b + ", got " + a);
    }
}

var scanPath = repoRoot + "/scripts/CaveSurvey/SketchScans/SketchScans.svg";
var img = new QImage(scanPath);
check("the test scan is readable", !img.isNull());
var pxW = img.width(), pxH = img.height();

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

// --- nothing placed yet: nothing to borrow ---------------------------
check("an empty drawing offers no scale to borrow",
    CsScanFit.medianOf(SketchScans.placedScales(doc)) === null);

// --- a neighbour, placed the honest way (two stations) ---------------
var neighbourPairs = [
    { name: "A1", label: "A1", source: { x: 0, y: 0 },
      dest: { x: 0, y: 0 } },
    { name: "A2", label: "A2", source: { x: pxW, y: 0 },
      dest: { x: pxW * 0.5, y: 0 } }
];
var neighbourFit = CsScanFit.fit(neighbourPairs);
check("the neighbour fits", neighbourFit !== null);
var neighbourId = SketchScans.insertFitted(doc, di, scanPath,
    "Trip1/page1.svg", neighbourFit, pxH, neighbourPairs, "plan");
check("the neighbour placed", neighbourId !== null);

var borrowed = CsScanFit.medianOf(SketchScans.placedScales(doc));
checkClose("the borrowed scale is the neighbour's own", borrowed, 0.5,
    1e-6);

// --- the one-station placement ---------------------------------------
var anchor = { name: "B4", label: "B4",
               source: { x: 120, y: 80 },
               dest: { x: 300, y: -200 } };
var matrix = CsScanFit.anchoredFit(anchor, borrowed, 0);
check("the one-station fit exists", matrix !== null);
var id = SketchScans.insertFitted(doc, di, scanPath, "Trip1/detail.svg",
    { matrix: matrix, kind: "anchored" }, pxH, [anchor], "plan");
check("the one-station scan placed", id !== null);

var entity = doc.queryEntity(id);
check("and it is an image", !isNull(entity) && isImageEntity(entity));

// THE ANCHOR, through QCAD's own mapping -- not through my matrix.
var back = entity.getData().mapFromImage(
    new RVector(anchor.source.x, anchor.source.y, 0));
checkClose("the anchor lands on its station (x)", back.x, anchor.dest.x);
checkClose("the anchor lands on its station (y)", back.y, anchor.dest.y);

// THE SCALE, read back the way placedScales reads it.
var u = entity.getUVector();
checkClose("the placed scan carries the borrowed scale",
    Math.sqrt(u.x * u.x + u.y * u.y), borrowed, 1e-6);
var v = entity.getVVector();
checkClose("and is not stretched", Math.sqrt(v.x * v.x + v.y * v.y),
    borrowed, 1e-6);

// NORTH-UP: the page's own up is the drawing's up.
checkClose("the placement is north-up (u has no y)", u.y, 0, 1e-9);
checkClose("the placement is north-up (v has no x)", v.x, 0, 1e-9);
check("and the new scan did not move the median",
    Math.abs(CsScanFit.medianOf(SketchScans.placedScales(doc)) -
        borrowed) < 1e-6);

// The one-station placement still records what it was pinned to.
check("the anchor station is recorded",
    CsTags.get(entity, CsStationOrder.TAG).indexOf("B4") >= 0);
check("and where on the page it was picked",
    CsTags.get(entity, "ScanAnchors").indexOf("B4") >= 0);

// --- the turn --------------------------------------------------------
// A cursor due EAST of the anchor means the page's up should point east:
// a quarter turn clockwise, which is negative in a y-up drawing.
var east = ScanTurn.angleFor(anchor.dest,
    { x: anchor.dest.x + 100, y: anchor.dest.y });
checkClose("a cursor east of the anchor is a quarter turn clockwise",
    east, -Math.PI / 2, 1e-9);
checkClose("a cursor north of the anchor is no turn at all",
    ScanTurn.angleFor(anchor.dest,
        { x: anchor.dest.x, y: anchor.dest.y + 50 }), 0, 1e-9);
checkClose("the cursor ON the anchor reads as no turn",
    ScanTurn.angleFor(anchor.dest, anchor.dest), 0, 1e-9);
checkClose("east reads as a bearing of 90", ScanTurn.bearingOf(east), 90,
    1e-9);

// THE REAL ROTATION the action applies.
entity.rotate(east, new RVector(anchor.dest.x, anchor.dest.y));
var op = new RModifyObjectsOperation();
op.addObject(entity, false);
di.applyOperation(op);

var turned = doc.queryEntity(id);
var backTurned = turned.getData().mapFromImage(
    new RVector(anchor.source.x, anchor.source.y, 0));
checkClose("the anchor stands still through the turn (x)", backTurned.x,
    anchor.dest.x);
checkClose("the anchor stands still through the turn (y)", backTurned.y,
    anchor.dest.y);
var uT = turned.getUVector();
checkClose("and the scale is untouched",
    Math.sqrt(uT.x * uT.x + uT.y * uT.y), borrowed, 1e-6);
// The page's own up now points east.
var upT = turned.getVVector();
checkClose("the page's up now points east", upT.x, borrowed, 1e-6);
checkClose("and no longer north", upT.y, 0, 1e-6);

if (failures.length === 0) {
    print("### ONE STATION OK " + checks);
} else {
    for (var i = 0; i < failures.length; i++) { print("FAIL: " + failures[i]); }
    print("### ONE STATION FAIL " + failures.length + " of " + checks);
}
