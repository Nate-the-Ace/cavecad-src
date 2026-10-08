// SheetSetup.js
//
// QCAD add-on tool: turn a drawn cave into a finished SHEET -- border,
// scale bar, north arrow, and a title block filled in from what the
// drawing already knows.
//
//   Cave Survey > Sheet Setup   (or type "sheet")
//
// WHY IT EXISTS. The NSS template ships the sheet furniture as
// reference pieces -- a scale bar, a north arrow, modular title block
// lines -- parked below the sheet for a cartographer to copy and scale
// by hand. They are measured in INCHES of paper and the cave is drawn
// in FEET, and the number that reconciles the two is the plot scale.
// A beginner does not know that, so the pieces stay in the corner of
// the template and the map goes out with no scale bar at all. Check Map
// finds exactly that on real drawings: no scale bar, no north arrow, a
// title block that never says who surveyed the cave.
//
// So this asks two questions a cartographer can answer -- what paper,
// what scale -- and does the arithmetic. Every measurement it draws is
// an inch of paper multiplied by the scale, which is why a 0.14 inch
// title block line comes out 7 feet tall at 1" = 50 ft and prints at
// 0.14 inch. See Core/CsSheetSetup.js.
//
// WHAT IT WILL NOT DO. It never writes the LOCATION field, though the
// drawing usually knows exactly where the cave is. See
// CsSheetSetup.locationFor: filling that automatically would put an
// entrance's coordinates on every sheet anybody plotted, without one
// decision being made by a person.
//
// It also never overwrites a field a human has already typed. Re-run it
// after another trip and the length, depth and grade are refreshed; the
// cave's name, as you worded it, stays as you worded it.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/Print/Print.js");
include(includeBasePath + "/../Core/CsAll.js");

/** The tag every generated sheet entity carries, so a re-run replaces
 *  what the last one drew instead of stacking a second sheet on it.
 *  Lives in Core because CsProfileDraw reads it too -- it asks where
 *  the elevation sheet is by finding that sheet's border. */

function SheetSetup(guiAction) {
    EAction.call(this, guiAction);
}

SheetSetup.prototype = new EAction();

/**
 * The PLAN's own extents.
 *
 * THE PLAN ONLY (Nathan, 2026-09-10). The extended elevation is drawn
 * BELOW the plan in the same drawing and a section bay is parked clear
 * of both, so measuring "everything in the document" measured a column
 * of three views and sized the sheet for it -- which is why Truitt Cave
 * wanted 1" = 80 ft for a plan that fits comfortably at 40. A sheet is
 * laid out around the MAP, and the other views are placed onto it
 * afterwards as elements, the way a legend or a cross section is.
 *
 * Ignores anything this tool drew and anything on a sheet layer too:
 * otherwise the second run measures the first run's border and the
 * sheet grows every time it is run.
 */
/**
 * The entities of the cave itself: MODEL SPACE, whichever sheet or view
 * happens to be showing. (queryAllEntities(.., false) answers for the
 * CURRENT block, which is a layout when the panel is opened from one.)
 */
SheetSetup.modelIds = function(doc) {
    return doc.queryBlockEntities(doc.getModelSpaceBlockId());
};

SheetSetup.caveBox = function(doc) {
    var box = null;
    var ids = SheetSetup.modelIds(doc);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        var frame = CsLayers.frameOf(layer);
        if (frame !== "plan") {
            continue;   // sheet furniture, the elevation, a section bay
        }
        var b = null;
        try {
            b = e.getBoundingBox();
        } catch (eBox) {
            b = null;
        }
        if (isNull(b)) {
            continue;
        }
        var min = b.getMinimum(), max = b.getMaximum();
        if (!isFinite(min.x) || !isFinite(max.x)) {
            continue;
        }
        if (box === null) {
            box = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
        } else {
            box.minX = Math.min(box.minX, min.x);
            box.minY = Math.min(box.minY, min.y);
            box.maxX = Math.max(box.maxX, max.x);
            box.maxY = Math.max(box.maxY, max.y);
        }
    }
    return box;
};

/**
 * What the cave is MADE OF, as a list of boxes: one per plan entity,
 * for a tiled plan to decide which sheets have anything on them. Scans
 * and the aerial photograph are left out (a sheet carries no raster, so
 * a photograph under the whole cave must not make every tile "occupied"),
 * and so is anything this tool drew. Capped, because a box per entity of
 * a big drawing is thousands.
 */
SheetSetup.occupancy = function(doc) {
    var out = [];
    var ids = SheetSetup.modelIds(doc);
    var stride = Math.max(1, Math.ceil(ids.length / 8000));
    for (var i = 0; i < ids.length; i += stride) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e instanceof RImageEntity) {
            continue;
        }
        if (CsLayers.frameOf(CsBind.layerNameOf(doc, e)) !== "plan") {
            continue;
        }
        try {
            var b = e.getBoundingBox();
            var mn = b.getMinimum(), mx = b.getMaximum();
            if (isFinite(mn.x) && isFinite(mx.x)) {
                out.push({ minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y });
            }
        } catch (eBox) {
        }
    }
    return out;
};

/**
 * The band under the map, as a function of the paper's orientation, for
 * the choices on the panel (which pieces are ticked): the furniture packs
 * into more rows on a narrower sheet, so the answer depends on which way
 * up the paper is.
 */
SheetSetup.footerFn = function(state, sheet, wants) {
    // NO BAND IS KEPT UNDER A PLAN: every plan sheet is map right out to the
    // margin with its title block, bar and arrow over it on a white backing,
    // whether the cave takes one sheet or twenty. (A band under the map made
    // a single sheet and a tiled one two different pictures, so dragging the
    // cave across the point where one becomes the other made the sheet jump.)
    return function(turned) {
        return 0;
    };
};

/**
 * The sheet layout for the choices on the panel: a grid of sheets when the
 * cave overflows one (`tiled` true), else the one sheet (`tiled` false). Never
 * null for a drawing that has a cave -- one sheet is a grid of one.
 *
 * The cave dragged by hand slides the PAPER under it the other way,
 * the same rule borderBox follows -- which is the layout's shiftInches.
 */
SheetSetup.tileLayoutFor = function(state, sheet, scale, offsets, wants,
        turned) {
    if (isNull(state) || isNull(state.caveBox) || isNull(sheet)) {
        return null;
    }
    var drag = CsSheetSetup.offsetOf(offsets, "cave");
    var layout = CsSheetTile.layout({ caveBox: state.caveBox,
        sheet: sheet,
        // drawing units per inch of paper: feet per inch times units per foot
        scale: scale * (isNull(state.perFoot) ? 1 : state.perFoot),
        // NO BAND IS RESERVED on a tiled plan: every sheet is map right
        // out to the page margin, and the title block, bar and arrow sit
        // over it on a white backing (see clipToMap).
        footerInches: 0,
        // the paper's way up is the caver's, never worked out for them
        turned: turned === true,
        occupied: state.occupied,
        shiftInches: { x: -drag.x, y: -drag.y } });
    return layout;
};

/** True when this drawing has an extended elevation to place. */
SheetSetup.hasElevation = function(doc) {
    try {
        return CsProfileBox.boxes(doc).length > 0;
    } catch (e) {
        return false;
    }
};

