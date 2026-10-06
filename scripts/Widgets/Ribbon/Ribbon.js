/**
 * Ribbon -- a contextual ribbon across the top of the drawing, plugged into by
 * name (the way CustomGrips is).
 *
 * TABS come and go with what you are doing: "Layout" is there on a layout,
 * "Viewport" appears (and takes focus, accented) when a viewport is selected,
 * "Editing Viewport" while you are editing through one. Each tab holds PANELS
 * of buttons; a panel is a titled group. Anything can add a tab, a panel or a
 * button by registering it, so the cave suite's tools sit on the same ribbon.
 *
 *     Ribbon.registerTab({ id: "viewport", title: qsTr("Viewport"), accent: true,
 *                          when: function(ctx) { return ctx.viewport !== undefined; } });
 *     Ribbon.registerPanel("viewport", { id: "shape", title: qsTr("Shape"), order: 20, items: [
 *         { type: "button", id: "trim", text: qsTr("Trim"), icon: "trim", size: "large",
 *           tooltip: ..., onClick: function(entry, ctx) { ... },
 *           menu: [ { text: ..., onClick: function(entry, ctx) { ... } } ] },
 *         { type: "button", action: "LayoutNorthArrow.js", size: "large" },   // an existing menu action
 *         { type: "widget", id: "scale", make: function(entry, parent) { return aWidget; } } ] });
 *
 * `ctx` is whatever the host's context function returns for the window
 * (Ribbon.contextOf); the host calls Ribbon.refresh(entry) when it changes.
 *
 * Icons are the SVGs in this folder's icons/ (and an action's own icon),
 * recoloured for the theme.
 */

var Ribbon = {};

Ribbon.tabs = [];
Ribbon.panels = {};          // tab id -> [panel defs]
Ribbon.BODY_HEIGHT = 78;
Ribbon.TAB_HEIGHT = 26;
Ribbon.includeBasePath = includeBasePath;
Ribbon.contextOf = function(entry) { return {}; };   // set by the host

Ribbon.registerTab = function(def) {
    for (var i = 0; i < Ribbon.tabs.length; i++) {
        if (Ribbon.tabs[i].id === def.id) {
            Ribbon.tabs[i] = def;
            return;
        }
    }
    Ribbon.tabs.push(def);
    if (isNull(Ribbon.panels[def.id])) {
        Ribbon.panels[def.id] = [];
    }
};

Ribbon.registerPanel = function(tabId, def) {
    if (isNull(Ribbon.panels[tabId])) {
        Ribbon.panels[tabId] = [];
    }
    var list = Ribbon.panels[tabId];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === def.id) {
            list[i] = def;
            return;
        }
    }
    list.push(def);
    list.sort(function(a, b) { return (isNull(a.order) ? 100 : a.order) - (isNull(b.order) ? 100 : b.order); });
};

// ---------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------

Ribbon.iconColor = function() {
    try {
        return QApplication.palette().color(QPalette.Window).value() < 128 ? "#e8eef5" : "#2b2b2b";
    }
    catch (e) {
        return "#e8eef5";
    }
};

/** A themed QIcon from one of this folder's SVGs, or undefined. */
Ribbon.icon = function(name) {
    var color = Ribbon.iconColor();
    var key = name + "|" + color;
    if (isNull(Ribbon.iconCache)) {
        Ribbon.iconCache = {};
    }
    if (!isNull(Ribbon.iconCache[key])) {
        return Ribbon.iconCache[key];
    }
    var icon;
    try {
        var f = new QFile(Ribbon.includeBasePath + "/icons/" + name + ".svg");
        if (f.open(QIODevice.ReadOnly)) {
            var text = String(new QTextStream(f).readAll()).split("#2b2b2b").join(color);
            f.close();
            // QByteArray cannot be built from a string in the script engine, so the
            // recoloured SVG goes through a temp file
            var tmp = QDir.tempPath() + "/cavecad-ribbon-" + name + "-" + color.substring(1) + ".svg";
            var out = new QFile(tmp);
            var pm;
            if (out.open(QIODevice.WriteOnly)) {
                var ts = new QTextStream(out);
                ts.writeString(text);
                ts.flush();
                out.close();
                pm = new QPixmap(tmp);
            }
            if (!isNull(pm) && !pm.isNull()) {
                icon = new QIcon(pm);
            }
        }
    }
    catch (e) {
        icon = undefined;
    }
    Ribbon.iconCache[key] = icon;
    return icon;
};

/** An existing menu action whose script file ends with `suffix`, or undefined. */
Ribbon.findAction = function(suffix) {
    var all = RGuiAction.getActions();
    for (var i = 0; i < all.length; i++) {
        var sf = String(all[i].getScriptFile());
        if (sf.length >= suffix.length && sf.substring(sf.length - suffix.length) === suffix) {
            return all[i];
        }
    }
    return undefined;
};

