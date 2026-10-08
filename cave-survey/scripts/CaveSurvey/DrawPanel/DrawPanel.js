// DrawPanel.js
//
// QCAD add-on tool: ONE panel for putting marks on the map.
//
//   Cave Survey > Draw   (or type "draw", "ft", "sym")
//
// WHY "DrawPanel" AND NOT "Draw". QCAD's include() dedupes by
// BASENAME, and QCAD ships scripts/Draw/Draw.js -- so a tool file
// called Draw.js is silently skipped, `Draw` resolves to QCAD's own
// class, and the panel simply never exists. Found the hard way: the
// first build of this tool published cleanly, passed every test, and
// `typeof Draw.reveal` in the live engine came back "undefined".
// The MENU still says Draw; only the file and class are renamed.
//
// WHY. Drawing a cave is one job done with one hand -- a wall, then the
// ledge below it, then the stalactite beside that -- and it lived in
// two docks. A caver tracing a passage was choosing which PANEL to look
// at before choosing what to draw, and on a laptop only one of them
// fitted beside the drawing (Nathan, 2026-09-11).
//
// So Feature Trace and the Symbol Palette are two foldable COLUMNS of
// one panel now -- tracing on the left, symbols on the right. Both
// already knew how to fold and remember what a caver left shut; this
// is CsPanel's section doing what it was written for, one level up.
//
// A GRID, TWO WIDE, NOT TABS AND NOT ONE FIXED ROW. Tabs would put a
// wall and a symbol on opposite sides of a click, and tracing a passage
// means reaching for both in the same breath. Stacked in one column,
// the second section sat below the fold of a dock already 1500 pixels
// tall. Nathan approved this exact layout from a mockup, 2026-09-11:
// rows of two, in the caver's own order, with a spare seat for the
// third section coming next.
//
//   - Rows descend in section order, two sections per row.
//   - A section ALONE on the last row spans the full width rather than
//     leaving a hole beside it -- a dock is narrow and half of one is
//     not worth wasting. (This is the two-section case today: Trace
//     and Symbols share row 0. It becomes visible once Areas makes a
//     third.)
//   - A FOLDED section hands its row to the others. REVERSED,
//     2026-09-12: it shipped the opposite way -- a folded section kept
//     its cell so nothing moved under a caver's cursor -- but Nathan,
//     having actually used the panel: "when I minimize a section... I
//     want the others to grow into the space." A fold now relayouts
//     (CsPanel.connectSection, via the section's own stack) so a
//     folded section becomes a full-width strip and everyone else
//     grows into what it gave up.
//   - New sections simply APPEND at the end of the list below; where
//     they land is `CsPanel.gridPlan`'s arithmetic, not a coordinate
//     anyone has to update by hand.
//   - Right-click a header for Move Up / Move Down / Reset Order. Not a
//     drag, and not for want of trying: this bridge hands script mouse
//     events to four widget classes and a header is none of them --
//     `CsPanel.stackAdd`'s own comment has the list. The order a caver
//     picks is saved under DrawPanel.ORDER_SETTING and restored on
//     every build, same shape as the fold memory but its own key: an
//     old order naming a section that no longer exists must not cost
//     the ones that do (CsPanel.orderedTitles).
//
// ONE BODY, ONE OWNER. Neither panel builds a dock of its own any
// more, and that is not tidiness: each of them keeps its widgets in a
// single module-level `widgets`, so a second copy of the body would
// leave one of the two copies wired to nothing -- a panel that looks
// right and does nothing when clicked. `featuretrace` and
// `symbolpalette` still type; they open THIS dock with that section
// unfolded.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../FeatureTrace/FeatureTrace.js");
include(includeBasePath + "/../SymbolPalette/SymbolPalette.js");
include(includeBasePath + "/../AreaFill/AreaFill.js");
include(includeBasePath + "/../LinetypeMaker/LinetypeMaker.js");

var csDrawPanelDock;

function DrawPanel(guiAction) {
    EAction.call(this, guiAction);
}

DrawPanel.prototype = new EAction();

/** Where the fold state of THIS panel's sections is remembered.
 *  Its own key: folding "Symbols" here is not the same act as folding
 *  a symbol CATEGORY inside it, which the palette remembers itself. */
DrawPanel.COLLAPSED_SETTING = "CaveSurvey/DrawCollapsed";

/** Where the caver's own row order is remembered. A separate key from
 *  COLLAPSED_SETTING above -- fold state and row order are different
 *  facts about a section and must not overwrite each other. */
DrawPanel.ORDER_SETTING = "CaveSurvey/DrawOrder";

/** The grid is two sections wide -- see the header comment for why,
 *  and CsPanel.gridPlan for how a section lands in it. */
DrawPanel.COLUMNS = 2;

/** The least height a section keeps inside its row: a header plus a row
 *  of tiles. Below this a section reads as broken rather than small. */
