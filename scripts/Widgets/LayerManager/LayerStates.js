/**
 * Copyright (c) 2026 CaveCAD contributors.
 *
 * This file is part of CaveCAD, a fork of the QCAD project.
 *
 * CaveCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CaveCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with CaveCAD.
 */

// Sibling files are included through includeBasePath, not through a
// "scripts/"-rooted path. An add-on folder can live in the application
// bundle OR in the per-user scripts folder, and include() resolves a
// rooted path only against the bundle: from the per-user folder it
// reports "not found" and the next line dies with a bare "X is not
// defined". Same rule the Cave Survey suite follows.
include(includeBasePath + "/LayerGroups.js");

/**
 * \class LayerStates
 * \brief Named snapshots of what every layer looks like and does.
 *
 * Stored in the same document blob the groups live in, for the same
 * reason: layer custom properties are dropped by the DXF exporter. See
 * the header of LayerGroups.js for the measurement. Groups and states
 * share that blob and NOTHING ELSE -- a state never carries a group and
 * importing one never touches an arrangement somebody built by hand.
 *
 * A state's entry for one layer is a RECORD, and every field in it is
 * OPTIONAL:
 *
 *     { off, frozen, locked, plottable, snappable,
 *       color, linetype, lineweight }
 *
 * Optional is the whole design. A field a record does not carry is left
 * alone on restore, exactly as a layer the state never mentions is left
 * alone. That is what lets the template ship a "Plot ready" that means
 * "hide the scans" without also meaning "and put every colour back to
 * what it was the day the template was built" -- a state that froze the
 * palette would quietly undo Restyle Layers every time it was applied.
 * A state a caver SAVES captures everything, because they asked for a
 * photograph of the drawing as it stands.
 */
function LayerStates() {
}

/**
 * State names obey the same rule group names do. They do not strictly
 * need to, but one rule the user can learn beats two that differ by an
 * invisible detail.
 */
LayerStates.isValidName = function(name) {
    return LayerGroups.isValidName(name);
};

LayerStates.nameError = function(name) {
    return LayerGroups.nameError(name);
};


// ---------------------------------------------------------------------
// Records: what a state remembers about one layer
// ---------------------------------------------------------------------

/** The boolean fields, in the order they are packed into a record string. */
LayerStates.FLAGS = ["off", "frozen", "locked", "plottable", "snappable"];

/** Field separator inside a stored record. */
LayerStates.FIELD_SEP = ";";

/** A field the record does not carry. */
LayerStates.ABSENT = "-";

/**
 * \return A colour as text that survives a round trip.
 *
 * The hex form and not RColor::getName(), which answers "White" for one
 * and "#1163c8" for the next: a named colour is a localised string in
 * some builds, and a state written in one language would not read in
 * another. ByLayer and ByBlock have no hex and keep their token -- they
 * are nonsense on a layer, but a file can hold them and a reader that
 * threw would be worse than one that passes them through.
 */
LayerStates.colorToText = function(color) {
    if (isNull(color)) {
        return undefined;
    }
    try {
        if (color.isByLayer()) {
            return "ByLayer";
        }
        if (color.isByBlock()) {
            return "ByBlock";
        }
        var hex = function(n) {
            var t = Number(n).toString(16);
            return t.length < 2 ? "0" + t : t;
        };
        return "#" + hex(color.red()) + hex(color.green()) + hex(color.blue());
    }
    catch (e) {
        return undefined;
    }
};

/** \return An RColor for text from colorToText, or undefined. */
LayerStates.colorFromText = function(text) {
    if (isNull(text) || String(text).length === 0) {
        return undefined;
    }
    try {
        return new RColor(String(text));
    }
    catch (e) {
        return undefined;
    }
};

/**
 * \return Everything \c layer currently is, as a record.
 *
 * \param doc Needed for the linetype, which a layer holds as an id that
 * means nothing in another drawing. The NAME is what travels.
 */
