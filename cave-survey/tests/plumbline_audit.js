// plumbline_audit.js -- run testdata/PlumblinePit against the CURRENT
// engine and report, pitfall by pitfall, whether its documented
// expectation still holds.
//
//   node tests/plumbline_audit.js
//   node tests/plumbline_audit.js --verbose
//
// The vertical twin of tests/pitfall_audit.js, same three outcomes and
// same contract:
//
//   GUARDED   the expectation was checked and held
//   FAILED    the expectation was checked and did NOT hold -- either a
//             regression, or the manifest is now wrong; both need a
//             human
//   MANUAL    cannot be decided from the fixture files and the pure
//             engine alone, with the reason. A MANUAL entry is not a
//             pass.
//
// WHY IT IS SEPARATE FROM THE PITFALL AUDIT. The two fixtures answer
// different questions and fail for different reasons. Pitfall Cave is
// 2400 ft of horizontal passage carrying the parser, validator and
// network traps; Plumbline Pit is 380 ft of air carrying the traps that
// only a pitch can spring. Merging them would hide which kind of cave
// broke.

var fs = require("fs");
var path = require("path");
var repoRoot = path.resolve(__dirname, "..");
var VERBOSE = process.argv.indexOf("--verbose") >= 0;

function loadCore(rel) {
    var src = fs.readFileSync(repoRoot + "/scripts/CaveSurvey/Core/" + rel,
        "utf8").replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid.js", "CsUnits.js", "CsAngles.js", "CsModel.js", "CsTraverse.js",
 "CsNetwork.js", "CsAdjust.js", "CsLrud.js", "CsPitch.js", "CsProfile.js",
 "CsProject.js", "CsChunk.js",
 "CsValidate.js",
 "CsStats.js", "CsGrade.js", "Format/CsCompass.js", "Format/CsWalls.js",
 "Format/CsSurvex.js", "Format/CsCsv.js", "Format/CsTherion.js",
 "Format/CsRegistry.js"].forEach(loadCore);

function read(name) {
    return fs.readFileSync(repoRoot + "/testdata/" + name, "utf8");
}

var svx = CsFormatSurvex.parse(read("PlumblinePit.svx"));
var dat = CsFormatCompass.parse(read("PlumblinePit.dat"));
var csv = CsFormatCsv.parse(read("PlumblinePit.csv"));
var vertical = CsFormatSurvex.parse(read("PlumblinePit_Vertical.svx"));

var resolved = CsNetwork.resolve(svx, {});
var findings = CsValidate.check(svx, resolved);
var stats = CsStats.compute(svx, resolved, CsTraverse.SLOPE);
var axes = CsLrud.stationAxes(resolved);

function codes(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        seen[list[i].code] = (seen[list[i].code] || 0) + 1;
    }
    return seen;
}
var svxCodes = codes(findings);

function shotBetween(survey, from, to) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.from === from && s.to === to) { return s; }
    }
    return null;
}

function flagsLeg(list, survey, code, from, to) {
    for (var i = 0; i < list.length; i++) {
        if (list[i].code !== code) { continue; }
        var s = (list[i].shotIndex >= 0) ? survey.shots[list[i].shotIndex] : null;
        if (s === null) { continue; }
        if ((s.from === from && s.to === to) ||
                (s.from === to && s.to === from)) {
            return true;
        }
    }
    return false;
}

function planExtent(res) {
    var minX = null, maxX = null, minY = null, maxY = null;
    for (var n in res.stations) {
        if (!res.stations.hasOwnProperty(n)) { continue; }
        var s = res.stations[n];
        if (minX === null || s.x < minX) { minX = s.x; }
        if (maxX === null || s.x > maxX) { maxX = s.x; }
        if (minY === null || s.y < minY) { minY = s.y; }
        if (maxY === null || s.y > maxY) { maxY = s.y; }
    }
    return { width: maxX - minX, height: maxY - minY };
}
var extent = planExtent(resolved);

var results = [];
function check(n, title, fn) {
    var detail = "";
    var status;
    try {
        var got = fn();
        if (got === "manual" || (got && got.manual)) {
            status = "MANUAL";
            detail = got.manual || "";
        } else if (got === true || (got && got.ok === true)) {
            status = "GUARDED";
            detail = (got && got.detail) || "";
        } else {
            status = "FAILED";
            detail = (got && got.detail) || String(got);
        }
    } catch (e) {
        status = "FAILED";
        detail = "threw: " + e;
    }
    results.push({ n: n, title: title, status: status, detail: detail });
}

