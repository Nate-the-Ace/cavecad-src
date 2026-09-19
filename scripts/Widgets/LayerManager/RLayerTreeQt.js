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

include("scripts/WidgetFactory.js");
// Sibling files are included through includeBasePath, not through a
// "scripts/"-rooted path. An add-on folder can live in the application
// bundle OR in the per-user scripts folder, and include() resolves a
// rooted path only against the bundle: from the per-user folder it
// reports "not found" and the next line dies with a bare "X is not
// defined". Same rule the Cave Survey suite follows.
include(includeBasePath + "/LayerGroups.js");
include(includeBasePath + "/LayerStates.js");

/**
 * \class RLayerTreeQt
 * \brief The Layer Manager's tree: groups, their layers, and a filter.
 *
 * Built on RTreeWidget for its itemColumnClicked signal, which is why
 * this palette needs no C++ at all. The stock Layer List packs freeze and
 * lock into one 32x16 image and works out which half was hit from the
 * click's x coordinate; a column each makes that hit test disappear
 * rather than get ported.
 *
 * There is no drag and drop. REcmaShellTreeWidget exposes only
 * contextMenuEvent, mousePressEvent, mouseReleaseEvent, mouseMoveEvent
 * and resizeEvent as overridable, so dropEvent cannot be reached from
 * script and a drop would silently do nothing. Filing layers into groups
 * is the context menu's job.
 */
function RLayerTreeQt(parent) {
    RTreeWidget.call(this, parent);

    this.di = undefined;

    /**
     * The registry as of the last refresh. The context menu reads it
     * rather than the document, so opening a menu costs no parse.
     */
    this.registry = LayerGroups.emptyRegistry();

    /** Current filter text, lower cased. Empty means no filter. */
    this.filterText = "";

    /**
     * Collapse state remembered while a filter is active, so clearing the
     * box puts the twisties back where the user left them instead of
     * leaving every group open.
     */
    this.collapsedBeforeFilter = undefined;

    this.header().close();
    this.iconSize = new QSize(16, 16);
    this.rootIsDecorated = true;
    this.indentation = 12;
    this.selectionMode = QAbstractItemView.ExtendedSelection;

    // Only the name column responds to selection; clicks in the icon
    // columns are toggles, not selections.
    this.setSelectableColumn(RLayerTreeQt.colName);
    this.columnCount = 3;

    this.header().stretchLastSection = false;
    if (RSettings.isQt(5)) {
        this.header().minimumSectionSize = 22;
        this.header().setSectionResizeMode(RLayerTreeQt.colName, QHeaderView.Stretch);
        this.header().setSectionResizeMode(RLayerTreeQt.colVisible, QHeaderView.Fixed);
        this.header().setSectionResizeMode(RLayerTreeQt.colLock, QHeaderView.Fixed);
    }
    else {
        this.header().setResizeMode(RLayerTreeQt.colName, QHeaderView.Stretch);
        this.header().setResizeMode(RLayerTreeQt.colVisible, QHeaderView.Fixed);
        this.header().setResizeMode(RLayerTreeQt.colLock, QHeaderView.Fixed);
    }
    RLayerTreeQt.initColumnWidths(this);

    var self = this;

    var appWin = EAction.getMainWindow();
    var adapter = new RLayerListenerAdapter();
    appWin.addLayerListener(adapter);
    adapter.layersUpdated.connect(function(di) { self.updateLayers(di); });
    adapter.currentLayerSet.connect(function(di) { self.updateLayers(di); });
    adapter.layersCleared.connect(function() { self.clearLayers(); });
    this.setProperty("listener", adapter);

    this.itemColumnClicked.connect(function(item, col) { self.itemColumnClickedSlot(item, col); });
    this.itemSelectionChanged.connect(function() { self.layerActivated(); });
    this.itemDoubleClicked.connect(function(item, col) { self.itemDoubleClickedSlot(item, col); });
    this.itemExpanded.connect(function(item) { self.rememberExpansion(item, true); });
    this.itemCollapsed.connect(function(item) { self.rememberExpansion(item, false); });

}

RLayerTreeQt.prototype = new RTreeWidget();

// The NAME IS COLUMN 0 and the toggles sit to its right, which is the
// opposite of BlockList's layout and not a style choice. A tree's
// indentation and expand arrow are drawn inside column 0, eating it from
// the left: with an icon there, every child row's icon was squeezed out
// of the 22px column and simply did not appear, while the group rows at
// depth 0 drew theirs fine. Measured in the running GUI -- widening
// column 0 to 60px brought the missing icons back. Putting the text in
// column 0 lets the indentation eat text instead, which is what
// indentation is for.
RLayerTreeQt.colName = 0;
RLayerTreeQt.colVisible = 1;
RLayerTreeQt.colLock = 2;

/** Item data roles. */
RLayerTreeQt.RoleType = Qt.UserRole;
RLayerTreeQt.RoleName = Qt.UserRole + 1;
RLayerTreeQt.RoleGroup = Qt.UserRole + 2;
RLayerTreeQt.RoleProtected = Qt.UserRole + 3;

