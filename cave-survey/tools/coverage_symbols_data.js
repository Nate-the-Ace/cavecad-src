// coverage_symbols_data.js -- geometry for the symbols the 2026-10 coverage
// audit added (docs/symbol-coverage-audit.md). PLAIN DATA, no engine calls,
// so tools/make_rigging_symbols.js (QCAD) and tools/preview_symbols.js (node)
// read the same file and a contact sheet can be drawn without CaveCAD.
//
// Same primitive vocabulary and the same rules as the rigging set:
//
//   ["line", x1, y1, x2, y2]
//   ["circle", cx, cy, r]
//   ["arc", cx, cy, r, startDeg, endDeg]        counter-clockwise
//
// Origin (0,0) is the point a caver would CLICK. Sizes sit in the shipped
// 0.3 - 1.5 unit range. Each symbol's layer and category come from
// CsSymbols.CATALOG, not from here.

var COVERAGE = {};

// A closed polygon from a flat [x,y, x,y, ...] list, as lines.
function poly(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i += 2) {
        var j = (i + 2) % pts.length;
        out.push(["line", pts[i], pts[i + 1], pts[j], pts[j + 1]]);
    }
    return out;
}
// An open polyline.
function path(pts) {
    var out = [];
    for (var i = 0; i + 3 < pts.length; i += 2) {
        out.push(["line", pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]);
    }
    return out;
}
function cat() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
        out = out.concat(arguments[i]);
    }
    return out;
}

// ---- BIOLOGY ---------------------------------------------------------

// A bat: two scalloped wings off a small body.
COVERAGE.SYM_BAT = cat(
    [["circle", 0, 0, 0.07]],
    path([-0.07, 0.03, -0.18, 0.2, -0.3, 0.08, -0.42, 0.16, -0.52, -0.06]),
    path([0.07, 0.03, 0.18, 0.2, 0.3, 0.08, 0.42, 0.16, 0.52, -0.06]),
    path([-0.52, -0.06, -0.36, 0.0, -0.22, -0.1, -0.07, -0.05]),
    path([0.52, -0.06, 0.36, 0.0, 0.22, -0.1, 0.07, -0.05]));

// A root hanging into the cave: a trunk that forks as it falls.
COVERAGE.SYM_ROOT = cat(
    path([0, 0.5, 0, 0.0, -0.1, -0.22]),
    path([0, 0.34, -0.2, 0.18]),
    path([0, 0.22, 0.2, 0.06, 0.26, -0.14]),
    path([0, 0.08, 0.12, -0.12]));

// A tree trunk lying in the passage, seen end-on: growth rings.
COVERAGE.SYM_TREE_TRUNK = [
    ["circle", 0, 0, 0.32], ["circle", 0, 0, 0.2], ["circle", 0, 0, 0.08],
    ["line", 0, 0, 0.32, 0]];

// Washed-in sticks and leaf litter: three crossed twigs.
COVERAGE.SYM_VEGETABLE_DEBRIS = cat(
    path([-0.36, -0.1, 0.34, 0.12]),
    path([-0.3, 0.16, 0.3, -0.16]),
    path([-0.1, -0.22, 0.12, 0.24]),
    [["circle", 0.34, 0.12, 0.03]]);

// A seed that has sprouted: the seed, a stem, two leaves.
COVERAGE.SYM_SEED_GERMINATION = [
    ["circle", 0, -0.08, 0.09],
    ["line", 0, 0.01, 0, 0.36],
    ["arc", -0.1, 0.3, 0.1, -60, 90],
    ["arc", 0.1, 0.3, 0.1, 90, 240]];

// ---- ARCHAEOLOGY -----------------------------------------------------

// An excavation: a trench outline with hatching.
COVERAGE.SYM_ARCHEO_EXCAVATION = cat(
    poly([-0.36, -0.26, 0.36, -0.26, 0.36, 0.26, -0.36, 0.26]),
    path([-0.36, -0.1, -0.2, 0.26]),
    path([-0.2, -0.26, 0.04, 0.26]),
    path([0.04, -0.26, 0.28, 0.26]),
    path([0.24, -0.26, 0.36, 0.0]));

// Worked material (a sherd, a tool): an angular shard with a dot.
COVERAGE.SYM_ARCHEO_MATERIAL = cat(
    poly([-0.3, -0.18, 0.12, -0.26, 0.34, 0.08, -0.06, 0.28]),
    [["circle", 0.0, 0.0, 0.035]]);

// Fossil or ancient natural remains: a coil.
COVERAGE.SYM_PALEO_MATERIAL = [
    ["arc", 0, 0, 0.3, 0, 300],
    ["arc", 0.03, 0, 0.19, 20, 320],
    ["arc", 0.05, 0, 0.09, 40, 340],
    ["line", 0.3, 0, 0.44, 0.08]];

