// CsMesh3d.js -- the surveyed passage as a three-dimensional surface.
//
// Part of the Cave Survey Core library: pure functions, no document, no
// GUI, so the headless harness tests all of it. The GL window that
// draws the result never sees a Survey -- it takes vertex and index
// buffers and knows nothing about caves. This file is the entire
// translation between the two, and that is deliberate: teaching the
// renderer about survey data would mean a second implementation of tag
// parsing, in a second language, kept in step by hand.
//
// THE SHAPE OF THE SURFACE. At each station, the wall points actually
// measured there -- the four LRUD ticks AND the tip of every splay shot
// from it -- are projected into the plane perpendicular to the passage
// and sorted by angle. That ordered ring is the station's cross
// section. Consecutive rings are lofted with triangle strips.
//
// A SPLAY IS A WALL POINT. This is CsLrud's argument in plan, and it is
// no less true in three dimensions: "a splay tip is a measured wall hit
// -- the same kind of fact an LRUD number is, just aimed where the
// caver pointed". A design that swept only the LRUD rectangle would
// render LESS than was measured; a splay up into a dome would dent the
// tube instead of showing the void.
//
// AND NOTHING BETWEEN THE MEASURED POINTS. The ring is what was
// measured, in order; the loft is straight strips between rings. No
// smoothing, no inferred curvature, for the reason CsLrud gives: wall
// detail between stations that isn't in the data misrepresents the
// passage.
//
// JUNCTIONS END A RUN. Three or more non-splay shots meeting is a place
// one ring cannot describe, so the loft stops rather than guessing a
// surface across it. Same rule as CsLrud.wallRuns, reached through the
// same CsLrud.legCounts rather than re-derived.
//
// Z IS NEVER DEFAULTED. A station without a resolved elevation is an
// error that refuses to build. This suite has closed five separate
// doors on a z quietly defaulting to 0 and rebasing an absolute-datum
// cave to sea level; this is the sixth, held shut on purpose.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsTraverse.js");
include(includeBasePath + "/CsLrud.js");
include(includeBasePath + "/CsClosure.js");
include(includeBasePath + "/CsFrontier.js");

var CsMesh3d = {};

// ---------------------------------------------------------------------
// Vectors. Plain objects, because that is what the rest of the Core
// library passes around and RVector does not exist under node.
// ---------------------------------------------------------------------

CsMesh3d.sub = function(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
};

CsMesh3d.cross = function(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
};

CsMesh3d.dot = function(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
};

CsMesh3d.norm = function(a) {
    return Math.sqrt(CsMesh3d.dot(a, a));
};

/**
 * Unit vector, or null when there is no direction to normalize.
 *
 * Null rather than a zero vector: a caller that wants a direction and
 * is handed {0,0,0} carries on and produces NaN three operations
 * later, where the cause is no longer visible.
 */
CsMesh3d.normalize = function(a) {
    var len = CsMesh3d.norm(a);
    if (!isFinite(len) || len < 1e-12) {
        return null;
    }
    return { x: a.x / len, y: a.y / len, z: a.z / len };
};

/**
 * An orthonormal frame for a passage heading in `dir`.
 *
 * World is Z-up, matching the survey's own frame. `right` comes out
 * horizontal wherever the passage is not vertical, so a cross section
 * drawn in this frame stands the way a caver would draw it.
 *
 * In a vertical shaft that choice is degenerate -- every horizontal
 * direction is equally perpendicular -- and a near-zero cross product
 * would let floating-point noise pick one, so the frame would spin
 * from station to station down the same pitch. North is used as the
 * reference instead: arbitrary, but the SAME arbitrary every time.
 *
 * \return {forward, right, up} unit vectors, or null when `dir` has no
 *         length at all.
 */
CsMesh3d.frameAt = function(dir) {
    var forward = CsMesh3d.normalize(dir);
    if (forward === null) {
        return null;
    }
    var right = CsMesh3d.normalize(
        CsMesh3d.cross(forward, { x: 0, y: 0, z: 1 }));
    if (right === null) {
        right = CsMesh3d.normalize(
            CsMesh3d.cross(forward, { x: 0, y: 1, z: 0 }));
    }
    var up = CsMesh3d.normalize(CsMesh3d.cross(right, forward));
    if (up === null) {
        return null;
    }
    return { forward: forward, right: right, up: up };
};

/**
 * How many angular buckets a traced section is reduced to.
 *
 * A hand-traced outline can carry hundreds of vertices, and the loft
 * walks every ring by angle -- so the cost of a detailed section is
 * paid at every leg it touches, on a cave with hundreds of them. Sixty
 * four is finer than a passage outline is ever read at in this view,
 * and it is what makes a traced section no more expensive to loft than
 * a measured one.
 */
CsMesh3d.SECTION_BUCKETS = 64;

/**
 * Files one wall point into its angular bucket, keeping the OUTERMOST.
 *
 * The bucket map is {slot: {u, v, angle, radius}} in the ring's own
 * plane. A point at the station itself says nothing about which way
 * any wall lies and is dropped.
 */
CsMesh3d.bucketPoint = function(buckets, u, v) {
    if (!isFinite(u) || !isFinite(v)) {
        return;
    }
    var radius = Math.sqrt(u * u + v * v);
    if (radius < 1e-9) {
        return;
    }
    var angle = Math.atan2(v, u);
    var slot = Math.floor((angle + Math.PI) /
        (2 * Math.PI) * CsMesh3d.SECTION_BUCKETS);
    if (slot < 0) { slot = 0; }
    if (slot >= CsMesh3d.SECTION_BUCKETS) {
        slot = CsMesh3d.SECTION_BUCKETS - 1;
    }
    var held = buckets[slot];
    if (held === undefined || radius > held.radius) {
        buckets[slot] = { u: u, v: v, angle: angle, radius: radius };
    }
};

/**
 * A traced cross section as a ring around its station.
 *
 * WHY A SECTION BEATS AN LRUD. Four ticks make a four-sided prism, and
 * the passage is not one. Where a caver has stood in the passage and
 * drawn its actual outline, that drawing is a better answer than the
 * four numbers -- so the tube uses it, and falls back to the LRUD
 * everywhere else.
 *
 * THE FRAME IS THIS FILE'S, not the section's own display frame.
 * Angles have to agree with the rings either side of this one, because
 * that is what the loft matches on; a second frame here would be a
 * second answer to "which way is up at this station" and would show up
 * as a twist at every station that had a section drawn.
 *
 * DRAWN LOOKING FORWARD, along the direction of travel (Nathan,
 * 2026-09-20). So the page's x is the caver's right -- which is
 * frame.right, the same side `tick("right", 1, 0)` puts the R wall on
 * -- and the page's y is up. Read the other way round and every
 * sectioned station comes out mirrored, left wall on the right.
 *
 * OUTERMOST WINS in each angular bucket, which is where "only the
 * outside walls" lives: a trace that wanders inside the passage --
 * round a boulder, along a ledge, over breakdown -- cannot pull the
 * tube in past the wall it also drew, and a re-entrant the loft could
 * not render anyway costs nothing.
 *
 * \param station {x, y, z} of the station, in drawing coordinates
 * \param dir     the passage direction there
 * \param sec     {scale, polylines: [[{x, y}]]} block-local, (0,0) at
 *                the station -- what CsSection3d.readAll answers
 * \return ring points [{x, y, z, angle}], or [] when there is nothing
 *         usable. Pure.
 */
