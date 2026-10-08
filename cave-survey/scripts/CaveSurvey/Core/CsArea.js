// CsArea -- the thirteen UIS/Therion area patterns and a repeatable
// dice roll.
//
// This is the catalog only: what a pattern is called, whether it is
// drawn as a filled hatch region or a scatter of picture elements, and
// which layers it and its boundary belong to. The polygon maths that
// turn a boundary into a fill (Task 3), the picture-element blocks
// named here (Task 4), and everything that writes into a document
// (Tasks 5-11) live elsewhere. This file is GUI-free: no QWidget, no
// QPixmap, no simple.js global -- so it loads and runs the same way
// under node as it does inside CaveCAD.
//
// The dice are seeded because a scatter fill is DERIVED and rebuilt
// every time its boundary moves (the same model Shaped Lines uses for
// its spine and decoration). An unseeded Math.random reshuffles a
// whole boulder room's rubble on every rebuild, which reads as the
// floor changing texture out from under you as you drag its edge. A
// seed carried on the boundary keeps one area's scatter looking the
// same across edits, undo, reload, and a redraw on someone else's
// machine.

var CsArea = {};

/**
 * A repeatable random source.
 *
 * Park-Miller minimal standard, NOT an LCG with a big multiplier and
 * NOT Math.imul: this bridge is ES5, Math.imul is absent, and a
 * multiplier over ~2^24 loses bits in a double long before it wraps.
 * 16807 * 2^31 stays under 2^53, so every step is exact.
 *
 * Math.random cannot be seeded, and an unseeded scatter reshuffles a
 * whole boulder room every time the listener fires.
 */
