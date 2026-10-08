/**
 * CalloutWrite -- every QCAD-context write a callout needs.
 *
 * The pure geometry lives in Core/CsCallout.js. This file is the only
 * place that constructs entities, applies operations or reads a
 * document, so there is exactly ONE definition of what a callout looks
 * like in a drawing -- shared by all three commands and the listener.
 *
 * NOT loaded by tests/js_unit.js (it cannot run under node).
 * tests/callout_write.js covers it in CaveCAD's own engine.
 *
 * Takes `doc` as a parameter to every function and never caches one on
 * the module: a freed RDocument cannot be detected from script and
 * touching one SEGFAULTS (exit 139, not a catchable exception).
 */
function CalloutWrite() {}

/** Every CalloutId present in the drawing, as strings, deduped. */
CalloutWrite.existingIds = function(doc) {
    var out = [];
    var seen = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "" && !seen.hasOwnProperty(cid)) {
            seen[cid] = true;
            out.push(cid);
        }
    }
    return out;
};

/** The members of one callout: {text: entity|null, leaders: [entity]}. */
CalloutWrite.members = function(doc, id) {
    var want = String(id);
    var res = { text: null, block: null, leaders: [] };
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, CsCallout.KEY.ID) !== want) {
            continue;
        }
        var role = CsTags.get(e, CsCallout.KEY.ROLE);
        if (role === CsCallout.ROLE_TEXT) {
            res.text = e;
        } else if (role === CsCallout.ROLE_BLOCK) {
            res.block = e;
        } else if (role === CsCallout.ROLE_LEADER) {
            res.leaders.push(e);
        }
    }
    return res;
};

/**
 * The member a callout's leaders point AT: its text, or -- for a cross
 * section -- its block reference.
 *
 * Every leader rule in this file was written against m.text because
 * text was the only content there had ever been. A section's content is
 * a block, and reflow needs a BOX rather than a string, so the rules
 * hold unchanged once they ask for the content member instead of the
 * text member.
 */
CalloutWrite.contentOf = function(m) {
    return m.text !== null ? m.text : m.block;
};

/**
 * The text's bounding box as the plain {x1,y1,x2,y2} CsCallout wants.
 *
 * update() FIRST, and it is not optional. An entity's bounding box is
 * CACHED, and a modify operation does not invalidate it -- not even
 * across a fresh doc.queryEntity(). Measured: after moving a note's
 * alignment point from x=1000 to x=1250, both entity.getBoundingBox()
 * and entity.getData().getBoundingBox() still reported 1000.000..1000.778;
 * only after entity.update() did it read 1250.000..1250.778.
 *
 * This is what made "the arrows do not follow the note" survive a test
 * suite. The sync test asserted that the leaders landed on
 * boxOf(text) -- and boxOf was stale, so the leaders were being solved
 * against the note's OLD position and then checked against that same old
 * position. Both sides agreed and the test passed while the drawing was
 * wrong. A comparison is only evidence if the two sides can disagree.
 */
CalloutWrite.boxOf = function(textEntity) {
    try {
        textEntity.update();
    } catch (e) {
        // no update() in this bridge: fall through and use whatever the
        // cached box says rather than failing the whole reflow
    }
    var b = textEntity.getBoundingBox();
    var c1 = b.getCorner1();
    var c2 = b.getCorner2();
    return {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
};

/** The current entity id set, as a {id: true} map. */
CalloutWrite.idSet = function(doc) {
    var m = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        m[ids[i]] = true;
    }
    return m;
};

/**
 * Ids present now that were not in `before`.
 *
 * The only correct way to learn which entity an add operation just
 * created: queryAllEntities is NOT insertion-ordered, so
 * ids[ids.length - 1] is arbitrary and only appears to work on an
 * empty document. Do not "simplify" a caller back to that.
 */
CalloutWrite.newIds = function(doc, before) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        if (!before.hasOwnProperty(ids[i])) {
            out.push(ids[i]);
        }
    }
    return out;
};

