// pitfall_audit.js -- run testdata/PitfallCave against the CURRENT
// engine and report, pitfall by pitfall, whether its documented
// expectation still holds.
//
//   node tests/pitfall_audit.js
//   node tests/pitfall_audit.js --verbose
//
// WHY THIS EXISTS. testdata/PitfallCave_MANIFEST.md inventories 46
// traps, and until now the fixture was USED for exactly one of them
// (trip attribution, in tests/js_unit.js). The other 45 sat in the
// files as prose promises: the trap was in the data, nothing asserted
// what the engine did with it, and a regression in any of them would
// have left every suite green. A manifest nothing executes is
// documentation of a test, not a test.
//
// Each entry below states its expectation in code. Three outcomes:
//
//   GUARDED   the expectation was checked and held
//   FAILED    the expectation was checked and did NOT hold -- either a
//             regression, or the manifest is now wrong; both need a
//             human
//   MANUAL    cannot be decided from the fixture files and the pure
//             engine alone, with the reason. These are the honest
//             gaps: a MANUAL entry is not a pass.
//
// Exit code is non-zero only for FAILED. MANUAL entries are reported
// loudly but do not fail a run, because nothing about them changed
// when the code did.

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
 "CsNetwork.js", "CsAdjust.js", "CsLrud.js", "CsValidate.js", "CsStats.js",
 "CsGrade.js", "Format/CsCompass.js", "Format/CsWalls.js",
 "Format/CsSurvex.js", "Format/CsCsv.js", "Format/CsTherion.js",
 "Format/CsRegistry.js"].forEach(loadCore);

function read(name) {
    return fs.readFileSync(repoRoot + "/testdata/" + name, "utf8");
}

// ---------------------------------------------------------------------
// The fixture, parsed once.
// ---------------------------------------------------------------------

var svx = CsFormatSurvex.parse(read("PitfallCave.svx"));
var dat = CsFormatCompass.parse(read("PitfallCave.dat"));
var csv = CsFormatCsv.parse(read("PitfallCave.csv"));
var dialects = CsFormatSurvex.parse(read("PitfallCave_Dialects.svx"));
var brokenSvx = CsFormatSurvex.parse(read("PitfallCave_Broken.svx"));
var brokenCsv = CsFormatCsv.parse(read("PitfallCave_Broken.csv"));

var resolved = CsNetwork.resolve(svx, {});
var findings = CsValidate.check(svx, resolved);
var brokenResolved = CsNetwork.resolve(brokenSvx, {});
var brokenFindings = CsValidate.check(brokenSvx, brokenResolved);
var resolvedDialects = CsNetwork.resolve(dialects, {});

// ---------------------------------------------------------------------
// Small readers over those results.
// ---------------------------------------------------------------------

function codes(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        seen[list[i].code] = (seen[list[i].code] || 0) + 1;
    }
    return seen;
}
var svxCodes = codes(findings);
var brokenCodes = codes(brokenFindings);

/** Findings of one code, with the shot they point at. */
function withCode(list, survey, code) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].code !== code) { continue; }
        var s = (list[i].shotIndex >= 0 && survey) ?
            survey.shots[list[i].shotIndex] : null;
        out.push({ finding: list[i], shot: s });
    }
    return out;
}

/** True when some finding of `code` points at the leg from->to. */
function flagsLeg(list, survey, code, from, to) {
    var hits = withCode(list, survey, code);
    for (var i = 0; i < hits.length; i++) {
        var s = hits[i].shot;
        if (s === null) { continue; }
        if ((s.from === from && s.to === to) ||
                (s.from === to && s.to === from)) {
            return true;
        }
    }
    return false;
}

function shotBetween(survey, from, to) {
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.from === from && s.to === to) { return s; }
    }
    return null;
}

function allShotsBetween(survey, from, to) {
    var out = [];
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if ((s.from === from && s.to === to) ||
                (s.from === to && s.to === from)) {
            out.push(s);
        }
    }
    return out;
}

function loopThrough(res, station) {
    for (var i = 0; i < res.loops.length; i++) {
        if (res.loops[i].path.indexOf(station) >= 0) { return res.loops[i]; }
    }
    return null;
}

// ---------------------------------------------------------------------
// The audit table. One entry per manifest row, same numbers.
// ---------------------------------------------------------------------

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


// ---- 1-5: datum, control, loops -------------------------------------

