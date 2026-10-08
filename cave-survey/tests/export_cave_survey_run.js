// export_cave_survey_run.js -- drives ExportCaveSurvey's OWN entry
// point, not just the Core library it calls.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/export_cave_survey_run.js "$PWD"
//
// Written for the same reason tests/generate_profile_run.js was: the
// Core writers already have thorough round-trip coverage in
// tests/js_unit.js, and none of it proves the TOOL reaches them, reads
// the drawing it claims to read, or -- the claim this file exists for
// -- keeps the cave's location out of the file it writes.
//
// The whole chain runs for real: a survey with fixed control is drawn
// into an off-screen document with CsDraw.survey (which records the
// control in a Fixed tag), the tool reconstructs it with
// CsRevise.resolveAsDrawn, and the bytes it wrote are then read back
// off disk. No stub stands between the fixture and the file except the
// four GUI calls (the save dialog, the two message boxes, warning)
// that cannot exist headlessly.
//
// HOW A TOOL'S entry point GETS DRIVEN HEADLESSLY: getDocument() and
// getDocumentInterface() are plain global functions and are reassigned
// here to a real off-screen RDocument/RDocumentInterface pair -- see
// tests/generate_profile_run.js's header for the full account of why
// that is the fix rather than a workaround.

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

// The real include(), in the sequence QCAD itself runs for a menu
// click -- see tests/generate_profile_run.js's loader note.
include("scripts/EAction.js");
include("scripts/simple.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/ExportCaveSurvey";
include(includeBasePath + "/ExportCaveSurvey.js");

// ---------------------------------------------------------------------
// Assertion harness -- the shape tests/js_unit.js and
// tests/generate_profile_run.js both use.
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
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

// Searched with grep rather than by reading the bytes here: QFile's
// readAll() hands this engine a QByteArray whose size() is 0 and whose
// indexOf() is undefined, so a byte search written that way silently
// answers "found" for everything -- the identical trap
// tests/package_cave.js documents, and a privacy check that always
// answered "not found" would pass this file while proving nothing.
function fileHas(path, needle) {
    var process = new QProcess();
    process.start("/usr/bin/grep", ["-c", "-a", needle, path]);
    if (!process.waitForFinished(10000)) {
        process.kill();
        return false;
    }
    return process.exitCode() === 0;
}

function fileExists(path) {
    return (new QFileInfo(path)).exists();
}

// ---------------------------------------------------------------------
// Fixture: a real off-screen drawing carrying a real, tagged survey
// whose entrance is fixed at a real-world control.
//
// The coordinates are a UTM easting/northing and an absolute datum
// elevation, because that is what a cave tied to a GPS'd entrance
// actually carries -- and with no anchor passed to resolve, that is
// where the cave gets DRAWN (CsNetwork.resolve seeds fixed stations at
// their control), which is the whole reason the Fixed tag ends up
// holding the entrance.
// ---------------------------------------------------------------------

var EAST = "512345";
var NORTH = "4287654";

var fixtureDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var fixtureDi = new RDocumentInterface(fixtureDoc);
getDocument = function() { return fixtureDoc; };
getDocumentInterface = function() { return fixtureDi; };

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

var fixtureSurvey = CsModel.newSurvey();
fixtureSurvey.caveName = "Export Test Cave";
fixtureSurvey.distanceUnit = "ft";
fixtureSurvey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0));
fixtureSurvey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0));
fixtureSurvey.shots.push(shotOf("A2", "A3", 18.5, 350.0, 3.0));
fixtureSurvey.fixed["ENT"] = { x: 512345.67, y: 4287654.32, z: 1250.0 };

var fixtureResolved = CsAdjust.resolveAndAdjust(fixtureSurvey, {});
CsDraw.survey(fixtureSurvey, fixtureResolved);

// The fixture must carry what the export is about to leave out, or
// nothing below proves anything.
var reconCheck = CsRevise.resolveAsDrawn(fixtureDoc);
ok(reconCheck !== null, "the fixture drawing reconstructs into a survey");
ok(reconCheck !== null && reconCheck.survey.fixed.hasOwnProperty("ENT"),
    "the fixture drawing really does carry its fixed control");

// ---------------------------------------------------------------------
// The GUI, spied on: the save dialog, both message boxes, and warning.
// ---------------------------------------------------------------------

