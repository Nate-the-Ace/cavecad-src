// BuildLegend.js
//
// QCAD add-on tool: generate the legend from what the map ACTUALLY
// USES -- its lines, its area fills, and its symbols -- and say what
// each one means.
//
// Scans the drawing for catalogue symbols, traced feature layers,
// shaped lines and Area Fill patterns (Core/CsLegend.js decides what
// that adds up to), then lays out one row each: a SAMPLE of the real
// thing beside its name, and under the name one plain sentence saying
// what it is. Lines come first, then areas, then symbols, because a
// reader meets the passage outline before they meet its floor, and its
// floor before the stalactites sitting on it.
//
// AN AREA ROW'S SWATCH IS CsArea.build, RUN FOR REAL, into a throwaway
// square boundary drawn at the row's own position and never added to
// the document itself -- the same "generator's own output, not a
// stand-in for it" rule CsTileArt.iconOfFill follows for the Areas
// panel's tiles, translated from a painted QPixmap into drawing
// entities because that is what a legend is made of. The fill lands on
// LEGEND, same as every other sample here (never a real feature layer
// -- CheckMap and Feature Trace's completeness badge both walk layers
// with no ownership filter, and a swatch left on BREAKDOWN or
// WATER-POOL-SUMP reads to them as more of the real thing), then is
// found back by CsArea.OWNER_KEY and given the pattern's own colour, so
// it still looks like what the map draws without living where the map
// draws it. See blAreaSwatch.
//
// Nothing is invented: a feature the map does not draw does not appear.
// A legend explaining a rimstone dam that is nowhere on the sheet is
// worse than no legend, because a reader will go looking for it.
//
// THE SAMPLES ARE DRAWN, NOT DESCRIBED. A dashed inferred wall is shown
// dashed, a floor ledge is shown with its hachures, because "Inferred
// Walls" as words teaches nobody which of the lines on the map is the
// inferred one. They live on the LEGEND layer so the whole legend hides
// and clears as a unit, and carry the source layer's colour, linetype
// and lineweight explicitly so they still LOOK like what they explain.
//
// The sentences can be switched off with CaveSurvey/LegendExplain, for
// a tight sheet or a judge who wants the terse form.
//
// Re-running replaces the previous generated legend (tagged
// CaveSurvey/LegendRow): clearing the old one is its own transaction,
// applied before a single stroke of the new one is drawn, so a rebuilt
// area's fill is never found sitting beside a stale one under the same
// AreaOwner id (see the clearing pass's own comment in buildLegendRun).
// Undoing Build Legend therefore takes more than one step -- the old
// legend's removal, the new text and frames, and one more per area
// pattern in use, the same scaffolding-transaction trade-off
// CsLayers.ensure already makes elsewhere in this file.
//
// USAGE:
//   Cave Survey > Build Legend   (or type "bl")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var BL_ROW_HEIGHT = 2.0;      // drawing units per legend row
var BL_TEXT_OFFSET = 2.5;     // text x offset from the sample column

/** Puts one generated entity on the LEGEND layer, wearing the
 *  appearance of the layer it is explaining.
 *
 *  Explicit colour/linetype/lineweight rather than the real layer,
 *  because a legend has to be one object a caver can hide, move or
 *  delete without hunting fourteen layers -- and has to look like the
 *  map at the same time. This is the only place in the suite that sets
 *  appearance on an entity rather than letting its layer decide, and it
 *  is deliberate: these entities are a PICTURE of layers, not members
 *  of them. */
function blStyleAs(doc, entity, sourceLayer, legendLayerId) {
    entity.setLayerId(legendLayerId);
    if (isNull(sourceLayer) || sourceLayer === "") {
        return entity;
    }
    try {
        var style = CsLayers.styleOf(sourceLayer);
        entity.setColor(new RColor(style[0]));
        entity.setLinetypeId(CsLayers.linetypeIdFor(doc, style));
        entity.setLineweight(RLineweight[style[2]]);
    } catch (e) {
        // an unstyled sample is still the right shape in the right
        // place, which is most of what the row is for
    }
    return entity;
}

/** A short straight line for a "this is what that line looks like"
 *  sample, left to right at the row's height. */
function blSampleLine(doc, x, y, length) {
    return new RLineEntity(doc, new RLineData(
        new RVector(x, y), new RVector(x + length, y)));
}

