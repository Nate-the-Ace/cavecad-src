/**
 * SectionEdit -- reopen a sketched section's bay and carry on tracing.
 *
 * WHY REOPENING RATHER THAN BLOCK EDITING. The scan is the point. A
 * section traced from a field book is revised AGAINST that field book,
 * and editing the block in place would mean re-inserting and
 * re-scaling the scan by hand every time. The reference carries the
 * scan path and the fit, so the bay comes back with the scan already
 * where the caver left it -- the revision framework's rule one kind
 * over: the drawing is reconstructible from what is stored on it.
 *
 * THE SECTION EXISTS IN EXACTLY ONE PLACE AT A TIME. Reopening DELETES
 * the placed reference, its leaders and the now-empty block definition,
 * and puts the linework loose in the bay; Capture puts it back. A
 * drawing showing both at once would print both.
 *
 * MOVED, NEVER CLONED -- one kind over from SectionCapture's own probe
 * (see that file's header). Probed again 2026-08-30, this direction:
 * setBlockId()+move() on the ORIGINAL entities queried out of the block
 * survives being committed in the SAME operation as deleting the (by
 * then empty) block definition -- nothing vanishes, because nothing was
 * ever cloned. A clone()+delete-the-source here would walk straight
 * into the same trap that broke the sweep the other direction: this
 * file deletes the block definition in the very same operation that
 * empties it, which is exactly "the entity it was cloned from deleted
 * in this op or a later one."
 *
 * THE EMPTIED BLOCK DEFINITION IS DELETED, NOT LEFT BEHIND. Every
 * capture mints a fresh CalloutId (CsCallout.newId()), so a re-capture
 * after this edit never refills THIS definition -- left in place, it
 * would be dead weight, once per edit, forever. Probed 2026-08-30:
 * doc.queryBlock(id) returns a real RBlock object; RemoveBlock.js (this
 * build's own "delete a block" tool, scripts/Block/RemoveBlock/
 * RemoveBlock.js) deletes one with RDeleteObjectsOperation, but a plain
 * RAddObjectsOperation's own deleteObject() takes a block object too,
 * on the SAME operation as the content move, one undo step for the
 * whole reopen. The entities already moved out are untouched by it --
 * confirmed by the same probe, run both as two operations and as one.
 *
 * THE SCAN COMES BACK WHERE THE CAVER LEFT IT, NOT AT A FRESH GUESS.
 * SectionBay.addScan auto-fits a scan to the CURRENT ghost, but a
 * sketch's tracing never regenerates (SOURCE_SKETCH is refreshSections'
 * gate) while the survey underneath it can still drift, so "the current
 * ghost" and "the ghost this tracing was drawn against" are not always
 * the same shape. This tool never hands SectionBay.run a scan path
 * at all; it places the scan itself afterward, from the fit STORED on
 * the reference (SECTION_FIT) -- which SectionCapture read off the scan
 * entity's own u/v vectors and insertion point, so it carries the
 * scale AND the rotation the caver actually fitted, not the auto-fit
 * the bay opened at. The stored insertion point is relative to the
 * section's own origin and is re-based onto THIS bay's origin, because
 * frameRectFor parks against the CURRENT plan extents and the bay can
 * land somewhere new even when the ghost does not move.
 *
 * A FIT THAT WILL NOT PARSE STILL OPENS A USABLE BAY. A section
 * captured before the fit carried rotation stored five numbers where
 * six are now read, so CsSectionBay.parseFit returns null for it (and
 * for any corrupt tag). Null is not "no underlay" here -- the scan is
 * placed auto-fitted to the current ghost, exactly as it would be in a
 * brand-new bay, which is the fitting those older sections were being
 * restored at anyway.
 *
 * THE PLACED REFERENCE'S SCALE AND ROTATION SURVIVE THE ROUND TRIP.
 * Reopening deletes the reference, and with it the only record of what
 * the caver had scaled and turned it to; a re-capture then built a
 * fresh reference at (1,1) and 0, silently resetting both. Both are
 * parked on the bay's frame for the bay's lifetime instead
 * (SectionBay.TAG_REF_SCALE / TAG_REF_ROT) and read back by
 * SectionCapture.findBay. The tracing itself comes back into the bay
 * UNSCALED and UNTURNED, at the ghost's own 1:1, which is the only
 * scale the ghost is a ruler for -- the reference's scale and rotation
 * are a sheet-presentation choice laid back on top at capture.
 *
 * NO LONGER ITS OWN MENU ENTRY. "Edit Sketch" (`sectionedit`/`ske`) used
 * to sit on the Cave Survey menu next to tools a beginner would reach
 * for long before they had a sketched section to reopen. It is now the
 * "reopen" branch of Cross Section's own route dialog: select the
 * section, run Cross Section, choose "Reopen a section I already
 * traced" -- which calls SectionEdit.run() below, unchanged.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
include(includeBasePath + "/SectionBay.js");

function SectionEdit(guiAction) {
    EAction.call(this, guiAction);
}

SectionEdit.prototype = new EAction();

SectionEdit.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    SectionEdit.run();
    this.terminate();
};

SectionEdit.run = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return;
    }
    var ref = SectionEdit.selectedSection(doc);
    if (ref === null) {
        SectionBay.say(qsTr("Select the cross section to edit " +
            "first -- click the section itself, not its leader."));
        return;
    }
    if (CsTags.get(ref, CsCallout.KEY.SECTION_SOURCE) !==
            CsCallout.SOURCE_SKETCH) {
        SectionBay.say(qsTr("That section was computed from the " +
            "survey's own LRUD, not traced, so there is no sketch to " +
            "reopen.\n\nDraw re-derives it whenever the survey changes."));
        return;
    }

    var station = CsTags.get(ref, CsCallout.KEY.SECTION_STATION);
    var fit = CsSectionBay.parseFit(CsTags.get(ref, CsCallout.KEY.SECTION_FIT));

    // THE STORED PATH IS RELATIVE TO scans/ -- resolved HERE, against
    // this machine's own copy of the cave, which is the whole point of
    // storing it relative. A path stored absolute by a build before
    // that convention comes back unchanged (CsCave.resolveUnderScans),
    // so an already-captured section still reopens.
    var stored = CsTags.get(ref, CsCallout.KEY.SECTION_SCAN);
    var scan = CsCave.resolveUnderScans(SectionBay.scansFolderOf(doc),
        stored);

    // Checked BEFORE the bay opens, and the path is never handed to
    // SectionBay.run -- that function's own addScan would show its
    // OWN "could not be read" message for exactly this case, and this
    // tool never delegates scan placement to it at all (see the file
    // header), so a bad path only ever produces ONE message, not two.
    var scanExists = scan !== "" && (new QFile(scan)).exists();
    if (scan !== "" && !scanExists) {
        SectionBay.say(qsTr("The scan this section was traced from " +
            "is not where it was:\n\n%1\n\nThe bay is open with the " +
            "tracing and the outline; the underlay is missing.")
            .arg(scan));
    }

    // THE BAY HAS TO BE SIZED FOR THE SCAN THIS TOOL IS ABOUT TO PLACE.
    // SectionBay.run is handed no path here (this tool places the
    // scan itself, at the STORED fit, which run() knows nothing about),
    // so without this the bay would be sized from the ghost alone --
    // and a field-book page fitted at its real scale is many times the
    // ghost. A scan hanging out of its own frame is not just untidy:
    // Capture sweeps by containment, so anything traced over the
    // overflow is dropped silently at the next capture.
    var bayId = SectionBay.run(null, station, null,
        scanExists ? SectionEdit.placedSizeOf(scan, fit) : null);
    if (bayId === null) {
        return;
    }

    // A NULL FIT STILL GETS AN UNDERLAY. See the file header: an old
    // five-number fit (and any corrupt tag) parses as null, and the
    // honest answer is the auto-fit a brand-new bay would have used,
    // not a bay with the tracing and no scan under it.
    if (scanExists) {
        var box = SectionEdit.bayBoxOf(doc, bayId);
        // box === null here would mean the bay this line just opened
        // cannot be found -- nothing safe to place a scan against, and
        // explodeInto below will hit the same wall and quietly give up.
        if (box !== null) {
            SectionEdit.reopenScan(doc, di, scan, fit, box, bayId);
        }
    }

    SectionEdit.explodeInto(doc, di, ref, bayId);
};

/**
 * How much room the stored scan will take in the reopened bay, or null
 * when that cannot be known yet.
 *
 * THE ROTATED EXTENT, not width times scale. The caver may have turned
 * the scan onto the ghost, and the fit carries that rotation in its u
 * and v vectors; the space it occupies is the parallelogram's
 * axis-aligned box, which is wider than the page itself once it is at
 * an angle.
 *
 * NULL FOR A NULL FIT, deliberately: that is the auto-fit fallback
 * (an old five-number tag, or a corrupt one), which sizes the scan to
 * the ghost that does not exist yet -- so the ghost is what sizes the
 * bay, exactly as it did before there was a scan to consider.
 *
 * \return {w, h} in drawing units, or null
 */
