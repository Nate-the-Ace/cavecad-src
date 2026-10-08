// ShapedLines.js -- Shaped Lines: cave-map line symbology (ledge
// hachures, pit contours, flowstone/rimstone scallops) as real,
// regenerating geometry. This folder-named file is the DECORATE
// SELECTION command -- take any line, polyline, arc, circle or spline
// the caver already drew and dress it as a shaped line -- and the host
// that builds the dedicated "Cave Lines" toolbar and registers the
// per-style draw buttons beside it:
//
//   LedgeFloorDraw / LedgeCeilingDraw / PitDraw / FlowstoneDraw /
//   RimstoneDraw / SlopeDraw / GlyphsDraw -- freehand draw, one button
//                 per NSS symbol (GlyphsDraw places a catalog block,
//                 default the stone-blocks glyph, along the stroke)
//   ShapedFlip    -- mirror ornament to the other side of the spine
//   ShapedSync    -- manual regeneration fallback
//   ShapedLinesListener -- not a tool; installed from CaveSurvey.js
//
// QCAD only ever finds <dir>/<dir>.js on its own (AddOn.getAddOns), so
// init() below registers every sibling, the FeatureTrace precedent.
//
// Why not a native shaped LINETYPE: the fork could render one (the
// machinery is GPL behind a Pro-plugin parser gate), but the DXF
// writer persists dash lengths only -- the symbology would degrade to
// plain dashes on the first save. Cave maps live and travel as DXF.
// Real entities survive. Design: docs/superpowers/specs/
// 2026-08-28-shaped-lines-design.md.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/ShapedLinesRun.js");
include(includeBasePath + "/WallEdging.js");
include(includeBasePath + "/LedgeFloorDraw.js");
include(includeBasePath + "/LedgeCeilingDraw.js");
include(includeBasePath + "/PitDraw.js");
include(includeBasePath + "/FlowstoneDraw.js");
include(includeBasePath + "/RimstoneDraw.js");
include(includeBasePath + "/SlopeDraw.js");
include(includeBasePath + "/GlyphsDraw.js");
include(includeBasePath + "/ShapedFlip.js");
include(includeBasePath + "/ShapedSync.js");

function ShapedLines(guiAction) {
    EAction.call(this, guiAction);
}

ShapedLines.prototype = new EAction();

/** Style keys in the order the dialog offers them -- the draw-button
 *  order, so the two lists read the same. */
ShapedLines.STYLE_ORDER = ["floorledge", "ceilingledge", "pit",
    "flowstone", "rimstone", "slope", "glyphs"];

/**
 * Ask which style/side/scale to dress the selection in.
 * Returns {styleKey, side, scale} or null on cancel. On a bridge that
 * refuses the dialog outright, falls back to the defaults rather than
 * refusing the command -- a decorated floor ledge the caver can Flip
 * and re-style beats a refusal.
 */
ShapedLines.askOptions = function() {
    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = qsTr("Decorate Selection");
        var grid = new QGridLayout();

        grid.addWidget(new QLabel(qsTr("Style:")), 0, 0);
        var styleCombo = new QComboBox();
        for (var i = 0; i < ShapedLines.STYLE_ORDER.length; i++) {
            styleCombo.addItem(
                CsShapeLine.STYLES[ShapedLines.STYLE_ORDER[i]].label);
        }
        grid.addWidget(styleCombo, 0, 1);

        grid.addWidget(new QLabel(qsTr("Ornament side:")), 1, 0);
        var sideCombo = new QComboBox();
        sideCombo.addItem(qsTr("Right of travel"));
        sideCombo.addItem(qsTr("Left of travel"));
        grid.addWidget(sideCombo, 1, 1);

        grid.addWidget(new QLabel(qsTr("Size scale:")), 2, 0);
        var scaleEdit = new QLineEdit();
        scaleEdit.text = "1";
        grid.addWidget(scaleEdit, 2, 1);

        // Glyph picker: "glyphs" only, but shown for every style, the
        // same way the Areas panel's Scale/Density boxes sit beside
        // every pattern tile whether or not that pattern reads them --
        // one control surface rather than one that appears and
        // disappears under the caver's cursor as the style combo
        // changes. Ignored for every style but "glyphs".
        grid.addWidget(new QLabel(qsTr("Glyph:")), 3, 0);
        var symbolCombo = new QComboBox();
        var symbols = CsSymbols.merged().entries;
        var glyphsDefault = CsShapeLine.STYLES["glyphs"].symbolDefault;
        var defaultSymbolIdx = 0;
        for (var s = 0; s < symbols.length; s++) {
            symbolCombo.addItem(symbols[s].nss + " (" + symbols[s].block + ")");
            if (symbols[s].block === glyphsDefault) {
                defaultSymbolIdx = s;
            }
        }
        symbolCombo.currentIndex = defaultSymbolIdx;
        grid.addWidget(symbolCombo, 3, 1);

        var bar = new QHBoxLayout();
        var okBtn = new QPushButton(qsTr("OK"));
        var cancelBtn = new QPushButton(qsTr("Cancel"));
        try { okBtn["default"] = true; } catch (eDef) {}
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);

        var layout = new QVBoxLayout();
        layout.addLayout(grid, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        okBtn.clicked.connect(function() { dlg.accept(); });
        cancelBtn.clicked.connect(function() { dlg.reject(); });

        var answer = dlg.exec();
        var idx = styleCombo.currentIndex;
        var sideIdx = sideCombo.currentIndex;
        var scale = parseFloat(scaleEdit.text);
        var symbolIdx = symbolCombo.currentIndex;
        destrDialog(dlg);
        if (answer === 0) {
            return null;
        }
        return {
            styleKey: ShapedLines.STYLE_ORDER[
                (idx >= 0 && idx < ShapedLines.STYLE_ORDER.length) ? idx : 0],
            side: (sideIdx === 1) ? -1 : 1,
            scale: (!isNaN(scale) && scale > 0) ? scale : 1,
            symbol: (symbolIdx >= 0 && symbolIdx < symbols.length) ?
                symbols[symbolIdx].block : glyphsDefault
        };
    } catch (e) {
        return { styleKey: "floorledge", side: 1, scale: 1, symbol: "" };
    }
};

