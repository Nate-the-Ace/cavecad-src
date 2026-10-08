// LocationPick.js -- pick a cave location by clicking a map.
//
// Part of the Cave Survey Core library. GUI-adjacent (like Pick.js):
// it opens dialogs and the system browser, so it is not part of the
// pure headlessly-tested set.
//
// QCAD's script bridge has no embeddable web view, so the map opens
// in the SYSTEM BROWSER instead: a self-contained Leaflet page,
// written to the temp folder, centered on the continental US, with a
// hybrid layer (Esri world imagery + place labels) and plain OSM
// streets as alternatives. Clicking the map drops a pin, shows the
// coordinate both ways (decimal and DMS) and copies it to the
// clipboard; the user pastes it into the QCAD prompt that is already
// waiting. Needs internet for map tiles -- the page says so when
// offline, and typing coordinates by hand always still works.

var CsLocationPick = {};

// One declared location serves every tool. Priority: the drawing's
// Geo Reference anchor (authoritative -- it is pinned to a station),
// then the last location the user declared ANYWHERE (map pick or
// typed), kept in RSettings so declination checks, new drawings and
// the Notebook all start from it. A manually declared location is
// trusted: tools prefill it instead of asking again from scratch.

CsLocationPick.SETTING_LAT = "CaveSurvey/LastLocationLat";
CsLocationPick.SETTING_LON = "CaveSurvey/LastLocationLon";

/** Remembers a declared location for every other tool. */
CsLocationPick.remember = function(coord) {
    try {
        RSettings.setValue(CsLocationPick.SETTING_LAT, coord.lat);
        RSettings.setValue(CsLocationPick.SETTING_LON, coord.lon);
    } catch (e) {
        // settings unavailable -- non-critical
    }
};

/**
 * The location the suite already knows, or null.
 * 
eturn {lat, lon, source} with source "anchor" (a Geo Reference
 *         in this drawing) or "last" (the last one declared anywhere)
 */
CsLocationPick.getShared = function(doc) {
    if (doc !== undefined && doc !== null) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var lat = CsTags.getNumber(e, "GeoLat");
            var lon = CsTags.getNumber(e, "GeoLon");
            if (lat !== null && lon !== null) {
                return { lat: lat, lon: lon, source: "anchor" };
            }
        }
    }
    try {
        var sl = RSettings.getDoubleValue(CsLocationPick.SETTING_LAT, -999);
        var so = RSettings.getDoubleValue(CsLocationPick.SETTING_LON, -999);
        if (sl > -999 && so > -999) {
            return { lat: sl, lon: so, source: "last" };
        }
    } catch (e) {
        // settings unavailable
    }
    return null;
};

// How far (drawing units) the geo station may sit from where its
// coordinate was pinned before it counts as MOVED. Snap jitter and
// float noise stay under this; a deliberate drag is far over it.
CsLocationPick.MOVE_EPS = 0.05;

/**
 * The drawing's geo anchor as a full record -- {entity, station, lat,
 * lon, pos, pinX, pinY} -- or null when the drawing has none. pinX/Y
 * are the DRAWING position the coordinate was pinned at (GeoDrawX/Y
 * tags), null on drawings georeferenced before those tags existed.
 */
CsLocationPick.anchorRecord = function(doc) {
    if (doc === undefined || doc === null) {
        return null;
    }
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var lat = CsTags.getNumber(e, "GeoLat");
        var lon = CsTags.getNumber(e, "GeoLon");
        if (lat === null || lon === null) {
            continue;
        }
        var pos = (typeof e.getPosition === "function") ?
            e.getPosition() : null;
        return {
            entity: e,
            station: CsTags.get(e, "GeoStation"),
            lat: lat, lon: lon,
            pos: pos,
            pinX: CsTags.getNumber(e, "GeoDrawX"),
            pinY: CsTags.getNumber(e, "GeoDrawY"),
            elev: CsTags.getNumber(e, "GeoElev")
        };
    }
    return null;
};

