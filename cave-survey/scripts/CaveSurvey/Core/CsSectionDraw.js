// CsSectionDraw.js -- putting a cut cross section into a drawing, as a
// BLOCK.
//
// Part of the Cave Survey Core library. QCAD context only: every
// function here takes the document and interface EXPLICITLY, the rule
// CsProfileDraw already follows.
//
// ONE BLOCK DEFINITION PER SECTION, named CS_<CalloutId>. Not a shared
// definition, and that is Nathan's requirement rather than an
// implementation taste: "make each a block so that I can edit them
// individually and have them move as a unit rather than loose
// linework". A shared definition would make editing any section edit
// every section.
//
// WHAT REGENERATION TOUCHES, AND WHAT IT NEVER TOUCHES:
//   * the DEFINITION is the tool's. Every Draw clears it and redraws
//     it, so a section follows the survey.
//   * the REFERENCE -- position, scale, rotation -- is the caver's.
//     Nothing here writes it. Probed 2026-08-29: redefining moved a
//     placed instance's bounding box from 100,100->110,100 to
//     100,100->100,140 while its insertion point stayed at 100,100.
//
// A caver who wants to keep hand edits to the geometry sets
// SectionFrozen on the reference; the refresh then skips it and COUNTS
// it, so a frozen section is never silently stale. Exploding the block
// is the hard exit -- it drops the tags and leaves regeneration behind.
//
// BLOCK-LOCAL COORDINATES. The definition is drawn about its own
// origin: the centreline point of the cut. So the reference's insertion
// point IS where the centreline sits on the sheet, and the caver drags
// the whole section by dragging that.

var CsSectionDraw = {};

/**
 * Drawing units per survey unit inside a section.
 *
 * ONE, deliberately -- a section is BORN AT PLAN SCALE and enlarged
 * afterwards by scaling the block reference, which is Nathan's call:
 * "if sections are drawn as blocks, then we can manually scale them
 * later, upon creation, make them 1:1". It went to 0.5 briefly and came
 * straight back: "i changed my mind of the scale, go back to 1".
 *
 * The original default was 2.0, on the reasoning that a section drawn at
 * plan scale is a smudge -- a three-metre passage on a 1:500 sheet --
 * so a section should carry its own scale and say so in its caption.
 * That reasoning is about the FINISHED sheet, and it was being applied
 * at the wrong moment: baking 2x in at capture makes the enlargement
 * invisible and un-undoable, and it silently doubled a hand-traced
 * sketch against the survey it was traced from.
 *
 * A block reference carries scale of its own, so the enlargement is a
 * property the caver sets and can see. Capture already preserves it
 * across an Edit Sketch round trip (SectionCapture's refScale), so a
 * section scaled by hand stays scaled.
 *
 * NOT retroactive. A section already in a drawing carries its own
 * SECTION_SCALE tag and CalloutWrite regenerates from THAT, falling
 * back here only when the tag is missing or unreadable -- so sections
 * captured at 2.0 keep being drawn at 2.0.
 */
CsSectionDraw.SCALE = 1.0;
CsSectionDraw.SETTING_SCALE = "CaveSurvey/SectionScale";

/** The tag every generated member of a section carries. */
CsSectionDraw.TAG = "Section";

/** The block definition's name for a callout id. One per section. */
CsSectionDraw.blockName = function(calloutId) {
    return "CS_" + String(calloutId);
};

/** The scale a drawing uses for its sections. */
CsSectionDraw.scaleOf = function() {
    try {
        var v = RSettings.getDoubleValue(CsSectionDraw.SETTING_SCALE,
            CsSectionDraw.SCALE);
        return (v > 0) ? v : CsSectionDraw.SCALE;
    } catch (e) {
        return CsSectionDraw.SCALE;
    }
};

/**
 * A polygon point in block-local drawing coordinates.
 *
 * THE AXIS SWAP IS DELIBERATE. In the cut, theta is measured from the
 * frame's r -- which is WORLD UP -- toward s, the horizontal across the
 * passage. On the sheet up must be up, so r maps to +Y and s to +X:
 *   x = sin(theta) * radius   (across the passage)
 *   y = cos(theta) * radius   (up)
 * Mapping theta to x directly draws every section on its side, which is
 * what the first smoke test against a real document showed.
 *
 * With s = d x r, +X is the right-hand side looking ALONG the passage
 * direction -- the convention a section is read in.
 */
CsSectionDraw.pointOf = function(sample, scale) {
    return { x: Math.sin(sample.theta) * sample.radius * scale,
             y: Math.cos(sample.theta) * sample.radius * scale };
};

/** pointOf as the RVector the drawing calls want. QCAD only. */
CsSectionDraw.vectorOf = function(sample, scale) {
    var p = CsSectionDraw.pointOf(sample, scale);
    return new RVector(p.x, p.y);
};

/** The outline as plain block-local points. Pure, so the leader maths
 *  below is testable under node. */
