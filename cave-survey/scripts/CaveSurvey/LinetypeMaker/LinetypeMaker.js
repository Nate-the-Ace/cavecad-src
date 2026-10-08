// LinetypeMaker.js -- Linetype Maker: make, edit and import linetypes.
//
// A docked panel over Core/CsLinetype (the pattern as data) and
// Core/CsLinetypeStore (the caver's .lin library and the open drawing).
// Built in init() and left hidden, like every dock in the suite: the
// main window's restoreState() runs after add-on init and can only place
// a dock that already exists. The menu action is setForceGlobal so it
// runs in the application engine where init built the dock.
//
// WHAT A ROW IS. One row per dash (positive length), gap (negative) or
// dot (0), repeating. A row with text draws that text at the END of the
// row -- where the engine puts it -- so "a gap with W on it" is one row,
// not two. The Kind column is derived and never typed.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

var csLinetypeMakerDock;

function LinetypeMaker(guiAction) {
    EAction.call(this, guiAction);
}

LinetypeMaker.prototype = new EAction();

/** Table columns, in order. Kind is derived, never typed. */
// No X / Y columns: where the text sits is the Anchor's job (Nathan,
// 2026-09-28). The raw offsets still live on the model -- an imported
// linetype whose placement matches no anchor keeps it, shown as Custom.
LinetypeMaker.COLUMNS = ["Kind", "Length", "Text", "Font", "Size", "Anchor", "Rot\u00b0"];
LinetypeMaker.COL = { KIND: 0, LENGTH: 1, TEXT: 2, FONT: 3, SIZE: 4, ANCHOR: 5,
                      ROT: 6 };

/** The words each font's dropdown entry is drawn with. No spaces: the
 *  engine's linetype text cannot hold one. */
LinetypeMaker.FONT_SAMPLE = "AaBbWw123";
LinetypeMaker.FONT_ICON_W = 120;
LinetypeMaker.FONT_ICON_H = 20;

/** Drawn font samples, built once per session: {lowercase name: QIcon}. */
LinetypeMaker.fontIcons = null;

/** New text rows: small enough to sit in a gap of a typical pattern. */
LinetypeMaker.TEXT_SIZE = 0.1;

LinetypeMaker.PREVIEW_W = 280;
LinetypeMaker.PREVIEW_H = 56;

/** Widgets and the model being edited. One panel per window. */
LinetypeMaker.w = undefined;

LinetypeMaker.blank = function() {
    return { name: "", description: "", category: "", segments: [CsLinetype.segment(0.5),
                                                   CsLinetype.segment(-0.25)] };
};

