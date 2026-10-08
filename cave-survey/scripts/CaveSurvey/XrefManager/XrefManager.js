// XrefManager.js -- External References: the drawings this one refers to, and what state each is in.
//
// For each reference: its name, how it is attached (Overlay / Attach), how its path is kept (Absolute /
// Relative) and whether the file is unchanged, changed since it was read, or missing. Buttons: Update (read the
// file again), change the attachment, change the path style, Bind (make it an ordinary block).
// It is also where a drawing is ATTACHED: the "Attach drawing..." button asks for the file, Overlay or Attach and the
// path style, and puts it at this drawing's origin (right for drawings that share coordinates; move the block
// afterwards if it should sit elsewhere). There is no separate Attach Drawing command: the typed words "attachdrawing" and "xref" open this same window.
// The logic is Core/CsXref.js.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function XrefManager(guiAction) {
    EAction.call(this, guiAction);
}

XrefManager.prototype = new EAction();

XrefManager.STATUS = {
    ok: "up to date", changed: "CHANGED - newer file", missing: "MISSING - the last picture is kept",
    unresolved: "path cannot be worked out until this drawing is saved"
};

XrefManager.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || CsModelSpace.blocks(doc, qsTr("External References"))) {
        this.terminate();
        return;
    }
    try {
        XrefManager.show(doc, di);
    }
    catch (e) {
        CsTell.warn(qsTr("External References could not open: %1").arg(String(e)));
    }
    this.terminate();
};

/** The file to attach, or "" when cancelled. */
XrefManager.pickFile = function(startDir) {
    var path = CsFiles.openFile(RMainWindowQt.getMainWindow(), qsTr("Attach Drawing"), startDir,
        qsTr("Drawings") + " (*.dxf *.dwg);;" + qsTr("All files") + " (*)");
    return isNull(path) ? "" : String(path);
};

/** { style, pathStyle } from the person, or null when cancelled. */
XrefManager.ask = function(name, canBeRelative) {
    var d = CsXref.defaults();
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Attach Drawing");
    var v = new QVBoxLayout();
    v.addWidget(new QLabel(qsTr("Attaching: %1").arg(name)), 0, 0);

    v.addWidget(new QLabel(qsTr("How it is attached")), 0, 0);
    var overlay = new QRadioButton(qsTr("Overlay -- show its own drawing only (what it refers to does not come along)"));
    var attach = new QRadioButton(qsTr("Attach -- show it and whatever it refers to"));
    overlay.checked = d.style === CsXref.OVERLAY;
    attach.checked = d.style === CsXref.ATTACH;
    v.addWidget(overlay, 0, 0);
    v.addWidget(attach, 0, 0);

    v.addWidget(new QLabel(qsTr("How its path is kept")), 0, 0);
    var absolute = new QRadioButton(qsTr("Absolute -- the full path to the file"));
    var relative = new QRadioButton(qsTr("Relative -- from this drawing's folder (moves with a cave folder)"));
    absolute.checked = !(d.pathStyle === CsXref.RELATIVE && canBeRelative);
    relative.checked = d.pathStyle === CsXref.RELATIVE && canBeRelative;
    relative.enabled = canBeRelative;
    if (!canBeRelative) {
        relative.toolTip = qsTr("Save this drawing first: a relative path is relative to its folder.");
    }
    v.addWidget(absolute, 0, 0);
    v.addWidget(relative, 0, 0);

    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);
    var accepted = (dlg.exec() === QDialog.Accepted);
    var out = {
        style: attach.checked ? CsXref.ATTACH : CsXref.OVERLAY,
        pathStyle: relative.checked ? CsXref.RELATIVE : CsXref.ABSOLUTE
    };
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    return accepted ? out : null;
};

/**
 * Picks a file, asks how to attach it and attaches it at the origin.
 * \return { ok, why, text } -- text is a one-line message for the window ("" when cancelled)
 */
