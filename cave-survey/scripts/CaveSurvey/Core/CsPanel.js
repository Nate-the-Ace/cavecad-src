// CsPanel.js -- the parts every Cave Survey dock panel shares: sections
// that fold away, and the memory of which ones a caver left shut.
//
// Part of the Cave Survey Core library. GUI context only (QWidget,
// QPushButton), but never an interactive ACTION's context -- panels
// call this, actions do not.
//
// WHY IT EXISTS. Nathan, 2026-09-07: "can we keep Symbol and Trace
// palettes in sync when it comes to controls? When I ask for an
// interface feature for one, I'd like you to consider it for both."
// Collapsible categories were built for the Symbol Palette first, and
// the honest way to keep that promise is not to remember to copy the
// code -- it is for there to be one copy. A panel feature that lives
// here is a panel feature both panels have.
//
// Everything degrades: a bridge that refuses the header button gets a
// section that never folds, which is a panel that does not fold rather
// than a panel that does not build.

var CsPanel = {};

/** How a collapsed set is stored: one settings key per panel, holding
 *  the shut sections' titles, comma separated. Titles come from the
 *  catalogue and from what a caver types, and none has ever had a comma
 *  in it; one that did would fold the wrong section and nothing worse. */
CsPanel.loadCollapsed = function(settingKey) {
    var set = {};
    try {
        var raw = RSettings.getStringValue(settingKey, "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name !== "") {
                    set[name] = true;
                }
            }
        }
    } catch (e) {
        // a bridge without settings forgets between sessions, which is
        // a panel that opens fully expanded -- no work lost
    }
    return set;
};

/** Records that one section is open or shut. No key (null or "") is a
 *  section that folds without remembering, as a dialog's sections do. */
CsPanel.saveCollapsed = function(settingKey, title, collapsed) {
    if (settingKey === null || settingKey === undefined || settingKey === "") {
        return;
    }
    try {
        var set = CsPanel.loadCollapsed(settingKey);
        if (collapsed) {
            set[title] = true;
        } else if (set.hasOwnProperty(title)) {
            delete set[title];
        }
        var names = [];
        for (var name in set) {
            if (set.hasOwnProperty(name)) {
                names.push(name);
            }
        }
        RSettings.setValue(settingKey, names.join(","));
    } catch (e) {
    }
};

// ---------------------------------------------------------------------
// COLUMNS A CAVER ARRANGES.
//
// Nathan, 2026-09-15: "does the table object let me rearrange the
// columns by dragging them around? I want to be able to hide or show
// columns on demand." It does -- probed against this build rather than
// assumed: setSectionsMovable/sectionsMovable, moveSection/visualIndex,
// hideSection/showSection/isSectionHidden and the header's own context
// menu are all real here, and all of them DO something when called.
//
// What is stored is KEYS, never column numbers. A saved arrangement
// outlives the table it was made on: the Decl column was added between
// Date and Team on 2026-09-15, and an order remembered as "3, 1, 0"
// would have quietly shuffled itself the day that happened. Keys also
// mean a column that is retired simply drops out of the arrangement
// instead of hiding whatever took its index.
//
// Two settings per table: the visual ORDER and the HIDDEN set, both
// comma-separated keys, in the plain-string form every other setting in
// this suite uses.
//
// Everything here is pure except apply/attach: the sanitising is where
// the bugs live, and it is testable without a table.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// WHAT CANNOT BE TYPED IN LOOKS LIKE IT.
//
// Nathan, 2026-09-15: "for read only columns, I want to visually make
// them distinct so that it's clear why clicking on them isn't doing
// anything." A cell that silently refuses a double-click is the worst
// kind of dead control -- it looks identical to the one beside it that
// works, so the caver concludes the table is broken rather than that
// the column is counted.
//
// SHADED MEANS LOCKED, which is the spreadsheet idiom everybody already
// carries: a wash over the cell, and a dimmer heading above it.
//
// THE TINT IS THE TEXT COLOUR AT LOW ALPHA, not a grey. A fixed grey is
// only ever right in one theme -- CaveCAD's panels are dark (the
// palette's Base here measures 23,23,23) and a light-grey wash would
// glare; on a light theme the same grey would vanish. A wash of the
// text colour darkens a light table and lightens a dark one by the
// same small amount, whatever the theme is doing.
//
// FOREGROUND IS LEFT ALONE deliberately: the shelf's Decl column
// already greys its TEXT to mean "not set", and a second meaning on the
// same channel would make both unreadable.
// ---------------------------------------------------------------------

/** How strong the wash is, out of 255. Enough to see the column edge,
 *  not enough to fight the text. */
CsPanel.READ_ONLY_ALPHA = 22;

/** How much a read-only column's HEADING is dimmed toward the
 *  background, 0 (invisible) to 1 (full strength). */
CsPanel.READ_ONLY_HEADING = 0.55;

/**
 * Blend two colours. `weight` is how much of `a` survives.
 *
 * Pure, and the reason the dimming is testable: what a heading should
 * look like is arithmetic on the palette, not a constant somebody
 * picked while looking at one theme.
 */
CsPanel.blend = function(a, b, weight) {
    var w = (isNull(weight) || !isFinite(weight)) ? 0.5 :
        Math.max(0, Math.min(1, weight));
    var mix = function(x, y) {
        return Math.round(x * w + y * (1 - w));
    };
    return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
};

/** A widget's palette as plain numbers: {text, base}. Null when this
 *  build will not answer, which costs the tint and nothing else. */
CsPanel.paletteOf = function(widget) {
    try {
        var palette = widget.palette;
        var text = palette.color(QPalette.Text);
        var base = palette.color(QPalette.Base);
        return {
            text: { r: text.red(), g: text.green(), b: text.blue() },
            base: { r: base.red(), g: base.green(), b: base.blue() }
        };
    } catch (e) {
        return null;
    }
};

/** The wash a read-only cell carries, or null. */
CsPanel.readOnlyBrush = function(widget) {
    var palette = CsPanel.paletteOf(widget);
    if (palette === null) {
        return null;
    }
    try {
        return new QBrush(new QColor(palette.text.r, palette.text.g,
            palette.text.b, CsPanel.READ_ONLY_ALPHA));
    } catch (e) {
        return null;
    }
};

/** The colour a read-only heading is written in, or null. */
CsPanel.readOnlyHeadingBrush = function(widget) {
    var palette = CsPanel.paletteOf(widget);
    if (palette === null) {
        return null;
    }
    var dim = CsPanel.blend(palette.text, palette.base,
        CsPanel.READ_ONLY_HEADING);
    try {
        return new QBrush(new QColor(dim.r, dim.g, dim.b));
    } catch (e) {
        return null;
    }
};

/**
 * Mark one cell as a caver's to type in, or not: the edit flag and the
 * wash together, so the two can never disagree.
 *
 * One call, because they ARE one decision -- a cell tinted but still
 * editable, or editable but tinted, is worse than either.
 */
