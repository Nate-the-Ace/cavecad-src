/**
 * CsLinetypeStore against the real engine: the personal library file,
 * and adding / replacing a linetype in a drawing.
 */
function fail(msg) {
    print("### LINETYPE MAKER FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}
// library.js is not loaded under -autostart.
function isNull(v) {
    return v === null || v === undefined;
}

var repo = String(args[args.length - 1]);
function loadRepo(path) {
    var f = new QFile(repo + "/" + path);
    check(f.open(QIODevice.ReadOnly | QIODevice.Text), "cannot read " + path);
    var src = String(new QTextStream(f).readAll());
    f.close();
    (0, eval)(src.replace(/^\s*include\(.*\);\s*$/mg, ""));
}
loadRepo("scripts/CaveSurvey/Core/CsLinetype.js");
loadRepo("scripts/CaveSurvey/Core/CsLinetypeStore.js");

var libPath = QDir.tempPath() + "/cs_lt_test/CaveCustomLinetypes.lin";
new QFile(libPath).remove();
CsLinetypeStore.pathOverride = libPath;

function model(name, pattern) {
    var r = CsLinetype.fromPattern(pattern);
    check(r.errors.length === 0, name + ": bad test pattern");
    return { name: name, description: name + " test", segments: r.segments };
}

// ---- the library file ---------------------------------------------------
check(CsLinetypeStore.loadCustom().linetypes.length === 0, "fresh library not empty");
check(CsLinetypeStore.saveCustom(model("CSA", "A,1,-0.5")) === null, "save CSA");
check(CsLinetypeStore.saveCustom(model("CSB",
    'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3')) === null, "save CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 2, "library should hold 2");
check(CsLinetypeStore.saveCustom(model("csa", "A,2,-1")) === null, "replace CSA");
var lib = CsLinetypeStore.loadCustom().linetypes;
check(lib.length === 2, "replace by name (any case) duplicated: " + lib.length);
check(CsLinetype.toPattern(lib[0]) === "A,2,-1", "CSA not replaced: " +
    CsLinetype.toPattern(lib[0]));
check(CsLinetypeStore.saveCustom(model("BAD NAME", "A,1,-1")) !== null,
    "a name with a space was saved");
check(CsLinetypeStore.removeCustom("CSB") === null, "remove CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 1, "remove failed");

// ---- the drawing --------------------------------------------------------
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
var m = model("CSTEXT", 'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3');
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply new");
var listed = CsLinetypeStore.fromDocument(doc);
var found = null;
for (var i = 0; i < listed.length; i++) {
    check(["BYLAYER", "BYBLOCK", "CONTINUOUS"].indexOf(listed[i].name.toUpperCase()) < 0,
        "fromDocument listed " + listed[i].name);
    if (listed[i].name.toUpperCase() === "CSTEXT") {
        found = listed[i];
    }
}
check(found !== null, "applied linetype not listed");
check(found.segments.length === 3 && found.segments[1].text === "CAVE",
    "listed linetype lost its text: " + JSON.stringify(found));
check(found.description === "CSTEXT test", "description lost: " + found.description);

m.segments[0].length = 0.75;
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply replace");
check(Math.abs(drawn(doc, "CSTEXT").dash - 0.75) < 1e-9, "replace did not take: " +
    drawn(doc, "CSTEXT").dash);
var count = 0;
var names = doc.getLinetypeNames();
for (var n = 0; n < names.length; n++) {
    if (String(names[n]).toUpperCase() === "CSTEXT") {
        count++;
    }
}
check(count === 1, "replace made a second CSTEXT (" + count + ")");

// ---- lengths are drawing units ---------------------------------------------
// The engine reads a pattern in inches (imperial) or mm (metric) and
// converts to the drawing's unit. A caver's 0.5 on a feet drawing must
// draw half a foot, not half an inch -- a 580 ft wall at half an inch
// is past the engine's dash threshold and draws solid (Truitt, 2026-09-28).
function unitDoc(unit, metric) {
    var d = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var i = new RDocumentInterface(d);
    d.setUnit(unit);
    d.setMeasurement(metric ? RS.Metric : RS.Imperial);
    return { doc: d, di: i };
}
function drawn(d, name) {
    var pat = d.queryLinetype(name).getPattern();
    var f = RUnit.convert(1, pat.isMetric() ? RS.Millimeter : RS.Inch, d.getUnit());
    return { dash: pat.getDashLengthAt(0) * f, size: pat.getShapeScaleAt(1) * f };
}
[[RS.Foot, false], [RS.Inch, false], [RS.Meter, true], [RS.Millimeter, true]]
        .forEach(function(u) {
    var ud = unitDoc(u[0], u[1]);
    check(CsLinetypeStore.applyToDocument(ud.doc, ud.di,
        model("CSUNIT", 'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3')) === null,
        "apply CSUNIT, unit " + u[0]);
    var got = drawn(ud.doc, "CSUNIT");
    check(Math.abs(got.dash - 0.5) < 1e-9, "unit " + u[0] +
        ": a 0.5 dash draws " + got.dash + " drawing units");
    check(Math.abs(got.size - 0.1) < 1e-9, "unit " + u[0] +
        ": a 0.1 text draws " + got.size + " drawing units");
    var back = null, all = CsLinetypeStore.fromDocument(ud.doc);
    for (var k = 0; k < all.length; k++) {
        if (all[k].name === "CSUNIT") {
            back = all[k];
        }
    }
    check(back !== null && CsLinetype.toPattern(back) ===
        'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3', "unit " + u[0] +
        ": read back as " + (back ? CsLinetype.toPattern(back) : "nothing"));
});

// ---- applyAll: what the template pour does -------------------------------
var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di2 = new RDocumentInterface(doc2);
var failed = CsLinetypeStore.applyAll(doc2, di2);
check(failed.length === 0, "applyAll failed: " + failed.join(", "));
check(CsLinetypeStore.hasLinetype(doc2, "CSA"), "applyAll did not add CSA");

// ---- import reading, without the dialog ---------------------------------
var sample = CsLinetypeStore.readImport(repo + "/testdata/linetypes/cave-sample.lin");
check(sample.errors.length === 0, "sample .lin: " + sample.errors.join("; "));
check(sample.linetypes.length === 2, "sample .lin: " + sample.linetypes.length);
check(sample.linetypes[0].segments[1].text === "W", "sample .lin lost its W");

// A drawing's linetypes: write one out, read it back through readImport.
var exp = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var expDi = new RDocumentInterface(exp);
check(CsLinetypeStore.applyToDocument(exp, expDi,
    model("CSDXF", 'A,1,-0.2,["DXF",standard,S=0.1],-0.3')) === null, "apply CSDXF");
var filter = "";
var filters = RFileExporterRegistry.getFilterStrings();
for (var fi = 0; fi < filters.length; fi++) {
    if (String(filters[fi]).indexOf("dxflib") >= 0 &&
            String(filters[fi]).indexOf("2000") >= 0) {
        filter = String(filters[fi]);
    }
}
var dxfPath = QDir.tempPath() + "/cs_lt_test/import.dxf";
check(expDi.exportFile(dxfPath, filter, false), "export for import test");
var fromDxf = CsLinetypeStore.readImport(dxfPath);
var got = null;
for (var j = 0; j < fromDxf.linetypes.length; j++) {
    if (fromDxf.linetypes[j].name.toUpperCase() === "CSDXF") {
        got = fromDxf.linetypes[j];
    }
}
check(got !== null, "DXF import did not list CSDXF");
check(got.segments[1].text === "DXF", "DXF import lost the text");

// ---- fonts and anchoring --------------------------------------------------
var fonts = CsLinetypeStore.fontNames();
check(fonts.length > 5, "font list: " + fonts.length);
var hasStandard = false;
for (var fn = 0; fn < fonts.length; fn++) {
    check(!/shp$/i.test(fonts[fn]), "shape font offered as a text font: " + fonts[fn]);
    if (fonts[fn].toLowerCase() === "standard") {
        hasStandard = true;
    }
}
check(hasStandard, "standard font missing from the list");

var aseg = CsLinetype.segment(-0.5);
aseg.text = "W";
aseg.style = "standard";
aseg.scale = 0.1;
aseg.anchor = "MC";
var abox = CsLinetypeStore.textBox(aseg);
check(abox !== null && abox.maxX > abox.minX && abox.maxY > abox.minY,
    "text box not measured: " + JSON.stringify(abox));
CsLinetypeStore.anchorize(aseg);
var centreX = aseg.x + (abox.minX + abox.maxX) / 2;
var centreY = aseg.y + (abox.minY + abox.maxY) / 2;
check(Math.abs(centreX + 0.25) < 1e-6, "MC text not centred in its row: " + centreX);
check(Math.abs(centreY) < 1e-6, "MC text not centred on the line: " + centreY);
var round = CsLinetypeStore.deriveAnchors({ segments: [
    CsLinetype.fromPattern(CsLinetype.toPattern({ segments: [CsLinetype.segment(1), aseg] }))
        .segments[1]] });
check(round.segments[0].anchor === "MC", "MC not read back after .lin round trip: " +
    round.segments[0].anchor);

// ---- a text row's gap follows its text ------------------------------------
var gseg = CsLinetype.segment(-0.5);
gseg.text = "W";
gseg.style = "standard";
gseg.scale = 0.1;
gseg.anchor = "MC";
CsLinetypeStore.fitText(gseg);
var len1 = gseg.length, w1 = gseg.fitWidth;
check(w1 > 0, "fitText measured nothing");
gseg.scale = 0.3;
CsLinetypeStore.fitText(gseg);
CsLinetypeStore.anchorize(gseg);
var bigBox = CsLinetypeStore.textBox(gseg);
check(Math.abs((-gseg.length) - (-len1) - (gseg.fitWidth - w1)) < 1e-9,
    "gap did not grow with the text: " + len1 + " -> " + gseg.length);
check(gseg.x + bigBox.minX >= gseg.length - 1e-9 && gseg.x + bigBox.maxX <= 1e-9,
    "bigger text spills out of its gap: x=" + gseg.x + " len=" + gseg.length);

CsLinetypeStore.pathOverride = null;
print("### LINETYPE MAKER OK");
QCoreApplication.exit(0);
