// Cave3D.js
//
// QCAD add-on tool: look at the surveyed passage in three dimensions.
//
//   Cave Survey > 3D View   (or type "cave3d" / "c3")
//
// A DOCKED PANEL, not a separate window. The caver is comparing this
// against the map, and two top-level windows have to be arranged by
// hand and re-arranged after every application switch. Docked, the 3D
// view sits beside the drawing with every other panel in the suite --
// and QDockWidget still lets anyone who wants it tear the panel off and
// float it.
//
// WHY. Every other view this suite draws is flat by construction -- the
// plan looks down, the extended elevation looks sideways, a cross
// section looks along. Each is a projection chosen to be drawn on
// paper, and each throws away the axis it is not about. A caver reading
// them has to hold the third dimension in their head, and a passage
// that climbs while it turns is exactly where that fails.
//
// So this draws none of them. It takes the same survey those views are
// projections OF, and shows it whole.
//
// NOTHING HERE DRAWS INTO THE DRAWING. The panel is a view, not a
// tool: it adds no entity, writes no tag, and a drawing that has been
// looked at in 3D is byte-identical to one that has not.
//
// THE GEOMETRY IS THE DRAWING'S OWN. The stations are resolved through
// CsAdjust.resolveAndAdjust with the anchor, datum and adjustment
// settings the drawing itself records -- the same call CsRebuild.redraw
// makes. A second, simpler resolve here would put the passage somewhere
// the map does not agree with, and the disagreement would be invisible
// until somebody measured it.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function Cave3D(guiAction) {
    EAction.call(this, guiAction);
}

Cave3D.prototype = new EAction();

/** The handle of the panel this session has open, or null. */
Cave3D.handle = null;

/**
 * The colour modes, in the order they appear in the dropdown.
 *
 * The keys are CsMesh3d colorBy values EXACTLY. One list, so a mode
 * cannot be offered here that the mesh does not implement -- and a
 * typo shows up as a missing entry rather than as a silent fallback to
 * trip colouring that looks like it worked.
 */
Cave3D.MODES = [
    { key: "trip",     label: qsTr("Trip") },
    { key: "depth",    label: qsTr("Depth") },
    { key: "distance", label: qsTr("Distance in") },
    { key: "size",     label: qsTr("Passage size") },
    { key: "date",     label: qsTr("Survey date") },
    { key: "closure",  label: qsTr("Closure shift") },
    { key: "splay",    label: qsTr("Splay coverage") },
    // LAST, and the only one that needs something outside the survey:
    // without a 3DEP grid and a datum anchor beside the drawing it
    // draws the cave in its unknown grey and the status line says
    // which of the two is missing.
    { key: "cover",    label: qsTr("Depth of cover") }
];

Cave3D.SETTING_MODE = "Cave3D/ColorMode";
Cave3D.SETTING_GHOST = "Cave3D/ShowGhost";
Cave3D.SETTING_LEADS = "Cave3D/ShowLeads";
Cave3D.SETTING_SECTIONS = "Cave3D/ShowSections";
Cave3D.SETTING_SCANS = "Cave3D/ShowScans";
/** Station names written over the passage. */
Cave3D.SETTING_STATIONS = "Cave3D/ShowStations";
/** Frames an exported animation is written as. Twenty-four seconds at
 *  twenty-five a second: long enough to follow a passage, short enough
 *  that a caver is not left waiting on a folder of PNGs. */
Cave3D.EXPORT_FRAMES = 600;
/** Frames a second the film runs at. Twenty-five over six hundred
 *  frames is a twenty-four second animation. */
Cave3D.EXPORT_FPS = 25;
/** How fast the camera runs, as a multiple of its usual pace.
 *
 *  REMEMBERED, unlike the camera mode. Which way a caver likes to be
 *  carried through a cave is a preference; whether the view is
 *  currently flying is a thing they just did. */
Cave3D.SETTING_CAMERA_SPEED = "Cave3D/CameraSpeed";
/** Where a draped scan stops being pencil and starts being paper, as a
 *  luminance 0 to 1. Remembered because it is a property of the CAVER'S
 *  SCANNER, not of any one drawing: whoever photographs their books in
 *  an entrance gets the same grey every time, and should not have to
 *  find the setting again on every cave. */
Cave3D.SETTING_SCAN_INK = "Cave3D/ScanInk";
/** What the C++ view starts at. Kept in step with
 *  RCave3dView::DEFAULT_SCAN_INK; a disagreement only means the slider
 *  jumps once on the first run. */
Cave3D.DEFAULT_SCAN_INK = 0.62;

/** The surface above the cave, its contour lines, and how solid the
 *  surface is drawn. Remembered like the other overlays: a caver who
 *  works with the ground showing wants it showing on the next cave
 *  too. */
Cave3D.SETTING_TERRAIN = "Cave3D/ShowTerrain";
Cave3D.SETTING_TERRAIN_CONTOURS = "Cave3D/ShowTerrainContours";
Cave3D.SETTING_TERRAIN_OPACITY = "Cave3D/TerrainOpacity";
/** What the C++ view starts at. Kept in step with
 *  RCave3dView::DEFAULT_TERRAIN_OPACITY. */
Cave3D.DEFAULT_TERRAIN_OPACITY = 0.5;

/** Roughly how many contour lines to put across the relief. The plan
 *  drawing asks the caver for an interval; a view opened from a button
 *  must not, so CsTerrain3d.niceInterval picks a 1/2/5 step that lands
 *  near this. */
Cave3D.TERRAIN_CONTOUR_LEVELS = 12;

/** The chosen mode, read from settings the first time it is asked for.
 *  Not read at file scope: RSettings is not necessarily up when an
 *  add-on is loaded. */
Cave3D.mode = null;

Cave3D.isKnownMode = function(key) {
    for (var i = 0; i < Cave3D.MODES.length; i++) {
        if (Cave3D.MODES[i].key === key) {
            return true;
        }
    }
    return false;
};

Cave3D.currentMode = function() {
    if (Cave3D.mode === null) {
        var saved = RSettings.getStringValue(Cave3D.SETTING_MODE, "trip");
        Cave3D.mode = Cave3D.isKnownMode(saved) ? saved : "trip";
    }
    return Cave3D.mode;
};

/** Whether the refresh signal has been connected. Once only: the
 *  bridge outlives every run of this tool, so connecting on each run
 *  would stack up duplicate handlers that all fire. */
Cave3D.connected = false;

/**
 * The survey and its stations, positioned exactly as the drawing has
 * them.
 *
 * \return {survey, resolved} or null when the drawing holds no survey
 */
Cave3D.read = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    var recon = CsRevise.surveyFromDocument(doc);
    if (recon === null || isNull(recon.survey) ||
            recon.survey.shots.length === 0) {
        return null;
    }
    var survey = recon.survey;
    CsModel.ensureTrips(survey);

    if (recon.anchorName === "" || isNull(recon.anchorPos)) {
        // No anchor: resolve from whatever the survey fixes itself.
        // The mesh is still correct relative to itself; it simply is
        // not pinned where the drawing pins it.
        var plain = CsNetwork.resolve(survey);
        return { survey: survey, resolved: plain, anchored: false,
                 anchorName: "", adjusted: plain.adjusted === true };
    }

    // anchorZ is the drawing's vertical datum. A cave surveyed to an
    // absolute one keeps it nowhere else, so dropping it here would
    // rebase the whole cave to zero -- the bug family this suite has
    // now closed six doors on, and the one a 3D view would show most
    // convincingly while being most wrong.
    var anchorZ = CsRevise.anchorZOf(recon, recon.anchorName);
    var resolved = CsAdjust.resolveAndAdjust(survey, {
        anchor: { name: recon.anchorName,
                  x: recon.anchorPos.x, y: recon.anchorPos.y,
                  z: anchorZ }
    }, CsAdjust.optionsFromTags(recon.adjustTags));

    return { survey: survey, resolved: resolved, anchored: true,
             anchorName: recon.anchorName,
             adjusted: resolved.adjusted === true };
};

