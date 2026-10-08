// ScatterBreakdown.js
//
// QCAD add-on tool: fill closed BREAKDOWN-BOUNDARY polylines with
// randomly placed, rotated and scaled breakdown symbols.
//
// WHAT CHANGED FROM THE OLD GENERATION: scattering is PER BOUNDARY.
// Every placed block is tagged with the id of the boundary that owns
// it, and re-running clears and refills only the boundaries it
// processes -- several independent breakdown zones no longer destroy
// each other. One undo step.
//
// TASK 12, 2026-09-11 (Nathan): "Breakdown is just one area pattern
// among thirteen." The placement maths moved to Core/CsArea.js --
// CsArea.CATALOG.BLOCKS is this tool's own numbers (density 16,
// scale 0.7-1.5, the SYM_BREAKDOWN trio), copied there so the panel's
// Blocks tile and this menu command draw identically. THIS FILE KEEPS
// EVERYTHING ELSE: its own menu entry, its own command names
// ("scatterbreakdown"/"scb"), its own "BoundaryId" tagging (not
// CsArea's "AreaOwner" -- a boundary this tool scatters is not made
// into an area; see AreaSync.adopt for the tool that does that), and
// its own clear-and-refill/one-undo-step behaviour. A transplant, not
// a redesign -- this file's own tests (tests/scatter_breakdown_run.js)
// are the proof nothing else moved.
//
// THE SEED. CsArea.placements needs one, and this tool never had one
// before -- every re-run reshuffled the pile. Rolled once per boundary
// and stored under CsArea.SEED_KEY (the same key CsArea.regenerate and
// AreaSync.adopt read), so a boundary this tool has already scattered
// keeps filling the same way on every later re-run rather than
// reshuffling, and an old boundary adopted into an area by AreaSync
// keeps the exact look it already had -- same seed, same catalog entry,
// same verts, same placements.
//
// WORKFLOW:
//   1. Draw a closed polyline on BREAKDOWN-BOUNDARY around the area.
//   2. Run this tool (select specific boundaries first to do only
//      those; no selection = all closed boundaries on the layer).
//   3. Adjust the boundary and re-run any time.
//
// Uses the SYM_BREAKDOWN / _B / _C blocks from the NSS template.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

// ---- tunables --------------------------------------------------------

// The views this tool draws in. One button set serves all three: the
// zone's LOCATION picks the view (CsProfileBox.frameAt), and
// CsLayers.twinFor turns the plan layer into that view's twin. Nothing
// here is a second button or a second layer to remember.
var SB_FRAMES = ["plan", "profile", "section"];

// closed polylines often store the closing vertex explicitly
function sbCleanRing(verts) {
    if (verts.length > 1) {
        var first = verts[0], last = verts[verts.length - 1];
        var dx = first.x - last.x, dy = first.y - last.y;
        if (Math.sqrt(dx * dx + dy * dy) < 1e-6) {
            return verts.slice(0, verts.length - 1);
        }
    }
    return verts;
}

/**
 * A point inside-ish the ring, for asking WHICH VIEW this zone is in.
 *
 * The average of the vertices, not the area centroid: a concave ring
 * can put either one outside itself, and the question here is not
 * "where exactly" but "which band box, if any, is this zone sitting
 * in" -- boxes are whole elevation bands and a breakdown zone is small
 * against one. A zone straddling the edge of a box is a drawing to fix,
 * not a case to model.
 */
function sbRingCentre(verts) {
    var sx = 0, sy = 0;
    for (var i = 0; i < verts.length; i++) {
        sx += verts[i].x;
        sy += verts[i].y;
    }
    return new RVector(sx / verts.length, sy / verts.length);
}

/** " (2 in the elevation)" and the like -- named only when a zone
 *  landed somewhere other than the plan, so the ordinary plan-only run
 *  reads exactly as it did before. */
function sbFramesPhrase(used) {
    var words = { profile: "in the elevation", section: "in a cross section" };
    var parts = [];
    for (var key in words) {
        if (words.hasOwnProperty(key) && used[key] > 0) {
            parts.push(used[key] + " " + words[key]);
        }
    }
    if (parts.length === 0) {
        return "";
    }
    return " (" + parts.join(", ") + ")";
}

// ---- main --------------------------------------------------------------

function scatterBreakdownRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn("Scatter Breakdown: no active drawing document.");
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Scatter Breakdown")) {
        return;
    }
    var di = getDocumentInterface();

    // The boundary can be drawn on the plan layer or on either frame
    // twin -- whichever the caver happened to have current. Which one
    // it is does NOT decide the view: location does, below. Accepting
    // all three is only about FINDING the rings.
    var boundaryLayers = [CsLayers.BREAKDOWN_BOUNDARY];
    var fr, twin;
    for (fr = 0; fr < SB_FRAMES.length; fr++) {
        twin = CsLayers.twinFor(CsLayers.BREAKDOWN_BOUNDARY, SB_FRAMES[fr]);
        if (twin !== null && boundaryLayers.indexOf(twin) < 0) {
            boundaryLayers.push(twin);
        }
    }
    var boundaryLayerIds = {};
    var anyBoundaryLayer = false;
    for (fr = 0; fr < boundaryLayers.length; fr++) {
        if (doc.hasLayer(boundaryLayers[fr])) {
            boundaryLayerIds[String(doc.getLayerId(boundaryLayers[fr]))] = true;
            anyBoundaryLayer = true;
        }
    }
    if (!anyBoundaryLayer) {
        CsTell.warn("Scatter Breakdown: draw a closed polyline on the " +
            CsLayers.BREAKDOWN_BOUNDARY + " layer around the breakdown " +
            "area first.");
        return;
    }

    // One target layer per view. They are ensured up front rather than
    // per boundary so that clearing a previous scatter can look at all
    // three, whichever view the zone has since been moved into.
    var targetLayers = {};
    var targetLayerIds = {};
    for (fr = 0; fr < SB_FRAMES.length; fr++) {
        twin = CsLayers.twinFor(CsLayers.BREAKDOWN, SB_FRAMES[fr]);
        if (twin === null) {
            continue;
        }
        CsLayers.ensure(doc, di, twin);
        targetLayers[SB_FRAMES[fr]] = twin;
        targetLayerIds[String(doc.getLayerId(twin))] = true;
    }

    // Both walk every entity, so they are read ONCE here and handed to
    // every frameAt call -- the contract CsProfileBox.frameAt states.
    var sbRegion = CsTrace.profileRegion(doc);
    var sbBays = CsTrace.sectionBays(doc);

    // Selected boundaries only, if any are selected; else every closed
    // boundary on the layer.
    var selectedIds = doc.hasSelection() ? doc.querySelectedEntities() : [];
    var candidateIds = selectedIds.length > 0 ?
        selectedIds : doc.queryAllEntities(false, false, RS.EntityPolyline);

    var boundaries = [];
    for (var i = 0; i < candidateIds.length; i++) {
        var e = doc.queryEntity(candidateIds[i]);
        if (isNull(e) ||
                boundaryLayerIds[String(e.getLayerId())] !== true) {
            continue;
        }
        if (typeof e.isGeometricallyClosed !== "function" ||
            !e.isGeometricallyClosed()) {
            continue;
        }
        boundaries.push(e);
    }

    if (boundaries.length === 0) {
        CsTell.warn("Scatter Breakdown: no closed polylines found on " +
            CsLayers.BREAKDOWN_BOUNDARY +
            (selectedIds.length > 0 ? " in the selection." : "."));
        return;
    }

    // ONE transaction group for everything this run writes -- the
    // block adds/deletes below AND the seed tag a first-time boundary
    // gets stamped with (see the seed comment at the top of this file).
    // Two operations sharing a group still land as ONE undo, the same
    // idiom CsArea.regenerate and ShapedLines.dressOne already use.
    var group = doc.getTransactionGroup() + 1;

    var op = new RAddObjectsOperation();
    op.setText("Scatter breakdown");

    // Collect the boundary ids being redone, then clear only THEIR
    // previous blocks (tagged CaveSurvey/BoundaryId).
    var redoIds = {};
    for (i = 0; i < boundaries.length; i++) {
        redoIds[String(boundaries[i].getId())] = true;
    }
    var refIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    var removed = 0;
    for (i = 0; i < refIds.length; i++) {
        var ref = doc.queryEntity(refIds[i]);
        if (isNull(ref) ||
                targetLayerIds[String(ref.getLayerId())] !== true) {
            continue;
        }
        var owner = CsTags.get(ref, "BoundaryId");
        // untagged blocks (old generation) are treated as owned by
        // whichever boundary contains them, so re-running cleans up
        // legacy scatters too
        if (owner === "") {
            var pos = ref.getPosition();
            for (var b = 0; b < boundaries.length; b++) {
                var ring = sbCleanRing(boundaries[b].getData().getVertices());
                if (CsArea.pointInPolygon(pos.x, pos.y, ring)) {
                    owner = String(boundaries[b].getId());
                    break;
                }
            }
        }
        if (redoIds[owner] === true) {
            op.deleteObject(ref);
            removed++;
        }
    }

    var totalPlaced = 0;
    var missingBlocks = false;
    var framesUsed = {};
    // Boundaries stamped with a FRESH seed this run -- flushed in one
    // RModifyObjectsOperation after the loop, grouped with `op` above
    // so the seed write and the placed boulders land as one undo.
    var seedWrites = [];

    for (b = 0; b < boundaries.length; b++) {
        var poly = boundaries[b];
        var verts = sbCleanRing(poly.getData().getVertices());
        if (verts.length < 3) {
            continue;
        }

        // WHICH VIEW is this zone in? By where it lands, not by the
        // layer it was drawn on -- a boundary on layer 0 inside an
        // elevation band is an ordinary thing to have drawn, and its
        // layer name proves nothing. Same evidence Shaped Lines uses
        // for a stroke: an open section bay first, then the band
        // boxes, then the derived region.
        var frame = CsProfileBox.frameAt(doc, sbRegion, sbRingCentre(verts),
            sbBays);
        var placeLayer = targetLayers[frame];
        if (placeLayer === undefined) {
            // A frame with no breakdown twin (should not happen for
            // BREAKDOWN, which twins into both) -- draw in the plan
            // rather than silently dropping the zone.
            placeLayer = CsLayers.BREAKDOWN;
        }
        var placeLayerId = doc.getLayerId(placeLayer);

        // THE SEED -- read back off the boundary if this tool (or
        // AreaSync.adopt) already stamped one there; rolled fresh only
        // the first time. See this file's header: never re-rolled once
        // present, so a re-run's pile looks the same as the last one.
        var seed = parseFloat(CsTags.get(poly, CsArea.SEED_KEY));
        if (isNaN(seed)) {
            seed = CsArea.newSeed();
            CsTags.set(poly, CsArea.SEED_KEY, String(seed));
            seedWrites.push(poly);
        }

        // THE PLACEMENT MATHS -- CsArea.CATALOG.BLOCKS holds the exact
        // numbers this tool used to carry itself (density 16, scale
        // 0.7-1.5, the SYM_BREAKDOWN trio); scale/density multipliers of
        // 1.0 reproduce this tool's own historical look unchanged.
        var places = CsArea.placements(verts, CsArea.CATALOG.BLOCKS, seed,
            1.0, 1.0);

        for (var p = 0; p < places.length; p++) {
            var entry = CsSymbols.byBlock(places[p].block);
            var blockRef = CsSymbols.insert(doc, entry,
                new RVector(places[p].x, places[p].y), places[p].scale,
                places[p].angle);
            if (blockRef === null) {
                missingBlocks = true;
                continue;
            }
            // CsSymbols.insert puts a symbol on its CATALOG layer,
            // which is the plan one. The catalog is right about which
            // FAMILY the symbol belongs to; only the view is decided
            // here, so the layer is retargeted rather than the catalog
            // being taught about frames.
            blockRef.setLayerId(placeLayerId);
            framesUsed[frame] = (framesUsed[frame] || 0) + 1;
            CsTags.set(blockRef, "BoundaryId", String(poly.getId()));
            op.addObject(blockRef, false);
            totalPlaced++;
        }
    }

    op.setTransactionGroup(group);
    di.applyOperation(op);

    if (seedWrites.length > 0) {
        var seedMod = new RModifyObjectsOperation();
        for (var sw = 0; sw < seedWrites.length; sw++) {
            seedMod.addObject(seedWrites[sw], false);
        }
        seedMod.setTransactionGroup(group);
        di.applyOperation(seedMod);
    }

    var msg = "Scatter Breakdown: " + boundaries.length + " boundar" +
        (boundaries.length === 1 ? "y" : "ies") + ", " + totalPlaced +
        " boulders placed" +
        sbFramesPhrase(framesUsed) +
        (removed > 0 ? " (" + removed + " previous cleared from those boundaries only)" : "") +
        ". Other breakdown zones were not touched.";
    if (missingBlocks) {
        msg += " NOTE: the SYM_BREAKDOWN blocks are missing from this " +
            "drawing -- start from the NSS template to get them.";
    }
    EAction.handleUserMessage(msg);
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function ScatterBreakdown(guiAction) {
    EAction.call(this, guiAction);
}

ScatterBreakdown.prototype = new EAction();

ScatterBreakdown.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    scatterBreakdownRun();
    this.terminate();
};

ScatterBreakdown.init = function(basePath) {
    var action = new RGuiAction(qsTr("Scatter Breakdown"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/ScatterBreakdown.js");
    action.setIcon(basePath + "/ScatterBreakdown.svg");
    action.setStatusTip(qsTr("Fill closed BREAKDOWN-BOUNDARY polylines with breakdown symbols, one zone at a time -- in the plan, an elevation band or a section, by where the zone is"));
    action.setDefaultCommands(["scatterbreakdown", "scb"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(30);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
