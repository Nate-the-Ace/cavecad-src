// StationTable.js
//
// QCAD add-on tool: every station in the cave as one table you can
// filter, mark and navigate.
//
//   Cave Survey > Station Table   (or type "st")
//
// WHAT IT IS. A working table over the whole map: one row per station,
// badges for what kind of place it is (lead, open end, junction,
// control, loop, noted, flagged), and the team's own status and notes
// beside them, typed straight into the row. Leads are just one kind.
// Double-clicking a station goes there.
//
// NOTHING DERIVED IS STORED. Rows are computed from the survey on
// every refresh (Core/CsStationTable.js). What the team writes -- a
// status, a note, who has it -- lives in stations.json beside the
// drawing, so Google Drive carries it to the rest of the team
// (Core/CsStationStore.js).
//
// THE SIDECAR IS SHARED, SO A WRITE RE-READS IT FIRST. Somebody else's
// Drive may have delivered new marks since this panel last looked;
// saving from the copy read at open would silently throw theirs away.
// And a stations.json that will not parse is never overwritten: the
// panel says so and refuses to save until a person has looked at it.
//
// The file I/O is Core/CsStationSidecar.js, shared with Expedition
// Planner (which keeps the trip plan and callout card; they used to be
// tabs here).
//
// WIDGETS ARE FOUND BY objectName, never stashed on objects or as
// expandos (cavecad-tab-engine-panels). The action is forceGlobal, so
// this all runs in the application engine that init() built the dock in.
//
// See docs/superpowers/specs/2026-09-28-station-table-design.md.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

var csStationTableDock;

function StationTable(guiAction) {
    EAction.call(this, guiAction);
}

StationTable.prototype = new EAction();

StationTable.DOCK_NAME = "CaveSurveyStationTableDock";

/** Column indexes. */
StationTable.COL = { STATION: 0, KINDS: 1, TRIPS: 2, ELEV: 3, STATUS: 4,
    NOTE: 5, TEAM: 6, WHO: 7 };
StationTable.HEADERS = ["Station", "Kinds", "Trips", "Elev", "Status",
    "Note in survey", "Team notes", "Assigned"];

/** How far either side of a station a zoom frames, in feet. */
StationTable.ZOOM_FEET = 25.0;

/**
 * What the panel is currently showing. Module state -- plain JS, never
 * widget expandos. `drawnPos` is filled lazily on the first zoom after
 * a reload (one scan of the drawing), and dropped on every reload.
 */
/** Pixels for the Status column: wide enough for its dropdown. */
StationTable.STATUS_WIDTH = 120;

StationTable.state = { rows: [], shown: [], store: null, orphans: [],
    docPath: "", drawn: null, drawnPos: null, filling: false,
    loadError: "",
    // Jobs run once the signal that queued them has returned (later()).
    laterJobs: [], laterTimer: null };

// ---------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------

/**
 * The table page: filters, the table (edited in place) and the footer,
 * as one widget. Kept separate from buildDock so a later page can sit
 * beside it in the QTabWidget without this moving.
 */
