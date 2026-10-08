// repair_drawing_run.js -- CsRepair against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/repair_drawing_run.js "$PWD"
//
// Prints "### REPAIR DRAWING OK <n>" or "### REPAIR DRAWING FAIL".
//
// CsRepair.run is the merge of three former menu entries -- Rebuild
// Survey Data, Restyle Layers and Callout Sync -- run together in the
// order that matters (see Core/CsRepair.js). Each pass has its own
// engine tests; what only a real RDocument proves here is that CsRepair
// drives all three, in that order, and reports what each one did or
// skipped.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// ---------------------------------------------------------------------
// Assertion harness -- the shape every engine suite here uses.
// ---------------------------------------------------------------------

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}

// ---------------------------------------------------------------------
// Fixture: a small cave, drawn for real -- v3 tags, so the survey-data
// pass has a real drawing to heal, the layer pass has registry layers
// to add to a bare document, and the callout pass has something to
// walk (even with nothing to reflow).
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

var survey = CsModel.newSurvey();
survey.caveName = "REPAIR TEST CAVE";
survey.distanceUnit = "ft";
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0));

CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

var before = CsRevise.surveyFromDocument(doc);
ok(before !== null && before.survey !== null,
    "the fixture drawing reconstructs");
ok(before.survey.shots.length === 2, "the fixture drawing has two shots");

// ---------------------------------------------------------------------
// Every pass, defaults -- opts omitted entirely. FIVE passes: relinking
// a scan whose file reference was lost joined the repair in 0.9.126.0,
// and filing the layers into the Layer Manager's groups in 0.9.141.0 --
// which is also where the standalone Group Layers menu entry went.
//
// A PASS IS NOT A LINE. The groups pass speaks up to three times in one
// run -- the layer groups it filed, any layer states it had to add, and
// the TRIP groups derived from the survey (0.9.150.0) -- so counting
// lines counts what this particular fixture happened to need, and broke
// the moment a pass grew a second sentence. What the report actually
// promises is that no pass stays SILENT: each one names itself, whether
// it ran, skipped, or found nothing to do. Assert that instead.
// ---------------------------------------------------------------------
var PASS_PREFIXES = ["Survey data:", "Scan images:", "Layers:",
                     "Layer groups:", "Callouts:"];

/** True when every pass named itself somewhere in these lines. */
function everyPassSpoke(lines) {
    var joined = lines.join("\n");
    for (var p = 0; p < PASS_PREFIXES.length; p++) {
        if (joined.indexOf(PASS_PREFIXES[p]) === -1) {
            return false;
        }
    }
    return true;
}

var all = CsRepair.run(doc, di, {});
ok(everyPassSpoke(all.lines), "every pass reports a line");
ok(all.lines.length >= PASS_PREFIXES.length,
    "and no pass is reported by borrowing another's line");
ok(all.changed === true, "the passes changed something");

// ---------------------------------------------------------------------
// Skip every pass -- nothing runs, nothing changes, and each line says
// so, rather than silently doing nothing.
// ---------------------------------------------------------------------
var none = CsRepair.run(doc, di,
    { rebuild: false, restyle: false, callouts: false,
      relinkScans: false, groups: false });
ok(none.changed === false, "skipping every pass changes nothing");
ok(none.lines.length === PASS_PREFIXES.length &&
    everyPassSpoke(none.lines),
    "and every skipped pass still reports -- exactly once, since a pass "
    + "that did not run has only the one thing to say");
ok(none.lines.join(" ").indexOf("skipped") !== -1,
    "a skipped pass says so");

// ---------------------------------------------------------------------
// One pass on, the rest off -- still one report line per pass, whether
// it ran or was skipped. Silence about a pass is indistinguishable from
// a pass that did nothing, which is the point of the line.
// ---------------------------------------------------------------------
var one = CsRepair.run(doc, di,
    { rebuild: false, restyle: true, callouts: false,
      relinkScans: false, groups: false });
ok(one.lines.length === PASS_PREFIXES.length &&
    everyPassSpoke(one.lines),
    "a single pass still reports every pass");

var out;
if (failures.length === 0) {
    out = "### REPAIR DRAWING OK " + passed;
} else {
    out = "### REPAIR DRAWING FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
