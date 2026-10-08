// CsFly.js -- a camera path down the surveyed passage.
//
// Part of the Cave Survey Core library. PURE: no Q* or R* symbols, so
// tests/js_unit.js exercises all of it.
//
// WHAT THIS IS FOR. Looking at a cave from outside tells a
// cartographer the shape of it; flying down the middle of it tells
// them what it is like to be in it, which is the thing a map is trying
// to convey and the thing a passage drawn as a tube does not.
//
// THE PATH IS THE CENTRELINE, IN SURVEY ORDER. Not a smoothed curve
// through the stations and not a route solved for prettiness: the legs
// as they were walked. A caver watching this is matching what they see
// against what they remember of walking it, and a path that took its
// own line through the passage would be showing them a trip nobody
// made.
//
// IT WALKS THE CAVE THE WAY A CAVER DOES. A survey is not one
// continuous line: it branches, and the next leg in survey order often
// starts somewhere else entirely. Flying it in survey order means
// teleporting at every branch, and stopping dead at the end of each
// one.
//
// So the flight is a TOUR: out along a passage, and back the way it
// came when it runs out, then on down the next branch. Every leg is
// flown twice, once in each direction, which is what a caver pushing
// leads actually does -- and it means the camera never jumps and never
// stops facing a wall. See CsFly.tour.

var CsFly = {};

/** Samples closer together than this are the same place. Drawing
 *  units squared. */
CsFly.MIN_STEP_SQ = 1e-9;

/** Samples a flight is cut into when nobody asks for a spacing.
 *
 *  Matched to the ticks the panel's animation takes, so a caver sees
 *  roughly one sample a frame: fewer and the camera skips past bends,
 *  many more and the path costs memory for detail nobody can see at
 *  flying speed. */
CsFly.SAMPLES = 600;

/**
 * The centreline as runs of connected legs, in survey order.
 *
 * A new run begins wherever the next leg does not start where the last
 * one finished. Splays are left out: they are wall hits, not passage
 * anyone walked.
 *
 * \return [[{x,y,z}, ...], ...]
 */
CsFly.runs = function(resolved) {
    var out = [];
    if (resolved === null || resolved === undefined ||
            resolved.legs === null || resolved.legs === undefined ||
            resolved.stations === null || resolved.stations === undefined) {
        return out;
    }
    var at = null;
    var current = null;
    var lastName = null;
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg === null || leg === undefined) { continue; }
        if (leg.splay === true || leg.excludeFromAll === true) { continue; }
        var a = resolved.stations[leg.from];
        var b = resolved.stations[leg.to];
        if (!CsFly.usable(a) || !CsFly.usable(b)) { continue; }
        if (current === null || lastName !== leg.from) {
            // A leg that does not carry on from the last one starts a
            // new run rather than being joined to it through passage
            // nobody surveyed.
            current = [{ x: a.x, y: a.y, z: a.z }];
            out.push(current);
        }
        current.push({ x: b.x, y: b.y, z: b.z });
        lastName = leg.to;
        at = b;
    }
    return out;
};

/**
 * A continuous walk covering every leg of the cave.
 *
 * IT WALKS LEGS, NOT STATIONS. A depth-first walk of the stations turns
 * around wherever it meets a station it has already been to -- which at
 * a LOOP CLOSURE is not a dead end at all: the passage carries straight
 * on, it has just been reached from the other side. Truitt came out
 * with nine turn-arounds that way and has two.
 *
 * So this tracks which LEGS have been flown. From wherever it is, it
 * takes an unflown leg if there is one; when there is not, it routes
 * through passage it has already seen to the nearest station that still
 * has one. That is what a caver pushing leads does, and it turns the
 * camera round only where the cave itself turns round.
 *
 * ONE WALK PER CONNECTED PIECE. A survey with an unconnected second
 * entrance is two caves as far as walking is concerned, and pretending
 * otherwise would fly through rock between them.
 *
 * \return [[{x,y,z}, ...], ...] -- one continuous walk per piece
 */
