// CsTrace.js -- the math behind Feature Trace.
//
// Part of the Cave Survey Core library. resample(), reduce() and
// spacingFor() are PURE: plain {x, y} objects in and out, no document,
// no R* type, so the headless harness calls them under node. The
// document-touching half of this file is added by later tasks and is
// QCAD-only.
//
// Named CsTrace and not Trace because QCAD's include() dedupes by
// BASENAME: a Trace.js colliding with anything QCAD already loaded
// would be skipped in silence.

var CsTrace = {};

/**
 * Drawing-unit distance that means "one foot of cave".
 *
 * The trace samples one control point per foot, and a foot is a foot
 * whatever the drawing is in -- a metric cave must not get points a
 * metre apart just because its unit is bigger. Anything unrecognised
 * answers 1.0: treating an unknown unit as feet keeps the tool usable
 * and merely mis-spaces a curve, where refusing would block tracing
 * entirely.
 *
 * NOTE for anyone tempted to divide this by the profile's vertical
 * exaggeration: don't. This spacing and reduce()'s tolerance govern how
 * smooth the drawn curve looks ON THE SHEET, not how anything is
 * measured. An exaggerated elevation wants the same sheet smoothness as
 * a 1:1 one, so scaling by exaggeration only makes profile traces lumpy.
 */
/**
 * How finely a traced stroke is sampled, in FEET of cave.
 *
 * ONE NUMBER FOR EVERY TRACE IN THE SUITE -- feature walls, shaped-line
 * spines and area boundaries all read it here, because "how much detail
 * does a trace keep" is one question and three answers would drift
 * (Nathan, 2026-09-12: "I want to raise the resolution at which ALL
 * trace splines are captured").
 *
 * HALF A FOOT, and the number moved twice in one day for a reason worth
 * recording. It was raised from 1.0 to 0.25 while traces were fitted by
 * an APPROXIMATING cubic, where the only lever on a rounded corner was
 * the step size. Once interpolatingSpline landed -- a curve that passes
 * THROUGH its points -- the measurement changed the answer:
 *
 *   fit             step      corner error     control points
 *   approximating    1.0 ft      3.35 in            93
 *   approximating    0.25 ft     0.97 in           369
 *   interpolating    0.5 ft      0.35 in           185
 *
 * The corner is what reads on a map, and interpolating at half a foot
 * beats approximating at a quarter foot there by three times, on half
 * the points. Half the points also means half the CsWarp per-vertex MLS
 * cost, which is the cost a caver actually feels when an adjustment
 * moves linework -- file size never was the constraint (splines are 8.6%
 * of a real cave file at 85 bytes a point).
 *
 * Not finer: at 1"=50ft a quarter foot is already 0.13 mm on paper,
 * thinner than a pen line, and below about here a stroke records the
 * trackpad rather than the cave. Full table in
 * docs/superpowers/specs/2026-09-12-spline-fidelity.md.
 */
CsTrace.INTERVAL_FEET = 0.5;

/**
 * The sampling distance for a trace, in DRAWING UNITS.
 *
 * spacingFor is units-per-FOOT -- a unit conversion, not an interval.
 * Multiplying it by INTERVAL_FEET here is what keeps one setting
 * meaning the same thing in a foot drawing and a metre one, and stops a
 * caller reaching for spacingFor alone and silently getting a one-foot
 * interval back.
 */
CsTrace.sampleSpacing = function(unitName) {
    return CsTrace.spacingFor(unitName) * CsTrace.INTERVAL_FEET;
};

CsTrace.spacingFor = function(unitName) {
    if (unitName === CsUnits.METERS) {
        return CsUnits.convert(1.0, CsUnits.FEET, CsUnits.METERS);
    }
    return 1.0;
};

/** Plain 2D distance between two {x, y}. */
CsTrace.distance = function(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/** A shallow copy of a point list, so no caller's array is aliased. */
CsTrace.copyOf = function(points) {
    var out = [];
    if (isNull(points)) {
        return out;
    }
    for (var i = 0; i < points.length; i++) {
        out.push({ x: points[i].x, y: points[i].y });
    }
    return out;
};

/**
 * The captured drag, respaced to a point every `spacing` units of
 * arc length along it.
 *
 * The capture itself samples on a SCREEN-space threshold (see
 * FeatureTraceRun), which is what keeps the drag responsive at any
 * zoom -- but it also means the raw samples are spaced by whatever the
 * zoom happened to be. This is the step that makes the spacing mean
 * something in the cave rather than on the monitor.
 *
 * The last input point is always kept even when it lands less than
 * `spacing` past the previous one: the end of a wall is a place the
 * caver chose, and rounding it back to the last whole foot visibly
 * shortens the run.
 *
 * Degenerate input is returned as a copy rather than refused. A
 * one-point drag is a click, not an error, and a spacing of zero would
 * loop forever -- both are the caller's business to notice, and
 * neither is worth a throw mid-drag.
 */
CsTrace.resample = function(points, spacing) {
    if (isNull(points) || points.length < 2 || !(spacing > 0)) {
        return CsTrace.copyOf(points);
    }

    var out = [{ x: points[0].x, y: points[0].y }];
    var carried = 0;   // distance already walked past the last emitted point
    var i;

    for (i = 1; i < points.length; i++) {
        var from = points[i - 1];
        var to = points[i];
        var segment = CsTrace.distance(from, to);
        if (!(segment > 0)) {
            // A zero-length segment has no direction to walk. NOT a
            // divide-by-zero guard, though it reads like one: walked is
            // spacing - carried and carried is strictly < spacing, so
            // walked > 0 and the while below can never run when segment
            // is 0. Removing this is behaviour-preserving -- it is kept
            // to say so out loud, and a mutation test confirms no test
            // can kill it.
            continue;
        }

        var walked = spacing - carried;
        while (walked <= segment) {
            var t = walked / segment;
            out.push({
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t
            });
            walked = walked + spacing;
        }
        carried = segment - (walked - spacing);
    }

    var last = points[points.length - 1];
    var tail = out[out.length - 1];
    if (CsTrace.distance(tail, last) > 0) {
        out.push({ x: last.x, y: last.y });
    }
    return out;
};

/** Perpendicular distance from p to the infinite line through a and b. */
CsTrace.perpendicular = function(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) {
        return CsTrace.distance(p, a);   // a and b coincide: it is a point
    }
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};

/**
 * Ramer-Douglas-Peucker: drop every point that lies within `tolerance`
 * of the polyline its neighbours already describe.
 *
 * This is what makes the output a spline rather than a polyline in a
 * costume. Fitting a spline through one point per foot gives a
 * 400-fit-point curve on a 400 ft passage: visually identical to the
 * polyline, slow to redraw, and unusable to hand-edit. After reduction
 * a straight passage carries a handful of points and a scalloped wall
 * carries many, which is the shape a cartographer would have clicked
 * by hand.
 *
 * The first and last points are structurally never candidates -- the
 * recursion only ever examines the interior of a span.
 */
CsTrace.reduce = function(points, tolerance) {
    if (isNull(points) || points.length < 3) {
        return CsTrace.copyOf(points);
    }

    var keep = [];
    var i;
    for (i = 0; i < points.length; i++) {
        keep.push(false);
    }
    keep[0] = true;
    keep[points.length - 1] = true;

    CsTrace.reduceSpan(points, 0, points.length - 1, tolerance, keep);

    var out = [];
    for (i = 0; i < points.length; i++) {
        if (keep[i]) {
            out.push({ x: points[i].x, y: points[i].y });
        }
    }
    return out;
};

/**
 * Marks the one interior point of [first, last] furthest from the chord
 * when that distance exceeds tolerance, then recurses either side of it.
 * Recursive rather than iterative because the depth is bounded by the
 * number of KEPT points, not the number of samples.
 */
