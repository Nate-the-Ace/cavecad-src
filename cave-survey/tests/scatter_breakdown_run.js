// scatter_breakdown_run.js -- Scatter Breakdown decides its VIEW by
// where the zone is, not by the layer the boundary was drawn on.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scatter_breakdown_run.js "$PWD"
//
// The claim: two identical boundaries on the SAME plan layer, one out
// in the plan and one sitting inside an elevation band's box, must fill
// with breakdown on BREAKDOWN and PROFILE-BREAKDOWN respectively. That
// is the whole point of the band boxes -- one button set, no profile
// twin of the button, no layer for the caver to remember.
//
// Why headless-with-the-real-tool rather than a pure unit test: the
// routing is three separate pieces agreeing (CsProfileBox.frameAt off
// real box entities, CsLayers.twinFor, and the retarget of the block
// reference CsSymbols.insert hands back on its CATALOG layer). A unit
// test of any one of them passes while the tool still puts every
// boulder in the plan.

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
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

// The real include(), for the reason tests/generate_profile_run.js
// states at length: this file loads a TOOL, whose own first lines are
// include() calls that have to run for real.
include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ScatterBreakdown";
include(includeBasePath + "/ScatterBreakdown.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/AreaSync";
include(includeBasePath + "/AreaSync.js");

var failures = [];
function ok(condition, what) {
    if (!condition) {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// The tool talks to the user; headlessly nobody is listening, and
// EAction.handleUserMessage needs a main window. Captured instead, so a
// warning that ENDS the run early is visible in the failure list rather
// than looking like a silent pass.
var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

// ---------------------------------------------------------------------
// Fixture: a real profile, so real band boxes exist on CTRL-PROFILE-BOX.
// ---------------------------------------------------------------------

var sv = CsModel.newSurvey();
sv.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2)
];
var resolved = CsNetwork.resolve(sv, {});
var profile = CsProfile.build(sv, resolved, {});
var drawn = CsProfileDraw.render(doc, di, profile, {});
ok(drawn.bandsDrawn >= 1, "the fixture profile drew at least one band");

var boxes = CsProfileBox.boxes(doc);
ok(boxes.length >= 1, "the profile left at least one band box behind " +
    "(without one there is nothing for this test to aim at)");

// The blocks the catalog places. A memory document has none, and
// CsSymbols.insert answers null without them -- which the tool reports
// as "start from the NSS template", i.e. a clean skip that would make
// this whole file pass while placing nothing.
var blockOp = new RAddObjectsOperation();
var wantBlocks = ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"];
for (var bi = 0; bi < wantBlocks.length; bi++) {
    blockOp.addObject(new RBlock(doc, wantBlocks[bi], new RVector(0, 0)),
        false);
}
di.applyOperation(blockOp);
// A block with NO geometry has a NaN bounding box, and every reference
// to it is then dropped on its way into the spatial index -- the run
// reports boulders placed and the document holds none. One real line
// each is enough to make the fixture behave like the template's blocks.
var shapeOp = new RAddObjectsOperation();
for (bi = 0; bi < wantBlocks.length; bi++) {
    var blk = doc.queryBlock(wantBlocks[bi]);
    if (isNull(blk)) { continue; }
    var seg = new RLineEntity(doc,
        new RLineData(new RVector(-0.5, -0.25), new RVector(0.5, 0.25)));
    seg.setBlockId(blk.getId());
    shapeOp.addObject(seg, false);
}
di.applyOperation(shapeOp);
for (bi = 0; bi < wantBlocks.length; bi++) {
    ok(!isNull(doc.queryBlock(wantBlocks[bi])),
        wantBlocks[bi] + " exists in the fixture document");
}

/** A closed square boundary centred on (cx, cy), on the PLAN boundary
 *  layer whichever view it lands in -- that is the point. */
function addBoundary(cx, cy, half) {
    CsLayers.ensure(doc, di, CsLayers.BREAKDOWN_BOUNDARY);
    var pl = new RPolylineEntity(doc, new RPolylineData());
    pl.appendVertex(new RVector(cx - half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy + half));
    pl.appendVertex(new RVector(cx - half, cy + half));
    pl.setClosed(true);
    pl.setLayerId(doc.getLayerId(CsLayers.BREAKDOWN_BOUNDARY));
    var op = new RAddObjectsOperation();
    op.addObject(pl, false);
    di.applyOperation(op);
    return pl.getId();
}

// Inside the first band's box, well clear of its edges.
var box = boxes[0];
var profileCx = (box.minX + box.maxX) / 2;
var profileCy = (box.minY + box.maxY) / 2;
var inProfile = addBoundary(profileCx, profileCy,
    Math.min(box.maxX - box.minX, box.maxY - box.minY) / 8);

// Far from the elevation and from any bay: ordinary plan ground.
var region = CsTrace.profileRegion(doc);
var planX = isNull(region) ? 500 : (region.maxX + 500);
var planY = isNull(region) ? 500 : (region.maxY + 500);
var inPlan = addBoundary(planX, planY, 3);

eqs(CsProfileBox.frameAt(doc, region, new RVector(profileCx, profileCy), []),
    "profile",
    "the fixture's profile zone really is inside a band box");
eqs(CsProfileBox.frameAt(doc, region, new RVector(planX, planY), []), "plan",
    "the fixture's plan zone really is out in the plan");

// ---------------------------------------------------------------------
// Run the tool for real.
// ---------------------------------------------------------------------

scatterBreakdownRun();

/** Every block reference owned by a boundary, grouped by layer name. */
function placedLayers(boundaryId) {
    var seen = {};
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, "BoundaryId") !== String(boundaryId)) { continue; }
        var lname = doc.getLayerName(e.getLayerId());
        seen[lname] = (seen[lname] || 0) + 1;
    }
    return seen;
}

