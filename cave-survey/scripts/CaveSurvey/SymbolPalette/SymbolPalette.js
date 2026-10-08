// SymbolPalette.js -- Symbol Palette: the menu entry and the docked
// panel that arms which cave symbol the next click places.
//
// The click and the aim-drag live in SymbolPaletteRun.js beside this
// file; drawing a new symbol lives in SymbolPaletteEdit.js. QCAD cannot
// find either on its own -- AddOn.getAddOns only builds an add-on from
// <dir>/<dir>.js -- so init() below registers both.
//
// Panel shape follows Feature Trace's dock, including the two details
// that are load-bearing rather than stylistic: the dock is BUILT during
// init() and left hidden (the main window's restoreState() runs after
// add-on init and can only place a dock that already exists), and every
// widget construction and connect is wrapped so a bridge refusal costs
// one control rather than the whole panel.
//
// WHAT THE PANEL IS FOR. The suite has known its 28 symbols since the
// beginning -- Core/CsSymbols.js names each one with its NSS name, its
// UIS alias, its home layer and its category -- but the only ways to
// put one on a map were to scatter breakdown or to print a legend. The
// vocabulary was there and there was no way to speak it. This is the
// front door: every symbol, grouped, with a picture of itself, one
// click to arm and one click to place.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/SymbolPaletteRun.js");
include(includeBasePath + "/SymbolPaletteEdit.js");
// Feature Trace's erase action, borrowed rather than copied: the ACT is
// identical -- click a thing of mine and it goes -- and only the list of
// what counts as "mine" differs, which is a parameter. Two copies of a
// mouse mode is two places for its exit path to be wrong.

function SymbolPalette(guiAction) {
    EAction.call(this, guiAction);
}

SymbolPalette.prototype = new EAction();

/** The armed catalogue entry, read by SymbolPaletteRun.
 *
 *  Module state, which is only safe because the panel SHOWS which tile
 *  is armed -- the same bargain Feature Trace makes. Undefined means
 *  nothing is armed, and a click in the drawing says so rather than
 *  guessing a symbol. */
SymbolPalette.armed = undefined;

/** The dock and the widgets the panel updates. Module-level singletons
 *  because there is one panel per application window. */
// The panel lives in the Draw dock (see DrawPanel/DrawPanel.js).
SymbolPalette.widgets = undefined;

/** The entries the panel last built itself from, in panel order.
 *  Kept so Edit and Delete can act on the armed symbol without asking
 *  the store again mid-click. */
SymbolPalette.entries = [];

// A GRID OF PICTURES, NOT A LIST OF NAMES.
//
// A symbol is a drawing, and a caver looking for the spring symbol is
// looking for the picture of a spring. Names alone would make the panel
// a glossary; the tile is the symbol, at the size it will be placed,
// with the name underneath.
SymbolPalette.GRID_COLUMNS = 3;
SymbolPalette.CELL_W = 84;
SymbolPalette.CELL_H = 76;
SymbolPalette.ICON = 30;

/** Roughly how many characters fit on one line of a tile's label. The
 *  tile does not wrap for itself, whichever widget it is. */
SymbolPalette.CELL_CHARS = 11;

/** A label broken over lines, greedily, on spaces. A single word longer
 *  than the budget is left alone: a mid-word break is harder to read
 *  than an overhang. */
SymbolPalette.wrapLabel = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.join("\n");
};

/**
 * True when this entry matches the panel's search text.
 *
 * Matches the NSS name, the UIS alias AND the block name, all
 * case-insensitively: a caver types "gour" (UIS) as readily as
 * "rimstone" (NSS), and a symbol found by only one of its two names is
 * a symbol that looks missing.
 *
 * Pure, so the unit tests can hold it to that.
 */
SymbolPalette.matches = function(entry, needle) {
    if (isNull(needle) || String(needle).length === 0) {
        return true;
    }
    var n = String(needle).toLowerCase();
    var fields = [entry.nss, entry.uis, entry.block, entry.category];
    for (var i = 0; i < fields.length; i++) {
        if (isNull(fields[i])) {
            continue;
        }
        if (String(fields[i]).toLowerCase().indexOf(n) !== -1) {
            return true;
        }
    }
    return false;
};

/**
 * Groups entries by category, categories in first-appearance order.
 *
 * The shipped catalogue's order IS the grouping order, so the panel
 * reads the way the catalogue does; a custom symbol's category joins
 * the end if it is a new one, or its existing group if it is not.
 *
 * Pure.
 */
SymbolPalette.grouped = function(entries, needle) {
    var order = [];
    var byCategory = {};
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!SymbolPalette.matches(entry, needle)) {
            continue;
        }
        var c = entry.category;
        if (!byCategory.hasOwnProperty(c)) {
            byCategory[c] = [];
            order.push(c);
        }
        byCategory[c].push(entry);
    }
    var out = [];
    for (var j = 0; j < order.length; j++) {
        out.push({ category: order[j], entries: byCategory[order[j]] });
    }
    return out;
};

/** What a DRAG last asked for, remembered so the next plain click
 *  repeats it.
 *
 *  This used to be two typed boxes in the panel. They are gone: the
 *  gesture sets both, and a caver who has just dragged a flow arrow
 *  out to the size and bearing they wanted does not then read two
 *  numbers back (Nathan, 2026-09-11). The MEMORY stays, because
 *  placing six of the same arrow is one drag and five clicks.
 *
 *  Per session and per panel, not per drawing: it is the gesture's
 *  echo, not a property of the cave. */
SymbolPalette.lastSizeFeet = null;
SymbolPalette.lastAngleDeg = null;

/** The size to place at, in FEET of cave.
 *
 *  FEET AND NOT A SCALE FACTOR. The blocks are drawn about a foot
 *  across and a cave map is a thousand feet across, so scale 1 is a
 *  speck; worse, one multiplier means a different size on every symbol,
 *  because the north arrow is three times the stalactite. Feet mean the
 *  same thing on every tile, and the same thing in a metric drawing --
 *  SymbolPaletteRun.perFoot converts. */
SymbolPalette.sizeValue = function() {
    var v = SymbolPalette.lastSizeFeet;
    if (v === null || isNaN(v) || v <= 0) {
        return SymbolPaletteRun.DEFAULT_SIZE_FEET;
    }
    return v;
};

/** The angle to place at, in DEGREES. */
SymbolPalette.angleValue = function() {
    var v = SymbolPalette.lastAngleDeg;
    return (v === null || isNaN(v)) ? 0.0 : v;
};

/**
 * Remembers what the drag in progress is asking for, so the next plain
 * click repeats it.
 *
 * Called from a mouse-move handler, so it never throws.
 */
SymbolPalette.showDrag = function(sizeFeet, angleDeg) {
    try {
        if (!isNull(sizeFeet)) {
            SymbolPalette.lastSizeFeet = sizeFeet;
        }
        if (!isNull(angleDeg)) {
            var deg = angleDeg % 360;
            if (deg < 0) {
                deg += 360;
            }
            SymbolPalette.lastAngleDeg = deg;
        }
    } catch (e) {
    }
};

/**
 * Arms an entry and makes the panel show which one.
 *
 * The showing is not decoration. With no per-symbol menu command, an
 * entry held in module state is exactly the invisible mode a command
 * would have prevented; the checked tile IS the indicator.
 */
SymbolPalette.arm = function(entry) {
    SymbolPalette.armed = entry;
    // Here and not in the tile's click handler, so a symbol armed from
    // the search box's Return counts as used too.
    SymbolPalette.noteRecent(entry);
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked =
                (w.buttons[i].entry.block === entry.block);
        } catch (e) {
            // a button the bridge will not let us write back is still
            // armed correctly; only its appearance is wrong
        }
    }
    SymbolPalette.refreshCustomButtons();
};

