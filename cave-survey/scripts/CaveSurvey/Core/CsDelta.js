// CsDelta.js -- deciding when a Draw can redraw only the page.
//
// Survey Notebook's Draw has always redrawn the WHOLE cave: it erases
// every station the merged survey owns and puts them all back. That is
// the only correct thing to do when the survey MOVED -- a corrected
// declination, a re-closed loop, a fixed blunder all shift stations
// that are not on the page, and the linework traced against them has to
// follow.
//
// Most Draws are not that. Adding a trip that ties into one existing
// station and closes no new loop leaves every existing station exactly
// where it already was, and the whole-cave erase-and-redraw is pure
// cost -- measured at ~6 s on an 800-station cave, headless, before any
// repaint (docs/superpowers/specs/2026-09-04-incremental-notebook-draw-design.md).
//
// This module is the gate and the arithmetic behind the fast path. It
// is PURE -- no document, no QCAD symbols -- so the decision can be
// tested directly rather than inferred from what a drawing looks like
// afterwards.
//
// The rule it enforces: take the fast path only when the merged solve
// puts every already-drawn station exactly where the drawing already
// has it. Anything else -- one station off by more than the rigidity
// epsilon the rest of the suite uses, a missing anchor, a legacy
// drawing -- is the general case, and the general case is what Draw
// already did.

if (typeof CsDelta === "undefined") {
    var CsDelta = {};
}

/**
 * The stations that a merged solve would MOVE, out of those the
 * drawing already has.
 *
 * Compared at CsRevise.positionsMoved's own epsilon (1e-6 * extent) so
 * "did this Draw move the survey" has ONE answer across the suite: a
 * fast path that used a looser test than the linework mover would skip
 * a move the mover would have acted on, and leave traced walls behind.
 *
 * \param drawn    {name: {x, y}} -- CsRevise.stationPositions(doc)
 * \param stations {name: {x, y}} -- resolved.stations of the merged solve
 * \param extent   the drawing's extent (CsRevise.positionsExtent)
 * \return [name] in no particular order
 */
CsDelta.movedStations = function(drawn, stations, extent) {
    var e = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var eps = 1e-6 * Math.max(e, 1);
    var out = [];
    for (var name in drawn) {
        if (!drawn.hasOwnProperty(name) ||
                !stations.hasOwnProperty(name)) {
            continue;
        }
        var dx = stations[name].x - drawn[name].x;
        var dy = stations[name].y - drawn[name].y;
        if (Math.sqrt(dx * dx + dy * dy) > eps) {
            out.push(name);
        }
    }
    return out;
};

/**
 * A resolve result narrowed to one set of stations, so CsDraw.survey
 * draws those and only those -- at the positions the WHOLE cave's solve
 * gave them.
 *
 * This is what makes the fast path exact rather than approximate. The
 * alternative (re-resolving the page on its own, anchored at the
 * tie-in) agrees with the merged solve only while the page is a plain
 * tree extension; the moment an adjustment has anything to say, the two
 * diverge. Filtering cannot diverge: the numbers ARE the merged solve's
 * numbers.
 *
 * Legs are kept by TRIP, not by endpoint. The page's first shot runs
 * from a station an older trip drew into a station this page draws, so
 * an endpoint test either drops it (both-ends) or drags in every old
 * leg arriving at the tie-in station (either-end) and draws a second
 * copy of it on top of the one already there. The trip owns the leg;
 * the trip is what the erase and the redraw agree on.
 *
 * \param resolved the merged CsNetwork/CsAdjust result
 * \param names    [name] the stations to keep
 * \param tripId   keep only legs whose shot belongs to this trip; omit
 *                 (null/undefined) to keep legs with both ends in the set
 * \return a resolve-shaped object: same stations/legs/unresolved shape,
 *         `raw` filtered the same way when present, `summary` and
 *         `adjusted` carried through untouched (they describe the SOLVE,
 *         not the subset)
 */
