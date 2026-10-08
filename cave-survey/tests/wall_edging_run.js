// wall_edging_run.js -- the Wall Edging switch, against a real drawing.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/wall_edging_run.js "$PWD"
//
// The side geometry itself is unit-tested in js_unit.js. What can only
// be asked of a real document is here: that the switch dresses the
// right walls and no others, that turning it off puts the drawing back,
// and that turning it on again reproduces the SAME glyphs rather than
// reshuffling a wall the caver has been looking at.

if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ShapedLines";
include(includeBasePath + "/WallEdging.js");

// THE NATIVE isNull CANNOT SEE THIS BUILD'S PROXY WRAPPER, so a test
// that asks whether a block exists gets the wrong answer. library.js's
// own algorithm does check, and it is copied EXACTLY here -- a
// simplified version is worse than none: an approximation that drops
// the `v.data` guard answers true for objects whose isNull() means
// something else, and the GENERATED api wrappers use isNull for
// overload dispatch, so queryAllEntities(false, true) quietly returned
// 0 entities instead of 3 (measured 2026-09-12, and it cost an hour).
isNull = function(v) {
    if (v === undefined || v === null) { return true; }
    try {
        if (RSettings.getQtVersion() >= 0x060000 &&
                v.hasOwnProperty("__PROXY__")) {
            return isNull(v.__PROXY__);
        }
    } catch (eProxy) {}
    try {
        if (typeof v.isNullWrapper === "function" &&
                v.isNullWrapper() === true) { return true; }
    } catch (eWrap) {}
    try {
        if (typeof v.data === "function" && typeof v.isNull === "function" &&
                v.isNull() === true) { return true; }
    } catch (eData) {}
    return false;
};

var failures = [];
function ok(c, w) { if (!c) { failures.push(w); } }
function eqs(a, b, w) {
    ok(a === b, w + " (expected " + JSON.stringify(b) + ", got " +
        JSON.stringify(a) + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);
// ensureSurveyLayers does not make these in a bare document -- ask for
// them by name, or everything lands on layer -1 and the adds vanish.
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.WALLS_INFERRED);
CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SHAPE_SPINE);
CsLayers.ensure(doc, di, CsLayers.WALL_GLYPHS);

// the glyph block must exist for decoration to place anything
var tmplPath = CsSymbolStore.templatePath();
ok(!isNull(tmplPath), "the template is findable");
if (!isNull(tmplPath)) {
    CsSymbolStore.ensureBlock(doc, di, "SYM_BREAKDOWN", tmplPath);
}
ok(!isNull(doc.queryBlock("SYM_BREAKDOWN")),
    "the stone glyph block is in the drawing");

function addStation(x, y, name) {
    // THROUGH withLayerOn: CTRL-STATIONS ships hidden, and this build
    // refuses an add to a hidden layer without saying so -- the fixture
    // looked fine and had no survey in it at all, which made every wall
    // fall back to its default side and hid the fin test entirely.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_STATIONS, function() {
        var op = new RAddObjectsOperation();
        var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
        p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
        CsTags.set(p, "Station", name);
        op.addObject(p, false);
        di.applyOperation(op);
    });
}

function addWall(pts, layerName) {
    var made = null;
    CsLayers.withLayerOn(doc, di, layerName, function() {
    var op = new RAddObjectsOperation();
    var pl = new RPolyline();
    for (var i = 0; i < pts.length; i++) {
        pl.appendVertex(new RVector(pts[i].x, pts[i].y));
    }
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(layerName));
    op.addObject(e, false);
    di.applyOperation(op);
    made = e.getId();
    });
    return made;
}

// A passage running east, stations down its middle; walls north and
// south of it. Plus a fin: a second passage just north of the north
// wall, so that wall has cave on both faces.
var s;
for (s = 0; s <= 80; s += 10) { addStation(s, 0, "A" + s); }
for (s = 0; s <= 40; s += 10) { addStation(s, 24, "B" + s); }

var southId = addWall([{x:0,y:-10},{x:20,y:-10},{x:40,y:-10},
                       {x:60,y:-10},{x:80,y:-10}], CsLayers.WALLS_SURVEYED);
var northId = addWall([{x:0,y:12},{x:20,y:12},{x:40,y:12},
                       {x:60,y:12},{x:80,y:12}], CsLayers.WALLS_SURVEYED);
var inferredId = addWall([{x:0,y:-14},{x:40,y:-14},{x:80,y:-14}],
    CsLayers.WALLS_INFERRED);

// ---- ON ---------------------------------------------------------------

