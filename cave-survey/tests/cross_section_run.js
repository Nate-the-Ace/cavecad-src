// cross_section_run.js -- the cross-section lifecycle against a REAL
// document: cut, place, regenerate, freeze, lose.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cross_section_run.js "$PWD"
//
// Prints "### CROSS SECTION OK" on success, "### CROSS SECTION FAIL"
// plus the failed assertions otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. Every bug this
// feature actually shipped was invisible to the pure tests and obvious
// the first time the code met an RDocument:
//   * every LRUD-only section captioned itself "re-entrant simplified",
//     because the sampled angles land exactly on a four-point diamond's
//     vertex angles and a ray through a vertex hits both segments;
//   * the caption inverted its own scale, reading 1:0.3 for a section
//     drawn four times survey size;
//   * sections drew on their side, because theta is measured from world
//     up and the block mapped it to +X.
// None of those are logic errors the unit suite could see. What it
// takes is placing a real block and reading it back.
//
// THE CLAIM THAT MATTERS MOST is the last one below: a redefine must
// change the DEFINITION and never the REFERENCE. That is what lets a
// section follow the survey while staying exactly where the caver put
// it, and it is the whole reason a section is a block at all.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var source = String(stream.readAll());
    file.close();
    // Dependencies are loaded explicitly below; QCAD's own include()
    // would look in the installed script folders, not this checkout.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    // Indirect eval, so definitions land in the GLOBAL scope.
    (0, eval)(source);
}

var CORE = ["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsFrontier",
    "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud", "CsSectionCut",
    "CsTags", "CsStore", "CsLayers", "CsCallout", "CsSectionDraw"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[ci] + ".js");
}
loadRepoScript("scripts/CaveSurvey/Callout/CalloutWrite.js");

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    }
}

function checkClose(name, actual, expected, tol) {
    checks++;
    if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-9 : tol))) {
        failures.push(name + " -- expected " + expected + ", got " + actual);
    }
}

function lrudShot(from, to, d, az, l, r, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = 0;
    s.left = l; s.right = r; s.up = u; s.down = dn;
    return s;
}

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);

var sv = CsModel.newSurvey();
sv.shots.push(lrudShot("A1", "A2", 10, 0, 10, 10, 10, 10));
sv.shots.push(lrudShot("A2", "A3", 10, 0, 10, 10, 10, 10));
var res = CsNetwork.resolve(sv, {});

// ---- cut and place ---------------------------------------------------
var cut = CsSectionCut.cut(sv, res, "A2", "A3", 0.5, {});
check("a mid-leg cut is not refused", cut.refused === undefined);
check("a plain LRUD passage is not re-entrant", cut.reentrant === false);

var id = CalloutWrite.createSection(doc, di, {
    cut: cut, from: "A2", to: "A3", t: 0.5,
    position: { x: 200, y: 200 }, tips: [{ x: 0, y: 15 }], scale: 4
});
check("createSection returns an id", id !== null && id !== undefined);

var m = CalloutWrite.members(doc, id);
check("the section's content is a BLOCK, not text",
    m.block !== null && m.text === null);
check("and it has a leader", m.leaders.length === 1);
check("the block is this section's own definition",
    doc.getBlockId(CsSectionDraw.blockName(id)) ===
        m.block.getData().getReferencedBlockId());

// The leader runs from the PICKED POINT to the section's own outline,
// not to a bounding box: it must start at the tip and end on the
// linework, short of the centroid.
var lead = m.leaders[0].getData();
var v0 = lead.getVertexAt(0);
var v1 = lead.getVertexAt(1);
checkClose("the leader starts at the picked point (x)", v0.x, 0);
checkClose("the leader starts at the picked point (y)", v0.y, 15);
check("the leader ends short of the section's centre",
    Math.sqrt((v1.x - 200) * (v1.x - 200) +
              (v1.y - 200) * (v1.y - 200)) > 1);
check("and it ends INSIDE the section's own extent",
    Math.abs(v1.x - 200) <= 40.001 && Math.abs(v1.y - 200) <= 40.001);

