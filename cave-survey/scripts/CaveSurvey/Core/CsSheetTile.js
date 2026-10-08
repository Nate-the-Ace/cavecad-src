// CsSheetTile.js -- laying a cave out over SEVERAL sheets.
//
// Part of the Cave Survey Core library. Pure: numbers in, numbers out,
// no document, so tests/js_unit.js runs all of it under node.
//
// WHEN THIS APPLIES. Sheet Setup draws a cave on one sheet at a chosen
// plot scale. Pick a scale the cave overflows and the old answer was a
// warning, "off the paper". A cave map that does not fit is the normal
// case for a big cave at a legible scale, and the answer a cartographer
// gives is more sheets: a grid of them, each matched to its neighbours
// along a MATCH LINE, and each saying which sheet continues where.
//
// THE MODEL. One sheet is a VIEWPORT the cartographer places over the
// map, the way the single-sheet preview always worked: drag it, and it
// goes where it is put. The map area of a sheet is its paper minus the
// margin on every side and the footer band (title block, bar, north
// arrow) at the bottom. Wherever the cave runs out past a viewport's
// margin, the rest of it is carried by ADJACENT sheets of the same size,
// created the moment they are needed and dropped the moment they are
// not -- so sliding the viewport, or changing the scale, re-lays the
// neighbours as it goes:
//
//   CORE     the part of the map a sheet is RESPONSIBLE for. Cores butt
//            exactly, with no gap and no overlap, so every point of the
//            cave belongs to one sheet. A core's edge shared with a
//            neighbour is the MATCH LINE.
//   OVERLAP  each sheet also prints a strip, half the overlap wide, past
//            every edge of its core, so a passage that crosses a match
//            line reads continuously and two printed sheets can be
//            lined up by eye. The map area is core + overlap.
//
// A neighbour exists only if the cave has something in its core that the
// sheets already placed do not print -- a sliver of cave inside the
// overlap strip is printed by the sheet it is already on and does not
// call for another.
//
// NUMBERED BY GRID, rows lettered from the NORTH and columns numbered
// from the WEST: A1 is the north-west-most sheet, A2 is east of it, B1 is
// south of it. A cell the cave does not touch is NOT BUILT, but keeps its
// place in the numbering, so an L-shaped cave makes an L of sheets and
// "sheet B3" always sits where B3 says.
//
// DRAWING UNITS, like CsSheetSetup.borderBox: an inch of paper is
// `scale` drawing units, and every box here is in drawing units.

var CsSheetTile = {};

/** How far neighbouring tiles overlap, in inches of paper. */
CsSheetTile.OVERLAP_INCHES = 0.5;

/** Row 0 is "A"; row 26 is "AA". */
CsSheetTile.rowLetter = function(row) {
    var n = row;
    var out = "";
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
};

/** "B2": row letter, then 1-based column. */
CsSheetTile.idOf = function(row, col) {
    return CsSheetTile.rowLetter(row) + (col + 1);
};

/**
 * One axis of the grid.
 *
 * \param caveSize   the cave's extent along this axis
 * \param mapSize    one tile's whole map area along this axis
 * \param overlap    the overlap
 * \return {count, coreSize, expand, span} -- `expand` is how far a tile
 *         prints past each edge of its core (0 for a single tile), and
 *         `span` is the whole distance the grid covers.
 */
CsSheetTile.axis = function(caveSize, mapSize, overlap) {
    if (caveSize <= mapSize + 1e-9) {
        return { count: 1, coreSize: mapSize, expand: 0, span: mapSize };
    }
    var coreSize = mapSize - overlap;
    var count = Math.ceil((caveSize - overlap) / coreSize - 1e-9);
    if (count < 2) {
        count = 2;
    }
    return { count: count, coreSize: coreSize, expand: overlap / 2,
        span: count * coreSize + overlap };
};

/** Do two boxes {minX, minY, maxX, maxY} share any area or edge? */
CsSheetTile.meet = function(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
        a.minY <= b.maxY && a.maxY >= b.minY;
};

/** A box clipped to another, or null when they do not meet. */
CsSheetTile.clip = function(a, b) {
    var r = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX),
        minY: Math.max(a.minY, b.minY), maxY: Math.min(a.maxY, b.maxY) };
    return (r.minX <= r.maxX && r.minY <= r.maxY) ? r : null;
};