/** Clears the armed symbol and every checked tile. */
/**
 * Arms the ONE symbol a search has left showing, and starts placing.
 *
 * Reads the TILES rather than re-running the filter: the tiles are what
 * the caver can see, and a second filtering pass here could disagree
 * with the one on screen -- which is how a shortcut arms something the
 * panel is not showing.
 */
SymbolPalette.armFiltered = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    // THE SHOWING TILES, not every tile. The panel keeps a widget for
    // every symbol now and hides the ones a search rules out, so
    // "w.buttons.length" is the whole catalogue and would answer "28
    // symbols still match" to every search ever typed.
    var showing = SymbolPalette.showingTiles();
    if (showing.length !== 1) {
        EAction.handleUserMessage(showing.length === 0 ?
            qsTr("No symbol matches that.") :
            qsTr("%1 symbols still match. Type more of the name, then " +
                "press Return.").arg(showing.length));
        return;
    }
    var entry = showing[0].entry;
    SymbolPalette.arm(entry);
    SymbolPalette.startRun();
    EAction.handleUserMessage(qsTr("Armed %1. Click in the drawing to " +
        "place it.").arg(entry.nss));
};

/** The tiles a search has left showing, in panel order. Reads what the
 *  last filter DECIDED rather than re-running the match, for
 *  armFiltered's own reason: what the caver can see is the only honest
 *  answer to "which one", and a second filtering pass could disagree
 *  with the one on screen. */
SymbolPalette.showingTiles = function() {
    var w = SymbolPalette.widgets;
    var out = [];
    if (isNull(w) || isNull(w.buttons)) {
        return out;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        // `showing` is what applyFilter DECIDED. A tile that has never
        // been through a filter has none, and counts as showing --
        // which is right: before the first filter, nothing is hidden.
        if (w.buttons[i].showing !== false) {
            out.push(w.buttons[i]);
        }
    }
    return out;
};

SymbolPalette.disarm = function() {
    SymbolPalette.armed = undefined;
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    for (var i = 0; i < w.buttons.length; i++) {
        try {
            w.buttons[i].button.checked = false;
        } catch (e) {
        }
    }
    SymbolPalette.refreshCustomButtons();
};

/** Edit and Delete act on the armed symbol, and only a CUSTOM symbol
 *  can be either. The shipped symbols are code: an edited copy in the
 *  template would be silently taken back by the next release. */
SymbolPalette.refreshCustomButtons = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    var custom = !isNull(SymbolPalette.armed) &&
        SymbolPalette.armed.custom === true;
    try {
        if (!isNull(w.editButton)) {
            w.editButton.enabled = custom;
        }
        if (!isNull(w.deleteButton)) {
            w.deleteButton.enabled = custom;
        }
    } catch (e) {
    }
};

/** The cursor readout: which view the cursor is in, and the layer a
 *  symbol dropped there would land on. Called from the run action's
 *  mouse-move, so it must never throw. */
SymbolPalette.showCursorFrame = function(frame, layer) {
    var w = SymbolPalette.widgets;
    // The counts are per VIEW. Recounted only when the cursor CHANGES
    // view: this is called on every mouse move, and a walk of the
    // drawing's block references per move would make the application
    // crawl on a real cave.
    if (frame !== SymbolPalette.cursorFrame) {
        SymbolPalette.cursorFrame = frame;
        try {
            SymbolPalette.refreshCounts();
        } catch (eCounts) {
        }
    }
    if (isNull(w) || isNull(w.frameLabel)) {
        return;
    }
    try {
        var name = qsTr("plan");
        if (frame === "profile") {
            name = qsTr("elevation");
        } else if (frame === "section") {
            name = qsTr("cross section");
        }
        var text = qsTr("Cursor:  %1").arg(name);
        if (!isNull(layer) && String(layer).length > 0) {
            text += "  --  " + String(layer);
        }
        w.frameLabel.text = text;
    } catch (e) {
    }
};

// ---------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------

/**
 * An icon of one symbol, drawn from the block's own geometry.
 *
 * RENDERED AND NOT DRAWN BY HAND, so a symbol a caver invents this
 * afternoon has a picture this afternoon, and so a preview can never
 * drift from the block it names -- the two failures a folder of 28
 * hand-authored SVGs would have guaranteed.
 *
 * Every shape is reduced to a point cloud (RShape.getPointCloud, which
 * every shape type implements) and stroked as a polyline. That is
 * coarse for a preview and exactly right for a tile 34 pixels across;
 * it also means one code path covers lines, arcs, splines and
 * polylines rather than four.
 *
 * \return a QIcon, or null when this build's painter refuses -- the
 *         caller falls back to a text tile rather than to no tile.
 */
SymbolPalette.iconFor = function(shapes, size, penColor) {
    if (isNull(shapes) || shapes.length === 0) {
        return null;
    }
    // The drawing extent, so the symbol fills its tile whatever size it
    // is in cave units -- a 20 ft pit and a 6 in stalactite both come
    // out legible.
    var minX = null, minY = null, maxX = null, maxY = null;
    var clouds = [];
    var i, j;
    for (i = 0; i < shapes.length; i++) {
        var pts = null;
        try {
            pts = shapes[i].getPointCloud(0.05);
        } catch (eCloud) {
            pts = null;
        }
        if (isNull(pts) || pts.length < 2) {
            continue;
        }
        var cloud = [];
        for (j = 0; j < pts.length; j++) {
            var x = pts[j].x, y = pts[j].y;
            cloud.push({ x: x, y: y });
            if (minX === null || x < minX) { minX = x; }
            if (maxX === null || x > maxX) { maxX = x; }
            if (minY === null || y < minY) { minY = y; }
            if (maxY === null || y > maxY) { maxY = y; }
        }
        clouds.push(cloud);
    }
    if (clouds.length === 0 || minX === null) {
        return null;
    }

    var w = maxX - minX, h = maxY - minY;
    var margin = 3;
    var span = Math.max(w, h);
    // A symbol that is a single horizontal or vertical stroke has one
    // zero extent; scaling by it would be a division by zero and a
    // blank tile.
    var factor = (span <= 0) ? 1.0 : (size - 2 * margin) / span;
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    try {
        var pixmap = new QPixmap(size, size);
        pixmap.fill(new QColor(0, 0, 0, 0));
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var pen = new QPen(isNull(penColor) ? new QColor(30, 30, 30) :
            penColor);
        pen.setWidth(1);
        painter.setPen(pen);
        for (i = 0; i < clouds.length; i++) {
            for (j = 0; j < clouds[i].length - 1; j++) {
                var a = clouds[i][j], b = clouds[i][j + 1];
                // y is flipped: drawing space counts up, a pixmap counts
                // down, and a symbol drawn upside down is a different
                // symbol (a stalactite is a stalagmite).
                painter.drawLine(
                    size / 2 + (a.x - cx) * factor,
                    size / 2 - (a.y - cy) * factor,
                    size / 2 + (b.x - cx) * factor,
                    size / 2 - (b.y - cy) * factor);
            }
        }
        painter.end();
        return new QIcon(pixmap);
    } catch (ePaint) {
        return null;
    }
};

/**
 * Every symbol's shapes, CACHED until a save or a delete.
 *
 * The read underneath is two full DXF imports (the caver's library and
 * the cave template) plus a walk of every block's geometry in both.
 * rebuildTiles calls this, and rebuildTiles used to run on every
 * keystroke in the search box -- so filtering for "gour" was eight DXF
 * imports and eight offscreen RDocumentInterfaces, none of which this
 * bridge ever frees. Measured against the live GUI 2026-09-14, after a
 * caver typed into the Draw panel's Symbols search and the application
 * came within sight of dying.
 *
 * Keyed on CsSymbolStore.generation, which that store bumps on every
 * invalidate() -- so saving, renaming or deleting a symbol drops this
 * with it, and nothing else has to know the cache exists.
 *
 * \return { byBlock: {name: [shapes]}, error }
 */
