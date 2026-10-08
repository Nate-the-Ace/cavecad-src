// AreaFill.js -- Area Fill: the menu entry and the docked panel that
// arms which cave-floor pattern the next stroke encloses.
//
// The stroke itself (press, drag, release -> a boundary and its fill,
// one transaction) lives in AreaFillRun.js beside this file; the
// listener that keeps a fill in step with its boundary lives in
// AreaFillListener.js. QCAD cannot find either on its own -- init()
// below registers both, the same shape SymbolPalette.js registers
// SymbolPaletteRun.js and SymbolPaletteEdit.js.
//
// Panel shape follows SymbolPalette's own dock, including the two
// details that are load-bearing rather than stylistic: this file
// supplies a BODY ONLY, into the Draw panel's third section -- never a
// dock of its own -- and every widget construction and connect is
// wrapped so a bridge refusal costs one control, never the section.
// `widgets` is module-level for the same reason SymbolPalette's is: a
// second copy of this body would leave one of the two wired to
// nothing, a panel that looks right and does nothing when clicked.
//
// WHAT THE PANEL IS FOR. CsArea.CATALOG has known the suite's thirteen
// area patterns since Task 2 -- Blocks, Sump, Flowstone and the rest --
// and CsArea.build/CsArea.regenerate (Tasks 5 and 7) have known how to
// draw and rebuild every one of them. Nothing before this task could
// ARM one: AreaFillRun.armed is read at every stroke's release and had
// no writer. This is the front door -- one tile per pattern, a picture
// of what it actually draws, one click to arm and a press-drag-release
// to enclose.

// AreaFillListener.js is NOT included here: CaveSurvey.js already
// includes it and calls AreaFillListener.install() directly (Task 7),
// independently of whether this panel ever builds -- an area's fill
// must keep following its boundary even with the Areas panel closed
// or this tool file missing entirely. See that file's own header.
include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/AreaFillRun.js");
include(includeBasePath + "/AreaFillEdit.js");

function AreaFill(guiAction) {
    EAction.call(this, guiAction);
}

AreaFill.prototype = new EAction();

/** The dock lives in DrawPanel; this is only the widgets THIS body
 *  owns. Module-level because there is one panel per application
 *  window -- see the file header. */
AreaFill.widgets = undefined;

/** The catalog's keys, in the order a caver should see them.
 *
 * NOT a `for (var key in CsArea.CATALOG)` walk. Every real engine this
 * suite has run on (including QtScript) enumerates a plain object's
 * string keys in insertion order, but that is a fact about engines and
 * not a promise of the language this file is written in -- and the
 * grouping SymbolPalette relies on ("the catalogue's order IS the
 * panel's order") is worth spelling out once here rather than betting
 * the tile order on an enumeration guarantee ES5 does not make. Kept in
 * the same order CsArea.CATALOG itself is written in.
 */
AreaFill.ORDER = ["BLOCKS", "DEBRIS", "PEBBLES", "SAND", "CLAY", "BEDROCK",
    "WATER", "SUMP", "FLOWSTONE", "MOONMILK", "GUANO", "ICE", "BONES"];

/** Tile icon size and cell size, in pixels. Sized like SymbolPalette's
 *  own tiles -- these sit two rows below Symbols in the same dock, and
 *  a caver's eye should not have to recalibrate between them. */
AreaFill.ICON = 30;
AreaFill.CELL_W = 84;
AreaFill.CELL_H = 76;
AreaFill.CELL_CHARS = 11;

/**
 * TILE COLUMNS. The approved mockup (Nathan, 2026-09-11, see
 * DrawPanel.js's header) puts two sections per row and lets a lone
 * section on the last row span the full width -- which is Areas'
 * normal position as the third section, but NOT its only possible one:
 * a caver can drag it into row 0 beside Trace or Symbols
 * (CsPanel.stackAdd's Move Up), landing it in a HALF-width cell instead.
 *
 * This bridge has no resizeEvent hook proven safe on a plain QWidget --
 * CsScanView.prototype.resizeEvent only works because that class
 * subclasses RGraphicsViewQt through QCAD's generated shell-class
 * dispatch (see that file's own header); nothing here establishes the
 * same dispatch exists for QWidget. What IS proven elsewhere in this
 * suite (CaveShelf.js, SketchScans.js) is a QTimer.singleShot(0, ...)
 * deferring a check to the next turn of the event loop, so
 * scheduleColumnCheck below uses that to read the tile host's actual
 * width shortly after this body is built and laid into its section --
 * a best-effort read, not a live resize handler: a caver who reorders
 * sections AFTER the checks below stop retrying sees no reflow.
 * Defaults to the full-width count, since a freshly built panel puts
 * Areas alone on row two.
 *
 * RETRIES rather than a single shot: a width of 0 (or anything under
 * COLUMN_CHECK_MIN_WIDTH) means layout has not run yet at that tick,
 * not that the section is somehow zero pixels wide, and giving up on
 * that reading permanently would leave a caver who moved Areas into a
 * half-width cell stuck with four columns crammed into half a dock for
 * the rest of the session. So an inconclusive read reschedules itself,
 * up to COLUMN_CHECK_MAX_TRIES times, before the full-width default is
 * accepted as final.
 *
 * TASK 13 MUST CHECK LIVE: build the panel, confirm the default
 * (full-width, four columns) tiles correctly, then use the section's
 * own right-click Move Up to put Areas beside Trace or Symbols in row
 * zero, reload the panel (close and reopen Draw, or restart CaveCAD)
 * and confirm the retried check catches the half-width case too. If it
 * does not -- if every one of COLUMN_CHECK_MAX_TRIES reads still comes
 * back under COLUMN_CHECK_MIN_WIDTH, or wrong once layout has clearly
 * finished -- the fallback is the full-width count, and this comment's
 * claim about "a best-effort read" is wrong until fixed.
 */
AreaFill.COLUMNS_HALF = 2;
AreaFill.COLUMNS_FULL = 4;
AreaFill.gridColumns = AreaFill.COLUMNS_FULL;

