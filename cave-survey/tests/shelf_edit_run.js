// shelf_edit_run.js -- the Cave Shelf's trip table as an EDITOR.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/shelf_edit_run.js "$PWD"
//
// tests/js_unit.js pins the routing (CsShelf.editTarget) and the
// one-cell-to-whole-trip conversion (CsTripEdit.inputFor), both pure.
// What needs a real document is that a cell typed in the shelf lands in
// the DRAWING the same way the dedicated tool's does -- same trips,
// same count, nothing moved -- because that is the promise: two front
// doors, one edit.
//
//   1. A cell edit reaches the drawing, read back through the reader
//      every other tool uses.
//   2. The three fields nobody typed in survive it. planEdits compares
//      a WHOLE trip, so a one-cell edit that forgot them would blank
//      the name and the date.
//   3. The trip count does not change -- the duplicate-trip bug the
//      dedicated tool exists to avoid.
//   4. Nothing moved: these fields carry no geometry.
//   5. A bad date is refused whole, and the drawing is untouched.
//   6. A declination is NOT editable this way.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
// The shelf itself, for the file-editing half: CaveShelf.applyToFile is
// what a cell edit calls when the cave has no window open.
includeBasePath = repoRoot + "/scripts/CaveSurvey/CaveShelf";
include(includeBasePath + "/CaveShelf.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) { passed++; } else { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
getMainWindow = function() { return null; };

function shotOf(from, to, d, az, inc, trip) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d;
    s.azimuth = az; s.inclination = inc || 0; s.trip = trip || 0;
    return s;
}

var survey = CsModel.newSurvey();
survey.caveName = "SHELF EDIT CAVE";
survey.distanceUnit = "ft";
survey.trips = [CsModel.newTrip(), CsModel.newTrip()];
survey.trips[0].name = "ENTRANCE";
survey.trips[0].date = "2026-08-01";
survey.trips[0].team = "NDS, JB";
survey.trips[0].instruments = "SUUNTO";
survey.trips[0].declination = 3.5;
survey.trips[1].name = "SUMP LEAD";
survey.trips[1].date = "2026-08-08";
survey.trips[1].team = "NDS, RM";
survey.trips[1].instruments = "SUUNTO, TAPE";
survey.trips[1].declination = 3.5;
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0, 0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0, 0));
survey.shots.push(shotOf("A2", "B1", 18.5, 350.0, 3.0, 1));
survey.shots.push(shotOf("B1", "B2", 25.0, 20.0, -2.0, 1));
CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

function positions() {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") { continue; }
        var name = CsTags.get(e, "Station");
        if (name === "") { continue; }
        var p = e.getPosition();
        out[name] = p.x.toFixed(4) + "," + p.y.toFixed(4);
    }
    return out;
}
var wasAt = positions();

/** What the shelf does when a cell is committed, minus the widgets:
 *  read the survey back, turn ONE cell into a whole-trip input, and
 *  commit it exactly as CaveShelf.applyEdit does. */
function editCell(tripId, field, text) {
    var read = CsRevise.surveyFromDocument(doc);
    var rows = CsTripEdit.rows(read.survey);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].tripId === tripId) { row = rows[i]; }
    }
    if (row === null) { return { error: "no such trip" }; }
    var input = CsTripEdit.inputFor(row, field, text);
    if (input === null) { return { error: "not an editable field" }; }
    return CsTripEdit.commit(doc, di, read.survey, [input]);
}

// 1 + 2. One cell typed; the rest of that trip untouched.
var done = editCell(1, "team", "NDS, RM, GRACE");
ok(isNull(done.error), "a team typed into the shelf is accepted");
eqs(done.changes.length, 1, "and is one change");

var after = CsRevise.surveyFromDocument(doc);
eqs(after.survey.trips[1].team, "NDS, RM, GRACE",
    "the edit reached the DRAWING, through the reader every tool uses");
eqs(after.survey.trips[1].name, "SUMP LEAD",
    "the trip's name survived an edit to another column -- planEdits " +
        "compares a whole trip, so the untyped fields have to be " +
        "handed back as they are");
eqs(after.survey.trips[1].date, "2026-08-08", "so did its date");
eqs(after.survey.trips[1].instruments, "SUUNTO, TAPE",
    "and its instruments, which the shelf does not even show");
eqs(after.survey.trips[0].team, "NDS, JB",
    "the other trip was not touched");

