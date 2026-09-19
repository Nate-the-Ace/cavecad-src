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
include(includeBasePath + "/LayerFilter.js");

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
    var self = this;

    // The live tree, for the one place a deferred callback needs it.
    // A QTimer closure that captures the widget is the shape that
    // crashes; resolving a static at fire time is the shape that does
    // not.
    RLayerTreeQt.instance = this;

    this.registry = LayerGroups.emptyRegistry();

    /** Current filter text, lower cased. Empty means no filter. */
    this.filterText = "";

    /** What that text compiles to; undefined when there is no filter. */
    this.matcher = undefined;

    /**
     * Collapse state remembered while a filter is active, so clearing the
     * box puts the twisties back where the user left them instead of
     * leaving every group open.
     */
    this.collapsedBeforeFilter = undefined;

    this.header().setVisible(true);
    this.setHeaderLabels([qsTr("Layer"), qsTr("On"), qsTr("Freeze"),
        qsTr("Lock"), qsTr("Plot"), qsTr("Color"), qsTr("Linetype"),
        qsTr("Lineweight")]);
    this.iconSize = new QSize(16, 16);
    this.rootIsDecorated = true;
    this.indentation = 12;
    this.selectionMode = QAbstractItemView.ExtendedSelection;
    this.setAllColumnsShowFocus(true);

    // Only the name column responds to selection; a click anywhere else
    // is a toggle or an edit, not a change of what is selected.
    this.setSelectableColumn(RLayerTreeQt.colName);
    this.columnCount = RLayerTreeQt.COLUMNS;

    this.header().stretchLastSection = false;
    if (RSettings.isQt(5)) {
        this.header().minimumSectionSize = 22;
        this.header().setSectionResizeMode(RLayerTreeQt.colName, QHeaderView.Stretch);
        for (var ci=1; ci<RLayerTreeQt.COLUMNS; ci++) {
            this.header().setSectionResizeMode(ci, QHeaderView.Interactive);
        }
    }
    else {
        this.header().setResizeMode(RLayerTreeQt.colName, QHeaderView.Stretch);
        for (var cj=1; cj<RLayerTreeQt.COLUMNS; cj++) {
            this.header().setResizeMode(cj, QHeaderView.Interactive);
        }
    }

    // Eight columns do not fit a narrow dock, so which ones show is the
    // caver's choice and is remembered. Right-click the header.
    this.header().contextMenuPolicy = Qt.CustomContextMenu;
    this.header().customContextMenuRequested.connect(
        function(pos) { self.headerMenu(pos); });
    this.applyColumnVisibility();

    RLayerTreeQt.initColumnWidths(this);

    var appWin = EAction.getMainWindow();
    var adapter = new RLayerListenerAdapter();
    appWin.addLayerListener(adapter);
    adapter.layersUpdated.connect(function(di) { self.updateLayers(di); });
    // The CURRENT LAYER changing moves the selection and rebuilds
    // nothing. The stock layer list rebuilds here, which is harmless for
    // a flat list and is not for this one: selecting a row would throw
    // away every other row the caver had selected, and editing a
    // property across a selection is the whole point of the table. It
    // also destroys every QTreeWidgetItem mid-click.
    adapter.currentLayerSet.connect(function(di) {
        self.di = di;
        self.selectCurrentLayer();
    });
    adapter.layersCleared.connect(function() { self.clearLayers(); });
    this.setProperty("listener", adapter);

    this.itemColumnClicked.connect(function(item, col) { self.itemColumnClickedSlot(item, col); });
    this.itemSelectionChanged.connect(function() { self.layerActivated(); });
    this.itemDoubleClicked.connect(function(item, col) { self.itemDoubleClickedSlot(item, col); });
    this.itemExpanded.connect(function(item) { self.rememberExpansion(item, true); });
    this.itemCollapsed.connect(function(item) { self.rememberExpansion(item, false); });

}

RLayerTreeQt.prototype = new RTreeWidget();

// THE NAME IS COLUMN 0 and everything else follows it, which is the
// opposite of BlockList's layout and not a style choice. A tree draws
// its indentation and expand arrow inside column 0, eating it from the
// left: with an icon there, every child row's icon was squeezed out of
// a 22px column while the group rows at depth 0 drew theirs fine.
// Measured in the running GUI -- widening column 0 to 60px brought the
// missing icons back.
//
// The order after that is AutoCAD's Layer Properties Manager, because
// that is the table cavers already know: state switches first, then
// appearance.
RLayerTreeQt.colName = 0;
RLayerTreeQt.colOn = 1;
RLayerTreeQt.colFreeze = 2;
RLayerTreeQt.colLock = 3;
RLayerTreeQt.colPlot = 4;
RLayerTreeQt.colColor = 5;
RLayerTreeQt.colLinetype = 6;
RLayerTreeQt.colLineweight = 7;
RLayerTreeQt.COLUMNS = 8;

/**
 * The toggle columns, as { column, get, set, icons } -- everything the
 * click handler and the row painter need, in one table, so adding a
 * ninth switch is one entry rather than four edits in four places.
 *
 * ON AND FREEZE ARE SEPARATE HERE, and they were one control before.
 * The stock QCAD layer list moves both together and CaveCAD's first cut
 * copied it; AutoCAD has given them a column each for thirty years, and
 * a caver who freezes a layer to speed up a regeneration means
 * something different from one who switches it off.
 */
RLayerTreeQt.switches = function() {
    return [
        { column: RLayerTreeQt.colOn, field: "off", invert: true,
          get: "isOff", set: "setOff", icons: "iconVisible",
          mixed: "iconVisibleMixed" },
        { column: RLayerTreeQt.colFreeze, field: "frozen", invert: true,
          get: "isFrozen", set: "setFrozen", icons: "iconFreeze",
          mixed: "iconFreezeMixed" },
        { column: RLayerTreeQt.colLock, field: "locked", invert: false,
          get: "isLocked", set: "setLocked", icons: "iconLock",
          mixed: "iconLockMixed" },
        { column: RLayerTreeQt.colPlot, field: "plottable", invert: false,
          get: "isPlottable", set: "setPlottable", icons: "iconPlot",
          mixed: "iconPlotMixed" }
    ];
};

