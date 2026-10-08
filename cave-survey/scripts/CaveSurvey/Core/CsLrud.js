// Lrud.js -- LRUD passage dimensions to wall geometry.
//
// Part of the Cave Survey Core library: pure functions.
//
// L and R are measured facing the direction of travel, at the TO
// station of the shot that recorded them. Right = azimuth + 90,
// Left = azimuth - 90. U and D are vertical and can't be drawn in
// plan; they become a text note.
//
// SPLAYS COUNT TOO. A splay tip is a measured wall hit -- the same
// kind of fact an LRUD number is, just aimed where the caver pointed
// -- so every splay from a station joins that station's wall points.
// Which side it joins comes from the sign of (splay azimuth - passage
// azimuth); where it sits within the side comes from its along-passage
// projection, so a backward splay lands before the station's LRUD tick
// and a forward one after it, and the wall advances instead of
// zigzagging. A splay lying exactly along the passage axis is on the
// centerline and belongs to neither wall. No steepness filter: a splay
// aimed at the ceiling contributes its (short) plan projection like
// any other, which is what "use every splay" means -- in a dome or a
// pit that pulls the wall in toward the station, and that is the data
// talking.
//
// Walls derived this way are PREVISUALIZATION: straight segments
// between measured points, never curves, because implying wall detail
// between stations that isn't in the data would misrepresent the
// passage (that's also why they belong on an "inferred" layer, drawn
// faint). Junction stations -- three or more non-splay shots meeting
// -- end a wall run rather than guessing across the junction.

var CsLrud = {};

/**
 * Endpoint of one LRUD tick. Returns {x, y} or null when the
 * measurement is null (not taken) or 0 (wall at the station -- the
 * wall point IS the station, but there is no tick to draw).
 *
 * \param side "L" or "R"
 */
CsLrud.tickEnd = function(station, azimuthDeg, side, length) {
    if (length === null || length === undefined) {
        return null;
    }
    if (length === 0) {
        // The wall passes through the station -- a real measurement,
        // not "nothing to draw". This used to be dead code (every
        // caller special-cased 0 before ever reaching here), which is
        // exactly how the docblock above and the behaviour drifted
        // apart; fixed at the source so a new caller gets it right by
        // just calling tickEnd instead of having to know to re-derive
        // this special case itself.
        return { x: station.x, y: station.y };
    }
    if (typeof azimuthDeg !== "number" || !isFinite(azimuthDeg)) {
        // NO BEARING, NO TICK. A measured length with nothing to aim
        // it along is not half a wall point, it is no wall point: the
        // only way to draw it would be to pick a direction, and the
        // one that used to get picked by default -- 0, straight north
        // -- is a wall the survey never saw. This sits BELOW the
        // zero-length branch on purpose: "the wall is at the station"
        // needs no direction to be true, and a pitch whose walls
        // really are at the rope is exactly where both cases meet.
        return null;
    }
    var perp = (side === "R") ? azimuthDeg + 90.0 : azimuthDeg - 90.0;
    var rad = perp * Math.PI / 180.0;
    return {
        x: station.x + length * Math.sin(rad),
        y: station.y + length * Math.cos(rad)
    };
};

/**
 * How many resolved, drawn legs touch each station -- the junction
 * test. Returns {stationName: count}.
 */
CsLrud.legCounts = function(legs) {
    var counts = {};
    var bump = function(n) {
        counts[n] = (counts[n] || 0) + 1;
    };
    for (var i = 0; i < legs.length; i++) {
        bump(legs[i].from);
        bump(legs[i].to);
    }
    return counts;
};

/**
 * Splays that may become wall points, grouped by their FROM station.
 * A splay kept out of the plot is kept out of the walls as well --
 * CsDraw does not draw its ray, and a wall must never be built from
 * geometry the map doesn't show.
 *
 * \return {stationName: [shot]} in survey order.
 */
CsLrud.splaysByStation = function(survey) {
    var map = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!s.splay || s.excludeFromAll || s.excludeFromPlot) {
            continue;
        }
        if (s.from === "") {
            continue;
        }
        if (!map.hasOwnProperty(s.from)) {
            map[s.from] = [];
        }
        map[s.from].push(s);
    }
    return map;
};

/** Signed angle from a to b in degrees, normalized to (-180, 180]. */
CsLrud.relativeBearing = function(a, b) {
    var d = (b - a) % 360.0;
    if (d <= -180.0) {
        d += 360.0;
    } else if (d > 180.0) {
        d -= 360.0;
    }
    return d;
};

// ---------------------------------------------------------------------
// PASSAGE AXES -- what the legs meeting at a station say about which way
// the passage runs there, and whether the station is really a junction.
//
// WHY THIS EXISTS. Counting legs is not the same question as "does the
// passage branch here". A loop tie-in has three legs -- the two that
// walk the passage through, plus the closure leg that arrives back
// along the SAME passage -- and a leg count calls that a junction, ends
// every wall run at it, and leaves a hole in the map at exactly the
// station a loop was closed on. Clustering the legs by DIRECTION says
// what a caver standing there would say: two ways out, not three, so
// the passage goes through.
//
// The same clustering answers the other half of the problem. LRUD is
// recorded facing the leg that ARRIVED, and a tie-in shot often cuts
// across the passage rather than running down it -- so its L/R ray
// points down open passage and the party writes "P". That "P" is a
// reading, not a gap: it says "no wall this way", and the wall either
// side of it is continuous. Knowing the passage's own axis (not the
// tie-in shot's) is what lets the splay ordering and the junction test
// agree with the cave instead of with the notebook's page order.
//
// WHAT THIS DELIBERATELY DOES NOT DO: re-aim the LRUD tick itself.
// `tickEnd` still swings L and R off `lrud.azimuth`, the bearing the
// caver actually faced when they pulled the tape. Swinging a measured
// length onto a bearing nobody sighted would move a wall point to a
// place the tape never touched -- inventing data, which is the one
// thing this whole file refuses to do. The axis informs which SIDE a
// splay is on, how points ORDER along the passage, whether a station
// BRANCHES, and which frame the 3D ring is squared to. It never
// changes a measured coordinate.

