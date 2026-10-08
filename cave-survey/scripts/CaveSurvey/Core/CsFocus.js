// CsFocus.js -- which entities belong to which trips, teams, people and
// survey runs, and therefore what a focus selection shows.
//
// Part of the Cave Survey Core library: pure functions over an entity's
// TAGS. Nothing here touches a document, an operation or a widget, so
// the whole file is testable headless -- which matters, because the
// thing it decides (is this entity part of that trip?) is invisible
// when it is wrong. Applying the answer is TripFocus' job.
//
// FOCUS IS A SET OF STATION NAMES. Every row type in the window reduces
// to one: a trip's stations come from CsRevise.tripStationNames, a
// team's or a person's is the union over their trips, a run's is its own
// station list. One primitive, so a Teams row and a Runs row cannot
// disagree about what "in focus" means.
//
// THE FAIL-SAFE RULE: an entity this file cannot attribute to any
// station STAYS VISIBLE. Title block, border, sheet, basemap, symbols,
// the reader's own untagged sketches. This is the same doctrine the
// deleted Cave Mode used for menus -- an unknown thing showing is
// clutter, which is recoverable; an unknown thing vanishing is a
// support call.
//
// THE INVARIANT, pinned by a test: TAG_RULES below reads the same tags
// CsDraw.eraseStations reads. Those two lists are the drawing's only
// answers to "which station does this entity belong to". A tag added to
// erase and not here means geometry a redraw replaces but a focus
// cannot see; added here and not to erase means a redraw orphans it.
// The test parses eraseStations' body and fails either way.

var CsFocus = {};

/** How each tag's value maps to station names, keyed by MODE (the
 *  `mode` field below), not by tag:
 *    "one"  -- the tag's value (after `base`, if given) is one station
 *              name.
 *    "pair" -- the value is an "A1->A2" pair; the entity belongs to
 *              both ends (see ALL_ENDS_MODES below).
 *    "list" -- the value is a "|"-joined station LIST (CsBind.
 *              decodeStations); the entity belongs to any one of them.
 *  `base` is applied to the tag value first (CsBind.lrudBase /
 *  splayBase), to recover the station an LRUD or splay TIP belongs to
 *  from its own suffixed name. */
CsFocus.TAG_RULES = [
    { tag: "Station",          mode: "one" },
    { tag: "StationLabel",     mode: "one" },
    { tag: "LRUDName",         mode: "one", base: "lrud" },
    { tag: "LRUDLine",         mode: "one", base: "lrud" },
    { tag: "LRUDNote",         mode: "one" },
    { tag: "Splay",            mode: "one", base: "splay" },
    { tag: "SplayName",        mode: "one", base: "splay" },
    { tag: "SplayLabel",       mode: "one", base: "splay" },
    { tag: "NoteLabel",        mode: "one" },
    { tag: "NoteLeader",       mode: "one" },
    // A pitch label hangs off the station the pitch drops from, so it
    // is attributed to that one station exactly as a note is.
    { tag: "PitchLabel",       mode: "one" },
    { tag: "PitchLeader",      mode: "one" },
    { tag: "Shot",             mode: "pair" },
    { tag: "RawStation",       mode: "one" },
    { tag: "RawShot",          mode: "pair" },
    { tag: "WallRunStations",  mode: "list" },
    { tag: "LineworkStations", mode: "list", kind: "linework" },
    { tag: "ProfileStation",   mode: "one",  kind: "profile" }
];

/** Which MODES (see TAG_RULES above) need every station in focus, as
 *  against any one of them. Only "pair" does: a LEG is the drawing's
 *  only record of a shot between two stations, so it belongs to both.
 *  "list" (WallRunStations) is deliberately OR, not AND -- a wall run
 *  generated from a chain should show beside any focused station it
 *  touches, even if the chain wandered briefly out of focus.
 *
 *  THAT OR CHOICE IS CORRECT ONLY ONCE WallRunStations CARRIES A RUN'S
 *  OWN STATIONS -- and now it does. Before commit 14af1ca ("a wall run
 *  carries its own stations, not the whole survey's"), CsDraw.js built
 *  one `allNames` string from EVERY resolved station in the WHOLE
 *  drawing and wrote that same string onto every wall run it drew,
 *  whichever trip or run the wall belonged to, so under OR every wall
 *  run in the cave matched every focus selection -- a single-trip view
 *  came back with the whole cave's dashed walls overlaid, not just
 *  that trip's. 14af1ca fixed the tagging at the source (CsLrud/CsDraw
 *  now tag each wall run with only the stations its own chain
 *  followed), which is what makes OR correct here rather than merely
 *  convenient. DO NOT read that fix as license to switch this to AND:
 *  a wall run generated from a chain that wandered one station out of
 *  focus is still meant to show, and AND would hide it. A drawing
 *  drawn or redrawn BEFORE 14af1ca keeps ALL of its wall runs visible
 *  under every selection until it is redrawn; only a redraw performed
 *  after that commit corrects it for that drawing. */
