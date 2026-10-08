/**
 * CsSurfaceData.js
 *
 * Everything that comes from ABOVE ground, over one shared anchor: an
 * aerial photograph (USGS NAIP) and surface elevation contours (USGS
 * 3DEP), each independently switchable, run together and reported
 * together -- the same shape CsRepair.js uses for its own three passes.
 *
 * This file is the merge of two former tools, Aerial Basemap and
 * Surface Contours, which used to be two menu entries asking the exact
 * same question ("where is the ground?") and failing in two separately
 * worded ways when nobody had answered it yet. CsSurfaceData.findAnchor
 * is that shared question, asked ONCE by CsSurfaceData.run before
 * either pass is allowed to touch the network.
 *
 * WHY NAIP AND NOT GOOGLE EARTH (imagery). Google publishes no export
 * or tile API for Earth imagery, and its terms forbid extracting
 * imagery for offline reuse -- which is exactly what an image embedded
 * in a DXF is. USGS NAIP is federal public domain: keyless, quota-free,
 * no attribution obligation, 0.3 m native. US-only coverage, which is
 * where this project's caves are.
 *
 * The projection and request math (ground windows, Mercator bboxes,
 * pixel sizing) is shared between both passes and lives below, where
 * the headless harness can test it. Everything below that needs a real
 * RDocument/RDocumentInterface -- the anchor resolution, the fetch, the
 * draw -- is covered instead by tests/surface_data_run.js (see
 * tests/js_unit.js's CORE_FILES_NOT_LOADED for why).
 *
 * TAG AND LAYER BEFORE ADDING, NEVER AFTER (see Core/CsDraw.js's own
 * header): in this QJS bridge, simple.js's setCurrentLayer and
 * post-add property writes on a JUST-INSERTED entity fail silently.
 * A brand new entity is therefore built, given its layer and its
 * replace-on-rerun tag, and only THEN added with addObject(entity,
 * false) -- the false is what stops the operation stamping the
 * current layer over the one just set. An entity ALREADY IN the
 * document (the anchor station, when it needs a fresh coordinate) is
 * the one case where CsTags.commit (tag + modify-operation) is right,
 * matching Geo Reference's own pattern.
 *
 * TAGS KEPT AS-IS ON PURPOSE. The imagery entity is still tagged
 * AerialBasemap=1 and the contour entities SurfaceContours=1 -- the
 * literal strings the two standalone tools always used. Real cave
 * drawings out there already carry basemaps and contours tagged this
 * way; renaming the tags to something SurfaceData-shaped would orphan
 * that existing output on the very next re-run (the erase-and-replace
 * scan would no longer find it). Nothing about this merge is meant to
 * change what a re-run does to a drawing that predates it. It is the
 * MENU ENTRY, the dialog and the commands that unify -- "ab",
 * "aerialbasemap", "sc" and "surfacecontours" are gone; the data-level
 * tag names are not part of that surface and stay put.
 *
 * USAGE:
 *   Cave Survey > Surface Data   (or type "surfacedata" / "sd")
 *
 * The drawing must be saved for the imagery pass (its photo is written
 * beside the drawing file); the contour pass has no such requirement,
 * its elevation grid is a temporary file. If no georeference anchor
 * exists yet, this asks for the entrance coordinate and stores it on
 * station A1 -- by project convention every cave entrance is A1 -- so
 * one run does the whole job. That question, and the later "has the
 * anchor moved over the imagery?" check, are each now asked ONCE for
 * both passes, where the two separate tools used to ask twice.
 *
 * Re-running replaces each pass's own previous output independently:
 * requesting only contours on a re-run leaves a previously placed
 * basemap exactly where it is.
 */
var CsSurfaceData = {};

// ============================================================
// Shared anchor resolution -- the one question both passes ask.
// ============================================================

/**
 * Resolves the anchor station and, if it already carries one, its
 * coordinate.
 *
 * Precedence: a station already carrying GeoLat/GeoLon; else the
 * station named A1 (every cave entrance in this project is A1); else a
 * single selected station point.
 *
 * Never pops a dialog or a warning itself -- it RETURNS what happened,
 * so CsSurfaceData.run can fold it into the one report both passes
 * share instead of a warning() box firing before the report exists.
 *
 * \return {entity, name, pos, lat, lon} with lat/lon null when a
 *         coordinate still has to be asked for; or {error: String}
 *         when there is nothing to anchor to, or the current selection
 *         cannot serve as one.
 */
