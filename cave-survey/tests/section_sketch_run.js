// section_sketch_run.js -- the sketched-section lifecycle against a REAL
// document: open a bay, trace into it, capture, refresh, round-trip and
// reopen.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/section_sketch_run.js "$PWD"
//
// Prints "### SECTION SKETCH OK <n>" on success, "### SECTION SKETCH
// FAIL" plus the failed assertions otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsSectionBay's
// maths are node-tested and none of them is where this feature can
// break. What can break is everything that only exists once there is an
// RDocument: a sweep measured against a STALE bounding box, a block
// whose entities are placed in world coordinates instead of block-local
// ones, tags that survive in memory and vanish through DXF, and a
// LOCKED layer that accepts a delete and keeps the entity anyway.
//
// TWO ASSERTIONS HERE WERE MUTATION-TESTED, and are the two this file
// is really for:
//
//   * "block-local about the ghost centre" (claim 3). Deleting the
//     `e.move(new RVector(-origin.x, -origin.y))` from
//     SectionCapture.capture turns it red with
//     "expected -3, got 27" -- a section landing a bay's width from
//     its own leader.
//   * "the bay is torn down" (claim 7). Deleting the frame's
//     `CsLayers.withLayerUnlocked` wrapper -- so the LOCKED
//     CTRL-SECTION-BOX layer refuses the delete in silence -- turns it
//     red with "the frame is gone from the drawing".
//
// WHY NOT isNull() FOR "THIS WAS DELETED". Probed, and the same finding
// tests/cross_section_run.js records: doc.queryEntity() on a deleted id
// does NOT return null here -- it returns the entity with
// isUndone()===true, which this suite's isNull() shim cannot see. Every
// absence claim below therefore goes through
// doc.queryAllEntities(false, true) (which EXCLUDES undone entities) or
// CalloutWrite.members(), which is built on it. An isNull()-based
// teardown check stays green with the teardown removed -- that is what
// the mutation test above measured.

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

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var source = String(stream.readAll());
    file.close();
    // Dependencies are loaded explicitly below; QCAD's own include()
    // would look in the installed script folders, not this checkout.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    // Indirect eval, so definitions land in the GLOBAL scope.
    (0, eval)(source);
}

// EAction and simple.js come from the APPLICATION, by their real paths
// -- the three tool files under test build their prototypes from
// EAction at load time.
include("scripts/EAction.js");
include("scripts/simple.js");

// ---------------------------------------------------------------------
// The Core library, read out of CsAll.js rather than hand-listed.
//
// DELIBERATE DIVERGENCE from every other *_run.js in this suite, all of
// which carry their own hand-written CORE array. A file missing from
// such a list is `undefined` at runtime, and the deliberate try/catches
// in the tools under test (CsRevise.resolveAsDrawn, CsStore, the snap
// and zoom guards) turn that into a SILENT PASS -- the test would prove
// only that the catch block works. CsAll.js is already the single place
// a Core file is registered (test_addon.py enforces it), so reading the
// list from there means this file cannot drift out of date, and cannot
// pass by loading less than the tools actually use.
// ---------------------------------------------------------------------
(function() {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open Core/CsAll.js");
    }
    var text = String(new QTextStream(f).readAll());
    f.close();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = /include\(includeBasePath \+ "\/([^"]+)"\);/.exec(lines[i]);
        if (m !== null) {
            loadRepoScript("scripts/CaveSurvey/Core/" + m[1]);
        }
    }
})();

loadRepoScript("scripts/CaveSurvey/Callout/CalloutWrite.js");
loadRepoScript("scripts/CaveSurvey/CrossSection/SectionBay.js");
loadRepoScript("scripts/CaveSurvey/CrossSection/SectionCapture.js");
loadRepoScript("scripts/CaveSurvey/CrossSection/SectionEdit.js");
// Feature Trace, because the bay is only worth opening if the suite's
// own tracing tools will actually draw into it -- see claim FT. The
// panel file comes too: FeatureTraceRun.commit reads FeatureTrace.target
// without a typeof guard, so a stub here would be testing the stub.
loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTrace.js");
loadRepoScript("scripts/CaveSurvey/FeatureTrace/FeatureTraceRun.js");
// Shaped Lines, for claim SL: the symbology tools have to work in a
// bay too, and their bug was a different one -- see that claim.
loadRepoScript("scripts/CaveSurvey/ShapedLines/ShapedLinesRun.js");

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    }
}

function checkClose(name, actual, expected, tol) {
    checks++;
    if (!(Math.abs(actual - expected) <= (tol === undefined ? 1e-6 : tol))) {
        failures.push(name + " -- expected " + expected + ", got " + actual);
    }
}

// ---------------------------------------------------------------------
// Sanity: the Core library really did load. Every claim below runs
// through code that catches its own exceptions, so a half-loaded
// library would otherwise read as a quiet, wrong pass.
// ---------------------------------------------------------------------
(function() {
    var needed = ["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsFrontier",
        "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud", "CsSectionCut",
        "CsTags", "CsStore", "CsLayers", "CsCallout", "CsSectionDraw",
        "CsSectionBay", "CsRevise", "CsStationOrder", "CsScanFrame",
        "CsDraw", "CsBind", "CsElevation", "CsProfile", "CsWarp"];
    var missing = [];
    for (var i = 0; i < needed.length; i++) {
        if (typeof this[needed[i]] === "undefined") {
            missing.push(needed[i]);
        }
    }
    check("every Core library the tools reach for is loaded" +
        (missing.length === 0 ? "" : " (missing " + missing.join(", ") + ")"),
        missing.length === 0);
    check("the three tools under test are loaded",
        typeof SectionBay === "function" &&
        typeof SectionCapture === "function" &&
        typeof SectionEdit === "function");
}).call(this);

// ---------------------------------------------------------------------
// A document with a survey, walls, and a real scan on disk.
//
// The tools reach for the CURRENT document through EAction.getDocument()
// (SectionBay.run, SectionEdit.run), which resolves through
// global.gDocumentInterface before it ever asks the main window -- and
// headless there IS no main window. So the fixture is installed there,
// exactly as tests/generate_profile_run.js reassigns getDocument/
// getDocumentInterface for the same reason.
//
// THE SURVEY IS DRAWN INTO THE DRAWING, not just held in memory.
// tests/cross_section_run.js hands CalloutWrite an already-computed cut
// and never needs plotted stations; these three tools do not work that
// way. SectionBay.run rebuilds the survey from the drawing's own
// tags (CsRevise.resolveAsDrawn) to compute the ghost, and
// SectionCapture.proposePosition finds the station through
// CsTags.collectStations(doc). A fixture with no plotted stations would
// produce a bay with no ghost and a capture with no proposal -- both of
// which the tools handle gracefully, so the test would pass having
// exercised none of it.
// ---------------------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
global.gDocumentInterface = di;
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
// A REAL CAVE FOLDER, WITH A REAL scans/ UNDER IT.
//
// The drawing used to live in a bare temp directory, which made the
// relative-scan-path claim untestable: a drawing stores its scan path
// relative to the cave's scans/ folder, and CsCave.findSubfolder only
// ever answers about a folder that EXISTS on disk. With no scans/ to be
// relative to, every path stays absolute and R2 below would pass while
// proving nothing.
var caveDir = QDir.tempPath() + "/cs_section_cave";
var scansDir = caveDir + "/scans";
(new QDir()).mkpath(scansDir);
doc.setFileName(caveDir + "/cs_section_sketch_run.dxf");

// Every "Sketch Section: ..." message, captured rather than shown -- a
// modal dialog in a headless run is a hang, and the messages are
// evidence in their own right (claim 1 asserts the bay opened WITHOUT
// the "no cuttable LRUD" complaint, which is how we know the ghost is
// a real computed outline and not a fallback box).
var said = [];
SectionBay.say = function(text) { said.push(String(text)); };

CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SHOTS);
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.SECTION_WALLS_SURVEYED);

/** A plotted station, tagged the way CsDraw.survey tags one: the tag
 *  set CsTags.surveyFromDocument actually reads back. LRUD rides on the
 *  station it ARRIVES at, which is the suite's own convention. */
function putStation(name, seq, x, y, lrud) {
    var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
    p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(p, "Station", name);
    CsTags.set(p, "Seq", seq);
    CsTags.set(p, "Elevation", 0);
    if (lrud !== undefined && lrud !== null) {
        CsTags.set(p, "Left", lrud.l);
        CsTags.set(p, "Right", lrud.r);
        CsTags.set(p, "Up", lrud.u);
        CsTags.set(p, "Down", lrud.d);
    }
    di.applyOperation(new RAddObjectOperation(p, false));
    return p;
}

function putLine(layerName, x1, y1, x2, y2) {
    var e = new RLineEntity(doc, new RLineData(
        new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layerName));
    di.applyOperation(new RAddObjectOperation(e, false));
    return e;
}

// FOUR stations, not three. LRUD rides on the station a shot ARRIVES
// at, so the first station in the chain never gets any -- and
// CsSectionCut.cut refuses a leg whose either end has fewer than
// MIN_POINTS measured wall points. A0 exists purely so that A1, the far
// end of the leg the cut at A2 is taken on, has an LRUD of its own.
// (Measured: with A1 first in the chain the cut is refused with
// "station A1 has fewer than 3 measured wall points" and the bay opens
// with no ghost at all -- which every claim below would then be
// measuring against the frame's centre instead.)
var LRUD = { l: 4, r: 4, u: 3, d: 2 };
putStation("A0", 0, -20, 0, LRUD);
putStation("A1", 1, -10, 0, LRUD);
putStation("A2", 2, 0, 0, LRUD);
putStation("A3", 3, 10, 0, LRUD);
putLine(CsLayers.CTRL_SHOTS, -20, 0, -10, 0);
putLine(CsLayers.CTRL_SHOTS, -10, 0, 0, 0);
putLine(CsLayers.CTRL_SHOTS, 0, 0, 10, 0);

// THE WALL THE MARCH HAS TO MARCH PAST. Two walls above the passage and
// one below it: CsSectionBay.clearerSide counts obstacles within its
// probe reach and takes the emptier side, so the section is sent DOWN
// (-Y) -- straight at the wall at y = -6, which is close enough to the
// station that no acceptable spot exists until the march has stepped
// clear past it. Without a wall there, the march clears the station
// point itself on its second step and this claim proves nothing.
putLine(CsLayers.WALLS_SURVEYED, -20, 5, 20, 5);
putLine(CsLayers.WALLS_SURVEYED, -20, 8, 20, 8);
var blocker = putLine(CsLayers.WALLS_SURVEYED, -20, -6, 20, -6);
blocker.update();
var blockerBox = {
    x1: blocker.getBoundingBox().getMinimum().x,
    y1: blocker.getBoundingBox().getMinimum().y,
    x2: blocker.getBoundingBox().getMaximum().x,
    y2: blocker.getBoundingBox().getMaximum().y
};

// A real raster the engine can actually read, so the scan is a real
// RImageEntity and not a silently skipped one -- the same trick
// tests/scan_reanchor_run.js uses. Copied INTO the cave's scans/ folder
// rather than pointed at in the checkout, so the path a capture stores
// is genuinely relativisable (R2).
var scanRel = "section.svg";
var scanPath = scansDir + "/" + scanRel;
(new QFile(scanPath)).remove();
check("fixture: the scan copies into the cave's scans/ folder",
    (new QFile(repoRoot +
        "/scripts/CaveSurvey/CrossSection/CrossSection.svg")).copy(scanPath));
check("fixture: the scan file this run underlays is readable",
    !(new QImage(scanPath)).isNull());
check("fixture: and the suite agrees that is where this cave's scans " +
    "live -- R2's relative path is measured against this",
    SectionBay.scansFolderOf(doc) === scansDir);

var asDrawn = CsRevise.resolveAsDrawn(doc);
check("fixture: the drawing's own tags rebuild the survey",
    asDrawn !== null && asDrawn.resolved.stations.A2 !== undefined);

// ---------------------------------------------------------------------
// CLAIM 1: a bay opens, is found again by its frame, and sweeps nothing
// while nothing is traced.
// ---------------------------------------------------------------------
var bayId = SectionBay.run(scanPath, "A2");
check("1: a bay opens", bayId !== null && bayId !== undefined);
check("1: and it opened with a real computed ghost, not the " +
    "no-cuttable-LRUD fallback", said.length === 0);

var bay0 = SectionCapture.findBay(doc);
check("1: the bay is found again by its frame", bay0 !== null);
check("1: the frame it was found by is the one just drawn",
    bay0 !== null && bay0.id === bayId);