/**
 * Where the camera should be at a station: the middle of the passage,
 * when the mesh worked one out, and the station itself otherwise.
 *
 * A STATION IS NOT THE MIDDLE OF THE PASSAGE -- it is wherever the
 * instrument sat, often hard against a wall -- so a flight down the
 * line of the stations scrapes along whichever side they were set on.
 */
CsFly.centreOf = function(name, resolved, centres) {
    if (centres !== null && centres !== undefined &&
            centres.hasOwnProperty(name)) {
        var c = centres[name];
        if (CsFly.usable(c)) {
            return { x: c.x, y: c.y, z: c.z };
        }
    }
    var st = resolved.stations[name];
    return { x: st.x, y: st.y, z: st.z };
};

/**
 * The middles of the passage, by station name, out of a mesh's outline
 * buffer.
 *
 * \return {name: {x, y, z}}
 */
CsFly.centresFrom = function(outlines) {
    var out = {};
    if (outlines === null || outlines === undefined ||
            outlines.names === undefined || outlines.centres === undefined) {
        return out;
    }
    for (var i = 0; i < outlines.names.length; i++) {
        out[outlines.names[i]] = {
            x: outlines.centres[i * 3],
            y: outlines.centres[i * 3 + 1],
            z: outlines.centres[i * 3 + 2]
        };
    }
    return out;
};

CsFly.tour = function(resolved, centres) {
    var out = [];
    if (resolved === null || resolved === undefined ||
            resolved.legs === null || resolved.legs === undefined ||
            resolved.stations === null || resolved.stations === undefined) {
        return out;
    }

    var adj = {};
    var order = [];
    var seen = {};
    var unflown = {};
    var note = function(a, b) {
        if (!adj.hasOwnProperty(a)) { adj[a] = []; }
        if (adj[a].indexOf(b) < 0) { adj[a].push(b); }
        if (seen[a] !== true) { seen[a] = true; order.push(a); }
    };
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg === null || leg === undefined) { continue; }
        if (leg.splay === true || leg.excludeFromAll === true) { continue; }
        if (!CsFly.usable(resolved.stations[leg.from]) ||
                !CsFly.usable(resolved.stations[leg.to])) { continue; }
        if (leg.from === leg.to) { continue; }
        note(leg.from, leg.to);
        note(leg.to, leg.from);
        unflown[CsFly.legKey(leg.from, leg.to)] = true;
    }

    var visitedStation = {};
    for (var s = 0; s < order.length; s++) {
        if (visitedStation[order[s]] === true) { continue; }
        var walk = CsFly.walkPiece(order[s], adj, unflown, visitedStation,
            resolved, centres);
        if (walk.length >= 2) {
            out.push(walk);
        }
    }
    return out;
};

/** One spelling of a leg, whichever end it is named from. */
CsFly.legKey = function(a, b) {
    return (String(a) < String(b)) ? (a + "\u0000" + b) : (b + "\u0000" + a);
};

/** The walk over one connected piece of cave. */
CsFly.walkPiece = function(start, adj, unflown, visitedStation, resolved,
                           centres) {
    var walk = [];
    var push = function(name) {
        walk.push(CsFly.centreOf(name, resolved, centres));
        visitedStation[name] = true;
    };
    var at = start;
    push(at);

    var guard = 0;
    var limit = 200000;
    while (guard++ < limit) {
        // An unflown leg from here, if there is one.
        var next = null;
        var here = adj[at] || [];
        for (var i = 0; i < here.length; i++) {
            if (unflown[CsFly.legKey(at, here[i])] === true) {
                next = here[i];
                break;
            }
        }
        if (next !== null) {
            unflown[CsFly.legKey(at, next)] = false;
            at = next;
            push(at);
            continue;
        }
        // Nothing left here: go to the nearest station that still has
        // one, THROUGH passage already flown.
        var route = CsFly.routeToUnflown(at, adj, unflown);
        if (route === null) {
            break;
        }
        for (var r = 1; r < route.length; r++) {
            at = route[r];
            push(at);
        }
    }
    return walk;
};

