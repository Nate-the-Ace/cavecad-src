// CsScaleBar.js -- a sheet's scale bar, LINKED to the viewport it measures.
//
// Part of the Cave Survey Core library.
//
// WHY LINKED (Nathan, 2026-10-05: "the scalebar on the sheet needs to follow
// the scale of the viewframe always"). A scale bar is a statement about ONE
// viewport: 1 inch of paper is so many feet of cave THERE. Draw it once at
// generation time and the first zoom inside the viewport, the first pick
// from the scale list, the first typed scale in the property editor leaves
// the bar claiming a scale the map no longer has -- the worst kind of wrong
// on a survey map, because it looks right.
//
// So the bar is bound to its viewport by a GUID the viewport carries (custom
// property CaveCAD/VpId) and every bar piece names (tag BarOf), and it
// records the scale it was drawn at (BarFpi). SheetScaleBarListener hears any
// transaction that touches a viewport and calls CsScaleBar.sync, which
// redraws the bar if -- and only if -- the viewport's scale is no longer the
// one the bar shows. The redrawn bar keeps its place: it is anchored by its
// baseline's left end, which is wherever the caver last put it.
//
// THE BAR IS ONE BLOCK (CsSheetBlock): a block reference named SCALE-BAR-<guid>, its insertion point the baseline's
// left end, tagged BarOf (the GUID) and BarFpi (the scale drawn at). A new scale REDRAWS THE BLOCK'S DEFINITION and
// never touches the reference, so the place the caver put the bar is kept by construction. Bars made as loose pieces
// by older builds are still found and read; the first time one needs redrawing it is replaced by the block.
//
// Linked bars work on AUTOMATIC and MANUAL sheets alike: a bar following its
// viewport is not a hand edit, so the sheet signature leaves bar pieces out.

var CsScaleBar = {};

CsScaleBar.LINK = "BarOf";      // tag on every piece: the viewport's GUID
CsScaleBar.FPI = "BarFpi";      // tag: feet of cave per inch the bar was drawn at
CsScaleBar.PART = "BarPart";    // tag: base | top | tick | label | caption | unit
CsScaleBar.VP_PROP_TITLE = "CaveCAD";
CsScaleBar.VP_PROP_KEY = "VpId";

/** A fresh GUID-ish id (a viewport is only compared with ids made here). */
CsScaleBar.newGuid = function() {
    var s = "";
    for (var i = 0; i < 4; i++) {
        s += Math.floor(Math.random() * 0x100000000).toString(16);
    }
    return s;
};

CsScaleBar.guidOf = function(vp) {
    var v = vp.getCustomProperty(CsScaleBar.VP_PROP_TITLE, CsScaleBar.VP_PROP_KEY);
    return isNull(v) ? "" : String(v);
};

/** Gives a viewport a GUID if it has none; returns it. */
CsScaleBar.ensureGuid = function(vp) {
    var g = CsScaleBar.guidOf(vp);
    if (g === "") {
        g = CsScaleBar.newGuid();
        vp.setCustomProperty(CsScaleBar.VP_PROP_TITLE, CsScaleBar.VP_PROP_KEY, g);
    }
    return g;
};

/** The live pieces of the bar linked to `guid` in one block. */
CsScaleBar.pieces = function(doc, blockId, guid) {
    var out = [];
    var ids = doc.queryBlockEntities(blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && CsTags.get(e, CsScaleBar.LINK) === guid) {
            out.push(e);
        }
    }
    return out;
};

/** Is this entity a piece of any linked scale bar? (The sheet signature skips them.) */
CsScaleBar.isPiece = function(entity) {
    return CsTags.get(entity, CsScaleBar.LINK) !== "";
};

CsScaleBar.BLOCK_PREFIX = "SCALE-BAR-";

CsScaleBar.blockName = function(guid) {
    return CsSheetBlock.safeName(CsScaleBar.BLOCK_PREFIX, guid);
};

