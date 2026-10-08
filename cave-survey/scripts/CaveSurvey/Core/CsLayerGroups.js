// CsLayerGroups.js -- which group a layer belongs in.
//
// Part of the Cave Survey Core library. The classification is pure data
// -- a layer name in, a group name out -- and fileInto() at the bottom
// touches the document and is the only function here that does, the same
// split CsLayers draws between its registry and ensure().
//
// The palette that SHOWS the groups is CaveCAD's own Layer Manager,
// which knows nothing about caves. The template ships already filed
// (tools/sync_template_groups.js), so a new drawing needs nothing run on
// it; fileInto exists for the two cases the template cannot cover -- a
// drawing made before the groups existed, and the per-run variant layers
// a later trip adds. It is a pass in Repair Drawing rather than a menu
// entry of its own, because that is what it is: a drawing-wide tidy of
// something already there.
//
// EVERY LAYER IS FILED. An earlier cut of this left the plan's own ink
// unfiled so that Ungrouped would read as the working set; it does not
// survive contact with a real cave, where "Ungrouped" then holds the
// fifty-odd layers you care most about under a label that says nobody
// decided. Ungrouped is now what it says: the layers that arrived after
// the filing, and nothing else.
//
// THE VOCABULARY IS THE SYMBOL PALETTE'S. Structure, Floor, Formations,
// Water, Geology, Annotation, Survey and Sheet are the categories
// CsSymbols already files its 28 symbols under, so a caver who knows
// which drawer a symbol lives in knows which group its layer is in. Two
// words differ from that list and both are deliberate: "Passage" reads
// better than "Structure" on a cave map, and "Geology & Finds" widens
// the geology drawer to hold the biology, archaeology and rigging layers
// that have no symbol at all and would otherwise need a group each.
//
// WHAT IS NOT DERIVED FROM THE FRAME. The profile and section frames get
// one group each rather than a copy of the whole plan vocabulary: eight
// more groups holding PROFILE-FORMATIONS-* and friends would triple the
// row count to separate layers a caver switches together anyway. Notes
// and water inside those frames go with their frame, because a note
// belongs with the view it annotates.

var CsLayerGroups = {};

/**
 * The groups, in the order they are created and shown. Parents come
 * before their children, because creating a group inside one that does
 * not exist yet does nothing.
 *
 * The plan's ink first, because that is what a caver draws, then the
 * other two views, then what sits underneath, then the machinery, then
 * the page.
 */
CsLayerGroups.GROUPS = [
    "Plan",
    "Passage",
    "Floor",
    "Formations",
    "Water",
    "Geology & Finds",
    "Notes",
    "Profile",
    "Cross Sections",
    "Scans & Basemap",
    "Control",
    "Sheet"
];

/**
 * Which groups are nested, and inside what.
 *
 * SIX PLAN FAMILIES UNDER ONE PARENT, which is what keeps the palette
 * to six top level rows instead of eleven. "Plan" holds no layers of
 * its own -- classify never returns it -- and exists to be the single
 * switch for everything a caver draws in plan, with the families
 * underneath for when the switch is too coarse.
 *
 * One level deep and no more, which is all the palette draws.
 */
CsLayerGroups.PARENTS = function() {
    return {
        "Passage": CsLayerGroups.PLAN_GROUP,
        "Floor": CsLayerGroups.PLAN_GROUP,
        "Formations": CsLayerGroups.PLAN_GROUP,
        "Water": CsLayerGroups.PLAN_GROUP,
        "Geology & Finds": CsLayerGroups.PLAN_GROUP,
        "Notes": CsLayerGroups.PLAN_GROUP
    };
};

CsLayerGroups.PLAN_GROUP = "Plan";
CsLayerGroups.PASSAGE = "Passage";
CsLayerGroups.FLOOR = "Floor";
CsLayerGroups.FORMATIONS = "Formations";
CsLayerGroups.WATER = "Water";
CsLayerGroups.GEOLOGY = "Geology & Finds";
CsLayerGroups.NOTES = "Notes";
CsLayerGroups.PROFILE = "Profile";
CsLayerGroups.SECTIONS = "Cross Sections";
CsLayerGroups.SCANS = "Scans & Basemap";
CsLayerGroups.CONTROL = "Control";
CsLayerGroups.SHEET = "Sheet";

