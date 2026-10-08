/**
 * CsScanView -- the Sketch Scans preview, as a real CAD view.
 *
 * The preview used to be a QLabel holding a scaled QPixmap: fit to the
 * pane, no zoom, no pan. On a 4000-pixel scan squeezed into a 420-pixel
 * label that is a ten-to-one reduction, which is enough to tell one
 * sketch from another and not enough to read a station number.
 *
 * A QLabel is also a dead end for PICKING: this bridge gives a script no
 * way to get a click coordinate out of one. REventFilter -- the only
 * filter class QCAD exposes -- carries no signal and only blocks or
 * forwards by event type, and every mousePressEvent override in QCAD's
 * own scripts is on an ACTION, never a widget.
 *
 * So the preview is an embedded QCAD view over a throwaway in-memory
 * document holding just the scan. That is QCAD's own pattern for this:
 * the Hatch dialog previews patterns exactly this way
 * (scripts/Draw/Hatch/HatchDialog.js, via AutoZoomView). It brings
 * native zoom and pan, and mapFromView turns a click into a point on
 * the scan -- which is what a station picker would need.
 *
 * NOT AutoZoomView itself, deliberately: that one re-fits on every
 * resize, so a dock the caver drags wider would throw away the zoom
 * they had just set. This one fits ONCE, when a new scan is loaded.
 */
// NO include of AutoZoomView: this subclasses RGraphicsViewQt directly,
// for the reason in the docblock above -- AutoZoomView re-fits on every
// resize and would throw away the caver's zoom.

function CsScanView(parent) {
    RGraphicsViewQt.call(this, parent, false);
    this.fitPending = true;
}

CsScanView.prototype = new RGraphicsViewQt();

/**
 * Dropping image files onto the preview: what a caver reaches for
 * first, and what this panel could not do until 2026-09-07.
 *
 * PROVEN BY THE BINDING, like every other override in this file:
 * REcmaShellGraphicsViewQt looks up script properties named
 * "dragEnterEvent" and "dropEvent" and calls those in place of the
 * view's own. A plain QWidget cannot do this -- the bridge dispatches
 * no events to one -- which is why the drop target is the preview pane
 * and not the panel as a whole.
 *
 * The view has to be told it takes drops at all; Qt ignores drag events
 * on a widget whose acceptDrops is false, and the shell never hears
 * them. CsScanPreview.build does that.
 *
 * `CsScanView.onFilesDropped` is set by the panel, because THIS file
 * knows about views and nothing about cave folders.
 */
CsScanView.onFilesDropped = null;

/** Image files a drag is carrying, as local paths. Empty for a drag of
 *  anything else -- text, a DXF, a folder -- which is then refused, so
 *  the cursor says no before the caver lets go. */
CsScanView.imagePathsIn = function(event) {
    var out = [];
    try {
        var data = event.mimeData();
        if (isNull(data) || !data.hasUrls()) {
            return out;
        }
        var urls = data.urls();
        for (var i = 0; i < urls.length; i++) {
            var local = "";
            try {
                local = String(urls[i].toLocalFile());
            } catch (eUrl) {
                continue;
            }
            if (local === "") {
                continue;
            }
            var lower = local.toLowerCase();
            if (lower.indexOf(".png") === lower.length - 4 ||
                    lower.indexOf(".jpg") === lower.length - 4 ||
                    lower.indexOf(".bmp") === lower.length - 4 ||
                    lower.indexOf(".jpeg") === lower.length - 5 ||
                    lower.indexOf(".tif") === lower.length - 4 ||
                    lower.indexOf(".tiff") === lower.length - 5) {
                out.push(local);
            }
        }
    } catch (e) {
    }
    return out;
};

CsScanView.prototype.dragEnterEvent = function(event) {
    try {
        if (CsScanView.imagePathsIn(event).length > 0) {
            event.acceptProposedAction();
            return;
        }
    } catch (e) {
    }
    CsScanView.callBase(this, "dragEnterEvent", event);
};

CsScanView.prototype.dragMoveEvent = function(event) {
    try {
        if (CsScanView.imagePathsIn(event).length > 0) {
            event.acceptProposedAction();
            return;
        }
    } catch (e) {
    }
    CsScanView.callBase(this, "dragMoveEvent", event);
};

