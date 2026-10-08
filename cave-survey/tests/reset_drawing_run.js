// reset_drawing_run.js -- Reset Drawing against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/reset_drawing_run.js "$PWD"
//
// Prints "### RESET DRAWING OK <n>" or "### RESET DRAWING FAIL".
//
// What CsReset's unit tests cannot prove, because they never hold a
// document: that the entities actually GO -- all of them, the placed
// images and the georeference included -- that a locked or switched-off
// layer does not silently keep what was on it, and that the cave's
// FOLDER comes through untouched, which is the whole reason emptying
// the drawing is survivable.
//
// THE LOCKED-LAYER CASE IS THE POINT OF THIS FILE. Off, frozen and
// locked layers refuse deletes in this build without a word, so a reset
// that did not reach through them would report "412 deleted" and leave
// the drawing holding whatever had been protected -- the same hole that
// once shipped a sanitized package with the aerial photograph still in
// it.

include("scripts/simple.js");

createSpatialIndex = function() {
    return new RSpatialIndexNavel();
};

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// The tool itself, not a copy of its shape: include() dedupes by
// basename, so its own re-include of CsAll.js is a no-op.
include("scripts/EAction.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/ResetDrawing";
include(includeBasePath + "/ResetDrawing.js");

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

// ---------------------------------------------------------------------
// A cave folder on disk, with one scanned page in it, and a drawing
// that sits in it.
// ---------------------------------------------------------------------
var caveDir = QDir.tempPath() + "/cs_reset_test";
var scansDir = caveDir + "/" + CsCave.SCANS;
new QDir(caveDir).removeRecursively();
new QDir().mkpath(scansDir);

var page = new QImage(200, 300, QImage.Format_RGB32);
page.fill(new QColor(255, 255, 255));
var pageRel = "Trip 1/page one.png";
new QDir().mkpath(scansDir + "/Trip 1");
ok(page.save(scansDir + "/" + pageRel, "PNG"), "the test page was written");

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
doc.setFileName(caveDir + "/Reset Test Cave.dxf");
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

ok(ResetDrawing.caveFolderOf(caveDir + "/Reset Test Cave.dxf") === caveDir,
    "a drawing beside a scans/ folder is in a cave project");
ok(ResetDrawing.caveFolderOf(QDir.tempPath() + "/loose.dxf") === null,
    "a drawing with no scans/ beside it is not, and the tool refuses it");

// ---------------------------------------------------------------------
// A survey, a scan, an aerial, some drawn linework, and one wall on a
// LOCKED layer.
// ---------------------------------------------------------------------
function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from; s.to = to;
    s.distance = d; s.azimuth = az; s.inclination = inc || 0;
    return s;
}
var survey = CsModel.newSurvey();
survey.caveName = "RESET TEST CAVE";
survey.distanceUnit = "ft";
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0));
CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);
CsLayers.ensure(doc, di, CsLayers.CTRL_AERIAL);
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);

var addOp = new RAddObjectsOperation();

var scan = new RImageEntity(doc, new RImageData());
scan.setProperty(RImageEntity.PropertyFileName, scansDir + "/" + pageRel);
scan.setProperty(RImageEntity.PropertyUX, 1.0);
scan.setProperty(RImageEntity.PropertyUY, 0.0);
scan.setProperty(RImageEntity.PropertyVX, 0.0);
scan.setProperty(RImageEntity.PropertyVY, 1.0);
scan.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(scan, "SketchScan", pageRel);
addOp.addObject(scan, false);

var aerial = new RImageEntity(doc, new RImageData());
aerial.setProperty(RImageEntity.PropertyFileName, scansDir + "/" + pageRel);
aerial.setLayerId(doc.getLayerId(CsLayers.CTRL_AERIAL));
addOp.addObject(aerial, false);

var wall = new RLineEntity(doc,
    new RLineData(new RVector(10, 0), new RVector(10, 20)));
wall.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
addOp.addObject(wall, false);

di.applyOperation(addOp);