CsPanel.markCell = function(table, cell, editable) {
    try {
        var flags = cell.flags();
        cell.setFlags(editable === true ? (flags | Qt.ItemIsEditable) :
            (flags & ~Qt.ItemIsEditable));
    } catch (eFlags) {
        // a bridge without item flags gets a table that edits nothing
    }
    if (editable === true) {
        return;
    }
    var brush = CsPanel.readOnlyBrush(table);
    if (brush === null) {
        return;
    }
    try {
        cell.setBackground(brush);
    } catch (eBack) {
    }
};

/**
 * Dim the HEADINGS of the columns that cannot be typed in.
 *
 * \param editable [bool] per column, in LOGICAL order
 *
 * The heading is set as an item so it can be coloured at all; a header
 * that has none is given one first, carrying the label it already
 * shows.
 */
CsPanel.markHeadings = function(table, labels, editable) {
    var brush = CsPanel.readOnlyHeadingBrush(table);
    if (brush === null) {
        return;
    }
    for (var i = 0; i < labels.length; i++) {
        if (editable[i] === true) {
            continue;
        }
        try {
            var head = table.horizontalHeaderItem(i);
            if (isNull(head)) {
                head = new QTableWidgetItem(labels[i]);
                table.setHorizontalHeaderItem(i, head);
            }
            head.setForeground(brush);
        } catch (eHead) {
        }
    }
};

/** The two settings keys one table uses, derived from one name. */
CsPanel.columnKeys = function(settingKey) {
    return { order: settingKey + "Order", hidden: settingKey + "Hidden" };
};

/**
 * A stored arrangement, made safe against the table it will be applied
 * to.
 *
 * \param keys   the table's own column keys, in the order they are
 *               built -- which is also the default order
 * \param order  what was stored, or ""
 * \param hidden what was stored, or ""
 * \return { order: [key...], hidden: {key: true} }
 *
 * The rules are all about not trapping anybody:
 *   - a key the table does not have is dropped (a retired column)
 *   - a key the table has but the arrangement does not is APPENDED (a
 *     new column appears rather than never being seen)
 *   - duplicates collapse to the first
 *   - and if the arrangement would hide EVERY column, nothing is
 *     hidden: an empty table reads as a broken one, and a caver who
 *     did that to themselves has no header left to fix it from.
 */
CsPanel.readColumns = function(keys, order, hidden) {
    var known = {};
    var i;
    for (i = 0; i < keys.length; i++) {
        known[keys[i]] = true;
    }
    var out = [];
    var taken = {};
    var parts = String(isNull(order) ? "" : order).split(",");
    for (i = 0; i < parts.length; i++) {
        var key = parts[i].trim();
        if (key === "" || known[key] !== true || taken[key] === true) {
            continue;
        }
        taken[key] = true;
        out.push(key);
    }
    for (i = 0; i < keys.length; i++) {
        if (taken[keys[i]] !== true) {
            out.push(keys[i]);
        }
    }

    var off = {};
    var shut = 0;
    parts = String(isNull(hidden) ? "" : hidden).split(",");
    for (i = 0; i < parts.length; i++) {
        var gone = parts[i].trim();
        if (gone === "" || known[gone] !== true || off[gone] === true) {
            continue;
        }
        off[gone] = true;
        shut += 1;
    }
    if (shut >= keys.length && keys.length > 0) {
        off = {};
    }
    return { order: out, hidden: off };
};

/** An arrangement as the two strings it is stored as. */
CsPanel.columnsText = function(arrangement) {
    var hidden = [];
    for (var key in arrangement.hidden) {
        if (arrangement.hidden.hasOwnProperty(key) &&
                arrangement.hidden[key] === true) {
            hidden.push(key);
        }
    }
    return { order: arrangement.order.join(","), hidden: hidden.join(",") };
};

/** What is stored for this table, read and made safe. */
CsPanel.loadColumns = function(settingKey, keys) {
    var names = CsPanel.columnKeys(settingKey);
    var order = "", hidden = "";
    try {
        order = RSettings.getStringValue(names.order, "");
        hidden = RSettings.getStringValue(names.hidden, "");
    } catch (e) {
        // a bridge without settings forgets between sessions, which is
        // a table that opens in its default arrangement
    }
    return CsPanel.readColumns(keys, order, hidden);
};

/** Stores one arrangement. */
CsPanel.saveColumns = function(settingKey, arrangement) {
    var names = CsPanel.columnKeys(settingKey);
    var text = CsPanel.columnsText(arrangement);
    try {
        RSettings.setValue(names.order, text.order);
        RSettings.setValue(names.hidden, text.hidden);
    } catch (e) {
    }
};

/**
 * The moves that put `order` on screen, as [{from, to}] in the order
 * they must be made.
 *
 * ONE AT A TIME, AND FROM THE LEFT. moveSection works in VISUAL
 * indices and every move renumbers everything to its right, so the
 * moves cannot be worked out all at once and replayed -- each one is
 * computed against where things are after the last. That is what this
 * simulates, which is also why it can be tested without a header.
 *
 * \param keys    the table's column keys, in LOGICAL order
 * \param order   the visual order wanted, as keys
 * \param visual  where each logical column sits now: [logical] -> visual
 */
CsPanel.columnMoves = function(keys, order, visual) {
    var now = [];      // visual position -> logical index
    var i;
    for (i = 0; i < keys.length; i++) {
        var at = (isNull(visual) || isNull(visual[i])) ? i : visual[i];
        now[at] = i;
    }
    for (i = 0; i < keys.length; i++) {
        if (isNull(now[i])) {
            now[i] = i;
        }
    }
    var moves = [];
    var slot = 0;   // the next VISUAL place to fill
    for (i = 0; i < order.length; i++) {
        var logical = keys.indexOf(order[i]);
        if (logical < 0) {
            // A key this table does not have takes no place: it must
            // not leave a gap that shifts every real column one to the
            // right. (readColumns strips these already; this is the
            // belt to that pair of braces.)
            continue;
        }
        var from = now.indexOf(logical);
        if (from >= 0 && from !== slot) {
            moves.push({ from: from, to: slot });
            now.splice(from, 1);
            now.splice(slot, 0, logical);
        }
        slot += 1;
    }
    return moves;
};

/**
 * Give a table's header the arrangement a caver left it in, and let
 * them change it: drag a column to move it, right-click for which
 * columns show.
 *
 * PROBED, NOT ASSUMED (2026-09-15, headless against this build):
 * setSectionsMovable/sectionsMovable, moveSection/visualIndex,
 * hideSection/showSection/isSectionHidden, setColumnHidden and the
 * header's customContextMenuRequested are all real here AND all take
 * effect when called. Nothing in this file is reached for on faith --
 * and every piece of it is still guarded, because a bridge that
 * refuses one of them should cost the arrangement, never the table.
 *
 * \param table      a QTableWidget the caller built
 * \param keys       column keys in LOGICAL order (the order built)
 * \param labels     what each column is called, same order
 * \param settingKey where the arrangement is remembered
 * \return the widget bag { table, keys, labels, settingKey, menu }, or
 *         null when this build will not arrange columns -- the table
 *         still works, it just stays as it was built.
 */
