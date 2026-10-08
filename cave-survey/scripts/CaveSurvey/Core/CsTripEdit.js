// CsTripEdit.js -- correcting a trip's metadata after it was drawn.
//
// A trip's name, date, team and instruments are typed once, in the
// Survey Notebook's header, and until this module existed there was no
// way to correct them. The path that looks like it should work makes it
// worse: Survey Notebook's "Load from drawing" decides which trip the
// page REPLACES by FINGERPRINT -- date + "|" + team
// (CsModel.tripFingerprint) -- so editing either field means nothing
// matches, the page lands as a NEW trip, and the old one keeps its
// shots. Fixing a typo forked the cave. That is the bug this module
// exists to close: every edit here is applied by TRIP ID.
//
// What it deliberately does NOT touch:
//
//   declination   changing it rotates every azimuth and moves the whole
//                 plan. That already has an editor -- Survey Notebook's
//                 Declination dialog, which runs CsRevise.reviseDeclination
//                 and CsRevise.apply and carries the IGRF wiring. Name,
//                 date, team and instruments move NO geometry, so this
//                 module never resolves a network, never redraws and
//                 never needs a backup. Keeping the two apart keeps a
//                 team-name typo off the heavy path.
//
//   trip identity as a MERGE. Two trips that would end up with the same
//                 date and team are refused by name. Merging trips
//                 renumbers shots and rebinds linework; it is not
//                 something to smuggle in behind a typo fix.
//
// Where the data lives: each trip's metadata rides as XDATA on that
// trip's ANCHOR station point -- its first resolved station in drawing
// order -- written by CsDraw.survey and read back by
// CsRevise.surveyFromDocument. Trip 0's anchor additionally carries the
// legacy drawing-level mirror (SurveyName/SurveyDate/SurveyTeam) that
// pre-trip readers still use, so an edit to trip 0 must rewrite that
// too or the drawing starts contradicting itself.

if (typeof CsTripEdit === "undefined") {
    var CsTripEdit = {};
}

/** The fields this module edits, in display order. */
CsTripEdit.FIELDS = ["name", "date", "team", "instruments"];

/**
 * One row per trip, for display.
 *
 * \param survey a CsModel survey (normalized in place by ensureTrips,
 *               the suite-wide idiom)
 * \return [{tripId, label, name, date, team, instruments,
 *           declination, declinationSource, shots}] in trip-id order
 */
CsTripEdit.rows = function(survey) {
    CsModel.ensureTrips(survey);
    var counts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var t = survey.shots[i].trip || 0;
        counts[t] = (counts[t] || 0) + 1;
    }
    var out = [];
    for (var ti = 0; ti < survey.trips.length; ti++) {
        var trip = survey.trips[ti];
        var label = "Trip " + ti;
        if (trip.name !== "" && trip.name !== null &&
                trip.name !== undefined) {
            label += " — " + trip.name;
        }
        out.push({
            tripId: ti,
            label: label,
            name: trip.name || "",
            date: trip.date || "",
            team: trip.team || "",
            instruments: trip.instruments || "",
            declination: Number(trip.declination) || 0.0,
            declinationSource: trip.declinationSource || "",
            shots: counts[ti] || 0
        });
    }
    return out;
};

/** Days in a month, 1-based month, with the Gregorian leap rule. */
CsTripEdit.daysInMonth = function(year, month) {
    var days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month === 2 &&
            ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
        return 29;
    }
    return days[month - 1];
};

/** Left-pads a number to two digits. */
CsTripEdit.pad2 = function(n) {
    return (n < 10 ? "0" : "") + String(n);
};

