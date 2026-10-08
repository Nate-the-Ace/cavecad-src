// merge_custom_symbols.js -- carry a caver's OWN symbols across a
// template upgrade.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/merge_custom_symbols.js "$REPO" <new> <old>
//
// <new> is the freshly installed template, <old> a copy of the one it
// replaced. Every SYM_ block in <old> that the shipped catalogue does
// NOT name is copied into <new>, marker point and all, and <new> is
// written back.
//
// WHY THIS EXISTS. Symbol Palette writes a caver's own symbols into
// NSS_Cave_Template_PLAN.dxf, and publish.sh replaces that file
// wholesale on every release. The loss was accepted as a known cost on
// 2026-09-06 and cost a real symbol -- a mud slope, drawn and saved --
// within the day, because a development machine publishes many times an
// hour. Backing the old template up made it recoverable by hand; this
// makes it not need recovering.
//
// THE SHIPPED 28 ARE NEVER MERGED. They are code (Core/CsSymbols.js
// CATALOG) and the new template's copies are the current ones. Only
// blocks the catalogue has never heard of come across, which is exactly
// the set a caver drew.

var args = RSettings.getOriginalArguments();
var repoRoot = null, newPath = null, oldPath = null;
for (var i = 0; i < args.length; i++) {
    if (String(args[i]).indexOf("merge_custom_symbols.js") !== -1) {
        repoRoot = args[i + 1];
        newPath = args[i + 2];
        oldPath = args[i + 3];
        break;
    }
}

if (repoRoot === null || newPath === undefined || oldPath === undefined) {
    print("### MERGE FAIL usage: merge_custom_symbols.js <repo> <new> <old>");
} else {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
    include("scripts/simple.js");
    includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
    include(includeBasePath + "/CsAll.js");

    merge(newPath, oldPath);
}

function merge(newPath, oldPath) {
    if (!new QFileInfo(oldPath).exists()) {
        print("### MERGE OK 0 (no previous template)");
        return;
    }
    if (!new QFileInfo(newPath).exists()) {
        print("### MERGE FAIL new template missing: " + newPath);
        return;
    }

    var oldDi = CsSymbolStore.openOffscreen(oldPath);
    if (oldDi === null) {
        print("### MERGE FAIL cannot read " + oldPath);
        return;
    }
    var oldDoc = oldDi.getDocument();

    // What the caver drew: SYM_ blocks the shipped catalogue does not
    // name. Read from the block table rather than from the marker,
    // because a symbol whose marker was lost is still theirs.
    var mine = [];
    var names = oldDoc.getBlockNames();
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        if (name.indexOf(CsSymbolStore.PREFIX) !== 0) {
            continue;
        }
        if (CsSymbols.byBlock(name) !== null) {
            continue;   // one of the shipped 28: the new file's is newer
        }
        mine.push(name);
    }
    if (mine.length === 0) {
        print("### MERGE OK 0 (no custom symbols to carry over)");
        return;
    }

    var newDi = CsSymbolStore.openOffscreen(newPath);
    if (newDi === null) {
        print("### MERGE FAIL cannot read " + newPath);
        return;
    }
    var newDoc = newDi.getDocument();

    var carried = [], failed = [];
    for (i = 0; i < mine.length; i++) {
        if (!isNull(newDoc.queryBlock(mine[i]))) {
            continue;   // already there; the new template wins
        }
        // copyBlock brings the geometry AND the marker point, because
        // the marker is an entity inside the block definition like any
        // other -- which is exactly why the marker lives there.
        var res = CsSymbolStore.copyBlock(oldDoc, newDoc, newDi, mine[i]);
        if (res.ok) {
            carried.push(mine[i]);
        } else {
            failed.push(mine[i] + " (" + res.error + ")");
        }
    }

    if (carried.length === 0) {
        print("### MERGE OK 0 (nothing to carry that was not already there)");
        return;
    }
    if (!CsSymbolStore.write(newDi, newPath)) {
        print("### MERGE FAIL cannot write " + newPath);
        return;
    }
    print("### MERGE OK " + carried.length + " " + carried.join(", ") +
        (failed.length > 0 ? " -- FAILED: " + failed.join("; ") : ""));
}
