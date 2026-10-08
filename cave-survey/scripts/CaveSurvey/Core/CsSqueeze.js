// CsSqueeze.js -- who fits where: squeeze limits against passage widths.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI, no
// file I/O. Never throws; degenerate input gives empty answers.
//
// A width is only known where LRUD was taken, and a recorded width of 0
// or less is UNMEASURED (CsTripPlan.routeTightestAt skips it), never a
// squeeze. An unknown limit or an unknown width never blocks: it is
// "unknown", shown as such.
//
// The ONE home of the squeeze sentence (sentence), the fit rule (fit),
// the limit lookup (limitOf) and the unknown-width note (NOTE):
// CsTeamSplit calls these rather than keeping its own copies.
//
// See docs/superpowers/specs/2026-09-30-squeeze-view-design.md.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");
include(includeBasePath + "/CsTripPlan.js");
include(includeBasePath + "/CsPeople.js");

var CsSqueeze = {};

/** The note for a team whose route has no known width. */
CsSqueeze.NOTE = "passage widths on the route are unknown, squeeze limits not checked.";

var csSqArr = function(v) {
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
};

var csSqObj = function(v) {
    return (v !== null && typeof v === "object") ? v : {};
};

var csSqTrim = function(v) {
    return (v === null || v === undefined || typeof v === "object") ? "" :
        String(v).replace(/^\s+|\s+$/g, "");
};

var csSqNum = function(v) {
    return typeof v === "number" && isFinite(v) && v > 0;
};

/** A person's key: id when there is one, else the case-blind name. */
var csSqKey = function(p) {
    var id = csSqTrim(p.id);
    return id !== "" ? "id:" + id : "n:" + csSqTrim(p.name).replace(/\s+/g, " ").toLowerCase();
};

/** "12" or "9.6": inches as a caver reads them (1 decimal). */
CsSqueeze.inches = function(v) {
    return String(Math.round(v * 10) / 10);
};

/**
 * "fits" when both are known and inches >= limit, "no" when both are
 * known and inches < limit, else "unknown" (limit missing or <= 0, width
 * unknown or <= 0, i.e. unmeasured).
 */
CsSqueeze.fit = function(limitInches, inches) {
    if (!csSqNum(limitInches) || !csSqNum(inches)) { return "unknown"; }
    return inches >= limitInches ? "fits" : "no";
};

/** The squeeze warning, without any team prefix. */
CsSqueeze.sentence = function(name, limitInches, inches, near) {
    return name + " (limit " + CsSqueeze.inches(limitInches) +
        " in) may not fit the tightest passage on the route (" +
        CsSqueeze.inches(inches) + " in near " + near + ").";
};

/**
 * One person's directory row: matched by id, else by trimmed case-blind
 * name (CsPeople.resolveParty). Null when not found.
 */
var csSqRow = function(person, directory) {
    var p = csSqObj(person);
    var hit = CsPeople.resolveParty([{ id: csSqTrim(p.id), name: csSqTrim(p.name) }],
        csSqArr(directory));
    return hit.length > 0 && hit[0].known === true ? hit[0] : null;
};

/** A person's squeeze limit in inches from the directory, or null. */
CsSqueeze.limitOf = function(person, directory) {
    try {
        var row = csSqRow(person, directory);
        return row !== null && csSqNum(row.squeeze) ? row.squeeze : null;
    } catch (e) {
        return null;
    }
};

var csSqUnit = function(survey, opts) {
    if (opts.unit === "m" || opts.unit === "ft") { return opts.unit; }
    return csSqObj(survey).distanceUnit === "m" ? "m" : "ft";
};

var csSqStart = function(survey, opts) {
    var start = csSqTrim(opts.start);
    if (start !== "") { return start; }
    var first = CsFrontier.firstLeg(survey);
    return first === null ? "" : csSqTrim(CsFrontier.clean(first.from));
};

/** Plan a route to `stops` and read its tightest width. */
var csSqRoute = function(survey, resolved, stops, opts, label) {
    var out = { station: label, reachable: false, inches: null, near: null, unreachable: [] };
    try {
        var o = csSqObj(opts);
        var start = csSqStart(survey, o);
        // Widths do not depend on station notes, so none are gathered.
        var plan = CsTripPlan.build(survey, resolved, { start: start, targets: stops,
            unit: csSqUnit(survey, o), config: o.config, notes: {} });
        out.unreachable = csSqArr(plan.unreachable).slice(0);
        out.reachable = plan.stops.length > 0;
        if (!out.reachable && stops.length === 1 && stops[0] === start && start !== "") {
            // The start itself: on the line when the graph knows it.
            out.reachable = CsTripPlan.graph(survey, resolved)[start] !== undefined;
        }
        if (plan.stops.length > 0) {
            var at = CsTripPlan.routeTightestAt(survey, plan);
            if (at !== null) { out.inches = at.inches; out.near = at.near; }
        }
    } catch (e) {
        out.reachable = false;
        out.inches = null;
        out.near = null;
    }
    return out;
};

