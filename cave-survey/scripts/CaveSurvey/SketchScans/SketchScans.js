// SketchScans.js
//
// QCAD add-on tool: a DOCKABLE panel that browses the cave's scans/
// folder -- including the per-trip subfolders surveyors actually keep
// scans in -- previews each sketch large enough to tell the right one
// from the rest, and inserts it into the drawing, straight into the
// interactive align tool (ScanAlign.js, folded in from what used to be
// its own menu entry, Align Image), so a scan goes from folder to
// aligned underlay in one motion. A scan that lives outside the cave's
// scans/ folder is the one thing the panel's own list cannot reach, so
// its "Add a scan from elsewhere..." button file-picks one and runs the
// same insert-then-align path. Docked (right area, tabbed beside
// Feature Trace and the Survey Notebook) rather than modal: several
// scans commonly underlie one map, and the panel stays put between
// inserts.
//
// The preview is the point of the tool. A trip's scans have names like
// "IMG_4021.jpeg"; picking the wrong one costs a whole tracing session.
// So the list shows a live preview pane under it for the selected
// file, and hovering any row pops a bigger picture as a tooltip (Qt
// rich-text tooltips render <img>).
//
// The list is a folder TREE, simulated on a QTableWidget (QTreeWidget
// is not constructible in this bridge -- see CaveShelf.js): bold
// folder rows with ▾/▸ glyphs, one plain click folds a folder by
// hiding its rows, and the collapsed set is remembered per cave in
// settings (CsScanTree.SETTING). The model behind it is
// Core/CsScanTree.js.
//
// Inserting is ADDITIVE -- re-running never erases previous scans
// (unlike the basemap and the contours, which replace themselves).
// Each image is tagged SketchScan=<path relative to scans/> and lands
// on CTRL-SCAN, scaled to sit over the survey at a sensible size,
// HALF FADED and at the BACK of the draw order, the basemap's
// treatment: the scan is an underlay to trace over, and at full
// strength on top it hid the very linework being drawn.
//
// "Insert & Align" hands the freshly inserted image, selected, to the
// align tool (ScanAlign.js) -- deferred through a zero-delay timer,
// because starting another action from inside a widget event is the
// documented hard-crash trap.
//
// USAGE:
//   Cave Survey > Sketch Scans   (or "sketchscans" / "ss")
//   -- toggles the panel.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/ScanAlign.js");
// SectionBay and SectionCapture used to live in their own SketchSection/
// folder with their own menu entries (Sketch Section / Capture Section)
// -- both folded into Cross Section's own route dialog. This panel's
// buttons still call straight into them; only the folder moved.
include(includeBasePath + "/../CrossSection/SectionBay.js");
include(includeBasePath + "/../CrossSection/SectionCapture.js");
// The scan viewer lives in Core now (CsScanView.js): the Survey
// Notebook shows the same scans beside the shots being typed off them,
// and two copies of an embedded CAD view is two copies of every trap
// this one cost to find.
include(includeBasePath + "/ScanTurn.js");

// The panel, built once per session (FeatureTrace's pattern).
var csSketchScansDock;

/** Toggles the panel; a fresh refresh every time it shows. */
function sketchScansRun() {
    if (typeof RImageData === "undefined" ||
            typeof RImageEntity === "undefined") {
        CsTell.warn("Sketch Scans: this build's script engine has no image " +
            "support (RImageData).\nThe CaveCAD fork is the supported " +
            "platform.");
        return;
    }
    try {
        var existed = (csSketchScansDock !== undefined &&
            csSketchScansDock !== null);
        var dock = SketchScans.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        if (dock.visible) {
            SketchScans.refresh();
            try {
                dock.raise();
            } catch (eRaise) {
                // tabbed dock that cannot front itself still shows
            }
        }
    } catch (e) {
        // Forget the dock ONLY if it was never built. Forgetting a live
        // one because refresh() threw made the next press build a
        // second panel beside it.
        if (isNull(dock)) {
            csSketchScansDock = undefined;
        }
        EAction.handleUserWarning("Sketch Scans: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }
}

// How deep below scans/ to look. Real caves nest scans in per-trip
// subfolders ("scans/2025 Scans/9-7-25 Survey Scans/..."), so a
// top-level-only listing sees an empty folder on every real cave.
SketchScans.DEPTH = 4;

/**
 * Image files under a scans folder, RECURSIVE, as paths relative to it,
 * name-sorted, by the formats QImage reads.
 *
 * DELEGATES TO CORE. The filtering used to live here -- previews out,
 * Scan Trim's crops out -- and the Survey Notebook, listing the same
 * folder for the same reason, had none of it. One listing, in
 * CsScanList, is what stops those two answers drifting apart again
 * (2026-09-14); the split-PDF rule arrived with it.
 */
SketchScans.imageFiles = function(folder) {
    return CsScanList.scanFiles(folder, SketchScans.DEPTH);
};

// Hover-tooltip preview width; the in-dock pane scales to itself.
SketchScans.PREVIEW_W = 420;
// The inserted scan's fade, percent (0 = full strength). Half, the
// basemap's value: an underlay must not out-shout the linework.
SketchScans.FADE_PERCENT = 50;
// The preview pane's STARTING share -- the user drags the splitter for
// more or less, and the drag is remembered here. SIDE BY SIDE now:
// a scanned field page is TALLER than it is wide, so stacking the
// browser on top of it left the page to be read through a letterbox
// (Nathan, 2026-09-11). Beside it, the picture gets the dock's whole
// height and the tree only needs enough width for a filename.
//
// Its own settings key, not the old one: those remembered numbers are
// HEIGHTS, and handing them to a horizontal splitter would open the
// panel with the tree three times the width of the page.
SketchScans.DOCK_PREVIEW_H = 240;
SketchScans.SETTING_SPLIT = "CaveSurvey/SketchScansSplitterWidths";
// The COMPLETE tick. A trip's scans run to dozens of IMG_4021-shaped
// names, so "which of these have I already done" is a real question
// with no other answer.
// The tick lives in Core with the list that draws it; this name stays
// because the rest of this file says it.
SketchScans.COMPLETE = CsScanList.COMPLETE;

/**
 * The header line: which folder, how many scans, and what to do.
 *
 * THE PATH IS SHORTENED, to the cave folder and the leaf. A synced
 * Drive path is sixty characters of machinery -- CloudStorage,
 * .shortcut-targets-by-id, a random id -- and none of it tells a caver
 * anything they do not know. Worse, it is one unbroken WORD, and a
 * wrapped label cannot be narrower than its longest word, so the full
 * path was setting the panel's minimum width at half the window.
 *
 * Pure, so the width this panel can shrink to is a testable fact.
 */
SketchScans.headerText = function(scans, count) {
    var shown = String(scans);
    var parts = shown.split("/");
    if (parts.length > 2) {
        // The last two segments are the cave and its scans folder,
        // which is the part a caver recognises.
        shown = ".../" + parts[parts.length - 2] + "/" +
            parts[parts.length - 1];
    }
    return shown + "  —  " + count + " scan" + (count === 1 ? "" : "s") +
        qsTr(". Hover a scan for a preview; double-click inserts and " +
        "aligns; click a folder to collapse it.");
};

// The collapsed set for one cave's scans folder, from settings.
// A bridge without RSettings starts fully expanded.
SketchScans.loadCollapsed = function(scans) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING, ""));
        return CsScanTree.collapsedSetFor(map, scans);
    } catch (e) {
        return {};
    }
};

// Writes the collapsed set back, keeping only folders the panel
// actually showed -- renamed or deleted trip folders fall out. Called
// on every fold/unfold: a dock has no closing moment to save on.
SketchScans.saveCollapsed = function(scans, collapsed, rows) {
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING, ""));
        var valid = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].kind === "folder") { valid.push(rows[i].rel); }
        }
        CsScanTree.recordCollapsed(map, scans, collapsed, valid);
        RSettings.setValue(CsScanTree.SETTING,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings just forgets the collapse state
    }
};

// This cave's completed pages. THE STORE IS CsScanList's -- both
// panels read and write through it, because each keeping its own copy
// is exactly how the two got out of step.
SketchScans.loadBookmarks = function(scans) {
    return CsScanList.loadComplete(scans);
};

/** Redraws every row's text from the CURRENT marks.
 *
 *  Every row and not just one: a folder's tick depends on what is
 *  complete BENEATH it, so finishing a page can change an ancestor's
 *  text as well as its own. */
SketchScans.repaintMarks = function() {
    var w = SketchScans.w;
    if (isNull(w) || isNull(w.list) || isNull(w.rows)) {
        return;
    }
    for (var r = 0; r < w.rows.length; r++) {
        try {
            w.list.item(r, 0).setText(SketchScans.rowText(
                w.rows[r], w.collapsed, w.bookmarks, w.rows));
        } catch (eText) {
            // a stale glyph is cosmetic; the mark still stands
        }
    }
};

/** The other panel marked a page: take the store's word for it and
 *  repaint. Registered once, at fill time. */
SketchScans.marksChanged = function(folder) {
    var w = SketchScans.w;
    if (isNull(w) || w.scans === null || w.scans !== folder) {
        return;
    }
    w.bookmarks = CsScanList.loadComplete(folder);
    SketchScans.repaintMarks();
};

// The FILE rows this panel listed, for pruning marks on pages that are
// no longer there.
SketchScans.listedRels = function(rows) {
    var valid = [];
    if (isNull(rows)) {
        return null;
    }
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind === "file") { valid.push(rows[i].rel); }
    }
    return valid;
};

// The scan this cave was left on: what the DRAWING recorded, and
// failing that what this machine remembers. Core holds both, because
// the Notebook's copy of the tree has to land on the same page.
SketchScans.loadSelected = function(scans) {
    try {
        return CsScanList.landingPage(EAction.getDocument(), scans);
    } catch (e) {
        return null;
    }
};

// Writes it back. Called on every selection change: a dock has no
// closing moment to save on, same as the collapsed set.
//
// THROUGH CORE, which also tells the Survey Notebook's copy of this
// tree. The two panels browse one folder and were free to sit on
// different pages in it -- and when tracing, the Notebook's pane holds
// the page being read while this one holds the page being placed, the
// same page, kept in step by hand.
SketchScans.saveSelected = function(scans, rel, rows) {
    CsScanList.selectionMoved(scans, rel, rows, "SketchScans");
};

/**
 * The Notebook moved to another page: follow it.
 *
 * Only for THIS cave's folder, and only when the row is really there
 * and visible -- a page inside a folder this panel has collapsed is
 * not somewhere the selection can go, and forcing it open would undo
 * a fold the caver made. w.building guards the rebuild case, where the
 * table fires selection signals of its own.
 */
SketchScans.selectionElsewhere = function(scans, rel) {
    var w = SketchScans.w;
    if (w === undefined || w === null ||
            isNull(w.list) || isNull(w.rows) ||
            w.scans === null || w.scans === undefined ||
            w.scans !== scans) {
        return;
    }
    if (rel === null || rel === undefined || rel === "") {
        return;
    }
    if (SketchScans.selectedRel() === rel) {
        return;                     // already there: nothing to do
    }
    var row = CsScanTree.rowOfRel(w.rows, rel, w.collapsed);
    if (row < 0) {
        return;
    }
    var was = w.building;
    w.building = true;              // our own save must not echo back
    try {
        w.list.selectRow(row);
    } catch (eSel) {
    }
    w.building = was;
    // The preview follows on its own: selecting a row fires the
    // table's own itemSelectionChanged, which is what draws it, and
    // w.building suppresses only the SAVE.
};

// The text of one row: indentation by depth, a disclosure glyph on
// folder rows, a glyph-wide gap on file rows so labels at one depth
// line up across kinds.
SketchScans.rowText = function(row, collapsed, bookmarks, rows) {
    // The list moved to Core (CsScanList) when the Survey Notebook
    // needed the same browser -- two lists over one folder would be
    // two answers to "which pages have I done".
    return CsScanList.rowText(row, collapsed, bookmarks, rows);
};

/** Builds the dock and hands it to the main window. Idempotent. */
SketchScans.ensureDock = function() {
    if (csSketchScansDock !== undefined && csSketchScansDock !== null) {
        return csSketchScansDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csSketchScansDock = SketchScans.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csSketchScansDock);
    return csSketchScansDock;
};

/**
 * Runs fn over every copy of one named control across the workflow
 * tabs.
 *
 * The tabs each carry their own buttons -- see the note where they are
 * built -- so "the Sketch Section button" is one name over several
 * widgets, and the rest of this file has to keep being able to say it
 * once.
 */
SketchScans.eachButton = function(w, name, fn) {
    if (isNull(w) || isNull(w.buttonSets)) {
        return;
    }
    for (var i = 0; i < w.buttonSets.length; i++) {
        var control = w.buttonSets[i][name];
        if (!isNull(control)) {
            fn(control, i);
        }
    }
};

/** Sets one named control's text on every tab that has one. */
SketchScans.setText = function(name, text) {
    SketchScans.eachButton(SketchScans.w, name, function(b) {
        try {
            b.text = text;
        } catch (e) {
        }
    });
};

/** Enables or disables one named control on every tab that has one. */
SketchScans.setEnabled = function(name, on) {
    SketchScans.eachButton(SketchScans.w, name, function(b) {
        try {
            b.enabled = (on === true);
        } catch (e) {
        }
    });
};

/** Shows or hides one named control on every tab that has one. */
SketchScans.setVisible = function(name, on) {
    SketchScans.eachButton(SketchScans.w, name, function(b) {
        try {
            b.visible = (on === true);
        } catch (e) {
        }
    });
};

/**
 * THE PANEL FOLLOWS THE COMMAND (Nathan, 2026-09-11).
 *
 * A bay is a different job from browsing scans, and it was being done
 * from two other panels: Feature Trace to draw with, the Symbol Palette
 * to decorate with, this one to capture from. Showing those two
 * automatically helped and still left three panels and a hunt.
 *
 * So the panel has a CONTEXT. While a bay is open it shows the bay's
 * own buttons -- trace, decorate, capture, cancel -- and the three view
 * tabs are put out of reach, because the view is not in question while
 * you are standing in a bay. Close the bay and they come back.
 *
 * The full palettes are still one click away for the features and
 * symbols this tab does not carry; what has gone is having to go and
 * find them for the ordinary case.
 */
SketchScans.syncContext = function() {
    var w = SketchScans.w;
    if (isNull(w) || isNull(w.tabs) || isNull(w.bayTab)) {
        return;
    }
    var open = false;
    try {
        open = SketchScans.bayOpen(EAction.getDocument());
    } catch (eBay) {
        open = false;
    }
    if (open === w.bayContext) {
        return;                       // nothing changed
    }
    w.bayContext = open;
    try {
        if (open === true) {
            // Remember where the caver was, so closing the bay puts
            // them back on their own tab rather than on Plan.
            if (w.tabs.currentIndex !== w.bayTab) {
                w.beforeBay = w.tabs.currentIndex;
            }
            w.tabs.setTabEnabled(w.bayTab, true);
            w.tabs.currentIndex = w.bayTab;
            for (var i = 0; i < w.bayTab; i++) {
                w.tabs.setTabEnabled(i, false);
            }
        } else {
            for (var j = 0; j < w.bayTab; j++) {
                w.tabs.setTabEnabled(j, true);
            }
            w.tabs.currentIndex = isNull(w.beforeBay) ? 2 : w.beforeBay;
            w.tabs.setTabEnabled(w.bayTab, false);
        }
    } catch (eSwitch) {
    }
};

/** Arms one feature and starts tracing, without leaving this panel.
 *  The stroke lands on the SECTION layers because it is inside the bay
 *  -- where you drag is what decides the view. */
SketchScans.traceInBay = function(layerName) {
    try {
        if (typeof FeatureTrace === "undefined") {
            SketchScans.showDraw("trace");
            return;
        }
        FeatureTrace.armLayer(layerName);
        FeatureTrace.startRun();
    } catch (e) {
        CsTell.warn("Sketch Scans: could not start tracing (" + e + ").");
    }
};

/** Starts placing whatever the Symbol Palette last had armed, and
 *  opens the palette when it has nothing -- a button that silently
 *  does nothing is worse than one that hands you the chooser. */
