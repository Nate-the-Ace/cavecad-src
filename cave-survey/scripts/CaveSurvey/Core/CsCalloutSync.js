/**
 * CsCalloutSync -- put every callout's arrows back on its text.
 *
 * Three jobs, in the order they run.
 *
 * REFLOW. A callout's leaders are solved against the text's bounding box
 * at the moment they are drawn. Move or reword the text with QCAD's own
 * tools and the arrows stay where they were, still correctly attached to
 * a box that has gone. This command re-solves them. CalloutListener does
 * the same thing automatically; this stays the repair path for a drawing
 * edited where the listener never loaded -- an older build, or a file
 * that came from someone else.
 *
 * RE-KEY DUPLICATES. A CalloutId is a UUID, so two callouts created
 * independently can never collide. But copying a callout WITHIN one
 * drawing carries its XDATA, so the copy holds the SAME id -- no id
 * scheme can prevent that. Two texts then claim one id and members()
 * returns whichever it met last, so a reflow moves the wrong arrows.
 * This is the only place that can repair it, because repair needs
 * geometry: each leader goes to whichever of the tied texts it is
 * actually nearest.
 *
 * REPORT WHAT IT COULD NOT DO. LOCKED and FROZEN layers refuse writes
 * SILENTLY in this build and CsLayers.withLayerOn covers OFF only, so a
 * callout on a locked layer cannot be repaired. Saying so is the whole
 * point -- a stale leader on a plotted map is the failure this tool
 * exists to prevent, and one that is silently skipped is worse than one
 * that was never attempted.
 *
 * Was the whole of the Callout Sync menu entry; lifted into Core so
 * CsRepair can run it as the last of three passes (see CsRepair.js for
 * why it has to run last -- a restyle can move a note's layer out from
 * under its arrows). RepairDrawing/RepairDrawing.js is now the only
 * presenter over CsCalloutSync.run.
 *
 * Needs Callout/CalloutWrite.js, which is outside Core -- included
 * directly below rather than through CsAll.js, since Core files never
 * reach outside Core and CalloutWrite is the one thing this engine
 * cannot do its job without.
 */
include(includeBasePath + "/../Callout/CalloutWrite.js");

var CsCalloutSync = {};

/** Distance from a leader's LANDING vertex to a text box's centre. Used
 *  only to break a duplicated id apart, so nearest-wins is enough. */
CsCalloutSync.leaderDistanceTo = function(leaderEntity, box) {
    var d = leaderEntity.getData();
    var n = d.countVertices();
    if (n === 0) {
        return Number.MAX_VALUE;
    }
    var last = d.getVertexAt(n - 1);
    var cx = (box.x1 + box.x2) / 2.0;
    var cy = (box.y1 + box.y2) / 2.0;
    return Math.sqrt((last.x - cx) * (last.x - cx) +
                     (last.y - cy) * (last.y - cy));
};

/**
 * Every text entity carrying each CalloutId: {id: [entity, ...]}.
 * More than one entry for an id means a copied callout.
 */
CsCalloutSync.textsById = function(doc) {
    var out = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsCallout.KEY.ROLE) !== CsCallout.ROLE_TEXT) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid === "") {
            continue;
        }
        if (!out.hasOwnProperty(cid)) {
            out[cid] = [];
        }
        out[cid].push(e);
    }
    return out;
};

/**
 * Give every text after the first a fresh id, taking with it the leaders
 * that are nearest to it. Returns the number of callouts re-keyed.
 *
 * The OLDEST text keeps the original id -- oldest by entity id, which
 * is handed out in increasing order, so it is the one that existed
 * before the paste. A callout that was never copied is never touched,
 * and the original keeps the identity anything else may already
 * reference. Sorting is not optional: queryAllEntities is not
 * insertion-ordered, so without it which of the pair keeps the id
 * varies from run to run.
 */
