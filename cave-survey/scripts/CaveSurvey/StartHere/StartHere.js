// StartHere.js
//
// QCAD add-on tool: the guided first run.
//
//   Cave Survey > Start Here   (or type "sh")
//
// WHO THIS IS FOR. Somebody opening CaveCAD for the first time, in a
// room with twenty other people and one instructor. The handbook
// answers questions; this one says what to do next, in order, and
// remembers where they stopped.
//
// THE STEPS ARE THE LESSON'S OWN. Every checkbox is a numbered step
// lifted out of the lesson page in the handbook (CsGuide.stepsOf), so
// there is one set of words and rewriting a lesson rewrites the
// checklist. A guide with its own copy of the teaching would disagree
// with the handbook inside a month.
//
// TICKING IS THE STUDENT'S JOB, not ours. Nothing here reads the
// drawing to decide a step is finished: every such check is a judgement
// about what counts as done, and a panel that ticked a step somebody
// had not understood teaches them that the ticks are meaningless.
//
// See docs/superpowers/specs/2026-09-13-handbook-design.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csStartHereDock;

function StartHere(guiAction) {
    EAction.call(this, guiAction);
}

StartHere.prototype = new EAction();

/** What a finished step is marked with. */
StartHere.TICK = "\u2713";

StartHere.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Start Here"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = "CaveSurveyStartHereDock";

    var w = { lesson: null, filling: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    w.title = new QLabel("");
    w.title.wordWrap = true;
    layout.addWidget(w.title, 0, 0);

    w.progress = new QLabel("");
    w.progress.wordWrap = true;
    layout.addWidget(w.progress, 0, 0);

    var hint = new QLabel(qsTr("Click a step to tick it off."));
    hint.wordWrap = true;
    try {
        hint.setStyleSheet("color:gray;");
    } catch (eHint) {
    }
    layout.addWidget(hint, 0, 0);

    // A ONE-COLUMN TABLE OF CHECKABLE ITEMS, and both halves of that
    // are measured rather than chosen. A QCheckBox will not wrap its
    // own label, and a wrapping QLabel beside one is clipped to a
    // single line -- heightForWidth does not travel up through a plain
    // QWidget in this bridge, with either size policy. QListWidget,
    // which would have been the obvious answer, is wrapper-only here:
    // addItem, item, row and itemChanged are all undefined on it.
    // QTableWidget carries all four, which is why CheckMap's findings
    // list is one too.
    w.steps = new QTableWidget();
    // TWO COLUMNS: a narrow tick, then the step. Qt's own check
    // indicator is not painted at all on a cell whose text has wrapped
    // -- measured live 2026-09-13, model said Checked and the row drew
    // nothing -- and a checklist that silently loses half its ticks is
    // worse than no checklist. So the tick is a character we draw.
    w.steps.columnCount = 2;
    w.steps.wordWrap = true;
    try {
        w.steps.horizontalHeader().visible = false;
        w.steps.verticalHeader().visible = false;
        w.steps.horizontalHeader().stretchLastSection = true;
        w.steps.setColumnWidth(0, 26);
        w.steps.selectionMode = QAbstractItemView.NoSelection;
        w.steps.editTriggers = QAbstractItemView.NoEditTriggers;
        w.steps.setMinimumHeight(220);
    } catch (eTable) {
        // a bridge without the header accessors gets a table with
        // headers on, which is ugly and still ticks
    }
    layout.addWidget(w.steps, 1, 0);

    w.readButton = new QPushButton(qsTr("Read this lesson"));
    w.readButton.toolTip = qsTr("Open the whole lesson in the handbook: " +
        "what you should see, and what it means when it goes wrong.");
    layout.addWidget(w.readButton, 0, 0);

    var row = new QHBoxLayout();
    w.prevButton = new QPushButton(qsTr("< Previous"));
    w.nextButton = new QPushButton(qsTr("Next >"));
    row.addWidget(w.prevButton, 1, 0);
    row.addWidget(w.nextButton, 1, 0);
    layout.addLayout(row, 0);

    w.resetButton = new QPushButton(qsTr("Start over"));
    w.resetButton.toolTip = qsTr("Forget every tick, in every lesson. " +
        "What you have drawn is not touched -- this is a record of " +
        "where you had got to, nothing else.");
    layout.addWidget(w.resetButton, 0, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    StartHere.widgets = w;

    w.readButton.clicked.connect(function() {
        StartHere.read();
    });
    w.prevButton.clicked.connect(function() {
        StartHere.step(-1);
    });
    w.nextButton.clicked.connect(function() {
        StartHere.step(1);
    });
    w.resetButton.clicked.connect(function() {
        StartHere.startOver();
    });
    // CLICK, not a check indicator: see the columnCount comment.
    w.steps.itemClicked.connect(function(item) {
        StartHere.itemChanged(item);
    });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "StartHere", qsTr("Start Here"));
    return dock;
};

StartHere.ensureDock = function() {
    if (isNull(csStartHereDock)) {
        csStartHereDock = StartHere.buildDock(RMainWindowQt.getMainWindow());
    }
    return csStartHereDock;
};

/** Open the panel, resuming where the student stopped. */
StartHere.open = function() {
    var dock = StartHere.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    StartHere.show(CsGuide.resumeAt());
};