// The wall's layer is LOCKED and the aerial's is OFF, which is how a
// real drawing arrives: CTRL-AERIAL ships off.
var lockOp = new RModifyObjectsOperation();
var wallLayer = doc.queryLayer(CsLayers.WALLS_SURVEYED);
wallLayer.setLocked(true);
lockOp.addObject(wallLayer, false);
var aerialLayer = doc.queryLayer(CsLayers.CTRL_AERIAL);
aerialLayer.setOff(true);
lockOp.addObject(aerialLayer, false);
di.applyOperation(lockOp);

// A georeference, on the anchor station -- where one really rides.
var stationIds = doc.queryAllEntities(false, false, RS.EntityPoint);
var anchorEntity = null;
for (var s0 = 0; s0 < stationIds.length; s0++) {
    var cand = doc.queryEntity(stationIds[s0]);
    if (!isNull(cand) && CsTags.get(cand, "Station") !== "") {
        anchorEntity = cand;
        break;
    }
}
ok(anchorEntity !== null, "the fixture has a station to georeference");
var anchorPos = anchorEntity.getPosition();
CsTags.commit(di, anchorEntity, {
    GeoLat: 34.5, GeoLon: -85.25, GeoStation: "ENT",
    GeoDrawX: anchorPos.x, GeoDrawY: anchorPos.y
});
ok(CsLocationPick.anchorRecord(doc) !== null,
    "and the drawing answers with it");

// ---------------------------------------------------------------------
// Reset.
// ---------------------------------------------------------------------
var split = ResetDrawing.classify(doc);
ok(split.counts.images === 2, "both images are counted, and counted apart");
ok(split.ids.length === split.counts.total,
    "everything counted is everything doomed -- the walk and the tally " +
    "cannot disagree (" + split.counts.total + ")");

ok(split.kinds.length === split.ids.length,
    "every doomed entity carries the kind the progress window names it " +
    "by, in the same order as the ids");

// A stand-in for the progress window: the real one needs a GUI, and
// what matters here is that the delete REPORTS -- a bar that never
// moves says "hung" as loudly as no bar at all.
var reported = [];
var fakeProgress = {
    say: function(t) { reported.push("say:" + t); },
    step: function(t, done, total) { reported.push(t); }
};

ResetDrawing.withEveryLayerEditable(doc, di, function() {
    ResetDrawing.deleteAll(doc, di, split.ids, split.kinds, fakeProgress);
});

ok(reported.length > 1, "the delete reported its progress more than once (" +
    reported.length + " updates)");
ok(reported[reported.length - 1].indexOf("say:Applying") === 0,
    "and ends by announcing the apply, which is one call and cannot be " +
    "counted -- better said than left at 99%");
var named = reported.join(" ");
ok(named.indexOf("survey data") !== -1 || named.indexOf("placed images") !== -1 ||
    named.indexOf("drawn linework") !== -1,
    "the updates name what is being removed");
CsRestyle.ensureAndApply(doc, di);

// -- what went ---------------------------------------------------------
var left = doc.queryAllEntities(false, false);
var survivors = 0;
for (var j = 0; j < left.length; j++) {
    if (!isNull(doc.queryEntity(left[j]))) {
        survivors++;
    }
}
ok(survivors === 0, "the drawing is empty -- including both images, the " +
    "wall on the LOCKED layer and the station that carried the " +
    "georeference (" + survivors + " survived)");

var images = doc.queryAllEntities(false, false, RS.EntityImage);
ok(images.length === 0, "no placed image is left: placing a scan and " +
    "fetching the aerial are lessons of their own, so leaving them " +
    "behind would skip them");

ok(CsLocationPick.anchorRecord(doc) === null,
    "and no georeference -- it rides an entity, and every entity went");

// -- what was NOT touched ---------------------------------------------
ok((new QFileInfo(scansDir + "/" + pageRel)).exists(),
    "the scanned page is still in the cave's scans/ folder -- the reset " +
    "empties a DRAWING, never a folder, which is what makes the cave " +
    "drawable again afterwards");

