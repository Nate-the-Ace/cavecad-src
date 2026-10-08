// CaveShelf.js
//
// QCAD add-on tool: the window CaveCAD opens on -- the caves this
// machine knows about, what each one's trips did, and where each trip
// stopped.
//
// WHY IT EXISTS. Starting the application used to create a document,
// and in this build every new document is poured full of the NSS
// template, so CaveCAD opened on a map of nothing, for a cave nobody
// had named, every single time. The application source now offers that
// moment to an add-on instead (see caveLauncherClaimsStart in QCAD's
// library.js): the global caveShowLauncher below answers it, and
// returning true means no document is created.
//
// THE DIALOG IS QUEUED, NEVER SHOWN FROM THE CLAIM. Startup is still
// running when the claim is answered -- the main window is up but
// add-ons are still settling -- and a modal dialog opened there blocks
// the rest of it. A zero-delay timer puts the window up on the first
// idle turn instead, by which time the application is genuinely
// running.
//
// READING A CAVE COSTS ONE FILE OPEN, and only when a cave is selected.
// The list itself is the registry (CsShelf) and needs no file at all;
// selecting a cave imports its drawing into a memory document and reads
// the survey back from the tags (CsRevise.surveyFromDocument), which is
// what makes the trip table and the frontier real rather than guessed.
// The result is cached for the session against the file's modification
// time, so clicking back and forth is free and a drawing edited outside
// the app is still re-read.
//
// NOTHING HERE WRITES TO A DRAWING. Open, and the stock file machinery
// takes over; New Trip seeds the Survey Notebook page and the notebook
// owns everything after that. The launcher's whole job is choosing.

include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/NewFile/NewFile.js");
include(includeBasePath + "/../Core/CsAll.js");

function CaveShelf(guiAction) {
    EAction.call(this, guiAction);
}

CaveShelf.prototype = new EAction();

// Read by the application's startup gate; also the checkbox in the
// dialog's footer.
CaveShelf.SETTING_SHOW = "Startup/ShowCaveLauncher";

// path -> {mtime, read}. Session only: a cache that outlived the
// session would have to be invalidated by something other than a
// timestamp, and there is nothing here worth that.
CaveShelf.cache = {};

CaveShelf.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    CaveShelf.show();
    this.terminate();
};

CaveShelf.init = function(basePath) {
    var action = new RGuiAction(qsTr("Caves..."), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/CaveShelf.js");
    action.setIcon(basePath + "/CaveShelf.svg");
    action.setStatusTip(qsTr("The caves on this machine: their trips, and where each one stopped"));
    action.setDefaultCommands(["caveshelf", "caves"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(20); // the way in, so: first
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};

/**
 * The application's startup gate calls this when it has nothing to
 * open. Returning true means "the start is taken care of, create no
 * document".
 *
 * Global on purpose: this is the whole interface between the
 * application and the add-on, and it is deliberately one function with
 * no arguments, so a CaveCAD without this add-on installed simply finds
 * nothing and behaves the way QCAD always did.
 */
function caveShowLauncher() {
    if (typeof QTimer === "undefined") {
        return false;
    }
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        try {
            CaveShelf.show();
        } catch (e) {
            // The launcher failing must not leave the user staring at an
            // empty application with no way in.
            EAction.handleUserWarning("Cave shelf: " + e +
                " -- use File > New, or Cave Survey > Caves.");
        }
    });
    timer.start(0);
    return true;
}

// ---------------------------------------------------------------------
// Reading a cave
// ---------------------------------------------------------------------

/**
 * Is this file a placeholder the sync client has not filled in?
 *
 * A zero-byte drawing under a synced drive is the honest, portable
 * signal: Drive for Desktop leaves entries whose bytes are elsewhere,
 * and a DXF is never legitimately empty. Anything cleverer would mean
 * reading macOS file flags through a shell, which is a lot of machinery
 * for a message.
 *
 * \return the sentence to show, or null when the file is fine.
 */
CaveShelf.notDownloaded = function(path) {
    try {
        var info = new QFileInfo(path);
        if (!info.exists() || info.size() > 0) { return null; }
    } catch (e) {
        return null;
    }
    if (!CsCave.isUnderDrive(path, CsCave.driveRoots())) {
        return "The drawing is empty:\n" + path;
    }
    return "Not downloaded from the drive yet — the file is here but its " +
        "contents are not.\n\nOpen the cave's folder (Open Project Folder) " +
        "and let the drive fetch it, then come back.";
};

/**
 * A stamp that changes whenever the file does, for the read cache.
 *
 * Modification time AND size: QDateTime.toString() ignores the format
 * string this bridge passes it, so the text is whatever Qt's default
 * is -- fine as an identity, useless as a parsed date, and the size
 * catches an edit that lands inside the same second.
 */
CaveShelf.mtimeOf = function(path) {
    try {
        var info = new QFileInfo(path);
        if (!info.exists()) { return "0"; }
        return String(info.lastModified().toString()) + ":" + info.size();
    } catch (e) {
        return "0";
    }
};

/**
 * Everything the detail pane shows about one cave, read from its
 * drawing.
 *
 * \return {
 *   ok        false when there is nothing readable
 *   error     why, when !ok -- shown to the user as written
 *   survey    the reconstructed survey
 *   trips     [{id, name, date, team, shots, ends}] in id order
 *   ends      the whole cave's open ends, newest trip first
 *   length    total leg distance, in the survey's own unit
 *   unit      "ft" / "m"
 *   legacy    true when the drawing predates tag schema v3
 * }
 */
/**
 * The trip table's columns: what each one is called, and the KEY it is
 * remembered by.
 *
 * ONE LIST, so the header, the cells and the arrangement cannot
 * disagree about how many columns there are or what order they were
 * built in -- the bug that a hand-written header label list and a
 * hand-written cell list always eventually have.
 */
/**
 * `edit` is the CsTripEdit field a cell writes, or null for a column
 * that is not a caver's to type.
 *
 * WHAT IS NOT EDITABLE, AND WHY. Shots and Ends at are COUNTED from the
 * survey -- typing over them would be typing over arithmetic. Decl is
 * the interesting one: changing a declination re-rotates every azimuth
 * in the trip and moves the whole plan, so it is not metadata at all,
 * and it already has an editor that knows how to do it properly (Survey
 * Notebook's declination dialog, with the IGRF estimate behind Infer).
 * Nathan, 2026-09-15: read-only here, and double-clicking it opens the
 * tool that owns it.
 */
CaveShelf.COLUMNS = [
    { id: "trip", label: "Trip", edit: "name" },
    { id: "date", label: "Date", edit: "date" },
    { id: "decl", label: "Decl", edit: null },
    { id: "team", label: "Team", edit: "team" },
    { id: "shots", label: "Shots", edit: null },
    { id: "from", label: "From", edit: null },
    { id: "to", label: "To", edit: null },
    { id: "ends", label: "Ends at", edit: null }
];

/** Which columns a caver can type in, in column order. */
CaveShelf.columnsEditable = function() {
    var out = [];
    for (var i = 0; i < CaveShelf.COLUMNS.length; i++) {
        out.push(!isNull(CaveShelf.COLUMNS[i].edit));
    }
    return out;
};

/** The field one column writes, or null. */
CaveShelf.columnField = function(id) {
    for (var i = 0; i < CaveShelf.COLUMNS.length; i++) {
        if (CaveShelf.COLUMNS[i].id === id) {
            return isNull(CaveShelf.COLUMNS[i].edit) ? null :
                CaveShelf.COLUMNS[i].edit;
        }
    }
    return null;
};

/** Where a caver's own arrangement of those columns is remembered. */
CaveShelf.COLUMN_SETTING = "CaveSurvey/ShelfTripColumns";

CaveShelf.columnIds = function() {
    var out = [];
    for (var i = 0; i < CaveShelf.COLUMNS.length; i++) {
        out.push(CaveShelf.COLUMNS[i].id);
    }
    return out;
};

CaveShelf.columnLabels = function() {
    var out = [];
    for (var i = 0; i < CaveShelf.COLUMNS.length; i++) {
        out.push(CaveShelf.COLUMNS[i].label);
    }
    return out;
};

/**
 * One trip as its row of cells, in the columns' own order.
 *
 * Pure, and separate from the table: what a row SAYS is worth testing
 * without a widget, and it is the half that keeps meaning something
 * when a column is hidden or dragged elsewhere.
 */
CaveShelf.tripRow = function(trip) {
    var endNames = [];
    var ends = isNull(trip.ends) ? [] : trip.ends;
    for (var e = 0; e < ends.length; e++) {
        endNames.push(ends[e].station);
    }
    var dash = "\u2014";
    return {
        trip: CaveShelf.tripLabel(trip),
        date: trip.date,
        decl: CsShelf.declinationText(trip.declination),
        team: trip.team,
        shots: String(trip.shots),
        // Where the day's survey tied in and where it stopped -- NOT
        // the same as Ends at, which lists what is still open: a trip
        // that tied back into the cave has no open end and still went
        // from somewhere to somewhere.
        from: isNull(trip.start) || trip.start === "" ? dash : trip.start,
        to: isNull(trip.end) || trip.end === "" ? dash : trip.end,
        ends: endNames.length === 0 ? dash : endNames.join(", ")
    };
};

/**
 * One cell's flags and tooltip: editable where a caver's typing is what
 * the field IS, read-only where the number is counted or the change is
 * not a metadata change at all.
 */
CaveShelf.dressCell = function(table, cell, id, trip) {
    var field = CaveShelf.columnField(id);
    // THE FLAG AND THE LOOK, IN ONE CALL. A cell that refuses a
    // double-click while looking exactly like the one beside it that
    // accepts one reads as a broken table, not as a counted column --
    // see CsPanel.markCell, which shades what cannot be typed in.
    CsPanel.markCell(table, cell, field !== null);
    try {
        if (field !== null) {
            cell.setToolTip(qsTr("Double-click to edit. This is the " +
                "same field Survey Notebook's \"Edit this trip...\" " +
                "writes."));
        } else if (id === "decl") {
            cell.setToolTip(qsTr("Declination is not typed here: " +
                "changing it re-rotates every azimuth in the trip and " +
                "moves the plan. Double-click to open the cave and its " +
                "declination editor."));
        } else if (id === "from" || id === "to") {
            cell.setToolTip(qsTr("Where this trip's survey started and " +
                "stopped, in the order it was walked. Read from the " +
                "shots, not typed."));
        } else {
            cell.setToolTip(qsTr("Counted from the survey."));
        }
    } catch (eTip) {
    }
    // The Decl column greys its TEXT where nothing is set. A different
    // channel from the read-only wash on purpose: the background says
    // "not yours to type", the foreground says "nobody has said", and
    // a cell can honestly be both.
    if (id === "decl" && !isNull(trip) &&
            !CsShelf.hasDeclination(trip.declination)) {
        try {
            cell.setForeground(new QBrush(new QColor(150, 150, 150)));
        } catch (eGrey) {
        }
    }
};

/** The open drawings, as CsShelf.editTarget wants them. */
CaveShelf.openDrawings = function() {
    var out = [];
    try {
        var subs = RMainWindowQt.getMainWindow().getMdiArea().subWindowList();
        for (var i = 0; i < subs.length; i++) {
            var doc = null;
            try {
                doc = subs[i].getDocument();
            } catch (eDoc) {
                continue;
            }
            if (isNull(doc)) {
                continue;
            }
            out.push({ path: String(doc.getFileName()),
                       modified: doc.isModified() === true,
                       window: subs[i] });
        }
    } catch (eMdi) {
    }
    return out;
};

/**
 * A cell a caver has just typed into, written back to the cave.
 *
 * THROUGH THE OPEN DOCUMENT, ALWAYS. See CsShelf.editTarget: a cave on
 * screen is the authority on itself, and one that is not open is opened
 * rather than having its file rewritten around a one-word change.
 *
 * The table is refilled from the drawing afterwards either way -- an
 * edit that was refused, normalized (5/6/2024 becomes 2024-05-06) or
 * rejected has to show what actually landed, not what was typed.
 */
CaveShelf.commitCell = function(state, table, item, status) {
    if (CaveShelf.filling === true || isNull(item)) {
        return;
    }
    var row = -1, column = -1;
    try {
        row = item.row();
        column = item.column();
    } catch (eAt) {
        return;
    }
    if (isNull(state.read) || isNull(state.read.trips) ||
            row < 0 || row >= state.read.trips.length ||
            column < 0 || column >= CaveShelf.COLUMNS.length) {
        return;
    }
    var field = CaveShelf.columnField(CaveShelf.COLUMNS[column].id);
    if (field === null) {
        return;
    }
    var typed = "";
    try {
        typed = String(item.text());
    } catch (eText) {
        return;
    }
    var trip = state.read.trips[row];
    var path = isNull(state.record) ? "" : state.record.drawing;
    var caveName = isNull(state.record) ? "" : state.record.name;

    // WHERE IT LANDS: the open tab if the cave has one, and otherwise
    // the FILE itself, with nothing to agree to. Transparent editing is
    // what this table is for, and it only became honest once the DXF
    // round trip stopped losing a layer's OFF state -- see
    // CsShelf.editTarget and CaveShelf.applyToFile.
    var open = CaveShelf.openDrawings();
    var target = CsShelf.editTarget(path, open);
    var applied = (target.mode === "live") ?
        CaveShelf.applyEdit(open[target.at].window, trip.id, field, typed) :
        CaveShelf.applyToFile(path, trip.id, field, typed);
    if (!isNull(applied.error)) {
        try {
            status.text = applied.error;
        } catch (eStatus) {
        }
        CsTell.warn("Cave Shelf: " + applied.error);
    } else {
        CaveShelf.forget(path);
        try {
            // A file edit is ON DISK; a live one leaves the cave's tab
            // modified, and the caver has to save it. The sentence has
            // to say which, because the table looks identical either
            // way.
            status.text = CsShelf.editReport(caveName, field, typed,
                target.mode !== "live");
        } catch (eSay) {
        }
    }
    CaveShelf.refillFrom(state, table);
};

/**
 * Write one field into one trip of an OPEN drawing.
 *
 * The survey is read back from that document rather than reused from
 * the shelf's own summary: the shelf's copy came off the FILE, and the
 * document may have moved on since.
 *
 * \return {error: "..."} or {changes: n}
 */
CaveShelf.applyEdit = function(window, tripId, field, text) {
    var doc = null, di = null;
    try {
        doc = window.getDocument();
        di = window.getDocumentInterface();
    } catch (eDoc) {
        return { error: "That cave's window would not answer." };
    }
    if (isNull(doc) || isNull(di)) {
        return { error: "That cave's window would not answer." };
    }
    // THE READ, THEN ITS SURVEY. CsRevise.surveyFromDocument answers a
    // RECONSTRUCTION -- {survey, resolved, ...} -- and handing that
    // whole object to CsTripEdit.rows yields no rows at all, so every
    // edit would have reported the trip as missing. Caught before it
    // ever ran, by writing the engine test against the same call.
    var read = null;
    try {
        read = CsRevise.surveyFromDocument(doc);
    } catch (eSurvey) {
        return { error: "Could not read the survey back: " + eSurvey };
    }
    if (isNull(read) || isNull(read.survey)) {
        return { error: "Could not read the survey back." };
    }
    var survey = read.survey;
    var rows = CsTripEdit.rows(survey);
    var row = null;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].tripId === tripId) {
            row = rows[i];
        }
    }
    if (row === null) {
        return { error: "That trip is not in the drawing any more." };
    }
    var input = CsTripEdit.inputFor(row, field, text);
    if (input === null) {
        return { error: "That column is not editable." };
    }
    var done = CsTripEdit.commit(doc, di, survey, [input]);
    if (!isNull(done.error)) {
        return { error: done.error };
    }
    return { changes: done.changes.length };
};