LayerStates.encode = function(doc, layer) {
    var record = {
        off: layer.isOff(),
        frozen: layer.isFrozen(),
        locked: layer.isLocked(),
        color: LayerStates.colorToText(layer.getColor()),
        lineweight: layer.getLineweight()
    };
    // Not every build has these; a missing one is simply not recorded
    // rather than recorded as false, which would switch it off on the
    // next restore.
    if (isFunction(layer.isPlottable)) {
        record.plottable = layer.isPlottable();
    }
    if (isFunction(layer.isSnappable)) {
        record.snappable = layer.isSnappable();
    }
    if (!isNull(doc) && isFunction(doc.getLinetypeName)) {
        var name = doc.getLinetypeName(layer.getLinetypeId());
        if (!isNull(name) && String(name).length > 0) {
            record.linetype = String(name);
        }
    }
    return record;
};

/**
 * Applies \c record to \c layer. Mutates the layer only; the caller owns
 * the operation.
 *
 * NOT named apply(). LayerStates is a function object, and Function
 * carries its own apply: assigning over it does not take, so the call
 * lands in Function.prototype.apply and dies with a bare "TypeError:
 * Type error" that names nothing. Cost one live debugging session.
 * The same trap waits on call, bind and name.
 *
 * A field the record does not carry is LEFT ALONE. A linetype the
 * drawing does not have is left alone too -- the alternative is putting
 * a layer on CONTINUOUS because the state came from a cave with a
 * linetype this one never loaded.
 *
 * \return True if anything changed, so the caller can skip layers that
 * are already right and keep the transaction small.
 */
LayerStates.applyRecord = function(doc, layer, record) {
    if (isNull(record) || typeof(record) !== "object") {
        return false;
    }
    var changed = false;
    var i, field;

    for (i = 0; i < LayerStates.FLAGS.length; i++) {
        field = LayerStates.FLAGS[i];
        if (typeof(record[field]) !== "boolean") {
            continue;
        }
        var getter = "is" + field.charAt(0).toUpperCase() + field.substring(1);
        var setter = "set" + field.charAt(0).toUpperCase() + field.substring(1);
        if (!isFunction(layer[getter]) || !isFunction(layer[setter])) {
            continue;
        }
        if (layer[getter]() !== record[field]) {
            layer[setter](record[field]);
            changed = true;
        }
    }

    if (!isNull(record.color)) {
        var color = LayerStates.colorFromText(record.color);
        if (!isNull(color) &&
                LayerStates.colorToText(layer.getColor()) !== record.color) {
            layer.setColor(color);
            changed = true;
        }
    }

    if (typeof(record.lineweight) === "number" &&
            layer.getLineweight() !== record.lineweight) {
        layer.setLineweight(record.lineweight);
        changed = true;
    }

    if (!isNull(record.linetype) && !isNull(doc) &&
            isFunction(doc.getLinetypeId)) {
        var id = doc.getLinetypeId(String(record.linetype));
        if (!isNull(id) && id !== RObject.INVALID_ID &&
                layer.getLinetypeId() !== id) {
            layer.setLinetypeId(id);
            changed = true;
        }
    }

    return changed;
};

/**
 * \return A record packed into one string for storage.
 *
 * Fixed slots -- five flag characters, colour, linetype, lineweight --
 * so a reader knows what it is looking at without a key per field. A
 * dash is a field the record does not carry, which is not the same as a
 * field that is false.
 */
LayerStates.packRecord = function(record) {
    var flags = "";
    for (var i = 0; i < LayerStates.FLAGS.length; i++) {
        var value = record[LayerStates.FLAGS[i]];
        flags += (typeof(value) === "boolean") ? (value ? "1" : "0")
                                               : LayerStates.ABSENT;
    }
    var parts = [
        flags,
        isNull(record.color) ? LayerStates.ABSENT : String(record.color),
        isNull(record.linetype) ? LayerStates.ABSENT : String(record.linetype),
        (typeof(record.lineweight) === "number") ? String(record.lineweight)
                                                 : LayerStates.ABSENT
    ];
    return parts.join(LayerStates.FIELD_SEP);
};