// ---- V1-V2: the shape of the cave -----------------------------------

check(1, "the 1742 ft datum survives the read", function() {
    var fx = svx.fixed["A1"];
    if (!fx) { return { detail: "no *fix for A1" }; }
    var z = CsModel.fixedZ(fx);
    if (z === null || Math.abs(z - 1742.0) > 0.01) {
        return { detail: "A1 fixed z is " + z + ", expected 1742.00" };
    }
    var st = resolved.stations["A1"];
    if (!st || Math.abs(st.z - 1742.0) > 0.05) {
        return { detail: "A1 resolved to " + (st ? st.z : "(missing)") +
            " -- the datum was rebased" };
    }
    var floor = resolved.stations["C11"];
    if (!floor || floor.z > 1400) {
        return { detail: "the floor of the cave is at " +
            (floor ? floor.z : "(missing)") + ", which is not 380 ft down " +
            "from 1742" };
    }
    return { ok: true, detail: "entrance " + st.z.toFixed(2) +
        ", floor " + floor.z.toFixed(2) };
});

check(2, "the cave is deeper than it is wide", function() {
    var across = Math.max(extent.width, extent.height);
    if (!(stats.depth > across * 2.0)) {
        return { detail: "depth " + stats.depth.toFixed(1) +
            " vs plan extent " + across.toFixed(1) + " -- not the aspect " +
            "ratio this fixture exists to carry" };
    }
    return { ok: true, detail: stats.depth.toFixed(1) + " ft deep, " +
        across.toFixed(1) + " ft across (" +
        (stats.depth / across).toFixed(2) + "x)" };
});

// ---- V3-V4: a pitch has no bearing ----------------------------------

check(3, "a bearing omitted in the file stays omitted", function() {
    var want = [["A3", "A4"], ["A4", "A5"], ["C4", "C5"], ["C8", "C9"],
                ["C9", "C10"]];
    for (var i = 0; i < want.length; i++) {
        var s = shotBetween(svx, want[i][0], want[i][1]);
        if (s === null) {
            return { detail: "no leg " + want[i][0] + "-" + want[i][1] };
        }
        if (s.azimuthOmitted !== true) {
            return { detail: want[i][0] + "-" + want[i][1] +
                " came back with a bearing of " + s.azimuth +
                " -- the omission was read as a reading" };
        }
    }
    var raw = read("PlumblinePit.svx");
    if (raw.indexOf("\t-\t-90.00") < 0) {
        return { detail: "the .svx no longer writes a dash in the compass " +
            "column: a file that gained a bearing it never had" };
    }
    return { ok: true, detail: want.length + " pitches, no bearing on any" };
});

check(4, "a plumb leg contributes NO plan bearing", function() {
    var a = resolved.stations["A4"], b = resolved.stations["A5"];
    if (!a || !b) { return { detail: "A4 or A5 unplaced" }; }
    var bearing = CsLrud.planBearing(a, b);
    if (bearing !== null) {
        return { detail: "a 125 ft free-fall reported a plan bearing of " +
            bearing.toFixed(6) + " -- cos(90) dust divided by itself" };
    }
    return { ok: true };
});

// ---- V5-V7: what a pitch does to the walls --------------------------

check(5, "the foot of a pitch is not a junction", function() {
    if (CsLrud.isJunction(axes, "A5")) {
        return { detail: "A5 (foot of P1) reads as a junction: the rope " +
            "is being counted as a way out" };
    }
    if (CsLrud.isJunction(axes, "C10")) {
        return { detail: "C10 (floor of P3) reads as a junction" };
    }
    var c10 = axes["C10"];
    if (!c10 || c10.dirs.length !== 1) {
        return { detail: "C10 has " + (c10 ? c10.dirs.length : "no") +
            " ways out; the sump passage is the only one" };
    }
    return { ok: true, detail: "C10 has exactly 1 way out" };
});

