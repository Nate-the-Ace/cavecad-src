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
 * A tab with `follow: true` takes focus when it appears (like an accented one, but without the dot); when it goes
 * away the ribbon returns to the tab the person last picked.
 *
 * `ctx` is whatever the host's context function returns for the window
 * (Ribbon.contextOf); the host calls Ribbon.refresh(entry) when it changes.
 *
 * Icons are the SVGs in this folder's icons/ (and an action's own icon),
 * recoloured for the theme.
 */

include("scripts/Widgets/Theme/Theme.js");

var Ribbon = {};

Ribbon.tabs = [];
Ribbon.panels = {};          // tab id -> [panel defs]
Ribbon.BODY_HEIGHT = 86;
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

// ---------------------------------------------------------------------
// Selection tabs: tabs that follow what is selected
// ---------------------------------------------------------------------

/**
 * TO ADD A TAB THAT FOLLOWS A KIND OF OBJECT (two steps):
 *
 *   1. Say how to recognise the object:
 *        Ribbon.registerSelectionKind({ id: "symbol", order: 60,
 *            test: function(e, doc, out) { return isThisAThing(e); } });
 *      `test` gets one selected entity. The first kind (lowest `order`) whose test is true wins;
 *      an entity no kind claims is "other". `test` may stash extras on `out` (out.symbolNames = ...)
 *      for buttons to read later from ctx.selection. A kind about the whole selection rather than
 *      single entities (an area is a boundary plus its fill) gives `resolve(doc, ids, out)` instead:
 *      it gets the ids of the "other" entities and returns the ids that make up the kind.
 *      Both may be given. `begin()` runs once per classification, to clear caches.
 *
 *   2. Declare the tab and put panels on it, as on any tab:
 *        Ribbon.registerSelectionTab({ id: "sel-symbol", title: qsTr("Symbol"), kind: "symbol" });
 *        Ribbon.registerPanel("sel-symbol", { id: "sy-use", title: qsTr("Symbol"), items: [ ... ] });
 *
 * The tab shows while at least one selected entity is of its kind. It is NOT accented, so it appears
 * without taking focus from the tab you are on (add `accent: true` to make it take focus).
 * Buttons can check ctx.selection: { count, kinds: {kind: n}, ids: {kind: [ids]}, kind: the only
 * kind, or "mixed", truncated, + whatever tests stashed }, undefined when nothing is selected.
 * The host classifies once per selection or transaction signal (it queries each entity), never
 * from the poll (see LayoutTabs.selectionOf).
 */
Ribbon.selectionKinds = [];
Ribbon.SELECTION_LIMIT = 500;

Ribbon.registerSelectionKind = function(def) {
    for (var i = 0; i < Ribbon.selectionKinds.length; i++) {
        if (Ribbon.selectionKinds[i].id === def.id) { Ribbon.selectionKinds[i] = def; return; }
    }
    Ribbon.selectionKinds.push(def);
    Ribbon.selectionKinds.sort(function(a, b) { return (isNull(a.order) ? 100 : a.order) - (isNull(b.order) ? 100 : b.order); });
};

/** True when the context's selection holds at least one entity of `kind`. */
Ribbon.selects = function(ctx, kind) {
    return !isNull(ctx.selection) && (ctx.selection.kinds[kind] || 0) > 0;
};

/** A tab that shows while something of `def.kind` is selected. */
Ribbon.registerSelectionTab = function(def) {
    var kind = def.kind;
    def.when = function(ctx) { return Ribbon.selects(ctx, kind); };
    Ribbon.registerTab(def);
};

/** What the selection holds, or undefined when nothing is selected (see registerSelectionKind). */
Ribbon.classifySelection = function(doc) {
    if (isNull(doc)) { return undefined; }
    var all = doc.querySelectedEntities();
    if (isNull(all) || all.length === 0) { return undefined; }
    var out = { count: all.length, kinds: {}, ids: {}, truncated: all.length > Ribbon.SELECTION_LIMIT };
    var kinds = Ribbon.selectionKinds;
    var k, i;
    for (k = 0; k < kinds.length; k++) {
        if (typeof kinds[k].begin === "function") { try { kinds[k].begin(); } catch (eB) { } }
    }
    var add = function(kind, id) {
        out.kinds[kind] = (out.kinds[kind] || 0) + 1;
        if (isNull(out.ids[kind])) { out.ids[kind] = []; }
        out.ids[kind].push(id);
    };
    var n = Math.min(all.length, Ribbon.SELECTION_LIMIT);
    for (i = 0; i < n; i++) {
        var e = doc.queryEntity(all[i]);
        if (isNull(e)) { continue; }
        var kind = "other";
        for (k = 0; k < kinds.length; k++) {
            if (typeof kinds[k].test !== "function") { continue; }
            var hit = false;
            try { hit = kinds[k].test(e, doc, out) === true; } catch (eT) { hit = false; }
            if (hit) { kind = kinds[k].id; break; }
        }
        add(kind, all[i]);
    }
    for (k = 0; k < kinds.length; k++) {
        if (typeof kinds[k].resolve !== "function" || isNull(out.ids.other)) { continue; }
        try {
            var found = kinds[k].resolve(doc, out.ids.other, out);
            if (!isNull(found) && found.length > 0) {
                out.kinds[kinds[k].id] = found.length;
                out.ids[kinds[k].id] = found;
            }
        }
        catch (eR) { }
    }
    var present = [];
    for (var key in out.kinds) { if (out.kinds.hasOwnProperty(key)) { present.push(key); } }
    out.kind = present.length === 1 ? present[0] : "mixed";
    return out;
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
    def.tabId = tabId;
    list.push(def);
    list.sort(function(a, b) { return (isNull(a.order) ? 100 : a.order) - (isNull(b.order) ? 100 : b.order); });
};

// ---------------------------------------------------------------------
// The host: one toolbar across the whole top of the window
// ---------------------------------------------------------------------

/**
 * The ribbon lives in a toolbar of its own, on the first row of the main window
 * (so it spans the full width, above every dock), holding a stack with one page
 * per drawing; the page of the active drawing is the one showing.
 */
Ribbon.host = function() {
    var mw = RMainWindowQt.getMainWindow();
    var tb = mw.findChild("RibbonToolBar");
    if (!isNull(tb)) {
        return tb.findChild("RibbonStack");
    }
    tb = new QToolBar(qsTr("Ribbon"), mw);
    tb.objectName = "RibbonToolBar";
    tb.movable = false;
    tb.floatable = false;
    tb.setAllowedAreas(Qt.TopToolBarArea);
    tb.setContentsMargins(0, 0, 0, 0);
    var stack = new QStackedWidget(tb);
    stack.objectName = "RibbonStack";
    stack.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Maximum);
    tb.addWidget(stack);
    // first row: in front of whichever toolbar is first, then a break so it has the row to itself
    var first = mw.findChild("ResetToolBar");
    if (isNull(first)) {
        first = mw.findChild("FileToolBar");
    }
    if (!isNull(first)) {
        mw.insertToolBar(first, tb);
        mw.insertToolBarBreak(first);
    }
    else {
        mw.addToolBar(Qt.TopToolBarArea, tb);
        mw.addToolBarBreak(Qt.TopToolBarArea);
    }
    return stack;
};

