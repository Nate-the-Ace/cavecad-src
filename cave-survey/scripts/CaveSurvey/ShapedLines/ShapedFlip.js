// ShapedFlip.js -- Flip Shaped Side: mirror a shaped line's ornament to
// the other side of its spine. The NSS rule is "ornament on the DOWN
// side", and only the caver knows which side is down -- this is the one
// command that question needs.
//
// Works from a selection of spines OR their decoration (a caver clicks
// the ticks as often as the line under them); either resolves to the
// spine's ShapeId.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function ShapedFlip(guiAction) {
    EAction.call(this, guiAction);
}

ShapedFlip.prototype = new EAction();

/** Flip one feature: negate ShapeSide, force a rebuild (the signature
 *  is stamped by side-blind geometry, so clear it -- a flip changes no
 *  spine coordinates and would otherwise read as "unchanged"). */
ShapedFlip.flipOne = function(doc, di, sid, group) {
    var spine = CsShapeLine.spineOf(doc, sid);
    if (isNull(spine)) {
        return false;
    }
    var side = CsShapeLine.sideOf(spine);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, String(-side));
    CsTags.remove(spine, CsShapeLine.KEY.SIG);
    var mod = new RModifyObjectsOperation();
    mod.addObject(spine, false);
    if (group !== null && group !== undefined && group >= 0) {
        mod.setTransactionGroup(group);
    }
    di.applyOperation(mod);
    return CsShapeLine.decorate(doc, di, spine, group) === "decorated";
};

ShapedFlip.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }

    var sids = CsShapeLine.selectionIds(doc);
    if (sids.length === 0) {
        EAction.handleUserMessage(qsTr("Select a shaped line (its spine " +
            "or its ticks) first, then Flip Shaped Side."));
        this.terminate();
        return;
    }

    // One fresh group so a multi-feature flip is one Ctrl+Z.
    var group = doc.getTransactionGroup() + 1;

    // The listener would hear every write below and re-reconcile ids it
    // already knows about; the busy flag makes this atomic from its
    // point of view, exactly like the listener's own writes.
    var hadListener = (typeof ShapedLinesListener !== "undefined");
    if (hadListener) {
        ShapedLinesListener.busy = true;
    }
    var flipped = 0;
    try {
        for (var i = 0; i < sids.length; i++) {
            try {
                if (ShapedFlip.flipOne(doc, di, sids[i], group)) {
                    flipped++;
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

    EAction.handleUserMessage(qsTr("Flipped %1 shaped line(s).")
        .arg(flipped));
    this.terminate();
};

ShapedFlip.init = function(basePath) {
    var flipAction = new RGuiAction(qsTr("Flip Shaped Side"),
        RMainWindowQt.getMainWindow());
    flipAction.setRequiresDocument(true);
    flipAction.setScriptFile(basePath + "/ShapedFlip.js");
    flipAction.setIcon(basePath + "/ShapedFlip.svg");
    flipAction.setStatusTip(qsTr("Mirror the selected shaped line's " +
        "ticks or scallops to the other side of its spine"));
    flipAction.setDefaultCommands(["shapedflip", "shf"]);
    flipAction.setGroupSortOrder(450);
    flipAction.setSortOrder(37);
    // The Cave Lines toolbar is gone; this keeps its command and
    // its place in the suite's own menu.
    flipAction.setWidgetNames([]);
};
