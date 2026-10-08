// XrefManager.js -- External References: the drawings this one refers to, and what state each is in.
//
// For each reference: its name, how it is attached (Overlay / Attach), how its path is kept (Absolute /
// Relative) and whether the file is unchanged, changed since it was read, or missing. Buttons: Update (read the
// file again), change the attachment, change the path style, Bind (make it an ordinary block).
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
    XrefManager.show(doc, di);
    this.terminate();
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
    var bUpdate = new QPushButton(qsTr("Update"));
    var bStyle = new QPushButton(qsTr("Overlay <-> Attach"));
    var bPath = new QPushButton(qsTr("Absolute <-> Relative"));
    var bBind = new QPushButton(qsTr("Bind"));
    var bClose = new QPushButton(qsTr("Close"));
    row.addWidget(bUpdate, 0, 0); row.addWidget(bStyle, 0, 0); row.addWidget(bPath, 0, 0); row.addWidget(bBind, 0, 0); row.addWidget(bClose, 0, 0);
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
        note.text = items.length === 0 ? qsTr("This drawing has no external references. Use Attach Drawing.") : "";
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
    action.setStatusTip(qsTr("List the drawings this one refers to: update, change Overlay/Attach or the path style, or bind"));
    action.setDefaultCommands(["externalreferences", "xrefs", "xm"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(66);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
