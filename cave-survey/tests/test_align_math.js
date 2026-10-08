// scan_align_math_run.js -- the geometry behind ScanAlign.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon \
//       -no-gui -allow-multiple-instances -autostart \
//       tests/test_align_math.js "$PWD"
//
// Prints "### ALIGN MATH OK" on success, "### ALIGN MATH FAIL" plus the
// failed assertions otherwise.
//
// These run inside CaveCAD's own script engine, so they test the real
// RVector / RImageEntity behaviour rather than a stand-in. Including
// ScanAlign.js only defines the tool; nothing starts until CaveCAD calls
// its init(), so it is safe to load here.
//
// WHY A GENERATED RASTER. Two of the checks below put the fit onto a
// real RImageEntity, and an image entity's pixel size comes from a file
// on disk -- there is nothing to divide by until one exists. The page is
// written to a throwaway temp directory at startup rather than committed,
// the same way scan_rotate_run.js and scan_trim_run.js make theirs, so
// the suite carries no binary fixture that can drift from what it means.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {}
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(entity) {
        return !isNull(entity) && typeof entity.getType === "function" &&
            entity.getType() === RS.EntityImage;
    };
}

function loadRepoScript(scriptPath) {
    var file = new QFile(repoRoot + "/" + scriptPath);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + scriptPath);
    }
    var stream = new QTextStream(file);
    var src = String(stream.readAll());
    file.close();
    // Strip include() lines: the Core files are loaded explicitly below,
    // and CaveCAD's own include() would look in the installed script
    // folders rather than this checkout. Same loader shape as
    // tests/js_unit.js and tests/align_image_frame.js.
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}

var CORE = ["CsUnits", "CsCave", "CsGeoProject", "CsAngles", "CsModel",
    "CsTags", "CsLayers", "CsDraw"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

// The stub standing in for scripts/Modify/Transform.js: ScanAlign.js runs
// `ScanAlign.prototype = new Transform()` at load, and nothing in this
// file touches the base class. See align_image_frame.js.
function Transform() {}

loadRepoScript("scripts/CaveSurvey/SketchScans/ScanAlign.js");

// --- the throwaway page the image checks measure themselves against ---
// Deliberately not square (120 x 80): a square page would let an across
// scale and a down scale swap places unnoticed.
var TEST_IMAGE_W = 120, TEST_IMAGE_H = 80;
var tmpDir = String(QDir.tempPath()) + "/cs-align-math-" +
    String(new Date().getTime());
new QDir().mkpath(tmpDir);
var TEST_IMAGE = tmpDir + "/test_image.png";
(function() {
    var page = new QImage(TEST_IMAGE_W, TEST_IMAGE_H, QImage.Format_RGB32);
    page.fill(0xffffffff);
    if (!page.save(TEST_IMAGE, "PNG")) {
        print("FAIL: could not write the test page to " + TEST_IMAGE);
        print("### ALIGN MATH FAIL");
        throw new Error("no test page");
    }
})();

var failures = 0;
var checks = 0;

function report(message) {
    print(message);
}

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures++;
        report("FAIL: " + name);
    }
}

function checkClose(name, actual, expected, tolerance) {
    if (isNull(tolerance)) {
        tolerance = 1.0e-9;
    }
    var ok = Math.abs(actual - expected) < tolerance;
    if (!ok) {
        report("FAIL: " + name + " -- expected " + expected + ", got " + actual);
        failures++;
    }
    checks++;
}

function checkPoint(name, actual, expected, tolerance) {
    if (isNull(tolerance)) {
        tolerance = 1.0e-9;
    }
    var ok = actual.getDistanceTo(expected) < tolerance;
    if (!ok) {
        report("FAIL: " + name + " -- expected (" + expected.x + "," + expected.y +
               "), got (" + actual.x + "," + actual.y + ")");
        failures++;
    }
    checks++;
}

// --- pure translation: same direction, same length ------------------
(function() {
    var s1 = new RVector(0, 0),  s2 = new RVector(10, 0);
    var d1 = new RVector(5, 5),  d2 = new RVector(15, 5);
    var p = ScanAlign.computeTransform(s1, d1, s2, d2, true);

    check("translation: parameters returned", !isNull(p));
    checkClose("translation: no rotation", p.angle, 0.0);
    checkClose("translation: no resize", p.factor, 1.0);
    checkPoint("translation: point 1 lands on target",
               ScanAlign.transformPoint(p, s1, s1), d1);
    checkPoint("translation: point 2 lands on target",
               ScanAlign.transformPoint(p, s1, s2), d2);
})();

