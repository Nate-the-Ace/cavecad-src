// CsFrontier.js -- where a survey stopped, and which trip stopped there.
//
// Part of the Cave Survey Core library. Pure ES5, no Q*/R* anywhere, so
// tests/js_unit.js runs it under node.
//
// THE QUESTION THIS ANSWERS is the one a surveyor asks in the parking
// lot: last trip ran out of time somewhere -- where do we tie in today?
// The drawing already knows. A station with exactly ONE leg touching it
// is an END of the surveyed line: the survey walked in and never walked
// out. Every other station has two or more legs and is a place the line
// passes through.
//
// LEGS ONLY. Splays are wall shots -- they hang off a station and come
// back, and counting them would make every splayed station look like a
// junction. Shots flagged excludeFromAll are not survey at all and are
// skipped; excludeFromPlot shots ARE counted, because passage you chose
// not to draw is still passage somebody surveyed.
//
// THE ANCHOR IS NOT AN OPEN END, even though it has exactly one leg.
// The survey starts there -- it is usually the entrance (A1 by project
// convention), and offering "continue the survey from the entrance" as
// a lead would be nonsense. Fixed stations are excluded for the same
// reason: a fixed station is control, tied to something already known.
//
// TIED ENDS ARE NOT OPEN EITHER. A station the party deliberately
// closed -- a choke, a sump, a tie into another cave's survey -- looks
// exactly like a lead to the geometry. Only a human knows the
// difference, so the caller passes those names in (options.closed) and
// they drop out. Nothing here guesses.
//
// ORDER IS NEWEST TRIP FIRST, because the end you want is nearly always
// the one the last trip walked away from, and within a trip the latest
// shot first. Ties break on station name so the order is stable enough
// to test.

var CsFrontier = {};

/** True for a shot that ties two stations together on the survey line. */
CsFrontier.isLeg = function(shot) {
    if (shot === undefined || shot === null) { return false; }
    if (shot.splay === true) { return false; }
    if (shot.excludeFromAll === true) { return false; }
    var from = CsFrontier.clean(shot.from);
    var to = CsFrontier.clean(shot.to);
    // A leg needs both ends, and a shot from a station to itself is a
    // typo or a zero-length placeholder, never a connection.
    return from !== "" && to !== "" && from !== to;
};

/** Station names as written, trimmed; anything unusable becomes "". */
CsFrontier.clean = function(name) {
    if (name === undefined || name === null) { return ""; }
    return String(name).replace(/^\s+|\s+$/g, "");
};

/**
 * How many legs touch each station.
 *
 * \return {stationName: count}, counting a leg once for each of its two
 * ends.
 */
CsFrontier.degrees = function(survey) {
    var out = {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return out;
    }
    var bump = function(name) {
        if (name === "") { return; }
        out[name] = (out[name] === undefined ? 0 : out[name]) + 1;
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        bump(CsFrontier.clean(shot.from));
        bump(CsFrontier.clean(shot.to));
    }
    return out;
};

/**
 * The stations that are control rather than lead: every fixed station,
 * plus the station the survey starts from (the first leg's FROM, which
 * is what CsNetwork anchors at (0,0,0) when nothing is fixed).
 *
 * \return {stationName: true}
 */
CsFrontier.anchors = function(survey) {
    var out = {};
    if (survey === undefined || survey === null) { return out; }

    if (survey.fixed !== undefined && survey.fixed !== null &&
            typeof survey.fixed === "object") {
        for (var key in survey.fixed) {
            if (Object.prototype.hasOwnProperty.call(survey.fixed, key)) {
                var fixedName = CsFrontier.clean(key);
                if (fixedName !== "") { out[fixedName] = true; }
            }
        }
    }

    if (Object.prototype.toString.call(survey.shots) === "[object Array]") {
        for (var i = 0; i < survey.shots.length; i++) {
            if (CsFrontier.isLeg(survey.shots[i])) {
                out[CsFrontier.clean(survey.shots[i].from)] = true;
                break;
            }
        }
    }
    return out;
};

