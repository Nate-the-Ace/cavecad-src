// CheckMap.js
//
// QCAD add-on tool: read the finished map back and say what is wrong
// with it, in the words that explain WHY it is wrong.
//
//   Cave Survey > Check Map   (or type "chk")
//
// WHO THIS IS FOR. Someone drawing their first cave map does not know
// what they have left out -- that is the whole difficulty. The suite
// already refuses to let them put a stalactite on the water layer, but
// nothing ever said "your sheet has no scale bar", which is the fault
// that makes a map unusable and the one nobody notices until it is
// printed.
//
// A PANEL, NOT A DIALOG, and that is the point of the tool. A modal
// dialog listing eight faults has to be dismissed before any of them
// can be fixed, so the list is read, half-remembered, and closed. This
// docks beside the drawing: pick a finding, read why it matters, press
// Show Me to be taken to it, fix it, press Check Again. The list is
// meant to be worked down to nothing.
//
// IT FIXES NOTHING, deliberately -- see Core/CsCheck.js's header. Every
// finding might be a decision rather than a mistake, and the tool that
// silently "corrected" a cartographer would be worse than no tool.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csCheckMapDock;

function CheckMap(guiAction) {
    EAction.call(this, guiAction);
}

CheckMap.prototype = new EAction();

/** How far around a finding's point the view is framed, in feet of
 *  cave. Wide enough that the fault is seen IN CONTEXT -- a wall gap
 *  filling the screen tells you nothing about which wall it is. */
CheckMap.SHOW_FEET = 40.0;

CheckMap.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Check Map"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyCheckMapDock";

    // `findings` is what the LIST shows; `ignored` is the set of codes
    // held back for this drawing, and `ignoredFindings` the ones it
    // actually held back this pass -- kept so the panel can say how
    // many, and show them on request.
    var w = { findings: [], ignored: {}, ignoredFindings: [],
        showIgnored: false, path: "", quiet: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    w.summary = new QLabel(qsTr("Press Check Again to read this map."));
    w.summary.wordWrap = true;
    layout.addWidget(w.summary, 0, 0);

    // A ONE-COLUMN TABLE, not a QListWidget. This bridge generates
    // QListWidget (and QTreeWidget) as WRAPPER-ONLY classes: `new
    // QListWidget()` warns "No constructor found" and hands back an
    // object with nothing behind it, whose every method is undefined.
    // Found live rather than in review -- the panel built, and clear()
    // threw the moment it was asked to show a finding. CaveShelf and
    // Sketch Scans reached the same conclusion before this did.
    w.list = new QTableWidget(0, 1);
    try {
        w.list.horizontalHeader().visible = false;
        w.list.verticalHeader().visible = false;
        w.list.horizontalHeader().stretchLastSection = true;
        w.list.selectionBehavior = QAbstractItemView.SelectRows;
        w.list.editTriggers = QAbstractItemView.NoEditTriggers;
        w.list.alternatingRowColors = true;
    } catch (eList) {
        // a bridge without the header accessors gets a table with
        // headers on, which is ugly and still perfectly usable
    }
    try {
        // The LIST gets the panel's height, not the why box. Set live
        // on 2026-09-10: with only a stretch factor the table came out
        // three rows tall under a why box half the panel high, and a
        // findings list you have to scroll three rows at a time is a
        // findings list nobody works down.
        w.list.minimumHeight = 220;
    } catch (eHeight) {
    }
    layout.addWidget(w.list, 1, 0);

    w.why = new QTextBrowser();
    w.why.readOnly = true;
    // WHY IS NOT OPTIONAL FURNITURE. A list of faults teaches nothing;
    // a beginner who is told "no scale bar" learns to add a scale bar,
    // and one who is told what a scale bar is FOR learns to check for
    // it on the next map without being asked.
    try {
        w.why.setMinimumHeight(90);
        w.why.setMaximumHeight(150);
    } catch (eWhyHeight) {
        // a bridge without the setters gets whatever the layout gives
    }
    layout.addWidget(w.why, 0, 0);

    var row = new QHBoxLayout();
    w.showButton = new QPushButton(qsTr("Show Me"));
    w.showButton.toolTip = qsTr("Zoom in on this finding. Clicking a " +
        "row already PANS to it at the magnification you are working " +
        "at; this one reframes. Greyed out for a fault that belongs to " +
        "the whole sheet rather than to one place -- a missing scale " +
        "bar is nowhere in particular.");
    w.showButton.enabled = false;
    row.addWidget(w.showButton, 1, 0);
    w.againButton = new QPushButton(qsTr("Check Again"));
    w.againButton.toolTip = qsTr("Read the map again. Fix something, " +
        "press this, watch it leave the list.");
    row.addWidget(w.againButton, 1, 0);
    layout.addLayout(row, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "CheckMap", qsTr("Check Map"));
    CheckMap.widgets = w;

    w.list.itemSelectionChanged.connect(function() {
        CheckMap.showSelected();
    });
    w.list.itemDoubleClicked.connect(function() {
        CheckMap.showMe();
    });
    w.showButton.clicked.connect(function() {
        CheckMap.showMe();
    });
    w.againButton.clicked.connect(function() {
        CheckMap.refresh();
    });

    try {
        w.list.contextMenuPolicy = Qt.CustomContextMenu;
        w.list.customContextMenuRequested.connect(function(pos) {
            // Right-click SELECTS what it lands on, so the menu and the
            // why box agree about which finding is meant -- the same
            // rule CaveShelf's list follows.
            try {
                var row = w.list.rowAt(pos.y());
                if (row >= 0 && row !== w.list.currentRow()) {
                    w.list.selectRow(row);
                }
            } catch (eRow) {
                // selection stays where it was
            }
            CheckMap.showListMenu();
        });
    } catch (eMenu) {
        // no custom menu on this bridge: every finding still shows,
        // which is the safe way to fail for a checker
    }
    return dock;
};