/**
 * The date a trip should store, from what a caver typed.
 *
 * Accepts, after trimming:
 *   ""            a trip may legitimately carry no date
 *   YYYY-MM-DD    the stored form
 *   M/D/YYYY      what actually gets typed; converted
 *
 * An impossible calendar date (2026-02-30) is REFUSED rather than
 * stored. This field is not decoration: the shelf's declination-drift
 * check and the IGRF estimate both parse it, and a date that parses to
 * nothing turns those into silent no-ops.
 *
 * \return {ok: true, value: "YYYY-MM-DD" or ""} or
 *         {ok: false, error: "..."}
 */
CsTripEdit.normalizeDate = function(text) {
    var s = String(text === undefined || text === null ? "" : text)
        .replace(/^\s+|\s+$/g, "");
    if (s === "") {
        return { ok: true, value: "" };
    }
    var y, m, d;
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (iso !== null) {
        y = parseInt(iso[1], 10);
        m = parseInt(iso[2], 10);
        d = parseInt(iso[3], 10);
    } else if (us !== null) {
        m = parseInt(us[1], 10);
        d = parseInt(us[2], 10);
        y = parseInt(us[3], 10);
    } else {
        return { ok: false, error: "\"" + s + "\" is not a date. Use " +
            "YYYY-MM-DD (or M/D/YYYY), or leave it empty." };
    }
    if (m < 1 || m > 12) {
        return { ok: false, error: "\"" + s + "\" has no month " + m +
            "." };
    }
    if (d < 1 || d > CsTripEdit.daysInMonth(y, m)) {
        return { ok: false, error: "\"" + s + "\" is not a real date: " +
            "month " + m + " of " + y + " has no day " + d + "." };
    }
    return { ok: true,
        value: y + "-" + CsTripEdit.pad2(m) + "-" + CsTripEdit.pad2(d) };
};

/**
 * Turns raw field text into the edits to apply -- or into one error
 * that stops the whole thing.
 *
 * All-or-nothing on purpose. A dialog that applied the three rows it
 * could parse and complained about the fourth would leave the drawing
 * in a state nobody asked for and no undo step describes.
 *
 * \param survey the survey read back from the drawing
 * \param inputs [{tripId, name, date, team, instruments}] -- raw text,
 *               one entry per EDITABLE row (a row the dialog showed
 *               read-only simply isn't here)
 * \return {changes: [{tripId, before: {...}, after: {...}}]} listing
 *         only trips that actually differ, or {error: "..."}
 */
CsTripEdit.planEdits = function(survey, inputs) {
    CsModel.ensureTrips(survey);
    var trim = function(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/^\s+|\s+$/g, "");
    };
    // The would-be fingerprint of every trip, edited or not: the
    // collision check has to see the trips this edit does NOT touch,
    // or renaming trip 2 onto trip 5's date and team would sail
    // through.
    var after = [];
    for (var t = 0; t < survey.trips.length; t++) {
        after.push({ date: survey.trips[t].date || "",
            team: survey.trips[t].team || "" });
    }

    var changes = [];
    for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var id = inp.tripId;
        if (typeof id !== "number" || id < 0 ||
                id >= survey.trips.length) {
            return { error: "No trip " + id + " in this drawing. " +
                "Nothing was changed." };
        }
        var trip = survey.trips[id];
        var dateOut = CsTripEdit.normalizeDate(inp.date);
        if (!dateOut.ok) {
            return { error: "Trip " + id + ": " + dateOut.error +
                " Nothing was changed." };
        }
        var nu = { name: trim(inp.name), date: dateOut.value,
            team: trim(inp.team), instruments: trim(inp.instruments) };
        var old = { name: trip.name || "", date: trip.date || "",
            team: trip.team || "",
            instruments: trip.instruments || "" };
        after[id] = { date: nu.date, team: nu.team };

        var differs = false;
        for (var f = 0; f < CsTripEdit.FIELDS.length; f++) {
            if (nu[CsTripEdit.FIELDS[f]] !== old[CsTripEdit.FIELDS[f]]) {
                differs = true;
            }
        }
        if (differs) {
            changes.push({ tripId: id, before: old, after: nu });
        }
    }

    // Identity: two trips with the same date and team ARE the same trip
    // (CsModel.tripFingerprint), and the rest of the suite believes it.
    //
    // Only a collision this edit CREATES is refused. Trips that already
    // shared a fingerprint keep sharing it -- a cave imported without
    // per-trip metadata has several trips all reading "|", and refusing
    // there would make the one tool that can fill those fields in
    // refuse to run on exactly the drawings that need it most.
    for (var a = 0; a < after.length; a++) {
        for (var b = a + 1; b < after.length; b++) {
            if (CsModel.tripFingerprint(after[a]) !==
                    CsModel.tripFingerprint(after[b])) {
                continue;
            }
            if (CsModel.tripFingerprint(survey.trips[a]) ===
                    CsModel.tripFingerprint(survey.trips[b])) {
                continue; // already indistinguishable before this edit
            }
            return { error: "Trip " + a + " and trip " + b +
                " would have the same date and team, which makes them " +
                "the same trip. Merging trips is not what this does. " +
                "Nothing was changed." };
        }
    }

    return { changes: changes };
};