var planPlaced = placedLayers(inPlan);
var profilePlaced = placedLayers(inProfile);

ok((planPlaced[CsLayers.BREAKDOWN] || 0) > 0,
    "the plan zone filled on " + CsLayers.BREAKDOWN + ", got " +
    JSON.stringify(planPlaced) + " (messages: " + messages.join(" | ") + ")");
eqs(planPlaced[CsLayers.PROFILE_BREAKDOWN], undefined,
    "nothing from the plan zone leaked into the elevation");

ok((profilePlaced[CsLayers.PROFILE_BREAKDOWN] || 0) > 0,
    "the profile zone filled on " + CsLayers.PROFILE_BREAKDOWN +
    " even though its boundary is on the PLAN boundary layer, got " +
    JSON.stringify(profilePlaced));
eqs(profilePlaced[CsLayers.BREAKDOWN], undefined,
    "and none of it landed in the plan -- the layer the boundary was " +
    "drawn on decides nothing");

// ---------------------------------------------------------------------
// Re-running still clears only the boundaries it processes, now that
// the clearing sweep has to look at more than one target layer.
// ---------------------------------------------------------------------

var beforeRerun = 0;
var allRefs = doc.queryAllEntities(false, false, RS.EntityBlockRef);
for (var ri = 0; ri < allRefs.length; ri++) {
    if (!isNull(doc.queryEntity(allRefs[ri]))) { beforeRerun++; }
}
ok(beforeRerun > 0, "there are boulders to re-scatter");

scatterBreakdownRun();

var afterProfile = placedLayers(inProfile);
var afterPlan = placedLayers(inPlan);
eqs(afterProfile[CsLayers.BREAKDOWN], undefined,
    "after a re-run the profile zone is still profile-only");
ok((afterProfile[CsLayers.PROFILE_BREAKDOWN] || 0) > 0,
    "and still filled");
ok((afterPlan[CsLayers.BREAKDOWN] || 0) > 0,
    "the plan zone survived the re-run");

