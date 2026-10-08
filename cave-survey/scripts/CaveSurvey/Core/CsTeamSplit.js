// CsTeamSplit.js -- suggest a split: which people and stops go on each team.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI, no
// file I/O, no randomness. The same input gives the same output.
//
// A SUGGESTION, NOT A PLAN. Times are CsTripPlan estimates along the
// survey line; a passage width is only known where LRUD was taken, and an
// unknown width never counts as a violation (it is a note instead). Locks
// are the caller's: a locked stop or person never moves.
//
// See docs/superpowers/specs/2026-09-29-suggest-split-design.md.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsStationTable.js");
include(includeBasePath + "/CsPeople.js");
include(includeBasePath + "/CsTripPlan.js");
include(includeBasePath + "/CsTeams.js");
// The squeeze sentence, fit rule, limit lookup and unknown-width note.
include(includeBasePath + "/CsSqueeze.js");

var CsTeamSplit = {};

/** Improvement passes are capped here (a pass that changes nothing ends early). */
CsTeamSplit.MAX_PASSES = 200;
/** A team's total this far off the mean of teams with stops is a balance warning. */
CsTeamSplit.BALANCE_FRACTION = 0.30;
/** At most this many teams. */
CsTeamSplit.MAX_TEAMS = 8;

var csTsEps = 1e-9;

var csTsArr = function(v) {
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
};

var csTsObj = function(v) {
    return (v !== null && typeof v === "object") ? v : {};
};

var csTsTrim = function(v) {
    return (v === null || v === undefined) ? "" : String(v).replace(/^\s+|\s+$/g, "");
};

/** A person's key: id when there is one, else the case-blind name. */
var csTsKey = function(p) {
    var id = csTsTrim(p.id);
    return id !== "" ? "id:" + id : "n:" + csTsTrim(p.name).replace(/\s+/g, " ").toLowerCase();
};

/** A valid team index for a lock, else -1. */
var csTsIndex = function(v, count) {
    return (typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0 &&
        v < count) ? v : -1;
};

/**
 * The directory facts the rules need for one person: {vertical, firstAid,
 * leader, squeeze (inches or null)}. Matched by id, else by trimmed
 * case-blind name (CsPeople.resolveParty); unknown -> no skills, no limit.
 */
var csTsFacts = function(person, directory) {
    var hit = CsPeople.resolveParty([{ id: person.id, name: person.name }], directory);
    var row = hit.length > 0 ? hit[0] : { skills: [], squeeze: null };
    var has = function(id) { return csTsArr(row.skills).indexOf(id) >= 0; };
    return { vertical: has("vertical"),
        firstAid: has("first_aid") || has("cpr") || has("wfr"),
        leader: has("leader"),
        squeeze: CsSqueeze.limitOf(person, directory) };
};

/** "Team N" for position n (1-based), moving on while the name is taken. */
var csTsNewName = function(position, taken) {
    var n = position;
    while (taken["#" + ("team " + n)] === true) { n++; }
    taken["#" + ("team " + n)] = true;
    return "Team " + n;
};

/**
 * Suggest a split.
 *
 * \param input {teamCount, teams: [CsTeams team], freeStops: [station],
 *   lockedStops: [{station, team}], freePeople: [{id, name}],
 *   lockedPeople: [{id, name, team}], directory: [CsPeople person],
 *   survey, resolved, unit, config, start}
 *   Only the lock and free lists decide who and what goes where; `teams`
 *   supplies names, ids and days. Bad entries are skipped; a lock to a
 *   team that does not exist counts as free.
 * \return {feasible, teams: [{index, id, name, added, members: [{id, name}],
 *   stops: [station, route order], minutes: {in, work, out, total},
 *   needsVertical, tightestInches (number|null), warnings: [{kind, hard,
 *   text}]}], notes: [text]}
 *   Warning kinds: "vertical" and "squeeze" (hard), "first-aid", "leader",
 *   "balance", "schedule" (preferences). feasible is false exactly when a
 *   hard warning exists. Never throws on degenerate input.
 */
