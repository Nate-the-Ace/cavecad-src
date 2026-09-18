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

/**
 * \class LayerGroups
 * \brief The Layer Manager's stored model: which layers are in which
 * group, and what each named layer state holds. Pure data.
 *
 * EVERYTHING LIVES IN ONE DOCUMENT-LEVEL BLOB, and that is a measurement,
 * not a preference. The obvious design puts a layer's memberships on the
 * layer itself, in custom properties, so that deleting a layer deletes
 * them with it and no repair pass is ever needed. That design does not
 * survive a save: RDxfExporter::writeLayer (RDxfExporter.cpp:630) writes
 * a layer's name, flags, colour, lineweight and linetype and nothing
 * else, so layer XDATA never reaches the file. Measured 2026-09-16 --
 * exported a drawing with two groups filed, re-imported it, and read the
 * memberships back as empty while the document variables came through
 * untouched.
 *
 * So the blob carries it all, and the price is a sweep: a layer renamed
 * or deleted outside this palette leaves its name behind in a group. The
 * sweep runs on READ, against the document's real layer names, so a stale
 * entry never reaches the tree and there is no repair command to forget
 * to run.
 *
 * Stored shape, deliberately terse because it is written into a DXF:
 *
 *     {"v":1,
 *      "l":["0","CTRL-SHOTS"],                 layer name table
 *      "g":[{"n":"Plan work","m":[1]}],        groups, members by index
 *      "s":[{"n":"Plan only","c":"000110"}]}   states, 3 chars per index
 *
 * The table travels inside the same blob as the indices referring to it,
 * written and read in one go, so the two cannot drift apart the way a
 * separately stored table would.
 *
 * In memory, callers see names and never indices:
 *
 *     { groups: [ { name: "Plan work", members: ["CTRL-SHOTS"] } ],
 *       states: [ { name: "Plan only", flags: { "CTRL-SHOTS": "110" } } ] }
 *
 * Nothing in this file touches Qt, so it is unit tested against a plain
 * object answering getVariable/setVariable. Everything needing a widget
 * lives in RLayerTreeQt.js.
 */
function LayerGroups() {
}

/**
 * Separator used where several group names share one string -- the
 * settings key for collapsed groups, and nothing else. Group names may
 * not contain it; see isValidName.
 */
LayerGroups.SEP = "|";

/** Document variable prefix for the chunked blob. */
LayerGroups.VAR = "CaveCADLayerManager";

/**
 * Maximum characters per chunk.
 *
 * RDxfExporter writes document variables as XRecords into the
 * QCAD_OBJECTS section (RDxfExporter.cpp:409). dxflib's READER dies at
 * 1024 characters on one line, and a line past it desynchronises the
 * parser, which then silently drops the remainder of that section -- the
 * bug that made image xrefs vanish on save. This blob holds every layer
 * name a group or state mentions, so on a real cave it is guaranteed to
 * pass the limit; chunking is the only thing between it and a bricked
 * file. 800 leaves room for the key and the DXF group codes sharing the
 * line.
 */
LayerGroups.CHUNK = 800;

/** Longest accepted group or state name. */
LayerGroups.MAX_NAME = 64;

/** Placeholder for a layer a state holds no entry for. */
LayerGroups.NO_CODE = "---";


// ---------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------

/**
 * \return True if \c name is usable as a group or state name.
 *
 * The separator is rejected rather than escaped: an escape scheme is a
 * lot of machinery to let someone type a pipe into a group name.
 */
LayerGroups.isValidName = function(name) {
    if (typeof(name)!=="string") {
        return false;
    }
    var trimmed = name.trim();
    if (trimmed.length===0 || trimmed.length>LayerGroups.MAX_NAME) {
        return false;
    }
    return trimmed.indexOf(LayerGroups.SEP)<0;
};

/**
 * \return Why \c name was rejected, as a translated string, or undefined
 * if it is valid. The dialogs show this instead of inventing their own
 * wording.
 */
