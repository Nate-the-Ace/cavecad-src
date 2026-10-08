// SymbolPaletteRun.js -- the interactive half of Symbol Palette: the
// click that drops a symbol, and the drag that aims it.
//
// NOT an add-on QCAD can find. AddOn.getAddOns only ever builds an
// add-on from <dir>/<dir>.js, so this file's init() is never called by
// QCAD and SymbolPalette.init() calls it instead.
//
// The press/move/release shape is FeatureTraceRun's, and the routing
// decision is the same one: where the click lands says which view the
// symbol belongs to, and the view says which layer. A stalactite
// dropped in an elevation band goes on PROFILE-FORMATIONS-DRIP without
// the caver arming anything, exactly as a traced wall does.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function SymbolPaletteRun(guiAction) {
    EAction.call(this, guiAction);

    this.anchor = null;     // {x, y} press point, in drawing coordinates
    this.angle = null;      // radians, from the drag; null until it turns
    this.dragScale = null;  // from the drag's LENGTH; null until it moves
    this.radius = 0;        // the armed symbol's own half-size at scale 1
    this.unitsPerFoot = 1;  // this drawing's foot, cached per placement
    this.region = null;     // cached profile-frame box; see refreshRegion
    this.bays = [];         // cached open section-bay rects; same refresh
}

SymbolPaletteRun.prototype = new EAction();

SymbolPaletteRun.State = {
    Idle: 0,
    Placing: 1
};

/**
 * How far the cursor must travel from the press point, in PIXELS,
 * before the drag is treated as aiming rather than as a click.
 *
 * Screen space and not drawing space: the whole question is whether the
 * caver MOVED the mouse, which is a hand movement, not a distance in
 * the cave. In drawing units the same wobble would be an aim when
 * zoomed in and a click when zoomed out.
 *
 * Under the threshold the panel's angle stands, so a plain click stays
 * a plain click even from an unsteady hand.
 */
SymbolPaletteRun.AIM_PIXELS = 8;

/**
 * How big a symbol is placed when nobody has said otherwise, in FEET.
 *
 * Five feet, which is a symbol you can see at the zoom a passage is
 * drawn at and one that does not swamp a narrow crawl. It is a starting
 * point and nothing more -- the field is right there, and a drag
 * overrules both.
 */
SymbolPaletteRun.DEFAULT_SIZE_FEET = 5.0;

/** How small and how large a drag is allowed to make a symbol.
 *
 *  A floor rather than no floor because the drag distance IS the size:
 *  releasing a pixel from the press point would otherwise place a
 *  symbol too small to see and too small to find again. A ceiling for
 *  the mirror image -- a drag across a zoomed-out cave asking for a
 *  stalactite the size of the passage. Both are far outside anything
 *  anyone means, so neither is in the caver's way. */
SymbolPaletteRun.MIN_SCALE = 0.05;
SymbolPaletteRun.MAX_SCALE = 500.0;

/**
 * Drawing units per FOOT of cave.
 *
 * The panel asks for a size in feet and the drawing may be in metres,
 * exactly as Feature Trace's interval does -- one field, one meaning,
 * whatever the drawing was surveyed in.
 */
SymbolPaletteRun.perFoot = function(doc) {
    try {
        return CsTrace.spacingFor(CsUnits.fromDrawingUnit(doc.getUnit(), RS));
    } catch (e) {
        return 1.0;
    }
};

/**
 * The scale factor that makes a symbol `sizeFeet` across.
 *
 * WHY THE PANEL ASKS FOR FEET AND NOT A MULTIPLIER. The blocks are
 * drawn about a foot across -- a stalactite is 1 ft wide at scale 1 --
 * and a cave map is a thousand feet across, so scale 1 is a speck and
 * nobody can guess from "1.0" what they will get. Worse, the same
 * multiplier means a different size on every symbol: the north arrow is
 * 3.3 ft at scale 1 and the stalactite 1 ft. A size in feet is the
 * thing the caver actually wants to state, and it means the same on
 * every symbol in the palette.
 *
 * Falls back to 1.0 for a symbol whose radius is unknown -- an empty or
 * unreadable block -- rather than dividing by zero.
 *
 * Pure.
 */
SymbolPaletteRun.scaleForSize = function(sizeFeet, radius, perFoot) {
    if (isNull(radius) || radius <= 0 || isNull(sizeFeet) ||
            !(sizeFeet > 0)) {
        return 1.0;
    }
    var scale = (sizeFeet * perFoot) / (2 * radius);
    if (!(scale > 0) || isNaN(scale)) {
        return 1.0;
    }
    return scale;
};

