// CsScanList.js -- the scans browser, as one list two panels share.
//
// Part of the Cave Survey Core library. GUI context (QTableWidget),
// like CsPanel and CsScanView; the model it draws is CsScanTree, which
// is pure and tested under node.
//
// WHY IT IS HERE. Sketch Scans grew a folder tree over a cave's
// scans/ -- collapsible, with a tick on every page a caver has
// finished with and on every trip whose pages are all done -- and the
// Survey Notebook needs the same thing for a different reason: the
// numbers being typed come off those pages, and "which have I done" is
// the same question in both places (Nathan, 2026-09-11: "not to have
// two different workflows for the same information").
//
// Two browsers over one folder would be two answers to that question.
// Worse, they would drift: a page marked done in one panel would still
// look undone in the other, and the mark is the only record of what a
// caver has actually worked through.
//
// A TREE ON A TABLE, because this bridge cannot construct a real
// QTreeWidget -- it is a wrapper-only stub, the same trap CaveShelf
// documents. So folders are rows that fold, drawn with an arrow and an
// indent, and CsScanTree decides what that means.

var CsScanList = {};

/** The tick. One character, so it costs a row nothing. */
CsScanList.COMPLETE = "✓";

/**
 * What the right-click menu calls marking a page finished with.
 *
 * HERE, so every panel showing this list says the same words. The
 * Survey Notebook's copy said "Finished with" while Sketch Scans said
 * "Mark Complete" -- the same act, the same setting, the same tick, and
 * two names for it, which is exactly the drift that sharing the list
 * was supposed to end (Nathan, 2026-09-11).
 */
CsScanList.MARK_COMPLETE = "Mark Complete";
CsScanList.MARK_INCOMPLETE = "Mark Incomplete";
CsScanList.MARK_FOLDER_COMPLETE = "Mark Folder Complete";
CsScanList.MARK_FOLDER_INCOMPLETE = "Mark Folder Incomplete";

// ---------------------------------------------------------------------
// The marks themselves. ONE STORE, READ-MODIFY-WRITE.
// ---------------------------------------------------------------------
//
// THE BUG THIS EXISTS FOR. Each panel kept its own copy of the
// completed set, loaded when it built its list, and wrote the WHOLE of
// that copy back on every toggle. So marking a page in one panel and
// then marking anything in the other undid the first: the second
// panel's copy predated the first panel's tick, and the whole-set
// write is what carried the stale answer to disk (Nathan, 2026-09-11:
// "'Mark Complete' is getting out of sync between the different
// pallets").
//
// Two fixes, and both are needed. A toggle now RE-READS the store,
// changes the one page it was asked about, and writes that back -- so
// a stale in-memory set cannot travel to disk at all. And a write
// ANNOUNCES itself, so the other panel repaints instead of sitting
// there showing a tick that is no longer true.

/** This cave's completed pages, freshly read. */
CsScanList.loadComplete = function(folder) {
    try {
        return CsScanTree.collapsedSetFor(CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, "")),
            folder);
    } catch (e) {
        return {};
    }
};

/**
 * Marks one page complete, or unmarks it, and answers the set as it
 * now stands on disk -- which is what the caller must draw from.
 *
 * `listedRels` is every FILE the calling panel listed: marks on pages
 * that are no longer there fall out rather than accreting forever.
 * Pass null when the caller has not listed the whole folder, and
 * nothing is pruned -- pruning against a partial list would delete
 * the marks on every page the caller happened not to show.
 */
CsScanList.toggleComplete = function(folder, rel, listedRels) {
    var set = CsScanList.loadComplete(folder);
    if (folder === null || folder === undefined || typeof rel !== "string" ||
            rel === "") {
        return set;
    }
    if (set[rel] === true) {
        delete set[rel];
    } else {
        set[rel] = true;
    }
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        var valid = listedRels;
        if (valid === null || valid === undefined) {
            // Nothing to prune against: keep every mark already stored
            // for this cave, plus whatever this call just changed.
            valid = [];
            for (var key in set) {
                if (set[key] === true) { valid.push(key); }
            }
        }
        CsScanTree.recordCollapsed(map, folder, set, valid);
        RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings forgets the mark; the panel still
        // shows what this call decided, for this session
    }
    CsScanList.announce(folder);
    return set;
};