CsArea.rng = function(seed) {
    var state = Math.floor(Math.abs(isNull(seed) ? 1 : seed)) % 2147483647;
    if (state === 0) {
        state = 1;
    }
    return function() {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
};

/** A seed for a new area. Math.random is fine HERE -- it is rolled
 *  once, written to the boundary, and never rolled again. */
CsArea.newSeed = function() {
    return 1 + Math.floor(Math.random() * 2147483645);
};

// Therion's own split is copied deliberately: water, sump, flowstone
// and moonmilk render as a FILLED region (a hatch entity, an
// "ansi31"/"dots" .pat pattern, or a solid fill); blocks, debris,
// pebbles, sand, clay, ice/snow, guano and bones render by randomly
// SCATTERING picture elements, which is why a repeating .pat pattern
// is not the engine for those -- gravel does not tile. Bedrock is the
// degenerate filled member: pattern null, meaning it draws no fill at
// all, only its printed boundary.
CsArea.CATALOG = {
    // spacingFactor/spacingMin: minimum separation between accepted
    // placements, as CsArea.scatterPlacements' own header explains --
    // BLOCKS' pair (0.55, floor 0.6) is ScatterBreakdown's own
    // pre-transplant formula, carried over verbatim so boulders never
    // land on top of each other the way that tool never let them.
    // DEBRIS and PEBBLES get the same relative factor with NO floor:
    // both scatter noticeably smaller elements (DEBRIS at a quarter to
    // half scale, PEBBLES a small AREA_PEBBLE), where a stacked-icon
    // artifact is just as visible as it is for a boulder, but a 0.6
    // drawing-unit floor tuned for boulder-sized elements would thin a
    // fine, dense scatter out for no visual reason. SAND and CLAY (a
    // stipple, not discrete rocks) set neither -- coincident stipple
    // dots are not a visible defect, and the spacing check would only
    // cost the sampler time at their much higher densities.
    BLOCKS: { name: "Blocks", engine: "scatter", layer: "BREAKDOWN",
        boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"],
        density: 16, scaleMin: 0.7, scaleMax: 1.5, rotate: true,
        spacingFactor: 0.55, spacingMin: 0.6,
        help: "Boulders fallen from the ceiling -- the kind you climb " +
            "over or squeeze between. Use Debris for anything smaller." },
    DEBRIS: { name: "Debris", engine: "scatter", layer: "BREAKDOWN",
        boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["SYM_BREAKDOWN", "SYM_BREAKDOWN_B", "SYM_BREAKDOWN_C"],
        density: 40, scaleMin: 0.25, scaleMax: 0.5, rotate: true,
        spacingFactor: 0.55,
        help: "Rubble smaller than your helmet: chips and cobbles " +
            "rather than boulders." },
    PEBBLES: { name: "Pebbles", engine: "scatter",
        layer: "SEDIMENT-SAND-GRAVEL", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_PEBBLE"], density: 55,
        scaleMin: 0.6, scaleMax: 1.2, rotate: true, spacingFactor: 0.55,
        help: "Rounded stones carried and sorted by water. Gravel, not " +
            "sand." },
    SAND: { name: "Sand", engine: "scatter",
        layer: "SEDIMENT-SAND-GRAVEL", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_STIPPLE"], density: 120,
        scaleMin: 0.8, scaleMax: 1.2, rotate: false,
        help: "Loose grains dropped by flowing water. Firm underfoot." },
    CLAY: { name: "Clay / Silt", engine: "scatter",
        layer: "SEDIMENT-CLAY-MUD", boundaryLayer: "CTRL-AREA-BOUNDARY",
        blocks: ["AREA_STIPPLE"], density: 45,
        scaleMin: 0.7, scaleMax: 1.0, rotate: false,
        help: "Fine mud dropped by standing water. Sticky, and it " +
            "holds a bootprint." },
    BEDROCK: { name: "Bedrock", engine: "filled", layer: "FLOOR",
        boundaryLayer: "FLOOR", solid: false, pattern: null,
        help: "Solid rock floor with nothing lying on it. Draws its " +
            "outline and no fill." },
    WATER: { name: "Water / Lake", engine: "filled",
        layer: "WATER-POOL-SUMP", boundaryLayer: "WATER-POOL-SUMP",
        solid: true, pattern: "SOLID",
        help: "Standing water -- a pool or a lake. Its edge prints as " +
            "the shoreline." },
    SUMP: { name: "Sump", engine: "filled", layer: "WATER-POOL-SUMP",
        boundaryLayer: "WATER-POOL-SUMP", solid: false,
        pattern: "ansi31", patternScale: 2.0, patternAngle: 0.0,
        help: "Where the passage floods to the ceiling and the way on " +
            "is underwater." },
    FLOWSTONE: { name: "Flowstone", engine: "filled", layer: "FLOWSTONE",
        boundaryLayer: "FLOWSTONE", solid: false,
        pattern: "ansi31", patternScale: 1.0, patternAngle: Math.PI / 4,
        help: "Calcite sheeting over the floor or wall, laid down by a " +
            "film of water." },
    MOONMILK: { name: "Moonmilk", engine: "filled",
        layer: "FORMATIONS-MOONMILK-POPCORN",
        boundaryLayer: "CTRL-AREA-BOUNDARY", solid: false,
        pattern: "dots", patternScale: 1.0, patternAngle: 0.0,
        help: "Soft white paste on rock. Popcorn and coralloid belong " +
            "here too." },
    GUANO: { name: "Guano", engine: "scatter", layer: "GUANO",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_DASH"],
        density: 60, scaleMin: 0.8, scaleMax: 1.3, rotate: true,
        help: "Bat droppings. Worth marking: it says where the roost " +
            "is, and it is a hazard." },
    ICE: { name: "Ice / Snow", engine: "scatter", layer: "ICE-SNOW",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_CRYSTAL"],
        density: 30, scaleMin: 0.8, scaleMax: 1.4, rotate: true,
        help: "Ice or firn that lasts the year round." },
    BONES: { name: "Bones", engine: "scatter", layer: "ARCHAEOLOGY",
        boundaryLayer: "CTRL-AREA-BOUNDARY", blocks: ["AREA_BONE"],
        density: 6, scaleMin: 0.9, scaleMax: 1.3, rotate: true,
        help: "Bone deposits. Archaeological -- record them and leave " +
            "them alone." }
};

/**
 * The built-in catalog plus every pattern a caver has drawn and saved
 * of their own -- ONE dict, keyed the same way for both: CsArea.CATALOG's
 * own uppercase keys (SAND, BLOCKS, ...) for the thirteen shipped
 * patterns, and CsSymbolStore.slugFor(name) for a custom one, so a
 * caver's pattern named "Sand" collides with the shipped SAND rather
 * than living beside it under a different spelling of the same word.
 *
 * BUILT-INS LAID ON TOP, deliberately, so that collision always
 * resolves the same way: CsArea.CATALOG is code, shipped with the
 * add-on, and a release cannot take back a slot a caver's own drawing
 * has quietly claimed.
 *
 * NO SEPARATE CACHE HERE. CsSymbolStore.customAreaPatterns() already
 * caches the library file open (keyed and invalidated exactly like
 * CsSymbolStore.list()'s own cache), so calling this every time costs
 * one small dict merge -- no DXF, no file stat beyond what that call
 * already does -- never a second file open per call. That is what
 * keeps this safe to call from inside CsArea.build/CsArea.regenerate,
 * which run once per boundary, not once per scattered element.
 */
CsArea.merged = function() {
    var out = {};
    var custom = CsSymbolStore.customAreaPatterns(CsSymbolStore.customPath());
    for (var i = 0; i < custom.entries.length; i++) {
        var m = custom.entries[i];
        var key = CsSymbolStore.slugFor(m.name);
        if (key === null) {
            continue;   // a marker with a blank name: unplaceable by
        }                // key, so left out rather than shown as ""
        out[key] = {
            name: m.name,
            engine: m.placement,
            layer: m.layer,
            // Every custom pattern's boundary is the same one layer --
            // CTRL-AREA-BOUNDARY -- because there is no per-pattern
            // boundary appearance to choose in the editor; only the
            // shipped BEDROCK/WATER/SUMP/FLOWSTONE trio route their
            // boundary onto their own fill layer instead, and that is
            // a catalog-authored exception, not something a caver's
            // own pattern can opt into from the editor.
            boundaryLayer: "CTRL-AREA-BOUNDARY",
            blocks: [m.block],
            density: m.density,
            scaleMin: m.scaleMin,
            scaleMax: m.scaleMax,
            rotate: m.rotate,
            // A caver's own "what is it?" line, carried through exactly
            // as CsArea.CATALOG's own built-in entries carry theirs --
            // one field, read by both the tile tooltip and the legend
            // that reuses it, never duplicated in a second place. Empty
            // is a valid answer (m.help defaults to "" in areaMetaOf),
            // not a caver's oversight to fix.
            help: m.help,
            custom: true
        };
    }
    for (var ck in CsArea.CATALOG) {
        if (CsArea.CATALOG.hasOwnProperty(ck)) {
            out[ck] = CsArea.CATALOG[ck];
        }
    }
    return out;
};

/** A catalog entry by key, built-in or (from Task 11) custom -- see
 *  CsArea.merged() for how the two are combined and which one wins a
 *  name collision. */
CsArea.entryFor = function(key) {
    var m = CsArea.merged();
    return isNull(m[key]) ? null : m[key];
};

/** Even-odd point in polygon. A self-intersecting boundary is answered
 *  by this rule and not repaired -- a figure-eight fills its lobes. */
CsArea.pointInPolygon = function(px, py, verts) {
    var inside = false;
    var n = verts.length;
    if (n < 3) {
        return false;
    }
    var x1 = verts[0].x, y1 = verts[0].y;
    for (var i = 1; i <= n; i++) {
        var x2 = verts[i % n].x, y2 = verts[i % n].y;
        if ((y1 > py) !== (y2 > py)) {
            var xInt = (x2 - x1) * (py - y1) / (y2 - y1) + x1;
            if (px < xInt) {
                inside = !inside;
            }
        }
        x1 = x2;
        y1 = y2;
    }
    return inside;
};

/**
 * Unsigned area of a polygon, via the signed shoelace sum.
 *
 * Self-intersecting boundaries are not repaired in v1 (see
 * pointInPolygon above): a figure-eight's two lobes wind opposite ways,
 * so THIS sum cancels them rather than adding them, even though
 * pointInPolygon fills both lobes. The area a figure-eight is scattered
 * against is therefore smaller than its visible footprint, and it
 * comes out sparser than it looks -- a known, accepted v1 gap, not a
 * bug to chase here.
 */
CsArea.polygonArea = function(verts) {
    var a = 0;
    for (var i = 0; i < verts.length; i++) {
        var p1 = verts[i], p2 = verts[(i + 1) % verts.length];
        a += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(a) / 2;
};

/** The bounding box of a polygon: {minX, minY, maxX, maxY}, or null for
 *  an empty vertex list -- every current caller already guards against
 *  fewer than 3 verts, but this is exported and must not throw. */
CsArea.bounds = function(verts) {
    if (verts.length === 0) {
        return null;
    }
    var b = { minX: verts[0].x, minY: verts[0].y,
              maxX: verts[0].x, maxY: verts[0].y };
    for (var i = 1; i < verts.length; i++) {
        b.minX = Math.min(b.minX, verts[i].x);
        b.minY = Math.min(b.minY, verts[i].y);
        b.maxX = Math.max(b.maxX, verts[i].x);
        b.maxY = Math.max(b.maxY, verts[i].y);
    }
    return b;
};

/**
 * Where a scattered OR tiled pattern's elements go -- dispatches to
 * scatterPlacements or tiledPlacements below by entry.engine, both of
 * which take the same shape of arguments and answer the same shape of
 * result, so a caller (CsArea.build, CsTileArt.iconOfScatter) never has
 * to know which one it is asking.
 *
 * \return [{x, y, block, scale, angle}, ...]
 */
CsArea.placements = function(verts, entry, seed, scale, density) {
    if (verts.length < 3 ||
        (entry.engine !== "scatter" && entry.engine !== "tile") ||
        isNull(entry.blocks) || entry.blocks.length === 0) {
        return [];
    }
    var mul = isNull(scale) ? 1.0 : scale;
    var densityMul = isNull(density) ? 1.0 : density;
    var rand = CsArea.rng(seed);
    return entry.engine === "tile" ?
        CsArea.tiledPlacements(verts, entry, rand, mul, densityMul) :
        CsArea.scatterPlacements(verts, entry, rand, mul, densityMul);
};

/**
 * Rejection sampling inside the bounding box, with a cap so a boundary
 * that is nearly all box -- a long thin passage cutting a diagonal --
 * cannot spin. The cap is generous: a 10% hit rate still fills.
 *
 * MINIMUM SPACING (Task 12 review round 2, 2026-09-11): ScatterBreakdown's
 * own pre-transplant sampler rejected a candidate closer than
 * `sqrt(area / want) * entry.spacingFactor` to one already accepted, so
 * boulders never landed on top of each other. The first version of this
 * transplant dropped that rule entirely -- CsArea.scatterPlacements had
 * no spacing rejection at all -- which is a real, visible regression for
 * BLOCKS: coincident boulders the old tool never produced. Restored
 * here as an entry-level opt-in (`entry.spacingFactor`) rather than a
 * blanket rule, because a dense stipple (SAND, CLAY) has no business
 * paying for a spacing check it does not want and does not need -- see
 * CsArea.CATALOG's own entries for which patterns set it.
 *
 * THE SAME DISCIPLINE as the point-in-polygon test: every candidate's
 * random draws (position, block, scale, angle) happen BEFORE either
 * rejection test, hit or miss on EITHER test, so the sequence still
 * depends only on the seed and the geometry -- a spacing-rejected
 * candidate costs exactly one more `tries` count, not an extra draw
 * order change, and the same seed still reproduces the same placements.
 * The existing try cap (want * 60 + 500) is UNCHANGED: a dense pattern
 * in a thin polygon (or one so tightly spaced it cannot fit `want`
 * elements at all) degrades to fewer accepted elements rather than
 * spinning, exactly as it already did for the point-in-polygon test.
 */
CsArea.scatterPlacements = function(verts, entry, rand, mul, densityMul) {
    var out = [];
    var area = CsArea.polygonArea(verts);
    var want = Math.round((area / 100) * entry.density * densityMul);
    if (want <= 0) {
        return out;
    }
    var b = CsArea.bounds(verts);
    var w = b.maxX - b.minX, h = b.maxY - b.minY;
    var minSpacing = 0;
    if (!isNull(entry.spacingFactor) && entry.spacingFactor > 0) {
        minSpacing = Math.sqrt(area / want) * entry.spacingFactor;
        // BLOCKS' own absolute floor, carried over verbatim from
        // ScatterBreakdown's pre-transplant formula
        // (Math.max(0.6, sqrt(area/targetCount) * 0.55)): without it a
        // tiny or extremely dense boundary could compute a spacing near
        // zero, which is no spacing rule at all. Optional per entry --
        // DEBRIS and PEBBLES scatter smaller elements and set no floor.
        if (!isNull(entry.spacingMin) && entry.spacingMin > minSpacing) {
            minSpacing = entry.spacingMin;
        }
    }
    var minSpacingSq = minSpacing * minSpacing;
    var tries = 0, cap = want * 60 + 500;
    while (out.length < want && tries < cap) {
        tries++;
        // These draws happen BEFORE either rejection test, every
        // attempt, hit or miss. That is what makes the sequence depend
        // only on the seed and the geometry -- never on how many points
        // happened to land outside or too close -- so the same seed
        // always reproduces the same placements. Reordering "to save a
        // draw on a miss" breaks that.
        var x = b.minX + rand() * w;
        var y = b.minY + rand() * h;
        var pickBlock = rand();
        var pickScale = rand();
        var pickAngle = rand();
        if (!CsArea.pointInPolygon(x, y, verts)) {
            continue;
        }
        if (minSpacing > 0) {
            var tooClose = false;
            for (var oi = 0; oi < out.length; oi++) {
                var ddx = x - out[oi].x, ddy = y - out[oi].y;
                if (ddx * ddx + ddy * ddy < minSpacingSq) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) {
                continue;
            }
        }
        var blockIndex = Math.min(entry.blocks.length - 1,
            Math.floor(pickBlock * entry.blocks.length));
        out.push({
            x: x, y: y,
            block: entry.blocks[blockIndex],
            scale: mul * (entry.scaleMin +
                pickScale * (entry.scaleMax - entry.scaleMin)),
            angle: entry.rotate ? pickAngle * 2 * Math.PI : 0.0
        });
    }
    return out;
};

/**
 * Where a TILED pattern's elements go: an actual lattice, not the
 * scatter engine wearing a different label. Nathan's element-plus-rule
 * design (see this file's header) means Tiled is HALF of that rule --
 * offering the choice and then scattering anyway (the first draft of
 * Task 11 did exactly this) is a UI that lies about what it is about to
 * draw, which is worse than not offering Tiled at all.
 *
 * SPACING FROM DENSITY, same vocabulary the scatter engine's density
 * number already uses ("elements per 100 sq units"): a lattice cell of
 * area 100/density, on an infinite plane, produces exactly that many
 * elements per 100 sq units, so a caver's Default Density field means
 * the same thing under either placement rule.
 *
 * JITTERED, not a bare grid: a perfectly regular lattice of picture
 * elements reads as a drawing error, not floor texture. Each lattice
 * point moves by up to 15% of the spacing -- enough to break the eye's
 * grid-detection, never enough for a row to cross its neighbour's row.
 *
 * THE SAME DISCIPLINE as scatterPlacements: every lattice cell draws
 * its jitter/block/scale/angle from the rng before the inside test is
 * even asked, hit or miss, empty cell or not -- so the sequence depends
 * only on the seed and the geometry, and a regenerate() reproduces the
 * exact same lattice a stroke first drew.
 */
CsArea.tiledPlacements = function(verts, entry, rand, mul, densityMul) {
    var out = [];
    var b = CsArea.bounds(verts);
    var w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (!(w > 0) || !(h > 0)) {
        return out;
    }
    var effDensity = entry.density * densityMul;
    if (!(effDensity > 0)) {
        return out;
    }
    var spacing = Math.sqrt(100 / effDensity);
    if (!(spacing > 0) || isNaN(spacing)) {
        return out;
    }
    var jitter = spacing * 0.15;

    // Capped independently of area: a lattice's cell count is bounded
    // by spacing alone, never by "how many were wanted" the way the
    // scatter branch's retry cap is -- so a caver dragging a huge loop
    // with a fine spacing cannot make this spin the way an unbounded
    // want could.
    var cols = Math.min(2000, Math.max(1, Math.ceil(w / spacing) + 1));
    var rows = Math.min(2000, Math.max(1, Math.ceil(h / spacing) + 1));

    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            var gx = b.minX + c * spacing;
            var gy = b.minY + r * spacing;
            var jx = (rand() - 0.5) * 2 * jitter;
            var jy = (rand() - 0.5) * 2 * jitter;
            var pickBlock = rand();
            var pickScale = rand();
            var pickAngle = rand();
            var x = gx + jx, y = gy + jy;
            if (!CsArea.pointInPolygon(x, y, verts)) {
                continue;
            }
            var blockIndex = Math.min(entry.blocks.length - 1,
                Math.floor(pickBlock * entry.blocks.length));
            out.push({
                x: x, y: y,
                block: entry.blocks[blockIndex],
                scale: mul * (entry.scaleMin +
                    pickScale * (entry.scaleMax - entry.scaleMin)),
                angle: entry.rotate ? pickAngle * 2 * Math.PI : 0.0
            });
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// Building and clearing a fill in a real document (Task 5). Everything
// above this line is pure geometry and never touches doc/op; everything
// below writes into one.
// ---------------------------------------------------------------------

/** The XDATA key every generated fill entity carries. Read back by
 *  ownedBy/clear so a boundary's fill can be found and thrown away
 *  without remembering which entities it made. */
CsArea.OWNER_KEY = "AreaOwner";

/** Keys on the boundary itself -- not read by this file, but named here
 *  so the stroke action (Task 6) and the listener (Task 7) agree with
 *  each other on what an area's XDATA looks like. */
CsArea.ID_KEY = "AreaId";
CsArea.PATTERN_KEY = "AreaPattern";
CsArea.SCALE_KEY = "AreaScale";
CsArea.DENSITY_KEY = "AreaDensity";
CsArea.SEED_KEY = "AreaSeed";

/** A hand-set hatch angle, filled patterns only (2026-09-12). There is
 *  no catalog-wide "AngleScale" the way SCALE_KEY multiplies
 *  entry.patternScale -- an angle has no baseline worth multiplying,
 *  so this holds the caver's override outright, or "" to mean "use
 *  the catalog's own patternAngle". Never read or written for a
 *  scatter/tile entry. */
CsArea.ANGLE_KEY = "AreaAngle";

/**
 * WHAT WE LAST WROTE, not what a caver may have since changed by hand.
 * CsArea.buildHatch stamps its own effective scale/angle here every
 * time it builds a hatch; CsArea.regenerate compares a live hatch
 * entity's CURRENT RHatchEntity.getScale()/getAngle() against these
 * two before touching anything, and a mismatch is how it tells "the
 * caver used the property editor" apart from "this is our own last
 * output" (2026-09-12 -- Nathan: both the Areas panel's Scale box and
 * CaveCAD's standard property editor must work AND persist). Without
 * this pair, a rebuild has no way to distinguish those two cases and
 * either fights the caver's edit forever or -- if it just stopped
 * rebuilding filled patterns altogether -- fights nothing at all. */
CsArea.HATCH_SCALE_KEY = "AreaHatchScale";
CsArea.HATCH_ANGLE_KEY = "AreaHatchAngle";

/** Below this, a float apart is noise (undo/redo round-trips, DXF
 *  string round-trips through CsTags), not a caver's edit. Wide
 *  enough to swallow that noise, tight enough that a real Scale-box or
 *  property-editor change -- always at least hundredths -- still
 *  reads as one. The freeze lesson this suite keeps relearning is a
 *  float that never quite equals its own last write; this is the
 *  guard against becoming the next one. */
CsArea.HATCH_EPS = 1e-6;

/** How finely a boundary curve is sampled into a polygon. */
CsArea.STEP = 0.25;

/**
 * A boundary entity as [{x, y}, ...].
 *
 * THE SPLINE PROXY TRAP. shape.getPointCloud() on an RSpline delegates
 * (RSpline.cpp) to approximateWithArcs(), which needs a spline proxy
 * plugin that a `-no-gui -autostart` run never loads -- measured EMPTY
 * there for both an open and a closed spline, while the identical call
 * returns real points inside the GUI. Branching on WHETHER that first
 * attempt came back empty would make one boundary sample differently in
 * the two environments: polygonArea, bounds and pointInPolygon would
 * then disagree with themselves across environments, and the same seed
 * would scatter differently in a screenshot than in this test. So the
 * branch below is fixed by the shape's TYPE, not by what getPointCloud
 * happened to return -- a spline ALWAYS goes through getExploded()'s
 * line/arc segments (not proxy-dependent, and not "an optimisation" to
 * skip when getPointCloud looks like it worked), and everything else
 * (polyline, circle, arc, line, ellipse) ALWAYS samples directly, which
 * is both cheaper and exactly as accurate for those shapes in both
 * environments. Do not turn this back into an emptiness check.
 */
CsArea.vertsOf = function(entity) {
    var out = [];
    var shape;
    try {
        shape = entity.getData().castToShape();
    } catch (e) {
        return [];
    }
    if (isNull(shape)) {
        return [];
    }
    try {
        if (shape.getShapeType() === RShape.Spline) {
            var segments = entity.getExploded();
            for (var s = 0; s < segments.length; s++) {
                var pts = segments[s].getPointCloud(CsArea.STEP);
                for (var p = 0; p < pts.length; p++) {
                    out.push({ x: pts[p].x, y: pts[p].y });
                }
            }
        } else {
            var cloud = shape.getPointCloud(CsArea.STEP);
            for (var i = 0; i < cloud.length; i++) {
                out.push({ x: cloud[i].x, y: cloud[i].y });
            }
        }
    } catch (eSample) {
        return [];
    }
    return out;
};

/**
 * Builds one area's fill into an operation the caller applies.
 *
 * Never throws: a missing block or an unshaped boundary comes back as
 * {ok: false, reason} so a caller (the stroke action, the listener) can
 * report it to the caver instead of crashing a transaction.
 *
 * \param opts {id, seed, scale, density, layer, angle}. `angle` is
 *        read only by the filled/hatch engine (CsArea.buildHatch) --
 *        a scatter/tile entry's per-element rotation is entry.rotate,
 *        untouched by this. Omitted (null/undefined) on every fresh
 *        stroke; CsArea.regenerate is the only caller that ever passes
 *        one, carrying a caver's own hand-set hatch angle forward.
 * \param di, when given, lets a CUSTOM pattern's block be imported into
 *        `doc` on demand -- see the missing-block branch below. Built-in
 *        patterns are unaffected whether `di` is given or not: their
 *        scatter blocks come from the template CaveTemplateApply pours
 *        into every new drawing, never from a caver's own library, so
 *        there is nothing for this to fetch on their behalf.
 * \return {ok, count, reason}
 */
CsArea.build = function(doc, op, boundary, entry, opts, di) {
    if (isNull(entry)) {
        return { ok: false, count: 0, reason: "no such pattern" };
    }
    var verts = CsArea.vertsOf(boundary);
    if (verts.length < 3) {
        return { ok: false, count: 0, reason: "the boundary has no area" };
    }
    if (entry.engine === "filled") {
        return CsArea.buildHatch(doc, op, boundary, entry, opts);
    }
    var places = CsArea.placements(verts, entry, opts.seed, opts.scale,
        opts.density);
    // Built into a local array FIRST, queued into `op` only once every
    // placement has cleared the missing-block check. Calling
    // op.addObject as each one passes would leave a LATER failure with
    // earlier references already sitting in the caller's operation --
    // and since this function reports {ok: false}, a caller has every
    // reason to think applying that op is safe. It is not: op does not
    // know "ok" from "false", only what was queued into it. Nothing
    // partial may ever reach op.
    var refs = [];
    for (var i = 0; i < places.length; i++) {
        var block = doc.queryBlock(places[i].block);
        // isNull, not a truthiness check: a missing block comes back as
        // a WRAPPED non-null object (typeof "object", getId()
        // undefined), not JS null -- see the file header on CsArea and
        // tools/make_area_blocks.js for the same trap.
        if (isNull(block) && !isNull(di) && entry.custom === true) {
            // A CUSTOM pattern's block never came from the template --
            // only ever from the caver's own library
            // (CsSymbolStore.customPath()) -- so a drawing that has
            // never placed this pattern before does not have it yet.
            // Imported here, once, the same CsSymbolStore.ensureBlock
            // path a placed SYMBOL already uses, so a pattern saved in
            // one drawing fills correctly in the very next one with no
            // "paste the block in first" step.
            var imported = CsSymbolStore.ensureBlock(doc, di,
                places[i].block);
            if (imported.ok) {
                block = doc.queryBlock(places[i].block);
            }
        }
        if (isNull(block)) {
            return { ok: false, count: 0,
                reason: "this drawing has no " + places[i].block + " block" };
        }
        var data = new RBlockReferenceData(block.getId(),
            new RVector(places[i].x, places[i].y),
            new RVector(places[i].scale, places[i].scale),
            places[i].angle, 1, 1, 1, 1);
        var ref = new RBlockReferenceEntity(doc, data);
        ref.setLayerId(doc.getLayerId(opts.layer));
        CsTags.set(ref, CsArea.OWNER_KEY, opts.id);
        refs.push(ref);
    }
    for (var r = 0; r < refs.length; r++) {
        op.addObject(refs[r], false);
    }
    return { ok: true, count: refs.length, reason: "" };
};

/**
 * One hatch entity over the boundary loop. BEDROCK has no pattern and
 * draws nothing: its edge IS the symbol, so there is nothing to fill.
 *
 * THE POLYLINE TRAP. RHatchData.addBoundary will not stand a closed
 * POLYLINE up as a single boundary shape -- QCAD's own Hatch tool
 * (scripts/Draw/Hatch/HatchFromSelection/HatchFromSelection.js,
 * .traverse) never tries: for a closed polyline it explodes into line
 * and arc segments and adds each one to the loop, and only a circle,
 * full ellipse or closed SPLINE goes in whole via
 * getData().castToShape().clone(). Duck-typed on getVertices rather
 * than the simple.js/library.js global isPolylineEntity, which this
 * Core file has no business assuming is loaded.
 *
 * opts.scale MULTIPLIES entry.patternScale (2026-09-12, Nathan): before
 * this, the Areas panel's Scale spin box was wired to opts.scale but
 * this function never read it, so the box did nothing for every filled
 * pattern -- worse than disabling it, because it looked live. "How big
 * is the texture" now means the same thing for a hatch as it already
 * does for a scatter's element size. opts.angle, when given, overrides
 * entry.patternAngle outright -- it carries a caver's own hand-set
 * angle forward from CsArea.regenerate's capture (see HATCH_SCALE_KEY's
 * own header); a fresh stroke never sets it, so the catalog angle still
 * wins there. Returns the EFFECTIVE scale/angle it actually used, so a
 * caller can stamp AreaHatchScale/AreaHatchAngle and later tell its own
 * output apart from an edit.
 */
CsArea.buildHatch = function(doc, op, boundary, entry, opts) {
    if (isNull(entry.pattern)) {
        return { ok: true, count: 0, reason: "" };
    }
    var baseScale = isNull(entry.patternScale) ? 1.0 : entry.patternScale;
    var scaleMul = isNull(opts.scale) ? 1.0 : opts.scale;
    var effScale = baseScale * scaleMul;
    var baseAngle = isNull(entry.patternAngle) ? 0.0 : entry.patternAngle;
    var effAngle = isNull(opts.angle) ? baseAngle : opts.angle;

    var data = new RHatchData(entry.solid === true, effScale, effAngle,
        entry.pattern);
    data.newLoop();
    try {
        var bd = boundary.getData();
        if (typeof bd.getVertices === "function" &&
                typeof boundary.getExploded === "function") {
            var segments = boundary.getExploded();
            for (var i = 0; i < segments.length; i++) {
                data.addBoundary(segments[i].clone());
            }
        } else {
            data.addBoundary(bd.castToShape().clone());
        }
    } catch (eShape) {
        return { ok: false, count: 0,
            reason: "this boundary has no usable shape" };
    }
    var hatch = new RHatchEntity(doc, data);
    hatch.setLayerId(doc.getLayerId(opts.layer));
    CsTags.set(hatch, CsArea.OWNER_KEY, opts.id);
    op.addObject(hatch, false);
    return { ok: true, count: 1, reason: "", scale: effScale,
        angle: effAngle };
};

/** Every entity id belonging to one area's fill. */
CsArea.ownedBy = function(doc, areaId) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsArea.OWNER_KEY) === areaId) {
            out.push(ids[i]);
        }
    }
    return out;
};

