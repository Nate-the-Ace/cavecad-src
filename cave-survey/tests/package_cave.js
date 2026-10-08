// package_cave.js -- Package Cave Project against real files.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/package_cave.js "$PWD"
//
// What only a real run can show: that the sanitized copy actually
// LOSES the geographic anchor while keeping the survey (both survive a
// DXF round trip as XDATA, so a strip that silently did nothing would
// look identical from the outside), that the full copy keeps it, and
// that the platform's own zip program really produces an archive.
//
// Prints "### PACKAGE CAVE OK <n>" or "### PACKAGE CAVE FAIL".

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Indirect eval, so the Cs* globals outlive this function -- see
    // tests/callout_write.js, which documents the failure the direct
    // form causes.
    (0, eval)(src);
}

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

var FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsCave.js",
    "scripts/CaveSurvey/Core/CsShelf.js",
    "scripts/CaveSurvey/Core/CsPackage.js",
    "scripts/CaveSurvey/Core/CsGeoProject.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    // The survey model and the writers: stageData exports through the
    // format registry, so the data/ checks below need the real ones.
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/Format/CsCompass.js",
    "scripts/CaveSurvey/Core/Format/CsWalls.js",
    "scripts/CaveSurvey/Core/Format/CsSurvex.js",
    "scripts/CaveSurvey/Core/Format/CsCsv.js",
    "scripts/CaveSurvey/Core/Format/CsTherion.js",
    "scripts/CaveSurvey/Core/Format/CsRegistry.js",
    // The basemap eraser. stageDrawing REFUSES to write a sanitized
    // copy without it -- deliberately, since a sanitized copy that
    // cannot strip imagery is not sanitized -- so this suite has to
    // load it or it is testing the refusal instead of the erase.
    "scripts/CaveSurvey/Core/CsSurfaceData.js",
    // The layer registry, because the sanitizer now reaches through
    // layers that refuse edits -- an aerial photograph lives on one
    // that is switched off, and without CsLayers the sanitizer threw
    // and wrote nothing at all.
    "scripts/CaveSurvey/Core/CsLayers.js",
    "scripts/CaveSurvey/Core/CsLayerVariants.js",
    // The sanitizer itself, which stageDrawing now delegates to: one
    // copy of the suite's first rule, shared with the teaching cave.
    "scripts/CaveSurvey/Core/CsSanitize.js",
    "scripts/CaveSurvey/PackageCave/PackageCave.js"
];
for (var fi = 0; fi < FILES.length; fi++) {
    loadRepoScript(FILES[fi]);
}

var passed = 0;
var failures = [];
function ok(c, what) { if (c) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}

// ---------------------------------------------------------------------
// A cave folder, built for real in the temp directory.
// ---------------------------------------------------------------------

var root = QDir.tempPath() + "/CaveCADPackageTest";
try {
    if ((new QDir(root)).exists()) { (new QDir(root)).removeRecursively(); }
} catch (eWipe) {
}

var caveFolder = root + "/PITFALL CAVE";
var stagingFolder = root + "/staging/PITFALL CAVE";
ok((new QDir()).mkpath(caveFolder), "made a cave folder");
ok((new QDir()).mkpath(caveFolder + "/PDF"), "made its PDF folder");
ok((new QDir()).mkpath(caveFolder + "/scans"), "made its scans folder");
ok((new QDir()).mkpath(stagingFolder), "made a staging folder");

// A drawing carrying both survey data and the entrance location.
var drawingPath = caveFolder + "/Pitfall Cave.dxf";
var di = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                              new RSpatialIndexNavel()));
var doc = di.getDocument();
getDocument = function() { return doc; };

var station = new RPointEntity(doc, new RPointData(new RVector(0, 0, 0)));
CsTags.set(station, "Station", "A1");
CsTags.set(station, "GeoLat", "38.123456");
CsTags.set(station, "GeoLon", "-86.654321");
CsTags.set(station, "GeoStation", "A1");
var addOp = new RAddObjectsOperation();
addOp.addObject(station, false);
di.applyOperation(addOp);

// A georeferenced basemap image, tagged exactly as CsSurfaceData tags
// one before it is ever added to a document. This is the entry that
// must NOT survive sanitizing: the geo tags are stripped elsewhere, but
// an aerial photograph carries the entrance location baked into the
// raster itself, so a sanitized copy that keeps the image has hidden
// nothing. Points at a real file in testdata so the entity is not a
// dangling reference.
var aerialFile = repoRoot + "/testdata/Elevation_3DEP_64.tif";
var basemap = new RImageEntity(doc, new RImageData(
    aerialFile,
    new RVector(0, 0),
    new RVector(1, 0),          // u: one pixel across
    new RVector(0, 1),          // v: one pixel up
    64, 64, 0));
