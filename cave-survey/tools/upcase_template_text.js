// tools/upcase_template_text.js
//
// ONE-SHOT TEMPLATE PASS: capitalises every text entity in a template,
// model space and block definitions alike, so a sheet started from it
// letters the way the tools do (see CsDraw.caps).
//
// The tools capitalise what they DRAW; this capitalises what the
// template already carries -- the title block lines, the bar scale
// captions, the declination note. Without it a new sheet mixes the
// template's mixed case with the tools' caps.
//
// Idempotent: running it twice changes nothing the second time.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/upcase_template_text.js <repo-root> <template.dxf> [...]

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}

function upcase(path) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    // queryAllEntities(undone, allBlocks=true) reaches inside the block
    // definitions too -- the bar scale captions live there.
    var ids = doc.queryAllEntities(false, true);
    var op = new RModifyObjectsOperation();
    var changed = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPlainText !== "function" ||
            typeof e.setText !== "function") {
            continue;
        }
        var was = "" + e.getPlainText();
        var now = CsDraw.caps(was);
        if (now === was) {
            continue;
        }
        e.setText(now);
        op.addObject(e, false);
        changed++;
    }

    if (changed === 0) {
        print("skip  " + path + " -- already capitalised");
        return true;
    }
    di.applyOperation(op);

    if (di.exportFile(path, "R27 [2013] DXF Drawing [OpenDesign] (*.dxf)") !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + changed + " texts capitalised");
    return true;
}

var args = RSettings.getOriginalArguments();
var core = "", files = [];
for (var a = 0; a < args.length; a++) {
    var v = "" + args[a];
    if (v.indexOf(".dxf") > 0) {
        files.push(v);
    } else if (new QFileInfo(v + "/scripts/CaveSurvey/Core/CsAll.js").exists()) {
        core = v + "/scripts/CaveSurvey/Core";
    }
}
if (core === "") {
    print("### UPCASE FAIL -- pass the repo root so Core can be loaded");
} else {
    includeBasePath = core;
    include(core + "/CsTags.js");
    include(core + "/CsDraw.js");
    var allOk = files.length > 0;
    for (var f = 0; f < files.length; f++) {
        if (!upcase(files[f])) { allOk = false; }
    }
    print(allOk ? "### UPCASE OK" : "### UPCASE FAIL");
}
