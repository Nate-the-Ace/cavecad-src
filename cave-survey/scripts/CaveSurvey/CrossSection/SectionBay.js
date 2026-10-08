/**
 * SectionBay -- open a staging bay to trace a scanned cross section in.
 *
 * ONE OF THREE ROUTES CrossSection.js OFFERS ("cut", "trace", "reopen"),
 * this is "trace". It used to be its own menu entry, "Sketch Section"
 * (`sketchsection`/`sks`) -- but a student met it, "Capture Section"
 * and "Edit Sketch" as four separate commands before they had drawn a
 * single section, with no way to tell from the menu that three of them
 * are one workflow. The menu now asks once, up front, in CrossSection's
 * own route dialog; this file supplies the "trace" branch and nothing
 * about how it opens a bay has changed.
 *
 * The bay is a locked rectangle on CTRL-SECTION-BOX parked clear of the
 * plan, holding two things: the scan, and the COMPUTED section for the
 * same station, dashed, at the scale the finished block will be drawn
 * at. The caver scales the scan onto that outline and traces with the
 * suite's own tools.
 *
 * WHY THE GHOST. A scan has no scale and no up. The station's own LRUD
 * has both, and it is already in the drawing. One dashed outline is the
 * ruler, the protractor and a visible check of the tracing against what
 * was measured -- and it is deleted at Capture, so it never reaches the
 * block.
 *
 * WHAT THIS TOOL DOES NOT DO. It does not draw. Everything inside the
 * frame is drawn by the caver with Feature Trace, Shaped Lines, arcs --
 * whatever the passage needs. SectionCapture turns that into a block.
 *
 * WHILE A BAY IS OPEN, SectionBayPanel is the way out: CrossSection.js
 * shows it the moment SectionBay.run succeeds, with Capture and Cancel
 * -- the two things that used to be commands (`skc`/`ske`) a beginner
 * had no reason to know existed. See SectionBayPanel.js.
 *
 * NO MORE init(), AND NO MORE CIRCULAR INCLUDE TO DODGE. This file, and
 * SectionCapture.js and SectionEdit.js beside it, used to each register
 * their own RGuiAction and needed a careful deferred include() dance to
 * avoid including each other back into a stack overflow (AddOn.getAddOns
 * only ever finds <dir>/<dir>.js on its own, so a sibling with its own
 * menu entry had to be include()d and init()d by hand -- the ShapedLines
 * precedent). None of the three has a menu entry of its own any more:
 * CrossSection.js is the one file the menu discovers, it is never
 * included BACK by anything it includes, and it includes this file,
 * SectionCapture.js and SectionEdit.js at its own top level in that
 * order -- a plain dependency chain, not a cycle.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function SectionBay(guiAction) {
    EAction.call(this, guiAction);
}

/** The setting holding where the caver last left a bay, per cave. */
SectionBay.SETTING_CORNER = "CaveSurvey/SectionBayCorner";

/** Tags carried by the bay's own furniture, so Capture can tell the
 *  frame and the underlay from the tracing without guessing. */
SectionBay.TAG_BAY = "SectionBay";
SectionBay.ROLE_FRAME = "frame";
SectionBay.ROLE_GHOST = "ghost";
SectionBay.ROLE_SCAN = "scan";

/** The snap class the caver was using before the bay switched to free,
 *  so SectionCapture's teardown can put it back. Carried on the FRAME,
 *  the one piece of bay furniture guaranteed to exist for the bay's
 *  whole lifetime -- see SectionBay.currentSnapClassName, where
 *  SectionBay.run reads it, and SectionCapture.restoreSnap, where
 *  it is rebuilt. */
SectionBay.TAG_SNAP = "SectionBaySnap";

/** The station an open bay is cut at, parked on the FRAME. Read back by
 *  SectionCapture.findBay, and by SectionBay.sectionedStations so a bay
 *  left open counts as a station already spoken for. */
SectionBay.TAG_STATION = "SectionBayStation";