CsPanel.arrangeColumns = function(table, keys, labels, settingKey) {
    var header = null;
    try {
        header = table.horizontalHeader();
    } catch (eHeader) {
        return null;
    }
    if (isNull(header)) {
        return null;
    }
    var bag = { table: table, keys: keys, labels: labels,
                settingKey: settingKey, header: header, menu: null };
    try {
        header.setSectionsMovable(true);
    } catch (eMove) {
        // a header that will not move sections still hides columns
    }
    CsPanel.applyColumns(bag, CsPanel.loadColumns(settingKey, keys));

    // A DRAG IS A DECISION, so it is remembered the moment it lands
    // rather than at some tidier time that may never come.
    try {
        header["sectionMoved(int, int, int)"].connect(function() {
            CsPanel.rememberColumns(bag);
        });
    } catch (eSignal) {
        try {
            header.sectionMoved.connect(function() {
                CsPanel.rememberColumns(bag);
            });
        } catch (eSignal2) {
        }
    }

    // THE MENU LIVES ON THE HEADER, where a caver right-clicks to ask
    // "what else could be here" -- and it is kept on the bag rather
    // than in a local, because a QMenu held only by a local goes out
    // of scope while it is open.
    try {
        header.contextMenuPolicy = Qt.CustomContextMenu;
        header["customContextMenuRequested(const QPoint&)"].connect(
            function(pos) {
                CsPanel.columnMenu(bag, pos);
            });
    } catch (eMenu) {
        try {
            header.customContextMenuRequested.connect(function(pos) {
                CsPanel.columnMenu(bag, pos);
            });
        } catch (eMenu2) {
        }
    }
    return bag;
};

/** Put one arrangement on screen. */
CsPanel.applyColumns = function(bag, arrangement) {
    var i;
    try {
        for (i = 0; i < bag.keys.length; i++) {
            bag.table.setColumnHidden(i,
                arrangement.hidden[bag.keys[i]] === true);
        }
    } catch (eHide) {
    }
    var visual = [];
    try {
        for (i = 0; i < bag.keys.length; i++) {
            visual.push(bag.header.visualIndex(i));
        }
    } catch (eVisual) {
        visual = null;
    }
    try {
        var moves = CsPanel.columnMoves(bag.keys, arrangement.order, visual);
        for (i = 0; i < moves.length; i++) {
            bag.header.moveSection(moves[i].from, moves[i].to);
        }
    } catch (eMove) {
    }
};

/** What the header is showing now, as an arrangement. */
CsPanel.currentColumns = function(bag) {
    var order = [];
    var hidden = {};
    var slots = [];
    var i;
    for (i = 0; i < bag.keys.length; i++) {
        var at = i;
        try {
            at = bag.header.visualIndex(i);
        } catch (eVisual) {
        }
        slots[at] = bag.keys[i];
        try {
            if (bag.table.isColumnHidden(i) === true) {
                hidden[bag.keys[i]] = true;
            }
        } catch (eHidden) {
        }
    }
    for (i = 0; i < slots.length; i++) {
        if (!isNull(slots[i])) {
            order.push(slots[i]);
        }
    }
    return CsPanel.readColumns(bag.keys, order.join(","),
        CsPanel.columnsText({ order: order, hidden: hidden }).hidden);
};

/** Records what the header is showing now. */
CsPanel.rememberColumns = function(bag) {
    CsPanel.saveColumns(bag.settingKey, CsPanel.currentColumns(bag));
};

/** Show or hide one column, and remember it. */
CsPanel.toggleColumn = function(bag, key, show) {
    var at = bag.keys.indexOf(key);
    if (at < 0) {
        return;
    }
    // NEVER THE LAST ONE. A table with every column hidden reads as a
    // table that failed to load, and the header it would be fixed from
    // is gone with them.
    if (show !== true) {
        var left = 0;
        for (var i = 0; i < bag.keys.length; i++) {
            try {
                if (i !== at && bag.table.isColumnHidden(i) !== true) {
                    left += 1;
                }
            } catch (eCount) {
            }
        }
        if (left === 0) {
            return;
        }
    }
    try {
        bag.table.setColumnHidden(at, show !== true);
    } catch (eHide) {
        return;
    }
    CsPanel.rememberColumns(bag);
};

/** The right-click menu on a table header: one tick per column, and a
 *  way back to how it shipped. */
CsPanel.columnMenu = function(bag, pos) {
    try {
        var menu = new QMenu(bag.table);
        var addToggle = function(key, label) {
            var action = menu.addAction(label);
            action.checkable = true;
            var at = bag.keys.indexOf(key);
            var shown = true;
            try {
                shown = bag.table.isColumnHidden(at) !== true;
            } catch (eShown) {
            }
            action.checked = shown;
            action.toggled.connect(function(on) {
                CsPanel.toggleColumn(bag, key, on);
            });
        };
        for (var i = 0; i < bag.keys.length; i++) {
            addToggle(bag.keys[i], bag.labels[i]);
        }
        menu.addSeparator();
        var reset = menu.addAction(qsTr("Reset Columns"));
        reset.triggered.connect(function() {
            CsPanel.resetColumns(bag);
        });
        bag.menu = menu;   // a menu held only by a local dies while open
        var global = null;
        try {
            global = bag.header.mapToGlobal(pos);
        } catch (eMap) {
            global = null;
        }
        if (global === null) {
            menu.popup(QCursor.pos());
        } else {
            menu.popup(global);
        }
    } catch (eMenu) {
        // no menu here: dragging still arranges the columns
    }
};

/** Back to the order and visibility the table was built with. */
CsPanel.resetColumns = function(bag) {
    var fresh = { order: bag.keys.slice(0), hidden: {} };
    CsPanel.applyColumns(bag, fresh);
    CsPanel.saveColumns(bag.settingKey, fresh);
};

/** The chevron on a section header: pointing UP when the section is
 *  open (click to fold it away), DOWN when it is shut.
 *
 *  NOT A CHECKBOX. A checkable group box was the first attempt, and it
 *  reads as "switch this off", so a caver aims at the little box --
 *  Nathan, 2026-09-07: "I keep clicking on the check box itself and it
 *  doesn't work like that." A chevron says fold, and the whole header
 *  is the target. */
CsPanel.OPEN_MARK = "\u2303";     // up
CsPanel.SHUT_MARK = "\u2304";     // down

/** A section header's text: the chevron, then the title. */
CsPanel.headerText = function(title, open) {
    return (open ? CsPanel.OPEN_MARK : CsPanel.SHUT_MARK) + "  " + title;
};

