// AreaFillRun.js -- the interactive half of Area Fill: press, drag,
// release draws a closed boundary, its tags and its fill in ONE
// transaction -- one undo removes everything DRAWN. A caller's first
// stroke on a new pattern can still leave one or two extra undo
// entries ahead of that: CsLayers.ensure applies its own operation
// immediately when a target layer does not exist yet, so ensuring the
// fill and boundary layers is its OWN prior transaction, separate from
// the one this file builds. That is deliberate scaffolding, not a
// second area op -- an ensured-but-empty layer surviving an undo of
// the drawn content is harmless, and CsTrace.emit (Feature Trace's own
// commit) already ensures its target layer the same way.
//
// Structured on FeatureTrace/FeatureTraceRun.js -- read that file
// first. The routing idiom (WHERE THE DRAG HAPPENED PICKS THE VIEW) is
// the exact three-line pattern Feature Trace and ScatterBreakdown
// already use; see AreaFillRun.layersFor below.
//
// NOT an add-on QCAD can find on its own, same reason as
// FeatureTraceRun.js: AddOn.getAddOns only ever builds a tool from
// <dir>/<dir>.js, and this folder's AreaFill.js (Task 10) is what
// calls AreaFillRun.init(). Until then this file has no menu entry and
// nothing calls it but the tests -- which is exactly right for a task
// whose whole job is the testable half, not the panel.
//
// EVERYTHING TESTABLE LIVES IN commit(), as a plain static function
// taking (doc, di, points, key, opts) rather than reading off `this`.
// FeatureTraceRun.commit is a prototype method and its own tests drive
// it by faking an action object with the fields commit() happens to
// read (tests/feature_trace_extend.js, driveStroke). That works but
// couples every test to the action's private shape. This file's
// commit is a pure entry point instead: no action, no this.samples, no
// EAction lifecycle -- so tests/area_fill_run.js calls it directly,
// and Task 7's listener (which also has to turn a boundary into a
// fill, on a rebuild rather than a fresh stroke) can share the same
// layer-resolution code (layersFor) without also inheriting a mouse
// event lifecycle it has no mouse events for.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function AreaFillRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
}

AreaFillRun.prototype = new EAction();

AreaFillRun.State = {
    Idle: 0,
    Drawing: 1
};

/** Screen distance, in pixels, between kept samples. See
 *  FeatureTraceRun.SAMPLE_PIXELS for why this is screen-space and not
 *  drawing-space: the same reasoning applies unchanged to a stroke
 *  that closes a loop instead of tracing a wall. */
AreaFillRun.SAMPLE_PIXELS = 6;

/** The smallest area worth filling, in square drawing units. A slip of
 *  the hand -- a click, or a two-point drag -- is not a room. Public so
 *  a panel can explain a refusal in the same terms this file refuses
 *  by. */
AreaFillRun.MIN_AREA = 1.0;

/** How hard a traced boundary is thinned, as a fraction of the sampling
 *  step -- the same shape ShapedLinesRun uses, so one idea of "smoothing"
 *  covers both. */
AreaFillRun.TOLERANCE_FRACTION = 0.05;

/**
 * Above this many estimated elements, commit() stops and hands back a
 * warning instead of drawing -- the "this is going to draw a lot" guard
 * (2026-09-12, measured live): a radius-25 circle of SAND at the
 * catalog's own default density (120) places 2315 block references, and
 * nothing told the caver that was coming. A beginner who fills a big
 * room this way gets tens of thousands and concludes the application is
 * broken, not that the density number is wrong.
 *
 * SIZED AGAINST THAT MEASUREMENT, not tuned to it exactly: 1500 sits
 * clearly below 2315, so the very case that motivated this warns, and
 * clearly above what an ordinary, deliberately-sized patch of any
 * pattern places -- BLOCKS, the sparsest scatter (density 16), needs
 * over 9000 sq drawing units of boundary to reach it, a genuinely huge
 * room, not a normal boulder pile. A round number, not a fitted one:
 * there is no "correct" threshold to derive, only a line comfortably
 * between "a caver drew what they meant" and "a caver is about to wait
 * on tens of thousands of block references".
 */
AreaFillRun.WARN_ELEMENT_THRESHOLD = 1500;

