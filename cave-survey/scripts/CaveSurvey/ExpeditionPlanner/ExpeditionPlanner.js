// ExpeditionPlanner.js
//
// QCAD add-on tool: plan a trip into the cave and build its callout card.
//
//   Cave Survey > Expedition Planner   (or type "epl")
//
// WHAT IT IS. A docked panel, ONE page with no tabs: Trip, People,
// Teams, Escalation, Card. Each team (members, schedule, stops, packing)
// is a fold-away section under Teams; its route runs from the survey's
// first station to its stops and back (Core/CsTripPlan.js). Build cards
// writes callout-card.html beside the drawing -- with one team today's
// single card (Core/CsCalloutCard.js), with several a topside sheet plus
// one team-<n>-<slug>.html per team (Core/CsTeams.js) -- and refuses
// until every required field is filled in, naming all the gaps at once.
// Save packet writes trip-plan.html for a one-team trip. This is the
// home for the later expedition tools too.
//
// THE SIDECAR IS SHARED, SO A WRITE RE-READS IT FIRST. Pace, the trip
// and its teams are stations.json `settings`, the same file Station
// Table keeps its marks in (Core/CsStationSidecar.js). Every write reads
// the file again and changes only its own settings, so a teammate's
// marks that arrived through Drive are never thrown away. The trip's
// party (who is going: id and name only) is settings.trip.party there
// too, and the teams settings.trip.teams.
//
// PERSONAL DATA STAYS ON THIS COMPUTER. The people directory (medical
// notes, emergency contacts, skills) is people.json in CaveCAD's
// per-user data folder (Core/CsPeople.js); the topside contacts are in
// this computer's settings (Core/CsCalloutLocal.js). Neither ever goes
// into the cave folder, which Drive syncs.
//
// WIDGETS ARE FOUND BY objectName, never stashed on objects or as
// expandos (cavecad-tab-engine-panels). The action is forceGlobal, so
// this all runs in the application engine that init() built the dock in.
//
// See docs/superpowers/plans/2026-09-29-expedition-planner-panel.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csExpeditionPlannerDock;

function ExpeditionPlanner(guiAction) {
    EAction.call(this, guiAction);
}

ExpeditionPlanner.prototype = new EAction();

ExpeditionPlanner.DOCK_NAME = "CaveSurveyExpeditionPlannerDock";

/**
 * What the panel is currently showing. Module state -- plain JS, never
 * widget expandos. `docPath` starts null so the first reload counts as
 * a new drawing and fills every field.
 */
ExpeditionPlanner.state = { drawn: null, docPath: null, store: null,
    loadError: "",
    // The station names the stop pickers offer, in natural order.
    stations: [],
    // The last one-team plan built (Save packet), and the pace text last
    // PUT INTO the widget from stations.json (so a reload can tell a
    // caver's unsaved typing from what it showed).
    plan: null, planShown: null,
    // The people directory as loaded from people.json, why it could not
    // be (the table is then read-only and nothing is written to it), and
    // what each roster row is: {id, name, known}. Unknown rows are party
    // members this computer has no details for.
    people: [], peopleError: "", rosterRows: [],
    // Set while the roster is filled by code (FILLING IS NOT EDITING).
    filling: false,
    // The trip's teams (CsStationStore.cleanTeam shape), loaded by
    // loadTeams and changed only through the team edit functions.
    teams: [],
    // Which team sections are unfolded (team id -> true), the team last
    // opened, added or edited, the Teams status message, how many team
    // sections have been torn down (their widgets' new names count up),
    // and a packing edit waiting for its debounce: {id, text} or null.
    teamOpen: {}, activeTeamId: "", teamMessage: "", removedCount: 0,
    packingPending: null,
    // The teams as they were before the last applied suggestion (a deep
    // copy), or null: Undo suggestion puts them back. Any manual team
    // edit or a drawing change drops it.
    suggestUndo: null,
    // Who fits where: whether the section is unfolded (it starts folded
    // and a folded section never asks the engine anything), the extra
    // stops added there (this drawing only), and what the matrix was last
    // filled from (a signature and the drawn object), so a header refresh
    // refills it only when something it shows has changed.
    fitOpen: false, fitExtra: [], fitSig: null, fitDrawn: null,
    // What's left to push: whether the section is unfolded (it starts
    // folded and a folded section never runs the engine), the chosen
    // preset, whether a weight was edited by hand (Custom), the six
    // weights as the spin boxes show them (0-100), the hint word fields'
    // text, the Show done and skipped tick, what the table was last
    // filled from, the stations its rows show (row order), the team ids
    // the dropdown lists and what it was filled from, and pushFilling
    // (set while code fills the spin boxes: FILLING IS NOT EDITING).
    // SESSION STATE ONLY, never saved; choosing a preset resets the weights.
    pushOpen: false, pushPreset: "balanced", pushCustom: false, pushWeights: null,
    pushPos: null, pushNeg: null, pushDone: false, pushSig: null, pushDrawn: null,
    pushStations: [], pushTeamIds: [], pushTeamKey: null, pushFilling: false,
    // teamSqueeze's routes: {drawn, routes: {key: CsSqueeze.forTeam answer}},
    // dropped when the drawing is read again.
    squeezeCache: null };

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------
//
// ONE PAGE, NO TABS (Nathan, 2026-09-29: "Too easy to not enter
// important information"). Top to bottom: Trip, People, Teams, Who
// fits where (folded), What's left to push (folded), Escalation, Card. Required fields carry a red asterisk, and Build
// cards refuses, naming every gap at once (CsTeams.missingAll), until
// they are all filled in.
//
// TEAM SECTIONS ARE BUILT AFTER THE DOCK EXISTS. buildDock only makes the
// empty ExpeditionPlannerTeamsBody; rebuildTeamSections (from the
// populate path and the Add/Remove team buttons) fills it. Nothing a
// build* function runs may reach the dock through child()/ensureDock:
// 0.9.194.0 hung CaveCAD at startup that way (see ensureDock).
//
// A stop list is a one-column QTableWidget, not a QListWidget: this
// bridge has no constructor for QListWidget (see CaveShelf.js). The
// picker is an editable QComboBox, whose own inline completion does the
// typing help: QCompleter does not exist on this bridge. QFormLayout has
// no addRow here either, so fields sit in CsPanel.formGrid grids.

ExpeditionPlanner.CALLOUT_DAY_HEADERS = ["Day", "Entry (HH:MM)", "Work hours", "Night (out/camp)"];
ExpeditionPlanner.CALLOUT_ROSTER_HEADERS = ["Going", "Name", "Role", "Squeeze (in)",
    "Skills", "Medical", "Emergency contact"];

/** The objectName of the one scrolling page (the footer sits outside it). */
ExpeditionPlanner.PAGE_SCROLL_NAME = "ExpeditionPlannerPageScroll";

/** Label text (rich) for a field; a required one ends in a red asterisk. */
ExpeditionPlanner.labelText = function(text, required) {
    return CsPanel.escapeHtml(text) + (required === true ?
        " <span style=\"color:#c00\">*</span>" : "");
};

/** A bold section heading, with a little air above it. */
ExpeditionPlanner.heading = function(layout, text) {
    try {
        layout.addSpacing(6);
    } catch (eSp) {
    }
    layout.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(text) + "</b>"), 0, 0);
};

/**
 * A labelled one-line field on row `row` of a formGrid; returns the
 * QLineEdit. Label left, field right, so the page stays narrow.
 */
ExpeditionPlanner.calloutField = function(grid, row, label, required, name, tip) {
    grid.addWidget(new QLabel(ExpeditionPlanner.labelText(label, required)), row, 0);
    var edit = new QLineEdit();
    edit.objectName = name;
    edit.toolTip = tip;
    grid.addWidget(edit, row, 1);
    return edit;
};

/**
 * A table with fixed headers. Tables that connect itemChanged (a team's
 * days) do it behind the state.filling guard, because filling a cell by
 * code fires it exactly as typing does. Tick columns are cell checkboxes
 * (cellCheck), never checkable items.
 */
ExpeditionPlanner.calloutTable = function(name, headers, minH, maxH) {
    var t = new QTableWidget(0, headers.length);
    t.objectName = name;
    t.setHorizontalHeaderLabels(headers);
    try {
        t.verticalHeader().visible = false;
        t.horizontalHeader().stretchLastSection = true;
        t.setMinimumHeight(minH);
        t.setMaximumHeight(maxH);
    } catch (e) {
    }
    return t;
};

/** rowCount is a PROPERTY on this bridge (see LinetypeMaker). */
ExpeditionPlanner.addTableRow = function(table, cells) {
    var r = table.rowCount;
    table.setRowCount(r + 1);
    for (var c = 0; c < cells.length; c++) {
        table.setItem(r, c, new QTableWidgetItem(String(cells[c])));
    }
};

/** The selected row of a table, or -1. currentRow is a METHOD here. */
ExpeditionPlanner.selectedRowOf = function(table) {
    var idx = -1;
    try {
        var sel = table.selectionModel().selectedRows();
        if (sel.length > 0) {
            idx = sel[0].row();
        }
    } catch (eSel) {
        idx = -1;
    }
    if (idx < 0) {
        try {
            idx = table.currentRow();
        } catch (eCur) {
            idx = -1;
        }
    }
    return (typeof idx === "number" && idx >= 0) ? idx : -1;
};

ExpeditionPlanner.removeTableRow = function(table) {
    var r = ExpeditionPlanner.selectedRowOf(table);
    if (r >= 0 && r < table.rowCount) {
        table.removeRow(r);
    }
};

/** A row of buttons, left-aligned; returns the buttons in order. */
ExpeditionPlanner.buttonRow = function(layout, labels) {
    var row = new QHBoxLayout();
    var out = [];
    for (var i = 0; i < labels.length; i++) {
        var b = new QPushButton(labels[i]);
        row.addWidget(b, 0, 0);
        out.push(b);
    }
    row.addStretch(1);
    layout.addLayout(row, 0);
    return out;
};

/**
 * 1. TRIP: start date (Qt's own QDateEdit with its calendar dropdown),
 * forecast place.
 */
ExpeditionPlanner.buildTripSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Trip"));
    var grid = CsPanel.formGrid(1);
    grid.addWidget(new QLabel(ExpeditionPlanner.labelText(qsTr("Start date"), false)), 0, 0);
    // The bridge has no QDateEdit constructor, so the field comes from
    // ExpeditionPlannerDate.ui (a row holding the QDateEdit, objectName
    // ExpeditionPlannerCalloutStart). Its wrapper exposes no signals and
    // no date getters: only property()/setProperty(), and only
    // startDateText/setStartDateText below use them. Parented to the
    // main window (null) until the grid takes it.
    var dateRow = WidgetFactory.createWidget(ExpeditionPlanner.basePath,
        "ExpeditionPlannerDate.ui", null);
    // Qt's calendar dropdown has no Today button and the bridge cannot
    // reach it, so Today sits beside the field: one click puts today's
    // date in, and the dropdown then opens on today's month. Added to
    // the row's own layout (probed live); a failure just loses the button.
    try {
        var todayButton = new QPushButton(qsTr("Today"));
        todayButton.objectName = "ExpeditionPlannerStartToday";
        todayButton.toolTip = qsTr("Set the start date to today.");
        // Without a cap the layout splits the row evenly with the date field.
        try {
            todayButton.setMaximumWidth(84);
        } catch (eWidth) {
        }
        dateRow.layout().addWidget(todayButton);
        todayButton.clicked.connect(function() { ExpeditionPlanner.startDateToday(); });
    } catch (eToday) {
    }
    grid.addWidget(dateRow, 0, 1);
    // A fresh panel starts on today; showCalloutSettings replaces it
    // with the drawing's saved start date, when there is one. Written on
    // the widget itself: setStartDateText would look it up through the
    // dock, which is still being built here (see ensureDock).
    ExpeditionPlanner.writeStartDate(
        isNull(dateRow) ? null : dateRow.findChild("ExpeditionPlannerCalloutStart"), "");
    ExpeditionPlanner.calloutField(grid, 1, qsTr("Forecast place"), false,
        "ExpeditionPlannerCalloutPlace",
        qsTr("Optional: a nearby town. Blank uses the drawing's location " +
            "rounded to about 10 km. The exact entrance is never sent."));
    layout.addLayout(grid, 0);
};

/**
 * 2. ROSTER: the people directory (people.json, this computer only) as
 * a read-only table with a Going tick per person, the buttons that
 * change it, and whether the roster goes on the card. Details are
 * typed in the Add/Edit person popup, never in the table.
 */
ExpeditionPlanner.buildRosterSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Roster"));
    layout.addWidget(new QLabel("<span style=\"color:#777\">" +
        CsPanel.escapeHtml(qsTr("Saved on this computer only. Tick Going for " +
            "this trip.")) + "</span>"), 0, 0);
    var roster = ExpeditionPlanner.calloutTable("ExpeditionPlannerCalloutRoster",
        ExpeditionPlanner.CALLOUT_ROSTER_HEADERS, 90, 200);
    roster.toolTip = qsTr("Everyone in your people directory. Tick Going " +
        "for this trip; double-click a person (or Edit person) to change " +
        "their details.");
    try {
        roster.selectionBehavior = QAbstractItemView.SelectRows;
        roster.selectionMode = QAbstractItemView.SingleSelection;
        // Read-only: only the Going tick box (a cell QCheckBox, see
        // cellCheck) changes here.
        roster.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eSel) {
    }
    layout.addWidget(roster, 0, 0);
    // Going ticks are cell checkboxes whose toggled goes to
    // onRosterGoingToggled (connected per box in fillRoster). FILLING IS
    // NOT EDITING: it returns while state.filling is set (the Station
    // Table rule).
    try {
        roster["cellDoubleClicked(int, int)"].connect(function(row, column) {
            ExpeditionPlanner.editPerson(row);
        });
    } catch (eDbl) {
        try {
            roster.cellDoubleClicked.connect(function(row, column) {
                ExpeditionPlanner.editPerson(row);
            });
        } catch (eDbl2) {
        }
    }
    var b = ExpeditionPlanner.buttonRow(layout, [qsTr("Add person"),
        qsTr("Edit person"), qsTr("Remove person"), qsTr("Show file")]);
    b[0].objectName = "ExpeditionPlannerPersonAdd";
    b[0].toolTip = qsTr("Enter someone new in the people directory. They " +
        "are ticked Going for this trip.");
    b[1].objectName = "ExpeditionPlannerPersonEdit";
    b[1].toolTip = qsTr("Change the selected person's details.");
    b[2].objectName = "ExpeditionPlannerPersonRemove";
    b[2].toolTip = qsTr("Delete the selected person from the people directory.");
    b[3].objectName = "ExpeditionPlannerPeopleFile";
    b[3].toolTip = qsTr("Show the folder holding people.json. Copy that " +
        "file to back up or move your directory.");
    b[0].clicked.connect(function() { ExpeditionPlanner.openPersonDialog(""); });
    b[1].clicked.connect(function() { ExpeditionPlanner.editPerson(-1); });
    b[2].clicked.connect(function() { ExpeditionPlanner.removePerson(); });
    b[3].clicked.connect(function() { ExpeditionPlanner.showPeopleFile(); });
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerPeopleStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(status, 0, 0);
    var include = new QCheckBox(qsTr("Include roster on the card"));
    include.objectName = "ExpeditionPlannerCalloutInclude";
    include.toolTip = qsTr("While ticked, the card needs at least one " +
        "person going. Untick for a copy that leaves your hands.");
    include.checked = true;
    layout.addWidget(include, 0, 0);
};

/**
 * 3. TEAMS: a heading, Add team / Remove team, the Teams status line,
 * and an EMPTY body. The team sections themselves are built later, into
 * ExpeditionPlannerTeamsBody, by rebuildTeamSections -- never here: this
 * runs while the dock is being built (see ensureDock).
 */
ExpeditionPlanner.buildTeamsSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Teams"));
    layout.addWidget(new QLabel("<span style=\"color:#777\">" +
        CsPanel.escapeHtml(qsTr("Each team has its own people, schedule, " +
            "stops and packing list. Click a team to open it.")) + "</span>"), 0, 0);
    var b = ExpeditionPlanner.buttonRow(layout, [qsTr("Add team"), qsTr("Remove team"),
        qsTr("Suggest split..."), qsTr("Undo suggestion")]);
    b[0].objectName = "ExpeditionPlannerTeamAdd";
    b[0].toolTip = qsTr("Add a team. It starts with the last team's schedule.");
    b[1].objectName = "ExpeditionPlannerTeamRemove";
    b[1].toolTip = qsTr("Remove the open team (asks first). The last team " +
        "cannot be removed.");
    b[2].objectName = "ExpeditionPlannerSuggest";
    b[2].toolTip = qsTr("Propose which people and stops go on each team. " +
        "Shows a preview first; nothing changes until you press Apply.");
    b[3].objectName = "ExpeditionPlannerSuggestUndo";
    b[3].toolTip = qsTr("Put the teams back as they were before the last " +
        "applied suggestion. Gone after any change to a team by hand.");
    b[3].enabled = false;
    b[0].clicked.connect(function() { ExpeditionPlanner.addTeamClicked(); });
    b[1].clicked.connect(function() { ExpeditionPlanner.removeTeamClicked(); });
    b[2].clicked.connect(function() { ExpeditionPlanner.suggestClicked(); });
    b[3].clicked.connect(function() { ExpeditionPlanner.undoSuggestionClicked(); });
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerTeamStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(status, 0, 0);
    var body = new QWidget();
    body.objectName = "ExpeditionPlannerTeamsBody";
    var bodyLayout = new QVBoxLayout();
    bodyLayout.setContentsMargins(0, 0, 0, 0);
    bodyLayout.setSpacing(2);
    body.setLayout(bodyLayout);
    layout.addWidget(body, 0, 0);
};

/**
 * 3b. WHO FITS WHERE: a fold-away section (CsPanel.section, folded by
 * default, never remembered) holding the stops-by-people squeeze matrix,
 * a picker for extra stops, Refresh and a status line. Built from the
 * widgets in hand only (see ensureDock); the matrix is filled later, by
 * fillFit, and only while the section is open.
 */
ExpeditionPlanner.buildFitSection = function(layout) {
    var holder = new QWidget();
    holder.objectName = "ExpeditionPlannerFitSection";
    var holderLayout = new QVBoxLayout();
    holderLayout.setContentsMargins(0, 0, 0, 0);
    holderLayout.setSpacing(0);
    var title = qsTr("Who fits where");
    var shut = {};
    if (ExpeditionPlanner.state.fitOpen !== true) { shut[title] = true; }
    var sec = CsPanel.section(holder, title, "", shut);
    sec.host.objectName = "ExpeditionPlannerFitBody";
    if (sec.header !== null) {
        sec.header.objectName = "ExpeditionPlannerFitHeader";
        try {
            sec.header.styleSheet = "text-align: left; padding: 3px; font-weight: bold;";
            sec.header.toolTip = qsTr("Click to open or fold who fits where");
        } catch (eStyle) {
        }
        // After CsPanel's own handler, which has just folded or opened it:
        // opening fills the matrix, folding stops every refill.
        sec.header.clicked.connect(function() {
            var st = ExpeditionPlanner.state;
            st.fitOpen = sec.open === true;
            if (st.fitOpen) {
                ExpeditionPlanner.fillFit(true);
            }
        });
    }

    var v = new QVBoxLayout();
    v.setContentsMargins(12, 2, 0, 8);
    v.setSpacing(4);
    var intro = new QLabel("<span style=\"color:#777\">" + CsPanel.escapeHtml(
        qsTr("Each stop's tightest measured passage against each person's " +
            "squeeze limit. NO = may not fit; ? = limit or width unknown; " +
            "- = not on the surveyed line.")) + "</span>");
    try {
        intro.wordWrap = true;
    } catch (eWrap) {
    }
    v.addWidget(intro, 0, 0);
    var table = ExpeditionPlanner.calloutTable("ExpeditionPlannerFitTable",
        [qsTr("Stop"), qsTr("Tightest passage")], 90, 260);
    table.toolTip = qsTr("Every stop on a team, plus the stops added below, by " +
        "everyone ticked Going. Read-only: edit a person to change their limit.");
    try {
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.selectionMode = QAbstractItemView.SingleSelection;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eSel) {
    }
    v.addWidget(table, 0, 0);
    var pickRow = new QHBoxLayout();
    var picker = new QComboBox();
    picker.objectName = "ExpeditionPlannerFitPicker";
    picker.toolTip = qsTr("Type or pick a station to add to the matrix.");
    try {
        picker.setEditable(true);
    } catch (eEdit) {
        try {
            picker.editable = true;
        } catch (eEdit2) {
        }
    }
    try {
        // Enter must not add typed text to the list (see buildTeamSection).
        picker.insertPolicy = QComboBox.NoInsert;
    } catch (eIns) {
    }
    var add = new QPushButton(qsTr("Add stop"));
    add.objectName = "ExpeditionPlannerFitAdd";
    add.toolTip = qsTr("Add the station in the box to the matrix. It goes on no team.");
    var refresh = new QPushButton(qsTr("Refresh"));
    refresh.objectName = "ExpeditionPlannerFitRefresh";
    refresh.toolTip = qsTr("Work the matrix out again.");
    pickRow.addWidget(picker, 1, 0);
    pickRow.addWidget(add, 0, 0);
    pickRow.addWidget(refresh, 0, 0);
    v.addLayout(pickRow, 0);
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerFitStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap2) {
    }
    v.addWidget(status, 0, 0);
    add.clicked.connect(function() { ExpeditionPlanner.fitAddClicked(); });
    refresh.clicked.connect(function() { ExpeditionPlanner.fitRefreshClicked(); });

    sec.host.setLayout(v);
    holderLayout.addWidget(sec.box, 0, 0);
    holder.setLayout(holderLayout);
    layout.addWidget(holder, 0, 0);
};

/**
 * 3c. WHAT'S LEFT TO PUSH: a fold-away section (folded by default, never
 * remembered) ranking every lead (Core/CsPushRank.js): three preset
 * buttons, six weight spin boxes, the hint word fields, Show done and
 * skipped, Refresh, the read-only table, and a team dropdown with Add
 * selected to team. Built from the widgets in hand only (see ensureDock):
 * the first paint goes through a local lookup, never child(). The table
 * is filled later, by fillPush, and only while the section is open.
 */
ExpeditionPlanner.buildPushSection = function(layout) {
    var s = csEpPushDefaults(ExpeditionPlanner.state);
    var made = {};
    var keep = function(wd, name) {
        wd.objectName = name;
        made[name] = wd;
        return wd;
    };
    var holder = new QWidget();
    holder.objectName = "ExpeditionPlannerPushSection";
    var holderLayout = new QVBoxLayout();
    holderLayout.setContentsMargins(0, 0, 0, 0);
    holderLayout.setSpacing(0);
    var title = qsTr("What's left to push");
    var shut = {};
    if (s.pushOpen !== true) { shut[title] = true; }
    var sec = CsPanel.section(holder, title, "", shut);
    sec.host.objectName = "ExpeditionPlannerPushBody";
    if (sec.header !== null) {
        sec.header.objectName = "ExpeditionPlannerPushHeader";
        try {
            sec.header.styleSheet = "text-align: left; padding: 3px; font-weight: bold;";
            sec.header.toolTip = qsTr("Click to open or fold the lead ranking");
        } catch (eStyle) {
        }
        // After CsPanel's own handler, which has just folded or opened it:
        // opening ranks the leads, folding stops every refill.
        sec.header.clicked.connect(function() {
            var st = ExpeditionPlanner.state;
            st.pushOpen = sec.open === true;
            if (st.pushOpen) {
                ExpeditionPlanner.pushTeamsRefresh();
                ExpeditionPlanner.fillPush(true);
            }
        });
    }

    var v = new QVBoxLayout();
    v.setContentsMargins(12, 2, 0, 8);
    v.setSpacing(4);
    var intro = new QLabel("<span style=\"color:#777\">" + CsPanel.escapeHtml(
        qsTr("Every lead (a lead note or an open end), best first, with why. " +
            "Estimated from the survey and its notes only.")) + "</span>");
    try {
        intro.wordWrap = true;
    } catch (eWrap) {
    }
    v.addWidget(intro, 0, 0);

    // Presets, and which one is in use ("Custom" once a weight is edited).
    var presetRow = new QHBoxLayout();
    var presets = ExpeditionPlanner.PUSH_PRESETS;
    for (var p = 0; p < presets.length; p++) {
        var b = keep(new QPushButton(qsTr(presets[p].label)), presets[p].name);
        b.toolTip = qsTr(presets[p].tip);
        presetRow.addWidget(b, 0, 0);
        csEpPushPresetClick(b, presets[p].key);
    }
    presetRow.addStretch(1);
    presetRow.addWidget(keep(new QLabel(""), "ExpeditionPlannerPushPreset"), 0, 0);
    v.addLayout(presetRow, 0);

    // The six weights, two to a row.
    var grid = CsPanel.formGrid(4);
    var sigs = CsPushRank.SIGNALS;
    for (var i = 0; i < sigs.length; i++) {
        var meta = ExpeditionPlanner.PUSH_SIGNAL_LABELS[sigs[i]];
        var label = new QLabel(qsTr(meta.label));
        label.toolTip = qsTr(meta.tip);
        var spin = keep(new QSpinBox(), "ExpeditionPlannerPushW_" + sigs[i]);
        spin.toolTip = qsTr(meta.tip) + " " + qsTr("0 leaves it out; editing a weight makes the preset Custom.");
        try {
            spin.setMinimum(0);
            spin.setMaximum(100);
            spin.setMaximumWidth(70);
        } catch (eSpin) {
        }
        var row = Math.floor(i / 2);
        var col = (i % 2) * 2;
        grid.addWidget(label, row, col);
        grid.addWidget(spin, row, col + 1);
    }
    v.addLayout(grid, 0);

    // Hint words.
    var hints = CsPanel.formGrid(1);
    hints.addWidget(new QLabel(qsTr("Worth more")), 0, 0);
    var pos = keep(new QLineEdit(), "ExpeditionPlannerPushPos");
    pos.text = s.pushPos;
    pos.toolTip = qsTr("Words in a lead's notes that make it worth more, separated " +
        "by commas. Blank uses the defaults.");
    hints.addWidget(pos, 0, 1);
    hints.addWidget(new QLabel(qsTr("Worth less")), 1, 0);
    var neg = keep(new QLineEdit(), "ExpeditionPlannerPushNeg");
    neg.text = s.pushNeg;
    neg.toolTip = qsTr("Words in a lead's notes that make it worth less, separated " +
        "by commas. Blank uses the defaults.");
    hints.addWidget(neg, 1, 1);
    v.addLayout(hints, 0);

    var tickRow = new QHBoxLayout();
    var done = keep(new QCheckBox(qsTr("Show done and skipped")), "ExpeditionPlannerPushDone");
    done.toolTip = qsTr("Leads marked done or skip in the Station Table are hidden " +
        "unless this is ticked.");
    done.checked = s.pushDone === true;
    var refresh = keep(new QPushButton(qsTr("Refresh")), "ExpeditionPlannerPushRefresh");
    refresh.toolTip = qsTr("Rank the leads again.");
    tickRow.addWidget(done, 0, 0);
    tickRow.addStretch(1);
    tickRow.addWidget(refresh, 0, 0);
    v.addLayout(tickRow, 0);

    var table = ExpeditionPlanner.calloutTable("ExpeditionPlannerPushTable",
        [qsTr("Rank"), qsTr("Station"), qsTr("Score"), qsTr("Status"), qsTr("Why")], 120, 340);
    table.toolTip = qsTr("Every lead, best first. Read-only: mark a lead done or " +
        "skip in the Station Table.");
    try {
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.selectionMode = QAbstractItemView.SingleSelection;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
        table.wordWrap = true;
    } catch (eSel) {
    }
    v.addWidget(table, 0, 0);

    var addRow = new QHBoxLayout();
    addRow.addWidget(new QLabel(qsTr("Team")), 0, 0);
    // Not editable: a team is picked, never typed (no completer to crash).
    var team = keep(new QComboBox(), "ExpeditionPlannerPushTeam");
    team.toolTip = qsTr("The team Add selected to team puts the lead on.");
    var add = keep(new QPushButton(qsTr("Add selected to team")), "ExpeditionPlannerPushAdd");
    add.toolTip = qsTr("Put the selected lead on the chosen team's stops.");
    addRow.addWidget(team, 1, 0);
    addRow.addWidget(add, 0, 0);
    v.addLayout(addRow, 0);

    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerPushStatus";
    var notes = new QLabel("");
    notes.objectName = "ExpeditionPlannerPushNotes";
    try {
        status.wordWrap = true;
        notes.wordWrap = true;
        notes.visible = false;
    } catch (eWrap2) {
    }
    v.addWidget(status, 0, 0);
    v.addWidget(notes, 0, 0);

    // First paint from the widgets in hand, BEFORE any handler is connected.
    csEpPushPaint(s, function(name) { return made[name] === undefined ? null : made[name]; });
    for (var k = 0; k < sigs.length; k++) {
        csEpPushSpinChanged(made["ExpeditionPlannerPushW_" + sigs[k]], sigs[k]);
    }
    pos.editingFinished.connect(function() {
        ExpeditionPlanner.pushHintsEdited("pushPos", String(pos.text));
    });
    neg.editingFinished.connect(function() {
        ExpeditionPlanner.pushHintsEdited("pushNeg", String(neg.text));
    });
    csEpOnToggle(done, function(on) {
        ExpeditionPlanner.pushDoneToggled(typeof on === "boolean" ? on :
            ExpeditionPlanner.boxChecked(done));
    });
    refresh.clicked.connect(function() { ExpeditionPlanner.pushRefreshClicked(); });
    add.clicked.connect(function() { ExpeditionPlanner.pushAddClicked(); });

    sec.host.setLayout(v);
    holderLayout.addWidget(sec.box, 0, 0);
    holder.setLayout(holderLayout);
    layout.addWidget(holder, 0, 0);
};