CsDelta.subsetResolved = function(resolved, names, tripId) {
    var keep = {};
    for (var i = 0; i < names.length; i++) {
        keep[names[i]] = true;
    }
    var narrow = function(res) {
        if (res === null || res === undefined) {
            return null;
        }
        var out = { stations: {}, legs: [], unresolved: [] };
        var src = res.stations || {};
        for (var n in src) {
            if (src.hasOwnProperty(n) && keep[n] === true) {
                out.stations[n] = src[n];
            }
        }
        var byTrip = (tripId !== undefined && tripId !== null);
        var legs = res.legs || [];
        for (var li = 0; li < legs.length; li++) {
            var leg = legs[li];
            var take = byTrip ?
                ((leg.shot.trip || 0) === tripId) :
                (keep[leg.to] === true && keep[leg.from] === true);
            if (take) {
                out.legs.push(leg);
            }
        }
        var un = res.unresolved || [];
        for (var ui = 0; ui < un.length; ui++) {
            // An unplaced shot has no position to belong anywhere by;
            // it rides the trip-0 anchor's blob, which a partial draw
            // does not write. Kept only when its own ends are in the
            // set, so a partial draw reports on its own page.
            var sh = un[ui];
            var takeShot = byTrip ? ((sh.trip || 0) === tripId) :
                (keep[sh.from] === true || keep[sh.to] === true);
            if (takeShot) {
                out.unresolved.push(sh);
            }
        }
        // `skipped` is the shots the solve placed nowhere (excluded
        // ones and splays). CsDraw reads its LENGTH to report what it
        // could not draw, so a subset that omitted it would crash the
        // draw, and one that carried the whole cave's list would have
        // the page apologise for other trips' excluded shots.
        var sk = res.skipped || [];
        out.skipped = [];
        for (var ki = 0; ki < sk.length; ki++) {
            var kSh = sk[ki];
            var takeSk = byTrip ? ((kSh.trip || 0) === tripId) :
                (keep[kSh.from] === true || keep[kSh.to] === true);
            if (takeSk) {
                out.skipped.push(kSh);
            }
        }
        return out;
    };
    var out = narrow(resolved);
    // Describes the SOLVE (which control it could honour), not the
    // subset -- carried through so a partial draw writes the same Fixed
    // tags a full one would.
    if (resolved.controlFrame !== undefined) {
        out.controlFrame = resolved.controlFrame;
    }
    if (resolved.raw !== undefined && resolved.raw !== null) {
        out.raw = narrow(resolved.raw);
    }
    if (resolved.summary !== undefined) {
        out.summary = resolved.summary;
    }
    if (resolved.adjusted !== undefined) {
        out.adjusted = resolved.adjusted;
    }
    return out;
};

/**
 * The survey handed to a partial draw: the page's shots, carrying the
 * MERGED trip list.
 *
 * The trip list matters more than it looks. CsDraw.survey stamps each
 * trip's metadata onto that trip's first drawn station and indexes it
 * by position in `survey.trips` -- so a page drawn with a one-entry
 * trip list would tag its stations Trip=0 and the drawing would have
 * two trip 0s. Carrying the whole list means the page's stations get
 * their real trip id, and every other trip simply contributes no
 * anchor to this draw (it has no station in it).
 *
 * caveName and the survey-level fields ride along for the same reason:
 * whatever the partial draw does write, it should write the cave's
 * values and not a page's.
 *
 * \param merged the merged CsModel survey
 * \param shots  the page's shots, already carrying their merged trip id
 * \return a CsModel survey (fresh; the shots are shared by reference,
 *         as everywhere else in the suite)
 */
CsDelta.pageSurvey = function(merged, shots) {
    var out = CsModel.newSurvey();
    out.caveName = merged.caveName;
    out.name = merged.name;
    out.date = merged.date;
    out.team = merged.team;
    out.declination = merged.declination;
    out.declinationSource = merged.declinationSource;
    out.distanceUnit = merged.distanceUnit;
    out.instruments = merged.instruments;
    out.trips = merged.trips;
    out.fixed = merged.fixed;
    out.shots = shots;
    return out;
};