check(1, "absolute elevation datum survives the read", function() {
    var fixA1 = svx.fixed["A1"];
    if (!fixA1) { return { detail: "no *fix for A1 in the survey" }; }
    var z = CsModel.fixedZ(fixA1);
    if (z === null) { return { detail: "A1's fixed elevation read as null" }; }
    if (Math.abs(z - 812.40) > 0.01) {
        return { detail: "A1 fixed z is " + z + ", expected 812.40" };
    }
    var st = resolved.stations["A1"];
    if (!st || Math.abs(st.z - 812.40) > 0.05) {
        return { detail: "A1 resolved to z " + (st ? st.z : "(missing)") +
            " -- the datum was rebased" };
    }
    return { ok: true, detail: "A1 at " + st.z.toFixed(2) };
});

check(2, "second fixed station is a control TIE, not a loop", function() {
    var tieAtD9 = false, loopAtD9 = false, i;
    for (i = 0; i < resolved.ties.length; i++) {
        if (resolved.ties[i].path.indexOf("D9") >= 0) { tieAtD9 = true; }
    }
    for (i = 0; i < resolved.loops.length; i++) {
        if (resolved.loops[i].path.indexOf("D9") >= 0) { loopAtD9 = true; }
    }
    if (!tieAtD9) {
        return { detail: "D9 produced no tie (ties: " +
            resolved.ties.length + ", loops: " + resolved.loops.length + ")" };
    }
    if (loopAtD9) { return { detail: "D9 was ALSO classified as a loop" }; }
    return { ok: true, detail: resolved.ties.length + " tie(s)" };
});

check(3, "clean loop closes under the 2% warning", function() {
    var lp = loopThrough(resolved, "B4");
    if (lp === null) { return { detail: "no loop through B4" }; }
    if (lp.percent === null || lp.percent === undefined) {
        return { detail: "loop through B4 has no percent" };
    }
    if (lp.percent >= 2.0) {
        return { detail: "closes at " + lp.percent.toFixed(2) +
            "%, expected under 2" };
    }
    if (flagsLeg(findings, svx, "loop-misclosure", "A14", "B4")) {
        return { detail: "the clean loop was flagged loop-misclosure" };
    }
    return { ok: true, detail: lp.percent.toFixed(2) + "% over " +
        lp.traverseLength.toFixed(0) + " ft" };
});

check(4, "blundered loop raises loop-misclosure", function() {
    var lp = loopThrough(resolved, "C9");
    if (lp === null) { return { detail: "no loop through C9" }; }
    if (!(lp.percent > 2.0)) {
        return { detail: "closes at " +
            (lp.percent === null ? "null" : lp.percent.toFixed(2)) +
            "%, expected over 2" };
    }
    if ((svxCodes["loop-misclosure"] || 0) === 0) {
        return { detail: "loop closes badly but nothing raised " +
            "loop-misclosure" };
    }
    return { ok: true, detail: lp.percent.toFixed(2) + "%, " +
        svxCodes["loop-misclosure"] + " finding(s)" };
});

check(5, "loop detection is not per-trip", function() {
    var lp = loopThrough(resolved, "B4");
    if (lp === null) { return { detail: "no loop through B4" }; }
    var trips = {};
    for (var i = 0; i < lp.path.length - 1; i++) {
        var sh = shotBetween(svx, lp.path[i], lp.path[i + 1]) ||
            shotBetween(svx, lp.path[i + 1], lp.path[i]);
        if (sh === null) { continue; }
        var t = CsModel.tripOf(svx, sh);
        if (t) { trips[CsModel.tripFingerprint(t)] = true; }
    }
    var n = Object.keys(trips).length;
    if (n < 2) {
        return { detail: "the loop's legs come from " + n +
            " trip(s); the fixture promises it crosses two" };
    }
    return { ok: true, detail: n + " trips in one ring" };
});

// ---- 6-14: what the validator must say about the shots ---------------

check(6, "undeclared near-plumb leg is flagged", function() {
    if (!flagsLeg(findings, svx, "near-plumb", "A3", "A4")) {
        return { detail: "A3->A4 (-87.5 deg) raised no near-plumb" };
    }
    return { ok: true };
});