/**
 * The shortest way from `from` to a station with an unflown leg, over
 * passage that is already known.
 *
 * Breadth first, so the camera takes the SHORTEST way back rather than
 * retracing every step it took to get here -- which is both what a
 * caver does and much less of the film spent on passage already shown.
 *
 * \return the route including `from`, or null when nothing is left
 */
CsFly.routeToUnflown = function(from, adj, unflown) {
    var prev = {};
    var queue = [from];
    var seen = {};
    seen[from] = true;
    var head = 0;
    while (head < queue.length) {
        var at = queue[head++];
        var here = adj[at] || [];
        var wants = false;
        for (var w = 0; w < here.length; w++) {
            if (unflown[CsFly.legKey(at, here[w])] === true) {
                wants = true;
                break;
            }
        }
        if (wants && at !== from) {
            var route = [at];
            var back = at;
            while (back !== from) {
                back = prev[back];
                route.unshift(back);
            }
            return route;
        }
        for (var i = 0; i < here.length; i++) {
            if (seen[here[i]] === true) { continue; }
            seen[here[i]] = true;
            prev[here[i]] = at;
            queue.push(here[i]);
        }
    }
    return null;
};

/** A station with a position that can be flown to. */
CsFly.usable = function(st) {
    return st !== null && st !== undefined &&
        typeof st.x === "number" && typeof st.y === "number" &&
        typeof st.z === "number" &&
        isFinite(st.x) && isFinite(st.y) && isFinite(st.z);
};

/** How long a run is, walked end to end. */
CsFly.lengthOf = function(points) {
    var total = 0;
    if (points === null || points === undefined) { return 0; }
    for (var i = 1; i < points.length; i++) {
        total += CsFly.distance(points[i - 1], points[i]);
    }
    return total;
};

CsFly.distance = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * One run resampled at an even spacing.
 *
 * EVEN SPACING IS WHAT MAKES THE SPEED CONSTANT. Stations are not
 * evenly spaced -- a tight crawl gets a shot every few feet and a
 * walking passage one every fifty -- so a camera that spent the same
 * time between each would crawl through the open passage and race
 * through the tight bits, which is the opposite of what is worth
 * seeing.
 */
CsFly.resample = function(points, step) {
    if (points === null || points === undefined || points.length === 0) {
        return [];
    }
    if (points.length === 1 || !(step > 0)) {
        return [{ x: points[0].x, y: points[0].y, z: points[0].z }];
    }
    var out = [{ x: points[0].x, y: points[0].y, z: points[0].z }];
    var carry = 0;
    for (var i = 1; i < points.length; i++) {
        var a = points[i - 1], b = points[i];
        var seg = CsFly.distance(a, b);
        if (!(seg > 0)) { continue; }
        var walked = step - carry;
        while (walked <= seg) {
            var t = walked / seg;
            out.push({ x: a.x + (b.x - a.x) * t,
                       y: a.y + (b.y - a.y) * t,
                       z: a.z + (b.z - a.z) * t });
            walked += step;
        }
        carry = seg - (walked - step);
    }
    var last = points[points.length - 1];
    var tail = out[out.length - 1];
    if (CsFly.distance(tail, last) > 1e-9) {
        out.push({ x: last.x, y: last.y, z: last.z });
    }
    return out;
};

/**
 * The whole flight: every run resampled, one after another, with the
 * index at which each run starts so a jump is not mistaken for passage.
 *
 * \param step how far apart the samples sit; defaults to a fiftieth of
 *        the longest run, so a cave of any size takes a similar number
 *        of samples
 * \return {points: [{x,y,z}], breaks: [index, ...], length: <units>}
 */