CsSectionDraw.localPoints = function(cut, scale) {
    var out = [];
    for (var i = 0; i < cut.outline.length; i++) {
        out.push(CsSectionDraw.pointOf(cut.outline[i], scale));
    }
    return out;
};

/** The centroid of the section's own outline -- what a leader aims at.
 *  The vertex mean, not the area centroid: the outline is sampled at
 *  even angles, so the two agree closely and this one cannot divide by
 *  a zero area on a degenerate cut. */
CsSectionDraw.centroidOf = function(points) {
    if (points.length === 0) {
        return { x: 0, y: 0 };
    }
    var sx = 0, sy = 0;
    for (var i = 0; i < points.length; i++) {
        sx += points[i].x;
        sy += points[i].y;
    }
    return { x: sx / points.length, y: sy / points.length };
};

/**
 * Where a leader aimed at the section's centroid FIRST meets the
 * section's own linework -- the point the leader should stop at, so it
 * touches the outline rather than burying its head inside the drawing.
 *
 * Everything is block-local. `from` is the picked point expressed in
 * the block's own frame (world tip minus the block's insertion point).
 *
 * \return {x, y}, or null when the segment never crosses the outline
 *         (the pick is INSIDE the section, where there is nothing to
 *         stop at and the caller draws no leader at all)
 */
CsSectionDraw.leaderStop = function(points, from) {
    if (points.length < 3) {
        return null;
    }
    var to = CsSectionDraw.centroidOf(points);
    var dx = to.x - from.x, dy = to.y - from.y;
    var bestT = null;
    for (var i = 0; i < points.length; i++) {
        var a = points[i], b = points[(i + 1) % points.length];
        var ex = b.x - a.x, ey = b.y - a.y;
        var den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) {
            continue;                       // parallel
        }
        // t along from->to, u along the outline segment
        var t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
        var u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            if (bestT === null || t < bestT) {
                bestT = t;
            }
        }
    }
    if (bestT === null) {
        return null;
    }
    return { x: from.x + dx * bestT, y: from.y + dy * bestT };
};

/** One entity into the block definition, layered and tagged. Layer and
 *  tags BEFORE the add -- post-add writes fail silently in this bridge
 *  (see CsDraw.js's header). */
CsSectionDraw.addToBlock = function(doc, op, blockId, entity, layerName,
        sectionId) {
    entity.setLayerId(doc.getLayerId(layerName));
    entity.setBlockId(blockId);
    CsTags.set(entity, CsSectionDraw.TAG, sectionId);
    op.addObject(entity, false);
    return entity;
};

/** The caption a section carries: what it is, and how far it is from
 *  the evidence. */
CsSectionDraw.captionText = function(from, to, t, cut, scale) {
    var pct = Math.round(t * 100);
    var text = from + "->" + to + " " + pct + "%  " +
        CsSectionDraw.scaleText(scale);
    // The honesty gradient, stated rather than implied: a cut beside a
    // station is nearly a measurement, one midway between distant
    // stations is a guess.
    text += "  (" + CsSectionDraw.round1(cut.nearest) + " from nearest)";
    if (cut.reentrant === true) {
        text += "  re-entrant simplified";
    }
    if (cut.reseeded === true) {
        text += "  rotated";
    }
    return text;
};

CsSectionDraw.round1 = function(v) {
    return Math.round(v * 10) / 10;
};

/** The scale as a ratio a reader can act on: a section drawn FOUR
 *  times survey size reads "4:1", not "1:0.25". */
CsSectionDraw.scaleText = function(scale) {
    if (scale >= 1) {
        return CsSectionDraw.ratioPart(scale) + ":1";
    }
    return "1:" + CsSectionDraw.ratioPart(1.0 / scale);
};

CsSectionDraw.ratioPart = function(v) {
    return (Math.abs(v - Math.round(v)) < 1e-9) ?
        String(Math.round(v)) : String(CsSectionDraw.round1(v));
};

/**
 * Create or REDEFINE the block for one section.
 *
 * Everything goes into ONE operation, so a redefine is one undo step
 * and a Draw that regenerates many sections does not leave the drawing
 * half-updated.
 *
 * \param cut  a CsSectionCut.cut result (not a refusal)
 * \return the block id, or null when the block could not be made
 */
