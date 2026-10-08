// Compass.js -- Compass .dat reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common, everyday core of the format, not the full
// specification. A format detail read wrong doesn't throw; it draws a
// plausible but WRONG map, so sanity-check the first import of any new
// file against a known plot.
//
// Supported: multiple surveys per file (\f separated), DECLINATION
// ("This number is added to the azimuth of each shot", east positive),
// the fixed data column order FROM TO LENGTH BEARING INC LEFT UP DOWN
// RIGHT [AZM2 INC2] [flags] [comment] (fixed by the file format; the
// FORMAT header's unit/order characters only document the original
// notebook -- but its trailing B and F/T characters are real: B
// declares the redundant-backsight columns, F/T the LRUD station
// association), negative LRUD as "not measured" (null, never 0),
// backsight columns Azm2/Inc2 ("always stored uncorrected", -999 =
// missing), shot flags #|X#, #|P#, #|L#, #|C#, #|S# (splay), and the
// trailing comment (legal with or without a flags field).
// Not supported: .MAK projects, multi-file projects, CORRECTIONS/
// CORRECTIONS2 instrument corrections (read past, virtually always 0).
//
// LRUD association: Compass' de-facto default is the FROM station, so
// a line's reading is attached to the shot ARRIVING at its FROM
// station, and the first station's reading lands in survey.startLrud.
// FORMAT ...T declares TO-station readings, which map straight onto
// the model's shots. Zero-length shots (the documented way to carry a
// leaf station's LRUD) are folded into the station reading instead of
// becoming shots.
//
// Compass stores decimal feet ALWAYS, whatever the notebook used.

var CsFormatCompass = {};

/** -999 marks a missing bearing/inclination in backsight columns. */
CsFormatCompass.isMissingReading = function(v) {
    return v === null || isNaN(v) || v <= -900;
};