/** The row one finding gets: how bad, then what is wrong. An ignored
 *  one says so first -- it is only on screen because Show Ignored is
 *  on, and a row that looks like every other row would read as a fault
 *  that has come back. */
CheckMap.rowText = function(finding, ignored) {
    return (ignored === true ? "(ignored)  " : "") +
        CsCheck.LABEL[finding.severity] + "  --  " + finding.title;
};

// ---------------------------------------------------------------------
// The ignore list -- see Core/CsCheck.js for why it lives in settings
// rather than in the drawing.
// ---------------------------------------------------------------------

/** The settings key this drawing's ignore list is kept under. */
CheckMap.ignoreKey = function(path) {
    return CsCheck.IGNORE_SETTING + "/" + CsCheck.pathToken(path);
};

/** Reads the ignore list for one drawing. A drawing never saved has no
 *  path and gets an empty list every time -- nothing to key on, and
 *  inventing a key would attach one caver's decisions to every unsaved
 *  drawing they open. */
CheckMap.loadIgnored = function(path) {
    if (isNull(path) || String(path) === "") {
        return {};
    }
    try {
        return CsCheck.parseIgnored(
            RSettings.getStringValue(CheckMap.ignoreKey(path), ""));
    } catch (e) {
        return {};
    }
};

CheckMap.saveIgnored = function(path, set) {
    if (isNull(path) || String(path) === "") {
        return;
    }
    try {
        RSettings.setValue(CheckMap.ignoreKey(path),
            CsCheck.serializeIgnored(set));
    } catch (e) {
        EAction.handleUserMessage("Check Map: could not remember that " +
            "(" + e + ") -- the finding will be back next time.");
    }
};

/** Ignore, or stop ignoring, the selected finding. */
CheckMap.setSelectedIgnored = function(on) {
    var w = CheckMap.widgets;
    var finding = CheckMap.selected();
    if (isNull(w) || finding === null) {
        return;
    }
    w.ignored = CsCheck.setIgnored(w.ignored, finding.id, on);
    CheckMap.saveIgnored(w.path, w.ignored);
    EAction.handleUserMessage(on ?
        ("Check Map: ignoring \"" + finding.title + "\" -- this one " +
            "finding, not others like it. Right-click and Show Ignored " +
            "to bring it back.") :
        ("Check Map: no longer ignoring \"" + finding.title + "\"."));
    CheckMap.refresh();
};

