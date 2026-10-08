// TeachingCave.js
//
// QCAD add-on tool: hand a student a real cave they can safely ruin,
// and put it back the way it was when they have.
//
//   Cave Survey > Teaching Cave   (or type "teach")
//
// TWO THINGS, in one dialog, because they are one workflow seen from
// two ends:
//
//   Reset       throw away the teaching copy and lay down a fresh one
//               from the pristine master. What a student does between
//               lessons, or an instructor does between classes.
//   Set up      make that master, once, from a real cave: sanitized,
//               so the copy carries the cave's shape and not its
//               location.
//
// See Core/CsTeach.js for the three folders and why they are three.
//
// THE ORIGINAL IS NEVER WRITTEN TO. It is opened once, read, and the
// sanitized result is written somewhere else. A student never learns
// its path and cannot reach it from here.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function TeachingCave(guiAction) {
    EAction.call(this, guiAction);
}

TeachingCave.prototype = new EAction();

/** Does this path exist as a folder? */
TeachingCave.folderExists = function(path) {
    try {
        return (new QDir(path)).exists();
    } catch (e) {
        return false;
    }
};

TeachingCave.fileExists = function(path) {
    try {
        return (new QFileInfo(path)).exists();
    } catch (e) {
        return false;
    }
};

/** Makes a folder and everything above it. */
TeachingCave.makeFolder = function(path) {
    try {
        return (new QDir("/")).mkpath(path);
    } catch (e) {
        return false;
    }
};

/**
 * Deletes a folder and everything under it.
 *
 * ONLY EVER CALLED ON THE WORKING COPY, and CsTeach.isTeaching is
 * checked by the caller before it is: this function is a recursive
 * delete, and the whole safety of the tool is that it can only ever be
 * aimed inside the teaching folder.
 */
TeachingCave.removeFolder = function(path) {
    try {
        return (new QDir(path)).removeRecursively();
    } catch (e) {
        return false;
    }
};

/** Copies one file, replacing whatever is there. */
TeachingCave.copyFile = function(from, to) {
    try {
        if (TeachingCave.fileExists(to)) {
            (new QFile(to)).remove();
        }
        return (new QFile(from)).copy(to);
    } catch (e) {
        return false;
    }
};

/** Copies a folder's contents, one level deep plus the cave's own
 *  subfolders. A cave project is a drawing plus scans/, PDF/, images/
 *  and backup/ -- see CsCave.SUBFOLDERS. */
TeachingCave.copyTree = function(from, to) {
    var copied = 0;
    TeachingCave.makeFolder(to);
    var dir;
    try {
        dir = new QDir(from);
    } catch (eDir) {
        return 0;
    }
    var files = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, 0);
    for (var i = 0; i < files.length; i++) {
        if (TeachingCave.copyFile(from + "/" + files[i],
                to + "/" + files[i])) {
            copied++;
        }
    }
    var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
    for (var s = 0; s < subs.length; s++) {
        copied += TeachingCave.copyTree(from + "/" + subs[s],
            to + "/" + subs[s]);
    }
    return copied;
};

/**
 * Every file under a folder, keyed by its basename.
 *
 * Used to re-point the drawing's scan images at the copies that
 * travelled with it. A basename is enough: the scans folder of one cave
 * is not a place where two different pages share a name, and a wrong
 * match would show the student the wrong sketch rather than leaking
 * anything.
 */
TeachingCave.indexByName = function(folder) {
    var out = {};
    var dir;
    try {
        dir = new QDir(folder);
    } catch (eDir) {
        return out;
    }
    if (!dir.exists()) {
        return out;
    }
    var files = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, 0);
    for (var i = 0; i < files.length; i++) {
        out[String(files[i])] = folder + "/" + files[i];
    }
    var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
    for (var s = 0; s < subs.length; s++) {
        var deeper = TeachingCave.indexByName(folder + "/" + subs[s]);
        for (var name in deeper) {
            if (deeper.hasOwnProperty(name) && isNull(out[name])) {
                out[name] = deeper[name];
            }
        }
    }
    return out;
};

