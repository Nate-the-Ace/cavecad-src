// CsDemo.js -- records a scripted run of a panel as a numbered PNG sequence
// plus the exact cursor path and click moments.
//
// The rig saves CLEAN frames and a track.json of where the cursor was in
// each; tools/demo/compose.py draws the real macOS cursor in afterwards.
// (QPainter is wrapper-only in this engine -- no method on it exists.)
//
// DEV-ONLY. It is evaluated into a running CaveCAD through the MCP bridge
// and is never part of the shipped add-on.
//
//   CsDemo.record({ root: dock, outDir: "/tmp/clip", fps: 20,
//     steps: [ { click: { widget: button }, run: function() {...} }, ... ] });
//
// WHY THE CURSOR IS DRAWN, NOT CAPTURED. A widget grab never contains the
// OS cursor, and QCoreApplication.sendEvent crashes this engine, so the
// demo cannot move a real mouse. Instead a step names a TARGET and the
// rig derives the cursor's position from that target's real geometry --
// the same number the action is aimed at -- so the picture cannot drift
// from what ran. A step whose `run` calls a handler directly (button.click)
// is a handler call and not a real mouse event; the clip is honest about
// the cursor, not about the input path.
//
// WHY A SIMULATED CLOCK. Frame n is exactly n / fps seconds into the clip
// however long the grab and save took, so a slow frame never stretches the
// motion in the finished GIF.
//
// STEPS
//   { move:  target, ms }              glide the cursor to a target
//   { click: target, run: fn, ms }     glide, dwell, ripple, call fn
//   { wait:  ms }                      hold still
//   { style: "arrow"|"hand"|"ibeam" }  change the cursor shape
//   { type: "text", set: fn(prefix), per: ms }  type it a character at a time
//   { run: fn }                        do something at this instant
//   { drag: [[wx,wy],...], ms, run }   press, travel, release along a path in the drawing; run fires at the release
//         { world: [wx, wy] }          a point in the drawing (canvas takes)
// TARGET  { widget: w, at: [fx, fy] }  fractions of the widget (default centre)
//         { table: t, row: n }         the middle of a table row
//         { table: t, row: n, col: c } the middle of one cell
//         { x: px, y: px }             a point in the root's own coordinates
//         { lazy: fn }                 fn() -> a target, asked when the cursor sets off

CsDemo = {};

CsDemo.RIPPLE_MS = 380;
CsDemo.DWELL_MS = 140;
CsDemo.state = { running: false, done: false, frames: 0, error: "" };

/** A Qt member that this bridge exposes as a property or as a method. */
CsDemo.val = function(o, name) {
    var v = o[name];
    if (typeof v === "function") {
        return v.call(o);
    }
    return v;
};

/** The point a target resolves to, in the root's own coordinates. */
CsDemo.resolve = function(root, target) {
    // a table that is refilled by an earlier step has new cell widgets
    // by the time the cursor gets there: ask for the target then
    if (target.lazy !== undefined) {
        target = target.lazy();
    }
    if (target.world !== undefined) {
        // a point in the DRAWING: where the view puts it on screen
        var sp = CsDemo.rview.mapToView(new RVector(target.world[0],
            target.world[1]));
        return { x: sp.x, y: sp.y };
    }
    if (target.x !== undefined) {
        return { x: target.x, y: target.y };
    }
    if (target.table !== undefined) {
        var t = target.table;
        var o = t.mapTo(root, new QPoint(0, 0));
        var fw = 1;
        // a table with its headers showing has them ABOVE and LEFT of the
        // viewport the row and column positions are measured in
        var hh = 0;
        var vw = 0;
        try {
            var hdr = t.horizontalHeader();
            if (hdr.visible === true) {
                hh = CsDemo.val(hdr, "height");
            }
            var vdr = t.verticalHeader();
            if (vdr.visible === true) {
                vw = CsDemo.val(vdr, "width");
            }
        } catch (eHdr) {
        }
        var ry = t.rowViewportPosition(target.row) +
            t.rowHeight(target.row) / 2;
        var fx = target.at ? target.at[0] : 0.3;
        var x;
        if (target.col !== undefined) {
            x = t.columnViewportPosition(target.col) +
                t.columnWidth(target.col) * (target.at ? target.at[0] : 0.5);
        } else {
            x = CsDemo.val(t, "width") * fx;
        }
        return { x: o.x() + fw + vw + x, y: o.y() + fw + hh + ry };
    }
    var w = target.widget;
    var p = w.mapTo(root, new QPoint(0, 0));
    var f = target.at ? target.at : [0.5, 0.5];
    return { x: p.x() + CsDemo.val(w, "width") * f[0],
        y: p.y() + CsDemo.val(w, "height") * f[1] };
};

