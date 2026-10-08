// LoopErrors.js
//
// QCAD add-on tool: draw the loop closure error onto the map, at the
// stations where it actually happened.
//
//   Cave Survey > Loop Errors   (or type "le")
//
// WHY. Survey Stats prints "closes at 2.4%" and the Notebook flags the
// shots behind it. A beginner reads that as a grade they passed or
// failed. It is neither: it says that walking the loop and coming back
// landed you 2.4% of the way you walked from where you started, and
// that the adjustment has since moved every station in that loop to
// share the difference out. WHICH stations moved, by how much, and
// which way is the entire story -- and it is invisible, because the
// stations are drawn where the adjustment put them and nothing on the
// map says they were ever anywhere else.
//
// So this draws an arrow at each station that moved, coloured by how
// far, with the loops labelled and a caption stating the exaggeration.
// See Core/CsClosure.js for why the exaggeration has to be stated.
//
// EVERYTHING LANDS ON CTRL-CLOSURE, which is off by default and which
// the caption tells you to switch off before plotting. This is a
// diagnostic drawn over a map, never map ink.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

/** The tag every generated mark carries, so a re-run replaces what the
 *  last one drew instead of drawing a second set over it. */
var LE_TAG = "ClosureMark";

/** How small a shift is not worth an arrow, in feet. On a big cave
 *  every station moves a little; three hundred arrows a millimetre long
 *  hide the six that matter. */
var LE_MIN_FEET = 0.02;

function LoopErrors(guiAction) {
    EAction.call(this, guiAction);
}

LoopErrors.prototype = new EAction();

/**
 * The survey, resolved BOTH ways: as the drawing has it, and with the
 * adjustment forced on so there is a shift to draw even when the
 * drawing itself is unadjusted.
 *
 * \return { survey, raw, adjusted, wasAdjusted } or null
 */
LoopErrors.read = function(doc) {
    var recon = CsRevise.surveyFromDocument(doc);
    if (isNull(recon) || isNull(recon.survey) ||
            recon.survey.shots.length === 0) {
        return null;
    }
    var resolveOpts = {};
    if (recon.anchorName !== "" && !isNull(recon.anchorPos)) {
        resolveOpts.anchor = { name: recon.anchorName,
            x: recon.anchorPos.x, y: recon.anchorPos.y, z: recon.anchorZ };
    }
    var drawnOpts = CsAdjust.optionsFromTags(recon.adjustTags);
    var raw = CsNetwork.resolve(recon.survey, resolveOpts);
    // FORCED ON, whatever the drawing recorded. An unadjusted drawing
    // has no shifts at all, and "there is no error to show" is exactly
    // the wrong thing to tell someone whose survey does not close --
    // the arrows just mean something different, which the caption says.
    var forced = { enabled: true, sigmaTape: drawnOpts.sigmaTape,
        sigmaAngle: drawnOpts.sigmaAngle, tapeMode: CsTraverse.SLOPE };
    var adjusted = CsAdjust.adjust(recon.survey, raw, forced);
    return {
        survey: recon.survey,
        raw: raw,
        adjusted: adjusted,
        wasAdjusted: drawnOpts.enabled !== false
    };
};

/** The cave's longest side in feet, for choosing the exaggeration. */
LoopErrors.sizeOf = function(stations, perFoot) {
    var minX = null, maxX = null, minY = null, maxY = null;
    for (var name in stations) {
        if (!stations.hasOwnProperty(name)) {
            continue;
        }
        var s = stations[name];
        if (minX === null || s.x < minX) { minX = s.x; }
        if (maxX === null || s.x > maxX) { maxX = s.x; }
        if (minY === null || s.y < minY) { minY = s.y; }
        if (maxY === null || s.y > maxY) { maxY = s.y; }
    }
    if (minX === null) {
        return 0;
    }
    return Math.max(maxX - minX, maxY - minY) / perFoot;
};

/**
 * Draws the marks. Separated from the command so the geometry is
 * testable without a GUI -- tests/loop_errors_run.js calls in here.
 *
 * \return the sentence the caver is told.
 */