CsTeamSplit.suggest = function(input) {
    var inp = csTsObj(input);
    var notes = [];
    var survey = inp.survey;
    var resolved = inp.resolved;
    var unit = inp.unit === "m" ? "m" : "ft";
    var cfg = CsTripPlan.config(inp.config);
    var directory = csTsArr(inp.directory);

    // Teams: the current ones, then added "Team N" copies of the last one's days.
    var current = [];
    var src = csTsArr(inp.teams);
    var i, k;
    for (i = 0; i < src.length; i++) {
        if (src[i] !== null && typeof src[i] === "object") { current.push(src[i]); }
    }
    var count = current.length;
    var want = (typeof inp.teamCount === "number" && isFinite(inp.teamCount)) ?
        Math.floor(inp.teamCount) : count;
    if (want > CsTeamSplit.MAX_TEAMS) { want = CsTeamSplit.MAX_TEAMS; }
    if (want < count) { want = count; }
    if (want < 1) { want = 1; }
    var taken = {};
    for (i = 0; i < current.length; i++) {
        taken["#" + csTsTrim(current[i].name).replace(/\s+/g, " ").toLowerCase()] = true;
    }
    var teams = [];
    for (i = 0; i < want; i++) {
        var base;
        var added = i >= current.length;
        if (!added) {
            base = current[i];
        } else {
            var name = csTsNewName(i + 1, taken);
            base = current.length > 0 ? CsTeams.copyOf(current[current.length - 1], name) :
                CsTeams.blank(name);
        }
        var label = csTsTrim(base.name);
        teams.push({ index: i, id: added ? "" : csTsTrim(base.id),
            name: label === "" ? "Team " + (i + 1) : label, added: added,
            days: csTsArr(base.days), stops: [], members: [] });
    }
    var T = teams.length;

    // Where the route starts, and what it can reach.
    var start = inp.start;
    if (start === undefined || start === null || csTsTrim(start) === "") {
        var first = CsFrontier.firstLeg(survey);
        start = first === null ? "" : CsFrontier.clean(first.from);
    }
    start = csTsTrim(start);
    var reach = { dist: {} };
    var surveyNotes = {};
    try {
        reach = CsTripPlan.shortest(CsTripPlan.graph(survey, resolved), start);
        if (survey !== null && survey !== undefined) {
            surveyNotes = CsStationTable.notesByStation(survey);
        }
    } catch (eReach) {
        reach = { dist: {} };
    }
    var reachable = function(st) { return st === start || reach.dist[st] !== undefined; };

    // The time model: one CsTripPlan build per stop set, cached.
    var cache = {};
    var planOf = function(stops) {
        if (stops.length === 0) { return null; }
        var key = stops.slice(0).sort().join("\u0001");
        if (!Object.prototype.hasOwnProperty.call(cache, key)) {
            var p = null;
            try {
                p = CsTripPlan.build(survey, resolved, { start: start,
                    targets: stops.slice(0), unit: unit, config: inp.config,
                    notes: surveyNotes });
            } catch (eBuild) {
                p = null;
            }
            cache[key] = p;
        }
        return cache[key];
    };
    var totalOf = function(stops) {
        var p = planOf(stops);
        return p === null ? 0 : p.totals.minutesAll;
    };

    // Stops: locked ones first, then the free ones (deduplicated, reachable).
    var placed = {};
    var locked = csTsArr(inp.lockedStops);
    for (i = 0; i < locked.length; i++) {
        var ls = csTsObj(locked[i]);
        var lst = csTsTrim(ls.station);
        var lt = csTsIndex(ls.team, T);
        if (lst === "" || lt < 0 || placed["#" + lst] === true) { continue; }
        placed["#" + lst] = true;
        teams[lt].stops.push(lst);
        if (!reachable(lst)) {
            notes.push(lst + " cannot be reached from " + start +
                " along the surveyed line; it stays on " + teams[lt].name + ".");
        }
    }
    var free = [];
    var freeIn = csTsArr(inp.freeStops);
    // A lock to a missing team counts as free.
    for (i = 0; i < locked.length; i++) {
        var bad = csTsObj(locked[i]);
        if (csTsIndex(bad.team, T) < 0 && csTsTrim(bad.station) !== "") {
            freeIn = freeIn.concat([bad.station]);
        }
    }
    for (i = 0; i < freeIn.length; i++) {
        var fs = csTsTrim(freeIn[i]);
        if (fs === "" || placed["#" + fs] === true) { continue; }
        placed["#" + fs] = true;
        if (!reachable(fs)) {
            notes.push(fs + " cannot be reached from " + (start === "" ? "the start" : start) +
                " along the surveyed line; it was left out.");
            continue;
        }
        free.push(fs);
    }

    // Greedy seed: farthest first, each to the team whose total grows least
    // (ties: fewest stops, then lowest index).
    var totals = [];
    for (i = 0; i < T; i++) { totals.push(totalOf(teams[i].stops)); }
    var seedOrder = free.slice(0);
    var distOf = function(st) { return reach.dist[st] === undefined ? 0 : reach.dist[st]; };
    var pos = {};
    for (i = 0; i < free.length; i++) { pos[free[i]] = i; }
    seedOrder.sort(function(a, b) {
        var d = distOf(b) - distOf(a);
        return Math.abs(d) > csTsEps ? d : pos[a] - pos[b];
    });
    var where = {};
    for (i = 0; i < seedOrder.length; i++) {
        var st = seedOrder[i];
        var bestT = -1, bestGrow = 0, bestTotal = 0;
        for (k = 0; k < T; k++) {
            var tot = totalOf(teams[k].stops.concat([st]));
            var grow = tot - totals[k];
            if (bestT < 0 || grow < bestGrow - csTsEps ||
                    (Math.abs(grow - bestGrow) <= csTsEps &&
                        teams[k].stops.length < teams[bestT].stops.length)) {
                bestT = k; bestGrow = grow; bestTotal = tot;
            }
        }
        teams[bestT].stops.push(st);
        totals[bestT] = bestTotal;
        where[st] = bestT;
    }

    // Improve: moves then swaps of free stops, accepted only when the
    // largest total falls (ties: a smaller sum of squares).
    var score = function(list) {
        var mx = 0, ss = 0;
        for (var q = 0; q < list.length; q++) {
            if (list[q] > mx) { mx = list[q]; }
            ss += list[q] * list[q];
        }
        return { max: mx, ss: ss };
    };
    var better = function(a, b) {
        if (a.max < b.max - csTsEps) { return true; }
        return Math.abs(a.max - b.max) <= csTsEps && a.ss < b.ss - csTsEps;
    };
    var without = function(list, st) {
        var out = [];
        for (var q = 0; q < list.length; q++) { if (list[q] !== st) { out.push(list[q]); } }
        return out;
    };
    var tryChange = function(ta, newA, tb, newB) {
        var trial = totals.slice(0);
        trial[ta] = totalOf(newA);
        trial[tb] = totalOf(newB);
        if (!better(score(trial), score(totals))) { return false; }
        teams[ta].stops = newA;
        teams[tb].stops = newB;
        totals = trial;
        return true;
    };
    for (var pass = 0; pass < CsTeamSplit.MAX_PASSES; pass++) {
        var changed = false;
        for (i = 0; i < free.length; i++) {
            for (k = 0; k < T; k++) {
                var from = where[free[i]];
                if (k === from) { continue; }
                if (tryChange(from, without(teams[from].stops, free[i]),
                        k, teams[k].stops.concat([free[i]]))) {
                    where[free[i]] = k;
                    changed = true;
                }
            }
        }
        for (i = 0; i < free.length; i++) {
            for (k = i + 1; k < free.length; k++) {
                var a = free[i], b = free[k];
                var ta = where[a], tb = where[b];
                if (ta === tb) { continue; }
                if (tryChange(ta, without(teams[ta].stops, a).concat([b]),
                        tb, without(teams[tb].stops, b).concat([a]))) {
                    where[a] = tb;
                    where[b] = ta;
                    changed = true;
                }
            }
        }
        if (!changed) { break; }
    }

    // Route facts per team, stops in route order.
    for (i = 0; i < T; i++) {
        var team = teams[i];
        var plan = planOf(team.stops);
        team.plan = plan;
        var ordered = [];
        if (plan !== null) {
            for (k = 0; k < plan.stops.length; k++) { ordered.push(plan.stops[k].station); }
        }
        for (k = 0; k < team.stops.length; k++) {
            if (ordered.indexOf(team.stops[k]) < 0) { ordered.push(team.stops[k]); }
        }
        team.stops = ordered;
        team.needsVertical = plan !== null && plan.pitches.length > 0;
        var at = plan === null ? null : CsTripPlan.routeTightestAt(survey, plan);
        team.tightestInches = at === null ? null : at.inches;
        team.tightNear = at === null ? "" : at.near;
        team.minutes = plan === null ? { "in": 0, work: 0, out: 0, total: 0 } :
            { "in": plan.totals.minutesIn, work: plan.totals.minutesWork,
                out: plan.totals.minutesOut, total: plan.totals.minutesAll };
    }

    // People: locked first, then free ones by the rules' priority.
    var seen = {};
    var people = [];
    var lockedP = csTsArr(inp.lockedPeople);
    var freeP = [];
    var addPerson = function(raw, team) {
        var p = csTsObj(raw);
        var entry = { id: csTsTrim(p.id), name: csTsTrim(p.name) };
        if (entry.name === "" && entry.id === "") { return null; }
        var key = csTsKey(entry);
        if (seen[key] === true) { return null; }
        seen[key] = true;
        entry.facts = csTsFacts(entry, directory);
        entry.team = team;
        people.push(entry);
        return entry;
    };
    for (i = 0; i < lockedP.length; i++) {
        var lp = csTsObj(lockedP[i]);
        var lpt = csTsIndex(lp.team, T);
        if (lpt < 0) { continue; }
        var got = addPerson(lp, lpt);
        if (got !== null) { teams[lpt].members.push(got); }
    }
    var freeRaw = csTsArr(inp.freePeople);
    for (i = 0; i < lockedP.length; i++) {
        if (csTsIndex(csTsObj(lockedP[i]).team, T) < 0) { freeRaw = freeRaw.concat([lockedP[i]]); }
    }
    for (i = 0; i < freeRaw.length; i++) {
        var fp = addPerson(freeRaw[i], -1);
        if (fp !== null) { freeP.push(fp); }
    }
    // Stable order: scarcest skill first, then name, then id.
    var counts = { vertical: 0, firstAid: 0, leader: 0 };
    for (i = 0; i < freeP.length; i++) {
        if (freeP[i].facts.vertical) { counts.vertical++; }
        if (freeP[i].facts.firstAid) { counts.firstAid++; }
        if (freeP[i].facts.leader) { counts.leader++; }
    }
    var scarcity = function(p) {
        var s = Infinity;
        if (p.facts.vertical) { s = Math.min(s, counts.vertical); }
        if (p.facts.firstAid) { s = Math.min(s, counts.firstAid); }
        if (p.facts.leader) { s = Math.min(s, counts.leader); }
        return s;
    };
    for (i = 0; i < freeP.length; i++) { freeP[i].order = i; freeP[i].scarce = scarcity(freeP[i]); }
    freeP.sort(function(a, b) {
        if (a.scarce !== b.scarce) { return a.scarce < b.scarce ? -1 : 1; }
        var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
        if (an !== bn) { return an < bn ? -1 : 1; }
        if (a.id !== b.id) { return a.id < b.id ? -1 : 1; }
        return a.order - b.order;
    });
    var fits = function(p, t) {
        return CsSqueeze.fit(p.facts.squeeze, teams[t].tightestInches) !== "no";
    };
    var hasOn = function(t, fact) {
        for (var q = 0; q < teams[t].members.length; q++) {
            if (teams[t].members[q].facts[fact]) { return true; }
        }
        return false;
    };
    var place = function(p, t) { p.team = t; teams[t].members.push(p); };
    var pickFor = function(t, fact) {
        for (var q = 0; q < freeP.length; q++) {
            var p = freeP[q];
            if (p.team < 0 && p.facts[fact] && fits(p, t)) { place(p, t); return true; }
        }
        return false;
    };
    // (a) a pitch team with no Vertical member gets one.
    for (i = 0; i < T; i++) {
        if (teams[i].needsVertical && !hasOn(i, "vertical")) { pickFor(i, "vertical"); }
    }
    // (c) first aid, then a Trip leader, per team.
    for (i = 0; i < T; i++) {
        if (!hasOn(i, "firstAid")) { pickFor(i, "firstAid"); }
    }
    for (i = 0; i < T; i++) {
        if (!hasOn(i, "leader")) { pickFor(i, "leader"); }
    }
    // (d) everyone else to the smallest team they fit (b: squeeze). Someone
    // who fits nowhere goes to the widest route, then the smallest team.
    for (i = 0; i < freeP.length; i++) {
        var person = freeP[i];
        if (person.team >= 0) { continue; }
        var pick = -1;
        for (k = 0; k < T; k++) {
            if (!fits(person, k)) { continue; }
            if (pick < 0 || teams[k].members.length < teams[pick].members.length) { pick = k; }
        }
        if (pick < 0) {
            for (k = 0; k < T; k++) {
                if (pick < 0 || teams[k].tightestInches > teams[pick].tightestInches ||
                        (teams[k].tightestInches === teams[pick].tightestInches &&
                            teams[k].members.length < teams[pick].members.length)) {
                    pick = k;
                }
            }
        }
        place(person, pick);
    }

    // Warnings from the final state.
    var withStops = [];
    for (i = 0; i < T; i++) {
        if (teams[i].plan !== null && teams[i].plan.stops.length > 0) { withStops.push(i); }
    }
    var mean = 0;
    for (i = 0; i < withStops.length; i++) { mean += teams[withStops[i]].minutes.total; }
    mean = withStops.length > 0 ? mean / withStops.length : 0;
    var feasible = true;
    var outTeams = [];
    for (i = 0; i < T; i++) {
        var tm = teams[i];
        var warnings = [];
        var warn = function(kind, hard, text) {
            warnings.push({ kind: kind, hard: hard, text: tm.name + ": " + text });
            if (hard) { feasible = false; }
        };
        if (tm.needsVertical && !hasOn(i, "vertical")) {
            warn("vertical", true, "the route has a pitch and nobody on the team has the " +
                "Vertical skill.");
        }
        for (k = 0; k < tm.members.length; k++) {
            var m = tm.members[k];
            if (CsSqueeze.fit(m.facts.squeeze, tm.tightestInches) === "no") {
                warn("squeeze", true, CsSqueeze.sentence(m.name, m.facts.squeeze,
                    tm.tightestInches, tm.tightNear));
            }
        }
        if (!hasOn(i, "firstAid")) {
            warn("first-aid", false, "nobody on the team has First aid, CPR or " +
                "Wilderness first responder training.");
        }
        if (!hasOn(i, "leader")) {
            warn("leader", false, "nobody on the team is a Trip leader.");
        }
        if (withStops.length >= 2 && withStops.indexOf(i) >= 0 && mean > 0) {
            var off = (tm.minutes.total - mean) / mean;
            if (Math.abs(off) > CsTeamSplit.BALANCE_FRACTION) {
                warn("balance", false, "estimated total " + CsTripPlan.clock(tm.minutes.total) +
                    " is " + Math.round(Math.abs(off) * 100) + "% " +
                    (off > 0 ? "above" : "below") + " the average of the teams with stops (" +
                    CsTripPlan.clock(mean) + ").");
            }
        }
        if (tm.plan !== null && tm.days.length > 0) {
            var need = tm.plan.totals.minutesWork + tm.plan.pitches.length * cfg.rigMin;
            var have = 0;
            for (k = 0; k < tm.days.length; k++) {
                var h = csTsObj(tm.days[k]).workHours;
                if (typeof h === "number" && isFinite(h) && h > 0) { have += h * 60; }
            }
            if (need > have + csTsEps) {
                warn("schedule", false, "the stops need about " + CsTripPlan.clock(need) +
                    " of work but the team's days schedule " + CsTripPlan.clock(have) + ".");
            }
        }
        var sqNote = CsSqueeze.teamNotes({ stops: tm.stops }, { reachable: tm.plan !== null &&
            tm.plan.stops.length > 0, inches: tm.tightestInches });
        if (sqNote !== "") { notes.push(tm.name + ": " + sqNote); }
        if (tm.members.length === 0) { notes.push(tm.name + " has nobody."); }
        var members = [];
        for (k = 0; k < tm.members.length; k++) {
            members.push({ id: tm.members[k].id, name: tm.members[k].name });
        }
        outTeams.push({ index: i, id: tm.id, name: tm.name, added: tm.added,
            members: members, stops: tm.stops, minutes: tm.minutes,
            needsVertical: tm.needsVertical, tightestInches: tm.tightestInches,
            warnings: warnings });
    }
    return { feasible: feasible, teams: outTeams, notes: notes };
};
