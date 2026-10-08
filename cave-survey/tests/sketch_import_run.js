// sketch_import_run.js -- a Therion scrap becomes real map ink.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/sketch_import_run.js "$PWD"
//
// The claim under test is the one the whole feature rests on: a .th2
// sketch does not arrive as a tracing reference, it arrives as ordinary
// CaveCAD entities on the ordinary feature layers, indistinguishable
// from hand-traced work except for the tags saying where they came
// from. So this drives CsSketchDraw against the REAL fixture
// (testdata/PitfallCave.th2) in a REAL document and then reads the
// document back, checking what landed rather than what was reported.
//
// What is checked: walls land on WALLS-SURVEYED and a presumed wall on
// WALLS-INFERRED; an invisible wall lands nowhere; the centreline in
// the sketch is not drawn over the surveyed one; a floor-step arrives
// as a dressed shaped line with real ornament; an area's fill is built
// and its border line is NOT also drawn on its own; symbols are real
// block references from the template, aimed and sized; every entity
// carries its scrap stamp; and an unrecognised type is kept rather
// than dropped.
//
// scripts/simple.js gives the REAL isNull(), for CsArea's own reason:
// doc.queryBlock() of a missing name comes back as a wrapped non-null
// object, and a hand-rolled shim would report a missing block as
// present.
include("scripts/simple.js");

createSpatialIndex = function() {
    return new RSpatialIndexNavel();
};

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var failures = [];
var passed = 0;
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol, what + " (expected " + b + " +/- " + tol +
        ", got " + a + ")");
}

// =======================================================================
// The fixture: a document on the template's layers, and the sketch.
// =======================================================================

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);

var templatePath = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
// The symbol blocks live in the template, not in a blank document.
// Pulled through the real import path, as tests/area_fill_run.js does.
var blocksNeeded = ["SYM_STALACTITE", "SYM_STALAGMITE", "SYM_ENTRANCE",
    "SYM_CONTINUATION", "AREA_STIPPLE"];
for (var bi = 0; bi < blocksNeeded.length; bi++) {
    var brought = CsSymbolStore.ensureBlock(doc, di, blocksNeeded[bi],
        templatePath);
    ok(brought.ok === true, "fixture: " + blocksNeeded[bi] +
        " imports from the template (" + brought.error + ")");
}

function readTextFile(path) {
    var file = new QFile(path);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + path);
    }
    var stream = new QTextStream(file);
    var content = stream.readAll();
    file.close();
    return content;
}

var sketch = CsTherion2.parse(
    readTextFile(repoRoot + "/testdata/PitfallCave.th2"));
ok(sketch.scraps.length === 5, "fixture: the sketch parsed");

var planScrap = null;
for (var si = 0; si < sketch.scraps.length; si++) {
    if (sketch.scraps[si].name === "plan1") {
        planScrap = sketch.scraps[si];
    }
}
ok(planScrap !== null, "fixture: the plan scrap is there");

// The stations the sketch ties to, at the positions this drawing puts
// them. Taken straight from the fixture's own scrap coordinates scaled
// by two and shifted, so the fit is exact and every assertion below is
// about what was DRAWN rather than about how well it was placed --
// CsSketchPlace's own tests cover the placing.
var targets = {};
for (var ti = 0; ti < planScrap.stations.length; ti++) {
    var tie = planScrap.stations[ti];
    targets[tie.name] = { x: 1000 + tie.x * 2, y: 500 + tie.y * 2 };
}

var solution = CsSketchPlace.solve(planScrap, targets, {});
ok(solution.ok, "fixture: the plan scrap places");
near(solution.residual.worst, 0, 1e-6,
    "fixture: and lands exactly, so what follows is about the drawing");

// =======================================================================
// Draw it.
// =======================================================================

var report = CsSketchDraw.scrap(doc, di, planScrap, solution,
    { file: "PitfallCave.th2" });

function onLayer(name) {
    if (!doc.hasLayer(name)) {
        return [];
    }
    return doc.queryLayerEntities(doc.getLayerId(name), true);
}
function countOn(name) {
    return onLayer(name).length;
}
// WHAT THIS IMPORT PUT THERE, not what is on the layer. Importing the
// template's symbol blocks brings some of the template's own sample
// geometry onto the catalogue layers with it, so a raw count on
// FORMATIONS-DRIP answers 4 where this import drew 2. The scrap stamp
// is the whole point of stamping: it says which ink is ours.
function ours(name) {
    var ids = onLayer(name);
    var mine = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (CsTags.get(e, CsSketchDraw.KEY.FILE) === "PitfallCave.th2") {
            mine.push(e);
        }
    }
    return mine;
}
function ourType(name, type) {
    var mine = ours(name);
    for (var i = 0; i < mine.length; i++) {
        if (CsTags.get(mine[i], CsSketchDraw.KEY.TYPE) === type) {
            return mine[i];
        }
    }
    return null;
}
function firstOn(name) {
    var ids = onLayer(name);
    return ids.length === 0 ? null : doc.queryEntity(ids[0]);
}

