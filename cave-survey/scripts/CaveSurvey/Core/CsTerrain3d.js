// CsTerrain3d.js -- a 3DEP elevation grid as a renderable surface.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness exercises all of it.
//
// Turns the grid CsContour.parseFloatTiff produces into the buffers
// RCave3dView draws: an indexed triangle mesh with smooth normals and
// texture coordinates, plus the surface contour lines as 3D polylines.
// The aerial photograph is draped over that mesh by the view; this
// file only says where each vertex sits and which pixel of the photo
// belongs to it.
//
// WHY THE UVS NEED NO FITTING. CsSurfaceData requests the photograph
// and the elevation grid from ONE shared Mercator bbox, computed once
// per run. A vertex's fractional position in the grid is therefore its
// fractional position in the photograph, exactly. Any code here that
// tries to fit, offset or scale the image against the terrain is
// fixing a bug that lives somewhere else.
//
// WHY INDEXED, UNLIKE CsMesh3d. A passage mesh shares no vertices --
// flat normals need one vertex per triangle corner -- so CsMesh3d
// emits unshared vertices and the view draws with glDrawArrays. A
// terrain grid is the opposite: every interior vertex belongs to six
// triangles and carries one smooth normal. Sharing them is a six-fold
// saving on a buffer that crosses the QVariantList bridge, which is
// the expensive part of this, not the drawing.
//
// THE VERTICAL FRAME IS THE SURVEY'S, NOT NAVD88. Elevations arrive
// from 3DEP as metres above the NAVD88 datum; the cave sits on
// whatever datum its survey ran on. Rather than move the cave, this
// converts the TERRAIN into the survey's frame by subtracting
// CsElevation.datumOffset -- so the cave's own coordinates, its depth
// colouring and its station labels all keep meaning exactly what they
// meant before a surface existed, and the surface arrives above them
// in the right place. With no offset known (no GeoElev) the terrain is
// placed raw and the caller must say so: a surface silently in the
// wrong place is worse than no surface.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

var CsTerrain3d = {};

/**
 * The most grid cells kept per axis. 3DEP is capped at 512 px by
 * CsGeoProject.DEM_MAX_PX, which is 262k vertices and 1.5M indices --
 * nothing to a GPU, a long wait through a QVariantList of boxed
 * doubles. 200 is about 1 m of relief detail across a 200 m window and
 * is indistinguishable from the full grid once a photograph is over
 * it.
 */
CsTerrain3d.TARGET_CELLS = 200;

/**
 * How many source samples to step per output vertex, so that no axis
 * keeps more than `target` of them. Always at least 1; never
 * fractional, because a fractional stride would resample the grid and
 * this deliberately does not -- every terrain vertex is a real 3DEP
 * reading, not an average of several.
 */
CsTerrain3d.stride = function(n, target) {
    if (target === undefined || target === null || !(target > 0)) {
        target = CsTerrain3d.TARGET_CELLS;
    }
    if (!(n > target)) {
        return 1;
    }
    return Math.ceil(n / target);
};

/**
 * The columns (or rows) kept at a given stride: always includes the
 * first and the LAST, so a decimated mesh covers the same ground as
 * the grid it came from rather than stopping short of one edge.
 */
CsTerrain3d.samples = function(n, stride) {
    var out = [];
    for (var i = 0; i < n; i += stride) {
        out.push(i);
    }
    if (out.length > 0 && out[out.length - 1] !== n - 1) {
        out.push(n - 1);
    }
    return out;
};

/**
 * The elevation grid as a renderable surface.
 *
 * \param grid      {values, width, height} from CsContour.parseFloatTiff
 * \param transform CsGeoProject.gridTransform(...) -- (col, row) to
 *                  {x, y} in drawing units
 * \param opts      {unit:      CsUnits.FEET / CsUnits.METERS,
 *                   offset:    CsElevation.datumOffset(...), or null
 *                              for "datum unknown, place raw",
 *                   target:    cells per axis (default TARGET_CELLS)}
 *
 * \return {positions, normals, uvs, indices,
 *          bounds: {min:{x,y,z}, max:{x,y,z}} or null,
 *          cells: {width, height}, holes: n, stride: n}
 *
 *         positions/normals/uvs are flat arrays, 3/3/2 numbers per
 *         vertex; indices are triangle corners into them. bounds is
 *         null when nothing could be drawn.
 */
