/**
 * SectionCapture -- turn a traced bay into a placed section block.
 *
 * THE SWEEP IS GEOMETRIC. Everything wholly inside the bay frame joins
 * the block, minus the frame, the ghost and the scan, which are tagged
 * and excluded by tag rather than by layer. Not "everything on the
 * section layers": a stray line from the previous sketch would join
 * this block silently, and nothing on the drawing would say so.
 *
 * THE TRACED ENTITIES ARE MOVED INTO THE BLOCK, NEVER CLONED. Probed
 * 2026-08-30 against a real RDocument: entity.clone() DOES exist and a
 * clone's setBlockId()+move() DOES survive its own add -- right up until
 * the entity it was cloned FROM is deleted, in this op or any LATER one.
 * At that point the clone vanishes too, silently: a block built from
 * clone()+deleteObject(original) came back with a correct-looking id
 * count on the very same script line and an EMPTY block definition once
 * the transaction actually landed -- the caver's tracing gone, nothing
 * in its place, no error. clone() and its source appear to share
 * identity below the script binding until the source is independently
 * committed and never touched again. Setting the ORIGINAL entity's own
 * blockId and moving IT sidesteps the whole problem: nothing is cloned,
 * nothing is deleted, the entity that was loose tracing simply becomes
 * the block's content by relocation. Confirmed by the same probe.
 *
 * THE BLOCK IS BLOCK-LOCAL about the ghost's centre, which is where the
 * centreline of the passage was. So the reference's insertion point IS
 * the centreline on the sheet, exactly as a computed section's is --
 * the two kinds drag, snap and leader identically.
 *
 * PLACEMENT IS PROPOSED, NOT IMPOSED, AND THE PROPOSAL IS DRAWN. The
 * march is a good guess, shown as a live preview -- the caver's own
 * tracing and its leader, at the proposed spot, from the moment the
 * command starts and following the cursor after that. Enter takes what
 * is on screen, a click puts it somewhere else. A march that finds
 * nowhere clear inside its cap hands the placement over rather than
 * flinging the section off-sheet.
 *
 * THE PREVIEW IS THE REAL LINEWORK, cloned and moved, not a placeholder
 * box -- the same rule Callout.getOperation follows and the same
 * clone-and-transform shape QCAD's own Modify/Transform.js previews
 * with (probed 2026-08-30: entity.clone() + op.addObject(clone,
 * RAddObjectsOperation.ForceNew) + di.previewOperation is accepted
 * here). Cloning is safe HERE and nowhere else in this file: a preview
 * operation is never applied, so no source entity is ever deleted out
 * from under a clone -- which is the trap that ate a whole tracing when
 * the block build was written that way (see the paragraph above).
 *
 * THE SCAN'S FIT IS READ OFF THE SCAN ITSELF, at capture time, not
 * copied from the SectionBayFit tag SectionBay wrote when the bay
 * opened. That tag records the AUTO-fit, and scaling and rotating the
 * scan onto the ghost is the entire workflow -- so it is wrong the
 * moment the caver touches the scan, and Edit Sketch used to restore
 * the scan at the auto-fit, throwing the caver's own fitting away.
 * SectionBay no longer writes that tag at all.
 *
 * TEARDOWN RESTORES THE SNAP. SectionBay tags the bay's own frame
 * with the snap class the caver was using before the bay switched it to
 * free (SectionBay.snapFree/recordSnap) -- restoring it THERE, on
 * open, would undo the free snap the instant the bay appeared, since
 * opening a bay finishes as soon as it is open. This is the bay's
 * teardown, so this is where the snap comes back: a fresh instance
 * built from the tagged class name, never the old object itself
 * (di.setSnap() takes ownership -- see restoreSnap).
 *
 * NO LONGER ITS OWN MENU ENTRY. "Capture Section" (`sectioncapture`/
 * `skc`) used to be reachable from the Cave Survey menu on its own,
 * which put it in front of a student before they had anything traced
 * to capture. The interactive click-to-place EAction below still
 * exists and still works exactly as it did, but nothing registers it
 * as an RGuiAction any more -- the only door in is
 * SectionCapture.captureNow, which SectionBayPanel's Capture button
 * (and Sketch Scans' own panel) call directly while a bay is open.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
include(includeBasePath + "/SectionBay.js");
include(includeBasePath + "/SectionEdit.js");

function SectionCapture(guiAction) {
    EAction.call(this, guiAction);
    this.bay = null;
    this.proposed = null;
    this.previewPos = undefined;
}

SectionCapture.prototype = new EAction();

/** Set by findBay when it refuses because more than one bay is open --
 *  read here rather than passed as a second return value, since every
 *  other caller (the headless test included) only wants the bay-or-null
 *  shape. Cleared at the top of every findBay call. */
SectionCapture.findBayError = null;