/** Is box `a` wholly inside box `b` (a hair of tolerance)? */
CsSheetTile.inside = function(a, b) {
    var e = 1e-7 * (1 + Math.abs(b.maxX - b.minX));
    return a.minX >= b.minX - e && a.maxX <= b.maxX + e &&
        a.minY >= b.minY - e && a.maxY <= b.maxY + e;
};

/**
 * Is box `part` wholly inside the UNION of the rectangles? Subtracts one
 * rectangle at a time and asks the same of what is left, so a piece that
 * straddles two sheets' maps is recognised as printed even though no
 * single one holds it.
 */
CsSheetTile.covered = function(part, rects, from) {
    var e = 1e-7 * (1 + Math.abs(part.maxX - part.minX) +
        Math.abs(part.maxY - part.minY));
    // ONLY THE RECTANGLES THAT TOUCH THE PART MATTER, and with a hundred
    // sheets that is a handful: asking the rest at every level of the
    // subtraction below multiplied the work until a 9 x 9 grid took
    // minutes and a 12 x 10 one never finished.
    if (from !== undefined && from > 0) {
        rects = rects.slice(from);
        from = 0;
    }
    var near = [];
    for (var n = 0; n < rects.length; n++) {
        if (CsSheetTile.clip(part, rects[n]) !== null) { near.push(rects[n]); }
    }
    rects = near;
    for (var i = 0; i < rects.length; i++) {
        var c = CsSheetTile.clip(part, rects[i]);
        if (c === null) { continue; }
        // what is left of `part` outside `c`, as up to four strips
        var rest = [];
        if (c.minX - part.minX > e) {
            rest.push({ minX: part.minX, maxX: c.minX, minY: part.minY, maxY: part.maxY });
        }
        if (part.maxX - c.maxX > e) {
            rest.push({ minX: c.maxX, maxX: part.maxX, minY: part.minY, maxY: part.maxY });
        }
        if (c.minY - part.minY > e) {
            rest.push({ minX: c.minX, maxX: c.maxX, minY: part.minY, maxY: c.minY });
        }
        if (part.maxY - c.maxY > e) {
            rest.push({ minX: c.minX, maxX: c.maxX, minY: c.maxY, maxY: part.maxY });
        }
        for (var r = 0; r < rest.length; r++) {
            if (!CsSheetTile.covered(rest[r], rects, i + 1)) { return false; }
        }
        return true;
    }
    return false;
};

/**
 * Lays the cave over sheets at one orientation.
 *
 * ONE SHEET CARRIES THE TITLE BLOCK -- the north-west one, A1 -- and the
 * rest only a scale bar and a north arrow. None of them reserves room
 * for its elements: every sheet is map right out to the page margin, and
 * the elements sit over it on a white backing (Nathan, 2026-10-05: if
 * the viewport overlaps another element that is fine). A caller that
 * wants a band kept clear under the map passes `footerInches`.
 *
 * \param o.caveBox        {minX, minY, maxX, maxY}
 * \param o.sheet          {w, h} in inches
 * \param o.scale          drawing units per inch of paper
 * \param o.turned         the paper is turned
 * \param o.footerInches   a band to keep clear under every sheet's map
 *                         (default none), or a function of `turned`
 * \param o.overlapInches  default CsSheetTile.OVERLAP_INCHES
 * \param o.occupied       [{minX, minY, maxX, maxY}] what the cave is
 *                         made of. Omit it and the cave's own box stands
 *                         in, which is exact for a cave that fills it.
 * \param o.shiftInches    {x, y} the viewport slid by hand, in inches
 *                         of paper. Zero is the default placement: the
 *                         viewport centred on the cave along an axis the
 *                         cave fits, and flush with its north-west edge
 *                         along one it does not.
 * \return {tiled, rows, cols, turned, tiles, matchLines, span, overlap,
 *          anchor}
 *         tiles: [{id, row, col, title, primary, core, map, paper,
 *         matches}] row-major; `title` marks the sheet that carries the
 *         title block; paper is the sheet's border box in the shape
 *         CsSheetSetup.borderBox answers; matches: [{edge, to, x1, y1,
 *         x2, y2}] one per neighbour that was built.
 */
