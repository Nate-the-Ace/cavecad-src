/**
 * A DXF value line longer than dxflib's read buffer used to leave the rest of
 * that line -- including its newline -- sitting in the stream. Every group
 * code / value pair after it was then read one line out of step, so the whole
 * remainder of the file was silently discarded. Our own AreaFillSig XDATA
 * routinely crosses that length, which is how the OBJECTS section, and with it
 * every image cross reference, vanished on each save and reload cycle.
 *
 * The file here is written by hand so the assertion lands on the reader rather
 * than on whatever the exporter happens to emit today.
 */
function fail(msg) {
    print("### DXF LONG LINE FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}

function pair(code, value) { return code + "\n" + value + "\n"; }

// Comfortably past the old 1024 byte buffer.
var longValue = "";
while (longValue.length < 1500) {
    longValue += "AreaFillSig=WATER|49634436|0.067|1||504485,344740;";
}

var dxf = "";
dxf += pair("  0", "SECTION") + pair("  2", "ENTITIES");

// A line carrying the over-long value, exactly as XDATA reaches the file.
dxf += pair("  0", "LINE") + pair("  8", "0");
dxf += pair(" 10", "0.0") + pair(" 20", "0.0") + pair(" 30", "0.0");
dxf += pair(" 11", "10.0") + pair(" 21", "0.0") + pair(" 31", "0.0");
dxf += pair("1001", "QCAD") + pair("1000", longValue);

// Written after the long value, so it only survives if the reader stayed in step.
dxf += pair("  0", "POINT") + pair("  8", "0");
dxf += pair(" 10", "42.0") + pair(" 20", "17.0") + pair(" 30", "0.0");

dxf += pair("  0", "ENDSEC") + pair("  0", "EOF");

var path = QDir.tempPath() + "/cs_dxf_long_line.dxf";
var f = new QFile(path);
if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
    fail("could not write the test drawing to " + path);
}
var stream = new QTextStream(f);
stream.writeString(dxf);
stream.flush();
f.close();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
di.importFile(path);

var pts = doc.queryAllEntities(false, true, RS.EntityPoint);
if (pts.length !== 1) {
    fail("the entity written after the " + longValue.length + " character value "
         + "did not survive the read (found " + pts.length + " points, expected 1). "
         + "The reader lost step on the long line.");
}

var p = doc.queryEntity(pts[0]).getPosition();
if (Math.abs(p.x - 42) > 1e-6 || Math.abs(p.y - 17) > 1e-6) {
    fail("the entity after the long line came back at " + p.x + ", " + p.y);
}

if (doc.queryAllEntities(false, true, RS.EntityLine).length !== 1) {
    fail("the line carrying the long value did not come back");
}

QFile.remove(path);
print("### DXF LONG LINE OK (" + longValue.length + " character value, "
      + "the entity after it still read)");
QCoreApplication.exit(0);
