// CsTeams.js -- the teams engine: several teams on one trip.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// no file I/O. Dates use UTC arithmetic only (CsCalloutCard.dateMinutes
// and stamp), never local-time Date.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsUuid.js");
include(includeBasePath + "/CsCalloutCard.js");
include(includeBasePath + "/CsPeople.js");

var CsTeams = {};

var csTeamsTrim = function(v) {
    return (v === null || v === undefined) ? "" : String(v).replace(/^\s+|\s+$/g, "");
};

var csTeamsArr = function(v) {
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
};

var csTeamsObj = function(v) {
    return (v !== null && typeof v === "object") ? v : {};
};

/** Minutes since 1970 UTC for a REAL calendar date "YYYY-MM-DD", else null
 *  (dateMinutes alone lets 2026-02-31 roll into March). */
var csTeamsBase = function(iso) {
    var text = csTeamsTrim(iso);
    var abs = CsCalloutCard.dateMinutes(text);
    if (abs === null || CsCalloutCard.stamp(abs).date !== text) { return null; }
    return abs;
};

/** A new empty team with a fresh id. */
CsTeams.blank = function(name) {
    return { id: CsUuid.v4(), name: name, goal: "", dayOffset: 0, members: [],
        stops: [], days: [], packing: "" };
};

/** A new team that starts from another's schedule: fresh id, deep-copied
 *  days and dayOffset, no members, stops or packing. */
CsTeams.copyOf = function(team, name) {
    var t = csTeamsObj(team);
    var days = [];
    var src = csTeamsArr(t.days);
    for (var i = 0; i < src.length; i++) {
        var d = csTeamsObj(src[i]);
        days.push({ entry: d.entry, workHours: d.workHours, night: d.night });
    }
    var out = CsTeams.blank(name);
    out.dayOffset = typeof t.dayOffset === "number" ? t.dayOffset : 0;
    out.days = days;
    return out;
};

/** The teams a trip with no teams becomes: one "Team 1" holding the legacy
 *  days, party and packing. Existing teams come back unchanged. Inputs are
 *  never mutated (days and party are copied). */
CsTeams.fromLegacy = function(trip, packing, party) {
    var t = csTeamsObj(trip);
    if (csTeamsArr(t.teams).length > 0) { return t.teams; }
    var team = CsTeams.blank("Team 1");
    var days = csTeamsArr(t.days);
    for (var i = 0; i < days.length; i++) {
        var d = csTeamsObj(days[i]);
        team.days.push({ entry: d.entry, workHours: d.workHours, night: d.night });
    }
    var people = csTeamsArr(party);
    for (var k = 0; k < people.length; k++) {
        var p = csTeamsObj(people[k]);
        team.members.push({ id: p.id === undefined ? "" : p.id, name: p.name });
    }
    team.packing = packing === undefined || packing === null ? "" : String(packing);
    return [team];
};

/** The team's calendar dates, "YYYY-MM-DD": start + dayOffset + i. Empty
 *  when the trip's start date is not a real date. */
CsTeams.dates = function(trip, team) {
    var out = [];
    var base = csTeamsBase(csTeamsObj(trip).startDate);
    if (base === null) { return out; }
    var t = csTeamsObj(team);
    var off = typeof t.dayOffset === "number" ? t.dayOffset : 0;
    var n = csTeamsArr(t.days).length;
    for (var i = 0; i < n; i++) {
        out.push(CsCalloutCard.stamp(base + (off + i) * 1440).date);
    }
    return out;
};

/**
 * Every person on two or more teams that both have a day on the same date.
 * Same person = same id, else same trimmed case-blind name. A name-only
 * entry joins the id of any member elsewhere in the trip with that name, so
 * one team listing Pat by id and another by name only still conflict.
 * \return [{person, date, teams: [names]}] sorted by date then person
 */
CsTeams.sameDayConflicts = function(trip) {
    var teams = csTeamsArr(csTeamsObj(trip).teams);
    var nameKey = function(n) { return csTeamsTrim(n).toLowerCase(); };
    var idByName = {};
    var t, m;
    for (t = 0; t < teams.length; t++) {
        var ms = csTeamsArr(csTeamsObj(teams[t]).members);
        for (m = 0; m < ms.length; m++) {
            var mid = csTeamsTrim(csTeamsObj(ms[m]).id);
            var nk = nameKey(csTeamsObj(ms[m]).name);
            if (mid !== "" && nk !== "" && idByName["#" + nk] === undefined) {
                idByName["#" + nk] = mid;
            }
        }
    }
    var byKey = {};
    var order = [];
    for (t = 0; t < teams.length; t++) {
        var team = csTeamsObj(teams[t]);
        var dates = CsTeams.dates(trip, team);
        var members = csTeamsArr(team.members);
        var tname = String(team.name);
        for (m = 0; m < members.length; m++) {
            var who = csTeamsObj(members[m]);
            var key = nameKey(who.name);
            if (key === "" && csTeamsTrim(who.id) === "") { continue; }
            var id = csTeamsTrim(who.id);
            if (id === "" && idByName["#" + key] !== undefined) { id = idByName["#" + key]; }
            var pkey = id !== "" ? "id:" + id : "n:" + key;
            for (var d = 0; d < dates.length; d++) {
                var k = dates[d] + "|" + pkey;
                if (byKey[k] === undefined) {
                    byKey[k] = { person: csTeamsTrim(who.name), date: dates[d], teams: [] };
                    order.push(k);
                }
                if (byKey[k].teams.indexOf(tname) < 0) { byKey[k].teams.push(tname); }
            }
        }
    }
    var out = [];
    for (var o = 0; o < order.length; o++) {
        if (byKey[order[o]].teams.length > 1) { out.push(byKey[order[o]]); }
    }
    out.sort(function(a, b) {
        return a.date < b.date ? -1 : (a.date > b.date ? 1 :
            (a.person < b.person ? -1 : (a.person > b.person ? 1 : 0)));
    });
    return out;
};

