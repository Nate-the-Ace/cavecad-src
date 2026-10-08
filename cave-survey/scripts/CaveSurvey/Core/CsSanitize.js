// CsSanitize.js -- writing a copy of a cave drawing with the cave's
// location taken out of it.
//
// Part of the Cave Survey Core library. QCAD context: it opens a
// drawing into a memory document and exports it again. The file on disk
// is never opened for writing, and the caver's own drawing is never
// touched.
//
// WHY IT IS IN CORE. This was PackageCave's, and it was the only copy,
// which was correct while packaging was the only thing that shared a
// cave. The teaching cave shares one too -- a sanitized master a
// student resets to -- and the alternative was a second implementation
// of the suite's FIRST RULE. Two sanitizers is one sanitizer that will
// one day be updated and one that will not.
//
// THE RULE IT ENFORCES. A cave folder carries the entrance three ways:
//
//   1. GeoLat / GeoLon / GeoStation tags on the anchor station,
//   2. a georeferenced aerial photograph, which needs no tags at all
//      to give a location away -- the geodata is baked into where the
//      raster sits,
//   3. the survey model's own #Fix / *fix control, which most
//      interchange writers emit (CsPackage.sanitizeSurvey).
//
// This file owns the first two, which are what live in a DRAWING. The
// third belongs to whoever writes the data files.
//
// A COPY THAT CANNOT STRIP IS NOT WRITTEN. Not written empty, not
// written with a warning -- not written. The whole promise of a
// sanitized file is a negative one, and a negative promise that fails
// open is worse than never having made it.

var CsSanitize = {};

/**
 * Removes the geographic anchor from every entity carrying it.
 *
 * \return how many entities were stripped.
 */
CsSanitize.stripGeoTags = function(doc, di) {
    var stripped = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }

        var carries = false;
        for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
            if (CsTags.get(e, CsPackage.GEO_TAGS[t]) !== null &&
                    CsTags.get(e, CsPackage.GEO_TAGS[t]) !== undefined &&
                    CsTags.get(e, CsPackage.GEO_TAGS[t]) !== "") {
                carries = true;
            }
        }
        if (!carries) { continue; }

        for (var r = 0; r < CsPackage.GEO_TAGS.length; r++) {
            CsTags.remove(e, CsPackage.GEO_TAGS[r]);
        }
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
        stripped++;
    }
    return stripped;
};

/**
 * Every layer in the document that would SILENTLY REFUSE an edit.
 *
 * Off and frozen layers refuse adds, deletes and modifies without a
 * word in this build -- the lesson this codebase has learned four
 * separate times. Sanitizing has to reach through that, because the
 * thing most likely to be on a hidden layer is exactly the thing
 * sanitizing exists to remove: CTRL-AERIAL is off by default, and the
 * aerial photograph sitting on it carries the entrance baked into the
 * raster.
 */
CsSanitize.lockedLayers = function(doc) {
    var out = [];
    try {
        var ids = doc.queryAllLayers();
        for (var i = 0; i < ids.length; i++) {
            var lay = doc.queryLayer(ids[i]);
            if (!isNull(lay) && CsLayers.refusesEdits(lay)) {
                out.push(String(lay.getName()));
            }
        }
    } catch (e) {
    }
    return out;
};

/** The DXF export filter this build calls dxflib, or "". */
CsSanitize.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
            var label = String(filters[i]);
            if (label.indexOf("dxflib") !== -1 &&
                    label.indexOf("*.dxf") !== -1) {
                return filters[i];
            }
        }
    } catch (e) {
    }
    return "";
};

/**
 * Reads `sourcePath`, takes the location out, and writes `targetPath`.
 *
 * \return {ok, stripped, basemaps, error}
 */
CsSanitize.writeCopy = function(sourcePath, targetPath) {
    var result = { ok: false, stripped: 0, basemaps: 0, error: "" };
    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), createSpatialIndex()));
    try {
        if (di.importFile(sourcePath, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            result.error = "Could not read the drawing.";
            return result;
        }
        var doc = di.getDocument();

        // WITH EVERY LAYER EDITABLE. Off and frozen layers refuse edits
        // in silence, and CTRL-AERIAL -- where the aerial photograph
        // lives -- is off by default. Measured on Truitt Cave,
        // 2026-09-10: the erase ran, reported nothing to do, and the
        // georeferenced image sat in the "sanitized" copy untouched.
        // Every promise this file makes was passing while the one thing
        // most likely to give a cave away was the one thing it could
        // not reach.
        CsLayers.withLayersOn(doc, di, CsSanitize.lockedLayers(doc),
                function() {
            result.stripped = CsSanitize.stripGeoTags(doc, di);

        // A basemap image is georeferenced -- built from a real-world
        // bounding box around the entrance -- so it carries the same
        // location it took to fetch it. Stripping the geo TAGS is not
        // enough: the location they hid is still sitting there in plain
        // sight, baked into the raster instead of into XDATA.
        //
        // A MISSING ERASER REFUSES THE WHOLE COPY. This was once a
        // quiet "if available" guard, and it silently stopped firing
        // the moment the standalone tool it named was merged away --
        // which would have shipped georeferenced imagery inside a file
        // whose entire promise is that the location is gone.
            if (typeof CsSurfaceData === "undefined" ||
                    typeof CsSurfaceData.eraseExistingImagery !==
                        "function") {
                result.error = "Cannot sanitize: the basemap eraser " +
                    "(CsSurfaceData.eraseExistingImagery) is missing, " +
                    "so aerial imagery could not be removed. No " +
                    "sanitized copy has been written.";
                return;
            }
            result.basemaps = CsSurfaceData.eraseExistingImagery(doc, di);
        });
        if (result.error !== "") {
            return result;
        }

        result.ok = di.exportFile(targetPath, CsSanitize.dxfFilter());
        if (!result.ok) {
            result.error = "Could not write the sanitized drawing.";
        }
    } catch (e) {
        result.ok = false;
        result.error = "Sanitizing failed: " + e;
    } finally {
        // destr() is QCAD's own safe destroyer and is what PackageCave
        // used here; a context without it leaks a memory document,
        // which costs memory and never correctness.
        try {
            if (typeof destr === "function") {
                destr(di);
            }
        } catch (eDestroy) {
        }
    }
    return result;
};
