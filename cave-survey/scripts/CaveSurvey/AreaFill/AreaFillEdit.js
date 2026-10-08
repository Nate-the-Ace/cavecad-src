// AreaFillEdit.js -- drawing a cave-floor pattern of your own: the
// editor drawing, and saving what is in it into your OWN symbol
// library as a placeable AREA_ block.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only builds an add-on
// from <dir>/<dir>.js, so AreaFill.init() calls this file's init().
//
// THE SAME HAND AS NEW SYMBOL, deliberately (Nathan's call): a caver
// who has already drawn and saved a custom symbol should not have to
// learn a second way to draw and save a pattern. The editor is a real
// drawing tab -- lines, arcs, snapping, undo, zoom -- with an origin
// crosshair and a nominal-size reference square for scale, exactly the
// shape SymbolPaletteEdit.js already built; see that file's own header
// for why a dialog-with-a-canvas was never on the table.
//
// WHY THE LIBRARY AND NEVER THE TEMPLATE. Area Fill did not exist when
// custom symbols still lived in NSS_Cave_Template_PLAN.dxf and a
// release could replace it wholesale (see CsSymbolStore.customPath's
// own header on the symbol that cost, 2026-09-07) -- so a custom
// pattern has never had anywhere to go BUT the library, and this file
// carries none of that migration history SymbolPaletteEdit.js still
// does.
//
// WHAT IS NOT SAVED. The crosshair and the reference square are
// FURNITURE, tagged as such, and skipped when the pattern's geometry is
// collected -- see FURNITURE_TAG below, copied rather than shared with
// SymbolPaletteEdit's own constant: two editors, two small tags, no
// reason for one file to reach into the other's furniture.

include("scripts/EAction.js");
include("scripts/File/NewFile/NewFile.js");
include(includeBasePath + "/../Core/CsAll.js");

var AreaFillEdit = {};

/** Marks the editor's own scaffolding, so saving can leave it out. */
AreaFillEdit.FURNITURE_TAG = "AreaEditorFurniture";

/** The layer the furniture sits on inside the editor drawing.
 *  CTRL-HIDDEN is the suite's name for "scaffolding, not the map". */
AreaFillEdit.FURNITURE_LAYER = "CTRL-HIDDEN";

/** The side of the working square the editor draws around the origin,
 *  in FEET -- the same nominal size SymbolPaletteEdit.WORKING_FEET uses
 *  and for the same reason: a working area, not a placed size, so two
 *  patterns drawn on different days come out the same size relative to
 *  each other. */
AreaFillEdit.WORKING_FEET = 10.0;

/** How much cave is in view when the editor opens, in FEET. */
AreaFillEdit.VIEW_FEET = 20.0;

/**
 * The editing session, or null when no editor is open.
 *
 *   { di, child, block, entry }
 *
 * `block` and `entry` are non-null only when an EXISTING pattern is
 * being edited; a new pattern has no block name until it is saved.
 */
AreaFillEdit.session = null;

/** True when an editor drawing is open and current. */
AreaFillEdit.isEditing = function() {
    return AreaFillEdit.session !== null;
};

/**
 * True when the current session's editor WINDOW is still open and its
 * document reachable -- as opposed to merely non-null.
 *
 * THE GAP THIS CLOSES. A caver who closes the editor tab directly (the
 * window's own close button, not Cancel) leaves `session` pointing at a
 * destroyed Qt object -- nothing clears it, because closing a window
 * that way never runs AreaFillEdit.cancel/finish. Reading any property
 * off a deleted Qt wrapper in this build throws rather than answering
 * something stale ("wrapped is NULL", seen elsewhere in this suite
 * whenever a C++-side object outlives its JS wrapper's usefulness) --
 * so a touch that would throw on a dead window is exactly the signal
 * used here to tell "still open" from "gone" apart.
 *
 * SymbolPaletteEdit has the same gap and is left alone -- this file
 * does not reproduce it rather than fixing it there too.
 */
AreaFillEdit.sessionAlive = function() {
    var session = AreaFillEdit.session;
    if (session === null) {
        return false;
    }
    try {
        var probe = session.child.windowTitle;   // throws on a dead window
        var doc = session.di.getDocument();
        return !isNull(doc);
    } catch (eDead) {
        return false;
    }
};