// 3. The count does not change: the duplicate-trip bug.
eqs(after.survey.trips.length, 2,
    "still two trips -- editing by trip id is what stops a corrected " +
        "field forking the trip into a duplicate");
eqs(after.survey.shots.length, 4, "and four shots");

// 4. Nothing moved.
var nowAt = positions();
var moved = 0;
for (var name in wasAt) {
    if (wasAt.hasOwnProperty(name) && nowAt[name] !== wasAt[name]) {
        moved += 1;
    }
}
eqs(moved, 0, "no station moved: these fields carry no geometry");

// A date typed the way a caver types it is normalized, not refused.
var dated = editCell(1, "date", "9/6/2026");
ok(isNull(dated.error), "a date typed as 9/6/2026 is accepted");
eqs(CsRevise.surveyFromDocument(doc).survey.trips[1].date, "2026-09-06",
    "and stored in the form the drift check and the IGRF estimate parse");

// 5. A bad date changes nothing at all.
var bad = editCell(1, "date", "2026-02-30");
ok(!isNull(bad.error), "an impossible date is refused (" + bad.error + ")");
eqs(CsRevise.surveyFromDocument(doc).survey.trips[1].date, "2026-09-06",
    "and the drawing still holds the last good one -- a refusal is " +
        "all-or-nothing, not a half-applied row");

// Clearing a field really clears it.
var cleared = editCell(1, "name", "");
ok(isNull(cleared.error), "a name can be cleared");
eqs(CsRevise.surveyFromDocument(doc).survey.trips[1].name, "",
    "and is really gone from the tags, not just from the table");

// 6. Declination is not one of these fields.
var decl = editCell(1, "declination", "3.2");
ok(!isNull(decl.error),
    "declination cannot be typed in through this path -- it rotates " +
        "every azimuth in the trip, and has its own editor");
eqs(CsRevise.surveyFromDocument(doc).survey.trips[1].declination, 3.5,
    "so the trip's declination is untouched");

// ---------------------------------------------------------------------
// THE SPAN COLUMNS READ BACK FROM THE DRAWING.
//
// From and To are for reference and are never typed, so what matters is
// that they survive the round trip through the tags: the reconstructed
// shots have to carry their trip numbers and their station names in the
// order they were surveyed, or the columns quietly show somebody else's
// stations.
// ---------------------------------------------------------------------
(function() {
    var read = CsRevise.surveyFromDocument(doc);
    var first = CsShelf.tripSpan(read.survey.shots, 0);
    eqs(first.start + "-" + first.end, "ENT-A2",
        "trip 0's span, read back out of the drawing");
    var second = CsShelf.tripSpan(read.survey.shots, 1);
    eqs(second.start + "-" + second.end, "A2-B2",
        "and trip 1's, which starts at the station trip 0 finished on " +
            "-- the tie-in a caver is looking for");
    ok(second.start !== "",
        "a reconstructed survey carries trip numbers on its shots: " +
            "without them every span would read as trip 0's");
}());

