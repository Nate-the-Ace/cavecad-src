// Walls.js -- Walls .srv reader and writer.
//
// Part of the Cave Survey Core library: pure functions producing and
// consuming the CsModel survey shape.
//
// SCOPE -- the common core, not the full specification (see
// Compass.js for why that matters). Supported: #Units (Meters/Feet,
// Order=, Decl=, LRUD=F/T/FB/TB with optional :order, TypeAB=/TypeVB=
// corrected/normal), #Prefix/#Prefix2/#Prefix3, #Fix, #Date, #[ ... #]
// exclusion blocks (shots kept, excludeFromAll set), inline #S/#Seg
// with the manual's suggested P (don't plot) and L (length-exclude)
// letter conventions, inline LRUD in <...> or *...* brackets with
// comma or space delimiters, "--" as "not measured" (null), an
// optional 5th facing-azimuth value (read past), station-only LRUD
// lines, FS/BS backsight pairs ("100/282", "/-16") in the azimuth and
// inclination columns (TypeAB/TypeVB=C corrected pairs are reversed
// back into the model's uncorrected convention), per-value unit
// suffixes (3m, 10f, 6i), quadrant bearings (N30E), ; comments, splay
// shots ("-" or "--" as FROM or TO; FROM-side splays are reversed so
// they anchor at the named station). Not supported: dive/RECT data,
// variance overrides (read past), #Note/#Flag directives, LRUD
// generated from splays, Save/Restore of #Units state.
//
// Walls distances default to METERS ("The initial default in each
// case is meters"), not feet. The model keeps ONE distance unit for
// the whole survey: the unit in force at the first measured value
// wins, and later #Units changes convert into it.
//
// LRUD association: Walls' default is the FROM station ("The default
// assumption is LRUD=F:LRUD"), while the model stores LRUD at the TO
// station of the arriving shot. Under LRUD=F (and FB) a line's
// reading is therefore attached to the shot ARRIVING at its FROM
// station, and the first station's reading lands in survey.startLrud.
// The writer declares LRUD=T so what it emits needs no shift.

var CsFormatWalls = {};

/** True for Walls' missing-value marker: two or more minus signs. */
CsFormatWalls.isMissing = function(tok) {
    return /^-{2,}$/.test(tok);
};