CsTerrain3d.mesh = function(grid, transform, opts) {
    var o = opts || {};
    var unit = o.unit || CsUnits.FEET;
    var offset = (o.offset === undefined || o.offset === null) ? 0.0 :
        o.offset;

    var sx = CsTerrain3d.stride(grid.width, o.target);
    var sy = CsTerrain3d.stride(grid.height, o.target);
    var cols = CsTerrain3d.samples(grid.width, sx);
    var rows = CsTerrain3d.samples(grid.height, sy);

    var out = {
        positions: [], normals: [], uvs: [], indices: [],
        bounds: null,
        cells: { width: cols.length, height: rows.length },
        holes: 0,
        stride: Math.max(sx, sy)
    };
    if (cols.length < 2 || rows.length < 2) {
        return out;                  // nothing to triangulate
    }

    // A no-data vertex is never indexed, but it still occupies a slot
    // in the buffer, and that slot must hold a plausible number: 3DEP
    // writes about -3.4e38 where it has nothing, and one such value
    // reaching a bounding box makes the whole view unusable. The
    // lowest real reading in this grid is the honest filler.
    var range = CsContour.range(grid.values);
    var floorZ = (range === null) ? 0.0 :
        CsUnits.convert(range.min, CsUnits.METERS, unit) - offset;

    var at = function(col, row) {
        return grid.values[row * grid.width + col];
    };
    var zAt = function(col, row) {
        var v = at(col, row);
        if (CsContour.isNoData(v)) {
            return null;
        }
        return CsUnits.convert(v, CsUnits.METERS, unit) - offset;
    };

    // The grid is regular in drawing coordinates -- gridTransform is
    // affine -- so one sample of the spacing serves the whole surface,
    // and a normal is a central difference over it.
    var p00 = transform(0, 0);
    var p10 = transform(1, 0);
    var p01 = transform(0, 1);
    var dx = (p10.x - p00.x) || 1.0;       // drawing units per column
    var dy = (p01.y - p00.y) || 1.0;       // per row; negative, y is up

    var ci, ri, col, row, z;

    // ---- vertices ----------------------------------------------------
    for (ri = 0; ri < rows.length; ri++) {
        row = rows[ri];
        for (ci = 0; ci < cols.length; ci++) {
            col = cols[ci];
            var p = transform(col, row);
            z = zAt(col, row);
            if (z === null) {
                out.holes++;
                z = floorZ;
            }
            out.positions.push(p.x, p.y, z);

            // uv: the vertex's fractional place in the grid, which is
            // its fractional place in the photograph. Row 0 is the
            // TOP of both the TIFF and the PNG, and v runs down from
            // 0 -- the convention the draped sketches already use.
            out.uvs.push((col + 0.5) / grid.width,
                         (row + 0.5) / grid.height);

            // Central difference, falling back to a one-sided one at
            // the edges and to straight up where a neighbour is a
            // hole. A slope computed against a hole is not a slope.
            var zl = zAt(Math.max(col - sx, 0), row);
            var zr = zAt(Math.min(col + sx, grid.width - 1), row);
            var zu = zAt(col, Math.max(row - sy, 0));
            var zd = zAt(col, Math.min(row + sy, grid.height - 1));
            var gx = (zl === null || zr === null) ? 0.0 :
                (zr - zl) / (2.0 * sx * dx);
            var gy = (zu === null || zd === null) ? 0.0 :
                (zd - zu) / (2.0 * sy * dy);
            var nx = -gx, ny = -gy, nz = 1.0;
            var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            out.normals.push(nx / len, ny / len, nz / len);
        }
    }

    // ---- triangles ---------------------------------------------------
    var w = cols.length;
    var minX = null, minY = null, minZ = null;
    var maxX = null, maxY = null, maxZ = null;
    var note = function(idx) {
        var x = out.positions[idx * 3];
        var y = out.positions[idx * 3 + 1];
        var zz = out.positions[idx * 3 + 2];
        if (minX === null) {
            minX = maxX = x; minY = maxY = y; minZ = maxZ = zz;
            return;
        }
        if (x < minX) { minX = x; } else if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; } else if (y > maxY) { maxY = y; }
        if (zz < minZ) { minZ = zz; } else if (zz > maxZ) { maxZ = zz; }
    };

    for (ri = 0; ri + 1 < rows.length; ri++) {
        for (ci = 0; ci + 1 < cols.length; ci++) {
            // A cell with any no-data corner is DROPPED, never clamped:
            // a clamped corner is a cliff to the bottom of the world
            // that looks like terrain.
            if (CsContour.isNoData(at(cols[ci], rows[ri])) ||
                CsContour.isNoData(at(cols[ci + 1], rows[ri])) ||
                CsContour.isNoData(at(cols[ci], rows[ri + 1])) ||
                CsContour.isNoData(at(cols[ci + 1], rows[ri + 1]))) {
                continue;
            }
            var tl = ri * w + ci;
            var tr = tl + 1;
            var bl = (ri + 1) * w + ci;
            var br = bl + 1;
            // Row 0 is the top, so row+1 is SOUTH: counter-clockwise
            // seen from above is tl, bl, br.
            out.indices.push(tl, bl, br, tl, br, tr);
            note(tl); note(tr); note(bl); note(br);
        }
    }

    if (minX !== null) {
        out.bounds = {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ }
        };
    }
    return out;
};