RLayerTreeQt.TypeGroup = "group";
RLayerTreeQt.TypeLayer = "layer";

/**
 * The name stored on the Ungrouped row. It is not a group and never
 * reaches a layer's XDATA; it is the bucket every unfiled layer lands in.
 */
RLayerTreeQt.Ungrouped = "";

RLayerTreeQt.iconVisible = [];
RLayerTreeQt.iconLock = [];
RLayerTreeQt.iconVisibleMixed = undefined;
RLayerTreeQt.iconLockMixed = undefined;
RLayerTreeQt.includeBasePath = includeBasePath;

RLayerTreeQt.initColumnWidths = function(tree) {
    tree.setColumnWidth(RLayerTreeQt.colVisible, 22);
    tree.setColumnWidth(RLayerTreeQt.colLock, 22);
};

/**
 * Loads the status icons, adding the inverse set for selected rows when
 * the highlight colour would otherwise swallow them. Same rule as
 * BlockList.initStyle.
 */
RLayerTreeQt.initStyle = function(upd) {
    if (isNull(upd)) {
        upd = true;
    }
    var base = RLayerTreeQt.includeBasePath;

    RLayerTreeQt.iconVisible = [
        new QIcon(autoIconPath(base + "/LayerVisible0.svg")),
        new QIcon(autoIconPath(base + "/LayerVisible1.svg"))
    ];
    RLayerTreeQt.iconLock = [
        new QIcon(autoIconPath(base + "/LayerLock0.svg")),
        new QIcon(autoIconPath(base + "/LayerLock1.svg"))
    ];
    RLayerTreeQt.iconVisibleMixed = new QIcon(autoIconPath(base + "/LayerVisibleMixed.svg"));
    RLayerTreeQt.iconLockMixed = new QIcon(autoIconPath(base + "/LayerLockMixed.svg"));

    var appWin = EAction.getMainWindow();
    var tree = appWin.findChild("LayerTree");
    if (!isNull(tree)) {
        var highlightingIsDark = RSettings.getWidgetSelectionColor(tree).lightness()<128;
        var backgroundIsDark = RSettings.hasDarkGuiBackground();
        if (backgroundIsDark && !highlightingIsDark || !backgroundIsDark && highlightingIsDark) {
            RLayerTreeQt.iconVisible[0].addFile(autoIconPath(base + "/LayerVisible0.svg", true), new QSize(), QIcon.Selected);
            RLayerTreeQt.iconVisible[1].addFile(autoIconPath(base + "/LayerVisible1.svg", true), new QSize(), QIcon.Selected);
            RLayerTreeQt.iconLock[0].addFile(autoIconPath(base + "/LayerLock0.svg", true), new QSize(), QIcon.Selected);
            RLayerTreeQt.iconLock[1].addFile(autoIconPath(base + "/LayerLock1.svg", true), new QSize(), QIcon.Selected);
            RLayerTreeQt.iconVisibleMixed.addFile(autoIconPath(base + "/LayerVisibleMixed.svg", true), new QSize(), QIcon.Selected);
            RLayerTreeQt.iconLockMixed.addFile(autoIconPath(base + "/LayerLockMixed.svg", true), new QSize(), QIcon.Selected);
        }
    }

    if (upd) {
        appWin.notifyLayerListeners(EAction.getDocumentInterface(), []);
    }
};

/**
 * \return Number of top level (group) rows.
 *
 * QTreeWidget is a QObject, so topLevelItemCount is exposed both as a Qt
 * property and as a method, and which one the bridge hands back is not
 * guaranteed per member -- reading the wrong form yields the function
 * object, and `i < functionObject` is false, so a loop written the
 * obvious way silently never runs. QTreeWidgetItem is not a QObject and
 * has no properties at all, which is why childCount() elsewhere in this
 * file is safe to call directly.
 */
RLayerTreeQt.prototype.getTopLevelCount = function() {
    var v = this.topLevelItemCount;
    return (typeof(v)==="function") ? this.topLevelItemCount() : v;
};

RLayerTreeQt.prototype.toString = function() {
    return "RLayerTreeQt()";
};


// ---------------------------------------------------------------------
// Collapse state
//
// Which groups are collapsed is a view preference, not drawing data.
// Keeping it in RSettings means opening a twisty never marks the document
// modified, and the layout survives closing the drawing.
// ---------------------------------------------------------------------

RLayerTreeQt.prototype.getCollapsedNames = function() {
    var raw = RSettings.getStringValue("LayerManager/Collapsed", "");
    if (isNull(raw) || raw.length===0) {
        return [];
    }
    return String(raw).split(LayerGroups.SEP);
};

RLayerTreeQt.prototype.setCollapsedNames = function(names) {
    RSettings.setValue("LayerManager/Collapsed", names.join(LayerGroups.SEP));
};