/** The placed reference's own scale and rotation, parked on the FRAME
 *  while its bay is open.
 *
 *  A reopen DELETES the block reference (the section must exist in
 *  exactly one place at a time), and with it the only record of the
 *  scale and rotation the caver gave it -- CalloutWrite.refreshSections'
 *  contract is that position, scale and rotation are the caver's, and a
 *  re-capture that rebuilt the reference at (1,1) and 0 silently reset
 *  both on every edit. The frame is where they wait: it is the one piece
 *  of bay furniture guaranteed to exist for the bay's whole lifetime,
 *  which is exactly why TAG_SNAP already lives there.
 *
 *  Written by SectionEdit.explodeInto, read by SectionCapture.findBay.
 *  ABSENT means the defaults -- a bay opened by Sketch Section rather
 *  than reopened by Edit Sketch has no earlier reference to carry. */
SectionBay.TAG_REF_SCALE = "SectionBayRefScale";
SectionBay.TAG_REF_ROT = "SectionBayRefRot";

/** One "Sketch Section: ..." message, however this build can show it. */
SectionBay.say = function(text) {
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Sketch Section"), text);
    } catch (e) {
        EAction.handleUserWarning(text);
    }
};

/**
 * Open a bay.
 *
 * \param scanPath absolute path to the scan, or null to ask
 * \param station station name, or null to ask
 * \param calibration {unitsPerPixel} from Sketch Scans' preview-pane
 *        calibration, or null for the auto-fit this tool has always
 *        done. OPTIONAL on purpose: a caver who skips or cancels the
 *        calibration must still get a bay, because scaling the scan by
 *        hand onto the ghost is a workflow that already works.
 * \param scanSize {w, h} in drawing units for a scan the CALLER will
 *        place itself, or null. Only SectionEdit uses it: it reopens a
 *        bay with no path (it has a stored fit to honour, which this
 *        function knows nothing about) and the frame still has to be
 *        big enough for what it is about to put in there.
 * \return the bay id, or null
 */
SectionBay.run = function(scanPath, station, calibration, scanSize) {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        return null;
    }

    var name = station;
    if (name === null || name === undefined || name === "") {
        name = SectionBay.askStation(doc);
        if (name === null) {
            return null;                 // cancelled, silently
        }
    }

    var asDrawn = null;
    try {
        asDrawn = CsRevise.resolveAsDrawn(doc);
    } catch (eRes) {
        asDrawn = null;
    }

    var refusal = SectionBay.cutAt(asDrawn, name);
    var cut = (refusal !== null && refusal.refused === true) ? null : refusal;
    if (cut !== null) {
        refusal = null;
    }
    var scale = CsSectionDraw.scaleOf();
    // THE +/-5 STAND-IN IS A FLOOR, NOT A SIZE. With no ghost there is
    // nothing to auto-fit the scan to either, so the box still has to
    // be some size for that -- but it stops deciding how big the bay
    // is: baySizeFor takes the scan's real extent as well, and a
    // scanned page is hundreds of units wide where this box is ten.
    var ghostBox = (cut === null) ? { x1: -5, y1: -5, x2: 5, y2: 5 } :
        CsSectionDraw.localBox(cut, scale, CsSectionDraw.textHeight(doc));

    // MEASURE THE SCAN BEFORE THE FRAME IS SIZED. The frame used to be
    // sized from the ghost alone and the scan placed into it
    // afterwards, at whatever scale the scan wanted -- so a calibrated
    // field-book page opened many times the bay it was supposed to sit
    // inside. That is not only untidy: Capture sweeps what is INSIDE
    // the frame, so a caver tracing over the overflow lost the work
    // silently. The scan's placed extent is knowable here (pixels
    // times units-per-pixel), so it is known here.
    var scan = SectionBay.scanPlan(scanPath, ghostBox, calibration);
    var rect = CsSectionBay.frameRectFor(
        SectionBay.planBoxOf(doc),
        CsSectionBay.baySizeFor(ghostBox,
            (scan === null) ? scanSize : scan),
        SectionBay.rememberedCorner(doc));

    var bayId = CsUuid.v4();

    // Read the CURRENT snap's class BEFORE anything below switches it to
    // free -- di.getSnap() after the switch would just read back "free".
    // Tagged onto the frame in the SAME add below, so SectionCapture's
    // teardown can rebuild and restore it later without ever holding the
    // snap object itself across the bay's lifetime (di.setSnap() takes
    // ownership -- see SectionCapture.restoreSnap).
    var priorSnapClass = SectionBay.currentSnapClassName(di);

    // Every layer this bay writes to must exist before doc.getLayerId
    // is asked for it, or the entity lands on layer 0 with no error at
    // all. CsLayers.ensure() is a no-op once the template already has
    // the layer, so calling it every time costs nothing.
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_BOX);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_GHOST);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_SCAN);

    SectionBay.addFrame(doc, di, rect, bayId, name, priorSnapClass);
    if (cut !== null) {
        SectionBay.addGhost(doc, di, cut, scale, rect, bayId);
    }
    if (scan !== null) {
        SectionBay.addScan(doc, di, scan, ghostBox, rect, bayId);
    }

    SectionBay.zoomTo(di, rect);
    SectionBay.snapFree(di);

    if (cut === null) {
        // The cut's own reason where there is one -- it names the
        // station the caver picked and says what is short about it,
        // which "no cuttable LRUD" alone does not.
        SectionBay.say(qsTr("No cuttable LRUD at %1, so the bay has " +
            "no outline to scale the scan against.").arg(name) +
            (refusal === null ? "" : "\n\n" + refusal.reason + ".") +
            qsTr("\n\nScale the scan by hand: draw a line of a known " +
                "length inside the frame and match the scan to it."));
    }
    return bayId;
};

