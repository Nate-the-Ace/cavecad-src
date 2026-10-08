// AreaSync.js -- Sync Areas: regenerate every area pattern by hand, and
// give every already-drawn Scatter Breakdown boundary a place in the
// same engine.
//
// THE MANUAL FALLBACK for everything AreaFillListener normally does
// live -- a drawing edited elsewhere, headless work, or a listener that
// never installed (see AreaFillListener.install()'s own "headless: no
// window to listen to" guard, which is exactly this tool's own test
// environment). The ShapedSync/CsShapeLine.reconcile precedent, applied
// to areas instead of shaped lines.
//
// TASK 12, 2026-09-11 (Nathan): "Breakdown is just one area pattern
// among thirteen... old BREAKDOWN-BOUNDARY polylines are adopted as
// areas on first run." Sync Areas is that first run: every legacy
// boundary Scatter Breakdown ever drew, with no AreaId yet, becomes a
// real Blocks area here -- tagged, seeded, filled -- so the same one
// engine (Core/CsArea.js) owns every boulder pile in the suite, old and
// new.
//
// A STANDALONE FOLDER, not a sibling file inside AreaFill/ the way
// ShapedSync sits inside ShapedLines/. AddOn.getAddOns only ever finds
// <Dir>/<Dir>.js, so this file has to be exactly that to be discovered
// at all; AreaFill.js already has its own job (the panel) and does not
// include this one. The business logic this file calls
// (CsArea.regenerate, CsArea.sweep) lives in Core, never here -- the
// same reason CsArea's own header gives: a transaction listener is a
// thin dispatcher, and Sync Areas is a second, independent dispatcher
// onto the exact same logic, not a reason to duplicate it.
//
// THE ONE PLACE A MISSING CUSTOM BLOCK IS IMPORTED -- see AreaSync.run's
// own comment at its CsArea.regenerate call.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function AreaSync(guiAction) {
    EAction.call(this, guiAction);
}

AreaSync.prototype = new EAction();

/** The frames a legacy breakdown boundary might be drawn in -- the
 *  exact set ScatterBreakdown itself already searches; see that file's
 *  own boundaryLayers for why all three (plan and either twin) have to
 *  be checked even though the VIEW a zone fills in is decided by
 *  location, never by which of these it was drawn on. */
AreaSync.FRAMES = ["plan", "profile", "section"];

/** Every layer id an old Scatter Breakdown boundary might live on, as a
 *  {layerId: true} dict, or null when none of them exist in this
 *  drawing at all -- nothing to adopt. */
AreaSync.legacyBoundaryLayerIds = function(doc) {
    var names = [CsLayers.BREAKDOWN_BOUNDARY];
    for (var f = 0; f < AreaSync.FRAMES.length; f++) {
        var twin = CsLayers.twinFor(CsLayers.BREAKDOWN_BOUNDARY,
            AreaSync.FRAMES[f]);
        if (twin !== null && names.indexOf(twin) < 0) {
            names.push(twin);
        }
    }
    var ids = {};
    var any = false;
    for (var n = 0; n < names.length; n++) {
        if (doc.hasLayer(names[n])) {
            ids[String(doc.getLayerId(names[n]))] = true;
            any = true;
        }
    }
    return any ? ids : null;
};

/**
 * Converts every closed BREAKDOWN-BOUNDARY polyline with no AreaId yet
 * into a real Blocks area: tags it, gives it a seed, and builds its
 * fill.
 *
 * IDEMPOTENT BY CONSTRUCTION: a boundary this function has already
 * tagged carries an AreaId, and the very first filter below skips
 * anything that does -- a second call finds nothing left to adopt, so
 * it neither re-tags nor re-builds a single entity. There is no
 * separate "already adopted" bookkeeping to keep in step with that
 * fact; the fact IS the bookkeeping.
 *
 * THE SAME SEED a boundary already carries (from Scatter Breakdown's
 * own stamping -- see that file's header) is kept rather than
 * re-rolled, so an adopted boundary's fill looks exactly as it did the
 * moment before adoption: same seed, same catalog entry (BLOCKS), same
 * verts, same placements. A boundary that was drawn but never
 * scattered gets a fresh seed instead, the same as a brand new area.
 *
 * THE OLD PILE Scatter Breakdown already placed for a boundary (tagged
 * "BoundaryId", never CsArea's own "AreaOwner") is replaced by
 * CsArea.build's fresh fill below, by an EXACT BoundaryId match to the
 * boundary being adopted -- nothing else in the drawing, and no other
 * boundary's pile, is ever touched by this. Because the seed carries
 * over unchanged, the replacement reproduces the exact same placements;
 * only which tag scheme owns them changes, never how the pile looks.
 *
 * `group`, when given, joins every write this function makes to the
 * caller's own transaction group -- AreaSync.run passes its own so
 * that ONE press of Sync Areas (regenerate + sweep + adopt) costs ONE
 * Ctrl+Z, not two. Omitted (a direct call, as tests/scatter_breakdown_
 * run.js's own AreaSync.adopt tests make), this rolls its own, exactly
 * as before -- adopt() run standalone is still its own undo step.
 *
 * \return how many boundaries were adopted
 */
