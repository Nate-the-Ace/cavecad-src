// CsSectionCut.js -- cutting a rough cross section anywhere along the
// surveyed alignment.
//
// Part of the Cave Survey Core library. PURE: plain {x, y, z} objects,
// no RVector, no document. Everything QCAD-shaped lives in
// CsSectionDraw.js.
//
// WHY THIS IS POSSIBLE AT ALL. CsTraverse.offset already returns
// {dx, dy, dz} -- every splay is a 3D wall hit and always was.
// CsLrud.stationWallPoints DISCARDS dz because the plan view has no use
// for it. That single discard is the only reason the suite looked like
// it had no 3D model to cut.
//
// WHAT MAKES THE MATHS SMALL. A survey leg is STRAIGHT, so the tangent
// is constant along it: one plane normal serves every cut on a leg, and
// there is no twist to integrate. Two consequences worth stating --
//   * no junction ambiguity for a cut: a leg has exactly two ends, so
//     the stations bounding the cut are simply those two;
//   * the frame problem reduces to choosing theta = 0.
//
// AND WHY THAT LAST PART IS STILL NOT TRIVIAL. theta = 0 wants to be
// world up projected into the section plane, which DEGENERATES on a
// pitch: near vertical, up lies along the leg, the projection goes to
// zero, and theta = 0 becomes noise -- sections spin from leg to leg in
// exactly the passages where a reader needs them steady. So the
// reference is carried between legs by a rotation-minimizing frame
// (double reflection, Wang et al. 2008), which is stable where a Frenet
// frame flips at an inflection.

var CsSectionCut = {};

/** Below this, a vector is zero for our purposes. */
CsSectionCut.EPS = 1e-12;
/** |up projected into the plane| below this and the seed is refused:
 *  the leg is a pitch and theta = 0 would be noise. */
CsSectionCut.SEED_MIN = 0.2;
/** Carried frames drift. Past this many degrees from the up-projected
 *  reference -- and only where that reference is well conditioned --
 *  the frame is RE-SEEDED, so a long cave does not accumulate an
 *  arbitrary roll. A re-seed is a visible discontinuity in the drawing,
 *  so callers report it rather than swallowing it. */
CsSectionCut.RESEED_DEG = 15;

CsSectionCut.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsSectionCut.cross = function(a, b) {
    return { x: a.y * b.z - a.z * b.y,
             y: a.z * b.x - a.x * b.z,
             z: a.x * b.y - a.y * b.x };
};

CsSectionCut.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsSectionCut.scale = function(a, k) {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
};

CsSectionCut.add = function(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
};

CsSectionCut.length = function(a) {
    return Math.sqrt(CsSectionCut.dot(a, a));
};

/** \return the unit vector, or null when there is no direction. */
CsSectionCut.normalize = function(a) {
    var m = CsSectionCut.length(a);
    if (m < CsSectionCut.EPS) {
        return null;
    }
    return { x: a.x / m, y: a.y / m, z: a.z / m };
};

/**
 * A frame from world up alone: r = up with the along-leg part removed.
 * \return {d, r, s} orthonormal, or null when the leg is too steep for
 *         up to say anything (a pitch).
 */