// ---------------------------------------------------------------------
// Quick access: undo and redo, each with a history dropdown (as in AutoCAD)
// ---------------------------------------------------------------------

/**
 * Two curved arrows to the right of the tabs, each with an arrow that lists what it would
 * undo (or redo), newest first, ten deep. Moving over the list marks everything from the top
 * down to the line under the mouse, the footer says how many actions that is, and one click
 * undoes (or redoes) them all.
 */
Ribbon.HISTORY_DEPTH = 10;

Ribbon.makeQuickAccess = function(entry, parent) {
    var box = new QWidget(parent);
    box.objectName = "RibbonQuickAccess";
    var hb = new QHBoxLayout();
    hb.setContentsMargins(0, 0, 0, 0);
    hb.setSpacing(0);
    var qa = {};
    var kinds = [ { key: "undo", file: "Edit/Undo/Undo.js", tip: qsTr("Undo") }, { key: "redo", file: "Edit/Redo/Redo.js", tip: qsTr("Redo") } ];
    for (var i = 0; i < kinds.length; i++) {
        var k = kinds[i];
        var action = Ribbon.findAction(k.file);
        var btn = new QToolButton(box);
        btn.objectName = "RibbonQuick-" + k.key;
        btn.autoRaise = true;
        btn.toolTip = k.tip;
        btn.setIconSize(new QSize(18, 18));
        btn.setFixedSize(26, 22);
        if (!isNull(action)) { btn.setIcon(action.icon); }
        var arrow = new QToolButton(box);
        arrow.objectName = "RibbonQuickArrow";
        arrow.text = "\u25be";
        arrow.autoRaise = true;
        arrow.toolTip = k.key === "undo" ? qsTr("Undo history") : qsTr("Redo history");
        arrow.setFixedSize(14, 22);
        hb.addWidget(btn, 0, 0);
        hb.addWidget(arrow, 0, 0);
        if (i === 0) { hb.addSpacing(6); }
        qa[k.key] = btn;
        qa[k.key + "Arrow"] = arrow;
        qa[k.key + "Action"] = action;
        btn.clicked.connect((function(act) { return function() { if (!isNull(act)) { act.slotTrigger(); } }; })(action));
        arrow.clicked.connect((function(kind, anchorBtn) { return function() { Ribbon.openHistory(entry, anchorBtn, kind); }; })(k.key, btn));
    }
    box.setLayout(hb);
    entry.ribbonQa = qa;
    return box;
};

/**
 * Whether there is anything to undo or redo that a person would recognise: a named command.
 * (A new drawing carries unnamed setup steps that QCAD counts as undoable; they are not offered.)
 * Worked out again only when the transaction log has moved.
 */
Ribbon.hasHistory = function(entry) {
    if (entry.dead === true) {
        return { undo: false, redo: false };
    }
    var st = entry.di.getDocument().getStorage();
    var last = st.getLastTransactionId();
    var max = st.getMaxTransactionId();
    var key = last + "|" + max;
    if (entry.ribbonHistKey === key && !isNull(entry.ribbonHist)) {
        return entry.ribbonHist;
    }
    var named = function(id) {
        var t = st.getTransaction(id);
        if (isNull(t)) { return false; }
        try { return String(t.getText()) !== ""; } catch (e) { return false; }
    };
    var have = { undo: false, redo: false };
    for (var id = last; id >= 1; id--) {
        if (named(id)) { have.undo = true; break; }
    }
    for (var rid = last + 1; rid <= max; rid++) {
        if (named(rid)) { have.redo = true; break; }
    }
    entry.ribbonHistKey = key;
    entry.ribbonHist = have;
    return have;
};

/** The undo (or redo) steps, newest first: [{text, id}], id being the transaction to go back to. */
Ribbon.historyOf = function(entry, kind) {
    var doc = entry.di.getDocument();
    var st = doc.getStorage();
    var last = st.getLastTransactionId();
    var steps = [];
    var group = -2;
    var take = function(id) {
        var t = st.getTransaction(id);
        if (isNull(t)) { return; }
        var g = -1;
        var text = "";
        try { g = t.getGroup(); } catch (e1) { }
        try { text = String(t.getText()); } catch (e2) { }
        // transactions of one group are one step
        if (g >= 0 && g === group && steps.length > 0) {
            var cur = steps[steps.length - 1];
            if (cur.text === "" && text !== "") { cur.text = text; }
            cur.low = Math.min(cur.low, id);
            cur.high = Math.max(cur.high, id);
        }
        else {
            steps.push({ text: text, low: id, high: id });
        }
        group = g;
    };
    if (kind === "undo") {
        for (var id = last; id >= 1; id--) { take(id); }
    }
    else {
        for (var rid = last + 1; rid <= st.getMaxTransactionId(); rid++) { take(rid); }
    }
    return steps;
};

/** Undoes (or redoes) up to and including the given step. */
Ribbon.runHistory = function(entry, kind, step) {
    var doc = entry.di.getDocument();
    var st = doc.getStorage();
    var guard = 500;
    if (kind === "undo") {
        while (guard-- > 0 && st.getLastTransactionId() >= step.low && doc.isUndoAvailable()) { entry.di.undo(); }
    }
    else {
        while (guard-- > 0 && st.getLastTransactionId() < step.high && doc.isRedoAvailable()) { entry.di.redo(); }
    }
};

Ribbon.openHistory = function(entry, anchor, kind) {
    Ribbon.closePopup();
    var all = Ribbon.historyOf(entry, kind);
    // steps with no name (setup work, not a command) take part in the undo but are not listed
    var listed = [];
    for (var i = 0; i < all.length && listed.length < Ribbon.HISTORY_DEPTH; i++) {
        if (all[i].text !== "") { listed.push(all[i]); }
    }
    if (listed.length === 0) {
        return;
    }
    var pop = new QFrame(anchor);
    pop.objectName = "RibbonOverflow";
    pop.setWindowFlags(Qt.Popup);
    pop.setAttribute(Qt.WA_StyledBackground, true);
    pop.setAttribute(Qt.WA_DeleteOnClose, true);
    var v = new QVBoxLayout();
    v.setContentsMargins(4, 4, 4, 4);
    v.setSpacing(4);
    // a one-column table, because QListWidget has no usable methods in the script engine
    var rowH = 24;
    var list = new QTableWidget(listed.length, 1, pop);
    list.objectName = "RibbonHistoryList";
    list.mouseTracking = true;
    list.horizontalHeader().hide();
    list.verticalHeader().hide();
    list.setShowGrid(false);
    list.setEditTriggers(0);
    list.setSelectionMode(QAbstractItemView.MultiSelection);
    list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff);
    list.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff);
    list.setFrameShape(QFrame.NoFrame);
    list.setColumnWidth(0, 250);
    for (var j = 0; j < listed.length; j++) {
        var cell = new QTableWidgetItem(Ribbon.shortText(listed[j].text));
        cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable);
        list.setItem(j, 0, cell);
        list.setRowHeight(j, rowH);
    }
    list.setFixedSize(252, rowH * listed.length + 2);
    var footer = new QLabel(pop);
    footer.objectName = "RibbonHistoryFooter";
    footer.alignment = Qt.AlignHCenter;
    var verb = kind === "undo" ? qsTr("Undo") : qsTr("Redo");
    var mark = function(upTo) {
        list.clearSelection();
        for (var m = 0; m <= upTo; m++) { list.item(m, 0).setSelected(true); }
        footer.text = verb + " " + (upTo + 1) + " " + (upTo === 0 ? qsTr("action") : qsTr("actions"));
    };
    mark(0);
    list.cellEntered.connect(function(row, col) { mark(row); });
    list.cellClicked.connect(function(row, col) {
        Ribbon.closePopup();
        Ribbon.runHistory(entry, kind, listed[row]);
    });
    v.addWidget(list, 0, 0);
    v.addWidget(footer, 0, 0);
    pop.setLayout(v);
    pop.adjustSize();
    var at = anchor.mapToGlobal(new QPoint(0, anchor.height));
    pop.move(at.x(), at.y());
    Ribbon.popupOpen = pop;
    pop.show();
};