/**
 * True when an open session should REFUSE a new startNew/startEdit --
 * and the only place a session left behind by a directly-closed tab
 * gets cleared. Without this, a wedged session would answer
 * isEditing() === true forever (nothing else ever nulls it), and every
 * later attempt to start a pattern would refuse with no reachable
 * Cancel to get out of it -- a permanent wedge for the rest of the
 * session. Called instead of isEditing() by every entry point that
 * would otherwise refuse.
 */
AreaFillEdit.blockedByOpenSession = function() {
    if (AreaFillEdit.session === null) {
        return false;
    }
    if (AreaFillEdit.sessionAlive()) {
        return true;
    }
    // The window is gone but the session was not: this is exactly the
    // wedge, turned into a no-op by clearing it and letting the caller
    // proceed as if nothing had been open.
    AreaFillEdit.finish();
    return false;
};

/**
 * The plan-frame registry layers a pattern may call home, sorted.
 *
 * COPIED FROM SymbolPaletteEdit.homeLayers rather than shared, the same
 * way AreaFill.wrapLabel is copied from SymbolPalette's own: both
 * editors keep their small pure helpers to themselves. See that
 * function's own header for why the registry and not free text, and why
 * plan-frame only.
 */
AreaFillEdit.homeLayers = function() {
    var sheet = {};
    var i;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        sheet[CsLayers.SHEET_LAYERS[i]] = true;
    }
    var out = [];
    for (var name in CsLayers.DEFAULTS) {
        if (!CsLayers.DEFAULTS.hasOwnProperty(name)) {
            continue;
        }
        if (sheet[name] === true) {
            continue;
        }
        if (name.indexOf("CTRL-") === 0) {
            continue;
        }
        if (CsLayers.frameOf(name) !== "plan") {
            continue;   // the twins are derived, never chosen
        }
        out.push(name);
    }
    out.sort();
    return out;
};

/**
 * Opens an editor drawing. Identical shape to
 * SymbolPaletteEdit.openEditorDocument -- see that function's own
 * header for the one-shot template-skip flag and why it is cleared
 * both on success and on failure.
 *
 * \return { di, child }, or null when no editor could be opened.
 */