CsFormatWalls.parse = function(content) {
    var survey = CsModel.newSurvey();
    var lines = content.split(/\r\n|\r|\n/);

    var order = ["D", "A", "V"];
    var unit = "m";       // Walls' initial default is meters
    var declination = 0.0;
    var prefixes = ["", "", ""]; // levels 1..3
    var lrudAssoc = "F";  // Walls' default: FROM station
    var typeabCorrected = false;
    var typevbCorrected = false;
    var excludeDepth = 0; // inside #[ ... #] blocks
    survey.distanceUnit = null; // set by the first measured thing

    // reading -> survey unit, honouring a per-value m/f/i suffix
    var valueToSurvey = function(tok) {
        var t = String(tok);
        var vUnit = unit;
        var scale = 1.0;
        var sm = /^([-0-9.]+)([MmFfIi])$/.exec(t);
        if (sm !== null) {
            t = sm[1];
            var su = sm[2].toLowerCase();
            if (su === "m") {
                vUnit = "m";
            } else if (su === "f") {
                vUnit = "ft";
            } else { // inches
                vUnit = "ft";
                scale = 1.0 / 12.0;
            }
        }
        var v = parseFloat(t);
        if (isNaN(v)) {
            return NaN;
        }
        if (survey.distanceUnit === null) {
            survey.distanceUnit = unit;
        }
        return CsUnits.convert(v * scale, vUnit, survey.distanceUnit);
    };

    var applyPrefix = function(name) {
        if (name === "" || /^-+$/.test(name)) {
            return name;
        }
        if (name.indexOf(":") >= 0) {
            return name; // explicitly qualified
        }
        var pfx = "";
        for (var pi = 2; pi >= 0; pi--) {
            if (prefixes[pi] !== "") {
                pfx = pfx === "" ? prefixes[pi] : (pfx + ":" + prefixes[pi]);
            }
        }
        return pfx === "" ? name : (pfx + ":" + name);
    };

    // "100/282" -> {front, back}; parts may be empty or "--" (missing)
    var parseAnglePair = function(tok) {
        var parts = String(tok).split("/");
        var one = function(p) {
            if (p === undefined || p === "" || CsFormatWalls.isMissing(p)) {
                return null;
            }
            var quad = CsAngles.parseQuadrant(p);
            if (quad !== undefined) {
                return quad;
            }
            var v = parseFloat(p);
            return isNaN(v) ? null : v;
        };
        return { front: one(parts[0]), back: parts.length > 1 ? one(parts[1]) : null };
    };

    // LRUD readings for stations, filled at the FROM station under
    // LRUD=F and attached to arriving shots afterwards
    var stationLrud = {};   // station -> {left,right,up,down,fromSplay}
    var recordStationLrud = function(station, lrud, fromSplay) {
        if (lrud === null) {
            return;
        }
        var prev = stationLrud[station];
        if (prev !== undefined && fromSplay && !prev.fromSplay) {
            return; // a real shot's reading beats a splay line's
        }
        stationLrud[station] = { left: lrud.left, right: lrud.right,
            up: lrud.up, down: lrud.down, fromSplay: !!fromSplay };
    };

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].replace(/^\s+|\s+$/g, "");
        if (line.length === 0) {
            continue;
        }

        if (line.charAt(0) === "#") {
            // block comment fences first
            if (/^#\[/.test(line)) {
                excludeDepth++;
                continue;
            }
            if (/^#\]/.test(line)) {
                if (excludeDepth > 0) {
                    excludeDepth--;
                }
                continue;
            }
            var directiveTokens = line.split(/\s+/);
            var directive = directiveTokens[0].toLowerCase();

            if (directive === "#units") {
                for (var t = 1; t < directiveTokens.length; t++) {
                    var tok = directiveTokens[t];
                    if (/^(feet|f)$/i.test(tok)) {
                        unit = "ft";
                    } else if (/^(meters|metres|m)$/i.test(tok)) {
                        unit = "m";
                    } else if (/^[ds]=/i.test(tok)) {
                        var duv = tok.split("=")[1].toLowerCase();
                        unit = /^f/.test(duv) ? "ft" : "m";
                    } else if (/^(order|o)=/i.test(tok)) {
                        order = tok.split("=")[1].toUpperCase().split("");
                    } else if (/^decl(ination)?=/i.test(tok)) {
                        declination = parseFloat(tok.split("=")[1]) || 0.0;
                        if (survey.declinationSource === "") {
                            survey.declination = declination;
                            survey.declinationSource = "file";
                        }
                    } else if (/^lrud=/i.test(tok)) {
                        var la = tok.split("=")[1].split(":")[0].toUpperCase();
                        lrudAssoc = (la.charAt(0) === "T") ? "T" : "F";
                    } else if (/^typeab=/i.test(tok)) {
                        typeabCorrected =
                            /^c/i.test(tok.split("=")[1] || "");
                    } else if (/^typevb=/i.test(tok)) {
                        typevbCorrected =
                            /^c/i.test(tok.split("=")[1] || "");
                    } else if (/^prefix\d?=/i.test(tok)) {
                        var plvl = /^prefix(\d)/i.exec(tok);
                        var pidx = plvl && plvl[1] ? parseInt(plvl[1], 10) - 1 : 0;
                        if (pidx >= 0 && pidx < 3) {
                            prefixes[pidx] = tok.split("=")[1] || "";
                        }
                    }
                }
            } else if (/^#prefix([123])?$/.test(directive)) {
                var lvlM = /^#prefix([123])?$/.exec(directive);
                var lvl = lvlM[1] ? parseInt(lvlM[1], 10) - 1 : 0;
                prefixes[lvl] = directiveTokens.length > 1 ?
                    directiveTokens[1] : "";
            } else if (directive === "#fix") {
                if (directiveTokens.length >= 4) {
                    var fx = valueToSurvey(directiveTokens[2]);
                    var fy = valueToSurvey(directiveTokens[3]);
                    var fz = directiveTokens.length >= 5 ?
                        valueToSurvey(directiveTokens[4]) : 0.0;
                    if (!isNaN(fx) && !isNaN(fy)) {
                        survey.fixed[applyPrefix(directiveTokens[1])] = {
                            x: fx, y: fy, z: isNaN(fz) ? 0.0 : fz
                        };
                    }
                }
            } else if (directive === "#date" && directiveTokens.length > 1) {
                survey.date = directiveTokens[1];
            }
            continue;
        }

        // inline segment override at the line's end: "#S P" etc. Only
        // short P/L/X letter combos are treated as flag conventions.
        var excludePlot = false, excludeLength = false, excludeAll = false;
        var segMatch = line.match(/#s(?:eg(?:ment)?)?\s+(\S+)\s*$/i);
        if (segMatch !== null) {
            if (/^[PLXplx]{1,3}$/.test(segMatch[1])) {
                var segU = segMatch[1].toUpperCase();
                excludePlot = segU.indexOf("P") >= 0;
                excludeLength = segU.indexOf("L") >= 0;
                excludeAll = segU.indexOf("X") >= 0;
            }
            line = line.substring(0, line.length - segMatch[0].length);
        }

        // LRUD block (never legitimately contains ';'), then comments.
        // Brackets are <...> or *...*; delimiters comma or spaces; an
        // optional 5th value is a facing azimuth and a trailing C is an
        // SVG flag -- both read past.
        var lrudMatch = line.match(/<([^>]*)>|\*([^*]*)\*/);
        var lrud = null;
        var workLine = line;
        if (lrudMatch !== null) {
            var inner = lrudMatch[1] !== undefined ? lrudMatch[1] : lrudMatch[2];
            var parts = inner.split(/[\s,]+/);
            var vals = [null, null, null, null];
            for (var p = 0; p < 4 && p < parts.length; p++) {
                var pv = parts[p].replace(/^\s+|\s+$/g, "");
                if (pv === "" || CsFormatWalls.isMissing(pv)) {
                    vals[p] = null;
                } else {
                    var pf = valueToSurvey(pv);
                    vals[p] = isNaN(pf) ? null : pf;
                }
            }
            lrud = { left: vals[0], right: vals[1], up: vals[2], down: vals[3] };
            workLine = workLine.replace(lrudMatch[0], " ");
        }
        var notes = "";
        var semiIdx = workLine.indexOf(";");
        if (semiIdx >= 0) {
            notes = workLine.substring(semiIdx + 1).replace(/^\s+|\s+$/g, "");
            workLine = workLine.substring(0, semiIdx);
        }

        var fields = workLine.replace(/^\s+|\s+$/g, "").split(/\s+/);
        if (fields.length === 0 || fields[0] === "") {
            continue;
        }

        // station-only LRUD line: "A1 <2,3,5,0>"
        if (fields.length === 1 && lrud !== null) {
            recordStationLrud(applyPrefix(fields[0]), lrud, false);
            continue;
        }
        if (fields.length < 2) {
            continue;
        }

        var fromDash = /^-+$/.test(fields[0]);
        var toDash = /^-+$/.test(fields[1]);
        var shot = CsModel.newShot();
        shot.splay = fromDash || toDash;
        shot.notes = notes;

        var measured = fields.slice(2);
        var azPair = null, incPair = null;
        for (var oi = 0; oi < order.length && oi < measured.length; oi++) {
            var field = order[oi];
            if (field === "D") {
                var dv = CsFormatWalls.isMissing(measured[oi]) ?
                    NaN : valueToSurvey(measured[oi]);
                if (!isNaN(dv)) {
                    shot.distance = dv;
                }
            } else if (field === "A") {
                azPair = parseAnglePair(measured[oi]);
            } else if (field === "V") {
                incPair = parseAnglePair(measured[oi]);
            }
        }

        // FS/BS resolution -- the model keeps the backsight
        // UNREVERSED; corrected pairs (TypeAB/VB=C) read in the
        // foresight sense and are reversed back.
        var az = 0.0, backAz = null;
        if (azPair !== null) {
            backAz = azPair.back;
            if (backAz !== null && typeabCorrected) {
                backAz = CsAngles.normalizeAzimuth(backAz + 180.0);
            }
            if (azPair.front !== null) {
                az = azPair.front;
            } else if (backAz !== null) {
                az = CsAngles.normalizeAzimuth(backAz + 180.0);
            }
        }
        var inc = 0.0, backInc = null;
        if (incPair !== null) {
            backInc = incPair.back;
            if (backInc !== null && typevbCorrected) {
                backInc = -backInc;
            }
            if (incPair.front !== null) {
                inc = incPair.front;
            } else if (backInc !== null) {
                inc = -backInc;
            }
        }

        if (fromDash) {
            // "- A1 0.5 45": a wall point INTO the named station --
            // anchor at the station and reverse the direction
            shot.from = applyPrefix(fields[1]);
            shot.to = "";
            az = CsAngles.normalizeAzimuth(az + 180.0);
            inc = -inc;
            if (backAz !== null) {
                backAz = CsAngles.normalizeAzimuth(backAz + 180.0);
            }
            if (backInc !== null) {
                backInc = -backInc;
            }
        } else {
            shot.from = applyPrefix(fields[0]);
            shot.to = toDash ? "" : applyPrefix(fields[1]);
        }

        shot.azimuth = CsAngles.normalizeAzimuth(az + declination);
        shot.backAzimuth = backAz === null ? null :
            CsAngles.normalizeAzimuth(backAz + declination);
        // provenance: the Decl= in force here (see CsModel's per-shot
        // declination note). Walls has one file-wide value, so this is
        // normally uniform -- recorded all the same, so a survey that
        // came from elsewhere and passed through here is no different
        // from one that never did.
        shot.declination = declination;
        shot.inclination = inc;
        shot.backInclination = backInc;
        shot.excludeFromPlot = excludePlot;
        shot.excludeFromLength = excludeLength;
        shot.excludeFromAll = excludeAll || excludeDepth > 0;

        if (lrud !== null) {
            if (lrudAssoc === "T" && !shot.splay) {
                shot.left = lrud.left;
                shot.right = lrud.right;
                shot.up = lrud.up;
                shot.down = lrud.down;
            } else {
                // LRUD=F: the reading describes the FROM station
                recordStationLrud(shot.from, lrud, shot.splay);
            }
        }

        survey.shots.push(shot);
    }

    // Attach the per-station readings to the arriving shots; the very
    // first station has no arriving shot, so its reading is startLrud.
    for (var si = 0; si < survey.shots.length; si++) {
        var s2 = survey.shots[si];
        if (!s2.splay && s2.left === null && s2.right === null &&
            s2.up === null && s2.down === null &&
            stationLrud.hasOwnProperty(s2.to)) {
            var sl = stationLrud[s2.to];
            s2.left = sl.left;
            s2.right = sl.right;
            s2.up = sl.up;
            s2.down = sl.down;
        }
    }
    if (survey.shots.length > 0 &&
        stationLrud.hasOwnProperty(survey.shots[0].from)) {
        var slF = stationLrud[survey.shots[0].from];
        survey.startLrud = { left: slF.left, right: slF.right,
            up: slF.up, down: slF.down };
    }

    if (survey.distanceUnit === null) {
        survey.distanceUnit = unit;
    }
    // Walls has no per-block trip concept the way Compass does -- the
    // whole file is one trip. ensureTrips builds trips[0] from the
    // top-level fields already set above and stamps every shot 0.
    CsModel.ensureTrips(survey);
    return survey;
};