/** The size in FEET that a symbol of `radius` placed at `scale` comes
 *  out. The inverse of scaleForSize, for writing a drag's answer back
 *  into the panel's own field. Pure. */
SymbolPaletteRun.sizeForScale = function(scale, radius, perFoot) {
    if (isNull(radius) || radius <= 0 || isNull(perFoot) || perFoot <= 0) {
        return null;
    }
    return (2 * radius * scale) / perFoot;
};

/**
 * The scale a drag of `distance` asks for, on a symbol whose own
 * half-size is `radius`.
 *
 * THE DISTANCE IS THE RADIUS. Press at the middle of where the symbol
 * goes, drag to where its edge should be, and that is the size it is
 * placed at -- so the gesture reads the same on a stalactite half a
 * unit across and a north arrow ten units across, and the preview under
 * the cursor is the answer rather than a hint about it.
 *
 * ALWAYS. There is no switch for this (Nathan, 2026-09-11): a drag is
 * a drag, and a gesture that sometimes sizes and sometimes does not is
 * a gesture a caver has to check a box to understand.
 *
 * Falls back to `panelScale` only where the drag cannot mean anything:
 * a symbol whose radius is unknown (an empty or unreadable block), or
 * a drag that has not passed the aim threshold yet. That last one is
 * what keeps a plain click a plain click.
 *
 * Pure.
 */
SymbolPaletteRun.scaleForDrag = function(distance, radius, panelScale) {
    if (isNull(radius) || radius <= 0 ||
            isNull(distance) || !(distance > 0)) {
        return panelScale;
    }
    var scale = distance / radius;
    if (!(scale > 0) || isNaN(scale)) {
        return panelScale;
    }
    if (scale < SymbolPaletteRun.MIN_SCALE) {
        return SymbolPaletteRun.MIN_SCALE;
    }
    if (scale > SymbolPaletteRun.MAX_SCALE) {
        return SymbolPaletteRun.MAX_SCALE;
    }
    return scale;
};

/** The armed catalogue entry, from the panel, or null.
 *
 *  Read at PLACEMENT time and not captured when the action started: a
 *  caver can arm a different symbol from the panel without the action
 *  restarting, and the symbol they can see armed is the one they mean. */
SymbolPaletteRun.armedEntry = function() {
    if (typeof SymbolPalette === "undefined") {
        return null;
    }
    return isNull(SymbolPalette.armed) ? null : SymbolPalette.armed;
};

/** The size the panel is asking for, in FEET of cave. A nonsense entry
 *  falls back rather than refusing: a bad number in a text box must not
 *  cost a placement. */
SymbolPaletteRun.sizeFeet = function() {
    if (typeof SymbolPalette === "undefined") {
        return SymbolPaletteRun.DEFAULT_SIZE_FEET;
    }
    return SymbolPalette.sizeValue();
};

/** The panel's angle in radians, the default a plain click uses. */
SymbolPaletteRun.defaultAngle = function() {
    if (typeof SymbolPalette === "undefined") {
        return 0.0;
    }
    return RMath.deg2rad(SymbolPalette.angleValue());
};

/**
 * The layer a symbol dropped at `point` in `frame` lands on, or null
 * when the armed symbol has no layer in that view.
 *
 * The same three-step derivation Feature Trace uses, and deliberately
 * not a second copy of the twin table: CsLayers.twinFor turns the
 * catalogue's plan-frame layer into the view's twin, and
 * CsLayerVariants.nameFor refines a profile twin down to the band's own
 * run so a revision moves the symbol with its band.
 *
 * A symbol whose home layer has no twin in that view -- the north
 * arrow, which is CsLayers.NO_TWIN because an elevation has no north --
 * answers null, and the caller says so rather than putting it
 * somewhere.
 */
SymbolPaletteRun.targetLayer = function(doc, entry, frame, point) {
    if (isNull(entry)) {
        return null;
    }
    var base = entry.layer;
    var layer = CsLayers.twinFor(base, isNull(frame) ? "plan" : frame);
    if (layer === null) {
        return null;
    }
    if (CsLayers.frameOf(layer) !== "profile" || isNull(doc) ||
            isNull(point)) {
        return layer;
    }
    // A profile symbol belongs to ONE survey run, for the reason
    // FeatureTraceRun.targetLayer states at length: the bands never
    // overlap, and linework filed under no run is silently skipped when
    // a revision moves the band it was drawn on.
    try {
        var run = CsProfileBox.runForPath(CsProfileBox.boxes(doc), [point]);
        if (run !== null) {
            var variant = CsLayerVariants.nameFor(layer, run);
            if (variant !== null) {
                return variant;
            }
        }
    } catch (eRun) {
        // location could not answer: the shared profile layer is a safe
        // place for the symbol to land, and warnUnclaimed says so
    }
    return layer;
};

