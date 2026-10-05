/**
 * RotateViewport -- turn the contents of a viewport, live.
 *
 * Started by clicking the diamond glyph above a selected viewport (see
 * Widgets/LayoutTabs). Move the mouse round the viewport's centre: the
 * contents follow, and the angle sticks to round values -- the FARTHER the
 * mouse is from the centre, the finer the steps (45, 15, 5, 1 degrees, then
 * half-degrees), so a wide sweep is coarse and a long reach is precise.
 * Type an angle (degrees, counter-clockwise, absolute) to set it exactly:
 * the digits appear next to the mouse; Enter or a click applies, Esc or the
 * right button cancels. One undo step.
 */
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");

function RotateViewport(guiAction) {
    EAction.call(this, guiAction);
    this.vpId = RObject.INVALID_ID;
    this.rot0 = 0;
    this.centre = undefined;
    this.angle0 = 0;        // mouse angle where the grab began
    this.rotation = 0;      // the rotation being shown (radians)
    this.typed = "";
    this.armed = true;      // started from a button click, which is already over
    this.label = undefined;
    this.lastScreen = undefined;
}

RotateViewport.prototype = new EAction();

/** Step in degrees for a mouse `px` pixels from the centre. */
RotateViewport.stepFor = function(px) {
    if (px < 70) { return 45; }
    if (px < 140) { return 15; }
    if (px < 240) { return 5; }
    if (px < 380) { return 1; }
    return 0.5;
};

/** Radians -> degrees in (-180, 180]. */
RotateViewport.degrees = function(rad) {
    var d = rad * 180 / Math.PI;
    d = ((d + 180) % 360 + 360) % 360 - 180;
    return d === -180 ? 180 : d;
};

/** The viewport the tool turns: set by whoever starts it. */
RotateViewport.start = function(di, vpId, screenPos) {
    var doc = di.getDocument();
    var vp = doc.queryEntity(vpId);
    if (isNull(vp) || Layouts.isLocked(vp)) {
        EAction.handleUserWarning(qsTr("This viewport is locked: unlock it to turn its contents."));
        return false;
    }
    var a = new RotateViewport(undefined);
    a.vpId = vpId;
    a.rot0 = vp.getRotation();
    a.rotation = a.rot0;
    a.centre = vp.getCenter();
    RotateViewport.current = a;   // the running tool (the document interface hands back an adapter)
    di.setCurrentAction(a);
    return true;
};

RotateViewport.prototype.getToolTitle = function() {
    return qsTr("Rotate Viewport");
};

RotateViewport.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    this.setCrosshairCursor();
};

/** The mouse's angle about the centre, radians. */
RotateViewport.prototype.mouseAngle = function(modelPos) {
    return Math.atan2(modelPos.y - this.centre.y, modelPos.x - this.centre.x);
};

RotateViewport.prototype.screenDistance = function(event) {
    var view = this.getDocumentInterface().getLastKnownViewWithFocus();
    var c = view.mapToView(this.centre);
    var s = event.getScreenPosition();
    return Math.sqrt((s.x - c.x) * (s.x - c.x) + (s.y - c.y) * (s.y - c.y));
};

RotateViewport.prototype.mouseMoveEvent = function(event) {
    this.lastScreen = event.getScreenPosition();
    if (this.typed === "") {
        var m = event.getModelPosition();
        if (isNull(this.angle0Set)) {
            this.angle0 = this.mouseAngle(m);
            this.angle0Set = true;
        }
        var raw = this.rot0 + (this.mouseAngle(m) - this.angle0);
        var step = RotateViewport.stepFor(this.screenDistance(event));
        this.step = step;
        var deg = Math.round(RotateViewport.degrees(raw) / step) * step;
        this.rotation = deg * Math.PI / 180;
    }
    this.show();
};

/** Preview of the contents turned, and the angle label next to the mouse. */
RotateViewport.prototype.show = function() {
    var di = this.getDocumentInterface();
    var doc = this.getDocument();
    this.setRotation(this.rotation, false);
    this.updateLabel();
};