DrawPanel.SECTION_MIN_HEIGHT = 150;

DrawPanel.SEC_TRACE = "Trace";
DrawPanel.SEC_SYMBOLS = "Symbols";
DrawPanel.SEC_AREAS = "Areas";
DrawPanel.SEC_LINETYPES = "Custom Linetypes";

/** The built sections by title, so `featuretrace` and `symbolpalette`
 *  can unfold the half they name. */
DrawPanel.sections = {};

DrawPanel.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Draw"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyDrawDock";

    var body = new QWidget(dock);
    // A GRID, not a fixed row of columns -- see the header comment.
    var layout = new QGridLayout();
    var collapsed = CsPanel.loadCollapsed(DrawPanel.COLLAPSED_SETTING);
    // Nothing sits above this grid -- the dock's whole body is the
    // stack -- so baseIndex is 0, unlike FeatureTrace's own stack
    // pinning a readout and a search box above its sections.
    var stack = CsPanel.stack(layout, DrawPanel.ORDER_SETTING, 0,
        function() {
            EAction.handleUserMessage(qsTr("Section order reset -- " +
                "reopen the panel to see it."));
        }, DrawPanel.COLUMNS);
    // Assigned the moment it exists, not after ordering below: on the
    // failure path ordering can throw, and DrawPanel.stack must never
    // be left pointing at a PREVIOUS build's stack -- ensureDock and
    // beginEvent rebuild this dock after a failure, so a stale stack
    // here means dead widgets.
    DrawPanel.stack = stack;

    // EACH PANEL BUILDS ITS OWN BODY, into this one's cell. Nothing is
    // reimplemented here: the tiles, the search, the recent strip and
    // every trap they cost are the ones those files already carry.
    //
    // "Areas" (Task 10) is the third entry, added the way the plan
    // called for -- its own include() up top, its own try/catch below --
    // and nothing else in this function changed to fit it: the grid,
    // the stack and applyOrder already knew how to place a third
    // section, and now do.
    var sections = [
        { title: DrawPanel.SEC_TRACE,
          build: function(parent) { return FeatureTrace.buildBody(parent); } },
        { title: DrawPanel.SEC_SYMBOLS,
          build: function(parent) { return SymbolPalette.buildBody(parent); } },
        { title: DrawPanel.SEC_AREAS,
          build: function(parent) { return AreaFill.buildBody(parent); } },
        // The caver's own linetypes, grouped by the category set in
        // Linetype Maker (Nathan, 2026-09-28).
        { title: DrawPanel.SEC_LINETYPES,
          build: function(parent) { return LinetypeMaker.buildBody(parent); } }
    ];
    var problems = [];
    for (var i = 0; i < sections.length; i++) {
        try {
            var section = CsPanel.section(body, sections[i].title,
                DrawPanel.COLLAPSED_SETTING, collapsed);
            var inner = new QVBoxLayout();
            try {
                inner.setContentsMargins(0, 0, 0, 0);
            } catch (eMargins) {
            }
            // EVERY SECTION SCROLLS, AND EVERY SECTION IS CLAMPED.
            // Trace on its own wants 1027 pixels and Symbols 625, so in
            // a 1303-pixel dock the second row was squeezed to 242 and
            // its buttons could not be reached at all (measured live,
            // 2026-09-12; Nathan: "clamp the areas to the panel
            // dimensions and let me scroll to hidden buttons").
            //
            // Clamping alone would only CLIP a section, so the two go
            // together: the grid's rows share the height (setRowStretch
            // below), and each section's body sits in a scroll area so
            // whatever does not fit is still reachable. Symbols and
            // Areas keep their own inner scroll for their tile walls --
            // this one exists for the SECTION, which Trace had none of.
            var built = sections[i].build(section.host);
            var scroller = null;
            try {
                scroller = new QScrollArea();
                scroller.setWidget(built);
                scroller.setWidgetResizable(true);
                // A METHOD, NOT A PROPERTY. Assigning
                // horizontalScrollBarPolicy throws "read-only property"
                // on this bridge -- which is exactly how the previous
                // attempt at this silently fell back to no scrolling at
                // all (probed live, 2026-09-12).
                try {
                    scroller.setHorizontalScrollBarPolicy(
                        Qt.ScrollBarAsNeeded);
                } catch (ePolicy) {
                }
                // Enough to show a header plus a row of tiles, so a
                // folded-open section never collapses to a sliver.
                scroller.setMinimumHeight(DrawPanel.SECTION_MIN_HEIGHT);
                inner.addWidget(scroller, 1, 0);
            } catch (eScroll) {
                // No scroll area on this bridge: the section still
                // works, it just cannot be scrolled within its row.
                problems.push(sections[i].title + " scrolling (" +
                    eScroll + ")");
                inner.addWidget(built, 1, 0);
            }
            section.host.setLayout(inner);
            CsPanel.stackAdd(stack, section, sections[i].title);
            DrawPanel.sections[sections[i].title] = section;
        } catch (eSection) {
            // ONE COLUMN REFUSED IS NOT A PANEL REFUSED. A caver whose
            // symbol palette will not build still needs to trace.
            problems.push(sections[i].title + " (" + eSection + ")");
        }
    }

    // A SAVED ORDER IS RESTORED, THEN THE GRID IS LAID OUT -- both
    // guarded, same as the section loop above: ordering is not drawing,
    // and a caver whose saved order blows up still needs the dock to
    // appear, in whatever order the sections built in.
    try {
        CsPanel.applyOrder(stack);
    } catch (eOrder) {
        problems.push("section order (" + eOrder + ")");
    }
    try {
        // applyOrder already calls this internally when a saved order
        // exists; it does NOT when there is none (a first-ever build)
        // or when the saved order came back mismatched, and either way
        // the loop above never called addWidget itself in grid mode --
        // so this is the only thing that can place the boxes then.
        CsPanel.relayout(stack);
    } catch (eLayout) {
        problems.push("section layout (" + eLayout + ")");
    }

    // THE ROWS DIVIDE THE DOCK, they do not take their natural height --
    // CsPanel.relayout above already set each occupied row's stretch
    // from the same CsPanel.gridPlan it placed the boxes with (1 for a
    // row of unfolded sections, 0 for a folded one's strip), so there
    // is nothing left to do here. Without SOME row stretch a tall first
    // row pushes the second off the bottom, which is what happened to
    // Areas before this existed; that is now relayout's job, done once,
    // not duplicated here and in every future caller of a grid stack.

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "DrawPanel", qsTr("Draw"));

    if (problems.length > 0) {
        warning("Draw: this CaveCAD build refused " +
            problems.join("; ") + " -- the rest of the panel works.");
    }
    return dock;
};