/** 4. ESCALATION: who topside is, and what they do. */
ExpeditionPlanner.buildEscalationSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Escalation"));
    var grid = CsPanel.formGrid(1);
    ExpeditionPlanner.calloutField(grid, 0, qsTr("Topside contact"), true,
        "ExpeditionPlannerCalloutTopName", qsTr("Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 1, qsTr("Contact phone"), true,
        "ExpeditionPlannerCalloutTopPhone", qsTr("Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 2, qsTr("If no word by callout"), true,
        "ExpeditionPlannerCalloutEscalation",
        qsTr("Who to call next, with the number. Saved on this computer only."));
    ExpeditionPlanner.calloutField(grid, 3, qsTr("Callout buffer, min"), false,
        "ExpeditionPlannerCalloutBuffer",
        qsTr("Minutes after the expected exit that topside starts acting. Default 120."));
    layout.addLayout(grid, 0);
};

/**
 * 5. CARD: the walking pace (the whole trip's), Plan trip, Save packet,
 * Build cards, the status line, and the plan as text beneath.
 */
ExpeditionPlanner.buildCardSection = function(layout) {
    ExpeditionPlanner.heading(layout, qsTr("Card"));

    // Pace: one line, deliberately (qcad-js-bridge-traps).
    var paceGrid = CsPanel.formGrid(1);
    paceGrid.addWidget(new QLabel(qsTr("Walking pace, ft/min")), 0, 0);
    var pace = new QLineEdit();
    pace.objectName = "ExpeditionPlannerPace";
    try {
        pace.placeholderText = qsTr("264 (a 3 mph hike)");
    } catch (ePh) {
    }
    pace.toolTip = qsTr("Leave blank for the default, 264 ft a minute " +
        "(3 mph). Saved in stations.json; every team walks at this pace.");
    paceGrid.addWidget(pace, 0, 1);
    layout.addLayout(paceGrid, 0);

    var runRow = new QHBoxLayout();
    var planButton = new QPushButton(qsTr("Plan trip"));
    planButton.objectName = "ExpeditionPlannerPlanButton";
    planButton.toolTip = qsTr("Route every team from the survey's first " +
        "station to its stops and back.");
    var packetButton = new QPushButton(qsTr("Save packet"));
    packetButton.objectName = "ExpeditionPlannerSavePacket";
    packetButton.toolTip = qsTr("Write trip-plan.html beside the drawing: " +
        "route sketch, directions, time and gear. No coordinates.");
    packetButton.enabled = false;
    var build = new QPushButton(qsTr("Build cards"));
    build.objectName = "ExpeditionPlannerCalloutBuild";
    build.toolTip = qsTr("Write callout-card.html beside the drawing (with " +
        "several teams, also one file per team). Every field marked * must " +
        "be filled in first.");
    runRow.addWidget(planButton, 0, 0);
    runRow.addWidget(packetButton, 0, 0);
    runRow.addWidget(build, 0, 0);
    runRow.addStretch(1);
    layout.addLayout(runRow, 0);
    planButton.clicked.connect(function() { ExpeditionPlanner.planTrip(); });
    packetButton.clicked.connect(function() { ExpeditionPlanner.savePacket(); });
    build.clicked.connect(function() { ExpeditionPlanner.buildCard(); });

    // Its own row and word-wrapped: "Missing: ..." names every gap at
    // once, and one long line would widen the page into a horizontal
    // scroll. It sits above the plan text, never under a stretching
    // widget (qcad-js-bridge-traps: a wrapped label there is clipped).
    var status = new QLabel("");
    status.objectName = "ExpeditionPlannerCalloutStatus";
    try {
        status.wordWrap = true;
    } catch (eWrap) {
    }
    layout.addWidget(status, 0, 0);

    var out = new QPlainTextEdit();
    out.objectName = "ExpeditionPlannerPlanOut";
    out.readOnly = true;
    try {
        out.setMinimumHeight(160);
    } catch (eOutH) {
    }
    layout.addWidget(out, 1, 0);
};

/** The one page, top to bottom in the card's order. */
ExpeditionPlanner.buildPage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(4);
    var hint = new QLabel("<span style=\"color:#777\">" +
        CsPanel.escapeHtml(qsTr("* required to build the cards")) + "</span>");
    hint.objectName = "ExpeditionPlannerRequiredHint";
    layout.addWidget(hint, 0, 0);
    // Each section in its own try: a refused control costs that
    // section, never the page (qcad-js-bridge-traps: wrap per control).
    var sections = [ExpeditionPlanner.buildTripSection,
        ExpeditionPlanner.buildRosterSection,
        ExpeditionPlanner.buildTeamsSection,
        ExpeditionPlanner.buildFitSection,
        ExpeditionPlanner.buildPushSection,
        ExpeditionPlanner.buildEscalationSection,
        ExpeditionPlanner.buildCardSection];
    for (var i = 0; i < sections.length; i++) {
        try {
            sections[i](layout);
        } catch (eSection) {
            CsTell.warn("Expedition Planner: part " + (i + 1) + " of the " +
                "panel could not be built (" + eSection + ") -- please " +
                "report this.");
        }
    }
    page.setLayout(layout);
    return page;
};

ExpeditionPlanner.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Expedition Planner"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = ExpeditionPlanner.DOCK_NAME;
    var body = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(0, 0, 0, 0);
    layout.setSpacing(4);

    // The page scrolls; the footer below it does not.
    var page = ExpeditionPlanner.buildPage();
    var scroll = null;
    try {
        scroll = new QScrollArea();
        scroll.objectName = ExpeditionPlanner.PAGE_SCROLL_NAME;
        // METHODS, NOT PROPERTIES: the bridge treats several QScrollArea
        // properties as read-only (CsPanel.makeScrollable).
        scroll.setWidgetResizable(true);
        try {
            scroll.setFrameShape(QFrame.NoFrame);
        } catch (eFrame) {
        }
        try {
            scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded);
            scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded);
        } catch (ePolicy) {
        }
        scroll.setWidget(page);
        layout.addWidget(scroll, 1, 0);
    } catch (eScroll) {
        // No scroll area: the page still works, the outer
        // CsPanel.makeScrollable wrap scrolls the whole dock instead.
        layout.addWidget(page, 1, 0);
    }

    // Footer. One line, deliberately: a wrapping label under a
    // stretching page is drawn clipped (qcad-js-bridge-traps).
    var footRow = new QHBoxLayout();
    footRow.setContentsMargins(6, 0, 6, 6);
    var summary = new QLabel("");
    summary.objectName = "ExpeditionPlannerSummary";
    var refreshButton = new QPushButton(qsTr("Refresh"));
    refreshButton.objectName = "ExpeditionPlannerRefresh";
    refreshButton.toolTip = qsTr("Read the survey and stations.json again.");
    footRow.addWidget(summary, 1, 0);
    footRow.addWidget(refreshButton, 0, 0);
    layout.addLayout(footRow, 0);
    refreshButton.clicked.connect(function() { ExpeditionPlanner.reload(); });

    body.setLayout(layout);
    dock.setWidget(body);
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "ExpeditionPlanner", qsTr("Expedition Planner"));
    return dock;
};

ExpeditionPlanner.ensureDock = function() {
    if (isNull(csExpeditionPlannerDock)) {
        // A lookup made WHILE the dock is being built (child(), the
        // start-date accessors) would land here again with the global
        // still unset and build the dock again, forever: 0.9.194.0 hung
        // CaveCAD at startup that way ("Maximum call stack size
        // exceeded"). Refuse instead; child() turns the throw into null.
        if (ExpeditionPlanner.building === true) {
            throw new Error("ExpeditionPlanner: the dock is still being built");
        }
        ExpeditionPlanner.building = true;
        try {
            csExpeditionPlannerDock = ExpeditionPlanner.buildDock(
                RMainWindowQt.getMainWindow());
        } finally {
            ExpeditionPlanner.building = false;
        }
    }
    return csExpeditionPlannerDock;
};

/** A child widget by objectName, or null. Widgets are found, never stashed. */
ExpeditionPlanner.child = function(name) {
    try {
        var w = ExpeditionPlanner.ensureDock().findChild(name);
        return isNull(w) ? null : w;
    } catch (e) {
        return null;
    }
};

ExpeditionPlanner.updateSummary = function() {
    var s = ExpeditionPlanner.state;
    var label = ExpeditionPlanner.child("ExpeditionPlannerSummary");
    if (label === null) {
        return;
    }
    var text;
    if (s.drawn === null) {
        text = qsTr("No survey in this drawing.");
    } else {
        text = qsTr("%1 stations").arg(s.stations.length);
    }
    if (s.loadError !== "") {
        text += "  |  " + s.loadError;
    }
    label.text = text;
};

/**
 * True when the drawing on screen is still the one the panel was read
 * from. The panel is one dock across every tab; switching tabs does not
 * reload it, so a plan or a save must check before acting.
 */
ExpeditionPlanner.sameDrawing = function() {
    return CsStationSidecar.pathOf(CsStationSidecar.document()) ===
        ExpeditionPlanner.state.docPath;
};

/**
 * The same-drawing guard. The one dock serves every tab, so a stop
 * picked on one cave must never be routed on another.
 * \return true when it is safe to act
 */
ExpeditionPlanner.planGuard = function() {
    if (ExpeditionPlanner.sameDrawing()) {
        return true;
    }
    ExpeditionPlanner.reload();
    CsTell.warn(qsTr("Expedition Planner: the drawing changed under the " +
        "panel, so it has been read again and the trip's stops cleared. " +
        "Pick them again."));
    return false;
};

// ---------------------------------------------------------------------
// The station picker
// ---------------------------------------------------------------------

/**
 * Every station a trip can be routed to -- each end of a survey leg and
 * each fixed station -- in the order a caver reads them (A2 before A10).
 */
ExpeditionPlanner.stationNames = function(survey) {
    var names = {};
    var name;
    var degree = CsFrontier.degrees(survey);
    for (name in degree) {
        if (Object.prototype.hasOwnProperty.call(degree, name)) { names[name] = true; }
    }
    var anchors = CsFrontier.anchors(survey);
    for (name in anchors) {
        if (Object.prototype.hasOwnProperty.call(anchors, name)) { names[name] = true; }
    }
    var out = [];
    for (name in names) {
        if (Object.prototype.hasOwnProperty.call(names, name)) { out.push(name); }
    }
    out.sort(CsStationTable.compareNatural);
    return out;
};

/**
 * The station a typed name means: an exact match first, then one that
 * differs only in case. \return the station's own name, or null
 */
ExpeditionPlanner.matchStation = function(names, typed) {
    var t = String(typed === undefined || typed === null ? "" : typed)
        .replace(/^\s+|\s+$/g, "");
    if (t === "") {
        return null;
    }
    if (names.indexOf(t) >= 0) {
        return t;
    }
    var lower = t.toLowerCase();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toLowerCase() === lower) {
            return names[i];
        }
    }
    return null;
};

/** The picker's text. currentText is read as either form the bridge offers. */
ExpeditionPlanner.pickerText = function(picker) {
    try {
        return String(typeof picker.currentText === "function" ?
            picker.currentText() : picker.currentText);
    } catch (e) {
        return "";
    }
};

ExpeditionPlanner.setPickerText = function(picker, text) {
    try {
        picker.setEditText(String(text));
    } catch (e) {
    }
};

/**
 * Refill every team's stop picker from state.stations. Anything the
 * caver has typed but not added yet stays in the box.
 */
ExpeditionPlanner.fillPicker = function() {
    for (var n = 1; n <= ExpeditionPlanner.state.teams.length; n++) {
        var picker = ExpeditionPlanner.child("ExpeditionPlannerTeam" + n + "_StopPicker");
        if (picker !== null) {
            ExpeditionPlanner.fillPickerWidget(picker, ExpeditionPlanner.state.stations);
        }
    }
    var fit = ExpeditionPlanner.child("ExpeditionPlannerFitPicker");
    if (fit !== null) {
        ExpeditionPlanner.fillPickerWidget(fit, ExpeditionPlanner.state.stations);
    }
};

/** Put `names` into the picker in hand, keeping any typed text. */
ExpeditionPlanner.fillPickerWidget = function(picker, names) {
    var typed = ExpeditionPlanner.pickerText(picker);
    try {
        picker.clear();
        for (var i = 0; i < names.length; i++) {
            picker.addItem(String(names[i]));
        }
    } catch (e) {
    }
    ExpeditionPlanner.setPickerText(picker, typed);
};

// ---------------------------------------------------------------------
// Routes: pace, Plan trip, Save packet
// ---------------------------------------------------------------------

/**
 * The pace field read: null when blank (the default applies), a number
 * of ft/min when valid, NaN when it cannot be used.
 */
ExpeditionPlanner.paceTyped = function() {
    var edit = ExpeditionPlanner.child("ExpeditionPlannerPace");
    var text = edit === null ? "" : String(edit.text).replace(/^\s+|\s+$/g, "");
    if (text === "") {
        return null;
    }
    var v = Number(text);
    return (isFinite(v) && v > 0) ? v : NaN;
};

/**
 * The stored pace block with the typed pace laid over it. Other keys a
 * team set by hand in stations.json (descent rate, rig time...) are
 * kept: the panel only owns paceFtPerMin.
 */
ExpeditionPlanner.paceBlock = function(stored, typed) {
    var out = {};
    var src = (stored !== null && typeof stored === "object") ? stored : {};
    for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
            out[key] = src[key];
        }
    }
    if (typed === null) {
        delete out.paceFtPerMin;
    } else {
        out.paceFtPerMin = typed;
    }
    return out;
};

/**
 * Put the pace into stations.json settings, re-reading the file first
 * like every other write here. An unchanged pace writes nothing. Packing
 * lists are the teams' own now (settings.packing is only read once, by
 * the migration in loadTeams).
 * \return "" when saved or nothing to save, else why not
 */
ExpeditionPlanner.savePlanSettings = function(pace) {
    var s = ExpeditionPlanner.state;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("pace not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        ExpeditionPlanner.updateSummary();
        return qsTr("pace not saved: stations.json could not " +
            "be read") + " (" + side.error + ")";
    }
    var st = side.store.settings;
    var block = ExpeditionPlanner.paceBlock(st.pace, pace);
    var was = st.pace === null || typeof st.pace !== "object" ? undefined :
        st.pace.paceFtPerMin;
    var shown = { pace: pace === null ? "" : String(pace) };
    if (was !== block.paceFtPerMin) {
        st.pace = block;
        if (!CsStationSidecar.writeSidecar(path, side.store)) {
            return qsTr("pace not saved: could not write stations.json");
        }
    }
    if (s.store !== null) {
        s.store.settings = st;
    }
    s.planShown = shown;
    return "";
};

/**
 * Show the stored pace in its field. Only overwrites what the caver has
 * not edited since it was last shown (or when the drawing changed), so a
 * Refresh never eats unsaved typing.
 */
ExpeditionPlanner.showPlanSettings = function(force) {
    var s = ExpeditionPlanner.state;
    var paceEdit = ExpeditionPlanner.child("ExpeditionPlannerPace");
    if (paceEdit === null || s.store === null) {
        return;
    }
    var st = s.store.settings || {};
    var pv = (st.pace !== null && typeof st.pace === "object") ?
        st.pace.paceFtPerMin : undefined;
    var want = { pace: (typeof pv === "number" && isFinite(pv) && pv > 0) ?
        String(pv) : "" };
    var shown = s.planShown;
    var untouched = shown === null || String(paceEdit.text) === shown.pace;
    if (force === true || untouched) {
        paceEdit.text = want.pace;
        s.planShown = want;
    }
};

/** The survey's distance unit: the first trip's, "m" or "ft". */
ExpeditionPlanner.unitOf = function(survey) {
    var u = "";
    if (!isNull(survey.trips) && survey.trips.length > 0 &&
            !isNull(survey.trips[0])) {
        u = survey.trips[0].distanceUnit;
    }
    if (u !== "m" && u !== "ft") {
        u = survey.distanceUnit;
    }
    return u === "m" ? "m" : "ft";
};

/** The plan as the text the panel shows. */
ExpeditionPlanner.planText = function(p, paceUsed) {
    var unit = p.unit;
    var len = function(v) { return String(Math.round(v)) + " " + unit; };
    var lines = [];
    lines.push(qsTr("From %1, %2 stop(s), walking %3 ft/min.")
        .arg(p.start).arg(p.stops.length).arg(paceUsed));
    for (var w = 0; w < p.warnings.length; w++) {
        lines.push("WARNING: " + p.warnings[w]);
    }
    // Counted intersections, not stations: underground nobody can tell
    // which station they are at (Nathan, 2026-09-29). Same structure as
    // the signs on the printed pages.
    var leg = function(heading, steps, destination) {
        var signs = CsTripPlan.signs(steps, unit, destination);
        lines.push("");
        lines.push(heading + " " + destination + " (" +
            CsTripPlan.legSummary(signs, steps, unit).split(" · ").join(", ") + ")");
        lines = lines.concat(CsTripPlan.signsText(signs));
    };
    for (var i = 0; i < p.stops.length; i++) {
        leg("To", p.stops[i].steps, p.stops[i].station);
    }
    if (p.stops.length > 0) {
        leg("Back to", p.back.steps, p.start);
    }
    var t = p.totals;
    lines.push("");
    lines.push("Total " + CsTripPlan.clock(t.minutesAll) + "  (in " +
        CsTripPlan.clock(t.minutesIn) + ", work " +
        CsTripPlan.clock(t.minutesWork) + ", out " +
        CsTripPlan.clock(t.minutesOut) + ")");
    lines.push("Distance " + len(t.lengthIn) + " in, " + len(t.lengthAll) +
        " round trip");
    for (var r = 0; r < p.gear.rope.length; r++) {
        lines.push("Rope: " + p.gear.rope[r].text);
    }
    for (var h = 0; h < p.gear.hardware.length; h++) {
        lines.push("Rigging: " + p.gear.hardware[h]);
    }
    lines.push("");
    lines.push(qsTr("The route follows the survey line. It is not a " +
        "guarantee that the way is safe or easy."));
    return lines.join("\n");
};

/**
 * Every team's route: from the survey's first station to the team's own
 * stops and back, at the shared pace, with the team's packing list.
 * \param drawn {survey, resolved} or null (no survey: no plans)
 * \return [{team, plan}] in team order; plan null for a team without stops
 */
ExpeditionPlanner.planTeams = function(teams, drawn, config, unit) {
    var out = [];
    var list = Object.prototype.toString.call(teams) === "[object Array]" ? teams : [];
    for (var i = 0; i < list.length; i++) {
        var team = list[i];
        var stops = Object.prototype.toString.call(team.stops) === "[object Array]" ?
            team.stops : [];
        var plan = null;
        if (drawn !== null && drawn !== undefined && stops.length > 0) {
            plan = CsTripPlan.build(drawn.survey, drawn.resolved, {
                targets: stops.slice(0), unit: unit, config: config,
                packing: team.packing });
        }
        out.push({ team: team, plan: plan });
    }
    return out;
};

/** The plans as the panel's text: a heading per team, then its plan. */
ExpeditionPlanner.plansText = function(planned, paceUsed) {
    var parts = [];
    for (var i = 0; i < planned.length; i++) {
        var head = "=== " + ExpeditionPlanner.teamLabel(planned[i].team, i) + " ===";
        parts.push(head + "\n" + (planned[i].plan === null ?
            qsTr("No stops yet: add stops under this team.") :
            ExpeditionPlanner.planText(planned[i].plan, paceUsed)));
    }
    return parts.join("\n\n");
};

/**
 * Plan every team's route and show it. Saves the pace to stations.json
 * first. \return [{team, plan}], or null when nothing was planned
 */
ExpeditionPlanner.planTrip = function() {
    var s = ExpeditionPlanner.state;
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    if (!ExpeditionPlanner.planGuard()) {
        return null;
    }
    ExpeditionPlanner.flushPacking();
    var d = s.drawn;
    if (d === null) {
        CsTell.warn(qsTr("Expedition Planner: this drawing holds no survey " +
            "to plan on."));
        return null;
    }
    var any = false;
    for (var i = 0; i < s.teams.length; i++) {
        if (s.teams[i].stops.length > 0) { any = true; }
    }
    if (!any) {
        CsTell.warn(qsTr("Expedition Planner: Add at least one stop to a team."));
        return null;
    }
    var pace = ExpeditionPlanner.paceTyped();
    if (pace !== null && isNaN(pace)) {
        CsTell.warn(qsTr("Expedition Planner: the walking pace must be a " +
            "number of feet per minute above 0, or blank for the default 264."));
        return null;
    }
    var why = ExpeditionPlanner.savePlanSettings(pace);
    var config = ExpeditionPlanner.paceBlock(
        s.store === null ? {} : s.store.settings.pace, pace);
    var planned = ExpeditionPlanner.planTeams(s.teams, d, config,
        ExpeditionPlanner.unitOf(d.survey));
    s.plan = planned.length === 1 ? planned[0].plan : null;
    var text = ExpeditionPlanner.plansText(planned, CsTripPlan.config(config).paceFtPerMin);
    if (why !== "") {
        text += "\n(" + why + ")";
    }
    if (out !== null) {
        out.setPlainText(text);
    }
    ExpeditionPlanner.updatePacketButton();
    return planned;
};

/**
 * Save packet is for a one-team trip (the team files carry the route
 * otherwise), and only once that team has a plan with stops.
 */
ExpeditionPlanner.updatePacketButton = function() {
    var s = ExpeditionPlanner.state;
    var b = ExpeditionPlanner.child("ExpeditionPlannerSavePacket");
    if (b === null) {
        return;
    }
    var one = s.teams.length === 1;
    try {
        b.enabled = one && s.plan !== null && s.plan.stops.length > 0;
        b.toolTip = one ? qsTr("Write trip-plan.html beside the drawing: " +
            "route sketch, directions, time and gear. No coordinates.") :
            qsTr("Only for a one-team trip: the team files include the route.");
    } catch (e) {
    }
};

/** Today as YYYY-MM-DD (JS Date: the bridge has no QDate). */
ExpeditionPlanner.today = function() {
    var d = new Date();
    var two = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
};

/**
 * Write trip-plan.html beside the drawing, for a one-team trip. Re-plans
 * first, so the packet is always what the panel shows for the team's
 * stops and packing and the pace now.
 * \return the path written, or ""
 */