CsSurfaceData.findAnchor = function(doc) {
    var stations = CsTags.collectStations(doc);
    var i;

    // An existing georeference wins outright.
    for (i = 0; i < stations.length; i++) {
        var lat = CsTags.getNumber(stations[i].entity, "GeoLat");
        var lon = CsTags.getNumber(stations[i].entity, "GeoLon");
        if (lat !== null && lon !== null) {
            return {
                entity: stations[i].entity,
                name: stations[i].name,
                pos: stations[i].pos,
                lat: lat,
                lon: lon
            };
        }
    }

    // The entrance convention.
    for (i = 0; i < stations.length; i++) {
        if (stations[i].name === "A1") {
            return {
                entity: stations[i].entity,
                name: "A1",
                pos: stations[i].pos,
                lat: null,
                lon: null
            };
        }
    }

    // Last resort: exactly one selected station point. Only ask
    // CsPick when there IS a selection -- it warns on its own when the
    // selection is empty or ambiguous, and calling it with nothing
    // selected would stack that warning on top of the generic one
    // below. (CsPick.singleSelected is itself GUI-adjacent and still
    // warns through its own path; that is unchanged from both former
    // tools.)
    if (doc.hasSelection()) {
        var selected = CsPick.singleSelected(doc, "Surface Data");
        if (selected === null) {
            return { error: "" };    // CsPick already explained why
        }
        if (typeof selected.getPosition !== "function") {
            return { error: qsTr("Surface Data: the selection isn't a "
                + "point entity.\nSelect one station point, or work in "
                + "a drawing with a station named A1.") };
        }
        return {
            entity: selected,
            name: CsTags.get(selected, "Station"),
            pos: selected.getPosition(),
            lat: null,
            lon: null
        };
    }

    return { error: qsTr("Surface Data: nothing to anchor the imagery "
        + "or contours to.\nThis drawing has no location yet. Set one "
        + "from an existing Geo Reference anchor, a station named A1 "
        + "(the entrance, by convention), or by selecting exactly one "
        + "station point and running this again -- or set one in "
        + "Survey Notebook > Declination, which offers to store it as "
        + "this drawing's anchor too.") };
};

/**
 * The CAVE PLAN DATA's extent, in drawing units, as {width, height,
 * centerX, centerY}. Falls back to a zero-size box at the anchor when
 * there is no usable extent -- groundExtent's floor then decides the
 * window.
 *
 * CsDraw.planDataBox is the one definition of what counts (Nathan,
 * 2026-08-27): plan-frame entities only -- never the profile region,
 * the sheet furniture, this tool's own previous output, the other
 * pass's output or an inserted scan. Before that shared box existed, a
 * drawn profile inflated the fetch window and the photo compounded
 * itself 25% wider on every re-run. Shared between both passes so a
 * basemap and its contours always cover the same ground.
 */
CsSurfaceData.surveyBox = function(doc, anchorPos) {
    var box = CsDraw.planDataBox(doc);
    if (box === null) {
        return {
            width: 0, height: 0,
            centerX: anchorPos.x, centerY: anchorPos.y
        };
    }
    return {
        width: box.maxX - box.minX,
        height: box.maxY - box.minY,
        centerX: (box.minX + box.maxX) / 2.0,
        centerY: (box.minY + box.maxY) / 2.0
    };
};

/**
 * Downloads url to path with curl, blocking.
 *
 * curl rather than QNetworkAccessManager: the async event-loop path
 * through this bridge is untested and the tool has nothing to do while
 * waiting. Note that the bridge stringifies readAllStandardOutput() as
 * "QByteArray [JS]", so the diagnosis has to come from the exit code
 * and from inspecting the file. Shared plumbing for both passes; what
 * differs is the payload validation each does afterward (a QImage for
 * the photo, parseFloatTiff for the elevation grid).
 *
 * \return true, or a one-line explanation of what went wrong.
 */
CsSurfaceData.fetch = function(url, path) {
    var existing = new QFileInfo(path);
    if (existing.exists()) {
        QFile.remove(path);         // never leave a stale download behind
    }

    var process = new QProcess();
    process.start("/usr/bin/curl", ["-s", "--fail",
        "--max-time", String(CsSurfaceData.TIMEOUT_S), "-o", path, url]);
    if (!process.waitForFinished((CsSurfaceData.TIMEOUT_S + 10) * 1000)) {
        // waitForFinished returning false covers two very different
        // cases that this bridge CAN tell apart, but only before
        // kill() -- killing a process that never started is harmless
        // but killing one that IS running rewrites its state()/error()
        // to NotRunning/Crashed, erasing the distinction we need.
        // Verified live in this engine: a missing binary reports
        // state() === QProcess.NotRunning and error() ===
        // QProcess.FailedToStart at this point; a genuinely
        // still-running process reports Running/Timedout instead.
        var neverStarted = process.state() === QProcess.NotRunning;
        process.kill();
        QFile.remove(path);
        if (neverStarted) {
            return "curl at /usr/bin/curl could not be started. Check " +
                "that curl is installed at that path.";
        }
        return "The download did not finish within " +
            CsSurfaceData.TIMEOUT_S + " seconds. Check the network " +
            "connection and try again.";
    }
    if (process.exitCode() !== 0) {
        QFile.remove(path);
        return "curl exited with code " + process.exitCode() +
            ". The National Map service may be down, or the network " +
            "unavailable.";
    }

    var info = new QFileInfo(path);
    if (!info.exists() || info.size() === 0) {
        return "No data was written to " + path + ".";
    }
    return true;
};

// Seconds allowed for the whole fetch. NAIP at 4000 px can take a
// while; the tool has nothing to do meanwhile, which is why this is a
// blocking QProcess rather than async network plumbing. Kept as a
// property on the tool object (not a bare global) so it can't collide
// with anything else the engine loads into the global scope.
CsSurfaceData.TIMEOUT_S = 60;

/**
 * The ground elevation at ONE coordinate, in metres NAVD88, or null.
 *
 * The same 3DEP service the contour pass uses, asked for the smallest
 * window it will serve rather than a whole survey's worth of ground:
 * this exists so setting an entrance location can store the drawing's
 * datum anchor (GeoElev) straight away, without the caver having to run
 * a full imagery-and-contours fetch to get one number.
 *
 * NO DIALOG, EVER. It returns null on every failure -- no network, no
 * coverage, an unreadable reply -- and the caller says what that means
 * in its own words. A location is still worth storing when the
 * elevation lookup fails.
 */