CsDemo.ease = function(u) {
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

/** Turn the step list into a timeline of segments and one-shot actions. */
CsDemo.compile = function(root, steps, start) {
    var t = 0;
    var pos = start;
    var segs = [];
    var acts = [];
    var ripples = [];
    var styleAt = [{ t: 0, name: "arrow" }];
    for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.wait !== undefined) {
            t += s.wait;
        } else if (s.style !== undefined) {
            styleAt.push({ t: t, name: s.style });
        } else if (s.drag !== undefined) {
            // press at the first point, travel the rest at an even pace,
            // release at the last: the stroke a hand would make. run fires
            // at the RELEASE, which is when a drag tool draws.
            var pts = s.drag;
            var travel = s.ms !== undefined ? s.ms : 2200;
            segs.push({ t0: t, t1: t + 700, from: null,
                target: { world: pts[0] } });
            t += 700 + CsDemo.DWELL_MS;
            ripples.push({ t: t, target: { world: pts[0] } });
            t += 120;
            var per = travel / (pts.length - 1);
            for (var q = 1; q < pts.length; q++) {
                segs.push({ t0: t, t1: t + per, from: null,
                    target: { world: pts[q] } });
                t += per;
            }
            acts.push({ t: t, fn: s.run || null, done: false });
            ripples.push({ t: t, target: { world: pts[pts.length - 1] } });
            t += s.hold !== undefined ? s.hold : 1500;
        } else if (s.type !== undefined) {
            // one character at a time; set(prefix) puts the text where
            // it belongs
            var per = s.per !== undefined ? s.per : 110;
            for (var c = 1; c <= s.type.length; c++) {
                acts.push({ t: t + (c - 1) * per, done: false,
                    fn: (function(text, set) {
                        return function() { set(text); };
                    })(s.type.substring(0, c), s.set) });
            }
            t += s.type.length * per + (s.hold !== undefined ? s.hold : 400);
        } else if (s.run !== undefined && s.click === undefined &&
                s.move === undefined) {
            acts.push({ t: t, fn: s.run, done: false });
        } else {
            var target = s.move !== undefined ? s.move : s.click;
            var ms = s.ms !== undefined ? s.ms : 650;
            // resolved lazily at run time: a list row exists only after
            // an earlier step has filled the list
            segs.push({ t0: t, t1: t + ms, from: null, target: target });
            t += ms;
            if (s.click !== undefined) {
                t += CsDemo.DWELL_MS;
                acts.push({ t: t, fn: s.run || null, done: false });
                ripples.push({ t: t, target: target });
                t += s.hold !== undefined ? s.hold : 260;
            }
        }
    }
    return { segs: segs, acts: acts, ripples: ripples, styles: styleAt,
        total: t + 500, pos: pos };
};

CsDemo.cursorAt = function(root, tl, t) {
    var cur = tl.pos;
    for (var i = 0; i < tl.segs.length; i++) {
        var g = tl.segs[i];
        if (t < g.t0) {
            break;
        }
        if (g.to === undefined) {
            g.from = { x: cur.x, y: cur.y };
            g.to = CsDemo.resolve(root, g.target);
        }
        var u = t >= g.t1 ? 1 : (t - g.t0) / (g.t1 - g.t0);
        var e = CsDemo.ease(u);
        cur = { x: g.from.x + (g.to.x - g.from.x) * e,
            y: g.from.y + (g.to.y - g.from.y) * e };
    }
    return cur;
};

CsDemo.styleAt = function(tl, t) {
    var name = "arrow";
    for (var i = 0; i < tl.styles.length; i++) {
        if (tl.styles[i].t <= t) {
            name = tl.styles[i].name;
        }
    }
    return name;
};