/** The property columns, which open an editor rather than toggling. */
RLayerTreeQt.isPropertyColumn = function(column) {
    return column===RLayerTreeQt.colColor ||
           column===RLayerTreeQt.colLinetype ||
           column===RLayerTreeQt.colLineweight;
};

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
RLayerTreeQt.iconFreeze = [];
RLayerTreeQt.iconLock = [];
RLayerTreeQt.iconPlot = [];
RLayerTreeQt.iconVisibleMixed = undefined;
RLayerTreeQt.iconFreezeMixed = undefined;
RLayerTreeQt.iconLockMixed = undefined;
RLayerTreeQt.iconPlotMixed = undefined;
RLayerTreeQt.includeBasePath = includeBasePath;

/** Swatch cache: "#rrggbb" -> QIcon, so a 208-row repaint builds 12. */
RLayerTreeQt.swatches = {};

RLayerTreeQt.initColumnWidths = function(tree) {
    tree.setColumnWidth(RLayerTreeQt.colOn, 26);
    tree.setColumnWidth(RLayerTreeQt.colFreeze, 26);
    tree.setColumnWidth(RLayerTreeQt.colLock, 26);
    tree.setColumnWidth(RLayerTreeQt.colPlot, 26);
    tree.setColumnWidth(RLayerTreeQt.colColor, 90);
    tree.setColumnWidth(RLayerTreeQt.colLinetype, 120);
    tree.setColumnWidth(RLayerTreeQt.colLineweight, 90);
};

/**
 * \return A small filled square for \c text from LayerStates.colorToText.
 *
 * Cached: a cave has a dozen distinct layer colours and three hundred
 * layers, and building a pixmap per row per repaint is the difference
 * between a palette that opens and one that hesitates.
 */
RLayerTreeQt.swatch = function(text) {
    if (isNull(text)) {
        return undefined;
    }
    if (!isNull(RLayerTreeQt.swatches[text])) {
        return RLayerTreeQt.swatches[text];
    }
    var icon;
    try {
        var pixmap = new QPixmap(12, 12);
        pixmap.fill(new QColor(String(text)));
        icon = new QIcon(pixmap);
    }
    catch (e) {
        // ByLayer/ByBlock have no colour to draw. No swatch, just text.
        return undefined;
    }
    RLayerTreeQt.swatches[text] = icon;
    return icon;
};

/** Which columns are hidden, remembered per user and not per drawing. */
RLayerTreeQt.prototype.hiddenColumns = function() {
    var raw = RSettings.getStringValue("LayerManager/HiddenColumns", "");
    if (isNull(raw) || String(raw).length===0) {
        return [];
    }
    var res = [];
    var parts = String(raw).split(",");
    for (var i=0; i<parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (!isNaN(n)) {
            res.push(n);
        }
    }
    return res;
};

RLayerTreeQt.prototype.applyColumnVisibility = function() {
    var hidden = this.hiddenColumns();
    for (var i=1; i<RLayerTreeQt.COLUMNS; i++) {
        this.setColumnHidden(i, hidden.indexOf(i)>=0);
    }
};

/**
 * Right-click the header: one checkable entry per column.
 *
 * Eight columns do not fit a docked palette at its usual width, and the
 * alternative to hiding some is a horizontal scrollbar under a list you
 * are trying to read down.
 */
RLayerTreeQt.prototype.headerMenu = function(pos) {
    var self = this;
    var hidden = this.hiddenColumns();

    this.columnMenu = new QMenu(this);
    for (var i=1; i<RLayerTreeQt.COLUMNS; i++) {
        var action = this.columnMenu.addAction(
            String(this.headerItem().text(i)));
        action.checkable = true;
        action.checked = hidden.indexOf(i)<0;
        action.triggered.connect(
            (function(column) {
                return function() { self.toggleColumn(column); };
            })(i));
    }
    // popup(), not exec(): the menu is held on the tree so it outlives
    // this call, and popup returns immediately.
    this.columnMenu.popup(this.header().viewport().mapToGlobal(pos));
};

RLayerTreeQt.prototype.toggleColumn = function(column) {
    var hidden = this.hiddenColumns();
    var at = hidden.indexOf(column);
    if (at>=0) {
        hidden.splice(at, 1);
    }
    else {
        hidden.push(column);
    }
    RSettings.setValue("LayerManager/HiddenColumns", hidden.join(","));
    this.applyColumnVisibility();
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

    // name -> the two files, off state first. One table so a fifth
    // switch is one line rather than four.
    var sets = {
        iconVisible: "LayerVisible",
        iconFreeze: "LayerFreeze",
        iconLock: "LayerLock",
        iconPlot: "LayerPlot"
    };
    var mixedOf = {
        iconVisible: "iconVisibleMixed", iconFreeze: "iconFreezeMixed",
        iconLock: "iconLockMixed", iconPlot: "iconPlotMixed"
    };

    var key;
    for (key in sets) {
        if (!sets.hasOwnProperty(key)) {
            continue;
        }
        RLayerTreeQt[key] = [
            new QIcon(autoIconPath(base + "/" + sets[key] + "0.svg")),
            new QIcon(autoIconPath(base + "/" + sets[key] + "1.svg"))
        ];
        RLayerTreeQt[mixedOf[key]] =
            new QIcon(autoIconPath(base + "/" + sets[key] + "Mixed.svg"));
    }

    // A repaint after a palette change must not reuse swatches drawn
    // for the old one.
    RLayerTreeQt.swatches = {};

    var appWin = EAction.getMainWindow();
    var tree = appWin.findChild("LayerTree");
    if (!isNull(tree)) {
        var highlightingIsDark = RSettings.getWidgetSelectionColor(tree).lightness()<128;
        var backgroundIsDark = RSettings.hasDarkGuiBackground();
        if (backgroundIsDark && !highlightingIsDark || !backgroundIsDark && highlightingIsDark) {
            for (key in sets) {
                if (!sets.hasOwnProperty(key)) {
                    continue;
                }
                RLayerTreeQt[key][0].addFile(
                    autoIconPath(base + "/" + sets[key] + "0.svg", true),
                    new QSize(), QIcon.Selected);
                RLayerTreeQt[key][1].addFile(
                    autoIconPath(base + "/" + sets[key] + "1.svg", true),
                    new QSize(), QIcon.Selected);
                RLayerTreeQt[mixedOf[key]].addFile(
                    autoIconPath(base + "/" + sets[key] + "Mixed.svg", true),
                    new QSize(), QIcon.Selected);
            }
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
/**
 * Opens or closes every group, nested ones included.
 *
 * Walked rather than handed to QTreeWidget's own expandAll: the
 * collapse state is remembered per user, and the built-in would move
 * every twisty without telling the setting, so the next start would
 * undo it.
 *
 * Ignored while a filter is active, for the same reason rememberExpansion
 * is: the expansion you can see then was forced by the filter, and
 * saving it would overwrite the layout the caver actually chose.
 */
RLayerTreeQt.prototype.setAllExpanded = function(expanded) {
    if (this.filterText.length>0) {
        return;
    }
    var names = [];
    for (var i=0; i<this.getTopLevelCount(); i++) {
        this.setExpandedDeep(this.topLevelItem(i), expanded, names);
    }
    this.setCollapsedNames(expanded ? [] : names);
};

/** \param collapsed Collects the group names closed, for the setting. */
RLayerTreeQt.prototype.setExpandedDeep = function(groupItem, expanded, collapsed) {
    groupItem.setExpanded(expanded);
    if (!expanded) {
        collapsed.push(String(groupItem.data(RLayerTreeQt.colName,
            RLayerTreeQt.RoleName)));
    }
    for (var i=0; i<groupItem.childCount(); i++) {
        var child = groupItem.child(i);
        if (this.isGroupItem(child)) {
            this.setExpandedDeep(child, expanded, collapsed);
        }
    }
};

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

    // WHAT WAS SELECTED SURVIVES THE REBUILD. Every toggle and every
    // property edit ends here, and a rebuild that dropped the selection
    // would undo the thing the caver is in the middle of: pick eight
    // layers, freeze them, and the next click would find one row
    // selected. It also made the highlight snap back to the current
    // layer after a click three rows away, so the popup named one layer
    // and the highlight showed another.
    var wasSelected = this.selectedNames();

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
    if (!this.restoreSelection(wasSelected)) {
        // Nothing was selected, so fall back to showing where the
        // caver is drawing.
        this.selectCurrentLayer();
    }

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
        item.addChild(this.createLayerItem(layers[memberNames[i]], name,
            isNull(this.di) ? undefined : this.di.getDocument()));
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

RLayerTreeQt.prototype.createLayerItem = function(layer, groupName, doc) {
    var item = new QTreeWidgetItem();
    var name = layer.getName();

    item.setText(RLayerTreeQt.colName, name);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleType, RLayerTreeQt.TypeLayer);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleName, name);
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleGroup, groupName);
    // Layer "0" is protected by QCAD itself; others can be flagged.
    item.setData(RLayerTreeQt.colName, RLayerTreeQt.RoleProtected,
                 name==="0" || (isFunction(layer.isProtected) && layer.isProtected()));

    this.updateLayerIcons(item, layer, doc);
    return item;
};