LinetypeMaker.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Linetype Maker"), appWin);
    // Without an objectName restoreState() cannot identify the dock.
    dock.objectName = "CaveSurveyLinetypeMakerDock";
    var w = { model: LinetypeMaker.blank(), entries: [], filling: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(4, 4, 4, 4);
    layout.setSpacing(4);

    var pickRow = new QHBoxLayout();
    w.picker = new QComboBox();
    w.picker.toolTip = qsTr("Your library, then the linetypes already in this drawing.");
    pickRow.addWidget(w.picker, 1, 0);
    w.newButton = new QPushButton(qsTr("New"));
    pickRow.addWidget(w.newButton, 0, 0);
    w.deleteButton = new QPushButton(qsTr("Delete"));
    w.deleteButton.toolTip = qsTr("Remove it from your library. Drawings keep their own copy.");
    pickRow.addWidget(w.deleteButton, 0, 0);
    layout.addLayout(pickRow, 0);

    var form = new QGridLayout();
    form.addWidget(new QLabel(qsTr("Name")), 0, 0);
    w.name = new QLineEdit();
    w.name.toolTip = qsTr("Letters, digits, _ - and $ -- no spaces.");
    form.addWidget(w.name, 0, 1);
    form.addWidget(new QLabel(qsTr("Description")), 1, 0);
    w.description = new QLineEdit();
    form.addWidget(w.description, 1, 1);
    form.addWidget(new QLabel(qsTr("Category")), 2, 0);
    // Editable: pick one you already use, or type a new one.
    w.category = new QComboBox();
    w.category.editable = true;
    w.category.toolTip = qsTr("How the Draw panel's Custom Linetypes section groups it. " +
        "Pick one you already use or type a new one.");
    form.addWidget(w.category, 2, 1);
    layout.addLayout(form, 0);

    w.table = new QTableWidget(0, LinetypeMaker.COLUMNS.length);
    w.table.setHorizontalHeaderLabels(LinetypeMaker.COLUMNS);
    w.table.toolTip = qsTr("One row per dash (positive length), gap (negative) " +
        "or dot (0). A text row draws its text in that row, placed by its Anchor.");
    // Whole rows, several at once: Shift/Cmd-click the row numbers, then a
    // change to one selected row is made to all of them.
    try {
        w.table.selectionBehavior = QAbstractItemView.SelectRows;
        w.table.selectionMode = QAbstractItemView.ExtendedSelection;
    } catch (eSel) {
    }
    try {
        w.table.setMinimumHeight(150);
    } catch (eH) {
    }
    layout.addWidget(w.table, 1, 0);

    var rowButtons = new QHBoxLayout();
    w.addDash = new QPushButton(qsTr("+ Dash"));
    w.addGap = new QPushButton(qsTr("+ Gap"));
    w.addText = new QPushButton(qsTr("+ Text"));
    w.removeRow = new QPushButton(qsTr("Remove"));
    w.upRow = new QPushButton("\u2191");
    w.downRow = new QPushButton("\u2193");
    var rb = [w.addDash, w.addGap, w.addText, w.removeRow, w.upRow, w.downRow];
    for (var i = 0; i < rb.length; i++) {
        rowButtons.addWidget(rb[i], 0, 0);
    }
    layout.addLayout(rowButtons, 0);
    var hint = new QLabel(qsTr("Shift- or Cmd-click row numbers to pick several rows: " +
        "a change to one changes them all, and Remove / Up / Down take them all."));
    hint.wordWrap = true;
    layout.addWidget(hint, 0, 0);

    w.preview = new QLabel("");
    try {
        w.preview.setMinimumHeight(LinetypeMaker.PREVIEW_H);
    } catch (eP) {
    }
    layout.addWidget(w.preview, 0, 0);
    w.problems = new QLabel("");
    w.problems.wordWrap = true;
    layout.addWidget(w.problems, 0, 0);

    var foot = new QHBoxLayout();
    w.saveButton = new QPushButton(qsTr("Save to Library"));
    w.saveButton.toolTip = qsTr("Keep it in your library beside your caves. " +
        "Every new cave map gets the whole library.");
    w.applyButton = new QPushButton(qsTr("Apply to Drawing"));
    w.applyButton.toolTip = qsTr("Add it to the open drawing (or update it there).");
    w.testButton = new QPushButton(qsTr("Test"));
    w.testButton.toolTip = qsTr("Put it in the drawing and start the Line tool with it, " +
        "so you can draw it straight away. Your previous linetype comes back when " +
        "the Line tool ends.");
    w.importButton = new QPushButton(qsTr("Import\u2026"));
    w.importButton.toolTip = qsTr("Read linetypes from an AutoCAD .lin file or another drawing.");
    foot.addWidget(w.saveButton, 0, 0);
    foot.addWidget(w.applyButton, 0, 0);
    foot.addWidget(w.testButton, 0, 0);
    foot.addWidget(w.importButton, 0, 0);
    layout.addLayout(foot, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    LinetypeMaker.w = w;

    function on(signal, fn) {
        try {
            signal.connect(fn);
        } catch (eConnect) {
            // a bridge refusal costs one control, not the whole panel
        }
    }
    on(w.picker.activated, function(index) { LinetypeMaker.pick(index); });
    on(w.newButton.clicked, function() { LinetypeMaker.load(LinetypeMaker.blank()); });
    on(w.deleteButton.clicked, function() { LinetypeMaker.remove(); });
    on(w.name.textEdited, function() { LinetypeMaker.readNames(); });
    on(w.description.textEdited, function() { LinetypeMaker.readNames(); });
    on(w.category.editTextChanged, function() { LinetypeMaker.readNames(); });
    on(w.table.cellChanged, function(row, col) { LinetypeMaker.cellEdited(row, col); });
    on(w.addDash.clicked, function() { LinetypeMaker.addRow(0.5, false); });
    on(w.addGap.clicked, function() { LinetypeMaker.addRow(-0.25, false); });
    on(w.addText.clicked, function() { LinetypeMaker.addRow(-0.5, true); });
    on(w.removeRow.clicked, function() { LinetypeMaker.removeRows(); });
    on(w.upRow.clicked, function() { LinetypeMaker.moveRows(-1); });
    on(w.downRow.clicked, function() { LinetypeMaker.moveRows(1); });
    on(w.saveButton.clicked, function() { LinetypeMaker.save(); });
    on(w.applyButton.clicked, function() { LinetypeMaker.applyToDrawing(); });
    on(w.importButton.clicked, function() { LinetypeMaker.importFile(); });
    on(w.testButton.clicked, function() { LinetypeMaker.testLine(); });
    on(dock.visibilityChanged, function(shown) {
        if (shown) {
            LinetypeMaker.refresh();
        }
    });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "LinetypeMaker", qsTr("Linetype Maker"));
    LinetypeMaker.load(w.model);
    return dock;
};

LinetypeMaker.ensureDock = function() {
    if (isNull(csLinetypeMakerDock)) {
        csLinetypeMakerDock = LinetypeMaker.buildDock(RMainWindowQt.getMainWindow());
    }
    return csLinetypeMakerDock;
};

/** The open drawing, or null -- never a null-wrapped document. */
LinetypeMaker.document = function() {
    var doc = EAction.getDocument();
    if (isNull(doc) || typeof doc.getLinetypeNames !== "function") {
        return null;
    }
    try {
        doc.getLinetypeNames();
    } catch (eDoc) {
        return null;
    }
    return doc;
};

/** Rebuilds the picker: library first, then the open drawing's own. */
LinetypeMaker.refresh = function() {
    var w = LinetypeMaker.w;
    w.entries = [];
    var lib = CsLinetypeStore.loadCustom();
    for (var i = 0; i < lib.linetypes.length; i++) {
        w.entries.push({ source: "library", model: lib.linetypes[i] });
    }
    var doc = LinetypeMaker.document();
    if (doc !== null) {
        var drawn = CsLinetypeStore.fromDocument(doc);
        for (var d = 0; d < drawn.length; d++) {
            if (CsLinetypeStore.indexOf(lib.linetypes, drawn[d].name) < 0) {
                w.entries.push({ source: "drawing", model: drawn[d] });
            }
        }
    }
    LinetypeMaker.rebuildTiles(lib.linetypes);
    w.picker.clear();
    w.picker.addItem(qsTr("\u2014 choose a linetype \u2014"));
    for (var k = 0; k < w.entries.length; k++) {
        var e = w.entries[k];
        w.picker.addItem((e.source === "library" ? qsTr("Library: ") :
            qsTr("Drawing: ")) + e.model.name);
    }
    LinetypeMaker.render();
    if (lib.errors.length > 0) {
        w.problems.text = qsTr("Some library lines could not be read: ") +
            lib.errors.join("; ");
    }
};