ExpeditionPlanner.savePacket = function() {
    var s = ExpeditionPlanner.state;
    if (!ExpeditionPlanner.planGuard()) {
        return "";
    }
    if (s.teams.length !== 1) {
        CsTell.warn(qsTr("Expedition Planner: Save packet is for a one-team " +
            "trip. With several teams, Build cards writes a file per team " +
            "that includes its route."));
        return "";
    }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        CsTell.warn(qsTr("Expedition Planner: save the drawing first. The " +
            "packet is written beside it."));
        return "";
    }
    var planned = ExpeditionPlanner.planTrip();
    var plan = planned === null ? null : planned[0].plan;
    if (plan === null || plan.stops.length === 0) {
        return "";
    }
    var html = CsTripPlan.packetHtml(plan, {
        title: CsCave.nameOf(s.docPath) || qsTr("Cave"),
        survey: s.drawn.survey, resolved: s.drawn.resolved,
        date: ExpeditionPlanner.today() });
    var path = CsCave.folderOf(s.docPath) + "/trip-plan.html";
    if (!CsStationSidecar.writeText(path, html)) {
        CsTell.warn(qsTr("Expedition Planner: could not write trip-plan.html " +
            "beside the drawing."));
        return "";
    }
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    if (out !== null) {
        out.setPlainText(String(out.toPlainText()) + "\n\n" +
            qsTr("Packet saved: %1").arg(path));
    }
    try {
        EAction.handleUserMessage(qsTr("Expedition Planner: packet saved as %1")
            .arg(path));
    } catch (eMsg) {
    }
    return path;
};

/** Forget the plan (the drawing changed; its teams are loaded again). */
ExpeditionPlanner.resetPlan = function() {
    var s = ExpeditionPlanner.state;
    s.plan = null;
    s.planShown = null;
    var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
    if (out !== null) {
        out.setPlainText("");
    }
    ExpeditionPlanner.updatePacketButton();
};

// ---------------------------------------------------------------------
// The people directory (ROSTER section)
// ---------------------------------------------------------------------
//
// people.json (CsPeople) is the directory; the Going ticks are the
// trip's party, saved in stations.json settings.trip.party (id and name
// only) whenever a tick changes and again on Build card. Every change to
// a person goes through applyPerson / removePersonById, which save
// people.json and repaint; the popup and the buttons only call them, so
// both can be driven without clicking.

/** Read people.json into state. A damaged file leaves the directory empty and read-only. */
ExpeditionPlanner.loadPeople = function() {
    var s = ExpeditionPlanner.state;
    var got = CsPeople.load();
    s.people = got.people;
    s.peopleError = got.error;
    var editable = got.error === "";
    var names = ["ExpeditionPlannerPersonAdd", "ExpeditionPlannerPersonEdit",
        "ExpeditionPlannerPersonRemove"];
    for (var i = 0; i < names.length; i++) {
        var b = ExpeditionPlanner.child(names[i]);
        if (b !== null) {
            try {
                b.enabled = editable;
            } catch (eEn) {
            }
        }
    }
};

/** The status line under the roster: the damage first, when there is any. */
ExpeditionPlanner.peopleSay = function(text) {
    var s = ExpeditionPlanner.state;
    var label = ExpeditionPlanner.child("ExpeditionPlannerPeopleStatus");
    if (label === null) {
        return;
    }
    var parts = [];
    if (s.peopleError !== "") {
        parts.push("<span style=\"color:#c00\">" + CsPanel.escapeHtml(
            qsTr("people.json could not be read, so the directory is " +
                "read-only and will not be overwritten: %1. Fix or move " +
                "the file (Show file), then press Refresh.").arg(s.peopleError)) +
            "</span>");
    }
    if (text !== undefined && text !== null && String(text) !== "") {
        parts.push(CsPanel.escapeHtml(String(text)));
    }
    label.text = parts.join("<br>");
};

/**
 * A tick box in a table cell (the roster's Going, the Suggest popup's
 * Lock): a real QCheckBox placed with setCellWidget. NOT a checkable
 * QTableWidgetItem: in this app's dark theme a checkable item draws its
 * indicator only in the table's very first cell (measured live
 * 2026-09-29, even in a bare QTableWidget), so every other row showed no
 * box at all. The cell keeps an empty, read-only, non-checkable item so
 * rows still select. `checked` is set BEFORE `toggled` is connected, so
 * building never fires the handler; the handler gets (on, row) and must
 * itself return while its fill guard is up (a refill or Free everything
 * sets boxes by code, which fires toggled as a click does). Old cell
 * widgets go when the table's rows do: never deleteLater here.
 * \return the QCheckBox
 */
ExpeditionPlanner.cellCheck = function(table, row, col, checked, onToggle, objectName) {
    var it = new QTableWidgetItem("");
    try {
        it.setFlags(it.flags() & ~Qt.ItemIsEditable & ~Qt.ItemIsUserCheckable);
    } catch (eFlags) {
    }
    table.setItem(row, col, it);
    var cb = new QCheckBox();
    if (objectName !== undefined && objectName !== null) {
        cb.objectName = String(objectName);
    }
    cb.checked = checked === true;
    if (typeof onToggle === "function") {
        var fn = function() {
            onToggle(ExpeditionPlanner.boxChecked(cb), row);
        };
        try {
            cb["toggled(bool)"].connect(fn);
        } catch (eTog) {
            try {
                cb.toggled.connect(fn);
            } catch (eTog2) {
                try {
                    cb.clicked.connect(fn);
                } catch (eClick) {
                }
            }
        }
    }
    table.setCellWidget(row, col, cb);
    return cb;
};

/** A checkbox's state; `checked` is a property here, a method elsewhere. */
ExpeditionPlanner.boxChecked = function(box) {
    try {
        if (isNull(box)) {
            return false;
        }
        var v = box.checked;
        if (typeof v === "function") {
            v = box.checked();
        } else if (v === undefined && typeof box.isChecked === "function") {
            v = box.isChecked();
        }
        return v === true;
    } catch (e) {
        return false;
    }
};

/** Set a checkbox by code (fires toggled when it changes, as a click does). */
ExpeditionPlanner.setBoxChecked = function(box, on) {
    try {
        if (isNull(box)) {
            return;
        }
        if (typeof box.setChecked === "function") {
            box.setChecked(on === true);
        } else {
            box.checked = on === true;
        }
    } catch (e) {
    }
};

/** The cell tick box at (row, col), or null. */
ExpeditionPlanner.cellBox = function(table, row, col) {
    try {
        var w = table.cellWidget(row, col);
        return isNull(w) ? null : w;
    } catch (e) {
        return null;
    }
};

/** Whether the cell tick box at (row, col) is ticked; no box is false. */
ExpeditionPlanner.cellChecked = function(table, row, col) {
    return ExpeditionPlanner.boxChecked(ExpeditionPlanner.cellBox(table, row, col));
};

/** A read-only cell, grey when `grey`, with an optional tooltip. */
ExpeditionPlanner.readOnlyItem = function(text, grey, tip) {
    var it = new QTableWidgetItem(String(text));
    try {
        it.setFlags(it.flags() & ~Qt.ItemIsEditable);
    } catch (eFlags) {
    }
    if (grey === true) {
        try {
            it.setForeground(new QBrush(new QColor("#777777")));
        } catch (eGrey) {
        }
    }
    if (tip !== undefined && tip !== null && String(tip) !== "") {
        try {
            it.setToolTip(String(tip));
        } catch (eTip) {
        }
    }
    return it;
};

/**
 * Repaint the roster: everyone in the directory, ticked when they are
 * in `party` (matched by id, then name: CsPeople.resolveParty), then the
 * party members this computer has no details for, ticked, read-only and
 * grey. Fill-guarded, so it writes nothing.
 */
ExpeditionPlanner.fillRoster = function(party) {
    var s = ExpeditionPlanner.state;
    var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    if (t === null) {
        return;
    }
    var resolved = CsPeople.resolveParty(party, s.people);
    var going = {};
    var extras = [];
    for (var r = 0; r < resolved.length; r++) {
        if (resolved[r].known) {
            going["#" + resolved[r].id] = true;
        } else {
            extras.push({ id: resolved[r].id, name: resolved[r].name });
        }
    }
    var onGoing = function(on, r) {
        ExpeditionPlanner.onRosterGoingToggled(r);
    };
    var goingBox = function(r, on) {
        ExpeditionPlanner.cellCheck(t, r, 0, on, onGoing, "ExpeditionPlannerGoing_" + r);
    };
    s.filling = true;
    try {
        ExpeditionPlanner.retireCellBoxes(t, 0, "ExpeditionPlannerGoing_");
        t.setRowCount(0);
        s.rosterRows = [];
        var row;
        for (var i = 0; i < s.people.length; i++) {
            var p = s.people[i];
            row = t.rowCount;
            t.setRowCount(row + 1);
            goingBox(row, going["#" + p.id] === true);
            t.setItem(row, 1, ExpeditionPlanner.readOnlyItem(p.name));
            t.setItem(row, 2, ExpeditionPlanner.readOnlyItem(p.role));
            t.setItem(row, 3, ExpeditionPlanner.readOnlyItem(
                p.squeeze === null ? "" : p.squeeze));
            t.setItem(row, 4, ExpeditionPlanner.readOnlyItem(
                CsPeople.skillLabels(p).join(" · "), false, p.skillsNote));
            t.setItem(row, 5, ExpeditionPlanner.readOnlyItem(p.medical));
            t.setItem(row, 6, ExpeditionPlanner.readOnlyItem(p.emergency));
            s.rosterRows.push({ id: p.id, name: p.name, known: true });
        }
        for (var x = 0; x < extras.length; x++) {
            row = t.rowCount;
            t.setRowCount(row + 1);
            goingBox(row, true);
            t.setItem(row, 1, ExpeditionPlanner.readOnlyItem(extras[x].name, true,
                qsTr("On this trip's party, but not in the people directory " +
                    "on this computer. Add person to enter their details; " +
                    "untick Going to take them off the trip.")));
            t.setItem(row, 2, ExpeditionPlanner.readOnlyItem(
                qsTr("details not on this computer"), true));
            for (var c = 3; c < ExpeditionPlanner.CALLOUT_ROSTER_HEADERS.length; c++) {
                t.setItem(row, c, ExpeditionPlanner.readOnlyItem("", true));
            }
            s.rosterRows.push({ id: extras[x].id, name: extras[x].name, known: false });
        }
    } finally {
        s.filling = false;
    }
};

/**
 * Before a table's rows are cleared: hide its column-`col` tick boxes
 * and rename them off `prefix`, so findChild never hands back one Qt has
 * not deleted yet. Never deleteLater: clearing the rows retires them.
 */
ExpeditionPlanner.retireCellBoxes = function(table, col, prefix) {
    var s = ExpeditionPlanner.state;
    var n = 0;
    try {
        n = table.rowCount;
    } catch (eCount) {
        n = 0;
    }
    for (var r = 0; typeof n === "number" && r < n; r++) {
        var box = ExpeditionPlanner.cellBox(table, r, col);
        if (box === null) {
            continue;
        }
        s.removedCount = (typeof s.removedCount === "number" ? s.removedCount : 0) + 1;
        try {
            box.visible = false;
        } catch (eHide) {
        }
        csEpRenameTree(box, prefix, "ExpeditionPlannerRemoved" + s.removedCount + "_" +
            prefix.replace(/^ExpeditionPlanner/, ""), 0);
    }
};

/** Whether a roster row's Going box is ticked. */
ExpeditionPlanner.rowGoing = function(t, r) {
    return ExpeditionPlanner.cellChecked(t, r, 0);
};

/**
 * The party the Going ticks say: the directory's ticked people (id and
 * name, directory order; CsPeople.partyOf), then the ticked people this
 * computer has no details for. Without the table, what stations.json
 * held.
 */
ExpeditionPlanner.readParty = function() {
    var s = ExpeditionPlanner.state;
    var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
    if (t === null) {
        return (s.store !== null && s.store.settings.trip) ?
            (s.store.settings.trip.party || []) : [];
    }
    var ids = [];
    var extras = [];
    var n = Math.min(t.rowCount, s.rosterRows.length);
    for (var r = 0; r < n; r++) {
        if (!ExpeditionPlanner.rowGoing(t, r)) {
            continue;
        }
        if (s.rosterRows[r].known) {
            ids.push(s.rosterRows[r].id);
        } else {
            extras.push({ id: s.rosterRows[r].id, name: s.rosterRows[r].name });
        }
    }
    return CsStationStore.cleanTrip({
        party: CsPeople.partyOf(s.people, ids).concat(extras) }).party;
};

/**
 * Put the party into stations.json settings.trip.party, re-reading the
 * file first like every other write here. An unchanged party writes
 * nothing. \return "" when saved or nothing to save, else why not
 */
ExpeditionPlanner.saveParty = function(party) {
    var s = ExpeditionPlanner.state;
    var clean = CsStationStore.cleanTrip({ party: party }).party;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("Going not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        return qsTr("Going not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    var trip = side.store.settings.trip || CsStationStore.emptyTrip();
    if (JSON.stringify(trip.party || []) !== JSON.stringify(clean)) {
        trip.party = clean;
        side.store.settings.trip = trip;
        if (!CsStationSidecar.writeSidecar(path, side.store)) {
            return qsTr("Going not saved: could not write stations.json");
        }
    }
    if (s.store !== null) {
        if (!s.store.settings.trip) { s.store.settings.trip = CsStationStore.emptyTrip(); }
        s.store.settings.trip.party = clean;
    }
    return "";
};

/** A Going box on roster row `row` toggled: the party is saved at once (not on fills). */
ExpeditionPlanner.onRosterGoingToggled = function(row) {
    var s = ExpeditionPlanner.state;
    if (s.filling) {
        return;
    }
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
    // The team sections offer the Going people as members.
    ExpeditionPlanner.rebuildTeamSections();
};

/** The directory index of a person id, or -1. */
ExpeditionPlanner.personIndex = function(id) {
    var list = ExpeditionPlanner.state.people;
    for (var i = 0; id !== "" && i < list.length; i++) {
        if (list[i].id === id) {
            return i;
        }
    }
    return -1;
};

/**
 * Create or update a person from the popup's fields, save people.json
 * and repaint, keeping the Going ticks. A new person is ticked Going.
 * The dialog calls this on OK; it can also be driven directly.
 *
 * \param fields {name, role, squeeze (text), medical, emergency,
 *   skills: [ids], skillsNote}
 * \param existingId the person to update, or "" to add
 * \return "" when saved, else why not (nothing changed)
 */
ExpeditionPlanner.applyPerson = function(fields, existingId) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        return qsTr("people.json could not be read, so nothing was changed") +
            " (" + s.peopleError + ")";
    }
    var problems = CsPeople.validate(fields);
    if (problems.length > 0) {
        return qsTr("Needed: %1").arg(problems.join(", "));
    }
    var trim = function(v) {
        return (v === undefined || v === null ? "" : String(v)).replace(/^\s+|\s+$/g, "");
    };
    var party = ExpeditionPlanner.readParty();
    var before = JSON.parse(JSON.stringify(s.people));
    var at = ExpeditionPlanner.personIndex(existingId === undefined ||
        existingId === null ? "" : String(existingId));
    var p;
    if (at >= 0) {
        p = s.people[at];
    } else {
        p = CsPeople.blank();
        s.people.push(p);
    }
    p.name = trim(fields.name);
    p.role = trim(fields.role);
    var sq = trim(fields.squeeze);
    p.squeeze = sq === "" ? null : Number(sq);
    p.medical = trim(fields.medical);
    p.emergency = trim(fields.emergency);
    p.skills = Object.prototype.toString.call(fields.skills) === "[object Array]" ?
        fields.skills.slice(0) : [];
    p.skillsNote = trim(fields.skillsNote);
    var why = CsPeople.save(s.people);
    if (why !== "") {
        s.people = before;
        return why;
    }
    // Re-read through the codec: the table shows what the file now holds.
    s.people = CsPeople.parse(CsPeople.serialize(s.people)).people;
    if (at < 0) {
        party.push({ id: p.id, name: p.name });
    }
    ExpeditionPlanner.fillRoster(party);
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
    ExpeditionPlanner.rebuildTeamSections();
    return "";
};

/**
 * Delete a person from the directory and untick them from this trip.
 * No question asked here: removePerson asks first.
 * \return "" when done, else why not (nothing changed)
 */
ExpeditionPlanner.removePersonById = function(id) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        return qsTr("people.json could not be read, so nothing was changed") +
            " (" + s.peopleError + ")";
    }
    var at = ExpeditionPlanner.personIndex(String(id));
    if (at < 0) {
        return qsTr("That person is not in the people directory.");
    }
    var party = ExpeditionPlanner.readParty();
    var keep = [];
    for (var i = 0; i < party.length; i++) {
        if (party[i].id !== id) { keep.push(party[i]); }
    }
    var before = JSON.parse(JSON.stringify(s.people));
    s.people.splice(at, 1);
    var why = CsPeople.save(s.people);
    if (why !== "") {
        s.people = before;
        return why;
    }
    ExpeditionPlanner.fillRoster(keep);
    ExpeditionPlanner.peopleSay(ExpeditionPlanner.saveParty(
        ExpeditionPlanner.readParty()));
    ExpeditionPlanner.rebuildTeamSections();
    return "";
};

/** The row a button acts on: the one given, else the selected one. */
ExpeditionPlanner.rosterRowFor = function(row) {
    var s = ExpeditionPlanner.state;
    var r = row;
    if (typeof r !== "number" || r < 0) {
        var t = ExpeditionPlanner.child("ExpeditionPlannerCalloutRoster");
        r = t === null ? -1 : ExpeditionPlanner.selectedRowOf(t);
    }
    return (r >= 0 && r < s.rosterRows.length) ? s.rosterRows[r] : null;
};

/** Edit person (the button, or a double-click on row `row`). */
ExpeditionPlanner.editPerson = function(row) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var entry = ExpeditionPlanner.rosterRowFor(row);
    if (entry === null) {
        ExpeditionPlanner.peopleSay(qsTr("Pick a person in the table first."));
        return;
    }
    if (!entry.known) {
        ExpeditionPlanner.peopleSay(qsTr("%1 is not in the people directory " +
            "on this computer. Add person to enter their details.").arg(entry.name));
        return;
    }
    ExpeditionPlanner.openPersonDialog(entry.id);
};

/** Remove person: asks first, default No. */
ExpeditionPlanner.removePerson = function() {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var entry = ExpeditionPlanner.rosterRowFor(-1);
    if (entry === null) {
        ExpeditionPlanner.peopleSay(qsTr("Pick a person in the table first."));
        return;
    }
    if (!entry.known) {
        ExpeditionPlanner.peopleSay(qsTr("%1 is not in the people directory; " +
            "untick Going to take them off this trip.").arg(entry.name));
        return;
    }
    // Parented to the main window and compared to QMessageBox.Yes
    // (qcad-js-bridge-traps: never truthy-test a message box answer).
    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Remove person"),
        qsTr("Remove %1 from the people directory? This deletes their " +
            "saved details from this computer.").arg(entry.name),
        QMessageBox.Yes | QMessageBox.No, QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    var why = ExpeditionPlanner.removePersonById(entry.id);
    if (why !== "") {
        ExpeditionPlanner.peopleSay(why);
    }
};

/** Show file: the folder holding people.json, in the desktop's file manager. */
ExpeditionPlanner.showPeopleFile = function() {
    var folder = CsPeople.folder();
    if (folder === "") {
        ExpeditionPlanner.peopleSay(qsTr("The per-user data folder is unknown."));
        return;
    }
    var there = false;
    try {
        there = (new QFileInfo(CsPeople.path())).exists();
    } catch (eInfo) {
    }
    ExpeditionPlanner.peopleSay(there ?
        qsTr("people.json is in %1").arg(folder) :
        qsTr("No one saved yet: people.json appears in %1 after the first " +
            "Add person.").arg(folder));
    try {
        // Same call CaveShelf.reveal ships.
        QDesktopServices.openUrl(new QUrl("file://" + folder));
    } catch (eOpen) {
    }
};

/**
 * One collapsible skills category in the person popup: a CsPanel
 * section (chevron header, never a checkbox) whose header counts the
 * ticked boxes live, e.g. "Survey (2)". Open when the person already has
 * one of its skills, shut otherwise. Never remembered between openings.
 */
ExpeditionPlanner.addSkillGroup = function(parent, layout, group, person, boxes) {
    var titleFor = function(n) {
        return group.label + (n > 0 ? " (" + n + ")" : "");
    };
    var had = CsPeople.groupCount(person, group.id);
    var first = titleFor(had);
    var shut = {};
    if (had === 0) { shut[first] = true; }
    var sec = CsPanel.section(parent, first, "", shut);
    if (sec.header !== null) {
        sec.header.objectName = "ExpeditionPlannerPersonSkillGroup_" + group.id;
    }
    sec.host.objectName = "ExpeditionPlannerPersonSkillGroup_" + group.id + "_body";
    var grid = new QGridLayout();
    var mine = [];
    var have = {};
    var list = (person !== null && Object.prototype.toString.call(person.skills) ===
        "[object Array]") ? person.skills : [];
    for (var h = 0; h < list.length; h++) { have["#" + list[h]] = true; }
    for (var i = 0; i < group.skills.length; i++) {
        var sk = group.skills[i];
        var cb = new QCheckBox(sk.label);
        cb.objectName = "ExpeditionPlannerPersonSkill_" + sk.id;
        cb.checked = have["#" + sk.id] === true;
        grid.addWidget(cb, Math.floor(i / 2), i % 2);
        mine.push(cb);
        boxes.push({ id: sk.id, box: cb });
    }
    sec.host.setLayout(grid);
    var refresh = function() {
        if (sec.header === null) {
            return;
        }
        var n = 0;
        for (var k = 0; k < mine.length; k++) {
            if (mine[k].checked === true) { n++; }
        }
        try {
            sec.header.text = CsPanel.headerText(titleFor(n), sec.open === true);
        } catch (eText) {
        }
    };
    for (var m = 0; m < mine.length; m++) {
        try {
            mine[m]["toggled(bool)"].connect(refresh);
        } catch (eTog) {
            try {
                mine[m].clicked.connect(refresh);
            } catch (eClick) {
            }
        }
    }
    // After CsPanel's own handler, which re-titles the header with the
    // count it was built with: this puts the live count back.
    if (sec.header !== null) {
        try {
            sec.header.clicked.connect(refresh);
        } catch (eHead) {
        }
    }
    layout.addWidget(sec.box, 0, 0);
};

/**
 * The Add / Edit person popup, built but not shown: openPersonDialog
 * runs it, and a probe can show() it and drive its widgets. OK checks
 * the fields (CsPeople.validate: name, medical notes and emergency
 * contact are required) and stays open naming every gap; otherwise it
 * hands them to applyPerson and closes. Cancel changes nothing.
 * \param existingId the person to edit, or "" to add one
 */
ExpeditionPlanner.buildPersonDialog = function(existingId) {
    var s = ExpeditionPlanner.state;
    var at = ExpeditionPlanner.personIndex(existingId === undefined ||
        existingId === null ? "" : String(existingId));
    var person = at >= 0 ? s.people[at] : null;
    var id = person === null ? "" : person.id;
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.objectName = "ExpeditionPlannerPersonDialog";
    dlg.windowTitle = person === null ? qsTr("Add person") : qsTr("Edit person");
    var v = new QVBoxLayout();

    var grid = CsPanel.formGrid(1);
    var field = function(row, label, required, name, value, tip, hint) {
        grid.addWidget(new QLabel(ExpeditionPlanner.labelText(label, required)), row, 0);
        var edit = new QLineEdit();
        edit.objectName = name;
        edit.text = value === null || value === undefined ? "" : String(value);
        edit.toolTip = tip;
        if (hint !== undefined) {
            try {
                edit.placeholderText = hint;
            } catch (eHint) {
            }
        }
        grid.addWidget(edit, row, 1);
        return edit;
    };
    var nameEdit = field(0, qsTr("Name"), true, "ExpeditionPlannerPersonName",
        person === null ? "" : person.name, qsTr("As the team knows them."));
    var roleEdit = field(1, qsTr("Role"), false, "ExpeditionPlannerPersonRole",
        person === null ? "" : person.role, qsTr("Optional: lead, sketch, book, " +
            "instruments..."));
    var squeezeEdit = field(2, qsTr("Squeeze limit (in)"), false,
        "ExpeditionPlannerPersonSqueeze",
        person === null || person.squeeze === null ? "" : person.squeeze,
        qsTr("Optional: the tightest squeeze they fit, in inches."));
    var medicalEdit = field(3, qsTr("Medical notes"), true,
        "ExpeditionPlannerPersonMedical", person === null ? "" : person.medical,
        qsTr("Conditions, allergies, medication. Printed on the callout card."),
        qsTr("Type None if none: a blank is not an answer"));
    var emergencyEdit = field(4, qsTr("Emergency contact"), true,
        "ExpeditionPlannerPersonEmergency", person === null ? "" : person.emergency,
        qsTr("Name and phone, in one line."));
    v.addLayout(grid, 0);

    v.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(qsTr("Skills")) + "</b>"), 0, 0);
    var boxes = [];
    var groups = CsPeople.skillsByGroup();
    for (var g = 0; g < groups.length; g++) {
        try {
            ExpeditionPlanner.addSkillGroup(dlg, v, groups[g], person, boxes);
        } catch (eGroup) {
        }
    }
    var noteGrid = CsPanel.formGrid(1);
    noteGrid.addWidget(new QLabel(qsTr("Other skills / details")), 0, 0);
    var noteEdit = new QLineEdit();
    noteEdit.objectName = "ExpeditionPlannerPersonSkillNote";
    noteEdit.text = person === null ? "" : person.skillsNote;
    noteEdit.toolTip = qsTr("Anything the checklist does not cover. Printed " +
        "under their skills on the card.");
    noteGrid.addWidget(noteEdit, 0, 1);
    v.addLayout(noteGrid, 0);

    var err = new QLabel("");
    err.objectName = "ExpeditionPlannerPersonError";
    try {
        err.wordWrap = true;
    } catch (eWrap) {
    }
    v.addWidget(err, 0, 0);

    var row = new QHBoxLayout();
    row.addStretch(1);
    var ok = new QPushButton(qsTr("OK"));
    ok.objectName = "ExpeditionPlannerPersonOk";
    var cancel = new QPushButton(qsTr("Cancel"));
    cancel.objectName = "ExpeditionPlannerPersonCancel";
    try {
        ok["default"] = true;
    } catch (eDef) {
    }
    row.addWidget(cancel, 0, 0);
    row.addWidget(ok, 0, 0);
    v.addLayout(row, 0);

    // CLOSURES, NOT SLOT NAMES (SymbolPaletteEdit.askMeta): connect takes
    // a function in this build.
    ok.clicked.connect(function() {
        var skills = [];
        for (var b = 0; b < boxes.length; b++) {
            if (boxes[b].box.checked === true) { skills.push(boxes[b].id); }
        }
        var keep = [];
        var known = {};
        for (var k = 0; k < CsPeople.SKILLS.length; k++) { known["#" + CsPeople.SKILLS[k].id] = true; }
        // Ids the checklist does not know (a newer file) are kept.
        var old = person !== null ? person.skills : [];
        for (var o = 0; o < old.length; o++) {
            if (known["#" + old[o]] !== true) { keep.push(old[o]); }
        }
        var fields = { name: String(nameEdit.text), role: String(roleEdit.text),
            squeeze: String(squeezeEdit.text), medical: String(medicalEdit.text),
            emergency: String(emergencyEdit.text), skills: skills.concat(keep),
            skillsNote: String(noteEdit.text) };
        var problems = CsPeople.validate(fields);
        var why = problems.length > 0 ? qsTr("Needed: %1").arg(problems.join(", ")) :
            ExpeditionPlanner.applyPerson(fields, id);
        if (why !== "") {
            err.text = "<span style=\"color:#c00\">" + CsPanel.escapeHtml(why) + "</span>";
            return;
        }
        dlg.accept();
    });
    cancel.clicked.connect(function() { dlg.reject(); });
    dlg.setLayout(v);
    return dlg;
};

