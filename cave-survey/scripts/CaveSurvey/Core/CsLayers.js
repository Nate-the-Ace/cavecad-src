// Layers.js -- the one place layer names live.
//
// Part of the Cave Survey Core library. The registry itself is pure
// data; ensure() touches the document and is the only function here
// that does.
//
// The vocabulary is the NSS plan template's: CTRL- prefixed control
// layers for survey data, named feature layers for the map itself.
// The old importer invented its own layer names (ALIGNMENT, LRUD,
// STATIONS) that existed in no template; every tool now draws to the
// same names the templates carry, and this registry is tested against
// the template files so the two cannot drift apart again.

var CsLayers = {};

// Control layers -- survey data, not map art.
CsLayers.CTRL_SHOTS = "CTRL-SHOTS";
CsLayers.CTRL_STATIONS = "CTRL-STATIONS";
CsLayers.CTRL_STATION_LABELS = "CTRL-STATION-LABELS";
CsLayers.CTRL_LRUD = "CTRL-LRUD";
CsLayers.CTRL_SPLAYS = "CTRL-SPLAYS";
CsLayers.CTRL_HIDDEN = "CTRL-HIDDEN";
CsLayers.CTRL_RAW = "CTRL-RAW";
CsLayers.CTRL_AREA_BOUNDARY = "CTRL-AREA-BOUNDARY";
// Where the loop closure error went: one arrow per station the
// adjustment moved, and a label per loop. Generated, plan-frame, and
// OFF by default -- it is a diagnostic drawn over the map, not map ink,
// and a plotted sheet must never carry it by accident.
CsLayers.CTRL_CLOSURE = "CTRL-CLOSURE";
CsLayers.CTRL_LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";
CsLayers.CTRL_LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";
CsLayers.CTRL_PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";
CsLayers.CTRL_PROFILE_CEILING = "CTRL-PROFILE-CEILING";
CsLayers.CTRL_GRID = "CTRL-GRID";
CsLayers.CTRL_AERIAL = "CTRL-AERIAL";
// Surface contours derived from public elevation data -- background
// context like CTRL-AERIAL, generated and erased by their own tool.
// CTRL- keeps them out of CsBind's reach, like every generated layer.
CsLayers.CTRL_CONTOUR = "CTRL-CONTOUR";
CsLayers.CTRL_CONTOUR_MAJOR = "CTRL-CONTOUR-MAJOR";
// Inserted sketch scans -- tracing sources, not map art. CTRL- keeps
// them out of CsBind's reach like every other suite-managed layer.
CsLayers.CTRL_SCAN = "CTRL-SCAN";

// The profile frame's own control layers. EVERY ONE BEGINS "CTRL-",
// and that is load-bearing rather than cosmetic: CsBind's
// NEVER_LINEWORK_PREFIXES already refuses that prefix, so generated
// profile geometry stays ineligible for binding and moving with no
// change to CsBind at all. Drop the prefix and the generator's own
// output becomes bindable -- a test in js_unit.js asserts this.
//
// NAMING TRAP, READ BEFORE USING EITHER: CsLayers.CTRL_PROFILE_CEILING is
// the GENERATED layer CTRL-PROFILE-CEILING, which the generator owns
// and ERASES on every redraw. CsLayers.PROFILE_CEILING is the
// hand-traced PROFILE-CEILING, which is the user's own work and must
// NEVER be erased. The two constants are one word apart and mean
// opposite things. Same for floor.
CsLayers.CTRL_PROFILE_SHOTS = "CTRL-PROFILE-SHOTS";
CsLayers.CTRL_PROFILE_STATIONS = "CTRL-PROFILE-STATIONS";
CsLayers.CTRL_PROFILE_STATION_LABELS = "CTRL-PROFILE-STATION-LABELS";
CsLayers.CTRL_PROFILE_SPLAYS = "CTRL-PROFILE-SPLAYS";
CsLayers.CTRL_PROFILE_LRUD = "CTRL-PROFILE-LRUD";
// The generator's own band captions and its exaggeration stamp.
//
// CTRL-, like every other layer the generator owns. They used to share
// the caver's PROFILE-TEXT-LABELS, which made erase() the owner of a
// layer in the user's namespace AND made generated captions bindable
// linework as far as CsBind was concerned. Per-run variants multiplied
// that: PROFILE-TEXT-LABELS-A was a generator-owned layer sitting in the
// traced vocabulary. A test now asserts every layer in
// CsProfileDraw.LAYERS() is CTRL-, so this cannot drift back.
CsLayers.CTRL_PROFILE_TEXT_LABELS = "CTRL-PROFILE-TEXT-LABELS";
// The generated bounding box around each profile band, plus its name
// text. LOCKED (see CsLayers.LOCKED): the boxes are the suite's frame
// bookkeeping, not linework -- a caver never edits one.
CsLayers.CTRL_PROFILE_BOX = "CTRL-PROFILE-BOX";

// The profile frame's traceable layers -- what a caver draws on an
// elevation. These must NOT begin "CTRL-", for the mirror of the
// reason above: hand-traced profile linework has to stay bindable so
// it moves when the survey does.
CsLayers.PROFILE_CEILING = "PROFILE-CEILING";
CsLayers.PROFILE_FLOOR = "PROFILE-FLOOR";
CsLayers.PROFILE_WALLS_INFERRED = "PROFILE-WALLS-INFERRED";
CsLayers.PROFILE_TEXT_NOTES = "PROFILE-TEXT-NOTES";
CsLayers.PROFILE_TEXT_LABELS = "PROFILE-TEXT-LABELS";
CsLayers.PROFILE_BREAKDOWN = "PROFILE-BREAKDOWN";
CsLayers.PROFILE_ENTRANCE = "PROFILE-ENTRANCE";

// ---------------------------------------------------------------------
// THE SECTION FRAME -- cross sections, the suite's third view.
//
// Same split as the profile frame, for the same reasons: the CTRL- half
// is generated, owned by the section tool, erased and redrawn on every
// rebuild; the unprefixed half is the caver's own tracing and is never
// touched. Getting a layer on the wrong side of that line is what the
// NAMING TRAP note above is about.
//
// CROSS-SECTION-MARKERS is deliberately NOT here. It is the mark in the
// PLAN saying where a section was cut, so it belongs to the plan frame,
// and its name not starting "SECTION-" is the only thing keeping it
// there -- asserted in tests/js_unit.js rather than left to luck.
// ---------------------------------------------------------------------
CsLayers.CTRL_SECTION_BOX = "CTRL-SECTION-BOX";
CsLayers.CTRL_SECTION_OUTLINE = "CTRL-SECTION-OUTLINE";
// The sketch bay's reference outline, NOT the same layer as the real
// computed section above. SectionBay.addGhost draws the LRUD-derived
// outline a caver traces against; CsSectionDraw.define draws the real,
// FINAL outline once a section is placed. Both used to live on
// CTRL-SECTION-OUTLINE, which meant a ghost -- deleted the moment
// Capture runs, never meant to be mistaken for a finished section --
// rendered pixel-identical to one. A dedicated layer is what makes the
// ghost look provisional (DASHED, see DEFAULTS below) and gives a caver
// a switch to hide every open bay's scratch outline without touching
// real section geometry.
CsLayers.CTRL_SECTION_GHOST = "CTRL-SECTION-GHOST";
CsLayers.CTRL_SECTION_SPLAYS = "CTRL-SECTION-SPLAYS";
CsLayers.CTRL_SECTION_STATIONS = "CTRL-SECTION-STATIONS";
CsLayers.CTRL_SECTION_TEXT_LABELS = "CTRL-SECTION-TEXT-LABELS";
CsLayers.CTRL_SECTION_SCAN = "CTRL-SECTION-SCAN";