SectionCapture.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    this.bay = SectionCapture.findBay(doc);
    if (this.bay === null) {
        SectionBay.say(SectionCapture.findBayError !== null ?
            SectionCapture.findBayError :
            qsTr("There is no open section bay in this drawing.\n\n" +
                "Cross Section's \"Trace a scanned section\" route " +
                "opens one."));
        this.terminate();
        return;
    }
    if (this.bay.traced.length === 0) {
        SectionBay.say(qsTr("Nothing has been traced inside the bay " +
            "yet, so there is no section to capture."));
        this.terminate();
        return;
    }
    this.proposed = SectionCapture.proposePosition(doc, this.bay);
    if (this.proposed === null) {
        // Boxed in. Honest answer: the caver places it.
        SectionCapture.zoomToPlacement(doc, di, this.bay, null);
        this.setCommandPrompt(qsTr("No clear spot found -- pick where " +
            "the section goes"));
        this.setLeftMouseTip(qsTr("Position of the section"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        this.setCrosshairCursor();
        di.setClickMode(RAction.PickCoordinate);
        return;
    }
    SectionCapture.zoomToPlacement(doc, di, this.bay, this.proposed);
    this.setCommandPrompt(qsTr("Enter to accept the proposed spot, or " +
        "pick another"));
    this.setLeftMouseTip(qsTr("Position of the section"));
    this.setRightMouseTip(EAction.trCancel);
    EAction.showSnapTools();
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);
    // THE PROPOSAL IS ON SCREEN BEFORE THE MOUSE MOVES. "Enter to
    // accept the proposed spot" is a prompt about something the caver
    // cannot see until the first mouse-move preview fires -- and Enter
    // is answerable without ever moving the mouse. Seeded here so the
    // proposal is drawn the instant the command starts.
    this.previewPos = { x: this.proposed.x, y: this.proposed.y };
    this.updatePreview();
};

/** Enter takes the proposal. */
SectionCapture.prototype.enterEvent = function() {
    if (this.proposed !== null) {
        this.finish(this.proposed);
    }
};

SectionCapture.prototype.pickCoordinate = function(event, preview) {
    var pos = event.getModelPosition();
    this.previewPos = { x: pos.x, y: pos.y };
    if (preview) {
        // EAction.updatePreview() calls getOperation(true) and hands
        // the result to di.previewOperation() -- the same path Callout
        // and CalloutElev preview through. Without this call previewPos
        // was written on every mouse move and read by nothing at all.
        this.updatePreview();
        return;
    }
    this.finish({ x: pos.x, y: pos.y });
};

/**
 * The live preview, and it is the REAL tracing.
 *
 * Returns undefined for the non-preview call on purpose: the actual
 * write goes through SectionCapture.capture, which mints the block,
 * guards every layer it touches and tears the bay down. An operation
 * applied straight from here would skip all of that.
 */
SectionCapture.prototype.getOperation = function(preview) {
    if (!preview) {
        return undefined;
    }
    var doc = this.getDocument();
    if (isNull(doc) || this.bay === null ||
            this.previewPos === undefined || this.previewPos === null) {
        return undefined;
    }
    return SectionCapture.previewOp(doc, this.bay, this.previewPos);
};

/**
 * What the section would look like at `position`: the traced linework,
 * cloned and moved out of the bay, plus the leader that would run back
 * to the station.
 *
 * CLONED, not moved. Everywhere else in this file the originals are
 * moved and never cloned -- clone()+delete-the-source loses the clone
 * silently (see the file header). Neither half of that applies to a
 * preview: nothing is committed and nothing is deleted, and cloning is
 * how QCAD's own Modify/Transform.js previews a transform. Moving the
 * originals here would drag the caver's tracing out of the bay on every
 * mouse move.
 *
 * ForceNew, so the clones render as new entities rather than as
 * modifications of the entities they were cloned from -- otherwise the
 * tracing appears to jump out of the bay instead of being echoed at the
 * candidate spot.
 *
 * A preview must never take the tool down: every failure here returns
 * undefined and the caver simply sees no preview.
 *
 * \return an RAddObjectsOperation, or undefined
 */
SectionCapture.previewOp = function(doc, bay, position) {
    try {
        if (isNull(bay) || isNull(bay.traced) || bay.traced.length === 0) {
            return undefined;
        }
        var origin = SectionCapture.originOf(bay);
        var delta = new RVector(position.x - origin.x, position.y - origin.y);
        var op = new RAddObjectsOperation();
        var drew = false;
        var i;
        for (i = 0; i < bay.traced.length; i++) {
            var e = doc.queryEntity(bay.traced[i]);
            if (isNull(e)) {
                continue;
            }
            var ghosted = e.clone();
            ghosted.move(delta);
            op.addObject(ghosted, RAddObjectsOperation.ForceNew);
            drew = true;
        }
        if (!drew) {
            return undefined;
        }
        // The leader too -- D4's "with the leader attached". Built by
        // the same CalloutWrite.oneLeader the real capture uses, so
        // what is previewed is the leader that lands, arrowhead at the
        // station and all. NO CALLOUT ID: minting one per mouse move
        // would be a fresh UUID per frame for an entity that is never
        // committed, and CsTags.set no-ops on "" by design, so the
        // preview leader simply carries no CalloutId.
        var layerName = CsCallout.STYLES["annotation"] ||
            CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
        SectionCapture.addLeader(doc, op, "", bay.station,
            position, "annotation", layerName);
        return op;
    } catch (ePrev) {
        return undefined;
    }
};

/**
 * The open bay: its frame, its rect, its station, its furniture and the
 * tracing inside it.
 *
 * The id set is DIFFED rather than ordered -- queryAllEntities is not
 * insertion-ordered, so "the last entity" means nothing here.
 *
 * TWO OPEN BAYS ARE REFUSED, NOT MERGED. A first pass finds every FRAME
 * before touching ghost or scan at all: with two bays open,
 * queryAllEntities' lack of order means a single combined pass could
 * bind bay A's frame to bay B's ghost and scan (wrong block origin,
 * wrong furniture torn down) with nothing to say so. More than one
 * frame is therefore a refusal, not a coin flip -- SectionCapture.
 * findBayError carries why, since this function's return type is
 * already "the bay, or null" and cannot also carry an explanation.
 *
 * \return {id, rect, station, frame, ghost, scan, traced: [ids]} or null
 */
