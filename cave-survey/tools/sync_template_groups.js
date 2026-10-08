// sync_template_groups.js -- idempotent: gives the shipped PLAN template
// the Layer Manager groups CsLayerGroups describes.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/sync_template_groups.js "$PWD"
//
// The sibling of sync_template_layers.js, and the same bargain: the
// registry in Core is the source of truth and the template is brought to
// match it, so the two cannot drift. A new drawing then opens with its
// layers already filed, without anybody running Group Layers first.
//
// Carries only the QUESTION of which group, never the arrangement
// itself. CsLayerGroups.classify is the one place that answers it --
// GroupLayers calls the same function on a caver's own drawing -- and
// tests/test_addon.py asserts the template's stored groups are exactly
// what classify produces for the template's layers. A hand-edited
// template fails that test rather than quietly shipping a scheme nobody
// can reproduce.
//
// THE STORE BELONGS TO CAVECAD. Group membership lives in the Layer
// Manager's own document registry (LayerGroups, in the fork's
// scripts/Widgets/LayerManager), which is loaded here from the
// application rather than reimplemented: a second copy of the chunking
// is a second thing to get wrong, and the chunking is what keeps the
// blob under dxflib's 1024-character line limit.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var core = repoRoot + "/scripts/CaveSurvey/Core";

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isFunction === "undefined") {
    isFunction = function(v) { return typeof v === "function"; };
}

includeBasePath = core;
include(core + "/CsLayers.js");
include(core + "/CsLayerGroups.js");

/**
 * The Layer Manager's group model, from whichever copy of the palette
 * this build is running.
 *
 * Already loaded when the palette is installed, which is the normal
 * case. Otherwise try both places an add-on can live: the application
 * bundle and the per-user scripts folder. A rooted include() resolves
 * only against the bundle, so the per-user path has to be spelled out.
 */
function layerGroupsModel() {
    if (typeof LayerGroups === "undefined" || typeof LayerStates === "undefined") {
        var roots = [
            "scripts/Widgets/LayerManager/",
            RSettings.getDataLocation() + "/scripts/Widgets/LayerManager/"
        ];
        for (var i = 0; i < roots.length; i++) {
            try {
                include(roots[i] + "LayerGroups.js");
                include(roots[i] + "LayerStates.js");
            } catch (e) {
                // include() logs its own "not found"; try the next place.
            }
            if (typeof LayerGroups !== "undefined" &&
                    typeof LayerStates !== "undefined") {
                break;
            }
        }
    }
    if (typeof LayerGroups === "undefined" || typeof LayerStates === "undefined") {
        return undefined;
    }
    return LayerGroups;
}

function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";   // no dxflib writer in this build; let the registry choose
}

/**
 * \return true if \c reg already holds exactly \c wanted -- same groups,
 * same order, same members in the same order.
 *
 * Compared rather than always written, so a run that changes nothing
 * leaves the template's bytes alone and publish.sh does not archive a
 * template that differs only by a rewrite.
 */
function sameAs(model, reg, wanted, states) {
    var names = model.groupNames(reg);
    if (names.length !== wanted.length) {
        return false;
    }
    var i, j;
    for (i = 0; i < wanted.length; i++) {
        if (names[i] !== wanted[i].name) {
            return false;
        }
        if (model.parentOf(reg, wanted[i].name) !== wanted[i].parent) {
            return false;
        }
        var have = model.membersOf(reg, wanted[i].name);
        if (have.length !== wanted[i].members.length) {
            return false;
        }
        for (j = 0; j < have.length; j++) {
            if (have[j] !== wanted[i].members[j]) {
                return false;
            }
        }
    }

    var stateNames = LayerStates.stateNames(reg);
    if (stateNames.length !== CsLayerGroups.STATES.length) {
        return false;
    }
    for (i = 0; i < CsLayerGroups.STATES.length; i++) {
        var stateName = CsLayerGroups.STATES[i];
        if (stateNames[i] !== stateName) {
            return false;
        }
        var wantFlags = states[stateName];
        for (var layerName in wantFlags) {
            if (!wantFlags.hasOwnProperty(layerName)) {
                continue;
            }
            // Compared through the packed form: two records are the
            // same when they store the same, and object identity says
            // nothing useful here.
            var have = LayerStates.getRecord(reg, stateName, layerName);
            if (isNull(have) ||
                    LayerStates.packRecord(have) !==
                        LayerStates.packRecord(wantFlags[layerName])) {
                return false;
            }
        }
    }
    return true;
}

function syncGroups(path) {
    var model = layerGroupsModel();
    if (model === undefined) {
        print("FAIL  this build has no Layer Manager palette, so there " +
            "is no group store to write into");
        return false;
    }

    // RSpatialIndexNavel directly, as sync_template_layers.js does:
    // createSpatialIndex lives in library.js, which a bare -autostart
    // context has not loaded.
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    // The template's own layers, sorted, so the stored member order is
    // the order the palette shows and a re-run never reshuffles it.
    var names = model.layerNamesOf(doc).sort();
    if (names.length < 20) {
        print("FAIL  the template yielded only " + names.length +
            " layer(s) -- it did not read");
        return false;
    }

    var planned = CsLayerGroups.plan(names);
    var parents = CsLayerGroups.PARENTS();
    var wanted = [];
    var i;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        var group = CsLayerGroups.GROUPS[i];
        wanted.push({ name: group, members: planned[group],
                      parent: parents[group] });
    }
    var states = CsLayerGroups.templateStates(names);

    var reg = model.readRegistry(doc);
    if (sameAs(model, reg, wanted, states)) {
        print("skip  " + path + " -- groups already match CsLayerGroups");
        return true;
    }

    // Rebuilt rather than merged: this file's whole job is to make the
    // template say what CsLayerGroups says, and a merge would preserve a
    // hand-edit that the agreement test is there to catch.
    var fresh = model.emptyRegistry();
    var filed = 0;
    for (i = 0; i < wanted.length; i++) {
        model.createGroup(fresh, wanted[i].name, wanted[i].parent);
        for (var j = 0; j < wanted[i].members.length; j++) {
            model.addTo(fresh, wanted[i].members[j], wanted[i].name);
            filed++;
        }
    }

    // The two states a cave map alternates between. Shipped because an
    // empty state combo teaches nothing about what states are for, and
    // because these two are the same pair every drawing needs. A caver's
    // own states are added beside them and never touched by this tool --
    // which only ever writes the template, never a real drawing.
    for (i = 0; i < CsLayerGroups.STATES.length; i++) {
        LayerStates.setState(fresh, CsLayerGroups.STATES[i],
            states[CsLayerGroups.STATES[i]]);
    }

    model.writeRegistry(doc, fresh);

    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }

    print("ok    " + path + " -- " + wanted.length + " group(s), " +
        filed + " of " + names.length + " layers filed, " +
        CsLayerGroups.STATES.length + " state(s)");
    for (i = 0; i < wanted.length; i++) {
        print("      " + (isNull(wanted[i].parent) ? "" : "  ") +
            wanted[i].name + ": " + wanted[i].members.length);
    }
    return true;
}

var ok = syncGroups(repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf");

if (!ok) {
    print("### SYNC TEMPLATE GROUPS FAIL");
} else {
    print("### SYNC TEMPLATE GROUPS OK");
}