/** Show one lesson. */
StartHere.show = function(pageId) {
    var w = StartHere.widgets;
    if (isNull(w)) {
        return;
    }
    if (pageId === null) {
        w.title.text = qsTr("The handbook is not installed, so there " +
            "are no lessons to walk through.");
        w.progress.text = "";
        StartHere.clearSteps();
        return;
    }
    w.lesson = pageId;
    var page = CsHandbook.page(pageId);
    w.title.text = "<b>" + CsPanel.escapeHtml(page.title) + "</b>";

    StartHere.clearSteps();
    var steps = CsGuide.stepsOf(pageId);
    var ticked = CsGuide.done(pageId);
    w.filling = true;
    w.steps.rowCount = steps.length;
    for (var i = 0; i < steps.length; i++) {
        var tick = new QTableWidgetItem(ticked[i] === true ?
            StartHere.TICK : "");
        var item = new QTableWidgetItem(steps[i]);
        try {
            tick.setFlags(Qt.ItemIsEnabled);
            item.setFlags(Qt.ItemIsEnabled);
            item.setTextAlignment(Qt.AlignLeft | Qt.AlignTop);
        } catch (eFlags) {
        }
        w.steps.setItem(i, 0, tick);
        w.steps.setItem(i, 1, item);
    }
    try {
        w.steps.setColumnWidth(0, 26);
        w.steps.resizeRowsToContents();
    } catch (eRows) {
    }
    w.filling = false;
    StartHere.updateProgress();

    var lessons = CsGuide.lessons();
    w.prevButton.enabled = lessons.length > 0 && lessons[0].id !== pageId;
    w.nextButton.enabled = lessons.length > 0 &&
        lessons[lessons.length - 1].id !== pageId;
};

/**
 * A tick, from the list.
 *
 * One connection made once in buildDock, rather than one per item:
 * itemChanged carries the item, and the row it sits at is the step
 * number. `filling` guards the signals that arrive while the list is
 * being populated, which would otherwise write every step back to the
 * settings on every lesson change.
 */
StartHere.itemChanged = function(item) {
    var w = StartHere.widgets;
    if (isNull(w) || w.filling === true || w.lesson === null) {
        return;
    }
    var row = w.steps.row(item);
    if (row < 0) {
        return;
    }
    var tick = w.steps.item(row, 0);
    var wasDone = tick !== null && String(tick.text()) !== "";
    CsGuide.setDone(w.lesson, row, !wasDone);
    if (tick !== null) {
        tick.setText(wasDone ? "" : StartHere.TICK);
    }
    StartHere.updateProgress();
};

/** Drop the current lesson's steps. */
StartHere.clearSteps = function() {
    var w = StartHere.widgets;
    w.filling = true;
    try {
        w.steps.rowCount = 0;
    } catch (e) {
    }
    w.filling = false;
};

/** The "3 of 7 done" line, and what to do when a lesson is finished. */
StartHere.updateProgress = function() {
    var w = StartHere.widgets;
    if (isNull(w) || w.lesson === null) {
        return;
    }
    var p = CsGuide.progress(w.lesson);
    if (p.total === 0) {
        w.progress.text = qsTr("Read this one rather than working " +
            "down it.");
        return;
    }
    if (p.done >= p.total) {
        w.progress.text = qsTr("%1 of %2 done -- go on to the next " +
            "lesson.").arg(p.done).arg(p.total);
        return;
    }
    w.progress.text = qsTr("%1 of %2 done.").arg(p.done).arg(p.total);
};

/** Open the current lesson in the handbook. */
StartHere.read = function() {
    var w = StartHere.widgets;
    if (isNull(w) || w.lesson === null) {
        return;
    }
    if (typeof(Handbook) === "undefined") {
        CsTell.warn(qsTr("This build has no Handbook tool installed, so " +
            "the lesson cannot be opened."));
        return;
    }
    Handbook.open(w.lesson);
};

/** Move a lesson forward or back. */
StartHere.step = function(delta) {
    var w = StartHere.widgets;
    var lessons = CsGuide.lessons();
    for (var i = 0; i < lessons.length; i++) {
        if (lessons[i].id === w.lesson) {
            var next = i + delta;
            if (next >= 0 && next < lessons.length) {
                StartHere.show(lessons[next].id);
            }
            return;
        }
    }
};

/** Forget every tick, after asking. */
StartHere.startOver = function() {
    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Start over"),
        qsTr("Forget which steps you have ticked, in every lesson?\n\n" +
            "Nothing you have drawn is touched."),
        QMessageBox.Yes | QMessageBox.No, QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    CsGuide.forget();
    StartHere.show(CsGuide.resumeAt());
};

StartHere.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        StartHere.open();
    } catch (e) {
        csStartHereDock = undefined;
        CsTell.warn("Start Here: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }

    this.terminate();
};

StartHere.init = function(basePath) {
    StartHere.basePath = basePath;

    var action = new RGuiAction(qsTr("Start Here"),
        RMainWindowQt.getMainWindow());
    // NOT setRequiresDocument: lesson one is about opening a cave, so
    // the student has nothing open when they press this.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/StartHere.js");
    action.setIcon(basePath + "/StartHere.svg");
    action.setStatusTip(qsTr("Six lessons on a real cave, in order, " +
        "remembering where you stopped"));
    action.setDefaultCommands(["starthere", "sh"]);
    // FIRST, above the handbook: somebody who has never opened CaveCAD
    // needs the thing that says what to do before the thing that
    // answers questions.
    action.setGroupSortOrder(450);
    action.setSortOrder(5);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = StartHere.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csStartHereDock = undefined;
        warning("Start Here: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