SectionEdit.placedSizeOf = function(path, fit) {
    if (fit === null || fit === undefined) {
        return null;
    }
    var img = new QImage(path);
    if (img.isNull()) {
        return null;
    }
    // width()/height() are METHODS on this build's QImage, not
    // properties -- reading them as properties yields a function object
    // and a NaN size, which baySizeFor would then fall back on without
    // anything saying so.
    var pxW = img.width(), pxH = img.height();
    if (pxW < 1 || pxH < 1) {
        return null;
    }
    return { w: Math.abs(fit.ux * pxW) + Math.abs(fit.vx * pxH),
             h: Math.abs(fit.uy * pxW) + Math.abs(fit.vy * pxH) };
};

/** The one selected block reference that is a section, or null. */
SectionEdit.selectedSection = function(doc) {
    if (!doc.hasSelection()) {
        return null;
    }
    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION &&
                CsTags.get(e, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK) {
            return e;
        }
    }
    return null;
};

/**
 * Put the block's entities back into the bay, loose, and remove the
 * placed reference, its leaders and the now-empty block definition --
 * all in ONE operation, so reopening is one undo step. See the file
 * header for why moving (not cloning) and deleting the definition here
 * is safe.
 */
SectionEdit.explodeInto = function(doc, di, ref, bayId) {
    var blockId = ref.getData().getReferencedBlockId();
    var origin = SectionEdit.bayOriginOf(doc, bayId);
    if (origin === null) {
        return;
    }

    var calloutId = CsTags.get(ref, CsCallout.KEY.ID);
    var members = CalloutWrite.members(doc, calloutId);

    var op = new RAddObjectsOperation();
    op.setText("Reopen section sketch");

    // Every layer this single operation touches -- the tracing's own
    // (whatever the caver drew on), the reference's, and each leader's.
    // None of these are suite-LOCKED (CsLayers.LOCKED is only the two
    // CTRL-*-BOX layers, untouched here), but any of them could be OFF
    // or FROZEN by the caver's own choice, and an OFF/FROZEN layer
    // refuses an add, a modify AND a delete SILENTLY -- the rest of a
    // mixed operation still commits, which here would mean the content
    // moves out while the reference stays behind: the section would
    // exist in TWO places at once, the one thing this tool exists to
    // prevent.
    var layerNames = [];
    var msBlockId = doc.getModelSpaceBlockId();
    var ids = doc.queryBlockEntities(blockId);
    var i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // MOVED, not cloned -- see the file header.
        e.setBlockId(msBlockId);
        e.move(new RVector(origin.x, origin.y));
        op.addObject(e, false);
        layerNames.push(doc.getLayerName(e.getLayerId()));
    }

    layerNames.push(doc.getLayerName(ref.getLayerId()));
    op.deleteObject(ref);
    for (i = 0; i < members.leaders.length; i++) {
        layerNames.push(doc.getLayerName(members.leaders[i].getLayerId()));
        op.deleteObject(members.leaders[i]);
    }

    // The definition itself, now empty -- see the file header for why
    // this is deleted rather than left as dead weight, and how it was
    // confirmed safe in the SAME operation as the content move above.
    var blockObj = doc.queryBlock(blockId);
    if (!isNull(blockObj)) {
        op.deleteObject(blockObj);
    }

    // THE CAVER'S OWN SCALE AND ROTATION, PARKED ON THE FRAME before
    // the reference carrying them is deleted two statements up. Without
    // this the re-capture has nothing to read and rebuilds the
    // reference square and 1:1 -- see the file header. Queued into this
    // SAME operation, so a reopen stays one undo step.
    SectionEdit.parkPlacement(doc, bayId, ref, op);

    SectionEdit.withLayersOn(doc, di, layerNames, function() {
        // CTRL-SECTION-BOX, the frame's layer, ships LOCKED -- and a
        // locked layer refuses a modify exactly as silently as an off
        // one does, which would drop the parked placement while the
        // rest of the reopen still committed. withLayerOn alone only
        // clears off/frozen; the lock needs withLayerUnlocked nested
        // inside it, the pairing SectionBay.addFrame and
        // SectionCapture.capture already use on this same layer.
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
            CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_SECTION_BOX,
                function() {
                    di.applyOperation(op);
                });
        });
    });
};