/** The colour every section is drawn in.
 *
 *  ONE COLOUR, AND NOT THE ACTIVE COLOUR MODE. A section is annotation
 *  -- somebody's drawing of a place -- not another way of reading the
 *  survey. Colouring it by depth or by trip would say something about
 *  it that is not true. */
Cave3D.SECTION_COLOR = [0.95, 0.80, 0.45];

/** Dimmer, so a leader reads as a tether and not as more passage. */
Cave3D.LEADER_COLOR = [0.55, 0.47, 0.28];

/**
 * Every captured section, placed into the world as line segments.
 *
 * Each section stands square to its passage on CsSectionCut's frame,
 * offset clear on the side the caver put it on in plan, with a leader
 * home to its station.
 *
 * \return {positions, colors, indices}
 */
Cave3D.sectionsBuffer = function(doc, survey, resolved) {
    var buf = { positions: [], colors: [], indices: [] };
    var found;
    try {
        found = CsSection3d.readAll(doc);
    } catch (e) {
        return buf;
    }
    if (found.length === 0) {
        return buf;
    }

    var splays = CsLrud.splaysByStation(survey);
    var legsByStation = {};
    var noteLeg = function(name, leg) {
        if (!legsByStation.hasOwnProperty(name)) {
            legsByStation[name] = [];
        }
        legsByStation[name].push(leg);
    };
    var li;
    for (li = 0; li < resolved.legs.length; li++) {
        noteLeg(resolved.legs[li].from, resolved.legs[li]);
        noteLeg(resolved.legs[li].to, resolved.legs[li]);
    }

    var push = function(a, b, col) {
        var base = buf.positions.length / 3;
        buf.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        buf.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
        buf.indices.push(base, base + 1);
    };

    for (var i = 0; i < found.length; i++) {
        var sec = found[i];
        var st = resolved.stations[sec.station];
        if (st === undefined || typeof st.z !== "number" ||
                !isFinite(st.z)) {
            // A section naming a station this drawing no longer has.
            continue;
        }
        var leg = CsSectionCut.nearestLeg(resolved, st, 1e9);
        if (leg === null) { continue; }
        var got = CsSectionCut.frameForLeg(resolved, leg.from, leg.to);
        if (got === null || got.frame === null) { continue; }
        var frame = got.frame;

        // The passage's own size here, so a section clears the passage
        // it belongs to rather than a guess at how wide that is.
        var width = 0;
        var dir = CsMesh3d.directionAt(sec.station, legsByStation, resolved);
        if (dir !== null) {
            var ring = CsMesh3d.ringAt(st, dir,
                CsMesh3d.lrudAt(sec.station, survey),
                splays[sec.station] || [], CsTraverse.SLOPE);
            for (var ri = 0; ri < ring.length; ri++) {
                var d = CsMesh3d.norm(CsMesh3d.sub(ring[ri], st));
                if (d > width) { width = d; }
            }
        }
        if (!(width > 0)) { width = 5; }

        // Plus the section's OWN reach, or a big section would straddle
        // the passage it was meant to stand clear of.
        var reach = 0;
        for (var pi = 0; pi < sec.polylines.length; pi++) {
            for (var pj = 0; pj < sec.polylines[pi].length; pj++) {
                var q = sec.polylines[pi][pj];
                var rr = Math.sqrt(q.x * q.x + q.y * q.y) / sec.scale;
                if (isFinite(rr) && rr > reach) { reach = rr; }
            }
        }

        var side = CsSection3d.sideFor(sec.blockPos, st, frame, width);
        var offset = width * (1 + CsSection3d.CLEARANCE) + reach;

        var placed = CsSection3d.place(sec.polylines, {
            station: st, frame: frame, scale: sec.scale,
            side: side, offset: offset
        });
        for (var k = 0; k < placed.length; k++) {
            for (var m = 0; m + 1 < placed[k].length; m++) {
                push(placed[k][m], placed[k][m + 1],
                     Cave3D.SECTION_COLOR);
            }
        }

        var lead = CsSection3d.leaderFor({ station: st, side: side,
            offset: offset });
        push(lead[0], lead[1], Cave3D.LEADER_COLOR);
    }
    return buf;
};

/**
 * Every sketch scan of one kind, draped onto the passage.
 *
 * ONE BUFFER, MANY TEXTURES. `runs` says how many indices belong to each
 * scan in turn, so the view binds one texture per scan without ever
 * being told what a scan is.
 *
 * \return {positions, uvs, indices, paths, runs}
 */
/**
 * One profile scan's strips, finding the band it sits in and unrolling
 * that run to invert.
 *
 * A scan in no band is skipped: without a band there is no unrolled axis
 * to walk back, and guessing one would lay the sketch along a passage
 * nobody drew it against.
 */
Cave3D.profileGridFor = function(scan, boxes, bandCache, survey, resolved,
                                 drawnStations) {
    var empty = { positions: [], uvs: [], indices: [] };
    var centre = { x: scan.quad.origin.x + scan.quad.u.x / 2,
                   y: scan.quad.origin.y + scan.quad.v.y / 2 };

    // WHICH BAND, BY ELEVATION. Bands are stacked in y and each starts
    // at the same x, so y is what tells them apart -- and a scan is
    // routinely WIDER than the band box it was fitted over (measured on
    // Truitt: a scan centred at x 606 against a box ending at 423), so
    // asking for a box that contains the whole centre point misses
    // eleven of sixteen.
    //
    // CsProfileBox.at returns the KEY, not the box, so the box itself
    // still has to be found to get its span.
    var box = null;
    for (var bi = 0; bi < boxes.length; bi++) {
        if (centre.y >= boxes[bi].minY - CsProfileBox.EDGE_EPS &&
                centre.y <= boxes[bi].maxY + CsProfileBox.EDGE_EPS) {
            box = boxes[bi];
            break;
        }
    }
    if (box === null) {
        // Not in any band's elevation range: no unrolled axis to walk
        // back, and guessing one would lay the sketch along a passage
        // nobody drew it against.
        return empty;
    }
    var band = bandCache[box.key];
    if (band === undefined) {
        var grouped = CsProfile.groupRuns(resolved);
        var run = grouped.runs[box.key];
        band = (run === undefined) ? null : CsProfile.unrollBand(run, null,
            resolved, CsProfile.hierarchy(grouped, resolved), {});
        bandCache[box.key] = band;
    }
    if (band === null) {
        return empty;
    }
    // WHERE THE DRAWING PUT THE BAND, from its own drawn stations.
    // The box's corner is not the band's first station -- it is drawn
    // around the band with padding, and below it by however far the
    // floor drops -- so taking the corner shifted every sketch forward
    // along the passage and lifted it above the cave.
    var place = CsDrape.placeBand(band, drawnStations);
    if (place === null) {
        // Either this band has no drawn stations to anchor on, or they
        // disagree with the survey as it now stands. Nothing is drawn
        // rather than something placed by guesswork.
        return empty;
    }
    return CsDrape.profileStrips(scan.quad, place, band, resolved);
};

Cave3D.scansBuffer = function(doc, survey, resolved, kind) {
    var buf = { positions: [], uvs: [], indices: [], paths: [], runs: [] };
    var scans;
    try {
        scans = CsDrape.readScans(doc, kind);
    } catch (e) {
        return buf;
    }
    // A profile scan needs the band it sits in; a plan scan does not.
    var boxes = [];
    var drawnStations = {};
    if (kind === "profile") {
        try { boxes = CsProfileBox.boxes(doc); } catch (eBox) { boxes = []; }
        // Read once for the whole buffer: it walks every entity in the
        // drawing, and a cave has more scans than it has bands.
        try {
            drawnStations = CsProfileBind.positions(doc);
        } catch (ePos) {
            drawnStations = {};
        }
    }
    var bandCache = {};

    for (var i = 0; i < scans.length; i++) {
        var g;
        try {
            if (kind === "profile") {
                g = Cave3D.profileGridFor(scans[i], boxes, bandCache,
                    survey, resolved, drawnStations);
            } else {
                g = CsDrape.grid(scans[i].quad, CsDrape.DIVISIONS,
                    resolved.stations);
            }
        } catch (eGrid) {
            continue;
        }
        if (g.positions.length === 0 || g.indices.length === 0) {
            // Nothing to sample under it. Skipped rather than drawn
            // flat at some arbitrary elevation.
            continue;
        }
        var base = buf.positions.length / 3;
        var k;
        for (k = 0; k < g.positions.length; k++) {
            buf.positions.push(g.positions[k]);
        }
        for (k = 0; k < g.uvs.length; k++) {
            buf.uvs.push(g.uvs[k]);
        }
        for (k = 0; k < g.indices.length; k++) {
            buf.indices.push(base + g.indices[k]);
        }
        buf.paths.push(scans[i].path);
        buf.runs.push(g.indices.length);
    }
    return buf;
};