CsFocus.ALL_ENDS_MODES = { pair: true };

/** Applies a TAG_RULES `base` (see above) to a raw tag value, so a
 *  station-derived tip name (an LRUD or splay suffix) becomes the
 *  station it belongs to. Called once per rule inside stationsOf; not
 *  meaningful on its own. */
CsFocus.applyBase = function(value, base) {
    if (base === "lrud") {
        return CsBind.lrudBase(value);
    }
    if (base === "splay") {
        return CsBind.splayBase(value);
    }
    return value;
};

/**
 * The stations an entity belongs to.
 *
 * FIRST MATCH WINS: the rules are tried in TAG_RULES order and the
 * first one whose tag is present (and non-empty after its mode is
 * applied) decides the answer -- later rules are never consulted. That
 * puts LineworkStations (last in TAG_RULES) behind all 13 suite tags
 * ahead of it: an entity carrying both a suite tag and LineworkStations
 * would be attributed by the suite tag, not the linework one. No
 * entity the suite draws carries both today, so this is latent -- but
 * it means the tag-parity test below pins list MEMBERSHIP only, not
 * priority. eraseStations does NOT share this risk: it tests
 * CsBind.hasLineworkTags(e) first, before any per-tag rule, precisely
 * so linework always wins there. A future hybrid entity (both a suite
 * tag and a linework tag) would erase safely but focus by the wrong
 * rule, silently.
 *
 * LineworkStations also serves two different name namespaces: CsBind.
 * tagEntities writes plain station names onto plan-frame linework,
 * while CsProfileBind.claim writes run-qualified names ("A/A2|A/A3")
 * onto profile-frame linework. This function treats both the same way
 * -- as station names -- which is only safe because CsProfileBind's
 * output lives on PROFILE-* and CTRL-PROFILE-* layers and the CALLER
 * (isVisible's caller, via isPlanFrame) hides those layers outright.
 * The correctness that makes this benign lives outside this function.
 *
 * \return {names: [stationName], kind: "suite"|"linework"|"profile"|
 *          "none", mode: the matched rule's mode ("one"|"pair"|"list"),
 *          or "" when nothing matched}
 */
CsFocus.stationsOf = function(entity) {
    for (var i = 0; i < CsFocus.TAG_RULES.length; i++) {
        var rule = CsFocus.TAG_RULES[i];
        var value = CsTags.get(entity, rule.tag);
        if (value === "") {
            continue;
        }
        var names = [];
        if (rule.mode === "pair") {
            // A pair that is not exactly two non-empty ends ("A1->",
            // "->A2", a stray extra "->") does not attribute to just
            // the one end it does have -- eraseStations' own pair rule
            // (CsDraw.js, the Shot branch) requires ends.length === 2
            // and ignores anything else, and stationsOf has to agree
            // or a half-written pair could show under a focus
            // eraseStations would never touch. Reachable only from
            // hand-edited or truncated XDATA, never from a normal draw.
            var ends = String(value).split("->");
            if (ends.length === 2 && ends[0] !== "" && ends[1] !== "") {
                names.push(ends[0]);
                names.push(ends[1]);
            }
        } else if (rule.mode === "list") {
            var members = CsBind.decodeStations(value);
            for (var m = 0; m < members.length; m++) {
                if (members[m] !== "") {
                    names.push(members[m]);
                }
            }
        } else {
            var one = CsFocus.applyBase(value, rule.base);
            if (one !== "") {
                names.push(one);
            }
        }
        if (names.length === 0) {
            continue;   // a tag present but empty attributes nothing
        }
        return {
            names: names,
            kind: (rule.kind === undefined) ? "suite" : rule.kind,
            mode: rule.mode
        };
    }
    return { names: [], kind: "none", mode: "" };
};

/**
 * Is this entity in focus?
 *
 * \param stationSet {name: true}, or null/undefined for "All"
 */
CsFocus.isVisible = function(entity, stationSet) {
    if (stationSet === undefined || stationSet === null) {
        return true;   // All: nothing is filtered
    }
    var att = CsFocus.stationsOf(entity);
    if (att.kind === "none") {
        return true;   // the fail-safe rule -- see the file header
    }
    var needsAll = CsFocus.ALL_ENDS_MODES[att.mode] === true;
    var anyIn = false;
    for (var i = 0; i < att.names.length; i++) {
        var hit = stationSet[att.names[i]] === true;
        if (needsAll && !hit) {
            return false;
        }
        if (hit) {
            anyIn = true;
        }
    }
    return anyIn;
};

/** Plan frame or not. Nathan's decision: the viewer is plan only, so
 *  the profile band is hidden whatever is checked. Delegates to
 *  CsLayers.frameOf so the two spellings of the profile frame
 *  (CTRL-PROFILE-* generated, PROFILE-* traced) stay in one place. */