/** How many entities belong to one area's fill. */
CsArea.countOwned = function(doc, areaId) {
    return CsArea.ownedBy(doc, areaId).length;
};

/** Deletes one area's fill into an operation the caller applies. Only
 *  entities tagged with THIS areaId -- a neighbour's fill, or anything
 *  else in the drawing, is untouched. */
CsArea.clear = function(doc, op, areaId) {
    var ids = CsArea.ownedBy(doc, areaId);
    for (var i = 0; i < ids.length; i++) {
        op.deleteObject(doc.queryEntityDirect(ids[i]));
    }
    return ids.length;
};

// ---------------------------------------------------------------------
// Following a boundary that already exists in a document (Task 7):
// regenerating a fill from a boundary's own tags, sweeping fill whose
// boundary is gone, and the layer resolution the stroke (AreaFillRun,
// Task 6) and this regeneration share. Everything above this divider
// either never touches a document or was written for Tasks 5-6;
// everything from here down is Task 7's own addition.
//
// LIVES HERE, NOT in AreaFillListener.js, for the same reason
// CsShapeLine.reconcile lives in Core/CsShapeLine.js and not in
// ShapedLinesListener.js: a transaction listener is a thin dispatcher
// (busy flag, the cheap per-object gate, wiring into QCAD's signal),
// and the actual business logic belongs where any OTHER caller can
// reach it without dragging a transaction-listener file along -- Task
// 12's "Sync Areas" menu tool regenerates every area on demand and
// must not have to include a file whose only other job is listening
// for live transactions it isn't one of.
// ---------------------------------------------------------------------