/** Two scan buffers as one, keeping each scan's own run length so the
 *  view still binds one texture per scan. */
Cave3D.mergeScanBuffers = function(a, b) {
    var out = { positions: [], uvs: [], indices: [], paths: [], runs: [] };
    [a, b].forEach(function(src) {
        var base = out.positions.length / 3;
        var i;
        for (i = 0; i < src.positions.length; i++) {
            out.positions.push(src.positions[i]);
        }
        for (i = 0; i < src.uvs.length; i++) { out.uvs.push(src.uvs[i]); }
        for (i = 0; i < src.indices.length; i++) {
            out.indices.push(base + src.indices[i]);
        }
        for (i = 0; i < src.paths.length; i++) {
            out.paths.push(src.paths[i]);
            out.runs.push(src.runs[i]);
        }
    });
    return out;
};

/** One line for the panel's status bar. */
/**
 * The surface contour lines the DRAWING already has, lifted into 3D.
 *
 * WHY LIFT RATHER THAN REGENERATE. The plan drawing's contours were
 * drawn at an interval the caver chose, and they are the answer to
 * "what contours does this cave have" -- so 3D showing a different set
 * at a different interval is simply wrong, whatever it costs. It also
 * happens to be far cheaper: marching squares over a 3DEP grid costs
 * about 237 ms PER LEVEL in this engine (measured, 428x236), so
 * regenerating one real cave's foot-interval contours came to
 * thirty-one seconds of frozen panel. The lines are already in the
 * document, each tagged with its own elevation. Read them.
 *
 * Thinned on the way through: a grid-traced contour carries a vertex
 * per cell, and 61,607 segments of boxed doubles cross the bridge
 * twice over (position and colour). At CsTerrain3d.THIN_TOLERANCE_M --
 * well under the grid's own sample spacing -- the same cave comes
 * through as about 6,000, and nothing visible changes.
 *
 * ELEVATIONS ARE THE TAG'S, IN DRAWING UNITS, as Surface Data wrote
 * them: absolute NAVD88. The datum offset converts them into the
 * survey's frame, exactly as the mesh is converted.
 *
 * \return {positions, colors, levels} -- levels is how many distinct
 *         elevations were found, for the status line.
 */
Cave3D.terrainContoursFromDrawing = function(doc, unit, offset) {
    var out = { positions: [], colors: [], levels: 0 };
    var shift = (offset === null || offset === undefined) ? 0.0 : offset;
    var tol = CsUnits.convert(CsTerrain3d.THIN_TOLERANCE_M,
        CsUnits.METERS, unit);
    var seen = {};

    // The contours are drawn inside CsContour.BLOCK, inserted at its
    // own base point (the entrance) unscaled and unrotated, so the
    // block's own coordinates are the drawing's -- which is what lets
    // this read them without composing the reference's transform.
    var found = CsContour.drawnEntities(doc);
    for (var i = 0; i < found.length; i++) {
        var e = found[i];
        if (isNull(e)) {
            continue;
        }
        var levelU = CsTags.getNumber(e, "ContourElevation");
        if (levelU === null) {
            continue;             // the LABELS and the block REFERENCE
        }
        var shape = null;
        try {
            shape = e.getData().castToShape();
        } catch (eShape) {
            continue;
        }
        if (shape === null || isNull(shape)) {
            continue;
        }

        var pts = [];
        if (typeof shape.getVertices === "function") {
            var vs = shape.getVertices();
            for (var v = 0; v < vs.length; v++) {
                pts.push({ x: vs[v].x, y: vs[v].y });
            }
        } else if (typeof shape.getStartPoint === "function" &&
                typeof shape.getEndPoint === "function") {
            pts.push({ x: shape.getStartPoint().x,
                       y: shape.getStartPoint().y });
            pts.push({ x: shape.getEndPoint().x,
                       y: shape.getEndPoint().y });
        }
        if (pts.length < 2) {
            continue;
        }
        pts = CsTerrain3d.thinPolyline(pts, tol);
        if (pts.length < 2) {
            continue;
        }

        seen[String(levelU)] = true;
        var z = levelU - shift;
        // The drawing already decided which contours are major -- they
        // are the ones on the heavier layer. Read that rather than
        // recomputing "every fifth", which would disagree with the plan
        // the moment an interval changed.
        var major = false;
        try {
            major = (e.getLayerName() === CsLayers.CTRL_CONTOUR_MAJOR);
        } catch (eLayer) {
        }
        var c = major ? Cave3D.CONTOUR_MAJOR_COLOR
                      : Cave3D.CONTOUR_MINOR_COLOR;
        for (var k = 0; k + 1 < pts.length; k++) {
            out.positions.push(pts[k].x, pts[k].y, z,
                               pts[k + 1].x, pts[k + 1].y, z);
            out.colors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
        }
    }
    out.levels = Object.keys(seen).length;
    return out;
};

/** The two contour colours in the 3D view, matching the plan
 *  drawing's own major/minor weighting. */
Cave3D.CONTOUR_MAJOR_COLOR = [0.85, 0.72, 0.45];
Cave3D.CONTOUR_MINOR_COLOR = [0.62, 0.53, 0.36];

/**
 * The ground above the cave, loaded once: the 3DEP grid Surface Data
 * left beside the drawing, the transform that places it in drawing
 * coordinates, and the datum offset that puts its elevations in the
 * survey's own vertical frame.
 *
 * ONE LOAD, TWO READERS. The terrain overlay meshes this grid and the
 * cover colouring samples it. Loading it twice would be two code paths
 * that can disagree about where the ground is -- and they would
 * disagree silently, as a hillside in one place and a cover figure
 * measured to another.
 *
 * ALWAYS ANSWERS, never throws. A drawing with no grid, no
 * georeference or no datum anchor simply has no surface, which is a
 * fact about the drawing rather than a failure; `why` says which it
 * is, in a sentence a caver can act on.
 *
 * THE FETCH WINDOW IS READ, NOT RECOMPUTED. Surface Data stored the
 * Mercator bbox it actually fetched for, because that window is
 * derived from the plan data's extent and therefore GROWS as the cave
 * is drawn. Recomputing it here would register a kept grid against a
 * window it was never cut to and slide the whole hillside sideways.
 *
 * \return {grid, transform, offset, unit, texture, range, why} with
 *         grid null when there is no surface. `offset` null means the
 *         datum is UNKNOWN -- not zero. A caller that substitutes zero
 *         rebases the cave to sea level.
 */