// Every tag that belongs to the PLACE the anchor marks rather than to
// the station point it rides on. A redraw erases that point and draws
// a new one, so whoever re-homes the anchor must carry ALL of these --
// the three-tag copies that predated this list dropped GeoElev and
// SurfaceBbox on every notebook Draw, and the 3D view lost its
// hillside (found on Truitt Cave, 2026-09-25). GeoDrawX/Y are not
// here: the pin is re-set at the redrawn position, never copied.
CsLocationPick.CARRIED_TAGS = ["GeoLat", "GeoLon", "GeoStation",
    "GeoElev", "SurfaceBbox"];

/**
 * Snapshot of the anchor tags on `entity`, to hand to rehome() after a
 * redraw. Only tags actually present are kept, so re-homing never
 * writes an empty GeoElev onto a drawing that never had one.
 */
CsLocationPick.carriedTags = function(entity) {
    var out = {};
    for (var i = 0; i < CsLocationPick.CARRIED_TAGS.length; i++) {
        var k = CsLocationPick.CARRIED_TAGS[i];
        var v = CsTags.get(entity, k);
        if (v !== "" && v !== null && v !== undefined) {
            out[k] = v;
        }
    }
    return out;
};

/**
 * Recommits a carriedTags() snapshot onto the redrawn station point and
 * re-pins it at that point's position: the redraw moved the station but
 * its real-world coordinate did not change, so the pin follows the
 * station -- otherwise the ground-window tools would read a re-solve as
 * "the entrance was dragged over the imagery".
 */
CsLocationPick.rehome = function(di, carried, entity) {
    var tags = {};
    for (var k in carried) {
        if (carried.hasOwnProperty(k)) {
            tags[k] = carried[k];
        }
    }
    if (typeof entity.getPosition === "function") {
        var p = entity.getPosition();
        tags.GeoDrawX = p.x;
        tags.GeoDrawY = p.y;
    }
    CsTags.commit(di, entity, tags);
};

/**
 * The geo station's CURRENT best coordinate: recomputed through the
 * pinned frame when the station has moved since its coordinate was
 * pinned (the workflow this exists for: the entrance dragged to its
 * true spot over freshly fetched imagery), the stored coordinate
 * otherwise. \return {lat, lon, moved} or null (no anchor).
 */
CsLocationPick.entranceCoord = function(doc) {
    var a = CsLocationPick.anchorRecord(doc);
    if (a === null) {
        return null;
    }
    if (a.pos !== null && a.pinX !== null && a.pinY !== null) {
        var dx = a.pos.x - a.pinX, dy = a.pos.y - a.pinY;
        if (Math.sqrt(dx * dx + dy * dy) > CsLocationPick.MOVE_EPS) {
            var unit = CsUnits.fromDrawingUnit(doc.getUnit(),
                typeof RS !== "undefined" ? RS : undefined);
            var ll = CsGeoProject.latLonAtDrawingPoint(a.pos,
                { lat: a.lat, lon: a.lon, x: a.pinX, y: a.pinY }, unit);
            return { lat: ll.lat, lon: ll.lon, moved: true };
        }
    }
    return { lat: a.lat, lon: a.lon, moved: false };
};

/**
 * For the ground-window tools, before they fetch against an EXISTING
 * anchor: when the geo station has moved since its coordinate was
 * pinned, asks which is the truth -- the position over the imagery
 * (recompute the coordinate through the pinned frame) or the stored
 * coordinate (keep it) -- and re-pins either way so the question is
 * asked once per move, not once per run. Mutates `anchor` ({entity,
 * name, pos, lat, lon}) in place when the user recomputes.
 *
 * Deliberate act by explicit question: the standing rule that nothing
 * silently relocates an anchor holds.
 */