// -- walls ---------------------------------------------------------------
eqs(ours(CsLayers.WALLS_SURVEYED).length, 1,
    "one plain wall lands on WALLS-SURVEYED");
eqs(ours(CsLayers.WALLS_INFERRED).length, 1,
    "a -subtype presumed wall lands on WALLS-INFERRED -- the distinction " +
    "between measured and guessed passage survives the import");

// The invisible wall is in the file, between the same two points as the
// presumed one's end. It must be nowhere: Therion draws nothing for it,
// and it is there to close an area, not to be seen.
eqs(ours(CsLayers.WALLS_SURVEYED).length +
        ours(CsLayers.WALLS_INFERRED).length, 2,
    "an invisible wall is read, counted and NOT drawn");
ok(report.skipped >= 2,
    "the skipped count covers the invisible wall and the centreline");

// -- the centreline is not traced over -----------------------------------
// The sketch carries its own "line survey" copy of the centreline. The
// drawing already has the measured one.
eqs(ours(CsLayers.CTRL_SHOTS).length, 0,
    "the sketch's own copy of the centreline is not drawn: the survey " +
    "came in as measurements, and a hand-drawn second opinion about " +
    "where the cave is would sit on top of it");

// -- shaped lines --------------------------------------------------------
eqs(report.shapes, 1, "the pit arrives as a shaped line");
var spineIds = onLayer(CsLayers.LEDGE_FLOOR);
ok(spineIds.length > 1,
    "a dressed pit is a spine AND its ornament, not a bare line (" +
    spineIds.length + " entities on LEDGE-FLOOR)");
var dressedSpine = null;
for (var pi = 0; pi < spineIds.length; pi++) {
    var candidate = doc.queryEntity(spineIds[pi]);
    if (CsTags.get(candidate, CsShapeLine.KEY.STYLE) === "pit") {
        dressedSpine = candidate;
    }
}
ok(dressedSpine !== null,
    "the spine carries the shaped-line style tag, so Shaped Lines will " +
    "regrow its ornament on every later edit exactly as it does for a " +
    "hand-drawn one");
ok(CsTags.get(dressedSpine, CsShapeLine.KEY.ID) !== "",
    "and its own shape id");

// -- areas ---------------------------------------------------------------
eqs(report.areas, 1, "the water area is built");
var boundaryIds = onLayer(CsArea.CATALOG.WATER.boundaryLayer);
ok(boundaryIds.length >= 1, "the area has a boundary in the drawing");
var boundary = null;
for (var ai = 0; ai < boundaryIds.length; ai++) {
    var maybe = doc.queryEntity(boundaryIds[ai]);
    if (CsTags.get(maybe, CsArea.ID_KEY) !== "") {
        boundary = maybe;
    }
}
ok(boundary !== null, "and it is tagged as an area boundary");
eqs(CsTags.get(boundary, CsArea.PATTERN_KEY), "WATER",
    "with the pattern the sketch asked for");

// The border line the area claims must NOT also be drawn on its own:
// drawing both would put a line on top of every area edge, which is
// exactly the duplicate a caver would spend an evening selecting out.
eqs(ours(CsLayers.CTRL_AREA_BOUNDARY).length, 0,
    "the border line an area claims is not ALSO drawn on its own");

// -- symbols -------------------------------------------------------------
eqs(report.symbols, 4,
    "the stalactite, stalagmite, entrance and continuation are placed");
eqs(ours("FORMATIONS-DRIP").length, 2,
    "the two drip formations are real block references on the " +
    "catalogue's own layer");

var aimed = ourType("FORMATIONS-DRIP", "stalactite");
ok(aimed !== null, "the stalactite is findable by the type it arrived as");
// -scale l is 1.5 native, and the fit doubles everything: a symbol's
// size on the map is the sketch's own word for it TIMES how much
// bigger the drawing is than the scrap.
near(aimed.getScaleFactors().x, 1.5 * 2, 1e-6,
    "and is sized by the sketch's -scale through the fit, not placed " +
    "native and left small");
ok(ourType("ENTRANCE", "entrance") !== null,
    "the entrance symbol lands on ENTRANCE");

// -- text and marks ------------------------------------------------------
ok(report.texts >= 1, "the label arrives as text");
var labels = ours(CsLayers.TEXT_LABELS);
eqs(labels.length, 1, "on TEXT-LABELS");
var label = labels[0];
eqs(String(label.getPlainText()), "THE PINCH",
    "lettered in upper case, the convention every tool here follows");

eqs(report.callouts, 1,
    "an altitude arrives as a callout, so its note stays text-editable");

eqs(ours(CsLayers.NOTES_DIG).length, 1,
    "a continuation -- a lead -- lands as the Continuation symbol on " +
    "NOTES-DIG rather than being dropped");

// -- unknown types -------------------------------------------------------
ok(report.unknown.length >= 2,
    "the caver's own u: types are reported by name (" +
    report.unknown.join(", ") + ")");