/** Add person ("" ) or Edit person (an id): the popup, modal. */
ExpeditionPlanner.openPersonDialog = function(existingId) {
    var s = ExpeditionPlanner.state;
    if (s.peopleError !== "") {
        ExpeditionPlanner.peopleSay("");
        return;
    }
    var dlg = ExpeditionPlanner.buildPersonDialog(existingId);
    dlg.exec();
    // destroy() THROWS on every QDialog in this build (SymbolPaletteEdit):
    // close it and hand it to Qt instead. The OK handler has already
    // saved whatever was accepted.
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
};

// ---------------------------------------------------------------------
// The Start date field
// ---------------------------------------------------------------------
//
// A QDateEdit built from ExpeditionPlannerDate.ui. It is never unset: it
// starts on today, or on the drawing's saved start date. These two are
// the only code that touches the widget's value.

/** Today's LOCAL date as yyyy-mm-dd. Separate so tests can stub it. */
ExpeditionPlanner.todayIso = function() {
    var d = new Date();
    var pad = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};

/** The field's date as yyyy-mm-dd, or "" when invalid or absent. */
ExpeditionPlanner.startDateText = function() {
    var w = ExpeditionPlanner.child("ExpeditionPlannerCalloutStart");
    if (w === null) {
        return "";
    }
    var text = "";
    try {
        text = String(w.property("text")).replace(/^\s+|\s+$/g, "");
    } catch (e) {
        return "";
    }
    if (!csStoreDateOk(text)) {
        return "";
    }
    return text;
};

/**
 * Write `text` (yyyy-mm-dd; anything else means today) into the QDateEdit
 * `w` itself. Takes the widget so the dock BUILD can initialise the field
 * without looking it up through the dock, which does not exist yet.
 */
ExpeditionPlanner.writeStartDate = function(w, text) {
    if (isNull(w)) {
        return;
    }
    var t = String(isNull(text) ? "" : text).replace(/^\s+|\s+$/g, "");
    try {
        w.setProperty("date", csStoreDateOk(t) ? t : ExpeditionPlanner.todayIso());
    } catch (e) {
    }
};

/** The Today button: put today's date in the field. */
ExpeditionPlanner.startDateToday = function() {
    ExpeditionPlanner.setStartDateText("");
};

/** Show `text` (yyyy-mm-dd) in the field; anything else shows today. */
ExpeditionPlanner.setStartDateText = function(text) {
    ExpeditionPlanner.writeStartDate(
        ExpeditionPlanner.child("ExpeditionPlannerCalloutStart"), text);
};

// ---------------------------------------------------------------------
// The callout card
// ---------------------------------------------------------------------

/**
 * The form as {trip (start date, forecast place, party), contacts,
 * roster (the party, resolved), includeRoster, pace (paceTyped)}. The
 * teams are state.teams, already written through.
 */
ExpeditionPlanner.readCalloutForm = function() {
    var text = function(name) {
        var w = ExpeditionPlanner.child(name);
        return w === null ? "" : String(w.text);
    };
    var trip = CsStationStore.cleanTrip({
        startDate: ExpeditionPlanner.startDateText(),
        weatherPlace: text("ExpeditionPlannerCalloutPlace"),
        party: ExpeditionPlanner.readParty() });
    var include = ExpeditionPlanner.child("ExpeditionPlannerCalloutInclude");
    return { trip: trip,
        contacts: CsCalloutLocal.parseContacts(CsCalloutLocal.serializeContacts({
            topName: text("ExpeditionPlannerCalloutTopName"),
            topPhone: text("ExpeditionPlannerCalloutTopPhone"),
            escalation: text("ExpeditionPlannerCalloutEscalation"),
            bufferMin: text("ExpeditionPlannerCalloutBuffer") })),
        // Everyone going, with the directory's details.
        roster: CsPeople.resolveParty(trip.party, ExpeditionPlanner.state.people),
        includeRoster: include === null ? true : include.checked === true,
        pace: ExpeditionPlanner.paceTyped() };
};

/**
 * Fill the form from stations.json (trip, party and teams), people.json
 * (the directory) and local settings (contacts), then build the team
 * sections -- after the roster, because they offer its Going people as
 * members. The roster and the team widgets are fill-guarded, so filling
 * writes nothing.
 */
ExpeditionPlanner.showCalloutSettings = function() {
    var s = ExpeditionPlanner.state;
    var set = function(name, v) {
        var w = ExpeditionPlanner.child(name);
        if (w !== null) { w.text = String(v); }
    };
    var trip = (s.store !== null && s.store.settings.trip) ?
        s.store.settings.trip : CsStationStore.emptyTrip();
    // Another drawing: a suggestion applied to the old one cannot be undone here.
    s.suggestUndo = null;
    // Nor do the old drawing's extra Who-fits-where stops belong here.
    s.fitExtra = [];
    s.fitSig = null;
    // Nor the old drawing's ranked leads (the push settings are kept).
    s.pushSig = null;
    s.pushStations = [];
    // The teams, migrated from the legacy single schedule when the file
    // has none. Loading writes nothing.
    ExpeditionPlanner.loadTeams(trip, s.store === null ? null : s.store.settings);
    // A new drawing: its newest (last) team is the open one.
    var last = s.teams[s.teams.length - 1];
    s.teamOpen = {};
    s.teamOpen[last.id] = true;
    s.activeTeamId = last.id;
    s.teamMessage = "";
    s.packingPending = null;
    if (ExpeditionPlanner.child("ExpeditionPlannerTeamsBody") === null) {
        return;
    }
    ExpeditionPlanner.setStartDateText(trip.startDate);
    set("ExpeditionPlannerCalloutPlace", trip.weatherPlace);
    var c = CsCalloutLocal.loadContacts();
    set("ExpeditionPlannerCalloutTopName", c.topName);
    set("ExpeditionPlannerCalloutTopPhone", c.topPhone);
    set("ExpeditionPlannerCalloutEscalation", c.escalation);
    set("ExpeditionPlannerCalloutBuffer", c.bufferMin);
    ExpeditionPlanner.loadPeople();
    ExpeditionPlanner.fillRoster(trip.party || []);
    ExpeditionPlanner.peopleSay("");
    ExpeditionPlanner.rebuildTeamSections();
};

/**
 * Put the trip into stations.json settings (re-reading the file first,
 * like savePlanSettings). \return "" when saved, else why not.
 */
ExpeditionPlanner.saveTrip = function(trip) {
    var s = ExpeditionPlanner.state;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("trip not saved: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        return qsTr("trip not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    // The teams belong to saveTeams: the form's trip carries none, and
    // writing it as is would wipe every saved team. The legacy single
    // days are kept as they were too (only loadTeams reads them).
    var old = side.store.settings.trip;
    var out = {};
    for (var key in trip) {
        if (Object.prototype.hasOwnProperty.call(trip, key)) { out[key] = trip[key]; }
    }
    var isArr = function(v) { return Object.prototype.toString.call(v) === "[object Array]"; };
    out.teams = (old && isArr(old.teams)) ? old.teams : [];
    if (old && isArr(old.days) && old.days.length > 0 && !(isArr(trip.days) && trip.days.length > 0)) {
        out.days = old.days;
    }
    side.store.settings.trip = out;
    if (!CsStationSidecar.writeSidecar(path, side.store)) {
        return qsTr("trip not saved: could not write stations.json");
    }
    if (s.store !== null) { s.store.settings.trip = out; }
    return "";
};

// ---------------------------------------------------------------------
// Teams: the data layer
// ---------------------------------------------------------------------
//
// state.teams is the trip's teams. It is filled by loadTeams (which is
// where a legacy single-team trip is MIGRATED: never in cleanTrip or
// serialize, so a save can never invent a phantom "Team 1") and changed
// only by the edit functions below. Every edit re-cleans the team through
// CsStationStore.cleanTeam and writes through with saveTeams.
//
// Every edit returns {done, why}: `done` is true when state.teams changed;
// `why` is "" when all is well, else a refusal or why the save failed (the
// edit then stays in memory). done:false with why "" means there was
// nothing to change.

/** At most this many teams (cleanTrip drops the rest). */
ExpeditionPlanner.MAX_TEAMS = 8;

/**
 * Fill state.teams from a stored trip: its teams as they are, else the
 * legacy days, party and settings.packing as one "Team 1" (an empty trip
 * gets one empty "Team 1"). Missing or repeated team ids get fresh ones.
 * Writes nothing. \return state.teams
 */
ExpeditionPlanner.loadTeams = function(trip, settings) {
    var t = (trip !== null && typeof trip === "object") ? trip : CsStationStore.emptyTrip();
    var st = (settings !== null && typeof settings === "object") ? settings : {};
    var list = CsTeams.fromLegacy(t, st.packing, t.party);
    var teams = [];
    var seen = {};
    for (var i = 0; i < list.length && teams.length < ExpeditionPlanner.MAX_TEAMS; i++) {
        if (list[i] === null || typeof list[i] !== "object") { continue; }
        // cleanTeam builds new objects: state never shares the store's.
        var team = CsStationStore.cleanTeam(list[i], teams.length + 1);
        if (team.id === "" || seen["#" + team.id] === true) { team.id = CsUuid.v4(); }
        seen["#" + team.id] = true;
        teams.push(team);
    }
    if (teams.length === 0) { teams.push(CsTeams.blank("Team 1")); }
    ExpeditionPlanner.state.teams = teams;
    return teams;
};

/** The index of team `id` in state.teams, or -1. */
ExpeditionPlanner.teamIndex = function(id) {
    var teams = ExpeditionPlanner.state.teams;
    for (var i = 0; i < teams.length; i++) {
        if (teams[i].id === String(id)) { return i; }
    }
    return -1;
};

/** Re-clean team `i` (its position names a blank one) and write through. */
ExpeditionPlanner.teamEdited = function(i) {
    var teams = ExpeditionPlanner.state.teams;
    var id = teams[i].id;
    teams[i] = CsStationStore.cleanTeam(teams[i], i + 1);
    teams[i].id = id;
    return { done: true, why: ExpeditionPlanner.saveTeams() };
};

var csEpNoTeam = function() {
    return { done: false, why: qsTr("That team is not in this trip.") };
};

/**
 * Put state.teams into stations.json settings.trip.teams, re-reading the
 * file first and changing nothing else in it. Unchanged teams write
 * nothing. \return "" when saved or nothing to save, else why not
 */
ExpeditionPlanner.saveTeams = function() {
    var s = ExpeditionPlanner.state;
    var clean = CsStationStore.cleanTrip({ teams: s.teams }).teams;
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        return qsTr("teams kept in memory only: save the drawing first");
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        ExpeditionPlanner.updateSummary();
        return qsTr("teams not saved: stations.json could not be read") +
            " (" + side.error + ")";
    }
    var trip = side.store.settings.trip || CsStationStore.emptyTrip();
    if (JSON.stringify(trip.teams || []) !== JSON.stringify(clean)) {
        trip.teams = clean;
        side.store.settings.trip = trip;
        if (!CsStationSidecar.writeSidecar(path, side.store)) {
            return qsTr("teams not saved: could not write stations.json");
        }
    }
    if (s.store !== null) {
        if (!s.store.settings.trip) { s.store.settings.trip = CsStationStore.emptyTrip(); }
        s.store.settings.trip.teams = JSON.parse(JSON.stringify(clean));
    }
    return "";
};

/**
 * Add a team after the last: its days and dayOffset copied (CsTeams.copyOf),
 * no members, stops or packing, named "Team N" (N its position, or the
 * next number not already a team's name). Refused at MAX_TEAMS.
 * \return {done, why, team}
 */
ExpeditionPlanner.addTeam = function() {
    var teams = ExpeditionPlanner.state.teams;
    if (teams.length >= ExpeditionPlanner.MAX_TEAMS) {
        return { done: false, why: qsTr("A trip can have at most %1 teams.")
            .arg(ExpeditionPlanner.MAX_TEAMS), team: null };
    }
    var taken = {};
    for (var i = 0; i < teams.length; i++) { taken["#" + teams[i].name.toLowerCase()] = true; }
    var n = teams.length + 1;
    while (taken["#team " + n] === true) { n++; }
    var team = teams.length > 0 ? CsTeams.copyOf(teams[teams.length - 1], "Team " + n) :
        CsTeams.blank("Team " + n);
    teams.push(team);
    var r = ExpeditionPlanner.teamEdited(teams.length - 1);
    r.team = teams[teams.length - 1];
    return r;
};

/** Remove team `id`; the last team is never removed. \return {done, why} */
ExpeditionPlanner.removeTeam = function(id) {
    var teams = ExpeditionPlanner.state.teams;
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    if (teams.length <= 1) {
        return { done: false, why: qsTr("A trip needs at least one team.") };
    }
    teams.splice(i, 1);
    return { done: true, why: ExpeditionPlanner.saveTeams() };
};

/**
 * Set a team's "name", "goal", "packing" or "dayOffset" (a whole number
 * >= 0; whole-number text is read; anything else is 0). A blank name
 * becomes "Team N". \return {done, why}
 */
ExpeditionPlanner.setTeamField = function(id, field, value) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    if (["name", "goal", "packing", "dayOffset"].indexOf(field) < 0) {
        return { done: false, why: qsTr("A team has no field %1.").arg(String(field)) };
    }
    var v = value;
    if (field === "dayOffset" && typeof v === "string" && /^\s*\d+\s*$/.test(v)) {
        v = parseInt(v, 10);
    }
    ExpeditionPlanner.state.teams[i][field] = v;
    return ExpeditionPlanner.teamEdited(i);
};

/** Replace a team's days (cleaned like trip days). \return {done, why} */
ExpeditionPlanner.setTeamDays = function(id, days) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    ExpeditionPlanner.state.teams[i].days = days;
    return ExpeditionPlanner.teamEdited(i);
};

/** Whether party/member entries `a` and `b` are one person: id, else name. */
var csEpSamePerson = function(a, b) {
    var trim = function(v) {
        return (v === undefined || v === null ? "" : String(v)).replace(/^\s+|\s+$/g, "");
    };
    var ia = trim(a.id), ib = trim(b.id);
    if (ia !== "" && ib !== "") { return ia === ib; }
    return trim(a.name).toLowerCase() === trim(b.name).toLowerCase() && trim(a.name) !== "";
};

/**
 * Put `person` ({id, name}) on team `id` (on true) or take them off. Only
 * people in the trip's party (Going) can be added, as the party has them;
 * anyone can be taken off. \return {done, why}
 */
ExpeditionPlanner.setTeamMember = function(id, person, on) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    var p = (person !== null && typeof person === "object") ? person : {};
    var members = ExpeditionPlanner.state.teams[i].members;
    var at = -1;
    for (var m = 0; m < members.length; m++) {
        if (csEpSamePerson(members[m], p)) { at = m; break; }
    }
    if (on !== true) {
        if (at < 0) { return { done: false, why: "" }; }
        members.splice(at, 1);
        return ExpeditionPlanner.teamEdited(i);
    }
    if (at >= 0) { return { done: false, why: "" }; }
    var party = ExpeditionPlanner.readParty();
    var going = null;
    for (var k = 0; k < party.length; k++) {
        if (csEpSamePerson(party[k], p)) { going = party[k]; break; }
    }
    if (going === null) {
        return { done: false, why: qsTr("%1 is not going on this trip: tick Going first.")
            .arg(String(p.name === undefined || p.name === null ? "" : p.name)) };
    }
    members.push({ id: going.id, name: going.name });
    return ExpeditionPlanner.teamEdited(i);
};

/**
 * A team's members with whether each is still in the party:
 * [{id, name, going}]. going false = kept, but "no longer going".
 * \param party optional; the Going party by default
 */
ExpeditionPlanner.teamMemberFlags = function(team, party) {
    var list = party === undefined || party === null ? ExpeditionPlanner.readParty() : party;
    var out = [];
    var members = (team !== null && typeof team === "object" &&
        Object.prototype.toString.call(team.members) === "[object Array]") ? team.members : [];
    for (var m = 0; m < members.length; m++) {
        var going = false;
        for (var k = 0; k < list.length; k++) {
            if (csEpSamePerson(list[k], members[m])) { going = true; break; }
        }
        out.push({ id: members[m].id, name: members[m].name, going: going });
    }
    return out;
};

/**
 * Add a stop to team `id`: a station of this drawing, matched as the
 * picker does (exact, then case-blind), stored under its own name. A stop
 * already there changes nothing. \return {done, why}
 */
ExpeditionPlanner.addTeamStop = function(id, station) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    var typed = String(station === undefined || station === null ? "" : station)
        .replace(/^\s+|\s+$/g, "");
    if (typed === "") {
        return { done: false, why: qsTr("Type or pick a station first.") };
    }
    var name = ExpeditionPlanner.matchStation(ExpeditionPlanner.state.stations, typed);
    if (name === null) {
        return { done: false, why: qsTr("%1 is not a station in this drawing").arg(typed) };
    }
    var stops = ExpeditionPlanner.state.teams[i].stops;
    if (stops.indexOf(name) >= 0) { return { done: false, why: "" }; }
    stops.push(name);
    return ExpeditionPlanner.teamEdited(i);
};

/** Take a stop (exact, then case-blind) off team `id`. \return {done, why} */
ExpeditionPlanner.removeTeamStop = function(id, station) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    var stops = ExpeditionPlanner.state.teams[i].stops;
    var name = ExpeditionPlanner.matchStation(stops, station);
    if (name === null) { return { done: false, why: "" }; }
    stops.splice(stops.indexOf(name), 1);
    return ExpeditionPlanner.teamEdited(i);
};

/** Empty team `id`'s stops. \return {done, why} */
ExpeditionPlanner.clearTeamStops = function(id) {
    var i = ExpeditionPlanner.teamIndex(id);
    if (i < 0) { return csEpNoTeam(); }
    if (ExpeditionPlanner.state.teams[i].stops.length === 0) { return { done: false, why: "" }; }
    ExpeditionPlanner.state.teams[i].stops = [];
    return ExpeditionPlanner.teamEdited(i);
};

/**
 * People on two teams on the same calendar day (CsTeams.sameDayConflicts)
 * for the current teams and start date (the field's, else the stored one).
 * Warnings only: nothing is ever blocked.
 */
ExpeditionPlanner.teamWarnings = function() {
    var s = ExpeditionPlanner.state;
    var start = ExpeditionPlanner.startDateText();
    if (start === "" && s.store !== null && s.store.settings.trip) {
        start = s.store.settings.trip.startDate || "";
    }
    return CsTeams.sameDayConflicts({ startDate: start, teams: s.teams });
};

// ---------------------------------------------------------------------
// Teams: the sections in the panel
// ---------------------------------------------------------------------
//
// One fold-away section per team -- CsPanel.section, the chevron helper
// the person popup's skills groups use, with no settings key so the fold
// state is never saved -- inside ExpeditionPlannerTeamsBody. Every widget
// is named ExpeditionPlannerTeam<n>_<Field>, n the team's 1-based place.
//
// THE BRIDGE CANNOT DESTROY A WIDGET ON THE SPOT, so any structural
// change (a new drawing, Add team, Remove team, a Going tick) tears ALL
// the team sections down and builds fresh ones from state.teams, reusing
// nothing: each old section is hidden and every named widget in it
// renamed ExpeditionPlannerRemoved<k>_<Field>, so findChild can never hand
// back a stale one. They are NOT deleted (see teardownTeamSections).
//
// WRITE-THROUGH, NEVER READ-BACK. A widget's handler calls the data layer
// (setTeamField, setTeamMember, setTeamDays, addTeamStop...) by team ID,
// then repaints only the headers and the Teams status line -- never the
// edited widget itself: cleanTeam trims, and refilling a field would eat
// a trailing space mid-typing. Fills run under state.filling, and every
// handler is connected after its widget's first fill.
//
// Packing is a QPlainTextEdit, which has no editingFinished: its edits
// wait 700 ms (queuePacking) so stations.json, which Drive syncs, is not
// rewritten on every keystroke; flushPacking runs before anything reads
// or rebuilds the teams.

var csEpPackingTimer = null;

/** A team's display name: its trimmed name, or "Team N" when blank. */
ExpeditionPlanner.teamLabel = function(team, index0) {
    var n = (team === null || team === undefined || team.name === undefined ||
        team.name === null) ? "" : String(team.name).replace(/^\s+|\s+$/g, "");
    return n === "" ? "Team " + (index0 + 1) : n;
};

/**
 * "3 people · 2 stops · 2 days", with a same-day mark when conflicted and
 * a squeeze mark when a member may not fit the route (teamSqueeze).
 */
ExpeditionPlanner.teamSummary = function(team, hasConflict, hasSqueeze) {
    var t = (team !== null && typeof team === "object") ? team : {};
    var count = function(v) {
        return Object.prototype.toString.call(v) === "[object Array]" ? v.length : 0;
    };
    var p = count(t.members);
    var st = count(t.stops);
    var d = count(t.days);
    var text = (p === 1 ? qsTr("1 person") : qsTr("%1 people").arg(p)) + " · " +
        (st === 1 ? qsTr("1 stop") : qsTr("%1 stops").arg(st)) + " · " +
        (d === 1 ? qsTr("1 day") : qsTr("%1 days").arg(d));
    if (hasConflict === true) {
        text += " · ⚠ " + qsTr("same-day overlap");
    }
    if (hasSqueeze === true) {
        text += " · ⚠ " + qsTr("squeeze");
    }
    return text;
};

/** A team section's header title: "Alpha — 3 people · 2 stops · 2 days". */
ExpeditionPlanner.teamHeaderTitle = function(team, index0, hasConflict, hasSqueeze) {
    return (hasConflict === true || hasSqueeze === true ? "⚠ " : "") +
        ExpeditionPlanner.teamLabel(team, index0) + " — " +
        ExpeditionPlanner.teamSummary(team, hasConflict, hasSqueeze);
};

/** "Ana Ruiz is on Team 1 and Team 2 on 2026-10-04". */
ExpeditionPlanner.conflictText = function(c) {
    var names = Object.prototype.toString.call(c.teams) === "[object Array]" ? c.teams : [];
    var list = names.length < 2 ? names.join("") :
        names.slice(0, names.length - 1).join(", ") + " and " + names[names.length - 1];
    return qsTr("%1 is on %2 on %3").arg(String(c.person)).arg(list).arg(String(c.date));
};

/** The names of the teams in a same-day overlap, as a set. */
var csEpConflicted = function(warnings) {
    var bad = {};
    for (var w = 0; w < warnings.length; w++) {
        for (var t = 0; t < warnings[w].teams.length; t++) {
            bad["#" + warnings[w].teams[t]] = true;
        }
    }
    return bad;
};

/** The header's style: left-aligned like CsPanel's, red when conflicted. */
var csEpHeaderStyle = function(conflicted) {
    return "text-align: left; padding: 3px;" + (conflicted ? " color: #c00;" : "");
};

/**
 * The Teams status line: every same-day overlap (red), then the last
 * message (a refusal, or why a save failed). `text` undefined keeps the
 * message there.
 */
ExpeditionPlanner.teamSay = function(text) {
    var s = ExpeditionPlanner.state;
    if (text !== undefined) {
        s.teamMessage = (text === null) ? "" : String(text);
    }
    var label = ExpeditionPlanner.child("ExpeditionPlannerTeamStatus");
    if (label === null) {
        return;
    }
    var parts = [];
    var warnings = ExpeditionPlanner.teamWarnings();
    for (var w = 0; w < warnings.length; w++) {
        parts.push("<span style=\"color:#c00\">⚠ " +
            CsPanel.escapeHtml(ExpeditionPlanner.conflictText(warnings[w])) + "</span>");
    }
    if (s.teamMessage !== undefined && s.teamMessage !== "") {
        parts.push(CsPanel.escapeHtml(s.teamMessage));
    }
    label.text = parts.join("<br>");
};

/**
 * Repaint every team header (name, summary, chevron, red when in a
 * same-day overlap), the Teams status line and the buttons that depend
 * on how many teams there are. Never touches a team's own fields.
 */
