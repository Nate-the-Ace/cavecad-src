// scan_trim_run.js -- trimming a scanned page to one sketch.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_trim_run.js "$PWD"
//
// Prints "### SCAN TRIM OK" / "### SCAN TRIM FAIL".
//
// WHY A REAL IMAGE ON DISK. The whole mechanism is QImage.copy and a
// saved PNG. A stub would prove the filename arithmetic and nothing
// about the pixels, and an off-by-one in the crop origin passes every
// size check while ruining every placement.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(e) {
        return !isNull(e) && typeof e.getType === "function" &&
            e.getType() === RS.EntityImage;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
function loadRepoScript(rel) {
    var f = new QFile(repoRoot + "/" + rel);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var st = new QTextStream(f);
    var src = String(st.readAll());
    f.close();
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid", "CsUnits", "CsAngles", "CsCave", "CsScanTree", "CsStore",
 "CsTags", "CsLayers", "CsStationOrder", "CsScanFit", "CsScanFrame",
 "CsScanTrim", "CsScanPdf", "CsSanitize", "CsScanList"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

// SketchScans.js is a GUI tool: its top level does
// `SketchScans.prototype = new EAction();`. align_image_frame.js has the
// same problem with Transform and solves it the same way -- a stub
// underneath, loaded first. Only imageFiles, insert and insertFitted are
// exercised here.
if (typeof EAction === "undefined") {
    EAction = function() {};
    EAction.prototype = {};
    EAction.getDocument = function() { return null; };
    EAction.getDocumentInterface = function() { return null; };
    EAction.handleUserMessage = function() {};
}
if (typeof warning === "undefined") {
    warning = function(msg) { print("WARNING: " + msg); };
}
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}
if (typeof isNumber === "undefined") {
    isNumber = function(v) { return typeof v === "number" && !isNaN(v); };
}
// The scans list moved to Core when the Survey Notebook needed the
// same browser; SketchScans reads its tick and its renderer from there
// at LOAD time, so it has to come first.
loadRepoScript("scripts/CaveSurvey/Core/CsScanList.js");
loadRepoScript("scripts/CaveSurvey/SketchScans/SketchScans.js");

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}

// --- a throwaway cave with one scanned page -------------------------
var tmp = String(QDir.tempPath()) + "/cs-scan-trim-" +
    String(new Date().getTime());
var scans = tmp + "/Scans";
new QDir().mkpath(scans + "/Trip3");

var pxW = 600, pxH = 400;
var page = new QImage(pxW, pxH, QImage.Format_RGB32);
page.fill(0xffffffff);
// A single black marker pixel at column 250, row 120 -- inside the box
// the test cuts, 50 columns and 20 rows in from its corner.
page.setPixelColor(250, 120, new QColor(0, 0, 0));
var pagePath = scans + "/Trip3/IMG_4021.png";
check("the test page saved", page.save(pagePath, "PNG"));

// --- the crop -------------------------------------------------------
var rect = { x: 200, y: 100, w: 300, h: 200 };
var out = CsScanTrim.write(scans, "Trip3/IMG_4021.png", rect);
check("write reports no error", out.error === null);
check("the derivative exists", new QFileInfo(out.path).exists());
check("the derivative is named for its box",
    String(new QFileInfo(out.path).fileName()) ===
    "IMG_4021__TRIMMED_x200_y100_w300_h200.png");
check("the derivative sits in Scans/Trimmed",
    String(out.path).indexOf("/Scans/Trimmed/") >= 0);

var cropped = new QImage(out.path);
check("the derivative is the box's width", cropped.width() === 300);
check("the derivative is the box's height", cropped.height() === 200);
// THE PIXELS, not just the size.
check("the marker pixel landed at the box-relative offset",
    String(cropped.pixelColor(50, 20).name()) === "#000000");
check("and its neighbour did not",
    String(cropped.pixelColor(51, 20).name()) === "#ffffff");

// --- reuse ----------------------------------------------------------
var firstStamp = String(new QFileInfo(out.path).lastModified().toString());
var again = CsScanTrim.write(scans, "Trip3/IMG_4021.png", rect);
check("the same box resolves to the same file", again.path === out.path);
check("an existing derivative is reused, not rewritten",
    String(new QFileInfo(again.path).lastModified().toString()) ===
    firstStamp);

// --- failures -------------------------------------------------------
var bad = CsScanTrim.write(scans, "Trip3/does-not-exist.png", rect);
check("an unreadable page yields no path", bad.path === null);
check("and the error names the file",
    String(bad.error).indexOf("does-not-exist") >= 0);

// --- the shelf filter, against real paths ---------------------------
var listed = SketchScans.imageFiles(scans);
var sawPage = false, sawTrim = false;
for (var i = 0; i < listed.length; i++) {
    if (listed[i] === "Trip3/IMG_4021.png") { sawPage = true; }
    if (CsScanTrim.isTrimPath(listed[i])) { sawTrim = true; }
}
check("the page is still listed", sawPage);
check("no derivative is listed", !sawTrim);

// --- placement -------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var trimmedId = SketchScans.insert(doc, di, out.path,
    "Trip3/IMG_4021.png", "plan", rect);
check("the trimmed scan placed", trimmedId !== null);
var placedEntity = isNull(trimmedId) ? null : doc.queryEntity(trimmedId);
check("SketchScan still names the PAGE, so the shelf can still tick it",
    placedEntity !== null &&
    CsTags.get(placedEntity, "SketchScan") === "Trip3/IMG_4021.png");
check("ScanTrim names the box in the page's own pixels",
    placedEntity !== null &&
    CsTags.get(placedEntity, CsScanTrim.TAG) === "200,100,300,200");