/** A plain {x1,y1,x2,y2} from a text's DATA, before it is added. */
CalloutWrite.boxOfData = function(textData) {
    var b = textData.getBoundingBox();
    var c1 = b.getCorner1();
    var c2 = b.getCorner2();
    return {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
};

/**
 * Build the WHOLE callout -- text and every leader -- into ONE
 * operation, without applying it. Returns {op, id, box, side}.
 *
 * ONE operation matters twice over.
 *
 * UNDO: the previous version applied the text in its own operation and
 * then each leader in another, so undoing a freshly placed callout took
 * as many presses as it had arrows. One operation is one undo, which is
 * what a caver expects from one gesture.
 *
 * PREVIEW: an operation that has not been applied can be handed to
 * di.previewOperation(), so the live preview is the REAL text in the
 * REAL font at the REAL size with its REAL leaders -- not an
 * approximation that then disagrees with what lands.
 *
 * What makes both possible: a text's bounding box is available BEFORE it
 * is added to a document. Measured -- getBoundingBox() pre-add returns
 * x 100.00..115.22 for a note whose post-add box is identical, and it
 * already honours the alignment. So the leaders can be solved against
 * the real box with no document round trip.
 */
CalloutWrite.buildOp = function(doc, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    var shape = spec.leader || CsCallout.LEADER_DEFAULT;
    var id = CsCallout.newId();
    var layerId = doc.getLayerId(layerName);
    var op = new RAddObjectsOperation();

    var at = new RVector(spec.position.x, spec.position.y);

    // THE FLIP: the note grows AWAY from the arrow, so its near edge is
    // the pick point and the leader never crosses its own letters.
    // Measured: pick at x=100 with a 15-unit note boxes 100..115 under
    // HAlignLeft and 84.78..100 under HAlignRight -- either way the edge
    // facing the arrow IS the pick. The side comes from the pick point
    // because the text does not exist yet; CsCallout.sideFor is shared
    // with reflow so the two rules cannot drift.
    var side = CsCallout.sideFor(spec.tips, spec.position.x);
    var halign = (side === "left") ? RS.HAlignLeft : RS.HAlignRight;

    // Position AND alignment point, via the full constructor, as
    // CsDraw.addText does. setPosition() alone reads back correctly
    // while the entity renders at the ORIGIN -- that shipped once.
    var textData = new RTextData(at, at, spec.height, 100.0,
        RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, spec.text, "standard", false, false, 0.0, false);

    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(layerId);

    // Tag BEFORE adding (CsDraw.js:10), so the tags land in the SAME
    // operation as the geometry. CsTags.commit applies its own separate
    // ungrouped modify, which broke atomicity once already.
    var tags = {};
    tags[CsCallout.KEY.ID] = id;
    tags[CsCallout.KEY.ROLE] = CsCallout.ROLE_TEXT;
    tags[CsCallout.KEY.KIND] = spec.kind || CsCallout.KIND_TEXT;
    tags[CsCallout.KEY.STYLE] = style;
    tags[CsCallout.KEY.SIDE] = "auto";
    tags[CsCallout.KEY.LEADER] = shape;
    if (spec.tags) {
        for (var k in spec.tags) {
            if (spec.tags.hasOwnProperty(k)) {
                tags[k] = spec.tags[k];
            }
        }
    }
    for (var tk in tags) {
        if (tags.hasOwnProperty(tk)) {
            CsTags.set(textEntity, tk, tags[tk]);
        }
    }
    op.addObject(textEntity, false);

    var box = CalloutWrite.boxOfData(textData);
    var geom = CsCallout.reflow(box, spec.tips, {
        side: "auto",
        leader: shape,
        // Not DIMASZ/DIMSCALE: measured at 0.0833 in a real drawing,
        // a shoulder too short to see on a half-unit note. reflow falls
        // back to half the text height, right at every scale because it
        // is expressed in the note's own size.
        dimasz: null,
        dimscale: null
    });

    for (var b = 0; b < geom.branches.length; b++) {
        var pl = new RPolyline();
        var pts = geom.branches[b];
        for (var v = 0; v < pts.length; v++) {
            // Second argument is the BULGE, which in QCAD belongs to the
            // vertex a segment STARTS at. A curved leader carries its arc
            // on the tip; the shoulder stays straight.
            pl.appendVertex(new RVector(pts[v].x, pts[v].y),
                pts[v].bulge || 0.0);
        }
        var ent = new RLeaderEntity(doc, new RLeaderData(pl, true));
        ent.setLayerId(layerId);
        CsTags.set(ent, CsCallout.KEY.ID, id);
        CsTags.set(ent, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
        CsTags.set(ent, CsCallout.KEY.STYLE, style);
        op.addObject(ent, false);
    }

    return { op: op, id: id, box: box, side: geom.side };
};

/**
 * Place a new callout, in a single operation. Returns its id.
 *
 * \param spec {text, position: {x,y}, tips: [{x,y}], style, leader,
 *              kind, height, tags: {extra XDATA}}
 */
CalloutWrite.create = function(doc, di, spec) {
    var style = spec.style || CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);

    var built = CalloutWrite.buildOp(doc, spec);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        di.applyOperation(built.op);
    });

    // An operation that "succeeded" may have added nothing: LOCKED and
    // FROZEN layers refuse silently, withLayerOn covers OFF only, and
    // applyOperation reports nothing useful either way. Read the callout
    // back rather than trusting the call.
    var m = CalloutWrite.members(doc, built.id);
    if (m.text === null || m.leaders.length !== spec.tips.length) {
        throw new Error("callout did not land on layer " + layerName +
            " -- it may be locked or frozen (text=" +
            (m.text === null ? "missing" : "ok") + ", leaders=" +
            m.leaders.length + " of " + spec.tips.length + ")");
    }
    return built.id;
};

/**
 * A canonical, order-independent signature for a set of leader
 * geometries, so "did anything actually change?" is one string compare.
 *
 * Order-independent because members() reads through queryAllEntities,
 * which is NOT insertion-ordered: the same three leaders can come back
 * in any order, and comparing them pairwise in that order would report a
 * change that is not one.
 *
 * Rounded to 1e-6. Reflow is deterministic, so an unchanged callout
 * reproduces its own coordinates bit for bit; the rounding is only there
 * so a float that round-trips through the DXF writer and back still
 * matches itself.
 */