// -- the layer table is the template's again --------------------------
ok(doc.queryAllLayers().length > 50,
    "the template's layers are all there (" +
        doc.queryAllLayers().length + ")");
ok(doc.queryLayer(CsLayers.WALLS_SURVEYED).isLocked() === true,
    "the locked layer is locked again afterwards");
ok(doc.queryLayer(CsLayers.CTRL_AERIAL).isOff() === true,
    "and the layer that ships off is off again");

// -- running it twice is a no-op --------------------------------------
var again = ResetDrawing.classify(doc);
ok(again.counts.total === 0, "a second run finds nothing to delete");
var plan = CsReset.planReset({ hasDocument: true, isSheet: false,
    docPath: String(doc.getFileName()), inCaveFolder: true,
    caveName: "Reset Test Cave", counts: again.counts });
ok(plan.can === false,
    "and the tool refuses rather than writing a backup for no reason");

// ---------------------------------------------------------------------
// The state that lives OUTSIDE the drawing.
//
// Real settings and a real file, which is why this cannot be a unit
// test. The settings are put back exactly as they were found at the
// end: a test suite that leaves a caver's Complete marks cleared has
// done the very thing the tool is careful about.
// ---------------------------------------------------------------------
var marksBefore = String(RSettings.getStringValue(
    CsScanTree.SETTING_BOOKMARKS, ""));
var latBefore = RSettings.getDoubleValue(CsLocationPick.SETTING_LAT, -999);
var lonBefore = RSettings.getDoubleValue(CsLocationPick.SETTING_LON, -999);

// A Complete mark on this cave's page, a remembered location, and a
// thumbnail beside the drawing.
var marks = CsScanTree.parseCollapsed(marksBefore);
marks[scansDir] = [pageRel];
RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
    CsScanTree.serializeCollapsed(marks));
CsLocationPick.remember({ lat: 34.5, lon: -85.25 });

var previewPath = CsCave.previewPathFor(caveDir + "/Reset Test Cave.dxf");
new QDir().mkpath(CsCave.folderOf(previewPath));
ok(page.save(previewPath, "PNG"), "a map thumbnail was written");

var cleared = ResetDrawing.clearOutside(caveDir + "/Reset Test Cave.dxf");

ok(cleared.marks === true && cleared.location === true &&
    cleared.preview === true,
    "all three report as cleared, so the report cannot claim more than " +
    "was done");
var after = CsScanTree.parseCollapsed(String(
    RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, "")));
ok(after[scansDir] === undefined,
    "this cave's Complete marks are gone -- a student would otherwise " +
    "open Sketch Scans and find the pages already ticked off");
ok(RSettings.getDoubleValue(CsLocationPick.SETTING_LAT, -999) === -999,
    "the last-declared location is gone, so Set Cave Location starts " +
    "empty rather than one keystroke from the entrance it just forgot");
ok(!(new QFileInfo(previewPath)).exists(),
    "and the thumbnail, which would otherwise show the map that was " +
    "just deleted until the next save");

ok((new QFileInfo(scansDir + "/" + pageRel)).exists(),
    "clearing a mark never touches the page it was about");

var twice = ResetDrawing.clearOutside(caveDir + "/Reset Test Cave.dxf");
ok(twice.marks === false && twice.preview === false,
    "running it again clears nothing and says so rather than reporting " +
    "work it did not do");

// Put the caver's own settings back.
RSettings.setValue(CsScanTree.SETTING_BOOKMARKS, marksBefore);
if (latBefore > -999) { RSettings.setValue(CsLocationPick.SETTING_LAT, latBefore); }
if (lonBefore > -999) { RSettings.setValue(CsLocationPick.SETTING_LON, lonBefore); }
ok(String(RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, "")) ===
    marksBefore, "the suite left this machine's own marks as it found them");

new QDir(caveDir).removeRecursively();

var out;
if (failures.length === 0) {
    out = "### RESET DRAWING OK " + passed + " assertions";
} else {
    out = "### RESET DRAWING FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var f = 0; f < failures.length; f++) {
        out += "  FAIL: " + failures[f] + "\n";
    }
}
print(out);
