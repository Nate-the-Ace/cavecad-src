/**
 * Copyright (c) 2026 CaveCAD contributors.
 *
 * This file is part of CaveCAD, a fork of the QCAD project.
 *
 * CaveCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CaveCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with CaveCAD.
 */

include("scripts/Widgets/Widgets.js");
include("scripts/WidgetFactory.js");
// Sibling files are included through includeBasePath, not through a
// "scripts/"-rooted path. An add-on folder can live in the application
// bundle OR in the per-user scripts folder, and include() resolves a
// rooted path only against the bundle: from the per-user folder it
// reports "not found" and the next line dies with a bare "X is not
// defined". Same rule the Cave Survey suite follows.
include(includeBasePath + "/RLayerTreeQt.js");

/**
 * \class LayerManager
 * \brief The Layer Manager palette: grouped layers, a filter, and named
 * layer states.
 * \ingroup ecma_widgets
 *
 * A sibling of the stock Layer List rather than a replacement for it. A
 * cave drawing carries over 150 layers before per-run variants multiply
 * them, and a flat alphabetical list is the wrong tool at that size --
 * but the flat list is still the right tool sometimes, and it stays one
 * click away in the View menu.
 */
function LayerManager(guiAction) {
    Widgets.call(this, guiAction);
}

LayerManager.prototype = new Widgets();
LayerManager.includeBasePath = includeBasePath;

/** Combo entry meaning "no state applied". Never a real state name. */
LayerManager.NoState = "—";

LayerManager.getPreferencesCategory = function() {
    return [ qsTr("Widgets"), qsTr("Layer Manager") ];
};

LayerManager.applyPreferences = function(doc, mdiChild) {
    var appWin = RMainWindowQt.getMainWindow();
    appWin.notifyLayerListeners(EAction.getDocumentInterface(), []);

    var tree = appWin.findChild("LayerTree");
    if (!isNull(tree)) {
        WidgetFactory.initList(tree, "LayerManager");
    }
};

/**
 * Shows / hides the layer manager.
 */
LayerManager.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    var dock = appWin.findChild("LayerManagerDock");
    if (isNull(dock)) {
        return;
    }
    if (!RSettings.getOriginalArguments().contains("-no-show")) {
        dock.visible = !dock.visible;
        if (dock.visible) {
            dock.raise();
        }
    }
};

LayerManager.prototype.finishEvent = function() {
    Widgets.prototype.finishEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    var dock = appWin.findChild("LayerManagerDock");
    if (!isNull(dock)) {
        this.getGuiAction().setChecked(dock.visible);
    }
};

LayerManager.uninit = function() {
    LayerManager.tree = undefined;
    LayerManager.stateMenu = undefined;
    var action = RGuiAction.getByScriptFile("scripts/Widgets/LayerManager/LayerManager.js");
    if (!isNull(action)) {
        action.visible = false;
    }

    var appWin = RMainWindowQt.getMainWindow();
    var tree = appWin.findChild("LayerTree");
    if (!isNull(tree)) {
        var listener = tree.property("listener");
        appWin.removeLayerListener(listener);
    }
    var dock = appWin.findChild("LayerManagerDock");
    if (!isNull(dock)) {
        destr(dock);
    }
    LayerManager.getPreferencesCategory = undefined;
};


// ---------------------------------------------------------------------
// Layer states
// ---------------------------------------------------------------------

/**
 * The live tree.
 *
 * Held as a reference rather than looked up with findChild, which returns
 * a fresh wrapper typed by the C++ class: the script prototype is gone
 * from it, so tree.updateLayers is undefined and the call dies with
 * nothing useful to say. Measured in the running GUI, not assumed.
 */
LayerManager.tree = undefined;

LayerManager.getTree = function() {
    return LayerManager.tree;
};

/**
 * The state picker: a button that opens a menu, NOT a combo box.
 *
 * A QComboBox at the foot of a full-height dock drops its list
 * downwards off the bottom of the screen -- Qt's own flip did not save
 * it there, and a combo's popup placement is not something script can
 * reach in to correct. A QMenu flips on its own, and it makes the
 * state picker behave like every other picker in this palette.
 */
LayerManager.getStateButton = function() {
    return RMainWindowQt.getMainWindow().findChild("StateButton");
};

/** The state showing on the button, or undefined for the placeholder. */
LayerManager.currentState = undefined;

/** Every state name in the drawing, as of the last refresh. */
LayerManager.stateNames = [];

