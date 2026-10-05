/**
 * Annotative -- AutoCAD-style annotation scales for text.
 *
 * An annotative text has a PAPER height and a list of SCALES, each with its own
 * position and angle (a "representation"). The drawing code (RExporter, see
 * RAnnotation.h) shows the representation for the scale being drawn at: the
 * viewport's scale in a viewport, the document's CURRENT annotation scale in
 * the model. The current scale's representation is also what the entity's own
 * geometry holds, so picking and snapping work where the text is drawn.
 *
 * Properties on the text (custom, group "CaveCAD"):
 *   Anno        "1"
 *   AnnoH       paper height, inches
 *   AnnoScales  "fpi:x,y,angle;..."   (fpi = feet per inch of paper)
 *   AnnoAt      the fpi the entity's own geometry currently represents
 *
 * Document variables: "CaveCAD/AnnoScale" (current scale, feet per inch, default
 * 1 = 1" = 1'), "CaveCAD/AnnoVisible" (1: other scales shown shaded back).
 *
 * Geometry and properties are kept in step by `capture` (geometry -> the
 * representation it stands for, after any edit, undo or redo) and `follow`
 * (the representation at the current scale -> geometry, after the scale
 * changes). Both write without an undo step of their own.
 */
include("scripts/library.js");
include("scripts/Layouts/Layouts.js");

var Annotative = {};

Annotative.GROUP = "CaveCAD";
Annotative.VAR_SCALE = "CaveCAD/AnnoScale";
Annotative.VAR_VISIBLE = "CaveCAD/AnnoVisible";
Annotative.DEFAULT_SCALE = 1;

// ---------------------------------------------------------------------
// The document's settings
// ---------------------------------------------------------------------

Annotative.currentScale = function(doc) {
    var s = Number(doc.getVariable(Annotative.VAR_SCALE, Annotative.DEFAULT_SCALE));
    return s > 0 && isFinite(s) ? s : Annotative.DEFAULT_SCALE;
};

Annotative.visible = function(doc) {
    return Number(doc.getVariable(Annotative.VAR_VISIBLE, 0)) !== 0;
};

/** Drawing units per foot of ground. */
Annotative.unitsPerFoot = function(doc) {
    return Layouts.groundFoot(doc);
};

Annotative.same = function(a, b) {
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
};

/** "1\" = 40 ft" for a scale. */
Annotative.label = function(fpi) {
    return Layouts.scaleLabel(fpi);
};

// ---------------------------------------------------------------------
// Reading and writing the properties
// ---------------------------------------------------------------------

Annotative.isText = function(e) {
    return !isNull(e) && e.getType() === RS.EntityText;
};

Annotative.isAnnotative = function(e) {
    return Annotative.isText(e) && String(e.getCustomProperty(Annotative.GROUP, "Anno", "")) === "1";
};

/** {h, at, reps: [{fpi, x, y, angle}]} -- reps sorted by scale. */
Annotative.read = function(e) {
    var reps = [], text = String(e.getCustomProperty(Annotative.GROUP, "AnnoScales", ""));
    var items = text.split(";");
    for (var i = 0; i < items.length; i++) {
        var halves = items[i].split(":");
        if (halves.length !== 2) { continue; }
        var nums = halves[1].split(",");
        if (nums.length < 2) { continue; }
        var fpi = parseFloat(halves[0]);
        if (fpi > 0) {
            reps.push({ fpi: fpi, x: parseFloat(nums[0]), y: parseFloat(nums[1]), angle: nums.length > 2 ? parseFloat(nums[2]) : 0 });
        }
    }
    reps.sort(function(a, b) { return a.fpi - b.fpi; });
    var at = parseFloat(String(e.getCustomProperty(Annotative.GROUP, "AnnoAt", "")));
    return { h: parseFloat(String(e.getCustomProperty(Annotative.GROUP, "AnnoH", "0"))), at: at > 0 ? at : undefined, reps: reps };
};

Annotative.write = function(e, data) {
    var parts = [];
    for (var i = 0; i < data.reps.length; i++) {
        var r = data.reps[i];
        parts.push(r.fpi + ":" + r.x + "," + r.y + "," + r.angle);
    }
    e.setCustomProperty(Annotative.GROUP, "Anno", "1");
    e.setCustomProperty(Annotative.GROUP, "AnnoH", String(data.h));
    e.setCustomProperty(Annotative.GROUP, "AnnoScales", parts.join(";"));
    if (!isNull(data.at)) {
        e.setCustomProperty(Annotative.GROUP, "AnnoAt", String(data.at));
    }
};