LoopErrors.draw = function(doc, di, read) {
    var perFoot = CsShapeLine.perFoot(doc);
    // The positions the DRAWING holds: adjusted when the drawing is
    // adjusted, raw when it is not. Anchoring an arrow anywhere else
    // puts it a whole shift away from the station it describes.
    var stations = read.wasAdjusted ? read.adjusted.stations :
        read.raw.stations;
    var shifts = read.adjusted.shifts;
    var summary = read.adjusted.summary;
    var worstFeet = (isNull(summary) ? 0 : summary.worstShift) / perFoot;
    var size = LoopErrors.sizeOf(stations, perFoot);
    var factor = CsClosure.factorFor(worstFeet, size);
    var arrows = CsClosure.arrowsFor(shifts, stations, factor, perFoot,
        LE_MIN_FEET, read.wasAdjusted);

    CsLayers.ensure(doc, di, CsLayers.CTRL_CLOSURE);
    var layerId = doc.getLayerId(CsLayers.CTRL_CLOSURE);

    // The layer is OFF by default and a caver who ran this tool wants
    // to SEE it. Switched on here, and the caption says to switch it
    // back off before plotting.
    var wasOff = false;
    try {
        var layer = doc.queryLayer(CsLayers.CTRL_CLOSURE);
        if (!isNull(layer) && CsLayers.refusesEdits(layer)) {
            wasOff = true;
            var lop = new RModifyObjectsOperation();
            layer.setFrozen(false);
            layer.setOff(false);
            lop.addObject(layer);
            di.applyOperation(lop);
        }
    } catch (eLayer) {
        // a layer that will not switch on still gets its marks; the
        // caver can switch it on by hand and the report says so
    }

    var op = new RAddObjectsOperation();
    op.setText("Loop errors");

    var cleared = 0;
    var allIds = doc.queryAllEntities(false, false);
    for (var c = 0; c < allIds.length; c++) {
        var old = doc.queryEntity(allIds[c]);
        if (!isNull(old) && CsTags.get(old, LE_TAG) !== "") {
            op.deleteObject(old);
            cleared++;
        }
    }

    var keep = function(entity, colour, what) {
        entity.setLayerId(layerId);
        if (!isNull(colour)) {
            // Per-entity colour: the BAND is the message, and a layer
            // can only carry one colour. This is the same deliberate
            // exception Build Legend makes -- these entities are a
            // picture of a measurement, not members of a layer.
            entity.setColor(new RColor(colour));
        }
        CsTags.set(entity, LE_TAG, what);
        op.addObject(entity, false);
        return entity;
    };
    var lineOf = function(a, b, colour, what) {
        return keep(new RLineEntity(doc, new RLineData(
            new RVector(a.x, a.y), new RVector(b.x, b.y))), colour, what);
    };
    var textAt = function(x, y, height, label, colour, what) {
        return keep(new RTextEntity(doc, new RTextData(
            new RVector(x, y), new RVector(x, y), height, 0,
            RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
            1.0, CsDraw.caps(label), "standard", false, false, 0.0,
            false)), colour, what);
    };

    var textHeight = Math.max(size * 0.012, 0.4) * perFoot;
    var barb = textHeight * 1.2;

    for (var a = 0; a < arrows.length; a++) {
        var arrow = arrows[a];
        lineOf(arrow.tail, arrow.head, arrow.band.colour, arrow.station);
        var barbs = CsClosure.headBarbs(arrow.tail, arrow.head, barb);
        for (var bx = 0; bx < barbs.length; bx++) {
            lineOf(barbs[bx], arrow.head, arrow.band.colour, arrow.station);
        }
    }

    // The loops themselves, labelled where their closing leg lands.
    var loops = isNull(read.raw.loops) ? [] : read.raw.loops;
    for (var l = 0; l < loops.length; l++) {
        var loop = loops[l];
        var at = stations[loop.to];
        if (isNull(at)) {
            continue;
        }
        // Stacked by index as well as placed at the station: two loops
        // closing near each other put their labels on top of one
        // another, which was the first thing seen on Truitt Cave (two
        // rings, both closing at 2.4%, one line printed over the
        // other).
        textAt(at.x + barb, at.y + barb + l * textHeight * 1.9,
            textHeight, CsClosure.loopLabel(loop), null, "loop");
    }

    // The caption. Placed below EVERYTHING the drawing holds, at the
    // left, where it cannot be mistaken for a note about one passage.
    //
    // Below the whole drawing, not just below the stations: the
    // extended elevation is drawn beneath the plan, so a caption placed
    // under the lowest STATION lands in the middle of the profile bands
    // -- which is where it landed on Truitt Cave.
    var capX = null, capY = null;
    for (var n in stations) {
        if (!stations.hasOwnProperty(n)) {
            continue;
        }
        if (capX === null || stations[n].x < capX) { capX = stations[n].x; }
    }
    try {
        var whole = doc.getBoundingBox();
        var lowest = whole.getMinimum();
        if (isFinite(lowest.y)) {
            capY = lowest.y;
        }
        if (capX === null && isFinite(lowest.x)) {
            capX = lowest.x;
        }
    } catch (eBox) {
        capY = null;
    }
    if (capY === null) {
        for (n in stations) {
            if (!stations.hasOwnProperty(n)) {
                continue;
            }
            if (capY === null || stations[n].y < capY) {
                capY = stations[n].y;
            }
        }
    }
    if (capX !== null) {
        var lines = CsClosure.caption(factor, worstFeet,
            isNull(summary) ? "" : summary.worstStation, loops.length);
        lines.splice(1, 0, CsClosure.tenseFor(read.wasAdjusted));
        var cy = capY - textHeight * 4;
        for (var t = 0; t < lines.length; t++) {
            textAt(capX, cy, textHeight, lines[t], null, "caption");
            cy -= textHeight * 1.8;
        }
    }

    di.applyOperation(op);

    if (arrows.length === 0) {
        return "Loop Errors: nothing moved by more than " + LE_MIN_FEET +
            " ft -- this survey has no loop worth drawing, which is " +
            "the good answer.";
    }
    return "Loop Errors: " + arrows.length + " station" +
        (arrows.length === 1 ? "" : "s") + " marked, worst " +
        worstFeet.toFixed(2) + " ft, arrows exaggerated " + factor +
        "x, on " + CsLayers.CTRL_CLOSURE +
        (wasOff ? " (switched on for you)" : "") +
        (cleared > 0 ? " -- the previous marks were replaced" : "") +
        ". Switch that layer off before plotting.";
}

function loopErrorsRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn(qsTr("Loop Errors: no active drawing document."));
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Loop Errors")) {
        return;
    }
    var read = LoopErrors.read(doc);
    if (read === null) {
        CsTell.warn(qsTr("Loop Errors: no tagged survey stations found.\n" +
            "Import a survey or type one into the Survey Notebook " +
            "first -- there is no closure without a loop."));
        return;
    }
    if (isNull(read.raw.loops) || read.raw.loops.length === 0) {
        CsTell.warn(qsTr("Loop Errors: this survey has no loops.\n" +
            "Nothing closes back on itself, so there is no closure " +
            "error to show. That is not a fault -- most caves start " +
            "this way -- but it does mean nothing in the survey is " +
            "checking anything else."));
        return;
    }
    EAction.handleUserMessage(
        LoopErrors.draw(doc, getDocumentInterface(), read));
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

LoopErrors.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    loopErrorsRun();
    this.terminate();
};

LoopErrors.init = function(basePath) {
    var action = new RGuiAction(qsTr("Loop Errors"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LoopErrors.js");
    action.setIcon(basePath + "/LoopErrors.svg");
    action.setStatusTip(qsTr("Draw the loop closure error where it " +
        "happened: an arrow at every station the adjustment moved"));
    action.setDefaultCommands(["looperrors", "le"]);
    // Stage 2, after the survey has been got into the drawing: this is
    // a question about the DATA, and the answer usually sends a caver
    // back to the Notebook rather than on to the drawing tools.
    action.setGroupSortOrder(451);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