/** Every title block field's value: what the drawing already says,
 *  falling back to what the survey can tell us. Computed once, because
 *  the sheet has to be SIZED from these before it can be drawn. */
SheetSetup.titleValues = function(doc, filled) {
    var values = {};
    for (var f = 0; f < CsSheet.FIELDS.length; f++) {
        var field = CsSheet.FIELDS[f];
        if (field.perSheet === true) {
            continue;       // the sheet number is each sheet's own (its Layout tab's name), never one value for all
        }
        var existing = SheetSetup.readWhole(doc, field);
        if (String(existing).replace(/\s/g, "") !== "") {
            values[field.id] = existing;
        } else if (!isNull(filled) && filled.hasOwnProperty(field.id)) {
            values[field.id] = filled[field.id];
        }
    }
    return values;
};

/**
 * What one title block field currently says, in full.
 *
 * Prefers the whole value stashed by a previous run over what is
 * VISIBLE on the sheet: a field wrapped across four lines has only its
 * first line under CsSheet's own tag, and reading that back would let
 * every re-run trim the credit list a little further.
 */
SheetSetup.readWhole = function(doc, field) {
    // The title block lives on a layout now. Whatever a sheet says -- the
    // generator's words or a person's edit of them -- is read back from the
    // sheet, so a regenerated tile never overwrites what was typed.
    try {
        var sheets = Layouts.list(doc);
        for (var l = 0; l < sheets.length; l++) {
            var ids = doc.queryBlockEntities(sheets[l].blockId);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e) || e.isUndone() || CsTags.get(e, CsSheet.TAG) !== field.id) {
                    continue;
                }
                var whole = CsTags.get(e, CsSheetSetup.TAG_FULL);
                if (whole !== "") {
                    return whole;
                }
                // what the sheet SHOWS, without the field's caption ("LOCATION: "):
                // reading the caption back as part of the value is how it got
                // printed twice on the next build
                var shown = String(e.getPlainText());
                // the caption is compared WITHOUT its trailing blanks: an empty field is
                // drawn as the bare caption ("CARTOGRAPHY BY:"), and the caption itself is
                // "Cartography by:  " -- an exact-prefix test read the bare caption back as
                // the VALUE and printed it twice on the next build
                var prefix = isNull(field.prefix) ? "" : String(field.prefix).replace(/\s+$/, "");
                if (prefix !== "" && shown.toUpperCase().indexOf(prefix.toUpperCase()) === 0) {
                    shown = shown.substring(prefix.length);
                }
                shown = shown.replace(/^\s+|\s+$/g, "");
                if (shown !== "") {
                    return shown;
                }
            }
        }
    } catch (eWhole) {
        // fall through to nothing
    }
    return "";
};

/** The survey, its stats and its grade -- or nulls, for a drawing with
 *  no survey in it yet. A sheet is still worth building on a drawing
 *  that has only tracing on it; it just cannot fill in the numbers. */
SheetSetup.readSurvey = function(doc) {
    var out = { survey: null, resolved: null, stats: null, grade: null };
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (isNull(asDrawn)) {
            return out;
        }
        out.survey = asDrawn.survey;
        out.resolved = asDrawn.resolved;
        out.survey.distanceUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        out.stats = CsStats.compute(out.survey, asDrawn.resolved,
            CsTraverse.SLOPE);
        out.grade = CsGrade.compute(out.survey, asDrawn.resolved, out.stats);
    } catch (e) {
        // a drawing whose survey will not resolve still gets its sheet
    }
    return out;
};

// ---------------------------------------------------------------------
// THE PALETTE.
//
// A dock, not a dialog (Nathan, 2026-09-10). Choosing paper and scale
// is not one question answered once: it is a handful of choices that
// argue with each other -- bigger paper buys detail, a title block with
// twenty-one surveyors on it takes a scale step, the elevation only
// fits at all because it has its own sheet. A modal dialog makes each
// of those a guess followed by a build followed by a look.
//
// So the panel shows the layout as it will be, roughly, and rebuilds
// the picture as the choices change. Building the file is then the LAST
// thing rather than the way to find out.
// ---------------------------------------------------------------------

var csSheetSetupDock;

/** What the panel says under the preview when nothing is being
 *  dragged. Held here so the drag readout can put it back. */
// SHORT ON PURPOSE. A wrapped QLabel under a stretching view is given
// the height its sizeHint asked for BEFORE the wrap, so a three-line
// sentence here is drawn clipped -- measured live, 2026-09-14, with the
// first line cut in half. The rest of the explanation is the
// handbook's job.
/**
 * How SheetSetup.tell says each kind of thing (Nathan, 2026-09-27: "the
 * red text made me think something bad happened"). Green is done;
 * yellow is nothing broke but you have to act first; red is something
 * failed. Plain status -- the fit, the spill-free page -- stays in the
 * label's own colour. Mid-tones, so each reads on light and dark.
 */
SheetSetup.DONE = "done";
SheetSetup.WARNING = "warning";
SheetSetup.ERROR = "error";
SheetSetup.LEVELS = {
    done:    { colour: "#2e9e4f", box: false },
    warning: { colour: "#c99a06", box: true },
    error:   { colour: "#d9463b", box: true }
};

/** Text made safe to sit inside the command line's rich text. */
SheetSetup.escapeHtml = function(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
};

SheetSetup.HINT = qsTr("Drag a piece to arrange the page. Edges and " +
    "middles snap.");

/** How the preview paints each kind of box. */
SheetSetup.PREVIEW_STYLE = {
    "sheet": { line: [70, 70, 70], fill: [255, 255, 255], width: 2 },
    "elevation-sheet": { line: [70, 70, 70], fill: [255, 255, 255],
        width: 2 },
    "tile": { line: [90, 90, 90], fill: [255, 255, 255], width: 1 },
    "tile-margin": { line: [170, 170, 170], fill: null, width: 1,
        dashed: true },
    "matchline": { line: [200, 40, 160], fill: [200, 40, 160, 120],
        width: 1 },
    "margin": { line: [150, 150, 150], fill: null, width: 1,
        dashed: true },
    "cave": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "band": { line: [40, 90, 190], fill: [40, 90, 190, 40], width: 1 },
    "title": { line: [150, 100, 30], fill: [220, 170, 70, 90], width: 1 },
    "bar": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 },
    "north": { line: [60, 130, 60], fill: [90, 180, 90, 110], width: 1 }
};

/** The style for any item kind, including a per-chunk "band:<key>"
 *  kind -- one box per chunk, sharing plain "band"'s look. See
 *  CsSheetSetup.preview and CsSheetSetup.isMovable. */
SheetSetup.previewStyleFor = function(kind) {
    if (!isNull(SheetSetup.PREVIEW_STYLE[kind])) {
        return SheetSetup.PREVIEW_STYLE[kind];
    }
    if (typeof kind === "string" && kind.indexOf("band:") === 0) {
        return SheetSetup.PREVIEW_STYLE.band;
    }
    return null;
};

/** Paints one preview into a pixmap. Rough by design -- see
 *  CsSheetSetup.preview. */