/**
 * Write one field into one trip of a cave that is NOT open, in the file
 * itself.
 *
 * TRANSPARENT, AND ONLY BECAUSE THE ROUND TRIP IS EXACT. Nathan asked
 * for this on 2026-09-15 -- "are we able to transparently update the
 * map file without having to explicitly opening it for editing?" -- and
 * the honest answer that morning was no: a DXF round trip through this
 * build lost a layer's OFF state. It was fixed in the application
 * (RDxfExporter::writeLayer negated a colour dxflib was already
 * negating; RDxfImporter::addLayer folded off into frozen), measured
 * exact on a real cave -- 1953 entities, 72 blocks, 46 images, 153
 * layers, 171 tagged entities, 11 trips, all unchanged -- and only then
 * was this switched on.
 *
 * WRITTEN BESIDE, THEN MOVED INTO PLACE. exportFile writes straight
 * over its target, so a failure halfway through would leave a caver
 * holding half a cave. The new drawing is written next to the old one
 * and only swapped in once it is whole, and every step of the swap is
 * checked -- a silently failed rename would leave the edit in a stray
 * file nobody ever opens.
 *
 * \return {error: "..."} or {changes: n}
 */
CaveShelf.applyToFile = function(path, tripId, field, text) {
    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    var temp = path + ".editing.dxf";
    var aside = path + ".previous.dxf";
    try {
        if (di.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return { error: "Could not read " + path + "." };
        }
        var doc = di.getDocument();
        var read = CsRevise.surveyFromDocument(doc);
        if (isNull(read) || isNull(read.survey)) {
            return { error: "Could not read the survey in " + path + "." };
        }
        var rows = CsTripEdit.rows(read.survey);
        var row = null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].tripId === tripId) {
                row = rows[i];
            }
        }
        if (row === null) {
            return { error: "That trip is not in the drawing any more." };
        }
        var input = CsTripEdit.inputFor(row, field, text);
        if (input === null) {
            return { error: "That column is not editable." };
        }
        var done = CsTripEdit.commit(doc, di, read.survey, [input]);
        if (!isNull(done.error)) {
            return { error: done.error };
        }
        if (done.changes.length === 0) {
            return { changes: 0 };
        }
        if (!di.exportFile(temp, CsSanitize.dxfFilter())) {
            return { error: "Could not write the cave's drawing." };
        }
        return CaveShelf.swapIn(path, temp, aside, done.changes.length);
    } catch (e) {
        return { error: "Editing " + path + " failed (" + e + ")." };
    } finally {
        try {
            if (typeof destr === "function") {
                destr(di);
            }
        } catch (eDestroy) {
        }
        CaveShelf.dropFile(temp);
    }
};

/**
 * Put the freshly written drawing where the cave lives, keeping the old
 * one until the swap has actually happened.
 *
 * Three steps, each checked: the cave moves aside, the new drawing
 * takes its place, and only then is the old one let go. A failure at
 * any step puts the caver's own drawing back.
 */
CaveShelf.swapIn = function(path, fresh, aside, changes) {
    CaveShelf.dropFile(aside);
    try {
        if (!(new QFile(path)).rename(aside)) {
            return { error: "Could not replace " + path +
                " -- the drawing would not move aside, so nothing was " +
                "changed." };
        }
    } catch (eAside) {
        return { error: "Could not replace " + path + " (" + eAside + ")." };
    }
    var moved = false;
    try {
        moved = (new QFile(fresh)).rename(path);
    } catch (eMove) {
        moved = false;
    }
    if (!moved) {
        try {
            (new QFile(aside)).rename(path);
        } catch (ePut) {
        }
        return { error: "Could not put the edited drawing in place; the " +
            "cave's own drawing is untouched." };
    }
    CaveShelf.dropFile(aside);
    return { changes: changes };
};

/** Let one working file go, if it is there. Never the cave's own. */
CaveShelf.dropFile = function(path) {
    try {
        if ((new QFileInfo(path)).exists()) {
            (new QFile(path)).remove();
        }
    } catch (e) {
    }
};

/** Redraw the table from the drawing, whatever was typed. */
CaveShelf.refillFrom = function(state, table) {
    if (typeof state.refill === "function") {
        state.refill();
    }
};

/** Drop one cave from the read cache, so the next read is the file. */
CaveShelf.forget = function(path) {
    try {
        if (!isNull(CaveShelf.cache) && !isNull(CaveShelf.cache[path])) {
            delete CaveShelf.cache[path];
        }
    } catch (e) {
    }
};

/**
 * The declination cell, double-clicked: open the cave and the editor
 * that owns declination.
 *
 * NOT AN EDIT IN THE TABLE. Changing a declination re-rotates every
 * azimuth in the trip; the dialog that does it has the IGRF estimate,
 * the redraw and the confirmation, and none of that belongs behind a
 * double-click in a list.
 */