CsSectionCut.seedFrame = function(d) {
    var dn = CsSectionCut.normalize(d);
    if (dn === null) {
        return null;
    }
    var up = { x: 0, y: 0, z: 1 };
    var proj = CsSectionCut.sub(up,
        CsSectionCut.scale(dn, CsSectionCut.dot(up, dn)));
    if (CsSectionCut.length(proj) < CsSectionCut.SEED_MIN) {
        return null;
    }
    var r = CsSectionCut.normalize(proj);
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The double-reflection step (Wang et al. 2008): carry `prev`'s
 * reference onto the next leg with the least possible rotation.
 *
 * \param prev {d, r, s} on the previous leg
 * \param x0, x1 the previous leg's start and the new leg's start
 * \param d1 the new leg's direction
 * \return {d, r, s} orthonormal on the new leg
 */
CsSectionCut.carryFrame = function(prev, x0, x1, d1) {
    var dn = CsSectionCut.normalize(d1);
    if (dn === null || prev === null || prev === undefined) {
        return CsSectionCut.seedFrame(d1);
    }
    var v1 = CsSectionCut.sub(x1, x0);
    var c1 = CsSectionCut.dot(v1, v1);
    var rL = prev.r, dL = prev.d;
    if (c1 > CsSectionCut.EPS) {
        rL = CsSectionCut.sub(prev.r,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.r) / c1));
        dL = CsSectionCut.sub(prev.d,
            CsSectionCut.scale(v1, 2 * CsSectionCut.dot(v1, prev.d) / c1));
    }
    var v2 = CsSectionCut.sub(dn, dL);
    var c2 = CsSectionCut.dot(v2, v2);
    var r1 = rL;
    if (c2 > CsSectionCut.EPS) {
        r1 = CsSectionCut.sub(rL,
            CsSectionCut.scale(v2, 2 * CsSectionCut.dot(v2, rL) / c2));
    }
    // Re-orthonormalise against the new tangent: the reflections are
    // exact in theory and drift in floating point over a long cave.
    var perp = CsSectionCut.sub(r1,
        CsSectionCut.scale(dn, CsSectionCut.dot(r1, dn)));
    var r = CsSectionCut.normalize(perp);
    if (r === null) {
        var fallback = CsSectionCut.seedFrame(d1);
        if (fallback !== null) {
            return fallback;
        }
        return { d: dn, r: { x: 1, y: 0, z: 0 }, s: { x: 0, y: 1, z: 0 } };
    }
    return { d: dn, r: r, s: CsSectionCut.cross(dn, r) };
};

/**
 * The frame for a leg, given the previous one: carried, then re-seeded
 * if it has drifted and the seed is trustworthy again.
 *
 * \return {frame, reseeded} -- `reseeded` is true when theta = 0 jumped,
 *         which the caller REPORTS rather than hides.
 */
CsSectionCut.frameFor = function(prev, x0, x1, d1) {
    if (prev === null || prev === undefined) {
        var seeded = CsSectionCut.seedFrame(d1);
        if (seeded !== null) {
            return { frame: seeded, reseeded: false };
        }
        // A run that OPENS on a pitch has nothing to carry and nothing
        // to seed from. Any perpendicular is as good as any other; what
        // matters is that it is recorded as arbitrary.
        var dn = CsSectionCut.normalize(d1);
        if (dn === null) {
            return { frame: null, reseeded: false };
        }
        var any = Math.abs(dn.x) < 0.9 ? { x: 1, y: 0, z: 0 } :
            { x: 0, y: 1, z: 0 };
        var perp = CsSectionCut.normalize(CsSectionCut.sub(any,
            CsSectionCut.scale(dn, CsSectionCut.dot(any, dn))));
        return { frame: { d: dn, r: perp, s: CsSectionCut.cross(dn, perp) },
                 reseeded: true };
    }
    var carried = CsSectionCut.carryFrame(prev, x0, x1, d1);
    var seed = CsSectionCut.seedFrame(d1);
    if (seed === null || carried === null) {
        return { frame: carried, reseeded: false };
    }
    var cosA = Math.max(-1, Math.min(1,
        CsSectionCut.dot(carried.r, seed.r)));
    var driftDeg = Math.acos(cosA) * 180 / Math.PI;
    if (driftDeg > CsSectionCut.RESEED_DEG) {
        return { frame: seed, reseeded: true };
    }
    return { frame: carried, reseeded: false };
};

// ---------------------------------------------------------------------
// THE CUT
// ---------------------------------------------------------------------

/** How many angles a section is sampled at. 32 is fine for a printed
 *  section, and it makes a four-point LRUD diamond a 32-vertex
 *  near-diamond -- more vertices than there is evidence for, which is
 *  why the count is settable and why the report states how many
 *  MEASURED points each end actually contributed. */