Cave3D.surfaceContext = function(doc) {
    var none = function(why) {
        return { grid: null, transform: null, offset: null,
                 unit: null, texture: "", range: null, why: why };
    };
    if (typeof CsTerrain3d === "undefined") {
        return none("");
    }
    var demPath = CsGeoProject.demPathFor(doc.getFileName());
    if (demPath === null) {
        return none(qsTr("no surface: this drawing has never been saved"));
    }
    if (!(new QFileInfo(demPath)).exists()) {
        return none(qsTr("no surface: run Surface Data to fetch the "
            + "ground above this cave"));
    }

    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.pos === null) {
        return none(qsTr("no surface: this drawing has no georeference"));
    }
    var bboxTag = CsTags.get(rec.entity, "SurfaceBbox");
    if (bboxTag === null || bboxTag === undefined || bboxTag === "") {
        // An old grid, or one whose window a notebook Draw dropped
        // before CsLocationPick.rehome carried it (fixed 2026-09-25).
        return none(qsTr("no surface: the drawing has lost where its "
            + "elevation grid was fetched -- run Surface Data again"));
    }
    var parts = String(bboxTag).split(",");
    if (parts.length !== 4) {
        return none(qsTr("no surface: the stored fetch window is "
            + "unreadable -- run Surface Data again"));
    }
    var bbox = {
        xmin: parseFloat(parts[0]), ymin: parseFloat(parts[1]),
        xmax: parseFloat(parts[2]), ymax: parseFloat(parts[3])
    };

    var grid;
    try {
        grid = CsContour.parseFloatTiff(CsSurfaceData.readBinary(demPath));
    } catch (eGrid) {
        return none(qsTr("no surface: the elevation grid could not be "
            + "read (%1)").arg(String(eGrid)));
    }
    var range = CsContour.range(grid.values);
    if (range === null) {
        return none(qsTr("no surface: the elevation grid holds no "
            + "readings"));
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);

    // No photograph is not a failure: the ground still has shape.
    var texture = CsGeoProject.imagePathFor(doc.getFileName());
    if (texture === null || !(new QFileInfo(texture)).exists()) {
        texture = "";
    }

    return {
        grid: grid,
        transform: CsGeoProject.gridTransform(bbox, grid.width,
            grid.height, { lat: rec.lat, lon: rec.lon, pos: rec.pos }, unit),
        offset: CsLocationPick.datumOffset(doc, unit),
        unit: unit,
        texture: texture,
        range: range,
        why: ""
    };
};

/**
 * Depth of cover at every station, and the sentence to say about it.
 *
 * \return {values, summary, why} -- values is what CsMesh3d's cover
 *         mode and the station card both take, every station present
 *         and null where the surface has no reading. An absent surface
 *         gives an EMPTY map and a why: the mode then draws the cave
 *         in its unknown grey and says which step is missing, rather
 *         than falling back to a colouring that looks like it worked.
 */
Cave3D.coverValues = function(doc, read, ctx) {
    ctx = ctx || Cave3D.surfaceContext(doc);
    if (ctx.grid === null) {
        return { values: {}, summary: null, why: ctx.why };
    }
    var why = "";
    if (ctx.offset === null) {
        // WITHOUT GeoElev THERE IS NO COVER. The grid's elevations are
        // NAVD88 and the survey's are its own datum; subtracting one
        // from the other without the offset that relates them produces
        // a number with no meaning, and it would look like feet of
        // rock. Refuse rather than guess -- guessing here is the
        // elevation-datum trap with a new face.
        return { values: {}, summary: null,
                 why: qsTr("no cover: this drawing has no datum anchor, "
                     + "so run Surface Data to set one") };
    }
    var sample = CsCover.sampler(ctx.grid, ctx.transform,
        { unit: ctx.unit, offset: ctx.offset });
    var values = CsCover.atStations(read.survey, read.resolved, sample);
    return { values: values, summary: CsCover.summary(values), why: why };
};

/**
 * The ground above the cave: the elevation grid Surface Data left
 * beside the drawing, meshed and placed in the survey's own vertical
 * frame, with the aerial photograph as its texture.
 *
 * ALWAYS RETURNS A BUFFER, never throws. A drawing with no grid, no
 * georeference or no datum anchor simply has no surface, and the panel
 * greys the toggle -- which is a fact about the drawing, not a
 * failure. The reason travels back in `why` so the status line can say
 * which it is.
 *
 * THE FETCH WINDOW IS READ, NOT RECOMPUTED. Surface Data stored the
 * Mercator bbox it actually fetched for, because that window is
 * derived from the plan data's extent and therefore GROWS as the cave
 * is drawn. Recomputing it here would register a kept grid against a
 * window it was never cut to and slide the whole hillside sideways.
 *
 * \return {terrain, why} -- terrain is the block setMesh takes.
 */
Cave3D.terrainBuffer = function(doc, read, ctx) {
    var empty = {
        positions: [], normals: [], uvs: [], indices: [], texture: "",
        lines: { positions: [], colors: [] },
        bounds: null, holes: 0, levels: 0
    };
    var none = function(why) {
        return { terrain: empty, why: why };
    };

    ctx = ctx || Cave3D.surfaceContext(doc);
    if (ctx.grid === null) {
        return none(ctx.why);
    }
    var grid = ctx.grid;
    var transform = ctx.transform;
    var offset = ctx.offset;
    var unit = ctx.unit;
    var texture = ctx.texture;
    var range = ctx.range;

    // THE DRAWING'S OWN CONTOURS FIRST. They are what this cave has,
    // at the interval its cartographer chose, and reading them costs
    // no marching squares at all. Only a drawing with none falls back
    // to generating a set from the grid.
    var drawn = { positions: [], colors: [], levels: 0 };
    try {
        drawn = Cave3D.terrainContoursFromDrawing(doc, unit, offset);
    } catch (eDrawn) {
        drawn = { positions: [], colors: [], levels: 0 };
    }

    var terrain;
    try {
        terrain = CsTerrain3d.build(grid, transform, {
            unit: unit,
            offset: offset,
            // Generating is the FALLBACK, so it is switched off
            // entirely whenever the drawing has contours of its own.
            contours: drawn.levels === 0,
            intervalM: CsTerrain3d.niceInterval(range.max - range.min,
                Cave3D.TERRAIN_CONTOUR_LEVELS),
            thinTolerance: CsUnits.convert(CsTerrain3d.THIN_TOLERANCE_M,
                CsUnits.METERS, unit),
            texture: texture
        });
    } catch (eBuild) {
        return none(qsTr("no surface: %1").arg(String(eBuild)));
    }
    if (drawn.levels > 0) {
        terrain.lines = { positions: drawn.positions,
                          colors: drawn.colors };
        terrain.levels = drawn.levels;
        terrain.fromDrawing = true;
    }

    var why = "";
    if (offset === null) {
        // THE ONE CASE THAT MUST SPEAK UP. Without GeoElev there is no
        // way to relate the survey's elevations to the ground's, so the
        // surface is placed at its own true elevation and may sit far
        // from the cave. Guessing an offset to make the picture look
        // right is the elevation-datum trap.
        why = qsTr("surface placed at its own elevation: this drawing "
            + "has no datum anchor, so run Surface Data to set one");
    } else {
        why = qsTr("cave meets the surface %1 %2 up")
            .arg(offset.toFixed(1)).arg(unit);
    }
    if (terrain.levels > 0) {
        // SAY WHERE THE LINES CAME FROM. "19 contours" against a
        // drawing showing 130 of them is the report that would have
        // caught this sooner.
        why += terrain.fromDrawing === true
            ? qsTr("  --  %1 contours, as drawn").arg(terrain.levels)
            : qsTr("  --  %1 contours, generated (this drawing has "
                 + "none of its own)").arg(terrain.levels);
    }
    return { terrain: terrain, why: why };
};

/**
 * What the status line says about a set of cover values.
 *
 * THE THINNEST STATION BY NAME. A ramp can be read for "somewhere over
 * there is thin"; the number a caver repeats to anybody else is a
 * figure and a station, and this is the only place it appears.
 */
Cave3D.coverStatus = function(summary, unit) {
    if (summary === null || summary === undefined || summary.count === 0) {
        return "";
    }
    var text = qsTr("thinnest cover %1 %2 at %3  --  thickest %4 %2")
        .arg(summary.thinnest.value.toFixed(1)).arg(unit)
        .arg(summary.thinnest.name)
        .arg(summary.thickest.value.toFixed(1));
    if (summary.above > 0) {
        // NOT A FOOTNOTE. One station above the ground is an entrance
        // under a foot of slope error; a cave of them is a wrong datum
        // reported as thin rock, which is the failure this suite has
        // closed five separate doors on.
        text += qsTr("  --  %1 station(s) sit above the modelled ground")
            .arg(summary.above);
    }
    if (summary.unknown > 0) {
        text += qsTr("  --  %1 outside the surface data")
            .arg(summary.unknown);
    }
    return text;
};

/**
 * The status bar's parts joined into one line, blanks dropped and each
 * sentence said ONCE. The cover reason and the terrain reason both come
 * from surfaceContext, so a cave with no surface grid had "no surface:
 * run Surface Data..." printed twice side by side (Nathan, 2026-09-27).
 */