/**
 * A section that folds away: a header you click, and a host widget
 * holding whatever the caller puts in it.
 *
 * THE WHOLE HEADER IS THE TARGET, which is the point of the redesign.
 * The header is a flat button spanning the panel, so there is no small
 * thing to aim at and no state to misread.
 *
 * THE HOST IS THE OTHER HALF. Hiding a widget is what gives the space
 * back; a layout cannot hide itself, and disabling controls leaves them
 * taking exactly the same room.
 *
 * The caller fills `host` and adds `box` to its layout:
 *
 *   var sec = CsPanel.section(parent, "Tracing", KEY, collapsed);
 *   sec.host.setLayout(myGrid);
 *   layout.addWidget(sec.box, 0, 0);
 *
 * \return { box, host, header, open }
 */
CsPanel.section = function(parent, title, settingKey, collapsedSet) {
    var open = !(collapsedSet && collapsedSet[title] === true);
    var box = new QWidget(parent);
    var outer = new QVBoxLayout();
    try {
        outer.setContentsMargins(0, 0, 0, 0);
        outer.setSpacing(0);
    } catch (eMargins) {
    }

    var header = null;
    try {
        header = new QPushButton(CsPanel.headerText(title, open));
        header.flat = true;
        header.toolTip = qsTr("Click to fold this section away");
        try {
            // Left-aligned like a heading rather than centred like a
            // button: it names what is below it, it does not act.
            header.styleSheet = "text-align: left; padding: 3px;";
        } catch (eStyle) {
        }
        outer.addWidget(header, 0, 0);
    } catch (eHeader) {
        // No header: the section simply never folds, and everything in
        // it still works.
        header = null;
    }

    var host = new QWidget(box);
    outer.addWidget(host, 0, 0);
    box.setLayout(outer);

    // Built before wiring so connectSection's closure can hand it back
    // to its stack (`section.stack`, set by stackAdd) and ask for a
    // relayout on every fold -- see connectSection's own comment.
    var result = { box: box, host: host, header: header, open: open,
        stack: null };

    try {
        host.visible = open;
        if (header !== null) {
            CsPanel.connectSection(header, host, title, settingKey, result);
        }
    } catch (eWire) {
    }
    return result;
};

/** Whether a section is folded right now.
 *
 *  `section.open` FIRST, NOT `host.visible` -- measured 2026-09-12: the
 *  very first relayout a dock ever runs happens inside
 *  DrawPanel.buildDock, before `body.setLayout` and before the dock is
 *  handed to `addDockWidget`. A QWidget's `visible` there is not "what
 *  was requested", it is `isVisible()`, which Qt defines as false for
 *  EVERY descendant until the whole ancestor chain has actually been
 *  realised on screen -- so reading it that early reported every
 *  section as folded regardless of what CsPanel.section had just set,
 *  and the grid came out as N full-width strips until the next fold,
 *  unfold or reorder happened to call relayout again post-show and
 *  correct it by accident.
 *
 *  So `open` is now kept accurate instead of read around: CsPanel.section
 *  sets it from the caver's collapsed set, connectSection's click
 *  handler writes the new value back on every toggle, and setOpen does
 *  the same -- one field, always current, true before the widget is
 *  ever shown and after. `host.visible` is kept only as a fallback for
 *  a section that has no `open` at all (a bare mock in the test suite,
 *  never one CsPanel.section built). */
CsPanel.isFolded = function(section) {
    try {
        if (isNull(section)) {
            return false;
        }
        if (typeof section.open === "boolean") {
            return section.open === false;
        }
        return !isNull(section.host) && section.host.visible === false;
    } catch (e) {
        return false;
    }
};

/** Wires one section's header to its contents. Its own function so the
 *  closure captures ONE title and host rather than a loop's.
 *
 *  `section` is optional -- callers outside CsPanel.section itself (are
 *  there none today) can still wire a header without one, and simply
 *  get a section that folds without reflowing anything, same as before
 *  this existed. */
CsPanel.connectSection = function(header, host, title, settingKey, section) {
    header.clicked.connect(function() {
        var open = true;
        try {
            open = !host.visible;
            host.visible = open;
        } catch (eVis) {
            return;
        }
        try {
            header.text = CsPanel.headerText(title, open);
        } catch (eText) {
        }
        // Written back so CsPanel.isFolded has a live answer without
        // ever asking the widget -- see that function's own comment for
        // why `host.visible` cannot be trusted for this.
        if (!isNull(section)) {
            section.open = open;
        }
        CsPanel.saveCollapsed(settingKey, title, !open);
        // REVERSED, 2026-09-12: Nathan, looking at the live Draw panel,
        // "when I minimize a section in the panel, I want the others to
        // grow into the space" -- the opposite of the mockup rule this
        // grid shipped with (a folded section used to keep its cell).
        // A section only knows to ask for this if stackAdd put it in a
        // stack; one built standalone has no `section.stack` and simply
        // folds in place, exactly as it always has.
        if (!isNull(section) && !isNull(section.stack)) {
            try {
                CsPanel.relayout(section.stack);
            } catch (eRelayout) {
            }
        }
    });
};

/**
 * Folds a section open or shut WITHOUT remembering it.
 *
 * WHAT A SEARCH NEEDS. Typing "gour" must show the rimstone dam even
 * when its section was folded away last week, and clearing the search
 * must put the panel back exactly as the caver left it. That only
 * works if the search never writes to the collapsed set -- which is
 * the whole difference between this and clicking the header.
 */
CsPanel.setOpen = function(section, title, open) {
    if (isNull(section)) {
        return;
    }
    try {
        section.host.visible = open;
    } catch (eVis) {
        return;
    }
    try {
        if (!isNull(section.header)) {
            section.header.text = CsPanel.headerText(title, open);
        }
    } catch (eText) {
    }
    // Same reason connectSection writes it back: CsPanel.isFolded reads
    // `open`, never the widget, so a caller that forces a section open
    // through this path (DrawPanel.reveal, a search) must keep it
    // current too.
    section.open = open;
};

/**
 * The saved order of a panel's sections: titles, in the order the caver
 * put them. Unknown to the panel is fine -- see orderedTitles.
 */
CsPanel.loadOrder = function(settingKey) {
    var out = [];
    try {
        var raw = RSettings.getStringValue(settingKey + "Order", "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name !== "") {
                    out.push(name);
                }
            }
        }
    } catch (e) {
    }
    return out;
};

/** Records the order a panel's sections are in. */
CsPanel.saveOrder = function(settingKey, titles) {
    try {
        RSettings.setValue(settingKey + "Order", titles.join(","));
    } catch (e) {
    }
};