/**
 * Writes planned changes into the survey model.
 *
 * ensureTrips runs afterwards because trips[0] is the authority over
 * the survey's top-level date/team/name mirror -- an edit to trip 0
 * that skipped this would leave survey.date reading the old value to
 * everything that still consults it.
 */
CsTripEdit.applyToSurvey = function(survey, changes) {
    CsModel.ensureTrips(survey);
    for (var i = 0; i < changes.length; i++) {
        var c = changes[i];
        var trip = survey.trips[c.tripId];
        if (trip === undefined) {
            continue;
        }
        for (var f = 0; f < CsTripEdit.FIELDS.length; f++) {
            var key = CsTripEdit.FIELDS[f];
            trip[key] = c.after[key];
        }
    }
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * The tags a trip's anchor should carry after an edit, and the ones to
 * remove. Pure, so the write below stays a loop over a decision made
 * here.
 *
 * CsTags.set CANNOT clear a tag -- it returns early on "" by design --
 * so a field the caver emptied has to be REMOVED, not set. Getting
 * that wrong is how a cleared field silently keeps its old value.
 *
 * \param tripId  the trip's id, written back so the anchor keeps
 *                declaring which trip it anchors
 * \param after   {name, date, team, instruments}
 * \param legacy  true for trip 0, which also carries the pre-trip
 *                drawing-level mirror
 * \param caveName the drawing's cave name, which owns SurveyName when
 *                it is set (CsDraw writes caveName || trip name)
 * \return {set: {key: value}, remove: [key]}
 */
CsTripEdit.tagPlan = function(tripId, after, legacy, caveName) {
    var set = {};
    var remove = [];
    var put = function(key, value) {
        if (value === "" || value === null || value === undefined) {
            remove.push(key);
        } else {
            set[key] = value;
        }
    };
    // Trip is re-set rather than assumed: the anchor was found BY this
    // tag, so writing it back costs nothing and keeps the write
    // self-describing.
    set.Trip = tripId;
    put("TripName", after.name);
    put("TripDate", after.date);
    put("TripTeam", after.team);
    put("TripInstruments", after.instruments);
    if (legacy === true) {
        put("SurveyDate", after.date);
        put("SurveyTeam", after.team);
        put("SurveyName", (caveName !== "" && caveName !== null &&
            caveName !== undefined) ? caveName : after.name);
    }
    return { set: set, remove: remove };
};

/**
 * Applies planned changes to the drawing: retags one anchor point per
 * changed trip, in ONE modify operation so the whole edit is one undo
 * step.
 *
 * No geometry is touched, nothing is erased and nothing is redrawn --
 * no drawn thing depends on these four fields. That is what makes this
 * safe enough to run without a backup, unlike every other operation in
 * the suite that writes to a drawing.
 *
 * Wrapped in CsRevise.withOffLayersOn: station points sit on a control
 * layer that is routinely switched off, and a modify operation on an
 * off layer is refused SILENTLY -- the edit would report success and
 * change nothing.
 *
 * \return {written, missing} -- missing lists trip ids with no anchor
 *         point in the drawing (a trip whose stations never resolved,
 *         so CsDraw had nothing to hang its metadata on)
 */
CsTripEdit.writeTags = function(doc, di, survey, changes) {
    var wanted = {};
    for (var i = 0; i < changes.length; i++) {
        wanted[changes[i].tripId] = changes[i];
    }
    var caveName = (survey === null || survey === undefined) ? "" :
        (survey.caveName || "");

    var run = function() {
        var op = new RModifyObjectsOperation();
        op.setText("Edit trip");
        var written = 0;
        var seen = {};
        var ids = doc.queryAllEntities(false, false);
        for (var k = 0; k < ids.length; k++) {
            var e = doc.queryEntity(ids[k]);
            if (isNull(e)) {
                continue;
            }
            // A trip anchor is a STATION point carrying a Trip tag.
            // The Trip tag alone is not enough: legs and splays carry
            // one too, and retagging a leg would scatter a trip's
            // metadata over its shots.
            if (CsTags.get(e, "Station") === "" ||
                    typeof e.getPosition !== "function") {
                continue;
            }
            var tid = CsTags.getNumber(e, "Trip");
            if (tid === null || !wanted.hasOwnProperty(tid) ||
                    seen[tid] === true) {
                continue;
            }
            seen[tid] = true;
            var plan = CsTripEdit.tagPlan(tid, wanted[tid].after,
                tid === 0, caveName);
            for (var key in plan.set) {
                if (plan.set.hasOwnProperty(key)) {
                    CsTags.set(e, key, plan.set[key]);
                }
            }
            for (var r = 0; r < plan.remove.length; r++) {
                CsTags.remove(e, plan.remove[r]);
            }
            op.addObject(e, false); // false: leave it on its layer
            written++;
        }
        di.applyOperation(op);

        var missing = [];
        for (var w in wanted) {
            if (wanted.hasOwnProperty(w) && seen[w] !== true) {
                missing.push(Number(w));
            }
        }
        missing.sort(function(a, b) { return a - b; });
        return { written: written, missing: missing };
    };

    if (typeof CsRevise !== "undefined" &&
            typeof CsRevise.withOffLayersOn === "function") {
        return CsRevise.withOffLayersOn(doc, di, run);
    }
    return run();
};

/**
 * The one-line consequence of a set of changes, for the report.
 *
 * A changed DATE is the one edit with a follow-on: the trip's
 * declination was estimated for the old date, and IGRF moves. Saying so
 * is the whole point -- this tool cannot fix it, and the tool that can
 * is somewhere else.
 */
/**
 * Plan, apply and write one set of trip-field edits, in one call.
 *
 * ONE COPY OF THE SEQUENCE. planEdits -> applyToSurvey -> writeTags is
 * the whole of "edit a trip", and it now has two callers: Survey
 * Notebook's Edit this trip... dialog, and the Cave Shelf's trip table,
 * where a caver types straight into the row. Two hand-written copies of
 * a three-step sequence is how the second caller ends up quietly
 * skipping the ensureTrips inside applyToSurvey and leaving
 * survey.date mirroring the old value.
 *
 * ALL OR NOTHING, which is planEdits' own rule: a set of inputs with
 * one impossible date in it changes nothing at all, and says why.
 *
 * \param inputs [{tripId, name, date, team, instruments}], raw text
 * \return {changes: [...], res: <writeTags result>} -- changes empty
 *         and res null when nothing differed -- or {error: "..."}
 */
CsTripEdit.commit = function(doc, di, survey, inputs) {
    var plan = CsTripEdit.planEdits(survey, inputs);
    if (plan.error !== undefined) {
        return { error: plan.error };
    }
    if (plan.changes.length === 0) {
        return { changes: [], res: null };
    }
    CsTripEdit.applyToSurvey(survey, plan.changes);
    var res = CsTripEdit.writeTags(doc, di, survey, plan.changes);
    // A renamed trip takes its Layer Manager group with it, or the
    // typo this dialog exists to fix survives in the palette.
    try {
        CsLayerGroups.renameTripGroups(doc, plan.changes);
    }
    catch (eGroups) {
    }
    return { changes: plan.changes, res: res };
};

/**
 * One trip's fields as CsTripEdit.commit wants them, with one field
 * replaced by what a caver typed.
 *
 * The shelf edits ONE CELL at a time, and planEdits compares a whole
 * trip: the three fields nobody touched have to be handed back exactly
 * as they are, or an edit to Team would blank the name and the date.
 *
 * \param row   a CsTripEdit.rows entry
 * \param field "name", "date", "team" or "instruments"
 * \param text  what was typed
 * \return the input entry, or null when `field` is not editable here
 */
CsTripEdit.inputFor = function(row, field, text) {
    if (isNull(row) || CsTripEdit.FIELDS.indexOf(field) === -1) {
        return null;
    }
    var input = { tripId: row.tripId, name: row.name, date: row.date,
                  team: row.team, instruments: row.instruments };
    input[field] = isNull(text) ? "" : String(text);
    return input;
};

CsTripEdit.dateChanged = function(changes) {
    for (var i = 0; i < changes.length; i++) {
        if (changes[i].before.date !== changes[i].after.date) {
            return true;
        }
    }
    return false;
};

// =====================================================================
// Removing a trip.
//
// A trip is not a row in a list: it owns shots, stations, drawn marks,
// wall runs and -- through CsBind's LineworkTrip -- possibly hours of
// the surveyor's own tracing. And trip ids are ARRAY INDICES, stamped
// into XDATA on legs, splays, trip anchors and linework, so removing
// trip 9 renumbers 10 into 9 and every one of those tags has to follow.
//
// The shape below is deliberately the same one a revision takes: build
// the survey the drawing SHOULD hold, erase, redraw the whole cave from
// it, and let the ordinary machinery regenerate every tag. Trying to
// surgically unpick one trip's entities and renumber the survivors in
// place means hand-maintaining the excluded-shot blobs, the wall runs
// and the profile bands -- five places that already know how to rebuild
// themselves from a model.
// =====================================================================

/**
 * The survey a drawing should hold once one trip is gone.
 *
 * Pure. Shots belonging to the trip drop out; every surviving shot and
 * trip record with a HIGHER id shifts down one, so the ids stay a dense
 * 0..n-1 range -- which is what they are, an index into survey.trips.
 *
 * \return {survey, removedShots, renumber: {oldId: newId}}
 */
CsTripEdit.surveyWithoutTrip = function(survey, tripId) {
    CsModel.ensureTrips(survey);
    var out = CsModel.newSurvey();
    out.caveName = survey.caveName;
    out.name = survey.name;
    out.distanceUnit = survey.distanceUnit;
    out.fixed = {};
    for (var fn in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fn)) {
            out.fixed[fn] = survey.fixed[fn];
        }
    }
    // newSurvey() has no trips array -- ensureTrips builds one, and it
    // would build it from the top-level mirror fields, which is exactly
    // the wrong shape here. Start it empty and fill it below.
    out.trips = [];
    var renumber = {};
    for (var t = 0; t < survey.trips.length; t++) {
        if (t === tripId) {
            continue;
        }
        renumber[t] = out.trips.length;
        out.trips.push(survey.trips[t]);
    }
    var removedShots = 0;
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        var old = sh.trip || 0;
        if (old === tripId) {
            removedShots++;
            continue;
        }
        sh.trip = renumber[old] === undefined ? 0 : renumber[old];
        out.shots.push(sh);
    }
    // Trip 0 is the authority over the survey-level mirror, and after a
    // delete it may be a DIFFERENT trip than it was.
    CsModel.ensureTrips(out);
    return { survey: out, removedShots: removedShots,
        renumber: renumber };
};

