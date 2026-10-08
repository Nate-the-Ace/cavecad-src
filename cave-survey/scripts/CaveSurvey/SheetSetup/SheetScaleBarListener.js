// SheetScaleBarListener.js -- keeps a sheet's scale bar on its viewport's
// scale while the caver changes that scale by ANY means: the scale list, a
// zoom inside the viewport, a typed value in the property editor, a script,
// undo or redo.
//
// A THIN DISPATCHER, structurally identical to AreaFillListener: it owns the
// busy flag, the cheap per-object gate and QCAD's transaction signal. The
// decision (is the bar still right? redraw it where it stands) lives in
// Core/CsScaleBar.js, which tests call directly.
//
//  1. RECURSION -- the busy flag, and CsScaleBar.sync itself is a no-op
//     (no write) when the bar already shows the viewport's scale.
//  2. COST -- only objects the transaction names are looked at, and only
//     viewports among them; every other transaction pays one queryEntity
//     per affected object.
//  3. A FREED RDocument cannot be detected: the document is used
//     synchronously and never stored.
//  4. UNDO -- an edit that has a transaction group has its redraw JOINED to
//     it, so one Ctrl+Z takes the scale change and the bar together. An edit
//     with NO group, and any transaction that is itself an undo or a redo,
//     gets a NON-undoable redraw: a separate undoable step would strand the
//     bar on undo, or throw the redo history away. Undo and redo of the
//     scale change re-sync the bar, so it always matches.
//
// Not a menu tool. Installed once from CaveSurvey.js.

function SheetScaleBarListener() {}

SheetScaleBarListener.installed = false;
SheetScaleBarListener.busy = false;

SheetScaleBarListener.install = function() {
    if (SheetScaleBarListener.installed) {
        return false;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return false;   // headless: no window to listen to
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(SheetScaleBarListener.onTransaction);
    } catch (e) {
        return false;   // the bar then needs CsScaleBar.syncAll by hand
    }
    SheetScaleBarListener.installed = true;
    return true;
};

SheetScaleBarListener.onTransaction = function(document, transaction) {
    if (SheetScaleBarListener.busy || isNull(document) || isNull(transaction)) {
        return;
    }
    var objIds;
    try {
        objIds = transaction.getAffectedObjects();
    } catch (e) {
        return;
    }
    var viewports = [];
    for (var i = 0; i < objIds.length; i++) {
        var e2 = document.queryEntity(objIds[i]);
        if (!isNull(e2) && typeof e2.getType === "function" && e2.getType() === RS.EntityViewport &&
                !e2.isOverall() && !e2.isUndone()) {
            viewports.push(e2);
        }
        else if (!isNull(e2) && typeof e2.getType === "function" && e2.getType() === RS.EntityBlockRef &&
                !e2.isUndone() && CsNorth.onArrowLayer(document, e2)) {
            // a north arrow placed (or moved) on a layout: its viewport tells it which way north is
            var p = e2.getPosition();
            var owner = CsNorth.viewportFor(document, e2.getBlockId(), p.x, p.y);
            if (!isNull(owner)) {
                viewports.push(owner);
            }
        }
    }
    if (viewports.length === 0) {
        return;   // the common case
    }
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
    var group = -1, quiet = false;
    try {
        group = transaction.getGroup();
        quiet = transaction.isUndoing() || transaction.isRedoing();
    } catch (eG) {
        group = -1;
    }
    // A change that belongs to no transaction group (a scale picked from the
    // list, a typed value) cannot be joined: its redraw would be a separate
    // undo step, and undoing THAT alone leaves the scale changed and the bar
    // gone (seen live 2026-10-05). So it is made non-undoable instead, and
    // every undo / redo of the change re-syncs the bar quietly (above).
    if (group < 0) {
        quiet = true;
    }
    SheetScaleBarListener.busy = true;
    try {
        for (var v = 0; v < viewports.length; v++) {
            try {
                CsScaleBar.sync(current, di, viewports[v], group, quiet);
                CsNorth.sync(current, di, viewports[v], group, quiet);
            } catch (eOne) {
                // one broken bar must not stop the others, nor surface as a dialog mid-drag
            }
        }
    } finally {
        SheetScaleBarListener.busy = false;
    }
};