CsLocationPick.resolveMovedAnchor = function(doc, di, anchor, title) {
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.pos === null) {
        return;
    }
    if (rec.pinX === null || rec.pinY === null) {
        // pre-pin drawing: pin the frame HERE, at fetch time -- from
        // this run on, a move of the station is detectable
        CsTags.commit(di, rec.entity,
            { GeoDrawX: rec.pos.x, GeoDrawY: rec.pos.y });
        return;
    }
    var dx = rec.pos.x - rec.pinX, dy = rec.pos.y - rec.pinY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= CsLocationPick.MOVE_EPS) {
        return;
    }
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(),
        typeof RS !== "undefined" ? RS : undefined);
    var ll = CsGeoProject.latLonAtDrawingPoint(rec.pos,
        { lat: rec.lat, lon: rec.lon, x: rec.pinX, y: rec.pinY }, unit);
    var name = rec.station !== "" ? rec.station : "the geo station";
    // getMainWindow is a GUI global -- absent in the headless harness
    var win = (typeof getMainWindow === "function") ? getMainWindow() : null;
    var answer = QMessageBox.question(win, title,
        name + " has moved " + (Math.round(dist * 100) / 100) + " " +
        unit + " since its location was pinned.\n\n" +
        "Recompute its latitude/longitude from where it now sits over " +
        "the georeferenced imagery?\n\n" +
        "Yes: where it sits is the truth -- the coordinate becomes " +
        ll.lat.toFixed(6) + ", " + ll.lon.toFixed(6) + ".\n" +
        "No: the stored coordinate (" + rec.lat.toFixed(6) + ", " +
        rec.lon.toFixed(6) + ") stays the truth for the new position.",
        QMessageBox.Yes | QMessageBox.No);
    if (answer === QMessageBox.Yes) {
        CsTags.commit(di, rec.entity, {
            GeoLat: ll.lat,
            GeoLon: ll.lon,
            GeoDrawX: rec.pos.x,
            GeoDrawY: rec.pos.y
        });
        CsLocationPick.remember(ll);
        if (anchor !== undefined && anchor !== null) {
            anchor.lat = ll.lat;
            anchor.lon = ll.lon;
        }
    } else {
        // the stored coordinate now belongs to the new position
        CsTags.commit(di, rec.entity,
            { GeoDrawX: rec.pos.x, GeoDrawY: rec.pos.y });
    }
};

/**
 * Asks for a location, offering the browser map first.
 *
 * \param title dialog title (names the calling tool)
 * \param defaultText prefilled coordinate text, may be ""
 * \return {lat, lon} or null (cancelled / unparseable)
 */
CsLocationPick.ask = function(title, defaultText) {
    // A location the suite already knows prefills the prompt: the
    // drawing's anchor first, then the last one declared anywhere.
    if (defaultText === undefined || defaultText === null || defaultText === "") {
        var known = CsLocationPick.getShared(
            typeof getDocument === "function" ? getDocument() : undefined);
        if (known !== null) {
            defaultText = known.lat.toFixed(6) + ", " + known.lon.toFixed(6);
        }
    }

    // ONE dialog, no pre-question (screenshot feedback, 2026-08-27):
    // Map... opens the browser map and leaves the field waiting for the
    // paste; From Entrance reads the geo station; or just type it.
    var prompt = "Cave location: decimal like 40.5042, -90.2583 or DMS " +
        "like 40 30'15.0\"N 90 15'30.0\"W.\n" +
        "Map... opens a browser map -- click the spot, the coordinate " +
        "is copied, paste it here.";

    var text = CsLocationPick.askText(title, prompt, defaultText || "");
    if (text === undefined || text === null || text === "") {
        return null;
    }
    var coord = CsAngles.parseLatLon(text);
    if (coord === null) {
        CsTell.warn(title + ": couldn't read that coordinate.");
        return null;
    }
    // a declared location is trusted -- share it with every tool
    CsLocationPick.remember(coord);
    return coord;
};

/**
 * The coordinate entry itself: a line edit with a From Entrance
 * button that reads the geo station's CURRENT best coordinate into
 * the field (recomputed through the pinned frame when the station has
 * been moved over the imagery -- see entranceCoord). Nathan's ask,
 * 2026-08-27. Falls back to the plain getText prompt on a bridge that
 * refuses the dialog.
 *
 * \return the typed text, or null (cancelled).
 */