check("1: with the station it was opened at",
    bay0 !== null && bay0.station === "A2");
check("1: it has a ghost", bay0 !== null && bay0.ghost !== null);
check("1: it has a scan", bay0 !== null && bay0.scan !== null);
check("1: and nothing is swept while nothing is traced",
    bay0 !== null && bay0.traced.length === 0);
// The station dialog's head start comes off the drawing, so it has to
// see an OPEN bay as a station already spoken for -- otherwise a caver
// opening a second bay is offered the one they are standing in.
var doneNow = SectionBay.sectionedStations(doc);
check("1: an open bay counts as a station already sectioned",
    doneNow.indexOf("A2") >= 0);
check("1: and the next bay is offered the station after it",
    CsSectionBay.suggestStation(["A1", "A2", "A3"], doneNow) === "A3");

check("1: the frame really is on the LOCKED CTRL-SECTION-BOX layer -- " +
    "which is what claim 7's teardown has to get past",
    bay0 !== null &&
    doc.getLayerName(bay0.frame.getLayerId()) === CsLayers.CTRL_SECTION_BOX &&
    CsLayers.LOCKED[CsLayers.CTRL_SECTION_BOX] === true);

// ---------------------------------------------------------------------
// CLAIM 2: what is traced inside the frame is swept -- and the frame,
// the ghost and the scan are NOT.
// ---------------------------------------------------------------------
var centre = SectionCapture.originOf(bay0);
var traced = new RLineEntity(doc, new RLineData(
    new RVector(centre.x - 3, centre.y - 3),
    new RVector(centre.x + 3, centre.y + 3)));
traced.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
var traceOp = new RAddObjectsOperation();
traceOp.addObject(traced, false);
di.applyOperation(traceOp);
var tracedId = traced.getId();

var bay1 = SectionCapture.findBay(doc);
check("2: the tracing is swept",
    bay1 !== null && bay1.traced.length === 1);
check("2: and it is the tracing, by id",
    bay1 !== null && bay1.traced.length === 1 &&
    String(bay1.traced[0]) === String(tracedId));
// Named individually rather than inferred from the count: a sweep that
// took the frame and dropped the tracing would also have length 1.
var sweptIds = {};
if (bay1 !== null) {
    for (var si = 0; si < bay1.traced.length; si++) {
        sweptIds[String(bay1.traced[si])] = true;
    }
}
check("2: the frame is NOT swept",
    bay1 !== null && sweptIds[String(bay1.frame.getId())] !== true);
check("2: the ghost is NOT swept",
    bay1 !== null && bay1.ghost !== null &&
    sweptIds[String(bay1.ghost.getId())] !== true);
check("2: the scan is NOT swept",
    bay1 !== null && bay1.scan !== null &&
    sweptIds[String(bay1.scan.getId())] !== true);

// ---------------------------------------------------------------------
// THE CAVER FITS THE SCAN. This is the workflow, not a variation on it:
// a scan has no scale and no up, so scaling, turning and nudging it
// onto the ghost is the entire reason the ghost is drawn. Everything
// from here down therefore runs against a scan that is NOT where the
// auto-fit put it -- which is what makes R1's claims below able to
// fail. Before this, every assertion about the stored fit was measured
// on a scan nobody had touched, where the auto-fit and the actual
// placement are the same numbers and a tool reading the wrong one of
// the two looks perfect.
//
// Scaled AND rotated AND moved, all three, because the fit this
// replaced could not express any of them: it stored sx/sy/rot with rot
// hard-written 0, and rebuilt u = (sx, 0), v = (0, sy) on the way back.
// ---------------------------------------------------------------------
var autoFit = SectionCapture.fitOfScan(bay1.scan,
    SectionCapture.originOf(bay1));
check("fixture: the auto-fit the bay opened at is readable off the scan",
    autoFit !== null);
check("fixture: and it is square -- an auto-fit has no rotation in it, " +
    "so any rotation below is the caver's",
    autoFit !== null && autoFit.uy === 0 && autoFit.vx === 0);

(function() {
    var about = SectionCapture.originOf(bay1);
    var s = doc.queryEntity(bay1.scan.getId());
    s.scale(1.7, new RVector(about.x, about.y));
    s.rotate(Math.PI / 7, new RVector(about.x, about.y));
    s.move(new RVector(2.5, -1.5));
    var fitOp = new RModifyObjectsOperation();
    fitOp.addObject(s, false);
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN, function() {
        di.applyOperation(fitOp);
    });
})();

// Re-read the bay: bay1's `scan` is a script-side copy from before the
// modify, and every claim from here on must be measuring the scan as
// the document now holds it.
bay1 = SectionCapture.findBay(doc);
check("fixture: the bay is still there after the scan was fitted",
    bay1 !== null && bay1.scan !== null && bay1.traced.length === 1);

var fittedFit = SectionCapture.fitOfScan(bay1.scan,
    SectionCapture.originOf(bay1));
check("fixture: the fitted scan really did move off its auto-fit",
    fittedFit !== null && autoFit !== null &&
    CsSectionBay.serializeFit(fittedFit) !==
        CsSectionBay.serializeFit(autoFit));
check("fixture: and it really is rotated -- the cross terms are no " +
    "longer zero",
    fittedFit !== null && Math.abs(fittedFit.uy) > 1e-6 &&
    Math.abs(fittedFit.vx) > 1e-6);

// ---------------------------------------------------------------------
// CLAIM 6 (measured before the capture, which tears the bay down): the
// proposed spot clears every plan-frame obstacle by CsSectionBay.MARGIN,
// and the wall really was in the way.
// ---------------------------------------------------------------------
var origin = SectionCapture.originOf(bay1);
var localBox = SectionCapture.localBoxOf(doc, bay1, origin);
var obstacles = SectionCapture.obstaclesOf(doc, bay1);
var at = SectionCapture.proposePosition(doc, bay1);
check("6: a position is proposed", at !== null);

var stationAt = null;
var allStations = CsTags.collectStations(doc);
for (var qi = 0; qi < allStations.length; qi++) {
    if (allStations[qi].name === "A2") {
        stationAt = { x: allStations[qi].pos.x, y: allStations[qi].pos.y };
    }
}
check("6: fixture: the station the march starts from is found",
    stationAt !== null);

var worst = null;
if (at !== null) {
    var placedBox = CsSectionBay.boxAt(localBox, at);
    for (var oi = 0; oi < obstacles.length; oi++) {
        if (CsSectionBay.overlaps(placedBox, obstacles[oi],
                CsSectionBay.MARGIN)) {
            worst = obstacles[oi];
        }
    }
}
check("6: fixture: there are plan obstacles to clear at all",
    obstacles.length > 0);
check("6: the proposed spot clears EVERY plan obstacle by MARGIN" +
    (worst === null ? "" : " (hit " + JSON.stringify(worst) + ")"),
    at !== null && worst === null);

// THE MARCH ACTUALLY MARCHED. One step back toward the station, the
// wall -- and only the wall -- is what blocks: proof the section was
// pushed past a real obstacle rather than landing on the first step.
if (at !== null && stationAt !== null) {
    var dirY = (at.y < stationAt.y) ? 1 : -1;
    var oneStepBack = { x: at.x, y: at.y + dirY * CsSectionBay.STEP };
    var backBox = CsSectionBay.boxAt(localBox, oneStepBack);
    check("6: one step short of the proposal, the wall blocks it",
        CsSectionBay.overlaps(backBox, blockerBox, CsSectionBay.MARGIN));
    check("6: and the proposal itself clears that same wall",
        !CsSectionBay.overlaps(CsSectionBay.boxAt(localBox, at), blockerBox,
            CsSectionBay.MARGIN));
} else {
    check("6: one step short of the proposal, the wall blocks it", false);
    check("6: and the proposal itself clears that same wall", false);
}

// ---------------------------------------------------------------------
// CLAIM 3, 4, 5: capture.
// ---------------------------------------------------------------------
var frameId = bay1.frame.getId();
var ghostId = bay1.ghost.getId();
var scanId = bay1.scan.getId();
var storedScan = CsTags.get(bay1.scan, CsCallout.KEY.SECTION_SCAN);
check("4: fixture: the bay's scan carries the path it was placed from",
    storedScan === scanPath);
// NO FIT TAG ON THE BAY'S SCAN, and that absence is the fix for R1.
// SectionBay used to tag the scan with its AUTO-fit, and Capture
// copied that tag onto the finished section -- so a caver's own
// scaling and turning was recorded as the fitting they never chose.
// The tag is gone; the fit is read off the scan entity instead.
check("4: fixture: the bay's scan carries NO fit tag -- the stale tag " +
    "that used to overwrite the caver's own fitting is not written",
    CsTags.get(bay1.scan, CsCallout.KEY.SECTION_FIT) === "");
// What the fit SHOULD be, measured off the scan while the bay still
// exists: capture is about to delete it.
//
// READ STRAIGHT OFF THE RImageData, deliberately NOT through
// SectionCapture.fitOfScan. Using the tool's own reader as the oracle
// for the tool's own output makes the comparison self-confirming: a
// fitOfScan that dropped the rotation would produce a stored fit that
// still matched its own expectation exactly. These six numbers come
// from the engine.
var expectFit = (function() {
    var d = bay1.scan.getData();
    var ip = d.getInsertionPoint();
    var u = d.getUVector();
    var v = d.getVVector();
    var o = SectionCapture.originOf(bay1);
    return CsSectionBay.serializeFit({
        ux: u.x, uy: u.y, vx: v.x, vy: v.y,
        tx: ip.x - o.x, ty: ip.y - o.y });
})();

var id = SectionCapture.capture(doc, di, bay1, at);
check("3: the section is captured", id !== null && id !== undefined);

var members = CalloutWrite.members(doc, id);
check("3: its content is a BLOCK, not text",
    members.block !== null && members.text === null);
var blockName = CsSectionDraw.blockName(id);
var blockId = doc.getBlockId(blockName);
check("3: and it is this section's own definition, CS_<CalloutId>",
    members.block !== null && blockId === members.block.getData()
        .getReferencedBlockId());

// A captured block holds the tracing PLUS one station label, so every
// count below asks for the tracing specifically. Splitting by entity
// type rather than by id keeps these assertions about what the block
// holds, not about which particular ids this fixture happened to mint.
function blockTracing(d, bid) {
    var all = d.queryBlockEntities(bid), out = [];
    for (var bi = 0; bi < all.length; bi++) {
        var be = d.queryEntity(all[bi]);
        if (isNull(be) || be.getType() === RS.EntityText) { continue; }
        out.push(all[bi]);
    }
    return out;
}
function blockLabels(d, bid) {
    var all = d.queryBlockEntities(bid), out = [];
    for (var li = 0; li < all.length; li++) {
        var le = d.queryEntity(all[li]);
        if (!isNull(le) && le.getType() === RS.EntityText) { out.push(le); }
    }
    return out;
}

var inBlock = blockTracing(doc, blockId);
check("3: the block holds the tracing, and only the tracing",
    inBlock.length === 1);
check("3: and it is the very entity that was traced, moved not copied",
    inBlock.length === 1 && String(inBlock[0]) === String(tracedId));

// ---- the station label ---------------------------------------------
// A page of captured sections used to be a page of anonymous outlines.
var labels = blockLabels(doc, blockId);
check("3: the block carries exactly one station label",
    labels.length === 1);
if (labels.length === 1) {
    check("3: and it says which station this is",
        String(labels[0].getData().getText()) === bay1.station);
    // AT THE CENTROID of the tracing, in block-local coordinates. The
    // tracing runs -3..+3 about the ghost centre, so the centroid is
    // the block's own origin.
    var lp = labels[0].getData().getPosition();
    checkClose("3: the label sits at the tracing's centroid (x)", lp.x, 0);
    checkClose("3: the label sits at the tracing's centroid (y)", lp.y, 0);
    check("3: on the section label layer",
        doc.getLayerName(labels[0].getLayerId()) ===
        CsLayers.CTRL_SECTION_TEXT_LABELS);
}

// BLOCK-LOCAL. The tracing ran from centre-3 to centre+3 in world
// coordinates, where centre is the GHOST's centre; inside the block it
// must run -3 to +3. Get this wrong and every section lands a bay's
// width away from its own leader -- which is a bay's width off the
// sheet, since the bay is parked clear of the whole drawing.
if (inBlock.length === 1) {
    var held = doc.queryEntity(inBlock[0]);
    held.update();
    var hb = held.getBoundingBox();
    checkClose("3: block-local about the ghost centre (min x)",
        hb.getMinimum().x, -3);
    checkClose("3: block-local about the ghost centre (min y)",
        hb.getMinimum().y, -3);
    checkClose("3: block-local about the ghost centre (max x)",
        hb.getMaximum().x, 3);
    checkClose("3: block-local about the ghost centre (max y)",
        hb.getMaximum().y, 3);
} else {
    check("3: block-local about the ghost centre", false);
}

