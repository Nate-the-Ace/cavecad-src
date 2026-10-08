// Survex.js -- Survex .svx reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common core, not the full specification (see
// Compass.js for why). Supported: *begin/*end name prefixes (joined
// with "."), *data normal with declared field order including the
// length/bearing/gradient aliases and backcompass/backclino
// (backsights land in Shot.backAzimuth/backInclination, declination
// applied so both sights share the model's true frame), plumbed legs
// (compass omitted "-", clino UP/DOWN/U/D/+V/-V, LEVEL), *data
// passage (LRUD per STATION, matched to shots by TO name; the first
// station's record lands in survey.startLrud), *units length
// feet/metres/yards with optional factor, *units compass/clino
// degrees/grads (clino also percent), *calibrate declination (a ZERO
// ERROR: Survex SUBTRACTS it from readings, so the model declination
// is its negation), *declination <value> (conventional sign, added),
// *flags splay/duplicate/surface with "not" (saved/restored across
// *begin/*end), anonymous stations ./../... and the PocketTopo "-",
// *fix (optional "reference" keyword skipped, standard errors read
// past), ; comments, *team, *date (first date of a range).
// Not supported: *include, diving/cartesian/nosurvey styles,
// interleaved data, other *calibrate corrections, *declination auto
// (needs the IGRF at a projected location -- left at zero, the
// Declination tool can supply it).
//
// Survex default length unit is metres.

var CsFormatSurvex = {};

// field-name aliases (*data normal)
CsFormatSurvex.FIELD_ALIASES = {
    length: "tape", bearing: "compass", gradient: "clino",
    backlength: "backtape", backbearing: "backcompass",
    backgradient: "backclino",
    ceiling: "up", floor: "down"
};

// *team role words -- everything from the first role onward is roles
CsFormatSurvex.TEAM_ROLES = {
    tape: 1, length: 1, compass: 1, bearing: 1, clino: 1, gradient: 1,
    backtape: 1, backcompass: 1, backclino: 1, backbearing: 1,
    backgradient: 1, insts: 1, instruments: 1, counter: 1, depth: 1,
    station: 1, position: 1, notes: 1, pictures: 1, assistant: 1,
    altitude: 1, dimensions: 1, left: 1, right: 1, up: 1, down: 1,
    explorer: 1
};

/** Clino keyword -> degrees, or undefined when not a keyword. */
CsFormatSurvex.clinoKeyword = function(text) {
    var t = String(text).toLowerCase();
    if (t === "up" || t === "u" || t === "+v") {
        return 90.0;
    }
    if (t === "down" || t === "d" || t === "-v") {
        return -90.0;
    }
    if (t === "level" || t === "h") {
        return 0.0;
    }
    return undefined;
};