CsSurfaceData.GROUND_WINDOW_M = 200;

CsSurfaceData.groundElevationAt = function(lat, lon) {
    if (lat === null || lat === undefined || lon === null ||
            lon === undefined) {
        return null;
    }
    var extent = { width: CsSurfaceData.GROUND_WINDOW_M,
                   height: CsSurfaceData.GROUND_WINDOW_M };
    var bbox = CsGeoProject.mercatorBbox(lat, lon, extent, null);
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.DEM_NATIVE_RES_M,
        CsGeoProject.DEM_MAX_PX, CsGeoProject.DEM_MIN_PX);

    var path = QDir.tempPath() + "/cavecad-point-elevation.tif";
    if (CsSurfaceData.fetch(CsGeoProject.demUrl(bbox, size), path) !== true) {
        return null;
    }
    var grid;
    try {
        grid = CsContour.parseFloatTiff(CsSurfaceData.readBinary(path));
    } catch (e) {
        QFile.remove(path);
        return null;
    }
    QFile.remove(path);

    // The coordinate is the middle of the window by construction, so
    // the reading wanted is the middle of the grid.
    var at = CsGeoProject.anchorGridCoord(bbox, grid.width, grid.height,
        lat, lon);
    return CsContour.sampleAt(grid.values, grid.width, grid.height,
        at.col, at.row);
};

// ============================================================
// Aerial imagery pass (formerly the standalone Aerial Basemap tool).
// ============================================================

// The photo's fade, percent (0 = full strength, 100 = invisible).
// Half strength keeps the imagery as background context under the
// linework (Nathan, 2026-08-27).
CsSurfaceData.FADE_PERCENT = 50;

/**
 * Fetches and places a USGS NAIP aerial photograph over `anchor`,
 * replacing any previous basemap. Never pops a dialog: every outcome,
 * success or failure, comes back as one line for CsSurfaceData.run to
 * fold into the shared report.
 *
 * \param anchor {lat, lon, pos:{x,y}, name} -- already resolved and,
 *        if it needed one, already given a coordinate by run().
 * \return String describing what happened.
 */
CsSurfaceData.basemap = function(doc, di, anchor) {
    // Cheapest check first: an engine with no image support can never
    // place the result, so refuse before burning a full NAIP download
    // on a fetch whose output could never be used.
    if (typeof RImageData === "undefined" || typeof RImageEntity === "undefined") {
        return qsTr("this build's script engine has no image support "
            + "(RImageData). The CaveCAD fork is the supported platform.");
    }

    // The image is written beside the drawing, so the drawing needs a
    // home first.
    var docPath = doc.getFileName();
    var imagePath = CsGeoProject.imagePathFor(docPath);
    if (imagePath === null) {
        return qsTr("save the drawing first -- the aerial photograph is "
            + "written beside the drawing file, so the drawing needs a "
            + "name before it can be fetched.");
    }

    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var box = CsSurfaceData.surveyBox(doc, anchor.pos);
    var extent = CsGeoProject.groundExtent(
        { width: box.width, height: box.height }, unit,
        CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);

    // The survey rarely centres on its entrance, so the window is
    // offset from the anchor by however far the extent's centre is.
    var offset = {
        x: CsUnits.convert(box.centerX - anchor.pos.x, unit, CsUnits.METERS),
        y: CsUnits.convert(box.centerY - anchor.pos.y, unit, CsUnits.METERS)
    };

    var bbox = CsGeoProject.mercatorBbox(anchor.lat, anchor.lon,
        extent, offset);
    if (!CsGeoProject.insideCoverage(bbox)) {
        return qsTr("that location is outside USGS NAIP coverage. NAIP "
            + "covers the United States only.");
    }
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.NATIVE_RES_M,
        CsGeoProject.MAX_PX, CsGeoProject.MIN_PX);

    var fetched = CsSurfaceData.fetch(CsGeoProject.naipUrl(bbox, size),
        imagePath);
    if (fetched !== true) {
        return qsTr("the imagery fetch failed.\n") + fetched;
    }
    // A service error arrives as a JSON body with a 200 status; only a
    // real image is a usable fetch.
    var image = new QImage(imagePath);
    if (image.isNull()) {
        QFile.remove(imagePath);
        return qsTr("the service returned something that is not an "
            + "image (usually an error message). Try again, or a "
            + "smaller area.");
    }

    var unitsPerPixel = CsGeoProject.drawingUnitsPerPixel(bbox, size.w,
        anchor.lat, unit);
    var placed = CsSurfaceData.place(doc, di, imagePath, bbox, size,
        unitsPerPixel, anchor);
    if (placed !== true) {
        return qsTr("the photograph was downloaded to\n") + imagePath +
            qsTr("\nbut could not be placed in the drawing.\n") + placed;
    }

    return qsTr("placed a ") + size.w + " x " + size.h +
        qsTr(" USGS NAIP photograph covering about ") +
        Math.round(extent.width) + qsTr(" m across, anchored on station ") +
        (anchor.name !== "" ? anchor.name : "the anchor point") + "." +
        qsTr(" Image file: ") + imagePath;
};

/**
 * Inserts the image on CTRL-AERIAL, tagged so a later run can replace
 * it, positioned so the anchor station's drawing coordinate sits on its
 * own real-world pixel.
 *
 * \return true, or a one-line explanation.
 */
