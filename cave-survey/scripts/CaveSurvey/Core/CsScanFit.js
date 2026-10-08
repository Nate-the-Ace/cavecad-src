// CsScanFit.js -- fitting a scan onto known stations, and turning that
// fit into the three vectors an image entity is placed by.
//
// Part of the Cave Survey Core library. PURE: plain {x, y} objects, no
// RVector, no document, so tests/js_unit.js exercises all of it under
// node.
//
// WHY THIS EXISTS SEPARATELY FROM AlignImage. Align Image fits a scan
// that is ALREADY IN THE DRAWING: the caver inserts it, hunts for it,
// zooms, and clicks stations on it in the CAD view. Picking the
// stations on the SCAN ITSELF, in the Sketch Scans viewer, means the
// fit is known BEFORE the image is placed -- so the image is inserted
// already aligned and the hunt never happens.
//
// COORDINATES. Source points are pixels on the scan, as the preview
// document reports them: one drawing unit per pixel, origin at the
// image's bottom-left, y running UP (the preview is a drawing, not a
// bitmap). Destination points are the drawing's own plotted stations.
// The fit maps the first onto the second.

var CsScanFit = {};

CsScanFit.TOLERANCE = 1.0e-9;
/** Below this (scaled by the spread of the sources) three points are in
 *  a line and no affine can be worked out from them. */
CsScanFit.COLLINEAR_TOLERANCE = 1.0e-8;

/** One point through an affine {a,b,c,d,e,f}:
 *  x' = a*x + b*y + c ;  y' = d*x + e*y + f */
CsScanFit.apply = function(m, p) {
    return { x: m.a * p.x + m.b * p.y + m.c,
             y: m.d * p.x + m.e * p.y + m.f };
};

/**
 * The move / rotate / uniform-resize through TWO pairs, as an affine.
 *
 * Exact: both points land on their targets. The scan keeps its shape,
 * which is what two stations can honestly say -- anything more would be
 * a stretch nobody measured.
 *
 * \return {a,b,c,d,e,f} or null when the two source or target points
 *         coincide (no direction, no scale).
 */
CsScanFit.similarityFrom = function(p1, q1, p2, q2) {
    var sx = p2.x - p1.x, sy = p2.y - p1.y;
    var dx = q2.x - q1.x, dy = q2.y - q1.y;
    var sLen2 = sx * sx + sy * sy;
    var dLen2 = dx * dx + dy * dy;
    if (sLen2 < CsScanFit.TOLERANCE || dLen2 < CsScanFit.TOLERANCE) {
        return null;
    }
    // The complex ratio (d / s) IS the rotation and the scale together.
    var k = (dx * sx + dy * sy) / sLen2;   // cos(theta) * factor
    var h = (dy * sx - dx * sy) / sLen2;   // sin(theta) * factor
    return { a: k, b: -h, c: q1.x - (k * p1.x - h * p1.y),
             d: h, e: k,  f: q1.y - (h * p1.x + k * p1.y) };
};

/**
 * The affine fitting THREE OR MORE pairs as closely as possible: move,
 * rotate, stretch differently across and down, and skew. Exact with
 * three; least squares with more.
 *
 * \return {a,b,c,d,e,f}, or null when the sources are collinear.
 */
CsScanFit.affineFrom = function(pairs) {
    if (pairs === undefined || pairs === null || pairs.length < 3) {
        return null;
    }
    var sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = pairs.length;
    var txx = 0, txy = 0, tx = 0, tyx = 0, tyy = 0, ty = 0;
    for (var i = 0; i < n; i++) {
        var px = pairs[i].source.x, py = pairs[i].source.y;
        var qx = pairs[i].dest.x,   qy = pairs[i].dest.y;
        sxx += px * px; sxy += px * py; syy += py * py;
        sx += px; sy += py;
        txx += qx * px; txy += qx * py; tx += qx;
        tyx += qy * px; tyy += qy * py; ty += qy;
    }
    var m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    var det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
              m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
              m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    var spread = Math.max(sxx + syy, CsScanFit.TOLERANCE);
    if (Math.abs(det) < CsScanFit.COLLINEAR_TOLERANCE * spread * spread) {
        return null;
    }
    var solve = function(r0, r1, r2) {
        var d0 = r0 * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
                 m[0][1] * (r1 * m[2][2] - m[1][2] * r2) +
                 m[0][2] * (r1 * m[2][1] - m[1][1] * r2);
        var d1 = m[0][0] * (r1 * m[2][2] - m[1][2] * r2) -
                 r0 * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                 m[0][2] * (m[1][0] * r2 - r1 * m[2][0]);
        var d2 = m[0][0] * (m[1][1] * r2 - r1 * m[2][1]) -
                 m[0][1] * (m[1][0] * r2 - r1 * m[2][0]) +
                 r0 * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        return [d0 / det, d1 / det, d2 / det];
    };
    var row1 = solve(txx, txy, tx);
    var row2 = solve(tyx, tyy, ty);
    return { a: row1[0], b: row1[1], c: row1[2],
             d: row2[0], e: row2[1], f: row2[2] };
};