/**
 * Everything the bar draws, PURE, in inches from the baseline's left end (0, 0). `d` carries the sheet's
 * dimensions (so this needs no document): { bar: CsSheetSetup.barFor(fpi), barH, tick, small, body, caption }.
 *
 * \return { lines: [{ x1, y1, x2, y2, part }], texts: [{ x, y, h, label, part }], width }
 */
CsScaleBar.parts = function(fpi, d) {
    var bar = d.bar, out = { lines: [], texts: [], width: 0 };
    var blockW = bar.perBlockFeet / fpi;           // one block is perBlockFeet of cave = this many inches of paper
    for (var k = 0; k <= bar.blocks; k++) {
        var bx = blockW * k;
        out.lines.push({ x1: bx, y1: 0, x2: bx, y2: d.barH, part: "tick" });
        out.texts.push({ x: bx, y: -d.tick * 2, h: d.small, label: String(bar.perBlock * k), part: "label" });
    }
    out.width = blockW * bar.blocks;
    out.lines.push({ x1: 0, y1: 0, x2: out.width, y2: 0, part: "base" });
    out.lines.push({ x1: 0, y1: d.barH, x2: out.width, y2: d.barH, part: "top" });
    out.texts.push({ x: 0, y: d.barH + d.body, h: d.body, label: d.caption, part: "caption" });
    out.texts.push({ x: out.width + 0.1, y: -d.tick * 2, h: d.small, label: bar.unit, part: "unit" });
    return out;
};

/** Draws the bar INTO a block definition (env is CsLayoutGen.envFor's, aimed at the definition). */
CsScaleBar.drawInto = function(env, fpi) {
    var parts = CsScaleBar.parts(fpi, { bar: CsSheetSetup.barFor(fpi), barH: CsSheetSetup.BAR.height,
        tick: CsSheetSetup.BAR.tick, small: CsSheetSetup.TEXT.small, body: CsSheetSetup.TEXT.body,
        caption: CsSheetSetup.scaleText(fpi) });
    var mark = function(entity, part) {
        CsTags.set(entity, CsScaleBar.PART, part);
        return entity;
    };
    var i;
    for (i = 0; i < parts.lines.length; i++) {
        var ln = parts.lines[i];
        mark(env.line(ln.x1, ln.y1, ln.x2, ln.y2, CsLayers.SCALE_BAR), ln.part);
    }
    for (i = 0; i < parts.texts.length; i++) {
        var tx = parts.texts[i];
        mark(env.text(tx.x, tx.y, tx.h, tx.label, CsLayers.SCALE_BAR), tx.part);
    }
};

/** (Re)draws the definition of the bar linked to `guid` at `fpi`. \return the block id, or null. */
CsScaleBar.defineBlock = function(doc, di, guid, fpi, opts) {
    var o = isNull(opts) ? {} : opts;
    return CsSheetBlock.redefine(doc, di, CsScaleBar.blockName(guid), function(env) {
        CsScaleBar.drawInto(env, fpi);
    }, { group: o.group, quiet: o.quiet, text: qsTr("Draw scale bar") });
};

/**
 * Makes a bar: its block definition now, and its block reference ADDED TO `op` (the caller applies it).
 *
 * \param o.blockId  the layout's block
 * \param o.xIn,o.yIn  where the bar's BASELINE starts, inches of paper from the sheet's lower left
 * \param o.fpi      feet of cave per inch of paper
 * \param o.guid     the viewport this bar measures
 * \param o.tag      value of the generator's own tag (CsLayoutGen.TAG), or "" for none
 * \return the entities added (the one reference)
 */
CsScaleBar.build = function(doc, di, op, o) {
    var inch = Layouts.toPaper(doc, 25.4);
    var defId = CsScaleBar.defineBlock(doc, di, o.guid, o.fpi, {});
    if (defId === null) {
        throw new Error("scale bar block could not be made");
    }
    var ref = CsSheetBlock.reference(doc, di, defId, o.blockId, CsLayers.SCALE_BAR, o.xIn * inch, o.yIn * inch);
    if (!isNull(o.tag) && o.tag !== "" && typeof CsLayoutGen !== "undefined") {
        CsTags.set(ref, CsLayoutGen.TAG, o.tag);
    }
    CsTags.set(ref, CsScaleBar.LINK, o.guid);
    CsTags.set(ref, CsScaleBar.FPI, String(o.fpi));
    op.addObject(ref, false);
    return [ref];
};