/**
 * An azimuth folded into [0, 360).
 *
 * The last line is not decoration. A bisector computed through atan2
 * lands a few parts in 1e16 either side of due north, and the negative
 * side folds to 359.99999999999994 -- arithmetically right, and a
 * number no caver would accept as a bearing if it ever reached a
 * dialog or a label. Anything that close to a full turn IS north.
 */
CsLrud.normalizeAz = function(deg) {
    if (deg === null || deg === undefined || !isFinite(deg)) {
        return null;
    }
    var d = deg % 360.0;
    if (d < 0.0) {
        d += 360.0;
    }
    if (d >= 360.0 - 1e-9) {
        return 0.0;
    }
    return d;
};

/**
 * Plan bearing from a to b in degrees, or null when the two points
 * coincide (no direction to report) or either is unusable.
 *
 * Matches tickEnd's convention: x is east, y is north, so the bearing
 * is atan2(dx, dy).
 */
CsLrud.planBearing = function(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) {
        return null;
    }
    var dx = b.x - a.x, dy = b.y - a.y;
    if (!isFinite(dx) || !isFinite(dy)) {
        return null;
    }
    if (Math.abs(dx) <= CsLrud.COINCIDENT_PLAN &&
            Math.abs(dy) <= CsLrud.COINCIDENT_PLAN) {
        return null;
    }
    return CsLrud.normalizeAz(Math.atan2(dx, dy) * 180.0 / Math.PI);
};

/**
 * Below this plan separation two stations are the SAME POINT as far as
 * a bearing is concerned, and there is no direction between them.
 *
 * THIS IS WHAT A PITCH LOOKS LIKE IN PLAN, and the test used to be
 * `dx === 0 && dy === 0`, which a pitch never satisfies. A plumbed leg
 * goes through `CsTraverse.offset`, where the plan projection is
 * `distance * cos(90 degrees)` -- and `Math.cos(Math.PI / 2)` is
 * 6.1e-17, not 0. So a 187 ft free-fall placed its lower station
 * 1.1e-14 ft to the north, `planBearing` divided that dust by itself,
 * and out came a confident bearing of 000 degrees.
 *
 * Every consequence of that was silent and wrong in the same
 * direction. `stationAxes` gained a way out at both ends of every
 * pitch, so a pit floor with one passage leaving it read as a THROUGH
 * station and took its passage axis from the bisector of the real
 * passage and a rounding error; a pit head with a passage and a drop
 * did the same; a shaft with two leads off the bottom read as a
 * three-way JUNCTION and broke its wall runs there. None of it could
 * show up in a horizontal cave, where no leg is ever steep enough for
 * the projection to collapse -- which is why it survived this long.
 *
 * 1e-6 in the survey's own distance unit: far above the ~1e-14 that
 * trigonometry leaves behind, far below any offset a tape and compass
 * can produce or a loop adjustment can shift a station by. A leg that
 * really does move a thousandth of a foot across the map still has a
 * bearing and still gets one.
 */
CsLrud.COINCIDENT_PLAN = 1e-6;

/**
 * How far apart two bearings may be and still be "the same way out".
 *
 * 30 degrees: wide enough that a closure leg arriving back down a
 * passage merges with the leg that walks it (survey shots down one
 * passage rarely disagree by more than that), narrow enough that a
 * side lead at 45 degrees still reads as its own way out.
 */
CsLrud.AXIS_TOLERANCE_DEG = 30.0;

/**
 * How near to opposite two ways out must be before the station counts
 * as a THROUGH station with a single passage axis. 120 degrees leaves
 * room for a real bend to still read as through-passage; anything
 * sharper is a corner, and a corner has no single axis to bisect.
 */
CsLrud.THROUGH_SEPARATION_DEG = 120.0;

/**
 * Groups bearings into distinct ways out.
 *
 * Greedy and order-dependent BY DESIGN: the first unclaimed bearing
 * seeds a cluster, every later bearing within `tol` of the cluster's
 * running circular mean joins it, and the mean is re-derived from the
 * members as it grows. Deterministic for a given input order, which is
 * all a wall run needs -- resolved.legs has a stable order, so a
 * drawing rebuilt from the same survey clusters identically.
 *
 * \return [{mean: azimuthDeg, count: n}] in seed order
 */
CsLrud.clusterBearings = function(bearings, tol) {
    if (tol === undefined || tol === null) {
        tol = CsLrud.AXIS_TOLERANCE_DEG;
    }
    var rad = Math.PI / 180.0;
    var taken = [];
    var out = [];
    var i, j;
    for (i = 0; i < bearings.length; i++) {
        taken.push(false);
    }
    for (i = 0; i < bearings.length; i++) {
        if (taken[i] || bearings[i] === null || bearings[i] === undefined) {
            continue;
        }
        taken[i] = true;
        var sx = Math.sin(bearings[i] * rad);
        var sy = Math.cos(bearings[i] * rad);
        var n = 1;
        var mean = bearings[i];
        for (j = i + 1; j < bearings.length; j++) {
            if (taken[j] || bearings[j] === null ||
                    bearings[j] === undefined) {
                continue;
            }
            if (Math.abs(CsLrud.relativeBearing(mean, bearings[j])) > tol) {
                continue;
            }
            taken[j] = true;
            sx += Math.sin(bearings[j] * rad);
            sy += Math.cos(bearings[j] * rad);
            n += 1;
            mean = CsLrud.normalizeAz(Math.atan2(sx, sy) * 180.0 / Math.PI);
        }
        out.push({ mean: mean, count: n });
    }
    return out;
};

