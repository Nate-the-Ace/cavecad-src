// CsScanReanchor.js -- keeping aligned scans on the survey when the
// survey moves.
//
// Part of the Cave Survey Core library. QCAD context: takes the
// document and interface explicitly.
//
// THE PROBLEM. A scan is fitted to stations as they stand. Correct a
// bad azimuth in the notebook and redraw, and every station downstream
// of that shot moves -- while the scan stays exactly where it was put.
// It has not warped; it has been left behind, which looks the same on
// screen and is a different fault entirely. Revisions never touched
// scans: CTRL-SCAN is CTRL- prefixed, so CsBind.isLineworkLayer
// excludes it and CsRevise.moveLinework never sees it.
//
// WHAT MAKES THE FIX POSSIBLE. Sketch Scans records each station's pick
// in the SCAN'S OWN PIXELS (the ScanAnchors tag). A pixel on the paper
// does not move when the survey does, so the scan can simply be
// re-fitted: same picks, new station positions.
//
// SCANS PLACED BEFORE ANCHORS EXISTED are not lost. They carry the
// station NAMES they were aligned to, and while a scan still matches
// the survey its pixels can be read back out of it -- mapToImage of
// each station's current position. So the anchors are BACKFILLED
// before a draw moves anything, and only while placement and survey
// still agree. Backfilling after the move would record the wrong
// pixels and make the error permanent.

var CsScanReanchor = {};

/** The tag Sketch Scans writes its picks under. */
CsScanReanchor.TAG = "ScanAnchors";

/** How far a station may sit from where its anchor predicts before the
 *  scan counts as no longer matching the survey. Generous: a fit
 *  through four or more stations misses a little everywhere by
 *  construction, and that must not read as a mismatch. */
CsScanReanchor.TOLERANCE = 2.0;

/** Every aligned scan in the drawing: image entities carrying the
 *  SketchScan tag. QCAD only. */
CsScanReanchor.scans = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || !isImageEntity(e)) {
            continue;
        }
        if (CsTags.get(e, "SketchScan") === "") {
            continue;
        }
        out.push(e);
    }
    return out;
};

/** The frame one scan belongs to, from its own tag. */
CsScanReanchor.frameOf = function(image) {
    return CsScanFrame.normaliseKind(CsTags.get(image, CsScanFrame.TAG));
};

/** The band it was assigned within, or "" -- a hint, never trusted over
 *  the station names. */
CsScanReanchor.runOf = function(image) {
    return CsTags.get(image, CsScanFrame.KEY_TAG);
};

/** The places of one frame, cached per run so a drawing full of scans
 *  does not re-scan the entities once per scan. */
CsScanReanchor.placesFor = function(doc, cache, frame) {
    if (cache[frame] === undefined) {
        cache[frame] = CsScanFrame.placesIn(doc, frame);
    }
    return cache[frame];
};

/**
 * Give a legacy scan its anchors, read out of where it currently sits.
 *
 * MUST RUN BEFORE THE STATIONS MOVE. It converts each station's current
 * position into the scan's own pixels through the image's own
 * mapToImage, which is only the right answer while the scan and the
 * survey still agree.
 *
 * \return true when anchors were written
 */
CsScanReanchor.backfillOne = function(doc, op, image, places) {
    if (CsTags.get(image, CsScanReanchor.TAG) !== "") {
        return false;                       // already has them
    }
    var names = CsStationOrder.parseAssigned(
        CsTags.get(image, CsStationOrder.TAG));
    if (names.length < 2) {
        return false;                       // never aligned to stations
    }
    var run = CsScanReanchor.runOf(image);
    var anchors = [];
    for (var i = 0; i < names.length; i++) {
        var pos = CsScanFrame.placeOf(places, names[i], run);
        if (pos === null) {
            return false;                   // basis gone; nothing to read
        }
        var px = image.getData().mapToImage(new RVector(pos.x, pos.y));
        anchors.push({ name: names[i], u: px.x, v: px.y });
    }
    CsTags.set(image, CsScanReanchor.TAG,
        CsScanFit.serializeAnchors(anchors));
    op.addObject(image, false);
    return true;
};

