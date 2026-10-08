// SymbolPaletteEdit.js -- drawing a symbol of your own: the editor
// drawing, and saving what is in it back into the cave template.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only builds an add-on
// from <dir>/<dir>.js, so SymbolPalette.init() calls this file's init().
//
// THE EDITOR IS A REAL DRAWING TAB, not a dialog with a canvas in it.
// A caver drawing a symbol wants the tools they already know -- lines,
// arcs, snapping, undo, zoom -- and every one of those is a CaveCAD
// action that needs a document to act on. So the editor is a document:
// an ordinary empty tab, opened centred on its origin with ten feet of
// cave in the middle of the view, and the only unusual thing about it
// is that Save Symbol writes what it holds into the template instead of
// to a file.
//
// WHAT IS NOT SAVED. The crosshair and the ten-foot working square are
// FURNITURE, tagged as such (FURNITURE_TAG), and skipped when the
// symbol is collected. A caver who deletes them still gets a symbol; a
// caver who leaves them does not get a symbol with a target drawn on
// it.

include("scripts/EAction.js");
include("scripts/File/NewFile/NewFile.js");
include(includeBasePath + "/../Core/CsAll.js");

var SymbolPaletteEdit = {};

/** Marks the editor's own scaffolding, so saving can leave it out. */
SymbolPaletteEdit.FURNITURE_TAG = "SymbolEditorFurniture";

/** The layer the furniture sits on inside the editor drawing.
 *  CTRL-HIDDEN is the suite's name for "scaffolding, not the map". */
SymbolPaletteEdit.FURNITURE_LAYER = "CTRL-HIDDEN";

/**
 * The side of the working square the editor draws around the origin,
 * in FEET -- and the biggest a symbol is ever meant to be drawn.
 *
 * TEN FEET, Nathan's call (2026-09-06): "symbol features will never be
 * larger, and if they are we scale it later". Drawn size is not the
 * placed size any more -- the palette's Size field decides that -- so
 * this is a working area rather than a limit, and nothing enforces it.
 * What it does is give the caver a square to draw inside, at the scale
 * of the grid, so two symbols drawn on different days come out the same
 * size relative to each other.
 */
SymbolPaletteEdit.WORKING_FEET = 10.0;

/** How much cave is in view when the editor opens, in FEET: the
 *  working square plus a margin either side, so the first grid lines
 *  beyond it are visible and the square reads as a square rather than
 *  as the edge of the world. */
SymbolPaletteEdit.VIEW_FEET = 20.0;

/**
 * The editing session, or null when no editor is open.
 *
 *   { di, block, meta, editing }
 *
 * `block` and `meta` are non-null only when an EXISTING symbol is being
 * edited; a new symbol has no name until it is saved. `di` is the
 * editor document's interface, and is what saveFromEditor checks the
 * current document against -- a caver who wanders back to their cave
 * map and presses Save Symbol must not have the map's contents written
 * into the template.
 */
SymbolPaletteEdit.session = null;

/** True when an editor drawing is open and current. */
SymbolPaletteEdit.isEditing = function() {
    return SymbolPaletteEdit.session !== null;
};

/**
 * The plan-frame registry layers a symbol may call home, sorted.
 *
 * FROM THE REGISTRY AND NOT FREE TEXT (Nathan's call, 2026-09-06): a
 * hand-typed layer is outside CsLayers.DEFAULTS, which means CsRestyle
 * cannot style it, twinFor gives it no profile or section counterpart,
 * and the template/registry agreement test does not know it exists. A
 * symbol bound to a real registry layer inherits all three for free.
 *
 * Sheet layers and CTRL- layers are excluded: a symbol lives in the
 * cave's linework, not in the sheet furniture or the survey mechanics.
 *
 * Pure.
 */
SymbolPaletteEdit.homeLayers = function() {
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
 * Opens an editor drawing.
 *
 * The one-shot setting suppresses CaveTemplateApply: every File > New
 * in this build pours the whole NSS cave template into the new
 * document, and a symbol editor that opens as a cave map with a title
 * block is not an editor.
 *
 * \return { di, child } -- the child is kept because SAVING CLOSES THE
 *         EDITOR, and closing needs the window, not the document.
 *         Null when no editor could be opened.
 */
SymbolPaletteEdit.openEditorDocument = function(title) {
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
    // ALWAYS CLEARED, not only on failure. The flag lives in QSettings,
    // so it outlives the application: set it, have CaveCAD die before
    // the File > New that consumes it, and the caver's NEXT new drawing
    // comes up empty instead of as a cave map. initNewFile has already
    // consumed it by the time createMdiChild returns, so clearing here
    // costs nothing and closes the window in which it can leak. (Seen
    // for real: a headless template-pour test failed once because a
    // stray flag was sitting in settings from an interrupted session.)
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
        // The tab's name says what it is. It has no file name, so Save
        // in this tab asks where to put a DXF -- which is a real thing
        // a caver might want (a symbol kept as a file) and is not how
        // the symbol reaches the palette.
        child.windowTitle = title;
    } catch (eTitle) {
    }
    return { di: di, child: child };
};