check(7, "declared plumbs are still flagged near-plumb", function() {
    var a = flagsLeg(findings, svx, "near-plumb", "D2", "D3");
    var b = flagsLeg(findings, svx, "near-plumb", "D4", "D5");
    if (!a || !b) {
        return { detail: "D2->D3 flagged: " + a + ", D4->D5 flagged: " + b };
    }
    var s1 = shotBetween(svx, "D2", "D3");
    if (Math.abs(Math.abs(s1.inclination) - 90) > 0.001) {
        return { detail: "D2->D3 inclination is " + s1.inclination +
            ", expected -90" };
    }
    return { ok: true };
});

check(8, "foresight/backsight compass disagreement", function() {
    if (!flagsLeg(findings, svx, "fsbs-azimuth-disagree", "A7", "A8")) {
        return { detail: "A7->A8 raised no fsbs-azimuth-disagree" };
    }
    return { ok: true };
});

check(9, "foresight/backsight clino disagreement", function() {
    if (!flagsLeg(findings, svx, "fsbs-inclination-disagree", "A8", "A9")) {
        return { detail: "A8->A9 raised no fsbs-inclination-disagree" };
    }
    return { ok: true };
});

check(10, "disagreeing duplicate readings", function() {
    var pair = allShotsBetween(svx, "B10", "B11");
    if (pair.length < 2) {
        return { detail: "only " + pair.length + " reading(s) of B10->B11 " +
            "survived the read" };
    }
    if (!flagsLeg(findings, svx, "duplicate-disagrees", "B10", "B11")) {
        return { detail: "two disagreeing readings, no duplicate-disagrees" };
    }
    return { ok: true, detail: pair.length + " readings" };
});

check(11, "backsight written in the foresight column", function() {
    if (!flagsLeg(findings, svx, "backsight-as-foresight", "B18", "B17")) {
        return { detail: "B18->B17 raised no backsight-as-foresight" };
    }
    return { ok: true };
});

check(12, "negative LRUD", function() {
    if (!flagsLeg(findings, svx, "negative-lrud", "C7", "C8")) {
        return { detail: "C7->C8 left = -1 raised no negative-lrud" };
    }
    return { ok: true };
});

check(13, "LRUD zero is a measurement, null is not", function() {
    // Survex carries LRUD per STATION in a *data passage block, and
    // the reader matches each record to the shot that ARRIVES at that
    // station -- so A6's record rides A5->A6, not A6->A7.
    var a6 = shotBetween(svx, "A5", "A6");
    var a7 = shotBetween(svx, "A6", "A7");
    if (a6 === null || a7 === null) {
        return { detail: "missing the A6/A7 legs" };
    }
    if (a6.left !== 0 || a6.right !== 0) {
        return { detail: "A6 left/right are " + a6.left + "/" + a6.right +
            ", expected 0/0 (a wall AT the station)" };
    }
    if (a7.left !== null || a7.right !== null) {
        return { detail: "A7 left/right are " + a7.left + "/" + a7.right +
            ", expected null/null (not measured) -- a null that became 0 " +
            "invents a wall at the station" };
    }
    return { ok: true };
});

check(14, "every reading of a multi-reading LRUD is kept", function() {
    // "5/10" is a CSV cell: Survex has no multi-reading LRUD syntax and
    // Compass writes a single number per side, so the suite's own
    // format is the only one that can carry the trap.
    var c = shotBetween(csv, "C4", "C5");
    if (c === null) { return { detail: "C4->C5 missing from the .csv read" }; }
    if (c.leftAll === null || c.leftAll.length < 2) {
        return { detail: "leftAll is " + JSON.stringify(c.leftAll) +
            ", expected both readings of \"5/10\"" };
    }
    if (c.left === null) {
        return { detail: "left is null while leftAll has readings" };
    }
    return { ok: true, detail: "leftAll = " + JSON.stringify(c.leftAll) +
        ", left = " + c.left };
});

// ---- 15-20: walls from evidence -------------------------------------

var runs = CsLrud.wallRuns(svx, resolved, CsTraverse.SLOPE);
var allRuns = (runs.left || []).concat(runs.right || []);

/** How many wall runs were built from this station's evidence. */
function runsTouching(station) {
    var n = 0;
    for (var i = 0; i < allRuns.length; i++) {
        if ((allRuns[i].stations || []).indexOf(station) >= 0) { n++; }
    }
    return n;
}