CsTags.set(basemap, "AerialBasemap", "1");
var imgOp = new RAddObjectsOperation();
imgOp.addObject(basemap, false);
di.applyOperation(imgOp);

var filter = PackageCave.dxfFilter();
ok(filter !== "", "found the dxflib exporter, the one that writes XDATA");
ok(di.exportFile(drawingPath, filter), "wrote the cave's drawing");
destr(di);

// A plotted map and a sketch, so the collectors have something to find.
writeTextFile(caveFolder + "/PDF/Pitfall Cave plan.pdf", "%PDF-1.4 not really");
writeTextFile(caveFolder + "/scans/trip1-p1.txt", "sketch stand-in");

// ---------------------------------------------------------------------
// The registry finds the drawing, and the PDF folder.
// ---------------------------------------------------------------------

var record = CsShelf.recordFor(caveFolder);
ok(record !== null, "built a record for the cave folder");
eqs(record.name, "PITFALL CAVE", "the cave is named after its folder");
eqs(record.drawing, drawingPath, "picked the drawing out of the folder");
eqs(CsCave.pdfFiles(caveFolder).length, 1, "found the map in PDF/");

// ---------------------------------------------------------------------
// Sanitized loses the anchor; full keeps it.
// ---------------------------------------------------------------------

function geoTagsIn(path) {
    var readDi = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                                      new RSpatialIndexNavel()));
    var found = { geo: 0, stations: 0, basemaps: 0 };
    try {
        if (readDi.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return found;
        }
        var readDoc = readDi.getDocument();
        var ids = readDoc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = readDoc.queryEntity(ids[i]);
            if (isNull(e)) { continue; }
            if (CsTags.get(e, "AerialBasemap") === "1") {
                found.basemaps++;
            }
            // Non-EMPTY, not merely non-null: CsTags.get answers ""
            // for an entity that carries no such tag, so the loose
            // check counted the basemap image as a station the moment
            // the fixture grew a second entity.
            var stTag = CsTags.get(e, "Station");
            if (stTag !== null && stTag !== undefined && stTag !== "") {
                found.stations++;
            }
            for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
                var v = CsTags.get(e, CsPackage.GEO_TAGS[t]);
                if (v !== null && v !== undefined && v !== "") { found.geo++; }
            }
        }
    } finally {
        destr(readDi);
    }
    return found;
}

// The fixture itself must carry what we are about to strip, or the
// test proves nothing.
var before = geoTagsIn(drawingPath);
eqs(before.geo, 3, "the original drawing carries all three geo tags");
eqs(before.stations, 1, "the original drawing carries its station");
eqs(before.basemaps, 1, "the original drawing carries the aerial basemap");

var sanitized = PackageCave.stageDrawing(record, stagingFolder, false);
ok(sanitized.ok, "staged a sanitized drawing: " + sanitized.error);
eqs(sanitized.stripped, 1, "stripped the anchor from one station");
var after = geoTagsIn(stagingFolder + "/Pitfall Cave.dxf");
eqs(after.geo, 0, "the sanitized copy carries no geographic anchor");
eqs(after.stations, 1, "the sanitized copy still carries the survey");
// The reason this assertion exists: the erase used to run behind a
// quiet "if the eraser is available" guard, which silently stopped
// firing when the tool it named was merged away. Nothing failed. The
// sanitized copy would simply have kept the photograph.
eqs(after.basemaps, 0,
    "the sanitized copy carries no aerial imagery");
eqs(sanitized.basemaps, 1, "and says it erased the one it found");

// The original is untouched -- the whole reason sanitizing happens on a
// copy in memory.
eqs(geoTagsIn(drawingPath).geo, 3, "the original drawing is unchanged");

var fullFolder = root + "/staging-full/PITFALL CAVE";
ok((new QDir()).mkpath(fullFolder), "made a second staging folder");
var full = PackageCave.stageDrawing(record, fullFolder, true);
ok(full.ok, "staged a full copy: " + full.error);
eqs(geoTagsIn(fullFolder + "/Pitfall Cave.dxf").geo, 3,
    "the full archive keeps the anchor");
eqs(geoTagsIn(fullFolder + "/Pitfall Cave.dxf").basemaps, 1,
    "and keeps the aerial imagery it was told to keep");

// ---------------------------------------------------------------------
// Photographs: the metadata has to be gone, and the picture still there.
// ---------------------------------------------------------------------

var imagesFolder = caveFolder + "/images";
ok((new QDir()).mkpath(imagesFolder), "made the cave's images folder");

