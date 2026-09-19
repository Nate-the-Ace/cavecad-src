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

LayerManager.getStateCombo = function() {
    return RMainWindowQt.getMainWindow().findChild("StateCombo");
};

/**
 * Reloads the state combo from the current drawing, keeping the entry
 * that was showing if it still exists.
 *
 * Signals are blocked throughout: repopulating a combo emits
 * currentIndexChanged, and letting that through would restore a layer
 * state every time the layer list refreshed.
 */
LayerManager.refreshStates = function() {
    var combo = LayerManager.getStateCombo();
    if (isNull(combo)) {
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

    var previous = String(combo.currentText);

    combo.blockSignals(true);
    combo.clear();
    combo.addItem(LayerManager.NoState);
    for (var i=0; i<names.length; i++) {
        combo.addItem(names[i]);
    }
    var idx = combo.findText(previous);
    combo.currentIndex = idx>=0 ? idx : 0;
    combo.blockSignals(false);
};

/** \return The selected state name, or undefined for the placeholder. */
LayerManager.getSelectedState = function() {
    var combo = LayerManager.getStateCombo();
    if (isNull(combo)) {
        return undefined;
    }
    var name = String(combo.currentText);
    return (name===LayerManager.NoState || name.length===0) ? undefined : name;
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
    LayerManager.refreshStates();

    var combo = LayerManager.getStateCombo();
    if (!isNull(combo)) {
        var idx = combo.findText(name);
        if (idx>=0) {
            combo.blockSignals(true);
            combo.currentIndex = idx;
            combo.blockSignals(false);
        }
    }
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
    LayerManager.refreshStates();
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

    var combo = formWidget.findChild("StateCombo");
    combo.activated.connect(function() {
        LayerManager.applySelectedState();
    });

    formWidget.findChild("SaveState").clicked.connect(LayerManager.saveState);
    formWidget.findChild("UpdateState").clicked.connect(LayerManager.updateState);
    formWidget.findChild("DeleteState").clicked.connect(LayerManager.deleteState);
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