LinetypeMaker.pick = function(index) {
    var w = LinetypeMaker.w;
    if (index < 1 || index > w.entries.length) {
        return;
    }
    var model = JSON.parse(JSON.stringify(w.entries[index - 1].model));
    LinetypeMaker.load(CsLinetypeStore.deriveAnchors(model));
};

// ---- fonts ------------------------------------------------------------

/**
 * One font's sample, drawn with the ENGINE's strokes for that font -- the
 * same paths a text linetype puts on screen and paper -- so the dropdown
 * shows each font as it will print, not a system font of the same name.
 */
LinetypeMaker.fontIcon = function(name) {
    var W = LinetypeMaker.FONT_ICON_W, H = LinetypeMaker.FONT_ICON_H;
    var pixmap = new QPixmap(W, H);
    pixmap.fill(new QColor(0, 0, 0, 0));
    var paths = CsLinetypeStore.textPaths(LinetypeMaker.FONT_SAMPLE, name, 1, 0);
    if (paths.length === 0) {
        return new QIcon(pixmap);
    }
    var seg = CsLinetype.segment(1);
    seg.text = LinetypeMaker.FONT_SAMPLE;
    seg.style = name;
    var box = CsLinetypeStore.textBox(seg);
    var ink = new QColor(40, 40, 40);
    try {
        ink = LinetypeMaker.w.table.palette.color(QPalette.Text);
    } catch (eInk) {
    }
    var pad = 2;
    var f = Math.min((H - 2 * pad) / Math.max(box.maxY - box.minY, 1e-9),
                     (W - 2 * pad) / Math.max(box.maxX - box.minX, 1e-9));
    var painter = new QPainter();
    painter.begin(pixmap);
    try {
        painter.setRenderHint(QPainter.Antialiasing, true);
        var pen = new QPen(ink);
        pen.setWidth(0);
        painter.setPen(pen);
        painter.translate(pad - box.minX * f, H - pad + box.minY * f);
        painter.scale(f, -f);
        for (var i = 0; i < paths.length; i++) {
            painter.drawPath(paths[i]);
        }
    } finally {
        painter.end();
    }
    return new QIcon(pixmap);
};

LinetypeMaker.ensureFontIcons = function() {
    if (LinetypeMaker.fontIcons !== null) {
        return;
    }
    LinetypeMaker.fontIcons = {};
    LinetypeMaker.fontList = CsLinetypeStore.fontNames();
    for (var i = 0; i < LinetypeMaker.fontList.length; i++) {
        var n = LinetypeMaker.fontList[i];
        try {
            LinetypeMaker.fontIcons[n.toLowerCase()] = LinetypeMaker.fontIcon(n);
        } catch (eIcon) {
            // a font the engine will not draw still gets a plain entry
        }
    }
};

/** The font dropdown for one text row. */
LinetypeMaker.fontCombo = function(row, current) {
    LinetypeMaker.ensureFontIcons();
    var combo = new QComboBox();
    try {
        combo.setIconSize(new QSize(LinetypeMaker.FONT_ICON_W, LinetypeMaker.FONT_ICON_H));
    } catch (eSize) {
    }
    var names = LinetypeMaker.fontList.slice(0);
    var at = -1;
    for (var i = 0; i < names.length; i++) {
        if (names[i].toLowerCase() === String(current).toLowerCase()) {
            at = i;
        }
    }
    if (at < 0 && String(current) !== "") {
        // a font this machine lacks (an imported .lin): keep it listed
        names.unshift(String(current));
        at = 0;
    }
    for (var k = 0; k < names.length; k++) {
        var icon = LinetypeMaker.fontIcons[names[k].toLowerCase()];
        if (icon) {
            combo.addItem(icon, names[k]);
        } else {
            combo.addItem(names[k]);
        }
    }
    combo.setCurrentIndex(Math.max(at, 0));
    combo.toolTip = qsTr("Each font is drawn the way CaveCAD prints it.");
    combo.activated.connect(function(index) {
        LinetypeMaker.comboChanged(LinetypeMaker.COL.FONT, row, String(combo.itemText(index)));
    });
    return combo;
};

/** The anchor dropdown for one text row; the index maps to an anchor code. */
LinetypeMaker.anchorCombo = function(row, current) {
    var combo = new QComboBox();
    // Custom is offered only to a row that already is custom (an imported
    // placement); there is no way to make one here, and picking an anchor
    // replaces it.
    var codes = CsLinetype.ANCHORS.slice(0);
    if (codes.indexOf(current) < 0) {
        codes.push("custom");
    }
    var at = codes.indexOf(current);
    for (var i = 0; i < codes.length; i++) {
        combo.addItem(qsTr(CsLinetype.ANCHOR_LABELS[codes[i]]));
    }
    combo.setCurrentIndex(at < 0 ? codes.length - 1 : at);
    combo.toolTip = qsTr("Where the text sits: Left / Center / Right in its own row, " +
        "Top / Middle / Bottom against the line.");
    combo.activated.connect(function(index) {
        LinetypeMaker.comboChanged(LinetypeMaker.COL.ANCHOR, row, codes[index]);
    });
    return combo;
};

// ---- table <-> model ----------------------------------------------------

