// ScanAlign.js
//
// The interactive fit behind Sketch Scans' "Insert && Align" and "Add a
// scan from elsewhere...": ALIGN a scanned map (or any objects) onto
// the drawing by matching up stations -- the same idea as the ALIGN
// command in AutoCAD and Civil 3D, with a warp-to-fit option on top.
//
// This used to be Align Image, its own menu entry and command ("ali").
// It was folded into Sketch Scans because the two were the same job --
// the panel already inserted a scan and handed it straight to this
// tool -- and a beginner does not need two names for one step. The
// panel is still the only way most cavers reach it; a scan that is not
// in the cave's scans/ folder is the one case the panel cannot list, so
// its "Add a scan from elsewhere..." button file-picks one and hands it
// here the same way. See SketchScans.alignSoon and SketchScans.init.
//
// You scan a hand-drawn cave map or an old survey sheet, insert it into
// QCAD (Draw > Image), and this tool moves, rotates and resizes the
// scan so that stations on it land on the matching stations in your
// drawing. Click two stations and the scan keeps its shape; click three
// or more and it is also warped -- stretched by different amounts
// across and down, and skewed -- to fit them all as closely as
// possible, which is what takes out the distortion a flatbed scanner
// leaves behind. Either way the scan ends up in the right place at the
// right size, so you can trace passage walls straight off it.
//
// USAGE:
//   Sketch Scans panel: "Insert && Align", or "Add a scan from
//   elsewhere..." for a file outside the cave's scans/ folder. Not on
//   the menu, the toolbar or the command line -- see ScanAlign.init.
//
//   Follow the prompts at the bottom of the QCAD window:
//
//   1. "Click the image to align, then press Enter"
//      Click anywhere on the scan -- the whole image, not just its
//      edge. (Skipped if you already selected something before
//      starting.) Clicking a picked object again un-picks it. Press
//      Enter when done.
//   2. "Click STATION 1 on the image"
//      A survey station you can also find in the drawing.
//   3. "Click where STATION 1 goes in the drawing"
//      The matching real station. You can also type coordinates
//      (e.g. 152.4,300.2) and press Enter -- or type the station's
//      NAME ("B1"): the point comes from the drawing's own plotted
//      station, no click needed. From then on the tool ASSUMES the
//      next station in survey order (branches follow their tie-in) --
//      the prompt reads "STATION 2 = B2 -- Enter accepts, type
//      another station name, or click in the drawing". Stations that
//      already have a point on this scan (recorded on the image, tag
//      AlignedStations) are skipped, so a half-aligned scan resumes
//      where it left off.
//   4. "Click STATION 2 on the image", then where it goes.
//      As far from station 1 as you can manage: the farther apart, the
//      more accurate the fit.
//   5. "Click STATION 3 on the image for a better fit, or press Enter
//      to finish". Keep adding stations for as long as you like, or
//      press Enter at any point to apply what you have.
//
//   Press Escape (or right-click) to step back one click at a time, or
//   to cancel.
//
// HOW MANY STATIONS TO USE:
//   TWO stations move, rotate and resize the scan so both land exactly
//   on their targets. The scan keeps its shape.
//
//   THREE OR MORE stations WARP the scan to fit: on top of moving and
//   rotating, it can be stretched by different amounts across and down
//   and skewed, which is what corrects a sheet that went through a
//   scanner slightly crooked or stretched. With exactly three stations
//   the fit is exact. With four or more no single warp can pass through
//   every station, so the tool uses the warp that misses by the least
//   overall, and tells you how far each station missed by -- a station
//   with a much larger miss than the rest is usually a mis-click or a
//   mis-identified station on the scan. One caveat: if the stations sit
//   in a symmetrical pattern -- the four corners of a square, say -- a
//   single bad one is shared out evenly between them all rather than
//   standing out, so a set of equal misses is not proof that every
//   station is good.
//
//   More stations spread over the whole sheet beat more stations in one
//   corner. Three stations in a line cannot define a warp at all (they
//   say nothing about the direction across the line); the tool notices
//   this and falls back to the two-station style of fit.
//
// WHAT IT CANNOT CORRECT:
//   The warp is uniform across the sheet: it stretches, squashes and
//   skews the whole scan as one. It cannot fix a photograph taken at an
//   angle (where the far edge of the page looks smaller than the near
//   edge), and it cannot fix paper that has stretched unevenly or a map
//   taped together from several sheets. Those need true rubber
//   sheeting, which warps each part of the image separately -- a
//   different tool, because it has to write a warped copy of the image
//   file rather than just place the original differently.
//
// WHAT IT DOES TO THE IMAGE:
//   Nothing is redrawn or re-saved. QCAD stores an image as a position
//   plus two vectors -- one across, one down -- and this tool only
//   changes those, so there is no loss of quality and the image file on
//   disk is never touched. Ctrl+Z puts it back.
//
// SNAPPING:
//   A scanned image has no lines or endpoints to snap to, so while you
//   are clicking stations ON THE IMAGE this tool switches snapping to
//   "Free" for you, and switches it back to "Auto" for the matching
//   points IN THE DRAWING so those land exactly on your existing
//   station points and line ends. (If you have locked the snap mode
//   yourself, your choice is left alone.) Zoom in before clicking --
//   the fit is only as good as your clicks.
//
// MOVING WITHOUT RESIZING:
//   Press Enter after the first station instead of clicking a second
//   one: the objects are then only moved, so station 1 lands on its
//   target and nothing is rotated or resized.
//
//   To rotate onto two stations but keep the current size -- for a
//   drawing that is already at the right scale -- type  noscale  and
//   press Enter at any prompt before the last click. Type  scale  to
//   turn resizing back on. This applies to the two-station fit only; a
//   three-station-or-more warp always resizes, since that is what it is
//   for.
//
// AFTER ALIGNING:
//   The bottom of the QCAD window reports what was done: the rotation
//   and resize factor for a two-station fit, or for a warp the average
//   and worst station miss, the image scale across and down, and how
//   much skew was needed. For a single image it also reports the
//   resolution in drawing units per pixel -- a quick sanity check that
//   the scan ended up a believable size.
//
//   Put the image on its own layer and lock that layer afterwards, so
//   you don't nudge the scan out of place while tracing over it.
//
// OTHER OBJECTS:
//   The tool works on any selection, not just images. Only images can
//   be warped, though -- QCAD can stretch and skew an image but not a
//   line or a block. So with three or more stations, any non-image
//   objects in the selection are moved, rotated and resized to fit as
//   closely as they can instead, and the report says so.
//
// INSTALLATION:
//   This file lives beside Sketch Scans, which includes it directly:
//     scripts/CaveSurvey/SketchScans/ScanAlign.js
//   It is not a tool folder of its own -- AddOn.getAddOns only finds a
//   tool at <dir>/<dir>.js, and this is <dir>/ScanAlign.js inside
//   SketchScans/. Restart QCAD after installing. See README.txt for the
//   full path on each platform.
//
// Derived from Transform (scripts/Modify/Transform.js), QCAD's own base
// class for tools that move/rotate/scale a selection, which handles the
// per-entity work, previews and undo.

