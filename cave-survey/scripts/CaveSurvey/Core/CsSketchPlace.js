// CsSketchPlace.js -- landing a Therion scrap on the survey.
//
// Part of the Cave Survey Core library: pure functions, no document and
// no GUI, so tests/js_unit.js runs all of it.
//
// THE PROBLEM. A .th2 scrap is drawn in the SKETCHER'S coordinates --
// a grid on a phone screen, at whatever size the passage happened to
// be drawn at, with whatever drift accumulated down the page. It is
// tied to the cave by one thing: the "point x y station -name A3"
// markers the sketcher dropped on the stations as they drew.
//
// FIT, THEN WARP -- which is what Therion itself does, and the reason
// to follow it is not deference. A cave's survey is adjusted: loop
// closure moves stations (CsAdjust distributes misclosure round the
// loop by least squares, and it is on by default). A single rigid
// transform cannot put a sketch onto stations that have MOVED relative
// to each other since it was drawn, so a rigidly-fitted scrap has its
// walls drifting off the stations they were drawn against -- worst
// exactly where the survey needed adjusting most. The warp bends the
// sketch the same way the adjustment bent the survey, so every station
// marker lands on its station and the ink between them follows.
//
// WHAT IT COSTS, said plainly because it is a real cost: the sketch's
// own geometry is no longer rigid. A circle drawn on the scrap comes
// out very slightly elliptical; a scale bar drawn on one would stretch.
// Neither belongs on a scrap -- a sketch's job is to say where the
// walls are relative to the stations -- but a caver who drew one should
// know.
//
// THE FOURTH STATION IS WHERE THE WARP STARTS EARNING ITS KEEP, and
// it is worth knowing before reading a report. An affine has six
// unknowns; three tie pairs give it six equations, so a three-station
// fit passes exactly through all three however far the adjustment has
// since moved them, and the warp has nothing left to correct. From the
// fourth tie on the fit is a compromise between ties that disagree,
// and the difference between "close" and "on the station" is the warp.
// A scrap covering three stations therefore reports a zero residual
// honestly, not flatteringly.
//
// THE RESIDUAL REPORT QUOTES THE PRE-WARP FIGURE. After the warp every
// station lands on its station by construction, so a post-warp residual
// is zero for every scrap ever imported and would tell a caver nothing
// except that the arithmetic ran. The honest number is how far the
// sketch and the survey disagreed BEFORE it was bent -- the same
// distinction Survey Stats keeps when it quotes as-surveyed closure
// rather than the adjusted one, and for the same reason.
//
// WHAT A STATION COUNT CAN HONESTLY SAY:
//
//   3 or more   affine (stretch and skew taken out), then warp
//   2           similarity (shape kept), then warp
//   1           translation at the scrap's own declared scale; no warp
//               is possible, and the caller is told so
//   0           nothing. A plan or extended scrap with no station
//               markers has no tie to the cave at all, and placing it
//               anywhere would be a guess wearing the look of a
//               measurement.
//
// The one exception to that last line is a CROSS SECTION scrap, which
// carries no stations by design: it is placed by its own scale inside a
// section bay, and CsSectionBay owns that arithmetic. This file's job
// there is only to say "scale-only, not warped" so the report can.

var CsSketchPlace = {};

/**
 * The tie pairs between a scrap and the drawing.
 *
 * \param scrap a scrap from the CsTherion2 model.
 * \param targets a dict of station name to {x, y} in drawing
 *        coordinates -- the plan positions for a plan scrap, the band
 *        positions for an extended one.
 * \return {pairs, missing} -- pairs in CsScanFit's own {source, dest}
 *         shape, missing being the names the scrap ties to that the
 *         drawing has never heard of.
 */
