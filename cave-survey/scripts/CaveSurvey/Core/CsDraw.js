// CsDraw.js -- the only Core module that draws.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// BUILT ON THE DIRECT ENTITY API, NOT simple.js: in the QJS bridge,
// simple.js's setCurrentLayer and post-add property writes fail
// SILENTLY -- a real survey saved to DXF came back with every mark on
// one layer and not a single tag. The working pattern (proven by
// headless round-trip): construct the entity, setLayerId and
// setCustomProperty BEFORE adding, then op.addObject(entity, false)
// -- the false is what stops the operation stamping the current
// layer over the one just set.
//
// Every drawing function here takes the document and an
// RAddObjectsOperation; the caller applies the operation, so a tool
// action stays one undo step. CsDraw.survey manages its own op.

var CsDraw = {};

CsDraw.TEXT_HEIGHT = 0.5;

/**
 * LETTERING IS UPPERCASE. Every piece of text this suite draws --
 * station labels, splay names, notes, the legend, title block values
 * -- is capitalised, the drafting convention that predates all of
 * this and that a hand-lettered cave map has always followed.
 *
 * It happens where the entity is MADE, never to the data behind it:
 * the note you typed stays as you typed it in the notebook and in
 * XDATA, and only the drawn text is capitalised. Nothing is lost, so
 * nothing has to be undone if the convention ever changes.
 *
 * The character after a backslash keeps its case: MText formatting
 * codes are case-sensitive (\P breaks a paragraph, \p sets paragraph
 * properties), so blind uppercasing would rewrite one into the other.
 */
CsDraw.caps = function(text) {
    if (text === undefined || text === null) {
        return "";
    }
    var s = String(text);
    var out = "";
    for (var i = 0; i < s.length; i++) {
        if (s.charAt(i) === "\\" && i + 1 < s.length) {
            out += s.charAt(i) + s.charAt(i + 1);   // escape code, verbatim
            i++;
            continue;
        }
        out += s.charAt(i).toUpperCase();
    }
    return out;
};

/** One text entity, layered, capitalised and tagged, into the op. */
CsDraw.addText = function(doc, op, layerName, text, pos, halign, tagKey, tagValue) {
    var data = new RTextData(pos, pos, CsDraw.TEXT_HEIGHT, 100.0,
        RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, CsDraw.caps(text), "standard", false, false, 0.0, false);
    var entity = new RTextEntity(doc, data);
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
    }
    op.addObject(entity, false);
    return entity;
};

/** One line, layered and tagged, into the op. extraTags (optional)
 *  is a {key: value} map written after the primary tag; empty/null
 *  values are dropped by CsTags.set itself. */
CsDraw.addLine = function(doc, op, layerName, from, to, tagKey, tagValue,
        extraTags) {
    var entity = new RLineEntity(doc, new RLineData(from, to));
    entity.setLayerId(doc.getLayerId(layerName));
    if (tagKey !== undefined && tagValue !== undefined && tagValue !== "") {
        CsTags.set(entity, tagKey, tagValue);
    }
    if (extraTags !== undefined && extraTags !== null) {
        for (var k in extraTags) {
            if (extraTags.hasOwnProperty(k)) {
                CsTags.set(entity, k, extraTags[k]);
            }
        }
    }
    op.addObject(entity, false);
    return entity;
};

/** One point, layered, into the op (tags via CsTags on the entity
 *  BEFORE this returns get committed with it). */
CsDraw.addPoint = function(doc, op, layerName, pos) {
    var entity = new RPointEntity(doc, new RPointData(pos));
    entity.setLayerId(doc.getLayerId(layerName));
    return entity; // caller tags, then op.addObject(entity, false)
};

/**
 * The bounding box of the CAVE PLAN DATA alone, as {minX, minY, maxX,
 * maxY}, or null when the drawing holds none.
 *
 * "Plan data" means: visible entities whose layer is in the PLAN frame
 * (CsLayers.frameOf -- so the profile region and the sheet furniture
 * never count), excluding the suite's own generated underlays: the
 * aerial basemap, the surface contours and inserted sketch scans, each
 * recognised by the tag its tool stamps before adding.
 *
 * THE ONE DEFINITION, by request (Nathan, 2026-08-27): this box is what
 * the ground-window tools (Aerial Basemap, Surface Contours) size their
 * fetch against, and what profile placement pads away from. Before it
 * existed each tool unioned the whole visible document, so a drawn
 * profile inflated the imagery window and the imagery in turn crowded
 * the profile -- the two feeding each other forever.
 */
CsDraw.planDataBox = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var out = null;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (typeof e.isVisible === "function" && !e.isVisible()) {
            continue;                       // off/frozen layer, or hidden
        }
        if (CsTags.get(e, "AerialBasemap") === "1" ||
                CsTags.get(e, "SurfaceContours") === "1" ||
                CsTags.get(e, "SketchScan") !== "") {
            continue;                       // generated underlay
        }
        var lname;
        try {
            lname = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;
        }
        if (CsLayers.frameOf(lname) !== "plan") {
            continue;                       // profile region, sheet
        }
        var box;
        try {
            box = e.getBoundingBox();
        } catch (eBox) {
            continue;
        }
        if (isNull(box) || typeof box.isSane !== "function" ||
                !box.isSane()) {
            continue;
        }
        var min = box.getMinimum(), max = box.getMaximum();
        // plain typeof, not library.js's isNumber: this file loads in
        // the headless harness, where library.js does not
        if (typeof min.x !== "number" || typeof max.x !== "number" ||
                isNaN(min.x) || isNaN(max.x) ||
                max.x < min.x || max.y < min.y) {
            continue;
        }
        if (out === null) {
            out = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
        } else {
            out.minX = Math.min(out.minX, min.x);
            out.minY = Math.min(out.minY, min.y);
            out.maxX = Math.max(out.maxX, max.x);
            out.maxY = Math.max(out.maxY, max.y);
        }
    }
    return out;
};

/**
 * Draws one station: tagged point on CTRL-STATIONS, label on
 * CTRL-STATION-LABELS. Returns the point entity (already added).
 */
CsDraw.station = function(doc, op, pos, data) {
    var pt = CsDraw.addPoint(doc, op, CsLayers.CTRL_STATIONS, pos);
    CsTags.tagStation(pt, data);
    op.addObject(pt, false);

    if (data.name !== undefined && data.name !== "") {
        var label = data.name;
        if (data.z !== undefined && data.z !== null && Math.abs(data.z) > 1e-6) {
            label += " (Z" + (data.z >= 0 ? "+" : "") + data.z.toFixed(1) + ")";
        }
        var rad = (data.azimuth === undefined || data.azimuth === null) ?
            (Math.PI / 4.0) : ((data.azimuth - 90.0) * Math.PI / 180.0);
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        CsDraw.addText(doc, op, CsLayers.CTRL_STATION_LABELS, label,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            RS.HAlignRight, "StationLabel", data.name);
    }
    return pt;
};

/** One centerline shot line, tagged with its endpoints ("A->B" under
 *  "Shot" -- eraseStations keys on it). layerName (optional) defaults
 *  to CTRL-SHOTS; extraTags (optional) adds the schema-v3 shot data
 *  tags. Older 6-argument callers keep working unchanged. */
CsDraw.shotLine = function(doc, op, fromPos, toPos, fromName, toName,
        layerName, extraTags) {
    var tag = (fromName !== undefined && toName !== undefined &&
        fromName !== "" && toName !== "") ? (fromName + "->" + toName) : "";
    return CsDraw.addLine(doc, op,
        (layerName === undefined || layerName === null) ?
            CsLayers.CTRL_SHOTS : layerName,
        fromPos, toPos, "Shot", tag, extraTags);
};

/**
 * A station's LRUD: L/R tick lines with tagged tip points on
 * CTRL-LRUD, U/D note on CTRL-STATION-LABELS. null = not measured
 * (nothing drawn); 0 = wall at the station (tagged tip point only).
 */
CsDraw.lrud = function(doc, op, pos, name, azimuthDeg, left, right, up, down, allSides) {
    // allSides (optional): {leftAll, rightAll, upAll, downAll} -- a
    // side written "5/10" draws EVERY reading. The largest is the
    // primary (the outer wall, tagged "<name>.L"); the inner ones tag
    // "<name>.L2", "<name>.L3", ... so wall runs keep following the
    // outer wall while ledges stay findable.
    var sides = [
        ["L", left, allSides ? allSides.leftAll : null],
        ["R", right, allSides ? allSides.rightAll : null]
    ];
    for (var i = 0; i < sides.length; i++) {
        var side = sides[i][0];
        var primary = sides[i][1];
        if (primary === null || primary === undefined) {
            continue;
        }
        var values = sides[i][2];
        if (values === null || values === undefined) {
            values = [primary];
        }
        var extraIndex = 2;
        for (var v = 0; v < values.length; v++) {
            var len = values[v];
            var isPrimary = (len === primary);
            var suffix = isPrimary ? side : (side + extraIndex++);
            var tipPos;
            if (len === 0) {
                tipPos = new RVector(pos.x, pos.y);
            } else {
                var end = CsLrud.tickEnd(pos, azimuthDeg, side, len);
                if (end === null) {
                    // NO BEARING, NO TICK -- the same answer the plan's
                    // wall builder gives (CsLrud.stationWallPoints), and
                    // it has to be given HERE too or the two views of
                    // the same station disagree. Reachable at a station
                    // whose walls were measured on a pitch and whose
                    // passage direction is unknown as well: a dead-end
                    // shaft bottom with nothing leading off it.
                    continue;
                }
                tipPos = new RVector(end.x, end.y);
                CsDraw.addLine(doc, op, CsLayers.CTRL_LRUD, pos, tipPos,
                    "LRUDLine", name !== "" ? (name + "." + suffix) : "");
            }
            if (name !== undefined && name !== "") {
                var tip = CsDraw.addPoint(doc, op, CsLayers.CTRL_LRUD, tipPos);
                CsTags.set(tip, "LRUDName", name + "." + suffix);
                op.addObject(tip, false);
            }
            if (isPrimary) {
                // only the first occurrence of the max is primary
                primary = NaN;
            }
        }
    }

    var hasUp = up !== null && up !== undefined;
    var hasDown = down !== null && down !== undefined;
    if ((hasUp && up !== 0) || (hasDown && down !== 0)) {
        var upText = !hasUp ? "-" :
            (allSides && allSides.upAll ? allSides.upAll.join("/") : up.toFixed(2));
        var downText = !hasDown ? "-" :
            (allSides && allSides.downAll ? allSides.downAll.join("/") : down.toFixed(2));
        var text = "U" + upText + " D" + downText;
        // A note still gets placed when there is no bearing -- it is
        // text about the station, not geometry measured off one -- but
        // it is offset along a fixed diagonal rather than along NaN,
        // which would put it at the origin.
        var noteAz = (typeof azimuthDeg === "number" && isFinite(azimuthDeg)) ?
            azimuthDeg : 45.0;
        var rad = (noteAz + 90.0) * Math.PI / 180.0;
        var off = CsDraw.TEXT_HEIGHT * 1.5;
        CsDraw.addText(doc, op, CsLayers.CTRL_STATION_LABELS, text,
            new RVector(pos.x + off * Math.sin(rad), pos.y + off * Math.cos(rad)),
            RS.HAlignLeft, "LRUDNote", name);
    }
};