CaveShelf.declinationRoute = function(state) {
    if (isNull(state.record)) {
        return;
    }
    var answer = QMessageBox.question(getMainWindow(), "Cave Shelf",
        qsTr("Declination is set per trip in Survey Notebook, where " +
            "Infer can estimate it from the cave's location and the " +
            "trip's date -- changing it re-rotates the survey, so it " +
            "is not typed into a list.\n\nOpen %1 now?")
            .arg(state.record.name),
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }
    CaveShelf.pendingDeclination = true;
    CaveShelf.pendingPath = state.record.drawing;
    state.dialog.accept();
};

CaveShelf.readCave = function(record) {
    var blank = { ok: false, error: "", trips: [], ends: [], length: 0,
        unit: "ft", legacy: false, survey: null, startable: false };

    if (record === null || record === undefined ||
            CsShelf.clean(record.drawing) === "") {
        blank.error = "No drawing yet. New Trip starts one from the NSS " +
            "template, saves it in this folder, and opens the notebook " +
            "on the first station.";
        blank.startable = true;
        return blank;
    }

    var path = record.drawing;
    if (!(new QFileInfo(path)).exists()) {
        blank.error = "The drawing is missing:\n" + path;
        return blank;
    }
    if (CsShelf.extension(path) === "dwg") {
        blank.error = "This cave's drawing is a DWG. CaveCAD reads DXF -- " +
            "convert it (any CAD that writes DXF will do) and register " +
            "the cave again.";
        return blank;
    }

    // A Drive placeholder: the entry is there, the bytes are not. Saying
    // so beats letting the import fail with something about DXF syntax.
    var pending = CaveShelf.notDownloaded(path);
    if (pending !== null) {
        blank.error = pending;
        return blank;
    }

    var stamp = CaveShelf.mtimeOf(path);
    var cached = CaveShelf.cache[path];
    if (cached !== undefined && cached.stamp === stamp) {
        return cached.read;
    }

    var sourceDi = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    var read = blank;
    try {
        if (sourceDi.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            var why = "Could not read:\n" + path;
            if (CsCave.isUnderDrive(path, CsCave.driveRoots())) {
                why += "\n\nThis cave is on a synced drive. If the file has " +
                    "not been downloaded to this machine yet, open its " +
                    "folder and let the drive fetch it, then try again.";
            }
            read = { ok: false, error: why,
                trips: [], ends: [], length: 0, unit: "ft", legacy: false,
                survey: null, startable: false };
        }
        else {
            var caveDoc = sourceDi.getDocument();
            read = CaveShelf.summarize(CsRevise.surveyFromDocument(caveDoc),
                caveDoc, record.folder);
        }
    } catch (e) {
        read = { ok: false, error: "Could not read this cave: " + e,
            trips: [], ends: [], length: 0, unit: "ft", legacy: false,
            survey: null };
    } finally {
        destr(sourceDi);
    }

    CaveShelf.cache[path] = { stamp: stamp, read: read };
    return read;
};

/**
 * Everything the shelf can learn about a cave in one pass over the
 * document it has already opened: what the survey is, and what about it
 * wants attention.
 *
 * The triage half is the point. Length and trip count describe a cave;
 * a bad loop closure, a trip surveyed under the wrong declination, or
 * linework no trip owns are things somebody has to DO something about,
 * and a shelf that shows them turns a list of files into a work queue.
 */
CaveShelf.summarize = function(recon, doc, folder) {
    var survey = (recon === null || recon === undefined) ? null : recon.survey;
    if (survey === null || survey === undefined) {
        return { ok: false, error: "This drawing carries no survey data.",
            trips: [], ends: [], length: 0, unit: "ft", legacy: false,
            survey: null, startable: true };
    }

    var unit = survey.distanceUnit === undefined || survey.distanceUnit === null ?
        "ft" : survey.distanceUnit;

    var length = 0;
    var counts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (!CsFrontier.isLeg(shot)) { continue; }
        if (shot.excludeFromLength !== true) {
            length += (typeof shot.distance === "number") ? shot.distance : 0;
        }
        var id = (typeof shot.trip === "number") ? shot.trip : 0;
        counts[id] = (counts[id] === undefined ? 0 : counts[id]) + 1;
    }

    var ends = CsFrontier.openEnds(survey);

    var tripRecords = (Object.prototype.toString.call(survey.trips) ===
        "[object Array]") ? survey.trips : [];
    var trips = [];
    var seen = {};
    var push = function(id, record) {
        if (seen[id] === true) { return; }
        seen[id] = true;
        var span = CsShelf.tripSpan(survey.shots, id);
        trips.push({
            id: id,
            name: record === null || record === undefined ? "" :
                CsShelf.clean(record.name),
            date: record === null || record === undefined ? "" :
                CsShelf.clean(record.date),
            team: record === null || record === undefined ? "" :
                CsShelf.clean(record.team),
            // NOT defaulted to zero. Zero is what an untold trip
            // already reads as, and the whole point of the column is
            // to tell those apart from a real measurement -- so a trip
            // with no record at all keeps null and the column says
            // "not set" for both, honestly, rather than inventing a
            // number nobody measured.
            declination: (record === null || record === undefined ||
                typeof record.declination !== "number") ? null :
                record.declination,
            start: span.start,
            end: span.end,
            shots: counts[id] === undefined ? 0 : counts[id],
            ends: CsFrontier.openEndsOfTrip(survey, id)
        });
    };
    for (var t = 0; t < tripRecords.length; t++) {
        push(t, tripRecords[t]);
    }
    // A drawing with shots but no trip records (or fewer records than
    // trips) still has trips -- they are just anonymous.
    for (var key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
            push(parseInt(key, 10), null);
        }
    }
    trips.sort(function(a, b) { return a.id - b.id; });

    var health = CaveShelf.inspect(survey, recon, doc, folder);

    return {
        ok: survey.shots.length > 0,
        stats: health.stats,
        grade: health.grade,
        badges: health.badges,
        drift: health.drift,
        // A fresh template drawing has no shots. That is not a fault --
        // it is a cave waiting for its first trip, and New Trip must
        // stay live for it.
        startable: survey.shots.length === 0,
        error: survey.shots.length > 0 ? "" :
            "No survey in this drawing yet. New Trip opens the notebook " +
            "on the first station.",
        survey: survey,
        trips: trips,
        ends: ends,
        length: length,
        unit: unit,
        legacy: recon.legacy === true
    };
};

/**
 * "1 trip", "6 trips" -- a cave with one of something is common enough
 * that "1 trips" would be on screen most of the time.
 */
CaveShelf.count = function(n, noun) {
    return n + " " + noun + (n === 1 ? "" : "s");
};

/**
 * The triage pass: solve the survey the way the DRAWING was solved, and
 * read the conditions worth flagging off the document itself.
 *
 * Solved through CsAdjust.resolveAndAdjust with the drawing's own
 * recorded options (CsRevise hands them over as adjustTags), not with
 * the current settings -- a closure figure computed under a different
 * adjustment than the geometry on screen is a number about nothing.
 *
 * Everything here is wrapped: a cave that cannot be analysed still
 * lists, with fewer things said about it.
 */
CaveShelf.inspect = function(survey, recon, doc, folder) {
    var out = { stats: null, grade: null, badges: [], drift: [] };
    if (survey === null || survey === undefined) { return out; }

    var resolved = null;
    try {
        resolved = CsAdjust.resolveAndAdjust(survey, {},
            CsAdjust.optionsFromTags(recon.adjustTags));
        out.stats = CsStats.compute(survey, resolved);
        out.grade = CsGrade.compute(survey, resolved, out.stats);
    } catch (eSolve) {
    }

    var errors = 0;
    try {
        var findings = CsValidate.check(survey, resolved);
        for (var f = 0; f < findings.length; f++) {
            if (findings[f].severity === "error") { errors++; }
        }
    } catch (eCheck) {
    }

    var scan = CaveShelf.scanDocument(doc);

    // Declination against IGRF, but only where the cave says where it
    // is: without an anchor there is no honest comparison to make.
    if (scan.lat !== null && scan.lon !== null) {
        var trips = [];
        var records = (Object.prototype.toString.call(survey.trips) ===
            "[object Array]") ? survey.trips : [];
        for (var t = 0; t < records.length; t++) {
            trips.push({ id: t, date: records[t].date,
                declination: records[t].declination });
        }
        out.drift = CsShelf.declinationDrift(trips, function(when) {
            var parts = CsShelf.dateParts(when);
            if (parts === null) { return null; }
            return CsShelf.declinationValue(
                CsGeomag.declination(scan.lat, scan.lon, parts, 0.0));
        });
    }

    var ends = CsFrontier.openEnds(survey);
    var noLrud = false;
    for (var e = 0; e < ends.length; e++) {
        if (ends[e].hasLrud === false) { noLrud = true; }
    }

    out.badges = CsShelf.badges({
        errors: errors,
        closure: CsShelf.worstClosure(out.stats),
        closureWarnAt: CsValidate.CLOSURE_WARN_PERCENT,
        driftedTrips: out.drift.length,
        legacy: recon.legacy === true,
        unbound: scan.unbound,
        openEndNoLrud: noLrud,
        geo: scan.lat !== null,
        elevation: scan.elevation,
        pdfs: CsCave.pdfFiles(folder).length
    });
    return out;
};

/**
 * One walk over the drawing for the three things only the document
 * knows: whether it is georeferenced (and where, which stays INSIDE
 * this function -- the coordinate is never shown, only used to ask IGRF
 * a question), whether an extended elevation has been drawn, and how
 * much traced linework belongs to no trip.
 */
CaveShelf.scanDocument = function(doc) {
    var out = { lat: null, lon: null, elevation: false, unbound: 0 };
    if (isNull(doc)) { return out; }

    var ids;
    try {
        ids = doc.queryAllEntities(false, false);
    } catch (eQuery) {
        return out;
    }

    for (var i = 0; i < ids.length; i++) {
        var e;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eEnt) {
            continue;
        }
        if (isNull(e)) { continue; }

        if (out.lat === null) {
            var lat = CsTags.getNumber(e, "GeoLat");
            var lon = CsTags.getNumber(e, "GeoLon");
            if (lat !== null && lon !== null) {
                out.lat = lat;
                out.lon = lon;
            }
        }

        if (!out.elevation && CsTags.get(e, "ProfileRun") !== null &&
                CsTags.get(e, "ProfileRun") !== undefined) {
            out.elevation = true;
        }

        try {
            var layer = doc.getLayerName(e.getLayerId());
            if (CsBind.isLineworkLayer(layer) &&
                    isNull(CsTags.get(e, CsBind.TRIP_TAG))) {
                out.unbound++;
            }
        } catch (eLayer) {
        }
    }
    return out;
};