StationTable.buildTablePage = function() {
    var page = new QWidget();
    var layout = new QVBoxLayout();
    layout.setContentsMargins(6, 6, 6, 6);
    layout.setSpacing(6);

    // Kind filters, any-of. None ticked means every station.
    var kindRow = new QHBoxLayout();
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var kind = CsStationTable.KINDS[k];
        var box = new QCheckBox(qsTr(CsStationTable.LABEL[kind]));
        box.objectName = "StationTableKind_" + kind;
        kindRow.addWidget(box, 0, 0);
        box.clicked.connect(function() { StationTable.fill(); });
    }
    kindRow.addStretch(1);
    layout.addLayout(kindRow, 0);

    // Search, status filter. Filtering is in memory over rows already
    // read, so per-keystroke refill is cheap -- nothing re-reads the
    // drawing or the sidecar here.
    var searchRow = new QHBoxLayout();
    var search = new QLineEdit();
    search.objectName = "StationTableSearch";
    try {
        search.placeholderText = qsTr("Search stations and notes");
    } catch (ePh) {
    }
    var statusFilter = new QComboBox();
    statusFilter.objectName = "StationTableStatusFilter";
    statusFilter.addItem(qsTr("Any status"));
    var statuses = CsStationStore.STATUSES;
    for (var s = 0; s < statuses.length; s++) {
        statusFilter.addItem(qsTr(statuses[s]));
    }
    searchRow.addWidget(search, 1, 0);
    searchRow.addWidget(statusFilter, 0, 0);
    layout.addLayout(searchRow, 0);
    search.textChanged.connect(function() { StationTable.fill(); });
    statusFilter.activated.connect(function() { StationTable.fill(); });

    // The table. Status, Team notes and Assigned are typed straight
    // into the row and saved as each cell is (commitCell /
    // commitStatus); every other cell is read-only, cell by cell, not by
    // switching editing off for the whole table (the CaveShelf idiom).
    var table = new QTableWidget(0, StationTable.HEADERS.length);
    table.objectName = "StationTableTable";
    table.setHorizontalHeaderLabels(StationTable.HEADERS);
    // Dim the headings of the columns that cannot be typed in, the way
    // Cave Shelf does (CsPanel.markHeadings). Status is edited through
    // its dropdown, so it counts as editable.
    CsPanel.markHeadings(table, StationTable.HEADERS,
        [false, false, false, false, true, false, true, true]);
    try {
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.selectionMode = QAbstractItemView.SingleSelection;
        table.editTriggers = StationTable.editTriggers();
    } catch (eSel) {
    }
    try {
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
    } catch (eHead) {
    }
    try {
        table.setMinimumHeight(200);
    } catch (eH) {
    }
    layout.addWidget(table, 1, 0);
    // FILLING IS NOT EDITING: setItem/setText fire itemChanged exactly
    // as typing does, so commitCell returns while state.filling is set.
    try {
        table["itemChanged(QTableWidgetItem*)"].connect(function(item) {
            StationTable.commitCell(item);
        });
    } catch (eChanged) {
        try {
            table.itemChanged.connect(function(item) {
                StationTable.commitCell(item);
            });
        } catch (eChanged2) {
        }
    }
    // A double-click on a read-only cell (the station, above all) goes
    // there; on an editable one it opens the editor instead.
    try {
        table["cellDoubleClicked(int, int)"].connect(function(row, column) {
            StationTable.onDoubleClick(row, column);
        });
    } catch (eDbl) {
        try {
            table.cellDoubleClicked.connect(function(row, column) {
                StationTable.onDoubleClick(row, column);
            });
        } catch (eDbl2) {
            table.itemDoubleClicked.connect(function() {
                StationTable.zoomToSelected();
            });
        }
    }

    // Footer. One line, deliberately: a wrapping label under a
    // stretching table is drawn clipped (qcad-js-bridge-traps).
    var footRow = new QHBoxLayout();
    var summary = new QLabel("");
    summary.objectName = "StationTableSummary";
    var refreshButton = new QPushButton(qsTr("Refresh"));
    refreshButton.objectName = "StationTableRefresh";
    refreshButton.toolTip = qsTr("Read the survey and stations.json again.");
    var exportButton = new QPushButton(qsTr("Export checklist"));
    exportButton.objectName = "StationTableExport";
    exportButton.toolTip = qsTr("Save the rows shown now as a CSV " +
        "checklist. It names no position, only elevation.");
    footRow.addWidget(summary, 1, 0);
    footRow.addWidget(refreshButton, 0, 0);
    footRow.addWidget(exportButton, 0, 0);
    layout.addLayout(footRow, 0);
    refreshButton.clicked.connect(function() { StationTable.reload(); });
    exportButton.clicked.connect(function() { StationTable.exportChecklist(); });

    page.setLayout(layout);
    return page;
};

StationTable.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Station Table"), appWin);
    // Without an objectName restoreState() cannot identify the dock and
    // silently forgets where it was.
    dock.objectName = StationTable.DOCK_NAME;
    var tabs = new QTabWidget();
    tabs.objectName = "StationTableTabs";
    tabs.addTab(StationTable.buildTablePage(), qsTr("Stations"));
    dock.setWidget(tabs);
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "StationTable", qsTr("Station Table"));
    return dock;
};

StationTable.ensureDock = function() {
    if (isNull(csStationTableDock)) {
        csStationTableDock = StationTable.buildDock(RMainWindowQt.getMainWindow());
    }
    return csStationTableDock;
};