check(6, "LRUD at a pit foot swings off the passage, never off north",
    function() {
        var lrud = CsModel.lrudForStation(svx, "A5");
        if (lrud === null) { return { detail: "A5 has no LRUD at all" }; }
        if (lrud.azimuth !== null) {
            return { detail: "A5's LRUD carries a bearing of " +
                lrud.azimuth + " -- taken from the compass column of a " +
                "plumb, which is a formality, not a sight" };
        }
        var az = CsLrud.passageAzimuthAt(axes, "A5", null);
        if (az === null || !isFinite(az)) {
            return { detail: "no passage direction at A5 either, so its " +
                "walls cannot be drawn at all" };
        }
        var pts = CsLrud.stationWallPoints(resolved.stations["A5"], az,
            lrud, null, "L");
        if (pts.length !== 1) {
            return { detail: "A5's left wall point vanished (" +
                pts.length + " points)" };
        }
        // 18 ft left of a passage running az -- perpendicular, not north
        var st = resolved.stations["A5"];
        var d = Math.sqrt((pts[0].x - st.x) * (pts[0].x - st.x) +
            (pts[0].y - st.y) * (pts[0].y - st.y));
        if (Math.abs(d - 18.0) > 0.01) {
            return { detail: "the left tick is " + d.toFixed(2) +
                " ft long, not the 18.0 ft measured" };
        }
        return { ok: true, detail: "18 ft, perpendicular to the onward " +
            "passage at " + az.toFixed(1) + " deg" };
    });

check(7, "UP written \"P\" at a pit foot is OPEN, not unmeasured",
    function() {
        // READ FROM THE CSV, NOT THE .SVX. Survex has no way to say
        // "looked at, found open" -- its passage records carry a
        // number or a dash, and a dash means not measured. So the
        // open flags do not survive a .svx round trip, the same
        // documented loss as excludeFromAll in Pitfall Cave. The CSV
        // writer does carry them, and that is where this expectation
        // is checked. See the manifest's known-losses section.
        var s = shotBetween(csv, "A4", "A5");
        if (s === null) { return { detail: "no leg A4-A5" }; }
        if (s.upOpen !== true) {
            return { detail: "the P on UP did not survive the CSV round " +
                "trip either -- the pit foot's ceiling went from OPEN to " +
                "UNMEASURED, which are different claims" };
        }
        var lost = shotBetween(svx, "A4", "A5");
        if (lost !== null && lost.upOpen === true) {
            return { manual: "the .svx round trip now KEEPS the open " +
                "flag, which it could not before. Either Survex grew a " +
                "representation for it or this suite invented one; both " +
                "need a human, and the manifest's known-losses section " +
                "needs rewriting." };
        }
        if (s.up !== null) {
            return { detail: "UP has both a number (" + s.up +
                ") and the open flag; a side is never both" };
        }
        if (!CsLrud.hasPlanEvidence({ left: s.left, right: s.right,
                leftOpen: false, rightOpen: false })) {
            return { detail: "the station lost its plan evidence" };
        }
        return { ok: true, detail: "open in the CSV; lost in the .svx, " +
            "which cannot say it (documented)" };
    });

// ---- V8-V10: the near-plumb line, avens, backsights ------------------

check(8, "the near-plumb line is straddled and both sides agree",
    function() {
        var warned = flagsLeg(findings, svx, "near-plumb", "C1", "C2");
        var quiet = !flagsLeg(findings, svx, "near-plumb", "C2", "C3");
        if (!warned) {
            return { detail: "C1-C2 at -85.00 did NOT warn; the boundary " +
                "angle fell outside the check" };
        }
        if (!quiet) {
            return { detail: "C2-C3 at -84.50 warned; the threshold moved" };
        }
        var c1c2 = shotBetween(svx, "C1", "C2");
        var c2c3 = shotBetween(svx, "C2", "C3");
        if (!CsTraverse.isPlumb(c1c2) || CsTraverse.isPlumb(c2c3)) {
            return { detail: "the GEOMETRY disagrees with the WARNING " +
                "about which of the two is a pitch -- the exact drift " +
                "CsTraverse.PLUMB_DEG exists to stop" };
        }
        return { ok: true, detail: "-85.00 in, -84.50 out, warning and " +
            "geometry agreeing" };
    });

check(9, "an AVEN is a pitch going up", function() {
    var s = shotBetween(svx, "C4", "C5");
    if (s === null) { return { detail: "no leg C4-C5" }; }
    if (Math.abs(s.inclination - 90) > 0.01) {
        return { detail: "C4-C5 read as " + s.inclination + ", not +90" };
    }
    if (!CsTraverse.isPlumb(s)) {
        return { detail: "a +90 leg is not being counted as a pitch -- " +
            "sign is deciding, and it must not" };
    }
    var top = resolved.stations["C5"], foot = resolved.stations["C4"];
    if (!(top.z - foot.z > 19.9)) {
        return { detail: "C5 is only " + (top.z - foot.z).toFixed(2) +
            " ft above C4; a 20 ft aven went the wrong way" };
    }
    return { ok: true, detail: "+20.0 ft" };
});

