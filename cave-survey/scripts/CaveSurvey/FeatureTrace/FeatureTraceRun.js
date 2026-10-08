// FeatureTraceRun.js -- the interactive half of Feature Trace.
//
// Derived from QCAD's scripts/Draw/Line/LineFreehand/LineFreehand.js
// (Copyright 2011-2018 Andrew Mustun, GPLv3 -- the same licence as this
// fork), which is where the press/drag/release shape and the
// Ctrl-modifier exclusion come from.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only ever builds an
// add-on from <dir>/<dir>.js, so this file's init() is never called by
// QCAD and FeatureTrace.init() calls it instead. That is also why the
// structural tests -- which read only the folder-named file -- do not
// require a menu entry, icon, sort order or command name here.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function FeatureTraceRun(guiAction) {
    EAction.call(this, guiAction);

    this.samples = [];      // {x, y} in drawing coordinates
    this.region = null;     // cached profile-frame box; see refreshRegion
    this.bays = [];         // cached open section-bay rects; same refresh
    this.savedSnap = null;  // snap CLASS NAME to restore on exit
}

FeatureTraceRun.prototype = new EAction();

FeatureTraceRun.State = {
    Idle: 0,
    Drawing: 1
};

/** Screen distance, in pixels, between kept samples.
 *
 *  Screen-space and not drawing-space on purpose. A fixed 1 ft drawing
 *  threshold is sub-pixel when zoomed out -- every mouse pixel would
 *  emit several samples -- and lags a foot behind the cursor when
 *  zoomed in. The 1 ft spacing the feature is named for is applied
 *  later, by CsTrace.resample, where it means a foot of cave. */
FeatureTraceRun.SAMPLE_PIXELS = 6;

/**
 * The armed FEATURE, as its plan-frame layer name.
 *
 * The panel arms a feature, not a view: WALLS-SURVEYED means "surveyed
 * walls", and which of WALLS-SURVEYED / PROFILE-WALLS-SURVEYED /
 * SECTION-WALLS-SURVEYED it becomes is decided by where the stroke
 * lands (targetLayer below). The plan name is the base the whole
 * registry derives its twins from -- see CsLayers.twinFor -- so it is
 * the natural spelling for "the feature itself".
 *
 * A frame-prefixed target is folded back to its plan base rather than
 * refused, so a caller holding an older per-view name still arms the
 * feature that name describes.
 *
 * Falls back to WALLS-SURVEYED so this action works before the panel
 * exists, and if the panel ever fails to build.
 */
FeatureTraceRun.baseLayer = function(doc) {
    if (typeof FeatureTrace === "undefined" || isNull(FeatureTrace.target)) {
        return CsLayers.WALLS_SURVEYED;
    }
    var target = FeatureTrace.target;
    if (CsLayers.frameOf(target) === "plan") {
        return target;
    }
    var plan = CsLayers.planBaseOf(target);
    return plan === null ? target : plan;
};

/**
 * The last stroke this tool committed: {id, layer, doc}.
 *
 * MODULE STATE ON PURPOSE. Arming a tile builds a NEW FeatureTraceRun,
 * so anything remembered on the instance is forgotten every time the
 * caver changes feature and comes back -- which is exactly the middle
 * of tracing a passage. `doc` is the file name, so a stroke in one
 * drawing can never continue a line in another that happens to share
 * an id.
 */
FeatureTraceRun.lastTrace = null;

/** A drawing's identity for the purpose above. The body is in Core
 *  because the shaped-line action remembers its last spine the same
 *  way, and two spellings of "the same drawing" is one too many. */
FeatureTraceRun.docKey = function(doc) {
    return CsTrace.docKey(doc);
};