// The section frame's traceable layers -- what a caver draws in a
// section. NOT "CTRL-" prefixed, for the mirror of the reason above:
// hand-traced section linework has to stay eligible for binding the day
// sections learn to bind. Until then CsBind holds them out explicitly,
// because binding them with plan or profile logic would move them by a
// correction that has nothing to do with them.
CsLayers.SECTION_WALLS_SURVEYED = "SECTION-WALLS-SURVEYED";
CsLayers.SECTION_WALLS_INFERRED = "SECTION-WALLS-INFERRED";
CsLayers.SECTION_CEILING = "SECTION-CEILING";
CsLayers.SECTION_FLOOR = "SECTION-FLOOR";
CsLayers.SECTION_BREAKDOWN = "SECTION-BREAKDOWN";

// Callout (multileader) layers, one per CsCallout style. Callout
// members go here and never on the current layer -- a note drawn onto
// WALLS-SURVEYED becomes wall linework the next time anything works by
// layer.
// The plain note, and the default callout style.
CsLayers.NOTES_GENERAL = "NOTES-GENERAL";
CsLayers.NOTES_HAZARD = "NOTES-HAZARD";
CsLayers.NOTES_DIG = "NOTES-DIG";
CsLayers.NOTES_EQUIPMENT = "NOTES-EQUIPMENT";
CsLayers.NOTES_NAME = "NOTES-NAME";
CsLayers.NOTES_ELEVATION = "NOTES-ELEVATION";
CsLayers.NOTES_ELEVATION_LINE = "NOTES-ELEVATION-LINE";
CsLayers.NOTES_ANNOTATION = "NOTES-ANNOTATION";

// Feature layers the tools write to.
CsLayers.WALLS_SURVEYED = "WALLS-SURVEYED";
CsLayers.WALLS_INFERRED = "WALLS-INFERRED";
CsLayers.BREAKDOWN = "BREAKDOWN";
CsLayers.BREAKDOWN_BOUNDARY = "BREAKDOWN-BOUNDARY";
CsLayers.CROSS_SECTION_MARKERS = "CROSS-SECTION-MARKERS";
CsLayers.NORTH_ARROW = "NORTH-ARROW";
CsLayers.SCALE_BAR = "SCALE-BAR";
CsLayers.TITLE_BLOCK = "TITLE-BLOCK";
CsLayers.LEGEND = "LEGEND";
CsLayers.BORDER = "BORDER";
CsLayers.TEXT_LABELS = "TEXT-LABELS";
CsLayers.TEXT_NOTES = "TEXT-NOTES";
CsLayers.ENTRANCE = "ENTRANCE";

// Shaped Lines feature layers (spine + decoration both land here), and
// the hidden skeleton layer for the decor-only styles: a flowstone
// edge's spine is scaffolding, not map ink, so it lives on a CTRL layer
// that is OFF by default -- switch it on to grab and reshape the edge.
CsLayers.LEDGE_FLOOR = "LEDGE-FLOOR";
CsLayers.LEDGE_CEILING = "LEDGE-CEILING";
CsLayers.FLOWSTONE = "FLOWSTONE";
CsLayers.RIMSTONE = "RIMSTONE";
CsLayers.SLOPE = "SLOPE";
// Wall Glyphs (2026-09-12): a catalog symbol (default the stone-blocks
// glyph) walked along a spine like the ticks above, but its own layer
// rather than BREAKDOWN -- BREAKDOWN is floor bulk and this is wall
// ornament, and folding them together would conflate the two in
// Feature Trace's completeness badges and CheckMap's per-layer counts.
CsLayers.WALL_GLYPHS = "WALL-GLYPHS";
CsLayers.CTRL_SHAPE_SPINE = "CTRL-SHAPE-SPINE";
// The profile-frame twins: the SAME shaped-line buttons draw these
// when the stroke lands in the elevation (decided by location -- see
// CsProfileBox), because frameOf classifies by the PROFILE- prefix and
// a ledge drawn in the elevation on a plan-frame layer would count
// toward the plan's data window.
CsLayers.PROFILE_LEDGE_FLOOR = "PROFILE-LEDGE-FLOOR";
CsLayers.PROFILE_LEDGE_CEILING = "PROFILE-LEDGE-CEILING";
CsLayers.PROFILE_FLOWSTONE = "PROFILE-FLOWSTONE";
CsLayers.PROFILE_RIMSTONE = "PROFILE-RIMSTONE";
CsLayers.PROFILE_SLOPE = "PROFILE-SLOPE";
CsLayers.PROFILE_WALL_GLYPHS = "PROFILE-WALL-GLYPHS";
CsLayers.CTRL_PROFILE_SHAPE_SPINE = "CTRL-PROFILE-SHAPE-SPINE";

// ---------------------------------------------------------------------
// THE NSS SYMBOL LAYERS -- the plan template's feature vocabulary.
//
// These 25 shipped in NSS_Cave_Template_PLAN.dxf from the beginning and
// were never registry constants, which had two consequences worth
// stating because both were silent: a drawing that never saw the
// template got them from CsLayers.ensure's white/CONTINUOUS/0.25
// FALLBACK rather than from any considered appearance, and they had no
// PROFILE- or SECTION- twin, so a caver could not draw water or
// flowstone in an elevation or a section at all. Registered here, they
// get both -- the twins come from the derivation at the bottom of this
// file, not from 50 more hand-written lines.
// ---------------------------------------------------------------------
CsLayers.WATER_PERENNIAL = "WATER-PERENNIAL";
CsLayers.WATER_INTERMITTENT = "WATER-INTERMITTENT";
CsLayers.WATER_POOL_SUMP = "WATER-POOL-SUMP";
CsLayers.WATER_SIPHON = "WATER-SIPHON";
CsLayers.WATER_SPRING_RESURGENCE = "WATER-SPRING-RESURGENCE";
CsLayers.WATER_DRIP_SEEP = "WATER-DRIP-SEEP";
CsLayers.WATER_FLOW_ARROWS = "WATER-FLOW-ARROWS";
CsLayers.DRIPLINE = "DRIPLINE";
CsLayers.FORMATIONS_FLOWSTONE = "FORMATIONS-FLOWSTONE";
CsLayers.FORMATIONS_RIMSTONE = "FORMATIONS-RIMSTONE";
CsLayers.FORMATIONS_DRAPERY = "FORMATIONS-DRAPERY";
CsLayers.FORMATIONS_DRIP = "FORMATIONS-DRIP";
CsLayers.FORMATIONS_MOONMILK_POPCORN = "FORMATIONS-MOONMILK-POPCORN";
CsLayers.SEDIMENT_SAND_GRAVEL = "SEDIMENT-SAND-GRAVEL";
CsLayers.SEDIMENT_CLAY_MUD = "SEDIMENT-CLAY-MUD";
CsLayers.GUANO = "GUANO";
CsLayers.ICE_SNOW = "ICE-SNOW";
CsLayers.BIOLOGY = "BIOLOGY";
CsLayers.ARCHAEOLOGY = "ARCHAEOLOGY";
CsLayers.GEOLOGY_JOINTS_FRACTURES = "GEOLOGY-JOINTS-FRACTURES";
CsLayers.ANCHORS_BOLTS = "ANCHORS-BOLTS";
CsLayers.CLIMBS_CHIMNEYS = "CLIMBS-CHIMNEYS";
CsLayers.PITS_DOMES = "PITS-DOMES";
CsLayers.OVERHANG_LEDGE = "OVERHANG-LEDGE";
CsLayers.CEILING_HEIGHT = "CEILING-HEIGHT";
CsLayers.FLOOR_SLOPE = "FLOOR-SLOPE";

