// CsSheetBlock.js -- sheet furniture as blocks: the engine plumbing the scale bar, border and sheet index share.
//
// Part of the Cave Survey Core library. (The north arrow and the title block keep their own, older copies of this
// plumbing: CsNorth.defineBlock, CsTitleBlock.draw.)
//
// A piece of furniture is ONE block reference on a layout. What it draws lives in a block DEFINITION named
// <prefix><key>; the reference's insertion point is the piece's anchor, so it can be moved, copied or deleted as one
// object and a redraw (a new scale, a new paper, a new list of sheets) rewrites the definition and never the
// reference's place.

var CsSheetBlock = {};

CsSheetBlock.safeName = function(prefix, key) {
    return String(prefix) + String(key).replace(/[<>\/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
};

/** The id of the named block definition, making it if there is none; null when it could not be made. */
CsSheetBlock.ensure = function(doc, di, name) {
    var id = doc.getBlockId(name);
    if (id === RBlock.INVALID_ID || id === undefined || id === null || id < 0) {
        di.applyOperation(new RAddObjectOperation(new RBlock(doc, name, new RVector(0, 0)), false));
        id = doc.getBlockId(name);
    }
    return (id === RBlock.INVALID_ID || id === undefined || id === null || id < 0) ? null : id;
};

/**
 * Creates or REDRAWS a block definition: what was in it is deleted and `drawFn(env)` draws it afresh, all in one
 * operation (one undo step, joined to opts.group; opts.quiet makes it non-undoable, for a sync answering an undo).
 * `env` is CsLayoutGen.envFor's: env.line / env.text take INCHES from the definition's origin.
 *
 * \return the block id, or null when the block could not be made
 */
CsSheetBlock.redefine = function(doc, di, name, drawFn, opts) {
    var o = isNull(opts) ? {} : opts;
    var id = CsSheetBlock.ensure(doc, di, name);
    if (id === null) {
        return null;
    }
    var env = CsLayoutGen.envFor(doc, di, id, isNull(o.text) ? qsTr("Draw sheet item") : o.text, "", o.quiet !== true);
    if (!isNull(o.group) && o.group >= 0) {
        env.op.setTransactionGroup(o.group);
    }
    var old = doc.queryBlockEntities(id);
    for (var i = 0; i < old.length; i++) {
        var e = doc.queryEntity(old[i]);
        if (!isNull(e)) {
            env.op.deleteObject(e);
        }
    }
    drawFn(env);
    di.applyOperation(env.op);
    return id;
};

/** A block reference to a definition, on `layerName` in the layout block `layoutBlockId`, at a point in PAPER units (not yet added). */
CsSheetBlock.reference = function(doc, di, defId, layoutBlockId, layerName, x, y) {
    CsLayers.ensure(doc, di, layerName);
    var ref = new RBlockReferenceEntity(doc, new RBlockReferenceData(defId, new RVector(x, y), new RVector(1, 1), 0.0));
    ref.setBlockId(layoutBlockId);
    ref.setLayerId(doc.getLayerId(layerName));
    return ref;
};

/** Text lines of a block definition, for comparing what it says with what it should say. */
CsSheetBlock.textsIn = function(doc, defId) {
    var out = [], ids = doc.queryBlockEntities(defId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && CsSheet.isText(e)) {
            out.push(CsSheet.textOf(e));
        }
    }
    return out;
};

/** Removes block definitions starting with `prefix` that nothing refers to any more. Never fails the caller. */
CsSheetBlock.purge = function(doc, di, prefix) {
    var removed = 0;
    try {
        var ids = doc.queryAllBlocks();
        var op = new RDeleteObjectsOperation();
        op.setText(qsTr("Remove unused sheet item blocks"));
        for (var i = 0; i < ids.length; i++) {
            var block = doc.queryBlock(ids[i]);
            if (isNull(block) || String(block.getName()).indexOf(prefix) !== 0) {
                continue;
            }
            if (doc.queryBlockReferences(ids[i]).length === 0) {
                op.deleteObject(block);
                removed++;
            }
        }
        if (removed > 0) {
            di.applyOperation(op);
        }
    }
    catch (e) {
        return 0;
    }
    return removed;
};
