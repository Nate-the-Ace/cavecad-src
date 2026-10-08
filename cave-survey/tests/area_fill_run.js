// area_fill_run.js -- CsArea.build/clear write a real fill into a real
// document, and clean it back up by ownership, not by area.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/area_fill_run.js "$PWD"
//
// The claims: scatter elements land on the layer they were told to and
// carry their owner's tag; a filled pattern makes exactly one hatch
// entity (against a POLYLINE boundary and, separately, a closed SPLINE
// boundary -- CsArea.buildHatch takes two different paths through
// RHatchData.addBoundary depending on which); clearing one area's fill
// never touches its neighbour's; bedrock draws nothing and still
// reports success; the same seed rebuilds the same element count.
//
// scripts/simple.js gives the REAL isNull() -- the one that checks
// isNullWrapper(). A hand-rolled shim (typeof v.isNull==="function" ?
// v.isNull() : false) reports a MISSING block as present, because
// doc.queryBlock() of a name the document does not have comes back as a
// wrapped non-null object (typeof "object", getId() undefined) rather
// than JS null. CsArea.build's missing-block guard is real code under
// test here, not a fixture detail, so this file has to see it fail
// honestly -- same reasoning as tools/make_area_blocks.js, which hit
// this in Task 4.
include("scripts/simple.js");

createSpatialIndex = function() {
    return new RSpatialIndexNavel();
};

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// The stroke action itself (Task 6). It loads EAction and re-includes
// CsAll.js on its own (include() dedupes by basename, so that second
// pass is a no-op) -- the same pattern tests/scatter_breakdown_run.js
// uses to load a real TOOL rather than faking its shape.
include("scripts/EAction.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/AreaFill";
include(includeBasePath + "/AreaFillRun.js");

// The listener (Task 7). Shares AreaFillRun.layersFor so a stroke and
// a later regeneration can never disagree about where a fill belongs.
include(includeBasePath + "/AreaFillListener.js");

// The pattern editor (Task 11). savePattern is a plain function taking
// a document and entities, same reasoning as AreaFillRun.commit's own
// header: a test drives it directly, with no QDialog and no drawing
// tab in front of it.
include(includeBasePath + "/AreaFillEdit.js");

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

// =======================================================================
// Every catalog entry says what it is. A fourteenth pattern cannot slip
// in with no `help` string -- this fails the moment CsArea.CATALOG gains
// one, not just the thirteen shipped today -- because a caver reads the
// tile before they read the code, and a tile with nothing in its
// tooltip beyond "Fills the boundary as one region." is exactly the
// defect this batch exists to close.
// =======================================================================
(function everyCatalogEntryHasHelp() {
    for (var key in CsArea.CATALOG) {
        if (!CsArea.CATALOG.hasOwnProperty(key)) {
            continue;
        }
        var entry = CsArea.CATALOG[key];
        ok(!isNull(entry.help) && String(entry.help).trim() !== "",
            "CsArea.CATALOG." + key + ": has a non-empty help string");
    }
})();

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);

// The layers this run's patterns and boundaries need. ensureSurveyLayers
// only covers the CTRL_* layers every tool relies on -- CTRL-AREA-
// BOUNDARY, the fill layers and FLOOR are this suite's own business.
CsLayers.ensure(doc, di, "CTRL-AREA-BOUNDARY");
CsLayers.ensure(doc, di, CsArea.CATALOG.SAND.layer);
CsLayers.ensure(doc, di, CsArea.CATALOG.WATER.layer);
CsLayers.ensure(doc, di, CsArea.CATALOG.BEDROCK.layer);

// The AREA_* blocks live in the template (Task 4), not in a blank
// document -- CsSymbolStore.ensureBlock is Task 4's own answer for a
// drawing that lacks one, so this pulls the REAL AREA_STIPPLE block
// through the REAL import path rather than faking a stand-in. Chosen
// over CsSymbolStore.openOffscreen(templatePath) (working IN the
// template document) because it keeps the fixture a plain memory
// document like every other *_run.js test, and it is a fuller test of
// Task 4's contract: "ensureBlock imports into a drawing that lacks it."
var templatePath = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
var imported = CsSymbolStore.ensureBlock(doc, di, "AREA_STIPPLE",
    templatePath);
ok(imported.ok === true,
    "fixture: AREA_STIPPLE imports from the template (" +
    imported.error + ")");

/** A closed square boundary, drawn as a polyline like a caver's real
 *  freehand stroke would resolve to. */
function addBoundary(verts, layerName) {
    var op = new RAddObjectsOperation();
    var pl = new RPolyline();
    for (var i = 0; i < verts.length; i++) {
        pl.appendVertex(new RVector(verts[i].x, verts[i].y));
    }
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(layerName));
    op.addObject(e, false);
    di.applyOperation(op);
    return e;
}

/** A closed SPLINE boundary -- the OTHER shape CsArea.buildHatch has to
 *  loop, and the one the plan flagged as the addBoundary soft spot.
 *  Periodic, not just first-equals-last, because that is how this
 *  suite's own tools (CsRevise) close one. */
function addSplineBoundary(verts, layerName) {
    // RSplineData, not RSpline wrapped afterward, and update() called
    // explicitly -- the exact idiom CsRevise.js uses to build a live
    // periodic spline. Skipping update() leaves the shape looking
    // empty: getPointCloud answers nothing and CsArea.vertsOf reports
    // "the boundary has no area" even though the control points are
    // all there.
    var data = new RSplineData();
    for (var i = 0; i < verts.length; i++) {
        data.appendControlPoint(new RVector(verts[i].x, verts[i].y));
    }
    data.setDegree(3);
    data.setPeriodic(true);
    data.update();
    var e = new RSplineEntity(doc, data);
    e.setLayerId(doc.getLayerId(layerName));
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e;
}

var squareA = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
var squareB = [{x:40,y:0},{x:50,y:0},{x:50,y:10},{x:40,y:10}];
var circleC = [{x:80,y:0},{x:88,y:8},{x:80,y:16},{x:72,y:8}];

var bA = addBoundary(squareA, "CTRL-AREA-BOUNDARY");
var bB = addBoundary(squareB, "CTRL-AREA-BOUNDARY");
var bC = addSplineBoundary(circleC, "CTRL-AREA-BOUNDARY");

ok(!isNull(doc.queryBlock("AREA_STIPPLE")),
    "fixture: AREA_STIPPLE really is in the document now");

var idA = "area-a", idB = "area-b";
function fill(boundary, id, key) {
    var op = new RAddObjectsOperation();
    var result = CsArea.build(doc, op, boundary, CsArea.CATALOG[key],
        { id: id, seed: 99, scale: 1.0, density: 1.0,
          layer: CsArea.CATALOG[key].layer });
    di.applyOperation(op);
    return result;
}

// ---------------------------------------------------------------------
// scatter: elements land, on the right layer, tagged with their owner
// ---------------------------------------------------------------------

var made = fill(bA, idA, "SAND");
ok(made.ok === true, "CsArea.build: sand reports success (" +
    made.reason + ")");
ok(made.count > 0, "CsArea.build: sand puts elements in the drawing");
fill(bB, idB, "SAND");

var before = CsArea.countOwned(doc, idA);
ok(before > 0, "CsArea.countOwned: the fill is findable by its owner tag");
eqs(before, made.count,
    "CsArea.countOwned: agrees with the count build() reported");

var wrongLayer = 0;
var sandIds = CsArea.ownedBy(doc, idA);
for (var si = 0; si < sandIds.length; si++) {
    var sref = doc.queryEntity(sandIds[si]);
    if (isNull(sref)) { continue; }
    if (doc.getLayerName(sref.getLayerId()) !== CsArea.CATALOG.SAND.layer) {
        wrongLayer++;
    }
}
eqs(wrongLayer, 0,
    "CsArea.build: every scattered element landed on opts.layer");

// ---------------------------------------------------------------------
// clear: only the named area's fill dies, the neighbour's survives
// ---------------------------------------------------------------------

var clearOp = new RDeleteObjectsOperation();
CsArea.clear(doc, clearOp, idA);
di.applyOperation(clearOp);
eqs(CsArea.countOwned(doc, idA), 0, "CsArea.clear: the area's fill is gone");
ok(CsArea.countOwned(doc, idB) > 0,
    "CsArea.clear: the NEIGHBOUR's fill is untouched");

// ---------------------------------------------------------------------
// rebuild: the same seed gives the same count
// ---------------------------------------------------------------------

fill(bA, idA, "SAND");
var again = CsArea.countOwned(doc, idA);
eqs(again, before,
    "CsArea: the same seed rebuilds the same number of elements");

// ---------------------------------------------------------------------
// filled: exactly one hatch entity, tagged -- polyline boundary
// ---------------------------------------------------------------------

var wOp = new RAddObjectsOperation();
var waterMade = CsArea.build(doc, wOp, bB, CsArea.CATALOG.WATER,
    { id: "area-w", seed: 7, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.WATER.layer });
di.applyOperation(wOp);
ok(waterMade.ok === true,
    "CsArea.build: a filled pattern over a POLYLINE boundary succeeds (" +
    waterMade.reason + ")");
eqs(CsArea.countOwned(doc, "area-w"), 1,
    "CsArea.build: a filled pattern is exactly one hatch entity");
var waterIds = CsArea.ownedBy(doc, "area-w");
ok(waterIds.length === 1 &&
    !isNull(doc.queryEntity(waterIds[0])) &&
    doc.queryEntity(waterIds[0]).getType() === RS.EntityHatch,
    "CsArea.build: and it really is an RHatchEntity");

// ---------------------------------------------------------------------
// AC1 (2026-09-12): the Areas panel's Scale box (opts.scale) MULTIPLIES
// a filled pattern's own catalog patternScale. Before this fix
// buildHatch never read opts.scale at all, so the Scale box did
// nothing for water/sump/flowstone/moonmilk -- worse than disabled,
// because it looked live.
// ---------------------------------------------------------------------

var sc2Op = new RAddObjectsOperation();
var sc2Made = CsArea.build(doc, sc2Op, bB, CsArea.CATALOG.SUMP,
    { id: "area-sc2", seed: 7, scale: 2.0, density: 1.0,
      layer: CsArea.CATALOG.SUMP.layer });
di.applyOperation(sc2Op);
ok(sc2Made.ok === true,
    "CsArea.build: a filled pattern with opts.scale=2.0 succeeds (" +
    sc2Made.reason + ")");
var sc2Ids = CsArea.ownedBy(doc, "area-sc2");
eqs(sc2Ids.length, 1, "fixture: exactly one hatch to inspect");
var sc2Hatch = doc.queryEntity(sc2Ids[0]);
eqs(sc2Hatch.getScale(), CsArea.CATALOG.SUMP.patternScale * 2.0,
    "CsArea.buildHatch: opts.scale=2.0 produces a hatch scaled to " +
    "entry.patternScale * 2.0, not entry.patternScale alone");
eqs(sc2Made.scale, CsArea.CATALOG.SUMP.patternScale * 2.0,
    "CsArea.build: ... and reports the same effective scale it used, " +
    "for a caller (CsArea.regenerate) to stamp AreaHatchScale with");

// ---------------------------------------------------------------------
// AC6: a SCATTER pattern's opts.scale is UNAFFECTED by the above --
// it still means element size, exactly as before this fix. Only
// buildHatch's own multiply changed; CsArea.placements/build's scatter
// branch never touches entry.patternScale (scatter entries do not even
// have one).
// ---------------------------------------------------------------------

var scatOp = new RAddObjectsOperation();
var scatMade = CsArea.build(doc, scatOp, bA, CsArea.CATALOG.SAND,
    { id: "area-scat2", seed: 11, scale: 2.0, density: 1.0,
      layer: CsArea.CATALOG.SAND.layer });
di.applyOperation(scatOp);
ok(scatMade.ok === true && scatMade.count > 0,
    "fixture: a scatter fill to check element sizes on (" +
    scatMade.reason + ")");
