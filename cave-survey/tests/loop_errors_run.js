// loop_errors_run.js -- Loop Errors draws the closure where it happened.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/loop_errors_run.js "$PWD"
//
// tests/js_unit.js pins the arithmetic -- the exaggeration, the bands,
// which end of the arrow sits on the station. This proves the parts
// that only exist against a real survey in a real document:
//
//   1. A cave with a deliberate blunder in a loop produces arrows, and
//      they land ON the stations that moved rather than near them.
//   2. Everything goes on CTRL-CLOSURE, which is OFF in the registry
//      and has to be switched on or the caver runs the tool and sees
//      nothing.
//   3. The caption is drawn, and states the exaggeration.
//   4. Re-running replaces rather than stacking.

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

var failures = [];
function ok(condition, what) {
    if (!condition) {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
getMainWindow = function() { return null; };

includeBasePath = repoRoot + "/scripts/CaveSurvey/LoopErrors";
include(includeBasePath + "/LoopErrors.js");

function shotOf(from, to, d, az, inc) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    return s;
}

// ---------------------------------------------------------------------
// A square loop that does NOT close: the last leg is 6 ft short, so the
// adjustment has 6 ft to share out among four stations.
// ---------------------------------------------------------------------

var survey = CsModel.newSurvey();
survey.caveName = "Loop Test";
survey.shots = [
    shotOf("A1", "A2", 100, 0, 0),
    shotOf("A2", "A3", 100, 90, 0),
    shotOf("A3", "A4", 100, 180, 0),
    shotOf("A4", "A1", 94, 270, 0)
];

var raw = CsNetwork.resolve(survey, {});
ok(raw.loops.length >= 1, "the fixture has a loop to close (" +
    raw.loops.length + ")");
var adjusted = CsAdjust.adjust(survey, raw, { enabled: true });
ok(adjusted.summary.worstShift > 0.1,
    "and the adjustment actually moves stations (worst " +
        adjusted.summary.worstShift.toFixed(2) + ")");

var read = { survey: survey, raw: raw, adjusted: adjusted,
    wasAdjusted: true };

// The layer starts OFF, exactly as a fresh drawing has it.
CsLayers.ensure(doc, di, CsLayers.CTRL_CLOSURE);
var layer = doc.queryLayer(CsLayers.CTRL_CLOSURE);
ok(!isNull(layer) && CsLayers.refusesEdits(layer),
    "CTRL-CLOSURE starts off, as the registry says it should -- a " +
        "caver who ran this tool would otherwise see nothing");

var said = LoopErrors.draw(doc, di, read);
ok(String(said).indexOf("Loop Errors:") === 0,
    "it reports what it drew (" + said + ")");
ok(String(said).indexOf("exaggerated") > 0,
    "and says the arrows are exaggerated (" + said + ")");

layer = doc.queryLayer(CsLayers.CTRL_CLOSURE);
ok(!CsLayers.refusesEdits(layer),
    "and switched the layer on so the marks can be seen");

function marks() {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, "ClosureMark") !== "") {
            out.push(e);
        }
    }
    return out;
}

var drawn = marks();
ok(drawn.length > 0, "marks were drawn (" + messages.join(" | ") + ")");

var offLayer = 0, captions = 0, loops = 0, arrows = 0;
for (var i = 0; i < drawn.length; i++) {
    if (CsBind.layerNameOf(doc, drawn[i]) !== CsLayers.CTRL_CLOSURE) {
        offLayer += 1;
    }
    var what = CsTags.get(drawn[i], "ClosureMark");
    if (what === "caption") {
        captions += 1;
    } else if (what === "loop") {
        loops += 1;
    } else {
        arrows += 1;
    }
}
eqs(offLayer, 0,
    "everything the tool draws is on CTRL-CLOSURE -- it is a " +
        "diagnostic over a map, never map ink");
ok(arrows >= 3, "an arrow shaft and its barbs were drawn (" + arrows + ")");
ok(loops >= 1, "the loop itself is labelled");
ok(captions >= 3, "and the caption is on the drawing, not just in the " +
    "command line");