var placedAt = m.block.getData().getPosition();
checkClose("the reference sits where it was placed (x)", placedAt.x, 200);
checkClose("the reference sits where it was placed (y)", placedAt.y, 200);

// No evidence rays: the block holds the outline, the centre cross and
// the caption, and nothing else.
var blockEnts = doc.queryBlockEntities(
    doc.getBlockId(CsSectionDraw.blockName(id)));
check("the block holds only outline, centre cross and caption",
    blockEnts.length === 4);
var rays = 0;
for (var bi = 0; bi < blockEnts.length; bi++) {
    var be = doc.queryEntity(blockEnts[bi]);
    if (!isNull(be) &&
            doc.getLayerName(be.getLayerId()) === CsLayers.CTRL_SECTION_SPLAYS) {
        rays++;
    }
}
check("no ray is drawn on the splay layer", rays === 0);

m.block.update();
var boxBefore = m.block.getBoundingBox();
var widthBefore = boxBefore.getMaximum().x - boxBefore.getMinimum().x;

// ---- the survey changes, and the section follows ---------------------
sv.shots[1].right = 30;                 // A3's right wall opens out
var res2 = CsNetwork.resolve(sv, {});
var report = CalloutWrite.refreshSections(doc, di, sv, res2);
check("the refresh re-derived one section", report.updated === 1);
check("nothing was lost", report.lost === 0);
check("nothing was refused", report.refused === 0);

var m2 = CalloutWrite.members(doc, id);
m2.block.update();
var boxAfter = m2.block.getBoundingBox();
var widthAfter = boxAfter.getMaximum().x - boxAfter.getMinimum().x;
check("the DEFINITION followed the survey -- the section got wider",
    widthAfter > widthBefore + 1);

// THE CLAIM THIS WHOLE FEATURE RESTS ON.
var stillAt = m2.block.getData().getPosition();
checkClose("and the REFERENCE did not move (x)", stillAt.x, 200);
checkClose("and the REFERENCE did not move (y)", stillAt.y, 200);

// The leader was RE-AIMED at the new outline, not left on the old edge.
var m2lead = m2.leaders[0].getData();
var w0 = m2lead.getVertexAt(0);
checkClose("the re-aimed leader still starts at the picked point", w0.x, 0);

// ---- frozen sections are left alone, and counted ---------------------
CsTags.set(m2.block, CsCallout.KEY.SECTION_FROZEN, "1");
var fop = new RModifyObjectsOperation();
fop.addObject(m2.block, false);
di.applyOperation(fop);

var frozenReport = CalloutWrite.refreshSections(doc, di, sv, res2);
check("a frozen section is not re-derived", frozenReport.updated === 0);
check("a frozen section is COUNTED, not silently skipped",
    frozenReport.frozen === 1);

var m3 = CalloutWrite.members(doc, id);
CsTags.remove(m3.block, CsCallout.KEY.SECTION_FROZEN);
var uop = new RModifyObjectsOperation();
uop.addObject(m3.block, false);
di.applyOperation(uop);

// ---- a section whose leg is gone -------------------------------------
var shrunk = CsModel.newSurvey();
shrunk.shots.push(lrudShot("A1", "A2", 10, 0, 10, 10, 10, 10));
var res3 = CsNetwork.resolve(shrunk, {});
var lostReport = CalloutWrite.refreshSections(doc, di, shrunk, res3);
check("a section whose leg is gone is not re-derived",
    lostReport.updated === 0);
check("it is counted lost", lostReport.lost === 1);
var m4 = CalloutWrite.members(doc, id);
check("and it is LEFT IN THE DRAWING, never deleted", m4.block !== null);

// ---- the counts are stable across repeated passes --------------------
// A second refresh must report the same thing: a lost section that
// quietly became "updated" on the next pass would mean the refresh was
// re-deriving from something other than the survey it was given.
var again = CalloutWrite.refreshSections(doc, di, shrunk, res3);
check("a second pass reports the same loss", again.lost === 1);
check("and still re-derives nothing", again.updated === 0);