/**
 * The most sheets one cave is ever laid over. A scale far too large for the
 * cave (1" = 5 ft on a cave 800 ft across) would otherwise ask for tens of
 * thousands of cells, and the layout, the preview and the build would each
 * spend minutes on them with the program unresponsive. Past this the layout
 * comes back `tooMany`, with how many it would have taken.
 */
CsSheetTile.MAX_SHEETS = 150;

/** What a layout that would need too many sheets looks like. */
CsSheetTile.tooMany = function(count, turned) {
    return { tiled: true, tooMany: true, count: count, rows: 0, cols: 0,
        turned: turned, tiles: [], matchLines: [], span: null, overlap: 0 };
};

CsSheetTile.layoutOne = function(o) {
    var scale = o.scale;
    var margin = CsSheetSetup.MARGIN_INCHES;
    var turned = o.turned === true;
    var footerGiven = (typeof o.footerInches === "function") ?
        o.footerInches(turned) : o.footerInches;
    var footer = (isNull(footerGiven) || !(footerGiven > 0)) ? 0 :
        footerGiven;
    var W = turned ? o.sheet.h : o.sheet.w;
    var H = turned ? o.sheet.w : o.sheet.h;
    var mapW = Math.max((W - margin * 2) * scale, 1e-6);
    var mapH = Math.max((H - margin * 2 - footer) * scale, 1e-6);
    var overlap = (isNull(o.overlapInches) ? CsSheetTile.OVERLAP_INCHES :
        o.overlapInches) * scale;
    overlap = Math.max(0, Math.min(overlap, Math.min(mapW, mapH) * 0.25));
    var coreW = mapW - overlap, coreH = mapH - overlap;
    var half = overlap / 2;

    var cave = o.caveBox;
    var caveW = cave.maxX - cave.minX, caveH = cave.maxY - cave.minY;
    var shift = isNull(o.shiftInches) ? { x: 0, y: 0 } : o.shiftInches;

    // THE VIEWPORT (cell 0,0). Where it sits before any hand drag: the
    // cave centred in it along an axis it fits, its north-west corner on
    // the cave's along one it does not -- which is the fewest sheets.
    var centreX = caveW <= mapW + 1e-9 ? (cave.minX + cave.maxX) / 2 :
        cave.minX + coreW / 2 + half;
    var centreY = caveH <= mapH + 1e-9 ? (cave.minY + cave.maxY) / 2 :
        cave.maxY - coreH / 2 - half;
    centreX += shift.x * scale;
    centreY += shift.y * scale;

    var coreOf = function(i, j) {
        return { minX: centreX - coreW / 2 + i * coreW,
            maxX: centreX + coreW / 2 + i * coreW,
            minY: centreY - coreH / 2 + j * coreH,
            maxY: centreY + coreH / 2 + j * coreH };
    };
    var mapOf = function(core) {
        return { minX: core.minX - half, maxX: core.maxX + half,
            minY: core.minY - half, maxY: core.maxY + half };
    };

    var occ = (isNull(o.occupied) || o.occupied.length === 0) ?
        [cave] : o.occupied;

    // WHICH CELLS THE CAVE REACHES, and for each the pieces of it that
    // reach there (clipped to the core).
    var cells = {};
    var origin = coreOf(0, 0);
    var k;
    for (k = 0; k < occ.length; k++) {
        var b = occ[k];
        var i0 = Math.floor((b.minX - origin.minX) / coreW);
        var i1 = Math.floor((b.maxX - origin.minX) / coreW);
        var j0 = Math.floor((b.minY - origin.minY) / coreH);
        var j1 = Math.floor((b.maxY - origin.minY) / coreH);
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) {
            continue;   // a piece larger than any sensible grid
        }
        for (var ci = i0; ci <= i1; ci++) {
            for (var cj = j0; cj <= j1; cj++) {
                var key = ci + "," + cj;
                if (!cells.hasOwnProperty(key)) {
                    cells[key] = { i: ci, j: cj, pieces: [] };
                }
                var part = CsSheetTile.clip(b, coreOf(ci, cj));
                if (part !== null) {
                    cells[key].pieces.push(part);
                }
            }
        }
    }
    var cellCount = 0;
    for (var cc in cells) {
        if (cells.hasOwnProperty(cc)) { cellCount++; }
    }
    // cells reached overcount sheets (overlap, pruning), so allow headroom
    // before giving up, and never start the quadratic pruning below on more
    if (cellCount > CsSheetTile.MAX_SHEETS * 6) {
        return CsSheetTile.tooMany(cellCount, turned);
    }
    var order = [];
    for (var ck in cells) {
        if (cells.hasOwnProperty(ck)) { order.push(cells[ck]); }
    }
    order.sort(function(a, c) {
        var da = Math.abs(a.i) + Math.abs(a.j), dc = Math.abs(c.i) + Math.abs(c.j);
        return da !== dc ? da - dc : (a.j !== c.j ? c.j - a.j : a.i - c.i);
    });

    // KEEP A CELL IF ITS CORE HOLDS CAVE THAT THE SHEETS ALREADY KEPT DO
    // NOT PRINT between them. Nearest the viewport first, so the viewport
    // carries what it can and neighbours carry only the remainder; then
    // any sheet whose cave the others turn out to print is let go.
    var kept = [];
    var maps = function(skip) {
        var out = [];
        for (var q = 0; q < kept.length; q++) {
            if (q !== skip) { out.push(kept[q].map); }
        }
        return out;
    };
    for (var oi = 0; oi < order.length && kept.length <= CsSheetTile.MAX_SHEETS; oi++) {
        var cell = order[oi];
        var needed = false;
        for (var pi = 0; pi < cell.pieces.length && !needed; pi++) {
            needed = !CsSheetTile.covered(cell.pieces[pi], maps(-1));
        }
        if (needed) {
            var core = coreOf(cell.i, cell.j);
            kept.push({ i: cell.i, j: cell.j, core: core, map: mapOf(core),
                pieces: cell.pieces });
        }
    }
    for (var back = kept.length - 1; back >= 0 && kept.length > 1; back--) {
        var rest = maps(back);
        var allCovered = true;
        for (var bp = 0; bp < kept[back].pieces.length && allCovered; bp++) {
            allCovered = CsSheetTile.covered(kept[back].pieces[bp], rest);
        }
        if (allCovered) { kept.splice(back, 1); }
    }
    if (kept.length > CsSheetTile.MAX_SHEETS) {
        return CsSheetTile.tooMany(kept.length, turned);
    }
    if (kept.length === 0) {
        // never an empty set of sheets: the viewport itself
        var c0 = coreOf(0, 0);
        kept.push({ i: 0, j: 0, core: c0, map: mapOf(c0), pieces: [] });
    }

    // NUMBERED BY GRID: rows from the north, columns from the west
    var minI = Infinity, maxJ = -Infinity;
    for (k = 0; k < kept.length; k++) {
        minI = Math.min(minI, kept[k].i);
        maxJ = Math.max(maxJ, kept[k].j);
    }
    var rows = 0, cols = 0;
    for (k = 0; k < kept.length; k++) {
        kept[k].row = maxJ - kept[k].j;
        kept[k].col = kept[k].i - minI;
        kept[k].id = CsSheetTile.idOf(kept[k].row, kept[k].col);
        rows = Math.max(rows, kept[k].row + 1);
        cols = Math.max(cols, kept[k].col + 1);
    }
    kept.sort(function(a, c) {
        return a.row !== c.row ? a.row - c.row : a.col - c.col;
    });
    // THE VIEWPORT'S OWN SHEET is the one the cartographer placed, cell
    // (0, 0); the sheet that CARRIES THE TITLE BLOCK is the first in
    // reading order -- A1, or the first one built when the north-west
    // corner of the grid is empty.
    var hasPrimary = false;
    for (k = 0; k < kept.length; k++) {
        kept[k].primary = (kept[k].i === 0 && kept[k].j === 0);
        hasPrimary = hasPrimary || kept[k].primary;
        kept[k].title = (k === 0);
    }
    if (!hasPrimary) {
        kept[0].primary = true;
    }

    var matchLines = [];
    var mPx = margin * scale, fPx = footer * scale;
    for (k = 0; k < kept.length; k++) {
        var t = kept[k];
        t.paper = {
            minX: t.map.minX - mPx, maxX: t.map.maxX + mPx,
            minY: t.map.minY - mPx - fPx, maxY: t.map.maxY + mPx,
            width: (t.map.maxX - t.map.minX) + mPx * 2,
            height: (t.map.maxY - t.map.minY) + mPx * 2 + fPx,
            footer: fPx, margin: mPx
        };
        t.matches = [];
    }
    // match lines, by what actually faces what
    var byCell = {};
    for (k = 0; k < kept.length; k++) {
        byCell[kept[k].i + "," + kept[k].j] = kept[k];
    }
    for (k = 0; k < kept.length; k++) {
        var a = kept[k];
        var east = byCell[(a.i + 1) + "," + a.j];
        var south = byCell[a.i + "," + (a.j - 1)];
        if (east !== undefined) {
            a.matches.push({ edge: "E", to: east.id, x1: a.core.maxX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.maxY });
            east.matches.push({ edge: "W", to: a.id, x1: a.core.maxX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.maxY });
            matchLines.push({ a: a.id, b: east.id, x1: a.core.maxX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.maxY });
        }
        if (south !== undefined) {
            a.matches.push({ edge: "S", to: south.id, x1: a.core.minX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.minY });
            south.matches.push({ edge: "N", to: a.id, x1: a.core.minX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.minY });
            matchLines.push({ a: a.id, b: south.id, x1: a.core.minX,
                y1: a.core.minY, x2: a.core.maxX, y2: a.core.minY });
        }
    }

    var span = { minX: Infinity, minY: Infinity, maxX: -Infinity,
        maxY: -Infinity };
    for (k = 0; k < kept.length; k++) {
        span.minX = Math.min(span.minX, kept[k].paper.minX);
        span.minY = Math.min(span.minY, kept[k].paper.minY);
        span.maxX = Math.max(span.maxX, kept[k].paper.maxX);
        span.maxY = Math.max(span.maxY, kept[k].paper.maxY);
    }
    // THE VIEWPORT'S OWN CELL (0, 0), whether or not any cave is in it. The
    // preview draws THIS as the paper, not the first sheet that happens to
    // be kept: when a drag moves the cave off cell (0, 0) the first kept sheet
    // becomes another one, and a paper chosen by that jumps a whole sheet.
    var originCore = coreOf(0, 0), originMap = mapOf(originCore);
    var origin = { core: originCore, map: originMap, paper: {
        minX: originMap.minX - mPx, maxX: originMap.maxX + mPx,
        minY: originMap.minY - mPx - fPx, maxY: originMap.maxY + mPx,
        width: (originMap.maxX - originMap.minX) + mPx * 2,
        height: (originMap.maxY - originMap.minY) + mPx * 2 + fPx,
        footer: fPx, margin: mPx } };
    return { tiled: kept.length > 1, rows: rows, cols: cols, origin: origin,
        turned: turned, tiles: kept, matchLines: matchLines, span: span,
        overlap: overlap, anchor: { x: centreX, y: centreY } };
};