/**
 * \return The record a packed string describes, or undefined.
 *
 * Reads the OLD three-character form too: before layer states carried
 * appearance, an entry was "110" and nothing else. Those become
 * flags-only records, which is exactly what they meant.
 */
LayerStates.unpackRecord = function(text) {
    if (isNull(text)) {
        return undefined;
    }
    text = String(text);

    if (text.indexOf(LayerStates.FIELD_SEP) < 0) {
        // Pre-appearance format: off, frozen, locked and nothing else.
        if (text.length !== 3) {
            return undefined;
        }
        return { off: text.charAt(0) === "1",
                 frozen: text.charAt(1) === "1",
                 locked: text.charAt(2) === "1" };
    }

    var parts = text.split(LayerStates.FIELD_SEP);
    var flags = parts[0];
    var record = {};
    for (var i = 0; i < LayerStates.FLAGS.length && i < flags.length; i++) {
        var ch = flags.charAt(i);
        if (ch === "0" || ch === "1") {
            record[LayerStates.FLAGS[i]] = (ch === "1");
        }
    }
    if (parts.length > 1 && parts[1] !== LayerStates.ABSENT && parts[1] !== "") {
        record.color = parts[1];
    }
    if (parts.length > 2 && parts[2] !== LayerStates.ABSENT && parts[2] !== "") {
        record.linetype = parts[2];
    }
    if (parts.length > 3 && parts[3] !== LayerStates.ABSENT && parts[3] !== "") {
        var lw = parseInt(parts[3], 10);
        if (!isNaN(lw)) {
            record.lineweight = lw;
        }
    }
    return record;
};


// ---------------------------------------------------------------------
// States within a registry
// ---------------------------------------------------------------------

/** \return Ordered state names held in \c reg. */
LayerStates.stateNames = function(reg) {
    var res = [];
    for (var i=0; i<reg.states.length; i++) {
        res.push(reg.states[i].name);
    }
    return res;
};

/** \return The state entry named \c name, or undefined. */
LayerStates.findState = function(reg, name) {
    for (var i=0; i<reg.states.length; i++) {
        if (reg.states[i].name===name) {
            return reg.states[i];
        }
    }
    return undefined;
};

/**
 * \return \c layerName's record in state \c name, or undefined if the
 * state holds no entry for it.
 *
 * Undefined is the meaningful case, not an error: a layer created after
 * the state was saved has no entry, and a restore must leave it alone.
 * Guessing a default here is how an elevation datum gets rebased to zero.
 */
LayerStates.getRecord = function(reg, name, layerName) {
    var st = LayerStates.findState(reg, name);
    if (isNull(st)) {
        return undefined;
    }
    var record = st.flags[layerName];
    return (isNull(record) || typeof(record)!=="object") ? undefined : record;
};

/**
 * Records \c flags under state \c name in \c reg, replacing that state if
 * it already exists but keeping its place in the order.
 */
LayerStates.setState = function(reg, name, flags) {
    var st = LayerStates.findState(reg, name);
    if (isNull(st)) {
        reg.states.push({ name: name, flags: flags });
    }
    else {
        st.flags = flags;
    }
};

/** \return True if \c reg changed. */
LayerStates.removeState = function(reg, name) {
    var st = LayerStates.findState(reg, name);
    if (isNull(st)) {
        return false;
    }
    reg.states.splice(reg.states.indexOf(st), 1);
    return true;
};

/**
 * Renames a state. Renaming onto an existing name replaces that state,
 * matching how renameGroup merges.
 * \return True if \c reg changed.
 */