SheetSetup.paintPreview = function(preview, width, height) {
    try {
        var pixmap = new QPixmap(width, height);
        pixmap.fill(new QColor(245, 245, 245));
        if (isNull(preview) || preview.bounds === null) {
            return pixmap;
        }
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var pad = 6;
        var bw = preview.bounds.maxX - preview.bounds.minX;
        var bh = preview.bounds.maxY - preview.bounds.minY;
        var factor = Math.min((width - pad * 2) / (bw > 0 ? bw : 1),
            (height - pad * 2) / (bh > 0 ? bh : 1));
        var offX = pad + ((width - pad * 2) - bw * factor) / 2;
        var offY = pad + ((height - pad * 2) - bh * factor) / 2;

        for (var i = 0; i < preview.items.length; i++) {
            var item = preview.items[i];
            var style = SheetSetup.previewStyleFor(item.kind);
            if (isNull(style)) {
                continue;
            }
            var x = offX + (item.box.minX - preview.bounds.minX) * factor;
            // Y IS FLIPPED: a drawing counts up, a pixmap counts down.
            var y = offY + (preview.bounds.maxY - item.box.maxY) * factor;
            var w = (item.box.maxX - item.box.minX) * factor;
            var h = (item.box.maxY - item.box.minY) * factor;
            var pen = new QPen(new QColor(style.line[0], style.line[1],
                style.line[2]));
            pen.setWidth(style.width);
            if (style.dashed === true) {
                try {
                    pen.setStyle(Qt.DashLine);
                } catch (eDash) {
                }
            }
            painter.setPen(pen);
            if (isNull(style.fill)) {
                painter.setBrush(new QBrush());
            } else {
                painter.setBrush(new QBrush(new QColor(style.fill[0],
                    style.fill[1], style.fill[2],
                    style.fill.length > 3 ? style.fill[3] : 255)));
            }
            painter.drawRect(x, y, Math.max(w, 1), Math.max(h, 1));
            // A CHUNK BOX NEEDS ITS OWN LABEL. Furniture is told apart
            // by colour alone, which works for four fixed pieces of
            // four different colours -- it does not work for however
            // many chunks a cave has, all the same colour. See
            // CsSheetSetup.preview, which is the only place item.label
            // is ever set.
            if (!isNull(item.label) && item.label !== "") {
                painter.setPen(new QPen(new QColor(style.line[0],
                    style.line[1], style.line[2])));
                painter.drawText(x + 2, y + 12, String(item.label));
            }
        }
        painter.end();
        return pixmap;
    } catch (ePaint) {
        return null;
    }
};

/** Everything the panel needs to know about the open drawing, read
 *  once per refresh. */
SheetSetup.readState = function(doc) {
    var state = { ok: false, why: "", caveBox: null, caveW: 0, caveH: 0,
        recordPath: "", hasElevation: false, bands: [], filled: {},
        titleLines: [], footerInches: 0, declination: null,
        declinationDate: "" };
    if (isNull(doc)) {
        state.why = "No drawing open.";
        return state;
    }
    try {
        state.recordPath = String(doc.getFileName());
    } catch (ePath) {
        state.recordPath = "";
    }
    state.caveBox = SheetSetup.caveBox(doc);
    if (state.caveBox === null) {
        state.why = "This drawing has nothing on it yet. Draw the cave " +
            "first -- a sheet with nothing in it has no scale to be at.";
        return state;
    }
    state.occupied = SheetSetup.occupancy(doc);
    var perFoot = CsShapeLine.perFoot(doc);
    state.perFoot = perFoot;
    state.caveW = (state.caveBox.maxX - state.caveBox.minX) / perFoot;
    state.caveH = (state.caveBox.maxY - state.caveBox.minY) / perFoot;

    var read = SheetSetup.readSurvey(doc);
    state.survey = read.survey;
    state.resolved = read.resolved;
    // The magnetic arm the north arrow will carry, so the preview's
    // north box is the whole piece rather than the true arrow alone.
    var reading = CsSheetSetup.latestDeclination(read.survey);
    state.declination = isNull(reading) ? null : reading.declination;
    state.declinationDate = isNull(reading) ? "" : reading.date;
    state.filled = CsSheetSetup.autoFill(read.survey, read.stats,
        read.grade);
    state.titleLines = CsSheetSetup.titleLines(
        SheetSetup.titleValues(doc, state.filled));
    state.footerInches = Math.max(
        CsSheetSetup.linesHeight(state.titleLines) + 0.4,
        CsSheetSetup.BAR.height + CsSheetSetup.TEXT.body * 4);
    // The title block's own height: what the furniture layout packs.
    state.titleHeight = CsSheetSetup.linesHeight(state.titleLines) + 0.2;
    state.hasElevation = SheetSetup.hasElevation(doc);
    state.chunked = false;
    if (state.hasElevation) {
        var mode = "extended";
        try {
            mode = RSettings.getStringValue("CaveSurvey/ProfileMode",
                "extended");
        } catch (eMode) {
        }
        state.chunked = (mode === "chunked");
        // A CHUNKED SHEET NEEDS EACH CHUNK'S OWN BOX AND CAPTION, which
        // the live drawing's box layer does not carry (CsProfileBox
        // reads back a bare key, not the caver-facing pitch-depth
        // text) -- so this is computed fresh from CsProfile.build
        // rather than read off the drawing, same auto-layout preset
        // Generate Profile itself would land on. A caver's in-progress
        // drag lives only in w.offsets and is applied later, purely in
        // CsSheetSetup.preview -- see CsSheetSetup.js:1049.
        if (state.chunked && !isNull(state.resolved)) {
            try {
                var chunkSettings = CsProfile.settings();
                var builtChunks = CsProfile.build(state.survey,
                    state.resolved,
                    { flatSplayDeg: chunkSettings.flatSplayDeg,
                      offsets: {} });
                var boxMargin;
                try {
                    var boxUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
                    boxMargin = CsUnits.convert(
                        CsProfileDraw.BOX_MARGIN_FEET, CsUnits.FEET,
                        boxUnit);
                } catch (eMargin) {
                    boxMargin = CsProfileDraw.BOX_MARGIN_FEET;
                }
                var chunkBoxes = CsProfileDraw.boxesFor(builtChunks,
                    boxMargin);
                state.bands = [];
                for (var bi = 0; bi < builtChunks.bands.length; bi++) {
                    var bnd = builtChunks.bands[bi];
                    var bx = null;
                    for (var boxi = 0; boxi < chunkBoxes.length; boxi++) {
                        if (chunkBoxes[boxi].key === bnd.key) {
                            bx = chunkBoxes[boxi];
                            break;
                        }
                    }
                    if (bx === null) {
                        continue;
                    }
                    state.bands.push({ key: bnd.key, minX: bx.minX,
                        minY: bx.minY, maxX: bx.maxX, maxY: bx.maxY,
                        label: CsChunk.caption(bnd) });
                }
            } catch (eChunked) {
                state.bands = [];
            }
        } else {
            try {
                state.bands = CsProfileBox.boxes(doc);
            } catch (eBands) {
                state.bands = [];
            }
        }
    }
    state.ok = true;
    return state;
};