CsSketchPlace.pairsFor = function(scrap, targets) {
    var pairs = [];
    var missing = [];
    if (scrap === undefined || scrap === null ||
            scrap.stations === undefined) {
        return { pairs: pairs, missing: missing };
    }
    for (var i = 0; i < scrap.stations.length; i++) {
        var station = scrap.stations[i];
        var target = CsSketchPlace.lookupStation(targets, station.name);
        if (target === null) {
            missing.push(station.name);
            continue;
        }
        pairs.push({ source: { x: station.x, y: station.y },
            dest: { x: target.x, y: target.y } });
    }
    return { pairs: pairs, missing: missing };
};

/**
 * A station by name, tolerantly.
 *
 * Therion's own full name for station 1 of survey main is "1@main",
 * and CsTherion joins nested surveys with "." instead -- so a sketch
 * drawn against the same cave can spell a station either way. Case is
 * ignored for the same reason the rest of the suite ignores it: the
 * drawing letters stations in upper case and a notebook rarely does.
 *
 * \return {x, y} or null.
 */
CsSketchPlace.lookupStation = function(targets, name) {
    if (targets === undefined || targets === null ||
            name === undefined || name === null) {
        return null;
    }
    if (targets.hasOwnProperty(name)) {
        return targets[name];
    }
    var candidates = [name];
    var at = name.indexOf("@");
    if (at !== -1) {
        // "1@main" -- Therion's own spelling. Try the survey-joined
        // form this suite uses, and the bare station on its own.
        candidates.push(name.substring(at + 1) + "." + name.substring(0, at));
        candidates.push(name.substring(0, at));
    }
    for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (targets.hasOwnProperty(candidate)) {
            return targets[candidate];
        }
        var upper = candidate.toUpperCase();
        if (targets.hasOwnProperty(upper)) {
            return targets[upper];
        }
        for (var key in targets) {
            if (targets.hasOwnProperty(key) &&
                    key.toUpperCase() === upper) {
                return targets[key];
            }
        }
    }
    return null;
};

/**
 * A pure translation placing one pair, at a known scale.
 *
 * The scale cannot come from the pairs -- one pair fixes a position
 * and says nothing about size or rotation -- so it comes from the
 * scrap's own -scale declaration, and north is assumed to be up the
 * page, which is what a plan scrap means by convention.
 *
 * \return an affine {a,b,c,d,e,f}.
 */
CsSketchPlace.translationFrom = function(pair, unitsPerScrapUnit) {
    var k = (unitsPerScrapUnit === undefined || unitsPerScrapUnit === null ||
        !(unitsPerScrapUnit > 0)) ? 1 : unitsPerScrapUnit;
    return { a: k, b: 0, c: pair.dest.x - k * pair.source.x,
             d: 0, e: k, f: pair.dest.y - k * pair.source.y };
};

/**
 * Works out how a scrap lands on the drawing.
 *
 * \param scrap a scrap from the CsTherion2 model.
 * \param targets a dict of station name to {x, y} in drawing
 *        coordinates.
 * \param options {scaleFactor} -- the scrap's declared scale converted
 *        into DRAWING units per scrap unit. Only consulted when there
 *        is exactly one station tie; the caller works it out with
 *        CsUnits because only the caller knows what the drawing's unit
 *        is.
 * \return {ok, kind, matrix, warp, residual, used, missing, thin,
 *          warnings} -- warp being the control pairs for
 *         CsWarp.mlsSimilarity, IN DRAWING SPACE, or null when no warp
 *         is possible. warnings are plain sentences for the report.
 */