CsMesh3d.sectionRing = function(station, dir, sec, lrud, splays,
        tapeMode) {
    if (sec === null || sec === undefined ||
            Object.prototype.toString.call(sec.polylines) !==
                "[object Array]") {
        return [];
    }
    var frame = CsMesh3d.frameAt(dir);
    if (frame === null) {
        return [];
    }
    var scale = sec.scale;
    if (typeof scale !== "number" || !isFinite(scale) ||
            Math.abs(scale) < 1e-9) {
        scale = 1;
    }
    var buckets = {};
    var i, j;

    // THE OUTER SHELL OF BOTH (Nathan, 2026-09-20: "when lruds and
    // walls intersect, i only want the outer most"). A traced section
    // does not replace what was measured at that station -- the tape
    // and the pencil are two readings of one passage, and where they
    // disagree the passage is at least as wide as the wider of them.
    // A tick poking out through a trace drawn a little tight is a
    // measurement, not an error to be clipped off; a trace drawn wide
    // of a tick is the caver saying the wall is really out there.
    //
    // So both go into the same buckets and the outermost wins, which
    // is the same rule the traced points already use among themselves.
    var measured = CsMesh3d.measuredLocals(frame, lrud, splays, tapeMode);
    for (i = 0; i < measured.length; i++) {
        CsMesh3d.bucketPoint(buckets, measured[i].u, measured[i].v);
    }

    for (i = 0; i < sec.polylines.length; i++) {
        var line = sec.polylines[i];
        if (Object.prototype.toString.call(line) !== "[object Array]") {
            continue;
        }
        for (j = 0; j < line.length; j++) {
            var pt = line[j];
            if (pt === null || pt === undefined ||
                    typeof pt.x !== "number" || typeof pt.y !== "number" ||
                    !isFinite(pt.x) || !isFinite(pt.y)) {
                continue;
            }
            CsMesh3d.bucketPoint(buckets, pt.x / scale, pt.y / scale);
        }
    }

    var kept = [];
    for (var key in buckets) {
        if (buckets.hasOwnProperty(key)) { kept.push(buckets[key]); }
    }
    if (kept.length < 3) {
        // Two points are a line, not a section. Let the LRUD answer.
        return [];
    }
    kept.sort(function(a, b) { return a.angle - b.angle; });

    // WHERE THE OUTLINE WAS LEFT OPEN ON PURPOSE.
    //
    // An unclosed trace has two meanings and the drawing cannot tell
    // them apart: the passage carries on that way, or the caver had
    // not finished. The notebook already answers it -- a side written
    // "P" is the party saying they looked and found no wall -- so the
    // TRACE says where the gap is and the LRUD says whether it was
    // meant (Nathan, 2026-09-20: "if the cross section is open, and
    // state Passage in that direction, then it should stay open").
    //
    // A gap nobody wrote P against closes as it always has, so an
    // unfinished section still renders as passage rather than as a
    // hole in the cave.
    var gaps = CsMesh3d.openSpans(buckets, lrud);
    if (gaps.length > 0) {
        kept.gaps = gaps;
    }

    var out = [];
    for (i = 0; i < kept.length; i++) {
        out.push({
            x: station.x + kept[i].u * frame.right.x +
                           kept[i].v * frame.up.x,
            y: station.y + kept[i].u * frame.right.y +
                           kept[i].v * frame.up.y,
            z: station.z + kept[i].u * frame.right.z +
                           kept[i].v * frame.up.z,
            angle: kept[i].angle
        });
    }
    if (kept.gaps !== undefined) {
        out.gaps = kept.gaps;
    }
    return out;
};

/** The angle each LRUD side sits at in a ring's own frame: the same
 *  places ringAt puts its four ticks. */
CsMesh3d.SIDE_ANGLES = {
    right: 0,
    up: Math.PI / 2,
    left: Math.PI,
    down: -Math.PI / 2
};

/**
 * The angular spans a traced section deliberately left open.
 *
 * A span counts only when the trace has no wall across it AND the
 * notebook wrote "P" for a side pointing into it. Both halves are
 * needed: the trace alone cannot say whether a gap was meant, and the
 * P alone cannot say how wide the opening is -- the caver drew that.
 *
 * \param buckets the angular buckets sectionRing filled, {slot: point}
 * \param lrud    the station's reading, for its leftOpen/rightOpen/
 *                upOpen/downOpen flags. Absent means nothing is open.
 * \return [[fromAngle, toAngle]], possibly empty. Pure.
 */
CsMesh3d.openSpans = function(buckets, lrud) {
    var out = [];
    if (lrud === null || lrud === undefined) {
        return out;
    }
    var openAngles = [];
    var side;
    for (side in CsMesh3d.SIDE_ANGLES) {
        if (!CsMesh3d.SIDE_ANGLES.hasOwnProperty(side)) { continue; }
        if (lrud[side + "Open"] === true) {
            openAngles.push(CsMesh3d.SIDE_ANGLES[side]);
        }
    }
    if (openAngles.length === 0) {
        return out;
    }
    var n = CsMesh3d.SECTION_BUCKETS;
    var slotOf = function(angle) {
        var slot = Math.floor((CsMesh3d.wrapAngle(angle) + Math.PI) /
            (2 * Math.PI) * n);
        if (slot < 0) { slot = 0; }
        if (slot >= n) { slot = n - 1; }
        return slot;
    };
    var angleOfSlot = function(slot) {
        return -Math.PI + (2 * Math.PI) * (slot / n);
    };
    var empty = function(slot) {
        return buckets[((slot % n) + n) % n] === undefined;
    };
    var claimed = {};
    for (var i = 0; i < openAngles.length; i++) {
        var seed = slotOf(openAngles[i]);
        if (!empty(seed) || claimed[seed] === true) {
            // The trace HAS a wall facing the open side: the caver
            // drew one there, and a drawn wall beats a written P --
            // it is the more specific statement about this station.
            continue;
        }
        // Walk out both ways to the extent of the hole the caver left.
        var from = seed, to = seed, steps = 0;
        while (empty(from - 1) && steps < n) { from -= 1; steps += 1; }
        steps = 0;
        while (empty(to + 1) && steps < n) { to += 1; steps += 1; }
        for (var c = from; c <= to; c++) {
            claimed[((c % n) + n) % n] = true;
        }
        out.push([angleOfSlot(from), angleOfSlot(to + 1)]);
    }
    return out;
};

/**
 * Everything MEASURED at a station, in the ring's own plane.
 *
 * u along the frame's right, v along its up, the station at the
 * origin: the four LRUD ticks and the tip of every splay. Split out of
 * ringAt so a traced section can be merged with the same points rather
 * than replacing them -- see sectionRing.
 *
 * \return [{u, v, angle}], unsorted. Pure.
 */
CsMesh3d.measuredLocals = function(frame, lrud, splays, tapeMode) {
    var local = [];
    if (frame === null || frame === undefined) {
        return local;
    }
    lrud = lrud || {};
    if (splays === undefined || splays === null) {
        splays = [];
    }
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }
    var add = function(u, v) {
        if (!isFinite(u) || !isFinite(v)) {
            return;
        }
        local.push({ u: u, v: v, angle: Math.atan2(v, u) });
    };
    var tick = function(name, uSign, vSign) {
        var d = lrud[name];
        if (d === null || d === undefined || !isFinite(d)) {
            return;
        }
        add(uSign * d, vSign * d);
    };
    tick("right", 1, 0);
    tick("left", -1, 0);
    tick("up", 0, 1);
    tick("down", 0, -1);

    for (var i = 0; i < splays.length; i++) {
        var shot = splays[i];
        var o = CsTraverse.offset(shot, tapeMode);
        if (o === null) {
            continue;
        }
        var vec = { x: o.dx, y: o.dy, z: o.dz };
        var u = CsMesh3d.dot(vec, frame.right);
        var v = CsMesh3d.dot(vec, frame.up);
        if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) {
            // Aimed along the passage: on the centerline, a wall point
            // for neither side.
            continue;
        }
        add(u, v);
    }
    return local;
};

/**
 * One station's cross section: the measured wall points around it, in
 * angular order, as world coordinates.
 *
 * `lrud` is {left, right, up, down}. Null (or undefined) means NOT
 * MEASURED and contributes nothing. Zero means the wall passes through
 * the station -- a real measurement -- and contributes a point AT it.
 * That distinction is CsLrud.tickEnd's, and it was dead code there
 * once, which is exactly how it and the docblock drifted apart; it is
 * restated here so a mesh cannot quietly re-break it.
 *
 * A splay aimed straight along the passage is on the centerline and
 * belongs to neither wall, so it contributes nothing -- the same call
 * CsLrud makes.
 *
 * \param splays   shots from this station with splay === true
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL
 * \return [{x, y, z}] in angular order, possibly empty
 */
CsMesh3d.ringAt = function(station, dir, lrud, splays, tapeMode) {
    var frame = CsMesh3d.frameAt(dir);
    if (frame === null) {
        return [];
    }
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }
    if (splays === undefined || splays === null) {
        splays = [];
    }
    lrud = lrud || {};

    var local = CsMesh3d.measuredLocals(frame, lrud, splays, tapeMode);
    local.sort(function(a, b) { return a.angle - b.angle; });

    var out = [];
    for (var k = 0; k < local.length; k++) {
        out.push({
            x: station.x + local[k].u * frame.right.x +
                           local[k].v * frame.up.x,
            y: station.y + local[k].u * frame.right.y +
                           local[k].v * frame.up.y,
            z: station.z + local[k].u * frame.right.z +
                           local[k].v * frame.up.z,
            // The angle this point sat at in its own station's frame,
            // carried out so the loft can match two rings up by WHERE
            // the wall was rather than by position in a list. See
            // CsMesh3d.loft.
            angle: local[k].angle
        });
    }
    return out;
};