// ---------------------------------------------------------------------
// THE PALETTE -- what a layer looks like, and why.
//
// Defaults for creating a layer that is missing from the drawing
// (someone working without the template still gets sane colors), AND --
// since tools/sync_template_layers.js reads this table -- the appearance
// the shipped template itself carries. One table, both jobs.
//
// name -> [colorName, linetype, lineweightKey, linetypeFallback?]
// lineweightKey is resolved against RLineweight at ensure() time so
// this table stays loadable outside QCAD. The optional 4th element is
// the linetype to use when the drawing has no LTYPE record for the 3rd
// -- every NSS_* pattern lives in the template's linetype table and in
// no other drawing, so a row naming one without a fallback would have
// created layers with an invalid linetype id. See CsLayers.linetypeIdFor.
//
// THREE AXES, EACH CARRYING EXACTLY ONE MEANING. Mixing them is how the
// old table ended up with every traced layer white and section walls
// lighter than plan walls for no reason anyone could state:
//
//   COLOUR says WHAT THE THING IS. One hue per feature family:
//     white        surveyed rock boundary, sheet furniture
//     gray         uncertain, bulk fill, and every CTRL- layer
//     magenta      the CEILING family -- ceiling, ceiling ledge,
//                  overhang, ceiling-height traverse
//     peru         the FLOOR family -- floor, floor ledge, slope,
//                  pits/domes, sediment
//     deepskyblue  water, in every form, dripline included
//     gold         formations -- flowstone, rimstone, drapery, drip,
//                  moonmilk
//     limegreen    life and culture -- biology, archaeology, guano
//     cyan         rigging and gear -- anchors, climbs, equipment notes
//     slateblue    geology -- joints and fracture trends
//     red          danger and reference -- entrance, hazard notes,
//                  stations, station labels, section cut marks
//     pink         dig notes, and the LRUD control fans
//
//   LINEWEIGHT says HOW IMPORTANT, and nothing else:
//     Weight050  primary rock boundary (walls surveyed, ceiling, floor,
//                entrance)
//     Weight035  secondary boundary (walls inferred, floor ledge,
//                pits/domes, overhang)
//     Weight025  feature linework (flowstone, rimstone, ceiling ledge,
//                water edges, cut marks)
//     Weight018  annotation, text, symbols, callouts
//     Weight009  texture and fill (slope fans, sediment, breakdown
//                boundary, joints, dripline) and the few CTRL- layers
//                that need to be told apart from each other
//     Weight000  everything else CTRL-
//
//   LINETYPE says HOW CERTAIN: CONTINUOUS is measured, DASHED and the
//   NSS_* patterns are inferred, provisional or symbolic.
//
// CTRL- LAYERS WERE DELIBERATELY LIGHTENED. They used to sit at
// Weight025 -- the same weight as real feature linework -- so the survey
// scaffolding competed with the map drawn over it. Survey data is
// reference; it now reads underneath the sketch rather than through it.
//
// THE FRAME NEVER CHANGES THE APPEARANCE. There are no PROFILE-,
// SECTION-, CTRL-PROFILE- or CTRL-SECTION- rows in this table on
// purpose: every one of them is DERIVED from its plan row by the loop at
// the bottom of this file. A ceiling looks the same in plan, profile and
// section because there is only one row saying what a ceiling looks
// like. Before that, the twins were hand-copied and had drifted --
// section walls were 0.35 against plan's 0.50, SECTION-WALLS-INFERRED
// was white against plan's gray, and nothing failed.
//
// The one exception, CTRL-SECTION-GHOST, is listed below with its reason.
CsLayers.DEFAULTS = {
    // ---- rock boundaries: the map's primary linework ----------------
    "WALLS-SURVEYED": ["white", "CONTINUOUS", "Weight050"],
    "WALLS-INFERRED": ["gray", "NSS_INFERRED", "Weight035", "DASHED"],
    "ENTRANCE": ["red", "CONTINUOUS", "Weight050"],
    "CEILING": ["magenta", "CONTINUOUS", "Weight050"],
    "FLOOR": ["peru", "CONTINUOUS", "Weight050"],
    // Ceiling and floor detail. LEDGE-CEILING is DASHED at the LAYER,
    // which is what makes a Shaped Lines spine print as the NSS dashed
    // ledge line -- the ticks are separate entities on the same layer
    // and a tick is too short for a dash to land visibly.
    "LEDGE-CEILING": ["magenta", "DASHED", "Weight025"],
    "LEDGE-FLOOR": ["peru", "CONTINUOUS", "Weight035"],
    "OVERHANG-LEDGE": ["magenta", "NSS_OVERHANG", "Weight035", "DASHED"],
    "CEILING-HEIGHT": ["magenta", "NSS_DOTTED", "Weight018", "DASHED"],
    "PITS-DOMES": ["peru", "CONTINUOUS", "Weight035"],
    // Slope fans are texture, not boundary -- hairline, so a slope never
    // reads heavier than the wall beside it.
    "SLOPE": ["peru", "CONTINUOUS", "Weight009"],
    "FLOOR-SLOPE": ["peru", "CONTINUOUS", "Weight009"],
    // Wall Glyphs: gray, the same colour BREAKDOWN uses, because colour
    // says WHAT a thing is (stone) and this is the same material as the
    // floor's breakdown, just placed as wall ornament rather than floor
    // bulk -- Weight018 is the placed-SYMBOL weight (matching
    // BREAKDOWN's own row below), not BREAKDOWN-BOUNDARY's texture
    // weight, because a glyph IS the symbol, not a boundary around one.
    "WALL-GLYPHS": ["gray", "CONTINUOUS", "Weight018"],
    // Breakdown is bulk, not boundary: gray so a room full of it does
    // not shout over the walls containing it.
    "BREAKDOWN": ["gray", "CONTINUOUS", "Weight018"],
    "BREAKDOWN-BOUNDARY": ["gray", "NSS_DOTTED", "Weight009", "DASHED"],

    // ---- water ------------------------------------------------------
    "WATER-PERENNIAL": ["deepskyblue", "CONTINUOUS", "Weight025"],
    "WATER-INTERMITTENT": ["deepskyblue", "NSS_WATER_INTERMITTENT",
        "Weight018", "DASHED"],
    "WATER-POOL-SUMP": ["deepskyblue", "CONTINUOUS", "Weight018"],
    "WATER-SIPHON": ["deepskyblue", "CONTINUOUS", "Weight025"],
    "WATER-SPRING-RESURGENCE": ["deepskyblue", "CONTINUOUS", "Weight025"],
    "WATER-DRIP-SEEP": ["deepskyblue", "CONTINUOUS", "Weight009"],
    "WATER-FLOW-ARROWS": ["deepskyblue", "CONTINUOUS", "Weight018"],
    // A dripline is where water enters, so it belongs to the water
    // family rather than to the entrance it is usually drawn near.
    "DRIPLINE": ["deepskyblue", "NSS_DRIPLINE", "Weight009", "DASHED"],

    // ---- formations -------------------------------------------------
    // FLOWSTONE/RIMSTONE are the Shaped Lines layers (real generated
    // geometry); the FORMATIONS-* pair are the hand-placed symbol
    // layers. Same hue on purpose -- a reader should not have to know
    // which tool drew a formation -- with the symbols one step lighter.
    "FLOWSTONE": ["gold", "CONTINUOUS", "Weight025"],
    "RIMSTONE": ["gold", "CONTINUOUS", "Weight025"],
    "FORMATIONS-FLOWSTONE": ["gold", "CONTINUOUS", "Weight018"],
    "FORMATIONS-RIMSTONE": ["gold", "CONTINUOUS", "Weight018"],
    "FORMATIONS-DRAPERY": ["gold", "CONTINUOUS", "Weight018"],
    "FORMATIONS-DRIP": ["gold", "CONTINUOUS", "Weight018"],
    "FORMATIONS-MOONMILK-POPCORN": ["gold", "CONTINUOUS", "Weight009"],

    // ---- sediment, life, geology, rigging ---------------------------
    "SEDIMENT-SAND-GRAVEL": ["peru", "CONTINUOUS", "Weight009"],
    "SEDIMENT-CLAY-MUD": ["peru", "CONTINUOUS", "Weight009"],
    // Guano is a bat deposit before it is a sediment, so it reads with
    // biology rather than with the mud it lies on.
    "GUANO": ["limegreen", "CONTINUOUS", "Weight009"],
    // Ice and snow are a floor covering like sediment, not a formation:
    // cyan because they read as cold, and because the anchor family it
    // shares the hue with never appears in the same part of a map.
    "ICE-SNOW": ["cyan", "CONTINUOUS", "Weight018"],
    "BIOLOGY": ["limegreen", "CONTINUOUS", "Weight018"],
    "ARCHAEOLOGY": ["limegreen", "CONTINUOUS", "Weight018"],
    "GEOLOGY-JOINTS-FRACTURES": ["slateblue", "NSS_JOINT", "Weight009",
        "DASHED"],
    "ANCHORS-BOLTS": ["cyan", "CONTINUOUS", "Weight018"],
    "CLIMBS-CHIMNEYS": ["cyan", "NSS_CLIMB", "Weight018", "DASHED"],

    // ---- reference marks and sheet furniture ------------------------
    // The mark in the PLAN saying where a section was cut. Red with the
    // rest of the reference family, and NOT twinned (see NO_TWIN): a cut
    // mark exists in the view being cut, never inside the cut.
    "CROSS-SECTION-MARKERS": ["red", "CONTINUOUS", "Weight025"],
    "NORTH-ARROW": ["white", "CONTINUOUS", "Weight025"],
    "SCALE-BAR": ["white", "CONTINUOUS", "Weight025"],
    "TITLE-BLOCK": ["white", "CONTINUOUS", "Weight025"],
    "BORDER": ["white", "CONTINUOUS", "Weight050"],
    "LEGEND": ["white", "CONTINUOUS", "Weight018"],

    // ---- text -------------------------------------------------------
    "TEXT-LABELS": ["white", "CONTINUOUS", "Weight018"],
    // Notes are subordinate to labels: gray and lighter, so a page of
    // marginalia does not read as loudly as the names on the map.
    "TEXT-NOTES": ["gray", "CONTINUOUS", "Weight009"],

    // ---- callout (multileader) layers, one per CsCallout style ------
    // Hazard is red because it is the one a caver must not miss.
    //
    // ELEVATION vs ELEVATION-LINE is a DIRECTED pair, not merely two
    // different colours. ELEVATION-LINE carries a survey-line elevation
    // standing in for a floor nobody measured, so it must read as
    // PROVISIONAL: the muted colour, dashed, hairline. ELEVATION is the
    // real reading and gets the plain, legible one. Swapping them still
    // passes a "the two differ" test while making the fallback OUTSHINE
    // the measurement -- the exact misreading this pair exists to stop.
    // Do not reverse them.
    "NOTES-GENERAL": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-HAZARD": ["red", "CONTINUOUS", "Weight025"],
    "NOTES-DIG": ["pink", "CONTINUOUS", "Weight018"],
    "NOTES-EQUIPMENT": ["cyan", "CONTINUOUS", "Weight018"],
    "NOTES-NAME": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION": ["white", "CONTINUOUS", "Weight018"],
    "NOTES-ELEVATION-LINE": ["gray", "DASHED", "Weight009"],
    // Generated note labels. Same appearance as a hand-placed name note
    // -- a reader should not be able to tell which notes the suite drew
    // and which the caver placed -- but its own layer, so a regenerate
    // can clear it without touching hand work.
    "NOTES-ANNOTATION": ["white", "CONTINUOUS", "Weight018"],

    // ---- control layers: survey data, not map art -------------------
    // Weight009 where a family needs internal contrast (a shot line
    // against its splays, a major contour against its minors),
    // Weight000 everywhere else.
    "CTRL-SHOTS": ["gray", "CONTINUOUS", "Weight009"],
    "CTRL-STATIONS": ["red", "CONTINUOUS", "Weight009"],
    "CTRL-STATION-LABELS": ["red", "CONTINUOUS", "Weight000"],
    "CTRL-TEXT-LABELS": ["red", "CONTINUOUS", "Weight000"],
    "CTRL-LRUD": ["pink", "CONTINUOUS", "Weight009"],
    "CTRL-LRUD-WALL-LEFT": ["gray", "DASHED", "Weight000"],
    "CTRL-LRUD-WALL-RIGHT": ["gray", "DASHED", "Weight000"],
    "CTRL-SPLAYS": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-CEILING": ["gray", "DASHED", "Weight000"],
    "CTRL-FLOOR": ["gray", "DASHED", "Weight000"],
    "CTRL-OUTLINE": ["gray", "CONTINUOUS", "Weight009"],
    "CTRL-BOX": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-SCAN": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-SHAPE-SPINE": ["gray", "DASHED", "Weight000"],
    "CTRL-HIDDEN": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-RAW": ["gray", "DASHED", "Weight000"],
    // An area's boundary is scaffolding, not linework: grabbable on
    // screen, absent from the print. Patterns whose edge IS map
    // linework (water, sump, flowstone, bedrock) route their boundary
    // to their own layer instead -- see CsArea.CATALOG.
    "CTRL-AREA-BOUNDARY": ["gray", "DASHED", "Weight000"],
    // Magenta, because nothing else on a cave map is: a closure arrow
    // has to be unmistakably NOT part of the drawing. The arrows
    // themselves are recoloured per station by size, so this is the
    // colour of the labels and the fallback.
    "CTRL-CLOSURE": ["magenta", "CONTINUOUS", "Weight018"],
    "CTRL-AERIAL": ["gray", "CONTINUOUS", "Weight000"],
    // Contours are background context: muted like the aerial they
    // usually sit on, majors told apart by weight alone.
    "CTRL-CONTOUR": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-CONTOUR-MAJOR": ["gray", "CONTINUOUS", "Weight009"],
    "CTRL-GRID": ["gray", "CONTINUOUS", "Weight000"],
    "CTRL-DATA": ["gray", "CONTINUOUS", "Weight000"],
    // THE ONE FRAME-PREFIXED ROW IN THIS TABLE, and it is here because
    // it has no plan twin to derive from: the sketch bay's reference
    // outline exists only inside a section. DASHED and hairline, the
    // same style family as CTRL-RAW -- a ghost is reference to check
    // work against, never to be mistaken for the finished, CONTINUOUS
    // CTRL-SECTION-OUTLINE it sits under.
    "CTRL-SECTION-GHOST": ["gray", "DASHED", "Weight000"]
};

