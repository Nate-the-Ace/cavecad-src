// CsLegend.js -- what a legend should say, and in what order.
//
// Part of the Cave Survey Core library. The row logic is pure -- it
// reads a `usage` object -- so it can be tested without a document;
// CsLegend.usage and CsLegend.sampleFor are the QCAD halves.
//
// WHAT CHANGED, AND WHY. Build Legend explained SYMBOLS only: the
// stalactites, the flow arrows, the pits. It never mentioned the lines,
// which is most of what a cave map is made of -- and the lines are
// where a beginner reader is most likely to be wrong, because a solid
// wall and a dashed one look like a drawing choice and are in fact a
// statement about how much of this map was measured. A legend that
// explains the stalactite and not the dashed wall explains the easy
// half.
//
// So a legend now carries four kinds of row:
//
//   line    a traced feature layer -- walls, ceiling, floor, breakdown
//   shape   a shaped line -- ledges, pit, flowstone, rimstone, slope --
//           drawn with its ornament, because the ornament IS the symbol
//   area    an Area Fill pattern -- sand, water, breakdown, a caver's
//           own custom pattern -- drawn as the real fill, never a
//           hand-drawn stand-in for one
//   symbol  a catalogue block, as before
//
// AND IT SAYS WHAT THEY MEAN. One sentence per row, from CsHelp (lines
// and symbols) or the pattern's own `help` field (areas) -- the same
// words the Feature Trace, Symbol Palette and Areas panel tooltips
// carry, so a caver is taught a convention once and then hands a
// reader a map that states it. Switch the sentences off with
// CaveSurvey/LegendExplain when a sheet is tight or a judge wants the
// terse form.
//
// NOTHING IS INVENTED, which was already this tool's rule and now
// covers four kinds of row instead of one: a feature the map does not
// use does not appear. A legend explaining a rimstone dam, or a sand
// floor, that is nowhere on the sheet is worse than no legend, because
// a reader will go looking for it.

var CsLegend = {};

/** How the rows are ordered.
 *
 *  LINES BEFORE SYMBOLS, and walls before everything: a reader meets
 *  the passage outline first, because that is what they are looking at
 *  first. Within the lines, the order is the order a cave is drawn --
 *  walls, then what is inside them, then the ornamented edges. */
CsLegend.FEATURE_ORDER = [
    "layer:WALLS-SURVEYED",
    "layer:WALLS-INFERRED",
    "layer:ENTRANCE",
    "layer:CEILING",
    "layer:FLOOR",
    "layer:BREAKDOWN",
    "layer:BREAKDOWN-BOUNDARY",
    "style:floorledge",
    "style:ceilingledge",
    "style:pit",
    "style:slope",
    "style:flowstone",
    "style:rimstone"
];

/** The setting that turns the one-line meanings off. On by default:
 *  the people this suite is for are the people who need them. */
CsLegend.SETTING_EXPLAIN = "CaveSurvey/LegendExplain";

/**
 * The built-in area patterns' canonical order, matching CsArea.CATALOG's
 * own listing (scatter patterns, then filled). Spelled out rather than
 * trusting `for...in` over CsArea.CATALOG to come back in source order --
 * the same reason FEATURE_ORDER above is a literal list and not a walk
 * of CsHelp.FEATURE: two runs over the same map must give the same
 * legend, and object key order is not a promise this bridge makes.
 *
 * A caver's own custom pattern has no place here -- it is appended
 * after, sorted by name, the same way CsLegend.usage already orders a
 * custom SYMBOL after the shipped catalogue.
 */
CsLegend.AREA_ORDER = [
    "BLOCKS", "DEBRIS", "PEBBLES", "SAND", "CLAY",
    "BEDROCK", "WATER", "SUMP", "FLOWSTONE", "MOONMILK",
    "GUANO", "ICE", "BONES"
];

