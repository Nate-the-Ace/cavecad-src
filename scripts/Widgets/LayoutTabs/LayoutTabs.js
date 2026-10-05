/**
 * LayoutTabs -- the Model | Layout tabs under every drawing (AutoCAD style).
 *
 * One strip per drawing window: a QTabBar (Model first, then the paper
 * layouts in tab order) and a "+" button. Picking a tab shows that block
 * (Layouts.activate); layouts added, renamed or removed anywhere (menus,
 * undo, Sheet Setup) reach the strip through the block listener, which asks
 * every strip to rebuild itself from its own document.
 *
 * While a layout is shown the view gets the paper: grey surround, white
 * sheet with a shadow, dashed printable margin (LayoutCanvas.update). Going
 * back to Model restores the view exactly as it was.
 */
include("scripts/library.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Widgets/ViewportWidget/ViewportWidget.js");

function LayoutTabs() {
}

/** One entry per drawing window: { di, bar, plus, names, syncing, saved }. */
LayoutTabs.entries = [];

LayoutTabs.init = function(basePath) {
    if (!RSettings.getBoolValue("LayoutTabs/Enabled", true)) {
        return;
    }
    ViewportWidget.addMdiInitFunction(LayoutTabs.attach);

    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin)) {
        return;
    }
    var adapter = new RBlockListenerAdapter();
    appWin.addBlockListener(adapter);
    adapter.blocksUpdated.connect(function(di) { LayoutTabs.refreshAll(); });
    adapter.currentBlockSet.connect(function(di) { LayoutTabs.syncAll(); });
    adapter.blocksCleared.connect(function() { LayoutTabs.refreshAll(); });
    LayoutTabs.adapter = adapter;
};

/** Called for every new drawing window with its root widget. */
LayoutTabs.attach = function(root, di) {
    var layout = root.layout();
    if (isNull(layout)) {
        return;
    }

    var strip = new QWidget(root);
    strip.objectName = "LayoutTabStrip";
    var row = new QHBoxLayout();
    row.setContentsMargins(0, 0, 0, 0);
    row.setSpacing(2);

    var bar = new QTabBar(strip);
    bar.objectName = "LayoutTabBar";
    bar.shape = QTabBar.RoundedSouth;
    bar.expanding = false;
    bar.drawBase = false;
    bar.usesScrollButtons = true;
    bar.contextMenuPolicy = Qt.CustomContextMenu;
    row.addWidget(bar, 0, 0);

    var plus = new QToolButton(strip);
    plus.objectName = "LayoutTabAdd";
    plus.text = "+";
    plus.autoRaise = true;
    plus.toolTip = qsTr("New layout");
    row.addWidget(plus, 0, 0);
    row.addStretch(1);
    strip.setLayout(row);
    layout.addWidget(strip);

    var entry = { di: di, strip: strip, bar: bar, plus: plus, names: [], syncing: false, saved: {} };
    LayoutTabs.entries.push(entry);

    bar.currentChanged.connect(function(index) { LayoutTabs.tabPicked(entry, index); });
    bar.tabBarDoubleClicked.connect(function(index) { LayoutTabs.rename(entry, index); });
    bar.customContextMenuRequested.connect(function(pos) { LayoutTabs.contextMenu(entry, pos); });
    plus.clicked.connect(function() { LayoutTabs.addLayout(entry); });

    LayoutTabs.refresh(entry);
};

LayoutTabs.refreshAll = function() {
    for (var i = 0; i < LayoutTabs.entries.length; i++) {
        try {
            LayoutTabs.refresh(LayoutTabs.entries[i]);
        }
        catch (e) {
            // a closed window's strip: forget it
            LayoutTabs.entries.splice(i, 1);
            i--;
        }
    }
};

LayoutTabs.syncAll = function() {
    for (var i = 0; i < LayoutTabs.entries.length; i++) {
        try {
            LayoutTabs.sync(LayoutTabs.entries[i]);
        }
        catch (e) {
            LayoutTabs.entries.splice(i, 1);
            i--;
        }
    }
};

/** Rebuilds the tabs from the document. */
LayoutTabs.refresh = function(entry) {
    var doc = entry.di.getDocument();
    var layouts = Layouts.list(doc);
    var names = [Layouts.MODEL];
    for (var i = 0; i < layouts.length; i++) {
        names.push(layouts[i].name);
    }
    var bar = entry.bar;
    entry.syncing = true;
    while (bar.count > 0) {
        bar.removeTab(bar.count - 1);
    }
    for (var k = 0; k < names.length; k++) {
        var text = names[k] === Layouts.MODEL ? qsTr("Model") : names[k];
        bar.addTab(text);
        if (k > 0) {
            var info = layouts[k - 1];
            bar.setTabToolTip(k, (info.mode === "auto" ? qsTr("Automatic sheet") : qsTr("Manual sheet")) +
                (Layouts.paperNameOf(info.paperMM.w, info.paperMM.h) ? " - " + Layouts.paperNameOf(info.paperMM.w, info.paperMM.h) : ""));
        }
    }
    entry.names = names;
    entry.syncing = false;
    LayoutTabs.sync(entry);
};

