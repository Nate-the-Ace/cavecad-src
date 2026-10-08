// cave3d_drape_run.js -- reading sketch scans out of a REAL document and
// draping one onto a survey.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cave3d_drape_run.js "$PWD"
//
// Prints "### CAVE3D DRAPE OK <n>" on success, "### CAVE3D DRAPE FAIL"
// plus the failed checks otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsDrape's sampling
// and grid arithmetic are node-tested in js_unit.js. What can only break
// against a real RDocument is the READING: an image entity does not know
// its own file name (getFileName() is EMPTY and getWidth()/getHeight()
// are ZERO -- probed against Truitt Cave's 28 plan scans, through both
// the method and the property route), so the path comes from XDATA
// relative to the cave's scans folder and the pixel size from the file.
//
// Every one of those is a place where a wrong assumption yields NO
// SCANS and no error, which is the failure this file exists to catch.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } }
        catch (e) {}
        return false;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var source = String(stream.readAll());
    file.close();
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(source);
}

// Core in CsAll's own order, so a file added there is picked up here
// without a second hand-written list to forget.
(function () {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open CsAll.js");
    }
    var text = String((new QTextStream(f)).readAll());
    f.close();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = /include\(includeBasePath \+ "\/([^"]+)"\);/.exec(lines[i]);
        if (m !== null) {
            loadRepoScript("scripts/CaveSurvey/Core/" + m[1]);
        }
    }
})();

var failures = [];
var checks = 0;
function check(name, condition) {
    checks++;
    if (condition !== true) { failures.push(name); }
}

// ---------------------------------------------------------------------
// A cave folder on disk, with a real scans/ and a real image in it.
// A relative scan path is only testable against a folder that EXISTS --
// CsCave.resolveUnderScans answers about real directories.
// ---------------------------------------------------------------------

var tmp = QDir.tempPath() + "/cave3d-drape-" + (new Date()).getTime();
var caveDir = tmp + "/TEST CAVE";
var scansDir = caveDir + "/scans/2024 Scans";
(new QDir()).mkpath(scansDir);

var REL = "2024 Scans/page one.png";
var imgPath = caveDir + "/scans/" + REL;
var made = new QImage(40, 30, QImage.Format_RGB32);
made.fill(0xFFFFFFFF);
check("fixture: a scan image is written", made.save(imgPath, "PNG"));

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
doc.setFileName(caveDir + "/TEST CAVE.dxf");

CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);

// ---------------------------------------------------------------------
// One scan placed the way the suite places them: u and v PER PIXEL, and
// the path in XDATA relative to scans/.
// ---------------------------------------------------------------------

function addScan(relPath, layerName, originX, originY, perPixel) {
    var data = new RImageData(imgPath, new RVector(originX, originY),
        new RVector(perPixel, 0), new RVector(0, perPixel), 1.0);
    var e = new RImageEntity(doc, data);
    e.setLayerId(doc.getLayerId(layerName));
    // U AND V GO ON THROUGH PROPERTIES, not through the data. The
    // constructor's vectors do not stick: RImageEntity has no setData,
    // the entity does not forward setUVector/setVVector, and the object
    // getData() hands back is a copy. CsScanReanchor documents the same
    // thing from the other direction -- this fixture hit it too, and a
    // fixture that quietly built a zero-sized scan would have been
    // testing nothing.
    e.setProperty(RImageEntity.PropertyUX, perPixel);
    e.setProperty(RImageEntity.PropertyUY, 0);
    e.setProperty(RImageEntity.PropertyVX, 0);
    e.setProperty(RImageEntity.PropertyVY, perPixel);
    e.setInsertionPoint(new RVector(originX, originY));
    if (relPath !== null) {
        CsTags.set(e, CsDrape.PATH_TAG, relPath);
    }
    di.applyOperation(new RAddObjectOperation(e, false));
    return e;
}

addScan(REL, CsLayers.CTRL_SCAN, 0, 0, 0.25);
// A scan whose file is gone: skipped, never drawn as a blank quad.
addScan("2024 Scans/not there.png", CsLayers.CTRL_SCAN, 100, 100, 0.25);
// A scan with no path tag at all: also skipped.
addScan(null, CsLayers.CTRL_SCAN, 200, 200, 0.25);

var found = CsDrape.readScans(doc, "plan");
check("exactly one scan is readable -- a missing file and an untagged " +
    "image are both skipped (" + found.length + ")", found.length === 1);