CsDemo.frame = function(run, t) {
    var tl = run.tl;
    // one-shot actions come due BEFORE the frame is taken, so the frame
    // that follows a click shows what the click did
    for (var a = 0; a < tl.acts.length; a++) {
        if (!tl.acts[a].done && tl.acts[a].t <= t) {
            tl.acts[a].done = true;
            if (tl.acts[a].fn) {
                tl.acts[a].fn();
            }
        }
    }
    var cur = CsDemo.cursorAt(run.root, tl, t);
    var n = run.n;
    var name = run.outDir + "/f" + (n < 10 ? "000" : n < 100 ? "00" :
        n < 1000 ? "0" : "") + n + ".png";
    run.root.grab().save(name, "PNG");
    var ripple = null;
    for (var r = 0; r < tl.ripples.length; r++) {
        var age = t - tl.ripples[r].t;
        if (age >= 0 && age < CsDemo.RIPPLE_MS) {
            var rp = tl.ripples[r].at;
            if (rp === undefined) {
                rp = tl.ripples[r].at = CsDemo.resolve(run.root,
                    tl.ripples[r].target);
            }
            ripple = { x: rp.x, y: rp.y, k: age / CsDemo.RIPPLE_MS };
        }
    }
    run.track.push({ n: n, t: t, x: cur.x, y: cur.y,
        style: CsDemo.styleAt(tl, t), ripple: ripple });
    run.n = n + 1;
};

/** The cursor track, written beside the frames for compose.py. */
CsDemo.writeTrack = function(run, fps) {
    var f = new QFile(run.outDir + "/track.json");
    f.open(QIODevice.WriteOnly);
    var out = new QTextStream(f);
    out.writeString(JSON.stringify({ fps: fps, dpr: run.dpr,
        frames: run.track }));
    out.flush();
    f.close();
};

CsDemo.record = function(opts) {
    var root = opts.root;
    var fps = opts.fps || 20;
    QDir.root().mkpath(opts.outDir);
    var probe = root.grab();
    var dpr = probe.width() / CsDemo.val(root, "width");
    var start = opts.start || { x: CsDemo.val(root, "width") * 0.85,
        y: CsDemo.val(root, "height") * 0.12 };
    var run = { root: root, outDir: opts.outDir, dpr: dpr, n: 0, warm: 0,
        track: [], tl: CsDemo.compile(root, opts.steps, start) };
    CsDemo.state = { running: true, done: false, frames: 0, error: "",
        fps: fps, dpr: dpr, total: run.tl.total };
    var dt = 1000 / fps;
    var timer = new QTimer(root);
    timer.interval = 1;
    timer.timeout.connect(function() {
        try {
            // let a freshly floated dock lay itself out before frame 0
            if (run.warm < 8) {
                run.warm += 1;
                return;
            }
            var t = run.n * dt;
            if (t > run.tl.total) {
                timer.stop();
                CsDemo.state.running = false;
                CsDemo.state.done = true;
                CsDemo.state.frames = run.n;
                CsDemo.writeTrack(run, fps);
                if (opts.onDone) {
                    opts.onDone();
                }
                return;
            }
            CsDemo.frame(run, t);
            CsDemo.state.frames = run.n;
        } catch (e) {
            timer.stop();
            CsDemo.state.running = false;
            CsDemo.state.error = String(e);
            if (opts.onDone) {
                try {
                    opts.onDone();
                } catch (eDone) {
                }
            }
        }
    });
    CsDemo.timer = timer;
    timer.start();
};

/**
 * Run a scenario (tools/demo/scenarios/<id>.js assigns CsDemoScenario):
 *
 *   { dock:     function() -> the QDockWidget to film (build + show it),
 *     size:     [w, h] in points the floating dock is given,
 *     fps:      frames per second (default 15),
 *     setup:    function() -- put the panel in its starting state,
 *     steps:    function() -> the step list (built late: targets such as a
 *               table row only exist once setup has run),
 *     teardown: function() -- undo anything setup did to the document }
 *
 * The dock is floated for the take and put back after, with the main
 * window's own saved state, so a clip never leaves the layout changed.
 */
CsDemo.start = function(sc, outDir) {
    var mw = RMainWindowQt.getMainWindow();
    var saved = mw.saveState();
    var dock = sc.dock();
    dock.visible = true;
    dock.raise();
    dock.setFloating(true);
    dock.resize(sc.size[0], sc.size[1]);
    if (sc.setup) {
        sc.setup();
    }
    CsDemo.record({ root: dock, outDir: outDir, fps: sc.fps || 15,
        steps: sc.steps(),
        onDone: function() {
            try {
                if (sc.teardown) {
                    sc.teardown();
                }
            } finally {
                dock.setFloating(false);
                mw.restoreState(saved);
                // restoreState re-tabs the dock on top; hand the user back
                // the tab they had
                try {
                    mw.findChild(sc.returnTo || "CaveSurveyNotebookDock").raise();
                } catch (eRaise) {
                }
            }
        } });
};

/**
 * Open a drawing in its own tab for one take, and close it after.
 *
 * A clip must not depend on whatever the user has open or on what an
 * earlier take did to it, so run.py hands every take a fresh copy of
 * the source drawing and this opens it. The tab is closed unmodified,
 * so there is never a save prompt.
 */