Annotative.repAt = function(data, fpi) {
    for (var i = 0; i < data.reps.length; i++) {
        if (Annotative.same(data.reps[i].fpi, fpi)) { return data.reps[i]; }
    }
    return undefined;
};

/** The scales an annotative text supports, ascending. */
Annotative.scalesOf = function(e) {
    return Annotative.read(e).reps.map(function(r) { return r.fpi; });
};

// ---------------------------------------------------------------------
// Geometry <-> representation
// ---------------------------------------------------------------------

/** Height of the text in model units at a scale. */
Annotative.modelHeight = function(doc, paperH, fpi) {
    return paperH * fpi * Annotative.unitsPerFoot(doc);
};

/** Puts the entity's own geometry on a representation (the entity is modified in place). */
Annotative.place = function(doc, e, data, rep) {
    var pos = e.getPosition();
    e.setTextHeight(Annotative.modelHeight(doc, data.h, rep.fpi));
    e.move(new RVector(rep.x - pos.x, rep.y - pos.y));
    e.setAngle(rep.angle);
    data.at = rep.fpi;
    e.setCustomProperty(Annotative.GROUP, "AnnoAt", String(rep.fpi));
};

/**
 * Brings the properties up to date with the entity's own geometry: whatever
 * scale the geometry stands for (AnnoAt) takes its position and angle, and
 * the paper height follows a changed text height. Writes nothing when they
 * already agree.
 *
 * \\return a record {id, fpi, before, after} of what it changed (for the journal), or null
 */
Annotative.capture = function(doc, di, id) {
    var e = doc.queryEntity(id);
    if (!Annotative.isAnnotative(e) || e.isUndone()) {
        return null;
    }
    var data = Annotative.read(e);
    if (isNull(data.at)) {
        return null;
    }
    var rep = Annotative.repAt(data, data.at);
    if (isNull(rep)) {
        return null;
    }
    var before = { x: rep.x, y: rep.y, angle: rep.angle, h: data.h };
    var pos = e.getPosition();
    var upf = Annotative.unitsPerFoot(doc);
    var changed = false;
    var tol = 1e-9 * Math.max(1, Math.abs(pos.x), Math.abs(pos.y));
    if (Math.abs(pos.x - rep.x) > tol || Math.abs(pos.y - rep.y) > tol || Math.abs(e.getAngle() - rep.angle) > 1e-12) {
        rep.x = pos.x;
        rep.y = pos.y;
        rep.angle = e.getAngle();
        changed = true;
    }
    var paper = e.getTextHeight() / (data.at * upf);
    if (Math.abs(paper - data.h) > 1e-9 * Math.max(1, data.h)) {
        data.h = paper;
        changed = true;
    }
    if (!changed) {
        return null;
    }
    Annotative.write(e, data);
    di.applyOperation(new RModifyObjectOperation(e, false));
    return { id: id, fpi: data.at, before: before, after: { x: rep.x, y: rep.y, angle: rep.angle, h: data.h } };
};

/**
 * After the current scale changes: the entity's own geometry goes to the
 * representation at the current scale (if it has one; else it is left alone and
 * the drawing code hides it).
 *
 * \\return true when it wrote
 */
Annotative.follow = function(doc, di, id) {
    var e = doc.queryEntity(id);
    if (!Annotative.isAnnotative(e) || e.isUndone()) {
        return false;
    }
    var data = Annotative.read(e);
    var cur = Annotative.currentScale(doc);
    var rep = Annotative.repAt(data, cur);
    if (isNull(rep) || (!isNull(data.at) && Annotative.same(data.at, cur))) {
        return false;
    }
    Annotative.place(doc, e, data, rep);
    di.applyOperation(new RModifyObjectOperation(e, false));
    return true;
};

/** Every annotative text in the drawing: ids. */
Annotative.all = function(doc) {
    var out = [], ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (Annotative.isAnnotative(e)) {
            out.push(ids[i]);
        }
    }
    return out;
};

/** Brings every annotative text's geometry to the current scale. */
Annotative.followAll = function(doc, di) {
    var n = 0, ids = Annotative.all(doc);
    for (var i = 0; i < ids.length; i++) {
        if (Annotative.follow(doc, di, ids[i])) { n++; }
    }
    return n;
};

// ---------------------------------------------------------------------
// What a person does
// ---------------------------------------------------------------------

/** Redraws everything that shows the drawing. */
Annotative.regenerate = function(di) {
    try {
        di.regenerateScenes();
    }
    catch (e) {
        try {
            di.repaintViews();
        }
        catch (e2) {
        }
    }
};