include("scripts/Modify/Transform.js");
// The whole Core: CsLayers.frameOf (which view a layer belongs to),
// and for the station assumption CsTags.collectStations,
// CsRevise.resolveAsDrawn and CsStationOrder.
include(includeBasePath + "/../Core/CsAll.js");

/**
 * \class ScanAlign
 * \brief Moves, rotates, resizes and (with three or more stations)
 * warps the selected objects so that picked points on a scan land on
 * the matching points in the drawing.
 */
function ScanAlign(guiAction) {
    Transform.call(this, guiAction);

    // station pairs picked so far: [{source: RVector, dest: RVector}, ...]
    // 'source' is the point on the image, 'dest' where it belongs.
    this.pairs = [];

    // point clicked on the image whose target hasn't been given yet:
    this.pendingSource = undefined;

    // resize to fit. Applies to the two-station fit only -- a warp
    // always resizes. On unless the user types "noscale":
    this.scale = true;

    // objects this tool picked itself, so cancelling can un-pick them:
    this.pickedIds = [];
    this.hadSelection = false;

    // Station assumption ("when I click, ask, but assume the next
    // unentered station"): built lazily by stationContext() the first
    // time a station name is typed. undefined = not tried yet,
    // null = this drawing cannot support it (no tagged stations, or
    // reconstruction failed) -- the tool is then exactly the manual
    // tool it always was.
    //   order    station names in survey walk order (CsStationOrder)
    //   plotted  name -> RVector of the drawn station point
    //   used     names already assigned -- the scan's AlignedStations
    //            tag plus every pair completed this run
    //   last     the most recent name-resolved station, the cursor the
    //            walk advances from (manual clicks do not move it)
    this.stationCtx = undefined;
    // a name typed at the source prompt, overriding the next assumption:
    this.assumeOverride = undefined;
    // names resolved THIS run, for the AlignedStations tag on apply:
    this.namedThisRun = [];
}

ScanAlign.prototype = new Transform();

ScanAlign.State = {
    SelectingEntities : 0,
    SettingSourcePoint : 1,
    SettingDestPoint : 2
};

// two points closer together than this count as the same point:
ScanAlign.Tolerance = 1.0e-9;

// slack (in pixels) when testing whether a click is inside an image,
// so rounding noise exactly on the edge still counts as inside:
ScanAlign.EdgeTolerance = 1.0e-6;

// how far from a straight line three or more stations must be before a
// warp can be worked out from them, relative to how spread out they
// are. Stations in a line say nothing about the direction across that
// line, so the warp would be a wild guess:
ScanAlign.CollinearTolerance = 1.0e-8;


// =====================================================================
// Geometry. These are plain functions with no dependency on the GUI or
// on a document, so they can be tested headlessly -- see
// tests/test_align_math.js.
// =====================================================================

/**
 * Brings an angle into the range -180 to +180 degrees, so a small turn
 * one way doesn't get reported as an almost full turn the other way,
 * and so the one-or-two-station fit and the many-station fit describe
 * the same rotation the same way.
 */
ScanAlign.normalizeAngle = function(angle) {
    var a = RMath.getNormalizedAngle(angle);   // 0 .. 2*pi
    if (a > Math.PI) {
        a -= 2 * Math.PI;
    }
    return a;
};

/**
 * The exact fit through one or two station pairs: move, rotate and
 * uniformly resize.
 *
 * Returns the transformation that maps s1 onto d1 and the direction
 * s1->s2 onto d1->d2, expressed as: rotate by 'angle' about s1, scale
 * by 'factor' about s1, then move by 'offset' -- the order in which
 * transform() below applies them.
 *
 * \param s1,d1 first source / destination point (RVector)
 * \param s2,d2 second source / destination point, or undefined for a
 *              move-only alignment
 * \param scale true to also derive a uniform resize factor
 *
 * \return {offset: RVector, angle: Number (radians), factor: Number},
 *         or undefined if the points are degenerate
 */
ScanAlign.computeTransform = function(s1, d1, s2, d2, scale) {
    if (isNull(s1) || isNull(d1)) {
        return undefined;
    }

    var offset = d1.operator_subtract(s1);
    var angle = 0.0;
    var factor = 1.0;

    if (!isNull(s2) && !isNull(d2)) {
        var sourceDist = s1.getDistanceTo(s2);
        var destDist = d1.getDistanceTo(d2);

        // the two stations on the image are the same point: no
        // direction to line up, and no distance to take a size from:
        if (sourceDist < ScanAlign.Tolerance) {
            return undefined;
        }
        // the two targets are the same point:
        if (destDist < ScanAlign.Tolerance) {
            return undefined;
        }

        angle = ScanAlign.normalizeAngle(d1.getAngleTo(d2) - s1.getAngleTo(s2));

        if (scale === true) {
            factor = destDist / sourceDist;
        }
    }

    return { offset: offset, angle: angle, factor: factor };
};

/**
 * Applies the result of computeTransform to a single point, in the same
 * order the entities are transformed in.
 */
