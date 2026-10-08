// callout_elev_mode.js -- the Callout tool's elevation-reading mode
// against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/callout_elev_mode.js "$PWD"
//
// Prints "### CALLOUT ELEV MODE OK" or a FAILURES listing.
//
// Task 4 folded CalloutElev into Callout as a source choice ("Type the
// note" vs "Floor elevation here"). The sampling itself was never
// CalloutElev's own code to begin with -- CalloutWrite.sampleElevationAt
// already lived in the shared write layer, because the ordinary Callout
// dialog's "elevation" style was already offering the same number (see
// Callout.elevProviderFor). So there is nothing to move: this suite
// exercises that shared function directly, the same one the merged
// tool's elevation-mode branch calls.

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
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
include(repoRoot + "/scripts/CaveSurvey/Callout/CalloutWrite.js");

var failures = [];
function check(what, cond) {
    if (!cond) {
        failures.push(what);
    }
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
CsLayers.ensureCalloutLayers(doc, di);

function shotOf(from, to, d, az, inc, dn) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// A1-A2-C1-C2, one connected tree off A1 (CsNetwork.resolve anchors on
// the first shot's `from` and never places a station outside that
// anchor's reach -- a separate disconnected chain was tried first and
// came back with undefined coordinates).
//
//   A1 --5' down--> A2      the arriving shot at A2 records a floor
//                           5' below the line: a point along this leg
//                           has real floor evidence.
//   A1 ----------> C1 ----------> C2   neither arriving shot (into C1
//                           or into C2) records any LRUD at all, and
//                           LRUD is looked up by STATION (the shot's
//                           `to`, CsModel.lrudForStation), so nothing
//                           upstream can leak evidence onto this leg --
//                           a point along it has none, and must fall
//                           back to the survey line.
var survey = CsModel.newSurvey();
survey.caveName = "CALLOUT ELEV MODE FIXTURE";
survey.distanceUnit = "ft";
survey.shots.push(shotOf("A1", "A2", 20.0, 0.0, 0.0, 5.0));
survey.shots.push(shotOf("A1", "C1", 20.0, 90.0, 0.0));
survey.shots.push(shotOf("C1", "C2", 20.0, 90.0, 0.0));

CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

var recon = CsRevise.resolveAsDrawn(doc);
check("the fixture drawing reconstructs its survey", recon !== null);

var st = recon.resolved.stations;

// A point inside measured LRUD: the midpoint of A1-A2, which has real
// floor evidence at A2 (down=5'). The label reads the floor, no LINE
// marker.
var pointInPassage = { x: (st.A1.x + st.A2.x) / 2,
                        y: (st.A1.y + st.A2.y) / 2 };

// A point with no LRUD to read: the midpoint of C1-C2. Both C1 and C2
// were arrived at by shots carrying no LRUD reading, so
// CsElevation.floorEvidence finds nothing and sampleFloor falls back to
// the survey line.
var pointWithoutLrud = { x: (st.C1.x + st.C2.x) / 2,
                          y: (st.C1.y + st.C2.y) / 2 };

var atFloor = CalloutWrite.sampleElevationAt(doc, pointInPassage);
check("a point with real LRUD samples something",
    atFloor !== null && atFloor.sample !== null);
check("floor sample has a basis",
    atFloor !== null && !isNull(atFloor.sample.basis));
check("floor sample is not the survey line",
    atFloor !== null && atFloor.sample.basis !== CsCallout.BASIS_LINE);
check("floor sample IS the floor basis",
    atFloor !== null && atFloor.sample.basis === CsCallout.BASIS_FLOOR);
check("label carries no LINE marker",
    atFloor !== null && atFloor.label.indexOf("LINE") === -1);
check("label carries the sampled value",
    atFloor !== null && atFloor.label.indexOf("-5.0") >= 0);

var atLine = CalloutWrite.sampleElevationAt(doc, pointWithoutLrud);
check("a point with no LRUD still samples the survey line",
    atLine !== null && atLine.sample !== null);
check("fallback basis is the survey line",
    atLine !== null && atLine.sample.basis === CsCallout.BASIS_LINE);
check("fallback label says LINE",
    atLine !== null && atLine.label.indexOf("LINE") !== -1);

// A point nowhere near any leg: sampleElevationAt must say so cleanly
// (null), never invent a number -- this is the "no survey leg near
// that point" branch the Callout dialog and the old CalloutElev tool
// both show a message for.
var farAway = { x: 5000, y: 5000 };
var gotFar = CalloutWrite.sampleElevationAt(doc, farAway);
check("a point far from every leg samples nothing", gotFar === null);

// --- the style CsCallout hands back follows the basis, not the caver's
// choice -- this is what stamps a stand-in onto the muted layer even
// though both go through the same "Floor elevation here" mode.
check("a floor basis takes the real elevation style",
    CsCallout.elevStyle(atFloor.sample) === "elevation");
check("a line basis is forced onto the muted fallback style",
    CsCallout.elevStyle(atLine.sample) === "elevation-line");

// --- the elevation MODE the merged Callout tool now exposes must be
// gone from the standalone tool entirely: no separate CalloutElev
// command should be findable in the shipped tree any more.
(function() {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/CalloutElev/CalloutElev.js");
    check("CalloutElev.js no longer ships", !f.exists());
})();

var out;
if (failures.length === 0) {
    out = "### CALLOUT ELEV MODE OK";
} else {
    out = "FAILURES:\n";
    for (var i = 0; i < failures.length; i++) {
        out += "  " + failures[i] + "\n";
    }
}
print(out);
