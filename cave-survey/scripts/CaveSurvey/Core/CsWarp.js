// CsWarp.js -- per-point Moving Least Squares (MLS) similarity
// deformation: warps one point given a set of control stations' old and
// new positions, weighted by inverse-square distance from the query
// point to each control's OLD position.
//
// Pure: plain {x, y} in and out, no document, no R* type -- callable
// under node AND under the engine identically, same discipline as
// CsTrace.js. Named CsWarp and not Warp because QCAD's include() dedupes
// by BASENAME (see CsTrace.js's own header comment, and
// qcad-plugin-conventions).
//
// The math is CsRevise.similarityFit's own weighted-centroid formula
// (compare CsRevise.js:504), just weighted per control pair and
// recomputed FRESH at every query point instead of once globally. This
// is why a rigid dataset (every control pair explained by ONE global
// similarity transform) reproduces that same transform everywhere,
// regardless of the point-specific weights: a weighted least-squares
// fit to data that is EXACTLY explained by one linear model recovers
// that model's parameters no matter how the weights are chosen, as
// long as at least two non-coincident control points are in play.

var CsWarp = {};

/**
 * Guards the 1/distSq weight against a literal divide-by-zero when the
 * query point coincides with a control point's old position (the
 * common case for snapped tracing, where a wall's vertex sits exactly
 * on a station/LRUD/splay tip). Squared drawing units -- at 1e-9 it is
 * far below any real coincidence tolerance (a cave is surveyed in feet
 * or metres, never sub-micron), so it only ever matters at the exact
 * coincident point, where it makes that control pair's weight
 * effectively infinite without literally dividing by zero.
 */
CsWarp.EPS = 1e-9;

/**
 * Warps one point through inverse-square-distance-weighted MLS
 * similarity deformation.
 *
 * \param point         {x, y} the point to warp
 * \param controlPairs  [{old: {x, y}, nu: {x, y}}, ...] -- the SAME
 *                       pair shape CsRevise.similarityFit uses ("nu",
 *                       not "new": a reserved word as an object key
 *                       works in this engine, but the codebase already
 *                       settled on "nu" everywhere this shape appears,
 *                       see CsRevise.js:499 and 617)
 * \return null for 0 pairs; {x, y, angle: 0, factor: 1} (pure
 *         translation) for exactly 1 pair; otherwise {x, y, angle,
 *         factor} -- angle/factor are the LOCAL rotation and uniform
 *         scale this point's neighbourhood implies, needed by callers
 *         that warp an entity described by a center rather than by a
 *         set of vertices: CsRevise.moveLinework's arc/circle branch
 *         scales the radius by `factor` and rotates the entity about
 *         its new center by `angle`, which is what carries an arc's
 *         start/end angles along with the local rotation.
 */
CsWarp.mlsSimilarity = function(point, controlPairs) {
    if (controlPairs === undefined || controlPairs === null ||
            controlPairs.length === 0) {
        return null;
    }
    if (controlPairs.length === 1) {
        var only = controlPairs[0];
        return {
            x: point.x + (only.nu.x - only.old.x),
            y: point.y + (only.nu.y - only.old.y),
            angle: 0.0,
            factor: 1.0
        };
    }

    var i, w, dx, dy, distSq;
    var sw = 0.0, px = 0.0, py = 0.0, qx = 0.0, qy = 0.0;
    var weights = [];
    for (i = 0; i < controlPairs.length; i++) {
        dx = point.x - controlPairs[i].old.x;
        dy = point.y - controlPairs[i].old.y;
        distSq = dx * dx + dy * dy;
        w = 1.0 / (distSq + CsWarp.EPS);
        weights.push(w);
        sw += w;
        px += w * controlPairs[i].old.x;
        py += w * controlPairs[i].old.y;
        qx += w * controlPairs[i].nu.x;
        qy += w * controlPairs[i].nu.y;
    }
    px /= sw;
    py /= sw;
    qx /= sw;
    qy /= sw;

    var a = 0.0, b = 0.0, s2 = 0.0;
    for (i = 0; i < controlPairs.length; i++) {
        var opx = controlPairs[i].old.x - px;
        var opy = controlPairs[i].old.y - py;
        var nqx = controlPairs[i].nu.x - qx;
        var nqy = controlPairs[i].nu.y - qy;
        w = weights[i];
        a += w * (opx * nqx + opy * nqy);
        b += w * (opx * nqy - opy * nqx);
        s2 += w * (opx * opx + opy * opy);
    }
    if (s2 <= 1e-20) {
        // every control pair's old position collapsed to the same
        // weighted centroid (all coincide): rotation/scale is
        // underdetermined, same degenerate call CsRevise.similarityFit
        // makes -- fall back to translation by the weighted centroid
        // delta.
        return { x: qx, y: qy, angle: 0.0, factor: 1.0 };
    }

    var theta = Math.atan2(b, a);
    var scale = Math.sqrt(a * a + b * b) / s2;
    var c = Math.cos(theta), s = Math.sin(theta);
    var rx = point.x - px, ry = point.y - py;

    return {
        x: qx + scale * (c * rx - s * ry),
        y: qy + scale * (s * rx + c * ry),
        angle: theta,
        factor: scale
    };
};