SketchScans.placeInBay = function() {
    try {
        if (typeof SymbolPalette === "undefined" ||
                isNull(SymbolPalette.armed)) {
            SketchScans.showDraw("symbols");
            return;
        }
        SymbolPalette.startRun();
    } catch (e) {
        CsTell.warn("Sketch Scans: could not start placing (" + e + ").");
    }
};

/** Opens one of the suite's docks by objectName. */
/** Opens the Draw panel with one section unfolded. The bay's buttons
 *  do the drawing themselves; this is the "and the rest of them" door,
 *  and since the consolidation there is only one. */
SketchScans.showDraw = function(which) {
    // The section title is read INSIDE the guard, not passed in by the
    // caller: `DrawPanel.SEC_TRACE` in an argument evaluates before the
    // guard can catch a DrawPanel that never loaded.
    try {
        if (typeof DrawPanel === "undefined") {
            SketchScans.showDock("CaveSurveyDrawDock");
            return;
        }
        DrawPanel.reveal(which === "symbols" ? DrawPanel.SEC_SYMBOLS : DrawPanel.SEC_TRACE);
    } catch (e) {
    }
};

SketchScans.showDock = function(name) {
    try {
        var dock = RMainWindowQt.getMainWindow().findChild(name);
        if (!isNull(dock)) {
            dock.visible = true;
        }
    } catch (e) {
    }
};

/** Tears the open bay down, leaving whatever was traced where it is. */
SketchScans.cancelBay = function() {
    try {
        var doc = EAction.getDocument();
        var di = EAction.getDocumentInterface();
        var bay = SectionCapture.findBay(doc);
        if (isNull(bay)) {
            return;
        }
        SectionBay.cancel(doc, di, bay);
        SketchScans.syncContext();
        SketchScans.updateTrimGate();
    } catch (e) {
        CsTell.warn("Sketch Scans: could not close the bay (" + e + ").");
    }
};

/** The LRUD letter the section tab's combo is showing. */
SketchScans.lrudIndex = function() {
    var out = 0;
    SketchScans.eachButton(SketchScans.w, "lrudCombo", function(c) {
        try {
            out = c.currentIndex;
        } catch (e) {
        }
    });
    return out;
};

/** Points that combo at one letter. */
SketchScans.setLrudIndex = function(index) {
    SketchScans.eachButton(SketchScans.w, "lrudCombo", function(c) {
        try {
            c.currentIndex = index;
        } catch (e) {
        }
    });
};

/** Sets one named control's tooltip on every tab that has one. */
SketchScans.setToolTip = function(name, tip) {
    SketchScans.eachButton(SketchScans.w, name, function(b) {
        try {
            b.toolTip = tip;
        } catch (e) {
        }
    });
};

/**
 * Which view is being sketched: 0 plan, 1 profile, 2 cross section.
 *
 * READ OFF THE TAB, which is the point of the tabs: the view is a place
 * you are rather than a setting you left somewhere. 0 when there are no
 * tabs at all, which is the same answer the combo's own default gave.
 */
SketchScans.frameIndex = function() {
    var w = SketchScans.w;
    if (isNull(w) || isNull(w.tabs)) {
        return 0;
    }
    try {
        var at = w.tabs.currentIndex;
        // THE BAY TAB IS NOT A VIEW. A bay is always a cross section,
        // so while it is open the answer is 2 -- otherwise every
        // frame-sensitive thing in this file would read "3" and fall
        // through to plan.
        return (at === w.bayTab) ? 2 : at;
    } catch (e) {
        return 0;
    }
};

/** Lets the caver change view, or stops them -- during a calibration
 *  or an open bay, the view is decided and switching it mid-way would
 *  ask a question nothing could answer. */
SketchScans.setFrameEnabled = function(on) {
    var w = SketchScans.w;
    if (isNull(w) || isNull(w.tabs)) {
        return;
    }
    for (var i = 0; i < 3; i++) {
        try {
            w.tabs.setTabEnabled(i, on === true ||
                i === SketchScans.frameIndex());
        } catch (e) {
        }
    }
};