/**
 * The layer a stroke in `frame` actually lands on, or null when the
 * armed feature has no layer in that view.
 *
 * THIS IS THE WHOLE POINT OF THE TOOL'S SECOND DESIGN. There used to be
 * one button per feature PER VIEW, and pressing the wrong one was
 * refused at the cursor. The refusal was the tool asking the caver to
 * re-state, in a button, a fact the drawing already knew: the bay
 * boxes and the profile band boxes say which view a point is in, so
 * the view a stroke is drawn in IS the answer. One button per feature,
 * and location routes it.
 *
 * `points` and `boxes` are the profile-run half of the same idea and
 * are optional: with a path in hand, a stroke drawn inside one band's
 * bounding box lands on that band's run variant. Without one (the
 * prompt, the panel's readout) the shared layer is the honest answer,
 * because no stroke exists yet to read a run off.
 */
FeatureTraceRun.targetLayer = function(doc, frame, points, boxes) {
    var base = FeatureTraceRun.baseLayer(doc);

    var layer = CsLayers.twinFor(base, isNull(frame) ? "plan" : frame);
    if (layer === null) {
        return null;
    }
    if (CsLayers.frameOf(layer) !== "profile") {
        return layer;
    }

    // A profile feature belongs to ONE survey run: each run is drawn as
    // its own band, and CsProfile lays bands out so they never overlap,
    // so nothing traced along one run can meet anything traced along
    // another. Segregating them also stops the no-gap tie-in welding
    // one band's ceiling to the next band's floor when the two happen
    // to be laid out within a foot of each other. Plan features are
    // untouched: the plan is one continuous map and a wall runs
    // straight through survey boundaries.
    //
    // THE RUN COMES FROM THE STROKE, always. There used to be a combo
    // in the panel that could override it -- name a band and every
    // stroke was filed under that one wherever it was drawn -- and it
    // was removed on 2026-09-08: the band boxes already know the
    // answer, and asking a caver to also state it in a combo was the
    // same second statement of the same fact that the per-view buttons
    // were. A stroke outside every box still lands on the shared layer,
    // and warnUnclaimedProfile says so.
    var run = null;
    if (!isNull(points) && (!isNull(boxes) || !isNull(doc))) {
        try {
            // Boxes handed in win: a caller that already walked the
            // drawing for them (the run action does, once per stroke)
            // must not make this walk it again, and a test can hand in
            // boxes with no document at all.
            run = CsProfileBox.runForPath(
                isNull(boxes) ? CsProfileBox.boxes(doc) : boxes, points);
        } catch (eAuto) {
            // location could not answer: the shared layer is always a
            // safe place for the work to land
            run = null;
        }
    }
    if (run !== null) {
        var variant = CsLayerVariants.nameFor(layer, run);
        if (variant !== null) {
            return variant;
        }
    }
    return layer;
};

/**
 * Why an add was refused, as a sentence for the command line.
 *
 * Locked and frozen layers refuse adds SILENTLY in this build, and
 * CsLayers.withLayerOn covers only the off case -- so a caver who
 * locked a layer earlier gets no error at all, just a missing line.
 * Reading the state back is the only way to say which it was.
 */
FeatureTraceRun.refusalReason = function(doc, layerName) {
    var lay = null;
    try {
        lay = doc.queryLayer(layerName);
    } catch (e) {
        lay = null;
    }
    if (isNull(lay)) {
        return qsTr("Nothing was drawn: layer %1 could not be found or " +
            "created.").arg(layerName);
    }
    var locked = false, frozen = false;
    try { locked = lay.isLocked(); } catch (e1) {}
    try { frozen = lay.isFrozen(); } catch (e2) {}
    if (locked) {
        return qsTr("Nothing was drawn: layer %1 is LOCKED. Unlock it in " +
            "the Layer List and trace again.").arg(layerName);
    }
    if (frozen) {
        return qsTr("Nothing was drawn: layer %1 is FROZEN. Thaw it in the " +
            "Layer List and trace again.").arg(layerName);
    }
    return qsTr("Nothing was drawn: layer %1 refused the line, and this " +
        "build reports no reason. Please report this.").arg(layerName);
};

/** The panel's sample interval in feet, or 1.0 without a panel.
 *  Every panel read goes through a helper like this so the drag action
 *  works standalone -- it is usable before the panel exists and if the
 *  panel ever fails to build. */