// ---------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------

/** Dresses the ribbon for the current light or dark theme. */
Ribbon.applyTheme = function(entry) {
    var rb = entry.ribbon;
    if (isNull(rb)) {
        return;
    }
    var dark = Ribbon.iconColor() !== "#2b2b2b";
    var c = dark ?
        { bg: "#1b2733", head: "#16202a", text: "#eaf3ff", dim: "#7d8fa3", line: "#34495e", hover: "#2c4258", accent: "#188cff" } :
        { bg: "#f3f6fa", head: "#e4e9f0", text: "#16283c", dim: "#9aa8b8", line: "#c3cdd9", hover: "#dfe9f5", accent: "#188cff" };
    rb.root.setStyleSheet(
        "QWidget#RibbonRoot, QWidget#RibbonBody { background:" + c.bg + "; } " +
        "QWidget#RibbonHead { background:" + c.head + "; border-bottom:1px solid " + c.line + "; } " +
        "QWidget#RibbonBody { border-bottom:2px solid " + c.line + "; } " +
        "QLabel { color:" + c.text + "; background:transparent; } " +
        "QLabel#RibbonPanelTitle { color:" + c.dim + "; font-size:11px; } " +
        "QToolButton { color:" + c.text + "; background:transparent; border:1px solid transparent; border-radius:4px; } " +
        "QToolButton:hover { background:" + c.hover + "; border-color:" + c.line + "; } " +
        "QToolButton:disabled { color:" + c.dim + "; } " +
        "QCheckBox { color:" + c.text + "; } " +
        "QComboBox { color:" + c.text + "; background:" + c.bg + "; border:1px solid " + c.line + "; border-radius:3px; padding:1px 6px; } " +
        "QTabBar::tab { color:" + c.text + "; background:transparent; padding:3px 14px; margin-right:2px; border:1px solid transparent; border-top-left-radius:4px; border-top-right-radius:4px; } " +
        "QTabBar::tab:selected { background:" + c.bg + "; border-color:" + c.line + "; font-weight:bold; } " +
        "QTabBar::tab:hover:!selected { background:" + c.hover + "; }");
};

Ribbon.makeButton = function(entry, item, parent) {
    var btn = new QToolButton(parent);
    btn.objectName = "RibbonButton-" + (isNull(item.id) ? "x" : item.id);
    var action = isNull(item.action) ? undefined : Ribbon.findAction(item.action);
    var text = !isNull(item.text) ? item.text : (!isNull(action) ? String(action.text).replace("&", "") : "");
    btn.text = text;
    var large = item.size !== "small";
    var ic = isNull(item.icon) ? undefined : Ribbon.icon(item.icon);
    if (isNull(ic) && !isNull(action)) {
        ic = action.icon;
    }
    if (!isNull(ic)) {
        btn.setIcon(ic);
    }
    btn.setIconSize(large ? new QSize(28, 28) : new QSize(16, 16));
    btn.toolButtonStyle = large ? Qt.ToolButtonTextUnderIcon : Qt.ToolButtonTextBesideIcon;
    btn.autoRaise = true;
    if (large) {
        btn.setMinimumWidth(58);
        btn.setFixedHeight(Ribbon.BODY_HEIGHT - 20);
    }
    btn.toolTip = !isNull(item.tooltip) ? item.tooltip : (!isNull(action) ? String(action.statusTip) : text);
    if (!isNull(item.menu)) {
        var menu = new QMenu(btn);
        for (var m = 0; m < item.menu.length; m++) {
            menu.addAction(item.menu[m].text).triggered.connect(
                (function(def) { return function() { def.onClick(entry, Ribbon.contextOf(entry)); }; })(item.menu[m]));
        }
        btn.setMenu(menu);
        btn.popupMode = QToolButton.InstantPopup;
    }
    else {
        btn.clicked.connect(function() {
            if (!isNull(item.onClick)) {
                item.onClick(entry, Ribbon.contextOf(entry));
            }
            else {
                var a = Ribbon.findAction(item.action);
                if (!isNull(a)) {
                    a.slotTrigger();
                }
            }
        });
    }
    return btn;
};

