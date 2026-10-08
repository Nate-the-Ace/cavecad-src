/**
 * ResetDrawing.js
 *
 * Empty a cave drawing completely, without touching the cave's folder.
 *
 *   Cave Survey > Reset Drawing   (or type "rd")
 *
 * For teaching a class the same starting point twice, and for testing a
 * tool against a project that does not have to be rebuilt by hand every
 * run. Nothing in the drawing survives -- survey, linework, symbols,
 * notes, sections, the placed sketch scans and the aerial basemap, and
 * the georeference with them -- because every one of those is put there
 * by a tool a student is here to learn. The scans and the imagery
 * themselves stay on disk, so all of it can be done again.
 *
 * The rules -- what a refusal says, what the counts mean -- are in
 * Core/CsReset.js and are tested under node; this file is the walk, the
 * dialog and the delete.
 *
 * ORDER IS THE SAFETY PROPERTY, not the dialog. The backup is written
 * BEFORE the confirmation is even shown, and a backup that does not
 * write stops the tool. A typed cave name is the second guard, not the
 * first.
 */
include("scripts/EAction.js");
// simple.js, and NOT because anything here is simple: getDocument() and
// getDocumentInterface() are defined in it and nowhere else. Without
// this the tool dies on its very first line with "ReferenceError:
// getDocument is not defined" -- in the action's own script context
// only, so the menu entry appears, is enabled, and does NOTHING when
// clicked. The engine harness cannot catch it: tests/reset_drawing_run.js
// defines both functions by hand to point at its fixture document, which
// is exactly what hides the missing include.
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function ResetDrawing(guiAction) {
    EAction.call(this, guiAction);
}

ResetDrawing.prototype = new EAction();

ResetDrawing.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    resetDrawingRun();
    this.terminate();
};

/** One entity's facts, in the shape CsReset's pure half reads. The
 *  entity kind is read only so that images can be COUNTED apart -- it
 *  no longer decides anything's fate. */
ResetDrawing.infoFor = function(entity) {
    var isImage = false;
    try {
        isImage = (typeof isImageEntity === "function") &&
            isImageEntity(entity) === true;
    } catch (e) {
        isImage = false;
    }
    var layer = "";
    try {
        layer = String(entity.getLayerName());
    } catch (eL) {
        layer = "";
    }
    return { isImage: isImage, layer: layer };
};

/**
 * Walks model space and counts what is about to go.
 *
 * Model space only (allBlocks false). A symbol's BLOCK DEFINITION is
 * not drawing content -- the inserts that reference it are, and those
 * are in model space. Reaching into the definitions would empty the
 * symbol library the palette expects to find.
 *
 * \return {ids: [deleted ids], counts}
 */
ResetDrawing.classify = function(doc) {
    var ids = [];
    var kinds = [];
    var infos = [];
    var all = doc.queryAllEntities(false, false);
    for (var i = 0; i < all.length; i++) {
        var e = doc.queryEntityDirect(all[i]);
        if (isNull(e)) {
            continue;
        }
        var info = ResetDrawing.infoFor(e);
        infos.push(info);
        if (!CsReset.keepsEntity(info)) {
            ids.push(all[i]);
            // Kept alongside the id, in the same order, so the delete can
            // say WHAT it is removing without walking the drawing twice.
            kinds.push(CsReset.countKind(info));
        }
    }
    return { ids: ids, kinds: kinds, counts: CsReset.tally(infos) };
};

/**
 * The progress window.
 *
 * A reset of a real cave takes several seconds -- the backup is a file
 * copy that may cross Google Drive, and the drawing is a thousand
 * entities and a layer table. Several seconds of a frozen window is
 * indistinguishable from a crash, and a caver who believes a tool has
 * crashed force-quits it, which is the one thing that could actually
 * cost them work here.
 *
 * NO CANCEL BUTTON. Stopping half way through leaves a drawing that is
 * neither the map it was nor the blank it was going to be, and the
 * recovery -- close without saving -- is the same either way. A button
 * that makes things worse is not a kindness.
 *
 * QProgressBar's minimum/maximum/value are READ-ONLY as properties in
 * this bridge (probed live, 2026-09-13): setMinimum/setMaximum/setValue
 * are the only way in, and the same goes for QProgressDialog's
 * setValue/setLabelText. Assigning to .value there fails silently, which
 * would leave the bar at zero for the whole run -- worse than no bar,
 * because a stuck bar says "hung" out loud.
 *
 * Every call is guarded and the whole thing degrades to nothing: a
 * progress window that cannot be built must never stop a reset that
 * can.
 */
