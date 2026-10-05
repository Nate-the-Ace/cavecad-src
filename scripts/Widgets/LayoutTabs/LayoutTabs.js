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
    var banner = new QLabel(strip);
    banner.objectName = "LayoutEditBanner";
    banner.visible = false;
    row.addWidget(banner, 0, 0);
    var done = new QPushButton(strip);
    done.objectName = "LayoutEditDone";
    done.text = qsTr("Back to layout");
    done.toolTip = qsTr("Leave the viewport and return to the layout");
    done.visible = false;
    row.addWidget(done, 0, 0);
    strip.setLayout(row);
    layout.addWidget(strip);
    var bannerAction = banner;

    var entry = { di: di, strip: strip, bar: bar, plus: plus, names: [], syncing: false, saved: {},
        id: LayoutTabs.nextId++, editing: undefined };
    strip.setProperty("ltId", entry.id);
    LayoutTabs.entries.push(entry);

    bar.currentChanged.connect(function(index) { LayoutTabs.tabPicked(entry, index); });
    bar.tabBarDoubleClicked.connect(function(index) { LayoutTabs.rename(entry, index); });
    bar.customContextMenuRequested.connect(function(pos) { LayoutTabs.contextMenu(entry, pos); });
    plus.clicked.connect(function() { LayoutTabs.addLayout(entry); });
    entry.banner = banner;
    entry.done = done;
    done.clicked.connect(function() { LayoutTabs.exitViewport(entry, true); });

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
    LayoutCanvas.update(entry, cur);
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
    var b = view.getBox();
    // plain numbers: a wrapper object can stay tied to the view's own box
    entry.saved[doc.getCurrentBlockId()] = { x1: b.getMinimum().x, y1: b.getMinimum().y,
        x2: b.getMaximum().x, y2: b.getMaximum().y };
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
        view.zoomTo(new RBox(new RVector(box.x1, box.y1), new RVector(box.x2, box.y2)), 0);
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

    // where the viewport sits on the SCREEN, kept for the whole edit
    var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
    var s1 = view.mapToView(new RVector(c.x - hw, c.y + hh));
    var s2 = view.mapToView(new RVector(c.x + hw, c.y - hh));

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
    view.zoomTo(modelBox, 0);
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
    entry.banner.visible = true;
    entry.done.visible = true;
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
        // where the frame is NOW, in model space
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