// ---------------------------------------------------------------------
// Tool options: the options toolbar, hosted in a context tab
// ---------------------------------------------------------------------

/**
 * A command that has option fields (a UI file) puts them in QCAD's options toolbar
 * when it starts and takes them out when it ends. The ribbon wears that toolbar
 * in a context tab ("tool"): the tab appears, and takes focus, while such a
 * command runs, and the tab you were on returns when it ends. Nothing about the
 * commands changes: they still fill the same toolbar, which now lives in the ribbon.
 */
Ribbon.prompt = "";      // the running command's prompt, "" when idle
Ribbon.tools = [];       // [{title}] while a command with option fields runs, else empty
Ribbon.toolHooked = false;

/**
 * Commands run in script engines of their own, so wrapping EAction's methods does not
 * reach them. The options toolbar is the one thing they all share, so it is what we
 * watch: past its resting items (the active-tool icon, a separator, ...) a command
 * has put its option fields there, and the icon's tooltip names the command.
 */
Ribbon.hookTools = function() {
    if (Ribbon.toolHooked === true) {
        return;
    }
    Ribbon.toolHooked = true;
    Ribbon.toolSignature = "";
    var timer = new QTimer();
    timer.interval = 120;
    timer.timeout.connect(function() {
        try {
            Ribbon.pollTools();
        }
        catch (e) {
            qWarning("Ribbon.pollTools: " + e);
        }
    });
    timer.start(120);
    Ribbon.toolTimer = timer;
};

/** Brings the showing ribbon's command buttons in line with their commands (enabled, checked). */
Ribbon.syncCommands = function() {
    var entry = Ribbon.activeEntry;
    // a drawing that has been closed: its document is freed, and asking it anything is a crash
    if (!isNull(entry) && entry.dead === true) {
        Ribbon.activeEntry = undefined;
        return;
    }
    if (!isNull(entry) && !isNull(entry.ribbonQa)) {
        var have = Ribbon.hasHistory(entry);
        var canUndo = have.undo;
        var canRedo = have.redo;
        var qa = entry.ribbonQa;
        if (qa.undo.enabled !== canUndo) { qa.undo.enabled = canUndo; qa.undoArrow.enabled = canUndo; }
        if (qa.redo.enabled !== canRedo) { qa.redo.enabled = canRedo; qa.redoArrow.enabled = canRedo; }
    }
    if (isNull(entry) || isNull(entry.ribbonCmd)) {
        return;
    }
    for (var i = 0; i < entry.ribbonCmd.length; i++) {
        var rec = entry.ribbonCmd[i];
        if (!rec.btn.visible) { continue; }
        var on = rec.action.enabled;
        if (rec.btn.enabled !== on) { rec.btn.enabled = on; }
        if (rec.checkable) {
            var ck = rec.action.checked;
            if (rec.btn.checked !== ck) { rec.btn.checked = ck; }
        }
    }
};

Ribbon.pollTools = function() {
    try {
        Ribbon.syncCommands();
    }
    catch (eSync) {
    }
    try {
        if (!isNull(Ribbon.activeEntry) && Ribbon.activeEntry.dead !== true) { Ribbon.fit(Ribbon.activeEntry); }
    }
    catch (eFit) {
    }
    var tb = Ribbon.optionsBar();
    if (isNull(tb)) {
        return;
    }
    var n = tb.actions().length;
    var icon = tb.findChild("Icon");
    var tip = isNull(icon) ? "" : String(icon.toolTip);
    // the command's prompt ("Choose line, arc, circle or ellipse:") from the command line's label
    var promptLabel = RMainWindowQt.getMainWindow().findChild("CommandLabel");
    var prompt = isNull(promptLabel) ? "" : String(promptLabel.text).replace(/<[^>]*>/g, "").replace(/^\s+|\s+$/g, "");
    if (prompt === "Command:" || prompt === qsTr("Command:")) {
        prompt = "";
    }
    var signature = n + "|" + tip + "|" + prompt;
    if (signature === Ribbon.toolSignature) {
        return;
    }
    Ribbon.toolSignature = signature;
    var title = tip.indexOf(":") >= 0 ? tip.substring(tip.indexOf(":") + 1).replace(/^\s+|\s+$/g, "") : tip;
    title = title.replace(/\s*\([A-Z0-9]{1,4}\)\s*$/, "");   // the command's shortcut, "(OF)"
    title = title.replace(/\s*\([^)]*\)/g, "");               // and qualifiers: "Offset (with Distance)" -> "Offset"
    Ribbon.prompt = prompt;
    var had = Ribbon.tools.length > 0;
    // resting state: the Reset tool is "active" and the bar holds only its resting items
    var idle = tip.indexOf("Reset") >= 0 || tip.indexOf("Idle") >= 0 || tip === "";
    if (idle) {
        Ribbon.toolBase = n;
    }
    Ribbon.tools = (!idle && n > (isNull(Ribbon.toolBase) ? 3 : Ribbon.toolBase)) ? [{ title: title }] : [];
    // a changed prompt matters even for a command with no option fields
    if (!isNull(Ribbon.onToolChange)) { Ribbon.onToolChange(); }
};

/** Brings a tab to the front (as if it had been clicked). */
Ribbon.selectTab = function(entry, id) {
    var rb = entry.ribbon;
    if (isNull(rb) || isNull(rb.tabIndexOf[id]) || !rb.bar.isTabVisible(rb.tabIndexOf[id])) {
        return;
    }
    rb.bar.setCurrentIndex(rb.tabIndexOf[id]);   // the bar's own signal does the rest and remembers the pick
};

/** The command whose options are showing, as {title}, or undefined. */
Ribbon.currentTool = function() {
    return Ribbon.tools.length === 0 ? undefined : Ribbon.tools[Ribbon.tools.length - 1];
};

/**
 * The options toolbar, found without asking QCAD for it: EAction.getOptionsToolBar()
 * shows the bar every time it is called, which would undo any attempt to keep it in the ribbon.
 */
Ribbon.optionsBar = function() {
    var mw = RMainWindowQt.getMainWindow();
    return isNull(mw) ? undefined : mw.findChild("Options");
};