CsTrace.reduceSpan = function(points, first, last, tolerance, keep) {
    if (last <= first + 1) {
        return;
    }

    var worst = -1;
    var worstAt = -1;
    var i;
    for (i = first + 1; i < last; i++) {
        var d = CsTrace.perpendicular(points[i], points[first], points[last]);
        if (d > worst) {
            worst = d;
            worstAt = i;
        }
    }

    if (worstAt < 0 || !(worst > tolerance)) {
        return;   // every interior point is inside tolerance: drop them all
    }

    keep[worstAt] = true;
    CsTrace.reduceSpan(points, first, worstAt, tolerance, keep);
    CsTrace.reduceSpan(points, worstAt, last, tolerance, keep);
};

// ---------------------------------------------------------------------
// The point-to-frame test. QCAD context only -- it reads a document.
// ---------------------------------------------------------------------

/**
 * The bounding box of everything drawn in the profile frame, as
 * {minX, minY, maxX, maxY}, or null when this drawing has no profile
 * geometry in it at all.
 *
 * Delegates to CsProfileDraw.frameExtents rather than carrying its own
 * union: that function already walks the entities, asks
 * CsLayers.frameOf, survives an entity whose layer or bounding box the
 * bridge refuses, and does NOT assume getCorner1() holds the smaller
 * coordinate. A second copy here would have to keep agreeing with it
 * about all four.
 *
 * Derived from ENTITIES, deliberately, rather than from
 * CsProfileDraw.regionOrigin(). The origin marker gives a POINT and not
 * an extent, so a region test built on it would have to re-derive the
 * band bounds from the survey model -- work this tool has no reason to
 * do. And the caver's own tracing legitimately GROWS the region: a
 * floor sketched below the generated band is profile-frame geometry,
 * and a region that stopped at the generator's output would call the
 * caver's own linework plan.
 */
CsTrace.profileRegion = function(doc) {
    return CsProfileDraw.frameExtents(doc, "profile");
};

/**
 * Every OPEN section sketching bay, as
 * [{bay, station, minX, minY, maxX, maxY}].
 *
 * `bay` and `station` come from the frame's own SectionBay and
 * SectionBayStation tags -- the same two SectionCapture reads when it
 * turns a bay into a block. They ride along here so a tool that has
 * already located a stroke inside a bay can say WHICH station that
 * stroke belongs to without a second walk of the drawing.
 *
 * Every caller that predates them reads only the four bounds, so the
 * extra fields cost nothing and break nothing.
 *
 * A bay is the section frame. Unlike the plan and the elevation, the
 * section view has no standing ground in the drawing at all: a captured
 * section is a block reference, and the only place section linework is
 * ever loose is inside a bay that SectionBay opened and
 * SectionCapture will tear down. So "am I in the section frame" is
 * exactly "am I inside an open bay", and outside every bay there is no
 * section frame to be in.
 *
 * The tag names are SectionBay.TAG_BAY and its "frame" role, spelled
 * as LITERALS here because Core cannot include an add-on -- the same
 * arrangement CsProfileBox.boxes has with CsProfileDraw's "ProfileBox".
 * If either name changes there, it changes here.
 *
 * e.update() before the bounding box, because the caver can DRAG a bay
 * across the sheet and a cached box answers where it used to be -- the
 * trap SectionCapture.findBay records for the same rectangle.
 *
 * QCAD only.
 */
CsTrace.sectionBays = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var bayId = CsTags.get(e, "SectionBay");
        if (bayId === "" ||
                CsTags.get(e, "SectionBayRole") !== "frame") {
            continue;
        }
        try {
            e.update();
            var bb = e.getBoundingBox();
            out.push({
                bay: bayId,
                station: CsTags.get(e, "SectionBayStation"),
                minX: bb.getMinimum().x, minY: bb.getMinimum().y,
                maxX: bb.getMaximum().x, maxY: bb.getMaximum().y });
        } catch (eBox) {
            // an unreadable frame answers nothing rather than wrongly
        }
    }
    return out;
};

/** A hair of tolerance on a frame edge: a stroke laid exactly along a
 *  bay's boundary is inside the bay, which is also what the capture
 *  sweep decides about it (CsSectionBay: "flush with the frame counts
 *  as IN"). Matches CsProfileBox.EDGE_EPS. */
CsTrace.EDGE_EPS = 1e-6;

/**
 * The two tags a piece of work drawn INSIDE a section bay carries: the
 * bay it was drawn in, and the station that bay is a section of.
 *
 * HERE, IN CORE, and not in whichever tool writes them. Feature Trace
 * stamps traced linework with these and the Symbol Palette stamps
 * placed symbols with the same two, because Capture sweeps both out of
 * the same bay -- and two tools spelling "which bay this belongs to"
 * two different ways would mean the sweep had to know about both.
 * FeatureTraceRun.BAY_TAG / STATION_TAG are aliases of these and are
 * what the existing tests and callers still name.
 *
 * Deliberately NOT the bay tool's own SectionBay/SectionBayRole pair:
 * those two mark the bay's own FURNITURE -- the frame, the ghost, the
 * scan -- and SectionCapture and SectionEdit both walk the drawing
 * looking for them. Traced work wearing the same tag with no role would
 * sit inside those sweeps as a permanent "what is this?".
 */
CsTrace.SECTION_BAY_TAG = "SectionTraceBay";
CsTrace.SECTION_STATION_TAG = "SectionTraceStation";

/** True when `point` is inside one of `rects` (edge counts as inside).
 *  Pure. */
CsTrace.inAnyRect = function(rects, point) {
    if (isNull(rects)) {
        return false;
    }
    var eps = CsTrace.EDGE_EPS;
    for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (point.x >= r.minX - eps && point.x <= r.maxX + eps &&
                point.y >= r.minY - eps && point.y <= r.maxY + eps) {
            return true;
        }
    }
    return false;
};

/** The bay containing `point`, or null. The first match wins: bays are
 *  disjoint in practice (each is parked somewhere clear) and nothing
 *  enforces it, so "the first bay that claims this point" is as honest
 *  as the geometry allows -- CsProfileBox.at's rule, for its reasons. */
CsTrace.bayAt = function(bays, point) {
    if (isNull(bays)) {
        return null;
    }
    var eps = CsTrace.EDGE_EPS;
    for (var i = 0; i < bays.length; i++) {
        var r = bays[i];
        if (point.x >= r.minX - eps && point.x <= r.maxX + eps &&
                point.y >= r.minY - eps && point.y <= r.maxY + eps) {
            return r;
        }
    }
    return null;
};

/**
 * The ONE bay that owns a whole path, or null: every point inside the
 * same bay. A path that leaves the bay, or crosses from one into
 * another, answers null -- the caller then knows nothing about which
 * station the work belongs to, which is the honest answer and better
 * than stamping it with a guess.
 *
 * The section counterpart of CsProfileBox.runForPath, deliberately the
 * same shape: both answer "which container owns this stroke", both
 * refuse a stroke that wanders, and a caller reads them the same way.
 */
CsTrace.bayForPath = function(bays, points) {
    if (isNull(points) || points.length === 0) {
        return null;
    }
    var bay = null;
    for (var i = 0; i < points.length; i++) {
        var here = CsTrace.bayAt(bays, points[i]);
        if (here === null) {
            return null;
        }
        if (bay === null) {
            bay = here;
        } else if (bay !== here) {
            return null;   // crossed into another bay
        }
    }
    return bay;
};

/**
 * Which view a POINT falls in: "section" inside an open bay, "profile"
 * inside the region box, "plan" everywhere else.
 *
 * Pure -- boxes and a point, no document -- so node tests it and, more
 * importantly, so a caller can compute the boxes ONCE and ask this many
 * times. The cursor readout asks per mouse-move event, and each of the
 * two collections costs a walk of every entity in the drawing.
 *
 * SECTION WINS WHEN A POINT IS IN BOTH. A bay is parked wherever the
 * caver last left it (SectionBay.rememberedCorner), so nothing stops
 * one landing over ground the elevation already claims -- and the
 * derived profile region GROWS with every profile trace, so a bay that
 * was clear when it opened can be swallowed later. A bay is the
 * explicit, deliberate, short-lived record of "I am sketching a section
 * HERE", where the region is a union inferred from whatever happens to
 * be drawn; deferring to the region would make the section tiles go
 * inert exactly where the bay happened to land, which is the failure
 * this precedence exists to prevent. The same reasoning CsProfileBox
 * states as "boxes first (the explicit record)".
 *
 * "plan" is the answer for anything outside both, INCLUDING the gutter
 * between the views and every point in a drawing with no elevation and
 * no open bay. That matches CsLayers.frameOf's own deliberate default:
 * the dangerous mistake is a frame-scoped operation claiming ground it
 * does not own, so unclaimed ground belongs to the frame that owns the
 * drawing's origin.
 *
 * `bays` is optional. Omitting it answers as this function did before
 * the section frame existed, which is what a caller with no bays to
 * offer means.
 */
