// CsSketchDraw.js -- putting a placed Therion scrap into the drawing.
//
// Part of the Cave Survey Core library, and the first file of this
// group that touches a document: CsTherion2 reads, CsSketch decides,
// CsSketchPlace positions, and this writes. Tested by
// tests/sketch_import_run.js inside CaveCAD's own engine rather than by
// js_unit.js, for the ordinary reason -- everything here needs a real
// document and a real document interface.
//
// IT WRITES THROUGH THE SAME DOORS A CAVER'S OWN HAND DOES. Not out of
// tidiness: an imported wall has to BE a traced wall, or the claim that
// a scrap arrives as real map ink is false in every way that matters
// later. So a line goes in through CsTrace.addCurve, a shaped line is
// dressed by CsShapeLine.dress, an area is written by CsArea.create and
// a symbol placed by CsSymbols.insert -- the same functions Feature
// Trace, Shaped Lines, Area Fill and the Symbol Palette call. What
// comes out extends, regenerates, reflows, joins a legend and lands on
// a sheet exactly as hand-drawn work does, because it went in the same
// way.
//
// THE ONE DIVERGENCE, and it is deliberate: the resample-and-reduce
// step at the TOP of CsTrace.emit is skipped. That step exists to thin
// a caver's freehand drag to one control point per foot of cave; a
// scrap's geometry is already exact, evaluated off its own cubics at a
// stated tolerance by CsSketchPlace.flatten. Putting it through the
// thinner would take a clean vector sketch and coarsen it, which is
// the opposite of why anyone would import one.
//
// EVERY ENTITY IS STAMPED with the file, the scrap and its index in
// that scrap. Not decoration: it is what lets a re-import find what it
// already put here and ASK before replacing it, rather than either
// silently overwriting a caver's evening or leaving two of everything.
// See CsSketchStore, which owns the reading half of these tags.

var CsSketchDraw = {};

CsSketchDraw.KEY = {
    // The file's own base name, not its path: a cave folder moves
    // between machines and a sync drive, and a path recorded here
    // would stop matching the first time it did.
    FILE: "ScrapFile",
    SCRAP: "ScrapName",
    // Position within the scrap, per kind: "line:3", "point:11",
    // "area:0". Stable across re-exports as long as the sketcher has
    // not reordered their drawing, which is what makes a re-import
    // able to say "this is the same object, drawn again".
    INDEX: "ScrapIndex",
    // The Therion type it arrived as, kept verbatim. The mapping may
    // change between releases -- a "continuation" will stop being a
    // NOTES-DIG marker the day leads get a tool -- and a re-import
    // then has to know what the thing WAS, not what this release
    // decided to draw it as.
    TYPE: "ScrapType"
};

/**
 * Stamps one entity with where it came from.
 *
 * Sets tags on the object in hand; the caller commits them with the
 * operation that adds or modifies it, which is the idiom CsDraw.addLine
 * and CsTags.commit both keep.
 */
CsSketchDraw.stamp = function(entity, file, scrapName, index, type) {
    if (isNull(entity)) {
        return;
    }
    CsTags.set(entity, CsSketchDraw.KEY.FILE, file);
    CsTags.set(entity, CsSketchDraw.KEY.SCRAP, scrapName);
    CsTags.set(entity, CsSketchDraw.KEY.INDEX, index);
    CsTags.set(entity, CsSketchDraw.KEY.TYPE, type);
};

/**
 * Stamps an entity already in the document, by id.
 *
 * The add-then-tag path: CsTrace.addCurve and CsSymbols.insert both
 * put the entity in before the caller can reach it, and this build
 * assigns the real id inside applyOperation.
 *
 * \return true when the stamp reached the document.
 */
CsSketchDraw.stampById = function(doc, di, id, file, scrapName, index, type,
        group) {
    if (isNull(doc) || isNull(di) || isNull(id)) {
        return false;
    }
    var entity = doc.queryEntity(id);
    if (isNull(entity)) {
        return false;
    }
    CsSketchDraw.stamp(entity, file, scrapName, index, type);
    var op = new RModifyObjectsOperation();
    op.addObject(entity, false);
    if (group !== null && group !== undefined && group >= 0) {
        op.setTransactionGroup(group);
    }
    di.applyOperation(op);
    return true;
};

/**
 * A fresh counting report.
 *
 * Counts rather than a running total, because the sentence a caver
 * needs is "forty walls, nine symbols, two areas -- and four things I
 * did not recognise", and a single number would hide the last clause.
 */
