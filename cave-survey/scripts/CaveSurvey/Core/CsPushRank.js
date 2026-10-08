// CsPushRank.js -- what's left to push: every lead, ranked, with reasons.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// no file I/O, no clock (the caller passes `today`), no randomness.
// Never throws; degenerate input gives {leads: [], notes: []}.
//
// SIX SIGNALS, EACH 0-100 OR NULL. A signal that cannot be computed is
// null and is left out of the total -- never guessed. The total is the
// weighted mean over the signals a lead HAS, so a lead with no heading
// is not punished for the pitch it sits at the foot of.
//
// THE REASONS MATTER AS MUCH AS THE ORDER. Every signal carries a plain
// sentence; a lead's reasons are its strongest weighted contributions
// plus, always, what it costs to get there.
//
// NO COORDINATES IN ANY TEXT. Positions are used to measure (headings,
// what the line of sight hits, elevation); only station names and whole
// distances in feet reach a sentence.
//
// See docs/superpowers/specs/2026-09-30-whats-left-to-push-design.md.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsUnits.js");
include(includeBasePath + "/CsStationTable.js");
include(includeBasePath + "/CsTripPlan.js");

var CsPushRank = {};

/** The signals, in the order they are listed and tie-broken. */
CsPushRank.SIGNALS = ["cost", "blank", "connect", "elevation", "recency", "hints"];

/** The weight presets; they are normalised, so they need not sum to 1. */
CsPushRank.PRESETS = {
    quick: { cost: 0.50, blank: 0.10, connect: 0.10, elevation: 0.05, recency: 0.10, hints: 0.15 },
    potential: { cost: 0.10, blank: 0.25, connect: 0.25, elevation: 0.15, recency: 0.10, hints: 0.15 },
    balanced: { cost: 0.25, blank: 0.20, connect: 0.15, elevation: 0.10, recency: 0.15, hints: 0.15 }
};

/** Words in a lead's notes that make it worth more, and less. */
CsPushRank.POSITIVE = ["draft", "wind", "airflow", "breeze", "going", "continues", "big",
    "borehole", "booming", "echo"];
CsPushRank.NEGATIVE = ["tight", "ended", "choked", "sump", "pinches", "blocked", "dead"];

/** Geometry and scoring constants, in FEET and MINUTES. */
CsPushRank.RAY_FT = 500;          // how far ahead the line of sight looks
CsPushRank.CORRIDOR_FT = 30;      // half-width of the line of sight
CsPushRank.BLANK_FULL_FT = 300;   // blank ground scoring 100
CsPushRank.CONNECT_FT = 150;      // a hit this near may be a connection
CsPushRank.TOUCH_FT = 60;         // a hit this near is not blank ground
CsPushRank.LOOP_FACTOR = 3;       // graph distance >= this x straight = far along
CsPushRank.OWN_HOPS = 3;          // legs this near the lead are its own passage
CsPushRank.COST_FREE_MIN = 15;
CsPushRank.COST_ZERO_MIN = 240;
CsPushRank.PITCH_PENALTY = 15;
CsPushRank.MIN_RANGE_FT = 20;     // an elevation range under this says nothing
CsPushRank.MIDDLE_EDGE = 0.25;    // edge under this reads "near the middle"
CsPushRank.RECENCY_FULL_MONTHS = 24;

var csPrIsArr = function(v) {
    return Object.prototype.toString.call(v) === "[object Array]";
};
var csPrArr = function(v) { return csPrIsArr(v) ? v : []; };
var csPrObj = function(v) {
    return (v !== null && typeof v === "object" && !csPrIsArr(v)) ? v : {};
};
var csPrFinite = function(v) { return typeof v === "number" && isFinite(v); };
var csPrHas = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
var csPrR1 = function(v) { return Math.round(v * 10) / 10; };

/** The preset's weights, as a copy; an unknown preset is balanced. */
CsPushRank.weightsFor = function(preset) {
    var key = (typeof preset === "string" && csPrHas(CsPushRank.PRESETS, preset)) ?
        preset : "balanced";
    var src = CsPushRank.PRESETS[key];
    var out = {};
    for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
        out[CsPushRank.SIGNALS[i]] = src[CsPushRank.SIGNALS[i]];
    }
    return out;
};

/** Preset weights overlaid with the caller's (finite and >= 0 only). */
var csPrWeights = function(preset, weights) {
    var out = CsPushRank.weightsFor(preset);
    var w = csPrObj(weights);
    for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
        var k = CsPushRank.SIGNALS[i];
        if (csPrHas(w, k) && csPrFinite(w[k]) && w[k] >= 0) { out[k] = w[k]; }
    }
    return out;
};

