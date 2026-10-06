/**
 * NewViewport -- draw a viewport on a layout: click two corners.
 *
 * The viewport opens showing the whole model at the first standard scale
 * that fits it (so the cave is on the sheet the moment it is drawn), centred
 * on the model's extents. Scale it from the list in the tab strip, zoom
 * inside it (double-click), or drag its contents grip.
 *
 * Like everything on a plotted map it leaves raster images out by default
 * (CaveCAD/NoRaster): an aerial photograph is the cave's location in a
 * picture. The property is on the viewport for the person who wants them.
 */
include("scripts/Draw/DrawBasedOnRectanglePP.js");
include("scripts/Layouts/Layouts.js");

function NewViewport(guiAction) {
    DrawBasedOnRectanglePP.call(this, guiAction);
    this.rotate = false;
}

NewViewport.prototype = new DrawBasedOnRectanglePP();
NewViewport.includeBasePath = includeBasePath;

NewViewport.prototype.beginEvent = function() {
    var doc = this.getDocument();
    if (isNull(Layouts.current(doc))) {
        EAction.handleUserWarning(qsTr("New Viewport: click a layout tab first -- viewports live on sheets, not in the model."));
        this.terminate();
        return;
    }
    DrawBasedOnRectanglePP.prototype.beginEvent.call(this);
};

/** Bounding box of everything in model space, or undefined when it is empty. */
NewViewport.modelExtents = function(doc) {
    var ids = doc.queryBlockEntities(doc.getModelSpaceBlockId());
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) {
            continue;
        }
        try {
            var b = e.getBoundingBox();
            var mn = b.getMinimum(), mx = b.getMaximum();
            if (isFinite(mn.x) && isFinite(mx.x) && isFinite(mn.y) && isFinite(mx.y)) {
                x1 = Math.min(x1, mn.x); y1 = Math.min(y1, mn.y);
                x2 = Math.max(x2, mx.x); y2 = Math.max(y2, mx.y);
            }
        } catch (e2) {
        }
    }
    return isFinite(x1) ? { minX: x1, minY: y1, maxX: x2, maxY: y2 } : undefined;
};

/**
 * The scale a viewport of this paper size needs to hold `extents`: the
 * smallest standard scale (feet per inch) at least as coarse as the fit.
 */
NewViewport.fitScale = function(doc, widthPaper, heightPaper, extents) {
    if (isNull(extents)) {
        return 40;
    }
    var w = Math.max(extents.maxX - extents.minX, 1e-9), h = Math.max(extents.maxY - extents.minY, 1e-9);
    // paper units per model unit that just fits, a little room round it
    var s = Math.min(widthPaper / w, heightPaper / h) * 0.95;
    var fpi = (Layouts.paperInch(doc) / s) / Layouts.groundFoot(doc);
    // the list is imperial then metric; the fit is the smallest scale, of either kind, that is coarse enough
    var all = Layouts.scales().sort(function(a, b) { return a.feetPerInch - b.feetPerInch; });
    for (var i = 0; i < all.length; i++) {
        if (all[i].feetPerInch >= fpi * (1 - 1e-9)) {
            return all[i].feetPerInch;
        }
    }
    return all[all.length - 1].feetPerInch;
};

NewViewport.prototype.getOperation = function(preview) {
    var corners = this.getCorners();
    if (corners.length !== 4) {
        return undefined;
    }
    var doc = this.getDocument();
    var info = Layouts.current(doc);
    if (isNull(info)) {
        return undefined;
    }
    var x1 = Math.min(corners[0].x, corners[2].x), x2 = Math.max(corners[0].x, corners[2].x);
    var y1 = Math.min(corners[0].y, corners[2].y), y2 = Math.max(corners[0].y, corners[2].y);
    var w = x2 - x1, h = y2 - y1;
    if (w < 1e-9 || h < 1e-9) {
        return undefined;
    }

    var op = new RAddObjectsOperation();
    op.setText(this.getToolTitle());
    if (preview) {
        // a rectangle outline is all a preview needs
        var pl = new RPolyline();
        for (var c = 0; c < 4; c++) {
            pl.appendVertex(new RVector(c === 1 || c === 2 ? x2 : x1, c >= 2 ? y2 : y1));
        }
        pl.setClosed(true);
        op.addObject(new RPolylineEntity(doc, new RPolylineData(pl)), false);
        return op;
    }

    var extents = NewViewport.modelExtents(doc);
    var fpi = NewViewport.fitScale(doc, w, h, extents);
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector((x1 + x2) / 2, (y1 + y2) / 2));
    vp.setWidth(w);
    vp.setHeight(h);
    vp.setScale(Layouts.scaleFor(doc, fpi));
    vp.setViewCenter(isNull(extents) ? new RVector(0, 0) :
        new RVector((extents.minX + extents.maxX) / 2, (extents.minY + extents.maxY) / 2));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId);
    vp.setLayerId(doc.getCurrentLayerId());
    vp.setCustomProperty("CaveCAD", "NoRaster", "1");
    op.addObject(vp, false);
    return op;
};

NewViewport.prototype.getToolTitle = function() {
    return qsTr("New Viewport");
};