/**
 * Where an area's fill and its boundary land, from ONE reading of the
 * drawing's routing state.
 *
 * SHARED, deliberately, because AreaFillRun.commit (the stroke that
 * draws a boundary) and CsArea.regenerate below (rebuilding its fill,
 * whether from the live listener or a future "Sync Areas" tool) must
 * never disagree about where the fill belongs. A caller that re-
 * derived the layer its own way, even slightly differently, could
 * regenerate a sand scatter onto BREAKDOWN because it read the routing
 * rule a hair differently than the stroke that drew the boundary did.
 *
 * WHERE THE FIRST VERTEX LANDS decides the frame -- the same
 * CsProfileBox.frameAt / CsLayers.twinFor / CsLayerVariants.nameFor
 * idiom Feature Trace and ScatterBreakdown both already use. There is
 * no plan button and no profile button.
 *
 * Only "profile" gets a run variant. A section area carries its bay's
 * station on the boundary itself (see AreaFillRun.commit's call to
 * CsTrace.tripFor), not a per-run layer -- a section has no bands to
 * split by, unlike the profile's survey runs.
 *
 * \return {frame, bays, fillLayer, boundaryLayer}
 */
CsArea.layersFor = function(doc, entry, verts) {
    var region = CsTrace.profileRegion(doc);
    var bays = CsTrace.sectionBays(doc);
    var frame = CsProfileBox.frameAt(doc, region, verts[0], bays);
    var fillLayer = CsLayers.twinFor(entry.layer, frame);
    var boundaryLayer = CsLayers.twinFor(entry.boundaryLayer, frame);

    if (frame === "profile") {
        var run = CsProfileBox.runForPath(CsProfileBox.boxes(doc), verts);
        if (!isNull(run)) {
            var fillVariant = CsLayerVariants.nameFor(fillLayer, run);
            var boundaryVariant = CsLayerVariants.nameFor(boundaryLayer, run);
            // nameFor answers null for a base the registry does not
            // define (CsLayerVariants' own guard) -- fall back to the
            // shared layer rather than hand a null layer name down the
            // line to CsLayers.ensure.
            if (fillVariant !== null) {
                fillLayer = fillVariant;
            }
            if (boundaryVariant !== null) {
                boundaryLayer = boundaryVariant;
            }
        }
    }

    return { frame: frame, bays: bays, fillLayer: fillLayer,
        boundaryLayer: boundaryLayer };
};

