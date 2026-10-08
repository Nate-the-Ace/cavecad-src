// trip_stamp_run.js -- traced linework says which trip drew it.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/trip_stamp_run.js "$PWD"
//
// Prints "### TRIP STAMP OK <n>" or "### TRIP STAMP FAIL".
//
// The revision framework's premise is that a drawing can be revised one
// TRIP at a time. Legs and splays have carried a numeric Trip since
// schema v3; hand-traced walls carried nothing, so a revision could not
// tell which trip drew a wall and had to move all of them or none.
//
// What only a real RDocument can prove:
//
//   - a wall traced beside trip 1's stations is stamped Trip 1, and one
//     traced beside trip 0's is stamped Trip 0 -- REALLY written, not
//     dropped by CsTags.set's own early return on empty values, which
//     is what a zero-that-means-something has to survive;
//   - a stroke that GROWS an existing wall leaves that wall's trip
//     alone. Adding six feet to a wall in 2027 does not make the 2027
//     trip its author;
//   - a drawing with no survey in it stamps NOTHING -- not trip 0. A
//     plausible zero standing in for a missing reading is the
//     elevation-datum mistake in another costume;
//   - the station -> trip map is read off the SHOT LINES. Station points
//     carry a Trip tag on trip ANCHORS only, so an anchor-based map
//     would answer for one station per trip and null for the rest.

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

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/FeatureTrace";
include(includeBasePath + "/FeatureTraceRun.js");
include(includeBasePath + "/FeatureTrace.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ShapedLines";
include(includeBasePath + "/ShapedLinesRun.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/SymbolPalette";
include(includeBasePath + "/SymbolPaletteRun.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

// ---------------------------------------------------------------------
// Fixture: two trips, drawn for real.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc, trip) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.trip = trip || 0;
    return s;
}

var survey = CsModel.newSurvey();
survey.caveName = "TRIP STAMP CAVE";
survey.distanceUnit = "ft";
survey.trips = [CsModel.newTrip(), CsModel.newTrip()];
survey.trips[0].date = "2026-08-01";
survey.trips[0].team = "NDS";
survey.trips[1].date = "2026-08-08";
survey.trips[1].team = "NDS, RM";
// Trip 0 walks EAST from the entrance; trip 1 carries on NORTH, so the
// two trips' stations are far apart on the sheet and "nearest station"
// has an unambiguous answer at each end.
survey.shots.push(shotOf("ENT", "A1", 50.0, 90.0, 0.0, 0));
survey.shots.push(shotOf("A1", "A2", 50.0, 90.0, 0.0, 0));
survey.shots.push(shotOf("A2", "B1", 100.0, 0.0, 0.0, 1));
survey.shots.push(shotOf("B1", "B2", 100.0, 0.0, 0.0, 1));

CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

var at = {};
var stations = CsTags.collectStations(doc);
for (var si = 0; si < stations.length; si++) {
    at[stations[si].name] = stations[si].pos;
}
ok(stations.length >= 5, "the fixture drew its five stations");

// ---------------------------------------------------------------------
// The station -> trip map, read off the shot lines.
// ---------------------------------------------------------------------

var byStation = CsTrace.tripByStation(doc);
eqs(byStation["ENT"], 0, "the entrance belongs to trip 0");
eqs(byStation["A2"], 0, "a station trip 0 REACHED stays trip 0's, even " +
    "though trip 1 set off from it");
eqs(byStation["B1"], 1, "the first station trip 1 reached is trip 1's");
eqs(byStation["B2"], 1, "and so is the next one");
eqs(byStation["NOT-A-STATION"], undefined,
    "a name the drawing never surveyed maps to nothing");

// ---------------------------------------------------------------------
// A traced wall carries the trip whose passage it describes.
// ---------------------------------------------------------------------

FeatureTrace.target = CsLayers.WALLS_SURVEYED;

function trace(points, shift) {
    var action = {
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: points,
        region: null,
        bays: [],
        extendForced: (shift === true),
        refreshRegion: FeatureTraceRun.prototype.refreshRegion,
        extendTarget: FeatureTraceRun.prototype.extendTarget,
        stampSection: FeatureTraceRun.prototype.stampSection,
        warnUnclaimedProfile: FeatureTraceRun.prototype.warnUnclaimedProfile
    };
    action.refreshRegion();
    FeatureTraceRun.prototype.commit.call(action);
}

function walls() {
    if (!doc.hasLayer(CsLayers.WALLS_SURVEYED)) {
        return [];
    }
    return doc.queryLayerEntities(doc.getLayerId(CsLayers.WALLS_SURVEYED),
        true);
}

/** A stroke running alongside a leg, offset clear of it. */
function beside(a, b, offset, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        out.push({
            x: a.x + (b.x - a.x) * t + offset,
            y: a.y + (b.y - a.y) * t + offset
        });
    }
    return out;
}

// Trip 1's passage: ENT -> A1 -> A2 ran east, B1/B2 run north from A2.
trace(beside(at["B1"], at["B2"], 5.0, 12));
var afterFirst = walls();
eqs(afterFirst.length, 1, "the stroke drew one wall");
var tripWall = afterFirst[0];
eqs(CsTags.get(doc.queryEntity(tripWall), CsTrace.TRIP_TAG), "1",
    "a wall traced beside trip 1's stations is stamped trip 1");

// Trip 0's passage, far away at the other end.
trace(beside(at["ENT"], at["A1"], -5.0, 12));
var afterSecond = walls();
eqs(afterSecond.length, 2, "the second stroke drew a second wall");
var zeroWall = null;
for (var wi = 0; wi < afterSecond.length; wi++) {
    if (afterSecond[wi] !== tripWall) {
        zeroWall = afterSecond[wi];
    }
}
eqs(CsTags.get(doc.queryEntity(zeroWall), CsTrace.TRIP_TAG), "0",
    "a wall traced beside trip 0's stations is stamped trip 0 -- a zero " +
        "that MEANS trip 0 and survives being written");

// ---------------------------------------------------------------------
// An extension keeps the trip the line already had.
// ---------------------------------------------------------------------

// The last stroke was the trip-0 wall, so carrying on from its end
// grows that wall. The continuation runs back towards trip 1's
// stations, which is precisely the stamp that must NOT be applied.
var grownFrom = doc.queryEntity(zeroWall);
var tail = grownFrom.getEndPoint();
trace(beside({ x: tail.x, y: tail.y },
    { x: at["B2"].x, y: at["B2"].y }, 0.0, 12));
eqs(walls().length, 2, "the continuation grew a wall rather than adding one");
eqs(CsTags.get(doc.queryEntity(zeroWall), CsTrace.TRIP_TAG), "0",
    "and the grown wall KEPT trip 0: adding to a wall does not " +
        "re-attribute it to whichever trip's ground the new stroke crossed");

// ---------------------------------------------------------------------
// No survey, no stamp -- and no trip 0 pretending to be one.
// ---------------------------------------------------------------------

var bare = new RDocument(new RMemoryStorage(), createSpatialIndex());
var bareDi = new RDocumentInterface(bare);
eqs(CsTrace.tripFor(bare, "plan",
    [{ x: 0, y: 0 }, { x: 10, y: 0 }], []), null,
    "a drawing with no survey in it names no trip");

function traceIn(d, dInt, points) {
    var action = {
        getDocument: function() { return d; },
        getDocumentInterface: function() { return dInt; },
        samples: points,
        region: null,
        bays: [],
        extendForced: false,
        refreshRegion: FeatureTraceRun.prototype.refreshRegion,
        extendTarget: FeatureTraceRun.prototype.extendTarget,
        stampSection: FeatureTraceRun.prototype.stampSection,
        warnUnclaimedProfile: FeatureTraceRun.prototype.warnUnclaimedProfile
    };
    action.refreshRegion();
    FeatureTraceRun.prototype.commit.call(action);
}

// The harder half of the same claim: a station the drawing DOES show,
// whose trip it cannot say -- a page traced from a scan whose legs were
// never entered, or linework beside a station whose shot line was
// deleted. Nearest-station finds an answer; the trip behind it is still
// unknown, and unknown must not decay into 0.
var lone = new RPointEntity(bare, new RPointData(new RVector(4, 0)));
CsTags.set(lone, "Station", "Z9");
var loneOp = new RAddObjectsOperation();
loneOp.addObject(lone, false);
bareDi.applyOperation(loneOp);
eqs(CsTrace.nearestStation(bare, [{ x: 0, y: 0 }], "plan") === null, false,
    "the lone station point is found by distance");
eqs(CsTrace.tripFor(bare, "plan", [{ x: 0, y: 0 }, { x: 10, y: 0 }], []),
    null,
    "a station whose trip the drawing cannot say names NO trip -- not 0");

var savedDoc = getDocument;
var savedDi = getDocumentInterface;
getDocument = function() { return bare; };
getDocumentInterface = function() { return bareDi; };
traceIn(bare, bareDi, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
getDocument = savedDoc;
getDocumentInterface = savedDi;

var bareWalls = bare.hasLayer(CsLayers.WALLS_SURVEYED) ?
    bare.queryLayerEntities(bare.getLayerId(CsLayers.WALLS_SURVEYED), true) :
    [];
eqs(bareWalls.length, 1, "the sketch-before-notes stroke still drew its wall");
eqs(CsTags.get(bare.queryEntity(bareWalls[0]), CsTrace.TRIP_TAG), "",
    "and carries NO trip tag -- not trip 0, which would claim the cave's " +
        "first trip drew it");

// ---------------------------------------------------------------------
// A section trace answers by its BAY's station, never by distance.
// ---------------------------------------------------------------------

// A bay parked far from every station in the cave, tagged as a section
// OF B1 -- which belongs to trip 1. Distance would say trip 0 or 1 by
// accident of where the bay was dropped; the bay's own station says 1.
var bay = {
    minX: 900, minY: 900, maxX: 1000, maxY: 1000,
    bay: "BAY-1", station: "B1"
};
var inBay = [{ x: 920, y: 920 }, { x: 950, y: 950 }, { x: 980, y: 960 }];
eqs(CsTrace.tripFor(doc, "section", inBay, [bay]), 1,
    "a section trace takes its trip from the station its bay is a " +
        "section of, not from whatever the bay was parked beside");

var untagged = { minX: 900, minY: 900, maxX: 1000, maxY: 1000,
    bay: "BAY-2", station: "" };
eqs(CsTrace.tripFor(doc, "section", inBay, [untagged]), null,
    "a bay with no station of its own names no trip");

// ---------------------------------------------------------------------
// A shaped line carries it on its SPINE, and its ornament does not.
// ---------------------------------------------------------------------

(function shapedCarriesItOnTheSpine() {
    var a = {
        styleKey: "floorledge",
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: beside(at["B1"], at["B2"], -6.0, 12),
        spinePts: null, spineClosed: false, side: 1, pathFrame: null,
        region: null, bays: [], growId: null, extendForced: false,
        refreshFrames: ShapedLinesRun.prototype.refreshFrames,
        prepare: ShapedLinesRun.prototype.prepare,
        buildSpine: ShapedLinesRun.prototype.buildSpine,
        extendTarget: ShapedLinesRun.prototype.extendTarget,
        growExisting: ShapedLinesRun.prototype.growExisting,
        commit: ShapedLinesRun.prototype.commit
    };
    a.refreshFrames();
    if (!a.prepare()) {
        ok(false, "the ledge stroke was accepted");
        return;
    }
    a.growId = a.extendTarget();
    a.commit();

    var spines = CsShapeLine.spines(doc);
    eqs(spines.length, 1, "the ledge stroke drew one spine");
    if (spines.length !== 1) {
        return;
    }
    eqs(CsTags.get(spines[0].entity, CsTrace.TRIP_TAG), "1",
        "the ledge's SPINE carries the trip of the passage it runs along");

    // The ornament is rebuilt from the spine on every change, so a copy
    // of the trip on each hachure would be a hundred stale copies the
    // moment the spine's trip was corrected.
    var decor = CsShapeLine.decorOf(doc, spines[0].id);
    ok(decor.length > 0, "fixture: the ledge has ornament");
    var stampedDecor = 0;
    for (var d = 0; d < decor.length; d++) {
        if (CsTags.get(decor[d], CsTrace.TRIP_TAG) !== "") {
            stampedDecor++;
        }
    }
    eqs(stampedDecor, 0, "and none of its ornament carries a trip of its " +
        "own -- the spine is the one place the answer lives");
})();

// ---------------------------------------------------------------------
// The other panel stamps the same tag. (The standing rule: a provenance
// tag Feature Trace writes and Symbol Palette does not is a drawing
// that answers "which trip" for its walls and shrugs at its formations.)
// ---------------------------------------------------------------------

(function symbolCarriesItToo() {
    // The block, made HERE rather than imported: ensureBlock finds a
    // block that is already in the drawing and fetches nothing, so this
    // needs no template file and says nothing about the import path,
    // which tests/symbol_palette_run.js already covers.
    CsLayers.ensure(doc, di, CsLayers.FORMATIONS_DRIP);
    var blockOp = new RAddObjectsOperation();
    blockOp.addObject(new RBlock(doc, "SYM_STALACTITE", new RVector(0, 0)),
        false);
    di.applyOperation(blockOp);
    var block = doc.queryBlock("SYM_STALACTITE");
    var shapeOp = new RAddObjectsOperation();
    var seg = new RLineEntity(doc, new RLineData(
        new RVector(-0.25, 0.5), new RVector(0, -0.5)));
    seg.setBlockId(block.getId());
    seg.setLayerId(doc.getLayerId(CsLayers.FORMATIONS_DRIP));
    shapeOp.addObject(seg, false);
    di.applyOperation(shapeOp);

    var entry = CsSymbols.byBlock("SYM_STALACTITE");
    ok(entry !== null, "the catalogue knows the symbol this test places");
    if (entry === null) {
        return;
    }
    SymbolPaletteRun.armedEntry = function() { return entry; };
    SymbolPaletteRun.sizeFeet = function() { return 1.0; };
    SymbolPaletteRun.defaultAngle = function() { return 0.0; };

    // Beside trip 1's stations, well clear of trip 0's.
    var action = new SymbolPaletteRun(null);
    action.getDocument = function() { return doc; };
    action.getDocumentInterface = function() { return di; };
    action.anchor = { x: at["B2"].x + 3, y: at["B2"].y + 3 };
    action.angle = 0.0;
    action.radius = CsSymbolStore.radiusOf(doc, entry.block);
    action.unitsPerFoot = SymbolPaletteRun.perFoot(doc);
    action.refreshRegion();
    action.commit();

    var placed = null;
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var pos = e.getPosition();
        if (Math.abs(pos.x - action.anchor.x) < 1e-6 &&
                Math.abs(pos.y - action.anchor.y) < 1e-6) {
            placed = e;
        }
    }
    ok(placed !== null, "the symbol was placed (messages: " +
        messages.join(" | ") + ")");
    if (placed !== null) {
        eqs(CsTags.get(placed, CsTrace.TRIP_TAG), "1",
            "and carries the trip of the passage it was placed in, by the " +
                "same rule and the same tag a traced wall carries");
    }
})();

// ---------------------------------------------------------------------
if (failures.length === 0) {
    print("### TRIP STAMP OK " + passed);
} else {
    for (var f = 0; f < failures.length; f++) {
        print("FAIL: " + failures[f]);
    }
    print("### TRIP STAMP FAIL");
}