LayerStates.renameState = function(reg, oldName, newName) {
    var st = LayerStates.findState(reg, oldName);
    if (isNull(st) || oldName===newName) {
        return false;
    }
    var existing = LayerStates.findState(reg, newName);
    if (!isNull(existing)) {
        reg.states.splice(reg.states.indexOf(existing), 1);
    }
    st.name = newName;
    return true;
};


// ---------------------------------------------------------------------
// Document side
// ---------------------------------------------------------------------

/** \return Ordered state names held in \c doc's registry. */
LayerStates.listNames = function(doc) {
    return LayerStates.stateNames(LayerGroups.readRegistry(doc));
};

/**
 * \return A record for every layer in \c doc: everything each one
 * currently is, which is what a caver asking to save a state means.
 */
LayerStates.snapshot = function(doc) {
    var flags = {};
    var ids = doc.queryAllLayers();
    for (var i=0; i<ids.length; i++) {
        var layer = doc.queryLayer(ids[i]);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        flags[layer.getName()] = LayerStates.encode(doc, layer);
    }
    return flags;
};

/**
 * Saves the current flags of every layer under \c name, replacing that
 * state if it already exists.
 */
LayerStates.capture = function(di, name) {
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    LayerStates.setState(reg, name, LayerStates.snapshot(doc));
    LayerGroups.writeRegistry(doc, reg);
};

/**
 * Applies state \c name.
 *
 * Only layers that actually change enter the operation, and a layer the
 * state holds no entry for is left exactly as it is.
 *
 * \return Number of layers changed.
 */
LayerStates.restore = function(di, name) {
    var doc = di.getDocument();
    var st = LayerStates.findState(LayerGroups.readRegistry(doc), name);
    if (isNull(st)) {
        return 0;
    }

    // NOT LayerVisibilityStatusChange any more. That transaction type
    // tells the view it may take the cheap regeneration path, which is
    // true when only on/off/lock moved and a lie now that a state can
    // change a layer's colour, linetype and lineweight -- the drawing
    // would keep the old appearance until something else forced a
    // redraw.
    var op = new RModifyObjectsOperation();

    var changed = 0;
    for (var layerName in st.flags) {
        if (!st.flags.hasOwnProperty(layerName)) {
            continue;
        }
        var layer = doc.queryLayer(layerName);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull())) {
            continue;
        }
        if (LayerStates.applyRecord(doc, layer, st.flags[layerName])) {
            op.addObject(layer);
            changed++;
        }
    }

    if (changed>0) {
        di.applyOperation(op);
        di.clearPreview();
        di.repaintViews();
    }
    return changed;
};

/** Deletes state \c name from the drawing. */
LayerStates.remove = function(di, name) {
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (LayerStates.removeState(reg, name)) {
        LayerGroups.writeRegistry(doc, reg);
    }
};

/** Renames state \c oldName to \c newName. */
LayerStates.rename = function(di, oldName, newName) {
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (LayerStates.renameState(reg, oldName, newName)) {
        LayerGroups.writeRegistry(doc, reg);
    }
};


// ---------------------------------------------------------------------
// Isolating a layer
//
// "Show me this and nothing else, and put everything back when I am
// done." Built on the records above because that is exactly what a
// record is for: the way back is not "show all layers", which would
// invent an arrangement nobody asked for, but every layer returned to
// the colour, weight, linetype and four flags it actually had.
//
// The hiding itself follows the application's own two settings, the
// same pair Layer.showHide reads, so an isolated cave looks like one
// hidden by Hide All Layers rather than like a second convention. The
// restore does not depend on that choice: it replays records.
// ---------------------------------------------------------------------

/** \return true when the drawing is isolated. */
LayerStates.isIsolated = function(doc) {
    return LayerGroups.isolatedLayers(LayerGroups.readRegistry(doc)).length>0;
};

