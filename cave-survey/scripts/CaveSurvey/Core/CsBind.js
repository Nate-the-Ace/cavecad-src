// CsBind.js -- which stations a hand-drawn entity belongs to.
//
// Part of the Cave Survey Core library. The pure half (layer gate,
// suffix stripping, coincidence and box tests, tag encoding) runs
// anywhere, including plain node -- nothing at file scope touches R*.
// The document half (stationIndex, pointsOf, bindEntity, tagEntities,
// adoptable) is QCAD context only and says so on each function.
//
// WHY THIS EXISTS: a rigid revision moves the whole drawing, so traced
// walls follow the survey for free. The NON-RIGID path does not -- it
// erases and redraws the tagged survey geometry and leaves everything
// else exactly where it was, which tears the traced walls off the
// passage they were traced against. Moving them needs an answer to
// "which stations does this entity belong to?", and that answer has to
// be stored on the entity, because the survey it was traced against no
// longer exists once it has been revised.
//
// The binding signal is better than it sounds. CsDraw already draws
// LRUD tips (LRUDName) and splay tips (SplayName) precisely so wall
// tracing can snap to them, so a wall traced by snapping has vertices
// that COINCIDE EXACTLY with tagged geometry. That is an exact answer,
// not a proximity guess -- the guess is only the fallback.
//
// WHEN BINDING HAPPENS: automatically, and twice over.
//
//   as you draw   a transaction listener tags each newly added entity
//                 on a linework layer (installListener). Auditable --
//                 the tags are in the drawing before any revision --
//                 but it rests on a signal this bridge may not
//                 deliver, and one that cannot be exercised headless.
//   at revision   planAutoBind / commitAutoBind claim whatever is
//                 still untagged, from the mover's own vantage point,
//                 in the last moment before the erase. This one is
//                 certain: no signal, no arming, and it works on
//                 drawings made before any of this existed.
//
// NOTHING DEPENDS ON THE LISTENER. The revision-time pass is the
// guarantee; the listener is the same answer arrived at earlier. Both
// go through the same gates and the same inference, so they cannot
// disagree about what belongs to whom.
//
// There is NO ARMING. The trip is worked out from the stations the
// entity binds to (tripForStations), which is strictly more correct
// than asking: trace against trip 2 while the notebook page holds
// trip 1, and an armed design tags it to trip 1 -- then moves the
// wrong passage. And an entity that binds to NO station is left
// entirely alone: with no station there is nothing to infer a trip
// from, and quietly claiming a surveyor's unrelated construction
// geometry is the failure they would notice least and resent most.
//
// Automatic is the DEFAULT, and it is opt-out (autoBindEnabled).
// Writing tags onto geometry the user drew themselves is the one thing
// in this suite that touches their own work unasked, so it gets a
// switch -- kept in RSettings, thrown from the notebook's Linework...
// dialog.

var CsBind = {};

// The two tags, in the shared CaveSurvey property group.
//   LineworkTrip     integer trip id -- the stable per-drawing key.
//                    NOT the date|team fingerprint, which goes stale
//                    the moment a date typo or a team spelling is
//                    corrected. Same choice already made for legs.
//   LineworkStations "A3|A4|A5" -- the stations traced against, in the
//                    same form WallRunStations already uses. Absent
//                    when nothing could be identified.
CsBind.TRIP_TAG = "LineworkTrip";
CsBind.STATIONS_TAG = "LineworkStations";
CsBind.SEPARATOR = "|";

// ---------------------------------------------------------------------
// The layer gate
// ---------------------------------------------------------------------

// Layer name prefixes that are NEVER linework:
//   CTRL-   the suite's own geometry (stations, shots, LRUD, splays,
//           generated wall runs, the aerial basemap). Claiming our own
//           output as the user's tracing would make a revision move it
//           twice -- once by redrawing it, once by "binding" it.
//   TB_     sheet furniture: it belongs to the paper, not the cave.
//
// CsRevise.WORLD_FIXED_LAYERS ("TB_*", "CTRL-AERIAL") is the canonical
// list of what must not move with the cave, and both of its current
// members already fall under the two prefixes above. It is consulted
// as well, when loaded, so that a layer ADDED to that list is honored
// here without a second edit -- but only softly (typeof guard): this
// module's pure half must stay loadable on its own, and the prefixes
// below are enough of a gate by themselves.
CsBind.NEVER_LINEWORK_PREFIXES = ["CTRL-", "TB_"];

/**
 * The single gate deciding what may EVER be tagged or moved as
 * linework. Pure. An unknown or empty layer name is refused: this
 * returning true is a licence to write tags onto an entity and later
 * move it, so the default has to be "no".
 */
CsBind.isLineworkLayer = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return false;
    }
    var name = String(layerName);
    if (name === "") {
        return false;
    }
    for (var i = 0; i < CsBind.NEVER_LINEWORK_PREFIXES.length; i++) {
        var p = CsBind.NEVER_LINEWORK_PREFIXES[i];
        if (name.indexOf(p) === 0) {
            return false;
        }
    }
    // SECTIONS DO NOT BIND YET, and that is a deliberate hold rather
    // than an oversight. CsBind.indexStations takes a FRAME and indexes
    // its station CHAIN; a section frame has one station and no chain,
    // so there is nothing here for the existing maths to bind against.
    // Returning true would not leave section tracing alone -- it would
    // move it by whatever correction the passage got, which is worse
    // than not moving it at all. Remove this the day sections have a
    // binding rule of their own, together with its tests.
    if (typeof CsLayers !== "undefined" &&
            typeof CsLayers.frameOf === "function" &&
            CsLayers.frameOf(name) === "section") {
        return false;
    }

    // soft: honors a widened WORLD_FIXED_LAYERS without a second edit
    if (typeof CsRevise !== "undefined" &&
            typeof CsRevise.isWorldFixedLayer === "function" &&
            CsRevise.isWorldFixedLayer(name)) {
        return false;
    }
    return true;
};

// ---------------------------------------------------------------------
// Suffix stripping -- the ONE canonical version
// ---------------------------------------------------------------------
//
// These lived inside CsDraw.eraseStations as local helpers (baseOf,
// splayBaseOf). They are lifted here and eraseStations now calls them,
// so the erase rules and the binding index cannot disagree about which
// station "A3.L2" belongs to -- a disagreement that is exactly how a
// tip point gets orphaned by a redraw.

/**
 * "A3.L" / "A3.R" / "A3.L2" / "A3.R3" -> "A3". Anything else is
 * returned unchanged. Pure.
 *
 * The optional trailing digits are the multi-reading LRUD indices
 * CsDraw writes for a side recorded "5/10": the outer wall is ".L",
 * inner ledges are ".L2", ".L3". The old inline version matched only
 * a bare L or R, so a ".L2" tip never reduced to its station.
 */
CsBind.lrudBase = function(tagged) {
    if (tagged === undefined || tagged === null) {
        return "";
    }
    var m = /^(.*)\.([LR]\d*)$/.exec(String(tagged));
    return m === null ? String(tagged) : m[1];
};

/** "A3.2" -> "A3" (splay names are <station>.<n>). Pure. */
CsBind.splayBase = function(tagged) {
    if (tagged === undefined || tagged === null) {
        return "";
    }
    var m = /^(.*)\.(\d+)$/.exec(String(tagged));
    return m === null ? String(tagged) : m[1];
};

/**
 * The station a tagged tip name belongs to, whichever flavour of
 * suffix it carries. Pure. Used when building the station index, where
 * LRUD tips and splay tips arrive mixed together.
 */
