// CsCalibrate.js -- how big a legacy map is, and which way it faces.
//
// Part of the Cave Survey Core library: pure functions, no document and
// no GUI, so tests/js_unit.js runs all of it.
//
// THE EVIDENCE IS RECORDED, NOT JUST THE NUMBER. A scale is worth
// exactly what the thing that produced it is worth, and those differ by
// more than an order of magnitude: a printed scale bar on a drafted
// sheet is good to the width of the pen, while "the main passage runs
// about 300 ft" is somebody's memory of a trip in 1987. Both give a
// number. Only one of them should let a tool print a length without
// hedging, and nothing downstream can tell them apart unless this file
// says which was used.
//
// THE EVIDENCE KINDS:
//
//   scalebar   the two ends of the map's own printed bar, and what it
//              says. The best a traced source gets.
//   distance   two points and one real distance somebody knows.
//   distances  several of those at once -- scribbled numbers down a
//              field sketch. Scale comes from all of them, and HOW FAR
//              THEY DISAGREE is reported rather than averaged away:
//              two numbers implying scales 30% apart mean one of them
//              is wrong, and a caver needs to be told that rather than
//              handed their mean.
//   points     two or more real-world points. The only evidence that
//              fixes ROTATION and POSITION as well as scale, which is
//              what makes a source TIED rather than TRACED.
//   none       nothing. The source is unscaled, and that is a
//              first-class outcome -- see CsProvenance.mayQuoteLength.
//
// NOTHING HERE AVERAGES A DISAGREEMENT INTO SILENCE. Every function
// that can produce a spread returns it, and the caller is expected to
// show it. That is the same discipline the loop-closure report keeps:
// the number that matters is not the answer, it is how much the inputs
// disagreed before one was chosen.

var CsCalibrate = {};

CsCalibrate.SCALEBAR = "scalebar";
CsCalibrate.DISTANCE = "distance";
CsCalibrate.DISTANCES = "distances";
CsCalibrate.POINTS = "points";
CsCalibrate.NONE = "none";

/**
 * Above this, the stated distances disagree enough that one of them is
 * probably wrong rather than merely imprecise.
 *
 * 0.10 -- ten per cent. A hand-scaled sketch and a tape rarely agree
 * better than a few per cent, and a caver who put two numbers on a page
 * that imply scales a tenth apart has usually mis-picked one of the
 * point pairs rather than mis-measured.
 */
CsCalibrate.SPREAD_WARN = 0.10;

CsCalibrate.dist = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/**
 * An empty calibration: a source that claims no scale.
 *
 * Returned rather than null so every caller reads the same shape, and
 * so `scaled` is a field that is always present and always false here
 * -- a caller checking for null would eventually forget.
 */
CsCalibrate.unscaled = function() {
    return { evidence: CsCalibrate.NONE, scaled: false, scale: null,
        northDeg: null, spread: null, used: 0, warnings: [] };
};

/**
 * Scale from one known distance between two picked points.
 *
 * Serves both `scalebar` and `distance`: the arithmetic is identical
 * and only the evidence word differs, because what a caver picked --
 * the ends of a printed bar, or two places they know the distance
 * between -- is exactly the thing worth recording.
 *
 * \param a, b the picked points, in the source's own coordinates.
 * \param stated the real distance between them.
 * \param statedUnit the unit `stated` is in.
 * \param drawingUnit the unit the drawing works in.
 * \param evidence CsCalibrate.SCALEBAR or CsCalibrate.DISTANCE.
 * \return a calibration; unscaled when the picks coincide or the
 *         distance is not a positive number.
 */
CsCalibrate.fromDistance = function(a, b, stated, statedUnit, drawingUnit,
        evidence) {
    var span = CsCalibrate.dist(a, b);
    if (!(span > 0)) {
        var samePlace = CsCalibrate.unscaled();
        samePlace.warnings.push("Both picks are in the same place, so " +
            "they say nothing about size.");
        return samePlace;
    }
    if (!(stated > 0)) {
        var noNumber = CsCalibrate.unscaled();
        noNumber.warnings.push("A distance of " + stated + " cannot " +
            "scale anything.");
        return noNumber;
    }
    var real = CsUnits.convert(stated, statedUnit, drawingUnit);
    return { evidence: (evidence === undefined || evidence === null) ?
            CsCalibrate.DISTANCE : evidence,
        scaled: true, scale: real / span, northDeg: null, spread: null,
        used: 1, warnings: [] };
};

/**
 * Scale from several stated distances at once.
 *
 * THE MEDIAN, NOT THE MEAN. One badly picked pair -- a caver clicking
 * the wrong end of a passage -- moves a mean by however wrong it was
 * and moves a median hardly at all. With scribbled field numbers, a
 * single bad one is the likely failure, not a spread of small errors,
 * so the estimator that ignores an outlier is the right one.
 *
 * THE SPREAD IS RETURNED AND MUST BE SHOWN. It is the fraction by which
 * the worst measurement disagrees with the chosen scale. Two numbers
 * implying scales 30% apart mean one of them is wrong; handing back
 * their middle with no comment would bury exactly the fact that the
 * caver can act on.
 *
 * \param rows an array of {a, b, stated, unit}.
 * \param drawingUnit the unit the drawing works in.
 * \return a calibration; `spread` is the worst fractional disagreement.
 */