/** The ornament for a shaped-line sample: a throwaway spine, tagged the
 *  way a real one is, run through the same generator the map uses. The
 *  spine is never added to the drawing -- only what it produces.
 *
 *  Side +1 puts the hachures BELOW the sample line, which is the way
 *  they are drawn on a map whose low ground is toward the reader. */
function blShapeDecor(doc, style, x, y, length, di) {
    var spec = CsShapeLine.STYLES[style];
    if (isNull(spec)) {
        return { spine: null, decor: [], layer: "" };
    }
    var spine = blSampleLine(doc, x, y, length);
    try {
        spine.setLayerId(doc.getLayerId(spec.spineLayer));
    } catch (eLayer) {
        // buildDecor only reads the layer to tell plan from elevation;
        // a spine without one is read as plan, which is what a legend
        // sample is
    }
    CsTags.set(spine, CsShapeLine.KEY.STYLE, style);
    CsTags.set(spine, CsShapeLine.KEY.ID, "legend-" + style);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, "1");
    CsTags.set(spine, CsShapeLine.KEY.SCALE, "1");
    // Wall Glyphs only: a FIXED seed, not CsArea.newSeed() -- a legend
    // sample is a picture of the pattern, and rebuilding the sheet must
    // not reshuffle it, the same reasoning CsTileArt.SCATTER_SEED
    // documents for an Area Fill tile.
    if (style === "glyphs") {
        CsTags.set(spine, CsShapeLine.KEY.SEED, "424242");
    }
    var built = null;
    try {
        built = CsShapeLine.buildDecor(doc, spine, null, di);
    } catch (eBuild) {
        built = null;
    }
    return {
        spine: spine,
        decor: isNull(built) ? [] : built.entities,
        // Flowstone, rimstone and slope keep their spine on a hidden
        // control layer, so their sample is the ORNAMENT alone -- which
        // is right: on the map, the ornament is all a reader sees.
        spineVisible: spec.spineLayer.indexOf("CTRL-") !== 0,
        spineLayer: spec.spineLayer,
        decorLayer: isNull(built) ? spec.decorLayer : built.decorLayer
    };
}

/**
 * A small closed square boundary, `side` drawing units across, centred
 * vertically on the row's own baseline `y` -- the throwaway loop an
 * area row's swatch fills into. NEVER added to the document by this
 * function: the caller decides whether it belongs in `op` at all (a
 * FILLED pattern keeps it, as its printed frame; a scatter pattern
 * has no frame of its own -- see blAreaSwatch).
 *
 * A closed POLYLINE, not a periodic spline the way AreaFillRun.commit
 * builds a caver's own stroke: a four-point square has no curve to
 * fit, and CsArea.buildHatch's own polyline branch (THE POLYLINE TRAP,
 * see its header) explodes a closed polyline into loop segments the
 * same way QCAD's own Hatch tool does, so this is the cheaper shape
 * for exactly the case this file needs.
 */
function blAreaBoundary(doc, x, y, side) {
    var half = side / 2;
    var rect = new RPolyline();
    rect.appendVertex(new RVector(x, y - half), 0.0);
    rect.appendVertex(new RVector(x + side, y - half), 0.0);
    rect.appendVertex(new RVector(x + side, y + half), 0.0);
    rect.appendVertex(new RVector(x, y + half), 0.0);
    rect.setClosed(true);
    return new RPolylineEntity(doc, new RPolylineData(rect));
}