// ---------------------------------------------------------------------
// The whole surface
// ---------------------------------------------------------------------

// Colours a trip index cycles through. Deliberately few, and chosen to
// stay apart from one another against the dark ground the GL window
// draws on.
CsMesh3d.TRIP_COLORS = [
    [0.85, 0.84, 0.78], [0.90, 0.55, 0.30], [0.40, 0.70, 0.90],
    [0.60, 0.85, 0.45], [0.88, 0.48, 0.62], [0.75, 0.70, 0.35]
];

// The closure bands, rendered. CsClosure names its colours in WORDS,
// because it draws into a CAD drawing where colour is a layer property;
// here they have to be actual light, so the words are mapped once.
CsMesh3d.BAND_COLORS = {
    green:  [0.45, 0.80, 0.45],
    yellow: [0.90, 0.85, 0.35],
    orange: [0.92, 0.60, 0.25],
    red:    [0.90, 0.32, 0.30]
};

// Splay coverage, worst first, so the legend reads as a scale.
//
// This is the mode that says how much of the passage shape is measured
// and how much is four numbers and a guess between them. The mesh
// already draws LESS where less was measured; this says so out loud.
CsMesh3d.COVERAGE = [
    { key: "none",  color: [0.45, 0.45, 0.48], says: "nothing measured" },
    { key: "lrud",  color: [0.72, 0.69, 0.60], says: "LRUD only" },
    { key: "splay", color: [0.55, 0.82, 0.90], says: "splays measured" }
];

/** Colour for a depth, shallow (1) to deep (0), as a cool ramp. */
CsMesh3d.depthColor = function(t) {
    if (!isFinite(t)) { t = 0.5; }
    if (t < 0) { t = 0; }
    if (t > 1) { t = 1; }
    return [0.25 + 0.60 * t, 0.45 + 0.40 * t, 0.70 + 0.25 * (1 - t)];
};

/** Colour for a depth of cover, thin (0) to deep (1).
 *
 *  HOT AT THE THIN END, unlike every other ramp here, and that is the
 *  whole point of the mode: thin rock is the finding -- a possible
 *  daylight lead, a dig worth trying, the breakdown overhead, the
 *  quarry above -- and a scale that made the deepest passage the
 *  loudest colour would shout about the part nobody can reach.
 */
CsMesh3d.coverColor = function(t) {
    if (!isFinite(t)) { t = 0.5; }
    if (t < 0) { t = 0; }
    if (t > 1) { t = 1; }
    // red -> orange -> yellow -> olive -> deep blue-green
    return [0.92 - 0.62 * t, 0.22 + 0.40 * t, 0.18 + 0.42 * t];
};

/** A station the surface has no reading over: a hole in the grid, a
 *  station outside the fetched window, or no surface data at all.
 *
 *  ITS OWN FLAT GREY, and a labelled swatch in the legend beside the
 *  ramp. Painting unknown cover at the bottom of the ramp would say
 *  "no rock above this passage" in the loudest colour on the scale.
 */
CsMesh3d.COVER_UNKNOWN = [0.52, 0.52, 0.55];

/**
 * The direction the passage runs at a station: the mean of the unit
 * vectors of the non-splay legs touching it.
 *
 * At a junction this averages branches heading different ways, which is
 * meaningless -- so build() never asks for it there. It passes the
 * leg's own direction instead, which is what each branch's own surface
 * should be squared to, and is how CsLrud ends a wall run at a junction
 * with the geometry of the run that arrived.
 *
 * ONE VECTOR PER WAY OUT, NOT PER LEG, when `axes` is supplied. At a
 * loop tie-in the closure leg runs back down the passage the other two
 * legs already walk, so counting it again pulls the mean toward
 * whichever direction happens to have two legs in it and tilts the
 * ring away from the passage. Folding legs that leave the same way
 * down to one representative (CsLrud.nearestCluster over
 * CsLrud.stationAxes) gives the passage the say, not the notebook.
 * Without `axes` the old per-leg mean stands, so a caller that has not
 * been taught is unchanged.
 */
CsMesh3d.directionAt = function(name, legsByStation, resolved, axes) {
    var legs = legsByStation[name] || [];
    var sum = { x: 0, y: 0, z: 0 };
    var n = 0;
    var seenWay = {};
    for (var i = 0; i < legs.length; i++) {
        var a = resolved.stations[legs[i].from];
        var b = resolved.stations[legs[i].to];
        if (a === undefined || b === undefined) {
            continue;
        }
        var v = CsMesh3d.normalize(CsMesh3d.sub(b, a));
        if (v === null) {
            continue;
        }
        if (axes !== undefined && axes !== null) {
            // The way OUT of this station along this leg, which is the
            // leg's own bearing at its `from` end and the reverse of it
            // at its `to` end.
            var out = (legs[i].from === name) ?
                CsLrud.planBearing(a, b) : CsLrud.planBearing(b, a);
            var way = CsLrud.nearestCluster(axes, name, out);
            if (way >= 0) {
                if (seenWay[way] === true) {
                    continue;
                }
                seenWay[way] = true;
            }
        }
        sum.x += v.x;
        sum.y += v.y;
        sum.z += v.z;
        n += 1;
    }
    if (n === 0) {
        return null;
    }
    return CsMesh3d.normalize(sum);
};

/**
 * The LRUD recorded AT a station. It lives on the shot that ARRIVED
 * there -- "LRUD at the TO station, facing travel" is CsModel's
 * convention and CsLrud's -- so the first non-splay shot whose `to` is
 * this station is the one that measured it.
 */
CsMesh3d.lrudAt = function(name, survey) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay !== true && s.to === name && !s.excludeFromAll) {
            // THE OPEN FLAGS RIDE ALONG. A side written "P" is a
            // reading -- the party looked and found no wall that way --
            // and a caller that cannot see the flag reads a station
            // recorded "P P P P" as one nobody measured. ringAt still
            // plots no point for an open side (there is no wall to put
            // one on), but the splay-coverage colouring below can now
            // tell "checked, wide open" from "never looked".
            return { left: s.left, right: s.right,
                     up: s.up, down: s.down,
                     leftOpen: s.leftOpen === true,
                     rightOpen: s.rightOpen === true,
                     upOpen: s.upOpen === true,
                     downOpen: s.downOpen === true };
        }
    }
    // A STATION NO SHOT ARRIVES AT still has walls, and they live
    // somewhere else: in a start-LRUD.
    //
    // The notebook's first row is a station with walls and no shot to
    // hang them on, so what the caver typed there is kept as the
    // trip's startLrud. Without reading it back the station has no
    // measured passage around it at all: no ring in the 3D view, and
    // a depth of cover measured over the centerline instead of over
    // the ceiling.
    //
    // EVERY TRIP'S, not just the survey's. This used to look only at
    // survey.startLrud and only for the cave's very first station, so
    // a trip that STARTED somewhere new -- a page whose anchor row is
    // a station nothing has reached yet, which is what beginning a
    // branch looks like -- had the walls the caver typed on that row
    // silently dropped (Nathan, 2026-09-20: "when entering B1 for
    // trip 1, it's not drawing LRUD correctly"). Measured: B1 got no
    // ring while A1, the same case one trip earlier, got one.
    //
    // STILL TRIP BY TRIP, which is the rule the old code was right
    // about: a start-LRUD belongs to ONE station, the one its trip
    // starts from. Handing it to any station that happens to have
    // nothing arriving would put one trip's walls around another
    // trip's gap.
    var starts = CsLrud.startLruds(survey);
    if (starts.hasOwnProperty(name)) {
        var sl = starts[name];
        return { left: sl.left, right: sl.right,
                 up: sl.up, down: sl.down,
                 // THE OPEN FLAGS RIDE ALONG HERE TOO. They did not,
                 // and a first station read "P P" was indistinguish-
                 // able from one nobody measured -- the one place in
                 // the suite where that distinction was still lost.
                 leftOpen: sl.leftOpen === true,
                 rightOpen: sl.rightOpen === true,
                 upOpen: sl.upOpen === true,
                 downOpen: sl.downOpen === true };
    }
    return { left: null, right: null, up: null, down: null };
};


/** The station a survey starts from: the `from` of its first real
 *  shot. The one station no shot arrives at, and therefore the one
 *  whose LRUD has nowhere else to live. */
