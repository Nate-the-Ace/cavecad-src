// cave_template_run.js -- the template pour, driven headlessly.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/cave_template_run.js "$PWD"
//
// initNewFile() runs on EVERY File > New in this build, and until now
// nothing tested it. Two of the things it does are repairs for losses
// that a DXF round trip causes and the template therefore cannot carry
// itself:
//
//   * every CsLayers.OFF layer arrives VISIBLE from the template's DXF
//     and is switched off here;
//   * every CsLayers.LOCKED layer is re-locked.
//
// MEASURED 2026-08-31, against this build, because the two are not in
// the same state and the code's own comment treats them as one:
//
//   - a DXF export/import round trip DOES lose both the off state and
//     the lock (probed with a POPULATED layer: locked+off going out,
//     unlocked+visible coming back);
//   - but the SHIPPED template file happens to carry its locks --
//     CTRL-PROFILE-BOX and CTRL-SECTION-BOX both import already
//     locked -- while none of the OFF layers carry their off state. So
//     today the off repair is doing real work and the lock repair is a
//     standing guard. Both are asserted here, and the guard is worth
//     keeping: the day the template is re-exported by something that
//     drops the flag, this is what puts it back.
//   - a layer with NO entities is dropped by the export entirely,
//     which is why that probe has to put a line on the layer first.
//
// All of it is silent when it breaks -- the drawing still opens, it
// just has scaffolding visible and a bookkeeping layer a stray drag can
// edit. That is exactly the kind of regression a green suite hides, so
// it is asserted here against a real pour of the shipped template.
//
// The gate is exercised through the ONE-SHOT flag
// (CaveSurvey/TemplateOnNewOnce) rather than CaveSurvey/TemplateOnNew:
// initNewFile consumes the one-shot itself and resets it to false, so
// this test leaves the user's settings exactly as it found them.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try {
            if (typeof v.isNull === "function") { return v.isNull(); }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof destr === "undefined") {
    destr = function(obj) {
        if (RSettings.getQtVersion() >= 0x060000) {
            obj.destr();
        } else if (typeof obj.destroy === "function") {
            obj.destroy();
        }
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
// initNewFile resolves the template RELATIVE to includeBasePath, so it
// must point where the tool's own does: at the tool folder.
includeBasePath = repoRoot + "/scripts/CaveSurvey/CaveTemplate";
include(includeBasePath + "/CaveTemplateApply.js");

var failures = [];
function ok(condition, what) {
    if (!condition) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

var messages = [];
EAction.handleUserMessage = function(text) { messages.push(text); };
EAction.handleUserWarning = function(text) { messages.push("WARNING: " + text); };

// ---------------------------------------------------------------------
// Pour into a fresh document.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
var fakeChild = { getDocumentInterface: function() { return di; } };

// The caver's linetype library rides in on every pour (Linetype Maker).
// A scratch library, so the test never reads or writes the real one.
var ltLibrary = QDir.tempPath() + "/cs_template_lt/CaveCustomLinetypes.lin";
CsLinetypeStore.pathOverride = ltLibrary;
ok(CsLinetypeStore.writeText(ltLibrary, "*CSA,test\nA,1,-0.5\n") === null,
    "scratch linetype library written");

var settingBefore = RSettings.getBoolValue("CaveSurvey/TemplateOnNewOnce",
    false);
RSettings.setValue("CaveSurvey/TemplateOnNewOnce", true);
initNewFile(fakeChild);
eqs(RSettings.getBoolValue("CaveSurvey/TemplateOnNewOnce", false), false,
    "the one-shot flag is consumed by the pour (and so this test leaves " +
    "the settings as it found them)");
if (settingBefore === true) {
    // Vanishingly unlikely, but restore rather than silently change it.
    RSettings.setValue("CaveSurvey/TemplateOnNewOnce", true);
}

ok(messages.length > 0, "the pour reported something");
var warned = false;
for (var mi = 0; mi < messages.length; mi++) {
    if (messages[mi].indexOf("WARNING") === 0) { warned = true; }
}
ok(!warned, "the pour raised no warning: " + messages.join(" | "));

var layerNames = {};
var layerIds = doc.queryAllLayers();
for (var li = 0; li < layerIds.length; li++) {
    var lay = doc.queryLayer(layerIds[li]);
    if (!isNull(lay)) { layerNames[lay.getName()] = lay; }
}
ok(Object.keys(layerNames).length > 5,
    "the template's layers arrived (" + Object.keys(layerNames).length + ")");
ok(!isNull(layerNames["WALLS-SURVEYED"]),
    "a known plan layer is present after the pour");
ok(CsLinetypeStore.hasLinetype(doc, "CSA"),
    "the caver's library linetype arrived with the pour");

// ---------------------------------------------------------------------
// The two repairs.
// ---------------------------------------------------------------------

var stillOn = [];
var offChecked = 0;
for (var offName in CsLayers.OFF) {
    if (!CsLayers.OFF.hasOwnProperty(offName) ||
            CsLayers.OFF[offName] !== true) {
        continue;
    }
    var offLay = layerNames[offName];
    if (isNull(offLay)) { continue; }   // not in this template, not a claim
    offChecked++;
    if (typeof offLay.isOff !== "function" || offLay.isOff() !== true) {
        stillOn.push(offName);
    }
}
eqs(stillOn.join(","), "",
    "every registry OFF layer is off after the pour -- the DXF brings " +
    "them back visible and this is the only place that is repaired");

ok(offChecked > 0,
    "the OFF check actually found registry layers in the template -- " +
    "without this the assertion above passes on an empty loop, which is " +
    "how a pour that stopped copying layers at all would look GREEN");

var stillUnlocked = [];
var lockChecked = 0;
for (var lockName in CsLayers.LOCKED) {
    if (!CsLayers.LOCKED.hasOwnProperty(lockName) ||
            CsLayers.LOCKED[lockName] !== true) {
        continue;
    }
    var lockLay = layerNames[lockName];
    if (isNull(lockLay)) { continue; }
    lockChecked++;
    if (typeof lockLay.isLocked !== "function" ||
            lockLay.isLocked() !== true) {
        stillUnlocked.push(lockName);
    }
}
eqs(stillUnlocked.join(","), "",
    "every registry LOCKED layer is locked after the pour (the template " +
    "carries these today, so this is a guard rather than a repair -- see " +
    "the header)");

ok(lockChecked > 0,
    "and the LOCKED check found some too");

// A layer that is NOT in either registry must be left alone -- the
// repair is targeted, not a blanket pass over the template.
var walls = layerNames["WALLS-SURVEYED"];
if (!isNull(walls) && typeof walls.isOff === "function") {
    eqs(walls.isOff(), false, "an ordinary drawing layer is left visible");
}
if (!isNull(walls) && typeof walls.isLocked === "function") {
    eqs(walls.isLocked(), false, "and left unlocked");
}

// ---------------------------------------------------------------------
// The drawing must keep NO file name: Save has to ask, or the next
// save silently overwrites the shipped template.
// ---------------------------------------------------------------------

eqs(doc.getFileName(), "",
    "the poured drawing has no file name, so Save cannot overwrite the " +
    "template");

// ---------------------------------------------------------------------
// The gate: with the one-shot off and TemplateOnNew explicitly false,
// nothing is poured. Read the real setting, don't write it.
// ---------------------------------------------------------------------

var doc2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di2 = new RDocumentInterface(doc2);
var before2 = doc2.queryAllLayers().length;
var onNew = RSettings.getBoolValue("CaveSurvey/TemplateOnNew", true);
initNewFile({ getDocumentInterface: function() { return di2; } });
var after2 = doc2.queryAllLayers().length;
if (onNew) {
    ok(after2 > before2,
        "with TemplateOnNew on (the default), an ordinary File > New " +
        "pours too");
} else {
    eqs(after2, before2,
        "with TemplateOnNew explicitly off, File > New stays empty");
}

// ---------------------------------------------------------------------
// EVERY SHIPPED SYMBOL HAS GEOMETRY IN THE TEMPLATE.
//
// The catalogue is code and the geometry is in the DXF, and nothing
// held the two together: a CATALOG entry whose block was never drawn
// lists in the palette, places without complaint, and puts NOTHING on
// the map -- CsSymbols.insert returns null, the caller reports a
// missing block, and the caver is told their drawing is wrong when the
// template is. Adding the eight rigging symbols was the first time a
// whole category arrived at once, which is exactly when the two halves
// are most likely to be committed apart.
//
// Read from the shipped FILE rather than from a poured document, so
// this fails in the repo where the fix is, not in a user's drawing.
// ---------------------------------------------------------------------
(function() {
    var tdoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var tdi = new RDocumentInterface(tdoc);
    var tpath = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
    if (tdi.importFile(tpath, "", false) !== RDocumentInterface.IoErrorNoError) {
        ok(false, "symbols: cannot read the shipped template");
        return;
    }
    var missing = [], empty = [], offLayer = [];
    for (var ci = 0; ci < CsSymbols.CATALOG.length; ci++) {
        var entry = CsSymbols.CATALOG[ci];
        // doc.hasBlock, not isNull(queryBlock): queryBlock hands back a
        // wrapper for a block that is not there which is neither null
        // nor usable, and every existence test written the obvious way
        // answers "yes" for a block that does not exist.
        if (!tdoc.hasBlock(entry.block)) {
            missing.push(entry.block);
            continue;
        }
        var ids = tdoc.queryBlockEntities(tdoc.getBlockId(entry.block));
        if (ids.length === 0) {
            empty.push(entry.block);
            continue;
        }
        // ...and its home layer has to be one the registry knows, or
        // the geometry lands with whatever appearance the drawing
        // happens to give an unknown name.
        if (CsLayers.DEFAULTS[entry.layer] === undefined) {
            offLayer.push(entry.block + " -> " + entry.layer);
        }
    }
    eqs(missing.length, 0,
        "every catalogued symbol has a block in the shipped template" +
        (missing.length ? " (missing: " + missing.join(", ") + ")" : ""));
    eqs(empty.length, 0,
        "...and none of those blocks is empty" +
        (empty.length ? " (empty: " + empty.join(", ") + ")" : ""));
    eqs(offLayer.length, 0,
        "...and every one names a layer the registry declares" +
        (offLayer.length ? " (" + offLayer.join(", ") + ")" : ""));

    // The rigging category specifically: it is the one a vertical cave
    // needs and the one that did not exist.
    var rigging = 0;
    for (ci = 0; ci < CsSymbols.CATALOG.length; ci++) {
        if (CsSymbols.CATALOG[ci].category === "Rigging") { rigging++; }
    }
    ok(rigging >= 8,
        "the Rigging category carries at least 8 symbols, got " + rigging);
})();

// A null child must be survivable: QCAD calls this hook before the
// document interface exists in some paths.
initNewFile(null);
initNewFile({ getDocumentInterface: function() { return null; } });
ok(true, "a null mdiChild or interface does not throw");

var out;
CsLinetypeStore.pathOverride = null;

if (failures.length === 0) {
    out = "### CAVE TEMPLATE OK";
} else {
    out = "### CAVE TEMPLATE FAIL " + failures.length + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
