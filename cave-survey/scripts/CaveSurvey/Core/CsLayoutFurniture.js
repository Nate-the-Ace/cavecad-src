// CsLayoutFurniture.js -- the Layout menu's "add a ... to this sheet" tools.
//
// Part of the Cave Survey Core library.
//
// Sheet Setup draws a whole sheet's furniture for you; these put ONE piece on
// a layout you are composing by hand -- a north arrow, a title block, a scale
// bar -- exactly as Sheet Setup would draw it (they draw through the same
// helpers, CsLayoutGen.envFor / drawNorth / drawTitle), and linked the same
// way: the north arrow and scale bar follow the viewport they belong to.
//
// Pieces made here carry no generator tag, so Sheet Setup never rewrites or
// deletes them: they are the person's.

var CsLayoutFurniture = {};

/** The layout being worked on, or undefined (and the caver is told why). */
CsLayoutFurniture.layoutOrWarn = function(doc, toolName) {
    var info = Layouts.current(doc);
    if (isNull(info) || CsModelSpace.inViewport()) {
        try {
            CsTell.warn(toolName + ": click a layout tab first (and leave the viewport) -- this puts a piece on a sheet, not in the cave.");
        } catch (e) {
        }
        return undefined;
    }
    return info;
};

/** The viewport a piece at paper (x, y) belongs to: the one under it, else the layout's only one. */
CsLayoutFurniture.viewportFor = function(doc, info, x, y) {
    return CsNorth.viewportFor(doc, info.blockId, x, y);
};

/** The latest declination reading of the survey, or null. */
CsLayoutFurniture.reading = function(doc) {
    try {
        var state = SheetSetup.readState(doc);
        if (!isNull(state) && state.ok === true) {
            return CsSheetSetup.latestDeclination(state.survey);
        }
    } catch (e) {
    }
    return null;
};

/** Inches of paper for a paper-space coordinate. */
CsLayoutFurniture.inches = function(doc, v) {
    return v / Layouts.toPaper(doc, 25.4);
};

/**
 * A north arrow with its base at paper (x, y), turned to the viewport's
 * angle and kept turned to it.
 *
 * \return true when it was added (false: no viewport to point north for)
 */
CsLayoutFurniture.addNorth = function(doc, di, info, x, y, vpOverride) {
    var vp = isNull(vpOverride) ? CsLayoutFurniture.viewportFor(doc, info, x, y) : vpOverride;
    if (isNull(vp)) {
        CsTell.warn(qsTr("Add North Arrow: there is no viewport on this layout to point north for."));
        return false;
    }
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var fresh = doc.queryEntity(vp.getId());
    var guid = CsScaleBar.ensureGuid(fresh);
    var mod = new RModifyObjectOperation(fresh);
    mod.setText(qsTr("Add north arrow"));
    mod.setTransactionGroup(group);
    di.applyOperation(mod);

    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add north arrow"), "");
    env.op.setTransactionGroup(group);
    CsLayoutGen.drawNorth(env, CsLayoutFurniture.inches(doc, x), CsLayoutFurniture.inches(doc, y),
        CsLayoutFurniture.reading(doc), guid);
    di.applyOperation(env.op);
    // turned to the viewport's angle straight away
    CsNorth.sync(doc, di, doc.queryEntity(vp.getId()), group, false);
    return true;
};

/** The title block with its lower left at paper (x, y), filled from the survey and what the drawing already says. */
CsLayoutFurniture.addTitle = function(doc, di, info, x, y) {
    var values = {};
    try {
        var state = SheetSetup.readState(doc);
        values = SheetSetup.titleValues(doc, isNull(state) ? {} : state.filled);
    } catch (e) {
        values = {};
    }
    var lines = CsSheetSetup.titleLines(values);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add title block"), "");
    var xIn = CsLayoutFurniture.inches(doc, x), yIn = CsLayoutFurniture.inches(doc, y);
    CsLayoutGen.drawTitle(env, xIn, yIn + CsSheetSetup.linesHeight(lines), lines, values, "plan");
    di.applyOperation(env.op);
    return lines.length;
};