/** \return The isolated layer names, [] when none. */
LayerStates.isolatedLayers = function(doc) {
    return LayerGroups.isolatedLayers(LayerGroups.readRegistry(doc));
};

/**
 * Hides everything except \c names and remembers how it all looked.
 *
 * REFUSES WHEN ALREADY ISOLATED. The snapshot would be of a cave that
 * is already hidden, and writing it over the record would lose the
 * caver's real arrangement silently. The palette offers Unisolate
 * instead of Isolate for the same reason; this is the half that cannot
 * be got round.
 *
 * The first named layer becomes CURRENT. Freezing the current layer is
 * the kind of thing this engine refuses quietly, and stock QCAD dodges
 * the question by only ever isolating the layer that is already
 * current -- which this cannot do, because the caver picked the row.
 *
 * \return { isolated: n, hidden: n } or null when it refused.
 */
LayerStates.isolate = function(di, names) {
    if (isNull(names) || names.length===0) {
        return null;
    }
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    if (!isNull(LayerGroups.isolation(reg))) {
        return null;
    }

    var keep = {};
    var i;
    for (i=0; i<names.length; i++) {
        keep[names[i]] = true;
    }

    // The snapshot FIRST, before a single layer moves.
    var before = LayerStates.snapshot(doc);

    var showFrozen = (typeof(Layer)!=="undefined" &&
        isFunction(Layer.getShowFrozen)) ? Layer.getShowFrozen() : false;
    var freezeLayer = (typeof(Layer)!=="undefined" &&
        isFunction(Layer.getFreezeLayer)) ? Layer.getFreezeLayer() : true;

    // The current layer moves to one of the kept ones first, so that
    // nothing below is asked to freeze the layer being drawn on.
    var currentLayer = doc.queryCurrentLayer();
    var current = (isNull(currentLayer) ||
        (isFunction(currentLayer.isNull) && currentLayer.isNull())) ? "" :
        currentLayer.getName();
    if (keep[current]!==true) {
        var target = doc.queryLayer(names[0]);
        if (!isNull(target) && !(isFunction(target.isNull) && target.isNull())) {
            di.setCurrentLayer(names[0]);
        }
    }

    var op = new RModifyObjectsOperation();
    var hidden = 0;
    var ids = doc.queryAllLayers();
    for (i=0; i<ids.length; i++) {
        var layer = doc.queryLayer(ids[i]);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull())) {
            continue;
        }
        var name = layer.getName();
        if (keep[name]===true) {
            // A kept layer is SHOWN, whatever it was. Isolating a
            // layer that was itself switched off and being handed a
            // blank drawing is not what anybody means by it.
            if (layer.isOff() || layer.isFrozen()) {
                layer.setOff(false);
                layer.setFrozen(false);
                op.addObject(layer);
            }
            continue;
        }
        if (layer.isOff() && (showFrozen || layer.isFrozen())) {
            continue;   // already hidden the way this would hide it
        }
        if (!showFrozen && freezeLayer) {
            layer.setFrozen(true);
        }
        layer.setOff(true);
        op.addObject(layer);
        hidden++;
    }

    LayerGroups.setIsolation(reg, names, before);
    LayerGroups.writeRegistry(doc, reg);

    di.applyOperation(op);
    di.clearPreview();
    di.repaintViews();
    return { isolated: names.length, hidden: hidden };
};

/**
 * Puts back what isolate hid.
 *
 * A layer made SINCE the isolation has no record and is left exactly as
 * it is -- you made it while isolated, so you are looking at it, and
 * hiding it now on the grounds that it is not in an old photograph
 * would be the wrong of the two guesses.
 *
 * A layer DELETED since is simply not there to restore. Both of those
 * are LayerStates.restore's existing tolerance; this adds nothing to
 * it.
 *
 * \return Number of layers changed, or -1 when nothing was isolated.
 */
