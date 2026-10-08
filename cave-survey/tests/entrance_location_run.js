// entrance_location_run.js -- moving a cave onto its real entrance,
// against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/entrance_location_run.js "$PWD"
//
// Prints "### ENTRANCE LOCATION OK <n>" or "### ENTRANCE LOCATION FAIL".
//
// WHY THIS EXISTS, AND WHY IT IS NOT A UNIT TEST. Entrance Location's
// Pick on Drawing slides the whole cave so its entrance station lands
// where the caver clicked on the imagery. The first version of
// CsLocationPick.moveSurvey walked queryAllEntities(false, TRUE) --
// which also returns every entity INSIDE every block DEFINITION. Each
// symbol, callout and section bay was therefore moved within its own
// definition (for every insert of it, definitions being shared) AND
// carried again by its block reference. A real cave's drawing came
// apart, and it took a live repair to put back.
//
// Nothing headless could have caught that: it needs real blocks, real
// inserts, and a document to move. So this stage builds exactly that
// and asserts the one property the bug broke -- a block definition's
// geometry does not move when the drawing is translated.

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

var repoPath = "";
if (typeof args !== "undefined" && args.length > 1) {
    repoPath = args[args.length - 1];
}
if (repoPath === "") {
    repoPath = new QDir().absolutePath();
}

function loadCore(rel) {
    var path = repoPath + "/scripts/CaveSurvey/Core/" + rel;
    var f = new QFile(path);
    // A PLAIN BITWISE OR: new QIODevice.OpenMode(...) does not exist
    // in this bridge, and throws a bare "TypeError: Type error".
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw "cannot read " + path;
    }
    var ts = new QTextStream(f);
    var text = ts.readAll();
    f.close();
    // include() lines are stripped: this file loads what it needs, in
    // order, exactly as tests/js_unit.js does.
    text = text.replace(/^\s*include\(.*\);\s*$/mg, "");
    // INDIRECT eval, so the definitions land in the GLOBAL scope
    // rather than in this function's -- a plain eval() here leaves
    // every Cs* global undefined at the first use. Same idiom, same
    // reason, as tests/js_unit.js's loadRepoScript.
    (0, eval)(text);
}

// CsContour.js rides along for CsContour.drawnEntities: contours are
// drawn inside a block now, and lowPointNear reads them through it.
var CORE = ["CsUuid.js", "CsUnits.js", "CsTags.js", "CsLayers.js",
            "CsPackage.js", "CsAngles.js", "CsGeoProject.js",
            "CsContour.js", "CsLocationPick.js"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadCore(CORE[ci]);
}

var passed = 0;
var failures = [];

function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
       what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

// ---------------------------------------------------------------------
// A drawing with a block used twice, a plain line, and a contour.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var blockOp = new RAddObjectsOperation();
blockOp.addObject(new RBlock(doc, "SYM_TEST", new RVector(0, 0)));
di.applyOperation(blockOp);
var blockId = doc.getBlockId("SYM_TEST");

// The symbol's own geometry, in block coordinates around its origin.
var innerOp = new RAddObjectsOperation();
var inner = new RLineEntity(doc,
    new RLineData(new RVector(-1, -1), new RVector(1, 1)));
inner.setBlockId(blockId);
innerOp.addObject(inner, false);
di.applyOperation(innerOp);
var innerId = inner.getId();

var op = new RAddObjectsOperation();

// Two inserts of it, far apart.
op.addObject(new RBlockReferenceEntity(doc,
    new RBlockReferenceData(blockId, new RVector(100, 100),
        new RVector(1, 1), 0)), false);
op.addObject(new RBlockReferenceEntity(doc,
    new RBlockReferenceData(blockId, new RVector(300, 50),
        new RVector(1, 1), 0)), false);

// The entrance station.
var station = new RPointEntity(doc, new RPointData(new RVector(10, 20)));
CsTags.set(station, "Station", "A1");
CsTags.set(station, "Elevation", "0");
op.addObject(station, false);

// A surface contour, which must NOT move: it is fixed to the world.
var contour = new RLineEntity(doc,
    new RLineData(new RVector(0, 500), new RVector(400, 500)));
CsTags.set(contour, "SurfaceContours", "1");
CsTags.set(contour, "ContourElevation", "1240");
op.addObject(contour, false);

// A lower contour nearer the click, for the snap.
var lower = new RLineEntity(doc,
    new RLineData(new RVector(0, 60), new RVector(400, 60)));
CsTags.set(lower, "SurfaceContours", "1");
CsTags.set(lower, "ContourElevation", "1200");
op.addObject(lower, false);

di.applyOperation(op);

var stationId = station.getId();
var contourId = contour.getId();

// ---------------------------------------------------------------------
// The move.
// ---------------------------------------------------------------------

var offset = new RVector(40, -15);
var moved = CsLocationPick.moveSurvey(doc, di, offset);

ok(moved > 0, "moveSurvey moved something");