/** A scale bar for the viewport under (x, y), starting at paper (x, y). */
CsLayoutFurniture.addScaleBar = function(doc, di, info, x, y, vpOverride, quiet) {
    var vp = isNull(vpOverride) ? CsLayoutFurniture.viewportFor(doc, info, x, y) : vpOverride;
    if (isNull(vp)) {
        if (quiet !== true) { CsTell.warn(qsTr("Add Scale Bar: there is no viewport on this layout to measure.")); }
        return false;
    }
    if (CsScaleBar.hasBar(doc, vp)) {
        if (quiet === true) { return false; }
        CsTell.warn(qsTr("Add Scale Bar: this viewport already has one (a viewport has one bar; delete it to place another)."));
        return false;
    }
    return CsScaleBar.addFor(doc, di, vp, CsLayoutFurniture.inches(doc, x), CsLayoutFurniture.inches(doc, y));
};

/**
 * The body every "click where it goes" tool shares.
 *
 * \param tool   the EAction
 * \param name   the tool's title
 * \param prompt what to click
 * \param place  function(doc, di, info, x, y) called with the click
 */
CsLayoutFurniture.beginPlacing = function(tool, name, prompt) {
    var doc = tool.getDocument();
    if (isNull(CsLayoutFurniture.layoutOrWarn(doc, name))) {
        tool.terminate();
        return false;
    }
    var di = tool.getDocumentInterface();
    di.setClickMode(RAction.PickCoordinate);
    tool.setCrosshairCursor();
    tool.setCommandPrompt(prompt);
    tool.setLeftMouseTip(prompt);
    tool.setRightMouseTip(EAction.trCancel);
    return true;
};


/** A border `inset` inches inside the paper's edge, on the BORDER layer. */
CsLayoutFurniture.addBorder = function(doc, di, info, inset) {
    var ps = Layouts.paperSize(doc, info);
    var inch = Layouts.toPaper(doc, 25.4);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add border"), "");
    var W = ps.w / inch, H = ps.h / inch, b = inset;
    env.line(b, b, W - b, b, CsLayers.BORDER);
    env.line(W - b, b, W - b, H - b, CsLayers.BORDER);
    env.line(W - b, H - b, b, H - b, CsLayers.BORDER);
    env.line(b, H - b, b, b, CsLayers.BORDER);
    di.applyOperation(env.op);
    return true;
};


/** True when the layout already has a border (axis-aligned BORDER lines most of the paper wide and tall). */
CsLayoutFurniture.hasBorder = function(doc, info) {
    var ps = Layouts.paperSize(doc, info), inch = Layouts.toPaper(doc, 25.4);
    var W = ps.w / inch, H = ps.h / inch, h = 0, v = 0;
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone() || e.getType() !== RS.EntityLine || CsBind.layerNameOf(doc, e) !== CsLayers.BORDER) {
            continue;
        }
        var a = e.getStartPoint(), b = e.getEndPoint(), len = a.getDistanceTo(b) / inch;
        if (Math.abs(a.y - b.y) < 1e-9 && len >= 0.6 * W) { h++; }
        else if (Math.abs(a.x - b.x) < 1e-9 && len >= 0.6 * H) { v++; }
    }
    return h >= 2 && v >= 2;
};

// ---------------------------------------------------------------------
// The legend: a VIEWPORT onto the legend in model space
//
// Build Legend draws the legend in model space on the LEGEND layer. A sheet
// shows it the AutoCAD way: a viewport framed on the legend that hides every
// other layer, while the cave's own viewports hide LEGEND -- so the legend is
// drawn once, at its own scale, and never lands on top of the map.
// ---------------------------------------------------------------------