/**
 * The armed pattern's catalog key, e.g. "SAND".
 *
 * Module state, the same shape as FeatureTrace.target: the panel (Task
 * 10) arms a pattern by setting this, and it is read at release. Undo
 * -- there is no default pattern the way FeatureTraceRun falls back to
 * WALLS-SURVEYED, because an area with no pattern chosen is not a
 * reasonable thing to draw by accident; see AreaFillRun.armedReason.
 */
AreaFillRun.armed = undefined;

/**
 * Where an area's fill and its boundary land, from ONE reading of the
 * drawing's routing state.
 *
 * LIVES IN CsArea (Core), NOT here, for the same reason CsShapeLine
 * keeps its own layersFor in Core rather than in a Run file: the
 * stroke that draws a boundary (this file) and the listener that
 * regenerates its fill (AreaFillListener.js calling CsArea.regenerate,
 * both Task 7) must never disagree about where the fill belongs, and a
 * Core file (CsArea.js) can be included by either one without either
 * depending on the other. An earlier draft of this file defined
 * layersFor itself and had the listener reach up into this tool file
 * to call it -- which worked, but left CsArea.regenerate (Core)
 * depending on AreaFillRun.js (a tool file) ever being loaded, the
 * exact upward dependency this suite's Core/tool split exists to
 * forbid. This alias is kept only so any existing call written as
 * AreaFillRun.layersFor(...) keeps working.
 */
AreaFillRun.layersFor = CsArea.layersFor;

/**
 * The closed boundary polyline, and why a stroke may be refused.
 *
 * BOTH LIVE IN Core NOW, for CsArea.layersFor's own reason one comment
 * up: the Therion sketch importer builds boundaries too, and Core may
 * not reach into a tool folder. These aliases keep every call site in
 * this file working.
 */
AreaFillRun.closedBoundary = CsArea.closedBoundary;
AreaFillRun.refusalReason = CsArea.refusalReason;

/**
 * Turns a finished stroke into a boundary and its fill.
 *
 * ONE transaction for the DRAWN content: an area is a boundary plus a
 * fill, and half of one is not a thing a caver ever wants to undo
 * into. Nothing is queued into `op` until every refusal check (too few
 * points, too little area, a refusing layer) has already passed, so a
 * refused stroke leaves the document completely untouched -- no
 * orphaned boundary with no fill, no half-built op landing anyway.
 * (CsLayers.ensure, called just before the refusal check, is its own
 * separate transaction when a target layer does not exist yet -- see
 * this file's header. That can leave an empty layer behind even on a
 * refusal, which is harmless and not the property this claim is about.)
 *
 * `points` are the raw captured drag, in drawing coordinates, exactly
 * as FeatureTraceRun.samples is; this function resamples and reduces
 * them itself. `opts` is {scale, density, confirmed}. `opts.confirmed`
 * (2026-09-12): when the estimated element count is over
 * AreaFillRun.WARN_ELEMENT_THRESHOLD and this is not true, NOTHING is
 * drawn -- commit() hands back {ok: false, warn: true, estimate,
 * suggestedDensity} instead, before touching the document at all (no
 * layer is even ensured), so a caver who declines finds the drawing
 * completely unchanged. The interactive action (mouseReleaseEvent
 * below) is what turns that into a question and, on "yes", calls
 * commit() again with confirmed:true; a caller with no UI to ask
 * through (a test, Sync Areas, a future scripted import) passes
 * confirmed:true itself to say "I already know, draw it".
 *
 * \return {ok, id, layer, boundaryLayer, count, tripId, reason} on
 *         success or an ordinary refusal; {ok: false, warn: true,
 *         estimate, suggestedDensity, reason} when the fill was not
 *         drawn because it was never confirmed.
 */