CsMesh3d.firstStation = function(survey) {
    if (survey === null || survey === undefined ||
            survey.shots === undefined) {
        return null;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay !== true && !s.excludeFromAll) {
            return s.from;
        }
    }
    return null;
};

/**
 * The trip a station belongs to: the trip of the shot that arrived
 * there. The very first station of a survey was never arrived at, and
 * takes the trip of the shot that LEAVES it instead -- otherwise every
 * cave's first station is coloured trip 0 whether or not trip 0 is
 * where it came from.
 */
CsMesh3d.tripAt = function(name, survey) {
    var i, s;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay !== true && s.to === name) {
            return s.trip || 0;
        }
    }
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay !== true && s.from === name) {
            return s.trip || 0;
        }
    }
    return 0;
};

/** One quad as two triangles, each with its own flat normal. */
CsMesh3d.quad = function(tri, p0, p1, p2, p3, colorA, colorB) {
    var emit = function(a, b, c, col) {
        var nrm = CsMesh3d.normalize(
            CsMesh3d.cross(CsMesh3d.sub(b, a), CsMesh3d.sub(c, a)));
        if (nrm === null) {
            // Degenerate -- three collinear or coincident points, which
            // a zero LRUD beside a measured one produces honestly.
            // There is no surface here to draw.
            return;
        }
        var base = tri.positions.length / 3;
        var pts = [a, b, c];
        for (var i = 0; i < 3; i++) {
            tri.positions.push(pts[i].x, pts[i].y, pts[i].z);
            tri.normals.push(nrm.x, nrm.y, nrm.z);
            tri.colors.push(col[0], col[1], col[2]);
        }
        tri.indices.push(base, base + 1, base + 2);
    };
    emit(p0, p1, p2, colorB);
    emit(p0, p2, p3, colorA);
};

/**
 * The ring point lying nearest a given angle, measured the short way
 * round so that -179 degrees and +179 degrees are two degrees apart
 * rather than three hundred and fifty eight.
 */
CsMesh3d.nearestByAngle = function(ring, angle) {
    var best = ring[0];
    var bestGap = Infinity;
    for (var i = 0; i < ring.length; i++) {
        var gap = Math.abs(ring[i].angle - angle);
        if (gap > Math.PI) {
            gap = 2 * Math.PI - gap;
        }
        if (gap < bestGap) {
            bestGap = gap;
            best = ring[i];
        }
    }
    return best;
};

/**
 * Triangle strip between two rings.
 *
 * MATCHED BY ANGLE, NOT BY INDEX. Rings rarely have the same number of
 * points -- one station may have four LRUD ticks and its neighbour
 * eleven splays -- and pairing them by position in the list silently
 * assumes the two lists divide the circle the same way. They do not:
 * four evenly spread ticks against eleven splays clustered up one wall
 * would pair the floor of one station with the ceiling of the next, and
 * the strip would twist through the passage rather than skin it.
 *
 * So both rings are sampled at the same set of angles, taken around the
 * circle. Each sample picks the MEASURED point nearest that angle,
 * repeating one where a ring is sparse rather than interpolating a
 * wall position nobody recorded.
 *
 * Flat normals throughout. Smoothing across the strip would imply the
 * passage curves between stations in a way the data does not say.
 */
CsMesh3d.loft = function(tri, ringA, ringB, colorA, colorB) {
    var n = Math.max(ringA.length, ringB.length);
    if (n < 3 || ringA.length < 1 || ringB.length < 1) {
        return;
    }
    var angleOf = function(i) {
        return -Math.PI + (2 * Math.PI) * ((i % n) / n);
    };
    for (var i = 0; i < n; i++) {
        var mid = angleOf(i) + Math.PI / n;
        // WHERE THE PASSAGE GOES ON, NO SURFACE. A ring may declare
        // spans with no wall in them -- a traced section left open on
        // a side the notebook recorded "P" -- and skinning across one
        // would put a wall where the party looked and found none. Both
        // ends have to be walled for a quad to exist, which is what
        // makes the hole close again as soon as the next station says
        // there is a wall.
        if (CsMesh3d.isOpenAt(ringA, mid) ||
                CsMesh3d.isOpenAt(ringB, mid)) {
            continue;
        }
        var a0 = CsMesh3d.nearestByAngle(ringA, angleOf(i));
        var a1 = CsMesh3d.nearestByAngle(ringA, angleOf(i + 1));
        var b0 = CsMesh3d.nearestByAngle(ringB, angleOf(i));
        var b1 = CsMesh3d.nearestByAngle(ringB, angleOf(i + 1));
        CsMesh3d.quad(tri, a0, a1, b1, b0, colorA, colorB);
    }
};

/**
 * True when a ring declares no wall at this angle.
 *
 * A ring carries its open spans on itself, as `gaps`: pairs of angles
 * a wall was looked for and deliberately not found. A ring with none
 * -- every ring built from LRUD ticks alone -- answers false for
 * everything, which is the behaviour this file had before open spans
 * existed.
 */
CsMesh3d.isOpenAt = function(ring, angle) {
    if (ring === null || ring === undefined ||
            Object.prototype.toString.call(ring.gaps) !== "[object Array]") {
        return false;
    }
    var a = CsMesh3d.wrapAngle(angle);
    for (var i = 0; i < ring.gaps.length; i++) {
        var span = ring.gaps[i];
        if (Object.prototype.toString.call(span) !== "[object Array]" ||
                span.length < 2) {
            continue;
        }
        var from = CsMesh3d.wrapAngle(span[0]);
        var to = CsMesh3d.wrapAngle(span[1]);
        if (from <= to) {
            if (a >= from && a <= to) { return true; }
        } else if (a >= from || a <= to) {
            // The span runs across the seam at +/- pi.
            return true;
        }
    }
    return false;
};

/** An angle brought into (-pi, pi]. */
CsMesh3d.wrapAngle = function(angle) {
    var a = angle;
    while (a <= -Math.PI) { a += 2 * Math.PI; }
    while (a > Math.PI) { a -= 2 * Math.PI; }
    return a;
};

/** A generic ramp, warm at the top of the range and cool at the bottom.
 *  Deliberately unlike the depth ramp, so two modes never look alike and
 *  a reader cannot mistake one legend for another. */
CsMesh3d.rampColor = function(t) {
    if (!isFinite(t)) { t = 0.5; }
    if (t < 0) { t = 0; }
    if (t > 1) { t = 1; }
    return [0.30 + 0.62 * t, 0.72 - 0.34 * t, 0.85 - 0.55 * t];
};

/** A distance formatted for a legend: no more precision than a reader
 *  can use, with the unit attached, because a bare number on a colour
 *  bar is ambiguous between feet and metres. */
CsMesh3d.legendLength = function(value, unit) {
    var u = (unit === "m") ? "m" : "ft";
    return (Math.round(value * 10) / 10) + " " + u;
};

/**
 * What to call a trip in a legend.
 *
 * ITS NAME ONLY IF ITS NAME TELLS IT APART. Real drawings routinely give
 * every trip the CAVE's name -- Truitt Cave has nine trips all called
 * "TRUITT CAVE" -- and a legend that repeats one word nine times has
 * told the reader nothing while looking like it has. So a name shared
 * with another trip is disambiguated by its date, and failing that by
 * its position.
 *
 * A trip with no name and no date is still a real trip and still needs a
 * row.
 */
CsMesh3d.tripLabel = function(survey, index) {
    var trips = (survey && survey.trips) ? survey.trips : [];
    var t = trips[index];
    if (t === undefined || t === null) {
        return "Trip " + (index + 1);
    }
    var name = (typeof t.name === "string") ? t.name : "";
    var date = (typeof t.date === "string") ? t.date : "";

    if (name === "") {
        return date !== "" ? date : "Trip " + (index + 1);
    }

    var shared = false;
    for (var i = 0; i < trips.length; i++) {
        if (i === index || trips[i] === null || trips[i] === undefined) {
            continue;
        }
        if (trips[i].name === name) {
            shared = true;
            break;
        }
    }
    if (!shared) {
        return name;
    }

    // TWO TEAMS OUT ON ONE DAY IS NOT AN EDGE CASE. Truitt has two
    // trips both called "TRUITT CAVE" on 2024-04-06 -- Team A and Team
    // B, out together -- so the date alone does not always separate
    // them either, and a legend with two identical rows is back where
    // it started.
    if (date !== "") {
        var dateShared = false;
        for (var j = 0; j < trips.length; j++) {
            if (j === index || trips[j] === null ||
                    trips[j] === undefined) {
                continue;
            }
            if (trips[j].name === name && trips[j].date === date) {
                dateShared = true;
                break;
            }
        }
        if (!dateShared) {
            return name + " " + date;
        }
        return name + " " + date + " (" + (index + 1) + ")";
    }
    return name + " " + (index + 1);
};