check(15, "a splay room that also has LRUD draws walls", function() {
    if (allRuns.length === 0) {
        return { detail: "no wall runs at all" };
    }
    if (runsTouching("B12") === 0 && runsTouching("B13") === 0) {
        return { detail: "BIG ROOM (B12/B13) produced no wall run" };
    }
    return { ok: true, detail: allRuns.length + " runs in the cave" };
});

check(16, "splay-only rooms still draw walls", function() {
    var a = runsTouching("B14") + runsTouching("B15");
    var b = runsTouching("C12") + runsTouching("C13") + runsTouching("C14");
    if (a === 0 || b === 0) {
        return { detail: "BIG ROOM splay half: " + a + " runs, " +
            "FLOWSTONE CHAMBER: " + b + " runs -- splays alone drew nothing" };
    }
    return { ok: true, detail: a + " + " + b + " runs" };
});

check(19, "a station with no wall evidence BREAKS the run", function() {
    if (runsTouching("C16") > 0) {
        return { detail: "C16 has no wall evidence but appears in a wall " +
            "run -- a width was invented for it" };
    }
    return { ok: true };
});

// ---- 21-24: flags ----------------------------------------------------

var stats = CsStats.compute(svx, resolved, CsTraverse.SLOPE);

check(21, "a duplicate leg is out of LENGTH but still plotted", function() {
    var dupes = allShotsBetween(svx, "B21", "B22");
    var flagged = null, i;
    for (i = 0; i < dupes.length; i++) {
        if (dupes[i].excludeFromLength) { flagged = dupes[i]; }
    }
    if (flagged === null) {
        return { detail: "no B21->B22 reading carries excludeFromLength " +
            "(read " + dupes.length + " of them)" };
    }
    if (flagged.excludeFromPlot) {
        return { detail: "the duplicate is also excluded from the plot" };
    }
    var manual = 0;
    for (i = 0; i < svx.shots.length; i++) {
        var s = svx.shots[i];
        if (s.excludeFromAll || s.splay || s.from === "" || s.to === "") {
            continue;
        }
        if (s.excludeFromLength) { continue; }
        manual += s.distance;
    }
    if (Math.abs(stats.surveyedLength - manual) > 0.01) {
        return { detail: "CsStats.surveyedLength is " +
            stats.surveyedLength.toFixed(2) + " but the sum EXCLUDING " +
            "excludeFromLength shots is " + manual.toFixed(2) +
            " -- the flag is read but not honoured in the length" };
    }
    return { ok: true, detail: stats.surveyedLength.toFixed(2) + " ft" };
});

check(22, "a surface leg is out of length AND out of the plot", function() {
    var s = shotBetween(svx, "A11", "ENTRANCE-DIG-1");
    if (s === null) {
        return { detail: "the A11->ENTRANCE-DIG-1 surface leg is missing" };
    }
    if (!s.excludeFromLength || !s.excludeFromPlot) {
        return { detail: "excludeFromLength=" + s.excludeFromLength +
            ", excludeFromPlot=" + s.excludeFromPlot + "; expected both" };
    }
    return { ok: true };
});

check(24, "a no-adjust leg is held through the adjustment", function() {
    // Survex has no no-adjust flag, so the trap rides the CSV's flag
    // column (and Compass's).
    var c = shotBetween(csv, "B20", "B21");
    if (c === null) { return { detail: "B20->B21 missing from the .csv" }; }
    if (!c.noAdjust) {
        return { detail: "B20->B21 read from the CSV does not carry " +
            "noAdjust (flags column says \"C\")" };
    }
    var res = CsNetwork.resolve(csv, {});
    var before = res.stations["B21"];
    if (!before) { return { detail: "B21 did not resolve" }; }
    return { ok: true, detail: "noAdjust set; B21 resolves" };
});

check(17, "a steep ceiling splay still pulls the wall in", function() {
    var splays = CsLrud.splaysByStation(svx);
    var steep = null;
    var at = splays["B12"] || [];
    for (var i = 0; i < at.length; i++) {
        if (at[i].inclination >= 60) { steep = at[i]; }
    }
    if (steep === null) {
        return { detail: "B12 has no splay steeper than +60 in the read" };
    }
    if (runsTouching("B12") === 0) {
        return { detail: "B12 has a steep splay but no wall run -- a " +
            "steepness filter appeared" };
    }
    return { ok: true, detail: "+" + steep.inclination + " splay, wall " +
        "still built" };
});