/** Below this pixel width, the tile host is judged to be in a
 *  half-width cell rather than spanning the full dock. Halfway between
 *  what two full CELL_W-wide tiles need and what four do -- there is no
 *  authoritative threshold to read off the bridge, so this is a guess,
 *  named so Task 13 knows exactly what to re-check if it guesses
 *  wrong. */
AreaFill.HALF_WIDTH_THRESHOLD = AreaFill.CELL_W * 3;

/** Below this pixel width, a read is not a real layout -- "absurdly
 *  small" in numbers: 20px is under a quarter of one tile's own
 *  CELL_W (84), and no cell this panel ever occupies is honestly that
 *  narrow. A read this low means the event loop has not laid the dock
 *  out yet, not that the section truly is 20px wide, so it is treated
 *  as inconclusive and retried rather than accepted. */
AreaFill.COLUMN_CHECK_MIN_WIDTH = 20;

/** How many times an inconclusive width read reschedules itself before
 *  the full-width default is accepted as final. 20 tries at the
 *  interval below is two seconds of retrying -- generous next to any
 *  layout pass this bridge has been measured taking, and cheap: each
 *  retry that finds nothing conclusive does exactly one property read
 *  and one comparison. */
AreaFill.COLUMN_CHECK_MAX_TRIES = 20;

/** Delay between retries, in milliseconds, after the first (which
 *  fires at 0 -- the next turn of the event loop, same as before this
 *  retry existed). Short enough that twenty of them do not make a
 *  caver wait to see the right column count, long enough not to spin
 *  the event loop pointlessly against a dock that plainly is not laid
 *  out yet. */
AreaFill.COLUMN_CHECK_RETRY_MS = 100;

/**
 * A label broken over lines, greedily, on spaces -- SymbolPalette's own
 * wrapLabel, copied rather than shared: both panels keep their small
 * pure helpers to themselves, the same way FeatureTrace and
 * SymbolPalette already do not share this one either.
 */
AreaFill.wrapLabel = function(text, budget) {
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
 * The custom patterns' own keys (CsSymbolStore.slugFor of the name a
 * caver gave it), sorted by that pattern's display name.
 *
 * SEPARATE FROM AreaFill.ORDER, deliberately: ORDER is the thirteen
 * shipped patterns in the fixed order Nathan chose for them, and a
 * caver's own patterns have no such curated order -- alphabetical is
 * the least surprising default, and the only one that does not shuffle
 * every time a new one is saved.
 */
AreaFill.customKeys = function() {
    var merged = CsArea.merged();
    var keys = [];
    for (var k in merged) {
        if (merged.hasOwnProperty(k) && merged[k].custom === true) {
            keys.push(k);
        }
    }
    keys.sort(function(a, b) {
        var an = merged[a].name, bn = merged[b].name;
        return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    return keys;
};

/** True when a catalog entry matches the panel's search text -- name or
 *  key, case-insensitively. Pure. */
AreaFill.matches = function(key, entry, needle) {
    if (isNull(needle) || String(needle).length === 0) {
        return true;
    }
    var n = String(needle).toLowerCase();
    if (String(entry.name).toLowerCase().indexOf(n) !== -1) {
        return true;
    }
    return String(key).toLowerCase().indexOf(n) !== -1;
};

/** The scale a stroke commits with -- the panel's spin box, or 1.0
 *  without a panel (AreaFillRun.scale's own fallback). */
AreaFill.scale = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.scaleBox)) {
        return 1.0;
    }
    try {
        var v = w.scaleBox.value;
        return (isNaN(v) || v <= 0) ? 1.0 : v;
    } catch (e) {
        return 1.0;
    }
};

/** The density a scatter stroke commits with. Meaningless for a filled
 *  pattern -- CsArea.buildHatch never reads opts.density -- so this is
 *  never disarmed to 1.0 for that case; the DISABLED spin box already
 *  says "this control does nothing right now" without this function
 *  having to lie about what is in it. */
AreaFill.density = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.densityBox)) {
        return 1.0;
    }
    try {
        var v = w.densityBox.value;
        return (isNaN(v) || v <= 0) ? 1.0 : v;
    } catch (e) {
        return 1.0;
    }
};

/** Density has nothing to thin out on a hatch -- disabled, not hidden,
 *  so its own tooltip can say why rather than the control simply not
 *  being there. */
AreaFill.refreshDensityEnabled = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.densityBox)) {
        return;
    }
    var entry = isNull(AreaFillRun.armed) ? null :
        CsArea.entryFor(AreaFillRun.armed);
    var filled = !isNull(entry) && entry.engine === "filled";
    try {
        w.densityBox.enabled = !filled;
    } catch (e) {
    }
};

/**
 * Arms a pattern and makes the panel show which tile is armed.
 *
 * Mirrors SymbolPalette.arm: the checked tile IS the indicator, because
 * AreaFillRun.armed is module state with no other window onto it.
 */
AreaFill.arm = function(key) {
    AreaFillRun.armed = key;
    var w = AreaFill.widgets;
    if (!isNull(w) && !isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = (w.buttons[i].key === key);
            } catch (e) {
                // a button the bridge refuses to write back is still
                // armed correctly; only its appearance is wrong
            }
        }
    }
    AreaFill.refreshDensityEnabled();
    AreaFill.refreshCustomButtons();
};

/** Clears the armed pattern and every checked tile. */
AreaFill.disarm = function() {
    AreaFillRun.armed = undefined;
    var w = AreaFill.widgets;
    if (!isNull(w) && !isNull(w.buttons)) {
        for (var i = 0; i < w.buttons.length; i++) {
            try {
                w.buttons[i].button.checked = false;
            } catch (e) {
            }
        }
    }
    AreaFill.refreshDensityEnabled();
    AreaFill.refreshCustomButtons();
};

/** The armed catalog entry (built-in or custom), or null when nothing
 *  is armed -- what Edit and Delete act on, the same way
 *  SymbolPalette.armed does for symbols. */
AreaFill.armedEntry = function() {
    if (isNull(AreaFillRun.armed)) {
        return null;
    }
    return CsArea.entryFor(AreaFillRun.armed);
};

/** Edit and Delete act on the armed pattern, and only a CUSTOM one --
 *  the thirteen shipped patterns are code and cannot be redrawn or
 *  removed. Mirrors SymbolPalette's own editButton/deleteButton gate. */