/** A hint list: the caller's array (trimmed, lower-case) or the default. */
var csPrWords = function(list, fallback) {
    if (!csPrIsArr(list)) { return fallback.slice(0); }
    var out = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i] === null || list[i] === undefined || typeof list[i] === "object") { continue; }
        var w = String(list[i]).replace(/^\s+|\s+$/g, "").toLowerCase();
        if (w !== "" && out.indexOf(w) < 0) { out.push(w); }
    }
    return out;
};

/** {y, m, d} from "yyyy-mm-dd" or "yyyy-mm" (day 1), else null. */
var csPrDate = function(text) {
    if (typeof text !== "string") { return null; }
    var m = /^\s*(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\s*$/.exec(text);
    if (m === null) { return null; }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    var d = m[3] === undefined ? 1 : parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) { return null; }
    return { y: y, m: mo, d: d };
};

var csPrPad = function(n) { return (n < 10 ? "0" : "") + n; };

// ---------------------------------------------------------------------
// The signals
// ---------------------------------------------------------------------

/**
 * Cost: the single-stop plan, walk in, work, walk out.
 * \return {signal, minutes, reachable}
 */
var csPrCost = function(ctx, station) {
    if (csPrHas(ctx.plans, station)) { return ctx.plans[station]; }
    var res = { signal: null, minutes: null, reachable: false };
    var plan = null;
    try {
        plan = CsTripPlan.build(ctx.survey, ctx.resolved, { start: ctx.start,
            targets: [station], unit: ctx.unit, config: ctx.config, notes: ctx.notes });
    } catch (e) {
        plan = null;
    }
    if (plan !== null) {
        var stop = null;
        for (var i = 0; i < plan.stops.length; i++) {
            if (plan.stops[i].station === station) { stop = plan.stops[i]; }
        }
        var atStart = stop === null && station === plan.start && plan.start !== "" &&
            ctx.adj[plan.start] !== undefined;
        if (stop !== null || atStart) {
            var cfg = CsTripPlan.config(ctx.config);
            var minutesIn = stop !== null ? plan.totals.minutesIn : 0;
            var minutes = stop !== null ? plan.totals.minutesAll : cfg.leadWorkMin;
            var score;
            if (minutes <= CsPushRank.COST_FREE_MIN) { score = 100; }
            else if (minutes >= CsPushRank.COST_ZERO_MIN) { score = 0; }
            else {
                score = 100 * (CsPushRank.COST_ZERO_MIN - minutes) /
                    (CsPushRank.COST_ZERO_MIN - CsPushRank.COST_FREE_MIN);
            }
            var pitches = stop !== null ? csPrArr(plan.pitches).length : 0;
            if (pitches > 0) { score = Math.max(0, score - CsPushRank.PITCH_PENALTY); }
            var text = Math.round(minutesIn) + " min in, ";
            if (pitches === 0) {
                text += "no pitch, no rope";
            } else {
                text += pitches + (pitches === 1 ? " pitch" : " pitches");
                var rope = plan.gear !== null && plan.gear !== undefined ?
                    csPrArr(plan.gear.rope) : [];
                var need = 0;
                for (var r = 0; r < rope.length; r++) {
                    if (csPrFinite(rope[r].need)) { need += rope[r].need; }
                }
                if (need > 0) { text += ", " + Math.round(need) + " " + plan.unit + " of rope"; }
            }
            res = { signal: { score: score, text: text }, minutes: Math.round(minutes),
                reachable: true };
        }
    }
    ctx.plans[station] = res;
    return res;
};

/** The leg arriving at a station: the last trip's, then the last shot. */
var csPrArriving = function(ctx, station) {
    var best = null;
    var shots = csPrArr(ctx.survey.shots);
    for (var i = 0; i < shots.length; i++) {
        var sh = shots[i];
        if (!CsFrontier.isLeg(sh) || CsFrontier.clean(sh.to) !== station) { continue; }
        var trip = csPrFinite(sh.trip) ? sh.trip : 0;
        if (best === null || trip >= best.trip) {
            best = { trip: trip, from: CsFrontier.clean(sh.from) };
        }
    }
    return best;
};