/** Moves the options toolbar out of the main window and into this drawing's tool tab. */
Ribbon.placeOptions = function(entry) {
    var host = isNull(entry.ribbonItems) ? undefined : entry.ribbonItems.optionsHost;
    if (isNull(host)) {
        return;
    }
    var tb = Ribbon.optionsBar();
    if (isNull(tb)) {
        return;
    }
    if (Ribbon.optionsHost !== entry.id || tb.property("RibbonHosted") !== true) {
        tb.movable = false;
        tb.floatable = false;
        // fill the ribbon's height (above the panel title) rather than sit at toolbar size
        tb.setFixedHeight(Ribbon.BODY_HEIGHT - 16);
        tb.iconSize = new QSize(32, 32);
        host.layout().addWidget(tb);
        tb.setProperty("RibbonHosted", true);
        // the active-tool icon styles itself (OptionsToolBar.initStyle), which outranks the ribbon's sheet
        var icon = tb.findChild("Icon");
        if (!isNull(icon)) { icon.setStyleSheet(""); }
        Ribbon.optionsHost = entry.id;
    }
    tb.visible = true;
};

/** Brings this drawing's ribbon to the front of the stack. */
Ribbon.show = function(entry) {
    try {
        Ribbon.host().setCurrentWidget(entry.ribbon.root);
        Ribbon.activeEntry = entry;
        Ribbon.placeOptions(entry);
    }
    catch (e) {
        qWarning("Ribbon.show: " + e);
    }
};

/** Takes a closed drawing's ribbon page out of the stack. */
Ribbon.discard = function(entry) {
    try {
        if (entry.ribbonDiscarded === true) { return; }
        entry.ribbonDiscarded = true;
        entry.dead = true;
        if (Ribbon.activeEntry === entry) { Ribbon.activeEntry = undefined; }
        var tb = Ribbon.optionsBar();
        if (!isNull(tb) && Ribbon.optionsHost === entry.id) {
            // the options toolbar lives in this page: park it before the page goes
            tb.setParent(RMainWindowQt.getMainWindow());
            tb.hide();
            tb.setProperty("RibbonHosted", false);
            Ribbon.optionsHost = undefined;
        }
        Ribbon.host().removeWidget(entry.ribbon.root);
        entry.ribbon.root.deleteLater();
    }
    catch (e) {
        qWarning("Ribbon.discard: " + e);
    }
};

// ---------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------

