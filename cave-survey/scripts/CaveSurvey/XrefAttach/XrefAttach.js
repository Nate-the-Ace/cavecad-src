// XrefAttach.js -- Attach Drawing: bring another drawing's visuals into this one as a single unit that stays
// linked to its file (an external reference, "xref").
//
// Two choices, asked here, remembered for next time (Overlay and Absolute until you choose):
//   Attachment   Overlay  the other drawing's own geometry only
//                Attach   its geometry AND whatever it has referenced
//   Path         Absolute the full path
//                Relative kept relative to this drawing's folder (so a cave folder can move)
//
// When the file changes, an open drawing that uses it offers to update (XrefListener). External References
// lists them all. The logic is Core/CsXref.js.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function XrefAttach(guiAction) {
    EAction.call(this, guiAction);
}

XrefAttach.prototype = new EAction();

/** The file to attach, or "" when cancelled. */
XrefAttach.pickFile = function(startDir) {
    var path = CsFiles.openFile(RMainWindowQt.getMainWindow(), qsTr("Attach Drawing"), startDir,
        qsTr("Drawings") + " (*.dxf *.dwg);;" + qsTr("All files") + " (*)");
    return isNull(path) ? "" : String(path);
};

/** { style, pathStyle, atOrigin } from the person, or null when cancelled. */
XrefAttach.ask = function(name, canBeRelative) {
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

    var origin = new QCheckBox(qsTr("Place it at this drawing's origin (right for drawings that share coordinates)"));
    origin.checked = true;
    v.addWidget(origin, 0, 0);

    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);
    var accepted = (dlg.exec() === QDialog.Accepted);
    var out = {
        style: attach.checked ? CsXref.ATTACH : CsXref.OVERLAY,
        pathStyle: relative.checked ? CsXref.RELATIVE : CsXref.ABSOLUTE,
        atOrigin: origin.checked
    };
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    return accepted ? out : null;
};

XrefAttach.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.choice = undefined;
    // Anything that goes wrong is SAID in a box (a script error alone is invisible to the caver: the command just
    // seems to do nothing).
    try {
        this.pickAndAsk();
    }
    catch (e) {
        this.choice = undefined;
        CsTell.warn(qsTr("Attach Drawing could not start: %1").arg(String(e)));
        this.terminate();
    }
};

XrefAttach.prototype.pickAndAsk = function() {
    var doc = this.getDocument();
    if (isNull(doc) || CsModelSpace.blocksWhole(doc, qsTr("Attach Drawing"))) {
        this.terminate();
        return;
    }
    var base = CsXref.baseDirOf(doc);
    var file = XrefAttach.pickFile(base === "" ? RSettings.getDocumentsLocation() : base);
    if (file === "") {
        this.terminate();
        return;
    }
    var choice = XrefAttach.ask(CsXref.basename(file), base !== "");
    if (isNull(choice)) {
        this.terminate();
        return;
    }
    choice.file = file;
    if (choice.atOrigin) {
        this.attachAt(choice, new RVector(0, 0));
        this.terminate();
        return;
    }
    this.choice = choice;
    var di = this.getDocumentInterface();
    di.setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();
    var prompt = qsTr("Click where the drawing goes");
    this.setCommandPrompt(prompt);
    this.setLeftMouseTip(prompt);
    this.setRightMouseTip(EAction.trCancel);
};

XrefAttach.prototype.attachAt = function(choice, at) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var res;
    try {
        res = CsXref.attach(doc, di, choice.file, { style: choice.style, pathStyle: choice.pathStyle, at: at });
    }
    catch (e) {
        res = { ok: false, why: String(e) };
    }
    if (res.ok) {
        EAction.handleUserMessage(qsTr("Attached %1 (%2, %3 path).").arg(CsXref.basename(choice.file)).arg(choice.style).arg(choice.pathStyle));
    }
    else {
        CsTell.warn(qsTr("Attach Drawing: ") + res.why);
    }
};

XrefAttach.prototype.coordinateEvent = function(event) {
    if (isNull(this.choice)) {
        return;
    }
    this.attachAt(this.choice, event.getModelPosition());
    this.terminate();
};

XrefAttach.init = function(basePath) {
    var action = new RGuiAction(qsTr("Attach Drawing"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/XrefAttach.js");
    action.setIcon(basePath + "/XrefAttach.svg");
    action.setStatusTip(qsTr("Bring another drawing into this one as a linked external reference (Overlay or Attach)"));
    action.setDefaultCommands(["attachdrawing", "xref", "xr"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(65);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
