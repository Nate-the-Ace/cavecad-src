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
 *     {"v":2,
 *      "l":["0","CTRL-SHOTS"],                 layer name table
 *      "g":[{"n":"Plan work","m":[1]}],        groups, members by index
 *      "s":[{"n":"Plan only",                  states, one record per
 *            "r":["-----;-;-;-",                 table entry, "" for a
 *                 "11000;#ffffff;Continuous;50"]}]}   layer it omits
 *
 * Version 1 wrote a state's entries as one string of three characters
 * per table entry, when a state held nothing but off/frozen/locked. A
 * record is variable length, so version 2 uses an array instead, and
 * "c" is still read where it is found.
 *
 * The table travels inside the same blob as the indices referring to it,
 * written and read in one go, so the two cannot drift apart the way a
 * separately stored table would.
 *
 * In memory, callers see names and never indices:
 *
 *     { groups: [ { name: "Plan work", members: ["CTRL-SHOTS"],
 *                   parent: undefined } ],
 *       states: [ { name: "Plan only", flags: { "CTRL-SHOTS": "110" } } ],
 *       ungroupedLabel: undefined }
 *
 * GROUPS NEST ONE LEVEL AND NO MORE. A group may name a parent, and the
 * tree draws it inside that parent; a group whose parent itself has a
 * parent is flattened to the top on read rather than drawn three deep.
 * The cap is the point, not a shortcut -- a layer palette is a place to
 * find a switch, and arbitrary depth turns it into a filing cabinet to
 * get lost in. Names stay globally unique either way, so a group is
 * still addressed by its name alone.
 *
 * \c ungroupedLabel renames the Ungrouped row without making it a real
 * group: it takes no members of its own and is always last.
 *
 * Nothing in this file touches Qt, so it is unit tested against a plain
 * object answering getVariable/setVariable. Everything needing a widget
 * lives in RLayerTreeQt.js.
 *
 * ONE SOFT DEPENDENCY, and it points the wrong way on purpose.
 * Serializing a state's records needs LayerStates.packRecord, because
 * the record's SHAPE belongs to LayerStates while the blob's LAYOUT
 * belongs here. LayerStates.js includes this file, so this file cannot
 * include it back; it reaches for the global at call time instead and
 * skips states when it is absent. Loading LayerGroups.js alone
 * therefore gives you working groups and no states, which is a coherent
 * thing to be rather than a half-loaded one.
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

/** Placeholder for a layer a state holds no entry for, in version 1. */
LayerGroups.NO_CODE = "---";

/** The stored format this writes. Older ones are still read. */
LayerGroups.VERSION = 2;


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

/** \return A registry with no groups, no states and nothing isolated. */
LayerGroups.emptyRegistry = function() {
    return { groups: [], states: [], ungroupedLabel: undefined,
             isolation: undefined };
};

// ---------------------------------------------------------------------
// Isolation
//
// A separate thing from a layer state, deliberately. A state is a
// picture a caver NAMED and chose to keep; isolation is a temporary
// view with exactly one way out, and it would be wrong for it to turn
// up in the state list, be exportable to a .clas, or survive being
// renamed. It lives beside the states rather than among them.
//
// It is stored IN THE DRAWING because a drawing saved while isolated
// already carries every layer hidden. A memory kept per-user would not
// travel with the file, and whoever opened it next would find one
// layer showing, no record of the arrangement they had, and nothing to
// reach for but Show All Layers.
// ---------------------------------------------------------------------

/** \return {layers: [name], before: {name: record}} or undefined. */
LayerGroups.isolation = function(reg) {
    return isNull(reg) ? undefined : reg.isolation;
};

/** \return The isolated layer names, or [] when nothing is isolated. */
LayerGroups.isolatedLayers = function(reg) {
    var iso = LayerGroups.isolation(reg);
    return isNull(iso) ? [] : iso.layers.slice(0);
};

/**
 * Records that \c layers are isolated and what every layer looked like
 * beforehand.
 *
 * REFUSES A SECOND ISOLATION. Isolating again would snapshot a cave
 * that is already hidden and write that over the only record of how it
 * really looked -- the arrangement would be gone, with no error and
 * nothing to undo. The palette never offers it; this refuses it anyway,
 * because the cost of the two disagreeing is a caver's layer
 * arrangement.
 *
 * \return true when the record was written.
 */
LayerGroups.setIsolation = function(reg, layers, before) {
    if (isNull(reg) || !isNull(reg.isolation) ||
            isNull(layers) || layers.length===0) {
        return false;
    }
    reg.isolation = { layers: layers.slice(0),
                      before: isNull(before) ? {} : before };
    return true;
};