// Layers that belong to the SHEET rather than to either view: one
// drawing prints as one sheet, and a plan with an elevation below it is
// ordinary cave cartography, so these are shared on purpose.
CsLayers.SHEET_LAYERS = ["0", "Defpoints", "BORDER", "TITLE-BLOCK",
    "LEGEND", "SCALE-BAR"];

/**
 * Which view a layer belongs to: "plan", "profile" or "sheet".
 *
 * THE ONLY PLACE THIS QUESTION IS ANSWERED. CsBind, CsRebuild,
 * eraseStations and the warp tools all ask here rather than each
 * matching a prefix their own way -- those are shipped plan-view files,
 * and a second spelling of "is this profile?" is how they start
 * disagreeing about the same layer.
 *
 * An unrecognised name answers "plan", deliberately. The dangerous
 * mistake is a profile-scoped sweep picking up a layer nobody
 * classified -- a user's own layer, or one a future feature adds -- so
 * the default is the frame that owns the drawing's origin.
 */
CsLayers.frameOf = function(layerName) {
    if (layerName === undefined || layerName === null) {
        return "plan";
    }
    var name = String(layerName);
    var i;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        if (name === CsLayers.SHEET_LAYERS[i]) {
            return "sheet";
        }
    }
    // Both spellings of the profile frame: CTRL-PROFILE-* for generated
    // geometry, PROFILE-* for what is traced by hand.
    if (name.indexOf("CTRL-PROFILE-") === 0 || name.indexOf("PROFILE-") === 0) {
        return "profile";
    }
    // The section frame, both spellings, the same way. CROSS-SECTION-
    // MARKERS matches NEITHER prefix and stays with the plan, which is
    // where the cut mark belongs.
    if (name.indexOf("CTRL-SECTION-") === 0 || name.indexOf("SECTION-") === 0) {
        return "section";
    }
    return "plan";
};


