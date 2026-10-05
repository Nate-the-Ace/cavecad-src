/**
 * CustomGrips -- a small library for grips of any shape, plugged in by name.
 *
 * QCAD's own grips are squares at reference points. A tool that wants a
 * different handle (a diamond that rotates, a triangle that stretches, ...)
 * registers a grip here and the library does the rest: it makes a small
 * flat button over the drawing view, keeps it where the grip belongs as the
 * view pans and zooms, shows it only when the grip applies, and calls back
 * when it is clicked.
 *
 * Why widgets rather than drawn shapes: a feet drawing's sheet is under a
 * unit wide, and shapes that small are silently not painted by the engine's
 * overlay. A widget is in screen pixels and crisp at any zoom.
 *
 *     CustomGrips.register({
 *         id: "viewport-rotate",
 *         shape: "diamond",              // a name from CustomGrips.SHAPES, or function(painter, w, h)
 *         size: [26, 14],                // pixels
 *         fill: "#188cff",               // optional; outline "#ffffff"
 *         tooltip: qsTr("Rotate ..."),
 *         // the thing the grip belongs to, or undefined to hide it
 *         target: function(entry) { return LayoutTabs.glyphViewport(entry); },
 *         // where, in view pixels: {x, y}
 *         anchor: function(view, target) { ... },
 *         onClick: function(entry, target) { ... }
 *     });
 *     CustomGrips.refresh(entry);        // after a selection or view change
 *
 * `entry` is whatever the host passes round: it must have `.view` -- a
 * function returning the drawing's graphics view -- or the host passes the
 * view itself as `refresh(entry, view)`. Widgets are kept on the entry.
 */

var CustomGrips = {};

CustomGrips.grips = {};
CustomGrips.order = [];