/** The legend's extents in model space, {minX, minY, maxX, maxY}, or undefined when none is built. */
CsLayoutFurniture.legendBox = function(doc) {
    var box;
    var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) {
            continue;
        }
        var mine = CsTags.get(e, CsLegend.TAG) !== "" || CsBind.layerNameOf(doc, e) === CsLayers.LEGEND;
        if (!mine) {
            continue;
        }
        var b = e.getBoundingBox(), mn = b.getMinimum(), mx = b.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mx.x) || !isFinite(mn.y) || !isFinite(mx.y)) {
            continue;
        }
        if (isNull(box)) {
            box = { minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y };
        }
        else {
            box.minX = Math.min(box.minX, mn.x); box.minY = Math.min(box.minY, mn.y);
            box.maxX = Math.max(box.maxX, mx.x); box.maxY = Math.max(box.maxY, mx.y);
        }
    }
    return box;
};

/** Every layer id EXCEPT the named one: what a legend viewport hides. */
CsLayoutFurniture.allLayersExcept = function(doc, keepName) {
    var ids = [], names = doc.getLayerNames();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]) !== keepName) {
            ids.push(doc.getLayerId(names[i]));
        }
    }
    return ids;
};

/** True when a viewport is a legend viewport. */
CsLayoutFurniture.isLegendViewport = function(vp) {
    return String(vp.getCustomProperty("CaveCAD", "Legend", "")) === "1";
};

/**
 * Adds a legend viewport with its top left at paper (x, y), at the first
 * standard scale at which the legend fits in about a third of the sheet, and
 * makes the layout's other viewports hide LEGEND.
 *
 * \return true when added (false: no legend built yet; the caver is told)
 */
