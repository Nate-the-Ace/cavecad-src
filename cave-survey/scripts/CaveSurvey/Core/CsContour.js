// CsContour.js -- elevation grids to contour polylines.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness can test all of it.
//
// Two halves:
//
//   parseFloatTiff  reads the 32-bit float GeoTIFF the USGS 3DEP
//                   elevation service returns (exportImage with
//                   format=tiff & pixelType=F32) into a row-major grid.
//                   The bytes arrive as a LATIN1 STRING -- one byte per
//                   character, charCodeAt() is the byte -- because that
//                   is the one binary path this script bridge has that
//                   is both faithful and fast (QTextStream with
//                   QStringConverter.Latin1 reads 200 KB in ~2 ms,
//                   probed 2026-08-27; QByteArray.at() works but costs
//                   a bridge call per byte, and toBase64()/toHex()
//                   stringify uselessly as "QByteArray [JS]").
//
//   lines           marching squares with linear interpolation over
//                   that grid at one level, stitched into polylines.
//                   Coordinates come back in GRID units -- (col, row),
//                   row 0 at the TOP, matching TIFF layout -- and the
//                   caller owns the transform into drawing coordinates.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

var CsContour = {};

// 3DEP hands back a huge negative float (or NaN) where it has no data.
// Earth's real surface spans about -430 m to 8849 m, so anything wildly
// below that is a hole, not a reading.
CsContour.isNoData = function(v) {
    return v === null || v === undefined || !isFinite(v) || v < -12000.0;
};

// ---------------------------------------------------------------------
// TIFF reading
// ---------------------------------------------------------------------

/**
 * IEEE-754 single from four bytes.
 * \param b array-like of byte values, \param o offset, \param le
 *        little-endian.
 */
CsContour.float32At = function(byteAt, o, le) {
    var b0, b1, b2, b3;
    if (le) {
        b0 = byteAt(o); b1 = byteAt(o + 1);
        b2 = byteAt(o + 2); b3 = byteAt(o + 3);
    } else {
        b3 = byteAt(o); b2 = byteAt(o + 1);
        b1 = byteAt(o + 2); b0 = byteAt(o + 3);
    }
    var bits = ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0;
    var sign = (bits >>> 31) === 1 ? -1 : 1;
    var exp = (bits >>> 23) & 0xff;
    var man = bits & 0x7fffff;
    if (exp === 0) {
        return man === 0 ? sign * 0 : sign * man * Math.pow(2, -149);
    }
    if (exp === 255) {
        return man !== 0 ? NaN : sign * Infinity;
    }
    return sign * (1 + man / 8388608) * Math.pow(2, exp - 127);
};

/**
 * The 3DEP float GeoTIFF as {width, height, values} -- values row-major,
 * row 0 the TOP (north) row, in the service's own metres (NAVD88).
 *
 * Handles both TILED layout (what the service actually sends, probed
 * 2026-08-27: one or more 128x128 float tiles, uncompressed,
 * little-endian) and STRIPPED layout (the classic form, in case the
 * service changes its writer). Anything it cannot faithfully read --
 * compression, a second sample, integer samples -- is a thrown Error
 * naming the reason, never a silently wrong grid.
 *
 * \param bytes the file as a latin1 string (charCodeAt(i) === byte i).
 */
