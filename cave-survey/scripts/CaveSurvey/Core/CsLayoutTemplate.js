// CsLayoutTemplate.js -- layouts that come from templates.
//
// Part of the Cave Survey Core library.
//
// A layout TEMPLATE is a saved sheet: the paper, the viewports on it (where,
// what shape, what they show, at what scale, turned how, hiding which layers)
// and the furniture (border, north arrow, scale bar, title block). Applying one
// makes a new layout in the open drawing; capturing one saves a layout you
// composed so every cave can start the same way.
//
// WHERE THEY LIVE. Built in (below), a "Layout templates" folder beside the
// cave's drawing (shared with the team through the cave folder), and the
// per-user data folder (just yours). A file is plain JSON, one template each.
//
// POSITIONS ARE FRACTIONS OF THE PAPER (0..1 from the lower left), not inches,
// so a template made on Letter still lays out sensibly on Tabloid; sizes of
// furniture are the generator's own (inches), whatever the paper.
//
//   { version: 1, name, paper: "Letter" | {w, h} (mm), landscape, margins: mm,
//     viewports: [ { id, box: {x, y, w, h}, shape: [loop...] | null,
//                    view: "cave" | "profile", scale: "fit" | feetPerInch,
//                    rotation: degrees, locked, freeze: [frame...], hide: [layer...] } ],
//     furniture: [ { kind: "north" | "scalebar" | "title" | "border", at: {x, y},
//                    viewport: id, inset: inches } ] }
//
// A `shape` is loops of [x, y] fractions of the viewport's own box, outline
// first and cut-outs after it (see Layouts.clipLoops).

if (typeof NewViewport === "undefined") {
    include("scripts/Layouts/NewViewport/NewViewport.js");
}

var CsLayoutTemplate = {};

CsLayoutTemplate.VERSION = 1;
CsLayoutTemplate.FOLDER = "Layout templates";

/** The templates that ship with CaveCAD. */
CsLayoutTemplate.BUILTIN = [
    { version: 1, name: "Plan sheet - Letter",
      paper: "Letter", landscape: true, margins: 12.7,
      viewports: [ { id: "plan", box: { x: 0.03, y: 0.03, w: 0.94, h: 0.94 }, shape: null, view: "cave", scale: "fit",
                     rotation: 0, locked: false, freeze: ["profile", "section"], hide: [] } ],
      furniture: [ { kind: "border", inset: 0.2 },
                   { kind: "scalebar", at: { x: 0.05, y: 0.06 }, viewport: "plan" },
                   { kind: "north", at: { x: 0.90, y: 0.80 }, viewport: "plan" },
                   { kind: "title", at: { x: 0.52, y: 0.05 } } ] },
    { version: 1, name: "Plan sheet - Tabloid",
      paper: "Tabloid", landscape: true, margins: 12.7,
      viewports: [ { id: "plan", box: { x: 0.025, y: 0.025, w: 0.95, h: 0.95 }, shape: null, view: "cave", scale: "fit",
                     rotation: 0, locked: false, freeze: ["profile", "section"], hide: [] } ],
      furniture: [ { kind: "border", inset: 0.25 },
                   { kind: "scalebar", at: { x: 0.04, y: 0.05 }, viewport: "plan" },
                   { kind: "north", at: { x: 0.92, y: 0.82 }, viewport: "plan" },
                   { kind: "title", at: { x: 0.60, y: 0.04 } } ] },
    { version: 1, name: "Plan and elevation - Tabloid",
      paper: "Tabloid", landscape: true, margins: 12.7,
      viewports: [ { id: "plan", box: { x: 0.025, y: 0.40, w: 0.95, h: 0.575 }, shape: null, view: "cave", scale: "fit",
                     rotation: 0, locked: false, freeze: ["profile", "section"], hide: [] },
                   { id: "elevation", box: { x: 0.025, y: 0.025, w: 0.60, h: 0.36 }, shape: null, view: "profile", scale: "fit",
                     rotation: 0, locked: false, freeze: ["plan", "section"], hide: [] } ],
      furniture: [ { kind: "border", inset: 0.25 },
                   { kind: "scalebar", at: { x: 0.04, y: 0.42 }, viewport: "plan" },
                   { kind: "north", at: { x: 0.93, y: 0.88 }, viewport: "plan" },
                   { kind: "scalebar", at: { x: 0.04, y: 0.05 }, viewport: "elevation" },
                   { kind: "title", at: { x: 0.66, y: 0.04 } } ] },
    { version: 1, name: "Plan sheet with legend - Tabloid",
      paper: "Tabloid", landscape: true, margins: 12.7,
      viewports: [ { id: "plan", box: { x: 0.025, y: 0.025, w: 0.72, h: 0.95 }, shape: null, view: "cave", scale: "fit",
                     rotation: 0, locked: false, freeze: ["profile", "section"], hide: [] },
                   { id: "legend", box: { x: 0.76, y: 0.30, w: 0.22, h: 0.67 }, shape: null, view: "legend", scale: "fit",
                     rotation: 0, locked: true, freeze: [], hide: [] } ],
      furniture: [ { kind: "border", inset: 0.25 },
                   { kind: "scalebar", at: { x: 0.04, y: 0.05 }, viewport: "plan" },
                   { kind: "north", at: { x: 0.69, y: 0.88 }, viewport: "plan" },
                   { kind: "title", at: { x: 0.76, y: 0.04 } } ] },
    { version: 1, name: "Blank - Letter",
      paper: "Letter", landscape: true, margins: 12.7, viewports: [],
      furniture: [ { kind: "border", inset: 0.2 } ] }
];

