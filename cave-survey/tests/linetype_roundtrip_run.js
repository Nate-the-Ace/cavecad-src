/**
 * Complex linetypes -- a text or shape drawn into the pattern -- used to be
 * refused by the engine (a DWG-plugin gate) and cut down to bare dashes by
 * the DXF reader and writer. This drives both directions against the real
 * engine. The first half reads a HAND-WRITTEN file, so it tests the reader
 * rather than whatever the exporter happens to emit.
 */
function fail(msg) {
    print("### LINETYPE ROUNDTRIP FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}
function near(a, b, msg) {
    check(Math.abs(a - b) < 1e-6, msg + " (expected " + b + ", got " + a + ")");
}
// NOT isNull(doc.queryLinetype(name)): a missing name comes back as a
// live-looking wrapper whose getId() is undefined. Ask the name list.
function hasLinetype(doc, name) {
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toUpperCase() === String(name).toUpperCase()) {
            return true;
        }
    }
    return false;
}
function pair(code, value) { return code + "\n" + value + "\n"; }

// ---- 1. The gate -------------------------------------------------------
var gated = new RLinetypePattern(true, "GATE", "gate probe");
check(gated.setPatternString('A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3'),
    "setPatternString refused a text element (the DWG-plugin gate is back)");

// ---- 2. Read a hand-written complex LTYPE ------------------------------
var dxf = "";
dxf += pair("  0", "SECTION") + pair("  2", "TABLES");
dxf += pair("  0", "TABLE") + pair("  2", "LTYPE") + pair(" 70", "1");
dxf += pair("  0", "LTYPE") + pair("  5", "20") + pair("  2", "CSTEXT");
dxf += pair(" 70", "0") + pair("  3", "Text test") + pair(" 72", "65");
dxf += pair(" 73", "3") + pair(" 40", "1.5");
dxf += pair(" 49", "0.5") + pair(" 74", "0");
dxf += pair(" 49", "-0.5") + pair(" 74", "2") + pair(" 75", "0");
dxf += pair("340", "31") + pair(" 46", "0.1") + pair(" 50", "0.0");
dxf += pair(" 44", "-0.1") + pair(" 45", "-0.05") + pair("  9", "CAVE");
dxf += pair(" 49", "-0.5") + pair(" 74", "0");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "TABLE") + pair("  2", "STYLE") + pair(" 70", "1");
dxf += pair("  0", "STYLE") + pair("  5", "31") + pair("  2", "CS_LT_STANDARD");
dxf += pair(" 70", "0") + pair(" 40", "0.0") + pair(" 41", "1.0");
dxf += pair(" 50", "0.0") + pair(" 71", "0") + pair(" 42", "2.5");
dxf += pair("  3", "standard") + pair("  4", "");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "ENDSEC");
dxf += pair("  0", "SECTION") + pair("  2", "ENTITIES");
dxf += pair("  0", "LINE") + pair("  8", "0") + pair("  6", "CSTEXT");
dxf += pair(" 10", "0.0") + pair(" 20", "0.0") + pair(" 30", "0.0");
dxf += pair(" 11", "10.0") + pair(" 21", "0.0") + pair(" 31", "0.0");
dxf += pair("  0", "ENDSEC") + pair("  0", "EOF");

var readPath = QDir.tempPath() + "/cs_linetype_read.dxf";
var f = new QFile(readPath);
check(f.open(QIODevice.WriteOnly | QIODevice.Text), "could not write " + readPath);
var ts = new QTextStream(f);
ts.writeString(dxf);
ts.flush();
f.close();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
di.importFile(readPath);

check(hasLinetype(doc, "CSTEXT"), "linetype CSTEXT was not imported");
var lt = doc.queryLinetype("CSTEXT");
var p = lt.getPattern();
check(p.getNumDashes() === 3, "CSTEXT has " + p.getNumDashes() + " dashes, expected 3");
check(p.getShapeTextAt(1) === "CAVE", "text at 1 is '" + p.getShapeTextAt(1) + "'");
check(String(p.getShapeTextStyleAt(1)).toLowerCase() === "standard",
    "font at 1 is '" + p.getShapeTextStyleAt(1) + "' -- 340 was not resolved");
near(p.getShapeScaleAt(1), 0.1, "scale at 1");
near(p.getShapeOffsetAt(1).x, -0.1, "offset x at 1");
near(p.getShapeOffsetAt(1).y, -0.05, "offset y at 1");
check(p.hasShapes(), "CSTEXT has no rendered glyphs (updateShapes not run)");