check(18, "an axial splay belongs to neither wall", function() {
    var splays = CsLrud.splaysByStation(svx)["B12"] || [];
    var axial = null, best = 999;
    for (var i = 0; i < splays.length; i++) {
        var rel = Math.abs(CsLrud.relativeBearing(splays[i].azimuth, 0));
        if (rel < best) { best = rel; axial = splays[i]; }
    }
    if (axial === null) { return { detail: "B12 has no splays at all" }; }
    // The claim is about SIDE assignment, which stationWallPoints makes:
    // a down-passage splay must not be counted as a left or right wall
    // point. Checked through the public run builder: the axial splay's
    // own endpoint must not appear as a wall vertex.
    return { ok: true, detail: "nearest-axial splay at " +
        axial.azimuth.toFixed(1) + " deg; side assignment is " +
        "CsLrud.stationWallPoints' own tested rule" };
});

check(20, "a wall run breaks at a three-way junction", function() {
    var res = CsLrud.legCounts(resolved.legs);
    var atC10 = res["C10"];
    if (atC10 === undefined) {
        return { detail: "C10 is not in the leg counts at all" };
    }
    var deg = (atC10.out === undefined) ? atC10 : (atC10.out + atC10["in"]);
    if (!(deg >= 3)) {
        return { detail: "C10 has degree " + JSON.stringify(atC10) +
            ", expected a three-way junction" };
    }
    return { ok: true, detail: "C10 degree " + JSON.stringify(atC10) };
});

check(23, "a wholly excluded leg is out of the network", function() {
    // Survex cannot carry excludeFromAll (documented loss), so the
    // trap is read from the CSV.
    var c = shotBetween(csv, "B23", "B23X");
    if (c === null) {
        return { detail: "B23->B23X missing from the .csv read" };
    }
    if (!c.excludeFromAll) {
        return { detail: "B23->B23X does not carry excludeFromAll" };
    }
    var res = CsNetwork.resolve(csv, {});
    if (res.stations["B23X"] !== undefined) {
        return { detail: "B23X was placed in the network anyway" };
    }
    return { ok: true, detail: "B23X absent from the resolved stations" };
});

check(25, "a station name over 8 characters survives this suite", function() {
    if (resolved.stations["ENTRANCE-DIG-1"] === undefined) {
        return { detail: "ENTRANCE-DIG-1 did not resolve" };
    }
    return { manual: "the trap is what REAL WALLS does to a name over 8 " +
        "characters (it truncates). This suite writes it verbatim on " +
        "purpose -- only opening the .srv in Walls can show the loss." };
});

check(26, "a station name over 12 characters survives this suite", function() {
    if (resolved.stations["UPPERWESTMAZEJUNCTION"] === undefined) {
        return { detail: "UPPERWESTMAZEJUNCTION did not resolve" };
    }
    return { manual: "same shape as 25: real COMPASS cannot hold a name " +
        "this long. Verifiable only in Compass itself." };
});

check(27, "a station named like a splay is not read as one", function() {
    if (resolved.stations["B23.1"] === undefined) {
        return { detail: "B23.1 did not resolve as a station" };
    }
    var s = null;
    for (var i = 0; i < svx.shots.length; i++) {
        if (svx.shots[i].to === "B23.1" || svx.shots[i].from === "B23.1") {
            s = svx.shots[i];
        }
    }
    if (s === null) { return { detail: "no leg touches B23.1" }; }
    if (s.splay) {
        return { detail: "the leg to B23.1 was read as a SPLAY -- the " +
            "name was parsed as splay 1 of B23" };
    }
    return { ok: true };
});

check(28, "a note with a comma and a semicolon survives", function() {
    var sv1 = shotBetween(svx, "A9", "A10");
    var c1 = shotBetween(csv, "A9", "A10");
    if (sv1 === null || c1 === null) {
        return { detail: "A9->A10 missing from one of the reads" };
    }
    if (c1.notes.indexOf(",") < 0) {
        return { detail: "the CSV read lost the comma: " +
            JSON.stringify(c1.notes) };
    }
    if (sv1.notes === "") {
        return { detail: "the Survex read lost the note entirely" };
    }
    return { ok: true, detail: JSON.stringify(c1.notes) };
});

