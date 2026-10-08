// surface_data_run.js -- CsSurfaceData against real documents.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/surface_data_run.js "$PWD"
//
// Prints "### SURFACE DATA OK <n>" or "### SURFACE DATA FAIL".
//
// CsSurfaceData.run is the merge of two former menu entries -- Aerial
// Basemap and Surface Contours -- which asked the same "where is the
// ground?" question and failed in two separately worded ways when
// nobody had answered it. What only a real RDocument proves here: a
// drawing with no geo anchor at all is refused ONCE, before either
// pass would reach for the network, and the refusal says where to fix
// that; an anchored drawing with both passes switched off is accepted
// and reports both as skipped without touching the network either.
//
// Deliberately NOT tested here: an anchored drawing with imagery or
// contours actually switched ON. Both passes fetch from a real tile
// service over the network, and a test suite must not depend on one
// being reachable. CsSurfaceData.basemap/contours' own request math
// (ground windows, Mercator bboxes, pixel sizing) lives in
// Core/CsGeoProject.js and is covered headlessly there instead.

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

// ---------------------------------------------------------------------
// Assertion harness -- the shape every engine suite here uses.
// ---------------------------------------------------------------------

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

// ---------------------------------------------------------------------
// Fixture 1: a drawing with no geo anchor at all -- no GeoLat/GeoLon on
// any station, and (deliberately) no station named A1 either, so
// CsSurfaceData.findAnchor's fallback chain has nothing to fall back
// to and the drawing really has "no location yet".
// ---------------------------------------------------------------------

var docBare = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diBare = new RDocumentInterface(docBare);
getDocument = function() { return docBare; };
getDocumentInterface = function() { return diBare; };

var bareSurvey = CsModel.newSurvey();
bareSurvey.caveName = "SURFACE DATA BARE";
bareSurvey.distanceUnit = "ft";
bareSurvey.shots.push(shotOf("ENT", "B1", 20.0, 90.0, 0.0));
CsDraw.survey(bareSurvey, CsNetwork.resolve(bareSurvey, {}));

// A drawing with no geo anchor: one refusal, before either pass does
// any network work, naming where to fix it.
var bare = CsSurfaceData.run(docBare, diBare, {});
ok(bare.ok === false, "no anchor is refused");
ok(bare.lines.length === 1, "the refusal is one line");
ok(bare.lines[0].indexOf("Declination") !== -1,
    "the refusal names where to set a location (Survey Notebook > Declination)");
ok(bare.lines[0].indexOf("A1") !== -1,
    "the refusal also names the entrance-station convention");

// ---------------------------------------------------------------------
// Fixture 2: an anchored drawing -- station A1 carries GeoLat/GeoLon,
// written the same way the standalone tools always wrote it (CsTags.
// commit; see CsSurfaceData.run's own "not yet anchored" branch).
// ---------------------------------------------------------------------

var docAnchored = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diAnchored = new RDocumentInterface(docAnchored);
getDocument = function() { return docAnchored; };
getDocumentInterface = function() { return diAnchored; };

var anchoredSurvey = CsModel.newSurvey();
anchoredSurvey.caveName = "SURFACE DATA ANCHORED";
anchoredSurvey.distanceUnit = "ft";
anchoredSurvey.shots.push(shotOf("ENT", "A1", 20.0, 90.0, 0.0));
CsDraw.survey(anchoredSurvey, CsNetwork.resolve(anchoredSurvey, {}));

var stations = CsTags.collectStations(docAnchored);
var a1 = null;
for (var i = 0; i < stations.length; i++) {
    if (stations[i].name === "A1") {
        a1 = stations[i].entity;
        break;
    }
}
ok(a1 !== null, "the fixture drawing has a station A1 to anchor on");
var a1Pos = a1.getPosition();
CsTags.commit(diAnchored, a1, {
    GeoLat: 37.0,
    GeoLon: -85.0,
    GeoStation: "A1",
    // pin WHERE the coordinate was declared, exactly as run() itself
    // does -- otherwise resolveMovedAnchor treats a pre-pin drawing as
    // needing its frame pinned "here" on every call.
    GeoDrawX: a1Pos.x,
    GeoDrawY: a1Pos.y
});