/**
 * Write the reference's scale and rotation onto the bay's frame, queued
 * into `op`.
 *
 * ON THE FRAME because it is the one piece of bay furniture guaranteed
 * to live as long as the bay does -- the same reason TAG_SNAP is
 * already there. Written even when they are the defaults: an explicit
 * "1,1" and "0" on the drawing is a record, and the absent-tag branch
 * in SectionCapture.scaleTagOf then only has to cover bays that Sketch
 * Section opened from nothing.
 */
SectionEdit.parkPlacement = function(doc, bayId, ref, op) {
    var frame = SectionEdit.bayFrameOf(doc, bayId);
    if (frame === null) {
        return;
    }
    var sx = 1, sy = 1, rot = 0;
    try {
        var d = ref.getData();
        var sf = d.getScaleFactors();
        sx = sf.x;
        sy = sf.y;
        rot = d.getRotation();
    } catch (e) {
        return;                    // no placement to carry is not a crash
    }
    if (isNaN(sx) || isNaN(sy) || sx === 0 || sy === 0) {
        sx = 1; sy = 1;
    }
    if (isNaN(rot)) {
        rot = 0;
    }
    CsTags.set(frame, SectionBay.TAG_REF_SCALE,
        sx.toFixed(6) + "," + sy.toFixed(6));
    CsTags.set(frame, SectionBay.TAG_REF_ROT, rot.toFixed(6));
    op.addObject(frame, false);
};

