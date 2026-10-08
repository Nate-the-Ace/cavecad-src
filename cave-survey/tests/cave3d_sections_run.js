// cave3d_sections_run.js -- reading captured cross sections out of a
// REAL document and standing them in three dimensions.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cave3d_sections_run.js "$PWD"
//
// Prints "### CAVE3D SECTIONS OK <n>" on success, "### CAVE3D SECTIONS
// FAIL" plus the failed checks otherwise.
//
// WHY THIS FILE EXISTS RATHER THAN MORE UNIT TESTS. CsSection3d's maths
// are node-tested in js_unit.js and none of them is where this can
// break. What can break is everything that only exists once there is an
// RDocument: a block whose entities answer in world coordinates instead
// of block-local ones, tags read back through a different key than they
// were written with, and -- the one that matters most -- geometry that
// discretises to nothing.
//
// THE SPLINE PROXY TRAP IS THE POINT OF THE LAST CHECK. getPointCloud()
// on an RSpline delegates to a proxy plugin that THIS VERY RUN MODE
// never loads, so a flattener written fresh here would return empty
// exactly where a test cannot see it and the GUI looks fine. CsArea
// .vertsOf already routes splines through getExploded() for that reason.
// The check that real points came back is what keeps that true.
//
// The section is built here by hand rather than captured through
// SectionBay, because what is under test is READING a section, not
// making one -- that lifecycle is section_sketch_run.js's job. The tags
// are written with the same CsCallout.KEY constants SectionCapture
// writes, so the two cannot drift apart silently, and Truitt Cave's
// seven real sections are the live counter-check.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {}
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
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(source);
}

// Core, in CsAll's own order, so a file added there is picked up here
// without a second hand-written list to forget to update.
(function () {
    var f = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsAll.js");
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open CsAll.js");
    }
    var text = String((new QTextStream(f)).readAll());
    f.close();
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = /include\(includeBasePath \+ "\/([^"]+)"\);/.exec(lines[i]);
        if (m !== null) {
            loadRepoScript("scripts/CaveSurvey/Core/" + m[1]);
        }
    }
})();

var failures = [];
var checks = 0;

function check(name, condition) {
    checks++;
    if (condition !== true) {
        failures.push(name);
    }
}

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

// ---------------------------------------------------------------------
// A survey to hang a section on: four stations running east.
// ---------------------------------------------------------------------

var survey = CsModel.newSurvey();
survey.distanceUnit = "ft";
survey.shots = [
    { from: "A1", to: "A2", distance: 10, azimuth: 90, inclination: 0,
      left: 3, right: 3, up: 4, down: 2, splay: false, trip: 0 },
    { from: "A2", to: "A3", distance: 10, azimuth: 90, inclination: 0,
      left: 3, right: 3, up: 4, down: 2, splay: false, trip: 0 },
    { from: "A3", to: "A4", distance: 10, azimuth: 90, inclination: 0,
      left: 3, right: 3, up: 4, down: 2, splay: false, trip: 0 }
];
CsModel.ensureTrips(survey);
var resolved = CsNetwork.resolve(survey);
check("the fixture survey resolves", resolved.stations["A3"] !== undefined);

// ---------------------------------------------------------------------
// A section block on A3, built the way SectionCapture builds one:
// block-local about the passage centreline, tagged with the same keys.
// ---------------------------------------------------------------------

var BLOCK_NAME = "SectionA3";
var block = new RBlock(doc, BLOCK_NAME, new RVector(0, 0));
var addBlock = new RAddObjectOperation(block, false);
di.applyOperation(addBlock);
var blockId = doc.getBlockId(BLOCK_NAME);
check("the block exists", blockId !== RBlock.INVALID_ID);

// A five-foot-wide, four-foot-tall outline, block-local about (0,0).
var outline = new RPolylineEntity(doc, new RPolylineData());
outline.appendVertex(new RVector(-2.5, -2));
outline.appendVertex(new RVector(2.5, -2));
outline.appendVertex(new RVector(2.5, 2));
outline.appendVertex(new RVector(-2.5, 2));
outline.setClosed(true);
outline.setBlockId(blockId);
di.applyOperation(new RAddObjectOperation(outline, false));

var stationPos = resolved.stations["A3"];
// Placed NORTH of its station, so the side test has a real answer.
var refPos = new RVector(stationPos.x, stationPos.y + 18);
var ref = new RBlockReferenceEntity(doc,
    new RBlockReferenceData(blockId, refPos, new RVector(1, 1), 0));
CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
CsTags.set(ref, CsCallout.KEY.SECTION_STATION, "A3");
CsTags.set(ref, CsCallout.KEY.SECTION_SCALE, "1");
di.applyOperation(new RAddObjectOperation(ref, false));

// A second block reference with NO station tag: it must be skipped, not
// guessed at. Guessing the nearest station would stand somebody's
// drawing somewhere they did not draw it.
var orphan = new RBlockReferenceEntity(doc,
    new RBlockReferenceData(blockId, new RVector(0, 60),
        new RVector(1, 1), 0));
CsTags.set(orphan, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
CsTags.set(orphan, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
di.applyOperation(new RAddObjectOperation(orphan, false));

// ---------------------------------------------------------------------
// Reading it back.
// ---------------------------------------------------------------------

var found = CsSection3d.readAll(doc);
check("exactly one section is found -- the untagged one is skipped, " +
    "not guessed at (" + found.length + ")", found.length === 1);

if (found.length === 1) {
    var sec = found[0];
    check("it names its station", sec.station === "A3");
    check("its scale is a real positive number",
        isFinite(sec.scale) && sec.scale > 0);
    check("its block position was read", isFinite(sec.blockPos.x) &&
        isFinite(sec.blockPos.y));
    check("it has geometry", sec.polylines.length > 0);

    // THE SPLINE PROXY TRAP, ASSERTED. This run mode is exactly where a
    // fresh flattener would have silently returned nothing.
    var pts = 0;
    for (var qi = 0; qi < sec.polylines.length; qi++) {
        pts += sec.polylines[qi].length;
    }
    check("the block geometry discretised to real points (" + pts + ")",
        pts >= 4);

    // ---- placing it ----
    var leg = CsSectionCut.nearestLeg(resolved, stationPos, 1e9);
    check("the section's station sits on a leg", leg !== null);

    if (leg !== null) {
        var got = CsSectionCut.frameForLeg(resolved, leg.from, leg.to);
        check("that leg yields a frame", got !== null && got.frame !== null);

        if (got !== null && got.frame !== null) {
            var side = CsSection3d.sideFor(sec.blockPos, stationPos,
                got.frame, 6);
            check("the side is horizontal -- a section hangs beside "
                + "the passage, not above it",
                Math.abs(side.z) < 1e-9);
            check("the side is a unit vector",
                Math.abs(Math.sqrt(side.x * side.x + side.y * side.y +
                    side.z * side.z) - 1) < 1e-9);

            var placed = CsSection3d.place(sec.polylines, {
                station: stationPos, frame: got.frame, scale: sec.scale,
                side: side, offset: 15
            });
            check("the section places into the world", placed.length > 0);

            var bad = 0, count = 0;
            for (var pi = 0; pi < placed.length; pi++) {
                for (var pj = 0; pj < placed[pi].length; pj++) {
                    var p = placed[pi][pj];
                    count++;
                    if (!isFinite(p.x) || !isFinite(p.y) ||
                            !isFinite(p.z)) { bad++; }
                }
            }
            check("no NaN in " + count + " placed coordinates", bad === 0);

            // The passage runs east, so the section stands square to it:
            // every placed point shares the station's easting.
            var offAxis = 0;
            for (var oi = 0; oi < placed.length; oi++) {
                for (var oj = 0; oj < placed[oi].length; oj++) {
                    if (Math.abs(placed[oi][oj].x - stationPos.x) > 1e-6) {
                        offAxis++;
                    }
                }
            }
            check("a section stands SQUARE to its passage -- nothing " +
                "moves along it (" + offAxis + " strays)", offAxis === 0);

            var lead = CsSection3d.leaderFor({ station: stationPos,
                side: side, offset: 15 });
            check("the leader comes home to the station",
                Math.abs(lead[1].x - stationPos.x) < 1e-9 &&
                Math.abs(lead[1].y - stationPos.y) < 1e-9 &&
                Math.abs(lead[1].z - stationPos.z) < 1e-9);
        }
    }
}

// ---------------------------------------------------------------------

if (failures.length > 0) {
    print("### CAVE3D SECTIONS FAIL");
    for (var fi = 0; fi < failures.length; fi++) {
        print("  " + failures[fi]);
    }
} else {
    print("### CAVE3D SECTIONS OK " + checks + " checks");
}
