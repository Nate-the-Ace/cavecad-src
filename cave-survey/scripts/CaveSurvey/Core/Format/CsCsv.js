// Csv.js -- plain CSV reader and writer, for spreadsheet people.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// Column layout, mapped by the header row when present (so legacy and
// extended files both parse; the default is the legacy layout):
//
//   from,to,distance,azimuth,inclination,left,right,up,down,
//   backazimuth,backinclination,flags,notes
//
// Everything after inclination is optional, and notes is always the
// LAST column so embedded commas survive. Blank LRUD cells mean "not
// measured" (null); LRUD cells speak the notebook shorthand ("5/10"
// keeps both readings, "0" means the wall is at the station, "P"
// means open passage -- no wall that direction at all, NOT the same
// as "0" -- see CsModel.parseLrudEntry). Flags letters: X = exclude
// entirely, P = don't plot, L = exclude from length, C = don't adjust.
//
// CSV has no native survey header, so what the columns can't carry
// rides "#" comment lines, which older parsers already skipped:
//
//   # name: <cave>          # date: YYYY-MM-DD    # team: <text>
//   # declination: <deg>    # unit: ft|m          # fix: <name> x y z
//   # startlrud: l,r,u,d    # startnote: <text>
//
// "# unit:" matters most -- without it a meter survey re-imported
// from CSV silently became feet. Azimuths are stored TRUE; the
// declination line is a record, not a correction to apply -- so no
// shot here records one either, and a null Shot.declination already
// means "whatever my trip says", which is exactly what that line
// becomes (see CsModel's per-shot declination note).

var CsFormatCsv = {};

CsFormatCsv.DEFAULT_COLUMNS = ["from", "to", "distance", "azimuth",
    "inclination", "left", "right", "up", "down", "notes"];