CsFormatSurvex.parse = function(content) {
    var survey = CsModel.newSurvey();
    var passageLrud = {}; // full station name -> {left,right,up,down}
    var passageOrder = [];

    var lines = content.split(/\r\n|\r|\n/);
    var prefixStack = [];
    var lengthUnit = "m";
    var lengthScale = 1.0;   // yards etc: scale into lengthUnit
    var compassInGrads = false;
    var clinoUnit = "deg";   // "deg" | "grad" | "percent"
    var declination = 0.0;   // model frame: added to magnetic
    var flags = { splay: false, duplicate: false, surface: false };
    var flagStack = [];
    survey.distanceUnit = null;
    // Set true once a leg has been recorded against the CURRENT
    // running team; a *date seen after that means a new trip is
    // starting, so the team must be cleared (see *date handling
    // below) instead of the next *team lines appending onto the
    // previous trip's crew.
    var teamDirty = false;
    // The running trip, kept HERE rather than on survey.date/survey.team.
    // Those two are not safe to use as running state: CsModel.tripIdFor
    // calls ensureTrips, and ensureTrips unconditionally mirrors
    // trips[0] back onto them -- so the first leg of a new trip used to
    // create that trip correctly and, in the same call, reset the
    // running state to trip 0's, sending every following leg back into
    // trip 0. The trip LIST stayed perfect, which is why nothing caught
    // it: 137 of PITFALL CAVE's 141 legs came back on the entrance trip.
    var curDate = "";
    var curTeam = "";

    var intoSurveyUnit = function(v) {
        if (survey.distanceUnit === null) {
            survey.distanceUnit = lengthUnit;
        }
        return CsUnits.convert(v * lengthScale, lengthUnit, survey.distanceUnit);
    };

    var compassToDegrees = function(v) {
        return compassInGrads ? CsAngles.gradsToDegrees(v) : v;
    };
    var clinoToDegrees = function(v) {
        if (clinoUnit === "grad") {
            return CsAngles.gradsToDegrees(v);
        }
        if (clinoUnit === "percent") {
            return Math.atan(v / 100.0) * 180.0 / Math.PI;
        }
        return v;
    };

    var dataStyle = "normal"; // Survex's default before any *data
    var normalFields = ["from", "to", "tape", "compass", "clino"];
    var passageFields = ["station", "left", "right", "up", "down"];

    var fullName = function(name) {
        if (prefixStack.length === 0) {
            return name;
        }
        return prefixStack.join(".") + "." + name;
    };

    var isAnonymous = function(name) {
        return name === "-" || name === "." || name === ".." || name === "...";
    };

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var semiIdx = rawLine.indexOf(";");
        var notes = semiIdx >= 0 ?
            rawLine.substring(semiIdx + 1).replace(/^\s+|\s+$/g, "") : "";
        var line = (semiIdx >= 0 ? rawLine.substring(0, semiIdx) : rawLine)
            .replace(/^\s+|\s+$/g, "");
        if (line.length === 0) {
            continue;
        }

        if (line.charAt(0) === "*") {
            var tokens = line.split(/\s+/);
            var cmd = tokens[0].toLowerCase();

            if (cmd === "*begin") {
                prefixStack.push(tokens.length > 1 ? tokens[1] : ("anon" + li));
                flagStack.push({ splay: flags.splay,
                    duplicate: flags.duplicate, surface: flags.surface });
                if (survey.name === "" && tokens.length > 1) {
                    survey.name = tokens[1];
                }
            } else if (cmd === "*end") {
                prefixStack.pop();
                if (flagStack.length > 0) {
                    flags = flagStack.pop();
                }
            } else if (cmd === "*date" && tokens.length > 1) {
                // A *date seen after at least one leg has been recorded
                // against the current team means a NEW trip is
                // starting: clear the running team so the *team lines
                // that follow build the new crew from scratch instead
                // of appending onto the previous trip's (else e.g.
                // "Alice, Bob" + new-trip "Carol" would wrongly read
                // "Alice, Bob, Carol"). A file that declares *date once
                // and only then *team lines is unaffected -- teamDirty
                // is still false at that point.
                //
                // The gap this used to leave open (pitfall 41): the
                // heuristic fired only when a LEG sat between the two
                // *date lines, because a leg is what sets teamDirty.
                // "*date A / *team Alice / *date B / *team Bob / leg"
                // never saw teamDirty go true before the second *date,
                // so Bob's *team line appended onto Alice's and the
                // date-B trip came back crewed "Alice, Bob" -- a
                // person credited with a trip they were not on, which
                // is worse than a missing name.
                //
                // A CHANGE OF DATE now clears the crew on its own. That
                // is the real signal: two *date lines carrying the same
                // date are one trip whose *team lines must accumulate
                // (which is why the comparison is against the date
                // VALUE and not merely "a *date was seen"), and a
                // different date is a different trip whoever wrote it.
                // teamDirty is kept for the case it always covered --
                // the same date re-declared after legs -- since a file
                // may legitimately repeat a date to reopen a trip.
                // "*date surveyed 1987-07-11", ranges: keep the first date
                var dtok = (/^(surveyed|explored)$/i.test(tokens[1]) &&
                    tokens.length > 2) ? tokens[2] : tokens[1];
                var dm = /^(\d{4})[.-](\d{1,2})[.-](\d{1,2})/.exec(dtok);
                var newDate = null;
                if (dm !== null) {
                    newDate = dm[1] + "-" +
                        (dm[2].length < 2 ? "0" : "") + dm[2] + "-" +
                        (dm[3].length < 2 ? "0" : "") + dm[3];
                }
                if (teamDirty || (newDate !== null && curDate !== "" &&
                        newDate !== curDate)) {
                    curTeam = "";
                    survey.team = "";
                    teamDirty = false;
                }
                curDate = (newDate !== null) ? newDate :
                    dtok.replace(/\./g, "-");
                survey.date = curDate;
            } else if (cmd === "*team" && tokens.length > 1) {
                // '*team "Nick Proctor" compass clino' -- name, then roles
                var member = "";
                var qm = line.match(/"([^"]*)"/);
                if (qm !== null) {
                    member = qm[1];
                } else {
                    for (var mi = 1; mi < tokens.length; mi++) {
                        if (CsFormatSurvex.TEAM_ROLES
                                .hasOwnProperty(tokens[mi].toLowerCase())) {
                            break;
                        }
                        member += (member === "" ? "" : " ") + tokens[mi];
                    }
                }
                if (member !== "") {
                    // Appended onto the RUNNING team, not onto
                    // survey.team, which ensureTrips may have replaced
                    // with trip 0's since the last *team line.
                    curTeam = curTeam === "" ? member : curTeam + ", " + member;
                    survey.team = curTeam;
                }
            } else if (cmd === "*flags") {
                var negate = false;
                for (var fi = 1; fi < tokens.length; fi++) {
                    var ftok = tokens[fi].toLowerCase();
                    if (ftok === "not") {
                        negate = true;
                        continue;
                    }
                    if (flags.hasOwnProperty(ftok)) {
                        flags[ftok] = !negate;
                    }
                    negate = false;
                }
            } else if (cmd === "*data") {
                if (tokens.length === 1) {
                    dataStyle = "normal";
                } else if (tokens[1].toLowerCase() === "normal") {
                    dataStyle = "normal";
                    normalFields = [];
                    for (var nf = 2; nf < tokens.length; nf++) {
                        var fword = tokens[nf].toLowerCase();
                        if (CsFormatSurvex.FIELD_ALIASES.hasOwnProperty(fword)) {
                            fword = CsFormatSurvex.FIELD_ALIASES[fword];
                        }
                        normalFields.push(fword);
                    }
                } else if (tokens[1].toLowerCase() === "passage") {
                    dataStyle = "passage";
                    passageFields = [];
                    for (var pf = 2; pf < tokens.length; pf++) {
                        var pword = tokens[pf].toLowerCase();
                        if (CsFormatSurvex.FIELD_ALIASES.hasOwnProperty(pword)) {
                            pword = CsFormatSurvex.FIELD_ALIASES[pword];
                        }
                        passageFields.push(pword);
                    }
                } else {
                    dataStyle = "other";
                }
            } else if (cmd === "*units") {
                // *units <quantity list> [factor] <unit>
                var unitWord = tokens[tokens.length - 1].toLowerCase();
                var factor = 1.0;
                var qtyEnd = tokens.length - 1;
                if (qtyEnd > 1 && !isNaN(parseFloat(tokens[qtyEnd - 1])) &&
                    isFinite(tokens[qtyEnd - 1])) {
                    factor = parseFloat(tokens[qtyEnd - 1]);
                    qtyEnd--;
                }
                var qtys = {};
                for (var qi = 1; qi < qtyEnd; qi++) {
                    qtys[tokens[qi].toLowerCase()] = true;
                }
                if (qtys.length === 0) {
                    continue;
                }
                if (qtys["length"] || qtys["tape"]) {
                    if (unitWord.indexOf("feet") >= 0 || unitWord === "ft") {
                        lengthUnit = "ft";
                        lengthScale = factor;
                    } else if (unitWord.indexOf("yard") >= 0) {
                        lengthUnit = "m";
                        lengthScale = 0.9144 * factor;
                    } else {
                        lengthUnit = "m"; // metres/meters/metric
                        lengthScale = factor;
                    }
                }
                if (qtys["compass"] || qtys["bearing"]) {
                    compassInGrads = (unitWord.indexOf("grad") >= 0 ||
                        unitWord.indexOf("mil") >= 0);
                }
                if (qtys["clino"] || qtys["gradient"]) {
                    if (unitWord.indexOf("grad") >= 0 ||
                        unitWord.indexOf("mil") >= 0) {
                        clinoUnit = "grad";
                    } else if (unitWord.indexOf("percent") >= 0) {
                        clinoUnit = "percent";
                    } else {
                        clinoUnit = "deg";
                    }
                }
            } else if (cmd === "*calibrate") {
                // *calibrate declination X is a ZERO ERROR: Survex
                // computes (reading - X), so the model's east-positive
                // added declination is -X. (The old importer ADDED it:
                // every .svx relying on it imported rotated.)
                if (tokens.length >= 3 &&
                    tokens[1].toLowerCase() === "declination") {
                    var dv = parseFloat(tokens[2]);
                    if (!isNaN(dv)) {
                        declination = -dv;
                        survey.declination = -dv;
                        survey.declinationSource = "file";
                    }
                }
            } else if (cmd === "*declination") {
                // modern command, conventional sign: ADDED to readings
                if (tokens.length >= 2 &&
                    tokens[1].toLowerCase() !== "auto") {
                    var ddv = parseFloat(tokens[1]);
                    if (!isNaN(ddv)) {
                        declination = ddv;
                        survey.declination = ddv;
                        survey.declinationSource = "file";
                    }
                }
            } else if (cmd === "*fix") {
                var ft = 2;
                if (tokens.length > 2 &&
                    tokens[2].toLowerCase() === "reference") {
                    ft = 3;
                }
                if (tokens.length >= ft + 2) {
                    var fx = parseFloat(tokens[ft]);
                    var fy = parseFloat(tokens[ft + 1]);
                    var fz = tokens.length >= ft + 3 ?
                        parseFloat(tokens[ft + 2]) : 0.0;
                    if (!isNaN(fx) && !isNaN(fy)) {
                        survey.fixed[fullName(tokens[1])] = {
                            x: intoSurveyUnit(fx),
                            y: intoSurveyUnit(fy),
                            z: isNaN(fz) ? 0.0 : intoSurveyUnit(fz)
                        };
                    }
                }
            }
            // *equate, *export, *include, *entrance, *alias: ignored
            continue;
        }

        var fields = line.split(/\s+/);

        if (dataStyle === "normal") {
            var rec = {};
            for (var ni = 0; ni < normalFields.length && ni < fields.length; ni++) {
                rec[normalFields[ni]] = fields[ni];
            }
            if (!rec.hasOwnProperty("from") || !rec.hasOwnProperty("to") ||
                !rec.hasOwnProperty("tape")) {
                continue;
            }
            var tape = parseFloat(rec.tape);
            if (isNaN(tape)) {
                continue; // malformed / column-title line
            }

            // clino first: a plumbed leg legally omits the compass
            var clino = 0.0;
            var plumbed = false;
            if (rec.hasOwnProperty("clino")) {
                var kw = CsFormatSurvex.clinoKeyword(rec.clino);
                if (kw !== undefined) {
                    clino = kw;
                    plumbed = (kw !== 0.0);
                } else {
                    var cv = parseFloat(rec.clino);
                    clino = isNaN(cv) ? 0.0 : clinoToDegrees(cv);
                    plumbed = (Math.abs(clino) >= 89.999);
                }
            }

            var compass = rec.hasOwnProperty("compass") ?
                parseFloat(rec.compass) : NaN;
            var compassOmitted = false;
            if (isNaN(compass)) {
                // OMIT ("-") is legal on plumbed legs; anything else
                // with no bearing isn't a usable shot.
                //
                // REFUSING IT IS RIGHT AND SILENCE WAS NOT. Survex
                // itself rejects an omitted compass on anything short
                // of a true plumb, and so does this -- at 85 degrees a
                // 100 ft tape still swings 8.7 ft across the map, and
                // there is no honest direction to swing it in. But a
                // dropped leg leaves NO trace in the model: the
                // stations beyond it are simply unconnected, and a
                // vertical cave whose notes read "42.0  -  -87" for
                // every pitch loses its whole lower half to a `continue`
                // nobody can see. The leg is still refused; the refusal
                // is now something the user is told, with the line to
                // look at.
                if (!plumbed) {
                    CsModel.addParseFinding(survey, "warning",
                        "bearing-omitted-not-plumb",
                        "Line " + (li + 1) + ": leg " + rec.from + " to " +
                        rec.to + " has no compass reading and is not plumb " +
                        "(clino " + clino.toFixed(2) + "), so the leg was " +
                        "SKIPPED -- anything beyond it is now unconnected. " +
                        "A bearing may only be omitted on a plumbed shot; " +
                        "record the clino as 90 (or UP/DOWN) if it really " +
                        "was one.");
                    continue;
                }
                compass = 0.0;
                compassOmitted = true;
            } else {
                compass = compassToDegrees(compass);
            }

            var shot = CsModel.newShot();
            var anonTo = isAnonymous(rec.to);
            shot.splay = anonTo || flags.splay;
            shot.from = fullName(rec.from);
            shot.to = anonTo ? "" : fullName(rec.to);
            shot.distance = intoSurveyUnit(tape);
            shot.azimuthOmitted = compassOmitted;
            shot.azimuth = CsAngles.normalizeAzimuth(compass + declination);
            // provenance: the value in force at THIS leg. A bare
            // *declination change does not start a new trip, so this
            // is the only record of what a leg either side of one was
            // actually computed with (see CsModel's per-shot
            // declination note, and the trip comment below).
            shot.declination = declination;
            shot.inclination = clino;
            shot.excludeFromLength = flags.duplicate || flags.surface;
            shot.excludeFromPlot = flags.surface;

            if (rec.hasOwnProperty("backcompass")) {
                var bc = parseFloat(rec.backcompass);
                if (!isNaN(bc)) {
                    shot.backAzimuth = CsAngles.normalizeAzimuth(
                        compassToDegrees(bc) + declination);
                }
            }
            if (rec.hasOwnProperty("backclino")) {
                var bkw = CsFormatSurvex.clinoKeyword(rec.backclino);
                if (bkw !== undefined) {
                    shot.backInclination = bkw;
                } else {
                    var bcl = parseFloat(rec.backclino);
                    if (!isNaN(bcl)) {
                        shot.backInclination = clinoToDegrees(bcl);
                    }
                }
            }

            shot.notes = notes;

            // The trip in force where this leg appears -- date/team/
            // declination are tracked as running state above (not
            // scoped to *begin/*end), so the tuple currently on
            // survey.date/survey.team/declination IS what's "in
            // force" right here. tripIdFor dedupes legs that share a
            // fingerprint (date and team) into one trip; a bare
            // *declination change no longer starts one, so legs either
            // side of it merge -- losing nothing, because each leg
            // keeps both the true azimuth computed from the
            // declination it was read under and (above) that
            // declination itself.
            var legTrip = CsModel.newTrip();
            legTrip.date = curDate;
            legTrip.team = curTeam;
            legTrip.declination = declination;
            shot.trip = CsModel.tripIdFor(survey, legTrip);
            // A leg has now been recorded against the current team;
            // the next *date marks a trip boundary (see *date above).
            teamDirty = true;

            survey.shots.push(shot);
        } else if (dataStyle === "passage") {
            var prec = {};
            for (var pi = 0; pi < passageFields.length && pi < fields.length; pi++) {
                prec[passageFields[pi]] = fields[pi];
            }
            if (!prec.hasOwnProperty("station")) {
                continue;
            }
            var num = function(v) {
                if (v === undefined || v === "-") {
                    return null;
                }
                var n = parseFloat(v);
                return isNaN(n) ? null : intoSurveyUnit(n);
            };
            var pName = fullName(prec.station);
            passageLrud[pName] = {
                left: num(prec.left),
                right: num(prec.right),
                up: num(prec.up),
                down: num(prec.down)
            };
            passageOrder.push(pName);
        }
    }

    // Attach passage LRUD, keyed by TO station -- Survex stores LRUD
    // per station, so two shots ending at one station share a reading.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (!s2.splay && passageLrud.hasOwnProperty(s2.to)) {
            var pl = passageLrud[s2.to];
            s2.left = pl.left;
            s2.right = pl.right;
            s2.up = pl.up;
            s2.down = pl.down;
        }
    }
    // The very first station has no arriving shot to carry its LRUD --
    // that's exactly what survey.startLrud is for.
    if (survey.shots.length > 0 &&
        passageLrud.hasOwnProperty(survey.shots[0].from)) {
        var plFirst = passageLrud[survey.shots[0].from];
        survey.startLrud = {
            left: plFirst.left, right: plFirst.right,
            up: plFirst.up, down: plFirst.down
        };
        // survey.shots.length > 0 means at least one leg was already
        // parsed, so trips[0] already exists (built by that leg's
        // tripIdFor call) -- write the trip record directly, per
        // ensureTrips' WARNING, or the final ensureTrips call below
        // silently drops this on the floor.
        survey.trips[0].startLrud = survey.startLrud;
    }

    if (survey.distanceUnit === null) {
        survey.distanceUnit = lengthUnit;
    }
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * Writes a CsModel survey as a Survex .svx file.
 *
 * Only emits a *begin block when every station already shares that
 * prefix, so plain names round-trip un-renamed. name/units/*fix stay
 * survey-level (unchanged by trips); *date and *team are TRIP-level,
 * so they're emitted once per trip, right before that trip's own
 * legs, using that trip's own fields (CsModel.tripOf) -- a single-trip
 * survey (the common case, and every trip's date/team/declination
 * blank) still emits nothing extra, byte-identical to the old
 * single-block output. *declination follows the LEG, not the trip: it
 * is running state in Survex, and a leg records the declination it was
 * computed with (CsModel.appliedDeclination), so a trip holding two of
 * them declares both where they change. Bearings are written back as
 * the raw magnetic readings each leg was read as. Backsights are
 * emitted (and declination-stripped) when any shot carries them.
 * Splays become anonymous ".." stations -- a bare "-" is NOT legal
 * Survex without an *alias. Passage LRUD is per-station: the first
 * station's reading comes from survey.startLrud; when two shots into
 * one station disagree, the last non-null reading wins and a comment
 * records the conflict. Compass #|X# shots have no Survex
 * representation and are written as comments.
 */