AreaFill.refreshCustomButtons = function() {
    var w = AreaFill.widgets;
    if (isNull(w)) {
        return;
    }
    var entry = AreaFill.armedEntry();
    var editable = !isNull(entry) && entry.custom === true;
    try {
        if (!isNull(w.editPatternButton)) {
            w.editPatternButton.enabled = editable;
        }
    } catch (e) {
    }
    try {
        if (!isNull(w.deletePatternButton)) {
            w.deletePatternButton.enabled = editable;
        }
    } catch (e2) {
    }
};

/**
 * Hands control to the placement action.
 *
 * BY SCRIPT FILE, not instanceof -- SymbolPalette.startRun's own header
 * has the measured reason (QCAD builds every action in its OWN script
 * context, so `instanceof` here is always false): if a fill stroke is
 * already the current action, arm() has changed the pattern and the
 * next stroke picks it up; calling setCurrentAction again would tear
 * down the action running THIS click.
 */
AreaFill.startRun = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var runPath = AreaFill.basePath + "/AreaFillRun.js";
    try {
        var current = di.getCurrentAction();
        if (!isNull(current)) {
            var file = String(current.getGuiAction().getScriptFile());
            if (file.length > 0 && file.indexOf("AreaFillRun.js") !== -1) {
                return;
            }
        }
    } catch (e) {
        // no readable current action; starting one is the safe answer
    }
    var runAction = RGuiAction.getByScriptFile(runPath);
    di.setCurrentAction(new AreaFillRun(runAction));
};

/** Deletes the armed custom pattern, after asking -- mirrors
 *  SymbolPalette.deleteArmed. Library only: a drawing already using the
 *  pattern keeps its own copy of the block, untouched. */
AreaFill.deleteArmed = function() {
    var entry = AreaFill.armedEntry();
    if (isNull(entry) || entry.custom !== true) {
        return;
    }
    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(), qsTr("Delete Pattern"),
        qsTr("Remove %1 from your symbol library?\n\nDrawings that " +
            "already use it keep their own copy of the pattern; new " +
            "fills will not have it.").arg(entry.name),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var res = CsSymbolStore.deleteAreaPattern(null, entry.blocks[0]);
    if (!res.ok) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Delete Pattern"), res.error);
        return;
    }
    try {
        CsTileArt.invalidateBlockShapes();
    } catch (eTile) {
    }
    AreaFill.disarm();
    AreaFill.rebuildTiles();
};

/**
 * Shows the editor's fields and the Save Pattern / Cancel row, fills
 * them from an existing entry when editing one, and says what is being
 * edited. Mirrors SymbolPalette.enterEditorMode -- the tiles stay put
 * rather than being swapped out, so a caver drawing a new pattern can
 * still see the ones that already exist.
 */
AreaFill.enterEditorMode = function(message, entry) {
    var w = AreaFill.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.text = message;
            w.editorLabel.visible = true;
        }
        if (!isNull(w.patternNameEdit)) {
            w.patternNameEdit.text = isNull(entry) ? "" : entry.name;
        }
        if (!isNull(w.patternHelpEdit)) {
            w.patternHelpEdit.text =
                (isNull(entry) || isNull(entry.help)) ? "" : entry.help;
        }
        if (!isNull(w.patternLayerCombo)) {
            var layers = AreaFillEdit.homeLayers();
            var want = isNull(entry) ? CsLayers.BREAKDOWN : entry.layer;
            for (var l = 0; l < layers.length; l++) {
                if (layers[l] === want) {
                    w.patternLayerCombo.currentIndex = l;
                    break;
                }
            }
        }
        if (!isNull(w.patternPlacementCombo)) {
            w.patternPlacementCombo.currentIndex =
                (!isNull(entry) && entry.engine === "tile") ? 1 : 0;
        }
        if (!isNull(w.patternDensityBox)) {
            w.patternDensityBox.value = isNull(entry) ? 30 : entry.density;
        }
        if (!isNull(w.patternScaleMinBox)) {
            w.patternScaleMinBox.value = isNull(entry) ? 0.8 : entry.scaleMin;
        }
        if (!isNull(w.patternScaleMaxBox)) {
            w.patternScaleMaxBox.value = isNull(entry) ? 1.2 : entry.scaleMax;
        }
        if (!isNull(w.patternRotateCombo)) {
            w.patternRotateCombo.currentIndex =
                (!isNull(entry) && entry.rotate === false) ? 1 : 0;
        }
        if (!isNull(w.editorFieldsHost)) {
            w.editorFieldsHost.visible = true;
        }
        if (!isNull(w.savePatternButton)) {
            w.savePatternButton.visible = true;
        }
        if (!isNull(w.cancelPatternButton)) {
            w.cancelPatternButton.visible = true;
        }
        if (!isNull(w.newPatternButton)) {
            w.newPatternButton.enabled = false;
        }
    } catch (e) {
    }
    try {
        // The dock has to be VISIBLE for Save Pattern to be pressable --
        // see SymbolPalette.enterEditorMode's own header.
        DrawPanel.reveal(DrawPanel.SEC_AREAS);
    } catch (eShow) {
    }
};

/** Puts the panel back into arming mode. */
AreaFill.leaveEditorMode = function() {
    var w = AreaFill.widgets;
    if (isNull(w)) {
        return;
    }
    try {
        if (!isNull(w.editorLabel)) {
            w.editorLabel.visible = false;
        }
        if (!isNull(w.editorFieldsHost)) {
            w.editorFieldsHost.visible = false;
        }
        if (!isNull(w.savePatternButton)) {
            w.savePatternButton.visible = false;
        }
        if (!isNull(w.cancelPatternButton)) {
            w.cancelPatternButton.visible = false;
        }
        if (!isNull(w.newPatternButton)) {
            w.newPatternButton.enabled = true;
        }
    } catch (e) {
    }
};