/** Puts a model into the form, optionally re-selecting rows. */
LinetypeMaker.load = function(model, selectRows) {
    var w = LinetypeMaker.w;
    var C = LinetypeMaker.COL;
    w.model = model;
    w.filling = true;
    try {
        w.name.text = model.name;
        w.description.text = model.description || "";
        LinetypeMaker.fillCategories(model.category || "");
        // 0 first, so the old rows' dropdowns go with them
        w.table.setRowCount(0);
        w.table.setRowCount(model.segments.length);
        for (var r = 0; r < model.segments.length; r++) {
            var s = model.segments[r];
            var isText = s.text !== "";
            // Font and Anchor are dropdowns on text rows; the cells under
            // them stay empty or their text shows through.
            var cells = [CsLinetype.kindOf(s), CsLinetype.num(s.length), s.text,
                "", isText ? CsLinetype.num(s.scale) : "", "",
                isText ? CsLinetype.num(s.rotation) : ""];
            for (var c = 0; c < cells.length; c++) {
                var item = new QTableWidgetItem(String(cells[c]));
                if (c === C.KIND || (!isText && c > C.TEXT)) {
                    try {
                        item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled);
                    } catch (eFlags) {
                    }
                }
                w.table.setItem(r, c, item);
            }
            if (isText && !s.shape) {
                w.table.setCellWidget(r, C.FONT, LinetypeMaker.fontCombo(r, s.style));
                w.table.setCellWidget(r, C.ANCHOR,
                    LinetypeMaker.anchorCombo(r, s.anchor || "custom"));
            }
        }
        try {
            w.table.resizeColumnsToContents();
        } catch (eResize) {
        }
    } finally {
        w.filling = false;
    }
    if (selectRows) {
        LinetypeMaker.selectRows(selectRows);
    }
    LinetypeMaker.render();
};

/** The category box: every category the library uses, showing `current`. */
LinetypeMaker.fillCategories = function(current) {
    var w = LinetypeMaker.w;
    var cats = LinetypeMaker.categories(CsLinetypeStore.loadCustom().linetypes);
    w.category.clear();
    w.category.addItem("");
    for (var i = 0; i < cats.length; i++) {
        w.category.addItem(cats[i]);
    }
    try {
        w.category.setEditText(current);
    } catch (eEdit) {
        w.category.editText = current;
    }
};

/** Distinct non-empty categories, sorted. */
LinetypeMaker.categories = function(models) {
    var seen = {}, out = [];
    for (var i = 0; i < models.length; i++) {
        var c = String(models[i].category || "").trim();
        if (c !== "" && !seen[c.toLowerCase()]) {
            seen[c.toLowerCase()] = true;
            out.push(c);
        }
    }
    out.sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    return out;
};

LinetypeMaker.cell = function(r, c) {
    var item = LinetypeMaker.w.table.item(r, c);
    return isNull(item) ? "" : String(item.text()).trim();
};

/** The rows the caver has selected, ascending -- the selection only,
 *  no fall-back to the current cell. */
LinetypeMaker.pickedRows = function() {
    var out = [];
    try {
        var idx = LinetypeMaker.w.table.selectionModel().selectedRows();
        for (var i = 0; i < idx.length; i++) {
            if (out.indexOf(idx[i].row()) < 0) {
                out.push(idx[i].row());
            }
        }
    } catch (eSel) {
    }
    out.sort(function(a, b) { return a - b; });
    return out;
};

/** The rows the caver has selected, ascending; the current row if none. */
LinetypeMaker.selectedRows = function() {
    var w = LinetypeMaker.w;
    var out = [];
    try {
        var idx = w.table.selectionModel().selectedRows();
        for (var i = 0; i < idx.length; i++) {
            var r = idx[i].row();
            if (out.indexOf(r) < 0) {
                out.push(r);
            }
        }
    } catch (eSel) {
    }
    if (out.length === 0) {
        var cur = w.table.currentRow();
        if (cur >= 0) {
            out.push(cur);
        }
    }
    out.sort(function(a, b) { return a - b; });
    return out;
};

LinetypeMaker.selectRows = function(rows) {
    var w = LinetypeMaker.w;
    // QTableWidgetSelectionRange is not bound in this build (probed
    // 2026-09-28); setCurrentCell's selection-command overload is.
    try {
        w.table.clearSelection();
        for (var i = 0; i < rows.length; i++) {
            w.table.setCurrentCell(rows[i], LinetypeMaker.COL.LENGTH,
                QItemSelectionModel.Select | QItemSelectionModel.Rows);
        }
    } catch (eSel) {
    }
};

/**
 * The rows a change made in `row` applies to: every selected row when
 * `row` is one of several selected, else just `row`. Text-only settings
 * skip the rows that have no text.
 */
LinetypeMaker.targets = function(row, textOnly) {
    var sel = LinetypeMaker.selectedRows();
    var rows = (sel.length > 1 && sel.indexOf(row) >= 0) ? sel : [row];
    if (!textOnly) {
        return rows;
    }
    var segs = LinetypeMaker.w.model.segments;
    var out = [];
    for (var i = 0; i < rows.length; i++) {
        if (rows[i] < segs.length && segs[rows[i]].text !== "") {
            out.push(rows[i]);
        }
    }
    return out;
};

/** A typed cell: copied to the other selected rows, then read back. */
LinetypeMaker.cellEdited = function(row, col) {
    var w = LinetypeMaker.w;
    var C = LinetypeMaker.COL;
    if (w.filling || col === C.KIND) {
        return;
    }
    var rows = LinetypeMaker.targets(row, col > C.TEXT);
    var value = LinetypeMaker.cell(row, col);
    w.filling = true;
    try {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] !== row) {
                var it = w.table.item(rows[i], col);
                if (!isNull(it)) {
                    it.setText(value);
                }
            }
        }
    } finally {
        w.filling = false;
    }
    LinetypeMaker.readForm();
};

