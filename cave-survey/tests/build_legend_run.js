// build_legend_run.js -- Build Legend explains what the map ACTUALLY
// uses, lines included, and draws a real sample of each.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/build_legend_run.js "$PWD"
//
// tests/js_unit.js proves the row logic over literal usage objects.
// This proves the two halves a literal cannot reach:
//
//   1. CsLegend.usage -- does a drawing's linework actually register as
//      the feature it is? A legend built from a usage scan that sees
//      nothing is an empty legend and no error, which is the failure
//      mode worth a headless test.
//   2. The samples -- a line row has to draw a LINE and a shaped row
//      has to draw its ornament. "Floor Ledge" in words teaches nobody
//      which of the lines on the map is the ledge.

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

var messages = [];
warning = function(text) { messages.push("WARNING: " + text); };
EAction.handleUserMessage = function(text) { messages.push(text); };

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

// NOT "addLine": scripts/simple.js defines a global of that name and
// include() runs after this file's declarations are hoisted, so its
// assignment wins. See tests/check_map_run.js, which lost an afternoon
// to it.
function addSegment(layer, x1, y1, x2, y2, tags) {
    CsLayers.ensure(doc, di, layer);
    var e = new RLineEntity(doc,
        new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    if (!isNull(tags)) {
        for (var key in tags) {
            if (tags.hasOwnProperty(key)) {
                CsTags.set(e, key, tags[key]);
            }
        }
    }
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e.getId();
}

// ---------------------------------------------------------------------
// A map that uses: surveyed walls, inferred walls (in the ELEVATION
// only), and a floor ledge. It uses no ceiling and no symbols.
// ---------------------------------------------------------------------

addSegment(CsLayers.WALLS_SURVEYED, 0, 0, 40, 0);
// The twin, deliberately: a feature traced only in the elevation is
// still a feature this map draws, and a legend that missed it would be
// lying by omission.
addSegment(CsLayers.PROFILE_WALLS_INFERRED, 0, -200, 40, -200);
var ledgeTags = {};
ledgeTags[CsShapeLine.KEY.STYLE] = "floorledge";
ledgeTags[CsShapeLine.KEY.ID] = "ledge-1";
ledgeTags[CsShapeLine.KEY.SIDE] = "1";
addSegment(CsLayers.LEDGE_FLOOR, 0, 20, 40, 20, ledgeTags);

var usage = CsLegend.usage(doc);
ok(usage.features["layer:WALLS-SURVEYED"] > 0,
    "surveyed walls in the drawing register as used");
ok(usage.features["layer:WALLS-INFERRED"] > 0,
    "a feature traced only in the ELEVATION still counts as used");
ok(usage.features["style:floorledge"] > 0,
    "a shaped line registers by its style tag");
ok(isNull(usage.features["layer:CEILING"]),
    "a feature the map does not draw does not register");
eqs(usage.symbols.length, 0, "and no symbols are claimed");

var rows = CsLegend.rowsFor(usage);
eqs(rows.length, 3, "three features in use make three rows, no headings");

// ---------------------------------------------------------------------
// Draw it, and look at what landed.
// ---------------------------------------------------------------------

includeBasePath = repoRoot + "/scripts/CaveSurvey/BuildLegend";
include(includeBasePath + "/BuildLegend.js");

// The position prompts, answered without a human.
getDouble = function(title, prompt, def) {
    return prompt.indexOf("X") >= 0 ? 500.0 : 500.0;
};

var beforeIds = doc.queryAllEntities(false, false).length;
buildLegendRun();

var drawn = [];
var byKind = { text: 0, line: 0, other: 0 };
var ids = doc.queryAllEntities(false, false);
for (var i = 0; i < ids.length; i++) {
    var e = doc.queryEntity(ids[i]);
    if (isNull(e) || CsTags.get(e, CsLegend.TAG) === "") {
        continue;
    }
    drawn.push(e);
    if (e.getType() === RS.EntityText) {
        byKind.text += 1;
    } else if (e.getType() === RS.EntityLine) {
        byKind.line += 1;
    } else {
        byKind.other += 1;
    }
}

ok(drawn.length > 0, "the legend drew something (messages: " +
    messages.join(" | ") + ")");
ok(byKind.text >= 3,
    "every row is named in text (" + byKind.text + " text entities)");
// Two plain samples plus a ledge spine, and the ledge's hachures on top
// -- a ledge drawn as a bare line would be indistinguishable from a
// wall, which is the whole reason the samples are generated.
ok(byKind.line >= 3 + 2,
    "the samples are real geometry, with ornament on the shaped one (" +
        byKind.line + " lines)");

var onLegend = true;
for (i = 0; i < drawn.length; i++) {
    if (CsBind.layerNameOf(doc, drawn[i]) !== CsLayers.LEGEND) {
        onLegend = false;
    }
}
ok(onLegend,
    "everything the legend draws is on the LEGEND layer, so it hides " +
        "and clears as one thing");

// Re-running replaces rather than stacking.
buildLegendRun();
var second = 0;
ids = doc.queryAllEntities(false, false);
for (i = 0; i < ids.length; i++) {
    var e2 = doc.queryEntity(ids[i]);
    if (!isNull(e2) && CsTags.get(e2, CsLegend.TAG) !== "") {
        second += 1;
    }
}
eqs(second, drawn.length,
    "building the legend twice replaces it rather than stacking a " +
        "second copy on top");

// And the generated legend is not itself counted as usage next time.
var after = CsLegend.usage(doc);
ok(isNull(after.features["layer:CEILING"]),
    "the legend's own geometry never teaches the next run new features");

// ---------------------------------------------------------------------
// AREAS: a room of sand and a pool of water. The swatch's fill is
// CsArea.build's own output, and the point of this section is proving
// it landed where it was told to -- on LEGEND, restyled to the
// pattern's own colour, never left on SEDIMENT-SAND-GRAVEL or
// WATER-POOL-SUMP where CheckMap and Feature Trace's completeness
// badge would count it as more cave than the survey actually has.
// ---------------------------------------------------------------------

function addAreaBoundary(x, y, side, patternKey) {
    var rect = new RPolyline();
    rect.appendVertex(new RVector(x, y), 0.0);
    rect.appendVertex(new RVector(x + side, y), 0.0);
    rect.appendVertex(new RVector(x + side, y + side), 0.0);
    rect.appendVertex(new RVector(x, y + side), 0.0);
    rect.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(rect));
    CsTags.set(e, CsArea.ID_KEY, "area-" + patternKey);
    CsTags.set(e, CsArea.PATTERN_KEY, patternKey);
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
    return e.getId();
}

