// ShapedLinesListener.js -- keeps a shaped line's decoration on its
// spine while the caver edits with QCAD's OWN tools. Stretch the
// spine, drag a grip, rotate the selection: this hears the
// transaction and rebuilds the ticks or scallops.
//
// A structural clone of CalloutListener, because that file's shape is
// the survivor of every defect this pattern has produced. The same
// four hazards, handled the same ways:
//
//  1. RECURSION -- the busy flag, cleared in finally. And because a
//     queued signal can arrive after the flag clears, the REAL guard
//     is in CsShapeLine.decorate: an unchanged feature is a signature
//     compare and a return, never a write.
//  2. COST -- the gate reads XDATA only off objects the transaction
//     already touched. A drawing with no shaped lines pays one
//     queryEntity per affected object and nothing else.
//  3. A FREED RDocument cannot be detected and touching one
//     segfaults. The document argument is used synchronously and
//     never stored.
//  4. UNDO -- reconciliation joins the triggering edit's transaction
//     group, so one Ctrl+Z takes the caver's edit AND the reflow.
//
// Not a menu tool. Registers no RGuiAction. Installed once from
// CaveSurvey.js.

function ShapedLinesListener() {}

ShapedLinesListener.installed = false;

/** Re-entrancy guard. Also set by ShapedFlip/ShapedSync/ShapedLines
 *  around their own multi-operation writes, so the listener never
 *  reacts to a half-finished sequence of its own suite's making. */
ShapedLinesListener.busy = false;

ShapedLinesListener.install = function() {
    if (ShapedLinesListener.installed) {
        return false;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return false;   // headless: no window to listen to
    }
    var adapter;
    try {
        adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(ShapedLinesListener.onTransaction);
    } catch (e) {
        // Without the listener shaped lines still work; they just need
        // Sync Shaped Lines run by hand. Degrade, never crash startup.
        return false;
    }
    ShapedLinesListener.installed = true;
    return true;
};

/**
 * Every ShapeId touched by this transaction, or an empty object.
 * THE CHEAP GATE -- reads only objects the transaction names, and only
 * their XDATA.
 */
ShapedLinesListener.touchedIds = function(document, transaction) {
    var touched = {};
    var objIds;
    try {
        objIds = transaction.getAffectedObjects();
    } catch (e) {
        return touched;
    }
    for (var i = 0; i < objIds.length; i++) {
        var e = document.queryEntity(objIds[i]);
        if (isNull(e)) {
            continue;   // deleted, or not an entity
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid === "") {
            sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
        }
        if (sid !== "") {
            touched[sid] = true;
        }
    }
    return touched;
};

/**
 * Walls drawn while the switch is on, which this transaction created.
 *
 * A caver who turns Wall Edging on and then traces another passage
 * should not have to press it again -- the switch is a statement about
 * the drawing, not a one-off action.
 */
ShapedLinesListener.freshWalls = function(document, transaction) {
    var out = [];
    if (typeof WallEdging === "undefined") {
        return out;
    }
    try {
        if (!WallEdging.isOn(document)) {
            return out;
        }
    } catch (eOn) {
        return out;
    }
    var ids;
    try {
        ids = transaction.getAffectedObjects();
    } catch (eAff) {
        return out;
    }
    var wallLayer = document.getLayerId(CsLayers.WALLS_SURVEYED);
    if (wallLayer === RObject.INVALID_ID) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = document.queryEntity(ids[i]);
        if (isNull(e) || e.getLayerId() !== wallLayer) {
            continue;
        }
        if (typeof e.isUndone === "function" && e.isUndone()) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.STYLE) !== "") {
            continue;   // already dressed, by the switch or by hand
        }
        if (!CsShapeLine.isSupported(e)) {
            continue;
        }
        out.push(e.getId());
    }
    return out;
};

/**
 * Dresses one freshly drawn wall, from inside the transaction callback.
 *
 * NO BLOCK IMPORT FROM HERE. Importing a missing symbol means
 * CsSymbolStore.ensureBlock -> copyBlock, which issues several of its
 * OWN applyOperation calls -- nested writes from inside a transaction
 * listener, which CsArea.regenerate refuses to do for exactly this
 * reason and says so in a comment written after this suite got bitten.
 * So a drawing that has never placed the glyph block yet simply does
 * not auto-dress until the caver toggles the switch (or draws a glyph
 * some other way), which is a wall without ornament rather than a
 * reentrant write.
 */
ShapedLinesListener.dressFreshWall = function(doc, di, id, group, cache) {
    var spec = CsShapeLine.STYLES[WallEdging.STYLE];
    if (isNull(spec)) {
        return false;
    }
    var block = null;
    try {
        block = doc.queryBlock(spec.symbolDefault);
    } catch (eB) {
        block = null;
    }
    if (isNull(block)) {
        return false;   // see the note above: not from in here
    }
    var wall = doc.queryEntity(id);
    if (isNull(wall)) {
        return false;
    }
    return WallEdging.dressOne(doc, di, wall, group, cache);
};

ShapedLinesListener.onTransaction = function(document, transaction) {
    if (ShapedLinesListener.busy) {
        return;
    }
    if (isNull(document) || isNull(transaction)) {
        return;
    }

    var touched = ShapedLinesListener.touchedIds(document, transaction);
    var fresh = ShapedLinesListener.freshWalls(document, transaction);
    var any = fresh.length > 0;
    for (var probe in touched) {
        if (touched.hasOwnProperty(probe)) {
            any = true;
            break;
        }
    }
    if (!any) {
        return;   // the common case: nothing shaped was touched
    }

    // RDocument has NO getDocumentInterface in this build; the main
    // window is where a di comes from, and only when its current
    // document IS the one that changed (acting on another document
    // would resolve the ids against the wrong drawing).
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin)) {
        return;
    }
    var di = appWin.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var current = di.getDocument();
    if (isNull(current) || current.getFileName() !== document.getFileName()) {
        return;
    }

    var group = -1;
    try {
        group = transaction.getGroup();
    } catch (eG) {
        group = -1;
    }

    ShapedLinesListener.busy = true;
    var cache = {};
    try {
        for (var id in touched) {
            if (!touched.hasOwnProperty(id)) {
                continue;
            }
            try {
                // ONE station scan for the whole transaction, shared by
                // every wall it touches -- the side test runs per glyph
                // and a drag can touch several walls, so re-walking the
                // drawing for each would be a product.
                CsShapeLine.reconcile(current, di, id, group, cache);
            } catch (eOne) {
                // One broken feature must not stop the others, and must
                // never surface as a dialog mid-drag.
            }
        }
        for (var w = 0; w < fresh.length; w++) {
            try {
                ShapedLinesListener.dressFreshWall(current, di, fresh[w],
                    group, cache);
            } catch (eFresh) {
            }
        }
    } finally {
        ShapedLinesListener.busy = false;
    }
};