var outDir = QDir.tempPath() + "/CaveCADExportTest";
try {
    if ((new QDir(outDir)).exists()) { (new QDir(outDir)).removeRecursively(); }
} catch (eWipe) {
}
ok((new QDir()).mkpath(outDir), "made a folder to export into");

var savedSaveFile = CsFiles.saveFile;
var savedQuestion = QMessageBox.question;
var savedInformation = QMessageBox.information;
var savedWarning = (typeof warning === "function") ? warning : null;

var spy;
function runExport(path, answerYes) {
    spy = { path: path, questions: [], informations: [], warnings: [] };
    CsFiles.saveFile = function() { return spy.path; };
    QMessageBox.question = function(parent, title, text) {
        spy.questions.push(text);
        return answerYes ? QMessageBox.Yes : QMessageBox.No;
    };
    QMessageBox.information = function(parent, title, text) {
        spy.informations.push(text);
    };
    warning = function(text) { spy.warnings.push(text); };
    try {
        exportCaveSurvey();
    } finally {
        CsFiles.saveFile = savedSaveFile;
        QMessageBox.question = savedQuestion;
        QMessageBox.information = savedInformation;
        if (savedWarning !== null) { warning = savedWarning; }
    }
    return spy;
}

// ---------------------------------------------------------------------
// Survex, declining the control: the file has the cave and not the
// entrance.
// ---------------------------------------------------------------------

var svxPath = outDir + "/export-test.svx";
var svxRun = runExport(svxPath, false);

eqs(svxRun.warnings.length, 0, "a good export warns about nothing");
eqs(svxRun.questions.length, 1,
    "a survey with control asks once about including it");
ok(svxRun.questions[0].indexOf("ENT") !== -1,
    "the question names the station carrying the control");
ok(fileExists(svxPath), "the Survex file was written");
ok(fileHas(svxPath, "A1"), "the exported survey carries its stations");
ok(fileHas(svxPath, "ENT"), "including the entrance station itself");
ok(!fileHas(svxPath, EAST),
    "a declined export carries no easting");
ok(!fileHas(svxPath, NORTH),
    "a declined export carries no northing");
ok(!fileHas(svxPath, "\\*fix"),
    "a declined export writes no *fix directive");

// The report reaches the user as a message box, not through
// EAction.handleUserMessage, and really is multi-line -- the same
// newline-collapsing trap tests/generate_profile_run.js documents.
eqs(svxRun.informations.length, 1,
    "the export reports through QMessageBox.information exactly once");
ok(svxRun.informations[0].indexOf("\n") !== -1,
    "the report is multi-line");
ok(svxRun.informations[0].indexOf("left out") !== -1,
    "the report says the location was left out");
ok(svxRun.informations[0].indexOf("Survex") !== -1,
    "the report names the format it wrote");

// Exporting must not damage the drawing it read.
var afterExport = CsRevise.resolveAsDrawn(fixtureDoc);
ok(afterExport !== null && afterExport.survey.fixed.hasOwnProperty("ENT"),
    "the drawing still carries its control after a sanitized export");
eqs(afterExport === null ? -1 : afterExport.survey.shots.length,
    reconCheck.survey.shots.length,
    "the drawing still carries every shot after an export");

// ---------------------------------------------------------------------
// Survex, accepting the control: the same survey, tied to the world.
// ---------------------------------------------------------------------

var fullPath = outDir + "/export-test-full.svx";
var fullRun = runExport(fullPath, true);

eqs(fullRun.questions.length, 1, "the full export asks the same once");
ok(fileExists(fullPath), "the full Survex file was written");
ok(fileHas(fullPath, EAST), "an accepted export carries the easting");
ok(fileHas(fullPath, NORTH), "an accepted export carries the northing");
ok(fullRun.informations.length === 1 &&
    fullRun.informations[0].indexOf("INCLUDED") !== -1,
    "the report says so in as many words when the location is included");

// ---------------------------------------------------------------------
// Walls: the second writer that emits a fix directive.
// ---------------------------------------------------------------------

var srvPath = outDir + "/export-test.srv";
var srvRun = runExport(srvPath, false);
ok(fileExists(srvPath), "the Walls file was written");
ok(!fileHas(srvPath, EAST), "a declined Walls export carries no easting");
ok(!fileHas(srvPath, "#Fix"), "a declined Walls export writes no #Fix");
ok(fileHas(srvPath, "A1"), "the Walls export still carries the survey");