/** Sets the current annotation scale (feet per inch) and brings the texts to it. */
Annotative.setCurrentScale = function(di, fpi) {
    var doc = di.getDocument();
    if (!(fpi > 0) || !isFinite(fpi)) {
        return false;
    }
    doc.setVariable(Annotative.VAR_SCALE, fpi);
    Annotative.followAll(doc, di);
    Annotative.regenerate(di);
    if (typeof LayoutTabs !== "undefined" && typeof LayoutTabs.refreshAnnoAll === "function") {
        LayoutTabs.refreshAnnoAll();
    }
    return true;
};

Annotative.setVisible = function(di, on) {
    di.getDocument().setVariable(Annotative.VAR_VISIBLE, on ? 1 : 0);
    Annotative.regenerate(di);
    if (typeof LayoutTabs !== "undefined" && typeof LayoutTabs.refreshAnnoAll === "function") {
        LayoutTabs.refreshAnnoAll();
    }
};

/** Texts among entity ids. */
Annotative.textsOf = function(doc, ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (Annotative.isText(e) && !e.isUndone()) { out.push(ids[i]); }
    }
    return out;
};

/**
 * Makes texts annotative at the current scale: their present height is read as
 * the paper height at that scale (text 0.1 ft tall at 1" = 1' is 0.1 inch on
 * paper). One undo step.
 *
 * \\return how many were changed
 */
Annotative.make = function(di, ids) {
    var doc = di.getDocument(), cur = Annotative.currentScale(doc), n = 0;
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Make annotative"));
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!Annotative.isText(e) || Annotative.isAnnotative(e)) { continue; }
        var pos = e.getPosition();
        var data = { h: e.getTextHeight() / (cur * Annotative.unitsPerFoot(doc)), at: cur,
            reps: [{ fpi: cur, x: pos.x, y: pos.y, angle: e.getAngle() }] };
        Annotative.write(e, data);
        op.addObject(e, false);
        n++;
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/** Makes texts ordinary again; each keeps what it looks like at the current scale. One undo step. */
Annotative.unmake = function(di, ids) {
    var doc = di.getDocument(), n = 0;
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Make not annotative"));
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!Annotative.isAnnotative(e)) { continue; }
        Annotative.follow(doc, di, ids[i]);
        e = doc.queryEntity(ids[i]);
        var keys = ["Anno", "AnnoH", "AnnoScales", "AnnoAt"];
        for (var k = 0; k < keys.length; k++) {
            e.removeCustomProperty(Annotative.GROUP, keys[k]);
        }
        op.addObject(e, false);
        n++;
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/**
 * Adds a scale to annotative texts. The new representation starts where the
 * nearest existing scale (by ratio) has the text, same angle. One undo step.
 *
 * \\return how many gained the scale
 */
Annotative.addScale = function(di, ids, fpi) {
    var doc = di.getDocument(), n = 0;
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Add annotation scale"));
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!Annotative.isAnnotative(e)) { continue; }
        var data = Annotative.read(e);
        if (!isNull(Annotative.repAt(data, fpi)) || data.reps.length === 0) { continue; }
        var near = data.reps[0];
        for (var r = 1; r < data.reps.length; r++) {
            if (Math.abs(Math.log(data.reps[r].fpi / fpi)) < Math.abs(Math.log(near.fpi / fpi))) { near = data.reps[r]; }
        }
        data.reps.push({ fpi: fpi, x: near.x, y: near.y, angle: near.angle });
        data.reps.sort(function(a, b) { return a.fpi - b.fpi; });
        Annotative.write(e, data);
        op.addObject(e, false);
        n++;
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/**
 * Removes a scale from annotative texts. A text keeps at least one scale.
 * One undo step.
 *
 * \\return how many lost the scale
 */
Annotative.removeScale = function(di, ids, fpi) {
    var doc = di.getDocument(), n = 0;
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Delete annotation scale"));
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!Annotative.isAnnotative(e)) { continue; }
        var data = Annotative.read(e);
        if (data.reps.length <= 1 || isNull(Annotative.repAt(data, fpi))) { continue; }
        data.reps = data.reps.filter(function(r) { return !Annotative.same(r.fpi, fpi); });
        if (!isNull(data.at) && Annotative.same(data.at, fpi)) {
            data.at = undefined;
            e.removeCustomProperty(Annotative.GROUP, "AnnoAt");
        }
        Annotative.write(e, data);
        op.addObject(e, false);
        n++;
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/**
 * WHY A JOURNAL. QCAD's undo restores only the properties a transaction changed:
 * undoing a move puts the old POSITION back, onto whatever scale the text
 * happens to be showing now. The position each scale held before and after an
 * edit is therefore remembered here, by transaction, and undo / redo put THAT
 * back (this session only; after a restart the geometry-based capture still
 * keeps the scale being shown right).
 */
