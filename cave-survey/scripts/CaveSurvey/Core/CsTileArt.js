// CsTileArt.js -- drawing a panel tile's picture: a little of the cave
// map, rendered from the geometry the tool would actually produce.
//
// Part of the Cave Survey Core library. GUI context only (QPixmap,
// QPainter), but never an interactive ACTION's context -- panels call
// this, actions do not, and nothing here reaches for a simple.js global
// either way.
//
// WHY IT EXISTS. Two panels want the same thing: the Symbol Palette
// draws each symbol from its block, and Feature Trace draws each
// feature from the line it makes. Both had the same twenty lines of
// point-cloud-to-pixmap painting, and a second copy is a second place
// for a tile to quietly stop matching what it names. The rule for both
// is the same: A TILE IS A PICTURE OF WHAT YOU GET, generated from the
// same geometry, never hand-drawn beside it.
//
// Everything degrades to null rather than throwing: a bridge that
// refuses a painter costs a picture, never a panel.

var CsTileArt = {};

/** Margin inside a tile, in pixels, so strokes never touch the edge. */
CsTileArt.MARGIN = 3;

/** How finely a shape is sampled into points. Coarse on purpose: this
 *  is a 30px picture, and a curve is a handful of segments there. */
CsTileArt.STEP = 0.05;

/**
 * Point clouds for a list of RShape objects.
 *
 * getPointCloud is on RShape itself, so one path covers lines, arcs,
 * splines and polylines rather than four.
 *
 * \return [[{x, y}, ...], ...], empty when nothing could be sampled.
 */
CsTileArt.cloudsOfShapes = function(shapes) {
    var out = [];
    if (isNull(shapes)) {
        return out;
    }
    for (var i = 0; i < shapes.length; i++) {
        var pts = null;
        try {
            pts = shapes[i].getPointCloud(CsTileArt.STEP);
        } catch (eCloud) {
            pts = null;
        }
        if (isNull(pts) || pts.length < 2) {
            continue;
        }
        var cloud = [];
        for (var j = 0; j < pts.length; j++) {
            cloud.push({ x: pts[j].x, y: pts[j].y });
        }
        out.push(cloud);
    }
    return out;
};

/** Point clouds for a list of ENTITIES, by way of their shapes. */
CsTileArt.cloudsOfEntities = function(entities) {
    var out = [];
    if (isNull(entities)) {
        return out;
    }
    for (var i = 0; i < entities.length; i++) {
        var shapes = null;
        try {
            shapes = entities[i].getShapes();
        } catch (eShape) {
            shapes = null;
        }
        var clouds = CsTileArt.cloudsOfShapes(shapes);
        for (var c = 0; c < clouds.length; c++) {
            out.push(clouds[c]);
        }
    }
    return out;
};

/**
 * The bounding box of a set of clouds, or null when there is nothing
 * in them. Pure.
 */
