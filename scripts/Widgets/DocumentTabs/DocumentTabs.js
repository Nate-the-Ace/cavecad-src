/**
 * DocumentTabs -- the open drawings as tabs along the top of the drawing area, in the
 * ribbon's style: the first tab at the left, each newly opened drawing to the right of the
 * last, and any tab can be dragged to a new place.
 *
 * Qt centres the tabs of the document area's own tab bar and cannot be told otherwise, so that
 * bar is kept (it still tells the area which drawing is showing) but collapsed, and this strip
 * is drawn in the band it leaves. The strip mirrors the bar: same titles, same current drawing,
 * clicking a tab raises that drawing, the x closes it. Only the ORDER of the tabs is the strip's own.
 */

include("scripts/Widgets/Ribbon/Ribbon.js");

function DocumentTabs() {
}

DocumentTabs.TAB_HEIGHT = 26;
DocumentTabs.order = [];        // sub-window ids, in the order the tabs are shown
DocumentTabs.nextId = 1;

DocumentTabs.init = function(basePath) {
    if (!RSettings.getBoolValue("DocumentTabs/Enabled", true) || RSettings.getBoolValue("TabBar/ShowTabBar", true) === false) {
        return;
    }
    ViewportWidget.addMdiInitFunction(function(root, di) { DocumentTabs.start(); });
};

DocumentTabs.start = function() {
    if (DocumentTabs.started === true) {
        return;
    }
    var mdi = EAction.getMdiArea();
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(mdi) || isNull(appWin) || isNull(appWin.getTabBar())) {
        return;
    }
    DocumentTabs.started = true;
    mdi.tabsMovable = false;   // the built-in bar keeps creation order; the strip owns the order shown

    var strip = new QWidget(mdi);
    strip.objectName = "DocumentTabStrip";
    strip.setAttribute(Qt.WA_StyledBackground, true);
    var row = new QHBoxLayout();
    row.setContentsMargins(4, 2, 4, 0);
    row.setSpacing(2);
    var bar = new QTabBar(strip);
    bar.objectName = "DocumentTabs";
    bar.expanding = false;
    bar.drawBase = false;
    bar.movable = true;
    bar.tabsClosable = true;
    bar.usesScrollButtons = true;
    bar.elideMode = Qt.ElideRight;
    row.addWidget(bar, 0, 0);
    var plus = new QToolButton(strip);
    plus.objectName = "DocumentTabAdd";
    plus.text = "+";
    plus.autoRaise = true;
    plus.toolTip = qsTr("New drawing");
    row.addWidget(plus, 0, 0);
    row.addStretch(1);
    strip.setLayout(row);
    strip.setFixedHeight(DocumentTabs.TAB_HEIGHT);
    DocumentTabs.strip = strip;
    DocumentTabs.bar = bar;

    bar.contextMenuPolicy = Qt.CustomContextMenu;
    bar.customContextMenuRequested.connect(function(pos) { DocumentTabs.contextMenu(pos); });
    bar.currentChanged.connect(function(index) { DocumentTabs.picked(index); });
    bar.tabCloseRequested.connect(function(index) { DocumentTabs.closeTab(index); });
    bar.tabMoved.connect(function(from, to) { DocumentTabs.moved(from, to); });
    plus.clicked.connect(function() {
        var a = RGuiAction.getByScriptFile("scripts/File/NewFile/NewFile.js");
        if (!isNull(a)) { a.slotTrigger(); }
    });

    DocumentTabs.applyTheme();
    DocumentTabs.sync(true);
    var timer = new QTimer();
    timer.interval = 150;
    timer.timeout.connect(function() {
        try {
            DocumentTabs.sync(false);
        }
        catch (e) {
            qWarning("DocumentTabs.sync: " + e);
        }
    });
    timer.start(150);
    DocumentTabs.timer = timer;
};