/** Builds the ribbon for a window into `parent`'s layout (`insertAt` 0 = top). Returns the ribbon state. */
Ribbon.attach = function(entry, parent, layout) {
    var root = new QWidget(parent);
    root.objectName = "RibbonRoot";
    root.setAttribute(Qt.WA_StyledBackground, true);
    // the ribbon takes the height it needs and no more; the drawing gets the rest
    root.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum);
    var col = new QVBoxLayout();
    col.setContentsMargins(0, 0, 0, 0);
    col.setSpacing(0);

    var head = new QWidget(root);
    head.objectName = "RibbonHead";
    head.setAttribute(Qt.WA_StyledBackground, true);
    var headRow = new QHBoxLayout();
    headRow.setContentsMargins(6, 2, 6, 0);
    headRow.setSpacing(4);
    var bar = new QTabBar(head);
    bar.objectName = "RibbonTabs";
    bar.shape = QTabBar.RoundedNorth;
    bar.expanding = false;
    bar.drawBase = false;
    headRow.addWidget(bar, 0, 0);
    headRow.addStretch(1);
    var state = new QLabel(head);
    state.objectName = "RibbonState";
    headRow.addWidget(state, 0, 0);
    var collapse = new QToolButton(head);
    collapse.objectName = "RibbonCollapse";
    collapse.autoRaise = true;
    headRow.addWidget(collapse, 0, 0);
    head.setLayout(headRow);
    head.setFixedHeight(Ribbon.TAB_HEIGHT);
    col.addWidget(head, 0, 0);

    var body = new QWidget(root);
    body.objectName = "RibbonBody";
    body.setAttribute(Qt.WA_StyledBackground, true);
    var bodyRow = new QHBoxLayout();
    bodyRow.setContentsMargins(6, 2, 6, 2);
    bodyRow.setSpacing(2);
    body.setLayout(bodyRow);
    body.setFixedHeight(Ribbon.BODY_HEIGHT);
    col.addWidget(body, 0, 0);
    root.setLayout(col);

    var rb = { root: root, head: head, bar: bar, body: body, bodyRow: bodyRow, state: state, collapse: collapse,
        tabIndexOf: {}, tabIds: [], panelWidgets: {}, current: undefined, building: false };
    entry.ribbon = rb;

    // tabs, in registration order; contextual ones hidden until their context holds
    for (var t = 0; t < Ribbon.tabs.length; t++) {
        var def = Ribbon.tabs[t];
        var idx = bar.addTab(def.title);
        rb.tabIndexOf[def.id] = idx;
        rb.tabIds.push(def.id);
    }
    bar.currentChanged.connect(function(index) {
        if (rb.building || index < 0) { return; }
        rb.current = rb.tabIds[index];
        rb.picked = rb.current;
        Ribbon.showPanels(entry);
    });
    bar.tabBarDoubleClicked.connect(function() { Ribbon.toggleCollapsed(entry); });
    collapse.clicked.connect(function() { Ribbon.toggleCollapsed(entry); });

    // panels: widgets built once, shown per tab
    for (var tid in Ribbon.panels) {
        if (!Ribbon.panels.hasOwnProperty(tid)) { continue; }
        rb.panelWidgets[tid] = [];
        var list = Ribbon.panels[tid];
        for (var p = 0; p < list.length; p++) {
            var pw = Ribbon.makePanel(entry, list[p], body);
            pw.visible = false;
            bodyRow.addWidget(pw, 0, 0);
            rb.panelWidgets[tid].push(pw);
        }
    }
    bodyRow.addStretch(1);

    try {
        layout.insertWidget(0, root);
    }
    catch (e) {
        layout.addWidget(root);
    }
    Ribbon.applyTheme(entry);
    Ribbon.setCollapsed(entry, RSettings.getBoolValue("Ribbon/Collapsed", false));
    return rb;
};

/** Keeps a built widget by id, and its enabled() rule, for refresh. */
Ribbon.remember = function(entry, item, widget) {
    if (!isNull(item.id)) {
        if (isNull(entry.ribbonItems)) { entry.ribbonItems = {}; }
        entry.ribbonItems[item.id] = widget;
    }
    if (typeof item.enabled === "function") {
        if (isNull(entry.ribbonEnable)) { entry.ribbonEnable = []; }
        entry.ribbonEnable.push({ widget: widget, fn: item.enabled });
    }
};

