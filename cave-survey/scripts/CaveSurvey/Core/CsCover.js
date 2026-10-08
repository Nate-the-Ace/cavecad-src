// CsCover.js -- how much ground sits over a passage.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness exercises all of it.
//
// Every other colour mode in the 3D view is a fact about the SURVEY --
// which trip, how far in, how big, how well closed. This is the one
// fact about the ROCK: the vertical thickness of ground between the
// surface and the top of the passage. It is the number a dig from the
// surface, a suspected daylight lead or a quarry above the cave turns
// on.
//
// THE GRID IS SAMPLED, NOT MESHED. CsTerrain3d turns the same 3DEP
// grid into a surface to look at; this reads single points out of it.
// Both convert a reading into the survey's vertical frame the same
// way -- metres to drawing units, minus CsElevation's datum offset --
// and neither may grow its own copy of that arithmetic.
//
// A HOLE IS NULL, NOT A NUMBER. CsTerrain3d.mesh fills a no-data cell
// with the grid's lowest real reading, because a bounding box has to
// stay usable and a hillside with a bite out of it is still a
// hillside. A MEASUREMENT filled that way would report hundreds of
// feet of rock over a hole in the data, which is worse than reporting
// nothing. Outside the grid is null for the same reason.
//
// NEGATIVE COVER IS KEPT. A station above the modelled ground means a
// wrong datum, a bad anchor, or a sample taken off a cliff edge.
// Clamping it to zero hides exactly the failure this suite has closed
// five separate doors on -- see CsElevation's datum offset. The
// caller counts them and says so.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsUnits.js");
include(includeBasePath + "/CsContour.js");
include(includeBasePath + "/CsMesh3d.js");

var CsCover = {};

/**
 * The inverse of a CsGeoProject.gridTransform: drawing (x, y) back to
 * fractional (col, row).
 *
 * gridTransform is AFFINE -- a Mercator scale, a cosine, a unit
 * conversion and a translation, none of which bend -- so three
 * samples of it describe the whole mapping and the inverse is one 2x2
 * solve. There is no search here and there must never be one.
 *
 * \return function(x, y) -> {col, row}, or null when the transform is
 *         degenerate (a zero-width grid).
 */
CsCover.inverse = function(transform) {
    var o = transform(0, 0);
    var c1 = transform(1, 0);
    var r1 = transform(0, 1);
    // columns of the forward matrix
    var ax = c1.x - o.x, ay = c1.y - o.y;      // d(x,y)/d(col)
    var bx = r1.x - o.x, by = r1.y - o.y;      // d(x,y)/d(row)
    var det = ax * by - ay * bx;
    if (!isFinite(det) || Math.abs(det) < 1e-12) {
        return null;
    }
    return function(x, y) {
        var dx = x - o.x;
        var dy = y - o.y;
        return {
            col: (dx * by - dy * bx) / det,
            row: (ax * dy - ay * dx) / det
        };
    };
};

/**
 * A reader for ground elevation, in the SURVEY's vertical frame.
 *
 * \param grid      {values, width, height} from CsContour.parseFloatTiff
 * \param transform CsGeoProject.gridTransform(...)
 * \param opts      {unit:   CsUnits.FEET / CsUnits.METERS,
 *                   offset: CsElevation datum offset in `unit`, or
 *                           null when unknown -- null places the
 *                           ground on its own NAVD88 datum, which the
 *                           caller must say out loud}
 *
 * \return function(x, y) -> ground z in drawing units, or null where
 *         the grid has no reading there.
 */
