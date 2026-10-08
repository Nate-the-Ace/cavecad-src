// CsStationTable.js -- one row per station, and what kind of place it is.
//
// Part of the Cave Survey Core library: pure ES5, no document, no GUI,
// so tests/js_unit.js runs it under node.
//
// A LEAD IS NOT A RECORD. Surveyors already write "LEAD ..." in a
// station's note and the callout suite already draws that note as a
// multileader. Nothing here asks for new entry: it READS the notes,
// and every other kind (open end, junction, control, loop, flagged)
// is likewise a derived fact about a station, computed fresh each time
// and never stored. What IS stored -- a team's mark and notes on a
// row -- lives in CsStationStore.
//
// NO COORDINATES, EVER. A row carries elevation and nothing of the
// plan position. Rows feed a printable trip packet, and a cave's
// location does not leave the cave (see the location-privacy rule).
//
// A MISSING z IS null. A row whose station the resolver never placed,
// or placed without an elevation, reports null; substituting 0 would
// rebase the cave to sea level (the elevation datum trap).
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

include(includeBasePath + "/CsFrontier.js");

var CsStationTable = {};

/** The kinds, in the order badges are listed. */
CsStationTable.KINDS = ["lead", "openEnd", "junction", "control", "loop",
    "noted", "flagged"];

CsStationTable.LABEL = {
    lead: "Lead",
    openEnd: "Open end",
    junction: "Junction",
    control: "Control",
    loop: "Loop",
    noted: "Noted",
    flagged: "Flagged"
};

/** The word a note must contain to be a lead, unless a cave overrides. */
CsStationTable.DEFAULT_KEYWORD = "lead";

/**
 * A predicate: does this note text read as a lead?
 *
 * The keyword must stand as a whole word, case-insensitively, so
 * "LEAD W", "Lead?" and "a lead" match while "leader", "leads" and
 * "misled" do not. Punctuation is not part of a word.
 */
CsStationTable.leadTest = function(keyword) {
    var word = (keyword === undefined || keyword === null ||
        String(keyword).replace(/\s+/g, "") === "") ?
        CsStationTable.DEFAULT_KEYWORD : String(keyword);
    var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("(^|[^A-Za-z0-9_])" + escaped +
        "([^A-Za-z0-9_]|$)", "i");
    return function(text) {
        return re.test(String(text === undefined || text === null ? "" : text));
    };
};

/** Station names in the order a caver reads them: A2 before A10. */
CsStationTable.compareNatural = function(a, b) {
    var re = /(\d+)|(\D+)/g;
    var pa = String(a).match(re) || [];
    var pb = String(b).match(re) || [];
    var n = Math.min(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
        var x = pa[i];
        var y = pb[i];
        if (x === y) { continue; }
        if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
            var d = parseInt(x, 10) - parseInt(y, 10);
            if (d !== 0) { return d < 0 ? -1 : 1; }
            continue;
        }
        var lx = x.toLowerCase();
        var ly = y.toLowerCase();
        if (lx !== ly) { return lx < ly ? -1 : 1; }
        return x < y ? -1 : 1;
    }
    if (pa.length === pb.length) { return 0; }
    return pa.length < pb.length ? -1 : 1;
};

/**
 * Every note, by the station it belongs to.
 *
 * A note rides on the leg that ARRIVES at a station (that is where the
 * notes page writes it, and where CsDraw reads it), so it belongs to
 * the shot's TO. The very first station has no arriving leg; its note
 * is survey.startNote. Splays and excluded shots are not survey and
 * their notes are not read.
 *
 * \return {station: [{text, trip}]}
 */
CsStationTable.notesByStation = function(survey) {
    var out = {};
    var add = function(station, text, trip) {
        var name = CsFrontier.clean(station);
        var body = (text === undefined || text === null) ? "" :
            String(text).replace(/^\s+|\s+$/g, "");
        if (name === "" || body === "") { return; }
        if (out[name] === undefined) { out[name] = []; }
        out[name].push({ text: body, trip: trip });
    };
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return out;
    }
    var first = CsFrontier.firstLeg(survey);
    if (first !== null && survey.startNote) {
        add(first.from, survey.startNote, first.trip || 0);
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        add(shot.to, shot.notes, shot.trip || 0);
    }
    return out;
};