SectionCapture.findBay = function(doc) {
    SectionCapture.findBayError = null;
    var ids = doc.queryAllEntities(false, true);
    var frame = null, bayId = null, frameCount = 0;
    var i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var tag = CsTags.get(e, SectionBay.TAG_BAY);
        if (tag === "") {
            continue;
        }
        if (CsTags.get(e, "SectionBayRole") === SectionBay.ROLE_FRAME) {
            frameCount++;
            frame = e;
            bayId = tag;
        }
    }
    if (frameCount === 0) {
        return null;
    }
    if (frameCount > 1) {
        SectionCapture.findBayError = qsTr("There is more than one open " +
            "section bay in this drawing.\n\nClose all but the one you " +
            "mean to capture -- Capture cannot tell them apart.");
        return null;
    }

    // Ghost and scan are matched to THIS frame's bayId, not taken from
    // just any tagged entity -- with two bays that used to be able to
    // pair bay A's frame with bay B's furniture. SectionEdit.bayOriginOf
    // does the same match for the same reason; keep them agreeing.
    var ghost = null, scan = null;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SectionBay.TAG_BAY) !== bayId) {
            continue;
        }
        var role = CsTags.get(e, "SectionBayRole");
        if (role === SectionBay.ROLE_GHOST) {
            ghost = e;
        } else if (role === SectionBay.ROLE_SCAN) {
            scan = e;
        }
    }
    // The frame may have been dragged since it was drawn, and a
    // bounding box is CACHED across a modify -- read it only after an
    // update(), or the sweep is measured against where the frame used
    // to be.
    frame.update();
    var fb = frame.getBoundingBox();
    var rect = { x1: fb.getMinimum().x, y1: fb.getMinimum().y,
                 x2: fb.getMaximum().x, y2: fb.getMaximum().y };

    var exclude = [frame.getId()];
    if (ghost !== null) { exclude.push(ghost.getId()); }
    if (scan !== null) { exclude.push(scan.getId()); }

    var items = [];
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        items.push({ id: ids[i],
                     box: { x1: b.getMinimum().x, y1: b.getMinimum().y,
                            x2: b.getMaximum().x, y2: b.getMaximum().y } });
    }
    return {
        id: bayId,
        rect: rect,
        station: CsTags.get(frame, "SectionBayStation"),
        frame: frame,
        ghost: ghost,
        scan: scan,
        // The placement an EARLIER reference had, if this bay was
        // reopened from one -- see SectionBay.TAG_REF_SCALE. Always
        // defined, so capture() never has to ask whether this bay came
        // from a reopen.
        refScale: SectionCapture.scaleTagOf(frame),
        refRot: SectionCapture.rotTagOf(frame),
        traced: CsSectionBay.sweepOf(items, rect, exclude)
    };
};

/** The reference scale parked on the frame ("sx,sy"), or (1,1). A tag
 *  that is absent, malformed or degenerate (a zero factor collapses the
 *  section to nothing) falls back to the identity rather than to a
 *  number that would make the section vanish. */
SectionCapture.scaleTagOf = function(frame) {
    var one = { x: 1, y: 1 };
    if (frame === null || isNull(frame)) {
        return one;
    }
    var raw = CsTags.get(frame, SectionBay.TAG_REF_SCALE);
    if (raw === "") {
        return one;
    }
    var parts = String(raw).split(",");
    if (parts.length !== 2) {
        return one;
    }
    var sx = parseFloat(parts[0]);
    var sy = parseFloat(parts[1]);
    if (isNaN(sx) || isNaN(sy) || sx === 0 || sy === 0) {
        return one;
    }
    return { x: sx, y: sy };
};

/** The reference rotation parked on the frame, in radians, or 0. */
SectionCapture.rotTagOf = function(frame) {
    if (frame === null || isNull(frame)) {
        return 0;
    }
    var raw = CsTags.get(frame, SectionBay.TAG_REF_ROT);
    if (raw === "") {
        return 0;
    }
    var rot = parseFloat(raw);
    return isNaN(rot) ? 0 : rot;
};

/**
 * The fit of a bay's scan, read off THE SCAN ITSELF: its live insertion
 * point and its u/v vectors, with the insertion point expressed
 * relative to `origin` (the section's own centre, which becomes the
 * block's 0,0).
 *
 * THIS IS THE WHOLE POINT OF F1. The scan's u and v vectors carry every
 * scale and every rotation the caver applied while fitting it over the
 * ghost -- probed 2026-08-30 against a real RImageEntity: a scale(2) +
 * rotate(30 degrees) turns u=(0.5,0) into u=(0.866,0.5). Copying
 * SectionBay's SectionBayFit tag instead read back the AUTO-fit the
 * bay opened at and discarded the fitting entirely.
 *
 * \return a fit for CsSectionBay.serializeFit, or null
 */
SectionCapture.fitOfScan = function(scan, origin) {
    try {
        if (scan === null || isNull(scan)) {
            return null;
        }
        var d = scan.getData();
        var ip = d.getInsertionPoint();
        var u = d.getUVector();
        var v = d.getVVector();
        var fit = { ux: u.x, uy: u.y, vx: v.x, vy: v.y,
                    tx: ip.x - origin.x, ty: ip.y - origin.y };
        // A NaN anywhere would serialize as 0.000000 and place the scan
        // somewhere arbitrary on reopen. No fit at all is honest; a
        // wrong one is not.
        if (isNaN(fit.ux) || isNaN(fit.uy) || isNaN(fit.vx) ||
                isNaN(fit.vy) || isNaN(fit.tx) || isNaN(fit.ty)) {
            return null;
        }
        return fit;
    } catch (e) {
        return null;
    }
};