/**
 * Re-reads the drawing's states and puts the right name on the button.
 *
 * Called from the tree's own refresh, so it runs on every layer change
 * -- which is why it only READS. The combo box this replaced had to
 * block its signals here, because repopulating one emits
 * currentIndexChanged and a layer state would have been restored every
 * time the layer list refreshed. A button has nothing to emit.
 */
LayerManager.refreshStates = function() {
    var button = LayerManager.getStateButton();
    if (isNull(button)) {
        return;
    }

    var di = EAction.getDocumentInterface();
    var names = [];
    if (!isNull(di)) {
        var doc = di.getDocument();
        if (!isNull(doc)) {
            names = LayerStates.listNames(doc);
        }
    }
    LayerManager.stateNames = names;

    // A state that has gone -- deleted, or this is another drawing --
    // stops being the one showing, rather than naming something that
    // is not there.
    if (!isNull(LayerManager.currentState) &&
            names.indexOf(LayerManager.currentState)<0) {
        LayerManager.currentState = undefined;
    }
    button.text = isNull(LayerManager.currentState) ?
        LayerManager.NoState : LayerManager.currentState;
};

/**
 * Opens the state menu at the button.
 *
 * Dropped from the button's bottom edge, and QMenu takes it from there
 * -- including flipping it above when the palette is against the foot
 * of the screen, which is the whole reason this is not a combo box.
 */
LayerManager.showStateMenu = function() {
    var button = LayerManager.getStateButton();
    if (isNull(button)) {
        return;
    }
    LayerManager.refreshStates();

    // Held on the class: a menu whose only reference is the function
    // that opened it can go out of scope while it is still on screen.
    LayerManager.stateMenuPopup = new QMenu(button);
    var placeholder = LayerManager.stateMenuPopup.addAction(
        LayerManager.NoState);
    placeholder.checkable = true;
    placeholder.checked = isNull(LayerManager.currentState);

    var names = LayerManager.stateNames;
    if (names.length>0) {
        LayerManager.stateMenuPopup.addSeparator();
    }
    var actions = [];
    for (var i=0; i<names.length; i++) {
        var action = LayerManager.stateMenuPopup.addAction(names[i]);
        action.checkable = true;
        action.checked = (names[i]===LayerManager.currentState);
        actions.push(action);
    }

    var chosen = LayerManager.stateMenuPopup.exec(
        button.mapToGlobal(new QPoint(0, button.height)));
    if (isNull(chosen)) {
        return;
    }

    // Matched by text, not identity: exec() answers with a wrapper
    // around the chosen QAction and a wrapper is not guaranteed to be
    // the object addAction returned.
    var text = String(chosen.text);
    if (text===String(placeholder.text)) {
        LayerManager.currentState = undefined;
        LayerManager.refreshStates();
        return;
    }
    for (i=0; i<names.length; i++) {
        if (names[i]===text) {
            LayerManager.currentState = names[i];
            LayerManager.refreshStates();
            LayerManager.applySelectedState();
            return;
        }
    }
};

/** \return The selected state name, or undefined for the placeholder. */
LayerManager.getSelectedState = function() {
    return LayerManager.currentState;
};

LayerManager.applySelectedState = function() {
    var name = LayerManager.getSelectedState();
    if (isNull(name)) {
        return;
    }
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    LayerStates.restore(di, name);

    var tree = LayerManager.getTree();
    if (!isNull(tree)) {
        tree.updateLayers(di);
    }
};

LayerManager.saveState = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var name = RLayerTreeQt.promptName(qsTr("Save Layer State"), qsTr("State name:"));
    if (isNull(name)) {
        return;
    }

    LayerStates.capture(di, name);
    // The state you just saved is the one you are on.
    LayerManager.currentState = name;
    LayerManager.refreshStates();
};

/**
 * Overwrites the selected state from the current layer flags.
 *
 * Confirmed first: the button sits beside Save and the two are one glance
 * apart, and there is no undo for a state that has been overwritten.
 */
LayerManager.updateState = function() {
    var name = LayerManager.getSelectedState();
    if (isNull(name)) {
        return;
    }
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(),
        qsTr("Update Layer State"),
        qsTr("Overwrite the state \"%1\" with the layer visibility showing now?").arg(name),
        QMessageBox.Yes | QMessageBox.No);
    if (answer!==QMessageBox.Yes) {
        return;
    }

    LayerStates.capture(di, name);
};