/**
 * The section the drawing would compute at this station.
 *
 * \return the cut, or CsSectionCut.cut's own {refused, reason} so the
 *         caller can SAY why there is no ghost, or null when there is
 *         no survey or no leg to cut on at all. A refusal that reached
 *         the caller as a bare null used to be reported as "no cuttable
 *         LRUD" and nothing else, which is true of a station with three
 *         wall points and a first-in-chain neighbour and useless to the
 *         caver looking at it.
 */
SectionBay.cutAt = function(asDrawn, station) {
    if (asDrawn === null || isNull(asDrawn.resolved)) {
        return null;
    }
    var pos = asDrawn.resolved.stations[station];
    if (pos === undefined) {
        return null;
    }
    var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
        { x: pos.x, y: pos.y });
    if (leg === null) {
        return null;
    }
    return CsSectionCut.cut(asDrawn.survey, asDrawn.resolved,
        leg.from, leg.to, leg.t, {});
};

/**
 * The station's own measured LRUD, or null.
 *
 * THE SAME SOURCE THE GHOST IS CUT FROM -- CsRevise.resolveAsDrawn,
 * exactly as SectionBay.run resolves it for cutAt. Sketch Scans'
 * calibration is measured against the ghost's own numbers, so reading
 * the LRUD from anywhere else (the notebook file, a cached survey)
 * would let the scale be calibrated against a survey the ghost was not
 * drawn from -- and the disagreement would show up as a scan that is
 * subtly the wrong size, with nothing on screen to say why.
 *
 * Lives here rather than in the panel so the panel does not have to
 * know how a drawing becomes a survey.
 *
 * \return {left, right, up, down, azimuth} or null. Never throws: a
 *         drawing that cannot be resolved has no calibration to offer,
 *         which is a fallback, not a failure.
 */
SectionBay.lrudAt = function(doc, station) {
    if (isNull(doc) || station === null || station === undefined ||
            station === "") {
        return null;
    }
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (asDrawn === null || isNull(asDrawn.survey)) {
            return null;
        }
        return CsModel.lrudForStation(asDrawn.survey, String(station));
    } catch (e) {
        return null;
    }
};

