/**
 * ViewportShape -- polygon viewports and trimming.
 *
 *   ViewportShape.startPolygon(di)        draw a NEW viewport as a polygon: click the corners
 *   ViewportShape.startTrim(di, vpId)     CUT a polygon out of an existing viewport
 *
 * Click the corners; a click on the first point, Enter, or the right button
 * closes the shape (three corners at least); Backspace takes the last corner
 * back; Escape cancels. Snaps work as in any drawing tool. One undo step.
 */
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Layouts/NewViewport/NewViewport.js");

function ViewportShape(guiAction) {
    EAction.call(this, guiAction);
    this.mode = "polygon";
    this.vpId = RObject.INVALID_ID;
    this.points = [];
}

ViewportShape.prototype = new EAction();

ViewportShape.start = function(di, mode, vpId) {
    var doc = di.getDocument();
    if (isNull(Layouts.current(doc))) {
        EAction.handleUserWarning(qsTr("Click a layout tab first: viewports live on sheets, not in the model."));
        return false;
    }
    if (mode === "trim") {
        var vp = doc.queryEntity(vpId);
        if (isNull(vp)) {
            return false;
        }
    }
    var a = new ViewportShape(undefined);
    a.mode = mode;
    a.vpId = isNull(vpId) ? RObject.INVALID_ID : vpId;
    ViewportShape.current = a;
    di.setCurrentAction(a);
    return true;
};

ViewportShape.startPolygon = function(di) { return ViewportShape.start(di, "polygon"); };
ViewportShape.startTrim = function(di, vpId) { return ViewportShape.start(di, "trim", vpId); };

ViewportShape.prototype.getToolTitle = function() {
    return this.mode === "trim" ? qsTr("Trim Viewport") : qsTr("Polygonal Viewport");
};

ViewportShape.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var di = this.getDocumentInterface();
    di.setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();
    this.prompt();
};

ViewportShape.prototype.prompt = function() {
    var what = this.mode === "trim" ? qsTr("Corner of the piece to cut out") : qsTr("Corner of the viewport");
    var tip = what + (this.points.length >= 3 ? qsTr(" (Enter or right-click to finish)") : "");
    this.setCommandPrompt(tip);
    this.setLeftMouseTip(tip);
    this.setRightMouseTip(this.points.length >= 3 ? qsTr("Finish") : EAction.trCancel);
};

ViewportShape.prototype.coordinateEvent = function(event) {
    var p = event.getModelPosition();
    if (this.points.length >= 3 && this.closesOn(p)) {
        this.finishShape();
        return;
    }
    this.points.push({ x: p.x, y: p.y });
    this.prompt();
    this.coordinateEventPreview(event);
};

/** True when `p` is on the first point (within a few pixels): clicking it closes the shape. */
ViewportShape.prototype.closesOn = function(p) {
    var view = this.getDocumentInterface().getLastKnownViewWithFocus();
    var first = new RVector(this.points[0].x, this.points[0].y);
    if (isNull(view)) {
        return first.getDistanceTo(p) < 1e-9;
    }
    var a = view.mapToView(first), b = view.mapToView(p);
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) < 10;
};

ViewportShape.prototype.coordinateEventPreview = function(event) {
    var di = this.getDocumentInterface();
    di.clearPreview();
    if (this.points.length === 0) {
        return;
    }
    var pl = new RPolyline();
    for (var i = 0; i < this.points.length; i++) {
        pl.appendVertex(new RVector(this.points[i].x, this.points[i].y));
    }
    var m = event.getModelPosition();
    pl.appendVertex(new RVector(m.x, m.y));
    if (this.points.length >= 2) {
        pl.setClosed(true);
    }
    di.addAuxShapeToPreview(pl);
    di.repaintViews();
};

ViewportShape.prototype.mouseReleaseEvent = function(event) {
    if (event.button() === Qt.RightButton) {
        if (this.points.length >= 3) {
            this.finishShape();
        }
        else {
            this.escapeEvent();
        }
        return;
    }
    EAction.prototype.mouseReleaseEvent.call(this, event);
};

ViewportShape.prototype.keyPressEvent = function(event) {
    var key = event.key();
    if (key === Qt.Key_Return || key === Qt.Key_Enter) {
        if (this.points.length >= 3) {
            this.finishShape();
        }
        event.accept();
        return;
    }
    if (key === Qt.Key_Backspace) {
        this.points.pop();
        this.getDocumentInterface().clearPreview();
        this.prompt();
        event.accept();
        return;
    }
    event.ignore();
};

ViewportShape.prototype.finishShape = function() {
    var di = this.getDocumentInterface();
    var doc = this.getDocument();
    var loop = this.points.slice(0);
    di.clearPreview();
    if (this.mode === "trim") {
        var vp = doc.queryEntity(this.vpId);
        if (!isNull(vp) && Layouts.isLocked(vp) === false) {
            Layouts.cutOut(di, vp, loop);
        }
        else if (!isNull(vp)) {
            EAction.handleUserWarning(qsTr("This viewport is locked: unlock it to trim it."));
        }
    }
    else {
        ViewportShape.createPolygon(di, loop);
    }
    di.repaintViews();
    this.terminate();
};

/** Makes a viewport of the polygon, showing the whole model at the first standard scale that fits. */
ViewportShape.createPolygon = function(di, loop) {
    var doc = di.getDocument();
    var info = Layouts.current(doc);
    if (isNull(info) || loop.length < 3) {
        return false;
    }
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (var i = 0; i < loop.length; i++) {
        x1 = Math.min(x1, loop[i].x); x2 = Math.max(x2, loop[i].x);
        y1 = Math.min(y1, loop[i].y); y2 = Math.max(y2, loop[i].y);
    }
    if (x2 - x1 < 1e-9 || y2 - y1 < 1e-9) {
        return false;
    }
    var extents = NewViewport.modelExtents(doc);
    var fpi = NewViewport.fitScale(doc, x2 - x1, y2 - y1, extents);
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector((x1 + x2) / 2, (y1 + y2) / 2));
    vp.setWidth(x2 - x1);
    vp.setHeight(y2 - y1);
    vp.setScale(Layouts.scaleFor(doc, fpi));
    vp.setViewCenter(isNull(extents) ? new RVector(0, 0) :
        new RVector((extents.minX + extents.maxX) / 2, (extents.minY + extents.maxY) / 2));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(info.blockId);
    vp.setLayerId(doc.getCurrentLayerId());
    vp.setCustomProperty("CaveCAD", "NoRaster", "1");
    Layouts._writeClip(vp, [loop]);
    var op = new RAddObjectOperation(vp, false);
    op.setText(qsTr("Polygonal Viewport"));
    di.applyOperation(op);
    return true;
};

ViewportShape.prototype.escapeEvent = function() {
    this.getDocumentInterface().clearPreview();
    this.getDocumentInterface().repaintViews();
    this.terminate();
};