CsDemo.openFresh = function(path) {
    include("scripts/File/NewFile/NewFile.js");
    CsDemo.fresh = NewFile.createMdiChild(path);
    return CsDemo.fresh;
};

CsDemo.closeFresh = function() {
    if (!CsDemo.fresh) {
        return;
    }
    try {
        EAction.getDocument().setModified(false);
    } catch (eMod) {
    }
    try {
        CsDemo.fresh.close();
    } catch (eClose) {
    }
    CsDemo.fresh = null;
};

/**
 * Load some functions from the repo's copy of a file into the running app,
 * so a clip can be recorded against a fix that has not been published yet.
 *
 *   CsDemo.hotLoad(repoRoot + "/scripts/CaveSurvey/SymbolPalette/SymbolPalette.js",
 *       ["SymbolPalette.tilePen", "SymbolPalette.tileFor"]);
 *
 * Each name is lifted as the text from "<name> = function" to the closing
 * "};" at column 0 and evaluated as an assignment, which lands on the
 * global object (a function DECLARATION in an eval would stay local).
 * A restart puts the installed code back.
 */
CsDemo.hotLoad = function(path, names) {
    var text = CsHandbook.readText(path);
    for (var i = 0; i < names.length; i++) {
        var at = text.indexOf("\n" + names[i] + " = function");
        if (at < 0) {
            throw new Error("hotLoad: " + names[i] + " not in " + path);
        }
        var end = text.indexOf("\n};\n", at);
        eval(text.substring(at + 1, end + 4));
    }
};

/**
 * A child widget of `root` whose text contains `part`, or null. Modal
 * dialogs keep their controls in local variables, so a scenario finds
 * them by what they say.
 */
CsDemo.find = function(root, part, wantClick) {
    var kids = root.children();
    for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k === undefined || k === null) {
            continue;
        }
        var t = null;
        try {
            t = k.text;
            if (typeof t === "function") {
                t = t.call(k);
            }
        } catch (eText) {
            t = null;
        }
        if (t !== null && t !== undefined && String(t).indexOf(part) >= 0 &&
                (wantClick !== true || typeof k.click === "function")) {
            return k;
        }
        var deeper = null;
        try {
            deeper = CsDemo.find(k, part, wantClick);
        } catch (eDeep) {
            deeper = null;
        }
        if (deeper !== null) {
            return deeper;
        }
    }
    return null;
};

/**
 * Film a MODAL dialog. A dialog's exec() blocks whoever called it, and
 * the bridge keeps serving only while something else runs the nested
 * loop -- so the dialog is launched from a timer and this call returns at
 * once. Another timer waits for the modal widget to appear, then films it
 * exactly as a docked panel is filmed.
 *
 *   { modal: true,
 *     launch: function() -- opens the dialog (and blocks inside exec),
 *     size:   [w, h] the dialog is resized to,
 *     steps:  function(root) -> steps, given the dialog widget,
 *     teardown: function() }
 *
 * At the end the dialog is rejected, which is what lets launch() return.
 */
CsDemo.startModal = function(sc, outDir) {
    CsDemo.state = { running: true, done: false, frames: 0, error: "",
        waiting: true };
    // activeModalWidget() comes back typed as a bare QWidget, whose
    // children() answers nothing. A QDialog this file constructs answers
    // properly, so for the launch the QDialog constructor is wrapped to
    // keep the dialog the tool makes, and put back once it is seen.
    var RealDialog = QDialog;
    CsDemo.lastDialog = null;
    var launcher = new QTimer();
    launcher.interval = 50;
    launcher.timeout.connect(function() {
        launcher.stop();
        try {
            var Wrapped = function(parent) {
                var d = (parent === undefined) ? new RealDialog() :
                    new RealDialog(parent);
                CsDemo.lastDialog = d;
                return d;
            };
            for (var key in RealDialog) {
                Wrapped[key] = RealDialog[key];
            }
            QDialog = Wrapped;
            sc.launch();
        } catch (e) {
            CsDemo.state.running = false;
            CsDemo.state.error = "launch: " + e;
        }
    });
    var waited = 0;
    var watcher = new QTimer();
    watcher.interval = 100;
    watcher.timeout.connect(function() {
        waited += 100;
        var root = CsDemo.lastDialog;
        if (root !== null && root !== undefined) {
            QDialog = RealDialog;
        }
        if (root === null || root === undefined) {
            if (waited > 20000) {
                QDialog = RealDialog;
                watcher.stop();
                CsDemo.state.running = false;
                CsDemo.state.error = "the dialog never appeared";
            }
            return;
        }
        watcher.stop();
        try {
            root.resize(sc.size[0], sc.size[1]);
            CsDemo.modalRoot = root;
            CsDemo.record({ root: root, outDir: outDir, fps: sc.fps || 12,
                steps: sc.steps(root),
                onDone: function() {
                    try {
                        if (sc.teardown) {
                            sc.teardown();
                        }
                    } finally {
                        // leaves exec(), so launch() returns
                        root.reject();
                        CsDemo.modalRoot = null;
                    }
                } });
        } catch (e2) {
            CsDemo.state.running = false;
            CsDemo.state.error = "film: " + e2;
            try {
                root.reject();
            } catch (e3) {
            }
        }
    });
    CsDemo.launcher = launcher;
    CsDemo.watcher = watcher;
    launcher.start();
    watcher.start();
};