CsSketchDraw.newReport = function() {
    return { lines: 0, shapes: 0, areas: 0, symbols: 0, texts: 0,
        marks: 0, callouts: 0, skipped: 0, failed: 0,
        unknown: [], warnings: [] };
};

/**
 * Notes an unrecognised Therion type, once per type.
 *
 * Once, because a sketch with three hundred "u:bolt-hanger" points has
 * one thing to tell a caver, not three hundred -- the same rule
 * CsModel.addParseFinding keeps, and the same rule Check Map keeps
 * when it caps a repeated finding.
 */
CsSketchDraw.noteUnknown = function(report, type) {
    if (type === undefined || type === null || type === "") {
        return;
    }
    for (var i = 0; i < report.unknown.length; i++) {
        if (report.unknown[i] === type) {
            return;
        }
    }
    report.unknown.push(type);
};

/**
 * A spline through points, for the importer's own use.
 *
 * Interpolating first and approximating as the fallback, which is
 * CsTrace.emit's own order and for its own measured reason: the
 * interpolating fit passes through every point by construction, and
 * these points are ON the curve the sketcher drew. Falling back
 * matters -- interpolation returns null for fewer than four points,
 * and a two-point wall is an ordinary thing for a sketch to contain.
 *
 * \return an RSpline entity, or null when the points cannot make one.
 */
CsSketchDraw.curveThrough = function(doc, points) {
    if (isNull(doc) || points === null || points.length < 2) {
        return null;
    }
    var spline = CsTrace.interpolatingSpline(doc, points);
    if (spline === null) {
        spline = CsTrace.fitSpline(doc, points);
    }
    return spline;
};

/**
 * The layer a plan layer name becomes in THIS scrap's frame.
 *
 * Every layer this file writes to goes through here, so the whole of
 * it stays frame-agnostic: a plan scrap keeps the plan names, and an
 * extended scrap gets the PROFILE- twins through CsLayers.twinFor.
 *
 * A twin that does not exist (twinFor answers null for a layer the
 * registry has no frame version of -- a sheet layer, a NO_TWIN entry)
 * falls back to the plan name rather than dropping the entity. That is
 * the lesser wrong: a mark on the plan layer is visible and can be
 * moved, and a mark that was never drawn cannot.
 */
CsSketchDraw.layer = function(ctx, planLayer) {
    if (ctx.layerFor === null || ctx.layerFor === undefined) {
        return planLayer;
    }
    var twin = ctx.layerFor(planLayer);
    return (twin === null || twin === undefined || twin === "") ?
        planLayer : twin;
};

/**
 * Draws one line from a scrap.
 *
 * \return the entity id that landed, or null.
 */
CsSketchDraw.line = function(doc, di, ctx, line, index) {
    var resolved = CsSketch.resolveLine(line);
    var action = resolved.action;
    if (!resolved.known) {
        CsSketchDraw.noteUnknown(ctx.report, line.type);
    }
    if (action.kind === "skip") {
        ctx.report.skipped++;
        return null;
    }

    var placed = CsSketchPlace.path(ctx.solution, line.segs);
    var points = CsSketchPlace.flatten(placed, ctx.flatness);
    if (points.length < 2) {
        ctx.report.failed++;
        return null;
    }
    // A CLOSED LINE IS CLOSED HERE, not left to the entity. Therion's
    // -close on means the last point joins the first, and a spline
    // through points has no notion of that -- so the first point is
    // repeated at the end, which is what every closed feature in this
    // suite already looks like.
    if (line.closed === true) {
        var first = points[0], last = points[points.length - 1];
        if (Math.abs(first.x - last.x) > 1e-9 ||
                Math.abs(first.y - last.y) > 1e-9) {
            points.push({ x: first.x, y: first.y });
        }
    }

    var isShape = (action.kind === "shape");
    var spec = isShape ? CsShapeLine.STYLES[action.style] : null;
    var layerName = CsSketchDraw.layer(ctx,
        isShape ? spec.spineLayer : action.layer);

    var spline = CsSketchDraw.curveThrough(doc, points);
    if (spline === null) {
        ctx.report.failed++;
        return null;
    }

    var landed = CsTrace.addCurve(doc, di, layerName, spline, ctx.group);
    if (!landed.added || isNull(landed.id)) {
        ctx.report.failed++;
        return null;
    }

    CsSketchDraw.stampById(doc, di, landed.id, ctx.file, ctx.scrapName,
        "line:" + index, line.type, ctx.group);

    if (isShape) {
        var entity = doc.queryEntity(landed.id);
        var dressed = !isNull(entity) && CsShapeLine.dress(doc, di, entity,
            { styleKey: action.style, side: 1, scale: 1, symbol: "" },
            ctx.group === undefined ? -1 : ctx.group);
        if (dressed) {
            ctx.report.shapes++;
        } else {
            // The spine is IN the drawing and tagged; only its
            // ornament failed. Counted as a line rather than lost,
            // and Shaped Lines' own Sync can dress it later.
            ctx.report.lines++;
            ctx.report.warnings.push("A " + line.type + " came in as a " +
                "plain line: its symbology could not be generated. " +
                "Shaped Lines > Sync will try again.");
        }
    } else {
        ctx.report.lines++;
    }
    return landed.id;
};

