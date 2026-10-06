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

/** The commands of a menu ("DrawLineMenu"), in the menu's own order. */
Ribbon.actionsOf = function(menuName) {
    var list = Ribbon.commandIndex();
    if (isNull(Ribbon.menuCache)) { Ribbon.menuCache = {}; }
    if (!isNull(Ribbon.menuCache[menuName])) { return Ribbon.menuCache[menuName]; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].menus.indexOf(menuName) >= 0) { out.push(list[i]); }
    }
    out.sort(function(x, y) {
        if (x.group !== y.group) { return x.group - y.group; }
        return x.sort !== y.sort ? x.sort - y.sort : (x.text < y.text ? -1 : (x.text > y.text ? 1 : 0));
    });
    Ribbon.menuCache[menuName] = out;
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

/** Dresses the ribbon for the current light or dark theme. */
Ribbon.applyTheme = function(entry) {
    var rb = entry.ribbon;
    if (isNull(rb)) {
        return;
    }
    var dark = Ribbon.iconColor() !== "#2b2b2b";
    var c = dark ?
        { bg: "#1b2733", head: "#16202a", text: "#eaf3ff", dim: "#7d8fa3", line: "#34495e", hover: "#2c4258", accent: "#188cff", field: "#121a22", tab: "#223140", dim2: "#a9b8c8", textStrong: "#ffffff" } :
        { bg: "#f3f6fa", head: "#e4e9f0", text: "#16283c", dim: "#9aa8b8", line: "#c3cdd9", hover: "#dfe9f5", accent: "#188cff", field: "#ffffff", tab: "#d5dce6", dim2: "#4a5b6e", textStrong: "#0b1d33" };
    rb.root.setStyleSheet(
        "QWidget#RibbonRoot, QWidget#RibbonBody { background:" + c.bg + "; } " +
        "QWidget#RibbonHead { background:" + c.head + "; border-bottom:1px solid " + c.line + "; } " +
        "QWidget#RibbonBody { border-bottom:2px solid " + c.line + "; } " +
        "QLabel { color:" + c.text + "; background:transparent; } " +
        "QLabel#RibbonPanelTitle { color:" + c.dim + "; font-size:11px; } " +
        "QToolButton { color:" + c.text + "; background:transparent; border:1px solid transparent; border-radius:4px; } " +
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
    headRow.addStretch(1);
    var state = new QLabel(head);
    state.objectName = "RibbonState";
    headRow.addWidget(state, 0, 0);
    head.setLayout(headRow);
    head.setFixedHeight(Ribbon.TAB_HEIGHT);
    col.addWidget(head, 0, 0);

    var body = new QWidget(root);
    body.objectName = "RibbonBody";
    body.setAttribute(Qt.WA_StyledBackground, true);
    var bodyRow = new QHBoxLayout();
    bodyRow.setContentsMargins(6, 2, 6, 2);
    bodyRow.setSpacing(2);
    bodyRow.setSizeConstraint(1);   // QLayout.SetNoConstraint: panels that do not fit are clipped, they never widen the window
    body.setLayout(bodyRow);
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
            var pw = Ribbon.makePanel(entry, list[p], body);
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

    // the everyday tabs hold three columns a panel; contextual tabs (and ones that say so) show everything
    var tabDef = Ribbon.tabById(def.tabId);
    var unlimited = !isNull(tabDef) && (tabDef.accent === true || tabDef.unlimited === true);
    var limit = !isNull(def.maxColumns) ? def.maxColumns : (unlimited ? 99 : Ribbon.MAX_COLUMNS);
    var shown = Math.min(limit, def.items.length);
    for (var i = 0; i < shown; i++) {
        Ribbon.makeColumn(entry, def, def.items[i], pw, row);
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
    if (def.items.length > shown) {
        var pop = new QFrame(pw);
        pop.objectName = "RibbonOverflow";
        pop.setWindowFlags(Qt.Popup);
        pop.setAttribute(Qt.WA_StyledBackground, true);
        var popRow = new QHBoxLayout();
        popRow.setContentsMargins(8, 4, 8, 4);
        popRow.setSpacing(2);
        pop.setLayout(popRow);
        for (var o = shown; o < def.items.length; o++) {
            Ribbon.makeColumn(entry, def, def.items[o], pop, popRow);
        }
        var more = new QToolButton(pw);
        more.objectName = "RibbonOverflowButton";
        more.text = "\u25be";
        more.autoRaise = true;
        more.toolTip = qsTr("More %1 commands").arg(def.title);
        more.setFixedSize(24, 16);
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
    }
    v.addLayout(titleRow, 0);
    pw.setLayout(v);
    pw.setProperty("ribbonDivider", true);
    return pw;
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
};

Ribbon.tabById = function(id) {
    for (var i = 0; i < Ribbon.tabs.length; i++) {
        if (Ribbon.tabs[i].id === id) { return Ribbon.tabs[i]; }
    }
    return undefined;
};
