// CsSketch.js -- what a Therion sketch's vocabulary MEANS here.
//
// Part of the Cave Survey Core library: pure data and pure functions,
// no document and no GUI, so tests/js_unit.js runs all of it.
//
// THE ONE PLACE THERION'S WORDS STOP. CsTherion2 reads a .th2 into a
// neutral model still wearing Therion's own type names ("wall",
// "floor-step", "stalactite", "u:bolt-hanger"). This file turns each
// of those into a CaveCAD instruction -- a layer, a shaped-line style,
// a catalogue block, an area pattern -- and nothing downstream of it
// ever sees a Therion word again. Same division CsLayers keeps for
// layer names and CsSymbols for blocks: one file to change when a
// mapping is wrong, and a test that fails if it names something that
// does not exist.
//
// WHAT AN ACTION LOOKS LIKE. Every resolver answers with
// {kind, ...} and the kind is the whole decision:
//
//   {kind: "layer",  layer}          ordinary ink on a feature layer
//   {kind: "shape",  style}          a shaped line; CsShapeLine grows
//                                    the ornament, and regrows it on
//                                    every later edit
//   {kind: "area",   pattern}        a CsArea.CATALOG key
//   {kind: "symbol", block}          a CsSymbols.CATALOG block
//   {kind: "text",   layer}          lettering
//   {kind: "callout"}                a note bound to a leader
//   {kind: "skip",   why}            read, counted, deliberately not
//                                    drawn
//   {kind: "unknown", layer}         kept on the catch-all layer, and
//                                    reported
//
// WHY "skip" IS NOT "unknown". They read the same on the map -- no ink
// either way -- and mean opposite things. A skip is a decision this
// suite has made (the centreline is already drawn; an invisible wall
// was drawn invisible on purpose). An unknown is a gap in this table,
// and a caver seeing one reported may well want to tell us about it.
// Collapsing the two would bury the second in the first.
//
// UNKNOWNS ARE KEPT, not dropped. Therion's vocabulary grows with
// every release and cavers define their own types freely ("u:" is the
// documented way to do it). A sketch arriving with its walls missing
// because one unrecognised word appeared is a far worse failure than
// one with a stray line on NOTES-ANNOTATION that a caver can see,
// select and move.

var CsSketch = {};

// Where anything unrecognised lands: visible, on a layer that is
// plainly not a wall, and easy to select as a group.
CsSketch.FALLBACK_LAYER = CsLayers.NOTES_ANNOTATION;

// ---------------------------------------------------------------------
// Lines.
// ---------------------------------------------------------------------

// A wall's -subtype is a statement about how well it is KNOWN, which
// is exactly the distinction WALLS-SURVEYED and WALLS-INFERRED carry
// -- and, as Build Legend's own help says, the one a beginner reader
// most often gets wrong. The rock-* subtypes describe what the wall is
// MADE of, which this suite does not draw differently, so they take
// the surveyed layer like any other measured wall.
CsSketch.WALL_SUBTYPES = {
    "presumed": { kind: "layer", layer: CsLayers.WALLS_INFERRED },
    "unsurveyed": { kind: "layer", layer: CsLayers.WALLS_INFERRED },
    "underlying": { kind: "layer", layer: CsLayers.WALLS_INFERRED },
    // Therion draws nothing for an invisible wall either: it is there
    // to close an area's boundary, not to be seen. Drawing it would
    // put a line across the passage that the sketcher had explicitly
    // asked not to appear.
    "invisible": { kind: "skip", why: "invisible" },
    "pit": { kind: "shape", style: "pit" },
    "blocks": { kind: "layer", layer: CsLayers.BREAKDOWN_BOUNDARY },
    "flowstone": { kind: "shape", style: "flowstone" }
};