/**
 * Is this entity a station label this tool wrote into an earlier
 * capture of the same section?
 *
 * BOTH TESTS MATTER. The layer alone would claim a caver's own note
 * that happens to sit on the label layer; the tag alone would claim
 * every piece of a computed section's block, all of which carry it.
 * A miss here costs a duplicate label, never anyone's work: the only
 * thing done with the answer is to regenerate the same text.
 */
SectionCapture.isStationLabel = function(doc, e) {
    try {
        if (isNull(e) || typeof e.getType !== "function" ||
                e.getType() !== RS.EntityText) {
            return false;
        }
        if (CsTags.get(e, CsSectionDraw.TAG) === "") {
            return false;
        }
        return doc.getLayerName(e.getLayerId()) ===
            CsLayers.CTRL_SECTION_TEXT_LABELS;
    } catch (eLbl) {
        return false;
    }
};

/** The bay's origin: the ghost's centre, or the frame's if there is no
 *  ghost. This becomes the block's 0,0 and therefore the centreline. */
SectionCapture.originOf = function(bay) {
    if (bay.ghost !== null) {
        bay.ghost.update();
        var g = bay.ghost.getBoundingBox();
        return { x: (g.getMinimum().x + g.getMaximum().x) / 2,
                 y: (g.getMinimum().y + g.getMaximum().y) / 2 };
    }
    return { x: (bay.rect.x1 + bay.rect.x2) / 2,
             y: (bay.rect.y1 + bay.rect.y2) / 2 };
};

/** The tracing's own extent, block-local. */
SectionCapture.localBoxOf = function(doc, bay, origin) {
    var x1 = 0, y1 = 0, x2 = 0, y2 = 0, seen = false;
    for (var i = 0; i < bay.traced.length; i++) {
        var e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        e.update();
        var b = e.getBoundingBox();
        var bx1 = b.getMinimum().x - origin.x;
        var by1 = b.getMinimum().y - origin.y;
        var bx2 = b.getMaximum().x - origin.x;
        var by2 = b.getMaximum().y - origin.y;
        if (!seen) {
            x1 = bx1; y1 = by1; x2 = bx2; y2 = by2;
            seen = true;
        } else {
            if (bx1 < x1) { x1 = bx1; }
            if (by1 < y1) { y1 = by1; }
            if (bx2 > x2) { x2 = bx2; }
            if (by2 > y2) { y2 = by2; }
        }
    }
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
};

/** Everything the section must not land on: plan-frame linework and
 *  every section already placed. The bay's own contents are excluded --
 *  they are about to stop existing. */
SectionCapture.obstaclesOf = function(doc, bay) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, SectionBay.TAG_BAY) !== "") {
            continue;                      // bay furniture
        }
        var layerName = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(layerName) !== "plan") {
            continue;                      // profile, section, sheet
        }
        e.update();
        var b = e.getBoundingBox();
        out.push({ x1: b.getMinimum().x, y1: b.getMinimum().y,
                   x2: b.getMaximum().x, y2: b.getMaximum().y });
    }
    return out;
};

/** March outward from the station and propose a spot, or null. */
SectionCapture.proposePosition = function(doc, bay) {
    var at = SectionCapture.stationPosOf(doc, bay.station);
    if (at === null) {
        return null;
    }
    var origin = SectionCapture.originOf(bay);
    var localBox = SectionCapture.localBoxOf(doc, bay, origin);
    var obstacles = SectionCapture.obstaclesOf(doc, bay);

    var tangent = SectionCapture.tangentAt(doc, bay.station);
    var perp = CsSectionBay.perpOf(tangent);
    var side = CsSectionBay.clearerSide(at, perp, obstacles, 50);
    var dir = { x: perp.x * side, y: perp.y * side };

    return CsSectionBay.marchOut(at, dir, localBox, obstacles,
        CsSectionBay.MARGIN, CsSectionBay.CAP);
};

/** The local leg direction at a station -- the survey's own, so the
 *  section goes out SIDEWAYS from the passage rather than along it. */
SectionCapture.tangentAt = function(doc, station) {
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var here = asDrawn.resolved.stations[station];
        var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
            { x: here.x, y: here.y });
        var a = asDrawn.resolved.stations[leg.from];
        var b = asDrawn.resolved.stations[leg.to];
        return { x: b.x - a.x, y: b.y - a.y };
    } catch (e) {
        return { x: 1, y: 0 };
    }
};

/** Where a station sits on the plan, or null when the drawing has no
 *  station by that name. */
SectionCapture.stationPosOf = function(doc, station) {
    try {
        var stations = CsTags.collectStations(doc);
        for (var i = 0; i < stations.length; i++) {
            if (stations[i].name === station) {
                return { x: stations[i].pos.x, y: stations[i].pos.y };
            }
        }
    } catch (e) {
        // a drawing that cannot be read for stations simply has none
    }
    return null;
};

/**
 * Everything the caver must be able to see while placing: the station
 * the section hangs off, and the section itself at `position`, with
 * the leader between them.
 *
 * `position` may be null -- a boxed-in station has no proposal -- and
 * then the box is the station plus a section-sized allowance all round,
 * so the click-to-place fallback still starts looking at the station
 * rather than at the bay.
 *
 * \return {x1,y1,x2,y2} or null when the station is not on the drawing
 */