/** The plan's own extent, or null when the drawing is empty. */
SectionBay.planBoxOf = function(doc) {
    try {
        var b = doc.getBoundingBox(true, true);
        if (isNull(b)) {
            return null;
        }
        return { x1: b.getMinimum().x, y1: b.getMinimum().y,
                 x2: b.getMaximum().x, y2: b.getMaximum().y };
    } catch (e) {
        return null;
    }
};

/** Where this cave's bay was last left, or null. */
SectionBay.rememberedCorner = function(doc) {
    try {
        var raw = RSettings.getStringValue(
            SectionBay.SETTING_CORNER, "");
        if (raw === "") {
            return null;
        }
        var all = JSON.parse(raw);
        var key = String(doc.getFileName());
        if (all[key] === undefined) {
            return null;
        }
        return { x: all[key].x, y: all[key].y };
    } catch (e) {
        return null;
    }
};

/** The frame: a closed polyline, tagged, and LOCKED so a rubber-band
 *  selection over the tracing cannot drag the boundary the sweep is
 *  measured against. Also carries the snap class the caver was using
 *  before the bay switched to free, so SectionCapture can put it back
 *  at teardown -- the frame is the one bit of furniture guaranteed to
 *  outlive the whole bay. */
SectionBay.addFrame = function(doc, di, rect, bayId, station,
        priorSnapClass) {
    var pl = new RPolyline();
    pl.appendVertex(new RVector(rect.x1, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y1));
    pl.appendVertex(new RVector(rect.x2, rect.y2));
    pl.appendVertex(new RVector(rect.x1, rect.y2));
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_BOX));
    // Tag BEFORE adding, so the tags land in the SAME operation as the
    // geometry.
    CsTags.set(e, SectionBay.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SectionBay.ROLE_FRAME);
    CsTags.set(e, SectionBay.TAG_STATION, station);
    // CsTags.set no-ops on null/undefined/"" by design (see CsTags.js),
    // so a snap this build could not name just leaves the tag absent --
    // SectionCapture.restoreSnap already treats an absent tag as "leave
    // the snap alone" rather than guessing.
    CsTags.set(e, SectionBay.TAG_SNAP, priorSnapClass);
    var op = new RAddObjectsOperation();
    op.setText("Open section bay");
    op.addObject(e, false);
    // CTRL-SECTION-BOX ships LOCKED (CsLayers.LOCKED) -- a caver's own
    // protection against dragging the frame the sweep is measured
    // against -- and locked refuses adds exactly as silently as off
    // does. withLayerOn alone only clears OFF/FROZEN; the lock needs
    // withLayerUnlocked, the counterpart CsProfileDraw's own box layer
    // uses for the identical reason.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX, function() {
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_SECTION_BOX,
            function() {
                di.applyOperation(op);
            });
    });
};

/** The ghost: the computed outline, dashed, centred in the bay.
 *
 * ON ITS OWN LAYER, CTRL-SECTION-GHOST, NOT CTRL-SECTION-OUTLINE.
 * CTRL-SECTION-OUTLINE is where CsSectionDraw.define draws the REAL,
 * FINAL computed outline once a section is placed -- solid, meant to
 * stay in the drawing. This ghost is scratch: a reference to scale and
 * check a tracing against, gone the moment SectionCapture tears the bay
 * down. Sharing a layer with the real thing made a ghost that had not
 * been captured yet render pixel-identical to a finished section, so it
 * gets its own DASHED layer instead -- see CsLayers.DEFAULTS. */
SectionBay.addGhost = function(doc, di, cut, scale, rect, bayId) {
    var pts = CsSectionDraw.localPoints(cut, scale);
    if (pts.length < 3) {
        return;
    }
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var pl = new RPolyline();
    for (var i = 0; i < pts.length; i++) {
        pl.appendVertex(new RVector(cx + pts[i].x, cy + pts[i].y));
    }
    pl.setClosed(true);
    var e = new RPolylineEntity(doc, new RPolylineData(pl));
    e.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_GHOST));
    CsTags.set(e, SectionBay.TAG_BAY, bayId);
    CsTags.set(e, "SectionBayRole", SectionBay.ROLE_GHOST);
    var op = new RAddObjectsOperation();
    op.setText("Draw section ghost");
    op.addObject(e, false);
    // OFF layers refuse adds SILENTLY in this build -- CTRL-SECTION-
    // GHOST ships visible, but a caver may since have switched it off,
    // and the bay must not open with a missing ghost and nothing to
    // say why.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_GHOST,
        function() {
            di.applyOperation(op);
        });
};