var scatIds = CsArea.ownedBy(doc, "area-scat2");
var scatOutOfRange = 0;
var scatMinExpect = 2.0 * CsArea.CATALOG.SAND.scaleMin;
var scatMaxExpect = 2.0 * CsArea.CATALOG.SAND.scaleMax;
for (var sci = 0; sci < scatIds.length; sci++) {
    var scatRef = doc.queryEntity(scatIds[sci]);
    if (isNull(scatRef)) { continue; }
    var sx = scatRef.getScaleFactors().x;
    if (sx < scatMinExpect - 0.001 || sx > scatMaxExpect + 0.001) {
        scatOutOfRange++;
    }
}
eqs(scatOutOfRange, 0,
    "CsArea.build: every scattered element's own scale still falls in " +
    "opts.scale * [scaleMin, scaleMax] -- opts.scale keeps meaning " +
    "element size for a scatter pattern");

// ---------------------------------------------------------------------
// filled: the OTHER boundary shape -- a closed SPLINE -- also works.
// This is the soft spot the plan flagged: addBoundary may refuse a
// closed spline the way it refuses a whole polyline. It did not here;
// see CsArea.buildHatch's header comment for why the two shapes take
// different paths through RHatchData.
// ---------------------------------------------------------------------

var fOp = new RAddObjectsOperation();
var flowMade = CsArea.build(doc, fOp, bC, CsArea.CATALOG.FLOWSTONE,
    { id: "area-f", seed: 3, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.FLOWSTONE.layer });
di.applyOperation(fOp);
ok(flowMade.ok === true,
    "CsArea.build: a filled pattern over a closed SPLINE boundary " +
    "succeeds (" + flowMade.reason + ")");
eqs(CsArea.countOwned(doc, "area-f"), 1,
    "CsArea.build: the spline boundary also makes exactly one hatch");

// ---------------------------------------------------------------------
// bedrock: nothing drawn, success reported
// ---------------------------------------------------------------------

var rOp = new RAddObjectsOperation();
var rock = CsArea.build(doc, rOp, bA, CsArea.CATALOG.BEDROCK,
    { id: "area-r", seed: 7, scale: 1.0, density: 1.0,
      layer: CsArea.CATALOG.BEDROCK.layer });
di.applyOperation(rOp);
eqs(rock.count, 0, "CsArea.build: bedrock draws no fill, only its boundary");
ok(rock.ok === true, "CsArea.build: and reports success doing so");

// ---------------------------------------------------------------------
// missing block: build refuses cleanly, and its op commits NOTHING --
// the case that would have caught a half-built op landing anyway. A
// scatter entry naming a block this document has never heard of must
// fail before a single reference is queued, not partway through.
// ---------------------------------------------------------------------

var GHOST = { name: "Ghost", engine: "scatter",
    layer: CsArea.CATALOG.SAND.layer, blocks: ["AREA_GHOST_NOPE"],
    density: 40, scaleMin: 0.8, scaleMax: 1.2, rotate: false };
var beforeGhost = doc.queryAllEntities(false, true).length;
var ghostOp = new RAddObjectsOperation();
var ghostMade = CsArea.build(doc, ghostOp, bA, GHOST,
    { id: "area-ghost", seed: 5, scale: 1.0, density: 1.0,
      layer: GHOST.layer });
ok(ghostMade.ok === false,
    "CsArea.build: an entry naming an absent block reports failure");
ok(ghostMade.reason.length > 0,
    "CsArea.build: ... with a reason a caller can show");
di.applyOperation(ghostOp);
eqs(CsArea.countOwned(doc, "area-ghost"), 0,
    "CsArea.build: nothing tagged for the failed area reached the drawing");
eqs(doc.queryAllEntities(false, true).length, beforeGhost,
    "CsArea.build: applying the failed op changed the document not at " +
    "all -- no half-built fill slipped through on a false ok");

// =======================================================================
// AreaFillRun.commit -- Task 6. One stroke, one closed boundary, one
// fill, ONE transaction, routed to the view the drag landed in.
// =======================================================================

// EAction.handleUserMessage/warning need a listener headlessly or a
// refusal that tries to talk to the (nonexistent) status bar throws
// and ends the run early looking like an unrelated failure -- same
// reasoning as tests/scatter_breakdown_run.js's own capture.
var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

/** A closed square stroke, first point repeated at the end -- the shape
 *  a caver's own drag (and this suite's other fixtures) resolves to,
 *  and the shape AreaFillRun.commit must handle without doubling a
 *  control point at the seam of the periodic spline it builds. */
function squareStroke(cx, cy, half) {
    return [
        { x: cx - half, y: cy - half }, { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half },
        { x: cx - half, y: cy - half }
    ];
}

// ---------------------------------------------------------------------
// A real profile, so a real band box exists on CTRL-PROFILE-BOX --
// exactly the fixture tests/scatter_breakdown_run.js builds for the
// identical routing claim ("where the drag lands picks the view").
// ---------------------------------------------------------------------

var afSurvey = CsModel.newSurvey();
afSurvey.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2)
];
// TWO trips, not one -- so the trip AreaFillRun.commit derives for a
// stroke near A3 has to actually be READ off the drawing rather than
// happening to match the single-trip default every survey gets from
// CsModel.ensureTrips. A fixture with one trip could not tell a real
// nearest-station lookup apart from a hardcoded 0, which is exactly
// the elevation-datum trap family this criterion exists to catch.
afSurvey.trips = [CsModel.newTrip(), CsModel.newTrip()];
afSurvey.trips[0].name = "Trip A"; afSurvey.trips[0].date = "2026-01-01";
afSurvey.trips[0].team = "Alice";
afSurvey.trips[1].name = "Trip B"; afSurvey.trips[1].date = "2026-01-02";
afSurvey.trips[1].team = "Bob";
afSurvey.shots[1].trip = 1;

var afResolved = CsNetwork.resolve(afSurvey, {});
var afProfile = CsProfile.build(afSurvey, afResolved, {});

// The plan render itself -- CTRL-STATIONS points and CTRL-SHOTS lines,
// tagged with Station/From/To/Trip -- is what AreaFillRun.commit's
// call to CsTrace.tripFor actually reads to answer "which trip drew
// this". Without it there is no station in the whole document for
// nearestStation to find, and tripFor answers null forever, which
// would make the "never a bare 0" assertion below untestable rather
// than proven.
var afDrawnPlan = CsDraw.survey(afSurvey, afResolved, undefined, undefined,
    0, { doc: doc, di: di });
ok(afDrawnPlan.stationsDrawn > 0,
    "AreaFillRun fixture: the plan survey drew real stations for " +
    "tripFor's nearest-station lookup to find");
var afDrawn = CsProfileDraw.render(doc, di, afProfile, {});
ok(afDrawn.bandsDrawn >= 1,
    "AreaFillRun fixture: the profile drew at least one band");

var afBoxes = CsProfileBox.boxes(doc);
ok(afBoxes.length >= 1,
    "AreaFillRun fixture: the profile left at least one band box " +
    "behind for AreaFillRun to route against");

var afBand = afBoxes[0];
var afBandCx = (afBand.minX + afBand.maxX) / 2;
var afBandCy = (afBand.minY + afBand.maxY) / 2;
var afBandHalf = Math.min(afBand.maxX - afBand.minX,
    afBand.maxY - afBand.minY) / 8;
ok(afBandHalf > 1,
    "AreaFillRun fixture: the band box is roomy enough for a >1 sq " +
    "unit stroke to fit inside it (" + JSON.stringify(afBand) + ")");

// Far from the elevation and any band box: ordinary plan ground.
var afPlanRegion = CsTrace.profileRegion(doc);
var afPlanCx = isNull(afPlanRegion) ? 500 : (afPlanRegion.maxX + 500);
var afPlanCy = isNull(afPlanRegion) ? 500 : (afPlanRegion.maxY + 500);

// ---------------------------------------------------------------------
// Routing: two IDENTICAL strokes, one in the plan, one inside the
// band's box. Where the drag lands picks the view -- there is no plan
// button and no profile button.
// ---------------------------------------------------------------------

var afPlanStroke = squareStroke(afPlanCx, afPlanCy, 4);
var afBandStroke = squareStroke(afBandCx, afBandCy, afBandHalf);

var afPlanMade = AreaFillRun.commit(doc, di, afPlanStroke, "SAND",
    { scale: 1.0, density: 1.0 });
var afBandMade = AreaFillRun.commit(doc, di, afBandStroke, "SAND",
    { scale: 1.0, density: 1.0 });

ok(afPlanMade.ok === true,
    "AreaFillRun.commit: the plan stroke succeeds (" +
    afPlanMade.reason + ")");
eqs(afPlanMade.layer, "SEDIMENT-SAND-GRAVEL",
    "AreaFillRun.commit: a stroke in the plan fills on the plan layer");
ok(afPlanMade.count > 0,
    "AreaFillRun.commit: the plan stroke actually placed scatter");

ok(afBandMade.ok === true,
    "AreaFillRun.commit: the band stroke succeeds (" +
    afBandMade.reason + ")");
eqs(afBandMade.layer.indexOf("PROFILE-"), 0,
    "AreaFillRun.commit: the SAME stroke inside a band fills on the " +
    "profile twin, exactly as ScatterBreakdown routes -- got " +
    afBandMade.layer);
eqs(CsLayers.frameOf(afBandMade.boundaryLayer), "profile",
    "AreaFillRun.commit: ... and so does its boundary layer -- got " +
    afBandMade.boundaryLayer + " (CTRL-AREA-BOUNDARY's profile twin " +
    "keeps its CTRL- prefix, so this checks frameOf rather than a " +
    "literal \"PROFILE-\" string position)");
ok(afBandMade.count > 0,
    "AreaFillRun.commit: the band stroke actually placed scatter");

// ---------------------------------------------------------------------
// The boundary is a genuinely CLOSED spline -- proven, not assumed. It
// is sampled the same way CsArea.build itself would sample it
// (CsArea.vertsOf), which in a `-no-gui` run is the only sampling path
// that does not need a spline proxy plugin (see CsArea.vertsOf's own
// header). A boundary that merely LOOKS closed on screen while
// scattering its fill through an open seam would fail this, not the
// eyeball check.
// ---------------------------------------------------------------------

function afBoundaryFor(areaId) {
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, CsArea.ID_KEY) === areaId) {
            return e;
        }
    }
    return null;
}

var afPlanBoundary = afBoundaryFor(afPlanMade.id);
ok(!isNull(afPlanBoundary),
    "AreaFillRun.commit: the plan boundary entity exists in the drawing");
var afPlanVerts = CsArea.vertsOf(afPlanBoundary);
ok(afPlanVerts.length > 3,
    "AreaFillRun.commit: the boundary samples to a real polygon, not " +
    "an empty or degenerate one");
ok(CsArea.polygonArea(afPlanVerts) > AreaFillRun.MIN_AREA,
    "AreaFillRun.commit: the SAMPLED boundary encloses a non-trivial " +
    "area (" + CsArea.polygonArea(afPlanVerts) + ")");
var afFirstPt = afPlanVerts[0];
var afLastPt = afPlanVerts[afPlanVerts.length - 1];
ok(CsTrace.distance(afFirstPt, afLastPt) < 0.01,
    "AreaFillRun.commit: the boundary is GENUINELY closed -- its " +
    "first and last sampled points coincide (" +
    CsTrace.distance(afFirstPt, afLastPt) + " apart), not merely " +
    "LOOKING closed while scattering its fill through a gap");

// ---------------------------------------------------------------------
// The trip stamp: a real trip, derived from the nearest station, never
// a silent 0 -- the elevation-datum trap family this suite keeps
// finding new doors for.
// ---------------------------------------------------------------------

ok(afPlanMade.tripId !== 0 && !isNull(afPlanMade.tripId),
    "AreaFillRun.commit: the boundary is stamped with a real trip, " +
    "never a bare 0");
eqs(CsTags.get(afPlanBoundary, CsTrace.TRIP_TAG), String(afPlanMade.tripId),
    "AreaFillRun.commit: ... and the tag actually on the entity agrees " +
    "with what commit() reported");

// ---------------------------------------------------------------------
// Refusals: too few points, and too little area -- and NOTHING is left
// behind by either.
// ---------------------------------------------------------------------

var afBeforeRefusal = doc.queryAllEntities(false, true).length;

var afTooFewPoints = AreaFillRun.commit(doc, di,
    [{x:0,y:0},{x:1,y:0},{x:1,y:1}], "SAND", { scale: 1.0, density: 1.0 });
ok(afTooFewPoints.ok === false,
    "AreaFillRun.commit: a 3-point stroke is refused");