/**
 * Trip indices in chronological order.
 *
 * Sorted by date, and trips SHARING a date by their position in the
 * survey -- which is the order they were walked. Sorting on date alone
 * would leave two trips on the same Saturday in an arbitrary order, and
 * a ramp built on that order would put them in an arbitrary order too.
 *
 * A trip with no date sorts after the dated ones rather than before:
 * "undated" is not "earliest", and putting it first would invent a
 * history the survey does not record.
 */
CsMesh3d.tripOrder = function(survey) {
    var trips = (survey && survey.trips) ? survey.trips : [];
    var idx = [];
    for (var i = 0; i < trips.length; i++) { idx.push(i); }
    idx.sort(function(a, b) {
        var da = (trips[a] && typeof trips[a].date === "string")
            ? trips[a].date : "";
        var db = (trips[b] && typeof trips[b].date === "string")
            ? trips[b].date : "";
        if (da !== db) {
            if (da === "") { return 1; }
            if (db === "") { return -1; }
            return da < db ? -1 : 1;
        }
        return a - b;
    });
    return idx;
};

/**
 * Traverse distance from `anchorName` to every station, walked along the
 * legs.
 *
 * NOT straight-line distance. "How far in am I" is a question about the
 * passage: a station fifty feet from the entrance through six hundred
 * feet of crawl is six hundred feet in, and a straight line would call
 * it fifty and be useless.
 *
 * \return {stationName: distance}, empty when there is nothing to walk
 */
CsMesh3d.distancesFrom = function(anchorName, resolved) {
    var adj = {};
    var add = function(from, to) {
        if (!adj.hasOwnProperty(from)) { adj[from] = []; }
        adj[from].push(to);
    };
    var i;
    for (i = 0; i < resolved.legs.length; i++) {
        add(resolved.legs[i].from, resolved.legs[i].to);
        add(resolved.legs[i].to, resolved.legs[i].from);
    }
    var out = {};
    var start = anchorName;
    if (start === undefined || start === null ||
            resolved.stations[start] === undefined) {
        for (var n in resolved.stations) {
            if (resolved.stations.hasOwnProperty(n)) { start = n; break; }
        }
    }
    if (start === undefined || start === null ||
            resolved.stations[start] === undefined) {
        return out;
    }
    out[start] = 0;
    var queue = [start];
    var head = 0;
    while (head < queue.length) {
        var here = queue[head++];
        var hs = resolved.stations[here];
        var next = adj[here] || [];
        for (var k = 0; k < next.length; k++) {
            var nm = next[k];
            if (out.hasOwnProperty(nm)) { continue; }
            var ns = resolved.stations[nm];
            if (ns === undefined) { continue; }
            out[nm] = out[here] + CsMesh3d.norm(CsMesh3d.sub(ns, hs));
            queue.push(nm);
        }
    }
    return out;
};

/** The area a ring encloses: half the length of the summed cross
 *  products of its edges about the first vertex, which is the vector
 *  form of the shoelace formula and works on a polygon lying in any
 *  plane in space. */
CsMesh3d.ringArea = function(ring) {
    if (ring.length < 3) { return 0; }
    var sum = { x: 0, y: 0, z: 0 };
    for (var i = 1; i + 1 < ring.length; i++) {
        var c = CsMesh3d.cross(CsMesh3d.sub(ring[i], ring[0]),
                               CsMesh3d.sub(ring[i + 1], ring[0]));
        sum.x += c.x; sum.y += c.y; sum.z += c.z;
    }
    return CsMesh3d.norm(sum) / 2;
};

/** The value at a percentile of a list of numbers, by nearest rank. */
CsMesh3d.percentile = function(values, p) {
    if (values.length === 0) { return 0; }
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var i = Math.floor((sorted.length - 1) * p);
    if (i < 0) { i = 0; }
    if (i >= sorted.length) { i = sorted.length - 1; }
    return sorted[i];
};

/**
 * The whole passage surface, ready for the GL window.
 *
 * \param survey   a Survey (CsModel)
 * \param resolved CsNetwork.resolve(survey)
 * \param opts     {colorBy, anchorName, tapeMode}
 *                 colorBy is one of trip, depth, distance, size, date,
 *                 closure, splay, cover -- anything else falls back to
 *                 trip.
 *                 anchorName is the station "distance" measures from;
 *                 absent, it uses the first station it finds.
 *                 cover is {station: depth of cover in drawing units,
 *                 or null}, from CsCover.atStations -- required by the
 *                 cover mode and ignored by every other one. This file
 *                 never reads a grid: the surface, its datum and its
 *                 georeference stay on the caller's side.
 *
 * \return {triangles: {positions, normals, colors, indices},
 *          lines:     {positions, colors, indices},
 *          steps:     [{triangleVertices, lineVertices, station, trip}]
 *                     one per leg, cumulative -- see below,
 *          ghost:     {positions, colors, indices} the as-surveyed
 *                     network, EMPTY when there is nothing to compare,
 *          leads:     {positions, colors, indices} a cross at each of
 *                     CsFrontier's open ends,
 *          legend:    {title, kind: "ramp"|"swatches", note, stops}
 *                     what the colours mean. The VIEW NEVER COMPUTES
 *                     THIS -- it paints the legend it is handed, so
 *                     every unit that knows what a trip or a foot is
 *                     stays on this side of the bridge,
 *          bounds:    {min: {x,y,z}, max: {x,y,z}}}
 *
 * WALKS THE SPANNING TREE, not a name order. `resolved.legs` arrives in
 * resolution order tagged "new" / "closure" / "tie", and the "new" legs
 * are exactly the tree: each attaches a newly placed station to one
 * already placed, so its two ends are adjacent BY CONSTRUCTION. A walk
 * over station names in first-appearance order carries no such promise
 * -- two consecutive names can sit in different parts of the cave, and
 * lofting between their rings would stretch a surface across open air.
 *
 * Closure and tie legs are drawn on the centerline but never lofted: a
 * closure joins two stations the tree has already reached by other
 * routes, so lofting it would lay a second surface over passage that is
 * already covered.
 *
 * ONE PASS, NOT TWO. The centerline and the shell are emitted together,
 * leg by leg, so both buffers share an ordering. That is what lets the
 * build animation reveal them in lockstep by clamping a vertex count,
 * instead of rebuilding anything: `steps[n]` is how much of each buffer
 * the cave had after its first n+1 legs, and revealing it is passing
 * that number to glDrawArrays.
 *
 * THROWS when a station on a plotted leg has no resolved elevation.
 * That is not defensive noise -- a z quietly defaulting to 0 rebases an
 * absolute-datum cave to sea level, and this suite has closed five
 * separate doors on exactly that.
 */