SymbolPalette.loadShapes = function() {
    var gen = 0;
    try {
        gen = CsSymbolStore.generation;
    } catch (eGen) {
        gen = 0;
    }
    if (!isNull(SymbolPalette.shapeCache) &&
            SymbolPalette.shapeCacheGeneration === gen) {
        return SymbolPalette.shapeCache;
    }
    var fresh = SymbolPalette.readShapes();
    SymbolPalette.shapeCache = fresh;
    SymbolPalette.shapeCacheGeneration = gen;
    return fresh;
};

/** The cached answer, and the store generation it was read at. */
SymbolPalette.shapeCache = null;
SymbolPalette.shapeCacheGeneration = -1;

/** The actual read. Never call this directly -- see loadShapes. */
SymbolPalette.readShapes = function() {
    var out = { byBlock: {}, error: "" };
    // BOTH FILES, the caver's library first so their own version of a
    // symbol is the one pictured. One open each, for the whole panel.
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    var opened = 0;
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[p]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var di = CsSymbolStore.openOffscreen(places[p]);
        if (di === null) {
            continue;
        }
        opened++;
        var doc = di.getDocument();
        var names = doc.getBlockNames();
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]);
            if (name.indexOf(CsSymbolStore.PREFIX) !== 0) {
                continue;
            }
            if (out.byBlock.hasOwnProperty(name)) {
                continue;   // the library's copy already answered
            }
            var entities = CsSymbolStore.geometryOf(doc, name);
            var shapes = [];
            for (var j = 0; j < entities.length; j++) {
                try {
                    var got = entities[j].getShapes();
                    for (var k = 0; k < got.length; k++) {
                        shapes.push(got[k]);
                    }
                } catch (eShape) {
                }
            }
            out.byBlock[name] = shapes;
        }
    }
    if (opened === 0) {
        out.error = "no symbol files could be read";
    }
    return out;
};

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

/** Arms an entry and starts the placement action. Its own function so
 *  the closure captures ONE entry rather than the loop variable. */
SymbolPalette.connectTile = function(button, entry) {
    button.clicked.connect(function() {
        SymbolPalette.arm(entry);
        SymbolPalette.startRun();
    });
};

/**
 * The right-click menu on a tile.
 *
 * WHAT IS ON IT, and why each earns its place:
 *
 *   Place            what a left-click does, said out loud -- a menu
 *                    that cannot do the ordinary thing reads as a menu
 *                    for exceptions only.
 *   Edit...          the caver's own symbol, reopened for redrawing.
 *   Rename...        its NAME, alias, category and home layer, without
 *                    redrawing a line. A symbol saved into the wrong
 *                    category used to mean drawing it again.
 *   Duplicate...     copy ANY symbol -- the shipped ones included -- into
 *                    the library under a new name. This is the answer
 *                    to "I want the stalactite, but mine": the shipped
 *                    ones cannot be edited, and now they do not have to
 *                    be redrawn from nothing either.
 *   Delete...        the caver's own, gone from the library.
 *
 * A shipped symbol offers Place and Duplicate; the other three are
 * disabled with the reason in their tooltip, rather than hidden, so the
 * menu does not change shape under the cursor.
 *
 * popup(), never exec(): exec blocks, and a menu that owns the event
 * loop while a caver is mid-gesture is how a panel hangs. The menu is
 * kept on the widget bag so it is not collected while it is open --
 * SketchScans learned that one first.
 */
SymbolPalette.connectTileMenu = function(button, entry) {
    try {
        button.contextMenuPolicy = Qt.CustomContextMenu;
    } catch (ePolicy) {
        return;
    }
    button.customContextMenuRequested.connect(function(pos) {
        try {
            var w = SymbolPalette.widgets;
            var custom = (entry.custom === true);
            var menu = new QMenu();

            var place = menu.addAction(qsTr("Place"));
            place.triggered.connect(function() {
                SymbolPalette.arm(entry);
                SymbolPalette.startRun();
            });
            menu.addSeparator();

            var edit = menu.addAction(qsTr("Edit..."));
            edit.enabled = custom;
            edit.triggered.connect(function() {
                SymbolPaletteEdit.startEdit(entry);
            });

            var rename = menu.addAction(qsTr("Rename / Recategorise..."));
            rename.enabled = custom;
            rename.triggered.connect(function() {
                SymbolPalette.renameSymbol(entry);
            });

            var dup = menu.addAction(qsTr("Duplicate as New Symbol..."));
            dup.triggered.connect(function() {
                SymbolPalette.duplicateSymbol(entry);
            });

            menu.addSeparator();
            var del = menu.addAction(qsTr("Delete..."));
            del.enabled = custom;
            del.triggered.connect(function() {
                SymbolPalette.arm(entry);
                SymbolPalette.deleteArmed();
            });

            if (!custom) {
                try {
                    var why = qsTr("%1 is one of the symbols CaveCAD " +
                        "ships. Duplicate it to make your own version.")
                        .arg(entry.nss);
                    edit.toolTip = why;
                    rename.toolTip = why;
                    del.toolTip = why;
                } catch (eTip) {
                }
            }

            // Kept alive on the widget bag: popup() returns at once, and
            // a menu the collector takes mid-display simply vanishes.
            if (!isNull(w)) {
                w.tileMenu = menu;
            }
            menu.popup(button.mapToGlobal(pos));
        } catch (eMenu) {
            // no context menu on this bridge: every one of these is
            // still reachable from the buttons below the tiles
        }
    });
};

/**
 * Renames a custom symbol, or moves it to another category or layer.
 *
 * The BLOCK NAME never changes -- every already-placed instance in
 * every drawing points at it, and a rename that broke those would be a
 * rename that eats work. What changes is the marker: the display name,
 * the alias, the category and the home layer.
 */
SymbolPalette.renameSymbol = function(entry) {
    if (isNull(entry) || entry.custom !== true) {
        return;
    }
    var meta = SymbolPaletteEdit.askMeta(entry);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"), qsTr("A symbol needs a name."));
        return;
    }
    var found = CsSymbolStore.geometryFor(entry.block);
    if (found === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"),
            qsTr("%1's drawing could not be found, so it cannot be " +
                "renamed.").arg(entry.nss));
        return;
    }
    var res = CsSymbolStore.saveBlock(null, entry.block, found.doc,
        found.entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Rename Symbol"), res.error);
        return;
    }
    EAction.handleUserMessage(qsTr("%1 is now %2, in %3.")
        .arg(entry.nss).arg(meta.nss).arg(meta.category));
    CsSymbolStore.invalidate();
    SymbolPalette.disarm();
    SymbolPalette.rebuildTiles();
};

/**
 * Copies a symbol into the library under a new name.
 *
 * THE WAY TO CHANGE A SHIPPED SYMBOL. The 28 cannot be edited -- the
 * next release would take the change back -- which used to mean a
 * caver who wanted "that, but with a longer tail" started from a blank
 * editor. Now they start from the symbol.
 */