/** XDATA key holding the signature of the last successful regenerate,
 *  written to the BOUNDARY (never the fill, which is disposable and
 *  gets thrown away and rebuilt). Compared on every regenerate() so an
 *  unchanged boundary is a string compare and a return, never a
 *  clear+rebuild. */
CsArea.SIG_KEY = "AreaFillSig";

/** A string that changes if and only if a regenerate would produce a
 *  different fill: the boundary's own pattern/seed/scale/density/angle
 *  tags, plus its sampled geometry rounded to a thousandth of a
 *  drawing unit. Float noise from move()/undo/redo must not be
 *  mistaken for a real edit, and a real edit -- even a sub-pixel grip
 *  nudge -- must never be mistaken for none. ANGLE_KEY is included for
 *  the same reason SCALE_KEY already was, even though the one caller
 *  that ever writes it (CsArea.regenerate's own hatch-drift capture)
 *  bypasses this signature check entirely on the call that writes it --
 *  a future caller reading it need not know that.
 *
 *  A ONE-TIME MIGRATION COST, accepted (2026-09-12): adding ANGLE_KEY
 *  to this string changes what every EXISTING area's signature hashes
 *  to, because an old boundary has no AreaAngle tag yet -- so the very
 *  first regenerate that touches each boundary after this upgrade
 *  finds a mismatch, and rebuilds: every one of that area's fill
 *  entities is deleted and recreated with new ids. This applies to a
 *  SCATTER area exactly as much as a filled one, even though scatter
 *  never reads ANGLE_KEY for anything -- the string changed, so the
 *  compare fails, so it rebuilds once, same seed, same placements
 *  (CsArea.rng is untouched), just new entity ids and a drawing marked
 *  modified. Harmless, since a fill is derived and disposable and this
 *  is exactly what regeneration exists to do -- but real: a caver who
 *  asks "why did my boulders move" after upgrading has this as the
 *  answer (they didn't move; their ids did). Every area is quiet again
 *  -- "unchanged" -- on its second touch. Not worth a version-tagged
 *  signature to avoid one harmless rebuild. */
CsArea.signature = function(boundary, verts) {
    var parts = [];
    for (var i = 0; i < verts.length; i++) {
        parts.push(Math.round(verts[i].x * 1000) + "," +
            Math.round(verts[i].y * 1000));
    }
    return [
        CsTags.get(boundary, CsArea.PATTERN_KEY),
        CsTags.get(boundary, CsArea.SEED_KEY),
        CsTags.get(boundary, CsArea.SCALE_KEY),
        CsTags.get(boundary, CsArea.DENSITY_KEY),
        CsTags.get(boundary, CsArea.ANGLE_KEY),
        parts.join(";")
    ].join("|");
};

/**
 * ONE walk of the document answering both halves of "which fill goes
 * with which boundary": every live boundary's entity, by its AreaId,
 * and every fill entity's id, grouped by the AreaId it is owned by.
 *
 * THE SHARED SCAN. Before this existed, a caller reconciling several
 * areas in one transaction (a drag that touches many boundaries, or a
 * future "Sync Areas" that touches all of them) paid one
 * queryAllEntities walk per area just to find its boundary
 * (boundaryOf), and sweep paid another per area on top of that --
 * O(areas) full-document scans where one suffices. Every caller that
 * needs more than one lookup in the same transaction should build this
 * ONCE and pass it to boundaryOf/sweep/regenerate rather than let each
 * of them scan again.
 *
 * \return {owners: {areaId: [entityId, ...]}, boundaries: {areaId: entity}}
 */
CsArea.areaScan = function(doc) {
    var owners = {};
    var boundaries = {};
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var aid = CsTags.get(e, CsArea.ID_KEY);
        if (aid !== "") {
            boundaries[aid] = e;
            continue;
        }
        var oid = CsTags.get(e, CsArea.OWNER_KEY);
        if (oid !== "") {
            if (isNull(owners[oid])) {
                owners[oid] = [];
            }
            owners[oid].push(ids[i]);
        }
    }
    return { owners: owners, boundaries: boundaries };
};

/** The boundary entity carrying one area's id, or null when there is
 *  none -- deleted, or never existed. queryAllEntities(false, true)
 *  (which areaScan uses) EXCLUDES undone entities, unlike
 *  queryEntity(id) on a stale id (which comes back with isUndone() ===
 *  true rather than null) -- so this is the "is it still really here"
 *  check, not queryEntity's.
 *
 *  `scan`, when given (from a caller's own CsArea.areaScan), is reused
 *  instead of walking the document again -- pass one whenever more
 *  than one area is being looked up in the same pass. */
CsArea.boundaryOf = function(doc, areaId, scan) {
    var s = isNull(scan) ? CsArea.areaScan(doc) : scan;
    return isNull(s.boundaries[areaId]) ? null : s.boundaries[areaId];
};

/**
 * Deletes any area fill whose boundary is gone -- a fill nobody can
 * edit is a fill nobody wants sitting in the drawing pretending to be
 * current content.
 *
 * Takes `scan` (from CsArea.areaScan) so a caller who already walked
 * the document once this transaction -- AreaFillListener.onTransaction
 * does, to resolve every touched area's boundary -- never pays for a
 * second walk just to sweep. Without a `scan`, builds its own: still
 * one walk, never one per area.
 *
 * \return how many entities were swept
 */
CsArea.sweep = function(doc, di, group, scan) {
    var s = isNull(scan) ? CsArea.areaScan(doc) : scan;
    var orphanIds = [];
    for (var areaId in s.owners) {
        if (!s.owners.hasOwnProperty(areaId)) {
            continue;
        }
        if (isNull(s.boundaries[areaId])) {
            orphanIds = orphanIds.concat(s.owners[areaId]);
        }
    }
    if (orphanIds.length === 0) {
        return 0;
    }

    var del = new RDeleteObjectsOperation();
    for (var o = 0; o < orphanIds.length; o++) {
        var ent = doc.queryEntityDirect(orphanIds[o]);
        if (!isNull(ent)) {
            del.deleteObject(ent);
        }
    }
    if (group !== null && group !== undefined && group >= 0) {
        del.setTransactionGroup(group);
    }
    di.applyOperation(del);
    return orphanIds.length;
};

/**
 * Clears and rebuilds one area's fill from its boundary's OWN tags.
 *
 * `boundaryId` is the boundary entity's real object id, not the AreaId
 * it carries.
 *
 * NEVER RE-ROLLS THE SEED. It is read off the boundary, exactly as
 * written at creation (AreaFillRun.commit), never regenerated here --
 * a regenerate that re-rolled it would reshuffle a caver's boulder
 * room on every touch, which is the one thing this whole mechanism
 * exists to prevent.
 *
 * `group`, when given, joins both writes to the triggering edit's
 * transaction group so one Ctrl+Z takes the caver's edit and the
 * rebuild together -- the same idiom CsShapeLine.decorate uses.
 *
 * `ownedIds`, when given (from a caller's own CsArea.areaScan), is
 * used as this area's current fill instead of a fresh CsArea.ownedBy
 * scan -- the other half of the shared-scan saving areaScan's own
 * header describes. Omit it (as a direct call from a test, or any
 * caller with no scan of its own) and this falls back to one
 * CsArea.ownedBy walk, same as before areaScan existed.
 *
 * COST, HONESTLY: even with a shared scan, this is not a free check.
 * The "unchanged" fast path below is a signature STRING COMPARE (O(1)
 * once verts are in hand) plus whatever `ownedIds` cost to obtain --
 * one shared document walk per transaction when a caller passes a
 * scan, one CsArea.ownedBy walk per call otherwise. What the freeze
 * guarantees is that an unchanged area writes NOTHING and rebuilds
 * NOTHING; it was never advertised as reading nothing, and a
 * transaction that touches many areas already amortises the walk
 * across all of them via one shared scan.
 *
 * `allowImport` (Task 12, 2026-09-11): when true, a missing CUSTOM
 * pattern's block is imported into `doc` on the caller's behalf -- see
 * the NO `di` HANDED TO build() comment below for why this defaults to
 * false/undefined and stays that way for AreaFillListener's own call.
 * Sync Areas (AreaSync.run) is the one caller that passes true: a caver
 * pressing that button is not inside a transaction callback the way the
 * listener is, so there is no reentrancy hazard to protect against.
 *
 * \return "missing" | "not-an-area" | "no-pattern" | "no-shape" |
 *         "unchanged" | "regenerated" | "failed:<reason>"
 */