/**
 * Points the drawing's scan images at the copies inside the master, and
 * removes any it cannot find.
 *
 * WHY THIS IS NOT OPTIONAL. A cave drawing's aligned scans are stored
 * as ABSOLUTE paths, and on Truitt Cave every one of the 44 of them
 * read
 *
 *   /Users/<name>/Library/CloudStorage/GoogleDrive-<email>/.../Truitt
 *   Cave/scans/Trimmed/...
 *
 * Left alone that is two faults at once. A student's copy shows no
 * sketches at all, because that folder is not on their machine -- or,
 * worse, it is, and the "teaching" drawing is quietly reading the
 * surveyor's real cave folder. And the path itself travels: a name and
 * an email address, in a file whose whole purpose is being handed to
 * strangers.
 *
 * An image whose page did not travel is DELETED rather than left
 * pointing at the original. A missing sketch is a gap; a sketch that
 * still points into somebody's Drive is a leak.
 *
 * \return {repointed, dropped, ok, error}
 */
TeachingCave.repointScans = function(drawingPath, scansFolder) {
    var out = { repointed: 0, dropped: 0, ok: false, error: "" };
    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    try {
        if (di.importFile(drawingPath, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            out.error = "Could not reopen the sanitized drawing.";
            return out;
        }
        var doc = di.getDocument();
        var index = TeachingCave.indexByName(scansFolder);

        // BLOCKS TOO -- queryAllEntities(false, TRUE). A scan traced
        // inside a cross-section block is not in model space, and the
        // first live run on Truitt Cave left exactly one image still
        // pointing into the surveyor's Drive because of it: 44 images
        // in the drawing, 42 re-pointed, 2 dropped, and one nobody
        // walked at all.
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) {
                continue;
            }
            var was = String(e.getFileName());
            var slash = was.lastIndexOf("/");
            var base = slash < 0 ? was : was.substring(slash + 1);
            var now = index[base];
            var op;
            if (isNull(now)) {
                op = new RDeleteObjectsOperation();
                op.deleteObject(e);
                di.applyOperation(op);
                out.dropped++;
                continue;
            }
            e.setFileName(now);
            op = new RModifyObjectsOperation();
            op.addObject(e, false);
            di.applyOperation(op);
            out.repointed++;
        }

        out.ok = di.exportFile(drawingPath, CsSanitize.dxfFilter());
        if (!out.ok) {
            out.error = "Could not rewrite the drawing with its own " +
                "scan paths.";
        }
    } catch (eRepoint) {
        out.error = "Re-pointing the scans failed: " + eRepoint;
    } finally {
        try {
            if (typeof destr === "function") {
                destr(di);
            }
        } catch (eDestroy) {
        }
    }
    return out;
};

/**
 * Builds the pristine master from a real cave.
 *
 * The DRAWING goes through CsSanitize -- location out, imagery out --
 * and everything else in the cave folder is copied as it is, EXCEPT
 * the folders that carry a location of their own.
 *
 * \return {ok, error, drawing, copied, stripped}
 */
TeachingCave.buildMaster = function(record, caveRoot, caveName) {
    var master = CsTeach.masterFor(caveRoot, caveName);
    var out = { ok: false, error: "", drawing: "", copied: 0,
        stripped: 0, repointed: 0, dropped: 0 };

    if (!TeachingCave.makeFolder(master)) {
        out.error = "Could not make " + master + ".";
        return out;
    }

    // SCANS TRAVEL FIRST, before the drawing is re-pointed at them:
    // tracing a real sketch is most of what a student is here to learn,
    // and a field sketch is the one thing an invented cave can never
    // have.
    //
    // PDF/ AND images/ DO NOT. A plotted map carries a title block with
    // a location typed into it by a cartographer, and a photograph
    // carries wherever the camera thought it was. Neither is something
    // this tool can strip, so neither is something it copies.
    var folder = CsShelf.clean(record.folder);
    var scans = folder + "/" + CsCave.SCANS;
    var masterScans = master + "/" + CsCave.SCANS;
    if (TeachingCave.folderExists(scans)) {
        out.copied = TeachingCave.copyTree(scans, masterScans);
    }
    for (var i = 0; i < CsCave.SUBFOLDERS.length; i++) {
        TeachingCave.makeFolder(master + "/" + CsCave.SUBFOLDERS[i]);
    }

    var target = CsTeach.drawingIn(master, caveName);
    var result = CsSanitize.writeCopy(record.drawing, target);
    if (result.ok !== true) {
        // A master that could not be sanitized is not written at all --
        // the same refusal CsSanitize makes for a package, for the same
        // reason: the promise is a negative one.
        out.error = result.error;
        return out;
    }
    out.drawing = target;
    out.stripped = result.stripped;

    var pointed = TeachingCave.repointScans(target, masterScans);
    if (pointed.ok !== true) {
        out.error = pointed.error;
        return out;
    }
    out.repointed = pointed.repointed;
    out.dropped = pointed.dropped;

    out.ok = true;
    return out;
};