Ribbon.makePanel = function(entry, def, parent) {
    var pw = new QWidget(parent);
    pw.objectName = "RibbonPanel-" + def.id;
    pw.setAttribute(Qt.WA_StyledBackground, true);
    var v = new QVBoxLayout();
    v.setContentsMargins(6, 0, 6, 0);
    v.setSpacing(0);
    var row = new QHBoxLayout();
    row.setSpacing(2);
    row.setContentsMargins(0, 0, 0, 0);
    for (var i = 0; i < def.items.length; i++) {
        var item = def.items[i];
        var w;
        if (item.type === "widget") {
            w = item.make(entry, pw);
        }
        else if (item.type === "stack") {
            // a column of small things (buttons or widgets)
            w = new QWidget(pw);
            var col = new QVBoxLayout();
            col.setContentsMargins(0, 0, 0, 0);
            col.setSpacing(0);
            for (var k = 0; k < item.items.length; k++) {
                var sub = item.items[k];
                var sw = sub.type === "widget" ? sub.make(entry, w) : Ribbon.makeButton(entry, sub, w);
                if (!isNull(sw)) {
                    col.addWidget(sw, 0, 0);
                    Ribbon.remember(entry, sub, sw);
                }
            }
            col.addStretch(1);
            w.setLayout(col);
        }
        else {
            w = Ribbon.makeButton(entry, item, pw);
        }
        if (!isNull(w)) {
            row.addWidget(w, 0, 0);
            Ribbon.remember(entry, item, w);
        }
    }
    v.addLayout(row, 0);
    var label = new QLabel(def.title, pw);
    label.alignment = Qt.AlignHCenter;
    label.objectName = "RibbonPanelTitle";
    v.addWidget(label, 0, 0);
    pw.setLayout(v);
    pw.setProperty("ribbonDivider", true);
    return pw;
};

Ribbon.setCollapsed = function(entry, collapsed) {
    var rb = entry.ribbon;
    rb.collapsed = collapsed;
    rb.body.visible = !collapsed;
    rb.collapse.text = collapsed ? "▾" : "▴";
    rb.collapse.toolTip = collapsed ? qsTr("Show the ribbon") : qsTr("Collapse the ribbon to its tabs");
    RSettings.setValue("Ribbon/Collapsed", collapsed);
};

Ribbon.toggleCollapsed = function(entry) {
    Ribbon.setCollapsed(entry, entry.ribbon.collapsed !== true);
};

Ribbon.showPanels = function(entry) {
    var rb = entry.ribbon;
    for (var tid in rb.panelWidgets) {
        if (!rb.panelWidgets.hasOwnProperty(tid)) { continue; }
        for (var i = 0; i < rb.panelWidgets[tid].length; i++) {
            rb.panelWidgets[tid][i].visible = (tid === rb.current);
        }
    }
};

/**
 * Re-reads the context: shows the tabs whose `when` holds, hides the rest, and
 * moves to a contextual tab when one appears (back to the one the person
 * picked when it goes away).
 */
Ribbon.refresh = function(entry) {
    var rb = entry.ribbon;
    if (isNull(rb)) {
        return;
    }
    var ctx = Ribbon.contextOf(entry);
    rb.building = true;
    var visibleIds = [];
    for (var t = 0; t < Ribbon.tabs.length; t++) {
        var def = Ribbon.tabs[t];
        var on = isNull(def.when) ? true : def.when(ctx) === true;
        rb.bar.setTabVisible(rb.tabIndexOf[def.id], on);
        if (def.accent === true) { rb.bar.setTabTextColor(rb.tabIndexOf[def.id], new QColor("#ff9a2e")); }
        if (on) { visibleIds.push(def.id); }
    }
    // tabs come and go, so the bar's width is recomputed (it stays at its first size otherwise)
    rb.bar.setElideMode(Qt.ElideNone);
    rb.bar.updateGeometry();
    rb.bar.adjustSize();
    // which tab: a contextual one that has just appeared wins; else the person's pick; else the first visible
    var want = rb.current;
    var appeared = [];
    for (var a = 0; a < visibleIds.length; a++) {
        var d2 = Ribbon.tabById(visibleIds[a]);
        if (d2.accent === true && (isNull(rb.lastVisible) || rb.lastVisible.indexOf(visibleIds[a]) < 0)) {
            appeared.push(visibleIds[a]);
        }
    }
    if (appeared.length > 0) {
        want = appeared[appeared.length - 1];
    }
    else if (visibleIds.indexOf(want) < 0) {
        want = (!isNull(rb.picked) && visibleIds.indexOf(rb.picked) >= 0) ? rb.picked : visibleIds[0];
    }
    rb.lastVisible = visibleIds;
    rb.current = want;
    if (!isNull(want)) {
        rb.bar.setCurrentIndex(rb.tabIndexOf[want]);
    }
    rb.building = false;
    Ribbon.showPanels(entry);
    rb.state.text = isNull(ctx.stateText) ? "" : ctx.stateText;
    var en = isNull(entry.ribbonEnable) ? [] : entry.ribbonEnable;
    for (var e = 0; e < en.length; e++) {
        en[e].widget.enabled = en[e].fn(ctx) === true;
    }
    if (!isNull(Ribbon.onRefresh)) {
        Ribbon.onRefresh(entry, ctx);
    }
};

Ribbon.tabById = function(id) {
    for (var i = 0; i < Ribbon.tabs.length; i++) {
        if (Ribbon.tabs[i].id === id) { return Ribbon.tabs[i]; }
    }
    return undefined;
};
