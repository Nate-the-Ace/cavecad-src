/**
 * CaveSurvey.js
 *
 * Top-level menu / toolbar host for the Cave Survey suite.
 *
 * This file must live at scripts/CaveSurvey/CaveSurvey.js. Every tool
 * lives in its own subfolder beside it (a folder is a tool if and
 * only if it contains <Folder>.js -- Core/ and Panel/ are libraries
 * and deliberately have no such file), and registers itself onto the
 * two widget names created here:
 *
 *   action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
 *
 * init() is called by QCAD at startup, before any tool's init(), so
 * the menu and toolbar exist by the time the tools attach to them.
 */

include("scripts/EAction.js");
// The Core library, so init() below can install the cave-folder hook.
// Tools include the same file themselves; include() dedupes by basename,
// so this costs nothing when a tool has already loaded it.
include(includeBasePath + "/Core/CsAll.js");

function CaveSurvey(guiAction) {
    EAction.call(this, guiAction);
}

CaveSurvey.prototype = new EAction();

// Returns the QMenu for "Cave Survey". The object name must be unique
// and is what every tool's setWidgetNames(...) references.
CaveSurvey.getMenu = function() {
    return EAction.getMenu(CaveSurvey.getTitle(), "CaveSurveyMenu");
};

// Returns the QToolBar, same arrangement.
CaveSurvey.getToolBar = function() {
    return EAction.getToolBar(CaveSurvey.getTitle(), "CaveSurveyToolBar");
};

CaveSurvey.getTitle = function() {
    return qsTr("Cave Survey");
};

// The suite's version, read once from the VERSION file that
// tools/make_package.sh stamps into the packaged add-on. A source tree run
// straight from the repository has no such file, and reports nothing --
// only a published build claims a version number.
//
// CaveCAD reads this property for the Script Add-Ons tab of Help > About;
// init() below also writes it onto the splash screen.
CaveSurvey.version = undefined;

CaveSurvey.getVersion = function(basePath) {
    if (!isNull(CaveSurvey.version)) {
        return CaveSurvey.version;
    }

    if (isNull(basePath)) {
        return undefined;
    }

    var fileName = basePath + "/VERSION";
    if (!new QFileInfo(fileName).exists()) {
        return undefined;
    }

    var contents = readTextFile(fileName);
    if (isNull(contents)) {
        return undefined;
    }

    contents = contents.trim();
    if (contents.length===0) {
        return undefined;
    }

    CaveSurvey.version = contents;
    return CaveSurvey.version;
};