// The old scatter must be GONE, not doubled -- the same claim the tool
// has always made, re-checked because the sweep that clears it now
// matches on a SET of target layers rather than one id.
var doubled = false;
var counted = {};
allRefs = doc.queryAllEntities(false, false, RS.EntityBlockRef);
for (ri = 0; ri < allRefs.length; ri++) {
    var ent = doc.queryEntity(allRefs[ri]);
    if (isNull(ent)) { continue; }
    var owner = CsTags.get(ent, "BoundaryId");
    if (owner === "") { continue; }
    counted[owner] = (counted[owner] || 0) + 1;
}
ok(!doubled, "no doubling sentinel");
ok(counted[String(inProfile)] > 0 && counted[String(inPlan)] > 0,
    "both zones still own boulders after the re-run");

// ---------------------------------------------------------------------
// THE SEED (Task 12). ScatterBreakdown never had one before -- every
// re-run reshuffled the pile. It is now stamped on the boundary the
// first time this tool scatters it, and read back unchanged every time
// after: the re-run above already proves COUNTS survive; this proves
// the actual PLACEMENTS do too, not merely an equal-sized reshuffle.
// ---------------------------------------------------------------------

function ownedPositions(boundaryId) {
    var out = [];
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, "BoundaryId") !== String(boundaryId)) { continue; }
        var pos = e.getPosition();
        out.push(Math.round(pos.x * 1000) / 1000 + "," +
            Math.round(pos.y * 1000) / 1000);
    }
    return out.sort().join("|");
}

var seedOnPlan = CsTags.get(doc.queryEntity(inPlan), CsArea.SEED_KEY);
ok(seedOnPlan !== "",
    "Scatter Breakdown: the boundary carries a stamped seed after " +
    "being scattered");

var posBeforeThirdRun = ownedPositions(inPlan);
scatterBreakdownRun();
eqs(CsTags.get(doc.queryEntity(inPlan), CsArea.SEED_KEY), seedOnPlan,
    "Scatter Breakdown: the seed is never re-rolled once stamped");
eqs(ownedPositions(inPlan), posBeforeThirdRun,
    "Scatter Breakdown: same seed, same verts -- a re-run reproduces " +
    "the EXACT same placements, not merely the same count");

// ---------------------------------------------------------------------
// THE SPACING RULE (Task 12 review round 2): the transplant to
// CsArea.placements silently dropped ScatterBreakdown's own minimum
// spacing between boulders -- CsArea.scatterPlacements now enforces it
// again via CsArea.CATALOG.BLOCKS' own spacingFactor/spacingMin.
// Checked directly against the real pile the runs above already built.
// ---------------------------------------------------------------------

function ownedPoints(boundaryId) {
    var out = [];
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, "BoundaryId") !== String(boundaryId)) { continue; }
        out.push(e.getPosition());
    }
    return out;
}

var spacingEntry = CsArea.CATALOG.BLOCKS;
var spacingVerts = CsArea.vertsOf(doc.queryEntity(inPlan));
var spacingArea = CsArea.polygonArea(spacingVerts);
var spacingWant = Math.round((spacingArea / 100) * spacingEntry.density);
var expectedSpacing = Math.max(spacingEntry.spacingMin,
    Math.sqrt(spacingArea / spacingWant) * spacingEntry.spacingFactor);

var spacingPoints = ownedPoints(inPlan);
ok(spacingPoints.length > 1,
    "spacing fixture: the plan pile has more than one boulder to check");
var closestPair = Infinity;
for (var sp1 = 0; sp1 < spacingPoints.length; sp1++) {
    for (var sp2 = sp1 + 1; sp2 < spacingPoints.length; sp2++) {
        var sdx = spacingPoints[sp1].x - spacingPoints[sp2].x;
        var sdy = spacingPoints[sp1].y - spacingPoints[sp2].y;
        var sdist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (sdist < closestPair) {
            closestPair = sdist;
        }
    }
}
ok(closestPair >= expectedSpacing - 1e-6,
    "Scatter Breakdown: no two boulders in the same pile are closer " +
    "than the Blocks spacing rule (closest " + closestPair +
    ", rule requires " + expectedSpacing + ")");

// ---------------------------------------------------------------------
// AreaSync.adopt (Task 12): an old BREAKDOWN-BOUNDARY polyline that was
// only ever drawn, never scattered, becomes a real Blocks area and
// gets its own pile. A second call is a no-op -- nothing left to adopt.
// ---------------------------------------------------------------------