/**
 * How big the scan will be once it is placed, read BEFORE the bay is
 * drawn.
 *
 * THE ORDER IS THE FIX. Nothing here is new work -- the image was
 * always opened and its pixels always multiplied by a scale -- it is
 * only that it used to happen after the frame had already been sized
 * from the ghost, so the frame could not take the scan into account and
 * did not. Sized first, and the same numbers are then handed to
 * addScan, so the frame and the placement are one decision.
 *
 * The two "this scan is unusable" messages live here rather than in
 * addScan for the same reason: by the time addScan runs the frame has
 * been drawn to fit a scan, and the caver has to be told before that,
 * not after.
 *
 * \return {path, pxW, pxH, k, w, h} in drawing units, or null when
 *         there is no scan (which is a supported way to open a bay).
 */
SectionBay.scanPlan = function(path, ghostBox, calibration) {
    if (path === null || path === undefined || path === "") {
        return null;
    }
    var img = new QImage(path);
    if (img.isNull()) {
        SectionBay.say(qsTr("The scan could not be read: ") + path);
        return null;
    }
    // width()/height() are METHODS on this build's QImage, not
    // properties -- probed 2026-08-29 (js.width returns "function").
    // Reading them as properties would hand the fit maths a function
    // object instead of a pixel count and produce a NaN transform with
    // no error.
    var pxW = img.width(), pxH = img.height();
    if (pxW < 1 || pxH < 1) {
        SectionBay.say(qsTr("The scan has no size: ") + path);
        return null;
    }
    var placed = CsSectionBay.placedScanSize(pxW, pxH, ghostBox,
        calibration);
    return { path: path, pxW: pxW, pxH: pxH, k: placed.k,
             w: placed.w, h: placed.h };
};

/**
 * The scan, scaled onto the ghost, faded, at the back.
 *
 * AT THE CALIBRATED SCALE WHEN THERE IS ONE. Without a calibration the
 * scan is auto-fitted to the ghost's WIDTH, which is a guess that is
 * wrong by whatever the sketch's own margins happen to be -- fine as a
 * starting point, and the reason the caver then rescales by hand. A
 * calibration from Sketch Scans' preview pane (two clicks against one
 * known LRUD) is a measurement instead, so it is used as given and the
 * scan opens already the right size.
 *
 * CENTRED EITHER WAY. Calibration answers "how big", never "where":
 * inferring a position from the station click as well would put the
 * scan somewhere that depends on where in the outline the caver
 * happened to click first, and a scan that opens off-centre in its own
 * bay reads as a fault.
 *
 * \param scan a SectionBay.scanPlan result -- the pixels and the
 *        scale the FRAME was already sized from.
 */