/**
 * Dress one existing entity as a shaped line.
 *
 * THE WORK IS CsShapeLine.dress'S, in Core, and this is the name this
 * tool's own callers have always used. It moved there when the Therion
 * sketch importer needed to dress an imported ledge exactly the way a
 * hand-drawn one is dressed: Core may not reach into a tool folder, and
 * a second implementation of the spine tags would drift from this one
 * silently -- a shaped line whose tags are subtly wrong looks right
 * until something regenerates it.
 */
ShapedLines.dressOne = function(doc, di, entity, opts, group) {
    return CsShapeLine.dress(doc, di, entity, opts, group);
};

ShapedLines.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocks(doc, "Shaped Lines")) {
        this.terminate();
        return;
    }

    var ids = doc.hasSelection() ? doc.querySelectedEntities() : [];
    var fresh = [];
    var already = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || !CsShapeLine.isSupported(e)) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.ID) !== "" ||
                CsTags.get(e, CsShapeLine.KEY.DECOR) !== "") {
            already++;
            continue;
        }
        fresh.push(e);
    }

    if (fresh.length === 0) {
        EAction.handleUserMessage(already > 0
            ? qsTr("That selection is already shaped. Flip Shaped Side " +
                "changes its direction; Sync Shaped Lines rebuilds it.")
            : qsTr("Select a line, polyline, arc, circle or spline " +
                "first, then Decorate Selection. The toolbar buttons " +
                "draw new shaped lines directly."));
        this.terminate();
        return;
    }

    var opts = ShapedLines.askOptions();
    if (opts === null) {
        this.terminate();
        return;
    }
    // Cached once for the whole selection: each of these walks every
    // entity in the drawing, and dressOne asks per entity.
    try {
        opts.region = CsTrace.profileRegion(doc);
    } catch (eRegion) {
        opts.region = null;
    }
    try {
        opts.bays = CsTrace.sectionBays(doc);
    } catch (eBays) {
        opts.bays = [];
    }

    var group = doc.getTransactionGroup() + 1;
    var hadListener = (typeof ShapedLinesListener !== "undefined");
    if (hadListener) {
        ShapedLinesListener.busy = true;
    }
    var dressed = 0;
    try {
        for (var k = 0; k < fresh.length; k++) {
            try {
                if (ShapedLines.dressOne(doc, di, fresh[k], opts, group)) {
                    dressed++;
                }
            } catch (eOne) {
                // one refusing entity must not stop the rest
            }
        }
    } finally {
        if (hadListener) {
            ShapedLinesListener.busy = false;
        }
    }

    EAction.handleUserMessage(qsTr("Decorated %1 of %2 selected " +
        "entities.").arg(dressed).arg(fresh.length));
    this.terminate();
};

ShapedLines.init = function(basePath) {
    // THE CAVE LINES TOOLBAR IS GONE (Nathan's call, 2026-09-07). Six
    // buttons for six styles were a second front door onto one act: a
    // caver tracing a cave draws walls and ledges with the same drag,
    // and had to know that half of those lived on another bar. Feature
    // Trace's panel carries them now, as tiles drawn from the real
    // ornament, and every typed command below still works.

    var action = new RGuiAction(qsTr("Decorate Selection"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ShapedLines.js");
    action.setIcon(basePath + "/ShapedLines.svg");
    action.setStatusTip(qsTr("Dress the selected line, polyline, arc, " +
        "circle or spline as a ledge, pit, flowstone or rimstone line"));
    action.setDefaultCommands(["shapedlines", "shl"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(20);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // The draw buttons and companions live in sibling files QCAD cannot
    // discover on its own.
    ShapedLinesRun.init(basePath);
    WallEdging.init(basePath);
    LedgeFloorDraw.init(basePath);
    LedgeCeilingDraw.init(basePath);
    PitDraw.init(basePath);
    FlowstoneDraw.init(basePath);
    RimstoneDraw.init(basePath);
    SlopeDraw.init(basePath);
    GlyphsDraw.init(basePath);
    ShapedFlip.init(basePath);
    ShapedSync.init(basePath);
};