FeatureTraceRun.intervalFeet = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.intervalFeet)) {
        return FeatureTrace.intervalFeet();
    }
    return 1.0;
};

/** The panel's reduce tolerance as a fraction of the spacing, or a half. */
FeatureTraceRun.toleranceFraction = function() {
    if (typeof FeatureTrace !== "undefined" &&
            !isNull(FeatureTrace.toleranceFraction)) {
        return FeatureTrace.toleranceFraction();
    }
    return 0.5;
};

/**
 * Why the armed feature has no layer in `frame`, as a sentence.
 *
 * The only surviving refusal about frames, and it is about the REGISTRY
 * rather than about the caver: CsLayers.twinFor answers null for a
 * plan layer the registry deliberately does not twin (CsLayers.NO_TWIN
 * -- the north arrow, the aerial, the cut mark). Nothing in the panel's
 * feature list is one of those today; this speaks if one is ever added,
 * instead of the trace vanishing onto a layer nobody registered.
 *
 * The old press-time frame guard lived here and is deliberately gone.
 * It refused a stroke whose view disagreed with the armed BUTTON, and
 * there is no longer a per-view button to disagree with.
 */
FeatureTraceRun.noLayerReason = function(base, frame) {
    return qsTr("%1 has no layer in the %2 view, so there is nowhere for " +
        "that trace to land. Nothing was drawn.").arg(base).arg(frame);
};

FeatureTraceRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setState(FeatureTraceRun.State.Idle);
    this.refreshRegion();

    // Grid snap would quantise every sample onto the grid: a traced wall
    // comes out a staircase, and the collapsed samples get thrown away
    // by the reduce step. Restored in finishEvent below. setSnap only --
    // triggering a snap action from an action lifecycle event frees the
    // running action and segfaults; see CsTrace.suspendSnap.
    this.savedSnap = CsTrace.suspendSnap(this.getDocumentInterface());
};

/** Restores the snap the caver had.
 *
 *  finishEvent and not mouseReleaseEvent: this fires however the action
 *  ends -- Escape, another tool taking over, the window closing -- so
 *  the snap cannot be left switched off by an exit path nobody thought
 *  about. */
FeatureTraceRun.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);
    CsTrace.restoreSnap(this.getDocumentInterface(), this.savedSnap);
    this.savedSnap = null;
};

FeatureTraceRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);

    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();

    switch (this.state) {
    case FeatureTraceRun.State.Idle:
        // The FEATURE, not a layer: the layer is not known until the
        // stroke exists, because the view it is drawn in chooses it.
        var trStart = qsTr("Press and drag to trace %1 -- the view you " +
            "draw in picks the layer")
            .arg(FeatureTraceRun.baseLayer(this.getDocument()));
        this.setCommandPrompt(trStart);
        this.setLeftMouseTip(trStart);
        this.setRightMouseTip(EAction.trCancel);
        this.samples = [];
        break;

    case FeatureTraceRun.State.Drawing:
        var trStop = qsTr("Release to finish the run");
        this.setCommandPrompt(trStop);
        this.setLeftMouseTip(trStop);
        this.setRightMouseTip("");
        break;
    }
};

/**
 * Recomputes the cached profile region and the open section bays.
 *
 * Called when the action starts, at the top of every press, and again
 * after every committed trace: a trace onto a profile layer GROWS the
 * region, so a stale box would refuse the next stroke just past the
 * previous one -- and a bay can be OPENED (Sketch Section) or CAPTURED
 * (Capture Section) between one stroke and the next, which would leave
 * a stale bay list refusing every section stroke, or accepting strokes
 * into a bay that is no longer there.
 *
 * Cached at all because each of these walks EVERY entity in the
 * drawing, and the cursor readout asks per mouse-move event. On a real
 * cave that is thousands of entities per mouse move. Once per press is
 * the same cost the post-commit refresh already pays.
 */
FeatureTraceRun.prototype.refreshRegion = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
    this.bays = isNull(doc) ? [] : CsTrace.sectionBays(doc);
};