/**
 * The layout at whichever paper orientation needs fewer sheets (not
 * turned on a tie). Pass turned: true or false to force one.
 */
CsSheetTile.layout = function(o) {
    if (o.turned === true || o.turned === false) {
        return CsSheetTile.layoutOne(o);
    }
    var copy = function(turned) {
        var c = {};
        for (var k in o) {
            if (o.hasOwnProperty(k)) { c[k] = o[k]; }
        }
        c.turned = turned;
        return c;
    };
    var plain = CsSheetTile.layoutOne(copy(false));
    var turned = CsSheetTile.layoutOne(copy(true));
    var size = function(l) { return l.tooMany === true ? 1e9 : l.tiles.length; };
    return size(turned) < size(plain) ? turned : plain;
};

/** The words printed on a sheet along the edge it shares. */
CsSheetTile.matchText = function(toId) {
    return "MATCH LINE - SEE SHEET " + toId;
};

/** A one-line description for the panel: "3 x 2 sheets (A1 to B3, 5 built)". */
CsSheetTile.describe = function(layout) {
    if (isNull(layout) || layout.tiled !== true) {
        return "";
    }
    if (layout.tooMany === true) {
        return "more than " + CsSheetTile.MAX_SHEETS + " sheets";
    }
    var first = layout.tiles[0].id;
    var last = layout.tiles[layout.tiles.length - 1].id;
    return layout.cols + " x " + layout.rows + " grid, " +
        layout.tiles.length + " sheet" +
        (layout.tiles.length === 1 ? "" : "s") + " (" + first + " to " +
        last + ")";
};