check(10, "a plumb's backsight of +90 does not cancel its -90", function() {
    var s = shotBetween(svx, "A4", "A5");
    if (s === null) { return { detail: "no leg A4-A5" }; }
    if (s.backInclination !== 90) {
        return { detail: "the backsight came back as " + s.backInclination };
    }
    var eff = CsTraverse.effectiveInclination(s);
    if (Math.abs(eff + 90) > 0.01) {
        return { detail: "foresight -90 and backsight +90 averaged to " +
            eff + " -- the sign convention is inverted, and a 125 ft " +
            "drop became level" };
    }
    return { ok: true, detail: "effective -90.00" };
});

// ---- V11-V13: geometry a horizontal cave never makes -----------------

check(11, "two stations on one plan point, 125 ft apart", function() {
    var a = resolved.stations["A4"], b = resolved.stations["A5"];
    var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    if (d > 0.001) {
        return { detail: "A4 and A5 are " + d.toFixed(4) + " ft apart in " +
            "plan; the free-fall between them is not vertical any more" };
    }
    if (Math.abs(a.z - b.z) < 120) {
        return { detail: "...and only " + Math.abs(a.z - b.z).toFixed(1) +
            " ft apart vertically" };
    }
    return { ok: true, detail: d.toFixed(6) + " ft apart in plan, " +
        Math.abs(a.z - b.z).toFixed(1) + " ft in elevation" };
});

check(12, "a loop enclosing almost no plan area still adjusts", function() {
    if (resolved.loops.length !== 1) {
        return { detail: resolved.loops.length + " loops, expected 1" };
    }
    var loop = resolved.loops[0];
    if (loop.percent >= CsValidate.CLOSURE_WARN_PERCENT) {
        return { detail: "the Bell Hole loop closes at " +
            loop.percent.toFixed(2) + "%, over the warning" };
    }
    var adjusted = CsAdjust.resolveAndAdjust(svx, {},
        { enabled: true, sigmaTape: 0.1, sigmaAngle: 1.5 });
    if (adjusted === null || adjusted === undefined) {
        return { detail: "the adjustment returned nothing on a loop with " +
            "no plan area -- the near-degenerate case" };
    }
    if (adjusted.loops.length !== resolved.loops.length) {
        return { detail: "the adjustment lost the loop" };
    }
    for (var n in adjusted.stations) {
        if (!adjusted.stations.hasOwnProperty(n)) { continue; }
        var st = adjusted.stations[n];
        if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.z)) {
            return { detail: "station " + n + " came back non-finite: the " +
                "normal matrix went singular on a loop that is almost a " +
                "line" };
        }
    }
    return { ok: true, detail: loop.percent.toFixed(2) + "% over " +
        loop.traverseLength.toFixed(0) + " ft" };
});

check(13, "a GPS fix on a second entrance is a TIE, not a loop", function() {
    if (resolved.ties.length !== 1) {
        return { detail: resolved.ties.length + " ties, expected 1" };
    }
    var tie = resolved.ties[0];
    if (!(tie.vertical > tie.horizontal * 3.0)) {
        return { detail: "the tie's misclosure is h " +
            tie.horizontal.toFixed(2) + " / v " + tie.vertical.toFixed(2) +
            " -- it is supposed to be nearly all vertical, which is what " +
            "a handheld GPS does" };
    }
    for (var i = 0; i < resolved.loops.length; i++) {
        if (resolved.loops[i].path.indexOf("B1") >= 0) {
            return { detail: "B1 was ALSO classified as a loop" };
        }
    }
    return { ok: true, detail: "h " + tie.horizontal.toFixed(2) + " / v " +
        tie.vertical.toFixed(2) };
});

// ---- V14-V17: evidence that is missing, or is only depth -------------

check(14, "a pitch lip with no LRUD invents none", function() {
    var lrud = CsModel.lrudForStation(svx, "C8");
    if (lrud !== null) {
        return { detail: "C8 came back with LRUD " + JSON.stringify(lrud) +
            "; nothing was measured there" };
    }
    return { ok: true, detail: "no width, and none invented" };
});