// --- rotation by 90 degrees and resize by 2 -------------------------
(function() {
    var s1 = new RVector(1, 1),  s2 = new RVector(3, 1);   // 2 long, east
    var d1 = new RVector(0, 0),  d2 = new RVector(0, 4);   // 4 long, north
    var p = ScanAlign.computeTransform(s1, d1, s2, d2, true);

    checkClose("rotate+resize: 90 degrees", p.angle, Math.PI / 2);
    checkClose("rotate+resize: factor 2", p.factor, 2.0);
    checkPoint("rotate+resize: point 1 lands on target",
               ScanAlign.transformPoint(p, s1, s1), d1);
    checkPoint("rotate+resize: point 2 lands on target",
               ScanAlign.transformPoint(p, s1, s2), d2);
})();

// --- rotation only, resizing turned off ("noscale") -----------------
(function() {
    var s1 = new RVector(1, 1),  s2 = new RVector(3, 1);
    var d1 = new RVector(0, 0),  d2 = new RVector(0, 4);
    var p = ScanAlign.computeTransform(s1, d1, s2, d2, false);

    checkClose("noscale: still rotates", p.angle, Math.PI / 2);
    checkClose("noscale: size unchanged", p.factor, 1.0);
    checkPoint("noscale: point 1 still lands on target",
               ScanAlign.transformPoint(p, s1, s1), d1);
    // point 2 keeps its original distance (2), short of the target (4):
    var landed = ScanAlign.transformPoint(p, s1, s2);
    checkPoint("noscale: point 2 stays on the target bearing at its own distance",
               landed, new RVector(0, 2));
    checkClose("noscale: residual is the length difference",
               landed.getDistanceTo(d2), 2.0);
})();

// --- move only (no second pair of points) ---------------------------
(function() {
    var s1 = new RVector(2, 3);
    var d1 = new RVector(12, 30);
    var p = ScanAlign.computeTransform(s1, d1, undefined, undefined, true);

    check("move only: parameters returned", !isNull(p));
    checkClose("move only: no rotation", p.angle, 0.0);
    checkClose("move only: no resize", p.factor, 1.0);
    checkPoint("move only: point 1 lands on target",
               ScanAlign.transformPoint(p, s1, s1), d1);
    // an unrelated point moves by the same offset:
    checkPoint("move only: everything shifts by the same offset",
               ScanAlign.transformPoint(p, s1, new RVector(0, 0)),
               new RVector(10, 27));
})();

// --- degenerate input -----------------------------------------------
(function() {
    var pt = new RVector(4, 4);
    check("degenerate: same point twice on the image is refused",
          isNull(ScanAlign.computeTransform(pt, new RVector(0, 0), pt, new RVector(9, 9), true)));
    check("degenerate: same target point twice is refused",
          isNull(ScanAlign.computeTransform(pt, new RVector(0, 0), new RVector(9, 9), new RVector(0, 0), true)));
    check("degenerate: missing first point is refused",
          isNull(ScanAlign.computeTransform(undefined, new RVector(0, 0), undefined, undefined, true)));
})();

// --- an angle that is not a right angle, checked against the image --
(function() {
    var s1 = new RVector(-3, 7),   s2 = new RVector(4.5, -2.25);
    var d1 = new RVector(100, 50), d2 = new RVector(160, 95);
    var p = ScanAlign.computeTransform(s1, d1, s2, d2, true);

    checkPoint("oblique: point 1 lands on target",
               ScanAlign.transformPoint(p, s1, s1), d1, 1.0e-9);
    checkPoint("oblique: point 2 lands on target",
               ScanAlign.transformPoint(p, s1, s2), d2, 1.0e-9);
    checkClose("oblique: factor is the ratio of the two distances",
               p.factor, d1.getDistanceTo(d2) / s1.getDistanceTo(s2));
})();

