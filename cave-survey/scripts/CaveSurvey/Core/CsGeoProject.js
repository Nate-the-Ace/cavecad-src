// CsGeoProject.js -- projection and imagery-request math.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness can test all of it.
//
// WHY WEB MERCATOR. The obvious way to ask an ArcGIS ImageServer for a
// picture is to hand it a lat/lon bbox (EPSG:4326). That produces a
// STRETCHED image: a degree of longitude is cos(latitude) shorter than
// a degree of latitude, so ground metres per pixel differ between the
// axes. Measured against USGS NAIP at latitude 39.16: 1.08 m/px across
// versus 1.39 m/px down. A CAD image entity carries one uniform scale,
// so such an image can never be placed correctly. Working in EPSG:3857
// throughout -- and matching the requested pixel aspect to the bbox
// aspect -- keeps ground pixels square, at the cost of one cos(lat)
// factor when converting between ground metres and Mercator metres.
//
// Mercator inflates distance by 1/cos(lat). Over a cave-sized area that
// factor is effectively constant, so a single anchor latitude is enough.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsUnits.js");

var CsGeoProject = {};

// Semi-major axis of the WGS84 ellipsoid, which spherical Web Mercator
// uses as the sphere radius.
CsGeoProject.EARTH_RADIUS = 6378137.0;

// Half the Mercator world, i.e. toMercator(0, 180).x.
CsGeoProject.WORLD_HALF = Math.PI * CsGeoProject.EARTH_RADIUS;

// The USGS NAIP ImageServer's own reported extent, in EPSG:3857
// (from the service's ?f=json, 2026-08-20). Used to refuse a request
// before it costs a round trip.
CsGeoProject.NAIP_EXTENT_3857 = {
    xmin: -13896162.899973024,
    ymin: 2812730.7000011485,
    xmax: -7441890.599985033,
    ymax: 6372359.699994525
};

CsGeoProject.NAIP_URL =
    "https://imagery.nationalmap.gov/arcgis/rest/services/" +
    "USGSNAIPImagery/ImageServer/exportImage";

// Native NAIP resolution in metres per pixel, and the service's
// documented maximum image dimension.
CsGeoProject.NATIVE_RES_M = 0.3;
CsGeoProject.MAX_PX = 4000;
CsGeoProject.MIN_PX = 256;

// Fraction added around the survey's own extent.
CsGeoProject.MARGIN = 0.25;

// Smallest sensible window, in metres, for a drawing with one station
// or no extent at all.
CsGeoProject.FLOOR_M = 150;

// The USGS 3DEP elevation service -- same National Map family as NAIP,
// public domain, keyless. Native ~1 m where lidar exists. Extent from
// the service's ?f=json (2026-08-27): effectively worldwide-bbox (it
// spans the dateline for Alaska), so no coverage pre-check is useful --
// a location with no data comes back as a no-data grid instead.
CsGeoProject.DEM_URL =
    "https://elevation.nationalmap.gov/arcgis/rest/services/" +
    "3DEPElevation/ImageServer/exportImage";
CsGeoProject.DEM_NATIVE_RES_M = 1.0;
// Contours don't need imagery-grade resolution, and marching squares
// over the grid runs in script: 512x512 is plenty and stays fast.
CsGeoProject.DEM_MAX_PX = 512;
CsGeoProject.DEM_MIN_PX = 64;

/**
 * The exportImage request for a float32 elevation grid.
 */
CsGeoProject.demUrl = function(bbox, size) {
    return CsGeoProject.DEM_URL +
        "?bbox=" + bbox.xmin.toFixed(3) + "," + bbox.ymin.toFixed(3) + "," +
        bbox.xmax.toFixed(3) + "," + bbox.ymax.toFixed(3) +
        "&bboxSR=3857" +
        "&imageSR=3857" +
        "&size=" + size.w + "," + size.h +
        "&format=tiff" +
        "&pixelType=F32" +
        "&f=image";
};