AreaFillEdit.openEditorDocument = function(title) {
    try {
        RSettings.setValue("CaveSurvey/TemplateOnNewSkipOnce", true);
    } catch (eSet) {
    }
    var child = null;
    try {
        child = NewFile.createMdiChild();
    } catch (eNew) {
        child = null;
    }
    try {
        RSettings.setValue("CaveSurvey/TemplateOnNewSkipOnce", false);
    } catch (eClear) {
    }
    if (isNull(child)) {
        return null;
    }
    var di = null;
    try {
        di = child.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (isNull(di)) {
        return null;
    }
    try {
        child.windowTitle = title;
    } catch (eTitle) {
    }
    return { di: di, child: child };
};

/** Closes the editor drawing without asking to save it -- see
 *  SymbolPaletteEdit.closeEditor's own header for why nothing is asked
 *  and why this is only ever called after a successful save. */
AreaFillEdit.closeEditor = function(session) {
    if (isNull(session) || isNull(session.child)) {
        return false;
    }
    try {
        var doc = session.di.getDocument();
        if (!isNull(doc)) {
            doc.setModified(false);
        }
    } catch (eMod) {
    }
    try {
        session.child.close();
        return true;
    } catch (eClose) {
        return false;
    }
};

/** Frames the editor on the origin, exactly as
 *  SymbolPaletteEdit.frameEditor does -- see that function's own header
 *  for why zoomTo and not autoZoom. */
AreaFillEdit.frameEditor = function(di, doc, extra) {
    var perFoot = 1.0;
    try {
        perFoot = CsTrace.spacingFor(CsUnits.fromDrawingUnit(doc.getUnit(), RS));
    } catch (eUnit) {
        perFoot = 1.0;
    }
    var half = (AreaFillEdit.VIEW_FEET * perFoot) / 2;
    var minX = -half, minY = -half, maxX = half, maxY = half;
    if (!isNull(extra)) {
        try {
            var lo = extra.getMinimum(), hi = extra.getMaximum();
            if (!isNaN(lo.x) && !isNaN(hi.x) && !isNaN(lo.y) && !isNaN(hi.y)) {
                var pad = (AreaFillEdit.WORKING_FEET * perFoot) / 2;
                minX = Math.min(minX, lo.x - pad);
                minY = Math.min(minY, lo.y - pad);
                maxX = Math.max(maxX, hi.x + pad);
                maxY = Math.max(maxY, hi.y + pad);
            }
        } catch (eBox) {
        }
    }
    try {
        di.zoomTo(new RBox(new RVector(minX, minY), new RVector(maxX, maxY)));
        di.repaintViews();
        return true;
    } catch (eZoom) {
        return false;
    }
};

/** Draws the origin crosshair and the working square -- see
 *  SymbolPaletteEdit.addFurniture's own header for why CTRL-HIDDEN is
 *  switched on for good rather than put back the way withLayerOn found
 *  it. */
AreaFillEdit.addFurniture = function(doc, di) {
    try {
        CsLayers.ensure(doc, di, AreaFillEdit.FURNITURE_LAYER);
    } catch (eEnsure) {
    }
    var perFoot = 1.0;
    try {
        perFoot = CsTrace.spacingFor(CsUnits.fromDrawingUnit(doc.getUnit(), RS));
    } catch (eUnit) {
        perFoot = 1.0;
    }
    var half = (AreaFillEdit.WORKING_FEET * perFoot) / 2;
    var arm = half * 1.15;
    var pieces = [];
    try {
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(-arm, 0), new RVector(arm, 0))));
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(0, -arm), new RVector(0, arm))));
        var box = new RPolylineEntity(doc, new RPolylineData());
        box.appendVertex(new RVector(-half, -half));
        box.appendVertex(new RVector(half, -half));
        box.appendVertex(new RVector(half, half));
        box.appendVertex(new RVector(-half, half));
        box.setClosed(true);
        pieces.push(box);
    } catch (eMake) {
        return;
    }
    var layerId = null;
    try {
        layerId = doc.getLayerId(AreaFillEdit.FURNITURE_LAYER);
    } catch (eLayer) {
        layerId = null;
    }
    var op = new RAddObjectsOperation();
    for (var i = 0; i < pieces.length; i++) {
        try {
            CsTags.set(pieces[i], AreaFillEdit.FURNITURE_TAG, "1");
            if (!isNull(layerId) && layerId !== RObject.INVALID_ID) {
                pieces[i].setLayerId(layerId);
            }
            op.addObject(pieces[i], false);
        } catch (eAdd) {
        }
    }
    try {
        CsLayers.withLayerOn(doc, di, AreaFillEdit.FURNITURE_LAYER,
            function() {
                di.applyOperation(op);
            });
        var lay = doc.queryLayer(AreaFillEdit.FURNITURE_LAYER);
        if (!isNull(lay)) {
            lay.setOff(false);
            try {
                lay.setFrozen(false);
            } catch (eFrozen) {
            }
            var lop = new RModifyObjectOperation(lay);
            di.applyOperation(lop);
        }
    } catch (eApply) {
    }
};

/** Opens an empty editor for a brand new pattern. */
AreaFillEdit.startNew = function() {
    if (AreaFillEdit.blockedByOpenSession()) {
        EAction.handleUserMessage(qsTr("A pattern editor is already open. " +
            "Save or close it first."));
        return;
    }
    var opened = AreaFillEdit.openEditorDocument(qsTr("New Area Pattern"));
    if (isNull(opened)) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build would not open a " +
            "drawing to draw the pattern in.");
        return;
    }
    var di = opened.di;
    AreaFillEdit.addFurniture(di.getDocument(), di);
    AreaFillEdit.frameEditor(di, di.getDocument(), null);
    AreaFillEdit.session = { di: di, child: opened.child,
        block: null, entry: null };
    AreaFill.enterEditorMode(qsTr("Draw one element inside the %1 ft " +
        "square, fill in its name and rule below, then press Save " +
        "Pattern.").arg(AreaFillEdit.WORKING_FEET), null);
};

/**
 * Opens an editor holding an existing custom pattern's geometry.
 *
 * Only a custom pattern -- CsSymbolStore.saveAreaPattern always writes
 * to the library, and the thirteen shipped patterns have no block a
 * caver could open this way in the first place (BEDROCK/WATER/SUMP/
 * FLOWSTONE draw a hatch, not a block; the scatter ones share
 * SYM_BREAKDOWN* with the Symbol palette or point at AREA_ blocks this
 * add-on ships, neither of which carries an AreaCustom marker).
 */
