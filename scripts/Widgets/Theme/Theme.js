/**
 * Theme -- the look of the whole application, in a choice of colours, dark or light.
 *
 * This replaces QCAD's own themes (a folder of stylesheets and a preferences page, neither
 * of which is kept). A choice is a mode (dark / light) and a colour: ten of each. From it the
 * ribbon, the document tabs and every other widget in the application take their colours, from
 * one application style sheet written here.
 *
 *     Theme.activate();                     // at startup, and after a change
 *     Theme.choose("dark", "forest");    // saves and applies
 *     Theme.colors();                    // the palette now in force (the ribbon and tabs read this)
 *     Theme.openChooser(anchorWidget);   // the swatch popup
 *
 * What a theme cannot change live is the set of toolbar icons (light-on-dark or dark-on-light):
 * QCAD picks those once, when it loads its commands. The style sheet carries the marker QCAD
 * looks for, so they match from the next launch.
 */

function Theme() {
}

Theme.SETTING = "Theme/Choice";
Theme.DEFAULT = "dark/ocean";

/** The colours on offer. `hue` and `sat` (1 = the standard strength) tint the greys; `accent` is the highlight. */
Theme.PRESETS = [
    { id: "ocean",    name: "Ocean",    hue: 210, sat: 1.00, accent: "#188cff" },
    { id: "teal",     name: "Teal",     hue: 178, sat: 1.00, accent: "#14b8a6" },
    { id: "forest",   name: "Forest",   hue: 145, sat: 0.90, accent: "#2fb86a" },
    { id: "amber",    name: "Amber",    hue: 38,  sat: 0.90, accent: "#f0a020" },
    { id: "ember",    name: "Ember",    hue: 18,  sat: 0.95, accent: "#f06a3a" },
    { id: "crimson",  name: "Crimson",  hue: 352, sat: 0.95, accent: "#e5484d" },
    { id: "rose",     name: "Rose",     hue: 328, sat: 0.95, accent: "#e255a1" },
    { id: "violet",   name: "Violet",   hue: 270, sat: 1.00, accent: "#8e6cef" },
    { id: "indigo",   name: "Indigo",   hue: 236, sat: 1.00, accent: "#5b6cf5" },
    { id: "graphite", name: "Graphite", hue: 215, sat: 0.15, accent: "#8aa0b8" }
];

/** "#rrggbb" from hue (0-360), saturation and lightness (0-1). */
Theme.hsl = function(h, s, l) {
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    var hex = function(v) { var n = Math.round((v + m) * 255); return (n < 16 ? "0" : "") + n.toString(16); };
    return "#" + hex(r) + hex(g) + hex(b);
};

/** The saved choice as {mode, id}; mode "auto" follows the system. */
Theme.choice = function() {
    var raw = String(RSettings.getStringValue(Theme.SETTING, Theme.DEFAULT));
    var parts = raw.split("/");
    var id = parts.length > 1 ? parts[1] : "ocean";
    var mode = parts[0];
    if (mode !== "dark" && mode !== "light") {
        mode = RSettings.hasDarkGuiBackground() ? "dark" : "light";
    }
    return { mode: mode, id: id };
};

Theme.preset = function(id) {
    for (var i = 0; i < Theme.PRESETS.length; i++) {
        if (Theme.PRESETS[i].id === id) { return Theme.PRESETS[i]; }
    }
    return Theme.PRESETS[0];
};

Theme.isDark = function() {
    return Theme.choice().mode === "dark";
};