/**
 * Does this station have wall measurements recorded at it?
 *
 * An end with no LRUD is worth flagging: the party wrote a station down
 * and left without measuring the passage there, so whoever continues has
 * nothing to draw walls from at the tie-in.
 *
 * The LRUD of a station rides on the leg that ARRIVES at it (that is
 * where the notes page writes it); the very first station has no
 * arriving leg, and its measurements are survey.startLrud.
 */
CsFrontier.hasLrud = function(survey, station) {
    var name = CsFrontier.clean(station);
    if (name === "" || survey === undefined || survey === null) { return false; }

    var any = function(shot) {
        // A side written "P" (open passage) is a recorded reading --
        // the party looked and found nothing there -- not an omission,
        // so it counts as evidence the same as a number does. Missing
        // this used to mean a station read "P P P P" (checked all four
        // ways, wide open) looked exactly like one nobody measured at
        // all, which is the one case this flag exists to catch.
        return shot.left !== null && shot.left !== undefined ||
            shot.right !== null && shot.right !== undefined ||
            shot.up !== null && shot.up !== undefined ||
            shot.down !== null && shot.down !== undefined ||
            shot.leftOpen || shot.rightOpen ||
            shot.upOpen || shot.downOpen;
    };

    if (Object.prototype.toString.call(survey.shots) === "[object Array]") {
        for (var i = survey.shots.length - 1; i >= 0; i--) {
            var shot = survey.shots[i];
            if (!CsFrontier.isLeg(shot)) { continue; }
            if (CsFrontier.clean(shot.to) === name) { return any(shot); }
        }
    }

    var first = CsFrontier.firstLeg(survey);
    if (first !== null && CsFrontier.clean(first.from) === name) {
        var start = survey.startLrud;
        return start !== null && start !== undefined &&
            (start.left !== null && start.left !== undefined ||
             start.right !== null && start.right !== undefined ||
             start.up !== null && start.up !== undefined ||
             start.down !== null && start.down !== undefined ||
             start.leftOpen || start.rightOpen ||
             start.upOpen || start.downOpen);
    }
    return false;
};

/** The first shot that is a leg, or null. */
CsFrontier.firstLeg = function(survey) {
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return null;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        if (CsFrontier.isLeg(survey.shots[i])) { return survey.shots[i]; }
    }
    return null;
};

/**
 * The marker a party writes in the note column when a passage is DONE.
 *
 * "EOS" -- end of survey -- is what a caver writes on the last row
 * before turning round at a choke, a sump, a dig that needs tools, a
 * lead somebody else has already pushed. It is written as a word, so it
 * matches on word boundaries: a note reading "EOS, too tight to follow"
 * closes the station, and a station called EOSTER does not.
 */
CsFrontier.EOS_RE = /(^|[^A-Za-z0-9])(EOS|E\.O\.S\.?|END OF SURVEY)([^A-Za-z0-9]|$)/i;

/** True when a note says the survey deliberately ended here. */
CsFrontier.notesSayClosed = function(notes) {
    if (notes === undefined || notes === null) { return false; }
    return CsFrontier.EOS_RE.test(String(notes));
};

/**
 * The stations a party wrote off in the notebook, read from the notes.
 *
 * WHY THIS IS NOT A GUESS. Everything else in this file is geometry: a
 * station with one leg is an end because the line stops there, and no
 * opinion is involved. A CLOSED end is the one thing geometry cannot
 * see -- a choke and a lead look identical to the shots -- so openEnds
 * has always taken the closed names from its caller. Nobody ever passed
 * any, which meant a cave's every dead end came back as a lead and the
 * frontier list read as a list of places somebody already went.
 *
 * The party did record it, though: they wrote EOS in the margin. A note
 * belongs to the ROW it is on, and a row's station is its TO -- the
 * station just reached, which is the one they turned round at. So the
 * note closes `to`, never `from`.
 *
 * Splays carry notes too ("EOS, aven above") and are skipped: a splay
 * describes the wall at a station it hangs off, not an end of the line.
 *
 * \return {stationName: true}
 */