ExpeditionPlanner.refreshTeamHeaders = function() {
    var s = ExpeditionPlanner.state;
    var open = s.teamOpen || {};
    var bad = csEpConflicted(ExpeditionPlanner.teamWarnings());
    for (var i = 0; i < s.teams.length; i++) {
        var h = ExpeditionPlanner.child("ExpeditionPlannerTeam" + (i + 1) + "_Header");
        if (h === null) {
            continue;
        }
        var conflicted = bad["#" + s.teams[i].name] === true;
        // Its squeeze line, and the mark when a member may not fit.
        var sq = ExpeditionPlanner.teamSqueeze(s.teams[i]);
        var squeezed = sq.issues.length > 0;
        ExpeditionPlanner.showTeamSqueeze(i + 1, sq);
        try {
            h.text = CsPanel.headerText(ExpeditionPlanner.teamHeaderTitle(s.teams[i], i,
                conflicted, squeezed), open[s.teams[i].id] === true);
            h.styleSheet = csEpHeaderStyle(conflicted || squeezed);
        } catch (eHead) {
        }
    }
    var add = ExpeditionPlanner.child("ExpeditionPlannerTeamAdd");
    if (add !== null) {
        try {
            add.enabled = s.teams.length < ExpeditionPlanner.MAX_TEAMS;
        } catch (eAdd) {
        }
    }
    var remove = ExpeditionPlanner.child("ExpeditionPlannerTeamRemove");
    if (remove !== null) {
        try {
            remove.enabled = s.teams.length > 1;
        } catch (eRemove) {
        }
    }
    ExpeditionPlanner.teamSay();
    ExpeditionPlanner.updatePacketButton();
    ExpeditionPlanner.updateSuggestButtons();
    // An open Who fits where follows the teams, the party and the drawing.
    ExpeditionPlanner.fitMaybeRefresh();
    // What's left to push: its team dropdown follows the teams; an open
    // ranking follows the drawing and its Station Table marks.
    ExpeditionPlanner.pushTeamsRefresh();
    ExpeditionPlanner.pushMaybeRefresh();
};

/** After an edit of team `id`: it is the active team; repaint headers and status. */
ExpeditionPlanner.teamChanged = function(id, why) {
    var s = ExpeditionPlanner.state;
    // A change by hand: the last suggestion can no longer be undone.
    ExpeditionPlanner.clearSuggestUndo();
    if (ExpeditionPlanner.teamIndex(id) >= 0) {
        s.activeTeamId = id;
    }
    s.teamMessage = (why === undefined || why === null) ? "" : String(why);
    ExpeditionPlanner.refreshTeamHeaders();
};

/** Whether a widget handler of team `id` may act: not a fill, a live team, same drawing. */
ExpeditionPlanner.teamEditOk = function(id) {
    if (ExpeditionPlanner.state.filling === true) {
        return false;
    }
    if (ExpeditionPlanner.teamIndex(id) < 0) {
        return false;
    }
    return ExpeditionPlanner.planGuard();
};

/** Rename `obj` and everything under it from prefix `from` to `to`. */
var csEpRenameTree = function(obj, from, to, depth) {
    if (obj === null || obj === undefined || typeof obj !== "object" || depth > 16) {
        return;
    }
    try {
        var name = String(obj.objectName);
        if (name.indexOf(from) === 0) {
            obj.objectName = to + name.substring(from.length);
        }
    } catch (eName) {
    }
    var kids = [];
    try {
        // children() can hold an unwrapped (undefined) entry: skipped.
        kids = obj.children();
    } catch (eKids) {
        kids = [];
    }
    for (var i = 0; kids !== null && kids !== undefined && i < kids.length; i++) {
        csEpRenameTree(kids[i], from, to, depth + 1);
    }
};

/**
 * Take every live team section out of use: hidden, and every named widget
 * in it renamed ExpeditionPlannerRemoved<k>_...
 */
ExpeditionPlanner.teardownTeamSections = function() {
    var s = ExpeditionPlanner.state;
    for (var n = 1; n <= ExpeditionPlanner.MAX_TEAMS; n++) {
        var box = ExpeditionPlanner.child("ExpeditionPlannerTeam" + n + "_Section");
        if (box === null) {
            continue;
        }
        s.removedCount = (typeof s.removedCount === "number" ? s.removedCount : 0) + 1;
        try {
            box.visible = false;
        } catch (eHide) {
        }
        csEpRenameTree(box, "ExpeditionPlannerTeam" + n + "_",
            "ExpeditionPlannerRemoved" + s.removedCount + "_", 0);
        // NEVER deleteLater (measured 2026-09-29): destroying the section's
        // script-built editable QComboBox segfaults in
        // QCompletionModel::filter. Nor setParent(null): a detached widget
        // becomes a black top-level window (qcad-js-bridge-traps). Hidden
        // and renamed, it stays in the body, out of the way.
    }
};

/**
 * Tear the team sections down and build fresh ones from state.teams.
 * Runs only once the dock exists (the populate path and the Add/Remove
 * team buttons), never during buildDock.
 */
ExpeditionPlanner.rebuildTeamSections = function() {
    var s = ExpeditionPlanner.state;
    var body = ExpeditionPlanner.child("ExpeditionPlannerTeamsBody");
    if (body === null) {
        return;
    }
    ExpeditionPlanner.flushPacking();
    var layout = null;
    try {
        layout = body.layout();
    } catch (eLayout) {
        layout = null;
    }
    if (isNull(layout)) {
        return;
    }
    var party = ExpeditionPlanner.readParty();
    var bad = csEpConflicted(ExpeditionPlanner.teamWarnings());
    var open = s.teamOpen || {};
    s.filling = true;
    try {
        ExpeditionPlanner.teardownTeamSections();
        for (var i = 0; i < s.teams.length; i++) {
            try {
                ExpeditionPlanner.buildTeamSection(body, layout, s.teams[i], i, {
                    open: open[s.teams[i].id] === true, party: party,
                    stations: s.stations, conflicted: bad["#" + s.teams[i].name] === true });
            } catch (eTeam) {
                CsTell.warn("Expedition Planner: the section for " +
                    ExpeditionPlanner.teamLabel(s.teams[i], i) + " could not be " +
                    "built (" + eTeam + ") -- please report this.");
            }
        }
    } finally {
        s.filling = false;
    }
    ExpeditionPlanner.refreshTeamHeaders();
};

/** Fill a team's days table (the widget in hand) from `days`, fill-guarded. */
ExpeditionPlanner.fillDaysTable = function(table, days) {
    var s = ExpeditionPlanner.state;
    var was = s.filling;
    s.filling = true;
    try {
        table.setRowCount(0);
        for (var i = 0; i < days.length; i++) {
            ExpeditionPlanner.addTableRow(table, [i + 1, days[i].entry,
                days[i].workHours, days[i].night]);
        }
    } finally {
        s.filling = was;
    }
};

/** A team's days as its table shows them (cleaned by setTeamDays). */
ExpeditionPlanner.readDaysTable = function(table) {
    var cell = function(r, c) {
        var it = table.item(r, c);
        return isNull(it) ? "" : String(it.text());
    };
    var days = [];
    for (var r = 0; r < table.rowCount; r++) {
        days.push({ entry: cell(r, 1), workHours: parseFloat(cell(r, 2)), night: cell(r, 3) });
    }
    return days;
};

/** Fill a team's stop list (the widget in hand) from `stops`, fill-guarded. */
ExpeditionPlanner.fillStopsTable = function(table, stops) {
    var s = ExpeditionPlanner.state;
    var was = s.filling;
    s.filling = true;
    try {
        table.setRowCount(0);
        table.setRowCount(stops.length);
        for (var i = 0; i < stops.length; i++) {
            table.setItem(i, 0, new QTableWidgetItem(String(stops[i])));
        }
    } finally {
        s.filling = was;
    }
};

/** The team's stops now (after an edit), or []. */
var csEpTeamStops = function(id) {
    var i = ExpeditionPlanner.teamIndex(id);
    return i < 0 ? [] : ExpeditionPlanner.state.teams[i].stops;
};

/** Connect a checkbox the way the person popup's skill boxes are. */
var csEpOnToggle = function(box, fn) {
    try {
        box["toggled(bool)"].connect(fn);
    } catch (eTog) {
        try {
            box.clicked.connect(fn);
        } catch (eClick) {
        }
    }
};

/**
 * One team's section, built from `team` and the widgets in hand ONLY: it
 * must never look anything up through the dock (see ensureDock).
 * \param opts {open, party (the Going people), stations, conflicted}
 * \return the CsPanel section {box, host, header, open}
 */
ExpeditionPlanner.buildTeamSection = function(parent, layout, team, index0, opts) {
    var o = (opts !== null && typeof opts === "object") ? opts : {};
    var id = team.id;
    var pre = "ExpeditionPlannerTeam" + (index0 + 1) + "_";
    var title = ExpeditionPlanner.teamHeaderTitle(team, index0, o.conflicted === true);
    var shut = {};
    if (o.open !== true) { shut[title] = true; }
    var sec = CsPanel.section(parent, title, "", shut);
    sec.box.objectName = pre + "Section";
    sec.host.objectName = pre + "Body";
    if (sec.header !== null) {
        sec.header.objectName = pre + "Header";
        try {
            sec.header.styleSheet = csEpHeaderStyle(o.conflicted === true);
            sec.header.toolTip = qsTr("Click to open or fold this team");
        } catch (eStyle) {
        }
        // After CsPanel's own handler, which re-titles the header with
        // the title it was built with: this remembers the fold and puts
        // the live summary back.
        sec.header.clicked.connect(function() {
            var st = ExpeditionPlanner.state;
            if (!st.teamOpen) { st.teamOpen = {}; }
            st.teamOpen[id] = sec.open === true;
            if (sec.open === true) { st.activeTeamId = id; }
            ExpeditionPlanner.refreshTeamHeaders();
        });
    }

    var v = new QVBoxLayout();
    v.setContentsMargins(12, 2, 0, 8);
    v.setSpacing(4);

    // Name, goal, first day.
    var grid = CsPanel.formGrid(1);
    var nameEdit = ExpeditionPlanner.calloutField(grid, 0, qsTr("Name"), false,
        pre + "Name", qsTr("Blank is named Team N."));
    nameEdit.text = String(team.name);
    var goalEdit = ExpeditionPlanner.calloutField(grid, 1, qsTr("Goal"), false,
        pre + "Goal", qsTr("Optional: what this team is going in to do."));
    goalEdit.text = String(team.goal);
    grid.addWidget(new QLabel(ExpeditionPlanner.labelText(qsTr("Starts on trip day"),
        false)), 2, 0);
    var spin = new QSpinBox();
    spin.objectName = pre + "Offset";
    spin.toolTip = qsTr("1 is the trip's start date; 2 the day after, and so on.");
    try {
        spin.setMinimum(1);
        spin.setMaximum(366);
        spin.setValue((typeof team.dayOffset === "number" ? team.dayOffset : 0) + 1);
    } catch (eSpin) {
    }
    grid.addWidget(spin, 2, 1);
    v.addLayout(grid, 0);
    nameEdit.editingFinished.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var r = ExpeditionPlanner.setTeamField(id, "name", String(nameEdit.text));
        ExpeditionPlanner.teamChanged(id, r.why);
    });
    goalEdit.editingFinished.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var r = ExpeditionPlanner.setTeamField(id, "goal", String(goalEdit.text));
        ExpeditionPlanner.teamChanged(id, r.why);
    });
    var onSpin = function(value) {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var n = typeof value === "number" ? value : Number(spin.value);
        var r = ExpeditionPlanner.setTeamField(id, "dayOffset",
            Math.max(0, Math.round(isFinite(n) ? n : 1) - 1));
        ExpeditionPlanner.teamChanged(id, r.why);
    };
    try {
        spin["valueChanged(int)"].connect(onSpin);
    } catch (eVal) {
        try {
            spin.valueChanged.connect(onSpin);
        } catch (eVal2) {
        }
    }

    // Members: a box per Going person, then members no longer going.
    v.addWidget(new QLabel(ExpeditionPlanner.labelText(qsTr("Members"), true)), 0, 0);
    var mgrid = new QGridLayout();
    var party = Object.prototype.toString.call(o.party) === "[object Array]" ? o.party : [];
    var flags = ExpeditionPlanner.teamMemberFlags(team, party);
    var k = 0;
    var member = function(box, person) {
        csEpOnToggle(box, function() {
            if (!ExpeditionPlanner.teamEditOk(id)) { return; }
            var on = box.checked === true;
            var r = ExpeditionPlanner.setTeamMember(id, person, on);
            if (on && r.done !== true && r.why !== "") {
                // Refused (not going): the box goes back, by code.
                var st = ExpeditionPlanner.state;
                st.filling = true;
                try {
                    box.checked = false;
                } finally {
                    st.filling = false;
                }
            }
            ExpeditionPlanner.teamChanged(id, r.why);
        });
    };
    for (var p = 0; p < party.length; p++) {
        var on = false;
        for (var f = 0; f < flags.length; f++) {
            if (flags[f].going && csEpSamePerson(flags[f], party[p])) { on = true; }
        }
        var cb = new QCheckBox(String(party[p].name));
        cb.objectName = pre + "Member_" + (k + 1);
        cb.checked = on;
        mgrid.addWidget(cb, Math.floor(k / 2), k % 2);
        member(cb, { id: party[p].id, name: party[p].name });
        k++;
    }
    for (var g = 0; g < flags.length; g++) {
        if (flags[g].going) { continue; }
        var gone = new QCheckBox(qsTr("%1 (no longer going)").arg(String(flags[g].name)));
        gone.objectName = pre + "Member_" + (k + 1);
        gone.checked = true;
        gone.toolTip = qsTr("On this team but no longer ticked Going. Untick " +
            "to take them off the team.");
        try {
            gone.styleSheet = "color: #777;";
        } catch (eGrey) {
        }
        mgrid.addWidget(gone, Math.floor(k / 2), k % 2);
        member(gone, { id: flags[g].id, name: flags[g].name });
        k++;
    }
    v.addLayout(mgrid, 0);
    if (k === 0) {
        v.addWidget(new QLabel("<span style=\"color:#777\">" + CsPanel.escapeHtml(
            qsTr("Tick Going under People to offer someone here.")) + "</span>"), 0, 0);
    }
    // Who may not fit this team's route: filled (and shown) by
    // refreshTeamHeaders, which runs after every build of the sections.
    var squeeze = new QLabel("");
    squeeze.objectName = pre + "Squeeze";
    try {
        squeeze.wordWrap = true;
        squeeze.toolTip = qsTr("From the survey's recorded passage widths (LRUD) " +
            "and each member's squeeze limit. See Who fits where.");
    } catch (eSqWrap) {
    }
    squeeze.visible = false;
    v.addWidget(squeeze, 0, 0);

    // Schedule.
    v.addWidget(new QLabel(ExpeditionPlanner.labelText(
        qsTr("Days: entry time, work hours, night"), true)), 0, 0);
    var days = ExpeditionPlanner.calloutTable(pre + "Days",
        ExpeditionPlanner.CALLOUT_DAY_HEADERS, 90, 150);
    ExpeditionPlanner.fillDaysTable(days, team.days);
    v.addWidget(days, 0, 0);
    var db = ExpeditionPlanner.buttonRow(v, [qsTr("Add day"), qsTr("Remove day")]);
    db[0].objectName = pre + "DayAdd";
    db[1].objectName = pre + "DayRemove";
    db[1].toolTip = qsTr("Take the selected day off this team's schedule.");
    var daysEdited = function() {
        var r = ExpeditionPlanner.setTeamDays(id, ExpeditionPlanner.readDaysTable(days));
        ExpeditionPlanner.teamChanged(id, r.why);
    };
    var onDayItem = function(item) {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        daysEdited();
    };
    try {
        days["itemChanged(QTableWidgetItem*)"].connect(onDayItem);
    } catch (eDayChanged) {
        try {
            days.itemChanged.connect(onDayItem);
        } catch (eDayChanged2) {
        }
    }
    db[0].clicked.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var st = ExpeditionPlanner.state;
        st.filling = true;
        try {
            ExpeditionPlanner.addTableRow(days, [days.rowCount + 1, "08:00", "6", "out"]);
        } finally {
            st.filling = false;
        }
        daysEdited();
    });
    db[1].clicked.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        ExpeditionPlanner.removeTableRow(days);
        daysEdited();
    });

    // Stops.
    v.addWidget(new QLabel(ExpeditionPlanner.labelText(qsTr("Stops"), true)), 0, 0);
    var pickRow = new QHBoxLayout();
    var picker = new QComboBox();
    picker.objectName = pre + "StopPicker";
    picker.toolTip = qsTr("Type or pick a station of this drawing.");
    try {
        picker.setEditable(true);
    } catch (eEdit) {
        try {
            picker.editable = true;
        } catch (eEdit2) {
        }
    }
    try {
        // Enter must not add the typed text to the list as a new
        // "station": only Add stop adds, and only a real station.
        picker.insertPolicy = QComboBox.NoInsert;
    } catch (eIns) {
    }
    ExpeditionPlanner.fillPickerWidget(picker,
        Object.prototype.toString.call(o.stations) === "[object Array]" ? o.stations : []);
    var addStop = new QPushButton(qsTr("Add stop"));
    addStop.objectName = pre + "StopAdd";
    addStop.toolTip = qsTr("Add the station in the box to this team's stops.");
    pickRow.addWidget(picker, 1, 0);
    pickRow.addWidget(addStop, 0, 0);
    v.addLayout(pickRow, 0);
    // One line, deliberately (qcad-js-bridge-traps).
    var pickStatus = new QLabel("");
    pickStatus.objectName = pre + "StopStatus";
    v.addWidget(pickStatus, 0, 0);
    var stops = new QTableWidget(0, 1);
    stops.objectName = pre + "Stops";
    try {
        stops.horizontalHeader().visible = false;
        stops.verticalHeader().visible = false;
        stops.horizontalHeader().stretchLastSection = true;
        stops.selectionBehavior = QAbstractItemView.SelectRows;
        stops.selectionMode = QAbstractItemView.SingleSelection;
        stops.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eStops) {
    }
    try {
        stops.setMinimumHeight(70);
        stops.setMaximumHeight(120);
    } catch (eStopsH) {
    }
    ExpeditionPlanner.fillStopsTable(stops, team.stops);
    v.addWidget(stops, 0, 0);
    var sb = ExpeditionPlanner.buttonRow(v, [qsTr("Remove"), qsTr("Clear")]);
    sb[0].objectName = pre + "StopRemove";
    sb[0].toolTip = qsTr("Take the selected stop off this team's list.");
    sb[1].objectName = pre + "StopClear";
    addStop.clicked.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var typed = ExpeditionPlanner.pickerText(picker).replace(/^\s+|\s+$/g, "");
        var r = ExpeditionPlanner.addTeamStop(id, typed);
        if (r.done !== true) {
            // Blank or not a station: said here. Already a stop: silence.
            pickStatus.text = r.why;
            return;
        }
        pickStatus.text = "";
        ExpeditionPlanner.fillStopsTable(stops, csEpTeamStops(id));
        ExpeditionPlanner.setPickerText(picker, "");
        ExpeditionPlanner.teamChanged(id, r.why);
    });
    sb[0].clicked.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var idx = ExpeditionPlanner.selectedRowOf(stops);
        var list = csEpTeamStops(id);
        if (idx < 0 || idx >= list.length) { return; }
        var r = ExpeditionPlanner.removeTeamStop(id, list[idx]);
        ExpeditionPlanner.fillStopsTable(stops, csEpTeamStops(id));
        ExpeditionPlanner.teamChanged(id, r.why);
    });
    sb[1].clicked.connect(function() {
        if (!ExpeditionPlanner.teamEditOk(id)) { return; }
        var r = ExpeditionPlanner.clearTeamStops(id);
        ExpeditionPlanner.fillStopsTable(stops, csEpTeamStops(id));
        ExpeditionPlanner.teamChanged(id, r.why);
    });

    // Packing.
    v.addWidget(new QLabel(qsTr("Packing list")), 0, 0);
    var packing = new QPlainTextEdit();
    packing.objectName = pre + "Packing";
    try {
        packing.placeholderText = qsTr("This team's packing list, one item per line");
    } catch (ePh) {
    }
    packing.toolTip = qsTr("Printed in this team's file as written. Saved in " +
        "stations.json.");
    try {
        packing.setMinimumHeight(50);
        packing.setMaximumHeight(100);
    } catch (ePackH) {
    }
    packing.setPlainText(String(team.packing));
    v.addWidget(packing, 0, 0);
    // textChanged also fires on setPlainText: the fill guard, and the
    // connection made after the fill.
    packing.textChanged.connect(function() {
        if (ExpeditionPlanner.state.filling === true || ExpeditionPlanner.teamIndex(id) < 0) {
            return;
        }
        ExpeditionPlanner.queuePacking(id, String(packing.toPlainText()));
    });

    sec.host.setLayout(v);
    layout.addWidget(sec.box, 0, 0);
    return sec;
};

/** A packing edit: written after 700 ms without another one (or on flush). */
ExpeditionPlanner.queuePacking = function(id, text) {
    var s = ExpeditionPlanner.state;
    // Typing in a packing list is a change by hand (see teamChanged).
    ExpeditionPlanner.clearSuggestUndo();
    if (s.packingPending !== null && s.packingPending !== undefined &&
            s.packingPending.id !== id) {
        ExpeditionPlanner.flushPacking();
    }
    s.packingPending = { id: id, text: text };
    try {
        if (csEpPackingTimer === null) {
            csEpPackingTimer = new QTimer();
            csEpPackingTimer.singleShot = true;
            // Plain JS resolved at fire time, never a widget in the closure.
            csEpPackingTimer.timeout.connect(function() { ExpeditionPlanner.flushPacking(); });
        }
        csEpPackingTimer.start(700);
    } catch (eTimer) {
        ExpeditionPlanner.flushPacking();
    }
};

/** Write a waiting packing edit now. */
ExpeditionPlanner.flushPacking = function() {
    var s = ExpeditionPlanner.state;
    var p = s.packingPending;
    if (p === null || p === undefined) {
        return;
    }
    s.packingPending = null;
    if (ExpeditionPlanner.teamIndex(p.id) < 0) {
        return;
    }
    var r = ExpeditionPlanner.setTeamField(p.id, "packing", p.text);
    ExpeditionPlanner.teamChanged(p.id, r.why);
};

/** Add team: a new team, open, the others folded. */
ExpeditionPlanner.addTeamClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.flushPacking();
    var s = ExpeditionPlanner.state;
    ExpeditionPlanner.clearSuggestUndo();
    var r = ExpeditionPlanner.addTeam();
    s.teamMessage = r.why;
    if (r.done === true && r.team) {
        s.teamOpen = {};
        s.teamOpen[r.team.id] = true;
        s.activeTeamId = r.team.id;
        s.plan = null;
        ExpeditionPlanner.rebuildTeamSections();
    } else {
        ExpeditionPlanner.refreshTeamHeaders();
    }
};

/** Remove team: the open (last opened or edited) team, after a Yes. */
ExpeditionPlanner.removeTeamClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.flushPacking();
    var s = ExpeditionPlanner.state;
    if (s.teams.length <= 1) {
        ExpeditionPlanner.teamSay(qsTr("A trip needs at least one team."));
        return;
    }
    var i = ExpeditionPlanner.teamIndex(s.activeTeamId);
    if (i < 0) {
        i = s.teams.length - 1;
    }
    var team = s.teams[i];
    // Parented to the main window and compared to QMessageBox.Yes
    // (qcad-js-bridge-traps: never truthy-test a message box answer).
    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Remove team"),
        qsTr("Remove %1 from this trip? Its members, schedule, stops and " +
            "packing list go with it. Files already built are left as they " +
            "are.").arg(ExpeditionPlanner.teamLabel(team, i)),
        QMessageBox.Yes | QMessageBox.No, QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    ExpeditionPlanner.clearSuggestUndo();
    var r = ExpeditionPlanner.removeTeam(team.id);
    s.teamMessage = r.why;
    if (r.done !== true) {
        ExpeditionPlanner.refreshTeamHeaders();
        return;
    }
    var next = s.teams[Math.max(0, i - 1)];
    if (!s.teamOpen) { s.teamOpen = {}; }
    delete s.teamOpen[team.id];
    s.teamOpen[next.id] = true;
    s.activeTeamId = next.id;
    s.plan = null;
    ExpeditionPlanner.rebuildTeamSections();
};

// ---------------------------------------------------------------------
// Teams: Suggest split
// ---------------------------------------------------------------------
//
// A popup proposes which people and stops go on each team
// (Core/CsTeamSplit.js). Anything on a team now starts LOCKED there; the
// free items (lock unticked) are what gets distributed. Suggest only
// previews; Apply writes the proposal into state.teams (one save, one
// rebuild) after keeping a deep copy in state.suggestUndo, and Undo
// suggestion puts that copy back exactly. Any change by hand (teamChanged,
// a packing edit, Add/Remove team) or a drawing change drops the copy.
//
// The logic is in plain functions (suggestRows, suggestInput,
// suggestPreviewText, applySuggestion, undoSuggestion) so it is tested
// without widgets. The popup is built ON CLICK, after the dock exists,
// from the widgets in hand only: buildSuggestDialog never looks anything
// up through child()/ensureDock. A closed popup is hidden and renamed,
// never deleted (see teardownTeamSections).
//
// ONE TEAM PER PERSON AND PER STOP. The engine places each person and
// stop once, so someone on two teams (allowed across days) or a stop on
// two teams is shown, locked and kept on the FIRST of them; Apply takes
// them off the others. Members no longer ticked Going are not offered in
// the popup but stay locked on their team, so Apply never drops them.

var csEpArr = function(v) {
    return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
};

var csEpObj = function(v) {
    return (v !== null && typeof v === "object") ? v : {};
};

var csEpTrim = function(v) {
    return (v === undefined || v === null ? "" : String(v)).replace(/^\s+|\s+$/g, "");
};

/** The index of the first team holding `person` (csEpSamePerson), or -1. */
var csEpTeamOfPerson = function(teams, person) {
    for (var i = 0; i < teams.length; i++) {
        var members = csEpArr(csEpObj(teams[i]).members);
        for (var m = 0; m < members.length; m++) {
            if (csEpSamePerson(members[m], person)) { return i; }
        }
    }
    return -1;
};

/** A person's lock key: "id:<id>", else "n:<case-blind name>". */
ExpeditionPlanner.suggestPersonKey = function(p) {
    var o = csEpObj(p);
    var id = csEpTrim(o.id);
    return id !== "" ? "id:" + id :
        "n:" + csEpTrim(o.name).replace(/\s+/g, " ").toLowerCase();
};

/**
 * What the popup's two tables list, with each lock tick's default.
 * \param state the panel state (teams, people = the directory)
 * \param party the Going people [{id, name}]
 * \param extraStops stations added in the popup (free)
 * \return {stops: [{station, team (index or -1), currently, lock}],
 *   people: [{key, id, name, skills, squeeze, team, currently, lock}]}
 *   lock is true exactly when the item is on a team now.
 */
