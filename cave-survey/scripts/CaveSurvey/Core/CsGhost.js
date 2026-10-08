// CsGhost.js -- the shapes a page of notes WOULD draw, before it does.
//
// Part of the Cave Survey Core library. Pure ES5 apart from its call
// into CsLrud, so tests/js_unit.js runs all of it under node.
//
// WHAT THIS IS FOR. The Survey Notebook's status line has always said
// what a page adds up to -- length, depth, grade, closures -- and a
// caver typing a trip in from a wet notebook is reading numbers to
// find out whether they typed the numbers right. Numbers are a poor
// answer to that: a transposed azimuth reads as a plausible bearing,
// and a distance entered in metres on a page of feet reads as a
// plausible distance. Both of them look obviously wrong the moment the
// passage is drawn.
//
// So the page is drawn, continuously, as a GHOST over the map: shot
// lines, the walls the LRUD makes, and where loop closure has moved
// things -- and Draw remains the only thing that writes an entity
// (Nathan, 2026-09-19: "when writing in Notebook, give live preview of
// every measurement, and Draw only commits").
//
// THIS FILE COMPUTES GEOMETRY AND NOTHING ELSE. It answers plain
// {x, y} points; turning those into preview shapes on a view belongs
// to the panel, which is the only part that needs a Q* class. That
// split is what lets the hard part -- which segment goes where, and
// which ones exist at all -- be tested without a window.
//
// IT IS FED THE SAME `resolved` DRAW USES. Not a second, simpler
// resolve of its own: a preview that solves the survey differently
// from the thing it is previewing is worse than no preview, because it
// is wrong in exactly the cases a caver is looking at it to catch. The
// Notebook hands this the output of the same CsAdjust.resolveAndAdjust
// call, under the same anchor, that Draw will make.

var CsGhost = {};

/** True for a shot that draws a line between two stations. */
CsGhost.isDrawable = function(shot) {
    if (shot === undefined || shot === null) { return false; }
    if (shot.excludeFromAll === true) { return false; }
    var from = String(shot.from === undefined || shot.from === null ?
        "" : shot.from);
    var to = String(shot.to === undefined || shot.to === null ?
        "" : shot.to);
    return from !== "" && to !== "" && from !== to;
};

/** The adjusted position of a station, or null when the network could
 *  not place it (a shot off an unknown station, half-typed names). */
CsGhost.at = function(resolved, name) {
    if (resolved === null || resolved === undefined ||
            resolved.stations === undefined ||
            resolved.stations === null) {
        return null;
    }
    var st = resolved.stations[name];
    if (st === undefined || st === null ||
            typeof st.x !== "number" || typeof st.y !== "number" ||
            isNaN(st.x) || isNaN(st.y)) {
        return null;
    }
    return st;
};

/**
 * Where a station sat BEFORE loop closure moved it.
 *
 * The adjustment records a per-station shift, so the as-surveyed
 * position is the adjusted one with that shift taken back off -- no
 * second solve, and no chance of the two disagreeing about anything
 * except the adjustment itself, which is the whole point of drawing
 * them together.
 *
 * \return {x, y} or null when this station did not move (in which case
 *         there is nothing to draw: the two lines would coincide).
 */
CsGhost.beforeAdjustment = function(resolved, name) {
    var st = CsGhost.at(resolved, name);
    if (st === null) {
        return null;
    }
    if (resolved.shifts === undefined || resolved.shifts === null) {
        return null;
    }
    var shift = resolved.shifts[name];
    if (shift === undefined || shift === null) {
        return null;
    }
    var dx = (typeof shift.dx === "number" && !isNaN(shift.dx)) ?
        shift.dx : 0.0;
    var dy = (typeof shift.dy === "number" && !isNaN(shift.dy)) ?
        shift.dy : 0.0;
    if (dx === 0.0 && dy === 0.0) {
        return null;
    }
    return { x: st.x - dx, y: st.y - dy };
};

/**
 * How big a closure shift has to be, as a fraction of the leg it sits
 * on, before the as-surveyed line is worth drawing beside the
 * adjusted one. Two percent of a twenty foot shot is five inches --
 * below that the two lines are the same line drawn twice.
 */
CsGhost.RAW_MIN_FRACTION = 0.02;

/** True when the adjustment moved this leg far enough to be worth a
 *  second line. `ra`/`rb` are the as-surveyed ends, either of which
 *  may be null for an end that did not move. */
CsGhost.movedVisibly = function(a, b, ra, rb) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var legLength = Math.sqrt(dx * dx + dy * dy);
    var shift = function(now, was) {
        if (was === null) { return 0.0; }
        var sx = now.x - was.x;
        var sy = now.y - was.y;
        return Math.sqrt(sx * sx + sy * sy);
    };
    var worst = Math.max(shift(a, ra), shift(b, rb));
    if (legLength < 1e-9) {
        return worst > 0;
    }
    return (worst / legLength) >= CsGhost.RAW_MIN_FRACTION;
};