CsLayoutFurniture.addLegend = function(doc, di, info, x, y) {
    var box = CsLayoutFurniture.legendBox(doc);
    if (isNull(box)) {
        CsTell.warn(qsTr("Add Legend: there is no legend in the drawing yet. In the model, run Cave Survey > Build Legend first."));
        return false;
    }
    var ps = Layouts.paperSize(doc, info);
    var w = Math.max(box.maxX - box.minX, 1e-9), h = Math.max(box.maxY - box.minY, 1e-9);
    var fpi = NewViewport.fitScale(doc, ps.w / 3, ps.h / 3, box);
    var s = Layouts.scaleFor(doc, fpi);
    var vw = w * s * 1.04, vh = h * s * 1.04;
    var x0 = Math.min(Math.max(x, 0), Math.max(0, ps.w - vw));
    var y1 = Math.max(Math.min(y, ps.h), vh);
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(x0 + vw / 2, y1 - vh / 2));
    vp.setWidth(vw);
    vp.setHeight(vh);
    vp.setScale(s);
    vp.setViewCenter(new RVector((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId);
    vp.setLayerId(doc.getCurrentLayerId());
    vp.setFrozenLayerIds(CsLayoutFurniture.allLayersExcept(doc, CsLayers.LEGEND));
    vp.setCustomProperty("CaveCAD", "NoRaster", "1");
    vp.setCustomProperty("CaveCAD", "Legend", "1");
    vp.setStatus(vp.getStatus() | Layouts.LOCK_BIT);

    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var add = new RAddObjectOperation(vp, false);
    add.setText(qsTr("Add legend"));
    add.setTransactionGroup(group);
    di.applyOperation(add);

    // the map's own viewports must not show the legend
    var legendId = doc.getLayerId(CsLayers.LEGEND);
    var others = Layouts.viewports(doc, info);
    for (var i = 0; i < others.length; i++) {
        var o = others[i];
        if (o.isOverall() || CsLayoutFurniture.isLegendViewport(o)) {
            continue;
        }
        var ids = o.getFrozenLayerIds();
        if (ids.indexOf(legendId) < 0 && legendId !== RObject.INVALID_ID) {
            var fresh = doc.queryEntity(o.getId());
            ids.push(legendId);
            fresh.setFrozenLayerIds(ids);
            var mod = new RModifyObjectOperation(fresh);
            mod.setText(qsTr("Add legend"));
            mod.setTransactionGroup(group);
            di.applyOperation(mod);
        }
    }
    return true;
};


/** The Add Border tool's body: a 0.2 inch border on the current layout, unless it already has one. */
CsLayoutFurniture.addBorderTool = function(di) {
    var doc = di.getDocument();
    var info = CsLayoutFurniture.layoutOrWarn(doc, qsTr("Add Border"));
    if (isNull(info)) {
        return false;
    }
    if (CsLayoutFurniture.hasBorder(doc, info)) {
        CsTell.warn(qsTr("Add Border: this layout already has a border."));
        return false;
    }
    return CsLayoutFurniture.addBorder(doc, di, info, 0.2);
};


/** The viewport on the layout under paper (x, y), else undefined (not the overall one). */
CsLayoutFurniture.viewportAtPoint = function(doc, info, x, y) {
    var vp = Layouts.viewportAt(doc, info, x, y);
    return (isNull(vp) || vp.isOverall()) ? undefined : vp;
};

/** What a viewport is looking at: "legend", "profile" or "cave" (read from what it hides). */
CsLayoutFurniture.viewOf = function(doc, vp) {
    if (CsLayoutFurniture.isLegendViewport(vp)) {
        return "legend";
    }
    var plan = false, profile = false, fz = vp.getFrozenLayerIds();
    for (var i = 0; i < fz.length; i++) {
        var fr = CsLayers.frameOf(String(doc.getLayerName(fz[i])));
        if (fr === "plan") { plan = true; }
        if (fr === "profile") { profile = true; }
    }
    return plan && !profile ? "profile" : "cave";
};

/**
 * Re-frames a viewport on what it is for: the whole cave (or the elevation, or
 * the legend), at the first standard scale at which that fits its box.
 *
 * \return true when it changed
 */
CsLayoutFurniture.zoomViewport = function(doc, di, vp) {
    if (Layouts.isLocked(vp)) {
        CsTell.warn(qsTr("Zoom Viewport: this viewport is locked; unlock it to re-frame it."));
        return false;
    }
    var ext = CsLayoutTemplate.extentsOf(doc, CsLayoutFurniture.viewOf(doc, vp));
    if (isNull(ext)) {
        CsTell.warn(qsTr("Zoom Viewport: there is nothing in the drawing for this viewport to show yet."));
        return false;
    }
    var fresh = doc.queryEntity(vp.getId());
    var fpi = NewViewport.fitScale(doc, fresh.getWidth(), fresh.getHeight(), ext);
    fresh.setScale(Layouts.scaleFor(doc, fpi));
    fresh.setViewCenter(new RVector((ext.minX + ext.maxX) / 2 - fresh.getViewTarget().x, (ext.minY + ext.maxY) / 2 - fresh.getViewTarget().y));
    var op = new RModifyObjectOperation(fresh);
    op.setText(qsTr("Zoom viewport"));
    di.applyOperation(op);
    return true;
};

/** Gives `dst` the scale and rotation of `src`. \return true when it changed */
CsLayoutFurniture.matchViewport = function(doc, di, src, dst) {
    if (src.getId() === dst.getId()) {
        return false;
    }
    if (Layouts.isLocked(dst)) {
        CsTell.warn(qsTr("Match Viewport: the viewport you picked is locked; unlock it first."));
        return false;
    }
    var fresh = doc.queryEntity(dst.getId());
    fresh.setScale(src.getScale());
    fresh.setRotation(src.getRotation());
    var op = new RModifyObjectOperation(fresh);
    op.setText(qsTr("Match viewport"));
    di.applyOperation(op);
    return true;
};

/** The one selected viewport on the current layout, or undefined. */
CsLayoutFurniture.selectedViewport = function(doc, info) {
    var ids = doc.querySelectedEntities();
    var found;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && e.getType() === RS.EntityViewport && !e.isOverall() && e.getBlockId() === info.blockId) {
            if (!isNull(found)) {
                return undefined;
            }
            found = e;
        }
    }
    return found;
};


// ---------------------------------------------------------------------
// Detail viewports: a magnified circle of the map, marked on the map
// ---------------------------------------------------------------------

/** The next detail letter on the layout: "A", "B", ... by counting the details already there. */
CsLayoutFurniture.nextDetailLetter = function(doc, info) {
    var n = 0, vps = Layouts.viewports(doc, info);
    for (var i = 0; i < vps.length; i++) {
        if (String(vps[i].getCustomProperty("CaveCAD", "Detail", "")) !== "") { n++; }
    }
    return String.fromCharCode(65 + (n % 26));
};