/** The AreaOwner value every legend-drawn area swatch's FILL entities
 *  carry (CsArea.build stamps this on each one automatically, exactly
 *  as it stamps a real area's own id) -- "legend-area:" + the pattern's
 *  catalog key. Read back by the clearing pass in Build Legend so a
 *  swatch's fill is found and thrown away without CsLegend.TAG ever
 *  having to reach inside CsArea's own bookkeeping. */
CsLegend.AREA_OWNER_PREFIX = "legend-area:";

/**
 * How big an area swatch's sample square is, in feet of cave.
 *
 * Sized like a symbol (CsLegend.SYMBOL_FEET), not like a line sample
 * (CsLegend.SAMPLE_FEET): an area row occupies one row's height the
 * same way a symbol does, and a 14 ft square (the line sample's own
 * length) would run through the seven rows below it. A little larger
 * than a symbol's 1.6 ft -- a fill pattern needs enough room to show
 * its texture at all, where a symbol is legible at a point.
 */
CsLegend.AREA_SWATCH_FEET = 1.8;

/** How long a line sample is drawn, in feet of cave.
 *
 *  Long enough for a dash pattern to show at least one gap, and for
 *  EVERY shaped line to carry two ornaments -- a one-tick sample reads
 *  as a mistake rather than as a pattern. The widest spacing in
 *  CsShapeLine.STYLES was the slope fan at 6 ft (sample cleared twice
 *  that at 14 ft) until Wall Glyphs (2026-09-12) added spacingFeet 8 --
 *  a single glyph would have shown at 14 ft exactly like the ceiling
 *  ledge's 5 ft did at the 8 ft this started at (seen on Truitt Cave,
 *  2026-09-10). Raised to clear twice the NEW widest spacing. */
CsLegend.SAMPLE_FEET = 16.0;

/**
 * How big a symbol is drawn in the legend, in feet of cave.
 *
 * NORMALISED, not placed at scale 1. The shipped blocks are drawn about
 * a foot across; a symbol a caver draws for themselves may be anything
 * up to the palette's 10 ft working square, and at scale 1 Truitt
 * Cave's own mud slope came out taller than the five rows above it.
 * Every symbol in a legend has to read at the same size, because the
 * legend is a list and a list has rows.
 */
CsLegend.SYMBOL_FEET = 1.6;

/**
 * The scale that makes a symbol of half-size `radius` come out
 * `sizeFeet` across. The same arithmetic the Symbol Palette places by,
 * so a legend row and the thing it explains are drawn the same way.
 *
 * 1.0 when the radius is unknown -- an empty block, or a store that
 * could not be read. A symbol at its own scale is at worst the wrong
 * size; a symbol at scale 0 is invisible, which in a legend reads as a
 * row that forgot its picture.
 */
CsLegend.scaleForSize = function(sizeFeet, radius, perFoot) {
    if (isNull(radius) || !(radius > 0) || isNull(sizeFeet) ||
            !(sizeFeet > 0) || isNull(perFoot) || !(perFoot > 0)) {
        return 1.0;
    }
    return (sizeFeet * perFoot) / (2 * radius);
};

/** How wide the meaning sentence is allowed to run, in characters,
 *  before it wraps to another line. */
CsLegend.EXPLAIN_CHARS = 52;

/** Headings, so a reader can see the legend has more than one part.
 *  Only printed when MORE THAN ONE part has rows -- a map with only
 *  lines does not need to be told that the lines are lines. */
CsLegend.HEADING_LINES = "LINES";
CsLegend.HEADING_AREAS = "AREAS";
CsLegend.HEADING_SYMBOLS = "SYMBOLS";

/**
 * The rows a legend should hold, in order, from what the map uses.
 *
 * `usage` is { features: { "<key>": count }, symbols: [catalog entry],
 * areas: [{key, entry}] } -- the features keyed the way CsHelp.FEATURE
 * is keyed, the symbols already resolved to catalogue rows, and the
 * areas each carrying the CsArea catalog KEY beside the (built-in or
 * custom) catalog ENTRY it names, because an area row's swatch has to
 * ask CsArea.entryFor(key) again once there is a document to draw into
 * (this function never touches one).
 *
 * Rows come back as:
 *   { kind: "heading", label }
 *   { kind: "line",   key, label, means, layer }
 *   { kind: "shape",  key, label, means, style }
 *   { kind: "area",   key, label, means, pattern, layer }
 *   { kind: "symbol", key, label, means, block, layer }
 */