eqs(WallEdging.isOn(doc), false, "the switch starts off");
var r1 = WallEdging.applySwitch(doc, di, true, doc.getTransactionGroup() + 1);
eqs(WallEdging.isOn(doc), true, "and the switch reads on afterwards");
ok(r1.dressed >= 2, "both surveyed walls were dressed (got " +
    r1.dressed + ")");

var inferred = doc.queryEntity(inferredId);
eqs(CsTags.get(inferred, CsShapeLine.KEY.STYLE), "",
    "WALLS-INFERRED is never edged -- it is the unmeasured stretch");

function glyphsOf(id) {
    var sp = doc.queryEntity(id);
    var sid = CsTags.get(sp, CsShapeLine.KEY.ID);
    if (sid === "") { return []; }
    var out = [];
    // decorOf hands back ENTITIES, not ids -- re-querying them as ids
    // returns nothing and reports a bare wall while its glyphs sit in
    // the drawing.
    var found = CsShapeLine.decorOf(doc, sid);
    for (var i = 0; i < found.length; i++) {
        var e = found[i];
        if (isNull(e)) {
            continue;
        }
        // BOUNDING BOX CENTRE, not getPosition: a block reference in
        // this build does not answer getPosition through the wrapper,
        // and a helper that skips what it cannot read reported an
        // empty wall while ten glyphs sat in the drawing.
        try {
            var c = e.getBoundingBox().getCenter();
            out.push({ x: c.x, y: c.y });
        } catch (eBox) {
        }
    }
    out.sort(function(A, B) { return A.x - B.x || A.y - B.y; });
    return out;
}

var southGlyphs = glyphsOf(southId);
var northGlyphs = glyphsOf(northId);
ok(southGlyphs.length > 0, "the south wall got glyphs (" +
    southGlyphs.length + ")");

// OUTSIDE: the passage is at y=0 and the south wall at y=-10, so its
// glyphs must sit BELOW it, further from the survey, not above.
var wrongSide = 0;
for (var g = 0; g < southGlyphs.length; g++) {
    if (southGlyphs[g].y > -10) { wrongSide++; }
}
eqs(wrongSide, 0, "every south-wall glyph sits on the far side from the " +
    "survey -- outside the cave, not in it");

// THE FIN: the north wall has passage at y=0 and y=24, so much of it
// has no outside and must be left barer than the open south wall.
ok(northGlyphs.length < southGlyphs.length,
    "the wall with passage on both faces gets fewer glyphs than the " +
    "open one (north " + northGlyphs.length + " vs south " +
    southGlyphs.length + ")");

// ---- OFF --------------------------------------------------------------

var southBefore = doc.queryEntity(southId).getBoundingBox();
var r2 = WallEdging.applySwitch(doc, di, false, doc.getTransactionGroup() + 1);
eqs(WallEdging.isOn(doc), false, "the switch reads off again");
ok(r2.removed >= 2, "both walls were cleared (got " + r2.removed + ")");
eqs(glyphsOf(southId).length, 0, "and the glyphs are gone");

var southAfter = doc.queryEntity(southId).getBoundingBox();
ok(Math.abs(southBefore.getWidth() - southAfter.getWidth()) < 1e-9 &&
   Math.abs(southBefore.getHeight() - southAfter.getHeight()) < 1e-9,
    "the wall itself is untouched -- edging adds and removes ornament, " +
    "never geometry");

var seedKept = CsTags.get(doc.queryEntity(southId), CsShapeLine.KEY.SEED);
ok(seedKept !== "", "the SEED survives being switched off -- that is " +
    "what makes on/off/on reproduce the same wall");

// ---- ON AGAIN, and it must look the same ------------------------------

WallEdging.applySwitch(doc, di, true, doc.getTransactionGroup() + 1);
var southAgain = glyphsOf(southId);
eqs(southAgain.length, southGlyphs.length,
    "switching back on puts the same NUMBER of glyphs back");
var drift = 0;
for (var q = 0; q < Math.min(southAgain.length, southGlyphs.length); q++) {
    drift += Math.abs(southAgain[q].x - southGlyphs[q].x) +
        Math.abs(southAgain[q].y - southGlyphs[q].y);
}
ok(drift < 1e-6, "and in the SAME PLACES -- a toggle must not reshuffle " +
    "a wall the caver has been looking at (drift " + drift + ")");

