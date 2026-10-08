// make_rigging_symbols.js -- draws the RIGGING symbols into the shipped
// PLAN template, as SYM_ blocks, idempotently.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_rigging_symbols.js "$PWD"
//
// Re-runnable: a block that already exists is emptied and redrawn, so
// editing a symbol below and running this again is the whole workflow.
// The template is rewritten only if something actually changed.
//
// WHY A TOOL AND NOT THE SYMBOL EDITOR. Symbol Palette's own editor
// writes a CAVER'S symbols, into their own library, and
// CsSymbolStore.saveBlock deliberately REFUSES a name the suite ships
// -- an edited copy of a shipped symbol would be silently replaced by
// the next update. The shipped set is code (Core/CsSymbols.js CATALOG)
// plus geometry in the template, and this file is where that geometry
// comes from. Same relationship tools/sync_template_layers.js has with
// the layer registry.
//
// WHY THESE EIGHT. The suite had symbols for what a cave IS and none
// for how you get down it: CATALOG carried Pit, Dome and Climb and
// stopped, while CsLayers has reserved ANCHORS-BOLTS (cyan, the rigging
// and gear family) since the palette was written and nothing has ever
// drawn on it. A rigging topo needs to say where the bolts are, which
// ones are a Y-hang, where the rope is rebelayed and deviated, what is
// threaded rather than drilled, and where a ladder or a traverse line
// is -- and on a pit map that is not decoration, it is the part a
// caver reads before they go.
//
// SCALE. Every shipped symbol is between 0.3 and 1.5 drawing units
// (measured, not assumed -- SYM_PIT is 1.00 x 1.00, SYM_ENTRANCE 0.80
// x 2.40, SYM_CLAY_MUD_TICK 0.40 x 0.30). These sit in the same range,
// mostly around 0.6 to 1.0 tall, so a rigging note reads at the same
// weight as the formations beside it rather than shouting over them.
//
// ORIGIN. Every symbol's (0,0) is the point a caver would CLICK: the
// bolt itself for an anchor, the hang point for a Y, the rope head for
// a drop, the left-hand anchor for a traverse. Placing one puts the
// thing where the thing is.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var core = repoRoot + "/scripts/CaveSurvey/Core";

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

includeBasePath = core;
include(core + "/CsLayers.js");
include(core + "/CsLayerVariants.js");
include(core + "/CsUuid.js");
include(core + "/CsSymbols.js");

var TEMPLATE = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";

// ---------------------------------------------------------------------
// Geometry. Each symbol is a list of primitives in its own local
// coordinates, origin as described above.
//
//   ["line", x1, y1, x2, y2]
//   ["circle", cx, cy, r]
//   ["arc", cx, cy, r, startDeg, endDeg]
// ---------------------------------------------------------------------