Annotative.journal = {};

/** Forces the entity's own geometry onto the representation at the current scale. */
Annotative.refollow = function(doc, di, id) {
    var e = doc.queryEntity(id);
    if (!Annotative.isAnnotative(e) || e.isUndone()) { return false; }
    var data = Annotative.read(e);
    var rep = Annotative.repAt(data, Annotative.currentScale(doc));
    if (isNull(rep)) { return false; }
    Annotative.place(doc, e, data, rep);
    di.applyOperation(new RModifyObjectOperation(e, false));
    return true;
};

/**
 * Sorts out annotative texts after a transaction.
 *
 * \\param kind  "edit" | "undo" | "redo"
 * \\param txId  the transaction's id (the journal's key)
 */
Annotative.afterTransaction = function(doc, di, ids, kind, txId) {
    var records = [];
    for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (kind === "edit") {
            var rec = Annotative.capture(doc, di, id);
            if (!isNull(rec)) { records.push(rec); }
            Annotative.follow(doc, di, id);
        }
        else {
            var entries = isNull(Annotative.journal[txId]) ? [] : Annotative.journal[txId];
            var mine = entries.filter(function(r) { return r.id === id; });
            for (var m = 0; m < mine.length; m++) {
                var e = doc.queryEntity(id);
                if (!Annotative.isAnnotative(e)) { continue; }
                var data = Annotative.read(e);
                var rep = Annotative.repAt(data, mine[m].fpi);
                if (isNull(rep)) { continue; }
                var to = kind === "undo" ? mine[m].before : mine[m].after;
                rep.x = to.x; rep.y = to.y; rep.angle = to.angle; data.h = to.h;
                Annotative.write(e, data);
                di.applyOperation(new RModifyObjectOperation(e, false));
            }
            if (mine.length > 0) {
                Annotative.refollow(doc, di, id);
            }
            else {
                Annotative.capture(doc, di, id);
                Annotative.follow(doc, di, id);
            }
        }
    }
    if (records.length > 0 && !isNull(txId)) {
        Annotative.journal[txId] = (Annotative.journal[txId] || []).concat(records);
    }
    return records.length;
};

/** Edit, then follow the current scale (kept for callers that have no transaction). */
Annotative.settle = function(doc, di, id) {
    return Annotative.afterTransaction(doc, di, [id], "edit", undefined) > 0;
};

// ---------------------------------------------------------------------
// The listener: keeps geometry and properties in step through edits, undo and redo
// ---------------------------------------------------------------------

Annotative.listener = undefined;
Annotative.busy = false;

Annotative.install = function() {
    if (!isNull(Annotative.listener)) {
        return true;
    }
    var appWin = RMainWindowQt.getMainWindow();
    if (isNull(appWin) || isNull(appWin.addTransactionListener)) {
        return false;     // headless
    }
    try {
        var adapter = new RTransactionListenerAdapter();
        appWin.addTransactionListener(adapter);
        adapter.transactionUpdated.connect(Annotative.onTransaction);
        Annotative.listener = adapter;
    }
    catch (e) {
        return false;
    }
    return true;
};

Annotative.onTransaction = function(document, transaction) {
    if (Annotative.busy || isNull(document) || isNull(transaction)) {
        return;
    }
    var ids;
    try {
        ids = transaction.getAffectedObjects();
    }
    catch (e) {
        return;
    }
    var mine = [];
    for (var i = 0; i < ids.length; i++) {
        var e2 = document.queryEntity(ids[i]);
        if (Annotative.isAnnotative(e2)) {
            mine.push(ids[i]);
        }
    }
    if (mine.length === 0) {
        return;
    }
    var appWin = RMainWindowQt.getMainWindow();
    var di = isNull(appWin) ? undefined : appWin.getDocumentInterface();
    if (isNull(di) || isNull(di.getDocument()) || di.getDocument().getFileName() !== document.getFileName()) {
        return;
    }
    var kind = "edit", txId;
    try {
        if (transaction.isUndoing()) { kind = "undo"; }
        else if (transaction.isRedoing()) { kind = "redo"; }
        txId = transaction.getId();
    }
    catch (eKind) {
    }
    Annotative.busy = true;
    try {
        Annotative.afterTransaction(di.getDocument(), di, mine, kind, txId);
    }
    catch (eOne) {
    }
    finally {
        Annotative.busy = false;
    }
};