// THE ASSERTION THIS FILE EXISTS FOR. A block definition's geometry is
// in block coordinates; translating the drawing must not touch it, or
// every insert of that symbol is displaced -- twice over, since the
// reference moves too.
var innerAfter = doc.queryEntity(innerId);
var innerShape = innerAfter.getData().castToShape();
near(innerShape.getStartPoint().x, -1, 1e-9,
     "a block definition's geometry does not move (start x)");
near(innerShape.getStartPoint().y, -1, 1e-9,
     "a block definition's geometry does not move (start y)");
near(innerShape.getEndPoint().x, 1, 1e-9,
     "a block definition's geometry does not move (end x)");

// The station did move, by exactly the offset.
var stationAfter = doc.queryEntity(stationId);
near(stationAfter.getPosition().x, 50, 1e-9, "the station moved in x");
near(stationAfter.getPosition().y, 5, 1e-9, "the station moved in y");

// The surface stayed where it was: it is pinned to the world.
var contourAfter = doc.queryEntity(contourId);
var contourShape = contourAfter.getData().castToShape();
near(contourShape.getStartPoint().x, 0, 1e-9,
     "a surface contour does not move (x)");
near(contourShape.getStartPoint().y, 500, 1e-9,
     "a surface contour does not move (y)");

// The block REFERENCES moved, so their symbols appear in the new place
// -- which is what carries a symbol along without touching its
// definition.
var refs = doc.queryAllEntities(false, false);
var refPositions = [];
for (var r = 0; r < refs.length; r++) {
    var e = doc.queryEntity(refs[r]);
    // RS.EntityBlockRef, NOT EntityBlockReference: the latter is
    // undefined, so the comparison quietly matches nothing and the
    // test passes over an empty list.
    if (isNull(e) || e.getType() !== RS.EntityBlockRef) {
        continue;
    }
    refPositions.push(Math.round(e.getData().getPosition().x));
}
refPositions.sort(function(a, b) { return a - b; });
ok(refPositions.length === 2, "both inserts are still there");
ok(refPositions[0] === 140 && refPositions[1] === 340,
   "the inserts moved by the offset (got " + refPositions.join(",") + ")");

// ---------------------------------------------------------------------
// The low-point snap.
// ---------------------------------------------------------------------

var low = CsLocationPick.lowPointNear(doc, new RVector(200, 70), 100);
ok(low !== null, "a contour within reach is found");
if (low !== null) {
    near(low.elevation, 1200, 1e-9,
         "the LOWEST contour within reach wins");
    // The contour did NOT move with the cave, so the snap point is
    // still on the world where the contour was drawn.
    near(low.y, 60, 1e-9, "the snap lands on that contour");
}
ok(CsLocationPick.lowPointNear(doc, new RVector(200, 70), 1) === null,
   "nothing within reach means no snap");

// ---------------------------------------------------------------------
// A contour inside the contour BLOCK, which is where Surface Data
// draws them now. The snap has to reach into it, and it may do so only
// because that block is inserted once at the origin unscaled and
// unrotated -- block coordinates are drawing coordinates.
// ---------------------------------------------------------------------

var cbOp = new RAddObjectsOperation();
cbOp.addObject(new RBlock(doc, CsContour.BLOCK, new RVector(0, 0)));
di.applyOperation(cbOp);
var contourBlockId = doc.getBlockId(CsContour.BLOCK);

var inBlockOp = new RAddObjectsOperation();
var inBlock = new RLineEntity(doc,
    new RLineData(new RVector(0, 65), new RVector(400, 65)));
inBlock.setBlockId(contourBlockId);
CsTags.set(inBlock, "SurfaceContours", "1");
CsTags.set(inBlock, "ContourElevation", "1180");
inBlockOp.addObject(inBlock, false);
var blockRef = new RBlockReferenceEntity(doc,
    new RBlockReferenceData(contourBlockId, new RVector(0, 0),
        new RVector(1, 1), 0));
CsTags.set(blockRef, "SurfaceContours", "1");
inBlockOp.addObject(blockRef, false);
di.applyOperation(inBlockOp);

ok(CsContour.blockIdOf(doc) === contourBlockId,
   "the contour block is found by name");

var lowInBlock = CsLocationPick.lowPointNear(doc, new RVector(200, 70), 100);
ok(lowInBlock !== null, "a contour inside the block is found");
if (lowInBlock !== null) {
    near(lowInBlock.elevation, 1180, 1e-9,
         "the contour inside the block wins on elevation");
    near(lowInBlock.y, 65, 1e-9,
         "the snap lands on the block's own coordinates");
}

// The block REFERENCE carries the tag but no elevation, and must not
// be mistaken for a contour: it has no shape to snap to.
ok(CsLocationPick.lowPointNear(doc, new RVector(200, 70), 1) === null,
   "the reference itself is not snapped to");

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

var out;
if (failures.length === 0) {
    out = "### ENTRANCE LOCATION OK " + passed + " assertions";
} else {
    out = "### ENTRANCE LOCATION FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