CsContour.parseFloatTiff = function(bytes) {
    var byteAt = function(i) { return bytes.charCodeAt(i) & 0xff; };
    var n = bytes.length;
    if (n < 8) {
        throw new Error("not a TIFF: only " + n + " bytes");
    }
    var le;
    if (byteAt(0) === 0x49 && byteAt(1) === 0x49) {
        le = true;
    } else if (byteAt(0) === 0x4d && byteAt(1) === 0x4d) {
        le = false;
    } else {
        throw new Error("not a TIFF: bad byte-order mark");
    }
    var u16 = function(o) {
        return le ? (byteAt(o) | (byteAt(o + 1) << 8)) :
            ((byteAt(o) << 8) | byteAt(o + 1));
    };
    var u32 = function(o) {
        return le ?
            ((byteAt(o) | (byteAt(o + 1) << 8) | (byteAt(o + 2) << 16)) +
                byteAt(o + 3) * 16777216) :
            ((byteAt(o) * 16777216) + (byteAt(o + 1) << 16) +
                (byteAt(o + 2) << 8) + byteAt(o + 3));
    };
    if (u16(2) !== 42) {
        throw new Error("not a classic TIFF (magic " + u16(2) + ")");
    }

    var ifd = u32(4);
    if (ifd + 2 > n) {
        throw new Error("TIFF IFD offset outside the file");
    }
    var count = u16(ifd);
    var tags = {};
    for (var i = 0; i < count; i++) {
        var e = ifd + 2 + i * 12;
        var tag = u16(e);
        var typ = u16(e + 2);
        var cnt = u32(e + 4);
        tags[tag] = { type: typ, count: cnt, at: e + 8 };
    }

    // One scalar value of a tag: SHORT and LONG inline values live in
    // the first bytes of the value field (big-endian SHORTs in the HIGH
    // half of it).
    var scalar = function(t) {
        var rec = tags[t];
        if (rec === undefined) { return null; }
        if (rec.type === 3) {                       // SHORT
            return u16(rec.at);
        }
        return u32(rec.at);                         // LONG
    };
    // A tag's whole value array (SHORT or LONG), inline or offset.
    var values = function(t) {
        var rec = tags[t];
        if (rec === undefined) { return null; }
        var size = rec.type === 3 ? 2 : 4;
        var base = (rec.count * size <= 4) ? rec.at : u32(rec.at);
        var out = [];
        for (var k = 0; k < rec.count; k++) {
            out.push(rec.type === 3 ? u16(base + k * 2) :
                u32(base + k * 4));
        }
        return out;
    };

    var width = scalar(256), height = scalar(257);
    if (width === null || height === null || width < 1 || height < 1) {
        throw new Error("TIFF has no usable dimensions");
    }
    var compression = scalar(259);
    if (compression !== null && compression !== 1) {
        throw new Error("TIFF is compressed (compression " + compression +
            "); this reader only takes the service's uncompressed form");
    }
    var spp = scalar(277);
    if (spp !== null && spp !== 1) {
        throw new Error("TIFF has " + spp + " samples per pixel; " +
            "expected a single elevation band");
    }
    var bits = scalar(258);
    if (bits !== 32) {
        throw new Error("TIFF sample is " + bits + "-bit; expected 32");
    }
    var sampleFormat = scalar(339);
    if (sampleFormat !== 3) {
        throw new Error("TIFF sample format " + sampleFormat +
            " is not IEEE float");
    }

    var grid = [];
    var r, c;
    if (tags[322] !== undefined) {
        // tiled
        var tw = scalar(322), tl = scalar(323);
        var tileOffs = values(324);
        if (tw === null || tl === null || tileOffs === null) {
            throw new Error("TIFF tile layout is incomplete");
        }
        var across = Math.ceil(width / tw);
        for (r = 0; r < height; r++) {
            for (c = 0; c < width; c++) {
                var tile = Math.floor(r / tl) * across + Math.floor(c / tw);
                var off = tileOffs[tile] +
                    4 * ((r % tl) * tw + (c % tw));
                grid.push(CsContour.float32At(byteAt, off, le));
            }
        }
    } else if (tags[273] !== undefined) {
        // stripped
        var stripOffs = values(273);
        var rps = scalar(278);
        if (rps === null) { rps = height; }
        for (r = 0; r < height; r++) {
            var strip = Math.floor(r / rps);
            var so = stripOffs[strip] + 4 * ((r % rps) * width);
            for (c = 0; c < width; c++) {
                grid.push(CsContour.float32At(byteAt, so + 4 * c, le));
            }
        }
    } else {
        throw new Error("TIFF has neither tiles nor strips");
    }

    return { width: width, height: height, values: grid };
};

// ---------------------------------------------------------------------
// Contour extraction
// ---------------------------------------------------------------------

/**
 * The contour levels to draw: every multiple of `interval` strictly
 * inside (min, max). Values are in whatever unit min/max/interval
 * share.
 */
CsContour.levels = function(min, max, interval) {
    var out = [];
    if (!(interval > 0) || !isFinite(min) || !isFinite(max)) {
        return out;
    }
    var first = Math.ceil(min / interval) * interval;
    // walk by index, not by accumulation, so float drift can't skip or
    // duplicate a level
    var i0 = Math.round(first / interval);
    for (var k = i0; k * interval < max; k++) {
        var v = k * interval;
        if (v > min) {
            out.push(v);
        }
    }
    return out;
};

/**
 * Marching squares at one level.
 *
 * \param values row-major grid, row 0 at the top (TIFF order).
 * \param w,h    grid dimensions.
 * \param level  the threshold, same unit as the values.
 *
 * \return [{points: [{x, y}], closed: bool}] in GRID coordinates:
 *         x = column, y = row (top-down). A grid point sits at integer
 *         coordinates; crossings interpolate linearly between them.
 *         Cells touching a no-data value contribute nothing.
 */