ok(afTooFewPoints.reason.length > 0,
    "AreaFillRun.commit: ... with a plain-language reason");

var afTooSmall = AreaFillRun.commit(doc, di,
    [{x:300,y:300},{x:300.1,y:300},{x:300.1,y:300.1},{x:300,y:300.1},
     {x:300,y:300}], "SAND", { scale: 1.0, density: 1.0 });
ok(afTooSmall.ok === false,
    "AreaFillRun.commit: a stroke enclosing under one square drawing " +
    "unit is refused (" + afTooSmall.reason + ")");
ok(afTooSmall.reason.length > 0,
    "AreaFillRun.commit: ... with a plain-language reason");

eqs(doc.queryAllEntities(false, true).length, afBeforeRefusal,
    "AreaFillRun.commit: both refused strokes created NOTHING -- not a " +
    "boundary with no fill, not a half-built anything");
eqs(CsArea.countOwned(doc, afTooSmall.id), 0,
    "AreaFillRun.commit: nothing is findable under a refused stroke's " +
    "id, because there is no id to find anything under");

// ---------------------------------------------------------------------
// A locked target layer: a NAMED refusal, not a silent no-op, and
// still nothing left behind.
// ---------------------------------------------------------------------

var afSandLayer = doc.queryLayer(CsArea.CATALOG.SAND.layer);
afSandLayer.setLocked(true);
var afLockOp = new RModifyObjectsOperation();
afLockOp.addObject(afSandLayer, false);
di.applyOperation(afLockOp);

var afBeforeLock = doc.queryAllEntities(false, true).length;
var afLocked = AreaFillRun.commit(doc, di,
    squareStroke(afPlanCx + 200, afPlanCy, 4), "SAND",
    { scale: 1.0, density: 1.0 });

ok(afLocked.ok === false,
    "AreaFillRun.commit: a locked target layer is refused, not " +
    "silently skipped");
ok(afLocked.reason.indexOf(CsArea.CATALOG.SAND.layer) >= 0,
    "AreaFillRun.commit: the refusal NAMES the locked layer (" +
    afLocked.reason + ")");
ok(afLocked.reason.toUpperCase().indexOf("LOCKED") >= 0,
    "AreaFillRun.commit: ... and says it is LOCKED, not just \"refused\"");
eqs(doc.queryAllEntities(false, true).length, afBeforeLock,
    "AreaFillRun.commit: the locked-layer refusal created nothing at " +
    "all");

afSandLayer.setLocked(false);
var afUnlockOp = new RModifyObjectsOperation();
afUnlockOp.addObject(afSandLayer, false);
di.applyOperation(afUnlockOp);

// The OTHER layer an area touches: SAND unlocked but its BOUNDARY
// layer locked. refusalReason claims to read back every layer it is
// given, not just the first -- this is the case that would catch a
// regression that only ever checked the fill layer and let a locked
// boundary through silently.
var afBoundaryLayer = doc.queryLayer(CsArea.CATALOG.SAND.boundaryLayer);
afBoundaryLayer.setLocked(true);
var afLockBoundaryOp = new RModifyObjectsOperation();
afLockBoundaryOp.addObject(afBoundaryLayer, false);
di.applyOperation(afLockBoundaryOp);

var afBeforeLockBoundary = doc.queryAllEntities(false, true).length;
var afLockedBoundary = AreaFillRun.commit(doc, di,
    squareStroke(afPlanCx + 400, afPlanCy, 4), "SAND",
    { scale: 1.0, density: 1.0 });

ok(afLockedBoundary.ok === false,
    "AreaFillRun.commit: a locked BOUNDARY layer is refused too, not " +
    "just a locked fill layer");
ok(afLockedBoundary.reason.indexOf(CsArea.CATALOG.SAND.boundaryLayer) >= 0,
    "AreaFillRun.commit: the refusal NAMES the locked boundary layer (" +
    afLockedBoundary.reason + ")");
ok(afLockedBoundary.reason.toUpperCase().indexOf("LOCKED") >= 0,
    "AreaFillRun.commit: ... and says it is LOCKED");
eqs(doc.queryAllEntities(false, true).length, afBeforeLockBoundary,
    "AreaFillRun.commit: the locked-boundary refusal created nothing " +
    "at all either");

afBoundaryLayer.setLocked(false);
var afUnlockBoundaryOp = new RModifyObjectsOperation();
afUnlockBoundaryOp.addObject(afBoundaryLayer, false);
di.applyOperation(afUnlockBoundaryOp);

// =======================================================================
// AreaFillListener -- Task 7. A fill follows its boundary: regenerate,
// move, delete, and the guards that keep a rebuild from becoming a
// redraw storm.
// =======================================================================

// ---------------------------------------------------------------------
// Fixture: a fresh SAND area, far from every earlier stroke in this
// file, dedicated to the listener's own tests below.
// ---------------------------------------------------------------------

var lstCx = afPlanCx + 900, lstCy = afPlanCy;
var lstMade = AreaFillRun.commit(doc, di, squareStroke(lstCx, lstCy, 5),
    "SAND", { scale: 1.0, density: 1.0 });
ok(lstMade.ok === true,
    "AreaFillListener fixture: the stroke that seeds this section " +
    "succeeds (" + lstMade.reason + ")");
var lstBoundary = afBoundaryFor(lstMade.id);
ok(!isNull(lstBoundary), "AreaFillListener fixture: its boundary exists");
var lstSeedBefore = CsTags.get(lstBoundary, CsArea.SEED_KEY);
var lstCountBefore = CsArea.countOwned(doc, lstMade.id);
ok(lstCountBefore > 0,
    "AreaFillListener fixture: it drew a real fill to regenerate");

/** Every fill entity's position for one area, as a sorted array of
 *  {x, y}, rounded to a thousandth of a drawing unit -- the same
 *  precision CsArea.signature uses, so "the same placements"
 *  means the same thing on both sides of this file. */
function fillPositions(areaId) {
    var ids = CsArea.ownedBy(doc, areaId);
    var out = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var pos = (e.getType() === RS.EntityBlockRef) ?
            e.getPosition() : e.getBoundingBox().getCenter();
        out.push({ x: Math.round(pos.x * 1000) / 1000,
            y: Math.round(pos.y * 1000) / 1000 });
    }
    out.sort(function(a, b) { return (a.x - b.x) || (a.y - b.y); });
    return out;
}

/** The same positions, as one comparable string -- "same placements",
 *  not merely "same count": a reshuffle with an equal count sorts
 *  differently and fails this. */
function fillPosSig(areaId) {
    var pts = fillPositions(areaId);
    var parts = [];
    for (var i = 0; i < pts.length; i++) {
        parts.push(pts[i].x + "," + pts[i].y);
    }
    return parts.join("|");
}

/** Every fill entity's OWN id for one area, sorted -- proves entities
 *  were literally untouched (not merely replaced with an equal set),
 *  the same style of proof tests/callout_sync.js's own no-op-reflow
 *  freeze test uses (leaderIdSig). */
function fillIdSig(areaId) {
    var ids = CsArea.ownedBy(doc, areaId).slice();
    ids.sort(function(a, b) { return a - b; });
    return ids.join(",");
}

/** Moves a boundary entity in drawing space and commits it as its own
 *  transaction. entity.move(RVector) mutates the shape in place;
 *  RModifyObjectsOperation is what actually commits that mutation --
 *  the exact idiom tests/scan_reanchor_run.js uses to shift a station
 *  and prove a listener follows it (RMoveSelectionOperation does not
 *  exist in this build, and nothing else in this suite calls one). */
function movedBoundaryBy(entity, dx, dy) {
    entity.move(new RVector(dx, dy));
    var mop = new RModifyObjectsOperation();
    mop.addObject(entity, false);
    di.applyOperation(mop);
}

// ---------------------------------------------------------------------
// regenerate(): rebuilds from the boundary's own tags, same seed, same
// placements as the original stroke drew.
// ---------------------------------------------------------------------

var lstPosBefore = fillPosSig(lstMade.id);
var lstResult1 = CsArea.regenerate(doc, di, lstBoundary.getId());
eqs(lstResult1, "regenerated",
    "CsArea.regenerate: a boundary with no stamped signature " +
    "yet is rebuilt");
eqs(CsArea.countOwned(doc, lstMade.id), lstCountBefore,
    "CsArea.regenerate: the rebuild makes the SAME number of " +
    "elements the original stroke did");
eqs(fillPosSig(lstMade.id), lstPosBefore,
    "CsArea.regenerate: ... at the SAME placements -- same " +
    "seed, same geometry, same scatter");
eqs(CsTags.get(lstBoundary, CsArea.SEED_KEY), lstSeedBefore,
    "CsArea.regenerate: the seed on the boundary was never " +
    "re-rolled");

// ---------------------------------------------------------------------
// Regenerating an UNCHANGED area twice does nothing at all -- not
// merely the same count, but the exact same entities, both times. This
// is the freeze that keeps a rebuild from becoming a redraw storm: an
// unconditional clear+rebuild would fire another transaction every
// time, and the busy flag alone does not catch a signal queued before
// it was set and delivered after it cleared -- see CalloutWrite's own
// such regression, described in AreaFillListener.js's header, which is
// exactly why the REAL guard lives in the signature compare here, not
// only in busy.
// ---------------------------------------------------------------------

var lstIdsAfterFirst = fillIdSig(lstMade.id);
var lstResult2 = CsArea.regenerate(doc, di, lstBoundary.getId());
eqs(lstResult2, "unchanged",
    "CsArea.regenerate: an unchanged boundary is recognised " +
    "as unchanged");
eqs(fillIdSig(lstMade.id), lstIdsAfterFirst,
    "CsArea.regenerate: ... and touches NOT ONE entity -- " +
    "same ids, not just the same count");

var lstResult3 = CsArea.regenerate(doc, di, lstBoundary.getId());
eqs(lstResult3, "unchanged",
    "CsArea.regenerate: and a third call is just as inert");
eqs(fillIdSig(lstMade.id), lstIdsAfterFirst,
    "CsArea.regenerate: so the cycle cannot run away");

// ---------------------------------------------------------------------
// Moving a boundary moves its fill with it.
// ---------------------------------------------------------------------

var lstBeforeMove = fillPositions(lstMade.id);
movedBoundaryBy(lstBoundary, 37, -19);
var lstMoveResult = CsArea.regenerate(doc, di,
    lstBoundary.getId());
eqs(lstMoveResult, "regenerated",
    "CsArea.regenerate: a moved boundary is rebuilt, not " +
    "reported unchanged");
eqs(CsArea.countOwned(doc, lstMade.id), lstCountBefore,
    "CsArea.regenerate: the moved fill still has the same " +
    "element count");
var lstAfterMove = fillPositions(lstMade.id);
ok(lstAfterMove.length === lstBeforeMove.length,
    "fixture: same length to compare pointwise");
var lstShiftedOk = true;
for (var lm = 0; lm < lstBeforeMove.length; lm++) {
    var expectX = Math.round((lstBeforeMove[lm].x + 37) * 1000) / 1000;
    var expectY = Math.round((lstBeforeMove[lm].y - 19) * 1000) / 1000;
    if (Math.abs(lstAfterMove[lm].x - expectX) > 0.01 ||
            Math.abs(lstAfterMove[lm].y - expectY) > 0.01) {
        lstShiftedOk = false;
    }
}
ok(lstShiftedOk,
    "CsArea.regenerate: every placement moved by EXACTLY " +
    "the boundary's own offset (37, -19) -- the fill followed the " +
    "boundary, not merely stayed the same size");

// ---------------------------------------------------------------------
// Deleting a boundary deletes its fill.
// ---------------------------------------------------------------------

var lstDelBefore = CsArea.countOwned(doc, lstMade.id);
ok(lstDelBefore > 0, "fixture: there is a fill to lose");
var lstDelOp = new RDeleteObjectsOperation();
lstDelOp.deleteObject(lstBoundary);
di.applyOperation(lstDelOp);

ok(isNull(CsArea.boundaryOf(doc, lstMade.id)),
    "CsArea.boundaryOf: the boundary is really gone -- " +
    "queryAllEntities(false, true) excludes the undone entity, unlike " +
    "queryEntity(id) on the same stale id");