/**
 * Paints one layer row: the four switches, then the three properties.
 *
 * \param doc Needed for the linetype, which a layer holds as an id.
 */
RLayerTreeQt.prototype.updateLayerIcons = function(item, layer, doc) {
    var switches = RLayerTreeQt.switches();
    for (var i=0; i<switches.length; i++) {
        var sw = switches[i];
        if (!isFunction(layer[sw.get])) {
            continue;   // a build without this flag: leave the cell empty
        }
        var on = layer[sw.get]();
        if (sw.invert) {
            on = !on;
        }
        item.setIcon(sw.column, RLayerTreeQt[sw.icons][Number(on)]);
    }

    var colorText = LayerStates.colorToText(layer.getColor());
    item.setText(RLayerTreeQt.colColor, isNull(colorText) ? "" : colorText);
    var swatch = RLayerTreeQt.swatch(colorText);
    if (!isNull(swatch)) {
        item.setIcon(RLayerTreeQt.colColor, swatch);
    }

    var linetype = "";
    if (!isNull(doc) && isFunction(doc.getLinetypeName)) {
        var name = doc.getLinetypeName(layer.getLinetypeId());
        linetype = isNull(name) ? "" : String(name);
    }
    item.setText(RLayerTreeQt.colLinetype, linetype);

    item.setText(RLayerTreeQt.colLineweight,
        RLayerTreeQt.lineweightText(layer.getLineweight()));
};