CsCover.sampler = function(grid, transform, opts) {
    opts = opts || {};
    var unit = opts.unit || CsUnits.FEET;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0.0;
    var inv = CsCover.inverse(transform);
    if (grid === null || grid === undefined || inv === null) {
        return function() { return null; };
    }
    var w = grid.width;
    var h = grid.height;

    var at = function(col, row) {
        if (col < 0 || row < 0 || col >= w || row >= h) {
            return null;
        }
        var v = grid.values[row * w + col];
        if (CsContour.isNoData(v)) {
            return null;
        }
        return v;
    };

    return function(x, y) {
        var g = inv(x, y);
        if (!isFinite(g.col) || !isFinite(g.row)) {
            return null;
        }
        var c0 = Math.floor(g.col);
        var r0 = Math.floor(g.row);
        var fc = g.col - c0;
        var fr = g.row - r0;
        // The edge row and column have no neighbour to interpolate
        // towards; stepping back one cell keeps them readable rather
        // than turning the whole rim of the grid into a hole.
        if (c0 >= w - 1) { c0 = w - 2; fc = 1.0; }
        if (r0 >= h - 1) { r0 = h - 2; fr = 1.0; }
        var v00 = at(c0, r0);
        var v10 = at(c0 + 1, r0);
        var v01 = at(c0, r0 + 1);
        var v11 = at(c0 + 1, r0 + 1);
        if (v00 === null || v10 === null || v01 === null || v11 === null) {
            return null;
        }
        var top = v00 + (v10 - v00) * fc;
        var bot = v01 + (v11 - v01) * fc;
        var metres = top + (bot - top) * fr;
        return CsUnits.convert(metres, CsUnits.METERS, unit) - offset;
    };
};

/**
 * The ceiling at a station: its own elevation plus the up reading of
 * the LRUD measured there.
 *
 * A station with no up reading answers with its own z. That is the
 * honest floor of the answer -- it reports MORE cover than there is,
 * by the unmeasured height of the passage -- and a station without an
 * up reading is exactly a station whose ceiling nobody looked at.
 */
CsCover.ceilingAt = function(name, survey, station) {
    var lr = CsMesh3d.lrudAt(name, survey);
    var up = lr.up;
    if (typeof up !== "number" || !isFinite(up) || up < 0) {
        return station.z;
    }
    return station.z + up;
};

/**
 * Depth of cover at every resolved station.
 *
 * \param survey   a Survey (CsModel)
 * \param resolved CsNetwork.resolve(survey)
 * \param sample   CsCover.sampler(...) -- or any function(x, y)
 * \return {name: cover in drawing units, or null where the surface has
 *          no reading over that station}
 */
CsCover.atStations = function(survey, resolved, sample) {
    var out = {};
    if (survey === null || survey === undefined ||
            resolved === null || resolved === undefined ||
            typeof sample !== "function") {
        return out;
    }
    for (var name in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(name)) {
            continue;
        }
        var st = resolved.stations[name];
        if (st === null || st === undefined ||
                typeof st.z !== "number" || !isFinite(st.z)) {
            out[name] = null;
            continue;
        }
        var ground = sample(st.x, st.y);
        if (ground === null || ground === undefined || !isFinite(ground)) {
            out[name] = null;
            continue;
        }
        out[name] = ground - CsCover.ceilingAt(name, survey, st);
    }
    return out;
};

/**
 * What the status line reports about a set of cover values.
 *
 * \return {count, unknown, above, thinnest: {name, value}|null,
 *          thickest: {name, value}|null}
 *
 * `above` counts the stations sitting ABOVE the modelled ground. It is
 * a number the caller must show when it is not zero: on a cave with a
 * sound datum it is zero or one (an entrance under a metre of slope
 * error), and a cave where it is most of the stations has a datum
 * problem, not a thin roof.
 */
CsCover.summary = function(values) {
    var out = { count: 0, unknown: 0, above: 0,
                thinnest: null, thickest: null };
    for (var name in values) {
        if (!values.hasOwnProperty(name)) {
            continue;
        }
        var v = values[name];
        if (v === null || v === undefined || !isFinite(v)) {
            out.unknown++;
            continue;
        }
        out.count++;
        if (v < 0) {
            out.above++;
        }
        if (out.thinnest === null || v < out.thinnest.value) {
            out.thinnest = { name: name, value: v };
        }
        if (out.thickest === null || v > out.thickest.value) {
            out.thickest = { name: name, value: v };
        }
    }
    return out;
};