CsBind.stationBase = function(tagged) {
    var s = (tagged === undefined || tagged === null) ? "" : String(tagged);
    var lr = CsBind.lrudBase(s);
    if (lr !== s) {
        return lr; // it was an LRUD tip name
    }
    return CsBind.splayBase(s);
};

// ---------------------------------------------------------------------
// Tag encoding -- the "A|B|C" form WallRunStations already uses
// ---------------------------------------------------------------------

/** Names -> "A|B|C". Drops empties, collapses duplicates, keeps first
 *  appearance order. Pure. */
CsBind.encodeStations = function(names) {
    if (names === undefined || names === null) {
        return "";
    }
    var seen = {};
    var out = [];
    for (var i = 0; i < names.length; i++) {
        var n = (names[i] === undefined || names[i] === null) ? "" :
            String(names[i]);
        if (n === "" || seen[n] === true) {
            continue;
        }
        seen[n] = true;
        out.push(n);
    }
    return out.join(CsBind.SEPARATOR);
};

/** "A|B|C" -> names. Pure. NOT trimmed: a station name may legally
 *  contain a space, and trimming would quietly rename it. */
CsBind.decodeStations = function(text) {
    if (text === undefined || text === null) {
        return [];
    }
    var s = String(text);
    if (s === "") {
        return [];
    }
    var parts = s.split(CsBind.SEPARATOR);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] !== "") {
            out.push(parts[i]);
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// Coincidence and proximity -- pure geometry over a station index
// ---------------------------------------------------------------------
//
// A station index is simply [{name, x, y}]: station points, LRUD tips
// and splay tips, all with their suffixes already stripped, so several
// entries commonly share a name. Duplicate names collapse on the way
// out.

// Coincidence epsilon as a fraction of the drawing's extent, and the
// floor under it. RELATIVE on purpose: a cave surveyed in metres and
// the same cave in feet must behave identically, which a hard-coded
// "0.001" cannot do. A snapped vertex is bit-identical when drawn and
// only loses a few digits through a DXF round trip, so 1e-6 of the
// extent (0.1 mm across a 100 m drawing) is generous for float noise
// and still far tighter than any two distinct survey features.
CsBind.EPSILON_FRACTION = 1e-6;
CsBind.MIN_EPSILON = 1e-9;
CsBind.FALLBACK_EPSILON = 1e-6; // empty/unmeasurable drawing

// Proximity margin: the box grows by this many times the drawing's own
// typical feature spacing (median nearest-neighbour distance in the
// station index -- see CsBind.marginFor). Also unit-free: the spacing
// scales with the drawing, so metres and feet give the same answer.
CsBind.PROXIMITY_FACTOR = 2.0;
CsBind.MARGIN_SAMPLE_CAP = 300; // nearest-neighbour scan is O(n*m)

/**
 * The entries of a station index that belong to one frame. An entry
 * that carries no frame is kept: see CsBind.bindEntity for why an
 * unlabelled index is treated as eligible rather than as suspect.
 * Pure.
 */
CsBind.inFrame = function(index, frame) {
    if (index === undefined || index === null) {
        return [];
    }
    var out = [], i;
    for (i = 0; i < index.length; i++) {
        if (index[i].frame === undefined || index[i].frame === null ||
                index[i].frame === frame) {
            out.push(index[i]);
        }
    }
    return out;
};

/**
 * The station names in stationIndex coinciding with any of points,
 * within epsilon. Pure -- no document access. Order of first
 * appearance; duplicates collapsed.
 */
CsBind.stationsForPoints = function(points, stationIndex, epsilon) {
    var out = [];
    if (points === undefined || points === null ||
            stationIndex === undefined || stationIndex === null) {
        return out;
    }
    var eps = (epsilon === undefined || epsilon === null ||
        !isFinite(epsilon) || epsilon < 0) ? CsBind.FALLBACK_EPSILON : epsilon;
    var seen = {};
    for (var p = 0; p < points.length; p++) {
        var pt = points[p];
        if (pt === undefined || pt === null) {
            continue;
        }
        for (var s = 0; s < stationIndex.length; s++) {
            var st = stationIndex[s];
            if (st === undefined || st === null || !st.name ||
                    seen[st.name] === true) {
                continue;
            }
            if (Math.abs(st.x - pt.x) <= eps && Math.abs(st.y - pt.y) <= eps) {
                seen[st.name] = true;
                out.push(st.name);
            }
        }
    }
    return out;
};

/**
 * The station names whose position falls inside box grown by margin.
 * Pure. box is the plain {minX, minY, maxX, maxY} form (not an RBox)
 * so this stays testable outside QCAD.
 */
CsBind.stationsInBox = function(box, stationIndex, margin) {
    var out = [];
    if (box === undefined || box === null ||
            stationIndex === undefined || stationIndex === null) {
        return out;
    }
    var m = (margin === undefined || margin === null || !isFinite(margin) ||
        margin < 0) ? 0 : margin;
    var minX = box.minX - m, maxX = box.maxX + m;
    var minY = box.minY - m, maxY = box.maxY + m;
    var seen = {};
    for (var i = 0; i < stationIndex.length; i++) {
        var st = stationIndex[i];
        if (st === undefined || st === null || !st.name ||
                seen[st.name] === true) {
            continue;
        }
        if (st.x >= minX && st.x <= maxX && st.y >= minY && st.y <= maxY) {
            seen[st.name] = true;
            out.push(st.name);
        }
    }
    return out;
};

/** The plain box of a list of {x, y}; null when there are none. Pure. */
CsBind.boxOfPoints = function(points) {
    if (points === undefined || points === null || points.length === 0) {
        return null;
    }
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p === undefined || p === null || !isFinite(p.x) || !isFinite(p.y)) {
            continue;
        }
        if (minX === null || p.x < minX) { minX = p.x; }
        if (maxX === null || p.x > maxX) { maxX = p.x; }
        if (minY === null || p.y < minY) { minY = p.y; }
        if (maxY === null || p.y > maxY) { maxY = p.y; }
    }
    if (minX === null) {
        return null;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/**
 * The proximity margin for a drawing, read off the drawing itself:
 * the median nearest-neighbour distance between index points, times
 * PROXIMITY_FACTOR. Pure.
 *
 * WHY not a fraction of the drawing extent: extent says nothing about
 * how far apart the features are. A 5 km cave and a 50 m cave surveyed
 * with the same 10 m shots want the same "near", and the spacing gives
 * it while a percentage of extent does not. The scan is sampled
 * (MARGIN_SAMPLE_CAP) because a big cave's index runs to thousands of
 * points and the honest scan is quadratic.
 */
CsBind.marginFor = function(stationIndex) {
    if (stationIndex === undefined || stationIndex === null ||
            stationIndex.length < 2) {
        return 0;
    }
    var n = stationIndex.length;
    var stride = Math.ceil(n / CsBind.MARGIN_SAMPLE_CAP);
    if (stride < 1) {
        stride = 1;
    }
    var dists = [];
    for (var i = 0; i < n; i += stride) {
        var a = stationIndex[i];
        if (a === undefined || a === null) {
            continue;
        }
        var best = null;
        for (var j = 0; j < n; j++) {
            if (j === i) {
                continue;
            }
            var b = stationIndex[j];
            if (b === undefined || b === null) {
                continue;
            }
            var dx = b.x - a.x, dy = b.y - a.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            // coincident points (a tip drawn AT its station, wall at
            // distance 0) say nothing about spacing
            if (d > 0 && (best === null || d < best)) {
                best = d;
            }
        }
        if (best !== null) {
            dists.push(best);
        }
    }
    if (dists.length === 0) {
        return 0;
    }
    dists.sort(function(x, y) { return x - y; });
    var median = dists[Math.floor(dists.length / 2)];
    return median * CsBind.PROXIMITY_FACTOR;
};

// ---------------------------------------------------------------------
// Trip inference -- the trip is READ OFF THE GEOMETRY, not armed
// ---------------------------------------------------------------------
//
// The stations an entity binds to already know which trip they belong
// to: the survey model says which trip's shots touch each name. So
// LineworkTrip is derived from the binding instead of from whatever the
// user last switched on, and a stroke traced against trip 2 is tagged
// trip 2 even while the notebook page is showing trip 1.
//
// THE RULE, when the bound stations span more than one trip: MAJORITY,
// tie-broken by the NEAREST bound station, and by the lowest trip id if
// even that is silent.
//
// Majority, because a traced wall runs along a passage and the passage
// is whichever trip owns most of the stations it touches. A junction
// station belongs to both trips and honestly votes for both, which is
// what makes the non-shared stations decide -- exactly the right
// outcome for a wall that crosses a junction and carries on into one
// trip. Nearest as the tie-break, because a genuine tie means the
// stroke sits between two passages and the one it was drawn against is
// the one it is closest to. Lowest id last, so the answer is
// deterministic rather than dependent on entity query order (which this
// build does not guarantee).
//
// The alternative -- nearest alone -- was rejected: one stray vertex
// that happens to fall a hair closer to the neighbouring trip would
// re-attribute an entire traced wall.

/**
 * {stationName: [tripIds]} from the {tripId: [names]} map
 * CsRevise.tripStationNames builds. Pure. A junction station appears
 * under every trip that touches it, and keeps them all.
 */
CsBind.tripsByStation = function(tripStations) {
    var out = {};
    if (tripStations === undefined || tripStations === null) {
        return out;
    }
    for (var t in tripStations) {
        if (!tripStations.hasOwnProperty(t)) {
            continue;
        }
        var id = parseInt(t, 10);
        if (isNaN(id)) {
            continue;
        }
        var names = tripStations[t];
        if (names === undefined || names === null) {
            continue;
        }
        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            if (nm === undefined || nm === null || nm === "") {
                continue; // a splay's blank "to"
            }
            if (out[nm] === undefined) {
                out[nm] = [];
            }
            var seen = false;
            for (var k = 0; k < out[nm].length; k++) {
                if (out[nm][k] === id) {
                    seen = true;
                }
            }
            if (!seen) {
                out[nm].push(id);
            }
        }
    }
    return out;
};