CsLocationPick.askText = function(title, prompt, preset) {
    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = title;
        var layout = new QVBoxLayout();
        layout.addWidget(new QLabel(prompt), 0, 0);
        var edit = new QLineEdit();
        edit.text = preset || "";
        layout.addWidget(edit, 0, 0);

        var bar = new QHBoxLayout();
        var mapBtn = new QPushButton("Map...");
        mapBtn.toolTip = "Open a browser map. Click the spot; the " +
            "coordinate is copied to the clipboard -- paste it into " +
            "the field here.";
        var fromBtn = new QPushButton("From Entrance");
        fromBtn.toolTip = "Read the geo station's coordinate into the " +
            "field. If the station has been moved since imagery was " +
            "fetched, this is its NEW location, computed from where it " +
            "now sits over that imagery.";
        var okBtn = new QPushButton("OK");
        var cancelBtn = new QPushButton("Cancel");
        try {
            okBtn["default"] = true;
        } catch (eDef) {
        }
        bar.addWidget(mapBtn, 0, 0);
        bar.addWidget(fromBtn, 0, 0);
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        mapBtn.clicked.connect(function() {
            if (!CsLocationPick.openMap()) {
                QMessageBox.information(getMainWindow(), title,
                    "The map page could not be opened. Type the " +
                    "coordinate, or use From Entrance.");
            }
        });
        fromBtn.clicked.connect(function() {
            var doc = (typeof getDocument === "function") ?
                getDocument() : null;
            var best = (doc !== null && doc !== undefined) ?
                CsLocationPick.entranceCoord(doc) : null;
            if (best === null) {
                QMessageBox.information(getMainWindow(), title,
                    "No geo station in this drawing yet -- there is " +
                    "no entrance coordinate to read. Pick or type one.");
                return;
            }
            edit.text = best.lat.toFixed(6) + ", " + best.lon.toFixed(6);
        });
        okBtn.clicked.connect(function() { dlg.accept(); });
        cancelBtn.clicked.connect(function() { dlg.reject(); });

        var answer = dlg.exec();
        var text = (answer === 0) ? null : String(edit.text);
        destrDialog(dlg);
        return text;
    } catch (e) {
        var t = getText(title, prompt, preset || "");
        return (t === undefined || t === "") ? null : t;
    }
};

/** Writes the map page and opens it. Returns false on any failure. */
CsLocationPick.openMap = function() {
    try {
        var path = QDir.tempPath() + "/cavesurvey_location_picker.html";
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
            return false;
        }
        var ts = new QTextStream(f);
        ts.writeString(CsLocationPick.pageHtml());
        f.close();
        return QDesktopServices.openUrl(new QUrl("file://" + path));
    } catch (e) {
        return false;
    }
};

/** The Leaflet page. Kept dependency-light: Leaflet from unpkg, map
 *  tiles from OSM and Esri's public services, correct attribution. */
CsLocationPick.pageHtml = function() {
    // Assembled from an array: this file is itself ECMAScript, so the
    // page's <script> content stays out of this parser's way.
    var L = [];
    L.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
    L.push('<title>Cave Survey - pick a location</title>');
    L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    L.push('<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">');
    L.push('<scr' + 'ipt src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></scr' + 'ipt>');
    L.push('<style>');
    L.push('html,body{margin:0;height:100%;font-family:sans-serif}');
    L.push('#map{position:absolute;top:0;bottom:64px;width:100%}');
    L.push('#bar{position:absolute;bottom:0;height:64px;width:100%;');
    L.push('display:flex;align-items:center;gap:10px;padding:0 12px;');
    L.push('box-sizing:border-box;background:#222;color:#eee}');
    L.push('#coord{flex:1;font-size:15px;padding:6px;font-family:monospace}');
    L.push('#hint{font-size:13px;color:#aaa}');
    L.push('button{font-size:14px;padding:8px 14px}');
    L.push('</style></head><body>');
    L.push('<div id="map"></div>');
    L.push('<div id="bar">');
    L.push('<input id="coord" readonly placeholder="click the map...">');
    L.push('<button id="copy">Copy</button>');
    L.push('<span id="hint">click = pin + copy; paste into QCAD</span>');
    L.push('</div>');
    L.push('<scr' + 'ipt>');
    L.push('var map = L.map("map").setView([39.5, -98.35], 4);'); // continental US
    L.push('var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",');
    L.push('  {maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"});');
    L.push('var imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",');
    L.push('  {maxZoom: 19, attribution: "Imagery &copy; Esri"});');
    L.push('var labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",');
    L.push('  {maxZoom: 19});');
    L.push('var hybrid = L.layerGroup([imagery, labels]);');
    L.push('hybrid.addTo(map);'); // hybrid is the default
    L.push('L.control.layers({"Hybrid (imagery + labels)": hybrid, "OSM streets": osm}).addTo(map);');
    L.push('var marker = null;');
    L.push('function fmt(v){return v.toFixed(6);}');
    L.push('map.on("click", function(e){');
    L.push('  var lat = e.latlng.lat, lon = e.latlng.lng;');
    L.push('  if (marker) { marker.setLatLng(e.latlng); }');
    L.push('  else { marker = L.marker(e.latlng).addTo(map); }');
    L.push('  var text = fmt(lat) + ", " + fmt(lon);');
    L.push('  var box = document.getElementById("coord");');
    L.push('  box.value = text;');
    L.push('  box.select();');
    L.push('  var copied = false;');
    L.push('  try { copied = document.execCommand("copy"); } catch (err) {}');
    L.push('  if (navigator.clipboard) {');
    L.push('    navigator.clipboard.writeText(text).then(function(){copied=true;});');
    L.push('  }');
    L.push('  document.getElementById("hint").textContent =');
    L.push('    copied ? "copied -- paste into QCAD" : "select the box and copy (Cmd+C)";');
    L.push('});');
    L.push('document.getElementById("copy").onclick = function(){');
    L.push('  var box = document.getElementById("coord");');
    L.push('  box.select();');
    L.push('  try { document.execCommand("copy"); } catch (err) {}');
    L.push('  if (navigator.clipboard) { navigator.clipboard.writeText(box.value); }');
    L.push('};');
    L.push('</scr' + 'ipt></body></html>');
    return L.join("\n");
};