CsSurfaceData.place = function(doc, di, path, bbox, size, unitsPerPixel,
                              anchor) {
    // CsSurfaceData.basemap already checks this before ever calling
    // fetch() -- no point burning a download an engine can't place --
    // but place() is a small, separately-testable function in its own
    // right, and it constructs RImageEntity/RImageData directly below;
    // keeping the guard here too means it stays correct for any future
    // caller that skips the run-level check, at the cost of one cheap
    // typeof.
    if (typeof RImageData === "undefined" || typeof RImageEntity === "undefined") {
        return "This build's script engine has no image support " +
            "(RImageData). The CaveCAD fork is the supported platform.";
    }

    // The image's insertion point is its lower-left corner. Work out
    // where that corner falls in drawing coordinates by stepping back
    // from the anchor by the anchor's own offset within the image.
    var anchorMerc = CsGeoProject.toMercator(anchor.lat, anchor.lon);
    var pxFromLeft = (anchorMerc.x - bbox.xmin) /
        ((bbox.xmax - bbox.xmin) / size.w);
    var pxFromBottom = (anchorMerc.y - bbox.ymin) /
        ((bbox.ymax - bbox.ymin) / size.h);
    var originX = anchor.pos.x - pxFromLeft * unitsPerPixel;
    var originY = anchor.pos.y - pxFromBottom * unitsPerPixel;

    // Build the entity BEFORE touching the document at all -- if this
    // throws, nothing has been erased or added yet, so a placement
    // failure leaves the drawing exactly as it was.
    var entity;
    try {
        var data = new RImageData(
            path,
            new RVector(originX, originY),
            new RVector(unitsPerPixel, 0),     // u: one pixel across
            new RVector(0, unitsPerPixel),     // v: one pixel up
            size.w, size.h, 0);
        // Faded to half strength: the photo is CONTEXT under the map,
        // and at full strength it out-shouts the linework it sits
        // beneath. Fade survives the DXF round trip (probed
        // 2026-08-27), and the property editor can still change it per
        // drawing.
        try {
            data.setFade(CsSurfaceData.FADE_PERCENT);
        } catch (eFade) {
            // an engine without setFade gets a full-strength photo
        }
        entity = new RImageEntity(doc, data);
    } catch (e) {
        return "Creating the image entity failed: " + e;
    }

    // Only now erase any previous basemap and ensure the layer exists
    // -- a separate operation from the insert below, so a previous
    // basemap and the new one are never both present, but the new
    // entity (already built and known-good above) is ready to go in
    // immediately after.
    CsSurfaceData.eraseExistingImagery(doc, di);
    CsLayers.ensure(doc, di, CsLayers.CTRL_AERIAL);

    // Layer, tag AND draw order BEFORE adding -- see the file header.
    // A modify operation on an already-added entity is what Geo
    // Reference uses for the pre-existing anchor station above; a
    // brand new entity like this one instead gets its layer, tag and
    // draw order set on the script-side object first, then
    // addObject(entity, false) commits all three in one step, with
    // "false" stopping the operation from re-stamping the current
    // layer over CTRL-AERIAL.
    //
    // Draw order sends the photo to the very back, the same call the
    // stock Modify > Draw Order > To Back tool makes on the current
    // selection (scripts/Modify/DrawOrder/ToFront/ToFront.js's
    // moveTo(false)): storage.getMinDrawOrder(), so it sorts at or
    // below everything already in the document. The "- 1" is the one
    // difference from that stock tool, and it matters here: To Back
    // moves entities that are ALREADY in storage, so tying them at the
    // current minimum is moving them behind everything ELSE. This
    // entity isn't in storage yet when getMinDrawOrder() is read, so
    // tying it at that same value risks a draw-order TIE against
    // whatever currently holds the minimum, and ties are not
    // documented to resolve in the newest entity's favour. One below
    // the minimum is unambiguous regardless. Without this, the image
    // gets no draw order at all and lands wherever the add operation's
    // own default puts new entities -- which verified live in this
    // engine is ABOVE everything already there, i.e. on top of the
    // survey it is supposed to sit under.
    entity.setLayerId(doc.getLayerId(CsLayers.CTRL_AERIAL));
    CsTags.set(entity, "AerialBasemap", "1");
    entity.setDrawOrder(doc.getStorage().getMinDrawOrder() - 1);

    var op = new RAddObjectsOperation();
    op.setText("Insert aerial basemap");
    op.addObject(entity, false);
    di.applyOperation(op);

    return true;
};

/**
 * Every image entity tagged as a previous basemap. The tag,
 * AerialBasemap=1, is the standalone tool's original tag -- see the
 * file header on why it was not renamed. Used by both this pass's own
 * replace-on-rerun and by the contour pass, which pushes any basemap
 * one step further down the draw order so the stack stays
 * photo < contours < survey.
 */
CsSurfaceData.findBasemapCandidates = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (typeof RImageEntity !== "undefined" && !isOfType(e, RImageEntity)) {
            continue;
        }
        if (CsTags.get(e, "AerialBasemap") === "1") {
            out.push(e);
        }
    }
    return out;
};

/**
 * Deletes any previous basemap so a re-run replaces rather than stacks.
 * Because the image is tagged BEFORE it is ever added (see place()
 * above), the tag is present from the moment an image exists in the
 * document, so this needs only the tag-based scan -- there is no
 * window where a just-inserted basemap is untagged and would need a
 * file-name fallback to be found.
 */