Ribbon.iconColor = function() {
    return Theme.isDark() ? "#e8eef5" : "#2b2b2b";
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

/** Every command the app has, indexed once: [{action, file, menus, sort, text}]. */
Ribbon.commandIndex = function() {
    // built once: listing every action is far too heavy to repeat on each refresh
    if (!isNull(Ribbon.indexed)) {
        return Ribbon.indexed;
    }
    var all = RGuiAction.getActions();
    var list = [];
    for (var i = 0; i < all.length; i++) {
        var a = all[i];
        var menus = [];
        var sort = 0;
        var group = 0;
        try {
            var names = a.getWidgetNames();
            for (var k = 0; k < names.length; k++) {
                if (String(names[k]).match(/Menu$/)) { menus.push(String(names[k])); }
            }
            sort = a.getSortOrder();
            group = a.getGroupSortOrder();
        }
        catch (e) {
        }
        list.push({ action: a, file: String(a.getScriptFile()), menus: menus, sort: sort, group: group, text: String(a.text).replace("&", "") });
    }
    Ribbon.indexed = list;
    Ribbon.indexByFile = {};
    Ribbon.indexMissing = {};
    return list;
};

/** An existing menu action whose script file ends with `suffix`, or undefined. */
Ribbon.findAction = function(suffix) {
    var list = Ribbon.commandIndex();
    if (!isNull(Ribbon.indexByFile[suffix])) {
        return Ribbon.indexByFile[suffix];
    }
    if (Ribbon.indexMissing[suffix] === true) {
        return undefined;
    }
    for (var i = 0; i < list.length; i++) {
        var sf = list[i].file;
        if (sf.length >= suffix.length && sf.substring(sf.length - suffix.length) === suffix) {
            Ribbon.indexByFile[suffix] = list[i].action;
            return list[i].action;
        }
    }
    Ribbon.indexMissing[suffix] = true;
    return undefined;
};

/**
 * Every command the ribbon offers, with where: { scriptFile: "tab/panel" }.
 * Walks what is registered: buttons, the variants behind them (a menu or a list), and the
 * columns that wait behind a panel's arrow.
 */
Ribbon.placedFiles = function() {
    var placed = {};
    var put = function(file, where) { if (isNull(placed[file])) { placed[file] = where; } };
    var visit = function(item, where) {
        if (isNull(item)) { return; }
        if (item.type === "stack") {
            for (var i = 0; i < item.items.length; i++) { visit(item.items[i], where); }
            return;
        }
        if (!isNull(item.action)) {
            var a = Ribbon.findAction(item.action);
            if (!isNull(a)) { put(String(a.getScriptFile()), where); }
        }
        if (!isNull(item.dropdown)) {
            for (var d = 0; d < item.dropdown.length; d++) {
                var da = Ribbon.findAction(item.dropdown[d]);
                if (!isNull(da)) { put(String(da.getScriptFile()), where); }
            }
        }
        if (!isNull(item.menuFrom)) {
            var list = Ribbon.actionsOf(item.menuFrom);
            for (var m = 0; m < list.length; m++) { put(list[m].file, where); }
        }
    };
    for (var tid in Ribbon.panels) {
        if (!Ribbon.panels.hasOwnProperty(tid)) { continue; }
        for (var p = 0; p < Ribbon.panels[tid].length; p++) {
            var def = Ribbon.panels[tid][p];
            for (var i = 0; i < def.items.length; i++) { visit(def.items[i], tid + "/" + def.id); }
        }
    }
    return placed;
};

/** The commands of a menu ("DrawLineMenu"), in the menu's own order. */
Ribbon.actionsOf = function(menuName) {
    var list = Ribbon.commandIndex();
    if (isNull(Ribbon.menuCache)) { Ribbon.menuCache = {}; }
    var key = String(menuName);   // one menu name, or several (an array), together as one list
    if (!isNull(Ribbon.menuCache[key])) { return Ribbon.menuCache[key]; }
    var menus = (menuName instanceof Array) ? menuName : [menuName];
    var out = [];
    for (var i = 0; i < list.length; i++) {
        for (var m = 0; m < menus.length; m++) {
            if (list[i].menus.indexOf(menus[m]) >= 0) { out.push(list[i]); break; }
        }
    }
    out.sort(function(x, y) {
        if (x.group !== y.group) { return x.group - y.group; }
        return x.sort !== y.sort ? x.sort - y.sort : (x.text < y.text ? -1 : (x.text > y.text ? 1 : 0));
    });
    Ribbon.menuCache[key] = out;
    return out;
};

/** A command's name as a button label: no shortcut "(OF)", no ellipsis, no "[-]". */
Ribbon.shortText = function(text) {
    return String(text).replace("&", "").replace(/\s*\([A-Z0-9\/]{1,4}\)\s*$/, "").replace(/\s*\[-\]\s*$/, "")
        .replace(/(\u2026|\.\.\.)\s*$/, "").replace(/^\s+|\s+$/g, "");
};

/** Breaks a long label over two lines at the space nearest its middle. */
Ribbon.wrap = function(text) {
    if (text.indexOf("\n") >= 0 || text.length <= 9 || text.indexOf(" ") < 0) {
        return text;
    }
    var mid = text.length / 2;
    var best = -1;
    for (var i = 0; i < text.length; i++) {
        if (text.charAt(i) === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) { best = i; }
    }
    return text.substring(0, best) + "\n" + text.substring(best + 1);
};

// ---------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------

/** The ribbon's colours for the current light or dark theme (shared by what sits beside it). */
Ribbon.colors = function() {
    return Theme.colors();
};

/** A theme was chosen: everything the ribbon draws is dressed again. */
Ribbon.themeChanged = function() {
    Ribbon.iconCache = {};
    if (typeof LayoutTabs !== "undefined") {
        for (var i = 0; i < LayoutTabs.entries.length; i++) {
            var e = LayoutTabs.entries[i];
            if (e.dead === true || isNull(e.ribbon)) { continue; }
            Ribbon.applyTheme(e);
            var icons = isNull(e.ribbonIcons) ? [] : e.ribbonIcons;
            for (var k = 0; k < icons.length; k++) {
                var ic = Ribbon.icon(icons[k].name);
                if (!isNull(ic)) { icons[k].btn.setIcon(ic); }
            }
        }
    }
    if (typeof DocumentTabs !== "undefined" && !isNull(DocumentTabs.strip)) {
        DocumentTabs.applyTheme();
    }
    if (typeof LayoutTabs !== "undefined") {
        for (var j = 0; j < LayoutTabs.entries.length; j++) {
            var le = LayoutTabs.entries[j];
            if (le.dead === true) { continue; }
            le.themeKey = undefined;
            try { LayoutTabs.applyTheme(le); } catch (eLt) { }
        }
    }
};

/** A small orange dot: what marks a contextual tab (one that appears with what you are doing). */
Ribbon.accentDot = function() {
    if (isNull(Ribbon.dotIcon)) {
        var pm = new QPixmap(12, 12);
        pm.fill(new QColor(0, 0, 0, 0));
        var p = new QPainter();
        p.begin(pm);
        p.setRenderHint(QPainter.Antialiasing, true);
        p.setBrush(new QBrush(new QColor("#ff9a2e")));
        p.setPen(new QPen(new QColor(0, 0, 0, 0)));
        p.drawEllipse(2, 2, 8, 8);
        p.end();
        Ribbon.dotIcon = new QIcon(pm);
    }
    return Ribbon.dotIcon;
};

/** Dresses the ribbon for the current light or dark theme. */
Ribbon.applyTheme = function(entry) {
    var rb = entry.ribbon;
    if (isNull(rb)) {
        return;
    }
    var c = Ribbon.colors();
    rb.root.setStyleSheet(
        "QWidget#RibbonRoot, QWidget#RibbonBody, QWidget#RibbonBodyInner { background:" + c.bg + "; } " +
        "QWidget#RibbonHead { background:" + c.head + "; border-bottom:1px solid " + c.line + "; } " +
        "QWidget#RibbonBody { border-bottom:2px solid " + c.line + "; } " +
        "QLabel { color:" + c.text + "; background:transparent; } " +
        "QLabel#RibbonPanelTitle { color:" + c.dim + "; font-size:11px; } " +
        "QToolButton { color:" + c.text + "; background:transparent; border:1px solid transparent; border-radius:4px; padding:0px; } " +
        "QToolButton:hover { background:" + c.hover + "; border-color:" + c.line + "; } " +
        "QToolButton:disabled { color:" + c.dim + "; } " +
        // a split button's arrow sits at the right, clear of the label; a pure dropdown shows its own arrow in the text
        "QToolButton#RibbonSplitArrow { color:" + c.dim2 + "; font-size:10px; border-radius:3px; } " +
        "QToolButton#RibbonSplitArrow:hover { color:" + c.textStrong + "; background:" + c.hover + "; } " +

        "QCheckBox { color:" + c.text + "; } " +
        "QComboBox { color:" + c.text + "; background:" + c.bg + "; border:1px solid " + c.line + "; border-radius:3px; padding:1px 6px; } " +
        // tabs: each its own raised tab, the open one joined to the ribbon below and marked with an accent bar
        "QTabBar::tab { color:" + c.dim2 + "; background:" + c.tab + "; padding:4px 18px; margin-right:3px; min-width:52px; " +
            "border:1px solid " + c.line + "; border-bottom:none; border-top-left-radius:5px; border-top-right-radius:5px; } " +
        "QTabBar::tab:selected { color:" + c.textStrong + "; background:" + c.bg + "; border-top:3px solid " + c.accent + "; font-weight:bold; margin-bottom:-1px; } " +
        "QTabBar::tab:hover:!selected { color:" + c.textStrong + "; background:" + c.hover + "; } " +
        "QWidget#RibbonQuickAccess QToolButton { border:1px solid transparent; border-radius:3px; color:" + c.dim2 + "; } " +
        "QWidget#RibbonQuickAccess QToolButton:hover { background:" + c.hover + "; border-color:" + c.line + "; color:" + c.textStrong + "; } " +
        "QToolButton#RibbonQuickArrow { font-size:9px; } " +
        "QTableWidget#RibbonHistoryList { background:" + c.bg + "; color:" + c.text + "; border:none; outline:none; } " +
        "QTableWidget#RibbonHistoryList::item { padding:2px 8px; } " +
        "QTableWidget#RibbonHistoryList::item:selected { background:" + c.accent + "; color:white; } " +
        "QLabel#RibbonHistoryFooter { color:" + c.dim2 + "; border-top:1px solid " + c.line + "; padding-top:3px; } " +
        "QScrollArea#RibbonBody QScrollBar:horizontal { height:7px; background:transparent; margin:0px; } " +
        "QScrollArea#RibbonBody QScrollBar::handle:horizontal { background:" + c.line + "; border-radius:3px; min-width:30px; } " +
        "QScrollArea#RibbonBody QScrollBar::add-line:horizontal, QScrollArea#RibbonBody QScrollBar::sub-line:horizontal { width:0px; } " +
        "QFrame#RibbonPopupSep { color:" + c.line + "; background:" + c.line + "; max-height:1px; } " +
        "QFrame#RibbonOverflow { background:" + c.bg + "; border:1px solid " + c.line + "; border-top:2px solid " + c.accent + "; } " +
        "QToolButton#RibbonOverflowButton { color:" + c.textStrong + "; font-size:12px; border:1px solid " + c.line + "; border-radius:3px; background:" + c.tab + "; } " +
        "QToolButton#RibbonOverflowButton:hover { background:" + c.hover + "; color:" + c.textStrong + "; } " +
        // a line between panels, so each group of commands reads as one
        "QWidget[ribbonDivider=\"true\"] { border-right:1px solid " + c.line + "; } " +
        // the options toolbar a running command fills: flat, on the ribbon's own colours
        "QWidget#RibbonOptionsHost QToolBar { background:transparent; border:none; spacing:6px; padding:0px; } " +
        "QWidget#RibbonOptionsHost QToolBar::separator { background:" + c.line + "; width:1px; margin:8px 5px; } " +
        "QWidget#RibbonOptionsHost QLineEdit, QWidget#RibbonOptionsHost QAbstractSpinBox, QWidget#RibbonOptionsHost QComboBox { " +
            "color:" + c.text + "; background:" + c.field + "; border:1px solid " + c.line + "; border-radius:3px; " +
            "padding:2px 6px; min-height:22px; selection-background-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QLineEdit:focus, QWidget#RibbonOptionsHost QAbstractSpinBox:focus, QWidget#RibbonOptionsHost QComboBox:focus { border-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QComboBox QAbstractItemView { color:" + c.text + "; background:" + c.field + "; selection-background-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QRadioButton, QWidget#RibbonOptionsHost QCheckBox, QWidget#RibbonOptionsHost QLabel { color:" + c.text + "; spacing:6px; } " +
        "QWidget#RibbonOptionsHost QCheckBox::indicator, QWidget#RibbonCell QCheckBox::indicator { width:14px; height:14px; border:1px solid " + c.dim + "; border-radius:3px; background:" + c.field + "; } " +
        "QWidget#RibbonOptionsHost QCheckBox::indicator:hover, QWidget#RibbonCell QCheckBox::indicator:hover { border-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QCheckBox::indicator:checked, QWidget#RibbonCell QCheckBox::indicator:checked { background:" + c.accent + "; border-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QToolButton:checked { background:" + c.hover + "; border-color:" + c.accent + "; } " +
        "QWidget#RibbonOptionsHost QLabel#Icon { background:" + c.hover + "; border:1px solid " + c.line + "; border-radius:4px; margin:2px 4px 2px 2px; } ");
};

Ribbon.makeButton = function(entry, item, parent) {
    var btn = new QToolButton(parent);
    btn.objectName = "RibbonButton-" + (isNull(item.id) ? "x" : item.id);
    var action = isNull(item.action) ? undefined : Ribbon.findAction(item.action);
    var large = item.size !== "small";

    // a dropdown: commands of a menu ("menuFrom"), or a list of script files ("dropdown")
    var entries = [];
    if (!isNull(item.menuFrom)) {
        entries = Ribbon.actionsOf(item.menuFrom);
    }
    else if (!isNull(item.dropdown)) {
        for (var d = 0; d < item.dropdown.length; d++) {
            var da = Ribbon.findAction(item.dropdown[d]);
            if (!isNull(da)) { entries.push({ action: da, text: String(da.text).replace("&", "") }); }
        }
    }

    var text = !isNull(item.text) ? item.text : (!isNull(action) ? Ribbon.shortText(action.text) : "");
    if (large) { text = Ribbon.wrap(text); }
    btn.text = text;
    var ic = isNull(item.icon) ? undefined : Ribbon.icon(item.icon);
    if (!isNull(ic)) {
        if (isNull(entry.ribbonIcons)) { entry.ribbonIcons = []; }
        entry.ribbonIcons.push({ btn: btn, name: item.icon });   // dressed again when the theme changes
    }
    if (isNull(ic) && !isNull(action)) {
        ic = action.icon;
    }
    if (isNull(ic) && entries.length > 0) {
        ic = entries[0].action.icon;
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
    btn.toolTip = !isNull(item.tooltip) ? item.tooltip : (!isNull(action) ? String(action.statusTip) : String(btn.text).replace("\n", " "));

    var trigger = function() {
        Ribbon.closePopup();
        if (!isNull(item.onClick)) {
            item.onClick(entry, Ribbon.contextOf(entry));
        }
        else if (!isNull(action)) {
            action.slotTrigger();
        }
    };

    // the variants behind the button: commands of a menu or list, or entries the ribbon defines.
    // They open in a popup that opens on a click and stays until a choice is made, like a panel's arrow.
    var variants = [];
    for (var ve = 0; ve < entries.length; ve++) {
        variants.push({ text: Ribbon.shortText(entries[ve].text), icon: entries[ve].action.icon, cmd: entries[ve].action, group: entries[ve].group });
    }
    if (!isNull(item.menu)) {
        for (var vm = 0; vm < item.menu.length; vm++) {
            variants.push({ text: item.menu[vm].text, def: item.menu[vm] });
        }
    }

    var result = btn;
    if (variants.length > 0) {
        var arrow;
        if (!isNull(action) || !isNull(item.onClick)) {
            // a split: the button runs the main command, a separate arrow opens the variants
            btn.clicked.connect(trigger);
            var box = new QWidget(parent);
            box.objectName = "RibbonSplit";
            var hb = new QHBoxLayout();
            hb.setContentsMargins(0, 0, 0, 0);
            hb.setSpacing(0);
            arrow = new QToolButton(box);
            arrow.objectName = "RibbonSplitArrow";
            arrow.text = "\u25be";
            arrow.autoRaise = true;
            arrow.toolTip = qsTr("More %1 commands").arg(String(btn.text).replace("\n", " "));
            arrow.setFixedWidth(16);
            arrow.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Expanding);
            btn.setParent(box);
            hb.addWidget(btn, 0, 0);
            hb.addWidget(arrow, 0, 0);
            box.setLayout(hb);
            result = box;
        }
        else {
            // a pure dropdown: the button itself opens the variants
            arrow = btn;
            if (large) { btn.text = btn.text + " \u25be"; }
        }
        arrow.clicked.connect(function() { Ribbon.openVariants(entry, result, variants); });
    }
    else {
        btn.clicked.connect(trigger);
    }

    // follow the command's own enabled and checked state (undo has nothing to undo, a toggle is on)
    if (!isNull(action) && typeof item.enabled !== "function") {
        if (isNull(entry.ribbonCmd)) { entry.ribbonCmd = []; }
        var checkable = false;
        try { checkable = action.checkable === true; } catch (eC) { }
        if (checkable) { btn.checkable = true; }
        entry.ribbonCmd.push({ btn: btn, action: action, checkable: checkable });
    }
    return result;
};

Ribbon.closePopup = function() {
    var pop = Ribbon.popupOpen;
    Ribbon.popupOpen = undefined;
    if (!isNull(pop)) {
        try {
            pop.close();   // a click outside has already closed (and deleted) it: nothing to do then
        }
        catch (e) {
        }
    }
};

/** Opens a button's variants in a popup under the ribbon, at the button's left edge. */
Ribbon.openVariants = function(entry, anchor, variants) {
    Ribbon.closePopup();
    var pop = new QFrame(anchor);
    pop.objectName = "RibbonOverflow";
    pop.setWindowFlags(Qt.Popup);
    pop.setAttribute(Qt.WA_StyledBackground, true);
    pop.setAttribute(Qt.WA_DeleteOnClose, true);
    var grid = new QHBoxLayout();
    grid.setContentsMargins(6, 6, 6, 6);
    grid.setSpacing(8);
    var perColumn = 10;
    var col;
    for (var i = 0; i < variants.length; i++) {
        if (i % perColumn === 0) {
            col = new QVBoxLayout();
            col.setSpacing(0);
            col.setContentsMargins(0, 0, 0, 0);
            grid.addLayout(col, 0);
        }
        var v = variants[i];
        // a thin line where the menu changes group
        if (i > 0 && i % perColumn !== 0 && !isNull(v.group) && !isNull(variants[i - 1].group) && v.group !== variants[i - 1].group) {
            var sepLine = new QFrame(pop);
            sepLine.frameShape = QFrame.HLine;
            sepLine.setObjectName("RibbonPopupSep");
            sepLine.setFixedHeight(2);
            col.addWidget(sepLine, 0, 0);
        }
        var b = new QToolButton(pop);
        b.text = v.text;
        if (!isNull(v.icon) && !v.icon.isNull()) { b.setIcon(v.icon); }
        b.setIconSize(new QSize(18, 18));
        b.toolButtonStyle = Qt.ToolButtonTextBesideIcon;
        b.autoRaise = true;
        b.setMinimumWidth(170);
        b.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed);
        if (!isNull(v.cmd)) { b.enabled = v.cmd.enabled; }
        b.clicked.connect((function(variant) { return function() {
            Ribbon.closePopup();
            if (!isNull(variant.cmd)) { variant.cmd.slotTrigger(); }
            else if (!isNull(variant.def)) { variant.def.onClick(entry, Ribbon.contextOf(entry)); }
        }; })(v));
        col.addWidget(b, 0, 0);
        if (i === variants.length - 1 || (i + 1) % perColumn === 0) { col.addStretch(1); }
    }
    pop.setLayout(grid);
    pop.adjustSize();
    // directly under the button that opened it, at its left edge
    var at = anchor.mapToGlobal(new QPoint(0, anchor.height));
    pop.move(at.x(), at.y());
    Ribbon.popupOpen = pop;
    pop.show();
};

