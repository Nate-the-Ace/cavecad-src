// CsTripPlan.js -- a trip plan: where to go, how, how long, what to carry.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI.
//
// THE SURVEY LINE IS NOT A WALKING ROUTE. A crawl, a squeeze, water, a
// climb or a loose section only shows up if somebody wrote it in a note
// or the LRUD is tight. Everything here says "follows the survey line"
// and surfaces the notes and tightness it finds on the way. It never
// claims a route is safe or easy.
//
// A PITCH HAS NO BEARING. A plumb leg carries bearing null and its
// step never prints a heading (docs/vertical-caves.md).
//
// A MISSING z IS null, and null z prints no vertical wording. Never 0.
//
// NO COORDINATES in any output a person reads. Positions are used to
// measure and are not repeated in text or in the packet.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsPitch.js");
include(includeBasePath + "/CsUnits.js");

var CsTripPlan = {};

/** A leg whose plan run is under this fraction of its length is plumb. */
CsTripPlan.PLUMB_FRACTION = 0.05;

/**
 * The survey as an adjacency map over LEGS.
 *
 * \return {station: [{from, to, len, dz, bearing, dx, dy, shot}]} where
 *   len is the straight-line length between the resolved ends (3D when
 *   both ends have a z, plan otherwise), dz is null when either end has
 *   no z, bearing is degrees from north or null for a plumb leg, and
 *   shot is the index into survey.shots (for LRUD lookups)
 */
CsTripPlan.graph = function(survey, resolved) {
    var adj = {};
    if (survey === undefined || survey === null || resolved === undefined ||
            resolved === null || resolved.stations === undefined ||
            resolved.stations === null) {
        return adj;
    }
    var finite = function(v) { return typeof v === "number" && isFinite(v); };
    var add = function(a, b, pa, pb, shotIndex) {
        var dx = pb.x - pa.x;
        var dy = pb.y - pa.y;
        var plan = Math.sqrt(dx * dx + dy * dy);
        var known = finite(pa.z) && finite(pb.z);
        var dz = known ? pb.z - pa.z : null;
        var len = known ? Math.sqrt(plan * plan + dz * dz) : plan;
        var bearing = null;
        if (plan > len * CsTripPlan.PLUMB_FRACTION && plan > 0) {
            bearing = Math.atan2(dx, dy) * 180 / Math.PI;
            if (bearing < 0) { bearing += 360; }
        }
        if (adj[a] === undefined) { adj[a] = []; }
        adj[a].push({ from: a, to: b, len: len, dz: dz, bearing: bearing,
            dx: dx, dy: dy, shot: shotIndex });
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var a = CsFrontier.clean(shot.from);
        var b = CsFrontier.clean(shot.to);
        var pa = resolved.stations[a];
        var pb = resolved.stations[b];
        if (pa === undefined || pa === null || pb === undefined || pb === null) {
            continue;
        }
        add(a, b, pa, pb, i);
        add(b, a, pb, pa, i);
    }
    return adj;
};

/** Dijkstra from one station. \return {dist, prev} */
CsTripPlan.shortest = function(adj, source) {
    var dist = {};
    var prev = {};
    dist[source] = 0;
    var heap = [[0, source]];
    var push = function(item) {
        heap.push(item);
        var i = heap.length - 1;
        while (i > 0) {
            var p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) { break; }
            var t = heap[p]; heap[p] = heap[i]; heap[i] = t;
            i = p;
        }
    };
    var pop = function() {
        var top = heap[0];
        var last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            var i = 0;
            for (;;) {
                var l = 2 * i + 1;
                var r = l + 1;
                var m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) { m = l; }
                if (r < heap.length && heap[r][0] < heap[m][0]) { m = r; }
                if (m === i) { break; }
                var t = heap[m]; heap[m] = heap[i]; heap[i] = t;
                i = m;
            }
        }
        return top;
    };
    while (heap.length > 0) {
        var cur = pop();
        var d = cur[0];
        var u = cur[1];
        if (d > dist[u]) { continue; }
        var edges = adj[u] || [];
        for (var k = 0; k < edges.length; k++) {
            var e = edges[k];
            var nd = d + e.len;
            if (dist[e.to] === undefined || nd < dist[e.to]) {
                dist[e.to] = nd;
                prev[e.to] = e;
                push([nd, e.to]);
            }
        }
    }
    return { dist: dist, prev: prev };
};

/** The edges from the source to target, or null when unreachable. */
CsTripPlan.pathTo = function(sp, target) {
    if (sp.dist[target] === undefined) { return null; }
    var edges = [];
    var at = target;
    var guard = 0;
    while (sp.prev[at] !== undefined && guard++ < 1000000) {
        edges.push(sp.prev[at]);
        at = sp.prev[at].from;
    }
    edges.reverse();
    return edges;
};

/**
 * The order to visit stops, start to start.
 *
 * Up to 8 reachable stops are ordered by exhaustive search (the true
 * minimum round trip); more use nearest-neighbour, which is honest about
 * being an approximation (approximate: true).
 *
 * \return {order: [station], unreachable: [station], roundTrip, approximate}
 */
CsTripPlan.order = function(adj, start, targets) {
    var from = {};
    from[start] = CsTripPlan.shortest(adj, start);
    var reach = [];
    var unreachable = [];
    var seen = {};
    var i;
    for (i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (seen[t] === true || t === start) { continue; }
        seen[t] = true;
        if (from[start].dist[t] === undefined) { unreachable.push(t); }
        else { reach.push(t); }
    }
    for (i = 0; i < reach.length; i++) {
        from[reach[i]] = CsTripPlan.shortest(adj, reach[i]);
    }
    var d = function(a, b) { return from[a].dist[b]; };

    var best = null;
    var bestLen = Infinity;
    var approximate = false;
    if (reach.length <= 8) {
        var perm = function(rest, chain, len, at) {
            if (len >= bestLen) { return; }
            if (rest.length === 0) {
                var total = len + d(at, start);
                if (total < bestLen) { bestLen = total; best = chain.slice(0); }
                return;
            }
            for (var k = 0; k < rest.length; k++) {
                var next = rest[k];
                var left = rest.slice(0, k).concat(rest.slice(k + 1));
                chain.push(next);
                perm(left, chain, len + d(at, next), next);
                chain.pop();
            }
        };
        perm(reach, [], 0, start);
    } else {
        approximate = true;
        var rest = reach.slice(0);
        var at = start;
        best = [];
        bestLen = 0;
        while (rest.length > 0) {
            var pick = 0;
            for (var r = 1; r < rest.length; r++) {
                if (d(at, rest[r]) < d(at, rest[pick])) { pick = r; }
            }
            bestLen += d(at, rest[pick]);
            at = rest[pick];
            best.push(at);
            rest.splice(pick, 1);
        }
        bestLen += d(at, start);
    }
    if (best === null) { best = []; bestLen = 0; }
    return { order: best, unreachable: unreachable, roundTrip: bestLen,
        approximate: approximate };
};