CsTileArt.extentOf = function(clouds) {
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 0; i < clouds.length; i++) {
        for (var j = 0; j < clouds[i].length; j++) {
            var p = clouds[i][j];
            if (isNaN(p.x) || isNaN(p.y)) {
                continue;
            }
            if (minX === null || p.x < minX) { minX = p.x; }
            if (maxX === null || p.x > maxX) { maxX = p.x; }
            if (minY === null || p.y < minY) { minY = p.y; }
            if (maxY === null || p.y > maxY) { maxY = p.y; }
        }
    }
    if (minX === null) {
        return null;
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/**
 * The scale and centre that fit `extent` into a tile of `size`.
 *
 * A shape with one zero extent -- a single horizontal stroke -- would
 * divide by zero and paint nothing, so the larger side decides and a
 * flat one is simply not scaled.
 *
 * Pure, and the reason a tile of a 20 ft pit and a tile of a 6 in
 * stalactite are both legible.
 */
CsTileArt.fitOf = function(extent, size) {
    var span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
    var usable = size - 2 * CsTileArt.MARGIN;
    return {
        factor: (span <= 0) ? 1.0 : usable / span,
        cx: (extent.minX + extent.maxX) / 2,
        cy: (extent.minY + extent.maxY) / 2
    };
};

/**
 * The scale and centre that fit `extent` into a w x h strip -- the
 * wide picture on a Draw panel list button. Whichever side runs out
 * first decides; a zero extent on one side is left to the other.
 */
CsTileArt.fitRect = function(extent, w, h) {
    var ex = extent.maxX - extent.minX, ey = extent.maxY - extent.minY;
    var fx = ex > 0 ? (w - 2 * CsTileArt.MARGIN) / ex : Infinity;
    var fy = ey > 0 ? (h - 2 * CsTileArt.MARGIN) / ey : Infinity;
    var factor = Math.min(fx, fy);
    return {
        factor: isFinite(factor) ? factor : 1.0,
        cx: (extent.minX + extent.maxX) / 2,
        cy: (extent.minY + extent.maxY) / 2
    };
};

/**
 * Paints clouds into a QIcon: square `size`, or `size` wide by `height`
 * tall when a height is given (a list button's line strip).
 *
 * `pen` is optional: { color, width, dashed }. A dashed pen is how an
 * inferred wall reads as inferred in its own tile -- the tile carries
 * the layer's meaning, not just its shape.
 *
 * Y IS FLIPPED. Drawing space counts up and a pixmap counts down, and a
 * symbol drawn upside down is a different symbol: a stalactite becomes
 * a stalagmite, hachures point the wrong way.
 *
 * \return a QIcon, or null when this build's painter refuses.
 */
CsTileArt.iconOfClouds = function(clouds, size, pen, height) {
    if (isNull(clouds) || clouds.length === 0) {
        return null;
    }
    var extent = CsTileArt.extentOf(clouds);
    if (extent === null) {
        return null;
    }
    var W = size, H = isNull(height) ? size : height;
    var fit = isNull(height) ? CsTileArt.fitOf(extent, size) :
        CsTileArt.fitRect(extent, W, H);
    try {
        var pixmap = new QPixmap(W, H);
        pixmap.fill(new QColor(0, 0, 0, 0));
        var painter = new QPainter();
        painter.begin(pixmap);
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var qpen = new QPen(isNull(pen) || isNull(pen.color) ?
            new QColor(30, 30, 30) : pen.color);
        qpen.setWidth(isNull(pen) || isNull(pen.width) ? 1 : pen.width);
        if (!isNull(pen) && pen.dashed === true) {
            try {
                qpen.setStyle(Qt.DashLine);
            } catch (eDash) {
                // a solid tile for a dashed layer is a small loss
            }
        }
        painter.setPen(qpen);
        for (var i = 0; i < clouds.length; i++) {
            for (var j = 0; j < clouds[i].length - 1; j++) {
                var a = clouds[i][j], b = clouds[i][j + 1];
                painter.drawLine(
                    W / 2 + (a.x - fit.cx) * fit.factor,
                    H / 2 - (a.y - fit.cy) * fit.factor,
                    W / 2 + (b.x - fit.cx) * fit.factor,
                    H / 2 - (b.y - fit.cy) * fit.factor);
            }
        }
        painter.end();
        return new QIcon(pixmap);
    } catch (ePaint) {
        return null;
    }
};

/** An icon from RShape objects. */
CsTileArt.iconOfShapes = function(shapes, size, pen) {
    return CsTileArt.iconOfClouds(CsTileArt.cloudsOfShapes(shapes), size, pen);
};

/** An icon from entities. */
CsTileArt.iconOfEntities = function(entities, size, pen) {
    return CsTileArt.iconOfClouds(CsTileArt.cloudsOfEntities(entities),
        size, pen);
};

/**
 * The pen a REGISTRY LAYER draws its own tile with: the layer's colour,
 * and dashed when the layer's linetype is.
 *
 * The tile then says what the layer means as well as what it draws --
 * an inferred wall is dashed in the panel because it is dashed on the
 * map. Read through CsLayers.styleOf, which is the one place layer
 * appearance is resolved, so a tile cannot disagree with the map.
 */
CsTileArt.penForLayer = function(layerName) {
    var pen = { color: null, width: 1, dashed: false };
    try {
        var style = CsLayers.styleOf(layerName);
        pen.color = new QColor(String(style[0]));
        var linetype = String(style[1]).toUpperCase();
        pen.dashed = (linetype.indexOf("DASH") !== -1 ||
            linetype.indexOf("HIDDEN") !== -1 ||
            linetype.indexOf("DOT") !== -1);
    } catch (e) {
        pen.color = null;
    }
    return pen;
};

// ---------------------------------------------------------------------
// Area Fill previews (Task 10). A tile has to show what THAT pattern
// puts on the map -- a scatter of picture elements for one, a wash or
// ruled hatch for the other -- not a single hand-drawn stand-in for
// both. Everything below degrades to null exactly as the rest of this
// file does: a caller (AreaFill.tileFor) shows a named placeholder tile
// rather than no tile.
// ---------------------------------------------------------------------

/** Every block's shapes, read from the caver's library and the
 *  template and cached against the files' own modification stamp.
 *
 *  NOT SymbolPalette.loadShapes -- that filters to CsSymbolStore.PREFIX
 *  ("SYM_") blocks only, and half of what a scatter pattern places
 *  (AREA_PEBBLE, AREA_STIPPLE, AREA_DASH, AREA_CRYSTAL, AREA_BONE) is
 *  named outside that prefix on purpose (CsArea.CATALOG's own header:
 *  these are picture elements, not palette symbols). This reads every
 *  block name the file defines, unfiltered, so both families are found
 *  from the one open.
 *
 *  Cached because a Blocks/Debris/Pebbles/... panel of thirteen tiles,
 *  several of them scattering dozens of placements each, would
 *  otherwise reopen the full template DXF hundreds of times building
 *  one panel -- the exact cost SymbolPalette.loadShapes' own header
 *  warns against, multiplied by every placement instead of every tile.
 *
 *  KEYED BY MTIME+SIZE, not held for the process's whole life: a stale
 *  cache silently painting yesterday's geometry after a symbol editor
 *  rewrites one of these files is exactly the kind of landmine this
 *  suite has stepped on before (the elevation-datum family, the save
 *  hook that never fired). CaveShelf.mtimeOf's own idiom -- Qt's
 *  QDateTime.toString() ignores the format string this bridge passes
 *  it, so the text is whatever Qt's own default is: fine as an
 *  identity, useless as a parsed date, and the size catches an edit
 *  landing inside the same second. The cache is keyed on both files'
 *  stamps at once (customPath is checked first and so answers a
 *  duplicate block, which means the whole cache has to turn over the
 *  moment EITHER file changes, not just the one a caller happens to
 *  care about right now).
 */
CsTileArt._blockShapes = null;
CsTileArt._blockShapesKey = null;

/** The stamp CsTileArt.blockShapes() caches against -- both source
 *  files' mtime+size, joined. Missing/unreadable reads as "0", the
 *  same fallback CaveShelf.mtimeOf uses, so a file that comes and goes
 *  still changes the key rather than throwing. */
CsTileArt._blockShapesStamp = function() {
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    var parts = [];
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            parts.push("0");
            continue;
        }
        try {
            var info = new QFileInfo(places[p]);
            parts.push(info.exists() ?
                String(info.lastModified().toString()) + ":" + info.size() :
                "0");
        } catch (eStamp) {
            parts.push("0");
        }
    }
    return parts.join("|");
};