/** \return A lineweight as the caver sees it, e.g. "0.50 mm". */
RLayerTreeQt.lineweightText = function(weight) {
    if (typeof(weight)!=="number") {
        return "";
    }
    try {
        var name = RLineweight.getName(weight);
        if (!isNull(name) && String(name).length>0) {
            return String(name);
        }
    }
    catch (e) {
        // fall through to the arithmetic below
    }
    if (weight<0) {
        return "";
    }
    return (weight/100).toFixed(2) + " mm";
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
/**
 * Draws a group's switches from every layer under it, nested groups
 * included: all on, all off, or mixed.
 *
 * Nothing about a group's state is stored. That is deliberate -- a
 * stored group flag can disagree with its members, and then the palette
 * has to decide which one is lying.
 */
RLayerTreeQt.prototype.updateGroupIcons = function(groupItem, layers) {
    var rows = this.collectLayerItems(groupItem);
    var switches = RLayerTreeQt.switches();
    var i, sw;

    if (rows.length===0) {
        for (i=0; i<switches.length; i++) {
            groupItem.setIcon(switches[i].column,
                RLayerTreeQt[switches[i].mixed]);
        }
        return;
    }

    for (i=0; i<switches.length; i++) {
        sw = switches[i];
        var on = 0, counted = 0;
        for (var j=0; j<rows.length; j++) {
            var layer = layers[String(rows[j].data(RLayerTreeQt.colName,
                RLayerTreeQt.RoleName))];
            if (isNull(layer) || !isFunction(layer[sw.get])) {
                continue;
            }
            counted++;
            var value = layer[sw.get]();
            if (sw.invert) {
                value = !value;
            }
            if (value) {
                on++;
            }
        }
        if (counted===0) {
            continue;
        }
        if (on===0) {
            groupItem.setIcon(sw.column, RLayerTreeQt[sw.icons][0]);
        }
        else if (on===counted) {
            groupItem.setIcon(sw.column, RLayerTreeQt[sw.icons][1]);
        }
        else {
            groupItem.setIcon(sw.column, RLayerTreeQt[sw.mixed]);
        }
    }
};


// ---------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------

RLayerTreeQt.prototype.setFilterText = function(text) {
    var had = this.filterText.length>0;
    this.filterText = isNull(text) ? "" : String(text).toLowerCase().trim();
    this.matcher = LayerFilter.build(this.filterText);

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
    var matcher = this.matcher;
    var label = String(groupItem.text(RLayerTreeQt.colName)).toLowerCase();
    var matches = inherited || isNull(matcher) || matcher(label);

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
        var hit = matches || matcher(layerName);
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

/**
 * \return The names on every selected row, layers and groups alike, so
 * a rebuild can put the selection back exactly as it was.
 *
 * Groups and layers can share a name only if somebody names a group
 * after a layer, and then the worst that happens is one extra row comes
 * back selected. Worth it for a function this small.
 */
RLayerTreeQt.prototype.selectedNames = function() {
    var res = [];
    var items = this.selectedItems();
    for (var i=0; i<items.length; i++) {
        var name = this.getItemName(items[i]);
        if (!isNull(name) && res.indexOf(name)<0) {
            res.push(name);
        }
    }
    return res;
};

/**
 * Re-selects the rows named in \c names after a rebuild.
 * \return True if anything was selected.
 */
RLayerTreeQt.prototype.restoreSelection = function(names) {
    if (isNull(names) || names.length===0) {
        return false;
    }
    var found = false;
    this.blockSignals(true);
    for (var i=0; i<this.getTopLevelCount(); i++) {
        if (this.selectNamedRows(this.topLevelItem(i), names)) {
            found = true;
        }
    }
    this.blockSignals(false);
    return found;
};

RLayerTreeQt.prototype.selectNamedRows = function(item, names) {
    var found = false;
    if (names.indexOf(this.getItemName(item))>=0 && !item.isHidden()) {
        item.setSelected(true);
        if (isNull(this.currentItem())) {
            this.setCurrentItem(item);
        }
        found = true;
    }
    for (var i=0; i<item.childCount(); i++) {
        if (this.selectNamedRows(item.child(i), names)) {
            found = true;
        }
    }
    return found;
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

/**
 * \return The layer names a click on \c item should act on.
 *
 * THE SELECTION WINS WHEN THE CLICKED ROW IS PART OF IT. Click a switch
 * on one of eight selected layers and all eight move; click one outside
 * the selection and only it moves. That is what every table in every
 * CAD program does, and the alternative -- always acting on one row --
 * makes a multiple selection decorative.
 *
 * A group row contributes every layer under it, nested groups included.
 */
RLayerTreeQt.prototype.targetsFor = function(item) {
    var items = item.isSelected() ? this.selectedItems() : [item];
    var names = [];
    var add = function(name) {
        if (!isNull(name) && names.indexOf(name)<0) {
            names.push(name);
        }
    };
    for (var i=0; i<items.length; i++) {
        if (this.isGroupItem(items[i])) {
            var rows = this.collectLayerItems(items[i]);
            for (var j=0; j<rows.length; j++) {
                add(this.getItemName(rows[j]));
            }
        }
        else {
            add(this.getItemName(items[i]));
        }
    }
    return names;
};

RLayerTreeQt.prototype.itemColumnClickedSlot = function(item, column) {
    if (isNull(this.di) || isNull(item)) {
        return;
    }

    // THE CLICK MOVES THE HIGHLIGHT unless it landed inside the
    // selection. Only the name column is selectable, so a click on a
    // switch or a property cell used to change nothing about what was
    // highlighted: with one layer selected and a colour cell clicked
    // three rows below it, the popup opened over a row that was not
    // highlighted and edited a layer that was not the one shown as
    // chosen. The edit was right and unreadable, which is worse than
    // wrong.
    //
    // Signals blocked: this is feedback, not a request to change which
    // layer the caver is drawing on.
    if (!item.isSelected()) {
        this.blockSignals(true);
        this.clearSelection();
        item.setSelected(true);
        this.setCurrentItem(item);
        this.blockSignals(false);
    }

    // WHERE THE EDITOR SHOULD APPEAR: under the cell that was clicked,
    // not under the pointer. They are the same place for the first
    // popup, and they stop being the same the moment that popup offers
    // "Custom..." -- by then the pointer is at the bottom of a grid
    // and the dialog would open nowhere near the layer it edits.
    this.anchor = this.cellAnchor(item, column);

    if (RLayerTreeQt.isPropertyColumn(column)) {
        this.editProperty(this.targetsFor(item), column);
        return;
    }

    var switches = RLayerTreeQt.switches();
    for (var i=0; i<switches.length; i++) {
        if (switches[i].column!==column) {
            continue;
        }
        if (this.isGroupItem(item) && !item.isSelected()) {
            // A group row on its own: the whole subtree moves together,
            // decided once from the group rather than row by row, so
            // clicking a mixed group makes it uniform instead of
            // inverting it into a different mixture.
            this.toggleGroup(item, column);
        }
        else {
            this.toggleLayers(this.targetsFor(item), column);
        }
        return;
    }
};

/**
 * Toggles a switch on every named layer.
 *
 * \param target Optional explicit state. Omitted, the whole set is
 * decided from what it currently is: if ANY of them is on, they all go
 * off. Inverting each layer separately would turn a mixed selection
 * into a differently mixed selection, which is never what the click
 * meant.
 */
/**
 * Toggles one switch across a whole group, nested groups included.
 *
 * The target is decided once from the group as a whole: clicking a
 * mixed group turns all of it off, and clicking again turns all of it
 * on. Toggling each member independently would leave a mixed group
 * mixed forever, just inverted.
 */
RLayerTreeQt.prototype.toggleGroup = function(groupItem, column) {
    var sw;
    var switches = RLayerTreeQt.switches();
    for (var i=0; i<switches.length; i++) {
        if (switches[i].column===column) {
            sw = switches[i];
        }
    }
    if (isNull(sw)) {
        return;
    }

    var doc = this.di.getDocument();
    var rows = this.collectLayerItems(groupItem);
    var names = [];
    var anyOn = false;

    for (i=0; i<rows.length; i++) {
        var name = this.getItemName(rows[i]);
        if (names.indexOf(name)>=0) {
            continue;   // the same layer filed in two nested groups
        }
        var layer = doc.queryLayer(name);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull()) ||
                !isFunction(layer[sw.get])) {
            continue;
        }
        names.push(name);
        var value = layer[sw.get]();
        if (sw.invert) {
            value = !value;
        }
        if (value) {
            anyOn = true;
        }
    }

    if (names.length===0) {
        return;
    }
    this.toggleLayers(names, column, !anyOn);
};


// ---------------------------------------------------------------------
// Editing colour, linetype and lineweight
// ---------------------------------------------------------------------

/**
 * Opens the right editor for \c column and applies the answer to every
 * layer in \c names.
 *
 * One transaction for the lot, so an edit across forty selected layers
 * is one undo.
 */
RLayerTreeQt.prototype.editProperty = function(names, column) {
    if (names.length===0) {
        return;
    }
    var doc = this.di.getDocument();
    // The first layer seeds the editor, so opening it on a uniform
    // selection shows what they already are rather than a default.
    var first = doc.queryLayer(names[0]);
    if (isNull(first) || (isFunction(first.isNull) && first.isNull())) {
        return;
    }

    // Named once here rather than in each asker: they all want the
    // same sentence and none of them should have to work it out.
    this.editTitle = (names.length===1) ? names[0] :
        qsTr("%1 layers").arg(names.length);

    if (column===RLayerTreeQt.colColor) {
        // The colour popup applies its own answer, so there is nothing
        // to wait for and nothing to return.
        this.openColorPopup(names, first.getColor());
        return;
    }

    var apply;
    if (column===RLayerTreeQt.colLinetype) {
        apply = this.askLinetype(doc, first);
    }
    else if (column===RLayerTreeQt.colLineweight) {
        apply = this.askLineweight(first);
    }
    if (isNull(apply)) {
        return;   // cancelled
    }
    this.applyToLayers(names, apply);
};

/**
 * Applies \c apply to every named layer, in one transaction so an edit
 * across forty of them is one undo.
 */
RLayerTreeQt.prototype.applyToLayers = function(names, apply) {
    var doc = this.di.getDocument();
    var op = new RModifyObjectsOperation();
    var changed = 0;
    for (var i=0; i<names.length; i++) {
        var layer = doc.queryLayer(names[i]);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull())) {
            continue;
        }
        if (apply(layer)) {
            op.addObject(layer);
            changed++;
        }
    }
    if (changed===0) {
        return;
    }
    this.di.applyOperation(op);
    this.di.clearPreview();
    this.di.repaintViews();
    this.updateLayers(this.di);
};