// ---------------------------------------------------------------------
// FRAME PARITY -- every per-frame element, in every frame.
//
// Nathan, 2026-08-29: "for each segment of a full drawing, plan,
// profile, and section views, we need dedicated layer for all the
// common elements so that we can more effectively target tools towards
// specific segments." A tool routes by CsLayers.frameOf, so an element
// present in one frame and absent in another is a tool that cannot be
// pointed at that frame at all -- Shaped Lines could not run in a
// section because a section had nowhere to put a ledge.
//
// PLAN STAYS UNPREFIXED. frameOf treats plan as the default frame and
// anything unrecognised falls to it, which is what stops a stray layer
// being swept up by a profile-scoped sweep. Renaming the plan set to
// PLAN-* would be symmetric and would break every drawing in existence.
//
// SOME OF THESE ARE DELIBERATELY DEAD, and that was a decision rather
// than an oversight. A generated (CTRL-) layer only fills when a
// generator writes to it, and nothing draws shots inside a section or a
// ceiling run in plan. They are registered for the symmetry asked for,
// and so a future generator finds its layer waiting instead of
// inventing one at runtime. If that ever reads as clutter, delete the
// constant AND the template row together -- one without the other is
// how a layer goes missing from the template.
// ---------------------------------------------------------------------
CsLayers.PROFILE_BREAKDOWN_BOUNDARY = "PROFILE-BREAKDOWN-BOUNDARY";
CsLayers.SECTION_BREAKDOWN_BOUNDARY = "SECTION-BREAKDOWN-BOUNDARY";
CsLayers.CEILING = "CEILING";
CsLayers.CTRL_BOX = "CTRL-BOX";
CsLayers.CTRL_CEILING = "CTRL-CEILING";
CsLayers.CTRL_SECTION_CEILING = "CTRL-SECTION-CEILING";
CsLayers.CTRL_FLOOR = "CTRL-FLOOR";
CsLayers.CTRL_SECTION_FLOOR = "CTRL-SECTION-FLOOR";
CsLayers.CTRL_SECTION_LRUD = "CTRL-SECTION-LRUD";
CsLayers.CTRL_PROFILE_LRUD_WALL_LEFT = "CTRL-PROFILE-LRUD-WALL-LEFT";
CsLayers.CTRL_SECTION_LRUD_WALL_LEFT = "CTRL-SECTION-LRUD-WALL-LEFT";
CsLayers.CTRL_PROFILE_LRUD_WALL_RIGHT = "CTRL-PROFILE-LRUD-WALL-RIGHT";
CsLayers.CTRL_SECTION_LRUD_WALL_RIGHT = "CTRL-SECTION-LRUD-WALL-RIGHT";
CsLayers.CTRL_OUTLINE = "CTRL-OUTLINE";
CsLayers.CTRL_PROFILE_OUTLINE = "CTRL-PROFILE-OUTLINE";
CsLayers.CTRL_PROFILE_SCAN = "CTRL-PROFILE-SCAN";
CsLayers.CTRL_SECTION_SHAPE_SPINE = "CTRL-SECTION-SHAPE-SPINE";
CsLayers.CTRL_SECTION_SHOTS = "CTRL-SECTION-SHOTS";
CsLayers.CTRL_SECTION_STATION_LABELS = "CTRL-SECTION-STATION-LABELS";
CsLayers.CTRL_TEXT_LABELS = "CTRL-TEXT-LABELS";
CsLayers.SECTION_ENTRANCE = "SECTION-ENTRANCE";
CsLayers.FLOOR = "FLOOR";
CsLayers.SECTION_FLOWSTONE = "SECTION-FLOWSTONE";
CsLayers.SECTION_LEDGE_CEILING = "SECTION-LEDGE-CEILING";
CsLayers.SECTION_LEDGE_FLOOR = "SECTION-LEDGE-FLOOR";
CsLayers.PROFILE_NOTES_ANNOTATION = "PROFILE-NOTES-ANNOTATION";
CsLayers.SECTION_NOTES_ANNOTATION = "SECTION-NOTES-ANNOTATION";
CsLayers.PROFILE_NOTES_DIG = "PROFILE-NOTES-DIG";
CsLayers.SECTION_NOTES_DIG = "SECTION-NOTES-DIG";
CsLayers.PROFILE_NOTES_ELEVATION = "PROFILE-NOTES-ELEVATION";
CsLayers.SECTION_NOTES_ELEVATION = "SECTION-NOTES-ELEVATION";
CsLayers.PROFILE_NOTES_ELEVATION_LINE = "PROFILE-NOTES-ELEVATION-LINE";
CsLayers.SECTION_NOTES_ELEVATION_LINE = "SECTION-NOTES-ELEVATION-LINE";
CsLayers.PROFILE_NOTES_EQUIPMENT = "PROFILE-NOTES-EQUIPMENT";
CsLayers.SECTION_NOTES_EQUIPMENT = "SECTION-NOTES-EQUIPMENT";
CsLayers.PROFILE_NOTES_GENERAL = "PROFILE-NOTES-GENERAL";
CsLayers.SECTION_NOTES_GENERAL = "SECTION-NOTES-GENERAL";
CsLayers.PROFILE_NOTES_HAZARD = "PROFILE-NOTES-HAZARD";
CsLayers.SECTION_NOTES_HAZARD = "SECTION-NOTES-HAZARD";
CsLayers.PROFILE_NOTES_NAME = "PROFILE-NOTES-NAME";
CsLayers.SECTION_NOTES_NAME = "SECTION-NOTES-NAME";
CsLayers.SECTION_RIMSTONE = "SECTION-RIMSTONE";
CsLayers.SECTION_SLOPE = "SECTION-SLOPE";
CsLayers.SECTION_WALL_GLYPHS = "SECTION-WALL-GLYPHS";
CsLayers.SECTION_TEXT_LABELS = "SECTION-TEXT-LABELS";
CsLayers.SECTION_TEXT_NOTES = "SECTION-TEXT-NOTES";
CsLayers.PROFILE_WALLS_SURVEYED = "PROFILE-WALLS-SURVEYED";

