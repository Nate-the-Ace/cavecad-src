// Cave3DListener.js -- the 3D window follows the drawing as it is
// edited.
//
// NOTHING DEPENDS ON THIS. The panel's Refresh button is the
// guarantee; this listener is the same answer arrived at earlier.
// CsBind.js states the reason plainly about the very same signal: it
// "rests on a signal this bridge may not deliver". A design that only
// listened would be silently stale whenever it was not delivered, and
// a stale 3D view is not obviously stale -- it is a picture of a cave,
// and it looks exactly as convincing as a current one.
//
// So the two paths are deliberate, and the listener is allowed to fail.
// install() returns false rather than throwing, and Cave3D works.
//
// DIFFERENT IN KIND FROM THE OTHER THREE LISTENERS. Callout, ShapedLines
// and AreaFill all WRITE back into the drawing, which is why they carry
// re-entrancy guards, undo-group joining and a cheap XDATA gate. This
// one writes nothing: it reads the survey and pushes a mesh into a
// window. So it needs none of that machinery, and adding it by analogy
// would be cargo cult. What it does need, and they do not, is
// COALESCING -- a transaction touching two hundred entities is one
// rebuild, not two hundred, and a rebuild walks the whole cave.
//
// Not a menu tool. Registers no RGuiAction. Installed once from
// CaveSurvey.js.

function Cave3DListener() {}

Cave3DListener.installed = false;

/** The coalescing timer, alive only between a transaction and the
 *  rebuild it provokes. */
Cave3DListener.timer = null;

/** How long to wait for a transaction storm to finish, in ms. Long
 *  enough that a multi-step operation settles first; short enough that
 *  a caver who moved one station sees it move. */
Cave3DListener.QUIET_MS = 200;

Cave3DListener.install = function() {
    if (Cave3DListener.installed) {
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
        adapter.transactionUpdated.connect(Cave3DListener.onTransaction);
    } catch (e) {
        // Without the listener the 3D view still works; it just needs
        // Refresh pressed. Degrade, never crash startup.
        return false;
    }
    Cave3DListener.installed = true;
    return true;
};

Cave3DListener.onTransaction = function(document, transaction) {
    // THE CHEAP GATE. With no panel open this is the whole cost of
    // the listener: two property reads per transaction, no document
    // access at all. A caver who never opens the 3D view pays nothing
    // measurable for it being installed.
    if (typeof Cave3D === "undefined" || Cave3D.handle === null) {
        return;
    }
    if (typeof cave3d === "undefined" || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }

    // Restart the clock on every transaction, so a storm of them
    // produces exactly one rebuild after the storm ends rather than one
    // per transaction or one per storm-start.
    try {
        if (Cave3DListener.timer !== null) {
            Cave3DListener.timer.stop();
            Cave3DListener.timer = null;
        }
        var timer = new QTimer();
        timer.singleShot = true;
        timer.timeout.connect(function() {
            Cave3DListener.timer = null;
            // The document is NOT captured here. A freed RDocument
            // cannot be detected and touching one segfaults, and this
            // callback runs after the transaction that named it has
            // gone; Cave3D.refresh asks for the current document
            // instead, which is the only one that can still be read.
            try {
                Cave3D.refresh();
            } catch (eRefresh) {
                // A rebuild that fails leaves the last mesh up. Better
                // that than tearing down a view mid-edit over a
                // transient state the caver is still typing into.
            }
        });
        timer.start(Cave3DListener.QUIET_MS);
        Cave3DListener.timer = timer;
    } catch (e) {
        // No timer, no coalescing -- and no rebuild either. Refresh
        // remains the guarantee.
    }
};
