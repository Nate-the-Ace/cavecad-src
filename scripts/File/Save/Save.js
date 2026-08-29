/**
 * Copyright (c) 2011-2018 by Andrew Mustun. All rights reserved.
 * 
 * This file is part of the QCAD project.
 *
 * QCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * QCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with QCAD.
 */

 
include("scripts/File/File.js");
include("scripts/File/AutoSave/AutoSave.js");

/**
 * This action handles all user interaction to save the current drawing. If the current
 * drawing has no file name (has never been saved before), action SaveAs is triggered
 * instead.
 */
function Save(guiAction) {
    File.call(this, guiAction);
}

Save.prototype = new File();
Save.includeBasePath = includeBasePath;

Save.prototype.beginEvent = function() {
    File.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var fileName = doc.getFileName();
    var fileVersion = doc.getFileVersion();

    // not yet saved or
    // loaded a backup file or
    // save failed:
    // launch save as instead:
    if (fileName === "" ||
        new QFileInfo(fileName).completeBaseName().startsWith("~") ||
        doc.getVariable("ForceSaveAs")===true ||
        !this.save(fileName, fileVersion, false)) {

        if (doc.getVariable("ForceSaveAs")===true) {
            doc.removeVariable("ForceSaveAs");
        }

        include(Save.includeBasePath + "/../SaveAs/SaveAs.js");
        var saveAsAction = new SaveAs();
        this.getDocumentInterface().queueAction(saveAsAction);
        this.terminate();
        return;
    }
    this.terminate();
};

/**
 * CaveCAD: makes the Cave Survey library available in THIS engine, and
 * answers whether it is there.
 *
 * The add-on cannot hook a save itself, and that is measured rather than
 * assumed (2026-08-29, probe/CsSaveProbe in cavecad-tools, against real
 * GUI saves): a wrapper installed on Save.prototype.save from add-on
 * init never fires. Every open document gets its OWN script handler and
 * therefore its own script engine (RDocumentInterface::scriptHandlers,
 * RDocumentInterface.cpp:202). Add-ons are initialised in the
 * application-level engine; this action runs in the document's. So the
 * prototype the add-on patched is not this one, and its globals are not
 * defined here at all -- which is also why every Cave Survey tool
 * re-includes Core/CsAll.js at its own top rather than trusting it to be
 * loaded.
 *
 * The path comes from a setting the add-on writes in the engine that
 * knows it: an include() written relative to the scripts root resolves
 * only against the application bundle, never against the per-user
 * install where the add-on actually lives. include() is per-engine and
 * guarded by basename, so this costs one load per document, not one per
 * save -- and it is called twice per save on purpose, once before the
 * write and once after.
 */
function csLoadCaveSurvey() {
    try {
        var csAddOn = RSettings.getStringValue("CaveSurvey/AddOnPath", "");
        if (csAddOn.length===0) {
            return false;
        }
        include(csAddOn + "/Core/CsAll.js");
        return typeof CsCave!=="undefined";
    }
    catch (e) {
        qWarning("CaveCAD: could not load the Cave Survey library: " + e);
        return false;
    }
}