SectionBay.addScan = function(doc, di, scan, ghostBox, rect, bayId) {
    var path = scan.path;
    var pxW = scan.pxW, pxH = scan.pxH;
    var cx = (rect.x1 + rect.x2) / 2;
    var cy = (rect.y1 + rect.y2) / 2;
    var scanBox = { x1: 0, y1: 0, x2: pxW, y2: pxH };
    var ghostHere = { x1: cx + ghostBox.x1, y1: cy + ghostBox.y1,
                      x2: cx + ghostBox.x2, y2: cy + ghostBox.y2 };
    // THE SCALE COMES FROM THE PLAN, always -- the same number the
    // frame was sized from a few lines earlier in run(). Deciding it
    // twice, once for the frame and once here, is exactly how a frame
    // and the thing it is supposed to contain get to disagree.
    var fit = CsSectionBay.fitAtScale(scanBox, ghostHere, scan.k);
    var entity = SectionBay.imageEntity(doc, path, fit, pxW, pxH);
    if (entity === null) {
        return;
    }
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
    CsTags.set(entity, SectionBay.TAG_BAY, bayId);
    CsTags.set(entity, "SectionBayRole", SectionBay.ROLE_SCAN);
    CsTags.set(entity, CsCallout.KEY.SECTION_SCAN, path);
    // NO SectionBayFit TAG HERE, deliberately. This function's auto-fit
    // is true for exactly as long as it takes the caver to grab the
    // scan -- and scaling and rotating the scan onto the ghost IS the
    // workflow, so it is stale within seconds and stays stale forever
    // (nothing updates it as the caver drags). SectionCapture used to
    // copy this tag onto the finished section, which is how a caver's
    // own fitting came back thrown away on the next Edit Sketch. Capture
    // now reads the scan ENTITY's live insertion point and u/v vectors
    // instead (SectionCapture.fitOfScan), so the only fit ever recorded
    // is the one the caver actually left the scan at. A tag here would
    // be a second, wrong answer waiting to be picked up again.
    //
    // A CALIBRATED SCALE CHANGES NONE OF THAT. It is a better starting
    // point, not a final answer -- the caver still nudges and may still
    // turn the scan -- so the SectionBayFit that SectionEdit reads back
    // on reopen must still be measured off the entity at capture time,
    // not written here from the calibration. It reaches the tag because
    // it reaches the ENTITY.
    // To the back, under whatever the caver traces over it -- the same
    // underlay treatment every scan in this suite gets (SketchScans.
    // insert), one below getMinDrawOrder() because this entity is not
    // in storage yet.
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);
    var op = new RAddObjectsOperation();
    op.setText("Underlay section scan");
    op.addObject(entity, false);
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN,
        function() {
            di.applyOperation(op);
        });
};

/**
 * A faded RImageEntity for `path`, placed at `fit`, or null.
 *
 * SHARED with SectionEdit.reopenScan, which places the very same scan
 * back into a reopened bay -- one construction, so the two cannot drift
 * into placing an image two different ways.
 *
 * RImageData BY CONSTRUCTOR, not by setFileName/setInsertionPoint/
 * setUVector/setVVector. Probed 2026-08-29: those setters exist and do
 * not throw, but every WORKING image insert in this suite
 * (SketchScans.insert, SketchScans.insertFitted, ScanView.js,
 * Core/CsSurfaceData.js's basemap pass) builds RImageData through the
 * seven-argument constructor and never through setters -- so the
 * constructor form is what is trusted to actually place a readable
 * image, and this follows it rather than a shape that merely accepts
 * calls.
 *
 * THE FIT'S u AND v GO IN WHOLE. They are the image's own per-pixel
 * edge vectors, which is what this constructor's third and fourth
 * arguments are; rebuilding them as (sx, 0) and (0, sy) from a
 * decomposed scale -- what this used to do -- silently drops any
 * rotation the caver put on the scan.
 */
SectionBay.imageEntity = function(doc, path, fit, pxW, pxH) {
    try {
        var data = new RImageData(path,
            new RVector(fit.tx, fit.ty),
            new RVector(fit.ux, fit.uy),
            new RVector(fit.vx, fit.vy),
            pxW, pxH, 0);
        try {
            data.setFade(50);
        } catch (eFade) {
            // an engine without setFade gets a full-strength scan
        }
        return new RImageEntity(doc, data);
    } catch (e) {
        SectionBay.say(qsTr("The scan could not be placed: ") + e);
        return null;
    }
};

/**
 * This cave's scans/ folder as it exists on disk, or null.
 *
 * The folder as it is CASED on disk when there is one (real cave
 * folders in the wild carry "Scans" as often as "scans"), falling back
 * to the conventional spelling so a stored relative path still resolves
 * on a machine where the folder has not synced down yet. Read-only:
 * this never creates anything.
 */