ScanAlign.transformPoint = function(params, center, point) {
    var v = point.operator_subtract(center);
    var a = v.getAngle() + params.angle;
    var m = v.getMagnitude() * params.factor;
    return new RVector(
        center.x + Math.cos(a) * m + params.offset.x,
        center.y + Math.sin(a) * m + params.offset.y
    );
};

/**
 * \return the average of the source points and the average of the
 * destination points of the given station pairs.
 */
ScanAlign.getCentroids = function(pairs) {
    var sx = 0.0, sy = 0.0, dx = 0.0, dy = 0.0;
    for (var i = 0; i < pairs.length; i++) {
        sx += pairs[i].source.x;
        sy += pairs[i].source.y;
        dx += pairs[i].dest.x;
        dy += pairs[i].dest.y;
    }
    var n = pairs.length;
    return {
        source: new RVector(sx / n, sy / n),
        dest: new RVector(dx / n, dy / n)
    };
};

/**
 * The move / rotate / uniform-resize that fits the given station pairs
 * as closely as possible (a least squares fit). With two pairs this is
 * the exact fit; with more it is the closest one, since no single
 * move-rotate-resize can generally pass through them all.
 *
 * Used for the objects that cannot be warped -- QCAD can stretch and
 * skew an image, but not a line or a block -- and as the fallback when
 * the stations are in a straight line.
 *
 * \param pairs [{source: RVector, dest: RVector}, ...], at least two
 *
 * \return {center: RVector, offset: RVector, angle: Number, factor:
 *         Number} to be applied as: rotate and scale about 'center',
 *         then move by 'offset'. undefined if degenerate.
 */
ScanAlign.computeSimilarityFit = function(pairs) {
    if (isNull(pairs) || pairs.length < 2) {
        return undefined;
    }

    var c = ScanAlign.getCentroids(pairs);

    // sums over the points measured from their own centroid:
    var aligned = 0.0;    // how much source and target agree in direction
    var turned = 0.0;     // how much the target is turned from the source
    var spread = 0.0;     // how spread out the source points are
    var i, sx, sy, dx, dy;

    for (i = 0; i < pairs.length; i++) {
        sx = pairs[i].source.x - c.source.x;
        sy = pairs[i].source.y - c.source.y;
        dx = pairs[i].dest.x - c.dest.x;
        dy = pairs[i].dest.y - c.dest.y;

        aligned += sx * dx + sy * dy;
        turned += sx * dy - sy * dx;
        spread += sx * sx + sy * sy;
    }

    // every station on the image is in the same spot:
    if (spread < ScanAlign.Tolerance) {
        return undefined;
    }

    var angle = Math.atan2(turned, aligned);
    var factor = Math.sqrt(aligned * aligned + turned * turned) / spread;

    if (factor < ScanAlign.Tolerance) {
        return undefined;
    }

    return {
        center: c.source,
        offset: c.dest.operator_subtract(c.source),
        angle: angle,
        factor: factor
    };
};

/**
 * The warp that fits the given station pairs as closely as possible: on
 * top of moving and rotating, it may stretch by different amounts
 * across and down, and skew. With three pairs the fit is exact; with
 * more it is the least squares fit.
 *
 * The result maps a point (x,y) to (a*x + b*y + c, d*x + e*y + f).
 *
 * \param pairs [{source: RVector, dest: RVector}, ...], at least three
 *
 * \return {a,b,c,d,e,f} or undefined if there are too few stations or
 *         they lie in a straight line (which says nothing about the
 *         direction across that line)
 */
ScanAlign.computeAffineFit = function(pairs) {
    if (isNull(pairs) || pairs.length < 3) {
        return undefined;
    }

    var c = ScanAlign.getCentroids(pairs);

    // Working from the centroids keeps the numbers small, which matters
    // when survey coordinates run to six or seven figures.
    var sxx = 0.0, sxy = 0.0, syy = 0.0;
    var mxx = 0.0, mxy = 0.0, myx = 0.0, myy = 0.0;
    var i, sx, sy, dx, dy;

    for (i = 0; i < pairs.length; i++) {
        sx = pairs[i].source.x - c.source.x;
        sy = pairs[i].source.y - c.source.y;
        dx = pairs[i].dest.x - c.dest.x;
        dy = pairs[i].dest.y - c.dest.y;

        sxx += sx * sx;
        sxy += sx * sy;
        syy += sy * sy;

        mxx += dx * sx;
        mxy += dx * sy;
        myx += dy * sx;
        myy += dy * sy;
    }

    var det = sxx * syy - sxy * sxy;

    // Stations in a straight line (or all in one spot) leave this at
    // zero. Compare against the spread of the stations rather than a
    // fixed number, so the test means the same thing whatever units and
    // coordinates the drawing uses.
    var spread = sxx + syy;
    if (spread < ScanAlign.Tolerance ||
        Math.abs(det) < ScanAlign.CollinearTolerance * spread * spread) {
        return undefined;
    }

    var a = (mxx * syy - mxy * sxy) / det;
    var b = (mxy * sxx - mxx * sxy) / det;
    var d = (myx * syy - myy * sxy) / det;
    var e = (myy * sxx - myx * sxy) / det;

    return {
        a: a,
        b: b,
        c: c.dest.x - (a * c.source.x + b * c.source.y),
        d: d,
        e: e,
        f: c.dest.y - (d * c.source.x + e * c.source.y)
    };
};

/**
 * Applies a warp from computeAffineFit to a single point.
 */
ScanAlign.applyAffine = function(m, point) {
    return new RVector(
        m.a * point.x + m.b * point.y + m.c,
        m.d * point.x + m.e * point.y + m.f
    );
};

/**
 * How far each station ends up from where it was supposed to land.
 *
 * \param pairs the station pairs
 * \param mapPoint function(RVector) -> RVector, the fit being checked
 *
 * \return {average: Number, worst: Number, worstStation: Number}, with
 *         worstStation counted from 1 for people rather than from 0
 */
ScanAlign.getResiduals = function(pairs, mapPoint) {
    var total = 0.0;
    var worst = 0.0;
    var worstStation = 0;

    for (var i = 0; i < pairs.length; i++) {
        var missed = mapPoint(pairs[i].source).getDistanceTo(pairs[i].dest);
        total += missed;
        if (missed > worst) {
            worst = missed;
            worstStation = i + 1;
        }
    }

    return {
        average: pairs.length > 0 ? total / pairs.length : 0.0,
        worst: worst,
        worstStation: worstStation
    };
};