Cave3D.joinStatus = function(parts) {
    var seen = {};
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
        var part = isNull(parts[i]) ? "" : String(parts[i]);
        if (part === "" || seen[part] === true) {
            continue;
        }
        seen[part] = true;
        kept.push(part);
    }
    return kept.join("  --  ");
};

Cave3D.statusText = function(read, mesh) {
    var triangles = mesh.triangles.indices.length / 3;
    var unit = read.survey.distanceUnit === "m" ? "m" : "ft";
    var depth = mesh.bounds.max.z - mesh.bounds.min.z;
    var text = qsTr("%1  --  %2 triangles, %3 %4 of relief")
        .arg(mesh.legend.title).arg(triangles)
        .arg(depth.toFixed(1)).arg(unit);

    if (mesh.ghost.indices.length === 0) {
        // WHICH reason matters. One is a setting the caver can change
        // and the other is a solve that failed and wants looking at, and
        // "no ghost" alone leaves them unable to tell which they have.
        text += read.adjusted === true
            ? qsTr("  --  no ghost: the adjustment did not converge")
            : qsTr("  --  no ghost: adjustment is off");
    }
    if (read.anchored !== true) {
        text += qsTr("  --  no anchor station: not pinned to the " +
            "drawing's datum");
    }
    return text;
};

/**
 * What the panel was last dressed for: "<handle>|<drawing path>".
 *
 * See dressIfNeeded.
 */
Cave3D.dressedFor = null;

/**
 * Makes sure the panel's own furniture matches the drawing before a
 * mesh is pushed into it.
 *
 * THE BUG THIS EXISTS FOR (Nathan, 2026-09-20: "in the 3d view, the
 * style dropdown is empty"). Two things rebuild the mesh: the panel's
 * Refresh, which goes through refreshRequested and dresses first, and
 * the TRANSACTION LISTENER, which called refresh() straight. So any
 * edit to the drawing filled the view with a cave while the colour
 * dropdown, the window title and the leads toggle stayed exactly as
 * an undressed panel has them -- empty, unnamed, off. A panel Qt
 * restored at startup and a listener rebuild between them produced a
 * 3D view showing a cave, with a legend naming the colour mode, above
 * an empty dropdown that could not say what it was showing.
 *
 * Dressing is cheap (filling an eight-item combo) but not free, and it
 * resets the combo, so this does it only when the pairing of panel and
 * drawing has changed since last time -- which also re-titles the
 * window when a caver switches drawings, something the old
 * dress-on-refresh path did and the listener path never did.
 */
Cave3D.dressIfNeeded = function() {
    if (Cave3D.handle === null) {
        return;
    }
    var path = "";
    try {
        var doc = getDocument();
        path = isNull(doc) ? "" : String(doc.getFileName());
    } catch (ePath) {
        path = "";
    }
    var key = String(Cave3D.handle) + "|" + path;
    if (Cave3D.dressedFor === key) {
        return;
    }
    Cave3D.dress();
    Cave3D.dressedFor = key;
};

/** Rebuild the mesh from the drawing and push it into the window. */
Cave3D.refresh = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    // WHOEVER ASKED FOR THIS REBUILD, the panel around it has to make
    // sense: the listener rebuilds without going near dress().
    Cave3D.dressIfNeeded();
    var read = Cave3D.read(getDocument());
    if (read === null) {
        cave3d.clear(Cave3D.handle);
        cave3d.setStatus(Cave3D.handle,
            qsTr("No tagged survey in this drawing."));
        return;
    }
    // ONE SURFACE LOAD for the whole refresh: the terrain overlay
    // meshes this grid and the cover colouring samples it, and two
    // loads could place the ground in two places without ever saying
    // so.
    var ctx;
    try {
        ctx = Cave3D.surfaceContext(getDocument());
    } catch (eCtx) {
        ctx = { grid: null, transform: null, offset: null, unit: null,
                texture: "", range: null, why: "" };
    }

    // THE TRACED SECTIONS, read once for the whole refresh: the tube
    // is built out of them where they exist, and the Sections overlay
    // stands the caver's whole drawing (floor detail and all) beside
    // the passage separately.
    var sectionRings = {};
    try {
        sectionRings = CsSection3d.wallRingsByStation(getDocument());
    } catch (eRings) {
        sectionRings = {};
    }

    // COVER IS COMPUTED WHATEVER THE MODE, because the station card
    // reports it on a cave being looked at by trip or by depth. It is
    // a few hundred bilinear samples; the grid is already in memory.
    var cover = { values: {}, summary: null, why: ctx.why };
    try {
        cover = Cave3D.coverValues(getDocument(), read, ctx);
    } catch (eCover) {
        cover = { values: {}, summary: null, why: String(eCover) };
    }
    Cave3D.cover = cover;
    Cave3D.surface = ctx;
    // Kept for the station card, which answers a click and must not
    // re-read and re-resolve the whole drawing to do it.
    Cave3D.lastRead = read;

    var mesh;
    try {
        mesh = CsMesh3d.build(read.survey, read.resolved, {
            colorBy: Cave3D.currentMode(),
            anchorName: read.anchorName,
            cover: cover.values,
            // WHERE THE CAVER DREW THE PASSAGE, the tube is built
            // from their outline instead of the four LRUD ticks.
            sections: sectionRings
        });
    } catch (e) {
        // CsMesh3d refuses to build rather than place a station at datum
        // zero. Say so in the panel instead of leaving the last mesh up
        // and letting it pass for the current one.
        cave3d.clear(Cave3D.handle);
        cave3d.setStatus(Cave3D.handle, qsTr("Could not build: %1")
            .arg(String(e.message !== undefined ? e.message : e)));
        return;
    }
    // The sections ride along on the same mesh object. Their own
    // buffer, so showing and hiding them never rebuilds anything.
    try {
        mesh.sections = Cave3D.sectionsBuffer(getDocument(), read.survey,
            read.resolved);
    } catch (eSections) {
        mesh.sections = { positions: [], colors: [], indices: [] };
    }

    try {
        var planScans = Cave3D.scansBuffer(getDocument(), read.survey,
            read.resolved, "plan");
        var profScans = Cave3D.scansBuffer(getDocument(), read.survey,
            read.resolved, "profile");
        mesh.scans = Cave3D.mergeScanBuffers(planScans, profScans);
    } catch (eScans) {
        mesh.scans = { positions: [], uvs: [], indices: [], paths: [],
                       runs: [] };
    }

    // The ground above it, from the grid Surface Data left beside the
    // drawing. Its own buffer, so switching the surface on and off
    // never rebuilds the cave.
    var terrainWhy = "";
    try {
        var got = Cave3D.terrainBuffer(getDocument(), read, ctx);
        mesh.terrain = got.terrain;
        terrainWhy = got.why;
    } catch (eTerrain) {
        mesh.terrain = { positions: [], normals: [], uvs: [], indices: [],
                         texture: "", lines: { positions: [], colors: [] },
                         bounds: null, holes: 0, levels: 0 };
    }

    cave3d.setMesh(Cave3D.handle, mesh);
    if (cave3d.setFlyPath !== undefined) {
        // GUARDED: the tools can be updated without the application.
        var flight = { points: [], breaks: [] };
        try {
            // THROUGH THE MIDDLE OF THE PASSAGE, not along the line
            // of the stations: the mesh worked out where the middle is
            // when it built the cross sections.
            flight = CsFly.path(read.resolved, null,
                CsFly.centresFrom(mesh.outlines));
        } catch (eFly) {
        }
        // AN EMPTY FLIGHT DOES NOT REPLACE A GOOD ONE. Working the
        // path out can fail -- and did, silently, leaving Fly greyed
        // out on a cave that had been flying a moment earlier. A
        // refresh that cannot work out a flight leaves the one that is
        // there alone.
        if (flight.points.length >= 6) {
            cave3d.setFlyPath(Cave3D.handle, CsFly.flatten(flight.points),
                flight.breaks, flight.turns || []);
        }
    }
    // THE COVER SENTENCE ONLY IN THE COVER MODE. It is a long line and
    // the panel has one status bar; a caver looking at trips does not
    // need the thinnest roof in the cave reported at them.
    var coverWhy = "";
    if (Cave3D.currentMode() === "cover") {
        coverWhy = Cave3D.coverStatus(cover.summary,
            read.survey.distanceUnit === "m" ? "m" : "ft");
        if (coverWhy === "" && cover.why !== "") {
            coverWhy = cover.why;
        }
    }
    cave3d.setStatus(Cave3D.handle, Cave3D.joinStatus(
        [Cave3D.statusText(read, mesh), coverWhy, terrainWhy]));

    // THE EXPENSIVE HALF, KEPT. See recolour: the sections, the
    // scanned sketches and the ground do not depend on which colour
    // mode the cave is drawn in, and rebuilding them to change a
    // colour is most of what a mode change used to cost.
    Cave3D.lastBuffers = {
        sections: mesh.sections,
        scans: mesh.scans,
        terrain: mesh.terrain,
        terrainWhy: terrainWhy,
        cover: cover,
        sections3d: sectionRings
    };
};