/** The parts of a bar as entities: the block's contents for a block bar, the pieces themselves for a loose one. */
CsScaleBar.partsOf = function(doc, pieces) {
    var out = [];
    for (var i = 0; i < pieces.length; i++) {
        if (pieces[i].getType() === RS.EntityBlockRef) {
            var ids = doc.queryBlockEntities(pieces[i].getReferencedBlockId());
            for (var k = 0; k < ids.length; k++) {
                var e = doc.queryEntity(ids[k]);
                if (!isNull(e) && !e.isUndone()) { out.push(e); }
            }
        }
        else {
            out.push(pieces[i]);
        }
    }
    return out;
};

/** Where a bar's baseline starts now (inches of paper), or null when it has no baseline. */
CsScaleBar.anchorOf = function(doc, pieces) {
    var inch = Layouts.toPaper(doc, 25.4);
    for (var j = 0; j < pieces.length; j++) {
        if (pieces[j].getType() === RS.EntityBlockRef) {
            var at = pieces[j].getPosition();       // a block bar: the insertion point IS the baseline's left end
            return { x: at.x / inch, y: at.y / inch };
        }
    }
    for (var i = 0; i < pieces.length; i++) {
        if (CsTags.get(pieces[i], CsScaleBar.PART) === "base" && pieces[i].getType() === RS.EntityLine) {
            var a = pieces[i].getStartPoint(), b = pieces[i].getEndPoint();
            var left = a.x <= b.x ? a : b;
            return { x: left.x / inch, y: left.y / inch };
        }
    }
    return null;
};

/** The scale a bar was last drawn at (feet per inch), or NaN. */
CsScaleBar.drawnAt = function(pieces) {
    for (var i = 0; i < pieces.length; i++) {
        var v = CsTags.get(pieces[i], CsScaleBar.FPI);
        if (v !== "") {
            return parseFloat(v);
        }
    }
    return NaN;
};

/**
 * Redraws the bar linked to a viewport if the viewport's scale is no longer
 * the one the bar shows. A no-op (and no write) when it already matches --
 * which is also what keeps the listener from ever looping on its own edit.
 *
 * \param group   transaction group to join (the caver's edit), or -1
 * \param quiet   true: not undoable (the transaction being answered is an
 *                undo or a redo, and a new undoable step would destroy the
 *                redo history)
 * \return true when it rewrote the bar
 */
CsScaleBar.sync = function(doc, di, vp, group, quiet) {
    var guid = CsScaleBar.guidOf(vp);
    if (guid === "" || vp.isUndone()) {
        return false;
    }
    var pieces = CsScaleBar.pieces(doc, vp.getBlockId(), guid);
    if (pieces.length === 0) {
        return false;     // no bar linked to this viewport (or the caver removed it)
    }
    var fpi = Layouts.feetPerInch(doc, vp);
    var was = CsScaleBar.drawnAt(pieces);
    if (isFinite(was) && Math.abs(was - fpi) <= 1e-9 * Math.max(1, Math.abs(fpi))) {
        return false;
    }
    var anchor = CsScaleBar.anchorOf(doc, pieces);
    if (anchor === null) {
        return false;     // the baseline is gone: leave what is left alone
    }
    if (pieces[0].getType() === RS.EntityBlockRef) {
        // a block bar: redraw the DEFINITION at the new scale; the reference stays exactly where it is
        CsScaleBar.defineBlock(doc, di, guid, fpi, { group: group, quiet: quiet === true });
        var ref = doc.queryEntity(pieces[0].getId());
        CsTags.set(ref, CsScaleBar.FPI, String(fpi));
        var mod = new RModifyObjectsOperation(quiet !== true);
        mod.setText(qsTr("Scale bar follows its viewport"));
        if (group >= 0) {
            mod.setTransactionGroup(group);
        }
        mod.addObject(ref, false);
        di.applyOperation(mod);
        return true;
    }
    // a loose bar from an older build: replaced by the block, where its baseline was
    var del = new RDeleteObjectsOperation(quiet !== true);
    del.setText(qsTr("Scale bar follows its viewport"));
    if (group >= 0) {
        del.setTransactionGroup(group);
    }
    for (var i = 0; i < pieces.length; i++) {
        del.deleteObject(pieces[i]);
    }
    di.applyOperation(del);
    var add = new RAddObjectsOperation(quiet !== true);
    add.setText(qsTr("Scale bar follows its viewport"));
    if (group >= 0) {
        add.setTransactionGroup(group);
    }
    var tag = "";
    try {
        tag = CsTags.get(pieces[0], CsLayoutGen.TAG);
    } catch (eTag) {
        tag = "";
    }
    CsScaleBar.build(doc, di, add, { blockId: vp.getBlockId(), xIn: anchor.x, yIn: anchor.y,
        fpi: fpi, guid: guid, tag: tag });
    di.applyOperation(add);
    return true;
};