/**
 * The trip a set of bound station names belongs to (see THE RULE
 * above). Pure.
 *
 * \param names        the stations the entity bound to
 * \param tripStations {tripId: [names]}, from CsRevise.tripStationNames
 * \param nearest      optional -- the bound station nearest the entity,
 *                     the tie-break. Ignored when it is not one of the
 *                     tied trips' stations.
 * \return the trip id, or NULL when not one of the names is known to
 *         any trip. Null is not 0: trip 0 is a real trip, and writing
 *         it as a guess would move a passage that has nothing to do
 *         with the entity.
 */
CsBind.tripForStations = function(names, tripStations, nearest) {
    if (names === undefined || names === null || names.length === 0) {
        return null;
    }
    var byStation = CsBind.tripsByStation(tripStations);
    var votes = {};
    var best = 0;
    for (var i = 0; i < names.length; i++) {
        var trips = byStation[names[i]];
        if (trips === undefined) {
            continue;
        }
        for (var k = 0; k < trips.length; k++) {
            var id = trips[k];
            votes[id] = (votes[id] || 0) + 1;
            if (votes[id] > best) {
                best = votes[id];
            }
        }
    }
    if (best === 0) {
        return null;
    }
    var tied = [];
    for (var v in votes) {
        if (votes.hasOwnProperty(v) && votes[v] === best) {
            tied.push(parseInt(v, 10));
        }
    }
    if (tied.length === 1) {
        return tied[0];
    }
    // tie-break 1: whichever tied trip owns the nearest bound station
    var nearTrips = (nearest === undefined || nearest === null) ?
        undefined : byStation[nearest];
    if (nearTrips !== undefined) {
        for (i = 0; i < tied.length; i++) {
            for (k = 0; k < nearTrips.length; k++) {
                if (nearTrips[k] === tied[i]) {
                    return tied[i];
                }
            }
        }
    }
    // tie-break 2: deterministic, because query order is not
    tied.sort(function(a, b) { return a - b; });
    return tied[0];
};

/**
 * The name in names whose index point lies closest to any of points --
 * the tie-break tripForStations wants. Pure. null when there is
 * nothing to measure.
 */
CsBind.nearestStationName = function(points, stationIndex, names) {
    if (points === undefined || points === null || points.length === 0 ||
            stationIndex === undefined || stationIndex === null ||
            names === undefined || names === null || names.length === 0) {
        return null;
    }
    var wanted = {};
    for (var i = 0; i < names.length; i++) {
        wanted[names[i]] = true;
    }
    var bestName = null;
    var bestD2 = null;
    for (var s = 0; s < stationIndex.length; s++) {
        var st = stationIndex[s];
        if (st === undefined || st === null || wanted[st.name] !== true) {
            continue;
        }
        for (var p = 0; p < points.length; p++) {
            var pt = points[p];
            if (pt === undefined || pt === null) {
                continue;
            }
            var dx = st.x - pt.x, dy = st.y - pt.y;
            var d2 = dx * dx + dy * dy;
            if (bestD2 === null || d2 < bestD2) {
                bestD2 = d2;
                bestName = st.name;
            }
        }
    }
    return bestName;
};

// ---------------------------------------------------------------------
// Document side -- QCAD context only from here down
// ---------------------------------------------------------------------

// Tags that mark an entity as the SUITE's own output rather than the
// user's tracing. The layer gate already keeps us off CTRL-*, but the
// suite also writes to plain feature layers -- note leaders and labels
// on TEXT-NOTES, breakdown on BREAKDOWN, legend rows on LEGEND, the
// basemap image -- and adopting those would have a revision move
// geometry it is about to redraw anyway.
CsBind.SUITE_TAGS = ["Station", "StationLabel", "Shot", "LRUDName",
    "LRUDLine", "LRUDNote", "Splay", "SplayName", "SplayLabel",
    "NoteLabel", "NoteLeader", "WallRun", "WallRunStations",
    "BoundaryId", "LegendRow", "AerialBasemap"];

/**
 * Is this a shaped line's ornament or an area's tile -- regenerated from
 * the spine or boundary it belongs to, so never claimed for a station
 * of its own? (One already carrying a tag keeps it and keeps moving: if
 * the regeneration did not run, following its stations is the fallback.)
 */
CsBind.isDerived = function(entity) {
    return (typeof CsShapeLine !== "undefined" &&
            CsTags.get(entity, CsShapeLine.KEY.DECOR) !== "") ||
        (typeof CsArea !== "undefined" &&
            CsTags.get(entity, CsArea.OWNER_KEY) !== "");
};

/** True when the entity carries any suite-generated tag. QCAD only. */
CsBind.isSuiteGeometry = function(entity) {
    for (var i = 0; i < CsBind.SUITE_TAGS.length; i++) {
        if (CsTags.get(entity, CsBind.SUITE_TAGS[i]) !== "") {
            return true;
        }
    }
    return false;
};

/** True when the entity already carries either linework tag. QCAD only. */
CsBind.hasLineworkTags = function(entity) {
    return CsTags.get(entity, CsBind.TRIP_TAG) !== "" ||
        CsTags.get(entity, CsBind.STATIONS_TAG) !== "";
};

/** An entity's layer name, "" when it cannot be read. QCAD only. */
CsBind.layerNameOf = function(doc, entity) {
    try {
        var name = doc.getLayerName(entity.getLayerId());
        return (name === undefined || name === null) ? "" : String(name);
    } catch (e) {
        return "";
    }
};