// ---------------------------------------------------------------------
// Where they are kept
// ---------------------------------------------------------------------

/** Folders to look in, in the order a name wins: [{path, source}] -- the cave's own first. */
CsLayoutTemplate.folders = function(doc) {
    var out = [];
    try {
        var cave = CsCave.folderOf(String(doc.getFileName()));
        if (cave !== null) {
            out.push({ path: cave + "/" + CsLayoutTemplate.FOLDER, source: "cave" });
        }
    } catch (e) {
    }
    try {
        var dir = String(RSettings.getDataLocation()).replace(/[\\\/]+$/, "");
        if (dir !== "") {
            out.push({ path: dir + "/" + CsLayoutTemplate.FOLDER, source: "user" });
        }
    } catch (e2) {
    }
    return out;
};

CsLayoutTemplate.readFile = function(path) {
    try {
        var file = new QFile(path);
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return "";
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        var text = String(stream.readAll());
        file.close();
        return text;
    } catch (e) {
        return "";
    }
};

/** A parsed template, or null when the text is not one. Never throws. */
CsLayoutTemplate.parse = function(text) {
    try {
        var def = JSON.parse(text);
        if (isNull(def) || typeof def.name !== "string" || def.name === "" || !isNull(def.viewports) && !(def.viewports instanceof Array)) {
            return null;
        }
        if (isNull(def.viewports)) { def.viewports = []; }
        if (isNull(def.furniture)) { def.furniture = []; }
        return def;
    } catch (e) {
        return null;
    }
};

