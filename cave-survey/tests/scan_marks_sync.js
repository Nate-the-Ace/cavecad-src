// scan_marks_sync.js -- one Complete mark, two panels.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_marks_sync.js "$PWD"
//
// Prints "### SCAN MARKS OK" / "### SCAN MARKS FAIL".
//
// THE BUG THIS EXISTS FOR. Sketch Scans and the Survey Notebook each
// kept their own copy of the completed set, loaded when they filled
// their list, and wrote the WHOLE copy back on every toggle. So a page
// marked in one panel was undone the moment the other marked anything:
// its copy predated the tick (Nathan, 2026-09-11, "'Mark Complete' is
// getting out of sync between the different pallets").
//
// REAL RSettings, not a stub: the whole mechanism IS the round trip
// through settings, and a stub would prove the bookkeeping while the
// panels went on disagreeing. Every key written here is scoped to a
// scans folder that does not exist, and removed at the end.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
function loadRepoScript(rel) {
    var f = new QFile(repoRoot + "/" + rel);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var st = new QTextStream(f);
    var src = String(st.readAll());
    f.close();
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsScanTree", "CsScanList"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

var checks = 0;
var failures = [];
function ok(cond, what) {
    checks++;
    if (cond !== true) { failures.push(what); }
}
function eqs(got, want, what) {
    ok(got === want, what + " (got " + got + ", wanted " + want + ")");
}

// A folder nothing else can collide with, so this test's writes are
// its own and can be taken back.
var FOLDER = "/tmp/cavecad-scan-marks-test-" + (new Date()).getTime();
var PAGES = ["TripA/p1.jpg", "TripA/p2.jpg", "TripB/p1.jpg"];

function clear() {
    var map = CsScanTree.parseCollapsed(RSettings.getStringValue(
        CsScanTree.SETTING_BOOKMARKS, ""));
    delete map[FOLDER];
    RSettings.setValue(CsScanTree.SETTING_BOOKMARKS,
        CsScanTree.serializeCollapsed(map));
}
clear();

// ---------------------------------------------------------------------
// 1. A mark round-trips through the store.
// ---------------------------------------------------------------------
var set = CsScanList.toggleComplete(FOLDER, PAGES[0], PAGES);
ok(set[PAGES[0]] === true, "toggleComplete marks the page it was given");
ok(CsScanList.loadComplete(FOLDER)[PAGES[0]] === true,
    "and a fresh read sees it");

// ---------------------------------------------------------------------
// 2. THE BUG: a stale copy cannot undo somebody else's mark.
// ---------------------------------------------------------------------
//
// Panel B filled its list BEFORE panel A ticked page 1. It then ticks
// page 3. Before the fix, B's whole-set write carried its stale idea of
// page 1 -- untouched -- back to disk and the tick vanished.
var staleB = CsScanList.loadComplete(FOLDER);   // holds page 1
CsScanList.toggleComplete(FOLDER, PAGES[1], PAGES);  // A ticks page 2
ok(staleB[PAGES[1]] !== true,
    "fixture: panel B's copy predates the second mark");

CsScanList.toggleComplete(FOLDER, PAGES[2], PAGES);  // B ticks page 3
var after = CsScanList.loadComplete(FOLDER);
ok(after[PAGES[0]] === true, "the first mark survives a later toggle");
ok(after[PAGES[1]] === true, "and so does the mark B never knew about");
ok(after[PAGES[2]] === true, "and B's own mark is there");

// ---------------------------------------------------------------------
// 3. Unmarking takes one page off and leaves the rest.
// ---------------------------------------------------------------------
var off = CsScanList.toggleComplete(FOLDER, PAGES[1], PAGES);
ok(off[PAGES[1]] !== true, "toggling a marked page unmarks it");
ok(off[PAGES[0]] === true, "without touching the others");
eqs(CsScanList.loadComplete(FOLDER)[PAGES[1]], undefined,
    "and the store agrees");

// ---------------------------------------------------------------------
// 4. Pages that are gone fall out; a caller with no list keeps them.
// ---------------------------------------------------------------------
CsScanList.toggleComplete(FOLDER, PAGES[2], [PAGES[2]]);  // only p3 listed
var pruned = CsScanList.loadComplete(FOLDER);
ok(pruned[PAGES[0]] !== true,
    "a mark on a page the panel no longer lists is pruned");

CsScanList.toggleComplete(FOLDER, PAGES[0], PAGES);
var keptAll = CsScanList.loadComplete(FOLDER);
CsScanList.toggleComplete(FOLDER, PAGES[1], null);   // no list at all
var kept = CsScanList.loadComplete(FOLDER);
ok(kept[PAGES[0]] === true,
    "a caller that lists nothing prunes nothing -- every mark stands");
ok(kept[PAGES[1]] === true, "including the one it just made");

// ---------------------------------------------------------------------
// 5. A write announces itself, so the other panel repaints.
// ---------------------------------------------------------------------
var heard = [];
CsScanList.watch("panelA", function(folder) { heard.push("A:" + folder); });
CsScanList.watch("panelB", function(folder) { heard.push("B:" + folder); });
CsScanList.toggleComplete(FOLDER, PAGES[2], PAGES);
eqs(heard.length, 2, "both panels hear about a mark");
ok(heard.join(",").indexOf(FOLDER) !== -1,
    "and are told which cave's scans moved");

// ONE SLOT PER KEY: a panel that rebuilds replaces its own callback.
heard = [];
CsScanList.watch("panelA", function(folder) { heard.push("A2"); });
CsScanList.toggleComplete(FOLDER, PAGES[2], PAGES);
eqs(heard.length, 2, "re-registering replaces rather than stacks");
ok(heard.indexOf("A2") !== -1, "and it is the new callback that runs");

// A watcher whose widgets have gone must not stop the live panel.
CsScanList.watch("dead", function() { throw new Error("gone"); });
heard = [];
CsScanList.toggleComplete(FOLDER, PAGES[2], PAGES);
ok(heard.length === 2, "a throwing watcher does not stop the others");
CsScanList.toggleComplete(FOLDER, PAGES[2], PAGES);
ok(isNull(CsScanList.watchers["dead"]),
    "and it is dropped rather than throwing every time");

// ---------------------------------------------------------------------
// 6. THE SELECTED PAGE, the other half of a browser's state.
// ---------------------------------------------------------------------
//
// The two panels browse one folder and used to sit on different pages
// in it: only Sketch Scans remembered a selection, and neither told
// the other when it moved. While tracing, one pane holds the page
// being read and the other the page being placed -- the same page.
function clearSelection() {
    var map = CsScanTree.parseCollapsed(RSettings.getStringValue(
        CsScanTree.SETTING_SELECTED, ""));
    delete map[FOLDER];
    RSettings.setValue(CsScanTree.SETTING_SELECTED,
        CsScanTree.serializeCollapsed(map));
}
clearSelection();
CsScanList.selectionWatchers = {};

ok(CsScanList.selectedIn(FOLDER) === null,
    "a cave nobody has browsed has no remembered page");

var told = [];
CsScanList.watchSelection("panelA", function(folder, rel) {
    told.push("A:" + rel);
});
CsScanList.watchSelection("panelB", function(folder, rel) {
    told.push("B:" + rel);
});

// THE PANEL THAT MOVED IS NOT TOLD ABOUT ITS OWN MOVE. It is already
// there, and selecting a row from inside a selection handler is how a
// signal loop starts.
CsScanList.selectionMoved(FOLDER, PAGES[1],
    [{ kind: "file", rel: PAGES[0] }, { kind: "file", rel: PAGES[1] },
     { kind: "file", rel: PAGES[2] }], "panelA");
eqs(told.length, 1, "only the other panel is told");
eqs(told[0], "B:" + PAGES[1], "and it is told which page");
eqs(CsScanList.selectedIn(FOLDER), PAGES[1],
    "the page is remembered for the cave");

// It survives both panels closing: that is what the store is for.
told = [];
CsScanList.selectionWatchers = {};
eqs(CsScanList.selectedIn(FOLDER), PAGES[1],
    "and outlives the panels that were showing it");

// A page that is no longer in the folder is pruned, as a mark is.
CsScanList.selectionMoved(FOLDER, PAGES[2],
    [{ kind: "file", rel: PAGES[2] }], "panelA");
eqs(CsScanList.selectedIn(FOLDER), PAGES[2], "the new page is stored");
CsScanList.selectionMoved(FOLDER, PAGES[2], [], "panelA");
ok(CsScanList.selectedIn(FOLDER) !== PAGES[0],
    "a selection naming a page the tree no longer lists does not stand");

// A watcher whose widgets have gone is dropped, not thrown from.
CsScanList.selectionWatchers = {};
told = [];
CsScanList.watchSelection("live", function(folder, rel) {
    told.push(rel);
});
CsScanList.watchSelection("dead", function() { throw new Error("gone"); });
CsScanList.selectionMoved(FOLDER, PAGES[0], null, "panelA");
eqs(told.length, 1, "a throwing selection watcher does not stop the others");
CsScanList.selectionMoved(FOLDER, PAGES[0], null, "panelA");
ok(isNull(CsScanList.selectionWatchers["dead"]),
    "and it is dropped rather than throwing every time");

CsScanList.selectionWatchers = {};
clearSelection();
var selMap = CsScanTree.parseCollapsed(RSettings.getStringValue(
    CsScanTree.SETTING_SELECTED, ""));
ok(isNull(selMap[FOLDER]),
    "the selection test takes its own settings back too");

CsScanList.watchers = {};
clear();
var goneMap = CsScanTree.parseCollapsed(RSettings.getStringValue(
    CsScanTree.SETTING_BOOKMARKS, ""));
ok(isNull(goneMap[FOLDER]), "the test takes its own settings back");

if (failures.length === 0) {
    print("### SCAN MARKS OK " + checks + " assertions");
} else {
    print("### SCAN MARKS FAIL");
    for (var i = 0; i < failures.length; i++) {
        print("  - " + failures[i]);
    }
}