// ---- a SKETCHED section is never regenerated -------------------------
// The gate that makes hand tracing possible at all. A computed section
// re-derives from the survey; a traced one has no survey to re-derive
// from and must be left exactly alone -- but COUNTED, because a stale
// section on a plotted map is the failure this refresh exists to
// prevent.
var sketchId = CsCallout.newId();
var sketchName = CsSectionDraw.blockName(sketchId);
var sketchBlock = new RBlock(doc, sketchName, new RVector(0, 0));
di.applyOperation(new RAddObjectOperation(sketchBlock, false));
var sketchBlockId = doc.getBlockId(sketchName);

var traced = new RLineEntity(doc,
    new RLineData(new RVector(-3, -3), new RVector(3, 3)));
traced.setBlockId(sketchBlockId);
var sop = new RAddObjectsOperation();
sop.addObject(traced, false);

var sketchRef = new RBlockReferenceEntity(doc,
    new RBlockReferenceData(sketchBlockId, new RVector(200, 200),
        new RVector(1, 1), 0.0));
CsTags.set(sketchRef, CsCallout.KEY.ID, sketchId);
CsTags.set(sketchRef, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
CsTags.set(sketchRef, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
CsTags.set(sketchRef, CsCallout.KEY.SECTION_SOURCE,
    CsCallout.SOURCE_SKETCH);
CsTags.set(sketchRef, CsCallout.KEY.SECTION_STATION, "A1");
sop.addObject(sketchRef, false);
di.applyOperation(sop);

// THE TRAP: CsTags.set returns early on an empty/null value and cannot
// clear a tag. If the tag above did not actually take, the gate below
// would pass for the wrong reason (falling through as a bare block with
// no KIND, never reaching the sketch check at all). Read it back before
// trusting the fixture.
check("fixture setup: the sketch tag actually took",
    CsTags.get(sketchRef, CsCallout.KEY.SECTION_SOURCE) ===
        CsCallout.SOURCE_SKETCH);

var tracedId = traced.getId();
var beforeCount = doc.queryBlockEntities(sketchBlockId).length;

var sketchReport = CalloutWrite.refreshSections(doc, di, sv, res2);
check("a sketched section is counted, not skipped in silence",
    sketchReport !== null && sketchReport.sketched === 1);
check("a computed section beside it still regenerates in the same pass",
    sketchReport.updated === 1);
check("a sketched section is never re-derived",
    doc.queryBlockEntities(sketchBlockId).length === beforeCount);

var stillTraced = doc.queryEntity(tracedId);
check("the traced line itself is still there, same entity",
    !isNull(stillTraced));
if (!isNull(stillTraced)) {
    var tp0 = stillTraced.getData().getStartPoint();
    checkClose("and its geometry is untouched (x)", tp0.x, -3);
}

var stillThere = doc.queryEntity(sketchRef.getId());
check("and its reference is left exactly where it was",
    !isNull(stillThere) &&
    stillThere.getData().getPosition().x === 200);

// A second pass must report the same thing: a sketch that quietly
// stopped being counted on the next pass would mean the gate was
// keyed off something other than the tag itself.
var sketchAgain = CalloutWrite.refreshSections(doc, di, sv, res2);
check("a second pass counts the sketch the same way",
    sketchAgain.sketched === 1);
check("and still regenerates the computed section beside it",
    sketchAgain.updated === 1);

// ---- a sketch's LEADER follows the survey even though its BLOCK does
// not -------------------------------------------------------------------
// The block has no basis to re-derive from (that is the gate above),
// but the leader points at a STATION, and loop closure moves stations
// by real distances. A leader left where the station used to be is
// wrong on a plotted map, silently -- so it must follow, straight,
// same as SectionCapture drew it the first time.
//
// A small fixture builder, since three scenarios below each need their
// own block + reference, none of which share the survey used higher up
// in this file.
function buildSketchFixture(calloutId, station, refPos) {
    var name = CsSectionDraw.blockName(calloutId);
    var block = new RBlock(doc, name, new RVector(0, 0));
    di.applyOperation(new RAddObjectOperation(block, false));
    var blockId = doc.getBlockId(name);

    var content = new RLineEntity(doc,
        new RLineData(new RVector(-2, -2), new RVector(2, 2)));
    content.setBlockId(blockId);
    var bop = new RAddObjectsOperation();
    bop.addObject(content, false);

    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, new RVector(refPos.x, refPos.y),
            new RVector(1, 1), 0.0));
    CsTags.set(ref, CsCallout.KEY.ID, calloutId);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.SECTION_SOURCE, CsCallout.SOURCE_SKETCH);
    CsTags.set(ref, CsCallout.KEY.SECTION_STATION, station);
    bop.addObject(ref, false);
    di.applyOperation(bop);

    return { blockId: blockId, ref: ref, contentId: content.getId() };
}