// ---------------------------------------------------------------------
// EDITING A CAVE THAT IS NOT OPEN, IN THE FILE ITSELF.
//
// The point of the shelf table: fix a trip without opening the drawing.
// It writes the cave back through a full DXF round trip, so what is
// asserted here is that the round trip costs NOTHING -- the edit lands,
// and everything else in the file is exactly as it was, including the
// layer states that used to be the reason this was not allowed.
// ---------------------------------------------------------------------
(function() {
    var folder = QDir.tempPath() + "/CaveCADShelfEdit";
    try { (new QDir(folder)).removeRecursively(); } catch (eOld) {}
    (new QDir("/")).mkpath(folder);
    var path = folder + "/Shelf Edit Cave.dxf";

    // A layer switched OFF and another FROZEN, which is the pair that
    // used to come back wrong: off became on, and on the way back in it
    // became frozen as well.
    //
    // ENSURED FIRST, both of them. queryLayer on a name the drawing
    // does not have answers a NULL-WRAPPED object whose setOff() does
    // nothing and reports nothing -- the first draft of this test set
    // "off" on thin air and then asserted the file had it.
    CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);
    var offOp = new RModifyObjectsOperation();
    var offLayer = doc.queryLayer(doc.getLayerId(CsLayers.WALLS_SURVEYED));
    ok(offLayer.isOff() === false,
        "the fixture's wall layer exists and is on to begin with");
    offLayer.setOff(true);
    offOp.addObject(offLayer);
    var frozenLayer = doc.queryLayer(doc.getLayerId(CsLayers.CTRL_SCAN));
    frozenLayer.setFrozen(true);
    offOp.addObject(frozenLayer);
    di.applyOperation(offOp);

    ok(di.exportFile(path, CsSanitize.dxfFilter()),
        "the fixture cave was written to a file");

    // THE BASELINE IS THE FILE, not the document it came from: an
    // export adds the model and paper space blocks, so a document-to-
    // file comparison would report a difference the edit did not make.
    var baseDi = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    baseDi.importFile(path, "", false);
    var baseDoc = baseDi.getDocument();
    var was = { entities: baseDoc.queryAllEntities(false, true).length,
                layers: baseDoc.queryAllLayers().length,
                blocks: baseDoc.queryAllBlocks().length };
    var baseOff = baseDoc.queryLayer(baseDoc.getLayerId(
        CsLayers.WALLS_SURVEYED));
    ok(baseOff.isOff() === true,
        "and the written file carries the layer as OFF -- which is the " +
            "half of this that only started working when the DXF " +
            "exporter stopped negating a colour dxflib was already " +
            "negating");
    try { destr(baseDi); } catch (eBase) {}

    var applied = CaveShelf.applyToFile(path, 0, "team", "NDS, JB, IRIS");
    ok(isNull(applied.error),
        "a trip in a CLOSED cave is edited in the file (" +
            applied.error + ")");
    eqs(applied.changes, 1, "one field changed");

    // Read the file back: the edit landed, and nothing else moved.
    var check = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    eqs(check.importFile(path, "", false), RDocumentInterface.IoErrorNoError,
        "the rewritten file still opens");
    var cdoc = check.getDocument();
    var cread = CsRevise.surveyFromDocument(cdoc);
    eqs(cread.survey.trips[0].team, "NDS, JB, IRIS",
        "the edit is in the FILE, with no drawing ever opened for it");
    eqs(cread.survey.trips[0].name, "ENTRANCE",
        "and the rest of that trip is as it was");
    eqs(cread.survey.trips.length, 2, "both trips are still there");
    eqs(cread.survey.shots.length, 4, "and every shot");
    eqs(cdoc.queryAllEntities(false, true).length, was.entities,
        "the file holds the same number of entities it did");
    eqs(cdoc.queryAllLayers().length, was.layers, "the same layers");
    eqs(cdoc.queryAllBlocks().length, was.blocks, "the same blocks");

    // THE LAYER STATES: the whole reason this path was refused until
    // the application's DXF writer was fixed (2026-09-15).
    var offBack = cdoc.queryLayer(cdoc.getLayerId(CsLayers.WALLS_SURVEYED));
    ok(offBack.isOff() === true,
        "a layer the caver had switched OFF is still off -- it used to " +
            "come back ON, which is why a shelf edit could not touch a " +
            "closed file");
    ok(offBack.isFrozen() === false,
        "and is NOT frozen: off and frozen are different states, and a " +
            "frozen layer refuses edits in silence");
    var frozenBack = cdoc.queryLayer(cdoc.getLayerId(CsLayers.CTRL_SCAN));
    ok(frozenBack.isFrozen() === true, "a frozen layer is still frozen");
    ok(frozenBack.isOff() === false, "and was not switched off by the trip");

    // NOTHING LEFT BEHIND. The swap writes beside the cave and moves the
    // new drawing into place; neither working file may survive it.
    ok(!(new QFileInfo(path + ".editing.dxf")).exists(),
        "no half-written drawing is left beside the cave");
    ok(!(new QFileInfo(path + ".previous.dxf")).exists(),
        "and no copy of the old one");

    // A refusal leaves the file alone, byte for byte.
    var sizeBefore = (new QFileInfo(path)).size();
    var refused = CaveShelf.applyToFile(path, 0, "date", "2026-02-30");
    ok(!isNull(refused.error), "an impossible date is still refused");
    eqs((new QFileInfo(path)).size(), sizeBefore,
        "and the cave's drawing is not rewritten at all");

    try { destr(check); } catch (eD) {}
    try { (new QDir(folder)).removeRecursively(); } catch (eClean) {}
}());

if (failures.length === 0) {
    print("### SHELF EDIT OK " + passed + " assertions");
} else {
    print("### SHELF EDIT FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