/**
 * Panels that want to know when the marks change. ONE SLOT PER KEY, so
 * a panel that rebuilds its body replaces its own callback instead of
 * leaving the old one pointing at dead widgets.
 */
CsScanList.watchers = {};

CsScanList.watch = function(key, fn) {
    CsScanList.watchers[key] = fn;
};

/** Tells every panel but nobody in particular that this cave's marks
 *  moved. A watcher that throws is dropped: a panel whose widgets have
 *  gone must not stop the panel that is still on screen repainting. */
CsScanList.announce = function(folder) {
    for (var key in CsScanList.watchers) {
        try {
            CsScanList.watchers[key](folder);
        } catch (e) {
            delete CsScanList.watchers[key];
        }
    }
};

// ---------------------------------------------------------------------
// WHICH PAGE THE CAVER IS ON -- one answer, for every panel.
// ---------------------------------------------------------------------
//
// The same argument as the marks above, for the other half of the
// browser's state. Sketch Scans remembered the selected page per cave
// and the Notebook remembered nothing, so the two trees sat side by
// side showing different pages: tick a page off in one, look across,
// and the preview beside it was of something else. Worse when tracing,
// where the Notebook's pane is the page being READ and Sketch Scans'
// is the page being PLACED -- they are the same page, and keeping them
// in step by hand is a click every time either one moves.
//
// The selection is broadcast the way a mark is, and persisted the way
// a mark is, so it also survives the panel being closed and reopened.

/** Panels that want to know when the selected page changes. One slot
 *  per key, and the panel that CAUSED the change is not told about its
 *  own move -- it is already there, and selecting a row inside a
 *  selection handler is how a signal loop starts. */
CsScanList.selectionWatchers = {};

CsScanList.watchSelection = function(key, fn) {
    CsScanList.selectionWatchers[key] = fn;
};

// THE DRAWING'S OWN MEMORY of the page, as well as this machine's.
//
// The settings store above is per MACHINE: it survives closing the
// panel and reopening the cave, and it does not survive the cave being
// opened on the other laptop, or by the other person on the trip. The
// page a caver is working through is part of where the drawing HAS GOT
// TO, so it belongs in the drawing (Nathan, 2026-09-19) -- which is
// also what makes it come back after a restart with a clean settings
// file.
//
// A DOCUMENT VARIABLE, which RDxfExporter writes into QCAD_OBJECTS and
// the reader hands back. One short relative path, nowhere near the
// 1024-character line the DXF reader dies on, so unlike the Layer
// Manager's blob this needs no chunking.
//
// IT MARKS THE DRAWING MODIFIED, because that is what saving with the
// drawing means: browsing to another page is a change to the file, and
// a caver who closes without saving keeps the page the file already
// named. setVariable is a no-op when the value has not changed, so
// clicking the same page twice does not dirty anything.
CsScanList.SELECTED_VAR = "CaveSurveySelectedScan";

/** The page this DRAWING was left on, or null. */
CsScanList.selectedInDrawing = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    try {
        var got = doc.getVariable(CsScanList.SELECTED_VAR, "", false);
        var rel = (got === null || got === undefined) ? "" : String(got);
        return rel === "" ? null : rel;
    } catch (e) {
        return null;
    }
};

/** Writes it into the drawing. Silent when there is no drawing: the
 *  shelf browses a cave that is not open, and that is not an error. */
CsScanList.rememberInDrawing = function(doc, rel) {
    if (isNull(doc) || rel === null || rel === undefined || rel === "") {
        return;
    }
    try {
        doc.setVariable(CsScanList.SELECTED_VAR, String(rel));
    } catch (e) {
        // a build that will not take the variable still has the
        // per-machine memory below
    }
};

