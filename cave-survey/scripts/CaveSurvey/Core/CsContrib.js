// CsContrib.js -- who surveyed what, in distance and percent.
//
// Part of the Cave Survey Core library: no document and no GUI, so
// the whole of it runs under the headless test harness. Not every
// function here is pure, though: byTrip calls CsModel.ensureTrips
// (survey), which can MUTATE its `survey` argument -- the first time
// a survey with no trips reaches it, ensureTrips builds trips[0] out
// of the top-level fields and stamps every shot missing a trip with 0
// (see ensureTrips' own docblock).
//
// WHAT COUNTS. Exactly the shots CsStats.compute counts: not splays,
// not excludeFromAll, not excludeFromLength, nothing missing an end.
// DELEGATED rather than reinvented -- CsStats.countsForLength is the
// one rule both call, because the rows have to sum to the Length
// printed on the title block or the window and the sheet disagree in
// front of the reader. (The excludeFromLength half of that rule was
// the gap this comment used to describe as known and open; it closed
// with pitfalls 21 and 22.)
//
// One more divergence from CsStats, and this one is deliberate rather
// than inherited: byTrip and byRun both skip a shot whose CsTraverse.
// offset(s, tapeMode) comes back null (no usable geometry -- a non-
// finite distance/azimuth/inclination survives resolve() inside a
// disconnected block), where CsStats.compute calls .plan on that same
// null and throws. Skipping is the right call here: a trip/run summary
// window has no business crashing over one bad shot elsewhere in the
// survey, and the alternative (half-counting distance without
// planDistance) manufactures a NaN that poisons the total silently.
// See byTrip's and byRun's own comments at the skip itself.
//
// CREDIT IS NOT DIVIDED. Two people on one trip are each credited its
// full distance, so People percentages can exceed 100%. Dividing 412 ft
// by a party of three invents a number nobody measured. byPerson
// reports `overlapping` so the window can say so out loud instead of
// leaving the reader to work out why the column does not add up.

var CsContrib = {};

/** Separators used when a comma is safe to treat as a break between
 *  two people: semicolon, slash, ampersand, plus, a run of newlines,
 *  and the word "and" (which is why "Ann and Bob" splits but
 *  "Alexander" does not -- the pattern needs the word whole), PLUS a
 *  bare comma. Deliberately NOT a bare hyphen: that would split a
 *  hyphenated surname ("Mary Smith-Jones") into two people.
 *
 *  Plain regex SOURCE STRINGS, not RegExp literals: splitTagged below
 *  builds a fresh RegExp per call so a leftover `lastIndex` never
 *  leaks between calls, and building it from `new RegExp(str, "gi")`
 *  directly -- rather than from a literal's own `.source` -- turned
 *  out to matter. Reconstructing via `.source` is exactly what broke
 *  the "/" alternative silently under CaveCAD's own script engine
 *  (it split fine under node, the same regex simply stopped matching
 *  a literal "/" once round-tripped through .source there) while
 *  raising no error either engine's side, so this file was left with
 *  a working test suite in one engine and a real bug in the other. A
 *  literal used directly (as every other regex in this file is) never
 *  goes through .source and is not at risk. */
CsContrib.SEP_GENERIC_SOURCE = ",|;|/|&|\\+|\\n+|\\band\\b";

/** The same separators MINUS the comma, for text that is already
 *  known to be a surname-first list ("Last, First; Last, First"),
 *  where a comma is part of one name, not a break between two. */
CsContrib.SEP_NO_COMMA_SOURCE = "/|&|\\+|\\n+|\\band\\b";

/** Trailing tokens that read as part of the PREVIOUS name, not as a
 *  person of their own, once a split has cut a name in two on the
 *  comma that precedes them ("Nathan Schonegg, Jr." must not hand
 *  back a person named "Jr."). Matched case-insensitively against the
 *  whole trimmed token. Gated on the separator having actually BEEN a
 *  comma (see splitTagged/people below) -- "Nathan and Jr." is a
 *  two-person party where "Jr." is somebody's real nickname, not a
 *  suffix to re-attach. */