/** A child widget by objectName, or null. Widgets are found, never stashed. */
StationTable.child = function(name) {
    try {
        var w = StationTable.ensureDock().findChild(name);
        return isNull(w) ? null : w;
    } catch (e) {
        return null;
    }
};

/**
 * The status a combo's index stands for. Index 0 is the "any" /
 * "(unmarked)" entry, then CsStationStore.STATUSES in order -- so the
 * combo carries no item data and nothing depends on itemData/findData.
 */
StationTable.statusAt = function(index) {
    var i = Number(index);
    if (isNaN(i) || i <= 0 || i > CsStationStore.STATUSES.length) {
        return "";
    }
    return CsStationStore.STATUSES[i - 1];
};

/** The combo index for a status; 0 for "" or an unknown mark. */
StationTable.indexOfStatus = function(status) {
    var i = CsStationStore.STATUSES.indexOf(String(status || ""));
    return i < 0 ? 0 : i + 1;
};

/** The kinds currently ticked. */
StationTable.ticked = function() {
    var out = [];
    for (var k = 0; k < CsStationTable.KINDS.length; k++) {
        var box = StationTable.child("StationTableKind_" + CsStationTable.KINDS[k]);
        if (box !== null && box.checked === true) {
            out.push(CsStationTable.KINDS[k]);
        }
    }
    return out;
};

/** The rows the current filters leave, in station order. */
StationTable.visibleRows = function() {
    var search = StationTable.child("StationTableSearch");
    var statusFilter = StationTable.child("StationTableStatusFilter");
    var q = {
        kinds: StationTable.ticked(),
        text: search === null ? "" : String(search.text),
        status: statusFilter === null ? "" :
            StationTable.statusAt(statusFilter.currentIndex)
    };
    return CsStationTable.sort(CsStationTable.filter(StationTable.state.rows, q));
};

/** One row's cells, in HEADERS order. */
StationTable.cellsOf = function(row) {
    var labels = [];
    for (var k = 0; k < row.kinds.length; k++) {
        labels.push(CsStationTable.LABEL[row.kinds[k]]);
    }
    var status = CsStationTable.effectiveStatus(row);
    var suggest = CsStationTable.suggest(row);
    if (suggest !== "" && (row.status === undefined || row.status === "")) {
        status += " (looks " + suggest + ")";
    }
    var noteCell = row.noteText || "";
    if (row.link === "relink") {
        noteCell = "[note changed] " + noteCell;
    }
    // A null z stays blank: never a 0 (the elevation datum trap).
    var elev = (row.z === null || row.z === undefined || isNaN(row.z)) ? "" :
        String(Math.round(row.z * 10) / 10);
    return [row.station, labels.join(", "), (row.trips || []).join(" "),
        elev, status, noteCell, row.team || "", row.who || ""];
};

/** The columns a caver types in. Everything else is read from the survey. */
StationTable.isEditableColumn = function(column) {
    var C = StationTable.COL;
    return column === C.STATUS || column === C.TEAM || column === C.WHO;
};

/**
 * Double-click, typing, or F2 opens an editable cell. Read by name with
 * the plain numbers as a fallback: some enum names are not bound on
 * this bridge (qcad-js-bridge-traps), and an undefined in the OR would
 * silently make the table edit nothing.
 */
StationTable.editTriggers = function() {
    var dbl = QAbstractItemView.DoubleClicked;
    var key = QAbstractItemView.EditKeyPressed;
    var any = QAbstractItemView.AnyKeyPressed;
    return (typeof dbl === "number" ? dbl : 2) |
        (typeof key === "number" ? key : 8) |
        (typeof any === "number" ? any : 16);
};

/**
 * One cell as a QTableWidgetItem, editable or not. The flags are set
 * per cell, so Station, Kinds, Trips, Elev and the survey's note can
 * never be typed over.
 */