CsScanView.prototype.dropEvent = function(event) {
    var paths = [];
    try {
        paths = CsScanView.imagePathsIn(event);
    } catch (e) {
        paths = [];
    }
    if (paths.length === 0) {
        CsScanView.callBase(this, "dropEvent", event);
        return;
    }
    try {
        event.acceptProposedAction();
    } catch (eAccept) {
    }
    try {
        if (typeof CsScanView.onFilesDropped === "function") {
            CsScanView.onFilesDropped(paths);
        }
    } catch (eHandler) {
        // a handler that throws must not take the view down with it
    }
};

/** Fit once per loaded scan, then leave the caver's zoom alone. */
CsScanView.prototype.resizeEvent = function(event) {
    CsScanView.callBase(this, "resizeEvent", event);
    if (this.fitPending === true) {
        try {
            this.getImageView().autoZoom();
            this.fitPending = false;
        } catch (e) {
            // an unzoomable view still shows the scan at its own scale
        }
    }
};

/**
 * A click in the view, reported as a point ON THE SCAN.
 *
 * PROVEN BY THE BINDING, not by hope: the generated shell class
 * (src/scripting/ecmaapi/generated/REcmaShellGraphicsViewQt.cpp) looks
 * up a script property named "mousePressEvent" and, when it is a
 * function, calls THAT in place of RGraphicsViewQt's own. An object
 * built from script -- new CsScanView(...) -- is a shell instance, so
 * this override is what Qt dispatches to.
 *
 * The base is still called first: panning, gestures and the view's own
 * navigation must keep working. This only listens.
 *
 * The scan is placed at ONE DRAWING UNIT PER PIXEL (CsScanPreview.show),
 * so the mapped model point IS the pixel under the cursor -- no scale
 * to carry and nothing to convert at the far end.
 */
CsScanView.prototype.mousePressEvent = function(event) {
    var at = CsScanView.eventPos(event);
    var button = 0;
    try {
        button = (typeof event.button === "function") ?
            event.button() : event.button;
    } catch (eBtn) {
    }

    // Middle starts a pan. Qt.MidButton and Qt.MiddleButton are both 4
    // here, so either spelling is the same test.
    if (button === Qt.MidButton) {
        this.panFrom = at;
        // Deliberately WITHOUT chaining: the navigation action installed
        // for the wheel would otherwise start its own pan on the same
        // drag and the scan would move twice as far as the mouse.
        return;
    }
    // every other button goes on to the view's own handling
    CsScanView.callBase(this, "mousePressEvent", event);
    if (button !== Qt.LeftButton || at === null) {
        return;
    }
    var picked = null;
    try {
        var iv = this.getImageView();
        var vp = CsScanView.viewPos(iv, event);
        if (vp === null) {
            return;
        }
        var model = iv.mapFromView(new RVector(vp.x, vp.y));
        picked = { x: model.x, y: model.y };
    } catch (e) {
        // a listener must never throw into the view's own event handling
        return;
    }
    // BOXING TAKES THE LEFT BUTTON. A caver drawing a trim box must not
    // also be assigning a station with the same drag, and the two are
    // never both wanted at once -- the box is chosen before any
    // placement control is even enabled.
    // TRACING TAKES THE LEFT BUTTON, same bargain as boxing: a caver
    // drawing round their sketch is not assigning a station with the
    // same click.
    if (this.tracing === true) {
        if (this.tracePoints === undefined || this.tracePoints === null) {
            this.tracePoints = [];
        }
        // Back on the first corner closes the shape. Measured in MODEL
        // units, which are page pixels here, so the tolerance means the
        // same thing however far the preview is zoomed.
        if (this.tracePoints.length >= CsScanView.MIN_TRACE_POINTS) {
            var f = this.tracePoints[0];
            var dxC = picked.x - f.x, dyC = picked.y - f.y;
            if (Math.sqrt(dxC * dxC + dyC * dyC) <= this.traceClosePx) {
                this.traceDragging = false;
                if (typeof this.onScanTraceDone === "function") {
                    try {
                        this.onScanTraceDone(this.tracePoints.slice(0));
                    } catch (eDone) {
                    }
                }
                return;
            }
        }
        this.tracePoints.push(picked);
        // Held down and moved, this becomes a freehand stroke; a single
        // click leaves one corner. Both end up in the same list, and
        // what tells them apart on release is whether the stroke laid
        // any points of its own after this one.
        this.traceDragging = true;
        this.traceStrokeAt = this.tracePoints.length;
        if (typeof this.onTraceChanged === "function") {
            try {
                this.onTraceChanged(this.tracePoints, picked);
            } catch (eCh) {
            }
        }
        return;
    }
    if (this.boxing === true) {
        this.boxFrom = picked;
        this.boxTo = null;
        return;
    }
    if (typeof this.onScanPick === "function") {
        try {
            this.onScanPick(picked);
        } catch (ePick) {
        }
    }
};