/** Builds the ribbon for a window into `parent`'s layout (`insertAt` 0 = top). Returns the ribbon state. */
Ribbon.attach = function(entry, stack) {
    var root = new QWidget(stack);
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
    headRow.addSpacing(14);
    headRow.addWidget(Ribbon.makeQuickAccess(entry, head), 0, 0);
    headRow.addStretch(1);
    var state = new QLabel(head);
    state.objectName = "RibbonState";
    headRow.addWidget(state, 0, 0);
    head.setLayout(headRow);
    head.setFixedHeight(Ribbon.TAB_HEIGHT);
    col.addWidget(head, 0, 0);

    // the panels live in a strip inside a scroll area: a window too narrow for them scrolls the strip
    // (wheel or drag) instead of squeezing every label or widening the window
    var body = new QScrollArea(root);
    body.objectName = "RibbonBody";
    body.setFrameShape(QFrame.NoFrame);
    body.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded);
    body.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff);
    body.setWidgetResizable(true);
    var strip = new QWidget(body);
    strip.objectName = "RibbonBodyInner";
    strip.setAttribute(Qt.WA_StyledBackground, true);
    var bodyRow = new QHBoxLayout();
    bodyRow.setContentsMargins(6, 2, 6, 2);
    bodyRow.setSpacing(2);
    strip.setLayout(bodyRow);
    body.setWidget(strip);
    body.setFixedHeight(Ribbon.BODY_HEIGHT);
    body.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Fixed);
    col.addWidget(body, 0, 0);
    root.setLayout(col);

    var rb = { root: root, head: head, bar: bar, body: body, bodyRow: bodyRow, state: state,
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

    // panels: widgets built once, shown per tab
    for (var tid in Ribbon.panels) {
        if (!Ribbon.panels.hasOwnProperty(tid)) { continue; }
        rb.panelWidgets[tid] = [];
        var list = Ribbon.panels[tid];
        for (var p = 0; p < list.length; p++) {
            var pw = Ribbon.makePanel(entry, list[p], strip);
            pw.visible = false;
            bodyRow.addWidget(pw, 0, 0);
            rb.panelWidgets[tid].push(pw);
        }
    }
    bodyRow.addStretch(1);

    stack.addWidget(root);
    Ribbon.applyTheme(entry);
    return rb;
};

