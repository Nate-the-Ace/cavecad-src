/** North arrows follow their viewport's rotation: the generated arrow and a placed symbol. */
if (typeof isNull === "undefined") {
    isNull = function(v) { if (v === undefined || v === null) { return true; } try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { } return false; };
}
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js"); include("scripts/simple.js"); include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### NORTH ARROW FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-6 : t); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
var w = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
w.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
di.applyOperation(new RAddObjectOperation(w, false));

var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
var res = CsLayoutGen.generate(doc, di, { caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 }, sheet: sheet, turned: false,
    scale: 20, perFoot: 1, wants: { border: true, bar: true, north: true, title: true }, titleValues: {}, reading: null, tiles: null, extra: {} });
var info = Layouts.get(doc, res.made[0]);
var vp = Layouts.viewports(doc, info)[0];
var arrows = CsNorth.arrows(doc, info.blockId);
check(arrows.length === 1 && arrows[0].block === true && !arrows[0].placed, "the generated arrow is ONE block reference, found by its link: " + arrows.length);

// The arrow's parts live in its block definition, in inches from the pivot (the insertion point).
function theRef() { return CsNorth.arrows(doc, info.blockId).filter(function(x) { return x.block === true; })[0].ref; }
function defEntities() {
    var ref = doc.queryEntity(theRef().getId()), ids = doc.queryBlockEntities(ref.getReferencedBlockId()), out = [];
    for (var i = 0; i < ids.length; i++) { var e = doc.queryEntity(ids[i]); if (!isNull(e) && !e.isUndone()) { out.push(e); } }
    return out;
}
function shaft() {
    // the shaft is the longest line of the arrow
    var best = null, bestLen = -1, es = defEntities();
    for (var i = 0; i < es.length; i++) {
        if (es[i].getType() === RS.EntityLine) {
            var len = es[i].getStartPoint().getDistanceTo(es[i].getEndPoint());
            if (len > bestLen) { bestLen = len; best = es[i]; }
        }
    }
    return best;
}
function shapeAngle() { var s = shaft(), a = s.getStartPoint(), t = s.getEndPoint(); return Math.atan2(t.y - a.y, t.x - a.x); }
var before = shapeAngle();
check(near(before, Math.PI / 2, 1e-9), "the arrow points up the page to begin with");
check(near(shaft().getStartPoint().x, 0, 1e-9) && near(shaft().getStartPoint().y, 0, 1e-9), "its pivot is the block's insertion point");

// unlock and turn the viewport 30 degrees; the arrow follows
Layouts.setLocked(di, vp, false);
vp = Layouts.viewports(doc, info)[0];
vp.setRotation(30 * Math.PI / 180);
di.applyOperation(new RModifyObjectOperation(vp));
var refPos0 = doc.queryEntity(theRef().getId()).getPosition();
check(CsNorth.syncAll(doc, di, -1, false) === 1, "sync turned the arrow");
check(near(shapeAngle(), Math.PI / 2 + 30 * Math.PI / 180, 1e-9), "its shaft turned by the viewport's 30 degrees");
var refPos1 = doc.queryEntity(theRef().getId()).getPosition();
check(near(refPos1.x, refPos0.x, 1e-9) && near(refPos1.y, refPos0.y, 1e-9), "turning redraws the block; the reference stays where it was put");
check(CsNorth.syncAll(doc, di, -1, false) === 0, "a second sync writes nothing");
// label keeps upright but moved with it; caption untouched
var lab = null, cap = null, es1 = defEntities();
for (var k = 0; k < es1.length; k++) {
    if (typeof es1[k].getPlainText === "function") {
        if (String(es1[k].getPlainText()) === "N") lab = es1[k]; else if (cap === null) cap = es1[k];
    }
}
check(!isNull(lab) && near(lab.getAngle(), 0, 1e-9), "the letter N stays upright");
check(!isNull(cap) && near(cap.getAngle(), 0, 1e-9), "the caption stays upright");
// back to zero
vp = Layouts.viewports(doc, info)[0]; vp.setRotation(0); di.applyOperation(new RModifyObjectOperation(vp));
CsNorth.syncAll(doc, di, -1, false);
check(near(shapeAngle(), Math.PI / 2, 1e-9), "turning the viewport back turns the arrow back");

// MOVED arrow: the pivot is the insertion point, so a move can never displace the turn
var mref = doc.queryEntity(theRef().getId());
var movedFrom = mref.getPosition();
mref.move(new RVector(1.5, 0.75));
di.applyOperation(new RModifyObjectOperation(mref));
vp = Layouts.viewports(doc, info)[0]; vp.setRotation(40 * Math.PI / 180); di.applyOperation(new RModifyObjectOperation(vp));
CsNorth.syncAll(doc, di, -1, false);
var movedTo = doc.queryEntity(theRef().getId()).getPosition();
check(near(movedTo.x, movedFrom.x + 1.5, 1e-9) && near(movedTo.y, movedFrom.y + 0.75, 1e-9), "the moved arrow stayed where it was moved to");
check(near(shaft().getStartPoint().x, 0, 1e-9) && near(shaft().getStartPoint().y, 0, 1e-9), "and it turns about its own base, not the place it was drawn");
check(near(shapeAngle(), Math.PI / 2 + 40 * Math.PI / 180, 1e-9), "and still takes the viewport's angle");
vp = Layouts.viewports(doc, info)[0]; vp.setRotation(0); di.applyOperation(new RModifyObjectOperation(vp));
CsNorth.syncAll(doc, di, -1, false);

// a PLACED arrow (a block reference on the layer) reads the viewport under it
var blk = new RBlock(doc, "NA", new RVector(0, 0));
di.applyOperation(new RAddObjectOperation(blk, false));
var bid = doc.getBlockId("NA");
var seg = new RLineEntity(doc, new RLineData(new RVector(0, 0), new RVector(0, 0.1)));
seg.setBlockId(bid);
di.applyOperation(new RAddObjectOperation(seg, false));
CsLayers.ensure(doc, di, CsLayers.NORTH_ARROW);
vp = Layouts.viewports(doc, info)[0]; vp.setRotation(-20 * Math.PI / 180); di.applyOperation(new RModifyObjectOperation(vp));
var pc = vp.getCenter();
var ref = new RBlockReferenceEntity(doc, new RBlockReferenceData(bid, new RVector(pc.x, pc.y), new RVector(1, 1), 0.0));
ref.setBlockId(info.blockId); ref.setLayerId(doc.getLayerId(CsLayers.NORTH_ARROW));
di.applyOperation(new RAddObjectOperation(ref, false));
var placed = CsNorth.arrows(doc, info.blockId).filter(function(a) { return a.placed; });
check(placed.length === 1, "a placed symbol on the layer is an arrow too");
CsNorth.syncAll(doc, di, -1, false);
var pr = doc.queryEntity(placed[0].pieces[0].getId());
check(near(pr.getRotation(), -20 * Math.PI / 180, 1e-9), "and it takes the viewport's angle (" + (pr.getRotation() * 180 / Math.PI) + ")");
check(CsNorth.viewportFor(doc, info.blockId, pc.x, pc.y).getId() === vp.getId(), "it belongs to the viewport under it");
if (fails === 0) print("### NORTH ARROW OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