/** Why a symbol could not be placed in that view, as a sentence. */
SymbolPaletteRun.noLayerReason = function(entry, frame) {
    return qsTr("%1 has no layer in the %2 -- the registry gives that " +
        "symbol no twin there. Place it in the plan instead.")
        .arg(entry.nss).arg(frame === "section" ? qsTr("cross section") :
            qsTr("elevation"));
};

/**
 * Why an add was refused, as a sentence for the command line.
 *
 * Locked and frozen layers refuse adds SILENTLY in this build --
 * FeatureTraceRun.refusalReason exists for the same reason -- so the
 * state has to be read back to say which it was.
 */
SymbolPaletteRun.refusalReason = function(doc, layerName) {
    var lay = null;
    try {
        lay = doc.queryLayer(layerName);
    } catch (e) {
        lay = null;
    }
    if (isNull(lay)) {
        return qsTr("Nothing was placed: layer %1 could not be found or " +
            "created.").arg(layerName);
    }
    var locked = false, frozen = false;
    try {
        locked = lay.isLocked();
        frozen = lay.isFrozen();
    } catch (eState) {
    }
    if (locked) {
        return qsTr("Nothing was placed: layer %1 is locked. Unlock it " +
            "and try again.").arg(layerName);
    }
    if (frozen) {
        return qsTr("Nothing was placed: layer %1 is frozen. Thaw it and " +
            "try again.").arg(layerName);
    }
    return qsTr("Nothing was placed on %1, and this build gave no reason.")
        .arg(layerName);
};

SymbolPaletteRun.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.refreshRegion();
    this.setState(SymbolPaletteRun.State.Idle);
};

SymbolPaletteRun.prototype.setState = function(state) {
    EAction.prototype.setState.call(this, state);
    this.setCrosshairCursor();
    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case SymbolPaletteRun.State.Idle:
        var trPlace = qsTr("Click to place the symbol, or drag to aim it");
        this.setCommandPrompt(trPlace);
        this.setLeftMouseTip(trPlace);
        this.setRightMouseTip(EAction.trCancel);
        this.anchor = null;
        this.angle = null;
        this.dragScale = null;
        break;

    case SymbolPaletteRun.State.Placing:
        var trAim = qsTr("Release to place; drag first to aim");
        this.setCommandPrompt(trAim);
        this.setLeftMouseTip(trAim);
        this.setRightMouseTip("");
        break;
    }
};

/**
 * Recomputes the cached profile region and the open section bays.
 *
 * Same cache and same reasons as FeatureTraceRun.refreshRegion: each
 * walks EVERY entity in the drawing, the readout asks per mouse move,
 * and both answers can change between one placement and the next
 * (a profile redraw, a bay opened or captured).
 */
SymbolPaletteRun.prototype.refreshRegion = function() {
    var doc = this.getDocument();
    this.region = isNull(doc) ? null : CsTrace.profileRegion(doc);
    this.bays = isNull(doc) ? [] : CsTrace.sectionBays(doc);
};

/** AIM_PIXELS converted to drawing units at the current zoom. A view we
 *  cannot measure falls back to a threshold big enough that a wobble is
 *  still a click. */
SymbolPaletteRun.prototype.aimThreshold = function() {
    try {
        var view = this.getGraphicsView();
        if (!isNull(view)) {
            var factor = view.getFactor();
            if (factor > 0) {
                return SymbolPaletteRun.AIM_PIXELS / factor;
            }
        }
    } catch (e) {
    }
    return 1.0;
};

SymbolPaletteRun.prototype.escapeEvent = function() {
    if (this.state === SymbolPaletteRun.State.Placing) {
        // Nothing is applied until release, so there is nothing to undo.
        this.setState(SymbolPaletteRun.State.Idle);
        return;
    }
    if (typeof SymbolPalette !== "undefined") {
        try {
            SymbolPalette.disarm();
        } catch (eDis) {
            // the panel showing an armed tile that is no longer running
            // is untidy, never harmful
        }
    }
    EAction.prototype.escapeEvent.call(this);
};