CsTileArt.blockShapes = function() {
    var stamp = CsTileArt._blockShapesStamp();
    if (CsTileArt._blockShapes !== null && CsTileArt._blockShapesKey === stamp) {
        return CsTileArt._blockShapes;
    }
    var out = {};
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[p]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var di = CsSymbolStore.openOffscreen(places[p]);
        if (di === null) {
            continue;
        }
        var doc = di.getDocument();
        var names = doc.getBlockNames();
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]);
            if (out.hasOwnProperty(name)) {
                continue;   // the library's copy already answered
            }
            var entities = CsSymbolStore.geometryOf(doc, name);
            var shapes = [];
            for (var j = 0; j < entities.length; j++) {
                try {
                    var got = entities[j].getShapes();
                    for (var k = 0; k < got.length; k++) {
                        shapes.push(got[k]);
                    }
                } catch (eShape) {
                }
            }
            out[name] = shapes;
        }
    }
    CsTileArt._blockShapes = out;
    CsTileArt._blockShapesKey = stamp;
    return out;
};

/** Forces the next CsTileArt.blockShapes() call to reopen the files,
 *  regardless of what their mtime+size stamp says.
 *
 *  The mtime+size stamp above is the PRIMARY mechanism -- a symbol
 *  editor rewriting one of these files already invalidates the cache
 *  on its own, with no caller having to remember to call this. This
 *  exists only as an explicit escape hatch (a test forcing a reread
 *  without waiting on a filesystem clock, or a future caller that
 *  knows something the stamp cannot see, such as a change to a file
 *  CsSymbolStore reads from a path this function does not check) --
 *  kept beside the cache it clears so that caller has an obvious place
 *  to look. */