SectionCapture.placementBox = function(doc, bay, position) {
    var at = SectionCapture.stationPosOf(doc, bay.station);
    if (at === null) {
        return null;
    }
    var origin = SectionCapture.originOf(bay);
    var local = SectionCapture.localBoxOf(doc, bay, origin);
    var w = Math.abs(local.x2 - local.x1);
    var h = Math.abs(local.y2 - local.y1);
    var box;
    if (isNull(position)) {
        // No proposal: allow for a section landing on any side.
        var r = Math.max(w, h, 1) + CsSectionBay.MARGIN;
        box = { x1: at.x - r, y1: at.y - r, x2: at.x + r, y2: at.y + r };
    } else {
        box = { x1: Math.min(at.x, position.x + local.x1),
                y1: Math.min(at.y, position.y + local.y1),
                x2: Math.max(at.x, position.x + local.x2),
                y2: Math.max(at.y, position.y + local.y2) };
    }
    // A degenerate box (a single traced dot, say) zooms to nothing.
    if (box.x2 - box.x1 < 1) { box.x1 -= 1; box.x2 += 1; }
    if (box.y2 - box.y1 < 1) { box.y1 -= 1; box.y2 += 1; }
    return box;
};

/**
 * PUT THE STATION ON SCREEN BEFORE THE FIRST CLICK.
 *
 * The bay is framed off to one side of the plan -- SectionBay.zoomTo
 * left the view sitting on it -- while the proposal lands beside the
 * station the section was cut at, which is usually nowhere near. Every
 * capture therefore began with the caver panning back across the plan
 * by hand to find a preview they could not see, once per section drawn.
 *
 * Failure is survivable in both directions: a station that cannot be
 * found, or a build that cannot zoom, leaves the view exactly where it
 * was and the capture still works.
 */
SectionCapture.zoomToPlacement = function(doc, di, bay, position) {
    try {
        var box = SectionCapture.placementBox(doc, bay, position);
        if (box === null || isNull(di)) {
            return;
        }
        di.zoomTo(new RBox(new RVector(box.x1, box.y1),
                           new RVector(box.x2, box.y2)), 40);
    } catch (e) {
        // a view that will not move is not a reason to refuse a capture
    }
};

/** Build the block, place it, leader it, tear the bay down. */
SectionCapture.prototype.finish = function(position) {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.bay === null) {
        this.terminate();
        return;
    }
    try {
        var id = SectionCapture.capture(doc, di, this.bay, position);
        if (id === null) {
            SectionBay.say(qsTr("The section could not be placed -- " +
                "its block was refused by this drawing."));
        } else {
            EAction.handleUserMessage(
                qsTr("Section at %1 captured from %2 traced entities")
                    .arg(this.bay.station).arg(this.bay.traced.length));
            // The bay is closed, so the panel that offers to close it
            // has nothing left to offer. Guarded: this action also runs
            // where no panel was ever built.
            if (typeof SectionBayPanel !== "undefined") {
                SectionBayPanel.hide();
            }
        }
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY here, so the
        // alternative is a command that looks like it worked and drew
        // nothing.
        SectionBay.say(qsTr("The section could not be placed.\n\n") + e);
    }
    this.terminate();
};

/**
 * Capture the open bay right now, at a PROPOSED position, with no
 * interactive re-pick -- the entry point for anything that is a button
 * rather than a command: SectionBayPanel's Capture button, and Sketch
 * Scans' own panel (SketchScans.captureSoon), neither of which can
 * leave a click hanging the way the old `skc` EAction's
 * enter-to-accept-or-click-elsewhere flow could.
 *
 * SAME REFUSALS AS `skc` HAD, in the same order: no open bay (with
 * findBay's own reason when there is one -- two bays open, say), then
 * nothing traced. Both are reported through EAction.handleUserMessage
 * rather than a modal QMessageBox, because the caller is a dock panel
 * that must stay on screen either way -- a refusal here is not a
 * reason to close it.
 *
 * A BOXED-IN STATION FALLS BACK TO THE BAY'S OWN CENTRE rather than
 * waiting for a click nothing here can ask for. `skc` handed the caver
 * the cursor when proposePosition came back null; a button has no
 * cursor to hand over, so the section lands at the bay's own origin
 * instead -- clearly not final, and no worse than the section a caver
 * would have dropped there by hand.
 *
 * \return the callout id, or null when nothing was captured
 */
SectionCapture.captureNow = function(doc, di) {
    var bay = SectionCapture.findBay(doc);
    if (bay === null) {
        EAction.handleUserMessage(SectionCapture.findBayError !== null ?
            SectionCapture.findBayError :
            qsTr("There is no open section bay in this drawing.\n\n" +
                "Cross Section's \"Trace a scanned section\" route opens " +
                "one."));
        return null;
    }
    if (bay.traced.length === 0) {
        EAction.handleUserMessage(qsTr("Nothing has been traced inside " +
            "the bay yet, so there is no section to capture."));
        return null;
    }
    var position = SectionCapture.proposePosition(doc, bay);
    if (position === null) {
        position = SectionCapture.originOf(bay);
    }
    // Before capture: the bay's traced entities are what size the box,
    // and capture moves them into the block.
    SectionCapture.zoomToPlacement(doc, di, bay, position);
    try {
        var id = SectionCapture.capture(doc, di, bay, position);
        if (id === null) {
            EAction.handleUserMessage(qsTr("The section could not be " +
                "placed -- its block was refused by this drawing."));
        } else {
            EAction.handleUserMessage(
                qsTr("Section at %1 captured from %2 traced entities")
                    .arg(bay.station).arg(bay.traced.length));
        }
        return id;
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY here, so the
        // alternative is a button that looks like it worked and drew
        // nothing.
        EAction.handleUserMessage(qsTr("The section could not be " +
            "placed.\n\n") + e);
        return null;
    }
};