/** Plan position in feet, or null. */
var csPrPos = function(ctx, name) {
    var p = ctx.stations[name];
    if (p === undefined || p === null || !csPrFinite(p.x) || !csPrFinite(p.y)) { return null; }
    return { x: p.x * ctx.toFt, y: p.y * ctx.toFt, z: csPrFinite(p.z) ? p.z * ctx.toFt : null };
};

/** Station -> legs away from `station` over the survey legs (BFS). */
var csPrHops = function(ctx, station) {
    var hops = {};
    hops[station] = 0;
    var queue = [station];
    for (var q = 0; q < queue.length; q++) {
        var at = queue[q];
        if (hops[at] >= CsPushRank.OWN_HOPS) { continue; }
        var next = ctx.legAdj[at] || [];
        for (var k = 0; k < next.length; k++) {
            if (hops[next[k]] === undefined) {
                hops[next[k]] = hops[at] + 1;
                queue.push(next[k]);
            }
        }
    }
    return hops;
};

/**
 * The line of sight from a lead along its arriving heading.
 * \return null (no heading) or {hit: null | {ft, station}}
 */
var csPrRay = function(ctx, station) {
    var arr = csPrArriving(ctx, station);
    if (arr === null) { return null; }
    var a = csPrPos(ctx, arr.from);
    var p = csPrPos(ctx, station);
    if (a === null || p === null) { return null; }
    var dx = p.x - a.x, dy = p.y - a.y;
    var plan = Math.sqrt(dx * dx + dy * dy);
    var len = (a.z !== null && p.z !== null) ?
        Math.sqrt(plan * plan + (p.z - a.z) * (p.z - a.z)) : plan;
    if (!(plan > 0 && plan > len * CsTripPlan.PLUMB_FRACTION)) { return null; }
    var ux = dx / plan, uy = dy / plan;
    var hops = csPrHops(ctx, station);
    var R = CsPushRank.RAY_FT, W = CsPushRank.CORRIDOR_FT;
    var hop = function(n) { return hops[n] === undefined ? Infinity : hops[n]; };
    var best = null;
    for (var i = 0; i < ctx.segs.length; i++) {
        var sg = ctx.segs[i];
        if (Math.min(hop(sg.a), hop(sg.b)) < CsPushRank.OWN_HOPS) { continue; }
        // Into ray coordinates: t along the heading, s to its left.
        var ta = (sg.ax - p.x) * ux + (sg.ay - p.y) * uy;
        var sa = -(sg.ax - p.x) * uy + (sg.ay - p.y) * ux;
        var tb = (sg.bx - p.x) * ux + (sg.by - p.y) * uy;
        var sb = -(sg.bx - p.x) * uy + (sg.by - p.y) * ux;
        // Liang-Barsky: clip u in [0, 1] to 0 <= t <= R, -W <= s <= W.
        var u0 = 0, u1 = 1, inside = true;
        var clip = function(pp, qq) {
            if (pp === 0) { if (qq < 0) { inside = false; } return; }
            var rr = qq / pp;
            if (pp < 0) { if (rr > u1) { inside = false; } else if (rr > u0) { u0 = rr; } }
            else { if (rr < u0) { inside = false; } else if (rr < u1) { u1 = rr; } }
        };
        clip(-(tb - ta), ta);          // t >= 0
        if (inside) { clip(tb - ta, R - ta); }        // t <= R
        if (inside) { clip(-(sb - sa), sa + W); }     // s >= -W
        if (inside) { clip(sb - sa, W - sa); }        // s <= W
        if (!inside || u0 > u1) { continue; }
        var t0 = ta + u0 * (tb - ta), t1 = ta + u1 * (tb - ta);
        var u = t0 <= t1 ? u0 : u1;
        var t = Math.max(0, Math.min(t0, t1));
        var near = u < 0.5 ? sg.a : (u > 0.5 ? sg.b :
            (CsStationTable.compareNatural(sg.a, sg.b) <= 0 ? sg.a : sg.b));
        if (best === null || t < best.ft - 1e-9 ||
                (Math.abs(t - best.ft) <= 1e-9 &&
                 CsStationTable.compareNatural(near, best.station) < 0)) {
            best = { ft: t, station: near };
        }
    }
    return { hit: best };
};