CsTileArt.invalidateBlockShapes = function() {
    CsTileArt._blockShapes = null;
    CsTileArt._blockShapesKey = null;
};

/** A small closed square, `feet` across, centred on the origin -- the
 *  sample boundary a scatter preview rolls its dice against. Square and
 *  not the caver's real boundary shape: the tile is showing the
 *  PATTERN, not a boundary this pattern has never seen. */
CsTileArt.scatterSample = function(feet) {
    var half = feet / 2;
    return [
        { x: -half, y: -half }, { x: half, y: -half },
        { x: half, y: half }, { x: -half, y: half }
    ];
};

/** How big a sample square a scatter tile rolls its dice against, in
 *  drawing feet, and the fixed seed it rolls them with. FIXED, not
 *  CsArea.newSeed(): the tile is a picture of the PATTERN, not of any
 *  one caver's boundary, and a caver comparing "Blocks" against
 *  "Debris" tiles must see two different densities, never two random
 *  draws of a dice neither tile is actually armed with. */
CsTileArt.SCATTER_SAMPLE_FEET = 20;
CsTileArt.SCATTER_SEED = 424242;

/**
 * The tile for a SCATTER pattern: CsArea.placements run for real, over
 * the fixed sample square above, painted with each placed block's own
 * geometry at its rolled position, scale and angle.
 *
 * THE GENERATOR'S OWN OUTPUT, not a stand-in for it -- change the
 * density or the scale range in CsArea.CATALOG tomorrow and this tile
 * changes with it, the same promise FeatureTrace.iconForStyle makes for
 * a shaped line's ornament.
 */
CsTileArt.iconOfScatter = function(entry, size, pen) {
    var verts = CsTileArt.scatterSample(CsTileArt.SCATTER_SAMPLE_FEET);
    var places = CsArea.placements(verts, entry, CsTileArt.SCATTER_SEED,
        1.0, 1.0);
    if (places.length === 0) {
        return null;
    }
    var shapesByBlock = CsTileArt.blockShapes();
    var clouds = [];
    for (var i = 0; i < places.length; i++) {
        var shapes = shapesByBlock[places[i].block];
        if (isNull(shapes) || shapes.length === 0) {
            continue;   // this drawing has no such block -- skip it,
        }                // never let one missing block blank the tile
        var raw = CsTileArt.cloudsOfShapes(shapes);
        var cos = Math.cos(places[i].angle), sin = Math.sin(places[i].angle);
        for (var c = 0; c < raw.length; c++) {
            var cloud = [];
            for (var p = 0; p < raw[c].length; p++) {
                // Scale then rotate then translate -- the same order
                // RBlockReferenceData applies a block reference in, so
                // the tile's placement matches what CsArea.build would
                // actually draw for these same rolled numbers.
                var px = raw[c][p].x * places[i].scale;
                var py = raw[c][p].y * places[i].scale;
                cloud.push({
                    x: places[i].x + px * cos - py * sin,
                    y: places[i].y + px * sin + py * cos
                });
            }
            clouds.push(cloud);
        }
    }
    return CsTileArt.iconOfClouds(clouds, size, pen);
};

/**
 * The tile for a FILLED pattern: the pattern's own look, painted
 * directly rather than through a rendered RHatchEntity -- this bridge
 * has no offscreen render path for a hatch entity the way it does for
 * an RShape's point cloud, so the fill is drawn the way a caver would
 * describe it rather than the way QCAD's hatch renderer would.
 *
 *   SOLID (WATER)         a flat wash filling the frame.
 *   a named .pat pattern  a few ruled lines at the pattern's own angle
 *                         -- "hatched", not a literal ansi31/dots tile,
 *                         which is close enough at 30px and exactly as
 *                         far as CsArea.CATALOG's own patternAngle goes.
 *   null (BEDROCK)        an empty framed square: BEDROCK draws no fill
 *                         at all, only its boundary (CsArea.buildHatch's
 *                         own early return), and the tile says so by
 *                         drawing nothing but the edge.
 */