XrefManager.attachNew = function(doc, di) {
    var base = CsXref.baseDirOf(doc);
    var file = XrefManager.pickFile(base === "" ? RSettings.getDocumentsLocation() : base);
    if (file === "") {
        return { ok: true, why: "", text: "" };
    }
    var choice = XrefManager.ask(CsXref.basename(file), base !== "");
    if (isNull(choice)) {
        return { ok: true, why: "", text: "" };
    }
    var res;
    try {
        res = CsXref.attach(doc, di, file, { style: choice.style, pathStyle: choice.pathStyle, at: new RVector(0, 0) });
    }
    catch (e) {
        res = { ok: false, why: String(e) };
    }
    if (res.ok) {
        return { ok: true, why: "", text: qsTr("Attached %1 (%2, %3 path).").arg(CsXref.basename(file)).arg(choice.style).arg(choice.pathStyle) };
    }
    return { ok: false, why: res.why, text: res.why };
};

/** Shows the list; every button acts and refreshes it. */
XrefManager.show = function(doc, di) {
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("External References");
    var v = new QVBoxLayout();
    var list = new QListWidget();
    v.addWidget(list, 0, 0);
    var note = new QLabel("");
    v.addWidget(note, 0, 0);
    var row = new QHBoxLayout();
    var bAttach = new QPushButton(qsTr("Attach drawing..."));
    var bUpdate = new QPushButton(qsTr("Update"));
    var bStyle = new QPushButton(qsTr("Overlay <-> Attach"));
    var bPath = new QPushButton(qsTr("Absolute <-> Relative"));
    var bBind = new QPushButton(qsTr("Bind"));
    var bClose = new QPushButton(qsTr("Close"));
    row.addWidget(bAttach, 0, 0); row.addWidget(bUpdate, 0, 0); row.addWidget(bStyle, 0, 0); row.addWidget(bPath, 0, 0); row.addWidget(bBind, 0, 0); row.addWidget(bClose, 0, 0);
    v.addLayout(row);
    dlg.setLayout(v);
    var items = [];
    var refresh = function() {
        list.clear();
        items = CsXref.listIn(doc);
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            list.addItem(CsXref.stem(it.stored) + "   [" + it.style + ", " + it.pathStyle + "]   " + (XrefManager.STATUS[it.status] || it.status) + "   " + it.stored);
        }
        if (items.length > 0) { list.setCurrentRow(0); }
        note.text = items.length === 0 ? qsTr("No drawings attached yet. Click Attach drawing... to bring one in.") : "";
    };
    var current = function() {
        var r = list.currentRow;
        return (r >= 0 && r < items.length) ? items[r] : null;
    };
    var act = function(fn) {
        return function() {
            var it = current();
            if (it === null) { return; }
            var res;
            try { res = fn(it); } catch (e) { res = { ok: false, why: String(e) }; }
            if (!res.ok) { note.text = res.why; }
            refresh();
            if (!res.ok) { note.text = res.why; }
        };
    };
    bAttach.clicked.connect(function() {
        var res;
        try { res = XrefManager.attachNew(doc, di); } catch (e) { res = { ok: false, why: String(e), text: String(e) }; }
        refresh();
        if (res.text !== "") { note.text = res.text; }
    });
    bUpdate.clicked.connect(act(function(it) { return CsXref.reload(doc, di, it.blockId, {}); }));
    bStyle.clicked.connect(act(function(it) {
        return CsXref.reload(doc, di, it.blockId, { style: it.style === CsXref.ATTACH ? CsXref.OVERLAY : CsXref.ATTACH });
    }));
    bPath.clicked.connect(act(function(it) {
        return CsXref.setPathStyle(doc, di, it.blockId, it.pathStyle === CsXref.RELATIVE ? CsXref.ABSOLUTE : CsXref.RELATIVE);
    }));
    bBind.clicked.connect(act(function(it) { return CsXref.detach(doc, di, it.blockId); }));
    bClose.clicked.connect(function() { dlg.accept(); });
    refresh();
    dlg.exec();
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
};

XrefManager.init = function(basePath) {
    var action = new RGuiAction(qsTr("External References"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/XrefManager.js");
    action.setIcon(basePath + "/XrefManager.svg");
    action.setStatusTip(qsTr("Attach another drawing, and manage the drawings this one refers to: update, change Overlay/Attach or the path style, or bind"));
    action.setDefaultCommands(["externalreferences", "xrefs", "xm", "attachdrawing", "xref", "xr"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(66);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