ok(CsArea.countOwned(doc, lstMade.id) > 0,
    "fixture: the fill itself is still sitting there, orphaned, until " +
    "something sweeps it");

var lstSwept = CsArea.sweep(doc, di);
ok(lstSwept > 0, "CsArea.sweep: it swept at least one orphan");
eqs(CsArea.countOwned(doc, lstMade.id), 0,
    "CsArea.sweep: deleting a boundary deletes its fill");

eqs(CsArea.regenerate(doc, di, lstBoundary.getId()), "missing",
    "CsArea.regenerate: called on a now-deleted boundary " +
    "does nothing and says so");

eqs(CsArea.sweep(doc, di), 0,
    "CsArea.sweep: with no orphans left, a second sweep is " +
    "a genuine no-op");

// ---------------------------------------------------------------------
// The failure-retry invariant: a rebuild that FAILS must not stamp the
// signature. The freeze test above proves an UNCHANGED area is
// recognised and left alone; this is its mirror image -- a BROKEN
// area must never be mistaken for an unchanged one, or the next
// transaction that so much as looks at it reads "unchanged" and gives
// up on ever fixing it. Same rigor as the freeze test: a real failure
// (a missing block, exactly as CsArea.build's own tests use), not a
// forced return value.
// ---------------------------------------------------------------------

(function() {
    // A catalog entry whose block this document genuinely does not
    // have -- CsArea.entryFor looks entries up by key, so this has to
    // be a real (if temporary) CATALOG member for AreaFillRun.commit
    // and CsArea.regenerate to find it the normal way, not a
    // hand-built object handed straight to CsArea.build the way the
    // Task 5 "ghost" fixture above does.
    CsArea.CATALOG.GHOST_AREA = { name: "Ghost Area", engine: "scatter",
        layer: CsArea.CATALOG.SAND.layer,
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_GHOST_NOPE"],
        density: 40, scaleMin: 0.8, scaleMax: 1.2, rotate: false };

    var ghostCx = lstCx + 1000, ghostCy = lstCy;
    var ghostMade = AreaFillRun.commit(doc, di,
        squareStroke(ghostCx, ghostCy, 5), "GHOST_AREA",
        { scale: 1.0, density: 1.0 });
    ok(ghostMade.ok === false,
        "fixture: the stroke itself reports failure -- the block is " +
        "really missing, not a fixture bug (" + ghostMade.reason + ")");
    var ghostBoundaryId = afBoundaryFor(ghostMade.id).getId();

    // A FRESH doc.queryEntity(id) every time a tag is read, never a
    // long-held handle: this suite has already hit stale-wrapper traps
    // elsewhere, and a handle fetched once, then read again after a
    // modify operation has since committed through a DIFFERENT
    // fetch of the same id, is exactly that shape of trap. Querying
    // fresh each time is what every other regenerate/reconcile caller
    // in this file already does via a boundary's getId() round-trip.
    function ghostSig() {
        return CsTags.get(doc.queryEntity(ghostBoundaryId), CsArea.SIG_KEY);
    }

    eqs(ghostSig(), "",
        "fixture: the failed stroke itself never stamped a signature " +
        "either");

    var ghostRegen1 = CsArea.regenerate(doc, di, ghostBoundaryId);
    ok(ghostRegen1.indexOf("failed:") === 0,
        "CsArea.regenerate: a rebuild that fails reports failure (" +
        ghostRegen1 + ")");
    eqs(ghostSig(), "",
        "CsArea.regenerate: a FAILED rebuild does not stamp the " +
        "signature");

    var ghostRegen2 = CsArea.regenerate(doc, di, ghostBoundaryId);
    ok(ghostRegen2.indexOf("failed:") === 0,
        "CsArea.regenerate: with the block still missing, the very " +
        "next call tries again and fails again (" + ghostRegen2 + ")");
    ok(ghostRegen2 !== "unchanged",
        "CsArea.regenerate: ... critically, NOT reported as " +
        "\"unchanged\" -- a broken area must keep retrying, never " +
        "freeze");
    eqs(ghostSig(), "",
        "CsArea.regenerate: ... and the second failure still does not " +
        "stamp a signature");

    // Now the block genuinely exists (imported at the top of this file
    // for the SAND fixtures) -- point the same catalog entry at it and
    // confirm the SAME boundary, never touched any other way, builds
    // clean on the very next call.
    CsArea.CATALOG.GHOST_AREA.blocks = ["AREA_STIPPLE"];
    var ghostRegen3 = CsArea.regenerate(doc, di, ghostBoundaryId);
    eqs(ghostRegen3, "regenerated",
        "CsArea.regenerate: once the block exists, the very next call " +
        "succeeds -- the earlier failures never froze it");
    ok(CsArea.countOwned(doc, ghostMade.id) > 0,
        "CsArea.regenerate: and it actually built a real fill this " +
        "time");
    ok(ghostSig() !== "",
        "CsArea.regenerate: the signature is stamped now that a " +
        "build has actually succeeded");

    delete CsArea.CATALOG.GHOST_AREA;
})();

// =======================================================================
// Hatch scale/angle: controllable from the panel, and PERSISTENT --
// through ordinary regeneration AND through CaveCAD's own property
// editor. Task 14, 2026-09-12 (Nathan): both paths must work, and both
// must survive a regenerate, which is why this lives right after the
// freeze tests above rather than beside CsArea.build's own hatch tests
// near the top of this file -- it is exercising CsArea.regenerate, not
// CsArea.build in isolation.
// =======================================================================

var hscCx = lstCx + 1200, hscCy = lstCy;
var hscMade = AreaFillRun.commit(doc, di, squareStroke(hscCx, hscCy, 5),
    "SUMP", { scale: 2.0, density: 1.0 });
ok(hscMade.ok === true,
    "hatch-scale fixture: a SUMP stroke with the panel's Scale at 2.0 " +
    "succeeds (" + hscMade.reason + ")");
var hscBoundary = afBoundaryFor(hscMade.id);
ok(!isNull(hscBoundary), "hatch-scale fixture: its boundary exists");

/** The one hatch entity owned by the hatch-scale fixture's area, or
 *  null -- re-fetched every time, never held across a regenerate,
 *  since a "regenerated" result deletes the old entity and adds a new
 *  one with a different id (the file header's own FRESH doc.queryEntity
 *  discipline). */
function hscHatch() {
    var ids = CsArea.ownedBy(doc, hscMade.id);
    if (ids.length !== 1) {
        return null;
    }
    return doc.queryEntity(ids[0]);
}

var hscExpectScale = CsArea.CATALOG.SUMP.patternScale * 2.0;
var hscHatch1 = hscHatch();
ok(!isNull(hscHatch1), "hatch-scale fixture: exactly one hatch exists");
eqs(hscHatch1.getScale(), hscExpectScale,
    "AreaFillRun.commit: a stroke drawn with the panel's Scale at 2.0 " +
    "produces a hatch scaled to entry.patternScale * 2.0, not " +
    "entry.patternScale alone (acceptance criterion 1)");

// ---------------------------------------------------------------------
// Acceptance criterion 2: that scale SURVIVES a regeneration -- move
// the boundary, and the scale is still doubled.
// ---------------------------------------------------------------------

movedBoundaryBy(hscBoundary, 13, -7);
eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "regenerated",
    "CsArea.regenerate: a moved SUMP boundary is rebuilt");
var hscHatch2 = hscHatch();
ok(!isNull(hscHatch2), "fixture: still exactly one hatch after the move");
eqs(hscHatch2.getScale(), hscExpectScale,
    "CsArea.regenerate: the doubled scale survives a regeneration " +
    "(acceptance criterion 2)");

// ---------------------------------------------------------------------
// Acceptance criterion 3: hand-editing the hatch's scale -- getScale/
// setScale are RHatchEntity's own direct pass-through to the same
// RHatchData field CaveCAD's property editor writes through
// PropertyScaleFactor (RHatchEntity::setProperty, confirmed in
// cavecad-src) -- and then regenerating KEEPS the hand-set scale
// rather than reverting it.
// ---------------------------------------------------------------------

var hscHandScale = 9.5;
hscHatch2.setScale(hscHandScale);
var hscSetOp = new RModifyObjectsOperation();
hscSetOp.addObject(hscHatch2, false);
di.applyOperation(hscSetOp);

eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "regenerated",
    "CsArea.regenerate: a hand-edited hatch scale is treated as a " +
    "real change, never reported as \"unchanged\"");
var hscHatch3 = hscHatch();
ok(!isNull(hscHatch3), "fixture: still exactly one hatch after capture");
eqs(hscHatch3.getScale(), hscHandScale,
    "CsArea.regenerate: the hand-set PropertyScaleFactor is KEPT, not " +
    "reverted to the panel's own scale (acceptance criterion 3)");
eqs(parseFloat(CsTags.get(doc.queryEntity(hscBoundary.getId()),
    CsArea.SCALE_KEY)), hscHandScale / CsArea.CATALOG.SUMP.patternScale,
    "CsArea.regenerate: ... folded back into AreaScale as observed / " +
    "entry.patternScale, so the NEXT rebuild reproduces it too rather " +
    "than doubling it again");

// Immediately unchanged -- proves the capture itself is not a float
// that never quite matches its own last write, the exact freeze family
// this suite keeps finding new doors for.
var hscIdsAfterScale = fillIdSig(hscMade.id);
eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "unchanged",
    "CsArea.regenerate: right after capturing a hand-set scale, the " +
    "very next call is unchanged -- capture does not itself produce a " +
    "fresh drift on every call");
eqs(fillIdSig(hscMade.id), hscIdsAfterScale,
    "CsArea.regenerate: ... and touches not one entity doing it");

// ---------------------------------------------------------------------
// Acceptance criterion 4: the same for PropertyAngle.
// ---------------------------------------------------------------------

var hscHandAngle = 1.2345;
var hscHatch4 = hscHatch();
hscHatch4.setAngle(hscHandAngle);
var hscAngleOp = new RModifyObjectsOperation();
hscAngleOp.addObject(hscHatch4, false);
di.applyOperation(hscAngleOp);

eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "regenerated",
    "CsArea.regenerate: a hand-edited hatch angle is treated as a " +
    "real change too");
var hscHatch5 = hscHatch();
ok(!isNull(hscHatch5),
    "fixture: still exactly one hatch after angle capture");
ok(Math.abs(hscHatch5.getAngle() - hscHandAngle) < 1e-9,
    "CsArea.regenerate: the hand-set PropertyAngle is KEPT (acceptance " +
    "criterion 4) -- got " + hscHatch5.getAngle());
eqs(parseFloat(CsTags.get(doc.queryEntity(hscBoundary.getId()),
    CsArea.ANGLE_KEY)), hscHandAngle,
    "CsArea.regenerate: ... and stored directly on AreaAngle -- unlike " +
    "scale, an angle has no catalog baseline to divide out");
eqs(hscHatch5.getScale(), hscHandScale,
    "CsArea.regenerate: capturing a new angle does not disturb the " +
    "scale captured moments ago");

var hscIdsAfterAngle = fillIdSig(hscMade.id);
eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "unchanged",
    "CsArea.regenerate: unchanged again right after the angle capture " +
    "too");
eqs(fillIdSig(hscMade.id), hscIdsAfterAngle,
    "CsArea.regenerate: ... touching nothing");

// ---------------------------------------------------------------------
// Acceptance criterion 5: the existing freeze guard still holds for an
// UNTOUCHED filled area -- regenerating it twice more writes nothing
// and reports "unchanged" both times, same rigor as the SAND freeze
// test earlier in this file.
// ---------------------------------------------------------------------

eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "unchanged",
    "CsArea.regenerate: an untouched filled area is still recognised " +
    "as unchanged (acceptance criterion 5)");
eqs(fillIdSig(hscMade.id), hscIdsAfterAngle,
    "CsArea.regenerate: ... touching not one entity");
eqs(CsArea.regenerate(doc, di, hscBoundary.getId()), "unchanged",
    "CsArea.regenerate: and a further call is just as inert");
eqs(fillIdSig(hscMade.id), hscIdsAfterAngle,
    "CsArea.regenerate: so a filled area's freeze cannot run away " +
    "either, exactly like a scatter area's");