/** 45-degree sector name for a heading. */
CsTripPlan.compass = function(degrees) {
    var names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return names[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
};

/** A distance the way a caver would say it: whole units. */
CsTripPlan.dist = function(value, unit) {
    return String(Math.round(value)) + " " + unit;
};

/**
 * Turn-by-turn steps for a list of edges.
 *
 * \param ctx {degree: {station: legs}, notes: {station: [{text}]},
 *             pitchOfEdge: function(edge) -> pitch index or -1, unit}
 * \return [{kind: "walk"|"pitch", from, to, length, dz, vertical:
 *           "up"|"down"|"", heading, edges, atJunction, degreeTo, notes,
 *           text}] where degreeTo is ctx.degree of `to` (0 if unknown)
 */
CsTripPlan.describe = function(edges, ctx) {
    var unit = ctx.unit === "m" ? "m" : "ft";
    var steps = [];
    var cur = null;
    var flush = function() { if (cur !== null) { steps.push(cur); cur = null; } };
    var isJunction = function(name) { return (ctx.degree[name] || 0) >= 3; };

    for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var pitch = ctx.pitchOfEdge(e);
        var kind = pitch >= 0 ? "pitch" : "walk";
        if (cur !== null && (cur.kind !== kind || cur.pitch !== pitch ||
                isJunction(cur.to))) {
            flush();
        }
        if (cur === null) {
            cur = { kind: kind, pitch: pitch, from: e.from, to: e.to,
                length: 0, dz: 0, dzKnown: true, dx: 0, dy: 0, edges: [] };
        }
        cur.to = e.to;
        cur.length += e.len;
        if (e.dz === null) { cur.dzKnown = false; } else { cur.dz += e.dz; }
        cur.dx += e.dx; cur.dy += e.dy;
        cur.edges.push(e);
    }
    flush();

    for (var s = 0; s < steps.length; s++) {
        var st = steps[s];
        st.vertical = "";
        if (st.dzKnown && Math.abs(st.dz) >= 1 && st.kind === "walk") {
            st.vertical = st.dz < 0 ? "down" : "up";
        }
        if (st.kind === "pitch") {
            st.vertical = (st.dzKnown && st.dz > 0) ? "up" : "down";
        }
        st.heading = "";
        if (st.kind === "walk") {
            var plan = Math.sqrt(st.dx * st.dx + st.dy * st.dy);
            if (plan > 0) {
                var b = Math.atan2(st.dx, st.dy) * 180 / Math.PI;
                st.heading = CsTripPlan.compass(b);
            }
        }
    }

    // SECOND PASS. A junction hint names the NEXT step's heading, so every
    // heading has to exist before any text is built; setting them in the
    // same loop printed "heading undefined" for the step after a junction.
    for (s = 0; s < steps.length; s++) {
        st = steps[s];
        st.atJunction = isJunction(st.to) && s < steps.length - 1;
        // How many surveyed legs meet at the step's end: the "3-way" on
        // an intersection sign. 0 when the survey does not say.
        st.degreeTo = ctx.degree[st.to] || 0;
        st.notes = [];
        var stations = [];
        for (var q = 0; q < st.edges.length; q++) { stations.push(st.edges[q].to); }
        for (var n = 0; n < stations.length; n++) {
            var ns = ctx.notes[stations[n]] || [];
            for (var m = 0; m < ns.length; m++) {
                st.notes.push(stations[n] + ": " + ns[m].text);
            }
        }
        var text = st.from + " to " + st.to + ": ";
        if (st.kind === "pitch") {
            var parts = [];
            for (var p = 0; p < st.edges.length; p++) {
                if (st.edges[p].dz !== null) {
                    parts.push(String(Math.round(Math.abs(st.edges[p].dz))));
                }
            }
            var total = st.dzKnown ? Math.round(Math.abs(st.dz)) : null;
            text += "pitch " + st.vertical + (total === null ? "" :
                " " + total + " " + unit);
            if (parts.length > 1) { text += " (" + parts.join(" + ") + ")"; }
        } else {
            text += CsTripPlan.dist(st.length, unit);
            if (st.heading !== "") { text += " heading " + st.heading; }
            if (st.vertical !== "") {
                text += ", " + st.vertical + " " +
                    Math.round(Math.abs(st.dz)) + " " + unit;
            }
        }
        st.text = text;
        if (st.atJunction && steps[s + 1].kind === "walk" &&
                steps[s + 1].heading !== "") {
            st.text += ". At " + st.to + " (junction) leave by the branch heading " +
                steps[s + 1].heading;
        } else if (st.atJunction) {
            st.text += ". At " + st.to + " (junction) take the next branch as listed";
        }
    }
    return steps;
};

// ---------------------------------------------------------------------
// Pace, gear, assembly
// ---------------------------------------------------------------------

/**
 * Every number a team may want to change. All in FEET and MINUTES.
 * These are STARTING VALUES for a plan, not measurements: a training
 * trip and an expedition differ, and the team overrides them in the
 * sidecar (settings.pace). Hiking pace (3 mph) is the horizontal default.
 */
CsTripPlan.DEFAULTS = {
    paceFtPerMin: 264,
    descendFtPerMin: 30,
    ascendFtPerMin: 10,
    rigMin: 10,
    rebelayMin: 5,
    leadWorkMin: 20,
    ropeMargin: 0.10,
    rebelaySlackFt: 10,
    tightFt: 3
};

/** Defaults overlaid with the team's values; bad values are ignored. */
CsTripPlan.config = function(overrides) {
    var out = {};
    var o = overrides || {};
    for (var key in CsTripPlan.DEFAULTS) {
        if (!Object.prototype.hasOwnProperty.call(CsTripPlan.DEFAULTS, key)) {
            continue;
        }
        var v = o[key];
        out[key] = (typeof v === "number" && isFinite(v) && v > 0) ? v :
            CsTripPlan.DEFAULTS[key];
    }
    return out;
};