AreaSync.adopt = function(doc, di, group) {
    var boundaryLayerIds = AreaSync.legacyBoundaryLayerIds(doc);
    if (boundaryLayerIds === null) {
        return 0;
    }

    var candidateIds = doc.queryAllEntities(false, false, RS.EntityPolyline);
    var legacy = [];
    for (var i = 0; i < candidateIds.length; i++) {
        var e = doc.queryEntity(candidateIds[i]);
        if (isNull(e) || boundaryLayerIds[String(e.getLayerId())] !== true) {
            continue;
        }
        if (typeof e.isGeometricallyClosed !== "function" ||
                !e.isGeometricallyClosed()) {
            continue;
        }
        if (CsTags.get(e, CsArea.ID_KEY) !== "") {
            continue;   // already an area -- nothing left to adopt
        }
        var verts = CsArea.vertsOf(e);
        if (verts.length < 3) {
            continue;
        }
        legacy.push({ entity: e, verts: verts });
    }
    if (legacy.length === 0) {
        return 0;
    }

    // ONE walk for every Scatter Breakdown pile these boundaries already
    // own, keyed by the boundary id it names on its "BoundaryId" tag --
    // see this function's own header on why adoption replaces it rather
    // than stacking a second, identical pile under the fresh
    // AreaOwner-tagged one.
    var oldPilesByBoundary = {};
    var refIds = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var ri = 0; ri < refIds.length; ri++) {
        var ref = doc.queryEntity(refIds[ri]);
        if (isNull(ref)) {
            continue;
        }
        var owner = CsTags.get(ref, "BoundaryId");
        if (owner === "") {
            continue;
        }
        if (isNull(oldPilesByBoundary[owner])) {
            oldPilesByBoundary[owner] = [];
        }
        oldPilesByBoundary[owner].push(ref);
    }

    if (isNull(group) || group < 0) {
        group = doc.getTransactionGroup() + 1;
    }
    var region = CsTrace.profileRegion(doc);
    var bays = CsTrace.sectionBays(doc);

    var mod = new RModifyObjectsOperation();
    for (var b = 0; b < legacy.length; b++) {
        var boundary = legacy[b].entity;
        var verts = legacy[b].verts;

        var seed = parseFloat(CsTags.get(boundary, CsArea.SEED_KEY));
        if (isNaN(seed)) {
            seed = CsArea.newSeed();
        }

        CsTags.set(boundary, CsArea.ID_KEY, CsUuid.v4());
        CsTags.set(boundary, CsArea.PATTERN_KEY, "BLOCKS");
        CsTags.set(boundary, CsArea.SEED_KEY, String(seed));
        CsTags.set(boundary, CsArea.SCALE_KEY, "1");
        CsTags.set(boundary, CsArea.DENSITY_KEY, "1");

        // A trip stamp, if one can be derived -- never a default of 0.
        // See CsTrace.tripFor's own header and the elevation-datum
        // family of bugs this suite has closed five doors on already.
        try {
            var frame = CsProfileBox.frameAt(doc, region, verts[0], bays);
            var trip = CsTrace.tripFor(doc, frame, verts, bays);
            if (!isNull(trip)) {
                CsTags.set(boundary, CsTrace.TRIP_TAG, trip);
            }
        } catch (eTrip) {
            // no trip derivable -- adoption still succeeds without one
        }

        mod.addObject(boundary, false);
    }
    mod.setTransactionGroup(group);
    di.applyOperation(mod);

    for (var r = 0; r < legacy.length; r++) {
        var adoptedBoundary = legacy[r].entity;
        try {
            // NEVER an import here -- adoption always writes the BLOCKS
            // pattern, a built-in shipped with the template, so
            // CsArea.regenerate's default (no `allowImport`) is exactly
            // right: there is nothing custom to fetch.
            CsArea.regenerate(doc, di, adoptedBoundary.getId(), group);
        } catch (eRegen) {
            // one broken boundary must not stop the rest
        }

        var old = oldPilesByBoundary[String(adoptedBoundary.getId())];
        if (!isNull(old) && old.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var od = 0; od < old.length; od++) {
                var stale = doc.queryEntityDirect(old[od].getId());
                if (!isNull(stale)) {
                    del.deleteObject(stale);
                }
            }
            del.setTransactionGroup(group);
            di.applyOperation(del);
        }
    }

    return legacy.length;
};