/**
 * The drawing's datum offset -- what to add to any station's survey
 * Elevation to get an absolute (NAVD88) one -- or null when this
 * drawing has no GeoElev, no geo anchor, or an anchor carrying no
 * elevation of its own.
 *
 * The document-side half of CsElevation.datumOffset, which owns the
 * arithmetic and is pure. This file already reads the geo tags, so the
 * lookup belongs here rather than teaching CsElevation about
 * documents.
 *
 * NULL MEANS UNKNOWN. Callers must decline to answer, never fall back
 * to zero.
 */
CsLocationPick.datumOffset = function(doc, unit) {
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.elev === null) {
        return null;
    }
    return CsElevation.datumOffset(rec.elev,
        CsTags.getNumber(rec.entity, "Elevation"), unit);
};

/**
 * Stores the drawing's entrance location on one station, replacing any
 * anchor that was there before.
 *
 * ONE ANCHOR PER DRAWING. Every other station carrying geo tags is
 * stripped first -- two anchors disagreeing about where a cave is
 * would be read by whichever one queryAllEntities happened to hand
 * back first, and that order is not stable.
 *
 * GeoDrawX/Y record the DRAWING position the coordinate was pinned at,
 * so a station dragged over the imagery later can have its coordinate
 * recomputed rather than silently keeping a stale one (see
 * resolveMovedAnchor).
 *
 * \param entity the station point to anchor to
 * \param coord  {lat, lon}
 * \param elevM  ground elevation in METRES NAVD88, or null when it
 *               could not be looked up -- null is UNKNOWN, and is
 *               written as no tag at all rather than as a zero
 * \return true
 */
CsLocationPick.writeAnchor = function(doc, di, entity, coord, elevM) {
    CsLocationPick.clearAnchor(doc, di, entity);

    var tags = {
        GeoLat: coord.lat,
        GeoLon: coord.lon,
        GeoStation: CsTags.get(entity, "Station")
    };
    if (typeof entity.getPosition === "function") {
        var pos = entity.getPosition();
        tags.GeoDrawX = pos.x;
        tags.GeoDrawY = pos.y;
    }
    if (elevM !== null && elevM !== undefined && isFinite(elevM)) {
        tags.GeoElev = elevM;
    }
    CsTags.commit(di, entity, tags);
    CsLocationPick.remember(coord);
    return true;
};

/**
 * Takes the geo tags off every station except `keep` (pass null to
 * clear the drawing's location entirely).
 *
 * The grid fetched for the old location is NOT deleted: it is a file
 * beside the drawing, and deleting a caver's files as a side effect of
 * moving a pin is not this function's business. It is stale, though,
 * and the surface will not draw until Surface Data has been run again
 * -- which is what the 3D panel's own "run Surface Data" line says.
 *
 * \return how many stations were cleared.
 */