/** {station: [trip, ...]} sorted ascending, from the legs touching it. */
CsStationTable.tripsByStation = function(survey) {
    var seen = {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return {};
    }
    var note = function(name, trip) {
        if (seen[name] === undefined) { seen[name] = {}; }
        seen[name][trip] = true;
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var trip = shot.trip || 0;
        note(CsFrontier.clean(shot.from), trip);
        note(CsFrontier.clean(shot.to), trip);
    }
    var out = {};
    for (var name in seen) {
        if (!Object.prototype.hasOwnProperty.call(seen, name)) { continue; }
        var list = [];
        for (var t in seen[name]) {
            if (Object.prototype.hasOwnProperty.call(seen[name], t)) {
                list.push(parseInt(t, 10));
            }
        }
        list.sort(function(a, b) { return a - b; });
        out[name] = list;
    }
    return out;
};

/** {station: [{percent, error}]} for every station on a closed loop. */
CsStationTable.loopsByStation = function(resolved) {
    var out = {};
    if (resolved === undefined || resolved === null ||
            Object.prototype.toString.call(resolved.loops) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        var path = Object.prototype.toString.call(loop.path) ===
            "[object Array]" ? loop.path : [];
        for (var k = 0; k < path.length; k++) {
            var name = CsFrontier.clean(path[k]);
            if (name === "") { continue; }
            if (out[name] === undefined) { out[name] = []; }
            out[name].push({ percent: loop.percent, error: loop.error });
        }
    }
    return out;
};

/**
 * {station: [{code, severity, message}]} from CsValidate findings.
 * A finding sits on a SHOT; it is attributed to the station that shot
 * arrives at (its splay origin when it has no arrival).
 */
CsStationTable.flagsByStation = function(survey, findings) {
    var out = {};
    if (Object.prototype.toString.call(findings) !== "[object Array]" ||
            survey === undefined || survey === null) {
        return out;
    }
    for (var i = 0; i < findings.length; i++) {
        var f = findings[i];
        if (typeof f.shotIndex !== "number" || f.shotIndex < 0) { continue; }
        var shot = survey.shots[f.shotIndex];
        if (shot === undefined || shot === null) { continue; }
        var name = CsFrontier.clean(shot.to);
        if (name === "") { name = CsFrontier.clean(shot.from); }
        if (name === "") { continue; }
        if (out[name] === undefined) { out[name] = []; }
        out[name].push({ code: f.code, severity: f.severity,
            message: f.message });
    }
    return out;
};

/**
 * One row per station.
 *
 * \param survey   the WHOLE cave, every trip merged
 *                 (CsRevise.surveyFromDocument(doc).survey)
 * \param resolved CsAdjust.resolveAndAdjust() result, or null (then z
 *                 is null on every row)
 * \param opts     {keyword, closed: [names], findings: CsValidate.check()}
 *
 * \return [{station, kinds, trips, degree, notes: [{text, trip}],
 *           noteText, leadNotes: [{text, trip}], keyText, z, loops,
 *           flags}] -- unsorted; see sort()
 */
CsStationTable.rows = function(survey, resolved, opts) {
    var o = opts || {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return [];
    }
    var isLead = CsStationTable.leadTest(o.keyword);
    var notes = CsStationTable.notesByStation(survey);
    var degree = CsFrontier.degrees(survey);
    var anchors = CsFrontier.anchors(survey);
    var trips = CsStationTable.tripsByStation(survey);
    var loops = CsStationTable.loopsByStation(resolved);
    var flags = CsStationTable.flagsByStation(survey, o.findings);

    var ends = {};
    var endList = CsFrontier.openEnds(survey, { closed: o.closed });
    for (var e = 0; e < endList.length; e++) {
        ends[endList[e].station] = true;
    }

    var names = {};
    var name;
    for (name in degree) {
        if (Object.prototype.hasOwnProperty.call(degree, name)) { names[name] = true; }
    }
    for (name in notes) {
        if (Object.prototype.hasOwnProperty.call(notes, name)) { names[name] = true; }
    }
    for (name in anchors) {
        if (Object.prototype.hasOwnProperty.call(anchors, name)) { names[name] = true; }
    }

    var out = [];
    for (name in names) {
        if (!Object.prototype.hasOwnProperty.call(names, name)) { continue; }
        var ns = notes[name] || [];
        var leadNotes = [];
        for (var n = 0; n < ns.length; n++) {
            if (isLead(ns[n].text)) { leadNotes.push(ns[n]); }
        }
        var kinds = [];
        if (leadNotes.length > 0) { kinds.push("lead"); }
        if (ends[name] === true) { kinds.push("openEnd"); }
        if ((degree[name] || 0) >= 3) { kinds.push("junction"); }
        if (anchors[name] === true) { kinds.push("control"); }
        if (loops[name] !== undefined) { kinds.push("loop"); }
        if (ns.length > 0) { kinds.push("noted"); }
        if (flags[name] !== undefined) { kinds.push("flagged"); }

        var texts = function(list) {
            var t = [];
            for (var i = 0; i < list.length; i++) { t.push(list[i].text); }
            return t.join(" | ");
        };
        var z = null;
        if (resolved !== undefined && resolved !== null &&
                resolved.stations !== undefined && resolved.stations !== null) {
            var st = resolved.stations[name];
            if (st !== undefined && st !== null && typeof st.z === "number" &&
                    isFinite(st.z)) {
                z = st.z;
            }
        }
        out.push({
            station: name,
            kinds: kinds,
            trips: trips[name] || [],
            degree: degree[name] || 0,
            notes: ns,
            noteText: texts(ns),
            leadNotes: leadNotes,
            // A lead keys on its LEAD notes only, so a later trip
            // writing "pushed 3 m, tight" beside it does not orphan
            // the team's marks.
            keyText: leadNotes.length > 0 ? texts(leadNotes) : texts(ns),
            z: z,
            loops: loops[name] || [],
            flags: flags[name] || []
        });
    }
    return out;
};