// --- the same transformation applied to a real image entity ---------
// This is what ScanAlign.prototype.transform does to every selected
// entity, so it checks that rotate/scale/move in that order really do
// put the picked points onto their targets.
(function() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var image = new RImageEntity(doc, new RImageData(
        TEST_IMAGE,
        new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), 0, 0, 0));

    var pixelsWide = image.getPixelWidth();
    check("image: test image loaded", pixelsWide > 0);

    // two points on the image, and where they should end up:
    var s1 = new RVector(0, 0);
    var s2 = new RVector(pixelsWide, 0);          // right along the top edge
    var d1 = new RVector(1000, 2000);
    var d2 = new RVector(1000, 2300);             // 300 units, due north

    var p = ScanAlign.computeTransform(s1, d1, s2, d2, true);

    image.rotate(p.angle, s1);
    image.scale(p.factor, s1);
    image.move(p.offset);

    checkPoint("image: insertion point landed on target 1",
               image.getInsertionPoint(), d1, 1.0e-6);

    var far = image.getInsertionPoint().operator_add(
        image.getUVector().operator_multiply(pixelsWide));
    checkPoint("image: far corner landed on target 2", far, d2, 1.0e-6);

    checkClose("image: resolution is 300 units over the image width",
               image.getUVector().getMagnitude(), 300.0 / pixelsWide, 1.0e-9);

    // uniform: pixels stay square, so the scan is not distorted
    checkClose("image: pixels stay square",
               image.getUVector().getMagnitude(),
               image.getVVector().getMagnitude(), 1.0e-12);
})();

// --- clicking inside an image finds it ------------------------------
(function() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    // 10 drawing units per pixel, so the image spans 10*pixels units:
    var image = new RImageEntity(doc, new RImageData(
        TEST_IMAGE,
        new RVector(0, 0), new RVector(10, 0), new RVector(0, 10), 0, 0, 0));
    var w = image.getPixelWidth() * 10;
    var h = image.getPixelHeight() * 10;

    check("inside: middle of the image counts as inside",
          ScanAlign.isPointInImage(image, new RVector(w / 2, h / 2)) === true);
    check("inside: a corner counts as inside",
          ScanAlign.isPointInImage(image, new RVector(1, 1)) === true);
    check("inside: a point outside does not",
          ScanAlign.isPointInImage(image, new RVector(w + 10, h / 2)) === false);
    check("inside: a point below the image does not",
          ScanAlign.isPointInImage(image, new RVector(w / 2, -5)) === false);

    // QCAD's own hit test measures to the border, which is why the
    // check above exists at all:
    check("inside: QCAD alone would not pick the middle of the image",
          image.getDistanceTo(new RVector(w / 2, h / 2)) > 1.0);

    // the same, with the image rotated 45 degrees about its origin:
    image.rotate(Math.PI / 4, new RVector(0, 0));
    var alongDiagonal = new RVector(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4))
        .operator_multiply(w / 2);
    check("rotated: a point inside the rotated image is found",
          ScanAlign.isPointInImage(image, alongDiagonal) === true);
    check("rotated: a point where the image used to be is not",
          ScanAlign.isPointInImage(image, new RVector(w / 2, h / 2 * 0.1)) === false);
})();


// =====================================================================
// Multi-station fitting (three or more stations warp the image)
// =====================================================================

// helper: build station pairs by putting known points through a known
// warp, so the fit has a right answer to be checked against
function makePairs(sources, mapPoint) {
    var pairs = [];
    for (var i = 0; i < sources.length; i++) {
        pairs.push({ source: sources[i], dest: mapPoint(sources[i]) });
    }
    return pairs;
}

// --- three stations: the warp is exact -------------------------------
(function() {
    // a warp that stretches 2x across, 3x down, skews, and shifts:
    var known = { a: 2.0, b: 0.35, c: 100.0, d: -0.2, e: 3.0, f: -50.0 };
    var sources = [new RVector(0, 0), new RVector(40, 5), new RVector(10, 25)];
    var pairs = makePairs(sources, function(p) { return ScanAlign.applyAffine(known, p); });

    var fit = ScanAlign.computeAffineFit(pairs);
    check("affine 3: a fit was found", !isNull(fit));
    checkClose("affine 3: across-x recovered", fit.a, known.a, 1.0e-9);
    checkClose("affine 3: across-y recovered", fit.d, known.d, 1.0e-9);
    checkClose("affine 3: down-x recovered", fit.b, known.b, 1.0e-9);
    checkClose("affine 3: down-y recovered", fit.e, known.e, 1.0e-9);
    checkClose("affine 3: shift-x recovered", fit.c, known.c, 1.0e-7);
    checkClose("affine 3: shift-y recovered", fit.f, known.f, 1.0e-7);

    var residuals = ScanAlign.getResiduals(pairs, function(p) {
        return ScanAlign.applyAffine(fit, p);
    });
    checkClose("affine 3: every station lands exactly", residuals.worst, 0.0, 1.0e-7);
})();