CsSurfaceData.eraseExistingImagery = function(doc, di) {
    var existing = CsSurfaceData.findBasemapCandidates(doc);
    if (existing.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    for (var i = 0; i < existing.length; i++) {
        op.deleteObject(existing[i]);
    }
    di.applyOperation(op);
    return existing.length;
};

// ============================================================
// Surface contours pass (formerly the standalone Surface Contours
// tool). Same pipeline as the imagery pass, same anchor, same window
// math above, same curl fetch. What differs: the payload is a 32-bit
// float GeoTIFF (elevations in metres, NAVD88), read through the
// bridge's one faithful binary path (QTextStream + Latin1 -- see
// Core/CsContour.js's header) and turned into polylines by marching
// squares in Core/CsContour.js, where the headless harness tests it.
//
// The elevation grid is a TEMPORARY file: contours are vectors in the
// drawing; once they are drawn the grid has nothing left to say, and
// -- per the project's entrance-location rule -- a georeferenced
// raster is not left lying around the cave folder.
//
// Labels are the contour's elevation in the DRAWING'S unit (NAVD88
// datum), on every major (every 5th) contour.
// ============================================================

/** A number without trailing float noise, for messages and labels. */
CsSurfaceData.fmt = function(v) {
    var r = Math.round(v * 100) / 100;
    return String(r);
};

/**
 * The contour interval in drawing units, from a prompt with a sane
 * default per unit (10 ft / 5 m). null = cancelled or unusable.
 */
CsSurfaceData.askInterval = function(unit) {
    var preset = RSettings.getStringValue("CaveSurvey/ContourInterval", "");
    if (preset === "") {
        preset = (unit === CsUnits.FEET) ? "10" : "5";
    }
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = "Surface Data";
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setLabelText("Contour interval (" + unit + "):");
    dialog.setTextValue(preset);
    var answer = dialog.exec();
    var typed = (answer === 0) ? null : String(dialog.textValue());
    destrDialog(dialog);
    if (typed === null) {
        return null;
    }
    var v = parseFloat(typed);
    if (isNaN(v) || v <= 0) {
        CsTell.warn("Surface Data: \"" + typed + "\" is not a usable " +
            "interval -- a positive number of " + unit + ".");
        return null;
    }
    RSettings.setValue("CaveSurvey/ContourInterval", String(v));
    return v;
};

/**
 * The file's bytes as a latin1 string -- charCodeAt(i) is byte i.
 * The one faithful, fast binary path in this bridge (probed
 * 2026-08-27; see CsContour.js's header).
 */
CsSurfaceData.readBinary = function(path) {
    var file = new QFile(path);
    if (!file.open(QIODevice.ReadOnly)) {
        throw new Error("cannot open " + path);
    }
    var stream = new QTextStream(file);
    stream.setEncoding(QStringConverter.Latin1);
    var content = String(stream.readAll());
    file.close();
    return content;
};

/**
 * Fetches USGS 3DEP elevation over `anchor`, asks for a contour
 * interval, extracts and draws the contours, replacing any previous
 * run. Never pops a dialog for its OUTCOME (the interval prompt is
 * genuine user input, not a result notification): every result comes
 * back as one line for CsSurfaceData.run to fold into the shared
 * report, or null when the user cancelled the interval prompt.
 *
 * \param anchor {lat, lon, pos:{x,y}, name} -- already resolved and,
 *        if it needed one, already given a coordinate by run().
 * \return String describing what happened, or null (cancelled).
 */
CsSurfaceData.contours = function(doc, di, anchor) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    var box = CsSurfaceData.surveyBox(doc, anchor.pos);
    var extent = CsGeoProject.groundExtent(
        { width: box.width, height: box.height }, unit,
        CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);
    var offset = {
        x: CsUnits.convert(box.centerX - anchor.pos.x, unit, CsUnits.METERS),
        y: CsUnits.convert(box.centerY - anchor.pos.y, unit, CsUnits.METERS)
    };
    var bbox = CsGeoProject.mercatorBbox(anchor.lat, anchor.lon,
        extent, offset);
    var size = CsGeoProject.pixelSize(bbox, CsGeoProject.DEM_NATIVE_RES_M,
        CsGeoProject.DEM_MAX_PX, CsGeoProject.DEM_MIN_PX);

    var interval = CsSurfaceData.askInterval(unit);
    if (interval === null) {
        return null;                // cancelled
    }

    // The grid is KEPT, not deleted: it lands beside the drawing as
    // <name>-surface.tif, the same shape (and the same privacy rule)
    // as <name>-aerial.png. The 3D view meshes it into the terrain
    // surface, and re-fetching a 512 px grid every time that panel
    // opens would put a network round trip in front of a view button.
    // An unsaved drawing has nowhere to keep it, so it falls back to
    // the temp copy this pass has always used and removes it after --
    // contours still draw; only the 3D terrain is unavailable until
    // the drawing is saved and this is run again.
    var demPath = CsGeoProject.demPathFor(doc.getFileName());
    var demIsTemp = (demPath === null);
    if (demIsTemp) {
        demPath = QDir.tempPath() + "/cavecad-surface-dem.tif";
    }
    var fetched = CsSurfaceData.fetch(CsGeoProject.demUrl(bbox, size),
        demPath);
    if (fetched !== true) {
        return qsTr("the elevation fetch failed.\n") + fetched;
    }

    var grid;
    try {
        var bytes = CsSurfaceData.readBinary(demPath);
        grid = CsContour.parseFloatTiff(bytes);
    } catch (eParse) {
        QFile.remove(demPath);       // unreadable: keep nothing
        return qsTr("the service's reply could not be read as an "
            + "elevation grid (") + eParse + qsTr("). Try again, or a "
            + "smaller area.");
    }
    if (demIsTemp) {
        QFile.remove(demPath);
    }

    var range = CsContour.range(grid.values);
    if (range === null) {
        return qsTr("the service has no elevation data here (3DEP "
            + "covers the United States).");
    }

    var minU = CsUnits.convert(range.min, CsUnits.METERS, unit);
    var maxU = CsUnits.convert(range.max, CsUnits.METERS, unit);
    var levels = CsContour.levels(minU, maxU, interval);
    if (levels.length === 0) {
        return qsTr("the ground here only spans ") +
            CsSurfaceData.fmt(maxU - minU) + " " + unit + qsTr(", so no ") +
            CsSurfaceData.fmt(interval) + " " + unit + qsTr(" contour "
            + "crosses it. Try a smaller interval.");
    }

    var drawn = CsSurfaceData.drawContours(doc, di, grid, levels, interval,
        bbox, size, anchor, unit);

    // The surface elevation right at the anchor station -- the
    // entrance's ground elevation, the number the lidar thread has
    // always been after. Reported AND stored, as GeoElev.
    var at = CsGeoProject.anchorGridCoord(bbox, grid.width, grid.height,
        anchor.lat, anchor.lon);
    var surf = CsContour.sampleAt(grid.values, grid.width, grid.height,
        at.col, at.row);
    var surfLine = "";
    if (surf !== null) {
        // Stored as GeoElev on the anchor: METRES NAVD88, raw ground,
        // the same store-canonical convention GeoLat/GeoLon follow.
        // This is the drawing's datum anchor -- the one number that
        // lets CsElevation.datumOffset turn a survey elevation into an
        // absolute one -- and it is why the 3D view can stand the cave
        // under its own hillside. RAW GROUND, not the entrance's own
        // elevation: how far the entrance sits below the surface is a
        // guess (CsElevation.ENTRANCE_DEPTH_FT) and a guess must not be
        // cemented into stored data.
        //
        // No survey elevation is touched. The offset is applied on
        // read; rewriting the Elevation tags would rebase the whole
        // cave against a 1 m national DEM.
        //
        // SurfaceBbox rides along: the Mercator window this grid was
        // actually fetched for. The window is computed from the plan
        // data's extent, so it CHANGES as a cave is drawn -- recomputing
        // it later to place the kept grid would register the surface
        // against a window the grid was never cut to, and slide the
        // whole hillside sideways by however much the cave had grown.
        // The grid's own size comes from the TIFF; only the ground it
        // covers has to be remembered. Locating data, so it is stripped
        // with the other geo tags.
        CsTags.commit(di, anchor.entity, {
            GeoElev: surf,
            SurfaceBbox: [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax]
                .join(",")
        });
        surfLine = qsTr("\nSurface at ") +
            (anchor.name !== "" ? anchor.name : "the anchor") + ": " +
            CsSurfaceData.fmt(CsUnits.convert(surf, CsUnits.METERS, unit)) +
            " " + unit + " (NAVD88).";
    }

    return qsTr("drew ") + drawn.lines + qsTr(" contour line") +
        (drawn.lines === 1 ? "" : "s") + qsTr(" at a ") +
        CsSurfaceData.fmt(interval) + " " + unit + qsTr(" interval (") +
        levels.length + qsTr(" level") + (levels.length === 1 ? "" : "s") +
        qsTr(", ground ") + CsSurfaceData.fmt(minU) + qsTr(" to ") +
        CsSurfaceData.fmt(maxU) + " " + unit + ")." + surfLine;
};