// ---- THE ELEVATION GETS ROCK TOO -------------------------------------
//
// It was plan only, on the grounds that a profile band held no station
// geometry to reason against. It holds ProfileStation points and has
// for as long as the elevation has been a region of the plan drawing,
// and on a pit map the elevation is the PRIMARY view -- so plan-only
// meant the main drawing of a vertical cave had no rock outside its
// walls at all.
(function() {
    var pdoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var pdi = new RDocumentInterface(pdoc);
    CsLayers.ensure(pdoc, pdi, CsLayers.PROFILE_WALLS_SURVEYED);
    CsLayers.ensure(pdoc, pdi, CsLayers.CTRL_PROFILE_STATIONS);

    // An elevation wall, with the elevation's own stations BELOW it,
    // and a decoy cloud far away on the plan's side of the drawing.
    // If the frame is read wrong, the decoy wins and every glyph goes
    // the other way.
    var op = new RAddObjectsOperation();
    var wall = new RPolylineEntity(pdoc, new RPolylineData());
    wall.appendVertex(new RVector(0, 0));
    wall.appendVertex(new RVector(40, 0));
    wall.appendVertex(new RVector(80, 0));
    wall.setLayerId(pdoc.getLayerId(CsLayers.PROFILE_WALLS_SURVEYED));
    op.addObject(wall, false);
    var sx;
    for (sx = 10; sx <= 70; sx += 20) {
        var st = new RPointEntity(pdoc,
            new RPointData(new RVector(sx, -9)));
        st.setLayerId(pdoc.getLayerId(CsLayers.CTRL_PROFILE_STATIONS));
        CsTags.set(st, "ProfileStation", "P" + sx);
        op.addObject(st, false);
    }
    // the decoy: plan stations ABOVE the same wall, a long way off in
    // the drawing but reachable by a nearest-station search that is
    // looking at the wrong cloud
    CsLayers.ensure(pdoc, pdi, CsLayers.CTRL_STATIONS);
    for (sx = 10; sx <= 70; sx += 20) {
        var ps = new RPointEntity(pdoc,
            new RPointData(new RVector(sx, 9)));
        ps.setLayerId(pdoc.getLayerId(CsLayers.CTRL_STATIONS));
        CsTags.set(ps, "Station", "A" + sx);
        op.addObject(ps, false);
    }
    pdi.applyOperation(op);

    var elig = WallEdging.eligibleWalls(pdoc);
    eqs(elig.length, 1,
        "an elevation wall is eligible for edging (" + elig.length + ")");

    var res = WallEdging.applySwitch(pdoc, pdi, true, -1);
    eqs(res.dressed, 1, "and the switch dresses it");

    var again = pdoc.queryEntity(elig[0].getId());
    eqs(String(CsTags.get(again, CsShapeLine.KEY.FRAME)), "profile",
        "the wall is tagged as being in the PROFILE frame, taken from " +
        "the layer it sits on -- a traced wall carries no ShapeFrame " +
        "of its own");

    // The glyphs must be ABOVE the wall: the elevation's cave is below
    // it. The plan decoy is above, so reading the wrong cloud puts
    // them below and this catches it.
    var aboveCount = 0, belowCount = 0;
    var ids = pdoc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = pdoc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, CsShapeLine.KEY.DECOR) === "") { continue; }
        var bb = e.getBoundingBox();
        if (isNull(bb)) { continue; }
        if (bb.getCenter().y > 0) { aboveCount++; } else { belowCount++; }
    }
    ok(aboveCount > 0,
        "the elevation's glyphs are drawn (" + aboveCount + " above, " +
        belowCount + " below)");
    eqs(belowCount, 0,
        "and ALL of them are on the side away from the elevation's own " +
        "stations -- not the plan's, which sit on the other side for " +
        "exactly this check");
})();

// ---- the switch survives a save and reopen ---------------------------

var tmp = repoRoot + "/tests/.wall_edging.dxf";
var saved = false;
try { saved = di.exportFile(tmp, "DXF 2013"); } catch (eE) { saved = false; }
ok(saved === true, "the drawing exports");
if (saved) {
    var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var bdi = new RDocumentInterface(back);
    var read = false;
    try {
        read = (bdi.importFile(tmp, "") === RDocumentInterface.IoErrorNoError);
    } catch (eI) { read = false; }
    ok(read === true, "and reads back");
    if (read) {
        eqs(WallEdging.isOn(back), true,
            "the switch is still on after save and reopen -- it rides " +
            "the drawing, not a setting");
    }
    try { new QFile(tmp).remove(); } catch (eR) {}
}

if (failures.length > 0) {
    print("### WALL EDGING FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) { print("  FAIL: " + failures[f]); }
    QCoreApplication.exit(1);
} else {
    print("### WALL EDGING OK");
    QCoreApplication.exit(0);
}