/**
 * A station's note, written OUTSIDE the passage with a leader back to
 * the station point: the text sits beyond the nearer measured wall
 * (right of travel first, left as fallback, a fixed offset when no
 * LRUD), on TEXT-NOTES, with a leader pointing at the station.
 */
CsDraw.noteLeader = function(doc, op, pos, name, note, azimuthDeg, lrud,
        opts) {
    // opts, all optional and all defaulting to what a station NOTE has
    // always done:
    //   tagLabel, tagLeader  the tags a redraw finds these by. A second
    //                        kind of generated label at the same station
    //                        must NOT answer to "NoteLabel": the two
    //                        would erase each other's survivors and, on
    //                        the way there, sit on top of one another.
    //   preferLeft           put the text on the LEFT of travel first.
    //                        A station that carries both a note and a
    //                        pitch label needs them on opposite sides
    //                        or the reader gets one line of text over
    //                        another.
    var o = opts || {};
    var tagLabel = o.tagLabel || "NoteLabel";
    var tagLeader = o.tagLeader || "NoteLeader";
    var az = (azimuthDeg === undefined || azimuthDeg === null) ?
        0.0 : azimuthDeg;
    var side = o.preferLeft === true ? -90.0 : 90.0;
    var wall = 0.0;
    var r = (lrud !== null && lrud !== undefined &&
        lrud.right !== null && lrud.right !== undefined) ? lrud.right : null;
    var l = (lrud !== null && lrud !== undefined &&
        lrud.left !== null && lrud.left !== undefined) ? lrud.left : null;
    var near = o.preferLeft === true ? l : r;
    var far = o.preferLeft === true ? r : l;
    if (near !== null) {
        wall = near;
    } else if (far !== null) {
        side = -side;
        wall = far;
    }
    var rad = (az + side) * Math.PI / 180.0;
    var dirX = Math.sin(rad), dirY = Math.cos(rad);
    var dist = wall + CsDraw.TEXT_HEIGHT * 4.0;
    var labelPos = new RVector(pos.x + dirX * dist, pos.y + dirY * dist);

    // The arrow stops just short of the station so the arrowhead does
    // not sit on top of the station dot.
    var tip = { x: pos.x + dirX * CsDraw.TEXT_HEIGHT * 0.6,
                y: pos.y + dirY * CsDraw.TEXT_HEIGHT * 0.6 };

    // A GENERATED NOTE LABEL IS A REAL CALLOUT.
    //
    // It used to be a text plus a bare two-point leader, which meant the
    // suite drew something a caver could not then adjust: move the label
    // and the arrow stayed. Now it carries the same CalloutId link a
    // hand-placed callout does, so CalloutListener reflows it live and
    // CsCalloutSync repairs it -- the generated notes and the hand ones
    // behave identically once they are on the sheet.
    //
    // ON ITS OWN LAYER (NOTES-ANNOTATION), because a regenerate is
    // entitled to clear what it drew and must not take hand-placed notes
    // with it. Appearance matches a hand-placed name note on purpose: a
    // reader should not be able to tell which notes were drawn for them.
    //
    // THE OLD TAGS STAY. NoteLabel/NoteLeader are how eraseStations finds
    // these to remove on a redraw (it matches by TAG, not by layer -- see
    // its station-name rules), how CsBind knows this is the suite's own
    // output and not a caver's linework to claim, and (for the frozen
    // Trip Focus, see docs/FROZEN.md) how CsFocus filters
    // a trip view. Dropping them to "modernise" would break a redraw into
    // duplicates and let the binder claim the suite's own drawing.
    var layerName = CsCallout.STYLES["annotation"];
    var layerId = doc.getLayerId(layerName);
    var id = CsCallout.newId();

    // Alignment follows the side the label sits on, so the text grows
    // AWAY from the station and its near edge faces the arrow. This is
    // the rule addText already used here; it is now shared with the
    // interactive command through CsCallout.
    var halign = (dirX >= 0) ? RS.HAlignLeft : RS.HAlignRight;

    var textData = new RTextData(labelPos, labelPos, CsDraw.TEXT_HEIGHT,
        100.0, RS.VAlignMiddle, halign, RS.LeftToRight, RS.Exact,
        1.0, CsDraw.caps(note), "standard", false, false, 0.0, false);
    var textEntity = new RTextEntity(doc, textData);
    textEntity.setLayerId(layerId);
    CsTags.set(textEntity, tagLabel, name);
    CsTags.set(textEntity, CsCallout.KEY.ID, id);
    CsTags.set(textEntity, CsCallout.KEY.ROLE, CsCallout.ROLE_TEXT);
    CsTags.set(textEntity, CsCallout.KEY.KIND, CsCallout.KIND_TEXT);
    CsTags.set(textEntity, CsCallout.KEY.STYLE, "annotation");
    CsTags.set(textEntity, CsCallout.KEY.SIDE, "auto");
    CsTags.set(textEntity, CsCallout.KEY.LEADER,
        CsCallout.LEADER_STRAIGHT);
    op.addObject(textEntity, false);

    // Solved against the text's REAL box, which is readable BEFORE the
    // entity is added -- so the label and its arrow land in the caller's
    // single operation and one undo takes the whole redraw.
    var b = textData.getBoundingBox();
    var c1 = b.getCorner1(), c2 = b.getCorner2();
    var box = {
        x1: Math.min(c1.x, c2.x), y1: Math.min(c1.y, c2.y),
        x2: Math.max(c1.x, c2.x), y2: Math.max(c1.y, c2.y)
    };
    var geom = CsCallout.reflow(box, [tip], {
        side: "auto",
        leader: CsCallout.LEADER_STRAIGHT,
        dimasz: null,
        dimscale: null
    });

    var leaderDrawn = false;
    try {
        var pl = new RPolyline();
        var pts = geom.branches[0];
        for (var v = 0; v < pts.length; v++) {
            pl.appendVertex(new RVector(pts[v].x, pts[v].y),
                pts[v].bulge || 0.0);
        }
        var leader = new RLeaderEntity(doc, new RLeaderData(pl, true));
        leader.setLayerId(layerId);
        CsTags.set(leader, tagLeader, name);
        CsTags.set(leader, CsCallout.KEY.ID, id);
        CsTags.set(leader, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
        CsTags.set(leader, CsCallout.KEY.STYLE, "annotation");
        op.addObject(leader, false);
        leaderDrawn = true;
    } catch (e) {
        // bridge without RLeader*: a plain line still points the way,
        // and it keeps the NoteLeader tag so a redraw still erases it.
        // It carries no CalloutId: half a callout is worse than none,
        // because members() would match a leader that cannot be reflowed.
    }
    if (!leaderDrawn) {
        var lastPt = geom.branches[0][geom.branches[0].length - 1];
        CsDraw.addLine(doc, op, layerName,
            new RVector(tip.x, tip.y),
            new RVector(lastPt.x, lastPt.y),
            tagLeader, name);
    }
};

/**
 * Draws a whole resolved survey as ONE operation (one undo step) for
 * the visible survey: stations, labels, shot lines, LRUD, all layered
 * and tagged. A survey with excludeFromPlot shots issues up to three
 * more operations on top of that (undo then needs multiple steps),
 * because CsLayers.withLayerOn must toggle the OFF hidden-legs layer
 * on, add those legs, and toggle it back off -- this build refuses
 * adds to a layer that's off.
 *
 * Tag schema v3: the drawing's tags alone reconstruct the survey.
 * Every leg line carries its shot's full data (From/To/Trip/ShotSeq/
 * Distance/Azimuth/Inclination/LRUD, plus backsights/Flags/Note/
 * Declination when present) -- shots live on LEGS, not stations, because a loop
 * closure's arrival would overwrite the TO station's tags (the old
 * scheme's collision; station-level Azimuth etc. remain but legs are
 * canonical). Each trip's first resolved station anchors that trip's
 * metadata (Trip* tags); the trip-0 anchor additionally carries
 * StartNote/StartLRUD, the legacy Survey* block, the adjustment record
 * (Adjustment/SigmaTape/SigmaAngle -- what this drawing's geometry was
 * solved with, so a redraw reproduces it instead of re-solving under
 * today's settings), and the shots the drawing can't show as geometry
 * (ExcludedShots/UnplacedShots rows).
 * excludeFromPlot legs draw on CTRL-HIDDEN (via CsLayers.withLayerOn,
 * since that layer is off) instead of being skipped.
 *
 * When `resolved` carries a `raw` result (CsAdjust set one, meaning
 * something really was adjusted), the AS-SURVEYED centerline is drawn
 * as a grey dashed ghost on CTRL-RAW -- another off layer, so another
 * withLayerOn operation. See the block itself for why the ghost is
 * tagged RawShot/RawStation and nothing else.
 *
 * \return {stationsDrawn, pitchesDrawn, shotsDrawn, closuresDrawn, tiesDrawn,
 *          hiddenDrawn, wallsDrawn, splaysDrawn, ghostDrawn, skipped,
 *          splaysSkipped, wallPointsSkipped} -- the last two count
 *          splays CsTraverse.offset refused (no usable distance/
 *          azimuth/inclination), named apart from `skipped` (excluded,
 *          or never connected) so a report never conflates the two
 *
 * \param options Optional. `partial` and `omitStations` as described
 *                above, `profileSurvey`/`profileResolved` for the
 *                elevation pass, and `doc`/`di` -- THE DRAWING TO DRAW
 *                INTO. Pass them whenever the caller already has a
 *                document; only a call site that really means "the
 *                drawing in front of the user" should let them default
 *                to getDocument()/getDocumentInterface().
 */
CsDraw.survey = function(survey, resolved, originStation, originPos,
        seqBase, options) {
    if (seqBase === undefined || seqBase === null) {
        seqBase = 0;
    }
    if (options === undefined || options === null) {
        options = {};
    }
    // PARTIAL: this draw covers part of a drawing that already holds
    // the rest of the cave (Survey Notebook's incremental Draw). It
    // changes what is written ABOUT the drawing as a whole -- see the
    // two guards below -- and nothing about the geometry.
    var partial = options.partial === true;
    // Stations whose POSITION this draw needs but whose marks it must
    // not draw: the station a page ties into is already in the drawing,
    // with its own LRUD and its own trip's tags, and drawing it again
    // from a survey that holds only the page's shots would replace a
    // full station with a bare one. Its position is still needed -- the
    // page's first leg starts there.
    var omit = {};
    if (options.omitStations !== undefined &&
            options.omitStations !== null) {
        for (var oi = 0; oi < options.omitStations.length; oi++) {
            omit[options.omitStations[oi]] = true;
        }
    }
    // THE DRAWING THIS DRAWS INTO. Handed in by every caller that
    // already has one; the globals are the fallback for a call site
    // that genuinely means "whatever is in front of the user". Reading
    // the globals unconditionally was a latent trap, measured through
    // the MCP bridge: driven against a document that was not the
    // active one, this threw inside CsLayers ("Cannot call method
    // 'hasLayer' of undefined") while its caller's other passes
    // quietly succeeded against a DIFFERENT drawing.
    var doc = options.doc;
    if (doc === undefined || doc === null) {
        doc = getDocument();
    }
    var di = options.di;
    if (di === undefined || di === null) {
        di = getDocumentInterface();
    }
    CsLayers.ensureSurveyLayers(doc, di);
    CsModel.ensureTrips(survey);

    // BEFORE ANYTHING MOVES: give any scan aligned before anchors
    // existed its anchors, read out of where it sits right now. That
    // reading is only correct while the scan and the survey still
    // agree, so it cannot wait until after the redraw -- afterwards it
    // would record the wrong pixels and make the error permanent.
    var scanBackfill = 0;
    if (typeof CsScanReanchor !== "undefined") {
        try {
            scanBackfill = CsScanReanchor.backfill(doc, di);
        } catch (eBackfill) {
            scanBackfill = 0;
        }
    }

    // per-trip shot sequence: shotSeqOf[i] = index of survey.shots[i]
    // within its own trip, in survey.shots order -- what reconstruction
    // sorts by to restore notebook order inside each trip.
    // Also stamped onto the shot itself as the transient _csSeq
    // property, since several call sites below only have the shot
    // object (from resolved.legs/resolved.unresolved, not a
    // survey.shots index) and would otherwise need an O(n)
    // survey.shots.indexOf(shot) per shot to look shotSeqOf up --
    // this precompute loop already visits every shot once, so reading
    // shot._csSeq back is O(1) instead.
    var shotSeqOf = [];
    var tripCounters = {};
    for (var si = 0; si < survey.shots.length; si++) {
        var sTrip = survey.shots[si].trip || 0;
        shotSeqOf[si] = tripCounters[sTrip] || 0;
        tripCounters[sTrip] = shotSeqOf[si] + 1;
        survey.shots[si]._csSeq = shotSeqOf[si];
    }

    // a station's trip = trip of the first shot that touches it; the
    // first drawn station of each trip anchors that trip's metadata
    var stationTrip = {};
    for (si = 0; si < survey.shots.length; si++) {
        var tSh = survey.shots[si];
        if (tSh.excludeFromAll) {
            continue;
        }
        if (tSh.from !== "" && stationTrip[tSh.from] === undefined) {
            stationTrip[tSh.from] = tSh.trip || 0;
        }
        if (!tSh.splay && tSh.to !== "" &&
                stationTrip[tSh.to] === undefined) {
            stationTrip[tSh.to] = tSh.trip || 0;
        }
    }

    // the v3 data tags one drawn leg (or splay) carries. shot._csSeq
    // is the per-trip sequence stamped by the precompute loop above --
    // reading it here avoids an O(n) survey.shots.indexOf(shot) at
    // every call site.
    var legTags = function(shot) {
        var tags = {
            From: shot.from,
            To: shot.to,
            Trip: shot.trip || 0,
            ShotSeq: shot._csSeq,
            Distance: shot.distance,
            Azimuth: shot.azimuth,
            Inclination: shot.inclination,
            Left: CsModel.lrudEntryText(shot.left, shot.leftAll, shot.leftOpen),
            Right: CsModel.lrudEntryText(shot.right, shot.rightAll, shot.rightOpen),
            Up: CsModel.lrudEntryText(shot.up, shot.upAll, shot.upOpen),
            Down: CsModel.lrudEntryText(shot.down, shot.downAll, shot.downOpen),
            BackAzimuth: shot.backAzimuth,
            BackInclination: shot.backInclination,
            Flags: CsModel.flagsText(shot),
            Note: shot.notes,
            // The declination this shot's azimuth was computed with:
            // provenance has to survive the save, or a revision of a
            // reopened drawing is back to guessing from the trip.
            // Null -- no record, fall back to the trip -- writes no
            // tag, which reads back as the same null.
            Declination: shot.declination
        };
        // CsTags.set drops null/"" values itself, so absent backsights,
        // empty flag sets and unmeasured LRUD simply write no tag
        return tags;
    };

    var op = new RAddObjectsOperation();
    op.setText("Draw cave survey");

    var offX = 0, offY = 0;
    if (originStation !== undefined && originStation !== null &&
        resolved.stations.hasOwnProperty(originStation) &&
        originPos !== undefined && originPos !== null) {
        offX = originPos.x - resolved.stations[originStation].x;
        offY = originPos.y - resolved.stations[originStation].y;
    }

    var at = function(name) {
        var st = resolved.stations[name];
        return new RVector(st.x + offX, st.y + offY);
    };

    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    // the first drawn leg's azimuth orients the start station's LRUD
    var firstLegAzimuth;
    for (var li = 0; li < resolved.legs.length; li++) {
        if (!resolved.legs[li].shot.excludeFromPlot) {
            firstLegAzimuth = CsTraverse.effectiveAzimuth(resolved.legs[li].shot);
            break;
        }
    }

    // a station's note rides on the shot arriving at it; the first
    // station's on survey.startNote
    var noteFor = {};
    for (var ni = 0; ni < survey.shots.length; ni++) {
        var nsh = survey.shots[ni];
        if (!nsh.splay && !nsh.excludeFromAll && nsh.notes &&
            nsh.notes !== "") {
            noteFor[nsh.to] = nsh.notes;
        }
    }

    // Passage axes for the whole survey, once: CsLrud.tickAzimuthAt
    // needs them at any station whose LRUD was measured on a pitch.
    var drawAxes = CsLrud.stationAxes(resolved);

    var stationsDrawn = 0;
    var firstPoint;
    var tripAnchor = {}; // trip index -> that trip's anchor point entity
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        if (omit[name] === true) {
            continue; // already drawn, by the trip it belongs to
        }
        var lrud = CsModel.lrudForStation(survey, name);
        if (lrud === null && i === 0 && survey.startLrud !== null &&
            survey.startLrud !== undefined && firstLegAzimuth !== undefined) {
            lrud = {
                left: survey.startLrud.left,
                right: survey.startLrud.right,
                up: survey.startLrud.up,
                down: survey.startLrud.down,
                leftAll: survey.startLrud.leftAll || null,
                rightAll: survey.startLrud.rightAll || null,
                upAll: survey.startLrud.upAll || null,
                downAll: survey.startLrud.downAll || null,
                leftOpen: !!survey.startLrud.leftOpen,
                rightOpen: !!survey.startLrud.rightOpen,
                upOpen: !!survey.startLrud.upOpen,
                downOpen: !!survey.startLrud.downOpen,
                azimuth: firstLegAzimuth
            };
        }
        var noteText = noteFor[name] !== undefined ? noteFor[name] :
            (i === 0 ? survey.startNote : undefined);
        var pt = CsDraw.station(doc, op, at(name), {
            name: name,
            seq: resolved.stations[name].seq + seqBase,
            azimuth: lrud !== null ? lrud.azimuth : undefined,
            left: lrud !== null ? lrud.left : undefined,
            right: lrud !== null ? lrud.right : undefined,
            up: lrud !== null ? lrud.up : undefined,
            down: lrud !== null ? lrud.down : undefined,
            leftOpen: lrud !== null ? lrud.leftOpen : undefined,
            rightOpen: lrud !== null ? lrud.rightOpen : undefined,
            upOpen: lrud !== null ? lrud.upOpen : undefined,
            downOpen: lrud !== null ? lrud.downOpen : undefined,
            z: resolved.stations[name].z,
            note: noteText
        });
        if (firstPoint === undefined) {
            firstPoint = pt;
        }
        if (stationTrip[name] !== undefined &&
                tripAnchor[stationTrip[name]] === undefined) {
            tripAnchor[stationTrip[name]] = pt;
        }
        if (survey.fixed.hasOwnProperty(name)) {
            // The Fixed tag is read back into survey.fixed verbatim on
            // reopen (CsTags.surveyFromDocument, CsRevise's scale
            // rewrite): it has to describe the SAME coordinate the
            // station is actually drawn at, or a later revision
            // "corrects" a disagreement between the tag and the
            // geometry that was never real. Writing the resolved
            // station position rather than the raw survey.fixed[name]
            // guarantees that -- the two already coincide whenever
            // the control was honored as given, or honored via the
            // anchor's frame offset (CsNetwork.resolve's
            // controlFrame.applied), so this changes nothing in
            // either of those common cases. When the control was NOT
            // honored at all (named in controlFrame.notHonored --
            // there was no anchor's-frame offset to place it with),
            // there is nothing truthful to write: the tag is skipped
            // rather than asserting a control value nobody actually
            // pinned.
            var cf = resolved.controlFrame;
            var fixedNotHonored = cf !== undefined && cf !== null &&
                cf.notHonored.indexOf(name) >= 0;
            if (!fixedNotHonored) {
                var fst = resolved.stations[name];
                CsTags.set(pt, "Fixed", fst.x + "," + fst.y + "," + fst.z);
            }
        }
        if (lrud !== null) {
            // THE TICK'S BEARING, NOT THE TAG'S. `lrud.azimuth` is null
            // at a station reached by a pitch -- there was no bearing to
            // face -- and CsLrud.tickAzimuthAt answers with the
            // passage's own direction instead, which is the same rule
            // the plan's wall builder uses. The two must agree: the
            // ticks drawn here and the wall polyline drawn from
            // CsLrud.wallRuns are the same measurement seen twice, and
            // a reader looking at a pit foot would see the wall miss
            // its own tick by 90 degrees.
            CsDraw.lrud(doc, op, at(name), name,
                CsLrud.tickAzimuthAt(drawAxes, name, lrud, resolved),
                lrud.left, lrud.right, lrud.up, lrud.down, {
                    leftAll: lrud.leftAll, rightAll: lrud.rightAll,
                    upAll: lrud.upAll, downAll: lrud.downAll
                });
        }
        if (noteText !== undefined && noteText !== null && noteText !== "") {
            // NOTES-ANNOTATION, not TEXT-NOTES: generated note labels
            // moved to their own layer so a regenerate can clear what it
            // drew without taking hand-placed notes with it. Ensured
            // here because a drawing that never saw the template has no
            // such layer, and getLayerId would then hand noteLeader an
            // invalid id -- entities land, on nothing, silently.
            CsLayers.ensure(doc, di, CsLayers.NOTES_ANNOTATION);
            CsDraw.noteLeader(doc, op, at(name), name, noteText,
                CsLrud.tickAzimuthAt(drawAxes, name, lrud, resolved) !== null ?
                    CsLrud.tickAzimuthAt(drawAxes, name, lrud, resolved) :
                    firstLegAzimuth, lrud);
        }
        stationsDrawn++;
    }

    // ---- pitch labels -----------------------------------------------
    //
    // "P 187 FT" beside the entrance drop is the single most-read mark
    // on a pit map, and nothing else on the drawing answers the
    // question: in plan a 187 ft free-fall has no extent at all (its
    // two stations are the same point -- see CsLrud.COINCIDENT_PLAN),
    // so without this the deepest thing in the cave is drawn as a dot
    // with a station number on it.
    //
    // Drawn from the same pass as the stations, and keyed to the
    // pitch's TOP station, so a redraw of that station takes its label
    // with it (see eraseStations' PitchLabel rules) and a cave with no
    // pitches gains nothing. On the LEFT of travel, because the
    // station's own note goes right and a pit head often has both.
    var pitchesDrawn = 0;
    if (CsPitch.labelsEnabled()) {
        var pitches = CsPitch.find(survey, resolved, {});
        for (var pi2 = 0; pi2 < pitches.length; pi2++) {
            var pitch = pitches[pi2];
            if (omit[pitch.top] === true ||
                    resolved.stations[pitch.top] === undefined) {
                continue;
            }
            CsLayers.ensure(doc, di, CsLayers.NOTES_ANNOTATION);
            var pLrud = CsModel.lrudForStation(survey, pitch.top);
            var pAz = CsLrud.tickAzimuthAt(drawAxes, pitch.top, pLrud,
                resolved);
            CsDraw.noteLeader(doc, op, at(pitch.top), pitch.top,
                CsPitch.label(pitch, survey.distanceUnit),
                pAz !== null ? pAz : firstLegAzimuth, pLrud,
                { tagLabel: "PitchLabel", tagLeader: "PitchLeader",
                  preferLeft: true });
            pitchesDrawn++;
        }
    }

    var shotsDrawn = 0, closuresDrawn = 0, tiesDrawn = 0;
    var hiddenLegs = []; // excludeFromPlot legs -- drawn on CTRL-HIDDEN below
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromPlot) {
            hiddenLegs.push(leg);
            continue;
        }
        CsDraw.shotLine(doc, op, at(leg.from), at(leg.to), leg.from, leg.to,
            CsLayers.CTRL_SHOTS, legTags(leg.shot));
        // The three leg kinds CsNetwork produces, counted apart because
        // they mean different things to a surveyor. "new" extends the
        // traverse. "closure" arrives back at a station already placed
        // through the SAME component -- a loop, with a misclosure to
        // distribute. "tie" is the one shot joining two separately
        // anchored components (a cave with two *fix'ed entrances): it
        // has no ring, so no percent-of-traverse error, and calling it
        // a loop closure would be wrong. Before this it fell into the
        // ordinary-shot branch by accident rather than by decision.
        if (leg.kind === "closure") {
            closuresDrawn++;
        } else if (leg.kind === "tie") {
            tiesDrawn++;
        } else {
            shotsDrawn++;
        }
    }

    // Splays: rays from their station to the wall they hit, thin and
    // grey on CTRL-SPLAYS, each ending in a tagged tip point -- the
    // same shape LRUD ticks leave, so wall tracing can snap to them.
    // Named <station>.<n> in shot order, matching what the notebook
    // shows. The network never resolves them (no TO station), so they
    // are drawn straight off their shot readings. eraseStations strips
    // the trailing .<n> to replace them on a redraw.
    var splaysDrawn = 0;
    var splaysSkipped = 0;
    var splayCounts = {};
    for (i = 0; i < survey.shots.length; i++) {
        var sp = survey.shots[i];
        if (!sp.splay || sp.excludeFromAll || sp.excludeFromPlot) {
            continue;
        }
        if (!resolved.stations.hasOwnProperty(sp.from)) {
            continue; // its station never connected -- stays skipped
        }
        // count against the station's OWN row order even when this
        // splay turns out unmeasurable, so a splay that DOES draw
        // keeps the number matching its row in the notebook -- a gap
        // in the numbering (D2.1, D2.3) is itself a signal, not a bug
        splayCounts[sp.from] = (splayCounts[sp.from] || 0) + 1;
        var splayName = sp.from + "." + splayCounts[sp.from];
        var so = CsTraverse.offset(sp, CsTraverse.SLOPE);
        if (so === null) {
            // no distance or no azimuth/inclination on record: a ray
            // drawn from null*cos (at the station) or NaN (poisoning
            // RVector and the DXF writer) would both assert a
            // measurement nobody took. Skip it and count it instead.
            splaysSkipped++;
            continue;
        }
        var sPos = at(sp.from);
        var sEnd = new RVector(sPos.x + so.dx, sPos.y + so.dy);
        // the ray carries its readings too (v3): Trip/ShotSeq/Distance/
        // Azimuth/Inclination/Note, so the splay reconstructs from tags
        CsDraw.addLine(doc, op, CsLayers.CTRL_SPLAYS, sPos, sEnd,
            "Splay", splayName, legTags(sp));
        var sTip = CsDraw.addPoint(doc, op, CsLayers.CTRL_SPLAYS, sEnd);
        CsTags.set(sTip, "SplayName", splayName);
        op.addObject(sTip, false);
        // the tip's name, just past the tip so the ray stays clear
        var sLen = Math.sqrt(so.dx * so.dx + so.dy * so.dy);
        var ux = sLen > 1e-9 ? so.dx / sLen : 1.0;
        var uy = sLen > 1e-9 ? so.dy / sLen : 0.0;
        CsDraw.addText(doc, op, CsLayers.CTRL_SPLAYS, splayName,
            new RVector(sEnd.x + ux * CsDraw.TEXT_HEIGHT * 0.8,
                sEnd.y + uy * CsDraw.TEXT_HEIGHT * 0.8),
            ux >= 0 ? RS.HAlignLeft : RS.HAlignRight,
            "SplayLabel", splayName);
        splaysDrawn++;
    }

    // Approximate passage walls from the LRUD, drawn WITH the survey
    // in the same undo step (this absorbed the old standalone LRUD
    // Walls tool). Straight dashed runs on the CTRL layers; runs break
    // at junctions and unmeasured stations on purpose. Tagged with the
    // RUN'S OWN station list (CsLrud.wallRuns now returns
    // {points, stations} per run) so eraseStations() replaces a wall
    // run when any of ITS OWN stations is redrawn, and leaves alone
    // wall runs belonging to a passage that was not touched. Before
    // this, every run was tagged with EVERY resolved station in the
    // whole drawing, which made eraseStations over-broad (any redraw
    // deleted every wall run) and made a station-set FOCUS wrong
    // outright (every wall run matched every focus selection) -- see
    // Task 7 in the trip-focus-viewer plan.
    var wallsDrawn = 0;
    var runs = CsLrud.wallRuns(survey, resolved);
    var wallPointsSkipped = runs.skipped;
    if (runs.left.length > 0 || runs.right.length > 0) {
        CsLayers.ensure(doc, di, CsLayers.CTRL_LRUD_WALL_LEFT);
        CsLayers.ensure(doc, di, CsLayers.CTRL_LRUD_WALL_RIGHT);
        var drawRuns = function(runList, layerName) {
            for (var ri = 0; ri < runList.length; ri++) {
                var run = runList[ri];
                var data = new RPolylineData();
                for (var k = 0; k < run.points.length; k++) {
                    // wall points come from the unanchored resolved
                    // coordinates: apply the same origin offset the
                    // stations get
                    data.appendVertex(new RVector(
                        run.points[k].x + offX, run.points[k].y + offY));
                }
                var pl = new RPolylineEntity(doc, data);
                pl.setLayerId(doc.getLayerId(layerName));
                CsTags.set(pl, "WallRun", layerName + ":" + ri);
                // GUARDED INVARIANT (review minor): CsTags.set is a
                // silent no-op on "", so a run whose `stations` encoded
                // to empty would draw WITHOUT a WallRunStations tag at
                // all -- and eraseStations' wall-run rule matches only
                // entities THAT CARRY the tag, so a redraw could never
                // find this polyline to replace it. Every redraw would
                // then stack a fresh duplicate on top of the last one,
                // forever. CsLrud.wallRuns' own docblock guarantees this
                // cannot happen (every run it returns has length >= 2,
                // and every point comes from a named station, so
                // `stations` always has at least one entry) -- this is
                // therefore unreachable today, but it is new in kind
                // under Task 7: before it, WallRunStations held the
                // whole survey's names, which could never be empty
                // either, for an unrelated reason. If that guarantee
                // ever stops holding, this is where a run silently
                // starts drawing itself un-erasable.
                CsTags.set(pl, "WallRunStations",
                    CsBind.encodeStations(run.stations));
                op.addObject(pl, false);
                wallsDrawn++;
            }
        };
        drawRuns(runs.left, CsLayers.CTRL_LRUD_WALL_LEFT);
        drawRuns(runs.right, CsLayers.CTRL_LRUD_WALL_RIGHT);
    }

    // Per-trip anchor tags: each trip's metadata rides on its first
    // resolved station in drawing order, so the drawing carries every
    // trip's date/team/declination, not just trip 0's.
    for (var ti = 0; ti < survey.trips.length; ti++) {
        var anchorPt = tripAnchor[ti];
        if (anchorPt === undefined) {
            continue; // no resolved station belongs to this trip
        }
        var trip = survey.trips[ti];
        CsTags.set(anchorPt, "Trip", ti);
        CsTags.set(anchorPt, "TripName", trip.name);
        CsTags.set(anchorPt, "TripDate", trip.date);
        CsTags.set(anchorPt, "TripTeam", trip.team);
        CsTags.set(anchorPt, "TripInstruments", trip.instruments || "");
        CsTags.set(anchorPt, "TripDeclination", trip.declination);
        CsTags.set(anchorPt, "TripDeclinationSource", trip.declinationSource);
        CsTags.set(anchorPt, "TripDistanceUnit", trip.distanceUnit);
    }

    // The drawing-level record rides trip 0's anchor, falling back to
    // the first station drawn -- which is right for a draw that IS the
    // whole drawing, and wrong for a partial one: the page's first
    // station would claim to be the trip-0 anchor and the drawing would
    // then have two, one of them carrying a whole-cave record derived
    // from a single page. A partial draw that does not contain trip 0's
    // own anchor therefore writes nothing here; the anchor it belongs
    // on is still in the drawing, untouched, with the record it already
    // had.
    var anchor0 = tripAnchor[0] !== undefined ? tripAnchor[0] :
        (partial ? undefined : firstPoint);
    if (anchor0 !== undefined) {
        // Legacy survey-level block, kept for pre-trip readers. The
        // name restores its pre-trip-split meaning: the drawing-level
        // cave name when known, falling back to the trip name for
        // formats with no separate cave-name concept.
        CsTags.set(anchor0, "SurveyName", survey.caveName || survey.name);
        CsTags.set(anchor0, "SurveyDate", survey.date);
        CsTags.set(anchor0, "SurveyTeam", survey.team);
        CsTags.set(anchor0, "Declination", survey.declination);
        CsTags.set(anchor0, "DeclinationSource", survey.declinationSource);
        CsTags.set(anchor0, "DistanceUnit", survey.distanceUnit);
        // v3: the first station's own data (no arriving shot carries it)
        CsTags.set(anchor0, "StartNote", survey.startNote);
        CsTags.set(anchor0, "StartLRUD",
            CsModel.startLrudText(survey.startLrud));
        // WHAT THIS DRAWING WAS ADJUSTED WITH, so reopening it and
        // pressing Draw reproduces the geometry it already has instead
        // of silently re-solving under whatever the global setting
        // happens to be that day. Recorded unconditionally, including
        // "none": adjustment OFF is just as much a fact about this
        // drawing as adjustment on, and a drawing that records nothing
        // falls back to the settings (see CsAdjust.optionsFromTags),
        // which is exactly the silent move this record exists to stop.
        //
        // The sigmas come from summary, not from CsAdjust's defaults,
        // because summary is what the solve actually used -- and on the
        // pass-through path CsAdjust.unadjusted reports the caller's
        // own sigmas there for this reason. A `resolved` that never
        // went through CsAdjust at all (a plain CsNetwork.resolve --
        // several tests, and any caller not yet wired) has no summary:
        // record the defaults rather than NaN, and Adjustment=none,
        // which is the truth about such a drawing.
        var adjTags = CsAdjust.tagsFor({
            enabled: resolved.adjusted === true,
            sigmaTape: (resolved.summary !== undefined &&
                resolved.summary !== null) ? resolved.summary.sigmaTape :
                CsAdjust.DEFAULT_SIGMA_TAPE,
            sigmaAngle: (resolved.summary !== undefined &&
                resolved.summary !== null) ? resolved.summary.sigmaAngle :
                CsAdjust.DEFAULT_SIGMA_ANGLE
        });
        CsTags.set(anchor0, "Adjustment", adjTags.Adjustment);
        CsTags.set(anchor0, "SigmaTape", adjTags.SigmaTape);
        CsTags.set(anchor0, "SigmaAngle", adjTags.SigmaAngle);
        // Shots the drawing can't show as geometry still reconstruct:
        // one "tripId TAB shotSeq TAB shotRow" line per shot (CsTags.set
        // escapes the newlines between lines itself). shotSeq is the
        // same per-trip counter (shotSeqOf, computed above for the
        // drawn legs/splays) so a reader can interleave these rows with
        // the drawn shots and restore the original notebook order
        // within each trip.
        var exRows = [];
        var unRows = [];
        for (i = 0; i < survey.shots.length; i++) {
            if (survey.shots[i].excludeFromAll) {
                exRows.push((survey.shots[i].trip || 0) + "\t" +
                    shotSeqOf[i] + "\t" +
                    CsModel.shotRowText(survey.shots[i]));
            }
        }
        for (i = 0; i < resolved.unresolved.length; i++) {
            unRows.push((resolved.unresolved[i].trip || 0) + "\t" +
                resolved.unresolved[i]._csSeq + "\t" +
                CsModel.shotRowText(resolved.unresolved[i]));
        }
        if (exRows.length > 0) {
            CsTags.set(anchor0, "ExcludedShots", exRows.join("\n"));
        }
        if (unRows.length > 0) {
            CsTags.set(anchor0, "UnplacedShots", unRows.join("\n"));
        }
    }

    di.applyOperation(op);

    // excludeFromPlot legs persist on CTRL-HIDDEN with the same tags
    // as visible legs. That layer is OFF, and adds to an off layer
    // silently fail in this build -- withLayerOn flips it on around
    // this one operation and back off after (see CsLayers.OFF).
    var hiddenDrawn = 0;
    if (hiddenLegs.length > 0) {
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_HIDDEN, function() {
            var hop = new RAddObjectsOperation();
            hop.setText("Draw hidden survey legs");
            for (var hi = 0; hi < hiddenLegs.length; hi++) {
                var hLeg = hiddenLegs[hi];
                CsDraw.shotLine(doc, hop, at(hLeg.from), at(hLeg.to),
                    hLeg.from, hLeg.to, CsLayers.CTRL_HIDDEN,
                    legTags(hLeg.shot));
                hiddenDrawn++;
            }
            di.applyOperation(hop);
        });
    }

    // The AS-SURVEYED ghost. When `resolved` came from CsAdjust and
    // something was actually adjusted, `raw` holds the pre-adjustment
    // network -- draw it grey and dashed on CTRL-RAW so that switching
    // that layer on shows exactly what the adjustment moved and by how
    // much. This is the "shown" half of "adjustment shown and
    // reversible". The reversible half needs no code at all: the raw
    // readings live in XDATA and were never touched, so redrawing with
    // adjustment off reproduces the as-surveyed drawing exactly.
    //
    // No raw means no ghost, and that is not a degenerate case -- it is
    // adjustment off, or a solve that did not converge. The drawn
    // geometry then already IS the as-surveyed geometry, and a ghost
    // lying exactly on top of it would be noise.
    //
    // The ghost rides the SAME offX/offY the drawn stations got, never
    // an offset recomputed from the raw coordinates. Raw and adjusted
    // are two positions in one frame, so one rigid offset keeps them
    // registered; a raw-derived offset would pin the ghost's origin
    // station on top of its drawn point and hide whatever the
    // adjustment did to that station.
    //
    // The ghost carries RawShot / RawStation and NOTHING else -- no
    // Shot, no Station, none of the v3 data tags. Everything that
    // reads a drawing back keys on those: CsRevise.surveyFromDocument
    // would ingest a tagged ghost as a duplicate shot,
    // CsBind.stationIndex would offer a phantom for linework to snap
    // to, and eraseStations' leg rule would half-own it. A ghost
    // answering to those names would put two positions -- adjusted and
    // as-surveyed -- under one name.
    var ghostDrawn = 0;
    var rawResolved = (resolved.raw === undefined || resolved.raw === null) ?
        null : resolved.raw;
    if (rawResolved !== null && rawResolved.stations !== undefined &&
            rawResolved.stations !== null) {
        // CTRL-RAW is deliberately NOT in ensureSurveyLayers: like
        // TEXT-NOTES and the wall layers above, it is created by the
        // drawing that needs it rather than added to every survey. And
        // it is created OFF (CsLayers.OFF), which is why every add
        // below sits inside withLayerOn -- this build's
        // RAddObjectsOperation drops adds to an off layer without a
        // word, so getting this wrong yields no geometry and no error.
        CsLayers.ensure(doc, di, CsLayers.CTRL_RAW);
        var rawLegs = rawResolved.legs || [];
        var rawAt = function(stationName) {
            var rst = rawResolved.stations[stationName];
            return new RVector(rst.x + offX, rst.y + offY);
        };
        CsLayers.withLayerOn(doc, di, CsLayers.CTRL_RAW, function() {
            var gop = new RAddObjectsOperation();
            gop.setText("Draw as-surveyed ghost");
            for (var gi = 0; gi < rawLegs.length; gi++) {
                var gLeg = rawLegs[gi];
                if (gLeg.shot.excludeFromPlot) {
                    // these draw on CTRL-HIDDEN, itself off: ghosting
                    // them would only add a second invisible copy
                    continue;
                }
                if (!rawResolved.stations.hasOwnProperty(gLeg.from) ||
                        !rawResolved.stations.hasOwnProperty(gLeg.to)) {
                    continue;
                }
                CsDraw.addLine(doc, gop, CsLayers.CTRL_RAW,
                    rawAt(gLeg.from), rawAt(gLeg.to),
                    "RawShot", gLeg.from + "->" + gLeg.to);
                ghostDrawn++;
            }
            for (var gName in rawResolved.stations) {
                if (!rawResolved.stations.hasOwnProperty(gName)) {
                    continue;
                }
                // same shape a splay tip takes: tag the point, THEN add
                var gPt = CsDraw.addPoint(doc, gop, CsLayers.CTRL_RAW,
                    rawAt(gName));
                CsTags.set(gPt, "RawStation", gName);
                gop.addObject(gPt, false);
            }
            di.applyOperation(gop);
        });
    }

    CsStore.migrate(doc, di); // convert + drop a legacy store, if any

    // The extended elevation is a PRODUCT of drawing, not a command to
    // remember: every notebook Draw, import and revision redraw
    // refreshes the sibling profile file. Gated by CaveSurvey/
    // ProfileAuto (default true). Wrapped whole: a profile that cannot
    // be written must never take the plan draw down with it -- the plan
    // is the drawing the user is looking at, and everything above this
    // point has already committed real geometry to it.
    //
    // A PARTIAL draw builds it from the WHOLE cave (options.profileSurvey
    // / profileResolved), never from the page: the elevation is a
    // whole-cave product, and rebuilding it from one page would erase
    // every other band. A partial caller that supplies neither falls
    // back to its own page, which is only correct when the page is all
    // there is -- so callers pass them.
    var profileOutcome = { skipped: true, reason: "profile pass not run" };
    var profileSurvey = (options.profileSurvey === undefined ||
        options.profileSurvey === null) ? survey : options.profileSurvey;
    var profileResolved = (options.profileResolved === undefined ||
        options.profileResolved === null) ? resolved :
        options.profileResolved;
    try {
        profileOutcome = CsDraw.profile(doc, di, profileSurvey,
            profileResolved);
    } catch (eProfile) {
        // Building the reason string is ITSELF not safe to trust: string
        // concatenation calls eProfile.toString(), and an exception whose
        // own toString() throws (a hostile or merely buggy object thrown
        // from somewhere deep in the profile pass) would propagate straight
        // out of this catch and out of CsDraw.survey with it -- exactly
        // the "the profile pass can never take the plan draw down" promise
        // this whole try/catch exists to keep, broken by the one line
        // meant to report the failure. Set a safe default FIRST, then try
        // to improve it; a second failure trying to describe the first
        // one is swallowed rather than allowed to escape in its place.
        profileOutcome = { skipped: true, reason: "profile pass failed" };
        try {
            profileOutcome.reason = "profile pass failed: " + eProfile;
        } catch (eStr) {
            // eProfile.toString() itself threw -- the reason set above
            // stands; a description of the failure is a nicety, not a
            // requirement the plan draw can be allowed to fail over
        }
    }

    // ELEVATION LABELS ARE RE-DERIVED ON EVERY DRAW.
    //
    // An elevation label is a snapshot of the floor at one point at one
    // moment. Correct a reading, add a D that was missing, re-close a
    // loop -- and the number on the map is now a lie still sitting there
    // looking authoritative. Each callout stores the leg and the fraction
    // along it that it was sampled at, so the answer is simply asked
    // again.
    //
    // Here rather than in the notebook because EVERY draw path runs
    // through this function -- SurveyNotebook twice, CsRebuild,
    // ImportCaveSurvey and CsRevise -- so one hook covers all five
    // instead of the one that happened to get mentioned.
    //
    // It re-reads the survey FROM THE DRAWING rather than reusing the
    // one passed in, and that is not laziness. SurveyNotebook draws ONE
    // PAGE at a time, so `survey` and `resolved` here can hold a single
    // page's stations -- refreshing against them reported every label on
    // another page as lost, and re-derived this page's labels against a
    // partial network where a boundary label could lose its D. The
    // second resolve is the price of a correct answer.
    //
    // SOFT dependency, the same typeof idiom CsBind uses for CsRevise:
    // Core must not hard-require a tool folder, and a build without the
    // callout tools still has to draw a map.
    var elevationRefresh = null;
    if (typeof CalloutWrite !== "undefined" &&
            typeof CalloutWrite.refreshElevationsFromDocument === "function") {
        try {
            elevationRefresh =
                CalloutWrite.refreshElevationsFromDocument(doc, di);
        } catch (eElev) {
            // A map must still draw even if the labels cannot be
            // refreshed. Reported as null rather than pretended.
            elevationRefresh = null;
        }
    }

    // THE ALIGNED SCANS FOLLOW THE SURVEY. Correct a bad azimuth and
    // every station downstream of it moves; a scan fitted to those
    // stations would otherwise stay exactly where it was put, which
    // looks like the scan warping and is really the scan being left
    // behind. Its anchors are pixels on the paper, which do not move,
    // so it is simply re-fitted. A scan already on its stations is left
    // untouched -- a redraw that changed nothing must not churn every
    // scan in the drawing.
    var scanRefresh = null;
    if (typeof CsScanReanchor !== "undefined") {
        try {
            scanRefresh = CsScanReanchor.run(doc, di);
            if (scanBackfill > 0 && scanRefresh !== null) {
                scanRefresh.backfilled = scanBackfill;
            }
        } catch (eScans) {
            scanRefresh = null;
        }
    }

    // The cross sections, on the same terms and for the same reasons as
    // the elevation labels above: soft dependency, re-read from the
    // drawing, and a failure here must never take the map down.
    var sectionRefresh = null;
    if (typeof CalloutWrite !== "undefined" &&
            typeof CalloutWrite.refreshSectionsFromDocument === "function") {
        try {
            sectionRefresh =
                CalloutWrite.refreshSectionsFromDocument(doc, di);
        } catch (eSection) {
            sectionRefresh = null;
        }
    }

    return {
        stationsDrawn: stationsDrawn,
        // Labels the draw generated for the pitches it found. Counted
        // and returned rather than left implicit: a pit map whose
        // deepest feature drew as a numbered dot is what this exists
        // to prevent, and a caller reporting to the user should be
        // able to say it happened.
        pitchesDrawn: pitchesDrawn,
        shotsDrawn: shotsDrawn,
        closuresDrawn: closuresDrawn,
        tiesDrawn: tiesDrawn,
        hiddenDrawn: hiddenDrawn,
        wallsDrawn: wallsDrawn,
        splaysDrawn: splaysDrawn,
        ghostDrawn: ghostDrawn,
        // splays with no usable distance/azimuth/inclination -- named
        // apart from `skipped` below, which means "excluded, or never
        // connected": an unmeasurable splay's station DID connect, so
        // folding it into that bucket would misreport why it is
        // missing from the drawing
        splaysSkipped: splaysSkipped,
        // same distinction for the LRUD-derived wall runs: a splay
        // that contributed no ceiling/floor point because it had
        // nothing usable to offer, as counted by CsLrud.wallRuns
        wallPointsSkipped: wallPointsSkipped,
        // splays that DID draw no longer count as skipped, and neither
        // do the ones skipped for being unmeasurable -- they have
        // their own, more honest count just above
        skipped: resolved.skipped.length - splaysDrawn - splaysSkipped,
        // {skipped, reason} or {path, created, counts, profile} -- see
        // CsDraw.profile. A NEW key on an object every existing caller
        // already reads by name (CsRebuild.js,
        // ImportCaveSurvey.js, SurveyNotebook.js, CsRevise.js): none of
        // them destructure this return value positionally or iterate
        // its keys, so an additional one is additive, not breaking.
        profile: profileOutcome,
        // {updated, upgraded, downgraded, lost, unchanged} from
        // re-deriving elevation callouts, or null if the callout tools
        // are not loaded. Additive: no existing caller iterates these
        // keys or reads them positionally.
        elevations: elevationRefresh,
        // {updated, unchanged, frozen, lost, refused} from re-deriving
        // the cross sections, or null when the callout tools are not
        // loaded. Additive, like `elevations` before it -- and PRINTED
        // by CsReport: this suite's recurring defect is a value computed
        // and then surfaced to nobody.
        sections: sectionRefresh,
        // {moved, matched, stale, refused, missing} from re-fitting the
        // aligned scans. Printed by CsReport for the same reason.
        scans: scanRefresh
    };
};