SymbolPalette.duplicateSymbol = function(entry) {
    if (isNull(entry)) {
        return;
    }
    var found = CsSymbolStore.geometryFor(entry.block);
    if (found === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"),
            qsTr("%1's drawing could not be found, so there is nothing " +
                "to copy.").arg(entry.nss));
        return;
    }
    var seed = { nss: entry.nss + qsTr(" (mine)"), uis: entry.uis,
        category: entry.category, layer: entry.layer };
    var meta = SymbolPaletteEdit.askMeta(seed);
    if (meta === null) {
        return;
    }
    if (meta.nss === "") {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"), qsTr("A symbol needs a name."));
        return;
    }
    var blockName = CsSymbolStore.blockNameFor(meta.nss);
    if (blockName === null) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"),
            qsTr("That name has no letters or numbers in it, so it " +
                "cannot become a block name. Try another."));
        return;
    }
    var merged = CsSymbols.merged();
    for (var i = 0; i < merged.entries.length; i++) {
        if (merged.entries[i].block === blockName) {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Duplicate Symbol"),
                qsTr("There is already a symbol called %1 (%2). Give " +
                    "this one a different name.")
                    .arg(merged.entries[i].nss).arg(blockName));
            return;
        }
    }
    var res = CsSymbolStore.saveBlock(null, blockName, found.doc,
        found.entities, meta);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Duplicate Symbol"), res.error);
        return;
    }
    EAction.handleUserMessage(qsTr("%1 copied to your library as %2 -- " +
        "Edit it to make it yours.").arg(entry.nss).arg(meta.nss));
    CsSymbolStore.invalidate();
    SymbolPalette.rebuildTiles();
    var listed = CsSymbols.merged();
    for (i = 0; i < listed.entries.length; i++) {
        if (listed.entries[i].block === blockName) {
            SymbolPalette.arm(listed.entries[i]);
        }
    }
};

/** One category, as a group box full of tiles. */
/** Where the collapsed categories are remembered between sessions.
 *  The FOLDING itself lives in Core/CsPanel.js, shared with Feature
 *  Trace -- Nathan's standing ask (2026-09-07): a panel feature asked
 *  for in one of these panels belongs in both, and the way to keep that
 *  promise is one copy of the code rather than a good memory. */
SymbolPalette.COLLAPSED_SETTING = "CaveSurvey/SymbolPaletteCollapsed";

/** The collapsed set, through the shared helper. */
SymbolPalette.loadCollapsed = function() {
    return CsPanel.loadCollapsed(SymbolPalette.COLLAPSED_SETTING);
};

/** Which view the cursor was last in; the tiles' counts are of this
 *  view, for FeatureTrace.cursorFrame's reason. */
SymbolPalette.cursorFrame = "plan";

/**
 * How many of each symbol the current view holds -- {block: count}.
 *
 * ONE PASS over the drawing's block references, grouped by block name
 * and filtered by the layer's frame. Per-block and not per-LAYER,
 * unlike Feature Trace's counts, because several symbols share a home
 * layer: stalactite and stalagmite both live on FORMATIONS-DRIP, and a
 * per-layer count would report each of them as the sum of both.
 */
SymbolPalette.countsByBlock = function(doc, frame) {
    var out = {};
    if (isNull(doc)) {
        return out;
    }
    var ids = [];
    try {
        ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    } catch (eQuery) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var name = "";
        var layerName = "";
        try {
            name = String(e.getReferencedBlockName());
            layerName = String(doc.getLayerName(e.getLayerId()));
        } catch (eRead) {
            continue;
        }
        if (name === "" || CsLayers.frameOf(layerName) !== frame) {
            continue;
        }
        out[name] = (out[name] || 0) + 1;
    }
    return out;
};

/**
 * Writes the counts onto the tiles.
 *
 * Zero shows as a dash, not "0" -- a dash reads as "none yet", which is
 * the truth about a symbol nobody has placed, where a 0 in a column of
 * numbers reads as a measurement. Feature Trace does the same.
 */
SymbolPalette.refreshCounts = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.buttons)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    var counts = {};
    try {
        counts = SymbolPalette.countsByBlock(doc, SymbolPalette.cursorFrame);
    } catch (eCount) {
        counts = {};
    }
    for (var i = 0; i < w.buttons.length; i++) {
        var entry = w.buttons[i].entry;
        var n = counts[entry.block] || 0;
        try {
            w.buttons[i].button.text =
                SymbolPalette.wrapLabel(entry.nss,
                    SymbolPalette.CELL_CHARS) +
                "\n" + (n === 0 ? "--" : String(n));
        } catch (eText) {
        }
    }
};

/** The settings key holding the last few symbols armed. */
SymbolPalette.RECENT_SETTING = "CaveSurvey/SymbolPaletteRecent";

/**
 * One tile, built the same way wherever it appears -- in a category or
 * in the Recent row. Feature Trace's FeatureTrace.tileFor is its twin,
 * and for the same reason: a caver who has learnt to recognise a
 * symbol's picture must recognise it in both places.
 *
 * `checkable` is false for a Recent tile: the armed mark belongs to the
 * tile in its category, and two lit copies of one symbol would raise
 * the question of which one is armed.
 */
/**
 * The ink a tile's picture is drawn in: plain white on a dark theme, plain
 * black on a light one.
 *
 * iconFor's default is near-black, which is invisible on a dark theme --
 * every tile in the palette was a blank square with a name under it.
 * It is deliberately NOT the theme's text or highlight colour: a symbol
 * drawn in the accent colour reads as "this prints in that colour", and
 * a symbol prints in its layer's colour, not the palette's. So only the
 * button's LIGHTNESS is read, and the answer is black or white. null (the
 * old default) when the bridge will not hand the palette over.
 */
SymbolPalette.tilePen = function(button) {
    try {
        var p = button.palette;
        if (typeof p === "function") {
            p = p.call(button);
        }
        var c = p.color(QPalette.Button);
        var lightness = 0.299 * c.red() + 0.587 * c.green() +
            0.114 * c.blue();
        return lightness < 128 ? new QColor(255, 255, 255) :
            new QColor(0, 0, 0);
    } catch (e) {
        return null;
    }
};

SymbolPalette.tileFor = function(entry, shape, checkable, compact) {
    // A TOOL BUTTON, not a push button. A QPushButton lays its icon and
    // its text side by side and there is no way to stack them, so a
    // 30px picture and a name shared one line and the name came out as
    // "Entran" and "Dom" -- seen in the first live GUI check,
    // 2026-09-06. QToolButton stacks them, which is what a palette tile
    // has always looked like.
    var button = new QToolButton();
    if (compact !== true) {
        button.text = SymbolPalette.wrapLabel(entry.nss,
            SymbolPalette.CELL_CHARS);
        try {
            button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
        } catch (eStyle) {
            // a bridge without the enum gets a text-beside-icon tile,
            // which is the old look and still usable
        }
    }
    button.checkable = (checkable !== false);
    // The mechanical half -- the UIS alias, the block, the layer -- is
    // still here, but it is now the SMALL print under what the symbol
    // means. A beginner needs the meaning; a block name is for whoever
    // is already inside the drawing.
    var detail = [];
    if (!isNull(entry.uis) && entry.uis !== "" && entry.uis !== entry.nss) {
        detail.push(qsTr("UIS: ") + entry.uis);
    }
    detail.push(entry.block + "  ->  " + entry.layer);
    if (entry.custom === true) {
        detail.push(qsTr("Your own symbol -- Edit and Delete work on " +
            "this one."));
    }
    // Null for a custom symbol, which is the point: a caver's own
    // drawing means whatever they drew it to mean, and the tile says
    // no more about it than it ever did.
    button.toolTip = CsPanel.tipHtml(entry.nss,
        CsHelp.forSymbol(entry.block), detail);
    var icon = SymbolPalette.iconFor(shape, SymbolPalette.ICON,
        SymbolPalette.tilePen(button));
    if (icon !== null) {
        try {
            button.icon = icon;
            button.iconSize = new QSize(SymbolPalette.ICON,
                SymbolPalette.ICON);
        } catch (eIcon) {
            // a tile with no picture still says its name
        }
    }
    try {
        if (compact === true) {
            // the picture alone -- see FeatureTrace.tileFor's own note:
            // five full tiles are wider than the dock anyone keeps open
            button.setFixedSize(SymbolPalette.ICON + 14,
                SymbolPalette.ICON + 14);
        } else {
            // +14: the tile now carries a third line, the count,
            // under a name that is often two lines already.
            button.setFixedSize(SymbolPalette.CELL_W,
                SymbolPalette.CELL_H + 14);
        }
    } catch (eSize) {
        // a bridge without setFixedSize gets tiles that stretch; the
        // grid still reads as a grid
    }
    SymbolPalette.connectTile(button, entry);
    return button;
};