AreaFillRun.commit = function(doc, di, points, key, opts) {
    var entry = CsArea.entryFor(key);
    if (isNull(entry)) {
        return { ok: false, id: null, count: 0,
            reason: "no pattern called " + key };
    }
    if (isNull(points) || points.length < 4) {
        return { ok: false, id: null, count: 0,
            reason: "that stroke is too short to enclose anything" };
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    // The suite's one sampling interval, not spacingFor alone -- that is
    // units-per-foot and using it raw meant a one-foot boundary interval
    // whatever the traces around it were doing (fixed 2026-09-12).
    //
    // The tolerance is a FRACTION of the spacing for the same reason the
    // other two traces do it that way: 0.05 drawing units was a twentieth
    // of a foot-long step and would have become a fifth of a quarter-foot
    // one, thinning four times harder exactly when the point was to keep
    // more detail.
    var spacing = CsTrace.sampleSpacing(unit);
    var verts = CsTrace.reduce(
        CsTrace.resample(points, spacing),
        spacing * AreaFillRun.TOLERANCE_FRACTION);

    // A caver's stroke (and this suite's own test fixtures) commonly
    // repeats the first point at the end to show the loop closing --
    // but a PERIODIC spline closes the loop itself by wrapping its
    // last control point back to its first. Feeding it a duplicate at
    // the seam would double up a control point exactly where the curve
    // closes. Dropped here, once, rather than inside closedBoundary,
    // so polygonArea below measures the same vertex list the boundary
    // is actually built from.
    if (verts.length > 1 && CsTrace.distance(verts[0],
            verts[verts.length - 1]) < CsArea.STEP) {
        verts = verts.slice(0, verts.length - 1);
    }

    var area = CsArea.polygonArea(verts);
    if (verts.length < 3 || area < AreaFillRun.MIN_AREA) {
        return { ok: false, id: null, count: 0,
            reason: "that loop encloses almost nothing" };
    }

    // THE GUARD ITSELF, checked BEFORE anything else touches the
    // document (no layer is ensured, nothing is queued into an op) --
    // see AreaFillRun.WARN_ELEMENT_THRESHOLD's own header. No sampler is
    // run to get this number: CsArea.estimateCount is the same formula
    // CsArea.scatterPlacements already uses for its own `want`, over the
    // polygon area already computed above.
    if (opts.confirmed !== true) {
        var estimate = CsArea.estimateCount(area, entry, opts.density);
        if (estimate > AreaFillRun.WARN_ELEMENT_THRESHOLD) {
            return { ok: false, id: null, count: 0, warn: true,
                estimate: estimate,
                suggestedDensity: CsArea.suggestedDensityMul(
                    isNull(opts.density) ? 1.0 : opts.density, estimate,
                    AreaFillRun.WARN_ELEMENT_THRESHOLD),
                reason: "that would place about " + estimate +
                    " elements -- not drawn without confirming" };
        }
    }

    // THE WRITE ITSELF IS CsArea.create'S, in Core. Everything above
    // this line is about a STROKE -- thinning a drag, refusing one too
    // small to be an area, warning before a scatter nobody wants --
    // and none of it applies to a boundary that arrives already drawn,
    // as a Therion scrap's does. Everything below it is the same work
    // whoever asked for it.
    return CsArea.create(doc, di, entry, key, verts, opts);
};

// ---------------------------------------------------------------------
// The interactive half. Thin on purpose: everything a test can check
// lives in commit() above. This is press/drag/release plumbing and a
// preview, following FeatureTraceRun's own shape.
// ---------------------------------------------------------------------

/** Why nothing was drawn when no pattern is armed. */
AreaFillRun.armedReason = function() {
    return qsTr("Nothing was drawn: no area pattern is armed. Pick one " +
        "in the Areas panel first.");
};

AreaFillRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(AreaFillRun.State.Idle);
};

AreaFillRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    switch (this.state) {
    case AreaFillRun.State.Idle:
        var trStart = qsTr("Press and drag to enclose an area of %1 -- " +
            "the view you draw in picks the layer")
            .arg(isNull(AreaFillRun.armed) ? qsTr("(no pattern armed)") :
                AreaFillRun.armed);
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        break;

    case AreaFillRun.State.Drawing:
        var trStop = qsTr("Release to close the loop and fill it");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;
    }
};

/** SAMPLE_PIXELS converted to drawing units at the current zoom. See
 *  FeatureTraceRun.prototype.sampleThreshold, unchanged reasoning. */
AreaFillRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return AreaFillRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; fall through
    }
    return 1.0;
};

AreaFillRun.prototype.escapeEvent = function() {
    if (this.state === AreaFillRun.State.Drawing) {
        // Abandon the stroke. commit() only runs at release, so
        // nothing has been added yet and there is nothing to undo.
        this.setState(AreaFillRun.State.Idle);
        return;
    }
    EAction.prototype.escapeEvent.call(this);
};

AreaFillRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== AreaFillRun.State.Idle) {
        return;
    }
    if (isNull(AreaFillRun.armed)) {
        EAction.handleUserMessage(AreaFillRun.armedReason());
        return;
    }

    var p = event.getModelPosition();
    this.setState(AreaFillRun.State.Drawing);
    this.samples = [{ x: p.x, y: p.y }];
};