/**
 * Tracing sources and background imagery: the pictures under the map,
 * as opposed to the survey drawn on top of it.
 *
 * Their own group and NOT part of Control, which is the one change made
 * to the arrangement rather than copied from it. They are the heaviest
 * things on the screen and the toggle a caver reaches for most often
 * while tracing is "hide the scan, keep the stations" -- which a single
 * Control group cannot express.
 *
 * Matched as PREFIXES, so a per-run variant (CTRL-SCAN-A) lands with its
 * base.
 */
CsLayerGroups.SCAN_LAYERS = function() {
    return [
        CsLayers.CTRL_SCAN,
        CsLayers.CTRL_PROFILE_SCAN,
        CsLayers.CTRL_SECTION_SCAN,
        CsLayers.CTRL_AERIAL,
        CsLayers.CTRL_CONTOUR,
        CsLayers.CTRL_CONTOUR_MAJOR
    ];
};

/**
 * The page, plus the two layers CAD itself owns.
 *
 * CsLayers.SHEET_LAYERS already holds "0" and "Defpoints" alongside the
 * border and title block, and they stay together here. Layer 0 has to be
 * SOMEWHERE now that every layer is filed, and Sheet is the group least
 * likely to be switched off while working -- which matters, because
 * hiding layer 0 hides stray work, the exact fault Check Map exists to
 * find. NORTH-ARROW is added: it is page furniture and is not in
 * CsLayers.SHEET_LAYERS.
 */
CsLayerGroups.SHEET_FURNITURE = function() {
    return CsLayers.SHEET_LAYERS.concat([CsLayers.NORTH_ARROW]);
};

/**
 * The plan's own ink, by layer name, in the same categories the symbol
 * palette files symbols under.
 *
 * Written out rather than derived from a prefix, because these names
 * have no shared prefix to derive from -- WALLS-SURVEYED, DRIPLINE and
 * PITS-DOMES are all Passage and look nothing alike. A registry layer
 * missing from here is caught by a test rather than landing silently in
 * the wrong place.
 */
CsLayerGroups.PLAN_INK = function() {
    var map = {};
    var put = function(group, names) {
        for (var i = 0; i < names.length; i++) {
            if (names[i] !== undefined) {
                map[names[i]] = group;
            }
        }
    };

    // What the passage IS: its walls, its roof, and the ways in and out.
    put(CsLayerGroups.PASSAGE, [
        CsLayers.WALLS_SURVEYED, CsLayers.WALLS_INFERRED,
        CsLayers.WALL_GLYPHS, CsLayers.CEILING, CsLayers.LEDGE_CEILING,
        CsLayers.OVERHANG_LEDGE, CsLayers.DRIPLINE, CsLayers.ENTRANCE,
        CsLayers.PITS_DOMES, CsLayers.CLIMBS_CHIMNEYS
    ]);

    // What you are standing on, and what it is made of.
    put(CsLayerGroups.FLOOR, [
        CsLayers.FLOOR, CsLayers.FLOOR_SLOPE, CsLayers.SLOPE,
        CsLayers.LEDGE_FLOOR, CsLayers.BREAKDOWN,
        CsLayers.BREAKDOWN_BOUNDARY, CsLayers.SEDIMENT_CLAY_MUD,
        CsLayers.SEDIMENT_SAND_GRAVEL, CsLayers.GUANO, CsLayers.ICE_SNOW
    ]);

    put(CsLayerGroups.FORMATIONS, [
        CsLayers.FORMATIONS_DRIP, CsLayers.FORMATIONS_DRAPERY,
        CsLayers.FORMATIONS_FLOWSTONE, CsLayers.FORMATIONS_RIMSTONE,
        CsLayers.FORMATIONS_MOONMILK_POPCORN, CsLayers.FLOWSTONE,
        CsLayers.RIMSTONE
    ]);

    // The rock itself, what lives in it, what was left in it, and what
    // was bolted to it -- one drawer, because each is a layer or two and
    // they are read together when they are read at all.
    put(CsLayerGroups.GEOLOGY, [
        CsLayers.GEOLOGY_JOINTS_FRACTURES, CsLayers.BIOLOGY,
        CsLayers.ARCHAEOLOGY, CsLayers.ANCHORS_BOLTS
    ]);

    // Ceiling height is a measurement written on the map, which is why
    // the symbol palette files its symbol under Annotation and not Floor.
    put(CsLayerGroups.NOTES, [CsLayers.CEILING_HEIGHT]);

    // The mark in the PLAN saying where a section was cut. Survey
    // bookkeeping about the drawing, not a feature of the cave -- the
    // symbol palette files it under Survey for the same reason.
    put(CsLayerGroups.CONTROL, [CsLayers.CROSS_SECTION_MARKERS]);

    return map;
};

