// column_arrange_run.js -- a caver's own column arrangement, against a
// REAL QTableWidget and a REAL header.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/column_arrange_run.js "$PWD"
//
// tests/js_unit.js pins the sanitising and the move planning, which are
// pure. This proves the half that only exists against Qt, and that this
// bridge is not quietly refusing any of it:
//
//   1. The header takes setSectionsMovable and reports it back.
//   2. The planned moves, made through moveSection, land the columns
//      where the plan said -- read back through visualIndex.
//   3. setColumnHidden hides and unhides, and isColumnHidden agrees.
//   4. A whole arrangement survives a round trip through RSettings.
//   5. Hiding the LAST visible column is refused: a table with nothing
//      in it reads as a broken one, and the header it would be fixed
//      from is gone with the columns.
//
// Widgets are built, never deleted here: construct-probe-deleteLater
// cycles on widgets are one of this bridge's crash modes.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {
        }
        return false;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var failures = [];
function ok(condition, what) {
    if (!condition) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var KEYS = ["trip", "date", "decl", "team", "shots", "ends"];
var LABELS = ["Trip", "Date", "Decl", "Team", "Shots", "Ends at"];
var SETTING = "CaveSurvey/ColumnArrangeTest";

// A clean slate: this round-trips through the REAL settings, and a
// leftover arrangement from a previous run would test the wrong thing.
RSettings.setValue(SETTING + "Order", "");
RSettings.setValue(SETTING + "Hidden", "");

var table = new QTableWidget(1, KEYS.length);
table.setHorizontalHeaderLabels(LABELS);
var bag = CsPanel.arrangeColumns(table, KEYS, LABELS, SETTING);
ok(bag !== null, "the header accepted an arrangement at all");

if (bag !== null) {
    var header = bag.header;
    ok(header.sectionsMovable() === true,
        "the columns can be dragged -- setSectionsMovable took");

    var visualOrder = function() {
        var slots = [];
        for (var i = 0; i < KEYS.length; i++) {
            slots[header.visualIndex(i)] = KEYS[i];
        }
        return slots.join(",");
    };
    eqs(visualOrder(), KEYS.join(","),
        "a table with nothing remembered opens in the order it was built");

    // 2. The plan lands where it said it would.
    var wanted = ["decl", "trip", "ends", "date", "team", "shots"];
    CsPanel.applyColumns(bag, { order: wanted, hidden: {} });
    eqs(visualOrder(), wanted.join(","),
        "the planned moves put every column where the arrangement " +
            "asked -- through the real moveSection, which renumbers " +
            "everything to its right as it goes");

    // 3. Hiding, and reading it back.
    CsPanel.toggleColumn(bag, "team", false);
    eqs(table.isColumnHidden(KEYS.indexOf("team")), true,
        "a column switched off is hidden");
    eqs(table.isColumnHidden(KEYS.indexOf("date")), false,
        "and only that one");
    eqs(visualOrder(), wanted.join(","),
        "hiding a column does not move anything -- showing it again " +
            "has to put it back where it was");

    // 4. Round trip through the real RSettings.
    var stored = CsPanel.loadColumns(SETTING, KEYS);
    eqs(stored.order.join(","), wanted.join(","),
        "the arrangement was remembered as keys, in visual order");
    ok(stored.hidden.team === true,
        "and so was the hidden column");

    var second = new QTableWidget(1, KEYS.length);
    second.setHorizontalHeaderLabels(LABELS);
    var bag2 = CsPanel.arrangeColumns(second, KEYS, LABELS, SETTING);
    ok(bag2 !== null, "a second table takes the arrangement too");
    if (bag2 !== null) {
        var slots2 = [];
        for (var k = 0; k < KEYS.length; k++) {
            slots2[bag2.header.visualIndex(k)] = KEYS[k];
        }
        eqs(slots2.join(","), wanted.join(","),
            "a table built later opens in the arrangement the caver " +
                "left -- which is the whole point of remembering it");
        eqs(second.isColumnHidden(KEYS.indexOf("team")), true,
            "hidden columns included");
    }

    // 5. The last one standing cannot be switched off.
    for (var h = 0; h < KEYS.length; h++) {
        if (KEYS[h] !== "date") {
            CsPanel.toggleColumn(bag, KEYS[h], false);
        }
    }
    eqs(table.isColumnHidden(KEYS.indexOf("date")), false,
        "five of six columns off leaves the sixth showing");
    CsPanel.toggleColumn(bag, "date", false);
    eqs(table.isColumnHidden(KEYS.indexOf("date")), false,
        "and the last visible column REFUSES to be hidden -- an empty " +
            "table reads as a broken one, and its header is where the " +
            "columns would be brought back from");

    // -- what cannot be typed in LOOKS like it ---------------------
    // A cell that refuses a double-click while looking identical to
    // the one beside it that accepts one reads as a broken table.
    var wash = CsPanel.readOnlyBrush(table);
    ok(wash !== null, "the table's palette yields a read-only wash");
    if (wash !== null) {
        var colour = wash.color();
        eqs(colour.alpha(), CsPanel.READ_ONLY_ALPHA,
            "the wash is faint -- a tint over the cell, not a block of " +
                "colour");
        var text = table.palette.color(QPalette.Text);
        eqs(colour.red() + "," + colour.green() + "," + colour.blue(),
            text.red() + "," + text.green() + "," + text.blue(),
            "and it is the TEXT colour, so it darkens a light table " +
                "and lightens a dark one rather than being a grey that " +
                "is only right in one theme");
    }

    var editableCell = new QTableWidgetItem("type here");
    var lockedCell = new QTableWidgetItem("counted");
    table.setItem(0, 0, editableCell);
    table.setItem(0, 1, lockedCell);
    CsPanel.markCell(table, editableCell, true);
    CsPanel.markCell(table, lockedCell, false);
    ok((editableCell.flags() & Qt.ItemIsEditable) !== 0,
        "a cell marked editable can be typed in");
    ok((lockedCell.flags() & Qt.ItemIsEditable) === 0,
        "and one marked read-only cannot");
    var lockedBrush = lockedCell.background();
    ok(!isNull(lockedBrush) && lockedBrush.color().alpha() ===
        CsPanel.READ_ONLY_ALPHA,
        "the read-only cell carries the wash -- the flag and the look " +
            "are one call, so they cannot disagree");
    var editableBrush = editableCell.background();
    var editableAlpha = isNull(editableBrush) ? 0 :
        editableBrush.color().alpha();
    ok(editableAlpha !== CsPanel.READ_ONLY_ALPHA,
        "and the editable one does not (alpha " + editableAlpha + ")");

    // The headings say it too, before anybody clicks into a column.
    CsPanel.markHeadings(table, LABELS, [true, false, false, true, false, true]);
    var dimmed = table.horizontalHeaderItem(1);
    ok(!isNull(dimmed), "a read-only heading is given an item to colour");
    if (!isNull(dimmed)) {
        eqs(String(dimmed.text()), LABELS[1],
            "carrying the label it already showed");
        var head = dimmed.foreground().color();
        var full = table.palette.color(QPalette.Text);
        ok(head.red() !== full.red() || head.green() !== full.green() ||
            head.blue() !== full.blue(),
            "and written dimmer than a heading you can type under");
    }

    // Reset puts it back the way it shipped.
    CsPanel.resetColumns(bag);
    eqs(visualOrder(), KEYS.join(","), "Reset Columns restores the order");
    var anyHidden = false;
    for (var r = 0; r < KEYS.length; r++) {
        if (table.isColumnHidden(r) === true) { anyHidden = true; }
    }
    ok(!anyHidden, "and brings every column back");
    eqs(CsPanel.loadColumns(SETTING, KEYS).order.join(","), KEYS.join(","),
        "and is remembered, so the reset survives the next open");
}

RSettings.setValue(SETTING + "Order", "");
RSettings.setValue(SETTING + "Hidden", "");

if (failures.length === 0) {
    print("### COLUMN ARRANGE OK " + KEYS.length + " columns");
} else {
    print("### COLUMN ARRANGE FAIL " + failures.length);
    for (var f = 0; f < failures.length; f++) {
        print("  FAIL: " + failures[f]);
    }
}