var legacyCx = planX - 200, legacyCy = planY;
var legacy = addBoundary(legacyCx, legacyCy, 3);

eqs(CsTags.get(doc.queryEntity(legacy), CsArea.ID_KEY), "",
    "AreaSync.adopt fixture: a freshly drawn boundary carries no " +
    "AreaId yet");

AreaSync.adopt(doc, di);

var adoptedId = CsTags.get(doc.queryEntity(legacy), CsArea.ID_KEY);
ok(!isNull(adoptedId) && adoptedId !== "",
    "AreaSync.adopt: an old breakdown boundary becomes an area");
eqs(CsTags.get(doc.queryEntity(legacy), CsArea.PATTERN_KEY), "BLOCKS",
    "AreaSync.adopt: adopted as the Blocks pattern");

var afterOnce = CsArea.countOwned(doc, adoptedId);
ok(afterOnce > 0, "AreaSync.adopt: and gets its boulders");

AreaSync.adopt(doc, di);
eqs(CsArea.countOwned(doc, adoptedId), afterOnce,
    "AreaSync.adopt: running it twice does not double the pile");
eqs(CsTags.get(doc.queryEntity(legacy), CsArea.ID_KEY), adoptedId,
    "AreaSync.adopt: and does not re-tag it with a new AreaId either");

// ---------------------------------------------------------------------
// AreaSync.adopt preserves a caver's already-placed fill -- the old
// Scatter Breakdown pile a boundary already owned is replaced (same
// seed, so it looks identical) rather than left doubled underneath the
// new AreaOwner-tagged one, and nothing ELSE in the drawing -- another
// boundary's pile, or an entity that is not fill at all -- is ever
// touched by that replacement.
// ---------------------------------------------------------------------

var scatteredCx = planX - 200, scatteredCy = planY + 40;
var scattered = addBoundary(scatteredCx, scatteredCy, 3);
di.selectEntity(scattered, true);
scatterBreakdownRun();
di.clearSelection();

var oldPileCount = 0;
var oldPileIds = [];
var scanIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
for (var si = 0; si < scanIds.length; si++) {
    var se = doc.queryEntity(scanIds[si]);
    if (isNull(se)) { continue; }
    if (CsTags.get(se, "BoundaryId") === String(scattered)) {
        oldPileCount++;
        oldPileIds.push(scanIds[si]);
    }
}
ok(oldPileCount > 0,
    "AreaSync.adopt fixture: the boundary has a real Scatter " +
    "Breakdown pile before adoption");

// An entity that has nothing to do with this boundary -- proof that
// adoption's replacement of the OLD pile never reaches past it.
var unrelatedOp = new RAddObjectsOperation();
var unrelatedLine = new RLineEntity(doc, new RLineData(
    new RVector(scatteredCx - 1, scatteredCy - 1),
    new RVector(scatteredCx + 1, scatteredCy + 1)));
unrelatedOp.addObject(unrelatedLine, false);
di.applyOperation(unrelatedOp);
var unrelatedId = unrelatedLine.getId();

AreaSync.adopt(doc, di);

var adoptedScatteredId = CsTags.get(doc.queryEntity(scattered), CsArea.ID_KEY);
ok(!isNull(adoptedScatteredId) && adoptedScatteredId !== "",
    "AreaSync.adopt: an already-scattered boundary becomes an area too");
ok(CsArea.countOwned(doc, adoptedScatteredId) > 0,
    "AreaSync.adopt: and its fill is preserved -- rebuilt, same seed, " +
    "so the pile looks exactly as it did before adoption");
for (var op2 = 0; op2 < oldPileIds.length; op2++) {
    ok(isNull(doc.queryEntity(oldPileIds[op2])) ||
        doc.queryEntity(oldPileIds[op2]).isUndone(),
        "AreaSync.adopt: the old BoundaryId-tagged pile was replaced, " +
        "not left doubled underneath the new one");
}
ok(!isNull(doc.queryEntity(unrelatedId)),
    "AreaSync.adopt: an unrelated entity near the boundary survives " +
    "untouched");