SectionBay.scansFolderOf = function(doc) {
    try {
        var docPath = String(doc.getFileName());
        var folder = CsCave.folderOf(docPath);
        if (folder === null) {
            return null;
        }
        var found = CsCave.findSubfolder(folder, CsCave.SCANS);
        return (found !== null) ? found : CsCave.scansDir(docPath);
    } catch (e) {
        return null;
    }
};

/** Zoom the view to the bay, so the caver is looking at it. */
SectionBay.zoomTo = function(di, rect) {
    try {
        var box = new RBox(new RVector(rect.x1, rect.y1),
                           new RVector(rect.x2, rect.y2));
        di.zoomTo(box, 20);
    } catch (e) {
        // a build that cannot zoom still opened the bay
    }
};

/**
 * Snapping goes FREE while a bay is open.
 *
 * Grid snap quantises every freehand sample onto the grid: the wall
 * comes out a staircase and the collapsed samples get discarded by
 * curve reduction. Set through di, NOT by triggering the snap action --
 * triggering from inside an action lifecycle event frees the action
 * still running and takes the process with it.
 *
 * NOT restored here. This action terminates the instant the bay is
 * open (see beginEvent), so undoing the switch on its own finish would
 * take the free snap away before the caver has drawn a single point.
 * The snap comes back at TEARDOWN instead -- SectionCapture.capture --
 * from the class name SectionBay.run already read via
 * currentSnapClassName and tagged onto the frame, before this function
 * ran.
 */
SectionBay.snapFree = function(di) {
    try {
        di.setSnap(new RSnapFree());
    } catch (e) {
        // no snap change is survivable; a crash is not
    }
};

/** The current snap's class name -- "RSnapGrid", not "RSnapGrid [JS]" --
 *  or null when it cannot be read. Probed 2026-08-30: di.getSnap()
 *  String()s as "<ClassName> [JS]"; the base "RSnap" (no concrete snap
 *  ever set) and anything unreadable both come back null rather than a
 *  name nothing can rebuild. */
SectionBay.currentSnapClassName = function(di) {
    try {
        var s = String(di.getSnap());
        var i = s.indexOf(" ");
        var name = (i < 0) ? s : s.substring(0, i);
        return (name === "" || name === "RSnap") ? null : name;
    } catch (e) {
        return null;
    }
};

/**
 * Stations that already carry a section: the captured blocks' own
 * station tags, plus any bay standing open right now.
 *
 * READ OFF THE DRAWING rather than remembered in a setting -- see
 * CsSectionBay.suggestStation for why. Returns plain names, in no
 * particular order; suggestStation orders them against the walk.
 */
SectionBay.sectionedStations = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var seen = {};
    var keys = [CsCallout.KEY.SECTION_STATION, SectionBay.TAG_STATION];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        for (var k = 0; k < keys.length; k++) {
            var name = CsTags.get(e, keys[k]);
            if (name !== "" && seen[name] !== true) {
                seen[name] = true;
                out.push(String(name));
            }
        }
    }
    return out;
};

/** Ask which station this section is cut at. Plan stations, in walk
 *  order -- the order the survey visited them, not name order, so a
 *  branch reads the way the notebook does, and PRESELECTED at the
 *  station after the last one already sectioned, so sketching a run of
 *  sections walks forward on its own. */