// ---------------------------------------------------------------------
// Migration (2026-09-12 review): adding ANGLE_KEY to CsArea.signature
// invalidates every PRE-EXISTING area's stored signature, scatter areas
// included, because an old boundary has no AreaAngle tag yet. The
// first regenerate to touch each one after this upgrade must rebuild
// once (new ids, same seed, same placements) and then go quiet --
// never rebuild a SECOND time for a reason that never changes again.
// Proven on a SAND (scatter) fixture on purpose: it is the non-obvious
// half, since scatter never reads ANGLE_KEY for anything.
// ---------------------------------------------------------------------

(function() {
    // afPlanBoundary/afPlanMade (Task 6's own SAND fixture) is used
    // rather than a brand-new stroke so this cannot be confused with
    // the ordinary "no signature stamped yet" first-regenerate case
    // (already covered above) -- it is PRIMED with a real, CURRENT-
    // format signature first, exactly as a boundary saved under this
    // very release already has, before the pre-upgrade sig is forced
    // onto it.
    var migBoundary = afPlanBoundary;
    CsArea.regenerate(doc, di, migBoundary.getId());   // establish a
                                                        // current-format
                                                        // baseline sig
    var migVerts = CsArea.vertsOf(migBoundary);

    // The PRE-upgrade signature format, by hand: identical to
    // CsArea.signature's own five-part join, just without the
    // ANGLE_KEY segment this task added -- exactly what a real
    // boundary saved before this upgrade has stamped on it.
    var migParts = [];
    for (var mi = 0; mi < migVerts.length; mi++) {
        migParts.push(Math.round(migVerts[mi].x * 1000) + "," +
            Math.round(migVerts[mi].y * 1000));
    }
    var migOldSig = [
        CsTags.get(migBoundary, CsArea.PATTERN_KEY),
        CsTags.get(migBoundary, CsArea.SEED_KEY),
        CsTags.get(migBoundary, CsArea.SCALE_KEY),
        CsTags.get(migBoundary, CsArea.DENSITY_KEY),
        migParts.join(";")
    ].join("|");
    ok(migOldSig !== CsArea.signature(migBoundary, migVerts),
        "migration fixture: the hand-built PRE-upgrade signature really " +
        "is different from what CsArea.signature computes now -- " +
        "otherwise this test would prove nothing");

    var migSigOp = new RModifyObjectsOperation();
    CsTags.set(migBoundary, CsArea.SIG_KEY, migOldSig);
    migSigOp.addObject(migBoundary, false);
    di.applyOperation(migSigOp);

    var migIdsBefore = fillIdSig(afPlanMade.id);
    var migPosBefore = fillPosSig(afPlanMade.id);
    eqs(CsArea.regenerate(doc, di, migBoundary.getId()), "regenerated",
        "CsArea.regenerate: a boundary carrying a pre-ANGLE_KEY " +
        "signature is rebuilt once on its first post-upgrade touch");
    eqs(fillPosSig(afPlanMade.id), migPosBefore,
        "CsArea.regenerate: ... at the SAME placements -- the migration " +
        "rebuild changes ids, never what was actually drawn");
    ok(fillIdSig(afPlanMade.id) !== migIdsBefore,
        "CsArea.regenerate: ... though the entities themselves are " +
        "genuinely new (different ids), which is the whole cost being " +
        "documented, not a false alarm from this test");

    var migIdsAfter = fillIdSig(afPlanMade.id);
    eqs(CsArea.regenerate(doc, di, migBoundary.getId()), "unchanged",
        "CsArea.regenerate: the very next touch is quiet again -- the " +
        "migration is a ONE-TIME cost, not a standing freeze failure");
    eqs(fillIdSig(afPlanMade.id), migIdsAfter,
        "CsArea.regenerate: ... touching not one entity on that second " +
        "pass");
})();

// ---------------------------------------------------------------------
// Cost guard, part 1: a transaction that touches no area at all -- in a
// document already FULL of areas -- never reaches CsArea.areaScan (the
// shared full-document walk), never mind sweep, and changes nothing.
// ---------------------------------------------------------------------

var lstPlainOp = new RAddObjectsOperation();
var lstPlainLine = new RLineEntity(doc, new RLineData(
    new RVector(lstCx + 300, lstCy), new RVector(lstCx + 320, lstCy)));
lstPlainOp.addObject(lstPlainLine, false);
di.applyOperation(lstPlainOp);

var lstPlainTransaction = {
    getAffectedObjects: function() { return [lstPlainLine.getId()]; },
    getGroup: function() { return -1; }
};

var lstPlainTouched = AreaFillListener.touchedIds(doc, lstPlainTransaction);
var lstPlainAny = false;
for (var lp in lstPlainTouched.ids) {
    if (lstPlainTouched.ids.hasOwnProperty(lp)) { lstPlainAny = true; }
}
ok(!lstPlainAny,
    "AreaFillListener.touchedIds: an entity with neither AreaId nor " +
    "AreaOwner touches nothing, even in a document full of areas");
ok(!lstPlainTouched.deletedBoundary,
    "AreaFillListener.touchedIds: ... and reports no boundary deleted");

var lstScanCalls = 0;
var lstScanOriginal = CsArea.areaScan;
CsArea.areaScan = function() {
    lstScanCalls++;
    return lstScanOriginal.apply(CsArea, arguments);
};
var lstBeforePlainCount = doc.queryAllEntities(false, true).length;
AreaFillListener.onTransaction(doc, lstPlainTransaction);
CsArea.areaScan = lstScanOriginal;

eqs(lstScanCalls, 0,
    "AreaFillListener.onTransaction: an unrelated edit never reaches " +
    "CsArea.areaScan -- the cheap per-object gate stops it before the " +
    "full-document walk, not just before sweep");
eqs(doc.queryAllEntities(false, true).length, lstBeforePlainCount,
    "AreaFillListener.onTransaction: ... and changes nothing");

// ---------------------------------------------------------------------
// Cost guard, part 2: sweep is gated on an actual removal, not run on
// every area-touching transaction. An ordinary edit to a LIVE boundary
// (no deletion in sight) must regenerate that one area without ever
// calling CsArea.sweep -- dragging one boundary in a drawing with many
// areas must not re-walk the document hunting for orphans on every
// tick.
// ---------------------------------------------------------------------

// onTransaction only reaches CsArea.areaScan/sweep/regenerate once it
// has resolved a real RDocumentInterface from RMainWindowQt's main
// window -- which is null in a -no-gui run (measured: RMainWindowQt.
// getMainWindow() answers null headlessly). Parts 2 and 3 need
// onTransaction to run PAST that point to prove what it does with a
// real dispatch, so a fake main window stands in for the length of
// both -- restored immediately after part 3, and never touched by any
// test before or after this pair (they all return earlier than this
// gate, or call CsArea.* directly).
var afFakeAppWin = { getDocumentInterface: function() { return di; } };
var afMainWinOriginal = RMainWindowQt.getMainWindow;
RMainWindowQt.getMainWindow = function() { return afFakeAppWin; };

var lstLiveMade = AreaFillRun.commit(doc, di,
    squareStroke(lstCx + 600, lstCy, 5), "SAND",
    { scale: 1.0, density: 1.0 });
ok(lstLiveMade.ok === true, "fixture: a live area for the sweep-gate test");
var lstLiveBoundary = afBoundaryFor(lstLiveMade.id);

var lstLiveSweepCalls = 0;
var lstLiveSweepOriginal = CsArea.sweep;
CsArea.sweep = function() {
    lstLiveSweepCalls++;
    return lstLiveSweepOriginal.apply(CsArea, arguments);
};
var lstLiveRegenCalls = 0;
var lstLiveRegenOriginal = CsArea.regenerate;
CsArea.regenerate = function() {
    lstLiveRegenCalls++;
    return lstLiveRegenOriginal.apply(CsArea, arguments);
};

movedBoundaryBy(lstLiveBoundary, 3, 3);   // a live, ordinary edit
AreaFillListener.onTransaction(doc, {
    getAffectedObjects: function() { return [lstLiveBoundary.getId()]; },
    getGroup: function() { return -1; }
});

CsArea.sweep = lstLiveSweepOriginal;
CsArea.regenerate = lstLiveRegenOriginal;

eqs(lstLiveSweepCalls, 0,
    "AreaFillListener.onTransaction: moving a LIVE boundary never " +
    "calls CsArea.sweep -- nothing was removed, so there is nothing " +
    "to sweep for");
eqs(lstLiveRegenCalls, 1,
    "AreaFillListener.onTransaction: ... but it does regenerate the " +
    "area that was actually touched");

// ---------------------------------------------------------------------
// Cost guard, part 3: sweep DOES run when a boundary is genuinely
// deleted -- through the real dispatch path this time, not a direct
// CsArea.sweep call, so this proves onTransaction itself wires the
// deletion flag through to the sweep, not merely that CsArea.sweep
// works in isolation (already shown above).
// ---------------------------------------------------------------------

var lstGoneMade = AreaFillRun.commit(doc, di,
    squareStroke(lstCx + 800, lstCy, 5), "SAND",
    { scale: 1.0, density: 1.0 });
ok(lstGoneMade.ok === true, "fixture: an area to delete through dispatch");
var lstGoneBoundary = afBoundaryFor(lstGoneMade.id);
ok(CsArea.countOwned(doc, lstGoneMade.id) > 0,
    "fixture: it has a real fill before it is deleted");

var lstGoneId = lstGoneBoundary.getId();
var lstGoneDelOp = new RDeleteObjectsOperation();
lstGoneDelOp.deleteObject(lstGoneBoundary);
di.applyOperation(lstGoneDelOp);

var lstGoneSweepCalls = 0;
var lstGoneSweepOriginal = CsArea.sweep;
CsArea.sweep = function() {
    lstGoneSweepCalls++;
    return lstGoneSweepOriginal.apply(CsArea, arguments);
};
AreaFillListener.onTransaction(doc, {
    getAffectedObjects: function() { return [lstGoneId]; },
    getGroup: function() { return -1; }
});
CsArea.sweep = lstGoneSweepOriginal;
RMainWindowQt.getMainWindow = afMainWinOriginal;

eqs(lstGoneSweepCalls, 1,
    "AreaFillListener.onTransaction: a deleted boundary DOES trigger " +
    "CsArea.sweep, through the dispatcher's own deletion detection");
eqs(CsArea.countOwned(doc, lstGoneMade.id), 0,
    "AreaFillListener.onTransaction: ... and the orphaned fill is " +
    "really gone, end to end");

// ---------------------------------------------------------------------
// The re-entry guard: while busy, onTransaction returns before it even
// calls touchedIds -- proven by a spy, not by inspection.
// ---------------------------------------------------------------------

var lstTouchedCalls = 0;
var lstTouchedOriginal = AreaFillListener.touchedIds;
AreaFillListener.touchedIds = function() {
    lstTouchedCalls++;
    return lstTouchedOriginal.apply(AreaFillListener, arguments);
};
AreaFillListener.busy = true;
AreaFillListener.onTransaction(doc, lstPlainTransaction);
AreaFillListener.busy = false;
AreaFillListener.touchedIds = lstTouchedOriginal;

eqs(lstTouchedCalls, 0,
    "AreaFillListener.onTransaction: while busy, it returns before " +
    "calling touchedIds at all -- proven with a spy, not by reading " +
    "the source");

// A genuinely area-touching transaction, run right after, confirms the
// spy and the busy flag were not themselves the reason nothing
// happened above -- the listener is alive and does react once busy is
// clear again.
var lstReviveMade = AreaFillRun.commit(doc, di,
    squareStroke(lstCx + 500, lstCy, 5), "SAND",
    { scale: 1.0, density: 1.0 });
ok(lstReviveMade.ok === true,
    "fixture: a fresh area to prove the listener still works post-spy");
var lstReviveBoundary = afBoundaryFor(lstReviveMade.id);
eqs(CsArea.regenerate(doc, di, lstReviveBoundary.getId()),
    "regenerated",
    "CsArea.regenerate: still works after the guard tests " +
    "above -- the spies and the busy flag were restored cleanly");

// ---------------------------------------------------------------------
// A document with NO AreaId tags at all: the listener does no work.
// A separate, clean document -- the shared `doc` above has plenty of
// AreaId tags by now, so this is the only way to prove the "no areas
// anywhere" case, not merely "no areas THIS transaction touched".
// ---------------------------------------------------------------------