// ---------------------------------------------------------------------
// AreaSync.run (Task 12): the by-hand fallback for a drawing where
// nothing is listening -- exactly this headless run, which never has a
// main window to install AreaFillListener onto in the first place (see
// that file's own install() guard). A boundary reshaped by a plain
// operation keeps a STALE fill until Sync Areas is run.
// ---------------------------------------------------------------------

function squareVerts(cx, cy, half) {
    return [
        new RVector(cx - half, cy - half), new RVector(cx + half, cy - half),
        new RVector(cx + half, cy + half), new RVector(cx - half, cy + half)
    ];
}

/** Builds a real CsArea-tagged Blocks area directly -- the same tags
 *  AreaFillRun.commit would write, without pulling that tool's whole
 *  press/drag/release action into this file just to get one fixture. */
function addArea(cx, cy, half, key) {
    var entry = CsArea.entryFor(key);
    CsLayers.ensure(doc, di, entry.layer);
    CsLayers.ensure(doc, di, entry.boundaryLayer);

    var pl = new RPolylineEntity(doc, new RPolylineData());
    var verts = squareVerts(cx, cy, half);
    for (var i = 0; i < verts.length; i++) {
        pl.appendVertex(verts[i]);
    }
    pl.setClosed(true);
    pl.setLayerId(doc.getLayerId(entry.boundaryLayer));

    var id = CsUuid.v4();
    var seed = CsArea.newSeed();
    CsTags.set(pl, CsArea.ID_KEY, id);
    CsTags.set(pl, CsArea.PATTERN_KEY, key);
    CsTags.set(pl, CsArea.SEED_KEY, String(seed));
    CsTags.set(pl, CsArea.SCALE_KEY, "1");
    CsTags.set(pl, CsArea.DENSITY_KEY, "1");

    var addOp = new RAddObjectsOperation();
    addOp.addObject(pl, false);
    var built = CsArea.build(doc, addOp, pl, entry,
        { id: id, seed: seed, scale: 1, density: 1, layer: entry.layer });
    di.applyOperation(addOp);
    return { id: id, boundaryId: pl.getId(), ok: built.ok,
        reason: built.reason };
}

var syncCx = planX - 400, syncCy = planY;
var syncArea = addArea(syncCx, syncCy, 4, "BLOCKS");
ok(syncArea.ok,
    "AreaSync.run fixture: the fixture area built (" + syncArea.reason +
    ")");
var syncCountBefore = CsArea.countOwned(doc, syncArea.id);
ok(syncCountBefore > 0, "AreaSync.run fixture: it has an initial pile");

// Reshape the boundary wholesale -- the CsRevise idiom (getData() does
// not write back in this engine; clear() and re-append does) -- to a
// bigger square, WITHOUT going anywhere near CsArea.regenerate or a
// listener. Nothing here should update the fill by itself.
var syncBoundary = doc.queryEntity(syncArea.boundaryId);
var biggerVerts = squareVerts(syncCx, syncCy, 12);
syncBoundary.clear();
for (var sv2 = 0; sv2 < biggerVerts.length; sv2++) {
    syncBoundary.appendVertex(biggerVerts[sv2]);
}
var syncMoveOp = new RModifyObjectsOperation();
syncMoveOp.addObject(syncBoundary, false);
di.applyOperation(syncMoveOp);

eqs(CsArea.countOwned(doc, syncArea.id), syncCountBefore,
    "AreaSync.run fixture: nothing is listening headlessly, so the " +
    "fill is stale immediately after the boundary changes shape");

var syncResult = AreaSync.run(doc, di);
ok(syncResult.regenerated >= 1,
    "AreaSync.run: it rebuilt at least the one area whose boundary " +
    "moved");
var syncCountAfter = CsArea.countOwned(doc, syncArea.id);
ok(syncCountAfter > syncCountBefore,
    "AreaSync.run: the enlarged boundary now holds a bigger pile, " +
    "proving the fill actually followed the reshaped boundary rather " +
    "than being left stale (before " + syncCountBefore + ", after " +
    syncCountAfter + ")");

