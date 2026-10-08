// AreaFillListener.js -- keeps an area's fill on its boundary while the
// caver edits with QCAD's OWN tools. Stretch a grip, drag the whole
// loop, delete it outright: this hears the transaction and rebuilds
// (or removes) the scatter/hatch that boundary owns.
//
// A THIN DISPATCHER, structurally identical to ShapedLinesListener:
// this file owns the busy flag, the cheap per-object gate and QCAD's
// transaction signal, and nothing else. Every actual decision --
// finding a boundary, comparing a signature, clearing and rebuilding a
// fill, sweeping an orphan -- lives in Core/CsArea.js, the same split
// ShapedLinesListener keeps with CsShapeLine.reconcile. That is not
// style: Task 12's "Sync Areas" menu tool regenerates every area on
// demand and must be able to call CsArea.regenerate/CsArea.sweep
// directly, without including a file whose only other job is
// listening for live transactions it isn't one of.
//
// The same four hazards ShapedLinesListener/CalloutListener already
// solved, handled the same ways:
//
//  1. RECURSION -- the busy flag, cleared in finally. And because a
//     queued signal can arrive after the flag clears, the REAL guard
//     is in CsArea.regenerate: an unchanged boundary is a signature
//     compare and a return, never a write. See
//     tests/area_fill_run.js's own freeze test -- modelled directly on
//     CalloutWrite's no-op-reflow test -- for the regression this
//     actually closes: an unconditional clear+rebuild would fire
//     another transaction, which the busy flag catches SYNCHRONOUSLY,
//     but a signal queued before busy was set and delivered after it
//     cleared would not be, and this suite has already seen that lock
//     up CaveCAD once (see CalloutWrite.js).
//  2. COST -- the gate reads XDATA only off objects the transaction
//     already touched (touchedIds). A drawing with no AreaId/AreaOwner
//     tags anywhere pays one queryEntity per affected object and
//     nothing else -- CsArea.areaScan's full-document walk below never
//     runs unless that cheap gate already found something to do, and
//     CsArea.sweep only runs when a boundary was actually deleted this
//     transaction, not on every area-touching edit.
//  3. A FREED RDocument cannot be detected and touching one
//     segfaults. The document argument is used synchronously and
//     never stored.
//  4. UNDO -- reconciliation joins the triggering edit's transaction
//     group, so one Ctrl+Z takes the caver's edit AND the rebuild.
//
// NOT gated on DrawPanel.showing() the way FeatureTrace's own armed
// state is. That gate exists for a panel's OWN preview -- something
// with no reason to compute while nobody is looking at the dock that
// shows it. An area's fill is drawing content, not a panel preview: a
// script, a batch regeneration, or a caver with the Areas panel closed
// can still drag a boundary, and the fill must still follow it. The
// cost this accepts is the same one ShapedLinesListener and
// CalloutListener already accept for every transaction in every open
// document -- one queryEntity + one XDATA read per object the
// transaction actually touched, PLUS (only when that cheap gate found
// something) one CsArea.areaScan walk of the whole document, shared by
// every area this transaction touched rather than paid once per area.
//
// Not a menu tool. Registers no RGuiAction. Installed once from
// CaveSurvey.js.

function AreaFillListener() {}

AreaFillListener.installed = false;

/** Re-entrancy guard. See hazard 1 above. */
AreaFillListener.busy = false;

AreaFillListener.install = function() {
    if (AreaFillListener.installed) {
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
        adapter.transactionUpdated.connect(AreaFillListener.onTransaction);
    } catch (e) {
        // Without the listener an area's fill still works; it just
        // needs its own commit run again by hand. Degrade, never crash
        // startup.
        return false;
    }
    AreaFillListener.installed = true;
    return true;
};

/**
 * Every AreaId touched by this transaction, and whether any of them
 * was a boundary this same transaction deleted -- or the all-empty,
 * all-false shape when nothing area-related was touched at all.
 *
 * THE CHEAP GATE -- reads only objects the transaction names, and only
 * their XDATA. A drawing with no areas at all pays one queryEntity per
 * affected object and nothing else. A fill entity's OWNER tag counts
 * the same as a boundary's ID tag: either one names the area that
 * needs reconciling. The deletion flag costs nothing extra: it is read
 * off the very entity this loop already fetched to find the tag.
 *
 * \return {ids: {areaId: true, ...}, deletedBoundary: bool}
 */
AreaFillListener.touchedIds = function(document, transaction) {
    var touched = {};
    var deletedBoundary = false;
    var objIds;
    try {
        objIds = transaction.getAffectedObjects();
    } catch (e) {
        return { ids: touched, deletedBoundary: deletedBoundary };
    }
    for (var i = 0; i < objIds.length; i++) {
        var e = document.queryEntity(objIds[i]);
        if (isNull(e)) {
            continue;   // not an entity at all
        }
        var aid = CsTags.get(e, CsArea.ID_KEY);
        if (aid !== "") {
            touched[aid] = true;
            if (typeof e.isUndone === "function" && e.isUndone()) {
                deletedBoundary = true;
            }
            continue;
        }
        var oid = CsTags.get(e, CsArea.OWNER_KEY);
        if (oid !== "") {
            touched[oid] = true;
        }
    }
    return { ids: touched, deletedBoundary: deletedBoundary };
};

AreaFillListener.onTransaction = function(document, transaction) {
    if (AreaFillListener.busy) {
        return;
    }
    if (isNull(document) || isNull(transaction)) {
        return;
    }

    var touched = AreaFillListener.touchedIds(document, transaction);
    var any = false;
    for (var probe in touched.ids) {
        if (touched.ids.hasOwnProperty(probe)) {
            any = true;
            break;
        }
    }
    if (!any) {
        return;   // the common case: this transaction has no area in it
    }

    // RDocument has NO getDocumentInterface in this build; the main
    // window is where a di comes from, and only when its current
    // document IS the one that changed (acting on another document
    // would resolve ids against the wrong drawing).
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

    AreaFillListener.busy = true;
    try {
        // ONE walk of the document, shared by sweep and every touched
        // area's regenerate below -- see CsArea.areaScan's own header
        // for the cost this collapses.
        var scan = CsArea.areaScan(current);

        // Orphaned fill only when a boundary was actually deleted this
        // transaction -- an ordinary move or a tag edit never needs
        // the full orphan sweep, only the touched area's own rebuild.
        if (touched.deletedBoundary) {
            CsArea.sweep(current, di, group, scan);
        }

        for (var areaId in touched.ids) {
            if (!touched.ids.hasOwnProperty(areaId)) {
                continue;
            }
            try {
                var boundary = scan.boundaries[areaId];
                if (isNull(boundary)) {
                    continue;   // no boundary: sweep already handled it
                }
                CsArea.regenerate(current, di, boundary.getId(), group,
                    scan.owners[areaId]);
            } catch (eOne) {
                // One broken area must not stop the others, and must
                // never surface as a dialog mid-drag.
            }
        }
    } finally {
        AreaFillListener.busy = false;
    }
};
