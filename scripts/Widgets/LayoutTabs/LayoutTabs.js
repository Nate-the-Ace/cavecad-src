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
LayoutTabs.nextId = 1;

/** Fixed height of the tab strip, pixels: the same whatever it shows (see enterViewport). */
LayoutTabs.STRIP_HEIGHT = 34;

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

    // the viewport controls follow the selection and any change to a viewport
    var sel = new RSelectionListenerAdapter();
    appWin.addSelectionListener(sel);
    sel.selectionChanged.connect(function(di) { LayoutTabs.refreshControlsAll(); });
    LayoutTabs.selAdapter = sel;
    var tx = new RTransactionListenerAdapter();
    appWin.addTransactionListener(tx);
    tx.transactionUpdated.connect(function(document, transaction) { LayoutTabs.refreshControlsAll(); });
    LayoutTabs.txAdapter = tx;
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
    // the selected viewport's scale and lock (shown only when exactly one is selected)
    var vpLabel = new QLabel(strip);
    vpLabel.objectName = "LayoutViewportLabel";
    vpLabel.text = qsTr("Viewport:");
    vpLabel.visible = false;
    row.addWidget(vpLabel, 0, 0);
    var vpScale = new QComboBox(strip);
    vpScale.objectName = "LayoutViewportScale";
    vpScale.toolTip = qsTr("Scale of the selected viewport");
    vpScale.visible = false;
    vpScale.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    row.addWidget(vpScale, 0, 0);
    var vpLock = new QCheckBox(strip);
    vpLock.objectName = "LayoutViewportLock";
    vpLock.text = qsTr("Locked");
    vpLock.toolTip = qsTr("A locked viewport keeps its scale and what it shows");
    vpLock.visible = false;
    row.addWidget(vpLock, 0, 0);
    var vpLayers = new QPushButton(strip);
    vpLayers.objectName = "LayoutViewportLayers";
    vpLayers.text = qsTr("Layers...");
    vpLayers.toolTip = qsTr("Choose which layers this viewport hides");
    vpLayers.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    vpLayers.visible = false;
    row.addWidget(vpLayers, 0, 0);
    var newVp = new QPushButton(strip);
    newVp.objectName = "LayoutNewViewport";
    newVp.text = qsTr("New viewport");
    newVp.toolTip = qsTr("Draw a viewport on this layout: click two corners (Layout menu, command: viewport)");
    newVp.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    newVp.visible = false;
    row.addWidget(newVp, 0, 0);
    var polyVp = new QPushButton(strip);
    polyVp.objectName = "LayoutPolygonViewport";
    polyVp.text = qsTr("Polygon");
    polyVp.toolTip = qsTr("Draw a viewport as a polygon: click its corners, Enter or right-click to finish");
    polyVp.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    polyVp.visible = false;
    row.addWidget(polyVp, 0, 0);
    var trimVp = new QPushButton(strip);
    trimVp.objectName = "LayoutTrimViewport";
    trimVp.text = qsTr("Trim");
    trimVp.toolTip = qsTr("Cut a polygon out of the selected viewport: click its corners, Enter or right-click to finish");
    trimVp.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    trimVp.visible = false;
    row.addWidget(trimVp, 0, 0);
    var squareVp = new QPushButton(strip);
    squareVp.objectName = "LayoutSquareViewport";
    squareVp.text = qsTr("Rectangle");
    squareVp.toolTip = qsTr("Put the selected viewport back to a plain rectangle (its outline's bounding box)");
    squareVp.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    squareVp.visible = false;
    row.addWidget(squareVp, 0, 0);
    var vpBar = new QPushButton(strip);
    vpBar.objectName = "LayoutViewportBar";
    vpBar.text = qsTr("Scale bar");
    vpBar.toolTip = qsTr("Add a scale bar that follows this viewport's scale");
    vpBar.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    vpBar.visible = false;
    row.addWidget(vpBar, 0, 0);
    var banner = new QLabel(strip);
    banner.objectName = "LayoutEditBanner";
    banner.visible = false;
    row.addWidget(banner, 0, 0);
    var done = new QPushButton(strip);
    done.objectName = "LayoutEditDone";
    // never taller than the tab bar: showing the edit banner must not change
    // the height of the strip (a taller strip shrinks the view, and a view
    // that changes size re-fits the very zoom the sheet is shown at)
    done.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    banner.maximumHeight = LayoutTabs.STRIP_HEIGHT - 4;
    done.text = qsTr("Back to layout");
    done.toolTip = qsTr("Leave the viewport and return to the layout");
    done.visible = false;
    row.addWidget(done, 0, 0);
    strip.setLayout(row);
    strip.setFixedHeight(LayoutTabs.STRIP_HEIGHT);
    layout.addWidget(strip);
    var bannerAction = banner;

    var entry = { di: di, strip: strip, bar: bar, plus: plus, names: [], syncing: false, saved: {},
        id: LayoutTabs.nextId++, editing: undefined };
    strip.setProperty("ltId", entry.id);
    LayoutTabs.entries.push(entry);
    // A CLOSED WINDOW'S entry must go with it: its document is freed, and the
    // listeners below would ask that dead document for its current block --
    // a crash, not an exception, so no try/catch can save it.
    try {
        strip.destroyed.connect(function() { entry.dead = true; LayoutTabs.prune(); });
    }
    catch (eDestroyed) {
    }

    bar.currentChanged.connect(function(index) { LayoutTabs.tabPicked(entry, index); });
    bar.tabBarDoubleClicked.connect(function(index) { LayoutTabs.rename(entry, index); });
    bar.customContextMenuRequested.connect(function(pos) { LayoutTabs.contextMenu(entry, pos); });
    plus.clicked.connect(function() { LayoutTabs.addLayout(entry); });
    entry.banner = banner;
    entry.done = done;
    entry.vpLabel = vpLabel;
    entry.vpScale = vpScale;
    entry.vpLock = vpLock;
    entry.vpLayers = vpLayers;
    entry.vpBar = vpBar;
    entry.newVp = newVp;
    entry.polyVp = polyVp;
    entry.trimVp = trimVp;
    entry.squareVp = squareVp;
    polyVp.clicked.connect(function() { LayoutTabs.shapeTool(entry, "polygon"); });
    trimVp.clicked.connect(function() { LayoutTabs.shapeTool(entry, "trim"); });
    squareVp.clicked.connect(function() { LayoutTabs.shapeTool(entry, "square"); });
    newVp.clicked.connect(function() { LayoutTabs.newViewport(entry); });
    vpBar.clicked.connect(function() { LayoutTabs.addScaleBar(entry); });
    entry.vpShown = undefined;
    vpLayers.clicked.connect(function() { LayoutTabs.viewportLayers(entry); });
    vpScale["activated(int)"].connect(function(index) { LayoutTabs.scalePicked(entry, index); });
    vpLock.clicked.connect(function(checked) { LayoutTabs.lockClicked(entry, checked); });
    done.clicked.connect(function() { LayoutTabs.exitViewport(entry, true); });

    LayoutTabs.refresh(entry);
};