LayerManager.deleteState = function() {
    var name = LayerManager.getSelectedState();
    if (isNull(name)) {
        return;
    }
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(),
        qsTr("Delete Layer State"),
        qsTr("Delete the layer state \"%1\"?\n\nLayers and groups are not affected.").arg(name),
        QMessageBox.Yes | QMessageBox.No);
    if (answer!==QMessageBox.Yes) {
        return;
    }

    LayerStates.remove(di, name);
    LayerManager.currentState = undefined;
    LayerManager.refreshStates();
};


/**
 * Renames the selected state.
 *
 * Renaming onto a name that already exists replaces it, the way the
 * group rename merges -- and the confirmation says so, because that one
 * cannot be undone either.
 */
LayerManager.renameState = function() {
    var name = LayerManager.getSelectedState();
    if (isNull(name)) {
        return;
    }
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var newName = RLayerTreeQt.promptName(qsTr("Rename State"),
        qsTr("State name:"), name);
    if (isNull(newName) || newName===name) {
        return;
    }

    var existing = LayerStates.listNames(di.getDocument()).indexOf(newName)>=0;
    if (existing) {
        var answer = QMessageBox.question(
            RMainWindowQt.getMainWindow(),
            qsTr("Rename State"),
            qsTr("There is already a state called \"%1\". Replace it?").arg(newName),
            QMessageBox.Yes | QMessageBox.No);
        if (answer!==QMessageBox.Yes) {
            return;
        }
    }

    LayerStates.rename(di, name, newName);
    LayerManager.currentState = newName;
    LayerManager.refreshStates();
};

/**
 * A file dialog for .clas, honouring the application's own preference
 * about native dialogs.
 *
 * QCAD answers that question once, in getDontUseNativeDialog(), from
 * the SaveAs/UseSystemFileDialog setting plus a KDE workaround. Going
 * straight to QFileDialog's static, as this did, silently took the
 * platform's dialog whatever the caver had chosen -- and the platform's
 * dialogs are exactly what differs between the three this runs on.
 *
 * \return The chosen path, or undefined. A cancelled dialog can answer
 * with a wrapped empty QString rather than null, so both are checked.
 */
LayerManager.fileDialog = function(saving, caption, startPath) {
    var filter = qsTr("CaveCAD layer states") +
        " (*." + LayerStates.FILE_SUFFIX + ")";
    var dialog = new QFileDialog(RMainWindowQt.getMainWindow(),
        caption, startPath, filter);
    dialog.setOption(QFileDialog.DontUseNativeDialog,
        getDontUseNativeDialog());
    dialog.fileMode = saving ? QFileDialog.AnyFile : QFileDialog.ExistingFile;
    if (saving) {
        dialog.acceptMode = QFileDialog.AcceptSave;
        dialog.defaultSuffix = LayerStates.FILE_SUFFIX;
    }
    else {
        dialog.acceptMode = QFileDialog.AcceptOpen;
    }

    var accepted = dialog.exec();
    var files = dialog.selectedFiles();
    destrDialog(dialog);

    if (!accepted || isNull(files) || files.length===0) {
        return undefined;
    }
    var path = String(files[0]);
    return (path==="") ? undefined : path;
};

/**
 * Writes every state in this drawing to a file.
 *
 * All of them, not the selected one: states are cheap to carry and a
 * caver exporting "Tracing" almost always wants "Plot ready" too. Import
 * is where the choosing happens, and it does not need to, because a
 * state that does not apply to the drawing is dropped there anyway.
 */
LayerManager.exportStates = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    var names = LayerStates.stateNames(reg);
    if (names.length===0) {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Export States"),
            qsTr("This drawing has no layer states to export."));
        return;
    }

    var suggested = new QFileInfo(String(doc.getFileName())).completeBaseName();
    if (suggested.length===0) {
        suggested = "layers";
    }
    var path = LayerManager.fileDialog(true,
        qsTr("Export Layer States"),
        QDir.homePath() + "/" + suggested + "." + LayerStates.FILE_SUFFIX);
    // A cancelled dialog can hand back a wrapped empty QString rather
    // than null, so both are checked.
    if (isNull(path) || String(path)==="") {
        return;
    }
    path = String(path);

    var data = LayerStates.toExport(reg, undefined, doc.getFileName());
    var file = new QFile(path);
    if (!file.open(QIODevice.WriteOnly | QIODevice.Text)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Export States"),
            qsTr("Could not write %1").arg(path));
        return;
    }
    var stream = new QTextStream(file);
    stream.writeString(JSON.stringify(data, null, 2));
    file.close();

    QMessageBox.information(RMainWindowQt.getMainWindow(),
        qsTr("Export States"),
        qsTr("Wrote %1 state(s) to %2").arg(names.length).arg(path));
};