/**
 * Rebuilds the Recent row from the last few symbols armed.
 *
 * PINNED ABOVE THE CATEGORIES and outside the foldable stack, exactly
 * as Feature Trace's is: a shortcut you have to unfold first is not a
 * shortcut. It hides itself when empty, so a fresh install shows the
 * palette it always showed.
 *
 * A key naming a symbol that is no longer in the library -- deleted, or
 * a custom one from a library that has moved -- is skipped rather than
 * drawn as a blank tile.
 */
SymbolPalette.rebuildRecent = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.recentRow)) {
        return;
    }
    var keys = CsPanel.loadRecent(SymbolPalette.RECENT_SETTING);
    CsPanel.clearLayout(w.recentRow);
    var shown = 0;
    if (keys.length > 0) {
        var shapes = SymbolPalette.loadShapes().byBlock;
        for (var i = 0; i < keys.length; i++) {
            var entry = null;
            try {
                entry = CsSymbols.byBlock(keys[i]);
            } catch (eLookup) {
                entry = null;
            }
            if (entry === null) {
                continue;
            }
            try {
                w.recentRow.addWidget(
                    SymbolPalette.tileFor(entry, shapes[entry.block],
                        false, true),
                    0, 0);
                shown++;
            } catch (eTile) {
            }
        }
    }
    try {
        w.recentRow.addStretch(1);
    } catch (eStretch) {
    }
    try {
        w.recentLabel.visible = (shown > 0);
    } catch (eLabel) {
    }
};

/** Notes a symbol as just used, and repaints the Recent row. */
SymbolPalette.noteRecent = function(entry) {
    if (isNull(entry)) {
        return;
    }
    try {
        CsPanel.noteRecent(SymbolPalette.RECENT_SETTING, entry.block);
        SymbolPalette.rebuildRecent();
    } catch (e) {
        // the Recent row is a convenience; arming must not depend on it
    }
};

SymbolPalette.buildGroup = function(w, parent, group, shapes, collapsed) {
    // The folding -- and the right-click Move Up / Move Down on the
    // header -- are CsPanel's, shared with Feature Trace.
    var section = CsPanel.section(parent, group.category,
        SymbolPalette.COLLAPSED_SETTING, collapsed);
    var inner = new QGridLayout();
    // KEPT ON THE SECTION so applyFilter can repack this grid without
    // building a single widget: the tiles a search hides are the same
    // objects it shows again, and a tile's icon is a rendered pixmap
    // nobody wants painted twice.
    section.grid = inner;
    section.tiles = [];
    var cell = 0;
    for (var i = 0; i < group.entries.length; i++) {
        var entry = group.entries[i];
        try {
            var button = SymbolPalette.tileFor(entry,
                shapes[entry.block], true);
            SymbolPalette.connectTileMenu(button, entry);
            inner.addWidget(button,
                Math.floor(cell / SymbolPalette.GRID_COLUMNS),
                cell % SymbolPalette.GRID_COLUMNS);
            cell++;
            var tile = { button: button, entry: entry };
            section.tiles.push(tile);
            w.buttons.push(tile);
        } catch (e) {
            w.problems.push(entry.block + " (" + e + ")");
        }
    }
    try {
        // Fixed-size tiles in a stretching grid would drift apart as the
        // dock widens; the stretch goes to a column PAST the last one.
        inner.setColumnStretch(SymbolPalette.GRID_COLUMNS, 1);
    } catch (eStretch) {
    }
    try {
        inner.setContentsMargins(2, 2, 2, 2);
    } catch (eMargins) {
    }
    section.host.setLayout(inner);
    return section;
};

/** True once the one-off template migration has run this session. */
SymbolPalette.migrationDone = false;

/**
 * Moves a caver's own symbols out of the cave template and into their
 * symbol library, where a CaveCAD update cannot overwrite them.
 *
 * Its own function so rebuildTiles can call it on the FIRST rebuild and
 * never again -- see the call site for why once is enough.
 */
SymbolPalette.runTemplateMigration = function() {
    try {
        var moved = CsSymbolStore.migrateFromTemplate();
        if (moved.moved.length > 0) {
            EAction.handleUserMessage(qsTr("Moved %1 of your own symbols " +
                "out of the cave template and into your symbol library, " +
                "where a CaveCAD update cannot overwrite them: %2")
                .arg(moved.moved.length).arg(moved.moved.join(", ")));
        }
    } catch (eMigrate) {
        // a migration that cannot run leaves the symbols where they
        // are, which is exactly where they were working from before
    }
};

/** How long the panel waits after the last keystroke before it filters.
 *  Long enough that typing a whole word is ONE rebuild, short enough
 *  that a caver who has stopped typing does not notice the wait. */
SymbolPalette.FILTER_DELAY_MS = 200;

/** The pending filter, or null. Module-level so a second keystroke can
 *  cancel the first one's timer rather than queue a second rebuild. */
SymbolPalette.filterTimer = null;

/**
 * Rebuilds the tiles AFTER the caver stops typing.
 *
 * A rebuild tears down and rebuilds every tile widget in the panel.
 * Wired straight to textChanged, that ran once per keystroke, and each
 * run reparented the live group boxes to null -- which on a fullscreen
 * macOS CaveCAD threw up a black fullscreen window per box until
 * deleteLater caught up. The hide-before-detach in rebuildTiles is what
 * stops the windows; this is what stops there being six rebuilds in
 * flight to make them out of.
 */
SymbolPalette.scheduleFilter = function() {
    if (typeof QTimer === "undefined") {
        SymbolPalette.filterNow();   // no timers on this bridge
        return;
    }
    try {
        if (SymbolPalette.filterTimer !== null) {
            SymbolPalette.filterTimer.stop();
        }
    } catch (eStop) {
    }
    try {
        var timer = new QTimer(RMainWindowQt.getMainWindow());
        timer.singleShot = true;
        timer.timeout.connect(function() {
            SymbolPalette.filterTimer = null;
            try {
                SymbolPalette.filterNow();
            } catch (eRebuild) {
            }
        });
        SymbolPalette.filterTimer = timer;
        timer.start(SymbolPalette.FILTER_DELAY_MS);
    } catch (eTimer) {
        // a bridge that refused the timer filters immediately, which is
        // the behaviour this had before the debounce existed
        SymbolPalette.filterTimer = null;
        SymbolPalette.filterNow();
    }
};

/** Runs a pending filter NOW. For Return, which acts on what the tiles
 *  show and so cannot be allowed to read a stale set. */
SymbolPalette.flushFilter = function() {
    try {
        if (SymbolPalette.filterTimer !== null) {
            SymbolPalette.filterTimer.stop();
            SymbolPalette.filterTimer = null;
            SymbolPalette.filterNow();
        }
    } catch (eFlush) {
    }
};

/**
 * Rebuilds the tiles from the current catalogue and search text.
 *
 * Tears the tile area down and builds it again rather than hiding
 * rows: the merged catalogue can GAIN a symbol (a save) and LOSE one (a
 * delete) while the panel is open, and a hide-only filter would leave a
 * deleted symbol clickable.
 */