/**
 * The ways out of every station, from the geometry the resolver placed
 * rather than from the shots' recorded bearings.
 *
 * READ FROM COORDINATES ON PURPOSE. A leg's own azimuth can be absent,
 * be a backsight, or have been adjusted by loop closure; the placed
 * stations are the single version of the cave every view already
 * agrees on, and a bearing derived from them cannot disagree with the
 * line the map draws. Every leg counts -- "new", "tie" AND "closure" --
 * because a closure leg is a surveyed passage like any other and is
 * exactly the leg that makes a tie-in look like a junction.
 *
 * \param resolved CsNetwork.resolve() result
 * \param tol      cluster width in degrees (AXIS_TOLERANCE_DEG)
 *
 * \return {stationName: {dirs: [{mean, count}], legs: n}}
 *         Stations whose legs all have zero length, and stations the
 *         resolver never placed, are absent -- a caller must treat a
 *         missing entry as "nothing known", never as "no ways out".
 */
CsLrud.stationAxes = function(resolved, tol) {
    var raw = {};
    var note = function(name, deg) {
        if (deg === null) {
            return;
        }
        if (!raw.hasOwnProperty(name)) {
            raw[name] = [];
        }
        raw[name].push(deg);
    };
    var legs = (resolved === null || resolved === undefined) ?
        [] : (resolved.legs || []);
    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        var f = CsLrud.planBearing(a, b);
        if (f === null) {
            continue;
        }
        // OUTWARD from each end: the direction a caver standing there
        // would point to leave along this leg.
        note(leg.from, f);
        note(leg.to, CsLrud.normalizeAz(f + 180.0));
    }
    var out = {};
    for (var name in raw) {
        if (raw.hasOwnProperty(name)) {
            out[name] = { dirs: CsLrud.clusterBearings(raw[name], tol),
                          legs: raw[name].length };
        }
    }
    return out;
};

/**
 * Does the passage BRANCH at this station -- three or more distinct
 * ways out?
 *
 * A station the axes do not know about answers false: absence of
 * geometry is not evidence of a junction, and a caller that wants the
 * old leg-count answer for such a station has to ask for it (wallRuns
 * does exactly that).
 */
CsLrud.isJunction = function(axes, name) {
    var a = (axes === null || axes === undefined) ? undefined : axes[name];
    if (a === undefined || a === null) {
        return false;
    }
    return a.dirs.length >= 3;
};

/**
 * The two opposite ways out of a THROUGH station, as indices into
 * `axes[name].dirs`, or null when the station is not one (a dead end,
 * a corner sharper than THROUGH_SEPARATION_DEG, or a junction).
 */
CsLrud.throughPair = function(axes, name) {
    var a = (axes === null || axes === undefined) ? undefined : axes[name];
    if (a === undefined || a === null || a.dirs.length !== 2) {
        return null;
    }
    var sep = Math.abs(CsLrud.relativeBearing(a.dirs[0].mean,
        a.dirs[1].mean));
    if (sep < CsLrud.THROUGH_SEPARATION_DEG) {
        return null;
    }
    return { a: 0, b: 1 };
};

/**
 * The bearing a station's L and R ticks are drawn along.
 *
 * ONE RULE, SHARED, because four callers need it and each of them
 * drawing a wall in a slightly different direction is not a bug anyone
 * would find by looking at one of them. In order of what the survey
 * actually knows:
 *
 *   1. the bearing the caver FACED when they pulled the tapes
 *      (`lrud.azimuth`), which is what L and R are perpendicular to;
 *   2. failing that -- a pitch, where there was no bearing to face and
 *      CsModel.lrudForStation hands on null rather than the compass
 *      column's formality -- the direction the PASSAGE runs, which at
 *      the foot of a drop is what the caver was measuring across
 *      anyway;
 *   3. failing that too, null, and the tick is not drawn. A measured
 *      length aimed in a direction nobody knows is not half a wall
 *      point.
 *
 * \param lrud      CsModel.lrudForStation result, or null
 * \param passageAz CsLrud.passageAzimuthAt for the same station, or
 *                  null/undefined when it is unknown
 * \return degrees, or null
 */
CsLrud.tickAzimuth = function(lrud, passageAz) {
    if (lrud !== null && lrud !== undefined &&
            typeof lrud.azimuth === "number" && isFinite(lrud.azimuth)) {
        return lrud.azimuth;
    }
    if (typeof passageAz === "number" && isFinite(passageAz)) {
        return passageAz;
    }
    return null;
};

/**
 * The passage direction at the OTHER END of the pitch this station
 * hangs on, for a station that has no direction of its own.
 *
 * A blind shaft -- an aven climbed to a dead end, a pit dropped to a
 * floor with nothing leading off it -- gives its far station no way
 * out at all: the only leg touching it is plumb, and a plumb has no
 * plan bearing (CsLrud.planBearing). The caver still measured L and R
 * up there, and refusing to draw them costs the drawing the one width
 * it has for the top of the aven or the bottom of the pit.
 *
 * What they were facing is not recorded and cannot be. What is known
 * is that they arrived from the station at the other end of the rope,
 * in a passage running some direction, and turned round or looked up.
 * Using that passage's direction is a CONVENTION, and it is the only
 * one available that is not a guess at a compass bearing: it keeps the
 * blind end's walls parallel to the passage that leads to it, which is
 * what a caver drawing the same sketch by hand would do.
 *
 * Only a PLUMB leg is followed. A station reached by an ordinary leg
 * has a way out of its own and never gets here.
 */
CsLrud.acrossPitchAzimuth = function(axes, resolved, name) {
    if (resolved === null || resolved === undefined || !resolved.legs) {
        return null;
    }
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        var other = null;
        if (leg.from === name) {
            other = leg.to;
        } else if (leg.to === name) {
            other = leg.from;
        } else {
            continue;
        }
        if (!CsTraverse.isPlumb(leg.shot)) {
            continue;
        }
        var az = CsLrud.passageAzimuthAt(axes, other, null);
        if (typeof az === "number" && isFinite(az)) {
            return az;
        }
    }
    return null;
};