/**
 * \return The group \c layerName belongs in. Every layer gets one; an
 * unrecognised name answers Passage, for the same reason
 * CsLayers.frameOf answers "plan" -- the plan is where a caver's own
 * linework goes, and guessing the working view is the safe guess.
 */
CsLayerGroups.classify = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return CsLayerGroups.PASSAGE;
    }
    var name = String(layerName);
    var i;

    // Scans before Control: several of them carry the CTRL- prefix and
    // would otherwise be swallowed by it.
    var scans = CsLayerGroups.SCAN_LAYERS();
    for (i = 0; i < scans.length; i++) {
        if (scans[i] !== undefined &&
                (name === scans[i] || name.indexOf(scans[i] + "-") === 0)) {
            return CsLayerGroups.SCANS;
        }
    }

    var furniture = CsLayerGroups.SHEET_FURNITURE();
    for (i = 0; i < furniture.length; i++) {
        if (name === furniture[i]) {
            return CsLayerGroups.SHEET;
        }
    }

    // Named plan layers before any prefix rule: CROSS-SECTION-MARKERS is
    // in this table and must not be read as a SECTION- layer.
    var ink = CsLayerGroups.PLAN_INK();
    if (ink.hasOwnProperty(name)) {
        return ink[name];
    }

    // Everything generated, in every frame. Before the frame rules, so
    // CTRL-PROFILE-SHOTS is control rather than profile.
    if (name.indexOf("CTRL-") === 0) {
        return CsLayerGroups.CONTROL;
    }

    // The other two views carry their own notes, text and water.
    if (name.indexOf("PROFILE-") === 0) {
        return CsLayerGroups.PROFILE;
    }
    if (name.indexOf("SECTION-") === 0) {
        return CsLayerGroups.SECTIONS;
    }

    if (name.indexOf("NOTES-") === 0 || name.indexOf("TEXT-") === 0) {
        return CsLayerGroups.NOTES;
    }
    if (name.indexOf("WATER-") === 0) {
        return CsLayerGroups.WATER;
    }

    // A per-run variant of a named plan layer: WALLS-SURVEYED-A and the
    // like. Checked last, because every prefix rule above is cheaper and
    // more specific than walking the table.
    for (var base in ink) {
        if (ink.hasOwnProperty(base) && name.indexOf(base + "-") === 0) {
            return ink[base];
        }
    }

    return CsLayerGroups.PASSAGE;
};

/**
 * \return A map of group name -> layer names, for the layer names given.
 *
 * Every group in GROUPS appears as a key even when it has no members: a
 * cave with no cross sections yet should still show the group, so that
 * tracing one has somewhere obvious to go.
 */
CsLayerGroups.plan = function(layerNames) {
    var res = {};
    var i;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        res[CsLayerGroups.GROUPS[i]] = [];
    }
    for (i = 0; i < layerNames.length; i++) {
        res[CsLayerGroups.classify(layerNames[i])].push(layerNames[i]);
    }
    return res;
};


// ---------------------------------------------------------------------
// Layer states shipped with the template.
//
// A cave map alternates between two looks, and they are worth having
// before anybody saves one of their own: an empty state combo teaches
// nothing about what states are for.
// ---------------------------------------------------------------------