LayerGroups.nameError = function(name) {
    if (typeof(name)!=="string" || name.trim().length===0) {
        return qsTranslate("LayerGroups", "The name cannot be empty.");
    }
    if (name.trim().length>LayerGroups.MAX_NAME) {
        return qsTranslate("LayerGroups", "The name is too long.");
    }
    if (name.indexOf(LayerGroups.SEP)>=0) {
        // Concatenated rather than built with QString.arg: this function
        // is unit tested outside Qt, and .arg lives on QString, not on a
        // JS string.
        return qsTranslate("LayerGroups", "The name cannot contain this character:") +
               " " + LayerGroups.SEP;
    }
    return undefined;
};


// ---------------------------------------------------------------------
// The registry in memory
// ---------------------------------------------------------------------

/** \return A registry with no groups and no states. */
LayerGroups.emptyRegistry = function() {
    return { groups: [], states: [] };
};

/** \return Ordered group names. */
LayerGroups.groupNames = function(reg) {
    var res = [];
    for (var i=0; i<reg.groups.length; i++) {
        res.push(reg.groups[i].name);
    }
    return res;
};

/** \return The group entry named \c name, or undefined. */
LayerGroups.findGroup = function(reg, name) {
    for (var i=0; i<reg.groups.length; i++) {
        if (reg.groups[i].name===name) {
            return reg.groups[i];
        }
    }
    return undefined;
};

/** \return Member layer names of group \c name; empty if no such group. */
LayerGroups.membersOf = function(reg, name) {
    var g = LayerGroups.findGroup(reg, name);
    return isNull(g) ? [] : g.members;
};

/** \return Names of the groups \c layerName belongs to, in registry order. */
LayerGroups.groupsOfLayer = function(reg, layerName) {
    var res = [];
    for (var i=0; i<reg.groups.length; i++) {
        if (reg.groups[i].members.indexOf(layerName)>=0) {
            res.push(reg.groups[i].name);
        }
    }
    return res;
};

/**
 * Creates group \c name if it does not already exist.
 * \return True if the registry changed.
 */
LayerGroups.createGroup = function(reg, name) {
    if (!isNull(LayerGroups.findGroup(reg, name))) {
        return false;
    }
    reg.groups.push({ name: name, members: [] });
    return true;
};

/**
 * Files \c layerName into group \c name, creating the group if needed.
 * \return True if the registry changed.
 */
LayerGroups.addTo = function(reg, layerName, name) {
    LayerGroups.createGroup(reg, name);
    var g = LayerGroups.findGroup(reg, name);
    if (g.members.indexOf(layerName)>=0) {
        return false;
    }
    g.members.push(layerName);
    return true;
};

/**
 * Removes \c layerName from group \c name. The group itself stays, empty.
 * \return True if the registry changed.
 */
LayerGroups.removeFrom = function(reg, layerName, name) {
    var g = LayerGroups.findGroup(reg, name);
    if (isNull(g)) {
        return false;
    }
    var idx = g.members.indexOf(layerName);
    if (idx<0) {
        return false;
    }
    g.members.splice(idx, 1);
    return true;
};

/**
 * Renames a group. Renaming onto a name that already exists merges the
 * two rather than leaving two rows with one name in the tree.
 * \return True if the registry changed.
 */
LayerGroups.renameGroup = function(reg, oldName, newName) {
    var g = LayerGroups.findGroup(reg, oldName);
    if (isNull(g) || oldName===newName) {
        return false;
    }
    var target = LayerGroups.findGroup(reg, newName);
    if (isNull(target)) {
        g.name = newName;
        return true;
    }
    for (var i=0; i<g.members.length; i++) {
        if (target.members.indexOf(g.members[i])<0) {
            target.members.push(g.members[i]);
        }
    }
    reg.groups.splice(reg.groups.indexOf(g), 1);
    return true;
};

/**
 * Deletes a group. Its members are untouched -- they are layer names, and
 * no layer is ever deleted from here.
 * \return True if the registry changed.
 */