/**
 * Records a twisty the user opened or closed. Ignored while a filter is
 * active: the expansion you see then was forced by the filter, and saving
 * it would overwrite the layout the user actually chose.
 */
RLayerTreeQt.prototype.rememberExpansion = function(item, expanded) {
    if (this.filterText.length>0 || isNull(item)) {
        return;
    }
    if (item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleType)!==RLayerTreeQt.TypeGroup) {
        return;
    }
    var name = String(item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleName));
    var names = this.getCollapsedNames();
    var idx = names.indexOf(name);
    if (expanded && idx>=0) {
        names.splice(idx, 1);
        this.setCollapsedNames(names);
    }
    else if (!expanded && idx<0) {
        names.push(name);
        this.setCollapsedNames(names);
    }
};


// ---------------------------------------------------------------------
// Building the tree
// ---------------------------------------------------------------------

RLayerTreeQt.prototype.clearLayers = function() {
    this.clear();
};

/**
 * Rebuilds the whole tree. Called for every layer change, as the stock
 * layer list does -- a layer document is small and a full rebuild avoids
 * an entire class of stale-row bug.
 */
RLayerTreeQt.prototype.updateLayers = function(documentInterface) {
    this.di = documentInterface;

    if (RLayerTreeQt.iconVisible.length===0) {
        RLayerTreeQt.initStyle(false);
    }

    var pos = this.verticalScrollBar().sliderPosition;

    this.blockSignals(true);
    this.clear();

    if (isNull(documentInterface)) {
        this.blockSignals(false);
        return;
    }

    var doc = documentInterface.getDocument();
    var collapsed = this.getCollapsedNames();

    // layer name -> layer, kept so a layer in several groups is queried once:
    var layers = {};
    var names = [];
    var ids = doc.queryAllLayers();
    for (var i=0; i<ids.length; i++) {
        var layer = doc.queryLayer(ids[i]);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        var ln = layer.getName();
        layers[ln] = layer;
        names.push(ln);
    }
    names.sort();

    // readRegistry sweeps names the document no longer has, so a group
    // cannot show a layer that was deleted behind this palette's back.
    this.registry = LayerGroups.readRegistry(doc);
    var groupNames = LayerGroups.groupNames(this.registry);

    // group name -> member layer names, in the document's sorted order
    // rather than the order they were filed, plus the unfiled ones:
    var members = {};
    var g;
    for (g=0; g<groupNames.length; g++) {
        members[groupNames[g]] = [];
    }
    var ungrouped = [];
    for (var n=0; n<names.length; n++) {
        var name = names[n];
        var own = LayerGroups.groupsOfLayer(this.registry, name);
        for (var k=0; k<own.length; k++) {
            members[own[k]].push(name);
        }
        if (own.length===0) {
            ungrouped.push(name);
        }
    }

    var topLevel = LayerGroups.topLevelGroups(this.registry);
    for (g=0; g<topLevel.length; g++) {
        this.addGroup(topLevel[g], topLevel[g], members, layers, collapsed, undefined);
    }
    // Ungrouped is always last, takes no children, and is not a group:
    // it cannot be deleted or stored in the registry. It CAN be renamed
    // -- see LayerGroups.ungroupedLabel -- because a caver who has filed
    // everything else deserves to say what the remainder is.
    var ungroupedMembers = {};
    ungroupedMembers[RLayerTreeQt.Ungrouped] = ungrouped;
    this.addGroup(RLayerTreeQt.Ungrouped, this.ungroupedLabel(), ungroupedMembers,
                  layers, collapsed, undefined);

    this.blockSignals(false);

    this.applyFilter();
    this.selectCurrentLayer();

    this.verticalScrollBar().sliderPosition = pos;

    // Lets the palette around the tree refresh with it -- the state combo
    // has to follow a document change, and the tree is the only thing
    // here listening for one.
    if (isFunction(this.onUpdate)) {
        this.onUpdate();
    }
};

/**
 * Builds one group row and everything inside it.
 *
 * \param members The whole group-name -> layer-names map, not one
 *        group's slice, because a parent has to reach its children's.
 * \param parentItem The row to nest under, or undefined for top level.
 *
 * Nested groups are added BEFORE the parent's own member layers, so a
 * subgroup never hides at the bottom of a long list of layers.
 */
RLayerTreeQt.prototype.addGroup = function(name, label, members, layers, collapsed, parentItem) {
    var item = new QTreeWidgetItem();
    item.setText(RLayerTreeQt.colName, label);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleType, RLayerTreeQt.TypeGroup);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleName, name);

    var font = item.font(RLayerTreeQt.colName);
    font.setBold(true);
    item.setFont(RLayerTreeQt.colName, font);

    if (isNull(parentItem)) {
        this.addTopLevelItem(item);
    }
    else {
        parentItem.addChild(item);
    }

    var i;
    if (name!==RLayerTreeQt.Ungrouped) {
        var kids = LayerGroups.childrenOf(this.registry, name);
        for (i=0; i<kids.length; i++) {
            this.addGroup(kids[i], kids[i], members, layers, collapsed, item);
        }
    }

    var memberNames = isNull(members[name]) ? [] : members[name];
    for (i=0; i<memberNames.length; i++) {
        item.addChild(this.createLayerItem(layers[memberNames[i]], name));
    }

    this.updateGroupIcons(item, layers);
    item.setExpanded(collapsed.indexOf(name)<0);
    return item;
};