/** A dropdown pick: the same value for every selected text row. */
LinetypeMaker.comboChanged = function(col, row, value) {
    var rows = LinetypeMaker.targets(row, true);
    var segs = LinetypeMaker.w.model.segments;
    for (var i = 0; i < rows.length; i++) {
        if (col === LinetypeMaker.COL.FONT) {
            segs[rows[i]].style = value;
        } else {
            segs[rows[i]].anchor = value;
        }
    }
    LinetypeMaker.finish(LinetypeMaker.selectedRows());
};

/**
 * Reads the form back into the model; never while load() is filling.
 * Font and anchor are not read here -- their dropdowns write the model
 * directly -- and neither are X/Y, which have no column: they come from
 * the anchor, or stay as imported for a Custom row.
 */
LinetypeMaker.readForm = function() {
    var w = LinetypeMaker.w;
    var C = LinetypeMaker.COL;
    if (w.filling) {
        return;
    }
    var old = w.model.segments;
    var m = { name: String(w.name.text).trim(),
              description: String(w.description.text).trim(),
              category: String(w.category.currentText).trim(), segments: [] };
    // rowCount is a PROPERTY in this bridge; currentRow is a method.
    for (var r = 0; r < w.table.rowCount; r++) {
        var prev = r < old.length ? old[r] : CsLinetype.segment(0);
        var s = CsLinetype.segment(Number(LinetypeMaker.cell(r, C.LENGTH)));
        s.text = LinetypeMaker.cell(r, C.TEXT);
        if (s.text !== "") {
            var had = prev.text !== "";
            s.shape = had && prev.shape === true;
            s.fitWidth = had ? prev.fitWidth : undefined;
            // a row that just gained text gets the defaults
            s.style = had && prev.style ? prev.style : "standard";
            s.anchor = had && prev.anchor ? prev.anchor : CsLinetype.DEFAULT_ANCHOR;
            var size = LinetypeMaker.cell(r, C.SIZE);
            s.scale = size === "" ? LinetypeMaker.TEXT_SIZE : Number(size);
            s.rotation = Number(LinetypeMaker.cell(r, C.ROT)) || 0;
            s.x = had ? prev.x : 0;
            s.y = had ? prev.y : 0;
        }
        m.segments.push(s);
    }
    w.model = m;
    LinetypeMaker.finish(LinetypeMaker.selectedRows());
};

/**
 * Anchored offsets recomputed, then the table redrawn from the model with
 * the same rows selected -- one path for every edit, so a row that gained
 * or lost its text always gains or loses its dropdowns.
 */
LinetypeMaker.finish = function(keepRows) {
    var segs = LinetypeMaker.w.model.segments;
    for (var i = 0; i < segs.length; i++) {
        // the gap first: the anchor is placed within it
        CsLinetypeStore.fitText(segs[i]);
        CsLinetypeStore.anchorize(segs[i]);
    }
    LinetypeMaker.load(LinetypeMaker.w.model, keepRows);
};

LinetypeMaker.addRow = function(length, withText) {
    var m = LinetypeMaker.w.model;
    var s = CsLinetype.segment(length);
    if (withText) {
        s.text = "TEXT";
        s.style = "standard";
        s.scale = LinetypeMaker.TEXT_SIZE;
        s.anchor = CsLinetype.DEFAULT_ANCHOR;
    }
    // Below the selection (its last row), or at the bottom when nothing
    // is selected. The new row comes up selected, so the next press lands
    // right after it.
    var picked = LinetypeMaker.pickedRows();
    var at = picked.length > 0 ? picked[picked.length - 1] + 1 : m.segments.length;
    m.segments.splice(at, 0, s);
    LinetypeMaker.finish([at]);
};

/** Removes every selected row. */
LinetypeMaker.removeRows = function() {
    var rows = LinetypeMaker.selectedRows();
    var segs = LinetypeMaker.w.model.segments;
    for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i] < segs.length) {
            segs.splice(rows[i], 1);
        }
    }
    LinetypeMaker.load(LinetypeMaker.w.model);
};

/** Moves the selected rows up (-1) or down (1) together. */
LinetypeMaker.moveRows = function(delta) {
    var rows = LinetypeMaker.selectedRows();
    var segs = LinetypeMaker.w.model.segments;
    if (rows.length === 0) {
        return;
    }
    if ((delta < 0 && rows[0] === 0) ||
            (delta > 0 && rows[rows.length - 1] === segs.length - 1)) {
        return;
    }
    var order = delta < 0 ? rows : rows.slice(0).reverse();
    for (var i = 0; i < order.length; i++) {
        var r = order[i], to = r + delta;
        var t = segs[r];
        segs[r] = segs[to];
        segs[to] = t;
    }
    var moved = [];
    for (var k = 0; k < rows.length; k++) {
        moved.push(rows[k] + delta);
    }
    LinetypeMaker.load(LinetypeMaker.w.model, moved);
};

/** Name and description only: typing them never rebuilds the table. */
LinetypeMaker.readNames = function() {
    var w = LinetypeMaker.w;
    w.model.name = String(w.name.text).trim();
    w.model.description = String(w.description.text).trim();
    if (!w.filling) {
        w.model.category = String(w.category.currentText).trim();
    }
    LinetypeMaker.render();
};

/** Preview + problems line + which buttons make sense. */
LinetypeMaker.render = function() {
    var w = LinetypeMaker.w;
    var problems = CsLinetype.validate(w.model);
    w.problems.text = problems.join("\n");
    w.saveButton.enabled = problems.length === 0;
    w.applyButton.enabled = problems.length === 0 && LinetypeMaker.document() !== null;
    w.testButton.enabled = w.applyButton.enabled;
    try {
        w.preview.setPixmap(LinetypeMaker.previewPixmap(w.model));
    } catch (ePix) {
        w.preview.text = CsLinetype.toPattern(w.model);
    }
};

