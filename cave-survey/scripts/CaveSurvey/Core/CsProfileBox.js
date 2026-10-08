// CsProfileBox.js -- reading the profile band bounding boxes back:
// which band, and which FRAME, owns a point in the drawing.
//
// Part of the Cave Survey Core library. This is step 2 of Nathan's
// bounding-box plan (2026-08-28): the boxes CsProfileDraw generates
// (locked layer CTRL-PROFILE-BOX, one per band, tag ProfileBox=<run>)
// let a drawing tool decide by LOCATION what a per-frame button or a
// panel combo used to decide by being pressed -- one Floor Ledge
// button serves both views, and Feature Trace can pick a stroke's run
// by where the stroke lies.
//
// The DERIVED region (CsTrace.profileRegion) stays as the fallback:
// a drawing whose profile predates the boxes answers frame questions
// the old way until its next redraw generates them.

var CsProfileBox = {};

/** A point inside a box, with a hair of tolerance: a stroke snapped
 *  exactly onto a box edge is inside the band, not outside the world. */
CsProfileBox.EDGE_EPS = 1e-6;

/**
 * Every band box in the drawing: [{key, minX, minY, maxX, maxY}].
 * Read from the tagged rectangle entities themselves -- the drawing is
 * the record. QCAD only.
 */
CsProfileBox.boxes = function(doc) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var key = CsTags.get(e, "ProfileBox");
        if (key === "") {
            continue;
        }
        try {
            e.update();   // a cached box after a region move is stale
            var bb = e.getBoundingBox();
            out.push({ key: key,
                minX: bb.getMinimum().x, minY: bb.getMinimum().y,
                maxX: bb.getMaximum().x, maxY: bb.getMaximum().y });
        } catch (eBox) {
            // an unreadable box answers nothing rather than wrongly
        }
    }
    return out;
};

/** True when the point is inside the box (edge counts as inside). */
CsProfileBox.contains = function(box, point) {
    var eps = CsProfileBox.EDGE_EPS;
    return point.x >= box.minX - eps && point.x <= box.maxX + eps &&
           point.y >= box.minY - eps && point.y <= box.maxY + eps;
};

/**
 * The band whose box contains the point, or null. Boxes are disjoint
 * by construction (CsProfileDraw.boxesFor), except when two bands'
 * content interleaves at true elevation -- there the FIRST match wins,
 * which is as honest as that geometry allows.
 */
CsProfileBox.at = function(boxes, point) {
    for (var i = 0; i < boxes.length; i++) {
        if (CsProfileBox.contains(boxes[i], point)) {
            return boxes[i].key;
        }
    }
    return null;
};

/**
 * The ONE run that owns a whole path, or null: every point inside the
 * same band's box. A path that wanders outside every box, or crosses
 * from one band's box into another's, answers null -- the caller falls
 * back to the shared (un-varianted) layer rather than guessing which
 * band the caver meant.
 */
CsProfileBox.runForPath = function(boxes, points) {
    if (isNull(points) || points.length === 0) {
        return null;
    }
    var run = null;
    for (var i = 0; i < points.length; i++) {
        var key = CsProfileBox.at(boxes, points[i]);
        if (key === null) {
            return null;
        }
        if (run === null) {
            run = key;
        } else if (run !== key) {
            return null;   // crossed into another band's box
        }
    }
    return run;
};

/**
 * "section", "plan" or "profile" for a point, by location. An open
 * section bay first, then the band boxes (the explicit record), then
 * the derived region as the fallback for drawings whose profile
 * predates the boxes.
 *
 * `region` is the caller's CACHED CsTrace.profileRegion(doc) box (or
 * null) and `bays` its CACHED CsTrace.sectionBays(doc) -- computing
 * either walks every entity, so this function never computes them
 * itself: the tools that ask per-stroke or per-selected-entity already
 * hold both.
 *
 * A BAY OUTRANKS A BAND BOX for the reason CsTrace.frameIn gives at
 * length: the bay is the explicit, short-lived record of where the
 * caver is sketching a section, and a bay is parked wherever they last
 * left it -- including, legitimately, on top of the elevation.
 *
 * QCAD only.
 */
CsProfileBox.frameAt = function(doc, region, point, bays) {
    if (CsTrace.inAnyRect(bays, point)) {
        return "section";
    }
    var boxes = CsProfileBox.boxes(doc);
    if (boxes.length > 0 && CsProfileBox.at(boxes, point) !== null) {
        return "profile";
    }
    if (boxes.length === 0 && !isNull(region)) {
        return CsTrace.frameIn(region, point);
    }
    // Boxes exist and the point is outside all of them: between-band
    // space in the region is still the profile's ground (annotations
    // live there), so the region still decides; only a drawing with no
    // region at all answers plan.
    if (!isNull(region)) {
        return CsTrace.frameIn(region, point);
    }
    return "plan";
};
