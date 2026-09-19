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

    var apply;
    if (column===RLayerTreeQt.colColor) {
        apply = this.askColor(first);
    }
    else if (column===RLayerTreeQt.colLinetype) {
        apply = this.askLinetype(doc, first);
    }
    else if (column===RLayerTreeQt.colLineweight) {
        apply = this.askLineweight(first);
    }
    if (isNull(apply)) {
        return;   // cancelled
    }

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

/** \return A function applying the chosen colour, or undefined. */
RLayerTreeQt.prototype.askColor = function(seed) {
    var initial;
    try {
        initial = new QColor(String(LayerStates.colorToText(seed.getColor())));
    }
    catch (e) {
        initial = new QColor(255, 255, 255);
    }
    var picked = QColorDialog.getColor(initial, RMainWindowQt.getMainWindow(),
        qsTr("Layer Colour"));
    if (isNull(picked) || !picked.isValid()) {
        return undefined;
    }
    var color = new RColor(picked.red(), picked.green(), picked.blue());
    var text = LayerStates.colorToText(color);
    return function(layer) {
        if (LayerStates.colorToText(layer.getColor())===text) {
            return false;
        }
        layer.setColor(color);
        return true;
    };
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

    var current = String(doc.getLinetypeName(seed.getLinetypeId()));
    var chosen = RLayerTreeQt.pickFromList(qsTr("Layer Linetype"),
        qsTr("Linetype:"), names, names.indexOf(current));
    if (isNull(chosen)) {
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

    var labels = [];
    for (var i=0; i<weights.length; i++) {
        labels.push(RLayerTreeQt.lineweightText(weights[i]));
    }
    var chosen = RLayerTreeQt.pickFromList(qsTr("Layer Lineweight"),
        qsTr("Lineweight:"), labels, weights.indexOf(seed.getLineweight()));
    if (isNull(chosen)) {
        return undefined;
    }
    var weight = weights[labels.indexOf(chosen)];
    return function(layer) {
        if (layer.getLineweight()===weight) {
            return false;
        }
        layer.setLineweight(weight);
        return true;
    };
};

/**
 * A combo box in a dialog. \return The chosen string, or undefined.
 *
 * QInputDialog's item mode by NUMBER, because QInputDialog.ComboBoxInput
 * is not bound in this build -- the same shape as the QToolButton popup
 * mode trap. 3 is the item mode.
 */
RLayerTreeQt.pickFromList = function(title, label, items, current) {
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.setInputMode(3);
    dialog.setWindowTitle(title);
    dialog.setLabelText(label);
    dialog.setComboBoxItems(items);
    dialog.setComboBoxEditable(false);
    if (current>=0 && current<items.length) {
        dialog.setTextValue(items[current]);
    }
    var accepted = dialog.exec();
    var value = String(dialog.textValue());
    destrDialog(dialog);
    return accepted ? value : undefined;
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