/**
 * Call the view's own handler for `name` -- QCAD's behaviour, under the
 * override.
 *
 * NOT RGraphicsViewQt.prototype[name]. Those are protected virtuals and
 * the prototype does not carry them: chaining that way throws a
 * TypeError on the override's first line and silently kills the whole
 * handler, which is what once made this viewer ignore every click,
 * wheel turn and drag while looking correct.
 *
 * The live binding (qcadjsapi) exposes the base under a "Super" name ON
 * THE INSTANCE instead, and says so in its own generated comment:
 * "function is protected, this function can be called from JS
 * implementation to call implementation of super class". Probed on the
 * shipping build:
 *   mousePressEventSuper    function
 *   mouseMoveEventSuper     function
 *   mouseReleaseEventSuper  function
 *   resizeEventSuper        function
 *   wheelEventSuper         UNDEFINED -- the wheel has no base to call,
 *                           which is harmless here because this view
 *                           implements zoom itself.
 * Still guarded: a name without a Super is a no-op, never a throw.
 */
CsScanView.callBase = function(self, name, event) {
    try {
        var base = self[name + "Super"];
        if (typeof base === "function") {
            base.call(self, event);
        }
    } catch (e) {
        // a base that refuses must not take the override with it
    }
};

/** A widget position off a mouse event, whichever way this bridge
 *  spells it. QPoint's x and y are FUNCTIONS here, not properties, and
 *  reading them as properties fails silently (probed 2026-08-29). */
CsScanView.eventPos = function(event) {
    try {
        if (typeof event.x === "function") {
            return { x: event.x(), y: event.y() };
        }
        if (typeof event.pos === "function") {
            var p = event.pos();
            return { x: (typeof p.x === "function") ? p.x() : p.x,
                     y: (typeof p.y === "function") ? p.y() : p.y };
        }
    } catch (e) {
    }
    return null;
};

// NO wheelEvent OVERRIDE. qcadjsapi's generated wrapper has no
// wheelEvent -- QWheelEvent is not a wrapped type -- so the wheel never
// reaches script at all and an override of it is dead code that looks
// alive. Wheel zoom comes from the DefaultNavigation action installed
// in CsScanPreview.build instead.

/**
 * MIDDLE-DRAG PANS, the same gesture QCAD's own views use, which
 * leaves the left button free for picking a station off the scan.
 * pan() takes a delta in VIEW pixels and flips y itself.
 */
CsScanView.prototype.mouseMoveEvent = function(event) {
    // A PAN IN PROGRESS COMES FIRST, and it has to: `tracing` is a MODE
    // that stays on for as long as the caver is drawing an outline, not
    // a gesture that lasts one drag, so a tracing branch ahead of this
    // one swallows every middle-drag for the whole session and the scan
    // cannot be moved while being traced -- which is exactly when it
    // most needs to be, since the outline runs off the edge of the
    // view. (Boxing never hit this: boxFrom is set only while the left
    // button is actually down.)
    var phase = CsScanView.movePhase(this);
    if (phase === "pan") {
        CsScanView.panStep(this, event);
        return;
    }
    // A BOX IN PROGRESS OWNS THE DRAG. No pan, and no base handling
    // either: the navigation action would start its own pan on the same
    // drag and the scan would slide out from under the box being drawn.
    if (phase === "trace") {
        try {
            var ivT = this.getImageView();
            var vpT = CsScanView.viewPos(ivT, event);
            if (vpT !== null) {
                var mT = ivT.mapFromView(new RVector(vpT.x, vpT.y));
                var here = { x: mT.x, y: mT.y };
                if (this.traceDragging === true &&
                        this.tracePoints !== undefined &&
                        this.tracePoints !== null &&
                        this.tracePoints.length > 0) {
                    // Freehand: a point every so often rather than one
                    // per reported pixel. The outline is decimated
                    // afterwards anyway, and a point per pixel makes
                    // the rubber band cost a regeneration each time.
                    var lastT = this.tracePoints[this.tracePoints.length - 1];
                    var dxT = here.x - lastT.x, dyT = here.y - lastT.y;
                    if (Math.sqrt(dxT * dxT + dyT * dyT) >=
                            this.traceStepPx) {
                        this.tracePoints.push(here);
                    }
                }
                if (typeof this.onTraceChanged === "function") {
                    this.onTraceChanged(this.tracePoints, here);
                }
            }
        } catch (eTr) {
        }
        return;
    }
    if (phase === "box") {
        try {
            var ivB = this.getImageView();
            var vpB = CsScanView.viewPos(ivB, event);
            if (vpB !== null) {
                var mB = ivB.mapFromView(new RVector(vpB.x, vpB.y));
                this.boxTo = { x: mB.x, y: mB.y };
                if (typeof this.onBandChanged === "function") {
                    this.onBandChanged(this.boxFrom, this.boxTo);
                }
            }
        } catch (eBox) {
        }
        return;
    }
    CsScanView.callBase(this, "mouseMoveEvent", event);
};