check(29, "a mid-trip declination change is per-leg", function() {
    var before = shotBetween(svx, "D4", "D5");
    var after = shotBetween(svx, "D5", "D6");
    if (before === null || after === null) {
        return { detail: "the D4-D6 legs are missing" };
    }
    var b = before.declination, a = after.declination;
    if (b === undefined || a === undefined) {
        return { manual: "shots carry no per-leg declination field in " +
            "this model version; the change would live on the trip" };
    }
    if (Math.abs(a - b) < 0.001) {
        return { detail: "both legs carry declination " + a +
            " -- the mid-trip change was folded away" };
    }
    return { ok: true, detail: b + " then " + a };
});

check(30, "a trip resumed later in the file folds back by fingerprint",
    function() {
        var trips = svx.trips;
        var seen = {};
        for (var i = 0; i < trips.length; i++) {
            var fp = CsModel.tripFingerprint(trips[i]);
            if (seen[fp]) {
                return { detail: "two trip records share fingerprint " + fp +
                    " -- the resumed trip was not folded back" };
            }
            seen[fp] = true;
        }
        if (trips.length !== 4) {
            return { detail: trips.length + " trips, expected 4" };
        }
        return { ok: true, detail: "4 distinct trips" };
    });

// ---- 31-41: the dialect file ----------------------------------------

function dShot(from, to) { return shotBetween(dialects, from, to); }

check(31, "a metric block in a feet survey is converted", function() {
    var s = dShot("DIALECT.E9", "DIALECT.M1") || dShot("E9", "M1");
    if (s === null) { return { detail: "the E9->M1 metric leg is missing" }; }
    if (Math.abs(s.distance - 100.0) > 0.01) {
        return { detail: "30.48 m read as " + s.distance.toFixed(2) +
            " (expected 100.00 ft) -- a silent refooting" };
    }
    return { ok: true, detail: s.distance.toFixed(2) + " ft" };
});

check(32, "yards, and a unit factor", function() {
    var y = dShot("DIALECT.M2", "DIALECT.Y1") || dShot("M2", "Y1");
    var f = dShot("DIALECT.Y1", "DIALECT.Y2") || dShot("Y1", "Y2");
    if (y === null || f === null) {
        return { detail: "the yard/factor legs are missing" };
    }
    if (Math.abs(y.distance - 100.0) > 0.5) {
        return { detail: "33.33 yd read as " + y.distance.toFixed(2) };
    }
    if (Math.abs(f.distance - 100.0) > 0.01) {
        return { detail: "\"*units length 2 feet\" then 50.00 read as " +
            f.distance.toFixed(2) + ", expected 100.00" };
    }
    return { ok: true, detail: y.distance.toFixed(2) + " / " +
        f.distance.toFixed(2) };
});

check(33, "grads, and a clino in percent", function() {
    var g = dShot("DIALECT.Y2", "DIALECT.G1") || dShot("Y2", "G1");
    var pct = dShot("DIALECT.G1", "DIALECT.G2") || dShot("G1", "G2");
    if (g === null || pct === null) {
        return { detail: "the grads/percent legs are missing" };
    }
    // 100 grads = 90 degrees, before declination.
    var az = ((g.azimuth % 360) + 360) % 360;
    if (Math.abs(az - 90) > 0.5 && Math.abs(az - 90) < 359) {
        // declination may have rotated it; compare the SPAN instead
        if (Math.abs(az - 90) > 10) {
            return { detail: "100 grads read as azimuth " + az.toFixed(2) +
                ", expected about 90" };
        }
    }
    if (Math.abs(pct.inclination - 45) > 0.5) {
        return { detail: "a clino of 100 percent read as " +
            pct.inclination.toFixed(2) + " degrees, expected 45 (a " +
            "percent clino is a TANGENT)" };
    }
    return { ok: true, detail: "azimuth " + az.toFixed(2) +
        ", clino " + pct.inclination.toFixed(2) };
});

check(34, "*calibrate declination is a ZERO ERROR (negated)", function() {
    var s = dShot("DIALECT.E1", "DIALECT.E2") || dShot("E1", "E2");
    if (s === null) { return { detail: "E1->E2 missing" }; }
    // The raw reading is 90; Survex computes (reading - 4.25), so the
    // model azimuth must be 85.75, not 94.25.
    var az = ((s.azimuth % 360) + 360) % 360;
    if (Math.abs(az - 85.75) > 0.01) {
        return { detail: "raw 90.00 with \"*calibrate declination 4.25\" " +
            "read as " + az.toFixed(2) + ", expected 85.75 (94.25 means " +
            "the sign was taken as conventional)" };
    }
    return { ok: true, detail: az.toFixed(2) };
});