/** SAMPLE_PIXELS converted to drawing units at the current zoom.
 *  A view we cannot measure falls back to one drawing unit, which
 *  OVER-samples rather than under-samples: too many points is a slow
 *  trace, too few is a wrong one. */
FeatureTraceRun.prototype.sampleThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return FeatureTraceRun.SAMPLE_PIXELS / factor;
            }
        }
    } catch (e) {
        // no measurable view; fall through
    }
    return 1.0;
};

FeatureTraceRun.prototype.escapeEvent = function() {
    if (this.state === FeatureTraceRun.State.Drawing) {
        // Abandon the run. The add happens on release, so there is
        // nothing applied yet and nothing to undo.
        this.setState(FeatureTraceRun.State.Idle);
        return;
    }
    // A second Escape leaves the tool, so the panel must stop claiming
    // a feature is armed -- the Symbol Palette has done this since it
    // shipped (SymbolPaletteRun.escapeEvent), and a caver who learns
    // that Escape puts one panel down should not find the other still
    // lit. Here and not in finishEvent: an action ALSO finishes when
    // another one takes over, and clearing there would un-light the
    // tile the caver just armed, because this build tears the old
    // action down a beat after the new one starts.
    if (typeof FeatureTrace !== "undefined") {
        try {
            FeatureTrace.disarmTiles();
        } catch (eDis) {
            // a lit tile with nothing running is untidy, never harmful
        }
    }
    EAction.prototype.escapeEvent.call(this);
};

FeatureTraceRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;   // reserved, as in LineFreehand
    }
    if (this.state !== FeatureTraceRun.State.Idle) {
        return;
    }

    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    // SHIFT MEANS "MORE OF THAT LINE". Read at the PRESS and kept for
    // the stroke: a caver lets go of Shift somewhere in the middle of a
    // long drag, and what they asked for at the start is what they
    // meant. See extendTarget for what it widens.
    this.extendForced = false;
    try {
        this.extendForced = (event.modifiers().valueOf() &
            Qt.ShiftModifier.valueOf()) !== 0;
    } catch (eMod) {
    }

    // Once per stroke: Sketch Section and Capture Section can open and
    // close a bay while this action is still armed, and commit() routes
    // the finished stroke from this list -- a stale one would file the
    // work under a bay that is no longer there.
    //
    // NO PRESS-TIME REFUSAL any more. Every press is in some view, and
    // every view has a layer for the armed feature, so there is nothing
    // left for a press to be wrong about. The readout still says which
    // view the cursor is in, and now which layer that means.
    this.refreshRegion();

    this.setState(FeatureTraceRun.State.Drawing);
    this.samples = [here];
};

FeatureTraceRun.prototype.mouseMoveEvent = function(event) {
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        // Button up: report which view the cursor is over, from the
        // CACHED box. This is the readout's whole point -- it can still
        // change the caver's mind before the press.
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.showCursorFrame)) {
            var over = CsTrace.frameIn(this.region, here, this.bays);
            // The LAYER as well as the view, because the layer is what
            // the caver is choosing now that no button states it. No
            // points are passed: there is no stroke yet, so this names
            // the shared profile layer where a run would refine it.
            FeatureTrace.showCursorFrame(over,
                FeatureTraceRun.targetLayer(this.getDocument(), over));
        }
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    var last = this.samples[this.samples.length - 1];
    if (isNull(last) ||
            CsTrace.distance(last, here) >= this.sampleThreshold()) {
        this.samples.push(here);
        this.updatePreview();
    }
};

FeatureTraceRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== FeatureTraceRun.State.Drawing) {
        return;
    }

    this.commit();
    this.setState(FeatureTraceRun.State.Idle);
};