/**
 * tickAzimuth for a caller that has the axes rather than the angle.
 *
 * `resolved` is optional and only consulted for the blind-shaft case
 * above -- a station whose only leg is a pitch. Callers that have it
 * should pass it: without it, the top of an aven and the bottom of a
 * blind pit draw with no width.
 */
CsLrud.tickAzimuthAt = function(axes, name, lrud, resolved) {
    var az = CsLrud.tickAzimuth(lrud,
        CsLrud.passageAzimuthAt(axes, name, null));
    if (az !== null) {
        return az;
    }
    return CsLrud.acrossPitchAzimuth(axes, resolved, name);
};

/**
 * The direction the PASSAGE runs at a station, which is not always the
 * direction of the leg that arrived there.
 *
 * At a through station the axis is the bisector of the two ways out --
 * so a tie-in shot cutting across the passage no longer decides which
 * side a splay is on or how points order along the wall. Anywhere else
 * (dead end, corner, junction, unknown station) the arriving leg's own
 * bearing is the best answer there is, and is returned unchanged.
 *
 * The result is oriented to agree with travel: whichever way round the
 * bisector points, it is flipped if need be so it leads AWAY from the
 * station the caver came from. When `arrivalAz` is not a usable number
 * the bisector is returned in its own arbitrary-but-deterministic
 * orientation rather than nothing -- a defined axis with an unknown
 * sign still orders points consistently along one wall.
 */
CsLrud.passageAzimuthAt = function(axes, name, arrivalAz) {
    var pair = CsLrud.throughPair(axes, name);
    if (pair === null) {
        // Not a through station, so there is no bisector to take. If
        // the ARRIVING leg could not supply a bearing either -- which
        // is what a station at the foot of a pitch looks like, the
        // caver having come down a rope with nothing to sight along --
        // then a station with exactly ONE way out still answers the
        // question: that way out is where the passage goes, and it is
        // the direction the caver was facing when they pulled the
        // tapes. Better than the alternative in both directions: not
        // null (which costs the station its walls) and certainly not a
        // fallback bearing of north.
        if (arrivalAz === null || arrivalAz === undefined ||
                !isFinite(arrivalAz)) {
            var only = (axes === null || axes === undefined) ?
                undefined : axes[name];
            if (only !== undefined && only !== null &&
                    only.dirs.length === 1) {
                return only.dirs[0].mean;
            }
        }
        return arrivalAz;
    }
    var dirs = axes[name].dirs;
    var rad = Math.PI / 180.0;
    var u0 = { x: Math.sin(dirs[pair.a].mean * rad),
               y: Math.cos(dirs[pair.a].mean * rad) };
    var u1 = { x: Math.sin(dirs[pair.b].mean * rad),
               y: Math.cos(dirs[pair.b].mean * rad) };
    // Bisector of "away from one way out" and "toward the other" --
    // for two near-opposite bearings that is the passage's own line.
    var fx = u1.x - u0.x, fy = u1.y - u0.y;
    if (fx === 0.0 && fy === 0.0) {
        return arrivalAz;
    }
    var axis = CsLrud.normalizeAz(Math.atan2(fx, fy) * 180.0 / Math.PI);
    if (arrivalAz === null || arrivalAz === undefined ||
            !isFinite(arrivalAz)) {
        return axis;
    }
    if (Math.abs(CsLrud.relativeBearing(arrivalAz, axis)) > 90.0) {
        axis = CsLrud.normalizeAz(axis + 180.0);
    }
    return axis;
};

/**
 * Which of a station's ways out a bearing belongs to -- the index into
 * `axes[name].dirs` of the nearest cluster, or -1 when the station is
 * unknown or the bearing unusable.
 *
 * Lets a caller fold several legs that all leave the same way (a
 * closure leg alongside the leg it closes onto, say) down to one,
 * without re-deriving the clustering itself.
 */