/**
 * Reads states from a file into this drawing.
 *
 * Merged, never replaced wholesale: a state already here under the same
 * name is overwritten and everything else is left alone, so importing
 * cannot cost a caver a state they did not know was in the way. A layer
 * this drawing does not have is dropped, and the report says how many --
 * importing a cave's states into a different cave is a legitimate thing
 * to do and a silent partial result would not be.
 */
LayerManager.importStates = function() {
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    var path = LayerManager.fileDialog(false,
        qsTr("Import Layer States"), QDir.homePath());
    if (isNull(path) || String(path)==="") {
        return;
    }
    path = String(path);

    var file = new QFile(path);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Import States"), qsTr("Could not read %1").arg(path));
        return;
    }
    var stream = new QTextStream(file);
    var text = String(stream.readAll());
    file.close();

    var parsed = LayerStates.fromExport(text);
    if (!isNull(parsed.error)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(),
            qsTr("Import States"), parsed.error);
        return;
    }

    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    var result = LayerStates.importInto(reg, parsed.states,
        LayerGroups.layerNamesOf(doc));
    if (result.imported===0) {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Import States"),
            qsTr("None of those states mention a layer this drawing has."));
        return;
    }
    LayerGroups.writeRegistry(doc, reg);
    LayerManager.refreshStates();

    var lines = [qsTr("Imported %1 state(s).").arg(result.imported)];
    if (result.replaced>0) {
        lines.push(qsTr("%1 replaced a state of the same name.")
            .arg(result.replaced));
    }
    if (result.dropped>0) {
        lines.push(qsTr("%1 layer entries were dropped: this drawing has " +
            "no such layer.").arg(result.dropped));
    }
    if (result.skipped>0) {
        lines.push(qsTr("%1 state(s) were skipped: nothing in them " +
            "applies here.").arg(result.skipped));
    }
    QMessageBox.information(RMainWindowQt.getMainWindow(),
        qsTr("Import States"), lines.join("\n\n"));
};


// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

