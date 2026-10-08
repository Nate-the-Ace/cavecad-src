// CsNorth.js -- north arrows that read their viewport's angle.
//
// Part of the Cave Survey Core library.
//
// WHY. Rotate a viewport's contents and the cave turns, so north is no
// longer up the page: an arrow that stays upright is wrong. An arrow on a
// sheet therefore follows the rotation of the viewport it belongs to.
//
// WHICH ARROWS. Three kinds, all on the NORTH-ARROW layer of a layout:
//  - the arrow Sheet Setup draws NOW: ONE BLOCK REFERENCE named after its
//    viewport (NORTH-ARROW-<guid>), tagged NorthOf (the viewport's GUID, the id
//    the scale bar uses too), NorthRot (the angle its block is drawn at) and
//    NorthDecl (the declination, so a redraw needs nothing else). The block's
//    insertion point IS the pivot, so moving the reference can never displace
//    it; a turn redraws the block DEFINITION and leaves the reference alone;
//  - the loose-piece arrow older drawings carry: its pieces carry NorthOf,
//    NorthAt (the pivot, "x,y" paper units) and NorthPart (shape | label |
//    caption). Still read and turned, about the pivot as it is NOW;
//  - an arrow the caver PLACED (a block reference of their own): it belongs to
//    the viewport under it, or to the layout's only viewport.
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
CsNorth.DECL = "NorthDecl";
CsNorth.DATE = "NorthDate";
CsNorth.CTR = "NorthCtr";     // the reference rotation the block was last drawn against
CsNorth.BLOCK_PREFIX = "NORTH-ARROW-";

/** The block definition of the arrow linked to a viewport GUID. */
CsNorth.blockName = function(guid) {
    return CsNorth.BLOCK_PREFIX + String(guid);
};

/**
 * Where every part of an arrow goes, in INCHES from its pivot, turned by `angle`
 * (radians, anticlockwise). Pure: the one definition of the arrow's shape.
 *
 * Text NEVER rotates: the letters ride round the arrow's tips but stay upright, and the captions stay put. If the
 * reference itself is turned by `counter` radians (someone rotated the block), every point is counter-turned and
 * every text is drawn at -counter, so what shows is still the arrow at `angle` with upright text.
 *
 * \param spec  { arrow: CsSheetSetup.NORTH, heading, small } (text heights, inches)
 * \param decl  the declination in degrees, or null for a true-north-only arrow
 * \param counter  the rotation of the block reference holding the drawing (default 0)
 * \return { lines: [{x1,y1,x2,y2,grey}], labels: [{x,y,text,grey,keepCase,angle}], captions: [{x,y,text,grey,angle}] }
 *         Labels follow the turn but stay upright; captions never move. `angle` is the text's own angle.
 */