CsContour.lines = function(values, w, h, level) {
    var segs = [];   // [x1, y1, x2, y2]

    var interp = function(a, b) {
        // parameter along the edge where the level crosses a -> b
        var d = b - a;
        if (d === 0) { return 0.5; }
        var t = (level - a) / d;
        if (t < 0) { t = 0; }
        if (t > 1) { t = 1; }
        return t;
    };

    for (var r = 0; r < h - 1; r++) {
        for (var c = 0; c < w - 1; c++) {
            var tl = values[r * w + c];
            var tr = values[r * w + c + 1];
            var br = values[(r + 1) * w + c + 1];
            var bl = values[(r + 1) * w + c];
            if (CsContour.isNoData(tl) || CsContour.isNoData(tr) ||
                    CsContour.isNoData(br) || CsContour.isNoData(bl)) {
                continue;
            }
            var idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) |
                (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
            if (idx === 0 || idx === 15) {
                continue;
            }
            // edge crossing points (grid coordinates)
            var top = { x: c + interp(tl, tr), y: r };
            var right = { x: c + 1, y: r + interp(tr, br) };
            var bottom = { x: c + interp(bl, br), y: r + 1 };
            var leftP = { x: c, y: r + interp(tl, bl) };
            var add = function(p, q) {
                segs.push([p.x, p.y, q.x, q.y]);
            };
            switch (idx) {
            case 1: add(leftP, bottom); break;
            case 2: add(bottom, right); break;
            case 3: add(leftP, right); break;
            case 4: add(top, right); break;
            case 6: add(top, bottom); break;
            case 7: add(leftP, top); break;
            case 8: add(top, leftP); break;
            case 9: add(top, bottom); break;
            case 11: add(top, right); break;
            case 12: add(right, leftP); break;
            case 13: add(right, bottom); break;
            case 14: add(bottom, leftP); break;
            case 5:
            case 10:
                // saddle: split by the cell centre's own side
                var center = (tl + tr + br + bl) / 4.0;
                var high = center >= level;
                if (idx === 5) {
                    // tl low, tr high, br low, bl high
                    if (high) { add(leftP, top); add(bottom, right); }
                    else { add(leftP, bottom); add(top, right); }
                } else {
                    // tl high, tr low, br high, bl low
                    if (high) { add(top, right); add(bottom, leftP); }
                    else { add(top, leftP); add(bottom, right); }
                }
                break;
            }
        }
    }

    return CsContour.stitch(segs);
};

/**
 * Chains loose segments into polylines by shared endpoints.
 * \return [{points, closed}] -- every input segment used exactly once.
 */
CsContour.stitch = function(segs) {
    var key = function(x, y) {
        return (Math.round(x * 4096) / 4096) + "," +
            (Math.round(y * 4096) / 4096);
    };
    // endpoint -> [segment index]
    var ends = {};
    var used = [];
    var i;
    var note = function(k, idx) {
        if (!ends.hasOwnProperty(k)) { ends[k] = []; }
        ends[k].push(idx);
    };
    for (i = 0; i < segs.length; i++) {
        used.push(false);
        note(key(segs[i][0], segs[i][1]), i);
        note(key(segs[i][2], segs[i][3]), i);
    }
    var takeFrom = function(k, notIdx) {
        var list = ends[k];
        if (list === undefined) { return -1; }
        for (var j = 0; j < list.length; j++) {
            if (!used[list[j]] && list[j] !== notIdx) {
                return list[j];
            }
        }
        return -1;
    };

    var out = [];
    for (i = 0; i < segs.length; i++) {
        if (used[i]) { continue; }
        used[i] = true;
        // grow a chain in both directions from segment i
        var pts = [
            { x: segs[i][0], y: segs[i][1] },
            { x: segs[i][2], y: segs[i][3] }
        ];
        var extend = function(fromEnd) {
            for (;;) {
                var tip = fromEnd ? pts[pts.length - 1] : pts[0];
                var next = takeFrom(key(tip.x, tip.y), -1);
                if (next === -1) { return; }
                used[next] = true;
                var s = segs[next];
                var p;
                if (key(s[0], s[1]) === key(tip.x, tip.y)) {
                    p = { x: s[2], y: s[3] };
                } else {
                    p = { x: s[0], y: s[1] };
                }
                if (fromEnd) { pts.push(p); } else { pts.unshift(p); }
            }
        };
        extend(true);
        extend(false);
        var closed = pts.length > 2 &&
            key(pts[0].x, pts[0].y) ===
            key(pts[pts.length - 1].x, pts[pts.length - 1].y);
        if (closed) {
            pts.pop();
        }
        out.push({ points: pts, closed: closed });
    }
    return out;
};