ExpeditionPlanner.suggestRows = function(state, party, extraStops) {
    var s = csEpObj(state);
    var teams = csEpArr(s.teams);
    var out = { stops: [], people: [] };
    var seen = {};
    var i, k;
    for (i = 0; i < teams.length; i++) {
        var stops = csEpArr(csEpObj(teams[i]).stops);
        for (k = 0; k < stops.length; k++) {
            var st = csEpTrim(stops[k]);
            if (st === "" || seen["#" + st] === true) { continue; }
            seen["#" + st] = true;
            out.stops.push({ station: st, team: i,
                currently: ExpeditionPlanner.teamLabel(teams[i], i), lock: true });
        }
    }
    var extra = csEpArr(extraStops);
    for (k = 0; k < extra.length; k++) {
        var ex = csEpTrim(extra[k]);
        if (ex === "" || seen["#" + ex] === true) { continue; }
        seen["#" + ex] = true;
        out.stops.push({ station: ex, team: -1, currently: qsTr("free"), lock: false });
    }
    var list = csEpArr(party);
    var keys = {};
    for (i = 0; i < list.length; i++) {
        var p = csEpObj(list[i]);
        var person = { id: csEpTrim(p.id), name: csEpTrim(p.name) };
        if (person.name === "") { continue; }
        var key = ExpeditionPlanner.suggestPersonKey(person);
        if (keys[key] === true) { continue; }
        keys[key] = true;
        var hit = CsPeople.resolveParty([person], csEpArr(s.people));
        var row = (hit.length > 0 && hit[0].known === true) ? hit[0] : null;
        var team = csEpTeamOfPerson(teams, person);
        out.people.push({ key: key, id: person.id, name: person.name,
            skills: row === null ? "" : CsPeople.skillLabels(row).join(", "),
            squeeze: (row === null || row.squeeze === null) ? "" : String(row.squeeze),
            team: team,
            currently: team < 0 ? qsTr("free") : ExpeditionPlanner.teamLabel(teams[team], team),
            lock: team >= 0 });
    }
    return out;
};

/**
 * The engine's input (CsTeamSplit.suggest) from the panel state and the
 * popup's ticks. A locked item stays on the team it is on now; anything
 * else is free. A tick state missing from `lockStates` means its default.
 * \param state the panel state (teams, people, drawn, store)
 * \param lockStates {stops: {station: bool}, people: {suggestPersonKey: bool}}
 * \param teamCount wanted teams, clamped to current count..MAX_TEAMS
 * \param extraStops free stations added in the popup
 * \param party the Going people (default: readParty())
 */
ExpeditionPlanner.suggestInput = function(state, lockStates, teamCount, extraStops, party) {
    var s = csEpObj(state);
    var teams = csEpArr(s.teams);
    var ls = csEpObj(lockStates);
    var stopLocks = csEpObj(ls.stops);
    var peopleLocks = csEpObj(ls.people);
    var list = (party === undefined || party === null) ? ExpeditionPlanner.readParty() : party;
    var rows = ExpeditionPlanner.suggestRows(s, list, extraStops);
    var on = function(map, key, dflt) {
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] === true : dflt;
    };
    var input = { teams: JSON.parse(JSON.stringify(teams)), freeStops: [], lockedStops: [],
        freePeople: [], lockedPeople: [], directory: csEpArr(s.people) };
    var i;
    for (i = 0; i < rows.stops.length; i++) {
        var sr = rows.stops[i];
        if (sr.team >= 0 && on(stopLocks, sr.station, sr.lock)) {
            input.lockedStops.push({ station: sr.station, team: sr.team });
        } else {
            input.freeStops.push(sr.station);
        }
    }
    for (i = 0; i < rows.people.length; i++) {
        var pr = rows.people[i];
        if (pr.team >= 0 && on(peopleLocks, pr.key, pr.lock)) {
            input.lockedPeople.push({ id: pr.id, name: pr.name, team: pr.team });
        } else {
            input.freePeople.push({ id: pr.id, name: pr.name });
        }
    }
    // Members no longer going: not offered, but kept where they are.
    for (i = 0; i < teams.length; i++) {
        var members = csEpArr(csEpObj(teams[i]).members);
        for (var m = 0; m < members.length; m++) {
            var going = false;
            for (var g = 0; g < list.length && !going; g++) {
                if (csEpSamePerson(list[g], members[m])) { going = true; }
            }
            if (going || csEpTeamOfPerson(teams, members[m]) !== i) { continue; }
            input.lockedPeople.push({ id: csEpTrim(members[m].id),
                name: csEpTrim(members[m].name), team: i });
        }
    }
    var current = Math.max(1, teams.length);
    var n = (typeof teamCount === "number" && isFinite(teamCount)) ? Math.floor(teamCount) : current;
    input.teamCount = Math.max(current, Math.min(ExpeditionPlanner.MAX_TEAMS, n));
    var drawn = s.drawn;
    input.survey = (drawn !== null && drawn !== undefined) ? drawn.survey : null;
    input.resolved = (drawn !== null && drawn !== undefined) ? drawn.resolved : null;
    input.unit = input.survey !== null ? ExpeditionPlanner.unitOf(input.survey) : "ft";
    // The pace as Plan trip uses it: the field when there is one (blank =
    // the default), else what stations.json holds.
    var stored = (s.store !== null && s.store !== undefined && s.store.settings) ?
        s.store.settings.pace : null;
    var config = ExpeditionPlanner.paceBlock(stored, null);
    if (stored !== null && typeof stored === "object" && stored.paceFtPerMin !== undefined) {
        config.paceFtPerMin = stored.paceFtPerMin;
    }
    if (ExpeditionPlanner.child("ExpeditionPlannerPace") !== null) {
        var typed = ExpeditionPlanner.paceTyped();
        if (typed === null || !isNaN(typed)) {
            config = ExpeditionPlanner.paceBlock(stored, typed);
        }
    }
    input.config = config;
    return input;
};

/**
 * The proposal as text: whether every hard limit is met, then per team
 * its name, members, stops in route order, "in X, work Y, out Z, total
 * T" and its warnings (hard ones start "! "), then the notes.
 */
ExpeditionPlanner.suggestPreviewText = function(result) {
    var r = csEpObj(result);
    var teams = csEpArr(r.teams);
    var lines = [];
    lines.push(r.feasible === true ? qsTr("Every hard limit is met.") :
        "! " + qsTr("Some hard limits are not met: see the lines marked !"));
    for (var i = 0; i < teams.length; i++) {
        var t = csEpObj(teams[i]);
        var members = csEpArr(t.members);
        var who = [];
        for (var m = 0; m < members.length; m++) { who.push(csEpTrim(csEpObj(members[m]).name)); }
        var stops = csEpArr(t.stops);
        var min = csEpObj(t.minutes);
        var num = function(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; };
        lines.push("");
        lines.push("=== " + csEpTrim(t.name) + (t.added === true ? " " + qsTr("(new)") : "") + " ===");
        lines.push(qsTr("Members: %1").arg(who.length > 0 ? who.join(", ") : qsTr("nobody")));
        lines.push(qsTr("Stops: %1").arg(stops.length > 0 ? stops.join(", ") : qsTr("none")));
        lines.push("in " + CsTripPlan.clock(num(min["in"])) + ", work " +
            CsTripPlan.clock(num(min.work)) + ", out " + CsTripPlan.clock(num(min.out)) +
            ", total " + CsTripPlan.clock(num(min.total)));
        var warnings = csEpArr(t.warnings);
        for (var w = 0; w < warnings.length; w++) {
            var wr = csEpObj(warnings[w]);
            lines.push((wr.hard === true ? "! " : "- ") + csEpTrim(wr.text));
        }
    }
    var notes = csEpArr(r.notes);
    if (notes.length > 0) {
        lines.push("");
        lines.push(qsTr("Notes:"));
        for (var n = 0; n < notes.length; n++) { lines.push("- " + String(notes[n])); }
    }
    return lines.join("\n");
};

/** The preview text as HTML for the popup: escaped, hard lines in red. */
ExpeditionPlanner.suggestPreviewHtml = function(result) {
    var lines = ExpeditionPlanner.suggestPreviewText(result).split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        var esc = CsPanel.escapeHtml(lines[i]);
        out.push(lines[i].indexOf("!") === 0 ?
            "<span style=\"color:#c00\">" + esc + "</span>" : esc);
    }
    return out.join("<br>");
};

/** Undo suggestion is enabled exactly while a snapshot is kept. */
ExpeditionPlanner.updateSuggestButtons = function() {
    var b = ExpeditionPlanner.child("ExpeditionPlannerSuggestUndo");
    if (b === null) {
        return;
    }
    var snap = ExpeditionPlanner.state.suggestUndo;
    try {
        b.enabled = snap !== null && snap !== undefined;
    } catch (e) {
    }
};

/** Forget the applied suggestion (a change by hand, another drawing). */
ExpeditionPlanner.clearSuggestUndo = function() {
    var s = ExpeditionPlanner.state;
    if (s.suggestUndo === null || s.suggestUndo === undefined) {
        return;
    }
    s.suggestUndo = null;
    ExpeditionPlanner.updateSuggestButtons();
};

/**
 * Write a CsTeamSplit proposal into the teams: teams it adds are created
 * from the last team's schedule (CsTeams.copyOf, a fresh id); each team's
 * members and stops (route order) become the proposal's; names, goals,
 * days and packing stay. Snapshots the teams first (state.suggestUndo),
 * saves once, rebuilds the sections and enables Undo suggestion.
 * \return {done, why, snapshot}
 */
ExpeditionPlanner.applySuggestion = function(result) {
    var s = ExpeditionPlanner.state;
    var r = csEpObj(result);
    var proposed = csEpArr(r.teams);
    if (proposed.length === 0) {
        return { done: false, why: qsTr("There is no suggestion to apply."), snapshot: null };
    }
    ExpeditionPlanner.flushPacking();
    var teams = s.teams;
    // A proposal made for other teams (changed since) is refused whole.
    for (var c = 0; c < proposed.length && c < teams.length; c++) {
        var pid = csEpTrim(csEpObj(proposed[c]).id);
        if (pid !== "" && pid !== teams[c].id) {
            return { done: false, why: qsTr("The teams changed since this suggestion: " +
                "press Suggest again."), snapshot: null };
        }
    }
    var snapshot = JSON.parse(JSON.stringify(teams));
    var used = {};
    for (var u = 0; u < teams.length; u++) { used["#" + teams[u].id] = true; }
    for (var i = 0; i < proposed.length && i < ExpeditionPlanner.MAX_TEAMS; i++) {
        var pt = csEpObj(proposed[i]);
        if (i >= teams.length) {
            var name = csEpTrim(pt.name);
            if (name === "") { name = "Team " + (i + 1); }
            var nt = teams.length > 0 ? CsTeams.copyOf(teams[teams.length - 1], name) :
                CsTeams.blank(name);
            while (nt.id === "" || used["#" + nt.id] === true) { nt.id = CsUuid.v4(); }
            used["#" + nt.id] = true;
            teams.push(nt);
        }
        var members = [];
        var pm = csEpArr(pt.members);
        for (var m = 0; m < pm.length; m++) {
            members.push({ id: csEpTrim(csEpObj(pm[m]).id), name: csEpTrim(csEpObj(pm[m]).name) });
        }
        var stops = [];
        var ps = csEpArr(pt.stops);
        for (var k = 0; k < ps.length; k++) { stops.push(csEpTrim(ps[k])); }
        teams[i].members = members;
        teams[i].stops = stops;
        var id = teams[i].id;
        teams[i] = CsStationStore.cleanTeam(teams[i], i + 1);
        teams[i].id = id;
    }
    s.suggestUndo = snapshot;
    s.plan = null;
    var why = ExpeditionPlanner.saveTeams();
    s.teamMessage = why !== "" ? why : qsTr("Suggestion applied. Undo suggestion " +
        "puts the teams back as they were.");
    ExpeditionPlanner.rebuildTeamSections();
    ExpeditionPlanner.updateSuggestButtons();
    return { done: true, why: why, snapshot: snapshot };
};

/**
 * Put the teams back exactly as they were before the applied suggestion
 * (ids included; teams it added go), save, rebuild and disable Undo.
 * Without a snapshot it does nothing. \return {done, why}
 */
ExpeditionPlanner.undoSuggestion = function() {
    var s = ExpeditionPlanner.state;
    var snap = s.suggestUndo;
    if (snap === null || snap === undefined) {
        return { done: false, why: "" };
    }
    s.suggestUndo = null;
    s.teams = JSON.parse(JSON.stringify(snap));
    if (ExpeditionPlanner.teamIndex(s.activeTeamId) < 0 && s.teams.length > 0) {
        s.activeTeamId = s.teams[s.teams.length - 1].id;
    }
    s.plan = null;
    var why = ExpeditionPlanner.saveTeams();
    s.teamMessage = why !== "" ? why : qsTr("Suggestion undone: the teams are back " +
        "as they were.");
    ExpeditionPlanner.rebuildTeamSections();
    ExpeditionPlanner.updateSuggestButtons();
    return { done: true, why: why };
};

/** The Undo suggestion button. */
ExpeditionPlanner.undoSuggestionClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.undoSuggestion();
};

/** Whether row `r` of a lock table is ticked; `dflt` when it cannot be read. */
var csEpTicked = function(table, r, dflt) {
    if (ExpeditionPlanner.cellBox(table, r, 0) === null) {
        return dflt;
    }
    return ExpeditionPlanner.cellChecked(table, r, 0);
};

/**
 * The Suggest split popup, built but not run (suggestClicked runs it).
 * Built from the arguments and the state only: never child()/ensureDock.
 * \param party the Going people [{id, name}]
 */
ExpeditionPlanner.buildSuggestDialog = function(party) {
    var s = ExpeditionPlanner.state;
    var list = csEpArr(party);
    var extra = [];
    var rows = ExpeditionPlanner.suggestRows(s, list, extra);
    var stopRows = rows.stops;
    var personRows = rows.people;
    var proposal = null;
    // Filling is not editing: Lock boxes set by code fire toggled.
    var filling = false;
    var pre = "ExpeditionPlannerSuggest_";
    // Anything changed after Suggest makes the preview stale (set below,
    // once Apply exists); a Lock box toggled by hand calls it.
    var stale = function() {};
    var onLock = function(on, r) {
        if (filling) { return; }
        stale();
    };

    var main = null;
    try {
        main = RMainWindowQt.getMainWindow();
    } catch (eMain) {
        main = null;
    }
    var dlg = (main === null || main === undefined) ? new QDialog() : new QDialog(main);
    dlg.objectName = "ExpeditionPlannerSuggestDialog";
    dlg.windowTitle = qsTr("Suggest split");
    var v = new QVBoxLayout();
    var intro = new QLabel("<span style=\"color:#777\">" + CsPanel.escapeHtml(
        qsTr("Ticked (locked) stops and people stay on their team; the rest " +
            "are shared out. Suggest shows a preview; nothing changes until " +
            "Apply.")) + "</span>");
    try {
        intro.wordWrap = true;
    } catch (eWrap) {
    }
    v.addWidget(intro, 0, 0);

    var grid = CsPanel.formGrid(1);
    grid.addWidget(new QLabel(qsTr("Teams")), 0, 0);
    var count = new QSpinBox();
    count.objectName = pre + "Count";
    count.toolTip = qsTr("How many teams to split into. More than now adds " +
        "teams that start with the last team's schedule.");
    try {
        count.setMinimum(Math.max(1, s.teams.length));
        count.setMaximum(ExpeditionPlanner.MAX_TEAMS);
        count.setValue(Math.max(1, s.teams.length));
    } catch (eCount) {
    }
    grid.addWidget(count, 0, 1);
    v.addLayout(grid, 0);

    var setupTable = function(t) {
        try {
            t.selectionBehavior = QAbstractItemView.SelectRows;
            t.selectionMode = QAbstractItemView.SingleSelection;
            // Only the Lock tick changes (as the roster's Going tick).
            t.editTriggers = QAbstractItemView.NoEditTriggers;
        } catch (eSel) {
        }
    };

    // Objectives.
    v.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(qsTr("Objectives")) + "</b>"), 0, 0);
    var stopsT = ExpeditionPlanner.calloutTable(pre + "Stops",
        [qsTr("Lock"), qsTr("Stop"), qsTr("Currently")], 150, 240);
    stopsT.toolTip = qsTr("Tick Lock to keep a stop on its team. Unticked stops " +
        "are shared out.");
    setupTable(stopsT);
    var fillStopRow = function(r) {
        var row = stopRows[r];
        ExpeditionPlanner.cellCheck(stopsT, r, 0, row.lock, onLock, pre + "StopLock_" + r);
        stopsT.setItem(r, 1, ExpeditionPlanner.readOnlyItem(row.station));
        stopsT.setItem(r, 2, ExpeditionPlanner.readOnlyItem(row.currently, row.team < 0));
    };
    filling = true;
    try {
        stopsT.setRowCount(stopRows.length);
        for (var sr = 0; sr < stopRows.length; sr++) { fillStopRow(sr); }
    } finally {
        filling = false;
    }
    v.addWidget(stopsT, 0, 0);
    var pickRow = new QHBoxLayout();
    var picker = new QComboBox();
    picker.objectName = pre + "StopPicker";
    picker.toolTip = qsTr("Type or pick a station to add as a free stop.");
    try {
        picker.setEditable(true);
    } catch (eEdit) {
        try {
            picker.editable = true;
        } catch (eEdit2) {
        }
    }
    try {
        picker.insertPolicy = QComboBox.NoInsert;
    } catch (eIns) {
    }
    ExpeditionPlanner.fillPickerWidget(picker, csEpArr(s.stations));
    var addStop = new QPushButton(qsTr("Add stop"));
    addStop.objectName = pre + "StopAdd";
    addStop.toolTip = qsTr("Add the station in the box as a free stop.");
    pickRow.addWidget(picker, 1, 0);
    pickRow.addWidget(addStop, 0, 0);
    v.addLayout(pickRow, 0);
    var pickStatus = new QLabel("");
    pickStatus.objectName = pre + "StopStatus";
    v.addWidget(pickStatus, 0, 0);

    // People.
    v.addWidget(new QLabel("<b>" + CsPanel.escapeHtml(qsTr("People going")) + "</b>"), 0, 0);
    var peopleT = ExpeditionPlanner.calloutTable(pre + "People",
        [qsTr("Lock"), qsTr("Person"), qsTr("Skills"), qsTr("Squeeze (in)"),
            qsTr("Currently")], 150, 260);
    peopleT.toolTip = qsTr("Tick Lock to keep someone on their team. Unticked " +
        "people are shared out.");
    setupTable(peopleT);
    filling = true;
    try {
        peopleT.setRowCount(personRows.length);
        for (var pr = 0; pr < personRows.length; pr++) {
            var row = personRows[pr];
            ExpeditionPlanner.cellCheck(peopleT, pr, 0, row.lock, onLock, pre + "PersonLock_" + pr);
            peopleT.setItem(pr, 1, ExpeditionPlanner.readOnlyItem(row.name));
            peopleT.setItem(pr, 2, ExpeditionPlanner.readOnlyItem(row.skills));
            peopleT.setItem(pr, 3, ExpeditionPlanner.readOnlyItem(row.squeeze));
            peopleT.setItem(pr, 4, ExpeditionPlanner.readOnlyItem(row.currently, row.team < 0));
        }
    } finally {
        filling = false;
    }
    v.addWidget(peopleT, 0, 0);
    if (personRows.length === 0) {
        v.addWidget(new QLabel("<span style=\"color:#777\">" + CsPanel.escapeHtml(
            qsTr("Nobody is ticked Going: only stops will be shared out.")) +
            "</span>"), 0, 0);
    }

    var runRow = new QHBoxLayout();
    var freeAll = new QPushButton(qsTr("Free everything"));
    freeAll.objectName = pre + "FreeAll";
    freeAll.toolTip = qsTr("Untick every Lock, so everything is shared out.");
    var run = new QPushButton(qsTr("Suggest"));
    run.objectName = pre + "Run";
    run.toolTip = qsTr("Work out a split and show it below. Changes nothing.");
    runRow.addWidget(freeAll, 0, 0);
    runRow.addStretch(1);
    runRow.addWidget(run, 0, 0);
    v.addLayout(runRow, 0);

    var preview = new QPlainTextEdit();
    preview.objectName = pre + "Preview";
    preview.readOnly = true;
    try {
        preview.setMinimumHeight(180);
    } catch (ePrevH) {
    }
    v.addWidget(preview, 1, 0);

    var status = new QLabel("");
    status.objectName = pre + "Status";
    try {
        status.wordWrap = true;
    } catch (eWrap2) {
    }
    v.addWidget(status, 0, 0);

    var endRow = new QHBoxLayout();
    endRow.addStretch(1);
    var apply = new QPushButton(qsTr("Apply"));
    apply.objectName = pre + "Apply";
    apply.toolTip = qsTr("Write the suggestion into the teams. Undo suggestion " +
        "puts them back.");
    apply.enabled = false;
    var close = new QPushButton(qsTr("Close"));
    close.objectName = pre + "Close";
    endRow.addWidget(close, 0, 0);
    endRow.addWidget(apply, 0, 0);
    v.addLayout(endRow, 0);

    // Anything changed after Suggest makes the preview stale: Apply waits
    // for the next Suggest.
    stale = function() {
        proposal = null;
        try {
            apply.enabled = false;
        } catch (eStale) {
        }
    };
    var locksNow = function() {
        var out = { stops: {}, people: {} };
        for (var a = 0; a < stopRows.length; a++) {
            out.stops[stopRows[a].station] = csEpTicked(stopsT, a, stopRows[a].lock);
        }
        for (var b = 0; b < personRows.length; b++) {
            out.people[personRows[b].key] = csEpTicked(peopleT, b, personRows[b].lock);
        }
        return out;
    };
    var onCount = function() {
        if (filling) { return; }
        stale();
    };
    try {
        count["valueChanged(int)"].connect(onCount);
    } catch (eVal) {
        try {
            count.valueChanged.connect(onCount);
        } catch (eVal2) {
        }
    }
    addStop.clicked.connect(function() {
        if (!ExpeditionPlanner.planGuard()) {
            dlg.reject();
            return;
        }
        var typed = ExpeditionPlanner.pickerText(picker).replace(/^\s+|\s+$/g, "");
        if (typed === "") {
            pickStatus.text = qsTr("Type or pick a station first.");
            return;
        }
        var name = ExpeditionPlanner.matchStation(csEpArr(ExpeditionPlanner.state.stations), typed);
        if (name === null) {
            pickStatus.text = qsTr("%1 is not a station in this drawing").arg(typed);
            return;
        }
        for (var q = 0; q < stopRows.length; q++) {
            if (stopRows[q].station === name) {
                pickStatus.text = qsTr("%1 is already listed.").arg(name);
                return;
            }
        }
        stopRows.push({ station: name, team: -1, currently: qsTr("free"), lock: false });
        extra.push(name);
        filling = true;
        try {
            var at = stopsT.rowCount;
            stopsT.setRowCount(at + 1);
            fillStopRow(at);
        } finally {
            filling = false;
        }
        pickStatus.text = "";
        ExpeditionPlanner.setPickerText(picker, "");
        stale();
    });
    freeAll.clicked.connect(function() {
        filling = true;
        try {
            var all = [[stopsT, stopRows.length], [peopleT, personRows.length]];
            for (var t = 0; t < all.length; t++) {
                for (var r = 0; r < all[t][1]; r++) {
                    ExpeditionPlanner.setBoxChecked(
                        ExpeditionPlanner.cellBox(all[t][0], r, 0), false);
                }
            }
        } finally {
            filling = false;
        }
        stale();
    });
    run.clicked.connect(function() {
        if (!ExpeditionPlanner.planGuard()) {
            dlg.reject();
            return;
        }
        var n = typeof count.value === "function" ? count.value() : count.value;
        var result = null;
        try {
            result = CsTeamSplit.suggest(ExpeditionPlanner.suggestInput(
                ExpeditionPlanner.state, locksNow(), Number(n), extra, list));
        } catch (eRun) {
            stale();
            status.text = "<span style=\"color:#c00\">" + CsPanel.escapeHtml(
                qsTr("Could not work out a split (%1) -- please report this.")
                    .arg(String(eRun))) + "</span>";
            return;
        }
        proposal = result;
        status.text = "";
        preview.setPlainText(ExpeditionPlanner.suggestPreviewText(result));
        // Hard lines in red where the bridge offers appendHtml; the plain
        // text above stays otherwise.
        try {
            if (typeof preview.appendHtml === "function") {
                preview.clear();
                preview.appendHtml(ExpeditionPlanner.suggestPreviewHtml(result));
            }
        } catch (eHtml) {
            preview.setPlainText(ExpeditionPlanner.suggestPreviewText(result));
        }
        try {
            apply.enabled = true;
        } catch (eApply) {
        }
    });
    apply.clicked.connect(function() {
        if (proposal === null) {
            return;
        }
        if (!ExpeditionPlanner.planGuard()) {
            dlg.reject();
            return;
        }
        var r = ExpeditionPlanner.applySuggestion(proposal);
        if (r.done !== true) {
            stale();
            status.text = "<span style=\"color:#c00\">" + CsPanel.escapeHtml(r.why) + "</span>";
            return;
        }
        dlg.accept();
    });
    close.clicked.connect(function() { dlg.reject(); });
    dlg.setLayout(v);
    try {
        dlg.resize(660, 900);
    } catch (eSize) {
    }
    return dlg;
};

/**
 * A closed popup, out of use for good: hidden and every named widget in
 * it renamed ExpeditionPlannerSuggestClosed<k>..., never deleted (the
 * editable QComboBox segfaults when destroyed; see teardownTeamSections).
 */
ExpeditionPlanner.retireSuggestDialog = function(dlg) {
    var s = ExpeditionPlanner.state;
    try {
        dlg.close();
    } catch (eClose) {
    }
    try {
        dlg.visible = false;
    } catch (eHide) {
    }
    s.suggestClosed = (typeof s.suggestClosed === "number" ? s.suggestClosed : 0) + 1;
    csEpRenameTree(dlg, "ExpeditionPlannerSuggest",
        "ExpeditionPlannerSuggestClosed" + s.suggestClosed, 0);
};