LayerGroups.deleteGroup = function(reg, name) {
    var g = LayerGroups.findGroup(reg, name);
    if (isNull(g)) {
        return false;
    }
    reg.groups.splice(reg.groups.indexOf(g), 1);
    return true;
};

/**
 * Drops every layer name the document no longer has, from every group
 * and every state.
 *
 * Runs on read rather than as a repair command: a layer deleted or
 * renamed through QCAD's own layer list never tells this palette, so the
 * only reliable moment to notice is when the names are next read against
 * a real document.
 *
 * \param layerNames Every layer name currently in the document.
 * \return True if anything was dropped.
 */
LayerGroups.sweep = function(reg, layerNames) {
    var dropped = false;
    var i, j;

    for (i=0; i<reg.groups.length; i++) {
        var members = reg.groups[i].members;
        for (j=members.length-1; j>=0; j--) {
            if (layerNames.indexOf(members[j])<0) {
                members.splice(j, 1);
                dropped = true;
            }
        }
    }

    for (i=0; i<reg.states.length; i++) {
        var flags = reg.states[i].flags;
        for (var key in flags) {
            if (flags.hasOwnProperty(key) && layerNames.indexOf(key)<0) {
                delete flags[key];
                dropped = true;
            }
        }
    }

    return dropped;
};


// ---------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------

/**
 * \return The stored form of \c reg: a layer name table plus groups and
 * states referring into it by index.
 */
LayerGroups.encode = function(reg) {
    var table = [];
    var indexOf = function(name) {
        var at = table.indexOf(name);
        if (at<0) {
            at = table.length;
            table.push(name);
        }
        return at;
    };

    var i, j, key;

    var groups = [];
    for (i=0; i<reg.groups.length; i++) {
        var members = [];
        for (j=0; j<reg.groups[i].members.length; j++) {
            members.push(indexOf(reg.groups[i].members[j]));
        }
        groups.push({ n: reg.groups[i].name, m: members });
    }

    // Every layer a state mentions has to be in the table BEFORE any code
    // string is laid out, because the strings are positional and must all
    // describe the same table.
    for (i=0; i<reg.states.length; i++) {
        for (key in reg.states[i].flags) {
            if (reg.states[i].flags.hasOwnProperty(key)) {
                indexOf(key);
            }
        }
    }

    var states = [];
    for (i=0; i<reg.states.length; i++) {
        var codes = "";
        for (j=0; j<table.length; j++) {
            var code = reg.states[i].flags[table[j]];
            codes += isNull(code) ? LayerGroups.NO_CODE : code;
        }
        states.push({ n: reg.states[i].name, c: codes });
    }

    return { v: 1, l: table, g: groups, s: states };
};

/** \return \c stored turned back into the in-memory form. */
LayerGroups.decode = function(stored) {
    var reg = LayerGroups.emptyRegistry();
    if (isNull(stored) || typeof(stored)!=="object") {
        return reg;
    }

    var table = Array.isArray(stored.l) ? stored.l : [];
    var i, j;

    var groups = Array.isArray(stored.g) ? stored.g : [];
    for (i=0; i<groups.length; i++) {
        if (isNull(groups[i]) || typeof(groups[i].n)!=="string") {
            continue;
        }
        var members = [];
        var m = Array.isArray(groups[i].m) ? groups[i].m : [];
        for (j=0; j<m.length; j++) {
            var at = m[j];
            // An index past the table is a corrupt blob, not a layer.
            if (at>=0 && at<table.length && members.indexOf(table[at])<0) {
                members.push(table[at]);
            }
        }
        reg.groups.push({ name: groups[i].n, members: members });
    }

    var states = Array.isArray(stored.s) ? stored.s : [];
    for (i=0; i<states.length; i++) {
        if (isNull(states[i]) || typeof(states[i].n)!=="string") {
            continue;
        }
        var codes = typeof(states[i].c)==="string" ? states[i].c : "";
        var flags = {};
        for (j=0; j<table.length; j++) {
            var code = codes.substr(j*3, 3);
            if (code.length===3 && code!==LayerGroups.NO_CODE) {
                flags[table[j]] = code;
            }
        }
        reg.states.push({ name: states[i].n, flags: flags });
    }

    return reg;
};