CsArea.regenerate = function(doc, di, boundaryId, group, ownedIds,
        allowImport) {
    var boundary = doc.queryEntity(boundaryId);
    if (isNull(boundary) || boundary.isUndone()) {
        return "missing";
    }
    var areaId = CsTags.get(boundary, CsArea.ID_KEY);
    if (areaId === "") {
        return "not-an-area";
    }
    var key = CsTags.get(boundary, CsArea.PATTERN_KEY);
    var entry = CsArea.entryFor(key);
    if (isNull(entry)) {
        return "no-pattern";
    }
    var verts = CsArea.vertsOf(boundary);
    if (verts.length < 3) {
        return "no-shape";
    }

    var existing = isNull(ownedIds) ? CsArea.ownedBy(doc, areaId) : ownedIds;

    var scale = parseFloat(CsTags.get(boundary, CsArea.SCALE_KEY));
    if (isNaN(scale)) {
        scale = 1.0;
    }
    var angleTag = CsTags.get(boundary, CsArea.ANGLE_KEY);
    var angle = angleTag === "" ? null : parseFloat(angleTag);

    // CAPTURE (2026-09-12, Nathan): a caver can select a filled area's
    // hatch and change PropertyScaleFactor/PropertyAngle in CaveCAD's
    // own property editor, and it redraws at once -- but the fill is
    // DERIVED, rebuilt from these very tags on the next regenerate, so
    // without this the edit would look real for a moment and then
    // vanish with no warning the instant anything touched the
    // boundary. Told apart from our OWN last write by comparing the
    // live hatch's current scale/angle to what CsArea.buildHatch last
    // stamped (HATCH_SCALE_KEY/HATCH_ANGLE_KEY) -- NOT by comparing to
    // entry.patternScale/patternAngle, which would also fire on every
    // ordinary Areas-panel Scale change and fight the caver over which
    // input wins.
    //
    // Deliberately narrow: only filled patterns, only scale and angle.
    // Pattern name, origin, solid and colour stay derived from the
    // catalog on purpose -- a caver who wants a different pattern arms
    // a different tile, not this entity's PropertyPatternName.
    var captured = false;
    if (entry.engine === "filled" && !isNull(entry.pattern) &&
            existing.length === 1) {
        var liveHatch = doc.queryEntity(existing[0]);
        if (!isNull(liveHatch) && typeof liveHatch.getScale === "function" &&
                typeof liveHatch.getAngle === "function") {
            var wroteScale = parseFloat(
                CsTags.get(boundary, CsArea.HATCH_SCALE_KEY));
            var wroteAngle = parseFloat(
                CsTags.get(boundary, CsArea.HATCH_ANGLE_KEY));
            var liveScale = liveHatch.getScale();
            var liveAngle = liveHatch.getAngle();
            if (!isNaN(wroteScale) &&
                    Math.abs(liveScale - wroteScale) > CsArea.HATCH_EPS) {
                var patScale = isNull(entry.patternScale) ?
                    1.0 : entry.patternScale;
                if (patScale !== 0) {
                    // The inverse of buildHatch's own multiply: AreaScale
                    // is stored as "how much the caver wants on top of
                    // the catalog's own scale", so a hand-set 4.0 on a
                    // patternScale-2.0 entry stores 2.0, not 4.0 --
                    // otherwise the NEXT rebuild would double it again.
                    scale = liveScale / patScale;
                    captured = true;
                }
            }
            if (!isNaN(wroteAngle) &&
                    Math.abs(liveAngle - wroteAngle) > CsArea.HATCH_EPS) {
                angle = liveAngle;
                captured = true;
            }
            if (captured) {
                CsTags.set(boundary, CsArea.SCALE_KEY, scale);
                if (angle !== null) {
                    CsTags.set(boundary, CsArea.ANGLE_KEY, angle);
                }
            }
        }
    }

    // Computed AFTER capture, deliberately: signature() reads SCALE_KEY/
    // ANGLE_KEY straight off `boundary`, so if capture just rewrote
    // them, this already reflects the caver's edit rather than the
    // stale tag it would otherwise have hashed.
    var sig = CsArea.signature(boundary, verts);
    // A pattern with no fill AT ALL (BEDROCK: pattern === null) is
    // correctly zero entities every time -- that must read as
    // "unchanged" too, or this would clear+rebuild nothing, forever,
    // on every transaction that so much as looks at a bedrock boundary.
    var expectZero = entry.engine === "filled" && isNull(entry.pattern);
    if (!captured && sig === CsTags.get(boundary, CsArea.SIG_KEY) &&
            (existing.length > 0 || expectZero)) {
        return "unchanged";
    }

    var seed = parseFloat(CsTags.get(boundary, CsArea.SEED_KEY));
    var density = parseFloat(CsTags.get(boundary, CsArea.DENSITY_KEY));
    if (isNaN(seed)) {
        seed = CsArea.newSeed();   // only for a boundary predating this
    }                               // tag; never re-rolled once present
    if (isNaN(density)) {
        density = 1.0;
    }

    // THE SHARED resolver -- never read the fill layer off the
    // boundary's own layer. Most patterns route their boundary onto
    // CTRL-AREA-BOUNDARY while the fill belongs on the pattern's own
    // layer (or a profile/section twin of it); AreaFillRun.commit
    // resolves the exact same way, off the exact same verts, so a
    // stroke and its later regenerations can never disagree about
    // where the fill belongs.
    var routed = CsArea.layersFor(doc, entry, verts);
    CsLayers.ensure(doc, di, routed.fillLayer);

    var grouped = function(op) {
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    };

    if (existing.length > 0) {
        // Deleted directly from the ids already in hand, rather than
        // through CsArea.clear (which would re-walk the document to
        // rediscover exactly the ids this function already has).
        var del = new RDeleteObjectsOperation();
        for (var d = 0; d < existing.length; d++) {
            var oldEnt = doc.queryEntityDirect(existing[d]);
            if (!isNull(oldEnt)) {
                del.deleteObject(oldEnt);
            }
        }
        grouped(del);
    }

    // `di` HANDED TO build() ONLY WHEN `allowImport` SAYS SO. The
    // default (undefined, AreaFillListener's own call) keeps `di` out of
    // build() entirely: regenerate() runs from
    // AreaFillListener.onTransaction, inside a transaction callback,
    // with `busy` already true. Importing a missing custom block from
    // there means CsSymbolStore.ensureBlock -> copyBlock, which issues
    // several of its OWN applyOperation calls (the block, its layers,
    // its geometry) from inside that callback -- reentrant in a way this
    // file has not proven safe, and today "harmless" only because the
    // imported entities happen to carry no AreaId/AreaOwner tags for the
    // listener to notice. That is an accident of the current marker
    // shape, not a guarantee, so this does not lean on it: a rebuild
    // that finds its block missing reports the reason and leaves the
    // fill empty, exactly as it already does for a missing BUILT-IN
    // block. Importing on the caver's behalf stays where a caver
    // actually initiated the write -- AreaFillRun.commit (the
    // interactive stroke, which passes its own `di` directly to build())
    // and AreaSync.run (Task 12's Sync Areas, which passes
    // allowImport=true here because a caver pressing that menu command
    // is not inside a transaction callback either).
    var add = new RAddObjectsOperation();
    var built = CsArea.build(doc, add, boundary, entry,
        { id: areaId, seed: seed, scale: scale, density: density,
          angle: angle, layer: routed.fillLayer },
        allowImport === true ? di : null);
    if (built.ok && built.count > 0) {
        grouped(add);
    }

    if (!built.ok) {
        // Do NOT stamp the signature (or the captured scale/angle,
        // still sitting unmodified on `boundary` only in this
        // function's own JS object, never handed to an operation
        // above): the boundary is left with no fill (the old one, if
        // any, is already gone above), and the next transaction that
        // so much as looks at it must retry the build rather than
        // reading this as "unchanged" and giving up on it forever.
        return "failed:" + built.reason;
    }

    CsTags.set(boundary, CsArea.SIG_KEY, sig);
    // WHAT WE JUST WROTE, so the NEXT regenerate can tell a caver's
    // property-editor edit apart from this rebuild's own output --
    // see HATCH_SCALE_KEY's header. Only set for a real hatch
    // (built.scale undefined for a scatter/tile fill or for BEDROCK's
    // no-op build); left alone otherwise, same as ANGLE_KEY already
    // stays "" for every non-filled entry.
    if (!isNull(built.scale)) {
        CsTags.set(boundary, CsArea.HATCH_SCALE_KEY, built.scale);
        CsTags.set(boundary, CsArea.HATCH_ANGLE_KEY, built.angle);
    }
    var mod = new RModifyObjectsOperation();
    mod.addObject(boundary, false);
    grouped(mod);

    return "regenerated";
};

// ---------------------------------------------------------------------
// Repicking a pattern on an area that already exists (2026-09-12,
// beginner-friendliness batch). Everything above this divider was
// written for Tasks 5-12; from here down is new.
//
// THE DEFECT: an area's boundary already carries everything a fill is
// built from (AreaPattern, AreaScale, AreaDensity, AreaSeed), but
// nothing before this could WRITE a new AreaPattern onto a boundary
// that already had one -- the only way to change a tile was delete the
// boundary and re-trace the whole loop. Wrong-tile is exactly the
// mistake a beginner makes, so that recovery cost was the whole defect.
// ---------------------------------------------------------------------