CsLegend.rowsFor = function(usage) {
    var lines = [];
    var areas = [];
    var symbols = [];
    var i, help;

    var features = isNull(usage) || isNull(usage.features) ?
        {} : usage.features;
    for (i = 0; i < CsLegend.FEATURE_ORDER.length; i++) {
        var key = CsLegend.FEATURE_ORDER[i];
        if (!(features[key] > 0)) {
            continue;
        }
        help = CsHelp.FEATURE[key];
        if (isNull(help)) {
            continue;   // a key nothing explains is a key nothing prints
        }
        var isShape = key.indexOf("style:") === 0;
        lines.push({
            kind: isShape ? "shape" : "line",
            key: key,
            label: help.label,
            means: help.means,
            style: isShape ? key.substring(6) : "",
            layer: isShape ? "" : key.substring(6)
        });
    }

    // AREAS. `help` IS the meaning -- CsArea.CATALOG's own field, the
    // one the Areas panel's tooltip already reads, never a second
    // sentence written here to say the same thing a different way. A
    // custom pattern with no `help` (an older library entry, saved
    // before that field existed) prints no sentence, same as a custom
    // symbol -- an empty answer, not a guess at what the caver meant.
    var usedAreas = isNull(usage) || isNull(usage.areas) ? [] : usage.areas;
    for (i = 0; i < usedAreas.length; i++) {
        var areaRow = usedAreas[i];
        areas.push({
            kind: "area",
            key: "area:" + areaRow.key,
            label: areaRow.entry.name,
            means: isNull(areaRow.entry.help) ? "" : areaRow.entry.help,
            pattern: areaRow.key,
            layer: areaRow.entry.layer
        });
    }

    var used = isNull(usage) || isNull(usage.symbols) ? [] : usage.symbols;
    for (i = 0; i < used.length; i++) {
        var entry = used[i];
        help = CsHelp.forSymbol(entry.block);
        var label = entry.nss;
        if (!isNull(entry.uis) && entry.uis !== "" && entry.uis !== entry.nss) {
            label += "  (UIS: " + entry.uis + ")";
        }
        symbols.push({
            kind: "symbol",
            key: "symbol:" + entry.block,
            label: label,
            // A custom symbol has no entry in CsHelp and gets no
            // sentence -- it means whatever its author drew it to mean,
            // and the legend is not the place to guess.
            means: isNull(help) ? "" : help.means,
            block: entry.block,
            layer: entry.layer
        });
    }

    // LINES, THEN AREAS, THEN SYMBOLS: the order a reader takes in a
    // cave map -- the passage outline first, then what covers its
    // floor, then the point features sitting on top of both.
    var sections = [
        { rows: lines, heading: CsLegend.HEADING_LINES },
        { rows: areas, heading: CsLegend.HEADING_AREAS },
        { rows: symbols, heading: CsLegend.HEADING_SYMBOLS }
    ];
    var partsPresent = 0;
    for (i = 0; i < sections.length; i++) {
        if (sections[i].rows.length > 0) {
            partsPresent++;
        }
    }
    // Headings only when there is more than one part to tell apart --
    // the original rule, generalised from two sections to three: a
    // legend that is ALL lines does not need to be told the lines are
    // lines.
    var multi = partsPresent > 1;

    var out = [];
    for (i = 0; i < sections.length; i++) {
        var section = sections[i];
        if (section.rows.length === 0) {
            continue;
        }
        if (multi) {
            out.push({ kind: "heading", label: section.heading });
        }
        for (var j = 0; j < section.rows.length; j++) {
            out.push(section.rows[j]);
        }
    }
    return out;
};