/**
 * Refreshes the sibling extended elevation for the CURRENT drawing.
 *
 * Everything document-shaped happens here; the geometry is CsProfile's
 * and the drawing is CsProfileDraw's. The one thing this function owns
 * is the decision about WHERE: an already-open profile tab is drawn
 * into directly (so the user's own view updates and their undo still
 * works), and otherwise the file is built off screen and revealed.
 *
 * GATED ON THE SURVEY'S TOTAL STATION COUNT, WITH THE LARGEST SINGLE RUN
 * COMPUTED AND NAMED ALONGSIDE IT. CsProfile.settings().maxStations
 * (CaveSurvey/ProfileAutoMaxStations, default 3000) is compared against
 * the total, via a plain CsProfile.groupRuns() pass -- see CsProfile.
 * settings' own docblock for the full measurement, but in short: an
 * earlier draft of this gate checked the largest run ALONE, on the
 * theory that CsProfile.longestChain's chain search (quadratic in one
 * run's length) was the cost worth avoiding. Measured on CaveCAD: a
 * survey chopped into thirty 150-station named runs -- the "one letter
 * per trip" shape a real cave actually takes -- sailed through that gate
 * (no run anywhere near the limit) while costing WITHIN A FEW PERCENT of
 * what one single 4500-station run costs to build, because the cost is
 * governed by the TOTAL station count, not by O(run length^2). A
 * largest-run-only gate measured the wrong denominator: it let the
 * expensive many-run shape through and did nothing extra to catch it.
 * See the comment on the comparison itself, below, for why the fix
 * checks the total ALONE rather than "largest run OR total" -- the two
 * are not independent conditions once they share a threshold.
 * groupRuns() itself is a sort, not a chain search or a per-pair leg
 * lookup, so computing both numbers here costs nothing close to what a
 * skip avoids. The manual GenerateProfile command (Task 10) is never
 * gated by this.
 *
 * WHAT THE DOMINANT TERM IS, AS OF THE LEG INDEX. That "within a few
 * percent" measurement was originally explained by CsProfile.legBetween
 * scanning all of resolved.legs on every chain step -- O(total stations
 * x total legs). CsProfile.legIndex now makes each of those a
 * one-bucket lookup: 20.2 million leg comparisons down to ~4,500 on a
 * 4500-station survey, and a build 40-46% faster across every shape
 * measured. The gate's own conclusion is UNCHANGED, and so is its
 * threshold: the total still governs, because the remaining dominant
 * term -- CsProfile.bandWallRuns, through CsModel.lrudForStation's own
 * full scan of survey.shots once per station per band -- has exactly
 * the same O(total stations x total shots) shape one function over. At
 * the 3000 default the automatic pass measures about half a second on
 * CaveCAD (was about nine tenths); 4500 would be ~1.25s and 8000 ~4.3s
 * on every single draw, which is why the default was reconsidered on
 * these numbers and deliberately LEFT at 3000. CsProfile.settings' own
 * docblock carries the whole table, the per-function split, and the
 * scratch measurement of the change that would earn a higher ceiling.
 *
 * Draws into the document it is GIVEN -- CsDraw.survey passes down the
 * one it was handed, rather than this reaching for the active drawing.
 *
 * \return {skipped, reason} or {path, created, counts, profile}
 */
