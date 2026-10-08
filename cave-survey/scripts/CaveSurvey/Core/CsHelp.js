// CsHelp.js -- what each symbol and each traced feature MEANS, in the
// words a caver who has never drawn a map would need.
//
// Part of the Cave Survey Core library. Pure data and lookups: no
// document, no widget, nothing to run.
//
// WHY IT EXISTS. The palettes name a symbol and say which layer it
// lands on. That is enough for someone who already knows the NSS set
// and useless to everyone else -- "Rimstone dam" tells a beginner
// nothing about which way the scallops face, and facing them the wrong
// way is a map that says the water runs uphill. The names were never
// the hard part; the CONVENTIONS are, and they were only ever written
// down in a paper standard nobody has open while they draw.
//
// TWO FIELDS, deliberately:
//
//   label  what to CALL it (features only). The same words the Feature
//          Trace tile carries, so the legend a reader holds and the
//          panel the cartographer drew from agree; a test holds the two
//          in step rather than trusting anyone to copy them.
//   means  what the thing IS. One sentence, no jargon, present tense.
//          The legend prints this and nothing else -- a legend is a
//          statement about the map, not a tutorial.
//   rule   the convention that is easy to get backwards, or "" when
//          the symbol has none worth stating. The panels show it
//          emphasised, because it is the half that gets a map marked
//          down. Never restate `means` here.
//
// A `rule` that says "point it downhill" is a promise about the
// SYMBOL's own drawn orientation, so it has to match what the tools
// actually draw. Where a rule describes generated ornament (the shaped
// lines), the truth lives in CsShapeLine and this file follows it.
//
// COVERAGE IS TESTED. tests/js_unit.js asserts every CsSymbols.CATALOG
// block and every FeatureTrace row has an entry here, and that this
// file holds no key nothing points at -- a symbol added without help
// text fails the suite rather than shipping a blank tooltip.
//
// CUSTOM SYMBOLS have no entry and never will: a caver's own symbol
// means whatever they drew it to mean. Lookups answer null, and the
// callers print what they always printed.

var CsHelp = {};

/**
 * The shipped symbol catalogue, keyed by block name.
 *
 * Ordered as CsSymbols.CATALOG is, so the two read side by side.
 */