addAreaBoundary(0, 100, 20, "SAND");
addAreaBoundary(50, 100, 20, "WATER");

var usageAreas = CsLegend.usage(doc);
eqs(usageAreas.areas.length, 2,
    "a drawing with sand and water areas registers exactly those two " +
        "patterns as used");
ok(usageAreas.areas[0].key === "SAND" && usageAreas.areas[1].key === "WATER",
    "in the catalog's own order, sand before water");

var areaRowsOnly = [];
var rowsWithAreas = CsLegend.rowsFor(usageAreas);
for (i = 0; i < rowsWithAreas.length; i++) {
    if (rowsWithAreas[i].kind === "area") {
        areaRowsOnly.push(rowsWithAreas[i]);
    }
}
eqs(areaRowsOnly.length, 2,
    "exactly two AREAS rows, one per pattern actually in use, not " +
        "all thirteen the catalog knows about");

buildLegendRun();

// Everything the legend has EVER drawn, area swatches included -- a
// fill entity carries CsArea.OWNER_KEY ("legend-area:...") rather than
// CsLegend.TAG on its own, but blAreaSwatch stamps CsLegend.TAG on it
// too once restyled, so this one scan (mirroring buildLegendRun's own
// clearing pass) finds every piece either way.
function legendDrawnNow() {
    var out = [];
    var allIds2 = doc.queryAllEntities(false, false);
    for (var k = 0; k < allIds2.length; k++) {
        var ent = doc.queryEntity(allIds2[k]);
        if (isNull(ent)) {
            continue;
        }
        var owned = CsTags.get(ent, CsArea.OWNER_KEY)
            .indexOf(CsLegend.AREA_OWNER_PREFIX) === 0;
        if (CsTags.get(ent, CsLegend.TAG) !== "" || owned) {
            out.push(ent);
        }
    }
    return out;
}

var drawnWithAreas = legendDrawnNow();
ok(drawnWithAreas.length > drawn.length,
    "the legend grew once areas were added to the drawing");

// THE ASSERTION THAT WOULD HAVE CAUGHT IT: a swatch's fill landing on
// its pattern's own real layer (SEDIMENT-SAND-GRAVEL, WATER-POOL-SUMP)
// reads to CheckMap and Feature Trace's completeness badge as more of
// the real thing, since both walk a layer's contents with no ownership
// filter. Every entity the legend just drew -- frame, fill and text
// alike -- must sit on LEGEND and nowhere else.
var offMapLayer = [];
for (i = 0; i < drawnWithAreas.length; i++) {
    var layerHere = CsBind.layerNameOf(doc, drawnWithAreas[i]);
    if (layerHere !== CsLayers.LEGEND) {
        offMapLayer.push(drawnWithAreas[i].getId() + ":" + layerHere);
    }
}
eqs(offMapLayer.length, 0,
    "no swatch entity -- fill or frame -- lands on a map feature " +
        "layer (offenders: " + offMapLayer.join(",") + ")");

// Rebuilding with an area pattern in use does not double its fill --
// the bug an earlier version of this shipped with: clearing the old
// legend was deferred into the same operation as drawing the new one,
// so a stale fill was still live in the document, under the same
// AreaOwner id, when the fresh one was built beside it.
buildLegendRun();
eqs(CsArea.ownedBy(doc, CsLegend.AREA_OWNER_PREFIX + "WATER").length, 1,
    "rebuilding a legend with an area pattern in use does not double " +
        "its swatch fill (WATER's hatch stays exactly one entity)");
eqs(legendDrawnNow().length, drawnWithAreas.length,
    "and the whole legend -- lines, areas and symbols alike -- still " +
        "replaces rather than stacks once areas are part of it");

// ---------------------------------------------------------------------

if (failures.length === 0) {
    print("### BUILD LEGEND OK " + drawn.length + " entities");
} else {
    print("### BUILD LEGEND FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