SymbolPalette.rebuildTiles = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.tileHost)) {
        return;
    }
    var armedBlock = isNull(SymbolPalette.armed) ? null :
        SymbolPalette.armed.block;

    try {
        // Delete the old boxes. Reparenting to null and calling
        // deleteLater is how a script drops a widget in this bridge;
        // hiding them would leave their buttons connected and armable.
        //
        // HIDDEN FIRST, AND THAT ORDER IS THE WHOLE BUG. setParent(null)
        // makes a widget a TOP-LEVEL WINDOW. On macOS, with CaveCAD
        // fullscreen, each detached-but-not-yet-deleted group box came
        // up as its own black fullscreen space -- six of them at once,
        // one per category, all vanishing again when deleteLater finally
        // ran. Reported live 2026-09-14, searching the Draw panel's
        // Symbols section. CsPanel.clearLayout had this right already;
        // this loop and AreaFill.rebuildTiles were the two places that
        // never learnt it.
        for (var i = 0; i < w.groupBoxes.length; i++) {
            try {
                w.groupBoxes[i].visible = false;
                w.groupBoxes[i].setParent(null);
                w.groupBoxes[i].deleteLater();
            } catch (eDel) {
            }
        }
    } catch (eClear) {
    }
    w.groupBoxes = [];
    w.buttons = [];

    // A symbol drawn before the library existed still lives in the
    // template, where the next release will overwrite it.
    //
    // ONCE PER SESSION, NOT ONCE PER REBUILD. "Costs nothing when there
    // is nothing to move" was wrong: the check itself is a list() of
    // the template, and the panel rebuilds on every keystroke in the
    // search box. Nothing can put a stray symbol back into the template
    // while the panel is open -- the editor writes to the library --
    // so the first rebuild is the only one that can find anything.
    if (!SymbolPalette.migrationDone) {
        SymbolPalette.migrationDone = true;
        SymbolPalette.runTemplateMigration();
    }

    var merged = CsSymbols.merged();
    SymbolPalette.entries = merged.entries;
    if (!merged.ok && !isNull(w.problemLabel)) {
        try {
            w.problemLabel.text = merged.error;
            w.problemLabel.visible = true;
        } catch (eProb) {
        }
    } else if (!isNull(w.problemLabel)) {
        try {
            w.problemLabel.visible = false;
        } catch (eProb2) {
        }
    }

    var shapes = SymbolPalette.loadShapes().byBlock;

    // THE WHOLE CATALOGUE, ALWAYS -- the search is not applied here.
    // A rebuild is the expensive thing in this panel (a rendered pixmap
    // per tile, and a QWidget per tile to hang it on), so it happens
    // when the CATALOGUE changes -- a save, a rename, a delete -- and
    // never because somebody typed a letter. applyFilter below does the
    // typing case by showing and hiding tiles that already exist.
    var groups = SymbolPalette.grouped(merged.entries, "");
    w.stack = CsPanel.stack(w.tileLayout,
        SymbolPalette.COLLAPSED_SETTING, 0, function() {
            SymbolPalette.rebuildTiles();
        });
    var collapsed = SymbolPalette.loadCollapsed();
    for (var g = 0; g < groups.length; g++) {
        try {
            var section = SymbolPalette.buildGroup(w, w.tileHost, groups[g],
                shapes, collapsed);
            w.tileLayout.addWidget(section.box, 0, 0);
            w.groupBoxes.push(section.box);
            CsPanel.stackAdd(w.stack, section, groups[g].category);
        } catch (eGroup) {
            w.problems.push(groups[g].category + " (" + eGroup + ")");
        }
    }
    try {
        CsPanel.applyOrder(w.stack);
    } catch (eOrder) {
        w.problems.push("category order (" + eOrder + ")");
    }
    // The stack's order AFTER applyOrder is the caver's order, and it
    // is the order every filter works from: applyFilter narrows
    // stack.sections to the ones with a match, so this is the only
    // place the full set is remembered.
    w.allSections = w.stack.sections.slice(0);
    // What the tiles were built FROM. A filter compares this against
    // the store's current generation and rebuilds instead of filtering
    // when a save has happened since -- which is what stops a deleted
    // symbol staying on screen and clickable.
    try {
        w.builtAtGeneration = CsSymbolStore.generation;
    } catch (eGen) {
        w.builtAtGeneration = -1;
    }

    // The tiles are new objects, so the counts have to be written again.
    try {
        SymbolPalette.refreshCounts();
    } catch (eCounts) {
        w.problems.push("symbol counts (" + eCounts + ")");
    }

    // Re-arm what was armed, if it is still in the list: a rebuild
    // after a save must not silently disarm the tool mid-job.
    if (armedBlock !== null) {
        for (var b = 0; b < w.buttons.length; b++) {
            if (w.buttons[b].entry.block === armedBlock) {
                try {
                    w.buttons[b].button.checked = true;
                } catch (eRe) {
                }
            }
        }
    }
    SymbolPalette.refreshCustomButtons();
    // The panel is built showing everything; whatever is in the search
    // box now decides what stays showing.
    SymbolPalette.applyFilter();
};

/**
 * Shows the tiles that match the search box, hides the rest.
 *
 * NO WIDGET IS BUILT OR DESTROYED HERE, and that is the whole point.
 * Every tile carries a rendered pixmap of its symbol's real geometry;
 * rebuilding thirty of those per keystroke is what made typing in this
 * panel feel like the application had stalled, on top of the two DXF
 * imports and the whole-drawing symbol count each rebuild also ran.
 * Filtering touches visibility and grid cells only.
 *
 * WHAT STILL HAS TO BE RIGHT:
 *   - A category with no match disappears entirely, header and all --
 *     an empty group heading reads as "nothing here matched" nine
 *     times over, which is worse than a short panel.
 *   - A SEARCH OPENS EVERYTHING it shows. A caver typing "gour" wants
 *     the rimstone dam on screen, not folded inside a group they
 *     collapsed last week. The collapsed set is never written to, so
 *     clearing the search puts the panel back exactly as they had it.
 *   - The grid is REPACKED rather than left with holes: hiding the
 *     second of three tiles must not leave a gap where it was.
 *   - The counts are NOT recomputed. They come from a walk of every
 *     block reference in the drawing, which on a real cave is the
 *     slowest thing this panel can do, and filtering changes none of
 *     them.
 */
SymbolPalette.applyFilter = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w) || isNull(w.stack) || isNull(w.allSections)) {
        return;
    }
    var needle = "";
    try {
        needle = isNull(w.searchEdit) ? "" : String(w.searchEdit.text);
    } catch (eSearch) {
        needle = "";
    }
    var searching = (needle !== "");
    var collapsed = searching ? {} : SymbolPalette.loadCollapsed();

    // Every section box comes out of the layout first. The ones with a
    // match go back in through CsPanel.relayout below; the others stay
    // out and hidden. removeWidget does NOT reparent -- which matters:
    // setParent(null) on a visible widget is what used to throw black
    // fullscreen windows up on macOS (see rebuildTiles).
    for (var r = 0; r < w.allSections.length; r++) {
        try {
            w.tileLayout.removeWidget(w.allSections[r].box);
        } catch (eRemove) {
        }
    }

    var showing = [];
    for (var i = 0; i < w.allSections.length; i++) {
        var section = w.allSections[i];
        var tiles = isNull(section.tiles) ? [] : section.tiles;
        var cell = 0;
        // Out of the grid, all of them, so the survivors can be laid
        // back down with no holes between them.
        for (var t = 0; t < tiles.length; t++) {
            try {
                section.grid.removeWidget(tiles[t].button);
            } catch (eOut) {
            }
        }
        for (t = 0; t < tiles.length; t++) {
            var hit = SymbolPalette.matches(tiles[t].entry, needle);
            // RECORDED, not read back off the widget later. A tile's
            // `visible` is isVisible(): false while the dock is still
            // being built, false inside a folded section, false for a
            // hidden panel -- none of which mean "the search ruled it
            // out". Same rule CsPanel.isFolded states for `open`.
            tiles[t].showing = hit;
            try {
                tiles[t].button.visible = hit;
            } catch (eVis) {
            }
            if (!hit) {
                continue;
            }
            try {
                section.grid.addWidget(tiles[t].button,
                    Math.floor(cell / SymbolPalette.GRID_COLUMNS),
                    cell % SymbolPalette.GRID_COLUMNS);
            } catch (eIn) {
            }
            cell++;
        }
        var keep = (cell > 0);
        try {
            section.box.visible = keep;
        } catch (eBox) {
        }
        if (!keep) {
            continue;
        }
        // Folded or not, decided the same way a rebuild used to decide
        // it -- through CsPanel.setOpen, which does NOT write to the
        // caver's collapsed set.
        try {
            CsPanel.setOpen(section, section.title,
                collapsed[section.title] !== true);
        } catch (eOpen) {
        }
        showing.push(section);
    }

    w.stack.sections = showing;
    try {
        CsPanel.relayout(w.stack);
    } catch (eLayout) {
    }
};