SymbolPaletteRun.prototype.mousePressEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (event.modifiers().valueOf() === Qt.ControlModifier.valueOf()) {
        return;   // reserved, as in LineFreehand and Feature Trace
    }
    if (this.state !== SymbolPaletteRun.State.Idle) {
        return;
    }
    if (SymbolPaletteRun.armedEntry() === null) {
        EAction.handleUserMessage(qsTr("Pick a symbol in the Symbol " +
            "Palette first."));
        return;
    }

    // Once per placement, for the reason refreshRegion states: a bay
    // can be opened or captured while this action is still armed.
    this.refreshRegion();

    var p = event.getModelPosition();
    this.anchor = { x: p.x, y: p.y };
    this.angle = null;
    this.dragScale = null;
    // Once per placement, not per mouse move: reading it walks a block
    // definition, and a drag emits a move event per pixel.
    this.radius = 0;
    try {
        this.radius = CsSymbolStore.radiusOf(this.getDocument(),
            SymbolPaletteRun.armedEntry().block);
    } catch (eRadius) {
        this.radius = 0;   // sizing falls back to scale 1
    }
    this.unitsPerFoot = SymbolPaletteRun.perFoot(this.getDocument());
    this.setState(SymbolPaletteRun.State.Placing);
};

SymbolPaletteRun.prototype.mouseMoveEvent = function(event) {
    var p = event.getModelPosition();
    var here = { x: p.x, y: p.y };

    if (!(event.buttons().valueOf() & Qt.LeftButton.valueOf())) {
        // Button up: say which view the cursor is over and which layer
        // that means. The readout is the only thing that tells a caver,
        // BEFORE the click, that the symbol is about to land in the
        // elevation rather than the plan.
        if (typeof SymbolPalette !== "undefined" &&
                !isNull(SymbolPalette.showCursorFrame)) {
            var over = CsTrace.frameIn(this.region, here, this.bays);
            var entry = SymbolPaletteRun.armedEntry();
            SymbolPalette.showCursorFrame(over, entry === null ? "" :
                SymbolPaletteRun.targetLayer(this.getDocument(), entry,
                    over, here));
        }
        return;
    }
    if (this.state !== SymbolPaletteRun.State.Placing || isNull(this.anchor)) {
        return;
    }

    // THE AIM AND THE SIZE, from one gesture. Direction turns the
    // symbol; distance IS its radius, so the cursor sits on the edge of
    // what will be placed. Past the threshold both track; inside it the
    // panel's angle and scale stand and the placement is still a click.
    //
    // Once it HAS engaged it keeps tracking, even if the cursor comes
    // back inside the threshold -- otherwise a drag out and back would
    // silently discard the aim and the size the caver just set.
    var d = CsTrace.distance(this.anchor, here);
    if (this.angle !== null || d >= this.aimThreshold()) {
        this.angle = Math.atan2(here.y - this.anchor.y,
            here.x - this.anchor.x);
        this.dragScale = SymbolPaletteRun.scaleForDrag(d, this.radius,
            this.clickScale());
    }
    this.showDragReadout();
    this.updatePreview();
};

SymbolPaletteRun.prototype.mouseReleaseEvent = function(event) {
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (this.state !== SymbolPaletteRun.State.Placing) {
        return;
    }
    this.commit();
    // Still armed: a symbol is usually placed several times in a row,
    // and re-picking the tile between every boulder is the tedium this
    // panel exists to remove. Escape ends it.
    this.setState(SymbolPaletteRun.State.Idle);
};

/** The angle this placement uses: the drag's, or the panel's. */
SymbolPaletteRun.prototype.placementAngle = function() {
    return this.angle === null ? SymbolPaletteRun.defaultAngle() : this.angle;
};

/** The scale a plain CLICK places at: whatever makes the symbol the
 *  size the panel is asking for, in this drawing's units. */
SymbolPaletteRun.prototype.clickScale = function() {
    return SymbolPaletteRun.scaleForSize(SymbolPaletteRun.sizeFeet(),
        this.radius, this.unitsPerFoot);
};

/** The scale this placement uses: the drag's, or the click's. */
SymbolPaletteRun.prototype.placementScale = function() {
    return this.dragScale === null ? this.clickScale() : this.dragScale;
};

/** Says what the drag is asking for, in the panel, while it is being
 *  made. The preview already shows it; the numbers say it exactly, and
 *  a caver placing a scale bar or a north arrow wants the number. Must
 *  never throw: this runs inside a mouse-move handler. */