/**
 * Three periods of the pattern along a straight line. Dashes and dots
 * come from CsLinetype.layout; each text from the ENGINE's own glyph
 * paths (RLinetypePattern.getShapeAt), so the preview shows the font
 * CaveCAD will draw. A bridge that cannot paint an RPainterPath falls
 * back to drawText.
 */
LinetypeMaker.previewPixmap = function(model, width, height) {
    var W = width || LinetypeMaker.PREVIEW_W, H = height || LinetypeMaker.PREVIEW_H;
    var pixmap = new QPixmap(W, H);
    pixmap.fill(new QColor(0, 0, 0, 0));
    var period = 0;
    for (var i = 0; i < model.segments.length; i++) {
        period += Math.abs(Number(model.segments[i].length) || 0);
    }
    if (!(period > 0)) {
        return pixmap;
    }
    var margin = 8;
    var f = (W - 2 * margin) / (3 * period);
    var y0 = H / 2;
    var lay = CsLinetype.layout(model, 3 * period);

    var engine = null;
    try {
        engine = new RLinetypePattern(true, "PREVIEW", "");
        if (!engine.setPatternString(CsLinetype.toPattern(model))) {
            engine = null;
        }
    } catch (eEng) {
        engine = null;
    }

    var ink = new QColor(40, 40, 40);
    try {
        ink = LinetypeMaker.w.preview.palette.color(QPalette.WindowText);
    } catch (eInk) {
        // the palette is a nicety; dark grey reads on a light panel
    }

    var painter = new QPainter();
    painter.begin(pixmap);
    try {
        painter.setRenderHint(QPainter.Antialiasing, true);
        var pen = new QPen(ink);
        pen.setWidth(2);
        painter.setPen(pen);
        for (var d = 0; d < lay.dashes.length; d++) {
            painter.drawLine(margin + lay.dashes[d][0] * f, y0,
                             margin + lay.dashes[d][1] * f, y0);
        }
        for (var p = 0; p < lay.dots.length; p++) {
            painter.drawPoint(margin + lay.dots[p] * f, y0);
        }
        var thin = new QPen(ink);
        thin.setWidth(0);
        painter.setPen(thin);
        for (var g = 0; g < lay.glyphs.length; g++) {
            var seg = model.segments[lay.glyphs[g].index];
            var gx = margin + lay.glyphs[g].at * f;
            var drawn = false;
            if (engine !== null) {
                try {
                    var paths = engine.getShapeAt(lay.glyphs[g].index);
                    painter.save();
                    painter.translate(gx, y0);
                    painter.scale(f, -f);
                    for (var k = 0; k < paths.length; k++) {
                        painter.drawPath(paths[k]);
                    }
                    painter.restore();
                    drawn = paths.length > 0;
                } catch (ePath) {
                    drawn = false;
                }
            }
            if (!drawn) {
                painter.drawText(gx + seg.x * f, y0 - seg.y * f, seg.text);
            }
        }
    } finally {
        painter.end();
    }
    return pixmap;
};

LinetypeMaker.save = function() {
    var err = CsLinetypeStore.saveCustom(LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: saved ") +
        LinetypeMaker.w.model.name + qsTr(" to ") + CsLinetypeStore.customPath());
    LinetypeMaker.refresh();
};

// Not LinetypeMaker.apply: that would shadow Function.prototype.apply.
LinetypeMaker.applyToDrawing = function() {
    var doc = LinetypeMaker.document();
    var di = EAction.getDocumentInterface();
    if (doc === null || isNull(di)) {
        CsTell.warn(qsTr("Open a drawing first."));
        return;
    }
    // A sheet is rebuilt from the cave's record; anything added to one
    // is lost on the next build. See Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Linetype Maker")) {
        return;
    }
    var err = CsLinetypeStore.applyToDocument(doc, di, LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: ") + LinetypeMaker.w.model.name +
        qsTr(" is in this drawing -- pick it from any layer's or entity's linetype list."));
    LinetypeMaker.refresh();
};

LinetypeMaker.LINE_TOOL = "scripts/Draw/Line/Line2P/Line2P.js";

/** How often, and for how long before the Line tool shows up, the
 *  restore watch looks. */
LinetypeMaker.WATCH_MS = 400;
LinetypeMaker.WATCH_START_TICKS = 10;

/** The script file of the active drawing's current action, or "". */
LinetypeMaker.currentTool = function(di) {
    try {
        return String(di.getCurrentAction().getGuiAction().getScriptFile());
    } catch (e) {
        // the default select action has no gui action
        return "";
    }
};

/**
 * Test: the linetype into the drawing, made current, and the Line tool
 * started, so the caver sees it drawn at once.
 *
 * The current linetype is put back when the Line tool ends -- otherwise
 * every wall drawn afterwards would quietly carry the test pattern. The
 * watch only ever reads the ACTIVE drawing (EAction.getDocumentInterface
 * at each tick), never a captured one: a tab closed meanwhile would leave
 * a freed document, and touching one segfaults. It restores by NAME, and
 * only while that drawing still has the test linetype current, so a tab
 * switch or a linetype the caver picked by hand is left alone.
 */
LinetypeMaker.testLine = function() {
    LinetypeMaker.drawWith(LinetypeMaker.w.model);
};