/** Blank ground ahead and connection potential, from one ray. */
var csPrDirection = function(ctx, station) {
    var ray = csPrRay(ctx, station);
    if (ray === null) { return { blank: null, connect: null }; }
    var hit = ray.hit;
    var blank;
    if (hit === null) {
        blank = { score: 100, text: "nothing surveyed for more than " +
            CsPushRank.RAY_FT + " ft ahead" };
    } else if (hit.ft <= CsPushRank.TOUCH_FT) {
        blank = { score: 0, text: "surveyed passage " + Math.round(hit.ft) + " ft ahead" };
    } else {
        blank = { score: Math.min(100, hit.ft / CsPushRank.BLANK_FULL_FT * 100),
            text: "nothing surveyed for " + Math.round(hit.ft) + " ft ahead" };
    }
    var connect = null;
    if (hit !== null && hit.ft <= CsPushRank.CONNECT_FT) {
        var sp = CsTripPlan.shortest(ctx.adj, station);
        var g = sp.dist[hit.station];
        var graphFt = csPrFinite(g) ? g * ctx.toFt : Infinity;
        if (graphFt >= CsPushRank.LOOP_FACTOR * hit.ft) {
            connect = { score: 100 - (hit.ft / CsPushRank.CONNECT_FT) * 60,
                text: "points at " + hit.station + ", " + Math.round(hit.ft) + " ft away (" +
                    (graphFt === Infinity ? "not joined to it by the surveyed way" :
                        Math.round(graphFt) + " ft by the surveyed way") + ")" };
        }
    }
    return { blank: blank, connect: connect };
};

/** Elevation edge: how near the top or the bottom of the cave. */
var csPrElevation = function(ctx, row) {
    var z = null;
    if (csPrFinite(row.z)) { z = row.z * ctx.toFt; }
    else if (row.z === undefined) {
        var p = csPrPos(ctx, row.station);
        if (p !== null) { z = p.z; }
    }
    if (z === null || ctx.zMin === null) { return null; }
    var lo = Math.min(ctx.zMin, z), hi = Math.max(ctx.zMax, z);
    var range = hi - lo;
    if (range < CsPushRank.MIN_RANGE_FT) { return null; }
    var mid = (hi + lo) / 2;
    var edge = Math.min(1, Math.abs(z - mid) / (range / 2));
    var text;
    if (edge < CsPushRank.MIDDLE_EDGE) {
        text = "near the middle elevation";
    } else if (z >= mid) {
        var dTop = Math.round(hi - z);
        text = dTop === 0 ? "at the highest surveyed level" :
            dTop + " ft below the highest surveyed station";
    } else {
        var dBot = Math.round(z - lo);
        text = dBot === 0 ? "at the deepest surveyed level" :
            dBot + " ft above the deepest surveyed station";
    }
    return { score: 100 * edge, text: text };
};

/** Time since visited: by date when every trip has one, else by order. */
var csPrRecency = function(ctx, row) {
    var trips = csPrArr(row.trips);
    var last = null;
    for (var i = 0; i < trips.length; i++) {
        if (csPrFinite(trips[i]) && (last === null || trips[i] > last)) { last = trips[i]; }
    }
    if (last === null) { return null; }
    if (ctx.dated) {
        var d = ctx.tripDate(last);
        var t = ctx.today;
        if (d !== null) {
            var months = (t.y - d.y) * 12 + (t.m - d.m) - (t.d < d.d ? 1 : 0);
            if (months < 0) { months = 0; }
            var when = months === 0 ? "less than a month ago" :
                months + (months === 1 ? " month ago" : " months ago");
            return { score: Math.min(100, months / CsPushRank.RECENCY_FULL_MONTHS * 100),
                text: "last surveyed " + d.y + "-" + csPrPad(d.m) + ", " + when };
        }
    }
    var n = ctx.tripCount;
    if (n <= 1) { return null; }
    var k = Math.min(last, n - 1);
    var of = " (trip " + (k + 1) + " of " + n + ")";
    var text = k === 0 ? "surveyed on the oldest trip" + of :
        (k === n - 1 ? "surveyed on the newest trip" + of :
            "last surveyed on trip " + (k + 1) + " of " + n);
    return { score: 100 * (n - 1 - k) / (n - 1), text: text };
};