CsDraw.profile = function(doc, di, survey, resolved) {
    var settings = CsProfile.settings();
    if (!settings.auto) {
        return { skipped: true,
            reason: "CaveSurvey/ProfileAuto is off" };
    }

    var grouped = CsProfile.groupRuns(resolved);
    var largestRun = 0;
    var totalStations = 0;
    for (var gi = 0; gi < grouped.order.length; gi++) {
        var runLen = grouped.runs[grouped.order[gi]].stations.length;
        totalStations += runLen;
        if (runLen > largestRun) {
            largestRun = runLen;
        }
    }
    // THE CONDITION CHECKS totalStations ALONE, DELIBERATELY, even
    // though both numbers are computed and both are named in the
    // message below. totalStations is the sum of every run's own
    // length, so totalStations >= largestRun ALWAYS (one or more
    // non-negative addends can never sum to less than their own
    // maximum) -- an "or largestRun > settings.maxStations" clause here
    // could therefore never independently trip this gate: whenever it
    // would, the total clause already has, at the identical threshold.
    // That is not an oversight; it is why there is only one comparison
    // to write. largestRun is still computed and still named in the
    // reason string below, because it is genuinely useful DIAGNOSTIC
    // information (a surveyor reading "4500 stations across 1 run" vs.
    // "4500 stations across 30 runs (largest 150)" learns something
    // real about their own data either way), just not a SEPARATE gating
    // condition -- see CsProfile.settings' own docblock for the
    // measurement this replaces (a largest-run-only gate that let a
    // many-small-runs survey costing the same as one big run straight
    // through).
    if (totalStations > settings.maxStations) {
        return { skipped: true,
            reason: "the survey has " + totalStations + " station" +
                (totalStations === 1 ? "" : "s") + " across " +
                grouped.order.length + " run" +
                (grouped.order.length === 1 ? "" : "s") +
                " (largest run " + largestRun + "), over " +
                "CaveSurvey/ProfileAutoMaxStations (" +
                settings.maxStations + ") -- run GenerateProfile by " +
                "hand to build the profile anyway" };
    }

    return CsDraw.profileNow(doc, di, survey, resolved, settings);
};