/**
 * The page to open a cave's tree on: what the DRAWING says, and only
 * then what this machine remembers.
 *
 * The drawing wins because it is the shared answer -- it came with the
 * file, from whoever last worked on it, which is the fact a second
 * caver opening the cave wants. The machine's memory is the fallback
 * for a drawing that has never recorded one.
 */
CsScanList.landingPage = function(doc, folder) {
    var inDrawing = CsScanList.selectedInDrawing(doc);
    if (inDrawing !== null) {
        return inDrawing;
    }
    return CsScanList.selectedIn(folder);
};

/** The page this cave was left on, or null. */
CsScanList.selectedIn = function(folder) {
    try {
        return CsScanTree.selectedRelFor(
            CsScanTree.parseCollapsed(
                RSettings.getStringValue(CsScanTree.SETTING_SELECTED, "")),
            folder);
    } catch (e) {
        return null;
    }
};

/**
 * Records the page a panel has just moved to and tells the others.
 *
 * \param folder the cave's scans folder
 * \param rel    the page now selected, relative to it
 * \param rows   the tree's rows, so a selection naming a page that is
 *               no longer there can be pruned (as the marks are)
 * \param fromKey the panel making the move, which is not told about it
 */
CsScanList.selectionMoved = function(folder, rel, rows, fromKey) {
    if (typeof folder !== "string" || folder === "") {
        return;
    }
    // Into the drawing first, so the page travels with the file.
    try {
        CsScanList.rememberInDrawing(EAction.getDocument(), rel);
    } catch (eDoc) {
        // no document, or a build with no EAction: the per-machine
        // memory below still holds
    }
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_SELECTED, ""));
        var valid = [];
        if (rows !== null && rows !== undefined) {
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].kind === "file") { valid.push(rows[i].rel); }
            }
        }
        CsScanTree.recordSelected(map, folder, rel, valid);
        RSettings.setValue(CsScanTree.SETTING_SELECTED,
            CsScanTree.serializeCollapsed(map));
    } catch (eSave) {
        // a bridge without RSettings forgets where we were; the panels
        // still agree for this session, which is the bigger half
    }
    for (var key in CsScanList.selectionWatchers) {
        if (key === fromKey) {
            continue;
        }
        try {
            CsScanList.selectionWatchers[key](folder, rel);
        } catch (eTell) {
            delete CsScanList.selectionWatchers[key];
        }
    }
};

// ---------------------------------------------------------------------
// WHAT IS IN A CAVE'S scans FOLDER -- one answer, for every panel.
// ---------------------------------------------------------------------
//
// THE BUG THIS EXISTS FOR (Nathan, 2026-09-14: "trimmed images need to
// not show up in the scan view tree"). Sketch Scans listed the folder
// and filtered its own derivatives out; the Survey Notebook listed the
// same folder with a bare CsCave.filesUnder and filtered nothing. So
// every crop Scan Trim had ever written showed up as a page in the
// Notebook's tree, beside the page it was cut from -- the same drift
// sharing the LIST was supposed to end, in the one part that was still
// copied rather than shared: the listing itself.
//
// Three kinds of file are in that folder and are NOT pages of field
// notes:
//   - the map's own generated preview (CsCave.isPreviewName)
//   - Scan Trim's crops, under Trimmed/ (CsScanTrim.isTrimPath)
//   - a PDF that has already been split into page images beside it
//     (CsScanPdf) -- the pages ARE the trip now, and listing the PDF
//     too offers every page twice, once as itself and once inside a
//     file that previews as page 1.
//
// A PDF that has NOT been split still lists, and must: it is the only
// way to right-click it and split it.

/** The file patterns a scans folder is read with -- whatever this
 *  build's QImageReader can open, PDFs included, and a fixed list when
 *  it cannot be asked. */