CsSectionCut.ANGLES = 32;

/** Under three wall points cannot make a boundary. */
CsSectionCut.MIN_POINTS = 3;

/**
 * How near an end of a leg a cut counts as being AT that station.
 *
 * A FRACTION OF THE LEG, not a distance, so it means the same thing on
 * a hundred-foot shot as on a five-foot one -- the same reason
 * PICK_TOLERANCE is relative.
 *
 * WHY THERE IS A TOLERANCE AT ALL. A cut at a station comes from
 * nearestLeg's perpendicular foot computed on that station's own
 * coordinates, which lands on exactly 0 or exactly 1; the tolerance is
 * there so a t that has been through a round trip -- a tag, a
 * serialized pick, an adjustment -- is still the station's own section
 * rather than a loft with a weight of 1e-15 on the far end.
 *
 * WHY IT IS THIS SMALL. Inside it the far end's contribution is under
 * a millionth of the leg, which on any survey leg is far finer than
 * the line the section is drawn with -- so calling the cut "at" the
 * station changes nothing anyone can see. Anything looser would start
 * throwing away a real fraction of a real loft.
 */
CsSectionCut.AT_STATION_T = 1e-6;

/**
 * Why a station cannot be cut, in words a caver can act on.
 *
 * NAMES THE STATION THE CUT IS AT. For a cut at a station -- which is
 * every cut the sketching workflow makes, because the caver picks a
 * station -- that is the station they themselves chose. The refusal
 * used to be able to name the OTHER end of whichever leg the pick
 * happened to snap to: ask for a section at A2, be told about A1,
 * which is an implementation detail of the pick and not something
 * anybody can go and fix.
 *
 * AND SAYS WHERE LRUD COMES FROM when there is none at all, because
 * that refusal is otherwise unactionable. LRUD is recorded with the
 * shot INTO a station, so the first station of a survey chain never
 * has any of its own -- correct data, not a gap to go and fill.
 *
 * Pure.
 */
CsSectionCut.thinReason = function(station, measured) {
    if (!(measured > 0)) {
        return "station " + station + " has no measured wall points of " +
            "its own, so there is no outline to cut -- LRUD is recorded " +
            "with the shot INTO a station, so the first station of a " +
            "survey chain has none";
    }
    return "station " + station + " has only " + measured +
        " measured wall point" + (measured === 1 ? "" : "s") + ", and " +
        CsSectionCut.MIN_POINTS + " are needed to make an outline";
};

/**
 * The frame for one leg, with theta = 0 carried from the legs before
 * it in resolution order.
 *
 * Walking from the start matters on a PITCH: a leg whose own seed is
 * refused takes its reference from its predecessor, and a cut taken on
 * it must use the same theta = 0 the neighbouring sections used or it
 * reads as rotated for no reason.
 *
 * \return {frame, reseeded} or {frame: null} when the leg is not in the
 *         resolved survey.
 */
CsSectionCut.frameForLeg = function(resolved, from, to) {
    var prev = null, prevStart = null;
    var out = { frame: null, reseeded: false };
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (a === undefined || b === undefined) {
            continue;
        }
        var d = CsSectionCut.sub(b, a);
        var step = CsSectionCut.frameFor(prev,
            prevStart === null ? a : prevStart, a, d);
        if (step.frame === null) {
            continue;                 // a zero-length leg carries nothing
        }
        if (leg.from === from && leg.to === to) {
            return step;
        }
        prev = step.frame;
        prevStart = a;
    }
    return out;
};