/**
 * Closes the editor drawing without asking to save it.
 *
 * WHY IT ASKS NOTHING. The editor is a means, not a document: its
 * contents have just been written into the cave template, which is
 * where a symbol lives. A "save changes to Untitled?" box at that
 * moment asks the caver to make a decision about a file they never
 * meant to have, right after they already saved the only thing they
 * cared about -- and answering it wrongly leaves a stray DXF of one
 * symbol somewhere. So the document is marked unmodified first and the
 * window is closed under it.
 *
 * ONLY EVER AFTER A SUCCESSFUL SAVE. Cancel leaves the drawing open and
 * modified, because then nothing has been kept anywhere and the caver's
 * work is only in that window.
 */
SymbolPaletteEdit.closeEditor = function(session) {
    if (isNull(session) || isNull(session.child)) {
        return false;
    }
    try {
        var doc = session.di.getDocument();
        if (!isNull(doc)) {
            doc.setModified(false);
        }
    } catch (eMod) {
        // could not clear the flag: the close below may prompt, which
        // is untidy but never destructive
    }
    try {
        session.child.close();
        return true;
    } catch (eClose) {
        return false;
    }
};

/**
 * Puts the origin in the middle of the editor's view, with the working
 * square and the grid lines just beyond it in sight.
 *
 * ZOOMED, NOT AUTO-ZOOMED. autoZoom frames whatever is in the drawing,
 * which for a brand new editor is the furniture alone and for an edited
 * symbol is the symbol alone -- either way the origin drifts off centre
 * and the scale changes with the contents. A symbol is drawn against
 * the CAVE's scale, so the view is set from the cave's own units and
 * stays put: ten feet of working square in the middle, twenty feet of
 * view around it.
 *
 * `extra` is an optional bounding box to keep in view as well -- an
 * existing symbol bigger than the working square, which is allowed
 * (nothing enforces the size) and must not open half off screen.
 */
