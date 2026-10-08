/**
 * SectionBayPanel.js
 *
 * The two buttons that used to be commands.
 *
 * A bay is a mode: something is open, and it has to be closed. A mode
 * with no visible way out is the thing a beginner gets stuck in -- and
 * the way out used to be a command (`skc`, "Capture Section") you had
 * to already know existed, or a second command (`ske`, "Edit Sketch")
 * to get back into one. Now Capture and Cancel are on screen for as
 * long as the bay is: CrossSection.js's own "trace" route shows this
 * panel the moment SectionBay.run succeeds, and hides it again once the
 * bay is gone, whichever way it went.
 *
 * Modeless on purpose: the caver traces with QCAD's own tools -- Feature
 * Trace, Shaped Lines, arcs -- while this is up, so it must never take
 * focus or block the document the way a QDialog would.
 *
 * RE-READS THE BAY AT CLICK TIME, never trusts the one `show` was
 * called with. Tracing happens between `show` and a click on either
 * button, so the bay's `traced` set -- and in principle the bay itself,
 * if it was torn down some other way (undo, a second Cross Section run)
 * -- can have changed underneath a stale reference. SectionCapture.
 * findBay is cheap enough to call again and is the one place both this
 * panel and the interactive command it replaces already agree on what
 * "the open bay" means.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/SectionBay.js");
include(includeBasePath + "/SectionCapture.js");

function SectionBayPanel() {
}

/**
 * ONE DOCK, OWNED BY THE APPLICATION'S SCRIPT ENGINE.
 *
 * Cross Section is a document-level interactive action, so QCAD runs it
 * in the active tab's OWN script engine, and every engine has its own
 * globals. When this panel cached its dock in a module variable and
 * built it on first show, a bay opened from a second tab found that
 * variable empty and built a second dock; closing the first tab then
 * destroyed the engine the first dock's buttons called into, and they
 * did nothing (Nathan, 2026-09-27; Sheet Setup's orphan crashed
 * CaveCAD on hover). Cross Section cannot be setForceGlobal like the
 * other panel openers -- it needs its document for the whole
 * interactive cut -- so instead:
 *
 * - CrossSection.init, which runs in the application engine, builds
 *   the dock. Its buttons' closures live as long as CaveCAD does.
 * - show/hide, from whichever engine, find the dock by objectName and
 *   touch only real Qt properties. A JS expando (the old `dock.label`)
 *   exists only on the wrapper of the engine that set it, so the label
 *   is found by objectName too.
 * - A tab engine NEVER builds the dock. If the startup build failed,
 *   the panel is missing -- a lesser failure than a dock wired to an
 *   engine that is about to die.
 * - The panel follows the ACTIVE tab (SectionBayPanel.follow, wired to
 *   the MDI area in init): switching tabs shows the bay of the tab you
 *   are looking at, or hides the panel; closing the bay's tab hides it.
 */
SectionBayPanel.DOCK_NAME = "CaveSurveySectionBayDock";
SectionBayPanel.LABEL_NAME = "CaveSurveySectionBayLabel";

/** The one live dock, or null. Engine-neutral: asks the main window. */
SectionBayPanel.dock = function() {
    try {
        var dock = RMainWindowQt.getMainWindow().findChild(
            SectionBayPanel.DOCK_NAME);
        return isNull(dock) ? null : dock;
    } catch (e) {
        return null;
    }
};

/** The label saying where the bay is, found by name -- see above. */
SectionBayPanel.label = function(dock) {
    try {
        var label = dock.findChild(SectionBayPanel.LABEL_NAME);
        return isNull(label) ? null : label;
    } catch (e) {
        return null;
    }
};

/**
 * Show the panel, docked to the right, labelled with the bay's station.
 * Safe to call repeatedly and from any script engine.
 *
 * \param doc, di   the open document -- read fresh at click time too,
 *                   since the panel can sit open for as long as the
 *                   caver is tracing
 * \param bay        a SectionCapture.findBay result, for the station
 *                    name shown on the panel; not held onto past this
 *                    call (see the file header)
 */
SectionBayPanel.show = function(doc, di, bay) {
    if (isNull(doc) || isNull(di) || bay === null || bay === undefined) {
        return;
    }
    var dock = SectionBayPanel.dock();
    if (dock === null) {
        return;
    }
    var label = SectionBayPanel.label(dock);
    if (label !== null) {
        label.text = (bay.station !== null &&
                bay.station !== undefined && bay.station !== "") ?
            qsTr("Section bay open at %1").arg(bay.station) :
            qsTr("Section bay open");
    }
    try {
        dock.visible = true;
        dock.raise();
    } catch (eShow) {
    }
};

/** Hide the panel. Safe to call when it was never built. */
SectionBayPanel.hide = function() {
    var dock = SectionBayPanel.dock();
    if (dock === null) {
        return;
    }
    try {
        dock.visible = false;
    } catch (e) {
    }
};

/**
 * Match the panel to the active tab: shown for its open bay, hidden
 * when it has none -- or when there is no tab left at all. Wired to the
 * MDI area's subWindowActivated in init, which fires on every tab
 * switch and when a closing tab hands focus on (or to nothing).
 */