/** \return What the Ungrouped row is called in this drawing. */
RLayerTreeQt.prototype.ungroupedLabel = function() {
    var label = this.registry.ungroupedLabel;
    return (isNull(label) || String(label).length===0) ? qsTr("Ungrouped") : String(label);
};

RLayerTreeQt.prototype.createLayerItem = function(layer, groupName) {
    var item = new QTreeWidgetItem();
    var name = layer.getName();

    item.setText(RLayerTreeQt.colName, name);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleType, RLayerTreeQt.TypeLayer);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleName, name);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleGroup, groupName);
    // Layer "0" is protected by QCAD itself; others can be flagged.
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleProtected,
                 name==="0" || (isFunction(layer.isProtected) && layer.isProtected()));

    this.updateLayerIcons(item, layer);
    return item;
};

RLayerTreeQt.prototype.updateLayerIcons = function(item, layer) {
    item.setIcon(RLayerTreeQt.colVisible, RLayerTreeQt.iconVisible[Number(!layer.isOffOrFrozen())]);
    item.setIcon(RLayerTreeQt.colLock, RLayerTreeQt.iconLock[Number(layer.isLocked())]);
};

/**
 * Draws a group's own eye and lock from its members: all on, all off, or
 * mixed.
 *
 * Nothing about a group's visibility is stored. That is deliberate -- a
 * stored group flag can disagree with its members, and then the palette
 * has to decide which one is lying.
 */
/**
 * \return Every LAYER row under \c item, at any depth.
 *
 * Walked over the tree rather than looked up in the registry, so a group
 * row answers for exactly what is drawn inside it -- including the rows
 * a filter has hidden, which must still be toggled by their group.
 */
RLayerTreeQt.prototype.collectLayerItems = function(item) {
    var res = [];
    for (var i=0; i<item.childCount(); i++) {
        var child = item.child(i);
        if (this.isGroupItem(child)) {
            res = res.concat(this.collectLayerItems(child));
        }
        else {
            res.push(child);
        }
    }
    return res;
};

/**
 * Draws a group's own eye and lock from every layer under it, nested
 * groups included: all on, all off, or mixed.
 *
 * Nothing about a group's visibility is stored. That is deliberate -- a
 * stored group flag can disagree with its members, and then the palette
 * has to decide which one is lying.
 */
RLayerTreeQt.prototype.updateGroupIcons = function(groupItem, layers) {
    var rows = this.collectLayerItems(groupItem);
    if (rows.length===0) {
        groupItem.setIcon(RLayerTreeQt.colVisible, RLayerTreeQt.iconVisibleMixed);
        groupItem.setIcon(RLayerTreeQt.colLock, RLayerTreeQt.iconLockMixed);
        return;
    }

    var visible = 0, locked = 0, counted = 0;
    for (var i=0; i<rows.length; i++) {
        var layer = layers[String(rows[i].data(RLayerTreeQt.colName, RLayerTreeQt.RoleName))];
        if (isNull(layer)) {
            continue;
        }
        counted++;
        if (!layer.isOffOrFrozen()) {
            visible++;
        }
        if (layer.isLocked()) {
            locked++;
        }
    }
    if (counted===0) {
        return;
    }

    if (visible===0) {
        groupItem.setIcon(RLayerTreeQt.colVisible, RLayerTreeQt.iconVisible[0]);
    }
    else if (visible===counted) {
        groupItem.setIcon(RLayerTreeQt.colVisible, RLayerTreeQt.iconVisible[1]);
    }
    else {
        groupItem.setIcon(RLayerTreeQt.colVisible, RLayerTreeQt.iconVisibleMixed);
    }

    if (locked===0) {
        groupItem.setIcon(RLayerTreeQt.colLock, RLayerTreeQt.iconLock[0]);
    }
    else if (locked===counted) {
        groupItem.setIcon(RLayerTreeQt.colLock, RLayerTreeQt.iconLock[1]);
    }
    else {
        groupItem.setIcon(RLayerTreeQt.colLock, RLayerTreeQt.iconLockMixed);
    }
};


// ---------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------

RLayerTreeQt.prototype.setFilterText = function(text) {
    var had = this.filterText.length>0;
    this.filterText = isNull(text) ? "" : String(text).toLowerCase().trim();

    if (!had && this.filterText.length>0) {
        // Entering a filter: park the real collapse state so clearing the
        // box can put it back.
        this.collapsedBeforeFilter = this.getCollapsedNames();
    }
    this.applyFilter();

    if (had && this.filterText.length===0 && !isNull(this.collapsedBeforeFilter)) {
        this.restoreExpansion(this.collapsedBeforeFilter);
        this.collapsedBeforeFilter = undefined;
    }
};