// Both passes off: reports both as skipped, and -- since the fixture
// truly is anchored -- reaches that report without ever touching
// CsLocationPick.ask (which would hang the headless engine waiting on
// a dialog it cannot show).
var skipped = CsSurfaceData.run(docAnchored, diAnchored,
    { imagery: false, contours: false });
ok(skipped.ok === true, "anchored drawing, both passes off, is accepted");
ok(skipped.lines.length === 2, "two passes, two report lines");
ok(skipped.lines.join(" ").split("skipped").length === 3,
    "both passes report skipped");

// ---------------------------------------------------------------------
// Fixture 3: both passes off on the BARE (unanchored) drawing -- since
// neither pass needs the network, the anchor is never even asked for,
// so this is accepted too rather than refused.
// ---------------------------------------------------------------------

getDocument = function() { return docBare; };
getDocumentInterface = function() { return diBare; };
var bothOffBare = CsSurfaceData.run(docBare, diBare,
    { imagery: false, contours: false });
ok(bothOffBare.ok === true,
    "an unanchored drawing with both passes off is accepted, not refused");
ok(bothOffBare.lines.join(" ").split("skipped").length === 3,
    "both passes report skipped on the unanchored drawing too");

// ---------------------------------------------------------------------
// Fixture 4: the DRAWN side, with no network at all. A grid is made
// here rather than fetched, so this exercises exactly what
// CsSurfaceData.drawContours does with one: the contours go inside
// CsContour.BLOCK, one reference carries them, and a re-run erases
// the previous set INCLUDING the block definition.
// ---------------------------------------------------------------------

getDocument = function() { return docAnchored; };
getDocumentInterface = function() { return diAnchored; };

// A ramp: elevation rises with the row, so every level crosses it.
var gw = 16, gh = 16;
var gvals = [];
for (var gr = 0; gr < gh; gr++) {
    for (var gc = 0; gc < gw; gc++) {
        gvals.push(300.0 + gr * 2.0);      // metres
    }
}
var gGrid = { values: gvals, width: gw, height: gh };
var gBbox = CsGeoProject.mercatorBbox(37.0, -85.0,
    { width: 400, height: 400 }, { x: 0, y: 0 });
// A POSITION WELL AWAY FROM THE ORIGIN, deliberately: the block's base
// point is the entrance, so an anchor at (0,0) would agree with a
// drawing origin by accident and prove nothing.
var gAnchor = { lat: 37.0, lon: -85.0, pos: { x: 120, y: -40 },
                name: "A1" };

function contourBlockRefs(doc) {
    var found = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getType() !== RS.EntityBlockRef) {
            continue;
        }
        if (CsTags.get(e, "SurfaceContours") === "1") {
            found.push(e);
        }
    }
    return found;
}

function looseContours(doc) {
    var n = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getType() === RS.EntityBlockRef) {
            continue;
        }
        if (CsTags.get(e, "SurfaceContours") === "1") {
            n++;
        }
    }
    return n;
}

var gLevels = CsContour.levels(
    CsUnits.convert(300.0, CsUnits.METERS, CsUnits.FEET),
    CsUnits.convert(330.0, CsUnits.METERS, CsUnits.FEET), 10);
var firstDraw = CsSurfaceData.drawContours(docAnchored, diAnchored, gGrid,
    gLevels, 10, gBbox, { width: gw, height: gh }, gAnchor, CsUnits.FEET);

ok(firstDraw.lines > 0, "the fixture grid produces contour lines");
var blockIdFirst = CsContour.blockIdOf(docAnchored);
ok(blockIdFirst !== null, "the contour block exists after a draw");
ok(docAnchored.queryBlockEntities(blockIdFirst).length > 0,
    "the contour linework is inside the block, not in model space");
ok(looseContours(docAnchored) === 0,
    "nothing tagged SurfaceContours is left loose in model space");

var refsFirst = contourBlockRefs(docAnchored);
ok(refsFirst.length === 1,
    "one insert carries the whole set (got " + refsFirst.length + ")");