SheetSetup.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Sheet Setup"), appWin);
    dock.objectName = "CaveSurveySheetSetupDock";

    // WHAT HAS BEEN DRAGGED WHERE, in inches of paper, per piece.
    // Inches because the scale is one of the two things this panel
    // exists to change: a bar nudged two inches right stays two inches
    // right when the scale steps.
    var w = { state: null, quiet: false, offsets: {} };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // A GRID, not a QFormLayout: this bridge generates QFormLayout
    // without addRow (probed live, 2026-09-10 -- the panel threw before
    // it had built a single control). CsPanel.formGrid is the suite's
    // own answer, already used by every other panel with fields on it.
    var form = CsPanel.formGrid(1);
    w.sheetCombo = new QComboBox();
    for (var s = 0; s < CsSheetSetup.SHEETS.length; s++) {
        w.sheetCombo.addItem(CsSheetSetup.SHEETS[s].name);
        if (CsSheetSetup.SHEETS[s].name === CsSheetSetup.DEFAULT_SHEET) {
            w.sheetCombo.currentIndex = s;
        }
    }
    w.scaleCombo = new QComboBox();
    for (var c = 0; c < CsSheetSetup.SCALE_ROWS.length; c++) {
        // The ROW's own label: an imperial scale says "1" = 50 ft" and
        // a metric one says "1:500", because that is how each is said.
        w.scaleCombo.addItem(CsSheetSetup.SCALE_ROWS[c].label);
    }

    // ONE ROW, SPLIT DOWN THE MIDDLE (Nathan, 2026-09-10). A docked
    // panel's scarce dimension is height -- the preview underneath is
    // the thing worth giving it to -- and two fields that each need a
    // label and a combo do not need two rows to say so.
    //
    // The two combo columns take equal stretch and the label columns
    // take none, so the split lands in the middle whatever the dock is
    // widened to.
    form.addWidget(new QLabel(qsTr("Paper:")), 0, 0);
    form.addWidget(w.sheetCombo, 0, 1);
    form.addWidget(new QLabel(qsTr("Scale:")), 0, 2);
    form.addWidget(w.scaleCombo, 0, 3);
    // WHICH WAY UP is part of choosing the paper, so it sits with the
    // paper and the scale: the sheet is landscape, as listed, unless
    // this is ticked.
    w.cbTurn = new QCheckBox(qsTr("Portrait"));
    w.cbTurn.toolTip = qsTr("The paper is used the way up you set it: " +
        "landscape, as the paper is listed, unless this is ticked.");
    form.addWidget(w.cbTurn, 0, 4);
    try {
        form.setColumnStretch(0, 0);
        form.setColumnStretch(1, 1);
        form.setColumnStretch(2, 0);
        form.setColumnStretch(3, 1);
        form.setColumnStretch(4, 0);
    } catch (eStretch) {
        // a bridge without the setter gets whatever the grid gives,
        // which is still one row
    }
    layout.addLayout(form, 0);

    w.fitLabel = new QLabel("");
    w.fitLabel.wordWrap = true;
    layout.addWidget(w.fitLabel, 0, 0);

    // THE PREVIEW IS A VIEW, NOT A PICTURE (Nathan, 2026-09-14). A
    // QPixmap in a QLabel could show the layout and nothing more: this
    // bridge gives a script no way to get a click coordinate out of a
    // label, so "put the scale bar over there" was a wish. An embedded
    // QCAD view over a scratch document takes drags, and
    // Core/CsSheetView.js holds the wiring.
    //
    // The label stays as the FALLBACK: a build that refuses the view
    // still gets the picture, which is what the panel had before.
    w.pane = CsSheetPreview.build(body);
    if (w.pane !== null) {
        try {
            w.pane.view.setMinimumHeight(150);
        } catch (eMin) {
        }
        layout.addWidget(w.pane.view, 1, 0);
        w.pane.view.onDrag = function(kind, snapped) {
            SheetSetup.dragTo(kind, snapped);
        };
        w.pane.view.onDragDone = function() {
            SheetSetup.dragDone();
        };
    } else {
        w.preview = new QLabel("");
        try {
            w.preview.setMinimumHeight(150);
            w.preview.alignment = Qt.AlignCenter;
        } catch (ePrev) {
        }
        layout.addWidget(w.preview, 1, 0);
    }

    w.hint = new QLabel(SheetSetup.HINT);
    w.hint.wordWrap = true;
    layout.addWidget(w.hint, 0, 0);

    w.cbBorder = new QCheckBox(qsTr("Border"));
    w.cbBar = new QCheckBox(qsTr("Scale bar"));
    w.cbNorth = new QCheckBox(qsTr("North arrow"));
    w.cbTitle = new QCheckBox(qsTr("Title block"));
    w.cbElevation = new QCheckBox(qsTr("Elevation on its own sheet"));
    w.cbBorder.checked = true;
    w.cbBar.checked = true;
    w.cbNorth.checked = true;
    w.cbTitle.checked = true;
    layout.addWidget(w.cbBorder, 0, 0);
    layout.addWidget(w.cbBar, 0, 0);
    layout.addWidget(w.cbNorth, 0, 0);
    layout.addWidget(w.cbTitle, 0, 0);
    layout.addWidget(w.cbElevation, 0, 0);

    w.whereCombo = new QComboBox();
    w.whereCombo.addItem(qsTr("All sheets in this file"));
    w.whereCombo.addItem(qsTr("All sheets in a new file"));
    w.whereCombo.addItem(qsTr("A new file for each sheet"));
    w.whereCombo.currentIndex = CsLayoutGen.WHERE_THIS;
    w.whereCombo.toolTip = qsTr("Where Build Sheet puts the sheets. A new " +
        "file is a copy of the drawing with the sheets in it; this drawing " +
        "is left as it was.");
    layout.addWidget(new QLabel(qsTr("Put the sheets in:")), 0, 0);
    layout.addWidget(w.whereCombo, 0, 0);

    w.note = new QLabel("");
    w.note.wordWrap = true;
    layout.addWidget(w.note, 0, 0);

    var row = new QHBoxLayout();
    w.buildButton = new QPushButton(qsTr("Build Sheet"));
    w.buildButton.toolTip = qsTr("Builds the sheets as tabs under the " +
        "drawing, or in new files, as chosen above.");
    row.addWidget(w.buildButton, 1, 0);
    w.pdfButton = new QPushButton(qsTr("Export PDF"));
    w.pdfButton.toolTip = qsTr("Plots each sheet you just built to a " +
        "PDF beside its DXF, at the sheet's paper size and scale.");
    row.addWidget(w.pdfButton, 0, 0);
    w.refreshButton = new QPushButton(qsTr("Re-read Drawing"));
    w.refreshButton.toolTip = qsTr("Measure the cave again -- after " +
        "another trip, or after tracing more of it.");
    row.addWidget(w.refreshButton, 0, 0);
    w.resetButton = new QPushButton(qsTr("Reset Layout"));
    w.resetButton.toolTip = qsTr("Put every piece back where the " +
        "default layout puts it.");
    w.resetButton.enabled = false;
    row.addWidget(w.resetButton, 0, 0);
    layout.addLayout(row, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "SheetSetup", qsTr("Sheet Setup"));
    SheetSetup.widgets = w;

    var changed = function() {
        if (w.quiet !== true) {
            SheetSetup.repaint();
        }
    };
    w.sheetCombo["currentIndexChanged(int)"].connect(function() {
        // The paper changed, so the scale that fits probably did too.
        SheetSetup.suggestScale();
        changed();
    });
    w.scaleCombo["currentIndexChanged(int)"].connect(changed);
    w.cbBorder.toggled.connect(changed);
    w.cbBar.toggled.connect(changed);
    w.cbNorth.toggled.connect(changed);
    w.cbTitle.toggled.connect(changed);
    w.cbElevation.toggled.connect(changed);
    w.cbTurn.toggled.connect(function() {
        // a different way up fits a different scale
        SheetSetup.suggestScale();
        changed();
    });
    w.buildButton.clicked.connect(function() { SheetSetup.build(); });
    w.pdfButton.clicked.connect(function() { SheetSetup.exportPdf(); });
    w.refreshButton.clicked.connect(function() { SheetSetup.refresh(); });
    w.resetButton.clicked.connect(function() { SheetSetup.resetLayout(); });

    return dock;
};