var RIGGING = {

    // A BOLT. The crossed circle is the one mark every rigging topo
    // already uses for a drilled anchor, and it survives being small:
    // at plot scale the cross stays visible when a plain ring would
    // close up into a dot and read as a station.
    SYM_BOLT: [
        ["circle", 0, 0, 0.13],
        ["line", -0.092, -0.092, 0.092, 0.092],
        ["line", -0.092, 0.092, 0.092, -0.092]
    ],

    // A Y-HANG: two bolts, two legs, one rope. Drawn as it hangs, with
    // the origin at the hang point rather than at either bolt -- that
    // is the spot on the map the rope actually falls from, and the pair
    // of bolts is what makes it a Y rather than two separate anchors.
    SYM_Y_HANG: [
        ["circle", -0.32, 0.42, 0.085],
        ["circle", 0.32, 0.42, 0.085],
        ["line", -0.26, 0.36, -0.03, 0.12],
        ["line", 0.26, 0.36, 0.03, 0.12],
        ["line", 0, 0.10, 0, -0.42]
    ],

    // A REBELAY: the rope arrives, is clipped to a bolt, and leaves
    // again below. The loop under the bolt is the whole distinction --
    // without it this is just a bolt with a rope past it, which is a
    // deviation, and the two are rigged differently and fail
    // differently.
    SYM_REBELAY: [
        ["line", 0, 0.52, 0, 0.13],
        ["circle", 0, 0, 0.105],
        ["circle", 0, -0.20, 0.09],
        ["line", 0, -0.29, 0, -0.62]
    ],

    // A DEVIATION: a bolt off to one side with a short tether, pulling
    // the rope out of the fall line. The rope KINKS through it and
    // carries on -- it is not anchored here, and the drawing says so by
    // never stopping.
    SYM_DEVIATION: [
        ["circle", 0, 0, 0.095],
        ["line", 0.09, -0.02, 0.27, -0.10],
        ["circle", 0.345, -0.13, 0.075],
        ["line", 0.21, 0.55, 0.345, -0.055],
        ["line", 0.345, -0.205, 0.20, -0.66]
    ],

    // A NATURAL ANCHOR: a thread, a boulder, a flake -- anything the
    // rope goes round instead of into. The blob is deliberately not a
    // circle (a circle is a bolt here) and the sling arcs over it.
    SYM_NATURAL_ANCHOR: [
        ["line", -0.24, -0.16, 0.24, -0.16],
        ["line", 0.24, -0.16, 0.02, 0.22],
        ["line", 0.02, 0.22, -0.24, -0.16],
        ["arc", 0, -0.04, 0.33, 200, 340],
        ["line", 0, -0.37, 0, -0.66]
    ],

    // A ROPE: an anchor ring with rope hanging from it. Placed at the
    // lip, it says a rope hangs here; the length belongs in a note
    // beside it, not in the symbol, because the symbol would then be
    // wrong the first time anyone re-rigs.
    //
    // THE WAVE IS WHAT MAKES IT ROPE, and it replaced two short
    // slanting strokes across a straight line that were meant to read
    // as coils and read as a CUT instead -- a line with ticks across
    // it is a break mark on every drawing that has one. Therion's own
    // set is the authority here and it settles the question twice
    // over: its `line rope` is a plain thick line with no decoration
    // at all (`noassign` in thsymbolsetlist.pl -- there is no per-set
    // glyph to get wrong), and its `point rope-ladder` tells a rope
    // ladder from a fixed one by giving the rails a WAVE where the
    // fixed ladder's are straight. Wavy means rope. Nothing in the
    // convention ever crosses a rope with a stroke.
    SYM_ROPE_DROP: [
        ["circle", 0, -0.105, 0.105],
        ["arc", -0.0606, -0.3025, 0.1106, -56.8, 56.8],
        ["arc", 0.0606, -0.4875, 0.1106, 123.2, 236.8],
        ["arc", -0.0606, -0.6725, 0.1106, -56.8, 56.8],
        ["arc", 0.0606, -0.8575, 0.1106, 123.2, 236.8]
    ],

    // A CABLE LADDER, with WAVY rails.
    //
    // The rails were straight, which by the convention is a different
    // piece of equipment: Therion tells `point rope-ladder` from
    // `point fixed-ladder` by exactly this and nothing else -- wavy
    // rails hang, straight rails are bolted to the rock. A cable
    // ladder is the hanging kind, so it gets the wave, the same wave
    // the rope symbol carries and for the same reason.
    //
    // The two rails wave IN PHASE, as Therion's do: a hanging ladder
    // twists as a unit rather than its two sides swinging apart. The
    // rungs sit at the wave's crossings, where both rails are back on
    // their nominal line, so a rung meets each rail square instead of
    // landing somewhere along a curve.
    SYM_CABLE_LADDER: [
        ["arc", -0.24812, -0.1125, 0.16312, -43.6, 43.6],
        ["arc", -0.01188, -0.3375, 0.16312, 136.4, 223.6],
        ["arc", -0.24812, -0.5625, 0.16312, -43.6, 43.6],
        ["arc", -0.01188, -0.7875, 0.16312, 136.4, 223.6],
        ["arc", 0.01188, -0.1125, 0.16312, -43.6, 43.6],
        ["arc", 0.24812, -0.3375, 0.16312, 136.4, 223.6],
        ["arc", 0.01188, -0.5625, 0.16312, -43.6, 43.6],
        ["arc", 0.24812, -0.7875, 0.16312, 136.4, 223.6],
        ["line", -0.13, -0.225, 0.13, -0.225],
        ["line", -0.13, -0.45, 0.13, -0.45],
        ["line", -0.13, -0.675, 0.13, -0.675]
    ],

    // A TRAVERSE LINE: two anchors and a rope that SAGS between them.
    // The sag is not decoration -- a taut horizontal line between two
    // rings is how a handline or a tyrolean would be drawn, and a
    // traverse line is neither.
    SYM_TRAVERSE_LINE: [
        ["circle", 0, 0, 0.08],
        ["circle", 0.95, 0, 0.08],
        ["line", 0.08, -0.01, 0.33, -0.11],
        ["line", 0.33, -0.11, 0.62, -0.11],
        ["line", 0.62, -0.11, 0.87, -0.01]
    ]
};