LayerStates.unisolate = function(di) {
    var doc = di.getDocument();
    var reg = LayerGroups.readRegistry(doc);
    var iso = LayerGroups.isolation(reg);
    if (isNull(iso)) {
        return -1;
    }

    var op = new RModifyObjectsOperation();
    var changed = 0;
    for (var layerName in iso.before) {
        if (!iso.before.hasOwnProperty(layerName)) {
            continue;
        }
        var layer = doc.queryLayer(layerName);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull())) {
            continue;
        }
        if (LayerStates.applyRecord(doc, layer, iso.before[layerName])) {
            op.addObject(layer);
            changed++;
        }
    }

    // The record goes BEFORE the operation is applied, so a drawing
    // saved between the two is never one that is visually unisolated
    // but still believes it is isolated.
    LayerGroups.clearIsolation(reg);
    LayerGroups.writeRegistry(doc, reg);

    if (changed>0) {
        di.applyOperation(op);
        di.clearPreview();
        di.repaintViews();
    }
    return changed;
};

// ---------------------------------------------------------------------
// Carrying states between drawings: the .clas file.
//
// A state names every layer in the drawing it was saved from, so it is
// the one part of the arrangement a template cannot carry for you: the
// groups are a rule, but a state is a photograph. Exporting is how one
// gets from the cave you built it in to the next one.
//
// .clas IS CAVECAD'S OWN AND IS NOT AUTOCAD'S .las. It fills the same
// role -- named layer states in a file you can hand to somebody -- and
// that is the whole of the relationship. AutoCAD's .las is an INI-shaped
// list of layer properties; this is JSON, it carries only the three
// flags a state here holds, and neither program will read the other's.
// The distinct extension is the point: a file that will not open should
// say so by its name rather than by an error halfway through.
//
// JSON with an explicit layer-name -> code map, NOT the positional table
// the drawing stores. This is a file a person may open, read and edit;
// a positional format would make an innocent edit shift every flag
// after it.
// ---------------------------------------------------------------------

/** Marker in the file, so a wrong file chosen by mistake says so. */
LayerStates.FORMAT = "cavecad-layer-states";

/**
 * Bumped only for a change that an older reader would misread.
 *
 * 2 added the appearance fields. A version 1 file holds three-character
 * flag strings and is still read; a version 1 READER handed a version 2
 * file would take a record object for a code and silently apply
 * nothing, which is why the version gate refuses the newer file rather
 * than trying.
 */
LayerStates.FORMAT_VERSION = 2;

/**
 * CaveCAD Layer StateS. Deliberately one letter off AutoCAD's .las, and
 * deliberately not the same file: see the note above.
 */
LayerStates.FILE_SUFFIX = "clas";

/**
 * \return The export object for the named states, or for all of them
 * when \c names is omitted.
 *
 * \param origin Optional name of the drawing, recorded so a file found
 *        later says where it came from. Nothing reads it back.
 */
LayerStates.toExport = function(reg, names, origin) {
    var wanted = isNull(names) ? LayerStates.stateNames(reg) : names;
    var out = [];
    for (var i=0; i<wanted.length; i++) {
        var st = LayerStates.findState(reg, wanted[i]);
        if (isNull(st)) {
            continue;
        }
        // Copied rather than referenced: an export must not hand the
        // caller a live view of the registry to mutate by accident.
        var flags = {};
        for (var layerName in st.flags) {
            if (st.flags.hasOwnProperty(layerName)) {
                flags[layerName] = st.flags[layerName];
            }
        }
        out.push({ name: st.name, flags: flags });
    }
    return {
        format: LayerStates.FORMAT,
        version: LayerStates.FORMAT_VERSION,
        origin: isNull(origin) ? "" : String(origin),
        states: out
    };
};

/**
 * Parses an export file.
 *
 * \return { states: [ {name, flags} ], error: undefined } on success, or
 * { states: [], error: "..." } with a translated reason. A reason rather
 * than a thrown exception, because every caller here has a dialog to put
 * it in and none of them can do anything else with a failure.
 */