CsContrib.NAME_SUFFIXES = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv",
    "phd", "ph.d.", "et al", "et al."];

CsContrib.isNameSuffix = function(token) {
    var t = String(token).replace(/^\s+|\s+$/g, "").toLowerCase();
    for (var i = 0; i < CsContrib.NAME_SUFFIXES.length; i++) {
        if (t === CsContrib.NAME_SUFFIXES[i]) {
            return true;
        }
    }
    return false;
};

/**
 * Splits `text` on every match of the separator pattern `sepSource`
 * (a regex SOURCE STRING -- see the two SEP_*_SOURCE constants above
 * for why a string, not a RegExp), and for each resulting piece also
 * reports whether the separator immediately BEFORE it was a literal
 * comma (as opposed to ";", "/", "&", "+", a newline, or "and"). That
 * is the one fact the suffix merge in `people` needs and `String.
 * split` throws away.
 *
 * \return [{name, precededByComma}] -- name is untrimmed, exactly the
 *         text between two separators (or the ends of the string)
 */
CsContrib.splitTagged = function(text, sepSource) {
    var re = new RegExp(sepSource, "gi");
    var tokens = [];
    var lastIndex = 0;
    var precededByComma = false;
    var m;
    while ((m = re.exec(text)) !== null) {
        tokens.push({ name: text.substring(lastIndex, m.index),
            precededByComma: precededByComma });
        precededByComma = (m[0] === ",");
        lastIndex = m.index + m[0].length;
        if (m[0].length === 0) {
            re.lastIndex++;
        }
    }
    tokens.push({ name: text.substring(lastIndex),
        precededByComma: precededByComma });
    return tokens;
};

/** The key two spellings of the SAME person dedup on: punctuation
 *  stripped, runs of whitespace collapsed to one space, upper-cased.
 *  "Nathan Schonegg, Jr." and "Nathan Schonegg Jr." (typed without the
 *  comma on a later trip) must land on one row, not two -- the row's
 *  DISPLAYED name still keeps whichever spelling was seen first. */
CsContrib.personKey = function(name) {
    return String(name)
        .replace(/[.,]/g, "")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "")
        .toUpperCase();
};

/**
 * Team text -> the people on it.
 *
 * In order, each closing a way the naive "split on punctuation"
 * reading fabricates -- or erases -- contributors nobody intended:
 *
 *   1. A team text wrapped ENTIRELY in one pair of parens or brackets
 *      ("(Nathan, Jim)", or nested, "((Nathan, Jim))" / "[(Nathan,
 *      Jim)]") is unwrapped first, one layer at a time until the text
 *      is no longer fully wrapped: the wrapping IS the team text here,
 *      not a role note on one name, and running the role-note stripper
 *      on it as-is would erase the whole thing. Stopping after one
 *      layer used to leave a double-wrapped team ("((Nathan, Jim))")
 *      erased the same way.
 *   2. Parenthesised / bracketed role notes ("(book and sketch)",
 *      "[sketch]") are stripped next -- otherwise the "and" or comma
 *      INSIDE the note splits like a separator and hands back a
 *      phantom person. A stray, unmatched bracket character this
 *      leaves glued to a name (nested parens defeat the regex) is
 *      swept up per-name in step 4.
 *   3. A team text containing a semicolon is read as a surname-first
 *      list ("Last, First; Last, First") ONLY when EVERY semicolon-
 *      delimited segment contains a comma: each such segment is split
 *      on the generic separators MINUS the comma, so "Doe, Jane and
 *      Bob Jones" still recovers two people while "Schonegg, Nathan"'s
 *      own comma is left alone. The moment even one segment has no
 *      comma of its own ("Nathan; Jim, Sarah" -- the first segment is
 *      one bare name), the semicolon cannot be trusted as a name-
 *      internal separator either, and the WHOLE text falls back to the
 *      generic separators, comma included (which still splits on ";"
 *      as one of them). Treating ANY semicolon as proof that every
 *      comma in the text is name-internal used to erase Sarah entirely
 *      and merge "Jim, Sarah" into one contributor.
 *   4. Each resulting piece has stray leading/trailing whitespace and
 *      bracket characters trimmed, then dropped outright if what is
 *      left has no letter and no digit at all (a bare "." or a stray
 *      unmatched bracket with nothing else) -- otherwise a trailing
 *      NAME_SUFFIXES token is re-attached onto the name before it, but
 *      ONLY when the separator that produced the split was actually a
 *      comma, so "Nathan Schonegg, Jr." merges while "Nathan and Jr."
 *      (Jr. as somebody's own nickname) does not.
 *
 * Case-insensitive, punctuation-insensitive de-duplication (see
 * personKey) runs last, over whatever the four steps produced.
 */