/**
 * The coincidence epsilon for this drawing, derived from its extent
 * (see EPSILON_FRACTION). QCAD only.
 */
CsBind.epsilonFor = function(doc) {
    var scale = 0;
    try {
        var bb = doc.getBoundingBox();
        if (!isNull(bb)) {
            var lo = bb.getMinimum(), hi = bb.getMaximum();
            scale = Math.max(Math.abs(hi.x - lo.x), Math.abs(hi.y - lo.y));
        }
    } catch (e) {
        scale = 0;
    }
    if (!isFinite(scale) || scale <= 0) {
        return CsBind.FALLBACK_EPSILON;
    }
    var eps = scale * CsBind.EPSILON_FRACTION;
    return eps < CsBind.MIN_EPSILON ? CsBind.MIN_EPSILON : eps;
};

/**
 * One scan of the drawing collecting every point a tracing could have
 * snapped to: station points (Station), LRUD tips (LRUDName) and splay
 * tips (SplayName), suffixes stripped, as [{name, x, y}]. QCAD only.
 *
 * Label entities carrying the same names are deliberately skipped --
 * their position is the text's, offset from the feature, so a vertex
 * never coincides with one.
 *
 * CTRL-RAW is refused outright, however an entity there came to carry
 * Station/LRUDName/SplayName. Today nothing writes those tags onto the
 * as-surveyed ghost -- it carries RawShot/RawStation and nothing else
 * (CsDraw.survey), so this is not a fix for a live bug, only defence
 * against a future edit tagging a ghost carelessly. If it ever did:
 * the ghost sits at the PRE-adjustment position, inches from the real
 * station's post-adjustment one, and a wall bound to it would get
 * dragged against a phantom on the next revision -- or worse, a ghost
 * carrying a real station's name would put two positions under one
 * name in this very index. Layer, not prefix: CTRL-STATIONS,
 * CTRL-LRUD and CTRL-SPLAYS also start with "CTRL-" and must keep
 * indexing, so this cannot reuse CsBind.isLineworkLayer.
 *
 * \param frame "plan" (default) or "profile" -- which view's stations
 *              to index. Omitted means plan, so every caller written
 *              before frames existed keeps its behaviour unchanged.
 *
 * WHY A FRAME AT ALL. Since the elevation moved into the plan drawing,
 * two coordinate frames share one model space: plan X/Y are easting and
 * northing, profile X is distance along the passage. This index feeds
 * stationsInBox/marginFor, which match by ABSOLUTE proximity -- and the
 * profile region sits directly below the plan, so the two frames are
 * guaranteed to be near each other at their boundary. Without the
 * filter, a ceiling line traced on the elevation binds to whichever
 * plan station happens to lie nearest, and the next revision drags it
 * somewhere meaningless.
 *
 * Every entry carries its own frame, so CsBind.bindEntity can refuse a
 * cross-frame binding even when handed an index somebody else built.
 */
CsBind.stationIndex = function(doc, frame) {
    var want = (frame === undefined || frame === null) ? "plan" : frame;
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var layerName = CsBind.layerNameOf(doc, e);
        if (layerName === "CTRL-RAW") {
            continue;
        }
        if (CsLayers.frameOf(layerName) !== want) {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name === "") {
            name = CsBind.lrudBase(CsTags.get(e, "LRUDName"));
        }
        if (name === "") {
            name = CsBind.splayBase(CsTags.get(e, "SplayName"));
        }
        if (name === "") {
            continue;
        }
        var pos;
        try {
            pos = e.getPosition();
        } catch (e2) {
            continue;
        }
        if (isNull(pos)) {
            continue;
        }
        out.push({ name: name, x: pos.x, y: pos.y, frame: want });
    }
    return out;
};

/**
 * The points of an entity that a tracing snap could have landed on:
 * every vertex of a polyline, the insertion point of a block
 * reference, a point's position, the endpoints of a line or arc.
 * QCAD only.
 *
 * NEVER THROWS. An entity type this bridge exposes differently -- or
 * not at all -- returns []. A binding that cannot see an entity's
 * points falls back to proximity, which is a worse answer; a binding
 * that throws takes the whole tagging pass down with it.
 *
 * The accessor order is empirical, probed in this build: there is no
 * getVertices() on anything, polylines answer countVertices() /
 * getVertexAt(), points and block references answer getPosition(),
 * lines and arcs answer getStartPoint() / getEndPoint(), and
 * getEndPoints() exists on everything as the last resort (it returns
 * [] for a block reference, so it cannot replace getPosition).
 */
CsBind.pointsOf = function(entity) {
    var out = [];
    if (entity === undefined || entity === null) {
        return out;
    }
    try {
        if (typeof entity.countVertices === "function" &&
                typeof entity.getVertexAt === "function") {
            var n = entity.countVertices();
            for (var i = 0; i < n; i++) {
                var v = entity.getVertexAt(i);
                if (!isNull(v)) {
                    out.push({ x: v.x, y: v.y });
                }
            }
            if (out.length > 0) {
                return out;
            }
        }
    } catch (e) {
        out = [];
    }
    try {
        if (typeof entity.getPosition === "function") {
            var p = entity.getPosition();
            if (!isNull(p)) {
                return [{ x: p.x, y: p.y }];
            }
        }
    } catch (e2) {
        // fall through
    }
    try {
        if (typeof entity.getStartPoint === "function" &&
                typeof entity.getEndPoint === "function") {
            var s = entity.getStartPoint(), t = entity.getEndPoint();
            if (!isNull(s) && !isNull(t)) {
                return [{ x: s.x, y: s.y }, { x: t.x, y: t.y }];
            }
        }
    } catch (e3) {
        // fall through
    }
    try {
        if (typeof entity.getEndPoints === "function") {
            var eps = entity.getEndPoints();
            var res = [];
            for (var k = 0; k < eps.length; k++) {
                if (!isNull(eps[k])) {
                    res.push({ x: eps[k].x, y: eps[k].y });
                }
            }
            return res;
        }
    } catch (e4) {
        // fall through
    }
    return [];
};

/**
 * The entity's plain {minX, minY, maxX, maxY} box, from its own
 * bounding box where the bridge offers one and from its points
 * otherwise. null when neither is available. QCAD only.
 */
/**
 * How far past the proximity margin a drawn item may sit and still be
 * tied to the survey, in multiples of that margin; and how many of the
 * nearest stations it is tied to.
 *
 * WHY THIS TIER EXISTS (found on Truitt Cave, 2026-10). The proximity
 * margin is the median station spacing, which is right for a wall and
 * wrong for a symbol in the middle of a room: Truitt's floor-slope
 * symbols sit 20 to 37 ft from the nearest station against a 15.6 ft
 * margin, its section blocks 25 to 135 ft, a sump outline 58 ft. Each
 * bound to NOTHING, was "not ours to claim", and then sat still through
 * every revision with no word said about it. A wide room is not a
 * reason for a symbol to stop following the cave.
 *
 * The answer is the stations NEAREST to it. CsWarp weights every
 * control by inverse square distance anyway, so a far item simply
 * follows its nearest stations most -- which is the honest guess for an
 * item that has none closer. Past FAR_FACTOR margins an item is more
 * likely something the cave does not own (a note parked in the sheet
 * margin, an imported drawing) and stays unbound, where the revision
 * report now names it.
 */
CsBind.FAR_FACTOR = 10;
CsBind.FAR_COUNT = 3;

/**
 * The names of the `count` stations nearest the middle of `box`, none
 * farther than `limit`. Pure.
 */