/** The team's schedule rows: CsCalloutCard.windows at the team's own start
 *  (trip start + dayOffset days, UTC arithmetic) and days. */
CsTeams.windows = function(plan, trip, team, bufferMin) {
    var t = csTeamsObj(team);
    var base = csTeamsBase(csTeamsObj(trip).startDate);
    if (base === null) { return { rows: [], warnings: [] }; }
    var off = typeof t.dayOffset === "number" ? t.dayOffset : 0;
    var start = CsCalloutCard.stamp(base + off * 1440).date;
    return CsCalloutCard.windows(plan, { startDate: start, days: csTeamsArr(t.days) },
        bufferMin);
};

/**
 * The "next callouts" strip: one entry per team day that ends on the
 * surface, sorted by absolute minute then team order.
 * \param rowsByTeam in team order; each entry is {team: name, rows} (rows as
 *   CsTeams.windows returns them, or the whole windows result) or a bare rows
 *   array (labelled "Team N")
 * \return [{team, stamp, kind: "callout"}]
 */
CsTeams.calloutStrip = function(rowsByTeam) {
    var list = csTeamsArr(rowsByTeam);
    var items = [];
    for (var t = 0; t < list.length; t++) {
        var e = list[t];
        var isArr = csTeamsArr(e) === e;
        var rows = isArr ? e : csTeamsArr(csTeamsObj(e).rows);
        var name = (!isArr && csTeamsTrim(csTeamsObj(e).team) !== "") ?
            String(e.team) : "Team " + (t + 1);
        for (var r = 0; r < rows.length; r++) {
            var row = csTeamsObj(rows[r]);
            if (row.callout === null || row.callout === undefined) { continue; }
            items.push({ order: t, entry: { team: name, stamp: row.callout, kind: "callout" } });
        }
    }
    items.sort(function(a, b) {
        return a.entry.stamp.abs !== b.entry.stamp.abs ?
            a.entry.stamp.abs - b.entry.stamp.abs : a.order - b.order;
    });
    var out = [];
    for (var i = 0; i < items.length; i++) { out.push(items[i].entry); }
    return out;
};

/**
 * EVERYTHING missing before the files can be built, in panel order: the
 * trip-level items, the roster item (only when it applies), then per team
 * "<Team name>: ..." items. Whitespace counts as blank; the callout buffer
 * is never required. Never throws on null arguments.
 *
 * \param trip {startDate, teams: [{name, members, stops, days}]}
 * \param plansByTeam a CsTripPlan plan (or null) per team, in team order; a
 *   team's stops count from its plan, or from team.stops when the plan is absent
 * \param contacts {topName, topPhone, escalation}
 * \param roster unused beyond the flag below (kept for parity with the card)
 * \param includeRoster false leaves the roster wording out
 */
CsTeams.missingAll = function(trip, plansByTeam, contacts, roster, includeRoster) {
    var out = [];
    var t = csTeamsObj(trip);
    var c = csTeamsObj(contacts);
    var teams = csTeamsArr(t.teams);
    var plans = csTeamsArr(plansByTeam);
    if (csTeamsBase(t.startDate) === null) { out.push("start date"); }
    if (csTeamsTrim(c.topName) === "") { out.push("topside contact name"); }
    if (csTeamsTrim(c.topPhone) === "") { out.push("contact phone"); }
    if (csTeamsTrim(c.escalation) === "") { out.push("the if-no-word escalation line"); }
    var counts = [];
    var i, j;
    for (i = 0; i < teams.length; i++) {
        var n = 0;
        var ms = csTeamsArr(csTeamsObj(teams[i]).members);
        for (j = 0; j < ms.length; j++) {
            if (csTeamsTrim(csTeamsObj(ms[j]).name) !== "") { n++; }
        }
        counts.push(n);
    }
    // No trip-level "roster" line: every team already reports its own
    // "at least one person", so a trip-level line would say it twice.
    for (i = 0; i < teams.length; i++) {
        var team = csTeamsObj(teams[i]);
        var label = csTeamsTrim(team.name);
        var prefix = (label === "" ? "Team " + (i + 1) : label) + ": ";
        if (label === "") { out.push(prefix + "a name"); }
        if (counts[i] === 0) { out.push(prefix + "at least one person"); }
        if (csTeamsArr(team.days).length === 0) { out.push(prefix + "at least one day"); }
        var plan = plans[i];
        var stops = (plan !== null && plan !== undefined && typeof plan === "object") ?
            csTeamsArr(plan.stops).length : csTeamsArr(team.stops).length;
        if (stops === 0) { out.push(prefix + "at least one stop"); }
    }
    return out;
};

/** File-name fragment: lower case, runs of non-alphanumerics become one
 *  hyphen, hyphens trimmed, at most 30 characters, "team" when empty. */
CsTeams.slug = function(name) {
    var s = csTeamsTrim(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    s = s.slice(0, 30).replace(/-+$/, "");
    return s === "" ? "team" : s;
};

/** "team-<n>-<slug>.html", n 1-based from the list position. */
CsTeams.fileName = function(index0, team) {
    return "team-" + (index0 + 1) + "-" + CsTeams.slug(csTeamsObj(team).name) + ".html";
};

/** The team's members resolved against the people directory (same rules and
 *  shape as the card roster; unknown -> known:false). */
CsTeams.memberRows = function(team, directory) {
    return CsPeople.resolveParty(csTeamsObj(team).members, directory);
};