CalloutWrite.geometrySignature = function(branches) {
    var parts = [];
    var round = function(n) {
        return String(Math.round(n * 1000000) / 1000000);
    };
    for (var b = 0; b < branches.length; b++) {
        var pts = branches[b];
        var one = [];
        for (var v = 0; v < pts.length; v++) {
            one.push(round(pts[v].x) + "," + round(pts[v].y) + "," +
                round(pts[v].bulge || 0.0));
        }
        parts.push(one.join("|"));
    }
    parts.sort();
    return parts.join(" / ");
};

/** The same signature, read off the leaders a callout actually has. */
CalloutWrite.signatureOfLeaders = function(leaders) {
    var branches = [];
    for (var i = 0; i < leaders.length; i++) {
        var d = leaders[i].getData();
        var n = d.countVertices();
        var pts = [];
        for (var v = 0; v < n; v++) {
            var p = d.getVertexAt(v);
            var bulge = 0.0;
            try {
                bulge = d.getBulgeAt(v);
            } catch (e) {
                bulge = 0.0;
            }
            pts.push({ x: p.x, y: p.y, bulge: bulge });
        }
        branches.push(pts);
    }
    return CalloutWrite.geometrySignature(branches);
};

/**
 * Delete this callout's leaders and write one per tip, reflowed against
 * the text's CURRENT box. `group` is a transaction group id or null.
 */
CalloutWrite.writeLeaders = function(doc, di, id, tips, style, layerName,
        group) {
    var m = CalloutWrite.members(doc, id);
    var content = CalloutWrite.contentOf(m);
    if (content === null) {
        return;
    }

    var side = CsTags.get(content, CsCallout.KEY.SIDE);
    // The leader SHAPE is read back off the content, not passed in, so
    // a reflow after a move or an edit keeps the curve the caver chose.
    var shape = CsTags.get(content, CsCallout.KEY.LEADER);
    var geom = CsCallout.reflow(CalloutWrite.boxOf(content), tips, {
        leader: (shape === "" ? CsCallout.LEADER_DEFAULT : shape),
        side: (side === "" ? "auto" : side),
        // NOT DIMASZ/DIMSCALE. Measured in a real drawing they are
        // 0.0833 and 1, which would put a 0.08-unit landing on a
        // 0.5-unit-tall note -- a shoulder too short to see. reflow's
        // own fallback is half the text height, which stays right at
        // every scale because it is expressed IN the note's own size.
        dimasz: null,
        dimscale: null
    });

    // NOTHING TO DO IS NOT A WRITE.
    //
    // This is what stopped CaveCAD freezing. writeLeaders used to delete
    // and re-add every leader unconditionally, so a reflow that changed
    // nothing still produced transactions -- measured: leader entity ids
    // climbing 56, 57, 58 on an untouched callout. CalloutListener hears
    // every transaction, so each pointless rewrite fired it again. The
    // busy flag only guards a SYNCHRONOUS re-entry; if the signal is
    // delivered queued, the nested calls arrive after the flag is
    // cleared and the thing runs away.
    //
    // So the guard is not "do not recurse", it is "do not write when
    // there is nothing to write". A reflow of an unchanged callout is now
    // a string compare and a return, which terminates the cycle no matter
    // how the signal is delivered.
    if (CalloutWrite.signatureOfLeaders(m.leaders) ===
            CalloutWrite.geometrySignature(geom.branches)) {
        return;
    }

    CsLayers.withLayerOn(doc, di, layerName, function() {
        // out with the old
        if (m.leaders.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var d = 0; d < m.leaders.length; d++) {
                // ONE argument -- every other caller in this codebase
                // (CsStore, CsProfileDraw, CsDraw, ScatterBreakdown,
                // BuildLegend, CsSurfaceData) agrees, and the engine
                // itself warns "Too many arguments, ignoring 1" on the
                // two-argument form the plan's draft called for.
                del.deleteObject(m.leaders[d]);
            }
            if (group !== null && group !== undefined) {
                del.setTransactionGroup(group);
            }
            di.applyOperation(del);
        }

        // in with the new
        for (var b = 0; b < geom.branches.length; b++) {
            var pl = new RPolyline();
            var pts = geom.branches[b];
            for (var p = 0; p < pts.length; p++) {
                // The second argument is the BULGE, which in QCAD
                // belongs to the vertex a segment STARTS at. A straight
                // leader passes 0.0 throughout; a curved one carries the
                // arc on its tip vertex. Probed: RLeaderData(polyline,
                // true) preserves bulges AND its arrowhead.
                pl.appendVertex(new RVector(pts[p].x, pts[p].y),
                    pts[p].bulge || 0.0);
            }
            var data = new RLeaderData(pl, true);   // true = arrowHead
            var ent = new RLeaderEntity(doc, data);
            ent.setLayerId(doc.getLayerId(layerName));

            // Tag BEFORE adding -- see create()'s own comment. This is
            // what makes a grouped reflow ATOMIC: the add below is the
            // ONLY operation that writes this leader, tags included,
            // and it is the one that carries `group`. A separate,
            // ungrouped CsTags.commit() after the add (the previous
            // shape of this loop) meant undoing the group reverted the
            // add's geometry but not the tagging modify next to it --
            // reproduced by hand: a leader survived undo with no
            // CalloutId/CalloutRole at all, invisible to members()
            // from that point on.
            CsTags.set(ent, CsCallout.KEY.ID, String(id));
            CsTags.set(ent, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
            CsTags.set(ent, CsCallout.KEY.STYLE, style);

            // Verification only, same as create() -- an add that lands
            // nothing (locked/frozen layer) must not pass silently.
            var before = CalloutWrite.idSet(doc);
            var op = new RAddObjectsOperation();
            op.addObject(ent, false);
            if (group !== null && group !== undefined) {
                op.setTransactionGroup(group);
            }
            di.applyOperation(op);

            if (CalloutWrite.newIds(doc, before).length !== 1) {
                throw new Error("callout leader was not added -- layer " +
                    layerName + " may be locked or frozen");
            }
        }
    });
};