// The reference sits exactly where the march proposed it.
var placedAt = members.block.getData().getPosition();
checkClose("3: the reference sits at the proposed spot (x)", placedAt.x, at.x);
checkClose("3: the reference sits at the proposed spot (y)", placedAt.y, at.y);

// ---- claim 4: the reference's own record --------------------------
check("4: tagged SectionSource=sketch",
    CsTags.get(members.block, CsCallout.KEY.SECTION_SOURCE) ===
        CsCallout.SOURCE_SKETCH);
check("4: carrying its station",
    CsTags.get(members.block, CsCallout.KEY.SECTION_STATION) === "A2");
check("4: carrying its scale",
    parseFloat(CsTags.get(members.block, CsCallout.KEY.SECTION_SCALE)) ===
        CsSectionDraw.scaleOf());
check("4: and the fit reads back as a fit, not as a corrupt tag",
    CsSectionBay.parseFit(
        CsTags.get(members.block, CsCallout.KEY.SECTION_FIT)) !== null);

// ---------------------------------------------------------------------
// R1 (review finding, DATA LOSS): the fit stored on the section is the
// scan's ACTUAL placement -- the one the caver fitted -- and not the
// auto-fit SectionBay wrote into a tag when the bay opened.
//
// Before the fix, SectionCapture copied the scan's SectionBayFit TAG
// onto the reference. That tag was written ONCE, by addScan, at
// auto-fit time, and nothing ever updated it -- so scaling and turning
// the scan onto the ghost, which is the whole workflow, was recorded
// nowhere. Edit Sketch then restored the scan at the auto-fit and the
// caver's fitting was gone. Rotation could not survive at all: the fit
// wrote rot as 0 every time and rebuilt u = (sx, 0), v = (0, sy),
// which has nowhere to put an angle.
//
// Measured against the scan's own placement, NOT merely "not empty"
// and NOT merely "parses": both of those stayed green throughout the
// entire defect.
// ---------------------------------------------------------------------
var storedFit = CsTags.get(members.block, CsCallout.KEY.SECTION_FIT);
check("R1: the stored fit is the scan's ACTUAL placement, the one the " +
    "caver fitted" +
    (storedFit === expectFit ? "" :
        " (expected " + expectFit + ", got " + storedFit + ")"),
    storedFit === expectFit);
check("R1: and it is NOT the auto-fit the bay opened at -- the stale " +
    "tag is not what gets recorded",
    autoFit !== null && storedFit !== CsSectionBay.serializeFit(autoFit));
var storedParsed = CsSectionBay.parseFit(storedFit);
check("R1: the caver's ROTATION is in there -- a fit of the old shape " +
    "could not carry one at all",
    storedParsed !== null && Math.abs(storedParsed.uy) > 1e-6 &&
    Math.abs(storedParsed.vx) > 1e-6);
checkClose("R1: and the caver's SCALE, not the auto-fit's",
    storedParsed === null ? 0 :
        Math.sqrt(storedParsed.ux * storedParsed.ux +
                  storedParsed.uy * storedParsed.uy),
    Math.sqrt(autoFit.ux * autoFit.ux + autoFit.uy * autoFit.uy) * 1.7,
    1e-5);

// ---------------------------------------------------------------------
// R2 (review finding, portability): the scan path is stored RELATIVE to
// the cave's scans/ folder.
//
// It used to be absolute (SketchScans.sketchSoon hands SectionBay an
// absolute path and it was tagged straight through), which is only true
// on the machine that wrote it. Cave projects live on a shared drive,
// get renamed and get opened by whoever was on the trip -- an absolute
// path makes every Edit Sketch elsewhere report a missing scan. The
// design spec's tag table says "relative to scans/" and SketchScans
// already tags its own inserted images that way.
// ---------------------------------------------------------------------
var storedPath = CsTags.get(members.block, CsCallout.KEY.SECTION_SCAN);
check("R2: the stored scan path is RELATIVE to scans/" +
    " (got \"" + storedPath + "\")", storedPath === scanRel);
check("R2: which is to say NOT the absolute path this machine happens " +
    "to have the file at", storedPath !== scanPath);
check("R2: and nothing absolute survives in the drawing at all",
    storedPath.charAt(0) !== "/" && storedPath.indexOf(":") === -1 &&
    storedPath.indexOf(String(QDir.tempPath())) === -1);
// The bay's own scan keeps the ABSOLUTE path: it is a live image entity
// and has to be constructible from what it carries. Relative is the
// DRAWING's storage convention, not the scan entity's.
check("R2: the bay's own scan still carries the absolute path it was " +
    "built from -- only the section's record goes relative",
    storedScan === scanPath);
check("4: it is a section callout, by role and kind",
    CsTags.get(members.block, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION &&
    CsTags.get(members.block, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK);

// ---- claim 5: the leader ------------------------------------------
check("5: exactly one leader", members.leaders.length === 1);
if (members.leaders.length === 1) {
    var ld = members.leaders[0].getData();
    var v0 = ld.getVertexAt(0);
    var v1 = ld.getVertexAt(1);
    checkClose("5: it starts AT the station (x)", v0.x, stationAt.x);
    checkClose("5: it starts AT the station (y)", v0.y, stationAt.y);
    checkClose("5: and it ends at the section (x)", v1.x, at.x);
    checkClose("5: and it ends at the section (y)", v1.y, at.y);
} else {
    check("5: it starts AT the station", false);
}

// ---------------------------------------------------------------------
// CLAIM 7: the bay is gone -- frame, ghost, scan and loose tracing.
//
// NOT ASSERTED WITH isNull(). See this file's header: queryEntity on a
// deleted id hands the entity back with isUndone()===true here, so an
// isNull() check would pass whether or not the delete landed.
// queryAllEntities(false, true) excludes undone entities and is the
// only reliable "it is gone" in this build.
// ---------------------------------------------------------------------
function liveIds() {
    var out = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        out[String(ids[i])] = true;
    }
    return out;
}
function liveBayFurniture() {
    var found = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SectionBay.TAG_BAY) !== "") {
            found.push(CsTags.get(e, "SectionBayRole") || "untagged-role");
        }
    }
    return found;
}

var live = liveIds();
check("7: the frame is gone from the drawing -- the LOCKED " +
    "CTRL-SECTION-BOX layer did not silently refuse its delete",
    live[String(frameId)] !== true);
check("7: the ghost is gone", live[String(ghostId)] !== true);
check("7: the scan is gone", live[String(scanId)] !== true);
var leftovers = liveBayFurniture();
check("7: no bay furniture of any kind survives" +
    (leftovers.length === 0 ? "" : " (found " + leftovers.join(", ") + ")"),
    leftovers.length === 0);
check("7: and there is no bay left to find", SectionCapture.findBay(doc) === null);
// The tracing is not "loose in the drawing" any more either: it lives
// in the block now. Same entity, different owner.
var tracedNow = doc.queryEntity(tracedId);
check("7: the tracing is no longer loose -- it belongs to the block",
    !isNull(tracedNow) && tracedNow.getBlockId() === blockId &&
    tracedNow.getBlockId() !== doc.getModelSpaceBlockId());

// ---------------------------------------------------------------------
// CLAIM 8: Draw counts it and leaves it alone.
// ---------------------------------------------------------------------
var beforeIds = blockTracing(doc, blockId);
var beforeRefId = members.block.getId();
var beforePos = members.block.getData().getPosition();

var report = CalloutWrite.refreshSectionsFromDocument(doc, di);
check("8: a refresh counts it as sketched",
    report !== null && report.sketched === 1);
check("8: and never re-derives it", report !== null && report.updated === 0);

var afterIds = blockTracing(doc, blockId);
check("8: the block still holds exactly what it held",
    afterIds.length === beforeIds.length && afterIds.length === 1);
// IDENTITY, not a count: a regenerate that deleted the tracing and drew
// an LRUD outline in its place would keep the count at 1.
check("8: and the SAME entity, never replaced",
    afterIds.length === 1 && String(afterIds[0]) === String(tracedId));

var m8 = CalloutWrite.members(doc, id);
check("8: the reference is the same entity, not rewritten",
    m8.block !== null && m8.block.getId() === beforeRefId);
checkClose("8: and it did not move (x)",
    m8.block.getData().getPosition().x, beforePos.x);
checkClose("8: and it did not move (y)",
    m8.block.getData().getPosition().y, beforePos.y);
check("8: a second pass counts it the same way",
    CalloutWrite.refreshSectionsFromDocument(doc, di).sketched === 1);

// ---------------------------------------------------------------------
// CLAIM 9: a DXF round trip preserves the block, the reference and
// every tag.
//
// The link between a section and its leader is XDATA and nothing else
// -- there is no side table in the drawing. If these tags do not
// survive a save, every sketched section decays into an unrelated block
// and a loose arrow the moment the file is reopened, and every
// in-memory claim above would still pass.
// ---------------------------------------------------------------------
(function() {
    var rtPath = QDir.tempPath() + "/cs_section_sketch_roundtrip.dxf";
    var rtFilter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        if (String(filters[f]).indexOf("dxflib") >= 0) {
            rtFilter = String(filters[f]);
            break;
        }
    }
    check("9: the drawing with a sketched section in it exports",
        di.exportFile(rtPath, rtFilter, false) === true);

    var rtDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var rtDi = new RDocumentInterface(rtDoc);
    check("9: the file reads back",
        rtDi.importFile(rtPath, "", false) ===
            RDocumentInterface.IoErrorNoError);

    var rt = CalloutWrite.members(rtDoc, id);
    check("9: the reference is found again BY ITS TAG", rt.block !== null);
    check("9: and its leader with it", rt.leaders.length === 1);
    if (rt.block === null) {
        check("9: the block definition survives", false);
        return;
    }
    var rtBlockId = rt.block.getData().getReferencedBlockId();
    check("9: the block definition survives under its own name",
        rtDoc.getBlockId(blockName) === rtBlockId);
    check("9: holding the tracing",
        blockTracing(rtDoc, rtBlockId).length === 1);
    check("9: and the station label with it",
        blockLabels(rtDoc, rtBlockId).length === 1);
    checkClose("9: the reference is still where it was placed (x)",
        rt.block.getData().getPosition().x, at.x, 1e-4);
    checkClose("9: the reference is still where it was placed (y)",
        rt.block.getData().getPosition().y, at.y, 1e-4);

    var keys = [CsCallout.KEY.ID, CsCallout.KEY.ROLE, CsCallout.KEY.KIND,
        CsCallout.KEY.STYLE, CsCallout.KEY.SIDE, CsCallout.KEY.LEADER,
        CsCallout.KEY.SECTION_SOURCE, CsCallout.KEY.SECTION_STATION,
        CsCallout.KEY.SECTION_SCALE, CsCallout.KEY.SECTION_SCAN,
        CsCallout.KEY.SECTION_FIT];
    for (var k = 0; k < keys.length; k++) {
        var was = CsTags.get(members.block, keys[k]);
        var now = CsTags.get(rt.block, keys[k]);
        check("9: tag " + keys[k] + " survives the round trip " +
            "(was \"" + was + "\", now \"" + now + "\")",
            was !== "" && now === was);
    }
    check("9: the leader's own role tag survives",
        rt.leaders.length === 1 &&
        CsTags.get(rt.leaders[0], CsCallout.KEY.ROLE) ===
            CsCallout.ROLE_LEADER);
    check("9: and the fit still parses on the far side",
        CsSectionBay.parseFit(
            CsTags.get(rt.block, CsCallout.KEY.SECTION_FIT)) !== null);
})();

// ---------------------------------------------------------------------
// CLAIM 10: Edit Sketch reopens it.
// ---------------------------------------------------------------------
var refIdBeforeEdit = CalloutWrite.members(doc, id).block.getId();
var leaderIdBeforeEdit = CalloutWrite.members(doc, id).leaders[0].getId();
di.selectEntity(refIdBeforeEdit, true);
check("10: fixture: the section is selected for Edit Sketch",
    doc.hasSelection() && doc.querySelectedEntities().length >= 1);

said = [];
SectionEdit.run();
// LOAD-BEARING FOR R2. The stored path is relative now, so if the
// reopen failed to resolve it against this cave's scans/ folder, this
// is where it says so: SectionEdit.run reports a scan it cannot find
// through SectionBay.say before the bay is even opened.
check("10: Edit Sketch reopened without complaint" +
    (said.length === 0 ? "" : " (said: " + said.join(" | ") + ")"),
    said.length === 0);