/** Keeps a built widget by id, and its enabled() rule, for refresh. */
Ribbon.remember = function(entry, item, widget, panelId) {
    // a button for an action the build does not have (a cave-suite tool, say) is hidden, and a
    // panel left with nothing to show is hidden with it; `available(ctx, entry)` adds its own rule
    if (isNull(item.action) && isNull(item.menuFrom) && typeof item.available !== "function") {
        if (isNull(entry.ribbonFixed)) { entry.ribbonFixed = {}; }
        entry.ribbonFixed[panelId] = true;   // this panel always has something to show
    }
    else {
        if (isNull(entry.ribbonAvail)) { entry.ribbonAvail = []; }
        entry.ribbonAvail.push({ widget: widget, panel: panelId, fn: function(ctx) {
            if (!isNull(item.action) && isNull(Ribbon.findAction(item.action))) { return false; }
            if (!isNull(item.menuFrom) && isNull(item.action) && Ribbon.actionsOf(item.menuFrom).length === 0) { return false; }
            return typeof item.available === "function" ? item.available(ctx, entry) === true : true;
        } });
    }
    if (!isNull(item.id)) {
        if (isNull(entry.ribbonItems)) { entry.ribbonItems = {}; }
        entry.ribbonItems[item.id] = widget;
    }
    if (typeof item.enabled === "function") {
        if (isNull(entry.ribbonEnable)) { entry.ribbonEnable = []; }
        entry.ribbonEnable.push({ widget: widget, fn: item.enabled });
    }
};

/** Most columns a panel shows; the rest wait behind the panel's arrow. A panel can set maxColumns itself. */
Ribbon.MAX_COLUMNS = 3;

/** Builds one column of a panel (a button, a stack of small ones, or a widget) into `row`. */
Ribbon.makeColumn = function(entry, def, item, owner, row) {
    var w;
    if (item.type === "widget") {
        w = item.make(entry, owner);
    }
    else if (item.type === "stack") {
        // a column of small things (buttons or widgets)
        w = new QWidget(owner);
        var col = new QVBoxLayout();
        col.setContentsMargins(0, 0, 0, 0);
        col.setSpacing(0);
        for (var k = 0; k < item.items.length; k++) {
            var sub = item.items[k];
            var sw = sub.type === "widget" ? sub.make(entry, w) : Ribbon.makeButton(entry, sub, w);
            if (!isNull(sw)) {
                col.addWidget(sw, 0, 0);
                Ribbon.remember(entry, sub, sw, def.id);
            }
        }
        col.addStretch(1);
        w.setLayout(col);
    }
    else {
        w = Ribbon.makeButton(entry, item, owner);
    }
    if (!isNull(w)) {
        row.addWidget(w, 0, 0);
        Ribbon.remember(entry, item, w, def.id);
    }
    return w;
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

    // every column is built once; Ribbon.setColumns decides how many sit in the panel and how many
    // wait in the popup behind its arrow (three on a wide window, down to one on a narrow one)
    var tabDef = Ribbon.tabById(def.tabId);
    var unlimited = !isNull(tabDef) && (tabDef.accent === true || tabDef.unlimited === true);
    var limit = !isNull(def.maxColumns) ? def.maxColumns : (unlimited ? 99 : Ribbon.MAX_COLUMNS);
    var cols = [];
    for (var i = 0; i < def.items.length; i++) {
        var w = Ribbon.makeColumn(entry, def, def.items[i], pw, row);
        if (!isNull(w)) { cols.push(w); }
    }
    v.addLayout(row, 0);

    // the title row: the title, and an arrow when columns are waiting behind it
    var titleRow = new QHBoxLayout();
    titleRow.setContentsMargins(0, 0, 0, 0);
    titleRow.setSpacing(0);
    var label = new QLabel(def.title, pw);
    label.alignment = Qt.AlignHCenter;
    label.objectName = "RibbonPanelTitle";
    titleRow.addWidget(label, 1, 0);

    var pop = new QFrame(pw);
    pop.objectName = "RibbonOverflow";
    pop.setWindowFlags(Qt.Popup);
    pop.setAttribute(Qt.WA_StyledBackground, true);
    var popRow = new QHBoxLayout();
    popRow.setContentsMargins(8, 4, 8, 4);
    popRow.setSpacing(2);
    pop.setLayout(popRow);
    var more = new QToolButton(pw);
    more.objectName = "RibbonOverflowButton";
    more.text = "\u25be";
    more.autoRaise = true;
    more.toolTip = qsTr("More %1 commands").arg(def.title);
    more.setFixedSize(24, 16);
    more.visible = false;
    more.clicked.connect(function() {
        // directly under its own panel: the panel's left edge, the ribbon's bottom edge
        pop.setMinimumWidth(pw.width);
        pop.adjustSize();
        pop.move(pw.mapToGlobal(new QPoint(0, pw.height)));
        Ribbon.closePopup();
        Ribbon.popupOpen = pop;
        pop.show();
    });
    titleRow.addWidget(more, 0, 0);
    v.addLayout(titleRow, 0);
    pw.setLayout(v);
    pw.setProperty("ribbonDivider", true);

    if (isNull(entry.ribbonPanels)) { entry.ribbonPanels = {}; }
    var rec = { pw: pw, def: def, cols: cols, row: row, popRow: popRow, pop: pop, more: more, limit: limit, shown: -1 };
    entry.ribbonPanels[def.id] = rec;
    Ribbon.setColumns(rec, Math.min(limit, cols.length));
    return pw;
};