/**
 * Every line the page would draw, in drawing coordinates.
 *
 * \param survey   the page as a CsModel survey
 * \param resolved what CsAdjust.resolveAndAdjust made of it
 * \return {
 *   legs:     [[{x,y},{x,y}]]   shot lines, adjusted -- what Draw draws
 *   raw:      [[{x,y},{x,y}]]   the same lines BEFORE closure moved
 *                               them, and only for legs that moved
 *   splays:   [[{x,y},{x,y}]]   wall shots, which are measurements too
 *   walls:    [[{x,y}, ...]]    the passage edges the LRUD makes
 *   stations: [{name, x, y}]    one per placed station, for a mark
 *   unplaced: [name]            named in a shot, nowhere to put it
 * }
 *
 * Pure. Empty lists rather than nulls throughout: a half-typed page is
 * the normal state of this data, not an error, and every caller here
 * is about to loop over the answer.
 */
CsGhost.segments = function(survey, resolved, opts) {
    var out = { legs: [], raw: [], splays: [], walls: [], stations: [],
                unplaced: [] };
    var options = (opts === null || opts === undefined) ? {} : opts;
    // WHOSE SHOTS ARE BEING DRAWN. On a drawing that already holds a
    // cave, the page is resolved as part of the WHOLE merged survey --
    // that is the only way its stations land where Draw will put them
    // -- but ghosting all sixty legs of Truitt over the sixty legs
    // already drawn there says nothing and hides the map. So the
    // caller names the stations it is actually typing, and only their
    // legs, walls and marks are drawn.
    //
    // The as-surveyed lines are NOT filtered this way: see below.
    var focus = options.focus;
    var focused = function(name) {
        return focus === undefined || focus === null ||
            focus[name] === true;
    };
    if (survey === null || survey === undefined ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return out;
    }

    var seenUnplaced = {};
    var noteUnplaced = function(name) {
        if (name === "" || seenUnplaced[name] === true) { return; }
        seenUnplaced[name] = true;
        out.unplaced.push(name);
    };

    var i;
    for (i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsGhost.isDrawable(shot)) {
            continue;
        }
        var from = String(shot.from);
        var to = String(shot.to);
        var mine = focused(from) || focused(to);
        if (shot.splay === true) {
            if (!mine) { continue; }
            // A SPLAY TIP IS NOT A STATION and the network never
            // places one -- it is a wall shot hanging off a station,
            // which is why CsDraw plots it from the station's own
            // position and the shot's own offset rather than looking
            // it up. Doing the same here keeps the ghost's splays
            // where Draw's splays land.
            var base = CsGhost.at(resolved, from);
            if (base === null) {
                noteUnplaced(from);
                continue;
            }
            var off = null;
            try {
                off = CsTraverse.offset(shot, CsTraverse.SLOPE);
            } catch (eOff) {
                off = null;
            }
            if (off === null) {
                // No distance, or no bearing: a ray drawn from that
                // would assert a measurement nobody took.
                continue;
            }
            out.splays.push([{ x: base.x, y: base.y },
                             { x: base.x + off.dx, y: base.y + off.dy }]);
            continue;
        }
        var a = CsGhost.at(resolved, from);
        var b = CsGhost.at(resolved, to);
        if (a === null) { noteUnplaced(from); }
        if (b === null) { noteUnplaced(to); }
        if (a === null || b === null) {
            // A LEG TO NOWHERE IS NOT DRAWN, and is not an error
            // either: it is what every shot looks like for the second
            // or two between typing its `to` station and typing the
            // measurements that place it.
            continue;
        }
        if (mine) {
            out.legs.push([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]);
        }

        // THE SAME LEG BEFORE THE ADJUSTMENT, when closure moved
        // either end.
        //
        // LIMITED TO THE PAGE, like the legs, and that took measuring
        // to settle. The first cut drew it for every leg in the
        // survey, on the grounds that a shot which closes a loop
        // moves passage somebody surveyed last year and seeing that
        // is worth a lot. On Truitt that came to twenty-eight dashed
        // lines scattered over the existing map -- none of them
        // caused by the page being typed. They are the cave's OWN
        // adjustment, which was applied when it was drawn and is
        // already in the linework; re-stating it on every keystroke
        // is noise, and it hides the two or three lines that are
        // about what the caver is doing right now.
        //
        // Showing what a new shot does to OLD passage is a different
        // and more expensive question -- this solve against the solve
        // without the page -- and not one to answer on a keystroke.
        //
        // AND ONLY WHERE THE MOVE IS WORTH SEEING. Every station in an
        // adjusted cave shifts by something, so "moved at all" draws a
        // second copy of the whole map a hair's breadth from the
        // first: two lines, no information, and the real linework lost
        // underneath. A shift has to be an appreciable fraction of the
        // leg it is on before it is drawn as its own line.
        var ra = CsGhost.beforeAdjustment(resolved, from);
        var rb = CsGhost.beforeAdjustment(resolved, to);
        if (mine && (ra !== null || rb !== null) &&
                CsGhost.movedVisibly(a, b, ra, rb)) {
            out.raw.push([
                ra === null ? { x: a.x, y: a.y } : ra,
                rb === null ? { x: b.x, y: b.y } : rb
            ]);
        }
    }

    // THE WALLS, through the same wallRuns CsDraw itself calls. A
    // second implementation of where an LRUD tick lands would be a
    // second set of wall rules to keep in step, and the walls are the
    // half of this a caver is most likely to be checking: an L and an
    // R swapped is invisible in a number and obvious in a passage.
    try {
        var runs = CsLrud.wallRuns(survey, resolved);
        var sides = [runs.left, runs.right];
        for (var sd = 0; sd < sides.length; sd++) {
            var side = sides[sd];
            if (Object.prototype.toString.call(side) !== "[object Array]") {
                continue;
            }
            for (i = 0; i < side.length; i++) {
                var pts = (side[i] === null || side[i] === undefined) ?
                    null : side[i].points;
                if (Object.prototype.toString.call(pts) !== "[object Array]" ||
                        pts.length < 2) {
                    continue;
                }
                var poly = [];
                for (var p = 0; p < pts.length; p++) {
                    var pt = pts[p];
                    if (pt === null || pt === undefined ||
                            typeof pt.x !== "number" ||
                            typeof pt.y !== "number" ||
                            isNaN(pt.x) || isNaN(pt.y)) {
                        continue;
                    }
                    poly.push({ x: pt.x, y: pt.y });
                }
                if (poly.length < 2) {
                    continue;
                }
                if (focus !== undefined && focus !== null) {
                    // A RUN BELONGS TO THE PAGE if it touches any
                    // station on it. wallRuns carries the stations
                    // each run was built from, which is why this can
                    // be asked at all.
                    var runNames = side[i].stations;
                    var touches = false;
                    if (Object.prototype.toString.call(runNames) ===
                            "[object Array]") {
                        for (var rn = 0; rn < runNames.length; rn++) {
                            if (focused(runNames[rn])) {
                                touches = true;
                                break;
                            }
                        }
                    }
                    if (!touches) {
                        continue;
                    }
                }
                out.walls.push(poly);
            }
        }
    } catch (eWalls) {
        // A page mid-keystroke can hand the wall rules something they
        // refuse. The centreline is still worth drawing, and the walls
        // come back on the next keystroke.
    }

    // The stations themselves, in resolution order, so a mark can be
    // put on each one.
    var names = CsModel.stationNames(survey);
    for (i = 0; i < names.length; i++) {
        if (!focused(names[i])) {
            continue;
        }
        var st = CsGhost.at(resolved, names[i]);
        if (st === null) {
            noteUnplaced(names[i]);
            continue;
        }
        out.stations.push({ name: names[i], x: st.x, y: st.y });
    }
    return out;
};