SketchScans.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Sketch Scans"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveySketchScansDock";

    // Everything refresh() and the handlers need, in one place.
    var w = {
        rows: [],           // CsScanTree rows behind the table indices
        collapsed: {},      // this cave's collapsed set
        bookmarks: {},      // this cave's COMPLETED scans
        picking: null,      // an alignment in progress: {pairs, rel}
        trim: null,         // the trim choice for the selected scan:
                            // {rel, rect, path, chosen}; null before
                            // anything is selected

        calibrating: null,  // a section scale being set in the preview:
                            // {path, rel, station, lrud, from, to,
                            //  forced, cal}
        scans: null,        // the scans folder the table was built from
        ready: false        // false while the panel shows a message
    };

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // THE HEADER SETS THE PANEL'S MINIMUM WIDTH, and it used to set it
    // at 912 pixels -- half of a 1920-wide window, unshrinkable, with
    // the drawing squeezed into what was left (measured 2026-09-07). A
    // wrapped label cannot be narrower than its longest WORD, and the
    // word here was a Google Drive path: sixty characters of
    // /Users/.../.shortcut-targets-by-id/1vRG_mjAzh... with nothing to
    // break at. So the label is told it may be narrow, and the path is
    // shortened to fit (SketchScans.headerText); the whole path lives
    // in the tooltip, where it costs no width at all.
    w.header = new QLabel("");
    try {
        w.header.wordWrap = true;
        w.header.setMinimumWidth(1);
    } catch (eWrap) {
    }
    layout.addWidget(w.header, 0, 0);

    // THE TREE AND THE PAGE BESIDE IT, from Core: one widget, one
    // arrangement, both panels. Anything about the PAIR -- which way
    // round it sits, the ratio, the zoom row -- changes there and
    // changes in the Survey Notebook at the same time, which is the
    // whole reason it left this file (Nathan, 2026-09-11).
    var browser = CsScanBrowser.build(body,
        { settingKey: SketchScans.SETTING_SPLIT });
    w.list = browser.list;
    w.previewPane = browser.previewPane;
    w.scanView = browser.preview;
    w.fitButton = browser.fitButton;
    w.zoomInButton = browser.zoomInButton;
    w.zoomOutButton = browser.zoomOutButton;
    w.splitter = browser.splitter;
    var previewLayout = browser.previewLayout;
    var zoomRow = browser.zoomRow;

    // The old QLabel stays as the fallback for a build that cannot
    // embed a view, and as the place messages go either way.
    w.preview = new QLabel("");
    try {
        w.preview.minimumHeight = 40;
        w.preview.alignment = Qt.AlignCenter;
    } catch (ePrev) {
    }

    if (w.scanView !== null) {
        // A PAGE THAT ARRIVED SIDEWAYS. Not a placement problem -- the
        // pixels themselves are turned, and every tool downstream reads
        // them off disk -- so the button rewrites the scan rather than
        // carrying an angle beside it. It sits with the zoom controls
        // because it belongs to LOOKING at the page, not to placing it.
        //
        // THIS PANEL'S, not the shared row's: the Notebook types off a
        // page, it does not repair one.
        w.rotateButton = new QPushButton("\u21BB");
        w.rotateButton.toolTip = qsTr("Turn this scan a quarter turn " +
            "clockwise AND SAVE IT BACK TO DISK, so every tool sees it " +
            "the right way up. The file itself is rewritten.");
        try {
            w.rotateButton.maximumWidth = 34;
        } catch (eZw) {
        }
        zoomRow.addWidget(w.rotateButton, 0, 0);
        w.rotateButton.clicked.connect(function() {
            SketchScans.rotateSelected();
        });

        // A PAGE THAT CAME OUT BACK TO FRONT -- shot through the back
        // of the sheet, traced on the reverse of tracing paper, taken
        // with a phone's front camera. Same argument as the turn: the
        // pixels are the thing that is wrong, and the file is where
        // every tool downstream reads them from.
        //
        // HORIZONTAL ONLY, one button. A vertical flip is this one
        // followed by two turns, and the reversal a scan actually
        // arrives with is nearly always left-for-right.
        w.flipButton = new QPushButton("\u21C4");
        w.flipButton.toolTip = qsTr("Mirror this scan left-for-right " +
            "AND SAVE IT BACK TO DISK, for a page that came out back " +
            "to front. The file itself is rewritten. (For a top-to-" +
            "bottom flip, mirror it and then turn it twice.)");
        try {
            w.flipButton.maximumWidth = 34;
        } catch (eFw) {
        }
        zoomRow.addWidget(w.flipButton, 0, 0);
        w.flipButton.clicked.connect(function() {
            SketchScans.flipSelected();
        });

        // THE TRIM BAR. Not an optional extra button: a scan is not
        // placeable until the caver has said which part of it they
        // mean.
        var trimRow = new QHBoxLayout();
        w.trimLabel = new QLabel(qsTr("Trim: drag a box, or Trace an "
            + "outline"));
        try {
            w.trimLabel.toolTip = qsTr("Drag a box round the sketch you " +
                "want, or press Trace to draw round it by hand. Only " +
                "that part of the page is placed, so the other " +
                "sketches on it stay out of the drawing.");
        } catch (eTt) {
        }
        // NO "USE WHOLE PAGE". Scans get trimmed, always (Nathan,
        // 2026-09-11): a field page holds three sketches and placing
        // all of it puts the other two in the drawing.
        w.trimRedoButton = new QPushButton(qsTr("Redo"));
        w.trimRedoButton.toolTip = qsTr("Forget this trim and choose " +
            "again.");
        // TRACE, for a sketch a box cannot hold. A field page is often
        // drawn corner to corner with two sketches sharing one sheet,
        // and no rectangle round either of them leaves the other out.
        // The crop is still a rectangle -- the outline's own bounding
        // box -- with everything outside the line made transparent, so
        // the drawing shows through the parts that were cut away.
        w.traceButton = new QPushButton(qsTr("Trace"));
        w.traceButton.toolTip = qsTr("Draw round the sketch instead of " +
            "boxing it. Hold the button down, draw round it and let " +
            "go -- releasing closes the shape. Or click corner by " +
            "corner and click the first corner again to close.");
        w.traceUndoButton = new QPushButton(qsTr("Undo point"));
        w.traceUndoButton.toolTip = qsTr("Take back the last corner.");
        trimRow.addWidget(w.trimLabel, 1, 0);
        trimRow.addWidget(w.traceButton, 0, 0);
        trimRow.addWidget(w.traceUndoButton, 0, 0);
        trimRow.addWidget(w.trimRedoButton, 0, 0);
        previewLayout.addLayout(trimRow, 0);
        w.trimRedoButton.clicked.connect(function() {
            SketchScans.resetTrim(true);
        });
        w.traceButton.clicked.connect(function() {
            SketchScans.startTrace();
        });
        w.traceUndoButton.clicked.connect(function() {
            SketchScans.undoTracePoint();
        });

        // A click in the scan reports the pixel it landed on. This is
        // the groundwork for picking alignment stations off the scan
        // instead of off the drawing; for now it proves the click
        // arrives and says where.
        w.pickLabel = new QLabel("");
        try {
            w.pickLabel.toolTip = qsTr("The pixel last clicked on the " +
                "scan. Zoom in for a finer pick.");
        } catch (ePl) {
        }
        zoomRow.addWidget(w.pickLabel, 0, 0);
        w.scanView.view.onScanPick = function(point) {
            try {
                SketchScans.takePick(point);
            } catch (ePick) {
            }
        };
        // the label is only for messages now
        w.preview.visible = false;
    }
    previewLayout.addWidget(w.preview, w.scanView === null ? 1 : 0, 0);

    CsScanBrowser.rememberSizes(w.splitter, SketchScans.SETTING_SPLIT,
        function() {
            // The pane changed size under the picture. The LABEL path
            // needs a rescale; the view path does not, and re-showing
            // would throw away the zoom the caver had just set.
            if (SketchScans.w !== undefined && SketchScans.w !== null &&
                    SketchScans.w.scanView === null) {
                SketchScans.showPreview();
            }
        });

    layout.addWidget(w.splitter, 1, 0);

    // ---- the workflow tabs -------------------------------------------
    //
    // THREE WORKFLOWS, THREE TABS (Nathan, 2026-09-10). This was one
    // grid of buttons plus a combo saying which view they applied to,
    // and the combo was the whole problem: it made the view a SETTING
    // rather than a place you are, and it left every button on screen
    // whether or not it did anything in the view you had chosen.
    // Sketch Section sat there greyed out through all the plan work,
    // and the placement buttons sat there through the section work
    // meaning something subtly different.
    //
    // A tab answers "which view am I sketching" by being open, and it
    // shows only the buttons that view uses, in the order they are
    // used. The frame is read off the tab -- SketchScans.frameIndex --
    // so there is one answer to which view this is, and it is the one
    // the caver is looking at.
    //
    // THE BUTTONS ARE PER TAB, three sets of them. A single set
    // re-parented between pages is the other way, and it trades three
    // cheap widgets for a re-parenting dance that this bridge does not
    // reliably do; SketchScans.setText and setEnabled walk the copies
    // so the rest of the file still says what it means.
    w.tabs = new QTabWidget();
    w.buttonSets = [];

    var makeButton = function(label, tip) {
        var b = new QPushButton(label);
        if (!isNull(tip)) {
            b.toolTip = tip;
        }
        return b;
    };

    var TIP = {
        pickAlign: qsTr("Click each station on the scan itself and say " +
            "which station it is; the scan is then placed already " +
            "fitted. Zoom in first -- the fit is only as good as the " +
            "picks."),
        elsewhere: qsTr("Pick any scan and fit it by hand: it is " +
            "placed over the survey and the align tool starts on it " +
            "-- two points on the scan, their true positions. For a " +
            "scan whose station marks cannot be read, and for a photo " +
            "still on a phone or a page scanned to the Desktop. The " +
            "dialog opens in this cave's scans folder."),
        sketch: qsTr("Open a staging bay for the selected scan: the " +
            "computed cross section at a chosen plan station, dashed, " +
            "to scale the scan onto and trace by hand."),
        lrud: qsTr("Which measurement the second click touched. Change " +
            "it if the guess was wrong -- the two clicks stand, only " +
            "the letter is re-read."),
        calibCancel: qsTr("Abandon this calibration without opening a " +
            "bay."),
        pickCancel: qsTr("Abandon this assignment. The picks are "
            + "dropped and nothing is placed; the scan and the survey "
            + "are untouched.")
    };

    /**
     * One tab's page.
     *
     * `order` names the buttons this workflow uses, IN THE ORDER THEY
     * ARE USED -- which is the other half of what the tabs are for. A
     * panel that lists its buttons in the order somebody built them
     * makes a caver read all of them every time.
     */
    var makePage = function(order) {
        var page = new QWidget();
        var grid = new QGridLayout();
        var set = {};
        var row = 0;
        for (var i = 0; i < order.length; i++) {
            var name = order[i];
            if (name === "calibration") {
                // THE CALIBRATION PAIR, hidden until there are two
                // clicks to correct. An L/R/U/D combo sitting there
                // before anything is picked invites the caver to choose
                // a letter FIRST, which is a different and worse
                // workflow -- it would mean promising to click that
                // particular wall.
                set.lrudCombo = new QComboBox();
                for (var li = 0; li < CsSectionBay.LRUD_LETTERS.length;
                        li++) {
                    set.lrudCombo.addItem(CsSectionBay.LRUD_LETTERS[li]);
                }
                set.lrudCombo.toolTip = TIP.lrud;
                set.calibCancelButton = makeButton(qsTr("Cancel"),
                    TIP.calibCancel);
                try {
                    set.lrudCombo.maximumWidth = 60;
                    set.lrudCombo.visible = false;
                    set.calibCancelButton.visible = false;
                } catch (eHide) {
                    // a bridge that cannot hide them shows two idle
                    // controls; both are inert until a calibration runs
                }
                grid.addWidget(set.lrudCombo, row, 0);
                grid.addWidget(set.calibCancelButton, row, 1);
                row += 1;
                continue;
            }
            var button;
            if (name === "pickAlignButton") {
                button = makeButton(qsTr("Assign Stations to Scans"),
                    TIP.pickAlign);
            } else if (name === "pickCancelButton") {
                // THE WAY OUT OF AN ASSIGNMENT, and the reason it is
                // its own button rather than a second meaning for the
                // one above (Nathan, 2026-09-19: "got into a state
                // where i could not cancel out of assigning stations
                // to a profile").
                //
                // The assign button reads "Cancel" only while NO
                // station has been picked. From the first pick on it
                // reads "Place", and there was nothing else to press:
                // the only way out of a half-made assignment was to
                // complete it and undo the placement afterwards. Worse
                // when the placement could not be made at all -- one
                // pick on a cave with no other scan placed has no
                // scale to borrow, so Place refused every time, the
                // tabs stayed locked, and the panel was simply stuck.
                //
                // Hidden until an assignment is running, the way the
                // calibration's own Cancel is.
                button = makeButton(qsTr("Cancel Assignment"),
                    TIP.pickCancel);
                try {
                    button.visible = false;
                } catch (ePickHide) {
                    // a bridge that cannot hide it shows one idle
                    // button, which is inert unless an assignment runs
                }
            } else if (name === "elsewhereButton") {
                button = makeButton(qsTr("Add a Scan and Fit by Hand..."),
                    TIP.elsewhere);
            } else if (name === "sketchButton") {
                button = makeButton(qsTr("Sketch Section"), TIP.sketch);
                button.enabled = false;
            } else if (name === "traceWallsButton") {
                button = makeButton(qsTr("Trace Walls"),
                    qsTr("Draw the section's outline. The stroke lands " +
                        "on the SECTION layers because it is inside " +
                        "the bay -- where you drag is what decides the " +
                        "view, here as everywhere."));
            } else if (name === "traceFloorButton") {
                button = makeButton(qsTr("Trace Floor"),
                    qsTr("Draw floor detail inside the outline: a mud " +
                        "bank, a breakdown pile, a ledge."));
            } else if (name === "symbolButton") {
                button = makeButton(qsTr("Place Symbol"),
                    qsTr("Place the symbol the palette last had armed. " +
                        "Open the palette itself to choose another."));
            } else if (name === "moreFeaturesButton") {
                button = makeButton(qsTr("More Features..."),
                    qsTr("Open the Feature Trace panel, for the " +
                        "features this tab does not carry."));
            } else if (name === "captureButton") {
                button = makeButton(qsTr("Capture Section"),
                    qsTr("Place what you traced as a section block, " +
                        "with a leader back to its station, and tear " +
                        "the bay down."));
            } else if (name === "cancelBayButton") {
                button = makeButton(qsTr("Cancel Bay"),
                    qsTr("Remove the frame, the scan and the ghost. " +
                        "Whatever you traced stays exactly where it is."));
            } else {
                continue;
            }
            set[name] = button;
            // ONE BUTTON PER ROW. A side dock should be tall and
            // narrow, and the widest row is what the panel can never be
            // narrower than -- these labels are sentences.
            grid.addWidget(button, row, 0, 1, 2);
            row += 1;
        }
        // The buttons keep their natural height: whatever room the dock has to spare goes to an empty last row,
        // not into the gaps between (and the height of) the buttons.
        try {
            grid.setRowStretch(row, 1);
            grid.setVerticalSpacing(4);
        } catch (eStretch) {
            // a bridge without these leaves the buttons as they were
        }
        page.setLayout(grid);
        return { page: page, set: set };
    };

    // THE ORDERS. Plan and profile are the same job against different
    // stations: pick the stations on the scan, and failing that, fetch
    // a scan from anywhere and fit it by hand. A section is a different job entirely -- it starts
    // at the bay.
    var PLAN_ORDER = ["pickAlignButton", "pickCancelButton",
        "elsewhereButton"];
    var SECTION_ORDER = ["sketchButton", "calibration",
        "elsewhereButton"];
    // THE BAY'S OWN BUTTONS, in the order the work happens: trace the
    // walls, trace the floor, put a symbol on it, and when it is a
    // section, capture it. See SketchScans.syncContext for why these
    // are a TAB rather than another panel.
    var BAY_ORDER = ["traceWallsButton", "traceFloorButton",
        "symbolButton", "moreFeaturesButton", "captureButton",
        "cancelBayButton"];

    var planPage = makePage(PLAN_ORDER);
    var profilePage = makePage(PLAN_ORDER);
    var sectionPage = makePage(SECTION_ORDER);
    var bayPage = makePage(BAY_ORDER);
    w.buttonSets = [planPage.set, profilePage.set, sectionPage.set,
        bayPage.set];

    w.tabs.addTab(planPage.page, qsTr("Plan"));
    w.tabs.addTab(profilePage.page, qsTr("Profile"));
    w.tabs.addTab(sectionPage.page, qsTr("Cross Section"));
    // THE FOURTH TAB IS A CONTEXT, not a view: it is the bay you are
    // standing in, and it only exists while you are standing in one.
    w.tabs.addTab(bayPage.page, qsTr("In the Bay"));
    w.bayTab = 3;
    try {
        w.tabs.setTabEnabled(w.bayTab, false);
        w.tabs.currentIndex = 0;
        w.tabs.toolTip = qsTr("Which view you are sketching. Profile " +
            "assigns to the ELEVATION's own stations, on " +
            "CTRL-PROFILE-SCAN, following its band when the elevation " +
            "is redrawn. Cross Section assigns to the PLAN's stations " +
            "-- a section is cut at a plan station, not its own -- and " +
            "lands on CTRL-SECTION-SCAN.");
    } catch (eTabInit) {
    }
    try {
        // `currentChanged`, and the same reasoning the old combo used
        // `activated` for: switching tabs changes which view a scan is
        // being assigned to, so the gate has to be recomputed.
        w.tabs["currentChanged(int)"].connect(function() {
            SketchScans.updateTrimGate();
        });
    } catch (eTabConn) {
    }

    // REFRESH SITS ABOVE THE TABS, because it is about the LIST rather
    // than about any one workflow: re-reading the folder is the same
    // act whichever view you are sketching.
    w.refreshButton = makeButton(qsTr("Refresh"),
        qsTr("Re-read the scans folder -- new scans appear here once " +
            "Drive has synced them."));
    layout.addWidget(w.refreshButton, 0, 0);
    layout.addWidget(w.tabs, 0, 0);
    try {
        // the tabs take only the height their buttons need; the scan list and preview get the rest
        w.tabs.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum);
    } catch (ePolicy) {
        // the tabs then size as before
    }

    // Every copy of a button, wired once each.
    SketchScans.eachButton(w, "pickAlignButton", function(b) {
        b.clicked.connect(function() { SketchScans.pickAlignClicked(); });
    });
    SketchScans.eachButton(w, "elsewhereButton", function(b) {
        b.clicked.connect(function() { chooseElsewhere(); });
    });
    SketchScans.eachButton(w, "sketchButton", function(b) {
        b.clicked.connect(function() { SketchScans.sketchClicked(); });
    });
    SketchScans.eachButton(w, "lrudCombo", function(c) {
        try {
            c.activated.connect(function() { SketchScans.correctLetter(); });
        } catch (eLrudConn) {
            // no correction on this bridge: the inferred letter stands
        }
    });
    SketchScans.eachButton(w, "calibCancelButton", function(b) {
        b.clicked.connect(function() { SketchScans.endCalibration(); });
    });
    SketchScans.eachButton(w, "pickCancelButton", function(b) {
        b.clicked.connect(function() { SketchScans.cancelPicking(); });
    });
    SketchScans.eachButton(w, "traceWallsButton", function(b) {
        b.clicked.connect(function() {
            SketchScans.traceInBay(CsLayers.WALLS_SURVEYED);
        });
    });
    SketchScans.eachButton(w, "traceFloorButton", function(b) {
        b.clicked.connect(function() {
            SketchScans.traceInBay(CsLayers.FLOOR);
        });
    });
    SketchScans.eachButton(w, "symbolButton", function(b) {
        b.clicked.connect(function() { SketchScans.placeInBay(); });
    });
    SketchScans.eachButton(w, "moreFeaturesButton", function(b) {
        b.clicked.connect(function() {
            SketchScans.showDraw("trace");
        });
    });
    SketchScans.eachButton(w, "captureButton", function(b) {
        b.clicked.connect(function() { SketchScans.sketchClicked(); });
    });
    SketchScans.eachButton(w, "cancelBayButton", function(b) {
        b.clicked.connect(function() { SketchScans.cancelBay(); });
    });

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "SketchScans", qsTr("Sketch Scans"));
    SketchScans.w = w;
    // Nothing is selected yet, so nothing is placeable yet.
    SketchScans.updateTrimGate();

    var selectedFile = function() {
        var row = w.list.currentRow();
        if (row < 0 || row >= w.rows.length) { return null; }
        return w.rows[row].kind === "file" ? w.rows[row].rel : null;
    };
    // The trim functions live on SketchScans rather than in this
    // closure -- the buttons above are connected before they exist --
    // so they reach the selection through here.
    SketchScans.selectedRel = selectedFile;

    /** The folder a dropped scan lands in, RELATIVE to the scans root.
     *
     *  Whatever the caver is looking at: the selected folder row, or
     *  the folder the selected page is in. A trip's pages belong
     *  together, and someone who has just been browsing 12-1-24 and
     *  drops three more photos means those three are 12-1-24's. With
     *  nothing selected they go to the root, which is where a scans
     *  folder starts anyway. */
    SketchScans.dropFolder = function() {
        try {
            var row = w.list.currentRow();
            if (row < 0 || row >= w.rows.length) {
                return "";
            }
            var entry = w.rows[row];
            if (entry.kind === "folder") {
                return String(entry.rel);
            }
            var rel = String(entry.rel);
            var cut = rel.lastIndexOf("/");
            return cut <= 0 ? "" : rel.substring(0, cut);
        } catch (e) {
            return "";
        }
    };

    /**
     * Copies dropped image files into the cave's own scans folder.
     *
     * COPIES, never moves: the file a caver dragged is theirs and may
     * be the only copy -- off a phone, out of a download folder, in a
     * message thread. Taking it out from under them to tidy up a panel
     * is not this tool's decision to make.
     *
     * A NAME ALREADY IN USE is not overwritten either. The new file
     * gets " (2)", " (3)" and so on, because two pages photographed on
     * different trips are called IMG_4021.jpg every bit as often as one
     * page photographed twice.
     */
    SketchScans.acceptDroppedFiles = function(paths) {
        if (isNull(w.scans) || w.scans === "" || isNull(paths) ||
                paths.length === 0) {
            EAction.handleUserMessage(qsTr("Open a cave first -- there is " +
                "no scans folder to put those in yet."));
            return;
        }
        var folder = SketchScans.dropFolder();
        var dest = w.scans + (folder === "" ? "" : "/" + folder);
        try {
            new QDir().mkpath(dest);
        } catch (eDir) {
        }

        var copied = [], refused = [];
        for (var i = 0; i < paths.length; i++) {
            var info = new QFileInfo(String(paths[i]));
            var base = String(info.completeBaseName());
            var suffix = String(info.suffix());
            var target = dest + "/" + base + "." + suffix;
            var n = 2;
            while (new QFileInfo(target).exists()) {
                target = dest + "/" + base + " (" + n + ")." + suffix;
                n++;
                if (n > 500) {
                    break;   // something is very wrong; do not spin
                }
            }
            var ok = false;
            try {
                ok = new QFile(String(paths[i])).copy(target) === true;
            } catch (eCopy) {
                ok = false;
            }
            if (ok) {
                copied.push(new QFileInfo(target).fileName());
            } else {
                refused.push(info.fileName());
            }
        }

        if (copied.length > 0) {
            SketchScans.refresh();
        }
        var where = (folder === "" ? qsTr("the cave's scans folder") : folder);
        if (copied.length > 0 && refused.length === 0) {
            EAction.handleUserMessage(qsTr("Copied %1 into %2: %3")
                .arg(copied.length).arg(where).arg(copied.join(", ")));
        } else if (copied.length > 0) {
            EAction.handleUserMessage(qsTr("Copied %1 into %2; could not " +
                "copy %3").arg(copied.length).arg(where)
                .arg(refused.join(", ")));
        } else {
            EAction.handleUserMessage(qsTr("None of those could be copied " +
                "into %1.").arg(where));
        }
    };

    // The view knows about views and nothing about cave folders, so the
    // panel hands it the handler rather than the other way round.
    try {
        CsScanView.onFilesDropped = function(paths) {
            SketchScans.acceptDroppedFiles(paths);
        };
    } catch (eDrop) {
    }

    var showMessage = function(text) {
        w.preview.text = text;
        try {
            w.preview.visible = (text !== "");
        } catch (eVis) {
        }
    };

    var showPreview = function() {
        var rel = selectedFile();
        showMessage("");
        try {
            w.preview.setPixmap(new QPixmap());
        } catch (eClear) {
        }

        if (w.scanView !== null) {
            if (rel === null || w.scans === null) {
                try {
                    w.scanView.di.clear();
                    w.scanView.band = null;
                } catch (eEmpty) {
                }
                SketchScans.w.trim = null;
                SketchScans.updateTrimGate();
                return;
            }
            try {
                w.pickLabel.text = "";
            } catch (eClearPick) {
            }
            if (w.picking !== null && w.picking.rel !== rel) {
                // ANOTHER SCAN: the picks belonged to the old one.
                //
                // THROUGH cancelPicking, which is the only thing that
                // puts back everything an assignment takes. Dropping
                // the picks and relabelling the button by hand -- what
                // this did -- left the VIEW TABS locked, because they
                // are disabled while picks are being taken so a scan
                // cannot be fitted to half a plan and half an
                // elevation. No assignment was running any more and
                // there was still no way back to another tab: the
                // second half of the same dead end the Cancel button
                // exists for.
                SketchScans.cancelPicking();
            }
            // Likewise for a calibration: the two clicks are pixels on
            // ONE scan, and carrying them onto another would scale the
            // new sketch by the old one's page -- silently, and
            // plausibly enough to be traced before anyone noticed.
            if (w.calibrating !== null && w.calibrating.rel !== rel) {
                SketchScans.endCalibration();
            }
            if (!CsScanPreview.show(w.scanView, w.scans + "/" + rel)) {
                showMessage(qsTr("unreadable image"));
                SketchScans.w.trim = null;
                SketchScans.updateTrimGate();
                return;
            }
            // A NEW SCAN IS A NEW CHOICE. Carrying the last scan's box
            // onto this one would trim a different page to a rectangle
            // that meant something only on the old one.
            SketchScans.w.trim = { rel: rel, rect: null, path: null,
                                   chosen: false };
            SketchScans.resetTrim(false);
            return;
        }

        // No embeddable view in this build: the scaled pixmap, as before.
        if (rel === null || w.scans === null) {
            return;
        }
        try {
            var pixmap = new QPixmap(w.scans + "/" + rel);
            if (pixmap.isNull()) {
                showMessage(qsTr("unreadable image"));
                return;
            }
            // Scale to the pane's ACTUAL size -- the user sets it with
            // the splitter handle and by resizing the dock.
            var paneW = Math.max(120, w.preview.width - 8);
            var paneH = Math.max(32, w.preview.height - 8);
            w.preview.setPixmap(pixmap.scaled(paneW, paneH,
                Qt.KeepAspectRatio, Qt.SmoothTransformation));
        } catch (e) {
            showMessage(qsTr("unreadable image"));
        }
    };

    var toggleFolder = function(rowIdx) {
        var row = w.rows[rowIdx];
        if (row === undefined || row.kind !== "folder") { return; }
        if (w.collapsed[row.rel] === true) {
            delete w.collapsed[row.rel];
        } else {
            w.collapsed[row.rel] = true;
        }
        try {
            w.list.item(rowIdx, 0).setText(
                SketchScans.rowText(row, w.collapsed, w.bookmarks, w.rows));
        } catch (eGlyph) {
            // a stale glyph is cosmetic; the rows still fold
        }
        SketchScans.applyHidden();
        SketchScans.saveCollapsed(w.scans, w.collapsed, w.rows);
    };

    // THE ONE INSERT-THEN-ALIGN PATH. Both the double-click on a listed
    // scan and "Add a scan from elsewhere..." (a file picked from
    // anywhere) end here, so there is exactly one place that inserts an
    // image and hands it to the align tool -- see SketchScans.insert
    // and SketchScans.alignSoon.
    //
    // NO BUTTON OF ITS OWN ANY MORE (Nathan, 2026-09-14). "Insert &&
    // Align" sat beside "Assign Stations to Scans" offering the same
    // end -- a scan placed and fitted -- by the weaker means, and a
    // panel that offers two routes to one place makes the caver choose
    // between them every time. The 2-point fit still matters for a scan
    // whose station marks cannot be read, so it keeps two doors: the
    // double-click on a row, and the elsewhere button.
    var insertAndAlign = function(path, name, trimRect, outline) {
        var di = EAction.getDocumentInterface();
        var doc = EAction.getDocument();
        if (isNull(di) || isNull(doc)) { return; }
        var placed = SketchScans.insert(doc, di, path, name,
            frameNow(), trimRect, outline);
        if (placed === null) {
            return;                 // insert already explained why
        }
        // Before the align tool takes over: its first question is
        // "click a point on the image", which needs the image visible.
        SketchScans.zoomToPlaced(doc, di, placed);
        SketchScans.alignSoon(placed);
    };

    var chooseInsert = function() {
        var rel = selectedFile();
        if (rel === null || w.scans === null) { return; }
        var doc = EAction.getDocument();
        if (isNull(doc)) { return; }
        // The active drawing can change under a dock. If it did, the
        // list belongs to some other cave: rebuild instead of dropping
        // one cave's sketch into another cave's map.
        var folder = CsCave.folderOf(doc.getFileName());
        var scansNow = folder === null ? null :
            CsCave.findSubfolder(folder, CsCave.SCANS);
        if (scansNow !== w.scans) {
            SketchScans.refresh();
            return;
        }
        var eff = SketchScans.effectivePath(rel);
        if (eff === null) { return; }
        insertAndAlign(eff.path, rel, eff.rect, eff.outline);
    };

    /**
     * The cave-relative name of a path that turns out to live in THIS
     * cave's scans folder, or null when it is from anywhere else.
     *
     * WHY THE DIALOG LOOKS INSIDE THE FOLDER AT ALL. This button is now
     * the discoverable door to the 2-point fit -- the "Insert && Align"
     * button that only ever offered listed scans is gone -- so a caver
     * reaching for it will sometimes pick a file that IS in scans/. A
     * path treated as foreign there loses two things the listed route
     * had: the cave-relative tag, and any trim or traced outline
     * standing for that scan. Recognising it costs one comparison.
     */
    var relativeToScans = function(path) {
        if (w.scans === null || w.scans === undefined) { return null; }
        try {
            var root = new QFileInfo(w.scans).canonicalFilePath();
            var file = new QFileInfo(path).canonicalFilePath();
            if (isNull(root) || isNull(file)) { return null; }
            root = String(root);
            file = String(file);
            if (root === "" || file === "") { return null; }
            if (file.indexOf(root + "/") !== 0) { return null; }
            return file.substring(root.length + 1);
        } catch (e) {
            return null;            // no canonical path: treat as foreign
        }
    };

    // A FILE PICKED FROM ANYWHERE has no cave-relative name to tag it
    // with, so the file's own base name stands in -- it never has to
    // match anything in scans/, it is only ever read back by
    // CsTags.get(entity, "SketchScan") for display and for
    // placedCountOf's count of copies from one source. A file that does
    // live in scans/ keeps its relative name and its trim: see
    // relativeToScans.
    var chooseElsewhere = function() {
        var doc = EAction.getDocument();
        if (isNull(doc)) { return; }
        var path = CsFiles.openFile(getMainWindow(),
            qsTr("Select a scan to align"),
            (w.scans === null || w.scans === undefined) ? "" : w.scans,
            qsTr("Images (*.png *.jpg *.jpeg *.tif *.tiff *.bmp)"));
        if (isNull(path) || String(path) === "") { return; }
        path = String(path);
        var rel = relativeToScans(path);
        if (rel !== null) {
            var eff = SketchScans.effectivePath(rel);
            if (eff !== null) {
                insertAndAlign(eff.path, rel, eff.rect, eff.outline);
                return;
            }
        }
        var name = new QFileInfo(path).fileName();
        insertAndAlign(path, name, null, null);
    };

    /** The drawing's plotted stations, and the order to walk them. */
    /** Which view the picks are being taken in: the combo decides.
     *  ONE FRAME AT A TIME, deliberately -- offering the plan's
     *  stations and the elevation's together would double a list that
     *  is already long enough to hunt through. */
    var frameNow = function() {
        try {
            if (isNull(SketchScans.w) ||
                    isNull(SketchScans.w.tabs)) {
                return "plan";
            }
            switch (SketchScans.frameIndex()) {
            case 1:  return "profile";
            case 2:  return "section";
            default: return "plan";
            }
        } catch (e) {
            return "plan";
        }
    };

    /** The places pickable in the current frame, in reading order. */
    var stationsNow = function() {
        var doc = EAction.getDocument();
        if (isNull(doc)) {
            return null;
        }
        try {
            var places = CsScanFrame.placesIn(doc,
                CsScanFrame.stationFrameFor(frameNow()));
            if (places.length === 0) {
                return null;
            }
            // Reading order -- A1, A2, A9, A10 -- so a name is found by
            // reading rather than hunted for.
            places.sort(function(a, b) {
                return CsStationOrder.naturalCompare(a.label, b.label);
            });
            var labels = [];
            for (var i = 0; i < places.length; i++) {
                labels.push(places[i].label);
            }
            return { places: places, names: labels };
        } catch (e) {
            return null;
        }
    };

    /** The place one offered label belongs to. */
    var placeOfLabel = function(ctx, label) {
        for (var i = 0; i < ctx.places.length; i++) {
            if (ctx.places[i].label === label) {
                return ctx.places[i];
            }
        }
        return null;
    };

    var pickStatus = function(text) {
        try {
            w.pickLabel.text = text;
        } catch (e) {
        }
    };

    /** Every pick so far, and what to do next. */
    var refreshPickState = function() {
        if (w.picking === null) {
            SketchScans.setText("pickAlignButton", qsTr("Assign Stations to Scans"));
            SketchScans.setVisible("pickCancelButton", false);
            return;
        }
        // THE WAY OUT IS ALWAYS THERE while an assignment is running,
        // whatever the other button currently says.
        SketchScans.setVisible("pickCancelButton", true);
        var n = w.picking.pairs.length;
        // ONE STATION IS A PLACEMENT NOW, at the scale the scans
        // already placed agree on -- so the button offers it, and says
        // which kind of placement it would be. The wording matters: a
        // one-station place is assumed north-up and borrowed-scale, and
        // a caver who does not know that will not know to turn it.
        SketchScans.setText("pickAlignButton", (n >= 2) ?
            qsTr("Place (%1 stations)").arg(n) :
            (n === 1 ? qsTr("Place (1 station, north-up)") :
                qsTr("Cancel")));
        pickStatus(n === 0 ?
            qsTr("Click station 1 on the scan") :
            (n === 1 ?
                qsTr("1 picked -- click another to fit properly, or " +
                    "Place it north-up at the other scans' scale") :
                qsTr("%1 picked -- click another, or Place").arg(n)));
    };

    // =================================================================
    // SETTING A SECTION'S SCALE IN THE PREVIEW.
    //
    // A cross-section scan has no scale. The station it is cut at DOES:
    // its LRUD says how far the wall, floor and ceiling really are. So
    // the scale is one division -- a known distance over the pixels it
    // covers on the page -- and both halves are available here, before
    // anything is placed in the drawing.
    //
    // WHY IN THE DOCK RATHER THAN IN THE CAD VIEW. The bay used to open
    // auto-fitted to the ghost's width and the caver rescaled the scan
    // by hand over the outline. That is fitting by eye against a
    // reference, over a faded image, with the mouse -- and it is the
    // step of this workflow that takes longest and is easiest to get
    // wrong. Two clicks on the scan itself, at whatever zoom makes the
    // marks readable, is the same information measured instead of
    // judged. The station must be chosen FIRST, because the station is
    // where the known distance comes from.
    // =================================================================

    /** The station's LRUD read as the caver would say it, for a
     *  readout: "L 4.5  R 3  U 11  D 2", or "" when nothing is known. */
    var lrudText = function(lrud) {
        var parts = [];
        for (var i = 0; i < CsSectionBay.LRUD_LETTERS.length; i++) {
            var letter = CsSectionBay.LRUD_LETTERS[i];
            var d = CsSectionBay.lrudDistance(lrud, letter);
            if (d !== null) {
                parts.push(letter + " " + (Math.round(d * 100) / 100));
            }
        }
        return parts.join("  ");
    };

    /** What the panel says about the calibration as it stands, and what
     *  the Sketch Section button offers to do next. */
    var refreshCalibState = function() {
        var c = w.calibrating;
        try {
            SketchScans.setVisible("lrudCombo", (c !== null && c.to !== null));
            SketchScans.setVisible("calibCancelButton", (c !== null));
        } catch (eVis) {
        }
        if (c === null) {
            try {
                SketchScans.setText("sketchButton", qsTr("Sketch Section"));
                SketchScans.setFrameEnabled(true);
            } catch (eIdle) {
            }
            // THE GATE HAS THE LAST WORD on the placement buttons: an
            // idle calibration is not a reason to offer a placement for
            // a scan nobody has trimmed yet.
            SketchScans.updateTrimGate();
            return;
        }
        // Locked for the same reason the alignment locks them: the
        // station and the frame belong to THIS calibration, not to
        // whatever the panel is set to by the time the bay opens.
        try {
            SketchScans.setEnabled("pickAlignButton", false);
            SketchScans.setFrameEnabled(false);
            SketchScans.setEnabled("sketchButton", true);
        } catch (eLock) {
        }
        var known = lrudText(c.lrud);
        if (c.from === null) {
            pickStatus(qsTr("%1: click the STATION point on the scan")
                .arg(c.station) + (known === "" ? "" : "  (" + known + ")"));
        } else if (c.to === null) {
            pickStatus(qsTr("Now click a wall on the outline -- above " +
                "for U, below for D, left for L, right for R"));
        } else if (c.cal !== null && c.cal.refused === "nolrud") {
            pickStatus(qsTr("%1 has no %2 measured, so it cannot set a " +
                "scale. Pick another letter, or open the bay unscaled.")
                .arg(c.station).arg(String(c.cal.letter)) +
                (known === "" ? "" : "  (" + known + ")"));
        } else if (c.cal !== null && c.cal.refused !== undefined) {
            pickStatus(qsTr("Those two clicks are the same point -- " +
                "click the station, then a wall."));
        } else if (c.cal !== null) {
            // WHAT IT MEASURED AND WHAT FELL OUT OF IT, both. The
            // distance alone does not say whether the pick was any
            // good; the units-per-pixel is the number that is about to
            // place the scan, so it is the one the caver can sanity-
            // check against the other scans in this cave.
            pickStatus(qsTr("%1 = %2 over %3 px  --  %4 units/pixel")
                .arg(String(c.cal.letter))
                .arg(Math.round(c.cal.distance * 100) / 100)
                .arg(Math.round(c.cal.pixels))
                .arg(Math.round(c.cal.unitsPerPixel * 100000) / 100000) +
                (c.cal.inferred === true ? "" : qsTr("  (corrected)")));
        }
        try {
            SketchScans.setText("sketchButton", (c.cal !== null &&
                c.cal.refused === undefined) ?
                qsTr("Open Bay (scaled)") : qsTr("Open Bay (unscaled)"));
        } catch (eText) {
        }
    };

    /** Re-read the two clicks, against the letter now in force. */
    var recalibrate = function() {
        var c = w.calibrating;
        if (c === null || c.from === null || c.to === null) {
            return;
        }
        c.cal = CsSectionBay.calibrationFrom(c.from, c.to, c.lrud,
            CsSectionDraw.scaleOf(), c.forced);
        // The combo follows the letter in force, so the caver is
        // correcting FROM the guess rather than from whatever the combo
        // happened to be left on.
        try {
            var letter = String(c.cal.letter);
            for (var i = 0; i < CsSectionBay.LRUD_LETTERS.length; i++) {
                if (CsSectionBay.LRUD_LETTERS[i] === letter) {
                    SketchScans.setLrudIndex(i);
                }
            }
        } catch (eSync) {
        }
    };

    /** A left-click on the scan while a calibration is running. */
    var takeCalibrationPick = function(point) {
        var c = w.calibrating;
        // A THIRD CLICK STARTS OVER rather than being ignored. Once
        // there is a readout the caver can see whether the pair was any
        // good, and "click the station again" is the obvious way to
        // redo it -- there is no other gesture that would mean anything
        // at that moment.
        if (c.from === null || c.to !== null) {
            c.from = { x: point.x, y: point.y };
            c.to = null;
            c.cal = null;
            c.forced = null;
        } else {
            c.to = { x: point.x, y: point.y };
            recalibrate();
        }
        refreshCalibState();
    };

    /** The caver disagrees with the inferred letter. */
    var correctLetter = function() {
        if (w.calibrating === null) {
            return;
        }
        try {
            w.calibrating.forced =
                CsSectionBay.LRUD_LETTERS[SketchScans.lrudIndex()];
        } catch (e) {
            return;
        }
        recalibrate();
        refreshCalibState();
    };

    /** Put the panel back to idle, calibrated or not. */
    var endCalibration = function() {
        w.calibrating = null;
        refreshCalibState();
        pickStatus("");
    };

    /** Open the bay with whatever the calibration came to. */
    var openCalibratedBay = function() {
        var c = w.calibrating;
        if (c === null) {
            return;
        }
        // A REFUSED CALIBRATION IS NOT A FAILURE, it is the old
        // behaviour: null here means SectionBay auto-fits exactly as
        // it always did, and the caver scales by hand over the ghost.
        var cal = (c.cal !== null && c.cal !== undefined &&
            c.cal.refused === undefined && c.cal.unitsPerPixel > 0) ?
            { unitsPerPixel: c.cal.unitsPerPixel } : null;
        var path = c.path;
        var station = c.station;
        endCalibration();
        SketchScans.sketchSoon(path, station, cal);
    };

    /** The Sketch Section button: start a calibration, or finish one. */
    var sketchClicked = function() {
        if (w.calibrating !== null) {
            openCalibratedBay();
            return;
        }
        // A BAY IS OPEN: this button is Capture, per updateTrimGate.
        // Checked here rather than trusted from the label, so a stale
        // label can never run the wrong half.
        if (SketchScans.bayOpen(EAction.getDocument())) {
            SketchScans.captureSoon();
            return;
        }
        if (w.picking !== null) {
            return;               // an alignment owns the clicks already
        }
        var rel = selectedFile();
        if (rel === null || w.scans === null) {
            return;
        }
        var effSketch = SketchScans.effectivePath(rel);
        if (effSketch === null) {
            return;
        }
        var path = effSketch.path;
        // NO PREVIEW VIEW, NO CALIBRATION. A build that could not embed
        // the CAD view (CsScanPreview.build returned null) has nowhere
        // to take the two clicks, and the bay is still worth opening --
        // so it opens the way it always has rather than not at all.
        if (w.scanView === null) {
            SketchScans.sketchSoon(path);
            return;
        }
        var doc = EAction.getDocument();
        if (isNull(doc)) {
            return;
        }
        // THE STATION FIRST, always. The whole calibration is one
        // division by the station's own LRUD, so there is nothing to
        // measure until it is known which station that is -- and
        // choosing it afterwards would let the caver take two careful
        // clicks and then find the station has no measurement for them.
        var station = SectionBay.askStation(doc);
        if (station === null) {
            return;                       // cancelled: nothing starts
        }
        var lrud = SectionBay.lrudAt(doc, station);
        if (lrud === null) {
            // Nothing to calibrate against. Said out loud rather than
            // silently skipped: the caver is about to be handed the
            // hand-scaling workflow and should know why.
            CsTell.warn("Sketch Scans: " + station + " has no LRUD in this " +
                "drawing's survey, so there is no known distance to set " +
                "a scale from. The bay opens auto-fitted; scale the scan " +
                "by hand over the ghost.");
            SketchScans.sketchSoon(path, station, null);
            return;
        }
        w.calibrating = { path: path, rel: rel, station: station,
                          lrud: lrud, from: null, to: null,
                          forced: null, cal: null };
        refreshCalibState();
    };

    /** A left-click on the scan while an alignment is running. */
    var takePick = function(point) {
        if (w.calibrating !== null) {
            takeCalibrationPick(point);
            return;
        }
        if (w.picking === null) {
            // not aligning: the click is just a readout
            pickStatus(CsScanPreview.pixelText(point, w.scanView.heightPx));
            return;
        }
        var ctx = stationsNow();
        if (ctx === null) {
            CsTell.warn("Sketch Scans: this drawing has no " +
                (frameNow() === "profile" ? "elevation stations" :
                    "plotted stations") + " to assign.");
            w.picking = null;
            refreshPickState();
            return;
        }
        // used by LABEL, not name: in the elevation the same name is a
        // different place in each band it ties into
        var used = {};
        for (var i = 0; i < w.picking.pairs.length; i++) {
            used[w.picking.pairs[i].label] = true;
        }
        var offer = [];
        for (var k = 0; k < ctx.names.length; k++) {
            if (used[ctx.names[k]] !== true) {
                offer.push(ctx.names[k]);
            }
        }
        if (offer.length === 0) {
            CsTell.warn("Sketch Scans: every plotted station is already on " +
                "this scan.");
            return;
        }
        // THE NEXT STATION IN ORDER IS ALREADY SELECTED, so a run down
        // a passage is Enter, Enter, Enter and only the exceptions cost
        // a choice. "Next" means the first unused name after the last
        // one picked, in the same reading order the list is offered in.
        var start = 0;
        if (w.picking.pairs.length > 0) {
            var last = w.picking.pairs[w.picking.pairs.length - 1].label;
            var from = -1;
            for (var f = 0; f < ctx.names.length; f++) {
                if (ctx.names[f] === last) { from = f; break; }
            }
            for (var g = from + 1; g < ctx.names.length; g++) {
                if (used[ctx.names[g]] !== true) {
                    for (var h = 0; h < offer.length; h++) {
                        if (offer[h] === ctx.names[g]) { start = h; break; }
                    }
                    break;
                }
            }
        }
        // A DIALOG INSTANCE, NOT QInputDialog.getItem. The static
        // convenience function's C++ signature reports Cancel through an
        // `ok` OUT-PARAMETER, and this binding drops it -- so Cancel
        // returned the selected station exactly as OK did, and there was
        // no way to tell the two apart. Cancel simply did not work.
        //
        // An instance carries the answer in its own result: exec()
        // returns QDialog.Accepted only when the caver pressed OK.
        var chosen = null;
        try {
            var dlg = new QInputDialog(RMainWindowQt.getMainWindow());
            dlg.windowTitle = qsTr("Assign Stations to Scans");
            dlg.setLabelText(qsTr("Which station did you just click?"));
            // The station list itself, so a name cannot be mistyped and
            // one already used cannot be offered twice.
            dlg.setComboBoxEditable(false);
            dlg.setComboBoxItems(offer);
            if (start >= 0 && start < offer.length) {
                dlg.setTextValue(offer[start]);
            }
            if (dlg.exec() !== QDialog.Accepted) {
                return;                   // cancelled: the pick is dropped
            }
            chosen = dlg.textValue();
        } catch (eDlg) {
            chosen = null;
        }
        if (chosen === null || chosen === undefined || chosen === "") {
            return;                       // nothing chosen, nothing recorded
        }
        var place = placeOfLabel(ctx, String(chosen));
        if (place === null) {
            return;
        }
        w.picking.pairs.push({
            name: place.name,
            label: place.label,
            run: place.run,
            source: { x: point.x, y: point.y },
            dest: { x: place.pos.x, y: place.pos.y }
        });
        // The frame is fixed by the FIRST pick, so a scan cannot end up
        // fitted to half a plan and half an elevation.
        if (w.picking.frame === undefined || w.picking.frame === null) {
            w.picking.frame = frameNow();
        }
        refreshPickState();
    };

    /**
     * Place a scan through a SINGLE station.
     *
     * Two stations measure a placement; one cannot, so the two numbers
     * a placement needs come from elsewhere and are both stated out
     * loud:
     *
     *   THE SCALE is the median units-per-pixel of the scans already
     *   placed in this drawing. Pages of one survey are drawn at the
     *   same one or two scales, so the neighbours are the best evidence
     *   there is -- and with no neighbours there is no evidence at all,
     *   which is the one case this refuses rather than guesses at.
     *
     *   THE TURN is north-up: the page's own up is the drawing's up.
     *   That is a starting position, not a claim, so the scan is handed
     *   straight to ScanTurn for the caver to swing round by hand with
     *   the scale locked.
     *
     * The anchor lands exactly on its station either way.
     */
    var placeOneStation = function() {
        var di = EAction.getDocumentInterface();
        var doc = EAction.getDocument();
        if (isNull(doc) || isNull(di) || w.picking === null ||
                w.picking.pairs.length !== 1) {
            return;
        }
        var neighbours = SketchScans.placedScales(doc);
        var perPixel = CsScanFit.medianOf(neighbours);
        if (perPixel === null) {
            CsTell.warn("Sketch Scans: there is no scan placed in this " +
                "drawing yet, so there is no scale to borrow. Pick a " +
                "second station on this scan -- the two of them " +
                "measure the scale -- and every one-station sketch " +
                "after it can lean on this one.");
            return;
        }
        var pair = w.picking.pairs[0];
        var matrix = CsScanFit.anchoredFit(pair, perPixel, 0);
        if (matrix === null) {
            CsTell.warn("Sketch Scans: the borrowed scale is not a usable " +
                "number.");
            return;
        }
        var rel = w.picking.rel;
        var frame = CsScanFrame.normaliseKind(w.picking.frame);
        var effOne = SketchScans.effectivePath(rel);
        if (effOne === null) { return; }
        var placedOne = SketchScans.insertFitted(doc, di, effOne.path, rel,
            { matrix: matrix, kind: "anchored" }, w.scanView.heightPx,
            [pair], frame, effOne.rect);
        w.picking = null;
        try {
            SketchScans.setFrameEnabled(true);
        } catch (eUnlock) {
        }
        refreshPickState();
        pickStatus("");
        if (placedOne === null) {
            return;
        }
        SketchScans.zoomToPlaced(doc, di, placedOne);
        EAction.handleUserMessage(rel + " placed on " + pair.name +
            " north-up, at " + (Math.round(perPixel * 1000) / 1000) +
            " units per pixel -- the middle of the " + neighbours.length +
            " scan" + (neighbours.length === 1 ? "" : "s") +
            " already placed. Nothing here measured the scale or the " +
            "turn: turn it now, or align it to a second station later.");
        // STRAIGHT INTO THE TURN. The placement is deliberately
        // unfinished -- north-up is a starting position, not an answer
        // -- so the tool asks the question rather than leaving a scan
        // lying at an angle nobody chose.
        SketchScans.turnSoon(placedOne, pair.dest, pair.name);
    };

    /** Place the scan using the picks. */
    var placeAligned = function() {
        var di = EAction.getDocumentInterface();
        var doc = EAction.getDocument();
        if (isNull(doc) || isNull(di) || w.picking === null) {
            return;
        }
        // ONE STATION: nothing is fitted, two things are BORROWED.
        // The scale comes from the scans already in this drawing and
        // the turn from the caver, in the drawing, straight after --
        // see placeOneStation.
        if (w.picking.pairs.length === 1) {
            placeOneStation();
            return;
        }
        var fit = CsScanFit.fit(w.picking.pairs);
        if (fit === null) {
            CsTell.warn("Sketch Scans: those picks do not describe a fit -- " +
                "two stations in different places on the scan are the " +
                "least it takes.");
            return;
        }
        // A MIRRORED FIT IS NOT PLACED AT ALL. It lays the scan down
        // backwards, and it is never what a caver meant: the picks wind
        // one way on the scan and the other way in the drawing, so at
        // least one is on the wrong mark or carries the wrong name.
        // This used to warn and then place it anyway, which left the
        // caver to undo a scan the tool already knew was wrong.
        if (CsScanFit.isMirrored(fit.matrix)) {
            var which = "";
            if (w.picking.pairs.length >= 4) {
                var mres = CsScanFit.residuals(w.picking.pairs, fit.matrix);
                which = "\n\nThe worst-fitting pick is " +
                    w.picking.pairs[mres.worstIndex - 1].name + ".";
            } else {
                which = "\n\nWith " + w.picking.pairs.length +
                    " picks the fit passes through all of them exactly, " +
                    "so it cannot say WHICH one is wrong. A fourth " +
                    "station is the first one it can disagree with.";
            }
            CsTell.warn("Sketch Scans: these picks would lay the scan down " +
                "MIRRORED -- backwards, as if read through the paper." +
                "\n\nThey wind one way on the scan and the other way in " +
                "the drawing, so at least one is on the wrong mark or " +
                "has the wrong name." + which +
                "\n\nNothing has been placed. Cancel Align and re-pick.");
            return;
        }
        // Read the residuals BEFORE clearing the picks -- they are the
        // only report the caver gets on whether the fit is any good.
        var pairs = w.picking.pairs;
        var rel = w.picking.rel;
        var frame = CsScanFrame.normaliseKind(w.picking.frame);
        var res = CsScanFit.residuals(pairs, fit.matrix);
        // BEFORE placing: once the new scan is in, it would be counted
        // among the neighbours it is being judged against.
        var neighbours = SketchScans.placedScales(doc);
        var scale = CsScanFit.scaleOutlier(
            CsScanFit.describe(fit.matrix).unitsPerPixel, neighbours);
        // THE PREVIEW IS WHAT WAS PICKED ON. Once a box is set the
        // preview holds the DERIVATIVE, so the picked pixels and
        // heightPx are already in the crop's own space and the fit
        // needs no adjustment -- only the rect has to be recorded.
        var effFit = SketchScans.effectivePath(rel);
        if (effFit === null) { return; }
        var placed = SketchScans.insertFitted(doc, di,
            effFit.path, rel, fit, w.scanView.heightPx, pairs,
            frame, effFit.rect);
        w.picking = null;
        try {
            SketchScans.setFrameEnabled(true);
        } catch (eUnlock) {
        }
        refreshPickState();
        pickStatus("");
        SketchScans.zoomToPlaced(doc, di, placed);
        if (placed !== null) {
            // WHAT THE FIT ACTUALLY DID, in numbers -- and a warning
            // when the numbers say it cannot be right.
            //
            // THE RESIDUALS PROVE NOTHING at two or three picks: two
            // pairs fit a similarity exactly and three fit an affine
            // exactly, whichever station was called which. "Off by 0"
            // there is arithmetic, not evidence. What CAN be checked is
            // the shape of the answer.
            // THE PLACEMENT, CHECKED AGAINST QCAD'S OWN MAPPING. Every
            // anchor is run back through the placed image's
            // mapFromImage and compared with the station it was picked
            // for. This is the one measurement that separates "the
            // picks were wrong" from "the placement is wrong": if the
            // picks land on their stations, the tool did what it was
            // told and the picks are the thing to look at.
            try {
                var back = doc.queryEntity(placed);
                var worstBack = 0, worstName = "";
                if (!isNull(back)) {
                    var bd = back.getData();
                    for (var b = 0; b < pairs.length; b++) {
                        var got = bd.mapFromImage(new RVector(
                            pairs[b].source.x, pairs[b].source.y));
                        var ex = got.x - pairs[b].dest.x;
                        var ey = got.y - pairs[b].dest.y;
                        var miss = Math.sqrt(ex * ex + ey * ey);
                        if (miss > worstBack) {
                            worstBack = miss;
                            worstName = pairs[b].name;
                        }
                    }
                    if (worstBack > 0.01) {
                        CsTell.warn("Sketch Scans: the placed scan does not " +
                            "put " + worstName + " where the drawing has " +
                            "it -- out by " +
                            (Math.round(worstBack * 100) / 100) +
                            ". That is a placement fault, not a bad pick; " +
                            "please report it.");
                    } else {
                        EAction.handleUserMessage(qsTr("Placement " +
                            "verified: every picked station lands on its " +
                            "own point in the drawing."));
                    }
                }
            } catch (eVerify) {
                // the check is a courtesy; a scan that placed is placed
            }

            var d = CsScanFit.describe(fit.matrix);
            var turn = Math.round(d.turnDeg * 10) / 10;
            EAction.handleUserMessage("Cross-check: " +
                (Math.round(d.unitsPerPixel * 10000) / 10000) +
                " units per pixel, turned " + turn + " degrees" +
                (fit.kind === "affine" ? (", stretch " +
                    (Math.round(d.stretch * 100) / 100)) : "") + ".");
            if (scale.outlier === true) {
                CsTell.warn("Sketch Scans: this scan has landed " +
                    (scale.ratio > 1 ?
                        (Math.round(scale.ratio * 10) / 10) + " times LARGER" :
                        (Math.round(10 / scale.ratio) / 10) + " times SMALLER") +
                    " than the scans already in this drawing.\n\nOne " +
                    "cave's sketches are drawn at one or two scales, so " +
                    "that usually means a station was picked in the " +
                    "wrong place or named as the wrong station. Undo and " +
                    "check the picks.");
            } else if (fit.thin === true) {
                CsTell.warn("Sketch Scans: those stations lie too close to a " +
                    "straight line for a stretch-and-skew fit to mean " +
                    "anything -- across the line it would be guessing, " +
                    "and guessing there is what turns a scan sideways." +
                    "\n\nThe scan has been moved, turned and resized to " +
                    "the two furthest-apart picks instead, keeping its " +
                    "shape. For a fit that can correct a scanner's " +
                    "stretch, pick a station well OFF the line of the " +
                    "others.");
            } else if (pairs.length <= 3) {
                EAction.handleUserMessage(qsTr("Note: %1 picks always " +
                    "fit exactly, so a zero miss proves nothing. Add a " +
                    "fourth station to have the fit check itself.")
                    .arg(pairs.length));
            }
            EAction.handleUserMessage(rel + qsTr(" placed on ") +
                CsScanFrame.layerFor(frame) + qsTr(" from %1 stations, %2. ")
                    .arg(pairs.length).arg(how) +
                qsTr("Worst station is off by %1; the average is %2.")
                    .arg(Math.round(res.worst * 100) / 100)
                    .arg(Math.round(res.average * 100) / 100));
        }
    };

    /**
     * Abandons an assignment in progress.
     *
     * Everything it touched goes back: the picks are dropped, the view
     * tabs are unlocked (they are held while picks are taken, so a
     * scan cannot end up fitted to half a plan and half an elevation),
     * and the status line clears. NOTHING WAS DRAWN -- a pick is a
     * point on a scan and a station name, held in this panel and
     * nowhere else -- so there is nothing to undo and nothing to warn
     * about.
     */
    SketchScans.cancelPicking = function() {
        if (w.picking === null) {
            return;
        }
        w.picking = null;
        try {
            SketchScans.setFrameEnabled(true);
        } catch (eUnlock) {
        }
        refreshPickState();
        pickStatus("");
    };

    // Named rather than connected here: the button lives on the tabs
    // now, three copies of it, and they are wired where they are built.
    SketchScans.pickAlignClicked = function() {
        if (w.calibrating !== null) {
            return;               // a calibration owns the clicks already
        }
        if (w.picking !== null) {
            if (w.picking.pairs.length >= 1) {
                placeAligned();
            } else {
                // Nothing picked yet: this button still reads Cancel,
                // and it means the same thing the Cancel button does.
                SketchScans.cancelPicking();
            }
            return;
        }
        var rel = selectedFile();
        if (rel === null || w.scans === null || w.scanView === null) {
            return;
        }
        if (stationsNow() === null) {
            CsTell.warn("Sketch Scans: this drawing has no plotted stations " +
                "to align to. Draw the survey first.");
            return;
        }
        w.picking = { pairs: [], rel: rel, frame: null };
        try {
            // locked while picks are being taken: the frame belongs to
            // the set of picks, not to whatever the combo says later
            SketchScans.setFrameEnabled(false);
        } catch (eLock) {
        }
        refreshPickState();
    };

    w.list.itemSelectionChanged.connect(showPreview);
    // Remember the page we are on, so reopening this cave lands back
    // here instead of on the first scan still to do.
    w.list.itemSelectionChanged.connect(function() {
        // NOT WHILE THE TABLE IS BEING REBUILT: clearing and refilling
        // rows fires this signal with nothing selected, which would
        // erase the very memory the rebuild is about to land on.
        if (w.building === true) { return; }
        if (w.scans === null || w.scans === undefined) { return; }
        SketchScans.saveSelected(w.scans, SketchScans.selectedRel(),
            w.rows);
    });
    // Folder rows fold on a plain click.
    w.list.cellClicked.connect(function(row, col) { toggleFolder(row); });
    // Double-click by ROW: on a scan it inserts and aligns; on a folder
    // it does nothing more (the first click already toggled it) --
    // itemDoubleClicked alone would read the SELECTION and insert the
    // selected scan when a folder row was the thing double-clicked.
    try {
        w.list.cellDoubleClicked.connect(function(row, col) {
            if (w.rows[row] !== undefined && w.rows[row].kind === "file") {
                chooseInsert();
            }
        });
    } catch (eDbl) {
        // no row-aware double-click on this bridge; the buttons cover it
    }
    var toggleBookmark = function(row) {
        if (row === undefined || row === null) {
            row = w.list.currentRow();
        }
        if (row < 0 || row >= w.rows.length ||
                w.rows[row].kind !== "file" || w.scans === null) {
            return;
        }
        var rel = w.rows[row].rel;
        // READ-MODIFY-WRITE, and the set that comes back is the one on
        // disk -- not this panel's idea of it, which the other panel
        // may have moved on from since this list was filled.
        w.bookmarks = CsScanList.toggleComplete(w.scans, rel,
            SketchScans.listedRels(w.rows));
        SketchScans.repaintMarks();
        if (row >= 0) {
            w.list.selectRow(row);
        }
    };
    var markFolder = function(row, want) {
        if (row < 0 || row >= w.rows.length ||
                w.rows[row].kind !== "folder" || w.scans === null) {
            return;
        }
        w.bookmarks = CsScanList.setFolderComplete(w.scans,
            w.rows[row].rel, w.rows, want,
            SketchScans.listedRels(w.rows));
        SketchScans.repaintMarks();
        w.list.selectRow(row);
    };
    // The bookmark lives on the RIGHT-CLICK now, not on a button: it is
    // a per-scan action and it belongs on the scan, not in a row of
    // controls that apply to the panel.
    //
    // The menu acts on the row that was RIGHT-CLICKED, which is
    // selected first. Acting on the current selection instead would
    // bookmark whatever happened to be highlighted when the caver
    // right-clicked somewhere else -- silently, and on the wrong scan.
    try {
        w.list.contextMenuPolicy = Qt.CustomContextMenu;
        w.list.customContextMenuRequested.connect(function(pos) {
            try {
                // QPoint's x and y are FUNCTIONS in this bridge, not
                // properties (probed 2026-08-29). Reading pos.y would
                // hand rowAt a function object, and the menu would
                // silently never find a row.
                var py = (typeof pos.y === "function") ? pos.y() : pos.y;
                var row = w.list.rowAt(py);
                if (row === undefined || row === null || row < 0 ||
                        row >= w.rows.length) {
                    return;
                }
                w.list.selectRow(row);
                // Kept on `w` so it is not collected while it is open --
                // popup() returns immediately, unlike exec().
                w.scanMenu = new QMenu();
                if (w.rows[row].kind === "folder") {
                    // A TRIP AT A TIME. Forty pages come back from one
                    // trip and saying so should not cost forty
                    // right-clicks. The folder's tick already means
                    // "everything in here is done", so this sets it
                    // directly.
                    var fMarked = CsScanTree.folderComplete(
                        w.rows[row].rel, w.rows, w.bookmarks);
                    var fAct = w.scanMenu.addAction(
                        qsTr(CsScanList.folderMarkLabel(fMarked)));
                    try {
                        fAct.checkable = true;
                        fAct.checked = fMarked;
                    } catch (eFChk) {
                    }
                    fAct.triggered.connect(function() {
                        markFolder(row, !fMarked);
                    });
                    try {
                        CsScanList.addRevealAction(w.scanMenu, w.scans,
                            w.rows[row].rel, true);
                    } catch (eRevealF) {
                    }
                    // The tree's own leavings, on the tree's own menu:
                    // adds itself only when there are crops to delete.
                    try {
                        CsScanList.addFlushTrimmedAction(w.scanMenu,
                            w.scans,
                            function() { SketchScans.refresh(); });
                    } catch (eFlushF) {
                    }
                } else {
                    var rel = w.rows[row].rel;
                    var marked = w.bookmarks[rel] === true;
                    // The label lives in Core with the list that draws
                    // the tick, so every panel showing this list says
                    // the same words.
                    var act = w.scanMenu.addAction(
                        qsTr(CsScanList.markLabel(marked)));
                    try {
                        act.checkable = true;
                        act.checked = marked;
                    } catch (eChk) {
                    }
                    act.triggered.connect(function() {
                        toggleBookmark(row);
                    });
                    // A PDF of a whole trip is not a page anything here
                    // can trace; this is the way it becomes pages. The
                    // action adds itself only for a PDF row, and lives
                    // in Core so the Notebook's copy of this tree
                    // offers the same thing in the same words.
                    try {
                        CsScanList.addSplitAction(w.scanMenu,
                            w.scans, rel,
                            function() { SketchScans.refresh(); });
                    } catch (eSplit) {
                    }
                    // Everything this suite does NOT do to a scan --
                    // rename it, delete it, drag forty more in -- is
                    // done in Finder, and this is the way there.
                    try {
                        CsScanList.addRevealAction(w.scanMenu, w.scans,
                            rel, false);
                    } catch (eReveal) {
                    }
                    try {
                        CsScanList.addFlushTrimmedAction(w.scanMenu,
                            w.scans,
                            function() { SketchScans.refresh(); });
                    } catch (eFlush) {
                    }
                }
                w.scanMenu.popup(w.list.viewport().mapToGlobal(pos));
            } catch (eMenu) {
                // no context menu on this bridge: the scan is still
                // selectable and insertable, only the bookmark is out
                // of reach
            }
        });
    } catch (eCtx) {
    }
    w.refreshButton.clicked.connect(function() { SketchScans.refresh(); });
    // The tab buttons are wired where they are built, once per copy.

    // A re-shown dock re-reads the folder -- scans may have synced in
    // while it was hidden. Wrapped: not every bridge has the signal,
    // and without it the Refresh button covers the same ground.
    try {
        dock.visibilityChanged.connect(function(visible) {
            if (visible === true) {
                SketchScans.refresh();
            }
        });
    } catch (eVis) {
    }

    SketchScans.showPreview = showPreview;
    SketchScans.takePick = takePick;
    SketchScans.sketchClicked = sketchClicked;
    SketchScans.correctLetter = correctLetter;
    SketchScans.endCalibration = endCalibration;
    return dock;
};

