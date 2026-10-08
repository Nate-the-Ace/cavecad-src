// ShapedLinesRun.js -- the shared freehand draw action behind every
// Shaped Lines toolbar button. Press, drag, release: the drag becomes
// the SPINE (spline, or closed polyline for the pit), and the style's
// decoration -- ledge hachures or scallops -- is generated in the same
// operation, so one undo removes the whole feature.
//
// The press/drag/release shape, screen-space sampling and snap
// suspension are FeatureTraceRun's, which in turn derives from QCAD's
// LineFreehand (GPLv3). Resample/reduce/fit are CsTrace's; the
// decoration math is CsShapeLine's.
//
// NOT an add-on QCAD can find on its own (AddOn.getAddOns only builds
// <dir>/<dir>.js). ShapedLines.init() registers the five per-style
// subclasses in the sibling *Draw.js files; each of those sets
// prototype.styleKey and nothing else.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function ShapedLinesRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
    this.spinePts = null;    // the fitted spine, kept for the side pick
    this.spineClosed = false;
    this.side = 1;           // which way the ornament faces, live
    this.previewSample = null;  // the spine walked once, reused per move
    this.previewSeed = null;    // "glyphs" only: rolled once per stroke
    this.pathFrame = null;   // plan / profile / section, decided at release
    this.growId = null;      // the spine this stroke continues, if any
    this.extendForced = false;  // Shift was held at the press
    this.region = null;      // cached profile-frame box
    this.bays = [];          // cached open section-bay rects
    this.savedSnap = null;   // snap CLASS NAME to restore on exit
}

ShapedLinesRun.prototype = new EAction();

/** Subclasses override. Kept on the prototype so one file carries the
 *  whole behavior and a subclass is three lines. */
ShapedLinesRun.prototype.styleKey = "floorledge";

ShapedLinesRun.State = {
    Idle: 0,
    Drawing: 1,
    PickingSide: 2
};

/** Screen pixels between kept samples -- FeatureTraceRun's value, for
 *  FeatureTraceRun's reasons (drawing-space thresholds are sub-pixel
 *  zoomed out and laggy zoomed in). */
ShapedLinesRun.SAMPLE_PIXELS = 6;

/** Spine fidelity: resample interval in FEET and the reduce tolerance
 *  as a fraction of it. FeatureTrace's defaults (1 ft, Fine). */
// One number for every trace in the suite -- see CsTrace.INTERVAL_FEET.
// A shaped line's SPINE is sampled like any other trace; the spacing of
// its ticks and scallops is a separate per-style number and is not this.
// Read at CALL time (see the same note in FeatureTrace): a load-time
// read of Core from a tool file depends on an include order nothing here
// guarantees.
ShapedLinesRun.intervalFeet = function() {
    return CsTrace.INTERVAL_FEET;
};
ShapedLinesRun.TOLERANCE_FRACTION = 0.05;

/**
 * The last shaped line this tool committed: {shapeId, layer, style, doc}.
 *
 * FeatureTraceRun.lastTrace's twin, and module state for its reason:
 * arming another tile builds a new action, which is the middle of
 * drawing a passage. The SHAPE ID rather than the entity id, because a
 * spine is regrown in place and re-found by its tag.
 */
ShapedLinesRun.lastSpine = null;

ShapedLinesRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(ShapedLinesRun.State.Idle);
    this.refreshFrames();

    // Grid snap staircases a freehand drag; suspend, restore in
    // finishEvent whatever way the action ends.
    this.savedSnap = CsTrace.suspendSnap(this.getDocumentInterface());
};

ShapedLinesRun.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);
    CsTrace.restoreSnap(this.getDocumentInterface(), this.savedSnap);
    this.savedSnap = null;
};

ShapedLinesRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    var spec = CsShapeLine.STYLES[this.styleKey];
    var label = isNull(spec) ? this.styleKey : spec.label;

    switch (this.state) {
    case ShapedLinesRun.State.Idle:
        var trStart = qsTr("Press and drag to draw: %1").arg(label);
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        break;

    case ShapedLinesRun.State.Drawing:
        var trStop = (!isNull(spec) && spec.close === true) ?
            qsTr("Drag round the edge and release near where you " +
                "pressed -- a pit is a loop") :
            qsTr("Release where the line ends");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;

    case ShapedLinesRun.State.PickingSide:
        // The whole point of this state, said in the words a caver
        // thinks in: the low side, not "side of travel".
        var trSide = qsTr("%1: move to the side the ornament goes -- " +
            "the low side -- and click").arg(label);
        this.setCommandPrompt(trSide);
        this.setLeftMouseTip(qsTr("Put the ornament here"));
        this.setRightMouseTip(EAction.trCancel);
        break;
    }
};

/**
 * Recomputes the cached profile region and the open section bays.
 *
 * Both walk EVERY entity in the drawing, which is why they are cached
 * at all. Refreshed at the start of the action and again at the top of
 * every press, because Sketch Section and Capture Section can open and
 * close a bay while this action is still armed -- a stale bay list
 * would route a section stroke to the plan family, or a plan stroke to
 * a bay that is no longer there.
 */
ShapedLinesRun.prototype.refreshFrames = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
    this.bays = isNull(doc) ? [] : CsTrace.sectionBays(doc);
};

/** SAMPLE_PIXELS at the current zoom, in drawing units. */
ShapedLinesRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return ShapedLinesRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; over-sample rather than under-sample
    }
    return 1.0;
};

/**
 * The colour the live side-pick preview is drawn in.
 *
 * QCAD's own measurement colour, so it matches the rest of the
 * application's "this is not your drawing, this is the tool talking"
 * vocabulary, and falls back to the same green it defaults to.
 */
ShapedLinesRun.previewColor = function() {
    try {
        return RSettings.getColor("GraphicsViewColors/MeasurementToolsColor",
            new RColor(155, 220, 112));
    } catch (e) {
        return new RColor(155, 220, 112);
    }
};

/** Draws one preview entity boldly: the tool's colour, at a weight that
 *  reads over a scanned page. Each property is set on its own so a
 *  bridge that refuses one still gets the others. */
ShapedLinesRun.emphasize = function(entity) {
    try {
        entity.setColor(ShapedLinesRun.previewColor());
    } catch (eColor) {
    }
    try {
        entity.setLineweight(RLineweight.Weight050);
    } catch (eWeight) {
    }
};

ShapedLinesRun.prototype.escapeEvent = function() {
    if (this.state === ShapedLinesRun.State.Drawing ||
            this.state === ShapedLinesRun.State.PickingSide) {
        // Nothing is applied until the side is picked, so an abandoned
        // stroke leaves the drawing exactly as it was -- no undo step
        // for the caver to notice or step over.
        this.discard();
        this.setState(ShapedLinesRun.State.Idle);
        return;
    }
    // The panel's tile stops claiming to be armed -- see
    // FeatureTraceRun.escapeEvent for why this is escapeEvent's job
    // and not finishEvent's.
    if (typeof FeatureTrace !== "undefined") {
        try {
            FeatureTrace.disarmTiles();
        } catch (eDis) {
        }
    }
    EAction.prototype.escapeEvent.call(this);
};

/** Throws away a stroke in progress. */
ShapedLinesRun.prototype.discard = function() {
    this.samples = [];
    this.previewSample = null;
    this.previewSeed = null;
    this.spinePts = null;
    this.spineClosed = false;
    this.pathFrame = null;
    this.growId = null;
    try {
        this.getDocumentInterface().clearPreview();
        this.getDocumentInterface().repaintViews();
    } catch (e) {
    }
};

ShapedLinesRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    // THE SECOND CLICK COMMITS. Between the release and this click the
    // feature is only a preview, following the cursor from one side of
    // the spine to the other; this is the caver saying "that side".
    if (this.state === ShapedLinesRun.State.PickingSide) {
        this.updateSide(event.getModelPosition());
        this.commit();
        this.discard();
        this.setState(ShapedLinesRun.State.Idle);
        return;
    }
    if (this.state !== ShapedLinesRun.State.Idle) {
        return;
    }
    var p = event.getModelPosition();
    // SHIFT MEANS "MORE OF THAT LINE", read at the press and kept for
    // the stroke -- FeatureTraceRun's rule, the same words. See
    // extendTarget.
    this.extendForced = false;
    try {
        this.extendForced = (event.modifiers().valueOf() &
            Qt.ShiftModifier.valueOf()) !== 0;
    } catch (eMod) {
    }
    this.growId = null;
    // Once per stroke, before the frame that routes this feature's
    // layers is decided from it. See refreshFrames.
    this.refreshFrames();
    this.setState(ShapedLinesRun.State.Drawing);
    this.samples = [{ x: p.x, y: p.y }];
};

ShapedLinesRun.prototype.mouseMoveEvent = function(event) {
    if (this.state === ShapedLinesRun.State.PickingSide) {
        // Button UP: the ornament follows the cursor across the spine,
        // so the answer is on screen before the click rather than after
        // it. This is the step that replaces select-then-Flip.
        //
        // REDRAWN ON EVERY MOVE, not only when the side changes. QCAD
        // CLEARS THE PREVIEW between mouse events, so an event that
        // added nothing back left the feature invisible until the next
        // one that did -- the preview flickered under the cursor even
        // while it sat on one side, which is exactly when a caver is
        // trying to look at it (reported 2026-09-07).
        this.updateSide(event.getModelPosition());
        this.updatePreview();
        return;
    }
    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== ShapedLinesRun.State.Drawing) {
        return;
    }
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };
    var last = this.samples[this.samples.length - 1];
    if (isNull(last) ||
            CsTrace.distance(last, here) >= this.sampleThreshold()) {
        this.samples.push(here);
        this.updatePreview();
    }
};

ShapedLinesRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== ShapedLinesRun.State.Drawing) {
        return;
    }
    // The stroke is finished; the FEATURE is not. Fit the spine now --
    // resample, reduce, close a pit -- so the side pick has real
    // geometry to measure the cursor against and the preview shows the
    // line the caver will actually get.
    if (!this.prepare()) {
        this.discard();
        this.setState(ShapedLinesRun.State.Idle);
        return;
    }

    this.growId = this.extendTarget();
    if (!this.needsSidePick()) {
        this.commit();
        this.discard();
        this.setState(ShapedLinesRun.State.Idle);
        return;
    }

    this.setState(ShapedLinesRun.State.PickingSide);
    this.updatePreview();
};

/**
 * Does this stroke have a side left to ask about?
 *
 * TWO STROKES DO NOT, and both commit at the release rather than
 * spending a second click on a question already answered:
 *
 *   AN EXTENSION. The line being continued already has a side, and it
 *   is the same line -- asking again would let a caver put the
 *   hachures of one ledge on both sides of itself.
 *
 *   A PIT. Its hachures point into the hole and no cursor position
 *   changes that (CsShapeLine.sideForPoint answers inward for a closed
 *   path, wherever the cursor is), so the pick state was a prompt
 *   asking a question whose answer it then ignored -- which reads
 *   exactly like a broken tool: you move, and nothing on screen moves
 *   (reported by Nathan, 2026-09-11). The side comes from the loop's
 *   own winding, in prepare().
 */
ShapedLinesRun.prototype.needsSidePick = function() {
    return this.growId === null && this.spineClosed !== true;
};

/**
 * The SPINE this stroke should grow, as its entity id, or null to draw
 * a new feature.
 *
 * FeatureTraceRun.extendTarget's rule, with two more conditions that
 * only shaped lines have:
 *
 *   SAME STYLE. A ledge does not become more of a flowstone because it
 *   started where one ended. The tiles are different features and the
 *   ornament is what makes them so. NOT implied by the layer check:
 *   flowstone, rimstone and slope share one spine layer.
 *
 *   NEVER A PIT, and with no guard of its own: a pit's spine is a
 *   closed POLYLINE, CsTrace.growCurve refuses anything that is not a
 *   control-point curve, and growExisting then falls through to
 *   drawing a new feature. A closed loop has no end to carry on from
 *   anyway, and its hachures point inward by definition. A guard here
 *   as well would be a second rule saying the same thing, which no
 *   test could tell from the first.
 *
 * Called at the release, so pathFrame and spinePts are decided: the
 * layer compared is the one this stroke would actually land on, which
 * is what stops an elevation ledge continuing a plan one.
 */
