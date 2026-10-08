// teaching_cave_run.js -- the teaching cave hands out a copy with the
// location gone, and putting it back never touches the real cave.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/teaching_cave_run.js "$PWD"
//
// tests/js_unit.js pins the path arithmetic and the plans. This is the
// half that moves files, and two of the things it does are things you
// only get to be wrong about once:
//
//   1. The master is SANITIZED. A teaching copy that still carries the
//      entrance is the suite's first rule broken by the one tool whose
//      whole job is to hand a cave to strangers.
//   2. Reset is a RECURSIVE DELETE. It has to be aimed inside the
//      teaching folder and nowhere else, and the real cave has to come
//      through every reset untouched.

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
if (typeof isFunction === "undefined") {
    isFunction = function(v) { return typeof v === "function"; };
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

var failures = [];
function ok(condition, what) {
    if (!condition) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var memDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
getDocument = function() { return memDi.getDocument(); };
getDocumentInterface = function() { return memDi; };
getMainWindow = function() { return null; };

includeBasePath = repoRoot + "/scripts/CaveSurvey/TeachingCave";
include(includeBasePath + "/TeachingCave.js");

// ---------------------------------------------------------------------
// A "real" cave on disk, with an entrance location in it, plus a
// teaching root of its own so nothing here can reach the caver's.
// ---------------------------------------------------------------------

var root = QDir.tempPath() + "/CaveCADTeachingTest";
try {
    if ((new QDir(root)).exists()) { (new QDir(root)).removeRecursively(); }
} catch (eWipe) {
}

var realFolder = root + "/real/TRUITT CAVE";
var caveRoot = root + "/Cave";
ok((new QDir()).mkpath(realFolder), "made a real cave folder");
ok((new QDir()).mkpath(realFolder + "/scans"), "made its scans folder");
ok((new QDir()).mkpath(realFolder + "/PDF"), "made its PDF folder");

// A field sketch, which SHOULD travel, and a plotted map, which should
// not: a title block carries a location somebody typed.
var sketch = new QFile(realFolder + "/scans/trip1-page1.png");
sketch.open(QIODevice.WriteOnly);
sketch.write(new QByteArray("not really a png"));
sketch.close();
var plotted = new QFile(realFolder + "/PDF/Truitt Cave 2026.pdf");
plotted.open(QIODevice.WriteOnly);
plotted.write(new QByteArray("not really a pdf"));
plotted.close();

var drawingPath = realFolder + "/Truitt Cave.dxf";
var di = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
var doc = di.getDocument();

var station = new RPointEntity(doc, new RPointData(new RVector(0, 0, 0)));
CsTags.set(station, "Station", "A1");
CsTags.set(station, "GeoLat", "38.123456");
CsTags.set(station, "GeoLon", "-86.654321");
CsTags.set(station, "GeoStation", "A1");
var addOp = new RAddObjectsOperation();
addOp.addObject(station, false);
di.applyOperation(addOp);

// An ALIGNED SCAN, stored the way a real drawing stores one: an
// absolute path into the surveyor's own cave folder.
var scanImage = new RImageEntity(doc, new RImageData(
    realFolder + "/scans/trip1-page1.png",
    new RVector(10, 10), new RVector(1, 0), new RVector(0, 1), 64, 64, 0));
var scanOp = new RAddObjectsOperation();
scanOp.addObject(scanImage, false);
di.applyOperation(scanOp);

// A georeferenced basemap: the entrance baked into a raster, which
// stripping tags alone would leave in plain sight.
// ON CTRL-AERIAL, AND SWITCHED OFF -- which is where a real one lives
// and how a real drawing carries it. Off and frozen layers refuse
// edits in silence in this build, so a sanitizer that does not reach
// through that erases nothing and says it erased nothing: measured on
// Truitt Cave, whose "sanitized" teaching copy kept its aerial
// photograph, entrance and all.
CsLayers.ensure(doc, di, CsLayers.CTRL_AERIAL);
var basemap = new RImageEntity(doc, new RImageData(
    repoRoot + "/testdata/Elevation_3DEP_64.tif",
    new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), 64, 64, 0));
CsTags.set(basemap, "AerialBasemap", "1");
basemap.setLayerId(doc.getLayerId(CsLayers.CTRL_AERIAL));
var imgOp = new RAddObjectsOperation();
imgOp.addObject(basemap, false);
di.applyOperation(imgOp);
// FROZEN, not just off. Measured 2026-09-10: a layer's OFF state does
// not survive a DXF round trip in this build and its FROZEN state does,
// so a fixture that only switched the layer off came back visible and
// never reproduced the bug at all. Frozen refuses edits exactly as off
// does -- CsLayers.refusesEdits treats them as one thing for precisely
// this reason.
var aerialLayer = doc.queryLayer(CsLayers.CTRL_AERIAL);
aerialLayer.setOff(true);
aerialLayer.setFrozen(true);
var offOp = new RModifyObjectsOperation();
offOp.addObject(aerialLayer);
di.applyOperation(offOp);

ok(di.exportFile(drawingPath, CsSanitize.dxfFilter()),
    "wrote the real cave's drawing");

var record = CsShelf.newRecord();
record.folder = realFolder;
record.name = "Truitt Cave";
record.drawing = drawingPath;

// ---------------------------------------------------------------------
// Making the master.
// ---------------------------------------------------------------------

// THE SANITIZER ON ITS OWN, before the teaching tool gets near it.
// Going through buildMaster hides this: its re-pointing pass deletes
// any image whose page did not travel, so an aerial photograph the
// sanitizer FAILED to erase gets swept up by accident and every
// assertion downstream passes. Package Cave has no such second pass --
// it would ship the photograph -- so the sanitizer is checked alone.
var direct = root + "/direct-sanitized.dxf";
var directResult = CsSanitize.writeCopy(drawingPath, direct);
ok(directResult.ok === true,
    "the sanitizer wrote a copy (" + directResult.error + ")");
eqs(directResult.basemaps, 1,
    "and erased the aerial photograph, which sits on a layer that is " +
        "SWITCHED OFF -- off and frozen layers refuse edits in silence " +
        "in this build, so a sanitizer that cannot reach through that " +
        "erases nothing and reports nothing");

var directDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
ok(directDi.importFile(direct, "", false) ===
    RDocumentInterface.IoErrorNoError, "the sanitized copy reads back");
var directDoc = directDi.getDocument();
var aerials = 0;
var directIds = directDoc.queryAllEntities(false, true);
for (var d = 0; d < directIds.length; d++) {
    var de = directDoc.queryEntity(directIds[d]);
    if (isNull(de)) { continue; }
    if (CsTags.get(de, "AerialBasemap") !== "" ||
            String(de.getType()) === String(RS.EntityImage) &&
            String(de.getFileName()).indexOf("Elevation_3DEP") >= 0) {
        aerials += 1;
    }
}
eqs(aerials, 0,
    "no aerial photograph survives into a sanitized copy -- the " +
        "entrance is baked into the raster, not into a tag anybody " +
        "can strip");

var built = TeachingCave.buildMaster(record, caveRoot, "Truitt Cave");
ok(built.ok === true, "the master was built (" + built.error + ")");
ok(built.stripped >= 1,
    "and the entrance location was stripped from the drawing (" +
        built.stripped + " stations)");

var masterFolder = CsTeach.masterFor(caveRoot, "Truitt Cave");
var masterDrawing = CsTeach.drawingIn(masterFolder, "Truitt Cave");
ok((new QFileInfo(masterDrawing)).exists(),
    "the pristine drawing is at " + masterDrawing);

// THE LOCATION IS ACTUALLY GONE, read back off the file rather than
// trusted from a return value.
var check = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
ok(check.importFile(masterDrawing, "", false) ===
    RDocumentInterface.IoErrorNoError, "the master reads back");
var checkDoc = check.getDocument();
var leaked = [];
var images = 0;
var ids = checkDoc.queryAllEntities(false, false);
for (var i = 0; i < ids.length; i++) {
    var e = checkDoc.queryEntity(ids[i]);
    if (isNull(e)) { continue; }
    for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
        var got = CsTags.get(e, CsPackage.GEO_TAGS[t]);
        if (got !== null && got !== undefined && got !== "") {
            leaked.push(CsPackage.GEO_TAGS[t] + "=" + got);
        }
    }
    if (e.getType() === RS.EntityImage) {
        images += 1;
    }
}
eqs(leaked.length, 0,
    "no geographic tag survives into the teaching copy (" +
        leaked.join(", ") + ")");