var reopened = SectionCapture.findBay(doc);
check("10: a bay is open again", reopened !== null);
check("10: at the same station",
    reopened !== null && reopened.station === "A2");
check("10: with the scan back under it", reopened !== null &&
    reopened.scan !== null &&
    CsTags.get(reopened.scan, CsCallout.KEY.SECTION_SCAN) === scanPath);
// The station label comes back loose too -- it was block content like
// the tracing. It is NOT swept into the next capture: capture drops it
// (SectionCapture.isStationLabel) and writes a fresh one, or a round
// trip would stack a label per edit.
var reopenedTraced = [], reopenedLabels = 0, rl;
if (reopened !== null) {
    for (rl = 0; rl < reopened.traced.length; rl++) {
        var rle = doc.queryEntity(reopened.traced[rl]);
        if (!isNull(rle) && rle.getType() === RS.EntityText) {
            reopenedLabels++;
        } else {
            reopenedTraced.push(reopened.traced[rl]);
        }
    }
}
check("10: and the linework loose inside it, ready to trace over",
    reopenedTraced.length === 1 &&
    String(reopenedTraced[0]) === String(tracedId));
check("10: with the station label back too", reopenedLabels === 1);

// AND THE NEXT CAPTURE WILL DROP IT rather than sweep it in beside a
// fresh one -- without that, every Edit Sketch round trip would leave
// another copy of the same station name at the same spot.
(function() {
    var seen = false;
    for (var q = 0; q < reopened.traced.length; q++) {
        var qe = doc.queryEntity(reopened.traced[q]);
        if (SectionCapture.isStationLabel(doc, qe)) { seen = true; }
    }
    check("10: and capture recognises it as a label to regenerate", seen);
})();

// ---------------------------------------------------------------------
// R2, the other half: the RELATIVE path stored on the drawing resolved
// back to the file on this machine. The check above already reads the
// reopened scan's tag as the absolute path; this names why that is the
// claim -- the drawing never held that string.
// ---------------------------------------------------------------------
check("R2: the reopen RESOLVED the relative path -- the drawing stored " +
    "\"" + storedPath + "\" and the bay came back with the real file",
    reopened !== null && reopened.scan !== null &&
    CsTags.get(reopened.scan, CsCallout.KEY.SECTION_SCAN) === scanPath &&
    storedPath !== scanPath);

// ---------------------------------------------------------------------
// R1, the other half: the reopened scan is back AT THE CAVER'S OWN
// FITTING, not at a fresh auto-fit.
//
// Measured off the reopened scan entity the same way capture measured
// it, so the two ends of the round trip are compared in the same terms:
// u and v exactly as they were, and the insertion point back at the
// same offset from the section's origin (the bay itself parks against
// the CURRENT plan extents and generally lands somewhere new, which is
// why the stored offset is relative and not absolute).
//
// This is the assertion the whole defect hid behind. Before the fix the
// reopened scan came back square and at the auto-fit's scale, and
// nothing in the drawing disagreed.
// ---------------------------------------------------------------------
(function() {
    if (reopened === null || reopened.scan === null || storedParsed === null) {
        check("R1: the reopened scan is back at the caver's own fitting",
            false);
        return;
    }
    var restored = SectionCapture.fitOfScan(reopened.scan,
        SectionCapture.originOf(reopened));
    if (restored === null) {
        check("R1: the reopened scan is back at the caver's own fitting",
            false);
        return;
    }
    checkClose("R1: the reopened scan keeps the caver's u vector (x)",
        restored.ux, storedParsed.ux, 1e-5);
    checkClose("R1: and its cross term -- the ROTATION survived the " +
        "round trip", restored.uy, storedParsed.uy, 1e-5);
    checkClose("R1: and the v vector's cross term with it",
        restored.vx, storedParsed.vx, 1e-5);
    checkClose("R1: and the v scale", restored.vy, storedParsed.vy, 1e-5);
    checkClose("R1: and the offset from the section's own origin (x)",
        restored.tx, storedParsed.tx, 1e-5);
    checkClose("R1: and (y)", restored.ty, storedParsed.ty, 1e-5);
    // NAMED SEPARATELY, because every one of the checks above would
    // also pass if the caver had never touched the scan: the point is
    // that this is NOT what SectionBay.addScan would have placed.
    var wouldAutoFit = CsSectionBay.fitTransform(
        { x1: 0, y1: 0, x2: 24, y2: 24 },
        SectionEdit.bayBoxOf(doc, reopened.id));
    check("R1: and that is NOT the auto-fit a fresh bay would have " +
        "used -- the caver's fitting was restored, not recomputed",
        Math.abs(restored.uy) > 1e-6 && wouldAutoFit.uy === 0);
})();

var back = doc.queryEntity(tracedId);
check("10: the linework is out of the block and back in model space",
    !isNull(back) && back.getBlockId() === doc.getModelSpaceBlockId());

var m10 = CalloutWrite.members(doc, id);
check("10: the placed reference is gone", m10.block === null);
check("10: and its leaders with it", m10.leaders.length === 0);
var liveAfterEdit = liveIds();
check("10: the reference really left the drawing, by id",
    liveAfterEdit[String(refIdBeforeEdit)] !== true);
check("10: and so did the leader",
    liveAfterEdit[String(leaderIdBeforeEdit)] !== true);

var goneBlockId = doc.getBlockId(blockName);
check("10: the emptied block definition is gone, not left as dead weight",
    goneBlockId === RBlock.INVALID_ID || goneBlockId < 0 ||
    isNull(doc.queryBlock(goneBlockId)));

// ---------------------------------------------------------------------
// FIXTURE: claim 10 (Edit Sketch) left a bay open and never re-captured
// it. F2 below asserts that Capture REFUSES when more than one bay is
// open -- which means a leftover open bay here would corrupt every
// section below it, not just F2's own. Closed the same way a caver
// would: SectionCapture.capture on the bay findBay hands back.
// ---------------------------------------------------------------------
(function() {
    var leftover = SectionCapture.findBay(doc);
    check("fixture: claim 10's reopened bay is found so it can be closed " +
        "before F1/F2/F3", leftover !== null);
    if (leftover !== null) {
        var leftoverAt = SectionCapture.proposePosition(doc, leftover);
        if (leftoverAt === null) {
            leftoverAt = { x: leftover.rect.x2 + 20, y: leftover.rect.y1 };
        }
        var closedId = SectionCapture.capture(doc, di, leftover, leftoverAt);
        check("fixture: and it closes", closedId !== null);
    }
    check("fixture: no bay is open going into R3/R4/F1/F2/F3",
        SectionCapture.findBay(doc) === null &&
        SectionCapture.findBayError === null);
})();

// ---------------------------------------------------------------------
// One sketched section, start to finish, for the claims below to work
// on: open a bay, trace one line in it, capture it where the march
// proposes (or clear of the bay when the march is boxed in -- the same
// fallback the leftover-closing fixture above uses).
//
// \return {id, tracedId} or null
// ---------------------------------------------------------------------
function sketchOne(station, label) {
    var openedId = SectionBay.run(scanPath, station);
    check(label + ": fixture: a bay opens at " + station, openedId !== null);
    var b0 = SectionCapture.findBay(doc);
    check(label + ": fixture: it is found", b0 !== null);
    if (b0 === null) {
        return null;
    }
    var c = SectionCapture.originOf(b0);
    var line = new RLineEntity(doc, new RLineData(
        new RVector(c.x - 2, c.y - 2), new RVector(c.x + 2, c.y + 2)));
    line.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
    var lop = new RAddObjectsOperation();
    lop.addObject(line, false);
    di.applyOperation(lop);

    var b1 = SectionCapture.findBay(doc);
    check(label + ": fixture: the tracing is swept",
        b1 !== null && b1.traced.length === 1);
    if (b1 === null) {
        return null;
    }
    var spot = SectionCapture.proposePosition(doc, b1);
    if (spot === null) {
        spot = { x: b1.rect.x2 + 20, y: b1.rect.y1 };
    }
    var newId = SectionCapture.capture(doc, di, b1, spot);
    check(label + ": fixture: it captures", newId !== null);
    return (newId === null) ? null : { id: newId, tracedId: line.getId() };
}

/** Select exactly one entity, with nothing else left over from an
 *  earlier claim -- SectionEdit.selectedSection takes the FIRST
 *  selected section it finds, and by this point in the run there are
 *  several placed sections that could be it. */
function selectOnly(entityId) {
    try {
        di.clearSelection();
    } catch (eSel) {
        // a build without clearSelection still has the add-select below
    }
    di.selectEntity(entityId, true);
}

// ---------------------------------------------------------------------
// R3 (review finding, silent data loss): a caver who scaled and turned
// a placed section gets it back scaled and turned after an edit round
// trip.
//
// CalloutWrite.refreshSections' own contract is that a section's
// position, scale and rotation are the CAVER'S -- that is why a
// sketched section is never regenerated. But reopening DELETES the
// reference (the section must exist in exactly one place at a time),
// which threw away the only record of both, and the re-capture built a
// fresh reference at RVector(1,1) and 0.0 unconditionally. One edit
// silently undid the caver's own scaling and rotation, and nothing on
// the drawing said so.
//
// The values ride on the BAY'S FRAME between the two halves -- the one
// piece of bay furniture guaranteed to outlive the whole bay, which is
// why the pre-bay snap class already rides there.
//
// NOT ASSERTED AS "the reference exists": that stayed green for the
// entire defect. The numbers themselves are the claim.
// ---------------------------------------------------------------------
(function() {
    // A2, the station claim 1 proved has a real cuttable LRUD. NOT A1:
    // the leg a cut at A1 is taken on runs back to A0, which is first
    // in the chain and therefore has no LRUD of its own, so the cut is
    // refused and the bay opens with no ghost -- which would make the
    // "back in the bay at 1:1" check below measure against the frame's
    // centre instead of the ghost's.
    var made = sketchOne("A2", "R3");
    if (made === null) {
        check("R3: a non-default scale and rotation survive an edit", false);
        return;
    }
    var placed = CalloutWrite.members(doc, made.id).block;
    if (placed === null) {
        check("R3: a non-default scale and rotation survive an edit", false);
        return;
    }

    // The caver scales and turns the placed section on the sheet.
    var wasAt = placed.getData().getPosition();
    var live = doc.queryEntity(placed.getId());
    live.scale(1.5, new RVector(wasAt.x, wasAt.y));
    live.rotate(0.4, new RVector(wasAt.x, wasAt.y));
    var mop = new RModifyObjectsOperation();
    mop.addObject(live, false);
    di.applyOperation(mop);

    var before = CalloutWrite.members(doc, made.id).block;
    var beforeScale = before.getData().getScaleFactors();
    var beforeRot = before.getData().getRotation();
    checkClose("R3: fixture: the caver's scale really is on the " +
        "reference", beforeScale.x, 1.5, 1e-6);
    checkClose("R3: fixture: and the caver's rotation", beforeRot, 0.4, 1e-6);

    // Edit Sketch: the reference is deleted and the bay comes back.
    said = [];
    selectOnly(before.getId());
    SectionEdit.run();
    check("R3: Edit Sketch reopened without complaint" +
        (said.length === 0 ? "" : " (said: " + said.join(" | ") + ")"),
        said.length === 0);

    var bay = SectionCapture.findBay(doc);
    check("R3: a bay is open again", bay !== null);
    if (bay === null) {
        check("R3: a non-default scale and rotation survive an edit", false);
        return;
    }
    check("R3: the reference is really gone, so the frame is the only " +
        "place its placement can be",
        CalloutWrite.members(doc, made.id).block === null);
    // The record, on the frame, on the drawing -- not merely in a
    // variable that happened to survive inside this process.
    checkClose("R3: the frame carries the caver's scale across the reopen",
        SectionCapture.scaleTagOf(bay.frame).x, 1.5, 1e-5);
    checkClose("R3: and the caver's rotation",
        SectionCapture.rotTagOf(bay.frame), 0.4, 1e-5);
    checkClose("R3: and findBay hands it to the capture (scale)",
        bay.refScale.x, 1.5, 1e-5);
    checkClose("R3: and findBay hands it to the capture (rotation)",
        bay.refRot, 0.4, 1e-5);

    // THE TRACING ITSELF COMES BACK 1:1. The ghost is a ruler at the
    // section's own scale, so a bay holding linework at the sheet's
    // presentation scale would be measuring against the wrong stick.
    var backIn = doc.queryEntity(made.tracedId);
    backIn.update();
    var bb = backIn.getBoundingBox();
    checkClose("R3: the tracing is back in the bay at 1:1, not at the " +
        "reference's scale",
        bb.getMaximum().x - bb.getMinimum().x, 4, 1e-5);

    // Re-capture, and the placement must come back with it.
    var spot = SectionCapture.proposePosition(doc, bay);
    if (spot === null) {
        spot = { x: bay.rect.x2 + 20, y: bay.rect.y1 };
    }
    var againId = SectionCapture.capture(doc, di, bay, spot);
    check("R3: it captures again", againId !== null);
    var again = (againId === null) ? null :
        CalloutWrite.members(doc, againId).block;
    check("R3: and there is a placed reference to look at", again !== null);
    if (again === null) {
        check("R3: a non-default scale and rotation survive an edit", false);
        return;
    }
    var againScale = again.getData().getScaleFactors();
    checkClose("R3: the caver's SCALE survived the round trip (x)",
        againScale.x, 1.5, 1e-5);
    checkClose("R3: the caver's SCALE survived the round trip (y)",
        againScale.y, 1.5, 1e-5);
    checkClose("R3: the caver's ROTATION survived the round trip",
        again.getData().getRotation(), 0.4, 1e-5);
})();