/**
 * One step of a middle-drag pan.
 *
 * A THRESHOLD, the way QCAD's own DefaultNavigation has one. Every pan
 * step regenerates the view, and regenerating a 4000-pixel scan is not
 * cheap -- so a drag that reports a pixel at a time should not buy a
 * full regeneration for each of them. Sub-threshold movement is
 * ACCUMULATED rather than dropped, so the pan still tracks the mouse
 * exactly; it just arrives in slightly coarser steps.
 */
/**
 * What a mouse move means right now: "pan", "trace", "box" or "base".
 *
 * THE ORDER IS THE POINT, and it is why this is a function rather than
 * a chain of ifs inside the handler. `tracing` is a MODE that stays on
 * for as long as the caver is drawing an outline, while `panFrom` and
 * `boxFrom` last one drag each -- so a tracing test placed ahead of the
 * pan swallows every middle-drag for the whole session, and the scan
 * cannot be moved while being traced. Which is exactly when it most
 * needs to be: an outline runs off the edge of the view.
 *
 * Reads fields and nothing else, so the order can be tested without a
 * live view and a real mouse event.
 */
CsScanView.movePhase = function(view) {
    if (view === null || view === undefined) {
        return "base";
    }
    if (view.panFrom !== undefined && view.panFrom !== null) {
        return "pan";
    }
    if (view.tracing === true) {
        return "trace";
    }
    if (view.boxFrom !== undefined && view.boxFrom !== null) {
        return "box";
    }
    return "base";
};

CsScanView.panStep = function(view, event) {
    try {
        var at = CsScanView.eventPos(event);
        if (at === null) {
            return;
        }
        var dx = at.x - view.panFrom.x, dy = at.y - view.panFrom.y;
        if (Math.abs(dx) < CsScanView.PAN_THRESHOLD &&
                Math.abs(dy) < CsScanView.PAN_THRESHOLD) {
            return;
        }
        view.getImageView().pan(new RVector(dx, dy), true);
        view.panFrom = at;
    } catch (e) {
        view.panFrom = null;
    }
};

CsScanView.prototype.mouseReleaseEvent = function(event) {
    CsScanView.callBase(this, "mouseReleaseEvent", event);
    this.panFrom = null;
    if (this.tracing === true) {
        var wasDragging = (this.traceDragging === true);
        this.traceDragging = false;
        var pts = this.tracePoints;
        if (!wasDragging || pts === undefined || pts === null) {
            return;
        }
        if (!CsScanView.strokeCloses(this)) {
            return;
        }
        if (typeof this.onScanTraceDone === "function") {
            try {
                this.onScanTraceDone(pts.slice(0));
            } catch (eRel) {
            }
        }
        return;
    }
    var from = this.boxFrom, to = this.boxTo;
    this.boxFrom = null;
    this.boxTo = null;
    if (from === null || from === undefined || to === null ||
            to === undefined) {
        return;                 // a bare click is not a box
    }
    if (typeof this.onScanBox === "function") {
        try {
            this.onScanBox({ a: from, b: to });
        } catch (e) {
        }
    }
};

/** Pixels of movement before a pan step is worth a regeneration.
 *  QCAD's own navigation uses 4 (GraphicsViewNavigation/PanThreshold);
 *  the same number here, read from the same setting so one place tunes
 *  both. */
/** Corners before an outline can be closed by clicking its start. */
CsScanView.MIN_TRACE_POINTS = 3;