CsSectionDraw.define = function(doc, di, sectionId, cut, opts) {
    var o = opts || {};
    var scale = (o.scale === undefined || o.scale === null) ?
        CsSectionDraw.scaleOf() : o.scale;
    var name = CsSectionDraw.blockName(sectionId);
    var i;

    var blockId = doc.getBlockId(name);
    if (blockId === RBlock.INVALID_ID || blockId === undefined ||
            blockId === null || blockId < 0) {
        var block = new RBlock(doc, name, new RVector(0, 0));
        di.applyOperation(new RAddObjectOperation(block, false));
        blockId = doc.getBlockId(name);
    }
    if (blockId === RBlock.INVALID_ID || blockId < 0) {
        return null;
    }

    // NOT SECTION_SPLAYS. An earlier draft drew a ray from the centre
    // to every sampled point as visible evidence of what was measured.
    // Nathan's call: they are not wanted on the drawing. The outline
    // and the caption's measured-point counts carry the same
    // information without the clutter, and the layer stays registered
    // for the day a splay overlay is wanted deliberately.
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_OUTLINE);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_STATIONS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_TEXT_LABELS);

    var op = new RAddObjectsOperation();
    op.setText("Draw cross section");

    // Clear what the generator drew last time. The block holds ONLY
    // generated content -- a caver who wants to keep their own edits
    // freezes the section or explodes the block, both of which take it
    // out of this path entirely.
    var existing = doc.queryBlockEntities(blockId);
    for (i = 0; i < existing.length; i++) {
        var old = doc.queryEntity(existing[i]);
        if (!isNull(old)) {
            op.deleteObject(old);
        }
    }

    // The outline, closed, through the sampled points.
    if (cut.outline.length >= 3) {
        var pl = new RPolyline();
        for (i = 0; i < cut.outline.length; i++) {
            pl.appendVertex(CsSectionDraw.vectorOf(cut.outline[i], scale));
        }
        pl.setClosed(true);
        CsSectionDraw.addToBlock(doc, op, blockId,
            new RPolylineEntity(doc, new RPolylineData(pl)),
            CsLayers.CTRL_SECTION_OUTLINE, sectionId);
    }

    // The centreline mark: a small cross at the cut point itself.
    var tick = Math.max(0.5, scale * 0.5);
    CsSectionDraw.addToBlock(doc, op, blockId,
        new RLineEntity(doc, new RLineData(new RVector(-tick, 0),
            new RVector(tick, 0))),
        CsLayers.CTRL_SECTION_STATIONS, sectionId);
    CsSectionDraw.addToBlock(doc, op, blockId,
        new RLineEntity(doc, new RLineData(new RVector(0, -tick),
            new RVector(0, tick))),
        CsLayers.CTRL_SECTION_STATIONS, sectionId);

    // The caption, under the section.
    var lowest = 0;
    for (i = 0; i < cut.outline.length; i++) {
        var y = Math.cos(cut.outline[i].theta) * cut.outline[i].radius * scale;
        if (y < lowest) { lowest = y; }
    }
    var height = CsSectionDraw.textHeight(doc);
    var caption = CsSectionDraw.captionText(o.from || "?", o.to || "?",
        (o.t === undefined ? 0 : o.t), cut, scale);
    var pos = new RVector(0, lowest - height * 1.5);
    // The FULL constructor, with position AND alignment point, in the
    // exact argument shape CalloutWrite.buildOp already proves against
    // this bridge. setPosition() alone reads back correctly while the
    // entity renders at the ORIGIN -- that shipped once.
    var td = new RTextData(pos, pos, height, 100.0,
        RS.VAlignTop, RS.HAlignCenter, RS.LeftToRight, RS.Exact,
        1.0, caption, "standard", false, false, 0.0, false);
    CsSectionDraw.addToBlock(doc, op, blockId,
        new RTextEntity(doc, td),
        CsLayers.CTRL_SECTION_TEXT_LABELS, sectionId);

    di.applyOperation(op);
    return blockId;
};

/**
 * The section's own extent in BLOCK-LOCAL coordinates, worked out from
 * the cut rather than measured off the drawing.
 *
 * Analytic on purpose. A block reference's bounding box is CACHED and a
 * redefine does not invalidate it (CalloutWrite.boxOf's docblock records
 * what that cost once already), so a leader solved against a freshly
 * placed reference would be solved against a stale box. Computing the
 * box from the same numbers that drew the geometry cannot be stale, and
 * it lets the reference and its leaders land in ONE operation.
 *
 * \return {x1, y1, x2, y2}
 */
CsSectionDraw.localBox = function(cut, scale, height) {
    var x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    for (var i = 0; i < cut.outline.length; i++) {
        // the same mapping pointOf uses -- up is +Y
        var x = Math.sin(cut.outline[i].theta) * cut.outline[i].radius * scale;
        var y = Math.cos(cut.outline[i].theta) * cut.outline[i].radius * scale;
        if (x < x1) { x1 = x; }
        if (x > x2) { x2 = x; }
        if (y < y1) { y1 = y; }
        if (y > y2) { y2 = y; }
    }
    // the caption hangs below, where define() puts it
    y1 -= height * 2.5;
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
};

/** The drawing's own text height, the same source the callouts use. */
CsSectionDraw.textHeight = function(doc) {
    try {
        if (typeof CalloutWrite !== "undefined" &&
                typeof CalloutWrite.textHeight === "function") {
            return CalloutWrite.textHeight(doc);
        }
    } catch (e) {
    }
    return 2.5;
};