// P (open passage) AND THE OUTLINE'S CLOSURE -- SETTLED, closed is
// correct. Nathan, 2026-08-31: "It's fine if our ghost lines close
// when the real wall may have a Passage, once inserted properly, the
// cross section sketch will show the real passage."
//
// That is the whole argument. This outline is a GHOST -- a ruler the
// caver scales a scanned field-book page against, and a check on their
// tracing. It is deleted at Capture and never reaches the drawing. The
// passage a reader ends up looking at is the one the caver TRACED, and
// a surveyor who wrote "P" drew what was actually there on the page.
// So a closed ghost costs nothing: it never claims to be the passage,
// and the thing that does claim to be the passage is hand-drawn from
// the field book.
//
// An earlier draft of this comment recorded the open gap as a
// follow-on design task. It is not owed. Do not build it without
// Nathan asking again -- the reasoning below is why it would be
// expensive AND why it would be inventing data, and both still hold.
// Kept because it is the argument for leaving this alone.
//
// The mechanics, for whoever reads this next: `P`
// parses to value:null (see CsModel.parseLrudEntry), so today a "P"
// side simply contributes no point, same as a blank cell always has,
// and boundaryHits below still closes the polygon across whatever gap
// that leaves -- IDENTICAL to today's behaviour for a station nobody
// ever measured that side of. No new wall is invented; nothing
// regresses. But it is also not the open gap Nathan asked for, and
// getting there is a real redesign, not a bug fix:
//   * theta for an open side IS knowable without a length -- L/R/up/
//     down are directions, not just distances, so the gap's CENTER
//     angle can be computed the same way tickEnd's perpendicular is.
//   * the gap's WIDTH is not knowable. LRUD records "no wall in this
//     exact direction", never "the wall is absent across this whole
//     angular span" -- inventing a width (a fixed angle either side of
//     center? out to the neighbouring measured points?) asserts survey
//     data that was never taken, exactly the kind of fabrication this
//     whole fix exists to stop doing.
//   * even with a width chosen, `boundaryHits`/`radiusAt` assume a
//     closed ring (every ray crosses an even number of times) and
//     `CsSectionDraw.define` draws one closed RPolyline; an open arc
//     needs a different return contract from `cut()` and a different
//     draw path, which then has to be re-threaded through
//     `leaderStop`/`centroidOf` (both assume a full loop) and through
//     `CsSectionDraw.localBox`.
// So: closed, deliberately, and not for want of trying. The zero-vs-P
// distinction above is the part that mattered -- it is what rescues the
// refusals a real 0 used to cause, and it stands on its own.

/**
 * One station's measured wall points, projected into the section plane.
 *
 * Projecting ALONG the leg is what makes an obliquely shot splay
 * contribute its PERPENDICULAR distance -- which is what a section
 * wants -- at the cost of discarding where along the passage it was
 * shot. That trade is the section's to make, and the caption says so.
 *
 * \return {points: [{theta, radius}] in angle order, measured: n}, or
 *         null when the station is not in the resolved survey.
 */