/**
 * Redraws the cave in a different colour, without rebuilding it.
 *
 * WHY THIS EXISTS (Nathan, 2026-09-20: the style dropdown "lags").
 * Picking a colour mode used to run the whole refresh: re-read the
 * drawing, re-resolve the survey, re-cut the sections, and re-decode
 * every scanned sketch draped on the passage. Measured on Truitt, that
 * last part alone was 248ms of a 430ms round trip -- for a change that
 * touches nothing but the colour of the triangles.
 *
 * None of those buffers depend on the colour mode. So a mode change
 * now rebuilds the coloured mesh from the read it already has (12ms on
 * the same cave) and hands back the sections, scans and terrain
 * exactly as they were.
 *
 * FALLS BACK TO A FULL REFRESH whenever it cannot be sure: no cached
 * read, no cached buffers, or a mesh that will not build. The cached
 * read is the same one the station card uses, and it is replaced by
 * every refresh -- including the one the transaction listener fires
 * after any edit -- so it cannot describe a drawing that has moved on.
 */
Cave3D.recolour = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    var read = Cave3D.lastRead;
    var buffers = Cave3D.lastBuffers;
    if (isNull(read) || isNull(buffers)) {
        Cave3D.refresh();
        return;
    }
    var mesh = null;
    try {
        // THE SAME OPTIONS THE FULL BUILD USES, anchorName included:
        // CsMesh3d refuses to place a station at datum zero and reads
        // the anchor to know what zero means, so dropping it here
        // would make a recolour fail where a refresh succeeds.
        mesh = CsMesh3d.build(read.survey, read.resolved, {
            colorBy: Cave3D.currentMode(),
            anchorName: read.anchorName,
            cover: (buffers.cover === null || buffers.cover === undefined)
                ? {} : buffers.cover.values,
            // The traced sections too, or changing colour would throw
            // away the tube the caver's own outlines built.
            sections: (buffers.sections3d === null ||
                       buffers.sections3d === undefined)
                ? {} : buffers.sections3d
        });
    } catch (eBuild) {
        mesh = null;
    }
    if (isNull(mesh)) {
        Cave3D.refresh();
        return;
    }
    mesh.sections = buffers.sections;
    mesh.scans = buffers.scans;
    mesh.terrain = buffers.terrain;
    cave3d.setMesh(Cave3D.handle, mesh);

    var coverWhy = "";
    if (Cave3D.currentMode() === "cover" &&
            !isNull(buffers.cover)) {
        coverWhy = Cave3D.coverStatus(buffers.cover.summary,
            read.survey.distanceUnit === "m" ? "m" : "ft");
        if (coverWhy === "" && buffers.cover.why !== "") {
            coverWhy = buffers.cover.why;
        }
    }
    cave3d.setStatus(Cave3D.handle, Cave3D.joinStatus(
        [Cave3D.statusText(read, mesh), coverWhy, buffers.terrainWhy]));
};

/**
 * Writes the running animation out, a numbered PNG per frame.
 *
 * FRAMES, NOT A FILM. Encoding video would mean shipping an encoder or
 * depending on whatever the caver happens to have installed, and a
 * folder of numbered frames is something every editor on every platform
 * will take. The command that turns them into a film is printed, so
 * anyone who does have ffmpeg is one paste away.
 *
 * INTO THE CAVE'S OWN FOLDER by default, beside the drawing the
 * animation is of, rather than wherever a file dialog last pointed.
 */
Cave3D.exportAnimation = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    if (cave3d.exportFrames === undefined) {
        CsTell.warn(qsTr("Exporting an animation needs a newer CaveCAD."));
        return;
    }
    var mode = "manual";
    try { mode = String(cave3d.getCameraMode(Cave3D.handle)); } catch (e) {}
    if (mode === "manual") {
        // NOTHING IS MOVING, so there is nothing to write. Saying so
        // beats six hundred copies of one frame.
        CsTell.warn(qsTr("Turn on Fly or Spin first -- an export writes "
            + "whichever the camera is running."));
        return;
    }

    var doc = getDocument();
    var folder = CsCave.folderOf(isNull(doc) ? null : doc.getFileName());
    var base = (folder === null) ? QDir.tempPath() : folder;

    var picked = CsFiles.directory(
        RMainWindowQt.getMainWindow(),
        qsTr("Where should the animation go?"), base);
    if (picked === null || picked === undefined || String(picked) === "") {
        return;
    }

    var name = CsCave.nameOf(isNull(doc) ? null : doc.getFileName());
    var method = "";
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        if (Cave3D.MODES[mi].key === Cave3D.currentMode()) {
            method = Cave3D.MODES[mi].label;
        }
    }
    var stem = CsFly.filmStem(isNull(name) ? "" : name, method, mode,
        CsFly.stamp());
    var dir = String(picked) + "/" + stem;
    var framesDir = dir + "/frames";

    var film = "";
    var why = "";

    // THE SYSTEM'S OWN ENCODER FIRST. It takes the pictures as they are
    // made, so no frames are written to disk at all and none have to be
    // cleared away afterwards.
    if (cave3d.exportFilm !== undefined) {
        (new QDir()).mkpath(dir);
        cave3d.setStatus(Cave3D.handle, qsTr("Filming..."));
        try {
            film = String(cave3d.exportFilm(Cave3D.handle,
                dir + "/" + stem + ".mp4", Cave3D.EXPORT_FRAMES,
                Cave3D.EXPORT_FPS));
        } catch (eFilm) {
            film = "";
        }
        if (film === "" && cave3d.lastEncodeError !== undefined) {
            try { why = String(cave3d.lastEncodeError()); } catch (eW1) {}
        }
        if (film !== "") {
            cave3d.setStatus(Cave3D.handle, qsTr("Wrote %1").arg(film));
            return;
        }
    }

    // NO ENCODER OF ITS OWN: the frames, and ffmpeg if the caver has
    // one. A worse answer than a film, a better one than nothing.
    var written = -1;
    try {
        written = cave3d.exportFrames(Cave3D.handle, framesDir,
            Cave3D.EXPORT_FRAMES);
    } catch (eExp) {
        written = -1;
    }
    if (written <= 0) {
        CsTell.warn(qsTr("No frames could be written to %1.").arg(framesDir));
        return;
    }

    if (cave3d.encodeFrames !== undefined) {
        cave3d.setStatus(Cave3D.handle,
            qsTr("Encoding %1 frames...").arg(written));
        try {
            film = String(cave3d.encodeFrames(framesDir,
                dir + "/" + stem + ".mp4", Cave3D.EXPORT_FPS));
        } catch (eEnc) {
            film = "";
        }
        if (film === "" && cave3d.lastEncodeError !== undefined) {
            try { why = String(cave3d.lastEncodeError()); } catch (eW) {}
        }
    }

    if (film !== "") {
        // THE FRAMES GO. They were the means, not the thing asked for,
        // and six hundred PNGs beside the film is a folder nobody
        // wants. The film is checked before they are removed.
        try {
            (new QDir(framesDir)).removeRecursively();
        } catch (eRm) {
        }
        cave3d.setStatus(Cave3D.handle,
            qsTr("Wrote %1").arg(film));
        return;
    }

    // No encoder, or it failed: the frames are still worth having, and
    // the recipe goes beside them.
    Cave3D.writeFrameNote(framesDir, dir, stem, mode, written, why);
    cave3d.setStatus(Cave3D.handle,
        qsTr("Wrote %1 frames to %2 (no film: %3)")
            .arg(written).arg(framesDir).arg(why === "" ? "no encoder" : why));
    CsTell.warn(qsTr("The frames are written, but no film could be made: %1."
        + "\n\nThey are in %2, with a note beside them saying how to "
        + "turn them into one.").arg(why === "" ? qsTr("no encoder was found")
            : why).arg(framesDir));
};