/**
 * `titles` arranged by `saved`.
 *
 * A title the saved order does not mention keeps its place relative to
 * the ones it came after -- so a new category, or a new section in a
 * new release, appears where the panel meant to put it rather than
 * being swept to the end of a caver's arrangement.
 *
 * A saved title the panel no longer has is dropped, which is what
 * happens to a category whose last symbol was deleted.
 *
 * Pure.
 */
CsPanel.orderedTitles = function(titles, saved) {
    if (isNull(saved) || saved.length === 0) {
        return titles.slice(0);
    }
    var known = {};
    var i;
    for (i = 0; i < titles.length; i++) {
        known[titles[i]] = true;
    }
    var out = [];
    var placed = {};
    for (i = 0; i < saved.length; i++) {
        if (known[saved[i]] === true && placed[saved[i]] !== true) {
            out.push(saved[i]);
            placed[saved[i]] = true;
        }
    }
    // The unmentioned ones, in the panel's own order, each inserted
    // after whichever of its original predecessors is already placed.
    for (i = 0; i < titles.length; i++) {
        if (placed[titles[i]] === true) {
            continue;
        }
        var at = out.length;
        for (var j = i - 1; j >= 0; j--) {
            var idx = out.indexOf(titles[j]);
            if (idx !== -1) {
                at = idx + 1;
                break;
            }
        }
        out.splice(at, 0, titles[i]);
        placed[titles[i]] = true;
    }
    return out;
};

/**
 * A stack of sections in one layout, which the caver can reorder.
 *
 * NOT BY DRAGGING, and not for want of trying: this bridge hands script
 * mouse events for exactly four widget classes (RListView, RListWidget,
 * RTreeWidget, RGraphicsViewQt -- the generated shells are the list),
 * and a section header is none of them. A header cannot know it is
 * being dragged. So the reordering is on the header's own right-click
 * menu, which any widget can have.
 *
 * `baseIndex` MEANS SOMETHING DIFFERENT in each mode. Box mode (no
 * `columns`): it is a widget COUNT -- how many widgets precede the
 * stack in `layout`, so a readout or a search box above it keeps its
 * place while the sections below are shuffled. Grid mode (`columns`
 * set): it is a ROW OFFSET, added to every section's row before it goes
 * into the QGridLayout. That is only correct if whatever the panel put
 * above the grid also lives in that same QGridLayout, one full-width
 * row per widget -- a widget occupying two rows, or sharing a row with
 * something else, would throw the offset off and nothing here would
 * notice.
 *
 * `columns` is omitted for the box-layout behaviour every existing
 * caller relies on -- `layout` stays a single column and sections are
 * inserted with `insertWidget`. Pass a column count to lay `layout`
 * (which must then be a QGridLayout) out as a grid instead: see
 * `gridPlan` for the shape, and `relayout` for how it is applied.
 */
CsPanel.stack = function(layout, settingKey, baseIndex, onChanged, columns) {
    return {
        layout: layout,
        settingKey: settingKey,
        baseIndex: isNull(baseIndex) ? 0 : baseIndex,
        onChanged: isNull(onChanged) ? null : onChanged,
        columns: isNull(columns) ? null : columns,
        sections: []
    };
};

/**
 * Where each of `items` sits in a grid `columns` wide, given which are
 * folded. `items` is `[{folded: bool}, ...]` in section order; returns
 * one `{row, col, span, stretch}` per item, same order.
 *
 * REVERSED, 2026-09-12: Nathan, having actually used the Draw panel's
 * grid, "when I minimize a section in the panel, I want the others to
 * grow into the space" -- the opposite of the mockup rule this shipped
 * with a day earlier, where a folded section kept its cell so nothing
 * moved under a caver's cursor. This superseded gridSpans, which knew
 * nothing about folding at all.
 *
 * THE RULES, IN ORDER:
 *   - A FOLDED item takes a full-width strip row of its own, in its
 *     ORDER position -- it does not move to the bottom. A strip gets
 *     no share of the height (`stretch: 0`).
 *   - UNFOLDED items flow left to right, `columns` wide, and their rows
 *     get `stretch: 1`.
 *   - An unfolded item ALONE on its row spans the full width -- the
 *     original lone-row rule, generalised: alone because it is last,
 *     or alone because the very next item in order is folded and so
 *     starts a strip row of its own.
 *   - Order is always preserved: item i never lands on a row above
 *     item i-1's.
 *
 * Pure.
 */
CsPanel.gridPlan = function(items, columns) {
    var cols = isNull(columns) || columns < 1 ? 1 : Math.floor(columns);
    var out = [];
    var row = 0;
    var flowCol = 0;
    for (var i = 0; i < items.length; i++) {
        if (items[i].folded) {
            if (flowCol > 0) {
                // An unfolded row was left mid-fill when this fold hit
                // it -- close it out (a gap, not a stretch: only a
                // truly LONE item ever gets its span widened) and start
                // the strip on a fresh row.
                row += 1;
                flowCol = 0;
            }
            out.push({ row: row, col: 0, span: cols, stretch: 0 });
            row += 1;
        } else {
            var lone = (flowCol === 0) &&
                (i === items.length - 1 || items[i + 1].folded === true);
            out.push({ row: row, col: flowCol,
                span: lone ? cols : 1, stretch: 1 });
            if (lone) {
                row += 1;
                flowCol = 0;
            } else {
                flowCol += 1;
                if (flowCol >= cols) {
                    flowCol = 0;
                    row += 1;
                }
            }
        }
    }
    return out;
};

/** The titles currently in a stack, in their current order. */
CsPanel.stackTitles = function(stack) {
    var out = [];
    for (var i = 0; i < stack.sections.length; i++) {
        out.push(stack.sections[i].title);
    }
    return out;
};

/**
 * Adds a section to a stack and gives its header the move menu.
 *
 * The caller still adds the box to the layout itself, in the order it
 * wants; applyOrder below rearranges to the caver's saved order once
 * everything is in.
 */
CsPanel.stackAdd = function(stack, section, title) {
    section.title = title;
    // The section's way back to its stack -- connectSection's closure
    // uses it to ask for a relayout when this section folds or
    // unfolds, so a fold can hand its row to the others instead of
    // sitting on it (2026-09-12).
    section.stack = stack;
    stack.sections.push(section);
    if (isNull(section.header)) {
        return;
    }
    try {
        section.header.contextMenuPolicy = Qt.CustomContextMenu;
        section.header.customContextMenuRequested.connect(function(pos) {
            try {
                var menu = new QMenu();
                var up = menu.addAction(qsTr("Move Up"));
                up.enabled = (CsPanel.indexOfSection(stack, section) > 0);
                up.triggered.connect(function() {
                    CsPanel.moveSection(stack, section, -1);
                });
                var down = menu.addAction(qsTr("Move Down"));
                down.enabled = (CsPanel.indexOfSection(stack, section) <
                    stack.sections.length - 1);
                down.triggered.connect(function() {
                    CsPanel.moveSection(stack, section, 1);
                });
                menu.addSeparator();
                var reset = menu.addAction(qsTr("Reset Order"));
                reset.triggered.connect(function() {
                    CsPanel.resetOrder(stack);
                });
                // Kept alive: popup() returns at once and a collected
                // menu simply vanishes mid-display.
                stack.menu = menu;
                menu.popup(section.header.mapToGlobal(pos));
            } catch (eMenu) {
                // no menu on this bridge: the sections keep the order
                // the panel built them in, which is a working panel
            }
        });
    } catch (ePolicy) {
    }
};