CsFormatCsv.parse = function(content) {
    var survey = CsModel.newSurvey();
    var lines = content.split(/\r\n|\r|\n/);
    var columns = CsFormatCsv.DEFAULT_COLUMNS;
    var unitSeen = false;

    var trim = function(s) {
        return s === undefined ? "" : s.replace(/^\s+|\s+$/g, "");
    };

    for (var li = 0; li < lines.length; li++) {
        var line = trim(lines[li]);
        if (line.length === 0) {
            continue;
        }
        if (line.charAt(0) === "#") {
            var meta = /^#\s*([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
            if (meta !== null) {
                var key = meta[1].toLowerCase();
                var val = trim(meta[2]);
                if (key === "name") {
                    survey.name = val;
                } else if (key === "date") {
                    survey.date = val;
                } else if (key === "team") {
                    survey.team = val;
                } else if (key === "declination") {
                    var dv = parseFloat(val);
                    if (!isNaN(dv)) {
                        survey.declination = dv;
                        survey.declinationSource = "file";
                    }
                } else if (key === "unit") {
                    survey.distanceUnit = (val.toLowerCase().charAt(0) === "m") ?
                        "m" : "ft";
                    unitSeen = true;
                } else if (key === "fix") {
                    var ft = val.split(/\s+/);
                    if (ft.length >= 3) {
                        var fx = parseFloat(ft[1]);
                        var fy = parseFloat(ft[2]);
                        var fz = ft.length >= 4 ? parseFloat(ft[3]) : 0.0;
                        if (!isNaN(fx) && !isNaN(fy)) {
                            survey.fixed[ft[0]] = {
                                x: fx, y: fy, z: isNaN(fz) ? 0.0 : fz
                            };
                        }
                    }
                } else if (key === "startlrud") {
                    var sc = val.split(",");
                    var se = function(idx) {
                        return CsModel.parseLrudEntry(
                            sc.length > idx ? sc[idx] : "");
                    };
                    var seL = se(0), seR = se(1), seU = se(2), seD = se(3);
                    survey.startLrud = {
                        left: seL.value, right: seR.value,
                        up: seU.value, down: seD.value,
                        leftAll: seL.all, rightAll: seR.all,
                        upAll: seU.all, downAll: seD.all,
                        leftOpen: seL.open, rightOpen: seR.open,
                        upOpen: seU.open, downOpen: seD.open
                    };
                } else if (key === "startnote") {
                    survey.startNote = val;
                }
            }
            continue;
        }
        var cells = line.split(",");
        if (cells.length < 4) {
            continue;
        }

        // a header row maps the columns for everything below it
        if (isNaN(parseFloat(cells[2])) &&
            /^from$/i.test(trim(cells[0]))) {
            columns = [];
            for (var hi = 0; hi < cells.length; hi++) {
                columns.push(trim(cells[hi]).toLowerCase());
            }
            continue;
        }

        var rec = {};
        for (var ci = 0; ci < columns.length && ci < cells.length; ci++) {
            if (columns[ci] === "notes") {
                // notes is last: keep its embedded commas
                rec.notes = trim(cells.slice(ci).join(","));
                break;
            }
            rec[columns[ci]] = trim(cells[ci]);
        }

        var dist = parseFloat(rec.distance);
        if (isNaN(dist)) {
            continue; // junk row
        }
        var opt = function(v) {
            if (v === undefined || v === "") {
                return null;
            }
            var n = parseFloat(v);
            return isNaN(n) ? null : n;
        };
        var lrudCell = function(v) {
            return CsModel.parseLrudEntry(v === undefined ? "" : v);
        };

        var shot = CsModel.newShot();
        shot.from = rec.from || "";
        shot.to = rec.to || "";
        shot.splay = (shot.to === "" || shot.to === "-");
        if (shot.splay) {
            shot.to = "";
        }
        shot.distance = dist;
        var inc = opt(rec.inclination);
        shot.inclination = inc === null ? 0.0 : inc;
        // AN EMPTY AZIMUTH CELL IS NOT A BEARING OF ZERO. This read
        // `parseFloat(rec.azimuth) || 0.0`, so a blank column, a dash,
        // a stray word -- and, because `||` treats it as falsy, a
        // legitimate bearing of exactly 0 -- all came out as due
        // north. On a plumbed pitch that is harmless arithmetic (the
        // plan projection it multiplies is zero) and it is what a
        // vertical survey's notes actually look like, so it is
        // accepted and MARKED. On anything else it is a fabricated
        // direction that plots the leg, and the whole cave hanging off
        // it, somewhere nobody surveyed: the leg is refused and the
        // refusal is reported, the same rule the Survex reader keeps.
        var azRaw = (rec.azimuth === undefined || rec.azimuth === null) ?
            "" : String(rec.azimuth).replace(/^\s+|\s+$/g, "");
        var azNum = parseFloat(azRaw);
        if (azRaw === "" || isNaN(azNum)) {
            if (Math.abs(shot.inclination) >= CsTraverse.PLUMB_DEG) {
                shot.azimuth = 0.0;
                shot.azimuthOmitted = true;
            } else {
                CsModel.addParseFinding(survey, "warning",
                    "bearing-omitted-not-plumb",
                    "Leg " + (rec.from || "?") + " to " + (rec.to || "?") +
                    " has no azimuth and is not plumb (inclination " +
                    shot.inclination.toFixed(2) + "), so the leg was " +
                    "SKIPPED -- anything beyond it is now unconnected. " +
                    "A bearing may only be left out on a plumbed shot.");
                continue;
            }
        } else {
            shot.azimuth = CsAngles.normalizeAzimuth(azNum);
        }
        var eL = lrudCell(rec.left), eR = lrudCell(rec.right);
        var eU = lrudCell(rec.up), eD = lrudCell(rec.down);
        shot.left = eL.value; shot.leftAll = eL.all; shot.leftOpen = eL.open;
        shot.right = eR.value; shot.rightAll = eR.all; shot.rightOpen = eR.open;
        shot.up = eU.value; shot.upAll = eU.all; shot.upOpen = eU.open;
        shot.down = eD.value; shot.downAll = eD.all; shot.downOpen = eD.open;
        shot.backAzimuth = opt(rec.backazimuth);
        shot.backInclination = opt(rec.backinclination);
        if (rec.flags !== undefined) {
            var fl = rec.flags.toUpperCase();
            shot.excludeFromAll = fl.indexOf("X") >= 0;
            shot.excludeFromPlot = fl.indexOf("P") >= 0;
            shot.excludeFromLength = fl.indexOf("L") >= 0;
            shot.noAdjust = fl.indexOf("C") >= 0;
        }
        shot.notes = rec.notes || "";
        survey.shots.push(shot);
    }
    if (!unitSeen) {
        // legacy files carried no unit; the model default (ft) stands
        survey.distanceUnit = survey.distanceUnit || "ft";
    }
    // CSV has no per-row trip concept -- the whole file is one trip.
    // ensureTrips builds trips[0] from the top-level fields already
    // set above (via the "# ..." metadata comments) and stamps every
    // shot 0.
    CsModel.ensureTrips(survey);
    return survey;
};