/** The palette for a mode and colour (the saved choice when none is given). */
Theme.colors = function(mode, id) {
    if (isNull(mode)) {
        var ch = Theme.choice();
        mode = ch.mode;
        id = ch.id;
    }
    var p = Theme.preset(id);
    var k = p.sat;
    var H = p.hue;
    var c;
    if (mode === "dark") {
        c = {
            bg: Theme.hsl(H, 0.31 * k, 0.153), head: Theme.hsl(H, 0.30 * k, 0.12), tab: Theme.hsl(H, 0.32 * k, 0.19),
            line: Theme.hsl(H, 0.28 * k, 0.30), hover: Theme.hsl(H, 0.33 * k, 0.27), field: Theme.hsl(H, 0.30 * k, 0.10),
            dim: Theme.hsl(H, 0.18 * k, 0.55), dim2: Theme.hsl(H, 0.20 * k, 0.72),
            text: Theme.hsl(H, 0.90 * k, 0.96), textStrong: "#ffffff", accent: p.accent
        };
    }
    else {
        c = {
            bg: Theme.hsl(H, 0.30 * k, 0.965), head: Theme.hsl(H, 0.25 * k, 0.92), tab: Theme.hsl(H, 0.22 * k, 0.86),
            line: Theme.hsl(H, 0.20 * k, 0.82), hover: Theme.hsl(H, 0.50 * k, 0.91), field: "#ffffff",
            dim: Theme.hsl(H, 0.15 * k, 0.64), dim2: Theme.hsl(H, 0.20 * k, 0.36),
            text: Theme.hsl(H, 0.40 * k, 0.15), textStrong: Theme.hsl(H, 0.50 * k, 0.09), accent: p.accent
        };
    }
    return c;
};