/** Forgets the entries of windows that have closed. */
LayoutTabs.prune = function() {
    for (var i = LayoutTabs.entries.length - 1; i >= 0; i--) {
        if (!LayoutTabs.live(LayoutTabs.entries[i])) {
            LayoutTabs.entries.splice(i, 1);
        }
    }
};

/** True while the entry's window (strip widget) still exists. */
LayoutTabs.live = function(entry) {
    if (entry.dead === true) {
        return false;
    }
    try {
        return !isNull(entry.strip) && !isNull(entry.strip.parentWidget()) &&
            !isNull(entry.strip.objectName);
    }
    catch (e) {
        return false;
    }
};

LayoutTabs.refreshAll = function() {
    LayoutTabs.prune();
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
    LayoutTabs.prune();
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
    entry.states = [];
    for (var k = 0; k < names.length; k++) {
        var info = k > 0 ? layouts[k - 1] : undefined;
        // AUTO sheets are generated and owned by Sheet Setup; a sheet edited by hand
        // (or made by hand) is MANUAL and marked with a star
        var state = isNull(info) ? undefined :
            ((typeof Layouts.stateOf === "function") ? Layouts.stateOf(doc, info) : info.mode);
        entry.states.push(state);   // index-aligned with the tabs (Model first)
        var text = k === 0 ? qsTr("Model") : (names[k] + (state === "auto" ? "" : " *"));
        bar.addTab(text);
        if (k > 0) {
            var paper = Layouts.paperNameOf(info.paperMM.w, info.paperMM.h);
            var what = state === "auto" ? qsTr("Automatic sheet: Sheet Setup rewrites it") :
                (state === "edited" ? qsTr("Edited by hand: Sheet Setup leaves it alone (right-click: Revert to automatic)") :
                 qsTr("Manual sheet: Sheet Setup leaves it alone"));
            bar.setTabToolTip(k, what + (paper ? " - " + paper : ""));
        }
    }

    entry.names = names;
    entry.syncing = false;
    LayoutTabs.sync(entry);
};

/** Selects the tab of the block that is current in the document. */
LayoutTabs.sync = function(entry) {
    if (!isNull(entry.editing)) {
        // editing through a viewport: the layout's tab stays selected while the model shows
        return;
    }
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
    entry.newVp.visible = !isNull(cur);
    entry.polyVp.visible = !isNull(cur);
    LayoutCanvas.update(entry, cur);
};

/** Polygon / trim / back-to-rectangle on the selected viewport. */
LayoutTabs.shapeTool = function(entry, what) {
    include("scripts/Layouts/ViewportShape/ViewportShape.js");
    if (what === "polygon") {
        ViewportShape.startPolygon(entry.di);
        return;
    }
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp)) {
        return;
    }
    if (what === "trim") {
        ViewportShape.startTrim(entry.di, vp.getId());
    }
    else if (what === "square") {
        var doc = entry.di.getDocument();
        if (Layouts.isLocked(vp)) {
            EAction.handleUserWarning(qsTr("This viewport is locked: unlock it to change its shape."));
            return;
        }
        Layouts.setClip(entry.di, vp, [], qsTr("Viewport back to a rectangle"));
        LayoutTabs.refreshControls(entry);
    }
};