CsLocationPick.clearAnchor = function(doc, di, keep) {
    var cleared = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (keep !== null && keep !== undefined &&
                e.getId() === keep.getId()) {
            continue;
        }
        var carries = false;
        for (var t = 0; t < CsPackage.GEO_TAGS.length; t++) {
            var v = CsTags.get(e, CsPackage.GEO_TAGS[t]);
            if (v !== null && v !== undefined && v !== "") {
                carries = true;
            }
        }
        // GeoDrawX/Y are NOT in GEO_TAGS -- that list is what
        // sanitizing strips, and a drawing position is not a location.
        // Moving the pin still has to clear them, or the new anchor
        // inherits the old one's pinned position and every later
        // "has this station moved?" check answers about the wrong spot.
        if (!carries && CsTags.get(e, "GeoDrawX") === "") {
            continue;
        }
        for (var r = 0; r < CsPackage.GEO_TAGS.length; r++) {
            CsTags.remove(e, CsPackage.GEO_TAGS[r]);
        }
        CsTags.remove(e, "GeoDrawX");
        CsTags.remove(e, "GeoDrawY");
        var op = new RModifyObjectsOperation();
        op.addObject(e, false);
        di.applyOperation(op);
        cleared++;
    }
    return cleared;
};

/** The surface's own layers: everything Surface Data drew, which is
 *  fixed to the WORLD rather than to the survey and therefore never
 *  moves when the cave is nudged into place over it. */
CsLocationPick.SURFACE_LAYERS = ["CTRL-AERIAL", "CTRL-CONTOUR",
    "CTRL-CONTOUR-MAJOR"];

/** True when this entity belongs to the surface rather than the cave.
 *  Tag first, layer second: the tags are what a re-run looks for, and
 *  the layers catch anything drawn by an older build. */
CsLocationPick.isSurfaceEntity = function(entity) {
    if (CsTags.get(entity, "SurfaceContours") === "1" ||
            CsTags.get(entity, "AerialBasemap") === "1") {
        return true;
    }
    var layer = "";
    try {
        layer = entity.getLayerName();
    } catch (e) {
        return false;
    }
    return CsLocationPick.SURFACE_LAYERS.indexOf(layer) >= 0;
};

/**
 * The lowest surface contour vertex within `radius` of a point, or
 * null when no contour passes near enough.
 *
 * WHY THE LOWEST. A cave entrance is usually at the bottom of
 * something -- a sink, a swallet, the foot of a bluff -- and on an
 * aerial photograph that bottom is a shape you can see but not a point
 * you can click accurately. The contours already say which way is
 * down, so the click only has to be close.
 *
 * Reads the ContourElevation tag, in DRAWING UNITS, as Surface Data
 * wrote it. A contour with no readable elevation is skipped rather
 * than assumed to be at zero.
 *
 * \return {x, y, elevation} or null
 */
CsLocationPick.lowPointNear = function(doc, point, radius) {
    var best = null;
    // MODEL SPACE PLUS THE ONE BLOCK THE CONTOURS LIVE IN. An entity
    // inside a block definition carries BLOCK-LOCAL coordinates, so
    // measuring a distance from a drawing point to one is normally
    // comparing two different coordinate systems -- CsContour.BLOCK is
    // the exception, and only because Surface Data inserts it once at
    // its own base point, unscaled and unrotated, which shifts its
    // contents by nothing. No other block is read here.
    var found = CsContour.drawnEntities(doc);
    for (var i = 0; i < found.length; i++) {
        var e = found[i];
        if (isNull(e)) {
            continue;
        }
        var elev = CsTags.getNumber(e, "ContourElevation");
        if (elev === null) {
            continue;
        }
        var shape = null;
        try {
            shape = e.getData().castToShape();
        } catch (eShape) {
            continue;
        }
        if (shape === null || isNull(shape) ||
                typeof shape.getClosestPointOnShape !== "function") {
            continue;
        }
        var near = shape.getClosestPointOnShape(point, true);
        if (isNull(near)) {
            continue;
        }
        var d = point.getDistanceTo(near);
        if (d > radius) {
            continue;
        }
        // Lowest wins; a tie goes to the nearer one, so a click
        // between two runs of the same contour lands where it was
        // aimed.
        if (best === null || elev < best.elevation ||
                (elev === best.elevation && d < best.distance)) {
            best = { x: near.x, y: near.y, elevation: elev, distance: d };
        }
    }
    return best;
};

