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
 * \brief Named snapshots of every layer's off / frozen / locked flags.
 *
 * Stored in the same document blob the groups live in, for the same
 * reason: layer custom properties are dropped by the DXF exporter. See
 * the header of LayerGroups.js for the measurement.
 *
 * A state's entry for one layer is three characters, in this order: off,
 * frozen, locked.
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
// Flag codes
// ---------------------------------------------------------------------

/** \return \c layer's current flags as a three character code. */
LayerStates.encode = function(layer) {
    return String(Number(layer.isOff())) +
           String(Number(layer.isFrozen())) +
           String(Number(layer.isLocked()));
};

/**
 * Applies \c code to \c layer. Mutates the layer only; the caller owns
 * the operation.
 *
 * NOT named apply(). LayerStates is a function object, and Function
 * carries its own apply: assigning over it does not take, so the call
 * lands in Function.prototype.apply and dies with a bare "TypeError:
 * Type error" that names nothing. Cost one live debugging session.
 * The same trap waits on call, bind and name.
 *
 * \return True if any flag changed, so the caller can skip layers that
 * are already right and keep the transaction small.
 */
LayerStates.applyCode = function(layer, code) {
    if (isNull(code) || String(code).length<3) {
        return false;
    }
    code = String(code);
    var off = code.charAt(0)==="1";
    var frozen = code.charAt(1)==="1";
    var locked = code.charAt(2)==="1";

    if (layer.isOff()===off && layer.isFrozen()===frozen && layer.isLocked()===locked) {
        return false;
    }
    layer.setOff(off);
    layer.setFrozen(frozen);
    layer.setLocked(locked);
    return true;
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
 * \return \c layerName's code in state \c name, or undefined if the
 * state holds no entry for it.
 *
 * Undefined is the meaningful case, not an error: a layer created after
 * the state was saved has no entry, and a restore must leave it alone.
 * Guessing a default here is how an elevation datum gets rebased to zero.
 */
LayerStates.getCode = function(reg, name, layerName) {
    var st = LayerStates.findState(reg, name);
    if (isNull(st)) {
        return undefined;
    }
    var code = st.flags[layerName];
    return (isNull(code) || String(code).length<3) ? undefined : String(code);
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

/** \return A flags map of every layer in \c doc and its current code. */
LayerStates.snapshot = function(doc) {
    var flags = {};
    var ids = doc.queryAllLayers();
    for (var i=0; i<ids.length; i++) {
        var layer = doc.queryLayer(ids[i]);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        flags[layer.getName()] = LayerStates.encode(layer);
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

    var op = new RModifyObjectsOperation();
    // Only visibility flags change: lets the view regenerate the cheap way.
    op.setTransactionType(RTransaction.LayerVisibilityStatusChange);

    var changed = 0;
    for (var layerName in st.flags) {
        if (!st.flags.hasOwnProperty(layerName)) {
            continue;
        }
        var layer = doc.queryLayer(layerName);
        if (isNull(layer) || (isFunction(layer.isNull) && layer.isNull())) {
            continue;
        }
        if (LayerStates.applyCode(layer, st.flags[layerName])) {
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