/**
 * \return true if pos is inside the given image entity, taking the
 * image's rotation and any warp into account.
 *
 * QCAD itself measures the distance to an image's BORDER, so clicking
 * in the middle of a big scan picks nothing. This lets the tool accept
 * a click anywhere on the image instead.
 */
ScanAlign.isPointInImage = function(entity, pos) {
    var origin = entity.getInsertionPoint();
    var u = entity.getUVector();
    var v = entity.getVVector();

    // where the click falls in the image's own grid, in pixels: solve
    // pos = origin + alongU * u + alongV * v
    var det = u.x * v.y - u.y * v.x;
    if (Math.abs(det) < ScanAlign.Tolerance) {
        // the image has no area (it is edge-on or empty)
        return false;
    }

    var dx = pos.x - origin.x;
    var dy = pos.y - origin.y;

    var alongU = (dx * v.y - dy * v.x) / det;
    var alongV = (u.x * dy - u.y * dx) / det;

    var t = ScanAlign.EdgeTolerance;
    return alongU >= -t && alongU <= entity.getPixelWidth() + t &&
           alongV >= -t && alongV <= entity.getPixelHeight() + t;
};

/**
 * Re-places an image so the whole picture is warped by the given fit.
 *
 * QCAD stores an image as a position plus two vectors, one across the
 * picture and one down it, so warping the vectors warps the picture.
 * Nothing is redrawn and the file on disk is untouched.
 */
ScanAlign.applyAffineToImage = function(entity, m) {
    var u = entity.getUVector();
    var v = entity.getVVector();
    var origin = entity.getInsertionPoint();

    // the vectors are directions, so they take the stretch and skew of
    // the warp but not its move:
    entity.setProperty(RImageEntity.PropertyUX, m.a * u.x + m.b * u.y);
    entity.setProperty(RImageEntity.PropertyUY, m.d * u.x + m.e * u.y);
    entity.setProperty(RImageEntity.PropertyVX, m.a * v.x + m.b * v.y);
    entity.setProperty(RImageEntity.PropertyVY, m.d * v.x + m.e * v.y);

    // the corner the picture hangs from does move:
    entity.move(ScanAlign.applyAffine(m, origin).operator_subtract(origin));
};


// =====================================================================
// The tool itself.
// =====================================================================

ScanAlign.prototype.beginEvent = function() {
    Transform.prototype.beginEvent.call(this);

    var di = this.getDocumentInterface();
    if (isNull(di)) {
        this.terminate();
        return;
    }

    this.hadSelection = di.hasSelection();

    if (this.hadSelection) {
        this.setState(ScanAlign.State.SettingSourcePoint);
    }
    else {
        this.setState(ScanAlign.State.SelectingEntities);
    }
};

/**
 * The station-assumption context, built once per run and only when
 * asked for. null when this drawing cannot support it -- no tagged
 * station points, or the survey would not reconstruct (a legacy
 * drawing) -- and every caller then falls back to the manual flow.
 */
ScanAlign.prototype.stationContext = function() {
    if (this.stationCtx !== undefined) {
        return this.stationCtx;
    }
    this.stationCtx = null;
    var doc = this.getDocument();
    if (isNull(doc)) {
        return null;
    }
    try {
        var stations = CsTags.collectStations(doc);
        if (stations.length === 0) {
            return null;
        }
        var plotted = {};
        for (var i = 0; i < stations.length; i++) {
            plotted[stations[i].name] = stations[i].pos;
        }
        // SPLAY TIPS ARE TARGETS TOO. Every drawn splay ends in a
        // named, tagged point at the wall it hit, and on a sketch those
        // wall hits are often the only features a caver can identify
        // with confidence -- the middle of a room carries no station,
        // but its corners carry splays. Read straight off the drawing
        // rather than re-derived from the survey, so the names and
        // positions here are exactly the ones on the map, gaps in the
        // numbering included (see CsTags.collectSplays' docblock).
        var ids = doc.queryAllEntities(false, false);
        for (i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || typeof e.getPosition !== "function") {
                continue;
            }
            var tip = CsTags.get(e, "SplayName");
            if (tip === "" || plotted.hasOwnProperty(tip)) {
                continue;
            }
            plotted[tip] = e.getPosition();
        }
        // The drawing's own survey, in notebook order -- the
        // "fingerprint". This is what makes the walk follow a branch
        // to its tie-in instead of counting on through the run.
        //
        // STATIONS ONLY, deliberately, even though the splay tips above
        // are now valid targets. The walk drives "assume the next one"
        // and a station carries half a dozen splays: advancing through
        // every wall hit between D2 and D3 would turn a six-click
        // alignment into a forty-click one. A splay tip is reached by
        // TYPING its name, which is exactly the gesture a caver makes
        // when they have found one on the sketch.
        var order = CsStationOrder.walkOrder(
            CsRevise.resolveAsDrawn(doc).survey);
        if (order.length === 0) {
            return null;
        }
        var used = {};
        var image = this.getSingleImage();
        if (!isNull(image)) {
            var assigned = CsStationOrder.parseAssigned(
                CsTags.get(image, CsStationOrder.TAG));
            for (var k = 0; k < assigned.length; k++) {
                used[assigned[k]] = true;
            }
        }
        this.stationCtx = {
            order: order, plotted: plotted, used: used, last: null
        };
    } catch (e) {
        this.stationCtx = null;
    }
    return this.stationCtx;
};

/**
 * The station the NEXT pair should assume, or null: the typed override
 * first, otherwise the walk's next unassigned plotted station.
 */
ScanAlign.prototype.assumedStation = function() {
    var ctx = this.stationContext();
    if (ctx === null) {
        return null;
    }
    if (this.assumeOverride !== undefined &&
            ctx.used[this.assumeOverride] !== true) {
        return this.assumeOverride;
    }
    var plottedNames = {};
    for (var name in ctx.plotted) {
        plottedNames[name] = true;
    }
    return CsStationOrder.nextUnassigned(
        ctx.order, ctx.last, ctx.used, plottedNames);
};