ShapedLinesRun.prototype.extendTarget = function() {
    var doc = this.getDocument();
    var spec = CsShapeLine.STYLES[this.styleKey];
    if (isNull(doc) || isNull(spec) ||
            isNull(this.spinePts) || this.spinePts.length < 2) {
        return null;
    }
    var layerName = CsShapeLine.layersFor(spec, this.pathFrame).spine;
    var perFoot = CsShapeLine.perFoot(doc);
    var join = perFoot * CsTrace.TIE_FEET;
    var head = this.spinePts[0];
    var tail = this.spinePts[this.spinePts.length - 1];

    var candidates = [];
    if (this.extendForced === true) {
        // Any shaped line of this style on this layer, whoever drew it
        // and whenever.
        // spines() answers {entity, id} PAIRS, not entities -- reading
        // a tag off the pair answers "" and every candidate would
        // silently drop out, which is a Shift that quietly does
        // nothing.
        var spines = CsShapeLine.spines(doc);
        for (var i = 0; i < spines.length; i++) {
            candidates.push(spines[i].entity);
        }
    } else {
        var last = ShapedLinesRun.lastSpine;
        if (last === null || last.style !== this.styleKey ||
                last.layer !== layerName ||
                last.doc !== CsTrace.docKey(doc)) {
            return null;
        }
        var mine = CsShapeLine.spineOf(doc, last.shapeId);
        if (isNull(mine)) {
            ShapedLinesRun.lastSpine = null;   // undone, or deleted
            return null;
        }
        candidates.push(mine);
    }

    var best = null;
    var bestDist = join;
    for (var c = 0; c < candidates.length; c++) {
        var spine = candidates[c];
        if (CsTags.get(spine, CsShapeLine.KEY.STYLE) !== this.styleKey) {
            continue;
        }
        if (doc.getLayerName(spine.getLayerId()) !== layerName) {
            continue;
        }
        var ends;
        try {
            ends = [spine.getStartPoint(), spine.getEndPoint()];
        } catch (eEnds) {
            continue;
        }
        for (var k = 0; k < ends.length; k++) {
            if (isNull(ends[k])) {
                continue;
            }
            var end = { x: ends[k].x, y: ends[k].y };
            var d = Math.min(CsShapeLine.dist(head, end),
                CsShapeLine.dist(tail, end));
            if (d <= bestDist) {
                bestDist = d;
                best = spine.getId();
            }
        }
    }
    return best;
};

/**
 * Turns the captured drag into the spine points this feature will
 * have, and decides which view it belongs to. Everything up to the
 * side, in other words.
 *
 * \return true when there is a feature to place.
 */