/**
 * Sets the selection-hint label to say what the NEXT tile click will do,
 * given the document's CURRENT selection -- review finding, 2026-09-12:
 * "the tile click is a coin flip a beginner cannot see coming." Blank
 * (and hidden) when nothing selected resolves to an area, so the panel
 * says nothing when there is nothing unusual to say; a selection that
 * DOES resolve to one or more areas gets a line naming how many and
 * what a tile does to them, in the same breath mentioning that Scale
 * and Density reach the same selection -- the only place on this panel
 * that fact is written down at all.
 *
 * SAFE TO CALL OFTEN: reading the selection and resolving it costs at
 * most one CsArea.areaScan document walk (only when the selection
 * contains a fill entity, not a boundary -- see CsArea.resolveSelection's
 * own header), never a write.
 */
AreaFill.refreshSelectionHint = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.selectionHint)) {
        return;
    }
    var text = "";
    try {
        var di = EAction.getDocumentInterface();
        var doc = isNull(di) ? null : di.getDocument();
        if (!isNull(doc) && doc.hasSelection()) {
            var boundaryIds = CsArea.resolveSelection(doc,
                doc.querySelectedEntities());
            if (boundaryIds.length > 0) {
                text = qsTr("%1 area%2 selected -- a tile repatterns " +
                    "them (Scale and Density apply to them too). Clear " +
                    "the selection to draw a new one.")
                    .arg(boundaryIds.length)
                    .arg(boundaryIds.length === 1 ? "" : "s");
            }
        }
    } catch (e) {
        text = "";   // no readable document/selection -- say nothing
    }
    try {
        w.selectionHint.text = text;
        w.selectionHint.visible = (String(text).length > 0);
    } catch (eSet) {
    }
};

/**
 * Wires AreaFill.refreshSelectionHint to QCAD's own live selection
 * signal, ONCE, so the hint tracks a selection made while the panel
 * already sits open and idle -- not just at the moments this file
 * already refreshes it by hand (panel build, Area Fill's own
 * beginEvent, after a repattern).
 *
 * THE SAME PROVEN IDIOM AreaFillListener.install ALREADY USES for
 * transactions, one class over: RSelectionListenerAdapter is
 * RTransactionListenerAdapter's sibling in the same generated wrapper
 * family, and QCAD's OWN shipped status bar
 * (scripts/Widgets/SelectionDisplay/SelectionDisplay.js) runs
 * `appWin.addSelectionListener(new RSelectionListenerAdapter())` on
 * every single session already -- this is not a guess at what the
 * bridge supports, it is the same mechanism already running live in
 * every CaveCAD window. The headless guard and try/catch degrade the
 * same way addTransactionListener's own install already does: WITHOUT
 * this listener (a build that refuses it, or a headless run with no
 * window at all), the hint still updates at every panel build, every
 * Area Fill command invocation, and after every repattern -- it only
 * loses the ability to notice a selection made while the panel sits
 * open and nothing else here happens to touch it. Degrade, never crash
 * the panel.
 */
AreaFill.installSelectionHintListener = function() {
    if (AreaFill.selectionListenerInstalled === true) {
        return;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addSelectionListener)) {
        return;   // headless: no window to listen to
    }
    try {
        AreaFill.selectionAdapter = new RSelectionListenerAdapter();
        appWin.addSelectionListener(AreaFill.selectionAdapter);
        AreaFill.selectionAdapter.selectionChanged.connect(
            AreaFill.refreshSelectionHint);
        AreaFill.selectionListenerInstalled = true;
    } catch (e) {
        // No live tracking -- see this function's own header for what
        // still keeps the hint honest without it.
    }
};

/**
 * Retags every area in the current selection to `key` and rebuilds its
 * fill -- the wrong-tile recovery this panel exists to offer (2026-09-12,
 * Nathan): before this, changing a drawn area's pattern meant deleting
 * its boundary and re-tracing the whole loop.
 *
 * THE SAME PATH the Scale and Density boxes reach a selected area
 * through, too -- see CsArea.repattern's own header. There is no second,
 * parallel write for "just change the scale of what's selected": passing
 * the CURRENTLY ARMED key back in does that (AreaPattern is rewritten to
 * the same value it already held; only Scale/Density actually move).
 *
 * Always ends by rebuilding the tile grid, whether or not anything was
 * actually repatterned -- see AreaFill.connectTile's own header on why
 * that, not this function's own return value, is what tells the caver
 * apart a repattern from an arm.
 */
AreaFill.repatternSelection = function(doc, di, boundaryIds, key) {
    var entry = CsArea.entryFor(key);
    var result = CsArea.repattern(doc, di, boundaryIds, key,
        { scale: AreaFill.scale(), density: AreaFill.density() });
    var name = isNull(entry) ? key : entry.name;
    if (result.count > 0) {
        EAction.handleUserMessage(qsTr("Repatterned %1 selected area%2 " +
            "to %3.").arg(result.count).arg(result.count === 1 ? "" : "s")
            .arg(name));
    } else {
        EAction.handleUserMessage(qsTr("Nothing in that selection is an " +
            "area -- select a boundary or its fill first."));
    }
    AreaFill.rebuildTiles();
    // The selection itself did not change, but rebuildTiles() just
    // re-read AreaFillRun.armed -- refresh the hint alongside it so the
    // two never show a stale combination of each other, in case the
    // live listener (AreaFill.installSelectionHintListener) is not
    // installed.
    AreaFill.refreshSelectionHint();
};

/**
 * Arms an entry and starts the placement action -- UNLESS the document
 * already has something selected that resolves to an existing area, in
 * which case the click REPATTERNS that selection instead and never arms
 * anything. Its own function so the closure captures ONE key, not the
 * loop variable.
 *
 * THE SAME BUTTON, TWO ACTS, TOLD APART BEFORE AND AFTER THE CLICK
 * (2026-09-12, one of the four decisions this task called out to make
 * explicitly; sharpened after review the same day -- see
 * AreaFill.refreshSelectionHint's own header). BEFORE: the selection
 * hint label, kept live by refreshSelectionHint, already says "N areas
 * selected -- a tile repatterns them" whenever this fork is actually
 * live, so a caver reads the mode off the panel before clicking anything
 * rather than discovering it from what just happened. AFTER: the
 * status message ("Repatterned N selected area(s) to X") is the
 * confirmation that it actually happened, in words an arm's "Press and
 * drag to enclose..." prompt never uses. A repattern never checks the
 * tile (rebuildTiles() at the end of repatternSelection restores
 * whatever WAS armed, or nothing, exactly as it was before the click --
 * Qt's own checkable-button click would otherwise leave this tile
 * looking armed even though nothing was armed), never starts a stroke,
 * and never changes the command prompt an arm would set. A caver who
 * wanted to arm a fresh stroke while an old selection was still live
 * had the hint telling them so before they clicked; Ctrl+Z still undoes
 * a mistaken repattern in one step regardless.
 */
