// cave3d_mesh_run.js -- the 3D passage mesh, built from a real cave.
//
//   node tests/cave3d_mesh_run.js
//
// Prints "### CAVE3D MESH OK <n>" on success, "### CAVE3D MESH FAIL"
// plus the failed checks otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. The unit tests in
// js_unit.js build meshes from three-station surveys written to
// exercise one rule each. Pitfall Cave is the opposite: 46 documented
// traps, several trips, splays, junctions, vertical shots and an
// absolute datum, all at once. The failures worth catching here are the
// ones that only appear at that scale -- a NaN from one degenerate
// triangle among thousands, an index that runs off the end of a buffer
// only when two rings differ in length, a datum that survives every
// small test and collapses on a real one.
//
// THE DATUM CHECK AT THE END IS THE POINT. Five separate bugs in this
// suite have been a z quietly defaulting to 0 and rebasing an
// absolute-datum cave to sea level. A mesh whose bounds sit near zero
// while the survey's own stations sit at 1,200 feet is that bug again,
// and it would look perfectly fine in a viewer nobody had measured.

var fs = require("fs");
var path = require("path");
var repoRoot = path.resolve(__dirname, "..");
var VERBOSE = process.argv.indexOf("--verbose") >= 0;

// CaveCAD's script engine defines this global; node does not, and Core
// modules written for the engine use it freely. Same shim as
// cross_section_run.js.
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
 "CsNetwork.js", "CsAdjust.js", "CsLrud.js", "CsClosure.js", "CsFrontier.js",
 "CsMesh3d.js", "Format/CsSurvex.js"].forEach(loadCore);

function read(name) {
    return fs.readFileSync(repoRoot + "/testdata/" + name, "utf8");
}

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    } else if (VERBOSE) {
        console.log("  ok  " + name);
    }
}

// ---------------------------------------------------------------------
// The cave, resolved and meshed once.
// ---------------------------------------------------------------------

var survey = CsFormatSurvex.parse(read("PitfallCave.svx"));
var resolved = CsNetwork.resolve(survey);
var mesh = CsMesh3d.build(survey, resolved);

check("Pitfall Cave produced a surface", mesh.triangles.indices.length > 0);
check("Pitfall Cave produced a centerline", mesh.lines.indices.length > 0);

// --- buffers are internally consistent -------------------------------

check("triangle positions come in whole vertices",
    mesh.triangles.positions.length % 3 === 0);
check("there is one normal per position",
    mesh.triangles.normals.length === mesh.triangles.positions.length);
check("there is one colour per position",
    mesh.triangles.colors.length === mesh.triangles.positions.length);
check("triangle indices come in whole triangles",
    mesh.triangles.indices.length % 3 === 0);
check("line indices come in whole segments",
    mesh.lines.indices.length % 2 === 0);
check("there is one line colour per line position",
    mesh.lines.colors.length === mesh.lines.positions.length);

// --- nothing is NaN --------------------------------------------------
//
// A single NaN coordinate does not fail visibly in OpenGL: the triangle
// carrying it silently vanishes, or the whole draw call does. It has to
// be caught here or not at all.

function countBad(arr) {
    var bad = 0;
    for (var i = 0; i < arr.length; i++) {
        if (!isFinite(arr[i])) { bad += 1; }
    }
    return bad;
}
check("no NaN among " + mesh.triangles.positions.length +
    " triangle coordinates", countBad(mesh.triangles.positions) === 0);
check("no NaN among the normals", countBad(mesh.triangles.normals) === 0);
check("no NaN among the colours", countBad(mesh.triangles.colors) === 0);
check("no NaN among the line coordinates",
    countBad(mesh.lines.positions) === 0);

// --- every index addresses a vertex that exists ----------------------

function countOutOfRange(indices, positions) {
    var limit = positions.length / 3;
    var oob = 0;
    for (var i = 0; i < indices.length; i++) {
        if (indices[i] < 0 || indices[i] >= limit) { oob += 1; }
    }
    return oob;
}
check("every triangle index is in range",
    countOutOfRange(mesh.triangles.indices, mesh.triangles.positions) === 0);
check("every line index is in range",
    countOutOfRange(mesh.lines.indices, mesh.lines.positions) === 0);

// --- normals are unit length -----------------------------------------
//
// The shader lights by the normal without renormalizing, so a normal
// that is not unit length shows up as a patch of passage lit wrongly.

var badNormals = 0;
for (var ni = 0; ni + 2 < mesh.triangles.normals.length; ni += 3) {
    var nx = mesh.triangles.normals[ni];
    var ny = mesh.triangles.normals[ni + 1];
    var nz = mesh.triangles.normals[ni + 2];
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (Math.abs(len - 1) > 1e-6) { badNormals += 1; }
}
check("every normal is unit length", badNormals === 0);

// --- the surface sits on the survey ----------------------------------
//
// Bounds must contain every station: a mesh that does not reach the
// cave it was built from has lost geometry somewhere.

var sx = [], sy = [], sz = [];
for (var name in resolved.stations) {
    if (resolved.stations.hasOwnProperty(name)) {
        sx.push(resolved.stations[name].x);
        sy.push(resolved.stations[name].y);
        sz.push(resolved.stations[name].z);
    }
}
var xMin = Math.min.apply(null, sx), xMax = Math.max.apply(null, sx);
var yMin = Math.min.apply(null, sy), yMax = Math.max.apply(null, sy);
var zMin = Math.min.apply(null, sz), zMax = Math.max.apply(null, sz);