(function() {
    var bareDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var bareDi = new RDocumentInterface(bareDoc);
    CsLayers.ensureSurveyLayers(bareDoc, bareDi);

    var bareOp = new RAddObjectsOperation();
    var bareLine = new RLineEntity(bareDoc, new RLineData(
        new RVector(0, 0), new RVector(10, 0)));
    bareOp.addObject(bareLine, false);
    bareDi.applyOperation(bareOp);

    var bareTransaction = {
        getAffectedObjects: function() { return [bareLine.getId()]; },
        getGroup: function() { return -1; }
    };

    var bareTouched = AreaFillListener.touchedIds(bareDoc, bareTransaction);
    var bareAny = false;
    for (var bp in bareTouched.ids) {
        if (bareTouched.ids.hasOwnProperty(bp)) { bareAny = true; }
    }
    ok(!bareAny,
        "AreaFillListener.touchedIds: a document with no AreaId tags " +
        "at all reports nothing touched");
    ok(!bareTouched.deletedBoundary,
        "AreaFillListener.touchedIds: ... and no boundary deletion " +
        "either");

    var bareScanCalls = 0;
    var bareScanOriginal = CsArea.areaScan;
    CsArea.areaScan = function() {
        bareScanCalls++;
        return bareScanOriginal.apply(CsArea, arguments);
    };
    var bareSweepCalls = 0;
    var bareSweepOriginal = CsArea.sweep;
    CsArea.sweep = function() {
        bareSweepCalls++;
        return bareSweepOriginal.apply(CsArea, arguments);
    };
    var bareRegenCalls = 0;
    var bareRegenOriginal = CsArea.regenerate;
    CsArea.regenerate = function() {
        bareRegenCalls++;
        return bareRegenOriginal.apply(CsArea, arguments);
    };
    var bareBeforeCount = bareDoc.queryAllEntities(false, true).length;
    AreaFillListener.onTransaction(bareDoc, bareTransaction);
    CsArea.areaScan = bareScanOriginal;
    CsArea.sweep = bareSweepOriginal;
    CsArea.regenerate = bareRegenOriginal;

    eqs(bareScanCalls, 0,
        "AreaFillListener.onTransaction: with no AreaId tags in the " +
        "document, it never even reaches CsArea.areaScan");

    eqs(bareSweepCalls, 0,
        "AreaFillListener.onTransaction: with no AreaId tags in the " +
        "document, sweep is never called");
    eqs(bareRegenCalls, 0,
        "AreaFillListener.onTransaction: ... and neither is regenerate");
    eqs(bareDoc.queryAllEntities(false, true).length, bareBeforeCount,
        "AreaFillListener.onTransaction: the document is left exactly " +
        "as it was");
})();

// =======================================================================
// Repatterning (2026-09-12, beginner-friendliness batch). A wrong tile
// no longer means deleting the boundary and re-tracing the loop --
// CsArea.repattern rewrites AreaPattern (and, optionally, AreaScale/
// AreaDensity) on an existing boundary and rebuilds its fill, keeping
// the seed. CsArea.resolveSelection is the other half: a caver clicking
// the drawn texture selects the FILL, not the invisible boundary, and
// every fill entity's AreaOwner has to resolve back to it.
// =======================================================================

/** RE-QUERIED, not a long-held handle -- CsArea's own header on
 *  CsArea.regenerate: "reading tags off a long-held entity handle after
 *  modify operations gives stale values -- re-query." Every read of a
 *  tag AFTER a CsArea.repattern call below goes through this, never
 *  through the fixture's own boundary variable. */
function reQ(entity) {
    return doc.queryEntity(entity.getId());
}

(function repatterningChangesAnAreasPattern() {
    var rpCx = lstCx + 2000, rpCy = lstCy;
    var rpMade = AreaFillRun.commit(doc, di, squareStroke(rpCx, rpCy, 5),
        "SAND", { scale: 1.0, density: 1.0 });
    ok(rpMade.ok === true,
        "repattern fixture: the original SAND stroke succeeds (" +
        rpMade.reason + ")");
    var rpBoundary = afBoundaryFor(rpMade.id);
    ok(!isNull(rpBoundary), "repattern fixture: its boundary exists");
    var rpSeedBefore = CsTags.get(rpBoundary, CsArea.SEED_KEY);
    ok(rpSeedBefore !== "", "repattern fixture: it has a seed to keep");

    // -------------------------------------------------------------
    // CsArea.resolveSelection: BOTH the boundary id and a fill id
    // resolve to the same boundary entity -- a beginner clicking the
    // drawn stipple (the FILL) must reach the same area a caver who
    // somehow clicked the invisible boundary would.
    // -------------------------------------------------------------

    var rpFillIds = CsArea.ownedBy(doc, rpMade.id);
    ok(rpFillIds.length > 0, "repattern fixture: there is a fill to " +
        "select instead of the boundary");

    var rpFromBoundary = CsArea.resolveSelection(doc, [rpBoundary.getId()]);
    eqs(rpFromBoundary.length, 1,
        "CsArea.resolveSelection: selecting the boundary itself " +
        "resolves to exactly one area");
    eqs(rpFromBoundary[0], rpBoundary.getId(),
        "CsArea.resolveSelection: ... itself");

    var rpFromFill = CsArea.resolveSelection(doc, [rpFillIds[0]]);
    eqs(rpFromFill.length, 1,
        "CsArea.resolveSelection: selecting a FILL entity (what a " +
        "beginner actually clicks) resolves to exactly one area too");
    eqs(rpFromFill[0], rpBoundary.getId(),
        "CsArea.resolveSelection: ... the SAME boundary the direct " +
        "selection found");

    var rpFromBoth = CsArea.resolveSelection(doc,
        [rpBoundary.getId(), rpFillIds[0], rpFillIds[1]]);
    eqs(rpFromBoth.length, 1,
        "CsArea.resolveSelection: the boundary plus two of its own " +
        "fill elements still dedupe to ONE area, not three");

    ok(CsArea.resolveSelection(doc, [999999999]).length === 0,
        "CsArea.resolveSelection: an id that is not in the document " +
        "resolves to nothing, not a crash");

    // -------------------------------------------------------------
    // The repattern itself: SAND -> CLAY, keeping the seed.
    // -------------------------------------------------------------

    var rpResult = CsArea.repattern(doc, di, [rpBoundary.getId()], "CLAY");
    eqs(rpResult.ok, true,
        "CsArea.repattern: repatterning by the boundary id succeeds");
    eqs(rpResult.count, 1, "CsArea.repattern: one area was repatterned");
    eqs(CsTags.get(reQ(rpBoundary), CsArea.PATTERN_KEY), "CLAY",
        "CsArea.repattern: AreaPattern is now the new key");
    eqs(CsTags.get(reQ(rpBoundary), CsArea.SEED_KEY), rpSeedBefore,
        "CsArea.repattern: AreaSeed is UNCHANGED -- the ground did not " +
        "move, only the symbols covering it (acceptance criterion)");

    var rpFillAfter = CsArea.ownedBy(doc, rpMade.id);
    ok(rpFillAfter.length > 0,
        "CsArea.repattern: the fill was actually rebuilt, not just " +
        "the tag");
    var rpWrongLayer = 0;
    for (var rfi = 0; rfi < rpFillAfter.length; rfi++) {
        var rref = doc.queryEntity(rpFillAfter[rfi]);
        if (!isNull(rref) &&
                doc.getLayerName(rref.getLayerId()) !==
                CsArea.CATALOG.CLAY.layer) {
            rpWrongLayer++;
        }
    }
    eqs(rpWrongLayer, 0,
        "CsArea.repattern: every rebuilt element landed on CLAY's own " +
        "layer, not SAND's");

    // -------------------------------------------------------------
    // Repatterning again by the FILL id -- the path a beginner who
    // clicked the drawn texture actually takes -- CLAY -> SAND, via
    // resolveSelection feeding straight into repattern, exactly as
    // AreaFill.connectTile's own click handler chains them.
    // -------------------------------------------------------------

    var rpFillId2 = CsArea.ownedBy(doc, rpMade.id)[0];
    var rpBoundaryIds2 = CsArea.resolveSelection(doc, [rpFillId2]);
    var rpResultByFill = CsArea.repattern(doc, di, rpBoundaryIds2, "SAND");
    eqs(rpResultByFill.ok, true,
        "CsArea.repattern: repatterning resolved FROM a selected FILL " +
        "id succeeds (acceptance criterion)");
    eqs(CsTags.get(reQ(rpBoundary), CsArea.PATTERN_KEY), "SAND",
        "CsArea.repattern: ... and AreaPattern really did change back");

    // -------------------------------------------------------------
    // Scale and Density apply to a selected area through the same call
    // -- no separate write path for the panel's boxes.
    // -------------------------------------------------------------

    var rpScaleResult = CsArea.repattern(doc, di, [rpBoundary.getId()],
        "SAND", { scale: 2.5, density: 3.0 });
    eqs(rpScaleResult.ok, true,
        "CsArea.repattern: a repattern carrying scale/density succeeds");
    eqs(CsTags.get(reQ(rpBoundary), CsArea.SCALE_KEY), "2.5",
        "CsArea.repattern: AreaScale was written from opts.scale");
    eqs(CsTags.get(reQ(rpBoundary), CsArea.DENSITY_KEY), "3",
        "CsArea.repattern: AreaDensity was written from opts.density");
})();

// =======================================================================
// One selection, several areas, ONE undo step -- acceptance criterion.
// Two areas repatterned together must both change AND both roll back
// together on a single group undo, the same AreaSync.run idiom already
// proven for regenerate()+sweep()+adopt().
// =======================================================================

(function repatterningSeveralAreasIsOneUndoStep() {
    var mrCx1 = lstCx + 2100, mrCy1 = lstCy;
    var mrCx2 = lstCx + 2200, mrCy2 = lstCy;
    var mr1 = AreaFillRun.commit(doc, di, squareStroke(mrCx1, mrCy1, 5),
        "SAND", { scale: 1.0, density: 1.0 });
    var mr2 = AreaFillRun.commit(doc, di, squareStroke(mrCx2, mrCy2, 5),
        "SAND", { scale: 1.0, density: 1.0 });
    ok(mr1.ok === true && mr2.ok === true,
        "multi-repattern fixture: both SAND strokes succeed");
    var mrB1 = afBoundaryFor(mr1.id), mrB2 = afBoundaryFor(mr2.id);

    var mrGroupBefore = doc.getTransactionGroup();
    var mrResult = CsArea.repattern(doc, di,
        [mrB1.getId(), mrB2.getId()], "CLAY");
    eqs(mrResult.ok, true, "CsArea.repattern: the batch of two succeeds");
    eqs(mrResult.count, 2,
        "CsArea.repattern: both areas were repatterned");
    eqs(CsTags.get(reQ(mrB1), CsArea.PATTERN_KEY), "CLAY",
        "CsArea.repattern: the first area really changed");
    eqs(CsTags.get(reQ(mrB2), CsArea.PATTERN_KEY), "CLAY",
        "CsArea.repattern: the second area really changed");

    // ONE undo step: undoing once must put BOTH boundaries back to
    // SAND, not just the last one written.
    di.undo();
    eqs(CsTags.get(doc.queryEntity(mrB1.getId()), CsArea.PATTERN_KEY),
        "SAND",
        "CsArea.repattern: ONE undo restores the FIRST area's pattern " +
        "(acceptance criterion: one undo step for the whole batch)");
    eqs(CsTags.get(doc.queryEntity(mrB2.getId()), CsArea.PATTERN_KEY),
        "SAND",
        "CsArea.repattern: ... and the SECOND area's, in the same undo");
    di.redo();
    eqs(CsTags.get(doc.queryEntity(mrB1.getId()), CsArea.PATTERN_KEY),
        "CLAY",
        "CsArea.repattern: redo brings both back to CLAY together");
    eqs(CsTags.get(doc.queryEntity(mrB2.getId()), CsArea.PATTERN_KEY),
        "CLAY", "CsArea.repattern: ... both, not just one");
})();

// =======================================================================
// CsArea.repattern is picky about what it touches: a mixed selection
// (a real area plus something that is not one) still repatterns the
// real one, and an all-invalid selection reports failure without
// applying any operation at all.
// =======================================================================