/**
 * The filter, run now: rebuilds first if the catalogue changed under it.
 *
 * A filter reuses the tiles a rebuild made. If a symbol has been saved,
 * renamed or deleted since -- CsSymbolStore.generation says so -- those
 * tiles are the wrong set, and a hide-only filter would leave a deleted
 * symbol on screen and clickable. Then, and only then, this rebuilds
 * (and rebuildTiles applies the filter itself on the way out).
 */
SymbolPalette.filterNow = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    var gen = -1;
    try {
        gen = CsSymbolStore.generation;
    } catch (eGen) {
        gen = -1;
    }
    if (w.builtAtGeneration !== gen) {
        SymbolPalette.rebuildTiles();
        return;
    }
    SymbolPalette.applyFilter();
};

/** THE PANEL'S BODY, separated from its dock -- see
 *  FeatureTrace.buildBody for why. */
SymbolPalette.buildBody = function(parent) {
    var w = { problems: [], buttons: [], groupBoxes: [] };
    var body = new QWidget(parent);
    var layout = new QVBoxLayout();

    // -- cursor frame readout ----------------------------------------
    try {
        w.frameLabel = new QLabel(qsTr("Cursor:  --"));
        layout.addWidget(w.frameLabel, 0, 0);
    } catch (eFrame) {
        w.problems.push("cursor frame readout (" + eFrame + ")");
    }

    // -- search ------------------------------------------------------
    try {
        w.searchEdit = new QLineEdit("");
        w.searchEdit.toolTip = qsTr("Filter by name. Both names are " +
            "searched -- \"gour\" finds the rimstone dam as surely as " +
            "\"rimstone\" does.");
        try {
            w.searchEdit.placeholderText = qsTr("Search symbols");
        } catch (ePlace) {
        }
        w.searchEdit.textChanged.connect(function(text) {
            try {
                SymbolPalette.scheduleFilter();
            } catch (eFilter) {
                // never throw out of a signal handler
            }
        });
        // ENTER ARMS what the search narrowed to -- the keyboard route
        // into a palette of thirty-odd symbols, and Feature Trace's
        // twin of the same thing. Only when ONE tile is left: arming
        // the first of four matches is a coin flip dressed as a
        // shortcut, and nothing on screen would say which it picked.
        try {
            w.searchEdit.returnPressed.connect(function() {
                try {
                    // The tiles Return reads must be the tiles for the
                    // text in the box, not the ones a debounce has not
                    // caught up with yet -- armFiltered arms the ONE
                    // tile left showing, so a stale set is a shortcut
                    // that arms the wrong symbol.
                    SymbolPalette.flushFilter();
                    SymbolPalette.armFiltered();
                } catch (eArm) {
                }
            });
        } catch (eReturn) {
            w.problems.push("search box Return (" + eReturn + ")");
        }
        layout.addWidget(w.searchEdit, 0, 0);
    } catch (eSearchBox) {
        w.problems.push("search box (" + eSearchBox + ")");
    }

    // -- a place to say the template could not be read ---------------
    try {
        w.problemLabel = new QLabel("");
        w.problemLabel.wordWrap = true;
        w.problemLabel.visible = false;
        layout.addWidget(w.problemLabel, 0, 0);
    } catch (eProblem) {
        w.problems.push("problem label (" + eProblem + ")");
    }

    // -- what you have been using ------------------------------------
    //
    // ABOVE the categories and outside the foldable stack, and above the
    // scroll area rather than inside it: the whole point is that it is
    // there without scrolling or unfolding.
    try {
        w.recentLabel = new QLabel(qsTr("Recent"));
        w.recentLabel.visible = false;
        layout.addWidget(w.recentLabel, 0, 0);
        w.recentRow = new QHBoxLayout();
        try {
            w.recentRow.setContentsMargins(4, 0, 4, 2);
            w.recentRow.setSpacing(4);
        } catch (eMargins) {
        }
        layout.addLayout(w.recentRow, 0);
    } catch (eRecent) {
        w.problems.push("recent row (" + eRecent + ")");
    }

    // -- the tiles, in a scroll area ---------------------------------
    //
    // Scrolling and not a taller dock: 28 symbols in nine categories is
    // longer than any screen, and a panel whose bottom half cannot be
    // reached hides exactly the symbols nobody remembers the names of.
    try {
        w.tileHost = new QWidget();
        w.tileLayout = new QVBoxLayout();
        w.tileHost.setLayout(w.tileLayout);
        var scroll = new QScrollArea();
        scroll.setWidget(w.tileHost);
        scroll.setWidgetResizable(true);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        w.problems.push("symbol area (" + eScroll + ")");
    }

    // -- the caver's own symbols -------------------------------------
    try {
        var custom = new QHBoxLayout();
        w.newButton = new QPushButton(qsTr("New Symbol..."));
        w.newButton.toolTip = qsTr("Draw a symbol of your own. Opens a " +
            "drawing to draw it in; saving adds it to this palette and to " +
            "the cave template.");
        w.newButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.startNew();
            } catch (eNew) {
                EAction.handleUserWarning("Symbol Palette: could not open the symbol " +
                    "editor (" + eNew + ").");
            }
        });
        custom.addWidget(w.newButton, 1, 0);

        w.editButton = new QPushButton(qsTr("Edit"));
        w.editButton.enabled = false;
        w.editButton.toolTip = qsTr("Reopen your own symbol to change it. " +
            "The symbols the suite ships cannot be edited -- an edited " +
            "copy would be replaced by the next CaveCAD update.");
        w.editButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.startEdit(SymbolPalette.armed);
            } catch (eEdit) {
                EAction.handleUserWarning("Symbol Palette: could not open that symbol (" +
                    eEdit + ").");
            }
        });
        custom.addWidget(w.editButton, 0, 0);

        w.deleteButton = new QPushButton(qsTr("Delete"));
        w.deleteButton.enabled = false;
        w.deleteButton.toolTip = qsTr("Remove your own symbol from the " +
            "template. Drawings that already use it keep their own copy.");
        w.deleteButton.clicked.connect(function() {
            try {
                SymbolPalette.deleteArmed();
            } catch (eDel) {
                EAction.handleUserWarning("Symbol Palette: could not delete that symbol (" +
                    eDel + ").");
            }
        });
        custom.addWidget(w.deleteButton, 0, 0);
        layout.addLayout(custom, 0);
    } catch (eCustom) {
        w.problems.push("custom symbol buttons (" + eCustom + ")");
    }

    // -- the editor row ----------------------------------------------
    //
    // BUILT ONCE AND HIDDEN, never created on demand. Widgets made
    // while the panel is already live are the shape this bridge is
    // least reliable about, and an editor whose Save button failed to
    // construct would strand a caver with a drawing and no way to keep
    // it.
    try {
        w.editorLabel = new QLabel("");
        w.editorLabel.wordWrap = true;
        w.editorLabel.visible = false;
        layout.addWidget(w.editorLabel, 0, 0);

        var editorRow = new QHBoxLayout();
        w.saveSymbolButton = new QPushButton(qsTr("Save Symbol"));
        w.saveSymbolButton.toolTip = qsTr("Write what is in the symbol " +
            "editor into the cave template, and add it to this palette.");
        w.saveSymbolButton.visible = false;
        w.saveSymbolButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.save();
            } catch (eSave) {
                EAction.handleUserWarning("Symbol Palette: the symbol could not be saved (" +
                    eSave + ").");
            }
        });
        editorRow.addWidget(w.saveSymbolButton, 1, 0);

        w.cancelSymbolButton = new QPushButton(qsTr("Cancel"));
        w.cancelSymbolButton.toolTip = qsTr("Stop editing. The drawing " +
            "stays open -- nothing you drew is thrown away.");
        w.cancelSymbolButton.visible = false;
        w.cancelSymbolButton.clicked.connect(function() {
            try {
                SymbolPaletteEdit.cancel();
            } catch (eCancel) {
            }
        });
        editorRow.addWidget(w.cancelSymbolButton, 0, 0);
        layout.addLayout(editorRow, 0);
    } catch (eEditor) {
        w.problems.push("editor row (" + eEditor + ")");
    }

    body.setLayout(layout);
    SymbolPalette.widgets = w;

    try {
        SymbolPalette.rebuildRecent();
    } catch (eRecentFill) {
        w.problems.push("recent row fill (" + eRecentFill + ")");
    }

    try {
        SymbolPalette.rebuildTiles();
    } catch (eBuild) {
        w.problems.push("symbol tiles (" + eBuild + ")");
    }

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build refused part of the " +
            "panel -- " + w.problems.join("; ") + ". Please report this.");
    }
    return body;
};