CsSketch.LINES = {
    "wall": { kind: "layer", layer: CsLayers.WALLS_SURVEYED },

    // The five that arrive as real symbology rather than as a line on
    // a layer. CsShapeLine regenerates the ornament whenever the spine
    // is edited, so an imported ledge behaves exactly like one drawn
    // by hand here -- which is the whole claim of importing ink rather
    // than a reference underlay.
    "pit": { kind: "shape", style: "pit" },
    "slope": { kind: "shape", style: "slope" },
    "floor-step": { kind: "shape", style: "floorledge" },
    "ceiling-step": { kind: "shape", style: "ceilingledge" },
    "flowstone": { kind: "shape", style: "flowstone" },

    // Therion has no rimstone LINE -- it is a point and an area there
    // -- so CsShapeLine's "rimstone" style has no row in this table.
    // The mapping is one-way, and deliberately not faked.

    "water-flow": { kind: "layer", layer: CsLayers.WATER_PERENNIAL },
    "dripline": { kind: "layer", layer: CsLayers.DRIPLINE },
    "overhang": { kind: "layer", layer: CsLayers.OVERHANG_LEDGE },
    "chimney": { kind: "layer", layer: CsLayers.CLIMBS_CHIMNEYS },
    "rock-border": { kind: "layer", layer: CsLayers.BREAKDOWN_BOUNDARY },
    "rock-edge": { kind: "layer", layer: CsLayers.BREAKDOWN },
    "ceiling-meander": { kind: "layer", layer: CsLayers.CEILING },
    "floor-meander": { kind: "layer", layer: CsLayers.FLOOR_SLOPE },
    "contour": { kind: "layer", layer: CsLayers.FLOOR_SLOPE },
    "gradient": { kind: "layer", layer: CsLayers.FLOOR_SLOPE },
    "section": { kind: "layer", layer: CsLayers.CROSS_SECTION_MARKERS },
    "arrow": { kind: "layer", layer: CsLayers.NOTES_ANNOTATION },
    "label": { kind: "layer", layer: CsLayers.TEXT_LABELS },

    // A border exists to bound an area. One that an area claims is
    // consumed there (CsSketch.borderIds); one nothing claims is still
    // a shape somebody drew, so it lands on the boundary layer rather
    // than vanishing.
    "border": { kind: "layer", layer: CsLayers.CTRL_AREA_BOUNDARY },

    // The centreline, which the .th already brought in as SURVEY DATA
    // -- with its stations, its shots, its LRUD and its trips. Drawing
    // the sketch's own copy over it would be a second opinion about
    // where the cave is, drawn by hand, on top of the measured one.
    "survey": { kind: "skip", why: "centreline" },

    "u": { kind: "unknown", layer: CsSketch.FALLBACK_LAYER }
};

// ---------------------------------------------------------------------
// Points.
// ---------------------------------------------------------------------