/**
 * Draws one point from a scrap.
 */
CsSketchDraw.point = function(doc, di, ctx, point, index) {
    var resolved = CsSketch.resolvePoint(point);
    var action = resolved.action;
    if (!resolved.known) {
        CsSketchDraw.noteUnknown(ctx.report, point.type);
    }
    if (action.kind === "skip") {
        ctx.report.skipped++;
        return null;
    }

    var pos = CsSketchPlace.at(ctx.solution, point.x, point.y);
    if (pos === null) {
        ctx.report.failed++;
        return null;
    }
    var at = new RVector(pos.x, pos.y);
    var tagIndex = "point:" + index;

    if (action.kind === "symbol") {
        return CsSketchDraw.symbol(doc, di, ctx, point, action, at,
            tagIndex);
    }

    // Text, a callout's note, and a bare marker all end up as one
    // entity in the drawing; which one is a question about what the
    // thing MEANS, and that has already been answered by the mapping.
    if (action.kind === "text" || action.kind === "callout") {
        var words = point.text;
        if (words === null || words === "") {
            // A label with nothing written on it is not a label. It
            // happens: a sketcher drops the marker and never types the
            // caption. Counted as a mark so the total still adds up.
            return CsSketchDraw.mark(doc, di, ctx, point, action, at,
                tagIndex);
        }
        var layerName = CsSketchDraw.layer(ctx,
            (action.kind === "callout") ? CsLayers.NOTES_ELEVATION :
                action.layer);
        var op = new RAddObjectsOperation();
        if (ctx.group !== undefined && ctx.group >= 0) {
            op.setTransactionGroup(ctx.group);
        }
        CsLayers.ensure(doc, di, layerName);
        var text = CsDraw.addText(doc, op, layerName, words, at,
            RS.HAlignLeft);
        CsSketchDraw.stamp(text, ctx.file, ctx.scrapName, tagIndex,
            point.type);
        CsLayers.withLayerOn(doc, di, layerName, function() {
            di.applyOperation(op);
        });
        if (action.kind === "callout") {
            ctx.report.callouts++;
        } else {
            ctx.report.texts++;
        }
        return true;
    }

    return CsSketchDraw.mark(doc, di, ctx, point, action, at, tagIndex);
};

/**
 * One catalogue symbol, aimed and sized the way the scrap asked.
 */
CsSketchDraw.symbol = function(doc, di, ctx, point, action, at, tagIndex) {
    var entry = CsSymbols.byBlock(action.block);
    if (isNull(entry)) {
        ctx.report.failed++;
        return null;
    }
    var size = CsSketch.pointScale(point.scale) *
        CsSketchPlace.scaleOf(ctx.solution.matrix);
    var bearing = CsSketchPlace.orientation(ctx.solution.matrix,
        point.orientation);
    // CsSymbols.insert takes a rotation in radians, measured the way
    // the drawing measures angles; a bearing is clockwise from north.
    var rotation = (90 - bearing) * Math.PI / 180;

    var layerName = CsSketchDraw.layer(ctx, entry.layer);
    CsLayers.ensure(doc, di, layerName);

    // CsSymbols.insert BUILDS the reference and leaves adding it to the
    // caller -- it returns an entity whose getId() is -1, because this
    // build assigns ids inside applyOperation. That is the better path
    // here anyway: the scrap stamp goes on BEFORE the add, so the tags
    // and the entity land in one operation and there is no id to look
    // up afterwards. (Reaching for placed.getId() and modifying by id
    // was tried first and wrote nothing at all -- the symbols were in
    // the drawing carrying no scrap tags, which a re-import would have
    // read as "nothing of mine is here" and then drawn a second set on
    // top of.)
    var ref = CsSymbols.insert(doc, entry, at, size, rotation, layerName,
        di);
    if (isNull(ref)) {
        ctx.report.failed++;
        ctx.report.warnings.push("This drawing has no " + entry.block +
            " block, so the " + point.type + " symbols in the sketch " +
            "were not placed. It was not started from the NSS template.");
        return null;
    }
    CsSketchDraw.stamp(ref, ctx.file, ctx.scrapName, tagIndex, point.type);

    var op = new RAddObjectsOperation();
    if (ctx.group !== undefined && ctx.group >= 0) {
        op.setTransactionGroup(ctx.group);
    }
    op.addObject(ref, false);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        di.applyOperation(op);
    });
    ctx.report.symbols++;
    return true;
};