// --- more stations, all consistent: still exact ----------------------
(function() {
    var known = { a: 0.98, b: 0.04, c: 1520.0, d: -0.03, e: 1.01, f: 880.0 };
    var sources = [new RVector(0, 0), new RVector(100, 0), new RVector(100, 60),
                   new RVector(0, 60), new RVector(45, 30)];
    var pairs = makePairs(sources, function(p) { return ScanAlign.applyAffine(known, p); });

    var fit = ScanAlign.computeAffineFit(pairs);
    var residuals = ScanAlign.getResiduals(pairs, function(p) {
        return ScanAlign.applyAffine(fit, p);
    });
    checkClose("affine 5: all five stations land exactly", residuals.worst, 0.0, 1.0e-6);
})();

// --- one bad station: the fit spreads the error, and names it --------
(function() {
    var known = { a: 1.0, b: 0.0, c: 0.0, d: 0.0, e: 1.0, f: 0.0 };
    // four corners plus one in the middle. The middle one matters: with
    // only the four corners of a square, a single bad station is shared
    // out evenly between all four (each ends up 2 units out) and none
    // stands out -- worked through by hand, and the reason the tool's
    // notes warn about symmetrical station layouts.
    var sources = [new RVector(0, 0), new RVector(100, 0), new RVector(100, 100),
                   new RVector(0, 100), new RVector(50, 50)];
    var pairs = makePairs(sources, function(p) { return ScanAlign.applyAffine(known, p); });
    // station 5, in the middle, was mis-clicked by 8 units:
    pairs[4].dest = new RVector(pairs[4].dest.x + 8.0, pairs[4].dest.y);

    var fit = ScanAlign.computeAffineFit(pairs);
    var residuals = ScanAlign.getResiduals(pairs, function(p) {
        return ScanAlign.applyAffine(fit, p);
    });

    check("outlier: the mis-clicked station is reported as the worst",
          residuals.worstStation === 5);
    check("outlier: the error is spread, not dumped on one station",
          residuals.worst < 8.0 && residuals.worst > 0.0);
    check("outlier: the average miss is smaller than the worst",
          residuals.average < residuals.worst);
    // hand-computed: the four good corners end up 1.6 out each and the
    // bad one 6.4 out, so an 8 unit mis-click is neither ignored nor
    // taken at face value
    checkClose("outlier: worst miss matches the hand-computed value",
               residuals.worst, 6.4, 1.0e-9);
    checkClose("outlier: average miss matches the hand-computed value",
               residuals.average, (1.6 * 4 + 6.4) / 5, 1.0e-9);
})();

// --- stations in a straight line cannot define a warp ----------------
(function() {
    var sources = [new RVector(0, 0), new RVector(10, 10), new RVector(25, 25)];
    var pairs = makePairs(sources, function(p) { return new RVector(p.x * 2, p.y * 2); });
    check("straight line: no warp is invented from stations in a line",
          isNull(ScanAlign.computeAffineFit(pairs)));

    // nearly-but-not-quite in a line is still usable:
    var offLine = [new RVector(0, 0), new RVector(10, 10.5), new RVector(25, 25)];
    var okPairs = makePairs(offLine, function(p) { return new RVector(p.x * 2, p.y * 2); });
    check("off the line: a warp is found once the stations are not collinear",
          !isNull(ScanAlign.computeAffineFit(okPairs)));

    check("too few: two stations cannot make a warp",
          isNull(ScanAlign.computeAffineFit(pairs.slice(0, 2))));
})();

// --- closest move/rotate/resize fit (used for non-image objects) -----
(function() {
    // four stations from a known rotate + resize + move:
    var angle = Math.PI / 6, factor = 2.5;
    var mover = function(p) {
        var a = p.getAngle() + angle;
        var m = p.getMagnitude() * factor;
        return new RVector(Math.cos(a) * m + 30.0, Math.sin(a) * m - 12.0);
    };
    var sources = [new RVector(5, 0), new RVector(0, 7), new RVector(-4, -3), new RVector(9, 9)];
    var pairs = makePairs(sources, mover);

    var fit = ScanAlign.computeSimilarityFit(pairs);
    check("similarity fit: a fit was found", !isNull(fit));
    checkClose("similarity fit: rotation recovered", fit.angle, angle, 1.0e-9);
    checkClose("similarity fit: resize recovered", fit.factor, factor, 1.0e-9);

    var residuals = ScanAlign.getResiduals(pairs, function(p) {
        return ScanAlign.transformPoint(fit, fit.center, p);
    });
    checkClose("similarity fit: every station lands exactly", residuals.worst, 0.0, 1.0e-7);
})();