// "station" and "section" never reach this table: CsTherion2 pulls
// both out of the point list, because neither is a symbol. A station
// is the tie between the sketcher's coordinates and the cave's, and
// the drawing already letters its own stations; a section is a
// reference to another scrap.
CsSketch.POINTS = {
    "stalactite": { kind: "symbol", block: "SYM_STALACTITE" },
    "soda-straw": { kind: "symbol", block: "SYM_SODA_STRAW" },
    "disc-stalactite": { kind: "symbol", block: "SYM_STALACTITE" },
    "ice-stalactite": { kind: "symbol", block: "SYM_STALACTITE" },
    "stalagmite": { kind: "symbol", block: "SYM_STALAGMITE" },
    "disc-stalagmite": { kind: "symbol", block: "SYM_STALAGMITE" },
    "ice-stalagmite": { kind: "symbol", block: "SYM_STALAGMITE" },
    "stalactite-stalagmite": { kind: "symbol", block: "SYM_COLUMN" },
    "pillar": { kind: "symbol", block: "SYM_COLUMN" },
    "disc-pillar": { kind: "symbol", block: "SYM_COLUMN" },
    "ice-pillar": { kind: "symbol", block: "SYM_COLUMN" },
    "pillar-with-curtains": { kind: "symbol", block: "SYM_COLUMN" },
    "curtain": { kind: "symbol", block: "SYM_DRAPERY" },
    "flowstone": { kind: "symbol", block: "SYM_FLOWSTONE" },
    "flowstone-choke": { kind: "symbol", block: "SYM_FLOWSTONE_CHOKE" },
    "wall-calcite": { kind: "symbol", block: "SYM_FLOWSTONE" },
    "gours": { kind: "symbol", block: "SYM_RIMSTONE_DAM" },
    "moonmilk": { kind: "symbol", block: "SYM_MOONMILK_POPCORN" },
    "popcorn": { kind: "symbol", block: "SYM_MOONMILK_POPCORN" },
    "helictite": { kind: "symbol", block: "SYM_HELICTITE" },
    "crystal": { kind: "symbol", block: "SYM_CRYSTAL" },
    "gypsum": { kind: "symbol", block: "SYM_GYPSUM" },

    "blocks": { kind: "symbol", block: "SYM_BREAKDOWN" },
    "breakdown-choke": { kind: "symbol", block: "SYM_BREAKDOWN_CHOKE" },
    "debris": { kind: "symbol", block: "SYM_BREAKDOWN" },
    "clay": { kind: "symbol", block: "SYM_CLAY_MUD_TICK" },
    "clay-choke": { kind: "symbol", block: "SYM_CLAY_CHOKE" },
    "mudcrack": { kind: "symbol", block: "SYM_CLAY_MUD_TICK" },
    "sand": { kind: "symbol", block: "SYM_SAND_GRAVEL_DOT" },
    "pebbles": { kind: "symbol", block: "SYM_SAND_GRAVEL_DOT" },
    "guano": { kind: "symbol", block: "SYM_GUANO" },

    "entrance": { kind: "symbol", block: "SYM_ENTRANCE" },
    "water-flow": { kind: "symbol", block: "SYM_FLOW_ARROW" },
    "spring": { kind: "symbol", block: "SYM_SPRING" },
    "sump": { kind: "symbol", block: "SYM_SUMP" },
    "water-drip": { kind: "symbol", block: "SYM_DRIP_SEEP" },
    "water": { kind: "symbol", block: "SYM_DRIP_SEEP" },
    "gradient": { kind: "symbol", block: "SYM_SLOPE_TICK" },
    "steps": { kind: "symbol", block: "SYM_STEPS" },
    "passage-height": { kind: "symbol", block: "SYM_CEILING_HEIGHT" },

    // An altitude is a measured floor elevation with a number attached,
    // and the Callout tool already reads exactly that off the LRUD and
    // splays. Placing it as a callout rather than as lettering means
    // the note stays text-editable and keeps its leader.
    "altitude": { kind: "callout" },

    "label": { kind: "text", layer: CsLayers.TEXT_LABELS },
    "name": { kind: "text", layer: CsLayers.NOTES_NAME },
    "remark": { kind: "text", layer: CsLayers.NOTES_ANNOTATION },
    "date": { kind: "text", layer: CsLayers.NOTES_ANNOTATION },

    "dig": { kind: "symbol", block: "SYM_DIG" },
    "danger": { kind: "symbol", block: "SYM_DANGER" },
    "narrow-end": { kind: "symbol", block: "SYM_NARROW_END" },
    "low-end": { kind: "symbol", block: "SYM_LOW_END" },

    // A CONTINUATION IS A LEAD -- unsurveyed passage somebody stood in
    // front of and wrote down. The suite has no lead of its own yet, so
    // it lands on NOTES-DIG (the nearest thing: a place worth coming
    // back to) and CsSketch.resolvePoint reports it by name. When leads
    // get a tool, this row is the first thing that changes.
    "continuation": { kind: "symbol", block: "SYM_CONTINUATION" },

    "anchor": { kind: "symbol", block: "SYM_BOLT" },
    "rope": { kind: "symbol", block: "SYM_ROPE_DROP" },
    "rope-ladder": { kind: "symbol", block: "SYM_CABLE_LADDER" },
    "fixed-ladder": { kind: "symbol", block: "SYM_FIXED_LADDER" },
    "masonry": { kind: "symbol", block: "SYM_MASONRY" },
    "archeo-material": { kind: "symbol", block: "SYM_ARCHEO_MATERIAL" },
    "paleo-material": { kind: "symbol", block: "SYM_PALEO_MATERIAL" },
    "bones": { kind: "symbol", block: "SYM_BONES" },
    "root": { kind: "symbol", block: "SYM_ROOT" },
    "vegetable-debris": { kind: "symbol", block: "SYM_VEGETABLE_DEBRIS" },
    "seed-germ": { kind: "layer", layer: CsLayers.BIOLOGY },
    "ice": { kind: "layer", layer: CsLayers.ICE_SNOW },
    "snow": { kind: "layer", layer: CsLayers.ICE_SNOW },
    "bedrock": { kind: "layer", layer: CsLayers.GEOLOGY_JOINTS_FRACTURES },

    // xtherion's own scaffolding rather than cave: a dimension label
    // the sketch carries so a person reading the .th2 can check it, and
    // an "extra" marker that means nothing outside the editor.
    "dimensions": { kind: "skip", why: "editor" },
    "extra": { kind: "skip", why: "editor" },
    "air-draught": { kind: "symbol", block: "SYM_AIR_DRAUGHT" },
    "no-equipment": { kind: "skip", why: "editor" },

    "bat": { kind: "symbol", block: "SYM_BAT" },

    "tree-trunk": { kind: "symbol", block: "SYM_TREE_TRUNK" },

    "seed-germination": { kind: "symbol", block: "SYM_SEED_GERMINATION" },

    "archeo-excavation": { kind: "symbol", block: "SYM_ARCHEO_EXCAVATION" },

    "human-bones": { kind: "symbol", block: "SYM_HUMAN_BONES" },

    "altar": { kind: "symbol", block: "SYM_ALTAR" },

    "ex-voto": { kind: "symbol", block: "SYM_EX_VOTO" },

    "helictites": { kind: "symbol", block: "SYM_HELICTITE" },

    "pendant": { kind: "symbol", block: "SYM_PENDANT" },

    "cave-pearl": { kind: "symbol", block: "SYM_CAVE_PEARL" },

    "aragonite-crystal": { kind: "symbol", block: "SYM_CRYSTAL" },

    "aragonite": { kind: "symbol", block: "SYM_ARAGONITE" },

    "gypsum-flower": { kind: "symbol", block: "SYM_GYPSUM_FLOWER" },

    "volcano": { kind: "symbol", block: "SYM_VOLCANO" },

    "raft-cone": { kind: "symbol", block: "SYM_VOLCANO" },

    "clay-tree": { kind: "symbol", block: "SYM_CLAY_TREE" },

    "scallop": { kind: "symbol", block: "SYM_SCALLOP" },

    "flute": { kind: "symbol", block: "SYM_FLUTE" },

    "karren": { kind: "symbol", block: "SYM_KARREN" },

    "anastomosis": { kind: "symbol", block: "SYM_ANASTOMOSIS" },

    "bridge": { kind: "symbol", block: "SYM_BRIDGE" },

    "walkway": { kind: "symbol", block: "SYM_WALKWAY" },

    "handrail": { kind: "symbol", block: "SYM_HANDRAIL" },

    "gate": { kind: "symbol", block: "SYM_GATE" },

    "camp": { kind: "symbol", block: "SYM_CAMP" },

    "nameplate": { kind: "symbol", block: "SYM_NAMEPLATE" },

    // Plural and spelling forms Therion accepts for the same glyph, found
    // by the 2026-10 coverage audit: they placed nothing before.
    "stalactites": { kind: "symbol", block: "SYM_STALACTITE" },
    "disc-stalactites": { kind: "symbol", block: "SYM_STALACTITE" },
    "stalagmites": { kind: "symbol", block: "SYM_STALAGMITE" },
    "disc-stalagmites": { kind: "symbol", block: "SYM_STALAGMITE" },
    "stalactites-stalagmites": { kind: "symbol", block: "SYM_COLUMN" },
    "disc-pillars": { kind: "symbol", block: "SYM_COLUMN" },
    "pillars-with-curtains": { kind: "symbol", block: "SYM_COLUMN" },
    "curtains": { kind: "symbol", block: "SYM_DRAPERY" },
    "rimstone-dam": { kind: "symbol", block: "SYM_RIMSTONE_DAM" },
    "rimstone-pool": { kind: "symbol", block: "SYM_RIMSTONE_DAM" },
    "traverse": { kind: "symbol", block: "SYM_TRAVERSE_LINE" },
    "mud": { kind: "symbol", block: "SYM_CLAY_MUD_TICK" },
    "height": { kind: "callout" },

    "u": { kind: "unknown", layer: CsSketch.FALLBACK_LAYER }
};