CsTrace.frameIn = function(box, point, bays) {
    if (CsTrace.inAnyRect(bays, point)) {
        return "section";
    }
    if (isNull(box) || box === null) {
        return "plan";
    }
    if (point.x < box.minX || point.x > box.maxX ||
            point.y < box.minY || point.y > box.maxY) {
        return "plan";
    }
    return "profile";
};

/**
 * frameIn against the region and the bays this document happens to have
 * right now.
 *
 * Convenience only, and NOT for use per mouse-move event: it walks
 * every entity in the drawing twice. Anything asking repeatedly must
 * call profileRegion and sectionBays once, hold both, and use frameIn.
 */
CsTrace.frameAt = function(doc, point) {
    return CsTrace.frameIn(CsTrace.profileRegion(doc), point,
        CsTrace.sectionBays(doc));
};

/**
 * The one frame every point of a path shares, or null when they
 * disagree.
 *
 * null is what makes a cross-gutter drag refusable at release. A wall
 * that starts in the plan and ends in the elevation describes nothing
 * in either view, and letting it land would put linework into a
 * drawing whose whole binding model assumes frames do not mix.
 *
 * Takes the BOX and the bay rects, not the document: once per drag
 * instead of once per point keeps this O(points) rather than
 * O(points x entities).
 */
CsTrace.pathFrame = function(box, points, bays) {
    if (isNull(points) || points.length === 0) {
        return null;
    }
    var first = CsTrace.frameIn(box, points[0], bays);
    for (var i = 1; i < points.length; i++) {
        if (CsTrace.frameIn(box, points[i], bays) !== first) {
            return null;
        }
    }
    return first;
};

/**
 * A cubic spline whose CONTROL points are `points`, or null when there
 * is no curve to make.
 *
 * Control points, not fit points: FIT-POINT SPLINES ARE A QCAD PRO
 * FEATURE, and this suite targets CaveCAD, a fork of the Community
 * edition. There is no interpolation engine here to turn fit points
 * into a curve.
 *
 * It fails SILENTLY, which is what cost a release: appendFitPoint
 * leaves getControlPoints() empty, the entity's bounding box is 0 x 0,
 * nothing renders, and the DXF exporter writes no SPLINE record at all
 * -- so a trace vanished on save. updateFromFitPoints() does not help.
 * Worst of all isValid() still answers TRUE, which is exactly why no
 * assertion caught it. Never assert a spline by isValid(); assert its
 * BOUNDING BOX and a DXF round trip.
 *
 * The trade: a control-point spline APPROXIMATES its points rather than
 * passing through them, so the curve sits a little inside a tight bend.
 * A cubic B-spline stays within the convex hull of its control polygon,
 * so at one point per foot the deviation is inches -- invisible at
 * survey scale. On a sharp corner it rounds more, which is what the
 * panel's Smoothing control is for: Fine keeps more points and holds
 * the corner tighter.
 *
 * setDegree(3) explicitly: a control-point spline does not inherit a
 * degree from anywhere, and a test pins that the result is cubic.
 */
CsTrace.fitSpline = function(doc, points) {
    if (isNull(points) || points.length < 2) {
        return null;
    }
    var spline = new RSpline();
    spline.setDegree(CsTrace.degreeFor(points.length));
    spline.setPeriodic(false);
    for (var i = 0; i < points.length; i++) {
        spline.appendControlPoint(new RVector(points[i].x, points[i].y));
    }
    return new RSplineEntity(doc, new RSplineData(spline));
};

/**
 * The highest degree `count` control points can actually carry, capped
 * at cubic.
 *
 * A B-spline of degree d needs at least d + 1 control points. Ask for
 * cubic with two and the curve is degenerate: no geometry, no bounding
 * box, no DXF record, and -- as ever in this build -- no error either.
 *
 * This is not a corner case. A STRAIGHT passage is the commonest thing
 * a caver traces, reduce() collapses it to exactly its two endpoints,
 * and every straight wall would silently vanish. Two points give a
 * degree-1 spline, which is the straight line that trace actually was.
 */
// ---- interpolating splines -------------------------------------------
//
// A CURVE THAT PASSES THROUGH THE POINTS, computed here rather than
// asked of the engine. fitSpline above APPROXIMATES: its points are
// control points, so every bend is pulled inside the control polygon by
// a fraction of the sampling step and a traced corner rounds off.
// QCAD's own answer -- fit-point splines -- is a Pro feature this fork
// does not have, and reaching for it cost a release (see fitSpline).
//
// So we compute the control points OURSELVES such that the resulting
// cubic B-spline interpolates the samples: global interpolation, the
// textbook method (Piegl & Tiller A9.1). The output is an ordinary
// control-point spline, which this build renders, saves and round-trips
// exactly as it always has -- nothing Pro is involved (Nathan,
// 2026-09-12: "build our own spline math").
//
// CENTRIPETAL parameterisation, not chord-length: on hand-traced data
// the two differ where samples bunch at a corner, and chord-length
// answers that with an overshoot loop outside the traced line.
// Centripetal is the standard cure and costs one square root.

CsTrace.INTERP_DEGREE = 3;

/** Parameter for each point, by the centripetal rule, normalised to
 *  [0, 1]. Returns null when the points cannot be parameterised (a
 *  zero-length path, every point on top of the last). */
CsTrace.centripetalParams = function(points) {
    var n = points.length - 1;
    var i;
    var d = 0;
    var seg = [];
    for (i = 1; i <= n; i++) {
        var s = Math.sqrt(CsTrace.distance(points[i - 1], points[i]));
        seg.push(s);
        d += s;
    }
    if (!(d > 0)) {
        return null;
    }
    var u = [0];
    var acc = 0;
    for (i = 1; i <= n; i++) {
        acc += seg[i - 1];
        u.push(acc / d);
    }
    u[n] = 1;
    return u;
};

/** The clamped knot vector for interpolation: p+1 zeros, the averaged
 *  interior knots, p+1 ones. Averaging is what keeps the system below
 *  nonsingular -- an arbitrary knot vector does not. */
CsTrace.averagedKnots = function(u, p) {
    var n = u.length - 1;
    var m = n + p + 1;
    var U = [];
    var i, j;
    for (i = 0; i <= p; i++) {
        U.push(0);
    }
    for (j = 1; j <= n - p; j++) {
        var sum = 0;
        for (i = j; i <= j + p - 1; i++) {
            sum += u[i];
        }
        U.push(sum / p);
    }
    for (i = 0; i <= p; i++) {
        U.push(1);
    }
    while (U.length < m + 1) {
        U.splice(U.length - (p + 1), 0, 0.5);
    }
    return U;
};

/** The knot span containing uu. */
CsTrace.findSpan = function(n, p, uu, U) {
    if (uu >= U[n + 1]) {
        return n;
    }
    if (uu <= U[p]) {
        return p;
    }
    var low = p, high = n + 1, mid = Math.floor((low + high) / 2);
    while (uu < U[mid] || uu >= U[mid + 1]) {
        if (uu < U[mid]) {
            high = mid;
        } else {
            low = mid;
        }
        mid = Math.floor((low + high) / 2);
    }
    return mid;
};

/** The p+1 basis functions that are non-zero at uu (Cox-de Boor, in the
 *  no-division-by-zero form). */