/** The style sheet for the whole application. */
Theme.sheet = function(c, dark) {
    var q = [];
    // the marker QCAD reads to choose light-on-dark or dark-on-light toolbar icons
    q.push("/* IconPostfix:" + (dark ? "inverse" : "none") + " */");
    q.push("QWidget { background-color:" + c.bg + "; color:" + c.text + "; selection-background-color:" + c.accent + "; selection-color:#ffffff; }");
    q.push("QLabel, QCheckBox, QRadioButton, QGroupBox { background:transparent; }");
    q.push("QMainWindow::separator { background:" + c.head + "; width:3px; height:3px; }");
    q.push("QMainWindow::separator:hover { background:" + c.accent + "; }");
    q.push("QToolTip { background:" + c.head + "; color:" + c.textStrong + "; border:1px solid " + c.line + "; padding:3px; }");
    q.push("QMenuBar { background:" + c.head + "; } QMenuBar::item { padding:3px 9px; background:transparent; } QMenuBar::item:selected { background:" + c.hover + "; }");
    q.push("QMenu { background:" + c.bg + "; border:1px solid " + c.line + "; padding:3px; } QMenu::item { padding:4px 22px 4px 18px; border-radius:3px; }");
    q.push("QMenu::item:selected { background:" + c.accent + "; color:#ffffff; } QMenu::item:disabled { color:" + c.dim + "; } QMenu::separator { height:1px; background:" + c.line + "; margin:3px 6px; }");
    q.push("QToolBar { background:" + c.head + "; border:none; spacing:2px; padding:2px; }");
    q.push("QToolButton { background:transparent; border:1px solid transparent; border-radius:4px; padding:2px; }");
    q.push("QToolButton:hover { background:" + c.hover + "; border-color:" + c.line + "; } QToolButton:pressed, QToolButton:checked { background:" + c.tab + "; border-color:" + c.accent + "; }");
    q.push("QPushButton { background:" + c.tab + "; border:1px solid " + c.line + "; border-radius:4px; padding:3px 12px; min-height:20px; }");
    q.push("QPushButton:hover { background:" + c.hover + "; } QPushButton:pressed { background:" + c.accent + "; color:#ffffff; } QPushButton:disabled { color:" + c.dim + "; } QPushButton:default { border-color:" + c.accent + "; }");
    q.push("QLineEdit, QPlainTextEdit, QTextEdit, QAbstractSpinBox, QComboBox { background:" + c.field + "; border:1px solid " + c.line + "; border-radius:3px; padding:2px 6px; }");
    q.push("QLineEdit:focus, QAbstractSpinBox:focus, QComboBox:focus, QPlainTextEdit:focus, QTextEdit:focus { border-color:" + c.accent + "; }");
    q.push("QLineEdit:disabled, QAbstractSpinBox:disabled, QComboBox:disabled { color:" + c.dim + "; }");
    q.push("QComboBox QAbstractItemView { background:" + c.field + "; border:1px solid " + c.line + "; selection-background-color:" + c.accent + "; }");
    q.push("QCheckBox::indicator, QRadioButton::indicator { width:14px; height:14px; border:1px solid " + c.dim + "; background:" + c.field + "; }");
    q.push("QCheckBox::indicator { border-radius:3px; } QRadioButton::indicator { border-radius:8px; }");
    q.push("QCheckBox::indicator:checked, QRadioButton::indicator:checked { background:" + c.accent + "; border-color:" + c.accent + "; }");
    q.push("QGroupBox { border:1px solid " + c.line + "; border-radius:4px; margin-top:9px; } QGroupBox::title { subcontrol-origin:margin; left:8px; padding:0 4px; }");
    q.push("QTabWidget::pane { border:1px solid " + c.line + "; }");
    q.push("QTabBar::tab { background:" + c.tab + "; border:1px solid " + c.line + "; border-bottom:none; padding:4px 12px; }");
    q.push("QTabBar::tab:selected { background:" + c.bg + "; border-top:2px solid " + c.accent + "; } QTabBar::tab:hover:!selected { background:" + c.hover + "; }");
    q.push("QDockWidget::title { background:" + c.head + "; padding:4px 6px; border-bottom:1px solid " + c.line + "; }");
    q.push("QScrollBar:vertical { background:" + c.bg + "; width:11px; margin:0; } QScrollBar:horizontal { background:" + c.bg + "; height:11px; margin:0; }");
    q.push("QScrollBar::handle:vertical, QScrollBar::handle:horizontal { background:" + c.line + "; border-radius:5px; min-height:24px; min-width:24px; }");
    q.push("QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover { background:" + c.dim + "; }");
    q.push("QScrollBar::add-line, QScrollBar::sub-line { width:0; height:0; } QScrollBar::add-page, QScrollBar::sub-page { background:transparent; }");
    q.push("QHeaderView::section { background:" + c.head + "; border:1px solid " + c.line + "; padding:3px 6px; }");
    q.push("QTableView, QListView, QTreeView, QTableWidget, QListWidget, QTreeWidget { background:" + c.field + "; alternate-background-color:" + c.bg + "; gridline-color:" + c.line + "; border:1px solid " + c.line + "; selection-background-color:" + c.accent + "; }");
    q.push("QProgressBar { border:1px solid " + c.line + "; background:" + c.field + "; text-align:center; border-radius:3px; } QProgressBar::chunk { background:" + c.accent + "; }");
    q.push("QSlider::groove:horizontal { height:4px; background:" + c.line + "; border-radius:2px; } QSlider::handle:horizontal { background:" + c.accent + "; width:12px; margin:-5px 0; border-radius:6px; }");
    q.push("QStatusBar { background:" + c.head + "; } QSplitter::handle { background:" + c.line + "; }");
    return q.join("\n");
};

/** Applies the saved choice to the whole application. */
Theme.activate = function() {
    var ch = Theme.choice();
    var c = Theme.colors(ch.mode, ch.id);
    qApp.styleSheet = Theme.sheet(c, ch.mode === "dark");
    Theme.applied = ch.mode + "/" + ch.id;
    // QCAD works out dark-or-light once and remembers it (rulers, cursor arrows ...): forget it,
    // so what is drawn from here on follows this theme
    RSettings.resetCache();
};

/** Saves a choice and applies it; the ribbon and document tabs follow. */
Theme.choose = function(mode, id) {
    RSettings.setValue(Theme.SETTING, mode + "/" + id);
    Theme.activate();
    if (typeof Ribbon !== "undefined" && !isNull(Ribbon.themeChanged)) {
        Ribbon.themeChanged();
    }
};