/**
 * Sets the viewport's rotation for real. A viewport's contents are not drawn
 * by the preview, so the live turn is a genuine edit -- but one that leaves no
 * undo step (`undoable` false); the commit records the one step.
 */
RotateViewport.prototype.setRotation = function(rad, undoable) {
    var di = this.getDocumentInterface();
    var vp = this.getDocument().queryEntity(this.vpId);
    if (isNull(vp)) {
        return;
    }
    vp.setRotation(rad);
    var op = new RModifyObjectOperation(vp, undoable);
    if (undoable) {
        op.setText(this.getToolTitle());
    }
    di.applyOperation(op);
};

RotateViewport.prototype.updateLabel = function() {
    var view = this.getDocumentInterface().getLastKnownViewWithFocus();
    var widget = isNull(view) ? undefined : view.getWidget();
    if (isNull(widget) || isNull(this.lastScreen)) {
        return;
    }
    if (isNull(this.label)) {
        this.label = new QLabel(widget);
        this.label.objectName = "RotateViewportLabel";
        this.label.setStyleSheet("background:#188cff; color:white; padding:2px 6px; border-radius:3px; font-weight:bold;");
        this.label.setAttribute(Qt.WA_TransparentForMouseEvents, true);
    }
    var deg = RotateViewport.degrees(this.rotation);
    var text = this.typed === "" ?
        (Math.round(deg * 100) / 100) + "°   (step " + (isNull(this.step) ? "" : this.step + "°") + ", or type an angle)" :
        qsTr("Angle: ") + this.typed + "_";
    this.label.text = text;
    this.label.adjustSize();
    this.label.move(this.lastScreen.x + 18, this.lastScreen.y + 18);
    this.label.show();
    this.label.raise();
};

RotateViewport.prototype.mouseReleaseEvent = function(event) {
    if (event.button() === Qt.RightButton) {
        this.escapeEvent();
        return;
    }
    if (event.button() !== Qt.LeftButton) {
        return;
    }
    if (!this.armed) {
        // this is the release of the click that picked the glyph
        this.armed = true;
        return;
    }
    this.commit();
};

RotateViewport.prototype.keyPressEvent = function(event) {
    var key = event.key();
    if (key === Qt.Key_Return || key === Qt.Key_Enter) {
        this.commit();
        event.accept();
        return;
    }
    if (key === Qt.Key_Backspace) {
        this.typed = this.typed.substring(0, this.typed.length - 1);
        this.applyTyped();
        event.accept();
        return;
    }
    var t = String(event.text());
    if (t.length === 1 && "0123456789.-".indexOf(t) >= 0) {
        this.typed += t;
        this.applyTyped();
        event.accept();
        return;
    }
    event.ignore();
};

RotateViewport.prototype.applyTyped = function() {
    var v = parseFloat(this.typed);
    if (isFinite(v)) {
        this.rotation = v * Math.PI / 180;
    }
    this.show();
};

RotateViewport.prototype.commit = function() {
    if (Math.abs(this.rotation - this.rot0) > 1e-12) {
        // history records original -> final as one step
        this.setRotation(this.rot0, false);
        this.setRotation(this.rotation, true);
    }
    else {
        this.setRotation(this.rot0, false);
    }
    this.finish();
};

RotateViewport.prototype.finish = function() {
    var di = this.getDocumentInterface();
    di.clearPreview();
    di.repaintViews();
    this.terminate();
};

RotateViewport.prototype.escapeEvent = function() {
    this.setRotation(this.rot0, false);
    this.finish();
};

RotateViewport.prototype.finishEvent = function() {
    if (!isNull(this.label)) {
        try {
            this.label.hide();
            this.label.deleteLater();
        } catch (e) {
        }
        this.label = undefined;
    }
    EAction.prototype.finishEvent.call(this);
};