// NO DOCK OF ITS OWN. The body goes into the Draw panel's "Symbols"
// section and nowhere else: `widgets` is module-level, so a second
// copy of this body would leave one of the two wired to nothing.

/** Deletes the armed custom symbol, after asking. */
SymbolPalette.deleteArmed = function() {
    var entry = SymbolPalette.armed;
    if (isNull(entry) || entry.custom !== true) {
        return;
    }
    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(), qsTr("Delete Symbol"),
        qsTr("Remove %1 from the cave template?\n\nDrawings that already " +
            "use it keep their own copy of the symbol; new drawings will " +
            "not have it.").arg(entry.nss),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var res = CsSymbolStore.deleteBlock(null, entry.block);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Delete Symbol"), res.error);
        return;
    }
    SymbolPalette.disarm();
    SymbolPalette.rebuildTiles();
};

/**
 * Shows the Save Symbol / Cancel row and says what is being edited.
 *
 * The tiles stay where they are rather than being swapped out: a caver
 * drawing a new drip symbol is helped by seeing the drip symbols that
 * already exist, and a panel that empties itself mid-task looks broken.
 */
SymbolPalette.enterEditorMode = function(message) {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.text = message;
            w.editorLabel.visible = true;
        }
        if (!isNull(w.saveSymbolButton)) {
            w.saveSymbolButton.visible = true;
        }
        if (!isNull(w.cancelSymbolButton)) {
            w.cancelSymbolButton.visible = true;
        }
        if (!isNull(w.newButton)) {
            w.newButton.enabled = false;
        }
    } catch (e) {
    }
    try {
        // The dock has to be VISIBLE for its Save button to be pressable,
        // and New Symbol can be reached from a panel the caver then hides.
        var dock = SymbolPalette.ensureDock();
        dock.visible = true;
    } catch (eShow) {
    }
};

/** Puts the panel back into placing mode. */
SymbolPalette.leaveEditorMode = function() {
    var w = SymbolPalette.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.visible = false;
        }
        if (!isNull(w.saveSymbolButton)) {
            w.saveSymbolButton.visible = false;
        }
        if (!isNull(w.cancelSymbolButton)) {
            w.cancelSymbolButton.visible = false;
        }
        if (!isNull(w.newButton)) {
            w.newButton.enabled = true;
        }
    } catch (e) {
    }
};


/**
 * Hands control to the placement action.
 *
 * Looks the action up by script file and passes it in, rather than
 * constructing with null: stock Print.js does exactly this, and
 * EAction's null-guiAction paths are not exercised anywhere.
 */
SymbolPalette.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    // If a placement is ALREADY the current action, leave it running:
    // arm() has changed the symbol and the next click picks it up.
    // Calling setCurrentAction again would make QCAD tear down the
    // action running this very click -- a hard SIGSEGV, and one this
    // suite has already paid for once.
    //
    // BY SCRIPT FILE, NOT instanceof. QCAD builds every action in its
    // OWN script context, and what a panel sees through
    // getCurrentAction is an RActionAdapter -- not the JS object, and
    // never an instance of anything this file can name. `instanceof`
    // is therefore always false here, which makes the guard above
    // permanently inert (measured through the live bridge,
    // 2026-09-06). The action's own gui action still knows which file
    // it came from, and that is a fact both contexts share.
    var runPath = SymbolPalette.basePath + "/SymbolPaletteRun.js";
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.length > 0 &&
                    file.indexOf("SymbolPaletteRun.js") !== -1) {
                return;
            }
        }
    } catch (e) {
        // no readable current action; starting one is the safe answer
    }
    var runAction = RGuiAction.getByScriptFile(runPath);
    di.setCurrentAction(new SymbolPaletteRun(runAction));
};

SymbolPalette.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocks(EAction.getDocument(), "Symbol Palette")) {
        this.terminate();
        return;
    }

    // Opens the Draw panel with the Symbols section unfolded. NOT a
    // toggle: somebody who typed "symbolpalette" wants a symbol.
    try {
        DrawPanel.reveal(DrawPanel.SEC_SYMBOLS);
        // The template may have gained or lost a symbol since last
        // time -- another CaveCAD window, or a release.
        CsSymbolStore.invalidate();
        SymbolPalette.rebuildTiles();
    } catch (e) {
        EAction.handleUserWarning("Symbol Palette: this CaveCAD build refused the Draw " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

SymbolPalette.init = function(basePath) {
    SymbolPalette.basePath = basePath;

    var action = new RGuiAction(qsTr("Symbol Palette"),
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
    action.setScriptFile(basePath + "/SymbolPalette.js");
    action.setIcon(basePath + "/SymbolPalette.svg");
    action.setStatusTip(qsTr("Place cave symbols from a palette: pick one, " +
        "click to drop it, drag to aim it"));
    // "sym" belongs to the Draw panel now; the long name still
    // reaches this one.
    action.setDefaultCommands(["symbolpalette"]);
    // 452 is "draw the map", beside Feature Trace, Shaped Lines,
    // Scatter Breakdown and Cross Section; 50 puts it after Cross
    // Section, which is the last of them.
    action.setGroupSortOrder(452);
    action.setSortOrder(50);
    // NOT ON THE MENU -- see FeatureTrace.init. Draw is the one door.
    action.setWidgetNames([]);

    SymbolPaletteRun.init(basePath);
    SymbolPaletteEdit.init(basePath);

    // The DOCK is Draw's to build, during add-on init, so that
    // restoreState() can place it. Nothing to do here.
};