CsScanList.scanFilters = function() {
    var filters = [];
    try {
        var formats = QImageReader.supportedImageFormats();
        for (var i = 0; i < formats.length; i++) {
            filters.push("*." + String(formats[i]));
        }
    } catch (e) {
        filters = [];
    }
    if (filters.length === 0) {
        filters = ["*.png", "*.jpg", "*.jpeg", "*.tif", "*.tiff",
            "*.bmp", "*.gif", "*.pdf"];
    }
    return filters;
};

/**
 * Every page under a cave's scans folder, as relative paths, in the
 * order the tree draws them.
 *
 * EVERY PANEL CALLS THIS. A panel that lists the folder itself is a
 * panel that will show a different set from the one beside it.
 */
CsScanList.scanFiles = function(folder, maxDepth) {
    var rels = [];
    try {
        rels = CsCave.filesUnder(folder, CsScanList.scanFilters(),
            isNull(maxDepth) ? 4 : maxDepth);
    } catch (eList) {
        return [];
    }
    return CsScanTree.keepScans(rels, function(rel) {
        return CsScanPdf.pageCount(folder + "/" + rel);
    });
};

/** What the right-click menu calls splitting a PDF. HERE, like the
 *  mark labels above, so every panel showing this list says the same
 *  words. */
CsScanList.SPLIT_PDF = "Split into Pages";

/**
 * Adds "Split into Pages" to a scan row's context menu, when that row
 * is a PDF.
 *
 * SHARED, and for the reason the whole file is: the scans tree appears
 * in Sketch Scans and in the Survey Notebook, and a right-click that
 * can split a trip in one of them and not the other is the same drift
 * as two different words for the tick.
 *
 * Does nothing for a row that is not a PDF, so a caller can call it on
 * every file row without asking first.
 *
 * \param menu    the QMenu being built
 * \param folder  the cave's scans folder, absolute
 * \param rel     the row's path, relative to it
 * \param onDone  called after a successful split, to re-list the folder
 */
CsScanList.addSplitAction = function(menu, folder, rel, onDone) {
    if (isNull(menu) || typeof rel !== "string" ||
            !CsScanPdf.isPdfPath(rel)) {
        return null;
    }
    var action = null;
    try {
        action = menu.addAction(qsTr(CsScanList.SPLIT_PDF));
    } catch (eAdd) {
        return null;
    }
    action.triggered.connect(function() {
        CsScanList.splitPdf(folder, rel, onDone);
    });
    return action;
};

/** What the right-click menu calls showing a scan in the file manager.
 *  Two names because it is two different applications, and a menu that
 *  says "Finder" on Linux is a menu written by somebody who has never
 *  run it there. */
CsScanList.REVEAL_MAC = "Reveal in Finder";
CsScanList.REVEAL_OTHER = "Open Containing Folder";

/** True when this machine has macOS's `open`. The label and the method
 *  both hang off this, and it is a file test rather than a platform
 *  string because the platform string is the thing that would be
 *  wrong on the one build nobody tested. */
CsScanList.hasMacOpen = function() {
    try {
        return new QFileInfo("/usr/bin/open").exists();
    } catch (e) {
        return false;
    }
};

/** The menu label for revealing, on this machine. */
CsScanList.revealLabel = function(isMac) {
    return (isMac === true) ? CsScanList.REVEAL_MAC :
        CsScanList.REVEAL_OTHER;
};

/**
 * Adds "Reveal in Finder" to a scan row's context menu.
 *
 * WHY A CAVER WANTS THIS. Everything else this suite does to a scan is
 * something it knows how to do -- mark it, trim it, split it. Renaming
 * a page, deleting a bad scan, dragging in forty more from a phone,
 * fixing a trip folder somebody named wrong: those are file
 * management, they happen in Finder, and the alternative is hunting
 * down a folder six levels inside a Google Drive mount by hand
 * (Nathan, 2026-09-14).
 *
 * A FILE ROW reveals the file itself, selected. A FOLDER ROW opens
 * that folder. Both are what the row points at.
 *
 * \param menu      the QMenu being built
 * \param folder    the cave's scans folder, absolute
 * \param rel       the row's path, relative to it
 * \param isFolder  true for a trip row, false for a page
 */
