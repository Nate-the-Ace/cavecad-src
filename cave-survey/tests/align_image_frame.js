// align_image_frame.js -- a plan warp must not reach the elevation.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon \
//       -no-gui -allow-multiple-instances -autostart \
//       tests/align_image_frame.js "$PWD"
//
// Prints "### ALIGN IMAGE FRAME OK" on success, "### ALIGN IMAGE FRAME
// FAIL" plus the failed assertions otherwise.
//
// WHY A DRIVER OF ITS OWN. ScanAlign is a GUI tool derived from stock
// QCAD's Transform, which owns the only place entities are collected:
// it walks the user's SELECTION and calls ScanAlign.prototype.transform
// once per entity. That per-entity call is the one hook this repo owns,
// so this file loads ScanAlign.js with a STUB Transform underneath it
// and calls that method directly, against a real document -- the same
// thing the tool does, minus the mouse.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {}
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(entity) {
        return !isNull(entity) && typeof entity.getType === "function" &&
            entity.getType() === RS.EntityImage;
    };
}

function loadRepoScript(scriptPath) {
    var file = new QFile(repoRoot + "/" + scriptPath);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + scriptPath);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Strip include() lines: the Core files are loaded explicitly below,
    // and QCAD's own include() would look in the installed script
    // folders rather than this checkout. Same loader shape as
    // tests/js_unit.js.
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}

var CORE = ["CsUnits", "CsCave", "CsGeoProject", "CsAngles", "CsModel",
    "CsTags", "CsLayers", "CsDraw"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

// The stub standing in for scripts/Modify/Transform.js. ScanAlign.js
// runs `ScanAlign.prototype = new Transform()` at load, and this file
// only ever calls one method on the result, so an empty base is enough
// -- and is honest about it: nothing here claims to test QCAD's own
// selection handling, only what this repo does per entity.
function Transform() {}

loadRepoScript("scripts/CaveSurvey/SketchScans/ScanAlign.js");

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.PROFILE_CEILING);
CsLayers.ensure(doc, di, CsLayers.CTRL_PROFILE_SHOTS);

var addOp = new RAddObjectsOperation();

function addLine(layerName, x1, y1, x2, y2) {
    var line = new RLineEntity(doc,
        new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    line.setLayerId(doc.getLayerId(layerName));
    addOp.addObject(line, false);
    return line;
}

var planWall = addLine(CsLayers.WALLS_SURVEYED, 0, 0, 10, 0);
var tracedCeiling = addLine(CsLayers.PROFILE_CEILING, 0, -50, 10, -48);
var generatedLeg = addLine(CsLayers.CTRL_PROFILE_SHOTS, 0, -60, 10, -60);
di.applyOperation(addOp);

var planId = planWall.getId();
var tracedId = tracedCeiling.getId();
var generatedId = generatedLeg.getId();

function startOf(id) {
    var p = doc.queryEntity(id).getStartPoint();
    return { x: p.x, y: p.y };
}
function endOf(id) {
    var p = doc.queryEntity(id).getEndPoint();
    return { x: p.x, y: p.y };
}

var planBefore = { s: startOf(planId), e: endOf(planId) };
var tracedBefore = { s: startOf(tracedId), e: endOf(tracedId) };
var generatedBefore = { s: startOf(generatedId), e: endOf(generatedId) };

// A fit that genuinely moves, rotates and resizes, so "unchanged" below
// cannot pass by the transform being a no-op.
var fit = {
    type: "similarity",
    params: {
        angle: Math.PI / 6,
        factor: 1.5,
        center: new RVector(0, 0),
        offset: new RVector(25, 7)
    },
    straightLine: false
};

// What Transform hands ScanAlign.prototype.transform: the entity, its
// index, the operation to add to, preview=false, and QCAD's own flags.
var tool = {
    getFit: function() { return fit; },
    getDocument: function() { return doc; }
};

var op = new RModifyObjectsOperation();
var ids = [planId, tracedId, generatedId];
for (var i = 0; i < ids.length; i++) {
    ScanAlign.prototype.transform.call(tool, doc.queryEntity(ids[i]), i,
        op, false, false);
}
di.applyOperation(op);

var planAfter = { s: startOf(planId), e: endOf(planId) };
var tracedAfter = { s: startOf(tracedId), e: endOf(tracedId) };
var generatedAfter = { s: startOf(generatedId), e: endOf(generatedId) };

// ---- the plan geometry really was warped ---------------------------
// The regression floor: this task must not stop the tool working. The
// expected coordinates are computed from the same fit the tool applied,
// in the same order (rotate, scale, move), so a change in that order is
// a failure here rather than a silently different warp.
function expected(p) {
    var v = new RVector(p.x, p.y);
    v.rotate(fit.params.angle, fit.params.center);
    v.scale(fit.params.factor, fit.params.center);
    v.move(fit.params.offset);
    return v;
}
var planStartWant = expected(planBefore.s);
var planEndWant = expected(planBefore.e);
near(planAfter.s.x, planStartWant.x, 1e-9, "the plan wall's start warped in x");
near(planAfter.s.y, planStartWant.y, 1e-9, "the plan wall's start warped in y");
near(planAfter.e.x, planEndWant.x, 1e-9, "the plan wall's end warped in x");
near(planAfter.e.y, planEndWant.y, 1e-9, "the plan wall's end warped in y");
ok(Math.abs(planAfter.s.x - planBefore.s.x) > 1,
    "sanity: the fit really does move things (the plan wall moved " +
    (planAfter.s.x - planBefore.s.x) + " in x)");

// ---- and the elevation was not touched, per entity, at 1e-9 --------
near(tracedAfter.s.x, tracedBefore.s.x, 1e-9,
    "THE HAND-TRACED CEILING'S START DID NOT MOVE IN X");
near(tracedAfter.s.y, tracedBefore.s.y, 1e-9,
    "THE HAND-TRACED CEILING'S START DID NOT MOVE IN Y");
near(tracedAfter.e.x, tracedBefore.e.x, 1e-9,
    "the hand-traced ceiling's end did not move in x");
near(tracedAfter.e.y, tracedBefore.e.y, 1e-9,
    "the hand-traced ceiling's end did not move in y");
near(generatedAfter.s.x, generatedBefore.s.x, 1e-9,
    "the generated profile leg's start did not move in x");
near(generatedAfter.s.y, generatedBefore.s.y, 1e-9,
    "the generated profile leg's start did not move in y");
near(generatedAfter.e.x, generatedBefore.e.x, 1e-9,
    "the generated profile leg's end did not move in x");
near(generatedAfter.e.y, generatedBefore.e.y, 1e-9,
    "the generated profile leg's end did not move in y");

// ---- and the refusal is readable on its own ------------------------
eqs(String(ScanAlign.appliesTo(doc, doc.queryEntity(planId))), "true",
    "appliesTo says yes to a plan-frame entity");
eqs(String(ScanAlign.appliesTo(doc, doc.queryEntity(tracedId))), "false",
    "appliesTo says no to a traced profile-frame entity");
eqs(String(ScanAlign.appliesTo(doc, doc.queryEntity(generatedId))), "false",
    "appliesTo says no to a generated profile-frame entity");

if (failures.length === 0) {
    print("### ALIGN IMAGE FRAME OK");
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL  " + failures[f]);
    }
    print("### ALIGN IMAGE FRAME FAIL");
}