var csTpFeet = function(value, unit) {
    return unit === "m" ? CsUnits.convert(value, "m", "ft") : value;
};

/** Minutes to walk a length given in the survey's unit. */
CsTripPlan.walkMinutes = function(length, unit, cfg) {
    return csTpFeet(length, unit) / cfg.paceFtPerMin;
};

/**
 * Minutes for one step. `inbound` is true on the way in: a descent is
 * rigged then (rig time once), and the way out finds it rigged.
 */
CsTripPlan.stepMinutes = function(step, unit, cfg, inbound) {
    if (step.kind !== "pitch") {
        return CsTripPlan.walkMinutes(step.length, unit, cfg);
    }
    var drop = step.dzKnown ? csTpFeet(Math.abs(step.dz), unit) :
        csTpFeet(step.length, unit);
    var rebelays = Math.max(0, step.edges.length - 1);
    var going = (step.vertical === "down");
    var rate = going ? cfg.descendFtPerMin : cfg.ascendFtPerMin;
    var minutes = drop / rate + rebelays * cfg.rebelayMin;
    if (inbound) { minutes += cfg.rigMin; }
    return minutes;
};

/** One rope line for a pitch: length to pack and how it is made up. */
CsTripPlan.ropeLine = function(pitch, unit, cfg) {
    var slack = unit === "m" ? CsUnits.convert(cfg.rebelaySlackFt, "ft", "m") :
        cfg.rebelaySlackFt;
    var step = unit === "m" ? 5 : 10;
    var want = pitch.drop * (1 + cfg.ropeMargin) + pitch.rebelays * slack;
    var need = Math.ceil(want / step - 1e-9) * step;
    var parts = [];
    for (var i = 0; i < pitch.segments.length; i++) {
        parts.push(String(Math.round(pitch.segments[i].drop)));
    }
    var text = "Pitch " + pitch.top + " to " + pitch.bottom + ": " +
        Math.round(pitch.drop) + " " + unit + " drop";
    if (parts.length > 1) {
        text += " (" + parts.join(" + ") + "), " + pitch.rebelays +
            " rebelay" + (pitch.rebelays === 1 ? "" : "s");
    }
    text += " -- pack " + need + " " + unit + " of rope";
    return { top: pitch.top, bottom: pitch.bottom, need: need, text: text };
};

/** The starting personal kit. A template: the team edits it. */
CsTripPlan.BASE_KIT = ["Helmet", "Primary light", "Two backup lights",
    "Warm layer", "Gloves", "Water and food", "Survey notebook and pencils"];
CsTripPlan.VERTICAL_KIT = ["Harness", "Descender",
    "Ascending system", "Lanyards", "Carabiners", "Rope protectors"];

/**
 * The gear list for the pitches a route crosses.
 *
 * \param pitches CsPitch.find entries on the route (may be [])
 * \param packing the team's packing text from the sidecar, verbatim
 * \return {rope: [line], hardware: [text], kit: [text], packing}
 *
 * Anchor counts are NOT read from the map yet: every pitch says "rig not
 * on map, confirm" rather than inventing a count.
 */
CsTripPlan.gear = function(pitches, unit, cfg, packing) {
    var rope = [];
    var hardware = [];
    for (var i = 0; i < pitches.length; i++) {
        rope.push(CsTripPlan.ropeLine(pitches[i], unit, cfg));
        hardware.push("Pitch " + pitches[i].top + " to " + pitches[i].bottom +
            ": rig not on map, confirm anchors and hangers");
    }
    var kit = CsTripPlan.BASE_KIT.slice(0);
    if (pitches.length > 0) { kit = kit.concat(CsTripPlan.VERTICAL_KIT); }
    return { rope: rope, hardware: hardware, kit: kit,
        packing: (packing === undefined || packing === null) ? "" : String(packing) };
};

/** A warning per station on the path where LRUD says the passage is tight. */
CsTripPlan.tightWarnings = function(survey, edges, unit, cfg) {
    var out = [];
    var limit = unit === "m" ? CsUnits.convert(cfg.tightFt, "ft", "m") : cfg.tightFt;
    var num = function(v) { return typeof v === "number" && isFinite(v) ? v : null; };
    for (var i = 0; i < edges.length; i++) {
        var sh = survey.shots[edges[i].shot];
        if (sh === undefined || sh === null) { continue; }
        var l = num(sh.left), r = num(sh.right), u = num(sh.up), d = num(sh.down);
        var width = (l !== null && r !== null) ? l + r : null;
        var height = (u !== null && d !== null) ? u + d : null;
        var bits = [];
        if (height !== null && height < limit) {
            bits.push("height " + (Math.round(height * 10) / 10) + " " + unit);
        }
        if (width !== null && width < limit) {
            bits.push("width " + (Math.round(width * 10) / 10) + " " + unit);
        }
        if (bits.length > 0) {
            out.push("tight near " + edges[i].to + " (" + bits.join(", ") + ")");
        }
    }
    return out;
};

/**
 * The narrowest passage on a plan's route, and where.
 *
 * Same width rule as tightWarnings: a leg's width is its shot's left +
 * right when both are numbers, else unknown. The legs read are the ones
 * the plan walks: the way in to every stop and the way back. The width
 * is converted from the plan's unit (the survey's, as build was given
 * it; the survey's distanceUnit when the plan has none) to INCHES.
 *
 * \return {inches, near} (near = the station the leg arrives at, as in
 *   tightWarnings), or null when no width is known anywhere on the route
 */