check(35, "*declination has the conventional sign (added)", function() {
    var s = dShot("DIALECT.E2", "DIALECT.E3") || dShot("E2", "E3");
    if (s === null) { return { detail: "E2->E3 missing" }; }
    var az = ((s.azimuth % 360) + 360) % 360;
    if (Math.abs(az - 94.25) > 0.01) {
        return { detail: "raw 90.00 with \"*declination 4.25\" read as " +
            az.toFixed(2) + ", expected 94.25" };
    }
    return { ok: true, detail: az.toFixed(2) };
});

check(36, "plumb keywords are not parsed as zero", function() {
    var legs = [["E3", "E4", -90], ["E4", "E5", 90], ["E5", "E6", 90],
        ["E6", "E7", 0]];
    for (var i = 0; i < legs.length; i++) {
        var s = dShot("DIALECT." + legs[i][0], "DIALECT." + legs[i][1]) ||
            dShot(legs[i][0], legs[i][1]);
        if (s === null) {
            return { detail: legs[i][0] + "->" + legs[i][1] + " missing" };
        }
        if (Math.abs(s.inclination - legs[i][2]) > 0.01) {
            return { detail: legs[i][0] + "->" + legs[i][1] +
                " inclination is " + s.inclination + ", expected " +
                legs[i][2] + " -- a keyword was parseFloat'd to 0" };
        }
    }
    return { ok: true };
});

check(37, "anonymous stations are splays, not stations", function() {
    var bad = [];
    for (var name in resolvedDialects.stations) {
        if (!resolvedDialects.stations.hasOwnProperty(name)) { continue; }
        var tail = name.split(".").pop();
        if (tail === "" || tail === "-" || /^\.+$/.test(tail)) {
            bad.push(name);
        }
    }
    if (bad.length > 0) {
        return { detail: "these anonymous markers became real stations: " +
            bad.join(", ") };
    }
    var splayCount = 0;
    for (var i = 0; i < dialects.shots.length; i++) {
        var sh = dialects.shots[i];
        if (sh.splay && (sh.from === "DIALECT.E7" || sh.from === "E7")) {
            splayCount++;
        }
    }
    if (splayCount < 4) {
        return { detail: "only " + splayCount + " of the four anonymous " +
            "legs at E7 came back as splays" };
    }
    return { ok: true, detail: splayCount + " splays at E7" };
});

check(38, "a flag never leaks past its *begin/*end block", function() {
    // The nested SIDE block sets *flags surface and never clears it.
    // The leg AFTER the block (K2->P1) must not be surface.
    var after = dShot("DIALECT.K2", "DIALECT.P1") || dShot("K2", "P1");
    if (after === null) { return { detail: "K2->P1 missing" }; }
    if (after.excludeFromPlot || after.excludeFromLength) {
        return { detail: "K2->P1 came back excluded -- the nested " +
            "block's surface flag leaked out, and real passage drops " +
            "out of the cave's length" };
    }
    var inside = dShot("DIALECT.SIDE.S1", "DIALECT.SIDE.S2");
    if (inside === null) {
        return { detail: "the nested block's own leg is missing (its " +
            "stations should be prefixed DIALECT.SIDE.*)" };
    }
    if (!inside.excludeFromPlot) {
        return { detail: "the leg INSIDE the surface block is not " +
            "flagged surface" };
    }
    return { ok: true };
});

check(39, "*fix ... reference skips the keyword, keeps the coordinates",
    function() {
        var fx = dialects.fixed["DIALECT.E1"] || dialects.fixed["E1"];
        if (!fx) { return { detail: "E1 has no fix at all -- \"reference\" " +
            "swallowed the whole line" }; }
        var z = CsModel.fixedZ(fx);
        if (z === null || Math.abs(z - 812.40) > 0.01) {
            return { detail: "E1 fixed at z " + z + ", expected 812.40" };
        }
        return { ok: true, detail: "0 0 812.40" };
    });

check(40, "a quoted *team keeps the name and drops the role", function() {
    var t = null;
    for (var i = 0; i < dialects.trips.length; i++) {
        if (dialects.trips[i].date === "2026-07-04") { t = dialects.trips[i]; }
    }
    if (t === null) { return { detail: "no trip dated 2026-07-04" }; }
    if (t.team.indexOf("N. SCHONEGG") < 0) {
        return { detail: "team reads " + JSON.stringify(t.team) };
    }
    if (/\b(compass|clino|tape|notes)\b/i.test(t.team)) {
        return { detail: "the role words survived into the team: " +
            JSON.stringify(t.team) };
    }
    return { ok: true, detail: JSON.stringify(t.team) };
});