/**
 * Opens the full colour picker, once the menu that asked for it has
 * gone.
 *
 * A plain function on the class and not a closure: a QTimer callback
 * that captured the widget would be holding a Qt wrapper across the
 * gap, which is the shape that crashes. This resolves the static at
 * fire time instead.
 */
RLayerTreeQt.runPendingColor = function() {
    var tree = RLayerTreeQt.instance;
    if (isNull(tree) || isNull(tree.pendingColor)) {
        return;
    }

    var initial;
    try {
        initial = new QColor(String(
            LayerStates.colorToText(tree.pendingColor.seed)));
    }
    catch (e) {
        initial = new QColor(255, 255, 255);
    }

    var dialog = new QColorDialog(RMainWindowQt.getMainWindow());

    // NOT THE NATIVE PANEL. On macOS the native colour panel is a
    // window of the system's own: it has its own title bar, it does
    // not close when you click past it, and it outlives the thing that
    // opened it. Qt's own widget version can be made to behave like
    // every other editor in this palette. DontUseNativeDialog is 4.
    dialog.setOption(QColorDialog.DontUseNativeDialog, true);

    // Qt.Popup (9) dismisses it on a click away;
    // Qt.FramelessWindowHint (2048) stops a QDialog reserving room for
    // chrome it will not draw -- the empty band this palette already
    // hit once with the swatch grid.
    dialog.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint);
    dialog.setCurrentColor(initial);

    // colorSelected fires on OK and not on a click away, which is the
    // distinction wanted: leaving without choosing changes nothing.
    dialog.colorSelected.connect(RLayerTreeQt.onColorSelected);
    dialog.finished.connect(RLayerTreeQt.onColorFinished);

    // NEVER QColorDialog.getColor. The blocking static does not come
    // back in this binding: it opens its dialog, the dialog can be
    // accepted or rejected, the dialog goes away, and the call never
    // returns -- so every line after it is never reached and nothing
    // is logged. It reads from outside as "the button does nothing".
    tree.colorDialog = dialog;
    dialog.show();
    RLayerTreeQt.placeAt(dialog, tree.anchor);
};

/** The caver pressed OK. \c color is what they picked. */
RLayerTreeQt.onColorSelected = function(color) {
    var tree = RLayerTreeQt.instance;
    if (isNull(tree) || isNull(tree.pendingColor)) {
        return;
    }
    var names = tree.pendingColor.names;
    tree.pendingColor = undefined;

    if (isNull(color) || !isFunction(color.isValid) || !color.isValid()) {
        return;
    }
    var text = LayerStates.colorToText(
        new RColor(color.red(), color.green(), color.blue()));
    RLayerTreeQt.setRecentColor(text);

    var apply = RLayerTreeQt.colorApplier(text);
    if (!isNull(apply)) {
        tree.applyToLayers(names, apply);
    }
};

/** Closed, however it closed: let go of the dialog and the request. */
RLayerTreeQt.onColorFinished = function() {
    var tree = RLayerTreeQt.instance;
    if (isNull(tree)) {
        return;
    }
    tree.pendingColor = undefined;
    tree.colorDialog = undefined;
};

/** \return A function putting colour \c text on a layer. */
RLayerTreeQt.colorApplier = function(text) {
    var color = LayerStates.colorFromText(text);
    if (isNull(color)) {
        return undefined;
    }
    return function(layer) {
        if (LayerStates.colorToText(layer.getColor())===text) {
            return false;
        }
        layer.setColor(color);
        return true;
    };
};

/**
 * The standard colours offered before the full picker.
 *
 * The seven ACI colours everyone's CAD has used since the eighties,
 * plus the greys a cave map actually leans on. Hex and not names,
 * because that is what a record stores and comparing two spellings of
 * the same colour is a bug waiting to happen.
 */
RLayerTreeQt.QUICK_COLORS = function() {
    return [
        { text: qsTr("Red"), hex: "#ff0000" },
        { text: qsTr("Yellow"), hex: "#ffff00" },
        { text: qsTr("Green"), hex: "#00ff00" },
        { text: qsTr("Cyan"), hex: "#00ffff" },
        { text: qsTr("Blue"), hex: "#0000ff" },
        { text: qsTr("Magenta"), hex: "#ff00ff" },
        { text: qsTr("White"), hex: "#ffffff" },
        { text: qsTr("Grey"), hex: "#808080" },
        { text: qsTr("Dark grey"), hex: "#404040" }
    ];
};

/**
 * The wider palette: a column per hue, a row per shade.
 *
 * Built rather than written out: eight hues by five shades is forty
 * entries, and forty hand-typed hex strings is forty chances to fat
 * finger one. Shades run light to dark by mixing the pure hue toward
 * white and then toward black, which is what a cartographer actually
 * wants -- a lighter version of the same colour, not a different one.
 */