/** Shapes drawn into a `w` x `h` box with the painter's pen and brush already set. */
CustomGrips.SHAPES = {
    diamond: function(p, w, h) {
        CustomGrips.polygon(p, [[0, h / 2], [w / 2, 0], [w, h / 2], [w / 2, h]]);
    },
    "diamond-tall": function(p, w, h) {
        CustomGrips.polygon(p, [[0, h / 2], [w / 2, 0], [w, h / 2], [w / 2, h]]);
    },
    square: function(p, w, h) {
        CustomGrips.polygon(p, [[0, 0], [w, 0], [w, h], [0, h]]);
    },
    circle: function(p, w, h) {
        p.drawEllipse(new QRectF(0, 0, w, h));
    },
    "triangle-up": function(p, w, h) {
        CustomGrips.polygon(p, [[0, h], [w / 2, 0], [w, h]]);
    },
    "triangle-down": function(p, w, h) {
        CustomGrips.polygon(p, [[0, 0], [w, 0], [w / 2, h]]);
    },
    "triangle-left": function(p, w, h) {
        CustomGrips.polygon(p, [[w, 0], [w, h], [0, h / 2]]);
    },
    "triangle-right": function(p, w, h) {
        CustomGrips.polygon(p, [[0, 0], [0, h], [w, h / 2]]);
    },
    hexagon: function(p, w, h) {
        CustomGrips.polygon(p, [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
    },
    cross: function(p, w, h) {
        var a = 0.34;
        CustomGrips.polygon(p, [[w * a, 0], [w * (1 - a), 0], [w * (1 - a), h * a], [w, h * a], [w, h * (1 - a)],
            [w * (1 - a), h * (1 - a)], [w * (1 - a), h], [w * a, h], [w * a, h * (1 - a)], [0, h * (1 - a)],
            [0, h * a], [w * a, h * a]]);
    }
};

/** Draws a closed polygon of [x, y] points. */
CustomGrips.polygon = function(painter, pts) {
    var path = new QPainterPath();
    path.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
        path.lineTo(pts[i][0], pts[i][1]);
    }
    path.closeSubpath();
    painter.drawPath(path);
};

/** Adds (or replaces) a grip kind. Returns its id. */
CustomGrips.register = function(def) {
    if (isNull(def) || isNull(def.id) || typeof def.target !== "function" || typeof def.anchor !== "function") {
        throw new Error("CustomGrips.register: needs id, target(entry) and anchor(view, target)");
    }
    if (typeof def.shape === "string" && isNull(CustomGrips.SHAPES[def.shape])) {
        throw new Error("CustomGrips.register: unknown shape " + def.shape);
    }
    if (isNull(CustomGrips.grips[def.id])) {
        CustomGrips.order.push(def.id);
    }
    CustomGrips.grips[def.id] = def;
    return def.id;
};

CustomGrips.unregister = function(id) {
    delete CustomGrips.grips[id];
    var at = CustomGrips.order.indexOf(id);
    if (at >= 0) {
        CustomGrips.order.splice(at, 1);
    }
};

/** Registered ids, in registration order. */
CustomGrips.list = function() {
    return CustomGrips.order.slice(0);
};

/** The grips whose target exists for `entry`: [{id, target}]. Pure: no widgets. */
CustomGrips.applicable = function(entry) {
    var ret = [];
    for (var i = 0; i < CustomGrips.order.length; i++) {
        var def = CustomGrips.grips[CustomGrips.order[i]];
        var t;
        try {
            t = def.target(entry);
        }
        catch (e) {
            t = undefined;
        }
        if (!isNull(t)) {
            ret.push({ id: def.id, target: t });
        }
    }
    return ret;
};

/** The picture for a grip: its shape in its colours, on a transparent pixmap. */
CustomGrips.icon = function(def) {
    if (!isNull(def.icon)) {
        return def.icon;
    }
    var w = def.size[0], h = def.size[1];
    var pm = new QPixmap(w, h);
    pm.fill(new QColor(0, 0, 0, 0));
    var painter = new QPainter();
    painter.begin(pm);
    painter.setRenderHint(QPainter.Antialiasing, true);
    painter.setPen(new QPen(new QColor(isNull(def.outline) ? "#ffffff" : def.outline), 1.5));
    painter.setBrush(new QBrush(new QColor(isNull(def.fill) ? "#188cff" : def.fill)));
    painter.translate(1, 1);
    if (typeof def.shape === "function") {
        def.shape(painter, w - 2, h - 2);
    }
    else {
        CustomGrips.SHAPES[isNull(def.shape) ? "diamond" : def.shape](painter, w - 2, h - 2);
    }
    painter.end();
    def.icon = new QIcon(pm);
    return def.icon;
};

/**
 * Brings the grip widgets for `entry` in step: shows and positions the ones
 * that apply, hides the rest. Call after a selection or view change; the
 * library re-positions on pan/zoom by itself.
 *
 * \param view  the graphics view (default: entry.view())
 */
CustomGrips.refresh = function(entry, view) {
    if (isNull(view)) {
        view = typeof entry.view === "function" ? entry.view() : undefined;
    }
    if (isNull(view)) {
        return;
    }
    var widget = view.getWidget();
    if (isNull(widget)) {
        return;
    }
    if (isNull(entry.customGrips)) {
        entry.customGrips = {};
    }
    var live = {};
    var on = CustomGrips.applicable(entry);
    for (var i = 0; i < on.length; i++) {
        var def = CustomGrips.grips[on[i].id];
        live[def.id] = true;
        var slot = entry.customGrips[def.id];
        if (isNull(slot)) {
            slot = { button: CustomGrips.makeButton(entry, def, widget) };
            entry.customGrips[def.id] = slot;
        }
        slot.target = on[i].target;
        var at = def.anchor(view, on[i].target);
        slot.button.move(Math.round(at.x - slot.button.width / 2), Math.round(at.y - slot.button.height / 2));
        slot.button.visible = true;
        slot.button.raise();
    }
    for (var id in entry.customGrips) {
        if (entry.customGrips.hasOwnProperty(id) && live[id] !== true) {
            entry.customGrips[id].button.visible = false;
            entry.customGrips[id].target = undefined;
        }
    }
    if (isNull(entry.customGripsHook)) {
        entry.customGripsHook = function() { CustomGrips.refresh(entry, view); };
        try {
            view.viewportChanged.connect(entry.customGripsHook);
        }
        catch (eHook) {
        }
    }
};

CustomGrips.makeButton = function(entry, def, parent) {
    var btn = new QToolButton(parent);
    btn.objectName = "CustomGrip-" + def.id;
    btn.setIcon(CustomGrips.icon(def));
    btn.setIconSize(new QSize(def.size[0], def.size[1]));
    btn.setFixedSize(def.size[0] + 4, def.size[1] + 4);
    btn.setAutoRaise(true);
    btn.setCursor(new QCursor(Qt.PointingHandCursor));
    if (!isNull(def.tooltip)) {
        btn.toolTip = def.tooltip;
    }
    btn.clicked.connect(function() {
        var slot = entry.customGrips[def.id];
        if (!isNull(slot) && !isNull(slot.target) && typeof def.onClick === "function") {
            def.onClick(entry, slot.target);
        }
    });
    return btn;
};