LayerStates.fromExport = function(text) {
    var fail = function(why) {
        return { states: [], error: why };
    };

    var data;
    try {
        data = JSON.parse(text);
    }
    catch (e) {
        return fail(qsTranslate("LayerStates",
            "That file is not readable as layer states."));
    }
    if (isNull(data) || typeof(data)!=="object" ||
            data.format!==LayerStates.FORMAT) {
        return fail(qsTranslate("LayerStates",
            "That file does not hold layer states."));
    }
    // A LOWER version is fine and a higher one is not: this reader knows
    // every format it is older than, and none that it is newer than.
    if (typeof(data.version)==="number" &&
            data.version>LayerStates.FORMAT_VERSION) {
        return fail(qsTranslate("LayerStates",
            "That file was written by a newer version of CaveCAD."));
    }
    if (!Array.isArray(data.states)) {
        return fail(qsTranslate("LayerStates",
            "That file holds no layer states."));
    }

    var states = [];
    for (var i=0; i<data.states.length; i++) {
        var entry = data.states[i];
        if (isNull(entry) || !LayerStates.isValidName(entry.name) ||
                isNull(entry.flags) || typeof(entry.flags)!=="object") {
            continue;
        }
        var flags = {};
        for (var layerName in entry.flags) {
            // Three characters or it is not a code. A malformed entry is
            // dropped rather than stored, so it cannot reach applyCode.
            if (!entry.flags.hasOwnProperty(layerName)) {
                continue;
            }
            var value = entry.flags[layerName];
            // An object is a record. A string is the pre-appearance
            // form, still read so a .clas written before layer states
            // carried colour keeps working.
            var record = (typeof(value)==="string") ?
                LayerStates.unpackRecord(value) :
                ((!isNull(value) && typeof(value)==="object") ? value : undefined);
            if (!isNull(record)) {
                flags[layerName] = record;
            }
        }
        states.push({ name: entry.name, flags: flags });
    }

    if (states.length===0) {
        return fail(qsTranslate("LayerStates",
            "That file holds no layer states this version can read."));
    }
    return { states: states, error: undefined };
};

/**
 * Merges imported states into \c reg, keeping only the layers this
 * drawing actually has.
 *
 * A layer the drawing does not have is DROPPED rather than remembered
 * for later: the sweep on the next read would drop it anyway, and a
 * count a caver can see beats a silent one. A layer the drawing has and
 * the state does not mention keeps whatever it is doing, which is the
 * same rule a restore already follows.
 *
 * A state whose name is already here is REPLACED. Importing the file you
 * just exported has to be a no-op rather than a way to end up with
 * "Tracing" twice.
 *
 * \return { imported, replaced, dropped, skipped } -- states written,
 * how many of those overwrote one, layer entries discarded as unknown,
 * and states discarded because nothing in them matched this drawing.
 */
LayerStates.importInto = function(reg, states, layerNames) {
    var imported = 0, replaced = 0, dropped = 0, skipped = 0;

    for (var i=0; i<states.length; i++) {
        var flags = {};
        var kept = 0;
        for (var layerName in states[i].flags) {
            if (!states[i].flags.hasOwnProperty(layerName)) {
                continue;
            }
            if (layerNames.indexOf(layerName)<0) {
                dropped++;
                continue;
            }
            flags[layerName] = states[i].flags[layerName];
            kept++;
        }

        if (kept===0) {
            // Nothing in it applies here. An empty state would look like
            // a state that does nothing rather than one that came from
            // a drawing with no layers in common.
            skipped++;
            continue;
        }

        if (!isNull(LayerStates.findState(reg, states[i].name))) {
            replaced++;
        }
        LayerStates.setState(reg, states[i].name, flags);
        imported++;
    }

    return { imported: imported, replaced: replaced,
             dropped: dropped, skipped: skipped };
};