/**
 * Does letting go here close the outline?
 *
 * LETTING GO OF A STROKE CLOSES THE SHAPE. Drawing round a sketch is
 * one continuous movement, and having to find the first point again
 * afterwards -- at whatever zoom, with the cursor already at the far
 * end of the outline -- is a second job the caver did not ask for.
 *
 * A CLICK IS NOT A STROKE and must still just lay a corner. What
 * separates them is whether MOVING added any points after the one the
 * press put down: `traceStrokeAt` is the length of the list at press
 * time, so the stroke laid something only if the list is longer now.
 *
 * Reads fields and nothing else, so the rule can be tested without a
 * live view and a real mouse event -- which is the only reason the
 * decision is out here rather than inline in the handler.
 */
CsScanView.strokeCloses = function(view) {
    if (view === null || view === undefined) {
        return false;
    }
    var pts = view.tracePoints;
    if (pts === null || pts === undefined || pts.length === undefined) {
        return false;
    }
    var at = view.traceStrokeAt;
    if (at === null || at === undefined) {
        return false;
    }
    if (pts.length <= at) {
        return false;           // pressed and released without tracing
    }
    return pts.length >= CsScanView.MIN_TRACE_POINTS;
};

CsScanView.PAN_THRESHOLD = 4;
try {
    CsScanView.PAN_THRESHOLD = RSettings.getDoubleValue(
        "GraphicsViewNavigation/PanThreshold", 4);
} catch (e) {
}

/**
 * A mouse event's position in the coordinates mapFromView expects.
 *
 * QT REPORTS A CLICK IN LOGICAL PIXELS; THE VIEW WORKS IN DEVICE ONES.
 * On a Retina screen those differ by a factor of two, and QCAD's own
 * code says so plainly -- RGraphicsViewQt builds its mouse events as
 *   RMouseEvent e(*event, *s, *imageView, imageView->getDevicePixelRatio())
 * and RInputEvent stores  screenPosition = position * devicePixelRatio.
 *
 * Passing the raw logical position to mapFromView therefore lands every
 * pick at HALF its true place in the view -- pulled toward the top-left
 * corner, and with the fitted scale inflated to match. That is exactly
 * the offset-and-oversized placement this viewer was producing, and it
 * is invisible headlessly because an off-screen view reports a ratio
 * of 1.
 */
CsScanView.viewPos = function(imageView, event) {
    var at = CsScanView.eventPos(event);
    if (at === null) {
        return null;
    }
    var dpr = 1;
    try {
        var r = imageView.getDevicePixelRatio();
        if (r > 0) {
            dpr = r;
        }
    } catch (e) {
    }
    return { x: at.x * dpr, y: at.y * dpr };
};

var CsScanPreview = {};

/**
 * Build the view and the document behind it.
 *
 * \return {view, di, doc} or null when this build cannot embed a view --
 *         the caller then keeps the old QLabel preview rather than
 *         losing the panel.
 */
CsScanPreview.build = function(parent) {
    try {
        var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
        var di = new RDocumentInterface(doc);
        // Nothing outside this dock should hear about the scratch
        // document's transactions -- the panel's own staleness listener
        // watches for a CHANGED drawing and would rebuild on every
        // preview.
        di.setNotifyListeners(false);

        var view = new CsScanView(parent);
        try {
            // Qt drops drag events on a widget that has not said it
            // takes them, and the shell then never hears them at all.
            view.setAcceptDrops(true);
        } catch (eDrops) {
        }
        var imageView = view.getImageView();
        imageView.setPaintOrigin(false);
        imageView.setScene(new RGraphicsSceneQt(di));
        imageView.setMargin(10);

        // THE WHEEL NEEDS A NAVIGATION ACTION. A script override cannot
        // do it: qcadjsapi's generated wrapper has no wheelEvent at all
        // (QWheelEvent is not a wrapped type), so the wheel never
        // reaches script -- which is why an override of it did nothing
        // while the mouse overrides worked.
        //
        // QCAD's own embedded view does exactly this: see
        // scripts/Widgets/ViewportWidget/ViewportWidget.js, which hands
        // its image view a DefaultNavigation. That is where wheel zoom
        // lives.
        try {
            include("scripts/Navigation/DefaultNavigation/DefaultNavigation.js");
            if (typeof DefaultNavigation !== "undefined") {
                imageView.setNavigationAction(new DefaultNavigation(view));
            }
        } catch (eNav) {
            // no navigation action here: the Fit and +/- buttons still
            // zoom, and the middle-drag pan below is unaffected
        }
        var preview = { view: view, di: di, doc: doc,
                        imageView: imageView, band: null };
        view.onBandChanged = function(a, b) {
            CsScanPreview.showBand(preview, a, b);
        };
        return preview;
    } catch (e) {
        return null;
    }
};