LayerManager.init = function(basePath) {
    var appWin = RMainWindowQt.getMainWindow();

    var action = new RGuiAction(qsTr("Layer &Manager"), appWin);
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/LayerManager.js");
    action.setDefaultShortcut(new QKeySequence("g,m"));
    action.setDefaultCommands(["gm"]);
    action.setGroupSortOrder(3600);
    action.setSortOrder(110);
    action.setWidgetNames(["ViewMenu", "WidgetsToolBar", "ViewToolsPanel", "WidgetMatrixPanel"]);

    var formWidget = WidgetFactory.createWidget(basePath, "LayerManager.ui");

    // The tree goes into its own layout so the filter stays above it and
    // the state and button rows stay below; appending to the outer layout
    // would drop it under everything.
    var outerLayout = formWidget.findChild("verticalLayout");
    var treeLayout = formWidget.findChild("treeLayout");
    var tree = new RLayerTreeQt(formWidget);
    tree.objectName = "LayerTree";
    treeLayout.addWidget(tree);
    LayerManager.tree = tree;

    // The tree takes every pixel the filter, the state row and the
    // buttons do not. Without this it sits at its size hint at the top
    // of the palette with dead space under it: the outer layout gives a
    // NESTED LAYOUT a stretch factor of zero whatever the widget inside
    // it asks for, so the tree's own Expanding size policy never gets a
    // say. Index 1 is treeLayout -- filter, tree, states, buttons.
    outerLayout.setStretch(1, 1);

    RSettings.setValue("LayerManager/AlternatingRowColor", new RColor(230, 235, 250), false);
    WidgetFactory.initList(tree, "LayerManager");

    var filter = formWidget.findChild("Filter");
    filter.textChanged.connect(function(text) {
        tree.setFilterText(text);
    });

    formWidget.findChild("StateButton").clicked.connect(
        LayerManager.showStateMenu);

    formWidget.findChild("SaveState").clicked.connect(LayerManager.saveState);
    formWidget.findChild("UpdateState").clicked.connect(LayerManager.updateState);
    formWidget.findChild("DeleteState").clicked.connect(LayerManager.deleteState);

    // The less-used state actions, behind one button so the row stays
    // four wide. The menu is held on LayerManager and not in a local:
    // popup() returns immediately, and a menu owned only by the function
    // that opened it goes out of scope while the user is reading it.
    LayerManager.stateMenu = new QMenu(formWidget);
    LayerManager.stateMenu.addAction(qsTr("Rename State..."))
        .triggered.connect(LayerManager.renameState);
    LayerManager.stateMenu.addSeparator();
    LayerManager.stateMenu.addAction(qsTr("Export States..."))
        .triggered.connect(LayerManager.exportStates);
    LayerManager.stateMenu.addAction(qsTr("Import States..."))
        .triggered.connect(LayerManager.importStates);

    var stateMenuButton = formWidget.findChild("StateMenu");
    stateMenuButton.setMenu(LayerManager.stateMenu);
    // Numeric, not QToolButton.InstantPopup: the enum NAMES are not
    // bound in this build and read as undefined, which sets popupMode to
    // 0 (press and hold) -- a menu that looks like it does not open,
    // with no error anywhere. Probed 2026-08-29.
    stateMenuButton.popupMode = 2;
    formWidget.findChild("NewGroup").clicked.connect(function() {
        tree.newGroup();
    });

    // The state list lives in the drawing, so it has to follow the
    // drawing. The tree is already listening for that; ride along.
    tree.onUpdate = LayerManager.refreshStates;

    var widgets = getWidgets(formWidget);
    widgets["ShowAll"].setDefaultAction(
            RGuiAction.getByScriptFile("scripts/Layer/ShowAllLayers/ShowAllLayers.js"));
    widgets["HideAll"].setDefaultAction(
            RGuiAction.getByScriptFile("scripts/Layer/HideAllLayers/HideAllLayers.js"));
    widgets["Add"].setDefaultAction(
            RGuiAction.getByScriptFile("scripts/Layer/AddLayer/AddLayer.js"));
    widgets["Remove"].setDefaultAction(
            RGuiAction.getByScriptFile("scripts/Layer/RemoveLayer/RemoveLayer.js"));
    widgets["Edit"].setDefaultAction(
            RGuiAction.getByScriptFile("scripts/Layer/EditLayer/EditLayer.js"));

    // Remove Layer must not offer to delete layer "0" or a protected one.
    tree.itemSelectionChanged.connect(function() {
        var removeAction = RGuiAction.getByScriptFile("scripts/Layer/RemoveLayer/RemoveLayer.js");
        if (isNull(removeAction)) {
            return;
        }
        var items = tree.selectedItems();
        if (items.length===0) {
            return;
        }
        var item = items[0];
        var isProtected = tree.isGroupItem(item) ||
            item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleProtected)===true;
        removeAction.setEnabledOverride(!isProtected, isProtected ? 0 : 1);
    });

    var dock = new RDockWidget(qsTr("Layer Manager"), appWin);
    dock.objectName = "LayerManagerDock";
    dock.setWidget(formWidget);
    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);

    dock.shown.connect(function() {
        action.setChecked(true);
        // Column widths only stick once the widget is visible (Qt 6.6.1).
        RLayerTreeQt.initColumnWidths(tree);
    });
    dock.hidden.connect(function() { action.setChecked(false); });

    var pl = new RPaletteListenerAdapter();
    appWin.addPaletteListener(pl);
    pl.paletteChanged.connect(RLayerTreeQt.initStyle);

    RLayerTreeQt.initStyle(false);
};

/**
 * Runs after every add-on has initialised, which is the only point at
 * which the stock Layer List's dock is guaranteed to exist.
 *
 * Tabs the two palettes together with Layer Manager in front, once. It is
 * gated on a setting because QCAD restores the user's dock layout on
 * every launch, and rearranging their palettes each time they start the
 * program would be a bug, not a feature.
 */
LayerManager.postInit = function(basePath) {
    if (RSettings.getBoolValue("LayerManager/Arranged", false)===true) {
        return;
    }

    var appWin = RMainWindowQt.getMainWindow();
    var ours = appWin.findChild("LayerManagerDock");
    var theirs = appWin.findChild("LayerListDock");
    if (isNull(ours)) {
        return;
    }

    if (!isNull(theirs)) {
        appWin.tabifyDockWidget(theirs, ours);
    }
    ours.visible = true;
    ours.raise();

    RSettings.setValue("LayerManager/Arranged", true);
};