AreaFill.connectTile = function(button, key) {
    button.clicked.connect(function() {
        var di = EAction.getDocumentInterface();
        var doc = isNull(di) ? null : di.getDocument();
        if (!isNull(doc) && doc.hasSelection()) {
            var boundaryIds = CsArea.resolveSelection(doc,
                doc.querySelectedEntities());
            if (boundaryIds.length > 0) {
                AreaFill.repatternSelection(doc, di, boundaryIds, key);
                return;
            }
        }
        AreaFill.arm(key);
        AreaFill.startRun();
    });
};

/**
 * One tile: a picture of the pattern from CsTileArt.iconOfFill, or --
 * when the bridge's painter refuses, or the pattern's own blocks are
 * not in this drawing's template -- a NAMED placeholder: the button
 * still exists, still arms the pattern, still says what it is. Only
 * the picture is missing.
 */
AreaFill.tileFor = function(key, entry) {
    var button = new QToolButton();
    button.text = AreaFill.wrapLabel(entry.name, AreaFill.CELL_CHARS);
    try {
        button.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
    } catch (eStyle) {
    }
    button.checkable = true;

    var detail = [];
    detail.push(entry.engine === "scatter" ?
        qsTr("Scatters picture elements across the boundary.") :
        qsTr("Fills the boundary as one region."));
    detail.push(entry.layer);
    // WHAT IT IS, not how it is drawn -- entry.help (CsArea.CATALOG's
    // own field, or a caver's own AreaHelp for a custom pattern) says
    // what a caver would tell another caver at the entrance; `detail`
    // above stays the mechanical half (engine, layer) it always was.
    // The two never repeat each other, so CsPanel.tipHtml's three parts
    // (bold name, help, grey detail) read as one description read top
    // to bottom rather than the same fact said three ways. A blank
    // help (a custom pattern saved with no description) is passed as
    // null, exactly the SymbolPalette convention CsPanel.tipHtml's own
    // header describes.
    var help = (isNull(entry.help) || entry.help === "") ?
        null : { means: entry.help };
    button.toolTip = CsPanel.tipHtml(entry.name, help, detail);

    var icon = null;
    try {
        icon = CsTileArt.iconOfFill(entry, AreaFill.ICON,
            CsTileArt.penForLayer(entry.layer));
    } catch (eIcon) {
        icon = null;
    }
    if (icon !== null) {
        try {
            button.icon = icon;
            button.iconSize = new QSize(AreaFill.ICON, AreaFill.ICON);
        } catch (eSet) {
            // a tile with no picture still says its name
        }
    }
    try {
        button.setFixedSize(AreaFill.CELL_W, AreaFill.CELL_H);
    } catch (eSize) {
    }
    AreaFill.connectTile(button, key);
    return button;
};

/**
 * Rebuilds the tile grid from the current search text.
 *
 * Tears the tile area down and builds it again, same reasoning as
 * SymbolPalette.rebuildTiles: nothing here can gain or lose a catalog
 * entry mid-session (CsArea.CATALOG is code, not a file a caver edits),
 * but the SEARCH can, and a hide-only filter would leave the same
 * number of live-but-invisible buttons behind on every keystroke.
 */
AreaFill.rebuildTiles = function() {
    var w = AreaFill.widgets;
    if (isNull(w) || isNull(w.tileGrid)) {
        return;
    }
    var armedKey = AreaFillRun.armed;

    try {
        for (var i = 0; i < w.tileWidgets.length; i++) {
            try {
                // Hidden BEFORE it is detached: setParent(null) makes a
                // widget a top-level window, and on a fullscreen macOS
                // CaveCAD a visible one flashes up as its own black
                // fullscreen space until deleteLater runs. See
                // SymbolPalette.rebuildTiles for the live report.
                w.tileWidgets[i].visible = false;
                w.tileWidgets[i].setParent(null);
                w.tileWidgets[i].deleteLater();
            } catch (eDel) {
            }
        }
    } catch (eClear) {
    }
    w.tileWidgets = [];
    w.buttons = [];

    var needle = "";
    try {
        needle = isNull(w.searchEdit) ? "" : String(w.searchEdit.text);
    } catch (eSearch) {
    }

    // The thirteen shipped patterns, in their curated order, followed by
    // every custom pattern a caver has drawn and saved of their own --
    // ONE grid, so a custom pattern reads as a full member of the
    // palette rather than a second-class list bolted underneath it.
    var keys = AreaFill.ORDER.concat(AreaFill.customKeys());
    var cell = 0;
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var entry = CsArea.entryFor(key);
        if (isNull(entry) || !AreaFill.matches(key, entry, needle)) {
            continue;
        }
        try {
            var button = AreaFill.tileFor(key, entry);
            w.tileGrid.addWidget(button,
                Math.floor(cell / AreaFill.gridColumns),
                cell % AreaFill.gridColumns);
            cell++;
            w.tileWidgets.push(button);
            w.buttons.push({ button: button, key: key });
            if (key === armedKey) {
                try {
                    button.checked = true;
                } catch (eRe) {
                }
            }
        } catch (eTile) {
            w.problems.push(key + " (" + eTile + ")");
        }
    }
    try {
        w.tileGrid.setColumnStretch(AreaFill.gridColumns, 1);
    } catch (eStretch) {
    }
    AreaFill.refreshDensityEnabled();
    AreaFill.refreshCustomButtons();
};