/**
 * The post-gate half of CsDraw.profile, factored out so the manual
 * GenerateProfile command can share it byte-for-byte instead of
 * maintaining its own copy. BOTH of CsDraw.profile's gates (auto
 * switch, size) run BEFORE this function is ever called -- Generate
 * Profile bypasses both on purpose (that is the whole point of a manual
 * command), so this is exactly the part there was ever anything to
 * share: build, and draw.
 *
 * DRAWS INTO THE DOCUMENT IT IS GIVEN. The elevation used to live in a
 * sibling -PROFILE.dxf file, which meant an unsaved drawing had nowhere
 * to put it, the two files could disagree about the same cave, and the
 * Survey Notebook -- which reads the drawing it is opened on -- could
 * not edit a survey it found only in the plan. One drawing holds one
 * survey model now; the elevation is a REGION of it, placed below the
 * plan and kept in its own layer frame (CsLayers.frameOf). There is no
 * sibling path to resolve, nothing to commit, and no second tab to
 * reveal -- so the refusals that were about those are gone too, rather
 * than reworded.
 *
 * Takes `doc` and `di` EXPLICITLY: the manual tool already has both in
 * hand, so this never assumes there is a global "current" document.
 *
 * \param settings CsProfile.settings() already read by the caller
 *                 (both gates in CsDraw.profile need it before this
 *                 point, and the manual tool reads it once for the same
 *                 fields, so neither caller should read it twice)
 * \return {skipped, reason} or {counts, profile}
 */