/** Draw with a linetype now: the Test button and every Draw panel tile. */
LinetypeMaker.drawWith = function(model) {
    var doc = LinetypeMaker.document();
    var di = EAction.getDocumentInterface();
    if (doc === null || isNull(di)) {
        CsTell.warn(qsTr("Open a drawing first."));
        return;
    }
    if (CsModelSpace.blocksWhole(doc, "Linetype Maker")) {
        return;
    }
    var err = CsLinetypeStore.applyToDocument(doc, di, model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    var previous = String(doc.getLinetypeName(doc.getCurrentLinetypeId()));
    di.setCurrentLinetype(doc.getLinetypeId(model.name));
    var line = RGuiAction.getByScriptFile(LinetypeMaker.LINE_TOOL);
    if (isNull(line)) {
        CsTell.warn(qsTr("The Line tool is not available in this build."));
        return;
    }
    line.slotTrigger();

    LinetypeMaker.stopWatch();
    var watch = { name: model.name, previous: previous, seen: false, ticks: 0 };
    var timer = new QTimer();
    timer.interval = LinetypeMaker.WATCH_MS;
    timer.timeout.connect(function() {
        LinetypeMaker.watchTick(watch);
    });
    LinetypeMaker.watch = { timer: timer, state: watch };
    timer.start();
    EAction.handleUserMessage(qsTr("Linetype Maker: drawing with ") + model.name +
        qsTr(" -- click two points; Escape ends the Line tool and puts your " +
        "previous linetype back."));
};

LinetypeMaker.watchTick = function(watch) {
    watch.ticks++;
    var di = EAction.getDocumentInterface();
    if (isNull(di)) {
        LinetypeMaker.stopWatch();
        return;
    }
    if (LinetypeMaker.currentTool(di) === LinetypeMaker.LINE_TOOL) {
        watch.seen = true;
        return;
    }
    if (!watch.seen && watch.ticks < LinetypeMaker.WATCH_START_TICKS) {
        return;
    }
    try {
        var doc = di.getDocument();
        var current = String(doc.getLinetypeName(doc.getCurrentLinetypeId()));
        if (current.toUpperCase() === watch.name.toUpperCase()) {
            var back = doc.getLinetypeId(watch.previous);
            if (!(back >= 0)) {
                back = doc.getLinetypeId("BYLAYER");
            }
            di.setCurrentLinetype(back);
        }
    } catch (eRestore) {
        // the restore is a courtesy; the drawing itself is untouched
    }
    LinetypeMaker.stopWatch();
};

LinetypeMaker.stopWatch = function() {
    if (!isNull(LinetypeMaker.watch)) {
        try {
            LinetypeMaker.watch.timer.stop();
        } catch (eStop) {
        }
    }
    LinetypeMaker.watch = null;
};

LinetypeMaker.watch = null;

LinetypeMaker.remove = function() {
    var name = LinetypeMaker.w.model.name;
    var err = CsLinetypeStore.removeCustom(name);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    LinetypeMaker.load(LinetypeMaker.blank());
    LinetypeMaker.refresh();
};

/**
 * Import...: a .lin or another drawing, then a tick list of what it
 * holds. A name already in the library says so on its row; ticking it
 * replaces yours, unticking leaves yours alone.
 */
LinetypeMaker.importFile = function() {
    var path = CsFiles.openFile(RMainWindowQt.getMainWindow(),
        qsTr("Import linetypes"), QDir.homePath(),
        qsTr("Linetypes (*.lin *.dxf *.dwg);;All files (*)"));
    // isNull + String: a wrapped empty QString is truthy
    if (isNull(path) || String(path) === "") {
        return;
    }
    var found = CsLinetypeStore.readImport(String(path));
    if (found.linetypes.length === 0) {
        CsTell.warn(qsTr("No linetypes found in ") + path +
            (found.errors.length > 0 ? " -- " + found.errors.join("; ") : "."));
        return;
    }
    var mine = CsLinetypeStore.loadCustom().linetypes;

    var dialog = new QDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = qsTr("Import linetypes");
    var v = new QVBoxLayout();
    var boxes = [];
    for (var i = 0; i < found.linetypes.length; i++) {
        var lt = found.linetypes[i];
        var label = lt.name + (lt.description ? " -- " + lt.description : "");
        var usable = CsLinetype.validate(lt).length === 0;
        if (!usable) {
            label += qsTr("  (cannot be used: ") + CsLinetype.validate(lt)[0] + ")";
        } else if (CsLinetypeStore.indexOf(mine, lt.name) >= 0) {
            label += qsTr("  (replaces yours)");
        }
        var box = new QCheckBox(label);
        box.checked = usable;
        box.enabled = usable;
        v.addWidget(box, 0, 0);
        boxes.push(box);
    }
    if (found.errors.length > 0) {
        var errs = new QLabel(qsTr("Skipped: ") + found.errors.join("; "));
        errs.wordWrap = true;
        v.addWidget(errs, 0, 0);
    }
    var buttons = new QHBoxLayout();
    var okButton = new QPushButton(qsTr("Import"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addStretch(1);
    buttons.addWidget(cancelButton, 0, 0);
    buttons.addWidget(okButton, 0, 0);
    v.addLayout(buttons, 0);
    dialog.setLayout(v);
    okButton.clicked.connect(function() { dialog.accept(); });
    cancelButton.clicked.connect(function() { dialog.reject(); });
    // exec() answers a plain 0 on cancel (qcad-js-bridge-traps)
    if (dialog.exec() === 0) {
        return;
    }
    var saved = 0, failed = [];
    for (var k = 0; k < boxes.length; k++) {
        if (boxes[k].checked !== true) {
            continue;
        }
        var err = CsLinetypeStore.saveCustom(found.linetypes[k]);
        if (err === null) {
            saved++;
        } else {
            failed.push(found.linetypes[k].name + ": " + err);
        }
    }
    if (failed.length > 0) {
        CsTell.warn(failed.join("\n"));
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: imported ") + saved +
        qsTr(" linetype(s) into your library."));
    LinetypeMaker.refresh();
};

// ---- the Draw panel's "Custom Linetypes" section -----------------------
//
// The caver's library as tiles, grouped by category; a click draws with
// that linetype (LinetypeMaker.drawWith -- the Test button's path). The
// Draw panel calls buildBody for its section, the way it does for Feature
// Trace, Symbols and Areas; LinetypeMaker.refresh rebuilds the tiles after
// every save, delete and import, so the section always shows the library.

// A list, one full-width button per linetype -- the Draw panel's rule for
// anything that shows a line (Nathan, 2026-09-28): the line is read along
// its length, so it gets the section's width.
LinetypeMaker.TILE_W = 200;
LinetypeMaker.TILE_H = 24;
LinetypeMaker.TILE_BUTTON_H = 52;
LinetypeMaker.TILE_COLUMNS = 1;
LinetypeMaker.NO_CATEGORY = "Uncategorized";

/** The section's inner layout, once the Draw panel has built it. */
LinetypeMaker.tilesLayout = null;

LinetypeMaker.buildBody = function(parent) {
    var body = new QWidget(parent);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(4, 4, 4, 4);
    layout.setSpacing(4);
    body.setLayout(layout);
    LinetypeMaker.tilesLayout = layout;
    LinetypeMaker.rebuildTiles(CsLinetypeStore.loadCustom().linetypes);
    return body;
};

LinetypeMaker.rebuildTiles = function(models) {
    var layout = LinetypeMaker.tilesLayout;
    if (isNull(layout)) {
        return;
    }
    CsPanel.clearLayout(layout);
    try {
        if (models.length === 0) {
            var none = new QLabel(qsTr("Your own linetypes appear here. Make one in " +
                "Linetype Maker (ltm) and give it a category to group it."));
            none.wordWrap = true;
            layout.addWidget(none, 0, 0);
            layout.addStretch(1);
            return;
        }
        var groups = {}, order = LinetypeMaker.categories(models);
        for (var i = 0; i < models.length; i++) {
            var c = String(models[i].category || "").trim();
            var key = c === "" ? LinetypeMaker.NO_CATEGORY : c;
            var found = null;
            for (var g in groups) {
                if (groups.hasOwnProperty(g) && g.toLowerCase() === key.toLowerCase()) {
                    found = g;
                }
            }
            if (found === null) {
                groups[key] = [];
                found = key;
            }
            groups[found].push(models[i]);
        }
        if (groups.hasOwnProperty(LinetypeMaker.NO_CATEGORY)) {
            order.push(LinetypeMaker.NO_CATEGORY);
        }
        for (var o = 0; o < order.length; o++) {
            var list = groups[order[o]];
            if (!list) {
                continue;
            }
            var head = new QLabel("<b>" + CsPanel.escapeHtml(order[o]) + "</b>");
            layout.addWidget(head, 0, 0);
            var grid = new QGridLayout();
            grid.setSpacing(2);
            grid.setColumnStretch(0, 1);
            for (var k = 0; k < list.length; k++) {
                grid.addWidget(LinetypeMaker.tile(list[k]),
                    Math.floor(k / LinetypeMaker.TILE_COLUMNS),
                    k % LinetypeMaker.TILE_COLUMNS);
            }
            layout.addLayout(grid, 0);
        }
        layout.addStretch(1);
    } catch (e) {
        // a tile the bridge refuses costs that tile, not the section
    }
};

LinetypeMaker.tile = function(model) {
    var b = new QToolButton();
    b.text = model.name;
    try {
        b.toolButtonStyle = Qt.ToolButtonTextUnderIcon;
        b.setIcon(new QIcon(LinetypeMaker.previewPixmap(model,
            LinetypeMaker.TILE_W, LinetypeMaker.TILE_H)));
        b.setIconSize(new QSize(LinetypeMaker.TILE_W, LinetypeMaker.TILE_H));
        b.setFixedHeight(LinetypeMaker.TILE_BUTTON_H);
        b.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed);
    } catch (eIcon) {
    }
    b.toolTip = (model.description ? model.description + "\n" : "") +
        qsTr("Click to draw with it (Line tool). Escape puts your previous linetype back.");
    b.clicked.connect(function() {
        LinetypeMaker.drawWith(model);
    });
    return b;
};

LinetypeMaker.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    // NOT a toggle: somebody who typed "ltm" wants the panel. A toggle
    // hid a panel that was already open behind another dock, so the
    // command looked like it did nothing (2026-09-28).
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = true;
        dock.raise();
    } catch (e) {
        csLinetypeMakerDock = undefined;
        CsTell.warn("Linetype Maker: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }
    this.terminate();
};

LinetypeMaker.init = function(basePath) {
    LinetypeMaker.basePath = basePath;
    var action = new RGuiAction(qsTr("Linetype Maker"), RMainWindowQt.getMainWindow());
    // Not setRequiresDocument: the library is edited without a drawing.
    // Apply to Drawing is what needs one, and it says so.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/LinetypeMaker.js");
    action.setIcon(basePath + "/LinetypeMaker.svg");
    action.setStatusTip(qsTr("Make, edit and import linetypes -- dashes, gaps and text"));
    action.setDefaultCommands(["linetypemaker", "ltm"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(45);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Built during init like the other docks: restoreState() runs after
    // this and can only place a dock that already exists.
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csLinetypeMakerDock = undefined;
        warning("Linetype Maker: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