// Animal bones: one long bone, knuckled at both ends.
COVERAGE.SYM_BONES = [
    ["line", -0.3, -0.12, 0.3, 0.12],
    ["circle", -0.34, -0.06, 0.06], ["circle", -0.26, -0.2, 0.06],
    ["circle", 0.34, 0.06, 0.06], ["circle", 0.26, 0.2, 0.06]];

// Human remains: a skull over crossed bones.
COVERAGE.SYM_HUMAN_BONES = [
    ["circle", 0, 0.12, 0.2],
    ["circle", -0.07, 0.15, 0.04], ["circle", 0.07, 0.15, 0.04],
    ["line", -0.06, 0.04, 0.06, 0.04],
    ["line", -0.3, -0.34, 0.3, -0.12], ["line", -0.3, -0.12, 0.3, -0.34]];

// Masonry: courses of bricks.
COVERAGE.SYM_MASONRY = cat(
    poly([-0.36, -0.24, 0.36, -0.24, 0.36, 0.24, -0.36, 0.24]),
    path([-0.36, 0.0, 0.36, 0.0]),
    path([-0.1, 0.0, -0.1, 0.24]),
    path([0.16, 0.0, 0.16, 0.24]),
    path([-0.22, -0.24, -0.22, 0.0]),
    path([0.04, -0.24, 0.04, 0.0]),
    path([0.26, -0.24, 0.26, 0.0]));

// An altar: a slab on two supports.
COVERAGE.SYM_ALTAR = cat(
    poly([-0.34, 0.04, 0.34, 0.04, 0.34, 0.14, -0.34, 0.14]),
    path([-0.24, 0.04, -0.24, -0.22]),
    path([0.24, 0.04, 0.24, -0.22]));

// An offering left in a cave (ex-voto): a cross in a ring.
COVERAGE.SYM_EX_VOTO = [
    ["circle", 0, 0, 0.26],
    ["line", 0, -0.18, 0, 0.18], ["line", -0.12, 0.06, 0.12, 0.06]];

// ---- HAZARDS ---------------------------------------------------------

// Danger: warning triangle with an exclamation mark.
COVERAGE.SYM_DANGER = cat(
    poly([-0.34, -0.24, 0.34, -0.24, 0.0, 0.36]),
    [["line", 0, -0.08, 0, 0.18], ["circle", 0, -0.16, 0.025]]);

// A dig: the pick.
COVERAGE.SYM_DIG = [
    ["line", 0, -0.34, 0, 0.3],
    ["arc", 0, 0.12, 0.3, 20, 160],
    ["line", -0.28, 0.22, -0.3, 0.1], ["line", 0.28, 0.22, 0.3, 0.1]];

// Air draught: an arrow with feathered tail ticks.
COVERAGE.SYM_AIR_DRAUGHT = [
    ["line", -0.5, 0, 0.5, 0],
    ["line", 0.5, 0, 0.36, 0.1], ["line", 0.5, 0, 0.36, -0.1],
    ["line", -0.5, 0, -0.62, 0.1], ["line", -0.4, 0, -0.52, 0.1],
    ["line", -0.5, 0, -0.62, -0.1], ["line", -0.4, 0, -0.52, -0.1]];

// ---- PASSAGE ENDS ----------------------------------------------------

// A way on, unsurveyed: a question mark.
COVERAGE.SYM_CONTINUATION = [
    ["arc", 0, 0.34, 0.17, -60, 180],
    ["line", 0.085, 0.253, 0, 0.1],
    ["line", 0, 0.1, 0, 0.04],
    ["circle", 0, -0.04, 0.03]];

// Passage ends because the ceiling comes down to the floor.
COVERAGE.SYM_LOW_END = [
    ["line", 0.2, 0.3, 0.2, -0.3],
    ["line", -0.3, 0.2, 0.2, 0.2],
    ["line", -0.3, 0.0, 0.2, 0.0],
    ["line", -0.3, -0.2, 0.2, -0.2]];

// Passage ends because the walls close in.
COVERAGE.SYM_NARROW_END = [
    ["line", -0.34, 0.3, 0.1, 0.03],
    ["line", -0.34, -0.3, 0.1, -0.03],
    ["line", 0.1, 0.05, 0.1, -0.05],
    ["line", 0.1, 0.0, 0.3, 0.0]];

// Blocked by breakdown: an end bar and the stones filling the passage.
COVERAGE.SYM_BREAKDOWN_CHOKE = cat(
    [["line", 0.3, 0.32, 0.3, -0.32]],
    poly([-0.3, 0.1, -0.12, 0.2, -0.04, 0.02, -0.22, -0.06]),
    poly([-0.04, -0.12, 0.12, -0.04, 0.08, -0.24, -0.1, -0.26]),
    poly([0.0, 0.24, 0.18, 0.28, 0.2, 0.1, 0.04, 0.08]));