// ---------------------------------------------------------------------
// R4: a section captured BEFORE the fit carried rotation still reopens.
//
// The old fit was five numbers (sx, sy, rot, tx, ty) where six are now
// read, and its tx/ty were ABSOLUTE coordinates in a bay that no longer
// exists -- so CsSectionBay.parseFit returns null for it rather than
// reading five numbers as if they meant what six mean. Null must not
// mean "throw" and must not mean "no underlay": the scan is placed
// auto-fitted to the current ghost, which is the fitting those older
// sections were being restored at anyway.
//
// Simulated by writing an old-format tag onto a real captured section,
// which is exactly what a drawing saved by the previous build holds.
// ---------------------------------------------------------------------
(function() {
    check("R4: an old five-field fit parses as null, never as a fit " +
        "whose numbers mean something else",
        CsSectionBay.parseFit("0.050000,0.050000,0.000000,-5.000000," +
            "-2.500000") === null);

    var made = sketchOne("A3", "R4");
    if (made === null) {
        check("R4: a section with an old-format fit still reopens", false);
        return;
    }
    var placed = CalloutWrite.members(doc, made.id).block;
    if (placed === null) {
        check("R4: a section with an old-format fit still reopens", false);
        return;
    }
    // Downgrade its fit tag to the format the previous build wrote.
    var live = doc.queryEntity(placed.getId());
    CsTags.set(live, CsCallout.KEY.SECTION_FIT,
        "0.050000,0.050000,0.000000,-5.000000,-2.500000");
    var mop = new RModifyObjectsOperation();
    mop.addObject(live, false);
    di.applyOperation(mop);
    var stale = CalloutWrite.members(doc, made.id).block;
    check("R4: fixture: the section now carries an old-format fit, and " +
        "the parser refuses it",
        CsSectionBay.parseFit(
            CsTags.get(stale, CsCallout.KEY.SECTION_FIT)) === null);

    said = [];
    var threw = null;
    selectOnly(stale.getId());
    try {
        SectionEdit.run();
    } catch (e) {
        threw = String(e);
    }
    check("R4: reopening it does not throw" +
        (threw === null ? "" : " (threw " + threw + ")"), threw === null);
    check("R4: and it does not complain either" +
        (said.length === 0 ? "" : " (said: " + said.join(" | ") + ")"),
        said.length === 0);

    var bay = SectionCapture.findBay(doc);
    check("R4: the bay opened", bay !== null);
    check("R4: WITH the scan under it -- an unreadable fit costs the " +
        "caver the fitting, never the underlay",
        bay !== null && bay.scan !== null);
    if (bay !== null && bay.scan !== null) {
        var fallback = SectionCapture.fitOfScan(bay.scan,
            SectionCapture.originOf(bay));
        check("R4: and the scan is auto-fitted to the current ghost, " +
            "square, exactly as a brand-new bay would place it",
            fallback !== null && fallback.uy === 0 && fallback.vx === 0 &&
            fallback.ux > 0);
    } else {
        check("R4: and the scan is auto-fitted to the current ghost", false);
    }

    // Closed, so the two-open-bays claim below still measures what it
    // says it measures.
    if (bay !== null) {
        var spot = SectionCapture.proposePosition(doc, bay);
        if (spot === null) {
            spot = { x: bay.rect.x2 + 20, y: bay.rect.y1 };
        }
        check("R4: and it closes again",
            SectionCapture.capture(doc, di, bay, spot) !== null);
    }
    check("R4: no bay is left open", SectionCapture.findBay(doc) === null);
})();

// ---------------------------------------------------------------------
// R5 (review finding, D4): the proposed placement is DRAWN, not merely
// computed. SectionCapture.pickCoordinate used to store previewPos and
// return -- there was no getOperation, no previewOperation call, and
// previewPos was read nowhere at all, while the design spec's D4 and
// the command prompt both promise a live preview.
//
// The preview is GUI-only, so what is asserted here is the piece that
// is not: the operation the preview draws. Built through the same
// static entry point prototype.getOperation calls.
// ---------------------------------------------------------------------
(function() {
    var openedId = SectionBay.run(scanPath, "A2");
    check("R5: fixture: a bay opens", openedId !== null);
    var b0 = SectionCapture.findBay(doc);
    check("R5: fixture: it is found", b0 !== null);
    if (b0 === null) {
        check("R5: a proposed placement has something to draw", false);
        return;
    }
    check("R5: nothing traced, nothing to preview -- an empty bay draws " +
        "no ghost section",
        SectionCapture.previewOp(doc, b0, { x: 0, y: 0 }) === undefined);

    var c = SectionCapture.originOf(b0);
    var line = new RLineEntity(doc, new RLineData(
        new RVector(c.x - 2, c.y - 2), new RVector(c.x + 2, c.y + 2)));
    line.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
    var lop = new RAddObjectsOperation();
    lop.addObject(line, false);
    di.applyOperation(lop);
    var b1 = SectionCapture.findBay(doc);

    var op = SectionCapture.previewOp(doc, b1, { x: 200, y: 200 });
    check("R5: a traced bay previews its proposed placement",
        op !== undefined && op !== null);

    // THE ORIGINALS STAY PUT. The preview clones; moving the entities
    // themselves would drag the caver's tracing out of the bay on every
    // mouse move, and the bay would empty as they looked for a spot.
    var stillThere = doc.queryEntity(line.getId());
    stillThere.update();
    var sb = stillThere.getBoundingBox();
    checkClose("R5: and the tracing it previewed has NOT moved out of " +
        "the bay (x)", sb.getMinimum().x, c.x - 2, 1e-6);
    checkClose("R5: nor (y)", sb.getMinimum().y, c.y - 2, 1e-6);
    var b2 = SectionCapture.findBay(doc);
    check("R5: and it is still swept as part of the bay",
        b2 !== null && b2.traced.length === 1);

    // Closed again, so the two-open-bays claim below still holds.
    var spot = SectionCapture.proposePosition(doc, b2);
    if (spot === null) {
        spot = { x: b2.rect.x2 + 20, y: b2.rect.y1 };
    }
    check("R5: and the bay closes",
        SectionCapture.capture(doc, di, b2, spot) !== null);
})();

// ---------------------------------------------------------------------
// CAL: a bay opened with a scale calibrated in the Sketch Scans preview
// places the scan AT THAT SCALE, and the SectionBayFit that SectionEdit
// reads back on reopen carries the same scale.
//
// THE SCALE IS THE WHOLE FEATURE. The caver clicks the station and a
// wall in the preview pane, the tool divides the station's own LRUD by
// the pixels between the clicks, and the bay opens the right size
// instead of auto-fitted to the ghost's width. Everything upstream of
// SectionBay.run is GUI (two clicks in a dock), so what is asserted
// here is the piece that is not: that a supplied scale reaches the
// placed image, and survives capture into the tag.
//
// READ STRAIGHT OFF THE RImageData, never through
// CsSectionBay.fitAtScale or SectionCapture.fitOfScan. Using the
// feature's own maths as the oracle for the feature's own output is
// self-confirming -- a fitAtScale that halved every scale would produce
// an expectation that halved with it and stayed green. The expected
// numbers below are LITERALS.
// ---------------------------------------------------------------------
(function() {
    // The fixture's stations all carry LRUD { l:4, r:4, u:3, d:2 }.
    // 3 units up, 150 px up the page, at section scale 2:
    // 3 * 2 / 150 = 0.04 drawing units per pixel.
    var calLrud = SectionBay.lrudAt(doc, "A2");
    check("CAL: fixture: the station's own LRUD is readable from the " +
        "drawing, which is where the known distance comes from",
        calLrud !== null && calLrud.up === 3);

    var cal = CsSectionBay.calibrationFrom({ x: 400, y: 200 },
        { x: 400, y: 350 }, calLrud, 2, null);
    check("CAL: fixture: an upward pair infers U", cal.letter === "U");
    checkClose("CAL: fixture: and comes to 0.04 units per pixel",
        cal.unitsPerPixel, 0.04, 1e-12);

    var calBayId = SectionBay.run(scanPath, "A2",
        { unitsPerPixel: cal.unitsPerPixel });
    check("CAL: a bay opens with a calibrated scale", calBayId !== null);
    var calBay = SectionCapture.findBay(doc);
    check("CAL: it is found, and it has a scan",
        calBay !== null && calBay.scan !== null);

    if (calBay === null || calBay.scan === null) {
        check("CAL: the scan is placed at the calibrated scale", false);
        check("CAL: and the stored SectionBayFit carries it", false);
        return;
    }

    // THE u AND v VECTORS ARE DRAWING UNITS PER IMAGE PIXEL -- that is
    // what RImageData carries and what makes this comparison direct.
    var calData = calBay.scan.getData();
    var calU = calData.getUVector();
    var calV = calData.getVVector();
    checkClose("CAL: the scan is placed at the calibrated scale (u.x)",
        calU.x, 0.04, 1e-9);
    checkClose("CAL: uniform, never squashed (v.y)", calV.y, 0.04, 1e-9);
    check("CAL: and axis-aligned -- this workflow has no rotation to " +
        "solve, because a section is scanned with up as up",
        Math.abs(calU.y) < 1e-9 && Math.abs(calV.x) < 1e-9);

    // AND IT IS NOT WHAT THE AUTO-FIT WOULD HAVE DONE. Without this,
    // the claim above would pass on a build that ignored the
    // calibration entirely, if the auto-fit happened to land nearby.
    var calGhostBox = calBay.ghost.getBoundingBox();
    var autoK = (calGhostBox.getMaximum().x - calGhostBox.getMinimum().x) /
        (new QImage(scanPath)).width();
    check("CAL: fixture: the auto-fit would have used a DIFFERENT scale " +
        "(" + autoK + " vs 0.04), so the claim above can fail",
        Math.abs(autoK - 0.04) > 1e-3);

    // The fit reaches the TAG by reaching the entity: SectionCapture
    // measures the scan as the caver left it, and SectionBay writes
    // no fit tag of its own (see claim 4).
    check("CAL: the bay's scan still carries NO fit tag -- a calibration " +
        "is a better starting point, not a final answer",
        CsTags.get(calBay.scan, CsCallout.KEY.SECTION_FIT) === "");

    var calCentre = SectionCapture.originOf(calBay);
    var calLine = new RLineEntity(doc, new RLineData(
        new RVector(calCentre.x - 2, calCentre.y - 2),
        new RVector(calCentre.x + 2, calCentre.y + 2)));
    calLine.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
    var calTraceOp = new RAddObjectsOperation();
    calTraceOp.addObject(calLine, false);
    di.applyOperation(calTraceOp);

    var calBay2 = SectionCapture.findBay(doc);
    check("CAL: fixture: the tracing is swept",
        calBay2 !== null && calBay2.traced.length === 1);
    var calAt = (calBay2 === null) ? null :
        SectionCapture.proposePosition(doc, calBay2);
    if (calAt === null && calBay2 !== null) {
        calAt = { x: calBay2.rect.x2 + 20, y: calBay2.rect.y1 };
    }
    var calCallout = (calBay2 === null) ? null :
        SectionCapture.capture(doc, di, calBay2, calAt);
    check("CAL: fixture: the bay captures", calCallout !== null);

    var calMembers = (calCallout === null) ? null :
        CalloutWrite.members(doc, calCallout);
    var calStored = (calMembers === null || isNull(calMembers.block)) ?
        null : CsSectionBay.parseFit(
            CsTags.get(calMembers.block, CsCallout.KEY.SECTION_FIT));
    check("CAL: the captured section stores a SectionBayFit",
        calStored !== null);
    checkClose("CAL: and it is the CALIBRATED scale, so a reopened " +
        "sketch comes back the size the caver measured (ux)",
        calStored === null ? -1 : calStored.ux, 0.04, 1e-6);
    checkClose("CAL: in both axes (vy)",
        calStored === null ? -1 : calStored.vy, 0.04, 1e-6);
})();

