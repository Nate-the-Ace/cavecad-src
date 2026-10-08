/**
 * SurfaceData.js
 *
 * One entry for everything that comes from ABOVE ground: an aerial
 * photograph of the surface and its elevation contours, both anchored
 * to the same geo station. The passes live in Core/CsSurfaceData.js;
 * this is the dialog and the report -- the same split RepairDrawing.js
 * uses for its own three passes.
 *
 * Formerly two menu entries, Aerial Basemap and Surface Contours, that
 * asked the same "where is the ground?" question and failed in two
 * separately worded ways when nobody had answered it yet.
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

function SurfaceData(guiAction) {
    EAction.call(this, guiAction);
}

SurfaceData.prototype = new EAction();

SurfaceData.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    surfaceDataRun();
    this.terminate();
};

function surfaceDataRun() {
    var doc = getDocument();
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Surface Data")) {
        return;
    }
    if (isNull(doc)) {
        CsTell.warn(qsTr("Surface Data: no active drawing document."));
        return;
    }
    var di = getDocumentInterface();

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = qsTr("Surface Data");
    var layout = new QVBoxLayout();
    layout.addWidget(new QLabel(
        qsTr("Both need this drawing's geo anchor, and are asked for it "
           + "only once.")),
        0, 0);

    var cbAerial = new QCheckBox(
        qsTr("Aerial photograph of the surface"));
    var cbContours = new QCheckBox(
        qsTr("Surface elevation contours"));
    cbAerial.checked = true;
    cbContours.checked = true;
    layout.addWidget(cbAerial, 0, 0);
    layout.addWidget(cbContours, 0, 0);

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
        imagery: cbAerial.checked,
        contours: cbContours.checked
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

    var report = CsSurfaceData.run(doc, di, opts);

    // QMessageBox, not handleUserMessage: the command line escapes the
    // text and wraps it in a <span>, so Qt reads it as rich text and
    // every newline collapses to a space.
    try {
        QMessageBox.information(getMainWindow(), qsTr("Surface Data"),
            report.lines.join("\n"));
    } catch (e) {
        EAction.handleUserMessage(report.lines[0]);
    }
}

SurfaceData.init = function(basePath) {
    var action = new RGuiAction(qsTr("Surface Data"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SurfaceData.js");
    action.setIcon(basePath + "/SurfaceData.svg");
    action.setStatusTip(qsTr("Put the surface above the cave into the "
        + "drawing: aerial photograph, elevation contours, or both"));
    action.setDefaultCommands(["surfacedata", "sd"]);
    action.setGroupSortOrder(453);
    action.setSortOrder(20);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