CsContrib.people = function(teamText) {
    if (teamText === undefined || teamText === null) {
        return [];
    }
    var text = String(teamText).replace(/^\s+|\s+$/g, "");

    // Loop, not a single if/else-if: a team text can be wrapped more
    // than one layer deep ("((Nathan, Jim))", or mixed, "[(Nathan,
    // Jim)]"), and stopping after one layer left the still-wrapped
    // remainder to be swept up by the role-note stripper below --
    // which erases it, crediting nobody, the exact silent-zero this
    // unwrap exists to prevent.
    while (text.length >= 2 &&
            ((text.charAt(0) === "(" &&
                text.charAt(text.length - 1) === ")") ||
             (text.charAt(0) === "[" &&
                text.charAt(text.length - 1) === "]"))) {
        text = text.substring(1, text.length - 1).replace(/^\s+|\s+$/g, "");
    }

    text = text.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");

    var tokens;
    // A semicolon proves the text is a surname-first list ("Last,
    // First; Last, First") -- and therefore that every comma in it is
    // name-internal, not a separator -- only when EVERY segment it
    // delimits contains a comma of its own. "Nathan; Jim, Sarah" has a
    // semicolon but its first segment ("Nathan") has no comma, so the
    // discriminator fails and the whole text falls back to the generic
    // separators (which still split on ";"); treating the bare
    // semicolon alone as proof used to keep "Jim, Sarah" together as
    // one contributor and erase Sarah.
    if (text.indexOf(";") >= 0) {
        var segments = text.split(/\s*;\s*/);
        var allSegmentsHaveComma = true;
        for (var ci = 0; ci < segments.length; ci++) {
            if (segments[ci].indexOf(",") < 0) {
                allSegmentsHaveComma = false;
                break;
            }
        }
        if (allSegmentsHaveComma) {
            tokens = [];
            for (var si = 0; si < segments.length; si++) {
                var sub = CsContrib.splitTagged(segments[si],
                    CsContrib.SEP_NO_COMMA_SOURCE);
                for (var sj = 0; sj < sub.length; sj++) {
                    tokens.push(sub[sj]);
                }
            }
        } else {
            tokens = CsContrib.splitTagged(text,
                CsContrib.SEP_GENERIC_SOURCE);
        }
    } else {
        tokens = CsContrib.splitTagged(text, CsContrib.SEP_GENERIC_SOURCE);
    }

    var merged = [];
    for (var i = 0; i < tokens.length; i++) {
        var name = tokens[i].name
            .replace(/^[\s()\[\]]+/, "")
            .replace(/[\s()\[\]]+$/, "");
        if (name.length === 0) {
            continue;
        }
        // Mismatched bracket types ("Nathan (book]") and bare
        // punctuation left over from a split (a lone "." before a
        // trailing suffix, "., Jim") survive the boundary-only trim
        // above -- it only strips runs of whitespace/brackets AT THE
        // ENDS of a token, not stray punctuation with no letter or
        // digit anywhere in it. Drop any such token outright rather
        // than hand back a "person" named "." or "(".
        if (!/[A-Za-z0-9]/.test(name)) {
            continue;
        }
        if (tokens[i].precededByComma && CsContrib.isNameSuffix(name) &&
                merged.length > 0) {
            merged[merged.length - 1] = merged[merged.length - 1] +
                ", " + name;
            continue;
        }
        merged.push(name);
    }

    var out = [], seen = {};
    for (var m = 0; m < merged.length; m++) {
        // one person however they spelled or punctuated it, keeping
        // the first spelling seen -- a survey where "nathan" and
        // "Nathan" are two contributors is a data-entry artefact, not
        // two people
        var key = CsContrib.personKey(merged[m]);
        if (seen[key] === true) {
            continue;
        }
        seen[key] = true;
        out.push(merged[m]);
    }
    return out;
};