/** "4,180 ft" */
CaveShelf.formatLength = function(length, unit) {
    var rounded = Math.round(length);
    var text = String(rounded);
    var grouped = "";
    while (text.length > 3) {
        grouped = "," + text.substring(text.length - 3) + grouped;
        text = text.substring(0, text.length - 3);
    }
    return text + grouped + " " + unit;
};

/** "Trip 6 -- Upper maze", or "Trip 6" when it was never named. */
CaveShelf.tripLabel = function(trip) {
    var label = "Trip " + trip.id;
    return trip.name === "" ? label : label + " — " + trip.name;
};

/** The station a new trip would tie into, or "" when there is none. */
CaveShelf.tieInFor = function(read) {
    if (read === null || read === undefined ||
            Object.prototype.toString.call(read.ends) !== "[object Array]" ||
            read.ends.length === 0) {
        return "";
    }
    return read.ends[0].station;
};

// ---------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------

/**
 * Builds and runs the shelf.
 *
 * Everything cosmetic is wrapped: this bridge refuses the odd widget
 * property depending on the Qt build, and a launcher that throws while
 * setting a header's stretch would leave the user with no way into
 * their own caves.
 */
CaveShelf.show = function() {
    var appWin = RMainWindowQt.getMainWindow();
    var dialog = new QDialog(appWin);
    dialog.windowTitle = qsTr("Caves");
    dialog.setMinimumSize(new QSize(880, 520));

    var state = {
        records: [],     // what the list currently shows
        record: null,    // the selected cave
        read: null,      // its reconstruction
        trip: -1,        // the selected trip, -1 for none
        dialog: null,    // the window itself, for an edit that must close it
        refill: null     // redraw the table from the drawing
    };

    var outer = new QVBoxLayout();
    var main = new QHBoxLayout();

    // ---- left: the shelf itself --------------------------------------
    var left = new QVBoxLayout();
    var search = new QLineEdit();
    search.placeholderText = qsTr("Search caves");
    left.addWidget(search, 0, 0);

    // A one-column table, not a QListWidget: this bridge generates
    // QListWidget (and QTreeWidget) as WRAPPER-ONLY classes -- they can
    // wrap a widget C++ made, and `new QListWidget()` only warns "No
    // constructor found" and hands back an object with nothing behind
    // it, which the layout then refuses as a null widget. QTableWidget
    // is generated with a real constructor, so the shelf is a table
    // with one column and no headers.
    var list = new QTableWidget(0, 1);
    list.minimumWidth = 240;
    try {
        list.horizontalHeader().visible = false;
        list.verticalHeader().visible = false;
        list.horizontalHeader().stretchLastSection = true;
        list.selectionBehavior = QAbstractItemView.SelectRows;
        list.editTriggers = QAbstractItemView.NoEditTriggers;
    } catch (eList) {
    }
    left.addWidget(list, 1, 0);

    var leftButtons = new QHBoxLayout();
    var addButton = new QPushButton(qsTr("Import Cave..."));
    addButton.toolTip = qsTr("From a file: a survey in Compass, Survex, " +
        "Walls or CSV becomes a new cave project, drawing and all; a DXF " +
        "or DWG joins the shelf where it already sits.");
    var addFolderButton = new QPushButton(qsTr("Import Folder..."));
    addFolderButton.toolTip = qsTr("From a folder: one cave project, or a " +
        "folder holding several -- a survey group's shared folder, say.");
    leftButtons.addWidget(addButton, 1, 0);
    leftButtons.addWidget(addFolderButton, 0, 0);
    left.addLayout(leftButtons, 0);
    main.addLayout(left, 0);

    // ---- right: the selected cave ------------------------------------
    var right = new QVBoxLayout();

    // The cave's name and its picture share the top of the pane.
    var header = new QHBoxLayout();
    var thumb = new QLabel("");
    thumb.setFixedSize(new QSize(CaveShelf.THUMB_W, CaveShelf.THUMB_H));
    thumb.alignment = Qt.AlignCenter;
    var heading = new QVBoxLayout();

    var title = new QLabel("");
    try {
        var titleFont = title.font;
        titleFont.setPointSize(titleFont.pointSize() + 5);
        titleFont.setBold(true);
        title.font = titleFont;
    } catch (eFont) {
    }
    heading.addWidget(title, 0, 0);

    var subtitle = new QLabel("");
    subtitle.wordWrap = true;
    heading.addWidget(subtitle, 0, 0);

    var badges = new QLabel("");
    badges.wordWrap = true;
    heading.addWidget(badges, 0, 0);
    heading.addStretch(1);

    header.addWidget(thumb, 0, 0);
    header.addLayout(heading, 1);
    right.addLayout(header, 0);

    // SIX COLUMNS, and Decl is next to the date on purpose: it is a
    // measurement ABOUT that day in that place, and a caver comparing
    // it against what the needle does now is reading the two together.
    //
    // That is the DEFAULT, not the law -- the header can be dragged
    // into any order and right-clicked for which columns show, and
    // what a caver leaves it as is what they get next time. See
    // CsPanel.arrangeColumns; the keys are what is remembered, so a
    // column added later lands in everybody's table instead of
    // shuffling the arrangement they had.
    var table = new QTableWidget(0, CaveShelf.COLUMNS.length);
    try {
        table.setHorizontalHeaderLabels(CaveShelf.columnLabels());
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
        table.selectionBehavior = QAbstractItemView.SelectRows;
        // TYPE STRAIGHT INTO THE ROW. Trip, Date and Team are the same
        // four fields Survey Notebook's "Edit this trip..." owns, and
        // they land through the same CsTripEdit.commit -- see
        // CaveShelf.commitCell. Everything else is read-only, cell by
        // cell, not by switching editing off for the whole table.
        table.editTriggers = QAbstractItemView.DoubleClicked |
            QAbstractItemView.EditKeyPressed;
    } catch (eTable) {
    }
    var columns = CsPanel.arrangeColumns(table, CaveShelf.columnIds(),
        CaveShelf.columnLabels(), CaveShelf.COLUMN_SETTING);
    // The headings of the columns that are read from the survey are
    // dimmed, so the difference is visible before a caver clicks into
    // one and finds nothing happens.
    CsPanel.markHeadings(table, CaveShelf.columnLabels(),
        CaveShelf.columnsEditable());
    right.addWidget(table, 1, 0);

    var health = new QLabel("");
    health.wordWrap = true;
    right.addWidget(health, 0, 0);

    var frontier = new QLabel("");
    frontier.wordWrap = true;
    right.addWidget(frontier, 0, 0);

    // The cave's own actions live in the list's right-click menu
    // (favorite, open folder, package, forget); the window's actions
    // (new cave, open, trip, close) stay in the footer.
    main.addLayout(right, 1);
    outer.addLayout(main, 1);

    // ---- footer -------------------------------------------------------
    var footer = new QHBoxLayout();
    var atStartup = new QCheckBox(qsTr("Open this window at startup"));
    atStartup.checked =
        RSettings.getBoolValue(CaveShelf.SETTING_SHOW, true) === true;
    footer.addWidget(atStartup, 0, 0);
    // The shelf is a dialog, not a dock, so CsPanel.attachHelp -- which
    // wraps a dock's widget -- has nothing to wrap. The button is the
    // same one, in the same corner of the same footer the rest of the
    // shelf's actions live in.
    var shelfHelp = CsPanel.helpButton("CaveShelf", qsTr("Caves"));
    if (shelfHelp !== null) {
        footer.addWidget(shelfHelp, 0, 0);
    }
    footer.addStretch(1);

    var newCaveButton = new QPushButton(qsTr("New Cave..."));
    var openButton = new QPushButton(qsTr("Open Drawing"));
    var tripButton = new QPushButton(qsTr("New Trip"));
    var closeButton = new QPushButton(qsTr("Close"));
    try {
        openButton.default = true;
    } catch (eDefault) {
    }
    footer.addWidget(newCaveButton, 0, 0);
    footer.addWidget(openButton, 0, 0);
    footer.addWidget(tripButton, 0, 0);
    footer.addWidget(closeButton, 0, 0);
    outer.addLayout(footer, 0);

    dialog.setLayout(outer);

    // ---- filling it ---------------------------------------------------

    var fillList = function(selectFolder) {
        var needle = String(search.text).toLowerCase();
        state.records = [];
        list.setRowCount(0);
        var all = CsShelf.list();
        for (var i = 0; i < all.length; i++) {
            var record = all[i];
            if (needle !== "" &&
                    record.name.toLowerCase().indexOf(needle) === -1 &&
                    record.folder.toLowerCase().indexOf(needle) === -1) {
                continue;
            }
            state.records.push(record);
            list.setRowCount(state.records.length);
            // SHOWN IN CAPS, stored as typed. A cave's name is a map
            // title, and the shelf reads as one list of caves rather
            // than a jumble of whatever case each project folder was
            // named in. Only the cell text is upper-cased: the record,
            // the folder, the search and every drawing that carries the
            // name keep the caver's own spelling.
            list.setItem(state.records.length - 1, 0,
                new QTableWidgetItem((record.favorite === true ? "★ " : "") +
                    String(record.name).toUpperCase()));
        }
        if (state.records.length === 0) {
            return;
        }
        var at = 0;
        if (selectFolder !== undefined && selectFolder !== null) {
            var found = CsShelf.indexOfFolder(state.records, selectFolder);
            if (found !== -1) { at = found; }
        }
        list.selectRow(at);
    };

    var showDetail = function() {
        var row = list.currentRow();
        state.trip = -1;
        state.record = (row >= 0 && row < state.records.length) ?
            state.records[row] : null;

        table.setRowCount(0);

        badges.text = "";
        health.text = "";
        CaveShelf.showThumbnail(thumb, state.record);

        if (state.record === null) {
            title.text = state.records.length === 0 ?
                qsTr("No caves on the shelf yet") : "";
            subtitle.text = state.records.length === 0 ?
                qsTr("Import Cave... reads a survey file (Compass, Survex, " +
                    "Walls, CSV) or an existing drawing. Import Folder... " +
                    "takes a cave folder, or a folder of them. Saving a " +
                    "drawing under your drive adds it here by itself.") : "";
            frontier.text = "";
            state.read = null;
            CaveShelf.updateButtons(state, openButton, tripButton);
            return;
        }

        title.text = state.record.name;
        subtitle.text = qsTr("Reading...");
        QCoreApplication.processEvents();

        var read = CaveShelf.readCave(state.record);
        state.read = read;

        var where = state.record.drawing !== "" ?
            state.record.drawing : state.record.folder;
        if (!read.ok) {
            subtitle.text = where + "\n" + read.error;
            frontier.text = "";
            CaveShelf.updateButtons(state, openButton, tripButton);
            return;
        }

        var pdfs = CsCave.pdfFiles(state.record.folder);
        var parts = [where,
            CaveShelf.formatLength(read.length, read.unit) + qsTr(" surveyed"),
            CaveShelf.count(read.trips.length, "trip")];
        if (pdfs.length > 0) {
            parts.push(CaveShelf.count(pdfs.length, "map") +
                qsTr(" in PDF/"));
        }
        if (read.legacy) {
            parts.push(qsTr("pre-v3 tags: trips are approximate"));
        }
        subtitle.text = parts.join("  ·  ");

        // FILLING IS NOT EDITING. setText fires itemChanged exactly
        // as a caver's typing does (probed 2026-09-15), so a refill
        // with the signal live would commit every cell it wrote back
        // into the drawing.
        CaveShelf.filling = true;
        table.setRowCount(read.trips.length);
        for (var t = 0; t < read.trips.length; t++) {
            var trip = read.trips[t];
            var row = CaveShelf.tripRow(trip);
            for (var c = 0; c < CaveShelf.COLUMNS.length; c++) {
                var id = CaveShelf.COLUMNS[c].id;
                var cell = new QTableWidgetItem(row[id]);
                CaveShelf.dressCell(table, cell, id, trip);
                // A TRIP WITH NO DECLINATION SAYS SO QUIETLY BUT SAYS
                // SO. Greyed rather than hidden: it is a gap in the
                // survey, not an error, and a caver scanning the column
                // should be able to see at a glance which trips were
                // never corrected -- the azimuths in those are magnetic
                // bearings a map is calling true.
                if (id === "decl" &&
                        !CsShelf.hasDeclination(trip.declination)) {
                    try {
                        cell.setForeground(new QBrush(
                            new QColor(150, 150, 150)));
                    } catch (eGrey) {
                    }
                }
                table.setItem(t, c, cell);
            }
        }
        CaveShelf.filling = false;
        try {
            table.resizeColumnsToContents();
        } catch (eResize) {
        }

        badges.text = CsShelf.badgeLine(read.badges);
        health.text = CsShelf.healthText(read.stats, read.grade, read.unit) +
            CaveShelf.driftText(read.drift);
        frontier.text = CaveShelf.frontierText(read);
        CaveShelf.updateButtons(state, openButton, tripButton);
    };

    // ---- what the actions do (buttons and the right-click menu) -------

    var doOpen = function() {
        if (CaveShelf.openRecord(state.record)) { dialog.accept(); }
    };

    var doTrip = function() {
        if (CaveShelf.startTrip(state)) { dialog.accept(); }
    };

    var doReveal = function() {
        if (state.record !== null) { CaveShelf.reveal(state.record.folder); }
    };

    var doPackage = function() {
        if (state.record === null) { return; }
        if (typeof PackageCave === "undefined") {
            EAction.handleUserWarning(qsTr("Package Cave Project is not " +
                "installed."));
            return;
        }
        PackageCave.forRecord(state.record, dialog);
    };

    var doForget = function() {
        if (state.record === null) { return; }
        var answer = CaveShelf.confirm(dialog, qsTr("Forget Cave"),
            qsTr("Take %1 off the shelf?\n\nThe folder and everything in " +
                "it stays exactly where it is.").arg(state.record.name));
        if (answer) {
            CsShelf.forget(state.record.folder);
            fillList();
            showDetail();
        }
    };

    var doToggleFavorite = function() {
        if (state.record === null) { return; }
        CsShelf.setFavorite(state.record.folder,
            !(state.record.favorite === true));
        fillList(state.record.folder);
        showDetail();
    };

    // The cave's own actions: right-click a cave in the list.
    var showListMenu = function() {
        var record = state.record;
        var hasDrawing = record !== null &&
            CsShelf.clean(record.drawing) !== "";
        var isDwg = hasDrawing &&
            CsShelf.extension(record.drawing) === "dwg";

        var menu = new QMenu(list);

        var openAct = menu.addAction(qsTr("Open Drawing"));
        openAct.enabled = hasDrawing && !isDwg;
        openAct.triggered.connect(doOpen);

        var tripAct = menu.addAction(state.station === "" ?
            qsTr("New Trip") :
            qsTr("New Trip from %1").arg(state.station));
        tripAct.enabled = record !== null && !isDwg &&
            (openAct.enabled || state.needsDrawing === true);
        tripAct.triggered.connect(doTrip);

        menu.addSeparator();

        var favAct = menu.addAction(record !== null &&
            record.favorite === true ?
            qsTr("Unfavorite") : qsTr("Favorite") + " ★");
        favAct.enabled = record !== null;
        favAct.triggered.connect(doToggleFavorite);

        // A folder can always be opened, even for a cave with nothing
        // in it yet -- that is often exactly when somebody wants to
        // look. Packaging needs something to package.
        var revealAct = menu.addAction(qsTr("Open Project Folder"));
        revealAct.enabled = record !== null;
        revealAct.triggered.connect(doReveal);

        var packageAct = menu.addAction(qsTr("Package..."));
        packageAct.enabled = hasDrawing && !isDwg;
        packageAct.triggered.connect(doPackage);

        menu.addSeparator();

        var forgetAct = menu.addAction(qsTr("Forget..."));
        forgetAct.enabled = record !== null;
        forgetAct.triggered.connect(doForget);

        menu.exec(QCursor.pos());
        try {
            menu.deleteLater();
        } catch (eDel) {
            // a leaked popup menu is cosmetic
        }
    };

    // ---- wiring -------------------------------------------------------

    search.textChanged.connect(function() { fillList(); });
    list.itemSelectionChanged.connect(showDetail);

    list.itemDoubleClicked.connect(doOpen);

    try {
        list.contextMenuPolicy = Qt.CustomContextMenu;
        list.customContextMenuRequested.connect(function(pos) {
            // right-click selects what it lands on, so the menu and the
            // detail pane agree about which cave is meant
            try {
                var row = list.rowAt(pos.y());
                if (row >= 0 && row !== list.currentRow()) {
                    list.selectRow(row);
                }
            } catch (eRow) {
                // selection stays where it was
            }
            showListMenu();
        });
    } catch (eMenu) {
        // no custom menu on this bridge: double-click and the footer
        // buttons still cover open/trip
    }

    // AN EDIT IS COMMITTED WHEN THE CELL IS. Not on a Save button: a
    // table is a place where typing and pressing Return means the
    // thing is done, and a shelf with an Apply somewhere would be a
    // list that silently discards work when it closes.
    state.dialog = dialog;
    state.refill = function() { showDetail(); };
    try {
        table["itemChanged(QTableWidgetItem*)"].connect(function(item) {
            CaveShelf.commitCell(state, table, item, health);
        });
    } catch (eChanged) {
        try {
            table.itemChanged.connect(function(item) {
                CaveShelf.commitCell(state, table, item, health);
            });
        } catch (eChanged2) {
            // no signal here: the cells simply stay as they were typed
            // until the next read, which is the table as it was before
        }
    }
    // The Decl cell is read-only, and a double-click on it is a caver
    // asking to change it -- so it answers with the tool that can.
    try {
        table["cellDoubleClicked(int, int)"].connect(function(row, column) {
            if (column >= 0 && column < CaveShelf.COLUMNS.length &&
                    CaveShelf.COLUMNS[column].id === "decl") {
                CaveShelf.declinationRoute(state);
            }
        });
    } catch (eDouble) {
    }

    table.itemSelectionChanged.connect(function() {
        state.trip = table.currentRow();
        if (state.read !== null) {
            frontier.text = CaveShelf.frontierText(state.read, state.trip);
        }
        CaveShelf.updateButtons(state, openButton, tripButton);
    });

    addButton.clicked.connect(function() {
        var added = CaveShelf.importFile(dialog);
        if (added !== null) { fillList(added.folder); showDetail(); }
    });

    addFolderButton.clicked.connect(function() {
        var count = CaveShelf.addFolder(dialog);
        if (count > 0) { fillList(); showDetail(); }
    });

    newCaveButton.clicked.connect(function() {
        var created = CaveShelf.newCave(dialog);
        if (created !== null) { dialog.accept(); }
    });

    openButton.clicked.connect(doOpen);

    tripButton.clicked.connect(doTrip);

    closeButton.clicked.connect(function() { dialog.reject(); });

    fillList();
    showDetail();

    dialog.exec();

    RSettings.setValue(CaveShelf.SETTING_SHOW, atStartup.checked === true);
    destrDialog(dialog);

    // AFTER THE SHELF IS GONE, not before: opening a drawing from under
    // a modal dialog is asking the application to build an MDI child
    // while a nested event loop owns the screen.
    CaveShelf.runPending();
};