/**
 * The traced linework bound to a trip, and to every trip after it.
 *
 * Returned together because a delete has to deal with both halves in
 * one pass: the deleted trip's own linework is kept-and-unbound or
 * deleted (the caller decides, and the caller asks the user), and every
 * LATER trip's linework has to be renumbered or it silently starts
 * claiming to belong to whichever trip inherited its old id.
 *
 * \return {owned: [entity], renumber: [{entity, from, to}]}
 */
CsTripEdit.lineworkOfTrip = function(doc, tripId, renumber) {
    var owned = [], shift = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var t = CsTags.getNumber(e, CsBind.TRIP_TAG);
        if (t === null) {
            continue;
        }
        if (t === tripId) {
            owned.push(e);
        } else if (renumber[t] !== undefined && renumber[t] !== t) {
            shift.push({ entity: e, from: t, to: renumber[t] });
        }
    }
    return { owned: owned, renumber: shift };
};

/**
 * Applies the linework half of a delete, in ONE operation.
 *
 * `keep` true unbinds the deleted trip's tracing -- the geometry stays,
 * its LineworkTrip and LineworkStations go, so nothing claims it and
 * the next binding pass can adopt it honestly. `keep` false deletes it
 * with the trip. Hours of tracing are never thrown away by default:
 * the caller asks, every time.
 *
 * \return {unbound, deleted, renumbered}
 */