// A real JPEG carrying real GPS EXIF (testdata/exif-gps-sample.jpg,
// built by hand: an APP1 segment with a GPS IFD). Testing the strip
// against a picture with nothing to strip would prove nothing.
var exifSource = repoRoot + "/testdata/exif-gps-sample.jpg";
ok((new QFileInfo(exifSource)).exists(), "the EXIF fixture is present");
ok((new QFile(exifSource)).copy(imagesFolder + "/entrance.jpg"),
    "put a photograph in the cave");
// The generated map preview lives in the same folder and must never be
// packaged: the drawing it pictures is already in the archive.
writeTextFile(imagesFolder + "/Pitfall Cave preview.png", "not a photograph");

// Searched with grep rather than by reading the bytes here: QFile's
// readAll() hands this engine a QByteArray whose size() is 0 and whose
// indexOf() is undefined, so a byte search written that way silently
// answers "found" for everything -- which is how a broken strip would
// have passed this very test.
function fileHas(path, needle) {
    var process = new QProcess();
    process.start("/usr/bin/grep", ["-c", "-a", needle, path]);
    if (!process.waitForFinished(10000)) {
        process.kill();
        return false;
    }
    // The EXIT CODE, not the output: grep answers 0 when it found the
    // needle and 1 when it did not, while readAllStandardOutput() hands
    // this engine an object whose String() is a description rather than
    // the bytes -- parse that and every answer is "found".
    return process.exitCode() === 0;
}

eqs(CsCave.imageFiles(caveFolder).length, 1,
    "the preview is not counted as a photograph");
ok(fileHas(imagesFolder + "/entrance.jpg", "Exif"),
    "the photograph really does carry EXIF before packaging");

var photoStage = root + "/staging/PITFALL CAVE/images";
var photoResult = PackageCave.copyPhotosStripped(
    CsCave.imageFiles(caveFolder), photoStage);
eqs(photoResult.copied, 1, "the photograph was packaged");
eqs(photoResult.skipped.length, 0, "nothing had to be left out");

var packed = photoStage + "/entrance.jpg";
ok((new QFileInfo(packed)).exists(), "the stripped photograph exists");
ok(!fileHas(packed, "Exif"), "no EXIF marker survives packaging");
ok(!fileHas(packed, "GPS"), "no GPS block survives packaging");

// Stripped, not destroyed: it still has to BE the photograph.
var packedImage = new QImageReader(packed).read();
ok(!isNull(packedImage) && !packedImage.isNull(),
    "the packaged photograph is still a readable image");
eqs(packedImage.width(), 16, "same width as the original");
eqs(packedImage.height(), 16, "same height as the original");

// ---------------------------------------------------------------------
// data/ -- the third route the entrance takes out of a drawing.
//
// The geo tags are stripped from the drawing and the aerial never
// travels, but the survey model carries the same secret in
// survey.fixed: the #Fix / *fix control of the file it was imported
// from, which on the ordinary import IS the entrance in UTM. Three of
// the four writers emit it.
// ---------------------------------------------------------------------

var dataSurvey = CsModel.newSurvey();
dataSurvey.caveName = "PITFALL CAVE";
dataSurvey.distanceUnit = "ft";
var dataShot = CsModel.newShot();
dataShot.from = "A1"; dataShot.to = "A2";
dataShot.distance = 30.0; dataShot.azimuth = 90.0; dataShot.inclination = -5.0;
dataSurvey.shots.push(dataShot);
dataSurvey.fixed["A1"] = { x: 512345.67, y: 4287654.32, z: 1250.0 };

var dataSan = root + "/staging-data-san";
var dataFull = root + "/staging-data-full";
ok((new QDir()).mkpath(dataSan), "made a staging folder for sanitized data");
ok((new QDir()).mkpath(dataFull), "made a staging folder for full data");

var sanWritten = PackageCave.stageData(dataSurvey, dataSan, "PITFALL CAVE", false);
eqs(sanWritten.length, CsFormatRegistry.FORMATS.length,
    "a sanitized package still exports every format");

var fullWritten = PackageCave.stageData(dataSurvey, dataFull, "PITFALL CAVE", true);
eqs(fullWritten.length, CsFormatRegistry.FORMATS.length,
    "so does a full archive");
// Named rather than counted as well, so that a format silently failing
// to stage (stageData swallows one writer's refusal on purpose) cannot
// leave this file green with a shorter list than the registry holds.
eqs(sanWritten.join(","),
    "pitfall-cave.dat,pitfall-cave.srv,pitfall-cave.svx," +
    "pitfall-cave.th,pitfall-cave.csv",
    "every registered format really reached data/");

// The fixture must carry what we are about to strip, or this proves
// nothing -- the same rule the geo-tag test above keeps.
ok(fileHas(dataFull + "/data/pitfall-cave.srv", "512345.67"),
    "the full archive's Walls file really does carry the control");
ok(fileHas(dataFull + "/data/pitfall-cave.svx", "512345.67"),
    "and so does its Survex file");