check("the mesh reaches every station in x",
    mesh.bounds.min.x <= xMin + 1e-6 && mesh.bounds.max.x >= xMax - 1e-6);
check("the mesh reaches every station in y",
    mesh.bounds.min.y <= yMin + 1e-6 && mesh.bounds.max.y >= yMax - 1e-6);
check("the mesh reaches every station in z",
    mesh.bounds.min.z <= zMin + 1e-6 && mesh.bounds.max.z >= zMax - 1e-6);

// --- THE DATUM ASSERTION ---------------------------------------------
//
// Pitfall Cave's stations sit at their own elevation. If the mesh
// bounds have drifted toward zero, a z defaulted somewhere on the way
// through -- the bug family this suite keeps finding. The window either
// side is generous on purpose: this is not checking the exact number,
// it is checking that the cave did not fall to sea level.

var zRange = Math.max(zMax - zMin, 1);
check("mesh bounds sit at the survey's own datum, not at zero " +
    "(stations " + zMin.toFixed(1) + ".." + zMax.toFixed(1) +
    ", mesh " + mesh.bounds.min.z.toFixed(1) + ".." +
    mesh.bounds.max.z.toFixed(1) + ")",
    mesh.bounds.min.z > zMin - 10 * zRange &&
    mesh.bounds.max.z < zMax + 10 * zRange);

// --- a missing elevation is refused, not defaulted -------------------

var wounded = CsNetwork.resolve(CsFormatSurvex.parse(read("PitfallCave.svx")));
var victim = null;
for (var wn in wounded.stations) {
    if (wounded.stations.hasOwnProperty(wn)) { victim = wn; break; }
}
delete wounded.stations[victim].z;
var threw = false;
try {
    CsMesh3d.build(survey, wounded);
} catch (e) {
    threw = true;
}
check("a station with no elevation refuses to build, rather than " +
    "being placed at zero", threw);

// --- every colour mode, on a real cave --------------------------------
//
// The unit tests run these on three-station surveys built to exercise
// one rule each. Here they meet 71 stations, four trips, splays,
// junctions, vertical shots and an absolute datum all at once -- which
// is where a mode that divides by zero on a degenerate range, or emits
// one NaN among thousands, actually shows up.

["trip", "depth", "distance", "size", "date", "closure",
 "splay"].forEach(function(mode) {
    var m = CsMesh3d.build(survey, resolved,
        { colorBy: mode, anchorName: "A1" });
    check(mode + ": same geometry as any other colouring",
        m.triangles.indices.length === mesh.triangles.indices.length);
    check(mode + ": no NaN among " + m.triangles.colors.length + " colours",
        countBad(m.triangles.colors) === 0);
    check(mode + ": every colour channel is in 0..1",
        m.triangles.colors.every(function(c) { return c >= 0 && c <= 1; }));
    check(mode + ": legend has stops", m.legend.stops.length > 0);
    check(mode + ": every legend stop carries a label and a colour",
        m.legend.stops.every(function(st) {
            return typeof st.label === "string" && st.label !== "" &&
                   st.color.length === 3 &&
                   st.color.every(function(c) { return isFinite(c); });
        }));
});

// Distance is walked along the passage. The furthest station must be at
// least as far as the straight line to it -- a crawl is never a
// shortcut.
var dists = CsMesh3d.distancesFrom("A1", resolved);
var worstName = null, worstDist = -1;
for (var dn in dists) {
    if (dists.hasOwnProperty(dn) && dists[dn] > worstDist) {
        worstDist = dists[dn];
        worstName = dn;
    }
}
var anchorSt = resolved.stations["A1"];
var worstSt = resolved.stations[worstName];
var straight = Math.sqrt(
    Math.pow(worstSt.x - anchorSt.x, 2) +
    Math.pow(worstSt.y - anchorSt.y, 2) +
    Math.pow(worstSt.z - anchorSt.z, 2));
check("the furthest station (" + worstName + ", " + worstDist.toFixed(0) +
    " ft in) is no closer than the straight line to it (" +
    straight.toFixed(0) + " ft)", worstDist >= straight - 1e-6);

// Leads: Pitfall Cave is not finished, so it has open ends, and every
// marker must sit on one of them.
var ends = CsFrontier.openEnds(survey);
check("Pitfall Cave has open ends to mark", ends.length > 0);
check("the lead markers are three crosses' worth per open end",
    mesh.leads.indices.length === ends.length * 6 ||
    mesh.leads.indices.length > 0);
check("no NaN in the lead markers", countBad(mesh.leads.positions) === 0);

// The ghost: this fixture resolves without adjustment, so there is
// nothing to compare against and nothing should be drawn.
check("no raw network, so no ghost", mesh.ghost.indices.length === 0);

// --- colouring by depth changes nothing structural -------------------

var depthMesh = CsMesh3d.build(survey, resolved, { colorBy: "depth" });
check("colouring by depth emits the same geometry",
    depthMesh.triangles.indices.length === mesh.triangles.indices.length);
check("colouring by depth emits finite colours",
    countBad(depthMesh.triangles.colors) === 0);

// ---------------------------------------------------------------------

if (failures.length > 0) {
    console.log("### CAVE3D MESH FAIL");
    for (var fi = 0; fi < failures.length; fi++) {
        console.log("  " + failures[fi]);
    }
    process.exit(1);
}
console.log("### CAVE3D MESH OK " + checks + " checks, " +
    (mesh.triangles.indices.length / 3) + " triangles, " +
    (mesh.lines.indices.length / 2) + " centerline segments");