CsFormatCompass.parse = function(content) {
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";

    var blocks = content.split(/\f/);
    var firstBlock = true;

    // raw shot records, station reference counts, per-station LRUD --
    // shared across every \f block, because a station can be shared
    // at a block boundary (a survey trip picks up where the previous
    // one left off, e.g. FingerprintCave's A6/M5).
    var raws = [];
    var stationRefs = {};
    var stationLrud = {};

    for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        if (block.replace(/\s/g, "").length === 0) {
            continue;
        }

        var declMatch = block.match(/DECLINATION:\s*(-?[0-9.]+)/i);
        var declination = declMatch ? parseFloat(declMatch[1]) : 0.0;

        var formatMatch = block.match(/FORMAT:\s*([A-Za-z]+)/);
        var formatStr = formatMatch ? formatMatch[1] : "";
        var lastChar = formatStr.charAt(formatStr.length - 1).toUpperCase();
        // de-facto default is From when the FORMAT doesn't say
        var lrudAssoc = (lastChar === "T") ? "T" : "F";
        var formatHasBacksights = /B/.test(formatStr.substring(8));

        var lines = block.split(/\r\n|\r|\n/);

        // Every block is its own trip, identified by SURVEY DATE and
        // SURVEY TEAM: CsModel.tripIdFor dedupes blocks sharing that
        // fingerprint into one trip instead of piling up duplicates.
        // Two blocks a DECLINATION apart but the same day and party
        // are one trip too -- the shots below keep the true azimuths
        // their own block's declination produced AND record that
        // declination, so the merge costs nothing (see
        // CsModel.absorbDeclination).
        var nameMatch = block.match(/SURVEY NAME:\s*(.*)/i);
        var blockName = nameMatch ?
            nameMatch[1].replace(/^\s+|\s+$/g, "") : "";
        var blockDate = "";
        var dateMatch = block.match(/SURVEY DATE:\s*(\d+)\s+(\d+)\s+(\d+)/i);
        if (dateMatch !== null) {
            var mo = parseInt(dateMatch[1], 10);
            var da = parseInt(dateMatch[2], 10);
            var yr = parseInt(dateMatch[3], 10);
            if (yr < 100) {
                yr += (yr > 50) ? 1900 : 2000;
            }
            blockDate = yr + "-" + (mo < 10 ? "0" : "") + mo + "-" +
                (da < 10 ? "0" : "") + da;
        }
        var blockTeam = "";
        var teamIdx = -1;
        for (var ti = 0; ti < lines.length; ti++) {
            if (/SURVEY TEAM:/i.test(lines[ti])) {
                teamIdx = ti;
                break;
            }
        }
        if (teamIdx >= 0 && teamIdx + 1 < lines.length) {
            blockTeam = lines[teamIdx + 1].replace(/^\s+|\s+$/g, "");
        }

        if (firstBlock) {
            firstBlock = false;
            // Line 1 of the file is the CAVE name (drawing-level,
            // e.g. "FINGERPRINT CAVE"), distinct from SURVEY NAME:
            // (the trip designation, e.g. "ENT") captured as blockName
            // below. Only the first block's line 1 counts -- later
            // blocks repeat it verbatim in real files.
            if (lines.length > 0) {
                survey.caveName = lines[0].replace(/^\s+|\s+$/g, "");
            }
            // Seed the top-level fields from the FIRST block BEFORE
            // tripIdFor runs below, so ensureTrips' auto-built trip 0
            // (from these same top-level fields) fingerprints equal to
            // this block's own trip record and gets reused instead of
            // duplicated -- see CsModel.ensureTrips' WARNING. Seeding
            // the declination too matters: without it trip 0 would
            // start at 0.0 and block 1 would report a merge that never
            // happened.
            survey.name = blockName;
            survey.date = blockDate;
            survey.team = blockTeam;
            survey.declination = declination;
            survey.declinationSource = declMatch ? "file" : "";
        }

        var blockTrip = CsModel.newTrip();
        blockTrip.name = blockName;
        blockTrip.date = blockDate;
        blockTrip.team = blockTeam;
        blockTrip.declination = declination;
        blockTrip.declinationSource = declMatch ? "file" : "";
        var tripId = CsModel.tripIdFor(survey, blockTrip);

        // Header lines can look numeric ("SURVEY DATE: 7 10 2024"), so
        // only lines after the DECLINATION marker are shot candidates.
        var declLineIdx = -1;
        for (var dli = 0; dli < lines.length; dli++) {
            if (/DECLINATION:/i.test(lines[dli])) {
                declLineIdx = dli;
                break;
            }
        }
        var scanStart = (declLineIdx >= 0) ? declLineIdx + 1 : 0;

        for (var li = scanStart; li < lines.length; li++) {
            var line = lines[li].replace(/^\s+|\s+$/g, "");
            if (line.length === 0) {
                continue;
            }
            var tokens = line.split(/\s+/);
            if (tokens.length < 9) {
                continue;
            }
            var length = parseFloat(tokens[2]);
            var bearing = parseFloat(tokens[3]);
            var inc = parseFloat(tokens[4]);
            if (isNaN(length) || isNaN(bearing) || isNaN(inc)) {
                continue; // header / column-title line
            }

            // negative LRUD = not measured -> null
            var lrudNum = function(tok) {
                var v = parseFloat(tok);
                return (isNaN(v) || v < 0) ? null : v;
            };

            // optional backsight columns follow the LRUDs: declared by
            // FORMAT ...B, or detected structurally (the spec's own
            // sample declares N yet carries the columns)
            var next = 9;
            var backAz = null, backInc = null;
            var t9 = tokens.length > 10 ? parseFloat(tokens[9]) : NaN;
            var t10 = tokens.length > 10 ? parseFloat(tokens[10]) : NaN;
            var haveBackCols = formatHasBacksights ||
                (!isNaN(t9) && !isNaN(t10) && isFinite(t9) && isFinite(t10));
            if (haveBackCols && tokens.length > 10 && !isNaN(t9) && !isNaN(t10)) {
                backAz = CsFormatCompass.isMissingReading(t9) ? null : t9;
                backInc = CsFormatCompass.isMissingReading(t10) ? null : t10;
                next = 11;
            }

            // flags field, then the comment (legal without flags too)
            var remainder = tokens.slice(next).join(" ");
            var flagMatch = remainder.match(/#\|([A-Za-z]*)#\s*/);
            var flags = "";
            var comment = remainder;
            if (flagMatch !== null) {
                flags = flagMatch[1].toUpperCase();
                comment = remainder.substring(
                    remainder.indexOf(flagMatch[0]) + flagMatch[0].length);
            }
            comment = comment.replace(/^\s+|\s+$/g, "");

            var raw = {
                from: tokens[0],
                to: tokens[1],
                distance: length,
                azimuth: CsAngles.normalizeAzimuth(bearing + declination),
                inclination: inc,
                backAzimuth: backAz === null ? null :
                    CsAngles.normalizeAzimuth(backAz + declination),
                backInclination: backInc,
                lrud: {
                    left: lrudNum(tokens[5]),
                    up: lrudNum(tokens[6]),
                    down: lrudNum(tokens[7]),
                    right: lrudNum(tokens[8])
                },
                flags: flags,
                notes: comment,
                lrudAssoc: lrudAssoc,
                tripId: tripId,
                // provenance: the value just added above. Two blocks
                // that merge into one trip each keep their own here,
                // so a revision un-applies what each shot was really
                // given (see CsModel's per-shot declination note).
                declination: declination
            };
            raws.push(raw);
            stationRefs[raw.from] = (stationRefs[raw.from] || 0) + 1;
            stationRefs[raw.to] = (stationRefs[raw.to] || 0) + 1;
        }
    }

    // Build shots. Zero-length lines whose TO station exists nowhere
    // else and that carry an LRUD are pure LRUD carriers, not shots.
    for (var ri = 0; ri < raws.length; ri++) {
        var r = raws[ri];
        var hasLrud = (r.lrud.left !== null || r.lrud.right !== null ||
            r.lrud.up !== null || r.lrud.down !== null);
        var isCarrier = (r.distance === 0.0 && hasLrud &&
            stationRefs[r.to] === 1 && r.flags.indexOf("S") < 0);
        if (r.lrudAssoc === "F" && hasLrud) {
            stationLrud[r.from] = r.lrud; // last reading wins
        }
        if (isCarrier) {
            continue;
        }

        var shot = CsModel.newShot();
        shot.from = r.from;
        shot.splay = r.flags.indexOf("S") >= 0;
        shot.to = shot.splay ? "" : r.to;
        shot.distance = r.distance;
        shot.azimuth = r.azimuth;
        shot.inclination = r.inclination;
        shot.backAzimuth = r.backAzimuth;
        shot.backInclination = r.backInclination;
        if (r.lrudAssoc === "T" && !shot.splay) {
            shot.left = r.lrud.left;
            shot.up = r.lrud.up;
            shot.down = r.lrud.down;
            shot.right = r.lrud.right;
        }
        shot.excludeFromAll = r.flags.indexOf("X") >= 0;
        shot.excludeFromPlot = r.flags.indexOf("P") >= 0;
        shot.excludeFromLength = r.flags.indexOf("L") >= 0;
        shot.noAdjust = r.flags.indexOf("C") >= 0;
        shot.notes = r.notes;
        shot.trip = r.tripId;
        shot.declination = r.declination;
        survey.shots.push(shot);
    }

    // From-station readings: attach to the shot arriving at the
    // station; the very first station's reading is startLrud.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (!s2.splay && s2.left === null && s2.right === null &&
            s2.up === null && s2.down === null &&
            stationLrud.hasOwnProperty(s2.to)) {
            var sl = stationLrud[s2.to];
            s2.left = sl.left;
            s2.up = sl.up;
            s2.down = sl.down;
            s2.right = sl.right;
        }
    }
    if (survey.shots.length > 0 &&
        stationLrud.hasOwnProperty(survey.shots[0].from)) {
        var slF = stationLrud[survey.shots[0].from];
        survey.startLrud = { left: slF.left, right: slF.right,
            up: slF.up, down: slF.down };
        // trips[0] already exists by now (the first block's tripIdFor
        // call built it) -- write the trip record directly, per
        // ensureTrips' WARNING, or the mirror call below silently
        // drops this on the floor.
        survey.trips[0].startLrud = survey.startLrud;
    }

    // Mirror trips[0] back onto the top-level fields (see ensureTrips'
    // WARNING) -- everything else was already seeded from it above.
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * Writes a CsModel survey as a Compass .dat file: one \f-delimited
 * block per (TRIP, applied DECLINATION) group of shots (see CsModel's
 * Trip shape), each with its own SURVEY NAME/DATE/TEAM/DECLINATION
 * header. Trips with no shots write nothing (Compass has no way to
 * represent an empty block). A trip normally has one declination and
 * so one block; a trip that merged two blocks a declination apart
 * writes the two back out, which is how it came in.
 *
 * Distances are converted to feet, Compass's only storage unit, and
 * azimuths are written back as MAGNETIC by removing the declination
 * that was APPLIED to that shot (CsModel.appliedDeclination: its own,
 * or its trip's when it records none) -- the same value declared in
 * its block's header, which is what Compass expects.
 * Backsight columns (Azm2/Inc2, uncorrected, -999 when missing)
 * appear in every block when ANY shot anywhere carries a backsight
 * (one FORMAT ...B decision for the whole file, matching the reader's
 * own per-file/per-block detection), declared by FORMAT ...B.
 *
 * LRUDs are written in Compass' native FROM-station association
 * (FORMAT ...F): each line carries the reading of its FROM station,
 * the first line the startLrud, and a leaf station's reading rides a
 * zero-length carrier shot (the documented Compass idiom), which the
 * parser folds back into the station. That station bookkeeping is
 * computed ONCE across every trip's shots together (not per block),
 * because a station can be shared across a trip boundary (e.g.
 * FingerprintCave's A6 and M5) exactly as the parser accumulates it;
 * any reading still unemitted once every block is written rides a
 * carrier in the LAST block, mirroring the single-block behavior this
 * replaces.
 */
CsFormatCompass.write = function(survey) {
    CsModel.ensureTrips(survey);

    var toFt = function(v) {
        return CsUnits.convert(v, survey.distanceUnit, "ft");
    };
    var num = function(v, width) {
        var s = v.toFixed(2);
        while (s.length < width) {
            s = " " + s;
        }
        return s;
    };
    var pad = function(s, width) {
        s = String(s);
        while (s.length < width) {
            s = s + " ";
        }
        return s;
    };

    var i, s;
    var anyBack = false;
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if ((s.backAzimuth !== null && s.backAzimuth !== undefined) ||
            (s.backInclination !== null && s.backInclination !== undefined)) {
            anyBack = true;
            break;
        }
    }

    // FROM-station readings: first station <- startLrud, station X <-
    // the model's reading at X (LRUD lives on the shot arriving at X).
    // Computed across the WHOLE survey, before splitting into blocks.
    var stationLrud = {};
    if (survey.shots.length > 0 && survey.startLrud !== null &&
        survey.startLrud !== undefined) {
        stationLrud[survey.shots[0].from] = survey.startLrud;
    }
    for (i = 0; i < survey.shots.length; i++) {
        s = survey.shots[i];
        if (!s.splay && s.to !== "" &&
            (s.left !== null || s.right !== null ||
             s.up !== null || s.down !== null)) {
            stationLrud[s.to] = { left: s.left, right: s.right,
                up: s.up, down: s.down };
        }
    }
    var lrudEmitted = {};

    var lr = function(v) {
        return v === null || v === undefined ? -9.90 : toFt(v);
    };
    var splaySeq = 0;

    var shotLine = function(from, to, distFt, magAz, inc, lrud,
                            backAz, backInc, flags, notes) {
        var lineOut = pad(from, 12) + " " + pad(to, 12) +
            num(distFt, 7) + " " + num(magAz, 8) + " " +
            num(inc, 8) + " " + num(lr(lrud.left), 8) + " " +
            num(lr(lrud.up), 8) + " " + num(lr(lrud.down), 8) + " " +
            num(lr(lrud.right), 8);
        if (anyBack) {
            lineOut += " " + num(backAz === null ? -999 : backAz, 8) +
                " " + num(backInc === null ? -999 : backInc, 8);
        }
        if (flags !== "") {
            lineOut += " #|" + flags + "#";
        }
        if (notes) {
            lineOut += " " + notes;
        }
        return lineOut;
    };

    // Group shots by trip (in trip-index order), skipping any trip
    // nothing uses -- and WITHIN a trip by the declination actually
    // applied to each shot. A block declares exactly one DECLINATION,
    // so a trip whose shots were read under two of them (two blocks
    // one date and team apart, merged by tripIdFor) has to go back out
    // as two blocks: un-applying one group with the other's value
    // would corrupt its true azimuths on the next read. A shot with no
    // recorded declination falls back to its trip's, so the ordinary
    // trip still yields exactly one group and one block.
    var tripBlocks = [];
    for (var t = 0; t < survey.trips.length; t++) {
        var groups = [];        // {decl, shots}, first-appearance order
        for (i = 0; i < survey.shots.length; i++) {
            if ((survey.shots[i].trip || 0) !== t) {
                continue;
            }
            var sDecl = CsModel.appliedDeclination(survey.shots[i],
                survey.trips[t]);
            var g = null;
            for (var gi = 0; gi < groups.length; gi++) {
                // same 4-decimal granularity absorbDeclination
                // compares declinations at
                if (Math.abs(groups[gi].decl - sDecl) < 5e-5) {
                    g = groups[gi];
                    break;
                }
            }
            if (g === null) {
                g = { decl: sDecl, shots: [] };
                groups.push(g);
            }
            g.shots.push(survey.shots[i]);
        }
        for (gi = 0; gi < groups.length; gi++) {
            tripBlocks.push({ trip: survey.trips[t], decl: groups[gi].decl,
                shots: groups[gi].shots });
        }
    }
    if (tripBlocks.length === 0) {
        // no shots anywhere -- still write trip 0's empty header block
        tripBlocks.push({ trip: survey.trips[0],
            decl: survey.trips[0].declination || 0, shots: [] });
    }

    var out = [];
    for (var bi = 0; bi < tripBlocks.length; bi++) {
        var block = tripBlocks[bi];
        var trip = block.trip;
        // the group's own applied declination, not the trip record's:
        // it is what this block's shots must be un-applied by
        var decl = block.decl;

        var dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trip.date || "");
        var dateLine = dateParts ?
            (parseInt(dateParts[2], 10) + " " + parseInt(dateParts[3], 10) + " " +
                dateParts[1]) : "1 1 1900";

        // Line 1 is the drawing-level cave name, NOT the trip name --
        // every block repeats it (real Compass files do too). SURVEY
        // NAME: below is the actual per-trip designation.
        out.push(survey.caveName || survey.name || "CAVE");
        out.push("SURVEY NAME: " + (trip.name || "1"));
        out.push("SURVEY DATE: " + dateLine + "  COMMENT:");
        out.push("SURVEY TEAM:");
        out.push(trip.team || "");
        out.push("DECLINATION: " + decl.toFixed(2) +
            "  FORMAT: DDDDLRUD" + (anyBack ? "LADadB" : "LADN") + "F" +
            "  CORRECTIONS: 0.00 0.00 0.00");
        out.push("");
        out.push("FROM         TO           LENGTH  BEARING      INC     LEFT       UP     DOWN    RIGHT" +
            (anyBack ? "     AZM2     INC2" : ""));
        out.push("");

        for (i = 0; i < block.shots.length; i++) {
            s = block.shots[i];
            var magnetic = CsAngles.normalizeAzimuth(s.azimuth - decl);
            var backAz = (s.backAzimuth === null || s.backAzimuth === undefined) ?
                null : CsAngles.normalizeAzimuth(s.backAzimuth - decl);
            var backInc = (s.backInclination === null ||
                s.backInclination === undefined) ? null : s.backInclination;

            // flag letters, at most three (the field's cap)
            var flags = "";
            if (s.excludeFromAll) {
                flags += "X";
            }
            if (s.splay) {
                flags += "S";
            }
            if (s.excludeFromPlot) {
                flags += "P";
            }
            if (s.excludeFromLength) {
                flags += "L";
            }
            if (s.noAdjust) {
                flags += "C";
            }
            flags = flags.substring(0, 3);

            var fromLrud = stationLrud.hasOwnProperty(s.from) ?
                stationLrud[s.from] :
                { left: null, right: null, up: null, down: null };
            if (stationLrud.hasOwnProperty(s.from)) {
                lrudEmitted[s.from] = true;
            }
            var toName = s.to;
            if (s.splay && toName === "") {
                splaySeq++;
                toName = s.from + ".s" + splaySeq;
            }

            out.push(shotLine(s.from, toName, toFt(s.distance), magnetic,
                s.inclination, fromLrud, backAz, backInc, flags, s.notes));
        }

        // leaf stations still holding a reading: zero-length carriers,
        // held until the LAST block once every shot has had its turn
        if (bi === tripBlocks.length - 1) {
            for (var st in stationLrud) {
                if (stationLrud.hasOwnProperty(st) && !lrudEmitted[st]) {
                    out.push(shotLine(st, st + "_L", 0.0, 0.0, 0.0,
                        stationLrud[st], null, null, "", "LRUD carrier"));
                }
            }
        }

        out.push("\f");
    }

    return out.join("\r\n");
};