/** Right-click on a finding. */
CheckMap.showListMenu = function() {
    var w = CheckMap.widgets;
    var finding = CheckMap.selected();
    var menu = new QMenu(w.list);

    var already = finding !== null && w.ignored[finding.id] === true;
    var ignoreAct = menu.addAction(already ?
        qsTr("Stop Ignoring This") : qsTr("Ignore This"));
    ignoreAct.enabled = (finding !== null) && (String(w.path) !== "");
    if (finding !== null && String(w.path) === "") {
        // Said, not silently greyed: a caver right-clicking a disabled
        // menu item deserves the reason.
        ignoreAct.toolTip = qsTr("Save the drawing first -- the ignore " +
            "list is remembered per drawing, and an unsaved one has no " +
            "name to remember it under.");
    }
    ignoreAct.triggered.connect(function() {
        CheckMap.setSelectedIgnored(!already);
    });

    menu.addSeparator();

    var showAct = menu.addAction(qsTr("Show Ignored"));
    showAct.checkable = true;
    showAct.checked = (w.showIgnored === true);
    showAct.triggered.connect(function() {
        w.showIgnored = !(w.showIgnored === true);
        CheckMap.refresh();
    });

    var clearAct = menu.addAction(qsTr("Stop Ignoring Everything"));
    clearAct.enabled = CsCheck.serializeIgnored(w.ignored) !== "";
    clearAct.triggered.connect(function() {
        w.ignored = {};
        CheckMap.saveIgnored(w.path, w.ignored);
        EAction.handleUserMessage("Check Map: every finding is back.");
        CheckMap.refresh();
    });

    menu.exec(QCursor.pos());
    try {
        menu.deleteLater();
    } catch (eDel) {
        // a leaked popup menu is cosmetic
    }
};

CheckMap.refresh = function() {
    var w = CheckMap.widgets;
    if (isNull(w)) {
        return;
    }
    var doc = null;
    try {
        doc = EAction.getDocument();
    } catch (eDoc) {
        doc = null;
    }
    if (isNull(doc)) {
        w.summary.text = qsTr("No drawing open.");
        w.list.setRowCount(0);
        w.findings = [];
        w.why.plainText = "";
        return;
    }

    try {
        w.path = String(doc.getFileName());
    } catch (ePath) {
        w.path = "";
    }
    w.ignored = CheckMap.loadIgnored(w.path);

    var result = CsCheck.run(doc);
    var split = CsCheck.splitIgnored(result.findings, w.ignored);
    w.ignoredFindings = split.ignored;
    // What the LIST holds, in the order it holds it: the live findings,
    // then the ignored ones when they are being shown. w.findings has
    // to match the rows exactly -- CheckMap.selected() indexes one by
    // the other.
    w.findings = (w.showIgnored === true) ?
        split.shown.concat(split.ignored) : split.shown;

    w.quiet = true;
    try {
        w.list.setRowCount(0);
        w.list.setRowCount(w.findings.length);
        for (var i = 0; i < w.findings.length; i++) {
            w.list.setItem(i, 0, new QTableWidgetItem(
                CheckMap.rowText(w.findings[i],
                    w.ignored[w.findings[i].id] === true)));
        }
    } finally {
        w.quiet = false;
    }
    var shownResult = { findings: split.shown, failed: result.failed,
        checked: result.checked,
        clean: split.shown.length === 0 && result.failed.length === 0 };
    w.summary.text = CsCheck.summary(shownResult, split.ignored.length);
    w.why.plainText = shownResult.clean ?
        qsTr("Nothing to fix. This map carries a scale bar, a north " +
            "arrow, a filled-in title block, and everything on it is " +
            "on a layer the suite knows.") : "";
    w.showButton.enabled = false;
    EAction.handleUserMessage(
        CsCheck.summary(shownResult, split.ignored.length));
};

/** The finding the list has selected, or null. */
CheckMap.selected = function() {
    var w = CheckMap.widgets;
    if (isNull(w) || isNull(w.findings)) {
        return null;
    }
    // currentRow() is a METHOD here, not a property -- reading it as a
    // property hands back a function, and `function >= 0` is false, so
    // the panel would answer "nothing selected" forever.
    var row = w.list.currentRow();
    if (row < 0 || row >= w.findings.length) {
        return null;
    }
    return w.findings[row];
};