CsCalloutSync.rekeyDuplicates = function(doc, di) {
    var byId = CsCalloutSync.textsById(doc);
    var rekeyed = 0;

    for (var id in byId) {
        if (!byId.hasOwnProperty(id) || byId[id].length < 2) {
            continue;
        }
        // OLDEST FIRST, by entity id. queryAllEntities is NOT
        // insertion-ordered, so without this sort "the first text" is
        // whichever the query happened to hand back -- and then WHICH of
        // a pasted pair keeps the original id is arbitrary from one run
        // to the next. Entity ids are handed out in increasing order, so
        // the lowest belongs to the callout that existed first: the
        // ORIGINAL keeps its id and the paste is the one re-keyed, which
        // is what anything already referencing that id expects.
        var texts = byId[id].slice(0);
        texts.sort(function(a, b) {
            var ia = 0, ib = 0;
            try { ia = a.getId(); } catch (ea) { ia = 0; }
            try { ib = b.getId(); } catch (eb) { ib = 0; }
            return ia - ib;
        });

        var boxes = [];
        var t;
        for (t = 0; t < texts.length; t++) {
            boxes.push(CalloutWrite.boxOf(texts[t]));
        }

        var leaders = CalloutWrite.members(doc, id).leaders;

        // Assign each leader to the nearest text, then re-key every text
        // except the first along with the leaders that chose it.
        for (t = 1; t < texts.length; t++) {
            var fresh = CsCallout.newId();
            var op = new RModifyObjectsOperation();

            CsTags.set(texts[t], CsCallout.KEY.ID, fresh);
            op.addObject(texts[t], false);

            for (var l = 0; l < leaders.length; l++) {
                var best = 0;
                var bestD = CsCalloutSync.leaderDistanceTo(leaders[l], boxes[0]);
                for (var b = 1; b < boxes.length; b++) {
                    var dd = CsCalloutSync.leaderDistanceTo(leaders[l], boxes[b]);
                    if (dd < bestD) {
                        bestD = dd;
                        best = b;
                    }
                }
                if (best === t) {
                    CsTags.set(leaders[l], CsCallout.KEY.ID, fresh);
                    op.addObject(leaders[l], false);
                }
            }

            di.applyOperation(op);
            rekeyed++;
        }
    }
    return rekeyed;
};

/**
 * Why this layer cannot be written to, or null when it can.
 *
 * CsLayers.refusesEdits deliberately EXCLUDES locked -- its docblock
 * says why: off and frozen are visibility, which a writer may reveal for
 * the length of its own write, whereas "a lock is something the surveyor
 * did on purpose". So a locked layer has to be tested separately, and
 * the wording follows FeatureTraceRun.refusalReason (the existing
 * precedent) rather than inventing a second vocabulary for the same
 * situation.
 */
CsCalloutSync.refusalFor = function(doc, layerName) {
    var lay = null;
    try {
        lay = doc.queryLayer(layerName);
    } catch (e) {
        lay = null;
    }
    if (isNull(lay)) {
        return "layer " + layerName + " could not be found";
    }
    var locked = false;
    try {
        locked = lay.isLocked();
    } catch (e1) {
        locked = false;
    }
    if (locked) {
        return "layer " + layerName + " is LOCKED -- unlock it in the " +
            "Layer List";
    }
    if (CsLayers.refusesEdits(lay)) {
        return "layer " + layerName + " refuses edits (off or frozen)";
    }
    return null;
};

/** Selected callout ids, or every id when nothing is selected. */
CsCalloutSync.targetIds = function(doc) {
    var selected = doc.querySelectedEntities();
    if (selected.length === 0) {
        return CalloutWrite.existingIds(doc);
    }
    var seen = {};
    var out = [];
    for (var i = 0; i < selected.length; i++) {
        var e = doc.queryEntity(selected[i]);
        if (isNull(e)) {
            continue;
        }
        var cid = CsTags.get(e, CsCallout.KEY.ID);
        if (cid !== "" && !seen.hasOwnProperty(cid)) {
            seen[cid] = true;
            out.push(cid);
        }
    }
    return out;
};

/**
 * Reflow the selected callouts, or every callout when nothing is
 * selected. Returns a human-readable multi-line report.
 */
