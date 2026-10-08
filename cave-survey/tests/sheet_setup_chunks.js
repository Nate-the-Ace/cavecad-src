// sheet_setup_chunks.js -- one draggable, labelled box per chunk in
// Sheet Setup's Profile Sheet preview.
//
// Two kinds of check live here, same split as the rest of this suite:
// the PURE arithmetic (CsSheetSetup.isMovable/anyMoved/preview,
// CsProfile.build/CsChunk over the Plumbline Pit fixture) runs under
// plain node, same shim plumbline_pipeline.js already uses. Anything
// that needs a real QCAD document (SheetSetup.readSurvey,
// SheetSetup.buildChunkedElevation) is exercised separately, through
// CaveCAD itself -- see run_all.sh's -autostart stages -- and is not
// duplicated here.
//
//   node tests/sheet_setup_chunks.js
//   node tests/sheet_setup_chunks.js --verbose

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
 "Format/CsRegistry.js",
 "CsSheetSetup.js"].forEach(loadCore);

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

// ---------------------------------------------------------------------
// isMovable / anyMoved -- a per-chunk "band:<key>" kind
// ---------------------------------------------------------------------

ok(CsSheetSetup.isMovable("band:UP1-DOWN2") === true,
    "isMovable: a per-chunk band kind is movable");
ok(CsSheetSetup.isMovable("band") === false,
    "isMovable: the shared, un-keyed band kind stays non-movable " +
    "(extended/projected sheets are out of this feature's scope)");
ok(CsSheetSetup.isMovable("cave") === true,
    "isMovable: the four furniture kinds are unaffected");
ok(CsSheetSetup.isMovable("bandage") === false,
    "isMovable: a kind that merely starts with the letters \"band\" " +
    "but is not the \"band:\" prefix is not swept in by accident");

(function() {
    var offsets = {};
    offsets["band:UP1-DOWN2"] = { x: 2, y: 0 };
    ok(CsSheetSetup.anyMoved(offsets) === true,
        "anyMoved: notices a moved chunk box even though its kind " +
        "is not in the fixed MOVABLE array");
})();
ok(CsSheetSetup.anyMoved({}) === false,
    "anyMoved: an empty offsets object is not \"moved\"");

// ---------------------------------------------------------------------
// preview() -- one box per chunk, independently offsettable, labelled
// ---------------------------------------------------------------------

(function() {
    var bands = [
        { key: "UP1-DOWN2", minX: 0, minY: 0, maxX: 10, maxY: 40,
          label: "P 62 ft" },
        { key: "PASSAGE-DOWN2", minX: 12, minY: 0, maxX: 60, maxY: 8,
          label: "FROM DOWN2" }
    ];
    var preview = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, chunked: true, bands: bands,
        offsets: {}
    });
    var chunkItems = preview.items.filter(function(it) {
        return it.kind.indexOf("band:") === 0;
    });
    ok(chunkItems.length === 2, "preview: one box per chunk (got " +
        chunkItems.length + ")");
    var kinds = chunkItems.map(function(it) { return it.kind; });
    ok(kinds.indexOf("band:UP1-DOWN2") >= 0,
        "preview: first chunk keeps its own key as its kind");
    ok(kinds.indexOf("band:PASSAGE-DOWN2") >= 0,
        "preview: second chunk keeps its own key as its kind");
    ok(chunkItems.every(function(it) { return !isNull(it.label); }),
        "preview: every chunk box carries its caption as a label");
    var plainBand = preview.items.filter(function(it) {
        return it.kind === "band";
    });
    ok(plainBand.length === 0,
        "preview: chunked mode emits no plain, un-keyed \"band\" item");
})();

(function() {
    // A NON-chunked elevation (extended/projected) is unaffected: one
    // shared "band" kind, no per-item label, exactly as before this
    // feature.
    var bands = [
        { key: "RUN1", minX: 0, minY: 0, maxX: 200, maxY: 6 }
    ];
    var preview = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, chunked: false, bands: bands,
        offsets: {}
    });
    var plainBand = preview.items.filter(function(it) {
        return it.kind === "band";
    });
    ok(plainBand.length === 1,
        "preview: a non-chunked elevation still uses the single, " +
        "shared \"band\" kind");
    ok(isNull(plainBand[0].label),
        "preview: a non-chunked band carries no label");
})();

(function() {
    // Dragging one chunk box leaves its sibling exactly where the
    // auto-layout put it.
    var bands = [
        { key: "A", minX: 0, minY: 0, maxX: 10, maxY: 10, label: "A" },
        { key: "B", minX: 20, minY: 0, maxX: 30, maxY: 10, label: "B" }
    ];
    var base = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, chunked: true, bands: bands,
        offsets: {}
    });
    var offsets = {};
    offsets["band:A"] = { x: 5, y: 0 };   // 5 inches right, B untouched
    var dragged = CsSheetSetup.preview({
        caveBox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        sheet: CsSheetSetup.SHEETS[0], scale: 120,
        wants: {}, elevation: true, chunked: true, bands: bands,
        offsets: offsets
    });
    var find = function(items, kind) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === kind) { return items[i]; }
        }
        return null;
    };
    var baseA = find(base.items, "band:A");
    var draggedA = find(dragged.items, "band:A");
    var baseB = find(base.items, "band:B");
    var draggedB = find(dragged.items, "band:B");
    ok(Math.abs((draggedA.box.minX - baseA.box.minX) - 5 * 120) < 0.01,
        "preview: dragging chunk A moves it by its own offset " +
        "(5in * scale 120), got dx=" +
        (draggedA.box.minX - baseA.box.minX));
    ok(Math.abs(draggedB.box.minX - baseB.box.minX) < 0.01,
        "preview: dragging chunk A leaves chunk B exactly where it was");
})();

// ---------------------------------------------------------------------
// Regenerating a chunked elevation keeps its ties -- the reason Task 4
// regenerates via CsProfile.build rather than translating entities.
// ---------------------------------------------------------------------

(function() {
    var fixturePath = repoRoot + "/testdata/PlumblinePit.svx";
    if (!fs.existsSync(fixturePath)) {
        console.log("  SKIP  chunk regeneration keeps its ties " +
            "(no testdata/PlumblinePit.svx -- run " +
            "tools/make_pit_cave.js first)");
        return;
    }
    // Same reader and resolve call tests/plumbline_pipeline.js already
    // uses over this exact fixture.
    var survey = CsFormatSurvex.parse(fs.readFileSync(fixturePath, "utf8"));
    var resolved = CsNetwork.resolve(survey, {});
    var built = CsProfile.build(survey, resolved,
        { mode: "chunked", offsets: {} });
    if (isNull(built) || isNull(built.bands) || built.bands.length < 2) {
        console.log("  SKIP  chunk regeneration keeps its ties " +
            "(fixture did not produce a multi-chunk profile)");
        return;
    }
    var firstKey = built.bands[0].key;
    var draggedOffsets = {};
    draggedOffsets[firstKey] = 500;   // 500 drawing units right
    var rebuilt = CsProfile.build(survey, resolved,
        { mode: "chunked", offsets: draggedOffsets });
    ok(rebuilt.ties.length === built.ties.length,
        "chunk regeneration: dragging a chunk keeps every tie " +
        "(before=" + built.ties.length + " after=" +
        rebuilt.ties.length + ")");
    ok(rebuilt.bands.length === built.bands.length,
        "chunk regeneration: dragging a chunk keeps every chunk");
})();

console.log("");
console.log(checks + " checks, " + failures.length + " failed.");
if (failures.length > 0) {
    process.exit(1);
}