/** The status a row shows: its mark, or "open" for an unmarked lead. */
CsStationTable.effectiveStatus = function(row) {
    if (row.status !== undefined && row.status !== null && row.status !== "") {
        return row.status;
    }
    return row.kinds.indexOf("lead") >= 0 ? "open" : "";
};

/**
 * Rows matching a query.
 *
 * \param query {kinds: [kind], text: string, status: string}
 *   kinds   ANY-of: a station that is a lead OR a junction stays. An
 *           empty list means every kind.
 *   text    case-insensitive, over station name and note text
 *   status  the effective status ("open", "assigned", ...); "" is any
 */
CsStationTable.filter = function(rows, query) {
    var q = query || {};
    var kinds = Object.prototype.toString.call(q.kinds) === "[object Array]" ?
        q.kinds : [];
    var text = (q.text === undefined || q.text === null) ? "" :
        String(q.text).toLowerCase();
    var status = (q.status === undefined || q.status === null) ? "" :
        String(q.status);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (kinds.length > 0) {
            var hit = false;
            for (var k = 0; k < kinds.length; k++) {
                if (row.kinds.indexOf(kinds[k]) >= 0) { hit = true; break; }
            }
            if (!hit) { continue; }
        }
        if (text !== "") {
            var hay = (row.station + " " + (row.noteText || "") + " " +
                (row.team || "") + " " + (row.who || "")).toLowerCase();
            if (hay.indexOf(text) < 0) { continue; }
        }
        if (status !== "" && CsStationTable.effectiveStatus(row) !== status) {
            continue;
        }
        out.push(row);
    }
    return out;
};

/** Rows in natural station order (a new array; the input is untouched). */
CsStationTable.sort = function(rows) {
    var copy = rows.slice(0);
    copy.sort(function(a, b) {
        return CsStationTable.compareNatural(a.station, b.station);
    });
    return copy;
};

/**
 * What the table would SUGGEST for a row. Never applied: only a person
 * sets a mark. Trip indexes run in the order trips were added, so "a
 * later trip touches this station" means somebody surveyed on from it
 * after the lead was written.
 *
 * \return "pushed" or ""
 */
CsStationTable.suggest = function(row) {
    if (row.kinds.indexOf("lead") < 0 || row.leadNotes.length === 0) {
        return "";
    }
    var first = row.leadNotes[0].trip;
    for (var i = 1; i < row.leadNotes.length; i++) {
        if (row.leadNotes[i].trip < first) { first = row.leadNotes[i].trip; }
    }
    for (var t = 0; t < row.trips.length; t++) {
        if (row.trips[t] > first) { return "pushed"; }
    }
    return "";
};

/**
 * The rows as CSV, for a trip planner's checklist. Columns name no
 * position: elevation only.
 */
CsStationTable.checklistCsv = function(rows) {
    var cell = function(v) {
        var s = (v === undefined || v === null) ? "" : String(v);
        if (/[",\n\r]/.test(s)) { s = "\"" + s.replace(/"/g, "\"\"") + "\""; }
        return s;
    };
    var lines = [["Station", "Kinds", "Trips", "Elevation", "Status", "Note",
        "Team notes", "Assigned"].join(",")];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var labels = [];
        for (var k = 0; k < r.kinds.length; k++) {
            labels.push(CsStationTable.LABEL[r.kinds[k]]);
        }
        lines.push([cell(r.station), cell(labels.join("; ")),
            cell((r.trips || []).join(" ")),
            cell(r.z === null || r.z === undefined ? "" : r.z),
            cell(CsStationTable.effectiveStatus(r)), cell(r.noteText),
            cell(r.team), cell(r.who)].join(","));
    }
    return lines.join("\n") + "\n";
};