/**
 * The surface contour lines, as 3D line segments sitting ON the mesh.
 *
 * Each level's polylines come from CsContour.lines -- the same
 * marching squares the plan drawing's contours use -- and every vertex
 * of a level is lifted to THAT LEVEL's own elevation. The lines are
 * therefore on the surface by construction: there is no draping pass,
 * no sampling, and no disagreement to reconcile between a line and the
 * mesh under it.
 *
 * Emitted as GL_LINES pairs (two vertices per segment) rather than
 * strips, because the view draws every overlay that way and a strip
 * would need a second draw call per polyline.
 *
 * \param grid      as mesh()
 * \param transform as mesh()
 * \param levelsM   elevations in METRES (what the grid holds)
 * \param opts      {unit, offset} as mesh(), plus
 *                  {major: {r,g,b}, minor: {r,g,b}, majorEvery: n}
 *
 * \return {positions, colors} -- flat, 3 numbers per vertex each
 */
CsTerrain3d.contourLines = function(grid, transform, levelsM, opts) {
    var o = opts || {};
    var unit = o.unit || CsUnits.FEET;
    var offset = (o.offset === undefined || o.offset === null) ? 0.0 :
        o.offset;
    var major = o.major || { r: 0.85, g: 0.72, b: 0.45 };
    var minor = o.minor || { r: 0.62, g: 0.53, b: 0.36 };
    var majorEvery = o.majorEvery || 5;

    var out = { positions: [], colors: [] };
    if (levelsM === null || levelsM === undefined) {
        return out;
    }

    for (var li = 0; li < levelsM.length; li++) {
        var levelM = levelsM[li];
        var z = CsUnits.convert(levelM, CsUnits.METERS, unit) - offset;
        var c = (li % majorEvery === 0) ? major : minor;
        var runs = CsContour.lines(grid.values, grid.width, grid.height,
            levelM);
        for (var ri = 0; ri < runs.length; ri++) {
            var pts = runs[ri].points;
            if (pts.length < 2) {
                continue;
            }
            // Thinned for the same reason the drawing's own contours
            // are: a grid-traced line has a vertex per cell, and every
            // one costs six boxed doubles across the bridge.
            pts = CsTerrain3d.thinPolyline(pts,
                (o.thinTolerance === undefined || o.thinTolerance === null)
                    ? 0 : o.thinTolerance);
            if (pts.length < 2) {
                continue;
            }
            var n = runs[ri].closed ? pts.length : pts.length - 1;
            for (var k = 0; k < n; k++) {
                var a = transform(pts[k].x, pts[k].y);
                var b = transform(pts[(k + 1) % pts.length].x,
                    pts[(k + 1) % pts.length].y);
                out.positions.push(a.x, a.y, z, b.x, b.y, z);
                out.colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
            }
        }
    }
    return out;
};

/**
 * Both halves, plus the numbers the panel's status line reports.
 *
 * \param opts as mesh(), plus {intervalM: contour spacing in metres,
 *             texture: path to the aerial PNG or "", contours: bool}
 *
 * \return {positions, normals, uvs, indices, texture, bounds,
 *          lines: {positions, colors}, holes, stride, levels: n}
 *         -- exactly the `terrain` block RCave3dBridge.setMesh takes.
 */
