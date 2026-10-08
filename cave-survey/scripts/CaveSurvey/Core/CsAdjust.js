// Adjust.js -- least-squares loop closure adjustment.
//
// Part of the Cave Survey Core library: pure functions, EXCEPT
// currentOptions(), which reads RSettings. See that function's own
// comment for why the impurity lives here rather than in every tool.
//
// CsNetwork.resolve walks a spanning tree, so all of a loop's
// accumulated error lands on whichever leg happened to close it. This
// distributes it over every leg instead, weighted by how wrong each leg
// is likely to be, holding the fixed and anchored stations.
//
// THE MATH. Each leg a->b is one observation per axis:
//
//     x_b - x_a = dx        (and the same for y and z)
//
// weighted w = 1/sigma^2 with
//
//     sigma^2 = sigmaTape^2 + (distance * sigmaAngle * pi/180)^2
//
// so angular error grows with leg length: long legs absorb more of the
// misclosure than short ones, which is the behaviour pure
// length-proportional weighting gets wrong.
//
// Minimizing the weighted sum of squared residuals and setting the
// derivative to zero at each free station k gives
//
//     (sum_i w_i) x_k  -  sum_i w_i x_other(i)
//         =  sum_{i: k is TO} w_i dx_i  -  sum_{i: k is FROM} w_i dx_i
//
// whose left-hand side is the WEIGHTED GRAPH LAPLACIAN of the survey
// network. With one scalar sigma per leg the three axes decouple: the
// same matrix solves x, y and z with three different right-hand sides.
// Fixed and anchored stations are Dirichlet boundary conditions -- out
// of the system, into the right-hand side.
//
// The matrix is never built. Jacobi-preconditioned conjugate gradient
// only needs L*v, which is a loop over the legs. Seeded with the raw
// resolve() coordinates -- already within the misclosure of the answer
// -- it converges in a handful of iterations, and a survey with no
// loops converges in zero.
//
// VERTICAL SIMPLIFICATION, deliberate. Strictly sigma_dz is
// distance*cos(inclination)*sigmaClino, and the tape contributes
// sin(inclination)*sigmaTape, so vertical variance is not horizontal
// variance. One scalar sigma per leg is what keeps the axes decoupled,
// and anisotropic per-leg covariance is out of scope by decision (see
// the design spec). This is a documented simplification, not an
// oversight.
//
// HONESTY RULE, load-bearing: the returned closures, loops and ties are
// the AS-SURVEYED ones, copied from the input, NEVER recomputed from
// adjusted coordinates. CsGrade derives the BCRA centreline grade from
// loops[].percent and CsStats prints it on the title block. Adjusted
// closures are ~0 by construction, so recomputing them would report
// every survey on earth as "grade 5, worst closure 0.00%" -- the
// suite's honesty rules inverted into a machine for laundering bad
// data. The guarantee lives in this return shape, not in anyone's
// memory, and a unit test pins it.

var CsAdjust = {};

CsAdjust.SETTING_ENABLED = "CaveSurvey/AdjustEnabled";
CsAdjust.SETTING_SIGMA_TAPE = "CaveSurvey/SigmaTape";
CsAdjust.SETTING_SIGMA_ANGLE = "CaveSurvey/SigmaAngle";

// Hand compass and tape, the suite's stated audience. DistoX-class work
// is roughly 0.3 degrees and 0.01 -- two numbers in the settings, not a
// code change. No file format records instrument precision, which is
// why this cannot be inferred from the data (the same reason CsGrade
// refuses to grade precision upward).
CsAdjust.DEFAULT_SIGMA_TAPE = 0.1;
CsAdjust.DEFAULT_SIGMA_ANGLE = 1.5;

// A noAdjust leg is held by weight rather than by eliminating it from
// the system: no constraint-elimination code path, and the matrix stays
// conditioned.
CsAdjust.NO_ADJUST_WEIGHT_FACTOR = 1e6;