/**
 * A detail of the map: a circle of radius `radius` (paper units) centred at
 * paper `from` on the map viewport `parent` is shown MAGNIFIED `mag` times in
 * a circular viewport centred at paper `to`. The map gets a circle and a
 * leader to the detail; both carry the letter.
 *
 * \return the letter, or "" when it could not be made
 */
CsLayoutFurniture.addDetail = function(doc, di, info, parent, from, radius, to, mag) {
    if (isNull(parent) || !(radius > 0) || !(mag > 0)) {
        return "";
    }
    var letter = CsLayoutFurniture.nextDetailLetter(doc, info);
    var ps = Layouts.paperSize(doc, info), inch = Layouts.toPaper(doc, 25.4);
    var R = radius * mag;
    var cx = Math.min(Math.max(to.x, R), ps.w - R), cy = Math.min(Math.max(to.y, R), ps.h - R);
    var model = Layouts.paperToModelTurned(parent, from.x, from.y);

    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(cx, cy));
    vp.setWidth(2 * R);
    vp.setHeight(2 * R);
    vp.setScale(parent.getScale() * mag);
    vp.setRotation(parent.getRotation());
    vp.setViewCenter(new RVector(model.x - parent.getViewTarget().x, model.y - parent.getViewTarget().y));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId);
    vp.setLayerId(doc.getCurrentLayerId());
    vp.setFrozenLayerIds(parent.getFrozenLayerIds());
    vp.setCustomProperty("CaveCAD", "NoRaster", "1");
    vp.setCustomProperty("CaveCAD", "Detail", letter);
    vp.setStatus(vp.getStatus() | Layouts.LOCK_BIT);
    var loop = [], sides = 128;
    for (var k = 0; k < sides; k++) {
        var a = 2 * Math.PI * k / sides;
        loop.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
    Layouts._writeClip(vp, [loop]);

    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var add = new RAddObjectOperation(vp, false);
    add.setText(qsTr("Add detail"));
    add.setTransactionGroup(group);
    di.applyOperation(add);

    // the marker on the map and the leader to the detail, in the border layer's ink
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add detail"), "");
    env.op.setTransactionGroup(group);
    var P = function(v) { return v / inch; };
    var circle = new RCircleEntity(doc, new RCircleData(new RVector(from.x, from.y), radius));
    env.add(circle, CsLayers.BORDER, "detail");
    CsTags.set(circle, "DetailMark", letter);
    var ang = Math.atan2(cy - from.y, cx - from.x);
    var dist = Math.sqrt((cx - from.x) * (cx - from.x) + (cy - from.y) * (cy - from.y));
    if (dist > radius + R) {
        env.line(P(from.x + radius * Math.cos(ang)), P(from.y + radius * Math.sin(ang)),
                 P(cx - R * Math.cos(ang)), P(cy - R * Math.sin(ang)), CsLayers.BORDER, "detail");
    }
    env.text(P(from.x), P(from.y + radius) + 0.12, CsSheetSetup.TEXT.body, letter, CsLayers.BORDER, "detail", false, 0, RS.HAlignCenter);
    env.text(P(cx), P(cy + R) + 0.12, CsSheetSetup.TEXT.body, qsTr("DETAIL %1  (x%2)").arg(letter).arg(mag), CsLayers.BORDER, "detail", false, 0, RS.HAlignCenter);
    di.applyOperation(env.op);
    return letter;
};


// ---------------------------------------------------------------------
// Sheet index
// ---------------------------------------------------------------------

/** Removes what an earlier `kind` ("SheetIndex" | "Grid") put on the layout (tagged ids kept in `key`). */
CsLayoutFurniture.removeTagged = function(doc, di, info, tagKey, value) {
    var op = null, ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) { continue; }
        var t = CsTags.get(e, tagKey);
        if (t !== "" && (isNull(value) || t === value)) {
            if (op === null) {
                op = new RDeleteObjectsOperation();
                op.setText(qsTr("Replace"));
            }
            op.deleteObject(e);
        }
    }
    if (op !== null) {
        di.applyOperation(op);
    }
};