/** Resample, reduce, fit and add the captured drag. */
FeatureTraceRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.samples.length < 2) {
        return;
    }

    // WHERE THE STROKE IS decides which view it belongs to, and the view
    // decides the layer. The whole path has to agree on one view: a wall
    // crossing the gutter describes nothing in either of them.
    var pathFrame = CsTrace.pathFrame(this.region, this.samples, this.bays);

    if (pathFrame === null) {
        EAction.handleUserMessage(qsTr("That run crossed from one view " +
            "into another. Nothing was drawn -- trace within one view."));
        return;
    }

    // The samples go in, so a profile stroke picks up its band's run
    // from the same call. The current-layer escape hatch comes back out
    // of here untouched, by targetLayer's own first guard.
    var layerName = FeatureTraceRun.targetLayer(doc, pathFrame,
        this.samples);
    if (layerName === null) {
        EAction.handleUserMessage(FeatureTraceRun.noLayerReason(
            FeatureTraceRun.baseLayer(doc), pathFrame));
        return;
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    // spacingFor gives drawing units per FOOT, so multiplying by the
    // panel's interval keeps that field in feet whatever the drawing is
    // in. Tolerance is a fraction of the spacing for the same reason:
    // one smoothing setting means the same thing in both.
    var perFoot = CsTrace.spacingFor(unit);
    var spacing = perFoot * FeatureTraceRun.intervalFeet();
    var tolerance = spacing * FeatureTraceRun.toleranceFraction();

    // No-gap walls: a stroke starting or ending within a foot of an
    // existing wall end begins or ends exactly THERE instead. Our own
    // distance test, not QCAD's snapping -- native snap is a global mode
    // that would fight the free-snap a drag needs, and it would catch
    // everything rather than wall ends on this one layer.
    var tied = CsTrace.tieEnds(doc, this.samples, layerName,
        perFoot * CsTrace.TIE_FEET);

    // MORE OF THAT LINE, OR A NEW ONE. A wall traced in six passes was
    // six splines: six things to warp, six ends to leave a hairline gap
    // between, six rows in a revision. A stroke that carries on from
    // one of these grows it instead -- see extendTarget for which ones
    // qualify, and why a plain drag will not join two different walls
    // that happen to meet at a corner.
    var join = perFoot * CsTrace.TIE_FEET;
    var grow = this.extendTarget(doc, layerName, tied, join);
    var result = null;
    if (grow !== null) {
        result = CsTrace.extend(doc, di, grow, tied, spacing, tolerance,
            join);
    }
    // A refused extension is not a lost stroke: fall through and draw
    // it as its own line, which is what the tool did before extending
    // existed. CsTrace.extend reads its answer back off the document,
    // so this is reached on a real refusal rather than on a hope.
    if (result === null || !result.added) {
        result = CsTrace.emit(doc, di, layerName, tied, spacing, tolerance);
    }

    if (!result.added) {
        // Something refused the add and this build raises no error for
        // any of the ways that can happen. Name the likely cause rather
        // than leaving the caver to wonder where the line went.
        EAction.handleUserMessage(
            FeatureTraceRun.refusalReason(doc, layerName));
        this.refreshRegion();
        return;
    }
    if (result.added) {
        // The layer is NAMED in the message, every time. With no
        // per-view button to arm, this line is the caver's confirmation
        // that the view they drew in was the view they meant -- an
        // elevation wall traced a foot outside the band boxes says
        // WALLS-SURVEYED here, and one undo puts it right.
        EAction.handleUserMessage(
            (result.extended === true ?
                qsTr("%1: extended -- %2 sampled, %3 kept") :
                qsTr("%1: %2 sampled, %3 kept"))
            .arg(layerName).arg(result.sampled).arg(result.kept));
        if (typeof FeatureTrace !== "undefined" &&
                !isNull(FeatureTrace.reportTrace)) {
            FeatureTrace.reportTrace(layerName, result);
        }
        this.stampSection(doc, di, pathFrame, result.id);
        // WHICH TRIP DREW IT. The station nearest the stroke names the
        // trip -- CsTrace.tripFor, and the header note on that half of
        // CsTrace, which is also where the section bay's own rule
        // lives. An EXTENSION keeps the trip the line already had:
        // growing a wall by six feet does not make a later trip its
        // author, so only a line that is new here is stamped.
        //
        // Called straight through to Core rather than through a method
        // of this action, deliberately: every headless suite builds a
        // FAKE action object listing the prototype methods commit()
        // uses by hand, so a new method here is a new line four test
        // files must grow or die with "is not a function".
        if (result.extended !== true) {
            try {
                CsTrace.stampTrip(doc, di, result.id,
                    CsTrace.tripFor(doc, pathFrame, this.samples,
                        this.bays));
            } catch (eTrip) {
                // provenance is a nicety; the line is already drawn
            }
        }
        this.warnUnclaimedProfile(pathFrame, layerName);
        FeatureTraceRun.lastTrace = isNull(result.id) ? null : {
            id: result.id, layer: layerName, doc: FeatureTraceRun.docKey(doc)
        };
    }

    // A trace onto a profile layer grew the region. (Section linework
    // does not: profileRegion unions only profile-frame layers, so a
    // stroke inside a bay leaves the elevation's extent alone -- which
    // is what keeps a sketched section from dragging the profile frame
    // out across the sheet to meet it.)
    this.refreshRegion();
};