eqs(images, 1,
    "the aerial photograph is gone and the field sketch is not -- " +
        "stripping the tags alone would leave the entrance baked into " +
        "a raster, and dropping every image would take the sketches a " +
        "student is here to trace");

// THE SCANS READ FROM THE TEACHING FOLDER, not from the surveyor's.
// A cave drawing stores aligned scans as ABSOLUTE paths: on Truitt Cave
// all 44 of them read out of a Google Drive folder carrying the
// surveyor's name and email. Left alone that is a student whose copy
// shows no sketches -- or, on the same machine, a "teaching" drawing
// quietly reading the real cave folder -- and a personal path travelling
// in a file meant to be handed to strangers.
var stillPointingHome = [];
var repointed = 0;
ids = checkDoc.queryAllEntities(false, false);
for (i = 0; i < ids.length; i++) {
    var img = checkDoc.queryEntity(ids[i]);
    if (isNull(img) || img.getType() !== RS.EntityImage) { continue; }
    var where = String(img.getFileName());
    if (where.indexOf(realFolder) === 0) {
        stillPointingHome.push(where);
    } else if (where.indexOf(masterFolder) === 0) {
        repointed += 1;
    }
}
eqs(stillPointingHome.length, 0,
    "no scan still points into the real cave folder (" +
        stillPointingHome.join(", ") + ")");