/**
 * The cave a caver asked to be taken to, opened once the shelf has
 * closed.
 *
 * ONLY THE DECLINATION ROUTE USES THIS NOW. A cell edit no longer needs
 * a cave opened at all -- it goes straight into the file (see
 * CaveShelf.applyToFile) -- but declination is not a cell edit: it
 * re-rotates the survey, and the editor that does it properly lives in
 * Survey Notebook, in the cave's own window.
 */
CaveShelf.runPending = function() {
    var declination = CaveShelf.pendingDeclination === true;
    CaveShelf.pendingDeclination = false;
    if (!declination) {
        return;
    }
    var path = CaveShelf.pendingPath;
    CaveShelf.pendingPath = "";
    if (isNull(path) || path === "") {
        return;
    }
    try {
        openFiles([path], false);
    } catch (eOpen) {
        CsTell.warn("Cave Shelf: could not open " + path + " (" + eOpen + ").");
        return;
    }
    EAction.handleUserMessage(qsTr("Cave Shelf: opened this cave. " +
        "Declination lives in Survey Notebook -- load the trip and " +
        "use Decl, or Infer to estimate it from the location and " +
        "date."));
};

/** The sentence under the trip table. */
CaveShelf.frontierText = function(read, tripRow) {
    if (read === null || !read.ok) { return ""; }

    var ends = read.ends;
    var lead = qsTr("Open ends");
    if (tripRow !== undefined && tripRow >= 0 && tripRow < read.trips.length) {
        var trip = read.trips[tripRow];
        ends = trip.ends;
        lead = qsTr("Where %1 stopped").arg(CaveShelf.tripLabel(trip));
    }

    if (ends.length === 0) {
        return lead + ": " + qsTr("none — every station is tied in.");
    }

    var parts = [];
    for (var i = 0; i < ends.length && i < 6; i++) {
        parts.push(ends[i].station + (ends[i].hasLrud ? "" :
            qsTr(" (no LRUD)")));
    }
    var text = lead + ": " + parts.join(", ");
    if (ends.length > parts.length) {
        text += qsTr(", and %1 more").arg(ends.length - parts.length);
    }
    return text;
};