AreaFillEdit.startEdit = function(entry) {
    if (isNull(entry) || entry.custom !== true) {
        EAction.handleUserMessage(qsTr("That is one of the patterns the " +
            "suite ships and cannot be edited."));
        return;
    }
    if (AreaFillEdit.blockedByOpenSession()) {
        EAction.handleUserMessage(qsTr("A pattern editor is already open. " +
            "Save or close it first."));
        return;
    }

    var libPath = CsSymbolStore.customPath();
    var blockName = entry.blocks[0];
    if (isNull(libPath) || !new QFileInfo(libPath).exists()) {
        EAction.handleUserWarning("Area Fill: " + entry.name +
            " could not be found in your symbol library.");
        return;
    }
    var srcDi = CsSymbolStore.openOffscreen(libPath);
    if (srcDi === null || isNull(srcDi.getDocument().queryBlock(blockName))) {
        EAction.handleUserWarning("Area Fill: " + entry.name +
            " could not be found in your symbol library.");
        return;
    }

    var opened = AreaFillEdit.openEditorDocument(
        qsTr("Pattern: %1").arg(entry.name));
    if (isNull(opened)) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build would not open a " +
            "drawing to edit the pattern in.");
        return;
    }
    var di = opened.di;
    var doc = di.getDocument();
    AreaFillEdit.addFurniture(doc, di);

    var entities = CsSymbolStore.geometryOf(srcDi.getDocument(), blockName);
    var op = new RAddObjectsOperation();
    var copied = 0;
    var modelId = null;
    try {
        modelId = doc.getModelSpaceBlockId();
    } catch (eModel) {
        modelId = null;
    }
    for (var i = 0; i < entities.length; i++) {
        try {
            var e = entities[i];
            CsSymbolStore.adopt(doc, e);
            if (!isNull(modelId) && modelId !== RObject.INVALID_ID) {
                e.setBlockId(modelId);
            }
            e.setLayerId(doc.getLayerId("0"));
            op.addObject(e, false);
            copied++;
        } catch (eCopy) {
        }
    }
    if (copied > 0) {
        try {
            di.applyOperation(op);
        } catch (eApply) {
        }
    }
    var extent = null;
    try {
        extent = doc.getBoundingBox();
    } catch (eExtent) {
        extent = null;
    }
    AreaFillEdit.frameEditor(di, doc, extent);

    AreaFillEdit.session = { di: di, child: opened.child,
        block: blockName, entry: entry };
    AreaFill.enterEditorMode(qsTr("Editing %1. Press Save Pattern when " +
        "you are done.").arg(entry.name), entry);
};

/**
 * Everything in the editor that is the PATTERN: model-space entities
 * that are not furniture. Identical logic to SymbolPaletteEdit.collect.
 */
AreaFillEdit.collect = function(doc) {
    var out = [];
    var ids;
    try {
        ids = doc.queryAllEntities(false, false);
    } catch (eQ) {
        return out;
    }
    var modelId = null;
    try {
        modelId = doc.getModelSpaceBlockId();
    } catch (eModel) {
        modelId = null;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = null;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eE) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, AreaFillEdit.FURNITURE_TAG) === "1") {
            continue;
        }
        if (!isNull(modelId) && modelId !== RObject.INVALID_ID) {
            try {
                if (e.getBlockId() !== modelId) {
                    continue;
                }
            } catch (eBlk) {
            }
        }
        out.push(e);
    }
    return out;
};

/**
 * Saves what an editor (or a test standing in for one) holds into the
 * caver's own symbol library.
 *
 * PURE OF THE GUI, deliberately -- this is what tests/area_fill_run.js
 * drives directly, exactly the way tests/symbol_palette_run.js drives
 * CsSymbolStore.saveBlock rather than SymbolPaletteEdit.save. The GUI
 * flow (reading the panel's fields, showing a QMessageBox on refusal)
 * is AreaFillEdit.save below; every rule that decides whether a pattern
 * is SAVEABLE lives here instead, once, so the two callers can never
 * disagree about what counts as a valid pattern.
 *
 * `meta` is {name, layer, placement, density, scaleMin, scaleMax,
 * rotate, help} -- placement is "scatter" or "tile", rotate is a
 * boolean, help is a caver's own "what is it?" line and may be "" or
 * omitted -- an empty description is a valid pattern, not a refusal.
 * `existingBlockName`, when given (an EDIT), keeps the block's name
 * fixed whatever the display name became -- renaming the block would
 * leave every already-placed instance pointing at a name that no
 * longer exists, the same reasoning SymbolPaletteEdit.save's own header
 * states for symbols.
 *
 * \return { ok, error, key, block, replaced }
 */
