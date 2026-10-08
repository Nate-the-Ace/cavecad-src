// plumbline_pipeline.js -- runs the whole pure-geometry stack over the
// VERTICAL FIXTURE FAMILY and asserts that nothing in it produces a
// number that is not a number.
//
// Plumbline Pit (a cave that is mostly air) and Stairstep Cave (both
// kinds of passage interleaved), through every reader each of them
// has. The name is Plumbline's because Plumbline came first; what the
// file covers is the family.
//
//   node tests/plumbline_pipeline.js
//   node tests/plumbline_pipeline.js --verbose
//
// tests/plumbline_audit.js asks whether each documented pitfall still
// behaves. This asks a blunter question of a much wider surface: given
// a cave that is mostly air, does every pass in the Core still return
// finite geometry, or does one of them quietly hand back NaN,
// Infinity, an empty result where there should be walls, or a rope
// leaning across the map?
//
// WHY BLUNT IS WORTH A FILE. The failure mode this suite kept finding
// in vertical geometry is not an exception -- it is a number. cos(90)
// is 6.1e-17 and not 0; atan2 of two rounding errors is a confident
// bearing; a plan projection of zero divides fine and prints fine. None
// of that throws. It flows downstream, gets drawn, and looks like a
// map. A test that only checks for thrown errors would pass through
// every bug this fixture was built to find.
//
// The passes covered, in the order a drawing uses them:
//   network resolve -> least-squares adjust -> validate -> stats/grade
//   -> plan wall runs -> extended elevation (bands, walls, layout)
//   -> 3D passage mesh -> cross sections at and along every leg

var fs = require("fs");
var path = require("path");
var repoRoot = path.resolve(__dirname, "..");
var VERBOSE = process.argv.indexOf("--verbose") >= 0;

if (typeof isNull === "undefined") {
    global.isNull = function(v) {
        return v === undefined || v === null;
    };
}

function loadCore(rel) {
    var src = fs.readFileSync(repoRoot + "/scripts/CaveSurvey/Core/" + rel,
        "utf8").replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid.js", "CsUnits.js", "CsAngles.js", "CsModel.js", "CsTraverse.js",
 "CsNetwork.js", "CsAdjust.js", "CsLrud.js", "CsFrontier.js",
 "CsPitch.js", "CsProfile.js", "CsProject.js", "CsChunk.js",
 "CsSectionCut.js",
 "CsMesh3d.js", "CsValidate.js", "CsStats.js", "CsGrade.js",
 "Format/CsCompass.js", "Format/CsWalls.js", "Format/CsSurvex.js",
 "Format/CsCsv.js", "Format/CsTherion.js",
 "Format/CsRegistry.js"].forEach(loadCore);

var failures = [];
var checks = 0;
function ok(cond, what) {
    checks++;
    if (!cond) {
        failures.push(what);
        console.log("  FAIL  " + what);
    } else if (VERBOSE) {
        console.log("  ok    " + what);
    }
}

/**
 * Walks anything and reports the first path at which it finds a number
 * that is not finite. Depth-limited, because a resolved survey holds
 * back-references and a naive walk would not terminate.
 */
function firstBadNumber(value, label, depth) {
    if (depth === undefined) { depth = 0; }
    if (depth > 8) { return null; }
    if (typeof value === "number") {
        return isFinite(value) ? null : label;
    }
    if (value === null || value === undefined) { return null; }
    if (typeof value !== "object") { return null; }
    if (Object.prototype.toString.call(value) === "[object Array]") {
        // A long array is sampled at both ends and through the middle:
        // a NaN that appears only in the interior of a 20 000 point
        // mesh is worth finding, and walking every one of them on
        // every pass is not worth the seconds.
        var step = value.length > 400 ? Math.ceil(value.length / 400) : 1;
        for (var i = 0; i < value.length; i += step) {
            var r = firstBadNumber(value[i], label + "[" + i + "]", depth + 1);
            if (r !== null) { return r; }
        }
        return null;
    }
    for (var k in value) {
        if (!value.hasOwnProperty(k)) { continue; }
        // Skip the model objects hanging off geometry: a leg carries
        // its own shot, and a shot's numbers are the FILE's, already
        // checked by the validator on its own terms.
        if (k === "shot" || k === "survey" || k === "parent") { continue; }
        var r2 = firstBadNumber(value[k], label + "." + k, depth + 1);
        if (r2 !== null) { return r2; }
    }
    return null;
}

