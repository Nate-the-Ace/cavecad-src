// lrud_continuity_report.js -- what the LRUD walls of a REAL cave do at
// its tie-ins and its "P" stations.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/lrud_continuity_report.js "$PWD" "<cave>.dxf"
//
// WHY THIS IS A TOOL AND NOT A TEST. The caves worth measuring this on
// are real ones on somebody's disk -- Truitt Cave, in the case it was
// written for -- and a test that needs a file no checkout contains is a
// test that fails for everyone else. So this reports rather than
// asserts: run it on the same cave before and after a change to the
// wall rules and diff the two outputs. The synthetic fixtures in
// tests/js_unit.js are what PIN the behaviour; this is what says how
// much of a real cave the behaviour touches.
//
// PRINTS NO COORDINATES, EVER. Station names, counts and lengths only.
// A cave's entrance location is the one thing this suite never puts in
// a file somebody might paste somewhere, and "just the survey stations"
// is exactly a cave's location written out longhand.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}

var args = RSettings.getOriginalArguments();
var dxfPath = args[args.length - 1];
var repoRoot = args[args.length - 2];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
getMainWindow = function() { return null; };

if (di.importFile(dxfPath, "", false) !== RDocumentInterface.IoErrorNoError) {
    print("### LRUD REPORT FAIL -- cannot read " + dxfPath);
    if (typeof QCoreApplication !== "undefined") { QCoreApplication.quit(); }
    throw new Error("unreadable drawing");
}

// The v3 reader, not CsTags.surveyFromDocument: the latter CHAINS
// consecutive tagged stations, which flattens a network into one strand
// and so would hide the very tie-ins this report is about.
var recon = CsRevise.surveyFromDocument(doc);
var survey = recon.survey || recon;
var resolved = CsNetwork.resolve(survey, {});

// RUNS AGAINST BOTH SIDES OF THE CHANGE, which is the only way the
// two outputs are comparable. On code that predates passage axes there
// is no clustering to ask for, so the report says so and falls back to
// the leg count -- the very rule being replaced.
var HAS_AXES = (typeof CsLrud.stationAxes === "function");
var axes = HAS_AXES ? CsLrud.stationAxes(resolved) : {};
var counts = CsLrud.legCounts(resolved.legs);

// --- what the cave is made of ----------------------------------------
var nStations = 0, name;
for (name in resolved.stations) {
    if (resolved.stations.hasOwnProperty(name)) { nStations++; }
}

// --- tie-ins: many legs, few ways out --------------------------------
var tieIns = [], realJunctions = [];
var scan = HAS_AXES ? axes : counts;
for (name in scan) {
    if (!scan.hasOwnProperty(name)) { continue; }
    // With no clustering available, every leg is its own way out --
    // which is exactly what the old rule believed.
    var ways = HAS_AXES ? axes[name].dirs.length : (counts[name] || 0);
    var legs = counts[name] || 0;
    if (legs > 2 && ways < 3) {
        // the whole case: the old leg-count rule called this a junction
        // and ended every wall run at it
        tieIns.push(name + " (" + legs + " legs, " + ways + " ways out)");
    } else if (ways >= 3) {
        realJunctions.push(name);
    }
}

// --- "P" stations ----------------------------------------------------
var openPlan = [], openOnly = [], openProfile = [];
var splays = CsLrud.splaysByStation(survey);
for (name in resolved.stations) {
    if (!resolved.stations.hasOwnProperty(name)) { continue; }
    var lrud = CsModel.lrudForStation(survey, name);
    if (lrud === null || lrud === undefined) { continue; }
    if (lrud.leftOpen || lrud.rightOpen) {
        openPlan.push(name);
        // Would the OLD rule have broken the run here? It broke when
        // neither side yielded a point and it could not see the "P".
        var hasLen = (lrud.left !== null && lrud.left !== undefined) ||
            (lrud.right !== null && lrud.right !== undefined);
        var hasSplay = (splays[name] || []).length > 0;
        if (!hasLen && !hasSplay) { openOnly.push(name); }
    }
    if (lrud.upOpen || lrud.downOpen) { openProfile.push(name); }
}