CsTripPlan.routeTightestAt = function(survey, plan) {
    if (survey === undefined || survey === null || plan === undefined || plan === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return null;
    }
    var unit = plan.unit === "m" || plan.unit === "ft" ? plan.unit :
        (survey.distanceUnit === "m" ? "m" : "ft");
    var num = function(v) { return typeof v === "number" && isFinite(v) ? v : null; };
    var best = null;
    var walk = function(steps) {
        var list = Object.prototype.toString.call(steps) === "[object Array]" ? steps : [];
        for (var s = 0; s < list.length; s++) {
            var edges = (list[s] && list[s].edges) || [];
            for (var e = 0; e < edges.length; e++) {
                var sh = survey.shots[edges[e].shot];
                if (sh === undefined || sh === null) { continue; }
                var l = num(sh.left), r = num(sh.right);
                if (l === null || r === null) { continue; }
                var width = l + r;
                // 0 on both sides is an unmeasured LRUD, not a zero-width
                // passage (found live: A5/A6 read 0 and every squeeze limit
                // "failed" on every route). Only a width above 0 counts.
                if (!(width > 0)) { continue; }
                if (best === null || width < best.width) {
                    best = { width: width, near: edges[e].to };
                }
            }
        }
    };
    var stops = Object.prototype.toString.call(plan.stops) === "[object Array]" ? plan.stops : [];
    for (var i = 0; i < stops.length; i++) { walk(stops[i] && stops[i].steps); }
    walk(plan.back && plan.back.steps);
    if (best === null) { return null; }
    return { inches: csTpFeet(best.width, unit) * 12, near: best.near };
};

/** The narrowest passage width on a plan's route in INCHES, or null when
 *  no width is known there (see routeTightestAt). */
CsTripPlan.routeTightness = function(survey, plan) {
    var at = CsTripPlan.routeTightestAt(survey, plan);
    return at === null ? null : at.inches;
};

/**
 * Assemble a plan.
 *
 * \param opts {start, targets: [station], unit, config, packing, notes}
 *   start defaults to the survey's first station. `notes` is
 *   CsStationTable.notesByStation(survey) if the caller has it; it is
 *   computed when omitted.
 * \return {stops: [{station, steps, minutesIn}], back: {steps, minutes},
 *   totals: {lengthIn, lengthAll, minutesIn, minutesWork, minutesOut,
 *   minutesAll, netDrop}, pitches, gear, warnings, unreachable, approximate}
 */
CsTripPlan.build = function(survey, resolved, opts) {
    var o = opts || {};
    var unit = o.unit === "m" ? "m" : "ft";
    var cfg = CsTripPlan.config(o.config);
    var first = CsFrontier.firstLeg(survey);
    var start = (o.start !== undefined && o.start !== "") ? o.start :
        (first === null ? "" : CsFrontier.clean(first.from));
    var adj = CsTripPlan.graph(survey, resolved);
    var warnings = [];
    var plan = { stops: [], back: { steps: [], minutes: 0 }, warnings: warnings,
        unreachable: [], approximate: false, pitches: [],
        totals: { lengthIn: 0, lengthAll: 0, minutesIn: 0, minutesWork: 0,
            minutesOut: 0, minutesAll: 0, netDrop: 0 },
        gear: null, start: start, unit: unit };
    if (start === "" || adj[start] === undefined) {
        warnings.push("The start station is not on the surveyed line.");
        plan.gear = CsTripPlan.gear([], unit, cfg, o.packing);
        return plan;
    }
    var order = CsTripPlan.order(adj, start, o.targets || []);
    plan.unreachable = order.unreachable;
    plan.approximate = order.approximate;
    for (var u = 0; u < order.unreachable.length; u++) {
        warnings.push(order.unreachable[u] + " cannot be reached from " + start +
            " along the surveyed line.");
    }
    if (order.approximate) {
        warnings.push("More than 8 stops: the visiting order is approximate.");
    }

    var pitches = CsPitch.find(survey, resolved);
    var pitchIndex = {};
    var pp;
    for (pp = 0; pp < pitches.length; pp++) {
        for (var s2 = 0; s2 + 1 < pitches[pp].stations.length; s2++) {
            pitchIndex[pitches[pp].stations[s2] + "|" + pitches[pp].stations[s2 + 1]] = pp;
            pitchIndex[pitches[pp].stations[s2 + 1] + "|" + pitches[pp].stations[s2]] = pp;
        }
    }
    var pitchOfEdge = function(e) {
        var i = pitchIndex[e.from + "|" + e.to];
        return i === undefined ? -1 : i;
    };
    var notes = o.notes || CsStationTable.notesByStation(survey);
    var ctx = { degree: CsFrontier.degrees(survey), notes: notes,
        pitchOfEdge: pitchOfEdge, unit: unit };

    var at = start;
    var allEdges = [];
    var used = {};
    var i;
    for (i = 0; i < order.order.length; i++) {
        var target = order.order[i];
        // Reachable by construction (order() dropped what is not, and the
        // graph is undirected), guarded like the way home below.
        var edges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), target) || [];
        var steps = CsTripPlan.describe(edges, ctx);
        var mins = 0;
        for (var k = 0; k < steps.length; k++) {
            steps[k].minutes = CsTripPlan.stepMinutes(steps[k], unit, cfg, true);
            mins += steps[k].minutes;
            if (steps[k].kind === "pitch") { used[steps[k].pitch] = true; }
            plan.totals.lengthIn += steps[k].length;
            if (steps[k].dzKnown) { plan.totals.netDrop -= steps[k].dz; }
        }
        plan.stops.push({ station: target, steps: steps, minutesIn: mins });
        plan.totals.minutesIn += mins;
        plan.totals.minutesWork += cfg.leadWorkMin;
        allEdges = allEdges.concat(edges);
        at = target;
    }
    // The way out: the same route home, walked as a return leg.
    var homeEdges = CsTripPlan.pathTo(CsTripPlan.shortest(adj, at), start) || [];
    var backSteps = CsTripPlan.describe(homeEdges, ctx);
    for (var b = 0; b < backSteps.length; b++) {
        backSteps[b].minutes = CsTripPlan.stepMinutes(backSteps[b], unit, cfg, false);
        plan.back.minutes += backSteps[b].minutes;
        plan.totals.lengthAll += backSteps[b].length;
        if (backSteps[b].kind === "pitch") { used[backSteps[b].pitch] = true; }
    }
    plan.back.steps = backSteps;
    plan.totals.lengthAll += plan.totals.lengthIn;
    plan.totals.minutesOut = plan.back.minutes;
    plan.totals.minutesAll = plan.totals.minutesIn + plan.totals.minutesWork +
        plan.totals.minutesOut;

    var onRoute = [];
    for (var key in used) {
        if (Object.prototype.hasOwnProperty.call(used, key)) {
            onRoute.push(pitches[parseInt(key, 10)]);
        }
    }
    plan.pitches = onRoute;
    plan.gear = CsTripPlan.gear(onRoute, unit, cfg, o.packing);
    var tight = CsTripPlan.tightWarnings(survey, allEdges.concat(homeEdges), unit, cfg);
    var seenTight = {};
    for (var t = 0; t < tight.length; t++) {
        if (seenTight[tight[t]] !== true) { seenTight[tight[t]] = true; warnings.push(tight[t]); }
    }
    return plan;
};