if (found.length === 1) {
    var sc = found[0];
    check("its path resolved under scans/",
        sc.path.indexOf("page one.png") >= 0);
    check("its pixel size came from the FILE, not the entity (" +
        sc.widthPx + "x" + sc.heightPx + ")",
        sc.widthPx === 40 && sc.heightPx === 30);
    // u and v are per pixel, so the quad spans the whole image.
    check("the quad spans the whole image across (" + sc.quad.u.x + ")",
        Math.abs(sc.quad.u.x - 40 * 0.25) < 1e-9);
    check("and the whole image down (" + sc.quad.v.y + ")",
        Math.abs(sc.quad.v.y - 30 * 0.25) < 1e-9);

    // ---- draping it onto a survey ----
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    survey.shots = [
        { from: "A1", to: "A2", distance: 10, azimuth: 90, inclination: 30,
          left: 2, right: 2, up: 3, down: 1, splay: false, trip: 0 }
    ];
    CsModel.ensureTrips(survey);
    var resolved = CsNetwork.resolve(survey);
    var g = CsDrape.grid(sc.quad, 8, resolved.stations);

    check("the scan drapes into a grid", g.positions.length > 0);
    check("one uv per vertex",
        g.uvs.length / 2 === g.positions.length / 3);

    var bad = 0;
    for (var i = 0; i < g.positions.length; i++) {
        if (!isFinite(g.positions[i])) { bad++; }
    }
    check("no NaN in the draped grid", bad === 0);

    var maxIdx = g.positions.length / 3;
    var oob = 0;
    for (var j = 0; j < g.indices.length; j++) {
        if (g.indices[j] < 0 || g.indices[j] >= maxIdx) { oob++; }
    }
    check("every index addresses a vertex that exists", oob === 0);

    // The shot climbs, so the drape must not come back flat -- that is
    // the whole point of sampling rather than picking one elevation.
    var zs = [];
    for (var k = 2; k < g.positions.length; k += 3) { zs.push(g.positions[k]); }
    var zMin = Math.min.apply(null, zs), zMax = Math.max.apply(null, zs);
    check("the drape follows a climbing passage rather than lying flat (" +
        zMin.toFixed(2) + ".." + zMax.toFixed(2) + ")", zMax - zMin > 1e-6);
}

// ---------------------------------------------------------------------
// A SCAN TRIMMED TO A TRACED OUTLINE, in 3D.
//
// The derivative is the outline's bounding box with everything outside
// the line made transparent, so as far as the drape is concerned it is
// an ordinary rectangular image -- which is the whole design, and
// therefore the thing to assert rather than assume. What the 3D view
// does with the transparency is a shader's business and cannot be seen
// from here; that the SIZE and the QUAD come from the masked file, and
// that the drape builds over it, can.
// ---------------------------------------------------------------------

var outline = [{ x: 2, y: 2 }, { x: 34, y: 2 }, { x: 34, y: 16 },
               { x: 18, y: 16 }, { x: 18, y: 26 }, { x: 2, y: 26 }];
var outBox = CsScanTrim.outlineBounds(outline);
var cut = CsScanTrim.write(caveDir + "/scans", REL, outBox, outline);
check("fixture: a masked derivative is cut (" + String(cut.error) + ")",
    cut.path !== null);

if (cut.path !== null) {
    var maskedImg = new QImage(cut.path);
    check("the masked file carries transparency at all",
        !maskedImg.isNull() && maskedImg.hasAlphaChannel());
    check("and is the size of the outline's box (" + maskedImg.width() +
        "x" + maskedImg.height() + ")",
        maskedImg.width() === outBox.w && maskedImg.height() === outBox.h);

    // Placed the way SketchScans places a trimmed scan: the entity
    // points at the derivative, and the XDATA names the PAGE.
    var traced = new RImageEntity(doc, new RImageData(cut.path,
        new RVector(400, 400), new RVector(0.25, 0), new RVector(0, 0.25),
        1.0));
    traced.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
    traced.setProperty(RImageEntity.PropertyFileName, cut.path);
    traced.setProperty(RImageEntity.PropertyUX, 0.25);
    traced.setProperty(RImageEntity.PropertyUY, 0);
    traced.setProperty(RImageEntity.PropertyVX, 0);
    traced.setProperty(RImageEntity.PropertyVY, 0.25);
    traced.setInsertionPoint(new RVector(400, 400));
    CsTags.set(traced, CsDrape.PATH_TAG, REL);
    CsTags.set(traced, CsScanTrim.TAG, CsScanTrim.serialize(outBox));
    CsTags.set(traced, CsScanTrim.OUTLINE_TAG,
        CsScanTrim.serializeOutline(outline));
    di.applyOperation(new RAddObjectOperation(traced, false));

    var withTraced = CsDrape.readScans(doc, "plan");
    check("the traced scan is read alongside the boxed one (" +
        withTraced.length + ")", withTraced.length === 2);

    var tr = null;
    for (var ti = 0; ti < withTraced.length; ti++) {
        if (withTraced[ti].path === cut.path) { tr = withTraced[ti]; }
    }
    check("the drape reads the MASKED file, not the page it came from",
        tr !== null);
    if (tr !== null) {
        check("its pixel size is the outline's box, not the page (" +
            tr.widthPx + "x" + tr.heightPx + ")",
            tr.widthPx === outBox.w && tr.heightPx === outBox.h);
        check("and its quad spans that, at one u per pixel (" +
            tr.quad.u.x + ")",
            Math.abs(tr.quad.u.x - outBox.w * 0.25) < 1e-9);

        // The drape itself: a masked scan is gridded like any other.
        var trGrid = CsDrape.grid(tr.quad, 4, resolved.stations);
        check("a masked scan drapes onto the passage like any other (" +
            (trGrid.positions.length / 3) + " points)",
            trGrid.positions.length > 0 && trGrid.indices.length > 0);
        var trBad = 0;
        for (var tb = 0; tb < trGrid.positions.length; tb++) {
            if (!isFinite(trGrid.positions[tb])) { trBad++; }
        }
        check("with no NaN in it", trBad === 0);
    }
}

// A kind with no scans answers empty rather than throwing.
check("a kind with no scans reads empty",
    CsDrape.readScans(doc, "profile").length === 0);

// ---------------------------------------------------------------------

(new QDir(tmp)).removeRecursively();

if (failures.length > 0) {
    print("### CAVE3D DRAPE FAIL");
    for (var fi = 0; fi < failures.length; fi++) {
        print("  " + failures[fi]);
    }
} else {
    print("### CAVE3D DRAPE OK " + checks + " checks");
}
