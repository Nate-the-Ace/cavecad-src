// SheetNameListener.js -- keeps a sheet's number and its Layout tab's name the same, both ways.
//
//  TAB -> SHEET   A layout was renamed, created or removed (or that was undone or redone): every piece of text
//                 that says a sheet's name is brought back in line (CsLayoutGen.refreshNames): the title block's
//                 Sheet line, a tiled sheet's "SHEET A1" corner, the match lines that name a neighbour, the
//                 sheet index.
//  SHEET -> TAB   A person edited a Sheet line (a text or title block attribute tagged TBField=sheetNumber on a
//                 layout): the layout is renamed to what it now says. If that name is not allowed (it is
//                 already used, empty, "Model" or starts with "*") the line is put back and one message says why.
//
// The same arrangement as SheetScaleBarListener, with the same four hazards handled the same ways:
//  1. RECURSION -- the busy flag, cleared in finally; and both directions only WRITE WHAT DIFFERS, so an answer
//     to our own write finds nothing to do.
//  2. COST -- the gate reads only the objects the transaction names.
//  3. A FREED RDocument cannot be detected: the document argument is used synchronously and never stored.
//  4. UNDO -- a rewrite answering an undo or redo, or an edit that belongs to no transaction group, is made
//     NON-undoable (a separate undoable step would strand the sheet on undo, or destroy the redo history);
//     every undo and redo of the rename re-syncs the text quietly, so they always agree.
//
// Not a menu tool. Installed once from CaveSurvey.js.

function SheetNameListener() {}

SheetNameListener.installed = false;
SheetNameListener.busy = false;

SheetNameListener.install = function() {
    if (SheetNameListener.installed) {
        return false;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return false;   // headless: no window to listen to
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(SheetNameListener.onTransaction);
    } catch (e) {
        return false;   // the names then agree after a sheet is built, or by hand
    }
    SheetNameListener.installed = true;
    return true;
};

/** What a transaction touched: { layout: true when a layout object, edited: [text entities tagged as a sheet number] }. */
SheetNameListener.touched = function(document, transaction) {
    var out = { layout: false, edited: [] };
    var objIds;
    try {
        objIds = transaction.getAffectedObjects();
    } catch (e) {
        return out;
    }
    for (var i = 0; i < objIds.length; i++) {
        if (!out.layout && !isNull(document.queryLayout(objIds[i]))) {
            out.layout = true;
        }
        var e2 = document.queryEntity(objIds[i]);
        if (isNull(e2) || e2.isUndone()) {
            continue;
        }
        if (CsSheet.isText(e2) && CsTags.get(e2, CsSheet.TAG) === CsSheetLink.SHEET_FIELD) {
            out.edited.push(e2);
        }
    }
    return out;
};

SheetNameListener.onTransaction = function(document, transaction) {
    if (SheetNameListener.busy || isNull(document) || isNull(transaction)) {
        return;
    }
    var t = SheetNameListener.touched(document, transaction);
    if (!t.layout && t.edited.length === 0) {
        return;   // the common case
    }
    var appWin = RMainWindowQt.getMainWindow();
    var di = isNull(appWin) ? null : appWin.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var current = di.getDocument();
    if (isNull(current) || current.getFileName() !== document.getFileName()) {
        return;
    }
    var group = -1, undoing = false;
    try {
        group = transaction.getGroup();
        undoing = transaction.isUndoing() || transaction.isRedoing();
    } catch (eG) {
        group = -1;
    }
    var quiet = undoing || group < 0;
    SheetNameListener.busy = true;
    try {
        // SHEET -> TAB: only a person's edit (never an undo or redo, which restore both together)
        if (!undoing) {
            for (var k = 0; k < t.edited.length; k++) {
                SheetNameListener.fromSheet(current, di, t.edited[k], group);
            }
        }
        // TAB -> SHEET: whatever the layouts are called now, the text says
        CsLayoutGen.refreshNames(current, di, group, quiet);
    } catch (eOne) {
        // a failed sync must not surface as a dialog mid-edit; the next change tries again
    } finally {
        SheetNameListener.busy = false;
    }
};

/** A Sheet line was edited: rename its layout to match, or put the line back. */
SheetNameListener.fromSheet = function(doc, di, entity, group) {
    var info = Layouts.ofBlock(doc, entity.getBlockId());
    if (isNull(info)) {
        return;
    }
    var typed = CsSheetLink.nameFromLine(CsSheet.textOf(entity));
    if (typed.toLowerCase() === info.name.toLowerCase()) {
        return;   // the line is what it should be (the sheet is lettered in capitals, a name keeps its case)
    }
    if (!isNull(Layouts.nameOk) && Layouts.nameOk(doc, typed, info.name)) {
        Layouts.rename(di, info.name, typed);
        return;   // the rename is a layout change: refreshNames lettering follows
    }
    CsTell.warn(qsTr("Sheet number: \"%1\" cannot be a sheet name (it is empty, already used by another sheet, \"Model\", or starts with *). The sheet stays \"%2\".")
        .arg(typed).arg(info.name));
};