RLayerTreeQt.PALETTE = function() {
    var hues = [
        { name: qsTr("Reds"), rgb: [255, 0, 0] },
        { name: qsTr("Oranges"), rgb: [255, 128, 0] },
        { name: qsTr("Yellows"), rgb: [255, 255, 0] },
        { name: qsTr("Greens"), rgb: [0, 192, 0] },
        { name: qsTr("Cyans"), rgb: [0, 192, 192] },
        { name: qsTr("Blues"), rgb: [0, 64, 255] },
        { name: qsTr("Purples"), rgb: [128, 0, 255] },
        { name: qsTr("Magentas"), rgb: [255, 0, 192] }
    ];
    // Above 0 the hue is mixed toward white, below it toward black.
    var mixes = [0.6, 0.3, 0, -0.3, -0.55];

    var hex = function(n) {
        n = Math.max(0, Math.min(255, Math.round(n)));
        var t = n.toString(16);
        return t.length < 2 ? "0" + t : t;
    };

    var res = [];
    var h, m;
    for (h = 0; h < hues.length; h++) {
        var shades = [];
        for (m = 0; m < mixes.length; m++) {
            var k = mixes[m];
            var parts = "";
            for (var c = 0; c < 3; c++) {
                var v = hues[h].rgb[c];
                parts += hex(k >= 0 ? v + (255 - v) * k : v * (1 + k));
            }
            shades.push("#" + parts);
        }
        res.push({ name: hues[h].name, colors: shades });
    }

    // Greys get their own row: a cave map leans on them for inferred
    // walls and anything meant to sit back.
    var greys = [];
    var steps = [255, 208, 160, 128, 96, 64, 32, 0];
    for (m = 0; m < steps.length; m++) {
        greys.push("#" + hex(steps[m]) + hex(steps[m]) + hex(steps[m]));
    }
    res.push({ name: qsTr("Greys"), colors: greys });

    return res;
};

/**
 * The last colour picked out of the full picker.
 *
 * ONE colour and not a list: "the one I mixed a minute ago" is the
 * thing a caver reaches back for, and a growing row of near-identical
 * swatches under the standard nine would cost more to read than it
 * saves. Kept per user rather than per drawing -- it is a habit, not a
 * property of the cave.
 */
RLayerTreeQt.recentColor = function() {
    var hex = RSettings.getStringValue("LayerManager/RecentColor", "");
    return (isNull(hex) || String(hex).length===0) ? undefined : String(hex);
};

/**
 * Remembers \c hex, unless it is one of the standard nine -- those are
 * already in the list and a "recent" entry duplicating one teaches the
 * caver that the row means nothing.
 */
RLayerTreeQt.setRecentColor = function(hex) {
    if (isNull(hex)) {
        return;
    }
    var quick = RLayerTreeQt.QUICK_COLORS();
    for (var i=0; i<quick.length; i++) {
        if (quick[i].hex===hex) {
            return;
        }
    }
    RSettings.setValue("LayerManager/RecentColor", hex);
};

/**
 * A popup at the mouse. \return The chosen entry's value, or undefined.
 *
 * A QMenU AND NOT A DIALOG, which is what makes it behave the way a
 * caver expects a cell editor to: it appears under the pointer, has no
 * title bar or buttons to dismiss, and clicking anywhere else puts it
 * away without changing anything. A modal dialog centred on the main
 * window for a one-click choice is the wrong weight entirely.
 *
 * exec() rather than popup(): the answer is wanted right here, and exec
 * on a QMenu is not the application-modal loop a QDialog's exec is.
 *
 * \param entries [{ text, value, icon }], icon optional.
 * \param current The value to show as checked, or undefined.
 */
RLayerTreeQt.prototype.popupChoice = function(entries, current, extraText, title) {
    // Held on the tree rather than in a local: a menu whose only
    // reference is the function that opened it can go out of scope
    // while it is still on screen.
    this.choiceMenu = new QMenu(this);

    // WHAT IS ABOUT TO CHANGE, across the top. A popup that edits
    // forty layers looks exactly like one that edits the row under the
    // pointer, and the difference is not recoverable by undo-ing and
    // squinting.
    if (!isNull(title)) {
        var heading = this.choiceMenu.addAction(title);
        heading.enabled = false;
        this.choiceMenu.addSeparator();
    }

    // text -> value, because exec() answers with a wrapper around the
    // chosen QAction and a wrapper is NOT guaranteed to be the same JS
    // object addAction returned. Comparing by identity made the menu
    // silently do nothing for the very item that was clicked. Every
    // text in one of these menus is distinct, so text is a sound key.
    var byText = {};
    var i, action;

    for (i=0; i<entries.length; i++) {
        var entry = entries[i];
        if (entry.separatorBefore===true) {
            this.choiceMenu.addSeparator();
        }

        action = this.choiceMenu.addAction(entry.text);
        if (!isNull(entry.icon)) {
            action.icon = entry.icon;
        }
        if (!isNull(current) && entry.value===current) {
            action.checkable = true;
            action.checked = true;
        }
        byText[String(action.text)] = entry.value;
    }

    if (!isNull(extraText)) {
        this.choiceMenu.addSeparator();
        var extra = this.choiceMenu.addAction(extraText);
        byText[String(extra.text)] = RLayerTreeQt.MORE;
    }

    // Dropped from the cell that was clicked, so the menu lines up
    // with the column it edits instead of wherever the pointer
    // happened to be inside it.
    // QMenu does its own flipping near a screen edge, so it is handed
    // the point below the cell and left to it.
    var chosen = this.choiceMenu.exec(isNull(this.anchor) ? QCursor.pos() :
        new QPoint(this.anchor.x, this.anchor.below));
    if (isNull(chosen)) {
        return undefined;   // clicked away
    }
    var value = byText[String(chosen.text)];
    return isNull(value) ? undefined : value;
};

/**
 * Sentinel: the caver asked for the full picker instead.
 *
 * A string no colour, linetype or lineweight label can ever be, so
 * comparing against it cannot collide with a real answer.
 */
RLayerTreeQt.MORE = "<<more>>";

/**
 * The colour popup: a grid of swatches under the pointer.
 *
 * A FRAMELESS Qt.Popup AND NOT A MENU. A colour is chosen by eye from a
 * block you can scan in one look; a menu makes you read it as a list,
 * and a cascade of hue submenus makes you read it as several. It is
 * still a popup in every way that matters -- no title bar, no buttons,
 * appears where the pointer is, and clicking anywhere else puts it away
 * having changed nothing.
 *
 * Nothing is returned: a swatch applies itself. The caller is done once
 * this has been called.
 */