/** Hint words in the notes, whole words, case-insensitive. */
var csPrHints = function(ctx, row) {
    var text = (typeof row.noteText === "string" ? row.noteText : "");
    if (typeof row.team === "string" && row.team !== "") { text += " | " + row.team; }
    if (text === "") { return null; }
    var found = [];
    var scan = function(list, sign) {
        for (var i = 0; i < list.length; i++) {
            var esc = list[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var m = new RegExp("(^|[^A-Za-z0-9_])(" + esc + ")(?=[^A-Za-z0-9_]|$)", "i").exec(text);
            if (m !== null) {
                found.push({ word: list[i], sign: sign, at: m.index + m[1].length,
                    order: found.length });
            }
        }
    };
    scan(ctx.positive, 1);
    scan(ctx.negative, -1);
    if (found.length === 0) { return null; }
    found.sort(function(a, b) { return a.at !== b.at ? a.at - b.at : a.order - b.order; });
    var score = 50;
    var words = [];
    for (var f = 0; f < found.length; f++) {
        score += 25 * found[f].sign;
        if (words.indexOf(found[f].word) < 0) { words.push(found[f].word); }
    }
    return { score: Math.max(0, Math.min(100, score)), text: "note says: " + words.join(", ") };
};

// ---------------------------------------------------------------------
// The ranking
// ---------------------------------------------------------------------

/** The context every lead is measured in: built once per rank(). */
var csPrContext = function(input) {
    var survey = (input.survey !== null && typeof input.survey === "object" &&
        csPrIsArr(input.survey.shots)) ? input.survey : { shots: [] };
    var resolved = (input.resolved !== null && typeof input.resolved === "object" &&
        input.resolved.stations !== null && typeof input.resolved.stations === "object") ?
        input.resolved : { stations: {} };
    var unit = CsUnits.normalize(input.unit) || CsUnits.normalize(survey.distanceUnit) ||
        CsUnits.FEET;
    var ctx = {
        survey: survey, resolved: resolved, stations: resolved.stations, unit: unit,
        toFt: CsUnits.convert(1, unit, CsUnits.FEET),
        config: csPrObj(input.config),
        start: typeof input.start === "string" ? input.start : undefined,
        plans: {},
        positive: csPrWords(input.positive, CsPushRank.POSITIVE),
        negative: csPrWords(input.negative, CsPushRank.NEGATIVE)
    };
    ctx.notes = CsStationTable.notesByStation(survey);
    ctx.adj = CsTripPlan.graph(survey, resolved);

    // Legs by name (for hops) and as plan segments in feet (for the ray).
    ctx.legAdj = {};
    ctx.segs = [];
    var maxTrip = -1;
    var usedTrips = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        if (!CsFrontier.isLeg(sh)) { continue; }
        var a = CsFrontier.clean(sh.from), b = CsFrontier.clean(sh.to);
        if (ctx.legAdj[a] === undefined) { ctx.legAdj[a] = []; }
        if (ctx.legAdj[b] === undefined) { ctx.legAdj[b] = []; }
        ctx.legAdj[a].push(b);
        ctx.legAdj[b].push(a);
        var trip = csPrFinite(sh.trip) ? sh.trip : 0;
        usedTrips[trip] = true;
        if (trip > maxTrip) { maxTrip = trip; }
        var pa = csPrPos(ctx, a), pb = csPrPos(ctx, b);
        if (pa !== null && pb !== null) {
            ctx.segs.push({ a: a, b: b, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
        }
    }

    // Elevation extent over every station that has a z.
    ctx.zMin = null; ctx.zMax = null;
    for (var n in ctx.stations) {
        if (!csPrHas(ctx.stations, n)) { continue; }
        var st = ctx.stations[n];
        if (st === null || typeof st !== "object" || !csPrFinite(st.z)) { continue; }
        var z = st.z * ctx.toFt;
        if (ctx.zMin === null || z < ctx.zMin) { ctx.zMin = z; }
        if (ctx.zMax === null || z > ctx.zMax) { ctx.zMax = z; }
    }

    // Trips: survey.trips[i].date, or the top-level mirror when the
    // survey was never split into trips. Dated only when EVERY trip a
    // leg belongs to has a date and today is given, so no two leads are
    // ever measured on different scales.
    var tripList = csPrArr(survey.trips);
    ctx.tripCount = Math.max(tripList.length, maxTrip + 1);
    ctx.tripDate = function(index) {
        var rec = tripList.length > 0 ? tripList[index] :
            (index === 0 ? { date: survey.date } : undefined);
        return (rec === undefined || rec === null) ? null : csPrDate(rec.date);
    };
    ctx.today = csPrDate(input.today);
    ctx.dated = ctx.today !== null && maxTrip >= 0;
    for (var t in usedTrips) {
        if (csPrHas(usedTrips, t) && ctx.tripDate(parseInt(t, 10)) === null) { ctx.dated = false; }
    }
    return ctx;
};

/**
 * Rank every lead.
 *
 * \param input {survey, resolved, rows, statuses, keyword, weights, preset,
 *   includeDone, positive, negative, today, unit, config, start} -- see
 *   the spec. rows default to CsStationTable.rows(survey, resolved,
 *   {keyword}); statuses {station: status} apply on top of the rows'.
 * \return {leads: [{station, status, kinds, total, minutes, signals:
 *   {cost, blank, connect, elevation, recency, hints}, reasons}], notes}
 */
CsPushRank.rank = function(input) {
    var out = { leads: [], notes: [] };
    try {
        var inp = csPrObj(input);
        var ctx = csPrContext(inp);
        var rows = inp.rows === undefined || inp.rows === null ?
            CsStationTable.rows(ctx.survey, ctx.resolved, { keyword: inp.keyword }) :
            csPrArr(inp.rows);
        var statuses = csPrObj(inp.statuses);
        var weights = csPrWeights(inp.preset, inp.weights);
        var includeDone = inp.includeDone === true;
        var S = CsPushRank.SIGNALS;

        var reach = [], lost = [];
        for (var i = 0; i < rows.length; i++) {
            var src = rows[i];
            if (src === null || typeof src !== "object" || typeof src.station !== "string") {
                continue;
            }
            var kinds = csPrArr(src.kinds);
            if (kinds.indexOf("lead") < 0 && kinds.indexOf("openEnd") < 0) { continue; }
            var row = {};
            for (var key in src) { if (csPrHas(src, key)) { row[key] = src[key]; } }
            row.kinds = kinds;
            if (csPrHas(statuses, row.station) && typeof statuses[row.station] === "string") {
                row.status = statuses[row.station];
            }
            var status = CsStationTable.effectiveStatus(row);
            if (status === "") { status = "open"; }
            if (!includeDone && (status === "done" || status === "skip")) { continue; }

            var cost = csPrCost(ctx, row.station);
            var dir = csPrDirection(ctx, row.station);
            var signals = {
                cost: cost.signal,
                blank: dir.blank,
                connect: dir.connect,
                elevation: csPrElevation(ctx, row),
                recency: csPrRecency(ctx, row),
                hints: csPrHints(ctx, row)
            };
            var sum = 0, wsum = 0, any = false;
            var parts = [];
            for (var s = 0; s < S.length; s++) {
                var sig = signals[S[s]];
                if (sig === null) { continue; }
                any = true;
                sum += weights[S[s]] * sig.score;
                wsum += weights[S[s]];
                parts.push({ name: S[s], c: weights[S[s]] * sig.score, at: s, text: sig.text });
            }
            parts.sort(function(a, b) { return b.c !== a.c ? b.c - a.c : a.at - b.at; });
            var reasons = [];
            var hasCost = false;
            for (var p = 0; p < parts.length && p < 4; p++) {
                reasons.push(parts[p].text);
                if (parts[p].name === "cost") { hasCost = true; }
            }
            if (!hasCost && signals.cost !== null) { reasons.push(signals.cost.text); }
            if (!cost.reachable) { reasons.push("not on the surveyed line"); }
            for (s = 0; s < S.length; s++) {
                if (signals[S[s]] !== null) {
                    signals[S[s]] = { score: csPrR1(signals[S[s]].score), text: signals[S[s]].text };
                }
            }
            var lead = {
                station: row.station,
                status: status,
                kinds: kinds.slice(0),
                total: wsum > 0 ? csPrR1(sum / wsum) : 0,
                minutes: cost.minutes,
                signals: signals,
                reasons: reasons,
                empty: !any
            };
            if (cost.reachable) { reach.push(lead); } else { lost.push(lead); }
        }
        var order = function(a, b) {
            if (a.total !== b.total) { return b.total - a.total; }
            return CsStationTable.compareNatural(a.station, b.station);
        };
        reach.sort(order);
        lost.sort(order);
        var all = reach.concat(lost);
        var empties = [];
        for (var l = 0; l < all.length; l++) {
            if (lost.indexOf(all[l]) >= 0) {
                out.notes.push(all[l].station + " is not on the surveyed line");
            }
            if (all[l].empty) { empties.push(all[l].station + " has nothing to rank it by"); }
            delete all[l].empty;
        }
        out.notes = out.notes.concat(empties);
        out.leads = all;
    } catch (e) {
        // Never throws: a failure mid-way answers what is known so far.
        if (!csPrIsArr(out.leads)) { out.leads = []; }
    }
    return out;
};