CsTrace.basisFuns = function(span, uu, p, U) {
    var N = [1];
    var left = [0], right = [0];
    var j, r;
    for (j = 1; j <= p; j++) {
        left[j] = uu - U[span + 1 - j];
        right[j] = U[span + j] - uu;
        var saved = 0;
        for (r = 0; r < j; r++) {
            var denom = right[r + 1] + left[j - r];
            var temp = denom === 0 ? 0 : N[r] / denom;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
    return N;
};

/**
 * Solves the interpolation system for control points.
 *
 * BANDED, not dense: a long wall at a quarter-foot step is thousands of
 * points, and a dense (n+1)^2 matrix would be millions of cells in a
 * script engine. Each row has at most p+1 non-zero entries, so the band
 * is all that is stored, and elimination only ever reaches p rows down.
 * No pivoting: the matrix from averaged knots is totally positive, which
 * is precisely the property that makes pivoting unnecessary.
 *
 * \return [{x, y}, ...] control points, or null if the system is
 *         singular (which averaged knots should prevent, but a caller
 *         must never get a NaN curve).
 */
CsTrace.solveInterpolation = function(points, u, U, p) {
    var n = points.length - 1;
    var half = p;                 // widest reach either side
    var width = 2 * half + 1;
    var band = [];
    var rhsX = [], rhsY = [];
    var k, j;
    for (k = 0; k <= n; k++) {
        var row = [];
        for (j = 0; j < width; j++) {
            row.push(0);
        }
        band.push(row);
        rhsX.push(points[k].x);
        rhsY.push(points[k].y);
    }
    for (k = 0; k <= n; k++) {
        var span = CsTrace.findSpan(n, p, u[k], U);
        var N = CsTrace.basisFuns(span, u[k], p, U);
        for (j = 0; j <= p; j++) {
            var col = span - p + j;
            var slot = col - k + half;
            if (slot < 0 || slot >= width) {
                return null;      // outside the band we budgeted for
            }
            band[k][slot] = N[j];
        }
    }
    // forward elimination, band-limited
    for (k = 0; k <= n; k++) {
        var pivot = band[k][half];
        if (!(Math.abs(pivot) > 1e-12)) {
            return null;
        }
        var rEnd = Math.min(n, k + half);
        for (var r = k + 1; r <= rEnd; r++) {
            var slotOfK = k - r + half;
            var factor = band[r][slotOfK];
            if (factor === 0) {
                continue;
            }
            factor = factor / pivot;
            for (j = 0; j < width; j++) {
                var colJ = j + k - half;
                var rslot = colJ - r + half;
                if (rslot < 0 || rslot >= width) {
                    continue;
                }
                band[r][rslot] -= factor * band[k][j];
            }
            rhsX[r] -= factor * rhsX[k];
            rhsY[r] -= factor * rhsY[k];
        }
    }
    // back substitution
    var px = [], py = [];
    for (k = 0; k <= n; k++) {
        px.push(0);
        py.push(0);
    }
    for (k = n; k >= 0; k--) {
        var sx = rhsX[k], sy = rhsY[k];
        var cEnd = Math.min(n, k + half);
        for (var c = k + 1; c <= cEnd; c++) {
            var s2 = c - k + half;
            if (s2 < 0 || s2 >= width) {
                continue;
            }
            sx -= band[k][s2] * px[c];
            sy -= band[k][s2] * py[c];
        }
        var d2 = band[k][half];
        if (!(Math.abs(d2) > 1e-12)) {
            return null;
        }
        px[k] = sx / d2;
        py[k] = sy / d2;
    }
    var out = [];
    for (k = 0; k <= n; k++) {
        if (isNaN(px[k]) || isNaN(py[k])) {
            return null;
        }
        out.push({ x: px[k], y: py[k] });
    }
    return out;
};

/**
 * The control points of a cubic B-spline that PASSES THROUGH `points`.
 *
 * \return [{x, y}, ...], or null when the input cannot be interpolated
 *         (fewer than four points, a zero-length path, a singular
 *         system). A caller that gets null falls back to the
 *         approximating fit, which always works.
 */
CsTrace.interpolatingControlPoints = function(points) {
    var fit = CsTrace.interpolationFit(points);
    return fit === null ? null : fit.ctrl;
};

/**
 * The whole fit: control points, knots and parameters.
 *
 * Separate from the call above because a TEST has to be able to
 * evaluate the curve without the engine -- headless, RSpline's
 * getPointCloud returns nothing (no spline proxy plugin), so "does this
 * curve pass through its points" cannot be asked of the entity. It is
 * asked of the maths here instead, and the entity is checked separately
 * by a DXF round trip.
 */
CsTrace.interpolationFit = function(points) {
    var p = CsTrace.INTERP_DEGREE;
    if (isNull(points) || points.length < p + 1) {
        return null;
    }
    var u = CsTrace.centripetalParams(points);
    if (u === null) {
        return null;
    }
    var U = CsTrace.averagedKnots(u, p);
    var ctrl = CsTrace.solveInterpolation(points, u, U, p);
    if (ctrl === null) {
        return null;
    }
    return { ctrl: ctrl, knots: U, params: u, degree: p };
};

/** The curve at parameter uu, from a fit above. Pure maths: no engine,
 *  so a headless test can measure what a caver will see. */
CsTrace.evalCurve = function(fit, uu) {
    var p = fit.degree;
    var n = fit.ctrl.length - 1;
    var span = CsTrace.findSpan(n, p, uu, fit.knots);
    var N = CsTrace.basisFuns(span, uu, p, fit.knots);
    var x = 0, y = 0;
    for (var j = 0; j <= p; j++) {
        var c = fit.ctrl[span - p + j];
        x += N[j] * c.x;
        y += N[j] * c.y;
    }
    return { x: x, y: y };
};

/**
 * A cubic spline through `points`, or null.
 *
 * OPEN CURVES ONLY. A closed boundary needs the periodic variant, whose
 * system is cyclic rather than banded; area boundaries keep the
 * approximating periodic fit until that is built, and say so where they
 * build it.
 */
CsTrace.interpolatingSpline = function(doc, points) {
    var ctrl = CsTrace.interpolatingControlPoints(points);
    if (ctrl === null) {
        return null;
    }
    var spline = new RSpline();
    spline.setDegree(CsTrace.INTERP_DEGREE);
    spline.setPeriodic(false);
    for (var i = 0; i < ctrl.length; i++) {
        spline.appendControlPoint(new RVector(ctrl[i].x, ctrl[i].y));
    }
    return new RSplineEntity(doc, new RSplineData(spline));
};

/**
 * Control points for a CLOSED cubic B-spline through `points`.
 *
 * A closed loop cannot use the banded solve above: wrapping makes the
 * system CYCLIC -- the first row reaches the last column and the last
 * row the first -- and band elimination has nowhere to put those two
 * corners. Sherman-Morrison is the standard answer: solve the cyclic
 * system as a tridiagonal one plus a rank-one correction.
 *
 * UNIFORM parameterisation here, where the open fit uses centripetal,
 * and that is deliberate rather than lazy: a closed boundary arrives
 * RESAMPLED at a fixed step, so its chords are already equal and
 * uniform is what the data is. For a uniform closed cubic the curve at
 * each knot is (P[i-1] + 4P[i] + P[i+1]) / 6, which is the system
 * solved below.
 *
 * `points` must be the loop's DISTINCT points -- if the caller repeats
 * the first point at the end to show the loop closing, drop it first,
 * or the duplicate becomes a zero-length chord and a doubled knot.
 *
 * \return [{x, y}, ...] control points, or null.
 */
CsTrace.periodicInterpolatingControlPoints = function(points) {
    if (isNull(points) || points.length < 4) {
        return null;
    }
    var n = points.length;
    var i;
    // a closed loop of coincident points has no curve in it
    var spread = 0;
    for (i = 1; i < n; i++) {
        spread += CsTrace.distance(points[i - 1], points[i]);
    }
    if (!(spread > 0)) {
        return null;
    }

    var a = 1 / 6, b = 4 / 6, c = 1 / 6;

    // Sherman-Morrison: solve T y = q and T z = w, then correct.
    // T is the tridiagonal part with its first and last diagonal
    // entries shifted so the rank-one term carries the corners.
    var gamma = -b;
    var solveTri = function(rhs) {
        var cp = [], dp = [];
        var bb = [];
        for (i = 0; i < n; i++) {
            bb.push(b);
        }
        bb[0] = b - gamma;
        bb[n - 1] = b - a * c / gamma;
        cp.push(c / bb[0]);
        dp.push(rhs[0] / bb[0]);
        for (i = 1; i < n; i++) {
            var m = bb[i] - a * cp[i - 1];
            if (!(Math.abs(m) > 1e-12)) {
                return null;
            }
            cp.push(c / m);
            dp.push((rhs[i] - a * dp[i - 1]) / m);
        }
        var x = [];
        for (i = 0; i < n; i++) {
            x.push(0);
        }
        x[n - 1] = dp[n - 1];
        for (i = n - 2; i >= 0; i--) {
            x[i] = dp[i] - cp[i] * x[i + 1];
        }
        return x;
    };

    var u = [];
    for (i = 0; i < n; i++) {
        u.push(0);
    }
    u[0] = gamma;
    u[n - 1] = c;

    var axis = function(getter) {
        var q = [];
        for (i = 0; i < n; i++) {
            q.push(getter(points[i]));
        }
        var y = solveTri(q);
        var z = solveTri(u);
        if (y === null || z === null) {
            return null;
        }
        var fact = (y[0] + (a / gamma) * y[n - 1]) /
            (1 + z[0] + (a / gamma) * z[n - 1]);
        var out = [];
        for (i = 0; i < n; i++) {
            out.push(y[i] - fact * z[i]);
        }
        return out;
    };

    var px = axis(function(p) { return p.x; });
    var py = axis(function(p) { return p.y; });
    if (px === null || py === null) {
        return null;
    }
    var ctrl = [];
    for (i = 0; i < n; i++) {
        if (isNaN(px[i]) || isNaN(py[i])) {
            return null;
        }
        ctrl.push({ x: px[i], y: py[i] });
    }
    return ctrl;
};

/**
 * A closed cubic spline through `points`, or null.
 *
 * The caller keeps its own fallback: an approximating periodic spline
 * always builds, and a caver mid-stroke must still get a boundary.
 */
CsTrace.periodicInterpolatingSpline = function(doc, points) {
    var ctrl = CsTrace.periodicInterpolatingControlPoints(points);
    if (ctrl === null) {
        return null;
    }
    var spline = new RSpline();
    spline.setDegree(CsTrace.INTERP_DEGREE);
    spline.setPeriodic(true);
    for (var i = 0; i < ctrl.length; i++) {
        spline.appendControlPoint(new RVector(ctrl[i].x, ctrl[i].y));
    }
    try {
        spline.updateInternal();
    } catch (eUp) {
    }
    return new RSplineEntity(doc, new RSplineData(spline));
};

CsTrace.degreeFor = function(count) {
    if (count <= 2) {
        return 1;
    }
    if (count === 3) {
        return 2;
    }
    return 3;
};

/** Snap classes this build has, by name. A TABLE and not eval: the
 *  name comes from an object's own toString, and eval on that is a
 *  gadget waiting to happen. RSnapCoordinate is deliberately absent --
 *  probed, and this build does not define it. */
CsTrace.SNAPS = {
    "RSnapFree": function() { return new RSnapFree(); },
    "RSnapAuto": function() { return new RSnapAuto(); },
    "RSnapGrid": function() { return new RSnapGrid(); },
    "RSnapEnd": function() { return new RSnapEnd(); },
    "RSnapCenter": function() { return new RSnapCenter(); },
    "RSnapMiddle": function() { return new RSnapMiddle(); },
    "RSnapIntersection": function() { return new RSnapIntersection(); },
    "RSnapDistance": function() { return new RSnapDistance(); },
    "RSnapOnEntity": function() { return new RSnapOnEntity(); },
    "RSnapPerpendicular": function() { return new RSnapPerpendicular(); },
    "RSnapReference": function() { return new RSnapReference(); },
    "RSnapTangential": function() { return new RSnapTangential(); }
};

/** The class name of a snap object, or null. getSnap() stringifies as
 *  e.g. "RSnapGrid [JS]", so the leading identifier is the class. */
CsTrace.snapNameOf = function(snap) {
    if (isNull(snap)) {
        return null;
    }
    var m = /^(RSnap[A-Za-z]*)/.exec(String(snap));
    return m ? m[1] : null;
};

/**
 * Switches snapping to free and returns the NAME of the snap that was
 * on, so it can be put back.
 *
 * ANY freehand trace tool must do this. Grid snapping quantises every
 * sampled point onto the grid, so a traced wall comes out a staircase
 * -- and worse, the samples collapse onto each other, so the reduce
 * step throws most of the trace away.
 *
 * A NAME, not the snap object: RDocumentInterface::setSnap takes
 * ownership of what it is given, so the object we saved is very likely
 * freed the moment we install RSnapFree. Restoring it would be a
 * use-after-free. We construct a fresh one instead.
 *
 * Uses di.setSnap ONLY -- never RGuiAction.trigger(). Triggering a snap
 * action here makes QCAD build a new action, whose setCurrentAction
 * calls deleteTerminatedActions() and frees the very action that is
 * running this code. That is a hard SIGSEGV in
 * RDocumentInterface::deleteTerminatedActions, and it is how this
 * function was first written.
 *
 * The cost of not triggering: the snap toolbar still shows the old snap
 * while a trace is in progress. It tells the truth again the moment the
 * tool exits, and a wrong-looking button beats a crash.
 *
 * \return the snap class name to restore, or null
 */
CsTrace.suspendSnap = function(di) {
    var name = null;
    try {
        name = CsTrace.snapNameOf(di.getSnap());
    } catch (e) {
        name = null;
    }
    try {
        di.setSnap(new RSnapFree());
    } catch (e2) {
        // no snap control here; tracing still works, just snapped
    }
    return name;
};

/**
 * Puts back the snap suspendSnap recorded, constructing a fresh one.
 *
 * A null or unrecognised name restores nothing: leaving snapping free is
 * honest, where guessing a default would invent a setting the caver
 * never chose. Never triggers an action -- see suspendSnap.
 */
CsTrace.restoreSnap = function(di, name) {
    if (isNull(name)) {
        return;
    }
    var make = CsTrace.SNAPS[name];
    if (isNull(make)) {
        return;
    }
    try {
        di.setSnap(make());
    } catch (e) {
        // the document interface is going away; nothing to repair
    }
};

/** How close a trace has to start or end to an existing wall end for
 *  the two to be joined, in FEET of cave. One foot: close enough that
 *  the caver meant it, far enough that a deliberate gap survives. */
CsTrace.TIE_FEET = 1.0;

/**
 * Layers whose ends tie together. Walls only.
 *
 * A breakdown boundary is a closed outline and an entrance is a symbol
 * -- welding those to a passing wall would be wrong, and quietly. The
 * elevation's ceiling and floor ARE its walls, so they tie too.
 */
CsTrace.TIE_LAYERS = function() {
    return [CsLayers.WALLS_SURVEYED, CsLayers.WALLS_INFERRED,
        CsLayers.PROFILE_CEILING, CsLayers.PROFILE_FLOOR,
        CsLayers.PROFILE_WALLS_INFERRED];
};

/** Whether ends on `layerName` tie to each other. */
CsTrace.tiesOn = function(layerName) {
    var list = CsTrace.TIE_LAYERS();
    for (var i = 0; i < list.length; i++) {
        if (list[i] === layerName) {
            return true;
        }
    }
    return false;
};

/**
 * The nearest start-or-end point of an existing curve on `layerName`
 * within `tolerance` of `point`, as {x, y}, or null.
 *
 * Deliberately NOT QCAD's snapping. Native snap is a global mode with
 * its own UI, it would fight the free-snap this tool needs while
 * dragging, and it snaps to everything rather than to wall ends on one
 * layer. This is a plain distance test over the ends we care about --
 * the caver's own words for it were "if I start a wall within a foot of
 * the end of another, just start drawing from that point instead".
 *
 * Same layer only: a surveyed wall must not weld itself to an inferred
 * one, nor to an elevation trace that happens to sit at similar
 * coordinates. QCAD context only.
 */
CsTrace.nearestEnd = function(doc, point, layerName, tolerance) {
    var hit = CsTrace.nearestEndHit(doc, point, layerName, tolerance);
    return hit === null ? null : hit.point;
};

/**
 * The same search, answering WHICH ENTITY that end belongs to as well
 * as where it is: {point, id}, or null.
 *
 * Extending a line needs the entity, tying to one needs only the
 * point, and they must never disagree about which end is nearest --
 * two loops over the same layer, written twice, is exactly how they
 * would come to. QCAD context only.
 */
CsTrace.nearestEndHit = function(doc, point, layerName, tolerance) {
    if (!(tolerance > 0) || !doc.hasLayer(layerName)) {
        return null;
    }
    var ids = doc.queryLayerEntities(doc.getLayerId(layerName), true);
    var best = null;
    var bestDist = tolerance;
    var i, k;

    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var ends = [];
        try {
            ends.push(e.getStartPoint());
            ends.push(e.getEndPoint());
        } catch (eEnds) {
            continue;   // an entity with no ends (a point, a label)
        }
        for (k = 0; k < ends.length; k++) {
            var end = ends[k];
            if (isNull(end)) {
                continue;
            }
            var cand = { x: end.x, y: end.y };
            var d = CsTrace.distance(point, cand);
            if (d <= bestDist) {
                bestDist = d;
                best = { point: cand, id: ids[i] };
            }
        }
    }
    return best;
};

/**
 * `points` with its first and last moved onto nearby wall ends, so
 * consecutive strokes share an exact coordinate and leave no gap.
 *
 * Idempotent: a point already sitting on an end is at distance 0 from
 * it and comes back unchanged, so re-tracing a joined wall cannot make
 * it drift.
 *
 * Returns a copy; the caller's array is untouched.
 */
CsTrace.tieEnds = function(doc, points, layerName, tolerance) {
    var out = CsTrace.copyOf(points);
    if (out.length < 2 || !CsTrace.tiesOn(layerName)) {
        return out;
    }
    var head = CsTrace.nearestEnd(doc, out[0], layerName, tolerance);
    if (head !== null) {
        out[0] = head;
    }
    var tail = CsTrace.nearestEnd(doc, out[out.length - 1], layerName,
        tolerance);
    if (tail !== null) {
        out[out.length - 1] = tail;
    }
    return out;
};

/**
 * A drawing's identity, for remembering which one a line was drawn in.
 *
 * Unsaved drawings all answer "", which is correct: within one session
 * there is only one of them, and the id check the callers do does the
 * rest. Shared so the plain trace and the shaped one cannot come to
 * disagree about what "the same drawing" means.
 */
CsTrace.docKey = function(doc) {
    try {
        return String(doc.getFileName());
    } catch (e) {
        return "";
    }
};

/**
 * The control points of a traced curve, as [{x, y}, ...], or null when
 * this entity is not one.
 *
 * A trace is a control-point spline (see fitSpline), so a line, an arc
 * or a polyline drawn by some other tool answers null here and is left
 * alone: extending one would mean turning it into a different kind of
 * entity behind the caver's back.
 *
 * QCAD context only.
 */
CsTrace.controlPointsOf = function(entity) {
    if (isNull(entity)) {
        return null;
    }
    var raw = null;
    try {
        raw = entity.getControlPoints();
    } catch (e) {
        return null;
    }
    if (isNull(raw) || raw.length < 2) {
        return null;
    }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
        out.push({ x: raw[i].x, y: raw[i].y });
    }
    return out;
};