/** The note that goes beside frames nobody could encode. */
Cave3D.writeFrameNote = function(framesDir, dir, stem, mode, written, why) {
    var note = "These are the frames of a " + mode + " animation, "
        + written + " of them, written by CaveCAD.\n\n"
        + "No film was made here because "
        + (why === "" ? "no encoder was found" : why) + ".\n\n"
        + "To make one, with ffmpeg installed:\n\n"
        + "  ffmpeg -framerate " + Cave3D.EXPORT_FPS
        + " -i frames/frame_%05d.png -c:v libx264 -pix_fmt yuv420p "
        + "\"" + stem + ".mp4\"\n\n"
        + "Or drop the frames folder into any video editor as an image "
        + "sequence.\n";
    try {
        var f = new QFile(dir + "/HOW TO MAKE THE FILM.txt");
        if (f.open(QIODevice.WriteOnly | QIODevice.Text)) {
            var ts = new QTextStream(f);
            ts.writeString(note);
            ts.flush();
            f.close();
        }
    } catch (eNote) {
    }
};

/**
 * The panel's own furniture: its title, its colour modes and the
 * overlay switches, restored from what the caver last chose.
 *
 * SEPARATE FROM THE MESH because a panel can exist without one -- Qt
 * puts the dock back where the caver left it on the next start, before
 * this tool has run at all.
 */
Cave3D.dress = function() {
    if (Cave3D.handle === null || !cave3d.isOpen(Cave3D.handle)) {
        return;
    }
    var doc = getDocument();
    if (!isNull(doc)) {
        var name = CsCave.nameOf(doc.getFileName());
        // open() on a panel that is already there only renames it and
        // brings it forward.
        cave3d.open(isNull(name) ? "" : name);
    }
    var keys = [], labels = [];
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        keys.push(Cave3D.MODES[mi].key);
        labels.push(Cave3D.MODES[mi].label);
    }
    cave3d.setColorModes(Cave3D.handle, keys, labels, Cave3D.currentMode());
    cave3d.setShowLeads(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_LEADS, false));
    // Remember what this dressing was FOR, so dressIfNeeded can tell
    // whether the panel still matches the drawing in front of it.
    try {
        var dressedDoc = getDocument();
        Cave3D.dressedFor = String(Cave3D.handle) + "|" +
            (isNull(dressedDoc) ? "" : String(dressedDoc.getFileName()));
    } catch (eDressed) {
        Cave3D.dressedFor = null;
    }
};

/**
 * Wires the panel's signals to this tool, once.
 *
 * CALLED FROM TWO PLACES and it has to be. The tool calls it when a
 * caver opens the 3D view; init calls it after pre-building the panel,
 * because a dock Qt restores from the saved layout comes up VISIBLE
 * before the tool has ever run and asks for a mesh through
 * refreshRequested -- with nothing listening, the caver gets an empty
 * 3D view that looks broken.
 *
 * Connected once for the life of the application: the bridge outlives
 * every run of the tool, so connecting per run would stack up duplicate
 * handlers that all fire.
 *
 * EVERY REACH FOR A SIGNAL IS GUARDED, and every connection is its own
 * statement. The tools can be updated without the application, and an
 * older CaveCAD has fewer of these: one unguarded connect throws and
 * leaves the panel with NOTHING connected -- which is how the Export
 * button came to do nothing at all, silently, for a whole afternoon.
 */
/**
 * Answer a click on a station: build its card and hand the view the
 * finished lines.
 *
 * THE VIEW IS HANDED STRINGS, not facts. It knows where the station is
 * on screen and nothing else -- no units, no trip names, no datum --
 * for the same reason RCave3dLegend is handed its labels.
 */
Cave3D.showStationCard = function(station) {
    if (Cave3D.handle === null || cave3d.showStationCard === undefined) {
        return;
    }
    var read = Cave3D.lastRead;
    if (read === null || read === undefined) {
        return;
    }
    var cover = Cave3D.cover || { values: {} };
    var ctx = Cave3D.surface || { grid: null };
    var unit = read.survey.distanceUnit === "m" ? "m" : "ft";

    // The ground elevation the cover figure came from, so a reader can
    // check it against a topo map. Recovered from the cover rather
    // than sampled a second time: two samples could differ and only
    // one of them is on the card.
    var st = read.resolved.stations[station];
    var ground = null;
    var cv = cover.values[station];
    if (st !== undefined && typeof cv === "number" && isFinite(cv)) {
        ground = cv + CsCover.ceilingAt(station, read.survey, st);
    }

    var card;
    try {
        card = CsStationCard.build(read.survey, read.resolved, station, {
            unit: unit,
            cover: (typeof cv === "number" && isFinite(cv)) ? cv : null,
            ground: ground,
            datumOffset: ctx.offset,
            anchorName: read.anchorName
        });
    } catch (e) {
        card = null;
    }
    if (card === null) {
        cave3d.hideStationCard(Cave3D.handle);
        return;
    }
    var labels = [];
    var values = [];
    for (var i = 0; i < card.rows.length; i++) {
        labels.push(card.rows[i][0]);
        values.push(card.rows[i][1]);
    }
    cave3d.showStationCard(Cave3D.handle, station, card.title,
        labels, values);
};