CsTripEdit.applyLinework = function(doc, di, plan, keep) {
    var out = { unbound: 0, deleted: 0, renumbered: 0 };
    var run = function() {
        var op = new RModifyObjectsOperation();
        op.setText("Re-key linework");
        var i;
        for (i = 0; i < plan.renumber.length; i++) {
            CsTags.set(plan.renumber[i].entity, CsBind.TRIP_TAG,
                plan.renumber[i].to);
            op.addObject(plan.renumber[i].entity, false);
            out.renumbered++;
        }
        if (keep) {
            for (i = 0; i < plan.owned.length; i++) {
                CsTags.remove(plan.owned[i], CsBind.TRIP_TAG);
                CsTags.remove(plan.owned[i], CsBind.STATIONS_TAG);
                op.addObject(plan.owned[i], false);
                out.unbound++;
            }
        }
        di.applyOperation(op);

        if (!keep && plan.owned.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (i = 0; i < plan.owned.length; i++) {
                del.deleteObject(plan.owned[i]);
                out.deleted++;
            }
            di.applyOperation(del);
        }
        return out;
    };
    if (typeof CsRevise !== "undefined" &&
            typeof CsRevise.withOffLayersOn === "function") {
        return CsRevise.withOffLayersOn(doc, di, run);
    }
    return run();
};

