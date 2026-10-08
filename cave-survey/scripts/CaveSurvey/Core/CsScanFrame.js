// CsScanFrame.js -- which view a scan belongs to, and what stations it
// can be aligned to.
//
// Part of the Cave Survey Core library. The vocabulary at the top is
// pure; everything taking a `doc` is QCAD-only and takes it explicitly.
//
// All three views live in ONE drawing -- the elevation is a region of
// the plan drawing and the sections sit with it -- so the frame is a
// CHOICE the caver makes on the Scan Shelf, recorded on the image as
// ScanFrame, and not something derivable from which file is open.
//
// WHY THE STATION TABLE IS SCOPED. Plan stations carry Station;
// elevation stations carry ProfileStation, a deliberately separate
// namespace so plan-side scanners can never mistake an elevation for a
// plan. Within the elevation a station appears once per BAND it ties
// into, so a name alone is not an address there -- which is why this
// answers a list of PLACES, each carrying its own position and run,
// rather than a name -> position map that would silently keep whichever
// band it read last.

var CsScanFrame = {};

CsScanFrame.KINDS = ["plan", "profile", "section"];

/** The tag an aligned scan carries to say which view it belongs to. */
CsScanFrame.TAG = "ScanFrame";
/** The band or section it was aligned within, where that matters. */
CsScanFrame.KEY_TAG = "ScanFrameKey";

/** A frame name from a tag or a combo, defaulting to plan. Never
 *  throws: this value comes off a drawing a user can edit. */
CsScanFrame.normaliseKind = function(kind) {
    if (kind === undefined || kind === null) {
        return "plan";
    }
    var name = String(kind).toLowerCase().replace(/^\s+|\s+$/g, "");
    for (var i = 0; i < CsScanFrame.KINDS.length; i++) {
        if (CsScanFrame.KINDS[i] === name) {
            return name;
        }
    }
    return "plan";
};

/** The scan layer for a frame -- the twin-layer split that keeps a
 *  profile sketch out of reach of a plan-scoped sweep. */
CsScanFrame.layerFor = function(kind) {
    switch (CsScanFrame.normaliseKind(kind)) {
    case "profile": return CsLayers.CTRL_PROFILE_SCAN;
    case "section": return CsLayers.CTRL_SECTION_SCAN;
    default:        return CsLayers.CTRL_SCAN;
    }
};

/** The XDATA tag that frame's station points carry. */
CsScanFrame.stationTagFor = function(kind) {
    switch (CsScanFrame.normaliseKind(kind)) {
    case "profile": return "ProfileStation";
    case "section": return "SectionStation";
    default:        return "Station";
    }
};

/**
 * The XDATA tag that frame's SPLAY TIPS carry, or null when the frame
 * plots none.
 *
 * SPLAY TIPS ARE ALIGNMENT TARGETS TOO, and on a sketch they are often
 * the only features a caver can identify with confidence: the middle of
 * a room carries no station, but its corners carry splays. ScanAlign's
 * own station table has offered them since it was written; this picker
 * did not, so the same wall hit was reachable from one alignment route
 * and invisible from the other.
 *
 * PLAN ONLY. A plan splay ends in a POINT tagged SplayName, which has a
 * position to align to. The elevation's near-horizontal splays are
 * drawn as a LINE tick (ProfileSplay) with no position of their own,
 * and nothing may read a tag whose geometry cannot answer where it is
 * -- the same rule that keeps SectionStation unread.
 */
CsScanFrame.splayTagFor = function(kind) {
    return CsScanFrame.normaliseKind(kind) === "plan" ? "SplayName" : null;
};

/** The tag carrying which band a frame's point belongs to, or null when
 *  the frame has no bands. */
CsScanFrame.runTagFor = function(kind) {
    return CsScanFrame.normaliseKind(kind) === "profile" ?
        "ProfileRun" : null;
};

/**
 * The frame whose station points a scan of this kind is picked against.
 *
 * NOT always the scan's own frame. A cross section is CUT AT a plan
 * station: the drawing has no section station points, and
 * stationTagFor("section") names a tag ("SectionStation") that nothing
 * in this suite writes. A picker built on that answers an empty list
 * and explains nothing, which is exactly how this would have shipped.
 *
 * SectionStation stays reserved for a frame that one day plots its own
 * station points. Until something writes it, nothing may read it.
 */
CsScanFrame.stationFrameFor = function(kind) {
    return CsScanFrame.normaliseKind(kind) === "profile" ?
        "profile" : "plan";
};