// Blocked by clay: the end bar and sediment ticks.
COVERAGE.SYM_CLAY_CHOKE = [
    ["line", 0.3, 0.32, 0.3, -0.32],
    ["line", -0.3, 0.2, -0.16, 0.2], ["line", -0.06, 0.2, 0.08, 0.2],
    ["line", -0.22, 0.0, -0.08, 0.0], ["line", 0.04, 0.0, 0.18, 0.0],
    ["line", -0.3, -0.2, -0.16, -0.2], ["line", -0.06, -0.2, 0.08, -0.2]];

// Blocked by flowstone: the end bar and sheeting curves.
COVERAGE.SYM_FLOWSTONE_CHOKE = [
    ["line", 0.3, 0.32, 0.3, -0.32],
    ["arc", -0.2, 0.18, 0.14, 180, 360], ["arc", 0.08, 0.18, 0.14, 180, 360],
    ["arc", -0.2, -0.08, 0.14, 180, 360], ["arc", 0.08, -0.08, 0.14, 180, 360]];

// ---- FORMATIONS ------------------------------------------------------

// Helictite: a stone that grows sideways in curls.
COVERAGE.SYM_HELICTITE = [
    ["line", 0, 0.4, 0, 0.2],
    ["arc", 0.1, 0.2, 0.1, 90, 270],
    ["arc", 0.1, 0.0, 0.1, 270, 450],
    ["arc", 0.1, -0.2, 0.1, 90, 250]];

// Soda straw: a thin hollow tube hanging from the ceiling.
COVERAGE.SYM_SODA_STRAW = [
    ["line", -0.04, 0.5, -0.04, -0.3], ["line", 0.04, 0.5, 0.04, -0.3],
    ["arc", 0, -0.3, 0.04, 180, 360],
    ["line", -0.2, 0.5, 0.2, 0.5]];

// Pendant: a short blunt knob hanging from the ceiling.
COVERAGE.SYM_PENDANT = [
    ["line", -0.22, 0.3, 0.22, 0.3],
    ["line", -0.16, 0.3, -0.14, 0.0], ["line", 0.16, 0.3, 0.14, 0.0],
    ["arc", 0, 0.0, 0.14, 180, 360]];

// Cave pearls: round stones that grew in a pool.
COVERAGE.SYM_CAVE_PEARL = [
    ["circle", -0.14, 0.08, 0.1], ["circle", 0.12, 0.1, 0.08],
    ["circle", 0.0, -0.12, 0.09], ["circle", -0.14, 0.08, 0.04]];

// Crystal: a faceted prism.
COVERAGE.SYM_CRYSTAL = cat(
    poly([0, 0.34, 0.2, 0.0, 0, -0.34, -0.2, 0.0]),
    path([0, 0.34, 0, -0.34]),
    path([-0.2, 0, 0.2, 0]));

// Aragonite: needles radiating from one point.
COVERAGE.SYM_ARAGONITE = [
    ["line", 0, 0, 0, 0.36], ["line", 0, 0, 0.3, 0.2], ["line", 0, 0, 0.3, -0.2],
    ["line", 0, 0, 0, -0.36], ["line", 0, 0, -0.3, -0.2], ["line", 0, 0, -0.3, 0.2],
    ["circle", 0, 0, 0.04]];

// Gypsum: a crust of short parallel blades.
COVERAGE.SYM_GYPSUM = [
    ["line", -0.28, -0.2, -0.12, 0.2], ["line", -0.12, -0.2, 0.04, 0.2],
    ["line", 0.04, -0.2, 0.2, 0.2], ["line", 0.2, -0.2, 0.32, 0.12]];

// Gypsum flower: a curl of gypsum growing off the wall.
COVERAGE.SYM_GYPSUM_FLOWER = [
    ["line", 0, -0.3, 0, -0.02],
    ["arc", 0.0, 0.1, 0.12, 180, 360], ["arc", -0.12, 0.1, 0.12, 270, 450],
    ["arc", 0.12, 0.1, 0.12, 90, 270]];

// Volcano: a stalagmite with a crater holding a drop.
COVERAGE.SYM_VOLCANO = [
    ["line", -0.3, -0.26, -0.1, 0.14], ["line", 0.3, -0.26, 0.1, 0.14],
    ["line", -0.3, -0.26, 0.3, -0.26],
    ["arc", 0, 0.14, 0.1, 0, 180], ["arc", 0, 0.14, 0.1, 180, 360]];

// Clay tree: a clay stalagmite capped with a boulder.
COVERAGE.SYM_CLAY_TREE = [
    ["line", -0.06, -0.3, -0.06, 0.1], ["line", 0.06, -0.3, 0.06, 0.1],
    ["line", -0.2, -0.3, 0.2, -0.3],
    ["circle", 0, 0.2, 0.12]];