/**
 * A function mapping DEM grid coordinates (col, row; row 0 the top,
 * pixel CENTERS) to drawing coordinates, through the same anchor the
 * basemap placement uses.
 *
 * \param anchor {lat, lon, pos:{x,y}} -- the drawing's geo station.
 */
CsGeoProject.gridTransform = function(bbox, w, h, anchor, unitName) {
    var psx = (bbox.xmax - bbox.xmin) / w;
    var psy = (bbox.ymax - bbox.ymin) / h;
    var am = CsGeoProject.toMercator(anchor.lat, anchor.lon);
    var cosLat = Math.cos(anchor.lat * Math.PI / 180.0);
    return function(col, row) {
        var mx = bbox.xmin + (col + 0.5) * psx;
        var my = bbox.ymax - (row + 0.5) * psy;
        return {
            x: anchor.pos.x + CsUnits.convert((mx - am.x) * cosLat,
                CsUnits.METERS, unitName),
            y: anchor.pos.y + CsUnits.convert((my - am.y) * cosLat,
                CsUnits.METERS, unitName)
        };
    };
};

/**
 * Where the anchor's own coordinate falls in the DEM grid, as
 * fractional (col, row) -- for sampling the surface elevation at the
 * geo station.
 */
CsGeoProject.anchorGridCoord = function(bbox, w, h, anchorLat, anchorLon) {
    var am = CsGeoProject.toMercator(anchorLat, anchorLon);
    var psx = (bbox.xmax - bbox.xmin) / w;
    var psy = (bbox.ymax - bbox.ymin) / h;
    return {
        col: (am.x - bbox.xmin) / psx - 0.5,
        row: (bbox.ymax - am.y) / psy - 0.5
    };
};

/**
 * The latitude/longitude a DRAWING POINT sits at, through a pinned
 * georeference frame -- the exact inverse of the placement math
 * gridTransform runs, so a point picked off georeferenced imagery
 * converts back to the world coordinate the imagery was placed by.
 *
 * \param point    {x, y} in drawing units.
 * \param frame    {lat, lon, x, y}: the anchor's world coordinate and
 *                 the DRAWING position it was pinned at (GeoDrawX/Y).
 * \param unitName CsUnits.FEET or CsUnits.METERS.
 */
CsGeoProject.latLonAtDrawingPoint = function(point, frame, unitName) {
    var am = CsGeoProject.toMercator(frame.lat, frame.lon);
    // ground metres inflate by 1/cos(lat) on the way into Mercator
    var inflate = 1.0 / Math.cos(frame.lat * Math.PI / 180.0);
    var mx = am.x + CsUnits.convert(point.x - frame.x, unitName,
        CsUnits.METERS) * inflate;
    var my = am.y + CsUnits.convert(point.y - frame.y, unitName,
        CsUnits.METERS) * inflate;
    return CsGeoProject.fromMercator(mx, my);
};

/**
 * Latitude/longitude in degrees -> EPSG:3857 metres.
 */
CsGeoProject.toMercator = function(lat, lon) {
    var x = CsGeoProject.EARTH_RADIUS * (lon * Math.PI / 180.0);
    var latRad = lat * Math.PI / 180.0;
    var y = CsGeoProject.EARTH_RADIUS *
        Math.log(Math.tan(Math.PI / 4.0 + latRad / 2.0));
    return { x: x, y: y };
};

/**
 * EPSG:3857 metres -> latitude/longitude in degrees.
 */
CsGeoProject.fromMercator = function(x, y) {
    var lon = (x / CsGeoProject.EARTH_RADIUS) * 180.0 / Math.PI;
    var lat = (2.0 * Math.atan(Math.exp(y / CsGeoProject.EARTH_RADIUS)) -
        Math.PI / 2.0) * 180.0 / Math.PI;
    return { lat: lat, lon: lon };
};

/**
 * The ground window to fetch, in metres.
 *
 * \param drawingBox {width, height} in the drawing's own units.
 * \param unitName   CsUnits.FEET or CsUnits.METERS.
 * \param marginFrac fraction to add around the survey (0.25 = 25%).
 * \param floorM     smallest window per axis, in metres.
 */
