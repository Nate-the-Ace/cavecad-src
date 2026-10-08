// Symbols.js -- the symbol catalog: every SYM_* block the templates
// carry, with its NSS name, UIS alias, home layer and default scale.
//
// Part of the Cave Survey Core library. The catalog is pure data;
// only insert() touches the document.
//
// NSS naming is canonical (the templates are NSS-style and a judged
// US map is measured against the NSS set); the UIS alias rides along
// so legends and exports can speak both. A tool placing a symbol
// through this catalog physically cannot put a stalactite on the
// water layer -- the layer comes from here, not from the user.

var CsSymbols = {};

// block, nss, uis, layer, category
CsSymbols.CATALOG = [
    { block: "SYM_ENTRANCE", nss: "Entrance", uis: "Cave entrance",
        layer: "ENTRANCE", category: "Structure" },
    { block: "SYM_PIT", nss: "Pit", uis: "Pit / vertical drop",
        layer: "PITS-DOMES", category: "Structure" },
    { block: "SYM_DOME", nss: "Dome", uis: "Dome / aven",
        layer: "PITS-DOMES", category: "Structure" },
    { block: "SYM_BREAKDOWN", nss: "Breakdown", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_BREAKDOWN_B", nss: "Breakdown (variant B)", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_BREAKDOWN_C", nss: "Breakdown (variant C)", uis: "Stone blocks",
        layer: "BREAKDOWN", category: "Floor" },
    { block: "SYM_STALACTITE", nss: "Stalactite", uis: "Stalactite",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_STALAGMITE", nss: "Stalagmite", uis: "Stalagmite",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_COLUMN", nss: "Column", uis: "Column",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_FLOWSTONE", nss: "Flowstone", uis: "Sinter / flowstone",
        layer: "FORMATIONS-FLOWSTONE", category: "Formations" },
    { block: "SYM_DRAPERY", nss: "Drapery", uis: "Curtain / drapery",
        layer: "FORMATIONS-DRAPERY", category: "Formations" },
    { block: "SYM_RIMSTONE_DAM", nss: "Rimstone dam", uis: "Gours / rimstone",
        layer: "FORMATIONS-RIMSTONE", category: "Formations" },
    { block: "SYM_MOONMILK_POPCORN", nss: "Moonmilk / popcorn", uis: "Moonmilk",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_CLAY_MUD_TICK", nss: "Clay / mud", uis: "Clay",
        layer: "SEDIMENT-CLAY-MUD", category: "Floor" },
    { block: "SYM_SAND_GRAVEL_DOT", nss: "Sand / gravel", uis: "Sand",
        layer: "SEDIMENT-SAND-GRAVEL", category: "Floor" },
    { block: "SYM_GUANO", nss: "Guano", uis: "Guano",
        layer: "GUANO", category: "Floor" },
    { block: "SYM_NORTH_ARROW", nss: "North arrow", uis: "North arrow",
        layer: "NORTH-ARROW", category: "Sheet" },
    { block: "SYM_FIXED_POINT", nss: "Fixed survey point", uis: "Survey point",
        layer: "CTRL-STATIONS", category: "Survey" },
    { block: "SYM_SECTION_MARKER", nss: "Cross-section marker", uis: "Cross-section line",
        layer: "CROSS-SECTION-MARKERS", category: "Survey" },
    { block: "SYM_CEILING_HEIGHT", nss: "Ceiling height", uis: "Ceiling height",
        layer: "CEILING-HEIGHT", category: "Annotation" },
    { block: "SYM_SIPHON", nss: "Siphon", uis: "Siphon",
        layer: "WATER-SIPHON", category: "Water" },
    { block: "SYM_SPRING", nss: "Spring / resurgence", uis: "Spring",
        layer: "WATER-SPRING-RESURGENCE", category: "Water" },
    { block: "SYM_DRIP_SEEP", nss: "Drip / seep", uis: "Water drip",
        layer: "WATER-DRIP-SEEP", category: "Water" },
    { block: "SYM_SUMP", nss: "Sump", uis: "Sump",
        layer: "WATER-POOL-SUMP", category: "Water" },
    { block: "SYM_FLOW_ARROW", nss: "Water flow arrow", uis: "Stream flow direction",
        layer: "WATER-FLOW-ARROWS", category: "Water" },
    { block: "SYM_SLOPE_TICK", nss: "Floor slope", uis: "Gradient arrow",
        layer: "FLOOR-SLOPE", category: "Floor" },
    { block: "SYM_CLIMB_ARROW", nss: "Climb", uis: "Climb direction",
        layer: "CLIMBS-CHIMNEYS", category: "Structure" },
    { block: "SYM_JOINT_TICK", nss: "Joint / fracture", uis: "Fissure / joint",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" },

    // ---- RIGGING ----------------------------------------------------
    //
    // How you get down it, which this catalogue had nothing for: Pit,
    // Dome and Climb described the SHAPE of the vertical and stopped,
    // while CsLayers has reserved ANCHORS-BOLTS (cyan -- the rigging
    // and gear family) since the palette was written and nothing ever
    // drew on it.
    //
    // WHERE THESE COME FROM, corrected after checking rather than
    // asserted. There IS a set to answer to: Therion carries equipment
    // point symbols -- anchor, rope, rope-ladder, fixed-ladder, steps,
    // traverse, bridge, handrail -- and defines every one of them in
    // exactly ONE symbol set, the Slovak SKBB (src/therion-mpost/
    // thPoint.mp). UIS, NSS and BCRA have no rigging symbols of their
    // own, so whichever set you select you get the SKBB drawing. The
    // NSS names below are therefore descriptive, not canonical; the
    // UIS column carries the longer phrase a legend needs.
    //
    // Three of these agree with SKBB: the TRAVERSE LINE is a sag
    // between two anchor dots in both, and the ROPE and the CABLE
    // LADDER both carry the wave. Therion's `line rope` is a plain
    // undecorated line (`noassign` -- there is no per-set glyph), and
    // its `point rope-ladder` is told from `point fixed-ladder` by
    // exactly one thing: wavy rails hang, straight rails are bolted to
    // the rock. A cable ladder is the hanging kind.
    //
    // Two DIVERGE, deliberately and worth knowing about:
    //   * BOLT. SKBB draws an anchor side-on -- a vertical wall line, a
    //     hanger stub, a ring -- which is right in an elevation and
    //     means nothing in PLAN, where there is no wall face to be
    //     side-on to. The crossed circle here is the climbing- and
    //     caving-topo mark for a drilled anchor and survives being
    //     small.
    //   * REBELAY and DEVIATION have no symbol in any set. Therion does
    //     them with line geometry plus an anchor attribute, which suits
    //     a drawn rigging topo and not a palette you place marks from.
    //     Ours exist because the distinction is the one a caver most
    //     needs on the page: a rebelay's rope stops and is re-anchored,
    //     a deviation's kinks through and carries on.
    //
    // ALL ON ONE LAYER on purpose. A caver turning rigging off wants it
    // ALL off -- the bolts, the rope, the ladder, the lot -- because
    // the reason to turn it off is to print a map for someone who is
    // not rigging the cave. Splitting anchors from rope would make that
    // two clicks and give a reader half a rigging topo, which is worse
    // than none.
    { block: "SYM_BOLT", nss: "Bolt", uis: "Bolt / drilled anchor",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_Y_HANG", nss: "Y-hang", uis: "Two-bolt Y-hang",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_REBELAY", nss: "Rebelay", uis: "Rebelay",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_DEVIATION", nss: "Deviation", uis: "Deviation",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_NATURAL_ANCHOR", nss: "Natural anchor",
        uis: "Thread / natural belay", layer: "ANCHORS-BOLTS",
        category: "Rigging" },
    { block: "SYM_ROPE_DROP", nss: "Rope", uis: "Rope / rigged pitch",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_CABLE_LADDER", nss: "Cable ladder", uis: "Ladder",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_TRAVERSE_LINE", nss: "Traverse line",
        uis: "Traverse / safety line", layer: "ANCHORS-BOLTS",
        category: "Rigging" },

    // ---- COVERAGE AUDIT, 2026-10 ------------------------------------
    //
    // Added against the Therion point-symbol list (thbook ch02) and the
    // UIS/NSS vocabulary; docs/symbol-coverage-audit.md has the full
    // have / alias / missing table. Geometry is in
    // tools/coverage_symbols_data.js, drawn into the template by
    // tools/make_rigging_symbols.js.
    { block: "SYM_BAT", nss: "Bat", uis: "Bats",
        layer: "BIOLOGY", category: "Biology" },
    { block: "SYM_ROOT", nss: "Root", uis: "Tree roots",
        layer: "BIOLOGY", category: "Biology" },
    { block: "SYM_TREE_TRUNK", nss: "Tree trunk", uis: "Tree trunk / log",
        layer: "BIOLOGY", category: "Biology" },
    { block: "SYM_VEGETABLE_DEBRIS", nss: "Vegetable debris", uis: "Vegetable debris",
        layer: "BIOLOGY", category: "Biology" },
    { block: "SYM_SEED_GERMINATION", nss: "Seed germination", uis: "Germinating seed",
        layer: "BIOLOGY", category: "Biology" },
    { block: "SYM_ARCHEO_EXCAVATION", nss: "Archaeological excavation", uis: "Excavation",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_ARCHEO_MATERIAL", nss: "Archaeological material", uis: "Artefact",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_PALEO_MATERIAL", nss: "Palaeontological material", uis: "Fossil",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_BONES", nss: "Bones", uis: "Animal bones",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_HUMAN_BONES", nss: "Human bones", uis: "Human remains",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_MASONRY", nss: "Masonry", uis: "Masonry / walling",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_ALTAR", nss: "Altar", uis: "Altar",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_EX_VOTO", nss: "Ex-voto", uis: "Ex-voto / offering",
        layer: "ARCHAEOLOGY", category: "Archaeology" },
    { block: "SYM_DANGER", nss: "Danger", uis: "Hazard",
        layer: "NOTES-HAZARD", category: "Hazards" },
    { block: "SYM_DIG", nss: "Dig", uis: "Dig",
        layer: "NOTES-DIG", category: "Hazards" },
    { block: "SYM_AIR_DRAUGHT", nss: "Air draught", uis: "Air flow",
        layer: "NOTES-ANNOTATION", category: "Hazards" },
    { block: "SYM_CONTINUATION", nss: "Continuation", uis: "Unexplored continuation",
        layer: "NOTES-DIG", category: "Passage ends" },
    { block: "SYM_LOW_END", nss: "Low end", uis: "Low ceiling end",
        layer: "NOTES-ANNOTATION", category: "Passage ends" },
    { block: "SYM_NARROW_END", nss: "Narrow end", uis: "Narrow end",
        layer: "NOTES-ANNOTATION", category: "Passage ends" },
    { block: "SYM_BREAKDOWN_CHOKE", nss: "Breakdown choke", uis: "Breakdown choke",
        layer: "BREAKDOWN", category: "Passage ends" },
    { block: "SYM_CLAY_CHOKE", nss: "Clay choke", uis: "Clay choke",
        layer: "SEDIMENT-CLAY-MUD", category: "Passage ends" },
    { block: "SYM_FLOWSTONE_CHOKE", nss: "Flowstone choke", uis: "Flowstone choke",
        layer: "FORMATIONS-FLOWSTONE", category: "Passage ends" },
    { block: "SYM_HELICTITE", nss: "Helictite", uis: "Helictite",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_SODA_STRAW", nss: "Soda straw", uis: "Soda straw",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_PENDANT", nss: "Pendant", uis: "Pendant",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_CAVE_PEARL", nss: "Cave pearls", uis: "Cave pearls",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_CRYSTAL", nss: "Crystal", uis: "Crystals",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_ARAGONITE", nss: "Aragonite", uis: "Aragonite",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_GYPSUM", nss: "Gypsum", uis: "Gypsum",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_GYPSUM_FLOWER", nss: "Gypsum flower", uis: "Gypsum flower",
        layer: "FORMATIONS-MOONMILK-POPCORN", category: "Formations" },
    { block: "SYM_VOLCANO", nss: "Volcano", uis: "Stalagmite volcano",
        layer: "FORMATIONS-DRIP", category: "Formations" },
    { block: "SYM_CLAY_TREE", nss: "Clay tree", uis: "Clay tree",
        layer: "SEDIMENT-CLAY-MUD", category: "Formations" },
    { block: "SYM_SCALLOP", nss: "Scallops", uis: "Scallops",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" },
    { block: "SYM_FLUTE", nss: "Flutes", uis: "Flutes",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" },
    { block: "SYM_KARREN", nss: "Karren", uis: "Karren",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" },
    { block: "SYM_ANASTOMOSIS", nss: "Anastomosis", uis: "Anastomosis",
        layer: "GEOLOGY-JOINTS-FRACTURES", category: "Geology" },
    { block: "SYM_BRIDGE", nss: "Bridge", uis: "Bridge",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_WALKWAY", nss: "Walkway", uis: "Walkway",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_HANDRAIL", nss: "Handrail", uis: "Handrail",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_STEPS", nss: "Steps", uis: "Steps",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_FIXED_LADDER", nss: "Fixed ladder", uis: "Fixed ladder",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_GATE", nss: "Gate", uis: "Gate",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_CAMP", nss: "Camp", uis: "Camp",
        layer: "ANCHORS-BOLTS", category: "Rigging" },
    { block: "SYM_NAMEPLATE", nss: "Name plate", uis: "Name plate / tag",
        layer: "ANCHORS-BOLTS", category: "Rigging" }
];

CsSymbols.byBlock = function(blockName) {
    for (var i = 0; i < CsSymbols.CATALOG.length; i++) {
        if (CsSymbols.CATALOG[i].block === blockName) {
            return CsSymbols.CATALOG[i];
        }
    }
    return null;
};

/**
 * The catalogue as the PALETTE sees it: the shipped set plus every
 * custom symbol the template carries.
 *
 * Built-ins win a name collision. A caver cannot create one through
 * this suite -- CsSymbolStore.saveBlock refuses a shipped name -- but a
 * template edited by hand can hold one, and the shipped row is the one
 * the legend, the scatter tool and this file's own comments describe.
 *
 * Answers the built-in catalogue alone wherever the store is not
 * loaded, so a caller in a headless or bare context still gets a
 * usable list rather than an exception.
 *
 * \return { entries, ok, error } -- entries is always an array.
 */
CsSymbols.merged = function(path) {
    var out = CsSymbols.CATALOG.slice(0);
    if (typeof CsSymbolStore === "undefined") {
        return { entries: out, ok: true, error: "" };
    }
    // BOTH FILES: the shipped template's blocks and the caver's own
    // library. A path handed in names ONE file and is what the tests
    // use; the ordinary call takes everything.
    var listed = isNull(path) ? CsSymbolStore.listAll() :
        CsSymbolStore.list(path);
    var seen = {};
    for (var i = 0; i < out.length; i++) {
        seen[out[i].block] = true;
    }
    for (var j = 0; j < listed.entries.length; j++) {
        var entry = listed.entries[j];
        if (seen[entry.block] === true) {
            continue;
        }
        seen[entry.block] = true;
        out.push(entry);
    }
    return { entries: out, ok: listed.ok, error: listed.error };
};

/**
 * The categories of a given entry list, in first-appearance order.
 *
 * Takes the list rather than reading CATALOG directly, so the palette
 * can group a merged list (custom symbols included) through the same
 * function the shipped catalogue uses. No argument means the shipped
 * catalogue, which is what every existing caller passes.
 */
CsSymbols.categoriesOf = function(entries) {
    var seen = {};
    var out = [];
    var list = isNull(entries) ? CsSymbols.CATALOG : entries;
    for (var i = 0; i < list.length; i++) {
        var c = list[i].category;
        if (!seen[c]) {
            seen[c] = true;
            out.push(c);
        }
    }
    return out;
};

CsSymbols.categories = function() {
    return CsSymbols.categoriesOf(CsSymbols.CATALOG);
};

/**
 * Inserts one catalog symbol into the document at pos, on ITS layer --
 * or on `layerName` when the caller has already worked out which view
 * the symbol belongs to -- inside the caller's transaction. QCAD
 * context only.
 *
 * \return the block reference entity, or null when the block is
 *         missing from this drawing (i.e. not started from the
 *         template) -- callers report that in plain language.
 */
CsSymbols.insert = function(doc, entry, pos, scale, rotationRad, layerName,
        di) {
    var block = doc.queryBlock(entry.block);
    if (isNull(block)) {
        return null;
    }
    // THE DOCUMENT INTERFACE IS A PARAMETER NOW. It used to come from
    // the global getDocumentInterface(), and that global is defined by
    // scripts/simple.js in the APPLICATION's script context -- an
    // interactive action runs in its OWN context, where it does not
    // exist. So every placement from the Symbol Palette threw a
    // TypeError inside this function, was caught by the caller, and was
    // reported to the caver as "this drawing has no SYM_PIT block"
    // while the block sat in the drawing the whole time (measured in
    // the live GUI, 2026-09-06). Callers in the main context may still
    // omit it and get the old behaviour.
    if (isNull(di)) {
        di = getDocumentInterface();
    }
    // The catalogue layer unless the caller names another. A caller
    // that has ROUTED the symbol -- the palette, deciding plan /
    // profile / section from where the click landed -- hands the twin
    // in here rather than retargeting the reference afterwards, so the
    // layer is ensured and the reference created in one place. Callers
    // that pass nothing behave exactly as before.
    if (isNull(layerName) || layerName === "") {
        layerName = entry.layer;
    }
    CsLayers.ensure(doc, di, layerName);
    if (scale === undefined) {
        scale = 1.0;
    }
    if (rotationRad === undefined) {
        rotationRad = 0.0;
    }
    var data = new RBlockReferenceData(block.getId(), pos,
        new RVector(scale, scale), rotationRad, 1, 1, 1, 1);
    var ref = new RBlockReferenceEntity(doc, data);
    ref.setLayerId(doc.getLayerId(layerName));
    return ref;
};
