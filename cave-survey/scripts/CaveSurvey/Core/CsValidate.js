// Validate.js -- blunder hunting: the mistakes that stop a beginner's
// first survey from closing.
//
// Part of the Cave Survey Core library: pure functions.
//
// Every finding is ADVISORY. The surveyor is the authority on their
// own notes; these are flags, not gates, and the Notebook shows them
// beside the row without blocking entry. Each finding:
//
//   { severity: "error" | "warning",
//     shotIndex: index into survey.shots, or -1 for survey-wide,
//     code: short machine tag,
//     message: one plain-language sentence }
//
// "error" = the data cannot be drawn as given (bad number, self
// loop). "warning" = drawable but suspicious (probable backsight,
// duplicate disagreeing shot, big misclosure).

var CsValidate = {};

CsValidate.CLOSURE_WARN_PERCENT = 2.0; // BCRA grade 3 expects 1-5%

// The rest of this module's thresholds, named for the same reason
// CLOSURE_WARN_PERCENT is: a number sitting inline in a comparison can
// be nudged in a hurry, and what a suite warns about is exactly the
// kind of thing that drifts without anyone deciding it should. Each is
// pinned at its boundary in tests/js_unit.js.

/** Degrees of foresight/backsight disagreement tolerated before the
 *  instrument check speaks. Both compass and clino: the same eye and
 *  the same pair of instruments produce both. */
CsValidate.FSBS_TOLERANCE_DEG = 3.0;

/** Past this inclination a shot is called nearly plumb. Common in
 *  vertical caves and equally a classic sign-flip site, so it is a
 *  gentle warning rather than an error -- and a DECLARED plumb (+/-90)
 *  is past it too, on purpose: the flag says "this is vertical", which
 *  is true either way.
 *
 *  THE NUMBER ITSELF NOW LIVES IN ONE PLACE (CsTraverse.PLUMB_DEG).
 *  This name stays because it is what the finding's message means to a
 *  reader, but it is no longer a second, independently editable 85 --
 *  the warning a caver sees and the geometry rule that decides whether
 *  to read this leg's compass as a passage bearing must not be able to
 *  drift apart. */
CsValidate.NEAR_PLUMB_DEG = CsTraverse.PLUMB_DEG;

/** Two readings of the same pair agree when they are within this many
 *  degrees AND within DUPLICATE_DISTANCE_FRACTION of each other. */
CsValidate.DUPLICATE_AZIMUTH_DEG = 5.0;
CsValidate.DUPLICATE_DISTANCE_FRACTION = 0.05;

/** True when any finding is an error (vs merely a warning). */
CsValidate.checkHasErrors = function(findings) {
    for (var i = 0; i < findings.length; i++) {
        if (findings[i].severity === "error") {
            return true;
        }
    }
    return false;
};