/**
 * Enables what can be done to the selected cave, and says so.
 *
 * New Trip is the way IN to a cave, so it stays live in the three states
 * a cave can be in before it has any survey: no drawing at all (starting
 * the trip starts the drawing), a drawing with nothing in it, and a
 * drawing whose trips have left an open end. A cave that already HAS a
 * drawing never gets a second one -- the new trip is a numbered trip
 * inside that drawing, which is what lets loop closure solve across
 * trips and a revision correct one trip without touching the others. The only thing that disables it is a
 * drawing CaveCAD cannot open -- a DWG -- because guessing what to do
 * beside somebody's DWG is not this button's business.
 */
CaveShelf.updateButtons = function(state, openButton, tripButton) {
    var record = state.record;
    var read = state.read;
    var hasDrawing = record !== null && CsShelf.clean(record.drawing) !== "";
    var isDwg = hasDrawing && CsShelf.extension(record.drawing) === "dwg";

    openButton.enabled = hasDrawing && !isDwg;

    var station = "";
    if (read !== null && read.ok) {
        if (state.trip >= 0 && state.trip < read.trips.length &&
                read.trips[state.trip].ends.length > 0) {
            station = read.trips[state.trip].ends[0].station;
        }
        else {
            station = CaveShelf.tieInFor(read);
        }
    }
    state.station = station;
    state.needsDrawing = record !== null && !hasDrawing;

    tripButton.enabled = record !== null && !isDwg &&
        (openButton.enabled || state.needsDrawing);

    // Always "New Trip". Making the drawing when a cave has none is
    // what starting a trip MEANS for a cave nobody has surveyed yet --
    // it is not a different action, and a button that renames itself
    // buries the one thing the user came here to do. The label only
    // gains detail when there is a station to tie into.
    tripButton.text = station === "" ? qsTr("New Trip") :
        qsTr("New Trip from %1").arg(station);
};

// ---------------------------------------------------------------------
// What the buttons do
// ---------------------------------------------------------------------

/** Opens a cave's drawing through the stock file machinery. */
CaveShelf.openRecord = function(record) {
    if (record === null || record === undefined) { return false; }
    var path = CsShelf.clean(record.drawing);
    if (path === "" || !(new QFileInfo(path)).exists()) { return false; }
    openFiles([path], false);
    CaveShelf.captureThumbnailSoon(path);
    return true;
};

/**
 * Creates a cave's drawing: the NSS template, saved into the cave's own
 * folder under the cave's own name.
 *
 * Shared by New Cave... (which makes the folder first) and by New Trip
 * on a cave that was registered before it had any drawing -- adding a
 * folder off the drive and then wanting to survey it is the ordinary
 * way a cave starts, and it must not dead-end.
 *
 * \return the drawing's path, or null.
 */
CaveShelf.startDrawing = function(record) {
    if (record === null || record === undefined) { return null; }

    var stem = CsPackage.safeName(record.name);
    if (stem === "") { stem = CsShelf.basename(record.folder); }
    if (stem === "") { stem = "Cave"; }
    var drawing = record.folder + "/" + stem + ".dxf";

    // Already there (somebody saved one since this cave was added):
    // adopt it rather than writing over it.
    if ((new QFileInfo(drawing)).exists()) {
        CsShelf.register({ name: record.name, folder: record.folder,
            drawing: drawing });
        CaveShelf.openRecord({ drawing: drawing });
        return drawing;
    }

    // The template pours itself into the new document (CaveTemplate's
    // post-new hook); the one-shot flag makes that true even where
    // somebody switched the default off.
    RSettings.setValue("CaveSurvey/TemplateOnNewOnce", true);
    var newAction = RGuiAction.getByScriptFile("scripts/File/NewFile/NewFile.js");
    if (isNull(newAction)) {
        EAction.handleUserWarning(qsTr("Could not reach File > New."));
        return null;
    }
    newAction.slotTrigger();

    var saved = false;
    try {
        saved = new Save().save(drawing, "", false) !== false;
    } catch (e) {
        saved = false;
    }
    if (!saved) {
        EAction.handleUserWarning(qsTr("The drawing could not be saved " +
            "into %1. Use File > Save As.").arg(record.folder));
        return null;
    }

    CsCave.ensureProjectFolders(record.folder, true);
    CsShelf.register({ name: record.name, folder: record.folder,
        drawing: drawing });
    delete CaveShelf.cache[drawing];
    return drawing;
};

/**
 * Opens the cave and starts a trip in the notebook.
 *
 * Three states, one button. A cave with no drawing gets one made and
 * lands on A1 -- the entrance, by project convention. A drawing with no
 * survey yet also lands on A1. A drawing whose trips left an open end
 * lands on that station.
 *
 * The notebook owns the page from here: this fills in the tie-in and
 * the blank row under it, which is what a paper page looks like when a
 * trip starts, and nothing else.
 */
CaveShelf.startTrip = function(state) {
    var record = state.record;
    if (record === null || record === undefined) { return false; }

    if (state.needsDrawing === true) {
        if (CaveShelf.startDrawing(record) === null) { return false; }
    }
    else if (!CaveShelf.openRecord(record)) {
        return false;
    }

    var station = (state.station === undefined || state.station === "") ?
        "A1" : state.station;
    if (typeof SurveyNotebook === "undefined") { return true; }

    try {
        var dock = SurveyNotebook.ensureDock();
        dock.visible = true;
        if (SurveyNotebook.startTripAt(station) === true) {
            EAction.handleUserMessage(state.needsDrawing === true ?
                qsTr("%1 started. The notebook is open at %2.")
                    .arg(record.name).arg(station) :
                qsTr("New trip tied into %1.").arg(station));
        }
    } catch (e) {
        EAction.handleUserWarning(qsTr("The cave opened, but the Survey " +
            "Notebook did not: ") + e);
    }
    return true;
};

// The preview's box. Thumbnails are written at 512px on the long side,
// so this only ever scales down.
CaveShelf.THUMB_W = 150;
CaveShelf.THUMB_H = 110;

/**
 * Where this drawing's preview lives.
 *
 * In the cave's own images/ folder, beside the photographs -- the map's
 * picture is part of the project, travels with it, and is visible to
 * the whole survey group rather than sitting in one machine's cache.
 * The application's own cache path (an MD5 under the app cache
 * directory, which is where the stock recent-files thumbnail goes) is
 * the fallback for a drawing that has no cave folder at all.
 *
 * \return the path, or null when there is no picture yet.
 */
CaveShelf.thumbnailFor = function(drawing) {
    var path = CsShelf.clean(drawing);
    if (path === "") { return null; }

    var usable = function(candidate) {
        if (candidate === null || candidate === undefined) { return null; }
        try {
            var info = new QFileInfo(String(candidate));
            return (info.exists() && info.size() > 0) ? String(candidate) : null;
        } catch (e) {
            return null;
        }
    };

    var inProject = usable(CsCave.previewPathFor(path));
    if (inProject !== null) { return inProject; }

    try {
        return usable(RSettings.getThumbnailFilePath(path));
    } catch (eCache) {
        return null;
    }
};

/**
 * Puts the cave's picture in the label, or a word about why there
 * isn't one.
 *
 * A cave gets its picture the first time it is saved (or opened) since
 * thumbnails started being written -- so an old cave shows the note
 * until somebody opens it, which is honest and needs no bulk render
 * pass over everybody's drawings.
 */
CaveShelf.showThumbnail = function(label, record) {
    label.text = "";
    try {
        label.setPixmap(new QPixmap());
    } catch (eClear) {
    }
    if (record === null || record === undefined) { return; }

    var path = CaveShelf.thumbnailFor(record.drawing);
    if (path === null) {
        label.text = qsTr("no preview yet");
        return;
    }
    try {
        var pixmap = new QPixmap(path);
        if (pixmap.isNull()) {
            label.text = qsTr("no preview yet");
            return;
        }
        label.setPixmap(pixmap.scaled(CaveShelf.THUMB_W, CaveShelf.THUMB_H,
            Qt.KeepAspectRatio, Qt.SmoothTransformation));
    } catch (e) {
        label.text = qsTr("no preview yet");
    }
};

/**
 * Takes the picture for a cave that has just been opened, so a drawing
 * somebody only looks at still earns a preview -- saving is not the
 * only way to visit a cave.
 *
 * Queued: the view has to paint before there is anything to capture.
 */
CaveShelf.captureThumbnailSoon = function(drawing) {
    if (typeof QTimer === "undefined") { return; }
    var path = CsShelf.clean(drawing);
    if (path === "") { return; }
    try {
        var timer = new QTimer(RMainWindowQt.getMainWindow());
        timer.singleShot = true;
        timer.timeout.connect(function() {
            try {
                var di = EAction.getDocumentInterface();
                if (isNull(di) || !isFunction(di.updateThumbnail)) { return; }
                di.updateThumbnail();
                var image = di.getThumbnail();
                if (isNull(image) || image.isNull()) { return; }
                CsCave.writePreview(path, image);
            } catch (eShot) {
                // A preview is never worth an error message.
            }
        });
        timer.start(1200);
    } catch (e) {
    }
};