// ---------------------------------------------------------------------
// CAL2: WITHOUT a calibration, nothing changes. Skipping or cancelling
// the calibration is a supported way to open a bay -- scaling the scan
// by hand over the ghost is a workflow that already works -- so the
// auto-fit must still be exactly the auto-fit.
// ---------------------------------------------------------------------
(function() {
    var plainId = SectionBay.run(scanPath, "A2", null);
    check("CAL2: a bay opens with no calibration at all", plainId !== null);
    var plainBay = SectionCapture.findBay(doc);
    check("CAL2: it is found, and it has a scan",
        plainBay !== null && plainBay.scan !== null);
    if (plainBay === null || plainBay.scan === null) {
        check("CAL2: the scan is auto-fitted to the ghost's width", false);
        return;
    }
    var plainGhost = plainBay.ghost.getBoundingBox();
    var plainWidth = plainGhost.getMaximum().x - plainGhost.getMinimum().x;
    var plainK = plainWidth / (new QImage(scanPath)).width();
    var plainU = plainBay.scan.getData().getUVector();
    checkClose("CAL2: the scan is auto-fitted to the ghost's WIDTH, " +
        "exactly as before", plainU.x, plainK, 1e-9);
    check("CAL2: and that is not the calibrated scale, so the two " +
        "paths really are different",
        Math.abs(plainU.x - 0.04) > 1e-3);

    // Closed again, so the two-open-bays claim below still holds.
    var plainCentre = SectionCapture.originOf(plainBay);
    var plainLine = new RLineEntity(doc, new RLineData(
        new RVector(plainCentre.x - 2, plainCentre.y - 2),
        new RVector(plainCentre.x + 2, plainCentre.y + 2)));
    plainLine.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
    var plainOp = new RAddObjectsOperation();
    plainOp.addObject(plainLine, false);
    di.applyOperation(plainOp);
    var plainBay2 = SectionCapture.findBay(doc);
    var plainAt = (plainBay2 === null) ? null :
        SectionCapture.proposePosition(doc, plainBay2);
    if (plainAt === null && plainBay2 !== null) {
        plainAt = { x: plainBay2.rect.x2 + 20, y: plainBay2.rect.y1 };
    }
    check("CAL2: and the bay closes",
        plainBay2 !== null &&
        SectionCapture.capture(doc, di, plainBay2, plainAt) !== null);
})();

// ---------------------------------------------------------------------
// BAY (found by the user, in their own cave): the frame must CONTAIN
// the scan.
//
// MEASURED IN THEIR DRAWING: a frame 30.00 x 30.00 around a scan
// 192.19 x 268.65 -- the scan six to nine times the bay it is supposed
// to sit inside. The scan itself was right (u = v = 0.1292 units per
// pixel, aspect preserved); the frame was sized from the GHOST alone
// and never looked at how big the scan would be.
//
// IT IS NOT A COSMETIC FAULT. Capture sweeps what is geometrically
// INSIDE the frame, so a caver tracing over the eight-ninths of the
// scan hanging outside loses that work at capture, in silence. This is
// the assertion that would have caught it: the frame as the drawing
// holds it, against the scan's own bounding box as the drawing holds
// THAT -- neither one recomputed from the maths under test.
//
// A REAL PAGE, at a real page's pixel count. The suite's other claims
// underlay a 24 x 24 icon, which auto-fits to the ghost and can never
// overflow anything: no existing fixture here could have failed.
// ---------------------------------------------------------------------
(function() {
    var pagePath = scansDir + "/fieldbook_page.png";
    (new QFile(pagePath)).remove();
    var page = new QImage(1488, 2080, QImage.Format_RGB32);
    page.fill(new QColor(250, 248, 240));
    // save() needs its format NAMED on this build -- probed 2026-08-30:
    // the one-argument form returns false and writes nothing, so a
    // fixture that trusted it would leave every claim below measuring
    // an unreadable file.
    check("BAY: fixture: a page-sized scan is written into the cave's " +
        "scans/ folder", page.save(pagePath, "PNG") === true);
    var pageBack = new QImage(pagePath);
    check("BAY: fixture: and it reads back at a real page's pixel count",
        !pageBack.isNull() && pageBack.width() === 1488 &&
        pageBack.height() === 2080);

    // The user's own calibration: 0.1292 drawing units per pixel, which
    // makes this page 192 x 269 units of drawing.
    var bigId = SectionBay.run(pagePath, "A2",
        { unitsPerPixel: 0.1292 });
    check("BAY: a bay opens for a page-sized scan", bigId !== null);
    var big = SectionCapture.findBay(doc);
    check("BAY: it is found, with its scan and its ghost",
        big !== null && big.scan !== null && big.ghost !== null);
    if (big === null || big.scan === null) {
        check("BAY: the frame CONTAINS the scan", false);
        return;
    }

    // Bounding boxes are CACHED in this engine: update() before reading
    // one back off an entity that was placed this run.
    big.scan.update();
    var sbb = big.scan.getBoundingBox();
    var scanBox = { x1: sbb.getMinimum().x, y1: sbb.getMinimum().y,
                    x2: sbb.getMaximum().x, y2: sbb.getMaximum().y };
    var scanW = scanBox.x2 - scanBox.x1, scanH = scanBox.y2 - scanBox.y1;
    var frameW = big.rect.x2 - big.rect.x1, frameH = big.rect.y2 - big.rect.y1;
    checkClose("BAY: fixture: the scan really is placed at the " +
        "calibrated scale -- 1488 px at 0.1292", scanW, 192.2496, 1e-3);
    checkClose("BAY: fixture: and 2080 px tall with it", scanH, 268.736,
        1e-3);
    check("BAY: fixture: which is far bigger than the ghost, so this " +
        "claim can fail (scan " + scanW + " vs ghost " +
        (big.ghost.getBoundingBox().getMaximum().x -
         big.ghost.getBoundingBox().getMinimum().x) + ")",
        scanW > 100);

    check("BAY: THE FRAME CONTAINS THE SCAN -- the whole of it, which " +
        "is the whole of what Capture will sweep (frame " + frameW +
        " x " + frameH + ", scan " + scanW + " x " + scanH + ")",
        CsSectionBay.contains(big.rect, scanBox));

    // AND STILL CONTAINS THE GHOST. Sizing to the scan alone would
    // pass the claim above and lose the outline the scan is scaled
    // against.
    big.ghost.update();
    var gbb = big.ghost.getBoundingBox();
    check("BAY: and the ghost with it",
        CsSectionBay.contains(big.rect,
            { x1: gbb.getMinimum().x, y1: gbb.getMinimum().y,
              x2: gbb.getMaximum().x, y2: gbb.getMaximum().y }));

    // A TRACING OVER THE FAR CORNER OF THE SCAN IS SWEPT. The
    // containment above is the cause; this is the consequence the
    // caver actually loses -- work traced over the part of the scan
    // that used to hang outside the frame.
    var far = new RLineEntity(doc, new RLineData(
        new RVector(scanBox.x2 - 4, scanBox.y2 - 4),
        new RVector(scanBox.x2 - 1, scanBox.y2 - 1)));
    far.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
    var farOp = new RAddObjectsOperation();
    farOp.addObject(far, false);
    di.applyOperation(farOp);
    var bigTraced = SectionCapture.findBay(doc);
    check("BAY: a tracing over the FAR corner of the scan is swept, " +
        "rather than dropped for being outside the frame",
        bigTraced !== null && bigTraced.traced.length === 1);

    // Closed again, so the two-open-bays claim further down still holds.
    var bigAt = (bigTraced === null) ? null :
        SectionCapture.proposePosition(doc, bigTraced);
    if (bigAt === null && bigTraced !== null) {
        bigAt = { x: bigTraced.rect.x2 + 20, y: bigTraced.rect.y1 };
    }
    var bigCallout = (bigTraced === null) ? null :
        SectionCapture.capture(doc, di, bigTraced, bigAt);
    check("BAY: and the bay closes", bigCallout !== null);

    // ---- REOPENED, the frame still has to contain the scan ----------
    // Edit Sketch opens its bay with NO path (it places the scan itself,
    // at the fit stored on the section), so a frame sized from the
    // ghost alone overflows on the SECOND open exactly as it did on the
    // first -- and a caver reopening a sketch to add detail is the case
    // where there is already work to lose.
    var bigRef = (bigCallout === null) ? null :
        CalloutWrite.members(doc, bigCallout).block;
    if (bigRef === null || isNull(bigRef)) {
        check("BAY: reopened, the frame still contains the scan", false);
        return;
    }
    di.clearSelection();
    di.selectEntity(bigRef.getId(), true);
    said = [];
    SectionEdit.run();
    check("BAY: fixture: Edit Sketch reopens the page-sized sketch" +
        (said.length === 0 ? "" : " (said: " + said.join(" | ") + ")"),
        said.length === 0);
    var reBay = SectionCapture.findBay(doc);
    check("BAY: fixture: the reopened bay is found, with its scan",
        reBay !== null && reBay.scan !== null);
    if (reBay !== null && reBay.scan !== null) {
        reBay.scan.update();
        var rbb = reBay.scan.getBoundingBox();
        var reBox = { x1: rbb.getMinimum().x, y1: rbb.getMinimum().y,
                      x2: rbb.getMaximum().x, y2: rbb.getMaximum().y };
        checkClose("BAY: fixture: the reopened scan is back at the size " +
            "it was captured at", reBox.x2 - reBox.x1, 192.2496, 1e-3);
        check("BAY: reopened, the frame still contains the scan " +
            "(frame " + (reBay.rect.x2 - reBay.rect.x1) + " x " +
            (reBay.rect.y2 - reBay.rect.y1) + ")",
            CsSectionBay.contains(reBay.rect, reBox));

        // Closed again, so the two-open-bays claim further down holds.
        var reAt = SectionCapture.proposePosition(doc, reBay);
        if (reAt === null) {
            reAt = { x: reBay.rect.x2 + 20, y: reBay.rect.y1 };
        }
        check("BAY: and the reopened bay closes",
            SectionCapture.capture(doc, di, reBay, reAt) !== null);
    } else {
        check("BAY: reopened, the frame still contains the scan", false);
        check("BAY: and the reopened bay closes", false);
    }
})();