/** Forgets the isolation, leaving every layer exactly as it is now. */
LayerGroups.clearIsolation = function(reg) {
    if (isNull(reg) || isNull(reg.isolation)) {
        return false;
    }
    reg.isolation = undefined;
    return true;
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
 * Creates group \c name if it does not already exist, optionally inside
 * \c parent.
 *
 * An existing group is left where it is rather than re-parented: filing
 * into a group you already have is a filing request, not a request to
 * move it.
 *
 * \return True if the registry changed.
 */
LayerGroups.createGroup = function(reg, name, parent) {
    if (!isNull(LayerGroups.findGroup(reg, name))) {
        return false;
    }
    reg.groups.push({ name: name, members: [],
                      parent: isNull(parent) ? undefined : parent });
    return true;
};

/** \return The parent group's name, or undefined for a top level group. */
LayerGroups.parentOf = function(reg, name) {
    var g = LayerGroups.findGroup(reg, name);
    return isNull(g) ? undefined : g.parent;
};

/**
 * Moves \c name inside \c parent, or to the top level when \c parent is
 * undefined.
 *
 * Refuses to nest a group that already has children, and refuses a
 * cycle: one level is the whole contract, and a group that is its own
 * ancestor would hang the tree walk rather than look wrong.
 *
 * \return True if the registry changed.
 */
LayerGroups.setParent = function(reg, name, parent) {
    var g = LayerGroups.findGroup(reg, name);
    if (isNull(g) || name === parent) {
        return false;
    }
    if (!isNull(parent)) {
        if (isNull(LayerGroups.findGroup(reg, parent))) {
            return false;
        }
        if (!isNull(LayerGroups.parentOf(reg, parent))) {
            return false;   // would be three deep
        }
        if (LayerGroups.childrenOf(reg, name).length > 0) {
            return false;   // would be three deep the other way up
        }
    }
    if (g.parent === parent) {
        return false;
    }
    g.parent = parent;
    return true;
};

/** \return Names of the groups nested inside \c parent, in registry order. */
LayerGroups.childrenOf = function(reg, parent) {
    var res = [];
    for (var i = 0; i < reg.groups.length; i++) {
        if (reg.groups[i].parent === parent) {
            res.push(reg.groups[i].name);
        }
    }
    return res;
};

/** \return Names of the groups at the top level, in registry order. */
LayerGroups.topLevelGroups = function(reg) {
    var res = [];
    for (var i = 0; i < reg.groups.length; i++) {
        if (isNull(reg.groups[i].parent)) {
            res.push(reg.groups[i].name);
        }
    }
    return res;
};

/**
 * \return Member layer names of \c name and of every group inside it.
 *
 * What a group row's eye and lock act on, and what its three-state icon
 * is derived from: a parent with no members of its own still has to
 * answer for its children.
 */
LayerGroups.membersUnder = function(reg, name) {
    var res = LayerGroups.membersOf(reg, name).slice();
    var kids = LayerGroups.childrenOf(reg, name);
    for (var i = 0; i < kids.length; i++) {
        var inner = LayerGroups.membersOf(reg, kids[i]);
        for (var j = 0; j < inner.length; j++) {
            if (res.indexOf(inner[j]) < 0) {
                res.push(inner[j]);
            }
        }
    }
    return res;
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
    // Anything nested inside it is re-pointed first, whichever branch
    // below runs: a child left naming a group that no longer exists is
    // flattened to the top on the next read, which looks like the
    // rename moved it.
    for (var k=0; k<reg.groups.length; k++) {
        if (reg.groups[k].parent===oldName) {
            reg.groups[k].parent = newName;
        }
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
    // Groups nested inside it move up rather than going with it. Losing
    // a shelf should not lose what was on it, and the alternative is a
    // delete whose blast radius is invisible until it has happened.
    for (var i = 0; i < reg.groups.length; i++) {
        if (reg.groups[i].parent === name) {
            reg.groups[i].parent = undefined;
        }
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

    if (!isNull(reg.isolation)) {
        for (var b in reg.isolation.before) {
            if (reg.isolation.before.hasOwnProperty(b) &&
                    layerNames.indexOf(b)<0) {
                delete reg.isolation.before[b];
                dropped = true;
            }
        }
        var live = [];
        for (i=0; i<reg.isolation.layers.length; i++) {
            if (layerNames.indexOf(reg.isolation.layers[i])>=0) {
                live.push(reg.isolation.layers[i]);
            }
        }
        if (live.length!==reg.isolation.layers.length) {
            dropped = true;
            // DELETING THE ISOLATED LAYER ENDS THE ISOLATION, rather
            // than leaving a mode whose Unisolate entry names a layer
            // that is gone. The records the other layers need are
            // still here, so the caller unisolates with them first --
            // see LayerStates.unisolate, which reads the record before
            // anything sweeps it.
            reg.isolation = (live.length===0) ? undefined :
                { layers: live, before: reg.isolation.before };
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
        var entry = { n: reg.groups[i].name, m: members };
        if (!isNull(reg.groups[i].parent)) {
            entry.p = reg.groups[i].parent;
        }
        groups.push(entry);
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

    // The isolation's records are positional over the SAME table, so
    // every layer it remembers has to be in the table before any of
    // the strings below are laid out. Left out, an isolation in a
    // drawing with no groups kept a record for the isolated layer
    // alone -- the table held nothing else -- and unisolating restored
    // nothing at all while reporting success.
    if (!isNull(reg.isolation)) {
        for (key in reg.isolation.before) {
            if (reg.isolation.before.hasOwnProperty(key)) {
                indexOf(key);
            }
        }
    }

    var states = [];
    var canPackStates = (typeof(LayerStates)!=="undefined");
    for (i=0; canPackStates && i<reg.states.length; i++) {
        var records = [];
        for (j=0; j<table.length; j++) {
            var record = reg.states[i].flags[table[j]];
            // An empty string, not a placeholder token: a record is
            // variable length and the array is what carries position.
            records.push(isNull(record) ? "" : LayerStates.packRecord(record));
        }
        states.push({ n: reg.states[i].name, r: records });
    }

    var out = { v: LayerGroups.VERSION, l: table, g: groups, s: states };
    if (!isNull(reg.ungroupedLabel)) {
        out.u = reg.ungroupedLabel;
    }

    // ISOLATION RIDES IN THE DRAWING, for the reason the accessors
    // below give: a drawing saved while isolated has every layer
    // hidden in the DXF itself, and the way back must travel with it.
    //
    // NO VERSION BUMP. decode reads by key, so a v2 blob simply has no
    // "i" and an older CaveCAD ignores the one it does not know. The
    // cost is that such a build cannot unisolate and has to reach for
    // Show All Layers; the alternative is a format break that stops
    // those builds reading the groups at all, which is worse.
    if (!isNull(reg.isolation) && canPackStates) {
        var isoNames = [];
        for (i=0; i<reg.isolation.layers.length; i++) {
            isoNames.push(indexOf(reg.isolation.layers[i]));
        }
        var isoRecords = [];
        for (j=0; j<table.length; j++) {
            var before = reg.isolation.before[table[j]];
            isoRecords.push(isNull(before) ? "" :
                LayerStates.packRecord(before));
        }
        out.i = { n: isoNames, r: isoRecords };
    }
    return out;
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
        reg.groups.push({
            name: groups[i].n,
            members: members,
            parent: (typeof(groups[i].p)==="string") ? groups[i].p : undefined
        });
    }

    // One level and no more. A parent that does not exist, a group that
    // is its own parent, and a parent that is itself nested all resolve
    // the same way -- the group comes back to the top -- so a blob
    // written by a future version, or edited by hand, opens as something
    // sane instead of hanging the tree walk.
    for (i=0; i<reg.groups.length; i++) {
        var parent = reg.groups[i].parent;
        if (isNull(parent)) {
            continue;
        }
        var up = LayerGroups.findGroup(reg, parent);
        if (isNull(up) || up===reg.groups[i] || !isNull(up.parent)) {
            reg.groups[i].parent = undefined;
        }
    }

    var states = (Array.isArray(stored.s) && typeof(LayerStates)!=="undefined") ?
        stored.s : [];
    for (i=0; i<states.length; i++) {
        if (isNull(states[i]) || typeof(states[i].n)!=="string") {
            continue;
        }
        var flags = {};
        if (Array.isArray(states[i].r)) {
            // Version 2: one packed record per table entry.
            for (j=0; j<table.length && j<states[i].r.length; j++) {
                var packed = states[i].r[j];
                if (typeof(packed)!=="string" || packed.length===0) {
                    continue;
                }
                var record = LayerStates.unpackRecord(packed);
                if (!isNull(record)) {
                    flags[table[j]] = record;
                }
            }
        }
        else if (typeof(states[i].c)==="string") {
            // Version 1: three characters per table entry, flags only.
            for (j=0; j<table.length; j++) {
                var code = states[i].c.substr(j*3, 3);
                if (code.length===3 && code!==LayerGroups.NO_CODE) {
                    flags[table[j]] = LayerStates.unpackRecord(code);
                }
            }
        }
        reg.states.push({ name: states[i].n, flags: flags });
    }

    if (typeof(stored.u)==="string" && stored.u.length>0) {
        reg.ungroupedLabel = stored.u;
    }

    // Isolation. Read last and guarded the same way the states are: a
    // blob whose "i" is malformed opens as a drawing that is simply
    // not isolated, which is recoverable, rather than throwing on the
    // way in.
    if (!isNull(stored.i) && typeof(stored.i)==="object" &&
            typeof(LayerStates)!=="undefined") {
        var isoLayers = [];
        var n = Array.isArray(stored.i.n) ? stored.i.n : [];
        for (i=0; i<n.length; i++) {
            if (n[i]>=0 && n[i]<table.length &&
                    isoLayers.indexOf(table[n[i]])<0) {
                isoLayers.push(table[n[i]]);
            }
        }
        var before = {};
        var r = Array.isArray(stored.i.r) ? stored.i.r : [];
        for (j=0; j<table.length && j<r.length; j++) {
            if (typeof(r[j])!=="string" || r[j].length===0) {
                continue;
            }
            var rec = LayerStates.unpackRecord(r[j]);
            if (!isNull(rec)) {
                before[table[j]] = rec;
            }
        }
        // ISOLATED BY NOTHING IS NOT ISOLATED. A record naming no
        // layer would put the palette in a mode whose only exit is an
        // Unisolate entry with no name in it.
        if (isoLayers.length>0) {
            reg.isolation = { layers: isoLayers, before: before };
        }
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