/**
 * The two records the shipped states use.
 *
 * VISIBILITY ONLY, deliberately. A LayerStates record may carry colour,
 * linetype and lineweight as well, and a state a caver SAVES carries
 * all of it -- but a state shipped in the template must not, or
 * applying "Plot ready" would also put every layer back to the palette
 * the template was built with and quietly undo Restyle Layers. A field
 * a record omits is left alone on restore, which is exactly what these
 * want.
 */
CsLayerGroups.SHOWN = function() {
    return { off: false, frozen: false };
};
CsLayerGroups.HIDDEN = function() {
    return { off: true, frozen: true };
};

CsLayerGroups.STATE_TRACING = "Tracing";
CsLayerGroups.STATE_PLOT = "Plot ready";

/**
 * \return { name: flags } for the states the template ships, given the
 * layer names it holds.
 *
 * TRACING is the working view: the scan and the survey skeleton both on,
 * so there is something to trace against and something to trace it onto,
 * and the page furniture off, because a border drawn round the paper is
 * in the way while you work.
 *
 * PLOT READY is what gets printed: nothing but the cave and the page.
 * The scans go because a plotted sheet carrying a photograph of
 * somebody's handwriting is the fault Sheet Setup already refuses, and
 * the control layers go because they are not map ink.
 */
CsLayerGroups.templateStates = function(layerNames) {
    var hiddenWhileTracing = [CsLayerGroups.SHEET];
    var hiddenWhenPlotting = [CsLayerGroups.SCANS, CsLayerGroups.CONTROL];

    var tracing = {};
    var plot = {};
    for (var i = 0; i < layerNames.length; i++) {
        var name = layerNames[i];
        var group = CsLayerGroups.classify(name);
        tracing[name] = hiddenWhileTracing.indexOf(group) >= 0 ?
            CsLayerGroups.HIDDEN() : CsLayerGroups.SHOWN();
        plot[name] = hiddenWhenPlotting.indexOf(group) >= 0 ?
            CsLayerGroups.HIDDEN() : CsLayerGroups.SHOWN();
    }

    var states = {};
    states[CsLayerGroups.STATE_TRACING] = tracing;
    states[CsLayerGroups.STATE_PLOT] = plot;
    return states;
};

/** The state names the template ships, in the order they appear. */
CsLayerGroups.STATES = [CsLayerGroups.STATE_TRACING, CsLayerGroups.STATE_PLOT];


// ---------------------------------------------------------------------
// The one function here that touches a document.
// ---------------------------------------------------------------------

/**
 * \return The Layer Manager's group model, or undefined if this build
 * has no such palette.
 *
 * Checked by name rather than assumed: the suite installs into stock
 * QCAD too, where the palette does not exist, and a ReferenceError from
 * a repair pass tells a caver nothing.
 */
CsLayerGroups.model = function() {
    if (typeof LayerGroups === "undefined") {
        return undefined;
    }
    return LayerGroups;
};

/**
 * Files every layer in \c doc into its group.
 *
 * ONLY EVER ADDS. A group a caver made by hand, and a layer they filed
 * by hand, are both left exactly as they are -- so this can be run on a
 * drawing somebody has already arranged without undoing their work. That
 * is also why there is no "reset to defaults": the arrangement is theirs
 * the moment they touch it.
 *
 * \return { groups: n, filed: n, already: n }, or undefined if the
 * palette is missing.
 */
CsLayerGroups.fileInto = function(doc) {
    var model = CsLayerGroups.model();
    if (model === undefined) {
        return undefined;
    }

    var names = model.layerNamesOf(doc).sort();
    var reg = model.readRegistry(doc);

    // Every group first, in GROUPS order, so the palette shows them in
    // that order even when one of them is still empty.
    var i;
    var created = 0;
    var parents = CsLayerGroups.PARENTS();
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        var group = CsLayerGroups.GROUPS[i];
        if (model.createGroup(reg, group, parents[group])) {
            created++;
        }
    }

    var filed = 0, already = 0;
    for (i = 0; i < names.length; i++) {
        if (model.addTo(reg, names[i], CsLayerGroups.classify(names[i]))) {
            filed++;
        } else {
            already++;
        }
    }

    var states = CsLayerGroups.seedStates(reg, names);

    model.writeRegistry(doc, reg);
    return { groups: created, filed: filed, already: already,
             states: states };
};