// ---------------------------------------------------------------------
// Areas.
// ---------------------------------------------------------------------

// Near one-for-one, and not by coincidence: Area Fill's thirteen
// patterns were drawn from the UIS/Therion vocabulary in the first
// place, so this table is mostly a spelling change.
CsSketch.AREAS = {
    "water": { kind: "area", pattern: "WATER" },
    "sump": { kind: "area", pattern: "SUMP" },
    "sand": { kind: "area", pattern: "SAND" },
    "clay": { kind: "area", pattern: "CLAY" },
    "mudcrack": { kind: "area", pattern: "CLAY" },
    "pebbles": { kind: "area", pattern: "PEBBLES" },
    "debris": { kind: "area", pattern: "DEBRIS" },
    "blocks": { kind: "area", pattern: "BLOCKS" },
    "bedrock": { kind: "area", pattern: "BEDROCK" },
    "flowstone": { kind: "area", pattern: "FLOWSTONE" },
    "moonmilk": { kind: "area", pattern: "MOONMILK" },
    "ice": { kind: "area", pattern: "ICE" },
    "snow": { kind: "area", pattern: "ICE" },
    "guano": { kind: "area", pattern: "GUANO" },
    "bones": { kind: "area", pattern: "BONES" },

    "u": { kind: "unknown", layer: CsSketch.FALLBACK_LAYER }
};

