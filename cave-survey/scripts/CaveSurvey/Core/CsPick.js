// Pick.js -- turning the current selection into a starting point.
//
// Part of the Cave Survey Core library. QCAD context only.

var CsPick = {};

/**
 * Derives a start point from the drawing's selection.
 *
 * A selected POINT is used directly; if it's a tagged station its
 * name comes along and no duplicate marker should be drawn there.
 * A selected line/arc/polyline offers a choice of its endpoints
 * (via getItem, using "|" as the separator because the labels
 * contain commas). Anything else returns undefined and the caller
 * falls back to typed coordinates.
 *
 * `elevation` is the picked entity's own Elevation tag -- the
 * drawing's vertical datum at that point -- or NULL when it carries
 * none. Null, not 0: an anchor z of 0 handed to CsNetwork.resolve is
 * an EXPLICIT instruction to put the survey on the drawing's origin,
 * and it beats a *fix, so a placeholder 0 here rebases an
 * absolute-datum cave (an entrance at 1250 ft) down to sea level. A
 * caller with no genuine elevation to supply must pass this straight
 * through and let resolve fall back to the anchored station's own
 * control. A line/arc endpoint never has one.
 *
 * \param title dialog title for the endpoint question
 * \return {pos, isExistingStation, existingName, elevation} or
 *         undefined
 */
CsPick.startPointFromSelection = function(doc, title) {
    if (!doc.hasSelection()) {
        return undefined;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        return undefined; // ambiguous -- let the caller ask
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        return undefined;
    }

    if (typeof entity.getPosition === "function") {
        return {
            pos: entity.getPosition(),
            isExistingStation: true,
            existingName: CsTags.get(entity, "Station"),
            elevation: CsTags.getNumber(entity, "Elevation")
        };
    }

    if (typeof entity.getStartPoint === "function" &&
        typeof entity.getEndPoint === "function") {
        var p1 = entity.getStartPoint();
        var p2 = entity.getEndPoint();
        var labels = [
            "Point 1: (" + p1.x.toFixed(3) + ", " + p1.y.toFixed(3) + ")",
            "Point 2: (" + p2.x.toFixed(3) + ", " + p2.y.toFixed(3) + ")"
        ];
        var choice = getItem(title,
            "Start from which endpoint of the selected entity?",
            labels.join("|"), 0, "|");
        if (choice === undefined) {
            return undefined;
        }
        return {
            pos: (choice.indexOf("Point 1") === 0) ? p1 : p2,
            isExistingStation: false,
            existingName: "",
            // a line endpoint is a coordinate, not a station: the
            // drawing records no elevation for it at all
            elevation: null
        };
    }

    return undefined;
};

/**
 * The single selected entity, or null (with a user-facing warning
 * naming the tool) when the selection isn't exactly one entity.
 */
CsPick.singleSelected = function(doc, toolName) {
    if (!doc.hasSelection()) {
        CsTell.warn(toolName + ": select exactly one entity first.");
        return null;
    }
    var ids = doc.querySelectedEntities();
    if (ids.length !== 1) {
        CsTell.warn(toolName + ": select exactly ONE entity (found " +
            ids.length + ").");
        return null;
    }
    var entity = doc.queryEntity(ids[0]);
    if (isNull(entity)) {
        CsTell.warn(toolName + ": could not read the selected entity.");
        return null;
    }
    return entity;
};