/**
 * Hides rows that do not match. A group survives if its own name matches
 * or any member does; a group whose name matches keeps all its members,
 * so filtering by group name is a way to see the group whole.
 */
RLayerTreeQt.prototype.applyFilter = function() {
    for (var i=0; i<this.getTopLevelCount(); i++) {
        this.filterGroup(this.topLevelItem(i), false);
    }
};

/**
 * Hides what does not match, one group and everything inside it.
 *
 * \param inherited True when an ancestor group's own name matched, which
 *        shows the whole subtree: filtering by a group name is how you
 *        ask to see that group whole.
 * \return True if anything under \c groupItem is still visible.
 */
RLayerTreeQt.prototype.filterGroup = function(groupItem, inherited) {
    var f = this.filterText;
    var label = String(groupItem.text(RLayerTreeQt.colName)).toLowerCase();
    var matches = inherited || f.length===0 || label.indexOf(f)>=0;

    var shown = 0;
    for (var i=0; i<groupItem.childCount(); i++) {
        var child = groupItem.child(i);
        if (this.isGroupItem(child)) {
            if (this.filterGroup(child, matches)) {
                shown++;
            }
            continue;
        }
        var layerName = String(child.text(RLayerTreeQt.colName)).toLowerCase();
        var hit = matches || layerName.indexOf(f)>=0;
        child.setHidden(!hit);
        if (hit) {
            shown++;
        }
    }

    // An empty group stays visible under a name match, so you can still
    // see that it exists and file layers into it.
    var visible = matches || shown>0;
    groupItem.setHidden(!visible);
    if (f.length>0 && visible) {
        groupItem.setExpanded(true);
    }
    return visible;
};

RLayerTreeQt.prototype.restoreExpansion = function(collapsedNames) {
    for (var i=0; i<this.getTopLevelCount(); i++) {
        this.restoreExpansionOf(this.topLevelItem(i), collapsedNames);
    }
};

RLayerTreeQt.prototype.restoreExpansionOf = function(groupItem, collapsedNames) {
    var name = String(groupItem.data(RLayerTreeQt.colName, RLayerTreeQt.RoleName));
    groupItem.setExpanded(collapsedNames.indexOf(name)<0);
    for (var i=0; i<groupItem.childCount(); i++) {
        var child = groupItem.child(i);
        if (this.isGroupItem(child)) {
            this.restoreExpansionOf(child, collapsedNames);
        }
    }
};


// ---------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------

RLayerTreeQt.prototype.isGroupItem = function(item) {
    return !isNull(item) &&
        item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleType)===RLayerTreeQt.TypeGroup;
};

RLayerTreeQt.prototype.getItemName = function(item) {
    if (isNull(item)) {
        return undefined;
    }
    return String(item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleName));
};

/**
 * \return Names of the selected layers, deduplicated.
 *
 * A layer filed in two groups has two rows, and selecting both must not
 * make it get added to a group twice or modified twice in one operation.
 */
RLayerTreeQt.prototype.getSelectedLayerNames = function() {
    var res = [];
    var items = this.selectedItems();
    for (var i=0; i<items.length; i++) {
        if (this.isGroupItem(items[i])) {
            continue;
        }
        var name = this.getItemName(items[i]);
        if (!isNull(name) && res.indexOf(name)<0) {
            res.push(name);
        }
    }
    return res;
};

/** \return The group name of the selected row, or undefined. */
RLayerTreeQt.prototype.getSelectedGroupName = function() {
    var items = this.selectedItems();
    if (items.length===0) {
        return undefined;
    }
    var item = items[0];
    if (this.isGroupItem(item)) {
        return this.getItemName(item);
    }
    var g = item.data(RLayerTreeQt.colName, RLayerTreeQt.RoleGroup);
    return isNull(g) ? undefined : String(g);
};

RLayerTreeQt.prototype.selectCurrentLayer = function() {
    if (isNull(this.di)) {
        return;
    }
    var doc = this.di.getDocument();
    var layer = doc.queryCurrentLayer();
    if (isFunction(layer.isNull) && layer.isNull()) {
        return;
    }
    var name = layer.getName();

    this.blockSignals(true);
    for (var i=0; i<this.getTopLevelCount(); i++) {
        var found = this.findLayerRow(this.topLevelItem(i), name);
        if (!isNull(found)) {
            this.setCurrentItem(found);
            break;
        }
    }
    this.blockSignals(false);
};

/** \return The first visible row for layer \c name under \c item. */
RLayerTreeQt.prototype.findLayerRow = function(item, name) {
    for (var i=0; i<item.childCount(); i++) {
        var child = item.child(i);
        if (this.isGroupItem(child)) {
            var deeper = this.findLayerRow(child, name);
            if (!isNull(deeper)) {
                return deeper;
            }
            continue;
        }
        if (this.getItemName(child)===name && !child.isHidden()) {
            return child;
        }
    }
    return undefined;
};