// Everything between "panel is up" and "these are the scans": reads
// the ACTIVE drawing's cave folder and rebuilds the tree. Message
// states (no drawing, unsaved, no scans folder, nothing readable) land
// in the header label with the list empty and inserts disabled.
SketchScans.refresh = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) { return; }

    w.building = true;
    try {
        SketchScans.rebuild();
    } finally {
        w.building = false;
    }
};

// The rebuild itself, wrapped by refresh() so that the selection
// signals it fires along the way cannot write over the remembered
// scan.
SketchScans.rebuild = function() {
    var w = SketchScans.w;

    var message = null;
    var doc = EAction.getDocument();
    var scans = null;

    if (isNull(doc)) {
        message = qsTr("No drawing open.");
    } else {
        var folder = CsCave.folderOf(doc.getFileName());
        if (folder === null) {
            message = qsTr("Save the drawing first.\nThe scans live in " +
                "the cave project's scans/ folder, which sits beside " +
                "the drawing file.");
        } else {
            scans = CsCave.findSubfolder(folder, CsCave.SCANS);
            if (scans === null) {
                scans = CsCave.scansDir(doc.getFileName());
            }
            if (scans === null || !(new QDir(scans)).exists()) {
                message = qsTr("This cave has no scans/ folder yet.\n" +
                    "Put the sketch scans in ") +
                    CsCave.scansDir(doc.getFileName()) +
                    qsTr(" and press Refresh.");
                scans = null;
            }
        }
    }

    var files = [];
    if (message === null) {
        files = SketchScans.imageFiles(scans);
        if (files.length === 0) {
            message = qsTr("Nothing in ") + scans +
                qsTr(" reads as an image.\nScans in JPEG, PNG, TIFF " +
                "or HEIC all work.");
        }
    }

    w.scans = message === null ? scans : null;
    w.ready = message === null;
    // What this panel was built FROM -- the staleness listeners compare
    // against it and rebuild only when the answer would differ.
    w.stamp = (isNull(doc) ? "" : String(doc.getFileName())) + "|" +
        (scans === null ? "" : scans);
    // A REBUILT PANEL HAS NO SELECTION, so it has no trim choice
    // either; the gate turns the placement buttons back on when one is
    // made. Setting them from w.ready alone would offer a placement for
    // whatever row the table happens to restore.
    w.trim = null;
    SketchScans.updateTrimGate();

    if (!w.ready) {
        w.header.text = message;
        w.rows = [];
        w.collapsed = {};
        w.list.setRowCount(0);
        SketchScans.showPreview();
        return;
    }

    w.header.text = SketchScans.headerText(scans, files.length);
    try {
        // The full path, where it does not cost the drawing any room.
        w.header.toolTip = scans;
    } catch (eTip) {
    }

    w.rows = CsScanTree.rowsOf(files);
    w.collapsed = SketchScans.loadCollapsed(scans);
    w.bookmarks = SketchScans.loadBookmarks(scans);
    // While the Survey Notebook is open it is marking the same pages.
    // ONE SLOT per panel, so refilling replaces this rather than
    // stacking another closure on the old rows.
    CsScanList.watch("SketchScans", SketchScans.marksChanged);
    // ...and the page the other panel is on, for the same reason and
    // in the same one-slot-per-panel way.
    CsScanList.watchSelection("SketchScans", SketchScans.selectionElsewhere);

    CsScanList.fill(w.list, w.rows,
        { folder: scans, collapsed: w.collapsed, complete: w.bookmarks },
        { previewWidth: SketchScans.PREVIEW_W });

    // Initial selection: the scan this cave was left on. Only when
    // there is no memory of one -- a cave opened for the first time, a
    // scan since deleted, a row now inside a collapsed folder -- does
    // the panel guess, and its guess is the first scan still to do. A
    // mark meaning "finished" is not a place to return to: the last
    // thing you finished is the one scan with no work left on it.
    var landing = CsScanTree.rowOfRel(w.rows,
        SketchScans.loadSelected(scans), w.collapsed);
    if (landing < 0) {
        landing = CsScanTree.firstIncompleteRow(w.rows, w.bookmarks,
            w.collapsed);
    }
    if (landing < 0) {
        for (var s = 0; s < w.rows.length; s++) {
            if (w.rows[s].kind === "file" &&
                    !CsScanTree.isHidden(w.rows[s], w.collapsed)) {
                landing = s;
                break;
            }
        }
    }
    if (landing >= 0) {
        w.list.selectRow(landing);
        try {
            // selectRow alone does not bring a row into view in a long
            // list, which is exactly the list a bookmark exists for.
            w.list.scrollToItem(w.list.item(landing, 0));
        } catch (eScroll) {
            // no scrollToItem here: the row is still selected
        }
    }
    SketchScans.showPreview();
};