/** Syncs every bar in the drawing (used by tests and by a manual "refresh"). */
CsScaleBar.syncAll = function(doc, di, group, quiet) {
    var n = 0;
    var layouts = Layouts.list(doc);
    for (var l = 0; l < layouts.length; l++) {
        var vps = Layouts.viewports(doc, layouts[l]);
        for (var v = 0; v < vps.length; v++) {
            if (CsScaleBar.sync(doc, di, vps[v], group === undefined ? -1 : group, quiet === true)) {
                n++;
            }
        }
    }
    return n;
};


/** True when a viewport already has a bar linked to it. */
CsScaleBar.hasBar = function(doc, vp) {
    var g = CsScaleBar.guidOf(vp);
    return g !== "" && CsScaleBar.pieces(doc, vp.getBlockId(), g).length > 0;
};

/**
 * Adds a linked scale bar for a viewport that has none (a viewport drawn by
 * hand): just below its lower left corner, or inside the sheet's margin if
 * that is closer to the edge. One undo step. The bar follows the viewport's
 * scale from then on, like a generated one.
 *
 * \param atXIn, atYIn  where the baseline starts, inches of paper (default: below the viewport)
 * \return true when a bar was added
 */
CsScaleBar.addFor = function(doc, di, vp, atXIn, atYIn) {
    if (CsScaleBar.hasBar(doc, vp)) {
        return false;
    }
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var fresh = doc.queryEntity(vp.getId());
    var guid = CsScaleBar.ensureGuid(fresh);
    var mod = new RModifyObjectOperation(fresh);
    mod.setText(qsTr("Add scale bar"));
    mod.setTransactionGroup(group);
    di.applyOperation(mod);

    var inch = Layouts.toPaper(doc, 25.4);
    var c = fresh.getCenter();
    var xIn = (c.x - fresh.getWidth() / 2) / inch;
    var yIn = Math.max(0.35, (c.y - fresh.getHeight() / 2) / inch - 0.45);
    if (!isNull(atXIn) && !isNull(atYIn)) {
        xIn = atXIn;
        yIn = atYIn;
    }
    var add = new RAddObjectsOperation();
    add.setText(qsTr("Add scale bar"));
    add.setTransactionGroup(group);
    CsScaleBar.build(doc, di, add, { blockId: fresh.getBlockId(), xIn: xIn, yIn: yIn,
        fpi: Layouts.feetPerInch(doc, fresh), guid: guid, tag: "" });
    di.applyOperation(add);
    return true;
};

// The engine's viewport controls offer "Scale bar" through these hooks.
if (typeof Layouts !== "undefined") {
    Layouts.hasScaleBarOf = CsScaleBar.hasBar;
    Layouts.addScaleBarFor = CsScaleBar.addFor;
}
