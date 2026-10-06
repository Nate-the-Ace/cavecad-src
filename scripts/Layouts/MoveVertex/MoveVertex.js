/**
 * MoveVertex -- move one corner of a polygon viewport, live.
 *
 * Started by clicking one of the small square grips on a selected polygon
 * viewport's corners (see Widgets/LayoutTabs). The corner follows the mouse
 * (with the usual snaps) as an OUTLINE only -- nothing in the drawing changes
 * while it moves, so there is nothing to regenerate and it stays light on a big
 * cave. Click puts it down as one undo step; Esc or the right button drops it.
 */
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");

function MoveVertex(guiAction) {
    EAction.call(this, guiAction);
    this.vpId = RObject.INVALID_ID;
    this.loop = 0;
    this.vertex = 0;
    this.original = [];     // the loops as they were, absolute paper points
    this.current = undefined;
}

MoveVertex.prototype = new EAction();

MoveVertex.start = function(di, vpId, loop, vertex) {
    var doc = di.getDocument();
    var vp = doc.queryEntity(vpId);
    if (isNull(vp) || Layouts.isLocked(vp)) {
        EAction.handleUserWarning(qsTr("This viewport is locked: unlock it to move its corners."));
        return false;
    }
    var a = new MoveVertex(undefined);
    a.vpId = vpId;
    a.loop = loop;
    a.vertex = vertex;
    a.original = Layouts.clipLoops(vp);
    if (a.original.length <= loop || a.original[loop].length <= vertex) {
        return false;
    }
    a.armed = true;       // started from a button click, which is already over
    MoveVertex.current = a;
    di.setCurrentAction(a);
    return true;
};

MoveVertex.prototype.getToolTitle = function() {
    return qsTr("Move Viewport Corner");
};

MoveVertex.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.getDocumentInterface().setClickMode(RAction.PickCoordinate);
    this.setCrosshairCursor();
    var tip = qsTr("Move the corner and click to put it down (Esc cancels)");
    this.setCommandPrompt(tip);
    this.setLeftMouseTip(tip);
    this.setRightMouseTip(EAction.trCancel);
};

/** The loops with the chosen corner at (x, y). */
MoveVertex.prototype.loopsWith = function(x, y) {
    var out = [];
    for (var l = 0; l < this.original.length; l++) {
        var pts = [];
        for (var v = 0; v < this.original[l].length; v++) {
            pts.push(l === this.loop && v === this.vertex ? { x: x, y: y } : { x: this.original[l][v].x, y: this.original[l][v].y });
        }
        out.push(pts);
    }
    return out;
};

/** Writes loops into the viewport (one undo step). */
MoveVertex.prototype.apply = function(loops) {
    var di = this.getDocumentInterface();
    var fresh = this.getDocument().queryEntity(this.vpId);
    if (isNull(fresh)) {
        return;
    }
    Layouts._writeClip(fresh, loops);
    var op = new RModifyObjectOperation(fresh);
    op.setText(this.getToolTitle());
    di.applyOperation(op);
};

/** The outline of the shape with the corner at (x, y), drawn as preview shapes: no edit, no regeneration. */
MoveVertex.prototype.showOutline = function(x, y) {
    var di = this.getDocumentInterface();
    di.clearPreview();
    var loops = this.loopsWith(x, y);
    for (var l = 0; l < loops.length; l++) {
        var pl = new RPolyline();
        for (var v = 0; v < loops[l].length; v++) {
            pl.appendVertex(new RVector(loops[l][v].x, loops[l][v].y));
        }
        pl.setClosed(true);
        di.addAuxShapeToPreview(pl);
    }
    di.repaintViews();
};

MoveVertex.prototype.coordinateEventPreview = function(event) {
    var p = event.getModelPosition();
    this.current = { x: p.x, y: p.y };
    this.showOutline(p.x, p.y);
};

MoveVertex.prototype.coordinateEvent = function(event) {
    var p = event.getModelPosition();
    this.commit(p.x, p.y);
};

MoveVertex.prototype.mouseMoveEvent = function(event) {
    var p = event.getModelPosition();
    this.current = { x: p.x, y: p.y };
    this.showOutline(p.x, p.y);
};

MoveVertex.prototype.mouseReleaseEvent = function(event) {
    if (event.button() === Qt.RightButton) {
        this.escapeEvent();
        return;
    }
    if (event.button() !== Qt.LeftButton || isNull(this.current)) {
        return;
    }
    this.commit(this.current.x, this.current.y);
};

MoveVertex.prototype.commit = function(x, y) {
    this.getDocumentInterface().clearPreview();
    this.apply(this.loopsWith(x, y));
    this.terminate();
};

MoveVertex.prototype.escapeEvent = function() {
    this.getDocumentInterface().clearPreview();
    this.getDocumentInterface().repaintViews();
    this.terminate();
};