CsCalloutSync.run = function(doc, di) {
    // Repair identity BEFORE reflowing: reflowing a duplicated id moves
    // the wrong arrows, so doing it in the other order would first make
    // the drawing worse.
    var rekeyed = CsCalloutSync.rekeyDuplicates(doc, di);

    var ids = CsCalloutSync.targetIds(doc);
    var done = 0;
    var unchanged = 0;
    var refused = [];
    var orphans = 0;

    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var m = CalloutWrite.members(doc, id);

        if (m.text === null) {
            // Leaders with no text. NOT deleted here: throwing away a
            // caver's geometry is not a "sync", and the listener already
            // handles the live deletion case.
            orphans += m.leaders.length;
            continue;
        }
        if (m.leaders.length === 0) {
            unchanged++;
            continue;
        }

        var style = CsTags.get(m.text, CsCallout.KEY.STYLE) ||
            CsCallout.STYLE_DEFAULT;
        var layerName = CsCallout.STYLES[style] ||
            CsCallout.STYLES[CsCallout.STYLE_DEFAULT];
        var why = CsCalloutSync.refusalFor(doc, layerName);
        if (why !== null) {
            refused.push(id + " (" + why + ")");
            continue;
        }

        var wanted = m.leaders.length;

        // ONE BAD CALLOUT MUST NOT ABORT THE SYNC. writeLeaders throws
        // when its write does not land, which is right for a single
        // deliberate placement but wrong here: this command's job is to
        // repair a whole drawing, and a drawing with one unfixable
        // callout still has all the others to fix. Catch it, name it,
        // keep going.
        try {
            CalloutWrite.applyReflow(doc, di, id, null);
        } catch (e) {
            refused.push(id + " (" + e + ")");
            continue;
        }

        var got = CalloutWrite.members(doc, id).leaders.length;
        if (got !== wanted) {
            // applyOperation reports nothing useful, so count instead of
            // trusting it.
            refused.push(id + " (wrote " + got + " of " + wanted +
                " leaders)");
        } else {
            done++;
        }
    }

    // Re-derive elevation labels as well. A draw does this too, but a
    // caver who has just corrected a reading and wants the labels to
    // catch up should not have to redraw the whole map to get it.
    // The from-document entry point: it reads the WHOLE drawing's survey,
    // which is the only complete picture. Never the argument-taking
    // variant here.
    var elev = CalloutWrite.refreshElevationsFromDocument(doc, di);

    var lines = [];
    lines.push(qsTr("Reflowed %1 callout(s).").arg(done));
    if (elev !== null) {
        if (elev.upgraded > 0) {
            lines.push(qsTr("%1 elevation label(s) UPGRADED from a " +
                "survey-line stand-in to a measured floor.")
                .arg(elev.upgraded));
        }
        if (elev.downgraded > 0) {
            lines.push(qsTr("%1 elevation label(s) fell back to the " +
                "survey line -- their floor reading is gone.")
                .arg(elev.downgraded));
        }
        if (elev.updated > 0) {
            lines.push(qsTr("%1 elevation label(s) re-derived.")
                .arg(elev.updated));
        }
        if (elev.lost > 0) {
            lines.push(qsTr("%1 elevation label(s) could NOT be " +
                "re-derived -- the leg they were sampled on is gone. " +
                "They are left as they are; check them by hand.")
                .arg(elev.lost));
        }
    }
    if (rekeyed > 0) {
        lines.push(qsTr("Re-keyed %1 copied callout(s) that shared an id " +
            "with another.").arg(rekeyed));
    }
    if (unchanged > 0) {
        lines.push(qsTr("%1 had no arrows and were left alone.")
            .arg(unchanged));
    }
    if (orphans > 0) {
        lines.push(qsTr("%1 arrow(s) have no note and were left in place.")
            .arg(orphans));
    }
    if (refused.length > 0) {
        lines.push("");
        lines.push(qsTr("Could not update:"));
        for (var r = 0; r < refused.length; r++) {
            lines.push("  " + refused[r]);
        }
    }
    return lines.join("\n");
};