/** See AreaFill.COLUMNS_HALF's own header: a RETRIED deferred read of
 *  the tile host's width, the closest thing to a resize hook this
 *  panel has proof this bridge supports. Rebuilds the grid only if the
 *  measured width actually changes the column count from the default.
 *
 *  `tries` counts attempts ALREADY MADE, including this one -- so a
 *  fresh call (from buildBody) passes nothing, and a rescheduled retry
 *  passes tries + 1. Read that way rather than a countdown so the
 *  "give up" comparison (tries >= MAX_TRIES) reads as what it is: this
 *  was the last one. */
AreaFill.scheduleColumnCheck = function(tries) {
    if (typeof QTimer === "undefined") {
        return;
    }
    var attempt = isNull(tries) ? 1 : tries;
    try {
        var w = AreaFill.widgets;
        var timer = new QTimer(RMainWindowQt.getMainWindow());
        timer.singleShot = true;
        timer.timeout.connect(function() {
            try {
                if (isNull(w) || isNull(w.tileHost)) {
                    return;
                }
                var width = w.tileHost.width;
                var conclusive = !isNaN(width) &&
                    width >= AreaFill.COLUMN_CHECK_MIN_WIDTH;
                if (!conclusive) {
                    // Not laid out yet at this tick -- NOT "genuinely
                    // narrow": see COLUMN_CHECK_MIN_WIDTH's own header.
                    // Retry rather than accept this reading as final,
                    // up to the try limit; a caver who reordered Areas
                    // into a half-width cell must not be stuck at four
                    // columns for the rest of the session because one
                    // early tick read back 0.
                    if (attempt < AreaFill.COLUMN_CHECK_MAX_TRIES) {
                        AreaFill.scheduleColumnCheck(attempt + 1);
                    }
                    return;
                }
                var wide = width >= AreaFill.HALF_WIDTH_THRESHOLD;
                var columns = wide ? AreaFill.COLUMNS_FULL :
                    AreaFill.COLUMNS_HALF;
                if (columns !== AreaFill.gridColumns) {
                    AreaFill.gridColumns = columns;
                    AreaFill.rebuildTiles();
                }
            } catch (eCheck) {
            }
        });
        // The FIRST attempt fires at 0 (the next turn of the event
        // loop, unchanged from before this retry existed); every retry
        // after it waits COLUMN_CHECK_RETRY_MS, so twenty retries do
        // not mean twenty back-to-back ticks fighting the layout pass
        // that has not finished yet.
        timer.start(attempt <= 1 ? 0 : AreaFill.COLUMN_CHECK_RETRY_MS);
    } catch (eTimer) {
        // no timer -- the default column count stands for the session
    }
};

/** THE PANEL'S BODY, separated from its dock -- see SymbolPalette's own
 *  buildBody for why. */