check(15, "sounding the drop is a splay with nothing but depth", function() {
    var found = null;
    for (var i = 0; i < svx.shots.length; i++) {
        var s = svx.shots[i];
        if (s.splay && s.from === "C8" && Math.abs(s.inclination + 90) < 0.01) {
            found = s;
        }
    }
    if (found === null) {
        return { detail: "the sounding splay from C8 is gone" };
    }
    if (Math.abs(found.distance - 91.0) > 0.01) {
        return { detail: "it reads " + found.distance + " ft, not 91.0" };
    }
    if (CsProfile.classifySplay(found) !== "floor") {
        return { detail: "a splay straight down classifies as " +
            CsProfile.classifySplay(found) + ", not floor" };
    }
    return { ok: true, detail: "91 ft, classified floor" };
});

check(16, "the first station's walls come from startLrud", function() {
    if (svx.startLrud === null || svx.startLrud === undefined) {
        return { detail: "startLrud did not survive the round trip, so " +
            "the sinkhole rim has no width -- no shot arrives at A1" };
    }
    if (svx.startLrud.left !== 8.0 || svx.startLrud.right !== 9.0) {
        return { detail: "startLrud came back as " +
            JSON.stringify(svx.startLrud) };
    }
    return { ok: true, detail: "L8 R9 at A1" };
});

check(17, "a spur off a plumb run ties in by name", function() {
    if (CsProfile.runKeyOf("C9a1") !== "C9a") {
        return { detail: "C9a1 grouped into run " +
            CsProfile.runKeyOf("C9a1") + ", expected C9a" };
    }
    if (CsProfile.tieNameOfRun("C9a") !== "C9") {
        return { detail: "run C9a ties at " + CsProfile.tieNameOfRun("C9a") +
            ", expected C9 -- a ledge traverse hanging off a rebelay " +
            "halfway down a 92 ft pitch" };
    }
    var st = resolved.stations["C9a1"];
    if (!st) { return { detail: "C9a1 was never placed" }; }
    return { ok: true, detail: "C9a1 -> run C9a -> ties at C9" };
});

// ---- V18: where a pit cave still hurts -------------------------------

check(18, "a run that is all pitch collapses the extended elevation",
    function() {
        var profile = CsProfile.build(svx, resolved, {});
        if (profile === null || !profile.bands) {
            return { detail: "the profile did not build at all" };
        }
        var c = null;
        for (var i = 0; i < profile.bands.length; i++) {
            if (profile.bands[i].key === "C") { c = profile.bands[i]; }
        }
        if (c === null) { return { detail: "no band C" }; }
        // The pitch legs inside band C advance X by their PLAN distance,
        // which for a plumb is zero. Consecutive stations therefore land
        // on the same X.
        var stacked = 0;
        for (i = 1; i < c.stations.length; i++) {
            if (Math.abs(c.stations[i].x - c.stations[i - 1].x) < 0.01 &&
                    Math.abs(c.stations[i].y - c.stations[i - 1].y) > 1.0) {
                stacked++;
            }
        }
        if (stacked === 0) {
            return { manual: "no two stations in band C share an X any " +
                "more. Either the X axis stopped advancing by plan " +
                "distance (a deliberate change, and this entry should be " +
                "rewritten to match it) or the fixture's pitches stopped " +
                "being vertical. Both need a human." };
        }
        return { ok: true, detail: stacked + " station pair(s) stacked on " +
            "one X in band C -- correct for the rope, and the reason a " +
            "label placer and a band frame need to know about it" };
    });

// ---- V19-V20: splays and flags --------------------------------------

check(19, "steep splays in a bell chamber reach both views", function() {
    var steep = 0, ceiling = 0;
    for (var i = 0; i < svx.shots.length; i++) {
        var s = svx.shots[i];
        if (!s.splay || s.from !== "A5") { continue; }
        if (s.inclination > 30) { steep++; }
        if (CsProfile.classifySplay(s) === "ceiling") { ceiling++; }
    }
    if (steep < 5) {
        return { detail: "only " + steep + " steep splays at A5" };
    }
    if (ceiling < 5) {
        return { detail: steep + " splays over 30 degrees but only " +
            ceiling + " classified as ceiling" };
    }
    // ...and the PLAN has no steepness filter, so they are wall hits too
    var pts = CsLrud.stationWallPoints(resolved.stations["A5"],
        CsLrud.passageAzimuthAt(axes, "A5", null),
        CsModel.lrudForStation(svx, "A5"),
        CsLrud.splaysByStation(svx)["A5"], "L");
    if (pts.length < 2) {
        return { detail: "the plan dropped the bell chamber's splays (" +
            pts.length + " left-wall points)" };
    }
    return { ok: true, detail: steep + " steep, " + ceiling +
        " ceiling in profile, " + pts.length + " left-wall points in plan" };
});