ResetDrawing.progress = function() {
    var dlg = null;
    try {
        dlg = new QProgressDialog("", "", 0, 0, getMainWindow());
        dlg.setWindowTitle(qsTr("Reset Drawing"));
        dlg.setCancelButton(null);
        dlg.setAutoClose(false);
        dlg.setAutoReset(false);
        dlg.setMinimumDuration(0);
        dlg.setWindowModality(Qt.ApplicationModal);
        dlg.show();
        QCoreApplication.processEvents();
    } catch (e) {
        dlg = null;
    }
    var pump = function() {
        try {
            QCoreApplication.processEvents();
        } catch (eP) {
        }
    };
    return {
        /** A phase with no count to give: the bar runs busy. */
        say: function(text) {
            if (dlg === null) { return; }
            try {
                dlg.setMaximum(0);      // 0/0 is Qt's busy indicator
                dlg.setLabelText(text);
            } catch (eS) {
            }
            pump();
        },
        /** A phase that knows how far along it is. */
        step: function(text, done, total) {
            if (dlg === null) { return; }
            try {
                dlg.setMaximum(total);
                dlg.setValue(done);
                dlg.setLabelText(text);
            } catch (eT) {
            }
            pump();
        },
        hide: function() {
            if (dlg === null) { return; }
            try {
                dlg.hide();
            } catch (eH) {
            }
            pump();
        },
        show: function() {
            if (dlg === null) { return; }
            try {
                dlg.show();
            } catch (eSh) {
            }
            pump();
        },
        done: function() {
            if (dlg === null) { return; }
            try {
                dlg.close();
                dlg.deleteLater();
            } catch (eD) {
            }
            dlg = null;
            pump();
        }
    };
};

/**
 * Runs fn with EVERY layer editable -- neither off, frozen, nor locked
 * -- and puts each one back afterwards.
 *
 * LOCKED IS CLEARED HERE, which CsLayers.withLayersOn deliberately will
 * not do. That restraint is right for a tool writing into one layer: a
 * caver locked it to stop things changing. It is wrong for a reset,
 * because a locked layer does not refuse LOUDLY -- it refuses in
 * silence, and the drawing comes back looking emptied while whatever
 * was locked quietly survived. That exact hole is how a sanitized
 * package once shipped with the aerial photograph still in it.
 */