CsScanList.addRevealAction = function(menu, folder, rel, isFolder) {
    if (isNull(menu) || typeof folder !== "string" || folder === "" ||
            typeof rel !== "string") {
        return null;
    }
    var action = null;
    try {
        action = menu.addAction(
            qsTr(CsScanList.revealLabel(CsScanList.hasMacOpen())));
    } catch (eAdd) {
        return null;
    }
    // Plain strings in the closure and nothing else: a Qt wrapper held
    // across a deferred call is one of this bridge's crash modes.
    var target = folder + "/" + rel;
    var asFolder = (isFolder === true);
    action.triggered.connect(function() {
        CsScanList.reveal(target, asFolder);
    });
    return action;
};

/** The label for the flush action, count and size baked in, so the
 *  menu says what it is about to throw away before it is clicked. */
CsScanList.flushLabel = function(count, bytes) {
    return qsTr("Delete %1 Trimmed Crop(s) (%2)")
        .arg(count).arg(CsScanTrim.sizeText(bytes));
};

/**
 * Adds "Delete N Trimmed Crops" to a scan tree's context menu, when
 * there are any to delete.
 *
 * WHY IT IS ON THIS MENU AND NOT A BUTTON. The crops are the tree's
 * own leavings -- every trim the caver drew in this panel wrote one --
 * and the tree deliberately does not show them (CsScanList's own
 * header on what is in a scans folder). Something invisible that grows
 * without limit needs a door, and the menu the folder already has is
 * the door, in both panels at once.
 *
 * \param folder the cave's scans folder, absolute
 * \param onDone called after a flush, to re-read the folder
 */
CsScanList.addFlushTrimmedAction = function(menu, folder, onDone) {
    if (isNull(menu) || typeof folder !== "string" || folder === "") {
        return null;
    }
    var crops = CsScanTrim.crops(folder);
    if (crops.length === 0) {
        return null;   // nothing to say: a clean folder gets no entry
    }
    var total = 0;
    for (var i = 0; i < crops.length; i++) {
        total += crops[i].bytes;
    }
    var action = null;
    try {
        action = menu.addAction(CsScanList.flushLabel(crops.length, total));
    } catch (eAdd) {
        return null;
    }
    // A plain string and a function in the closure, nothing wrapped.
    var target = folder;
    action.triggered.connect(function() {
        CsScanList.flushTrimmed(target, onDone);
    });
    return action;
};

/**
 * Deletes the crops nothing is holding, having asked first.
 *
 * WHAT THE CAVER IS PROMISED. A crop is a derivative: the drawing
 * remembers the page it came from and the box it was cut to, and the
 * repair cuts it again from those. So this is emptying a scratch
 * folder, not deleting work -- and the ones the OPEN drawing is
 * displaying right now are left where they are anyway, because
 * deleting those blanks the underlay somebody is tracing over until
 * they run the repair.
 */
CsScanList.flushTrimmed = function(folder, onDone) {
    var crops = CsScanTrim.crops(folder);
    if (crops.length === 0) {
        EAction.handleUserMessage(qsTr("There are no trimmed crops to "
            + "delete."));
        return;
    }
    var total = 0;
    for (var i = 0; i < crops.length; i++) {
        total += crops[i].bytes;
    }
    var inUse = null;
    try {
        inUse = CsScanTrim.cropsInUse(EAction.getDocument());
    } catch (eDoc) {
        inUse = null;
    }
    var sure = QMessageBox.question(RMainWindowQt.getMainWindow(),
        qsTr("Delete Trimmed Crops"),
        qsTr("%1 trimmed crops (%2) are in this cave's Trimmed folder.\n\n"
            + "Each one is a cut-out of a page, and the drawing remembers "
            + "which page and which box -- Repair Drawing cuts any of them "
            + "again if it is needed. Crops the open drawing is showing "
            + "are kept.\n\nDelete the rest?")
            .arg(crops.length).arg(CsScanTrim.sizeText(total)),
        QMessageBox.Yes | QMessageBox.No);
    if (sure !== QMessageBox.Yes) {
        return;
    }
    var res = CsScanTrim.flush(folder, inUse);
    var said = qsTr("Deleted %1 trimmed crop(s), freeing %2.")
        .arg(res.deleted).arg(CsScanTrim.sizeText(res.freed));
    if (res.kept > 0) {
        said += " " + qsTr("%1 still on the map were kept.").arg(res.kept);
    }
    if (res.failed > 0) {
        said += " " + qsTr("%1 could not be deleted.").arg(res.failed);
    }
    EAction.handleUserMessage(said);
    if (typeof onDone === "function") {
        try {
            onDone();
        } catch (eDone) {
        }
    }
};