/**
 * Opens a folder in the desktop's own file manager.
 *
 * The shelf knows where every cave lives; making somebody navigate
 * there by hand to look at a scan or drop a PDF in is a small daily
 * tax for no reason.
 */
CaveShelf.reveal = function(folder) {
    var path = CsShelf.clean(folder);
    if (path === "" || !(new QFileInfo(path)).exists()) { return false; }
    try {
        return QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (e) {
        EAction.handleUserWarning(qsTr("Could not open ") + path);
        return false;
    }
};

/** What the drift flag says under the health line. */
CaveShelf.driftText = function(drift) {
    if (Object.prototype.toString.call(drift) !== "[object Array]" ||
            drift.length === 0) {
        return "";
    }
    var worst = drift[0];
    for (var i = 1; i < drift.length; i++) {
        if (Math.abs(drift[i].delta) > Math.abs(worst.delta)) {
            worst = drift[i];
        }
    }
    var off = Math.round(Math.abs(worst.delta) * 100) / 100;
    return "\n" + qsTr("Trip %1 was surveyed at %2° declination; IGRF says " +
        "%3° for that date here — %4° out.")
        .arg(worst.id)
        .arg(Math.round(worst.recorded * 100) / 100)
        .arg(Math.round(worst.igrf * 100) / 100)
        .arg(off);
};

/**
 * Registers every cave inside one folder -- a survey group's shared
 * folder, typically.
 *
 * This is the answer to the cost of an explicit registry, and it is
 * deliberately still a DECISION: one folder, chosen, scanned once, with
 * what was found shown before anything is written. What it is not is a
 * standing sweep of the drive at every startup, which is the thing that
 * makes a launcher slow on the machine with the most caves.
 *
 * \return how many caves were added.
 */
CaveShelf.addFolder = function(parent) {
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();

    var picked = CsFiles.directory(parent,
        qsTr("Pick a folder that holds caves"), start);
    if (isNull(picked) || String(picked) === "") { return 0; }
    var folder = String(picked).replace(/\\/g, "/").replace(/\/+$/, "");

    var subs = [];
    try {
        var dir = new QDir(folder);
        subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, QDir.Name);
    } catch (e) {
        return 0;
    }

    // The folder itself may BE a cave; a folder of caves is the other
    // case. Both are worth handling, because people point at both.
    var candidates = [];
    var self = CsShelf.recordFor(folder);
    if (self !== null && self.drawing !== "") { candidates.push(self); }
    for (var i = 0; i < subs.length; i++) {
        var sub = folder + "/" + String(subs[i]);
        var record = CsShelf.recordFor(sub);
        if (record === null) { continue; }
        // A folder with neither a drawing nor sketches is not a cave --
        // it is somebody's spreadsheets.
        var scans = CsCave.findSubfolder(sub, CsCave.SCANS);
        if (record.drawing === "" && scans === null) { continue; }
        candidates.push(record);
    }

    var known = CsShelf.list();
    var fresh = [];
    for (var c = 0; c < candidates.length; c++) {
        if (CsShelf.indexOfFolder(known, candidates[c].folder) === -1) {
            fresh.push(candidates[c]);
        }
    }

    if (fresh.length === 0) {
        CaveShelf.inform(parent,
            qsTr("Import Folder"),
            candidates.length === 0 ?
                qsTr("No caves in that folder: nothing there holds a drawing " +
                    "or a scans folder.") :
                qsTr("Every cave in that folder is already on the shelf."));
        return 0;
    }

    var lines = [];
    for (var f = 0; f < fresh.length && f < 20; f++) {
        lines.push("   " + fresh[f].name +
            (fresh[f].drawing === "" ? qsTr("  (no drawing yet)") : ""));
    }
    if (fresh.length > lines.length) {
        lines.push(qsTr("   ...and %1 more").arg(fresh.length - lines.length));
    }

    var answer = CaveShelf.confirm(parent,
        qsTr("Import Folder"),
        qsTr("Import these %1 caves onto the shelf?\n\n").arg(fresh.length) +
            lines.join("\n"));
    if (!answer) { return 0; }

    for (var a = 0; a < fresh.length; a++) {
        CsShelf.register(fresh[a]);
    }
    EAction.handleUserMessage(qsTr("%1 caves added to the shelf.")
        .arg(fresh.length));
    return fresh.length;
};

// ---------------------------------------------------------------------
// Asking things, on top of the shelf
//
// The shelf runs modal (exec), and a dialog raised from it went BEHIND
// it: the question was on screen, hidden, with the application refusing
// input until somebody found and answered it. The static convenience
// calls (QInputDialog.getText, QMessageBox.question) give no chance to
// intervene -- they build, show and block in one step -- so each one is
// built here as an instance instead, shown, raised, and only then run.
// ---------------------------------------------------------------------

/** show + raise + activate + exec, which is the whole point of these. */
CaveShelf.runOnTop = function(dialog) {
    try {
        dialog.show();
        dialog.raise();
        dialog.activateWindow();
    } catch (e) {
        // A build that refuses raise() still gets a working dialog.
    }
    return dialog.exec();
};

/** A typed answer, or null. */
CaveShelf.prompt = function(parent, title, label, preset) {
    var dialog = new QInputDialog(parent);
    dialog.windowTitle = title;
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setLabelText(label);
    dialog.setTextValue(preset === undefined || preset === null ? "" : preset);
    var answer = CaveShelf.runOnTop(dialog);
    var text = (answer === 0) ? null : String(dialog.textValue());
    destrDialog(dialog);
    return text;
};

/** One of a list, or null. */
CaveShelf.choose = function(parent, title, label, items) {
    var dialog = new QInputDialog(parent);
    dialog.windowTitle = title;
    dialog.setLabelText(label);
    dialog.setComboBoxItems(items);
    var answer = CaveShelf.runOnTop(dialog);
    var text = (answer === 0) ? null : String(dialog.textValue());
    destrDialog(dialog);
    return text;
};

/** True for yes. */
CaveShelf.confirm = function(parent, title, text) {
    // Static question(), parented to the main window: an instance box's
    // exec() code compared loosely (or not at all) confirms every answer,
    // including No. Working pattern: SurveyStats.js, CsLocationPick.js.
    var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
        title, text, QMessageBox.Yes | QMessageBox.No);
    return answer === QMessageBox.Yes;
};

/** Says something and waits for OK. */
CaveShelf.inform = function(parent, title, text) {
    var box = new QMessageBox(parent);
    box.windowTitle = title;
    box.setText(text);
    box.setStandardButtons(QMessageBox.Ok);
    CaveShelf.runOnTop(box);
    destrDialog(box);
};

/**
 * Imports a cave from a FILE: either a drawing that already exists, or
 * a survey file that becomes one.
 *
 * Pointing at survey data is how a cave joins the shelf when it has
 * never been in CaveCAD at all -- somebody hands over a Compass file
 * and there is no folder, no drawing and no project yet. So this makes
 * all three: the folder and its scans/PDF/images, a drawing on the NSS
 * template with the survey drawn into it, and the original data file
 * kept beside the drawing, because the file somebody handed over is
 * evidence and deleting it later should be a decision, not a side
 * effect.
 *
 * \return the record imported, or null.
 */
CaveShelf.importFile = function(parent) {
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();

    var filter = qsTr("Cave surveys, drawings and packages") +
        " (*.dat *.srv *.svx *.csv *.dxf *.dwg *.zip);;" +
        CsFormatRegistry.combinedFileFilter() +
        ";;" + qsTr("Drawings") + " (*.dxf *.dwg);;" +
        qsTr("Cave packages") + " (*.zip);;" +
        qsTr("Every file") + " (*)";

    var picked = CsFiles.openFile(parent,
        qsTr("Import a cave from a file"), start, filter);
    if (isNull(picked) || String(picked) === "") { return null; }
    var path = String(picked).replace(/\\/g, "/");

    var extension = CsShelf.extension(path);

    // A zip from Package Cave is a whole cave folder.
    if (extension === "zip") {
        return CaveShelf.importPackage(parent, path);
    }

    // A drawing is already a cave: its folder is the project.
    if (extension === "dxf" || extension === "dwg") {
        var folder = CsCave.folderOf(path);
        if (folder === null) { return null; }
        var existing = CsShelf.normalize({ name: CsCave.nameOf(path),
            folder: folder, drawing: path });
        CsShelf.register(existing);
        CaveShelf.offerProjectFolders(parent, folder);
        return existing;
    }

    return CaveShelf.importSurveyFile(parent, path);
};

/**
 * Unpacks a Package Cave zip (sanitized or FULL) into a cave folder and
 * puts it on the shelf.
 *
 * Unpacked into a hidden staging folder INSIDE the chosen parent, then
 * renamed into place: the parent is often a synced drive, and a rename
 * on one volume either happens or doesn't, where a copy across volumes
 * can stop halfway. Never lands on an existing cave -- a clash takes the
 * next free "(2)" name.
 *
 * \return the record imported, or null.
 */