/** Which way up the paper is: the way the caver set it, never chosen
 *  for them. */
SheetSetup.turnedOf = function(w) {
    return w.cbTurn.checked === true;
};

/** Which furniture the panel has ticked, in the shape the layout reads. */
SheetSetup.wantsOf = function(w) {
    return { title: w.cbTitle.checked === true, bar: w.cbBar.checked === true,
        north: w.cbNorth.checked === true };
};

/** The paper's most detailed standard scale, chosen for the caver. */
SheetSetup.suggestScale = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, SheetSetup.wantsOf(w)),
        SheetSetup.turnedOf(w));
    var at = CsSheetSetup.SCALES.indexOf(fit.scale);
    var was = w.quiet;
    w.quiet = true;
    w.scaleCombo.currentIndex = at < 0 ? 0 : at;
    w.quiet = was;
};

/**
 * Fit the page into the pane once the layout has settled.
 *
 * WHY A TIMER. The panel draws its first page while the dock is still
 * being laid out: an autoZoom there fits to a size the view is about to
 * stop having, and the sheet ends up a postage stamp in the middle of
 * an empty pane (measured live, 2026-09-14). A zero-interval timer runs
 * after Qt has finished laying the dock out, which is the first moment
 * the view's real size exists.
 *
 * The timer is kept on SheetSetup rather than in a local: one held only
 * by a local goes out of scope before it fires. Only a plain JS call
 * lives in the closure -- a Qt wrapper held across that boundary is one
 * of this bridge's crash modes.
 */
SheetSetup.fitLater = function() {
    try {
        var timer = new QTimer();
        timer.singleShot = true;
        timer.timeout.connect(function() {
            SheetSetup.fitNow();
        });
        SheetSetup.fitTimer = timer;
        timer.start(0);
    } catch (e) {
        // no timer here: the view keeps whatever zoom autoZoom gave it
        SheetSetup.fitNow();
    }
};

/** Fit the page into the pane now. */
SheetSetup.fitNow = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.pane) || w.pane === undefined) {
        return;
    }
    try {
        CsSheetPreview.fit(w.pane);
        w.pane.view.fitPending = false;
    } catch (e) {
    }
};

/** Reads the drawing again and repaints. */
SheetSetup.refresh = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    w.state = SheetSetup.readState(doc);
    w.quiet = true;
    try {
        w.cbElevation.enabled = w.state.hasElevation === true;
        w.cbElevation.checked = w.state.hasElevation === true;
    } finally {
        w.quiet = false;
    }
    SheetSetup.suggestScale();
    SheetSetup.repaint();
    SheetSetup.fitLater();
};

/** Redraws the picture and the words under it. */
SheetSetup.repaint = function() {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state)) {
        return;
    }
    if (w.state.ok !== true) {
        w.fitLabel.text = w.state.why;
        w.note.setStyleSheet("");
        w.note.text = "";
        w.buildButton.enabled = false;
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var picked = SheetSetup.wantsOf(w);
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, picked), SheetSetup.turnedOf(w));

    // THE CAVE OVERFLOWS ONE SHEET at this scale: lay it over a grid.
    var tiles = SheetSetup.tileLayoutFor(w.state, sheet, scale, w.offsets,
        picked, SheetSetup.turnedOf(w));
    w.tiles = tiles;
    if (tiles !== null && tiles.tooMany === true) {
        // not previewed, not buildable: say what to do instead
        w.fitLabel.text = SheetSetup.tooManyText(w.state, scale, tiles);
        w.note.setStyleSheet("color:" + SheetSetup.LEVELS[SheetSetup.WARNING].colour + ";");
        w.note.text = "";
        w.buildButton.enabled = false;
        return;
    }
    var preview = CsSheetSetup.preview({
        caveBox: w.state.caveBox, sheet: sheet, scale: scale,
        tileLayout: tiles,
        turned: fit.turned, footerInches: w.state.footerInches,
        titleHeight: w.state.titleHeight,
        declinationDate: w.state.declinationDate,
        wants: { border: w.cbBorder.checked, bar: w.cbBar.checked,
            north: w.cbNorth.checked, title: w.cbTitle.checked },
        elevation: w.cbElevation.checked === true,
        bands: w.state.bands,
        chunked: w.state.chunked === true,
        offsets: w.offsets,
        declination: w.state.declination
    });
    w.preview_data = preview;
    if (w.pane !== null && w.pane !== undefined) {
        // WHAT PAGE THIS IS. The view re-fits when this string changes
        // and not otherwise: a re-fit on every repaint would make a
        // drag chase its own tail, zooming out from under the cursor
        // as the piece it grabbed moved the bounds.
        // The sheet ARRANGEMENT is part of the page -- more sheets want
        // a wider view -- but not WHILE a sheet is held: a neighbour
        // appearing mid-drag must not zoom the view out from under the
        // hand that is moving it. The view settles when the sheet is let go.
        var arrangement = (tiles === null || tiles.tiled !== true) ? "one" : (tiles.rows + "x" +
            tiles.cols + "x" + tiles.tiles.length);
        if (!isNull(w.dragKind) && !isNull(w.lastArrangement)) {
            arrangement = w.lastArrangement;
        }
        w.lastArrangement = arrangement;
        var pageKey = [String(w.sheetCombo.currentText), scale,
            fit.turned, w.cbElevation.checked === true,
            w.state.recordPath, arrangement].join("|");
        CsSheetPreview.show(w.pane, preview, { scale: scale,
            guideX: w.guideX, guideY: w.guideY,
            centredX: w.centredX === true, centredY: w.centredY === true,
            pageKey: pageKey });
    } else {
        // The fallback picture, for a build that refused the view.
        // Painted at the size the label ACTUALLY has, not a fixed 150.
        var previewH = 150;
        try {
            previewH = Math.max(120, Math.min(520, w.preview.height - 4));
        } catch (eH) {
            previewH = 150;
        }
        var pixmap = SheetSetup.paintPreview(preview,
            Math.max(200, w.preview.width - 8), previewH);
        if (pixmap !== null) {
            w.preview.pixmap = pixmap;
        }
    }
    try {
        w.resetButton.enabled = CsSheetSetup.anyMoved(w.offsets);
    } catch (eReset) {
    }

    var spill = CsSheetSetup.previewFits(preview);
    w.fitLabel.text = qsTr("The plan measures %1 x %2 ft.")
        .arg(Math.round(w.state.caveW)).arg(Math.round(w.state.caveH)) +
        "  " + (fit.fits ?
            qsTr("Fits at 1\" = %1 ft").arg(fit.scale) +
                (fit.turned ? qsTr(", paper turned.") : ".") :
            qsTr("It does not fit this paper at any standard scale."));
    // THE SPILL IS THE POINT OF THE PICTURE. Everything else the panel
    // says could be worked out; this is the one thing a caver would
    // otherwise learn by building the file and looking at it.
    // Off the paper is a WARNING -- the build would still run, but the
    // plot would lose part of the cave. Fitting is plain status.
    w.note.setStyleSheet(spill.fits ? "" :
        "color:" + SheetSetup.LEVELS[SheetSetup.WARNING].colour + ";");
    w.note.text = spill.fits ?
        qsTr("Everything sits on the paper.") :
        qsTr("Off the paper: %1. Try a smaller scale or bigger paper.")
            .arg(spill.spilling.join(", "));
    if (tiles !== null && tiles.tiled === true) {
        // MORE THAN ONE SHEET IS NOT A PROBLEM, it is the answer: say
        // what will be built, and what the sheets are called.
        w.fitLabel.text = qsTr("The plan measures %1 x %2 ft: too big " +
            "for one sheet at 1\" = %3 ft.")
            .arg(Math.round(w.state.caveW)).arg(Math.round(w.state.caveH))
            .arg(scale) + "  " + qsTr("It tiles over a %1.")
            .arg(CsSheetTile.describe(tiles));
        w.note.text = qsTr("Drag the blue viewport: sheets appear " +
            "beside the first wherever the cave runs past a margin and " +
            "go again when it does not. Each carries a match line and " +
            "the name of the sheet that continues it, and repeats %1 in " +
            "of its neighbour past the line.").arg(CsSheetTile.OVERLAP_INCHES) +
            (spill.fits ? "" : "  " + qsTr("Off the grid: %1.")
                .arg(spill.spilling.join(", ")));
    }
    // Sheets are layouts of THIS drawing: nothing is written beside it, so
    // an unsaved drawing builds sheets as well as a saved one does.
    w.buildButton.enabled = true;
    w.buildButton.text = (tiles !== null && tiles.tiled === true) ?
        qsTr("Build %1 Sheets").arg(tiles.tiles.length) : qsTr("Build Sheet");
    w.buildButton.toolTip = qsTr("Makes (or rewrites) the sheets as layouts " +
        "of this drawing. A sheet you have changed by hand is left alone.");
};