/**
 * Shows one path in the machine's file manager.
 *
 * TWO WAYS, and the good one first. `open -R` reveals the file with it
 * SELECTED, which is the difference between "here is the folder, find
 * it again" and "here it is". Everything else gets
 * QDesktopServices.openUrl on the containing folder, which opens the
 * right window and selects nothing.
 *
 * THE LAUNCH TRAP (probed 2026-09-14): `QProcess.startDetached(prog,
 * args)` as a static does not exist here, and calling the INSTANCE
 * method with both arguments warns "Too many arguments, ignoring 2"
 * and returns false -- it would have launched `open` with no path at
 * all. setProgram + setArguments + startDetached() is the form that
 * works. Detached and not start(), because a QProcess collected at the
 * end of this function takes its child with it.
 */
CsScanList.reveal = function(absPath, isFolder) {
    var containing = absPath;
    if (isFolder !== true) {
        var cut = String(absPath).lastIndexOf("/");
        containing = (cut > 0) ? String(absPath).substring(0, cut) :
            String(absPath);
    }
    if (isFolder !== true && CsScanList.hasMacOpen()) {
        try {
            var proc = new QProcess();
            proc.setProgram("/usr/bin/open");
            proc.setArguments(["-R", absPath]);
            if (proc.startDetached() === true) {
                return true;
            }
        } catch (eProc) {
            // fall through to the folder, which is most of the answer
        }
    }
    try {
        return QDesktopServices.openUrl(QUrl.fromLocalFile(containing)) ===
            true;
    } catch (eUrl) {
        EAction.handleUserWarning(qsTr("This build could not open %1.")
            .arg(containing));
        return false;
    }
};

/**
 * Splits one PDF and says what happened.
 *
 * Its own function so the menu action's closure holds three strings
 * and nothing else -- a Qt wrapper captured in a deferred closure is
 * one of this bridge's crash modes.
 */
CsScanList.splitPdf = function(folder, rel, onDone) {
    var abs = folder + "/" + rel;
    var pages = CsScanPdf.pageCount(abs);
    if (pages < 1) {
        EAction.handleUserWarning(qsTr("%1 could not be read as a PDF.")
            .arg(rel));
        return;
    }
    // A HALF-SPLIT PDF is the only case that can overwrite anything: a
    // fully split one is not in the tree to be right-clicked. Ask,
    // because the pages it would replace may be ones a caver has
    // already trimmed and traced from.
    var existing = CsScanPdf.splitState(rel,
        CsCave.filesUnder(folder, ["*" + CsScanPdf.EXTENSION], 4), pages);
    if (existing === "partial") {
        var sure = QMessageBox.question(RMainWindowQt.getMainWindow(),
            qsTr("Split into Pages"),
            qsTr("Some pages of %1 have already been written. Split it " +
                "again and those files are overwritten. Continue?")
                .arg(rel),
            QMessageBox.Yes | QMessageBox.No);
        if (sure !== QMessageBox.Yes) {
            return;
        }
    }
    EAction.handleUserMessage(qsTr("Splitting %1 -- %2 pages at %3 dpi...")
        .arg(rel).arg(pages).arg(CsScanPdf.DPI));
    var res = CsScanPdf.split(abs);
    if (!res.ok) {
        EAction.handleUserWarning(qsTr("%1 was not split: %2")
            .arg(rel).arg(res.error));
        return;
    }
    EAction.handleUserMessage(qsTr("%1 is now %2 pages. The PDF itself " +
        "drops out of the list -- its pages are the trip now.")
        .arg(rel).arg(res.written.length));
    // The panel that was right-clicked re-lists through `onDone`. The
    // OTHER one picks the change up on its next refresh -- both re-read
    // the folder when their dock is re-shown -- because `announce`
    // carries a MARKS change and its watchers repaint ticks, they do
    // not re-walk the folder. Announcing anyway costs nothing and keeps
    // the ticks honest if a page name has gone.
    try {
        CsScanList.announce(folder);
    } catch (eTell) {
    }
    if (!isNull(onDone)) {
        try {
            onDone();
        } catch (eDone) {
        }
    }
};