/**
 * Completes the pending pair at a NAMED station's plotted point --
 * typed or assumed, this is the one way a name becomes a target. Moves
 * the walk cursor to it.
 */
ScanAlign.prototype.acceptStation = function(name) {
    var ctx = this.stationContext();
    if (ctx === null || isNull(this.pendingSource)) {
        return false;
    }
    var pos = ctx.plotted[name];
    if (pos === undefined) {
        return false;
    }
    var di = this.getDocumentInterface();
    this.pairs.push({ source: this.pendingSource, dest: pos });
    this.pendingSource = undefined;
    ctx.used[name] = true;
    ctx.last = name;
    this.assumeOverride = undefined;
    this.namedThisRun.push(name);
    if (!isNull(di)) {
        di.setRelativeZero(pos);
    }
    EAction.handleUserMessage(
        qsTr("Station %1 placed at its plotted point").arg(name));
    this.setState(ScanAlign.State.SettingSourcePoint);
    return true;
};

ScanAlign.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    this.setCrosshairCursor();

    var station = this.pairs.length + 1;

    switch (this.state) {
    case ScanAlign.State.SelectingEntities:
        di.setClickMode(RAction.PickEntity);
        this.setCommandPrompt(qsTr("Click the image to align, then press Enter"));
        this.setLeftMouseTip(qsTr("Pick object"));
        this.setRightMouseTip(EAction.trCancel);
        break;

    case ScanAlign.State.SettingSourcePoint:
        di.setClickMode(RAction.PickCoordinate);
        this.setFreeSnap();

        var trStation = qsTr("Click STATION %1 on the image").arg(station);
        if (station === 2) {
            this.setCommandPrompt(trStation + " " + qsTr("(Enter to only move)"));
        }
        else if (station > 2) {
            this.setCommandPrompt(
                qsTr("Click STATION %1 on the image for a better fit").arg(station) +
                " " + qsTr("(Enter to finish)"));
        }
        else {
            this.setCommandPrompt(trStation);
        }

        this.setLeftMouseTip(qsTr("Station %1 on the image").arg(station));
        this.setRightMouseTip(station === 1 ? EAction.trCancel : EAction.trBack);
        EAction.showSnapTools();
        break;

    case ScanAlign.State.SettingDestPoint:
        di.setClickMode(RAction.PickCoordinate);
        this.setAutoSnap();
        // With a walk standing, ask -- but assume the next unentered
        // station. Assumptions only ever start once a first name has
        // been typed (the seed), so a manual-only alignment never sees
        // this prompt.
        var assumed = (this.stationCtx !== undefined &&
            this.stationCtx !== null) ? this.assumedStation() : null;
        if (assumed !== null) {
            this.setCommandPrompt(
                qsTr("STATION %1 = %2 -- Enter accepts, type another " +
                     "station name, or click in the drawing")
                    .arg(station).arg(assumed));
        } else {
            this.setCommandPrompt(
                qsTr("Click where STATION %1 goes in the drawing (or type its station name)")
                    .arg(station));
        }
        this.setLeftMouseTip(qsTr("Where station %1 goes").arg(station));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

/**
 * Switches snapping to "Free" for clicks on the image, which has no
 * geometry to snap to. Goes through the snap tool's own button where
 * possible, so the snap tool bar shows what is going on.
 */
ScanAlign.prototype.setFreeSnap = function() {
    this.setSnapTool("scripts/Snap/SnapFree/SnapFree.js", new RSnapFree());
};

/**
 * Switches snapping back to "Auto" for clicks in the drawing, so they
 * land exactly on existing stations and line ends.
 */
ScanAlign.prototype.setAutoSnap = function() {
    this.setSnapTool("scripts/Snap/SnapAuto/SnapAuto.js", new RSnapAuto());
};

ScanAlign.prototype.setSnapTool = function(scriptFile, snap) {
    var di = this.getDocumentInterface();
    if (isNull(di) || di.isSnapLocked()) {
        // the user locked the snap mode: leave their choice alone
        return;
    }

    var guiAction = RGuiAction.getByScriptFile(scriptFile);
    if (!isNull(guiAction)) {
        guiAction.slotTrigger();
    }
    di.setSnap(snap);
};

ScanAlign.prototype.escapeEvent = function() {
    switch (this.state) {
    case ScanAlign.State.SelectingEntities:
        this.deselectPicked();
        Transform.prototype.escapeEvent.call(this);
        break;

    case ScanAlign.State.SettingSourcePoint:
        if (this.pairs.length === 0) {
            this.deselectPicked();
            Transform.prototype.escapeEvent.call(this);
        }
        else {
            // step back over the station finished last, so it can be
            // clicked again:
            this.pairs.pop();
            this.setState(ScanAlign.State.SettingSourcePoint);
        }
        break;

    case ScanAlign.State.SettingDestPoint:
        this.pendingSource = undefined;
        this.setState(ScanAlign.State.SettingSourcePoint);
        break;
    }
};

/**
 * Enter: finish picking objects, or apply the fit made from the
 * stations picked so far.
 */
ScanAlign.prototype.enterEvent = function() {
    var di = this.getDocumentInterface();

    switch (this.state) {
    case ScanAlign.State.SelectingEntities:
        if (isNull(di) || !di.hasSelection()) {
            EAction.handleUserWarning(qsTr("Nothing picked yet -- click the image first"));
            return;
        }
        this.setState(ScanAlign.State.SettingSourcePoint);
        break;

    case ScanAlign.State.SettingSourcePoint:
        if (this.pairs.length === 0) {
            EAction.handleUserWarning(qsTr("Click a station on the image first"));
            return;
        }
        this.applyAlign();
        break;

    case ScanAlign.State.SettingDestPoint:
        // Enter accepts the standing assumption, when there is one.
        if (this.stationCtx !== undefined && this.stationCtx !== null) {
            var assumed = this.assumedStation();
            if (assumed !== null && this.acceptStation(assumed)) {
                return;
            }
        }
        EAction.handleUserWarning(
            qsTr("Click where that station goes in the drawing (or type its station name), or press Escape to take it back"));
        break;

    default:
        Transform.prototype.enterEvent.call(this);
        break;
    }
};

/**
 * Accepts "noscale" / "scale" typed at any prompt, to align without
 * resizing (for objects that are already at the right size).
 */
ScanAlign.prototype.commandEvent = function(event) {
    var cmd = event.getCommand().toLowerCase();

    // An EXACT station name wins over everything -- typed at the
    // target prompt it completes the pair at that station's plotted
    // point; typed at the image prompt it seeds or re-aims the next
    // assumption ("type it once, then auto-advance").
    if (cmd.length > 0 &&
            this.state !== ScanAlign.State.SelectingEntities) {
        var ctx = this.stationContext();
        if (ctx !== null) {
            var typedRaw = event.getCommand();
            var match = null;
            for (var name in ctx.plotted) {
                if (name === typedRaw || name.toLowerCase() === cmd) {
                    match = name;
                    if (name === typedRaw) { break; }
                }
            }
            if (match !== null) {
                if (this.state === ScanAlign.State.SettingDestPoint) {
                    if (ctx.used[match] === true) {
                        EAction.handleUserWarning(
                            qsTr("Station %1 already has a point on this scan").arg(match));
                        event.accept();
                        return;
                    }
                    if (this.acceptStation(match)) {
                        event.accept();
                        return;
                    }
                }
                else {
                    this.assumeOverride = match;
                    ctx.last = null;   // the override seeds the walk
                    EAction.handleUserMessage(
                        qsTr("Next station: %1").arg(match));
                    event.accept();
                    return;
                }
            }
        }
    }

    if (cmd.length > 0) {
        if (qsTr("noscale").startsWith(cmd)) {
            this.scale = false;
            EAction.handleUserMessage(qsTr("Resizing turned off: objects keep their current size"));
            event.accept();
            return;
        }
        if (qsTr("scale").startsWith(cmd)) {
            this.scale = true;
            EAction.handleUserMessage(qsTr("Resizing turned on: objects are resized to fit"));
            event.accept();
            return;
        }
    }

    Transform.prototype.commandEvent.call(this, event);
};

ScanAlign.prototype.pickEntity = function(event, preview) {
    if (this.state !== ScanAlign.State.SelectingEntities) {
        return;
    }

    var di = this.getDocumentInterface();
    var doc = this.getDocument();
    if (isNull(di) || isNull(doc)) {
        return;
    }

    var entityId = this.getEntityId(event, preview, true);

    // nothing hit: an image may still be under the cursor, since QCAD
    // only counts a hit near the image's border:
    if (entityId === RObject.INVALID_ID) {
        entityId = this.getImageIdAt(event.getModelPosition());
    }

    if (entityId === RObject.INVALID_ID) {
        if (preview) {
            di.clearPreview();
        }
        return;
    }

    var entity = doc.queryEntity(entityId);
    if (isNull(entity) || !this.isEntitySnappable(entity)) {
        return;
    }

    if (preview) {
        di.highlightEntity(entityId);
        return;
    }

    if (!EAction.assertEditable(entity, false)) {
        return;
    }

    if (entity.isSelected()) {
        // clicking a picked object again un-picks it
        di.deselectEntity(entityId);
        var at = this.pickedIds.indexOf(entityId);
        if (at !== -1) {
            this.pickedIds.splice(at, 1);
        }
    }
    else {
        di.selectEntity(entityId, true);
        this.pickedIds.push(entityId);
    }
};

/**
 * \return ID of the topmost image entity containing the given position,
 * or RObject.INVALID_ID if there is none.
 */
ScanAlign.prototype.getImageIdAt = function(pos) {
    var doc = this.getDocument();
    if (isNull(doc) || isNull(pos)) {
        return RObject.INVALID_ID;
    }

    var ids = doc.queryIntersectedEntitiesXY(new RBox(pos, pos));
    var found = RObject.INVALID_ID;

    for (var i = 0; i < ids.length; i++) {
        var entity = doc.queryEntity(ids[i]);
        if (isNull(entity) || !isImageEntity(entity)) {
            continue;
        }
        if (!this.isEntitySnappable(entity)) {
            continue;
        }
        // the search above works on bounding boxes: check the image's
        // real (possibly rotated) area:
        if (!ScanAlign.isPointInImage(entity, pos)) {
            continue;
        }
        // later entities are drawn on top of earlier ones:
        if (found === RObject.INVALID_ID || ids[i] > found) {
            found = ids[i];
        }
    }

    return found;
};

ScanAlign.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    var pos = event.getModelPosition();

    switch (this.state) {
    case ScanAlign.State.SettingSourcePoint:
        if (!preview) {
            this.pendingSource = pos;
            di.setRelativeZero(this.pendingSource);
            this.setState(ScanAlign.State.SettingDestPoint);
        }
        break;

    case ScanAlign.State.SettingDestPoint:
        if (isNull(this.pendingSource)) {
            return;
        }

        if (preview) {
            // show the fit this station would give, without keeping it:
            this.pairs.push({ source: this.pendingSource, dest: pos });
            this.updatePreview();
            this.pairs.pop();
        }
        else {
            this.pairs.push({ source: this.pendingSource, dest: pos });
            this.pendingSource = undefined;
            di.setRelativeZero(pos);
            this.setState(ScanAlign.State.SettingSourcePoint);
        }
        break;
    }
};