CsSectionCut.polygonAt = function(survey, resolved, stationName, frame,
        opts) {
    var st = resolved.stations[stationName];
    if (st === undefined || st === null || frame === null) {
        return null;
    }
    var o = opts || {};
    var lrud = CsModel.lrudForStation(survey, stationName);
    var byStation = o.splaysByStation || CsLrud.splaysByStation(survey);
    var splays = byStation[stationName] || [];
    var tapeMode = o.tapeMode || CsTraverse.SLOPE;
    // WHICH WAY THE PASSAGE RUNS HERE, which is only used to decide
    // which side of it a splay hit and which splays are dead along the
    // axis -- never to place a point. The plan asks exactly the same
    // question the same way (CsLrud.passageAzimuthAt over the station's
    // clustered ways out, falling back to the bearing the LRUD was
    // recorded on), so a section and the plan walls cannot disagree
    // about it. At a loop tie-in, where the recorded bearing cuts
    // across the passage rather than running down it, they used to.
    // null, NOT 0, when the arriving leg sighted no bearing -- which
    // on a pitch it did not (CsModel.lrudForStation withholds a
    // near-vertical compass sight rather than passing it on). A 0 here
    // was a section oriented due north because nobody had said
    // otherwise, and the caver could not tell that from a section that
    // really does face north. passageAzimuthAt understands null and
    // answers from the station's own ways out; only if THAT is unknown
    // too is there nothing to orient against, and 0 is then a last
    // resort rather than a first guess.
    var arrivalAz = (lrud !== null && lrud !== undefined &&
        lrud.azimuth !== undefined && lrud.azimuth !== null &&
        isFinite(lrud.azimuth)) ? lrud.azimuth : null;
    var axes = o.stationAxes || CsLrud.stationAxes(resolved);
    var passageAz = CsLrud.passageAzimuthAt(axes, stationName, arrivalAz);
    if (passageAz === null || passageAz === undefined ||
            !isFinite(passageAz)) {
        passageAz = (arrivalAz === null) ? 0 : arrivalAz;
    }

    var raw = [], i;
    var sides = ["L", "R"];
    for (i = 0; i < sides.length; i++) {
        var pts = CsLrud.stationWallPoints3D(st, passageAz, lrud, splays,
            sides[i], tapeMode, null);
        for (var j = 0; j < pts.length; j++) {
            raw.push(pts[j]);
        }
    }
    var ud = CsLrud.stationCeilingFloor3D(st, lrud);
    if (ud.ceiling !== null) { raw.push(ud.ceiling); }
    if (ud.floor !== null) { raw.push(ud.floor); }

    var points = [];
    for (i = 0; i < raw.length; i++) {
        var rel = CsSectionCut.sub(raw[i], st);
        var perp = CsSectionCut.sub(rel,
            CsSectionCut.scale(frame.d, CsSectionCut.dot(rel, frame.d)));
        var radius = CsSectionCut.length(perp);
        if (radius < CsSectionCut.EPS && !raw[i].atStation) {
            // A raw point that projects to (near) zero in THIS plane
            // usually means no wall evidence -- a splay that happened
            // to land dead-center contributes nothing. But `atStation`
            // marks a DIFFERENT case: an LRUD side that read exactly 0
            // (CsLrud.tickEnd/stationCeilingFloor3D), where the raw
            // point IS the station itself and so is EXACTLY zero in
            // every frame, not almost. That is real evidence -- "the
            // wall is right here" -- and dropping it is the defect
            // this function used to have: a station with, say, L 0
            // lost its left wall point outright, sometimes taking the
            // whole cut below CsSectionCut.MIN_POINTS with it. theta
            // for a zero-radius vertex is atan2(0,0) = 0, deterministic
            // in this engine, so it sorts and re-visits like any other
            // point at theta 0.
            continue;
        }
        points.push({
            theta: Math.atan2(CsSectionCut.dot(perp, frame.s),
                              CsSectionCut.dot(perp, frame.r)),
            radius: radius
        });
    }
    // CaveCAD's Array.prototype.sort is UNSTABLE, so never return 0 for
    // two distinct entries -- tie-break on radius.
    points.sort(function(a, b) {
        if (a.theta !== b.theta) { return a.theta - b.theta; }
        return a.radius - b.radius;
    });
    return { points: points, measured: points.length };
};

/**
 * Every crossing of the polygon boundary along `theta`, nearest first.
 * More than one means a RE-ENTRANT, which the caller reports rather
 * than hides.
 */
