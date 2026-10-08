/**
 * CsSheetView -- the Sheet Setup preview, as a real CAD view you can
 * drag things around in.
 *
 * WHY IT IS NOT A QLabel ANY MORE. The preview began as a QPixmap
 * painted into a QLabel: a picture of the layout, and nothing else. A
 * picture is enough to answer "does it fit" and no use at all for "put
 * the scale bar over there", because this bridge gives a script no way
 * to get a click coordinate out of a QLabel -- REventFilter carries no
 * signal, and a plain widget has no generated shell to dispatch a
 * mousePressEvent to.
 *
 * So the preview is an embedded QCAD view over a throwaway in-memory
 * document holding the layout as rectangles, exactly as CsScanView does
 * for a scan (and as QCAD's own Hatch dialog does for a pattern). That
 * brings three things the label could not: a click maps to a point on
 * the page through mapFromView, the wheel zooms, and the layout can be
 * redrawn mid-drag without repainting a pixmap by hand.
 *
 * WHAT A DRAG MEANS. Each piece carries an offset in INCHES OF PAPER
 * from where the default layout put it -- see CsSheetSetup.MOVABLE and
 * the arranging block in Core/CsSheetSetup.js, which holds every line
 * of arithmetic this file depends on. Dragging the CAVE moves the paper
 * under it rather than the cave: a surveyed coordinate is not a layout
 * decision.
 */
// NO include of AutoZoomView: this subclasses RGraphicsViewQt directly.
// The view fits when the PAGE changes -- new paper, new scale -- and
// never on a resize, so a dock dragged wider keeps the zoom the caver
// set.

function CsSheetView(parent) {
    RGraphicsViewQt.call(this, parent, false);
    this.fitPending = true;
}

CsSheetView.prototype = new RGraphicsViewQt();

/**
 * Call the view's own handler for `name`.
 *
 * The same guarded form CsScanView uses, and for the same reason: those
 * virtuals are NOT on RGraphicsViewQt.prototype, and chaining through
 * the prototype throws on the override's first line and silently kills
 * the whole handler. qcadjsapi exposes the base under a "Super" name on
 * the INSTANCE instead.
 */