/**
 * Reflow an existing callout in place: read its current tips off its
 * current leaders, then rewrite them against the text's current box.
 *
 * A leader's tip is its FIRST vertex (reflow emits tip, elbow, landing),
 * which is what lets a caver drag the tip grip and have the elbow
 * follow rather than the other way round.
 */
CalloutWrite.applyReflow = function(doc, di, id, group) {
    var m = CalloutWrite.members(doc, id);
    var content = CalloutWrite.contentOf(m);
    if (content === null || m.leaders.length === 0) {
        return;
    }
    var style = CsTags.get(content, CsCallout.KEY.STYLE) ||
        CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];

    var tips = [];
    for (var i = 0; i < m.leaders.length; i++) {
        var v = m.leaders[i].getData().getVertexAt(0);
        tips.push({ x: v.x, y: v.y });
    }
    CalloutWrite.writeLeaders(doc, di, id, tips, style, layerName, group);
};

/**
 * Text height for a new callout: the SAME height every other label in
 * this suite uses.
 *
 * NOT the drawing's DIMTXT. That was the first attempt and it is wrong
 * by two orders of magnitude on a real cave map: measured in a caver's
 * own drawing, DIMTXT is 0.0833 (one inch, in a drawing whose unit is
 * feet) with DIMSCALE 1, which put a "test test test" note in a box
 * 0.55 x 0.08 units across a passage spanning ~200 feet. Invisible.
 * DIMTXT is sized for dimension annotation on a plotted sheet, not for
 * map lettering.
 *
 * CsDraw.TEXT_HEIGHT is what station labels are drawn at, so a note
 * comes out the same size as the labels beside it -- which is what a
 * caver expects and the only definition of "right size" this suite
 * actually has.
 */
CalloutWrite.textHeight = function(doc) {
    return CsDraw.TEXT_HEIGHT;
};

/**
 * The elevation-label unit suffix for this drawing: "'" for an
 * imperial drawing, " m" for a metric one -- CsCallout.elevLabel's own
 * `suffix` parameter. Off the drawing's own unit via CsUnits, never a
 * constant, so a metric survey does not get labelled in feet. Lives
 * here rather than on either CalloutElev or CsCalloutSync because BOTH
 * need it, and a command reaching into a sibling command's file for a
 * helper is how a silent include failure gets introduced.
 */
CalloutWrite.suffixFor = function(doc) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    return (unit === CsUnits.METERS) ? " m" : "'";
};

/**
 * The floor elevation at a point, ready to label: {label, sample}, or
 * null when no leg is near enough to answer honestly.
 *
 * Lives here rather than on either command because BOTH need it -- the
 * callout tool offers it in its dialog, the elevation tool places it
 * without asking -- and a command reaching into a sibling command's file
 * is how a silent include failure gets introduced.
 *
 * EXPENSIVE: it resolves the whole survey network. Call it when the
 * caver has actually asked for an elevation, never speculatively.
 */
CalloutWrite.sampleElevationAt = function(doc, point) {
    if (isNull(doc) || point === null || point === undefined) {
        return null;
    }
    var sample;
    try {
        // resolveAsDrawn: exact legs in the drawing's own frame. The
        // chain-guess reader this used to run offered PHANTOM legs
        // (one fabricated across every branch boundary) as sampling
        // candidates -- a point near a junction could take its floor
        // from a passage that does not exist.
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (asDrawn === null) {
            return null;
        }
        sample = CsElevation.sampleFloor(asDrawn.survey, asDrawn.resolved,
            { x: point.x, y: point.y }, {});
    } catch (e) {
        return null;
    }
    if (sample === null) {
        return null;
    }
    var label = CsCallout.elevLabel(sample, CalloutWrite.suffixFor(doc));
    if (label === null) {
        return null;
    }
    return { label: label, sample: sample };
};

/** The XDATA an elevation callout carries so CsCalloutSync can
 *  re-derive it -- which is how a LINE stand-in upgrades itself to a
 *  real floor reading once somebody enters D on a later trip. */
CalloutWrite.elevTags = function(sample) {
    var t = {};
    t[CsCallout.KEY.ELEV_BASIS] = sample.basis;
    t[CsCallout.KEY.ELEV_FROM] = sample.from;
    t[CsCallout.KEY.ELEV_TO] = sample.to;
    t[CsCallout.KEY.ELEV_FRACTION] = String(sample.fraction);
    t[CsCallout.KEY.ELEV_VALUE] = String(sample.z);
    t[CsCallout.KEY.ELEV_MULTI] = sample.multi ? "1" : "";
    return t;
};