CaveSurvey.init = function(basePath, splash) {
    CaveSurvey.getMenu();
    CaveSurvey.getToolBar();

    // Nothing to install for save-time work: an add-on physically
    // cannot hook a save (measured -- see the note in CsCave.js). The
    // fork's own Save.js calls CsCave.afterSave directly, which is
    // what makes this cave's scans/ folder, registers it on the shelf
    // and writes its preview. All this init still owes that path is
    // the add-on's location, set just below.

    // Where this add-on lives, so the application's own Save.js can
    // find it (fork patch 0006). It cannot be discovered from there:
    // every open document has its OWN script engine
    // (RDocumentInterface::scriptHandlers), the add-on's globals are not
    // in it, and an include() written relative to the scripts root
    // resolves only against the application bundle -- never against a
    // per-user install, which is where this actually lives. So the
    // absolute path is handed over here, in the one engine that knows
    // it. A missing setting simply means no after-save work happens.
    try {
        RSettings.setValue("CaveSurvey/AddOnPath", basePath);
    } catch (ePath) {
    }

    // Keep callout arrows on their notes while the caver edits with
    // QCAD's own tools. No menu entry: this is not a tool, it is what
    // makes a callout stay a callout after it is placed.
    //
    // includeBasePath-relative, like every other suite-internal include.
    // A path written relative to the scripts root instead resolves only
    // against the application bundle and fails SILENTLY from a per-user
    // install -- which is where this add-on actually lives. (Deliberately
    // described rather than quoted: test_every_include_target_exists
    // greps this file for that literal form, so an example of the wrong
    // way trips the guard against it.)
    //
    // Guarded because a missing or broken listener must not take the
    // whole add-on's startup with it. Without it, callouts still work;
    // they just need Callout Sync run by hand.
    try {
        include(includeBasePath + "/Callout/CalloutListener.js");
        if (typeof CalloutListener !== "undefined") {
            CalloutListener.install();
        }
    } catch (eCallout) {
        // degrade to the manual sync path
    }

    // Keep shaped-line decoration (ledge ticks, scallops) on its spine
    // while the caver edits with QCAD's own tools -- the same
    // arrangement as the callout listener above, for the same reason.
    // Without it, shaped lines still work; they just need Sync Shaped
    // Lines run by hand.
    try {
        include(includeBasePath + "/ShapedLines/ShapedLinesListener.js");
        if (typeof ShapedLinesListener !== "undefined") {
            ShapedLinesListener.install();
        }
    } catch (eShaped) {
        // degrade to the manual sync path
    }

    // Keep an area's fill on its boundary while the caver edits with
    // QCAD's own tools -- the same arrangement as the two listeners
    // above, for the same reason. Without it, an area's fill still
    // works; it just needs a future Sync Areas run by hand after a
    // boundary moves.
    try {
        include(includeBasePath + "/AreaFill/AreaFillListener.js");
        if (typeof AreaFillListener !== "undefined") {
            AreaFillListener.install();
        }
    } catch (eArea) {
        // degrade to the manual sync path
    }

    // Keep a sheet's scale bar on its viewport's scale -- the same
    // arrangement as the listeners above. Without it a bar still draws
    // correctly; it just needs CsScaleBar.syncAll after a scale change.
    try {
        include(includeBasePath + "/SheetSetup/SheetScaleBarListener.js");
        if (typeof SheetScaleBarListener !== "undefined") {
            SheetScaleBarListener.install();
        }
    } catch (eScaleBar) {
        // degrade: the bar keeps the scale it was drawn at
    }

    // Offer to update an external reference when its file has changed. Without it External
    // References still updates by hand; this only makes the offer by itself.
    try {
        include(includeBasePath + "/XrefAttach/XrefListener.js");
        if (typeof XrefListener !== "undefined") {
            XrefListener.install();
        }
    } catch (eXref) {
        // degrade to the External References list
    }

    // Keep the 3D view following the drawing while the caver edits.
    // UNLIKE the three listeners above this one writes nothing -- it
    // reads the survey and pushes a mesh into a window -- so it carries
    // no re-entrancy guard and joins no undo group. Without it the 3D
    // view still works; it just needs its Refresh button pressed, which
    // is the guarantee either way.
    try {
        include(includeBasePath + "/Cave3D/Cave3DListener.js");
        if (typeof Cave3DListener !== "undefined") {
            Cave3DListener.install();
        }
    } catch (eCave3d) {
        // degrade to the Refresh button
    }

    // Keep the previous version of a drawing beside it on every save.
    // A redraw is erase-then-draw across two operations, so a draw that
    // fails after the erase has landed leaves the drawing gutted -- and
    // the next save writes that over the only copy. That has happened.
    // No menu entry: a guard you have to switch on is one that is off on
    // the machine that needed it.
    // No backup hook is installed here on purpose. Neither available
    // mechanism reaches a save: a Save.prototype patch never runs in
    // QCAD's own action context, and the export listener's signals are
    // not fired by the DXF writer (both measured -- see CsBackup). The
    // backup is taken instead at the moment that matters, immediately
    // before this suite's own destructive operations.

    // report the suite on the splash screen, beside CaveCAD's own version:
    var version = CaveSurvey.getVersion(basePath);
    if (!isNull(splash) && !isNull(version)) {
        splash.showMessage(qsTr("Cave Survey Tools %1").arg(version) + "\n", Qt.AlignBottom);
    }
};