/** Starts the New Viewport tool on this layout. */
LayoutTabs.newViewport = function(entry) {
    var action = RGuiAction.getByScriptFile("scripts/Layouts/NewViewport/NewViewport.js");
    if (isNull(action)) {
        EAction.handleUserWarning(qsTr("New Viewport is not available in this build."));
        return;
    }
    action.slotTrigger();
};

LayoutTabs.tabPicked = function(entry, index) {
    if (entry.syncing || index < 0 || index >= entry.names.length) {
        return;
    }
    if (!isNull(entry.editing)) {
        // picking a tab while editing through a viewport leaves the viewport first
        LayoutTabs.exitViewport(entry, true, index === 0 ? null : entry.names[index]);
        return;
    }
    var doc = entry.di.getDocument();
    LayoutCanvas.remember(entry);
    var target = index === 0 ? null : entry.names[index];
    // The empty default layout opens as the default sheet when the cave suite
    // can make one (it renames the layout, so the tabs are rebuilt).
    if (target === "Layout" && typeof Layouts.pristineOf === "function" &&
            typeof Layouts.starterOf === "function" && !isNull(Layouts.pristineOf(doc))) {
        var made = "";
        try {
            made = Layouts.starterOf(doc, entry.di);
        }
        catch (eStarter) {
            made = "";
        }
        if (made !== "") {
            LayoutTabs.refresh(entry);
            target = made;
        }
    }
    Layouts.activate(entry.di, target);
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
    var actRename, actDup, actDelete, actLeft, actRight, actRevert, actSetup;
    if (index > 0) {
        menu.addSeparator();
        if (typeof Layouts.canRevertOf === "function" && entry.states[index] !== "auto" &&
            Layouts.canRevertOf(entry.di.getDocument(), Layouts.get(entry.di.getDocument(), entry.names[index]))) {
            actRevert = menu.addAction(qsTr("Revert to automatic"));
        }
        actSetup = menu.addAction(qsTr("Page setup..."));
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
    else if (index > 0 && !isNull(actRevert) && chosen.text === actRevert.text) {
        var appWinR = RMainWindowQt.getMainWindow();
        var sure = QMessageBox.question(appWinR, qsTr("Revert to automatic"),
            qsTr("Throw away every change made by hand to sheet \"%1\" and generate it again? You can undo this.").arg(name),
            QMessageBox.Yes | QMessageBox.No);
        if (sure === QMessageBox.Yes) {
            Layouts.revertOf(entry.di.getDocument(), entry.di, name);
            LayoutTabs.refresh(entry);
        }
    }
    else if (index > 0 && chosen.text === actSetup.text) {
        LayoutTabs.pageSetup(entry, name);
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
    var b = view.getBox();
    var o = view.getOffset();
    // plain numbers: a wrapper object can stay tied to the view's own box.
    // The EXACT factor and offset are kept too: refitting a box re-derives
    // the zoom from the widget's size, which is not what "back where it was" means.
    entry.saved[doc.getCurrentBlockId()] = { x1: b.getMinimum().x, y1: b.getMinimum().y,
        x2: b.getMaximum().x, y2: b.getMaximum().y,
        factor: view.getFactor(), ox: o.x, oy: o.y, w: view.getWidth(), h: view.getHeight() };
};

/** Back where this tab was, or zoomed onto the sheet (layout) / the whole drawing (model). */
LayoutCanvas.restoreOrFit = function(entry) {
    var view = LayoutCanvas.view(entry);
    if (isNull(view)) {
        return;
    }
    var doc = entry.di.getDocument();
    var box = entry.saved[doc.getCurrentBlockId()];
    if (!isNull(box)) {
        if (box.w === view.getWidth() && box.h === view.getHeight()) {
            // same window: the very same zoom and place, bit for bit
            view.setFactor(box.factor);
            view.setOffset(new RVector(box.ox, box.oy));
            view.regenerate(true);
            view.repaintView();
        }
        else {
            view.zoomTo(new RBox(new RVector(box.x1, box.y1), new RVector(box.x2, box.y2)), 0);
        }
        return;
    }
    var cur = Layouts.current(doc);
    if (isNull(cur)) {
        view.autoZoom();
        return;
    }
    var s = Layouts.paperSize(doc, cur);
    // margin is in PIXELS (an int): a fraction of a feet-sized sheet would be 0
    view.zoomTo(new RBox(new RVector(0, 0), new RVector(s.w, s.h)), 40);
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
        if (entry.gridWasOn === true) {
            view.setGridVisible(true);
        }
        entry.gridWasOn = undefined;
        view.regenerate(true);
        view.repaintView();
        return;
    }

    // entering a layout: remember the model background once; the grid is a
    // model-space aid and has no place on a sheet of paper
    if (isNull(entry.modelBackground)) {
        entry.modelBackground = view.getBackgroundColor();
        entry.gridWasOn = view.isGridVisible();
    }
    view.setGridVisible(false);
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


// ---------------------------------------------------------------------------
// EDITING THROUGH A VIEWPORT ("click through")
//
// Double-click a viewport on a layout and the model shows exactly as the
// sheet shows it -- same scale, same place on screen, no jump -- and every
// tool, snap and selection works on the real model, because the document
// is simply in model space. The viewport's frame stays where it is on the
// screen (a dimmed surround says "this is the sheet's window"); panning or
// zooming slides the model under the frame, and "Back to layout" (or any
// tab) writes the new view centre and scale into the viewport -- unless it
// is LOCKED, in which case the contents are left exactly as they were.
//
// Why not carry the viewport transform through every tool's mouse, snap and
// preview code: the model view the user already trusts does all of that
// with no engine surgery, and the screen looks the same. A TWISTED viewport
// (the view cannot rotate) shows the model untwisted and is not written
// back.
// ---------------------------------------------------------------------------

LayoutTabs.OVERLAY_ID = 1500;

/** The tab strip entry of the drawing window the user is working in. */
LayoutTabs.entryOfActive = function() {
    var mc = RMainWindowQt.getMainWindow().getMdiChild();
    if (isNull(mc)) {
        return undefined;
    }
    var strip = mc.findChild("LayoutTabStrip");
    if (isNull(strip)) {
        return undefined;
    }
    var id = strip.property("ltId");
    for (var i = 0; i < LayoutTabs.entries.length; i++) {
        if (LayoutTabs.entries[i].id === id) {
            return LayoutTabs.entries[i];
        }
    }
    return undefined;
};

LayoutTabs.enterViewport = function(di, vpEntity) {
    var entry = LayoutTabs.entryOfActive();
    if (isNull(entry) || !isNull(entry.editing)) {
        return false;
    }
    var doc = entry.di.getDocument();
    var info = Layouts.current(doc);
    var view = LayoutCanvas.view(entry);
    if (isNull(info) || isNull(view) || vpEntity.isOverall() || vpEntity.isOff()) {
        return false;
    }
    // fresh copy: the double click handed us a snapshot
    var vp = doc.queryEntity(vpEntity.getId());
    if (isNull(vp)) {
        return false;
    }
    var twisted = Layouts.isTwisted(vp);
    var locked = Layouts.isLocked(vp);

    // The banner and the button go up FIRST and the window settles: whatever
    // they do to the layout happens before anything is measured.
    entry.banner.visible = true;
    entry.done.visible = true;
    QCoreApplication.processEvents();

    // where the viewport sits on the SCREEN, kept for the whole edit
    var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
    var s1 = view.mapToView(new RVector(c.x - hw, c.y + hh));
    var s2 = view.mapToView(new RVector(c.x + hw, c.y - hh));
    var layoutFactor = view.getFactor();
    var corner = Layouts.paperToModel(vp, c.x - hw, c.y + hh);

    // what the model must show for the frame to stay put: the whole visible paper, through the viewport
    var vis = view.getBox();
    var m1 = Layouts.paperToModel(vp, vis.getMinimum().x, vis.getMinimum().y);
    var m2 = Layouts.paperToModel(vp, vis.getMaximum().x, vis.getMaximum().y);
    var modelBox = new RBox(new RVector(Math.min(m1.x, m2.x), Math.min(m1.y, m2.y)),
                            new RVector(Math.max(m1.x, m2.x), Math.max(m1.y, m2.y)));

    LayoutCanvas.remember(entry);
    entry.editing = {
        viewportId: vp.getId(), layoutName: info.name, locked: locked, twisted: twisted,
        scale0: vp.getScale(), vc0: vp.getViewCenter(), width: vp.getWidth(), height: vp.getHeight(),
        screen1: s1, screen2: s2, changed: false
    };

    Layouts.activate(entry.di, null);
    LayoutCanvas.update(entry, undefined);
    // EXACT, not a refit: the model gets the sheet's own zoom times the
    // viewport scale, and is slid until the viewport's corner sits on the
    // very pixel it sat on. (Refitting a box re-derives the zoom from the
    // widget's aspect and drifted the frame by a couple of percent.)
    view.setFactor(layoutFactor * vp.getScale());
    for (var pass = 0; pass < 3; pass++) {
        var now = view.mapToView(corner);
        var o = view.getOffset();
        view.setOffset(new RVector(o.x + (s1.x - now.x) / view.getFactor(),
                                   o.y - (s1.y - now.y) / view.getFactor()));
    }
    view.regenerate(true);
    view.repaintView();
    LayoutTabs.drawFrame(entry, view);
    try {
        entry.editing.hook = function() { LayoutTabs.drawFrame(entry, LayoutCanvas.view(entry)); };
        view.viewportChanged.connect(entry.editing.hook);
    }
    catch (eHook) {
    }

    var msg = locked ? qsTr("Editing through a LOCKED viewport: you can edit the model, but the viewport keeps its scale and contents.") :
        (twisted ? qsTr("Twisted viewport: the model is shown untwisted and the viewport view is not changed.") :
         qsTr("Editing through the viewport. Pan and zoom to reposition its contents."));
    entry.banner.text = "  " + msg + "  ";
    // the layout's own tab stays selected
    var idx = entry.names.indexOf(info.name);
    if (idx >= 0) {
        entry.syncing = true;
        entry.bar.setCurrentIndex(idx);
        entry.syncing = false;
    }
    return true;
};

/** The frame (screen-fixed) and dimmed surround, in the model view's coordinates. */
LayoutTabs.drawFrame = function(entry, view) {
    var ed = entry.editing;
    if (isNull(ed) || isNull(view)) {
        return;
    }
    var a = view.mapFromView(ed.screen1), b = view.mapFromView(ed.screen2);
    ed.frame = new RBox(new RVector(Math.min(a.x, b.x), Math.min(a.y, b.y)),
                        new RVector(Math.max(a.x, b.x), Math.max(a.y, b.y)));
    var x1 = ed.frame.getMinimum().x, y1 = ed.frame.getMinimum().y;
    var x2 = ed.frame.getMaximum().x, y2 = ed.frame.getMaximum().y;
    var big = Math.max(x2 - x1, y2 - y1) * 200;
    view.clearOverlay(LayoutTabs.OVERLAY_ID);
    var dim = new RPainterPath();
    dim.setPen(new QPen(Qt.NoPen));
    dim.setBrush(new QBrush(new QColor(128, 128, 128, 90)));
    dim.addRect(new QRectF(x1 - big, y1 - big, 2 * big + (x2 - x1), 2 * big + (y2 - y1)));
    dim.addRect(new QRectF(x1, y1, x2 - x1, y2 - y1));
    view.addToOverlay(LayoutTabs.OVERLAY_ID, 1, RGraphicsSceneDrawable.createFromPainterPath(dim));
    var pen = new QPen(new QColor(0x18, 0x8c, 0xff));
    pen.setWidth(2);
    pen.setCosmetic(true);
    var frame = new RPainterPath();
    frame.setPen(pen);
    frame.setBrush(new QBrush(Qt.NoBrush));
    frame.addRect(new QRectF(x1, y1, x2 - x1, y2 - y1));
    view.addToOverlay(LayoutTabs.OVERLAY_ID, 2, RGraphicsSceneDrawable.createFromPainterPath(frame));
};

/**
 * Leaves the viewport: writes the new view into it (unless locked or
 * twisted) and shows the layout again -- or `thenLayout` (a name, null for
 * Model) when a tab was picked.
 */
LayoutTabs.exitViewport = function(entry, write, thenLayout) {
    var ed = entry.editing;
    if (isNull(ed)) {
        return;
    }
    var doc = entry.di.getDocument();
    var view = LayoutCanvas.view(entry);
    var note = "";
    // whatever happens below, the window must come out of edit mode
    try {
        if (!isNull(view)) {
            try {
                if (!isNull(ed.hook)) {
                    view.viewportChanged.disconnect(ed.hook);
                }
            }
            catch (eDis) {
            }
            view.clearOverlay(LayoutTabs.OVERLAY_ID);
        }
        // where the frame is NOW, in model space -- from the live view, not
        // from the last time the overlay happened to be redrawn
        if (!isNull(view)) {
            LayoutTabs.drawFrame(entry, view);
            view.clearOverlay(LayoutTabs.OVERLAY_ID);
        }
        var frame = ed.frame;
        var vp = doc.queryEntity(ed.viewportId);
        if (write === true && !isNull(frame) && !isNull(vp) && !ed.locked && !ed.twisted) {
            var w = frame.getMaximum().x - frame.getMinimum().x;
            var cx = (frame.getMinimum().x + frame.getMaximum().x) / 2;
            var cy = (frame.getMinimum().y + frame.getMaximum().y) / 2;
            var t = vp.getViewTarget();
            var newScale = (w > 1e-12) ? ed.width / w : ed.scale0;
            // a pure pan leaves the scale exactly as it was
            if (Math.abs(newScale / ed.scale0 - 1) < 1e-7) {
                newScale = ed.scale0;
            }
            var newCenter = new RVector(cx - t.x, cy - t.y);
            var moved = Math.abs(newScale - ed.scale0) > 0 ||
                newCenter.getDistanceTo(ed.vc0) > 1e-9 * (1 + Math.abs(cx) + Math.abs(cy));
            if (moved) {
                vp.setScale(newScale);
                vp.setViewCenter(newCenter);
                var op = new RModifyObjectOperation(vp);
                op.setText(qsTr("Reposition viewport contents"));
                entry.di.applyOperation(op);
                note = qsTr("Viewport contents repositioned.");
            }
        }
        else if (write === true && ed.locked) {
            note = qsTr("The viewport is locked: its contents were left as they were.");
        }
    }
    catch (eExit) {
        qWarning("LayoutTabs.exitViewport: " + eExit);
    }
    // undefined: back to the same layout; null: Model; a name: that layout
    var layoutName = (thenLayout === undefined) ? ed.layoutName : thenLayout;
    entry.editing = undefined;
    entry.banner.visible = false;
    entry.done.visible = false;
    Layouts.activate(entry.di, layoutName);
    LayoutTabs.sync(entry);
    LayoutCanvas.restoreOrFit(entry);
    if (note.length > 0) {
        try {
            RMainWindowQt.getMainWindow().handleUserMessage(note);
        }
        catch (eMsg) {
        }
    }
};

/** Double click on empty ground OUTSIDE the viewport being edited: back to the layout. */
LayoutTabs.emptyDoubleClick = function(di, event) {
    var entry = LayoutTabs.entryOfActive();
    if (isNull(entry) || isNull(entry.editing) || isNull(entry.editing.frame)) {
        return;
    }
    var p = event.getModelPosition();
    var f = entry.editing.frame;
    if (p.x < f.getMinimum().x || p.x > f.getMaximum().x || p.y < f.getMinimum().y || p.y > f.getMaximum().y) {
        LayoutTabs.exitViewport(entry, true);
    }
};


// ---------------------------------------------------------------------------
// The selected viewport's scale and lock, in the tab strip.
// ---------------------------------------------------------------------------

/** The viewport to show controls for: the one selected, or the one being edited through. */
LayoutTabs.controlViewport = function(entry) {
    var doc = entry.di.getDocument();
    var info = Layouts.current(doc);
    if (isNull(info)) {
        if (!isNull(entry.editing)) {
            var edited = doc.queryEntity(entry.editing.viewportId);
            return isNull(edited) || edited.isUndone() ? undefined : edited;
        }
        return undefined;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        return undefined;
    }
    var e = doc.queryEntity(ids[0]);
    if (isNull(e) || e.getType() !== RS.EntityViewport || e.isOverall() || e.getBlockId() !== info.blockId) {
        return undefined;
    }
    return e;
};

LayoutTabs.refreshControlsAll = function() {
    LayoutTabs.prune();
    LayoutTabs.drawGlyphAll();
    for (var i = 0; i < LayoutTabs.entries.length; i++) {
        try {
            LayoutTabs.refreshControls(LayoutTabs.entries[i]);
        }
        catch (e) {
            // a closed window's strip
        }
    }
};

LayoutTabs.refreshControls = function(entry) {
    try {
        LayoutTabs.drawGlyph(entry);
    }
    catch (eGlyph) {
    }
    try {
        var sel = LayoutTabs.controlViewport(entry);
        entry.trimVp.visible = !isNull(sel) && isNull(entry.editing);
        entry.squareVp.visible = !isNull(sel) && isNull(entry.editing) && Layouts.hasClip(sel);
    }
    catch (eShape) {
    }
    var vp = LayoutTabs.controlViewport(entry);
    var show = !isNull(vp);
    entry.vpLabel.visible = show;
    entry.vpScale.visible = show;
    entry.vpLock.visible = show;
    entry.vpLayers.visible = show;
    // offered only where the cave suite is loaded and the viewport has no bar yet
    entry.vpBar.visible = show && typeof Layouts.addScaleBarFor === "function" &&
        !Layouts.hasScaleBarOf(entry.di.getDocument(), vp);
    if (!show) {
        return;
    }
    var doc = entry.di.getDocument();
    var locked = Layouts.isLocked(vp);
    var fpi = Layouts.feetPerInch(doc, vp);
    var scales = Layouts.scales();
    var combo = entry.vpScale;
    combo.blockSignals(true);
    combo.clear();
    var current = -1;
    for (var i = 0; i < scales.length; i++) {
        combo.addItem(scales[i].label + (scales[i].custom ? "  (mine)" : ""));
        if (Layouts.sameScale(scales[i].feetPerInch, fpi)) {
            current = i;
        }
    }
    entry.vpScales = scales;
    // not on the list (a zoom, or a typed value): shown first, as it is
    if (current < 0) {
        combo.insertItem(0, Layouts.scaleLabel(fpi) + "  (current)");
        entry.vpScaleOffset = 1;
        current = 0;
    }
    else {
        entry.vpScaleOffset = 0;
    }
    combo.addItem(qsTr("Add a scale..."));
    combo.addItem(qsTr("Remove one of my scales..."));
    combo.setCurrentIndex(current);
    combo.enabled = !locked;
    combo.blockSignals(false);
    entry.vpLock.blockSignals(true);
    entry.vpLock.checked = locked;
    entry.vpLock.blockSignals(false);
    entry.vpShown = vp.getId();
};

LayoutTabs.scalePicked = function(entry, index) {
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp) || isNull(entry.vpScales)) {
        return;
    }
    var offset = entry.vpScaleOffset;
    var n = entry.vpScales.length;
    var appWin = RMainWindowQt.getMainWindow();
    if (index === n + offset) {
        // add a scale
        var fpi = Layouts.feetPerInch(entry.di.getDocument(), vp);
        var ft = QInputDialog.getDouble(appWin, qsTr("Add a scale"),
            qsTr("Feet of cave per inch of paper (for 1:N, N divided by 12):"), fpi, 0.01, 100000, 3);
        if (isNull(ft) || !(ft > 0)) {
            LayoutTabs.refreshControls(entry);
            return;
        }
        Layouts.addCustomScale(ft);
        Layouts.setViewportScale(entry.di, vp, ft);
        LayoutTabs.refreshControls(entry);
        return;
    }
    if (index === n + offset + 1) {
        // remove one of mine
        var mine = Layouts.customScales();
        if (mine.length === 0) {
            QMessageBox.information(appWin, qsTr("Scales"), qsTr("You have not added any scales of your own."));
            LayoutTabs.refreshControls(entry);
            return;
        }
        var labels = [];
        for (var m = 0; m < mine.length; m++) {
            labels.push(Layouts.scaleLabel(mine[m]));
        }
        var chosen = QInputDialog.getItem(appWin, qsTr("Remove a scale"), qsTr("Scale to remove:"), labels, 0, false);
        if (!isNull(chosen) && String(chosen) !== "") {
            var at = labels.indexOf(String(chosen));
            if (at >= 0) {
                Layouts.removeCustomScale(mine[at]);
            }
        }
        LayoutTabs.refreshControls(entry);
        return;
    }
    var pick = index - offset;
    if (pick < 0 || pick >= n) {
        LayoutTabs.refreshControls(entry);
        return;
    }
    if (!Layouts.setViewportScale(entry.di, vp, entry.vpScales[pick].feetPerInch)) {
        RMainWindowQt.getMainWindow().handleUserMessage(qsTr("The viewport is locked: unlock it to change its scale."));
    }
    LayoutTabs.refreshControls(entry);
};