/** The menu label for one page, given whether it is already marked. */
CsScanList.markLabel = function(marked) {
    return (marked === true) ? CsScanList.MARK_INCOMPLETE :
        CsScanList.MARK_COMPLETE;
};

/** The same, for a whole folder. */
CsScanList.folderMarkLabel = function(marked) {
    return (marked === true) ? CsScanList.MARK_FOLDER_INCOMPLETE :
        CsScanList.MARK_FOLDER_COMPLETE;
};

/**
 * Marks every page under a folder complete, or unmarks them all, and
 * answers the set as it now stands on disk.
 *
 * A TRIP AT A TIME, because that is how the pages arrive: a caver comes
 * back from a trip with forty scanned pages, works through them, and
 * the last thing they want is forty right-clicks to say so. The folder
 * tick already means "everything in here is done" (CsScanTree.
 * folderComplete), so this is the way to say it directly.
 *
 * ONE WRITE, not one per page. Every toggleComplete announces, and
 * forty announcements would have the other panel repaint forty times.
 *
 * Read-modify-write for the same reason toggleComplete is: the other
 * panel is marking the same pages, and writing this panel's whole copy
 * back is how the two undid each other.
 *
 * \param folderRel the folder's path relative to the scans folder
 * \param rows      the display rows, as CsScanTree.rowsOf returns
 * \param want      true to mark complete, false to unmark
 * \return the set as it now stands
 */
CsScanList.setFolderComplete = function(folder, folderRel, rows, want,
                                        listedRels) {
    var set = CsScanList.loadComplete(folder);
    if (folder === null || folder === undefined ||
            typeof folderRel !== "string" || folderRel === "" ||
            rows === null || rows === undefined) {
        return set;
    }
    var touched = CsScanTree.markFolder(set, folderRel, rows, want);
    if (touched === 0) {
        // Nothing changed, so nothing is written and nobody is told.
        return set;
    }
    try {
        var map = CsScanTree.parseCollapsed(
            RSettings.getStringValue(CsScanTree.SETTING_BOOKMARKS, ""));
        var valid = listedRels;
        if (valid === null || valid === undefined) {
            valid = [];
            for (var key in set) {
                if (set[key] === true) { valid.push(key); }
            }
        }
        CsScanTree.recordCollapsed(map, folder, set, valid);
        RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
            CsScanTree.serializeCollapsed(map));
    } catch (e) {
        // a bridge without RSettings forgets the marks; the panel still
        // shows what this call decided, for this session
    }
    CsScanList.announce(folder);
    return set;
};

/**
 * A list widget configured the way both panels want it.
 *
 * One column, no headers, rows selected whole, nothing editable.
 */
CsScanList.build = function(parent) {
    var table = new QTableWidget(0, 1, parent);
    try {
        table.horizontalHeader().visible = false;
        table.verticalHeader().visible = false;
        table.horizontalHeader().stretchLastSection = true;
        table.selectionBehavior = QAbstractItemView.SelectRows;
        table.editTriggers = QAbstractItemView.NoEditTriggers;
        table.alternatingRowColors = true;
    } catch (e) {
        // a bridge without the header accessors gets a table with
        // headers on, which is ugly and still usable
    }
    return table;
};