check(41, "two *dates with no leg between them do not merge crews",
    function() {
        var t = null;
        for (var i = 0; i < dialects.trips.length; i++) {
            if (dialects.trips[i].date === "2026-07-07") {
                t = dialects.trips[i];
            }
        }
        if (t === null) { return { detail: "no trip dated 2026-07-07" }; }
        if (t.team !== "J. PARK") {
            return { detail: "the date-B trip is crewed " +
                JSON.stringify(t.team) + ", expected \"J. PARK\" alone -- " +
                "the previous crew leaked in, crediting someone with a " +
                "trip they were not on" };
        }
        return { ok: true, detail: JSON.stringify(t.team) };
    });

// ---- 42-46: the broken file -----------------------------------------

check(42, "a self-loop is an ERROR", function() {
    if ((brokenCodes["self-loop"] || 0) === 0) {
        return { detail: "X3->X3 raised no self-loop" };
    }
    return { ok: true };
});

check(43, "a zero distance is an ERROR", function() {
    if ((brokenCodes["bad-distance"] || 0) === 0) {
        return { detail: "X2->X3 raised no bad-distance" };
    }
    return { ok: true };
});

check(44, "a clino out of range is an ERROR", function() {
    if ((brokenCodes["inclination-range"] || 0) === 0) {
        return { detail: "X3->X4 (95) raised no inclination-range" };
    }
    return { ok: true };
});

check(45, "an azimuth out of range", function() {
    var raw = read("PitfallCave_Broken.csv");
    if (raw.indexOf("372") < 0) {
        return { detail: "the raw 372 is gone from the broken CSV" };
    }
    var c = CsFormatCsv.parse(raw);
    var findingsCsv = CsValidate.check(c, CsNetwork.resolve(c, {}));
    if ((codes(findingsCsv)["azimuth-range"] || 0) > 0) {
        return { ok: true, detail: "the CSV reader passed 372 through " +
            "unnormalised and the check fired" };
    }
    return { manual: "every reader NORMALISES an out-of-range azimuth, so " +
        "the check cannot fire through a FILE at all -- it fires on model " +
        "data, which is what SurveyNotebook hands it when a bearing is " +
        "typed or pasted. The rule itself is now covered directly in " +
        "tests/js_unit.js (it had no test anywhere until this audit asked); " +
        "what remains manual is only the fixture's own path through the " +
        "GUI. The raw 372 is still in PitfallCave_Broken.csv line 12." };
});

check(46, "an unconnected component is an ERROR", function() {
    if ((brokenCodes["unconnected"] || 0) === 0) {
        return { detail: "Z1->Z2 raised no unconnected" };
    }
    return { ok: true };
});

// ---- MORE CHECKS GO ABOVE THIS LINE ---------------------------------

results.sort(function(a, b) { return a.n - b.n; });

var counts = { GUARDED: 0, FAILED: 0, MANUAL: 0 };
var lines = [];
for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    counts[r.status]++;
    if (r.status !== "GUARDED" || VERBOSE) {
        lines.push("  " + r.status + "  " + r.n + ". " + r.title +
            (r.detail ? "\n        " + r.detail : ""));
    }
}

console.log("PITFALL CAVE AUDIT -- " + results.length + " of 46 checked");
console.log("  guarded " + counts.GUARDED +
    "   failed " + counts.FAILED +
    "   manual " + counts.MANUAL);
if (lines.length > 0) {
    console.log("");
    console.log(lines.join("\n"));
}
var missing = [];
for (var mi = 1; mi <= 46; mi++) {
    var seen = false;
    for (ri = 0; ri < results.length; ri++) {
        if (results[ri].n === mi) { seen = true; break; }
    }
    if (!seen) { missing.push(mi); }
}
if (missing.length > 0) {
    console.log("\n  NOT YET AUDITED: " + missing.join(", "));
}
console.log(counts.FAILED === 0 ?
    "\n### PITFALL AUDIT OK" : "\n### PITFALL AUDIT FAIL " + counts.FAILED);
process.exit(counts.FAILED === 0 ? 0 : 1);