// ---- DISSOLUTION AND WALL RELIEF ------------------------------------

// Scallops: overlapping shallow cups cut by flowing water.
COVERAGE.SYM_SCALLOP = [
    ["arc", -0.2, 0.1, 0.18, 200, 340], ["arc", 0.2, 0.1, 0.18, 200, 340],
    ["arc", 0.0, -0.14, 0.18, 200, 340]];

// Flutes: vertical channels running down a wall.
COVERAGE.SYM_FLUTE = [
    ["line", -0.2, 0.3, -0.2, -0.3], ["line", 0.0, 0.3, 0.0, -0.3],
    ["line", 0.2, 0.3, 0.2, -0.3],
    ["arc", -0.1, 0.3, 0.1, 0, 180], ["arc", 0.1, 0.3, 0.1, 0, 180]];

// Karren: rock fretted into sharp ridges.
COVERAGE.SYM_KARREN = cat(
    path([-0.34, -0.14, -0.2, 0.14, -0.06, -0.14, 0.08, 0.14, 0.22, -0.14,
        0.34, 0.1]),
    path([-0.3, -0.26, 0.3, -0.26]));

// Anastomosis: channels in the ceiling that split and rejoin.
COVERAGE.SYM_ANASTOMOSIS = [
    ["arc", 0, 0, 0.3, 20, 160], ["arc", 0, 0, 0.3, 200, 340],
    ["arc", 0, 0, 0.14, 20, 160], ["arc", 0, 0, 0.14, 200, 340],
    ["line", -0.3, 0, -0.14, 0], ["line", 0.14, 0, 0.3, 0]];

// ---- EQUIPMENT -------------------------------------------------------

// A bridge: planks laid across a gap.
COVERAGE.SYM_BRIDGE = cat(
    poly([-0.5, -0.1, 0.5, -0.1, 0.5, 0.1, -0.5, 0.1]),
    path([-0.3, -0.1, -0.3, 0.1]), path([-0.1, -0.1, -0.1, 0.1]),
    path([0.1, -0.1, 0.1, 0.1]), path([0.3, -0.1, 0.3, 0.1]));

// A walkway: a track with a rail on one side.
COVERAGE.SYM_WALKWAY = [
    ["line", -0.5, -0.08, 0.5, -0.08], ["line", -0.5, 0.08, 0.5, 0.08],
    ["line", -0.5, 0.08, -0.5, 0.2], ["line", 0.0, 0.08, 0.0, 0.2],
    ["line", 0.5, 0.08, 0.5, 0.2], ["line", -0.5, 0.2, 0.5, 0.2]];

// A handrail: a line on posts.
COVERAGE.SYM_HANDRAIL = [
    ["line", -0.5, 0, 0.5, 0],
    ["circle", -0.5, 0, 0.05], ["circle", 0.0, 0, 0.05],
    ["circle", 0.5, 0, 0.05]];

// Steps cut or built into a slope.
COVERAGE.SYM_STEPS = path([-0.3, -0.3, -0.1, -0.3, -0.1, -0.1, 0.1, -0.1,
    0.1, 0.1, 0.3, 0.1, 0.3, 0.3]);

// A fixed ladder: straight rails bolted to the rock (a cable ladder's
// are wavy).
COVERAGE.SYM_FIXED_LADDER = [
    ["line", -0.1, 0.5, -0.1, -0.5], ["line", 0.1, 0.5, 0.1, -0.5],
    ["line", -0.1, 0.34, 0.1, 0.34], ["line", -0.1, 0.18, 0.1, 0.18],
    ["line", -0.1, 0.02, 0.1, 0.02], ["line", -0.1, -0.14, 0.1, -0.14],
    ["line", -0.1, -0.3, 0.1, -0.3]];

// A gate across the passage.
COVERAGE.SYM_GATE = cat(
    poly([-0.34, -0.22, 0.34, -0.22, 0.34, 0.22, -0.34, 0.22]),
    path([-0.34, -0.22, 0.34, 0.22]),
    path([-0.34, 0.22, 0.34, -0.22]));

// A camp: the tent.
COVERAGE.SYM_CAMP = cat(
    poly([-0.34, -0.22, 0.34, -0.22, 0.0, 0.3]),
    path([0.0, 0.3, 0.0, -0.22]));

// A name plate or survey tag fixed to the wall.
COVERAGE.SYM_NAMEPLATE = cat(
    poly([-0.3, -0.14, 0.3, -0.14, 0.3, 0.14, -0.3, 0.14]),
    path([-0.2, 0.04, 0.2, 0.04]), path([-0.2, -0.06, 0.1, -0.06]));

if (typeof module !== "undefined") {
    module.exports = COVERAGE;
}