StationTable.itemFor = function(text, editable, wash) {
    var item = new QTableWidgetItem(String(text));
    try {
        var flags = item.flags();
        item.setFlags(editable === true ? (flags | Qt.ItemIsEditable) :
            (flags & ~Qt.ItemIsEditable));
    } catch (eFlags) {
    }
    // The same grey wash every read-only cell wears elsewhere in
    // CaveCAD (CsPanel.markCell), so what cannot be typed in is visible
    // at a glance. The brush is read from the palette ONCE per refill by
    // fill(), not once per cell: this table rebuilds on every keystroke
    // of the search box.
    if (editable !== true && !isNull(wash) && wash !== null) {
        try {
            item.setBackground(wash);
        } catch (eBack) {
        }
    }
    return item;
};

/** What the status combo's tooltip says for a row. */
StationTable.statusTip = function(row) {
    var tip = qsTr("This row's mark, saved to stations.json as soon as " +
        "you pick it.");
    if (row.status === undefined || row.status === "") {
        var shown = "";
        var eff = CsStationTable.effectiveStatus(row);
        var suggest = CsStationTable.suggest(row);
        if (eff !== "") {
            shown = qsTr("Unmarked, reads as \"%1\".").arg(eff);
        }
        if (suggest !== "") {
            shown += (shown === "" ? "" : " ") +
                qsTr("Looks %1: a later trip surveyed on from here.")
                    .arg(suggest);
        }
        if (shown !== "") {
            tip = shown + "\n" + tip;
        }
    }
    return tip;
};

/**
 * The Status cell's widget: a dropdown for a normal row, a Re-link
 * button for a row whose survey note changed. Index 0 is "(unmarked)",
 * index i is CsStationStore.STATUSES[i - 1] (statusAt/indexOfStatus).
 * The closures carry only the station's NAME, a plain string -- never a
 * row object or a widget -- and find the row when they fire.
 */
StationTable.statusWidget = function(row) {
    var station = String(row.station);
    if (row.link === "relink") {
        var button = new QPushButton(qsTr("Re-link"));
        button.toolTip = qsTr("The note in the survey changed. Keep this " +
            "row's marks with the new note.");
        button.clicked.connect(function() {
            StationTable.relink(station);
        });
        return button;
    }
    var combo = new QComboBox();
    combo.addItem(qsTr("(unmarked)"));
    var statuses = CsStationStore.STATUSES;
    for (var i = 0; i < statuses.length; i++) {
        combo.addItem(qsTr(statuses[i]));
    }
    combo.setCurrentIndex(StationTable.indexOfStatus(row.status));
    combo.toolTip = StationTable.statusTip(row);
    // activated, not currentIndexChanged: it fires only for a caver's
    // pick, never for setCurrentIndex, so building the table saves
    // nothing (the LinetypeMaker idiom).
    combo.activated.connect(function(index) {
        StationTable.commitStatus(station, index);
    });
    return combo;
};

/**
 * Repaint the table from state.rows and the current filters, keeping
 * the selected station selected (and the current column current) when
 * it is still shown.
 */
StationTable.fill = function() {
    var table = StationTable.child("StationTableTable");
    if (table === null) {
        return;
    }
    var s = StationTable.state;
    var C = StationTable.COL;
    var keep = StationTable.selectedRow();
    var keepColumn = -1;
    try {
        keepColumn = table.currentColumn();
    } catch (eCol) {
        keepColumn = -1;
    }
    var shown = StationTable.visibleRows();
    s.shown = shown;
    var wash = CsPanel.readOnlyBrush(table);
    s.filling = true;
    var reselect = -1;
    try {
        // 0 first, so the old rows' dropdowns and buttons go with them
        table.setRowCount(0);
        table.setRowCount(shown.length);
        for (var r = 0; r < shown.length; r++) {
            var row = shown[r];
            var cells = StationTable.cellsOf(row);
            var open = row.link !== "relink";
            for (var c = 0; c < cells.length; c++) {
                // Status is edited through its widget, never as text.
                var editable = open && (c === C.TEAM || c === C.WHO);
                // The widget sits ON the item, and the item's own text
                // shows through it (a marked row read "opeopen"), so the
                // Status item carries no text at all.
                table.setItem(r, c, StationTable.itemFor(
                    c === C.STATUS ? "" : cells[c], editable,
                    c === C.STATUS ? null : wash));
            }
            table.setCellWidget(r, C.STATUS, StationTable.statusWidget(row));
            if (keep !== null && row.station === keep.station) {
                reselect = r;
            }
        }
        try {
            table.resizeColumnToContents(C.STATION);
            table.resizeColumnToContents(C.KINDS);
            // A cell widget is not measured by resizeColumnToContents;
            // "(unmarked)" was clipped to "(unmarke".
            table.setColumnWidth(C.STATUS, StationTable.STATUS_WIDTH);
        } catch (eSize) {
        }
        if (reselect >= 0) {
            var done = false;
            if (typeof keepColumn === "number" && keepColumn >= 0) {
                try {
                    table.setCurrentCell(reselect, keepColumn);
                    done = true;
                } catch (eCur) {
                    done = false;
                }
            }
            if (!done) {
                table.selectRow(reselect);
            }
        }
    } finally {
        s.filling = false;
    }
    StationTable.updateSummary(shown.length);
};