DocumentTabs.applyTheme = function() {
    var c = Ribbon.colors();
    var key = JSON.stringify(c);
    if (DocumentTabs.themeKey === key) { return; }
    DocumentTabs.themeKey = key;
    DocumentTabs.strip.setStyleSheet(
        "QWidget#DocumentTabStrip { background:" + c.head + "; border-bottom:1px solid " + c.line + "; } " +
        "QTabBar#DocumentTabs { background:transparent; } " +
        "QTabBar#DocumentTabs::tab { color:" + c.dim2 + "; background:" + c.tab + "; padding:3px 10px 3px 12px; margin-right:2px; min-width:90px; max-width:240px; " +
            "border:1px solid " + c.line + "; border-bottom:none; border-top-left-radius:5px; border-top-right-radius:5px; } " +
        "QTabBar#DocumentTabs::tab:selected { color:" + c.textStrong + "; background:" + c.bg + "; border-top:3px solid " + c.accent + "; font-weight:bold; } " +
        "QTabBar#DocumentTabs::tab:hover:!selected { color:" + c.textStrong + "; background:" + c.hover + "; } " +
        "QMenu { background:" + c.bg + "; color:" + c.text + "; border:1px solid " + c.line + "; padding:3px; } " +
        "QMenu::item { padding:4px 18px; border-radius:3px; } " +
        "QMenu::item:selected { background:" + c.accent + "; color:white; } " +
        "QMenu::item:disabled { color:" + c.dim + "; } " +
        "QMenu::separator { height:1px; background:" + c.line + "; margin:3px 6px; } " +
        "QToolButton#DocumentTabAdd { color:" + c.dim2 + "; font-size:15px; border-radius:3px; min-width:22px; padding:0px; } " +
        "QToolButton#DocumentTabAdd:hover { background:" + c.hover + "; color:" + c.textStrong + "; }");
};

/** The open drawings' sub-windows, each given a lasting id the first time it is seen. */
DocumentTabs.subs = function() {
    var list = EAction.getMdiArea().subWindowList();
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var id = list[i].property("docTabId");
        if (isNull(id) || id === "" || typeof id === "undefined") {
            id = DocumentTabs.nextId++;
            list[i].setProperty("docTabId", id);
        }
        out.push({ id: id, sub: list[i] });
    }
    return out;
};

/**
 * Brings the strip in line with the open drawings: new ones join at the right, closed ones go,
 * titles follow the built-in bar's, and the current tab is the drawing that is showing.
 */
DocumentTabs.sync = function(force) {
    var appWin = RMainWindowQt.getMainWindow();
    var mdi = EAction.getMdiArea();
    var tb = appWin.getTabBar();
    if (isNull(tb) || isNull(DocumentTabs.strip)) {
        return;
    }
    // the built-in bar stays collapsed, and the strip sits in the band it leaves
    if (tb.visible || tb.height > 0) {
        tb.setFixedHeight(0);
        tb.hide();
    }
    DocumentTabs.strip.setGeometry(0, 0, mdi.width, DocumentTabs.TAB_HEIGHT);
    DocumentTabs.strip.raise();
    DocumentTabs.applyTheme();

    var subs = DocumentTabs.subs();
    var byId = {};
    var titles = {};
    for (var i = 0; i < subs.length; i++) {
        byId[subs[i].id] = subs[i].sub;
        titles[subs[i].id] = String(tb.tabText(i));
    }
    // drop ids that are gone, add new ones at the right
    var order = [];
    for (var o = 0; o < DocumentTabs.order.length; o++) {
        if (!isNull(byId[DocumentTabs.order[o]])) { order.push(DocumentTabs.order[o]); }
    }
    for (var n = 0; n < subs.length; n++) {
        if (order.indexOf(subs[n].id) < 0) { order.push(subs[n].id); }
    }
    DocumentTabs.order = order;

    var currentId = subs.length > tb.currentIndex && tb.currentIndex >= 0 ? subs[tb.currentIndex].id : -1;
    var signature = order.join(",") + "|" + currentId;
    for (var t = 0; t < order.length; t++) { signature += "|" + titles[order[t]]; }
    if (force !== true && signature === DocumentTabs.signature) {
        return;
    }
    DocumentTabs.signature = signature;

    var bar = DocumentTabs.bar;
    DocumentTabs.syncing = true;
    while (bar.count > 0) { bar.removeTab(bar.count - 1); }
    for (var k = 0; k < order.length; k++) { bar.addTab(titles[order[k]]); }
    var cur = order.indexOf(currentId);
    if (cur >= 0) { bar.setCurrentIndex(cur); }
    DocumentTabs.syncing = false;
    // one tab has nothing to be reordered with (dragging it only slides it out of sight)
    bar.movable = order.length > 1;
    DocumentTabs.strip.visible = order.length > 0;
};