// ---------------------------------------------------------------------
// Therion: the newest writer, and therefore the newest way to leak.
// It reaches the same gate as the two older ones.
// ---------------------------------------------------------------------

var thPath = outDir + "/export-test.th";
var thRun = runExport(thPath, false);
eqs(thRun.questions.length, 1, "a Therion export is asked about the control");
ok(fileExists(thPath), "the Therion file was written");
ok(!fileHas(thPath, EAST), "a declined Therion export carries no easting");
ok(!fileHas(thPath, "fix "), "a declined Therion export writes no fix line");
ok(fileHas(thPath, "A1"), "the Therion export still carries the survey");

var thFullPath = outDir + "/export-test-full.th";
runExport(thFullPath, true);
ok(fileHas(thFullPath, EAST),
    "and an accepted Therion export does carry it -- so the check above " +
    "is not passing because nothing was ever written");

// ---------------------------------------------------------------------
// Compass: no fix directive exists in the format, so the question is
// never asked -- and the report says why rather than going quiet.
// ---------------------------------------------------------------------

var datPath = outDir + "/export-test.dat";
var datRun = runExport(datPath, false);
eqs(datRun.questions.length, 0,
    "Compass is never asked about a control it cannot express");
ok(fileExists(datPath), "the Compass file was written");
ok(!fileHas(datPath, EAST), "the Compass export carries no easting");
ok(datRun.informations.length === 1 &&
    datRun.informations[0].indexOf("no fix line") !== -1,
    "the report explains why Compass was not asked");

// ---------------------------------------------------------------------
// CSV: the third emitter, and the one whose fix line is a comment.
// ---------------------------------------------------------------------

var csvPath = outDir + "/export-test.csv";
runExport(csvPath, false);
ok(fileExists(csvPath), "the CSV file was written");
ok(!fileHas(csvPath, EAST), "a declined CSV export carries no easting");
ok(!fileHas(csvPath, "# fix"), "a declined CSV export writes no fix comment");

// ---------------------------------------------------------------------
// Cancelling the save dialog writes nothing and says nothing.
// ---------------------------------------------------------------------

var cancelled = runExport("", false);
eqs(cancelled.informations.length, 0, "a cancelled export reports nothing");
eqs(cancelled.warnings.length, 0, "a cancelled export is not an error");
eqs(cancelled.questions.length, 0,
    "a cancelled export never gets as far as the control question");

// ---------------------------------------------------------------------
// A drawing with no survey in it is refused in plain language.
// ---------------------------------------------------------------------

var emptyDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var emptyDi = new RDocumentInterface(emptyDoc);
getDocument = function() { return emptyDoc; };
getDocumentInterface = function() { return emptyDi; };

var emptyPath = outDir + "/never-written.svx";
var emptyRun = runExport(emptyPath, false);
eqs(emptyRun.warnings.length, 1, "an empty drawing warns once");
ok(emptyRun.warnings[0].indexOf("no tagged survey stations") !== -1,
    "and says what is missing");
ok(!fileExists(emptyPath), "an empty drawing writes no file");

getDocument = function() { return fixtureDoc; };
getDocumentInterface = function() { return fixtureDi; };

// ---------------------------------------------------------------------
// A survey with no control at all asks nothing, and says so.
// ---------------------------------------------------------------------

var plainDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var plainDi = new RDocumentInterface(plainDoc);
getDocument = function() { return plainDoc; };
getDocumentInterface = function() { return plainDi; };

var plainSurvey = CsModel.newSurvey();
plainSurvey.caveName = "No Control Cave";
plainSurvey.distanceUnit = "ft";
plainSurvey.shots.push(shotOf("B1", "B2", 12.0, 180.0, 0.0));
CsDraw.survey(plainSurvey, CsAdjust.resolveAndAdjust(plainSurvey, {}));

var plainPath = outDir + "/no-control.svx";
var plainRun = runExport(plainPath, false);
eqs(plainRun.questions.length, 0,
    "a survey with no control is never asked about one");
ok(fileExists(plainPath), "it exports anyway");
ok(plainRun.informations.length === 1 &&
    plainRun.informations[0].indexOf("none recorded") !== -1,
    "and the report says there was no location to leave out");

try {
    (new QDir(outDir)).removeRecursively();
} catch (eClean) {
}

var out;
if (failures.length === 0) {
    out = "### EXPORT CAVE SURVEY OK " + passed;
} else {
    out = "### EXPORT CAVE SURVEY FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