SketchScans.applyHidden = function() {
    var w = SketchScans.w;
    CsScanList.applyHidden(w.list, w.rows, w.collapsed);
};

// Rebuilds the panel ONLY when the active drawing (and with it the
// scans folder) is no longer the one the panel was built from -- the
// cheap fingerprint compare runs on every transaction and mouse move,
// the disk never gets touched until the answer would change.
SketchScans.refreshIfStale = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) { return; }
    if (csSketchScansDock === undefined || csSketchScansDock === null ||
            !csSketchScansDock.visible) {
        return;
    }
    var doc = EAction.getDocument();
    var scans = null;
    if (!isNull(doc)) {
        var folder = CsCave.folderOf(doc.getFileName());
        scans = folder === null ? null :
            CsCave.findSubfolder(folder, CsCave.SCANS);
    }
    var stamp = (isNull(doc) ? "" : String(doc.getFileName())) + "|" +
        (scans === null ? "" : scans);
    if (stamp !== w.stamp) {
        SketchScans.refresh();
        return;              // refresh runs the gate itself
    }
    // SAME DRAWING, POSSIBLY A DIFFERENT BAY. Opening a bay and
    // capturing one both change the drawing without changing its file
    // name, so the stamp above cannot see them -- and the Sketch/
    // Capture button has to follow that state or it offers the wrong
    // half of the workflow.
    SketchScans.updateTrimGate();
};