CaveShelf.importPackage = function(parent, zipPath) {
    var title = qsTr("Import Cave");
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();
    var parentFolder = CsFiles.directory(parent,
        qsTr("Where should the cave in %1 live?")
            .arg(CsShelf.basename(zipPath)), start);
    if (parentFolder === "") { return null; }
    parentFolder = parentFolder.replace(/\\/g, "/").replace(/\/+$/, "");

    var staging = parentFolder + "/.cavecad-import-" + (new Date()).getTime();
    if (!(new QDir()).mkpath(staging)) {
        EAction.handleUserWarning(qsTr("Could not create ") + staging);
        return null;
    }
    var cleanup = function() {
        try { (new QDir(staging)).removeRecursively(); } catch (e) {}
    };

    var run = CsPackage.runCommand(
        CsPackage.unzipCommand(RS.getSystemId(), zipPath, staging), 300);
    if (!run.ok) {
        cleanup();
        QMessageBox.warning(parent, title,
            qsTr("Could not unpack %1:\n%2")
                .arg(CsShelf.basename(zipPath)).arg(run.error));
        return null;
    }

    var top = new QDir(staging);
    var rootName = CsPackage.packageRoot(
        top.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0),
        top.entryList([], QDir.Files | QDir.NoDotAndDotDot, 0));
    if (rootName === null) {
        cleanup();
        QMessageBox.warning(parent, title,
            qsTr("%1 is not a cave package: a package made by Package Cave " +
                "holds exactly one cave folder.").arg(CsShelf.basename(zipPath)));
        return null;
    }

    var inside = new QDir(staging + "/" + rootName);
    var dxfs = inside.entryList(["*.dxf", "*.DXF"], QDir.Files, QDir.Name);
    var drawingName = CsPackage.packageDrawing(rootName, dxfs);
    if (drawingName === null && dxfs.length > 1) {
        var picked = CaveShelf.choose(parent, title,
            qsTr("Which drawing is the cave?"), dxfs);
        drawingName = (picked === null || picked === "") ? null : String(picked);
    }
    if (drawingName === null) {
        cleanup();
        QMessageBox.warning(parent, title,
            qsTr("There is no drawing in %1.").arg(CsShelf.basename(zipPath)));
        return null;
    }

    var folder = CsPackage.freeFolder(parentFolder, rootName, function(p) {
        return (new QFileInfo(p)).exists();
    });
    if (folder === null ||
            !(new QDir()).rename(staging + "/" + rootName, folder)) {
        cleanup();
        EAction.handleUserWarning(qsTr("Could not move the unpacked cave to ") +
            folder);
        return null;
    }
    cleanup();

    var record = CsShelf.normalize({ name: CsCave.nameOf(folder + "/" + drawingName),
        folder: folder, drawing: folder + "/" + drawingName });
    CsShelf.register(record);
    CaveShelf.offerProjectFolders(parent, folder);
    EAction.handleUserMessage(qsTr("Imported %1 into %2")
        .arg(CsShelf.basename(zipPath)).arg(folder));
    var saved = CsShelf.find(folder);
    return saved === null ? record : saved;
};

/**
 * Reads a survey file, makes a cave project for it, and draws it.
 */
CaveShelf.importSurveyFile = function(parent, path) {
    // ---- read and parse ------------------------------------------------
    var file = new QFile(path);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        EAction.handleUserWarning(qsTr("Could not open ") + path);
        return null;
    }
    var content = new QTextStream(file).readAll();
    file.close();

    var format = CsFormatRegistry.detect(path, content);
    if (format === null) {
        var labels = [];
        for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            labels.push(CsFormatRegistry.FORMATS[i].label);
        }
        var choice = CaveShelf.choose(parent, qsTr("Import Cave"),
            qsTr("The format could not be detected — which is it?"), labels);
        if (choice === null || choice === "") { return null; }
        for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
            if (CsFormatRegistry.FORMATS[i].label === String(choice)) {
                format = CsFormatRegistry.FORMATS[i];
            }
        }
        if (format === null) { return null; }
    }

    var survey;
    try {
        survey = format.parse(content, CsFormatRegistry.optionsFor(path));
    } catch (eParse) {
        EAction.handleUserWarning(qsTr("Could not read this as %1: ")
            .arg(format.label) + eParse);
        return null;
    }
    if (survey === null || survey === undefined ||
            survey.shots.length === 0) {
        EAction.handleUserWarning(qsTr("No shots were read from this file " +
            "(tried %1).").arg(format.label));
        return null;
    }

    // ---- name it ---------------------------------------------------------
    var suggested = CsShelf.clean(survey.caveName);
    if (suggested === "") { suggested = CsShelf.stem(path); }

    var typed = CaveShelf.prompt(parent, qsTr("Import Cave"),
        qsTr("%1 shots read. What is this cave called?")
            .arg(survey.shots.length), suggested);
    if (typed === null) { return null; }
    var name = CsPackage.safeName(typed);
    if (name === "") { return null; }

    // ---- where it lives --------------------------------------------------
    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();
    var parentFolder = CsFiles.directory(parent,
        qsTr("Where should %1 live?").arg(name), start);
    if (isNull(parentFolder) || String(parentFolder) === "") { return null; }
    parentFolder = String(parentFolder).replace(/\\/g, "/")
        .replace(/\/+$/, "");

    var folder = parentFolder + "/" + name;
    if (!(new QDir(folder)).exists() && !(new QDir()).mkpath(folder)) {
        EAction.handleUserWarning(qsTr("Could not create ") + folder);
        return null;
    }
    CsCave.ensureProjectFolders(folder, true);

    // ---- the drawing, from the template ----------------------------------
    var record = CsShelf.normalize({ name: name, folder: folder,
        drawing: "" });
    var drawing = CaveShelf.startDrawing(record);
    if (drawing === null) { return null; }

    // ---- draw the survey into it ------------------------------------------
    var drawn = CaveShelf.drawImportedSurvey(survey);
    if (!drawn) {
        EAction.handleUserWarning(qsTr("%1 was created, but the survey " +
            "could not be drawn into it. Import Cave Survey can try again " +
            "into the open drawing.").arg(name));
    }

    // ---- keep the file somebody handed over ------------------------------
    try {
        var kept = folder + "/" + CsShelf.basename(path);
        if (!(new QFileInfo(kept)).exists()) {
            (new QFile(path)).copy(kept);
        }
    } catch (eKeep) {
    }

    var saved = CsShelf.find(folder);
    EAction.handleUserMessage(qsTr("%1 imported: %2 shots from %3.")
        .arg(name).arg(survey.shots.length).arg(CsShelf.basename(path)));
    return saved === null ? record : saved;
};

/**
 * Draws a parsed survey into the drawing that is open now, in the
 * drawing's own unit, and saves it.
 *
 * \return true if the survey was drawn.
 */
CaveShelf.drawImportedSurvey = function(survey) {
    try {
        var doc = EAction.getDocument();
        var di = EAction.getDocumentInterface();
        if (isNull(doc) || isNull(di)) { return false; }

        // The file's unit is whatever the surveyors used; the drawing's
        // is whatever the template is in. Rescale before drawing, or the
        // cave comes out the right shape at the wrong size.
        CsUnits.convertSurvey(survey, CsUnits.fromDrawingUnit(doc.getUnit(), RS));

        var resolved = CsAdjust.resolveAndAdjust(survey, {},
            CsAdjust.currentOptions());
        CsDraw.survey(survey, resolved, undefined, undefined, 0,
            { doc: doc, di: di });

        try {
            di.autoZoom();
        } catch (eZoom) {
        }
        new Save().save(EAction.getDocument().getFileName(), "", false);
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Offers to create the folders a cave project keeps, when they are
 * missing. Asks rather than acting: this is somebody else's folder --
 * possibly a shared one -- and the group may keep sketches somewhere
 * this convention knows nothing about.
 */
CaveShelf.offerProjectFolders = function(parent, folder) {
    var missing = [];
    for (var i = 0; i < CsCave.SUBFOLDERS.length; i++) {
        if (CsCave.findSubfolder(folder, CsCave.SUBFOLDERS[i]) === null) {
            missing.push(CsCave.SUBFOLDERS[i]);
        }
    }
    if (missing.length === 0) { return; }

    var answer = CaveShelf.confirm(parent, qsTr("Cave Project Folders"),
        qsTr("This cave has no %1 folder. Create it?\n\n" +
            "scans/ holds the hand sketches (Draw > Image opens there); " +
            "PDF/ holds the maps you plot, and is what Package Cave " +
            "Project collects; images/ holds photographs.")
            .arg(missing.join("/ and no ")));
    if (answer) {
        CsCave.ensureProjectFolders(folder, true);
    }
};

/**
 * Starts a cave: a folder named after it, the project folders inside,
 * a drawing on the NSS template, and a shelf entry.
 *
 * The drawing is SAVED before the user sees it, which is the point --
 * a cave that exists only as an unsaved window is a cave that has no
 * folder, no scans/, no PDF/ and no place on the shelf.
 *
 * \return the record created, or null.
 */
CaveShelf.newCave = function(parent) {
    var typed = CaveShelf.prompt(parent, qsTr("New Cave"),
        qsTr("Cave name, the way people say it:"), "");
    if (typed === null) { return null; }
    var name = typed.replace(/^\s+|\s+$/g, "");
    if (name === "") { return null; }

    // A cave name is a folder name and a file name. Only the characters
    // that cannot BE either are removed -- spaces, commas and
    // apostrophes are how caves are actually named. Same sanitizer the
    // drawing's own file name uses, so the folder and the file inside
    // it can never disagree.
    var safe = CsPackage.safeName(name);
    if (safe === "") {
        EAction.handleUserWarning(qsTr("That name has nothing in it a " +
            "folder can be called."));
        return null;
    }

    var roots = CsCave.driveRoots();
    var start = roots.length > 0 ? roots[0] : QDir.homePath();
    var parentFolder = CsFiles.directory(parent,
        qsTr("Where should %1 live?").arg(safe), start);
    if (isNull(parentFolder) || String(parentFolder) === "") { return null; }
    parentFolder = String(parentFolder).replace(/\\/g, "/").replace(/\/+$/, "");

    var folder = parentFolder + "/" + safe;
    if ((new QDir(folder)).exists()) {
        if (!CaveShelf.confirm(parent, qsTr("Folder Exists"),
                qsTr("%1 already exists. Put the new drawing in it?")
                    .arg(folder))) {
            return null;
        }
    }
    else if (!(new QDir()).mkpath(folder)) {
        EAction.handleUserWarning(qsTr("Could not create %1").arg(folder));
        return null;
    }

    CsCave.ensureProjectFolders(folder, true);

    var drawing = folder + "/" + safe + ".dxf";
    if ((new QFileInfo(drawing)).exists()) {
        if (!CaveShelf.confirm(parent, qsTr("Drawing Exists"),
                qsTr("%1 already exists. Open it instead of starting a " +
                    "new one?").arg(drawing))) {
            return null;
        }
        var existing = CsShelf.normalize({ name: name, folder: folder,
            drawing: drawing });
        CsShelf.register(existing);
        CaveShelf.openRecord(existing);
        return existing;
    }

    var record = CsShelf.normalize({ name: name, folder: folder,
        drawing: "" });
    if (CaveShelf.startDrawing(record) === null) { return null; }

    EAction.handleUserMessage(qsTr("%1 started: %2").arg(name).arg(drawing));
    return CsShelf.find(folder);
};