/**
 * Resolves a raw selection (whatever `doc.querySelectedEntities()`
 * returned) down to the distinct AREA BOUNDARY entity ids among it.
 *
 * TWO WAYS IN, one answer. A boundary on CTRL-AREA-BOUNDARY prints as
 * nothing -- it is an invisible construction line by design -- but is
 * still selectable on screen; a beginner clicking on the actual drawn
 * texture selects the FILL instead (a boulder, a stipple dot), and
 * every fill entity carries AreaOwner pointing back at its area. Both
 * resolve here to the same boundary id, so a caller (AreaFill's tile
 * click) never has to know which one a caver actually clicked.
 *
 * DEDUPED BY AREA, not by input id: selecting a boundary AND one of its
 * own fill elements together (an easy rubber-band accident) must not
 * repattern that one area twice, which would cost it two identical
 * rebuilds inside what is supposed to read as one action.
 *
 * `scan`, when given (a caller's own CsArea.areaScan), is reused rather
 * than walked again -- the same shared-scan discipline CsArea.boundaryOf
 * and CsArea.sweep already follow. Built once here, lazily, only if a
 * fill id actually needs it -- a selection that is all boundaries costs
 * no document walk at all.
 *
 * \return [boundaryEntityId, ...], never containing the same area twice
 */
CsArea.resolveSelection = function(doc, ids, scan) {
    var out = [];
    var seen = {};
    var s = isNull(scan) ? null : scan;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) {
            continue;
        }
        var boundaryEntity = null;
        if (CsTags.get(e, CsArea.ID_KEY) !== "") {
            boundaryEntity = e;
        } else {
            var ownerId = CsTags.get(e, CsArea.OWNER_KEY);
            if (ownerId !== "") {
                if (s === null) {
                    s = CsArea.areaScan(doc);
                }
                boundaryEntity = CsArea.boundaryOf(doc, ownerId, s);
            }
        }
        if (isNull(boundaryEntity)) {
            continue;
        }
        var key = String(boundaryEntity.getId());
        if (seen[key] !== true) {
            seen[key] = true;
            out.push(boundaryEntity.getId());
        }
    }
    return out;
};

/**
 * Retags one or more existing area boundaries to a DIFFERENT pattern and
 * rebuilds their fill -- the recovery path for a beginner's wrong tile.
 * `boundaryIds` are boundary entity ids (CsArea.resolveSelection's own
 * output shape); an id that is missing, undone, or not an area boundary
 * is skipped rather than failing the whole batch.
 *
 * NEVER TOUCHES AreaSeed. The ground under the boundary has not moved --
 * only which symbols are drawn on it -- so the same seed that already
 * decided where a boulder pile's rocks land keeps deciding it under the
 * new pattern too. See CsArea.rng's and CsArea.newSeed's own headers on
 * why a seed is rolled once and never again.
 *
 * `opts` is {scale, density}, both optional. Given, they overwrite
 * AreaScale/AreaDensity on every boundary in the SAME write as the
 * pattern change -- this is also the path the Areas panel's own Scale
 * and Density boxes use to reach a SELECTED area (see AreaFill.
 * connectTile): re-clicking the pattern already armed, with an area
 * selected and the boxes changed, rewrites scale/density without
 * touching AreaPattern's value. Omitted, a boundary's existing
 * scale/density survive unchanged.
 *
 * ONE TRANSACTION GROUP for the whole batch, however many boundaries are
 * selected -- the retag and every rebuilt fill undo together in a single
 * Ctrl+Z, the same idiom AreaSync.run already uses to fold several
 * regenerate() calls into one undo step.
 *
 * VALIDATED BEFORE ANY WRITE: every id in `boundaryIds` is checked
 * against the live document before the shared RModifyObjectsOperation is
 * built, so a selection that mixes a real area with unrelated geometry
 * still retags every real area in one clean transaction rather than
 * failing outright or leaving a partial group behind.
 *
 * \return {ok, count, results: [{id, ok, reason}]} -- count is how many
 *         boundaries were actually retagged and rebuilt (ok===true in
 *         their own result); ok is true when count > 0.
 */
CsArea.repattern = function(doc, di, boundaryIds, key, opts) {
    var entry = CsArea.entryFor(key);
    var results = [];
    if (isNull(entry)) {
        return { ok: false, count: 0, results: results,
            reason: "no such pattern" };
    }
    if (isNull(boundaryIds) || boundaryIds.length === 0) {
        return { ok: false, count: 0, results: results,
            reason: "nothing selected" };
    }

    var valid = [];
    for (var i = 0; i < boundaryIds.length; i++) {
        var id = boundaryIds[i];
        var e = doc.queryEntity(id);
        if (isNull(e) || e.isUndone()) {
            results.push({ id: id, ok: false, reason: "missing" });
            continue;
        }
        if (CsTags.get(e, CsArea.ID_KEY) === "") {
            results.push({ id: id, ok: false, reason: "not an area" });
            continue;
        }
        valid.push(e);
    }
    if (valid.length === 0) {
        return { ok: false, count: 0, results: results,
            reason: "no valid area in that selection" };
    }

    var group = doc.getTransactionGroup() + 1;
    var mod = new RModifyObjectsOperation();
    for (var v = 0; v < valid.length; v++) {
        var boundary = valid[v];
        CsTags.set(boundary, CsArea.PATTERN_KEY, key);
        if (!isNull(opts) && !isNull(opts.scale)) {
            CsTags.set(boundary, CsArea.SCALE_KEY, String(opts.scale));
        }
        if (!isNull(opts) && !isNull(opts.density)) {
            CsTags.set(boundary, CsArea.DENSITY_KEY, String(opts.density));
        }
        mod.addObject(boundary, false);
    }
    mod.setTransactionGroup(group);
    di.applyOperation(mod);

    var okCount = 0;
    for (var r = 0; r < valid.length; r++) {
        // RE-QUERIED BY ID, not the `valid[r]` handle held above: a
        // handle read after a modify operation has already gone through
        // is the exact stale-tag trap this file's own header warns
        // about ("reading tags off a long-held entity handle after
        // modify operations gives stale values -- re-query").
        // CsArea.regenerate re-queries by id internally anyway; this
        // just hands it a fresh id, not a stale assumption about what
        // is on the entity.
        var boundaryId = valid[r].getId();
        var res = CsArea.regenerate(doc, di, boundaryId, group);
        var okOne = (res === "regenerated" || res === "unchanged");
        if (okOne) {
            okCount++;
        }
        results.push({ id: boundaryId, ok: okOne, reason: res });
    }

    return { ok: okCount > 0, count: okCount, results: results };
};

/**
 * A rough estimate of how many elements a scatter/tile pattern will
 * place over a polygon of the given area -- the SAME formula
 * CsArea.scatterPlacements uses for its own `want` (and the density
 * CsArea.tiledPlacements' lattice spacing works out to, per the header
 * on that function: "elements per 100 sq units" means the same thing
 * under either placement rule). Computed from the polygon area alone,
 * with no sampling -- this runs BEFORE a fill is built, specifically so
 * a caller can decide whether to build it at all.
 *
 * Zero for a filled (hatch) pattern, or any entry with no blocks to
 * scatter: a hatch is one entity regardless of boundary size, so it has
 * nothing here worth estimating or warning about.
 *
 * \return a non-negative integer
 */
CsArea.estimateCount = function(area, entry, densityMul) {
    if (isNull(entry) || (entry.engine !== "scatter" && entry.engine !== "tile")) {
        return 0;
    }
    var mul = isNull(densityMul) ? 1.0 : densityMul;
    var want = Math.round((area / 100) * entry.density * mul);
    return want > 0 ? want : 0;
};

/** The Areas panel's own Density box floor (AreaFill.js's densityBox
 *  reads THIS, rather than a second 0.1 written into its own setRange
 *  call) -- named and shared so a future change to the box's floor
 *  cannot drift away from what CsArea.suggestedDensityMul is willing to
 *  propose. Lives here, not in AreaFill.js: this file is GUI-free and
 *  loads under node as readily as inside CaveCAD (see this file's own
 *  header), so a test can read the same number the panel's spin box
 *  uses without loading any Qt widget at all. */
CsArea.DENSITY_FLOOR = 0.1;

/**
 * A density multiplier that would bring an over-threshold estimate down
 * to roughly `target` elements -- what a "thin it" offer actually thins
 * TO, not just a warning with nothing behind it.
 *
 * NEVER SUGGESTS RAISING the density (a caller offering to "thin" a fill
 * that hands back a bigger number would be a bug users would find fast),
 * and never suggests all the way to zero: clamped to CsArea.DENSITY_FLOOR
 * so whatever this function proposes is always a value the Areas panel's
 * own Density box can actually hold and a caver can actually type in by
 * hand later.
 *
 * Rounded to a hundredth: the box shows two decimals, and a suggestion
 * with more precision than the control that will display it just reads
 * as noise.
 */