eqs(repointed, 1,
    "and the sketch reads from the teaching folder instead -- not " +
        "merely dropped, which would be a copy with no sketches to " +
        "trace");

// Sketches travel; plotted maps do not.
ok((new QFileInfo(masterFolder + "/scans/trip1-page1.png")).exists(),
    "the field sketch came along -- tracing a real one is most of " +
        "what a student is here to learn");
ok(!(new QFileInfo(masterFolder + "/PDF/Truitt Cave 2026.pdf")).exists(),
    "the plotted map did NOT -- its title block carries a location " +
        "somebody typed, which this tool cannot strip");

// ---------------------------------------------------------------------
// Handing it out, ruining it, and putting it back.
// ---------------------------------------------------------------------

var first = TeachingCave.reset(caveRoot, "Truitt Cave");
ok(first.ok === true, "the first hand-out worked (" + first.error + ")");
ok(first.repointed >= 1,
    "and the student's copy reads its OWN scans -- a byte copy of the " +
        "master leaves them reading the master's, which breaks the " +
        "moment it moves and shares one folder between every copy");
var working = CsTeach.workingFor(caveRoot, "Truitt Cave");
ok((new QFileInfo(CsTeach.drawingIn(working, "Truitt Cave"))).exists(),
    "the student has a drawing to open");

// The student ruins it and leaves something of their own behind.
var ruin = new QFile(working + "/Truitt Cave.dxf");
ruin.open(QIODevice.WriteOnly);
ruin.write(new QByteArray("the student broke it"));
ruin.close();
var homework = new QFile(working + "/my notes.txt");
homework.open(QIODevice.WriteOnly);
homework.write(new QByteArray("mine"));
homework.close();