/**
 * Extracts every level's polylines, transforms them into drawing
 * coordinates and commits them in ONE operation (one undo step),
 * replacing any previous run. Majors -- every level a multiple of five
 * intervals -- go on CTRL-CONTOUR-MAJOR with an elevation label at
 * their midpoint; the rest on CTRL-CONTOUR.
 *
 * EVERYTHING GOES INSIDE ONE BLOCK (CsContour.BLOCK), inserted once at
 * the drawing's origin with identity scale and rotation, so one click
 * selects the whole surface instead of a window-select over a thousand
 * separate polylines that also catches the cave. The layers are still
 * the entities' own, inside the block, so CTRL-CONTOUR and
 * CTRL-CONTOUR-MAJOR keep switching them off and styling them.
 *
 * \return {lines: n}
 */
CsSurfaceData.drawContours = function(doc, di, grid, levels, interval, bbox,
        size, anchor, unit) {
    var toDrawing = CsGeoProject.gridTransform(bbox, grid.width,
        grid.height, anchor, unit);

    // Build everything BEFORE touching the document, so a failure
    // leaves the drawing exactly as it was.
    var entities = [];
    var lineCount = 0;
    for (var li = 0; li < levels.length; li++) {
        var levelU = levels[li];
        var levelM = CsUnits.convert(levelU, unit, CsUnits.METERS);
        var isMajor = Math.round(levelU / interval) % 5 === 0;
        var layer = isMajor ? CsLayers.CTRL_CONTOUR_MAJOR : CsLayers.CTRL_CONTOUR;
        var runs = CsContour.lines(grid.values, grid.width, grid.height,
            levelM);
        for (var ri = 0; ri < runs.length; ri++) {
            var run = runs[ri];
            if (run.points.length < 2) {
                continue;
            }
            var data = new RPolylineData();
            for (var k = 0; k < run.points.length; k++) {
                var p = toDrawing(run.points[k].x, run.points[k].y);
                data.appendVertex(new RVector(p.x, p.y));
            }
            if (run.closed) {
                data.setClosed(true);
            }
            var pl = new RPolylineEntity(doc, data);
            pl.setLayerId(doc.getLayerId(layer));
            CsTags.set(pl, "SurfaceContours", "1");
            CsTags.set(pl, "ContourElevation", String(levelU));
            entities.push(pl);
            lineCount++;

            // one label per major run, at its middle vertex
            if (isMajor) {
                var mid = run.points[Math.floor(run.points.length / 2)];
                var mp = toDrawing(mid.x, mid.y);
                var label = new RTextData(
                    new RVector(mp.x, mp.y), new RVector(mp.x, mp.y),
                    CsDraw.TEXT_HEIGHT, 100.0, RS.VAlignMiddle,
                    RS.HAlignCenter, RS.LeftToRight, RS.Exact, 1.0,
                    CsSurfaceData.fmt(levelU), "standard",
                    false, false, 0.0, false);
                var te = new RTextEntity(doc, label);
                te.setLayerId(doc.getLayerId(layer));
                CsTags.set(te, "SurfaceContours", "1");
                entities.push(te);
            }
        }
    }

    // Only now is the document touched. The previous run goes FIRST,
    // and goes completely: its linework, its reference, and the block
    // DEFINITION itself. Refilling a surviving definition would leave a
    // drawing carrying the old fetch's extent inside a block claiming
    // to hold the new one.
    CsSurfaceData.eraseExistingContours(doc, di);
    CsLayers.ensure(doc, di, CsLayers.CTRL_CONTOUR);
    CsLayers.ensure(doc, di, CsLayers.CTRL_CONTOUR_MAJOR);

    // THE BASE POINT IS THE ENTRANCE, not the drawing origin: that is
    // the grip a caver grabs, and the surface's one meaningful handle
    // is the station the whole fetch was anchored on.
    var base = new RVector(anchor.pos.x, anchor.pos.y);
    var blockId = CsSurfaceData.contourBlockId(doc, di, base);
    if (blockId === null) {
        return { lines: 0 };
    }
    for (var bz = 0; bz < entities.length; bz++) {
        entities[bz].setBlockId(blockId);
    }

    // Land the new set just above the drawing's floor -- over the
    // aerial photograph, under everything drawn since. The basemap,
    // when present, is pushed one step further down so the stack stays
    // photo < contours < survey. The DRAW ORDER IS THE REFERENCE'S:
    // that one entity is what model space stacks, and the contents
    // inside the block ride with it.
    var floor = doc.getStorage().getMinDrawOrder() - 1;
    var basemaps = CsSurfaceData.findBasemapCandidates(doc);
    if (basemaps.length > 0) {
        var lower = new RModifyObjectsOperation();
        for (var bi = 0; bi < basemaps.length; bi++) {
            basemaps[bi].setDrawOrder(floor - 1);
            lower.addObject(basemaps[bi], false);
        }
        di.applyOperation(lower);
    }

    // One insert, AT THE BASE POINT, scale 1, rotation 0. A block
    // reference draws its contents shifted by (insert - base), so
    // inserting at the base point shifts them by nothing: the contour
    // geometry inside the block stays in drawing coordinates, which is
    // what CsContour.drawnEntities' readers depend on, while the grip
    // the caver drags sits on the entrance instead of on a drawing
    // origin that may be nowhere near the cave.
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, base,
            new RVector(1, 1), 0.0));
    ref.setLayerId(doc.getLayerId(CsLayers.CTRL_CONTOUR));
    ref.setDrawOrder(floor);
    CsTags.set(ref, "SurfaceContours", "1");
    entities.push(ref);

    var op = new RAddObjectsOperation();
    op.setText("Draw surface contours");
    for (var ei = 0; ei < entities.length; ei++) {
        op.addObject(entities[ei], false);
    }
    di.applyOperation(op);

    return { lines: lineCount };
};