ResetDrawing.withEveryLayerEditable = function(doc, di, fn) {
    var restore = [];
    var op = null;
    try {
        var layerIds = doc.queryAllLayers();
        for (var i = 0; i < layerIds.length; i++) {
            var lay = doc.queryLayer(layerIds[i]);
            if (isNull(lay)) {
                continue;
            }
            var was = { name: String(lay.getName()), off: false,
                frozen: false, locked: false };
            try {
                if (lay.isOff()) { lay.setOff(false); was.off = true; }
            } catch (eOff) {
            }
            try {
                if (lay.isFrozen()) { lay.setFrozen(false); was.frozen = true; }
            } catch (eFrozen) {
            }
            try {
                if (lay.isLocked()) { lay.setLocked(false); was.locked = true; }
            } catch (eLock) {
            }
            if (was.off || was.frozen || was.locked) {
                if (op === null) {
                    op = new RModifyObjectsOperation();
                }
                op.addObject(lay, false);
                restore.push(was);
            }
        }
    } catch (eWalk) {
    }
    if (op !== null) {
        try {
            di.applyOperation(op);
        } catch (eApply) {
            restore = [];   // nothing landed, nothing to put back
        }
    }

    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (eFn) {
        thrown = eFn;
        didThrow = true;
    }

    if (restore.length > 0) {
        try {
            var back = new RModifyObjectsOperation();
            var any = false;
            for (var r = 0; r < restore.length; r++) {
                var lay2 = doc.queryLayer(restore[r].name);
                if (isNull(lay2)) {
                    continue;
                }
                if (restore[r].off) { lay2.setOff(true); }
                if (restore[r].frozen) { lay2.setFrozen(true); }
                if (restore[r].locked) { lay2.setLocked(true); }
                back.addObject(lay2, false);
                any = true;
            }
            if (any) {
                di.applyOperation(back);
            }
        } catch (eBack) {
            // visibility is a nicety; the delete already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

// How often the progress window is told, in entities. Every entity
// would spend more time repainting than deleting; every thousand would
// look stuck on a cave this size.
ResetDrawing.REPORT_EVERY = 50;

/**
 * Deletes every id in ONE operation, saying what it is removing as it
 * goes.
 *
 * One operation, still, because that is one undo step: the recovery
 * story for a reset is a single Undo or a close without saving, and
 * three operations would make it three. The progress reporting happens
 * while the operation is BUILT, which is the part that walks the
 * drawing; the apply that follows is one call nothing can subdivide, so
 * it is announced rather than counted.
 *
 * \param kinds  same length as ids, from classify -- what each entity
 *               is, so the window can name it.
 * \return how many went.
 */
ResetDrawing.deleteAll = function(doc, di, ids, kinds, progress) {
    if (ids.length === 0) {
        return 0;
    }
    var del = new RDeleteObjectsOperation();
    var n = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntityDirect(ids[i]);
        if (!isNull(e)) {
            del.deleteObject(e);
            n++;
        }
        if (progress !== undefined && progress !== null &&
                (i % ResetDrawing.REPORT_EVERY) === 0) {
            var kind = (kinds === undefined || kinds === null) ?
                "" : kinds[i];
            progress.step(CsReset.phaseText(kind, i + 1, ids.length),
                i + 1, ids.length);
        }
    }
    if (progress !== undefined && progress !== null) {
        // The apply is one call: nothing to count, so say so plainly
        // rather than leaving a bar sitting at 99%.
        progress.say(qsTr("Applying the deletion..."));
    }
    di.applyOperation(del);
    return n;
};

/**
 * The cave's state that lives OUTSIDE the drawing, cleared with it.
 *
 * A drawing is not the whole of what a class carries forward. Three
 * pieces of per-cave state sit in application settings and in the
 * folder, and each one would hand the next student somebody else's
 * progress:
 *
 *   COMPLETE MARKS   which scanned pages have been finished with, kept
 *                    per cave under the scans folder's own path. A
 *                    student opening Sketch Scans would find the pages
 *                    already ticked off.
 *   THE LOCATION     the last coordinate declared anywhere. The anchor
 *                    itself died with the drawing, but this is what Set
 *                    Cave Location offers as its default, so the cave's
 *                    entrance would still be a keystroke away from a
 *                    drawing that is supposed to have no location yet.
 *   THE PREVIEW      images/<Cave> preview.png, the thumbnail the shelf
 *                    card shows. Left alone it is a picture of the map
 *                    that was just deleted, until the next save.
 *
 * THE LOCATION IS APPLICATION-WIDE, not this cave's alone: clearing it
 * means the next Set Cave Location in ANY drawing starts empty rather
 * than at wherever was last declared. That is the point -- the setting
 * exists to carry a coordinate between drawings, and carrying one out
 * of a reset is exactly what it must not do.
 *
 * NOT CLEARED: the shelf entry, so the cave stays one click away and
 * trips can be added to it straight afterwards; and Check Map's ignore
 * list, which was not asked for.
 *
 * Each piece is attempted independently and none can fail the reset:
 * the drawing is already empty by the time this runs, and a settings
 * write that will not land is not a reason to leave a caver looking at
 * a half-reported result.
 *
 * \return {marks, location, preview} -- what was actually cleared.
 */
ResetDrawing.clearOutside = function(docPath) {
    var out = { marks: false, location: false, preview: false };

    try {
        var folder = CsCave.folderOf(docPath);
        var scans = (folder === null) ? null :
            CsCave.findSubfolder(folder, CsCave.SCANS);
        if (scans !== null) {
            var raw = String(RSettings.getStringValue(
                CsScanTree.SETTING_BOOKMARKS, ""));
            var map = CsScanTree.parseCollapsed(raw);
            if (map.hasOwnProperty(scans)) {
                // recordCollapsed with an empty set and no valid rels
                // DELETES the cave's entry -- the generic per-cave
                // string-set store, used as it is rather than grown a
                // second copy that could drift (see CsScanTree.js).
                CsScanTree.recordCollapsed(map, scans, {}, []);
                RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
                    CsScanTree.serializeCollapsed(map));
                out.marks = true;
            }
        }
    } catch (eMarks) {
    }

    try {
        var hadLat = RSettings.getDoubleValue(
            CsLocationPick.SETTING_LAT, -999) > -999;
        RSettings.removeValue(CsLocationPick.SETTING_LAT);
        RSettings.removeValue(CsLocationPick.SETTING_LON);
        out.location = hadLat;
    } catch (eLoc) {
    }

    try {
        var preview = CsCave.previewPathFor(docPath);
        if (preview !== null && (new QFileInfo(preview)).exists()) {
            out.preview = (new QFile(preview)).remove();
        }
    } catch (ePrev) {
    }

    return out;
};

/** The cave folder this drawing sits in, or null when it is not in one.
 *  A cave project has a scans/ folder; that is what makes it one. */
ResetDrawing.caveFolderOf = function(path) {
    var folder = CsCave.folderOf(path);
    if (folder === null) {
        return null;
    }
    return CsCave.findSubfolder(folder, CsCave.SCANS) === null ? null : folder;
};

function resetDrawingRun() {
    var doc = getDocument();
    if (isNull(doc)) {
        CsTell.warn(qsTr("Reset Drawing: no active drawing document."));
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN -- it is rebuilt from the
    // cave's record every time Build Sheet is pressed.
    if (CsModelSpace.blocksWhole(doc, "Reset Drawing")) {
        return;
    }
    var di = getDocumentInterface();

    var path = "";
    try {
        path = String(doc.getFileName());
    } catch (eP) {
        path = "";
    }
    var caveFolder = ResetDrawing.caveFolderOf(path);
    var caveName = CsCave.nameOf(path);

    // The window goes up BEFORE the first slow thing, not after it.
    var progress = ResetDrawing.progress();
    progress.say(qsTr("Counting what is in the drawing..."));
    var split = ResetDrawing.classify(doc);

    var plan = CsReset.planReset({
        hasDocument: true,
        isSheet: false,
        docPath: path,
        inCaveFolder: caveFolder !== null,
        caveName: caveName,
        counts: split.counts
    });
    if (!plan.can) {
        progress.done();
        try {
            QMessageBox.information(getMainWindow(), qsTr("Reset Drawing"),
                plan.reason);
        } catch (eI) {
            EAction.handleUserMessage(plan.reason);
        }
        return;
    }

    // THE BACKUP COMES FIRST, and a backup that will not write stops
    // the tool. The dialog below is the second guard, never the only
    // one.
    var backupPath = "";
    // Usually the slowest step of the lot: a cave on a shared drive is a
    // megabyte of DXF going over the network before anything is asked.
    progress.say(qsTr("Copying the drawing to its backup folder..."));
    if (CsBackup.copyPrevious(path) !== true) {
        progress.done();
        var why = qsTr("Reset Drawing: could not write a copy of the " +
            "drawing into its backup folder, so nothing has been " +
            "changed. Check that ") + String(caveFolder) +
            qsTr("/backup can be written to.");
        try {
            QMessageBox.warning(getMainWindow(), qsTr("Reset Drawing"), why);
        } catch (eW) {
            EAction.handleUserMessage(why);
        }
        return;
    }
    try {
        var gens = CsBackup.generations(path);
        if (gens.length > 0) {
            backupPath = CsBackup.backupFolderFor(path) + "/" +
                gens[gens.length - 1];
        }
    } catch (eG) {
        backupPath = "";
    }

    // doc.isModified(), NOT di.isModified(): the document interface has
    // no such method in this build and answers a TypeError, which a
    // guarded read turns into "not modified" -- so the warning about
    // unsaved work would simply never appear. Probed live, 2026-09-13.
    var modified = false;
    try {
        modified = doc.isModified() === true;
    } catch (eM) {
        modified = false;
    }

    // Out of the way while a human reads and types.
    progress.hide();
    if (!ResetDrawing.confirm(caveName, split.counts, backupPath, modified)) {
        progress.done();
        return;
    }
    progress.show();

    // The georeference rides an entity and goes with it: nothing here
    // reads or re-commits it. That is deliberate -- declaring the cave's
    // location is one of the steps a class is here to practise, and a
    // location quietly surviving a reset is one the student never
    // learns to set.
    ResetDrawing.withEveryLayerEditable(doc, di, function() {
        ResetDrawing.deleteAll(doc, di, split.ids, split.kinds, progress);
    });
    // The layer table last, so the drawing a class opens carries the
    // current palette and every layer the template has, not whatever
    // the previous student left behind.
    progress.say(qsTr("Restoring the template's layers..."));
    CsRestyle.ensureAndApply(doc, di);

    // And the cave's state that is not in the drawing at all.
    progress.say(qsTr("Clearing this cave's marks, location and thumbnail..."));
    var cleared = ResetDrawing.clearOutside(path);

    progress.done();

    var done = CsReset.doneText({ counts: split.counts,
        backupPath: backupPath, cleared: cleared });
    try {
        QMessageBox.information(getMainWindow(), qsTr("Reset Drawing"),
            done.join("\n"));
    } catch (eD) {
        EAction.handleUserMessage(done[0]);
    }
}

/**
 * The confirmation: a counted summary, and a box the cave's name has to
 * be typed into before OK will do anything.
 *
 * A reset in front of a class must not be one stray Return away, which
 * is why the default button is Cancel and why OK starts disabled.
 */
ResetDrawing.buildConfirm = function(caveName, counts, backupPath,
        modified) {
    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Reset Drawing") +
        (caveName === null ? "" : " \u2014 " + caveName);
    var layout = new QVBoxLayout();
    var label = new QLabel(CsReset.summaryText({
        caveName: caveName, counts: counts, backupPath: backupPath,
        modified: modified
    }).join("\n"));
    label.wordWrap = true;
    layout.addWidget(label, 0, 0);

    var edit = new QLineEdit();
    edit.text = "";
    layout.addWidget(edit, 0, 0);

    // HAND-BUILT BUTTONS, not a QDialogButtonBox. The box's own
    // button(QDialogButtonBox.Ok) is how you would normally reach the
    // OK button to disable it, and nothing else in this add-on has ever
    // called it -- an unproven wrapper method here would fail the way
    // the GUI always fails in this bridge, silently and only in front
    // of a caver. Two QPushButtons are what CsLocationPick.askText
    // already uses and are known to work.
    var bar = new QHBoxLayout();
    var okBtn = new QPushButton(qsTr("Reset"));
    var cancelBtn = new QPushButton(qsTr("Cancel"));
    okBtn.enabled = false;      // the typed name is what enables it
    try {
        cancelBtn["default"] = true;    // a stray Return cancels
    } catch (eDef) {
    }
    bar.addStretch(1);
    bar.addWidget(okBtn, 0, 0);
    bar.addWidget(cancelBtn, 0, 0);
    layout.addLayout(bar, 0);
    dlg.setLayout(layout);

    edit.textChanged.connect(function(text) {
        try {
            okBtn.enabled = CsReset.matchesName(text, caveName);
        } catch (eT) {
        }
    });
    okBtn.clicked.connect(function() { dlg.accept(); });
    cancelBtn.clicked.connect(function() { dlg.reject(); });

    return { dlg: dlg, edit: edit, okBtn: okBtn, cancelBtn: cancelBtn };
};

/**
 * Shows it, and answers whether the reset was confirmed.
 *
 * Split from buildConfirm so the dialog can be BUILT and inspected
 * without exec()ing it -- a modal exec blocks the application until a
 * human dismisses it, which makes the one kind of failure this build
 * specialises in (a widget that silently does nothing) impossible to
 * check any other way.
 */
ResetDrawing.confirm = function(caveName, counts, backupPath, modified) {
    var built = ResetDrawing.buildConfirm(caveName, counts, backupPath,
        modified);
    var accepted = (built.dlg.exec() === QDialog.Accepted);
    // destroy() throws on every QDialog in this build; close and hand
    // it to Qt instead, guarded -- tearing down a dialog must never
    // cost the answer just given to it.
    try {
        built.dlg.close();
        built.dlg.deleteLater();
    } catch (eClose) {
    }
    return accepted;
};

ResetDrawing.init = function(basePath) {
    var action = new RGuiAction(qsTr("Reset Drawing"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ResetDrawing.js");
    action.setIcon(basePath + "/ResetDrawing.svg");
    action.setStatusTip(qsTr("Empty this drawing for a fresh start, " +
        "keeping its images and the cave's location"));
    // NOT "reset": that is QCAD's own command (scripts/Reset), and the
    // loser of a clash is whichever registers second.
    action.setDefaultCommands(["resetdrawing", "rd"]);
    // Beside Teaching Cave: both are doors onto a starting point rather
    // than tools that draw.
    action.setGroupSortOrder(450);
    action.setSortOrder(41);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