// Layers created switched OFF (invisible): the data store, CTRL-HIDDEN
// for legs that must persist but never plot, and CTRL-RAW, the
// as-surveyed ghost -- reference geometry showing where the survey
// was before adjustment moved it, not the map itself, so a reader
// switches it on deliberately rather than seeing it by default. NOT
// frozen -- frozen, off and locked layers ALL silently refuse entity
// adds in this build (RAddObjectsOperation just drops them), so
// nothing can be drawn onto these layers while they are off: a
// writer must wrap its add operation in CsLayers.withLayerOn below,
// which flips the layer visible for the write and restores it after.
// The section spine skeleton joins its plan and profile twins here.
// A shaped line's spine is scaffolding the caver never wants to see,
// and the section's was the one frame where it would have shown --
// worse, inside a sketching bay, where the capture sweep is geometric
// and would have swept the visible skeleton into the block.
CsLayers.OFF = { "CTRL-DATA": true, "CTRL-HIDDEN": true, "CTRL-RAW": true,
    "CTRL-CLOSURE": true,
    "CTRL-SHAPE-SPINE": true, "CTRL-PROFILE-SHAPE-SPINE": true,
    "CTRL-SECTION-SHAPE-SPINE": true };

// Layers created LOCKED: suite-owned bookkeeping a caver must see but
// never edit. Every write the suite itself makes to one of these must
// go through CsLayers.withLayerUnlocked below -- locked layers refuse
// adds, deletes AND modifies silently in this build, exactly like off
// ones. Locks a CAVER placed on ordinary layers stay sacred (see
// withLayerOn's docblock); this set is different because the suite
// placed the lock itself, on layers it owns outright.
CsLayers.LOCKED = { "CTRL-PROFILE-BOX": true,
    "CTRL-SECTION-BOX": true };

/**
 * True when this layer will SILENTLY REFUSE edits -- adds, deletes and
 * modifies alike. Off or frozen.
 *
 * ONE predicate, because there were four copies of it and they did not
 * agree. Three tested isOff() alone, so a FROZEN layer was never
 * unwrapped: CsDraw.eraseStations left the as-surveyed ghost undeleted
 * (it accumulated a copy per redraw, and printed "Transaction failed"
 * with nothing to say which layer), and CsBind.tagEntities lost its tag
 * writes outright. Both were found only after a real drawing was
 * damaged.
 *
 * LOCKED is not included, deliberately. A lock is something the surveyor
 * did on purpose; off and frozen are visibility, which a writer may
 * reveal for the length of its own write. A locked layer refuses, and
 * that is the honest outcome -- see FeatureTraceRun.refusalReason.
 *
 * Anything unreadable answers false: attempt the edit rather than
 * silently skip the layer.
 */
CsLayers.refusesEdits = function(lay) {
    if (isNull(lay)) {
        return false;
    }
    try {
        if (lay.isOff()) {
            return true;
        }
    } catch (eOff) {
        return false;
    }
    try {
        return lay.isFrozen() === true;
    } catch (eFrozen) {
        return false;   // no frozen concept in this build
    }
};

/**
 * Runs fn with the named layer VISIBLE -- neither off nor frozen -- then
 * restores whichever of those it had to change, even when fn throws.
 *
 * LOCKED is deliberately NOT cleared. Off and frozen are visibility, and
 * a writer may reasonably reveal a layer for the length of its own
 * write. Locked is protection: a caver locked it to stop things
 * changing, and overriding that silently would be the tool deciding it
 * knows better. A locked layer still refuses the write, and callers that
 * care report it -- see FeatureTraceRun.refusalReason. Exists because this
 * build's RAddObjectsOperation silently refuses to add entities to a
 * layer that is off (see CsLayers.OFF above): any write targeting a
 * normally-off layer must happen inside this wrapper or it is lost
 * without an error. Defensive throughout: a missing layer or a bridge
 * without layer toggling just runs fn as-is. QCAD context only.
 *
 * \return whatever fn returns
 */
/**
 * withLayerOn for MANY layers, in ONE operation each way.
 *
 * The recursive one-at-a-time nesting this replaces costs two
 * applyOperation calls PER LAYER, and in the GUI an applyOperation is
 * not free: every one of them refreshes the layer list widget and
 * regenerates the view. Measured on CaveCAD with a 24-station cave, a
 * single profile render made 87 withLayerOn calls -- and the whole
 * redraw took seconds where the same work headless takes tenths. The
 * layers being toggled are known up front, so there is no reason to
 * pay per layer.
 *
 * Same contract as CsLayers.withLayerOn: OFF and FROZEN are both
 * cleared (both refuse operations, silently), restored afterwards, and
 * restored even when fn throws -- the exception is re-thrown after the
 * restore. A layer that could not be toggled is simply left alone; fn
 * runs either way, exactly as before.
 *
 * \param names [layerName]
 * \return whatever fn returns
 */
CsLayers.withLayersOn = function(doc, di, names, fn) {
    var restore = [];   // {name, wasOff, wasFrozen}
    var opOn = null;
    for (var i = 0; i < names.length; i++) {
        try {
            var lay = doc.queryLayer(names[i]);
            if (isNull(lay)) {
                continue;
            }
            var wasOff = false, wasFrozen = false;
            if (lay.isOff()) {
                lay.setOff(false);
                wasOff = true;
            }
            try {
                if (lay.isFrozen()) {
                    lay.setFrozen(false);
                    wasFrozen = true;
                }
            } catch (eFrozen) {
                wasFrozen = false;   // no frozen concept in this build
            }
            if (wasOff || wasFrozen) {
                if (opOn === null) {
                    opOn = new RModifyObjectsOperation();
                }
                opOn.addObject(lay, false);
                restore.push({ name: names[i], wasOff: wasOff,
                    wasFrozen: wasFrozen });
            }
        } catch (e) {
            // could not toggle this one; fn still runs
        }
    }
    if (opOn !== null) {
        try {
            di.applyOperation(opOn);
        } catch (eOn) {
            restore = []; // nothing landed, so there is nothing to undo
        }
    }

    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (e2) {
        thrown = e2;
        didThrow = true;
    }

    if (restore.length > 0) {
        try {
            var opOff = new RModifyObjectsOperation();
            var any = false;
            for (i = 0; i < restore.length; i++) {
                var r = restore[i];
                var back = doc.queryLayer(r.name);
                if (isNull(back)) {
                    continue;
                }
                if (r.wasOff) {
                    back.setOff(true);
                }
                if (r.wasFrozen) {
                    back.setFrozen(true);
                }
                opOff.addObject(back, false);
                any = true;
            }
            if (any) {
                di.applyOperation(opOff);
            }
        } catch (e3) {
            // restoring visibility is a nicety; the data already landed
        }
    }

    if (didThrow) {
        throw thrown;
    }
    return result;
};