CheckMap.showSelected = function() {
    var w = CheckMap.widgets;
    var finding = CheckMap.selected();
    if (finding === null) {
        w.why.plainText = "";
        w.showButton.enabled = false;
        return;
    }
    var text = finding.title + "\n\n" + finding.why;
    if (finding.layer !== "") {
        text += "\n\nLayer: " + finding.layer;
    }
    if (w.ignored[finding.id] === true) {
        text += "\n\n" + qsTr("Ignored on this map. Right-click for " +
            "Stop Ignoring This.");
    }
    w.why.plainText = text;
    w.showButton.enabled = !isNull(finding.at);

    // The click goes to the fault. Suppressed while refresh() is
    // rebuilding the list: setting rows moves the selection, and a
    // Check Again would otherwise throw the view at whatever landed
    // under the cursor.
    if (w.quiet !== true) {
        CheckMap.panTo(finding.at);
    }
};

/**
 * PAN to the selected finding, keeping the zoom the caver chose.
 *
 * This is what a plain CLICK does (Nathan, 2026-09-10: "when I click on
 * it in the list, it needs to pan to it in the cad view"). Panning
 * rather than zooming is the whole point of the distinction: clicking
 * down a list of findings should walk the drawing under a steady
 * magnification, not throw the view in and out on every row. Show Me
 * is the one that reframes.
 *
 * A finding with no place -- a missing scale bar is nowhere in
 * particular -- moves nothing, silently: the caver clicked a row, not
 * a button, and a message about it on every such click would be noise.
 */
CheckMap.panTo = function(at) {
    if (isNull(at)) {
        return;
    }
    try {
        var view = EAction.getDocumentInterface()
            .getLastKnownViewWithFocus();
        if (isNull(view)) {
            return;
        }
        view.centerToPoint(new RVector(at.x, at.y));
        try {
            view.regenerate();
        } catch (eRegen) {
            // some views repaint on their own; a stale one is cosmetic
        }
    } catch (e) {
        // A pan that cannot happen must never stop the list working --
        // the why text is the half that always has to arrive.
    }
};

/** Frame the drawing ON the selected finding, at a fixed reach. */
CheckMap.showMe = function() {
    var finding = CheckMap.selected();
    if (finding === null || isNull(finding.at)) {
        return;
    }
    var di = null;
    try {
        di = EAction.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (isNull(di)) {
        return;
    }
    try {
        // In DRAWING units, not feet: a metric cave's 40 is 40 metres
        // and framing it in feet would put the fault off screen.
        var reach = CheckMap.SHOW_FEET;
        try {
            reach = CheckMap.SHOW_FEET *
                CsShapeLine.perFoot(EAction.getDocument());
        } catch (eUnit) {
            reach = CheckMap.SHOW_FEET;
        }
        di.zoomTo(new RBox(
            new RVector(finding.at.x - reach, finding.at.y - reach),
            new RVector(finding.at.x + reach, finding.at.y + reach)));
    } catch (e) {
        EAction.handleUserMessage("Check Map: could not frame that " +
            "finding (" + e + ").");
    }
};

CheckMap.ensureDock = function() {
    if (csCheckMapDock !== undefined && csCheckMapDock !== null) {
        return csCheckMapDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csCheckMapDock = CheckMap.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csCheckMapDock);
    return csCheckMapDock;
};

CheckMap.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var dock = CheckMap.ensureDock();
        // Unlike the drawing panels, this one always OPENS and always
        // re-reads: it is a verb, not a palette. Toggling it shut on a
        // second press would make "check my map again" a two-click
        // gesture whose first click hides the answer.
        dock.visible = true;
        CheckMap.refresh();
    } catch (e) {
        // Forget the dock ONLY if it was never built. Forgetting a live
        // one because refresh() threw made the next press build a
        // second panel beside it.
        if (isNull(dock)) {
            csCheckMapDock = undefined;
        }
        EAction.handleUserWarning("Check Map: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

CheckMap.init = function(basePath) {
    CheckMap.basePath = basePath;

    var action = new RGuiAction(qsTr("Check Map"),
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
    action.setScriptFile(basePath + "/CheckMap.js");
    action.setIcon(basePath + "/CheckMap.svg");
    action.setStatusTip(qsTr("Read the map back and say what is missing " +
        "or wrong, and why it matters"));
    action.setDefaultCommands(["checkmap", "chk"]);
    // FIRST in stage 6: check, then repair, then share. A caver who
    // packages before checking has shared the faults.
    action.setGroupSortOrder(455);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = CheckMap.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csCheckMapDock = undefined;
        warning("Check Map: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