CsMesh3d.build = function(survey, resolved, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;
    var colorBy = opts.colorBy || "trip";
    // TRACED CROSS SECTIONS, by station: {name: {scale, polylines}},
    // block-local with (0,0) at the station, as CsSection3d.readAll
    // answers. Optional -- a caller that passes none gets the tube
    // this file has always built, out of LRUD and splays.
    var sections = opts.sections || {};

    var tri = { positions: [], normals: [], colors: [], indices: [] };
    var lin = { positions: [], colors: [], indices: [] };
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };

    if (survey === null || survey === undefined ||
            resolved === null || resolved === undefined) {
        return { triangles: tri, lines: lin, steps: [],
                 legend: { title: "Trip", kind: "swatches",
                           note: "", stops: [] },
                 ghost: { positions: [], colors: [], indices: [] },
                 leads: { positions: [], colors: [], indices: [] },
                 bounds: { min: { x: 0, y: 0, z: 0 },
                           max: { x: 0, y: 0, z: 0 } } };
    }

    var counts = CsLrud.legCounts(resolved.legs);
    // WAYS OUT, clustered by direction. A loop tie-in has three legs
    // and two ways out; by leg count it read as a junction, so its ring
    // was squared to the arriving leg alone and never cached. See
    // CsLrud.stationAxes. The leg count stays as the fallback for a
    // station the axes never saw.
    var axes = CsLrud.stationAxes(resolved);
    var branches = function(n) {
        if (axes.hasOwnProperty(n)) {
            return CsLrud.isJunction(axes, n);
        }
        return (counts[n] || 0) >= 3;
    };
    var splays = CsLrud.splaysByStation(survey);

    var legsByStation = {};
    var noteLeg = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) {
            legsByStation[name] = [];
        }
        legsByStation[name].push(leg);
    };
    var li;
    for (li = 0; li < resolved.legs.length; li++) {
        noteLeg(resolved.legs[li].from, resolved.legs[li]);
        noteLeg(resolved.legs[li].to, resolved.legs[li]);
    }

    var requireStation = function(name) {
        var st = resolved.stations[name];
        if (st === undefined) {
            return null;
        }
        if (typeof st.z !== "number" || !isFinite(st.z)) {
            throw new Error("CsMesh3d: station " + name + " has no " +
                "resolved elevation. Refusing to build a mesh that " +
                "would place it at datum zero.");
        }
        return st;
    };

    // The depth ramp needs the cave's own z range before any colour is
    // chosen, and stations are the cheap place to read it.
    var zLow = Infinity, zHigh = -Infinity;
    var name;
    for (name in resolved.stations) {
        if (resolved.stations.hasOwnProperty(name)) {
            var sz = resolved.stations[name].z;
            if (typeof sz === "number" && isFinite(sz)) {
                if (sz < zLow) { zLow = sz; }
                if (sz > zHigh) { zHigh = sz; }
            }
        }
    }
    var zSpan = zHigh - zLow;

    var unitName = survey.distanceUnit === "m" ? "m" : "ft";

    // An unknown mode is a CALLER'S bug, and a mesh that refused to build
    // over a spelling would take the panel down with it. So anything
    // unrecognised becomes trip here, before either the colours or the
    // legend are decided, so the two cannot disagree about what happened.
    if (colorBy !== "depth" && colorBy !== "distance" && colorBy !== "size" &&
            colorBy !== "date" && colorBy !== "closure" &&
            colorBy !== "splay" && colorBy !== "cover") {
        colorBy = "trip";
    }

    // RAMP MODES carry a number per station and colour by where it sits
    // in the range. BANDED MODES carry a swatch per station directly.
    var rampValue = null;
    var rampLow = 0, rampHigh = 1;
    var bandOf = null;
    var coverValues = {};
    var coverLow = 0, coverHigh = 1;

    if (colorBy === "distance") {
        rampValue = CsMesh3d.distancesFrom(opts.anchorName, resolved);
    } else if (colorBy === "size") {
        rampValue = {};
        for (name in resolved.stations) {
            if (!resolved.stations.hasOwnProperty(name)) { continue; }
            var sdir = CsMesh3d.directionAt(name, legsByStation, resolved,
                axes);
            if (sdir === null) { rampValue[name] = 0; continue; }
            rampValue[name] = CsMesh3d.ringArea(CsMesh3d.ringAt(
                resolved.stations[name], sdir,
                CsMesh3d.lrudAt(name, survey),
                splays[name] || [], tapeMode));
        }
    } else if (colorBy === "date") {
        var order = CsMesh3d.tripOrder(survey);
        var rank = {};
        for (var oi = 0; oi < order.length; oi++) { rank[order[oi]] = oi; }
        rampValue = {};
        for (name in resolved.stations) {
            if (resolved.stations.hasOwnProperty(name)) {
                rampValue[name] = rank[CsMesh3d.tripAt(name, survey)] || 0;
            }
        }
    } else if (colorBy === "closure") {
        var shifts = resolved.shifts || {};
        bandOf = function(stationName) {
            var sh = shifts[stationName];
            var d = (sh === undefined || sh === null) ? 0 : sh.distance;
            var band = CsClosure.bandFor(d);
            return CsMesh3d.BAND_COLORS[band.colour] ||
                   CsMesh3d.BAND_COLORS.green;
        };
    } else if (colorBy === "splay") {
        bandOf = function(stationName) {
            if ((splays[stationName] || []).length > 0) {
                return CsMesh3d.COVERAGE[2].color;
            }
            var lr = CsMesh3d.lrudAt(stationName, survey);
            // "P" counts as measured here: the party looked.
            if (lr.left !== null || lr.right !== null ||
                    lr.up !== null || lr.down !== null ||
                    lr.leftOpen || lr.rightOpen ||
                    lr.upOpen || lr.downOpen) {
                return CsMesh3d.COVERAGE[1].color;
            }
            return CsMesh3d.COVERAGE[0].color;
        };
    } else if (colorBy === "cover") {
        // NOT A rampValue MODE, though it looks like one. The ramp path
        // treats a missing value as the bottom of its range; here a
        // missing value means the surface has no reading over that
        // station, and colouring it "no rock at all" would be the
        // loudest wrong answer the mode can give. So cover keeps its
        // own clamp and its own unknown colour.
        //
        // CsCover computed the values -- against a grid, a datum offset
        // and a georeference this file must never learn about. They
        // arrive already in the drawing's units.
        coverValues = opts.cover || {};
        var cvals = [];
        for (name in coverValues) {
            if (coverValues.hasOwnProperty(name) &&
                    typeof coverValues[name] === "number" &&
                    isFinite(coverValues[name])) {
                cvals.push(coverValues[name]);
            }
        }
        if (cvals.length === 0) {
            coverLow = 0;
            coverHigh = 1;
        } else {
            // CLAMPED like passage size, and for the same reason: one
            // passage under a ridge otherwise flattens every shallow
            // lead into one colour. The legend says it is clamped.
            coverLow = CsMesh3d.percentile(cvals, 0.05);
            coverHigh = CsMesh3d.percentile(cvals, 0.95);
            if (!(coverHigh - coverLow > 1e-9)) {
                coverHigh = coverLow + 1;
            }
        }
        bandOf = function(stationName) {
            var v = coverValues[stationName];
            if (typeof v !== "number" || !isFinite(v)) {
                return CsMesh3d.COVER_UNKNOWN;
            }
            return CsMesh3d.coverColor(
                (v - coverLow) / (coverHigh - coverLow));
        };
    }

    if (rampValue !== null) {
        var vals = [];
        for (name in rampValue) {
            if (rampValue.hasOwnProperty(name) && isFinite(rampValue[name])) {
                vals.push(rampValue[name]);
            }
        }
        if (vals.length === 0) {
            rampLow = 0;
            rampHigh = 1;
        } else if (colorBy === "size") {
            // CLAMPED. One big room otherwise puts every crawl at the
            // bottom of a linear ramp over min..max, and the whole cave
            // reads as one colour. The legend says it is clamped -- a
            // scale that quietly discards its outliers while looking
            // linear is a lie about the data.
            rampLow = CsMesh3d.percentile(vals, 0.05);
            rampHigh = CsMesh3d.percentile(vals, 0.95);
        } else {
            rampLow = Math.min.apply(null, vals);
            rampHigh = Math.max.apply(null, vals);
        }
        if (!(rampHigh - rampLow > 1e-9)) {
            // One trip, one station, or a cave of uniform size. Every
            // value then sits mid-ramp rather than dividing by zero.
            rampHigh = rampLow + 1;
        }
    }

    var colorAt = function(stationName, st) {
        if (bandOf !== null) {
            return bandOf(stationName);
        }
        if (rampValue !== null) {
            var v = rampValue[stationName];
            if (!isFinite(v)) { v = rampLow; }
            var t = (v - rampLow) / (rampHigh - rampLow);
            return CsMesh3d.rampColor(t);
        }
        if (colorBy === "depth") {
            return CsMesh3d.depthColor(
                zSpan > 1e-9 ? (st.z - zLow) / zSpan : 0.5);
        }
        var tr = CsMesh3d.tripAt(stationName, survey);
        return CsMesh3d.TRIP_COLORS[tr % CsMesh3d.TRIP_COLORS.length];
    };

    // --- the legend, describing exactly the colouring just chosen ---
    var legend = { title: "Trip", kind: "swatches", note: "", stops: [] };
    var bi;

    if (colorBy === "depth") {
        legend.title = "Depth";
        legend.kind = "ramp";
        legend.stops = [
            { color: CsMesh3d.depthColor(0),
              label: CsMesh3d.legendLength(zLow, unitName) },
            { color: CsMesh3d.depthColor(0.5),
              label: CsMesh3d.legendLength(zLow + zSpan / 2, unitName) },
            { color: CsMesh3d.depthColor(1),
              label: CsMesh3d.legendLength(zHigh, unitName) }
        ];
    } else if (colorBy === "distance") {
        legend.title = "Distance in";
        legend.kind = "ramp";
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: CsMesh3d.legendLength(rampLow, unitName) },
            { color: CsMesh3d.rampColor(0.5),
              label: CsMesh3d.legendLength((rampLow + rampHigh) / 2,
                                           unitName) },
            { color: CsMesh3d.rampColor(1),
              label: CsMesh3d.legendLength(rampHigh, unitName) }
        ];
    } else if (colorBy === "size") {
        legend.title = "Passage size";
        legend.kind = "ramp";
        legend.note = "5th-95th percentile";
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: Math.round(rampLow) + " sq " + unitName },
            { color: CsMesh3d.rampColor(0.5),
              label: Math.round((rampLow + rampHigh) / 2) + " sq " + unitName },
            { color: CsMesh3d.rampColor(1),
              label: Math.round(rampHigh) + " sq " + unitName }
        ];
    } else if (colorBy === "date") {
        legend.title = "Survey date";
        legend.kind = "ramp";
        var dOrder = CsMesh3d.tripOrder(survey);
        var firstTrip = dOrder.length > 0 ? dOrder[0] : 0;
        var lastTrip = dOrder.length > 0 ? dOrder[dOrder.length - 1] : 0;
        legend.stops = [
            { color: CsMesh3d.rampColor(0),
              label: CsMesh3d.tripLabel(survey, firstTrip) },
            { color: CsMesh3d.rampColor(1),
              label: CsMesh3d.tripLabel(survey, lastTrip) }
        ];
    } else if (colorBy === "closure") {
        legend.title = "Closure shift";
        legend.kind = "swatches";
        // An UNADJUSTED survey has no shifts at all, so every station
        // lands in the "within a good tape read" band. That looks like a
        // clean survey and is actually no information, so the legend
        // says which of the two it is looking at.
        legend.note = (resolved.shifts === undefined ||
                       resolved.shifts === null)
            ? "adjustment is off -- nothing has moved"
            : "";
        for (bi = 0; bi < CsClosure.BANDS.length; bi++) {
            legend.stops.push({
                color: CsMesh3d.BAND_COLORS[CsClosure.BANDS[bi].colour],
                label: CsClosure.BANDS[bi].says
            });
        }
    } else if (colorBy === "cover") {
        legend.title = "Depth of cover";
        legend.kind = "ramp";
        legend.note = "5th-95th percentile, over the ceiling";
        legend.stops = [
            { color: CsMesh3d.coverColor(0),
              label: CsMesh3d.legendLength(coverLow, unitName) },
            { color: CsMesh3d.coverColor(0.5),
              label: CsMesh3d.legendLength((coverLow + coverHigh) / 2,
                                           unitName) },
            { color: CsMesh3d.coverColor(1),
              label: CsMesh3d.legendLength(coverHigh, unitName) },
            // IN THE LEGEND, BUT NOT ON THE SCALE. A grey passage
            // with no entry here reads as a colour the ramp forgot to
            // explain; a grey fed into the ramp ITSELF would bend the
            // gradient and claim a place in an order it has none in.
            // `swatch` is how a ramp legend says "square, under the
            // bar".
            { color: CsMesh3d.COVER_UNKNOWN, label: "no surface reading",
              swatch: true }
        ];
    } else if (colorBy === "splay") {
        legend.title = "Splay coverage";
        legend.kind = "swatches";
        for (bi = 0; bi < CsMesh3d.COVERAGE.length; bi++) {
            legend.stops.push({ color: CsMesh3d.COVERAGE[bi].color,
                                label: CsMesh3d.COVERAGE[bi].says });
        }
    } else {
        var tripCount = Math.max(1, (survey.trips || []).length);
        for (bi = 0; bi < tripCount; bi++) {
            legend.stops.push({
                color: CsMesh3d.TRIP_COLORS[bi % CsMesh3d.TRIP_COLORS.length],
                label: CsMesh3d.tripLabel(survey, bi)
            });
        }
    }

    var grow = function(p) {
        if (p.x < min.x) { min.x = p.x; }
        if (p.y < min.y) { min.y = p.y; }
        if (p.z < min.z) { min.z = p.z; }
        if (p.x > max.x) { max.x = p.x; }
        if (p.y > max.y) { max.y = p.y; }
        if (p.z > max.z) { max.z = p.z; }
    };

    // --- one walk of the legs ---
    //
    // A station's ring is cached, because most stations are shared by
    // two legs and rebuilding the ring would re-project every splay
    // twice. A JUNCTION is not cached: each branch squares its own
    // surface to its own approach, so the ring there depends on which
    // leg is asking.
    var ringCache = {};
    var loftedLegs = [];

    // ONE RING PER STATION, kept for the flight: the camera flies the
    // middle of the passage rather than the line of the stations, and
    // draws the shape of it around itself as it goes.
    var sectionAt = {};
    var noteSection = function(stationName, st, ring) {
        if (sectionAt.hasOwnProperty(stationName)) { return; }
        if (ring === null || ring === undefined || ring.length < 3) { return; }
        sectionAt[stationName] = {
            centre: CsMesh3d.ringCentre(st, ring),
            ring: ring
        };
    };

    var ringFor = function(stationName, st, dir) {
        var junction = branches(stationName);
        if (!junction && ringCache.hasOwnProperty(stationName)) {
            return ringCache[stationName];
        }
        // A TRACED SECTION BEATS THE FOUR TICKS. Where the caver has
        // drawn the passage's actual outline at this station, that is
        // what the tube is made of; the LRUD answers everywhere else.
        var ring = [];
        if (sections.hasOwnProperty(stationName)) {
            ring = CsMesh3d.sectionRing(st, dir, sections[stationName],
                CsMesh3d.lrudAt(stationName, survey),
                splays[stationName] || [], tapeMode);
        }
        if (ring.length < 3) {
            ring = CsMesh3d.ringAt(st, dir,
                CsMesh3d.lrudAt(stationName, survey),
                splays[stationName] || [], tapeMode);
        }
        if (!junction) {
            ringCache[stationName] = ring;
        }
        noteSection(stationName, st, ring);
        return ring;
    };

    var steps = [];
    var noteStep = function(stationName) {
        steps.push({
            triangleVertices: tri.positions.length / 3,
            lineVertices: lin.positions.length / 3,
            station: stationName,
            trip: CsMesh3d.tripAt(stationName, survey)
        });
    };

    for (li = 0; li < resolved.legs.length; li++) {
        var leg = resolved.legs[li];
        var a = requireStation(leg.from);
        var b = requireStation(leg.to);
        if (a === null || b === null) {
            // Still a step, so the table stays aligned with the legs and
            // a slider position means the same thing as the leg index it
            // came from.
            noteStep(leg.to);
            continue;
        }

        var colA = colorAt(leg.from, a);
        var colB = colorAt(leg.to, b);

        // --- this leg's centerline ---
        var lbase = lin.positions.length / 3;
        lin.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lin.colors.push(colA[0], colA[1], colA[2],
                        colB[0], colB[1], colB[2]);
        lin.indices.push(lbase, lbase + 1);
        grow(a);
        grow(b);

        // --- this leg's shell, when it is a spanning-tree leg ---
        if (leg.kind === "new") {
            var along = CsMesh3d.normalize(CsMesh3d.sub(b, a));
            // A null `along` is two stations in the same place: no
            // passage between them to put a surface on.
            if (along !== null) {
                var dirA = branches(leg.from)
                    ? along
                    : CsMesh3d.directionAt(leg.from, legsByStation,
                        resolved, axes);
                var dirB = branches(leg.to)
                    ? along
                    : CsMesh3d.directionAt(leg.to, legsByStation,
                        resolved, axes);
                if (dirA === null) { dirA = along; }
                if (dirB === null) { dirB = along; }

                var ringA = ringFor(leg.from, a, dirA);
                var ringB = ringFor(leg.to, b, dirB);
                // Fewer than three measured wall points at either end is
                // not enough for a section, and drawing something anyway
                // would be drawing a guess.
                if (ringA.length >= 3 && ringB.length >= 3) {
                    CsMesh3d.loft(tri, ringA, ringB, colA, colB);
                    // WHICH SECTIONS THIS LEG JOINS. The view needs it
                    // to answer "what is the passage doing HERE" for a
                    // point BETWEEN two stations -- the whole length of
                    // the tube, not the handful of places an instrument
                    // stood. Only lofted legs: a closure carries no
                    // surface, so there is nothing along it to show.
                    loftedLegs.push([leg.from, leg.to]);
                    var gi;
                    for (gi = 0; gi < ringA.length; gi++) { grow(ringA[gi]); }
                    for (gi = 0; gi < ringB.length; gi++) { grow(ringB[gi]); }
                }
            }
        }

        noteStep(leg.to);
    }

    // --- the as-surveyed ghost ---
    //
    // NO RAW MEANS NO GHOST, and that is not a degenerate case: it is
    // adjustment switched off, or a solve that did not converge, and in
    // both the drawn geometry already IS the as-surveyed geometry. A
    // ghost lying exactly on top of it would be noise. Same rule, and
    // the same reasoning, as CsDraw's CTRL-RAW ghost.
    //
    // Its own buffer, so that showing and hiding it costs nothing and
    // never rebuilds the mesh.
    var ghost = { positions: [], colors: [], indices: [] };
    var raw = resolved.raw;
    if (raw !== undefined && raw !== null && raw.stations !== undefined) {
        for (li = 0; li < resolved.legs.length; li++) {
            var gleg = resolved.legs[li];
            var ga = raw.stations[gleg.from];
            var gb = raw.stations[gleg.to];
            if (ga === undefined || gb === undefined) { continue; }
            if (typeof ga.z !== "number" || typeof gb.z !== "number") {
                continue;
            }
            var gbase = ghost.positions.length / 3;
            ghost.positions.push(ga.x, ga.y, ga.z, gb.x, gb.y, gb.z);
            ghost.colors.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45);
            ghost.indices.push(gbase, gbase + 1);
            grow(ga);
            grow(gb);
        }
    }

    // --- lead markers ---
    //
    // A three-axis cross rather than a dot: a dot at cave scale is one
    // pixel and disappears into the passage behind it, while a cross
    // reads as a mark ON the cave rather than a speck of it.
    //
    // AN OVERLAY, NOT A COLOUR MODE, because "where is the cave still
    // going" is a question you ask WHILE looking at something else --
    // while coloured by trip, to see who left it going; while coloured
    // by depth, to see whether the leads are up or down.
    var leads = { positions: [], colors: [], indices: [] };
    var ends = CsFrontier.openEnds(survey);
    if (ends.length > 0 && isFinite(min.x)) {
        // Sized from the cave itself: a fixed arm length is invisible on
        // a mile of passage and enormous in one small room.
        var extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
        if (!isFinite(extent) || extent <= 0) { extent = 1; }
        var arm = extent * 0.01;
        for (var ei = 0; ei < ends.length; ei++) {
            var est = resolved.stations[ends[ei].station];
            if (est === undefined || typeof est.z !== "number" ||
                    !isFinite(est.z)) {
                continue;
            }
            var axes = [[arm, 0, 0], [0, arm, 0], [0, 0, arm]];
            for (var ai = 0; ai < axes.length; ai++) {
                var ax = axes[ai];
                var mbase = leads.positions.length / 3;
                leads.positions.push(
                    est.x - ax[0], est.y - ax[1], est.z - ax[2],
                    est.x + ax[0], est.y + ax[1], est.z + ax[2]);
                leads.colors.push(1.0, 0.85, 0.25, 1.0, 0.85, 0.25);
                leads.indices.push(mbase, mbase + 1);
            }
        }
    }

    if (!isFinite(min.x)) {
        min = { x: 0, y: 0, z: 0 };
        max = { x: 0, y: 0, z: 0 };
    }
    return { triangles: tri, lines: lin, steps: steps, legend: legend,
             ghost: ghost, leads: leads,
             stations: CsMesh3d.stationLabels(resolved),
             outlines: CsMesh3d.outlineBuffer(sectionAt, loftedLegs),
             bounds: { min: min, max: max } };
};