// ---------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------

/**
 * Sets the current layer from the selection.
 *
 * Only a single layer row sets it. A multiple selection is a group
 * operation in progress, and quietly switching the current layer to
 * whichever row happened to be first is how the next thing you draw ends
 * up somewhere you did not choose.
 */
RLayerTreeQt.prototype.layerActivated = function() {
    if (isNull(this.di)) {
        return;
    }
    var items = this.selectedItems();
    if (items.length!==1 || this.isGroupItem(items[0])) {
        return;
    }
    var name = this.getItemName(items[0]);
    if (isNull(name)) {
        return;
    }

    this.blockSignals(true);
    this.di.setCurrentLayer(name);
    this.blockSignals(false);
};

RLayerTreeQt.prototype.itemDoubleClickedSlot = function(item, column) {
    if (isNull(this.di) || isNull(item) || column!==RLayerTreeQt.colName) {
        return;
    }
    if (this.isGroupItem(item)) {
        item.setExpanded(!item.isExpanded());
        return;
    }
    if (!this.di.hasSelection()) {
        var a = RGuiAction.getByScriptFile("scripts/Layer/EditLayer/EditLayer.js");
        if (!isNull(a)) {
            a.slotTrigger();
        }
        return;
    }
    var op = new RChangePropertyOperation(REntity.PropertyLayer, this.getItemName(item));
    this.di.applyOperation(op);
};

RLayerTreeQt.prototype.itemColumnClickedSlot = function(item, column) {
    if (isNull(this.di) || isNull(item)) {
        return;
    }
    if (column!==RLayerTreeQt.colVisible && column!==RLayerTreeQt.colLock) {
        return;
    }

    if (this.isGroupItem(item)) {
        this.toggleGroup(item, column);
    }
    else {
        this.toggleLayers([ this.getItemName(item) ], column);
    }
};

/**
 * Toggles every member of a group together.
 *
 * The target is decided once from the group as a whole, not per layer:
 * clicking a mixed group turns all of it off, and clicking again turns
 * all of it on. Toggling each member independently would leave a mixed
 * group mixed forever, just inverted.
 */
RLayerTreeQt.prototype.toggleGroup = function(groupItem, column) {
    var doc = this.di.getDocument();
    var rows = this.collectLayerItems(groupItem);
    var names = [];
    var anyOn = false;

    for (var i=0; i<rows.length; i++) {
        var name = this.getItemName(rows[i]);
        if (names.indexOf(name)>=0) {
            continue;   // the same layer filed in two nested groups
        }
        var layer = doc.queryLayer(name);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        names.push(name);
        if (column===RLayerTreeQt.colVisible) {
            if (!layer.isOffOrFrozen()) {
                anyOn = true;
            }
        }
        else if (!layer.isLocked()) {
            anyOn = true;
        }
    }

    if (names.length===0) {
        return;
    }
    // Visible: any visible means hide all. Lock: any unlocked means lock all.
    this.toggleLayers(names, column, column===RLayerTreeQt.colVisible ? !anyOn : anyOn);
};

/**
 * Applies a visibility or lock change to \c names in one transaction.
 *
 * \param target Optional explicit target state. Omitted, each layer is
 * inverted individually, which is what a click on a single row means.
 */
RLayerTreeQt.prototype.toggleLayers = function(names, column, target) {
    var doc = this.di.getDocument();
    var op = new RModifyObjectsOperation();
    op.setTransactionType(RTransaction.LayerVisibilityStatusChange);

    var changed = 0;
    for (var i=0; i<names.length; i++) {
        var layer = doc.queryLayer(names[i]);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        if (column===RLayerTreeQt.colVisible) {
            var off = isNull(target) ? !layer.isOffOrFrozen() : !target;
            // Frozen and off move together, as the stock layer list does:
            // one of the two alone leaves a layer that is hidden by one
            // measure and shown by the other.
            layer.setFrozen(off);
            layer.setOff(off);
        }
        else {
            layer.setLocked(isNull(target) ? !layer.isLocked() : target);
        }
        op.addObject(layer);
        changed++;
    }

    if (changed===0) {
        return;
    }
    this.di.applyOperation(op);
    this.di.clearPreview();
    this.di.repaintViews();
    this.updateLayers(this.di);
};


// ---------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------

/** \return True if \c name is a real group and not the Ungrouped bucket. */
RLayerTreeQt.prototype.isRealGroup = function(name) {
    return !isNull(name) && String(name).length>0;
};