CsDraw.profileNow = function(doc, di, survey, resolved, settings) {
    var built = CsProfile.build(survey, resolved, {
        exaggeration: settings.exaggeration,
        flatSplayDeg: settings.flatSplayDeg,
        // Passed through only when the CALLER named one. Absent,
        // CsProfile.build reads the setting itself, which is what the
        // automatic pass wants; a command that just ASKED the caver
        // which elevation they want hands the answer straight in
        // rather than writing the setting and hoping it is read back.
        mode: settings.mode,
        azimuth: settings.azimuth,
        // WHERE THE CHUNKS ALREADY ARE. Read off the drawing before
        // anything is erased, so a redraw lands the pieces back where
        // the caver arranged them rather than reflowing them into the
        // preset's row. Harmless and empty for the other two modes,
        // which have no chunks to place.
        offsets: CsProfileDraw.chunkOffsets(doc)
    });
    var counts = CsProfileDraw.render(doc, di, built, {});
    return { counts: counts, profile: built };
};

/**
 * Deletes everything previously drawn FOR the given stations: their
 * points, labels, LRUD ticks/tips/notes, and shot lines whose BOTH
 * ends are in the set (a tie-in shot from an older survey keeps its
 * line). Its own operation. Entities drawn by pre-tagging builds
 * cannot be found and survive.
 *
 * Ghost geometry on CTRL-RAW goes with its stations too, on either end
 * rather than both -- see the RawShot rule for why the ghost's rule
 * differs from the real leg's.
 *
 * NEVER deletes traced linework (CsBind's LineworkTrip /
 * LineworkStations), whatever else that entity carries -- see the
 * guard at the top of the scan.
 *
 * Off layers (CTRL-HIDDEN, CTRL-RAW) are switched on around the delete:
 * this build refuses deletes there just as it refuses adds, so without
 * that the entities survive and a redraw doubles them.
 *
 * \param di Optional RDocumentInterface for `doc`. Only the off-layer
 *           delete path needs one; omitted, it falls back to the
 *           GUI's active interface, which is right for every caller
 *           whose doc IS the active drawing and wrong for any other.
 * \return number of entities removed
 */