SectionBayPanel.follow = function() {
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    var bay = null;
    if (!isNull(doc)) {
        try {
            bay = SectionCapture.findBay(doc);
        } catch (eBay) {
            bay = null;
        }
    }
    if (bay === null) {
        SectionBayPanel.hide();
        return;
    }
    SectionBayPanel.show(doc, EAction.getDocumentInterface(), bay);
};

/**
 * Retire a dock by that name: renamed first, so the next findChild can
 * never answer with it again, then hidden and handed to Qt to delete.
 * deleteLater, not destroy(): the retiring dock may belong to another
 * engine, and nothing here should run inside it.
 */
SectionBayPanel.retire = function(dock) {
    try {
        dock.objectName = SectionBayPanel.DOCK_NAME + "Retired";
        dock.visible = false;
        RMainWindowQt.getMainWindow().removeDockWidget(dock);
        dock.deleteLater();
    } catch (e) {
    }
};

/**
 * Build the dock -- from CrossSection.init ONLY, in the application
 * engine (see the header). Any dock already carrying the name is
 * retired first: there must never be two, and one this engine did not
 * build has buttons wired to some other engine.
 */
SectionBayPanel.ensureDock = function() {
    for (var guard = 0; guard < 8; guard++) {
        var old = SectionBayPanel.dock();
        if (old === null) {
            break;
        }
        SectionBayPanel.retire(old);
    }
    var appWin = RMainWindowQt.getMainWindow();
    var dock = new QDockWidget(qsTr("Section Bay"), appWin);
    // Without an objectName, restoreState() cannot identify the dock
    // and silently forgets where it was -- and show/hide could not find
    // it from a tab's engine.
    dock.objectName = SectionBayPanel.DOCK_NAME;

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    var label = new QLabel(qsTr("Section bay open"));
    label.objectName = SectionBayPanel.LABEL_NAME;
    try {
        label.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(label, 0, 0);

    var buttons = new QHBoxLayout();
    var captureBtn = new QPushButton(qsTr("Capture"));
    captureBtn.toolTip = qsTr("Place what is traced in the bay as a " +
        "section block, with a leader back to its station, and tear " +
        "the bay down.");
    var cancelBtn = new QPushButton(qsTr("Cancel"));
    cancelBtn.toolTip = qsTr("Abandon this bay: remove the frame, the " +
        "scan and the ghost, and leave whatever was traced exactly " +
        "where it is.");

    captureBtn.clicked.connect(function() {
        SectionBayPanel.captureClicked();
    });
    cancelBtn.clicked.connect(function() {
        SectionBayPanel.cancelClicked();
    });

    buttons.addWidget(captureBtn, 0, 0);
    buttons.addWidget(cancelBtn, 0, 0);
    layout.addLayout(buttons, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "CrossSection", qsTr("Cross Section"));
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    dock.visible = false;
    return dock;
};

/**
 * Startup wiring, from CrossSection.init: the dock, and the tab
 * follower. Both closures belong to the application engine.
 */
SectionBayPanel.install = function() {
    SectionBayPanel.ensureDock();
    var mdi = RMainWindowQt.getMainWindow().getMdiArea();
    mdi.subWindowActivated.connect(function() {
        SectionBayPanel.follow();
    });
};

/**
 * Capture clicked: hands over to the interactive placement, exactly
 * what the skc command used to start -- the proposal previewed, Enter
 * to accept it, or a click to put the section somewhere else.
 *
 * The refusals happen HERE, before any tool starts, so a refused
 * capture leaves the caver still in the bay with the panel still up and
 * more to trace. The panel hides itself from inside the action once a
 * section has actually been placed, or here when there is no bay left
 * to act on at all.
 */
SectionBayPanel.captureClicked = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        SectionBayPanel.hide();
        return;
    }
    var probe = SectionCapture.findBay(doc);
    if (probe === null && SectionCapture.findBayError === null) {
        // The bay is already gone by some other means (undo, a second
        // bay opened and closed elsewhere) -- nothing left to act on,
        // and nothing to say either. TWO open bays is a different
        // case: findBay still returns null but WITH a reason, and that
        // reason has to reach the caver -- the action below says it.
        SectionBayPanel.hide();
        return;
    }
    if (probe !== null && probe.traced.length === 0) {
        // Refused before any tool starts, so the caver stays in the bay
        // with the panel still up and more to trace.
        EAction.handleUserMessage(qsTr("Nothing has been traced inside " +
            "the bay yet, so there is no section to capture."));
        return;
    }
    // Hands over to the interactive placement -- proposal previewed,
    // Enter to accept it, or pick somewhere else. Where a section sits
    // on the sheet is the cartographer's decision, and this button is
    // the only way left to reach that flow now that skc is gone. The
    // panel hides itself from inside the action, once a section has
    // actually been placed.
    SectionCapture.startInteractive();
};

/** Cancel clicked: SectionBay.cancel on whatever bay is open now. */
SectionBayPanel.cancelClicked = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (!isNull(doc) && !isNull(di)) {
        var bay = SectionCapture.findBay(doc);
        if (bay !== null) {
            SectionBay.cancel(doc, di, bay);
        } else if (SectionCapture.findBayError !== null) {
            // Two bays open: cancelling THIS panel cannot know which
            // one the caver meant, so say so rather than guessing --
            // the same refusal Capture would give.
            EAction.handleUserMessage(SectionCapture.findBayError);
            return;
        }
    }
    SectionBayPanel.hide();
};