DrawPanel.ensureDock = function() {
    if (csDrawPanelDock !== undefined && csDrawPanelDock !== null) {
        return csDrawPanelDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csDrawPanelDock = DrawPanel.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csDrawPanelDock);
    return csDrawPanelDock;
};

/** Is the panel on screen? The two halves' listeners ask, because
 *  every one of them walks the drawing: a folded-away panel must not
 *  make every transaction in the application pay for a scan nobody
 *  will look at. */
DrawPanel.showing = function() {
    try {
        return (csDrawPanelDock !== undefined && csDrawPanelDock !== null &&
            csDrawPanelDock.visible === true);
    } catch (e) {
        return false;
    }
};

/** Opens the panel with ONE section unfolded -- the door `featuretrace`
 *  and `symbolpalette` come through.
 *
 *  Unfolds WITHOUT remembering (CsPanel.setOpen): a caver who keeps
 *  Symbols folded and types "ft" once has not changed their mind about
 *  Symbols. */
DrawPanel.reveal = function(title) {
    var dock = DrawPanel.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    try {
        var section = DrawPanel.sections[title];
        if (!isNull(section)) {
            CsPanel.setOpen(section, title, true);
        }
    } catch (eOpen) {
    }
    return dock;
};

DrawPanel.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(EAction.getDocument(), "Draw")) {
        this.terminate();
        return;
    }

    try {
        var existed = (csDrawPanelDock !== undefined && csDrawPanelDock !== null);
        var dock = DrawPanel.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        try {
            FeatureTrace.flush();
        } catch (eFlush) {
            // a stale panel must never stop the tool opening
        }
    } catch (e) {
        // Forget the dock ONLY if it was never built. Forgetting a live
        // one because refresh() threw made the next press build a
        // second panel beside it.
        if (isNull(dock)) {
            csDrawPanelDock = undefined;
        }
        EAction.handleUserWarning("Draw: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }

    this.terminate();
};

DrawPanel.init = function(basePath) {
    DrawPanel.basePath = basePath;

    var action = new RGuiAction(qsTr("Draw"),
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
    action.setScriptFile(basePath + "/DrawPanel.js");
    action.setIcon(basePath + "/DrawPanel.svg");
    action.setStatusTip(qsTr("One panel for putting marks on the map: " +
        "trace features and shaped lines, place symbols"));
    // "ft" and "sym" still work, because a caver who has typed them for
    // a year should not have to learn that they now mean the same door.
    // "area" is new with the Areas section (Task 10) -- AreaFill.init
    // registers it too, its own RGuiAction, the same way "ft" and "sym"
    // are FeatureTrace's and SymbolPalette's own commands as well as
    // Draw's.
    action.setDefaultCommands(["draw", "ft", "sym", "area"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the suite's other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = DrawPanel.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csDrawPanelDock = undefined;
        warning("Draw: could not build the panel at startup (" + eInit +
            "); the menu entry will try again.");
    }
};