LayoutTabs.lockClicked = function(entry, checked) {
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp)) {
        return;
    }
    Layouts.setLocked(entry.di, vp, checked === true);
    LayoutTabs.refreshControls(entry);
};


// ---------------------------------------------------------------------------
// Page setup: paper, orientation and margin of one layout.
// ---------------------------------------------------------------------------

LayoutTabs.pageSetup = function(entry, name) {
    var doc = entry.di.getDocument();
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return;
    }
    var appWin = RMainWindowQt.getMainWindow();
    var dialog = new QDialog(appWin);
    dialog.windowTitle = qsTr("Page setup - %1").arg(name);
    var form = new QVBoxLayout();
    function row(label, widget) {
        var r = new QHBoxLayout();
        r.addWidget(new QLabel(label, dialog), 0, 0);
        r.addWidget(widget, 1, 0);
        form.addLayout(r);
    }
    var paper = new QComboBox(dialog);
    var current = Layouts.paperNameOf(info.paperMM.w, info.paperMM.h);
    var at = 0;
    for (var i = 0; i < Layouts.PAPERS.length; i++) {
        paper.addItem(Layouts.PAPERS[i].name);
        if (Layouts.PAPERS[i].name === current) {
            at = i;
        }
    }
    var custom = (current === "");
    if (custom) {
        paper.insertItem(0, Math.round(info.paperMM.w) + " x " + Math.round(info.paperMM.h) + " mm (current)");
        at = 0;
    }
    paper.setCurrentIndex(at);
    row(qsTr("Paper:"), paper);
    var landscape = new QCheckBox(dialog);
    landscape.text = qsTr("Landscape");
    landscape.checked = info.paperMM.w >= info.paperMM.h;
    row("", landscape);
    var margin = new QDoubleSpinBox(dialog);
    margin.setRange(0, 5);
    margin.setDecimals(2);
    margin.setSingleStep(0.05);
    margin.suffix = qsTr(" in");
    margin.value = info.marginsMM.l / 25.4;
    row(qsTr("Margin:"), margin);
    var buttons = new QDialogButtonBox(dialog);
    buttons.standardButtons = QDialogButtonBox.Ok | QDialogButtonBox.Cancel;
    buttons.accepted.connect(function() { dialog.accept(); });
    buttons.rejected.connect(function() { dialog.reject(); });
    var box = new QVBoxLayout();
    box.addLayout(form);
    box.addWidget(buttons, 0, 0);
    dialog.setLayout(box);
    var ok = dialog.exec();
    var changes = {};
    if (ok) {
        var idx = paper.currentIndex;
        if (!(custom && idx === 0)) {
            changes.paper = Layouts.PAPERS[custom ? idx - 1 : idx].name;
        }
        changes.landscape = landscape.checked;
        changes.margins = margin.value * 25.4;
    }
    destrDialog(dialog);
    if (!ok) {
        return;
    }
    Layouts.pageSetup(entry.di, name, changes);
    LayoutTabs.refresh(entry);
    LayoutCanvas.restoreOrFit(entry);
};


