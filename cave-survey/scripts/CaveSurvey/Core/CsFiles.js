// CsFiles.js
//
// The suite's file and folder pickers. Every tool asks through here
// instead of QFileDialog's statics.
//
// THE STATICS TAKE THE PLATFORM'S DIALOG. QFileDialog.getOpenFileName
// and friends silently open the Windows / macOS / GTK picker whatever
// CaveCAD's own preference says, and the platform dialogs are exactly
// what differs between the systems this ships on (Nathan's standing
// rule: Qt's own widgets, never the platform's). Found 2026-09-26 on
// Windows, where Cave Shelf's Import opened Explorer's picker. These
// build the dialog themselves and default to Qt's own (see useQtDialog).
//
// Same arguments and same answer as the statics they replace: the path
// chosen, or "" when cancelled -- always a plain string, never a
// wrapped QString that is truthy while empty.

var CsFiles = {};

/**
 * True unless the caver opted in to the system dialog (Preferences >
 * Save As > Use system file dialog).
 *
 * Decided HERE rather than through the app's getDontUseNativeDialog(),
 * whose default was QCAD's (the system dialog) until CaveCAD 0.9.4: an
 * add-on update reaches people before an app update does, and must not
 * bring the platform picker back with it. KDE's dialog is refused
 * outright, as QCAD does, for its file-filter bug.
 */
CsFiles.useQtDialog = function() {
    try {
        if (RS.getWindowManagerId() === "kde") { return true; }
        return RSettings.getBoolValue("SaveAs/UseSystemFileDialog", false) === false;
    } catch (e) {
        return true;
    }
};

/**
 * Runs a configured QFileDialog and returns the first path chosen, or
 * "" when cancelled.
 */
CsFiles.run = function(parent, caption, start, filter, mode, accept) {
    var dialog = new QFileDialog(isNull(parent) ? null : parent,
        caption === undefined ? "" : caption,
        isNull(start) ? "" : String(start),
        isNull(filter) ? "" : String(filter));
    dialog.setOption(QFileDialog.DontUseNativeDialog, CsFiles.useQtDialog());
    dialog.fileMode = mode;
    dialog.acceptMode = accept;
    if (mode === QFileDialog.Directory) {
        dialog.setOption(QFileDialog.ShowDirsOnly, true);
    }

    var accepted = dialog.exec();
    var files = dialog.selectedFiles();
    destrDialog(dialog);

    if (!accepted || isNull(files) || files.length === 0) {
        return "";
    }
    return String(files[0]);
};

/** An existing file to open -- QFileDialog.getOpenFileName's arguments. */
CsFiles.openFile = function(parent, caption, start, filter) {
    return CsFiles.run(parent, caption, start, filter,
        QFileDialog.ExistingFile, QFileDialog.AcceptOpen);
};

/** A file to write -- QFileDialog.getSaveFileName's arguments. */
CsFiles.saveFile = function(parent, caption, start, filter) {
    return CsFiles.run(parent, caption, start, filter,
        QFileDialog.AnyFile, QFileDialog.AcceptSave);
};

/** An existing folder -- QFileDialog.getExistingDirectory's arguments. */
CsFiles.directory = function(parent, caption, start) {
    return CsFiles.run(parent, caption, start, "",
        QFileDialog.Directory, QFileDialog.AcceptOpen);
};