// --- with two stations the two routes agree --------------------------
(function() {
    var s1 = new RVector(3, 4), s2 = new RVector(11, 1);
    var d1 = new RVector(200, 100), d2 = new RVector(180, 160);
    var pairs = [{source: s1, dest: d1}, {source: s2, dest: d2}];

    var exact = ScanAlign.computeTransform(s1, d1, s2, d2, true);
    var fitted = ScanAlign.computeSimilarityFit(pairs);

    checkClose("two stations: same rotation either way",
               ScanAlign.normalizeAngle(fitted.angle),
               ScanAlign.normalizeAngle(exact.angle), 1.0e-9);
    checkClose("two stations: same resize either way", fitted.factor, exact.factor, 1.0e-9);
    checkPoint("two stations: least squares fit still lands station 1 exactly",
               ScanAlign.transformPoint(fitted, fitted.center, s1), d1, 1.0e-9);
    checkPoint("two stations: and station 2",
               ScanAlign.transformPoint(fitted, fitted.center, s2), d2, 1.0e-9);
})();

// --- warping a real image entity -------------------------------------
// The end-to-end check: put three stations on an image, warp it, then
// confirm the picture itself now has those stations on their targets.
(function() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var scale = 4.0;      // drawing units per pixel to start with
    var origin = new RVector(0, 0);
    var image = new RImageEntity(doc, new RImageData(
        TEST_IMAGE,
        origin, new RVector(scale, 0), new RVector(0, scale), 0, 0, 0));

    var pw = image.getPixelWidth(), ph = image.getPixelHeight();

    // three stations, given as pixel positions on the picture:
    var stationPixels = [new RVector(2, 2), new RVector(pw - 3, 4), new RVector(5, ph - 2)];

    // where each one sits in the drawing before warping:
    var sources = [];
    for (var i = 0; i < stationPixels.length; i++) {
        sources.push(new RVector(origin.x + stationPixels[i].x * scale,
                                 origin.y + stationPixels[i].y * scale));
    }

    // where they should end up: a stretched, skewed, shifted layout
    var targets = [new RVector(1000, 500), new RVector(1310, 512), new RVector(1012, 690)];

    var pairs = [];
    for (i = 0; i < sources.length; i++) {
        pairs.push({ source: sources[i], dest: targets[i] });
    }

    var fit = ScanAlign.computeAffineFit(pairs);
    check("image warp: a fit was found", !isNull(fit));

    ScanAlign.applyAffineToImage(image, fit);

    // read the stations back off the warped picture: a pixel position
    // maps to origin + across*px + down*py
    var newOrigin = image.getInsertionPoint();
    var across = image.getUVector();
    var down = image.getVVector();

    for (i = 0; i < stationPixels.length; i++) {
        var landed = new RVector(
            newOrigin.x + across.x * stationPixels[i].x + down.x * stationPixels[i].y,
            newOrigin.y + across.y * stationPixels[i].x + down.y * stationPixels[i].y);
        checkPoint("image warp: station " + (i + 1) + " on the picture is on its target",
                   landed, targets[i], 1.0e-6);
    }

    // the picture is genuinely stretched unevenly and skewed now:
    check("image warp: across and down scales really differ",
          Math.abs(across.getMagnitude() - down.getMagnitude()) > 1.0e-6);
    var skew = Math.abs(RMath.rad2deg(RMath.getNormalizedAngle(down.getAngle() - across.getAngle())) - 90.0);
    check("image warp: the picture is skewed off square", skew > 1.0e-6);

    // and a click inside the warped picture is still recognised:
    var middle = new RVector(
        newOrigin.x + across.x * (pw / 2) + down.x * (ph / 2),
        newOrigin.y + across.y * (pw / 2) + down.y * (ph / 2));
    check("image warp: clicking the middle of the warped picture finds it",
          ScanAlign.isPointInImage(image, middle) === true);
    var outside = new RVector(middle.x + across.getMagnitude() * pw, middle.y);
    check("image warp: a click beyond the warped picture does not",
          ScanAlign.isPointInImage(image, outside) === false);
})();

// --- tidy up the throwaway page --------------------------------------
new QFile(TEST_IMAGE).remove();
new QDir().rmdir(tmpDir);

if (failures === 0) {
    print("### ALIGN MATH OK " + checks);
} else {
    print("### ALIGN MATH FAIL " + failures + " of " + checks);
}