/** Backfill every legacy scan. \return how many were given anchors. */
CsScanReanchor.backfill = function(doc, di) {
    if (isNull(doc) || isNull(di)) {
        return 0;
    }
    var scans = CsScanReanchor.scans(doc);
    if (scans.length === 0) {
        return 0;
    }
    var cache = {};
    var op = new RModifyObjectsOperation();
    op.setText("Record scan anchors");
    var n = 0;
    for (var i = 0; i < scans.length; i++) {
        try {
            // A SECTION IS CUT AT A PLAN STATION, not one of its own --
            // stationFrameFor redirects the lookup there rather than at
            // "SectionStation", a tag nothing writes. frameOf itself is
            // still the scan's own frame; only the STATION TABLE this
            // reads from is different -- the same redirect
            // SketchScans.stationsNow already makes for the picker.
            var places = CsScanReanchor.placesFor(doc, cache,
                CsScanFrame.stationFrameFor(CsScanReanchor.frameOf(scans[i])));
            if (CsScanReanchor.backfillOne(doc, op, scans[i], places)) {
                n++;
            }
        } catch (e) {
            // one unreadable scan must not stop the rest
        }
    }
    if (n > 0) {
        di.applyOperation(op);
    }
    return n;
};

/**
 * Re-fit every anchored scan to the stations as they stand now.
 *
 * \return {moved, matched, stale, refused, missing}
 *         matched -- already where its anchors say, left alone
 *         stale   -- its stations are gone from the survey
 *         refused -- the anchors no longer describe a fit
 */
CsScanReanchor.run = function(doc, di) {
    var out = { moved: 0, matched: 0, stale: 0, refused: 0, missing: [] };
    if (isNull(doc) || isNull(di)) {
        return out;
    }
    var scans = CsScanReanchor.scans(doc);
    if (scans.length === 0) {
        return out;
    }
    var cache = {};
    var op = new RModifyObjectsOperation();
    op.setText("Move scans with the survey");
    var any = false;

    for (var i = 0; i < scans.length; i++) {
        var image = scans[i];
        try {
            var anchors = CsScanFit.parseAnchors(
                CsTags.get(image, CsScanReanchor.TAG));
            if (anchors.length < 2) {
                continue;                   // not an aligned scan
            }
            // A SECTION IS CUT AT A PLAN STATION, not one of its own --
            // stationFrameFor redirects the lookup there rather than at
            // "SectionStation", a tag nothing writes. frameOf itself is
            // still the scan's own frame; only the STATION TABLE this
            // reads from is different -- the same redirect
            // SketchScans.stationsNow already makes for the picker.
            var places = CsScanReanchor.placesFor(doc, cache,
                CsScanFrame.stationFrameFor(CsScanReanchor.frameOf(image)));
            var run = CsScanReanchor.runOf(image);
            var pairs = [], gone = 0;
            for (var a = 0; a < anchors.length; a++) {
                var dest = CsScanFrame.placeOf(places, anchors[a].name, run);
                if (dest === null) {
                    gone++;
                    out.missing.push(anchors[a].name);
                    continue;
                }
                pairs.push({ name: anchors[a].name,
                             source: { x: anchors[a].u, y: anchors[a].v },
                             dest: dest });
            }
            if (pairs.length < 2) {
                out.stale++;
                continue;
            }
            // Already right? Read where the scan puts each anchor NOW,
            // through the image's own mapping, and leave it alone if it
            // is already on its stations. A redraw that changed nothing
            // must not churn every scan in the drawing.
            var worst = 0, d = image.getData();
            for (var q = 0; q < pairs.length; q++) {
                var at = d.mapFromImage(new RVector(pairs[q].source.x,
                    pairs[q].source.y));
                var ex = at.x - pairs[q].dest.x, ey = at.y - pairs[q].dest.y;
                var miss = Math.sqrt(ex * ex + ey * ey);
                if (miss > worst) { worst = miss; }
            }
            if (worst <= CsScanReanchor.TOLERANCE) {
                out.matched++;
                continue;
            }
            var fit = CsScanFit.fit(pairs);
            if (fit === null || CsScanFit.isMirrored(fit.matrix)) {
                // A mirrored re-fit means the survey moved in a way the
                // old picks cannot describe. Left where it is rather
                // than laid down backwards.
                out.refused++;
                continue;
            }
            var v = CsScanFit.imageVectors(fit.matrix);
            // RE-PLACING AN IMAGE GOES THROUGH PROPERTIES, not through
            // its data. Probed in this bridge: RImageEntity has no
            // setData at all; the entity forwards setInsertionPoint but
            // NOT setUVector/setVVector; and mutating the object
            // getData() hands back changes nothing, because it is a
            // copy. The property route is what AlignImage has always
            // used (applyAffineToImage) and it is the one that sticks.
            image.setProperty(RImageEntity.PropertyUX, v.u.x);
            image.setProperty(RImageEntity.PropertyUY, v.u.y);
            image.setProperty(RImageEntity.PropertyVX, v.v.x);
            image.setProperty(RImageEntity.PropertyVY, v.v.y);
            image.setInsertionPoint(new RVector(v.position.x, v.position.y));
            op.addObject(image, false);
            any = true;
            out.moved++;
        } catch (e) {
            out.refused++;
        }
    }
    if (any) {
        di.applyOperation(op);
    }
    return out;
};