ok(ours(CsLayers.NOTES_ANNOTATION).length >= 1,
    "and kept on the catch-all layer -- a sketch arriving without its " +
    "walls over one unrecognised word is the worse failure");

// -- the stamp -----------------------------------------------------------
var wall = ours(CsLayers.WALLS_SURVEYED)[0];
eqs(CsTags.get(wall, CsSketchDraw.KEY.FILE), "PitfallCave.th2",
    "every entity says which file it came from");
eqs(CsTags.get(wall, CsSketchDraw.KEY.SCRAP), "plan1",
    "and which scrap");
eqs(CsTags.get(wall, CsSketchDraw.KEY.TYPE), "wall",
    "and what Therion called it -- not what this release decided to " +
    "draw it as, because that mapping will change");
ok(CsTags.get(wall, CsSketchDraw.KEY.INDEX) !== "",
    "and where in the scrap it sat, so a re-import can find it again");

// -- it is ordinary linework ----------------------------------------------
// The claim that makes all of this worth doing: what landed can be
// extended by the same hand tools that extend a traced wall.
var control = CsTrace.controlPointsOf(wall);
ok(control !== null && control.length >= 2,
    "an imported wall reads back as an ordinary traced curve -- " +
    "CsTrace.controlPointsOf understands it, so Feature Trace can " +
    "extend it and CsWarp can bend it later");

// =======================================================================
// An EXTENDED scrap lands in the profile band, on the PROFILE- layers.
// =======================================================================
//
// The difference between a plan scrap and an extended one is entirely
// which stations it is fitted to and which layers its ink goes on. So
// this builds a real profile in a fresh document and imports the
// fixture's own ext1 page against it.

(function() {
    function shotOf(from, to, d, az, inc, u, dn) {
        var shot = CsModel.newShot();
        shot.from = from; shot.to = to; shot.distance = d;
        shot.azimuth = az; shot.inclination = inc || 0;
        shot.up = (u === undefined) ? null : u;
        shot.down = (dn === undefined) ? null : dn;
        return shot;
    }

    var survey = CsModel.newSurvey();
    survey.shots = [
        shotOf("A1", "A2", 30, 210, -10, 4, 2),
        shotOf("A2", "A3", 33, 223, -8, 4, 2)
    ];
    var resolved = CsNetwork.resolve(survey, {});

    var pdoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var pdi = new RDocumentInterface(pdoc);
    CsLayers.ensureSurveyLayers(pdoc, pdi);
    var profile = CsProfile.build(survey, resolved, {});
    var rendered = CsProfileDraw.render(pdoc, pdi, profile, {});
    ok(rendered.bandsDrawn >= 1, "extended: a profile band is drawn");

    var extScrap = null;
    for (var i = 0; i < sketch.scraps.length; i++) {
        if (sketch.scraps[i].name === "ext1") {
            extScrap = sketch.scraps[i];
        }
    }
    ok(extScrap !== null, "extended: the fixture has an extended scrap");

    var band = CsSketchStore.profileTargets(pdoc, extScrap);
    ok(band.runKey !== null,
        "extended: the scrap's stations are found in a drawn band");
    ok(band.runs >= 1, "extended: at least one run holds them");

    var extSolution = CsSketchPlace.solve(extScrap, band.targets, {});
    ok(extSolution.ok, "extended: and the page places on them");

    var extReport = CsSketchDraw.scrap(pdoc, pdi, extScrap, extSolution, {
        file: "PitfallCave.th2",
        layerFor: function(planLayer) {
            return CsLayers.twinFor(planLayer, "profile");
        }
    });

    function mineOn(name) {
        if (!pdoc.hasLayer(name)) {
            return 0;
        }
        var ids = pdoc.queryLayerEntities(pdoc.getLayerId(name), true);
        var n = 0;
        for (var k = 0; k < ids.length; k++) {
            if (CsTags.get(pdoc.queryEntity(ids[k]),
                    CsSketchDraw.KEY.FILE) === "PitfallCave.th2") {
                n++;
            }
        }
        return n;
    }

    eqs(extReport.lines, 1, "extended: the wall comes in");
    eqs(mineOn(CsLayers.twinFor(CsLayers.WALLS_SURVEYED, "profile")), 1,
        "extended: on the PROFILE- twin of the wall layer, never on the " +
        "plan's own -- a profile wall drawn onto the plan layer would " +
        "sit on the map as a wall nobody surveyed there");
    eqs(mineOn(CsLayers.WALLS_SURVEYED), 0,
        "extended: and nothing of it lands in the plan");

    eqs(extReport.shapes, 1, "extended: the floor step is dressed");
    eqs(mineOn(CsLayers.twinFor(CsLayers.LEDGE_FLOOR, "profile")), 1,
        "extended: its spine on the profile twin too");
}());

// =======================================================================
// Report.
// =======================================================================

var out;
if (failures.length === 0) {
    out = "### SKETCH IMPORT OK " + passed + " assertions";
} else {
    out = "### SKETCH IMPORT FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var xi = 0; xi < failures.length; xi++) {
        out += "  FAIL: " + failures[xi] + "\n";
    }
}
print(out);