AreaFill.buildBody = function(parent) {
    var w = { problems: [], buttons: [], tileWidgets: [] };
    var body = new QWidget(parent);
    var layout = new QVBoxLayout();

    // -- search --------------------------------------------------------
    try {
        w.searchEdit = new QLineEdit("");
        w.searchEdit.toolTip = qsTr("Filter the patterns by name.");
        try {
            w.searchEdit.placeholderText = qsTr("Search patterns");
        } catch (ePlace) {
        }
        w.searchEdit.textChanged.connect(function(text) {
            try {
                AreaFill.rebuildTiles();
            } catch (eFilter) {
            }
        });
        layout.addWidget(w.searchEdit, 0, 0);
    } catch (eSearchBox) {
        w.problems.push("search box (" + eSearchBox + ")");
    }

    // -- the selection hint ----------------------------------------------
    //
    // SAYS WHAT THE NEXT TILE CLICK WILL DO, before it happens (review
    // finding, 2026-09-12). Without this, a caver who just drew an area
    // (or clicked one to inspect it) and then clicks a DIFFERENT tile
    // meaning "start a new stroke" silently gets the SELECTED area
    // repatterned instead -- AreaFill.connectTile's own fork is real and
    // a beginner cannot see it coming. This label turns that fork into a
    // visible mode instead of an after-the-fact status message, and
    // doubles as the only UI surface that says "Scale/Density apply to
    // a selected area too" -- otherwise nothing on the panel hints that
    // path exists at all.
    try {
        w.selectionHint = new QLabel("");
        w.selectionHint.wordWrap = true;
        w.selectionHint.visible = false;
        layout.addWidget(w.selectionHint, 0, 0);
    } catch (eHint) {
        w.problems.push("selection hint (" + eHint + ")");
    }

    // -- scale and density ----------------------------------------------
    //
    // FEET-LIKE, NOT A RAW OP: both are multipliers CsArea.placements
    // applies to its own scaleMin/scaleMax and density numbers, so 1.0
    // always means "the catalog's own look" whichever pattern is armed
    // -- the same reason SymbolPalette.sizeValue works in feet rather
    // than a per-symbol multiplier.
    try {
        var controls = new QHBoxLayout();
        try {
            var scaleLabel = new QLabel(qsTr("Scale"));
            controls.addWidget(scaleLabel, 0, 0);
        } catch (eScaleLabel) {
        }
        w.scaleBox = new QDoubleSpinBox();
        w.scaleBox.toolTip = qsTr("How large each placed element is, " +
            "relative to the pattern's own size. 1.0 is the catalog's " +
            "own look.");
        try {
            w.scaleBox.setRange(0.25, 4.0);
            w.scaleBox.setSingleStep(0.25);
            w.scaleBox.setDecimals(2);
            w.scaleBox.setValue(1.0);
        } catch (eScaleSetup) {
        }
        controls.addWidget(w.scaleBox, 0, 0);

        try {
            var densityLabel = new QLabel(qsTr("Density"));
            controls.addWidget(densityLabel, 0, 0);
        } catch (eDensityLabel) {
        }
        w.densityBox = new QDoubleSpinBox();
        w.densityBox.toolTip = qsTr("How many elements a scatter places, " +
            "relative to the catalog's own density. Disabled for a " +
            "filled pattern -- a hatch has no scattered elements to " +
            "thin out.");
        try {
            // The floor is CsArea.DENSITY_FLOOR, not a second literal
            // 0.1 -- see that constant's own header: CsArea.
            // suggestedDensityMul clamps a "thin it" suggestion to the
            // exact same number, and the two must never drift apart.
            w.densityBox.setRange(CsArea.DENSITY_FLOOR, 5.0);
            w.densityBox.setSingleStep(0.1);
            w.densityBox.setDecimals(2);
            w.densityBox.setValue(1.0);
        } catch (eDensitySetup) {
        }
        controls.addWidget(w.densityBox, 0, 0);
        controls.addStretch(1);
        layout.addLayout(controls, 0);
    } catch (eControls) {
        w.problems.push("scale/density controls (" + eControls + ")");
    }

    // -- the tiles, in a scroll area -------------------------------------
    try {
        w.tileHost = new QWidget();
        w.tileGrid = new QGridLayout();
        w.tileHost.setLayout(w.tileGrid);
        try {
            w.tileGrid.setContentsMargins(2, 2, 2, 2);
        } catch (eMargins) {
        }
        var scroll = new QScrollArea();
        scroll.setWidget(w.tileHost);
        scroll.setWidgetResizable(true);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        w.problems.push("pattern area (" + eScroll + ")");
    }

    // -- the caver's own patterns -----------------------------------------
    //
    // Same shape as SymbolPalette's New Symbol / Edit / Delete row --
    // Task 11's whole point is that a caver who has drawn a symbol
    // already knows how to draw a pattern.
    try {
        var custom = new QHBoxLayout();
        w.newPatternButton = new QPushButton(qsTr("New Area Pattern..."));
        w.newPatternButton.toolTip = qsTr("Draw one element of your own. " +
            "Opens a drawing to draw it in; saving adds it to this " +
            "palette and to your symbol library.");
        w.newPatternButton.clicked.connect(function() {
            try {
                AreaFillEdit.startNew();
            } catch (eNew) {
                EAction.handleUserWarning("Area Fill: could not open the " +
                    "pattern editor (" + eNew + ").");
            }
        });
        custom.addWidget(w.newPatternButton, 1, 0);

        w.editPatternButton = new QPushButton(qsTr("Edit"));
        w.editPatternButton.enabled = false;
        w.editPatternButton.toolTip = qsTr("Reopen your own pattern to " +
            "change it. The patterns the suite ships cannot be edited.");
        w.editPatternButton.clicked.connect(function() {
            try {
                AreaFillEdit.startEdit(AreaFill.armedEntry());
            } catch (eEdit) {
                EAction.handleUserWarning("Area Fill: could not open that " +
                    "pattern (" + eEdit + ").");
            }
        });
        custom.addWidget(w.editPatternButton, 0, 0);

        w.deletePatternButton = new QPushButton(qsTr("Delete"));
        w.deletePatternButton.enabled = false;
        w.deletePatternButton.toolTip = qsTr("Remove your own pattern " +
            "from your symbol library. Drawings that already use it " +
            "keep their own copy.");
        w.deletePatternButton.clicked.connect(function() {
            try {
                AreaFill.deleteArmed();
            } catch (eDel) {
                EAction.handleUserWarning("Area Fill: could not delete " +
                    "that pattern (" + eDel + ").");
            }
        });
        custom.addWidget(w.deletePatternButton, 0, 0);
        layout.addLayout(custom, 0);
    } catch (eCustom) {
        w.problems.push("custom pattern buttons (" + eCustom + ")");
    }

    // -- the editor fields, built once and hidden -------------------------
    //
    // BUILT ONCE, never on demand -- see SymbolPaletteEdit's own header
    // on why widgets made while the panel is already live are the
    // riskiest shape this bridge has, and an editor whose Save button
    // failed to construct would strand a caver with a drawing and no
    // way to keep it.
    try {
        w.editorLabel = new QLabel("");
        w.editorLabel.wordWrap = true;
        w.editorLabel.visible = false;
        layout.addWidget(w.editorLabel, 0, 0);

        w.editorFieldsHost = new QWidget();
        // A GRID, not a QFormLayout: this bridge generates QFormLayout
        // WITHOUT addRow (probed live 2026-09-10 for Sheet Setup, and
        // proved again the hard way on 2026-09-12 -- the first build of
        // these fields threw on the first addRow, and because the whole
        // editor block sits in one try, the Areas SECTION vanished from
        // the Draw panel entirely). CsPanel.formGrid is the suite's own
        // answer and every other panel with fields on it already uses
        // it. Do not reach for QFormLayout here again.
        var fields = CsPanel.formGrid(1);
        var fieldRow = 0;
        function addField(label, widget) {
            fields.addWidget(new QLabel(label), fieldRow, 0);
            fields.addWidget(widget, fieldRow, 1);
            fieldRow++;
        }
        w.editorFieldsHost.setLayout(fields);
        w.editorFieldsHost.visible = false;

        w.patternNameEdit = new QLineEdit("");
        w.patternNameEdit.toolTip = qsTr("What this pattern is called.");
        addField(qsTr("Name"), w.patternNameEdit);

        // OPTIONAL, deliberately -- a pattern with a blank description
        // still saves and still gets a tooltip (AreaFill.tileFor just
        // has less to show). This is the one field a built-in's help
        // string has no equivalent slot for: CsArea.CATALOG's entries
        // are written in code, a caver's own pattern is described here.
        w.patternHelpEdit = new QLineEdit("");
        w.patternHelpEdit.toolTip = qsTr("A short line describing what " +
            "this pattern is, shown in its tile's tooltip. Optional.");
        addField(qsTr("What is it?"), w.patternHelpEdit);

        w.patternLayerCombo = new QComboBox();
        var homeLayers = AreaFillEdit.homeLayers();
        for (var hl = 0; hl < homeLayers.length; hl++) {
            w.patternLayerCombo.addItem(homeLayers[hl]);
        }
        w.patternLayerCombo.toolTip = qsTr("The layer this pattern's " +
            "elements are placed on. Its profile and section twins are " +
            "derived from this one.");
        addField(qsTr("Layer"), w.patternLayerCombo);

        w.patternPlacementCombo = new QComboBox();
        w.patternPlacementCombo.addItem(qsTr("Scattered"));
        w.patternPlacementCombo.addItem(qsTr("Tiled"));
        w.patternPlacementCombo.toolTip = qsTr("How this pattern's " +
            "elements are laid out inside a boundary.");
        addField(qsTr("Placement"), w.patternPlacementCombo);

        w.patternDensityBox = new QDoubleSpinBox();
        w.patternDensityBox.setRange(1, 500);
        w.patternDensityBox.setDecimals(0);
        w.patternDensityBox.setValue(30);
        w.patternDensityBox.toolTip = qsTr("The catalog's own density: " +
            "elements per 100 square drawing units at scale 1.");
        addField(qsTr("Default density"), w.patternDensityBox);

        w.patternScaleMinBox = new QDoubleSpinBox();
        w.patternScaleMinBox.setRange(0.1, 5.0);
        w.patternScaleMinBox.setSingleStep(0.05);
        w.patternScaleMinBox.setDecimals(2);
        w.patternScaleMinBox.setValue(0.8);
        w.patternScaleMinBox.toolTip = qsTr("The smallest an element is " +
            "drawn, relative to what you drew it at.");
        addField(qsTr("Scale jitter min"), w.patternScaleMinBox);

        w.patternScaleMaxBox = new QDoubleSpinBox();
        w.patternScaleMaxBox.setRange(0.1, 5.0);
        w.patternScaleMaxBox.setSingleStep(0.05);
        w.patternScaleMaxBox.setDecimals(2);
        w.patternScaleMaxBox.setValue(1.2);
        w.patternScaleMaxBox.toolTip = qsTr("The largest an element is " +
            "drawn, relative to what you drew it at.");
        addField(qsTr("Scale jitter max"), w.patternScaleMaxBox);

        w.patternRotateCombo = new QComboBox();
        w.patternRotateCombo.addItem(qsTr("Random"));
        w.patternRotateCombo.addItem(qsTr("Fixed"));
        w.patternRotateCombo.toolTip = qsTr("Random turns each placed " +
            "element to a different angle; Fixed always draws it the " +
            "way you drew it.");
        addField(qsTr("Rotation"), w.patternRotateCombo);

        layout.addWidget(w.editorFieldsHost, 0, 0);

        var editorRow = new QHBoxLayout();
        w.savePatternButton = new QPushButton(qsTr("Save Pattern"));
        w.savePatternButton.toolTip = qsTr("Write what is in the pattern " +
            "editor into your symbol library, and add it to this palette.");
        w.savePatternButton.visible = false;
        w.savePatternButton.clicked.connect(function() {
            try {
                AreaFillEdit.save();
            } catch (eSave) {
                EAction.handleUserWarning("Area Fill: the pattern could " +
                    "not be saved (" + eSave + ").");
            }
        });
        editorRow.addWidget(w.savePatternButton, 1, 0);

        w.cancelPatternButton = new QPushButton(qsTr("Cancel"));
        w.cancelPatternButton.toolTip = qsTr("Stop editing. The drawing " +
            "stays open -- nothing you drew is thrown away.");
        w.cancelPatternButton.visible = false;
        w.cancelPatternButton.clicked.connect(function() {
            try {
                AreaFillEdit.cancel();
            } catch (eCancel) {
            }
        });
        editorRow.addWidget(w.cancelPatternButton, 0, 0);
        layout.addLayout(editorRow, 0);
    } catch (eEditor) {
        w.problems.push("editor fields (" + eEditor + ")");
    }

    body.setLayout(layout);
    AreaFill.widgets = w;

    try {
        AreaFill.rebuildTiles();
    } catch (eBuild) {
        w.problems.push("pattern tiles (" + eBuild + ")");
    }

    try {
        AreaFill.scheduleColumnCheck();
    } catch (eColumns) {
        // the default column count stands for the session
    }

    // LIVE TRACKING, installed once, plus an immediate read so the hint
    // is never blank-by-default just because the panel happened to be
    // built after something was already selected.
    try {
        AreaFill.installSelectionHintListener();
    } catch (eListener) {
        // see AreaFill.installSelectionHintListener's own header --
        // degraded, not fatal
    }
    try {
        AreaFill.refreshSelectionHint();
    } catch (eHintInit) {
    }

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build refused " +
            "part of the panel -- " + w.problems.join("; ") +
            ". Please report this.");
    }
    return body;
};