/**
 * Regenerates every tagged area in `doc`, sweeps fill whose boundary is
 * gone, and adopts every legacy breakdown boundary that still has none.
 *
 * \return {regenerated, unchanged, failed, swept, adopted}
 */
AreaSync.run = function(doc, di) {
    var scan = CsArea.areaScan(doc);
    var group = doc.getTransactionGroup() + 1;
    var counts = { regenerated: 0, unchanged: 0, failed: 0 };

    for (var areaId in scan.boundaries) {
        if (!scan.boundaries.hasOwnProperty(areaId)) {
            continue;
        }
        var boundary = scan.boundaries[areaId];
        try {
            // allowImport = true -- THE ONE PLACE a missing CUSTOM
            // pattern's block is fetched into this drawing on the
            // caver's behalf. CsArea.regenerate's own header explains
            // why it refuses to do this from AreaFillListener: that
            // call runs inside a live transaction callback, where
            // CsSymbolStore.ensureBlock's own applyOperation calls
            // would be reentrant in a way never proven safe there. A
            // caver pressing Sync Areas from the menu is not inside
            // that callback -- there is no reentrancy hazard here to
            // guard against, and a custom pattern saved in one drawing
            // should fill correctly the very next time this command is
            // run in another, with no "paste the block in first" step.
            var r = CsArea.regenerate(doc, di, boundary.getId(), group,
                scan.owners[areaId], true);
            if (r === "regenerated") {
                counts.regenerated++;
            } else if (r === "unchanged") {
                counts.unchanged++;
            } else {
                // "no-pattern" -- a CUSTOM pattern the caver deleted
                // from their library after drawing with it -- lands
                // here too, alongside "missing"/"no-shape" and every
                // "failed:<reason>". CsArea.regenerate leaves that
                // area's existing fill exactly as it was (it never
                // deletes what it cannot rebuild), so nothing on the
                // map changes; what changes is that Sync Areas now SAYS
                // so instead of silently dropping the area from its own
                // count. A caver who sees the tally not just say
                // "rebuilt"/"unchanged" every time can go find which
                // pattern is missing and decide whether to redraw it.
                counts.failed++;
            }
        } catch (eOne) {
            counts.failed++;
        }
    }

    var swept = CsArea.sweep(doc, di, group, scan);
    // THE SAME group as the regenerate/sweep passes above -- so a
    // single Sync Areas press that both rebuilds an area and adopts a
    // legacy boundary costs ONE Ctrl+Z, not two. adopt() rolling its
    // own group here was a real regression a review caught: two undo
    // steps for what reads to a caver as one command.
    var adopted = AreaSync.adopt(doc, di, group);

    var msg = "Sync Areas: " + counts.regenerated + " rebuilt, " +
        counts.unchanged + " unchanged";
    if (counts.failed > 0) {
        msg += ", " + counts.failed + " failed";
    }
    if (swept > 0) {
        msg += ", " + swept + " orphan fill" + (swept === 1 ? "" : "s") +
            " removed";
    }
    if (adopted > 0) {
        msg += ", " + adopted + " old breakdown boundar" +
            (adopted === 1 ? "y" : "ies") + " adopted as area" +
            (adopted === 1 ? "" : "s");
    }
    msg += ".";
    EAction.handleUserMessage(msg);

    return { regenerated: counts.regenerated, unchanged: counts.unchanged,
        failed: counts.failed, swept: swept, adopted: adopted };
};

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

AreaSync.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }

    // A SHEET IS NOT A DRAWING TO WORK IN -- see CsModelSpace's own
    // header; a sheet is rebuilt from the cave's record on every Build
    // Sheet, and anything this tool wrote would go with it, silently,
    // weeks later.
    if (CsModelSpace.blocksWhole(doc, "Sync Areas")) {
        this.terminate();
        return;
    }

    AreaSync.run(doc, di);
    this.terminate();
};

AreaSync.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sync Areas"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/AreaSync.js");
    action.setIcon(basePath + "/AreaSync.svg");
    action.setStatusTip(qsTr("Rebuild every area's fill by hand, and " +
        "adopt any old Scatter Breakdown boundary that is not an area " +
        "yet"));
    action.setDefaultCommands(["syncareas", "sya"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(35);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