// ---------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------

/** HTML-escape text. */
CsTripPlan.esc = function(text) {
    return String(text === undefined || text === null ? "" : text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
};

/** "1 h 05 min" for a number of minutes. */
CsTripPlan.clock = function(minutes) {
    var m = Math.round(minutes);
    if (m < 60) { return m + " min"; }
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h + " h " + (r < 10 ? "0" : "") + r + " min";
};

// ---------------------------------------------------------------------
// Highway-sign directions
// ---------------------------------------------------------------------

/** Classify a signed turn in degrees (positive = right) into an arrow. */
CsTripPlan.turnArrow = function(d) {
    while (d > 180) { d -= 360; }
    while (d <= -180) { d += 360; }
    var a = Math.abs(d);
    if (a < 20) { return "straight"; }
    if (a > 170) { return "uturn"; }
    var side = d < 0 ? "left" : "right";
    if (a < 60) { return "slight-" + side; }
    if (a < 120) { return side; }
    return "sharp-" + side;
};

/** Distance and time of the walking steps in a slice of a leg. */
CsTripPlan.segmentInfo = function(steps, from, to) {
    var info = { len: 0, mins: 0, haveMins: false, known: true, pitch: false };
    for (var i = from; i < to; i++) {
        if (steps[i].kind !== "walk") { info.pitch = true; continue; }
        if (typeof steps[i].length !== "number" || !isFinite(steps[i].length)) {
            info.known = false;
            continue;
        }
        info.len += steps[i].length;
        if (steps[i].minutes !== undefined && steps[i].minutes !== null) {
            info.mins += steps[i].minutes;
            info.haveMins = true;
        }
    }
    return info;
};

/** "189 ft · 3 min"; the time is left out when it rounds to under a minute. */
CsTripPlan.segmentText = function(steps, from, to, unit) {
    var info = CsTripPlan.segmentInfo(steps, from, to);
    var parts = [ CsTripPlan.dist(info.len, unit) ];
    if (info.haveMins && Math.round(info.mins) >= 1) {
        parts.push(CsTripPlan.clock(info.mins));
    }
    return parts.join(" · ");
};

/** Junctions closer than this (feet) are one wiggle, not two decisions. */
CsTripPlan.JOG_FT = 5;

/**
 * Signs for one leg. A sign exists only at a junction decision: step i
 * ends at a junction (atJunction) and step i+1 leaves by a branch. The
 * arrow is the turn from step i's bearing (0 = north, clockwise) to step
 * i+1's. An outgoing pitch is "down"/"up"; a pitch coming in loses the
 * orientation, so it is a "start" with the outgoing heading. Pitches are
 * left out of the distances between signs.
 *
 * INTERSECTIONS, NOT STATIONS. Underground nobody can tell which station
 * they are at; they can count intersections and estimate distance
 * (Nathan, 2026-09-29). So each sign is numbered: `index` is its place
 * in the leg counted AFTER jog merging, `total` the leg's count. `ways`
 * is how many passages meet there (the arriving step's degreeTo; a
 * merged chain of n stations is sum(degrees) - 2 * (n - 1)), or null
 * when a degree is unknown or under 3. `ref` is the first station of
 * the sign: a small map reference only. `label` is kept equal to ref.
 *
 * \param destination the station the leg ends at
 * \return {signs: [{arrow, index, total, ways, ref, label, toward,
 *          junction, headText}], connectors: [text] (one more than
 *          signs), destination}
 */
CsTripPlan.signs = function(steps, unit, destination) {
    var signs = [];
    var connectors = [];
    var bearingOf = function(st) {
        if (st.kind !== "walk" || st.heading === "" || st.heading === undefined) {
            return null;
        }
        if (st.dx * st.dx + st.dy * st.dy <= 0) { return null; }
        return Math.atan2(st.dx, st.dy) * 180 / Math.PI;
    };
    var norm = function(d) {
        while (d > 180) { d -= 360; }
        while (d <= -180) { d += 360; }
        return d;
    };
    var decisions = [];
    for (var i = 0; i < steps.length - 1; i++) {
        if (!steps[i].atJunction) { continue; }
        var inc = steps[i];
        var out = steps[i + 1];
        var sign = { arrow: "start", label: inc.to, toward: destination,
            junction: true, headText: "" };
        var turn = null;
        if (out.kind === "pitch") {
            sign.arrow = out.vertical === "up" ? "up" : "down";
        } else {
            var bi = bearingOf(inc);
            var bo = bearingOf(out);
            if (bi !== null && bo !== null) {
                turn = norm(bo - bi);
                sign.arrow = CsTripPlan.turnArrow(turn);
            } else if (out.heading) {
                sign.headText = "Head " + out.heading;
            }
        }
        sign.ref = inc.to;
        decisions.push({ i: i, sign: sign, turn: turn });
    }
    // Merge zigzag jogs: a decision whose turn is known and that follows the
    // previous kept one by a short, fully known, pitch-free walk.
    var jog = CsUnits.convert(CsTripPlan.JOG_FT, CsUnits.FEET, unit);
    var kept = [];
    for (var d = 0; d < decisions.length; d++) {
        var cur = decisions[d];
        var prev = kept.length > 0 ? kept[kept.length - 1] : null;
        if (prev !== null && prev.net !== null && cur.turn !== null) {
            var gap = CsTripPlan.segmentInfo(steps, prev.last + 1, cur.i + 1);
            if (gap.known && !gap.pitch && gap.len < jog) {
                prev.net = norm(prev.net + cur.turn);
                prev.last = cur.i;
                prev.sign.arrow = CsTripPlan.turnArrow(prev.net);
                prev.degrees.push(steps[cur.i].degreeTo);
                continue;
            }
        }
        kept.push({ i: cur.i, last: cur.i, sign: cur.sign, net: cur.turn,
            degrees: [ steps[cur.i].degreeTo ] });
    }
    // Passages meeting at a (merged) intersection: each joined pair of
    // stations shares one leg, counted once from each end.
    var waysOf = function(degrees) {
        var sum = 0;
        for (var w = 0; w < degrees.length; w++) {
            var dg = degrees[w];
            if (typeof dg !== "number" || !isFinite(dg) || dg < 3) { return null; }
            sum += dg;
        }
        var ways = sum - 2 * (degrees.length - 1);
        return ways >= 3 ? ways : null;
    };
    var last = 0;
    for (var k = 0; k < kept.length; k++) {
        connectors.push(CsTripPlan.segmentText(steps, last, kept[k].i + 1, unit));
        last = kept[k].i + 1;
        kept[k].sign.index = k + 1;
        kept[k].sign.total = kept.length;
        kept[k].sign.ways = waysOf(kept[k].degrees);
        kept[k].sign.label = kept[k].sign.ref;
        signs.push(kept[k].sign);
    }
    connectors.push(CsTripPlan.segmentText(steps, last, steps.length, unit));
    return { signs: signs, connectors: connectors, destination: destination };
};

/**
 * CSS for signsHtml; both printed pages add it to their <style>. ONE
 * column, top to bottom in route order: two columns made it unclear
 * which sign to look at next (Nathan, 2026-09-29).
 */
CsTripPlan.SIGNS_CSS = ".signs{margin:4px 0}" +
    ".signs .none{font-size:11px;color:#666}" +
    ".sign{display:flex;align-items:center;gap:8px;border:2px solid #111;" +
    "border-radius:8px;margin:2px 0;padding:3px 8px 3px 3px;" +
    "break-inside:avoid;page-break-inside:avoid;background:#fff;color:#111}" +
    ".sign .arrow{flex:none;width:34px;height:34px;background:#111;" +
    "border-radius:5px;display:flex;align-items:center;justify-content:center}" +
    ".sign .arrow svg{width:26px;height:26px}" +
    ".sign .body{flex:1}.sign .label{font-size:16px;font-weight:bold;line-height:1.15}" +
    ".sign .head,.sign .meta,.sign .snote{font-size:11px;color:#555}" +
    ".legsum{font-size:12px;color:#444;margin:0 0 2px}" +
    ".sign .reach{flex:none;width:90px;text-align:right;font-size:11px;color:#666}" +
    ".sign .tag{display:inline-block;font-size:10px;font-weight:bold;" +
    "border:1px solid #111;border-radius:4px;padding:0 4px;margin-left:8px;" +
    "vertical-align:middle}";

/** The rotation of each arrow kind, degrees clockwise. */
CsTripPlan.SIGN_ANGLES = { "straight": 0, "slight-right": 45, "right": 90,
    "sharp-right": 135, "uturn": 180, "slight-left": -45, "left": -90,
    "sharp-left": -135 };

/** The inline arrow: white on the dark square. */
CsTripPlan.signArrowSvg = function(arrow) {
    var head = "M20 4 L32 18 H24 V34 H16 V18 H8 Z";
    var body;
    if (arrow === "start") {
        body = "<path d=\"M12 6 L28 20 L12 34 L12 27 L21 20 L12 13 Z\" fill=\"#fff\"/>";
    } else if (arrow === "down" || arrow === "up") {
        if (arrow === "down") {
            body = "<path d=\"M20 4 V22\" stroke=\"#fff\" stroke-width=\"3\" " +
                "stroke-dasharray=\"4 3\" fill=\"none\"/>" +
                "<path d=\"M8 22 H32 L20 36 Z\" fill=\"#fff\"/>";
        } else {
            body = "<path d=\"M20 36 V18\" stroke=\"#fff\" stroke-width=\"3\" " +
                "stroke-dasharray=\"4 3\" fill=\"none\"/>" +
                "<path d=\"M8 18 H32 L20 4 Z\" fill=\"#fff\"/>";
        }
    } else {
        var angle = CsTripPlan.SIGN_ANGLES[arrow] || 0;
        body = "<path d=\"" + head + "\" fill=\"#fff\" transform=\"rotate(" +
            angle + " 20 20)\"/>";
    }
    return "<svg viewBox=\"0 0 40 40\" aria-hidden=\"true\">" + body + "</svg>";
};

/** "of 7 · 3-way · map ref A11": the small line under "Intersection 3". */
CsTripPlan.signMeta = function(sg) {
    var parts = [ "of " + sg.total ];
    if (typeof sg.ways === "number" && sg.ways >= 3) { parts.push(sg.ways + "-way"); }
    parts.push("map ref " + sg.ref);
    return parts.join(" · ");
};

/** The one line for a leg with no intersections (see signs). */
CsTripPlan.noSignsText = function(leg) {
    return "No intersections: follow the passage to " + leg.destination +
        " (" + leg.connectors[0] + ")";
};

/**
 * HTML for one leg's signs (see signs). A row is: the walk to reach it,
 * the arrow, "Intersection N" in large type and "of 7 · 3-way · map ref
 * A11" small under it. Every string goes through esc.
 */
CsTripPlan.signsHtml = function(leg) {
    var esc = CsTripPlan.esc;
    var h = [ "<div class=\"signs" + (leg.signs.length === 0 ? " solo" : "") + "\">" ];
    if (leg.signs.length === 0) {
        h.push("<div class=\"none\">" + esc(CsTripPlan.noSignsText(leg)) + "</div>");
        h.push("</div>");
        return h.join("");
    }
    var reach = function(text, name) {
        var t = esc("distance and time to reach " + name);
        return "<div class=\"reach\" title=\"" + t + "\" aria-label=\"" + t + "\">" +
            esc(text) + "</div>";
    };
    for (var i = 0; i < leg.signs.length; i++) {
        var sg = leg.signs[i];
        h.push("<div class=\"sign\">" +
            reach(leg.connectors[i], "intersection " + sg.index) +
            "<div class=\"arrow\">" + CsTripPlan.signArrowSvg(sg.arrow) +
            "</div><div class=\"body\">" +
            (sg.headText !== "" ? "<div class=\"head\">" + esc(sg.headText) + "</div>" : "") +
            "<div class=\"label\">" + esc("Intersection " + sg.index) + "</div>" +
            "<div class=\"meta\">" + esc(CsTripPlan.signMeta(sg)) + "</div>" +
            "</div></div>");
    }
    h.push("<div class=\"sign arrive\">" +
        reach(leg.connectors[leg.signs.length], leg.destination) +
        "<div class=\"arrow\"><svg viewBox=\"0 0 40 40\" aria-hidden=\"true\">" +
        "<path d=\"M12 6 V34 M12 8 H32 L24 15 L32 22 H12\" fill=\"#fff\" " +
        "stroke=\"#fff\" stroke-width=\"3\"/></svg></div>" +
        "<div class=\"body\"><div class=\"label\">Arrive " + esc(leg.destination) +
        "</div><div class=\"meta\">your stop</div></div></div>");
    h.push("</div>");
    return h.join("");
};

/**
 * One line under a leg's heading: "7 intersections · 1240 ft · about
 * 6 min". The distance is the leg's walking (pitches left out, as in the
 * connectors); the time is every step's minutes, pitches included, which
 * is the plan's time for the leg. A time that rounds under a minute is
 * "under a minute", never "0 min".
 */
CsTripPlan.legSummary = function(leg, steps, unit) {
    var n = leg.signs.length;
    var count = n === 0 ? "No intersections, straight through" :
        n + " intersection" + (n === 1 ? "" : "s");
    var info = CsTripPlan.segmentInfo(steps, 0, steps.length);
    var mins = 0;
    for (var i = 0; i < steps.length; i++) {
        if (typeof steps[i].minutes === "number" && isFinite(steps[i].minutes)) {
            mins += steps[i].minutes;
        }
    }
    var time = Math.round(mins) >= 1 ? "about " + CsTripPlan.clock(mins) : "under a minute";
    return [ count, CsTripPlan.dist(info.len, unit), time ].join(" · ");
};

/** The leg summary as a page line, for both printed pages. */
CsTripPlan.legSummaryHtml = function(leg, steps, unit) {
    return "<div class=\"legsum\">" +
        CsTripPlan.esc(CsTripPlan.legSummary(leg, steps, unit)) + "</div>";
};

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st, 101st, 111th. */
CsTripPlan.ordinal = function(n) {
    var h = n % 100;
    var t = n % 10;
    var suffix = "th";
    if (h < 11 || h > 13) {
        if (t === 1) { suffix = "st"; }
        else if (t === 2) { suffix = "nd"; }
        else if (t === 3) { suffix = "rd"; }
    }
    return String(n) + suffix;
};

/** What to do at a sign, in words. */
CsTripPlan.SIGN_WORDS = { "straight": "keep straight",
    "slight-left": "go slight left", "left": "turn left",
    "sharp-left": "turn sharp left", "slight-right": "go slight right",
    "right": "turn right", "sharp-right": "turn sharp right",
    "uturn": "turn back", "down": "climb down the pitch",
    "up": "climb up the pitch" };

/**
 * One leg's signs as plain-text lines (the panel's plan text):
 * "  1. Walk 251 ft, then at the 1st intersection (3-way, map ref A11)
 * go slight left" ... "  Arrive B20 after 63 ft". A walk of nothing
 * (only a pitch before the sign) is left out rather than printed as 0.
 */
CsTripPlan.signsText = function(leg) {
    var lines = [];
    if (leg.signs.length === 0) {
        return [ "  " + CsTripPlan.noSignsText(leg) ];
    }
    var walked = function(text) {
        var d = String(text).split(" · ")[0];
        return /^0 /.test(d) ? "" : d;
    };
    for (var i = 0; i < leg.signs.length; i++) {
        var sg = leg.signs[i];
        var what;
        if (sg.arrow === "start") {
            what = sg.headText !== "" ?
                sg.headText.charAt(0).toLowerCase() + sg.headText.slice(1) : "continue";
        } else {
            what = CsTripPlan.SIGN_WORDS[sg.arrow] || "continue";
        }
        var where = [];
        if (typeof sg.ways === "number" && sg.ways >= 3) { where.push(sg.ways + "-way"); }
        where.push("map ref " + sg.ref);
        var at = "the " + CsTripPlan.ordinal(sg.index) + " intersection (" +
            where.join(", ") + ") " + what;
        var d = walked(leg.connectors[i]);
        lines.push("  " + sg.index + ". " + (d === "" ? "At " + at :
            "Walk " + d + ", then at " + at));
    }
    var end = walked(leg.connectors[leg.signs.length]);
    lines.push("  Arrive " + leg.destination + (end === "" ? "" : " after " + end));
    return lines;
};

/**
 * A plan-view sketch: every leg in grey, the route in red, the stops
 * as dots with their names. Positions are NORMALISED into the drawing
 * box and never printed, so the page shows the cave's shape and no
 * coordinates.
 */
CsTripPlan.routeSvg = function(survey, resolved, plan) {
    var W = 640, H = 420, pad = 24;
    var pts = resolved.stations;
    var names = [];
    var n;
    for (n in pts) {
        if (Object.prototype.hasOwnProperty.call(pts, n)) { names.push(n); }
    }
    if (names.length === 0) { return ""; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < names.length; i++) {
        var p = pts[names[i]];
        if (p.x < minX) { minX = p.x; }
        if (p.x > maxX) { maxX = p.x; }
        if (p.y < minY) { minY = p.y; }
        if (p.y > maxY) { maxY = p.y; }
    }
    var span = Math.max(maxX - minX, maxY - minY, 1e-9);
    var scale = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
    var px = function(name) {
        return Math.round(pad + (pts[name].x - minX) * scale);
    };
    // y is flipped: north is up on the page.
    var py = function(name) {
        return Math.round(H - pad - (pts[name].y - minY) * scale);
    };
    var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + W +
        " " + H + "\" width=\"100%\" role=\"img\" aria-label=\"Route sketch\">";
    svg += "<rect width=\"" + W + "\" height=\"" + H + "\" fill=\"#fff\" stroke=\"#ccc\"/>";
    for (var s = 0; s < survey.shots.length; s++) {
        var sh = survey.shots[s];
        if (!CsFrontier.isLeg(sh)) { continue; }
        var a = CsFrontier.clean(sh.from);
        var b = CsFrontier.clean(sh.to);
        if (pts[a] === undefined || pts[b] === undefined) { continue; }
        svg += "<line x1=\"" + px(a) + "\" y1=\"" + py(a) + "\" x2=\"" + px(b) +
            "\" y2=\"" + py(b) + "\" stroke=\"#999\" stroke-width=\"1.5\"/>";
    }
    var groups = [];
    for (var st = 0; st < plan.stops.length; st++) {
        for (var sp = 0; sp < plan.stops[st].steps.length; sp++) {
            groups.push(plan.stops[st].steps[sp]);
        }
    }
    for (var g = 0; g < groups.length; g++) {
        for (var e = 0; e < groups[g].edges.length; e++) {
            var ed = groups[g].edges[e];
            if (pts[ed.from] === undefined || pts[ed.to] === undefined) { continue; }
            svg += "<line x1=\"" + px(ed.from) + "\" y1=\"" + py(ed.from) +
                "\" x2=\"" + px(ed.to) + "\" y2=\"" + py(ed.to) +
                "\" stroke=\"#c0392b\" stroke-width=\"3\"/>";
        }
    }
    var mark = function(name, fill) {
        if (pts[name] === undefined) { return ""; }
        return "<circle cx=\"" + px(name) + "\" cy=\"" + py(name) +
            "\" r=\"5\" fill=\"" + fill + "\"/><text x=\"" + (px(name) + 8) +
            "\" y=\"" + (py(name) - 6) + "\" font-size=\"12\" fill=\"#222\">" +
            CsTripPlan.esc(name) + "</text>";
    };
    svg += mark(plan.start, "#2c3e50");
    for (var k = 0; k < plan.stops.length; k++) {
        svg += mark(plan.stops[k].station, "#c0392b");
    }
    svg += "</svg>";
    return svg;
};

/**
 * The plan as one printable HTML page. No coordinates, no entrance
 * wording, no basemap: it is meant to be carried by an unguided team.
 *
 * \param ctx {title, survey, resolved, date}
 */
CsTripPlan.packetHtml = function(plan, ctx) {
    var esc = CsTripPlan.esc;
    var unit = plan.unit;
    var t = plan.totals;
    var h = [];
    h.push("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">");
    h.push("<title>" + esc(ctx.title) + " trip plan</title>");
    h.push("<style>body{font:14px/1.45 -apple-system,Helvetica,Arial,sans-serif;" +
        "max-width:760px;margin:24px auto;padding:0 16px;color:#222}" +
        "h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #ccc}" +
        "li{margin:3px 0}.note{color:#555}.warn{color:#8a4b00}" +
        "table{border-collapse:collapse}td{padding:2px 12px 2px 0}" +
        "pre{white-space:pre-wrap;font:inherit}" + CsTripPlan.SIGNS_CSS +
        "</style></head><body>");
    h.push("<h1>" + esc(ctx.title) + " &mdash; trip plan</h1>");
    if (ctx.date) { h.push("<p class=\"note\">" + esc(ctx.date) + "</p>"); }
    h.push("<p class=\"note\">This route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy: crawls, water, climbs and " +
        "loose ground are only known where someone wrote them down.</p>");

    h.push("<h2>Objectives</h2><ol>");
    for (var i = 0; i < plan.stops.length; i++) {
        h.push("<li>" + esc(plan.stops[i].station) + "</li>");
    }
    h.push("</ol>");

    h.push("<h2>Time budget</h2><table>");
    h.push("<tr><td>In</td><td>" + CsTripPlan.clock(t.minutesIn) + "</td></tr>");
    h.push("<tr><td>Work at objectives</td><td>" + CsTripPlan.clock(t.minutesWork) + "</td></tr>");
    h.push("<tr><td>Out</td><td>" + CsTripPlan.clock(t.minutesOut) + "</td></tr>");
    h.push("<tr><td><b>Total</b></td><td><b>" + CsTripPlan.clock(t.minutesAll) +
        "</b></td></tr></table>");
    h.push("<p class=\"note\">Distance in " + CsTripPlan.dist(t.lengthIn, unit) +
        ", " + CsTripPlan.dist(t.lengthAll, unit) + " there and back. Timed at a " +
        "hiking pace on the level; pitches are timed separately.</p>");

    h.push("<h2>Route</h2>");
    h.push(CsTripPlan.routeSvg(ctx.survey, ctx.resolved, plan));

    h.push("<h2>Directions</h2>");
    var start = plan.start;
    for (var s = 0; s < plan.stops.length; s++) {
        h.push("<h3>To " + esc(plan.stops[s].station) + "</h3>");
        var legIn = CsTripPlan.signs(plan.stops[s].steps, unit, plan.stops[s].station);
        h.push(CsTripPlan.legSummaryHtml(legIn, plan.stops[s].steps, unit));
        h.push(CsTripPlan.signsHtml(legIn));
        for (var k = 0; k < plan.stops[s].steps.length; k++) {
            var notes = plan.stops[s].steps[k].notes || [];
            for (var n = 0; n < notes.length; n++) {
                h.push("<div class=\"note\">Note &mdash; " + esc(notes[n]) + "</div>");
            }
        }
    }
    h.push("<h3>Back to " + esc(start) + "</h3>");
    var legOut = CsTripPlan.signs(plan.back.steps, unit, start);
    h.push(CsTripPlan.legSummaryHtml(legOut, plan.back.steps, unit));
    h.push(CsTripPlan.signsHtml(legOut));

    if (plan.warnings.length > 0) {
        h.push("<h2>Watch for</h2><ul>");
        for (var w = 0; w < plan.warnings.length; w++) {
            h.push("<li class=\"warn\">" + esc(plan.warnings[w]) + "</li>");
        }
        h.push("</ul>");
    }

    h.push("<h2>Gear</h2>");
    if (plan.gear.rope.length > 0) {
        h.push("<h3>Rope and hardware</h3><ul>");
        for (var r = 0; r < plan.gear.rope.length; r++) {
            h.push("<li>" + esc(plan.gear.rope[r].text) + "</li>");
        }
        for (var q = 0; q < plan.gear.hardware.length; q++) {
            h.push("<li class=\"warn\">" + esc(plan.gear.hardware[q]) + "</li>");
        }
        h.push("</ul>");
    }
    h.push("<h3>Personal kit <span class=\"note\">(a starting list &mdash; edit it)</span></h3><ul>");
    for (var g = 0; g < plan.gear.kit.length; g++) {
        h.push("<li>" + esc(plan.gear.kit[g]) + "</li>");
    }
    h.push("</ul>");
    if (plan.gear.packing !== "") {
        h.push("<h3>Team packing list</h3><pre>" + esc(plan.gear.packing) + "</pre>");
    }
    h.push("</body></html>");
    return h.join("\n");
};