CsTileArt.iconOfFilled = function(entry, size, pen) {
    var pixmap = new QPixmap(size, size);
    pixmap.fill(new QColor(0, 0, 0, 0));
    var painter = new QPainter();
    painter.begin(pixmap);
    // THE WHOLE PAINT BODY IS ONE TRY. iconOfClouds wraps its own body
    // the same way and for the same reason: painter.begin() was already
    // called above, and if any draw call between here and end() throws,
    // an unmatched begin() leaves this QPainter open. The NEXT tile's
    // painter.begin() can then fail too on this bridge -- one bad
    // pattern would otherwise take out every tile painted after it in
    // the same panel build, not just its own.
    try {
        try {
            painter.setRenderHint(QPainter.Antialiasing, true);
        } catch (eHint) {
        }
        var color = (isNull(pen) || isNull(pen.color)) ?
            new QColor(30, 30, 30) : pen.color;
        var qpen = new QPen(color);
        qpen.setWidth((isNull(pen) || isNull(pen.width)) ? 1 : pen.width);
        painter.setPen(qpen);

        var m = CsTileArt.MARGIN;
        var inner = size - 2 * m;
        try {
            painter.setClipRect(m, m, inner, inner);
        } catch (eClip) {
            // an unclipped tile still frames correctly; only a hatch
            // pattern's lines might overrun the border by a hair
        }

        if (isNull(entry.pattern)) {
            painter.drawRect(m, m, inner, inner);
        } else if (entry.solid === true) {
            painter.fillRect(m, m, inner, inner, color);
            painter.drawRect(m, m, inner, inner);
        } else {
            painter.drawRect(m, m, inner, inner);
            var angle = isNull(entry.patternAngle) ? 0.0 : entry.patternAngle;
            var spacing = Math.max(3, Math.round(size / 7));
            var cos = Math.cos(angle), sin = Math.sin(angle);
            var cx = size / 2, cy = size / 2;
            var half = inner;   // generous: overrun is clipped above
            var count = Math.ceil((inner * 1.5) / spacing);
            for (var i = -count; i <= count; i++) {
                var offset = i * spacing;
                painter.drawLine(
                    cx - cos * half + sin * offset,
                    cy - sin * half - cos * offset,
                    cx + cos * half + sin * offset,
                    cy + sin * half - cos * offset);
            }
        }
    } catch (ePaint) {
        try {
            painter.end();
        } catch (eEnd) {
        }
        return null;
    }

    painter.end();
    return new QIcon(pixmap);
};

/**
 * A pattern's tile -- generated from the same geometry (or the same
 * painted look, for a filled pattern) the real fill uses.
 *
 * \return a QIcon, or null when the pattern's own placements/blocks
 *         could not be resolved or this build's painter refuses --
 *         either way the caller falls back to a named placeholder tile,
 *         never to a missing button.
 */
CsTileArt.iconOfFill = function(entry, size, pen) {
    if (isNull(entry)) {
        return null;
    }
    try {
        if (entry.engine === "scatter") {
            return CsTileArt.iconOfScatter(entry, size, pen);
        }
        return CsTileArt.iconOfFilled(entry, size, pen);
    } catch (e) {
        return null;
    }
};

/**
 * A gentle S-curve through a box `feet` across, as {x, y} points.
 *
 * THE SAMPLE STROKE every line tile is drawn from. A straight line
 * would hide exactly what a caver looks for -- which way hachures
 * point, how scallops sit on a bend -- and a real cave line is never
 * straight anyway.
 *
 * Pure.
 */
CsTileArt.sampleCurve = function(feet, steps, amplitude) {
    if (isNull(steps) || steps < 2) {
        steps = 24;
    }
    var out = [];
    var half = feet / 2;
    for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        out.push({
            x: -half + t * feet,
            y: Math.sin(t * Math.PI * 1.6) * (feet *
                (isNull(amplitude) ? 0.16 : amplitude))
        });
    }
    return out;
};

/** A closed ring `feet` across, for the tile of a closed feature (the
 *  pit). Pure. */
CsTileArt.sampleRing = function(feet, steps) {
    if (isNull(steps) || steps < 3) {
        steps = 20;
    }
    var out = [];
    var r = feet / 2;
    for (var i = 0; i < steps; i++) {
        var a = (i / steps) * Math.PI * 2;
        out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.72 });
    }
    return out;
};