/**
 * What one row says: its indent, its fold arrow, its tick.
 *
 * A FOLDER IS TICKED WHEN EVERYTHING IN IT IS DONE -- open or
 * collapsed, since "this trip is finished" is worth seeing either way.
 * Ticking a folder that merely CONTAINS a finished page would put the
 * same mark on a trip with one page done as on one with forty.
 */
CsScanList.rowText = function(row, collapsed, complete, rows) {
    var indent = new Array(row.depth + 1).join("  ");
    var marks = complete || {};
    if (row.kind === "folder") {
        var folded = collapsed[row.rel] === true;
        var done = CsScanTree.folderComplete(row.rel, rows || [], marks);
        return indent + (folded ? "▸ " : "▾ ") + row.label +
            (done ? "  " + CsScanList.COMPLETE : "");
    }
    return indent + (marks[row.rel] === true ?
        CsScanList.COMPLETE + " " : "  ") + row.label;
};

/**
 * Draws the rows into the table.
 *
 * `opts.previewWidth` turns on the hover preview -- an <img> tooltip
 * over the page itself. Left out where a panel has the page on screen
 * anyway.
 */
CsScanList.fill = function(table, rows, state, opts) {
    var options = isNull(opts) ? {} : opts;
    var collapsed = isNull(state.collapsed) ? {} : state.collapsed;
    var complete = isNull(state.complete) ? {} : state.complete;
    try {
        table.setRowCount(0);
        table.setRowCount(rows.length);
    } catch (eCount) {
        return;
    }
    for (var i = 0; i < rows.length; i++) {
        var item = new QTableWidgetItem(
            CsScanList.rowText(rows[i], collapsed, complete, rows));
        if (rows[i].kind === "folder") {
            // Bold, clickable, but never SELECTED -- the selection
            // stays on a page while folders fold and unfold around it.
            try {
                var bold = item.font();
                bold.setBold(true);
                item.setFont(bold);
            } catch (eBold) {
            }
            try {
                item.setFlags(Qt.ItemIsEnabled);
            } catch (eFlags) {
            }
        } else if (!isNull(options.previewWidth) &&
                !isNull(state.folder)) {
            try {
                item.setToolTip("<img src=\"" + state.folder + "/" +
                    rows[i].rel + "\" width=\"" +
                    options.previewWidth + "\">");
            } catch (eTip) {
                // no hover preview on this bridge; the panel still works
            }
        }
        try {
            table.setItem(i, 0, item);
        } catch (eSet) {
        }
    }
    CsScanList.applyHidden(table, rows, collapsed);
};

/** Hides the rows inside collapsed folders. */
CsScanList.applyHidden = function(table, rows, collapsed) {
    try {
        for (var r = 0; r < rows.length; r++) {
            table.setRowHidden(r, CsScanTree.isHidden(rows[r], collapsed));
        }
    } catch (eHide) {
        // an engine without setRowHidden shows the list flat
    }
};

/** Redraws one row in place -- after a tick, or a fold. */
CsScanList.refreshRow = function(table, rows, state, index) {
    if (index < 0 || index >= rows.length) {
        return;
    }
    try {
        table.item(index, 0).setText(CsScanList.rowText(rows[index],
            isNull(state.collapsed) ? {} : state.collapsed,
            isNull(state.complete) ? {} : state.complete, rows));
    } catch (e) {
    }
};

/** The relative path the table has selected, or null when the
 *  selection is a folder or nothing. */
CsScanList.selectedRel = function(table, rows) {
    try {
        var at = table.currentRow();
        if (at < 0 || at >= rows.length) {
            return null;
        }
        return rows[at].kind === "file" ? rows[at].rel : null;
    } catch (e) {
        return null;
    }
};