/**
 * The DEFAULT SHEET: what the empty "Layout" tab becomes when it is first
 * opened in a cave drawing -- the panel's own defaults (Letter, the most
 * detailed scale that fits, every piece of furniture), built by the same
 * generator, so Sheet Setup later rewrites it like any other automatic sheet.
 *
 * \return the new sheet's name, or "" when there is nothing to show yet
 */
SheetSetup.starter = function(doc, di) {
    var state = SheetSetup.readState(doc);
    if (isNull(state) || state.ok !== true || CsLayoutGen.pristine(doc) === undefined) {
        return "";
    }
    var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
    var wants = { title: true, bar: true, north: true };
    var fit = CsSheetSetup.fit(state.caveW, state.caveH, sheet,
        SheetSetup.footerFn(state, sheet, wants), false);
    var scale = fit.fits ? fit.scale : CsSheetSetup.SCALES[CsSheetSetup.SCALES.length - 1];
    var tiles = SheetSetup.tileLayoutFor(state, sheet, scale, {}, wants, fit.turned);
    if (tiles === null || tiles.tiled === true) {
        return "";     // a cave that needs several sheets is Sheet Setup's job
    }
    var res = CsLayoutGen.generate(doc, di, {
        caveBox: state.caveBox, elevBox: null, sheet: sheet, turned: fit.turned,
        scale: scale, perFoot: CsShapeLine.perFoot(doc),
        wants: { border: true, bar: true, north: true, title: true },
        titleValues: SheetSetup.titleValues(doc, state.filled),
        reading: CsSheetSetup.latestDeclination(state.survey),
        tiles: tiles, elevation: false, shiftInches: { x: 0, y: 0 },
        extra: { offsets: {}, titleValues: SheetSetup.titleValues(doc, state.filled), filled: state.filled } });
    return res.made.length > 0 ? res.made[0] : "";
};

if (typeof Layouts !== "undefined") {
    Layouts.starterOf = function(doc, di) { return SheetSetup.starter(doc, di); };
}

/** The panel's words when the scale asks for more sheets than a cave ever needs. */
SheetSetup.tooManyText = function(state, scale, tiles) {
    return qsTr("The plan measures %1 x %2 ft: at 1\" = %3 ft that is %4 sheets. Pick a smaller scale (a larger number of feet per inch).")
        .arg(Math.round(state.caveW)).arg(Math.round(state.caveH)).arg(scale)
        .arg(tiles.count > CsSheetTile.MAX_SHEETS * 6 ? qsTr("hundreds of") : tiles.count);
};

/** Builds the file. */
SheetSetup.build = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    // layouts are rewritten here; not while one of them is being edited through
    if (CsModelSpace.inViewport()) {
        CsTell.warn(CsModelSpace.viewportRefusal("Sheet Setup"));
        return;
    }
    // A PANEL NOBODY HAS READ YET. The dock is built hidden at startup
    // and restoreState() can put it on screen without the menu entry
    // ever running, so its first press can arrive with no state at all.
    // Read the drawing now rather than ignore the press.
    if (isNull(w.state)) {
        SheetSetup.refresh();
    }
    if (isNull(w.state) || w.state.ok !== true) {
        SheetSetup.tell(isNull(w.state) || isNull(w.state.why) ?
            qsTr("Sheet Setup could not read this drawing.") :
            String(w.state.why), SheetSetup.WARNING);
        return;
    }
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc) || isNull(di)) {
        SheetSetup.tell(qsTr("Sheet Setup needs a drawing open."), SheetSetup.WARNING);
        return;
    }
    var sheet = CsSheetSetup.sheetByName(String(w.sheetCombo.currentText));
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    var wants = { border: w.cbBorder.checked, bar: w.cbBar.checked,
        north: w.cbNorth.checked, title: w.cbTitle.checked };
    var fit = CsSheetSetup.fit(w.state.caveW, w.state.caveH, sheet,
        SheetSetup.footerFn(w.state, sheet, SheetSetup.wantsOf(w)),
        SheetSetup.turnedOf(w));
    var tiles = SheetSetup.tileLayoutFor(w.state, sheet, scale, w.offsets,
        SheetSetup.wantsOf(w), SheetSetup.turnedOf(w));
    if (tiles !== null && tiles.tooMany === true) {
        SheetSetup.tell(SheetSetup.tooManyText(w.state, scale, tiles), SheetSetup.WARNING);
        return;
    }
    var turned = tiles !== null ? tiles.turned : fit.turned;
    var perFoot = CsShapeLine.perFoot(doc);

    var elevBox = null;
    if (w.cbElevation.checked === true && w.state.hasElevation) {
        elevBox = SheetSetup.frameBox(doc, "profile");
    }
    var caveDrag = CsSheetSetup.offsetOf(w.offsets, "cave");
    var res;
    try {
        res = CsLayoutGen.generate(doc, di, {
            caveBox: w.state.caveBox, elevBox: elevBox, sheet: sheet, turned: turned,
            scale: scale, perFoot: perFoot, wants: wants,
            titleValues: SheetSetup.titleValues(doc, w.state.filled),
            reading: CsSheetSetup.latestDeclination(w.state.survey),
            tiles: tiles, elevation: elevBox !== null,
            shiftInches: { x: -caveDrag.x, y: -caveDrag.y },
            extra: { offsets: w.offsets,
                titleValues: SheetSetup.titleValues(doc, w.state.filled), filled: w.state.filled } });
    } catch (eGen) {
        SheetSetup.tell(qsTr("Sheet Setup: building the sheets failed (") + eGen + ").",
            SheetSetup.ERROR);
        return;
    }
    var words = [];
    if (res.made.length > 0) {
        words.push(qsTr("made ") + res.made.join(", "));
    }
    if (res.rewritten.length > 0) {
        words.push(qsTr("rewrote ") + res.rewritten.join(", "));
    }
    var said = qsTr("Sheet Setup: ") + words.join("; ") + qsTr(", at 1\" = ") + scale +
        qsTr(" ft on ") + sheet.name + ".";
    var attention = false;
    if (res.skipped.length > 0) {
        said += " " + qsTr("Left alone because they were edited or made by hand: ") +
            res.skipped.join(", ") + qsTr(". Right-click a sheet's tab, Revert to automatic, to have it rebuilt.");
        attention = true;
    }
    if (res.made.length + res.rewritten.length === 0) {
        attention = true;
    }
    if (w.state.chunked === true && elevBox !== null) {
        said += " " + qsTr("A chunked elevation is shown as drawn; its arrangement offsets are not part of sheets yet.");
    }
    var where = w.whereCombo.currentIndex;
    if (where !== CsLayoutGen.WHERE_THIS && res.made.length + res.rewritten.length > 0) {
        var back = SheetSetup.deliver(doc, di, res, where);
        if (back !== "") {
            said += " " + back;
        }
        SheetSetup.tell(said, SheetSetup.DONE);
        return;
    }
    // show the first sheet that was written
    var first = res.made.length > 0 ? res.made[0] : (res.rewritten.length > 0 ? res.rewritten[0] : "");
    if (first !== "") {
        try {
            Layouts.activate(di, first);
        } catch (eAct) {
        }
    }
    SheetSetup.tell(said, attention ? SheetSetup.WARNING : SheetSetup.DONE);
};