CsCalibrate.fromDistances = function(rows, drawingUnit) {
    var scales = [];
    var i;
    for (i = 0; i < (rows === null ? 0 : rows.length); i++) {
        var one = CsCalibrate.fromDistance(rows[i].a, rows[i].b,
            rows[i].stated, rows[i].unit, drawingUnit,
            CsCalibrate.DISTANCES);
        if (one.scaled) {
            scales.push(one.scale);
        }
    }
    if (scales.length === 0) {
        var none = CsCalibrate.unscaled();
        none.warnings.push("None of the distances given could scale " +
            "anything.");
        return none;
    }
    scales.sort(function(x, y) { return x - y; });
    var mid = Math.floor(scales.length / 2);
    var chosen = (scales.length % 2 === 1) ? scales[mid] :
        (scales[mid - 1] + scales[mid]) / 2;

    var spread = 0;
    for (i = 0; i < scales.length; i++) {
        var off = Math.abs(scales[i] - chosen) / chosen;
        if (off > spread) {
            spread = off;
        }
    }
    var out = { evidence: CsCalibrate.DISTANCES, scaled: true,
        scale: chosen, northDeg: null, spread: spread,
        used: scales.length, warnings: [] };
    if (spread > CsCalibrate.SPREAD_WARN) {
        out.warnings.push("The distances given disagree by up to " +
            Math.round(spread * 100) + "%. One of them is probably " +
            "wrong, or two picks landed on the wrong points -- the " +
            "middle one was used, but check them before trusting a " +
            "length off this map.");
    }
    return out;
};

/**
 * Scale, rotation and position from known real-world points.
 *
 * THE ONLY EVIDENCE THAT MAKES A SOURCE TIED. Two points fix all three
 * -- which is why a single GPS'd entrance is not enough: it says where
 * the cave is and nothing about how big it is or which way it faces.
 *
 * The fit itself is CsScanFit's, the same one that lands a scanned
 * sketch on its stations and a Therion scrap on its station markers.
 * Three or more points allow an affine, which takes a scanner's own
 * stretch out; the residual is what says how well the map and the world
 * agree, and is reported rather than assumed away.
 *
 * \param pairs [{source: {x, y}, dest: {x, y}}], dest in drawing
 *        coordinates.
 * \return a calibration carrying `matrix`, `kind` and `residual`.
 */
CsCalibrate.fromPoints = function(pairs) {
    var fit = CsScanFit.fit(pairs);
    if (fit === null) {
        var no = CsCalibrate.unscaled();
        no.warnings.push("Two points in different places are needed to " +
            "tie a map to the world.");
        return no;
    }
    var sx = Math.sqrt(fit.matrix.a * fit.matrix.a +
        fit.matrix.d * fit.matrix.d);
    var sy = Math.sqrt(fit.matrix.b * fit.matrix.b +
        fit.matrix.e * fit.matrix.e);
    var residual = CsScanFit.residuals(pairs, fit.matrix);
    var out = { evidence: CsCalibrate.POINTS, scaled: true,
        scale: Math.sqrt(sx * sy),
        northDeg: CsCalibrate.northOf(fit.matrix),
        spread: null, used: pairs.length, warnings: [],
        matrix: fit.matrix, kind: fit.kind, residual: residual };
    if (fit.thin === true) {
        out.warnings.push("The points given sit almost in a straight " +
            "line, so nothing can be said about the direction across " +
            "it. The map keeps its shape rather than being stretched " +
            "on a guess.");
    }
    return out;
};

/**
 * Which way north points, given a fit.
 *
 * Degrees the SOURCE must be turned clockwise for its own up-the-page
 * to be north -- 0 when the map is already drawn with north up, which
 * is what a drafted cave map nearly always is.
 */
CsCalibrate.northOf = function(matrix) {
    if (matrix === undefined || matrix === null) {
        return null;
    }
    var upX = matrix.b, upY = matrix.e;
    if (upX === 0 && upY === 0) {
        return null;
    }
    var turn = Math.atan2(upX, upY) * 180 / Math.PI;
    return ((turn % 360) + 360) % 360;
};

/**
 * North from the map's own north arrow: two points picked along it,
 * tail first.
 *
 * \return degrees the source must be turned clockwise so that its
 *         up-the-page is north, or null when the picks coincide.
 */
CsCalibrate.northFromArrow = function(tail, head) {
    if (CsCalibrate.dist(tail, head) <= 0) {
        return null;
    }
    // The arrow's own bearing within the source, measured clockwise
    // from up-the-page. Turning the source by the NEGATIVE of that puts
    // the arrow straight up, which is north.
    var bearing = Math.atan2(head.x - tail.x, head.y - tail.y) *
        180 / Math.PI;
    return ((-bearing % 360) + 360) % 360;
};

/**
 * The sentence recording what scaled this source.
 *
 * Printed wherever the source is described, because "1 inch = 50 feet"
 * on its own is a number with no standing: a reader needs to know it
 * came off the map's own bar rather than off somebody's memory.
 */
CsCalibrate.describe = function(calibration) {
    if (calibration === null || calibration === undefined ||
            !calibration.scaled) {
        return "Nothing scales this map. No length can be quoted from it.";
    }
    switch (calibration.evidence) {
    case CsCalibrate.SCALEBAR:
        return "Scaled from the map's own scale bar.";
    case CsCalibrate.DISTANCE:
        return "Scaled from one stated distance.";
    case CsCalibrate.DISTANCES:
        return "Scaled from " + calibration.used + " stated distances, " +
            "which disagree by up to " +
            Math.round((calibration.spread || 0) * 100) + "%.";
    case CsCalibrate.POINTS:
        return "Tied to " + calibration.used + " known points; the " +
            "worst is out by " +
            (calibration.residual === null ||
                calibration.residual === undefined ? "?" :
                calibration.residual.worst.toFixed(2)) + ".";
    default:
        return "Scaled by unrecorded means.";
    }
};