/**
 * One point list from two, joined at whichever pair of ends is closest,
 * or null when no pair is within `tolerance`.
 *
 * WHY FOUR CASES. A caver continuing a wall may set off from either end
 * of it, and may drag towards the existing line or away from it. All
 * four are the same intent -- "this is more of that wall" -- so all
 * four join, and the caver never has to think about which direction the
 * old line happens to run in.
 *
 * THE EXISTING LINE'S ENDPOINT WINS at the junction. The two ends are
 * within a foot of each other by definition, and the near-duplicate is
 * dropped from the NEW stroke: an extension must not shift the geometry
 * that was already there, or every continuation would nudge the wall it
 * continues.
 *
 * Pure. Returns a fresh array; neither input is touched.
 */
CsTrace.joinOrder = function(existing, added, tolerance) {
    if (isNull(existing) || isNull(added) ||
            existing.length < 2 || added.length < 2) {
        return null;
    }
    var eStart = existing[0], eEnd = existing[existing.length - 1];
    var aStart = added[0], aEnd = added[added.length - 1];
    var rev = function(pts) { return CsTrace.copyOf(pts).reverse(); };

    var cases = [
        // the new stroke carries on from where the old line ended
        { d: CsTrace.distance(eEnd, aStart),
          build: function() { return existing.concat(added.slice(1)); } },
        // ... drawn back towards it, so it arrives end-first
        { d: CsTrace.distance(eEnd, aEnd),
          build: function() { return existing.concat(rev(added).slice(1)); } },
        // the new stroke sets off from the old line's START
        { d: CsTrace.distance(eStart, aStart),
          build: function() {
              return rev(added).slice(0, -1).concat(existing);
          } },
        // ... and the same, drawn the other way round
        { d: CsTrace.distance(eStart, aEnd),
          build: function() { return added.slice(0, -1).concat(existing); } }
    ];

    var best = null;
    for (var i = 0; i < cases.length; i++) {
        if (!(cases[i].d <= tolerance)) {
            continue;
        }
        if (best === null || cases[i].d < best.d) {
            best = cases[i];
        }
    }
    if (best === null) {
        return null;
    }
    return CsTrace.copyOf(best.build());
};