/**
 * Works out how to fit the stations picked so far.
 *
 * \return {type: "move"|"similarity"|"affine", params: ..., affine: ...,
 *          straightLine: Boolean} or undefined if there is nothing
 *         usable yet.
 *
 * 'params' is always present and describes the move / rotate / resize
 * to use for objects that cannot be warped. 'affine' is present only
 * for type "affine".
 */
ScanAlign.prototype.getFit = function() {
    var n = this.pairs.length;
    if (n === 0) {
        return undefined;
    }

    var first = this.pairs[0];

    // one station: move it onto its target, nothing else.
    if (n === 1) {
        var moveParams = ScanAlign.computeTransform(first.source, first.dest);
        if (isNull(moveParams)) {
            return undefined;
        }
        moveParams.center = first.source;
        return { type: "move", params: moveParams, straightLine: false };
    }

    // two stations: the exact move / rotate / resize through both.
    if (n === 2) {
        var second = this.pairs[1];
        var exact = ScanAlign.computeTransform(
            first.source, first.dest, second.source, second.dest, this.scale);
        if (isNull(exact)) {
            return undefined;
        }
        exact.center = first.source;
        return { type: "similarity", params: exact, straightLine: false };
    }

    // three or more: warp to fit, and keep the closest move / rotate /
    // resize as well, for objects that cannot be warped.
    var closest = ScanAlign.computeSimilarityFit(this.pairs);
    if (isNull(closest)) {
        return undefined;
    }

    var warp = ScanAlign.computeAffineFit(this.pairs);
    if (isNull(warp)) {
        // stations in a straight line: a warp cannot be worked out
        return { type: "similarity", params: closest, straightLine: true };
    }

    return { type: "affine", params: closest, affine: warp, straightLine: false };
};