StationTable.updateSummary = function(shownCount) {
    var s = StationTable.state;
    var label = StationTable.child("StationTableSummary");
    if (label === null) {
        return;
    }
    var text;
    if (s.drawn === null) {
        text = qsTr("No survey in this drawing.");
    } else {
        text = qsTr("%1 of %2 stations").arg(shownCount).arg(s.rows.length);
    }
    if (s.orphans.length > 0) {
        // Listed, never deleted: a note may come back, or a station be
        // renamed back, and the team's marks with it.
        text += "  |  " + qsTr("%1 saved marks match no station")
            .arg(s.orphans.length);
    }
    if (s.loadError !== "") {
        text += "  |  " + s.loadError;
    }
    label.text = text;
    try {
        var names = [];
        for (var i = 0; i < s.orphans.length; i++) {
            names.push(s.orphans[i].station + ": " +
                (s.orphans[i].note || "") + " [" +
                (s.orphans[i].status || "") + "]");
        }
        label.toolTip = names.join("\n");
    } catch (eTip) {
    }
};

/**
 * The selected row's data, or null. Read through the selection model --
 * the idiom LinetypeMaker already ships -- with currentRow() (a METHOD
 * here) as the fallback.
 */
StationTable.selectedRow = function() {
    var table = StationTable.child("StationTableTable");
    var shown = StationTable.state.shown || [];
    if (table === null) {
        return null;
    }
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
    return (typeof idx === "number" && idx >= 0 && idx < shown.length) ?
        shown[idx] : null;
};

/**
 * True when the drawing on screen is still the one the table was read
 * from. The panel is one dock across every tab; switching tabs does not
 * reload it, so a save or a zoom must check before acting.
 */
StationTable.sameDrawing = function() {
    return CsStationSidecar.pathOf(CsStationSidecar.document()) ===
        StationTable.state.docPath;
};

/** The row for a station name, or null. */
StationTable.rowOf = function(station) {
    var rows = StationTable.state.rows || [];
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].station === station) {
            return rows[i];
        }
    }
    return null;
};

/**
 * Run fn after the current signal has returned. A refill deletes every
 * cell widget and item, so doing one inside the combo's, the button's or
 * the item's own signal would delete the thing still emitting it. The
 * job is plain JS and resolves everything when it fires.
 */
StationTable.later = function(fn) {
    var s = StationTable.state;
    s.laterJobs.push(fn);
    try {
        if (s.laterTimer === null) {
            s.laterTimer = new QTimer();
            s.laterTimer.singleShot = true;
            s.laterTimer.timeout.connect(function() {
                StationTable.runLater();
            });
        }
        s.laterTimer.start(0);
    } catch (eTimer) {
        StationTable.runLater();
    }
};

StationTable.runLater = function() {
    var jobs = StationTable.state.laterJobs;
    StationTable.state.laterJobs = [];
    for (var i = 0; i < jobs.length; i++) {
        try {
            jobs[i]();
        } catch (e) {
            EAction.handleUserMessage("Station Table: " + e);
        }
    }
};

/**
 * Write one row's fields into stations.json, the safe way: same drawing,
 * drawing saved, file re-read first (a teammate's marks may have arrived
 * through Drive), never over a file that will not parse. Only the fields
 * passed are changed; the rest come from the file as re-read.
 *
 * A relink row is refused unless `confirmRelink` -- the Re-link button
 * is the only way its entry moves to the new note.
 *
 * \return the entry as saved ({status, team, who}), or null when
 *   nothing was written (the caver has been told why)
 */