/**
 * Grows an existing traced curve by a new stroke, IN PLACE.
 *
 * WHY IN PLACE AND NOT DELETE-AND-ADD. The entity carries things that
 * are not its geometry: the section station stamp, CsBind's tags, the
 * shaped-line link, whatever a later tool adds. Replacing it would
 * quietly drop all of that, and the loss would only show up a revision
 * later. setShape keeps the same object, the same id and the same
 * XDATA, and one modify says so.
 *
 * `points` is the raw captured drag; it is resampled and reduced here
 * exactly as emit does it, so an extension is thinned the same way the
 * stroke it continues was.
 *
 * Wrapped in CsLayers.withLayerOn for emit's reason: this build refuses
 * writes to a layer that is off, silently, and tracing with the feature
 * layer switched off to see the scan underneath is ordinary use.
 *
 * VERIFIED, NOT ASSUMED: the answer is read back off the document, so a
 * refusal reports added:false and the caller can fall back to drawing a
 * new line rather than losing the stroke.
 *
 * \return {added, extended, sampled, kept, id}
 */
CsTrace.extend = function(doc, di, id, points, spacing, tolerance, join) {
    var spaced = CsTrace.resample(points, spacing);
    var kept = CsTrace.reduce(spaced, tolerance);
    var grown = CsTrace.growCurve(doc, di, id, kept, join);
    return { added: grown.grown, extended: grown.grown,
        sampled: spaced.length, kept: kept.length,
        id: grown.grown ? id : null };
};

/**
 * The write half of an extension: joins `kept` onto the curve `id`
 * already holds and grows that entity in place.
 *
 * Split out from extend because a SHAPED line arrives here having
 * already been resampled and reduced at its own spacing, by its own
 * release handler -- putting it through extend's pipeline a second
 * time would thin an already-thinned spine. Both callers must join and
 * write the same way, so that half is here and is called twice rather
 * than written twice.
 *
 * `group` is optional: pass a transaction group and the modify joins
 * it, which is how a shaped line's regrowth and its ornament's
 * regeneration come back on ONE undo.
 *
 * \return {grown: bool, points: int} -- points is the control-point
 * count the curve ended up with, 0 when nothing was written.
 */