Save.prototype.save = function(fileName, fileVersion, overwriteWarning) {
    if (isNull(overwriteWarning)) {
        overwriteWarning = true;
    }

    var appWin = EAction.getMainWindow();
    var di = EAction.getDocumentInterface();
    var buttons, ret;

//    var editingWorkingSet = di.getDocument().isEditingWorkingSet();
//    if (editingWorkingSet) {
//        buttons = new QMessageBox.StandardButtons(QMessageBox.Yes, QMessageBox.Cancel);
//        ret = QMessageBox.warning(
//                    appWin,
//                    qsTr("Block editing in progress"),
//                    qsTr("A block is currently exploded and being edited. Please save the block before saving your drawing.") + " " +
//                    qsTr("Saving will save the block contents exploded.") + " " +
//                    qsTr("Save anyway?"), buttons);
//        if (ret===QMessageBox.Cancel) {
//            return true;
//        }
//    }

    fileVersion = isNull(fileVersion) ? "" : fileVersion;

    // CaveCAD: a document with no stored format saves through the
    // dxflib writer, which persists custom properties (survey data)
    // as XDATA. An explicitly chosen format (Save As) is honored --
    // the survey data store inside the drawing covers those files.
    if (fileVersion.length===0 && fileName.toLowerCase().endsWith(".dxf")) {
        var vFilters = RFileExporterRegistry.getFilterStrings();
        for (var vfi=0; vfi<vFilters.length; ++vfi) {
            if (vFilters[vfi].contains("dxflib") && vFilters[vfi].contains("*.dxf")) {
                fileVersion = vFilters[vfi];
                break;
            }
        }
    }

    fileName = di.getCorrectedFileName(fileName, fileVersion);

    var saveAs = false;

    if (overwriteWarning) {
        if (new QFileInfo(fileName).exists()) {
            buttons = makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No);
            ret = QMessageBox.warning(
                        appWin,
                        qsTr("Overwrite File?"),
                        qsTr("The file \"%1\" already exists. Do you wish to overwrite it?").arg(fileName), buttons);

            // workaround for Qt keyboard focus bug:
            appWin.activateWindow();

            if (ret!=QMessageBox.Yes) {
                saveAs = true;
            }
        }
    }

    var colorWarning = RSettings.getBoolValue("SaveAs/ColorWarning", true);
    var noFullColor = !File.isRecommendedVersion(fileVersion);

    if (!saveAs && noFullColor) {
        if (colorWarning) {
            // dxflib has no full color support:
            if (!fileVersion.contains("dxflib")) {
                buttons = makeQMessageBoxStandardButtons(QMessageBox.Yes, QMessageBox.No);
                ret = QMessageBox.warning(
                            appWin,
                            qsTr("File Format Version Not Recommended"),
                            qsTr("The file format version you are using is not recommended: \"%1\".").arg(fileVersion) + "\n"
                            + qsTr("Custom properties will not be saved.") + "\n"
                            + qsTr("All black entities and layers will be saved as white.") + "\n"
                            + qsTr("All custom colors will be adjusted to the nearest fixed color.") + " " + qsTr("Proceed?"), buttons);
                if (ret!=QMessageBox.Yes) {
                    saveAs = true;
                }
            }
        }
    }

    if (saveAs) {
        include("scripts/File/SaveAs/SaveAs.js");
        var saveAsAction = new SaveAs();
        this.getDocumentInterface().queueAction(saveAsAction);
        this.terminate();
        return true;
    }

    appWin.setProgressText(qsTr("Saving..."));

    if (noFullColor) {
        EAction.handleUserWarning(qsTr("Saving to file format version \"%1\".").arg(fileVersion));
        EAction.handleUserWarning(qsTr("Black entities and layers are saved as white."));
        EAction.handleUserWarning(qsTr("Custom colors are adjusted to the nearest fixed color."));
    }

    var bakFileName = AutoSave.getAutoSaveFileNameCurrent();

    // CaveCAD: keep the version this save is about to overwrite.
    //
    // BEFORE the export, not after: once exportFile has run the previous
    // version is gone, so no "after save" hook could ever take this
    // backup. CsBackup already guarded this suite's own destructive
    // operations; an ordinary save was the other way a good drawing gets
    // replaced by a bad one.
    try {
        if (csLoadCaveSurvey() && isFunction(CsCave.beforeSave)) {
            CsCave.beforeSave(fileName);
        }
    }
    catch (eCaveSurveyBefore) {
        qWarning("CaveCAD: pre-save backup failed: " + eCaveSurveyBefore);
    }

    if (!di.exportFile(fileName, fileVersion)) {
        var text = qsTr("File %1 has not been saved.").arg(fileName);
        appWin.handleUserWarning(text, true);
        appWin.setProgressText();
        return false;
    }

    AutoSave.cleanUp(bakFileName);

    // file name might have been changed by filter (extension added):
    var doc = di.getDocument();
    fileName = doc.getFileName();
    fileVersion = doc.getFileVersion()

    var mdiChild = EAction.getMdiChild();
    if (!isNull(mdiChild)) {
        var title = new QFileInfo(fileName).fileName();
        title = title.replace(/&/g, "&&");
        mdiChild.setWindowTitle(addDirtyFlag(title));
    }
    RSettings.addRecentFile(fileName, di.getThumbnail());

    // CaveCAD: the after-save half. See csLoadCaveSurvey above for why
    // this cannot be a hook the add-on installs itself.
    //
    // Everything here is a convenience -- project folders (including
    // backup/), the scans path, the launcher shelf, the drawing's
    // preview. None of it may cost the caver their save.
    try {
        if (csLoadCaveSurvey() && isFunction(CsCave.afterSave)) {
            CsCave.afterSave(fileName, di);
        }
    }
    catch (eCaveSurveyAfter) {
        qWarning("CaveCAD: after-save work failed: " + eCaveSurveyAfter);
    }

    appWin.handleUserMessage(qsTr("Saved file:") + " " + fileName);
    if (fileVersion.length!==0) {
        appWin.handleUserMessage(qsTr("Format:") + " " + fileVersion);
    }

    var tabBar = appWin.getTabBar();
    if (!isNull(tabBar)) {
        tabBar.setTabToolTip(tabBar.currentIndex, fileName);
    }

    appWin.setProgressText();

    return true;
};

