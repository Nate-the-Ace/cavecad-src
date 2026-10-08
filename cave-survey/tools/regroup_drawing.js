// regroup_drawing.js -- rebuild one drawing's Layer Manager groups from
// the current CsLayerGroups scheme.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/regroup_drawing.js "/path/to/Cave.dxf"
//
// The counterpart to tools/sync_template_groups.js, for a drawing that
// already exists. Repair Drawing's filing pass ADDS and never takes
// away, which is right for a caver's own arrangement and wrong for
// "move this cave onto the current default": a drawing grouped under an
// older scheme would end up carrying both, seventeen rows where there
// should be six.
//
// So this REPLACES the groups and is deliberately not in a menu. It is
// the tool you reach for once, knowingly, from a terminal, after taking
// a copy -- which it does not do for you, because a backup this script
// wrote is a backup nobody looked at.
//
// A CAVER'S LAYER STATES ARE NEVER TOUCHED. States and groups are
// separate things that happen to share one blob, and every state
// already in the drawing survives a regroup exactly as it was. The one
// thing this adds is the pair the template ships -- Tracing and Plot
// ready -- and only when the drawing has neither, because a cave made
// before the template carried them has none and nothing else would
// ever give it any.

var args = RSettings.getOriginalArguments();
var target = args[args.length - 1];

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

// The Core library, from the installed add-on rather than a repo
// checkout: this tool is run against a real drawing, and the scheme it
// should apply is the one the application is actually running.
var core = RSettings.getDataLocation() + "/scripts/CaveSurvey/Core";
includeBasePath = core;
include(core + "/CsLayers.js");
include(core + "/CsLayerGroups.js");

var lmBase = RSettings.getDataLocation() + "/scripts/Widgets/LayerManager/";
if (typeof LayerGroups === "undefined") {
    include(lmBase + "LayerGroups.js");
}
if (typeof LayerStates === "undefined") {
    include(lmBase + "LayerStates.js");
}

function dxfLibFilter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        if (String(filters[i]).indexOf("dxflib") >= 0) {
            return filters[i];
        }
    }
    return "";
}

function regroup(path) {
    if (typeof LayerGroups === "undefined") {
        print("FAIL  this build has no Layer Manager palette");
        return false;
    }
    if (!new QFileInfo(path).exists()) {
        print("FAIL  no such file: " + path);
        return false;
    }

    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var names = LayerGroups.layerNamesOf(doc).sort();
    if (names.length < 20) {
        print("FAIL  only " + names.length + " layer(s) read -- that is not a cave");
        return false;
    }

    var before = LayerGroups.readRegistry(doc);
    var hadGroups = LayerGroups.groupNames(before);
    var hadStates = LayerStates.stateNames(before);

    // Rebuilt from empty, then the states put back verbatim. Merging
    // would keep whatever the old scheme called things, which is the
    // one outcome this tool exists to avoid.
    var reg = LayerGroups.emptyRegistry();
    reg.states = before.states;
    reg.ungroupedLabel = before.ungroupedLabel;

    // A drawing older than the shipped states has none, and nothing
    // else would ever give it any. Only the missing ones, never over
    // the top of a caver's own.
    var seeded = CsLayerGroups.seedStates(reg, names);

    var parents = CsLayerGroups.PARENTS();
    var i;
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        var group = CsLayerGroups.GROUPS[i];
        LayerGroups.createGroup(reg, group, parents[group]);
    }
    var filed = 0;
    for (i = 0; i < names.length; i++) {
        if (LayerGroups.addTo(reg, names[i], CsLayerGroups.classify(names[i]))) {
            filed++;
        }
    }

    LayerGroups.writeRegistry(doc, reg);
    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }

    print("ok    " + path);
    print("      was:   " + (hadGroups.length === 0 ? "(no groups)" :
        hadGroups.join(", ")));
    print("      now:   " + filed + " of " + names.length + " layers in " +
        CsLayerGroups.GROUPS.length + " groups");
    for (i = 0; i < CsLayerGroups.GROUPS.length; i++) {
        var g = CsLayerGroups.GROUPS[i];
        print("        " + (isNull(parents[g]) ? "" : "  ") + g + ": " +
            LayerGroups.membersOf(reg, g).length);
    }
    print("      states kept: " + (hadStates.length === 0 ? "(none)" :
        hadStates.join(", ")) +
        (seeded > 0 ? ", " + seeded + " seeded" : ""));
    return true;
}

if (!regroup(target)) {
    print("### REGROUP FAIL");
} else {
    print("### REGROUP OK");
}
