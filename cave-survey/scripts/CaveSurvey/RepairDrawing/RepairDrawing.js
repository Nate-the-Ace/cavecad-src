/**
 * RepairDrawing.js
 *
 * One entry for the three things that fix a drawing rather than draw in
 * it. The passes live in Core/CsRepair.js; this is the dialog and the
 * report.
 */
include("scripts/EAction.js");
// simple.js defines getDocument()/getDocumentInterface(), which this
// file calls. Without the include the tool works only when some OTHER
// tool has already pulled simple.js into the script context this
// session -- so it fails when it is the FIRST thing run after a launch,
// and works every time after that. See ResetDrawing.js, where that cost
// a menu entry that did nothing.
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function RepairDrawing(guiAction) {
    EAction.call(this, guiAction);
}

RepairDrawing.prototype = new EAction();

RepairDrawing.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    repairDrawingRun();
    this.terminate();
};

function repairDrawingRun() {
    var doc = getDocument();
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Repair Drawing")) {
        return;
    }
    if (isNull(doc)) {
        CsTell.warn(qsTr("Repair Drawing: no active drawing document."));
        return;
    }
    var di = getDocumentInterface();

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Repair Drawing");
    var layout = new QVBoxLayout();
    layout.addWidget(new QLabel(
        qsTr("Runs on the whole drawing. Nothing is moved or deleted.")),
        0, 0);

    var cbRebuild = new QCheckBox(
        qsTr("Survey data -- re-read the survey from the drawing's tags, "
           + "and bring an old drawing's tags up to date"));
    var cbRestyle = new QCheckBox(
        qsTr("Layers -- add any layer this drawing is missing, and put "
           + "the rest back on the current palette"));
    var cbGroups = new QCheckBox(
        qsTr("Layer groups -- file this drawing's layers into the Layer "
           + "Manager's groups, adding to whatever you have arranged"));
    var cbCallouts = new QCheckBox(
        qsTr("Callouts -- put every note's arrows back on the note"));
    cbRebuild.checked = true;
    cbRestyle.checked = true;
    cbGroups.checked = true;
    cbCallouts.checked = true;
    layout.addWidget(cbRebuild, 0, 0);
    layout.addWidget(cbRestyle, 0, 0);
    layout.addWidget(cbGroups, 0, 0);
    layout.addWidget(cbCallouts, 0, 0);

    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok
                                     | QDialogButtonBox.Cancel);
    // .accepted/.rejected are signals on the wrapper: connect, do not assign.
    // CLOSURES, NOT SLOT NAMES. `signal.connect(dialog, "accept")` --
    // the Qt Script idiom this suite used everywhere -- THROWS in this
    // build: "Function.prototype.connect: target is not a function".
    // The engine's connect takes a function, or a receiver plus a
    // function, and never a slot name. It threw where the dialog was
    // built, so the tool died before the dialog was ever shown.
    // Measured against the running application, 2026-09-06.
    buttons.accepted.connect(function() { dlg.accept(); });
    buttons.rejected.connect(function() { dlg.reject(); });
    layout.addWidget(buttons, 0, 0);
    dlg.setLayout(layout);

    if (dlg.exec() !== QDialog.Accepted) {
        // destroy() THROWS on every QDialog in this build --
        // "Invalid attempt to destroy() an indestructible object",
        // parented or not (measured 2026-09-06). The dialog is
        // closed and handed to Qt to delete instead, and even that
        // is guarded: tearing down a dialog must never cost the
        // answer the caver just gave it.
        try {
            dlg.close();
            dlg.deleteLater();
        } catch (eClose) {
        }
        return;
    }
    var opts = {
        rebuild: cbRebuild.checked,
        restyle: cbRestyle.checked,
        groups: cbGroups.checked,
        callouts: cbCallouts.checked
    };
    // destroy() THROWS on every QDialog in this build --
    // "Invalid attempt to destroy() an indestructible object",
    // parented or not (measured 2026-09-06). The dialog is
    // closed and handed to Qt to delete instead, and even that
    // is guarded: tearing down a dialog must never cost the
    // answer the caver just gave it.
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }

    var report = CsRepair.run(doc, di, opts);

    // QMessageBox, not handleUserMessage: the command line escapes the
    // text and wraps it in a <span>, so Qt reads it as rich text and
    // every newline collapses to a space.
    try {
        QMessageBox.information(getMainWindow(), qsTr("Repair Drawing"),
            report.lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(report.lines[0]);
    }
}

RepairDrawing.init = function(basePath) {
    var action = new RGuiAction(qsTr("Repair Drawing"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/RepairDrawing.js");
    action.setIcon(basePath + "/RepairDrawing.svg");
    action.setStatusTip(qsTr("Fix a drawing that is out of date or out "
        + "of step: survey tags, layer palette, layer groups, callout "
        + "arrows"));
    action.setDefaultCommands(["repairdrawing", "rep"]);
    action.setGroupSortOrder(455);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