CsSheetView.callBase = function(self, name, event) {
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
 *  spells it. QPoint's x and y are FUNCTIONS here, not properties. */
CsSheetView.eventPos = function(event) {
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

/**
 * The same position in DEVICE pixels, which is what mapFromView wants.
 *
 * Qt reports a click in LOGICAL pixels and RGraphicsView works in
 * device ones; on a Retina Mac the difference is a factor of two and
 * every pick lands halfway to the top-left corner. Invisible headlessly
 * -- an off-screen view reports a ratio of 1.
 */
CsSheetView.viewPos = function(imageView, event) {
    var at = CsSheetView.eventPos(event);
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

/** The buttons still held, as a mask, or null when this bridge cannot
 *  say. QMouseEvent::buttons is a FUNCTION here, like x and y. */
CsSheetView.buttonsOf = function(event) {
    try {
        var b = (typeof event.buttons === "function") ?
            event.buttons() : event.buttons;
        if (b === null || b === undefined) {
            return null;
        }
        return (typeof b.valueOf === "function") ? b.valueOf() : b;
    } catch (e) {
        return null;
    }
};

/** The point on the PAGE under a mouse event, or null. */
CsSheetView.prototype.modelPos = function(event) {
    try {
        var iv = this.getImageView();
        var vp = CsSheetView.viewPos(iv, event);
        if (vp === null) {
            return null;
        }
        var m = iv.mapFromView(new RVector(vp.x, vp.y));
        return { x: m.x, y: m.y };
    } catch (e) {
        return null;
    }
};

/** Fit once per PAGE, then leave the caver's zoom alone. */
CsSheetView.prototype.resizeEvent = function(event) {
    CsSheetView.callBase(this, "resizeEvent", event);
    if (this.fitPending === true) {
        try {
            this.getImageView().autoZoom();
            this.fitPending = false;
        } catch (e) {
        }
    }
};

/**
 * Left button on a piece starts a drag; anything else is the view's
 * own business.
 *
 * Deliberately WITHOUT chaining when a piece is grabbed: the navigation
 * action would start its own pan on the same drag and the page would
 * slide out from under the box being moved.
 */
CsSheetView.prototype.mousePressEvent = function(event) {
    var button = 0;
    try {
        button = (typeof event.button === "function") ?
            event.button() : event.button;
    } catch (eBtn) {
    }

    if (button === Qt.MidButton) {
        this.panFrom = CsSheetView.eventPos(event);
        return;
    }
    if (button !== Qt.LeftButton) {
        CsSheetView.callBase(this, "mousePressEvent", event);
        return;
    }
    var at = this.modelPos(event);
    var item = null;
    try {
        item = CsSheetSetup.pickAt(this.preview, at === null ? 0 : at.x,
            at === null ? 0 : at.y, this.grabPad);
    } catch (ePick) {
        item = null;
    }
    if (at === null || item === null) {
        CsSheetView.callBase(this, "mousePressEvent", event);
        return;
    }
    this.dragKind = item.kind;
    this.dragBox = item.box;
    this.dragFrom = at;
    this.dragMoved = false;
    try {
        this.dragLines = CsSheetSetup.snapLines(this.preview, item.kind);
    } catch (eLines) {
        this.dragLines = null;
    }
};

/** A drag in progress, snapped, reported in INCHES of paper. */
CsSheetView.prototype.mouseMoveEvent = function(event) {
    if (!isNull(this.panFrom) && this.panFrom !== undefined) {
        // THE BUTTON IS RE-CHECKED EVERY MOVE, not trusted to a release
        // that may never come -- see CsSheetSetup.panHeld for why one
        // goes missing here. Without this the preview keeps following
        // the mouse with nothing held down.
        if (!CsSheetSetup.panHeld(CsSheetView.buttonsOf(event),
                Qt.MidButton)) {
            this.panFrom = null;
            CsSheetView.callBase(this, "mouseMoveEvent", event);
            return;
        }
        try {
            var now = CsSheetView.eventPos(event);
            if (now !== null) {
                this.getImageView().pan(
                    new RVector(now.x - this.panFrom.x,
                                now.y - this.panFrom.y), true);
                this.panFrom = now;
            }
        } catch (ePan) {
            this.panFrom = null;
        }
        return;
    }
    if (isNull(this.dragKind) || this.dragKind === undefined) {
        CsSheetView.callBase(this, "mouseMoveEvent", event);
        return;
    }
    // A PIECE DRAG IS HELD THE SAME WAY, and for the same reason: the
    // left press is not chained either when a piece is grabbed, so a
    // lost release would leave the box stuck to the cursor.
    if (!CsSheetSetup.panHeld(CsSheetView.buttonsOf(event), Qt.LeftButton)) {
        this.endDrag();
        return;
    }
    var at = this.modelPos(event);
    if (at === null) {
        return;
    }
    var snapped = null;
    try {
        snapped = CsSheetSetup.snapMove(this.dragBox,
            at.x - this.dragFrom.x, at.y - this.dragFrom.y,
            this.dragLines, this.snapTol);
    } catch (eSnap) {
        return;
    }
    this.dragMoved = true;
    if (typeof this.onDrag === "function") {
        try {
            this.onDrag(this.dragKind, snapped);
        } catch (eHandler) {
            // a handler that throws must not take the view down with it
        }
    }
};

/**
 * Forget the drag in progress and tell the panel it ended.
 *
 * \return the kind that was being dragged, or null when nothing was.
 *         Shared by the release and by the move that finds the button
 *         already up, so both end a drag exactly the same way.
 */
CsSheetView.prototype.endDrag = function() {
    var kind = this.dragKind;
    var moved = this.dragMoved === true;
    this.panFrom = null;
    this.dragKind = null;
    this.dragBox = null;
    this.dragFrom = null;
    this.dragLines = null;
    this.dragMoved = false;
    if (isNull(kind) || kind === undefined) {
        return null;
    }
    if (typeof this.onDragDone === "function") {
        try {
            this.onDragDone(kind, moved);
        } catch (eHandler) {
            // a handler that throws must not leave the view mid-drag
        }
    }
    return kind;
};

/** The drag ends. The panel keeps whatever the last move reported. */
CsSheetView.prototype.mouseReleaseEvent = function(event) {
    if (this.endDrag() === null) {
        CsSheetView.callBase(this, "mouseReleaseEvent", event);
    }
};

// ---------------------------------------------------------------------
// THE PREVIEW ITSELF: a scratch document, and the layout drawn into it.
// ---------------------------------------------------------------------

var CsSheetPreview = {};

/** How each kind of box is drawn. Colours carried over from the pixmap
 *  preview this replaced, so a caver who knew the old picture reads the
 *  new one without being told. */
CsSheetPreview.STYLE = {
    "sheet": { color: [70, 70, 70], width: 0.5 },
    "elevation-sheet": { color: [70, 70, 70], width: 0.5 },
    "tile": { color: [90, 90, 90], width: 0.3 },
    "tile-margin": { color: [170, 170, 170], width: 0, dashed: true },
    "matchline": { color: [200, 40, 160], width: 0 },
    "margin": { color: [150, 150, 150], width: 0, dashed: true },
    "cave": { color: [40, 90, 190], width: 0 },
    "band": { color: [40, 90, 190], width: 0 },
    "title": { color: [175, 120, 30], width: 0 },
    "bar": { color: [45, 130, 60], width: 0 },
    "north": { color: [45, 130, 60], width: 0 }
};

/** The style for any item kind, including a per-chunk "band:<key>"
 *  kind -- one box per chunk, sharing plain "band"'s look. See
 *  CsSheetSetup.preview and CsSheetSetup.isMovable. */
CsSheetPreview.styleFor = function(kind) {
    if (!isNull(CsSheetPreview.STYLE[kind])) {
        return CsSheetPreview.STYLE[kind];
    }
    if (typeof kind === "string" && kind.indexOf("band:") === 0) {
        return CsSheetPreview.STYLE.band;
    }
    return null;
};

/** The guide line a snap landed on. Magenta, the way every CAD says
 *  "this is why it stopped here". */
CsSheetPreview.GUIDE = [220, 40, 200];

/** A guide the piece was CENTRED on, rather than lined up with. Its own
 *  colour because centring is the snap a cartographer is usually
 *  reaching for and the one hardest to be sure of by eye. */
CsSheetPreview.GUIDE_CENTRE = [40, 170, 220];

/**
 * Build the view and the scratch document behind it.
 *
 * \return {view, di, doc, imageView} or null when this build cannot
 *         embed a view -- the caller then keeps a plain label rather
 *         than losing the panel.
 */
CsSheetPreview.build = function(parent) {
    try {
        var doc = new RDocument(new RMemoryStorage(),
            new RSpatialIndexSimple());
        var di = new RDocumentInterface(doc);
        // Nothing outside this dock should hear about the scratch
        // document's transactions: a staleness listener watching for a
        // CHANGED drawing would rebuild on every repaint.
        di.setNotifyListeners(false);

        var view = new CsSheetView(parent);
        var imageView = view.getImageView();
        imageView.setPaintOrigin(false);
        imageView.setScene(new RGraphicsSceneQt(di));
        imageView.setMargin(8);

        // THE WHEEL NEEDS A NAVIGATION ACTION: qcadjsapi's wrapper has
        // no wheelEvent at all, so an override of it is dead code that
        // looks alive. QCAD's own embedded view does exactly this.
        try {
            include("scripts/Navigation/DefaultNavigation/DefaultNavigation.js");
            if (typeof DefaultNavigation !== "undefined") {
                imageView.setNavigationAction(new DefaultNavigation(view));
            }
        } catch (eNav) {
            // no navigation action here: dragging and the middle-drag
            // pan are unaffected
        }
        return { view: view, di: di, doc: doc, imageView: imageView,
                 pageKey: "" };
    } catch (e) {
        return null;
    }
};

/** One rectangle, as a closed polyline. */
CsSheetPreview.rect = function(preview, box, style) {
    var pl = new RPolyline();
    pl.appendVertex(new RVector(box.minX, box.minY));
    pl.appendVertex(new RVector(box.maxX, box.minY));
    pl.appendVertex(new RVector(box.maxX, box.maxY));
    pl.appendVertex(new RVector(box.minX, box.maxY));
    pl.setClosed(true);
    var e = new RPolylineEntity(preview.doc, new RPolylineData(pl));
    e.setColor(new RColor(style.color[0], style.color[1], style.color[2]));
    try {
        e.setLineweight(style.width > 0 ? RLineweight.Weight050 :
            RLineweight.Weight000);
    } catch (eW) {
    }
    return e;
};

/** One line segment, coloured. */
CsSheetPreview.line = function(preview, x1, y1, x2, y2, color) {
    var e = new RLineEntity(preview.doc,
        new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setColor(new RColor(color[0], color[1], color[2]));
    return e;
};

/**
 * Draw one layout into the view.
 *
 * \param data    from CsSheetSetup.preview
 * \param opts    { scale, guideX, guideY, centredX, centredY, pageKey }
 *
 * FITS ONLY WHEN THE PAGE CHANGES. `pageKey` says what page this is --
 * paper, scale, orientation, second sheet -- and the view re-fits only
 * when that string differs. A re-fit on every repaint would make a drag
 * chase its own tail: the piece moves, the bounds grow, the view zooms,
 * and the cursor is no longer over what it grabbed.
 */
/**
 * Empty the scratch document of ENTITIES ONLY, ready for a redraw.
 *
 * NOT di.clear(), which is what this used to be and what made a drag
 * beachball. RDocumentInterface::clear throws the whole document away
 * and calls RDocument::init to build another: layer 0, three linetypes,
 * model and paper space with their layouts, and something like fifty
 * RSettings lookups for units, dimension and printing defaults. That is
 * fine once per page and ruinous at one per mouse move -- which is what
 * a drag costs, since every frame redraws the layout. Deleting the
 * handful of lines this preview draws leaves the tables alone.
 */
CsSheetPreview.wipe = function(preview) {
    try {
        var ids = preview.doc.queryAllEntities(false, true);
        if (isNull(ids) || ids.length === 0) {
            return;
        }
        var del = new RDeleteObjectsOperation();
        for (var i = 0; i < ids.length; i++) {
            var e = preview.doc.queryEntityDirect(ids[i]);
            if (!isNull(e)) {
                del.deleteObject(e);
            }
        }
        preview.di.applyOperation(del);
    } catch (e) {
        // a document that refuses the delete still gets the old way
        try {
            preview.di.clear();
        } catch (eClear) {
        }
    }
};

CsSheetPreview.show = function(preview, data, opts) {
    if (isNull(preview) || isNull(data)) {
        return false;
    }
    var options = isNull(opts) ? {} : opts;
    try {
        CsSheetPreview.wipe(preview);
        preview.view.preview = data;
        var scale = (isNull(options.scale) || !(options.scale > 0)) ?
            1 : options.scale;
        // In DRAWING units: how near an edge snaps, and how far outside
        // a thin piece still counts as grabbed. Both stated in inches
        // of paper so they mean the same thing at every scale.
        preview.view.snapTol = CsSheetSetup.SNAP_INCHES * scale;
        preview.view.grabPad = 0.05 * scale;

        var op = new RAddObjectsOperation();
        var i;
        for (i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var style = CsSheetPreview.styleFor(item.kind);
            if (isNull(style)) {
                continue;
            }
            if (style.dashed === true) {
                // The margin, cut into dashes by hand: the scratch
                // document carries no linetype table worth the name.
                var dashes = CsSheetSetup.dashRect(item.box, 0.25 * scale);
                for (var d = 0; d < dashes.length; d++) {
                    op.addObject(CsSheetPreview.line(preview,
                        dashes[d].x1, dashes[d].y1, dashes[d].x2,
                        dashes[d].y2, style.color), false);
                }
                continue;
            }
            op.addObject(CsSheetPreview.rect(preview, item.box, style),
                false);
            // A CHUNK BOX NEEDS ITS OWN LABEL -- furniture is told
            // apart by colour alone, which does not work for however
            // many same-coloured chunks a cave has. Only
            // CsSheetSetup.preview ever sets item.label (one per
            // chunk, today).
            if (!isNull(item.label) && item.label !== "") {
                var lblPos = isNull(item.labelAt) ?
                    new RVector(item.box.minX, item.box.maxY) :
                    new RVector(item.labelAt.x, item.labelAt.y);
                var lblData = new RTextData(lblPos, lblPos,
                    (item.box.maxY - item.box.minY) * 0.12,
                    item.box.maxX - item.box.minX, RS.VAlignTop,
                    RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1.0,
                    String(item.label), "standard", false, false, 0.0,
                    false);
                var lbl = new RTextEntity(preview.doc, lblData);
                lbl.setColor(new RColor(style.color[0], style.color[1],
                    style.color[2]));
                op.addObject(lbl, false);
            }
        }

        // THE GUIDES LAST, so they read on top of what they explain.
        if (!isNull(data.bounds)) {
            var pad = (data.bounds.maxY - data.bounds.minY) * 0.02;
            if (!isNull(options.guideX) && options.guideX !== undefined) {
                op.addObject(CsSheetPreview.line(preview, options.guideX,
                    data.bounds.minY - pad, options.guideX,
                    data.bounds.maxY + pad,
                    options.centredX === true ?
                        CsSheetPreview.GUIDE_CENTRE :
                        CsSheetPreview.GUIDE), false);
            }
            if (!isNull(options.guideY) && options.guideY !== undefined) {
                op.addObject(CsSheetPreview.line(preview,
                    data.bounds.minX - pad, options.guideY,
                    data.bounds.maxX + pad, options.guideY,
                    options.centredY === true ?
                        CsSheetPreview.GUIDE_CENTRE :
                        CsSheetPreview.GUIDE), false);
            }
        }
        preview.di.applyOperation(op);
        // THE UNDO STACK IS DROPPED EVERY FRAME. Nothing undoes a
        // scratch preview, and a drag applies an operation per mouse
        // move: without this the stack keeps every frame's entities
        // alive and the drag gets slower the longer it lasts.
        try {
            preview.doc.resetTransactionStack();
        } catch (eStack) {
        }

        var key = isNull(options.pageKey) ? "" : String(options.pageKey);
        if (key !== preview.pageKey) {
            preview.pageKey = key;
            CsSheetPreview.fit(preview);
            // AND LEFT PENDING, deliberately. The panel draws its first
            // page while the dock is still being laid out, so this
            // autoZoom fits to a size the view is about to stop having
            // -- which put the whole sheet in a corner of the pane,
            // measured live 2026-09-14. resizeEvent fits once more and
            // clears the flag, so a dock dragged wider afterwards still
            // keeps the caver's own zoom.
            preview.view.fitPending = true;
        }
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Fit the whole page back into the pane.
 *
 * THE VIEW'S OWN autoZoom, NOT the document interface's. Measured live
 * 2026-09-14: `di.autoZoom()` on this scratch interface left the page
 * at a zoom factor of 1/24 -- the whole sheet a postage stamp in the
 * corner of an empty pane -- while `imageView.autoZoom()` fits it. The
 * scan preview gets away with the di form because it zooms an image
 * placed one unit per pixel; this document is measured in feet.
 */
CsSheetPreview.fit = function(preview) {
    try {
        preview.imageView.autoZoom();
        return;
    } catch (e) {
    }
    try {
        preview.di.autoZoom();
    } catch (eDi) {
    }
};