/** True when a shot contributes to surveyed length. The one rule, so
 *  every row type agrees and the total matches CsStats. */
CsContrib.counts = function(shot) {
    return CsStats.countsForLength(shot);
};

/** percent of total, 0 (not NaN, not Infinity) when there is no total
 *  or the part itself is not a finite number. */
CsContrib.share = function(part, total) {
    if (!(total > 0)) {
        return 0.0;
    }
    if (typeof part !== "number" || !isFinite(part)) {
        return 0.0;
    }
    return part / total * 100.0;
};

/**
 * One row per trip.
 *
 * stationCount counts stations TOUCHED: both ends of every counted
 * shot in the trip, so a station an earlier trip already established
 * is counted again here. Summed across trips it therefore exceeds the
 * survey's own count of distinct stations, and is deliberately not
 * comparable to CsStats.compute().stationCount despite the shared
 * field name.
 *
 * \return [{tripId, label, name, date, team, distance, planDistance,
 *           shotCount, stationCount, percent}] in trip-index order
 */
CsContrib.byTrip = function(survey, resolved, tapeMode) {
    CsModel.ensureTrips(survey);
    var rows = [];
    var i;
    for (i = 0; i < survey.trips.length; i++) {
        var t = survey.trips[i];
        rows.push({
            tripId: i,
            label: CsRevise.tripLabel(i, t),
            name: t.name || "",
            date: t.date || "",
            team: t.team || "",
            distance: 0.0,
            planDistance: 0.0,
            shotCount: 0,
            stationCount: 0,
            percent: 0.0
        });
    }

    var stationsSeen = [];
    for (i = 0; i < rows.length; i++) {
        stationsSeen.push({});
    }

    var total = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        var off = CsTraverse.offset(s, tapeMode);
        if (off === null) {
            // No usable geometry (a non-finite distance/azimuth/
            // inclination survives resolve() inside a disconnected
            // block). Skip the WHOLE shot rather than adding its
            // distance while dropping its planDistance -- half-
            // counting it would manufacture a NaN that surfaces later
            // as a believable all-zero table instead of a loud
            // failure.
            continue;
        }
        // A stale or hand-edited trip index can be fractional
        // (CsTags.getNumber reads a hand-edited "Trip=1.5" tag with
        // parseFloat) or simply gone -- floor the first, and fall the
        // second back to trip 0, rather than indexing rows with a
        // value that is not one of its own keys.
        var rawId = (s.trip === undefined || s.trip === null) ?
            0 : Number(s.trip);
        var id = Math.floor(rawId);
        if (isNaN(id) || id < 0 || id >= rows.length) {
            id = 0;
        }
        rows[id].distance += s.distance;
        rows[id].planDistance += off.plan;
        rows[id].shotCount++;
        stationsSeen[id][s.from] = true;
        stationsSeen[id][s.to] = true;
        total += s.distance;
    }

    for (i = 0; i < rows.length; i++) {
        rows[i].percent = CsContrib.share(rows[i].distance, total);
        var n = 0;
        for (var name in stationsSeen[i]) {
            if (stationsSeen[i].hasOwnProperty(name)) {
                n++;
            }
        }
        rows[i].stationCount = n;
    }
    return rows;
};