ShapedLinesRun.prototype.prepare = function() {
    var doc = this.getDocument();
    var spec = CsShapeLine.STYLES[this.styleKey];
    if (isNull(doc) || isNull(spec) || this.samples.length < 2) {
        return false;
    }

    // ONE button, ALL THREE views: the stroke's LOCATION decides
    // whether this is plan, elevation or cross-section linework -- see
    // the note in commit(). Decided HERE, at the release, because the
    // side pick that follows moves the cursor away from the stroke and
    // must not be able to change the answer.
    this.pathFrame = CsTrace.pathFrame(this.region, this.samples, this.bays);
    if (this.pathFrame === null) {
        EAction.handleUserMessage(qsTr("%1: that stroke crossed from one " +
            "view into another. Nothing was drawn -- draw within one " +
            "view.").arg(spec.label));
        return false;
    }

    var perFoot = CsShapeLine.perFoot(doc);
    var spacing = perFoot * ShapedLinesRun.intervalFeet();
    var kept = CsTrace.reduce(CsTrace.resample(this.samples, spacing),
        spacing * ShapedLinesRun.TOLERANCE_FRACTION);
    if (kept.length < 2) {
        return false;
    }

    if (spec.close) {
        // A pit is a CLOSED loop: weld the release point to the press
        // point. See commit() for why the spine stays a polyline.
        if (kept.length > 2 && CsShapeLine.dist(kept[0],
                kept[kept.length - 1]) < spacing) {
            kept.pop();
        }
        if (kept.length < 3) {
            EAction.handleUserMessage(qsTr("A pit needs a loop -- drag " +
                "around the edge and release near where you pressed."));
            return false;
        }
        this.spineClosed = true;
        // A pit's hachures point IN, and no cursor position changes
        // that -- so it is decided once, here, from the loop's own
        // winding, and the release commits without a side pick.
        this.side = CsShapeLine.inwardSide(kept);
    } else {
        this.spineClosed = false;
        this.side = 1;
    }
    this.spinePts = kept;
    this.previewSample = null;   // a new stroke, a new spine to walk
    return true;
};

/**
 * Points the ornament at the cursor. Answers true when the side
 * actually changed, so a mouse move that means nothing repaints
 * nothing.
 */
ShapedLinesRun.prototype.updateSide = function(pos) {
    if (isNull(this.spinePts) || isNull(pos)) {
        return false;
    }
    var got = CsShapeLine.sideForPoint(this.spinePts, this.spineClosed,
        { x: pos.x, y: pos.y });
    if (got === null || got === this.side) {
        return false;   // on the line, or no change: keep what we have
    }
    this.side = got;
    return true;
};

/** The spine entity for a set of fitted points: a closed polyline for
 *  a pit, a fitted spline for everything else. One place, so the
 *  preview and the committed feature cannot be different shapes. */
ShapedLinesRun.prototype.buildSpine = function(doc, kept, spec) {
    if (spec.close) {
        // A pit's spine stays an ordinary polyline: a periodic spline
        // is a Pro feature and fails silently in this build.
        var pl = new RPolyline();
        for (var v = 0; v < kept.length; v++) {
            pl.appendVertex(new RVector(kept[v].x, kept[v].y), 0.0);
        }
        pl.setClosed(true);
        return new RPolylineEntity(doc, new RPolylineData(pl));
    }
    return CsTrace.fitSpline(doc, kept);
};

/**
 * The entities the side-pick preview is made of, BUILT ONCE PER SIDE.
 *
 * REBUILT ON EVERY MOVE, AND THAT IS DELIBERATE. The preview has to be
 * re-added on every mouse move -- QCAD clears it between events, and an
 * event that adds nothing back leaves the feature blinking out from
 * under the cursor, which is what the flicker was. Caching the built
 * ENTITIES and re-adding those instead looks like the obvious fix and
 * takes the application down: the first preview owns them, and the
 * second SIGSEGVs inside RTransaction::addObject.
 *
 * What is cached is the SPINE SAMPLE, which is plain data and safe to
 * hold: walking the spine is 20 ms of the 22 on a 400 ft ledge, and
 * everything after it -- the ornament maths and the entities -- is 2.
 * So the same feature is generated fresh every move, by the same
 * CsShapeLine.buildDecor that commits the real thing, on a spine that
 * is only walked once.
 */