/** Puts the first `n` columns of a panel in the panel and the rest in its popup. */
Ribbon.setColumns = function(rec, n) {
    n = Math.max(1, Math.min(n, rec.cols.length));
    if (rec.shown === n) {
        return;
    }
    Ribbon.closePopup();
    var i;
    for (i = 0; i < rec.cols.length; i++) {
        rec.row.removeWidget(rec.cols[i]);
        rec.popRow.removeWidget(rec.cols[i]);
    }
    for (i = 0; i < rec.cols.length; i++) {
        var w = rec.cols[i];
        if (i < n) {
            w.setParent(rec.pw);
            rec.row.addWidget(w, 0, 0);
            w.visible = true;   // re-parenting hides a widget; availability (Ribbon.refresh) hides again what is not on offer
        }
        else {
            w.setParent(rec.pop);
            rec.popRow.addWidget(w, 0, 0);
        }
    }
    rec.more.visible = n < rec.cols.length;
    rec.shown = n;
};

/**
 * Fits the showing tab to the window: all the columns a panel is allowed, then two, then one,
 * until the panels fit across; what does not fit even then scrolls. Redone when the width or the tab changes.
 */
Ribbon.fit = function(entry) {
    var rb = entry.ribbon;
    if (isNull(rb) || rb.fitting === true || isNull(rb.current) || isNull(entry.ribbonPanels)) {
        return;
    }
    var width = rb.body.width;
    if (width < 100) { return; }   // not laid out yet
    var key = width + "|" + rb.current + "|" + JSON.stringify(rb.panelEmpty);
    if (rb.fitKey === key) {
        return;
    }
    rb.fitting = true;
    try {
        var recs = [];
        var list = Ribbon.panels[rb.current];
        for (var i = 0; i < list.length; i++) {
            var rec = entry.ribbonPanels[list[i].id];
            if (!isNull(rec) && !(rb.panelEmpty && rb.panelEmpty[list[i].id] === true)) { recs.push(rec); }
        }
        var levels = [99, 3, 2, 1];
        for (var lv = 0; lv < levels.length; lv++) {
            var total = 12;
            for (var r = 0; r < recs.length; r++) {
                var rc = recs[r];
                rc.pw.setMinimumWidth(0);
                Ribbon.setColumns(rc, Math.min(rc.limit, levels[lv]));
                rc.pw.layout().activate();
                total += rc.pw.sizeHint.width() + 2;
            }
            if (total <= width || lv === levels.length - 1) { break; }
        }
        // what is showing keeps the width it needs (scroll if that is more than the window has)
        for (var f = 0; f < recs.length; f++) { recs[f].pw.setMinimumWidth(recs[f].pw.sizeHint.width()); }
        rb.fitKey = width + "|" + rb.current + "|" + JSON.stringify(rb.panelEmpty);
    }
    catch (e) {
        qWarning("Ribbon.fit: " + e);
        rb.fitKey = key;   // do not try again until something changes
    }
    rb.fitting = false;
    // columns that moved came back visible: put availability back
    Ribbon.refresh(entry);
};

Ribbon.showPanels = function(entry) {
    var rb = entry.ribbon;
    for (var tid in rb.panelWidgets) {
        if (!rb.panelWidgets.hasOwnProperty(tid)) { continue; }
        for (var i = 0; i < rb.panelWidgets[tid].length; i++) {
            var pid = Ribbon.panels[tid][i].id;
            rb.panelWidgets[tid][i].visible = (tid === rb.current) && !(rb.panelEmpty && rb.panelEmpty[pid] === true);
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
        if (on && typeof def.titleOf === "function") { rb.bar.setTabText(rb.tabIndexOf[def.id], def.titleOf(ctx)); }
        if (def.accent === true) { rb.bar.setTabIcon(rb.tabIndexOf[def.id], Ribbon.accentDot()); }
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
        if ((d2.accent === true || d2.follow === true) && (isNull(rb.lastVisible) || rb.lastVisible.indexOf(visibleIds[a]) < 0)) {
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
    var av = isNull(entry.ribbonAvail) ? [] : entry.ribbonAvail;
    var total = {}, shown = {};
    for (var q = 0; q < av.length; q++) {
        var ok = av[q].fn(ctx);
        av[q].widget.visible = ok;
        total[av[q].panel] = (total[av[q].panel] || 0) + 1;
        shown[av[q].panel] = (shown[av[q].panel] || 0) + (ok ? 1 : 0);
    }
    rb.panelEmpty = {};
    for (var pid in total) {
        if (total.hasOwnProperty(pid) && !shown[pid] && !(entry.ribbonFixed && entry.ribbonFixed[pid])) { rb.panelEmpty[pid] = true; }
    }
    Ribbon.showPanels(entry);
    if (!isNull(ctx.tool) && rb.root.visible) { Ribbon.placeOptions(entry); }
    rb.state.text = isNull(ctx.stateText) ? "" : ctx.stateText;
    var en = isNull(entry.ribbonEnable) ? [] : entry.ribbonEnable;
    for (var e = 0; e < en.length; e++) {
        en[e].widget.enabled = en[e].fn(ctx) === true;
    }
    if (!isNull(Ribbon.onRefresh)) {
        Ribbon.onRefresh(entry, ctx);
    }
    if (rb.fitting !== true) { Ribbon.fit(entry); }
};

Ribbon.tabById = function(id) {
    for (var i = 0; i < Ribbon.tabs.length; i++) {
        if (Ribbon.tabs[i].id === id) { return Ribbon.tabs[i]; }
    }
    return undefined;
};