CsDraw.eraseStations = function(doc, stationNames, di) {
    // Keep the last saved version beside the drawing BEFORE removing
    // anything. A redraw is erase-then-draw across two operations, and a
    // draw that fails after this has landed leaves the drawing gutted --
    // that destroyed a real survey with nothing to fall back on. Never
    // throws, skipped inside Google Drive; see CsBackup.
    try {
        if (typeof CsBackup !== "undefined") {
            CsBackup.beforeWrite(doc.getFileName());
        }
    } catch (eBak) {
        // a backup is protection, never a precondition for drawing
    }
    CsStore.ensureLoaded(doc);
    var inSet = {};
    for (var i = 0; i < stationNames.length; i++) {
        inSet[stationNames[i]] = true;
    }
    // LRUD tip names are <station>.L / .R / .L2 ...; splay names are
    // <station>.<n> (older files tagged the bare station). Both
    // strippers live in CsBind now, so the erase rules and the linework
    // binding index cannot disagree about which station "A3.L2"
    // belongs to -- a disagreement is exactly how a tip point gets
    // orphaned by a redraw.
    var baseOf = CsBind.lrudBase;
    var splayBaseOf = CsBind.splayBase;

    var op = new RAddObjectsOperation();
    op.setText("Replace survey marks");
    var removed = 0;
    var offLayers = [];      // off layers the kill list touches
    var offLayerSeen = {};   // layer name -> is it off (asked once)
    var ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // TRACED LINEWORK IS NEVER ERASED. The rules below delete
        // generated geometry so a redraw can replace it -- wall runs
        // included, keyed on WallRunStations. Those are OURS: we can
        // regenerate them from the survey at any time. Linework
        // carrying LineworkTrip / LineworkStations is the USER's hours
        // of tracing, and deleting it is unrecoverable -- there is
        // nothing to regenerate it from. So linework is skipped
        // outright, BEFORE any rule can match it, rather than merely
        // not being named by them: a future edit that "tidies"
        // LineworkStations in alongside WallRunStations has to delete
        // this block to do it, and the test that pins this behavior
        // will catch that.
        if (CsBind.hasLineworkTags(e)) {
            continue;
        }
        var kill = false;
        var v;
        v = CsTags.get(e, "Station");
        if (v !== "" && inSet[v] === true) { kill = true; }
        if (!kill) {
            v = CsTags.get(e, "StationLabel");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDName");
            if (v !== "" && inSet[baseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDLine");
            if (v !== "" && inSet[baseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "LRUDNote");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "Splay");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "SplayName");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "SplayLabel");
            if (v !== "" && inSet[splayBaseOf(v)] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "NoteLabel");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "NoteLeader");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        // A pitch label belongs to the station the pitch hangs from,
        // and dies with it. Its own tags rather than NoteLabel's: a
        // pit head often carries both, and one pair of tags for two
        // labels would have each erase finding the other's half.
        if (!kill) {
            v = CsTags.get(e, "PitchLabel");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "PitchLeader");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "Shot");
            if (v !== "") {
                var ends = v.split("->");
                if (ends.length === 2 && inSet[ends[0]] === true &&
                    inSet[ends[1]] === true) {
                    kill = true;
                }
            }
        }
        if (!kill) {
            // wall runs die when ANY of their stations is redrawn --
            // the redraw regenerates them from the fresh survey
            v = CsTags.get(e, "WallRunStations");
            if (v !== "") {
                var wallNames = v.split("|");
                for (var wi = 0; wi < wallNames.length; wi++) {
                    if (inSet[wallNames[wi]] === true) {
                        kill = true;
                        break;
                    }
                }
            }
        }
        // The as-surveyed ghost on CTRL-RAW. These rules are LAST on
        // purpose: the traced-linework guard at the top of the scan
        // still runs before any of them, so an entity carrying the
        // user's LineworkTrip / LineworkStations is never reached here
        // however it came to be tagged RawShot or RawStation.
        if (!kill) {
            v = CsTags.get(e, "RawStation");
            if (v !== "" && inSet[v] === true) { kill = true; }
        }
        if (!kill) {
            v = CsTags.get(e, "RawShot");
            if (v !== "") {
                // "A1->A2", and EITHER end being replaced replaces the
                // ghost leg -- deliberately not the both-ends rule the
                // real leg lines follow above. A real leg spanning an
                // erased and a kept station is the drawing's only
                // record of that shot, so it has to survive. A ghost
                // leg carries no data at all: it is a picture of where
                // two stations were surveyed, and the redraw
                // regenerates it from the whole reconstructed survey.
                // Keeping it would leave a line pointing at a
                // coordinate that just moved, and then a duplicate
                // beside the fresh one.
                var rawEnds = v.split("->");
                if (inSet[rawEnds[0]] === true ||
                        inSet[rawEnds[rawEnds.length - 1]] === true) {
                    kill = true;
                }
            }
        }
        if (kill) {
            op.deleteObject(e);
            removed++;
            // Which OFF layers this delete has to reach. A DELETE is
            // refused on an off layer exactly as an add is -- the
            // engine says "RTransaction::deleteObject: entity not
            // editable (locked or hidden layer)", drops that object,
            // and lets the rest of the operation land. The entity then
            // survives a redraw that draws a second copy beside it.
            // Collected generically rather than by naming CTRL-RAW and
            // CTRL-HIDDEN, so a future off layer needs no edit here.
            //
            // Locked layers are NOT unlocked: a lock is something the
            // surveyor did on purpose, and quietly working around it to
            // delete their entities is not ours to do. Such an entity
            // survives the erase, which is the honest outcome.
            try {
                var kLayer = doc.getLayerName(e.getLayerId());
                if (offLayerSeen[kLayer] === undefined) {
                    var kl = doc.queryLayer(kLayer);
                    // refusesEdits, not isOff: FROZEN refuses a delete
                    // just as off does, and testing only off left the
                    // ghost on a frozen CTRL-RAW undeleted -- one more
                    // copy on every redraw, and one "Transaction failed"
                    // naming nothing.
                    offLayerSeen[kLayer] = CsLayers.refusesEdits(kl);
                    if (offLayerSeen[kLayer]) {
                        offLayers.push(kLayer);
                    }
                }
            } catch (eLayer) {
                // unreadable layer: the delete simply takes its chances
            }
        }
    }
    if (removed > 0) {
        // Same rule as CsDraw.survey: the interface for the document
        // we were HANDED, not for whatever is active. Optional, so the
        // existing callers that only have a doc still work.
        var di2 = di;
        if (di2 === undefined || di2 === null) {
            di2 = getDocumentInterface();
        }
        // Switch every off layer the kill list touches on around the
        // ONE delete operation, then let withLayerOn put each back.
        // Built inside out so the operation runs with all of them on at
        // once: one operation is still one undo step.
        var applyDeletes = function() {
            di2.applyOperation(op);
        };
        for (var oi = 0; oi < offLayers.length; oi++) {
            applyDeletes = (function(layerName, inner) {
                return function() {
                    CsLayers.withLayerOn(doc, di2, layerName, inner);
                };
            })(offLayers[oi], applyDeletes);
        }
        applyDeletes();
        CsStore.migrate(doc, di2);
    }
    return removed;
};