CsLayers.withLayerOn = function(doc, di, layerName, fn) {
    var wasOff = false;
    var wasFrozen = false;
    try {
        var lay = doc.queryLayer(layerName);
        if (!isNull(lay)) {
            if (lay.isOff()) {
                lay.setOff(false);
                wasOff = true;
            }
            // FROZEN refuses operations exactly as OFF does, and this
            // function used to clear only OFF. A drawing with CTRL-RAW
            // frozen -- an ordinary thing for a caver to do to the
            // as-surveyed ghost -- made every redraw report "Transaction
            // failed. Please check for block recursions and locked or
            // invisible layers or blocks." twice, with nothing to say
            // which layer or why.
            try {
                if (lay.isFrozen()) {
                    lay.setFrozen(false);
                    wasFrozen = true;
                }
            } catch (eFrozen) {
                wasFrozen = false;   // no frozen concept in this build
            }
            if (wasOff || wasFrozen) {
                var opOn = new RModifyObjectsOperation();
                opOn.addObject(lay, false);
                di.applyOperation(opOn);
            }
        }
    } catch (e) {
        wasOff = false; // could not toggle; fn still runs
        wasFrozen = false;
    }
    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (e2) {
        thrown = e2;
        didThrow = true;
    }
    if (wasOff || wasFrozen) {
        try {
            var layOff = doc.queryLayer(layerName);
            if (!isNull(layOff)) {
                if (wasOff) {
                    layOff.setOff(true);
                }
                if (wasFrozen) {
                    layOff.setFrozen(true);
                }
                var opOff = new RModifyObjectsOperation();
                opOff.addObject(layOff, false);
                di.applyOperation(opOff);
            }
        } catch (e3) {
            // restoring visibility is a nicety; the data already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

/**
 * Runs fn with the named layer UNLOCKED, then restores the lock, even
 * when fn throws. The counterpart to withLayerOn for the
 * CsLayers.LOCKED set: those locks are the SUITE'S own (placed at
 * creation so a caver cannot edit the bookkeeping), so the suite may
 * lift them for the length of its own write. NEVER use this to write
 * past a lock a caver placed -- that is the line withLayerOn's docblock
 * draws, and it still stands. QCAD context only.
 *
 * \return whatever fn returns
 */
CsLayers.withLayerUnlocked = function(doc, di, layerName, fn) {
    var wasLocked = false;
    try {
        var lay = doc.queryLayer(layerName);
        if (!isNull(lay) && lay.isLocked() === true) {
            lay.setLocked(false);
            wasLocked = true;
            var opUnlock = new RModifyObjectsOperation();
            opUnlock.addObject(lay, false);
            di.applyOperation(opUnlock);
        }
    } catch (e) {
        wasLocked = false;   // could not toggle; fn still runs
    }
    var result, thrown = null, didThrow = false;
    try {
        result = fn();
    } catch (e2) {
        thrown = e2;
        didThrow = true;
    }
    if (wasLocked) {
        try {
            var layBack = doc.queryLayer(layerName);
            if (!isNull(layBack)) {
                layBack.setLocked(true);
                var opLock = new RModifyObjectsOperation();
                opLock.addObject(layBack, false);
                di.applyOperation(opLock);
            }
        } catch (e3) {
            // restoring the lock is protection, not data; the write
            // itself already landed
        }
    }
    if (didThrow) {
        throw thrown;
    }
    return result;
};

/**
 * Ensures a layer exists, creating it with its registry defaults if
 * not. Direct RLayer construction -- simple.js's addLayer relies on
 * current-layer plumbing that fails silently in the QJS bridge.
 * QCAD context only.
 */
CsLayers.ensure = function(doc, di, name) {
    if (doc.hasLayer(name)) {
        return;
    }
    // A VARIANT layer (PROFILE-CEILING-A) inherits its base layer's
    // appearance. Without this it takes the fallback below and looks
    // nothing like the layer it varies -- silently, which is how the
    // un-registered PROFILE-CEILING got the wrong lineweight before.
    // Guarded by typeof so CsLayers still loads standalone, which the
    // one-shot template tools rely on.
    var d = CsLayers.styleOf(name);
    var layer = new RLayer(doc, name, false,
        CsLayers.LOCKED[name] === true,
        new RColor(d[0]), CsLayers.linetypeIdFor(doc, d),
        RLineweight[d[2]], CsLayers.OFF[name] === true);
    var op = new RAddObjectsOperation();
    op.addObject(layer);
    di.applyOperation(op);
};

/** Ensures the layers every survey-drawing tool relies on. */
CsLayers.ensureSurveyLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.CTRL_SHOTS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_STATION_LABELS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_LRUD);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SPLAYS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_HIDDEN);
    CsLayers.ensure(doc, di, CsLayers.CTRL_AERIAL);
};

/** Ensure every callout style layer exists. Called by each callout
 *  command before it writes, so a drawing that never saw the template
 *  still gets the right appearance. */
CsLayers.ensureCalloutLayers = function(doc, di) {
    CsLayers.ensure(doc, di, CsLayers.NOTES_GENERAL);
    CsLayers.ensure(doc, di, CsLayers.NOTES_HAZARD);
    CsLayers.ensure(doc, di, CsLayers.NOTES_DIG);
    CsLayers.ensure(doc, di, CsLayers.NOTES_EQUIPMENT);
    CsLayers.ensure(doc, di, CsLayers.NOTES_NAME);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ELEVATION_LINE);
    CsLayers.ensure(doc, di, CsLayers.NOTES_ANNOTATION);
};


// =====================================================================
// FRAME TWIN DERIVATION -- one plan row, three frames.
//
// Runs once, at load, and is the reason CsLayers.DEFAULTS above holds
// no PROFILE-, SECTION-, CTRL-PROFILE- or CTRL-SECTION- row (bar the
// one documented exception). For every plan-frame layer that is twinned
// it writes the twin's DEFAULTS entry as a COPY of the plan row, and
// defines the twin's CsLayers constant when no hand-written one exists.
//
// WHY DERIVE RATHER THAN LIST. The twins were listed by hand for a year
// and had drifted in ways nothing caught: SECTION-WALLS-SURVEYED was
// Weight035 against plan's Weight050, SECTION-CEILING and SECTION-FLOOR
// were Weight025 against Weight050, SECTION-WALLS-INFERRED was white
// against gray, CTRL-SECTION-TEXT-LABELS was Weight025 against
// Weight018. Every one of those is a section that reads lighter than the
// same passage in plan for no reason a cartographer chose. A copy cannot
// drift.
//
// WHY THE CONSTANTS ARE GENERATED. tools/sync_template_layers.js
// enumerates the registry by walking CsLayers' own string properties, so
// a twin only reaches the shipped template if it is a property. Writing
// 50 more assignments by hand for the NSS symbol layers alone would
// re-create exactly the hand-maintained list this block exists to
// delete. The hand-written twin constants (CsLayers.PROFILE_CEILING and
// friends) are LEFT IN PLACE -- code refers to them by name and grep
// must keep finding them -- and this loop simply does not redefine a
// property that already exists.
//
// The DEFAULTS row is overwritten either way, hand-written constant or
// not: the constant is a name, the row is the appearance, and appearance
// has exactly one source.
// =====================================================================

/** The frame prefix pairs: [plan prefix, profile prefix, section prefix].
 *  A CTRL- layer twins into CTRL-PROFILE-/CTRL-SECTION-, everything else
 *  into PROFILE-/SECTION-, which is the vocabulary frameOf reads. */
CsLayers.TWIN_PREFIXES = [
    ["CTRL-", "CTRL-PROFILE-", "CTRL-SECTION-"],
    ["", "PROFILE-", "SECTION-"]
];

/**
 * Plan-frame layers that get NO twin, with the reason each is here.
 * Everything else in DEFAULTS that frameOf calls "plan" is twinned.
 *
 * Sheet layers are excluded separately, via CsLayers.SHEET_LAYERS: a
 * sheet layer belongs to the printed page, not to a view, so a
 * PROFILE-BORDER would be a second border on the same sheet.
 */
CsLayers.NO_TWIN = {
    // Georeferenced background context. There is one ground surface and
    // it is in plan; an elevation of an aerial photograph is nothing.
    "CTRL-AERIAL": true,
    "CTRL-CONTOUR": true,
    "CTRL-CONTOUR-MAJOR": true,
    // The sheet grid, drawn once over the whole drawing.
    "CTRL-GRID": true,
    // The retired data-store layer. No template should gain it (the
    // sync tool skips it because it is not a constant) and it certainly
    // should not gain two more of it.
    "CTRL-DATA": true,
    // Import scaffolding and the as-surveyed ghost: both are plan-space
    // survey mechanics, not per-view elements.
    "CTRL-HIDDEN": true,
    "CTRL-RAW": true,
    // A loop closure is a fact about the survey NETWORK, not about a
    // view of it. The same error would be drawn three times, saying the
    // same thing, if this had per-view twins.
    "CTRL-CLOSURE": true,
    // The mark saying where a section was CUT. It lives in the view
    // being cut -- a cut mark inside its own section is meaningless.
    // frameOf keeping this name in the plan frame is asserted in
    // tests/js_unit.js; this row is the appearance half of the same
    // decision.
    "CROSS-SECTION-MARKERS": true,
    // The north arrow orients a plan. An elevation has no north.
    "NORTH-ARROW": true
};