CsSketchPlace.solve = function(scrap, targets, options) {
    var opts = (options === undefined || options === null) ? {} : options;
    var tie = CsSketchPlace.pairsFor(scrap, targets);
    var out = { ok: false, kind: null, matrix: null, warp: null,
        residual: null, used: tie.pairs.length, missing: tie.missing,
        thin: false, warnings: [] };

    if (tie.missing.length > 0) {
        out.warnings.push("The sketch ties to " + tie.missing.length +
            " station" + (tie.missing.length === 1 ? "" : "s") +
            " this drawing does not have (" +
            tie.missing.slice(0, 4).join(", ") +
            (tie.missing.length > 4 ? ", ..." : "") +
            "). Those ties are ignored.");
    }

    if (tie.pairs.length === 0) {
        out.warnings.push("The sketch carries no station markers this " +
            "drawing recognises, so there is nothing tying it to the " +
            "cave. It is not placed.");
        return out;
    }

    if (tie.pairs.length === 1) {
        out.matrix = CsSketchPlace.translationFrom(tie.pairs[0],
            opts.scaleFactor);
        out.kind = "translation";
        out.ok = true;
        out.residual = CsScanFit.residuals(tie.pairs, out.matrix);
        out.warnings.push("The sketch marks only one station, which " +
            "fixes where it sits and nothing else: its size comes from " +
            "the scale the sketch declares, and north is taken to be up " +
            "the page. It is not bent onto the survey.");
        if (opts.scaleFactor === undefined || opts.scaleFactor === null ||
                !(opts.scaleFactor > 0)) {
            out.warnings.push("It declares no scale either, so it is " +
                "placed at one drawing unit per sketch unit. Check its " +
                "size before you trust it.");
        }
        return out;
    }

    var fit = CsScanFit.fit(tie.pairs);
    if (fit === null) {
        out.warnings.push("The sketch's station markers all sit in the " +
            "same place, so they give no direction and no size. It is " +
            "not placed.");
        return out;
    }

    out.matrix = fit.matrix;
    out.kind = fit.kind;
    out.thin = fit.thin === true;
    out.ok = true;
    // PRE-warp, and see the header for why that is the honest number.
    out.residual = CsScanFit.residuals(tie.pairs, fit.matrix);

    if (out.thin) {
        out.warnings.push("The sketch's station markers sit almost in a " +
            "straight line, so nothing can be said about the direction " +
            "across that line. The sketch keeps its shape rather than " +
            "being stretched on a guess.");
    }

    out.warp = CsSketchPlace.warpPairs(tie.pairs, fit.matrix);
    return out;
};

/**
 * The control pairs a warp needs, in DRAWING space.
 *
 * Each pair runs from where the fit puts a station marker to where the
 * station actually is. Deliberately post-fit rather than from the
 * scrap's own coordinates: that keeps the warp a small correction to
 * an already-good placement -- MLS falls away with distance from its
 * controls, so handing it the whole scrap-to-drawing transform would
 * make everything far from a station drift back toward scrap
 * coordinates.
 *
 * \return an array of {old, nu} as CsWarp.mlsSimilarity wants, or null
 *         when there are too few pairs to bend anything.
 */
CsSketchPlace.warpPairs = function(pairs, matrix) {
    if (pairs === undefined || pairs === null || pairs.length < 2) {
        return null;
    }
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
        out.push({ old: CsScanFit.apply(matrix, pairs[i].source),
            nu: { x: pairs[i].dest.x, y: pairs[i].dest.y } });
    }
    return out;
};

/**
 * One scrap point in drawing coordinates: fitted, then bent.
 *
 * \param solution the answer from CsSketchPlace.solve.
 * \param x, y the point in scrap coordinates.
 * \return {x, y}, or null when the scrap was not placed.
 */
CsSketchPlace.at = function(solution, x, y) {
    if (solution === undefined || solution === null ||
            !solution.ok || solution.matrix === null) {
        return null;
    }
    var fitted = CsScanFit.apply(solution.matrix, { x: x, y: y });
    if (solution.warp === null) {
        return fitted;
    }
    var bent = CsWarp.mlsSimilarity(fitted, solution.warp);
    if (bent === null) {
        return fitted;
    }
    return { x: bent.x, y: bent.y };
};

/**
 * A whole path, anchors and Bezier controls alike.
 *
 * THE CONTROLS GO THROUGH THE WARP TOO. Bending a curve's endpoints
 * and leaving its control points where the fit put them would pull the
 * curve away from its own ends -- the shape would sag exactly where
 * the warp was doing the most work. They are ordinary points in the
 * same plane and are treated as such.
 *
 * \param solution the answer from CsSketchPlace.solve.
 * \param segs a line's segments from the CsTherion2 model.
 * \return segments of the same shape in drawing coordinates, or null.
 */