/**
 * Writes a CsModel survey as a Walls .srv file. LRUD=T is declared so
 * the model's TO-station readings need no shift; startLrud becomes a
 * station-only line before the first shot. Backsights are written as
 * FS/BS pairs under the default TypeAB/TypeVB=N (uncorrected)
 * convention; exclude flags use the manual's suggested #S letter
 * conventions and #[ ... #] blocks.
 */
CsFormatWalls.write = function(survey) {
    CsModel.ensureTrips(survey);
    var out = [];
    var decl = survey.declination || 0;
    var unitWord = survey.distanceUnit === "ft" ? "Feet" : "Meters";
    // Prefer the drawing-level cave name (Compass import etc.) over
    // the trip name for this header comment.
    out.push("; " + (survey.caveName || survey.name || "Cave survey"));
    if (survey.date) {
        out.push("#Date " + survey.date);
    }
    out.push("#Units " + unitWord + " Order=DAV LRUD=T" +
        (decl ? " Decl=" + decl.toFixed(2) : ""));

    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            var f = survey.fixed[fname];
            // See CsModel.fixedZ -- an absent elevation is not a zero
            // one, and this format cannot say "unknown" either.
            var fz = CsModel.fixedZ(f);
            if (fz === null) {
                out.push("; " + ("elevation UNKNOWN for " + fname + " -- written as 0.00 to keep this file valid; it is NOT a surveyed datum"));
            }
            out.push("#Fix " + fname + " " + f.x.toFixed(2) + " " +
                f.y.toFixed(2) + " " + (fz === null ? 0 : fz).toFixed(2));
        }
    }

    var fmt = function(v) {
        return v === null || v === undefined ? "--" : v.toFixed(2);
    };
    var lrudBlock = function(l, r, u, d) {
        return "<" + fmt(l) + "," + fmt(r) + "," + fmt(u) + "," + fmt(d) + ">";
    };

    if (survey.startLrud !== null && survey.startLrud !== undefined &&
        survey.shots.length > 0) {
        var sl = survey.startLrud;
        if (sl.left !== null || sl.right !== null ||
            sl.up !== null || sl.down !== null) {
            out.push(survey.shots[0].from + "\t" +
                lrudBlock(sl.left, sl.right, sl.up, sl.down));
        }
    }

    var inExclude = false;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll && !inExclude) {
            out.push("#[ excluded shots");
            inExclude = true;
        } else if (!s.excludeFromAll && inExclude) {
            out.push("#]");
            inExclude = false;
        }
        // Walls has exactly ONE file-wide Decl= (declared from `decl`
        // above, i.e. trip 0's) -- there is no per-trip, let alone
        // per-shot, declination in the format. On reparse every shot
        // gets that single header value added back in (see the
        // `az + declination` reapply in parse() above), so a survey
        // with several applied declinations collapses onto one no
        // matter what we do here. Un-applying with the SHOT's OWN
        // applied declination would only be correct where it equals
        // the header's; anywhere else it leaves a residual of
        // (headerDecl - shotDecl) baked into the written number, which
        // reparse then adds AGAIN, corrupting that shot's TRUE azimuth
        // by (headerDecl - shotDecl) x2. Un-applying uniformly with
        // `decl` (the header's own value) is what keeps TRUE azimuths
        // lossless through the round trip -- it is the exact inverse
        // of what parse() re-applies, even though it is "wrong" per
        // shot for any shot whose own applied declination differs.
        // What the format costs is the PROVENANCE, not the geometry:
        // every shot comes back declaring the header's value. Compass
        // and Survex can express the difference and do.
        var az = CsAngles.normalizeAzimuth(s.azimuth - decl);
        var azTok = az.toFixed(2);
        if (s.backAzimuth !== null && s.backAzimuth !== undefined) {
            azTok += "/" + CsAngles.normalizeAzimuth(
                s.backAzimuth - decl).toFixed(2);
        }
        var incTok = s.inclination.toFixed(2);
        if (s.backInclination !== null && s.backInclination !== undefined) {
            incTok += "/" + s.backInclination.toFixed(2);
        }
        var lineOut = s.from + "\t" + (s.splay ? "-" : s.to) + "\t" +
            s.distance.toFixed(2) + "\t" + azTok + "\t" + incTok;
        if (s.left !== null || s.right !== null || s.up !== null || s.down !== null) {
            lineOut += "\t" + lrudBlock(s.left, s.right, s.up, s.down);
        }
        var seg = (s.excludeFromPlot ? "P" : "") +
            (s.excludeFromLength ? "L" : "");
        if (seg !== "") {
            lineOut += "\t#S " + seg;
        }
        if (s.notes) {
            lineOut += "\t; " + s.notes;
        }
        out.push(lineOut);
    }
    if (inExclude) {
        out.push("#]");
    }
    return out.join("\n") + "\n";
};