RLayerTreeQt.prototype.contextMenuEvent = function(e) {
    var item = this.itemAt(e.pos());
    if (!isNull(item) && !item.isSelected()) {
        // Right clicking outside the selection acts on the row under the
        // cursor, not on whatever was selected before.
        this.setCurrentItem(item);
    }

    var self = this;
    var menu = new QMenu(this);
    menu.objectName = "ContextMenu";

    var groupName = this.getSelectedGroupName();
    var layerNames = this.getSelectedLayerNames();
    var onGroupRow = this.isGroupItem(item);

    var a = menu.addAction(qsTr("New Group..."));
    a.triggered.connect(function() { self.newGroup(); });

    if (onGroupRow && this.isRealGroup(groupName)) {
        a = menu.addAction(qsTr("New Group Inside..."));
        a.setEnabled(isNull(LayerGroups.parentOf(this.registry, groupName)));
        a.triggered.connect(function() { self.newGroup(groupName); });

        a = menu.addAction(qsTr("Rename Group..."));
        a.triggered.connect(function() { self.renameGroup(groupName); });

        if (!isNull(LayerGroups.parentOf(this.registry, groupName))) {
            a = menu.addAction(qsTr("Move to Top Level"));
            a.triggered.connect(function() { self.unnestGroup(groupName); });
        }

        a = menu.addAction(qsTr("Delete Group"));
        a.triggered.connect(function() { self.deleteGroup(groupName); });
    }
    else if (onGroupRow) {
        // The Ungrouped row. It is not a group and never will be, but
        // what it is CALLED is the caver's to decide: once everything
        // else is filed, "Ungrouped" is the wrong word for whatever is
        // left.
        a = menu.addAction(qsTr("Rename Ungrouped..."));
        a.triggered.connect(function() { self.renameUngrouped(); });
    }

    if (layerNames.length>0) {
        menu.addSeparator();

        var groups = LayerGroups.groupNames(this.registry);
        // Built as an object and handed to addMenu, which is the form
        // QCAD's own menu code uses. The addMenu(QString) overload exists
        // in the bridge but is not exercised anywhere in the app, and a
        // menu that silently fails to open is this bridge's signature
        // failure mode.
        var addMenu = new QMenu(qsTr("Add to Group"), menu);
        menu.addMenu(addMenu);
        var added = 0;
        for (var i=0; i<groups.length; i++) {
            if (!this.isRealGroup(groups[i])) {
                continue;
            }
            // Bind the name per iteration: a closure over the loop
            // variable would give every entry the last group.
            addMenu.addAction(groups[i]).triggered.connect(
                (function(name) {
                    return function() { self.addLayersToGroup(layerNames, name); };
                })(groups[i]));
            added++;
        }
        if (added>0) {
            addMenu.addSeparator();
        }
        addMenu.addAction(qsTr("New Group...")).triggered.connect(function() { self.newGroup(); });

        if (this.isRealGroup(groupName) && !onGroupRow) {
            a = menu.addAction(qsTr("Remove from \"%1\"").arg(groupName));
            a.triggered.connect(function() { self.removeLayersFromGroup(layerNames, groupName); });
        }
    }

    menu.addSeparator();
    RLayerTreeQt.addLayerActions(menu);

    menu.exec(QCursor.pos());
    e.ignore();
};

/** Adds the stock layer actions, so this palette loses nothing the old one had. */
RLayerTreeQt.addLayerActions = function(menu) {
    var files = [
        "scripts/Layer/ToggleLayerVisibility/ToggleLayerVisibility.js",
        "scripts/Layer/ShowAllLayers/ShowAllLayers.js",
        "scripts/Layer/HideAllLayers/HideAllLayers.js",
        "scripts/Layer/ShowActiveLayer/ShowActiveLayer.js",
        "scripts/Layer/AddLayer/AddLayer.js",
        "scripts/Layer/RemoveLayer/RemoveLayer.js",
        "scripts/Layer/EditLayer/EditLayer.js",
        "scripts/Layer/SelectLayer/SelectLayer.js",
        "scripts/Layer/DeselectLayer/DeselectLayer.js"
    ];
    for (var i=0; i<files.length; i++) {
        var action = RGuiAction.getByScriptFile(files[i]);
        if (!isNull(action)) {
            action.addToMenu(menu);
        }
    }
};


// ---------------------------------------------------------------------
// Group operations
// ---------------------------------------------------------------------

/**
 * Asks for a group or state name and validates it.
 * \return The trimmed name, or undefined if the user cancelled or the
 * name was rejected.
 */
RLayerTreeQt.promptName = function(title, label, initial) {
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setWindowTitle(title);
    dialog.setLabelText(label);
    dialog.setTextValue(isNull(initial) ? "" : initial);

    var accepted = dialog.exec();
    var value = String(dialog.textValue());
    destrDialog(dialog);

    if (!accepted) {
        return undefined;
    }

    var err = LayerGroups.nameError(value);
    if (!isNull(err)) {
        QMessageBox.warning(RMainWindowQt.getMainWindow(), title, err);
        return undefined;
    }
    return value.trim();
};

/**
 * Creates a group, filing the selected layers into it if any are
 * selected. An existing name is reused rather than refused: asking for a
 * group you already have is a filing request, not a mistake.
 */