SymbolPaletteRun.prototype.showDragReadout = function() {
    if (typeof SymbolPalette === "undefined" ||
            isNull(SymbolPalette.showDrag)) {
        return;
    }
    try {
        SymbolPalette.showDrag(
            SymbolPaletteRun.sizeForScale(this.placementScale(), this.radius,
                this.unitsPerFoot),
            RMath.rad2deg(this.placementAngle()));
    } catch (e) {
    }
};

/** Places one symbol at the anchor. */
SymbolPaletteRun.prototype.commit = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    var entry = SymbolPaletteRun.armedEntry();
    if (isNull(doc) || isNull(di) || isNull(this.anchor) || entry === null) {
        return;
    }

    var frame = CsProfileBox.frameAt(doc, this.region,
        new RVector(this.anchor.x, this.anchor.y), this.bays);
    var layerName = SymbolPaletteRun.targetLayer(doc, entry, frame,
        this.anchor);
    if (layerName === null) {
        EAction.handleUserMessage(
            SymbolPaletteRun.noLayerReason(entry, frame));
        return;
    }

    // The block may simply not be in this drawing: an older cave, or
    // one that never met the template, or a symbol invented after the
    // drawing was made. Fetch it rather than refusing -- that is the
    // whole reason the palette can work outside a template drawing.
    var ensured = CsSymbolStore.ensureBlock(doc, di, entry.block);
    if (!ensured.ok) {
        EAction.handleUserMessage(ensured.error);
        return;
    }

    var ref = null;
    var insertError = "";
    try {
        // di HANDED IN, never read from a global: this runs in the
        // action's own script context, which has no simple.js globals.
        ref = CsSymbols.insert(doc, entry,
            new RVector(this.anchor.x, this.anchor.y),
            this.placementScale(), this.placementAngle(), layerName, di);
    } catch (eIns) {
        ref = null;
        insertError = String(eIns);
    }
    if (isNull(ref)) {
        // The two failures are DIFFERENT and used to be reported as the
        // same sentence: a missing block is a drawing problem the caver
        // can act on, and a thrown error is a bug in this tool. Saying
        // "this drawing has no SYM_PIT block" about the second one sent
        // a caver looking for a block that was sitting right there.
        if (insertError !== "") {
            EAction.handleUserMessage(qsTr("%1 could not be placed: %2")
                .arg(entry.nss).arg(insertError));
        } else {
            EAction.handleUserMessage(qsTr("%1 could not be placed: this " +
                "drawing has no %2 block.").arg(entry.nss).arg(entry.block));
        }
        return;
    }

    var added = false;
    try {
        // withLayerOn, not a bare add: an OFF layer accepts entities in
        // this build and then hides them, so a symbol placed onto a
        // layer the caver has turned off would be work they cannot see
        // and did not know they made.
        CsLayers.withLayerOn(doc, di, layerName, function() {
            // useCurrentAttributes FALSE. It defaults to true, and true
            // means the drawing's CURRENT layer overwrites the one the
            // reference was given -- which put every routed symbol on
            // layer 0 and made the whole plan/elevation/section routing
            // silently ornamental (measured 2026-09-06).
            var op = new RAddObjectOperation(ref, false);
            di.applyOperation(op);
        });
        added = !isNull(ref.getId()) && ref.getId() !== RObject.INVALID_ID;
    } catch (eAdd) {
        added = false;
    }
    if (!added) {
        EAction.handleUserMessage(
            SymbolPaletteRun.refusalReason(doc, layerName));
        return;
    }

    this.stampSection(doc, di, frame, ref.getId());
    // ...and which trip's survey it describes, by the rule Feature
    // Trace stamps a traced feature with. A symbol is placed at ONE
    // point, so that point is the whole path the trip is derived from.
    try {
        CsTrace.stampTrip(doc, di, ref.getId(),
            CsTrace.tripFor(doc, frame, [this.anchor], this.bays));
    } catch (eTrip) {
        // provenance is a nicety; the symbol is already placed
    }

    // The layer is NAMED every time, for Feature Trace's reason: with
    // no per-view button, this line is the caver's confirmation that
    // the view they clicked in was the view they meant.
    // The scale is in the message only when the DRAG chose it: a
    // placement at the panel's own setting has nothing to report that
    // the panel is not already showing.
    if (this.dragScale === null) {
        EAction.handleUserMessage(qsTr("%1 placed on %2")
            .arg(entry.nss).arg(layerName));
    } else {
        var feet = SymbolPaletteRun.sizeForScale(this.placementScale(),
            this.radius, this.unitsPerFoot);
        EAction.handleUserMessage(qsTr("%1 placed on %2 at %3 ft, %4 deg")
            .arg(entry.nss).arg(layerName)
            .arg(feet === null ? "?" : feet.toFixed(1))
            .arg(RMath.rad2deg(this.placementAngle()).toFixed(0)));
    }

    // One more of that symbol in this view, so the tile's count is now
    // one behind. Recounted HERE rather than on a document listener,
    // which this panel does not have -- a placement and a view change
    // are the two things that can move these numbers while the palette
    // is open.
    if (typeof SymbolPalette !== "undefined") {
        try {
            SymbolPalette.refreshCounts();
        } catch (eCounts) {
        }
    }

    this.warnUnclaimedProfile(frame, layerName);

    // A symbol on a profile layer grows the region the next placement
    // is measured against.
    this.refreshRegion();
};