/**
 * The narrowest known width on the round trip from the start to one stop.
 * \param opts {start, unit, config}; unit defaults to the survey's
 * \return {station, reachable, inches (number|null), near (station|null)}
 */
CsSqueeze.forStop = function(survey, resolved, station, opts) {
    var st = csSqTrim(station);
    var r = csSqRoute(survey, resolved, st === "" ? [] : [st], opts, st);
    return { station: st, reachable: st !== "" && r.reachable, inches: r.inches, near: r.near };
};

/**
 * The same for a team's whole route (all its stops planned together).
 * reachable is true when at least one stop is on the route; unreachable
 * lists the stops that are not.
 * \return {station: "team", reachable, inches, near, unreachable: [station]}
 */
CsSqueeze.forTeam = function(survey, resolved, stops, opts) {
    var list = [];
    var seen = {};
    var src = csSqArr(stops);
    for (var i = 0; i < src.length; i++) {
        var st = csSqTrim(src[i]);
        if (st === "" || seen["#" + st] === true) { continue; }
        seen["#" + st] = true;
        list.push(st);
    }
    if (list.length === 0) {
        return { station: "team", reachable: false, inches: null, near: null, unreachable: [] };
    }
    return csSqRoute(survey, resolved, list, opts, "team");
};

/**
 * Stops by people.
 * \return {stops: [{station, reachable, inches, near}], people: [{id, name,
 *   limit (number|null)}], cells: [[ "fits"|"no"|"unknown"|"unreachable" ]]}
 *   with cells[stopIndex][personIndex]. Blank and repeated stops and people
 *   are dropped; a person is keyed by id, else case-blind name.
 */
CsSqueeze.matrix = function(survey, resolved, stops, people, directory, opts) {
    var out = { stops: [], people: [], cells: [] };
    try {
        var cache = {};
        var src = csSqArr(stops);
        var i, k;
        for (i = 0; i < src.length; i++) {
            var st = csSqTrim(src[i]);
            if (st === "" || Object.prototype.hasOwnProperty.call(cache, "#" + st)) { continue; }
            cache["#" + st] = CsSqueeze.forStop(survey, resolved, st, opts);
            out.stops.push(cache["#" + st]);
        }
        var seen = {};
        var ps = csSqArr(people);
        for (i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (p === null || typeof p !== "object") { continue; }
            var entry = { id: csSqTrim(p.id), name: csSqTrim(p.name) };
            if (entry.id === "" && entry.name === "") { continue; }
            var key = csSqKey(entry);
            if (seen[key] === true) { continue; }
            seen[key] = true;
            var row = null;
            try { row = csSqRow(entry, directory); } catch (eRow) { row = null; }
            out.people.push({ id: row !== null ? row.id : entry.id,
                name: row !== null && row.name !== "" ? row.name : entry.name,
                limit: row !== null && csSqNum(row.squeeze) ? row.squeeze : null });
        }
        for (i = 0; i < out.stops.length; i++) {
            var cells = [];
            for (k = 0; k < out.people.length; k++) {
                cells.push(out.stops[i].reachable ?
                    CsSqueeze.fit(out.people[k].limit, out.stops[i].inches) : "unreachable");
            }
            out.cells.push(cells);
        }
    } catch (e) {
        return { stops: [], people: [], cells: [] };
    }
    return out;
};

/**
 * Every member of `team` who will not fit its route.
 * \param team {members: [{id, name}]}
 * \param teamRoute forTeam's answer
 * \return [{person (name), id, limit, inches, near, text}]
 */
CsSqueeze.teamIssues = function(team, teamRoute, directory) {
    var out = [];
    try {
        var route = csSqObj(teamRoute);
        if (!csSqNum(route.inches)) { return out; }
        var members = csSqArr(csSqObj(team).members);
        var seen = {};
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            if (m === null || typeof m !== "object") { continue; }
            var entry = { id: csSqTrim(m.id), name: csSqTrim(m.name) };
            if (entry.id === "" && entry.name === "") { continue; }
            var key = csSqKey(entry);
            if (seen[key] === true) { continue; }
            seen[key] = true;
            var limit = CsSqueeze.limitOf(entry, directory);
            if (CsSqueeze.fit(limit, route.inches) !== "no") { continue; }
            var name = entry.name;
            if (name === "") {
                var row = csSqRow(entry, directory);
                name = row === null ? entry.id : row.name;
            }
            var near = route.near === null || route.near === undefined ? "" : String(route.near);
            out.push({ person: name, id: entry.id, limit: limit, inches: route.inches,
                near: near, text: CsSqueeze.sentence(name, limit, route.inches, near) });
        }
    } catch (e) {
        return [];
    }
    return out;
};

/**
 * The unknown-width note for a team with stops on its route but no known
 * width anywhere on it, else "".
 * \param team {stops: [station]}
 * \param teamRoute forTeam's answer
 */
CsSqueeze.teamNotes = function(team, teamRoute) {
    var stops = csSqArr(csSqObj(team).stops);
    var route = csSqObj(teamRoute);
    return stops.length > 0 && route.reachable === true && !csSqNum(route.inches) ?
        CsSqueeze.NOTE : "";
};