function finite(value, label) {
    var bad = firstBadNumber(value, label);
    ok(bad === null, label + " is finite throughout" +
        (bad === null ? "" : " -- first non-finite at " + bad));
}

// ---------------------------------------------------------------------
// The fixture, through every reader it has.
// ---------------------------------------------------------------------

var sources = [
    // THE MIXED CAVE FIRST, because it is the one most likely to break:
    // both kinds of passage in one drawing, chunk boundaries every few
    // stations through its staircase, and two pieces sitting either
    // side of the fold threshold.
    { name: "StairstepCave.svx", mostlyAir: false,
      survey: CsFormatSurvex.parse(
          fs.readFileSync(repoRoot + "/testdata/StairstepCave.svx", "utf8")) },
    { name: "PlumblinePit.svx", mostlyAir: true,
      survey: CsFormatSurvex.parse(
          fs.readFileSync(repoRoot + "/testdata/PlumblinePit.svx", "utf8")) },
    { name: "PlumblinePit.dat", mostlyAir: true,
      survey: CsFormatCompass.parse(
          fs.readFileSync(repoRoot + "/testdata/PlumblinePit.dat", "utf8")) },
    { name: "PlumblinePit.csv", mostlyAir: true,
      survey: CsFormatCsv.parse(
          fs.readFileSync(repoRoot + "/testdata/PlumblinePit.csv", "utf8")) }
];

console.log("PLUMBLINE PIT PIPELINE");