// Convergence is measured as the largest coordinate step still wanted
// (see CsAdjust.solve), so the tolerance is a length: this fraction of
// the network's extent.
//
// The design spec named 1e-9 here, on the reading that the criterion
// bounds the error in the coordinates. It does not: the criterion is
// LOCAL (one station's own equation, in isolation) and the coordinate
// error it leaves behind is that imbalance amplified by the network's
// conditioning, which for a long chain of stations is large. Measured
// on a 4,000-station chain with 19 loops under node, against the same
// solve driven to 1e-16:
//
//   fraction   iterations   worst coordinate error left
//   1e-9           2210     0.13 units   <-- 40,000-unit network
//   1e-10          2455     1.7e-4
//   1e-12          2544     1.7e-5
//   1e-16          2845     (the reference)
//
// 0.13 units is invisible on a map, but it is the same order as a
// cave-survey tape reading itself -- a solver artifact should sit well
// BELOW the precision of the data it is adjusting, not level with it.
// The extra digits cost 15% more iterations and no measurable time
// (48ms vs 51ms in that run: the long-wavelength modes dominate the
// count either way, and the tail is cheap once CG turns superlinear),
// so this is 1e-12, and the iteration cap has three orders of
// magnitude of headroom over the counts above.
CsAdjust.CG_TOLERANCE_FRACTION = 1e-12;

CsAdjust.MIN_VARIANCE = 1e-12;
CsAdjust.DEG = Math.PI / 180.0;

/**
 * The angular sigma of a DECLARED PLUMB -- a leg the notes record with
 * no bearing at all, because the caver plumbed it instead of sighting
 * it (Shot.azimuthOmitted).
 *
 * WHY A PITCH IS NOT A COMPASS LEG. `sigmaAngle` is the error of a
 * hand compass and clino, and it is the right number for a leg whose
 * direction came off those instruments. A plumbed pitch's direction
 * did not: it came off GRAVITY. The rope hangs straight whatever the
 * compass says, the caver wrote a dash rather than a bearing precisely
 * because there was nothing to sight, and the residual uncertainty is
 * how far the plumb line really is from vertical -- a fraction of a
 * degree, not the one and a half a hand compass carries.
 *
 * WHAT IT WAS DOING BEFORE. With one sigma for every leg, a 187 ft
 * free-fall was modelled as being horizontally uncertain by 187 *
 * sigmaAngle, about 4.9 ft -- making it by a distance the SOFTEST leg
 * in any loop it belongs to, and so the one the adjustment poured the
 * misclosure into. The output is a rope leaning across the map, which
 * is both wrong and, on a pit map, visibly wrong: the one line on the
 * drawing a reader knows the true attitude of without being told.
 *
 * This is NOT anisotropic covariance, which CsAdjust's header rules
 * out by decision -- it is still one scalar per leg. It is the
 * recognition that the scalar depends on which instrument produced the
 * leg's direction, and the data says which.
 */
CsAdjust.PLUMB_SIGMA_ANGLE_DEG = 0.5;

/** The variance of one leg, never zero (weights are its reciprocal). */
CsAdjust.legVariance = function(shot, sigmaTape, sigmaAngle) {
    var sa = (shot && shot.azimuthOmitted === true) ?
        CsAdjust.PLUMB_SIGMA_ANGLE_DEG : sigmaAngle;
    var angular = shot.distance * sa * CsAdjust.DEG;
    var v = sigmaTape * sigmaTape + angular * angular;
    return v < CsAdjust.MIN_VARIANCE ? CsAdjust.MIN_VARIANCE : v;
};