/**
 * Watches the application so a visible panel follows the active
 * drawing: a cave opened from the shelf, a tab switch, a first save.
 * Guarded to a fingerprint compare while hidden or unchanged -- a
 * dock must not make every transaction pay for a folder scan
 * (FeatureTrace's rule). Idempotent.
 */
SketchScans.installListener = function(appWin) {
    if (SketchScans.listener !== undefined) {
        return;
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(function(document, transaction) {
            try {
                SketchScans.refreshIfStale();
            } catch (eInner) {
                // a listener must never throw into the application
            }
        });
        SketchScans.listener = adapter;

        // Transactions alone miss a plain tab switch; the first mouse
        // move over the newly active drawing catches it.
        var coord = new RCoordinateListenerAdapter();
        appWin.addCoordinateListener(coord);
        coord.coordinateUpdated.connect(function(docIface) {
            try {
                SketchScans.refreshIfStale();
            } catch (eCoord) {
                // as above
            }
        });
        SketchScans.coordListener = coord;
    } catch (e) {
        SketchScans.listener = null;
        // without listeners the Refresh button and re-toggling cover it
    }
};

/**
 * WHICH FILE THE PLACEMENT ACTUALLY USES.
 *
 * The one accessor every placement path goes through -- Insert,
 * Insert & Align, Assign Stations to Scans and Sketch Section. A path
 * built by hand anywhere else is a path that will still place the whole
 * page after the caver drew a box.
 *
 * \return { path: <absolute>, rel: <page-relative>, rect: <box|null> },
 *         or null when nothing is selected.
 */
SketchScans.effectivePath = function(rel) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scans === null ||
            rel === null || rel === undefined) {
        return null;
    }
    if (w.trim !== null && w.trim !== undefined && w.trim.rel === rel &&
            w.trim.rect !== null && w.trim.rect !== undefined &&
            w.trim.path !== null && w.trim.path !== undefined) {
        return { path: w.trim.path, rel: rel, rect: w.trim.rect,
                 outline: (w.trim.outline === undefined) ? null
                     : w.trim.outline };
    }
    return { path: w.scans + "/" + rel, rel: rel, rect: null, outline: null };
};

/**
 * Back to "no choice made yet" for the selected scan: the page in the
 * preview, the band gone, the box armed and the placement buttons off.
 *
 * \param reload true when the preview is showing a derivative and has
 *        to go back to the page.
 */
SketchScans.resetTrim = function(reload) {
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var rel = (w.trim !== null && w.trim !== undefined) ? w.trim.rel :
        SketchScans.selectedRel();
    w.trim = (rel === null || rel === undefined) ? null :
        { rel: rel, rect: null, path: null, chosen: false };
    try {
        if (reload === true && rel !== null && rel !== undefined &&
                w.scans !== null && w.scanView !== null) {
            CsScanPreview.show(w.scanView, w.scans + "/" + rel);
        }
        if (w.scanView !== null) {
            CsScanPreview.armTrace(w.scanView, null, null);
            CsScanPreview.armBox(w.scanView, function(box) {
                SketchScans.boxDrawn(box);
            });
        }
        w.trimLabel.text = qsTr("Trim: drag a box, or Trace an outline");
    } catch (e) {
        // a bridge that cannot relabel still gates on the state below
    }
    SketchScans.updateTrimGate();
};