/**
 * The centre the just-reopened bay's tracing hangs from: the ghost's
 * centre when there is one, the frame's (== the rect's) otherwise.
 * This is the EXACT preference SectionCapture.originOf uses -- not
 * "whichever tagged entity turns up first" (queryAllEntities is not
 * insertion-ordered, so that would be a coin flip) -- because ghost and
 * frame do not generally share a centre: SectionBay.addGhost centres
 * the GHOST SHAPE, which is rarely symmetric about the frame's own
 * middle, while the frame IS the rect. Capture and reopen must agree on
 * which one is "the origin," or a captured block's local coordinates
 * and a reopened bay's origin drift apart on every round trip.
 */
SectionEdit.bayOriginOf = function(doc, bayId) {
    var b = SectionEdit.bayBoxOf(doc, bayId);
    if (b === null) {
        return null;
    }
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
};

/** The extent bayOriginOf takes its centre from: the ghost's box when
 *  there is a ghost, the frame's otherwise. Wanted whole (not just as a
 *  centre) by reopenScan's auto-fit fallback, which has to fit a scan
 *  to the ghost the same way a brand-new bay does. */
SectionEdit.bayBoxOf = function(doc, bayId) {
    var ids = doc.queryAllEntities(false, true);
    var frame = null, ghost = null;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SectionBay.TAG_BAY) !== bayId) {
            continue;
        }
        var role = CsTags.get(e, "SectionBayRole");
        if (role === SectionBay.ROLE_FRAME) {
            frame = e;
        } else if (role === SectionBay.ROLE_GHOST) {
            ghost = e;
        }
    }
    var target = (ghost !== null) ? ghost : frame;
    if (target === null) {
        return null;
    }
    // Bounding boxes are CACHED -- this bay was built moments ago in
    // the same script, but a stale box read is exactly the trap that
    // has shipped before, so update() runs even here.
    target.update();
    var b = target.getBoundingBox();
    return { x1: b.getMinimum().x, y1: b.getMinimum().y,
             x2: b.getMaximum().x, y2: b.getMaximum().y };
};

/** The frame of an open bay, by bay id, or null. */
SectionEdit.bayFrameOf = function(doc, bayId) {
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, SectionBay.TAG_BAY) !== bayId) {
            continue;
        }
        if (CsTags.get(e, "SectionBayRole") === SectionBay.ROLE_FRAME) {
            return e;
        }
    }
    return null;
};