Cave3D.connectOnce = function() {
    if (Cave3D.connected) {
        return;
    }
    // ONE ENGINE LISTENS, NOT ALL OF THEM.
    //
    // Cave3D.connected is per ENGINE, and there are several: the one
    // that loads the add-ons, and one per menu action. Each has its own
    // copy of this file and its own flag, so all of them connected to
    // the one shared panel -- and a single press of Export ran the
    // export once per engine, which the caver saw as the folder dialog
    // opening again the moment the first film was written.
    //
    // The claim lives on the bridge because that is the thing there is
    // only one of.
    if (cave3d.claimSignals !== undefined && !cave3d.claimSignals()) {
        // Someone else is listening. Nothing more to do here, and say
        // so, so this engine does not try again on every run.
        Cave3D.connected = true;
        return;
    }
    if (cave3d.refreshRequested !== undefined) {
        cave3d.refreshRequested.connect(function(handle) {
            if (handle !== Cave3D.handle) { return; }
            // A PANEL QT RESTORED HAS NOTHING IN IT -- no colour modes,
            // no title, no toggles -- because the tool has never run.
            Cave3D.dress();
            Cave3D.refresh();
        });
    }
    if (cave3d.colorModeChanged !== undefined) {
        cave3d.colorModeChanged.connect(function(handle, mode) {
            if (handle !== Cave3D.handle) { return; }
            if (!Cave3D.isKnownMode(mode)) { return; }
            Cave3D.mode = mode;
            RSettings.setValue(Cave3D.SETTING_MODE, mode);
            // COLOUR ONLY: the cave itself has not changed.
            Cave3D.recolour();
        });
    }
    if (cave3d.overlayToggled !== undefined) {
        cave3d.overlayToggled.connect(function(handle, which, on) {
            if (handle !== Cave3D.handle) { return; }
            // Remembered, but NOT rebuilt: every overlay has its own
            // buffer precisely so showing and hiding costs nothing.
            var key = Cave3D.SETTING_LEADS;
            if (which === "ghost") {
                key = Cave3D.SETTING_GHOST;
            } else if (which === "sections") {
                key = Cave3D.SETTING_SECTIONS;
            } else if (which === "scans") {
                key = Cave3D.SETTING_SCANS;
            } else if (which === "stations") {
                key = Cave3D.SETTING_STATIONS;
            } else if (which === "terrain") {
                key = Cave3D.SETTING_TERRAIN;
            } else if (which === "terraincontours") {
                key = Cave3D.SETTING_TERRAIN_CONTOURS;
            }
            RSettings.setValue(key, on);
        });
    }
    if (cave3d.scanInkChanged !== undefined) {
        cave3d.scanInkChanged.connect(function(handle, value) {
            if (handle !== Cave3D.handle) { return; }
            // Remembered, not rebuilt: the threshold is a shader
            // uniform, so the view has already redrawn with it.
            RSettings.setValue(Cave3D.SETTING_SCAN_INK, value);
        });
    }
    if (cave3d.terrainOpacityChanged !== undefined) {
        cave3d.terrainOpacityChanged.connect(function(handle, value) {
            if (handle !== Cave3D.handle) { return; }
            // Remembered, not rebuilt: opacity is a shader uniform.
            RSettings.setValue(Cave3D.SETTING_TERRAIN_OPACITY, value);
        });
    }
    if (cave3d.cameraSpeedChanged !== undefined) {
        cave3d.cameraSpeedChanged.connect(function(handle, factor) {
            if (handle !== Cave3D.handle) { return; }
            RSettings.setValue(Cave3D.SETTING_CAMERA_SPEED, factor);
        });
    }
    if (cave3d.cameraModeChanged !== undefined) {
        cave3d.cameraModeChanged.connect(function(handle, mode) {
            if (handle !== Cave3D.handle) { return; }
            // Not remembered between sessions: a cave opens still, and
            // a view that started spinning on its own would be a
            // surprise rather than a setting.
            Cave3D.cameraMode = mode;
        });
    }
    if (cave3d.stationPicked !== undefined) {
        cave3d.stationPicked.connect(function(handle, station) {
            if (handle !== Cave3D.handle) { return; }
            // An EMPTY name is a click that hit nothing, which closes
            // the card. The view decides what "hit" means -- it owns
            // the projection -- and this side decides what to say.
            if (station === "") {
                cave3d.hideStationCard(Cave3D.handle);
                return;
            }
            Cave3D.showStationCard(station);
        });
    }
    if (cave3d.exportRequested !== undefined) {
        cave3d.exportRequested.connect(function(handle) {
            if (handle !== Cave3D.handle) { return; }
            Cave3D.exportAnimation();
        });
    }
    Cave3D.connected = true;
};

function cave3dRun() {
    // The 3D view is a C++ panel in CaveCAD itself, reached through the
    // global `cave3d`. An add-on can outlive the application it was
    // installed into -- a caver who updates the tools but not CaveCAD
    // would otherwise meet a bare ReferenceError from a menu entry that
    // looks like every other one.
    if (typeof cave3d === "undefined" || isNull(cave3d)) {
        CsTell.warn(qsTr("3D View needs a newer CaveCAD.\n" +
            "This version of the application has no 3D panel in it. " +
            "Everything else in the Cave Survey suite works as before."));
        return;
    }

    var doc = getDocument();
    var read = Cave3D.read(doc);
    if (read === null) {
        CsTell.warn(qsTr("3D View: no tagged survey stations found.\n" +
            "Import a survey or type one into the Survey Notebook " +
            "first -- there is no passage to look at without shots."));
        return;
    }

    if (Cave3D.handle !== null && cave3d.isOpen(Cave3D.handle)) {
        cave3d.raiseWindow(Cave3D.handle);
    } else {
        var name = CsCave.nameOf(doc.getFileName());
        Cave3D.handle = cave3d.open(isNull(name) ? "" : name);
    }

    // Fill the dropdown before the first refresh, so the panel opens
    // showing the mode it is about to draw in.
    var keys = [], labels = [];
    for (var mi = 0; mi < Cave3D.MODES.length; mi++) {
        keys.push(Cave3D.MODES[mi].key);
        labels.push(Cave3D.MODES[mi].label);
    }
    cave3d.setColorModes(Cave3D.handle, keys, labels, Cave3D.currentMode());
    cave3d.setShowLeads(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_LEADS, false));

    Cave3D.connectOnce();

    Cave3D.refresh();

    // The ghost's toggle is only meaningful once a mesh has said
    // whether there is a ghost to show, which is why this follows the
    // refresh rather than sitting with the other restores above.
    cave3d.setShowGhost(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_GHOST, false));
    // Same reason as the ghost: only a built mesh knows whether this
    // drawing holds any sections to show.
    cave3d.setShowSections(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_SECTIONS, false));
    cave3d.setShowScans(Cave3D.handle,
        RSettings.getBoolValue(Cave3D.SETTING_SCANS, false));
    if (cave3d.setShowTerrain !== undefined) {
        // GUARDED: the tools can be updated without the application,
        // and an older CaveCAD has no surface to switch on. AFTER the
        // refresh, for the ghost's reason: only a built mesh knows
        // whether this drawing has an elevation grid beside it.
        cave3d.setTerrainOpacity(Cave3D.handle,
            RSettings.getDoubleValue(Cave3D.SETTING_TERRAIN_OPACITY,
                Cave3D.DEFAULT_TERRAIN_OPACITY));
        cave3d.setShowTerrain(Cave3D.handle,
            RSettings.getBoolValue(Cave3D.SETTING_TERRAIN, false));
        cave3d.setShowTerrainContours(Cave3D.handle,
            RSettings.getBoolValue(Cave3D.SETTING_TERRAIN_CONTOURS, false));
    }
    if (cave3d.setShowStations !== undefined) {
        // GUARDED: the tools can be updated without the application,
        // and an older CaveCAD has no station labels to switch on.
        cave3d.setShowStations(Cave3D.handle,
            RSettings.getBoolValue(Cave3D.SETTING_STATIONS, false));
    }
    if (cave3d.setCameraSpeed !== undefined) {
        cave3d.setCameraSpeed(Cave3D.handle,
            RSettings.getDoubleValue(Cave3D.SETTING_CAMERA_SPEED, 1.0));
    }
    if (cave3d.setScanInk !== undefined) {
        cave3d.setScanInk(Cave3D.handle,
            RSettings.getDoubleValue(Cave3D.SETTING_SCAN_INK,
                Cave3D.DEFAULT_SCAN_INK));
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

Cave3D.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    cave3dRun();
    this.terminate();
};

Cave3D.init = function(basePath) {
    var action = new RGuiAction(qsTr("3D View"),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Cave3D.js");
    action.setIcon(basePath + "/Cave3D.svg");
    action.setStatusTip(qsTr("Look at the surveyed passage in three " +
        "dimensions"));
    action.setDefaultCommands(["cave3d", "c3"]);
    // Stage 2, beside Loop Errors: a question about the survey itself,
    // asked before and during drawing rather than after it.
    action.setGroupSortOrder(451);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // BUILD THE PANEL NOW, HIDDEN. A QOpenGLWidget appearing in a
    // window makes Qt rebuild that window natively, and macOS then
    // reshuffles its Spaces around the new one -- which a caver sees as
    // the desktop sliding and the screen going black for about a
    // second. It cannot be avoided, so it is paid here, at startup,
    // while the window is being put together anyway, rather than in the
    // middle of their session the first time they open the 3D view.
    //
    // Guarded twice over: an older CaveCAD has no such call, and a
    // failure to pre-build must not stop the tool being installed.
    try {
        if (typeof cave3d !== "undefined" && !isNull(cave3d) &&
                cave3d.prewarm !== undefined) {
            // THE HANDLE COMES BACK, and is kept. Qt remembers where
            // the caver put the dock and puts it BACK on the next
            // start, visible, before this tool has ever run -- and the
            // panel then asks for a mesh through refreshRequested.
            // Without the handle that request arrives for a window this
            // side does not think it owns, and is dropped: the caver
            // gets an empty 3D view that looks broken.
            Cave3D.handle = cave3d.prewarm();
            Cave3D.connectOnce();
        }
    } catch (ePrewarm) {
    }
};