/**
 * Every entity a trip drew that erasing its STATIONS would leave
 * behind: the legs and splays it owns.
 *
 * CsDraw.eraseStations kills a leg only when BOTH its ends are in the
 * kill set, which is right for a redraw and wrong here -- the tie-in
 * leg from an older trip's station into this one has one end outside
 * the set, and would survive as a line to a station that no longer
 * exists. Keyed on the Trip tag, which is exactly who drew it.
 */
CsTripEdit.strayEntitiesOfTrip = function(doc, tripId) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsBind.hasLineworkTags(e)) {
            continue;   // never the surveyor's own tracing
        }
        if (CsTags.get(e, "Station") !== "") {
            continue;   // station marks are the erase's own business
        }
        if (CsTags.getNumber(e, "Trip") === tripId) {
            out.push(e);
        }
    }
    return out;
};

/**
 * The trips that would be cut adrift by deleting one.
 *
 * A trip OWNS the stations it reached first (CsDelta.stationTrips'
 * rule, and CsDraw's). Another trip that starts from one of those
 * stations depends on it: delete the owner and the dependent's shots
 * point at a station that is not in the drawing any more.
 *
 * \return [{tripId, station}] -- one entry per dependent trip, naming
 *         the first station it stands on
 */
CsTripEdit.tripsStandingOn = function(survey, tripId) {
    CsModel.ensureTrips(survey);
    var owner = {};
    var i, sh;
    for (i = 0; i < survey.shots.length; i++) {
        sh = survey.shots[i];
        if (sh.excludeFromAll) {
            continue;
        }
        var t = sh.trip || 0;
        if (sh.from !== "" && owner[sh.from] === undefined) {
            owner[sh.from] = t;
        }
        if (!sh.splay && sh.to !== "" && owner[sh.to] === undefined) {
            owner[sh.to] = t;
        }
    }
    var out = [], seen = {};
    for (i = 0; i < survey.shots.length; i++) {
        sh = survey.shots[i];
        var mine = sh.trip || 0;
        if (mine === tripId || sh.excludeFromAll) {
            continue;
        }
        var ends = sh.splay ? [sh.from] : [sh.from, sh.to];
        for (var e = 0; e < ends.length; e++) {
            if (ends[e] === "" || owner[ends[e]] !== tripId ||
                    seen[mine] === true) {
                continue;
            }
            seen[mine] = true;
            out.push({ tripId: mine, station: ends[e] });
        }
    }
    out.sort(function(a, b) { return a.tripId - b.tripId; });
    return out;
};