AreaFillEdit.savePattern = function(doc, entities, meta, existingBlockName) {
    if (isNull(meta) || isNull(meta.name) ||
            String(meta.name).trim() === "") {
        return { ok: false, error: "A pattern needs a name." };
    }
    var slug = CsSymbolStore.slugFor(meta.name);
    if (slug === null) {
        return { ok: false, error: "That name has no letters or numbers " +
            "in it, so it cannot become a pattern. Try another." };
    }
    if (!isNull(CsArea.CATALOG[slug])) {
        return { ok: false, error: "There is already a pattern called " +
            CsArea.CATALOG[slug].name + ". Give yours a different name." };
    }
    // A SLUG COLLISION BETWEEN TWO CUSTOM PATTERNS, checked only for a
    // NEW save (existingBlockName is null) -- an edit already keeps its
    // own block name fixed regardless of what the name field says, so
    // it can never step on another pattern's block this way. Two
    // display names that differ only in punctuation or case (e.g.
    // "Pop Corn" and "PopCorn") slug to the SAME key and therefore the
    // SAME block name; without this check, saveAreaPattern below would
    // see that block already exists, report replaced:true, and quietly
    // overwrite an unrelated caver's pattern with a success message
    // that reads identically to a genuine create. Same name as the
    // existing one is allowed through -- that is a caver re-saving the
    // pattern they meant to, not a collision.
    if (isNull(existingBlockName)) {
        var already = CsArea.merged()[slug];
        if (!isNull(already) && already.custom === true &&
                already.name !== String(meta.name).trim()) {
            return { ok: false, error: "There is already a pattern of " +
                "your own called " + already.name + " that this name " +
                "would collide with (both become " +
                CsSymbolStore.AREA_PREFIX + slug + "). Give yours a " +
                "different name, or use Edit on " + already.name +
                " if that is the one you meant to change." };
        }
    }
    if (isNull(meta.layer) || meta.layer === "") {
        return { ok: false, error: "A pattern needs a home layer." };
    }
    if (isNull(entities) || entities.length === 0) {
        return { ok: false, error: "There is nothing to save: draw the " +
            "pattern first. (The crosshair and the square are guides, " +
            "not geometry.)" };
    }

    var blockName = isNull(existingBlockName) ?
        (CsSymbolStore.AREA_PREFIX + slug) : existingBlockName;

    var scaleMin = parseFloat(meta.scaleMin);
    var scaleMax = parseFloat(meta.scaleMax);
    if (isNaN(scaleMin) || scaleMin <= 0) {
        scaleMin = 0.8;
    }
    if (isNaN(scaleMax) || scaleMax < scaleMin) {
        scaleMax = scaleMin;
    }
    var density = parseFloat(meta.density);
    if (isNaN(density) || density <= 0) {
        density = 1.0;
    }
    var saveMeta = {
        name: String(meta.name).trim(),
        layer: meta.layer,
        placement: meta.placement === "tile" ? "tile" : "scatter",
        density: density,
        scaleMin: scaleMin,
        scaleMax: scaleMax,
        rotate: meta.rotate === true,
        // "" for a caver who left the description blank -- a pattern
        // with no "what is it?" line is still a saveable pattern, just
        // one whose tooltip has less to say (see AreaFill.tileFor).
        help: isNull(meta.help) ? "" : String(meta.help).trim()
    };

    var res = CsSymbolStore.saveAreaPattern(null, blockName, doc, entities,
        saveMeta);
    if (!res.ok) {
        return { ok: false, error: res.error };
    }

    // THE TILE CACHE (Task 10). Its mtime+size stamp usually catches a
    // rewritten block on its own, but a save landing in the same second
    // as a read can slip through -- invalidated here as well as inside
    // CsSymbolStore.saveAreaPattern's own write, so the palette shows
    // the new pattern's picture without a restart whichever caller
    // reads it next.
    try {
        CsTileArt.invalidateBlockShapes();
    } catch (eTile) {
    }

    return { ok: true, error: "", key: slug, block: blockName,
        replaced: res.replaced };
};