SymbolPaletteEdit.frameEditor = function(di, doc, extra) {
    var perFoot = 1.0;
    try {
        perFoot = CsTrace.spacingFor(CsUnits.fromDrawingUnit(doc.getUnit(), RS));
    } catch (eUnit) {
        perFoot = 1.0;
    }
    var half = (SymbolPaletteEdit.VIEW_FEET * perFoot) / 2;
    var minX = -half, minY = -half, maxX = half, maxY = half;
    if (!isNull(extra)) {
        try {
            var lo = extra.getMinimum(), hi = extra.getMaximum();
            if (!isNaN(lo.x) && !isNaN(hi.x) && !isNaN(lo.y) && !isNaN(hi.y)) {
                // A margin of one working square around whatever is
                // there, so an oversized symbol is not flush to the edge.
                var pad = (SymbolPaletteEdit.WORKING_FEET * perFoot) / 2;
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
        // a document with no view yet (headless, or a tab that has not
        // been shown): the framing is a convenience, never the work
        return false;
    }
};

/** Draws the origin crosshair and the working square. */
SymbolPaletteEdit.addFurniture = function(doc, di) {
    try {
        CsLayers.ensure(doc, di, SymbolPaletteEdit.FURNITURE_LAYER);
    } catch (eEnsure) {
    }
    // The furniture is measured in FEET and drawn in the editor
    // document's own units, so the square is ten feet of cave whether
    // the drawing counts in feet or metres.
    var perFoot = 1.0;
    try {
        perFoot = CsTrace.spacingFor(CsUnits.fromDrawingUnit(doc.getUnit(), RS));
    } catch (eUnit) {
        perFoot = 1.0;
    }
    var half = (SymbolPaletteEdit.WORKING_FEET * perFoot) / 2;
    var arm = half * 1.15;   // the crosshair reaches just past the box
    var pieces = [];
    try {
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(-arm, 0), new RVector(arm, 0))));
        pieces.push(new RLineEntity(doc, new RLineData(
            new RVector(0, -arm), new RVector(0, arm))));
        // The working square, not a circle: it is the grid cell the
        // symbol is drawn inside, and a square says "this much space"
        // where a circle said "about this big".
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
        layerId = doc.getLayerId(SymbolPaletteEdit.FURNITURE_LAYER);
    } catch (eLayer) {
        layerId = null;
    }
    var op = new RAddObjectsOperation();
    for (var i = 0; i < pieces.length; i++) {
        try {
            CsTags.set(pieces[i], SymbolPaletteEdit.FURNITURE_TAG, "1");
            if (!isNull(layerId) && layerId !== RObject.INVALID_ID) {
                pieces[i].setLayerId(layerId);
            }
            op.addObject(pieces[i], false);
        } catch (eAdd) {
        }
    }
    try {
        // The furniture layer is OFF in the registry (CsLayers.OFF keeps
        // CTRL-HIDDEN off), and an add onto an off layer is dropped
        // silently, so the add goes through withLayerOn.
        CsLayers.withLayerOn(doc, di, SymbolPaletteEdit.FURNITURE_LAYER,
            function() {
                di.applyOperation(op);
            });
        // AND THEN IT STAYS ON. withLayerOn puts the layer back the way
        // it found it, which is exactly right in a cave map and exactly
        // wrong here: the crosshair and the working square are the only
        // thing in this drawing, and the first version of this shipped
        // an editor that opened completely blank because they were
        // added correctly and then hidden again (seen 2026-09-06). This
        // document is a scratch editor and nothing else, so the layer is
        // switched on for good.
        var lay = doc.queryLayer(SymbolPaletteEdit.FURNITURE_LAYER);
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

/** Opens an empty editor for a brand new symbol. */
SymbolPaletteEdit.startNew = function() {
    if (SymbolPaletteEdit.isEditing()) {
        EAction.handleUserMessage(qsTr("A symbol editor is already open. " +
            "Save or close it first."));
        return;
    }
    var opened = SymbolPaletteEdit.openEditorDocument(qsTr("New Symbol"));
    if (isNull(opened)) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build would not open a " +
            "drawing to draw the symbol in.");
        return;
    }
    var di = opened.di;
    SymbolPaletteEdit.addFurniture(di.getDocument(), di);
    SymbolPaletteEdit.frameEditor(di, di.getDocument(), null);
    SymbolPaletteEdit.session = { di: di, child: opened.child,
        block: null, meta: null };
    SymbolPalette.enterEditorMode(qsTr("Draw the symbol inside the %1 ft " +
        "square, then press Save Symbol.")
        .arg(SymbolPaletteEdit.WORKING_FEET));
};

/**
 * Opens an editor holding an existing custom symbol's geometry.
 *
 * Only a custom symbol: CsSymbolStore.saveBlock refuses to write a
 * shipped name, so editing one could never be saved and offering it
 * would be a dead end with a dialog at the far side of it.
 */
SymbolPaletteEdit.startEdit = function(entry) {
    if (isNull(entry)) {
        return;
    }
    if (entry.custom !== true) {
        EAction.handleUserMessage(qsTr("%1 is one of the symbols the suite " +
            "ships and cannot be edited.").arg(entry.nss));
        return;
    }
    if (SymbolPaletteEdit.isEditing()) {
        EAction.handleUserMessage(qsTr("A symbol editor is already open. " +
            "Save or close it first."));
        return;
    }

    // The symbol may be in the caver's library or -- if it was drawn
    // before the library existed -- still in the template.
    var srcDi = null;
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    for (var pi = 0; pi < places.length && srcDi === null; pi++) {
        if (isNull(places[pi])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[pi]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var tryDi = CsSymbolStore.openOffscreen(places[pi]);
        if (tryDi !== null &&
                !isNull(tryDi.getDocument().queryBlock(entry.block))) {
            srcDi = tryDi;
        }
    }
    if (srcDi === null) {
        EAction.handleUserWarning("Symbol Palette: " + entry.nss +
            " could not be found in your symbol library or in the cave " +
            "template, so it cannot be opened for editing.");
        return;
    }

    var opened = SymbolPaletteEdit.openEditorDocument(
        qsTr("Symbol: %1").arg(entry.nss));
    if (isNull(opened)) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build would not open a " +
            "drawing to edit the symbol in.");
        return;
    }
    var di = opened.di;
    var doc = di.getDocument();
    SymbolPaletteEdit.addFurniture(doc, di);

    var entities = CsSymbolStore.geometryOf(srcDi.getDocument(), entry.block);
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
            // adopt first, then every id: an entity still carrying the
            // template document's object id is read as an EDIT to
            // whatever that id names here, and lands nothing. See
            // CsSymbolStore.adopt.
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
    // The same framing as a new symbol, widened only if this one is
    // bigger than the working square -- so editing an existing symbol
    // shows it at the same scale it was drawn at rather than filling
    // the window with it.
    var extent = null;
    try {
        extent = doc.getBoundingBox();
    } catch (eExtent) {
        extent = null;
    }
    SymbolPaletteEdit.frameEditor(di, doc, extent);

    SymbolPaletteEdit.session = { di: di, child: opened.child,
        block: entry.block, meta: entry };
    SymbolPalette.enterEditorMode(qsTr("Editing %1. Press Save Symbol when " +
        "you are done.").arg(entry.nss));
};

