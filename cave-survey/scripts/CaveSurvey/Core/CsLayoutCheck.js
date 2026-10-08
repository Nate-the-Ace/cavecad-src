// CsLayoutCheck.js -- "is this sheet ready to hand to someone?"
//
// Part of the Cave Survey Core library.
//
// Reads a layout and says what is wrong or missing, in plain words, most
// serious first. Pure over the document (no dialogs): the Check Sheet tool
// shows the list, tests read it.
//
//   error   -- something that can do harm if the sheet goes out as it is
//              (an aerial photograph would print: that is the cave's location)
//   warning -- a sheet that will confuse or fail the reader
//   note    -- worth knowing

var CsLayoutCheck = {};

CsLayoutCheck.MIN_TEXT_INCHES = 0.06;      // about 4 pt: below this a plot is unreadable

/** True when something of model space (not frozen for this viewport) lies in the viewport's view. */
CsLayoutCheck.showsAnything = function(doc, vp) {
    var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
    var a = Layouts.paperToModel(vp, c.x - hw, c.y - hh), b = Layouts.paperToModel(vp, c.x + hw, c.y + hh);
    var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    // a turned viewport sees a bigger square of the model
    var r = Math.abs(vp.getRotation()) > 1e-9 ? Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) / 2 : 0;
    if (r > 0) {
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        x1 = mx - r; x2 = mx + r; y1 = my - r; y2 = my + r;
    }
    var frozen = {}, fz = vp.getFrozenLayerIds();
    for (var f = 0; f < fz.length; f++) { frozen[fz[f]] = true; }
    var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone() || frozen[e.getLayerId()] === true) {
            continue;
        }
        if (e.getType() === RS.EntityImage) {
            continue;
        }
        var bb = e.getBoundingBox(), mn = bb.getMinimum(), mxx = bb.getMaximum();
        if (!isFinite(mn.x) || !isFinite(mxx.x)) {
            continue;
        }
        if (mxx.x >= x1 && mn.x <= x2 && mxx.y >= y1 && mn.y <= y2) {
            return true;
        }
    }
    return false;
};

/**
 * The findings for one layout: [{level, what}], most serious first.
 */
CsLayoutCheck.findings = function(doc, info) {
    var out = [];
    var add = function(level, what) { out.push({ level: level, what: what }); };
    var inch = Layouts.toPaper(doc, 25.4);
    var vps = Layouts.viewports(doc, info).filter(function(v) { return !v.isOverall(); });
    var legendId = doc.getLayerId(CsLayers.LEGEND);
    var legendBuilt = !isNull(CsLayoutFurniture.legendBox(doc));
    var cave = [], legend = [];
    for (var i = 0; i < vps.length; i++) {
        (CsLayoutFurniture.isLegendViewport(vps[i]) ? legend : cave).push(vps[i]);
    }

    if (vps.length === 0) {
        add("warning", qsTr("The layout has no viewport, so it shows no map."));
    }
    for (var v = 0; v < vps.length; v++) {
        var vp = vps[v], tag = qsTr("Viewport %1").arg(v + 1);
        if (String(vp.getCustomProperty("CaveCAD", "NoRaster", "")) !== "1") {
            add("error", qsTr("%1 would print images (an aerial photograph or a scan), which show where the cave is. Plot Layout offers to leave them out.").arg(tag));
        }
        if (!vp.isOff() && !CsLayoutCheck.showsAnything(doc, vp)) {
            add("warning", qsTr("%1 shows nothing: no drawing lies in its view. Zoom Viewport To Cave re-frames it.").arg(tag));
        }
        if (legendBuilt && !CsLayoutFurniture.isLegendViewport(vp) && legendId !== RObject.INVALID_ID &&
                vp.getFrozenLayerIds().indexOf(legendId) < 0 && CsLayoutCheck.showsLegend(doc, vp)) {
            add("warning", qsTr("%1 shows the legend sitting in the model. Hide the LEGEND layer in it (Viewport > Layers) or use Add Legend.").arg(tag));
        }
        if (!Layouts.isLocked(vp)) {
            add("note", qsTr("%1 is not locked: its scale can change by accident.").arg(tag));
        }
        var std = false, fpi = Layouts.feetPerInch(doc, vp), all = Layouts.scales();
        for (var s = 0; s < all.length; s++) {
            if (Layouts.sameScale(all[s].feetPerInch, fpi)) { std = true; }
        }
        if (!std) {
            add("note", qsTr("%1 is at %2, which is not a standard scale.").arg(tag).arg(Layouts.scaleLabel(fpi)));
        }
    }
    if (cave.length > 0) {
        var hasNorth = CsNorth.arrows(doc, info.blockId).length > 0;
        var hasBar = false;
        for (var c = 0; c < cave.length; c++) {
            if (CsScaleBar.hasBar(doc, cave[c])) { hasBar = true; }
        }
        if (!hasNorth) { add("warning", qsTr("There is no north arrow. Add North Arrow puts one on.")); }
        if (!hasBar) { add("warning", qsTr("There is no scale bar. A plot can be scaled by the person who copies it; a bar cannot. Add Scale Bar puts one on.")); }
    }
    // title block and tiny text, from what is on the sheet
    var titled = false, tiny = 0, ids = doc.queryBlockEntities(info.blockId);
    for (var k = 0; k < ids.length; k++) {
        var e = doc.queryEntity(ids[k]);
        if (isNull(e) || e.isUndone()) { continue; }
        if (CsTags.get(e, CsSheet.TAG) !== "") { titled = true; }
        if (e.getType() === RS.EntityText) {
            var h = e.getTextHeight() / inch;
            if (h > 0 && h < CsLayoutCheck.MIN_TEXT_INCHES) { tiny++; }
        }
    }
    if (!titled) { add("warning", qsTr("There is no title block. Add Title Block puts one on.")); }
    if (tiny > 0) {
        add("warning", qsTr("%1 piece(s) of text are smaller than %2 inch when printed and will be unreadable.").arg(tiny).arg(CsLayoutCheck.MIN_TEXT_INCHES));
    }
    var rank = { error: 0, warning: 1, note: 2 };
    out.sort(function(a, b) { return rank[a.level] - rank[b.level]; });
    return out;
};

/** True when the legend in model space lies inside the viewport's view. */
CsLayoutCheck.showsLegend = function(doc, vp) {
    var box = CsLayoutFurniture.legendBox(doc);
    if (isNull(box)) { return false; }
    var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
    var a = Layouts.paperToModel(vp, c.x - hw, c.y - hh), b = Layouts.paperToModel(vp, c.x + hw, c.y + hh);
    return box.maxX >= Math.min(a.x, b.x) && box.minX <= Math.max(a.x, b.x) &&
           box.maxY >= Math.min(a.y, b.y) && box.minY <= Math.max(a.y, b.y);
};

/** The findings as text for a message box. */
CsLayoutCheck.report = function(name, findings) {
    if (findings.length === 0) {
        return qsTr("Layout “%1” looks ready: nothing missing, nothing that would print an image.").arg(name);
    }
    var mark = { error: "✖ ", warning: "⚠ ", note: "• " };
    var lines = [qsTr("Layout “%1”:").arg(name), ""];
    for (var i = 0; i < findings.length; i++) {
        lines.push(mark[findings[i].level] + findings[i].what);
    }
    return lines.join("\n");
};
