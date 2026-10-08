// ShapedSync.js -- Sync Shaped Lines: regenerate decoration by hand.
// The manual fallback for everything the listener normally does live
// (headless edits, a listener that failed to install, a drawing edited
// by an older build) -- the CsCalloutSync precedent, feature for feature.
//
// Selection selected -> only those features. Nothing selected -> every
// shaped line in the drawing, plus a sweep for orphaned decoration
// whose spine is gone.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function ShapedSync(guiAction) {
    EAction.call(this, guiAction);
}

ShapedSync.prototype = new EAction();

/** Every distinct ShapeId in the drawing, spines AND decor -- decor
 *  ids without a spine are exactly the orphans the sweep must find. */
ShapedSync.allIds = function(doc) {
    var seen = {};
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid === "") {
            sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
        }
        if (sid !== "" && !seen[sid]) {
            seen[sid] = true;
            out.push(sid);
        }
    }
    return out;
};

ShapedSync.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }

    var sids = doc.hasSelection() ? CsShapeLine.selectionIds(doc)
                                  : ShapedSync.allIds(doc);

    if (sids.length === 0) {
        EAction.handleUserMessage(qsTr("No shaped lines found."));
        this.terminate();
        return;
    }

    var counts = { reflowed: 0, unchanged: 0, "orphans-removed": 0,
                   unlinked: 0, nothing: 0 };
    var hadListener = (typeof ShapedLinesListener !== "undefined");
    if (hadListener) {
        ShapedLinesListener.busy = true;
    }
    try {
        for (var i = 0; i < sids.length; i++) {
            try {
                var r = CsShapeLine.reconcile(doc, di, sids[i], null);
                if (counts[r] !== undefined) {
                    counts[r]++;
                }
            } catch (eOne) {
                // one broken feature must not stop the rest
            }
        }
    } finally {
        if (hadListener) {
            ShapedLinesListener.busy = false;
        }
    }

    EAction.handleUserMessage(qsTr(
        "Shaped lines: %1 rebuilt, %2 unchanged, %3 orphan sets removed.")
        .arg(counts.reflowed).arg(counts.unchanged)
        .arg(counts["orphans-removed"]));
    this.terminate();
};

ShapedSync.init = function(basePath) {
    var syncAction = new RGuiAction(qsTr("Sync Shaped Lines"),
        RMainWindowQt.getMainWindow());
    syncAction.setRequiresDocument(true);
    syncAction.setScriptFile(basePath + "/ShapedSync.js");
    syncAction.setIcon(basePath + "/ShapedSync.svg");
    syncAction.setStatusTip(qsTr("Rebuild decoration on the selected " +
        "shaped lines, or on every one in the drawing"));
    syncAction.setDefaultCommands(["shapedsync", "shs"]);
    syncAction.setGroupSortOrder(450);
    syncAction.setSortOrder(38);
    // The Cave Lines toolbar is gone; this keeps its command and
    // its place in the suite's own menu.
    syncAction.setWidgetNames([]);
};