CsTrace.growCurve = function(doc, di, id, kept, join, group) {
    var no = { grown: false, points: 0 };
    if (isNull(doc) || isNull(di)) {
        return no;
    }
    var entity = doc.queryEntity(id);
    var existing = CsTrace.controlPointsOf(entity);
    if (existing === null) {
        return no;
    }
    var combined = CsTrace.joinOrder(existing, kept, join);
    if (combined === null) {
        return no;
    }

    var spline = new RSpline();
    spline.setDegree(CsTrace.degreeFor(combined.length));
    spline.setPeriodic(false);
    for (var i = 0; i < combined.length; i++) {
        spline.appendControlPoint(new RVector(combined[i].x, combined[i].y));
    }

    var layerName = doc.getLayerName(entity.getLayerId());
    CsLayers.withLayerOn(doc, di, layerName, function() {
        try {
            entity.setShape(spline);
            var op = new RModifyObjectsOperation();
            op.addObject(entity, false);
            if (group !== null && group !== undefined && group >= 0) {
                op.setTransactionGroup(group);
            }
            di.applyOperation(op);
        } catch (eMod) {
            // read back below; a refusal is a fallback, not a crash
        }
    });

    var after = CsTrace.controlPointsOf(doc.queryEntity(id));
    var grew = (after !== null && after.length === combined.length);
    return { grown: grew, points: grew ? after.length : 0 };
};

/**
 * The whole pipeline: resample the captured drag, reduce it, fit a
 * spline, and add it to `layerName`.
 *
 * Wrapped in CsLayers.withLayerOn because this build's
 * RAddObjectsOperation silently refuses an add to a layer that is off
 * -- no error, no exception, the entity simply never lands. Switching
 * the feature layer off to see the scanned sketch underneath is the
 * ordinary way to use this tool, so without the wrapper the tool would
 * appear to work and draw nothing.
 *
 * Deliberately does NOT tag the result for binding. The existing
 * CsBind.tagEntities sweep picks up new linework on a bindable layer
 * already; tagging here would bind it twice.
 *
 * `id` is the entity that landed, found by DIFFING the layer's contents
 * across the add rather than read off the spline object: this build
 * assigns the id inside applyOperation and the object handed in is not
 * reliably the one that ends up in the document. Callers that want to
 * tag what they just drew (the section station stamp) need it; callers
 * that do not can ignore it. null when nothing landed, and null rather
 * than a guess if more than one entity appeared -- something else wrote
 * to the layer during the add, and tagging the wrong entity is worse
 * than tagging none.
 *
 * \return {added: bool, sampled: int, kept: int, id: id|null}
 */
CsTrace.emit = function(doc, di, layerName, points, spacing, tolerance) {
    var spaced = CsTrace.resample(points, spacing);
    var kept = CsTrace.reduce(spaced, tolerance);
    // INTERPOLATING FIRST, approximating as the fallback (2026-09-12).
    // Measured on a real traced wall: the approximating fit misses the
    // sharpest corner by 3.35 inches at a one-foot step and still by
    // 0.97 at a quarter foot, while the interpolating fit is within
    // about a third of an inch at EVERY step -- because it passes
    // through the corner by construction rather than being pulled
    // inside it. Same control point count, same file size.
    //
    // The fallback is not ceremony: interpolation returns null for
    // fewer than four points, a zero-length path or a singular system,
    // and a caver mid-trace must still get their line.
    var spline = CsTrace.interpolatingSpline(doc, kept);
    if (spline === null) {
        spline = CsTrace.fitSpline(doc, kept);
    }
    if (spline === null) {
        return { added: false, sampled: spaced.length, kept: kept.length,
            id: null };
    }

    var landed = CsTrace.addCurve(doc, di, layerName, spline, null);
    return {
        added: landed.added,
        sampled: spaced.length,
        kept: kept.length,
        id: landed.id
    };
};

/**
 * Adds a built curve to a layer, and reports what actually landed.
 *
 * SPLIT OUT OF emit so a second caller can reach it. The Therion
 * sketch importer writes curves that must NOT go through emit's
 * resample-and-reduce pipeline -- that pipeline exists to thin a
 * caver's freehand drag, and a scrap's geometry has already been
 * evaluated off its own cubics at a stated tolerance (see
 * CsSketchPlace.flatten). Everything BELOW the pipeline, though, it
 * needs exactly: the layer-on wrapper and the counted add.
 *
 * Wrapped in CsLayers.withLayerOn because this build's
 * RAddObjectsOperation silently refuses an add to a layer that is off
 * -- no error, no exception, the entity simply never lands.
 *
 * COUNTED, not assumed. An earlier version of emit returned added:true
 * whenever a curve could be BUILT, so the panel cheerfully reported
 * "44 sampled, 10 kept" for a trace that never reached the drawing.
 *
 * `id` is found by DIFFING the layer's contents across the add rather
 * than read off the object handed in: this build assigns the id inside
 * applyOperation and that object is not reliably the one that ends up
 * in the document. null when nothing landed, and null rather than a
 * guess if more than one entity appeared -- something else wrote to the
 * layer during the add, and tagging the wrong entity is worse than
 * tagging none.
 *
 * \param group an optional transaction group, so a caller writing many
 *        curves can put them all on one undo.
 * \return {added: bool, id: id|null}
 */
CsTrace.addCurve = function(doc, di, layerName, entity, group) {
    if (isNull(doc) || isNull(di) || isNull(entity)) {
        return { added: false, id: null };
    }
    CsLayers.ensure(doc, di, layerName);
    var layerId = doc.getLayerId(layerName);
    entity.setLayerId(layerId);

    var before = doc.queryLayerEntities(layerId, true);

    CsLayers.withLayerOn(doc, di, layerName, function() {
        var op = new RAddObjectsOperation();
        op.addObject(entity, false);
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    });

    var after = doc.queryLayerEntities(layerId, true);
    var was = {};
    var i;
    for (i = 0; i < before.length; i++) {
        was[before[i]] = true;
    }
    var fresh = [];
    for (i = 0; i < after.length; i++) {
        if (was[after[i]] !== true) {
            fresh.push(after[i]);
        }
    }
    return {
        added: (after.length > before.length),
        id: (fresh.length === 1) ? fresh[0] : null
    };
};

/**
 * How many entities sit on each of `names` -- {layerName: count}.
 *
 * ONE PASS PER LAYER through the document's own layer index, not a walk
 * of every entity per layer: a panel asks this for thirteen features in
 * three views and a cave drawing holds thousands of entities.
 *
 * A layer that does not exist counts 0 rather than being absent, so a
 * caller can read every name it asked about without checking first --
 * and 0 is the true answer for a feature nothing has been drawn on yet,
 * which is exactly what a completeness readout is for.
 *
 * QCAD only.
 */
CsTrace.countOnLayers = function(doc, names) {
    var out = {};
    if (isNull(names)) {
        return out;
    }
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (name === null || name === undefined || name === "") {
            continue;
        }
        if (out.hasOwnProperty(name)) {
            continue;
        }
        var n = 0;
        try {
            if (!isNull(doc) && doc.hasLayer(name)) {
                n = doc.queryLayerEntities(doc.getLayerId(name),
                    false).length;
            }
        } catch (eCount) {
            n = 0;
        }
        out[name] = n;
    }
    return out;
};

// ---------------------------------------------------------------------
// WHICH TRIP DREW THIS. Traced linework and placed symbols carry the
// trip whose survey they describe, the same way a section trace already
// carries its bay and station.
//
// WHY IT IS DERIVED AND NOT PICKED. A trip is not a mode the caver is
// in -- there is no "current trip" anywhere in this suite, and adding
// one would mean a second place to be wrong, silently, for a whole
// drafting session. Where the stroke IS answers the question the same
// way it already answers plan-vs-profile-vs-section: the station
// nearest the stroke belongs to a trip, and that is the trip whose
// survey the stroke describes. Same rule for both panels.
//
// WHY THE TAG IS SPELLED "Trip". Leg and splay lines have carried a
// numeric Trip since schema v3, and every reader of it -- CsRevise,
// CsTripEdit, CsPackage -- reads that key. A second spelling for
// linework would be a second thing to keep in step.
//
// WHAT IS NOT WRITTEN: the trip's date, name or team. Those live on the
// trip's ANCHOR station point (CsDraw.survey writes them; CsTripEdit
// corrects them there), and a copy on every traced wall would be a
// hundred copies to correct when a team name is fixed -- the exact
// fork CsTripEdit exists to prevent. The id resolves to all of them.
//
// NO DEFAULT. A stroke whose trip cannot be worked out is left UNTAGGED
// rather than tagged 0. Trip 0 is a real trip -- the first one -- so a
// fallback of 0 would not read as "unknown", it would read as a claim
// that the cave's first trip drew this. That is the elevation-datum
// mistake in another costume: a plausible zero standing in for a
// missing reading.
// ---------------------------------------------------------------------