/** Greedy word wrap, returning the lines. Same fill CsPanel uses on a
 *  tooltip; a word longer than the budget gets a line to itself rather
 *  than being cut in half. */
CsLegend.wrap = function(text, budget) {
    var words = String(isNull(text) ? "" : text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") {
            continue;
        }
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines;
};

/** The sentences printed under one row's name -- none when the row has
 *  no meaning, or when explaining is switched off. */
CsLegend.explainLines = function(row, explain) {
    if (explain !== true || isNull(row.means) || row.means === "") {
        return [];
    }
    return CsLegend.wrap(row.means, CsLegend.EXPLAIN_CHARS);
};

/**
 * How tall one row is, in ROW UNITS (1 = the height of a plain row).
 *
 * A row grows to fit its sentence rather than the whole legend using
 * the tallest row's height: a legend of thirty rows spaced for the one
 * three-line meaning is a legend of mostly whitespace.
 */
CsLegend.heightOf = function(row, explain) {
    if (row.kind === "heading") {
        return 1.0;
    }
    var extra = CsLegend.explainLines(row, explain).length;
    return 1.0 + (extra * 0.6);
};

// ---------------------------------------------------------------------
// The QCAD half.
// ---------------------------------------------------------------------

/** Is the meanings column switched on? */
CsLegend.explaining = function() {
    try {
        return RSettings.getBoolValue(CsLegend.SETTING_EXPLAIN, true);
    } catch (e) {
        return true;
    }
};

/**
 * What this drawing actually uses.
 *
 * A feature counts when anything sits on its plan-frame layer OR on one
 * of that layer's per-view twins -- a ceiling traced only in the
 * elevation is still a ceiling this map draws, and a legend that missed
 * it would be lying by omission. A shaped line counts by its spines'
 * STYLE tag, which is the only thing that separates a flowstone from a
 * rimstone dam: they share a spine layer.
 *
 * QCAD only.
 */
