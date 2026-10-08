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

/**
 * Draws a bar into `op`.
 *
 * \param o.blockId  the layout's block
 * \param o.xIn,o.yIn  where the bar's BASELINE starts, inches of paper from the sheet's lower left
 * \param o.fpi      feet of cave per inch of paper
 * \param o.guid     the viewport this bar measures
 * \param o.tag      value of the generator's own tag (CsLayoutGen.TAG), or "" for none
 * \return the entities added
 */
CsScaleBar.build = function(doc, di, op, o) {
    var inch = Layouts.toPaper(doc, 25.4);
    var P = function(inches) { return inches * inch; };
    var made = [];
    var layerId = (function() {
        CsLayers.ensure(doc, di, CsLayers.SCALE_BAR);
        return doc.getLayerId(CsLayers.SCALE_BAR);
    })();
    var put = function(entity, part) {
        entity.setBlockId(o.blockId);
        entity.setLayerId(layerId);
        if (!isNull(o.tag) && o.tag !== "" && typeof CsLayoutGen !== "undefined") {
            CsTags.set(entity, CsLayoutGen.TAG, o.tag);
        }
        CsTags.set(entity, CsScaleBar.LINK, o.guid);
        CsTags.set(entity, CsScaleBar.FPI, String(o.fpi));
        CsTags.set(entity, CsScaleBar.PART, part);
        op.addObject(entity, false);
        made.push(entity);
        return entity;
    };
    var text = function(x, y, heightIn, label, part) {
        var e = new RTextEntity(doc, new RTextData(
            new RVector(P(x), P(y)), new RVector(P(x), P(y)), P(heightIn),
            P(CsSheetSetup.TITLE_INCHES * 4),
            RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
            1.0, CsDraw.caps(label), "standard", false, false, 0.0, false));
        return put(e, part);
    };
    var line = function(x1, y1, x2, y2, part) {
        var e = new RLineEntity(doc, new RLineData(new RVector(P(x1), P(y1)), new RVector(P(x2), P(y2))));
        return put(e, part);
    };

    var bar = CsSheetSetup.barFor(o.fpi);
    var barX = o.xIn, barY = o.yIn;
    // one block is perBlockFeet of cave = perBlockFeet / fpi inches of paper
    var blockW = bar.perBlockFeet / o.fpi;
    var barH = CsSheetSetup.BAR.height;
    for (var k = 0; k <= bar.blocks; k++) {
        var bx = barX + blockW * k;
        line(bx, barY, bx, barY + barH, "tick");
        text(bx, barY - CsSheetSetup.BAR.tick * 2, CsSheetSetup.TEXT.small, String(bar.perBlock * k), "label");
    }
    line(barX, barY, barX + blockW * bar.blocks, barY, "base");
    line(barX, barY + barH, barX + blockW * bar.blocks, barY + barH, "top");
    text(barX, barY + barH + CsSheetSetup.TEXT.body, CsSheetSetup.TEXT.body,
        CsSheetSetup.scaleText(o.fpi), "caption");
    text(barX + blockW * bar.blocks + 0.1, barY - CsSheetSetup.BAR.tick * 2,
        CsSheetSetup.TEXT.small, bar.unit, "unit");
    return made;
};

/** Where a bar's baseline starts now (inches of paper), or null when it has no baseline. */
CsScaleBar.anchorOf = function(doc, pieces) {
    var inch = Layouts.toPaper(doc, 25.4);
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