/**
 * Trip rows grouped by their team text.
 *
 * \return [{team, distance, percent, tripCount, tripIds}] in
 *         first-appearance order
 */
CsContrib.byTeam = function(tripRows) {
    var order = [], byKey = {}, total = 0.0;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        var key = r.team || "";
        if (byKey[key] === undefined) {
            byKey[key] = { team: key, distance: 0.0, percent: 0.0,
                tripCount: 0, tripIds: [] };
            order.push(key);
        }
        byKey[key].distance += r.distance;
        byKey[key].tripCount++;
        byKey[key].tripIds.push(r.tripId);
        total += r.distance;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        out.push(row);
    }
    return out;
};

/**
 * Trip rows credited to each person who was on them, IN FULL -- see
 * the note at the top of this file.
 *
 * \return {rows: [{person, distance, percent, tripCount, tripIds}],
 *          overlapping: true when any single trip with distance > 0
 *          lists two or more people -- that trip's distance was
 *          credited to more than one row, so the People percentages
 *          cannot be read as parts of a single whole. A grand-total
 *          comparison would miss this: an unattributed trip (blank
 *          team, credited to nobody) can carry enough distance of its
 *          own to keep the credited sum under the survey total even
 *          while a party of two is double-counted elsewhere.}
 */
CsContrib.byPerson = function(tripRows) {
    var order = [], byKey = {}, total = 0.0, overlapping = false;
    for (var i = 0; i < tripRows.length; i++) {
        var r = tripRows[i];
        total += r.distance;
        var names = CsContrib.people(r.team);
        if (r.distance > 0 && names.length >= 2) {
            overlapping = true;
        }
        for (var p = 0; p < names.length; p++) {
            // Normalised, punctuation-insensitive key: "Nathan
            // Schonegg, Jr." on one trip and "Nathan Schonegg Jr." on
            // another (typed without the comma) are the same person,
            // not two rows -- see personKey's own docblock.
            var key = CsContrib.personKey(names[p]);
            if (byKey[key] === undefined) {
                byKey[key] = { person: names[p], distance: 0.0,
                    percent: 0.0, tripCount: 0, tripIds: [] };
                order.push(key);
            }
            byKey[key].distance += r.distance;
            byKey[key].tripCount++;
            byKey[key].tripIds.push(r.tripId);
        }
    }
    var rows = [];
    for (i = 0; i < order.length; i++) {
        var row = byKey[order[i]];
        row.percent = CsContrib.share(row.distance, total);
        rows.push(row);
    }
    return { rows: rows, overlapping: overlapping };
};

/** The note the window prints over the People section, so the reader is
 *  never left wondering why the column adds up to more than the cave. */
CsContrib.PERSON_CREDIT_NOTE =
    "Everyone on a trip is credited its whole distance, so these add " +
    "up to more than 100%.";

/**
 * One row per survey run (station-name prefix).
 *
 * A leg belongs to the run its TO station is in: that is the station
 * the shot established, and it is the same rule the profile bands use
 * to decide which run a leg belongs to. A leg from A3 into B1 is B's
 * first leg, not A's fourth.
 *
 * A shot whose TO station never resolved into the network (a run not
 * yet tied in to the rest of the cave) or whose name CsProfile.
 * splitName refuses is a NORMAL mid-project state, not an error --
 * cavers survey in disconnected blocks all the time. Dropping that
 * distance from both the row and the total would silently rescale
 * every other run to fill 100%, which reads as "this is the whole
 * cave" when it is not. It is counted into `unassigned` instead, so
 * the gap is visible rather than hidden.
 *
 * \return {rows: [{run, distance, planDistance, percent, shotCount,
 *          stations}] in resolution order, percent being that run's
 *          share of the FULL counted total -- rows' percentages plus
 *          unassigned's share sum to 100%, the same convention byTrip
 *          uses,
 *          unassigned: summed distance of counted shots no run
 *          claimed}
 */