CsFormatSurvex.write = function(survey) {
    CsModel.ensureTrips(survey);
    var out = [];
    // Prefer the drawing-level cave name (Compass import etc.) over
    // the trip name for this header comment.
    out.push("; " + (survey.caveName || survey.name || "Cave survey"));
    if (survey.distanceUnit === "ft") {
        out.push("*units length feet");
    }

    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            // See CsModel.fixedZ: an absent elevation is not a zero
            // one. Neither this format nor its own reader above can
            // express "unknown" (a two-token *fix reads back as 0.0),
            // so the file says so in a comment rather than passing 0.00
            // off as surveyed.
            var fz = CsModel.fixedZ(f);
            if (fz === null) {
                out.push("; " + ("elevation UNKNOWN for " + fname + " -- written as 0.00 to keep this file valid; it is NOT a surveyed datum"));
            }
            out.push("*fix " + fname + " " + f.x.toFixed(2) + " " +
                f.y.toFixed(2) + " " + (fz === null ? 0 : fz).toFixed(2));
        }
    }

    var i, s;
    var anyBack = false;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.backAzimuth !== null && s.backAzimuth !== undefined ||
            s.backInclination !== null && s.backInclination !== undefined) {
            anyBack = true;
            break;
        }
    }
    out.push("*data normal from to tape compass clino" +
        (anyBack ? " backcompass backclino" : ""));

    // Group shots by trip, in trip-index order, each trip's own shots
    // kept in their original relative order.
    var tripOrder = [];
    var byTrip = {};
    for (i = 0; i < survey.shots.length; i++) {
        var t = survey.shots[i].trip || 0;
        if (!byTrip.hasOwnProperty(t)) {
            byTrip[t] = [];
            tripOrder.push(t);
        }
        byTrip[t].push(survey.shots[i]);
    }
    tripOrder.sort(function(a, b) { return a - b; });

    // *flags runs: duplicate <- excludeFromLength, surface <- excludeFromPlot
    var cur = { duplicate: false, surface: false };
    var fmtNum = function(v) {
        return (v === null || v === undefined) ? "-" : v.toFixed(2);
    };
    // *declination isn't block-scoped in Survex -- it stays in force
    // until the next *declination/*calibrate -- so unlike the old
    // single-survey write (one file-wide value, skip when 0 because 0
    // IS the file's default), a LATER trip going back to 0 must say
    // so explicitly, or the reader would keep an earlier trip's
    // nonzero value in force across the boundary. Track what's
    // actually in force and only emit on a real change. Because it is
    // running state and not trip state, the emission belongs with the
    // LEG (below) rather than the trip header: a trip whose shots were
    // read under two declinations says so mid-trip, exactly as the
    // file that produced it did.
    var lastEmittedDecl = 0;
    for (var tOi = 0; tOi < tripOrder.length; tOi++) {
        var tripIdx = tripOrder[tOi];
        var trip = survey.trips[tripIdx];
        var tripShots = byTrip[tripIdx];

        if (trip.date) {
            out.push("*date " + trip.date);
        }
        if (trip.team) {
            var members = trip.team.split(",");
            for (var ti = 0; ti < members.length; ti++) {
                var name = members[ti].replace(/^\s+|\s+$/g, "");
                if (name !== "") {
                    out.push("*team \"" + name + "\"");
                }
            }
        }

        for (i = 0; i < tripShots.length; i++) {
            s = tripShots[i];
            if (s.excludeFromAll) {
                // no Survex flag means "ignore entirely" -- keep the
                // data visible to a human, but out of the survey
                out.push("; excluded shot: " + s.from + " " + (s.to || "-") +
                    " " + s.distance.toFixed(2) +
                    (s.notes ? " ; " + s.notes : ""));
                continue;
            }
            // the declination this leg was computed with -- its own,
            // or its trip's when it records none. Declared before the
            // leg whenever it differs from what is still in force, so
            // the reader re-applies the same value this line was
            // written by.
            var decl = CsModel.appliedDeclination(s, trip);
            if (decl !== lastEmittedDecl) {
                out.push("*declination " + decl.toFixed(2) + " degrees");
                lastEmittedDecl = decl;
            }
            var want = {
                duplicate: !!(s.excludeFromLength && !s.excludeFromPlot),
                surface: !!s.excludeFromPlot
            };
            if (want.duplicate !== cur.duplicate || want.surface !== cur.surface) {
                var parts = [];
                if (want.duplicate !== cur.duplicate) {
                    parts.push((want.duplicate ? "" : "not ") + "duplicate");
                }
                if (want.surface !== cur.surface) {
                    parts.push((want.surface ? "" : "not ") + "surface");
                }
                out.push("*flags " + parts.join(" "));
                cur = want;
            }
            // Survex expects raw compass readings; the model's
            // azimuths are true, so remove that leg's own applied
            // declination again.
            var az = CsAngles.normalizeAzimuth(s.azimuth - decl);
            var toName = s.splay ? (s.to !== "" ? s.to : "..") : s.to;
            // A LEG WITH NO BEARING SIGHTED GOES BACK OUT WITH NO
            // BEARING. Writing the model's stand-in 0 would turn "the
            // compass was not read" into "the compass read north" in
            // the file -- a claim the notes never made, and one that
            // the next read of that file could not tell from a real
            // due-north pitch. Survex's own "-" says exactly what
            // happened, and this reader puts the flag straight back.
            var azOut = s.azimuthOmitted ? "-" : az.toFixed(2);
            var lineOut = s.from + "\t" + toName + "\t" +
                s.distance.toFixed(2) + "\t" + azOut + "\t" +
                s.inclination.toFixed(2);
            if (anyBack) {
                var bAz = (s.backAzimuth === null || s.backAzimuth === undefined) ?
                    null : CsAngles.normalizeAzimuth(s.backAzimuth - decl);
                lineOut += "\t" + fmtNum(bAz) + "\t" + fmtNum(s.backInclination);
            }
            if (s.splay && s.to !== "") {
                // a NAMED splay needs the explicit flag
                out.push("*flags splay");
                out.push(lineOut + (s.notes ? "\t; " + s.notes : ""));
                out.push("*flags not splay");
                continue;
            }
            out.push(lineOut + (s.notes ? "\t; " + s.notes : ""));
        }
    }
    if (cur.duplicate || cur.surface) {
        var offs = [];
        if (cur.duplicate) {
            offs.push("not duplicate");
        }
        if (cur.surface) {
            offs.push("not surface");
        }
        out.push("*flags " + offs.join(" "));
    }

    // passage LRUD, one record per TO station with any reading; the
    // first station's reading comes from startLrud
    var lrudByStation = {};
    var lrudOrder = [];
    var conflicts = [];
    if (survey.startLrud !== null && survey.startLrud !== undefined &&
        survey.shots.length > 0) {
        var sl = survey.startLrud;
        if (sl.left !== null || sl.right !== null ||
            sl.up !== null || sl.down !== null) {
            lrudByStation[survey.shots[0].from] = {
                left: sl.left, right: sl.right, up: sl.up, down: sl.down
            };
            lrudOrder.push(survey.shots[0].from);
        }
    }
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (s.splay || s.excludeFromAll ||
            (s.left === null && s.right === null && s.up === null && s.down === null)) {
            continue;
        }
        if (lrudByStation.hasOwnProperty(s.to)) {
            var prev = lrudByStation[s.to];
            if (prev.left !== s.left || prev.right !== s.right ||
                prev.up !== s.up || prev.down !== s.down) {
                conflicts.push(s.to);
            }
        } else {
            lrudOrder.push(s.to);
        }
        lrudByStation[s.to] = { left: s.left, right: s.right, up: s.up, down: s.down };
    }
    if (lrudOrder.length > 0) {
        out.push("*data passage station left right up down");
        var fmt = function(v) {
            return v === null || v === undefined ? "-" : v.toFixed(2);
        };
        for (i = 0; i < lrudOrder.length; i++) {
            var pname = lrudOrder[i];
            var l = lrudByStation[pname];
            var lineP = pname + "\t" + fmt(l.left) + "\t" + fmt(l.right) +
                "\t" + fmt(l.up) + "\t" + fmt(l.down);
            if (conflicts.indexOf(pname) >= 0) {
                lineP += "\t; two shots into " + pname +
                    " disagreed; kept the later reading (Survex stores LRUD per station)";
            }
            out.push(lineP);
        }
    }

    return out.join("\n") + "\n";
};