CsNorth.layout = function(angle, decl, spec, counter) {
    var ctr = (counter === undefined || counter === null) ? 0 : counter;
    var a = spec.arrow, c = Math.cos(angle), sn = Math.sin(angle);
    var cc = Math.cos(-ctr), cs_ = Math.sin(-ctr);
    var undo = function(p) { return { x: p.x * cc - p.y * cs_, y: p.x * cs_ + p.y * cc }; };   // into the block's own axes
    var rot = function(x, y) { return { x: x * c - y * sn, y: x * sn + y * c }; };
    var out = { lines: [], labels: [], captions: [] };
    var textAngle = -ctr;
    var line = function(x1, y1, x2, y2, grey) {
        var p = undo(rot(x1, y1)), q = undo(rot(x2, y2));
        out.lines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, grey: grey === true });
    };
    var nh = a.height;
    line(0, 0, 0, nh);
    line(0, nh, -a.headHalf, nh - a.headLength);
    line(0, nh, a.headHalf, nh - a.headLength);
    var n = undo(rot(-0.09, nh + 0.28));
    out.labels.push({ x: n.x, y: n.y, text: "N", grey: false, keepCase: false, angle: textAngle });
    var hasMag = decl !== null && decl !== undefined && isFinite(decl);
    var note = (hasMag && decl !== 0) ? "  (DECLINATION " + Number(decl).toFixed(1) + "\u00b0 APPLIED)" : "";
    var cap1 = undo({ x: -0.9, y: -0.2 });
    out.captions.push({ x: cap1.x, y: cap1.y, text: "TRUE NORTH" + note, grey: false, angle: textAngle });
    if (!hasMag) {
        return out;
    }
    var rad = Number(decl) * Math.PI / 180;
    var mx = Math.sin(rad), my = Math.cos(rad);
    var mh = a.magneticHeight;
    var tipX = mx * mh, tipY = my * mh;
    line(0, 0, tipX, tipY, true);
    var back = a.magneticHeadLength, half = a.magneticHeadHalf;
    var bx = tipX - mx * back, by = tipY - my * back;
    line(tipX, tipY, bx - my * half, by + mx * half, true);
    line(tipX, tipY, bx + my * half, by - mx * half, true);
    var m = undo(rot(tipX + mx * 0.12 - 0.06, tipY + 0.18));
    out.labels.push({ x: m.x, y: m.y, text: "mN", grey: true, keepCase: true, angle: textAngle });
    var cap2 = undo({ x: -0.9, y: -(0.2 + spec.small * 2) });
    out.captions.push({ x: cap2.x, y: cap2.y, text: null, grey: true, angle: textAngle });   // text: CsSheetSetup.magneticText(reading), filled in by the drawer
    return out;
};

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
        if (guid !== "" && e.getType() === RS.EntityBlockRef) {
            // the arrow as ONE block: its insertion point is the pivot
            var bp = e.getPosition();
            out.push({ pieces: [e], ref: e, pivot: { x: bp.x, y: bp.y }, guid: guid, placed: false, block: true });
        }
        else if (guid !== "") {
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
    // The stored NorthAt is where the arrow was DRAWN. Move the pieces and it is stale, and a turn about it
    // swings the arrow round a point that is no longer its own. A shaft starts at the pivot and a turn about the
    // pivot leaves that end where it is, so the pivot now is the start of a shape line.
    for (var g = 0; g < out.length; g++) {
        if (!out[g].placed) {
            var here = CsNorth.pivotOf(out[g].pieces);
            if (here !== null) {
                out[g].pivot = here;
            }
        }
    }
    return out;
};