CsSketchPlace.path = function(solution, segs) {
    if (solution === undefined || solution === null || !solution.ok ||
            segs === undefined || segs === null) {
        return null;
    }
    var out = [];
    for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        out.push({
            to: CsSketchPlace.at(solution, seg.to[0], seg.to[1]),
            c1: seg.c1 === null ? null :
                CsSketchPlace.at(solution, seg.c1[0], seg.c1[1]),
            c2: seg.c2 === null ? null :
                CsSketchPlace.at(solution, seg.c2[0], seg.c2[1])
        });
    }
    return out;
};

/**
 * How much bigger the drawing is than the scrap, under a fit.
 *
 * A symbol's size travels as a multiplier (CsSketch.pointScale), and a
 * multiplier means nothing until it is in drawing units -- so this is
 * what turns "l" into a radius on the map.
 *
 * Taken from the matrix's own unit step rather than from the scrap's
 * declared -scale: the fit is what the sketch and the survey AGREED
 * on, and a scrap whose declared scale is wrong (a phone sketched at
 * one scale and re-scaled in xtherion later) would otherwise place
 * symbols at a size nothing else on the map uses. The geometric mean
 * of the two axes, because an affine fit may stretch them differently
 * and a symbol has one size.
 */
CsSketchPlace.scaleOf = function(matrix) {
    if (matrix === undefined || matrix === null) {
        return 1;
    }
    var sx = Math.sqrt(matrix.a * matrix.a + matrix.d * matrix.d);
    var sy = Math.sqrt(matrix.b * matrix.b + matrix.e * matrix.e);
    var k = Math.sqrt(sx * sy);
    return (isNaN(k) || k <= 0) ? 1 : k;
};

/**
 * Which way a symbol placed by this fit should face.
 *
 * Therion's -orientation is degrees clockwise from the top of the
 * SCRAP. A fit that turns the scrap turns every symbol on it, so the
 * matrix's own rotation is added; a fit that MIRRORS it -- which a bad
 * set of picks can produce -- would otherwise leave symbols facing the
 * wrong way round, so the turn is measured from where the scrap's own
 * up-vector actually lands.
 *
 * \param matrix the fit.
 * \param orientationDeg the point's -orientation, or null.
 * \return degrees clockwise from north, for the drawing.
 */
CsSketchPlace.orientation = function(matrix, orientationDeg) {
    var base = (orientationDeg === undefined || orientationDeg === null) ?
        0 : orientationDeg;
    if (matrix === undefined || matrix === null) {
        return base;
    }
    // Where "up the scrap" points once the fit has been applied.
    var upX = matrix.b, upY = matrix.e;
    if (upX === 0 && upY === 0) {
        return base;
    }
    // Clockwise from north, which is how every bearing in this suite
    // is stated (see the README's Conventions).
    var turn = Math.atan2(upX, upY) * 180 / Math.PI;
    var result = (base + turn) % 360;
    return result < 0 ? result + 360 : result;
};

// ---------------------------------------------------------------------
// Cubics to points.
// ---------------------------------------------------------------------

/**
 * How far a flattened cubic may stray from the curve it stands for,
 * in drawing units. A tenth of a foot: below what a pen line covers on
 * a 1" = 50 ft sheet, and far below what a sketcher's hand said.
 */
CsSketchPlace.FLATNESS = 0.1;