// PIXELS, NOT UNITS. RImageEntity.getWidth() answers the image's width
// in DRAWING UNITS, so the pixel count comes back out of it through the
// u vector -- one u per pixel column is how RImageData is built.
var placedU = placedEntity.getUVector();
var placedPx = Math.round(placedEntity.getWidth() /
    Math.sqrt(placedU.x * placedU.x + placedU.y * placedU.y));
check("the placed image is the box's pixel width", placedPx === 300);
check("and it points at the derivative, not the page",
    String(placedEntity.getData().getFileName()) === String(out.path));

// The whole-page path is untouched.
var wholeId = SketchScans.insert(doc, di, pagePath,
    "Trip3/IMG_4021.png", "plan");
check("the whole page placed", wholeId !== null);
check("a whole-page placement carries no ScanTrim tag",
    wholeId !== null &&
    CsTags.get(doc.queryEntity(wholeId), CsScanTrim.TAG) === "");

// --- the view follows the scan --------------------------------------
//
// A placed scan is zoomed to, or the caver has to hunt for the page
// they just placed. Headless there is no view to move, which is one of
// the ways this has to not throw.
check("zooming to a placed scan never throws", (function () {
    try {
        SketchScans.zoomToPlaced(doc, di, trimmedId);
        SketchScans.zoomToPlaced(doc, di, null);
        SketchScans.zoomToPlaced(doc, di, -1);
        return true;
    } catch (eZoom) {
        return false;
    }
})());

// --- the page the DRAWING was left on --------------------------------
//
// The per-machine memory of the selected page does not travel with the
// cave: open it on the other laptop, or hand it to the other person on
// the trip, and the tree opens on page one. Where the caver has got to
// is part of the drawing's state, so it rides IN the drawing -- which
// is only true if it survives being written out and read back.
CsScanList.rememberInDrawing(doc, "Trip3/IMG_4021.png");
check("the drawing remembers the page",
    CsScanList.selectedInDrawing(doc) === "Trip3/IMG_4021.png");

var selPath = QDir.tempPath() + "/cs-scan-selected-" +
    String(new Date().getTime()) + ".dxf";
check("the drawing wrote out",
    di.exportFile(selPath, CsSanitize.dxfFilter(), false));
var reopened = new RDocument(new RMemoryStorage(), createSpatialIndex());
var reopenedDi = new RDocumentInterface(reopened);
reopenedDi.importFile(selPath);
check("and still names it after a save and a reopen -- the whole "
    + "point, since a variable that does not survive the DXF is no "
    + "memory",
    CsScanList.selectedInDrawing(reopened) === "Trip3/IMG_4021.png");
QFile.remove(selPath);

// A drawing that has never recorded one says so, rather than guessing.
var fresh = new RDocument(new RMemoryStorage(), createSpatialIndex());
check("a drawing with no record of a page answers null",
    CsScanList.selectedInDrawing(fresh) === null);
check("and so does no drawing at all",
    CsScanList.selectedInDrawing(null) === null);

// THE DRAWING WINS over this machine's memory: it came with the file,
// from whoever last worked on the cave.
check("the landing page is the one the drawing names",
    CsScanList.landingPage(doc, scans) === "Trip3/IMG_4021.png");
check("and falls back to this machine's memory when it names none",
    CsScanList.landingPage(fresh, scans) === CsScanList.selectedIn(scans));

// --- flushing the crops ---------------------------------------------
//
// The Trimmed folder is a scratch pad: a box moved by one pixel writes
// another file and nothing ever deleted one. Flushing empties it --
// except for the crops the open drawing is actually showing, which
// would blank somebody's underlay if they went.
var stray = CsScanTrim.write(scans, "Trip3/IMG_4021.png",
    { x: 10, y: 10, w: 120, h: 90 });
check("a second crop was written", stray.path !== null);

var allCrops = CsScanTrim.crops(scans);
check("both crops are found in the Trimmed folder", allCrops.length === 2);
check("and each one carries its size",
    allCrops[0].bytes > 0 && allCrops[1].bytes > 0);

var held = CsScanTrim.cropsInUse(doc);
check("the crop the drawing is showing reads as in use",
    held[String(out.path)] === true);
check("and the one nothing placed does not",
    held[String(stray.path)] !== true);

var flushed = CsScanTrim.flush(scans, held);
check("the stray was deleted", flushed.deleted === 1);
check("the one on the map was kept", flushed.kept === 1);
check("nothing refused to go", flushed.failed === 0);
check("and the freed bytes were counted", flushed.freed > 0);
check("the stray file is really gone",
    !(new QFileInfo(stray.path).exists()));
check("the placed crop is still there",
    new QFileInfo(out.path).exists());

// A SECOND FLUSH IS A NO-OP, not an error: the only crop left is the
// one being displayed.
var twice = CsScanTrim.flush(scans, held);
check("flushing again deletes nothing", twice.deleted === 0);
check("and still keeps the one in use", twice.kept === 1);

// NO DOCUMENT AT ALL -- a cave that is not open holds nothing, so
// every crop is a stray. This is the path the shelf takes.
var allGone = CsScanTrim.flush(scans, null);
check("with no drawing holding it, the last crop goes too",
    allGone.deleted === 1);
check("and the folder is empty of crops",
    CsScanTrim.crops(scans).length === 0);

check("sizes read as a caver says them",
    CsScanTrim.sizeText(2 * 1024 * 1024) === "2 MB" &&
    CsScanTrim.sizeText(1536) === "1.5 KB" &&
    CsScanTrim.sizeText(0) === "0 KB");

if (failures.length === 0) {
    print("### SCAN TRIM OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) { print("FAIL: " + failures[f]); }
    print("### SCAN TRIM FAIL " + failures.length + " of " + checks);
}