/**
 * The line this stroke should GROW, or null to draw a new one.
 *
 * TWO WAYS IN, AND THE DIFFERENCE MATTERS.
 *
 * A plain drag continues only the caver's OWN LAST STROKE on this exact
 * layer -- the "I ran out of screen and lifted the mouse" case, which
 * is what makes a wall six entities instead of one. Narrow on purpose:
 * joining any end within a foot would fuse two DIFFERENT walls that
 * meet at a corner into one curve, and a fitted curve through a corner
 * rounds it off. Cave maps are full of corners that two strokes made.
 *
 * Holding SHIFT at the press widens it to the nearest end on the layer,
 * whatever drew it and whenever -- the wall traced last week, the one
 * someone else traced. That is the case where the caver has looked at
 * the drawing and knows the two are one line, so the tool believes
 * them.
 *
 * The layer is matched EXACTLY, which is what stops a plan stroke
 * continuing a profile line, or a band-A ceiling continuing band B's:
 * `layerName` is the fully routed destination, run variant and all.
 */
FeatureTraceRun.prototype.extendTarget = function(doc, layerName, points,
        tolerance) {
    if (isNull(doc) || isNull(points) || points.length < 2) {
        return null;
    }
    var head = points[0];
    var tail = points[points.length - 1];

    if (this.extendForced === true) {
        var hit = CsTrace.nearestEndHit(doc, head, layerName, tolerance);
        if (hit === null) {
            hit = CsTrace.nearestEndHit(doc, tail, layerName, tolerance);
        }
        return hit === null ? null : hit.id;
    }

    var last = FeatureTraceRun.lastTrace;
    if (last === null || last.layer !== layerName ||
            last.doc !== FeatureTraceRun.docKey(doc)) {
        return null;
    }
    // Still there, still on that layer: the caver may have undone it,
    // deleted it, or moved it to another layer since.
    var entity = doc.queryEntity(last.id);
    if (isNull(entity) ||
            doc.getLayerName(entity.getLayerId()) !== layerName) {
        FeatureTraceRun.lastTrace = null;
        return null;
    }
    var ends;
    try {
        ends = [entity.getStartPoint(), entity.getEndPoint()];
    } catch (eEnds) {
        return null;
    }
    for (var i = 0; i < ends.length; i++) {
        if (isNull(ends[i])) {
            continue;
        }
        var end = { x: ends[i].x, y: ends[i].y };
        if (CsTrace.distance(head, end) <= tolerance ||
                CsTrace.distance(tail, end) <= tolerance) {
            return last.id;
        }
    }
    return null;
};

/** The tags a section trace carries: which bay it was drawn in, and the
 *  station that bay is a section OF.
 *
 *  Their own names rather than the bay tool's own SectionBay/
 *  SectionBayRole tag pair, deliberately. Those two mark the bay's own
 *  FURNITURE -- the frame, the ghost, the scan -- and SectionCapture
 *  and SectionEdit both walk the drawing looking for them. Traced
 *  linework wearing the same tag with no role would sit inside those
 *  sweeps as a permanent "what is this?", and the day one of them stops
 *  checking the role it would be swept up as furniture. */