/**
 * Every station, as a point with its name, for the labels the 3D view
 * writes over the passage.
 *
 * A SHAPE WITHOUT A NAME ON IT is what a passage in three dimensions
 * is, and the first question a cartographer asks of one is which bend
 * they are looking at.
 *
 * EVERY station, not a chosen few. Which ones can be read is a question
 * about where the camera is, and only the view knows that -- it drops
 * the ones that would overlap, nearest first. Choosing here would mean
 * choosing again every time the camera moved.
 *
 * \return {positions: [x,y,z,...], names: [...]}
 */
/**
 * The middle of the passage at a station, rather than the station.
 *
 * A STATION IS NOT THE MIDDLE OF THE PASSAGE. It is wherever the
 * instrument sat -- against a wall, on a rock, a foot off the floor --
 * and its LRUD says how far the passage runs from there. Flying down
 * the line of the stations therefore scrapes along whichever side they
 * happened to be set on. The middle of what was measured is the centre
 * of the cross section.
 *
 * Taken from the RING so that splays count: a passage with a wide
 * alcove on one side has its middle over towards the alcove, and the
 * four LRUD ticks alone would not know. Falls back to the station
 * itself when there is nothing measured to average.
 *
 * \return {x, y, z}
 */
/**
 * The cross sections, flattened for the view.
 *
 * One closed loop per station, with the middle of each: the flight uses
 * the middles for its path and the view draws the loop nearest the
 * camera, so a caver flying the passage can see its shape around them.
 *
 * \param loftedLegs [[fromName, toName], ...] -- the legs that carry a
 *        surface, so the view can read the passage BETWEEN two
 *        stations and not only at them.
 *
 * \return {positions: [x,y,z...], counts: [n...], centres: [x,y,z...],
 *          names: [...], legs: [i, j, ...] pairs of indices into the
 *          loops above}
 */