CsTerrain3d.build = function(grid, transform, opts) {
    var o = opts || {};
    var m = CsTerrain3d.mesh(grid, transform, o);
    var lines = { positions: [], colors: [] };
    var levels = [];

    if (o.contours !== false && o.intervalM > 0) {
        var range = CsContour.range(grid.values);
        if (range !== null) {
            levels = CsContour.levels(range.min, range.max, o.intervalM);
            // A HARD CEILING ON MARCHING. See MAX_GENERATED_LEVELS: the
            // cost is linear in levels and measured in whole seconds
            // per handful, so an interval fine enough to be interesting
            // is an interval fine enough to hang the panel. Widening
            // the interval is the honest way to stay under it -- the
            // lines stay where the ground is, there are just fewer.
            if (levels.length > CsTerrain3d.MAX_GENERATED_LEVELS) {
                var coarse = CsTerrain3d.niceInterval(
                    range.max - range.min,
                    CsTerrain3d.MAX_GENERATED_LEVELS);
                levels = CsContour.levels(range.min, range.max, coarse);
                // niceInterval AIMS at a count; it does not promise
                // one, because it rounds to a 1/2/5 step -- 29 levels
                // came back from a request for 24. The ceiling is a
                // ceiling, so keep doubling until it really is under
                // it. Doubling a 1/2/5 step gives another 1/2/5 step,
                // so the interval stays a number a map would use.
                while (levels.length > CsTerrain3d.MAX_GENERATED_LEVELS &&
                        coarse < (range.max - range.min)) {
                    coarse *= 2;
                    levels = CsContour.levels(range.min, range.max,
                        coarse);
                }
            }
            lines = CsTerrain3d.contourLines(grid, transform, levels, o);
        }
    }

    return {
        positions: m.positions,
        normals: m.normals,
        uvs: m.uvs,
        indices: m.indices,
        texture: o.texture || "",
        bounds: m.bounds,
        lines: lines,
        holes: m.holes,
        stride: m.stride,
        cells: m.cells,
        levels: levels.length
    };
};

/**
 * A contour interval for a given span of ground, in the SAME unit the
 * span is given in.
 *
 * The plan drawing's contours are drawn at an interval the caver
 * chooses and Surface Data asks for. The 3D view asks nobody: it is a
 * view, opened from a button, and a dialog in front of it would be one
 * question too many for a decoration. So it picks a 1/2/5 x 10^n step
 * that puts roughly `target` lines across the relief -- the same family
 * of steps a contour map uses, so the answer is never a surprising
 * number like 37.
 */
CsTerrain3d.niceInterval = function(span, target) {
    if (!(span > 0)) {
        return 0;
    }
    if (!(target > 0)) {
        target = 12;
    }
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step;
    if (norm <= 1.5) {
        step = 1;
    } else if (norm <= 3.5) {
        step = 2;
    } else if (norm <= 7.5) {
        step = 5;
    } else {
        step = 10;
    }
    return step * mag;
};

/**
 * The most levels the generated fallback will ever march.
 *
 * MEASURED, NOT GUESSED: one level of marching squares over a 428x236
 * 3DEP grid costs ~237 ms in this engine, so a foot interval over 130
 * ft of relief is THIRTY-ONE SECONDS of frozen panel -- which is what
 * "the detailed one doesn't render" turned out to be. The fallback
 * exists only for a drawing with no contours of its own; when the
 * drawing HAS them they are lifted instead, at whatever interval they
 * were drawn at, for no marching at all.
 */
CsTerrain3d.MAX_GENERATED_LEVELS = 24;

/**
 * Drops vertices that say nothing: a point closer than `tol` to the
 * line between the one kept before it and the one after is carrying no
 * shape.
 *
 * WHY IT IS WORTH DOING. A contour traced out of a 1 m elevation grid
 * has a vertex every cell -- 61,607 segments across one cave's 130
 * levels, measured -- and every one of them crosses the script bridge
 * as boxed doubles, twice (position and colour). At half a foot of
 * tolerance the same lines come through as about 6,000 segments, a
 * tenth of the traffic, and nothing visible changes: half a foot is
 * far under the grid's own sample spacing, so the detail being dropped
 * was never a measurement in the first place.
 *
 * A running anchor, not a full Douglas-Peucker: one pass, no recursion,
 * and it cannot drop a corner that matters because every kept vertex
 * becomes the next anchor.
 *
 * \param points [{x, y}]
 * \param tol    perpendicular distance, in the points' own units
 */
CsTerrain3d.thinPolyline = function(points, tol) {
    if (points.length < 3 || !(tol > 0)) {
        return points;
    }
    var out = [points[0]];
    var anchor = points[0];
    for (var i = 1; i < points.length - 1; i++) {
        var next = points[i + 1];
        var dx = next.x - anchor.x;
        var dy = next.y - anchor.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        var d = (len < 1e-12) ? 0 :
            Math.abs(dy * (points[i].x - anchor.x) -
                     dx * (points[i].y - anchor.y)) / len;
        if (d > tol) {
            out.push(points[i]);
            anchor = points[i];
        }
    }
    out.push(points[points.length - 1]);
    return out;
};

/** How far a contour vertex may sit off its neighbours' line before it
 *  is kept, in METRES. Well under 3DEP's own 1 m sample spacing, so
 *  what it drops was never measured ground. */
CsTerrain3d.THIN_TOLERANCE_M = 0.15;
