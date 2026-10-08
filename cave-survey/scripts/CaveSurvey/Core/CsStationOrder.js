// CsStationOrder.js
//
// The station walk order behind Align Image's "assume the next
// station" flow. The survey's own shot order IS the order stations get
// visited in: name sequence (B4 -> B5) walks straight past the tie-in
// where a branch run starts, while first-appearance order over the
// legs follows the notebook -- after B4 comes C1 exactly when the
// survey went there next. The survey comes from
// CsRevise.resolveAsDrawn (the drawing's own tags), which already
// merges shots into notebook order within each trip, trips in order.
//
// Pure -- no Q*/R* symbols -- so tests/js_unit.js runs all of it under
// node.

var CsStationOrder = {};

// The AlignedStations tag on a scan image: which stations already have
// an assigned point on that scan. CAPPED -- dxflib dies at 1024
// chars/line, so no unbounded tag, ever (the RevisionLog lesson).
CsStationOrder.TAG = "AlignedStations";
CsStationOrder.BUDGET = 800;

/**
 * Station names in first-appearance order over the survey's legs.
 * Splays are geometry, not stations, and are skipped whole -- their
 * empty/dotted "to" names must never enter the walk.
 */
CsStationOrder.walkOrder = function(survey) {
    var order = [];
    var seen = {};
    if (survey === null || survey === undefined ||
            survey.shots === undefined) {
        return order;
    }
    var note = function(name) {
        if (typeof name !== "string" || name === "") { return; }
        if (seen[name] === true) { return; }
        seen[name] = true;
        order.push(name);
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.splay === true) { continue; }
        note(s.from);
        note(s.to);
    }
    return order;
};

/**
 * The first station strictly after `lastName` in `order` that is not
 * already assigned and HAS a plotted point to aim at. `lastName` null
 * (or "") starts from the beginning of the walk; an unknown name, or a
 * walk that runs dry, answers null -- the caller falls back to the
 * manual prompt.
 */
CsStationOrder.nextUnassigned = function(order, lastName, usedSet, plotted) {
    var from = 0;
    if (typeof lastName === "string" && lastName !== "") {
        var at = -1;
        for (var i = 0; i < order.length; i++) {
            if (order[i] === lastName) { at = i; break; }
        }
        if (at === -1) { return null; }
        from = at + 1;
    }
    for (var k = from; k < order.length; k++) {
        var name = order[k];
        if (usedSet !== null && usedSet !== undefined &&
                usedSet[name] === true) {
            continue;
        }
        if (plotted === null || plotted === undefined ||
                plotted[name] !== true) {
            continue;
        }
        return name;
    }
    return null;
};

/** The AlignedStations tag value, parsed. Anything odd reads as []. */
/**
 * Compare two station names the way a caver reads them: A2 before A10,
 * not after it.
 *
 * Plain string order puts A10 between A1 and A2, which turns a picker
 * listing a trip's stations into a hunt. Names are compared in chunks
 * -- letters against letters, numbers against numbers as NUMBERS -- so
 * A9, A10, A11 and B1 land in the order they were surveyed in.
 *
 * Pure.
 */
CsStationOrder.naturalCompare = function(a, b) {
    var ax = String(a).match(/(\d+|\D+)/g) || [];
    var bx = String(b).match(/(\d+|\D+)/g) || [];
    for (var i = 0; i < Math.min(ax.length, bx.length); i++) {
        var an = parseInt(ax[i], 10), bn = parseInt(bx[i], 10);
        if (!isNaN(an) && !isNaN(bn)) {
            if (an !== bn) {
                return an - bn;
            }
        } else {
            var au = ax[i].toUpperCase(), bu = bx[i].toUpperCase();
            if (au !== bu) {
                return au < bu ? -1 : 1;
            }
        }
    }
    return ax.length - bx.length;
};

/**
 * Station names in the order a picker should offer them: NATURAL NAME
 * ORDER -- A1, A2, A9, A10, B1 -- so a name can be found by reading.
 *
 * NOT survey walk order, which was the first attempt and was wrong for
 * this job. The walk follows a branch to its tie-in, so a cave whose E
 * and F spurs hang off the middle of the D run lists
 * D13, E1, E2, D14 ... D22, F1, F2, D23. That is a true account of how
 * the cave was surveyed and useless for finding "D16" in a list of a
 * hundred: the eye expects the alphabet.
 *
 * `walk` is still accepted and ignored, so callers need not change.
 */
CsStationOrder.pickOrder = function(names, walk) {
    return names.slice().sort(CsStationOrder.naturalCompare);
};

CsStationOrder.parseAssigned = function(value) {
    if (typeof value !== "string" || value === "") { return []; }
    var out = [];
    var parts = value.split(",");
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] !== "") { out.push(parts[i]); }
    }
    return out;
};

/**
 * Serializes assigned names, newest last, under the budget. Overflow
 * drops the OLDEST names: they were aligned first and are the least
 * likely to be re-aligned, and the walk merely offers them again --
 * an offer is a prompt default, never data loss.
 */
CsStationOrder.serializeAssigned = function(names) {
    var keep = names.slice();
    var text = keep.join(",");
    while (text.length > CsStationOrder.BUDGET && keep.length > 0) {
        keep.shift();
        text = keep.join(",");
    }
    return text;
};