/**
 * How far the source picks are from lying in a LINE: the spread across
 * their own long axis, as a fraction of the spread along it.
 *
 * 0 is a perfect line; 1 is a round blob. This is the number that
 * decides whether an affine is worth solving at all.
 *
 * WHY A RATIO AND NOT A DETERMINANT. The first version of this tested
 * the normal-equation determinant against a tolerance, which catches
 * only EXACT collinearity. Three consecutive stations down a passage
 * are near-collinear, not exactly so: the determinant clears the
 * tolerance, the affine solves, it passes through all three points
 * exactly -- and the direction across the line is almost unconstrained,
 * so the answer comes back turned 156 degrees and squashed to a third
 * of its height. Which is precisely the failure this now prevents.
 */
CsScanFit.spreadRatio = function(pairs) {
    var n = pairs.length, i;
    if (n < 3) {
        return 0;
    }
    var cx = 0, cy = 0;
    for (i = 0; i < n; i++) {
        cx += pairs[i].source.x; cy += pairs[i].source.y;
    }
    cx /= n; cy /= n;
    // covariance of the source points
    var sxx = 0, sxy = 0, syy = 0;
    for (i = 0; i < n; i++) {
        var dx = pairs[i].source.x - cx, dy = pairs[i].source.y - cy;
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    sxx /= n; sxy /= n; syy /= n;
    // eigenvalues of the 2x2 covariance: the spread along each axis
    var tr = sxx + syy;
    var det = sxx * syy - sxy * sxy;
    var disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var big = tr / 2 + disc, small = tr / 2 - disc;
    if (big < CsScanFit.TOLERANCE) {
        return 0;
    }
    return Math.sqrt(Math.max(0, small) / big);
};

/** Below this the picks are too close to a line for an affine to mean
 *  anything: the across-the-line direction is guesswork. Three points
 *  in a passage typically sit around 0.02-0.05. */
CsScanFit.MIN_SPREAD = 0.12;

/**
 * The best fit the given pairs support: two pairs keep the scan's
 * shape, three or more allow the stretch and skew that takes a
 * scanner's distortion out. Three points in a LINE say nothing about
 * the direction across that line, so they fall back to the first two.
 *
 * \return {matrix, kind: "similarity"|"affine"} or null
 */
CsScanFit.fit = function(pairs) {
    if (pairs === undefined || pairs === null || pairs.length < 2) {
        return null;
    }
    var thin = false;
    if (pairs.length >= 3) {
        if (CsScanFit.spreadRatio(pairs) < CsScanFit.MIN_SPREAD) {
            // Too close to a line: an affine through them is exact and
            // meaningless. Fall back rather than return a confident
            // wrong answer, and SAY so -- the caller warns.
            thin = true;
        } else {
            var affine = CsScanFit.affineFrom(pairs);
            if (affine !== null) {
                return { matrix: affine, kind: "affine" };
            }
            thin = true;
        }
    }
    // The two picks FURTHEST APART carry the least angular error, which
    // matters most when the rest are strung out along a line.
    var best = [0, 1], bestD = -1;
    for (var i = 0; i < pairs.length; i++) {
        for (var j = i + 1; j < pairs.length; j++) {
            var dx = pairs[i].source.x - pairs[j].source.x;
            var dy = pairs[i].source.y - pairs[j].source.y;
            var d2 = dx * dx + dy * dy;
            if (d2 > bestD) { bestD = d2; best = [i, j]; }
        }
    }
    var sim = CsScanFit.similarityFrom(
        pairs[best[0]].source, pairs[best[0]].dest,
        pairs[best[1]].source, pairs[best[1]].dest);
    if (sim === null) {
        return null;
    }
    return { matrix: sim, kind: "similarity", thin: thin };
};

/**
 * The three vectors QCAD places an image by, from a fit.
 *
 * An image is an insertion point plus one vector along a pixel row and
 * one down a pixel column. The scan's pixels are the fit's SOURCE
 * space, so the answer falls straight out of where the unit square
 * lands: the origin, and the two unit steps from it.
 *
 * THE INSERTION POINT IS THE BOTTOM-LEFT, AND v POINTS UP. That is the
 * convention QCAD places an image by, and the same one the preview
 * document itself uses: it inserts the scan at (0, 0) with u = (1, 0)
 * and v = (0, 1) and the image occupies 0..width by 0..height, growing
 * UPWARD from the insertion point.
 *
 * An earlier version of this derived the placement from the image's TOP
 * left with v stepping DOWN, on the reasoning that an image's rows run
 * downward. That is true of the pixels and irrelevant here: the source
 * coordinates ARE the preview's model coordinates, where y already runs
 * up from the bottom. Deriving from the top flipped every placed scan
 * vertically -- and once a rotation was in the fit, flipped and turned.
 *
 * \return {position, u, v} in world coordinates
 */
CsScanFit.imageVectors = function(m) {
    var origin = CsScanFit.apply(m, { x: 0, y: 0 });
    var right = CsScanFit.apply(m, { x: 1, y: 0 });
    var up = CsScanFit.apply(m, { x: 0, y: 1 });
    return {
        position: origin,
        u: { x: right.x - origin.x, y: right.y - origin.y },
        v: { x: up.x - origin.x, y: up.y - origin.y }
    };
};

/**
 * Is the fit MIRRORED -- does it turn the scan over?
 *
 * A negative determinant means the transform flips handedness: the
 * placed scan reads backwards, as if seen through the paper. That is
 * essentially never what a caver wants from a sketch, and it is what a
 * pick set with two station names swapped produces -- an EXACT fit
 * through every point, and a scan laid down mirrored.
 *
 * Worth its own test because the residuals cannot see it: two pairs fit
 * a similarity exactly and three fit an affine exactly, no matter which
 * station was called which, so "off by 0" says nothing at all about
 * whether the answer is right.
 */
CsScanFit.isMirrored = function(m) {
    return (m.a * m.e - m.b * m.d) < 0;
};

/**
 * What the fit does to the scan, for a caver to sanity-check: the size
 * of one pixel, the turn in degrees, and whether it is mirrored.
 *
 * \return {unitsPerPixel, turnDeg, mirrored, stretch}
 *         `stretch` is the ratio of the two axis scales -- 1 means the
 *         scan kept its shape, and far from 1 means the fit stretched
 *         it hard, which a real scanner does not do.
 */
CsScanFit.describe = function(m) {
    var ux = m.a, uy = m.d;         // where one pixel across lands
    var vx = m.b, vy = m.e;         // where one pixel up lands
    var uLen = Math.sqrt(ux * ux + uy * uy);
    var vLen = Math.sqrt(vx * vx + vy * vy);
    return {
        unitsPerPixel: uLen,
        turnDeg: Math.atan2(uy, ux) * 180 / Math.PI,
        mirrored: CsScanFit.isMirrored(m),
        stretch: uLen < CsScanFit.TOLERANCE ? 0 : (vLen / uLen)
    };
};

/**
 * The MIDDLE of a set of scales, ignoring anything that is not a usable
 * positive number.
 *
 * The median and not the mean, for the same reason scaleOutlier uses
 * one: a single badly-placed scan in the drawing must not drag the
 * standard every other scan is measured against -- nor the scale a new
 * one is BORROWED from.
 *
 * \return the median, or null when nothing usable was given.
 */
CsScanFit.medianOf = function(values) {
    var clean = [];
    if (values === null || values === undefined) {
        return null;
    }
    for (var i = 0; i < values.length; i++) {
        if (values[i] > CsScanFit.TOLERANCE && isFinite(values[i])) {
            clean.push(values[i]);
        }
    }
    if (clean.length === 0) {
        return null;
    }
    clean.sort(function(a, b) { return a - b; });
    var mid = Math.floor(clean.length / 2);
    return (clean.length % 2 === 1) ? clean[mid] :
        (clean[mid - 1] + clean[mid]) / 2;
};

/**
 * THE ONE-STATION PLACEMENT: a scan pinned through a single station, at
 * a scale and a turn it was TOLD rather than ones it worked out.
 *
 * Two stations are what it takes to MEASURE a placement -- the distance
 * between them gives the scale and the line between them gives the
 * turn. One station measures neither, so both come from outside: the
 * scale from the scans already placed in this drawing (they are pages
 * of the same survey, drawn at the same one or two scales), and the
 * turn from the caver, who either accepts north-up or turns the scan by
 * hand afterwards.
 *
 * WHY IT IS WORTH HAVING ANYWAY. A great many sketches -- a cross
 * section, a detail of one room, a plan of a side passage -- have
 * exactly one station on them. Under a two-station rule those pages
 * cannot be placed at all, and the caver ends up eyeballing them in
 * with the mouse, which is worse than a known scale and an honest turn.
 *
 * The anchor lands EXACTLY on its station: everything else about the
 * placement is assumed, but that one point is not.
 *
 * \param pair          {source: {x,y} scan pixels, dest: {x,y} world}
 * \param unitsPerPixel the borrowed scale, drawing units per pixel
 * \param turnDeg       clockwise turn of the scan, degrees (0 = the
 *                      page's own up is the drawing's up, which for a
 *                      plan is north)
 * \return {a,b,c,d,e,f}, or null when the scale is not a usable number.
 */
CsScanFit.anchoredFit = function(pair, unitsPerPixel, turnDeg) {
    if (pair === null || pair === undefined ||
            !(unitsPerPixel > CsScanFit.TOLERANCE) ||
            !isFinite(unitsPerPixel)) {
        return null;
    }
    var deg = (turnDeg === undefined || turnDeg === null) ? 0 : turnDeg;
    // CLOCKWISE on the page is NEGATIVE in a drawing whose y runs up,
    // and the scan's pixels are already in that y-up preview space (see
    // imageVectors). So the sign is flipped here rather than at every
    // call site.
    var t = -deg * Math.PI / 180;
    var k = unitsPerPixel * Math.cos(t);
    var h = unitsPerPixel * Math.sin(t);
    return { a: k, b: -h,
             c: pair.dest.x - (k * pair.source.x - h * pair.source.y),
             d: h, e: k,
             f: pair.dest.y - (h * pair.source.x + k * pair.source.y) };
};

/**
 * Is this scan's scale out of step with the scans already placed?
 *
 * Sketches of one cave are drawn at one or two scales -- a page is
 * 1:20, maybe 1:50 -- so a new scan landing ten times the size of every
 * other one is not a new convention, it is a bad pick. The residuals
 * cannot see this either: a wrong-but-exact fit is wrong at ANY scale.
 *
 * The MEDIAN, not the mean: one already-bad scan in the drawing should
 * not drag the standard it is judged against.
 *
 * \param perPixel   the new scan's units per pixel
 * \param others     the units per pixel of the scans already placed
 * \param factor     how far out is too far (default 4x either way)
 * \return {outlier, median, ratio} -- ratio above 1 means the new scan
 *         is LARGER than its neighbours. outlier is false when there is
 *         nothing to compare against.
 */
CsScanFit.scaleOutlier = function(perPixel, others, factor) {
    var f = (factor === undefined || factor === null) ? 4 : factor;
    var median = CsScanFit.medianOf(others);
    if (median === null || perPixel <= CsScanFit.TOLERANCE) {
        return { outlier: false, median: null, ratio: 1 };
    }
    var ratio = perPixel / median;
    return { outlier: (ratio > f || ratio < 1 / f),
             median: median, ratio: ratio };
};

/** [{name, u, v}] -> "NAME@u,v;NAME@u,v". Two decimals: these are
 *  PIXELS on a scan, and a hundredth of a pixel is already finer than
 *  anyone can click. */
CsScanFit.serializeAnchors = function(anchors) {
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
        out.push(anchors[i].name + "@" + anchors[i].u.toFixed(2) + "," +
            anchors[i].v.toFixed(2));
    }
    return out.join(";");
};