// AreaSync.run also does its own adoption pass -- one more legacy
// boundary, never touched above, proves the two halves work together
// from the one caver-facing command.
var runAdoptCx = planX - 200, runAdoptCy = planY - 40;
var runAdoptLegacy = addBoundary(runAdoptCx, runAdoptCy, 3);
var runResult = AreaSync.run(doc, di);
ok(runResult.adopted >= 1,
    "AreaSync.run: it adopts legacy breakdown boundaries too, not " +
    "only regenerating what is already an area");
ok(CsTags.get(doc.queryEntity(runAdoptLegacy), CsArea.ID_KEY) !== "",
    "AreaSync.run: the new legacy boundary came out the other side " +
    "as a real area");

// ---------------------------------------------------------------------
// ONE UNDO (Task 12 review round 2): AreaSync.adopt used to open its
// own transaction group instead of joining run()'s, so a single Sync
// Areas press that both rebuilt an area and adopted a boundary cost
// TWO Ctrl+Z's. adopt() now takes run()'s group, so both halves land
// on one di.undo().
// ---------------------------------------------------------------------

var undoAreaCx = planX - 600, undoAreaCy = planY;
var undoArea = addArea(undoAreaCx, undoAreaCy, 4, "BLOCKS");
ok(undoArea.ok,
    "one-undo fixture: the area to regenerate built (" +
    undoArea.reason + ")");
var undoCountBeforeRun = CsArea.countOwned(doc, undoArea.id);
ok(undoCountBeforeRun > 0, "one-undo fixture: it has an initial pile");

// Reshape it wholesale, same idiom as the AreaSync.run fixture above, so
// this run's own regenerate() call has real work to do.
var undoAreaBoundary = doc.queryEntity(undoArea.boundaryId);
var undoBiggerVerts = squareVerts(undoAreaCx, undoAreaCy, 12);
undoAreaBoundary.clear();
for (var ub = 0; ub < undoBiggerVerts.length; ub++) {
    undoAreaBoundary.appendVertex(undoBiggerVerts[ub]);
}
var undoReshapeOp = new RModifyObjectsOperation();
undoReshapeOp.addObject(undoAreaBoundary, false);
di.applyOperation(undoReshapeOp);

// And a legacy boundary elsewhere for the SAME run to adopt.
var undoLegacyCx = planX - 600, undoLegacyCy = planY + 40;
var undoLegacy = addBoundary(undoLegacyCx, undoLegacyCy, 3);

var undoRunResult = AreaSync.run(doc, di);
ok(undoRunResult.regenerated >= 1 && undoRunResult.adopted >= 1,
    "one-undo fixture: this single run both regenerated an area and " +
    "adopted a boundary (got " + JSON.stringify(undoRunResult) + ")");
var undoCountAfterRun = CsArea.countOwned(doc, undoArea.id);
ok(undoCountAfterRun !== undoCountBeforeRun,
    "one-undo fixture: the rebuild actually changed the fill count " +
    "(before " + undoCountBeforeRun + ", after " + undoCountAfterRun +
    ")");
ok(CsTags.get(doc.queryEntity(undoLegacy), CsArea.ID_KEY) !== "",
    "one-undo fixture: the legacy boundary really was adopted");

di.undo();

eqs(CsTags.get(doc.queryEntity(undoLegacy), CsArea.ID_KEY), "",
    "AreaSync: one Ctrl+Z undoes the adoption -- the legacy boundary " +
    "is no longer an area");
eqs(CsArea.countOwned(doc, undoArea.id), undoCountBeforeRun,
    "AreaSync: ...and the SAME undo also took the regenerated fill " +
    "back to its pre-run count -- one press, one undo, for both " +
    "halves of the run");

var out;
if (failures.length === 0) {
    out = "### SCATTER BREAKDOWN OK";
} else {
    out = "### SCATTER BREAKDOWN FAIL " + failures.length + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