CsGeoProject.groundExtent = function(drawingBox, unitName, marginFrac, floorM) {
    if (marginFrac === undefined || marginFrac === null) {
        marginFrac = CsGeoProject.MARGIN;
    }
    if (floorM === undefined || floorM === null) {
        floorM = CsGeoProject.FLOOR_M;
    }
    var w = CsUnits.convert(Math.abs(drawingBox.width), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    var h = CsUnits.convert(Math.abs(drawingBox.height), unitName,
        CsUnits.METERS) * (1.0 + marginFrac);
    return {
        width: Math.max(w, floorM),
        height: Math.max(h, floorM)
    };
};

/**
 * The request bbox in EPSG:3857, centred on the anchor and then shifted
 * by anchorOffsetM.
 *
 * \param groundExtent {width, height} in ground metres.
 * \param anchorOffsetM {x, y} ground metres from the anchor to the
 *        centre of the window (the survey rarely centres on its
 *        entrance). East and north positive.
 */
CsGeoProject.mercatorBbox = function(anchorLat, anchorLon, groundExtent,
                                    anchorOffsetM) {
    if (anchorOffsetM === undefined || anchorOffsetM === null) {
        anchorOffsetM = { x: 0, y: 0 };
    }
    // Mercator stretches ground distance by 1/cos(lat).
    var inflate = 1.0 / Math.cos(anchorLat * Math.PI / 180.0);
    var center = CsGeoProject.toMercator(anchorLat, anchorLon);
    var cx = center.x + anchorOffsetM.x * inflate;
    var cy = center.y + anchorOffsetM.y * inflate;
    var halfW = (groundExtent.width * inflate) / 2.0;
    var halfH = (groundExtent.height * inflate) / 2.0;
    return {
        xmin: cx - halfW,
        ymin: cy - halfH,
        xmax: cx + halfW,
        ymax: cy + halfH
    };
};

/**
 * Pixel dimensions for a bbox: native resolution where it fits, capped
 * at the service limit, floored so a tiny window still yields a usable
 * picture. Aspect always matches the bbox, which is what keeps ground
 * pixels square.
 *
 * Both axes are always scaled by the SAME factor, at every step, so
 * the aspect is preserved by construction rather than being repaired
 * afterwards by re-deriving one axis (which is exactly what silently
 * distorted every bbox more elongate than maxPx/minPx = 15.625:1: the
 * old code re-clamped only the recomputed axis, leaving the other one
 * wherever the previous step had left it).
 *
 * When the bbox is more elongate than maxPx/minPx, the cap and the
 * floor cannot both be honoured without distorting the aspect --
 * aspect preservation wins and the floor yields. The floor exists only
 * to avoid requesting a needlessly tiny image; a wrong aspect makes
 * the photograph geometrically incorrect under the survey, which is
 * the one thing this whole Mercator-request path exists to prevent.
 * In practice the short axis being under the floor is harmless: e.g. a
 * 40 m wide passage strip left at 150 px is still about 0.27 m/px,
 * finer than NAIP's own 0.3 m native resolution.
 */
CsGeoProject.pixelSize = function(bbox, nativeResM, maxPx, minPx) {
    if (nativeResM === undefined || nativeResM === null) {
        nativeResM = CsGeoProject.NATIVE_RES_M;
    }
    if (maxPx === undefined || maxPx === null) {
        maxPx = CsGeoProject.MAX_PX;
    }
    if (minPx === undefined || minPx === null) {
        minPx = CsGeoProject.MIN_PX;
    }
    var mw = bbox.xmax - bbox.xmin;
    var mh = bbox.ymax - bbox.ymin;

    // Ideal size at native resolution. Aspect is exact by construction:
    // both axes divide by the same nativeResM.
    var w = mw / nativeResM;
    var h = mh / nativeResM;

    // One shared downscale factor to fit the cap.
    var down = Math.min(1.0, maxPx / w, maxPx / h);
    w *= down;
    h *= down;

    // One shared upscale factor to reach the floor -- but never past
    // the cap. If the cap already pinned the longer axis at maxPx,
    // this reduces to 1 (no upscale), which is the floor yielding to
    // aspect preservation described above.
    var up = Math.max(1.0, minPx / w, minPx / h);
    up = Math.min(up, maxPx / Math.max(w, h));
    w *= up;
    h *= up;

    return {
        w: Math.max(1, Math.round(w)),
        h: Math.max(1, Math.round(h))
    };
};

/**
 * Drawing units per image pixel, i.e. the image entity's scale.
 *
 * The bbox is in Mercator metres, so multiplying by cos(lat) brings it
 * back to ground metres before the unit conversion.
 */
CsGeoProject.drawingUnitsPerPixel = function(bbox, pixelW, anchorLat, unitName) {
    var mercPerPx = (bbox.xmax - bbox.xmin) / pixelW;
    var groundPerPx = mercPerPx * Math.cos(anchorLat * Math.PI / 180.0);
    return CsUnits.convert(groundPerPx, CsUnits.METERS, unitName);
};

/**
 * True when the whole bbox falls inside NAIP's published coverage.
 */
CsGeoProject.insideCoverage = function(bbox) {
    var e = CsGeoProject.NAIP_EXTENT_3857;
    return bbox.xmin >= e.xmin && bbox.xmax <= e.xmax &&
        bbox.ymin >= e.ymin && bbox.ymax <= e.ymax;
};

/**
 * The exportImage request for a bbox and pixel size.
 */
CsGeoProject.naipUrl = function(bbox, size) {
    return CsGeoProject.NAIP_URL +
        "?bbox=" + bbox.xmin.toFixed(3) + "," + bbox.ymin.toFixed(3) + "," +
        bbox.xmax.toFixed(3) + "," + bbox.ymax.toFixed(3) +
        "&bboxSR=3857" +
        "&imageSR=3857" +
        "&size=" + size.w + "," + size.h +
        "&format=png" +
        "&f=image";
};

/**
 * Where the basemap image for a drawing belongs: beside it, under a
 * neutral name. Deliberately carries no coordinates -- see the
 * project's entrance-location rule. Returns null for an unsaved
 * drawing, which has nowhere stable to put it.
 */
CsGeoProject.imagePathFor = function(documentPath) {
    if (documentPath === undefined || documentPath === null ||
        documentPath === "") {
        return null;
    }
    var cut = documentPath.lastIndexOf(".");
    var slash = Math.max(documentPath.lastIndexOf("/"),
        documentPath.lastIndexOf("\\"));
    if (cut > slash) {
        return documentPath.substring(0, cut) + "-aerial.png";
    }
    return documentPath + "-aerial.png";
};

/**
 * Where the elevation grid for a drawing lives: the drawing's own path
 * with its extension replaced by "-surface.tif".
 *
 * Same shape, same reasoning and the same privacy rule as
 * imagePathFor: a neutral filename with no coordinates in it, sitting
 * beside the drawing so a cave folder carries its surface with it. The
 * grid is locating data -- PackageCave must leave it out of a
 * sanitized archive exactly as it leaves out the photograph.
 *
 * Kept rather than deleted (Surface Data used to remove its temp copy)
 * because the 3D view meshes it into the terrain surface, and
 * re-fetching a 512 px grid every time that panel opens would put a
 * network round trip in front of a view button.
 *
 * \return the path, or null when the document has never been saved.
 */
CsGeoProject.demPathFor = function(documentPath) {
    if (documentPath === undefined || documentPath === null ||
        documentPath === "") {
        return null;
    }
    var cut = documentPath.lastIndexOf(".");
    var slash = Math.max(documentPath.lastIndexOf("/"),
        documentPath.lastIndexOf("\\"));
    if (cut > slash) {
        return documentPath.substring(0, cut) + "-surface.tif";
    }
    return documentPath + "-surface.tif";
};