/** Put one scan in the view, fitted. \return true when it loaded. */
CsScanPreview.show = function(preview, path) {
    if (preview === null || preview === undefined) {
        return false;
    }
    try {
        preview.di.clear();
        preview.band = null;    // di.clear() already took it with the scan
        var image = new QImage(path);
        if (image.isNull()) {
            return false;
        }
        var pxW = image.width(), pxH = image.height();
        if (pxW < 1 || pxH < 1) {
            return false;
        }
        // One drawing unit per pixel: the preview document exists only
        // to be looked at, so the simplest mapping is the right one --
        // and it makes a picked point read directly as a pixel on the
        // scan.
        var data = new RImageData(path, new RVector(0, 0),
            new RVector(1, 0), new RVector(0, 1), pxW, pxH, 0);
        var entity = new RImageEntity(preview.doc, data);
        var op = new RAddObjectOperation(entity, false);
        preview.di.applyOperation(op);
        preview.heightPx = pxH;
        preview.widthPx = pxW;
        preview.view.fitPending = true;
        preview.di.autoZoom();
        preview.view.fitPending = false;
        return true;
    } catch (e) {
        return false;
    }
};

/** The pixel a click landed on, formatted for a readout. The scan's
 *  own top-left is (0, height) in model space because a drawing's Y
 *  runs up and an image's rows run down, so the row is reported from
 *  the top the way an image viewer states it. Pure. */
CsScanPreview.pixelText = function(point, heightPx) {
    if (point === null || point === undefined) {
        return "";
    }
    var col = Math.round(point.x);
    var row = Math.round(heightPx - point.y);
    return col + ", " + row + " px";
};

/** Fit the whole scan back into the pane. */
CsScanPreview.fit = function(preview) {
    try {
        preview.di.autoZoom();
    } catch (e) {
    }
};

/** Zoom about the middle of the pane. `factor` above 1 zooms in. */
CsScanPreview.zoom = function(preview, factor) {
    try {
        var iv = preview.imageView;
        iv.zoom(iv.mapFromView(new RVector(iv.getWidth() / 2,
            iv.getHeight() / 2)), factor);
    } catch (e) {
        // no zoom(): fall back to the view's own step zoom
        try {
            if (factor > 1) { preview.imageView.zoomIn(); }
            else { preview.imageView.zoomOut(); }
        } catch (e2) {
        }
    }
};

/**
 * Put the view in boxing mode, or take it out of it.
 *
 * `onBox` is called with { a: <model point>, b: <model point> } when a
 * left drag finishes. Pass null to disarm.
 */
/**
 * Arm (or disarm) outline tracing on the preview.
 *
 * Clicks lay down corners; holding the button and moving traces
 * freehand, and both land in the same list. Clicking back on the first
 * corner closes the shape and calls `onDone` with it.
 *
 * \param onDone  function(points) when the outline is closed, or null
 *                to disarm
 * \param onChange function(points, cursor) while it is being drawn
 */
CsScanPreview.armTrace = function(preview, onDone, onChange) {
    if (preview === null || preview === undefined) {
        return;
    }
    try {
        var on = (typeof onDone === "function");
        preview.view.onScanTraceDone = on ? onDone : null;
        preview.view.onTraceChanged =
            (typeof onChange === "function") ? onChange : null;
        preview.view.tracing = on;
        preview.view.tracePoints = [];
        preview.view.traceDragging = false;
        preview.view.traceStrokeAt = null;
        // In MODEL units, which are page pixels: how near the first
        // corner counts as closing, and how far a freehand stroke moves
        // before it lays another point.
        preview.view.traceClosePx = CsScanPreview.TRACE_CLOSE_PX;
        preview.view.traceStepPx = CsScanPreview.TRACE_STEP_PX;
        if (on) {
            preview.view.boxing = false;
            preview.view.onScanBox = null;
        }
        CsScanPreview.clearBand(preview);
    } catch (e) {
    }
};

/** Throw away the corners laid down so far, tracing still armed. */
CsScanPreview.resetTrace = function(preview) {
    try {
        preview.view.tracePoints = [];
        preview.view.traceDragging = false;
        preview.view.traceStrokeAt = null;
    } catch (e) {
    }
    CsScanPreview.clearBand(preview);
};