/**
 * Removes a trip from a drawing, geometry and all.
 *
 * The sequence, and why each step is where it is:
 *
 *   1. BACKUP. This is the one destructive operation in the tool. The
 *      copy is taken before a single entity goes (CsBackup.beforeWrite,
 *      the same guard every redraw takes).
 *   2. LINEWORK FIRST, while the drawing still says which tracing
 *      belongs to whom. Unbound or deleted per the caller's answer, and
 *      every LATER trip's LineworkTrip renumbered in the same pass --
 *      miss that and a wall silently starts claiming the trip that
 *      inherited its old id.
 *   3. The trip's own legs and splays, which erasing its stations would
 *      leave dangling (see strayEntitiesOfTrip).
 *   4. Erase every station of the OLD survey and redraw the whole cave
 *      from the renumbered model. Not surgery on the survivors: the
 *      excluded-shot blobs, the wall runs, the trip anchors and the
 *      profile bands all carry trip ids, and all four already know how
 *      to rebuild themselves from a survey.
 *   5. If that redraw MOVED anything -- deleting a trip that closed a
 *      loop changes the adjustment for the rest of the cave -- the
 *      surviving tracing is carried along, exactly as a revision does.
 *
 * \param opts {keepLinework: bool} -- true keeps the deleted trip's
 *             tracing and unbinds it, false deletes it with the trip.
 *             The caller asks the user; there is no default here.
 * \return {ok, error, removedShots, stationsErased, linework, moved}
 */
