/**
 * CalloutListener -- keeps a callout's arrows on its note while the
 * caver edits with QCAD's OWN tools.
 *
 * This is the reason the linked-pair design works at all. Because a
 * reflow never writes to the text, the native double-click editor, the
 * grips and the property editor all keep functioning; this listener is
 * what notices they were used and puts the arrows back.
 *
 * Not a menu tool. Registers no RGuiAction. Installed once from
 * CaveSurvey.js.
 *
 * THE FOUR THINGS THAT MAKE THIS DANGEROUS, each of which has a real
 * defect behind it somewhere in this suite's history:
 *
 *  1. RECURSION. A reflow writes a transaction, which fires this
 *     listener, which reflows... The busy flag is not optional, and it
 *     is cleared in a finally so an exception cannot leave the listener
 *     permanently deaf.
 *
 *  2. COST. This runs on EVERY transaction in the drawing -- every line
 *     drawn, every property changed. The gate reads XDATA off objects the
 *     transaction already touched and returns. It must never query the
 *     spatial index, collect stations, or resolve a network.
 *
 *  3. A FREED RDocument CANNOT BE DETECTED AND TOUCHING ONE SEGFAULTS
 *     (exit 139, not an exception, so try/catch buys nothing: RDocument
 *     is not a QObject and isNull()/isDeleted() both keep reporting
 *     false). The document argument is used SYNCHRONOUSLY inside the
 *     callback and never stored on the module, never captured in a
 *     closure that outlives the call.
 *
 *  4. UNDO. The reflow is applied with the same transaction group as the
 *     edit that triggered it, so one Ctrl+Z takes both. Without that, a
 *     caver's single text edit needs two undos and the tool reads as
 *     broken.
 */
function CalloutListener() {}

CalloutListener.installed = false;

/** Re-entrancy guard. See hazard 1 above. */
CalloutListener.busy = false;

/**
 * Install once. Safe to call again -- a second listener on the same
 * signal would reflow twice per edit and fight itself.
 */
CalloutListener.install = function() {
    if (CalloutListener.installed) {
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
        adapter.transactionUpdated.connect(CalloutListener.onTransaction);
    } catch (e) {
        // Without the listener callouts still work; they just need
        // CsCalloutSync run by hand. Degrade, never crash the startup
        // of the whole add-on.
        return false;
    }
    CalloutListener.installed = true;
    return true;
};

/**
 * Every callout id touched by this transaction, or an empty object.
 *
 * THE CHEAP GATE. Reads only objects the transaction names, and only
 * their XDATA. A drawing with no callouts pays one queryEntity per
 * affected object and nothing else.
 */
CalloutListener.touchedIds = function(document, transaction) {
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
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "") {
            touched[cid] = true;
        }
    }
    return touched;
};

CalloutListener.onTransaction = function(document, transaction) {
    if (CalloutListener.busy) {
        return;
    }
    if (isNull(document) || isNull(transaction)) {
        return;
    }

    var touched = CalloutListener.touchedIds(document, transaction);
    var any = false;
    for (var probe in touched) {
        if (touched.hasOwnProperty(probe)) {
            any = true;
            break;
        }
    }
    if (!any) {
        return;   // the common case: nothing to do with a callout
    }

    // The document interface comes from the main window, not from the
    // document: RDocument has NO getDocumentInterface in this build
    // (probed -- it is undefined, and an earlier draft of this file
    // assumed otherwise).
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin)) {
        return;
    }
    var di = appWin.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    // Only act when the window's current document IS the one that
    // changed. Otherwise the affected ids would be resolved against the
    // wrong drawing, where they may coincidentally name unrelated
    // entities -- and reflowing those would damage a document the caver
    // is not even looking at.
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

    CalloutListener.busy = true;
    try {
        for (var id in touched) {
            if (!touched.hasOwnProperty(id)) {
                continue;
            }
            try {
                CalloutListener.reconcile(current, di, id, group);
            } catch (eOne) {
                // One broken callout must not stop the others, and must
                // not surface as a dialog: this fires during the caver's
                // own edit, and a modal box mid-drag is worse than a
                // stale leader.
            }
        }
    } finally {
        CalloutListener.busy = false;
    }
};

/**
 * Bring one callout back into a consistent state.
 *
 * The two deletion cases are asymmetric ON PURPOSE:
 *
 *   text gone        -> the leaders are orphans. Delete them. An arrow
 *                       pointing at nothing is not information.
 *   last leader gone -> the TEXT SURVIVES, as ordinary text with its
 *                       callout tags stripped. A note without an arrow
 *                       is still a note, and deleting a caver's words
 *                       because they deleted an arrow would destroy work
 *                       they never asked to lose.
 *
 * Takes doc and di explicitly so it can be driven from a test; nothing
 * here reaches for the main window.
 */
CalloutListener.reconcile = function(doc, di, id, group) {
    var m = CalloutWrite.members(doc, id);

    // CONTENT, NOT TEXT. A cross section's content is a BLOCK
    // REFERENCE, not text -- CalloutWrite.contentOf exists for exactly
    // this, and applyReflow below already asks through it. This test
    // did not, so every sketched section looked like a note whose text
    // had been deleted, and the listener removed the leader Capture had
    // just written: block placed, leader silently gone, no message.
    // Confirmed in a caver's drawing -- the section block survived with
    // its CalloutId and no leader carried that id.
    if (CalloutWrite.contentOf(m) === null) {
        if (m.leaders.length === 0) {
            return "nothing";
        }
        var del = new RDeleteObjectsOperation();
        for (var i = 0; i < m.leaders.length; i++) {
            // ONE argument. deleteObject(entity, doc) prints
            // "Too many arguments, ignoring 1" -- every other caller in
            // this repo passes one.
            del.deleteObject(m.leaders[i]);
        }
        if (group !== null && group !== undefined && group >= 0) {
            del.setTransactionGroup(group);
        }
        di.applyOperation(del);
        return "orphans-removed";
    }

    if (m.leaders.length === 0) {
        // ONLY TEXT GETS UNLINKED. A note without an arrow is still a
        // note, so it keeps its words and loses its callout tags. A
        // SECTION without an arrow is still a section, and stripping
        // its tags would take SectionSource, SectionScan and the rest
        // with them -- the provenance Edit Sketch and regeneration both
        // read. It keeps everything and simply has no leader.
        if (m.text === null) {
            return "nothing";
        }
        CalloutWrite.unlink(di, m.text);
        return "unlinked";
    }

    CalloutWrite.applyReflow(doc, di, id, group);
    return "reflowed";
};