CsLegend.usage = function(doc) {
    var out = { features: {}, symbols: [], areas: [] };
    if (isNull(doc)) {
        return out;
    }

    // THE CAVER'S OWN AREA PATTERNS COUNT, same reasoning as the
    // symbols below: CsArea.merged() is the thirteen shipped patterns
    // plus whatever the caver has drawn and saved of their own, so a
    // room filled with a custom pattern gets a row exactly as a room
    // filled with SAND does.
    var areaCatalog = {};
    try {
        areaCatalog = CsArea.merged();
    } catch (eAreaCatalog) {
        areaCatalog = CsArea.CATALOG;
    }

    // THE CAVER'S OWN SYMBOLS COUNT. CsSymbols.byBlock knows only the
    // shipped set, so a map using a custom symbol had it silently left
    // out of the legend -- Truitt Cave has 32 mud slopes on it and the
    // legend never mentioned them, which is the one thing a legend
    // must not do. merged() is the catalogue plus the caver's own
    // library; it degrades to the shipped list wherever the store
    // cannot be read.
    var catalogue = {};
    var known = CsSymbols.CATALOG;
    try {
        var all = CsSymbols.merged();
        if (!isNull(all) && !isNull(all.entries) && all.entries.length > 0) {
            known = all.entries;
        }
    } catch (eMerged) {
        known = CsSymbols.CATALOG;
    }
    for (var k = 0; k < known.length; k++) {
        catalogue[known[k].block] = known[k];
    }

    var seenSymbol = {};
    var seenArea = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        // The generated legend does not count as usage -- rebuilding
        // would otherwise keep every row it drew last time alive.
        if (CsTags.get(e, CsLegend.TAG) !== "") {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, e);
        // planBaseOf answers NULL for a layer that is already in the
        // plan frame -- it exists to turn PROFILE-CEILING into CEILING,
        // not to echo names back. Reading its null as the answer meant
        // every plan-frame feature registered as "layer:null" and no
        // legend ever mentioned the surveyed walls. Caught by
        // tests/build_legend_run.js on its first run.
        var base = layer;
        try {
            var twinBase = CsLayers.planBaseOf(layer);
            if (!isNull(twinBase) && twinBase !== "") {
                base = twinBase;
            }
        } catch (eBase) {
            base = layer;
        }
        var key = "layer:" + base;
        if (!isNull(CsHelp.FEATURE[key])) {
            out.features[key] = (out.features[key] || 0) + 1;
        }
        var style = CsTags.get(e, CsShapeLine.KEY.STYLE);
        if (style !== "" && !isNull(CsShapeLine.STYLES[style])) {
            var skey = "style:" + style;
            out.features[skey] = (out.features[skey] || 0) + 1;
        }
        // AN AREA REGISTERS BY ITS BOUNDARY, never by its fill: the
        // fill is derived and disposable (CsArea.regenerate throws it
        // away and rebuilds it on every touch), so counting fill
        // entities would double-count a scatter's dozens of block refs
        // as though each one were its own room. AreaPattern lives only
        // on the boundary (AreaFillRun.commit, CsArea.ID_KEY/PATTERN_KEY);
        // a fill entity carries AreaOwner instead, which this never reads.
        var areaKey = CsTags.get(e, CsArea.PATTERN_KEY);
        if (areaKey !== "" && !isNull(areaCatalog[areaKey])) {
            seenArea[areaKey] = true;
        }
        if (e.getType() === RS.EntityBlockRef) {
            try {
                var block = doc.queryBlock(e.getReferencedBlockId());
                var entry = isNull(block) ? null :
                    catalogue[String(block.getName())];
                if (!isNull(entry) && seenSymbol[entry.block] !== true) {
                    seenSymbol[entry.block] = true;
                    out.symbols.push(entry);
                }
            } catch (eBlock) {
            }
        }
    }

    // Catalogue order, so two runs over the same map give the same
    // legend -- entity order is whatever the storage hands back. The
    // shipped symbols first in their own order, then the caver's own by
    // name: a legend where somebody's custom symbol had shuffled into
    // the middle of the NSS set would read as though it were one.
    var ordered = [];
    var c;
    for (c = 0; c < CsSymbols.CATALOG.length; c++) {
        if (seenSymbol[CsSymbols.CATALOG[c].block] === true) {
            ordered.push(CsSymbols.CATALOG[c]);
            seenSymbol[CsSymbols.CATALOG[c].block] = "listed";
        }
    }
    var mine = [];
    for (c = 0; c < known.length; c++) {
        if (seenSymbol[known[c].block] === true) {
            mine.push(known[c]);
            seenSymbol[known[c].block] = "listed";
        }
    }
    mine.sort(function(a, b) {
        return String(a.nss) < String(b.nss) ? -1 :
            (String(a.nss) > String(b.nss) ? 1 : 0);
    });
    out.symbols = ordered.concat(mine);

    // Same idiom as the symbols above: the shipped patterns in
    // CsLegend.AREA_ORDER's own order, then a caver's own custom
    // patterns after, sorted by name.
    var orderedAreas = [];
    for (c = 0; c < CsLegend.AREA_ORDER.length; c++) {
        var ak = CsLegend.AREA_ORDER[c];
        if (seenArea[ak] === true && !isNull(areaCatalog[ak])) {
            orderedAreas.push({ key: ak, entry: areaCatalog[ak] });
            seenArea[ak] = "listed";
        }
    }
    var mineAreas = [];
    for (var ck in seenArea) {
        if (seenArea.hasOwnProperty(ck) && seenArea[ck] === true &&
                !isNull(areaCatalog[ck])) {
            mineAreas.push({ key: ck, entry: areaCatalog[ck] });
        }
    }
    mineAreas.sort(function(a, b) {
        return String(a.entry.name) < String(b.entry.name) ? -1 :
            (String(a.entry.name) > String(b.entry.name) ? 1 : 0);
    });
    out.areas = orderedAreas.concat(mineAreas);
    return out;
};

/** The tag every generated legend entity carries, so the next run can
 *  clear exactly what the last one drew. */
CsLegend.TAG = "LegendRow";