/** Selects the tab of the block that is current in the document. */
LayoutTabs.sync = function(entry) {
    var doc = entry.di.getDocument();
    var cur = Layouts.current(doc);
    var wanted = isNull(cur) ? 0 : entry.names.indexOf(cur.name);
    if (wanted < 0) {
        wanted = 0;
    }
    entry.syncing = true;
    if (entry.bar.currentIndex !== wanted) {
        entry.bar.setCurrentIndex(wanted);
    }
    entry.syncing = false;
    LayoutCanvas.update(entry, cur);
};

LayoutTabs.tabPicked = function(entry, index) {
    if (entry.syncing || index < 0 || index >= entry.names.length) {
        return;
    }
    var doc = entry.di.getDocument();
    LayoutCanvas.remember(entry);
    Layouts.activate(entry.di, index === 0 ? null : entry.names[index]);
    LayoutTabs.sync(entry);
    LayoutCanvas.restoreOrFit(entry);
};

LayoutTabs.addLayout = function(entry) {
    var doc = entry.di.getDocument();
    var metric = (doc.getUnit() === RS.Millimeter || doc.getUnit() === RS.Centimeter || doc.getUnit() === RS.Meter);
    var info = Layouts.create(entry.di, { paper: metric ? "A3" : "Letter", landscape: true });
    if (isNull(info)) {
        return;
    }
    LayoutTabs.refresh(entry);
    LayoutCanvas.remember(entry);
    Layouts.activate(entry.di, info.name);
    LayoutTabs.sync(entry);
    LayoutCanvas.restoreOrFit(entry);
};

LayoutTabs.rename = function(entry, index) {
    if (index <= 0 || index >= entry.names.length) {
        return;
    }
    var old = entry.names[index];
    var appWin = RMainWindowQt.getMainWindow();
    var name = QInputDialog.getText(appWin, qsTr("Rename layout"), qsTr("Name:"), QLineEdit.Normal, old);
    if (isNull(name) || name === "" || name === old) {
        return;
    }
    if (isNull(Layouts.rename(entry.di, old, name))) {
        QMessageBox.warning(appWin, qsTr("Rename layout"),
            qsTr("That name cannot be used. Layout names must be unique and cannot be empty, \"Model\", or start with *."));
        return;
    }
    LayoutTabs.refresh(entry);
};

LayoutTabs.contextMenu = function(entry, pos) {
    var index = entry.bar.tabAt(pos);
    var menu = new QMenu(entry.bar);
    var self = this;
    var actNew = menu.addAction(qsTr("New layout"));
    var actRename, actDup, actDelete, actLeft, actRight;
    if (index > 0) {
        menu.addSeparator();
        actRename = menu.addAction(qsTr("Rename..."));
        actDup = menu.addAction(qsTr("Duplicate"));
        actLeft = menu.addAction(qsTr("Move left"));
        actRight = menu.addAction(qsTr("Move right"));
        menu.addSeparator();
        actDelete = menu.addAction(qsTr("Delete"));
    }
    var chosen = menu.exec(entry.bar.mapToGlobal(pos));
    if (isNull(chosen)) {
        return;
    }
    var name = index > 0 ? entry.names[index] : undefined;
    if (chosen.text === actNew.text) {
        LayoutTabs.addLayout(entry);
    }
    else if (index > 0 && chosen.text === actRename.text) {
        LayoutTabs.rename(entry, index);
    }
    else if (index > 0 && chosen.text === actDup.text) {
        Layouts.duplicate(entry.di, name);
        LayoutTabs.refresh(entry);
    }
    else if (index > 0 && chosen.text === actLeft.text) {
        Layouts.move(entry.di, name, index - 2);
        LayoutTabs.refresh(entry);
    }
    else if (index > 0 && chosen.text === actRight.text) {
        Layouts.move(entry.di, name, index);
        LayoutTabs.refresh(entry);
    }
    else if (index > 0 && chosen.text === actDelete.text) {
        var appWin = RMainWindowQt.getMainWindow();
        var answer = QMessageBox.question(appWin, qsTr("Delete layout"),
            qsTr("Delete layout \"%1\" and everything on it? You can undo this.").arg(name),
            QMessageBox.Yes | QMessageBox.No);
        if (answer === QMessageBox.Yes) {
            Layouts.remove(entry.di, name);
            LayoutTabs.refresh(entry);
        }
    }
};

// ---------------------------------------------------------------------------

/**
 * The paper: what the view shows behind a layout, and the view state kept
 * per tab so each tab returns to where it was left.
 */
var LayoutCanvas = {};

/**
 * The drawing window's own graphics view. NOT di.getLastKnownViewWithFocus():
 * that answers for whichever view last had focus, which can be a dock
 * panel's preview view (Sheet Setup's is one) -- found live 2026-10-05, the
 * paper was painted into the preview. The MDI child (found by walking up
 * from the tab strip) knows its own view, as Print Preview relies on.
 */