/** Runs every check. resolved (from CsNetwork) is optional. */
CsValidate.check = function(survey, resolved) {
    // Parse-time findings ride along (CsModel.parseFindings): the
    // reader saw something the survey no longer shows -- a lossy trip
    // merge, say -- and this is the one list every report already
    // prints. A copy, so the survey's own list never grows.
    var findings = CsModel.parseFindings(survey);
    var shots = survey.shots;
    var i, j, s;

    var pairKey = function(a, b) {
        return a < b ? a + " " + b : b + " " + a;
    };
    var byPair = {};

    for (i = 0; i < shots.length; i++) {
        s = shots[i];
        if (s.excludeFromAll) {
            continue;
        }

        // ---- field sanity ----------------------------------------
        if (!s.splay && s.from !== "" && s.from === s.to) {
            findings.push({ severity: "error", shotIndex: i, code: "self-loop",
                message: "Shot goes from " + s.from + " to itself." });
        }
        if (!(s.distance > 0)) {
            findings.push({ severity: "error", shotIndex: i, code: "bad-distance",
                message: "Distance must be a positive number." });
        }
        if (s.azimuth < 0 || s.azimuth >= 360) {
            findings.push({ severity: "warning", shotIndex: i, code: "azimuth-range",
                message: "Azimuth " + s.azimuth + " is outside 0-360 and will be wrapped." });
        }
        if (s.inclination < -90 || s.inclination > 90) {
            findings.push({ severity: "error", shotIndex: i, code: "inclination-range",
                message: "Inclination " + s.inclination + " is outside -90 to +90." });
        }
        var lrudFields = [["left", s.left], ["right", s.right],
            ["up", s.up], ["down", s.down]];
        for (j = 0; j < lrudFields.length; j++) {
            var v = lrudFields[j][1];
            if (v !== null && v !== undefined && v < 0) {
                findings.push({ severity: "warning", shotIndex: i, code: "negative-lrud",
                    message: "Negative " + lrudFields[j][0] +
                        " reading; negative LRUD usually means 'not measured'." });
            }
        }

        // fs/bs pairs on ONE shot: the built-in instrument check.
        if (s.backAzimuth !== null && s.backAzimuth !== undefined) {
            var bsDiff = CsAngles.azimuthDifference(
                s.azimuth, s.backAzimuth + 180.0);
            if (bsDiff > CsValidate.FSBS_TOLERANCE_DEG) {
                findings.push({ severity: "warning", shotIndex: i,
                    code: "fsbs-azimuth-disagree",
                    message: "Shot " + s.from + " to " + s.to +
                        ": foresight and backsight compass disagree by " +
                        bsDiff.toFixed(1) + " deg (over " +
                        CsValidate.FSBS_TOLERANCE_DEG + ") -- re-read, or " +
                        "one instrument needs calibrating." });
            }
        }
        if (s.backInclination !== null && s.backInclination !== undefined) {
            var incDiff = Math.abs(s.inclination - (-s.backInclination));
            if (incDiff > CsValidate.FSBS_TOLERANCE_DEG) {
                findings.push({ severity: "warning", shotIndex: i,
                    code: "fsbs-inclination-disagree",
                    message: "Shot " + s.from + " to " + s.to +
                        ": foresight and backsight clino disagree by " +
                        incDiff.toFixed(1) + " deg (over " +
                        CsValidate.FSBS_TOLERANCE_DEG + ")." });
            }
        }

        // Nearly plumb shots are common in vertical caves but also a
        // classic sign-flip/typo site -- flag once, gently.
        //
        // The comparison is `>=`, matching CsTraverse.isPlumb, so the
        // boundary angle itself falls on the SAME side of the line in
        // the warning a caver reads and in the geometry rule that
        // stops reading this leg's compass as a passage bearing. With
        // `>` here and `>=` there, a shot recorded at exactly the
        // threshold was treated as a pitch by every drawing rule while
        // the validator said nothing about it -- the one angle where
        // the two disagreed, and the one a caver is most likely to
        // write down deliberately.
        if (Math.abs(s.inclination) >= CsValidate.NEAR_PLUMB_DEG &&
                s.distance > 0) {
            findings.push({ severity: "warning", shotIndex: i, code: "near-plumb",
                message: "Inclination " + s.inclination +
                    " is nearly plumb; fine if this was a plumbed pitch." });
        }

        if (!s.splay && s.from !== "" && s.to !== "") {
            var key = pairKey(s.from, s.to);
            if (byPair[key] === undefined) {
                byPair[key] = [];
            }
            byPair[key].push(i);
        }
    }

    // ---- duplicates and probable backsights -----------------------
    for (var key2 in byPair) {
        if (!byPair.hasOwnProperty(key2) || byPair[key2].length < 2) {
            continue;
        }
        var idxs = byPair[key2];
        for (i = 0; i < idxs.length; i++) {
            for (j = i + 1; j < idxs.length; j++) {
                var a = shots[idxs[i]], b = shots[idxs[j]];
                var sameDir = (a.from === b.from);
                // What b's azimuth should read if it agrees with a:
                var expected = sameDir ? a.azimuth : a.azimuth + 180.0;
                var azDiff = CsAngles.azimuthDifference(expected, b.azimuth);
                var distDiff = Math.abs(a.distance - b.distance);

                if (azDiff < CsValidate.DUPLICATE_AZIMUTH_DEG &&
                    distDiff < Math.max(a.distance, b.distance) *
                        CsValidate.DUPLICATE_DISTANCE_FRACTION) {
                    // AGREEING duplicate. Within ONE trip that is
                    // normal practice -- a foresight and its backsight,
                    // or a leg read twice -- and saying anything about
                    // it would cry wolf on every careful survey.
                    //
                    // ACROSS trips it is not practice, it is a page
                    // drawn twice: two trips cannot both have walked
                    // the same leg and written down the same numbers.
                    // This case used to fall into the same silence, and
                    // that is exactly how a whole duplicated trip hid
                    // in a drawing -- agreeing to within a declination
                    // correction (well under DUPLICATE_AZIMUTH_DEG),
                    // it said nothing at all, while the duplicate legs
                    // made every station on the run look like a
                    // junction to CsLrud.wallRuns (LRUD walls stopped
                    // drawing) and raised a phantom loop per leg.
                    if ((a.trip || 0) === (b.trip || 0)) {
                        continue;
                    }
                    findings.push({ severity: "error", shotIndex: idxs[j],
                        code: "duplicate-across-trips",
                        message: "Trip " + (a.trip || 0) + " and trip " +
                            (b.trip || 0) + " both record the shot " +
                            a.from + " to " + a.to + " -- the same page " +
                            "was probably drawn twice. Delete one of " +
                            "them in Edit Trip." });
                    continue;
                }
                var flippedDiff = CsAngles.azimuthDifference(
                    expected + 180.0, b.azimuth);
                if (flippedDiff < CsValidate.DUPLICATE_AZIMUTH_DEG) {
                    findings.push({ severity: "warning", shotIndex: idxs[j],
                        code: "backsight-as-foresight",
                        message: "Shot " + b.from + " to " + b.to +
                            " reads about 180 deg from its duplicate -- was a backsight entered as a foresight?" });
                } else if ((a.trip || 0) !== (b.trip || 0)) {
                    // Same leg, two trips, DISAGREEING readings: still
                    // a page drawn twice, just one whose declination or
                    // corrected numbers moved it further than the
                    // agreeing case. Named as the duplicate it is --
                    // "check your notes, these two readings disagree"
                    // sends the caver back underground for a leg that
                    // was only ever surveyed once.
                    findings.push({ severity: "error", shotIndex: idxs[j],
                        code: "duplicate-across-trips",
                        message: "Trip " + (a.trip || 0) + " and trip " +
                            (b.trip || 0) + " both record the shot " +
                            a.from + " to " + a.to + " (azimuth differs " +
                            azDiff.toFixed(1) + " deg, distance " +
                            distDiff.toFixed(2) + ") -- the same page was " +
                            "probably drawn twice, once with a different " +
                            "declination. Delete one of them in Edit Trip." });
                } else {
                    findings.push({ severity: "warning", shotIndex: idxs[j],
                        code: "duplicate-disagrees",
                        message: "Shots between " + a.from + " and " + a.to +
                            " disagree (azimuth differs " + azDiff.toFixed(1) +
                            " deg, distance " + distDiff.toFixed(2) + ")." });
                }
            }
        }
    }

    // ---- a trip with nowhere to keep its own record ---------------
    //
    // A trip's date, team, instruments and declination ride a TAG on
    // the first station the trip owns (CsDraw.survey's per-trip anchor
    // block). A trip that owns no station therefore has nowhere to
    // write them: the drawing takes its shots and silently forgets
    // whose they were, and on the next read it comes back with an
    // empty date and team. That is not only a lost record -- it is
    // self-perpetuating, because SurveyNotebook matches a page to the
    // trip it revises by date|team, so a trip whose record vanished
    // can never be matched again and every redraw of that page appends
    // yet another copy.
    //
    // Ownership is "the trip of the first shot that touches the
    // station", the same rule CsDelta.stationTrips and CsDraw use.
    // Spelled out here rather than called, so Validate keeps loading
    // without CsDelta.
    if (survey.trips !== undefined && survey.trips !== null &&
            survey.trips.length > 1) {
        var ownerOf = {};
        for (i = 0; i < shots.length; i++) {
            var os = shots[i];
            if (os.excludeFromAll) {
                continue;
            }
            var ot = os.trip || 0;
            if (os.from !== "" && ownerOf[os.from] === undefined) {
                ownerOf[os.from] = ot;
            }
            if (!os.splay && os.to !== "" && ownerOf[os.to] === undefined) {
                ownerOf[os.to] = ot;
            }
        }
        var owns = {};
        for (var on in ownerOf) {
            if (ownerOf.hasOwnProperty(on)) {
                owns[ownerOf[on]] = true;
            }
        }
        var hasShots = {};
        for (i = 0; i < shots.length; i++) {
            if (!shots[i].excludeFromAll) {
                hasShots[shots[i].trip || 0] = true;
            }
        }
        for (var tp = 0; tp < survey.trips.length; tp++) {
            if (hasShots[tp] === true && owns[tp] !== true) {
                findings.push({ severity: "error", shotIndex: -1,
                    code: "trip-owns-no-station",
                    message: "Trip " + tp + " has shots but reaches no " +
                        "station of its own, so its date and team cannot " +
                        "be stored in the drawing and will be lost on " +
                        "the next read. It is almost certainly a page " +
                        "that was drawn twice -- delete it in Edit Trip." });
            }
        }
    }

    // ---- network-level checks -------------------------------------
    if (resolved !== undefined && resolved !== null) {
        for (i = 0; i < resolved.loops.length; i++) {
            var loop = resolved.loops[i];
            if (loop.percent > CsValidate.CLOSURE_WARN_PERCENT) {
                findings.push({ severity: "warning", shotIndex: -1, code: "loop-misclosure",
                    message: "Loop " + loop.from + " ... " + loop.to + " closes " +
                        loop.error.toFixed(2) + " off over " +
                        loop.traverseLength.toFixed(1) + " surveyed (" +
                        loop.percent.toFixed(1) + "%). Over " +
                        CsValidate.CLOSURE_WARN_PERCENT +
                        "% usually means a blunder somewhere on the loop." });
            }
        }
        for (i = 0; i < resolved.unresolved.length; i++) {
            var u = resolved.unresolved[i];
            findings.push({ severity: "error", shotIndex: shots.indexOf(u),
                code: "unconnected",
                message: "Shot " + u.from + " to " + u.to +
                    " never connects to the rest of the survey -- check the station names." });
        }
    }

    return findings;
};