StationTable.commitRow = function(row, fields, confirmRelink) {
    var s = StationTable.state;
    if (row === null) {
        return null;
    }
    if (row.link === "relink" && confirmRelink !== true) {
        CsTell.warn(qsTr("Station Table: this row's note changed since its " +
            "marks were saved. Press Re-link to keep them with the new note."));
        return null;
    }
    if (!StationTable.sameDrawing()) {
        StationTable.later(function() { StationTable.reload(); });
        CsTell.warn(qsTr("Station Table: the drawing changed under the " +
            "table, so it has been read again and nothing was saved. " +
            "Make the change once more."));
        return null;
    }
    var path = CsStationSidecar.sidecarPath(s.docPath);
    if (path === "") {
        CsTell.warn(qsTr("Station Table: save the drawing first. The team " +
            "marks are stored beside it in stations.json."));
        return null;
    }
    var side = CsStationSidecar.readSidecar(path);
    if (side.error !== "") {
        s.loadError = side.error;
        StationTable.updateSummary((s.shown || []).length);
        CsTell.warn(qsTr("Station Table: stations.json beside the drawing " +
            "could not be read, so nothing was saved -- saving now would " +
            "replace everyone's marks. Look at the file first.") +
            "\n\n" + side.error);
        return null;
    }
    CsStationStore.setEntry(side.store, row, fields);
    if (!CsStationSidecar.writeSidecar(path, side.store)) {
        CsTell.warn(qsTr("Station Table: could not write stations.json " +
            "beside the drawing."));
        return null;
    }
    s.store = side.store;
    var key = CsStationStore.keyOf(row.station, row.keyText);
    var saved = { status: "", team: "", who: "" };
    var found = false;
    for (var i = 0; i < side.store.entries.length; i++) {
        var e = side.store.entries[i];
        if (CsStationStore.keyOf(e.station, e.note) === key) {
            saved = { status: e.status || "", team: e.team || "",
                who: e.who || "" };
            found = true;
        }
    }
    // The row now shows what the file holds for it, a teammate's other
    // fields included.
    row.status = saved.status;
    row.team = saved.team;
    row.who = saved.who;
    if (row.link !== "relink") {
        row.link = found ? "ok" : "";
    }
    return saved;
};

/** The shown table row index for a station, or -1. */
StationTable.shownIndex = function(station) {
    var shown = StationTable.state.shown || [];
    for (var i = 0; i < shown.length; i++) {
        if (shown[i].station === station) {
            return i;
        }
    }
    return -1;
};

/**
 * Put a row's Team notes and Assigned text back into its cells without
 * the change being taken for typing, and the status widget's pick.
 */
StationTable.showRowMarks = function(row) {
    var table = StationTable.child("StationTableTable");
    var r = StationTable.shownIndex(row.station);
    if (table === null || r < 0) {
        return;
    }
    var C = StationTable.COL;
    var s = StationTable.state;
    var was = s.filling;
    s.filling = true;
    try {
        var cells = StationTable.cellsOf(row);
        var cols = [C.STATUS, C.TEAM, C.WHO];
        for (var k = 0; k < cols.length; k++) {
            var item = table.item(r, cols[k]);
            if (!isNull(item) && String(item.text()) !== String(cells[cols[k]])) {
                item.setText(String(cells[cols[k]]));
            }
        }
        var combo = table.cellWidget(r, C.STATUS);
        if (!isNull(combo) && row.link !== "relink") {
            try {
                if (combo.currentIndex !== StationTable.indexOfStatus(row.status)) {
                    combo.setCurrentIndex(StationTable.indexOfStatus(row.status));
                }
                combo.toolTip = StationTable.statusTip(row);
            } catch (eCombo) {
            }
        }
    } finally {
        s.filling = was;
    }
};

/**
 * True when a status filter is picked, so a status just changed may
 * take its row out of the table. (A text edit is left shown even when
 * the search no longer matches it: the row stays under the caver's
 * hands until the filters next change.)
 */
StationTable.statusFilterActive = function() {
    var statusFilter = StationTable.child("StationTableStatusFilter");
    return statusFilter !== null && Number(statusFilter.currentIndex) > 0;
};