ShapedLinesRun.prototype.previewEntities = function() {
    var doc = this.getDocument();
    var spec = CsShapeLine.STYLES[this.styleKey];
    if (isNull(doc) || isNull(spec) || isNull(this.spinePts)) {
        return null;
    }
    var spine = this.buildSpine(doc, this.spinePts, spec);
    if (isNull(spine)) {
        return null;
    }
    // Tagged the way the committed feature is, because buildDecor reads
    // the side, the style and the scale off the spine.
    CsTags.set(spine, CsShapeLine.KEY.STYLE, this.styleKey);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, String(this.side));
    CsTags.set(spine, CsShapeLine.KEY.SCALE, "1");
    CsTags.set(spine, CsShapeLine.KEY.FRAME, this.pathFrame);
    // "glyphs" only: rolled ONCE for this whole drag (cached on `this`,
    // this preview spine is thrown away and rebuilt every move) and
    // reused on every commit call, so the jitter does not visibly
    // reshuffle under the cursor on every mouse-move -- the same seed
    // then gets tagged onto the real spine at commit, so what the caver
    // watched settle into place while dragging is what gets drawn.
    if (spec.kind === "glyphs") {
        if (isNull(this.previewSeed)) {
            this.previewSeed = CsArea.newSeed();
        }
        CsTags.set(spine, CsShapeLine.KEY.SEED, String(this.previewSeed));
    }

    var made = [spine];
    var built = null;
    try {
        // The spine is the same one every time through this state, so
        // its SAMPLE is taken once and handed back in on every later
        // move. That is the whole optimisation: see the note above.
        if (isNull(this.previewSample)) {
            var spacing = spec.spacingFeet * CsShapeLine.perFoot(doc);
            this.previewSample = CsShapeLine.sampleEntity(spine,
                CsShapeLine.sampleStep(spacing));
        }
        built = CsShapeLine.buildDecor(doc, spine, this.previewSample);
    } catch (eDecor) {
        built = null;
    }
    if (!isNull(built)) {
        for (var i = 0; i < built.entities.length; i++) {
            made.push(built.entities[i]);
        }
    }
    // BOLD, AND IN ONE COLOUR. A ledge previews in its layer's own peru
    // on a white sheet over a grey scan, which is the moment a caver
    // most needs to see which side the hachures went. The preview is
    // not the drawing -- it is a question being asked -- so it is drawn
    // in the tool colour at a weight that reads, and the committed
    // feature keeps its proper layer appearance.
    for (var j = 0; j < made.length; j++) {
        ShapedLinesRun.emphasize(made[j]);
    }
    // FRESH ENTITIES EVERY TIME, never a cached set re-added.
    // Previewing the same entity objects twice SIGSEGVs inside
    // RTransaction::addObject -- the first preview takes ownership of
    // them (measured 2026-09-07, and it took the application down).
    // What is cached is the SAMPLE, which is data.
    return made;
};

/**
 * The preview.
 *
 * WHILE DRAGGING it is the raw captured path -- FeatureTraceRun's
 * choice, for its reason: refitting per mouse move buys nothing a caver
 * can see.
 *
 * WHILE PICKING THE SIDE it is the whole feature, ornament included,
 * generated on the side the cursor is on. That is the entire point of
 * the step: the answer is on screen before the click, so nobody has to
 * draw it, look at it, and then reach for Flip.
 */
ShapedLinesRun.prototype.getOperation = function(preview) {
    var doc = this.getDocument();
    var op, i;

    if (this.state === ShapedLinesRun.State.PickingSide &&
            !isNull(this.spinePts)) {
        var made = this.previewEntities();
        if (made === null) {
            return undefined;
        }
        op = new RAddObjectsOperation();
        op.setText(this.getToolTitle());
        op.setLimitPreview(false);
        for (i = 0; i < made.length; i++) {
            op.addObject(made[i], false);
        }
        return op;
    }

    if (this.samples.length < 2) {
        return undefined;
    }
    op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    for (i = 0; i < this.samples.length - 1; i++) {
        op.addObject(new RLineEntity(doc, new RLineData(
            new RVector(this.samples[i].x, this.samples[i].y),
            new RVector(this.samples[i + 1].x, this.samples[i + 1].y))),
            false);
    }
    return op;
};

/**
 * Build the spine + decoration and add BOTH in one operation.
 *
 * One operation is not a nicety: the listener hears every transaction,
 * and a spine landing in its own transaction with no decor yet would
 * match reconcile()'s "all decor gone -> unlink" branch and strip the
 * tags before the decor op arrived. One add = one transaction = the
 * listener only ever sees the feature whole.
 */
ShapedLinesRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || isNull(this.spinePts) ||
            this.spinePts.length < 2) {
        return;
    }

    var spec = CsShapeLine.STYLES[this.styleKey];
    if (isNull(spec)) {
        return;
    }

    // MORE OF THAT LINE. Decided at the release, before the side pick
    // was skipped; if the growth is refused the stroke falls through
    // and becomes its own feature, side pick and all -- except that the
    // side pick is behind us, so it takes the side the preview had.
    if (this.growId !== null && this.growExisting(doc, di, spec)) {
        return;
    }

    // The view was decided at the release (prepare), not here: the side
    // pick moves the cursor off the stroke, and a ledge drawn in the
    // elevation must not become plan linework because the caver
    // reached out of the band to point at its low side.
    var pathFrame = this.pathFrame;
    var frameLayers = CsShapeLine.layersFor(spec, pathFrame);
    var kept = this.spinePts;
    var side = this.side;

    var spine = this.buildSpine(doc, kept, spec);
    if (spine === null) {
        return;
    }

    CsLayers.ensure(doc, di, frameLayers.spine);
    CsLayers.ensure(doc, di, frameLayers.decor);
    spine.setLayerId(doc.getLayerId(frameLayers.spine));

    // Tag BEFORE adding (the CalloutWrite lesson: the add is then the
    // ONLY operation that writes this entity, tags included, so undo
    // is atomic and nothing survives half-tagged). The frame rides on
    // the spine so every regeneration keeps drawing into the family
    // the stroke chose, even after the spine is dragged around.
    CsTags.set(spine, CsShapeLine.KEY.ID, CsUuid.v4());
    CsTags.set(spine, CsShapeLine.KEY.STYLE, this.styleKey);
    CsTags.set(spine, CsShapeLine.KEY.SIDE, String(side));
    CsTags.set(spine, CsShapeLine.KEY.SCALE, "1");
    CsTags.set(spine, CsShapeLine.KEY.FRAME, pathFrame);
    // Which trip's survey this ornament describes, by the same rule
    // Feature Trace stamps a plain feature with -- and written HERE,
    // before the add, so the tag arrives with the spine rather than in
    // a second operation the caver would have to undo separately. The
    // DECOR is deliberately left unstamped: it is regenerated from this
    // spine on every change, and a copy on each hachure would be a
    // hundred stale copies the moment the spine's trip was corrected.
    // growExisting never reaches here, so a grown line keeps its trip.
    CsTags.set(spine, CsTrace.TRIP_TAG,
        CsTrace.tripFor(doc, pathFrame, this.samples, this.bays));
    // Reuse the seed the preview already showed, when there was one --
    // see previewEntities' own note. buildDecor mints a fresh one if
    // this is not set (a programmatic caller with no preview phase).
    if (spec.kind === "glyphs" && !isNull(this.previewSeed)) {
        CsTags.set(spine, CsShapeLine.KEY.SEED, String(this.previewSeed));
    }

    var built = CsShapeLine.buildDecor(doc, spine, null, di);
    if (isNull(built)) {
        EAction.handleUserMessage(qsTr("%1: could not decorate that " +
            "stroke. Nothing was drawn.").arg(spec.label));
        return;
    }
    CsTags.set(spine, CsShapeLine.KEY.SIG, built.sig);
    if (built.seed !== null && built.seed !== undefined) {
        // A "glyphs" spine's seed, rolled once here on its very first
        // decoration and never again -- see buildDecor's own header.
        CsTags.set(spine, CsShapeLine.KEY.SEED, String(built.seed));
    }

    var before = doc.queryAllEntities(false, true).length;
    var that = this;
    CsLayers.withLayerOn(doc, di, frameLayers.spine, function() {
        CsLayers.withLayerOn(doc, di, frameLayers.decor, function() {
            var op = new RAddObjectsOperation();
            op.setText(spec.label);
            op.addObject(spine, false);
            for (var a = 0; a < built.entities.length; a++) {
                op.addObject(built.entities[a], false);
            }
            di.applyOperation(op);
        });
    });
    var after = doc.queryAllEntities(false, true).length;

    if (after <= before) {
        EAction.handleUserMessage(qsTr("Nothing was drawn: layer %1 or " +
            "%2 refused the add (locked or frozen?).")
            .arg(frameLayers.spine).arg(frameLayers.decor));
        return;
    }
    EAction.handleUserMessage(qsTr("%1: %2 decoration entities along " +
        "%3 points").arg(spec.label).arg(built.count).arg(kept.length));

    ShapedLinesRun.lastSpine = {
        shapeId: CsTags.get(spine, CsShapeLine.KEY.ID),
        layer: frameLayers.spine,
        style: this.styleKey,
        doc: CsTrace.docKey(doc)
    };
};