(function repatternSkipsWhatIsNotAnArea() {
    var mxCx = lstCx + 2300, mxCy = lstCy;
    var mxMade = AreaFillRun.commit(doc, di, squareStroke(mxCx, mxCy, 5),
        "SAND", { scale: 1.0, density: 1.0 });
    ok(mxMade.ok === true, "mixed-selection fixture: the stroke succeeds");
    var mxBoundary = afBoundaryFor(mxMade.id);

    var mxLine = new RLineEntity(doc, new RLineData(
        new RVector(0, 0), new RVector(1, 1)));
    var mxLineOp = new RAddObjectsOperation();
    mxLineOp.addObject(mxLine, false);
    di.applyOperation(mxLineOp);

    var mxResult = CsArea.repattern(doc, di,
        [mxBoundary.getId(), mxLine.getId()], "CLAY");
    eqs(mxResult.ok, true,
        "CsArea.repattern: a mixed selection still succeeds for the " +
        "part that IS an area");
    eqs(mxResult.count, 1,
        "CsArea.repattern: only the real area was counted");
    eqs(CsTags.get(reQ(mxBoundary), CsArea.PATTERN_KEY), "CLAY",
        "CsArea.repattern: ... and it really was repatterned");

    var mxAllInvalid = CsArea.repattern(doc, di, [mxLine.getId()], "CLAY");
    eqs(mxAllInvalid.ok, false,
        "CsArea.repattern: a selection with nothing that is an area " +
        "reports failure rather than a hollow success");
    eqs(mxAllInvalid.count, 0,
        "CsArea.repattern: ... and touched zero areas");

    eqs(CsArea.repattern(doc, di, [], "CLAY").ok, false,
        "CsArea.repattern: an empty id list is refused outright");
    eqs(CsArea.repattern(doc, di, [mxBoundary.getId()], "NO_SUCH_KEY").ok,
        false,
        "CsArea.repattern: an unknown pattern key is refused outright");
})();

// =======================================================================
// The "this is going to draw a lot" guard (2026-09-12). Measured live:
// a radius-25 SAND circle at the catalog's default density places 2315
// block references with no warning. AreaFillRun.commit now estimates
// the count from the polygon area alone (CsArea.estimateCount, the same
// formula CsArea.scatterPlacements uses for its own `want`) BEFORE
// building anything, and refuses to draw over
// AreaFillRun.WARN_ELEMENT_THRESHOLD unless opts.confirmed is true.
// =======================================================================

(function bigFillWarnsBeforeDrawing() {
    // A big enough circle of SAND (density 120) to clear the threshold
    // by a wide margin, echoing the radius-25 measurement in this
    // file's own header and AreaFillRun.WARN_ELEMENT_THRESHOLD's.
    var bfRadius = 25;
    var bfCx = lstCx + 3000, bfCy = lstCy;
    var bfPoints = [];
    var bfSegments = 40;
    for (var bi = 0; bi <= bfSegments; bi++) {
        var bang = (bi / bfSegments) * 2 * Math.PI;
        bfPoints.push({ x: bfCx + bfRadius * Math.cos(bang),
            y: bfCy + bfRadius * Math.sin(bang) });
    }

    var bfEntitiesBefore = doc.queryAllEntities(false, true).length;
    var bfDeclined = AreaFillRun.commit(doc, di, bfPoints, "SAND",
        { scale: 1.0, density: 1.0 });

    eqs(bfDeclined.ok, false,
        "AreaFillRun.commit: an unconfirmed big fill is refused, not " +
        "drawn");
    eqs(bfDeclined.warn, true,
        "AreaFillRun.commit: ... and flagged specifically as a WARNING, " +
        "not an ordinary refusal");
    ok(bfDeclined.estimate > AreaFillRun.WARN_ELEMENT_THRESHOLD,
        "AreaFillRun.commit: the estimate it hands back is really over " +
        "the threshold (" + bfDeclined.estimate + ")");
    // The measured pain point was 2315 for almost exactly this shape
    // (radius 25, default SAND density) -- the estimate should land in
    // the same neighbourhood, not an order of magnitude off.
    ok(Math.abs(bfDeclined.estimate - 2315) < 400,
        "AreaFillRun.commit: the estimate is close to the measured " +
        "real-world count for this exact shape -- got " +
        bfDeclined.estimate);
    ok(bfDeclined.suggestedDensity > 0 &&
        bfDeclined.suggestedDensity < 1.0,
        "AreaFillRun.commit: a suggested (thinned) density is offered, " +
        "below the density that triggered the warning -- got " +
        bfDeclined.suggestedDensity);

    eqs(doc.queryAllEntities(false, true).length, bfEntitiesBefore,
        "AreaFillRun.commit: DECLINING (never confirming) leaves the " +
        "drawing COMPLETELY unchanged -- not one entity was added " +
        "(acceptance criterion)");

    // Confirming draws it -- and the real count should land close to
    // the estimate that was offered.
    var bfConfirmed = AreaFillRun.commit(doc, di, bfPoints, "SAND",
        { scale: 1.0, density: 1.0, confirmed: true });
    ok(bfConfirmed.ok === true,
        "AreaFillRun.commit: confirmed:true draws the same big fill (" +
        bfConfirmed.reason + ")");
    var bfRatio = bfConfirmed.count / bfDeclined.estimate;
    ok(bfRatio > 0.5 && bfRatio < 1.5,
        "AreaFillRun.commit: the ESTIMATE is close to what actually " +
        "got placed -- estimate " + bfDeclined.estimate + ", actual " +
        bfConfirmed.count + " (acceptance criterion)");

    // Thinning to the suggested density actually reduces the count,
    // and by roughly the ratio suggestedDensityMul promised.
    var bfCx2 = lstCx + 3100, bfCy2 = lstCy;
    var bfPoints2 = [];
    for (var bj = 0; bj <= bfSegments; bj++) {
        var bang2 = (bj / bfSegments) * 2 * Math.PI;
        bfPoints2.push({ x: bfCx2 + bfRadius * Math.cos(bang2),
            y: bfCy2 + bfRadius * Math.sin(bang2) });
    }
    var bfThinned = AreaFillRun.commit(doc, di, bfPoints2, "SAND",
        { scale: 1.0, density: bfDeclined.suggestedDensity,
          confirmed: true });
    ok(bfThinned.ok === true,
        "AreaFillRun.commit: drawing at the suggested density succeeds");
    ok(bfThinned.count < bfConfirmed.count,
        "AreaFillRun.commit: the thinned fill places noticeably fewer " +
        "elements than the unthinned one -- " + bfThinned.count +
        " vs " + bfConfirmed.count);
})();

// =======================================================================
// CsArea.estimateCount / CsArea.suggestedDensityMul, pure -- no doc, no
// op, exactly the shape a caller with only a polygon area and a catalog
// entry has in hand before anything is built.
// =======================================================================

(function estimateAndSuggestAreUnitTestable() {
    eqs(CsArea.estimateCount(1963.5, CsArea.CATALOG.SAND, 1.0), 2356,
        "CsArea.estimateCount: matches CsArea.scatterPlacements' own " +
        "`want` formula exactly (area/100 * density * densityMul, " +
        "rounded)");
    eqs(CsArea.estimateCount(1963.5, CsArea.CATALOG.WATER, 1.0), 0,
        "CsArea.estimateCount: a FILLED pattern (a hatch, one entity " +
        "regardless of size) estimates zero -- nothing to warn about");
    eqs(CsArea.estimateCount(1963.5, CsArea.CATALOG.BEDROCK, 1.0), 0,
        "CsArea.estimateCount: BEDROCK (no pattern at all) is zero too");
    eqs(CsArea.estimateCount(0, CsArea.CATALOG.SAND, 1.0), 0,
        "CsArea.estimateCount: zero area is zero elements, not NaN or " +
        "negative");

    var esSuggested = CsArea.suggestedDensityMul(1.0, 2356, 1500);
    ok(esSuggested > 0 && esSuggested < 1.0,
        "CsArea.suggestedDensityMul: thins DOWN when the estimate is " +
        "over target -- got " + esSuggested);
    var esNewEstimate = Math.round(1963.5 / 100 * CsArea.CATALOG.SAND.density *
        esSuggested);
    ok(esNewEstimate <= 1600,
        "CsArea.suggestedDensityMul: applying the suggested density " +
        "actually brings the estimate down near the target -- got " +
        esNewEstimate);
    eqs(CsArea.suggestedDensityMul(1.0, 500, 1500), 1.0,
        "CsArea.suggestedDensityMul: an estimate already under target " +
        "is left alone -- never suggests RAISING the density");
    eqs(CsArea.suggestedDensityMul(1.0, 5000, 1500) >= 0.1, true,
        "CsArea.suggestedDensityMul: never suggests below the panel's " +
        "own Density box floor (0.1)");
})();

// =======================================================================
// AreaFillEdit -- Task 11. A caver draws one element, names it, picks a
// placement rule, and it joins the Areas palette permanently, in their
// OWN library -- the round trip, and the fill it makes possible.
// =======================================================================