/** How many placed images in this drawing came from one scan. A
 *  rotation turns their pixels under them, so the count is what the
 *  confirmation warns with. */
SketchScans.placedCountOf = function(doc, rel) {
    var n = 0;
    if (isNull(doc)) {
        return 0;
    }
    try {
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (!isNull(e) && isImageEntity(e) &&
                    CsTags.get(e, "SketchScan") === rel) {
                n++;
            }
        }
    } catch (e) {
        // an uncountable drawing just gets the shorter warning
    }
    return n;
};

/**
 * A quarter turn clockwise, on the FILE.
 *
 * NO LONGER ASKS FIRST (Nathan's call, 2026-09-07). It used to raise a
 * Yes/No box every time, because this is the one button in the panel
 * that changes something outside the drawing: it re-encodes a survey
 * page in the cave's own scans folder, usually a synced Drive folder,
 * and CAD's undo does not reach it. What that ignored is how the button
 * is actually used -- a page comes off the scanner sideways and gets
 * turned once, twice, three times, and a confirmation on each is a box
 * to dismiss rather than a decision to make. A prompt answered by
 * reflex protects nothing.
 *
 * THE FACTS STILL GET SAID, afterwards, in the message the turn
 * reports: the file that was rewritten, its new size, any trimmed crops
 * dropped with it, and -- the one that matters -- how many placements
 * of this scan in this drawing just turned under their own alignment.
 * Four more presses put a page back where it started; what a re-encode
 * costs a JPEG cannot be undone by anything, prompt or no prompt.
 */
SketchScans.flipSelected = function() {
    SketchScans.rewriteSelected("flip");
};

SketchScans.rotateSelected = function() {
    SketchScans.rewriteSelected("turn");
};

/**
 * Turns or mirrors the selected page and says what it cost.
 *
 * ONE PATH FOR BOTH, because everything around the pixels is the same:
 * the same selection, the same crops dropped with the old pixels, the
 * same trim choice invalidated, and the same thing a caver has to act
 * on afterwards -- the placements of this page already in the drawing,
 * which keep their frames while the sketch inside them moves.
 *
 * \param kind "turn" or "flip"
 */
SketchScans.rewriteSelected = function(kind) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scans === null ||
            w.scans === undefined) {
        return;
    }
    var flipping = (kind === "flip");
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined) {
        CsTell.warn("Sketch Scans: select a scan to " +
            (flipping ? "mirror." : "rotate."));
        return;
    }

    // Counted BEFORE the rewrite, and reported after it: the
    // placements are what a caver has to act on, and they are the same
    // before and after -- this changes the pixels under them, not
    // their number.
    var placed = SketchScans.placedCountOf(EAction.getDocument(), rel);

    var done = flipping ? CsScanRotate.flip(w.scans, rel, "horizontal")
                        : CsScanRotate.turn(w.scans, rel);
    if (done.ok !== true) {
        CsTell.warn("Sketch Scans: " + done.error);
        return;
    }

    // THE TRIM CHOICE DIES WITH THE OLD PIXELS. A box drawn on the page
    // as it was is a box on a page that no longer exists, so the panel
    // goes back to "no choice made yet" and reloads the preview from
    // the rewritten file.
    SketchScans.resetTrim(true);
    var said = rel + (flipping ? qsTr(" mirrored left-for-right -- still ")
                               : qsTr(" rotated clockwise -- now ")) +
        done.w + " \u00d7 " + done.h + qsTr(" pixels") +
        (done.dropped > 0 ? qsTr(", and ") + done.dropped +
            qsTr(" trimmed crop(s) of it were removed") : "") + ".";
    // The placements are the part a caver has to do something about,
    // so they are said every time rather than only when a box was
    // dismissed.
    if (placed > 0) {
        said += qsTr(" It is placed in this drawing ") +
            (placed === 1 ? qsTr("once") : (placed + qsTr(" times"))) +
            qsTr("; those placements keep their frames, so the sketch " +
            "inside them has moved -- re-align them.");
    }
    EAction.handleUserMessage(said);
};

// SketchScans.confirm LIVED HERE and is gone with the rotation prompt,
// its only caller. Two things it knew are worth keeping, because the
// next Yes/No box in this suite will meet both:
//
//   - makeQMessageBoxStandardButtons breaks this bridge: the box comes
//     up with unlabelled buttons and question() returns Yes
//     immediately, confirming itself. OR the buttons plainly instead.
//   - COMPARE the answer to QMessageBox.Yes, never truthy-test it. No
//     is 65536, which is every bit as truthy as Yes.

/**
 * A box that turned out to cover the whole page: use the original file
 * and write nothing.
 *
 * NOT A BUTTON any more -- there is no "use whole page" to press, and
 * every scan is trimmed. This is the degenerate DRAG: a caver who
 * boxes corner to corner has asked for the page, and writing a
 * byte-for-byte copy of it to disk to honour that would leave a
 * derivative behind for nothing. Its only caller is boxDrawn.
 */
SketchScans.chooseWholePage = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined) {
        return;
    }
    w.trim = { rel: rel, rect: null, path: null, chosen: true };
    try {
        CsScanPreview.armBox(w.scanView, null);
        w.trimLabel.text = qsTr("Trim: whole page");
    } catch (e) {
    }
    SketchScans.updateTrimGate();
};

/**
 * A closed outline: cut it, mask it, and show the result.
 *
 * SAME CONTRACT AS boxDrawn, deliberately. The derivative is still a
 * rectangle -- the outline's own bounding box -- with everything
 * outside the line made transparent, so the placement that follows,
 * the anchor mapping and the 3D drape all go on reading the same
 * x/y/w/h they read for a boxed crop. The outline only decides which
 * pixels inside that box survive.
 */
SketchScans.outlineDrawn = function(points) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scanView === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined || w.scans === null) {
        return;
    }
    var shape = CsScanTrim.outlineFromPicks(points,
        w.scanView.widthPx, w.scanView.heightPx);
    if (shape === null) {
        try {
            CsScanPreview.resetTrace(w.scanView);
            w.trimLabel.text = qsTr("Trim: that outline is too small -- "
                + "trace a bigger one");
        } catch (eSmall) {
        }
        return;
    }
    var rect = CsScanTrim.outlineBounds(shape);
    var res = CsScanTrim.write(w.scans, rel, rect, shape);
    if (res.path === null) {
        try {
            w.trimLabel.text = qsTr("Trim failed");
        } catch (eLbl) {
        }
        CsTell.warn("Sketch Scans: " + res.error);
        return;
    }
    w.trim = { rel: rel, rect: rect, path: res.path, chosen: true,
               outline: shape };
    try {
        CsScanPreview.armTrace(w.scanView, null, null);
        CsScanPreview.armBox(w.scanView, null);
        CsScanPreview.show(w.scanView, res.path);
        w.trimLabel.text = qsTr("Trim: outline, ") + shape.length +
            qsTr(" points");
    } catch (eShow) {
    }
    SketchScans.updateTrimGate();
};

/** Start tracing an outline on the selected scan. */
SketchScans.startTrace = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scanView === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined) {
        return;
    }
    // Back to the untrimmed page first: an outline traced over a crop
    // would be measured in the crop's pixels, and every tag this suite
    // writes is in the PAGE's.
    try {
        if (w.scans !== null) {
            CsScanPreview.show(w.scanView, w.scans + "/" + rel);
        }
    } catch (eShow) {
    }
    w.trim = { rel: rel, rect: null, path: null, chosen: false };
    try {
        CsScanPreview.armTrace(w.scanView,
            function(points) { SketchScans.outlineDrawn(points); },
            function(points, cursor) {
                CsScanPreview.showTrace(w.scanView, points, cursor);
            });
        w.trimLabel.text = qsTr("Trim: drag round the sketch and let go, "
            + "or click corners and click the first one again");
    } catch (eArm) {
    }
    SketchScans.updateTrimGate();
};

/** Take back the last corner of an outline in progress. */
SketchScans.undoTracePoint = function() {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scanView === null) {
        return;
    }
    var left = CsScanPreview.undoTracePoint(w.scanView);
    if (left === null) {
        return;
    }
    CsScanPreview.showTrace(w.scanView, left, null);
};

/**
 * A finished drag: normalise it, write the derivative, and show it.
 *
 * A FAILED WRITE LEAVES THE BUTTONS OFF. Falling back to the page here
 * would place the very clutter the caver just boxed away, without
 * saying so.
 */
SketchScans.boxDrawn = function(box) {
    var w = SketchScans.w;
    if (w === undefined || w === null || w.scanView === null) {
        return;
    }
    var rel = SketchScans.selectedRel();
    if (rel === null || rel === undefined || w.scans === null) {
        return;
    }
    var rect = CsScanTrim.rectFromPicks(box.a, box.b,
        w.scanView.widthPx, w.scanView.heightPx);
    if (rect === null) {
        try {
            CsScanPreview.clearBand(w.scanView);
            w.trimLabel.text = qsTr("Trim: that box is too small -- " +
                "drag a bigger one");
        } catch (eSmall) {
        }
        return;
    }
    // A box round the whole page is not a crop. Writing a byte-for-byte
    // copy of the scan and placing that would leave a derivative behind
    // for nothing.
    if (CsScanTrim.isWholePage(rect, w.scanView.widthPx,
            w.scanView.heightPx)) {
        SketchScans.chooseWholePage();
        return;
    }
    var res = CsScanTrim.write(w.scans, rel, rect);
    if (res.path === null) {
        try {
            w.trimLabel.text = qsTr("Trim failed");
        } catch (eLbl) {
        }
        CsTell.warn("Sketch Scans: " + res.error);
        return;
    }
    w.trim = { rel: rel, rect: rect, path: res.path, chosen: true };
    try {
        CsScanPreview.armBox(w.scanView, null);
        CsScanPreview.show(w.scanView, res.path);
        w.trimLabel.text = qsTr("Trim: ") + rect.w + " \u00d7 " +
            rect.h + qsTr(" px");
    } catch (eShow) {
    }
    SketchScans.updateTrimGate();
};

/** The placement controls follow the trim choice. Sketch Section keeps
 *  its own extra condition: a plan or profile scan has no ghost to
 *  trace onto. */
SketchScans.updateTrimGate = function() {
    // The panel follows the command: a bay that opened or closed since
    // the last look changes which buttons belong here at all.
    SketchScans.syncContext();
    var w = SketchScans.w;
    if (w === undefined || w === null) {
        return;
    }
    var chosen = (w.trim !== null && w.trim !== undefined &&
        w.trim.chosen === true);
    try {
        SketchScans.setEnabled("pickAlignButton", chosen);
        w.trimRedoButton.enabled = chosen;
        // Trace needs a scan to trace on, not a trim already made --
        // it is one of the two ways of MAKING one.
        var haveScan = (SketchScans.selectedRel() !== null &&
            SketchScans.selectedRel() !== undefined);
        if (w.traceButton !== undefined && w.traceButton !== null) {
            w.traceButton.enabled = haveScan && !chosen;
        }
        if (w.traceUndoButton !== undefined && w.traceUndoButton !== null) {
            var drawing = false;
            try {
                drawing = (w.scanView !== null &&
                    w.scanView.tracing === true &&
                    w.scanView.tracePoints !== undefined &&
                    w.scanView.tracePoints !== null &&
                    w.scanView.tracePoints.length > 0);
            } catch (eDraw) {
            }
            w.traceUndoButton.enabled = drawing;
        }
        // ONE BUTTON, TWO HALVES OF ONE WORKFLOW. Capture is the last
        // step of sketching a section and had no entry point anywhere
        // near the panel that starts it -- it lives on the Cave Survey
        // menu, which is not where a caver who just finished tracing is
        // looking. While a bay is open this button IS the capture, and
        // it does not wait on a trim choice: the scan's part is over.
        if (SketchScans.bayOpen(EAction.getDocument())) {
            SketchScans.setText("sketchButton", qsTr("Capture Section"));
            SketchScans.setToolTip("sketchButton",
                qsTr("Place what you traced in the open bay as a " +
                    "section block, with a leader back to its station, " +
                    "and tear the bay down."));
            SketchScans.setEnabled("sketchButton", true);
        } else {
            SketchScans.setText("sketchButton", qsTr("Sketch Section"));
            SketchScans.setToolTip("sketchButton",
                qsTr("Open a staging bay for the selected scan: the " +
                    "computed cross section at a chosen plan station, " +
                    "dashed, to scale the scan onto and trace by " +
                    "hand."));
            SketchScans.setEnabled("sketchButton", chosen &&
                (SketchScans.frameIndex() === 2));
        }
    } catch (e) {
        // a bridge that cannot disable them leaves the buttons live;
        // placing without a box still uses the whole page, which is
        // untrimmed but never a WRONG crop
    }
};

/**
 * Inserts one scan over the survey: centered on the drawing's extent,
 * scaled so its width spans about that extent (or 150 units for an
 * empty drawing), tagged with the frame it belongs to, on that frame's
 * own scan layer, on top -- an underlay about to be aligned needs to be
 * seen.
 *
 * \param frame which view this scan belongs to; defaults to "plan"
 *        when absent, same as CsScanFrame.normaliseKind.
 * \param trimRect the box on the ORIGINAL page that `path` is a crop
 *        of, or null/absent when `path` IS the page. Recorded, never
 *        applied: the cropping already happened on disk.
 * \param outline the traced outline on the ORIGINAL page, when the crop
 *        was masked to one. Recorded for the same reason as the box and
 *        applied no more than it is: the masking already happened on
 *        disk. It is what lets the crop be cut again if the derivative
 *        is ever deleted.
 * \return the entity id, or null (a message has been shown).
 */
SketchScans.insert = function(doc, di, path, name, frame, trimRect, outline) {
    var image = new QImage(path);
    if (image.isNull()) {
        CsTell.warn("Sketch Scans: " + name + " could not be read as an " +
            "image.");
        return null;
    }
    var pxW = image.width(), pxH = image.height();
    if (pxW < 1 || pxH < 1) {
        CsTell.warn("Sketch Scans: " + name + " has no size.");
        return null;
    }

    var box = null;
    try {
        box = doc.getBoundingBox(true, true);
    } catch (eBox) {
    }
    var centerX = 0, centerY = 0, targetW = 150;
    if (box !== null && !isNull(box) && typeof box.isSane === "function" &&
            box.isSane()) {
        var min = box.getMinimum(), max = box.getMaximum();
        if (isNumber(min.x) && isNumber(max.x) && max.x > min.x) {
            centerX = (min.x + max.x) / 2.0;
            centerY = (min.y + max.y) / 2.0;
            targetW = Math.max(max.x - min.x, 50);
        }
    }
    var unitsPerPixel = targetW / pxW;

    var entity;
    try {
        var data = new RImageData(
            path,
            new RVector(centerX - (pxW * unitsPerPixel) / 2.0,
                centerY - (pxH * unitsPerPixel) / 2.0),
            new RVector(unitsPerPixel, 0),
            new RVector(0, unitsPerPixel),
            pxW, pxH, 0);
        // Half faded, the basemap's treatment: at full strength the
        // scan out-shouts the linework being traced over it. Fade
        // survives the DXF round trip, and the property editor can
        // still change it per image.
        try {
            data.setFade(SketchScans.FADE_PERCENT);
        } catch (eFade) {
            // an engine without setFade gets a full-strength scan
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        CsTell.warn("Sketch Scans: creating the image entity failed: " + e);
        return null;
    }

    // The frame's OWN scan layer. A profile sketch on CTRL-SCAN would
    // read as plan content to CsLayers.frameOf, so a plan-wide warp
    // would drag it and it would swell the plan's data window.
    var kind = CsScanFrame.normaliseKind(frame);
    var layer = CsScanFrame.layerFor(kind);
    CsLayers.ensure(doc, di, layer);
    // Layer, tags and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(layer));
    CsTags.set(entity, "SketchScan", name);
    CsTags.set(entity, CsScanFrame.TAG, kind);
    // WHICH PART OF THE PAGE THIS IS. `name` deliberately stays the
    // page's own relative path -- the shelf's completion ticks and
    // placedScales both find our images by that tag -- so this is the
    // only record that the placed file is a crop, and the only thing
    // that can map an anchor picked in trimmed pixels back onto the
    // page it came from.
    if (trimRect !== undefined && trimRect !== null) {
        CsTags.set(entity, CsScanTrim.TAG, CsScanTrim.serialize(trimRect));
    }
    if (outline !== undefined && outline !== null && outline.length >= 3) {
        CsTags.set(entity, CsScanTrim.OUTLINE_TAG,
            CsScanTrim.serializeOutline(outline));
    }
    // To the very back, under the survey linework -- the basemap's
    // call, one below getMinDrawOrder() because THIS entity is not in
    // storage yet and a tie at the minimum is not documented to
    // resolve in its favour. Without this the add operation's default
    // lands new entities ON TOP of everything (verified live).
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    // The new entity's id by set difference: queryAllEntities is not
    // insertion-ordered, and the script-side object is not guaranteed
    // to learn its id from the apply.
    var beforeIds = {};
    var ids = doc.queryAllEntities(false, false);
    var i;
    for (i = 0; i < ids.length; i++) {
        beforeIds[ids[i]] = true;
    }

    var op = new RAddObjectsOperation();
    op.setText("Insert sketch scan");
    op.addObject(entity, false);
    di.applyOperation(op);

    ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        if (beforeIds[ids[i]] !== true) {
            return ids[i];
        }
    }
    CsTell.warn("Sketch Scans: the insert operation added nothing -- the " +
        layer + " layer may be locked or frozen.");
    return null;
};