CsFly.path = function(resolved, step, centres) {
    var runs = CsFly.tour(resolved, centres);
    var out = { points: [], breaks: [], turns: [], length: 0 };
    if (runs.length === 0) { return out; }
    var use = step;
    if (!(use > 0)) {
        // ENOUGH SAMPLES TO FOLLOW THE PASSAGE. Spacing the samples by
        // a fraction of the LONGEST RUN gave fifty of them for the
        // whole of Truitt -- eighty feet apart, which flies past every
        // bend in the cave without turning. The flight is what it is
        // for, so the spacing comes from how many steps the animation
        // takes, over the whole distance walked.
        var total = 0;
        for (var r = 0; r < runs.length; r++) {
            total += CsFly.lengthOf(runs[r]);
        }
        use = (total > 0) ? (total / CsFly.SAMPLES) : 1.0;
    }
    for (var i = 0; i < runs.length; i++) {
        var sampled = CsFly.resample(runs[i], use);
        if (sampled.length === 0) { continue; }
        if (out.points.length > 0) {
            // Where one run ends and the next begins: the camera is
            // somewhere else now, and a viewer should be told rather
            // than shown a swoop through solid rock.
            out.breaks.push(out.points.length);
        }
        for (var s = 0; s < sampled.length; s++) {
            out.points.push(sampled[s]);
        }
        out.length += CsFly.lengthOf(runs[i]);
    }
    out.turns = CsFly.turnsIn(out.points);
    return out;
};

/**
 * Where the flight doubles back on itself.
 *
 * A tour walks out to a dead end and returns the way it came, so at
 * that station the path reverses: the segment after points back along
 * the segment before. A camera carried straight through that flips a
 * hundred and eighty degrees between one frame and the next.
 *
 * Found by ANGLE rather than remembered from the walk, because the
 * resampling moves every index -- and because a hairpin bend in the
 * passage itself deserves the same treatment as a dead end. The camera
 * stops and turns round at both, which is what a caver does.
 *
 * \return the sample indices where the path reverses
 */
CsFly.turnsIn = function(points, degrees) {
    var out = [];
    if (points === null || points === undefined || points.length < 3) {
        return out;
    }
    var limit = Math.cos(((degrees === undefined || degrees === null)
        ? CsFly.TURN_DEGREES : degrees) * Math.PI / 180.0);
    for (var i = 1; i + 1 < points.length; i++) {
        var ax = points[i].x - points[i - 1].x;
        var ay = points[i].y - points[i - 1].y;
        var az = points[i].z - points[i - 1].z;
        var bx = points[i + 1].x - points[i].x;
        var by = points[i + 1].y - points[i].y;
        var bz = points[i + 1].z - points[i].z;
        var la = Math.sqrt(ax * ax + ay * ay + az * az);
        var lb = Math.sqrt(bx * bx + by * by + bz * bz);
        if (!(la > 0) || !(lb > 0)) { continue; }
        var dot = (ax * bx + ay * by + az * bz) / (la * lb);
        if (dot <= limit) {
            out.push(i);
        }
    }
    return out;
};

/** How sharply the path must double back to count as a turn-around. */
CsFly.TURN_DEGREES = 120;

/** The path as a flat [x,y,z,...] array, which is what the view takes. */
CsFly.flatten = function(points) {
    var out = [];
    if (points === null || points === undefined) { return out; }
    for (var i = 0; i < points.length; i++) {
        out.push(points[i].x, points[i].y, points[i].z);
    }
    return out;
};

/** A stamp for a folder name: when this animation was made. Local time,
 *  because it is for a caver looking at their own folder, not a log. */
CsFly.stamp = function(now) {
    var d = (now === undefined || now === null) ? new Date() : now;
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) +
        "-" + two(d.getHours()) + two(d.getMinutes());
};

/**
 * What an exported recording (and its folder) is called: the cave, the
 * visualization it is coloured by, the camera, and when --
 * "Truitt Cave - Depth of cover - fly 20260913-0705". Named for the
 * visualization so a folder of films says which view each one is
 * without opening it. Anything a file name cannot hold becomes "_".
 */
CsFly.filmStem = function(caveName, methodLabel, camera, stamp) {
    function safe(t) {
        return String(t === undefined || t === null ? "" : t)
            .replace(/[^A-Za-z0-9._ -]/g, "_");
    }
    var parts = [safe(caveName) !== "" ? safe(caveName) : "cave"];
    if (safe(methodLabel) !== "") {
        parts.push(safe(methodLabel));
    }
    parts.push(safe(camera) + " " + safe(stamp));
    return parts.join(" - ");
};