/**
 * Draws one AREA row's swatch: CsArea.build run for real against the
 * throwaway square blAreaBoundary just made, so the legend's sand looks
 * like the map's sand because it IS the map's sand generator.
 *
 * EVERYTHING LANDS ON LEGEND, same as every other row -- opts.layer is
 * a plain string CsArea.build passes straight to doc.getLayerId(), so
 * "LEGEND" is as valid a target as the pattern's own real layer would
 * be. Two tools that walk the drawing by LAYER with no ownership
 * filter -- CsTrace.countOnLayers (Feature Trace's completeness badge)
 * and CheckMap's per-layer counts and stray-linework scan -- read a
 * swatch left on a real feature layer as more breakdown, more sand,
 * more stray linework than the survey actually has. A first version of
 * this file put the fill on the pattern's own layer instead, reasoning
 * that ByLayer colour would come along for free; it did, but at the
 * cost of feeding those two tools bad numbers, which is the worse
 * trade.
 *
 * COLOUR IS RECOVERED AFTERWARD, not surrendered: CsArea.build hands
 * back no reference to what it just queued, but it DOES stamp
 * CsArea.OWNER_KEY on every entity it creates, exactly as it does for a
 * real area -- so the fill is built into ITS OWN operation, applied
 * immediately (the same "own small transaction" CsLayers.ensure already
 * is, elsewhere in this file), then found back by that owner id
 * (CsArea.ownedBy, unchanged Core) and restyled with blStyleAs from the
 * pattern's own layer -- the same call every other sample in this file
 * already makes to look right while living somewhere else. This is not
 * one atomic add any more (a caver undoing Build Legend now undoes the
 * text/frame in one step and each area's fill in ones before it,
 * exactly the shape CsLayers.ensure's own scaffolding already accepted
 * for this file) -- but nothing else in the drawing is misled about
 * what the survey contains, which is the property that matters more.
 *
 * A FIXED id and a FIXED seed -- "legend-area:" + the pattern's own
 * catalog key, and CsTileArt.SCATTER_SEED, the same seed the Areas
 * panel's own preview tile rolls -- never CsArea.newSeed(): a legend is
 * redrawn on every press of the button, and a scatter that reshuffled
 * its boulders each time would make a caver think the pattern itself
 * had changed. The id is also how this function's OWN restyle step,
 * and the next run's clearing pass in buildLegendRun, find this row's
 * fill again.
 *
 * Never throws outward: a pattern this build's engine cannot place (a
 * missing block, an unreadable custom library) leaves the row with its
 * frame, or nothing for a scatter pattern, rather than stopping the
 * rest of the legend.
 *
 * Does NOT tag or queue the boundary itself into `op` -- that is the
 * caller's job (buildLegendRun's own `keep`, the same as every other
 * sample this file draws), because a FILLED pattern wants its frame
 * kept and a scatter pattern does not. \return the boundary entity and
 * whether the caller should keep it.
 */
function blAreaSwatch(doc, di, entry, key, x, y, side, legendLayerId) {
    var boundary = blAreaBoundary(doc, x, y, side);

    // The frame CsTileArt.iconOfFilled always draws, even over
    // BEDROCK's null pattern -- a blank framed square is the truthful
    // picture of "draws no fill", not a row with nothing in it. A
    // scatter pattern's tile carries no frame (CsTileArt.iconOfScatter
    // draws only its placed elements), so neither does this.
    var showFrame = entry.engine === "filled";
    if (showFrame) {
        blStyleAs(doc, boundary, entry.layer, legendLayerId);
    }

    var ownerId = CsLegend.AREA_OWNER_PREFIX + key;
    try {
        CsLayers.ensure(doc, di, entry.layer);
        var areaOp = new RAddObjectsOperation();
        CsArea.build(doc, areaOp, boundary, entry,
            { id: ownerId, seed: CsTileArt.SCATTER_SEED, scale: 1.0,
              density: 1.0, layer: CsLayers.LEGEND }, di);
        di.applyOperation(areaOp);

        var fillIds = CsArea.ownedBy(doc, ownerId);
        if (fillIds.length > 0) {
            var mod = new RModifyObjectsOperation();
            for (var i = 0; i < fillIds.length; i++) {
                var fillEnt = doc.queryEntityDirect(fillIds[i]);
                if (isNull(fillEnt)) {
                    continue;
                }
                // blStyleAs sets the layer too -- a no-op here, since
                // CsArea.build already put it on LEGEND, but it is the
                // one call this file already trusts to copy an
                // appearance across without a second copy of the logic.
                blStyleAs(doc, fillEnt, entry.layer, legendLayerId);
                // The same tag every other row's own pieces carry, so
                // the "everything this run drew" invariant holds for an
                // area's fill too, not just its frame and its label.
                CsTags.set(fillEnt, CsLegend.TAG, "area:" + key);
                mod.addObject(fillEnt, false);
            }
            di.applyOperation(mod);
        }
    } catch (eArea) {
        // degrade to the frame alone (or nothing) rather than take the
        // rest of the legend down with one bad pattern
    }

    return { boundary: boundary, keepBoundary: showFrame };
}