/**
 * A Team notes or Assigned cell was typed in: save it. The table is not
 * rebuilt -- the caver's place and focus stay where they are.
 */
StationTable.commitCell = function(item) {
    var s = StationTable.state;
    if (s.filling || isNull(item)) {
        return;
    }
    var r = -1, c = -1, typed = "";
    try {
        r = item.row();
        c = item.column();
        typed = String(item.text());
    } catch (eAt) {
        return;
    }
    var C = StationTable.COL;
    var field = c === C.TEAM ? "team" : (c === C.WHO ? "who" : "");
    var shown = s.shown || [];
    if (field === "" || r < 0 || r >= shown.length) {
        return;
    }
    var row = shown[r];
    if (String(row[field] || "") === typed) {
        return;
    }
    var fields = {};
    fields[field] = typed;
    StationTable.commitRow(row, fields, false);
    // Saved or not, the cell shows what the row holds: the value as
    // written, or the old one when the write was refused.
    StationTable.showRowMarks(row);
    StationTable.updateSummary(shown.length);
};

/** A status was picked in a row's dropdown: save it. */
StationTable.commitStatus = function(station, index) {
    var row = StationTable.rowOf(station);
    if (row === null) {
        return;
    }
    var status = StationTable.statusAt(index);
    if (String(row.status || "") !== status) {
        StationTable.commitRow(row, { status: status }, false);
    }
    StationTable.showRowMarks(row);
    // Only a status filter can drop the row; then refill, once the
    // combo's own signal has returned.
    if (StationTable.statusFilterActive()) {
        StationTable.later(function() { StationTable.fill(); });
    } else {
        StationTable.updateSummary((StationTable.state.shown || []).length);
    }
};

/**
 * The Re-link button: pressing it IS the confirmation. The row's marks
 * are written against the survey's new note, the old entry goes, and
 * the table is read again.
 */
StationTable.relink = function(station) {
    var row = StationTable.rowOf(station);
    if (row === null || row.link !== "relink") {
        return;
    }
    var saved = StationTable.commitRow(row, { status: row.status || "",
        team: row.team || "", who: row.who || "" }, true);
    if (saved !== null) {
        StationTable.later(function() { StationTable.reload(); });
    }
};

/**
 * Where each station is DRAWN, by name: the tagged station points
 * themselves, so the zoom lands where the caver sees the station even
 * after a warp or a re-anchor. Computed once per reload, on demand.
 */
StationTable.drawnPositions = function(doc) {
    var s = StationTable.state;
    if (s.drawnPos !== null) {
        return s.drawnPos;
    }
    var out = {};
    try {
        var found = CsTags.collectStations(doc);
        for (var i = 0; i < found.length; i++) {
            if (out[found[i].name] === undefined && !isNull(found[i].pos)) {
                out[found[i].name] = { x: found[i].pos.x, y: found[i].pos.y };
            }
        }
    } catch (e) {
        out = {};
    }
    s.drawnPos = out;
    return out;
};

/**
 * A double-click: on a read-only cell it goes to that row's station; an
 * editable cell's double-click is the caver opening its editor.
 */
StationTable.onDoubleClick = function(r, column) {
    if (StationTable.isEditableColumn(column)) {
        return;
    }
    var shown = StationTable.state.shown || [];
    if (typeof r === "number" && r >= 0 && r < shown.length) {
        StationTable.zoomTo(shown[r]);
    }
};

/** Frame the drawing on the selected station. */
StationTable.zoomToSelected = function() {
    StationTable.zoomTo(StationTable.selectedRow());
};