/**
 * True when this tool may transform the entity at all.
 *
 * A PLAN WARP MUST NOT REACH THE ELEVATION. This tool fits a scanned
 * plan onto known stations: a move, a rotation, a resize, or a
 * three-station affine warp, all of them statements about EASTING AND
 * NORTHING. The elevation shares the drawing now, and its X axis is
 * distance along the passage while its Y is elevation -- rotating that
 * by the angle a scan happens to be off by produces geometry that
 * means nothing at all. There is no fit to apply and no correction to
 * make; the only right answer is to leave it where it is.
 *
 * Both halves of the profile frame are refused, generated and traced
 * alike: the generated half would be redrawn at the wrong place until
 * the next regeneration silently "fixed" it, and the traced half is the
 * user's own work, which nothing here may move.
 *
 * Defensive: a document or entity this cannot read answers TRUE, so an
 * unreadable layer name never silently drops a plan entity out of a
 * warp the user asked for.
 */
ScanAlign.appliesTo = function(doc, entity) {
    if (isNull(doc) || isNull(entity)) {
        return true;
    }
    var layerName;
    try {
        layerName = doc.getLayerName(entity.getLayerId());
    } catch (e) {
        return true;
    }
    return CsLayers.frameOf(layerName) !== "profile";
};

/**
 * Transforms one object. Called by Transform for every picked object.
 *
 * Transform (stock QCAD) owns the ONLY place entities are collected for
 * this tool: it walks the user's selection and calls this once per
 * entity. So this is also the only place a frame test can go, and one
 * test here covers every fit the tool can produce.
 */
ScanAlign.prototype.transform = function(entity, k, op, preview, flags) {
    var fit = this.getFit();
    if (isNull(fit)) {
        return;
    }

    // Not ours to move: return WITHOUT adding it to the operation, so
    // the entity is left exactly as it was rather than re-added
    // unchanged (which would still make it part of the undo step and
    // still mark the drawing modified).
    if (!ScanAlign.appliesTo(this.getDocument(), entity)) {
        return;
    }

    if (fit.type === "affine" && isImageEntity(entity)) {
        ScanAlign.applyAffineToImage(entity, fit.affine);
    }
    else {
        // objects that cannot be warped, and every object in a one or
        // two station fit:
        entity.rotate(fit.params.angle, fit.params.center);
        entity.scale(fit.params.factor, fit.params.center);
        entity.move(fit.params.offset);
    }

    op.addObject(entity, flags);
};

ScanAlign.prototype.getOperation = function(preview, selectResult) {
    if (isNull(this.getFit())) {
        return undefined;
    }

    var di = this.getDocumentInterface();
    if (isNull(di) || !di.hasSelection()) {
        return undefined;
    }

    return Transform.prototype.getOperation.call(this, preview, selectResult);
};

ScanAlign.prototype.getCopies = function() {
    // this tool always aligns the objects themselves, never a copy
    return 0;
};

/**
 * Aligns the objects, reports what was done, and ends the tool.
 */
ScanAlign.prototype.applyAlign = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        this.terminate();
        return;
    }

    var fit = this.getFit();
    if (isNull(fit)) {
        // reachable by clicking the same spot for every station
        EAction.handleUserWarning(
            qsTr("The stations on the image must be different points, and so must their targets"));
        return;
    }

    var op = this.getOperation(false, true);
    if (isNull(op)) {
        EAction.handleUserWarning(qsTr("Nothing to align"));
        this.terminate();
        return;
    }

    // Resolve the image BEFORE the transform applies -- the operation
    // can drop the selection, and the tag write below re-queries by id.
    var imageForTag = this.getSingleImage();

    di.applyOperation(op);
    this.recordAssignedStations(di,
        isNull(imageForTag) ? RObject.INVALID_ID : imageForTag.getId());
    this.reportResult(fit);
    this.terminate();
};

/**
 * Unions the stations name-resolved this run into the scan's
 * AlignedStations tag, so a later session resumes the walk past them
 * ("the next station WITHOUT an assigned point on the survey scan").
 * Only an aligned image is tagged -- aligning plain linework leaves no
 * record. A separate small operation AFTER the transform: the
 * transform op came from stock Transform machinery, and the tag write
 * must not depend on its internals.
 */
ScanAlign.prototype.recordAssignedStations = function(di, imageId) {
    if (this.namedThisRun.length === 0 ||
            imageId === RObject.INVALID_ID) {
        return;
    }
    try {
        var image = this.getDocument().queryEntity(imageId);
        if (isNull(image)) {
            return;
        }
        var names = CsStationOrder.parseAssigned(
            CsTags.get(image, CsStationOrder.TAG));
        var seen = {};
        var i;
        for (i = 0; i < names.length; i++) {
            seen[names[i]] = true;
        }
        for (i = 0; i < this.namedThisRun.length; i++) {
            if (seen[this.namedThisRun[i]] !== true) {
                seen[this.namedThisRun[i]] = true;
                names.push(this.namedThisRun[i]);
            }
        }
        CsTags.set(image, CsStationOrder.TAG,
            CsStationOrder.serializeAssigned(names));
        var op = new RModifyObjectsOperation();
        op.setText("Record aligned stations");
        // false: keeps the entity on the layer it is already on
        op.addObject(image, false);
        di.applyOperation(op);
    } catch (e) {
        // the alignment itself succeeded; losing the record only means
        // the walk offers those stations again next time
    }
};