/** One line of legend text. */
function blText(doc, x, y, height, label, layerId) {
    var text = new RTextEntity(doc, new RTextData(
        new RVector(x, y), new RVector(x, y),
        height,
        100.0,
        RS.VAlignMiddle, RS.HAlignLeft,
        RS.LeftToRight, RS.Exact,
        1.0, label, "standard", false, false, 0.0, false));
    text.setLayerId(layerId);
    return text;
}

function buildLegendRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn("Build Legend: no active drawing document.");
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Build Legend")) {
        return;
    }
    var di = getDocumentInterface();

    var explain = CsLegend.explaining();
    var rows = CsLegend.rowsFor(CsLegend.usage(doc));
    if (rows.length === 0) {
        CsTell.warn("Build Legend: this map has nothing to explain yet.\n" +
            "Trace some walls or place some symbols first -- the " +
            "legend only ever describes what the map actually uses.");
        return;
    }

    // ---- where does the legend go? -----------------------------------
    var xText = getDouble("Build Legend", "Legend position X:", 0.0, 3);
    if (xText === undefined) {
        return;
    }
    var yText = getDouble("Build Legend", "Legend position Y (top):", 0.0, 3);
    if (yText === undefined) {
        return;
    }

    CsLayers.ensure(doc, di, CsLayers.LEGEND);

    var op = new RAddObjectsOperation();
    op.setText("Build legend");

    // Clear the previously generated legend, APPLIED NOW rather than
    // queued into `op` -- an area row's own fill is built through ITS
    // OWN immediate transaction (blAreaSwatch, further down), and a
    // stale entity only QUEUED for deletion here would still be sitting
    // in the document, under the exact same AreaOwner id, when that
    // rebuild runs -- found by CsArea.ownedBy right alongside the fresh
    // fill it just made, restyled, tagged, and left behind uncleared.
    // Measured, not theorised: the first version of this deferred the
    // whole sweep into `op` the way every other row already safely did,
    // and a second Build Legend run over a drawing with even one area
    // pattern in use came out with the water hatch doubled. Clearing
    // everything up front, before any row is drawn, is what removes the
    // hazard for every row kind at once rather than only for areas.
    //
    // An area row's FILL entities never carry CsLegend.TAG on their
    // own -- they are CsArea.build's own output, found by CsArea.
    // OWNER_KEY's "legend-area:" prefix instead -- but blAreaSwatch also
    // stamps CsLegend.TAG on them once restyled, so this one walk finds
    // everything either way.
    var cleared = 0;
    var allIds = doc.queryAllEntities(false, false);
    var toClear = [];
    for (var c = 0; c < allIds.length; c++) {
        var old = doc.queryEntity(allIds[c]);
        if (isNull(old)) {
            continue;
        }
        var ownedByLegend = CsTags.get(old, CsArea.OWNER_KEY)
            .indexOf(CsLegend.AREA_OWNER_PREFIX) === 0;
        if (CsTags.get(old, CsLegend.TAG) !== "" || ownedByLegend) {
            toClear.push(allIds[c]);
        }
    }
    if (toClear.length > 0) {
        var clearOp = new RDeleteObjectsOperation();
        for (var cc = 0; cc < toClear.length; cc++) {
            var toDelete = doc.queryEntityDirect(toClear[cc]);
            if (!isNull(toDelete)) {
                clearOp.deleteObject(toDelete);
                cleared++;
            }
        }
        di.applyOperation(clearOp);
    }

    var legendLayerId = doc.getLayerId(CsLayers.LEGEND);
    var perFoot = CsShapeLine.perFoot(doc);
    var sample = CsLegend.SAMPLE_FEET * perFoot;
    // The name column clears the widest sample, so a hachured ledge
    // never runs into its own label.
    var textX = xText + sample + BL_TEXT_OFFSET;
    var y = yText;

    var counts = { line: 0, shape: 0, area: 0, symbol: 0 };
    var added = [];

    /** Everything this run draws goes through here: tagged so the next
     *  run can clear it, and never anywhere but the operation. */
    function keep(entity, key) {
        CsTags.set(entity, CsLegend.TAG, key);
        added.push(entity);
        op.addObject(entity, false);
    }

    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];

        if (row.kind === "heading") {
            keep(blText(doc, xText, y, CsDraw.TEXT_HEIGHT,
                CsDraw.caps(row.label), legendLayerId), "heading");
            y -= BL_ROW_HEIGHT * CsLegend.heightOf(row, explain);
            continue;
        }

        if (row.kind === "line") {
            keep(blStyleAs(doc, blSampleLine(doc, xText, y, sample),
                row.layer, legendLayerId), row.key);
            counts.line++;
        } else if (row.kind === "shape") {
            var shaped = blShapeDecor(doc, row.style, xText, y, sample, di);
            if (shaped.spineVisible === true && !isNull(shaped.spine)) {
                keep(blStyleAs(doc, shaped.spine, shaped.spineLayer,
                    legendLayerId), row.key);
            }
            for (var d = 0; d < shaped.decor.length; d++) {
                keep(blStyleAs(doc, shaped.decor[d], shaped.decorLayer,
                    legendLayerId), row.key);
            }
            counts.shape++;
        } else if (row.kind === "area") {
            var areaEntry = CsArea.entryFor(row.pattern);
            if (!isNull(areaEntry)) {
                var side = CsLegend.AREA_SWATCH_FEET * perFoot;
                var swatch = blAreaSwatch(doc, di, areaEntry,
                    row.pattern, xText, y, side, legendLayerId);
                if (swatch.keepBoundary === true) {
                    keep(swatch.boundary, row.key);
                }
            }
            counts.area++;
        } else if (row.kind === "symbol") {
            var block = doc.queryBlock(row.block);
            if (!isNull(block)) {
                // NORMALISED to one legend size. A custom symbol may be
                // drawn anything up to the palette's 10 ft working
                // square, and Truitt Cave's mud slope at scale 1 came
                // out taller than the five rows above it.
                var radius = 0;
                try {
                    radius = CsSymbolStore.radiusOf(doc, row.block);
                } catch (eRadius) {
                    radius = 0;
                }
                var symScale = CsLegend.scaleForSize(
                    CsLegend.SYMBOL_FEET, radius, perFoot);
                var data = new RBlockReferenceData(block.getId(),
                    new RVector(xText + sample / 2, y),
                    new RVector(symScale, symScale),
                    0, 1, 1, 1, 1);
                var symRef = new RBlockReferenceEntity(doc, data);
                keep(blStyleAs(doc, symRef, row.layer, legendLayerId),
                    row.key);
            }
            counts.symbol++;
        }

        keep(blText(doc, textX, y, CsDraw.TEXT_HEIGHT,
            CsDraw.caps(row.label), legendLayerId), row.key);

        // The sentence, under the name and indented, at two thirds the
        // height: a legend is a list of names first, and the meanings
        // must not compete with them for a reader's eye.
        var explainLines = CsLegend.explainLines(row, explain);
        var below = y;
        for (var e = 0; e < explainLines.length; e++) {
            below -= BL_ROW_HEIGHT * 0.6;
            keep(blText(doc, textX + BL_TEXT_OFFSET, below,
                CsDraw.TEXT_HEIGHT * 0.66, explainLines[e],
                legendLayerId), row.key);
        }

        y -= BL_ROW_HEIGHT * CsLegend.heightOf(row, explain);
    }

    di.applyOperation(op);

    var parts = [];
    if (counts.line > 0) {
        parts.push(counts.line + " line" + (counts.line === 1 ? "" : "s"));
    }
    if (counts.shape > 0) {
        parts.push(counts.shape + " shaped line" +
            (counts.shape === 1 ? "" : "s"));
    }
    if (counts.area > 0) {
        parts.push(counts.area + " area pattern" +
            (counts.area === 1 ? "" : "s"));
    }
    if (counts.symbol > 0) {
        parts.push(counts.symbol + " symbol" +
            (counts.symbol === 1 ? "" : "s"));
    }
    EAction.handleUserMessage("Build Legend: " + parts.join(", ") +
        " in use, legend drawn" +
        (explain ? " with what each one means" : "") +
        (cleared > 0 ? " (previous generated legend replaced)" : "") +
        ". Anything the map does not use is not in the legend -- by " +
        "design.");
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function BuildLegend(guiAction) {
    EAction.call(this, guiAction);
}

BuildLegend.prototype = new EAction();

BuildLegend.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    buildLegendRun();
    this.terminate();
};

BuildLegend.init = function(basePath) {
    var action = new RGuiAction(qsTr("Build Legend"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/BuildLegend.js");
    action.setIcon(basePath + "/BuildLegend.svg");
    action.setStatusTip(qsTr("Generate the legend from the symbols the map actually uses, NSS names with UIS aliases"));
    action.setDefaultCommands(["buildlegend", "bl"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