/**
 * Re-derive every elevation callout against the WHOLE DRAWING's survey.
 *
 * This is the entry point every caller should use. The variant below
 * takes a survey and resolved network as arguments, and it is a trap for
 * the draw path: SurveyNotebook draws ONE PAGE at a time, so the survey
 * it hands to CsDraw.survey holds only that page's stations and shots.
 * Refreshing against it would report every label on another page as
 * "lost", and would re-derive the labels on THIS page against a partial
 * network -- partial legs, partial LRUD -- so a label near a page
 * boundary could lose its D and spuriously downgrade to a survey-line
 * stand-in. Found by the caver: draw was "not recalcing properly".
 *
 * So this reads the survey back out of the DRAWING, which is the only
 * complete picture and also the one the labels actually sit on. It costs
 * a network resolve. An earlier version of the draw hook reused the
 * page's already-resolved network to avoid exactly that cost; the cost
 * was worth paying and the saving was wrong.
 *
 * Returns the same counts, or null when the drawing carries no readable
 * survey (an empty or untagged drawing has nothing to re-derive from,
 * which is not an error).
 */
CalloutWrite.refreshElevationsFromDocument = function(doc, di) {
    if (isNull(doc) || isNull(di)) {
        return null;
    }
    var asDrawn;
    try {
        // exact reconstruction, drawing frame -- see sampleElevationAt
        asDrawn = CsRevise.resolveAsDrawn(doc);
    } catch (e) {
        return null;
    }
    if (asDrawn === null) {
        return null;
    }
    return CalloutWrite.refreshElevations(doc, di, asDrawn.survey,
        asDrawn.resolved);
};

/**
 * Re-derive every elevation callout in the drawing from its stored
 * provenance. Returns {updated, upgraded, downgraded, lost, unchanged}.
 *
 * THIS IS WHAT MAKES AN ELEVATION LABEL TRACK A REVISION. A label is a
 * snapshot of the floor at one point at one moment. Enter a corrected
 * reading, add the D that was missing, re-run a loop closure -- and the
 * number on the map is now a lie, still sitting there looking
 * authoritative. Every callout carries the leg and the fraction along it
 * that it was sampled at, so the answer can simply be asked again.
 *
 * The two outcomes worth naming:
 *
 *   UPGRADED -- a "~1234.5' LINE" stand-in becomes a real floor reading
 *   because somebody finally entered D. The label loses its tilde and
 *   its warning, and MOVES to the measured-elevation layer. Leaving it
 *   on the muted layer would keep telling the reader it was a guess.
 *
 *   DOWNGRADED -- the reverse, when a D is removed or a leg is redrawn
 *   without one. Better to say so than to keep showing a floor number
 *   nothing supports.
 *
 * A HAND-EDITED LABEL IS NEVER OVERWRITTEN. If the text does not match
 * what the stored value would have produced, a human changed it -- and
 * that edit is worth more than anything computed here, because they were
 * standing in the passage. Left exactly alone.
 *
 * TAKES survey and resolved FROM THE CALLER, which makes it the wrong
 * function for a draw hook: a caller holding only one page's survey will
 * mis-report every other page's labels as lost and re-derive this page's
 * against a partial network. Use refreshElevationsFromDocument above
 * unless you are certain your survey covers the whole drawing.
 */