// ---------------------------------------------------------------------------
// Layers hidden in one viewport
// ---------------------------------------------------------------------------

/** Opens the "layers hidden in this viewport" dialog for the selected viewport. */
LayoutTabs.viewportLayers = function(entry) {
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp)) {
        return;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (Layouts.isLocked(vp)) {
        appWin.handleUserMessage(qsTr("The viewport is locked: unlock it to change which layers it hides."));
        return;
    }
    var doc = entry.di.getDocument();
    var names = [];
    var all = doc.getLayerNames();
    for (var i = 0; i < all.length; i++) {
        names.push(String(all[i]));
    }
    names.sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : (a.toLowerCase() > b.toLowerCase() ? 1 : 0); });
    var frozen = {};
    var ids = vp.getFrozenLayerIds();
    for (var f = 0; f < ids.length; f++) {
        frozen[String(doc.getLayerName(ids[f]))] = true;
    }

    var dialog = new QDialog(appWin);
    dialog.windowTitle = qsTr("Layers hidden in this viewport");
    var table = new QTableWidget(names.length, 1, dialog);
    table.setHorizontalHeaderLabels([qsTr("Hidden in this viewport")]);
    table.horizontalHeader().stretchLastSection = true;
    table.minimumWidth = 360;
    table.minimumHeight = 420;
    for (var r = 0; r < names.length; r++) {
        var item = new QTableWidgetItem(names[r]);
        item.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled);
        item.setCheckState(frozen[names[r]] === true ? Qt.Checked : Qt.Unchecked);
        table.setItem(r, 0, item);
    }
    var buttons = new QDialogButtonBox(dialog);
    buttons.standardButtons = QDialogButtonBox.Ok | QDialogButtonBox.Cancel;
    buttons.accepted.connect(function() { dialog.accept(); });
    buttons.rejected.connect(function() { dialog.reject(); });
    var box = new QVBoxLayout();
    box.addWidget(new QLabel(qsTr("Checked layers are hidden in this viewport only; everywhere else they show as usual."), dialog), 0, 0);
    box.addWidget(table, 1, 0);
    box.addWidget(buttons, 0, 0);
    dialog.setLayout(box);
    var ok = dialog.exec();
    var chosen = [];
    if (ok) {
        for (var k = 0; k < names.length; k++) {
            if (table.item(k, 0).checkState() === Qt.Checked) {
                chosen.push(doc.getLayerId(names[k]));
            }
        }
    }
    destrDialog(dialog);
    if (!ok) {
        return;
    }
    LayoutTabs.setFrozen(entry, vp, chosen);
};