RLayerTreeQt.prototype.openColorPopup = function(names, seedColor) {
    var current = LayerStates.colorToText(seedColor);

    // A QFrame AND NOT A QDIALOG. A QDialog keeps its window chrome on
    // macOS even under Qt.Popup: the frame is not drawn, but the space
    // it would occupy is, as an empty band across the top of the
    // popup. A plain frame has no such machinery -- and none of
    // QDialog's is wanted here, since nothing about this is modal and
    // there is no accept or reject.
    var popup = new QFrame(RMainWindowQt.getMainWindow());

    // Qt.Popup (9) is what dismisses it on a click away;
    // Qt.FramelessWindowHint (2048) says plainly that there is no
    // border to reserve room for. Both enums are bound in this build,
    // but their values are written down because plenty of their
    // neighbours are not, and a silently undefined flag reads as 0 --
    // an ordinary window that never goes away.
    popup.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint);
    popup.frameShape = QFrame.StyledPanel;
    popup.frameShadow = QFrame.Raised;

    var grid = new QGridLayout();
    grid.spacing = 2;
    grid.setContentsMargins(6, 6, 6, 6);

    var row = 0;
    var i, j;

    // WHAT IS ABOUT TO CHANGE, across the top -- the same sentence the
    // linetype and lineweight menus carry. A grid of colours with
    // nothing above it says which colours are available and not which
    // layers are about to take one, and a popup opened over the wrong
    // row is the fault this whole heading exists to prevent.
    var heading = new QLabel((names.length===1) ? names[0] :
        qsTr("%1 layers").arg(names.length));
    heading.styleSheet = "font-weight: bold; padding: 0px 2px 2px 2px;";
    grid.addWidget(heading, row, 0, 1, 8);
    row++;

    // The everyday eight, across the top.
    var quick = RLayerTreeQt.QUICK_COLORS();
    for (i=0; i<quick.length && i<8; i++) {
        grid.addWidget(RLayerTreeQt.swatchButton(popup, quick[i].hex,
            quick[i].text, current), row, i);
    }
    row++;

    // A hair of space, then the palette: a column per hue, a row per
    // shade, so scanning down is "darker" and across is "a different
    // colour". Both are things a cartographer looks for.
    var line = new QFrame();
    line.frameShape = QFrame.HLine;
    line.frameShadow = QFrame.Sunken;
    grid.addWidget(line, row, 0, 1, 8);
    row++;

    var palette = RLayerTreeQt.PALETTE();
    var hues = [];
    var greys;
    for (i=0; i<palette.length; i++) {
        if (palette[i].colors.length>5) {
            greys = palette[i];
        }
        else {
            hues.push(palette[i]);
        }
    }
    var shades = hues.length>0 ? hues[0].colors.length : 0;
    for (j=0; j<shades; j++) {
        for (i=0; i<hues.length && i<8; i++) {
            grid.addWidget(RLayerTreeQt.swatchButton(popup, hues[i].colors[j],
                hues[i].name, current), row, i);
        }
        row++;
    }
    if (!isNull(greys)) {
        for (i=0; i<greys.colors.length && i<8; i++) {
            grid.addWidget(RLayerTreeQt.swatchButton(popup, greys.colors[i],
                greys.name, current), row, i);
        }
        row++;
    }

    // The last colour mixed by hand, and the way to mix another.
    var recent = RLayerTreeQt.recentColor();
    if (!isNull(recent)) {
        var line2 = new QFrame();
        line2.frameShape = QFrame.HLine;
        line2.frameShadow = QFrame.Sunken;
        grid.addWidget(line2, row, 0, 1, 8);
        row++;
        grid.addWidget(RLayerTreeQt.swatchButton(popup, recent,
            qsTr("Recent"), current), row, 0);
        row++;
    }

    var custom = new QToolButton();
    custom.text = qsTr("Custom...");
    custom.autoRaise = true;
    custom.clicked.connect(RLayerTreeQt.onCustomColorRequested);
    grid.addWidget(custom, row, 0, 1, 8);

    popup.setLayout(grid);

    // Held so it is not collected while it is on screen, and so the
    // swatch handlers can close it without being handed a reference.
    this.colorPopup = popup;
    this.pendingColor = { names: names, seed: seedColor };

    popup.show();
    RLayerTreeQt.placeAt(popup, this.anchor);
};

/**
 * \return One swatch button, wired to apply its own colour.
 *
 * The handler closes over the HEX STRING and nothing else. A closure
 * holding a Qt wrapper is the shape this bridge crashes on, and the
 * alternative -- one shared handler asking Qt which button sent the
 * signal -- means guessing from the focused widget, which is not the
 * pressed one often enough to matter.
 */
RLayerTreeQt.swatchButton = function(parent, hex, tip, current) {
    var button = new QToolButton(parent);
    button.objectName = hex;
    button.autoRaise = true;
    button.toolTip = tip + "  " + hex;
    var icon = RLayerTreeQt.swatch(hex);
    if (!isNull(icon)) {
        button.icon = icon;
        button.iconSize = new QSize(14, 14);
    }
    else {
        button.text = hex;
    }
    if (hex===current) {
        button.checkable = true;
        button.checked = true;
    }
    button.clicked.connect(
        (function(chosen) {
            return function() { RLayerTreeQt.applyPickedColor(chosen); };
        })(hex));
    return button;
};

/** A swatch was pressed: close the popup and put \c hex on the layers. */
RLayerTreeQt.applyPickedColor = function(hex) {
    var tree = RLayerTreeQt.instance;
    if (isNull(tree) || isNull(tree.pendingColor)) {
        return;
    }
    var names = tree.pendingColor.names;
    tree.closeColorPopup();

    var apply = RLayerTreeQt.colorApplier(hex);
    if (!isNull(apply)) {
        tree.applyToLayers(names, apply);
    }
};

RLayerTreeQt.prototype.closeColorPopup = function() {
    if (isNull(this.colorPopup)) {
        return;
    }
    try {
        this.colorPopup.close();
    }
    catch (e) {
        // already gone
    }
    this.colorPopup = undefined;
    this.pendingColor = undefined;
};

/** "Custom..." -- hand over to the full dialog. */
RLayerTreeQt.onCustomColorRequested = function() {
    var tree = RLayerTreeQt.instance;
    if (isNull(tree) || isNull(tree.pendingColor)) {
        return;
    }
    // Kept across the popup closing: closeColorPopup clears it.
    var pending = tree.pendingColor;
    tree.closeColorPopup();
    tree.pendingColor = pending;
    RLayerTreeQt.runPendingColor();
};