CsFormatCsv.write = function(survey) {
    var out = [];
    var lrudText = function(v, all, open) {
        return CsModel.lrudEntryText(v, all, open);
    };
    // Prefer the drawing-level cave name (Compass import etc.) over
    // the trip name for this header comment.
    if (survey.caveName || survey.name) {
        out.push("# name: " + (survey.caveName || survey.name));
    }
    if (survey.date) {
        out.push("# date: " + survey.date);
    }
    if (survey.team) {
        out.push("# team: " + survey.team);
    }
    if (survey.declination) {
        out.push("# declination: " + survey.declination);
    }
    out.push("# unit: " + (survey.distanceUnit === "m" ? "m" : "ft"));
    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            // See CsModel.fixedZ -- an absent elevation is not a zero one.
            var fz = CsModel.fixedZ(f);
            if (fz === null) {
                out.push("# " + ("elevation UNKNOWN for " + fname + " -- written as 0.00 to keep this file valid; it is NOT a surveyed datum"));
            }
            out.push("# fix: " + fname + " " + f.x + " " + f.y + " " +
                (fz === null ? 0 : fz));
        }
    }
    if (survey.startLrud !== null && survey.startLrud !== undefined) {
        var sl = survey.startLrud;
        out.push("# startlrud: " +
            lrudText(sl.left, sl.leftAll, sl.leftOpen) + "," +
            lrudText(sl.right, sl.rightAll, sl.rightOpen) + "," +
            lrudText(sl.up, sl.upAll, sl.upOpen) + "," +
            lrudText(sl.down, sl.downAll, sl.downOpen));
    }
    if (survey.startNote) {
        out.push("# startnote: " + survey.startNote);
    }

    out.push("from,to,distance,azimuth,inclination,left,right,up,down," +
        "backazimuth,backinclination,flags,notes");
    var fmt = function(v) {
        return v === null || v === undefined ? "" : String(v);
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        var flags = (s.excludeFromAll ? "X" : "") +
            (s.excludeFromPlot ? "P" : "") +
            (s.excludeFromLength ? "L" : "") +
            (s.noAdjust ? "C" : "");
        // notes is the last column, so its commas are safe as-is
        out.push([s.from, s.splay ? "" : s.to, s.distance,
            // written back out EMPTY when no bearing was sighted, so
            // the file says what the notes said -- see the reader's
            // note above for why a 0 here would be a different claim
            s.azimuthOmitted ? "" : s.azimuth,
            s.inclination,
            lrudText(s.left, s.leftAll, s.leftOpen),
            lrudText(s.right, s.rightAll, s.rightOpen),
            lrudText(s.up, s.upAll, s.upOpen),
            lrudText(s.down, s.downAll, s.downOpen),
            fmt(s.backAzimuth), fmt(s.backInclination), flags,
            s.notes || ""].join(","));
    }
    return out.join("\n") + "\n";
};