CsFrontier.closedByNote = function(survey) {
    var out = {};
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        if (!CsFrontier.notesSayClosed(shot.notes)) { continue; }
        var to = CsFrontier.clean(shot.to);
        if (to !== "") { out[to] = true; }
    }
    return out;
};

/**
 * The open ends of a survey: stations one leg long that are neither
 * control nor deliberately closed.
 *
 * \param survey a CsModel survey -- the WHOLE cave, every trip merged,
 *               as CsRevise.surveyFromDocument returns it. Handing this
 *               one trip's shots answers a different question (where
 *               that trip ended), which is legitimate but is not the
 *               cave's frontier.
 * \param options optional:
 *                  closed: [name] stations to treat as tied off, ON TOP
 *                          of the ones the notebook already closed with
 *                          an EOS note (see closedByNote)
 *                  ignoreNotes: true to read the shots' notes for
 *                          nothing and honour `closed` alone
 *
 * \return [{station, trip, degree, hasLrud, lastIndex}], newest trip
 *         first, then latest shot first, then by name.
 */
CsFrontier.openEnds = function(survey, options) {
    if (survey === undefined || survey === null ||
            Object.prototype.toString.call(survey.shots) !== "[object Array]") {
        return [];
    }
    var opts = (options === undefined || options === null) ? {} : options;

    // The notebook's own EOS notes first, then whatever the caller
    // adds. A caller that wants the raw geometry -- every one-leg
    // station, closed or not -- asks for it with ignoreNotes.
    var closed = (opts.ignoreNotes === true) ? {} :
        CsFrontier.closedByNote(survey);
    if (Object.prototype.toString.call(opts.closed) === "[object Array]") {
        for (var c = 0; c < opts.closed.length; c++) {
            var closedName = CsFrontier.clean(opts.closed[c]);
            if (closedName !== "") { closed[closedName] = true; }
        }
    }

    var degrees = CsFrontier.degrees(survey);
    var anchors = CsFrontier.anchors(survey);

    // The last leg to touch each station: its trip is the trip that
    // stopped there, and its index orders ends within a trip.
    var last = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        var trip = (typeof shot.trip === "number") ? shot.trip : 0;
        var ends = [CsFrontier.clean(shot.from), CsFrontier.clean(shot.to)];
        for (var e = 0; e < ends.length; e++) {
            last[ends[e]] = { trip: trip, index: i };
        }
    }

    var out = [];
    for (var name in degrees) {
        if (!Object.prototype.hasOwnProperty.call(degrees, name)) { continue; }
        if (degrees[name] !== 1) { continue; }
        if (anchors[name] === true) { continue; }
        if (closed[name] === true) { continue; }
        out.push({
            station: name,
            trip: last[name] === undefined ? 0 : last[name].trip,
            lastIndex: last[name] === undefined ? -1 : last[name].index,
            degree: 1,
            hasLrud: CsFrontier.hasLrud(survey, name)
        });
    }

    out.sort(function(a, b) {
        if (a.trip !== b.trip) { return b.trip - a.trip; }
        if (a.lastIndex !== b.lastIndex) { return b.lastIndex - a.lastIndex; }
        return a.station < b.station ? -1 : (a.station > b.station ? 1 : 0);
    });
    return out;
};

/**
 * The open ends left by ONE trip -- the subset of the cave's frontier
 * whose last leg belongs to that trip. This is what "carry on where trip
 * 6 stopped" means, and it is deliberately not the same as the whole
 * cave's frontier: older trips leave leads too, and those belong to the
 * cave, not to this trip.
 */
CsFrontier.openEndsOfTrip = function(survey, trip, options) {
    var wanted = (typeof trip === "number") ? trip : 0;
    var all = CsFrontier.openEnds(survey, options);
    var out = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].trip === wanted) { out.push(all[i]); }
    }
    return out;
};