/** Where a section sits in its stack, or -1. */
CsPanel.indexOfSection = function(stack, section) {
    for (var i = 0; i < stack.sections.length; i++) {
        if (stack.sections[i] === section) {
            return i;
        }
    }
    return -1;
};

/** Moves one section up or down and remembers the new order. */
CsPanel.moveSection = function(stack, section, delta) {
    var at = CsPanel.indexOfSection(stack, section);
    var to = at + delta;
    if (at < 0 || to < 0 || to >= stack.sections.length) {
        return;
    }
    stack.sections.splice(at, 1);
    stack.sections.splice(to, 0, section);
    CsPanel.relayout(stack);
    CsPanel.saveOrder(stack.settingKey, CsPanel.stackTitles(stack));
};

/** Forgets the caver's order; the panel's own returns on next build. */
CsPanel.resetOrder = function(stack) {
    CsPanel.saveOrder(stack.settingKey, []);
    if (typeof stack.onChanged === "function") {
        stack.onChanged();
    }
};

/** Rearranges a stack's boxes in the layout to match its own order.
 *
 *  Two shapes: a plain column, which is every existing caller, uses
 *  `insertWidget` at the section's index past `baseIndex`. A grid
 *  (`stack.columns` set) instead removes and re-adds each box at the
 *  row/column `gridPlan` gives it, and sets each occupied row's stretch
 *  to what `gridPlan` says -- 0 for a folded section's strip, 1 for a
 *  row of unfolded ones, so a fold hands its share of the dock's height
 *  to whatever is left (Nathan, 2026-09-12; gridPlan's own comment has
 *  the reversal this undid).
 *
 *  A GHOST ROW HOLDS HEIGHT FOREVER. `setRowStretch` has no "unset" --
 *  the only way to take a row's stretch back is to set it to 0
 *  explicitly. So this remembers which rows it stretched last time
 *  (`stack._plannedRows`) and zeroes any that this pass did not reuse:
 *  without that, fold-unfold-fold left the FIRST fold's row still
 *  claiming height under the second, because nothing had ever told the
 *  layout to let go of it.
 *
 *  THE CHOICE HERE: an ugly grid over a missing section. A caver whose
 *  Symbols section evaporated cannot work; one whose grid came out as a
 *  single ragged column still can. So nothing in the grid branch is
 *  allowed to simply stop partway through and leave a box neither
 *  placed nor tracked -- every section gets a recovery attempt at a
 *  plain 1x1 cell if its real spot did not take, whether that is
 *  because `removeWidget` does not exist on this bridge or because the
 *  five-argument `addWidget` refused one particular box. Only a box
 *  that refuses BOTH attempts is left to the bridge's own layout
 *  machinery, which by then has already been told about it twice.
 *
 *  TEST COVERAGE. `tests/js_unit.js` proves two different things about
 *  this: a real QGridLayout (guarded by `typeof QWidget`, since the
 *  node fallback has no widget bridge at all) shows the 5-argument
 *  `addWidget` and the `baseIndex` row offset actually land where
 *  `gridPlan` says, and a mock layout proves the recovery pass fires
 *  when `removeWidget`/`addWidget` throw -- CaveCAD's own bridge never
 *  refused either in testing, so that path is exercised by the mock,
 *  not the live one. The right-click Move Up/Down driving a grid stack
 *  end to end is not simulated here; that is Task 13's live check. */
CsPanel.relayout = function(stack) {
    var i;
    if (isNull(stack.columns)) {
        try {
            for (i = 0; i < stack.sections.length; i++) {
                stack.layout.removeWidget(stack.sections[i].box);
            }
            for (i = 0; i < stack.sections.length; i++) {
                stack.layout.insertWidget(stack.baseIndex + i,
                    stack.sections[i].box, 0, 0);
            }
        } catch (e) {
            // a bridge without insertWidget leaves the order alone,
            // which is the panel's own order -- untidy, never broken
        }
        return;
    }
    // Removal is best-effort and NEVER aborts the rest of the function:
    // a bridge that throws partway through still gets every section
    // handed to the add loop below, whether or not it actually left the
    // layout.
    try {
        for (i = 0; i < stack.sections.length; i++) {
            stack.layout.removeWidget(stack.sections[i].box);
        }
    } catch (eRemove) {
    }
    var items = [];
    for (i = 0; i < stack.sections.length; i++) {
        items.push({ folded: CsPanel.isFolded(stack.sections[i]) });
    }
    var plan = CsPanel.gridPlan(items, stack.columns);
    var placed = [];
    var rowsUsed = {};
    for (i = 0; i < stack.sections.length; i++) {
        placed.push(false);
        try {
            stack.layout.addWidget(stack.sections[i].box,
                stack.baseIndex + plan[i].row, plan[i].col, 1,
                plan[i].span);
            placed[i] = true;
            rowsUsed[stack.baseIndex + plan[i].row] = plan[i].stretch;
        } catch (eAdd) {
            // the grid placement refused this one box; recovered below
        }
    }
    for (i = 0; i < stack.sections.length; i++) {
        if (placed[i]) {
            continue;
        }
        try {
            // Spans be damned -- a plain cell of its own beats a
            // section that vanished from the panel.
            stack.layout.addWidget(stack.sections[i].box,
                stack.baseIndex + i, 0, 1, 1);
            rowsUsed[stack.baseIndex + i] = plan[i].stretch;
        } catch (eRecover) {
            // both attempts refused: nothing more this function can do
        }
    }
    var prevRows = isNull(stack._plannedRows) ? {} : stack._plannedRows;
    var r;
    try {
        for (r in rowsUsed) {
            if (rowsUsed.hasOwnProperty(r)) {
                stack.layout.setRowStretch(parseInt(r, 10), rowsUsed[r]);
            }
        }
        for (r in prevRows) {
            if (prevRows.hasOwnProperty(r) && !rowsUsed.hasOwnProperty(r)) {
                // This row served a PREVIOUS relayout (an unfolded row
                // that has since folded away, say) and is not part of
                // this one -- let its height go rather than leave it a
                // ghost still claiming a share of the dock.
                stack.layout.setRowStretch(parseInt(r, 10), 0);
            }
        }
    } catch (eStretch) {
        // a bridge without setRowStretch leaves every row at its
        // natural height -- untidy, never broken
    }
    stack._plannedRows = rowsUsed;
};