/**
 * Slides the whole cave so that `station` lands on `point`.
 *
 * THE SURVEY MOVES AS ONE RIGID PIECE. Every entity in the drawing
 * moves by the same offset -- linework, symbols, scans, the profile
 * region, captured sections, the lot -- so nothing internal to the
 * drawing changes its relationship to anything else. The only things
 * left behind are the SURFACE's own entities, which are pinned to the
 * world rather than to the cave: moving those too would move the
 * photograph with the cave and achieve exactly nothing.
 *
 * LAYERS THAT WOULD REFUSE ARE OPENED FIRST. Off, frozen and locked
 * layers all swallow a modify without a word in this build, and a
 * half-moved drawing -- the cave shifted, its scans left behind -- is
 * far worse than a refusal.
 *
 * \return how many entities moved
 */
CsLocationPick.moveSurvey = function(doc, di, offset) {
    // MODEL SPACE ONLY -- `allBlocks: false`. This is the difference
    // between translating a drawing and wrecking it, and it cost a
    // real cave's layout to learn (2026-09-14).
    //
    // queryAllEntities(false, TRUE) also returns every entity INSIDE
    // every block DEFINITION. Moving those moves the symbol, callout
    // or section bay within its own definition -- for EVERY insert of
    // it, since a definition is shared -- while the block REFERENCE
    // moves as well. The result is each block's contents displaced
    // twice over and every other copy of that symbol dragged along
    // with it, which looks like the drawing coming apart rather than
    // sliding.
    //
    // A block reference in model space is one entity and carries its
    // whole definition with it. Nothing inside a definition should
    // ever be touched by a translation of the drawing.
    var ids = doc.queryAllEntities(false, false);
    var moving = [];
    var layerNames = {};
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsLocationPick.isSurfaceEntity(e)) {
            continue;
        }
        moving.push(e);
        try {
            layerNames[e.getLayerName()] = true;
        } catch (eLayer) {
        }
    }
    if (moving.length === 0) {
        return 0;
    }

    var names = [];
    for (var n in layerNames) {
        if (layerNames.hasOwnProperty(n)) {
            names.push(n);
        }
    }

    // withLayerUnlocked takes one layer, so the locked ones are opened
    // by recursing through the list and doing the work at the bottom.
    var apply = function() {
        var op = new RModifyObjectsOperation();
        for (var m = 0; m < moving.length; m++) {
            moving[m].move(offset);
            op.addObject(moving[m], false);
        }
        di.applyOperation(op);
        return moving.length;
    };
    var unlockThen = function(index) {
        if (index >= names.length) {
            return apply();
        }
        return CsLayers.withLayerUnlocked(doc, di, names[index],
            function() {
                return unlockThen(index + 1);
            });
    };

    return CsLayers.withLayersOn(doc, di, names, function() {
        return unlockThen(0);
    });
};

/**
 * What the anchor's coordinate becomes once its station has been moved
 * over georeferenced imagery: the latitude/longitude of where it now
 * sits, read through the frame the old coordinate was pinned in.
 *
 * NEEDS A PINNED FRAME (GeoDrawX/Y). A drawing georeferenced before
 * those tags existed has no way to say what ground a drawing point
 * covers, and this returns null rather than inventing one.
 *
 * \return {lat, lon} or null
 */
CsLocationPick.coordAtPoint = function(doc, point, unit) {
    var rec = CsLocationPick.anchorRecord(doc);
    if (rec === null || rec.pinX === null || rec.pinY === null) {
        return null;
    }
    return CsGeoProject.latLonAtDrawingPoint(
        { x: point.x, y: point.y },
        { lat: rec.lat, lon: rec.lon, x: rec.pinX, y: rec.pinY }, unit);
};