/**
 * How a place should read in the picker.
 *
 * A plan station is its own name. An elevation station is its name too
 * -- until the SAME name appears in more than one band, which happens
 * at every tie-in, and then it has to say which band or the caver is
 * choosing blind.
 *
 * \param counts name -> how many places carry that name
 * Pure.
 */
CsScanFrame.labelFor = function(name, run, counts) {
    if (run === null || run === undefined || run === "" ||
            counts === undefined || counts === null ||
            (counts[name] || 0) <= 1) {
        return name;
    }
    return name + " (" + run + ")";
};

/**
 * One place per station, from candidates that may contain the same
 * station twice.
 *
 * THE ELEVATION TAGS BOTH THE POINT AND ITS LABEL. CsProfileDraw writes
 * ProfileStation (and ProfileRun) onto the station point AND onto the
 * text label beside it -- deliberately, so every entity of a band
 * carries its run. Read naively that makes every station appear twice
 * in a picker, and worse: the label sits one and a half text heights
 * ABOVE the point, so whichever of the two is met first decides the
 * position, and a label winning that race shifts the whole fit.
 *
 * So a point beats a label, always. Ties are broken toward the first
 * seen, which keeps the answer stable between runs.
 *
 * \param candidates [{name, run, pos, isPoint}]
 * \return one entry per name+run, points preferred. Pure.
 */
CsScanFrame.dedupePlaces = function(candidates) {
    var byKey = {}, order = [];
    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        var key = c.name + "\u0000" + (c.run || "");
        if (!byKey.hasOwnProperty(key)) {
            byKey[key] = c;
            order.push(key);
        } else if (c.isPoint === true && byKey[key].isPoint !== true) {
            byKey[key] = c;          // the point outranks the label
        }
    }
    var out = [];
    for (var k = 0; k < order.length; k++) {
        out.push(byKey[order[k]]);
    }
    return out;
};

/**
 * Every place a scan in this frame could be aligned to.
 *
 * \return [{name, run, pos, label}] -- a LIST, not a map: in the
 *         elevation one name can be two places, and a map would keep
 *         whichever it read last without saying so. QCAD only.
 */
CsScanFrame.placesIn = function(doc, kind) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var frame = CsScanFrame.normaliseKind(kind);
    var tag = CsScanFrame.stationTagFor(frame);
    var splayTag = CsScanFrame.splayTagFor(frame);
    var runTag = CsScanFrame.runTagFor(frame);
    var candidates = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, tag);
        if (name === "" && splayTag !== null) {
            // A splay tip carries its own name ("A3.2"), which is never
            // a station name, so the two namespaces cannot collide in
            // the table below.
            name = CsTags.get(e, splayTag);
        }
        if (name === "") {
            continue;
        }
        var isPoint = false;
        try {
            isPoint = (e.getType() === RS.EntityPoint);
        } catch (eType) {
        }
        var run = (runTag === null) ? "" : CsTags.get(e, runTag);
        var p = e.getPosition();
        candidates.push({ name: name, run: run,
                          pos: { x: p.x, y: p.y }, isPoint: isPoint });
    }

    var found = CsScanFrame.dedupePlaces(candidates);
    // Counts AFTER the dedupe, or a station tagged twice would look
    // like a station in two bands and wear a qualifier it has not
    // earned.
    var counts = {};
    for (var c = 0; c < found.length; c++) {
        counts[found[c].name] = (counts[found[c].name] || 0) + 1;
    }
    for (var k = 0; k < found.length; k++) {
        found[k].label = CsScanFrame.labelFor(found[k].name, found[k].run,
            counts);
        out.push(found[k]);
    }
    return out;
};

/**
 * The place one anchor names, within a frame and (where it matters) a
 * band.
 *
 * The band is a HINT, not a requirement: a renamed run must not strand
 * a scan, so a name that matches nothing in the given band is looked
 * for across the frame before giving up.
 *
 * \return {x, y} or null
 */
CsScanFrame.placeOf = function(places, name, run) {
    var i;
    if (run !== null && run !== undefined && run !== "") {
        for (i = 0; i < places.length; i++) {
            if (places[i].name === name && places[i].run === run) {
                return places[i].pos;
            }
        }
    }
    for (i = 0; i < places.length; i++) {
        if (places[i].name === name) {
            return places[i].pos;
        }
    }
    return null;
};