/**
 * The contour block, made if this drawing has none yet, with its base
 * point at `base` -- the entrance station. Empty on the way out: the
 * fetch that calls this has already erased the previous run,
 * definition and all.
 *
 * A base point that disagrees with where the reference is inserted
 * shifts every contour by the difference, so these two are set
 * together and nowhere else.
 *
 * \return the block id, or null when it could not be made.
 */
CsSurfaceData.contourBlockId = function(doc, di, base) {
    var at = isNull(base) ? new RVector(0, 0) :
        new RVector(base.x, base.y);
    var existing = CsContour.blockIdOf(doc);
    if (existing !== null) {
        return existing;
    }
    var block = new RBlock(doc, CsContour.BLOCK, at);
    di.applyOperation(new RAddObjectOperation(block, false));
    return CsContour.blockIdOf(doc);
};

/**
 * Deletes any previous contour set so a re-run replaces it, COMPLETELY:
 * the linework and labels inside the contour block, the loose
 * polylines older builds drew straight into model space, the block
 * reference, and finally the block DEFINITION itself. The tag,
 * SurfaceContours=1, is the standalone tool's original tag -- see the
 * file header on why it was not renamed.
 *
 * The definition goes too, rather than being refilled, so a fetch can
 * never inherit anything from the one before it: a definition that
 * survives keeps its old base point, its old contents' draw orders and
 * whatever a caver did to it in between, and a half-replaced block is
 * invisible until it is printed.
 *
 * TWO OPERATIONS, in this order. The contents and the reference go
 * first; the block object goes second, once nothing is left pointing
 * into it. Deleting a block with live entities still inside it in the
 * same operation leaves the storage to cascade, which is exactly the
 * kind of thing that gets found later in a DXF that will not reopen.
 *
 * \return the number of entities removed (the block itself is not
 *         counted).
 */