/** A small picture of a theme: its surface, with its highlight along the bottom. */
Theme.swatch = function(c) {
    var pm = new QPixmap(40, 30);
    pm.fill(new QColor(c.bg));
    var p = new QPainter();
    p.begin(pm);
    p.setPen(new QPen(new QColor(c.line)));
    p.setBrush(new QBrush(new QColor(c.tab)));
    p.drawRect(0, 0, 39, 9);
    p.setBrush(new QBrush(new QColor(c.accent)));
    p.setPen(new QPen(new QColor(0, 0, 0, 0)));
    p.drawRect(0, 22, 40, 8);
    p.setPen(new QPen(new QColor(c.line)));
    p.setBrush(new QBrush(new QColor(0, 0, 0, 0)));
    p.drawRect(0, 0, 39, 29);
    p.end();
    return new QIcon(pm);
};

/** The chooser: a row of colours in dark and a row in light, under the button that opened it. */
Theme.openChooser = function(anchor) {
    if (typeof Ribbon !== "undefined") { Ribbon.closePopup(); }
    var now = Theme.choice();
    var c = Theme.colors();
    var pop = new QFrame(anchor);
    pop.objectName = "ThemeChooser";
    pop.setWindowFlags(Qt.Popup);
    pop.setAttribute(Qt.WA_StyledBackground, true);
    pop.setAttribute(Qt.WA_DeleteOnClose, true);
    pop.setStyleSheet("QFrame#ThemeChooser { background:" + c.bg + "; border:1px solid " + c.line + "; border-top:2px solid " + c.accent + "; } " +
        "QLabel { color:" + c.dim2 + "; background:transparent; } " +
        "QToolButton { background:transparent; border:2px solid transparent; border-radius:5px; padding:2px; } " +
        "QToolButton:hover { background:" + c.hover + "; } " +
        "QToolButton[current=\"true\"] { border-color:" + c.accent + "; }");
    var v = new QVBoxLayout();
    v.setContentsMargins(10, 8, 10, 8);
    v.setSpacing(6);
    var modes = [ { mode: "dark", title: qsTr("Dark") }, { mode: "light", title: qsTr("Light") } ];
    for (var m = 0; m < modes.length; m++) {
        var heading = new QLabel(modes[m].title, pop);
        v.addWidget(heading, 0, 0);
        var row = new QHBoxLayout();
        row.setSpacing(4);
        for (var i = 0; i < Theme.PRESETS.length; i++) {
            var pr = Theme.PRESETS[i];
            var b = new QToolButton(pop);
            b.setIcon(Theme.swatch(Theme.colors(modes[m].mode, pr.id)));
            b.setIconSize(new QSize(40, 30));
            b.toolTip = pr.name + " (" + modes[m].title.toLowerCase() + ")";
            b.setProperty("current", now.mode === modes[m].mode && now.id === pr.id);
            b.clicked.connect((function(mode, id) { return function() {
                if (typeof Ribbon !== "undefined") { Ribbon.closePopup(); }
                Theme.choose(mode, id);
            }; })(modes[m].mode, pr.id));
            row.addWidget(b, 0, 0);
        }
        v.addLayout(row, 0);
    }
    var foot = new QLabel(qsTr("Toolbar icons match the mode from the next launch."), pop);
    v.addWidget(foot, 0, 0);
    pop.setLayout(v);
    pop.adjustSize();
    var at = anchor.mapToGlobal(new QPoint(0, anchor.height));
    pop.move(at.x(), at.y());
    if (typeof Ribbon !== "undefined") { Ribbon.popupOpen = pop; }
    pop.show();
};

Theme.init = function(basePath) {
    // applied early by applyTheme() (library.js); this makes sure of it for a start that skipped that
    if (isNull(Theme.applied)) {
        Theme.activate();
    }
};