/**
 * Reads the editor's own fields into the {name, layer, placement,
 * density, scaleMin, scaleMax, rotate, help} shape savePattern expects,
 * or null when the panel is not built (headless) -- the GUI half of the
 * save flow, kept separate from savePattern so a test can hand in a
 * meta object directly without a panel in front of it.
 */
AreaFillEdit.readFields = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.patternNameEdit)) {
        return null;
    }
    var name = "";
    var layer = "";
    var placement = "scatter";
    var density = 1.0, scaleMin = 0.8, scaleMax = 1.2, rotate = true;
    var help = "";
    try {
        name = String(w.patternNameEdit.text).trim();
    } catch (eName) {
    }
    try {
        layer = String(w.patternLayerCombo.currentText);
    } catch (eLayer) {
    }
    try {
        placement = String(w.patternPlacementCombo.currentText)
            .toLowerCase().indexOf("tile") === 0 ? "tile" : "scatter";
    } catch (ePlace) {
    }
    try {
        density = w.patternDensityBox.value;
    } catch (eDensity) {
    }
    try {
        scaleMin = w.patternScaleMinBox.value;
    } catch (eMin) {
    }
    try {
        scaleMax = w.patternScaleMaxBox.value;
    } catch (eMax) {
    }
    try {
        rotate = String(w.patternRotateCombo.currentText)
            .toLowerCase().indexOf("random") === 0;
    } catch (eRotate) {
    }
    try {
        help = String(w.patternHelpEdit.text).trim();
    } catch (eHelp) {
    }
    return { name: name, layer: layer, placement: placement,
        density: density, scaleMin: scaleMin, scaleMax: scaleMax,
        rotate: rotate, help: help };
};

/**
 * Saves what the editor holds, from the GUI: reads the panel's fields,
 * calls savePattern, and either closes the editor (success) or shows
 * why not (a QMessageBox, same as SymbolPaletteEdit.save).
 */
AreaFillEdit.save = function() {
    var session = AreaFillEdit.session;
    if (session === null) {
        return;
    }
    var di = session.di;
    if (isNull(di)) {
        AreaFillEdit.finish();
        return;
    }
    var doc = null;
    try {
        doc = di.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Pattern"),
            qsTr("The pattern editor's drawing has been closed, so there " +
                "is nothing to save."));
        AreaFillEdit.finish();
        return;
    }

    var entities = AreaFillEdit.collect(doc);
    var meta = AreaFillEdit.readFields();
    if (meta === null) {
        return;
    }

    var res = AreaFillEdit.savePattern(doc, entities, meta, session.block);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Pattern"), res.error);
        return;
    }

    var closed = AreaFillEdit.closeEditor(session);
    AreaFillEdit.finish();
    EAction.handleUserMessage(closed ?
        qsTr("%1 saved to your symbol library as %2.")
            .arg(meta.name).arg(res.block) :
        qsTr("%1 saved to your symbol library as %2. The editor drawing " +
            "could not be closed -- close it yourself; nothing in it is " +
            "needed any more.").arg(meta.name).arg(res.block));

    try {
        AreaFill.rebuildTiles();
        AreaFill.arm(res.key);
    } catch (eRefresh) {
    }
};

/** Abandons the editing session -- see SymbolPaletteEdit.cancel's own
 *  header for why the drawing is left open and modified. */
AreaFillEdit.cancel = function() {
    AreaFillEdit.finish();
};

/** Ends the session and puts the panel back into placing mode. */
AreaFillEdit.finish = function() {
    AreaFillEdit.session = null;
    try {
        AreaFill.leaveEditorMode();
    } catch (e) {
    }
};

AreaFillEdit.init = function(basePath) {
    // No widget names, no sort order, no icon -- reached only from the
    // Areas panel, never from a menu. Same reasoning (and the same
    // "action" naming trap test_sort_orders_are_unique reads for) as
    // SymbolPaletteEdit.init.
    var editAction = new RGuiAction(qsTr("Edit Area Pattern"),
        RMainWindowQt.getMainWindow());
    editAction.setRequiresDocument(false);
    editAction.setScriptFile(basePath + "/AreaFillEdit.js");
};