// The names themselves moved to Core (CsTrace.SECTION_BAY_TAG /
// SECTION_STATION_TAG) when Symbol Palette began stamping placed
// symbols with the same two: Capture sweeps traced linework and
// symbols out of one bay, and two tools spelling the same fact
// differently would make it know about both spellings. These stay as
// the names this file and its tests already use.
FeatureTraceRun.BAY_TAG = CsTrace.SECTION_BAY_TAG;
FeatureTraceRun.STATION_TAG = CsTrace.SECTION_STATION_TAG;

/**
 * Stamps a section trace with the station its bay belongs to.
 *
 * WHY AT TRACE TIME. A section's station is not derivable from the
 * linework later: CsBind refuses the section frame outright (one
 * station, no chain, nothing for its maths to bind against), and the
 * bay that knew the answer is TORN DOWN by Capture. Between tracing and
 * capturing -- which can be days, and may never happen at all for a
 * sketch left open -- the drawing had no record of which station the
 * work described. It does now.
 *
 * Silent about everything: a missing id, a stroke that wandered out of
 * its bay, a bay with no station tag. A stamp is provenance, and
 * failing to add provenance must never cost the caver the line they
 * just drew.
 */
FeatureTraceRun.prototype.stampSection = function(doc, di, frame, id) {
    if (frame !== "section" || isNull(id) || isNull(doc) || isNull(di)) {
        return;
    }
    try {
        var bay = CsTrace.bayForPath(this.bays, this.samples);
        if (bay === null || isNull(bay.station) || bay.station === "") {
            return;
        }
        var e = doc.queryEntity(id);
        if (isNull(e)) {
            return;
        }
        CsTags.set(e, FeatureTraceRun.BAY_TAG, bay.bay);
        CsTags.set(e, FeatureTraceRun.STATION_TAG, bay.station);
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
    } catch (eStamp) {
        // provenance is a nicety; the line is already drawn
    }
};

/**
 * Says so when a profile trace landed on the SHARED layer.
 *
 * A profile feature that belongs to no run is the one quiet way this
 * tool can still cost work. CsProfileBind moves traced linework by the
 * run its layer names; on the shared layer there is no run, so binding
 * falls back to guessing by distance and silently skips anything traced
 * far from its stations -- and a revision then tears the sketch off the
 * passage. The old panel prevented it by DISABLING the profile group
 * until a run was chosen. There is no profile group any more, and the
 * information is better as an answer than as a locked door: it names
 * what happened, after the line is safely drawn.
 */
FeatureTraceRun.prototype.warnUnclaimedProfile = function(frame, layerName) {
    if (frame !== "profile") {
        return;
    }
    if (CsLayerVariants.split(layerName) !== null) {
        return;   // it landed on a run's layer; nothing to say
    }
    EAction.handleUserMessage(qsTr("That line is on the shared %1 -- no " +
        "band's box claims where it was drawn, so it belongs to no survey " +
        "run and will not move with a band when the survey is revised. " +
        "Trace inside a band, or pick the run above.").arg(layerName));
};

/** The preview is the CAPTURED path, not the fitted spline.
 *  Re-running resample/reduce/fit on every sampled move buys nothing a
 *  caver can see mid-drag and makes the tool feel heavy. */
FeatureTraceRun.prototype.getOperation = function(preview) {
    if (this.samples.length < 2) {
        return undefined;
    }
    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    for (var i = 0; i < this.samples.length - 1; i++) {
        op.addObject(new RLineEntity(this.getDocument(), new RLineData(
            new RVector(this.samples[i].x, this.samples[i].y),
            new RVector(this.samples[i + 1].x, this.samples[i + 1].y))),
            false);
    }
    return op;
};

FeatureTraceRun.init = function(basePath) {
    // No widget names, no sort order, no icon: this action is reached
    // from the Feature Trace panel and never from a menu. Its variable
    // is deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var runAction = new RGuiAction(qsTr("Trace Feature"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/FeatureTraceRun.js");
};