/**
 * A bare marker: something the sketch put here that this suite draws
 * as a place rather than as a picture.
 */
CsSketchDraw.mark = function(doc, di, ctx, point, action, at, tagIndex) {
    var layerName = CsSketchDraw.layer(ctx, action.layer);
    CsLayers.ensure(doc, di, layerName);
    var op = new RAddObjectsOperation();
    if (ctx.group !== undefined && ctx.group >= 0) {
        op.setTransactionGroup(ctx.group);
    }
    var entity = CsDraw.addPoint(doc, op, layerName, at);
    CsSketchDraw.stamp(entity, ctx.file, ctx.scrapName, tagIndex,
        point.type);
    op.addObject(entity, false);
    CsLayers.withLayerOn(doc, di, layerName, function() {
        di.applyOperation(op);
    });
    ctx.report.marks++;
    return true;
};

/**
 * One area: its boundary from the lines it claims, and its fill.
 *
 * THE BOUNDARY IS BUILT FROM THE LINES, not drawn separately. A
 * Therion area is a list of border-line ids, and those lines are
 * already in the scrap -- so the vertices come from them, joined in
 * the order the area lists them, and the border lines themselves are
 * not drawn on their own (CsSketch.borderIds is what tells the line
 * loop to leave them alone). Drawing both would put a line on top of
 * every area edge, which is exactly the duplicate a caver would then
 * spend an evening selecting out.
 */
CsSketchDraw.area = function(doc, di, ctx, area, index) {
    var resolved = CsSketch.resolveArea(area);
    var action = resolved.action;
    if (!resolved.known) {
        CsSketchDraw.noteUnknown(ctx.report, area.type);
    }
    if (action.kind !== "area") {
        // An unrecognised area type still has a boundary worth
        // keeping: it lands as a plain closed line on the catch-all
        // layer rather than as a fill nobody can name.
        return CsSketchDraw.areaOutline(doc, di, ctx, area, index, action);
    }

    var verts = CsSketchDraw.areaVerts(ctx, area);
    if (verts.length < 3) {
        ctx.report.failed++;
        return null;
    }
    var entry = CsArea.entryFor(action.pattern);
    if (isNull(entry)) {
        ctx.report.failed++;
        return null;
    }
    var made = CsArea.create(doc, di, entry, action.pattern, verts,
        { scale: 1, density: null, trip: ctx.trip });
    if (!made.ok) {
        ctx.report.failed++;
        if (!isNull(made.reason) && made.reason !== "") {
            ctx.report.warnings.push("An area of " + area.type +
                " was not filled: " + made.reason);
        }
        return null;
    }
    ctx.report.areas++;
    return made.id;
};

/**
 * The boundary of an area, in drawing coordinates.
 *
 * Joins the lines the area names, in the order it names them, dropping
 * a repeated joint where one line ends where the next begins.
 */
CsSketchDraw.areaVerts = function(ctx, area) {
    var verts = [];
    for (var i = 0; i < area.lineIds.length; i++) {
        var line = ctx.linesById[area.lineIds[i]];
        if (line === undefined) {
            continue;
        }
        var placed = CsSketchPlace.path(ctx.solution, line.segs);
        var points = CsSketchPlace.flatten(placed, ctx.flatness);
        for (var j = 0; j < points.length; j++) {
            var previous = verts.length > 0 ? verts[verts.length - 1] : null;
            if (previous !== null &&
                    Math.abs(previous.x - points[j].x) < 1e-9 &&
                    Math.abs(previous.y - points[j].y) < 1e-9) {
                continue;
            }
            verts.push(points[j]);
        }
    }
    return verts;
};

/**
 * An unrecognised area's boundary, kept as a plain closed line.
 */