CsLrud.nearestCluster = function(axes, name, bearing) {
    var a = (axes === null || axes === undefined) ? undefined : axes[name];
    if (a === undefined || a === null) {
        return -1;
    }
    if (bearing === null || bearing === undefined || !isFinite(bearing)) {
        return -1;
    }
    var best = -1, bestD = null;
    for (var i = 0; i < a.dirs.length; i++) {
        var d = Math.abs(CsLrud.relativeBearing(a.dirs[i].mean, bearing));
        if (bestD === null || d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
};

/** Was this side of the station written "P" (open passage)? */
CsLrud.sideOpen = function(lrud, side) {
    if (lrud === null || lrud === undefined) {
        return false;
    }
    return (side === "L") ? (lrud.leftOpen === true) :
                            (lrud.rightOpen === true);
};

/**
 * Did the party record ANYTHING about this station's walls in plan --
 * a length either side, or a "P" saying there is no wall that way?
 *
 * "P" counts. That is the whole point: a station read "P P" was looked
 * at and found open, which is evidence, and treating it as an
 * unmeasured station is what used to end a wall run at every loop
 * tie-in. CsFrontier.hasLrud has read it this way for some time; this
 * is the same rule reaching the walls.
 */
CsLrud.hasPlanEvidence = function(lrud) {
    if (lrud === null || lrud === undefined) {
        return false;
    }
    return (lrud.left !== null && lrud.left !== undefined) ||
           (lrud.right !== null && lrud.right !== undefined) ||
           lrud.leftOpen === true || lrud.rightOpen === true;
};


/**
 * One station's wall points on one side, in along-passage order.
 *
 * The station's LRUD tick (where measured) and every splay that falls
 * on this side, sorted by how far along the passage direction each
 * one sits. Ties keep their input order, LRUD tick first.
 *
 * \param st        resolved station {x, y}
 * \param passageAz azimuth of the leg that reached the station (deg)
 * \param lrud      CsModel.lrudForStation result, or null
 * \param splays    [shot] from this station, or undefined
 * \param side      "L" or "R"
 * \param tapeMode  CsTraverse.SLOPE (default) or HORIZONTAL
 * \param stats     optional {skipped: n} accumulator: bumped once per
 *                  splay this call could not place (see below) so a
 *                  caller can report the gap instead of it vanishing
 *                  silently into an empty return
 *
 * \return [{x, y}] -- possibly empty
 */
CsLrud.stationWallPoints = function(st, passageAz, lrud, splays, side,
        tapeMode, stats) {
    var entries = [];

    if (lrud !== null && lrud !== undefined) {
        var len = (side === "L") ? lrud.left : lrud.right;
        // tickEnd itself now returns a point AT the station for 0 and
        // null for not-measured/open ("P") -- see its own docblock.
        //
        // The tick swings off the bearing the caver FACED wherever
        // there was one; where there was not (a pitch -- see
        // CsModel.lrudForStation, which hands on null rather than a
        // near-vertical compass sight), it swings off the passage
        // direction instead. That is the one substitution this
        // codebase allows itself, and it is not an invention: at the
        // foot of a drop the caver measures L and R across the passage
        // they are about to walk, which is exactly what `passageAz`
        // names. If even that is unknown, tickEnd draws nothing.
        var p = CsLrud.tickEnd(st, CsLrud.tickAzimuth(lrud, passageAz),
            side, len);
        if (p !== null) {
            // the tick is perpendicular to the passage, so it sits
            // at along-passage 0 and leads its ties
            entries.push({ p: p, t: 0.0, order: -1 });
        }
    }

    if (splays !== undefined && splays !== null) {
        var azRad = passageAz * Math.PI / 180.0;
        var alongX = Math.sin(azRad), alongY = Math.cos(azRad);
        for (var i = 0; i < splays.length; i++) {
            var sp = splays[i];
            var rel = CsLrud.relativeBearing(passageAz,
                CsTraverse.effectiveAzimuth(sp));
            // exactly along the axis: on the centerline, neither wall
            if (rel === 0.0 || rel === 180.0 || rel === -180.0) {
                continue;
            }
            var onRight = (rel > 0.0);
            if ((side === "R") !== onRight) {
                continue;
            }
            var o = CsTraverse.offset(sp, tapeMode);
            if (o === null) {
                // no distance or no inclination/azimuth on record: a
                // wall point at the station would assert "the wall is
                // exactly here" for a measurement nobody took, so this
                // splay contributes NOTHING rather than a fabricated
                // point (see CsTraverse.offset's own docblock -- 0
                // IS a measurement and is never skipped here; this
                // branch is only ever null, absent, non-finite input)
                if (stats !== undefined && stats !== null) {
                    stats.skipped++;
                }
                continue;
            }
            entries.push({
                p: { x: st.x + o.dx, y: st.y + o.dy },
                t: o.dx * alongX + o.dy * alongY,
                order: i
            });
        }
    }

    // stable by along-passage distance -- comparing order on ties
    // rather than trusting the engine's sort to be stable
    entries.sort(function(a, b) {
        if (a.t < b.t) { return -1; }
        if (a.t > b.t) { return 1; }
        return a.order - b.order;
    });

    var out = [];
    for (i = 0; i < entries.length; i++) {
        out.push(entries[i].p);
    }
    return out;
};

/**
 * The 3D sibling of stationWallPoints: the SAME measured wall points,
 * with the elevation kept.
 *
 * The 2D function drops dz because the plan view has no use for it.
 * That is correct there and wrong for a cross section, which is exactly
 * the view that needs it. Side assignment, the dead zone, the ordering
 * and the stats accounting are all the 2D function's -- this differs in
 * what it KEEPS, not in what it decides. Keep the two in step: a rule
 * changed in one and not the other is a section that disagrees with the
 * plan about which wall a splay hit.
 *
 * \return [{x, y, z}] in along-passage order, possibly empty
 */
CsLrud.stationWallPoints3D = function(st, passageAz, lrud, splays, side,
        tapeMode, stats) {
    var entries = [];
    var z0 = (st.z === undefined || st.z === null) ? 0 : st.z;
    var i;

    if (lrud !== null && lrud !== undefined) {
        var len = (side === "L") ? lrud.left : lrud.right;
        // tickEnd itself now returns a point AT the station for 0 and
        // null for not-measured/open ("P") -- see its own docblock.
        // The tick's bearing falls back to the passage direction where
        // no bearing was sighted, exactly as the 2D twin above does;
        // keeping the two in step is the whole point of this pair.
        var p = CsLrud.tickEnd(st, CsLrud.tickAzimuth(lrud, passageAz),
            side, len);
        if (p !== null) {
            // L and R are measured horizontally, so they sit at the
            // station's own elevation. `atStation` is carried through
            // to the raw point so CsSectionCut.polygonAt can tell a
            // genuine zero-radius wall vertex apart from an unrelated
            // splay that happened to land dead-center -- see its own
            // comment at the filter that reads this.
            entries.push({ p: { x: p.x, y: p.y, z: z0,
                                 atStation: (len === 0) },
                           t: 0.0, order: -1 });
        }
    }

    if (splays !== undefined && splays !== null) {
        var azRad = passageAz * Math.PI / 180.0;
        var alongX = Math.sin(azRad), alongY = Math.cos(azRad);
        for (i = 0; i < splays.length; i++) {
            var sp = splays[i];
            var rel = CsLrud.relativeBearing(passageAz,
                CsTraverse.effectiveAzimuth(sp));
            // exactly along the axis: on the centerline, neither wall
            if (rel === 0.0 || rel === 180.0 || rel === -180.0) {
                continue;
            }
            var onRight = (rel > 0.0);
            if ((side === "R") !== onRight) {
                continue;
            }
            var o = CsTraverse.offset(sp, tapeMode);
            if (o === null) {
                // as in the 2D sibling: a splay with nothing on record
                // contributes NOTHING rather than a fabricated point
                if (stats !== undefined && stats !== null) {
                    stats.skipped++;
                }
                continue;
            }
            // THE WHOLE POINT OF THIS FUNCTION: dz is kept.
            entries.push({
                p: { x: st.x + o.dx, y: st.y + o.dy, z: z0 + o.dz },
                t: o.dx * alongX + o.dy * alongY,
                order: i
            });
        }
    }

    entries.sort(function(a, b) {
        if (a.t < b.t) { return -1; }
        if (a.t > b.t) { return 1; }
        return a.order - b.order;
    });

    var out = [];
    for (i = 0; i < entries.length; i++) {
        out.push(entries[i].p);
    }
    return out;
};

/**
 * The ceiling and floor points a station's U and D give, in 3D.
 *
 * null for a side with no measurement -- NOT a point at the station,
 * which would assert a wall nobody measured. 0 IS a measurement: the
 * ceiling is at the station.
 */
CsLrud.stationCeilingFloor3D = function(st, lrud) {
    var z0 = (st.z === undefined || st.z === null) ? 0 : st.z;
    var out = { ceiling: null, floor: null };
    if (lrud === null || lrud === undefined) {
        return out;
    }
    if (lrud.up !== null && lrud.up !== undefined) {
        out.ceiling = { x: st.x, y: st.y, z: z0 + lrud.up,
                         atStation: (lrud.up === 0) };
    }
    if (lrud.down !== null && lrud.down !== undefined) {
        out.floor = { x: st.x, y: st.y, z: z0 - lrud.down,
                       atStation: (lrud.down === 0) };
    }
    return out;
};

/** The station a survey starts from: the `from` of its first real
 *  shot -- the one station no shot arrives at. */
CsLrud.firstStationOf = function(survey) {
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
 * Every station whose walls live in a start-LRUD rather than on a
 * shot, as {stationName: lrud}.
 *
 * One entry per trip that begins at a station nothing arrives at,
 * plus the survey-level startLrud for the cave's own first station.
 * A trip that begins at a station an earlier trip already reached is
 * NOT in here: that station's walls are on the shot that arrived,
 * which is the measurement taken facing the passage rather than a
 * page's opening row.
 */
CsLrud.startLruds = function(survey) {
    var out = {};
    if (survey === null || survey === undefined ||
            survey.shots === undefined) {
        return out;
    }
    // Which stations are ARRIVED at: those have their walls on a shot.
    var arrived = {};
    var i;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay !== true && !s.excludeFromAll && s.to !== "") {
            arrived[s.to] = true;
        }
    }
    // The first station of each trip, in the survey's own order.
    var firstOfTrip = {};
    for (i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        if (sh.splay === true || sh.excludeFromAll || sh.from === "") {
            continue;
        }
        var trip = (typeof sh.trip === "number") ? sh.trip : 0;
        if (firstOfTrip[trip] === undefined) {
            firstOfTrip[trip] = sh.from;
        }
    }
    var take = function(name, lrud) {
        if (name === undefined || name === null || name === "" ||
                lrud === null || lrud === undefined ||
                arrived[name] === true || out.hasOwnProperty(name)) {
            return;
        }
        out[name] = lrud;
    };
    // The survey's own, first: it is the entrance's, and on a cave
    // whose trips carry none it is the only one there is.
    take(CsLrud.firstStationOf(survey), survey.startLrud);
    if (Object.prototype.toString.call(survey.trips) === "[object Array]") {
        for (var t = 0; t < survey.trips.length; t++) {
            var tp = survey.trips[t];
            if (tp === null || tp === undefined) {
                continue;
            }
            take(firstOfTrip[t], tp.startLrud);
        }
    }
    return out;
};

/**
 * Wall polylines for a resolved survey.
 *
 * Walks the legs in resolution order, collecting each side's wall
 * points -- the station's LRUD tick end (or the station itself where
 * a side reads 0) plus every splay that hit that side. A run breaks
 * where the passage BRANCHES (three or more distinct ways out, by
 * CsLrud.stationAxes -- not three or more legs, see below), at a
 * station with NO wall evidence at all, at a closure leg, at the
 * mouth of a surveyed lead on an open side, and where the next leg
 * does not continue from the previous one's arrival -- each break
 * starts a new polyline rather than inventing a connection.
 *
 * WHAT IS NOT A BREAK, AND USED TO BE:
 *
 *   A LOOP TIE-IN. Three legs meet there -- the two that walk the
 *   passage through and the closure leg arriving back down it -- and
 *   counting legs called that a junction, so every wall run ended at
 *   exactly the station a loop was closed on. The ways out are
 *   clustered by direction now, the closure leg merges with the leg it
 *   runs alongside, and the walls go through.
 *
 *   A SIDE WRITTEN "P". Open passage is a READING -- the party looked
 *   and found no wall that way -- not a blank cell. It contributes no
 *   wall point, because there is no wall to put one on, but the run
 *   carries through the station and joins the last measured point to
 *   the next one. LRUD walls are continuous; "P" says where the wall
 *   is absent, not where the drawing should stop.
 *
 * WHY BRIDGING AN OPEN SIDE CANNOT SEAL A LEAD OFF, which is the one
 * thing that could go wrong with the paragraph above. Joining the
 * points either side of an open side would be wrong if the side were
 * open BECAUSE a passage leaves there -- the bridge would draw a wall
 * across its mouth. It cannot happen: a lead that was surveyed has a
 * leg going down it, a leg going down it is a third way out, and a
 * third way out is a junction, which ends both runs before any of this
 * is reached. A lead that was NOT surveyed leaves no trace in the data
 * at all, and no rule here or anywhere else can find what was never
 * recorded. (An earlier draft carried a separate perpendicular-leg
 * test for this. Every station it could fire on was already a junction
 * by the line above, so it was dead code dressed as a safety rule --
 * which is worse than no rule, because it reads like the hazard is
 * being handled somewhere it is not. The profile's own version of the
 * check is NOT dead and stays: a pitch is plumb, has no plan bearing,
 * and so never shows up as a way out -- see CsProfile.bandWallRuns.)
 *
 * Neither of these invents a coordinate. Every point in every run is
 * still a measured tick end or a splay tip; what changed is only which
 * of them are joined to which.
 *
 * THAT LAST BREAK EXISTS BECAUSE "resolution order" is not "walk
 * order". resolved.legs can place a junction station's arrival, then
 * immediately place ONE branch off it end-to-end, then place a SECOND
 * branch off the SAME junction station next -- both branches' legs
 * have their `from` at the junction, so nothing about them looks
 * wrong individually. Without this check, the second branch's first
 * leg lands right after the first branch's last point in the SAME
 * open buffer (nothing had flushed it), so one polyline would jump
 * straight from one branch's far end to the other branch's near end
 * -- a wall segment crossing open cave that was never surveyed. This
 * was reachable only where a junction's branches both carried wall
 * evidence starting at the very next station; every fixture that
 * predates this fix happens to separate branches with a no-evidence
 * station, which already flushes for an unrelated reason and hid the
 * gap.
 *
 * \param survey   the CsModel survey (for LRUD and splay lookup)
 * \param resolved CsNetwork.resolve() result
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL -- how the
 *                 splay tapes are read, matching what CsDraw plots
 *
 * \return {left: [{points:[{x,y}], stations:[name]}],
 *          right: [{points:[{x,y}], stations:[name]}], skipped: n}
 *
 *         Each run pairs its points with the station names it was
 *         built from, IN THE SAME OBJECT -- not two same-indexed arrays
 *         (`points`/`stations` alongside `left`/`right`). A caller that
 *         reads `left[i]` and `stations[i]` has to trust two counters
 *         stay in lockstep across every flush(); a caller that reads
 *         `left[i].stations` cannot get that pairing wrong, because
 *         there is only ever one array to index into. That is the
 *         whole reason this task exists (a `WallRunStations` tag that
 *         quietly stopped matching the run it was written on), so the
 *         return shape is chosen to make the same class of mistake
 *         impossible here, at the one call site that pays for it
 *         (`CsDraw.survey`) and in every test in `tests/js_unit.js`
 *         that reads this return, which is where nearly all of the
 *         cost landed.
 *
 *         `stations` lists the run's OWN arrival stations, in run
 *         order, deduplicated, and only for a station that actually
 *         contributed at least one point on THAT side -- a station
 *         with an LRUD tick on the left but nothing on the right
 *         appears in that run's `left[].stations` and not in the
 *         matching `right` run. Runs shorter than 2 points are dropped
 *         (as before), and `skipped` is unchanged: the count of splays
 *         that had no usable distance/azimuth/inclination and so
 *         contributed no wall point at all.
 */
CsLrud.wallRuns = function(survey, resolved, tapeMode) {
    if (tapeMode === undefined || tapeMode === null) {
        tapeMode = CsTraverse.SLOPE;
    }
    var counts = CsLrud.legCounts(resolved.legs);
    var axes = CsLrud.stationAxes(resolved);
    var splays = CsLrud.splaysByStation(survey);

    // WHERE THE PASSAGE REALLY BRANCHES -- three or more distinct ways
    // out, not three or more legs. A loop tie-in has a closure leg
    // arriving back down the passage it already walks; by leg count
    // that is a junction and every wall run used to end there, leaving
    // a hole in the map at exactly the station a loop was closed on.
    // By direction it is two ways out, and the walls go through.
    //
    // The leg count is still the answer for a station the axes never
    // saw (never placed, or every leg zero-length): there is no
    // geometry to cluster there, so the old test is the only evidence
    // left rather than a silent "not a junction".
    var isJunction = function(n) {
        if (axes.hasOwnProperty(n)) {
            return CsLrud.isJunction(axes, n);
        }
        return counts[n] > 2;
    };
    var leftRuns = [], rightRuns = [];
    var left = [], right = [];
    var leftNames = [], leftSeen = {};
    var rightNames = [], rightSeen = {};
    var stats = { skipped: 0 };

    // PER SIDE, because the two walls do not always end together. An
    // open ("P") side that is the mouth of a surveyed lead must stop
    // there rather than being bridged across the lead, while the other
    // wall of the same passage carries straight on past it. flush()
    // (both at once) is still what a junction, a closure and a station
    // with no wall evidence at all use.
    var flushLeft = function() {
        if (left.length >= 2) {
            leftRuns.push({ points: left, stations: leftNames });
        }
        left = [];
        leftNames = [];
        leftSeen = {};
    };
    var flushRight = function() {
        if (right.length >= 2) {
            rightRuns.push({ points: right, stations: rightNames });
        }
        right = [];
        rightNames = [];
        rightSeen = {};
    };
    var flush = function() {
        flushLeft();
        flushRight();
    };

    var pointsFor = function(stationName, side, lrud, passageAz) {
        var st = resolved.stations[stationName];
        if (st === undefined) {
            return [];
        }
        return CsLrud.stationWallPoints(st, passageAz, lrud,
            splays[stationName], side, tapeMode, stats);
    };

    // Records `stationName` against the run currently being built, for
    // whichever side just received a point -- the station whose points
    // are being appended is known right here, which is what lets the
    // name and the point travel together instead of being reconciled
    // afterwards.
    var append = function(target, pts, names, seen, stationName) {
        if (pts.length === 0) {
            return;
        }
        for (var k = 0; k < pts.length; k++) {
            target.push(pts[k]);
        }
        if (seen[stationName] !== true) {
            seen[stationName] = true;
            names.push(stationName);
        }
    };

    // The very first station: no shot arrives at it, so lrudForStation
    // cannot see it -- its LRUD lives in survey.startLrud, oriented by
    // the leg that leaves it (the same rule CsDraw.survey uses for its
    // tick).
    var startLruds = CsLrud.startLruds(survey);

    // Wall evidence at the station a run BEGINS at. Every other station
    // enters the walk as some leg's arrival (leg.to below); the station
    // that OPENS a run never does, so without this the survey's first
    // wall segment starts one station late -- A1's tick and splays were
    // simply never visited. A junction still ends runs rather than
    // seeding them.
    var seedRunStart = function(leg) {
        var name = leg.from;
        if (isJunction(name)) {
            return;
        }
        var passageAz = CsLrud.passageAzimuthAt(axes, name,
            CsTraverse.effectiveAzimuth(leg.shot));
        var lrud = CsModel.lrudForStation(survey, name);
        // EVERY TRIP'S START, not only the survey's. startLruds pairs
        // each trip's opening row with the station that trip begins
        // at; before it this asked only about firstFrom, so a trip
        // surveyed outward from a new station -- which is what
        // starting a branch looks like -- lost the walls typed on its
        // first row, in the plan exactly as in the 3D tube.
        if ((lrud === null || lrud === undefined) &&
                startLruds.hasOwnProperty(name)) {
            var sLr = startLruds[name];
            lrud = {
                left: sLr.left,
                right: sLr.right,
                up: sLr.up,
                down: sLr.down,
                leftAll: sLr.leftAll || null,
                rightAll: sLr.rightAll || null,
                upAll: sLr.upAll || null,
                downAll: sLr.downAll || null,
                // THE OPEN FLAGS TRAVEL TOO. Without them the survey's
                // first station could be read "P P" -- looked at,
                // found open -- and still arrive here looking exactly
                // like a station nobody measured, which is the very
                // confusion the rest of this function now refuses to
                // make.
                leftOpen: sLr.leftOpen === true,
                rightOpen: sLr.rightOpen === true,
                upOpen: sLr.upOpen === true,
                downOpen: sLr.downOpen === true,
                // The tick swings off the bearing the caver FACED, not
                // off the derived axis -- see the PASSAGE AXES note
                // above for why a measured length is never re-aimed.
                azimuth: CsTraverse.effectiveAzimuth(leg.shot)
            };
        }
        append(left, pointsFor(name, "L", lrud, passageAz),
            leftNames, leftSeen, name);
        append(right, pointsFor(name, "R", lrud, passageAz),
            rightNames, rightSeen, name);
    };

    // The arrival station of the previous leg walked into the CURRENT
    // buffer (not the run's start, and not touched by a flush() that
    // happened for junction/no-evidence reasons within the same leg --
    // see below). null before the first leg and right after a closure,
    // where there is no "previous arrival" a next leg owes continuity
    // to.
    var prevTo = null;

    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            flush();
            prevTo = null;
            continue;
        }
        var opensRun = (prevTo === null);
        if (prevTo !== null && leg.from !== prevTo) {
            // This leg does not continue from where the buffered run
            // left off -- e.g. a second branch off the same junction
            // station, walked right after the first branch finished
            // in resolution order. Whatever is buffered is a real,
            // continuous run; what is about to be appended is not
            // part of it.
            flush();
            opensRun = true;
        }
        if (opensRun) {
            seedRunStart(leg);
        }
        // The leg reached a new station (leg.to for forward legs).
        var name = leg.to;
        var lrud = CsModel.lrudForStation(survey, name);
        // The passage direction at that station. Two bearings are in
        // play and they are NOT the same thing:
        //
        //   arrivalAz  the bearing of the leg that reached the station
        //              -- what the caver faced, and so what the L and
        //              R tapes were pulled perpendicular to.
        //   passageAz  the direction the PASSAGE runs, which at a
        //              through station is the bisector of its two ways
        //              out. At a tie-in, whose shot often cuts across
        //              the passage rather than down it, these differ by
        //              a lot.
        //
        // passageAz decides which SIDE a splay is on and how the
        // points ORDER along the wall; arrivalAz stays inside
        // `lrud.azimuth` and keeps aiming the measured tick. Swapping
        // that round would swing a measured length onto a bearing
        // nobody sighted.
        //
        // DECLARED DIVERGENCE FROM CsProfile.bandWallRuns (review
        // minor), now narrower than it was: where this leg's own
        // azimuth is unusable AND the station is not a through station,
        // `passageAz` is still null or NaN and nothing below guards
        // against it. `azRad` then quietly becomes 0 (null coerces) or
        // NaN, so `alongX`/`alongY` become a wrong-but-finite direction
        // or NaN. NO COORDINATE is ever wrong from this: every point in
        // `entries` comes from `CsTraverse.offset`/`CsLrud.tickEnd`
        // directly, never from `passageAz`, and the sort's `order`
        // tiebreak is a total order, so a NaN `t` only ever falls back
        // to input order. What breaks is the along-passage ORDERING
        // promise, silently. A through station now recovers on its own
        // (passageAzimuthAt returns the bisector, whose sign is
        // arbitrary but whose line is right); everywhere else this is
        // still unreachable today and still belongs to whichever task
        // first makes it reachable.
        var arrivalAz = CsTraverse.effectiveAzimuth(leg.shot);
        var passageAz = CsLrud.passageAzimuthAt(axes, name, arrivalAz);

        var lp = pointsFor(name, "L", lrud, passageAz);
        var rp = pointsFor(name, "R", lrud, passageAz);

        if (isJunction(name)) {
            // The passage branches here: close out the runs. A
            // junction station's own points still terminate them.
            append(left, lp, leftNames, leftSeen, name);
            append(right, rp, rightNames, rightSeen, name);
            flush();
            prevTo = name;
            continue;
        }

        if (lp.length === 0 && rp.length === 0 &&
                !CsLrud.hasPlanEvidence(lrud)) {
            // Nothing measured about this station's walls at all --
            // no length, no splay, and no "P". THE "P" IS THE WHOLE
            // POINT OF THIS TEST: a side written "P" yields no wall
            // point (there is no wall to put one on) but it is a
            // reading, so the run carries through it and joins the
            // last measured point to the next one. Before this, a
            // station read "P P" was indistinguishable from one nobody
            // looked at, and the wall simply stopped.
            flush();
            prevTo = name;
            continue;
        }

        append(left, lp, leftNames, leftSeen, name);
        append(right, rp, rightNames, rightSeen, name);
        prevTo = name;
    }
    flush();

    return { left: leftRuns, right: rightRuns, skipped: stats.skipped };
};