CsFocus.isPlanFrame = function(layerName) {
    return CsLayers.frameOf(layerName) !== "profile";
};

/**
 * The station set a window selection makes.
 *
 * \param picked {trips: [tripId], teams: [teamText], people: [name],
 *                runs: [runKey]} -- any key may be absent; null/
 *                undefined (or a null/undefined picked itself) is
 *                treated as "picked nothing"
 * \param tripStations {tripId: [stationName]} from
 *                     CsRevise.tripStationNames
 * \param runStations {runKey: [stationName]} -- NOT CsProfile.
 *                     groupRuns(resolved) itself: that returns
 *                     {runs, order, ungrouped} where runs[key] is
 *                     {key, stations}. Build this parameter as
 *                     {runKey: grouped.runs[runKey].stations} from
 *                     that, one line at each call site. Passing
 *                     groupRuns' result directly compiles, throws
 *                     nothing, and silently contributes zero stations
 *                     for every run -- see the test below that pins
 *                     this trap.
 * \param tripsForGroup a map this function treats as OPAQUE: each key
 *                      is exactly the string a Teams or People row's
 *                      `pick` carries, and each value is that group's
 *                      [tripId]. TripFocusRows.tripsForGroup is the one
 *                      producer today, and it prefixes every key --
 *                      "team:" + the team text verbatim, "person:" +
 *                      CsContrib.personKey(name) -- so a solo trip
 *                      whose team text happens to equal its one
 *                      member's name still gets two independent keys
 *                      ("team:Nathan" vs "person:NATHAN") rather than
 *                      colliding into one, which is a real bug this
 *                      file used to be exposed to before the prefix
 *                      was added on the producer side. This function
 *                      does not need to know the prefix scheme; it
 *                      only needs `groups[g][i]` (see below) to be the
 *                      exact same string tripsForGroup used as a key,
 *                      null/undefined (or a missing key) is treated as
 *                      "no trips for this group" -- any key may be
 *                      absent
 * \return {stationName: true}
 */
CsFocus.stationSet = function(picked, tripStations, runStations,
        tripsForGroup) {
    picked = (picked === undefined || picked === null) ? {} : picked;
    tripStations = (tripStations === undefined || tripStations === null) ?
        {} : tripStations;
    runStations = (runStations === undefined || runStations === null) ?
        {} : runStations;
    var set = {};
    var addTrip = function(id) {
        var names = tripStations[id];
        if (names === undefined || names === null) {
            return;
        }
        for (var i = 0; i < names.length; i++) {
            // tripStationNames pushes the blank TO of every splay; a
            // blank is not a station and must not enter the set, or
            // every entity tagged with an empty name reads as focused
            if (names[i] !== "" && names[i] !== null &&
                    names[i] !== undefined) {
                set[names[i]] = true;
            }
        }
    };

    var i, j, ids;
    if (picked.trips !== undefined && picked.trips !== null) {
        for (i = 0; i < picked.trips.length; i++) {
            addTrip(picked.trips[i]);
        }
    }
    var groups = [picked.teams, picked.people];
    for (var g = 0; g < groups.length; g++) {
        if (groups[g] === undefined || groups[g] === null) {
            continue;
        }
        for (i = 0; i < groups[g].length; i++) {
            ids = (tripsForGroup === undefined || tripsForGroup === null) ?
                null : tripsForGroup[groups[g][i]];
            if (ids === undefined || ids === null) {
                continue;
            }
            for (j = 0; j < ids.length; j++) {
                addTrip(ids[j]);
            }
        }
    }
    if (picked.runs !== undefined && picked.runs !== null) {
        for (i = 0; i < picked.runs.length; i++) {
            var members = runStations[picked.runs[i]];
            if (members === undefined || members === null) {
                continue;
            }
            for (j = 0; j < members.length; j++) {
                // same three-way guard as addTrip's -- a run's station
                // list is not immune to a blank/null/undefined entry
                // any more than a trip's is
                if (members[j] !== "" && members[j] !== null &&
                        members[j] !== undefined) {
                    set[members[j]] = true;
                }
            }
        }
    }
    return set;
};

/** True when the selection picked nothing at all -- the window shows
 *  everything rather than an empty view, because a blank drawing looks
 *  like a broken tool. A null/undefined `picked` is itself "picked
 *  nothing", the same contract stationSet uses. */
CsFocus.isEmptySelection = function(picked) {
    picked = (picked === undefined || picked === null) ? {} : picked;
    var keys = ["trips", "teams", "people", "runs"];
    for (var i = 0; i < keys.length; i++) {
        var list = picked[keys[i]];
        if (list !== undefined && list !== null && list.length > 0) {
            return false;
        }
    }
    return true;
};