var again = TeachingCave.reset(caveRoot, "Truitt Cave");
ok(again.ok === true, "a second reset worked (" + again.error + ")");
// SIZE, not content: String(QByteArray) comes back truncated in this
// bridge (a 1 MB drawing read back as 15 characters), so the check that
// the ruined stub is gone is made on the file itself.
var ruinedSize = 20;   // what the student wrote, in bytes
var restoredSize = (new QFileInfo(working + "/Truitt Cave.dxf")).size();
var masterSize = (new QFileInfo(masterDrawing)).size();
ok(restoredSize > ruinedSize,
    "the ruined drawing was replaced, not kept (" + restoredSize +
        " bytes)");
// NOT byte for byte: the working copy is the pristine drawing with its
// scan paths pointed at its OWN scans folder, so it differs from the
// master by exactly the length of those paths. Same drawing, different
// address book.
ok(Math.abs(restoredSize - masterSize) < masterSize * 0.05,
    "and what came back is the pristine drawing, re-pointed at the " +
        "student's own scans (" + restoredSize + " against the " +
        "master's " + masterSize + ")");
ok(!(new QFileInfo(working + "/my notes.txt")).exists(),
    "and the student's leftovers went with it -- a reset is a reset");

// The student's copy points at the student's copy, not at the master.
var workingDi = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
ok(workingDi.importFile(CsTeach.drawingIn(working, "Truitt Cave"), "",
    false) === RDocumentInterface.IoErrorNoError,
    "the student's drawing reads back");
var workingDoc = workingDi.getDocument();
var atMaster = 0, atWorking = 0;
ids = workingDoc.queryAllEntities(false, true);
for (i = 0; i < ids.length; i++) {
    var wi = workingDoc.queryEntity(ids[i]);
    if (isNull(wi) || wi.getType() !== RS.EntityImage) { continue; }
    var wf = String(wi.getFileName());
    if (wf.indexOf(working) === 0) { atWorking += 1; }
    else if (wf.indexOf(masterFolder) === 0) { atMaster += 1; }
}
eqs(atMaster, 0, "no scan in the student's copy reads from the master");
ok(atWorking >= 1, "they read from the student's own folder");

// THE REAL CAVE IS UNTOUCHED, through all of that.
var realCheck = new RDocumentInterface(
    new RDocument(new RMemoryStorage(), createSpatialIndex()));
ok(realCheck.importFile(drawingPath, "", false) ===
    RDocumentInterface.IoErrorNoError, "the real cave still reads");
var realDoc = realCheck.getDocument();
var stillThere = 0;
ids = realDoc.queryAllEntities(false, false);
for (i = 0; i < ids.length; i++) {
    var re = realDoc.queryEntity(ids[i]);
    if (!isNull(re) && CsTags.get(re, "GeoLat") === "38.123456") {
        stillThere += 1;
    }
}
eqs(stillThere, 1,
    "the real cave still carries its own location -- the teaching " +
        "cave reads it and never writes to it");
ok((new QFileInfo(realFolder + "/PDF/Truitt Cave 2026.pdf")).exists(),
    "and its plotted map is where the surveyor left it");

// ---------------------------------------------------------------------
// The guard on the recursive delete.
// ---------------------------------------------------------------------

var elsewhere = root + "/somewhere else";
ok((new QDir()).mkpath(elsewhere), "made a folder outside the teaching area");
var decoy = new QFile(elsewhere + "/precious.dxf");
decoy.open(QIODevice.WriteOnly);
decoy.write(new QByteArray("not yours to delete"));
decoy.close();
// A reset can only ever be aimed by CsTeach.workingFor, so the guard is
// asserted at the level it actually protects: the predicate the tool
// checks before it deletes anything.
ok(!CsTeach.isTeaching(caveRoot, elsewhere),
    "a folder outside the teaching area is refused by the guard");
ok((new QFileInfo(elsewhere + "/precious.dxf")).exists(),
    "and nothing outside the teaching area was touched");

try {
    (new QDir(root)).removeRecursively();
} catch (eClean) {
}

if (failures.length === 0) {
    print("### TEACHING CAVE OK");
} else {
    print("### TEACHING CAVE FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