AreaFillRun.prototype.mouseMoveEvent = function(event) {
    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        return;
    }
    if (this.state !== AreaFillRun.State.Drawing) {
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

AreaFillRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== AreaFillRun.State.Drawing) {
        return;
    }

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var density = AreaFillRun.density();
    var result = AreaFillRun.commit(doc, di, this.samples, AreaFillRun.armed,
        { scale: AreaFillRun.scale(), density: density });

    if (!result.ok && result.warn === true) {
        // ASK, rather than silently refuse OR silently draw thousands of
        // elements -- see AreaFillRun.WARN_ELEMENT_THRESHOLD's header.
        //
        // THE ONE PROVEN-TRUSTWORTHY MODAL SHAPE on this bridge (see
        // docs/... js-bridge-traps, and AreaFill.deleteArmed's own use
        // of it): the STATIC three/four-arg QMessageBox.question, with
        // QMessageBox.Yes | QMessageBox.No (never
        // makeQMessageBoxStandardButtons -- that flags object does not
        // survive the bridge and question() returns Yes immediately,
        // a confirmation that confirms itself), parented to
        // RMainWindowQt.getMainWindow() (never to this modal), and its
        // answer compared with === QMessageBox.Yes (never a truthy
        // check -- an INSTANCE box's exec() returns the button code,
        // where No is also truthy). That is a real, audited answer, not
        // a guess -- so this stays modal rather than falling back to a
        // silent non-modal report.
        var answer = QMessageBox.question(RMainWindowQt.getMainWindow(),
            qsTr("Large Fill"),
            qsTr("That would place about %1 elements -- likely to read " +
                "as noise and slow this drawing down.\n\nDraw it " +
                "thinned instead, at density %2?")
                .arg(result.estimate).arg(result.suggestedDensity),
            QMessageBox.Yes | QMessageBox.No);
        if (answer !== QMessageBox.Yes) {
            EAction.handleUserMessage(qsTr("Nothing was drawn."));
            this.setState(AreaFillRun.State.Idle);
            return;
        }
        result = AreaFillRun.commit(doc, di, this.samples, AreaFillRun.armed,
            { scale: AreaFillRun.scale(), density: result.suggestedDensity,
              confirmed: true });
    }

    if (!result.ok) {
        EAction.handleUserMessage(result.reason);
    } else {
        EAction.handleUserMessage(qsTr("%1: enclosed and filled (%2 " +
            "elements)").arg(result.layer).arg(result.count));
    }

    this.setState(AreaFillRun.State.Idle);
};

/** The panel's armed scale, or 1.0 without a panel -- same escape
 *  hatch as FeatureTraceRun.intervalFeet, so this action works
 *  standalone before Task 10's panel exists and if it ever fails to
 *  build. */
AreaFillRun.scale = function() {
    if (typeof AreaFill !== "undefined" && !isNull(AreaFill.scale)) {
        return AreaFill.scale();
    }
    return 1.0;
};

/** The panel's armed density, or 1.0 without a panel. */
AreaFillRun.density = function() {
    if (typeof AreaFill !== "undefined" && !isNull(AreaFill.density)) {
        return AreaFill.density();
    }
    return 1.0;
};

/** The preview is the CAPTURED path, closed with one extra segment
 *  back to the start -- so a caver can see the loop they are about to
 *  fill. Not the fitted spline: re-fitting on every sampled move buys
 *  nothing visible mid-drag and makes the tool feel heavy, the same
 *  call FeatureTraceRun's own preview makes. */
AreaFillRun.prototype.getOperation = function(preview) {
    if (this.samples.length < 2) {
        return undefined;
    }
    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    var pts = this.samples;
    for (var i = 0; i < pts.length - 1; i++) {
        op.addObject(new RLineEntity(this.getDocument(), new RLineData(
            new RVector(pts[i].x, pts[i].y),
            new RVector(pts[i + 1].x, pts[i + 1].y))), false);
    }
    op.addObject(new RLineEntity(this.getDocument(), new RLineData(
        new RVector(pts[pts.length - 1].x, pts[pts.length - 1].y),
        new RVector(pts[0].x, pts[0].y))), false);
    return op;
};

AreaFillRun.init = function(basePath) {
    var runAction = new RGuiAction(qsTr("Fill Area"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/AreaFillRun.js");
};