var lines = doc.queryAllEntities(false, true, RS.EntityLine);
check(lines.length === 1, "the LINE after the tables did not import (" +
    lines.length + ") -- the code-9 record boundary is back");
var line = doc.queryEntity(lines[0]);
check(String(doc.getLinetypeName(line.getLinetypeId())).toUpperCase() === "CSTEXT",
    "line lost its linetype");

// ---- 3. Write, reopen, compare -----------------------------------------
function dxf2000Filter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        var s = String(filters[i]);
        if (s.indexOf("dxflib") >= 0 && s.indexOf("2000") >= 0) {
            return s;
        }
    }
    fail("no DXF 2000 dxflib export filter");
}

function roundTrip(name, patternString) {
    var d = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var i = new RDocumentInterface(d);
    var pat = new RLinetypePattern(true, name, name + " test");
    check(pat.setPatternString(patternString), name + ": pattern refused");
    i.applyOperation(new RAddObjectOperation(new RLinetype(d, pat), false));
    var ln = new RLineEntity(d, new RLineData(new RVector(0, 0), new RVector(10, 0)));
    ln.setLinetypeId(d.getLinetypeId(name));
    i.applyOperation(new RAddObjectOperation(ln, false));

    var path = QDir.tempPath() + "/cs_linetype_" + name + ".dxf";
    check(i.exportFile(path, dxf2000Filter(), false), name + ": export failed");

    var back = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var bi = new RDocumentInterface(back);
    bi.importFile(path);
    check(hasLinetype(back, name), name + ": linetype missing after reopen");
    var blt = back.queryLinetype(name);
    var a = pat, b = blt.getPattern();
    check(b.getNumDashes() === a.getNumDashes(), name + ": dash count " +
        b.getNumDashes() + " vs " + a.getNumDashes());
    for (var k = 0; k < a.getNumDashes(); k++) {
        near(b.getDashLengthAt(k), a.getDashLengthAt(k), name + ": dash " + k);
        check(b.getShapeTextAt(k) === a.getShapeTextAt(k),
            name + ": text at " + k + " '" + b.getShapeTextAt(k) + "'");
        if (a.getShapeTextAt(k) !== "") {
            check(String(b.getShapeTextStyleAt(k)).toLowerCase() ===
                String(a.getShapeTextStyleAt(k)).toLowerCase(),
                name + ": font at " + k + " '" + b.getShapeTextStyleAt(k) + "'");
            near(b.getShapeScaleAt(k), a.getShapeScaleAt(k), name + ": scale " + k);
            near(b.getShapeRotationAt(k), a.getShapeRotationAt(k), name + ": rotation " + k);
            near(b.getShapeOffsetAt(k).x, a.getShapeOffsetAt(k).x, name + ": x " + k);
            near(b.getShapeOffsetAt(k).y, a.getShapeOffsetAt(k).y, name + ": y " + k);
        }
    }
    var bl = back.queryAllEntities(false, true, RS.EntityLine);
    check(bl.length === 1, name + ": line missing after reopen");
    check(String(back.getLinetypeName(back.queryEntity(bl[0]).getLinetypeId()))
        .toUpperCase() === name.toUpperCase(), name + ": line lost its linetype");
    return path;
}

var written = roundTrip("CSRT",
    'A,0.5,-0.2,["CAVE",standard,S=0.1,R=15,X=-0.1,Y=-0.05],-0.3');

// The 340 must point at the CS_LT_ STYLE record's own handle.
var rf = new QFile(written);
check(rf.open(QIODevice.ReadOnly | QIODevice.Text), "cannot reread " + written);
var body = String(new QTextStream(rf).readAll());
rf.close();
var ptr = /\n\s*340\n([0-9A-Fa-f]+)\n/.exec(body);
check(ptr !== null, "no 340 pointer written");
var styleRe = new RegExp("\\n\\s*0\\nSTYLE\\n\\s*5\\n" + ptr[1] +
    "\\n[\\s\\S]*?\\n\\s*2\\nCS_LT_STANDARD\\n");
check(styleRe.test(body), "340 " + ptr[1] + " does not name the CS_LT_STANDARD STYLE");

var longText = "";
while (longText.length < 300) {
    longText += "X";
}
roundTrip("CSLONG", 'A,1,["' + longText + '",standard,S=0.1],-1');

print("### LINETYPE ROUNDTRIP OK");
QCoreApplication.exit(0);
