// CsNorth.js -- north arrows that read their viewport's angle.
//
// Part of the Cave Survey Core library.
//
// WHY. Rotate a viewport's contents and the cave turns, so north is no
// longer up the page: an arrow that stays upright is wrong. An arrow on a
// sheet therefore follows the rotation of the viewport it belongs to.
//
// WHICH ARROWS. Two kinds, both on the NORTH-ARROW layer of a layout:
//  - the arrow Sheet Setup draws: its pieces carry NorthOf (the viewport's
//    GUID, the id the scale bar uses too), NorthAt (the pivot, "x,y" paper
//    units) and NorthPart (shape | label | caption);
//  - an arrow the caver PLACED (a block reference): it belongs to the
//    viewport under it, or to the layout's only viewport.
//
// HOW. Every piece remembers the rotation it has been turned by (NorthRot);
// a sync turns it by the difference to the viewport's rotation, about the
// pivot. The shape and a placed symbol turn; the letter N moves round with
// them but stays upright; the captions stay where they are. Idempotent: no
// write when everything is already right, so the listener never loops.

var CsNorth = {};

CsNorth.LINK = "NorthOf";
CsNorth.AT = "NorthAt";
CsNorth.PART = "NorthPart";
CsNorth.ROT = "NorthRot";

/** Tags a piece of the generated arrow (before it is added). */
CsNorth.mark = function(entity, guid, pivot, part) {
    CsTags.set(entity, CsNorth.LINK, guid);
    CsTags.set(entity, CsNorth.AT, pivot.x + "," + pivot.y);
    CsTags.set(entity, CsNorth.PART, part);
    CsTags.set(entity, CsNorth.ROT, "0");
    return entity;
};

/** True when the entity is on the north arrow layer. */
CsNorth.onArrowLayer = function(doc, entity) {
    try {
        return CsBind.layerNameOf(doc, entity) === CsLayers.NORTH_ARROW;
    } catch (e) {
        return false;
    }
};

/** Which viewport a placed arrow at paper (x, y) belongs to, or undefined. */
CsNorth.viewportFor = function(doc, blockId, x, y) {
    var info = Layouts.ofBlock(doc, blockId);
    if (isNull(info)) {
        return undefined;
    }
    var at = Layouts.viewportAt(doc, info, x, y);
    if (!isNull(at)) {
        return at;
    }
    var all = Layouts.viewports(doc, info), real = [];
    for (var i = 0; i < all.length; i++) {
        if (!all[i].isOverall()) {
            real.push(all[i]);
        }
    }
    return real.length === 1 ? real[0] : undefined;
};

/**
 * The arrows in a layout block: [{pieces, pivot, guid (generated) | "", placed}].
 * Generated pieces group by their viewport GUID; each placed block reference
 * is an arrow of its own.
 */
CsNorth.arrows = function(doc, blockId) {
    var groups = {}, out = [];
    var ids = doc.queryBlockEntities(blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone() || !CsNorth.onArrowLayer(doc, e)) {
            continue;
        }
        var guid = CsTags.get(e, CsNorth.LINK);
        if (guid !== "") {
            var g = groups[guid];
            if (isNull(g)) {
                var at = CsTags.get(e, CsNorth.AT).split(",");
                g = { pieces: [], pivot: { x: parseFloat(at[0]), y: parseFloat(at[1]) }, guid: guid, placed: false };
                groups[guid] = g;
                out.push(g);
            }
            g.pieces.push(e);
        }
        else if (e.getType() === RS.EntityBlockRef) {
            var p = e.getPosition();
            out.push({ pieces: [e], pivot: { x: p.x, y: p.y }, guid: "", placed: true });
        }
    }
    return out;
};

CsNorth.appliedOf = function(entity) {
    var v = CsTags.getNumber(entity, CsNorth.ROT);
    return v === null ? 0 : v;
};

/**
 * Turns the arrows that belong to `vp` to the viewport's rotation.
 *
 * \return true when it wrote anything
 */
CsNorth.sync = function(doc, di, vp, group, quiet) {
    if (vp.isUndone() || vp.isOverall()) {
        return false;
    }
    var target = vp.getRotation();
    var guid = CsScaleBar.guidOf(vp);
    var arrows = CsNorth.arrows(doc, vp.getBlockId());
    var op = null, wrote = false;
    for (var a = 0; a < arrows.length; a++) {
        var ar = arrows[a];
        var mine = ar.placed ?
            (function() {
                var owner = CsNorth.viewportFor(doc, vp.getBlockId(), ar.pivot.x, ar.pivot.y);
                return !isNull(owner) && owner.getId() === vp.getId();
            })() :
            (guid !== "" && ar.guid === guid);
        if (!mine) {
            continue;
        }
        var delta = target - CsNorth.appliedOf(ar.pieces[0]);
        if (Math.abs(delta) <= 1e-9) {
            continue;
        }
        if (op === null) {
            op = new RModifyObjectsOperation(quiet !== true);
            op.setText(qsTr("North arrow follows its viewport"));
            if (group >= 0) {
                op.setTransactionGroup(group);
            }
        }
        var pivot = new RVector(ar.pivot.x, ar.pivot.y);
        for (var k = 0; k < ar.pieces.length; k++) {
            var e = doc.queryEntity(ar.pieces[k].getId());
            var part = CsTags.get(e, CsNorth.PART);
            if (part === "caption") {
                // stays where it is, but is marked as brought up to date
            }
            else if (part === "label") {
                var was = e.getPosition();
                var moved = was.copy();
                moved.rotate(delta, pivot);
                e.move(moved.operator_subtract(was));
            }
            else {
                e.rotate(delta, ar.placed ? e.getPosition() : pivot);
            }
            CsTags.set(e, CsNorth.ROT, String(CsNorth.appliedOf(ar.pieces[0]) + delta));
            op.addObject(e, false);
        }
        wrote = true;
    }
    if (op !== null) {
        di.applyOperation(op);
    }
    return wrote;
};

/** Syncs every arrow in the drawing (tests, and a manual refresh). */
CsNorth.syncAll = function(doc, di, group, quiet) {
    var n = 0;
    var layouts = Layouts.list(doc);
    for (var l = 0; l < layouts.length; l++) {
        var vps = Layouts.viewports(doc, layouts[l]);
        for (var v = 0; v < vps.length; v++) {
            if (CsNorth.sync(doc, di, vps[v], group === undefined ? -1 : group, quiet === true)) {
                n++;
            }
        }
    }
    return n;
};