// ---------------------------------------------------------------------
// NBR: a section AT a station is not refused for its NEIGHBOUR's
// missing LRUD.
//
// A0 is the first station of this chain, so it has no LRUD of its own
// -- LRUD is recorded with the shot INTO a station, and nothing shoots
// into the first one. A section at A1 is taken on the leg A0->A1 at
// t = 1, where A0's outline is weighted zero and contributes nothing.
// It used to be required anyway, and the refusal came back in A0's
// name for a section the caver asked for at A1.
//
// This is why the fixture at the top of this file has FOUR stations:
// A0 exists only so that A1's own neighbour is not the thin one. That
// workaround is what made the defect invisible here.
// ---------------------------------------------------------------------
(function() {
    var nbr = CsRevise.resolveAsDrawn(doc);
    var leg = CsSectionCut.nearestLeg(nbr.resolved, { x: -10, y: 0 });
    check("NBR: fixture: a section at A1 is taken on the leg from A0",
        leg !== null && leg.from === "A0" && leg.to === "A1");
    checkClose("NBR: fixture: and exactly AT A1, which is why the far " +
        "end contributes nothing to it", leg === null ? -1 : leg.t, 1,
        1e-12);
    var frameA = CsSectionCut.frameForLeg(nbr.resolved, "A0", "A1").frame;
    var poly0 = CsSectionCut.polygonAt(nbr.survey, nbr.resolved, "A0",
        frameA, {});
    check("NBR: fixture: A0 really has too few wall points to cut -- " +
        "otherwise this claim proves nothing",
        poly0 === null || poly0.measured < CsSectionCut.MIN_POINTS);

    var cutA1 = CsSectionCut.cut(nbr.survey, nbr.resolved, "A0", "A1",
        leg === null ? 1 : leg.t, {});
    check("NBR: the cut at A1 succeeds anyway" +
        (cutA1.refused === true ? " (refused: " + cutA1.reason + ")" : ""),
        cutA1.refused === undefined);

    var saidBefore = said.length;
    var nbrId = SectionBay.run(scanPath, "A1");
    check("NBR: a bay opens at A1", nbrId !== null);
    check("NBR: with no complaint about a station the caver did not " +
        "pick" + (said.length === saidBefore ? "" :
            " (said: " + said[said.length - 1] + ")"),
        said.length === saidBefore);
    var nbrBay = SectionCapture.findBay(doc);
    check("NBR: and it has a real computed ghost, which is the whole " +
        "point of the bay", nbrBay !== null && nbrBay.ghost !== null);

    // Closed again, so the two-open-bays claim further down still holds.
    if (nbrBay !== null) {
        var nbrCentre = SectionCapture.originOf(nbrBay);
        var nbrLine = new RLineEntity(doc, new RLineData(
            new RVector(nbrCentre.x - 2, nbrCentre.y - 2),
            new RVector(nbrCentre.x + 2, nbrCentre.y + 2)));
        nbrLine.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
        var nbrOp = new RAddObjectsOperation();
        nbrOp.addObject(nbrLine, false);
        di.applyOperation(nbrOp);
        var nbrBay2 = SectionCapture.findBay(doc);
        var nbrAt = (nbrBay2 === null) ? null :
            SectionCapture.proposePosition(doc, nbrBay2);
        if (nbrAt === null && nbrBay2 !== null) {
            nbrAt = { x: nbrBay2.rect.x2 + 20, y: nbrBay2.rect.y1 };
        }
        check("NBR: and the bay closes",
            nbrBay2 !== null &&
            SectionCapture.capture(doc, di, nbrBay2, nbrAt) !== null);
    } else {
        check("NBR: and the bay closes", false);
    }
})();

// ---------------------------------------------------------------------
// F1 (review finding, data loss): capture() must not lose the block
// reference (or strand the tracing in an unreferenced block) when the
// annotation layer -- CsCallout.STYLES["annotation"], where the
// reference and its leader land -- happens to be OFF.
//
// Before the fix, SectionCapture.capture's applyOperation was wrapped
// in CsLayers.withLayerOn only for CTRL-SECTION-BOX/GHOST/SCAN. An OFF
// layer refuses an add SILENTLY in this build while the REST of a mixed
// operation still commits: the tracing still moved into the block, the
// bay's furniture still tore down, capture() still returned a fresh
// id -- and the reference that was supposed to point at the block
// simply never existed. Nothing said so.
//
// Asserted via CalloutWrite.members(), never isNull() -- see this
// file's header for why an isNull() check cannot see a silently
// refused add (or a silently refused delete) in this build.
// ---------------------------------------------------------------------
(function() {
    var annotationLayerName = CsCallout.STYLES["annotation"];
    var annotationLayer = doc.queryLayer(annotationLayerName);
    check("F1: fixture: the annotation layer exists (an earlier capture " +
        "already created it)", !isNull(annotationLayer));
    if (!isNull(annotationLayer)) {
        annotationLayer.setOff(true);
        var offOp = new RModifyObjectsOperation();
        offOp.addObject(annotationLayer, false);
        di.applyOperation(offOp);
    }
    check("F1: fixture: the annotation layer is off going into the capture",
        !isNull(doc.queryLayer(annotationLayerName)) &&
        doc.queryLayer(annotationLayerName).isOff());

    var f1BayId = SectionBay.run(scanPath, "A1");
    check("F1: fixture: a bay opens for this claim", f1BayId !== null);

    var f1Bay0 = SectionCapture.findBay(doc);
    check("F1: fixture: it is found", f1Bay0 !== null);

    if (f1Bay0 !== null) {
        var f1Centre = SectionCapture.originOf(f1Bay0);
        var f1Traced = new RLineEntity(doc, new RLineData(
            new RVector(f1Centre.x - 2, f1Centre.y - 2),
            new RVector(f1Centre.x + 2, f1Centre.y + 2)));
        f1Traced.setLayerId(doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED));
        var f1TraceOp = new RAddObjectsOperation();
        f1TraceOp.addObject(f1Traced, false);
        di.applyOperation(f1TraceOp);
        var f1TracedId = f1Traced.getId();

        var f1Bay1 = SectionCapture.findBay(doc);
        check("F1: fixture: the tracing is swept",
            f1Bay1 !== null && f1Bay1.traced.length === 1);

        var f1At = (f1Bay1 === null) ? null :
            SectionCapture.proposePosition(doc, f1Bay1);
        check("F1: fixture: a position is proposed", f1At !== null);

        var f1Id = (f1Bay1 === null || f1At === null) ? null :
            SectionCapture.capture(doc, di, f1Bay1, f1At);

        var f1Members = CalloutWrite.members(doc, f1Id);
        check("F1: the reference lands even though its own layer was " +
            "off -- the annotation-layer add is no longer unguarded",
            f1Members.block !== null);
        check("F1: and its leader lands with it",
            f1Members.leaders.length === 1);

        // NOT STRANDED: the tracing belongs to the SAME block the
        // (landed) reference points at, rather than an orphaned
        // definition nothing refers to.
        if (f1Members.block !== null) {
            var f1BlockId = f1Members.block.getData()
                .getReferencedBlockId();
            var f1InBlock = blockTracing(doc, f1BlockId);
            check("F1: the tracing is not stranded -- it is IN the " +
                "reference's own block, not an unreferenced one",
                f1InBlock.length === 1 &&
                String(f1InBlock[0]) === String(f1TracedId));
        } else {
            check("F1: the tracing is not stranded", false);
        }
    } else {
        check("F1: the reference lands even though its own layer was off",
            false);
        check("F1: and its leader lands with it", false);
        check("F1: the tracing is not stranded", false);
    }
})();

// ---------------------------------------------------------------------
// CLAIM FT: a Feature Trace tile ROUTES ITSELF into an open bay.
//
// THE BUG THIS EXISTS FOR, in its first form: every Cross Section tile
// in Feature Trace was inert. CsLayers.frameOf("SECTION-WALLS-SURVEYED")
// answers "section", CsTrace.frameIn could only ever answer "plan" or
// "profile", and the old FeatureTraceRun.frameGuard refused whenever
// the two disagreed -- so the guard refused every section stroke there
// was, and the caver's first real cross-section sketching session drew
// nothing at all.
//
// The tiles are per-FEATURE now and there is no guard left to refuse
// anything, so the claim has grown a second half. It is no longer "the
// section tile is allowed to draw here": it is that the PLAN tile,
// dragged inside a bay, lands on SECTION-WALLS-SURVEYED by itself --
// the routing this tool's second design rests on, asserted in linework
// rather than in a return value. And that the line it draws knows
// which station it is a section of, which nothing else can tell it
// later: CsBind refuses the section frame, and Capture tears the bay
// down.
//
// DRIVEN THROUGH commit() ON A STAND-IN `this`, not through a mouse.
// The drag capture is mouse-only, but everything the refusal lived in
// -- the whole-path frame test, the armed layer's frame, the emit --
// is in commit(), and commit only ever reaches the action through
// getDocument/getDocumentInterface/samples/region/bays/refreshRegion.
//
// MUTATION-TESTED. Deleting the section case from CsTrace.frameIn (the
// `if (CsTrace.inAnyRect(bays, point)) return "section";` line) turns
// the landing claim red with "FT: the stroke LANDS on the armed
// section layer -- expected 1, got 0".
//
// Runs where no bay is open (F1 captured its own), so it opens its own
// and leaves it: F2 below opens two more and only asserts that Capture
// refuses to guess among them, which more bays cannot falsify.
// ---------------------------------------------------------------------
(function() {
    var ftBayId = SectionBay.run(scanPath, "A1");
    check("FT: fixture: a bay opens for the trace", ftBayId !== null);
    var ftBay = SectionCapture.findBay(doc);
    check("FT: fixture: and it is the only one open", ftBay !== null);
    if (ftBay === null) {
        check("FT: the stroke LANDS on the armed section layer", false);
        return;
    }

    // Every refusal captured rather than printed: a refusal is the
    // failure mode under test, so its text is evidence.
    var ftSaid = [];
    var realMessage = EAction.handleUserMessage;
    EAction.handleUserMessage = function(text) { ftSaid.push(String(text)); };

    var ftLayerId = doc.getLayerId(CsLayers.SECTION_WALLS_SURVEYED);
    // The IDS, not just the count: earlier claims have left their own
    // section walls on this layer, so "the last one" is whichever the
    // index happens to hand back. The stroke this claim draws is the
    // one that was not there a moment ago.
    var ftWas = {};
    var ftPrior = doc.queryLayerEntities(ftLayerId, true);
    for (var pi = 0; pi < ftPrior.length; pi++) {
        ftWas[ftPrior[pi]] = true;
    }
    var ftBefore = ftPrior.length;

    // Armed the way the panel arms it, so this cannot pass with a
    // target the real dock would never set -- and the panel only ever
    // arms the PLAN-frame base now. Nothing here mentions the section
    // layer the stroke has to reach; commit() derives it from where the
    // samples land, which is the point.
    FeatureTrace.armLayer(CsLayers.WALLS_SURVEYED);
    check("FT: fixture: the Surveyed Walls tile is armed, plan-frame",
        FeatureTraceRun.baseLayer(doc) === CsLayers.WALLS_SURVEYED);

    var ftCentre = SectionCapture.originOf(ftBay);
    var ftSamples = [];
    for (var si = 0; si <= 8; si++) {
        ftSamples.push({ x: ftCentre.x - 2 + si * 0.5,
                         y: ftCentre.y - 2 + si * 0.4 });
    }
    var ftAction = {
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: ftSamples,
        region: null,
        bays: [],
        refreshRegion: FeatureTraceRun.prototype.refreshRegion,
        // commit() calls both of these on `this` after a successful
        // emit. Listed rather than inherited, so a stand-in that has
        // gone stale against the real action fails HERE, loudly, rather
        // than turning a routing claim into a "not a function" throw.
        stampSection: FeatureTraceRun.prototype.stampSection,
        warnUnclaimedProfile: FeatureTraceRun.prototype.warnUnclaimedProfile,
        // commit() asks this before it draws, to decide whether the
        // stroke grows a line already there or makes a new one.
        extendTarget: FeatureTraceRun.prototype.extendTarget
    };
    // As beginEvent does: the caches the guard reads are filled from
    // the document before the stroke is judged.
    ftAction.refreshRegion();
    check("FT: fixture: the open bay is seen as section-frame ground",
        ftAction.bays.length === 1 &&
        CsTrace.frameIn(ftAction.region, ftCentre, ftAction.bays) ===
            "section");

    try {
        FeatureTraceRun.prototype.commit.call(ftAction);
    } finally {
        EAction.handleUserMessage = realMessage;
        FeatureTrace.target = undefined;
    }

    var ftAfter = doc.queryLayerEntities(ftLayerId, true).length;
    check("FT: the stroke LANDS on the armed section layer -- expected " +
        (ftBefore + 1) + ", got " + ftAfter +
        (ftSaid.length === 0 ? "" : " (said: " + ftSaid.join(" | ") + ")"),
        ftAfter === ftBefore + 1);
    check("FT: and nothing was refused" +
        (ftSaid.length === 0 ? "" : " (said: " + ftSaid.join(" | ") + ")"),
        ftSaid.length === 1 && ftSaid[0].indexOf("sampled") >= 0);

    // Inside the BAY, not merely on the layer: a section layer is
    // global, so landing on it proves nothing about where the linework
    // went. The capture sweep is geometric, and only what is inside the
    // frame becomes the block.
    var ftBay2 = SectionCapture.findBay(doc);
    check("FT: and the capture sweep picks it up -- it is inside the " +
        "frame, which is what makes it part of the section",
        ftBay2 !== null && ftBay2.traced.length === 1);

    // The STATION stamp. Between tracing and capturing -- which can be
    // days, and may never happen -- this tag is the drawing's only
    // record of which station the linework describes.
    var ftLanded = doc.queryLayerEntities(ftLayerId, true);
    var ftStamped = null;
    for (var li = 0; li < ftLanded.length; li++) {
        if (ftWas[ftLanded[li]] !== true) {
            ftStamped = doc.queryEntity(ftLanded[li]);
        }
    }
    check("FT: the traced line carries the station its bay was opened at",
        ftStamped !== null &&
        CsTags.get(ftStamped, FeatureTraceRun.STATION_TAG) === "A1");
    check("FT: and the bay it was drawn in",
        ftStamped !== null &&
        CsTags.get(ftStamped, FeatureTraceRun.BAY_TAG) === ftBayId);

    // Tear the bay down again, so the next claim starts from "no bay
    // open" rather than inheriting this one. findBay refuses outright
    // while two bays are open, so a claim that left its bay behind
    // would break the next one's fixture rather than its subject.
    if (ftBay2 !== null) {
        var ftAt = SectionCapture.proposePosition(doc, ftBay2);
        SectionCapture.capture(doc, di, ftBay2,
            ftAt === null ? { x: 0, y: -80 } : ftAt);
    }
    check("FT: fixture: the bay is closed again for the next claim",
        SectionCapture.findBay(doc) === null);
})();