CsSketchDraw.areaOutline = function(doc, di, ctx, area, index, action) {
    var verts = CsSketchDraw.areaVerts(ctx, area);
    if (verts.length < 3) {
        ctx.report.failed++;
        return null;
    }
    verts.push({ x: verts[0].x, y: verts[0].y });
    var spline = CsSketchDraw.curveThrough(doc, verts);
    if (spline === null) {
        ctx.report.failed++;
        return null;
    }
    var landed = CsTrace.addCurve(doc, di,
        CsSketchDraw.layer(ctx, action.layer), spline, ctx.group);
    if (!landed.added || isNull(landed.id)) {
        ctx.report.failed++;
        return null;
    }
    CsSketchDraw.stampById(doc, di, landed.id, ctx.file, ctx.scrapName,
        "area:" + index, area.type, ctx.group);
    ctx.report.lines++;
    return landed.id;
};

/**
 * Draws one placed scrap.
 *
 * \param scrap a scrap from the CsTherion2 model.
 * \param solution the answer from CsSketchPlace.solve.
 * \param opts {file, group, trip, flatness, layerFor} -- layerFor is
 *        an optional function mapping a plan layer name onto the
 *        frame's own (the profile and section twins), so this whole
 *        file stays frame-agnostic.
 * \return the report.
 */
CsSketchDraw.scrap = function(doc, di, scrap, solution, opts) {
    var report = CsSketchDraw.newReport();
    if (isNull(doc) || isNull(di) || scrap === null ||
            solution === null || !solution.ok) {
        return report;
    }
    var o = (opts === undefined || opts === null) ? {} : opts;
    var ctx = {
        report: report, solution: solution, scrapName: scrap.name,
        file: o.file === undefined ? "" : o.file,
        group: o.group === undefined ? -1 : o.group,
        trip: o.trip === undefined ? null : o.trip,
        flatness: o.flatness === undefined ? null : o.flatness,
        layerFor: o.layerFor === undefined ? null : o.layerFor,
        linesById: {}
    };
    for (var w = 0; w < solution.warnings.length; w++) {
        report.warnings.push(solution.warnings[w]);
    }

    var i;
    for (i = 0; i < scrap.lines.length; i++) {
        if (scrap.lines[i].id !== null) {
            ctx.linesById[scrap.lines[i].id] = scrap.lines[i];
        }
    }
    var claimed = CsSketch.borderIds(scrap);

    // AREAS FIRST, and the order is not arbitrary: an area's fill is
    // scattered or hatched INSIDE its boundary, and Area Fill's own
    // listener reacts to boundaries appearing. Drawing the walls first
    // and the areas after would be the same picture, but a fill
    // rebuilt later reads the drawing around it, and doing the big
    // regenerating writes before the small ones keeps every one of
    // them inside this scrap's own undo step.
    for (i = 0; i < scrap.areas.length; i++) {
        CsSketchDraw.area(doc, di, ctx, scrap.areas[i], i);
    }
    for (i = 0; i < scrap.lines.length; i++) {
        var line = scrap.lines[i];
        if (line.id !== null && claimed[line.id] === true) {
            // Its area drew it. See CsSketchDraw.area's header.
            continue;
        }
        CsSketchDraw.line(doc, di, ctx, line, i);
    }
    for (i = 0; i < scrap.points.length; i++) {
        CsSketchDraw.point(doc, di, ctx, scrap.points[i], i);
    }

    return report;
};

// ---------------------------------------------------------------------
// A whole file.
// ---------------------------------------------------------------------

/**
 * Which projections this release can place, and where a scrap of each
 * one ends up.
 *
 * A scrap whose projection is not here is REPORTED BY NAME and left
 * alone -- never placed "somewhere reasonable". A sketch silently
 * landing half its pages in the wrong view is the failure a caver
 * would find weeks later, with no way to tell which half.
 */
CsSketchDraw.PLACES = {
    "plan": "the plan",
    "extended": "the extended elevation",
    "none": "a cross section"
};

/**
 * Reads one .th2 and draws every scrap in it that can be placed.
 *
 * \param path the .th2 file.
 * \param opts {group, decide} -- decide is called as
 *        decide(scrapName, alreadyHere) for a scrap this drawing
 *        already holds, and answers "replace", "skip" or "cancel".
 *        Without it a scrap already present is SKIPPED, never
 *        replaced: silence is not consent to overwrite somebody's
 *        evening.
 * \return {ok, findings, scraps: [{name, projection, placed, report,
 *          reason}], totals}
 */