CsSurfaceData.eraseExistingContours = function(doc, di) {
    var doomed = CsContour.drawnEntities(doc);
    if (doomed.length > 0) {
        var op = new RDeleteObjectsOperation();
        op.setText("Erase surface contours");
        for (var k = 0; k < doomed.length; k++) {
            op.deleteObject(doomed[k]);
        }
        di.applyOperation(op);
    }

    var blockId = CsContour.blockIdOf(doc);
    if (blockId !== null) {
        var block = doc.queryBlock(blockId);
        if (!isNull(block)) {
            // Never while it is the block being edited: that would
            // delete the space under the caver's own cursor.
            if (blockId === doc.getCurrentBlockId() &&
                    typeof Block !== "undefined" &&
                    typeof Block.editBlock === "function") {
                Block.editBlock(di,
                    doc.getBlockName(doc.getModelSpaceBlockId()));
            }
            var drop = new RDeleteObjectsOperation();
            drop.setText("Erase surface contours");
            drop.deleteObject(block);
            di.applyOperation(drop);
        }
    }
    return doomed.length;
};

// ============================================================
// The composer -- one anchor resolution, two independently switchable
// passes, one report. This is what CsSurfaceData answers to; the tool
// wrapper (SurfaceData/SurfaceData.js) is only the dialog and the
// QMessageBox.
// ============================================================

/**
 * Needs an ACTIVE drawing for the same reason CsRepair.run does for
 * its rebuild pass: CsSurfaceData.basemap/contours read and write
 * through `doc`/`di` directly (not through CsDraw.survey), so unlike
 * CsRepair this file has NO such trap -- any doc/di pair works, not
 * only the active one. Documented here because CsRepair.run's own
 * comment raises exactly this question for its neighbour in the same
 * menu stage, and the honest answer for this file is "no such trap,
 * verified against tests/surface_data_run.js's non-active fixture
 * documents."
 *
 * \param opts Object with boolean imagery, contours. A missing key
 *             means run that pass -- the dialog's default is both.
 * \return {lines: Array of String, ok: Boolean}
 */
CsSurfaceData.run = function(doc, di, opts) {
    if (isNull(opts)) {
        opts = {};
    }
    var wantImagery = opts.imagery !== false;
    var wantContours = opts.contours !== false;

    // Both off: nothing needs the anchor, so nothing asks for it --
    // the honest report is two skipped lines and no interruption.
    if (!wantImagery && !wantContours) {
        return { ok: true, lines: [qsTr("Aerial: skipped."),
                                    qsTr("Contours: skipped.")] };
    }

    // Checked ONCE, before either pass reaches for the network: both
    // passes need the same geo anchor, and the two former tools used
    // to ask (and warn) about it twice -- once each, in the same run.
    var anchor = CsSurfaceData.findAnchor(doc);
    if (anchor.error !== undefined) {
        return { ok: false, lines: [anchor.error] };
    }

    if (anchor.lat === null) {
        // A station to anchor to, but no coordinate yet -- ask, then
        // store it exactly as Geo Reference would (the entity is
        // already in the document, so CsTags.commit's modify
        // operation is the right tool here, unlike the image entity
        // below which is tagged BEFORE it is ever added).
        var coord = CsLocationPick.ask("Surface Data", "");
        if (coord === null) {
            return { ok: false,
                lines: [qsTr("Surface Data: cancelled -- no location "
                    + "was set.")] };
        }
        CsTags.commit(di, anchor.entity, {
            GeoLat: coord.lat,
            GeoLon: coord.lon,
            GeoStation: anchor.name !== "" ? anchor.name : "anchor",
            // pin WHERE the coordinate was declared -- see
            // CsLocationPick.resolveMovedAnchor
            GeoDrawX: anchor.pos.x,
            GeoDrawY: anchor.pos.y
        });
        CsLocationPick.remember(coord);
        anchor.lat = coord.lat;
        anchor.lon = coord.lon;
    } else {
        // the entrance may have been dragged to its true spot over
        // previously fetched imagery: offer to recompute its
        // coordinate from where it now sits (and pin pre-pin drawings
        // either way). Asked once here, where the two former tools
        // each asked it separately.
        CsLocationPick.resolveMovedAnchor(doc, di, anchor, "Surface Data");
    }

    var lines = [];
    if (wantImagery) {
        lines.push(qsTr("Aerial: ") + CsSurfaceData.basemap(doc, di, anchor));
    } else {
        lines.push(qsTr("Aerial: skipped."));
    }
    if (wantContours) {
        var report = CsSurfaceData.contours(doc, di, anchor);
        lines.push(report === null ?
            qsTr("Contours: cancelled.") : qsTr("Contours: ") + report);
    } else {
        lines.push(qsTr("Contours: skipped."));
    }
    return { ok: true, lines: lines };
};