/**
 * Gives \c reg the two states the template ships, if it has not got
 * them.
 *
 * ONLY THE MISSING ONES, and never over the top of one that is already
 * there: a caver who has saved their own "Plot ready" means theirs, and
 * a repair pass that quietly replaced it with the shipped one would be
 * taking work away. That is the same rule the group half follows.
 *
 * This exists because a drawing made before the template carried
 * states has none, and nothing else would ever give it any -- Truitt
 * Cave came through its regroup with an empty state list and looked,
 * reasonably, as though it had lost them.
 *
 * \return How many states were added.
 */
CsLayerGroups.seedStates = function(reg, layerNames) {
    if (typeof LayerStates === "undefined") {
        return 0;
    }
    var wanted = CsLayerGroups.templateStates(layerNames);
    var added = 0;
    for (var i = 0; i < CsLayerGroups.STATES.length; i++) {
        var name = CsLayerGroups.STATES[i];
        if (!isNull(LayerStates.findState(reg, name))) {
            continue;
        }
        LayerStates.setState(reg, name, wanted[name]);
        added++;
    }
    return added;
};

// ---------------------------------------------------------------------
// Trip groups
// ---------------------------------------------------------------------

/** The parent every trip group hangs under. Its own row, so twelve
 *  trips do not push the six standard groups off the top of the
 *  palette. */
CsLayerGroups.TRIPS = "Trips";

/**
 * A TRIP OWNS NO LAYERS, so its group is DERIVED and re-derived rather
 * than assigned once.
 *
 * Provenance rides on entities as CsBind.TRIP_TAG, and splitting layers
 * by trip was rejected on purpose -- it would fragment a wall continued
 * on a later trip, and CsTrace.nearestEnd only ties within a layer, so
 * those fragments could never be joined again. That decision stands.
 *
 * What a trip DOES own is survey runs: its shots name stations, a
 * station names its run (CsProfile.runKeyOf), and a run has real layers
 * of its own -- the per-run profile variants CsLayerVariants makes. So
 * "Trip 3" means the layers of the runs trip 3 surveyed, which is the
 * useful thing a caver means when they say it: show me what I drew that
 * day.
 *
 * It is an ADDITIONAL membership, never a move. PROFILE-CEILING-B stays
 * in Profile and gains Trip 3, because the Layer Manager lets a layer
 * live in more than one group. Isolating a trip therefore costs nothing
 * from the standard arrangement.
 *
 * TWO TRIPS CAN SHARE A RUN -- run B continued the following weekend --
 * and both trip groups then hold its layers. That is the truth about
 * the layer, not a collision to resolve.
 *
 * \param survey a CsModel survey (normalized by CsModel.ensureTrips)
 * \return {tripId: [runKey]} in no particular order
 */
CsLayerGroups.runsOfTrips = function(survey) {
    var out = {};
    if (isNull(survey) || isNull(survey.shots)) {
        return out;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        var trip = sh.trip || 0;
        if (out[trip] === undefined) {
            out[trip] = [];
        }
        // A splay has no "to" station -- its far end is a point in the
        // air, not a station -- so only its "from" names a run.
        var ends = sh.splay === true ? [sh.from] : [sh.from, sh.to];
        for (var e = 0; e < ends.length; e++) {
            var key = CsProfile.runKeyOf(ends[e]);
            if (key === null || key === "") {
                continue;
            }
            if (out[trip].indexOf(key) < 0) {
                out[trip].push(key);
            }
        }
    }
    return out;
};

/**
 * The group name for a trip. "Trip 0" or "Trip 0 — Entrance series".
 *
 * The same label CsTripEdit.rows builds, so the name in the palette is
 * the name in the Edit Trip dialog. A trip RENAMED after this ran keeps
 * its old group until the filing is re-run, and the re-run then adds
 * the new name rather than renaming the old one -- the caver's own
 * groups are never renamed or deleted by a pass, and a group they may
 * have put layers into by hand is not this function's to take away.
 * CsLayerGroups.renameTripGroups closes that gap for the one caller
 * that knows a rename happened.
 */