/**
 * \return Where an editor for one cell should hang, as plain numbers:
 * { x, below, above } in screen coordinates, or undefined.
 *
 * BOTH EDGES, because an editor near the foot of the palette has to go
 * up instead of down, and deciding that needs the top of the cell as
 * well as the bottom. Plain numbers rather than QPoints: QPoint's x and
 * y are FUNCTIONS in this binding and not properties, so every hand-off
 * is a chance to read one as a property, get the function object, and
 * turn the next sum into NaN.
 */
RLayerTreeQt.prototype.cellAnchor = function(item, column) {
    try {
        var rect = this.visualItemRect(item);
        var x = this.header().sectionViewportPosition(column);
        var viewport = this.viewport();
        var top = viewport.mapToGlobal(new QPoint(x, rect.y()));
        var bottom = viewport.mapToGlobal(
            new QPoint(x, rect.y() + rect.height()));
        return { x: top.x(), above: top.y(), below: bottom.y() };
    }
    catch (e) {
        return undefined;
    }
};

/**
 * Places \c widget against \c anchor, or under the pointer when there
 * is none. Shown first, because its size is not settled until it is.
 *
 * DROPS BELOW THE CELL, OR FLIPS ABOVE IT. A palette docked to the full
 * height of the window puts its last rows against the bottom of the
 * screen, and an editor that only ever hung downwards would be shoved
 * back up by the clamp until it covered the row it was editing --
 * worst exactly where the list is longest. Flipping means it sits
 * clear of the row either way. Sliding is what is left for the
 * horizontal, where there is no second choice to make.
 */
RLayerTreeQt.placeAt = function(widget, anchor) {
    try {
        var at = QCursor.pos();
        if (isNull(anchor)) {
            anchor = { x: at.x(), above: at.y(), below: at.y() };
        }
        var area = QGuiApplication.screenAt(
            new QPoint(anchor.x, anchor.below)).availableGeometry();
        var w = widget.width;
        var h = widget.height;

        var x = anchor.x;
        if (x + w > area.x() + area.width()) {
            x = area.x() + area.width() - w;
        }
        if (x < area.x()) {
            x = area.x();
        }

        var y;
        if (anchor.below + h <= area.y() + area.height()) {
            y = anchor.below;            // room below: hang down
        }
        else if (anchor.above - h >= area.y()) {
            y = anchor.above - h;        // no room: flip above the cell
        }
        else {
            // Taller than the screen either way: sit at the top and
            // let it run off the bottom, which at least keeps the
            // first rows of it readable.
            y = area.y();
        }

        widget.move(x, y);
    }
    catch (e) {
        // Left where Qt put it rather than not shown at all.
    }
};

/** \return A function applying the chosen linetype, or undefined. */
RLayerTreeQt.prototype.askLinetype = function(doc, seed) {
    var names = [];
    var ids = doc.queryAllLinetypes();
    for (var i=0; i<ids.length; i++) {
        var lt = doc.queryLinetype(ids[i]);
        if (isNull(lt)) {
            continue;
        }
        var name = String(lt.getName());
        if (names.indexOf(name)<0) {
            names.push(name);
        }
    }
    if (names.length===0) {
        return undefined;
    }
    names.sort();

    var entries = [];
    for (i=0; i<names.length; i++) {
        entries.push({ text: names[i], value: names[i] });
    }
    var chosen = this.popupChoice(entries,
        String(doc.getLinetypeName(seed.getLinetypeId())),
        undefined, this.editTitle);
    if (isNull(chosen) || chosen===RLayerTreeQt.MORE) {
        return undefined;
    }

    var id = doc.getLinetypeId(chosen);
    if (isNull(id) || id===RObject.INVALID_ID) {
        return undefined;
    }
    return function(layer) {
        if (layer.getLinetypeId()===id) {
            return false;
        }
        layer.setLinetypeId(id);
        return true;
    };
};

/** \return A function applying the chosen lineweight, or undefined. */
RLayerTreeQt.prototype.askLineweight = function(seed) {
    // Walked off the enum rather than written out: a build that adds a
    // weight should offer it without an edit here.
    var weights = [];
    for (var key in RLineweight) {
        if (!RLineweight.hasOwnProperty(key) ||
                key.indexOf("Weight")!==0 ||
                typeof(RLineweight[key])!=="number" ||
                RLineweight[key]<0) {
            continue;
        }
        weights.push(RLineweight[key]);
    }
    weights.sort(function(a, b) { return a-b; });
    if (weights.length===0) {
        return undefined;
    }

    var entries = [];
    for (var i=0; i<weights.length; i++) {
        entries.push({ text: RLayerTreeQt.lineweightText(weights[i]),
                       value: weights[i] });
    }
    var weight = this.popupChoice(entries, seed.getLineweight(),
        undefined, this.editTitle);
    if (isNull(weight) || weight===RLayerTreeQt.MORE) {
        return undefined;
    }
    return function(layer) {
        if (layer.getLineweight()===weight) {
            return false;
        }
        layer.setLineweight(weight);
        return true;
    };
};


RLayerTreeQt.prototype.toggleLayers = function(names, column, target) {
    var sw;
    var switches = RLayerTreeQt.switches();
    for (var i=0; i<switches.length; i++) {
        if (switches[i].column===column) {
            sw = switches[i];
        }
    }
    if (isNull(sw) || names.length===0) {
        return;
    }

    var doc = this.di.getDocument();
    var layer, value;

    if (isNull(target)) {
        var anyOn = false;
        for (i=0; i<names.length; i++) {
            layer = doc.queryLayer(names[i]);
            if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull()) ||
                    !isFunction(layer[sw.get])) {
                continue;
            }
            value = layer[sw.get]();
            if (sw.invert) {
                value = !value;
            }
            if (value) {
                anyOn = true;
            }
        }
        target = !anyOn;
    }

    var op = new RModifyObjectsOperation();
    op.setTransactionType(RTransaction.LayerVisibilityStatusChange);

    var changed = 0;
    for (i=0; i<names.length; i++) {
        layer = doc.queryLayer(names[i]);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull()) ||
                !isFunction(layer[sw.set])) {
            continue;
        }
        var wanted = sw.invert ? !target : target;
        if (layer[sw.get]()===wanted) {
            continue;
        }
        layer[sw.set](wanted);
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

    // View actions first: they apply whatever the click landed on.
    var a = menu.addAction(qsTr("Expand All"));
    a.triggered.connect(function() { self.setAllExpanded(true); });
    a = menu.addAction(qsTr("Collapse All"));
    a.triggered.connect(function() { self.setAllExpanded(false); });
    menu.addSeparator();

    a = menu.addAction(qsTr("New Group..."));
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