SectionBay.askStation = function(doc) {
    var stations = CsTags.collectStations(doc);
    if (stations.length === 0) {
        SectionBay.say(qsTr("This drawing has no plotted stations to " +
            "hang a section on."));
        return null;
    }
    var names = [];
    var i;
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        var order = CsStationOrder.walkOrder(asDrawn.survey);
        var plotted = {};
        for (i = 0; i < stations.length; i++) {
            plotted[stations[i].name] = true;
        }
        for (i = 0; i < order.length; i++) {
            if (plotted[order[i]] === true) {
                names.push(order[i]);
            }
        }
    } catch (e) {
        names = [];
    }
    if (names.length === 0) {
        for (i = 0; i < stations.length; i++) {
            names.push(stations[i].name);
        }
    }
    // A DIALOG INSTANCE, NOT QInputDialog.getItem. SketchScans.js's own
    // takePick already found this the hard way: the static convenience
    // function's C++ signature reports Cancel through an `ok`
    // OUT-PARAMETER that this binding drops, so Cancel returned the
    // selected item exactly as OK did -- Cancel simply did not work. An
    // instance carries the answer in its own result: exec() returns
    // QDialog.Accepted only when the caver pressed OK.
    var chosen = null;
    try {
        var dlg = new QInputDialog(RMainWindowQt.getMainWindow());
        dlg.windowTitle = qsTr("Sketch Section");
        dlg.setLabelText(qsTr("Station this section is cut at:"));
        dlg.setComboBoxEditable(false);
        dlg.setComboBoxItems(names);
        // PRESELECT THE NEXT ONE ALONG. Guarded on its own: a build
        // whose QInputDialog does not take a text value must still ask
        // the question, just without the head start.
        try {
            var suggested = CsSectionBay.suggestStation(names,
                SectionBay.sectionedStations(doc));
            if (suggested !== null) {
                dlg.setTextValue(suggested);
            }
        } catch (eSuggest) {
        }
        if (dlg.exec() !== QDialog.Accepted) {
            return null;                 // cancelled: nothing chosen
        }
        chosen = dlg.textValue();
    } catch (eDlg) {
        chosen = null;
    }
    if (chosen === null || chosen === undefined || chosen === "") {
        return null;
    }
    return String(chosen);
};

/**
 * Cancel an open bay: remove the frame, the ghost and the scan, in one
 * transaction, and leave whatever the caver traced exactly where it is.
 *
 * BESIDE addFrame/addGhost/addScan ON PURPOSE -- this is the only other
 * place that deletes the three things they create, so creation and
 * removal read together. SectionCapture.capture has its OWN teardown of
 * the same furniture, folded into the larger transaction that also
 * mints the block; this is the "never mind" path, with no block and no
 * leader, for SectionBayPanel's Cancel button.
 *
 * THE SNAP COMES BACK, exactly as a capture's teardown restores it --
 * SectionCapture.restoreSnap, called here too rather than copied, so
 * the two teardowns cannot drift into rebuilding the snap two different
 * ways. Guarded by typeof: this file loads before SectionCapture.js in
 * CrossSection.js's own include order, but a defensive caller (a future
 * test, a future panel) that includes SectionBay.js alone should not
 * crash for want of a sibling it never asked for.
 *
 * \param bay a SectionCapture.findBay result
 */
SectionBay.cancel = function(doc, di, bay) {
    if (isNull(doc) || isNull(di) || bay === null || bay === undefined) {
        return;
    }
    var snapClass = (bay.frame !== null && !isNull(bay.frame)) ?
        CsTags.get(bay.frame, SectionBay.TAG_SNAP) : "";
    var op = new RAddObjectsOperation();
    op.setText("Cancel section bay");
    if (bay.frame !== null) { op.deleteObject(bay.frame); }
    if (bay.ghost !== null) { op.deleteObject(bay.ghost); }
    if (bay.scan !== null) { op.deleteObject(bay.scan); }
    // OFF/FROZEN layers refuse a delete SILENTLY, same trap as every
    // other teardown in this feature -- CTRL-SECTION-BOX additionally
    // ships LOCKED, so it alone needs withLayerUnlocked nested inside.
    CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_GHOST, function() {
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_SCAN, function() {
            CsLayers.withLayerOn(doc, di, CsLayers.CTRL_SECTION_BOX,
                function() {
                    CsLayers.withLayerUnlocked(doc, di,
                        CsLayers.CTRL_SECTION_BOX, function() {
                            di.applyOperation(op);
                        });
                });
        });
    });
    if (typeof SectionCapture !== "undefined" &&
            typeof SectionCapture.restoreSnap === "function") {
        SectionCapture.restoreSnap(di, snapClass);
    }
};