/** The rows of the index: one per layout, "name   paper   1" = 40 ft". */
CsLayoutFurniture.indexRows = function(doc) {
    var rows = [], all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        var vps = Layouts.viewports(doc, all[i]).filter(function(v) { return !v.isOverall() && !CsLayoutFurniture.isLegendViewport(v) && String(v.getCustomProperty("CaveCAD", "Detail", "")) === ""; });
        var scale = vps.length > 0 ? Layouts.scaleLabel(Layouts.feetPerInch(doc, vps[0])) : "";
        var paper = Layouts.paperNameOf(all[i].paperMM.w, all[i].paperMM.h);
        rows.push({ name: all[i].name, scale: scale, paper: paper ? paper : "" });
    }
    return rows;
};

/**
 * A sheet index with its top left at paper (x, y): every layout, its paper
 * and its scale. Re-adding it replaces the earlier one on this layout.
 */
CsLayoutFurniture.addIndex = function(doc, di, info, x, y) {
    CsLayoutFurniture.removeTagged(doc, di, info, "SheetIndex");
    var rows = CsLayoutFurniture.indexRows(doc);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add sheet index"), "");
    var inch = Layouts.toPaper(doc, 25.4);
    var xIn = x / inch, yIn = y / inch, h = CsSheetSetup.TEXT.body, step = h * 1.6;
    var put = function(px, py, label, heading) {
        var t = env.text(px, py, heading ? CsSheetSetup.TEXT.heading : h, label, CsLayers.TITLE_BLOCK, "index", true);
        CsTags.set(t, "SheetIndex", "1");
    };
    put(xIn, yIn, qsTr("SHEET INDEX"), true);
    var row = yIn - step * 1.4;
    for (var i = 0; i < rows.length; i++) {
        put(xIn, row, rows[i].name, false);
        put(xIn + 1.6, row, rows[i].paper, false);
        put(xIn + 2.8, row, rows[i].scale, false);
        row -= step;
    }
    di.applyOperation(env.op);
    return rows.length;
};

// ---------------------------------------------------------------------
// Coordinate grid round a viewport
//
// Ticks and labels just OUTSIDE a rectangular, unturned viewport. By default
// the labels are DISTANCES FROM THE CAVE'S SOUTH-WEST CORNER (0, 100, 200 ...):
// a map must not carry where the cave is. True map coordinates are offered
// only after the caver has said so in as many words.
// ---------------------------------------------------------------------

/**
 * Redraws a layout's sheet index where it stands, if it has one and what it lists is out of date (a layout was
 * renamed, added or removed). Compares what the index SAYS to what it should say first, so an index that is right
 * is never touched.
 *
 * \return 1 when it was redrawn, else 0
 */
CsLayoutFurniture.refreshIndex = function(doc, di, info) {
    var heading = null, have = [];
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone() || CsTags.get(e, "SheetIndex") === "") {
            continue;
        }
        var t = CsSheet.textOf(e);
        have.push(t);
        if (t === qsTr("SHEET INDEX")) {
            heading = e;
        }
    }
    if (heading === null) {
        return 0;
    }
    var want = [qsTr("SHEET INDEX")], rows = CsLayoutFurniture.indexRows(doc);
    for (var r = 0; r < rows.length; r++) {
        want.push(rows[r].name, rows[r].paper, rows[r].scale);
    }
    var a = have.slice().sort().join("\n"), b = want.slice().sort().join("\n");
    if (a === b) {
        return 0;
    }
    var at = heading.getPosition();
    CsLayoutFurniture.addIndex(doc, di, info, at.x, at.y);
    return 1;
};