// ---- scenario 1: the station MOVES, the leader follows ---------------
var moveId = CsCallout.newId();
var moveSurvey = CsModel.newSurvey();
moveSurvey.shots.push(lrudShot("M1", "M2", 10, 0, 5, 5, 5, 5));
var moveRes1 = CsNetwork.resolve(moveSurvey, {});
var moveFix = buildSketchFixture(moveId, "M2", { x: 500, y: 500 });

CalloutWrite.refreshSections(doc, di, moveSurvey, moveRes1);   // settle
var mv1 = CalloutWrite.members(doc, moveId);
check("move fixture settled with exactly one leader",
    mv1.leaders.length === 1);
var mvTip1 = mv1.leaders[0].getData().getVertexAt(0);
checkClose("and it starts at the station's first position (x)",
    mvTip1.x, moveRes1.stations.M2.x);

// the survey changes -- M2 slides to a new position
moveSurvey.shots[0].azimuth = 90;
var moveRes2 = CsNetwork.resolve(moveSurvey, {});
check("fixture sanity: the station actually moved",
    Math.abs(moveRes2.stations.M2.x - moveRes1.stations.M2.x) > 1 ||
    Math.abs(moveRes2.stations.M2.y - moveRes1.stations.M2.y) > 1);

var moveBeforeCount = doc.queryBlockEntities(moveFix.blockId).length;
CalloutWrite.refreshSections(doc, di, moveSurvey, moveRes2);
check("the block is still untouched after the station moves",
    doc.queryBlockEntities(moveFix.blockId).length === moveBeforeCount);
var stillMoveRef = doc.queryEntity(moveFix.ref.getId());
check("and the reference position is still untouched",
    !isNull(stillMoveRef) &&
    stillMoveRef.getData().getPosition().x === 500);

var mv2 = CalloutWrite.members(doc, moveId);
check("the leader was rebuilt (still exactly one)",
    mv2.leaders.length === 1);
var mvTip2 = mv2.leaders[0].getData().getVertexAt(0);
checkClose("and it now starts at the station's NEW position (x)",
    mvTip2.x, moveRes2.stations.M2.x);
checkClose("and it now starts at the station's NEW position (y)",
    mvTip2.y, moveRes2.stations.M2.y);

// ---- scenario 2: the station does NOT move -- no transaction at all --
// This is the assertion that protects against the freeze. writeLeaders
// stopped an identical bug the same way: reusing signatureOfLeaders /
// geometrySignature rather than a fresh epsilon check is what makes
// this guard the SAME proven code path, not a new one to get wrong.
var stableId = CsCallout.newId();
var stableSurvey = CsModel.newSurvey();
stableSurvey.shots.push(lrudShot("N1", "N2", 8, 0, 4, 4, 4, 4));
var stableRes = CsNetwork.resolve(stableSurvey, {});
var stableFix = buildSketchFixture(stableId, "N2", { x: 700, y: 700 });

CalloutWrite.refreshSections(doc, di, stableSurvey, stableRes);  // settle
var st1 = CalloutWrite.members(doc, stableId);
check("stable fixture settled with exactly one leader",
    st1.leaders.length === 1);
var stableLeaderId = st1.leaders[0].getId();
var stableTip1 = st1.leaders[0].getData().getVertexAt(0);