/**
 * Where a stored fit puts the scan in THIS bay: the caver's own u and v
 * vectors as recorded, and the recorded insertion point re-based from
 * the section's origin onto this bay's own.
 *
 * A NULL FIT AUTO-FITS instead, exactly as SectionBay.addScan does
 * for a brand-new bay -- the fallback for an old five-number tag or a
 * corrupt one. See the file header.
 *
 * \param fit a parsed fit, or null
 * \param box this bay's ghost (or frame) extent, {x1,y1,x2,y2}
 * \return a fit in THIS bay's absolute coordinates. Pure.
 */
SectionEdit.placementIn = function(fit, box, pxW, pxH) {
    if (fit === null || fit === undefined) {
        return CsSectionBay.fitTransform({ x1: 0, y1: 0, x2: pxW, y2: pxH },
            box);
    }
    return { ux: fit.ux, uy: fit.uy, vx: fit.vx, vy: fit.vy,
             tx: (box.x1 + box.x2) / 2 + fit.tx,
             ty: (box.y1 + box.y2) / 2 + fit.ty };
};

/**
 * Place the scan into a freshly opened bay at the fit STORED on the
 * reference, re-based onto THIS bay. See the file header for why the
 * fitting is taken from storage while the position is not: the fitting
 * -- scale AND rotation, carried in the u/v vectors -- is what the
 * caver's tracing was drawn against and must survive any drift in the
 * survey since; the position has to follow the bay, which can land
 * somewhere new every time (frameRectFor parks against the CURRENT plan
 * extents).
 *
 * Built through SectionBay.imageEntity, the one place in this
 * feature that constructs an RImageData -- so a reopened scan and a
 * freshly opened one cannot be placed two different ways.
 */
SectionEdit.reopenScan = function(doc, di, path, fit, box, bayId) {
    var img = new QImage(path);
    if (img.isNull()) {
        SectionBay.say(qsTr("The scan could not be read: ") + path);
        return;
    }
    var pxW = img.width(), pxH = img.height();
    if (pxW < 1 || pxH < 1) {
        SectionBay.say(qsTr("The scan has no size: ") + path);
        return;
    }
    var here = SectionEdit.placementIn(fit, box, pxW, pxH);
    var entity = SectionBay.imageEntity(doc, path, here, pxW, pxH);
    if (entity === null) {
        return;
    }
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry, and so a Capture run right after this reopen finds and
    // excludes this scan exactly as it would one SectionBay placed.
    CsTags.set(entity, SectionBay.TAG_BAY, bayId);
    CsTags.set(entity, "SectionBayRole", SectionBay.ROLE_SCAN);
    // The ABSOLUTE path, as resolved on this machine: this tag is what
    // the next Capture reads to build the scan's record, and the image
    // entity itself has to be constructible from it. Capture is where
    // it goes back to being relative to scans/.
    CsTags.set(entity, CsCallout.KEY.SECTION_SCAN, path);
    // NO SectionBayFit TAG, the same reason SectionBay.addScan no
    // longer writes one: the caver is about to move this scan, and the
    // next Capture reads the entity's live placement, never a tag.
    // To the back, under whatever the caver traces over it -- the same
    // underlay treatment every scan in this suite gets.
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    var op = new RAddObjectsOperation();
    op.setText("Underlay section scan");
    op.addObject(entity, false);
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN, function() {
        di.applyOperation(op);
    });
};

/** Nest CsLayers.withLayerOn for every distinct name in `names`, then
 *  run fn once, wrapped by all of them -- SectionCapture's own fixed
 *  three-layer nesting (CTRL-SECTION-BOX/OUTLINE/SCAN), generalised to
 *  however many layers a single reopen happens to touch, since the
 *  tracing's own layers are the caver's choice and not known in
 *  advance. */
SectionEdit.withLayersOn = function(doc, di, names, fn) {
    var seen = {};
    var unique = [];
    var i;
    for (i = 0; i < names.length; i++) {
        if (names[i] !== "" && !seen.hasOwnProperty(names[i])) {
            seen[names[i]] = true;
            unique.push(names[i]);
        }
    }
    var wrap = function(idx) {
        if (idx >= unique.length) {
            return fn();
        }
        return CsLayers.withLayerOn(doc, di, unique[idx], function() {
            return wrap(idx + 1);
        });
    };
    return wrap(0);
};