if (refsFirst.length === 1) {
    var refPos = refsFirst[0].getData().getPosition();
    ok(refPos.x === 120 && refPos.y === -40,
        "the insert sits on the entrance station (got " + refPos.x + "," +
        refPos.y + ")");
    var basePoint = docAnchored.queryBlock(blockIdFirst).getOrigin();
    ok(basePoint.x === 120 && basePoint.y === -40,
        "the block's base point is the entrance too -- that is the grip");
    ok(refPos.x === basePoint.x && refPos.y === basePoint.y,
        "insert equals base point, so the contents are shifted by " +
        "nothing and block coordinates ARE drawing coordinates");
}

// The proof of that last one: a contour drawn for this grid must lie
// near the anchor, not near the drawing origin.
var inBlockIds = docAnchored.queryBlockEntities(blockIdFirst);
var sample = null;
for (var sv = 0; sv < inBlockIds.length; sv++) {
    var se = docAnchored.queryEntity(inBlockIds[sv]);
    if (!isNull(se) && CsTags.getNumber(se, "ContourElevation") !== null) {
        sample = se;
        break;
    }
}
ok(sample !== null, "a contour line is there to measure");
if (sample !== null) {
    var sBox = sample.getBoundingBox();
    var cx = (sBox.getMinimum().x + sBox.getMaximum().x) / 2.0;
    ok(Math.abs(cx - 120) < 4000,
        "the contour geometry is in DRAWING coordinates, around the " +
        "anchor (centre x " + Math.round(cx) + ")");
}

// Everything the readers need is still findable through the block.
var drawnFirst = CsContour.drawnEntities(docAnchored);
ok(drawnFirst.length > firstDraw.lines,
    "drawnEntities reaches inside the block");
var withElev = 0;
for (var dz = 0; dz < drawnFirst.length; dz++) {
    if (CsTags.getNumber(drawnFirst[dz], "ContourElevation") !== null) {
        withElev++;
    }
}
ok(withElev === firstDraw.lines,
    "every contour line still carries its elevation tag");

// A re-run replaces: a NEW definition, and nothing of the old one left.
var oldBlockEntities = docAnchored.queryBlockEntities(blockIdFirst);
var secondDraw = CsSurfaceData.drawContours(docAnchored, diAnchored, gGrid,
    gLevels, 10, gBbox, { width: gw, height: gh }, gAnchor, CsUnits.FEET);
ok(secondDraw.lines === firstDraw.lines,
    "a re-run draws the same set again");
ok(contourBlockRefs(docAnchored).length === 1,
    "a re-run leaves ONE insert, not two");
// A DELETED ENTITY IS STILL QUERYABLE by id in this storage -- it
// comes back as an undone object rather than null, so "is it gone?"
// has to be asked of the block that would hold it, never of
// queryEntity. Asking the wrong way passes on a drawing that still
// carries every contour it ever fetched.
var blockIdSecond = CsContour.blockIdOf(docAnchored);
ok(blockIdSecond !== null && blockIdSecond !== blockIdFirst,
    "the re-run built a NEW definition rather than refilling the old");
var nowInBlock = docAnchored.queryBlockEntities(blockIdSecond);
var survivors = 0;
for (var ov = 0; ov < oldBlockEntities.length; ov++) {
    for (var nv = 0; nv < nowInBlock.length; nv++) {
        if (oldBlockEntities[ov] === nowInBlock[nv]) {
            survivors++;
        }
    }
}
ok(survivors === 0,
    "no linework survived from the previous run (got " + survivors + ")");
ok(docAnchored.queryBlockEntities(blockIdFirst).length === 0,
    "the previous definition holds nothing");

// And the erase takes the definition itself, not just its contents.
CsSurfaceData.eraseExistingContours(docAnchored, diAnchored);
ok(CsContour.blockIdOf(docAnchored) === null,
    "erasing removes the block DEFINITION too");
ok(contourBlockRefs(docAnchored).length === 0, "and its insert");
ok(CsContour.drawnEntities(docAnchored).length === 0,
    "and nothing is left for the readers to find");

var out;
if (failures.length === 0) {
    out = "### SURFACE DATA OK " + passed;
} else {
    out = "### SURFACE DATA FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