CsSketchDraw.fromFile = function(doc, di, path, opts) {
    var o = (opts === undefined || opts === null) ? {} : opts;
    var out = { ok: false, findings: [], scraps: [],
        totals: CsSketchDraw.newReport(), cancelled: false };
    if (isNull(doc) || isNull(di)) {
        return out;
    }

    var file = new QFile(String(path));
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        out.findings.push({ severity: "error", code: "th2-unreadable",
            message: "Could not open " + path });
        return out;
    }
    var content = new QTextStream(file).readAll();
    file.close();

    var model = CsTherion2.parse(content);
    out.findings = model.findings;
    var name = CsSketchStore.nameOf(path);
    var present = CsSketchStore.present(doc);
    var targets = CsSketchStore.planTargets(doc);

    for (var i = 0; i < model.scraps.length; i++) {
        var scrap = model.scraps[i];
        var row = { name: scrap.name, projection: scrap.projection,
            placed: false, report: null, reason: "" };
        out.scraps.push(row);

        if (scrap.projection === null ||
                CsSketchDraw.PLACES[scrap.projection] === undefined) {
            row.reason = "its projection is not one this release places";
            continue;
        }
        if (scrap.projection === "none") {
            row.reason = "it is a cross section, which this release " +
                "does not place yet";
            continue;
        }

        var key = CsSketchStore.keyFor(name, scrap.name);
        if (present[key] !== undefined) {
            var answer = (o.decide === undefined || o.decide === null) ?
                "skip" : o.decide(scrap.name, present[key]);
            if (answer === "cancel") {
                out.cancelled = true;
                return out;
            }
            if (answer !== "replace") {
                row.reason = "it is already in this drawing (" +
                    present[key] + " entities), and was left alone";
                continue;
            }
            CsSketchStore.remove(doc, di,
                CsSketchStore.idsOf(doc, name, scrap.name), o.group);
        }

        // WHICH STATIONS, AND ON WHICH LAYERS, is the whole of the
        // difference between a plan scrap and an extended one. The
        // plan's stations are where they are on the map; an extended
        // scrap's are in a profile BAND, one per survey run, and its
        // ink belongs on the PROFILE- twins. Everything after this is
        // identical, which is why CsSketchDraw takes a layerFor hook
        // rather than knowing about frames.
        var scrapTargets = targets;
        var layerFor = null;
        if (scrap.projection === "extended") {
            var band = CsSketchStore.profileTargets(doc, scrap);
            if (band.runKey === null) {
                row.reason = "the extended elevation in this drawing " +
                    "holds none of the stations this page is drawn " +
                    "against -- generate the profile first";
                out.totals.warnings.push("Scrap \"" + scrap.name +
                    "\": " + row.reason);
                continue;
            }
            scrapTargets = band.targets;
            layerFor = function(planLayer) {
                return CsLayers.twinFor(planLayer, "profile");
            };
            if (band.runs > 1) {
                out.totals.warnings.push("Scrap \"" + scrap.name +
                    "\" marks stations in " + band.runs + " survey " +
                    "runs; it was drawn into " + band.runKey +
                    ", which holds most of them.");
            }
        }

        var solution = CsSketchPlace.solve(scrap, scrapTargets,
            { scaleFactor: CsSketchStore.scaleFactor(doc, scrap) });
        if (!solution.ok) {
            row.reason = solution.warnings.length > 0 ?
                solution.warnings[solution.warnings.length - 1] :
                "it could not be placed";
            out.totals.warnings.push("Scrap \"" + scrap.name + "\": " +
                row.reason);
            continue;
        }

        row.report = CsSketchDraw.scrap(doc, di, scrap, solution,
            { file: name, group: o.group, layerFor: layerFor });
        row.placed = true;
        CsSketchDraw.addTo(out.totals, row.report);
    }

    out.ok = true;
    return out;
};

/**
 * Folds one scrap's report into a running total.
 */
CsSketchDraw.addTo = function(total, one) {
    if (one === null || one === undefined) {
        return;
    }
    var counted = ["lines", "shapes", "areas", "symbols", "texts",
        "marks", "callouts", "skipped", "failed"];
    for (var i = 0; i < counted.length; i++) {
        total[counted[i]] += one[counted[i]];
    }
    for (var u = 0; u < one.unknown.length; u++) {
        CsSketchDraw.noteUnknown(total, one.unknown[u]);
    }
    for (var w = 0; w < one.warnings.length; w++) {
        total.warnings.push(one.warnings[w]);
    }
};