/**
 * The units-per-pixel of every scan already placed in the drawing.
 *
 * An image's u vector IS its units per pixel, so this is a read rather
 * than a calculation. Used to judge whether a new scan's scale is in
 * step with its neighbours -- see CsScanFit.scaleOutlier.
 */
SketchScans.placedScales = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    try {
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || !isImageEntity(e)) {
                continue;
            }
            if (CsTags.get(e, "SketchScan") === "") {
                continue;          // not one of ours
            }
            var u = e.getUVector();
            var m = Math.sqrt(u.x * u.x + u.y * u.y);
            if (m > 0) {
                out.push(m);
            }
        }
    } catch (eScan) {
    }
    return out;
};

/**
 * Inserts a scan ALREADY FITTED to the stations picked on it.
 *
 * The ordinary insert drops the scan over the survey at a guessed size
 * for Align Image to fix afterwards. This one knows the answer first:
 * the fit came from stations picked on the scan itself, so the image is
 * placed by the three vectors that fit describes and never has to be
 * moved again.
 *
 * \return the entity id, or null (a message has been shown).
 */
SketchScans.insertFitted = function(doc, di, path, name, fit, heightPx,
        pairs, frame, trimRect, outline) {
    var image = new QImage(path);
    if (image.isNull()) {
        CsTell.warn("Sketch Scans: " + name + " could not be read as an image.");
        return null;
    }
    var pxW = image.width(), pxH = image.height();
    if (pxW < 1 || pxH < 1) {
        CsTell.warn("Sketch Scans: " + name + " has no size.");
        return null;
    }

    var v = CsScanFit.imageVectors(fit.matrix);
    var entity;
    try {
        var data = new RImageData(path,
            new RVector(v.position.x, v.position.y),
            new RVector(v.u.x, v.u.y),
            new RVector(v.v.x, v.v.y),
            pxW, pxH, 0);
        try {
            data.setFade(SketchScans.FADE_PERCENT);
        } catch (eFade) {
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        CsTell.warn("Sketch Scans: creating the image entity failed: " + e);
        return null;
    }

    // The frame's OWN scan layer. A profile sketch on CTRL-SCAN would
    // read as plan content to CsLayers.frameOf, so a plan-wide warp
    // would drag it and it would swell the plan's data window.
    var kind = CsScanFrame.normaliseKind(frame);
    var layer = CsScanFrame.layerFor(kind);
    CsLayers.ensure(doc, di, layer);
    // Layer, tags and draw order BEFORE adding -- post-add writes fail
    // silently in this bridge (see CsDraw.js's header).
    entity.setLayerId(doc.getLayerId(layer));
    CsTags.set(entity, "SketchScan", name);
    CsTags.set(entity, CsScanFrame.TAG, kind);
    // WHICH PART OF THE PAGE THIS IS. `name` deliberately stays the
    // page's own relative path -- the shelf's completion ticks and
    // placedScales both find our images by that tag -- so this is the
    // only record that the placed file is a crop, and the only thing
    // that can map an anchor picked in trimmed pixels back onto the
    // page it came from.
    if (trimRect !== undefined && trimRect !== null) {
        CsTags.set(entity, CsScanTrim.TAG, CsScanTrim.serialize(trimRect));
    }
    if (outline !== undefined && outline !== null && outline.length >= 3) {
        CsTags.set(entity, CsScanTrim.OUTLINE_TAG,
            CsScanTrim.serializeOutline(outline));
    }
    // The band it was assigned within, where the frame has bands. A
    // HINT for re-fitting, never trusted over the station names: a
    // renamed run must not strand a scan.
    try {
        if (pairs.length > 0 && pairs[0].run !== undefined &&
                pairs[0].run !== null && pairs[0].run !== "") {
            CsTags.set(entity, CsScanFrame.KEY_TAG, pairs[0].run);
        }
    } catch (eRun) {
    }
    // The stations it was fitted to, in the same tag Align Image uses,
    // so re-aligning this scan later resumes past them rather than
    // offering them again.
    try {
        var names = [];
        for (var n = 0; n < pairs.length; n++) {
            names.push(pairs[n].name);
        }
        CsTags.set(entity, CsStationOrder.TAG,
            CsStationOrder.serializeAssigned(names));
    } catch (eTag) {
        // the scan is placed either way; only the resume list is lost
    }
    // AND WHERE ON THE PAGE each of them was picked, in the scan's own
    // pixels. Written for two reasons. It makes a placement CHECKABLE
    // after the fact -- run each anchor through the placed image's own
    // mapFromImage and it must land on that station -- which is the
    // difference between "it looks offset" and a number. And it is what
    // a later redraw would need to re-fit the scan when the survey
    // moves under it, instead of leaving it stranded.
    //
    // AND NOTE ON TRIMMING. These are in the PLACED image's pixels,
    // which for a trimmed placement is the crop's own space, not the
    // page's. ScanTrim above is what rebases them:
    //   page_u = anchor_u + trim.x,  page_v = anchor_v + trim.y
    // Nothing here does that rebasing; the tag exists so a later
    // reader CAN.
    try {
        var anchors = [];
        for (var q = 0; q < pairs.length; q++) {
            anchors.push({ name: pairs[q].name,
                           u: pairs[q].source.x, v: pairs[q].source.y });
        }
        CsTags.set(entity, "ScanAnchors",
            CsScanFit.serializeAnchors(anchors));
    } catch (eAnchor) {
        // placement stands; only the record of where it was picked is lost
    }
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    var beforeIds = {};
    var ids = doc.queryAllEntities(false, false);
    var i;
    for (i = 0; i < ids.length; i++) {
        beforeIds[ids[i]] = true;
    }
    var op = new RAddObjectsOperation();
    op.setText("Place aligned sketch scan");
    op.addObject(entity, false);
    di.applyOperation(op);

    ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        if (beforeIds[ids[i]] !== true) {
            return ids[i];
        }
    }
    CsTell.warn("Sketch Scans: the insert added nothing -- the " +
        layer + " layer may be locked or frozen.");
    return null;
};

/**
 * PUT THE SCAN ON SCREEN ONCE IT LANDS.
 *
 * A scan is placed where its stations put it, which is wherever that
 * part of the cave happens to sit -- and the caver is usually looking
 * at something else entirely, often at the whole map zoomed out far
 * enough that a single page of field notes is a smudge. So a placement
 * that worked perfectly looked exactly like a placement that did
 * nothing, and the next move was always the same: hunt for it.
 *
 * Zoomed to the scan's own box with a margin, so the survey around it
 * is visible too -- a sketch on screen with none of the passage it was
 * drawn over is no more use than one off screen.
 *
 * Failure is survivable: a build that cannot zoom, or an entity with no
 * box, leaves the view exactly where it was, and the scan is placed
 * either way.
 */
SketchScans.zoomToPlaced = function(doc, di, entityId) {
    if (entityId === null || entityId === undefined || isNull(di)) {
        return;
    }
    try {
        var e = doc.queryEntity(entityId);
        if (isNull(e)) {
            return;
        }
        var box = e.getBoundingBox();
        if (isNull(box) || !box.isValid()) {
            return;
        }
        di.zoomTo(box, 40);
    } catch (eZoom) {
        // a view that will not move is not a reason to undo a placement
    }
};

/**
 * Starts ScanAlign on the entity AFTER the click that asked for it has
 * fully unwound: selects it (selection does not dirty the document),
 * then a zero-delay timer -- outside the widget event, the same reason
 * FeatureTrace's dock buttons defer -- makes ScanAlign the current
 * action. With a selection standing, it skips its own entity-picking
 * state and goes straight to the source point.
 */
SketchScans.alignSoon = function(entityId) {
    if (entityId === null || entityId === undefined) {
        return;
    }
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        var di = getDocumentInterface();
        if (di === undefined || di === null) {
            return;
        }
        try {
            di.selectEntity(entityId, false);
        } catch (eSel) {
            return;   // nothing selected, nothing to mis-align
        }
        try {
            var guiAction = RGuiAction.getByScriptFile(
                ScanAlign.scriptPath);
            di.setCurrentAction(new ScanAlign(guiAction));
        } catch (eAct) {
            EAction.handleUserWarning("Sketch Scans: the scan is " +
                "inserted and selected, but the align tool would not " +
                "start (" + eAct + ").");
        }
    });
    timer.start(0);
};

/**
 * Hand a scan to the section bay (SectionBay.run, in CrossSection/),
 * DEFERRED.
 *
 * Starting an action from inside a widget event is the documented
 * hard-crash trap: triggering makes QCAD build a new action, and
 * setCurrentAction then runs deleteTerminatedActions(), which frees the
 * action still executing this very handler. The zero-delay timer puts
 * the start on the next event loop turn, out of that handler -- the
 * same shape alignSoon above uses, for the same reason.
 */
SketchScans.sketchSoon = function(path, station, calibration) {
    // Normalised here rather than at every call site: an omitted
    // argument is `undefined`, and SectionBay.run's own "was I given
    // a station?" test reads "" and null, not undefined.
    var name = (station === undefined || station === null ||
        station === "") ? null : station;
    var cal = (calibration === undefined) ? null : calibration;
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        try {
            SectionBay.run(path, name, cal);
        } catch (e) {
            EAction.handleUserWarning("Sketch Section: " + e);
        }
    });
    timer.start(0);
};

/**
 * Is a section bay open in this drawing?
 *
 * CHEAP ON PURPOSE. This is asked every time the gate runs, which is on
 * every selection change and every panel rebuild, so it reads ONE
 * layer's entities (bay frames live on CTRL-SECTION-BOX and nothing
 * else does) rather than sweeping the drawing. A build without
 * queryLayerEntities falls back to the full sweep rather than to a
 * wrong answer.
 */
SketchScans.bayOpen = function(doc) {
    if (isNull(doc)) {
        return false;
    }
    try {
        var layerId = doc.getLayerId(CsLayers.CTRL_SECTION_BOX);
        var ids;
        if (layerId !== undefined && layerId !== null && layerId >= 0 &&
                typeof doc.queryLayerEntities === "function") {
            ids = doc.queryLayerEntities(layerId, false);
        } else {
            ids = doc.queryAllEntities(false, false);
        }
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, SectionBay.TAG_BAY) !== "" &&
                    CsTags.get(e, "SectionBayRole") ===
                        SectionBay.ROLE_FRAME) {
                return true;
            }
        }
    } catch (e) {
        // an unreadable drawing is not an open bay
    }
    return false;
};

/**
 * Run Capture, DEFERRED past the click that asked for it -- the same
 * reason alignSoon defers: this runs inside the panel's own click
 * handler, and building a fresh action or applying an operation from
 * inside that handler risks tearing down the very handler running it.
 *
 * "Capture Section" used to be its own menu entry, and this button used
 * to reach it BY THAT ACTION rather than by including SectionCapture.js
 * itself, specifically so the button and the menu entry could never
 * drift apart. The menu entry is gone, but the action is not: it is
 * still registered, just with no widget names and no command name, so
 * it is reachable only from a panel. SectionCapture.startInteractive is
 * the one entry point this button and Cross Section's own bay panel
 * both go through, and that is what "cannot drift apart" means today.
 *
 * startInteractive does its own deferral, so there is no timer here.
 */
SketchScans.captureSoon = function() {
    SectionCapture.startInteractive();
};

/**
 * Hands the just-placed one-station scan to the turn action.
 *
 * DEFERRED THROUGH A TIMER, exactly as alignSoon is and for the same
 * reason: this runs inside the panel's own click handler, and
 * setCurrentAction tears down the action that is running -- QCAD frees
 * it and the return lands in freed memory. A zero timer lets the click
 * unwind first.
 *
 * The closure keeps only PLAIN JS -- an id, two numbers and a name.
 * Holding a Qt wrapper across a deferred call is one of the ways this
 * bridge crashes.
 */
SketchScans.turnSoon = function(entityId, center, station) {
    if (entityId === null || entityId === undefined ||
            center === null || center === undefined) {
        return;
    }
    var cx = center.x, cy = center.y;
    var name = String(station === undefined || station === null ?
        "" : station);
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        var di = getDocumentInterface();
        if (di === undefined || di === null) {
            return;
        }
        try {
            di.selectEntity(entityId, false);
        } catch (eSel) {
            return;      // nothing selected, nothing to turn
        }
        try {
            var guiAction = RGuiAction.getByScriptFile(
                SketchScans.basePath + "/ScanTurn.js");
            var action = new ScanTurn(guiAction);
            action.center = { x: cx, y: cy };
            action.station = name;
            di.setCurrentAction(action);
        } catch (eAct) {
            EAction.handleUserMessage("Sketch Scans: the scan is placed " +
                "north-up and selected, but the turn tool would not " +
                "start (" + eAct + "). Rotate it with the drawing's own " +
                "Rotate command about " + (name === "" ? "its station" :
                name) + ".");
        }
    });
    timer.start(0);
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function SketchScans(guiAction) {
    EAction.call(this, guiAction);
}

SketchScans.prototype = new EAction();

SketchScans.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(EAction.getDocument(), "Sketch Scans")) {
        this.terminate();
        return;
    }
    sketchScansRun();
    this.terminate();
};

SketchScans.init = function(basePath) {
    SketchScans.basePath = basePath;
    // The turn action is not an add-on of its own -- QCAD never calls
    // its init, so this does; see ScanTurn.js's header.
    try {
        ScanTurn.init(basePath);
    } catch (eTurnInit) {
        // no turn action: a one-station scan still lands north-up, it
        // just cannot be turned from the panel
    }
    // Likewise ScanAlign: it used to be Align Image, its own menu entry.
    // Folded in here, it is still a registered RGuiAction (alignSoon
    // needs one to build the tool from) but with no widget names, no
    // command and no icon, so it is reachable only from this panel.
    try {
        ScanAlign.init(basePath);
    } catch (eAlignInit) {
        // no align action: Insert & Align and "Add a scan from
        // elsewhere..." will report the failure when clicked instead
    }
    var action = new RGuiAction(qsTr("Sketch Scans"),
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
    action.setScriptFile(basePath + "/SketchScans.js");
    action.setIcon(basePath + "/SketchScans.svg");
    action.setStatusTip(qsTr("Toggle the Sketch Scans panel: browse the " +
        "cave's scanned sketches with previews, insert one and align it " +
        "to the survey"));
    action.setDefaultCommands(["sketchscans", "ss"]);
    action.setGroupSortOrder(453);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = SketchScans.ensureDock();
        dock.visible = false;
        SketchScans.installListener(RMainWindowQt.getMainWindow());
    } catch (eInit) {
        csSketchScansDock = undefined;
        warning("Sketch Scans: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