/**
 * Writes the sheets into new files (see CsLayoutGen.writeCopies), then takes
 * the layouts this build made back out of the open drawing.
 *
 * \return a sentence for the panel
 */
SheetSetup.deliver = function(doc, di, res, where) {
    var names = [];
    var all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        names.push(all[i].name);
    }
    var here = "";
    try {
        here = String(doc.getFileName());
    } catch (eName) {
        here = "";
    }
    var folder = CsCave.folderOf(here);
    var caveName = CsCave.nameOf(here);
    var base = "";
    if (folder !== null && caveName !== null) {
        var dest = folder + "/Sheets";
        try {
            (new QDir("/")).mkpath(dest);
        } catch (eDir) {
        }
        base = dest + "/" + caveName;
    } else {
        var picked = CsFiles.saveFile(getMainWindow(), qsTr("Save the sheets as"),
            QDir.homePath() + "/Sheets.dxf", "DXF (*.dxf)");
        if (picked === "") {
            return qsTr("Nothing was written: no file was chosen, so the sheets stay in this file.");
        }
        base = picked.replace(/\.dxf$/i, "");
    }
    var back = CsLayoutGen.writeCopies(di, CsLayoutGen.jobsFor(where, names, base));
    if (back.ok !== true) {
        SheetSetup.tell(qsTr("Sheet Setup: ") + back.error + qsTr(" The sheets stay in this file."), SheetSetup.ERROR);
        return qsTr("The sheets stay in this file.");
    }
    // leave this drawing as it was
    for (var m = 0; m < res.made.length; m++) {
        Layouts.remove(di, res.made[m]);
    }
    if (where === CsLayoutGen.WHERE_ONE) {
        try {
            openFiles([back.paths[0]], false);
        } catch (eOpen) {
        }
        return qsTr("Wrote ") + CsShelf.basename(back.paths[0]) + ".";
    }
    return qsTr("Wrote ") + back.paths.length + qsTr(" files to ") + CsShelf.basename(base.replace(/\/[^\/]*$/, "")) + qsTr("/.");
};

/**
 * Say something the caver will actually see: on the panel's own note
 * line, coloured by level, and on the command line in the same colour.
 * A warning or an error also comes up in a box, because a note under a
 * preview is easy to miss when the thing you expected was a new tab.
 *
 * Never warning(): that is qWarning, which only reaches stderr.
 *
 * \param level SheetSetup.DONE, WARNING or ERROR -- see LEVELS.
 */
SheetSetup.tell = function(text, level) {
    text = String(text);
    var look = SheetSetup.LEVELS[level] || SheetSetup.LEVELS[SheetSetup.DONE];
    try {
        var w = SheetSetup.widgets;
        if (!isNull(w) && !isNull(w.note)) {
            w.note.text = text;
            w.note.setStyleSheet("color:" + look.colour + ";");
        }
    } catch (eNote) {
    }
    try {
        // Unescaped so the span colours it, which means the text has to
        // be escaped here instead. Not handleUserWarning: that is always
        // red, and a warning is not a failure.
        EAction.handleUserMessage("<span style='color:" + look.colour +
            ";'>" + SheetSetup.escapeHtml(text) + "</span>", false);
    } catch (eLine) {
    }
    if (look.box === true) {
        try {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Sheet Setup"), text);
        } catch (eBox) {
        }
    }
};

/**
 * A piece being dragged, reported in DRAWING units and snapped.
 *
 * The move is turned into INCHES of paper and added to what the piece
 * already carries, and the panel redraws from that -- so the picture a
 * caver is dragging IS the layout that will be built, not a rubber band
 * over an unchanged one.
 */
SheetSetup.dragTo = function(kind, snapped) {
    var w = SheetSetup.widgets;
    if (isNull(w) || isNull(w.state) || w.state.ok !== true) {
        return;
    }
    var scale = CsSheetSetup.SCALES[w.scaleCombo.currentIndex];
    if (!(scale > 0)) {
        return;
    }
    // A FRAME THAT DRAWS THE SAME PICTURE IS DROPPED HERE. While a
    // piece is held on a snap guide the mouse keeps moving and the
    // piece does not, so every one of those moves used to rebuild the
    // preview for nothing -- see CsSheetSetup.dragKey.
    var key = CsSheetSetup.dragKey(kind, snapped);
    if (key !== null && key === w.dragFrame) {
        return;
    }
    w.dragFrame = key;
    // FROM WHERE THE DRAG BEGAN, not from the last frame: the view
    // reports the whole move each time, measured against the box it
    // grabbed, so adding each frame to the last would move the piece
    // twice as far as the mouse.
    var stored = kind;
    var sign = 1;
    if (isNull(w.dragFrom) || w.dragKind !== kind) {
        w.dragKind = kind;
        w.dragFrom = CsSheetSetup.offsetOf(w.offsets, stored);
    }
    var moved = {};
    var k;
    for (k in w.offsets) {
        if (w.offsets.hasOwnProperty(k)) {
            moved[k] = CsSheetSetup.offsetOf(w.offsets, k);
        }
    }
    moved[stored] = { x: w.dragFrom.x + sign * snapped.dx / scale,
                      y: w.dragFrom.y + sign * snapped.dy / scale };
    w.offsets = moved;
    w.guideX = snapped.guideX;
    w.guideY = snapped.guideY;
    w.centredX = snapped.centredX === true;
    w.centredY = snapped.centredY === true;
    SheetSetup.repaint();
    // SAY IT OUT LOUD. A piece sitting a hair off centre looks exactly
    // like one on it, and the guide line alone does not say WHICH kind
    // of line it is to a caver who has not read the handbook.
    try {
        var say = SheetSetup.HINT;
        if (w.centredX && w.centredY) {
            say = qsTr("Centred both ways.");
        } else if (w.centredX) {
            say = qsTr("Centred left to right.");
        } else if (w.centredY) {
            say = qsTr("Centred top to bottom.");
        }
        // ONLY WHEN IT CHANGES. The hint is a word-wrapped label, so a
        // new string of a different length relays out the whole dock --
        // and a relayout resizes the view under the cursor mid-drag.
        if (String(w.hint.text) !== String(say)) {
            w.hint.text = say;
        }
    } catch (eHint) {
    }
};