/** True when there is nothing worth painting. */
CsGhost.isEmpty = function(segments) {
    if (segments === null || segments === undefined) {
        return true;
    }
    return segments.legs.length === 0 && segments.splays.length === 0 &&
        segments.walls.length === 0 && segments.stations.length === 0;
};

/**
 * The box the ghost occupies, or null when it is empty.
 *
 * \return {x1, y1, x2, y2}
 */
CsGhost.bounds = function(segments) {
    if (CsGhost.isEmpty(segments)) {
        return null;
    }
    var box = null;
    var take = function(pt) {
        if (box === null) {
            box = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
            return;
        }
        if (pt.x < box.x1) { box.x1 = pt.x; }
        if (pt.y < box.y1) { box.y1 = pt.y; }
        if (pt.x > box.x2) { box.x2 = pt.x; }
        if (pt.y > box.y2) { box.y2 = pt.y; }
    };
    var lists = [segments.legs, segments.raw, segments.splays,
                 segments.walls];
    for (var l = 0; l < lists.length; l++) {
        for (var i = 0; i < lists[l].length; i++) {
            for (var p = 0; p < lists[l][i].length; p++) {
                take(lists[l][i][p]);
            }
        }
    }
    for (var s = 0; s < segments.stations.length; s++) {
        take(segments.stations[s]);
    }
    return box;
};