/**
 * The whole capture, as one callable so the headless test can drive it
 * without a GUI event.
 *
 * \return the callout id, or null
 */
SectionCapture.capture = function(doc, di, bay, position) {
    // NOTHING TRACED, NOTHING TO CAPTURE. beginEvent already refuses
    // this before the GUI ever gets here, but capture() is the reusable
    // entry point -- the headless test drives it directly, and so could
    // any future caller -- and this guard has to hold even when nothing
    // upstream checked first. Returning here, before the block name is
    // even minted, means an empty sweep never defines a block at all.
    if (isNull(bay) || isNull(bay.traced) || bay.traced.length === 0) {
        return null;
    }

    var origin = SectionCapture.originOf(bay);
    var scale = CsSectionDraw.scaleOf();
    var id = CsCallout.newId();
    var name = CsSectionDraw.blockName(id);

    // Read the snap to restore BEFORE the frame that carries it is
    // queued for deletion below -- see the file header.
    var snapClass = (bay.frame !== null) ?
        CsTags.get(bay.frame, SectionBay.TAG_SNAP) : "";

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

    var op = new RAddObjectsOperation();
    op.setText("Capture sketched section");

    // Every layer this single operation touches besides the three bay
    // layers below -- the annotation layer the reference and leader
    // land on, plus whatever SECTION-* layer(s) the caver actually
    // traced on. None of these are suite-LOCKED, but any of them could
    // be OFF or FROZEN by the caver's own choice, and an OFF/FROZEN
    // layer refuses an add/modify SILENTLY while the rest of this mixed
    // operation still commits -- which is exactly how a hidden
    // annotation layer used to swallow the reference while the tracing
    // still vanished into the block and the bay still tore down: no
    // error, no reference, the caver's work gone. Collected here, while
    // the traced entities' layers are still their ORIGINAL ones (the
    // move below relocates the entities, never their layerId).
    // THE EXTENT BEFORE THE MOVE. localBoxOf measures world bounding
    // boxes and subtracts `origin`; once the loop below has moved the
    // entities by -origin they are ALREADY block-local, and asking
    // again would subtract the origin a second time. Read here, used
    // for the station label after the move.
    var localBox = SectionCapture.localBoxOf(doc, bay, origin);

    var layerNames = [];
    var i, e;
    for (i = 0; i < bay.traced.length; i++) {
        e = doc.queryEntity(bay.traced[i]);
        if (isNull(e)) {
            continue;
        }
        layerNames.push(doc.getLayerName(e.getLayerId()));
        // A LABEL FROM AN EARLIER CAPTURE IS NOT TRACING. Edit Sketch
        // explodes a section back into a bay, so the station label this
        // function wrote last time comes back as loose content and
        // would be swept in beside the fresh one -- two labels, one on
        // top of the other, more of them every round trip. Dropped
        // instead: it is regenerated below from the bay's own station,
        // which is the only thing it ever said.
        if (SectionCapture.isStationLabel(doc, e)) {
            op.deleteObject(e);
            continue;
        }
        // MOVED into the block, not cloned -- see the file header. The
        // entity that was loose tracing a moment ago simply becomes the
        // block's content; nothing is duplicated and nothing needs a
        // separate delete.
        e.setBlockId(blockId);
        e.move(new RVector(-origin.x, -origin.y));
        op.addObject(e, false);
    }

    // WHICH STATION THIS IS, INSIDE THE BLOCK.
    //
    // A computed section gets a caption under it from
    // CsSectionDraw.define; a sketched one is a block minted here and
    // filled with the caver's own tracing, so nothing said what it was
    // -- a page of captured sections was a page of anonymous outlines.
    //
    // AT THE CENTROID, not under the outline like the computed
    // caption: Nathan's call. It rides inside the block, so it moves,
    // scales and rotates with the section rather than having to be
    // kept in step with it.
    if (bay.station !== null && bay.station !== undefined &&
            bay.station !== "") {
        CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_TEXT_LABELS);
        layerNames.push(CsLayers.CTRL_SECTION_TEXT_LABELS);
        var cx = (localBox.x1 + localBox.x2) / 2;
        var cy = (localBox.y1 + localBox.y2) / 2;
        var lpos = new RVector(cx, cy);
        // The FULL constructor, with position AND alignment point --
        // setPosition() alone reads back correctly while the entity
        // renders at the ORIGIN, which shipped once already. Middle and
        // centre so the centroid is the text's own middle, not the
        // corner it starts at.
        var ltd = new RTextData(lpos, lpos,
            CsSectionDraw.textHeight(doc), 100.0,
            RS.VAlignMiddle, RS.HAlignCenter, RS.LeftToRight, RS.Exact,
            1.0, bay.station, "standard", false, false, 0.0, false);
        CsSectionDraw.addToBlock(doc, op, blockId,
            new RTextEntity(doc, ltd),
            CsLayers.CTRL_SECTION_TEXT_LABELS, id);
    }

    var layerName = CsCallout.STYLES["annotation"] ||
        CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
    CsLayers.ensure(doc, di, layerName);
    layerNames.push(layerName);
    layerNames.push(CsLayers.CTRL_SECTION_GHOST);
    layerNames.push(CsLayers.CTRL_SECTION_SCAN);

    // THE SCALE AND ROTATION ARE CARRIED, NOT RESET. A fresh capture
    // has no earlier reference and gets the identity; a re-capture
    // after Edit Sketch gets back whatever the caver had given the
    // reference before the reopen deleted it, parked on the frame in
    // the meantime (SectionBay.TAG_REF_SCALE). Hard-coding
    // RVector(1,1) and 0.0 here is what silently undid a caver's own
    // scaling and rotation on every single edit round trip, against
    // CalloutWrite.refreshSections' stated contract that position,
    // scale and rotation are theirs.
    var refScale = bay.refScale || { x: 1, y: 1 };
    var refRot = (typeof bay.refRot === "number" && !isNaN(bay.refRot)) ?
        bay.refRot : 0;
    var at = new RVector(position.x, position.y);
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, at,
            new RVector(refScale.x, refScale.y), refRot));
    ref.setLayerId(doc.getLayerId(layerName));

    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(ref, CsCallout.KEY.ID, id);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.STYLE, "annotation");
    CsTags.set(ref, CsCallout.KEY.SIDE, "auto");
    CsTags.set(ref, CsCallout.KEY.LEADER, CsCallout.LEADER_DEFAULT);
    CsTags.set(ref, CsCallout.KEY.SECTION_SOURCE, CsCallout.SOURCE_SKETCH);
    CsTags.set(ref, CsCallout.KEY.SECTION_STATION, bay.station);
    CsTags.set(ref, CsCallout.KEY.SECTION_SCALE, String(scale));
    if (bay.scan !== null) {
        // THE PATH GOES IN RELATIVE TO scans/. An absolute path is only
        // true on the machine that wrote it, and cave projects live on
        // a shared drive, get renamed, and get opened by whoever was on
        // the trip -- an absolute path makes every Edit Sketch on any
        // other machine report a missing scan. The design spec's tag
        // table says "relative to scans/" and SketchScans already tags
        // its own inserted images that way. A scan from outside this
        // cave's scans/ folder stays absolute (CsCave.relativeToScans),
        // because a wrong relative path resolves to nothing at all.
        var path = CsTags.get(bay.scan, CsCallout.KEY.SECTION_SCAN);
        if (path !== "") {
            CsTags.set(ref, CsCallout.KEY.SECTION_SCAN,
                CsCave.relativeToScans(SectionBay.scansFolderOf(doc),
                    path));
        }
        // THE FIT COMES OFF THE SCAN ENTITY, not off its tag -- see
        // SectionCapture.fitOfScan and the file header.
        var fit = SectionCapture.fitOfScan(bay.scan, origin);
        if (fit !== null) {
            CsTags.set(ref, CsCallout.KEY.SECTION_FIT,
                CsSectionBay.serializeFit(fit));
        }
    }
    op.addObject(ref, false);

    // The leader, queued into this SAME operation -- see addLeader's own
    // comment for why this stopped being a second applyOperation.
    SectionCapture.addLeader(doc, op, id, bay.station, position,
        "annotation", layerName);

    // The bay's furniture, gone in the same operation -- one undo. The
    // frame's own layer, CTRL-SECTION-BOX, ships LOCKED (a caver's
    // protection against dragging the boundary the sweep was measured
    // against) and a locked layer refuses a delete exactly as silently
    // as an off one does. withLayerOn alone only clears off/frozen, so
    // the frame's delete additionally needs withLayerUnlocked, nested
    // exactly as SectionBay.addFrame nests them for the ADD.
    // CTRL-SECTION-GHOST and CTRL-SECTION-SCAN are not suite-locked,
    // but a caver may have switched either off since the bay opened, so
    // both still need guarding around this same single commit or a
    // hidden ghost or scan silently survives teardown and is swept into
    // the NEXT section. The ghost lives on its own layer rather than
    // CTRL-SECTION-OUTLINE (see SectionBay.addGhost) precisely so it
    // can be told apart from a real, placed section outline -- which
    // means its delete has to be unwrapped by that same layer's name,
    // not the outline's.
    if (bay.frame !== null) { op.deleteObject(bay.frame); }
    if (bay.ghost !== null) { op.deleteObject(bay.ghost); }
    if (bay.scan !== null) { op.deleteObject(bay.scan); }

    // SectionEdit.withLayersOn nests CsLayers.withLayerOn for however
    // many distinct OFF/FROZEN-only layers a single capture happens to
    // touch (annotation, ghost, scan, every traced layer) -- reused
    // rather than re-copied, since SectionEdit's own reopen already had
    // to solve exactly this for an unpredictable set of layers. Only
    // CTRL-SECTION-BOX needs more than that (it is LOCKED, not just
    // possibly off), so it keeps its own withLayerOn+withLayerUnlocked
    // pairing nested inside.
    SectionEdit.withLayersOn(doc, di, layerNames, function() {
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
            CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_SECTION_BOX,
                function() {
                    di.applyOperation(op);
                });
        });
    });

    SectionCapture.restoreSnap(di, snapClass);
    return id;
};