CsArea.suggestedDensityMul = function(currentDensityMul, estimate, target) {
    var cur = isNull(currentDensityMul) ? 1.0 : currentDensityMul;
    if (!(estimate > 0) || !(target > 0) || estimate <= target) {
        return cur;
    }
    var suggested = Math.min(cur, cur * (target / estimate));
    suggested = Math.max(CsArea.DENSITY_FLOOR, suggested);
    return Math.round(suggested * 100) / 100;
};

// ---------------------------------------------------------------------
// Writing a boundary, and refusing to.
// ---------------------------------------------------------------------

/**
 * A genuinely CLOSED boundary spline through `verts`.
 *
 * PERIODIC, not "fit an open spline and flip a flag": CsTrace.fitSpline
 * builds its RSpline with setPeriodic(false) baked in (see that
 * function's own header) and hands back an RSplineEntity, which has no
 * setClosed at all -- there is nothing to flip after the fact, and
 * calling one that does not exist is exactly the bug the plan's first
 * draft of this file had. This builds the RSplineData directly and
 * marks it periodic BEFORE update(), the same idiom CsRevise.js uses
 * to rebuild a periodic spline in place (its RSplineEntity warp
 * branch) and the same one tests/area_fill_run.js's own
 * addSplineBoundary fixture already used, in Task 5, to build a closed
 * test boundary before this file existed.
 *
 * `verts` must already have any duplicate closing vertex removed
 * (commit() does this) -- a periodic spline closes the loop itself by
 * wrapping its LAST control point back to its FIRST, so a
 * caller-supplied duplicate at the seam would double up a control
 * point exactly where the curve closes, denting the loop right there.
 *
 * PROVING it closed, in a `-no-gui` run: CsArea.vertsOf samples a
 * spline through getExploded()'s line/arc segments, never through
 * getPointCloud() -- the one sampling path that needs no spline proxy
 * plugin and so is the only one this build can read headlessly at all
 * (see CsArea.vertsOf's own header). A test that samples this boundary
 * with CsArea.vertsOf and finds its first and last points a hair apart,
 * with a non-trivial CsArea.polygonArea in between, has verified a real
 * closed loop -- not a boundary that merely looks closed on screen
 * while scattering its fill through a gap nothing sampled caught.
 */
CsArea.closedBoundary = function(doc, verts) {
    // INTERPOLATING FIRST (2026-09-12). The approximating periodic fit
    // below pulls the boundary inside the points a caver traced, by a
    // fraction of the sampling step -- the same rounding that was
    // measured at 3.35 inches on a wall corner. CsTrace's cyclic solver
    // puts the curve THROUGH them instead, for the same control point
    // count and the same file size.
    //
    // The fallback stays because interpolation answers null for a loop
    // of fewer than four points or one with no spread, and a caver
    // mid-stroke must still get a boundary.
    var interp = CsTrace.periodicInterpolatingSpline(doc, verts);
    if (!isNull(interp)) {
        return interp;
    }
    var data = new RSplineData();
    for (var i = 0; i < verts.length; i++) {
        data.appendControlPoint(new RVector(verts[i].x, verts[i].y));
    }
    data.setDegree(CsTrace.degreeFor(verts.length));
    data.setPeriodic(true);
    data.update();
    return new RSplineEntity(doc, data);
};

/**
 * Why an add was refused, as a sentence naming the layer and its
 * state, or "" when neither layer refuses.
 *
 * Modelled on FeatureTraceRun.refusalReason, extended to a LIST of
 * layers because one area touches two (the fill and its boundary) and
 * either can be the one a caver locked. LOCKED is checked directly,
 * the same as FeatureTraceRun does, because CsLayers.refusesEdits
 * deliberately excludes it (a lock is something the surveyor did on
 * purpose, not a visibility state a writer may reveal for the length
 * of its own write -- see that function's own header); OFF and FROZEN
 * both go through CsLayers.refusesEdits so this file does not carry a
 * second copy of that reasoning.
 *
 * Reads every named layer back rather than stopping at the first
 * missing one: a locked fill layer and a perfectly fine boundary layer
 * is a real, nameable state, and the caver should hear about the one
 * that is actually wrong.
 */
CsArea.refusalReason = function(doc, layerNames) {
    for (var i = 0; i < layerNames.length; i++) {
        var name = layerNames[i];
        var lay = null;
        try {
            lay = doc.queryLayer(name);
        } catch (e) {
            lay = null;
        }
        if (isNull(lay)) {
            return qsTr("Nothing was drawn: layer %1 could not be found " +
                "or created.").arg(name);
        }
        var locked = false;
        try {
            locked = lay.isLocked();
        } catch (eLocked) {
        }
        if (locked) {
            return qsTr("Nothing was drawn: layer %1 is LOCKED. Unlock " +
                "it in the Layer List and trace again.").arg(name);
        }
        if (CsLayers.refusesEdits(lay)) {
            return qsTr("Nothing was drawn: layer %1 is FROZEN or turned " +
                "OFF. Fix that in the Layer List and trace again.")
                .arg(name);
        }
    }
    return "";
};

/**
 * Writes one area: its boundary, its tags, and its fill.
 *
 * The half of Area Fill's own commit that is not about a stroke. Split
 * out when the Therion sketch importer needed it: a scrap's area
 * arrives as a boundary somebody already drew, so none of the
 * stroke-shaped guards above it apply -- but everything here does,
 * down to which trip gets the credit.
 *
 * \param entry the CsArea.merged() row for `key`.
 * \param verts the boundary, in drawing coordinates.
 * \param opts {scale, density} and, optionally, {trip} to state the
 *        trip rather than have it derived from the nearest station.
 * \return {ok, id, layer, boundaryLayer, count, tripId, reason}
 */
CsArea.create = function(doc, di, entry, key, verts, opts) {
    var routed = CsArea.layersFor(doc, entry, verts);

    // ENSURE BEFORE READING BACK. A profile run's twin/variant layer
    // (PROFILE-SEDIMENT-SAND-GRAVEL-A) may not exist in this drawing
    // yet -- routing computes its NAME, not its presence -- and
    // doc.queryLayer of a name nobody has created yet answers null the
    // same way a genuinely missing layer would. Checking refusalReason
    // first would misreport every brand-new variant as "could not be
    // found", which is not a refusal at all. CsLayers.ensure is a
    // no-op when the layer already exists (doc.hasLayer's own guard),
    // so a layer a caver actually locked earlier is untouched and
    // still reads back locked below.
    CsLayers.ensure(doc, di, routed.fillLayer);
    CsLayers.ensure(doc, di, routed.boundaryLayer);

    var refusal = CsArea.refusalReason(doc,
        [routed.fillLayer, routed.boundaryLayer]);
    if (refusal !== "") {
        return { ok: false, id: null, count: 0, reason: refusal };
    }

    var id = CsUuid.v4();
    var seed = CsArea.newSeed();
    var op = new RAddObjectsOperation();

    var boundary = CsArea.closedBoundary(doc, verts);
    boundary.setLayerId(doc.getLayerId(routed.boundaryLayer));
    CsTags.set(boundary, CsArea.ID_KEY, id);
    CsTags.set(boundary, CsArea.PATTERN_KEY, key);
    CsTags.set(boundary, CsArea.SCALE_KEY, String(opts.scale));
    CsTags.set(boundary, CsArea.DENSITY_KEY, String(opts.density));
    CsTags.set(boundary, CsArea.SEED_KEY, String(seed));

    // WHICH TRIP DREW IT -- never a default of 0. See CsTrace.tripFor's
    // own header and the elevation datum family of bugs this suite has
    // closed five doors on: a trip id of 0 is not "no trip", it is trip
    // zero, and a boundary silently defaulted to it looks attributed
    // until someone asks which trip drew it.
    //
    // A CALLER MAY STATE IT. An imported scrap knows which trip
    // sketched it from the file it came in, which is better evidence
    // than the nearest station; a stroke does not, and derives it.
    var trip = (opts.trip !== undefined && opts.trip !== null &&
        opts.trip !== "") ? opts.trip :
        CsTrace.tripFor(doc, routed.frame, verts, routed.bays);
    if (!isNull(trip)) {
        CsTags.set(boundary, CsTrace.TRIP_TAG, trip);
    }
    op.addObject(boundary, false);

    var built = CsArea.build(doc, op, boundary, entry,
        { id: id, seed: seed, scale: opts.scale, density: opts.density,
          layer: routed.fillLayer }, di);
    // WHAT WE JUST WROTE (2026-09-12): a fresh stroke's own baseline,
    // so the very first regenerate can already tell a property-editor
    // edit apart from this stroke's own output instead of reading it
    // as drift on its first look. See CsArea.HATCH_SCALE_KEY's header.
    if (!isNull(built.scale)) {
        CsTags.set(boundary, CsArea.HATCH_SCALE_KEY, built.scale);
        CsTags.set(boundary, CsArea.HATCH_ANGLE_KEY, built.angle);
    }
    di.applyOperation(op);

    return { ok: built.ok, id: id, layer: routed.fillLayer,
        boundaryLayer: routed.boundaryLayer, count: built.count,
        tripId: trip, reason: built.reason };
};