/** The drag is over: the guides go, the offset stays. */
SheetSetup.dragDone = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    w.dragKind = null;
    w.dragFrom = null;
    w.dragFrame = null;
    w.guideX = null;
    w.guideY = null;
    w.centredX = false;
    w.centredY = false;
    try {
        w.hint.text = SheetSetup.HINT;
    } catch (eHint) {
    }
    SheetSetup.repaint();
};

/** Every piece back where the default layout puts it. */
SheetSetup.resetLayout = function() {
    var w = SheetSetup.widgets;
    if (isNull(w)) {
        return;
    }
    w.offsets = {};
    w.dragKind = null;
    w.dragFrom = null;
    w.guideX = null;
    w.guideY = null;
    w.centredX = false;
    w.centredY = false;
    try {
        w.hint.text = SheetSetup.HINT;
    } catch (eHint) {
    }
    SheetSetup.repaint();
};

SheetSetup.ensureDock = function() {
    if (csSheetSetupDock !== undefined && csSheetSetupDock !== null) {
        return csSheetSetupDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csSheetSetupDock = SheetSetup.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csSheetSetupDock);
    return csSheetSetupDock;
};

/**
 * Plots the cave's sheets (its layouts) to ONE PDF, a page per sheet in tab
 * order, in the cave's PDF folder beside the drawing -- or wherever a drawing
 * with no file yet is told to put it.
 *
 * Goes through the engine's own printing (LayoutPlot, which reuses
 * Print.js), so what comes out is what the sheet shows: viewports clipped
 * and scaled by the engine, nothing cut or masked here.
 */
SheetSetup.exportPdf = function() {
    if (CsModelSpace.inViewport()) {
        CsTell.warn(CsModelSpace.viewportRefusal("Sheet Setup"));
        return;
    }
    var doc = null, di = null;
    try {
        doc = EAction.getDocument();
        di = EAction.getDocumentInterface();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var sheets = Layouts.list(doc);
    if (sheets.length === 0) {
        SheetSetup.tell(qsTr("Nothing to plot yet. Build Sheet first."), SheetSetup.WARNING);
        return;
    }
    // ONE PDF, a page per sheet in tab order, beside the cave's other PDFs;
    // a drawing with no file yet asks where.
    var path = "";
    var here = "";
    try {
        here = String(doc.getFileName());
    } catch (eName) {
        here = "";
    }
    var folder = CsCave.pdfDir(here);
    var caveName = CsCave.nameOf(here);
    if (folder !== null && caveName !== null) {
        try {
            (new QDir("/")).mkpath(folder);
        } catch (eDir) {
        }
        path = folder + "/" + caveName + " Sheets.pdf";
    } else {
        path = CsFiles.saveFile(getMainWindow(), qsTr("Export sheets to PDF"),
            QDir.homePath() + "/Sheets.pdf", "PDF (*.pdf)");
        if (path === "") {
            return;
        }
    }
    var names = [];
    for (var i = 0; i < sheets.length; i++) {
        names.push(sheets[i].name);
    }
    var back = LayoutPlot.exportPdf(di, names, path);
    if (back.ok !== true) {
        SheetSetup.tell(qsTr("PDF export failed -- ") + back.error, SheetSetup.ERROR);
        return;
    }
    try {
        QDesktopServices.openUrl(QUrl.fromLocalFile(path));
    } catch (eOpen) {
    }
    SheetSetup.tell(qsTr("Plotted ") + CsShelf.basename(path) + " (" + back.pages +
        (back.pages === 1 ? qsTr(" page") : qsTr(" pages")) + qsTr(", one per sheet)."), SheetSetup.DONE);
};

/** The extents of one frame's own content, or null. */
SheetSetup.frameBox = function(doc, frame) {
    var box = null;
    var ids = SheetSetup.modelIds(doc);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (CsLayers.frameOf(layer) !== frame) {
            continue;
        }
        // The band BOXES describe the region rather than being drawn
        // in it, and they are exactly the outline a border should sit
        // outside of -- so they count.
        var b = null;
        try {
            b = e.getBoundingBox();
        } catch (eBox) {
            b = null;
        }
        if (isNull(b)) {
            continue;
        }
        var mn = b.getMinimum(), mx = b.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mx.x)) {
            continue;
        }
        if (box === null) {
            box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
        } else {
            box.minX = Math.min(box.minX, mn.x);
            box.minY = Math.min(box.minY, mn.y);
            box.maxX = Math.max(box.maxX, mx.x);
            box.maxY = Math.max(box.maxY, mx.y);
        }
    }
    return box;
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

SheetSetup.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var dock = SheetSetup.ensureDock();
        // Always opens and always re-reads: a caver reaching for this
        // wants to look at the layout, and toggling it shut on a second
        // press would make "show me again" a two-click gesture whose
        // first click hides the answer. Same rule as Check Map.
        dock.visible = true;
        SheetSetup.refresh();
    } catch (e) {
        // Forget the dock ONLY if it was never built. Forgetting a live
        // one because refresh() threw made the next press build a
        // second panel beside it.
        if (isNull(dock)) {
            csSheetSetupDock = undefined;
        }
        EAction.handleUserWarning("Sheet Setup: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

SheetSetup.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sheet Setup"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // THE APPLICATION'S SCRIPT ENGINE, NOT THE TAB'S. Without this QCAD
    // runs beginEvent in the active document's OWN engine, where the dock
    // globals start empty: opening the panel from a second tab built a
    // second panel, and closing that tab left one wired to a dead engine
    // -- buttons that do nothing, and Sheet Setup's preview crashing
    // CaveCAD on hover (Nathan, 2026-09-27). Stock Print Preview uses the
    // same flag. tests/test_addon.py enforces it for every panel opener.
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/SheetSetup.js");
    action.setIcon(basePath + "/SheetSetup.svg");
    action.setStatusTip(qsTr("Border, scale bar, north arrow and a " +
        "title block, all at the plot scale you choose"));
    action.setDefaultCommands(["sheetsetup", "sheet"]);
    SheetSetup.basePath = basePath;
    // FIRST in stage 5: the sheet is what the rest of this stage
    // decorates, and a legend placed before there is a sheet to place
    // it on lands in the middle of the cave.
    action.setGroupSortOrder(454);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the suite's other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = SheetSetup.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csSheetSetupDock = undefined;
        warning("Sheet Setup: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