CsTripEdit.deleteTrip = function(doc, di, recon, tripId, opts) {
    var survey = recon.survey;
    CsModel.ensureTrips(survey);
    if (tripId < 0 || tripId >= survey.trips.length) {
        return { ok: false, error: "No trip " + tripId + " in this drawing." };
    }
    if (survey.trips.length <= 1) {
        return { ok: false, error: "This drawing holds only one trip. " +
            "Deleting it would leave a drawing with a survey's marks " +
            "and no survey -- start a new drawing instead." };
    }

    // WHO ELSE STANDS ON THIS TRIP'S STATIONS. A later trip that tied
    // into a station only this trip reaches loses its own anchor when
    // this one goes: its shots survive with a `from` that no longer
    // exists, the network cannot place them, and they end up in the
    // UnplacedShots blob -- a whole trip silently off the map. Refused
    // rather than warned: the caver can delete the dependent trips
    // first, in the order that keeps the cave connected, and that
    // order is theirs to choose.
    var dependents = CsTripEdit.tripsStandingOn(survey, tripId);
    if (dependents.length > 0) {
        var names = [];
        for (var d = 0; d < dependents.length; d++) {
            names.push("trip " + dependents[d].tripId + " (" +
                dependents[d].station + ")");
        }
        return { ok: false, error: "Can't delete trip " + tripId +
            " yet: " + names.join(", ") + " tie" +
            (dependents.length === 1 ? "s" : "") + " into a station " +
            "only this trip reaches, and would be left with nowhere " +
            "to start. Delete those first, or re-survey their tie-in." };
    }

    try {
        if (typeof CsBackup !== "undefined") {
            CsBackup.beforeWrite(doc.getFileName());
        }
    } catch (eBak) {
        // a backup is protection, never a precondition
    }

    var oldNames = CsModel.stationNames(survey);
    var oldPos = CsRevise.stationPositions(doc);
    var extent = CsRevise.positionsExtent(oldPos);

    var plan = CsTripEdit.surveyWithoutTrip(survey, tripId);
    var lwPlan = CsTripEdit.lineworkOfTrip(doc, tripId, plan.renumber);
    var lw = CsTripEdit.applyLinework(doc, di, lwPlan,
        opts !== undefined && opts !== null && opts.keepLinework === true);

    // The trip's own legs and splays, by tag. Deleted before the
    // station erase so nothing depends on the order of the two.
    var strays = CsTripEdit.strayEntitiesOfTrip(doc, tripId);
    if (strays.length > 0) {
        CsRevise.withOffLayersOn(doc, di, function() {
            var del = new RDeleteObjectsOperation();
            for (var i = 0; i < strays.length; i++) {
                del.deleteObject(strays[i]);
            }
            di.applyOperation(del);
        });
    }

    var erased = CsLayers.withLayerOn(doc, di, CsLayers.CTRL_HIDDEN,
        function() {
            return CsDraw.eraseStations(doc, oldNames, di);
        });

    // Anchored where the drawing already stands, the same rule the
    // notebook's own redraw follows: the anchor may have BEEN this
    // trip's station, in which case any surviving drawn station does.
    var anchor = null;
    for (var i = 0; i < plan.survey.shots.length && anchor === null; i++) {
        var cand = [plan.survey.shots[i].from, plan.survey.shots[i].to];
        for (var c = 0; c < cand.length; c++) {
            if (cand[c] !== "" && oldPos.hasOwnProperty(cand[c])) {
                anchor = { name: cand[c], x: oldPos[cand[c]].x,
                    y: oldPos[cand[c]].y,
                    z: CsRevise.anchorZOf(recon, cand[c]) };
                break;
            }
        }
    }
    var resolved = CsAdjust.resolveAndAdjust(plan.survey,
        anchor === null ? {} : { anchor: anchor },
        CsAdjust.optionsFromTags(recon.adjustTags || {}));
    var drawn = CsDraw.survey(plan.survey, resolved, undefined,
        undefined, undefined, { doc: doc, di: di });

    // Deleting a trip that closed a loop re-solves the rest of the
    // cave; the tracing that survived has to come with it.
    var newPos = CsRevise.stationPositions(doc);
    var moved = CsRevise.positionsMoved(oldPos, newPos, extent);
    if (moved > 0) {
        CsRevise.withOffLayersOn(doc, di, function() {
            return CsRevise.moveLinework(doc, di, oldPos, newPos,
                CsRevise.tripStationNames(plan.survey), extent);
        });
    }

    return { ok: true, error: "", removedShots: plan.removedShots,
        stationsErased: erased, linework: lw, moved: moved,
        drawn: drawn, trips: plan.survey.trips.length };
};