check(20, "the surface leg is out of the length and out of the plot",
    function() {
        var s = shotBetween(svx, "B1", "B1DIG");
        if (s === null) { return { detail: "no leg B1-B1DIG" }; }
        if (!s.excludeFromPlot) {
            return { detail: "the surface flag did not survive" };
        }
        if (CsStats.countsForLength(s)) {
            return { detail: "a surface leg is counting toward the cave's " +
                "LENGTH" };
        }
        return { ok: true };
    });

// ---- V21-V22: the hand-written file ---------------------------------

check(21, "a bearing omitted where it may not be is refused AND reported",
    function() {
        var pf = CsModel.parseFindings(vertical);
        var seen = false;
        for (var i = 0; i < pf.length; i++) {
            if (pf[i].code === "bearing-omitted-not-plumb") { seen = true; }
        }
        if (!seen) {
            return { detail: "the -86.5 leg with no bearing produced no " +
                "parse finding. Either it is being accepted (a bearing " +
                "invented for 2.7 ft of unmeasured plan offset) or it is " +
                "being dropped in silence again, which is how a cave ends " +
                "for no stated reason" };
        }
        if (shotBetween(vertical, "V6", "V7") !== null) {
            return { detail: "...and the leg itself was kept" };
        }
        var vres = CsNetwork.resolve(vertical, {});
        var vcodes = codes(CsValidate.check(vertical, vres));
        if ((vcodes["unconnected"] || 0) === 0) {
            return { detail: "V7 onward should be unconnected and is not" };
        }
        return { ok: true, detail: "refused, reported, and the orphan " +
            "beyond it reported too" };
    });

check(22, "plumb keywords are plumbs, and carry no bearing", function() {
    var want = [["V2", "V3", -90], ["V3", "V4", -90], ["V4", "V5", 90]];
    for (var i = 0; i < want.length; i++) {
        var s = shotBetween(vertical, want[i][0], want[i][1]);
        if (s === null) {
            return { detail: "no leg " + want[i][0] + "-" + want[i][1] };
        }
        if (Math.abs(s.inclination - want[i][2]) > 0.01) {
            return { detail: want[i][0] + "-" + want[i][1] + " read as " +
                s.inclination + ", expected " + want[i][2] +
                " -- a keyword flattened to level" };
        }
        if (s.azimuthOmitted !== true) {
            return { detail: want[i][0] + "-" + want[i][1] +
                " gained a bearing it never had" };
        }
    }
    return { ok: true, detail: "DOWN, -V and UP" };
});

// ---- MORE CHECKS GO ABOVE THIS LINE ---------------------------------

results.sort(function(a, b) { return a.n - b.n; });

var TOTAL = 22;
var counts = { GUARDED: 0, FAILED: 0, MANUAL: 0 };
var lines = [];
for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    counts[r.status]++;
    if (r.status !== "GUARDED" || VERBOSE) {
        lines.push("  " + r.status + "  V" + r.n + ". " + r.title +
            (r.detail ? "\n        " + r.detail : ""));
    }
}

console.log("PLUMBLINE PIT AUDIT -- " + results.length + " of " +
    TOTAL + " checked");
console.log("  guarded " + counts.GUARDED +
    "   failed " + counts.FAILED +
    "   manual " + counts.MANUAL);
if (lines.length > 0) {
    console.log("");
    console.log(lines.join("\n"));
}
var missing = [];
for (var mi = 1; mi <= TOTAL; mi++) {
    var seen = false;
    for (ri = 0; ri < results.length; ri++) {
        if (results[ri].n === mi) { seen = true; break; }
    }
    if (!seen) { missing.push("V" + mi); }
}
if (missing.length > 0) {
    console.log("\n  NOT YET AUDITED: " + missing.join(", "));
}
console.log(counts.FAILED === 0 ?
    "\n### PLUMBLINE AUDIT OK" : "\n### PLUMBLINE AUDIT FAIL " + counts.FAILED);
process.exit(counts.FAILED === 0 ? 0 : 1);