// ---------------------------------------------------------------------
// CLAIM SL: a Shaped Lines symbol drawn in a bay is SECTION linework.
//
// A DIFFERENT BUG FROM CLAIM FT'S, with a worse failure mode. Shaped
// Lines never had a frame guard to refuse anything -- it routes by
// LOCATION, one button serving every view. So a ledge drawn inside a
// bay was not refused: CsTrace.pathFrame answered "plan" (no bays in
// the frame test) and CsShapeLine.layersFor had no section entry at
// all, so the feature landed on LEDGE-FLOOR and was tagged
// ShapeFrame=plan. It LOOKED correct -- the hachures appeared under
// the cursor -- while being plan ink inside a section bay, counted in
// the plan's data window, and swept into the block by a capture that
// selects geometrically rather than by layer.
//
// So the claim is not "something was drawn". It is "what was drawn is
// on the SECTION family", which is the assertion the old code fails
// while still drawing a perfectly good-looking ledge.
//
// MUTATION-TESTED, twice, because there are two independent halves and
// either one alone leaves the bug half-fixed:
//   * dropping `this.bays` from ShapedLinesRun.prepare's pathFrame call
//     (it moved there when the side pick was added; commit now uses
//     the frame prepare decided)
//     -> "SL: the SPINE lands on the section family -- expected
//        SECTION-LEDGE-FLOOR, got LEDGE-FLOOR"
//   * deleting the SECTION_TWIN branch from CsShapeLine.layersFor
//     -> "SL: the SPINE lands on the section family -- expected
//        SECTION-LEDGE-FLOOR, got LEDGE-FLOOR"
//
// That second mutation is why the expected layer names below are
// LITERALS. Asked of layersFor instead, the expectation moved with the
// bug and the whole claim stayed green through it.
//
// THE REGENERATION IS PROVEN, NOT ASSUMED. CsShapeLine.reconcile is
// the exact function ShapedLinesListener calls on every transaction
// that touches a shaped line; only the transaction plumbing differs.
// Calling it directly after moving the spine (which changes the
// signature, so decorate() cannot short-circuit as "unchanged") proves
// the REBUILT ornament still lands on the section family -- the half
// that lives in CsShapeLine.frameOfSpine rather than in the draw tool.
// ---------------------------------------------------------------------
(function() {
    var slBayId = SectionBay.run(scanPath, "A2");
    check("SL: fixture: a bay opens for the symbol", slBayId !== null);
    var slBay = SectionCapture.findBay(doc);
    check("SL: fixture: and it is the only one open", slBay !== null);
    if (slBay === null) {
        check("SL: the SPINE lands on the section family", false);
        check("SL: the DECOR lands on the section family", false);
        check("SL: the regenerated decor stays on the section family", false);
        return;
    }

    var slSaid = [];
    var realMessage = EAction.handleUserMessage;
    EAction.handleUserMessage = function(text) { slSaid.push(String(text)); };

    var slCentre = SectionCapture.originOf(slBay);
    var slSamples = [];
    for (var sj = 0; sj <= 12; sj++) {
        slSamples.push({ x: slCentre.x - 3 + sj * 0.5, y: slCentre.y + 1 });
    }
    // The draw action is now TWO steps: prepare() fits the spine and
    // decides the view at the release, then the caver points at the low
    // side and commit() places it. The stroke is driven through both,
    // in that order, because that is the order the mouse drives them.
    var slAction = {
        styleKey: "floorledge",
        getDocument: function() { return doc; },
        getDocumentInterface: function() { return di; },
        samples: slSamples,
        spinePts: null,
        spineClosed: false,
        side: 1,
        pathFrame: null,
        region: null,
        bays: [],
        growId: null,
        extendForced: false,
        refreshFrames: ShapedLinesRun.prototype.refreshFrames,
        prepare: ShapedLinesRun.prototype.prepare,
        buildSpine: ShapedLinesRun.prototype.buildSpine,
        // commit() asks these two before it draws: whether this stroke
        // continues a line already there, and how to grow it if so.
        extendTarget: ShapedLinesRun.prototype.extendTarget,
        growExisting: ShapedLinesRun.prototype.growExisting
    };
    slAction.refreshFrames();
    check("SL: fixture: the bay is seen as section-frame ground",
        slAction.bays.length === 1 &&
        CsTrace.pathFrame(slAction.region, slSamples, slAction.bays) ===
            "section");

    try {
        check("SL: fixture: the release prepared a feature",
            slAction.prepare() === true);
        // THE SIDE COMES FROM WHERE THE CAVER POINTS, not from which
        // way they dragged. The stroke runs west to east at y+1 in the
        // bay; pointing below it and above it must give opposite sides,
        // and neither answer may depend on the drag direction.
        var slBelow = CsShapeLine.sideForPoint(slAction.spinePts, false,
            { x: slCentre.x, y: slCentre.y - 2 });
        var slAbove = CsShapeLine.sideForPoint(slAction.spinePts, false,
            { x: slCentre.x, y: slCentre.y + 4 });
        check("SL: pointing below the stroke and above it give opposite " +
            "sides", slBelow !== null && slAbove !== null &&
            slBelow === -slAbove);
        // The frame is decided at the RELEASE and carried, so pointing
        // at the low side -- which happens outside the bay as often as
        // inside it -- cannot turn section linework into plan linework.
        check("SL: the view is decided by the STROKE, not by where the " +
            "side was picked", slAction.pathFrame === "section");
        ShapedLinesRun.prototype.commit.call(slAction);
    } finally {
        EAction.handleUserMessage = realMessage;
    }

    // Find the spine this stroke made: the newest entity carrying a
    // ShapeStyle tag. queryAllEntities is NOT insertion-ordered, so
    // "newest" is by id, not by position in the array.
    var slSpine = null;
    var slIds = doc.queryAllEntities(false, true);
    for (var si2 = 0; si2 < slIds.length; si2++) {
        var cand = doc.queryEntity(slIds[si2]);
        if (isNull(cand) ||
                CsTags.get(cand, CsShapeLine.KEY.STYLE) !== "floorledge") {
            continue;
        }
        if (slSpine === null ||
                Number(cand.getId()) > Number(slSpine.getId())) {
            slSpine = cand;
        }
    }
    check("SL: fixture: the stroke produced a spine at all" +
        (slSaid.length === 0 ? "" : " (said: " + slSaid.join(" | ") + ")"),
        slSpine !== null);
    if (slSpine === null) {
        check("SL: the SPINE lands on the section family", false);
        check("SL: the DECOR lands on the section family", false);
        check("SL: the regenerated decor stays on the section family", false);
        return;
    }

    // THE EXPECTED LAYERS ARE NAMED OUTRIGHT, not asked of
    // CsShapeLine.layersFor. Deriving them from the function under
    // test is exactly how an assertion passes while the thing it names
    // is broken: with the SECTION_TWIN branch deleted, layersFor
    // answers LEDGE-FLOOR and a derived expectation moves to
    // LEDGE-FLOOR with it. Measured -- that mutation left this whole
    // claim GREEN until these two lines became literals.
    var slWant = { spine: CsLayers.SECTION_LEDGE_FLOOR,
                   decor: CsLayers.SECTION_LEDGE_FLOOR };
    var slSpineLayer = doc.getLayerName(slSpine.getLayerId());
    check("SL: the SPINE lands on the section family -- expected " +
        slWant.spine + ", got " + slSpineLayer,
        slSpineLayer === slWant.spine);
    check("SL: and the spine is tagged as section, which is what every " +
        "later rebuild reads",
        CsShapeLine.frameOfSpine(slSpine) === "section");

    var slId = CsTags.get(slSpine, CsShapeLine.KEY.ID);
    var slDecor = CsShapeLine.decorOf(doc, slId);
    check("SL: fixture: the stroke was decorated", slDecor.length > 0);
    var slDecorWrong = null;
    for (var di2 = 0; di2 < slDecor.length; di2++) {
        var dl = doc.getLayerName(slDecor[di2].getLayerId());
        if (dl !== slWant.decor) {
            slDecorWrong = dl;
        }
    }
    check("SL: the DECOR lands on the section family -- expected " +
        slWant.decor + ", got " +
        (slDecorWrong === null ? slWant.decor : slDecorWrong),
        slDecor.length > 0 && slDecorWrong === null);

    // And it is really IN the bay, so the capture sweep owns it --
    // landing on a section layer proves nothing about where it went.
    var slBay2 = SectionCapture.findBay(doc);
    check("SL: the capture sweep picks the whole feature up",
        slBay2 !== null && slBay2.traced.length === 1 + slDecor.length);

    // -- THE REGENERATION, through the listener's own function --------
    slSpine.move(new RVector(0, 0.5));
    var slMove = new RModifyObjectsOperation();
    slMove.addObject(slSpine, false);
    di.applyOperation(slMove);
    var slResult = CsShapeLine.reconcile(doc, di, slId, -1);
    check("SL: fixture: moving the spine really does force a rebuild " +
        "(got '" + slResult + "')", slResult === "reflowed");

    var slAfter = CsShapeLine.decorOf(doc, slId);
    var slAfterWrong = null;
    for (var dk = 0; dk < slAfter.length; dk++) {
        var al = doc.getLayerName(slAfter[dk].getLayerId());
        if (al !== slWant.decor) {
            slAfterWrong = al;
        }
    }
    check("SL: the regenerated decor stays on the section family -- " +
        "expected " + slWant.decor + ", got " +
        (slAfterWrong === null ? slWant.decor : slAfterWrong),
        slAfter.length > 0 && slAfterWrong === null);
})();

// ---------------------------------------------------------------------
// F2 (review finding, correctness): findBay must REFUSE when more than
// one section bay is open, rather than binding one bay's frame to
// another bay's ghost and scan. queryAllEntities is not
// insertion-ordered, so a single combined pass had no way to keep two
// open bays' furniture apart.
// ---------------------------------------------------------------------
(function() {
    var f2First = SectionBay.run(scanPath, "A0");
    check("F2: fixture: the first bay opens", f2First !== null);
    var f2Second = SectionBay.run(scanPath, "A3");
    check("F2: fixture: the second bay opens", f2Second !== null);
    check("F2: fixture: they are two distinct bays",
        f2First !== null && f2Second !== null && f2First !== f2Second);

    var f2Result = SectionCapture.findBay(doc);
    check("F2: Capture refuses rather than mixing two open bays together",
        f2Result === null);
    check("F2: and says why", SectionCapture.findBayError !== null);
})();

// ---------------------------------------------------------------------
// F3 (review finding, correctness): the static capture() entry point --
// which the headless test drives directly, and which is the reusable
// API SectionBay's own beginEvent is just one caller of -- must
// refuse an empty sweep ON ITS OWN, not rely on beginEvent's guard
// having run first. CsCallout.newId() is spied on rather than counting
// blocks afterward: the guard's whole point is that it returns before
// a block is ever minted, so "newId was never called" is the more
// direct proof than "no block happens to exist by this name".
// ---------------------------------------------------------------------
(function() {
    var newIdCalls = 0;
    var origNewId = CsCallout.newId;
    CsCallout.newId = function() {
        newIdCalls++;
        return origNewId();
    };
    var f3Result;
    try {
        f3Result = SectionCapture.capture(doc, di, { traced: [] },
            { x: 0, y: 0 });
    } finally {
        CsCallout.newId = origNewId;
    }
    check("F3: SectionCapture.capture() itself refuses an empty traced " +
        "list and returns null", f3Result === null);
    check("F3: and it defines no block for it -- the guard returns " +
        "before a block id is ever minted",
        newIdCalls === 0);
})();

if (failures.length === 0) {
    print("### SECTION SKETCH OK " + checks);
} else {
    for (var fi = 0; fi < failures.length; fi++) {
        print("FAIL: " + failures[fi]);
    }
    print("### SECTION SKETCH FAIL " + failures.length + " of " + checks);
}