/**
 * The frame twin of a PLAN layer: BREAKDOWN -> PROFILE-BREAKDOWN,
 * CTRL-SHOTS -> CTRL-SECTION-SHOTS. The forward direction of
 * planBaseOf below, and the reason a tool no longer needs its own
 * hand-written twin table to work in more than one view.
 *
 * Answers null rather than guessing whenever the twin would be a
 * fiction: a name that is already frame-prefixed (twinning a twin), a
 * sheet layer, a layer NO_TWIN excludes on purpose, and any frame word
 * that is not plan/profile/section. Callers treat null as "this tool
 * has nothing to draw in that frame" -- which is a real answer, not a
 * failure, and much safer than routing to a layer the registry has no
 * appearance for.
 *
 * frame "plan" answers the name unchanged, so a caller can pass the
 * frame it computed straight through without a special case.
 *
 * Pure.
 */
CsLayers.twinFor = function(name, frame) {
    if (isNull(name)) {
        return null;
    }
    var s = String(name);
    if (frame === "plan") {
        return s;
    }
    var column = frame === "profile" ? 1 : (frame === "section" ? 2 : -1);
    if (column < 0) {
        return null;
    }
    // Twinning an already-twinned name would build PROFILE-PROFILE-*.
    if (CsLayers.frameOf(s) !== "plan") {
        return null;
    }
    if (CsLayers.NO_TWIN[s] === true) {
        return null;
    }
    // Sheet layers need no check of their own: frameOf answers "sheet"
    // for every one of them, so the guard above has already refused.
    var i, row;
    for (i = 0; i < CsLayers.TWIN_PREFIXES.length; i++) {
        row = CsLayers.TWIN_PREFIXES[i];
        // The CTRL- row is tested first for the same reason planBaseOf
        // tests it first: the second row's plan prefix is empty and
        // therefore matches everything.
        if (row[0] === "" || s.indexOf(row[0]) === 0) {
            return row[column] + s.substring(row[0].length);
        }
    }
    return null;
};

/**
 * The plan-frame layer a frame-prefixed name derives from, or null when
 * the name is not frame-prefixed (or has no plan counterpart).
 *
 * CTRL-PROFILE-SHOTS -> CTRL-SHOTS, SECTION-CEILING -> CEILING.
 * The CTRL- pair is tested FIRST: "CTRL-PROFILE-SHOTS" also begins with
 * neither plan prefix in the second pair, but a name like
 * "CTRL-SECTION-BOX" must not be read as the plan layer
 * "CTRL-SECTION-BOX" simply because the empty plan prefix matches
 * everything.
 */
CsLayers.planBaseOf = function(name) {
    if (isNull(name)) {
        return null;
    }
    var s = String(name), i, row, f;
    for (i = 0; i < CsLayers.TWIN_PREFIXES.length; i++) {
        row = CsLayers.TWIN_PREFIXES[i];
        for (f = 1; f <= 2; f++) {
            if (s.indexOf(row[f]) === 0) {
                return row[0] + s.substring(row[f].length);
            }
        }
    }
    return null;
};

/**
 * The [colour, linetype, weight, fallback?] a layer is drawn with:
 * its own row, its plan twin's row, its variant base's row, or the
 * fallback -- in that order, first hit wins.
 *
 * THE ONE PLACE appearance is resolved. CsLayers.ensure creates through
 * it and CsRestyle repairs through it, so a layer created before a
 * palette change and one created after cannot disagree.
 */
CsLayers.styleOf = function(name) {
    var d = CsLayers.DEFAULTS[name];
    if (!isNull(d)) {
        return d;
    }
    // A VARIANT layer (PROFILE-CEILING-A) inherits its base layer's
    // appearance. Without this it takes the fallback below and looks
    // nothing like the layer it varies -- silently, which is how the
    // un-registered PROFILE-CEILING got the wrong lineweight before.
    // Guarded by typeof so CsLayers still loads standalone, which the
    // one-shot template tools rely on.
    if (typeof CsLayerVariants !== "undefined") {
        var base = CsLayerVariants.baseOf(name);
        if (!isNull(base)) {
            d = CsLayers.DEFAULTS[base];
            if (!isNull(d)) {
                return d;
            }
        }
    }
    return ["white", "CONTINUOUS", "Weight025"];
};

/**
 * The linetype id for a style row, falling back when the drawing has no
 * such pattern. QCAD context only.
 *
 * Every NSS_* pattern is defined in the LTYPE table of
 * templates/NSS_Cave_Template_PLAN.dxf and in no other drawing. A layer
 * created in a drawing that never saw the template would otherwise get
 * an INVALID linetype id from getLinetypeId -- accepted without
 * complaint, and rendered as nothing anybody chose. The 4th element of
 * the style row names what to use instead; CONTINUOUS is the last
 * resort, because it always exists.
 */
CsLayers.linetypeIdFor = function(doc, style) {
    var names = [style[1]];
    if (style.length > 3 && !isNull(style[3])) {
        names.push(style[3]);
    }
    names.push("CONTINUOUS");
    for (var i = 0; i < names.length; i++) {
        try {
            var id = doc.getLinetypeId(names[i]);
            if (!isNull(id) && id !== RObject.INVALID_ID) {
                return id;
            }
        } catch (e) {
            // an engine without this linetype: try the next name
        }
    }
    return doc.getLinetypeId("CONTINUOUS");
};

(function deriveFrameTwins() {
    var sheet = {}, i, f, name, base, row, twin;
    for (i = 0; i < CsLayers.SHEET_LAYERS.length; i++) {
        sheet[CsLayers.SHEET_LAYERS[i]] = true;
    }
    // Snapshot the plan rows before writing: the loop adds keys to the
    // very table it reads, and a for-in over a table being extended is
    // not defined to be stable in this engine.
    var bases = [];
    for (name in CsLayers.DEFAULTS) {
        if (!CsLayers.DEFAULTS.hasOwnProperty(name)) {
            continue;
        }
        if (sheet[name] === true || CsLayers.NO_TWIN[name] === true) {
            continue;
        }
        if (CsLayers.frameOf(name) !== "plan") {
            continue;   // CTRL-SECTION-GHOST, the documented exception
        }
        bases.push(name);
    }
    // A name -> constant lookup, so an already-hand-written twin
    // constant is not defined a second time under a generated key.
    var defined = {};
    for (var k in CsLayers) {
        if (CsLayers.hasOwnProperty(k) && typeof CsLayers[k] === "string") {
            defined[CsLayers[k]] = true;
        }
    }
    for (i = 0; i < bases.length; i++) {
        base = bases[i];
        row = CsLayers.DEFAULTS[base];
        for (var p = 0; p < CsLayers.TWIN_PREFIXES.length; p++) {
            var pref = CsLayers.TWIN_PREFIXES[p];
            if (pref[0].length > 0) {
                if (base.indexOf(pref[0]) !== 0) {
                    continue;   // not a CTRL- layer
                }
            } else if (base.indexOf("CTRL-") === 0) {
                continue;       // CTRL- handled by the pair above
            }
            var stem = base.substring(pref[0].length);
            for (f = 1; f <= 2; f++) {
                twin = pref[f] + stem;
                // The copy. slice() so a caller mutating one row (nothing
                // does, but the table is public) cannot silently restyle
                // the other two frames with it.
                CsLayers.DEFAULTS[twin] = row.slice(0);
                if (defined[twin] !== true) {
                    CsLayers[twin.replace(/-/g, "_")] = twin;
                    defined[twin] = true;
                }
            }
            break;
        }
    }
})();