/**
 * One straight leader from the station to the section, queued into
 * `op` -- the SAME operation the rest of the capture commits, rather
 * than a second di.applyOperation of its own. Two reasons: a Capture
 * used to be two undo steps for what the rest of this suite treats as
 * one phase, and a hidden annotation layer could drop the leader
 * silently while the section itself still landed (the op it used to run
 * through had no layer guard around it at all). Built through
 * CalloutWrite.oneLeader, the entity-construction step every section
 * leader in this suite now shares, so a sketched section's leader
 * carries the Style tag exactly as a computed section's does.
 *
 * Straight, not curved: a DXF LEADER record has no bulge, and an arc
 * leader loses its arrow tip on a round trip.
 *
 * \return the leader entity queued, or null if the station cannot be
 *         found
 */
SectionCapture.addLeader = function(doc, op, id, station, position, style,
        layerName) {
    var stations = CsTags.collectStations(doc);
    var tip = null;
    for (var i = 0; i < stations.length; i++) {
        if (stations[i].name === station) {
            tip = stations[i].pos;
            break;
        }
    }
    if (tip === null) {
        return null;
    }
    // The tip FIRST: RLeaderData puts its arrowhead on the first vertex
    // (CalloutWrite.oneLeader's own comment proves the same shape
    // against this bridge), and the arrow belongs at the station, not
    // at the section.
    return CalloutWrite.oneLeader(doc, op, id,
        { x: tip.x, y: tip.y }, { x: position.x, y: position.y },
        style, layerName);
};