/** The tag every traced feature and placed symbol carries. The SAME key
 *  leg lines have carried since schema v3 -- see the note above. */
CsTrace.TRIP_TAG = "Trip";

/** The station-name tag each frame's station points wear. Section bays
 *  have no station points of their own; a section trace already knows
 *  its station from its bay (CsTrace.SECTION_STATION_TAG), so it is
 *  looked up by name instead of by distance. */
CsTrace.STATION_TAG_FOR = {
    plan: "Station",
    profile: "ProfileStation"
};

/**
 * Every station the drawing can name a trip for: station name -> trip id.
 *
 * Read off the LEG AND SPLAY LINES, which carry both the station names
 * and the trip, rather than off station points, which carry a Trip tag
 * only on the eight-or-so trip ANCHORS. Anchors would answer for one
 * station per trip and null for every other station in the cave.
 *
 * FIRST SHOT WINS, in (trip, ShotSeq) order -- the same rule CsDraw's
 * own `stationTrip` uses when it decides which trip a station belongs
 * to, so a station's trip is the same fact here as it is there. A
 * junction station reached again on a later trip stays with the trip
 * that first reached it.
 *
 * QCAD only.
 *
 * \return {} station name -> trip id (a number), possibly empty
 */
CsTrace.tripByStation = function(doc) {
    var out = {};
    if (isNull(doc)) {
        return out;
    }
    var rows = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsTrace.TRIP_TAG) === "") {
            continue;
        }
        var from = CsTags.get(e, "From");
        var to = CsTags.get(e, "To");
        var splay = CsTags.get(e, "Splay");
        if (from === "" && to === "" && splay === "") {
            continue;   // a trip ANCHOR point, not a shot line
        }
        var trip = CsTags.getNumber(e, CsTrace.TRIP_TAG);
        if (trip === null || trip < 0) {
            continue;   // an unreadable Trip tag is not a trip number
        }
        var seq = CsTags.getNumber(e, "ShotSeq");
        rows.push({
            trip: trip,
            seq: (seq === null ? 0 : seq),
            from: from,
            // a splay reaches no new station: its far end is a wall
            // point, not a survey station, and CsDraw's stationTrip
            // skips it for the same reason
            to: (splay === "" ? to : "")
        });
    }
    // A TOTAL order. CaveCAD's Array.prototype.sort is unstable where
    // node's is stable (tests/README.md), so a comparator that can
    // return 0 for two distinct shots would hand out different trips in
    // each engine. `from`/`to` break the last tie.
    rows.sort(function(a, b) {
        if (a.trip !== b.trip) {
            return a.trip - b.trip;
        }
        if (a.seq !== b.seq) {
            return a.seq - b.seq;
        }
        if (a.from !== b.from) {
            return a.from < b.from ? -1 : 1;
        }
        return a.to === b.to ? 0 : (a.to < b.to ? -1 : 1);
    });
    for (var r = 0; r < rows.length; r++) {
        if (rows[r].from !== "" && out[rows[r].from] === undefined) {
            out[rows[r].from] = rows[r].trip;
        }
        if (rows[r].to !== "" && out[rows[r].to] === undefined) {
            out[rows[r].to] = rows[r].trip;
        }
    }
    return out;
};

/**
 * The station nearest any of `points`, among the station points of one
 * frame -- {name, distance}, or null when that frame has none.
 *
 * NEAREST TO THE WHOLE STROKE, not to its midpoint: a wall traced along
 * a passage runs PAST several stations, and its midpoint can easily sit
 * further from all of them than either end does.
 *
 * NO DISTANCE CAP, deliberately. There is no honest number for "too far
 * to mean anything" -- a big room's wall is legitimately a long way
 * from the station that surveyed it, and a cap set by feel would drop
 * exactly those. The caller decides what to do with a distant answer;
 * today both callers stamp it, because a nearest-station answer is the
 * same fallback CsProfileBind already binds linework by.
 *
 * QCAD only.
 */
CsTrace.nearestStation = function(doc, points, frame) {
    var key = CsTrace.STATION_TAG_FOR[frame];
    if (isNull(doc) || isNull(points) || points.length === 0 ||
            key === undefined) {
        return null;
    }
    var best = null;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, key);
        if (name === "") {
            continue;
        }
        var pos = e.getPosition();
        var at = { x: pos.x, y: pos.y };
        for (var p = 0; p < points.length; p++) {
            var d = CsTrace.distance(points[p], at);
            if (best === null || d < best.distance) {
                best = { name: name, distance: d };
            }
        }
    }
    return best;
};

/**
 * The trip a stroke or symbol belongs to -- a number, or null when the
 * drawing cannot say.
 *
 * `station` short-circuits the search and is how a SECTION trace
 * answers: its bay already names the station it is a section of, and a
 * bay sits wherever it was dropped on the sheet, so distance to plan
 * stations would name whatever the bay happens to be parked next to.
 *
 * Null, never 0, when there is no answer -- see the header note.
 *
 * QCAD only.
 */
CsTrace.tripForPoints = function(doc, points, frame, station) {
    if (isNull(doc)) {
        return null;
    }
    var byStation = CsTrace.tripByStation(doc);
    var name = (isNull(station) || station === "") ? null : station;
    if (name === null) {
        var near = CsTrace.nearestStation(doc, points, frame);
        if (near === null) {
            return null;
        }
        name = near.name;
    }
    var trip = byStation[name];
    return (trip === undefined) ? null : trip;
};

/**
 * The trip a stroke belongs to, resolving a section bay's station on
 * the way -- the ONE call both panels make, so plan, elevation and
 * section are answered the same way in each.
 *
 * A section trace answers by its BAY's station and never by distance: a
 * bay sits wherever it was dropped on the sheet, so plan-station
 * distance would name whatever the bay happens to be parked beside.
 * A bay with no station tag names no trip.
 *
 * Null, never 0, when there is no answer -- see the header note.
 *
 * QCAD only.
 */
CsTrace.tripFor = function(doc, frame, points, bays) {
    if (isNull(doc) || isNull(points) || points.length === 0) {
        return null;
    }
    var station = null;
    if (frame === "section") {
        var bay = CsTrace.bayForPath(bays, points);
        if (bay === null || isNull(bay.station) || bay.station === "") {
            return null;
        }
        station = bay.station;
    }
    return CsTrace.tripForPoints(doc, points, frame, station);
};

/**
 * Writes the trip tag onto an entity already in the document.
 *
 * Silent about everything, the way stampSection is: a stamp is
 * provenance, and failing to add provenance must never cost the caver
 * the line they just drew.
 *
 * NOT called for an EXTENSION. A stroke that grows an existing line
 * keeps the trip that line already had -- the entity is the wall it
 * always was, and rewriting its trip because a later trip's drafting
 * added six more feet would quietly re-attribute the whole thing.
 *
 * QCAD only.
 *
 * \return true when the tag was written
 */
CsTrace.stampTrip = function(doc, di, id, trip) {
    if (isNull(doc) || isNull(di) || isNull(id) || trip === null ||
            trip === undefined) {
        return false;
    }
    try {
        var e = doc.queryEntity(id);
        if (isNull(e)) {
            return false;
        }
        CsTags.set(e, CsTrace.TRIP_TAG, trip);
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
        return true;
    } catch (eStamp) {
        return false;
    }
};