CsAdjust.median = function(values) {
    if (values.length === 0) {
        return 1.0;
    }
    var s = values.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return (s.length % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
};

/** Bounding-box diagonal of a stations map, for scaling tolerances. */
CsAdjust.extentOf = function(stations) {
    var minX = null, maxX = null, minY = null, maxY = null,
        minZ = null, maxZ = null;
    for (var name in stations) {
        if (!stations.hasOwnProperty(name)) {
            continue;
        }
        var p = stations[name];
        if (minX === null || p.x < minX) { minX = p.x; }
        if (maxX === null || p.x > maxX) { maxX = p.x; }
        if (minY === null || p.y < minY) { minY = p.y; }
        if (maxY === null || p.y > maxY) { maxY = p.y; }
        if (minZ === null || p.z < minZ) { minZ = p.z; }
        if (maxZ === null || p.z > maxZ) { maxZ = p.z; }
    }
    if (minX === null) {
        return 0.0;
    }
    var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Jacobi-preconditioned conjugate gradient on the Laplacian, applied
 * matrix-free.
 *
 * \param n     number of free stations
 * \param diag  diagonal of L, one entry per free station
 * \param edges [{a, b, w}] free-to-free legs (indices into 0..n-1)
 * \param rhs   right-hand side for this axis
 * \param x0    starting guess (the raw coordinates)
 * \param tol   convergence threshold, a LENGTH: the largest coordinate
 *              step still wanted (see the convergence note below)
 * \return {x, iterations, converged}
 *
 * CONVERGENCE is measured on z = r/diag, the Jacobi-preconditioned
 * residual -- which is exactly the coordinate step this station's own
 * equation still asks for, so max|z| is a length in drawing units and
 * compares directly against tol. Two alternatives were tried and are
 * wrong:
 *
 *   "the step just taken was small" fails in both directions. An
 *   n = 1 system (one free station between two fixed ones) is solved
 *   EXACTLY by CG's first step, and that step is the whole misclosure
 *   -- far bigger than tol -- so the exact answer got reported as
 *   non-convergence and thrown away (measured: the two-fixed-station
 *   fixture came back unadjusted with its middle station still at the
 *   as-surveyed 10 instead of 10.3). It can also stop early on a
 *   coincidentally tiny step while the answer is still far away.
 *
 *   "the initial residual is exactly zero" (rz > 0) fails for a tree,
 *   which is the case it exists to catch. A tree's observations ARE
 *   exactly satisfiable, but the raw coordinates satisfy them only to
 *   rounding: assembling the right-hand side and applying L round
 *   differently, leaving r ~ 1e-16 instead of 0 (measured on the
 *   T1/T2/T3/T4 fixture, whose y axis then took a pointless iteration).
 *   Comparing against tol says what is actually meant: already inside
 *   tolerance, nothing to do.
 *
 * Because the loop is only entered when max|z| > tol, z is nonzero
 * there, so rz = sum z_k^2 * diag_k > 0 and the beta division below is
 * always safe -- no zero-check needed, and an exact solution reached
 * mid-flight is recognised as convergence rather than mistaken for a
 * breakdown.
 */
CsAdjust.solve = function(n, diag, edges, rhs, x0, tol, maxIter) {
    if (n === 0) {
        return { x: [], iterations: 0, converged: true };
    }
    var applyL = function(v) {
        var out = new Array(n);
        var k;
        for (k = 0; k < n; k++) {
            out[k] = diag[k] * v[k];
        }
        for (var e = 0; e < edges.length; e++) {
            var ed = edges[e];
            out[ed.a] -= ed.w * v[ed.b];
            out[ed.b] -= ed.w * v[ed.a];
        }
        return out;
    };

    var x = x0.slice();
    var Ax = applyL(x);
    var r = new Array(n), z = new Array(n), p = new Array(n);
    var rz = 0.0;
    var maxZ = 0.0;
    var k;
    for (k = 0; k < n; k++) {
        r[k] = rhs[k] - Ax[k];
        z[k] = r[k] / diag[k];
        p[k] = z[k];
        rz += r[k] * z[k];
        if (Math.abs(z[k]) > maxZ) {
            maxZ = Math.abs(z[k]);
        }
    }

    // Already solved -- a survey with no loops starts AT the answer,
    // because a tree's observations are exactly satisfiable (to
    // rounding: hence the tolerance rather than an exact zero).
    var converged = (maxZ <= tol);
    var iterations = 0;

    while (iterations < maxIter && !converged) {
        var Ap = applyL(p);
        var pAp = 0.0;
        for (k = 0; k < n; k++) {
            pAp += p[k] * Ap[k];
        }
        if (!(pAp > 0)) {
            break; // not positive definite: report failure
        }
        var alpha = rz / pAp;
        for (k = 0; k < n; k++) {
            x[k] += alpha * p[k];
            r[k] -= alpha * Ap[k];
        }
        iterations++;
        var rzNew = 0.0;
        maxZ = 0.0;
        for (k = 0; k < n; k++) {
            z[k] = r[k] / diag[k];
            rzNew += r[k] * z[k];
            if (Math.abs(z[k]) > maxZ) {
                maxZ = Math.abs(z[k]);
            }
        }
        if (maxZ <= tol) {
            converged = true;
            break;
        }
        var beta = rzNew / rz;
        rz = rzNew;
        for (k = 0; k < n; k++) {
            p[k] = z[k] + beta * p[k];
        }
    }

    return { x: x, iterations: iterations, converged: converged };
};

/**
 * The pass-through result: this survey, unadjusted, in the shape the
 * adjusted one has. Used when the solver fails to converge and by
 * callers that have adjustment switched off, so every consumer sees
 * one shape.
 *
 * `raw` is null on purpose: there is no ghost to draw when the drawn
 * geometry IS the as-surveyed geometry.
 */
CsAdjust.unadjusted = function(resolved, summaryExtra) {
    var shifts = {};
    for (var name in resolved.stations) {
        if (resolved.stations.hasOwnProperty(name)) {
            shifts[name] = { dx: 0.0, dy: 0.0, dz: 0.0, distance: 0.0 };
        }
    }
    var summary = {
        stationCount: 0,
        movedCount: 0,
        worstStation: "",
        worstShift: 0.0,
        rmsShift: 0.0,
        worstResidual: null,
        iterations: 0,
        converged: true,
        sigmaTape: 0.0,
        sigmaAngle: 0.0,
        pinned: []
    };
    for (var key in (summaryExtra || {})) {
        if (summaryExtra.hasOwnProperty(key)) {
            summary[key] = summaryExtra[key];
        }
    }
    for (name in shifts) {
        if (shifts.hasOwnProperty(name)) {
            summary.stationCount++;
        }
    }
    return {
        stations: resolved.stations,
        legs: resolved.legs,
        closures: resolved.closures,
        loops: resolved.loops,
        ties: resolved.ties || [],
        anchors: resolved.anchors || [],
        // controlFrame travels with the result: CsDraw reads it to
        // decide whether a station's `Fixed` tag can honestly be
        // written, and CsReport reads it to warn about control that
        // went unused. Dropping it here would silently reinstate a
        // Fixed tag nobody pinned and delete the warning saying so.
        controlFrame: (resolved.controlFrame === undefined) ?
            null : resolved.controlFrame,
        unresolved: resolved.unresolved,
        skipped: resolved.skipped,
        adjusted: false,
        raw: null,
        shifts: shifts,
        residuals: [],
        summary: summary
    };
};

/**
 * \param survey   the CsModel survey
 * \param resolved a CsNetwork.resolve() result (or another adjust()
 *                 result -- adjusting an adjusted survey is a no-op)
 * \param opts {
 *   sigmaTape, sigmaAngle  instrument sigmas (defaults above),
 *   tapeMode               CsTraverse mode (default slope),
 *   pinned                 [name] extra stations to hold, e.g. the
 *                          georeferenced one,
 *   maxIterations, cgTolerance  overrides, for tests
 * }
 *
 * \return {
 *   stations   ADJUSTED coordinates, seq preserved
 *   legs, unresolved, skipped        copied from the input
 *   closures, loops, ties            copied -- AS-SURVEYED, see the
 *                                    honesty rule at the top
 *   anchors, controlFrame            copied from the input: the return
 *                                    shape is a SUPERSET of a resolve
 *                                    result, and CsDraw and CsReport
 *                                    read controlFrame
 *   adjusted   true when the solve converged
 *   raw        the input resolved (what the CTRL-RAW ghost draws), or
 *              null when nothing was adjusted
 *   shifts     {name: {dx, dy, dz, distance}}
 *   residuals  per leg, aligned to legs: {shot, from, to, dx, dy, dz,
 *              distance, standardized}
 *   summary    {stationCount, movedCount, worstStation, worstShift,
 *              rmsShift, worstResidual, iterations, converged,
 *              sigmaTape, sigmaAngle, pinned}
 * }
 */
CsAdjust.adjust = function(survey, resolved, opts) {
    opts = opts || {};
    var sigmaTape = (opts.sigmaTape === undefined || opts.sigmaTape === null) ?
        CsAdjust.DEFAULT_SIGMA_TAPE : opts.sigmaTape;
    var sigmaAngle = (opts.sigmaAngle === undefined || opts.sigmaAngle === null) ?
        CsAdjust.DEFAULT_SIGMA_ANGLE : opts.sigmaAngle;
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;
    var stationsIn = resolved.stations;
    var legs = resolved.legs || [];
    var i, k, name;

    // ---- pinned stations -----------------------------------------
    // resolve()'s anchors are one per connected component, which is
    // exactly what makes the Laplacian non-singular. Fixed stations are
    // pinned on top of that even when resolve DERIVED them rather than
    // seeding from them: a second fixed entrance is control, and the
    // adjustment should close onto it.
    //
    // PINNED AT RESOLVED POSITIONS, never at the raw survey.fixed
    // coordinates. An explicit opts.anchor is a position in the
    // DRAWING's frame while survey.fixed is world control, and
    // resolve() has already reconciled the two (see its controlFrame
    // block); pinning raw control here would reintroduce exactly the
    // frame-mixing that reconciliation exists to prevent.
    //
    // EXCEPT the stations resolve() names in
    // controlFrame.notHonored. Those are fixed stations whose control
    // could NOT be placed in the explicit anchor's frame -- there was
    // no known translation -- so resolve() left them to ordinary
    // traversal. Their resolved position is a traversal artifact, not
    // control. Pinning it would freeze a made-up coordinate and force
    // the whole network to honour a number nobody measured; leaving
    // them free lets the adjustment distribute the error through them
    // like any other traversed station, which is the honest reading of
    // what is actually known about them.
    var pinned = {};
    var notHonored = {};
    if (resolved.controlFrame !== undefined && resolved.controlFrame !== null &&
            resolved.controlFrame.notHonored !== undefined &&
            resolved.controlFrame.notHonored !== null) {
        for (i = 0; i < resolved.controlFrame.notHonored.length; i++) {
            notHonored[resolved.controlFrame.notHonored[i]] = true;
        }
    }
    var addPin = function(n2) {
        if (n2 !== undefined && n2 !== null && n2 !== "" &&
                stationsIn.hasOwnProperty(n2)) {
            pinned[n2] = true;
        }
    };
    // The anchors are pinned unconditionally, with no notHonored test:
    // the two sets cannot overlap. resolve() only names a fixed station
    // notHonored when it shares a shot-graph component with the
    // explicit anchor, and everything in the anchor's component is
    // reached by ordinary traversal from that anchor -- so a notHonored
    // station is always a traversed station with a parent, never an
    // anchor. (A fixed station that seeds its own anchor is by
    // definition in a component the anchor's traversal never reaches,
    // which is precisely the case resolve() leaves alone.)
    var anchors = resolved.anchors || [];
    for (i = 0; i < anchors.length; i++) {
        addPin(anchors[i]);
    }
    for (name in survey.fixed) {
        if (survey.fixed.hasOwnProperty(name) && notHonored[name] !== true) {
            addPin(name);
        }
    }
    // opts.pinned is the caller saying "hold this one" outright (the
    // georeferenced station, say), so it wins over the notHonored
    // exclusion above: an explicit instruction is not a coordinate
    // nobody chose.
    if (opts.pinned !== undefined && opts.pinned !== null) {
        for (i = 0; i < opts.pinned.length; i++) {
            addPin(opts.pinned[i]);
        }
    }
    // Nothing pinned means nothing anchors the network and the whole
    // cave floats. Hold the first-resolved station rather than failing:
    // the drawing's origin is the least surprising thing to keep still.
    var pinnedCount = 0;
    for (name in pinned) {
        if (pinned.hasOwnProperty(name)) {
            pinnedCount++;
        }
    }
    if (pinnedCount === 0) {
        var lowest = null;
        for (name in stationsIn) {
            if (stationsIn.hasOwnProperty(name) &&
                    (lowest === null ||
                     stationsIn[name].seq < stationsIn[lowest].seq)) {
                lowest = name;
            }
        }
        if (lowest !== null) {
            pinned[lowest] = true;
        }
    }

    // ---- index the free stations ---------------------------------
    var freeNames = [];
    var index = {};
    for (name in stationsIn) {
        if (!stationsIn.hasOwnProperty(name) || pinned[name] === true) {
            continue;
        }
        index[name] = freeNames.length;
        freeNames.push(name);
    }
    var n = freeNames.length;

    // ---- weights -------------------------------------------------
    var weights = [];
    for (i = 0; i < legs.length; i++) {
        weights.push(1.0 / CsAdjust.legVariance(legs[i].shot, sigmaTape,
            sigmaAngle));
    }
    var med = CsAdjust.median(weights);
    for (i = 0; i < legs.length; i++) {
        if (legs[i].shot.noAdjust === true) {
            weights[i] = med * CsAdjust.NO_ADJUST_WEIGHT_FACTOR;
        }
    }

    // ---- assemble the Laplacian and the three right-hand sides ----
    var diag = [], bx = [], by = [], bz = [];
    for (k = 0; k < n; k++) {
        diag.push(0.0); bx.push(0.0); by.push(0.0); bz.push(0.0);
    }
    var edges = [];
    for (i = 0; i < legs.length; i++) {
        var leg = legs[i];
        if (leg.from === leg.to) {
            continue; // degenerate: constrains nothing
        }
        if (!stationsIn.hasOwnProperty(leg.from) ||
                !stationsIn.hasOwnProperty(leg.to)) {
            continue;
        }
        var w = weights[i];
        var o = CsTraverse.offset(leg.shot, tapeMode);
        var ka = index.hasOwnProperty(leg.from) ? index[leg.from] : -1;
        var kb = index.hasOwnProperty(leg.to) ? index[leg.to] : -1;
        if (ka < 0 && kb < 0) {
            continue; // both ends held: nothing to solve for
        }
        if (ka >= 0) {
            diag[ka] += w;
            bx[ka] -= w * o.dx; by[ka] -= w * o.dy; bz[ka] -= w * o.dz;
            if (kb < 0) {
                var pb = stationsIn[leg.to];
                bx[ka] += w * pb.x; by[ka] += w * pb.y; bz[ka] += w * pb.z;
            }
        }
        if (kb >= 0) {
            diag[kb] += w;
            bx[kb] += w * o.dx; by[kb] += w * o.dy; bz[kb] += w * o.dz;
            if (ka < 0) {
                var pa = stationsIn[leg.from];
                bx[kb] += w * pa.x; by[kb] += w * pa.y; bz[kb] += w * pa.z;
            }
        }
        if (ka >= 0 && kb >= 0) {
            edges.push({ a: ka, b: kb, w: w });
        }
    }
    // A free station touched by no leg has an empty row: hold it where
    // it is rather than dividing by a zero diagonal.
    for (k = 0; k < n; k++) {
        if (diag[k] === 0.0) {
            var p0 = stationsIn[freeNames[k]];
            diag[k] = 1.0; bx[k] = p0.x; by[k] = p0.y; bz[k] = p0.z;
        }
    }

    // ---- solve ---------------------------------------------------
    var extent = CsAdjust.extentOf(stationsIn);
    var tol = (opts.cgTolerance === undefined || opts.cgTolerance === null) ?
        CsAdjust.CG_TOLERANCE_FRACTION * Math.max(extent, 1.0) :
        opts.cgTolerance;
    var maxIter = (opts.maxIterations === undefined ||
        opts.maxIterations === null) ? Math.max(10 * n, 50) :
        opts.maxIterations;

    var x0 = [], y0 = [], z0 = [];
    for (k = 0; k < n; k++) {
        var p = stationsIn[freeNames[k]];
        x0.push(p.x); y0.push(p.y); z0.push(p.z);
    }
    var sx = CsAdjust.solve(n, diag, edges, bx, x0, tol, maxIter);
    var sy = CsAdjust.solve(n, diag, edges, by, y0, tol, maxIter);
    var sz = CsAdjust.solve(n, diag, edges, bz, z0, tol, maxIter);
    var iterations = Math.max(sx.iterations, sy.iterations, sz.iterations);

    // A half-solved network is worse than an unsolved one, because it
    // LOOKS adjusted. Hand back the survey as measured and say why.
    if (!(sx.converged && sy.converged && sz.converged)) {
        return CsAdjust.unadjusted(resolved, {
            converged: false,
            iterations: iterations,
            sigmaTape: sigmaTape,
            sigmaAngle: sigmaAngle,
            warning: "the adjustment did not converge -- coordinates are " +
                "as surveyed, with the misclosure still on the closing leg"
        });
    }

    // ---- adjusted coordinates and per-station shifts --------------
    var stations = {};
    var shifts = {};
    var moveEps = 1e-9 * Math.max(extent, 1.0);
    var movedCount = 0, worstShift = 0.0, worstStation = "";
    var sumSq = 0.0, stationCount = 0;
    for (name in stationsIn) {
        if (!stationsIn.hasOwnProperty(name)) {
            continue;
        }
        var raw = stationsIn[name];
        var nx = raw.x, ny = raw.y, nz = raw.z;
        if (index.hasOwnProperty(name)) {
            k = index[name];
            nx = sx.x[k]; ny = sy.x[k]; nz = sz.x[k];
        }
        stations[name] = { x: nx, y: ny, z: nz, seq: raw.seq };
        var ddx = nx - raw.x, ddy = ny - raw.y, ddz = nz - raw.z;
        var dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        shifts[name] = { dx: ddx, dy: ddy, dz: ddz, distance: dist };
        stationCount++;
        sumSq += dist * dist;
        if (dist > moveEps) {
            movedCount++;
        }
        if (dist > worstShift) {
            worstShift = dist;
            worstStation = name;
        }
    }

    // ---- per-leg residuals ---------------------------------------
    // Produced for B5 blunder hunting: `standardized` is the residual
    // in units of its own sigma, which is the statistic that ranks
    // suspects. Nothing surfaces it yet, by decision.
    var residuals = [];
    var worstResidual = null;
    for (i = 0; i < legs.length; i++) {
        var lg = legs[i];
        var pa2 = stations[lg.from], pb2 = stations[lg.to];
        if (pa2 === undefined || pb2 === undefined) {
            continue;
        }
        var of = CsTraverse.offset(lg.shot, tapeMode);
        var rx = (pb2.x - pa2.x) - of.dx;
        var ry = (pb2.y - pa2.y) - of.dy;
        var rz2 = (pb2.z - pa2.z) - of.dz;
        var rd = Math.sqrt(rx * rx + ry * ry + rz2 * rz2);
        var sg = Math.sqrt(CsAdjust.legVariance(lg.shot, sigmaTape,
            sigmaAngle));
        var res = { shot: lg.shot, from: lg.from, to: lg.to,
            dx: rx, dy: ry, dz: rz2, distance: rd,
            standardized: sg > 0 ? rd / sg : 0.0 };
        residuals.push(res);
        if (worstResidual === null ||
                res.standardized > worstResidual.standardized) {
            worstResidual = res;
        }
    }

    var pinnedNames = [];
    for (name in pinned) {
        if (pinned.hasOwnProperty(name)) {
            pinnedNames.push(name);
        }
    }

    return {
        stations: stations,
        legs: legs,
        closures: resolved.closures,
        loops: resolved.loops,
        ties: resolved.ties || [],
        anchors: anchors,
        // see CsAdjust.unadjusted for why controlFrame must travel
        controlFrame: (resolved.controlFrame === undefined) ?
            null : resolved.controlFrame,
        unresolved: resolved.unresolved,
        skipped: resolved.skipped,
        adjusted: true,
        raw: (resolved.raw !== undefined && resolved.raw !== null) ?
            resolved.raw : resolved,
        shifts: shifts,
        residuals: residuals,
        summary: {
            stationCount: stationCount,
            movedCount: movedCount,
            worstStation: worstStation,
            worstShift: worstShift,
            rmsShift: stationCount > 0 ?
                Math.sqrt(sumSq / stationCount) : 0.0,
            worstResidual: worstResidual,
            iterations: iterations,
            converged: true,
            sigmaTape: sigmaTape,
            sigmaAngle: sigmaAngle,
            pinned: pinnedNames
        }
    };
};

/**
 * The options in force: the stored settings where a QCAD engine is
 * present, the defaults where it is not (node, and the unit tests).
 *
 * IMPURE, by decision, and the only function in this file that is:
 * see the module header. The alternative is every tool (CsDraw,
 * CsBind, CsReport, ...) duplicating three RSettings lookups and three
 * defaults, and drifting on them the way independently-copied defaults
 * always do. CsBind.SETTING_AUTO_BIND read RSettings from within Core
 * first, so the precedent already exists here; this just follows it.
 * try/catch guards an engine whose getters differ or throw -- the
 * defaults must stand rather than the caller crashing on a redraw.
 */
CsAdjust.currentOptions = function() {
    var enabled = true;
    var sigmaTape = CsAdjust.DEFAULT_SIGMA_TAPE;
    var sigmaAngle = CsAdjust.DEFAULT_SIGMA_ANGLE;
    if (typeof RSettings !== "undefined") {
        try {
            enabled = RSettings.getBoolValue(CsAdjust.SETTING_ENABLED, true);
            sigmaTape = RSettings.getDoubleValue(CsAdjust.SETTING_SIGMA_TAPE,
                CsAdjust.DEFAULT_SIGMA_TAPE);
            sigmaAngle = RSettings.getDoubleValue(CsAdjust.SETTING_SIGMA_ANGLE,
                CsAdjust.DEFAULT_SIGMA_ANGLE);
        } catch (e) {
            // an engine without these getters: the defaults stand
            enabled = true;
            sigmaTape = CsAdjust.DEFAULT_SIGMA_TAPE;
            sigmaAngle = CsAdjust.DEFAULT_SIGMA_ANGLE;
        }
    }
    return { enabled: enabled === true, sigmaTape: sigmaTape,
        sigmaAngle: sigmaAngle };
};

/**
 * The options a DRAWING was adjusted with, from its trip-0 anchor tags,
 * falling back to the current settings for anything it does not
 * record.
 *
 * A drawing's own record wins so that reopening it and pressing Draw
 * reproduces the geometry it already has, instead of silently
 * re-solving under whatever the global setting happens to be today --
 * the exact failure this feature exists to make visible rather than
 * sneak past someone.
 *
 * \param tags {Adjustment, SigmaTape, SigmaAngle} as read by CsTags.get
 *             (missing tags read back as "" or undefined -- both are
 *             treated as "not recorded" below)
 */
CsAdjust.optionsFromTags = function(tags) {
    var current = CsAdjust.currentOptions();
    tags = tags || {};
    var mode = tags.Adjustment;
    var enabled = current.enabled;
    if (mode === "none") {
        enabled = false;
    } else if (mode === "lsq") {
        enabled = true;
    }
    // A blank or unparseable recorded sigma must fall back rather than
    // yield NaN: NaN would poison every weight the solve builds from
    // it, silently, since NaN comparisons never throw.
    var num = function(text, fallback) {
        if (text === undefined || text === null || text === "") {
            return fallback;
        }
        var v = parseFloat(text);
        return isNaN(v) ? fallback : v;
    };
    return {
        enabled: enabled,
        sigmaTape: num(tags.SigmaTape, current.sigmaTape),
        sigmaAngle: num(tags.SigmaAngle, current.sigmaAngle)
    };
};

/** The tag values to record for a given set of options. */
CsAdjust.tagsFor = function(options) {
    return {
        Adjustment: options.enabled ? "lsq" : "none",
        SigmaTape: String(options.sigmaTape),
        SigmaAngle: String(options.sigmaAngle)
    };
};

/**
 * Resolve, then adjust if adjustment is on -- the one call every tool
 * makes, so that "on" and "off" hand back the same shape (both carry
 * `controlFrame`, both carry `adjusted`, only one carries a non-null
 * `raw`) and no caller has to branch.
 *
 * NOT carried through, either branch: CsNetwork.resolve's own
 * `anchorZUnknown` / `fixedZUnknown` (see that function's own docblock
 * for why that is deliberate, and where a user actually learns of a
 * null z instead -- CsProfile's findings.stopped, reason "no-z"). Both
 * CsAdjust.unadjusted and CsAdjust.adjust build a fresh result object
 * rather than passing `resolved` through, and neither copies these two
 * fields -- since this function is what every shipped caller actually
 * calls, that means the fields are effectively invisible past this
 * point today, diagnostic/test-only via a bare CsNetwork.resolve() call.
 *
 * \param adjustOpts as CsAdjust.adjust's opts, plus `enabled`; omitted
 *                   means CsAdjust.currentOptions().
 */
CsAdjust.resolveAndAdjust = function(survey, resolveOpts, adjustOpts) {
    var resolved = CsNetwork.resolve(survey, resolveOpts || {});
    var o = adjustOpts || CsAdjust.currentOptions();
    if (o.enabled === false) {
        return CsAdjust.unadjusted(resolved, {
            sigmaTape: o.sigmaTape, sigmaAngle: o.sigmaAngle });
    }
    return CsAdjust.adjust(survey, resolved, o);
};