/** Frame the drawing on one row's station. */
StationTable.zoomTo = function(row) {
    if (row === null || row === undefined) {
        return;
    }
    if (!StationTable.sameDrawing()) {
        StationTable.reload();
        return;
    }
    var doc = CsStationSidecar.document();
    var di = null;
    try {
        di = EAction.getDocumentInterface();
    } catch (eDi) {
        di = null;
    }
    if (doc === null || isNull(di)) {
        return;
    }
    var at = StationTable.drawnPositions(doc)[row.station];
    if (at === undefined) {
        // Not drawn as a point: fall back to where the solve puts it.
        var d = StationTable.state.drawn;
        if (d !== null && !isNull(d.resolved) && !isNull(d.resolved.stations) &&
                !isNull(d.resolved.stations[row.station])) {
            at = d.resolved.stations[row.station];
        }
    }
    if (at === undefined || isNull(at)) {
        return;
    }
    try {
        // In DRAWING units: a metric cave's reach is metres (CheckMap).
        var reach = StationTable.ZOOM_FEET;
        try {
            reach = StationTable.ZOOM_FEET * CsShapeLine.perFoot(doc);
        } catch (eUnit) {
            reach = StationTable.ZOOM_FEET;
        }
        di.zoomTo(new RBox(new RVector(at.x - reach, at.y - reach),
            new RVector(at.x + reach, at.y + reach)));
    } catch (e) {
        EAction.handleUserMessage("Station Table: could not zoom (" + e + ").");
    }
};

/** Save the currently shown rows as a CSV checklist. */
StationTable.exportChecklist = function() {
    var s = StationTable.state;
    var folder = CsCave.folderOf(String(s.docPath));
    var start = (folder === null ? "" : folder + "/") + "checklist.csv";
    var path = CsFiles.saveFile(RMainWindowQt.getMainWindow(),
        qsTr("Export checklist"), start, "CSV (*.csv)");
    if (isNull(path) || String(path) === "") {
        return;
    }
    path = String(path);
    try {
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate |
                QIODevice.Text)) {
            CsTell.warn(qsTr("Station Table: could not write the checklist."));
            return;
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(CsStationTable.checklistCsv(StationTable.visibleRows()));
        stream.flush();
        file.close();
    } catch (e) {
        CsTell.warn(qsTr("Station Table: could not write the checklist.") +
            " (" + e + ")");
    }
};

/** Re-read the drawing and the sidecar, then repaint. */
StationTable.reload = function() {
    var s = StationTable.state;
    var doc = CsStationSidecar.document();
    s.docPath = CsStationSidecar.pathOf(doc);
    s.drawnPos = null;
    var drawn = null;
    try {
        drawn = CsStationSidecar.readDrawing(doc);
    } catch (eRead) {
        drawn = null;
        CsTell.warn("Station Table: could not read the survey (" + eRead + ").");
    }
    s.drawn = drawn;
    var side = CsStationSidecar.readSidecar(CsStationSidecar.sidecarPath(s.docPath));
    s.store = side.store;
    s.loadError = side.error;
    if (drawn === null) {
        s.rows = [];
        s.orphans = [];
        StationTable.fill();
        return;
    }
    var findings = [];
    try {
        findings = CsValidate.check(drawn.survey, drawn.resolved);
    } catch (eCheck) {
        // Flagged rows need it; the rest of the table does not.
        findings = [];
    }
    var rows = CsStationTable.rows(drawn.survey, drawn.resolved,
        { findings: findings });
    var rec = CsStationStore.reconcile(rows, s.store);
    s.rows = rec.rows;
    s.orphans = rec.orphans;
    StationTable.fill();
};

StationTable.open = function() {
    var dock = StationTable.ensureDock();
    dock.visible = true;
    try {
        dock.raise();
    } catch (eRaise) {
    }
    StationTable.reload();
};

StationTable.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        StationTable.open();
    } catch (e) {
        csStationTableDock = undefined;
        CsTell.warn("Station Table: this CaveCAD build refused the docked " +
            "panel (" + e + ") -- please report this.");
    }
    this.terminate();
};

StationTable.init = function(basePath) {
    StationTable.basePath = basePath;

    var action = new RGuiAction(qsTr("Station Table"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    // A requiresDocument action runs in the ACTIVE TAB'S own script
    // engine, where dock globals start empty; forceGlobal makes every
    // tab share the one dock (qcad-plugin-conventions).
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/StationTable.js");
    action.setIcon(basePath + "/StationTable.svg");
    action.setStatusTip(qsTr("Every station in the cave: filter to leads " +
        "and open ends, mark them, and jump to them on the map"));
    action.setDefaultCommands(["stationtable", "st"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(12);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: the main window's
    // restoreState() runs after this and can only place a dock that
    // already exists. Hidden until the menu entry shows it.
    try {
        var dock = StationTable.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csStationTableDock = undefined;
        warning("Station Table: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