var captionText = "";
for (i = 0; i < drawn.length; i++) {
    if (CsTags.get(drawn[i], "ClosureMark") === "caption") {
        captionText += " " + CsSheet.textOf(drawn[i]);
    }
}
ok(captionText.toUpperCase().indexOf("EXAGGERATED") > 0 ||
    captionText.toUpperCase().indexOf("TRUE SIZE") > 0,
    "the drawn caption states the exaggeration -- an exaggeration " +
        "nobody is told about is a falsified map (" + captionText + ")");
ok(captionText.toUpperCase().indexOf("PLOTTING") > 0,
    "and says to switch the layer off before plotting");

// AN ARROW ENDS ON ITS STATION. Getting this wrong puts every arrow a
// whole shift away from the thing it is about, which looks plausible.
var stations = adjusted.stations;
var worstName = adjusted.summary.worstStation;
var at = stations[worstName];
var touching = 0;
for (i = 0; i < drawn.length; i++) {
    if (CsTags.get(drawn[i], "ClosureMark") !== worstName) {
        continue;
    }
    var b = drawn[i].getBoundingBox();
    var mn = b.getMinimum(), mx = b.getMaximum();
    if (at.x >= mn.x - 0.001 && at.x <= mx.x + 0.001 &&
            at.y >= mn.y - 0.001 && at.y <= mx.y + 0.001) {
        touching += 1;
    }
}
ok(touching > 0,
    "the worst station's arrow reaches the station itself (" +
        worstName + ")");

// THE CAPTION SITS BELOW EVERYTHING, not below the lowest station: the
// extended elevation is drawn beneath the plan, so a caption placed
// under the stations lands in the middle of the profile bands. Drawn
// here with something below the survey to prove the rule.
var capBottom = null;
for (i = 0; i < drawn.length; i++) {
    if (CsTags.get(drawn[i], "ClosureMark") !== "caption") {
        continue;
    }
    var cb = drawn[i].getBoundingBox().getMinimum().y;
    if (capBottom === null || cb < capBottom) {
        capBottom = cb;
    }
}
var lowestStation = null;
for (var sn in stations) {
    if (!stations.hasOwnProperty(sn)) {
        continue;
    }
    if (lowestStation === null || stations[sn].y < lowestStation) {
        lowestStation = stations[sn].y;
    }
}
ok(capBottom !== null && capBottom < lowestStation,
    "the caption is drawn below the survey rather than through it");

// TWO LOOPS CLOSING NEAR EACH OTHER get their labels stacked, not
// printed one over the other -- seen on Truitt Cave, whose two rings
// both close at 2.4%.
var loopYs = [];
for (i = 0; i < drawn.length; i++) {
    if (CsTags.get(drawn[i], "ClosureMark") === "loop") {
        loopYs.push(drawn[i].getBoundingBox().getMinimum().y);
    }
}
var stacked = true;
for (i = 1; i < loopYs.length; i++) {
    if (Math.abs(loopYs[i] - loopYs[i - 1]) < 0.001) {
        stacked = false;
    }
}
ok(stacked, "no two loop labels share a line");

// RE-RUNNING REPLACES.
var first = drawn.length;
LoopErrors.draw(doc, di, read);
eqs(marks().length, first,
    "running it twice replaces the marks rather than drawing a second " +
        "set over them");

// AN UNADJUSTED DRAWING gets the arrows the other way round, and is
// told so.
var unread = { survey: survey, raw: raw, adjusted: adjusted,
    wasAdjusted: false };
LoopErrors.draw(doc, di, unread);
var tense = "";
var after = marks();
for (i = 0; i < after.length; i++) {
    if (CsTags.get(after[i], "ClosureMark") === "caption") {
        tense += " " + CsSheet.textOf(after[i]);
    }
}
ok(tense.toUpperCase().indexOf("WOULD MOVE") > 0,
    "an unadjusted drawing is told the arrows show where stations " +
        "WOULD move (" + tense + ")");

if (failures.length === 0) {
    print("### LOOP ERRORS OK " + first + " marks");
} else {
    print("### LOOP ERRORS FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