// NO DOCK OF ITS OWN. The body goes into the Draw panel's "Areas"
// section and nowhere else -- see the file header.

AreaFill.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN -- see CsModelSpace's own
    // header; a sheet is rebuilt from the cave's record on every Build
    // Sheet, and a fill drawn on one would go with it, silently, weeks
    // later.
    if (CsModelSpace.blocks(EAction.getDocument(), "Area Fill")) {
        this.terminate();
        return;
    }

    try {
        DrawPanel.reveal(DrawPanel.SEC_AREAS);
    } catch (e) {
        EAction.handleUserWarning("Area Fill: this CaveCAD build refused " +
            "the Draw panel (" + e + ") -- please report this.");
    }

    // The "area" command is also a "panel shown" moment -- refresh the
    // hint here too, on top of the live listener, per the fallback this
    // task called for.
    try {
        AreaFill.refreshSelectionHint();
    } catch (eHint) {
    }

    this.terminate();
};

AreaFill.init = function(basePath) {
    AreaFill.basePath = basePath;

    var action = new RGuiAction(qsTr("Area Fill"),
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
    action.setScriptFile(basePath + "/AreaFill.js");
    action.setIcon(basePath + "/AreaFill.svg");
    action.setStatusTip(qsTr("Fill a cave-floor pattern: pick one, then " +
        "press and drag to enclose the area"));
    // "area" belongs to the Draw panel now, the same door "ft" and
    // "sym" already open for FeatureTrace and SymbolPalette.
    action.setDefaultCommands(["area"]);
    // 452 is "draw the map"; 60 puts it after Symbol Palette (50).
    action.setGroupSortOrder(452);
    action.setSortOrder(60);
    // NOT ON THE MENU -- Draw is the one door, same as FeatureTrace and
    // SymbolPalette.
    action.setWidgetNames([]);

    AreaFillRun.init(basePath);
    AreaFillEdit.init(basePath);

    // The DOCK is Draw's to build, during add-on init, so that
    // restoreState() can place it. Nothing to do here.
};