/** Suggest split...: the popup, modal, built now (the dock exists). */
ExpeditionPlanner.suggestClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return null;
    }
    ExpeditionPlanner.flushPacking();
    var s = ExpeditionPlanner.state;
    if (s.drawn === null || s.drawn === undefined) {
        CsTell.warn(qsTr("Expedition Planner: this drawing holds no survey " +
            "to split the stops on."));
        return null;
    }
    var party = ExpeditionPlanner.readParty();
    var dlg = null;
    try {
        dlg = ExpeditionPlanner.buildSuggestDialog(party);
    } catch (eBuild) {
        CsTell.warn("Expedition Planner: the Suggest split popup could not be " +
            "built (" + eBuild + ") -- please report this.");
        return null;
    }
    try {
        dlg.exec();
    } catch (eExec) {
    }
    ExpeditionPlanner.retireSuggestDialog(dlg);
    return dlg;
};

// ---------------------------------------------------------------------
// Who fits where (the squeeze view)
// ---------------------------------------------------------------------
//
// Core/CsSqueeze.js does the work: a stop's tightest measured passage on
// the round trip from the survey's first station, against each person's
// squeeze limit from the directory. A recorded width of 0 is UNMEASURED,
// never a squeeze; an unknown limit or width is "?", never a block.
//
// The logic is in plain functions (fitRows, the text helpers,
// teamSqueeze, addFitStop) so it is tested without widgets. The matrix
// is filled by fillFit, which finds its table by objectName at the time
// and does nothing while the section is folded: a folded section never
// asks the engine anything. fitMaybeRefresh (from refreshTeamHeaders,
// which runs after every team, party or drawing change) refills it only
// when what it shows has changed.
//
// Every team also gets a squeeze line under its members and a red mark
// in its header (refreshTeamHeaders), from teamSqueeze: CsSqueeze.forTeam
// over the team's stops, cached per stop set until the drawing is read
// again, then teamIssues and teamNotes against the members now.

/** The survey, resolved network, unit and pace the squeeze engine needs; never child(). */
var csEpSqueezeOpts = function(s) {
    var drawn = (s.drawn !== null && s.drawn !== undefined) ? s.drawn : null;
    var survey = drawn === null ? null : drawn.survey;
    var unit = "ft";
    try {
        if (survey !== null && survey !== undefined) { unit = ExpeditionPlanner.unitOf(survey); }
    } catch (eUnit) {
        unit = "ft";
    }
    // The stored pace, as suggestInput reads it. Widths do not depend on
    // it; it is passed so every route is planned the same way.
    var stored = (s.store !== null && s.store !== undefined && s.store.settings) ?
        s.store.settings.pace : null;
    var config = ExpeditionPlanner.paceBlock(stored, null);
    if (stored !== null && typeof stored === "object" && stored.paceFtPerMin !== undefined) {
        config.paceFtPerMin = stored.paceFtPerMin;
    }
    return { survey: survey === undefined ? null : survey,
        resolved: drawn === null ? null : drawn.resolved, unit: unit, config: config };
};

/** Every stop on any team (team order, trimmed, deduped), then the extra ones. */
var csEpFitStops = function(s, extraStops) {
    var out = [];
    var seen = {};
    var push = function(v) {
        var st = csEpTrim(v);
        if (st === "" || seen["#" + st] === true) { return; }
        seen["#" + st] = true;
        out.push(st);
    };
    var teams = csEpArr(s.teams);
    for (var i = 0; i < teams.length; i++) {
        var stops = csEpArr(csEpObj(teams[i]).stops);
        for (var k = 0; k < stops.length; k++) { push(stops[k]); }
    }
    var extra = csEpArr(extraStops);
    for (var x = 0; x < extra.length; x++) { push(extra[x]); }
    return out;
};

/** A matrix cell as the table shows it: fits, NO, ? or - (unreachable). */
ExpeditionPlanner.fitCellText = function(cell) {
    if (cell === "fits") { return qsTr("fits"); }
    if (cell === "no") { return qsTr("NO"); }
    if (cell === "unreachable") { return "-"; }
    return "?";
};

/** A person's column header: "Ana Ruiz (14 in)" or "Ana Ruiz (no limit)". */
ExpeditionPlanner.fitHeaderText = function(person) {
    var p = csEpObj(person);
    var limit = (typeof p.limit === "number" && isFinite(p.limit) && p.limit > 0) ?
        CsSqueeze.inches(p.limit) + " in" : qsTr("no limit");
    return csEpTrim(p.name) + " (" + limit + ")";
};

/** A stop's Tightest passage: "10 in near A6", "not measured" or "not on the surveyed line". */
ExpeditionPlanner.fitTightestText = function(stop) {
    var o = csEpObj(stop);
    if (o.reachable !== true) {
        return qsTr("not on the surveyed line");
    }
    if (typeof o.inches !== "number" || !isFinite(o.inches) || o.inches <= 0) {
        return qsTr("not measured");
    }
    var near = csEpTrim(o.near);
    return CsSqueeze.inches(o.inches) + " in" + (near === "" ? "" : " near " + near);
};

/**
 * The matrix, ready to fill a table: every stop on any team (team order,
 * deduped) plus `extraStops`, by the Going people `party`, limits from
 * the directory. Never throws.
 * \return {matrix (CsSqueeze.matrix's answer), headers: [Stop, Tightest
 *   passage, one per person], rows: [{stop, tightestText, cells: [text],
 *   cellKinds: ["fits"|"no"|"unknown"|"unreachable"]}]}
 */
ExpeditionPlanner.fitRows = function(state, party, extraStops) {
    var out = { matrix: { stops: [], people: [], cells: [] },
        headers: [qsTr("Stop"), qsTr("Tightest passage")], rows: [] };
    try {
        var s = csEpObj(state);
        var o = csEpSqueezeOpts(s);
        var m = CsSqueeze.matrix(o.survey, o.resolved, csEpFitStops(s, extraStops),
            csEpArr(party), csEpArr(s.people), { unit: o.unit, config: o.config });
        out.matrix = m;
        var p;
        for (p = 0; p < m.people.length; p++) {
            out.headers.push(ExpeditionPlanner.fitHeaderText(m.people[p]));
        }
        for (var i = 0; i < m.stops.length; i++) {
            var kinds = csEpArr(m.cells[i]).slice(0);
            var texts = [];
            for (p = 0; p < kinds.length; p++) { texts.push(ExpeditionPlanner.fitCellText(kinds[p])); }
            out.rows.push({ stop: m.stops[i].station,
                tightestText: ExpeditionPlanner.fitTightestText(m.stops[i]),
                cells: texts, cellKinds: kinds });
        }
    } catch (e) {
        out.rows = [];
    }
    return out;
};

/**
 * A team's squeeze from the panel state: {issues: CsSqueeze.teamIssues
 * (the members who may not fit its whole route), note: CsSqueeze.teamNotes
 * ("" or the unknown-width note)}. A team without stops, or no survey,
 * has nothing to say. The route is cached per stop set until the drawing
 * is read again; the members are checked fresh every time. Never throws.
 */
ExpeditionPlanner.teamSqueeze = function(team) {
    try {
        var s = ExpeditionPlanner.state;
        var t = csEpObj(team);
        var stops = [];
        var seen = {};
        var list = csEpArr(t.stops);
        for (var i = 0; i < list.length; i++) {
            var st = csEpTrim(list[i]);
            if (st === "" || seen["#" + st] === true) { continue; }
            seen["#" + st] = true;
            stops.push(st);
        }
        if (stops.length === 0 || s.drawn === null || s.drawn === undefined) {
            return { issues: [], note: "" };
        }
        var o = csEpSqueezeOpts(s);
        if (s.squeezeCache === null || s.squeezeCache === undefined ||
                s.squeezeCache.drawn !== s.drawn) {
            s.squeezeCache = { drawn: s.drawn, routes: {} };
        }
        var key = "#" + o.unit + "|" + JSON.stringify(stops);
        var route = s.squeezeCache.routes[key];
        if (route === undefined) {
            route = CsSqueeze.forTeam(o.survey, o.resolved, stops, { unit: o.unit, config: o.config });
            s.squeezeCache.routes[key] = route;
        }
        return { issues: CsSqueeze.teamIssues(t, route, csEpArr(s.people)),
            note: CsSqueeze.teamNotes({ stops: stops }, route) };
    } catch (e) {
        return { issues: [], note: "" };
    }
};

/** A team's squeeze line (rich text): red issues, then the grey note; "" when nothing. */
ExpeditionPlanner.teamSqueezeHtml = function(sq) {
    var o = csEpObj(sq);
    var parts = [];
    var issues = csEpArr(o.issues);
    for (var i = 0; i < issues.length; i++) {
        parts.push("<span style=\"color:#c00\">⚠ " +
            CsPanel.escapeHtml(csEpTrim(csEpObj(issues[i]).text)) + "</span>");
    }
    var note = csEpTrim(o.note);
    if (note !== "") {
        parts.push("<span style=\"color:#777\">" + CsPanel.escapeHtml(note) + "</span>");
    }
    return parts.join("<br>");
};

/** Show team `n`'s (1-based) squeeze line: hidden when there is nothing to say. */
ExpeditionPlanner.showTeamSqueeze = function(n, sq) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerTeam" + n + "_Squeeze");
    if (label === null) {
        return;
    }
    var html = ExpeditionPlanner.teamSqueezeHtml(sq);
    try {
        label.text = html;
        label.visible = html !== "";
    } catch (e) {
    }
};

/**
 * Add an extra stop to the matrix: a station of this drawing, matched as
 * the team pickers do, not already listed (on a team or added here).
 * \return {done, why}
 */
ExpeditionPlanner.addFitStop = function(typed) {
    var s = ExpeditionPlanner.state;
    var t = csEpTrim(typed);
    if (t === "") {
        return { done: false, why: qsTr("Type or pick a station first.") };
    }
    var name = ExpeditionPlanner.matchStation(csEpArr(s.stations), t);
    if (name === null) {
        return { done: false, why: qsTr("%1 is not a station in this drawing").arg(t) };
    }
    if (csEpFitStops(s, s.fitExtra).indexOf(name) >= 0) {
        return { done: false, why: qsTr("%1 is already listed.").arg(name) };
    }
    if (Object.prototype.toString.call(s.fitExtra) !== "[object Array]") { s.fitExtra = []; }
    s.fitExtra.push(name);
    return { done: true, why: "" };
};

/** What the matrix shows depends on: its stops, the party, and the directory's limits. */
var csEpFitSignature = function(s, party) {
    var people = [];
    var dir = csEpArr(s.people);
    for (var i = 0; i < dir.length; i++) {
        var p = csEpObj(dir[i]);
        people.push([p.id, p.name, p.squeeze]);
    }
    var going = [];
    var list = csEpArr(party);
    for (var g = 0; g < list.length; g++) {
        going.push([csEpObj(list[g]).id, csEpObj(list[g]).name]);
    }
    return JSON.stringify({ stops: csEpFitStops(s, s.fitExtra), party: going, people: people });
};

/** A matrix cell item: NO in red, ? and - grey, fits plain. */
var csEpFitItem = function(text, kind) {
    var it = ExpeditionPlanner.readOnlyItem(text, kind === "unknown" || kind === "unreachable");
    if (kind === "no") {
        try {
            it.setForeground(new QBrush(new QColor("#cc0000")));
        } catch (eRed) {
        }
    }
    return it;
};

/** Fill the matrix table in hand from fitRows' answer. */
ExpeditionPlanner.fillFitTable = function(table, fr) {
    try {
        table.setColumnCount(fr.headers.length);
    } catch (eCols) {
    }
    try {
        table.setHorizontalHeaderLabels(fr.headers);
    } catch (eHead) {
    }
    table.setRowCount(0);
    table.setRowCount(fr.rows.length);
    for (var r = 0; r < fr.rows.length; r++) {
        var row = fr.rows[r];
        table.setItem(r, 0, ExpeditionPlanner.readOnlyItem(row.stop));
        table.setItem(r, 1, ExpeditionPlanner.readOnlyItem(row.tightestText,
            row.tightestText === qsTr("not measured") ||
            row.tightestText === qsTr("not on the surveyed line")));
        for (var c = 0; c < row.cells.length; c++) {
            table.setItem(r, c + 2, csEpFitItem(row.cells[c], row.cellKinds[c]));
        }
    }
    // Size Stop and Tightest passage to their text so "45.6 in near B16"
    // is not cut to "45.6 in near ..." (the person columns stay narrow).
    try {
        table.resizeColumnToContents(0);
        table.resizeColumnToContents(1);
    } catch (eSize) {
    }
};

/**
 * Fill the matrix -- only while the section is open. `force` refills
 * even when nothing it shows has changed (opening it, Refresh).
 * \return true when the engine was asked
 */
ExpeditionPlanner.fillFit = function(force) {
    var s = ExpeditionPlanner.state;
    if (s.fitOpen !== true) {
        return false;
    }
    var table = ExpeditionPlanner.child("ExpeditionPlannerFitTable");
    if (table === null) {
        return false;
    }
    var party = ExpeditionPlanner.readParty();
    var sig = csEpFitSignature(s, party);
    if (force !== true && sig === s.fitSig && s.fitDrawn === s.drawn) {
        return false;
    }
    s.fitSig = sig;
    s.fitDrawn = s.drawn;
    var fr = ExpeditionPlanner.fitRows(s, party, s.fitExtra);
    try {
        ExpeditionPlanner.fillFitTable(table, fr);
    } catch (eFill) {
    }
    var why = "";
    if (s.drawn === null || s.drawn === undefined) {
        why = qsTr("This drawing holds no survey.");
    } else if (fr.rows.length === 0) {
        why = qsTr("No stops yet: add stops to a team, or add one here.");
    } else if (fr.matrix.people.length === 0) {
        why = qsTr("Nobody is ticked Going.");
    }
    var status = ExpeditionPlanner.child("ExpeditionPlannerFitStatus");
    if (status !== null) {
        status.text = why;
    }
    return true;
};

/** Refill the matrix if it is open and what it shows has changed. */
ExpeditionPlanner.fitMaybeRefresh = function() {
    return ExpeditionPlanner.fillFit(false);
};

/** Who fits where: Add stop. */
ExpeditionPlanner.fitAddClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    var picker = ExpeditionPlanner.child("ExpeditionPlannerFitPicker");
    var status = ExpeditionPlanner.child("ExpeditionPlannerFitStatus");
    var r = ExpeditionPlanner.addFitStop(picker === null ? "" : ExpeditionPlanner.pickerText(picker));
    if (r.done !== true) {
        if (status !== null) { status.text = r.why; }
        return;
    }
    if (status !== null) { status.text = ""; }
    if (picker !== null) { ExpeditionPlanner.setPickerText(picker, ""); }
    ExpeditionPlanner.fillFit(true);
};

/** Who fits where: Refresh. */
ExpeditionPlanner.fitRefreshClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.fillFit(true);
};

// ---------------------------------------------------------------------
// What's left to push (the lead ranking)
// ---------------------------------------------------------------------
//
// Core/CsPushRank.js does the work: every lead (a lead note or an open
// end) scored on six signals, each left out when it cannot be computed,
// with the reasons in plain words. The panel only chooses the weights and
// hint words, carries the Station Table marks in as statuses, and shows
// the answer.
//
// The logic is in plain functions (pushWeightsFor, parseHintWords,
// pushInput, pushRowText, addLeadToTeam) so it is tested without widgets.
// The table is filled by fillPush, which finds its widgets by objectName
// at the time and does nothing while the section is folded: a folded
// section never runs the engine. pushMaybeRefresh (from
// refreshTeamHeaders, which runs after every team, party or drawing
// change) refills it only when the engine's input has changed: teams and
// the party are not part of it, so only the dropdown follows them.
//
// The settings are session state (state.push*), never saved.

/** The presets in button order: engine key, label, objectName, tooltip. */
ExpeditionPlanner.PUSH_PRESETS = [
    { key: "quick", label: "Quick wins", name: "ExpeditionPlannerPushQuick",
        tip: "Favour leads that are cheap to reach and work." },
    { key: "potential", label: "Big potential", name: "ExpeditionPlannerPushPotential",
        tip: "Favour blank ground, likely connections and the cave's edges." },
    { key: "balanced", label: "Balanced", name: "ExpeditionPlannerPushBalanced",
        tip: "A bit of everything (the default)." }
];

/** Each signal's spin box label and tooltip. */
ExpeditionPlanner.PUSH_SIGNAL_LABELS = {
    cost: { label: "Cost", tip: "Time to walk in, work the lead and walk out; a pitch costs more." },
    blank: { label: "Blank ground", tip: "How far the lead's heading runs before it meets surveyed passage." },
    connect: { label: "Connection", tip: "The heading points at passage that is far away by the surveyed way." },
    elevation: { label: "Elevation edge", tip: "How near the top or the bottom of the surveyed cave." },
    recency: { label: "Time since visited", tip: "How long since the lead's trip." },
    hints: { label: "Note hints", tip: "Words in the lead's notes, from the fields below." }
};

/** A preset's weights as whole numbers 0-100 for the spin boxes. */
ExpeditionPlanner.pushWeightsFor = function(preset) {
    var w = CsPushRank.weightsFor(preset);
    var out = {};
    for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
        var k = CsPushRank.SIGNALS[i];
        out[k] = Math.max(0, Math.min(100, Math.round(w[k] * 100)));
    }
    return out;
};

/**
 * Hint words from a field: split on commas, semicolons and newlines,
 * trimmed, lower-cased, deduped, blanks dropped. [] means "use the
 * engine's defaults". An array is read as the list itself.
 */
ExpeditionPlanner.parseHintWords = function(text) {
    var src = Object.prototype.toString.call(text) === "[object Array]" ? text.join(",") :
        (text === undefined || text === null ? "" : String(text));
    var parts = src.split(/[,;\r\n]+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var w = parts[i].replace(/^\s+|\s+$/g, "").replace(/\s+/g, " ").toLowerCase();
        if (w !== "" && out.indexOf(w) < 0) { out.push(w); }
    }
    return out;
};

var csEpPushHasPreset = function(key) {
    return typeof key === "string" &&
        Object.prototype.hasOwnProperty.call(CsPushRank.PRESETS, key);
};

/** Fill in any push setting the state lacks (older state objects, tests). */
var csEpPushDefaults = function(s) {
    if (!csEpPushHasPreset(s.pushPreset)) { s.pushPreset = "balanced"; }
    if (s.pushWeights === null || typeof s.pushWeights !== "object") {
        s.pushWeights = ExpeditionPlanner.pushWeightsFor(s.pushPreset);
    }
    if (typeof s.pushPos !== "string") { s.pushPos = CsPushRank.POSITIVE.join(", "); }
    if (typeof s.pushNeg !== "string") { s.pushNeg = CsPushRank.NEGATIVE.join(", "); }
    s.pushCustom = s.pushCustom === true;
    s.pushDone = s.pushDone === true;
    return s;
};

/** The controls as pushInput reads them, from the session state. */
ExpeditionPlanner.pushControls = function(state) {
    var s = csEpPushDefaults(csEpObj(state));
    var w = {};
    for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
        w[CsPushRank.SIGNALS[i]] = s.pushWeights[CsPushRank.SIGNALS[i]];
    }
    return { preset: s.pushPreset, custom: s.pushCustom, weights: w,
        positive: s.pushPos, negative: s.pushNeg, includeDone: s.pushDone };
};

/**
 * The engine's input: the drawn survey, resolved network, unit and pace
 * (as Who fits where reads them), the Station Table rows with this
 * drawing's marks (stations.json) and those marks as {station: status},
 * today's LOCAL date, the preset -- or, when a weight was edited, every
 * weight as the spin boxes show it -- the hint words (none typed: the
 * engine's defaults) and includeDone. Never throws.
 * \param controls {preset, custom, weights, positive, negative, includeDone}
 */
ExpeditionPlanner.pushInput = function(state, controls) {
    var s = csEpObj(state);
    var c = csEpObj(controls);
    var input = { survey: null, resolved: null, unit: "ft", config: {}, statuses: {},
        today: "", preset: csEpPushHasPreset(c.preset) ? c.preset : "balanced",
        includeDone: c.includeDone === true };
    try {
        var o = csEpSqueezeOpts(s);
        input.survey = o.survey === undefined ? null : o.survey;
        input.resolved = o.resolved === undefined ? null : o.resolved;
        input.unit = o.unit;
        input.config = o.config;
    } catch (eOpts) {
    }
    try {
        input.today = String(ExpeditionPlanner.todayIso());
    } catch (eToday) {
        input.today = "";
    }
    if (c.custom === true) {
        var cw = csEpObj(c.weights);
        input.weights = {};
        for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
            var k = CsPushRank.SIGNALS[i];
            var n = Number(cw[k]);
            if (isFinite(n) && n >= 0) { input.weights[k] = n; }
        }
    }
    var pos = ExpeditionPlanner.parseHintWords(c.positive);
    var neg = ExpeditionPlanner.parseHintWords(c.negative);
    if (pos.length > 0) { input.positive = pos; }
    if (neg.length > 0) { input.negative = neg; }
    if (input.survey !== null) {
        try {
            var rows = CsStationTable.rows(input.survey, input.resolved, {});
            var store = csEpObj(s.store);
            if (Object.prototype.toString.call(store.entries) === "[object Array]") {
                CsStationStore.reconcile(rows, store);
            }
            for (var r = 0; r < rows.length; r++) {
                if (typeof rows[r].status === "string" && rows[r].status !== "") {
                    input.statuses[rows[r].station] = rows[r].status;
                }
            }
            input.rows = rows;
        } catch (eRows) {
            // The engine builds unmarked rows itself.
            input.statuses = {};
        }
    }
    return input;
};

/**
 * A table row's text: {rank ("" when none given), station, score (one
 * decimal), status, why (the reasons joined " · ")}. Never throws.
 */
ExpeditionPlanner.pushRowText = function(lead, rank) {
    var l = csEpObj(lead);
    var total = Number(l.total);
    var reasons = csEpArr(l.reasons);
    var why = [];
    for (var i = 0; i < reasons.length; i++) {
        var t = csEpTrim(reasons[i]);
        if (t !== "") { why.push(t); }
    }
    return { rank: (typeof rank === "number" && isFinite(rank)) ? String(rank) : "",
        station: csEpTrim(l.station),
        score: (isFinite(total) ? total : 0).toFixed(1),
        status: csEpTrim(l.status),
        why: why.length > 0 ? why.join(" · ") : qsTr("nothing to rank it by") };
};

/** Fill the push table in hand: a row per lead, ranked from 1. */
ExpeditionPlanner.fillPushTable = function(table, leads) {
    var list = csEpArr(leads);
    table.setRowCount(0);
    table.setRowCount(list.length);
    for (var r = 0; r < list.length; r++) {
        var t = ExpeditionPlanner.pushRowText(list[r], r + 1);
        var grey = t.status === "done" || t.status === "skip";
        table.setItem(r, 0, ExpeditionPlanner.readOnlyItem(t.rank, grey));
        table.setItem(r, 1, ExpeditionPlanner.readOnlyItem(t.station, grey));
        table.setItem(r, 2, ExpeditionPlanner.readOnlyItem(t.score, grey));
        table.setItem(r, 3, ExpeditionPlanner.readOnlyItem(t.status, grey));
        table.setItem(r, 4, ExpeditionPlanner.readOnlyItem(t.why, grey, t.why));
    }
    // Rank, Station, Score and Status fit their text; Why takes the rest
    // (the last section stretches) and wraps, so each row is as tall as
    // its reasons.
    try {
        for (var c = 0; c < 4; c++) { table.resizeColumnToContents(c); }
    } catch (eSize) {
    }
    try {
        table.resizeRowsToContents();
    } catch (eRows) {
    }
};

/**
 * Put `station` on team number `teamIndex` (0-based in state.teams)
 * through addTeamStop, by that team's id. \return {done, why}: why is a
 * plain sentence for the status line ("B20 added to Team 2", the data
 * layer's refusal, or that it is already there).
 */
ExpeditionPlanner.addLeadToTeam = function(station, teamIndex) {
    var teams = csEpArr(ExpeditionPlanner.state.teams);
    if (typeof teamIndex !== "number" || teamIndex < 0 || teamIndex >= teams.length ||
            Math.floor(teamIndex) !== teamIndex) {
        return { done: false, why: qsTr("Pick a team first.") };
    }
    var team = teams[teamIndex];
    var label = ExpeditionPlanner.teamLabel(team, teamIndex);
    var name = ExpeditionPlanner.matchStation(csEpArr(ExpeditionPlanner.state.stations),
        csEpTrim(station));
    var r = ExpeditionPlanner.addTeamStop(team.id, station);
    if (r.done === true) {
        var said = qsTr("%1 added to %2").arg(name === null ? csEpTrim(station) : name).arg(label);
        return { done: true, why: r.why === "" ? said : said + " (" + r.why + ")" };
    }
    if (r.why === "" && name !== null) {
        return { done: false, why: qsTr("%1 is already a stop on %2.").arg(name).arg(label) };
    }
    return { done: false, why: r.why };
};

/** Mark the active preset (bold), name it (or Custom), show the weights; fill-guarded. */
var csEpPushPaint = function(s, find) {
    var presets = ExpeditionPlanner.PUSH_PRESETS;
    var shown = qsTr("Custom");
    for (var p = 0; p < presets.length; p++) {
        var on = s.pushCustom !== true && presets[p].key === s.pushPreset;
        if (on) { shown = qsTr(presets[p].label); }
        var b = find(presets[p].name);
        if (b !== null) {
            try {
                b.styleSheet = on ? "font-weight: bold;" : "";
            } catch (eMark) {
            }
        }
    }
    var label = find("ExpeditionPlannerPushPreset");
    if (label !== null) { label.text = qsTr("Preset: %1").arg(shown); }
    var was = s.pushFilling;
    s.pushFilling = true;
    try {
        for (var i = 0; i < CsPushRank.SIGNALS.length; i++) {
            var k = CsPushRank.SIGNALS[i];
            var spin = find("ExpeditionPlannerPushW_" + k);
            if (spin === null) { continue; }
            try {
                spin.setValue(s.pushWeights[k]);
            } catch (eVal) {
            }
        }
    } finally {
        s.pushFilling = was;
    }
};