/** Puts a freshly built stack into the caver's saved order. */
CsPanel.applyOrder = function(stack) {
    var saved = CsPanel.loadOrder(stack.settingKey);
    if (saved.length === 0) {
        return;
    }
    var wanted = CsPanel.orderedTitles(CsPanel.stackTitles(stack), saved);
    var byTitle = {};
    var i;
    for (i = 0; i < stack.sections.length; i++) {
        byTitle[stack.sections[i].title] = stack.sections[i];
    }
    var reordered = [];
    for (i = 0; i < wanted.length; i++) {
        if (!isNull(byTitle[wanted[i]])) {
            reordered.push(byTitle[wanted[i]]);
        }
    }
    if (reordered.length !== stack.sections.length) {
        return;   // something is missing; leave the panel as built
    }
    stack.sections = reordered;
    CsPanel.relayout(stack);
};

/**
 * A grid laid out for a PANEL rather than for a page: labels at the
 * left at their natural width, fields beside them, and the slack given
 * to a column past the last one.
 *
 * A grid whose last real column stretches spreads a spin box across the
 * whole dock and leaves its label stranded at the far side -- which is
 * exactly what the first pass at this looked like.
 */
CsPanel.formGrid = function(fieldColumns) {
    var grid = new QGridLayout();
    try {
        grid.setContentsMargins(4, 4, 4, 4);
        grid.setHorizontalSpacing(6);
        grid.setVerticalSpacing(4);
        grid.setColumnStretch(isNull(fieldColumns) ? 2 : fieldColumns, 1);
    } catch (e) {
    }
    return grid;
};

/** How many tiles a Recent row keeps. Five, because cave work is a
 *  handful of features repeated a thousand times -- and because a row
 *  that scrolls is a second list to search rather than a shortcut. */
CsPanel.RECENT_MAX = 5;

/**
 * The recently-used keys for a panel, most recent first.
 *
 * Stored as one settings string per panel -- the same shape as the
 * collapsed-sections memory above, and for the same reason: a caver's
 * six features are the same six tomorrow, so this is worth surviving a
 * restart. Keys are opaque to this file; each panel decides what a key
 * means (a layer name, a style, a block name) and how to draw it.
 */
CsPanel.loadRecent = function(settingKey) {
    var out = [];
    try {
        var raw = RSettings.getStringValue(settingKey, "");
        if (raw !== "") {
            var parts = String(raw).split(",");
            for (var i = 0; i < parts.length; i++) {
                var key = parts[i].trim();
                if (key !== "" && out.length < CsPanel.RECENT_MAX) {
                    out.push(key);
                }
            }
        }
    } catch (e) {
        // a bridge without settings forgets between sessions, which is
        // a panel with no Recent row rather than a panel that fails
    }
    return out;
};

/**
 * Notes that `key` was just used, and answers the new list.
 *
 * MOVE TO FRONT, not append: a caver who comes back to walls after four
 * other features wants walls first, and a list that only grew would
 * push it off the end while they were using it.
 *
 * A key with a comma in it would split into two on the way back and is
 * refused rather than stored -- no layer name, style key or block name
 * in this suite has one, and a key that did would quietly corrupt the
 * whole row.
 */
CsPanel.noteRecent = function(settingKey, key) {
    var current = CsPanel.loadRecent(settingKey);
    if (key === null || key === undefined || String(key) === "" ||
            String(key).indexOf(",") !== -1) {
        return current;
    }
    var next = [String(key)];
    for (var i = 0; i < current.length; i++) {
        if (current[i] !== String(key) && next.length < CsPanel.RECENT_MAX) {
            next.push(current[i]);
        }
    }
    try {
        RSettings.setValue(settingKey, next.join(","));
    } catch (e) {
        // not remembered across sessions; still right for this one
    }
    return next;
};

/** Empties a layout of its widgets, so a row can be rebuilt in place.
 *  The widgets are hidden as well as removed: a bridge that keeps a
 *  removed widget parented would otherwise leave it floating over the
 *  panel. */
CsPanel.clearLayout = function(layout) {
    if (isNull(layout)) {
        return;
    }
    try {
        while (layout.count() > 0) {
            var item = layout.takeAt(0);
            if (isNull(item)) {
                break;
            }
            var widget = item.widget();
            if (!isNull(widget)) {
                widget.visible = false;
                widget.setParent(null);
            }
        }
    } catch (e) {
        // a bridge without takeAt keeps the old row; it is stale rather
        // than wrong, and the tiles below it still work
    }
};

// ---------------------------------------------------------------------
// TILE TOOLTIPS -- the one place a beginner is told what a symbol or a
// feature actually MEANS.
//
// Both palettes had mechanical tooltips: a name, a block, a layer.
// True, and no use to anyone who does not already know the NSS set.
// The prose lives in CsHelp; this is how a tile wears it, and it lives
// here so the two panels cannot drift into two different tooltips.
//
// RICH TEXT, WITH OUR OWN WRAPPING. Qt renders a tooltip as HTML the
// moment it contains a tag, which is what lets the rule stand out from
// the description -- but an HTML tooltip is laid out on ONE line until
// something breaks it, and Qt has no honoured width for a tooltip
// (a CSS width on a <p> is ignored; the documented workaround is a
// table, which then styles the whole thing). So the text is wrapped
// here, by word, and the breaks are <br>. Cheap, and it looks the same
// on every platform.
// ---------------------------------------------------------------------

/** How wide a wrapped tooltip line gets, in characters. Chosen so the
 *  longest rule in CsHelp comes out three lines rather than five. */
CsPanel.TIP_CHARS = 46;

/** Wraps text to a character budget, returning the LINES. Same greedy
 *  fill FeatureTrace.wrapLabel uses on a tile's own label; a word
 *  longer than the budget gets a line of its own rather than being
 *  cut. */
CsPanel.wrapLines = function(text, budget) {
    var words = String(text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") {
            continue;
        }
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines;
};

/** The five characters that would otherwise be read as markup. Applied
 *  to every piece of text that reaches the tooltip, including catalogue
 *  names -- a caver may name their own symbol "<3". */