/**
 * Zooms the focused view to a just-drawn survey's extents -- not
 * autoZoom, which fits ALL entities and leaves a fresh survey a speck
 * beside a template's border. Falls back to autoZoom, then to nothing.
 */
CsDraw.zoomToSurvey = function(survey, resolved) {
    try {
        var minX = null, minY = null, maxX = null, maxY = null;
        for (var name in resolved.stations) {
            if (!resolved.stations.hasOwnProperty(name)) {
                continue;
            }
            var st = resolved.stations[name];
            if (minX === null || st.x < minX) { minX = st.x; }
            if (maxX === null || st.x > maxX) { maxX = st.x; }
            if (minY === null || st.y < minY) { minY = st.y; }
            if (maxY === null || st.y > maxY) { maxY = st.y; }
        }
        if (minX === null) {
            autoZoom();
            return;
        }
        var reach = 0;
        for (var i = 0; i < survey.shots.length; i++) {
            var sh = survey.shots[i];
            var vals = [sh.left, sh.right];
            for (var k = 0; k < vals.length; k++) {
                if (vals[k] !== null && vals[k] !== undefined &&
                    vals[k] > reach) {
                    reach = vals[k];
                }
            }
        }
        var pad = reach + Math.max((maxX - minX), (maxY - minY)) * 0.05 + 1;
        var box = new RBox(new RVector(minX - pad, minY - pad),
            new RVector(maxX + pad, maxY + pad));
        var view = getDocumentInterface().getLastKnownViewWithFocus();
        view.zoomTo(box, 10);
    } catch (e) {
        try {
            autoZoom();
        } catch (e2) {
            // zoom is a nicety
        }
    }
};