CsMesh3d.outlineBuffer = function(sectionAt, loftedLegs) {
    var out = { positions: [], counts: [], centres: [], names: [],
                legs: [] };
    if (sectionAt === null || sectionAt === undefined) {
        return out;
    }
    var names = [];
    for (var name in sectionAt) {
        if (sectionAt.hasOwnProperty(name)) { names.push(name); }
    }
    // Sorted, so two runs over one cave hand back the same order.
    names.sort();
    for (var i = 0; i < names.length; i++) {
        var sec = sectionAt[names[i]];
        if (sec === null || sec === undefined) { continue; }
        var ring = sec.ring;
        if (ring === null || ring === undefined || ring.length < 3) {
            continue;
        }
        for (var r = 0; r < ring.length; r++) {
            out.positions.push(ring[r].x, ring[r].y, ring[r].z);
        }
        out.counts.push(ring.length);
        out.centres.push(sec.centre.x, sec.centre.y, sec.centre.z);
        out.names.push(names[i]);
    }

    // The legs, as index pairs. A leg whose either end kept no loop --
    // a station with fewer than three measured wall points -- is
    // dropped: there is nothing to interpolate between.
    var indexOf = {};
    for (var oi = 0; oi < out.names.length; oi++) {
        indexOf[out.names[oi]] = oi;
    }
    var legs = loftedLegs || [];
    for (var li = 0; li < legs.length; li++) {
        var a = indexOf[legs[li][0]];
        var b = indexOf[legs[li][1]];
        if (a === undefined || b === undefined || a === b) { continue; }
        out.legs.push(a, b);
    }
    return out;
};

CsMesh3d.ringCentre = function(station, ring) {
    if (ring === null || ring === undefined || ring.length === 0) {
        return { x: station.x, y: station.y, z: station.z };
    }
    var x = 0, y = 0, z = 0, n = 0;
    for (var i = 0; i < ring.length; i++) {
        var p = ring[i];
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) { continue; }
        x += p.x; y += p.y; z += p.z; n++;
    }
    if (n === 0) {
        return { x: station.x, y: station.y, z: station.z };
    }
    return { x: x / n, y: y / n, z: z / n };
};

CsMesh3d.stationLabels = function(resolved) {
    var out = { positions: [], names: [] };
    if (resolved === null || resolved === undefined ||
            resolved.stations === null || resolved.stations === undefined) {
        return out;
    }
    var names = [];
    for (var name in resolved.stations) {
        if (resolved.stations.hasOwnProperty(name)) { names.push(name); }
    }
    // Sorted, so the same cave hands back the same order every time and
    // a diff of two runs is about the cave rather than about hashing.
    names.sort();
    for (var i = 0; i < names.length; i++) {
        var st = resolved.stations[names[i]];
        if (st === null || st === undefined) { continue; }
        if (typeof st.x !== "number" || typeof st.y !== "number" ||
                typeof st.z !== "number") { continue; }
        if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.z)) { continue; }
        out.positions.push(st.x, st.y, st.z);
        out.names.push(String(names[i]));
    }
    return out;
};