/**
 * Everything in the editor that is the SYMBOL: model-space entities
 * that are not furniture.
 *
 * Model space only, so a caver who happens to define a block inside the
 * editor does not get its definition entities collected twice -- once
 * as the block and once loose.
 */
SymbolPaletteEdit.collect = function(doc) {
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
        if (CsTags.get(e, SymbolPaletteEdit.FURNITURE_TAG) === "1") {
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
 * Asks for the symbol's name, category and home layer.
 *
 * \return {nss, uis, category, layer} or null when cancelled.
 */
SymbolPaletteEdit.askMeta = function(existing) {
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Save Symbol");
    var v = new QVBoxLayout();

    v.addWidget(new QLabel(qsTr("Name")), 0, 0);
    var nameEdit = new QLineEdit(isNull(existing) ? "" : existing.nss);
    v.addWidget(nameEdit, 0, 0);

    v.addWidget(new QLabel(qsTr("Other name (UIS), optional")), 0, 0);
    var uisEdit = new QLineEdit(isNull(existing) ? "" : existing.uis);
    v.addWidget(uisEdit, 0, 0);

    v.addWidget(new QLabel(qsTr("Category")), 0, 0);
    var catCombo = new QComboBox();
    catCombo.editable = true;   // a new category is a legitimate answer
    var cats = CsSymbols.categoriesOf(CsSymbols.merged().entries);
    for (var c = 0; c < cats.length; c++) {
        catCombo.addItem(cats[c]);
    }
    if (!isNull(existing) && !isNull(existing.category)) {
        catCombo.setEditText(existing.category);
    }
    v.addWidget(catCombo, 0, 0);

    v.addWidget(new QLabel(qsTr("Layer it lives on")), 0, 0);
    var layerCombo = new QComboBox();
    var layers = SymbolPaletteEdit.homeLayers();
    for (var l = 0; l < layers.length; l++) {
        layerCombo.addItem(layers[l]);
    }
    // Selected by NAME, never by index: a hardcoded index silently
    // selects the wrong row the moment the registry gains a layer.
    var want = isNull(existing) ? CsLayers.BREAKDOWN : existing.layer;
    for (var s = 0; s < layers.length; s++) {
        if (layers[s] === want) {
            layerCombo.currentIndex = s;
            break;
        }
    }
    layerCombo.toolTip = qsTr("The layer this symbol is placed on in the " +
        "plan. Its elevation and cross-section layers are derived from " +
        "this one, so a symbol dropped in a band lands on the right twin " +
        "without you choosing again.");
    v.addWidget(layerCombo, 0, 0);

    var bb = new QDialogButtonBox(QDialogButtonBox.Ok |
        QDialogButtonBox.Cancel);
    // CLOSURES, NOT SLOT NAMES. `signal.connect(dialog, "accept")` --
    // the Qt Script idiom this suite used everywhere -- THROWS in this
    // build: "Function.prototype.connect: target is not a function".
    // The engine's connect takes a function, or a receiver plus a
    // function, and never a slot name. It threw where the dialog was
    // built, so the tool died before the dialog was ever shown.
    // Measured against the running application, 2026-09-06.
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);

    if (dlg.exec() !== QDialog.Accepted) {
        // destroy() THROWS on every QDialog in this build --
        // "Invalid attempt to destroy() an indestructible object",
        // parented or not (measured 2026-09-06). The dialog is
        // closed and handed to Qt to delete instead, and even that
        // is guarded: tearing down a dialog must never cost the
        // answer the caver just gave it.
        try {
            dlg.close();
            dlg.deleteLater();
        } catch (eClose) {
        }
        return null;
    }
    var meta = {
        nss: String(nameEdit.text).trim(),
        uis: String(uisEdit.text).trim(),
        category: String(catCombo.currentText).trim(),
        layer: String(layerCombo.currentText)
    };
    // destroy() THROWS on every QDialog in this build --
    // "Invalid attempt to destroy() an indestructible object",
    // parented or not (measured 2026-09-06). The dialog is
    // closed and handed to Qt to delete instead, and even that
    // is guarded: tearing down a dialog must never cost the
    // answer the caver just gave it.
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    if (meta.category === "") {
        meta.category = CsSymbolStore.DEFAULT_CATEGORY;
    }
    return meta;
};

/**
 * Saves what the editor holds into the template.
 *
 * Every refusal happens BEFORE anything is written, and each one names
 * what to do about it: a symbol half-written into a template is a
 * template a caver has to repair by hand.
 */
SymbolPaletteEdit.save = function() {
    var session = SymbolPaletteEdit.session;
    if (session === null) {
        return;
    }
    var di = session.di;
    if (isNull(di)) {
        SymbolPaletteEdit.finish();
        return;
    }
    // The editor's OWN document, not whichever tab is in front. A caver
    // who clicked back to their cave map and pressed Save Symbol would
    // otherwise write the whole map into the template as one symbol.
    var doc = null;
    try {
        doc = di.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("The symbol editor's drawing has been closed, so there is " +
                "nothing to save."));
        SymbolPaletteEdit.finish();
        return;
    }

    var entities = SymbolPaletteEdit.collect(doc);
    if (entities.length === 0) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("There is nothing to save: draw the symbol first. (The " +
                "crosshair and the square are guides, not geometry.)"));
        return;
    }

    var meta = SymbolPaletteEdit.askMeta(session.meta);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"), qsTr("A symbol needs a name."));
        return;
    }

    // An EDIT keeps its block name whatever the display name became --
    // renaming the block would leave every already-placed instance
    // pointing at a name that no longer exists.
    var blockName = session.block;
    if (isNull(blockName)) {
        blockName = CsSymbolStore.blockNameFor(meta.nss);
    }
    if (blockName === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"),
            qsTr("That name has no letters or numbers in it, so it cannot " +
                "become a block name. Try another."));
        return;
    }
    if (isNull(session.block)) {
        var clash = null;
        var merged = CsSymbols.merged();
        for (var i = 0; i < merged.entries.length; i++) {
            if (merged.entries[i].block === blockName) {
                clash = merged.entries[i];
                break;
            }
        }
        if (clash !== null) {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Save Symbol"),
                qsTr("There is already a symbol called %1 (%2). Give this " +
                    "one a different name.").arg(clash.nss).arg(blockName));
            return;
        }
    }

    var res = CsSymbolStore.saveBlock(null, blockName, doc, entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Save Symbol"), res.error);
        return;
    }

    // THE EDITOR CLOSES ITSELF, and says nothing while doing it. The
    // symbol is in the template now; the drawing it was drawn in has
    // done its job, and asking "save changes to Untitled?" would ask
    // the caver about a file they never meant to have.
    var closed = SymbolPaletteEdit.closeEditor(session);
    SymbolPaletteEdit.finish();
    EAction.handleUserMessage(closed ?
        qsTr("%1 saved to the cave template as %2.")
            .arg(meta.nss).arg(blockName) :
        qsTr("%1 saved to the cave template as %2. The editor drawing " +
            "could not be closed -- close it yourself; nothing in it is " +
            "needed any more.").arg(meta.nss).arg(blockName));

    // The palette rebuilds from the template, so the new symbol appears
    // and is armed -- a caver who just drew a symbol wants to place it.
    try {
        SymbolPalette.rebuildTiles();
        var listed = CsSymbols.merged();
        for (var j = 0; j < listed.entries.length; j++) {
            if (listed.entries[j].block === blockName) {
                SymbolPalette.arm(listed.entries[j]);
                break;
            }
        }
    } catch (eRefresh) {
    }
};

/** Abandons the editing session. The editor DRAWING is left open, and
 *  left MODIFIED: nothing has been written to the template, so whatever
 *  was drawn exists only in that window. Closing it out from under the
 *  caver -- or clearing its modified flag so it closes silently later
 *  -- would be this tool deciding their work was worthless. Saving is
 *  the only thing that closes the editor. */
SymbolPaletteEdit.cancel = function() {
    SymbolPaletteEdit.finish();
};

/** Ends the session and puts the panel back into placing mode. */
SymbolPaletteEdit.finish = function() {
    SymbolPaletteEdit.session = null;
    try {
        SymbolPalette.leaveEditorMode();
    } catch (e) {
    }
};

SymbolPaletteEdit.init = function(basePath) {
    // No widget names, no sort order, no icon: this is reached from the
    // Symbol Palette panel and never from a menu. The variable is
    // deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var editAction = new RGuiAction(qsTr("Edit Symbol"),
        RMainWindowQt.getMainWindow());
    editAction.setRequiresDocument(false);
    editAction.setScriptFile(basePath + "/SymbolPaletteEdit.js");
};