CsContrib.byRun = function(survey, resolved, tapeMode) {
    var grouped = CsProfile.groupRuns(resolved);
    var runOf = {};
    var i, k;
    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var members = grouped.runs[key].stations;
        for (k = 0; k < members.length; k++) {
            runOf[members[k]] = key;
        }
    }

    var byKey = {}, total = 0.0, unassigned = 0.0;
    for (i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsContrib.counts(s)) {
            continue;
        }
        var off = CsTraverse.offset(s, tapeMode);
        if (off === null) {
            // See byTrip's identical guard: skip the whole shot, not
            // just its planDistance, or `unassigned` (and every row's
            // percent) can end up NaN while distanceText/percentText
            // render that as a plausible-looking "0 ft" / "0%".
            continue;
        }
        total += s.distance;
        var run = runOf[s.to];
        if (run === undefined) {
            unassigned += s.distance;
            continue;
        }
        if (byKey[run] === undefined) {
            byKey[run] = { run: run, distance: 0.0, planDistance: 0.0,
                percent: 0.0, shotCount: 0,
                stations: grouped.runs[run].stations };
        }
        byKey[run].distance += s.distance;
        byKey[run].planDistance += off.plan;
        byKey[run].shotCount++;
    }

    // resolution order, not discovery-by-shot order, so the list reads
    // the same way the profile bands and the notebook do
    var out = [];
    for (i = 0; i < grouped.order.length; i++) {
        var ordered = byKey[grouped.order[i]];
        if (ordered !== undefined) {
            ordered.percent = CsContrib.share(ordered.distance, total);
            out.push(ordered);
        }
    }
    return { rows: out, unassigned: unassigned };
};

/** "1,234 ft" -- grouped, rounded to the whole unit, unit appended.
 *  Matches CsSheet's title-block Length so the two never look like
 *  different measurements of the same cave. A non-finite distance
 *  (Infinity, -Infinity, NaN) OR one so large JS stringifies it in
 *  exponential notation ("1e+21") reads as 0 rather than falling
 *  through to the digit-grouping loop, which otherwise treats letters
 *  like "Infinity"'s or "1e+21"'s own characters as digits and
 *  produces something like "In,fin,ity" or "1e,+21". */
CsContrib.distanceText = function(distance, unit) {
    var d = (distance === null || distance === undefined) ? 0 : distance;
    if (typeof d !== "number" || !isFinite(d)) {
        d = 0;
    }
    var n = Math.round(d);
    var text = String(Math.abs(n));
    if (!/^[0-9]+$/.test(text)) {
        n = 0;
        text = "0";
    }
    var grouped = "";
    while (text.length > 3) {
        grouped = "," + text.substring(text.length - 3) + grouped;
        text = text.substring(0, text.length - 3);
    }
    grouped = text + grouped;
    if (n < 0) {
        grouped = "-" + grouped;
    }
    return grouped + ((unit === undefined || unit === null || unit === "") ?
        "" : (" " + unit));
};

/** "14%" -- and "<1%" for a real but tiny share, because a row that
 *  reads 0% next to a drawn passage looks like a bug. Guarded against
 *  non-finite input like its siblings distanceText and share, though
 *  nothing in this file can hand it one today. */
CsContrib.percentText = function(percent) {
    var p = (percent === null || percent === undefined) ? 0 : percent;
    if (typeof p !== "number" || !isFinite(p)) {
        p = 0;
    }
    if (p > 0 && p < 0.5) {
        return "<1%";
    }
    return String(Math.round(p)) + "%";
};
