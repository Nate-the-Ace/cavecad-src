// sync_template_layers.js -- idempotent: gives the shipped PLAN
// template every layer the layer registry names.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/sync_template_layers.js "$PWD"
//
// One template, because there is only one: the elevation is drawn INTO
// the plan drawing, so a drawing started from templates/
// NSS_Cave_Template_PLAN.dxf has to carry the plan frame, the profile
// frame and the sheet layers all at once. The old standalone
// NSS_Cave_Template_PROFILE.dxf is deleted; nothing opened it.
//
// Supersedes tools/add_profile_frame_layers.js (and, before that,
// add_profile_layers.js), which carried a HAND-WRITTEN list of the
// layers it was responsible for. Every layer added to the registry
// since has needed a new one-shot tool with a new list. This one reads
// the registry itself, so the next tool that adds a layer needs only
// its CsLayers constant plus a re-run of this script.
//
// Carries only the QUESTION of which layers, never their appearance.
// CsLayers.ensure(doc, di, name) -- the same function every drawing
// tool calls -- is the one place that resolves a layer's
// colour/linetype/lineweight, from CsLayers.DEFAULTS in
// Core/CsLayers.js. An earlier tool in this family carried its own copy
// of that table and nothing would have caught it drifting.

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

includeBasePath = core;
include(core + "/CsLayers.js");
include(core + "/CsLayerVariants.js");
include(core + "/CsRestyle.js");

/**
 * Every layer name the registry declares as a constant, sorted.
 *
 * Constants only, deliberately: CsLayers.DEFAULTS also carries
 * CTRL-DATA, the retired data-store layer, which no template should
 * gain. Non-string members (SHEET_LAYERS, OFF, the functions) drop out
 * on the typeof test.
 *
 * \return array of layer names
 */
function registryLayers() {
    var out = [], seen = {}, k, v;
    for (k in CsLayers) {
        if (!CsLayers.hasOwnProperty(k)) {
            continue;
        }
        v = CsLayers[k];
        if (typeof v !== "string" || seen[v] === true) {
            continue;
        }
        seen[v] = true;
        out.push(v);
    }
    out.sort();
    return out;
}

/** The DXF writer that persists custom properties. Lowest canExport
 *  score wins, and the dxflib factory scores 1 for a filter naming it
 *  against 100 for a bare .dxf. */
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
 * Adds whatever the template is missing, RESTYLES what it already has,
 * and rewrites it only if either changed something.
 *
 * THE RESTYLE HALF IS THE POINT, and it was missing for a year. This
 * tool used to call CsLayers.ensure and nothing else, and ensure
 * resolves appearance AT CREATION -- so a layer already in the template
 * kept whatever colour, linetype and weight it was first written with,
 * no matter what CsLayers.DEFAULTS said afterwards. That is how the
 * shipped template came to carry ENTRANCE red/0.50 against a registry
 * saying white/0.35, BREAKDOWN-BOUNDARY in a third appearance again, and
 * CTRL-SHOTS at 0.09 against a registry saying 0.25 -- every one of them
 * invisible to a test suite that only ever checked layers this tool had
 * CREATED. CsRestyle.apply closes it: after this runs, the template
 * agrees with the registry on all three axes, for every layer, or the
 * run fails.
 *
 * \param path the template to bring up to date
 * \return true on success
 */
function syncLayers(path, wanted) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var added = [], i;
    for (i = 0; i < wanted.length; i++) {
        if (doc.hasLayer(wanted[i])) {
            continue;
        }
        CsLayers.ensure(doc, di, wanted[i]);
        added.push(wanted[i]);
    }

    var res = CsRestyle.apply(doc, di);

    if (added.length === 0 && res.changed.length === 0) {
        print("skip  " + path +
            " -- every registry layer already present and correct");
        return true;
    }

    if (di.exportFile(path, dxfLibFilter()) !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + added.length + " layer(s) added, " +
        res.changed.length + " of " + res.total + " restyled");
    if (added.length > 0) {
        print("      added:    " + added.join(", "));
    }
    if (res.changed.length > 0) {
        print("      restyled: " + res.changed.join(", "));
    }
    return true;
}

var wanted = registryLayers();
var ok = true;
// A registry that reads as empty would report "every layer already
// present" on a template carrying none of them -- silence that looks
// exactly like success. The floor is deliberately loose: it catches a
// broken include or a renamed namespace, not a single deleted constant,
// which tests/test_addon.py pins against the template instead.
if (wanted.length < 20) {
    print("FAIL  the layer registry yielded only " + wanted.length +
        " name(s) -- CsLayers did not load");
    ok = false;
} else {
    ok = syncLayers(repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf",
        wanted);
}

if (!ok) {
    print("### SYNC TEMPLATE LAYERS FAIL");
} else {
    print("### SYNC TEMPLATE LAYERS OK");
}