/**
 * Which trip each station BELONGS to: the trip of the first shot that
 * touches it, in shot order.
 *
 * The same rule CsDraw.survey uses to decide which station anchors a
 * trip's metadata -- deliberately, because the fast path erases and
 * redraws "the page's stations" and the drawing has to agree with it
 * about which those are. A station an older trip reached and this page
 * merely ties into belongs to the older trip and is left alone.
 *
 * \param survey a merged CsModel survey
 * \return {name: tripId}
 */
CsDelta.stationTrips = function(survey) {
    var out = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        if (sh.excludeFromAll) {
            continue;
        }
        var trip = sh.trip || 0;
        if (sh.from !== "" && out[sh.from] === undefined) {
            out[sh.from] = trip;
        }
        if (!sh.splay && sh.to !== "" && out[sh.to] === undefined) {
            out[sh.to] = trip;
        }
    }
    return out;
};

/**
 * The two station lists a partial draw needs, from one merged survey.
 *
 * \return {page: [name], tie: [name]} -- `page` is what this trip owns
 *         and the draw replaces; `tie` is every other station the
 *         trip's shots touch, whose position the draw needs and whose
 *         marks it must not touch
 */
CsDelta.pageStations = function(survey, tripId) {
    var owner = CsDelta.stationTrips(survey);
    var page = [], tie = [], seen = {};
    var note = function(name) {
        if (name === "" || seen[name] === true) {
            return;
        }
        seen[name] = true;
        if (owner[name] === tripId) {
            page.push(name);
        } else if (owner[name] !== undefined) {
            tie.push(name);
        }
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        if ((sh.trip || 0) !== tripId || sh.excludeFromAll) {
            continue;
        }
        note(sh.from);
        if (!sh.splay) {
            note(sh.to);
        }
    }
    return { page: page, tie: tie };
};

/**
 * The whole decision, in one place: may this Draw redraw only the page?
 *
 * \param opts {
 *   drawn      {name:{x,y}} the drawing's current station positions
 *   stations   resolved.stations of the merged solve
 *   extent     CsRevise.positionsExtent(drawn)
 *   pageNames  [name] the stations this page draws
 *   dropped    [name] stations the replaced trip used and no longer does
 *   anchorName the reconstruction's trip-0 anchor station name
 * }
 * \return {fast: true} or {fast: false, reason: "..."} -- the reason is
 *         for the report and the tests, never for the user's face
 */
CsDelta.decide = function(opts) {
    var drawn = opts.drawn || {};
    var stations = opts.stations || {};
    var pageNames = opts.pageNames || [];
    var dropped = opts.dropped || [];

    var onPage = {};
    for (var i = 0; i < pageNames.length; i++) {
        onPage[pageNames[i]] = true;
    }

    // The trip-0 anchor must survive untouched: it carries the whole
    // drawing's record (the legacy block, the adjustment, the excluded
    // shots), and a partial draw deliberately does not write those.
    // A page that redraws that station has to go the long way round.
    if (opts.anchorName !== undefined && opts.anchorName !== null &&
            opts.anchorName !== "" && onPage[opts.anchorName] === true) {
        return { fast: false, reason: "the page redraws the trip-0 anchor" };
    }

    // A dropped station -- one the replaced trip used to reach and no
    // longer does -- has to be erased, and erasing it is a change to
    // the drawing outside the page. Rare, and not worth a special case.
    if (dropped.length > 0) {
        return { fast: false, reason: "the page dropped stations" };
    }

    var moved = CsDelta.movedStations(drawn, stations, opts.extent);
    // A station the page itself redraws is allowed to move: it is being
    // erased and put back either way.
    for (i = 0; i < moved.length; i++) {
        if (onPage[moved[i]] !== true) {
            return { fast: false,
                reason: "the merged solve moves " + moved.length +
                    " already-drawn station" +
                    (moved.length === 1 ? "" : "s") + ", starting with " +
                    moved[i] };
        }
    }
    return { fast: true, reason: "" };
};