/** Every template, built in first: [{name, source, def}] -- a cave's own overrides a same-named built-in. */
CsLayoutTemplate.list = function(doc) {
    var byName = {}, out = [];
    var put = function(def, source) {
        var at = byName[def.name];
        var entry = { name: def.name, source: source, def: def };
        if (isNull(at)) {
            byName[def.name] = out.length;
            out.push(entry);
        }
        else {
            out[at] = entry;
        }
    };
    for (var b = 0; b < CsLayoutTemplate.BUILTIN.length; b++) {
        put(CsLayoutTemplate.BUILTIN[b], "built-in");
    }
    var folders = CsLayoutTemplate.folders(doc).reverse();   // user first, so the cave's wins
    for (var f = 0; f < folders.length; f++) {
        try {
            var names = (new QDir(folders[f].path)).entryList(["*.json"], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
            for (var n = 0; n < names.length; n++) {
                var def = CsLayoutTemplate.parse(CsLayoutTemplate.readFile(folders[f].path + "/" + names[n]));
                if (def !== null) {
                    put(def, folders[f].source);
                }
            }
        } catch (e) {
        }
    }
    return out;
};

/** A name as a file name. */
CsLayoutTemplate.fileName = function(name) {
    return String(name).replace(/[\\\/:*?"<>|]+/g, "-").replace(/^\s+|\s+$/g, "") + ".json";
};

/**
 * Saves a template into a folder (made if need be).
 *
 * \return the path written, or "" on failure
 */
CsLayoutTemplate.save = function(def, folder) {
    try {
        (new QDir("/")).mkpath(folder);
        var path = folder + "/" + CsLayoutTemplate.fileName(def.name);
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Text | QIODevice.Truncate)) {
            return "";
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(JSON.stringify(def, null, 1));
        stream.flush();
        file.close();
        return path;
    } catch (e) {
        return "";
    }
};

// ---------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------

/** The model extents a viewport's `view` shows, {minX, minY, maxX, maxY}, or undefined. */
CsLayoutTemplate.extentsOf = function(doc, view) {
    var box = null;
    try {
        if (view === "legend") {
            box = CsLayoutFurniture.legendBox(doc);
            return isNull(box) ? undefined : box;
        }
        if (view === "profile") {
            box = SheetSetup.frameBox(doc, "profile");
        }
        else {
            box = SheetSetup.caveBox(doc);
        }
    } catch (e) {
        box = null;
    }
    if (isNull(box)) {
        return NewViewport.modelExtents(doc);
    }
    return box;
};

/** The names of the layers a viewport hides, from its template. */
CsLayoutTemplate.frozenIds = function(doc, vdef) {
    var ids = CsLayoutGen.layersOfFrames(doc, isNull(vdef.freeze) ? [] : vdef.freeze);
    var hide = isNull(vdef.hide) ? [] : vdef.hide;
    for (var i = 0; i < hide.length; i++) {
        var id = doc.getLayerId(hide[i]);
        if (id !== RObject.INVALID_ID && ids.indexOf(id) < 0) {
            ids.push(id);
        }
    }
    return ids;
};

/**
 * Makes a layout from a template.
 *
 * \param name  the new layout's name (made unique if taken)
 * \return the layout's name, or "" when it could not be made
 */
CsLayoutTemplate.apply = function(doc, di, def, name) {
    var info = Layouts.create(di, { name: Layouts.nameOk(doc, name) ? name : undefined,
        paper: def.paper, landscape: def.landscape !== false,
        margins: isNull(def.margins) ? undefined : def.margins });
    if (isNull(info)) {
        return "";
    }
    var ps = Layouts.paperSize(doc, info);
    var inch = Layouts.toPaper(doc, 25.4);
    var made = {};     // template viewport id -> entity id

    for (var v = 0; v < def.viewports.length; v++) {
        var vd = def.viewports[v];
        var x = vd.box.x * ps.w, y = vd.box.y * ps.h, w = vd.box.w * ps.w, h = vd.box.h * ps.h;
        var ext = CsLayoutTemplate.extentsOf(doc, vd.view);
        var vp = new RViewportEntity(doc, new RViewportData());
        vp.setCenter(new RVector(x + w / 2, y + h / 2));
        vp.setWidth(w);
        vp.setHeight(h);
        var fpi = vd.scale === "fit" || isNull(vd.scale) ? NewViewport.fitScale(doc, w, h, ext) : Number(vd.scale);
        vp.setScale(Layouts.scaleFor(doc, fpi));
        vp.setViewCenter(isNull(ext) ? new RVector(0, 0) : new RVector((ext.minX + ext.maxX) / 2, (ext.minY + ext.maxY) / 2));
        vp.setViewTarget(new RVector(0, 0));
        vp.setBlockId(info.blockId);
        vp.setLayerId(doc.getCurrentLayerId());
        if (vd.view === "legend") {
            // a legend viewport shows the LEGEND layer and nothing else
            vp.setFrozenLayerIds(CsLayoutFurniture.allLayersExcept(doc, CsLayers.LEGEND));
            vp.setCustomProperty("CaveCAD", "Legend", "1");
        }
        else {
            var hidden = CsLayoutTemplate.frozenIds(doc, vd), lid = doc.getLayerId(CsLayers.LEGEND);
            if (lid !== RObject.INVALID_ID && hidden.indexOf(lid) < 0) {
                hidden.push(lid);     // the map's viewports never show the legend
            }
            vp.setFrozenLayerIds(hidden);
        }
        vp.setRotation((isNull(vd.rotation) ? 0 : vd.rotation) * Math.PI / 180);
        // a plotted map carries no raster
        vp.setCustomProperty("CaveCAD", "NoRaster", "1");
        CsScaleBar.ensureGuid(vp);
        if (!isNull(vd.shape) && vd.shape.length > 0) {
            var loops = [];
            for (var l = 0; l < vd.shape.length; l++) {
                var loop = [];
                for (var p = 0; p < vd.shape[l].length; p++) {
                    loop.push({ x: x + vd.shape[l][p][0] * w, y: y + vd.shape[l][p][1] * h });
                }
                loops.push(loop);
            }
            Layouts._writeClip(vp, loops);
        }
        if (vd.locked === true) {
            vp.setStatus(vp.getStatus() | Layouts.LOCK_BIT);
        }
        var add = new RAddObjectOperation(vp, false);
        add.setText(qsTr("Layout from template"));
        di.applyOperation(add);
    }
    var vps = Layouts.viewports(doc, info);
    for (var m = 0, k = 0; m < def.viewports.length && k < vps.length; k++) {
        if (!vps[k].isOverall()) {
            made[def.viewports[m].id] = vps[k].getId();
            m++;
        }
    }

    for (var f = 0; f < def.furniture.length; f++) {
        var fd = def.furniture[f];
        var fx = isNull(fd.at) ? 0 : fd.at.x * ps.w, fy = isNull(fd.at) ? 0 : fd.at.y * ps.h;
        var owner = isNull(fd.viewport) || isNull(made[fd.viewport]) ? undefined : doc.queryEntity(made[fd.viewport]);
        try {
            if (fd.kind === "north") {
                CsLayoutFurniture.addNorth(doc, di, info, fx, fy, owner);
            }
            else if (fd.kind === "scalebar") {
                CsLayoutFurniture.addScaleBar(doc, di, info, fx, fy, owner, true);
            }
            else if (fd.kind === "title") {
                CsLayoutFurniture.addTitle(doc, di, info, fx, fy);
            }
            else if (fd.kind === "border") {
                CsLayoutFurniture.addBorder(doc, di, info, isNull(fd.inset) ? 0.2 : fd.inset);
            }
        } catch (eF) {
            qWarning("CsLayoutTemplate.apply: " + fd.kind + ": " + eF);
        }
    }
    return info.name;
};

// ---------------------------------------------------------------------
// Capturing
// ---------------------------------------------------------------------

/** A template made from a layout as it stands. */
CsLayoutTemplate.capture = function(doc, info, name) {
    var ps = Layouts.paperSize(doc, info);
    var inch = Layouts.toPaper(doc, 25.4);
    var def = { version: CsLayoutTemplate.VERSION, name: name,
        paper: { w: info.paperMM.w, h: info.paperMM.h }, landscape: info.paperMM.w >= info.paperMM.h,
        margins: info.marginsMM.l, viewports: [], furniture: [] };
    var vps = Layouts.viewports(doc, info), ids = {};
    for (var i = 0; i < vps.length; i++) {
        var vp = vps[i];
        if (vp.isOverall()) {
            continue;
        }
        var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
        var box = { x: (c.x - hw) / ps.w, y: (c.y - hh) / ps.h, w: vp.getWidth() / ps.w, h: vp.getHeight() / ps.h };
        var shape = null;
        var loops = Layouts.clipLoops(vp);
        if (loops.length > 0) {
            shape = [];
            for (var l = 0; l < loops.length; l++) {
                var loop = [];
                for (var p = 0; p < loops[l].length; p++) {
                    loop.push([(loops[l][p].x - (c.x - hw)) / vp.getWidth(), (loops[l][p].y - (c.y - hh)) / vp.getHeight()]);
                }
                shape.push(loop);
            }
        }
        // which frames and layers it hides
        var frozenNames = [], frames = {}, fz = vp.getFrozenLayerIds();
        for (var z = 0; z < fz.length; z++) {
            frozenNames.push(String(doc.getLayerName(fz[z])));
        }
        var freeze = [], hide = [];
        for (var q = 0; q < frozenNames.length; q++) {
            var fr = CsLayers.frameOf(frozenNames[q]);
            if (fr === "plan" || fr === "profile" || fr === "section") {
                frames[fr] = true;
            }
            else {
                hide.push(frozenNames[q]);
            }
        }
        for (var fk in frames) {
            if (frames.hasOwnProperty(fk)) { freeze.push(fk); }
        }
        var isLegend = CsLayoutFurniture.isLegendViewport(vp);
        if (isLegend) {
            freeze = [];
            hide = [];
        }
        else {
            hide = hide.filter(function(n) { return n !== CsLayers.LEGEND; });
        }
        var id = "vp" + (def.viewports.length + 1);
        ids[vp.getId()] = id;
        def.viewports.push({ id: id, box: box, shape: shape,
            view: isLegend ? "legend" : (frames.plan === true && frames.profile !== true ? "profile" : "cave"),
            scale: Layouts.feetPerInch(doc, vp), rotation: vp.getRotation() * 180 / Math.PI,
            locked: Layouts.isLocked(vp), freeze: freeze, hide: hide });
    }
    // furniture: north arrows, scale bars and the title block, by where they are
    var arrows = CsNorth.arrows(doc, info.blockId);
    for (var a = 0; a < arrows.length; a++) {
        var owner = arrows[a].placed ? CsNorth.viewportFor(doc, info.blockId, arrows[a].pivot.x, arrows[a].pivot.y) : undefined;
        if (!arrows[a].placed) {
            for (var w = 0; w < vps.length; w++) {
                if (CsScaleBar.guidOf(vps[w]) === arrows[a].guid) { owner = vps[w]; }
            }
        }
        def.furniture.push({ kind: "north", at: { x: arrows[a].pivot.x / ps.w, y: arrows[a].pivot.y / ps.h },
            viewport: isNull(owner) ? undefined : ids[owner.getId()] });
    }
    for (var s = 0; s < vps.length; s++) {
        var guid = CsScaleBar.guidOf(vps[s]);
        if (guid === "") { continue; }
        var pieces = CsScaleBar.pieces(doc, info.blockId, guid);
        var anchor = pieces.length > 0 ? CsScaleBar.anchorOf(doc, pieces) : null;
        if (anchor !== null) {
            def.furniture.push({ kind: "scalebar", at: { x: anchor.x * inch / ps.w, y: anchor.y * inch / ps.h }, viewport: ids[vps[s].getId()] });
        }
    }
    // a border: axis-aligned BORDER lines running most of the paper's width / height
    // (match lines and a sheet's own edges are not it); its inset is the nearest one's distance from the paper edge
    var W = ps.w / inch, H = ps.h / inch, hlines = 0, vlines = 0, inset = Infinity;
    var bids = doc.queryBlockEntities(info.blockId);
    for (var bi = 0; bi < bids.length; bi++) {
        var be = doc.queryEntity(bids[bi]);
        if (isNull(be) || be.isUndone() || be.getType() !== RS.EntityLine || CsBind.layerNameOf(doc, be) !== CsLayers.BORDER) {
            continue;
        }
        if (CsTags.get(be, CsLayoutGen.TAG) === "matchline") {
            continue;
        }
        var sp = be.getStartPoint(), ep = be.getEndPoint();
        var lenIn = sp.getDistanceTo(ep) / inch;
        if (Math.abs(sp.y - ep.y) < 1e-9 && lenIn >= 0.6 * W) {
            hlines++;
            inset = Math.min(inset, sp.y / inch, H - sp.y / inch);
        }
        else if (Math.abs(sp.x - ep.x) < 1e-9 && lenIn >= 0.6 * H) {
            vlines++;
            inset = Math.min(inset, sp.x / inch, W - sp.x / inch);
        }
    }
    if (hlines >= 2 && vlines >= 2 && isFinite(inset)) {
        def.furniture.unshift({ kind: "border", inset: Math.round(inset * 1000) / 1000 });
    }

    var tx = Infinity, ty = Infinity, ids2 = doc.queryBlockEntities(info.blockId);
    for (var e = 0; e < ids2.length; e++) {
        var ent = doc.queryEntity(ids2[e]);
        if (!isNull(ent) && !ent.isUndone() && CsTags.get(ent, CsSheet.TAG) !== "") {
            var pos = ent.getPosition();
            tx = Math.min(tx, pos.x);
            ty = Math.min(ty, pos.y);
        }
    }
    if (isFinite(tx)) {
        def.furniture.push({ kind: "title", at: { x: tx / ps.w, y: Math.max(0, ty / ps.h - 0.02) } });
    }
    return def;
};


// ---------------------------------------------------------------------
// The dialogs (GUI only)
// ---------------------------------------------------------------------

/** "Name  (built-in / this cave / just you)" for the chooser. */
CsLayoutTemplate.label = function(entry) {
    var where = entry.source === "built-in" ? qsTr("built in") : (entry.source === "cave" ? qsTr("this cave") : qsTr("just you"));
    return entry.name + "   (" + where + ")";
};

/**
 * Asks which template and what to call the layout, then makes it and shows it.
 *
 * \return true when a layout was made
 */
CsLayoutTemplate.newLayoutDialog = function(di) {
    var doc = di.getDocument();
    var appWin = RMainWindowQt.getMainWindow();
    var all = CsLayoutTemplate.list(doc);
    var labels = [];
    for (var i = 0; i < all.length; i++) {
        labels.push(CsLayoutTemplate.label(all[i]));
    }
    var picked = QInputDialog.getItem(appWin, qsTr("New layout from a template"), qsTr("Template:"), labels, 0, false);
    if (isNull(picked) || picked === "") {
        return false;
    }
    var chosen = all[labels.indexOf(String(picked))];
    if (isNull(chosen)) {
        return false;
    }
    var name = QInputDialog.getText(appWin, qsTr("New layout"), qsTr("Name of the layout:"), QLineEdit.Normal, Layouts.freeName(doc));
    if (isNull(name) || String(name).replace(/\s/g, "") === "") {
        return false;
    }
    var made = CsLayoutTemplate.apply(doc, di, chosen.def, String(name));
    if (made === "") {
        CsTell.warn(qsTr("New layout: could not make a layout from \"%1\".").arg(chosen.name));
        return false;
    }
    Layouts.activate(di, made);
    return true;
};

/** Asks for a name and where to keep it, then saves the layout being looked at as a template. */
CsLayoutTemplate.saveDialog = function(di) {
    var doc = di.getDocument();
    var info = Layouts.current(doc);
    if (isNull(info)) {
        CsTell.warn(qsTr("Save Layout as Template: click the layout tab to save first."));
        return false;
    }
    var appWin = RMainWindowQt.getMainWindow();
    var name = QInputDialog.getText(appWin, qsTr("Save layout as a template"), qsTr("Template name:"), QLineEdit.Normal, info.name);
    if (isNull(name) || String(name).replace(/\s/g, "") === "") {
        return false;
    }
    var folders = CsLayoutTemplate.folders(doc);
    var places = [], where = [];
    for (var f = 0; f < folders.length; f++) {
        places.push(folders[f].source === "cave" ? qsTr("This cave (shared with the team through its folder)") : qsTr("Just me (this computer)"));
        where.push(folders[f]);
    }
    if (places.length === 0) {
        CsTell.warn(qsTr("Save Layout as Template: no place to keep it (save the drawing first, or the per-user folder is unknown)."));
        return false;
    }
    var at = places[0];
    if (places.length > 1) {
        at = QInputDialog.getItem(appWin, qsTr("Where to keep it"), qsTr("Keep it:"), places, 0, false);
        if (isNull(at) || at === "") {
            return false;
        }
    }
    var folder = where[places.indexOf(String(at))];
    var def = CsLayoutTemplate.capture(doc, info, String(name));
    var path = CsLayoutTemplate.save(def, folder.path);
    if (path === "") {
        CsTell.warn(qsTr("Save Layout as Template: could not write the template."));
        return false;
    }
    EAction.handleUserMessage(qsTr("Saved template \"%1\" to %2").arg(def.name).arg(path));
    return true;
};

// "+" on the layout tabs asks for a template
if (typeof Layouts !== "undefined") {
    Layouts.newFromTemplate = function(di) { return CsLayoutTemplate.newLayoutDialog(di); };
}