/**
 * Splits the serialized registry into chunks short enough to survive the
 * DXF round trip. \return Array of strings, possibly empty.
 */
LayerGroups.serialize = function(reg) {
    var json = JSON.stringify(LayerGroups.encode(reg));
    var chunks = [];
    for (var i=0; i<json.length; i+=LayerGroups.CHUNK) {
        chunks.push(json.substring(i, i+LayerGroups.CHUNK));
    }
    return chunks;
};

/**
 * Reassembles chunks produced by serialize().
 *
 * A blob that will not parse yields an empty registry rather than an
 * exception: a drawing whose registry was truncated by some other tool
 * must still open, with its groups lost but its layers intact.
 */
LayerGroups.deserialize = function(chunks) {
    if (isNull(chunks) || chunks.length===0) {
        return LayerGroups.emptyRegistry();
    }
    try {
        return LayerGroups.decode(JSON.parse(chunks.join("")));
    }
    catch (e) {
        return LayerGroups.emptyRegistry();
    }
};


// ---------------------------------------------------------------------
// Document I/O
// ---------------------------------------------------------------------

/** \return Every layer name in \c doc. */
LayerGroups.layerNamesOf = function(doc) {
    var names = [];
    var ids = doc.queryAllLayers();
    for (var i=0; i<ids.length; i++) {
        var layer = doc.queryLayer(ids[i]);
        if (isFunction(layer.isNull) && layer.isNull()) {
            continue;
        }
        names.push(layer.getName());
    }
    return names;
};

/**
 * Reads the registry from \c doc, swept against the document's real layer
 * names.
 *
 * The sweep is not written back. A read is not the place to modify a
 * document, and leaving stale names in the file costs nothing -- they are
 * invisible, and the next write drops them.
 */
LayerGroups.readRegistry = function(doc) {
    if (isNull(doc)) {
        return LayerGroups.emptyRegistry();
    }

    var count = parseInt(doc.getVariable(LayerGroups.VAR + "Count", 0), 10);
    if (isNaN(count) || count<=0) {
        return LayerGroups.emptyRegistry();
    }

    var chunks = [];
    for (var i=0; i<count; i++) {
        var c = doc.getVariable(LayerGroups.VAR + i, "");
        chunks.push(isNull(c) ? "" : String(c));
    }
    var reg = LayerGroups.deserialize(chunks);

    if (isFunction(doc.queryAllLayers)) {
        LayerGroups.sweep(reg, LayerGroups.layerNamesOf(doc));
    }
    return reg;
};

/**
 * Writes \c reg to \c doc, removing any chunks left over from a longer
 * previous registry.
 *
 * Document variables are not transactional: a group change is not on the
 * undo stack, and nothing marks the document modified on its own. The
 * modified flag is set here. The undo gap is accepted -- filing a layer
 * into a group changes no geometry, and an undo that silently unfiled it
 * would be the more surprising of the two behaviours.
 */
LayerGroups.writeRegistry = function(doc, reg) {
    if (isNull(doc)) {
        return;
    }

    var previous = parseInt(doc.getVariable(LayerGroups.VAR + "Count", 0), 10);
    if (isNaN(previous) || previous<0) {
        previous = 0;
    }

    var chunks = LayerGroups.serialize(reg);
    for (var i=0; i<chunks.length; i++) {
        doc.setVariable(LayerGroups.VAR + i, chunks[i]);
    }
    for (var j=chunks.length; j<previous; j++) {
        doc.removeVariable(LayerGroups.VAR + j);
    }
    doc.setVariable(LayerGroups.VAR + "Count", chunks.length);

    doc.setModified(true);
};