// --- the walls themselves --------------------------------------------
var w = CsLrud.wallRuns(survey, resolved);
var measure = function(runs) {
    var total = 0, longest = 0, points = 0;
    for (var i = 0; i < runs.length; i++) {
        var pts = runs[i].points;
        points += pts.length;
        var len = 0;
        for (var j = 1; j < pts.length; j++) {
            var dx = pts[j].x - pts[j - 1].x;
            var dy = pts[j].y - pts[j - 1].y;
            len += Math.sqrt(dx * dx + dy * dy);
        }
        total += len;
        if (len > longest) { longest = len; }
    }
    return { runs: runs.length, points: points,
             total: total, longest: longest };
};
var L = measure(w.left), R = measure(w.right);
var r2 = function(n) { return Math.round(n * 100) / 100; };

// --- the profile's own walls, over every band ------------------------
var pc = 0, pf = 0, pcPoints = 0, pfPoints = 0;
try {
    var prof = CsProfile.build(survey, resolved, {});
    for (var bi = 0; bi < prof.bands.length; bi++) {
        var band = prof.bands[bi];
        pc += (band.ceiling || []).length;
        pf += (band.floor || []).length;
        for (var ci = 0; ci < (band.ceiling || []).length; ci++) {
            pcPoints += band.ceiling[ci].length;
        }
        for (var fi = 0; fi < (band.floor || []).length; fi++) {
            pfPoints += band.floor[fi].length;
        }
    }
} catch (e) {
    pc = -1; pf = -1;
}

// --- the 3D shell ----------------------------------------------------
var lofted = -1, ringless = -1;
try {
    var mesh = CsMesh3d.build(survey, resolved, {});
    lofted = mesh.triangles.indices.length / 3;
    ringless = 0;
    for (var si = 0; si < resolved.legs.length; si++) {
        if (resolved.legs[si].kind === "new") { ringless++; }
    }
} catch (e2) {
    lofted = -1;
}

var join = function(list, max) {
    if (list.length === 0) { return "(none)"; }
    if (list.length <= max) { return list.join(", "); }
    return list.slice(0, max).join(", ") + ", ... (+" +
        (list.length - max) + " more)";
};

print("### LRUD CONTINUITY REPORT");
print("code               " + (HAS_AXES ? "passage axes present" :
    "OLD -- leg-count junctions, \"P\" read as a blank cell"));
print("drawing            " + dxfPath.replace(/^.*\//, ""));
print("stations           " + nStations);
print("legs               " + resolved.legs.length);
print("");
print("TIE-INS (3+ legs, <3 ways out -- these used to end a wall run)");
print("  count            " + tieIns.length);
print("  stations         " + join(tieIns, 12));
print("real junctions     " + realJunctions.length + "  -- " +
    join(realJunctions, 12));
print("");
print("\"P\" IN LRUD");
print("  L or R open      " + openPlan.length + "  -- " +
    join(openPlan, 12));
print("  ...and nothing   " + openOnly.length + "  -- " +
    join(openOnly, 12));
print("     else measured (these used to break the run outright)");
print("  U or D open      " + openProfile.length);
print("");
print("PLAN WALLS");
print("  left             " + L.runs + " runs, " + L.points +
    " points, " + r2(L.total) + " total, longest " + r2(L.longest));
print("  right            " + R.runs + " runs, " + R.points +
    " points, " + r2(R.total) + " total, longest " + r2(R.longest));
print("  splays skipped   " + w.skipped);
print("");
print("PROFILE WALLS");
print("  ceiling          " + pc + " runs, " + pcPoints + " points");
print("  floor            " + pf + " runs, " + pfPoints + " points");
print("");
print("3D SHELL");
print("  triangles        " + lofted);
print("  loftable legs    " + ringless);
print("### LRUD REPORT OK");

if (typeof QCoreApplication !== "undefined") { QCoreApplication.quit(); }