CsSectionCut.boundaryHits = function(polygon, theta) {
    var out = [];
    if (polygon === null || polygon.points.length < CsSectionCut.MIN_POINTS) {
        return out;
    }
    var pts = polygon.points;
    var dx = Math.cos(theta), dy = Math.sin(theta);
    for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var ax = a.radius * Math.cos(a.theta);
        var ay = a.radius * Math.sin(a.theta);
        var bx = b.radius * Math.cos(b.theta);
        var by = b.radius * Math.sin(b.theta);
        var ex = bx - ax, ey = by - ay;
        var den = dx * ey - dy * ex;
        if (Math.abs(den) < CsSectionCut.EPS) {
            continue;                              // parallel
        }
        var s = (ax * ey - ay * ex) / den;         // along the ray
        var u = (ax * dy - ay * dx) / den;         // along the segment
        if (s > 0 && u >= 0 && u <= 1) {
            out.push(s);
        }
    }
    out.sort(function(p, q) { return p - q; });

    // COLLAPSE DUPLICATE CROSSINGS. A ray through a VERTEX meets both
    // segments that share it -- u = 1 on one and u = 0 on the next --
    // and that is one crossing, not two. It matters because the sampled
    // angles land exactly on the vertex angles of the commonest section
    // there is: a four-point LRUD diamond has vertices at 0, +/-pi/2
    // and pi, and the default 32 angles include every one. Counted
    // naively, every LRUD-only section reported itself re-entrant.
    var merged = [];
    for (var k = 0; k < out.length; k++) {
        if (merged.length === 0 ||
                Math.abs(out[k] - merged[merged.length - 1]) > 1e-9) {
            merged.push(out[k]);
        }
    }
    return merged;
};

/**
 * The distance from the centre to the polygon BOUNDARY along `theta`.
 *
 * Sampling the BOUNDARY and not the vertices is load-bearing: a
 * four-point LRUD diamond sampled at its vertices reads as a four-spoke
 * star, which is not what anybody measured.
 *
 * \return the radius, or null when the ray crosses nothing.
 */
CsSectionCut.radiusAt = function(polygon, theta) {
    var hits = CsSectionCut.boundaryHits(polygon, theta);
    return hits.length === 0 ? null : hits[0];
};

/**
 * A rough cross section anywhere along one leg.
 *
 * A CUT AT AN END OF THE LEG IS NOT A LOFT. At t = 0 the far station's
 * outline is weighted zero: it contributes nothing to a single radius,
 * and every cut this suite's sketching workflow makes is one of these,
 * because the caver picks a STATION. Requiring wall points at the far
 * end there refused sections that the chosen station had every
 * measurement for -- and refused them in the neighbour's name. So both
 * ends are required only where the cut really is between them.
 *
 * \param t 0 at `from`, 1 at `to`
 * \return {outline: [{theta, radius}], polygon, measuredFrom, measuredTo,
 *          nearest, reentrant, reseeded}
 *         or {refused: true, reason: "..."} -- refused is never drawn
 *         from two points and a hope.
 */