CalloutWrite.refreshElevations = function(doc, di, survey, resolved) {
    var out = { updated: 0, upgraded: 0, downgraded: 0, lost: 0,
                unchanged: 0 };
    if (isNull(doc) || isNull(di) || isNull(survey) || isNull(resolved)) {
        return out;
    }
    var suffix = CalloutWrite.suffixFor(doc);
    var ids = CalloutWrite.existingIds(doc);

    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var m = CalloutWrite.members(doc, id);
        if (m.text === null) {
            continue;
        }
        if (CsTags.get(m.text, CsCallout.KEY.KIND) !== CsCallout.KIND_ELEV) {
            continue;
        }

        var storedBasis = CsTags.get(m.text, CsCallout.KEY.ELEV_BASIS);
        var storedValue = parseFloat(
            CsTags.get(m.text, CsCallout.KEY.ELEV_VALUE));
        var storedMulti =
            CsTags.get(m.text, CsCallout.KEY.ELEV_MULTI) === "1";
        var current = m.text.getData().getText();

        // Hand-edited? Then it is not ours to rewrite.
        if (!isNaN(storedValue)) {
            var wasLabel = CsCallout.elevLabel({
                z: storedValue, basis: storedBasis, multi: storedMulti
            }, suffix);
            if (wasLabel !== null && current !== wasLabel) {
                out.unchanged++;
                continue;
            }
        }

        var from = CsTags.get(m.text, CsCallout.KEY.ELEV_FROM);
        var to = CsTags.get(m.text, CsCallout.KEY.ELEV_TO);
        var fraction = parseFloat(
            CsTags.get(m.text, CsCallout.KEY.ELEV_FRACTION));
        if (from === "" || to === "" || isNaN(fraction)) {
            out.lost++;
            continue;
        }
        var a = resolved.stations[from];
        var b = resolved.stations[to];
        if (a === undefined || b === undefined) {
            // The leg this label was sampled on is gone from the survey.
            // Left alone and COUNTED: a number whose basis has vanished
            // is exactly what a caver needs told, not silently deleted.
            out.lost++;
            continue;
        }

        var point = { x: a.x + (b.x - a.x) * fraction,
                      y: a.y + (b.y - a.y) * fraction };
        var sample = CsElevation.sampleFloor(survey, resolved, point, {});
        if (sample === null) {
            out.lost++;
            continue;
        }

        var label = CsCallout.elevLabel(sample, suffix);
        var style = CsCallout.elevStyle(sample);
        var oldStyle = CsTags.get(m.text, CsCallout.KEY.STYLE);

        if (label === current && style === oldStyle) {
            out.unchanged++;
            continue;
        }

        var layerName = CsCallout.STYLES[style];
        CsLayers.ensure(doc, di, layerName);
        var layerId = doc.getLayerId(layerName);

        CsLayers.withLayerOn(doc, di, layerName, function() {
            var td = m.text.getData();
            td.setText(label);
            m.text.setData(td);
            m.text.setLayerId(layerId);
            CsTags.set(m.text, CsCallout.KEY.ELEV_BASIS, sample.basis);
            CsTags.set(m.text, CsCallout.KEY.ELEV_VALUE, String(sample.z));
            CsTags.set(m.text, CsCallout.KEY.STYLE, style);
            // ELEV_MULTI is a flag, and CsTags.set cannot write "" -- it
            // returns early on an empty value by design. So clearing it
            // is a REMOVE, not a set.
            if (sample.multi) {
                CsTags.set(m.text, CsCallout.KEY.ELEV_MULTI, "1");
            } else {
                CsTags.remove(m.text, CsCallout.KEY.ELEV_MULTI);
            }
            var op = new RModifyObjectsOperation();
            op.addObject(m.text, false);
            di.applyOperation(op);
        });

        // The text changed, so its box changed, so the arrows are now
        // pointing at the wrong edge. Reflow is a no-op when nothing
        // moved, so this is safe to call unconditionally.
        CalloutWrite.applyReflow(doc, di, id, null);

        if (storedBasis === CsCallout.BASIS_LINE &&
                sample.basis === CsCallout.BASIS_FLOOR) {
            out.upgraded++;
        } else if (storedBasis === CsCallout.BASIS_FLOOR &&
                sample.basis === CsCallout.BASIS_LINE) {
            out.downgraded++;
        } else {
            out.updated++;
        }
    }
    return out;
};

/**
 * Strip EVERY callout tag off an entity, leaving ordinary geometry.
 *
 * Uses CsTags.remove, not CsTags.set(key, ""). set() returns early on an
 * empty value by design -- so the original version of this function
 * silently did nothing, and a note that had lost its last arrow kept its
 * CalloutId and stayed a half-callout that members() still matched.
 * Caught by the listener's own test.
 *
 * Strips the whole key set, not just the id: a text left carrying
 * CalloutStyle or CalloutLeader is litter that reads as meaningful to
 * the next person who greps for it.
 */
/**
 * refreshSections against the survey the DRAWING itself carries -- the
 * same reason refreshElevationsFromDocument re-reads it rather than
 * reusing a caller's: SurveyNotebook draws one page at a time, and a
 * section cut on another page would be reported lost against it.
 */
CalloutWrite.refreshSectionsFromDocument = function(doc, di) {
    if (isNull(doc) || isNull(di)) {
        return null;
    }
    var asDrawn;
    try {
        asDrawn = CsRevise.resolveAsDrawn(doc);
    } catch (e) {
        return null;
    }
    if (asDrawn === null) {
        return null;
    }
    return CalloutWrite.refreshSections(doc, di, asDrawn.survey,
        asDrawn.resolved);
};

/**
 * Place a cross-section callout: a leader from the cut point to a BLOCK
 * holding the section.
 *
 * One block DEFINITION per section (CsSectionDraw.blockName), so a
 * caver can edit one without touching any other and the whole section
 * drags as a unit.
 *
 * \param spec {cut, from, to, t, position: {x,y}, tips: [{x,y}],
 *              style, leader, scale}
 * \return the callout id, or null
 */
CalloutWrite.createSection = function(doc, di, spec) {
    var style = spec.style || "annotation";
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);

    var id = CsCallout.newId();
    var scale = (spec.scale === undefined || spec.scale === null) ?
        CsSectionDraw.scaleOf() : spec.scale;

    // The definition first: the reference cannot exist without a block
    // id to point at.
    var blockId = CsSectionDraw.define(doc, di, id, spec.cut,
        { from: spec.from, to: spec.to, t: spec.t, scale: scale });
    if (blockId === null) {
        return null;
    }

    var at = new RVector(spec.position.x, spec.position.y);
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, at, new RVector(1, 1), 0.0));
    ref.setLayerId(doc.getLayerId(layerName));

    var shape = spec.leader || CsCallout.LEADER_DEFAULT;
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry (CsDraw.js:10).
    CsTags.set(ref, CsCallout.KEY.ID, id);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.STYLE, style);
    CsTags.set(ref, CsCallout.KEY.SIDE, "auto");
    CsTags.set(ref, CsCallout.KEY.LEADER, shape);
    CsTags.set(ref, CsCallout.KEY.SECTION_FROM, spec.from);
    CsTags.set(ref, CsCallout.KEY.SECTION_TO, spec.to);
    CsTags.set(ref, CsCallout.KEY.SECTION_FRACTION, String(spec.t));
    CsTags.set(ref, CsCallout.KEY.SECTION_SCALE, String(scale));
    CsTags.set(ref, CsCallout.KEY.SECTION_NEAREST,
        String(spec.cut.nearest));

    var op = new RAddObjectsOperation();
    op.setText("Place cross section");
    op.addObject(ref, false);

    CalloutWrite.addSectionLeaders(doc, op, id, spec.cut, scale, at,
        spec.tips, style, layerName);
    di.applyOperation(op);
    return id;
};