CsLayerGroups.tripGroupName = function(tripId, trip) {
    var label = "Trip " + tripId;
    var name = (isNull(trip) || isNull(trip.name)) ? "" : String(trip.name);
    // THE NAME IS SHOWN AS IT IS, even when an importer has filled
    // every trip with the same string. Suppressing a trip name that
    // matched the cave's was tried and removed: there is no reliable
    // cave name to compare against. survey.name is trip 0's name
    // mirrored up for pre-trip readers (CsModel.ensureTrips), and
    // survey.caveName comes from the legacy SurveyName tag, which
    // stored caveName-or-name and is ambiguous by CsRevise's own
    // admission -- so on a real cave BOTH read as trip 0's name, and
    // the rule silently stripped the one trip whose name it could see.
    if (name !== "") {
        label += " — " + name;
    }
    // "|" separates records in the stored blob, so a trip named with
    // one would be unreadable. Replaced rather than refused: the trip
    // keeps its name, only the group spells it differently.
    return label.replace(/\|/g, "/");
};

/**
 * What the trip filing WOULD do -- pure, so it can be tested without a
 * document.
 *
 * \param survey     a CsModel survey
 * \param layerNames every layer in the drawing
 * \return [{group, runs: [runKey], layers: [name]}] in trip order
 */
CsLayerGroups.tripFiling = function(survey, layerNames) {
    var out = [];
    if (isNull(survey) || isNull(survey.trips)) {
        return out;
    }
    if (isNull(layerNames)) {
        layerNames = [];
    }
    var runsOf = CsLayerGroups.runsOfTrips(survey);

    // Layer -> its run, resolved once. A cave has three hundred layers
    // and a dozen trips, and asking the question per trip would parse
    // every name twelve times.
    var runOfLayer = {};
    var i;
    for (i = 0; i < layerNames.length; i++) {
        var parts = (typeof CsLayerVariants === "undefined") ? null :
            CsLayerVariants.split(layerNames[i]);
        if (parts !== null) {
            runOfLayer[layerNames[i]] = parts.token;
        }
    }

    for (var t = 0; t < survey.trips.length; t++) {
        var runs = runsOf[t] || [];
        var wanted = {};
        for (i = 0; i < runs.length; i++) {
            var clean = (typeof CsLayerVariants === "undefined") ? runs[i] :
                CsLayerVariants.sanitize(runs[i]);
            if (clean !== null) {
                wanted[clean] = true;
            }
        }
        var layers = [];
        for (i = 0; i < layerNames.length; i++) {
            if (wanted[runOfLayer[layerNames[i]]] === true) {
                layers.push(layerNames[i]);
            }
        }
        out.push({
            group: CsLayerGroups.tripGroupName(t, survey.trips[t]),
            runs: runs.slice(0),
            layers: layers
        });
    }
    return out;
};

/**
 * Files \c doc's trips into groups under "Trips".
 *
 * Reads the survey out of the drawing itself, so this needs nothing but
 * the document and can be re-run at any time. Re-running is expected:
 * a trip's per-run profile layers are created ON DEMAND, when somebody
 * first traces in that band, so a trip group filed the day the trip was
 * drawn is empty and fills in later.
 *
 * AN EMPTY TRIP GROUP IS CREATED ANYWAY. It says the trip exists and
 * nothing has been traced for it yet, which is worth seeing, and it
 * gives the caver somewhere to drag a layer by hand.
 *
 * ONLY EVER ADDS, like the rest of this module.
 *
 * \return { groups: n, filed: n, already: n }, or undefined when this
 * build has no Layer Manager or the drawing holds no survey.
 */
CsLayerGroups.fileTrips = function(doc) {
    if (CsLayerGroups.model() === undefined ||
            typeof CsRevise === "undefined") {
        return undefined;
    }
    // surveyFromDocument returns the RECONSTRUCTION, not the survey --
    // the survey is one field of it, beside the anchor and the
    // adjustment tags.
    var recon = CsRevise.surveyFromDocument(doc);
    return CsLayerGroups.fileTripsFrom(doc,
        isNull(recon) ? null : recon.survey);
};