// THE COVERAGE-AUDIT SET (2026-10): biology, archaeology, hazards,
// passage ends, the lesser formations, dissolution features and the
// rest of the equipment. Plain data in its own file so a contact sheet
// can be drawn from it under node (tools/preview_symbols.js); merged in
// here so there is still exactly one tool that writes shipped geometry
// into the template, and every block still has to have a CATALOG row.
include(repoRoot + "/tools/coverage_symbols_data.js");
for (var coverageName in COVERAGE) {
    if (COVERAGE.hasOwnProperty(coverageName)) {
        RIGGING[coverageName] = COVERAGE[coverageName];
    }
}

// ---------------------------------------------------------------------

/** The DXF writer that persists custom properties -- see
 *  tools/sync_template_layers.js, same rule and same reason. */
function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";
}

function entityFor(doc, prim) {
    var kind = prim[0];
    if (kind === "line") {
        return new RLineEntity(doc, new RLineData(
            new RVector(prim[1], prim[2]), new RVector(prim[3], prim[4])));
    }
    if (kind === "circle") {
        return new RCircleEntity(doc, new RCircleData(
            new RCircle(new RVector(prim[1], prim[2]), prim[3])));
    }
    if (kind === "arc") {
        return new RArcEntity(doc, new RArcData(
            new RArc(new RVector(prim[1], prim[2]), prim[3],
                prim[4] * Math.PI / 180.0, prim[5] * Math.PI / 180.0,
                false)));
    }
    throw new Error("unknown primitive " + kind);
}

/** Deletes every entity currently inside a block. */
function emptyBlock(doc, di, blockId) {
    var ids = doc.queryBlockEntities(blockId);
    if (ids.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e)) {
            op.deleteObject(e);
        }
    }
    di.applyOperation(op);
    return ids.length;
}

function drawBlock(doc, di, blockName, prims, layerName) {
    // doc.hasBlock, NOT isNull(doc.queryBlock(...)). Measured, not
    // assumed: queryBlock for a block that is not there hands back an
    // RBlock wrapper that is neither JS null nor undefined, has no
    // isNull method to ask, and whose getId() returns `undefined`
    // while printing a warning nobody reads. Every existence test in
    // this file would have answered "yes, it exists" for all eight new
    // symbols, emptied a block that was not there, and then set every
    // entity's blockId to undefined -- geometry landing in the model
    // space of the template rather than inside a block, which is a
    // corrupted template that still opens. (One more for the QCAD JS
    // bridge trap list: a wrapper that is not null and not usable.)
    var replaced = doc.hasBlock(blockName);
    var blockId;
    if (!replaced) {
        di.applyOperation(new RAddObjectOperation(
            new RBlock(doc, blockName, new RVector(0, 0))));
    }
    blockId = doc.getBlockId(blockName);
    if (replaced) {
        emptyBlock(doc, di, blockId);
    }
    if (isNull(blockId) || blockId === RObject.INVALID_ID) {
        throw new Error("the template refused a block named " + blockName);
    }

    // The home layer has to EXIST or getLayerId hands back an invalid
    // id and the geometry lands on nothing, silently -- the same trap
    // CsSymbolStore.saveBlock documents.
    CsLayers.ensure(doc, di, layerName);
    var layerId = doc.getLayerId(layerName);

    var op = new RAddObjectsOperation();
    for (var i = 0; i < prims.length; i++) {
        var e = entityFor(doc, prims[i]);
        e.setBlockId(blockId);
        if (!isNull(layerId) && layerId !== RObject.INVALID_ID) {
            e.setLayerId(layerId);
        }
        op.addObject(e, false);
    }
    di.applyOperation(op);
    return replaced;
}

// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
if (di.importFile(TEMPLATE, "", false) !== RDocumentInterface.IoErrorNoError) {
    print("FAIL  cannot read " + TEMPLATE);
    QCoreApplication.exit(1);
}

var failures = [];
var added = [], redrawn = [];

for (var blockName in RIGGING) {
    if (!RIGGING.hasOwnProperty(blockName)) {
        continue;
    }
    // THE CATALOGUE DECIDES THE LAYER, not this file. A symbol whose
    // geometry says one thing and whose catalogue entry says another is
    // exactly the drift the CATALOG exists to prevent, so the entry is
    // required to exist before its geometry may be drawn.
    var entry = CsSymbols.byBlock(blockName);
    if (entry === null) {
        failures.push(blockName + " has no entry in CsSymbols.CATALOG, " +
            "so there is no layer to draw it on");
        continue;
    }
    try {
        if (drawBlock(doc, di, blockName, RIGGING[blockName], entry.layer)) {
            redrawn.push(blockName);
        } else {
            added.push(blockName);
        }
    } catch (e) {
        failures.push(blockName + ": " + e);
    }
}

// ---- verify before writing -------------------------------------------
//
// A block that came out empty is worse than one that was never drawn:
// the palette would offer it, place it, and put nothing on the map.

for (blockName in RIGGING) {
    if (!RIGGING.hasOwnProperty(blockName)) {
        continue;
    }
    if (!doc.hasBlock(blockName)) {
        failures.push(blockName + " is not in the template after drawing");
        continue;
    }
    var ids = doc.queryBlockEntities(doc.getBlockId(blockName));
    if (ids.length !== RIGGING[blockName].length) {
        failures.push(blockName + " has " + ids.length +
            " entities, expected " + RIGGING[blockName].length);
        continue;
    }
    var bb = null;
    for (var q = 0; q < ids.length; q++) {
        var ent = doc.queryEntity(ids[q]);
        if (isNull(ent)) { continue; }
        var eb = ent.getBoundingBox();
        if (bb === null) { bb = eb; } else { bb.growToInclude(eb); }
    }
    if (bb === null) {
        failures.push(blockName + " has no measurable geometry");
        continue;
    }
    var w = bb.getWidth(), h = bb.getHeight();
    // The shipped range, measured: 0.10 to 3.30 in either axis. A
    // symbol outside it is a units mistake, and a units mistake in a
    // block is invisible until someone places one on a real map.
    if (Math.max(w, h) > 2.0 || Math.max(w, h) < 0.2) {
        failures.push(blockName + " is " + w.toFixed(2) + " x " +
            h.toFixed(2) + ", outside the shipped symbol size range");
        continue;
    }
    print("      " + blockName + "  " + ids.length + " entities  " +
        w.toFixed(2) + " x " + h.toFixed(2) + "  on " +
        CsSymbols.byBlock(blockName).layer);
}

if (failures.length > 0) {
    print("FAIL  " + failures.length + " problem(s); the template was NOT written:");
    for (var f = 0; f < failures.length; f++) {
        print("      " + failures[f]);
    }
    QCoreApplication.exit(1);
} else {
    if (di.exportFile(TEMPLATE, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + TEMPLATE);
        QCoreApplication.exit(1);
    } else {
        print("ok    " + TEMPLATE + " -- " + added.length + " added, " +
            redrawn.length + " redrawn");
        if (added.length > 0) {
            print("      added:   " + added.join(", "));
        }
        if (redrawn.length > 0) {
            print("      redrawn: " + redrawn.join(", "));
        }
        print("### RIGGING SYMBOLS OK");
        QCoreApplication.quit();
    }
}