RLayerTreeQt.prototype.newGroup = function(parent) {
    if (isNull(this.di)) {
        return;
    }
    var title = isNull(parent) ? qsTr("New Group") : qsTr("New Group Inside");
    var name = RLayerTreeQt.promptName(title, qsTr("Group name:"));
    if (isNull(name)) {
        return;
    }

    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    LayerGroups.createGroup(reg, name, parent);

    // The selection is filed in the same write, so a group made with
    // layers selected costs one document change rather than two.
    var selected = this.getSelectedLayerNames();
    for (var i=0; i<selected.length; i++) {
        LayerGroups.addTo(reg, selected[i], name);
    }

    LayerGroups.writeRegistry(doc, reg);
    this.updateLayers(this.di);
};

RLayerTreeQt.prototype.renameGroup = function(oldName) {
    if (isNull(this.di) || !this.isRealGroup(oldName)) {
        return;
    }
    var newName = RLayerTreeQt.promptName(qsTr("Rename Group"), qsTr("Group name:"), oldName);
    if (isNull(newName) || newName===oldName) {
        return;
    }

    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (LayerGroups.renameGroup(reg, oldName, newName)) {
        LayerGroups.writeRegistry(doc, reg);
    }
    this.updateLayers(this.di);
};

/**
 * Deletes a group. Its members lose that one membership and nothing else
 * -- no layer is ever deleted here, which is why the confirmation says so
 * out loud.
 */
RLayerTreeQt.prototype.deleteGroup = function(name) {
    if (isNull(this.di) || !this.isRealGroup(name)) {
        return;
    }

    var answer = QMessageBox.question(
        RMainWindowQt.getMainWindow(),
        qsTr("Delete Group"),
        qsTr("Delete the group \"%1\"?\n\nIts layers are not deleted. They move to Ungrouped unless they belong to another group.").arg(name),
        QMessageBox.Yes | QMessageBox.No);
    // Never truthy-test this: No comes back as 65536, which is truthy.
    if (answer!==QMessageBox.Yes) {
        return;
    }

    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (LayerGroups.deleteGroup(reg, name)) {
        LayerGroups.writeRegistry(doc, reg);
    }
    this.updateLayers(this.di);
};

/** Moves a nested group back out to the top level. */
RLayerTreeQt.prototype.unnestGroup = function(name) {
    if (isNull(this.di) || !this.isRealGroup(name)) {
        return;
    }
    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (LayerGroups.setParent(reg, name, undefined)) {
        LayerGroups.writeRegistry(doc, reg);
    }
    this.updateLayers(this.di);
};

/**
 * Renames the Ungrouped row.
 *
 * Stored as a label on the registry, not as a group: the row still
 * holds exactly the layers that are in no group, still sits last, and
 * still cannot be deleted. An empty answer puts the default back.
 */
RLayerTreeQt.prototype.renameUngrouped = function() {
    if (isNull(this.di)) {
        return;
    }
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setWindowTitle(qsTr("Rename Ungrouped"));
    dialog.setLabelText(qsTr("Name for the layers in no group (blank for the default):"));
    dialog.setTextValue(this.ungroupedLabel());
    var accepted = dialog.exec();
    var value = String(dialog.textValue()).trim();
    destrDialog(dialog);
    if (!accepted) {
        return;
    }

    if (value.length>0) {
        var err = LayerGroups.nameError(value);
        if (!isNull(err)) {
            QMessageBox.warning(RMainWindowQt.getMainWindow(),
                qsTr("Rename Ungrouped"), err);
            return;
        }
    }

    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    reg.ungroupedLabel = value.length>0 ? value : undefined;
    LayerGroups.writeRegistry(doc, reg);
    this.updateLayers(this.di);
};

RLayerTreeQt.prototype.addLayersToGroup = function(layerNames, groupName) {
    this.changeMembership(layerNames, groupName, true);
};

RLayerTreeQt.prototype.removeLayersFromGroup = function(layerNames, groupName) {
    this.changeMembership(layerNames, groupName, false);
};

/**
 * Files or unfiles layers in one registry write.
 *
 * Membership is not on the undo stack: it lives in document variables,
 * which are not transactional. Filing a layer changes no geometry, and
 * an undo of a drawing edit that silently unfiled a layer would be the
 * more surprising of the two behaviours.
 */
RLayerTreeQt.prototype.changeMembership = function(layerNames, groupName, add) {
    if (isNull(this.di) || !this.isRealGroup(groupName) || layerNames.length===0) {
        return;
    }

    var doc = this.di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    var changed = false;
    for (var i=0; i<layerNames.length; i++) {
        var did = add ? LayerGroups.addTo(reg, layerNames[i], groupName)
                      : LayerGroups.removeFrom(reg, layerNames[i], groupName);
        changed = changed || did;
    }

    if (changed) {
        LayerGroups.writeRegistry(doc, reg);
        this.updateLayers(this.di);
    }
};