for (var si = 0; si < sources.length; si++) {
    var name = sources[si].name;
    var survey = sources[si].survey;
    // A CAVE THAT IS MOSTLY AIR and a cave that is mostly passage are
    // both supposed to come through here intact, and a few of the
    // checks below are about SHAPE rather than correctness -- they say
    // "this fixture really is a pit" and are meaningless against one
    // that is not. Gated rather than deleted: losing them would lose
    // the proof that Plumbline is still the cave it claims to be.
    var mostlyAir = sources[si].mostlyAir === true;
    console.log("");
    console.log("== " + name);

    // ---- resolve --------------------------------------------------
    var resolved = CsNetwork.resolve(survey, {});
    finite(resolved.stations, name + ": resolved stations");
    ok(resolved.unresolved.length === 0,
        name + ": every station resolved (" + resolved.unresolved.length +
        " unresolved)");

    // ---- adjust ---------------------------------------------------
    var adjusted = CsAdjust.resolveAndAdjust(survey, {},
        { enabled: true, sigmaTape: 0.1, sigmaAngle: 1.5 });
    ok(adjusted !== null && adjusted !== undefined,
        name + ": the least-squares adjustment returns a result");
    if (adjusted) {
        finite(adjusted.stations, name + ": adjusted stations");
        // AND THE ROPES STILL HANG STRAIGHT. A plumbed leg carries no
        // compass error to distribute (CsAdjust.PLUMB_SIGMA_ANGLE_DEG),
        // so the adjustment must not be leaning it across the map to
        // absorb somebody else's misclosure.
        var worst = 0.0, worstLeg = "";
        for (var ai = 0; ai < adjusted.legs.length; ai++) {
            var lg = adjusted.legs[ai];
            if (lg.kind === "closure" || !lg.shot.azimuthOmitted) { continue; }
            var a = adjusted.stations[lg.from], b = adjusted.stations[lg.to];
            if (!a || !b) { continue; }
            var dp = Math.sqrt((b.x - a.x) * (b.x - a.x) +
                (b.y - a.y) * (b.y - a.y));
            var dv = Math.abs(b.z - a.z);
            var lean = (dv === 0) ? 90.0 :
                Math.atan2(dp, dv) * 180.0 / Math.PI;
            if (lean > worst) { worst = lean; worstLeg = lg.from + "-" + lg.to; }
        }
        ok(worst < 0.25,
            name + ": a DECLARED plumb still hangs within a quarter of a " +
            "degree of vertical after adjustment (worst " +
            worst.toFixed(3) + " deg on " + worstLeg + ")");
    }

    // ---- validate, stats, grade ------------------------------------
    var findings = CsValidate.check(survey, resolved);
    ok(!CsValidate.checkHasErrors(findings),
        name + ": the fixture validates with warnings only");
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    finite(stats, name + ": stats");
    ok(stats.depth > 200,
        name + ": depth survives the reader (" + stats.depth.toFixed(1) + ")");
    ok(stats.surveyedLength >= stats.planLength - 1e-6,
        name + ": the tape is never shorter than its own plan " +
        "projection (" + stats.surveyedLength.toFixed(0) + " vs " +
        stats.planLength.toFixed(0) + ")");
    if (mostlyAir) {
        ok(stats.surveyedLength > stats.planLength * 1.5,
            name + ": and in a cave that is mostly air it is much " +
            "longer (" + stats.surveyedLength.toFixed(0) + " vs " +
            stats.planLength.toFixed(0) + ")");
    }
    var grade = CsGrade.compute(survey, resolved, stats);
    finite(grade, name + ": BCRA grade");

    // ---- plan walls ------------------------------------------------
    var walls = CsLrud.wallRuns(survey, resolved);
    finite(walls, name + ": plan wall runs");
    ok(walls.left.length + walls.right.length > 0,
        name + ": the plan draws walls at all");
    // No wall point may land on top of a station it was not measured
    // AT: a tick swung onto a fabricated bearing used to put the foot
    // of a pitch's walls at right angles to nothing.
    var axes = CsLrud.stationAxes(resolved);
    var tickless = 0, ticked = 0;
    var names = CsModel.stationNames(survey);
    for (var ni = 0; ni < names.length; ni++) {
        var lr = CsModel.lrudForStation(survey, names[ni]);
        if (lr === null) { continue; }
        var az = CsLrud.tickAzimuthAt(axes, names[ni], lr, resolved);
        if (az === null) { tickless++; } else { ticked++; }
    }
    ok(ticked > 0, name + ": stations with a tick bearing: " + ticked);
    ok(tickless === 0,
        name + ": and none left without one (" + tickless + ") -- every " +
        "station reached by a pitch still finds the passage it opens on");

    // ---- extended elevation ----------------------------------------
    var profile = CsProfile.build(survey, resolved, {});
    ok(profile !== null && profile !== undefined && profile.bands,
        name + ": the extended elevation builds");
    if (profile && profile.bands) {
        finite(profile.bands, name + ": profile bands");
        var stationsInBands = 0, widest = 0;
        for (var bi = 0; bi < profile.bands.length; bi++) {
            var band = profile.bands[bi];
            stationsInBands += band.stations.length;
            var span = CsProfile.bandSpan(band);
            ok(span !== null,
                name + ": band " + band.key + " has a vertical span");
            if (span !== null) {
                ok(isFinite(span.lo) && isFinite(span.hi) && span.hi >= span.lo,
                    name + ": band " + band.key + " span is sane (" +
                    span.lo.toFixed(1) + ".." + span.hi.toFixed(1) + ")");
            }
            for (var pi = 0; pi < band.stations.length; pi++) {
                if (band.stations[pi].x > widest) {
                    widest = band.stations[pi].x;
                }
                // X NEVER GOES BACKWARDS. "Extended" means the axis is
                // distance travelled, and a plan distance of zero
                // advances it by zero -- which is allowed. Negative is
                // not, and a pitch is where a sign error would show.
                if (pi > 0) {
                    ok(band.stations[pi].x >= band.stations[pi - 1].x - 1e-9,
                        name + ": band " + band.key + " X does not go " +
                        "backwards at station " + pi);
                }
            }
        }
        ok(stationsInBands > 10,
            name + ": the bands hold " + stationsInBands + " stations");
        CsProfile.layout(profile.bands);
        finite(profile.bands, name + ": profile bands after layout");
    }

    // ---- the PROJECTED elevation -----------------------------------
    //
    // The view a pit cave actually wants: real coordinates on one
    // plane, so the shafts stack the way they stack underground.
    var proj = CsProfile.build(survey, resolved,
        { mode: CsProject.MODE_PROJECTED });
    ok(proj !== null && proj.bands && proj.bands.length === 1,
        name + ": the projected elevation builds as ONE band");
    if (proj && proj.bands && proj.bands.length === 1) {
        var pband = proj.bands[0];
        finite(pband.stations, name + ": projected stations");
        finite(pband.legs, name + ": projected legs");
        finite(pband.ceiling, name + ": projected ceiling runs");
        finite(pband.floor, name + ": projected floor runs");
        ok(pband.stations.length ===
                Object.keys(resolved.stations).length,
            name + ": and draws EVERY station (" + pband.stations.length +
            " of " + Object.keys(resolved.stations).length + ") -- a " +
            "projection has no chain to pick and nothing to demote");
        ok(pband.legs.length === resolved.legs.length,
            name + ": and every leg, the loop closure included");
        var plo = null, phi = null;
        for (var pi2 = 0; pi2 < pband.stations.length; pi2++) {
            var py = pband.stations[pi2].y;
            if (plo === null || py < plo) { plo = py; }
            if (phi === null || py > phi) { phi = py; }
        }
        ok(Math.abs((phi - plo) - stats.depth) < 0.05,
            name + ": drawn at TRUE depth (" + (phi - plo).toFixed(1) +
            " vs the survey's " + stats.depth.toFixed(1) + ")");
        ok(proj.projection.azimuth >= 0 && proj.projection.azimuth < 180,
            name + ": on a plane in [0, 180) -- an axis is a line, not " +
            "a direction");
        // EVERY pitch is labelled here, including the ones the
        // extended elevation has to drop: a projection draws every
        // station, so a drop is never split across bands.
        ok(pband.pitches.length === proj.pitches.length,
            name + ": every one of the cave's " + proj.pitches.length +
            " drops is labelled (" + pband.pitches.length + ") -- no " +
            "band splitting to lose one behind");
    }

    // ---- the CHUNKED elevation -------------------------------------
    //
    // The cave cut at its pitches, every piece at true depth. The two
    // claims worth checking over a real cave: nothing is displaced,
    // and no two pieces overlap.
    var chunked = CsProfile.build(survey, resolved,
        { mode: CsProject.MODE_CHUNKED });
    ok(chunked !== null && chunked.bands && chunked.bands.length > 4,
        name + ": the chunked elevation builds (" +
        (chunked && chunked.bands ? chunked.bands.length : 0) + " pieces)");
    if (chunked && chunked.bands) {
        finite(chunked.bands, name + ": chunked bands");
        var displaced = 0;
        for (var ci2 = 0; ci2 < chunked.bands.length; ci2++) {
            if (Math.abs(chunked.bands[ci2].zOffset || 0) > 1e-9) {
                displaced++;
            }
        }
        ok(displaced === 0,
            name + ": and NOTHING is displaced off true elevation (" +
            displaced + ")");
        var spans = [];
        for (ci2 = 0; ci2 < chunked.bands.length; ci2++) {
            spans.push(CsChunk.extentOf(chunked.bands[ci2]));
        }
        spans.sort(function(a, b) { return a.lo - b.lo; });
        var over = 0;
        for (ci2 = 1; ci2 < spans.length; ci2++) {
            if (spans[ci2].lo < spans[ci2 - 1].hi - 1e-9) { over++; }
        }
        ok(over === 0,
            name + ": and no two pieces overlap (" + over + ")");
        // A cave's pitches are all chunk boundaries, so every drop is
        // drawn whole inside one piece and labelled there.
        var labelled = 0;
        for (ci2 = 0; ci2 < chunked.bands.length; ci2++) {
            labelled += chunked.bands[ci2].pitches.length;
        }
        ok(labelled === chunked.pitches.length,
            name + ": every drop is labelled (" + labelled + " of " +
            chunked.pitches.length + ") -- a pitch IS a chunk, so it " +
            "can never be split across two");
        ok(chunked.ties.length > 0,
            name + ": the pieces are tied back together (" +
            chunked.ties.length + ")");
    }

    // ---- 3D passage mesh -------------------------------------------
    var mesh = CsMesh3d.build(survey, resolved, {});
    ok(mesh !== null && mesh !== undefined, name + ": the 3D mesh builds");
    if (mesh) {
        finite(mesh.bounds, name + ": mesh bounds");
        var tri = mesh.triangles || { positions: [] };
        var lin = mesh.lines || { positions: [] };
        ok(tri.positions.length > 0,
            name + ": the passage tube has geometry (" +
            (tri.positions.length / 3) + " vertices)");
        ok(lin.positions.length > 0,
            name + ": and the centreline is drawn (" +
            (lin.positions.length / 3) + " vertices)");
        finite(tri.positions, name + ": tube vertices");
        finite(lin.positions, name + ": centreline vertices");
        // The mesh has to span the cave's real depth: a tube built
        // around a vertical shaft is exactly where a section frame
        // that degenerates would collapse the passage to a disc.
        var dz3 = mesh.bounds.max.z - mesh.bounds.min.z;
        ok(Math.abs(dz3 - stats.depth) < stats.depth * 0.5,
            name + ": the mesh spans roughly the cave's depth (" +
            dz3.toFixed(0) + " ft against " + stats.depth.toFixed(0) + ")");
        var dx3 = mesh.bounds.max.x - mesh.bounds.min.x;
        var dy3 = mesh.bounds.max.y - mesh.bounds.min.y;
        if (mostlyAir) {
            ok(dz3 > Math.max(dx3, dy3),
                name + ": and is taller than it is wide, as the cave " +
                "is (" + dz3.toFixed(0) + " vs " +
                Math.max(dx3, dy3).toFixed(0) + ")");
        }
    }

    // ---- cross sections, at and along every leg --------------------
    var cuts = 0, refused = 0, onPitches = 0, badCuts = 0;
    for (var li = 0; li < resolved.legs.length; li++) {
        var leg = resolved.legs[li];
        var ts = [0.0, 0.5, 1.0];
        for (var ti = 0; ti < ts.length; ti++) {
            var cut = CsSectionCut.cut(survey, resolved, leg.from, leg.to,
                ts[ti], {});
            if (cut === null || cut === undefined) {
                badCuts++;
                continue;
            }
            if (cut.refused) {
                refused++;
                continue;
            }
            cuts++;
            if (CsTraverse.isPlumb(leg.shot)) { onPitches++; }
            if (firstBadNumber(cut.outline, "outline") !== null ||
                    firstBadNumber(cut.polygon, "polygon") !== null) {
                badCuts++;
            }
        }
    }
    ok(badCuts === 0,
        name + ": every cross section that was taken is finite (" +
        badCuts + " bad of " + cuts + ")");
    ok(cuts > 0, name + ": sections were taken at all (" + cuts + " cut, " +
        refused + " refused for want of evidence)");
    // A SECTION ON A PITCH IS THE POINT. This is the leg whose frame
    // degenerates -- world up lies along it, so the up-projection that
    // seeds the section plane goes to zero -- and the rotation-
    // minimizing frame in CsSectionCut exists for exactly this.
    ok(onPitches > 0,
        name + ": and " + onPitches + " of them were taken ON A PITCH, " +
        "where the section frame degenerates");
}

console.log("");
console.log("  " + checks + " checks, " + failures.length + " failed");
if (failures.length > 0) {
    console.log("");
    for (var fi = 0; fi < failures.length; fi++) {
        console.log("  " + failures[fi]);
    }
}
console.log(failures.length === 0 ?
    "\n### PLUMBLINE PIPELINE OK" :
    "\n### PLUMBLINE PIPELINE FAIL " + failures.length);
process.exit(failures.length === 0 ? 0 : 1);
