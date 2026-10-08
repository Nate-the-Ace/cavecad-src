// check_map_run.js -- Check Map reads a REAL drawing correctly.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/check_map_run.js "$PWD"
//
// tests/js_unit.js already runs all fourteen checks over literal scan
// objects, which is where the logic is proved. What it cannot prove is
// the half that turns a DOCUMENT into one of those objects: whether an
// empty SCALE-BAR layer is actually seen as empty, whether a symbol's
// layer is read off the entity or off the block, whether a closed
// polyline reports itself closed.
//
// That half is where a lint tool fails silently and expensively: every
// check passes, the panel says "nothing to fix", and the reason is that
// the scan found nothing to check. So this file builds a drawing with
// known faults in it and asserts each one is SEEN -- and then builds a
// clean drawing and asserts the panel would stay quiet.

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
function has(result, code, what) {
    var found = false;
    for (var i = 0; i < result.findings.length; i++) {
        if (result.findings[i].code === code) {
            found = true;
        }
    }
    ok(found, what);
}
function hasNot(result, code, what) {
    var found = false;
    for (var i = 0; i < result.findings.length; i++) {
        if (result.findings[i].code === code) {
            found = true;
        }
    }
    ok(!found, what);
}
function codesOf(result) {
    var out = [];
    for (var i = 0; i < result.findings.length; i++) {
        out.push(result.findings[i].code);
    }
    return out.join(", ");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

// NOT "addLine". scripts/simple.js defines a global addLine, and
// include() runs at RUNTIME while this file's own function
// declarations are hoisted to the top of the scope -- so simple.js's
// assignment lands AFTER ours and silently wins. Every line this test
// drew went through QCAD's own addLine instead, onto layer 0, and the
// suite reported the faults it was built to prove it could not see.
function addSegment(layer, x1, y1, x2, y2) {
    CsLayers.ensure(doc, di, layer);
    var e = new RLineEntity(doc,
        new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e.getId();
}

function addStation(name, x, y, z) {
    CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
    var e = new RPointEntity(doc, new RPointData(new RVector(x, y, z)));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(e, "Station", name);
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
}

function addBoundary(cx, cy, half, closed) {
    CsLayers.ensure(doc, di, CsLayers.BREAKDOWN_BOUNDARY);
    var pl = new RPolylineEntity(doc, new RPolylineData());
    pl.appendVertex(new RVector(cx - half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy - half));
    pl.appendVertex(new RVector(cx + half, cy + half));
    pl.appendVertex(new RVector(cx - half, cy + half));
    pl.setClosed(closed);
    pl.setLayerId(doc.getLayerId(CsLayers.BREAKDOWN_BOUNDARY));
    var op = new RAddObjectsOperation();
    op.addObject(pl, false);
    di.applyOperation(op);
}

/** A block reference on a named layer, the way a copied symbol ends up
 *  somewhere it does not belong. */
function addSymbol(blockName, layer, x, y) {
    CsLayers.ensure(doc, di, layer);
    if (isNull(doc.queryBlock(blockName))) {
        var bop = new RAddObjectsOperation();
        bop.addObject(new RBlock(doc, blockName, new RVector(0, 0)), false);
        di.applyOperation(bop);
        // A block with no geometry has a NaN bounding box and every
        // reference to it is dropped on the way into the spatial index
        // -- see tests/scatter_breakdown_run.js for the same trap.
        var blk = doc.queryBlock(blockName);
        var gop = new RAddObjectsOperation();
        var seg = new RLineEntity(doc,
            new RLineData(new RVector(-0.5, -0.5), new RVector(0.5, 0.5)));
        seg.setBlockId(blk.getId());
        gop.addObject(seg, false);
        di.applyOperation(gop);
    }
    var ref = new RBlockReferenceEntity(doc, new RBlockReferenceData(
        doc.queryBlock(blockName).getId(), new RVector(x, y), 
        new RVector(1, 1), 0));
    ref.setLayerId(doc.getLayerId(layer));
    var op = new RAddObjectsOperation();
    op.addObject(ref, false);
    di.applyOperation(op);
    return ref;
}

// ---------------------------------------------------------------------
// A drawing with faults in it.
// ---------------------------------------------------------------------

addStation("A1", 0, 0, 100);
addStation("A2", 50, 0, 100);

// two wall lines that stop 3 ft short of each other
addSegment(CsLayers.WALLS_SURVEYED, 0, 5, 20, 5);
addSegment(CsLayers.WALLS_SURVEYED, 23, 5, 45, 5);
// linework nowhere near the survey
addSegment(CsLayers.WALLS_INFERRED, 900, 900, 920, 900);
// work on the default layer
addSegment("0", 1, 1, 2, 2);
// an open breakdown boundary
addBoundary(10, -10, 4, false);
// a stalactite dropped on the water layer
addSymbol("SYM_STALACTITE", CsLayers.WATER_FLOW_ARROWS, 5, 2);

var faulty = CsCheck.scan(doc);
var result = CsCheck.review(faulty);

ok(faulty.perFoot === 1.0,
    "a foot drawing reports one drawing unit per foot");
has(result, "sheet.scalebar", "an empty SCALE-BAR layer is seen as empty");
has(result, "sheet.north", "and so is a missing north arrow");
has(result, "sheet.titleblock",
    "a drawing with no title block text reports its missing fields");
has(result, "layer.symbol",
    "a stalactite on the water layer is read off the entity, not the block");
has(result, "layer.stray", "a line on layer 0 is seen");
has(result, "walls.gap",
    "two wall ends 3 ft apart are found in the real geometry");
has(result, "walls.orphan",
    "linework 900 ft from every station is found");
has(result, "boundary.open",
    "an open polyline reports itself open (found: " + codesOf(result) + ")");

// ONE ROW PER FAULT, and the counts believable: a gap seen from both
// its ends must still be ONE row, and every row must have its own id
// or ignoring one would silence another.
function countCode(res, code) {
    var n = 0;
    for (var i = 0; i < res.findings.length; i++) {
        if (res.findings[i].code === code) {
            n += 1;
        }
    }
    return n;
}
eqs(countCode(result, "walls.gap"), 1,
    "the one hole in the wall is one row, not one per end");
eqs(countCode(result, "walls.orphan"), 1,
    "the one line away from the survey is one row");
var seenIds = {};
var duplicated = [];
for (var di2 = 0; di2 < result.findings.length; di2++) {
    var fid = result.findings[di2].id;
    ok(String(fid).indexOf(",") === -1,
        "an id holds no comma -- the stored ignore list is comma " +
            "separated (" + fid + ")");
    if (seenIds[fid] === true) {
        duplicated.push(fid);
    }
    seenIds[fid] = true;
}
eqs(duplicated.length, 0,
    "no two findings on a real drawing share an id (" +
        duplicated.join(", ") + ")");

// CLICKING A ROW PANS TO IT, which is only possible when the finding
// carries a place. The pan itself needs a view and cannot run headless,
// so what is guarded here is the half that breaks silently: a check
// that forgets to pass `at` produces a row that looks ordinary and goes
// nowhere when clicked.
//
// The placeless codes are listed rather than inferred, so ADDING one is
// a deliberate act: a fault about the whole sheet has nowhere to pan to
// (a missing scale bar is nowhere in particular), and a fault about a
// place must say where.
var PLACELESS = { "sheet.scalebar": true, "sheet.north": true,
    "sheet.titleblock": true, "sheet.legend": true,
    "survey.closure": true, "layer.hidden": true, "check.more": true };
for (var pi = 0; pi < result.findings.length; pi++) {
    var pf = result.findings[pi];
    if (PLACELESS[pf.code] === true) {
        continue;
    }
    ok(!isNull(pf.at) && isFinite(pf.at.x) && isFinite(pf.at.y),
        pf.code + " carries a place to pan to (title: " + pf.title + ")");
}

// Ignoring ONE finding leaves everything else reported.
var firstId = result.findings[0].id;
var afterIgnore = CsCheck.splitIgnored(result.findings,
    CsCheck.parseIgnored(firstId));
eqs(afterIgnore.shown.length, result.findings.length - 1,
    "ignoring one finding hides exactly one");
eqs(afterIgnore.ignored.length, 1,
    "and hands that one back rather than dropping it");

ok(result.failed.length === 0,
    "no check threw on a real document (" + result.failed.join(", ") + ")");

// ---------------------------------------------------------------------
// The three false positives a real cave produced on the first live run.
// Each one accused work that was perfectly correct, which is the way a
// lint tool gets switched off and never heard from again.
// ---------------------------------------------------------------------

// 1. A per-run VARIANT layer is generated by the suite and is nowhere
//    in the registry -- Truitt Cave has 48 of them.
ok(CsCheck.isRegisteredLayer("CTRL-PROFILE-STATIONS-G") === true,
    "a per-run variant layer is not a layer the suite fails to know");
ok(CsCheck.isRegisteredLayer("CTRL-PROFILE-STATIONS") === true,
    "and neither is its base");
ok(CsCheck.isRegisteredLayer("SOMEONES-OWN-LAYER") === false,
    "but a layer nothing here made still is one");

// 2. Elevation linework sits hundreds of feet below the plan by
//    design, and is not measured against the plan's stations.
addSegment(CsLayers.PROFILE_WALLS_SURVEYED, 0, -900, 40, -900);
var withProfile = CsCheck.review(CsCheck.scan(doc));
var orphanCount = 0;
for (var oi = 0; oi < withProfile.findings.length; oi++) {
    if (withProfile.findings[oi].code === "walls.orphan") {
        orphanCount = withProfile.findings[oi].count;
    }
}
eqs(orphanCount, 1,
    "a wall traced in the ELEVATION is not counted as drawn away " +
        "from the survey (only the plan-frame stray should count)");

// 3. Strays get one ROW PER LAYER, each with its own id, so a caver
//    can accept the scratch layer and still be told about layer 0.
//    (This used to be one row naming every layer, which on Truitt was
//    48 names in a row nobody could read.)
var many = CsCheck.scan(doc);
for (var mi = 0; mi < 6; mi++) {
    many.entities.push({ layer: "MADE-UP-" + mi, at: { x: mi, y: 0 },
        registered: false });
}
var manyResult = CsCheck.review(many);
eqs(countCode(manyResult, "layer.stray"), 7,
    "six made-up layers plus layer 0 are seven stray rows");
var strayIds = {};
var strayDupes = 0;
var longest = 0;
for (var mf = 0; mf < manyResult.findings.length; mf++) {
    var f2 = manyResult.findings[mf];
    if (f2.code !== "layer.stray") {
        continue;
    }
    if (strayIds[f2.id] === true) {
        strayDupes += 1;
    }
    strayIds[f2.id] = true;
    if (f2.title.length > longest) {
        longest = f2.title.length;
    }
}
eqs(strayDupes, 0, "each stray layer has its own id to ignore");
ok(longest < 90,
    "and each row stays short enough to read (" + longest + " chars)");

// ---------------------------------------------------------------------
// And a drawing with none of that.
// ---------------------------------------------------------------------

var clean = new RDocument(new RMemoryStorage(), createSpatialIndex());
var cleanDi = new RDocumentInterface(clean);
doc = clean;
di = cleanDi;
getDocument = function() { return clean; };
getDocumentInterface = function() { return cleanDi; };

addStation("A1", 0, 0, 100);
addStation("A2", 50, 0, 100);
addSegment(CsLayers.WALLS_SURVEYED, 0, 5, 45, 5);
addSegment(CsLayers.SCALE_BAR, 0, -20, 50, -20);
addSegment(CsLayers.NORTH_ARROW, 60, 0, 60, 10);
addBoundary(10, -10, 4, true);

var cleanResult = CsCheck.review(CsCheck.scan(clean));
hasNot(cleanResult, "sheet.scalebar",
    "a drawing WITH a scale bar is not accused of missing one");
hasNot(cleanResult, "sheet.north", "nor of missing a north arrow");
hasNot(cleanResult, "walls.gap",
    "one unbroken wall is not a gap");
hasNot(cleanResult, "walls.orphan",
    "a wall beside the stations is not an orphan");
hasNot(cleanResult, "boundary.open",
    "a closed boundary is not reported open");
hasNot(cleanResult, "layer.stray",
    "and nothing here is on a layer the suite does not know (" +
        codesOf(cleanResult) + ")");

// ---------------------------------------------------------------------

if (failures.length === 0) {
    print("### CHECK MAP OK");
} else {
    print("### CHECK MAP FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