/** The inverse. Malformed entries are DROPPED, never thrown: this text
 *  comes off a drawing a user can edit. */
CsScanFit.parseAnchors = function(text) {
    var out = [];
    if (text === undefined || text === null) {
        return out;
    }
    var parts = String(text).split(";");
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^\s+|\s+$/g, "");
        if (part.length === 0) {
            continue;
        }
        var at = part.lastIndexOf("@");
        if (at <= 0) {
            continue;
        }
        var coords = part.substring(at + 1).split(",");
        if (coords.length !== 2) {
            continue;
        }
        var u = parseFloat(coords[0]), v = parseFloat(coords[1]);
        if (isNaN(u) || isNaN(v)) {
            continue;
        }
        out.push({ name: part.substring(0, at), u: u, v: v });
    }
    return out;
};

/** How far each pair's mapped source misses its target.
 *  \return {average, worst, worstIndex} -- worstIndex counted from 1. */
CsScanFit.residuals = function(pairs, m) {
    var total = 0, worst = 0, worstIndex = 0;
    for (var i = 0; i < pairs.length; i++) {
        var got = CsScanFit.apply(m, pairs[i].source);
        var dx = got.x - pairs[i].dest.x, dy = got.y - pairs[i].dest.y;
        var miss = Math.sqrt(dx * dx + dy * dy);
        total += miss;
        if (miss > worst) { worst = miss; worstIndex = i + 1; }
    }
    return { average: pairs.length === 0 ? 0 : total / pairs.length,
             worst: worst, worstIndex: worstIndex };
};