/**
 * Grows the spine this stroke continues and reflows its ornament.
 *
 * ONE TRANSACTION GROUP, so the caver's Ctrl+Z takes the growth and
 * the regenerated hachures together -- a half-undone shaped line is a
 * spine wearing the ornament of a shape it no longer has.
 *
 * THE LISTENER IS HELD OFF for the same reason ShapedFlip holds it
 * off: it would hear the spine's modify, reconcile the feature
 * mid-sequence, and then hear our own decor writes and do it again.
 * Held off, this is one atomic edit from its point of view -- and the
 * regeneration is done HERE rather than left to the listener, because
 * headless there is no listener at all and a feature must not depend
 * on a window for its ornament to match its spine.
 *
 * THE SIDE IS INHERITED, never re-asked: it rides on the spine's own
 * SIDE tag, and joinOrder always keeps the existing spine's direction,
 * so a tag that meant "low side is left" still means it.
 *
 * \return true when the feature grew; false to fall through and draw
 * the stroke as a new one.
 */
ShapedLinesRun.prototype.growExisting = function(doc, di, spec) {
    var spine = doc.queryEntity(this.growId);
    if (isNull(spine)) {
        return false;
    }
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    if (sid === "") {
        return false;
    }
    var join = CsShapeLine.perFoot(doc) * CsTrace.TIE_FEET;
    var group = -1;
    try {
        group = doc.getTransactionGroup() + 1;
    } catch (eGroup) {
        group = -1;
    }

    var hadListener = (typeof ShapedLinesListener !== "undefined");
    if (hadListener) {
        ShapedLinesListener.busy = true;
    }
    var grown = { grown: false, points: 0 };
    var reflowed = "failed";
    try {
        grown = CsTrace.growCurve(doc, di, this.growId, this.spinePts,
            join, group);
        if (grown.grown) {
            // decorate() re-reads the spine's geometry, rebuilds the
            // ornament along the WHOLE line and restamps the signature.
            reflowed = CsShapeLine.decorate(doc, di,
                doc.queryEntity(this.growId), group);
        }
    } finally {
        if (hadListener) {
            ShapedLinesListener.busy = false;
        }
    }
    if (!grown.grown) {
        return false;
    }
    if (reflowed === "failed") {
        // The spine grew and the ornament did not. Say so rather than
        // leaving a longer ledge wearing the old line's hachures --
        // Sync Shaped Lines is the repair.
        EAction.handleUserMessage(qsTr("%1: the line was extended but its " +
            "ornament could not be rebuilt -- run Sync Shaped Lines.")
            .arg(spec.label));
        return true;
    }

    EAction.handleUserMessage(qsTr("%1: extended -- %2 points, ornament " +
        "rebuilt along the whole line").arg(spec.label).arg(grown.points));
    return true;
};

ShapedLinesRun.init = function(basePath) {
    // Registered so the engine knows the script; reached from the five
    // per-style buttons, never from a menu of its own. The variable is
    // deliberately not called "action" -- the structural sort-order test
    // greps the folder-named file, and spare matches elsewhere keep the
    // same discipline suite-wide.
    var runAction = new RGuiAction(qsTr("Shaped Line Run"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/ShapedLinesRun.js");
};