/**
 * fileTrips with the survey handed in.
 *
 * THE SURVEY MUST BE THE WHOLE DRAWING'S, not one notebook page's. A
 * page survey numbers its trips from 0 for itself, so filing from one
 * would name the page's only trip "Trip 0" and file the drawing's
 * fourth trip under the first one's group. Every caller therefore
 * either reads the survey back out of the document or is the rebuild
 * that already holds all of it.
 */
CsLayerGroups.fileTripsFrom = function(doc, survey) {
    var model = CsLayerGroups.model();
    if (model === undefined) {
        return undefined;
    }
    if (isNull(survey) || isNull(survey.shots) || survey.shots.length === 0) {
        return undefined;
    }
    CsModel.ensureTrips(survey);

    var names = model.layerNamesOf(doc).sort();
    var plan = CsLayerGroups.tripFiling(survey, names);
    var reg = model.readRegistry(doc);

    var created = 0;
    if (model.createGroup(reg, CsLayerGroups.TRIPS)) {
        created++;
    }
    var filed = 0, already = 0;
    for (var i = 0; i < plan.length; i++) {
        if (model.createGroup(reg, plan[i].group, CsLayerGroups.TRIPS)) {
            created++;
        }
        for (var k = 0; k < plan[i].layers.length; k++) {
            if (model.addTo(reg, plan[i].layers[k], plan[i].group)) {
                filed++;
            } else {
                already++;
            }
        }
    }

    model.writeRegistry(doc, reg);
    return { groups: created, filed: filed, already: already,
             trips: plan.length };
};

/**
 * fileTrips that can never break the thing that called it.
 *
 * Every caller is a DRAW -- the survey is on the page, the undo step is
 * closed, and the caver is looking at their cave. Filing the trip into
 * a palette group is housekeeping that happens afterwards, and an
 * exception from it (a build with no palette, a drawing whose survey
 * will not read back) must not turn a successful draw into a stack
 * trace.
 *
 * \return the fileTrips result, or undefined if it could not run.
 */
CsLayerGroups.fileTripsQuietly = function(doc) {
    try {
        return CsLayerGroups.fileTrips(doc);
    }
    catch (e) {
        return undefined;
    }
};

/**
 * Follows a trip RENAME through to its group.
 *
 * Without this, correcting a trip's name in the Edit Trip dialog would
 * leave "Trip 3 — Nroth passage" in the palette and the next filing
 * pass would add "Trip 3 — North passage" beside it, so the typo
 * outlives the fix and the caver has two groups for one trip. A rename
 * is the one case where a pass may touch a group it did not just make:
 * the group is this module's own, named after the trip, and following
 * the trip is what it is for.
 *
 * Layers stay where they are -- renameGroup re-points the membership.
 *
 * \param changes CsTripEdit.planEdits changes: [{tripId, before, after}]
 * \return how many groups were renamed
 */
CsLayerGroups.renameTripGroups = function(doc, changes) {
    var model = CsLayerGroups.model();
    if (model === undefined || isNull(changes) || changes.length === 0) {
        return 0;
    }
    var reg = model.readRegistry(doc);
    var renamed = 0;
    for (var i = 0; i < changes.length; i++) {
        var c = changes[i];
        if (isNull(c.before) || isNull(c.after) ||
                c.before.name === c.after.name) {
            continue;
        }
        var from = CsLayerGroups.tripGroupName(c.tripId, c.before);
        var to = CsLayerGroups.tripGroupName(c.tripId, c.after);
        // Not if the new name is already a group: renameGroup would be
        // merging two groups, which is a bigger thing than a typo fix
        // and not one to do behind the caver's back. The filing pass
        // will fill the existing group instead.
        if (isNull(model.findGroup(reg, from)) ||
                !isNull(model.findGroup(reg, to))) {
            continue;
        }
        if (model.renameGroup(reg, from, to)) {
            renamed++;
        }
    }
    if (renamed > 0) {
        model.writeRegistry(doc, reg);
    }
    return renamed;
};