/** A preset button's click. */
var csEpPushPresetClick = function(button, key) {
    button.clicked.connect(function() { ExpeditionPlanner.pushPresetClicked(key); });
};

/** A weight spin box's valueChanged: a change by hand makes the preset Custom. */
var csEpPushSpinChanged = function(spin, key) {
    if (spin === undefined || spin === null) { return; }
    var onValue = function(value) {
        var s = ExpeditionPlanner.state;
        if (s.pushFilling === true) { return; }
        csEpPushDefaults(s);
        var n = typeof value === "number" ? value : Number(spin.value);
        if (!isFinite(n)) { return; }
        s.pushWeights[key] = Math.max(0, Math.min(100, Math.round(n)));
        s.pushCustom = true;
        csEpPushPaint(s, ExpeditionPlanner.child);
        ExpeditionPlanner.fillPush(true);
    };
    try {
        spin["valueChanged(int)"].connect(onValue);
    } catch (eVal) {
        try {
            spin.valueChanged.connect(onValue);
        } catch (eVal2) {
        }
    }
};

/** A preset chosen: its weights back in the spin boxes, Custom dropped, refilled. */
ExpeditionPlanner.pushPresetClicked = function(key) {
    var s = csEpPushDefaults(ExpeditionPlanner.state);
    s.pushPreset = csEpPushHasPreset(key) ? key : "balanced";
    s.pushCustom = false;
    s.pushWeights = ExpeditionPlanner.pushWeightsFor(s.pushPreset);
    csEpPushPaint(s, ExpeditionPlanner.child);
    ExpeditionPlanner.fillPush(true);
};

/** A hint field left (editingFinished): refilled only when its text changed. */
ExpeditionPlanner.pushHintsEdited = function(field, text) {
    var s = csEpPushDefaults(ExpeditionPlanner.state);
    var t = String(text === undefined || text === null ? "" : text);
    if (s[field] === t) { return; }
    s[field] = t;
    ExpeditionPlanner.fillPush(true);
};

/** Show done and skipped ticked or unticked. */
ExpeditionPlanner.pushDoneToggled = function(on) {
    var s = csEpPushDefaults(ExpeditionPlanner.state);
    s.pushDone = on === true;
    ExpeditionPlanner.fillPush(true);
};

/** What the table shows depends on: the engine's input bar the survey objects, and the marks. */
var csEpPushSignature = function(s, input) {
    var copy = {};
    for (var k in input) {
        if (Object.prototype.hasOwnProperty.call(input, k) && k !== "survey" &&
                k !== "resolved" && k !== "rows") {
            copy[k] = input[k];
        }
    }
    // Station Table team notes count as hints, so every mark field counts.
    copy.entries = csEpArr(csEpObj(s.store).entries);
    return JSON.stringify(copy);
};

/** The combo's current index, or -1. currentIndex is a property on this bridge. */
var csEpComboIndex = function(combo) {
    var n = -1;
    try {
        n = Number(combo.currentIndex);
    } catch (e) {
        n = -1;
    }
    return (isFinite(n) && n >= 0) ? n : -1;
};

var csEpSetComboIndex = function(combo, i) {
    try {
        combo.setCurrentIndex(i);
        return;
    } catch (e) {
    }
    try {
        combo.currentIndex = i;
    } catch (e2) {
    }
};

/**
 * Refill the team dropdown when the teams' names or ids have changed,
 * keeping the chosen team (by id) where it still exists. Runs whether
 * the section is open or not: it costs nothing.
 */
ExpeditionPlanner.pushTeamsRefresh = function() {
    var s = ExpeditionPlanner.state;
    var combo = ExpeditionPlanner.child("ExpeditionPlannerPushTeam");
    if (combo === null) {
        return;
    }
    var teams = csEpArr(s.teams);
    var names = [];
    var ids = [];
    for (var i = 0; i < teams.length; i++) {
        names.push(ExpeditionPlanner.teamLabel(teams[i], i));
        ids.push(String(csEpObj(teams[i]).id));
    }
    var key = JSON.stringify([names, ids]);
    if (key === s.pushTeamKey) {
        return;
    }
    var old = csEpArr(s.pushTeamIds);
    var at = csEpComboIndex(combo);
    var keepId = (at >= 0 && at < old.length) ? old[at] : "";
    s.pushTeamKey = key;
    s.pushTeamIds = ids;
    try {
        combo.clear();
        for (var n = 0; n < names.length; n++) { combo.addItem(names[n]); }
    } catch (eFill) {
    }
    var pick = ids.indexOf(keepId);
    if (pick < 0) { pick = ids.indexOf(String(s.activeTeamId)); }
    if (pick < 0) { pick = 0; }
    if (ids.length > 0) { csEpSetComboIndex(combo, pick); }
};

/** The status line under the table. */
ExpeditionPlanner.pushSay = function(text) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerPushStatus");
    if (label !== null) { label.text = String(text === undefined || text === null ? "" : text); }
};

/** The grey notes line: why the table is empty, then the engine's notes; hidden when blank. */
var csEpPushNotes = function(text) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerPushNotes");
    if (label === null) {
        return;
    }
    try {
        label.text = text === "" ? "" : "<span style=\"color:#777\">" +
            CsPanel.escapeHtml(text) + "</span>";
        label.visible = text !== "";
    } catch (e) {
    }
};

/**
 * Rank the leads into the table -- only while the section is open.
 * `force` refills even when the engine's input has not changed (opening
 * it, Refresh, a control changed). No survey: an empty table and a note,
 * without asking the engine.
 * \return true when the table was refilled
 */
ExpeditionPlanner.fillPush = function(force) {
    var s = ExpeditionPlanner.state;
    if (s.pushOpen !== true) {
        return false;
    }
    var table = ExpeditionPlanner.child("ExpeditionPlannerPushTable");
    if (table === null) {
        return false;
    }
    csEpPushDefaults(s);
    var input = ExpeditionPlanner.pushInput(s, ExpeditionPlanner.pushControls(s));
    var sig = csEpPushSignature(s, input);
    if (force !== true && sig === s.pushSig && s.pushDrawn === s.drawn) {
        return false;
    }
    s.pushSig = sig;
    s.pushDrawn = s.drawn;
    var res = { leads: [], notes: [] };
    if (input.survey !== null) {
        try {
            res = CsPushRank.rank(input);
        } catch (eRank) {
            res = { leads: [], notes: [] };
        }
    }
    var leads = csEpArr(res.leads);
    s.pushStations = [];
    for (var i = 0; i < leads.length; i++) { s.pushStations.push(csEpTrim(csEpObj(leads[i]).station)); }
    try {
        ExpeditionPlanner.fillPushTable(table, leads);
    } catch (eFill) {
    }
    var lines = [];
    if (input.survey === null) {
        lines.push(qsTr("This drawing holds no survey."));
    } else if (leads.length === 0) {
        lines.push(input.includeDone ? qsTr("No leads: no lead notes and no open ends.") :
            qsTr("No leads to push. Leads marked done or skip are hidden: tick Show done and skipped."));
    }
    var notes = csEpArr(res.notes);
    for (var n = 0; n < notes.length; n++) { lines.push(csEpTrim(notes[n])); }
    csEpPushNotes(lines.join("; "));
    return true;
};

/** Refill the ranking if it is open and its input has changed. */
ExpeditionPlanner.pushMaybeRefresh = function() {
    return ExpeditionPlanner.fillPush(false);
};

/** What's left to push: Refresh. */
ExpeditionPlanner.pushRefreshClicked = function() {
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.fillPush(true);
};

/** Add selected to team: the table's selected lead onto the dropdown's team. */
ExpeditionPlanner.pushAddClicked = function() {
    var s = ExpeditionPlanner.state;
    var table = ExpeditionPlanner.child("ExpeditionPlannerPushTable");
    var row = table === null ? -1 : ExpeditionPlanner.selectedRowOf(table);
    var stations = csEpArr(s.pushStations);
    if (row < 0 || row >= stations.length || s.pushOpen !== true) {
        ExpeditionPlanner.pushSay(qsTr("Select a lead in the table first."));
        return;
    }
    if (!ExpeditionPlanner.planGuard()) {
        return;
    }
    ExpeditionPlanner.pushTeamsRefresh();
    var combo = ExpeditionPlanner.child("ExpeditionPlannerPushTeam");
    var at = combo === null ? -1 : csEpComboIndex(combo);
    var ids = csEpArr(s.pushTeamIds);
    var teamAt = (at >= 0 && at < ids.length) ? ExpeditionPlanner.teamIndex(ids[at]) : -1;
    var r = ExpeditionPlanner.addLeadToTeam(stations[row], teamAt);
    ExpeditionPlanner.pushSay(r.why);
    if (r.done !== true) {
        return;
    }
    var team = s.teams[teamAt];
    // The team's own stop list, as its Add stop button refreshes it.
    var stops = ExpeditionPlanner.child("ExpeditionPlannerTeam" + (teamAt + 1) + "_Stops");
    if (stops !== null) {
        ExpeditionPlanner.fillStopsTable(stops, csEpTeamStops(team.id));
    }
    ExpeditionPlanner.teamChanged(team.id, "");
};

// ---------------------------------------------------------------------
// Build cards
// ---------------------------------------------------------------------

ExpeditionPlanner.calloutSay = function(text) {
    var label = ExpeditionPlanner.child("ExpeditionPlannerCalloutStatus");
    if (label !== null) { label.text = text; }
};

/** The trip's start date moved on by the team's dayOffset (a bad date passes through). */
ExpeditionPlanner.teamStartDate = function(startDate, team) {
    var base = CsCalloutCard.dateMinutes(String(startDate === undefined || startDate === null ?
        "" : startDate));
    if (base === null) {
        return startDate;
    }
    var off = (team !== null && typeof team === "object" && typeof team.dayOffset === "number") ?
        team.dayOffset : 0;
    return CsCalloutCard.stamp(base + off * 1440).date;
};

/** The files Build cards writes: one team -> the card; several -> topside + a file each. */
ExpeditionPlanner.buildFileList = function(teams) {
    var list = Object.prototype.toString.call(teams) === "[object Array]" ? teams : [];
    var out = ["callout-card.html"];
    if (list.length > 1) {
        for (var i = 0; i < list.length; i++) {
            out.push(CsTeams.fileName(i, list[i]));
        }
    }
    return out;
};

/**
 * The team-*.html files in `existing` that this build did not write,
 * sorted. They are only NAMED: nothing here ever deletes a file.
 */
ExpeditionPlanner.staleTeamFiles = function(existing, written) {
    var isArr = function(v) { return Object.prototype.toString.call(v) === "[object Array]"; };
    var have = {};
    var w = isArr(written) ? written : [];
    for (var i = 0; i < w.length; i++) { have["#" + String(w[i])] = true; }
    var out = [];
    var e = isArr(existing) ? existing : [];
    for (var j = 0; j < e.length; j++) {
        var name = String(e[j]);
        if (/^team-.+\.html$/i.test(name) && have["#" + name] !== true) { out.push(name); }
    }
    out.sort();
    return out;
};

/** The team-*.html names in `folder` (QDir), or [] when it cannot be read. */
ExpeditionPlanner.listTeamFiles = function(folder) {
    var out = [];
    try {
        var list = new QDir(folder).entryList(["team-*.html"], QDir.Files, QDir.Name);
        for (var i = 0; list !== null && list !== undefined && i < list.length; i++) {
            out.push(String(list[i]));
        }
    } catch (e) {
        out = [];
    }
    return out;
};

/** The drawing's geo anchor for the forecast, or null. */
ExpeditionPlanner.anchorOf = function() {
    try {
        var rec = CsLocationPick.anchorRecord(CsStationSidecar.document());
        if (rec !== null) { return { lat: rec.lat, lon: rec.lon }; }
    } catch (eAnchor) {
    }
    return null;
};

/** "Missing: start date; Alpha: at least one person, at least one stop". */
ExpeditionPlanner.missingText = function(items, teams) {
    var list = Object.prototype.toString.call(teams) === "[object Array]" ? teams : [];
    var labels = [];
    for (var t = 0; t < list.length; t++) {
        labels.push(ExpeditionPlanner.teamLabel(list[t], t) + ": ");
    }
    var groups = [];
    var current = null;
    for (var i = 0; i < items.length; i++) {
        var item = String(items[i]);
        var key = "";
        for (var l = 0; l < labels.length; l++) {
            if (item.indexOf(labels[l]) === 0 && labels[l].length > key.length) { key = labels[l]; }
        }
        var text = item.substring(key.length);
        if (current !== null && current.key === key) {
            current.items.push(text);
        } else {
            current = { key: key, items: [text] };
            groups.push(current);
        }
    }
    var parts = [];
    for (var g = 0; g < groups.length; g++) {
        parts.push(groups[g].key + groups[g].items.join(", "));
    }
    return qsTr("Missing: %1").arg(parts.join("; "));
};

/**
 * The status line after a build: files, warnings, files left in place,
 * problems, then the squeeze warnings (optional: ["Team 2: Ana Ruiz
 * (limit 12 in) may not fit ..."]).
 */
ExpeditionPlanner.buildStatusText = function(written, conflicts, leftovers, problems, squeeze) {
    var text = qsTr("Saved %1").arg(written.join(", "));
    if (problems.length > 0) {
        text += " (" + problems.join("; ") + ")";
    }
    if (conflicts.length > 0) {
        var c = [];
        for (var i = 0; i < conflicts.length; i++) {
            c.push(ExpeditionPlanner.conflictText(conflicts[i]));
        }
        text += ". " + qsTr("Build succeeded with warnings: %1").arg(c.join("; "));
    }
    if (leftovers.length > 0) {
        text += ". " + qsTr("Left in place from an earlier build: %1").arg(leftovers.join(", "));
    }
    var sq = Object.prototype.toString.call(squeeze) === "[object Array]" ? squeeze : [];
    if (sq.length > 0) {
        text += ". " + qsTr("Squeeze: %1").arg(sq.join("; "));
    }
    return text;
};

/**
 * Plan every team, check that nothing is missing, save the trip, teams,
 * pace and contacts, then write the files into `folder`: with ONE team
 * today's single callout-card.html (CsCalloutCard.html, from that team's
 * members, days and stops); with several the topside sheet as
 * callout-card.html plus CsTeams.fileName per team. Deletes nothing.
 *
 * \param form readCalloutForm()'s {trip, contacts, roster, includeRoster, pace}
 * Every renderer gets its team's squeeze (teamSqueeze: {issues, note}),
 * and res.squeeze lists the issues as "Team: sentence" for the status
 * line. A squeeze never stops a build.
 *
 * \return {written: [names], missing, problems, conflicts, leftovers,
 *   squeeze, error, planned: [{team, plan}], paceUsed}
 */
ExpeditionPlanner.buildFiles = function(form, folder) {
    var s = ExpeditionPlanner.state;
    var teams = s.teams;
    var res = { written: [], missing: [], problems: [], conflicts: [], leftovers: [],
        squeeze: [], error: "", planned: [], paceUsed: 0 };
    var pace = (form.pace === undefined) ? null : form.pace;
    if (pace !== null && isNaN(pace)) {
        res.error = qsTr("The walking pace must be a number of feet per minute " +
            "above 0, or blank for the default 264; nothing was built.");
        return res;
    }
    var config = ExpeditionPlanner.paceBlock(
        s.store === null ? {} : s.store.settings.pace, pace);
    res.paceUsed = CsTripPlan.config(config).paceFtPerMin;
    res.planned = ExpeditionPlanner.planTeams(teams, s.drawn, config,
        s.drawn === null ? "ft" : ExpeditionPlanner.unitOf(s.drawn.survey));
    var plans = [];
    for (var p = 0; p < res.planned.length; p++) { plans.push(res.planned[p].plan); }
    var trip = { startDate: form.trip.startDate, weatherPlace: form.trip.weatherPlace,
        party: form.trip.party, teams: teams };
    // EVERY gap at once, and nothing built until there are none.
    res.missing = CsTeams.missingAll(trip, plans, form.contacts, form.roster,
        form.includeRoster);
    if (s.drawn === null) {
        res.missing.push(qsTr("a survey in this drawing to route on"));
    }
    if (res.missing.length > 0) {
        return res;
    }
    var why = ExpeditionPlanner.saveTrip(form.trip);
    if (why !== "") { res.problems.push(why); }
    why = ExpeditionPlanner.saveTeams();
    if (why !== "") { res.problems.push(why); }
    why = ExpeditionPlanner.savePlanSettings(pace);
    if (why !== "") { res.problems.push(why); }
    if (!CsCalloutLocal.saveContacts(form.contacts)) { res.problems.push(qsTr("contacts not saved")); }

    // One forecast lookup for every team's dates (it reads first to last).
    var dates = [];
    var seen = {};
    for (var t = 0; t < teams.length; t++) {
        var td = CsTeams.dates(trip, teams[t]);
        for (var d = 0; d < td.length; d++) {
            if (seen[td[d]] !== true) { seen[td[d]] = true; dates.push(td[d]); }
        }
    }
    dates.sort();
    var wx = CsWeather.lookup(dates, ExpeditionPlanner.anchorOf(), form.trip.weatherPlace);
    if (wx.days === null) {
        res.problems.push(qsTr("no forecast (%1)").arg(wx.error));
    }
    var forecast = wx.days === null ? null : { days: wx.days };
    var title = CsCave.nameOf(s.docPath) || qsTr("Cave");
    var generated = ExpeditionPlanner.today();
    var names = ExpeditionPlanner.buildFileList(teams);
    // Each team's squeeze: printed on its sheets and named in the status line.
    var squeeze = [];
    for (var q = 0; q < teams.length; q++) {
        squeeze.push(ExpeditionPlanner.teamSqueeze(teams[q]));
        for (var qi = 0; qi < squeeze[q].issues.length; qi++) {
            res.squeeze.push(ExpeditionPlanner.teamLabel(teams[q], q) + ": " +
                squeeze[q].issues[qi].text);
        }
    }
    var pages = [];
    if (teams.length === 1) {
        // Today's card exactly, from the one team.
        var one = teams[0];
        var single = CsStationStore.cleanTrip({
            startDate: ExpeditionPlanner.teamStartDate(form.trip.startDate, one),
            weatherPlace: form.trip.weatherPlace, days: one.days, party: one.members });
        pages.push({ name: names[0], html: CsCalloutCard.html(res.planned[0].plan, {
            title: title, survey: s.drawn.survey, resolved: s.drawn.resolved,
            trip: single, contacts: form.contacts,
            roster: CsTeams.memberRows(one, s.people),
            includeRoster: form.includeRoster, forecast: forecast,
            generated: generated, squeeze: squeeze[0] }) });
    } else {
        var buffer = typeof form.contacts.bufferMin === "number" ? form.contacts.bufferMin : 120;
        var ctxTeams = [];
        for (var c = 0; c < teams.length; c++) {
            ctxTeams.push({ team: teams[c], plan: res.planned[c].plan,
                windows: CsTeams.windows(res.planned[c].plan, trip, teams[c], buffer),
                members: CsTeams.memberRows(teams[c], s.people),
                route: { survey: s.drawn.survey, resolved: s.drawn.resolved },
                squeeze: squeeze[c] });
        }
        pages.push({ name: names[0], html: CsCalloutCard.topsideHtml({ title: title,
            trip: trip, teams: ctxTeams, contacts: form.contacts,
            includeRoster: form.includeRoster, forecast: forecast,
            generated: generated, fileNames: names.slice(1) }) });
        for (var f = 0; f < teams.length; f++) {
            pages.push({ name: names[f + 1], html: CsCalloutCard.teamHtml({ title: title,
                trip: trip, team: teams[f], plan: res.planned[f].plan,
                windows: ctxTeams[f].windows, members: ctxTeams[f].members,
                contacts: form.contacts, forecast: forecast, generated: generated,
                survey: s.drawn.survey, resolved: s.drawn.resolved,
                squeeze: squeeze[f] }) });
        }
    }
    for (var w = 0; w < pages.length; w++) {
        if (CsStationSidecar.writeText(folder + "/" + pages[w].name, pages[w].html)) {
            res.written.push(pages[w].name);
        } else {
            res.problems.push(qsTr("could not write %1").arg(pages[w].name));
        }
    }
    res.conflicts = CsTeams.sameDayConflicts(trip);
    res.leftovers = ExpeditionPlanner.staleTeamFiles(
        ExpeditionPlanner.listTeamFiles(folder), res.written);
    return res;
};

/**
 * Open the sheets just built in the default browser for review and
 * printing: the topside sheet (or the single card) first, then each
 * team file. QUrl.fromLocalFile so a folder with spaces still opens.
 * \return the names that would not open ([] when all did)
 */
ExpeditionPlanner.openInBrowser = function(folder, names) {
    var failed = [];
    for (var i = 0; i < names.length; i++) {
        var ok = false;
        try {
            ok = QDesktopServices.openUrl(QUrl.fromLocalFile(folder + "/" + names[i])) !== false;
        } catch (eOpen) {
            ok = false;
        }
        if (!ok) { failed.push(names[i]); }
    }
    return failed;
};

/**
 * Build cards: write the file(s) beside the drawing and say what
 * happened. \return the path of callout-card.html, or ""
 */
ExpeditionPlanner.buildCard = function() {
    var s = ExpeditionPlanner.state;
    if (!ExpeditionPlanner.planGuard()) { return ""; }
    if (s.docPath === "" || CsCave.folderOf(s.docPath) === null) {
        ExpeditionPlanner.calloutSay(qsTr("Save the drawing first."));
        return "";
    }
    ExpeditionPlanner.flushPacking();
    var folder = CsCave.folderOf(s.docPath);
    var res = ExpeditionPlanner.buildFiles(ExpeditionPlanner.readCalloutForm(), folder);
    // The plans as text, a heading per team, whatever the outcome.
    var any = false;
    for (var p = 0; p < res.planned.length; p++) {
        if (res.planned[p].plan !== null) { any = true; }
    }
    if (any) {
        var out = ExpeditionPlanner.child("ExpeditionPlannerPlanOut");
        if (out !== null) {
            out.setPlainText(ExpeditionPlanner.plansText(res.planned, res.paceUsed));
        }
        s.plan = res.planned.length === 1 ? res.planned[0].plan : null;
    }
    // The start date may have moved, and with it the same-day overlaps.
    ExpeditionPlanner.refreshTeamHeaders();
    if (res.error !== "") {
        ExpeditionPlanner.calloutSay(res.error);
        return "";
    }
    if (res.missing.length > 0) {
        ExpeditionPlanner.calloutSay(ExpeditionPlanner.missingText(res.missing, s.teams));
        return "";
    }
    if (res.written.indexOf("callout-card.html") < 0) {
        ExpeditionPlanner.calloutSay(qsTr("Could not write callout-card.html beside " +
            "the drawing.") + (res.problems.length > 0 ? " (" + res.problems.join("; ") + ")" : ""));
        return "";
    }
    ExpeditionPlanner.calloutSay(ExpeditionPlanner.buildStatusText(res.written,
        res.conflicts, res.leftovers, res.problems, res.squeeze));
    var path = folder + "/callout-card.html";
    var failed = ExpeditionPlanner.openInBrowser(folder, res.written);
    if (failed.length > 0) {
        ExpeditionPlanner.calloutSay(ExpeditionPlanner.buildStatusText(res.written,
            res.conflicts, res.leftovers, res.problems, res.squeeze) + " " +
            qsTr("Could not open in the browser: %1. Open the file from the " +
                "drawing's folder.").arg(failed.join(", ")));
    }
    return path;
};

// ---------------------------------------------------------------------
// Reloading
// ---------------------------------------------------------------------

/** Re-read the drawing and the sidecar, then repaint. */
ExpeditionPlanner.reload = function() {
    var s = ExpeditionPlanner.state;
    var doc = CsStationSidecar.document();
    var before = s.docPath;
    s.docPath = CsStationSidecar.pathOf(doc);
    // Another drawing: its plan and pace belong to the old one (its
    // teams are loaded by showCalloutSettings).
    var changed = s.docPath !== before;
    if (changed) {
        ExpeditionPlanner.resetPlan();
    }
    var drawn = null;
    try {
        drawn = CsStationSidecar.readDrawing(doc);
    } catch (eRead) {
        drawn = null;
        CsTell.warn("Expedition Planner: could not read the survey (" +
            eRead + ").");
    }
    s.drawn = drawn;
    s.stations = [];
    if (drawn !== null) {
        try {
            s.stations = ExpeditionPlanner.stationNames(drawn.survey);
        } catch (eNames) {
            s.stations = [];
        }
    }
    var side = CsStationSidecar.readSidecar(
        CsStationSidecar.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
    ExpeditionPlanner.showPlanSettings(changed);
    if (changed) {
        ExpeditionPlanner.showCalloutSettings();
    }
    ExpeditionPlanner.fillPicker();
    if (!changed) {
        // The survey was read again (new widths, maybe): the squeeze lines,
        // the header marks and an open Who fits where follow it. A new
        // drawing got all that from showCalloutSettings' rebuild.
        ExpeditionPlanner.refreshTeamHeaders();
    }
    ExpeditionPlanner.updateSummary();
};

ExpeditionPlanner.open = function() {
    var dock = ExpeditionPlanner.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    ExpeditionPlanner.reload();
};

ExpeditionPlanner.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        ExpeditionPlanner.open();
    } catch (e) {
        csExpeditionPlannerDock = undefined;
        CsTell.warn("Expedition Planner: this CaveCAD build refused the " +
            "docked panel (" + e + ") -- please report this.");
    }
    this.terminate();
};

ExpeditionPlanner.init = function(basePath) {
    ExpeditionPlanner.basePath = basePath;

    var action = new RGuiAction(qsTr("Expedition Planner"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // A requiresDocument action runs in the ACTIVE TAB'S own script
    // engine, where dock globals start empty; forceGlobal makes every
    // tab share the one dock (qcad-plugin-conventions).
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/ExpeditionPlanner.js");
    action.setIcon(basePath + "/ExpeditionPlanner.svg");
    action.setStatusTip(qsTr("Plan a trip to stations in the cave, save " +
        "its route packet, and build the callout card for topside"));
    action.setDefaultCommands(["expeditionplanner", "epl"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(13);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = ExpeditionPlanner.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csExpeditionPlannerDock = undefined;
        warning("Expedition Planner: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