/**
 * Lays a fresh working copy down from the master.
 *
 * \return {ok, error, drawing, copied}
 */
TeachingCave.reset = function(caveRoot, caveName) {
    var master = CsTeach.masterFor(caveRoot, caveName);
    var working = CsTeach.workingFor(caveRoot, caveName);
    var out = { ok: false, error: "", drawing: "", copied: 0,
        repointed: 0, dropped: 0 };

    if (!TeachingCave.folderExists(master)) {
        out.error = "There is no pristine copy at " + master + ".";
        return out;
    }
    // THE GUARD ON A RECURSIVE DELETE. Everything else in this tool is
    // reversible; this is not. It can only ever be aimed inside the
    // teaching folder, and if the arithmetic that says so is ever
    // wrong, the tool refuses rather than deleting.
    if (!CsTeach.isTeaching(caveRoot, working)) {
        out.error = "Refusing to replace " + working + ": it is not " +
            "inside the teaching folder.";
        return out;
    }
    if (TeachingCave.folderExists(working)) {
        TeachingCave.removeFolder(working);
    }
    out.copied = TeachingCave.copyTree(master, working);
    out.drawing = CsTeach.drawingIn(working, caveName);
    out.ok = TeachingCave.fileExists(out.drawing);
    if (!out.ok) {
        out.error = "The copy did not arrive at " + out.drawing + ".";
        return out;
    }
    // AND POINT ITS SCANS AT ITSELF. A byte copy of the master is a
    // drawing whose scans still read out of the MASTER folder -- not a
    // leak, but a student's copy that breaks the moment the master is
    // moved, and one whose sketches are shared with every other copy.
    // The working copy has its own scans; it should be reading them.
    var pointed = TeachingCave.repointScans(out.drawing,
        working + "/" + CsCave.SCANS);
    out.repointed = pointed.repointed;
    out.dropped = pointed.dropped;
    if (pointed.ok !== true) {
        out.ok = false;
        out.error = pointed.error;
    }
    return out;
};

/** Puts the working copy on the shelf, so it opens like any cave. */
TeachingCave.shelve = function(caveRoot, caveName) {
    try {
        var record = CsShelf.newRecord();
        record.folder = CsTeach.workingFor(caveRoot, caveName);
        record.name = caveName + " (teaching)";
        record.drawing = CsTeach.drawingIn(record.folder, caveName);
        return CsShelf.register(record);
    } catch (e) {
        return false;
    }
};