/** Take back the last corner. \return what is left, or null. */
CsScanPreview.undoTracePoint = function(preview) {
    try {
        var pts = preview.view.tracePoints;
        if (pts === undefined || pts === null || pts.length === 0) {
            return null;
        }
        pts.pop();
        return pts;
    } catch (e) {
        return null;
    }
};

/** How near the first corner closes the shape, in page pixels. */
CsScanPreview.TRACE_CLOSE_PX = 12;
/** How far a freehand stroke travels before laying another point. */
CsScanPreview.TRACE_STEP_PX = 6;

/**
 * Draw (or move) the outline being traced: the corners so far, and a
 * live segment out to the cursor.
 *
 * Same scratch-entity approach as showBand, and the same reason.
 */
CsScanPreview.showTrace = function(preview, points, cursor) {
    if (preview === null || preview === undefined) {
        return;
    }
    try {
        CsScanPreview.clearBand(preview);
        if (points === null || points === undefined || points.length === 0) {
            return;
        }
        var pl = new RPolyline();
        for (var i = 0; i < points.length; i++) {
            pl.appendVertex(new RVector(points[i].x, points[i].y));
        }
        if (cursor !== null && cursor !== undefined) {
            pl.appendVertex(new RVector(cursor.x, cursor.y));
        }
        // OPEN while it is being drawn. A closed one would draw the
        // final edge back to the start before the caver has decided
        // where the shape ends, which reads as a shape they did not
        // make.
        pl.setClosed(false);
        if (pl.countVertices() < 2) {
            return;
        }
        var entity = new RPolylineEntity(preview.doc, new RPolylineData(pl));
        entity.setColor(new RColor(255, 0, 0));
        try {
            entity.setDrawOrder(
                preview.doc.getStorage().getMaxDrawOrder() + 1);
        } catch (eOrder) {
        }
        preview.di.applyOperation(new RAddObjectOperation(entity, false));
        preview.band = entity;
    } catch (e) {
    }
};

CsScanPreview.armBox = function(preview, onBox) {
    if (preview === null || preview === undefined) {
        return;
    }
    try {
        preview.view.onScanBox = (typeof onBox === "function") ? onBox : null;
        preview.view.boxing = (typeof onBox === "function");
        CsScanPreview.clearBand(preview);
    } catch (e) {
    }
};

/**
 * Draw (or move) the rubber band between two model points.
 *
 * A REAL ENTITY IN THE SCRATCH DOCUMENT, not a preview overlay: this
 * view is not an EAction, so it has no preview machinery of its own.
 * The document holds one image and at most this rectangle and is thrown
 * away with the panel, so the cost of delete-and-re-add per mouse move
 * is one polyline.
 *
 * The old band is deleted through the ENTITY OBJECT rather than its id
 * -- RDeleteObjectOperation takes an object, the way DrawPolyline's own
 * preview does it.
 */
CsScanPreview.showBand = function(preview, a, b) {
    if (preview === null || preview === undefined) {
        return;
    }
    try {
        CsScanPreview.clearBand(preview);
        var pl = new RPolyline();
        pl.appendVertex(new RVector(a.x, a.y));
        pl.appendVertex(new RVector(b.x, a.y));
        pl.appendVertex(new RVector(b.x, b.y));
        pl.appendVertex(new RVector(a.x, b.y));
        pl.setClosed(true);
        var entity = new RPolylineEntity(preview.doc, new RPolylineData(pl));
        // Red and on top: the band has to read against a grey pencil
        // sketch, which is most of what it will ever be drawn over.
        entity.setColor(new RColor(255, 0, 0));
        try {
            entity.setDrawOrder(
                preview.doc.getStorage().getMaxDrawOrder() + 1);
        } catch (eOrder) {
        }
        preview.di.applyOperation(new RAddObjectOperation(entity, false));
        preview.band = entity;
    } catch (e) {
        // a band that will not draw must not stop the box being picked
    }
};

/** Remove the rubber band, if there is one. */
CsScanPreview.clearBand = function(preview) {
    try {
        if (preview.band !== undefined && preview.band !== null) {
            preview.di.applyOperation(
                new RDeleteObjectOperation(preview.band, false));
        }
    } catch (e) {
    }
    try {
        preview.band = null;
    } catch (e2) {
    }
};