/**
 * Stamps a section symbol with the station its bay is a section of.
 *
 * The SAME two tags a section trace carries -- CsTrace.SECTION_BAY_TAG
 * and SECTION_STATION_TAG, which is where they live precisely so that
 * this tool and Feature Trace cannot drift apart: a captured section
 * sweeps up traced linework and placed symbols together, and two
 * vocabularies for "which bay this belongs to" would mean the sweep had
 * to know about both.
 *
 * Silent about every failure. A stamp is provenance; failing to add it
 * must never cost the caver the symbol they just placed.
 */
SymbolPaletteRun.prototype.stampSection = function(doc, di, frame, id) {
    if (frame !== "section" || isNull(id) || isNull(doc) || isNull(di)) {
        return;
    }
    try {
        var bay = CsTrace.bayForPath(this.bays, [this.anchor]);
        if (bay === null || isNull(bay.station) || bay.station === "") {
            return;
        }
        var e = doc.queryEntity(id);
        if (isNull(e)) {
            return;
        }
        CsTags.set(e, CsTrace.SECTION_BAY_TAG, bay.bay);
        CsTags.set(e, CsTrace.SECTION_STATION_TAG, bay.station);
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
    } catch (eStamp) {
    }
};

/** Says so when a profile symbol landed on the SHARED layer, for the
 *  reason FeatureTraceRun.warnUnclaimedProfile states: work filed under
 *  no run is silently left behind when its band moves. */
SymbolPaletteRun.prototype.warnUnclaimedProfile = function(frame, layerName) {
    if (frame !== "profile") {
        return;
    }
    if (CsLayerVariants.split(layerName) !== null) {
        return;   // it landed on a run's layer; nothing to say
    }
    EAction.handleUserMessage(qsTr("That symbol is on the shared %1 -- no " +
        "band's box claims where it was placed, so it belongs to no survey " +
        "run and will not move with a band when the survey is revised.")
        .arg(layerName));
};

/**
 * The preview: the symbol itself, at the anchor, aimed where the drag
 * is pointing.
 *
 * A real block reference and not a marker, because the aim is the thing
 * being previewed -- a caver dragging a flow arrow round is watching
 * the arrow, and an abstract cross would tell them nothing. Falls back
 * to no preview when the block is not in the drawing yet: the import
 * happens on release, and importing on a mouse move would write to the
 * document during a preview.
 */
SymbolPaletteRun.prototype.getOperation = function(preview) {
    var entry = SymbolPaletteRun.armedEntry();
    var doc = this.getDocument();
    if (entry === null || isNull(doc) || isNull(this.anchor)) {
        return undefined;
    }
    var ref = null;
    try {
        ref = CsSymbols.insert(doc, entry,
            new RVector(this.anchor.x, this.anchor.y),
            this.placementScale(), this.placementAngle(), entry.layer,
            this.getDocumentInterface());
    } catch (ePrev) {
        return undefined;
    }
    if (isNull(ref)) {
        return undefined;
    }
    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    op.setLimitPreview(false);
    op.addObject(ref, false);
    return op;
};

SymbolPaletteRun.init = function(basePath) {
    // No widget names, no sort order, no icon: this action is reached
    // from the Symbol Palette panel and never from a menu. The variable
    // is deliberately NOT called "action" -- test_sort_orders_are_unique
    // reads "action.setSortOrder" out of the folder-named file, and a
    // second match there would make which one it reads a coin flip.
    var runAction = new RGuiAction(qsTr("Place Symbol"),
        RMainWindowQt.getMainWindow());
    runAction.setRequiresDocument(true);
    runAction.setScriptFile(basePath + "/SymbolPaletteRun.js");
};