/** Every snap class SectionBay might have tagged the frame with, by
 *  name. RSnapCoordinate does NOT exist in this build -- probed
 *  2026-08-30, ReferenceError on construction -- so it is deliberately
 *  absent here; a frame tagged with it (there will never be one, since
 *  SectionBay.recordSnap can only tag a name it actually read off a
 *  live snap) would just fall through restoreSnap's "unknown" branch. */
SectionCapture.SNAP_CTORS = {
    "RSnapFree": function() { return new RSnapFree(); },
    "RSnapAuto": function() { return new RSnapAuto(); },
    "RSnapGrid": function() { return new RSnapGrid(); },
    "RSnapEnd": function() { return new RSnapEnd(); },
    "RSnapCenter": function() { return new RSnapCenter(); },
    "RSnapMiddle": function() { return new RSnapMiddle(); },
    "RSnapIntersection": function() { return new RSnapIntersection(); },
    "RSnapDistance": function() { return new RSnapDistance(); },
    "RSnapOnEntity": function() { return new RSnapOnEntity(); },
    "RSnapPerpendicular": function() { return new RSnapPerpendicular(); },
    "RSnapReference": function() { return new RSnapReference(); },
    "RSnapTangential": function() { return new RSnapTangential(); }
};

/**
 * Put the snap back to what it was before the bay switched it to free.
 *
 * di.setSnap() TAKES OWNERSHIP of whatever is passed to it, so holding
 * the OLD snap object across the bay's whole lifetime and handing it
 * back here would be a use-after-free the moment anything else in QCAD
 * sets a different snap in between. Nothing is held: only the CLASS
 * NAME survived, tagged on the frame at snapFree time, and this builds
 * a genuinely FRESH instance from it. A name this build does not know
 * (or no name at all, e.g. a bay opened before this existed) leaves the
 * snap exactly where Capture found it -- free -- rather than guessing.
 */
SectionCapture.restoreSnap = function(di, className) {
    if (className === null || className === undefined || className === "") {
        return;
    }
    var make = SectionCapture.SNAP_CTORS[className];
    if (typeof make !== "function") {
        return;
    }
    try {
        di.setSnap(make());
    } catch (e) {
        // leaving the snap on free is survivable; a crash is not
    }
};



/**
 * Hand control to the interactive capture -- the placement flow with a
 * live preview, "Enter to accept the proposed spot, or pick another",
 * and the honest click-to-place fallback for a boxed-in station.
 *
 * This is what the Capture button must use. captureNow() below places
 * at the proposal with no re-pick, which is right for a headless test
 * and wrong for a caver: where a section sits on the sheet is a
 * cartographer's decision, and Capture Section always let them make it.
 *
 * DEFERRED THROUGH A TIMER, exactly as SketchScans.alignSoon is and for
 * the same reason: this runs inside a panel's own click handler, and
 * setCurrentAction tears down the action that is running -- QCAD frees
 * it and the return lands in freed memory. A zero timer lets the click
 * unwind first. The closure holds no Qt wrapper, for the same reason.
 */
SectionCapture.startInteractive = function() {
    var timer = new QTimer(RMainWindowQt.getMainWindow());
    timer.singleShot = true;
    timer.timeout.connect(function() {
        var di = getDocumentInterface();
        if (isNull(di)) {
            return;
        }
        try {
            var guiAction = RGuiAction.getByScriptFile(
                SectionCapture.scriptPath);
            di.setCurrentAction(new SectionCapture(guiAction));
        } catch (e) {
            EAction.handleUserWarning(qsTr("Capture would not start (") +
                e + qsTr("). "));
        }
    });
    timer.start(0);
};

/** Where this file was installed, so getByScriptFile can find it. */
SectionCapture.scriptPath = "";

/**
 * Registers the capture action WITHOUT a menu entry, a toolbar entry or
 * a command name.
 *
 * It needs to be a registered RGuiAction all the same: the interactive
 * class is an EAction, and an EAction wants the RGuiAction that owns
 * its script file. Leaving out setWidgetNames and setDefaultCommands is
 * what keeps it off the menu and out of the command line, which is the
 * whole point of the merge -- reachable only from the bay panel, which
 * is only on screen while there is a bay to capture.
 *
 * Called by CrossSection.init, not by the add-on's own sibling sweep:
 * this file no longer belongs to a tool of its own.
 */
SectionCapture.init = function(basePath) {
    SectionCapture.scriptPath = basePath + "/SectionCapture.js";
    var action = new RGuiAction(qsTr("Capture Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(SectionCapture.scriptPath);
};