CsBind.nearestStations = function(box, stationIndex, count, limit) {
    var out = [];
    if (box === undefined || box === null || stationIndex === undefined ||
            stationIndex === null || !(limit > 0) || !(count > 0)) {
        return out;
    }
    var cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    var best = {};
    for (var i = 0; i < stationIndex.length; i++) {
        var st = stationIndex[i];
        if (st === undefined || st === null || !st.name) {
            continue;
        }
        var d = Math.sqrt((st.x - cx) * (st.x - cx) + (st.y - cy) * (st.y - cy));
        if (d <= limit && (!best.hasOwnProperty(st.name) || d < best[st.name])) {
            best[st.name] = d;
        }
    }
    var names = [];
    for (var n in best) {
        if (best.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    names.sort(function(a, b) { return best[a] - best[b]; });
    return names.slice(0, count);
};

CsBind.boxOf = function(entity, points) {
    try {
        if (typeof entity.getBoundingBox === "function") {
            var bb = entity.getBoundingBox();
            if (!isNull(bb)) {
                var lo = bb.getMinimum(), hi = bb.getMaximum();
                if (isFinite(lo.x) && isFinite(hi.x)) {
                    return { minX: Math.min(lo.x, hi.x),
                        minY: Math.min(lo.y, hi.y),
                        maxX: Math.max(lo.x, hi.x),
                        maxY: Math.max(lo.y, hi.y) };
                }
            }
        }
    } catch (e) {
        // fall through to the points
    }
    return CsBind.boxOfPoints(points !== undefined && points !== null ?
        points : CsBind.pointsOf(entity));
};

/**
 * Which stations this entity belongs to. QCAD only. WRITES NOTHING --
 * the caller decides whether to commit, which is what lets the adopt
 * action show a preview first.
 *
 * The spec's ordered rules, first hit wins:
 *   1 "snap"       a vertex / endpoint / insertion point coincides
 *                  with a tagged point. Exact, because CsDraw drew
 *                  those tips for tracing to snap to.
 *   2 "proximity"  nothing coincided: the stations inside the
 *                  entity's box grown by the drawing's own feature
 *                  spacing. For freehand that snapped to nothing.
 *   3 "far"        nothing inside the margin: the few NEAREST
 *                  stations, within FAR_FACTOR margins. A symbol in the
 *                  middle of a wide room.
 *   4 "trip"       nothing found: no station list, and the entity
 *                  follows its trip as a whole.
 *
 * The TRIP comes from the stations wherever it can (tripForStations),
 * which is why tripStations is worth passing: it is the difference
 * between "the trip this entity was traced against" and "the trip
 * somebody last selected". tripId is only the fallback for when the
 * inference has nothing to say -- pass it as NULL to mean "infer or
 * admit you can't", which is what the automatic passes want, and as a
 * number to mean "and failing that, this one", which is what Adopt
 * wants (the user named a trip there).
 *
 * \return {stations, source, trip} -- trip may be null when nothing
 *         could be inferred and no fallback was given
 */
CsBind.bindEntity = function(doc, entity, tripId, index, epsilon,
        tripStations) {
    var trip = (tripId === undefined) ? 0 : tripId;
    // An entity binds within its OWN frame, never across one. Belt to
    // the frame-scoped index's braces: even handed a mixed index -- by
    // a caller that predates frames, or one serving both views in a
    // single pass -- a ceiling line traced on the elevation cannot
    // bind to the plan station a few units away in absolute
    // coordinates. Entries with no frame at all (an index somebody
    // built by hand) are left eligible: this refuses a KNOWN crossing,
    // it does not demand provenance nothing used to carry.
    var entFrame = CsLayers.frameOf(CsBind.layerNameOf(doc, entity));
    var idx = (index === undefined || index === null) ?
        CsBind.stationIndex(doc, entFrame) : CsBind.inFrame(index, entFrame);
    var eps = (epsilon === undefined || epsilon === null) ?
        CsBind.epsilonFor(doc) : epsilon;

    var points = CsBind.pointsOf(entity);
    // The stations decide the trip; the fallback only speaks when they
    // are silent about it.
    var tripFor = function(names) {
        if (tripStations === undefined || tripStations === null) {
            return trip;
        }
        var inferred = CsBind.tripForStations(names, tripStations,
            CsBind.nearestStationName(points, idx, names));
        return inferred === null ? trip : inferred;
    };

    var snapped = CsBind.stationsForPoints(points, idx, eps);
    if (snapped.length > 0) {
        return { stations: snapped, source: "snap", trip: tripFor(snapped) };
    }
    var box = CsBind.boxOf(entity, points);
    if (box !== null) {
        var near = CsBind.stationsInBox(box, idx, CsBind.marginFor(idx));
        if (near.length > 0) {
            return { stations: near, source: "proximity",
                trip: tripFor(near) };
        }
    }
    // Nothing inside the margin. A wide room is not a reason to stop
    // following the cave: take the nearest few -- see FAR_FACTOR.
    if (box !== null) {
        var far = CsBind.nearestStations(box, idx, CsBind.FAR_COUNT,
            CsBind.FAR_FACTOR * CsBind.marginFor(idx));
        if (far.length > 0) {
            return { stations: far, source: "far", trip: tripFor(far) };
        }
    }
    // Nothing found: there is no geometry to infer a trip from, so the
    // only trip on offer is the caller's fallback. The automatic passes
    // pass null here and drop the entity on the strength of it.
    return { stations: [], source: "trip", trip: trip };
};

/**
 * Writes LineworkTrip / LineworkStations onto entities already in the
 * document, in ONE RModifyObjectsOperation so the whole tagging pass
 * is one undo step. QCAD only.
 *
 * entries: [{entity, trip, stations}] -- stations optional, and trip
 * may be NULL, meaning "these stations, but no honest answer about
 * which trip". That happens when an entity binds to station points the
 * survey model does not name, and writing trip 0 instead would tie the
 * entity to a passage it has nothing to do with. The station list
 * alone is a complete binding: CsRevise.moveLinework prefers it and
 * only falls back to the trip. An entry with neither is skipped -- a
 * pass that "tagged" an entity with nothing is worse than one that
 * left it alone, because hasLineworkTags would go on saying no.
 *
 * Off layers are handled: this build silently refuses adds, MODIFIES
 * and deletes on a layer that is off, so a tag written to an entity
 * sitting on one would vanish without an error. Every off layer in the
 * batch is flipped on around the single operation via
 * CsLayers.withLayerOn (nested, one wrapper per layer) and restored
 * after.
 *
 * \return number of entities tagged
 */
CsBind.tagEntities = function(doc, di, entries) {
    if (entries === undefined || entries === null || entries.length === 0) {
        return 0;
    }
    // which layers in this batch are off, and so need flipping
    var offLayers = [];
    var offSeen = {};
    for (var i = 0; i < entries.length; i++) {
        var ln = CsBind.layerNameOf(doc, entries[i].entity);
        if (ln === "" || offSeen[ln] === true) {
            continue;
        }
        offSeen[ln] = true;
        try {
            var lay = doc.queryLayer(ln);
            // refusesEdits: a tag write is a MODIFY, and frozen refuses
            // modifies as silently as off does.
            if (CsLayers.refusesEdits(lay)) {
                offLayers.push(ln);
            }
        } catch (e) {
            // no layer toggling here; the write is attempted anyway
        }
    }

    var write = function() {
        var op = new RModifyObjectsOperation();
        op.setText("Tag linework");
        var n = 0;
        for (var k = 0; k < entries.length; k++) {
            var en = entries[k];
            if (en === undefined || en === null || isNull(en.entity)) {
                continue;
            }
            var text = CsBind.encodeStations(en.stations);
            var hasTrip = (en.trip !== undefined && en.trip !== null);
            if (!hasTrip && text === "") {
                continue; // nothing to say about it -- see the note above
            }
            if (hasTrip) {
                CsTags.set(en.entity, CsBind.TRIP_TAG, en.trip);
            }
            if (text !== "") {
                CsTags.set(en.entity, CsBind.STATIONS_TAG, text);
            }
            // false: keeps the entity on the layer it is already on
            op.addObject(en.entity, false);
            n++;
        }
        di.applyOperation(op);
        return n;
    };

    // One operation each way for the whole set -- the same batching
    // CsRevise.withOffLayersOn uses, for the same reason: in the GUI an
    // applyOperation per layer is a layer-list refresh and a view
    // regeneration per layer.
    return CsLayers.withLayersOn(doc, di, offLayers, write);
};

/**
 * Every entity that COULD be adopted as linework for tripId, with the
 * binding it would get: [{entity, layer, stations, source, trip}].
 * QCAD only. Writes nothing -- this is what the adopt preview counts
 * before asking.
 *
 * Skipped: anything the layer gate refuses, anything already carrying
 * a linework tag (re-adopting is a deliberate retag, not a duplicate),
 * and anything carrying a suite tag (our own geometry).
 *
 * NOT skipped: an entity that binds to no station at all. That is the
 * one thing left that only Adopt does. The automatic passes refuse to
 * claim those (there is no trip to infer and no station to follow),
 * whereas here the user has named a trip and been shown the count, so
 * "follow trip N as a whole" is a choice they made rather than a guess
 * made for them.
 *
 * \param tripStations optional {tripId: [names]} -- when given, each
 *        entity's trip is inferred from its own stations and tripId is
 *        only the fallback (see bindEntity).
 */
CsBind.adoptable = function(doc, tripId, tripStations) {
    var out = [];
    var idx = CsBind.stationIndex(doc);
    var eps = CsBind.epsilonFor(doc);
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        // A PLAN pass, and only the plan's. The elevation shares this
        // drawing and sits directly below the plan, so profile-frame
        // linework is a few units from plan stations in the absolute
        // coordinates this binding matches on. Its own pass --
        // CsProfileBind.claim -- binds it against profile stations;
        // reaching it from here would bind it to the plan instead.
        if (CsLayers.frameOf(layer) !== "plan") {
            continue;
        }
        if (CsBind.hasLineworkTags(e) || CsBind.isSuiteGeometry(e) ||
                CsBind.isDerived(e)) {
            continue;
        }
        var bound = CsBind.bindEntity(doc, e, tripId, idx, eps, tripStations);
        out.push({ entity: e, layer: layer, stations: bound.stations,
            source: bound.source, trip: bound.trip });
    }
    return out;
};

/** Counts an adoptable list by binding source, for the preview:
 *  {total, snap, proximity, far, trip}. Pure over the list. */
CsBind.countBySource = function(items) {
    var out = { total: 0, snap: 0, proximity: 0, far: 0, trip: 0 };
    if (items === undefined || items === null) {
        return out;
    }
    for (var i = 0; i < items.length; i++) {
        if (items[i] === undefined || items[i] === null) {
            continue;
        }
        out.total++;
        if (out[items[i].source] !== undefined) {
            out[items[i].source]++;
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// The switch: automatic, and opt-out
// ---------------------------------------------------------------------
//
// ON by default, because Nathan is right that a surveyor should not
// have to remember to ask for their own tracing to follow their own
// survey. Off is still offered, because this is the one feature in the
// suite that writes tags onto geometry the user drew themselves, and
// somebody will not want that.
//
// Persisted in RSettings, the way CsLocationPick keeps the last
// location and the notebook keeps its splitter and status-bar state --
// a per-user preference, not a per-drawing one: it says how this
// surveyor likes to work, and it must survive the drawing being closed.
CsBind.SETTING_AUTO_BIND = "CaveSurvey/LineworkAutoBind";

// Harness/test seam ONLY: null means "ask RSettings", true/false force
// the answer without writing anything. Exists because a test that
// flipped the real setting and then threw would leave the feature
// switched off in the user's own configuration -- their preference is
// not ours to gamble with for a test.
CsBind.autoBindOverride = null;

CsBind.listener = null;       // the adapter, held so it is not collected
CsBind.listenerRefused = false; // this bridge said no; don't keep asking
CsBind.autoTagged = 0;        // tagged by the listener, for the notebook
CsBind.lastError = "";        // last failure inside the handler, if any

/**
 * Whether linework binds itself. Defaults to TRUE -- including when
 * RSettings is not there at all (node, a harness), because "the
 * settings are unreachable" is not a reason to stop doing the thing the
 * feature exists to do.
 */
CsBind.autoBindEnabled = function() {
    if (CsBind.autoBindOverride !== null) {
        return CsBind.autoBindOverride === true;
    }
    try {
        return RSettings.getBoolValue(CsBind.SETTING_AUTO_BIND, true) === true;
    } catch (e) {
        return true;
    }
};

/** Stores the preference. \return the value now in force. */
CsBind.setAutoBindEnabled = function(on) {
    var v = (on === true);
    try {
        RSettings.setValue(CsBind.SETTING_AUTO_BIND, v);
    } catch (e) {
        // No settings store here: the switch lasts the session only,
        // which is the honest best this build can do.
        CsBind.autoBindOverride = v;
        CsBind.lastError = "this build would not store the linework " +
            "binding preference (" + e + "), so it holds for this " +
            "session only";
    }
    return CsBind.autoBindEnabled();
};

// ---------------------------------------------------------------------
// Binding at REVISION time -- the pass nothing depends on a signal for
// ---------------------------------------------------------------------
//
// Split into plan and commit, and the split is the whole point.
//
// PLAN reads the drawing and writes nothing. It must run BEFORE the
// erase-and-redraw, because the linework was drawn against where the
// stations were THEN: stationIndex(doc) is only the old frame until the
// redraw replaces it. Bind after, and every entity would be measured
// against stations that had already moved out from under it.
//
// COMMIT writes the tags, and runs after the redraw, so a revision that
// turns out to move nothing (the notebook's Draw on a page that merely
// ADDS a trip) writes nothing onto the user's geometry. It re-queries
// each entity BY ID rather than reusing the entity objects the plan
// held: those are snapshots taken before an erase, and handing a stale
// snapshot to a modify operation is how you resurrect old state.

/**
 * Every untagged entity that CAN be bound, with the binding it would
 * get: [{id, layer, stations, source, trip}]. QCAD only. WRITES
 * NOTHING. Empty when the switch is off.
 *
 * Refused here, and this is the load-bearing refusal: an entity that
 * binds to NO station. Under the old armed design a stroke a mile from
 * the cave still took the armed trip id, because the arming supplied
 * one. With the trip inferred from stations there is nothing to infer
 * from -- and claiming a surveyor's unrelated construction geometry
 * would be the failure they notice least and resent most. Distant
 * sketches stay unclaimed. (Adopt still offers them, because there the
 * user says so.)
 *
 * \param tripStations {tripId: [names]} from CsRevise.tripStationNames
 */
CsBind.planAutoBind = function(doc, tripStations) {
    var out = [];
    if (!CsBind.autoBindEnabled() || isNull(doc)) {
        return out;
    }
    var idx = CsBind.stationIndex(doc);
    if (idx.length === 0) {
        return out; // nothing drawn to bind against
    }
    var eps = CsBind.epsilonFor(doc);
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eQ) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        // A PLAN pass, and only the plan's. The elevation shares this
        // drawing and sits directly below the plan, so profile-frame
        // linework is a few units from plan stations in the absolute
        // coordinates this binding matches on. Its own pass --
        // CsProfileBind.claim -- binds it against profile stations;
        // reaching it from here would bind it to the plan instead.
        if (CsLayers.frameOf(layer) !== "plan") {
            continue;
        }
        // Already claimed stays claimed: a deliberate adoption -- or a
        // correction the user made by hand -- outranks anything this
        // pass would work out for itself.
        if (CsBind.hasLineworkTags(e) || CsBind.isSuiteGeometry(e) ||
                CsBind.isDerived(e)) {
            continue;
        }
        var bound = CsBind.bindEntity(doc, e, null, idx, eps, tripStations);
        if (bound.stations.length === 0) {
            continue; // binds to nothing: not ours to claim
        }
        out.push({ id: ids[i], layer: layer, stations: bound.stations,
            source: bound.source, trip: bound.trip });
    }
    return out;
};

/**
 * Writes a plan's tags, one operation. QCAD only.
 * \return the number of entities newly bound -- the number a revision
 *         has to OWN UP TO, since it just took ownership of geometry
 *         the user drew.
 */
CsBind.commitAutoBind = function(doc, di, plan) {
    if (plan === undefined || plan === null || plan.length === 0 ||
            isNull(doc) || isNull(di)) {
        return 0;
    }
    var entries = [];
    for (var i = 0; i < plan.length; i++) {
        var e;
        try {
            e = doc.queryEntity(plan[i].id);
        } catch (eQ) {
            continue; // deleted between plan and commit
        }
        if (isNull(e) || CsBind.hasLineworkTags(e)) {
            continue;
        }
        entries.push({ entity: e, trip: plan[i].trip,
            stations: plan[i].stations });
    }
    if (entries.length === 0) {
        return 0;
    }
    // Our own write is a transaction like any other: suppressed, or the
    // listener walks in behind us and tags what we just tagged.
    return CsBind.withSuppressed(function() {
        return CsBind.tagEntities(doc, di, entries);
    });
};

// ---- the re-entrancy guard ------------------------------------------
//
// The suite's own drawing fires exactly the transaction the listener
// watches, so CsDraw.survey and CsRevise.apply must not be allowed to
// look like hand-drawn linework. Two failure modes, both bad:
//
//   a suppression that LEAKS (never resumed) kills draw-time tagging
//   for the rest of the session -- switched on, and quietly doing
//   nothing (the revision-time pass would still catch up, which is
//   exactly why that pass does not consult this counter);
//   a suppression that UNBALANCES (resumed twice) tags the next survey
//   the user draws as if it were their own tracing.
//
// So the depth is a counter (nesting is normal: apply() redraws
// through survey()), resume() never takes it below zero, and the only
// blessed way in is withSuppressed, whose finally runs even when the
// drawing throws halfway through.

CsBind.suppressDepth = 0;

/** Prefer withSuppressed -- see its finally. */
CsBind.suppress = function() {
    CsBind.suppressDepth++;
};

CsBind.resume = function() {
    if (CsBind.suppressDepth > 0) {
        CsBind.suppressDepth--;
    }
};

CsBind.isSuppressed = function() {
    return CsBind.suppressDepth > 0;
};

/** Runs fn with tagging suppressed, suppressed exactly once, however
 *  fn ends. Rethrows whatever fn threw -- swallowing a failed draw
 *  here would hide it from the tool that has to report it. */
CsBind.withSuppressed = function(fn) {
    CsBind.suppress();
    try {
        return fn();
    } finally {
        CsBind.resume();
    }
};

/**
 * Wraps one owner.name function so every call runs suppressed. Not
 * every caller can be trusted to remember: CsDraw.survey is called
 * from eight places across six tools and CsRevise.apply from two,
 * and a caller that forgets does not fail loudly -- it silently tags
 * the suite's own geometry as the user's tracing. Wrapping the
 * function itself is the only version of this guard that cannot be
 * forgotten by the next call site someone adds.
 *
 * Idempotent (a flag on the wrapper), and transparent: same this,
 * same arguments (forwarded through `arguments`, so a change to the
 * wrapped function's signature needs nothing here), same return
 * value.
 */
CsBind.guardFunction = function(owner, name) {
    if (owner === undefined || owner === null ||
            typeof owner[name] !== "function" ||
            owner[name].csBindGuarded === true) {
        return false;
    }
    var original = owner[name];
    var wrapper = function() {
        var self = this;
        var args = arguments;
        return CsBind.withSuppressed(function() {
            return original.apply(self, args);
        });
    };
    wrapper.csBindGuarded = true;
    wrapper.csBindOriginal = original; // for a harness that wants it back
    owner[name] = wrapper;
    return true;
};

/** Puts the guard on the suite's own drawing entry points. Called
 *  when the listener is installed -- before that there is nothing to
 *  guard against. QCAD only (the names are absent under node). */
CsBind.guardSuiteDrawing = function() {
    var n = 0;
    if (typeof CsDraw !== "undefined" &&
            CsBind.guardFunction(CsDraw, "survey")) {
        n++;
    }
    if (typeof CsRevise !== "undefined" &&
            CsBind.guardFunction(CsRevise, "apply")) {
        n++;
    }
    return n;
};

// ---- the listener ----------------------------------------------------
//
// A BONUS, not a mechanism. It tags as you draw, which is auditable --
// the tags are in the drawing, visible in the property editor, before
// any revision -- where the revision-time pass has to infer the same
// answer later. But whether transactionUpdated is delivered at all
// cannot be established headless, so nothing is allowed to rest on it:
// with the listener silent, planAutoBind reaches the same tags at the
// same moment they first matter.
//
// It is installed once for the session and never removed. A listener
// installed twice double-tags; one installed and removed per document
// is a lifetime to get wrong for no gain. What used to arm it is now
// just the switch, checked at the top of every transaction.

/**
 * Installs the transaction listener, ONCE per engine. QCAD only.
 * \return true when the listener is in place (already or newly).
 */
CsBind.installListener = function() {
    if (CsBind.listener !== null) {
        return true;
    }
    if (CsBind.listenerRefused) {
        return false;
    }
    try {
        var appWin = RMainWindowQt.getMainWindow();
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        // The handler is a NAMED function, not this closure's body, so
        // it can be exercised without a signal (see the harnesses):
        // headless the main window never delivers transactionUpdated.
        adapter.transactionUpdated.connect(function(document, transaction) {
            CsBind.onTransaction(document, transaction);
        });
        CsBind.listener = adapter;
        CsBind.guardSuiteDrawing();
        return true;
    } catch (e) {
        CsBind.listenerRefused = true;
        CsBind.lastError = String(e);
        return false;
    }
};

/**
 * The ids in a transaction that are NEWLY ADDED ENTITIES. QCAD only.
 *
 * This is the distinction the whole listener rests on.
 * getAffectedObjects() reports everything the transaction touched --
 * modifications and deletions included -- and tagging an entity the
 * user merely MOVED would claim work they never traced, while a
 * deleted one may not be safely queryable at all. getStatusChanges()
 * reports only objects whose EXISTENCE changed (created or deleted),
 * and isUndone() on the object separates the two, exactly as the stock
 * ExTransactionListener example does. A modified entity appears in
 * neither list, which is the answer we want.
 *
 * There is no fallback to getAffectedObjects when getStatusChanges is
 * missing: an over-broad answer here writes tags onto the user's
 * existing drawing, so no answer is the safer failure.
 *
 * Two filters beyond that:
 *   isUndone()          the object was DELETED by this transaction (or
 *                       is a creation that has since been undone).
 *   getLayerId absent   not an entity: layers and blocks turn up in
 *                       status changes too, and only entities answer
 *                       getLayerId in this bridge (probed: RLayer does
 *                       not, RLineEntity does). document.queryEntity()
 *                       cannot be used as the test -- it hands back an
 *                       REntity for a LAYER id in this build.
 *
 * A deletion later UNDONE comes back through here as a creation, so an
 * untagged stroke restored while armed gets tagged then. That is the
 * right answer for tracing and a harmless one otherwise.
 */
CsBind.addedEntityIds = function(document, transaction) {
    var out = [];
    if (isNull(document) || isNull(transaction) ||
            typeof transaction.getStatusChanges !== "function") {
        return out;
    }
    var ids;
    try {
        ids = transaction.getStatusChanges();
    } catch (e) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        var obj;
        try {
            obj = document.queryObjectDirect(ids[i]);
        } catch (e2) {
            continue;
        }
        if (isNull(obj) || typeof obj.getLayerId !== "function") {
            continue;
        }
        try {
            if (typeof obj.isUndone === "function" && obj.isUndone()) {
                continue;
            }
        } catch (e3) {
            continue;
        }
        out.push(ids[i]);
    }
    return out;
};

/**
 * The document interface to write tags through: the one handed in,
 * else the main window's, else the GUI global. QCAD only. null when
 * none can be reached, which means no tagging rather than a throw.
 */
CsBind.interfaceFor = function(di) {
    if (!isNull(di)) {
        return di;
    }
    try {
        var fromWin = RMainWindowQt.getMainWindow().getDocumentInterface();
        if (!isNull(fromWin)) {
            return fromWin;
        }
    } catch (e) {
        // no main window interface here: try the GUI global
    }
    try {
        if (typeof getDocumentInterface === "function") {
            var g = getDocumentInterface();
            if (!isNull(g)) {
                return g;
            }
        }
    } catch (e2) {
        // nothing to write through
    }
    return null;
};

/**
 * What the transactionUpdated signal runs. QCAD only.
 *
 * NEVER THROWS: this runs inside a Qt signal emission, where a throw
 * has no caller to report it and can take the emitting operation with
 * it. A failure is recorded in CsBind.lastError, which the notebook
 * shows, rather than raised.
 *
 * \param di optional -- the harnesses pass their own; the GUI resolves
 *           it from the main window.
 * \return the number of entities tagged.
 */
/**
 * Above this many entities arriving in ONE transaction, draw-time
 * binding stands down. A surveyor tracing a wall adds one entity, or a
 * handful; a DXF import or a big paste arrives in dozens or thousands.
 * Claiming those would tag a whole imported drawing as this trip's
 * linework the instant it lands, and bury that fact in a single summary
 * line nobody asked for.
 *
 * Nothing is lost by standing down: the revision-time pass still binds
 * whatever genuinely sits on the survey, at a moment the user chose and
 * with the count reported, and Adopt still claims deliberately. Only
 * the silent mass claim goes away.
 */
CsBind.MAX_AUTO_BIND_PER_TRANSACTION = 25;

CsBind.onTransaction = function(document, transaction, di) {
    try {
        return CsBind.onTransactionInner(document, transaction, di);
    } catch (e) {
        CsBind.lastError = String(e);
        return 0;
    }
};

CsBind.onTransactionInner = function(document, transaction, di) {
    // Cheapest checks first: this runs on EVERY transaction in the
    // application. RSettings caches, so the switch is a map lookup.
    if (CsBind.suppressDepth > 0 || !CsBind.autoBindEnabled()) {
        return 0;
    }
    if (isNull(document) || isNull(transaction)) {
        return 0;
    }
    // No drawing check any more, and none is needed: the trip is
    // inferred from the stations in THIS document, so a stroke drawn in
    // another open drawing gets that drawing's trips or no trip at all.
    // The wrong-passage hazard the armed design had to police here
    // simply cannot arise once the trip comes from the geometry.
    var ids = CsBind.addedEntityIds(document, transaction);
    if (ids.length === 0) {
        return 0;
    }
    // Bulk arrival is not tracing -- see MAX_AUTO_BIND_PER_TRANSACTION.
    // Recorded rather than silent: a surveyor who wonders why a pasted
    // wall was not claimed can find the reason.
    if (ids.length > CsBind.MAX_AUTO_BIND_PER_TRANSACTION) {
        CsBind.lastError = "auto-binding stood down: " + ids.length +
            " entities arrived in one transaction (import or paste), " +
            "more than " + CsBind.MAX_AUTO_BIND_PER_TRANSACTION +
            "; a revision will still bind what sits on the survey";
        return 0;
    }

    var entries = [];
    var idx = null;   // built only once a candidate has survived the
    var eps = 0;      // gates -- it is a full scan of the drawing
    var tripStations = null;
    for (var i = 0; i < ids.length; i++) {
        var e;
        try {
            e = document.queryEntity(ids[i]);
        } catch (eQ) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        var layerOf = CsBind.layerNameOf(document, e);
        if (!CsBind.isLineworkLayer(layerOf)) {
            continue;
        }
        // A PLAN pass, and only the plan's. The elevation shares this
        // drawing and sits directly below the plan, so profile-frame
        // linework is a few units from plan stations in the absolute
        // coordinates this binding matches on. Its own pass --
        // CsProfileBind.claim -- binds it against profile stations;
        // reaching it from here would bind it to the plan instead.
        if (CsLayers.frameOf(layerOf) !== "plan") {
            continue;
        }

        // already claimed, or ours: the layer gate misses our own
        // output on plain feature layers (note leaders on TEXT-NOTES,
        // wall runs on WALLS-*), which the suite tags catch
        if (CsBind.hasLineworkTags(e) || CsBind.isSuiteGeometry(e) ||
                CsBind.isDerived(e)) {
            continue;
        }
        if (idx === null) {
            idx = CsBind.stationIndex(document);
            eps = CsBind.epsilonFor(document);
            // Which trip owns which station, read off the drawing --
            // the same question the revision-time pass asks, answered
            // from the same source, so the two passes cannot attribute
            // one stroke differently. Built here, behind the gates,
            // because it is another full scan.
            tripStations = CsBind.tripStationsOf(document);
        }
        var bound = CsBind.bindEntity(document, e, null, idx, eps,
            tripStations);
        if (bound.stations.length === 0) {
            continue; // binds to nothing: not ours to claim
        }
        entries.push({ entity: e, trip: bound.trip,
            stations: bound.stations });
    }
    if (entries.length === 0) {
        return 0;
    }
    var target = CsBind.interfaceFor(di);
    if (target === null) {
        CsBind.lastError = "no document interface to write tags through";
        return 0;
    }
    // Our own write is itself a transaction: suppressed, or the
    // listener would recurse into it.
    var n = CsBind.withSuppressed(function() {
        return CsBind.tagEntities(document, target, entries);
    });
    CsBind.autoTagged += n;
    return n;
};

/**
 * {tripId: [station names]} for a DOCUMENT, for the listener -- which
 * has a document and no survey model. QCAD only, and never throws: a
 * drawing whose survey cannot be read back gives no inference, which
 * costs a trip tag rather than a stroke.
 *
 * The revision paths do not come through here; they already hold the
 * reconstructed survey the revision is being computed from, and pass
 * CsRevise.tripStationNames of it.
 */
CsBind.tripStationsOf = function(document) {
    try {
        if (typeof CsRevise === "undefined" ||
                typeof CsRevise.surveyFromDocument !== "function") {
            return null;
        }
        var recon = CsRevise.surveyFromDocument(document);
        if (recon === undefined || recon === null) {
            return null;
        }
        return CsRevise.tripStationNames(recon.survey);
    } catch (e) {
        CsBind.lastError = "couldn't read the survey back to work out " +
            "which trip this belongs to (" + e + ")";
        return null;
    }
};