/** The sub-window of the tab at `index`. */
DocumentTabs.subAt = function(index) {
    if (index < 0 || index >= DocumentTabs.order.length) { return undefined; }
    var subs = DocumentTabs.subs();
    for (var i = 0; i < subs.length; i++) {
        if (subs[i].id === DocumentTabs.order[index]) { return { sub: subs[i].sub, index: i }; }
    }
    return undefined;
};

DocumentTabs.picked = function(index) {
    if (DocumentTabs.syncing === true) { return; }
    var hit = DocumentTabs.subAt(index);
    if (isNull(hit)) { return; }
    // the built-in bar raises the drawing; its index is the sub-window's place in the area's own list
    RMainWindowQt.getMainWindow().getTabBar().setCurrentIndex(hit.index);
};

DocumentTabs.closeTab = function(index) {
    var hit = DocumentTabs.subAt(index);
    if (isNull(hit)) { return; }
    hit.sub.close();   // asks to save, as closing any other way does
};

/** A tab was dragged: the order follows. */
DocumentTabs.moved = function(from, to) {
    if (DocumentTabs.syncing === true) { return; }
    var id = DocumentTabs.order.splice(from, 1)[0];
    DocumentTabs.order.splice(to, 0, id);
    // keep the signature honest so the next sync does not redraw what the person just arranged
    var tb = RMainWindowQt.getMainWindow().getTabBar();
    DocumentTabs.signature = undefined;
};

/** The drawing's file on disk, or "" when it has not been saved yet. */
DocumentTabs.filePath = function(sub) {
    try {
        var name = sub.getDocumentInterface().getDocument().getFileName();
        return isNull(name) ? "" : String(name);
    }
    catch (e) {
        return "";
    }
};

/** Right-click on a tab: where the drawing lives. */
DocumentTabs.contextMenu = function(pos) {
    var index = DocumentTabs.bar.tabAt(pos);
    var hit = DocumentTabs.subAt(index);
    if (isNull(hit)) {
        return;
    }
    var path = DocumentTabs.filePath(hit.sub);
    var saved = path !== "";
    var dir = saved ? String(new QFileInfo(path).absolutePath()) : "";
    var sys = RS.getSystemId();
    var revealText = sys === "osx" ? qsTr("Show in Finder") : (sys === "win" ? qsTr("Show in Explorer") : qsTr("Open containing folder"));

    var menu = new QMenu(DocumentTabs.bar);
    menu.objectName = "DocumentTabMenu";
    var copyDir = menu.addAction(qsTr("Copy folder path"));
    var copyFile = menu.addAction(qsTr("Copy file path"));
    var reveal = menu.addAction(revealText);
    menu.addSeparator();
    var close = menu.addAction(qsTr("Close"));
    copyDir.enabled = saved;
    copyFile.enabled = saved;
    reveal.enabled = saved;
    if (!saved) {
        copyDir.toolTip = qsTr("This drawing has not been saved yet");
    }
    copyDir.triggered.connect(function() { getClipboard().setText(dir); });
    copyFile.triggered.connect(function() { getClipboard().setText(path); });
    reveal.triggered.connect(function() { DocumentTabs.reveal(path, dir); });
    close.triggered.connect(function() { DocumentTabs.closeTab(DocumentTabs.bar.tabAt(pos)); });
    DocumentTabs.lastMenu = menu;
    menu.popup(DocumentTabs.bar.mapToGlobal(pos));
};

/** Opens the folder with the drawing's file selected where the system can do that. */
DocumentTabs.reveal = function(path, dir) {
    var sys = RS.getSystemId();
    if (sys === "osx" || sys === "win") {
        var p = new QProcess();
        if (sys === "osx") {
            p.setProgram("open");
            p.setArguments(["-R", path]);
        }
        else {
            p.setProgram("explorer");
            p.setArguments(["/select," + path.replace(/\//g, "\\")]);
        }
        p.startDetached();
    }
    else {
        QDesktopServices.openUrl(QUrl.fromLocalFile(dir));
    }
};