CsHelp.SYMBOL = {
    "SYM_ENTRANCE": {
        means: "Where the cave opens to the surface.",
        rule: "By convention the entrance station is A1, and it is where a reader looks first -- name it in the title block."
    },
    "SYM_PIT": {
        means: "A drop in the floor too deep to climb down.",
        rule: "Size it to the OPENING. Depth is a number in a callout, not a bigger symbol."
    },
    "SYM_DOME": {
        means: "A shaft going up out of the ceiling with no matching hole in the floor.",
        rule: "A dome is one you can stand under; a pit is one you would fall into. The same shaft is a dome from below and a pit from above."
    },
    "SYM_BREAKDOWN": {
        means: "Collapsed ceiling rock lying on the floor.",
        rule: "Draw the blocks at the size they really are and scatter them unevenly. Rows of identical blocks read as wallpaper."
    },
    "SYM_BREAKDOWN_B": {
        means: "Collapsed ceiling rock lying on the floor -- a second block shape.",
        rule: "Mix the three breakdown shapes in one rubble field. That is what the variants are for."
    },
    "SYM_BREAKDOWN_C": {
        means: "Collapsed ceiling rock lying on the floor -- a third block shape.",
        rule: "Mix the three breakdown shapes in one rubble field. That is what the variants are for."
    },
    "SYM_STALACTITE": {
        means: "A dripstone cone hanging from the ceiling.",
        rule: "Stalactites hold TIGHT to the ceiling; stalagmites MIGHT reach it one day."
    },
    "SYM_STALAGMITE": {
        means: "A dripstone cone standing up from the floor.",
        rule: "Stalactites hold TIGHT to the ceiling; stalagmites MIGHT reach it one day."
    },
    "SYM_COLUMN": {
        means: "A stalactite and a stalagmite that met and joined floor to ceiling.",
        rule: "Only where the two have actually joined. A near miss is two symbols, not one."
    },
    "SYM_FLOWSTONE": {
        means: "Calcite sheeting over rock, like water frozen mid-flow.",
        rule: "This marks a patch. For the EDGE of a flowstone bank, draw the Flowstone shaped line instead."
    },
    "SYM_DRAPERY": {
        means: "A thin hanging sheet of calcite, formed along a slanted ceiling.",
        rule: "A drapery is a sheet seen edge-on; a stalactite is a cone. If it hangs from a crack rather than a point, it is this."
    },
    "SYM_RIMSTONE_DAM": {
        means: "The rim of a gour -- a calcite dam holding a pool of water.",
        rule: "For a run of dams down a slope, draw the Rimstone Dam shaped line so the scallops bow downslope."
    },
    "SYM_MOONMILK_POPCORN": {
        means: "Soft white paste (moonmilk) or knobbly coral-like growth (popcorn) on rock.",
        rule: ""
    },
    "SYM_CLAY_MUD_TICK": {
        means: "A clay or mud floor.",
        rule: "Cover the area SPARSELY. A solid mat of ticks prints as a black blob and hides the linework under it."
    },
    "SYM_SAND_GRAVEL_DOT": {
        means: "A sand or gravel floor.",
        rule: "Dot it heavier where the deposit is deep and thinner at its edges -- the fade is how a reader sees the edge."
    },
    "SYM_GUANO": {
        means: "Bat or bird droppings on the floor.",
        rule: "Worth mapping: it marks a roost, and a roost changes when the cave may be entered."
    },
    "SYM_NORTH_ARROW": {
        means: "Which way is north on the sheet.",
        rule: "Say WHICH north -- true or magnetic, with the declination used. An arrow that does not say is the commonest fault on a beginner's map."
    },
    "SYM_FIXED_POINT": {
        means: "A station whose position is known from outside the survey -- a GPS fix or a benchmark.",
        rule: "The whole cave hangs off these. Two fixed points that disagree will fight, and the loop closure is where you will see it."
    },
    "SYM_SECTION_MARKER": {
        means: "Marks where a cross section was cut, and which way the viewer faces.",
        rule: "Its letters must match the caption on the section itself. A section nobody can find on the plan is a section nobody reads."
    },
    "SYM_CEILING_HEIGHT": {
        means: "How far it is from the floor to the ceiling at that spot.",
        rule: "Put them where the passage CHANGES -- a low crawl, a high dome. One every few feet is noise."
    },
    "SYM_SIPHON": {
        means: "Water filling the passage to the roof, which can drain.",
        rule: "A siphon may be passable in dry weather; a sump is not. If nobody has seen it open, call it a sump."
    },
    "SYM_SPRING": {
        means: "Where the cave's water comes back out at the surface.",
        rule: ""
    },
    "SYM_DRIP_SEEP": {
        means: "Water entering through the ceiling or wall with no channel.",
        rule: ""
    },
    "SYM_SUMP": {
        means: "Standing water filling the passage to the roof.",
        rule: "The mapped cave ends here unless someone dives it. Mark it -- a passage that just stops reads as unfinished survey."
    },
    "SYM_FLOW_ARROW": {
        means: "Which way the water runs.",
        rule: "Point it DOWNSTREAM. Put one in every stream passage: the drainage is half of what a cave map is for."
    },
    "SYM_SLOPE_TICK": {
        means: "Which way the floor tilts.",
        rule: "The arrow points DOWNHILL, the way water would run."
    },
    "SYM_CLIMB_ARROW": {
        means: "A climb that can be done without rope.",
        rule: "The arrow points UP the climb. Put the height beside it -- a climb with no number tells a reader nothing about the trip."
    },
    "SYM_JOINT_TICK": {
        means: "A fracture in the bedrock that the passage follows.",
        rule: "Draw it along the joint's own direction. It is the answer to why the cave goes where it goes."
    },
    "SYM_BAT": {
        means: "Bats roosting or flying in the cave.",
        rule: "Mark the roost, not every animal, and never put a roost on a map that leaves the group -- a published bat roost is a disturbed one."
    },
    "SYM_ROOT": {
        means: "A plant root coming through the ceiling or wall.",
        rule: "Roots mean the surface is close. Note the depth of cover in a callout if you know it."
    },
    "SYM_TREE_TRUNK": {
        means: "A tree trunk or log washed or fallen into the cave.",
        rule: "It is evidence of flooding or an open sinkhole upstream; say which in a note."
    },
    "SYM_VEGETABLE_DEBRIS": {
        means: "Sticks, leaves and plant litter on the floor.",
        rule: "Washed-in litter marks how far floodwater or surface input reaches."
    },
    "SYM_SEED_GERMINATION": {
        means: "A seed sprouting inside the cave.",
        rule: "Rare and worth a photo. A sprout means light or surface air is reaching this spot."
    },
    "SYM_ARCHEO_EXCAVATION": {
        means: "A dug or disturbed area with archaeological interest.",
        rule: "Draw it at the size of the trench. Do not dig, move or collect anything to improve a map."
    },
    "SYM_ARCHEO_MATERIAL": {
        means: "Worked material left by people: pottery, tools, charcoal.",
        rule: "Leave it where it lies and mark it. Location is the evidence."
    },
    "SYM_PALEO_MATERIAL": {
        means: "Fossils or ancient natural remains.",
        rule: "Mark, photograph and report; do not collect."
    },
    "SYM_BONES": {
        means: "Animal bones on the floor.",
        rule: "One symbol per find spot, not per bone."
    },
    "SYM_HUMAN_BONES": {
        means: "Human remains.",
        rule: "Treat as a burial: mark it, leave it, and report it to the landowner and the authorities rather than publicising it."
    },
    "SYM_MASONRY": {
        means: "A wall or structure built by people.",
        rule: "Draw the line of the wall; the symbol is for the courses seen in plan."
    },
    "SYM_ALTAR": {
        means: "A built or placed altar or shrine.",
        rule: ""
    },
    "SYM_EX_VOTO": {
        means: "An offering left in the cave.",
        rule: "Mark where it sits and leave it there."
    },
    "SYM_DANGER": {
        means: "A hazard: loose rock, a bad drop, bad air, anything the next party must not walk into.",
        rule: "Say WHAT the danger is in a callout beside it. A bare triangle tells a reader nothing they can act on."
    },
    "SYM_DIG": {
        means: "A place where digging would continue the cave.",
        rule: "Say what is in the way: clay, gravel, rock. That decides what tools the next trip brings."
    },
    "SYM_AIR_DRAUGHT": {
        means: "Moving air, with the arrow along the way it blows.",
        rule: "Moving air is the strongest clue to unexplored cave. Note the season: it often reverses."
    },
    "SYM_CONTINUATION": {
        means: "Passage that goes on and has not been surveyed.",
        rule: "This is a lead. Add a note saying why it stopped: time, water, tight, or no light."
    },
    "SYM_LOW_END": {
        means: "A passage that ends because the ceiling comes down to the floor.",
        rule: "Different from a NARROW end: a low end might be dug or crawled under."
    },
    "SYM_NARROW_END": {
        means: "A passage that ends because the walls close in.",
        rule: "Say whether it was tried and by whom. A tight squeeze to one caver is a way on to another."
    },
    "SYM_BREAKDOWN_CHOKE": {
        means: "A passage that ends in a pile of collapsed rock.",
        rule: "Draw the choke where the passage stops being passable, not where the rubble starts."
    },
    "SYM_CLAY_CHOKE": {
        means: "A passage that ends where clay fills it to the roof.",
        rule: ""
    },
    "SYM_FLOWSTONE_CHOKE": {
        means: "A passage that ends where flowstone has sealed it.",
        rule: "A flowstone choke is rarely worth digging. Say if you heard anything beyond it."
    },
    "SYM_HELICTITE": {
        means: "A twisting stone that grows in any direction, not down.",
        rule: "Fragile. Mark it so the next party keeps clear of it."
    },
    "SYM_SODA_STRAW": {
        means: "A thin hollow tube of calcite hanging from the ceiling.",
        rule: "The most breakable thing in a cave. Mark the field, and route the trail away from it."
    },
    "SYM_PENDANT": {
        means: "A short rounded knob of rock hanging from the ceiling, shaped by water.",
        rule: "A pendant is carved rock, a stalactite is deposited stone."
    },
    "SYM_CAVE_PEARL": {
        means: "Smooth rounded stones grown in a shallow pool.",
        rule: "Never move them: a pearl turned over stops growing."
    },
    "SYM_CRYSTAL": {
        means: "Faceted crystals: calcite, quartz or similar.",
        rule: ""
    },
    "SYM_ARAGONITE": {
        means: "Needle crystals radiating out from a point.",
        rule: "Fragile enough to be destroyed by a breath on it."
    },
    "SYM_GYPSUM": {
        means: "A crust or blades of gypsum on the wall.",
        rule: ""
    },
    "SYM_GYPSUM_FLOWER": {
        means: "A curling growth of gypsum pushed out of the wall.",
        rule: ""
    },
    "SYM_VOLCANO": {
        means: "A stalagmite with a crater on top, built by a drip that falls hard.",
        rule: ""
    },
    "SYM_CLAY_TREE": {
        means: "A clay column capped by a stone, left standing as the surrounding clay eroded.",
        rule: ""
    },
    "SYM_SCALLOP": {
        means: "Overlapping cup-shaped hollows cut into a wall by flowing water.",
        rule: "Small scallops mean fast water, big ones slow. The steep side faces upstream."
    },
    "SYM_FLUTE": {
        means: "Vertical channels worn down a wall by water running over it.",
        rule: ""
    },
    "SYM_KARREN": {
        means: "Rock dissolved into sharp ridges and runnels.",
        rule: "Mark where the floor or wall is hard to walk or crawl on."
    },
    "SYM_ANASTOMOSIS": {
        means: "A pattern of channels in the ceiling that split and rejoin.",
        rule: ""
    },
    "SYM_BRIDGE": {
        means: "A built bridge or planks across a gap.",
        rule: ""
    },
    "SYM_WALKWAY": {
        means: "A built path or boardwalk.",
        rule: ""
    },
    "SYM_HANDRAIL": {
        means: "A fixed handrail or cable on posts.",
        rule: ""
    },
    "SYM_STEPS": {
        means: "Steps cut or built into a slope.",
        rule: "Draw the rise upward. The steps point the way up."
    },
    "SYM_FIXED_LADDER": {
        means: "A rigid ladder bolted to the rock.",
        rule: "A fixed ladder has straight rails; a hanging cable ladder is drawn wavy."
    },
    "SYM_GATE": {
        means: "A gate or door across the passage.",
        rule: "Note who holds the key."
    },
    "SYM_CAMP": {
        means: "An underground camp site.",
        rule: ""
    },
    "SYM_NAMEPLATE": {
        means: "A plate or tag fixed to the wall with the station or cave name.",
        rule: ""
    }
};