/**
 * A placed path as ordinary points lying ON the curve.
 *
 * WHY FLATTEN AT ALL, having gone to the trouble of keeping the
 * cubics through the parse and the warp. The entity this suite stores
 * a traced feature as is an interpolating spline through points --
 * that is what CsTrace.controlPointsOf reads, what CsTrace.growCurve
 * extends, what CsShapeLine takes as a spine and what CsWarp bends
 * later. Writing something else would make an imported wall a
 * second-class object that half the suite could not touch, which is
 * the opposite of the point of importing ink.
 *
 * NOT THE SAME AS RESAMPLING A DRAG. CsTrace.resample walks a captured
 * freehand stroke at a fixed step to thin out a caver's hand; these
 * points are the CURVE EVALUATED, placed where the cubic actually
 * goes, at whatever density the curvature needs. A straight run
 * between two anchors stays two points.
 *
 * Subdivides rather than stepping a parameter: a cubic parameterised
 * evenly bunches its samples where it is straight and starves them
 * where it bends, which is exactly backwards.
 *
 * \param placed the output of CsSketchPlace.path.
 * \param tolerance drawing units; CsSketchPlace.FLATNESS when absent.
 * \return an array of {x, y}, or [] when there is nothing to draw.
 */
CsSketchPlace.flatten = function(placed, tolerance) {
    var tol = (tolerance === undefined || tolerance === null ||
        !(tolerance > 0)) ? CsSketchPlace.FLATNESS : tolerance;
    var out = [];
    if (placed === undefined || placed === null || placed.length === 0) {
        return out;
    }
    if (placed[0].to === null) {
        return out;
    }
    out.push({ x: placed[0].to.x, y: placed[0].to.y });
    for (var i = 1; i < placed.length; i++) {
        var seg = placed[i];
        if (seg.to === null) {
            continue;
        }
        var from = out[out.length - 1];
        if (seg.c1 === null || seg.c2 === null) {
            out.push({ x: seg.to.x, y: seg.to.y });
            continue;
        }
        CsSketchPlace.subdivide(from, seg.c1, seg.c2, seg.to, tol, 0, out);
        out.push({ x: seg.to.x, y: seg.to.y });
    }
    return out;
};

/**
 * One cubic, split until flat, appending everything but its end point.
 *
 * The end point is the caller's to add, so that consecutive segments
 * do not each contribute the joint between them.
 *
 * The depth cap is not ceremony: a cusp (both controls on top of an
 * anchor) never satisfies a flatness test, and a sketch is allowed to
 * contain one.
 */
CsSketchPlace.MAX_SUBDIVISION = 12;

CsSketchPlace.subdivide = function(p0, p1, p2, p3, tol, depth, out) {
    if (depth >= CsSketchPlace.MAX_SUBDIVISION ||
            CsSketchPlace.isFlat(p0, p1, p2, p3, tol)) {
        return;
    }
    // de Casteljau at the middle.
    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    var p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3);
    var p012 = mid(p01, p12), p123 = mid(p12, p23);
    var centre = mid(p012, p123);

    CsSketchPlace.subdivide(p0, p01, p012, centre, tol, depth + 1, out);
    out.push({ x: centre.x, y: centre.y });
    CsSketchPlace.subdivide(centre, p123, p23, p3, tol, depth + 1, out);
};

/**
 * Whether a cubic is within `tol` of the straight line through its
 * ends.
 *
 * Measures both control points' distance from the chord. A cubic lies
 * inside the hull of its four points, so controls close to the chord
 * mean the curve is too.
 *
 * The degenerate case -- both ends in the same place -- is NOT flat
 * unless the controls are there as well: that is a loop, and calling
 * it flat would erase it.
 */
CsSketchPlace.isFlat = function(p0, p1, p2, p3, tol) {
    var dx = p3.x - p0.x, dy = p3.y - p0.y;
    var span = Math.sqrt(dx * dx + dy * dy);
    if (span < 1e-12) {
        var d1 = Math.sqrt((p1.x - p0.x) * (p1.x - p0.x) +
            (p1.y - p0.y) * (p1.y - p0.y));
        var d2 = Math.sqrt((p2.x - p0.x) * (p2.x - p0.x) +
            (p2.y - p0.y) * (p2.y - p0.y));
        return d1 <= tol && d2 <= tol;
    }
    var off1 = Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / span;
    var off2 = Math.abs((p2.x - p0.x) * dy - (p2.y - p0.y) * dx) / span;
    return off1 <= tol && off2 <= tol;
};