// ---------------------------------------------------------------------
// Resolving.
// ---------------------------------------------------------------------

/**
 * Whether a Therion type name is one a caver invented.
 *
 * "u:bolt-hanger" is the documented way to define your own; some
 * exporters write a bare "u" with the name in an option instead.
 */
CsSketch.isUserType = function(type) {
    if (type === undefined || type === null) {
        return false;
    }
    return type === "u" || ("" + type).indexOf("u:") === 0;
};

/**
 * Looks a type up in one of the tables above.
 *
 * Returns the table's own row, never a copy: these are read-only
 * descriptors, and copying them per entity in a sketch with ten
 * thousand points would be a lot of garbage for no benefit.
 *
 * \return {action, known} -- known false when the row came from the
 *         "u" fallback rather than from the type itself, which is
 *         what the caller reports on.
 */
CsSketch.lookup = function(table, type) {
    if (type !== undefined && type !== null &&
            table.hasOwnProperty(type) && type !== "u") {
        return { action: table[type], known: true };
    }
    return { action: table.u, known: false };
};

/**
 * What to do with one line from a scrap.
 *
 * The subtype is consulted FIRST for a wall, because a wall's subtype
 * is the whole of what makes it inferred rather than surveyed -- and
 * that distinction is a statement about how much of the map was
 * measured, not a drawing preference.
 *
 * \param line a line from the CsTherion2 model.
 * \return {action, known}
 */
CsSketch.resolveLine = function(line) {
    if (line === undefined || line === null) {
        return { action: CsSketch.LINES.u, known: false };
    }
    if (line.type === "wall" && line.subtype !== null &&
            line.subtype !== undefined) {
        if (CsSketch.WALL_SUBTYPES.hasOwnProperty(line.subtype)) {
            return { action: CsSketch.WALL_SUBTYPES[line.subtype],
                known: true };
        }
        // An unknown wall subtype is still a WALL: the type carries
        // more meaning than the subtype does, and drawing it as an
        // ordinary surveyed wall is far closer to right than putting
        // it on the catch-all layer.
        return { action: CsSketch.LINES.wall, known: false };
    }
    return CsSketch.lookup(CsSketch.LINES, line.type);
};

/**
 * What to do with one point from a scrap.
 */
CsSketch.resolvePoint = function(point) {
    if (point === undefined || point === null) {
        return { action: CsSketch.POINTS.u, known: false };
    }
    return CsSketch.lookup(CsSketch.POINTS, point.type);
};

/**
 * What to do with one area from a scrap.
 */
CsSketch.resolveArea = function(area) {
    if (area === undefined || area === null) {
        return { action: CsSketch.AREAS.u, known: false };
    }
    return CsSketch.lookup(CsSketch.AREAS, area.type);
};

/**
 * The set of line ids an area claims as its boundary.
 *
 * A border line in that set is drawn as part of its area rather than
 * on its own, which is why this is computed once per scrap rather than
 * asked per line.
 *
 * \return a dict of id to true.
 */
CsSketch.borderIds = function(scrap) {
    var claimed = {};
    if (scrap === undefined || scrap === null ||
            scrap.areas === undefined) {
        return claimed;
    }
    for (var i = 0; i < scrap.areas.length; i++) {
        var ids = scrap.areas[i].lineIds;
        for (var j = 0; j < ids.length; j++) {
            claimed[ids[j]] = true;
        }
    }
    return claimed;
};

// Therion's point sizes, as a multiple of a symbol's native size. The
// Symbol Palette sets the same thing with a drag -- the distance from
// the press point is the symbol's radius -- so these are that gesture
// stated in words. "m" is native, which is what a point with no -scale
// gets.
CsSketch.POINT_SCALES = {
    "xs": 0.4, "s": 0.7, "m": 1.0, "l": 1.5, "xl": 2.2
};

/**
 * A point's -scale word as a size multiplier.
 *
 * Therion also allows a bare number, which it defines the same way.
 */
CsSketch.pointScale = function(word) {
    if (word === undefined || word === null || word === "") {
        return 1.0;
    }
    if (CsSketch.POINT_SCALES.hasOwnProperty(word)) {
        return CsSketch.POINT_SCALES[word];
    }
    var direct = parseFloat(word);
    if (!isNaN(direct) && direct > 0) {
        return direct;
    }
    return 1.0;
};