/** Hides exactly these layer ids in the viewport (undoable). */
LayoutTabs.setFrozen = function(entry, vp, layerIds) {
    var fresh = entry.di.getDocument().queryEntity(vp.getId());
    fresh.setFrozenLayerIds(layerIds);
    var op = new RModifyObjectOperation(fresh);
    op.setText(qsTr("Viewport layers"));
    entry.di.applyOperation(op);
    LayoutTabs.refreshControls(entry);
};


/** Adds a linked scale bar to the selected viewport. */
LayoutTabs.addScaleBar = function(entry) {
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp) || typeof Layouts.addScaleBarFor !== "function") {
        return;
    }
    Layouts.addScaleBarFor(entry.di.getDocument(), entry.di, vp);
    LayoutTabs.refreshControls(entry);
};


// ---------------------------------------------------------------------------
// The rotation glyph: a horizontal diamond above a selected viewport.
// Click it to turn the viewport's contents (see Layouts/RotateViewport).
// Drawn as a screen-fixed overlay, like the editing frame.
// ---------------------------------------------------------------------------

LayoutTabs.GLYPH_ID = 1501;
LayoutTabs.GLYPH_HALF_W = 13;
LayoutTabs.GLYPH_HALF_H = 7;
LayoutTabs.GLYPH_GAP = 18;