// DEVIATION FROM THE ORIGINAL ASK: doc.getLastTransactionId() does not
// exist on this build's RDocument (probed live -- TypeError, not just
// undefined), and doc.getTransactionStack() is present but unusable
// from script ("Class RTransactionStack is undefined" at the JS
// bridge). Probed further: doc.queryEntity() on a genuinely deleted id
// does NOT return null or undefined here -- it returns the entity
// object with isUndone()===true, and THIS FILE'S OWN isNull() shim
// (line ~29) cannot see that: it only checks undefined/null and a
// v.isNull() method that does not exist on an entity in this build, so
// it silently reports a deleted entity as "not null". Caught by this
// very mutation test: an isNull()-based check here stayed green even
// with the guard disabled.
//
// The reliable signal is CalloutWrite.members() itself: it walks
// doc.queryAllEntities(false, true), which -- probed -- EXCLUDES
// undone entities. So "the id members() reports is still the one
// captured before" is a direct, correct stand-in for "no transaction
// was produced": a rewrite deletes the old leader (member() stops
// seeing it) and adds a new one (a different id).
CalloutWrite.refreshSections(doc, di, stableSurvey, stableRes);
var st2 = CalloutWrite.members(doc, stableId);
check("a sketch whose station has not moved writes NO transaction " +
    "for its leader -- the SAME entity, never replaced",
    st2.leaders.length === 1 && st2.leaders[0].getId() === stableLeaderId);
check("and there is still exactly one leader, not a duplicate",
    st2.leaders.length === 1);
var stableTip2 = st1.leaders[0].getData().getVertexAt(0);
checkClose("and its tip did not move (x)", stableTip2.x, stableTip1.x);

// ---- scenario 3: the station VANISHES -- lost, leader left in place --
var lostId = CsCallout.newId();
var lostSurvey = CsModel.newSurvey();
lostSurvey.shots.push(lrudShot("P0", "P1", 5, 0, 3, 3, 3, 3));
lostSurvey.shots.push(lrudShot("P1", "P2", 6, 0, 3, 3, 3, 3));
var lostRes = CsNetwork.resolve(lostSurvey, {});
var lostFix = buildSketchFixture(lostId, "P2", { x: 900, y: 900 });

CalloutWrite.refreshSections(doc, di, lostSurvey, lostRes);   // settle
var lo1 = CalloutWrite.members(doc, lostId);
check("vanished-station fixture settled with exactly one leader",
    lo1.leaders.length === 1);
var lostLeaderId = lo1.leaders[0].getId();
var lostTip1 = lo1.leaders[0].getData().getVertexAt(0);

// the leg the station sat on is gone -- same shape as the "shrunk"
// survey higher up in this file, one kind over
var lostShrunk = CsModel.newSurvey();
lostShrunk.shots.push(lrudShot("P0", "P1", 5, 0, 3, 3, 3, 3));
var lostShrunkRes = CsNetwork.resolve(lostShrunk, {});
check("fixture sanity: the station is really gone",
    lostShrunkRes.stations.P2 === undefined);

var lostReport2 = CalloutWrite.refreshSections(doc, di, lostShrunk,
    lostShrunkRes);
check("a sketch whose station vanished is counted lost",
    lostReport2.lost >= 1);

var lo2 = CalloutWrite.members(doc, lostId);
check("its leader is left in place, not deleted",
    lo2.leaders.length === 1 && lo2.leaders[0].getId() === lostLeaderId);
var lostTip2 = lo2.leaders[0].getData().getVertexAt(0);
checkClose("and it did not move (x)", lostTip2.x, lostTip1.x);
checkClose("and it did not move (y)", lostTip2.y, lostTip1.y);

var lostBlockEnts = doc.queryBlockEntities(lostFix.blockId);
check("the block is untouched too", lostBlockEnts.length === 1);
var stillLostRef = doc.queryEntity(lostFix.ref.getId());
check("and the reference is untouched",
    !isNull(stillLostRef) &&
    stillLostRef.getData().getPosition().x === 900);

if (failures.length === 0) {
    print("### CROSS SECTION OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL: " + failures[f]);
    }
    print("### CROSS SECTION FAIL " + failures.length + " of " + checks);
}