LayoutCanvas.view = function(entry) {
    var w = entry.strip;
    for (var i = 0; i < 12 && !isNull(w); i++) {
        if (typeof w.getLastKnownViewWithFocus === "function") {
            var v = w.getLastKnownViewWithFocus();
            return isNull(v) ? undefined : v;
        }
        w = w.parentWidget();
    }
    return undefined;
};

/** Remembers where the view looked in the block being left. */
LayoutCanvas.remember = function(entry) {
    var view = LayoutCanvas.view(entry);
    if (isNull(view)) {
        return;
    }
    var doc = entry.di.getDocument();
    entry.saved[doc.getCurrentBlockId()] = view.getBox();
};

/** Back where this tab was, or zoomed onto the sheet (layout) / the whole drawing (model). */
LayoutCanvas.restoreOrFit = function(entry) {
    var view = LayoutCanvas.view(entry);
    if (isNull(view)) {
        return;
    }
    var doc = entry.di.getDocument();
    var box = entry.saved[doc.getCurrentBlockId()];
    if (!isNull(box) && box.isValid()) {
        view.zoomTo(box, 0);
        return;
    }
    var cur = Layouts.current(doc);
    if (isNull(cur)) {
        view.autoZoom();
        return;
    }
    var s = Layouts.paperSize(doc, cur);
    view.zoomTo(new RBox(new RVector(0, 0), new RVector(s.w, s.h)), s.w * 0.06);
};

LayoutCanvas.update = function(entry, layoutInfo) {
    var di = entry.di;
    var view = LayoutCanvas.view(entry);
    if (isNull(view)) {
        return;
    }
    var doc = di.getDocument();
    view.clearBackground();
    view.setBackgroundTransform(1.0, new RVector(0, 0));

    if (isNull(layoutInfo)) {
        if (!isNull(entry.modelBackground)) {
            view.setBackgroundColor(entry.modelBackground);
            entry.modelBackground = undefined;
        }
        view.regenerate(true);
        view.repaintView();
        return;
    }

    // entering a layout: remember the model background once
    if (isNull(entry.modelBackground)) {
        entry.modelBackground = view.getBackgroundColor();
    }
    view.setBackgroundColor(new QColor(255, 255, 255));

    var dark = RSettings.hasDarkGuiBackground();
    var colSurround = dark ? "#3c3c3c" : "#8a8a8a";
    var colShadow = dark ? "#262626" : "#6b6b6b";
    var colBorder = dark ? "#000000" : "#4a4a4a";

    var size = Layouts.paperSize(doc, layoutInfo);
    var box = Layouts.printableBox(doc, layoutInfo);

    // The background paths are drawn in a coordinate system where the sheet
    // is 1000 units wide, then scaled back by the background transform: paths
    // whose coordinates are tiny (a feet drawing's sheet is 0.9 units wide)
    // are silently NOT drawn by the view (measured 2026-10-05, 0.9 wide: gone;
    // the same path at 916 wide under a 0.001 transform: drawn).
    var K = 1000.0 / size.w;
    view.setBackgroundTransform(1.0 / K, new RVector(0, 0));
    var shadow = 1000.0 * 0.012;

    function add(path) {
        view.addToBackground(RGraphicsSceneDrawable.createFromPainterPath(path));
    }

    var path = new RPainterPath();
    path.setPen(new QPen(Qt.NoPen));
    path.setBrush(new QBrush(new QColor(colSurround)));
    path.addRect(new QRectF(-1.0e7, -1.0e7, 2.0e7, 2.0e7));
    add(path);

    path = new RPainterPath();
    path.setPen(new QPen(Qt.NoPen));
    path.setBrush(new QBrush(new QColor(colShadow)));
    path.addRect(new QRectF(shadow, -shadow, size.w * K, size.h * K));
    add(path);

    path = new RPainterPath();
    path.setPen(new QPen(Qt.NoPen));
    path.setBrush(new QBrush(new QColor(255, 255, 255)));
    path.addRect(new QRectF(0, 0, size.w * K, size.h * K));
    add(path);

    path = new RPainterPath();
    path.setPen(new QPen(new QColor(colBorder)));
    path.setBrush(new QBrush(Qt.NoBrush));
    path.addRect(new QRectF(0, 0, size.w * K, size.h * K));
    add(path);

    // printable margin: thin dashed blue
    var pen = new QPen(new QColor(0x84, 0x84, 0xff));
    pen.setStyle(Qt.DashLine);
    path = new RPainterPath();
    path.setPen(pen);
    path.setBrush(new QBrush(Qt.NoBrush));
    path.addRect(new QRectF(box.x1 * K, box.y1 * K, (box.x2 - box.x1) * K, (box.y2 - box.y1) * K));
    add(path);

    view.regenerate(true);
    view.repaintView();
};