function teachingCaveRun() {
    var caveRoot = CsTeach.caveRootFor(QDir.homePath());
    var setting = "CaveSurvey/TeachingCave";
    var caveName = "";
    try {
        caveName = String(RSettings.getStringValue(setting, ""));
    } catch (eName) {
        caveName = "";
    }

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Teaching Cave");
    var layout = new QVBoxLayout();
    var blurb = new QLabel(qsTr(
        "A real cave a student can safely ruin. The copy they open " +
        "carries the cave's shape, its trips and its sketches -- and " +
        "not its location."));
    blurb.wordWrap = true;
    layout.addWidget(blurb, 0, 0);

    var masterExists = caveName !== "" &&
        TeachingCave.folderExists(CsTeach.masterFor(caveRoot, caveName));
    var workingExists = caveName !== "" &&
        TeachingCave.folderExists(CsTeach.workingFor(caveRoot, caveName));

    var resetButton = new QRadioButton(masterExists ?
        qsTr("Reset the teaching copy of %1").arg(caveName) :
        qsTr("Reset the teaching copy (no cave set up yet)"));
    var setupButton = new QRadioButton(masterExists ?
        qsTr("Set up a different cave, or refresh this one") :
        qsTr("Set up the teaching cave from a real cave"));
    resetButton.enabled = masterExists;
    resetButton.checked = masterExists;
    setupButton.checked = !masterExists;
    layout.addWidget(resetButton, 0, 0);
    layout.addWidget(setupButton, 0, 0);

    var state = new QLabel(masterExists ?
        qsTr("Pristine copy: %1").arg(CsTeach.masterFor(caveRoot, caveName)) +
            (workingExists ?
                qsTr("\nA teaching copy exists and will be replaced.") :
                qsTr("\nNo teaching copy yet; one will be created.")) :
        qsTr("Nothing is set up yet. Setting up takes a real cave, " +
            "removes its location, and keeps the result as the copy " +
            "every reset goes back to."));
    state.wordWrap = true;
    layout.addWidget(state, 0, 0);

    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok |
        QDialogButtonBox.Cancel);
    // CLOSURES, NOT SLOT NAMES -- see RepairDrawing.js.
    buttons.accepted.connect(function() { dlg.accept(); });
    buttons.rejected.connect(function() { dlg.reject(); });
    layout.addWidget(buttons, 0, 0);
    dlg.setLayout(layout);

    if (dlg.exec() !== QDialog.Accepted) {
        return;
    }

    if (setupButton.checked === true) {
        var record = PackageCave.chooseCave(getMainWindow());
        if (isNull(record)) {
            return;
        }
        var pickedName = CsShelf.clean(record.name);
        if (pickedName === "") {
            pickedName = CsCave.nameOf(record.drawing);
        }
        var plan = CsTeach.planMaster({
            sourceDrawing: record.drawing,
            caveName: pickedName,
            masterExists: TeachingCave.folderExists(
                CsTeach.masterFor(caveRoot, pickedName)),
            sourceIsTeaching: CsTeach.isTeaching(caveRoot, record.folder)
        });
        if (plan.can !== true) {
            CsTell.warn("Teaching Cave: " + plan.reason);
            return;
        }
        if (plan.warning !== "" &&
                QMessageBox.question(getMainWindow(), "Teaching Cave",
                    plan.warning + "\n\nGo ahead?",
                    QMessageBox.Yes | QMessageBox.No) !== QMessageBox.Yes) {
            return;
        }
        var built = TeachingCave.buildMaster(record, caveRoot, pickedName);
        if (built.ok !== true) {
            CsTell.warn("Teaching Cave: " + built.error);
            return;
        }
        try {
            RSettings.setValue(setting, pickedName);
        } catch (eSet) {
        }
        caveName = pickedName;
        EAction.handleUserMessage("Teaching Cave: " + caveName +
            " is ready to teach from. The location was removed from " +
            built.stripped + " station" +
            (built.stripped === 1 ? "" : "s") + ", " + built.copied +
            " sketch page" + (built.copied === 1 ? "" : "s") +
            " came along, and " + built.repointed + " scan" +
            (built.repointed === 1 ? "" : "s") + " now read from the " +
            "teaching folder rather than from yours" +
            (built.dropped > 0 ? (" (" + built.dropped +
                " whose page did not travel were removed)") : "") +
            ". Run this again to hand a student a copy.");
        return;
    }

    var resetPlan = CsTeach.planReset({
        masterExists: masterExists, workingExists: workingExists,
        caveName: caveName
    });
    if (resetPlan.can !== true) {
        CsTell.warn("Teaching Cave: " + resetPlan.reason);
        return;
    }
    if (resetPlan.warning !== "" &&
            QMessageBox.question(getMainWindow(), "Teaching Cave",
                resetPlan.warning + "\n\nReset it?",
                QMessageBox.Yes | QMessageBox.No) !== QMessageBox.Yes) {
        return;
    }
    var done = TeachingCave.reset(caveRoot, caveName);
    if (done.ok !== true) {
        CsTell.warn("Teaching Cave: " + done.error);
        return;
    }
    TeachingCave.shelve(caveRoot, caveName);
    EAction.handleUserMessage(CsTeach.doneText(caveName,
        CsTeach.workingFor(caveRoot, caveName), resetPlan.verb));
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

TeachingCave.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    teachingCaveRun();
    this.terminate();
};

TeachingCave.init = function(basePath) {
    var action = new RGuiAction(qsTr("Teaching Cave"),
        RMainWindowQt.getMainWindow());
    // NO DOCUMENT NEEDED: a student opens this BEFORE they have a
    // drawing, which is the whole point of it.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/TeachingCave.js");
    action.setIcon(basePath + "/TeachingCave.svg");
    action.setStatusTip(qsTr("Hand out a real cave a student can " +
        "safely ruin, and put it back afterwards"));
    action.setDefaultCommands(["teachingcave", "teach"]);
    // Stage 1, after the launcher and the blank sheet: this is a third
    // door into a cave project, and the one a student uses first.
    action.setGroupSortOrder(450);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