CsLayoutFurniture.GRID_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/** The first step (in the drawing's own units) at which grid lines are at least `minIn` inches apart on paper. */
CsLayoutFurniture.gridStep = function(doc, vp, minIn) {
    var perUnitIn = vp.getScale() / Layouts.toPaper(doc, 25.4);      // inches of paper per model unit
    var feetUnit = Layouts.groundFoot(doc);                          // model units per foot
    var steps = CsLayoutFurniture.GRID_STEPS;
    for (var i = 0; i < steps.length; i++) {
        if (steps[i] * feetUnit * perUnitIn >= minIn) {
            return steps[i] * feetUnit;
        }
    }
    return steps[steps.length - 1] * feetUnit;
};

/**
 * \param opts.absolute  label with the true map coordinates (default: distance from the cave's south-west corner)
 * \return the number of ticks drawn, or -1 when the viewport cannot take a grid
 */
CsLayoutFurniture.addGrid = function(doc, di, info, vp, opts) {
    if (Layouts.hasClip(vp) || Math.abs(vp.getRotation()) > 1e-9) {
        CsTell.warn(qsTr("Add Grid: a grid goes round a rectangular viewport that is not turned."));
        return -1;
    }
    var guid = CsScaleBar.ensureGuid(vp);
    CsLayoutFurniture.removeTagged(doc, di, info, "GridOf", guid);
    var absolute = !isNull(opts) && opts.absolute === true;
    var origin = { x: 0, y: 0 };
    if (!absolute) {
        var cb = null;
        try { cb = SheetSetup.caveBox(doc); } catch (e) { cb = null; }
        if (isNull(cb)) { cb = NewViewport.modelExtents(doc); }
        if (!isNull(cb)) { origin = { x: cb.minX, y: cb.minY }; }
    }
    var inch = Layouts.toPaper(doc, 25.4);
    var step = CsLayoutFurniture.gridStep(doc, vp, 0.8);
    var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
    var left = c.x - hw, right = c.x + hw, bottom = c.y - hh, top = c.y + hh;
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Add grid"), "");
    var P = function(v) { return v / inch; };
    var tick = 0.08, th = CsSheetSetup.TEXT.small, n = 0;
    var mark = function(entity) { CsTags.set(entity, "GridOf", guid); return entity; };
    var fmt = function(v) { return String(Math.round(v / Layouts.groundFoot(doc))); };
    // model x at a paper x, and back
    var modelX = function(px) { return Layouts.paperToModel(vp, px, c.y).x; };
    var modelY = function(py) { return Layouts.paperToModel(vp, c.x, py).y; };
    var paperX = function(mx) { return c.x + (mx - Layouts.paperToModel(vp, c.x, c.y).x) * vp.getScale(); };
    var paperY = function(my) { return c.y + (my - Layouts.paperToModel(vp, c.x, c.y).y) * vp.getScale(); };
    var x0 = Math.ceil((modelX(left) - origin.x) / step), x1 = Math.floor((modelX(right) - origin.x) / step);
    for (var gx = x0; gx <= x1; gx++) {
        var px = paperX(origin.x + gx * step);
        mark(env.line(P(px), P(bottom) - tick, P(px), P(bottom), CsLayers.BORDER, "grid"));
        mark(env.line(P(px), P(top), P(px), P(top) + tick, CsLayers.BORDER, "grid"));
        mark(env.text(P(px), P(bottom) - tick - th, th, fmt(absolute ? origin.x + gx * step : gx * step), CsLayers.BORDER, "grid", true, 0, RS.HAlignCenter));
        n += 2;
    }
    var y0 = Math.ceil((modelY(bottom) - origin.y) / step), y1 = Math.floor((modelY(top) - origin.y) / step);
    for (var gy = y0; gy <= y1; gy++) {
        var py = paperY(origin.y + gy * step);
        mark(env.line(P(left) - tick, P(py), P(left), P(py), CsLayers.BORDER, "grid"));
        mark(env.line(P(right), P(py), P(right) + tick, P(py), CsLayers.BORDER, "grid"));
        mark(env.text(P(left) - tick - 0.04, P(py), th, fmt(absolute ? origin.y + gy * step : gy * step), CsLayers.BORDER, "grid", true, 0, RS.HAlignRight));
        n += 2;
    }
    di.applyOperation(env.op);
    return n;
};