ok(fileHas(dataFull + "/data/pitfall-cave.th", "512345.67"),
    "and its Therion file");

for (var dfi = 0; dfi < sanWritten.length; dfi++) {
    var sanFile = dataSan + "/data/" + sanWritten[dfi];
    ok((new QFileInfo(sanFile)).exists(), sanWritten[dfi] + " was written");
    ok(!fileHas(sanFile, "512345"),
        sanWritten[dfi] + " carries no easting in a sanitized package");
    ok(!fileHas(sanFile, "4287654"),
        sanWritten[dfi] + " carries no northing in a sanitized package");
}

// Sanitized, not gutted: the cave's shape still travels.
ok(fileHas(dataSan + "/data/pitfall-cave.svx", "A1"),
    "the sanitized Survex file still carries the survey");

// And the caller's own survey is untouched, because a full archive of
// the same cave is written from it a moment later.
ok(dataSurvey.fixed.hasOwnProperty("A1"),
    "staging sanitized data leaves the survey it was given alone");

// ---------------------------------------------------------------------
// The contents tree the dialog is built from.
// ---------------------------------------------------------------------

// An aerial stand-in, so the entry that must never reach a sanitized
// package is present to check.
writeTextFile(CsGeoProject.imagePathFor(drawingPath), "aerial stand-in");

var tree = PackageCave.contentsOf(record);
var byKey = {};
var groupKeys = [];
for (var gi = 0; gi < tree.length; gi++) {
    groupKeys.push(tree[gi].key);
    for (var ci = 0; ci < tree[gi].children.length; ci++) {
        byKey[tree[gi].children[ci].kind] = tree[gi].children[ci];
    }
}
eqs(groupKeys.join(","), "root,pdf,scan,image",
    "the tree is the drawing and then one group per project folder");
ok(byKey.drawing !== undefined && byKey.drawing.forced === true,
    "the drawing is always in the package");
ok(byKey.manifest !== undefined && byKey.manifest.forced === true,
    "so is the manifest");
ok(byKey.data !== undefined && byKey.data.forced !== true,
    "the interchange exports are optional");
ok(byKey.aerial !== undefined, "the aerial photograph is listed");
eqs(byKey.aerial.sanitizedAllowed, false,
    "and can never be ticked into a sanitized package");
eqs(byKey.scan.sanitized, false, "sketches start off when sanitizing");
eqs(byKey.scan.full, true, "and on for a full archive");
eqs(byKey.pdf.sanitized, true, "plotted maps travel either way");
eqs(byKey.image.sanitized, false, "photographs start off when sanitizing");

// ---------------------------------------------------------------------
// The platform's own zip program really makes an archive.
// ---------------------------------------------------------------------

writeTextFile(stagingFolder + "/MANIFEST.txt",
    CsPackage.manifest({ caveName: "PITFALL CAVE", date: "2026-08-24",
        full: false, contents: [{ path: "Pitfall Cave.dxf", note: "the drawing" }] }));

var zipPath = root + "/" + CsPackage.archiveName("PITFALL CAVE", "2026-08-24", false);
var command = CsPackage.zipCommand(RS.getSystemId(), root + "/staging",
    "PITFALL CAVE", zipPath);
var zipped = PackageCave.runZip(command);
ok(zipped.ok, "the platform's zip program ran: " + zipped.error);
ok((new QFileInfo(zipPath)).exists(), "an archive exists where it was asked for");
ok((new QFileInfo(zipPath)).size() > 0, "the archive is not empty");

// ---------------------------------------------------------------------
// And unpacks again: Cave Shelf's Import reverses Package Cave.
// ---------------------------------------------------------------------
var unpackTo = root + "/unpacked";
(new QDir()).mkpath(unpackTo);
var unzipped = CsPackage.runCommand(
    CsPackage.unzipCommand(RS.getSystemId(), zipPath, unpackTo), 120);
ok(unzipped.ok, "the platform's unzip program ran: " + unzipped.error);
var top = new QDir(unpackTo);
var rootName = CsPackage.packageRoot(
    top.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0),
    top.entryList([], QDir.Files | QDir.NoDotAndDotDot, 0));
eqs(rootName, "PITFALL CAVE", "the package unpacks to its one cave folder");
ok((new QFileInfo(unpackTo + "/PITFALL CAVE/MANIFEST.txt")).exists(),
    "the files inside come back where they were");

try {
    (new QDir(root)).removeRecursively();
} catch (eClean) {
}

var out;
if (failures.length === 0) {
    out = "### PACKAGE CAVE OK " + passed;
} else {
    out = "### PACKAGE CAVE FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var i = 0; i < failures.length; i++) {
        out += "  FAIL: " + failures[i] + "\n";
    }
}
print(out);