/**
 * Grid statistics over the usable values: {min, max, noData} or null
 * when nothing in the grid is usable.
 */
CsContour.range = function(values) {
    var min = null, max = null, holes = 0;
    for (var i = 0; i < values.length; i++) {
        var v = values[i];
        if (CsContour.isNoData(v)) {
            holes++;
            continue;
        }
        if (min === null || v < min) { min = v; }
        if (max === null || v > max) { max = v; }
    }
    return min === null ? null : { min: min, max: max, noData: holes };
};

/**
 * Elevation at a fractional grid coordinate, bilinear, or null when a
 * needed neighbour is missing or out of range. Used to report the
 * surface elevation at the anchor station.
 */
CsContour.sampleAt = function(values, w, h, x, y) {
    if (!(x >= 0) || !(y >= 0) || x > w - 1 || y > h - 1) {
        return null;
    }
    var c0 = Math.min(Math.floor(x), w - 2);
    var r0 = Math.min(Math.floor(y), h - 2);
    if (w < 2 || h < 2) {
        var only = values[0];
        return CsContour.isNoData(only) ? null : only;
    }
    var fx = x - c0, fy = y - r0;
    var tl = values[r0 * w + c0], tr = values[r0 * w + c0 + 1];
    var bl = values[(r0 + 1) * w + c0], br = values[(r0 + 1) * w + c0 + 1];
    if (CsContour.isNoData(tl) || CsContour.isNoData(tr) ||
            CsContour.isNoData(bl) || CsContour.isNoData(br)) {
        return null;
    }
    return tl * (1 - fx) * (1 - fy) + tr * fx * (1 - fy) +
        bl * (1 - fx) * fy + br * fx * fy;
};

// ============================================================
// The drawn side: where a fetched contour set LIVES in a drawing.
//
// Surface Data draws its contours into ONE block, inserted once, so a
// caver can select the whole surface with a single click instead of a
// window over a thousand polylines.
//
// THE BLOCK'S BASE POINT IS THE ENTRANCE STATION, and the reference is
// inserted at that same point, unscaled and unrotated. A reference
// draws its contents shifted by (insert - base), so setting the two
// equal shifts them by nothing: the geometry inside the block is still
// in DRAWING coordinates, and the grip a caver grabs to move the
// surface sits on the entrance rather than on a drawing origin that
// may be a mile away. Break that equality -- a different base point, a
// dragged insert, a scale, a rotation -- and CsLocationPick.
// lowPointNear and Cave3D.terrainContoursFromDrawing both start
// measuring against a frame the contours are no longer drawn in.
//
// The tags stay on the entities INSIDE the block (SurfaceContours=1,
// ContourElevation=<drawing units>), and the reference carries
// SurfaceContours=1 as well so the generated-underlay filters that
// walk model space still recognise it.
// ============================================================

/** The one block every fetched contour set is drawn into. */
CsContour.BLOCK = "CaveSurveyContours";

/** The contour block's id, or null when this drawing has none. */
CsContour.blockIdOf = function(doc) {
    var id;
    try {
        id = doc.getBlockId(CsContour.BLOCK);
    } catch (e) {
        return null;
    }
    if (id === undefined || id === null || id < 0) {
        return null;
    }
    if (typeof RBlock !== "undefined" && id === RBlock.INVALID_ID) {
        return null;
    }
    return id;
};

/**
 * Every entity a contour fetch drew: the contour block's contents,
 * plus anything in model space still tagged SurfaceContours=1 -- the
 * block reference itself, and the loose polylines older builds drew
 * before there was a block.
 *
 * Block-local coordinates are drawing coordinates here; see the note
 * above on why the insert is fixed at the origin.
 */
CsContour.drawnEntities = function(doc) {
    var out = [];
    var i, e;
    var ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (!isNull(e) && CsTags.get(e, "SurfaceContours") === "1") {
            out.push(e);
        }
    }
    var blockId = CsContour.blockIdOf(doc);
    if (blockId === null) {
        return out;
    }
    var bids = doc.queryBlockEntities(blockId);
    for (i = 0; i < bids.length; i++) {
        e = doc.queryEntity(bids[i]);
        if (!isNull(e)) {
            out.push(e);
        }
    }
    return out;
};