CsSectionCut.cut = function(survey, resolved, from, to, t, opts) {
    var o = opts || {};
    var a = resolved.stations[from], b = resolved.stations[to];
    if (a === undefined || b === undefined) {
        return { refused: true,
                 reason: "the leg " + from + "->" + to +
                     " is not in the drawing's survey" };
    }
    var step = CsSectionCut.frameForLeg(resolved, from, to);
    if (step.frame === null) {
        return { refused: true,
                 reason: "no section plane could be worked out for " +
                     from + "->" + to };
    }
    var frame = step.frame;
    var byStation = o.splaysByStation || CsLrud.splaysByStation(survey);
    var inner = { splaysByStation: byStation, tapeMode: o.tapeMode };

    // Which ends the cut is actually made of. `!(t > x)` rather than
    // `t <= x` so a NaN t -- which is not at either end and not
    // anywhere else either -- falls through to the strict two-ended
    // case it always took, instead of being read as "at the start".
    var atFrom = !(t > CsSectionCut.AT_STATION_T);
    var atTo = (t >= 1 - CsSectionCut.AT_STATION_T);
    var useFrom = !atTo;
    var useTo = !atFrom;

    var pa = useFrom ?
        CsSectionCut.polygonAt(survey, resolved, from, frame, inner) : null;
    var pb = useTo ?
        CsSectionCut.polygonAt(survey, resolved, to, frame, inner) : null;
    var thin = null, thinPoly = null;
    if (useFrom && (pa === null || pa.measured < CsSectionCut.MIN_POINTS)) {
        thin = from;
        thinPoly = pa;
    } else if (useTo && (pb === null || pb.measured < CsSectionCut.MIN_POINTS)) {
        thin = to;
        thinPoly = pb;
    }
    if (thin !== null) {
        return { refused: true,
                 reason: CsSectionCut.thinReason(thin,
                     (thinPoly === null) ? 0 : thinPoly.measured) };
    }

    var angles = (o.angles === undefined || o.angles === null) ?
        CsSectionCut.ANGLES : o.angles;
    var outline = [], reentrant = false;
    for (var i = 0; i < angles; i++) {
        var theta = -Math.PI + (2 * Math.PI * i) / angles;
        var ha = (pa === null) ? null : CsSectionCut.boundaryHits(pa, theta);
        var hb = (pb === null) ? null : CsSectionCut.boundaryHits(pb, theta);
        if ((ha !== null && ha.length > 1) ||
                (hb !== null && hb.length > 1)) {
            // A ray crossing twice means an undercut. Radial sampling
            // takes the NEAR crossing and so cuts the corner off it --
            // simplified, and said, never silently.
            reentrant = true;
        }
        if ((ha !== null && ha.length === 0) ||
                (hb !== null && hb.length === 0)) {
            continue;
        }
        var radius;
        if (ha === null) {
            radius = hb[0];
        } else if (hb === null) {
            radius = ha[0];
        } else {
            radius = (1 - t) * ha[0] + t * hb[0];
        }
        outline.push({ theta: theta, radius: radius });
    }

    var legLen = CsSectionCut.length(CsSectionCut.sub(b, a));
    return {
        outline: outline,
        polygon: { points: outline, measured: outline.length },
        // 0 for an end the cut is not made of, so a caption cannot
        // credit a station that contributed nothing to the outline.
        measuredFrom: (pa === null) ? 0 : pa.measured,
        measuredTo: (pb === null) ? 0 : pb.measured,
        // How far the cut is from the nearer station that fed it. A cut
        // beside a station is nearly a measurement; one midway between
        // stations thirty feet apart is a guess, and the reader is told
        // which they are looking at.
        nearest: Math.min(t, 1 - t) * legLen,
        reentrant: reentrant,
        reseeded: step.reseeded
    };
};

/** How far from a leg a pick may land and still mean that leg, as a
 *  MULTIPLE of the leg's own length. Relative, so it means the same
 *  thing in a passage of ten-foot shots and one of hundred-foot shots. */
CsSectionCut.PICK_TOLERANCE = 0.75;

/**
 * The leg a pick means, and how far along it: the perpendicular foot,
 * clamped to the leg's ends.
 *
 * PLAN DISTANCE ONLY. The pick comes from a click in the plan view,
 * where the reader has no z to give -- comparing in 3D would make a
 * deep leg under a shallow one win or lose by its depth, which is not
 * what the click meant.
 *
 * \return {from, to, t, distance} or null when nothing is near enough
 */
CsSectionCut.nearestLeg = function(resolved, point, tolerance) {
    var best = null;
    var tol = (tolerance === undefined || tolerance === null) ?
        CsSectionCut.PICK_TOLERANCE : tolerance;
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (a === undefined || b === undefined) {
            continue;
        }
        var ex = b.x - a.x, ey = b.y - a.y;
        var len2 = ex * ex + ey * ey;
        if (len2 < CsSectionCut.EPS) {
            continue;                        // a leg with no length
        }
        var t = ((point.x - a.x) * ex + (point.y - a.y) * ey) / len2;
        if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
        var fx = a.x + ex * t, fy = a.y + ey * t;
        var dx = point.x - fx, dy = point.y - fy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > Math.sqrt(len2) * tol) {
            continue;                        // too far to mean this leg
        }
        if (best === null || dist < best.distance) {
            best = { from: leg.from, to: leg.to, t: t, distance: dist };
        }
    }
    return best;
};