CsPanel.escapeHtml = function(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

/**
 * One tile's tooltip.
 *
 *   title   the feature or symbol name -- bold, always present.
 *   help    a CsHelp entry ({means, rule}) or null. Null is the custom
 *           symbol case and simply leaves those lines out.
 *   detail  the mechanical lines that were the whole tooltip before
 *           this existed (block, layer, "your own symbol"), printed
 *           small and last. An array; empty is fine.
 *
 * \return an HTML string for QWidget.toolTip.
 */
CsPanel.tipHtml = function(title, help, detail) {
    var parts = ["<b>" + CsPanel.escapeHtml(title) + "</b>"];
    var wrap = function(text) {
        var lines = CsPanel.wrapLines(text, CsPanel.TIP_CHARS);
        for (var i = 0; i < lines.length; i++) {
            lines[i] = CsPanel.escapeHtml(lines[i]);
        }
        return lines.join("<br>");
    };
    if (!isNull(help)) {
        if (!isNull(help.means) && help.means !== "") {
            parts.push(wrap(help.means));
        }
        // The rule is the half that gets a map marked down, so it is
        // the half that has to survive being skim-read.
        if (!isNull(help.rule) && help.rule !== "") {
            parts.push("<i>" + wrap(help.rule) + "</i>");
        }
    }
    if (!isNull(detail)) {
        var kept = [];
        for (var d = 0; d < detail.length; d++) {
            if (isNull(detail[d]) || String(detail[d]) === "") {
                continue;
            }
            kept.push(wrap(detail[d]));
        }
        if (kept.length > 0) {
            parts.push("<span style='color:gray'>" +
                kept.join("<br>") + "</span>");
        }
    }
    return parts.join("<br><br>");
};

/**
 * The small `?` a panel puts in its header, wired to the handbook.
 *
 * ONE HELPER, NOT ONE PER PANEL. A panel feature written twice drifts:
 * the fold headers and the scan browser are here for the same reason,
 * and a ? that is a different size or opens a different way on each
 * panel teaches a student that the suite is several programs.
 *
 * The press opens the Handbook dock at the page documenting `folder`
 * (a tool folder name, "FeatureTrace"), or at the contents when that
 * tool has no page -- a parked tool has none by design, and a panel
 * whose ? did nothing at all would read as broken.
 *
 * Returns null when this build has no Handbook tool, so a caller can
 * simply not add the button. Panels must tolerate that: the handbook
 * is a separate tool folder and a stripped build may not carry it.
 *
 * \param folder the tool folder the panel belongs to
 * \param label  what the page is called, for the tooltip
 */
CsPanel.helpButton = function(folder, label) {
    // The Handbook tool is NOT required to exist yet. A panel's dock is
    // built during init, and the order tools are init'd in is not ours
    // to rely on -- measured 2026-09-13: Draw's dock is built while
    // Handbook is still undefined, so a guard here attached no button
    // to the busiest panel in the suite and one to every other. The
    // press is what needs the tool, and by then it is loaded.
    var button = new QPushButton("?");
    button.toolTip = qsTr("What this panel is for, and how to use it: " +
        "opens the handbook at ") + String(label) + ".";
    button.flat = true;
    try {
        button.setMaximumWidth(22);
        button.setMaximumHeight(22);
    } catch (eSize) {
        // a bridge without the setters gets a full-sized button, which
        // is ugly and still opens the right page
    }
    button.clicked.connect(function() {
        if (typeof(Handbook) === "undefined") {
            CsTell.warn(qsTr("This build has no Handbook tool installed, so " +
                "there is nothing for the ? to open."));
            return;
        }
        try {
            var page = CsHandbook.forTool(folder);
            Handbook.open(page);
            if (page === null) {
                Handbook.showContents();
            }
        } catch (e) {
            // the handbook refusing to open must never take the panel
            // that hosts the button down with it
        }
    });
    return button;
};

/**
 * Put the `?` in a panel's top-right corner.
 *
 * One line at the end of a buildDock, rather than a header row every
 * panel builds for itself: the button then sits in the same place, the
 * same size, on every panel in the suite -- and a panel that grows a
 * header of its own later does not have to remember to keep it.
 *
 * `dock` is the QDockWidget, whose widget's layout the row goes into at
 * the top. A bridge that will not insert at the top gets it at the
 * bottom, which is worse and still works; a bridge with no Handbook
 * tool gets nothing at all.
 *
 * \return the button, or null when nothing was attached
 */
CsPanel.attachHelp = function(dock, folder, label) {
    var button = CsPanel.helpButton(folder, label);
    if (button === null) {
        CsPanel.makeScrollable(dock);
        return null;
    }
    try {
        // WRAP, do not reach into the panel's own layout. Measured
        // 2026-09-13: Draw's body is a QGridLayout, which has no
        // insertLayout and whose addLayout takes a row and a column --
        // so a version of this that inserted into the existing layout
        // silently attached nothing on exactly the busiest panel. A
        // wrapper works whatever the body is laid out with.
        var body = dock.widget();
        var wrapper = new QWidget(dock);
        var stack = new QVBoxLayout();
        stack.setContentsMargins(0, 0, 0, 0);
        stack.setSpacing(2);
        var row = new QHBoxLayout();
        row.setContentsMargins(0, 0, 4, 0);
        row.addStretch(1);
        row.addWidget(button, 0, 0);
        stack.addLayout(row, 0);
        stack.addWidget(body, 1, 0);
        wrapper.setLayout(stack);
        dock.setWidget(wrapper);
    } catch (e) {
        CsPanel.makeScrollable(dock);
        return null;
    }
    CsPanel.makeScrollable(dock);
    return button;
};

/** The objectName makeScrollable gives its scroll area. */
CsPanel.SCROLL_NAME = "CsPanelScroll";

/**
 * Let the panel be ANY size (Nathan, 2026-09-27: "every panel needs to
 * be freely resizable ... if buttons and fields need a minimum size,
 * then the resized panel gets scrollbars").
 *
 * A dock can never be smaller than its widget's minimum size, and a
 * panel full of rows adds up to a big one -- Sketch Scans measured 656
 * x 511, Sheet Setup 432 x 491 -- which held the whole column of docks
 * that wide. Inside a scroll area the panel's own minimum stops
 * mattering to the dock: the area shrinks freely and scrolls whatever
 * no longer fits. widgetResizable keeps the panel filling the area
 * whenever there IS room, so nothing changes for a panel given space.
 *
 * Call it LAST in a buildDock, after dock.setWidget; attachHelp does,
 * so every panel with a ? gets it for free. Idempotent: a dock already
 * wrapped is left alone. A bridge without QScrollArea keeps the panel
 * as it was, which is a panel with a minimum size rather than none.
 *
 * \return the scroll area, or null when the dock was left as it was
 */
CsPanel.makeScrollable = function(dock) {
    try {
        var body = dock.widget();
        if (isNull(body)) {
            return null;
        }
        if (String(body.objectName) === CsPanel.SCROLL_NAME) {
            return body;
        }
        var area = new QScrollArea(dock);
        area.objectName = CsPanel.SCROLL_NAME;
        // METHODS, NOT PROPERTIES: the bridge treats several QScrollArea
        // properties as read-only (DrawPanel's section scrollers, probed
        // 2026-09-12).
        area.setWidgetResizable(true);
        try {
            area.setFrameShape(QFrame.NoFrame);
        } catch (eFrame) {
            // a frame round the panel is cosmetic
        }
        try {
            area.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded);
            area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded);
        } catch (ePolicy) {
        }
        area.setWidget(body);
        dock.setWidget(area);
        return area;
    } catch (e) {
        return null;
    }
};