/** Where a generated arrow's pivot is NOW (the start of its first shaft line), or null when it has no shaft. */
CsNorth.pivotOf = function(pieces) {
    for (var i = 0; i < pieces.length; i++) {
        if (CsTags.get(pieces[i], CsNorth.PART) === "shape" && pieces[i].getType() === RS.EntityLine) {
            var a = pieces[i].getStartPoint();
            return { x: a.x, y: a.y };
        }
    }
    return null;
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
        if (ar.block === true) {
            // the arrow as one block: redraw its DEFINITION at the new angle; the reference stays where it is
            var turnedBy = ar.ref.getRotation();      // the reference itself, if someone rotated the block
            var drawnCtr = CsTags.getNumber(ar.ref, CsNorth.CTR);
            if (Math.abs(target - CsNorth.appliedOf(ar.ref)) <= 1e-9 && Math.abs(turnedBy - (drawnCtr === null ? 0 : drawnCtr)) <= 1e-9) {
                continue;
            }
            CsNorth.defineBlock(doc, di, ar.guid, CsNorth.readingOf(ar.ref), target,
                { group: group, quiet: quiet === true, counter: turnedBy });
            var bref = doc.queryEntity(ar.ref.getId());
            CsTags.set(bref, CsNorth.ROT, String(target));
            CsTags.set(bref, CsNorth.CTR, String(turnedBy));
            if (op === null) {
                op = new RModifyObjectsOperation(quiet !== true);
                op.setText(qsTr("North arrow follows its viewport"));
                if (group >= 0) {
                    op.setTransactionGroup(group);
                }
            }
            op.addObject(bref, false);
            wrote = true;
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

/** The declination reading an arrow block was drawn with ({declination, date}), or null for a true-north-only arrow. */
CsNorth.readingOf = function(ref) {
    var d = CsTags.getNumber(ref, CsNorth.DECL);
    if (d === null) {
        return null;
    }
    return { declination: d, date: CsTags.get(ref, CsNorth.DATE) };
};

/** Tags a block reference as the arrow of a viewport (before it is added). */
CsNorth.markRef = function(ref, guid, reading, angle) {
    CsTags.set(ref, CsNorth.LINK, guid);
    CsTags.set(ref, CsNorth.ROT, String(angle));
    if (!isNull(reading) && isFinite(reading.declination)) {
        CsTags.set(ref, CsNorth.DECL, String(reading.declination));
        CsTags.set(ref, CsNorth.DATE, isNull(reading.date) ? "" : String(reading.date));
    }
    return ref;
};

/**
 * Creates or REDRAWS the block definition of a viewport's arrow, turned by `angle`.
 * Everything goes into one operation (one undo step, joined to `opts.group` when given;
 * `opts.quiet` makes it non-undoable, for a sync answering an undo or a redo).
 *
 * \return the block id, or null when the block could not be made
 */
CsNorth.defineBlock = function(doc, di, guid, reading, angle, opts) {
    var o = isNull(opts) ? {} : opts;
    var name = CsNorth.blockName(guid);
    var blockId = doc.getBlockId(name);
    if (blockId === RBlock.INVALID_ID || blockId === undefined || blockId === null || blockId < 0) {
        di.applyOperation(new RAddObjectOperation(new RBlock(doc, name, new RVector(0, 0)), false));
        blockId = doc.getBlockId(name);
    }
    if (blockId === RBlock.INVALID_ID || blockId === undefined || blockId === null || blockId < 0) {
        return null;
    }
    var env = CsLayoutGen.envFor(doc, di, blockId, qsTr("Draw north arrow"), "", o.quiet !== true);
    if (!isNull(o.group) && o.group >= 0) {
        env.op.setTransactionGroup(o.group);
    }
    var old = doc.queryBlockEntities(blockId);
    for (var i = 0; i < old.length; i++) {
        var oe = doc.queryEntity(old[i]);
        if (!isNull(oe)) {
            env.op.deleteObject(oe);
        }
    }
    var decl = isNull(reading) ? null : reading.declination;
    var shape = CsNorth.layout(angle, decl, { arrow: CsSheetSetup.NORTH, small: CsSheetSetup.TEXT.small }, o.counter);
    var L = CsLayers.NORTH_ARROW, k;
    for (k = 0; k < shape.lines.length; k++) {
        var ln = shape.lines[k];
        var le = env.line(ln.x1, ln.y1, ln.x2, ln.y2, L);
        if (ln.grey) { env.greyed(le); }
    }
    for (k = 0; k < shape.labels.length; k++) {
        var lb = shape.labels[k];
        var te = env.text(lb.x, lb.y, lb.grey ? CsSheetSetup.TEXT.small : CsSheetSetup.TEXT.heading, lb.text, L, undefined, lb.keepCase, lb.angle);
        if (lb.grey) { env.greyed(te); }
    }
    for (k = 0; k < shape.captions.length; k++) {
        var cp = shape.captions[k];
        var words = isNull(cp.text) ? CsSheetSetup.magneticText(reading) : cp.text;
        var ce = env.text(cp.x, cp.y, CsSheetSetup.TEXT.small, words, L, undefined, false, cp.angle);
        if (cp.grey) { env.greyed(ce); }
    }
    di.applyOperation(env.op);
    return blockId;
};

/**
 * Removes north arrow block definitions nothing refers to any more (a sheet drawn again gets a new viewport, so
 * a new link and a new block name, and the old definition is left behind). Never fails the caller.
 *
 * \return how many definitions were removed
 */
CsNorth.purgeUnused = function(doc, di) {
    var removed = 0;
    try {
        var ids = doc.queryAllBlocks();
        var op = new RDeleteObjectsOperation();
        op.setText(qsTr("Remove unused north arrow blocks"));
        for (var i = 0; i < ids.length; i++) {
            var block = doc.queryBlock(ids[i]);
            if (isNull(block) || String(block.getName()).indexOf(CsNorth.BLOCK_PREFIX) !== 0) {
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