/** The one viewport the glyph belongs to: selected, on the layout showing, not being edited through. */
LayoutTabs.glyphViewport = function(entry) {
    if (!isNull(entry.editing)) {
        return undefined;
    }
    var vp = LayoutTabs.controlViewport(entry);
    if (isNull(vp) || vp.isOverall() || Layouts.isLocked(vp)) {
        return undefined;
    }
    return vp;
};

/** Screen position (view pixels) of the glyph's centre for a viewport. */
LayoutTabs.glyphScreen = function(view, vp) {
    var c = vp.getCenter();
    var top = view.mapToView(new RVector(c.x, c.y + vp.getHeight() / 2));
    return { x: top.x, y: top.y - LayoutTabs.GLYPH_GAP };
};

/**
 * The rotation grip: a horizontal diamond above the selected viewport,
 * registered with the CustomGrips library (which owns the widget, its place
 * and its clicks).
 */
LayoutTabs.registerGrips = function() {
    include("scripts/Widgets/CustomGrips/CustomGrips.js");
    CustomGrips.register({
        id: "viewport-rotate",
        shape: "diamond",
        size: [2 * LayoutTabs.GLYPH_HALF_W + 2, 2 * LayoutTabs.GLYPH_HALF_H + 2],
        tooltip: qsTr("Rotate the viewport's contents: move the mouse round, or type an angle"),
        target: function(entry) { return LayoutTabs.glyphViewport(entry); },
        anchor: function(view, vp) { return LayoutTabs.glyphScreen(view, vp); },
        onClick: function(entry, vp) { LayoutTabs.glyphClicked(entry); }
    });
};

LayoutTabs.drawGlyph = function(entry) {
    if (isNull(entry.view)) {
        entry.view = function() { return LayoutCanvas.view(entry); };
    }
    if (isNull(CustomGrips.grips["viewport-rotate"])) {
        LayoutTabs.registerGrips();
    }
    CustomGrips.refresh(entry);
};

LayoutTabs.drawGlyphAll = function() {
    for (var i = 0; i < LayoutTabs.entries.length; i++) {
        try {
            if (LayoutTabs.live(LayoutTabs.entries[i])) {
                LayoutTabs.drawGlyph(LayoutTabs.entries[i]);
            }
        }
        catch (e) {
        }
    }
};

/** The glyph was clicked: start the rotation tool on the selected viewport. */
LayoutTabs.glyphClicked = function(entry) {
    var vp = LayoutTabs.glyphViewport(entry);
    if (isNull(vp)) {
        return;
    }
    include("scripts/Layouts/RotateViewport/RotateViewport.js");
    RotateViewport.start(entry.di, vp.getId());
};