/**
 * CANVAS TAKES: film the drawing view itself.
 *
 * The map's graphics view is a child widget of the document's tab; it is
 * grabbed on its own (no rulers, no tab bar) and its own mapToView turns
 * a point in the drawing into the pixel it is drawn at, so a cursor
 * target in WORLD coordinates lands exactly on the geometry.
 *
 *   { canvas: true,
 *     hide:   [layer names]   emptied and switched off in the take's temp drawing,
 *     box:    [x1, y1, x2, y2] the part of the drawing to frame,
 *     setup:  function(), steps: function() -> steps, teardown: function() }
 *
 * The drawing is the throw-away copy run.py opened, closed unmodified
 * after, so hiding layers or adding geometry never reaches a real file.
 */
CsDemo.canvasView = function() {
    var w = RMainWindowQt.getMainWindow().getMdiArea().currentSubWindow().widget();
    var found = null;
    var walk = function(x) {
        var kids = x.children();
        for (var i = 0; i < kids.length && found === null; i++) {
            var k = kids[i];
            if (k === undefined || k === null) {
                continue;
            }
            if (String(k).indexOf("RGraphicsViewQt") >= 0) {
                found = k;
                return;
            }
            walk(k);
        }
    };
    walk(w);
    return found;
};

CsDemo.startCanvas = function(sc, outDir) {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    var hide = sc.hide || [];
    for (var i = 0; i < hide.length; i++) {
        var layer = doc.queryLayer(hide[i]);
        if (!isNull(layer)) {
            // switched off AND emptied: a block reference's inner lines
            // (the contours) ignore their parent layer being off. Safe,
            // because this is the take's own throw-away copy.
            var gone = doc.queryLayerEntities(doc.getLayerId(hide[i]));
            if (gone.length > 0) {
                var del = new RDeleteObjectsOperation();
                for (var g = 0; g < gone.length; g++) {
                    del.deleteObject(doc.queryObject(gone[g]));
                }
                di.applyOperation(del);
            }
            layer.setOff(true);
            di.applyOperation(new RModifyObjectOperation(layer));
        }
    }
    CsDemo.rview = di.getLastKnownViewWithFocus();
    CsDemo.rview.zoomTo(new RBox(new RVector(sc.box[0], sc.box[1]),
        new RVector(sc.box[2], sc.box[3])), 0);
    var root = CsDemo.canvasView();
    if (sc.setup) {
        sc.setup();
    }
    CsDemo.record({ root: root, outDir: outDir, fps: sc.fps || 12,
        steps: sc.steps(),
        start: { x: CsDemo.val(root, "width") * 0.9,
            y: CsDemo.val(root, "height") * 0.12 },
        onDone: function() {
            if (sc.teardown) {
                sc.teardown();
            }
        } });
};

/** Add a polyline to the drawing and hand back the stored entity. */
CsDemo.addPolyline = function(points) {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    var pl = new RPolyline();
    for (var i = 0; i < points.length; i++) {
        pl.appendVertex(new RVector(points[i][0], points[i][1]));
    }
    var before = doc.queryAllEntities();
    var seen = {};
    for (var b = 0; b < before.length; b++) {
        seen[before[b]] = true;
    }
    di.applyOperation(new RAddObjectOperation(
        new RPolylineEntity(doc, new RPolylineData(pl)), false));
    var after = doc.queryAllEntities();
    for (var a = 0; a < after.length; a++) {
        if (seen[after[a]] !== true) {
            return doc.queryEntity(after[a]);
        }
    }
    return null;
};