/**
 * Reports what the fit did, in the drawing's own units.
 */
ScanAlign.prototype.reportResult = function(fit) {
    var msg;
    var count = this.pairs.length;

    if (fit.type === "affine") {
        var residuals = ScanAlign.getResiduals(this.pairs, function(p) {
            return ScanAlign.applyAffine(fit.affine, p);
        });

        msg = qsTr("Warped to fit %1 stations").arg(count);

        // with exactly three stations the fit is exact, so there is no
        // miss worth reporting:
        if (count > 3) {
            msg += ": " + qsTr("average miss") + " " + residuals.average.toFixed(4) +
                ", " + qsTr("worst") + " " + residuals.worst.toFixed(4) +
                " " + qsTr("at station %1").arg(residuals.worstStation);
        }

        var shape = this.getImageShape();
        if (!isNull(shape)) {
            msg += ", " + qsTr("image scale") + " " +
                shape.across.toFixed(6) + " " + String.fromCharCode(0xd7) + " " +
                shape.down.toFixed(6) + " " + qsTr("units per pixel") +
                ", " + qsTr("skew") + " " + shape.skew.toFixed(3) +
                String.fromCharCode(0xb0);
        }

        if (this.hasNonImageEntities()) {
            msg += ". " + qsTr("Objects other than images cannot be warped: those were moved, rotated and resized to fit as closely as they can");
        }
    }
    else {
        var degrees = RMath.rad2deg(ScanAlign.normalizeAngle(fit.params.angle));

        msg = (fit.type === "move" ? qsTr("Moved") : qsTr("Aligned")) + ": " +
            qsTr("rotated") + " " + degrees.toFixed(4) + String.fromCharCode(0xb0) + ", " +
            qsTr("resized by") + " " + fit.params.factor.toFixed(6);

        if (count > 2) {
            var simResiduals = ScanAlign.getResiduals(this.pairs, function(p) {
                return ScanAlign.transformPoint(fit.params, fit.params.center, p);
            });
            msg += ", " + qsTr("average miss") + " " + simResiduals.average.toFixed(4) +
                ", " + qsTr("worst") + " " + simResiduals.worst.toFixed(4) +
                " " + qsTr("at station %1").arg(simResiduals.worstStation);
        }

        var resolution = this.getImageShape();
        if (!isNull(resolution)) {
            msg += ", " + qsTr("image scale") + " " + resolution.across.toFixed(6) + " " +
                qsTr("units per pixel");
        }

        if (fit.straightLine) {
            msg += ". " + qsTr("The stations are in a straight line, so no warp could be worked out from them -- fitted without warping instead");
        }
    }

    EAction.handleUserMessage(msg);
};

/**
 * \return {across, down, skew} of the aligned image -- drawing units
 * per pixel across and down the picture, and how far from square the
 * picture now is, in degrees. undefined unless exactly one image is
 * selected.
 */
ScanAlign.prototype.getImageShape = function() {
    var image = this.getSingleImage();
    if (isNull(image)) {
        return undefined;
    }

    var u = image.getUVector();
    var v = image.getVVector();

    // how far the two directions are from being at right angles:
    var between = RMath.rad2deg(RMath.getNormalizedAngle(v.getAngle() - u.getAngle()));
    var skew = between - 90.0;

    return {
        across: u.getMagnitude(),
        down: v.getMagnitude(),
        skew: skew
    };
};

/**
 * \return the selected image entity if exactly one image is selected,
 * otherwise undefined.
 */
ScanAlign.prototype.getSingleImage = function() {
    var doc = this.getDocument();
    if (isNull(doc)) {
        return undefined;
    }

    var ids = doc.querySelectedEntities();
    var image = undefined;

    for (var i = 0; i < ids.length; i++) {
        var entity = doc.queryEntity(ids[i]);
        if (isNull(entity) || !isImageEntity(entity)) {
            continue;
        }
        if (!isNull(image)) {
            // more than one image: no single scale to report
            return undefined;
        }
        image = entity;
    }

    return image;
};

/**
 * \return true if anything other than an image is selected -- those
 * objects cannot be warped.
 */
ScanAlign.prototype.hasNonImageEntities = function() {
    var doc = this.getDocument();
    if (isNull(doc)) {
        return false;
    }

    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var entity = doc.queryEntity(ids[i]);
        if (!isNull(entity) && !isImageEntity(entity)) {
            return true;
        }
    }

    return false;
};

/**
 * Un-picks objects this tool picked itself, so cancelling leaves the
 * drawing's selection as it was found.
 */
ScanAlign.prototype.deselectPicked = function() {
    var di = this.getDocumentInterface();
    if (isNull(di) || this.hadSelection || this.pickedIds.length === 0) {
        return;
    }
    di.deselectEntities(this.pickedIds);
    this.pickedIds = [];
};

/** Where this file was installed, so getByScriptFile can find it. */
ScanAlign.scriptPath = "";

/**
 * Registers the align action WITHOUT a menu entry, a toolbar entry or a
 * command name.
 *
 * It needs to be a registered RGuiAction all the same: the interactive
 * class is a Transform/EAction, and it wants the RGuiAction that owns
 * its script file. Leaving out setWidgetNames, setDefaultCommands and
 * setIcon is what keeps it off the menu, out of the command line and
 * off the toolbar, which is the whole point of the merge -- reachable
 * only from the Sketch Scans panel, exactly as SectionCapture's own
 * merge into Cross Section did this first.
 *
 * Called by SketchScans.init, not by the add-on's own sibling sweep:
 * this file no longer belongs to a tool of its own.
 */
ScanAlign.init = function(basePath) {
    ScanAlign.scriptPath = basePath + "/ScanAlign.js";
    var action = new RGuiAction(qsTr("Align Scan"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(ScanAlign.scriptPath);
};