/**
 * One straight two-vertex leader entity, tagged and queued in `op`. The
 * entity-construction step every section leader shares -- what differs
 * between callers is only where the far end lands: addSectionLeaders
 * stops it short of the section's own outline, while a sketch has no
 * outline to stop at and runs straight to `to`.
 *
 * `from` FIRST: RLeaderData puts its arrowhead on the first vertex.
 */
CalloutWrite.oneLeader = function(doc, op, id, from, to, style,
        layerName) {
    var pl = new RPolyline();
    pl.appendVertex(new RVector(from.x, from.y));
    pl.appendVertex(new RVector(to.x, to.y));
    var ent = new RLeaderEntity(doc, new RLeaderData(pl, true));
    ent.setLayerId(doc.getLayerId(layerName));
    CsTags.set(ent, CsCallout.KEY.ID, id);
    CsTags.set(ent, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
    CsTags.set(ent, CsCallout.KEY.STYLE, style);
    op.addObject(ent, false);
    return ent;
};

/**
 * The leaders for a section: one straight line from each picked point
 * to where it FIRST meets the section's own linework, aimed at the
 * section's centroid.
 *
 * Not CsCallout.reflow, which lands on a bounding BOX with a shoulder.
 * A section is a shape, not a block of text, and a leader that stops on
 * the outline it points at reads as pointing at the passage rather than
 * at the rectangle around it. Nathan's call, and the reason the shape
 * is available here at all is that the cut is passed in rather than
 * measured off the placed block.
 *
 * A pick INSIDE the section gets no leader: there is nothing to stop at
 * and a zero-length leader is just an arrowhead in the middle of the
 * drawing.
 */
CalloutWrite.addSectionLeaders = function(doc, op, id, cut, scale, at,
        tips, style, layerName) {
    var points = CsSectionDraw.localPoints(cut, scale);
    for (var i = 0; i < tips.length; i++) {
        var localTip = { x: tips[i].x - at.x, y: tips[i].y - at.y };
        var stop = CsSectionDraw.leaderStop(points, localTip);
        if (stop === null) {
            continue;
        }
        CalloutWrite.oneLeader(doc, op, id, tips[i],
            { x: at.x + stop.x, y: at.y + stop.y }, style, layerName);
    }
};

/**
 * Move a sketch's leader to run from the station's CURRENT position to
 * the block reference's CURRENT position, straight.
 *
 * NOTHING TO DO IS NOT A WRITE -- writeLeaders' own guard (above),
 * reused rather than re-invented: signatureOfLeaders/geometrySignature
 * already know how to tell "this leader already ends here" from "it
 * doesn't", and that comparison is what stopped CaveCAD freezing once
 * before. An unmoved station reproduces the same two points on every
 * pass; rewriting them anyway is a transaction the callout listener
 * hears regardless, and the listener's re-entrancy guard does not save
 * it -- a queued signal still arrives after the guard has cleared.
 */
CalloutWrite.reanchorSketchLeader = function(doc, di, id, m, stationAt) {
    var refAt = m.block.getData().getPosition();
    var branch = [ { x: stationAt.x, y: stationAt.y },
        { x: refAt.x, y: refAt.y } ];
    if (CalloutWrite.signatureOfLeaders(m.leaders) ===
            CalloutWrite.geometrySignature([branch])) {
        return;
    }
    var style = CsTags.get(m.block, CsCallout.KEY.STYLE) ||
        CsCallout.STYLE_DEFAULT;
    var layerName = CsCallout.STYLES[style] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    var op = new RAddObjectsOperation();
    op.setText("Re-anchor sketched section leader");
    for (var i = 0; i < m.leaders.length; i++) {
        op.deleteObject(m.leaders[i]);
    }
    CalloutWrite.oneLeader(doc, op, id, stationAt, refAt, style,
        layerName);
    di.applyOperation(op);
};

/**
 * Re-derive every cross section in the drawing and redefine its block.
 *
 * The shape refreshElevations established one kind over: provenance off
 * the entity, the guard, and a LOST count for a basis that has gone --
 * never a silent delete.
 *
 * What this never writes is the block REFERENCE. Position, scale and
 * rotation are the caver's; only the definition is the tool's.
 *
 * \return {updated, unchanged, frozen, lost, refused, sketched}
 */
CalloutWrite.refreshSections = function(doc, di, survey, resolved) {
    var out = { updated: 0, unchanged: 0, frozen: 0, lost: 0, refused: 0,
        sketched: 0 };
    if (isNull(doc) || isNull(di) || isNull(survey) || isNull(resolved)) {
        return out;
    }
    var ids = CalloutWrite.existingIds(doc);
    var byStation = CsLrud.splaysByStation(survey);

    for (var i = 0; i < ids.length; i++) {
        var m = CalloutWrite.members(doc, ids[i]);
        if (m.block === null) {
            continue;
        }
        if (CsTags.get(m.block, CsCallout.KEY.KIND) !==
                CsCallout.KIND_SECTION) {
            continue;
        }
        // TRACED BY HAND, from a scan. There is nothing to re-derive:
        // the geometry never came from the survey, so "refreshing" it
        // would mean replacing a caver's tracing with an LRUD box.
        // Left alone and COUNTED, the same treatment SECTION_FROZEN
        // already gets below -- it was just never generated in the
        // first place, so there is no "frozen" state to enter.
        //
        // The LEADER is a different story. It points at a STATION, and
        // loop closure moves stations by real distances -- a leader
        // left where the station USED TO BE is wrong on a plotted map,
        // silently. So the block stays untouched but the leader still
        // follows, same as a computed section's leader does below.
        if (CsTags.get(m.block, CsCallout.KEY.SECTION_SOURCE) ===
                CsCallout.SOURCE_SKETCH) {
            var station = CsTags.get(m.block, CsCallout.KEY.SECTION_STATION);
            var stationAt = resolved.stations[station];
            if (station === "" || stationAt === undefined) {
                // The station this sketch is leadered to is gone from
                // the survey. Same treatment as a computed section's
                // vanished leg below: left alone and counted lost,
                // never deleted.
                out.lost++;
                continue;
            }
            try {
                CalloutWrite.reanchorSketchLeader(doc, di, ids[i], m,
                    { x: stationAt.x, y: stationAt.y });
            } catch (eSketchLead) {
                // the block itself is untouched either way; a leader
                // left on its old spot is wrong but visible, which
                // beats a half-applied operation
            }
            out.sketched++;
            continue;
        }
        // The caver owns this one's geometry now. Counted, never
        // silently skipped: a stale section on a plotted map is exactly
        // the failure this refresh exists to prevent.
        if (CsTags.get(m.block, CsCallout.KEY.SECTION_FROZEN) === "1") {
            out.frozen++;
            continue;
        }

        var from = CsTags.get(m.block, CsCallout.KEY.SECTION_FROM);
        var to = CsTags.get(m.block, CsCallout.KEY.SECTION_TO);
        var t = parseFloat(CsTags.get(m.block,
            CsCallout.KEY.SECTION_FRACTION));
        if (from === "" || to === "" || isNaN(t)) {
            out.lost++;
            continue;
        }
        if (resolved.stations[from] === undefined ||
                resolved.stations[to] === undefined) {
            // The leg this section was cut on is gone from the survey.
            // Left alone and COUNTED -- a section whose basis has
            // vanished is what a caver needs told, not deleted.
            out.lost++;
            continue;
        }

        var scale = parseFloat(CsTags.get(m.block,
            CsCallout.KEY.SECTION_SCALE));
        if (isNaN(scale) || scale <= 0) {
            scale = CsSectionDraw.scaleOf();
        }
        var cut = CsSectionCut.cut(survey, resolved, from, to, t,
            { splaysByStation: byStation });
        if (cut.refused === true) {
            out.refused++;
            continue;
        }
        CsSectionDraw.define(doc, di, ids[i], cut,
            { from: from, to: to, t: t, scale: scale });

        // The outline moved, so where each leader STOPS moved with it.
        // Rebuild them from their own tips -- the picked points, which
        // are the one thing about a leader that is the caver's.
        try {
            var at = m.block.getData().getPosition();
            var tips = [];
            var li;
            for (li = 0; li < m.leaders.length; li++) {
                var v0 = m.leaders[li].getData().getVertexAt(0);
                tips.push({ x: v0.x, y: v0.y });
            }
            if (tips.length > 0) {
                var lop = new RAddObjectsOperation();
                lop.setText("Re-aim cross section leaders");
                for (li = 0; li < m.leaders.length; li++) {
                    lop.deleteObject(m.leaders[li]);
                }
                var lstyle = CsTags.get(m.block, CsCallout.KEY.STYLE) ||
                    CsCallout.STYLE_DEFAULT;
                CalloutWrite.addSectionLeaders(doc, lop, ids[i], cut,
                    scale, at, tips, lstyle,
                    CsCallout.STYLES[lstyle] ||
                        CsCallout.STYLES[CsCallout.STYLE_DEFAULT]);
                di.applyOperation(lop);
            }
        } catch (eLead) {
            // the section itself redrew; a leader left pointing at the
            // old edge is wrong but visible, which beats losing it
        }

        try {
            CsTags.set(m.block, CsCallout.KEY.SECTION_NEAREST,
                String(cut.nearest));
            var mop = new RModifyObjectsOperation();
            mop.setText("Record section provenance");
            mop.addObject(m.block, false);
            di.applyOperation(mop);
        } catch (eTag) {
            // the section itself redrew; only its recorded distance is
            // stale, and the caption inside the block carries the value
        }
        out.updated++;
    }
    return out;
};

CalloutWrite.unlink = function(di, entity) {
    if (isNull(entity)) {
        return;
    }
    for (var name in CsCallout.KEY) {
        if (CsCallout.KEY.hasOwnProperty(name)) {
            CsTags.remove(entity, CsCallout.KEY[name]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.addObject(entity, false);
    di.applyOperation(op);
};