/**
 * The features the Feature Trace panel draws, keyed the way that panel
 * keys its tiles: "layer:<PLAN-FRAME LAYER>" for a plain feature and
 * "style:<CsShapeLine.STYLES key>" for a shaped line.
 *
 * The SAME key FeatureTrace.rowKey builds, so a tile finds its help
 * without a second table mapping one to the other.
 */
CsHelp.FEATURE = {
    "layer:WALLS-SURVEYED": {
        label: "Surveyed Walls",
        means: "The edge of the passage where you measured it -- drawn solid.",
        rule: "Solid means MEASURED. Use it only where a tape, an LRUD or a splay actually reached the wall."
    },
    "layer:WALLS-INFERRED": {
        label: "Inferred Walls",
        means: "The edge of the passage where you did not measure it -- drawn dashed.",
        rule: "Dashed means SKETCHED. Guessing is allowed and hiding the guess is not: the dashes are the map being honest."
    },
    "layer:BREAKDOWN": {
        label: "Breakdown",
        means: "One block drawn to its real shape, rather than a scatter of symbols.",
        rule: "For a whole rubble field, outline it as a Breakdown Boundary and let Scatter Breakdown fill it."
    },
    "layer:BREAKDOWN-BOUNDARY": {
        label: "Breakdown Boundary",
        means: "The extent of a rubble field.",
        rule: "CLOSE the loop -- Scatter Breakdown fills closed boundaries and skips open ones."
    },
    "layer:ENTRANCE": {
        label: "Entrance",
        means: "The lip of the entrance itself, where the cave begins.",
        rule: ""
    },
    "layer:CEILING": {
        label: "Ceiling",
        means: "A ceiling edge seen from below: an overhang, a roof channel, the lip of an alcove.",
        rule: "Ceiling detail belongs INSIDE the walls. Drawn out at the wall line it reads as a second wall."
    },
    "layer:FLOOR": {
        label: "Floor",
        means: "Floor detail inside the walls: the edge of a mud bank, a sand ledge, a bedrock rib.",
        rule: "A floor line that steps DOWN is a ledge -- draw it as a Floor Ledge so the drop shows."
    },
    "style:floorledge": {
        label: "Floor Ledge",
        means: "A step down in the floor you could climb.",
        rule: "The hachures go on the LOW side. Click that side after the drag -- the tool asks."
    },
    "style:ceilingledge": {
        label: "Ceiling Ledge",
        means: "A step in the ceiling: an overhang, or where the roof jumps up.",
        rule: "The hachures go on the side the ceiling is LOWER, the same way a floor ledge marks its drop."
    },
    "style:pit": {
        label: "Pit",
        means: "A drop too deep to climb, drawn as a closed outline round the hole.",
        rule: "The ring closes on itself, so it has no ends and cannot be extended -- draw the whole rim in one stroke."
    },
    "style:flowstone": {
        label: "Flowstone",
        means: "The edge of a sheet of calcite flowing over the rock.",
        rule: "The scallops bow DOWNSLOPE, the way the water ran."
    },
    "style:rimstone": {
        label: "Rimstone Dam",
        means: "A run of gour dams stepping down a slope.",
        rule: "The scallops bow DOWNSLOPE -- each dam bulges away from the water it holds back."
    },
    "style:slope": {
        label: "Slope",
        means: "A floor tilting steeply enough to notice, but not a ledge.",
        rule: "The fans splay DOWNHILL. If the drop is a step rather than a ramp, it is a Floor Ledge."
    }
};

/**
 * Help for one shipped symbol, or null.
 *
 * Null for a custom symbol -- see the file note. Callers print what
 * they had before rather than inventing a meaning for someone's own
 * drawing.
 */
CsHelp.forSymbol = function(blockName) {
    if (isNull(blockName)) {
        return null;
    }
    var entry = CsHelp.SYMBOL[String(blockName)];
    return isNull(entry) ? null : entry;
};

/**
 * Help for one Feature Trace row, or null.
 *
 * Takes the ROW (as FeatureTrace.ROWS / SHAPED_ROWS hold it) rather
 * than a key, so a caller never has to know how the key is spelled.
 */
CsHelp.forFeature = function(row) {
    if (isNull(row)) {
        return null;
    }
    var key = isNull(row.style) ? ("layer:" + row.layer) :
        ("style:" + row.style);
    var entry = CsHelp.FEATURE[key];
    return isNull(entry) ? null : entry;
};