(function customAreaPattern() {
    var tmpLibDir = QDir.tempPath() + "/cs_area_fill_edit_test";
    new QDir().mkpath(tmpLibDir);
    var tmpLibrary = tmpLibDir + "/CaveCustomSymbols.dxf";
    if (new QFileInfo(tmpLibrary).exists()) {
        new QFile(tmpLibrary).remove();
    }

    // RESTORED, not blanked -- a test that clobbers a real setting with
    // "" and calls that clean is gambling that nobody had one. Reading
    // it first and putting the SAME value back is the only way this can
    // never leave a caver's own CaveSurvey/SymbolLibrary different than
    // it found it.
    var originalLibSetting = RSettings.getStringValue(
        "CaveSurvey/SymbolLibrary", "");
    RSettings.setValue("CaveSurvey/SymbolLibrary", tmpLibrary);

    try {
        var editorDoc = new RDocument(new RMemoryStorage(),
            createSpatialIndex());
        var elementEntities = [
            new RLineEntity(editorDoc, new RLineData(
                new RVector(-0.3, -0.3), new RVector(0.3, 0.3))),
            new RLineEntity(editorDoc, new RLineData(
                new RVector(-0.3, 0.3), new RVector(0.3, -0.3)))
        ];
        var meta = { name: "Popcorn", layer: "FORMATIONS-MOONMILK-POPCORN",
            placement: "scatter", density: 30, scaleMin: 0.8, scaleMax: 1.2,
            rotate: true,
            help: "Small white nodules on the wall -- a caver's own " +
                "description, not one of CsArea.CATALOG's built-in ones." };
        var saved = AreaFillEdit.savePattern(editorDoc, elementEntities,
            meta);
        ok(saved.ok, "AreaFillEdit.savePattern: the pattern is written (" +
            (isNull(saved.error) ? "" : saved.error) + ")");
        eqs(saved.block, "AREA_POPCORN",
            "AreaFillEdit.savePattern: the block name derived from the " +
            "display name");
        eqs(saved.key, "POPCORN",
            "AreaFillEdit.savePattern: the catalog key it joins " +
            "CsArea.merged() under");
        ok(new QFileInfo(tmpLibrary).exists(),
            "AreaFillEdit.savePattern: written into the TEMP library, " +
            "not the caver's real one");

        CsSymbolStore.invalidate(tmpLibrary);
        var merged = CsArea.merged();
        ok(!isNull(merged[saved.key]),
            "CsArea.merged: a saved pattern joins the catalog");
        eqs(merged[saved.key].layer, "FORMATIONS-MOONMILK-POPCORN",
            "CsArea.merged: it remembers its home layer");
        eqs(merged[saved.key].engine, "scatter",
            "CsArea.merged: it remembers its placement rule");
        eqs(merged[saved.key].help, meta.help,
            "CsArea.merged: a custom pattern's AreaHelp comes back as " +
            "the entry's `help` field, the SAME field a built-in's " +
            "own tooltip and the legend both read");
        ok(!isNull(CsArea.CATALOG.SAND),
            "CsArea.merged: a custom pattern does not displace a built-in");
        eqs(merged.SAND.layer, CsArea.CATALOG.SAND.layer,
            "CsArea.merged: ... and the built-in SAND entry is untouched " +
            "by the merge");

        // ---------------------------------------------------------------
        // The prefix guard, from BOTH sides. saveBlock must refuse an
        // AREA_ name -- accepting it would write SYMBOL marker tags onto
        // a pattern block, making it invisible to both list() (SYM_-only)
        // and customAreaPatterns() (needs an AreaCustom marker): an
        // orphan neither palette could see or delete. This IS the bug a
        // review caught in this task's first draft, so it is pinned here.
        // ---------------------------------------------------------------

        var wrongPathSave = CsSymbolStore.saveBlock(null, saved.block,
            editorDoc, elementEntities,
            { nss: "x", uis: "", category: "Custom",
              layer: CsLayers.BREAKDOWN });
        eqs(wrongPathSave.ok, false,
            "CsSymbolStore.saveBlock: an AREA_ name is refused, not " +
            "silently accepted as an alternate prefix");

        // ---------------------------------------------------------------
        // A slug collision between two DIFFERENT custom patterns must be
        // refused, not silently treated as an edit. "Popcorn" and
        // "popcorn" differ only in case but slug to the SAME key/block
        // name -- without the guard, this second save would report
        // success and quietly overwrite the first caver's geometry.
        // ---------------------------------------------------------------

        var collideMeta = { name: "popcorn",
            layer: "FORMATIONS-MOONMILK-POPCORN", placement: "scatter",
            density: 10, scaleMin: 0.9, scaleMax: 1.1, rotate: false };
        var collideEntities = [ new RLineEntity(editorDoc, new RLineData(
            new RVector(0, 0), new RVector(0.1, 0.1))) ];
        var collided = AreaFillEdit.savePattern(editorDoc, collideEntities,
            collideMeta);
        eqs(collided.ok, false,
            "AreaFillEdit.savePattern: a different display name that " +
            "slugs to an EXISTING custom pattern's key is refused, not " +
            "silently overwritten");

        CsSymbolStore.invalidate(tmpLibrary);
        var afterCollision = CsArea.merged();
        eqs(afterCollision[saved.key].name, "Popcorn",
            "AreaFillEdit.savePattern: the refused save left the " +
            "original pattern's name intact");

        // ---------------------------------------------------------------
        // An empty description is a valid pattern, not a refusal -- a
        // caver who skips the "What is it?" field entirely (help is
        // undefined, the same as a panel that was never touched) must
        // still be able to save, and CsArea.merged still has to hand
        // back SOMETHING tipHtml-safe rather than null/undefined.
        // ---------------------------------------------------------------

        var blankMeta = { name: "Rimwash",
            layer: "FORMATIONS-MOONMILK-POPCORN", placement: "scatter",
            density: 20, scaleMin: 0.8, scaleMax: 1.2, rotate: true };
        var blankEntities = [ new RLineEntity(editorDoc, new RLineData(
            new RVector(0, 0), new RVector(0.2, 0.2))) ];
        var blankSaved = AreaFillEdit.savePattern(editorDoc, blankEntities,
            blankMeta);
        ok(blankSaved.ok, "AreaFillEdit.savePattern: a pattern with no " +
            "`help` at all still saves (" +
            (isNull(blankSaved.error) ? "" : blankSaved.error) + ")");

        CsSymbolStore.invalidate(tmpLibrary);
        var mergedBlank = CsArea.merged();
        eqs(mergedBlank[blankSaved.key].help, "",
            "CsArea.merged: a pattern saved with no description comes " +
            "back with an empty `help`, not null or undefined");

        // ---------------------------------------------------------------
        // THE CLAIM A CAVER CARES ABOUT, beyond the round trip: the saved
        // pattern actually FILLS. A fresh document that has never seen
        // AREA_POPCORN must still succeed -- the block is imported from
        // the library first.
        // ---------------------------------------------------------------

        var placeDoc = new RDocument(new RMemoryStorage(),
            createSpatialIndex());
        var placeDi = new RDocumentInterface(placeDoc);
        CsLayers.ensureSurveyLayers(placeDoc, placeDi);
        CsLayers.ensure(placeDoc, placeDi, merged[saved.key].layer);
        ok(isNull(placeDoc.queryBlock(saved.block)),
            "fixture: the fresh drawing starts without the custom " +
            "pattern's block");

        var square = new RPolyline();
        square.appendVertex(new RVector(0, 0));
        square.appendVertex(new RVector(20, 0));
        square.appendVertex(new RVector(20, 20));
        square.appendVertex(new RVector(0, 20));
        square.setClosed(true);
        var boundary = new RPolylineEntity(placeDoc, new RPolylineData(square));
        boundary.setLayerId(placeDoc.getLayerId("CTRL-AREA-BOUNDARY"));
        var bOp = new RAddObjectsOperation();
        bOp.addObject(boundary, false);
        placeDi.applyOperation(bOp);

        var fillOp = new RAddObjectsOperation();
        var placed = CsArea.build(placeDoc, fillOp, boundary,
            merged[saved.key],
            { id: "popcorn-test", seed: 11, scale: 1.0, density: 1.0,
              layer: merged[saved.key].layer }, placeDi);
        placeDi.applyOperation(fillOp);

        ok(placed.ok === true,
            "CsArea.build: the custom pattern fills a boundary in a " +
            "drawing that never saw its block (" + placed.reason + ")");
        ok(placed.count > 0,
            "CsArea.build: and actually placed elements");
        ok(!isNull(placeDoc.queryBlock(saved.block)),
            "CsArea.build: ... because the block was imported first");
        eqs(CsArea.countOwned(placeDoc, "popcorn-test"), placed.count,
            "CsArea.build: every placed element is tagged with its owner");

        // ---------------------------------------------------------------
        // A REGENERATE -- the listener's own path -- must never import a
        // missing custom block on its own. Importing stays where a
        // caver actually initiated the write (the interactive stroke
        // above, or Task 12's Sync Areas); a rebuild that finds its
        // block missing reports failure and leaves the fill empty,
        // exactly as it already does for a missing BUILT-IN block.
        // ---------------------------------------------------------------

        var regenDoc = new RDocument(new RMemoryStorage(),
            createSpatialIndex());
        var regenDi = new RDocumentInterface(regenDoc);
        CsLayers.ensureSurveyLayers(regenDoc, regenDi);
        CsLayers.ensure(regenDoc, regenDi, merged[saved.key].layer);
        CsLayers.ensure(regenDoc, regenDi, "CTRL-AREA-BOUNDARY");
        ok(isNull(regenDoc.queryBlock(saved.block)),
            "fixture: this second fresh drawing also starts without the " +
            "pattern's block");

        var regenSquare = new RPolyline();
        regenSquare.appendVertex(new RVector(0, 0));
        regenSquare.appendVertex(new RVector(20, 0));
        regenSquare.appendVertex(new RVector(20, 20));
        regenSquare.appendVertex(new RVector(0, 20));
        regenSquare.setClosed(true);
        var regenBoundary = new RPolylineEntity(regenDoc,
            new RPolylineData(regenSquare));
        regenBoundary.setLayerId(regenDoc.getLayerId("CTRL-AREA-BOUNDARY"));
        CsTags.set(regenBoundary, CsArea.ID_KEY, "popcorn-regen");
        CsTags.set(regenBoundary, CsArea.PATTERN_KEY, saved.key);
        CsTags.set(regenBoundary, CsArea.SEED_KEY, "11");
        CsTags.set(regenBoundary, CsArea.SCALE_KEY, "1.0");
        CsTags.set(regenBoundary, CsArea.DENSITY_KEY, "1.0");
        var regenOp = new RAddObjectsOperation();
        regenOp.addObject(regenBoundary, false);
        regenDi.applyOperation(regenOp);

        var regenResult = CsArea.regenerate(regenDoc, regenDi,
            regenBoundary.getId());
        ok(regenResult.indexOf("failed:") === 0,
            "CsArea.regenerate: a custom pattern's missing block is a " +
            "FAILURE from this path, not a silent import (" +
            regenResult + ")");
        ok(isNull(regenDoc.queryBlock(saved.block)),
            "CsArea.regenerate: ... and the block was never imported -- " +
            "a rebuild must not reach into the library from inside a " +
            "transaction callback");
        eqs(CsArea.countOwned(regenDoc, "popcorn-regen"), 0,
            "CsArea.regenerate: no fill was built either");

        // ---------------------------------------------------------------
        // DELETE: removes the block from the library only. The drawing
        // above, already using the pattern, is untouched.
        // ---------------------------------------------------------------

        var del = CsSymbolStore.deleteAreaPattern(null, saved.block);
        ok(del.ok, "CsSymbolStore.deleteAreaPattern: the pattern deletes " +
            "from the library (" + del.error + ")");
        ok(!isNull(placeDoc.queryBlock(saved.block)),
            "CsSymbolStore.deleteAreaPattern: a drawing already using " +
            "the pattern keeps its own copy of the block");

        CsSymbolStore.invalidate(tmpLibrary);
        var afterDelete = CsArea.merged();
        ok(isNull(afterDelete[saved.key]),
            "CsSymbolStore.deleteAreaPattern: the pattern is gone from " +
            "the catalog after a delete");

        // ---------------------------------------------------------------
        // The widened prefix guard, from the caller's own side: neither
        // save path accepts a name with neither SYM_ nor AREA_.
        // ---------------------------------------------------------------

        var rogue = CsSymbolStore.saveAreaPattern(null, "ROGUE_NOPE",
            editorDoc, elementEntities, meta);
        eqs(rogue.ok, false,
            "CsSymbolStore.saveAreaPattern: a block name with neither " +
            "known prefix is refused");
    } finally {
        RSettings.setValue("CaveSurvey/SymbolLibrary", originalLibSetting);
        CsSymbolStore.invalidate();
        if (new QFileInfo(tmpLibrary).exists()) {
            new QFile(tmpLibrary).remove();
        }
        try {
            new QDir().rmdir(tmpLibDir);
        } catch (eRmDir) {
        }
    }
})();

// =======================================================================
// AreaFillEdit.sessionAlive / blockedByOpenSession -- Task 11's fix for
// a closed editor tab wedging the panel. A caver who closes the editor
// window directly (not through Cancel) must not find every later
// New Area Pattern.../Edit refused for the rest of the session with no
// reachable Cancel to get out of it. No real MDI window is created here
// -- these are plain fakes standing in for a live and a destroyed Qt
// wrapper, which is exactly the distinction sessionAlive draws.
// =======================================================================

(function closedTabDoesNotWedgeTheEditor() {
    // A "dead" session: touching it throws, the same way a destroyed
    // Qt wrapper does in this build ("wrapped is NULL", measured
    // elsewhere in this suite whenever a C++-side object outlives its
    // JS wrapper's usefulness).
    AreaFillEdit.session = { block: null, entry: null,
        child: { windowTitle: "Pattern: Popcorn" },
        di: { getDocument: function() {
            throw new Error("wrapped is NULL"); } } };
    ok(AreaFillEdit.isEditing(),
        "fixture: the session looks open before the check runs");
    eqs(AreaFillEdit.sessionAlive(), false,
        "AreaFillEdit.sessionAlive: a session whose document throws on " +
        "access reads as gone");
    eqs(AreaFillEdit.blockedByOpenSession(), false,
        "AreaFillEdit.blockedByOpenSession: a dead session does not " +
        "block a new one from starting");
    eqs(AreaFillEdit.session, null,
        "AreaFillEdit.blockedByOpenSession: ... and clears the stale " +
        "session as a side effect -- the wedge, turned into a no-op");

    // A LIVE session still blocks, exactly as before this fix.
    var live = { block: null, entry: null,
        child: { windowTitle: "Pattern: Popcorn" },
        di: { getDocument: function() { return {}; } } };
    AreaFillEdit.session = live;
    eqs(AreaFillEdit.blockedByOpenSession(), true,
        "AreaFillEdit.blockedByOpenSession: a genuinely open session " +
        "still blocks a new one");
    eqs(AreaFillEdit.session, live,
        "AreaFillEdit.blockedByOpenSession: ... and is left alone while " +
        "it is still alive, not cleared out from under the caver");
    AreaFillEdit.session = null;

    // No session at all: neither blocks nor throws.
    eqs(AreaFillEdit.blockedByOpenSession(), false,
        "AreaFillEdit.blockedByOpenSession: no session at all is simply " +
        "not blocked");
})();

var out;
if (failures.length === 0) {
    out = "### AREA FILL OK";
} else {
    out = "### AREA FILL FAIL " + failures.length + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
