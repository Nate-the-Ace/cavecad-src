/** A rectangular viewport: moving a corner must not move what the map shows -- measured on the RENDERED sheet, not on the maths. */
include("scripts/library.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### VIEWPORT RECT VERTEX FAILED: " + m); } else print("ok: " + m); }
include("scripts/File/BitmapExport/BitmapExportWorker.js");
include("scripts/Layouts/Layouts.js");
var tmp = QDir.tempPath();
var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel()); doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
// a cross in model space
var op = new RAddObjectsOperation();
op.addObject(new RLineEntity(doc, new RLineData(new RVector(48, 50), new RVector(52, 50))), false);
op.addObject(new RLineEntity(doc, new RLineData(new RVector(50, 48), new RVector(50, 52))), false);
op.addObject(new RCircleEntity(doc, new RCircleData(new RVector(50, 50), 3)), false);
di.applyOperation(op);
var info = Layouts.create(di, { name: "S", paper: "Letter", landscape: true });
var off = new RLayer(doc, "VPF"); di.applyOperation(new RAddObjectOperation(off, false));
var lid = doc.getLayerId("VPF");
var ps = Layouts.paperSize(doc, info);
doc.setCurrentBlock(info.blockId);
// rectangular viewport carrying the grips' own corner move
function rectVp(rot) {
  var v = new RViewportEntity(doc, new RViewportData());
  v.setCenter(new RVector(0.45, 0.35)); v.setWidth(0.7); v.setHeight(0.5);
  v.setLayerId(lid); v.setScale(Layouts.scaleFor(doc, 5)); v.setViewCenter(new RVector(50, 50));
  v.setViewTarget(new RVector(0, 0)); v.setBlockId(info.blockId); v.setRotation(rot);
  di.applyOperation(new RAddObjectOperation(v, false));
  return v.getId();
}
var l = doc.queryLayer(lid); l.setOff(true); di.applyOperation(new RModifyObjectOperation(l, false));
doc.setCurrentBlock(info.blockId);
var shots = {};
function shot(name) {
  var path = tmp + "/rp_" + name + ".png"; QFile.remove(path);
  var scene = new RGraphicsSceneQt(di);
  exportBitmap(doc, scene, path, { width: 1100, height: 850, window: new RBox(new RVector(0, 0), new RVector(ps.w, ps.h)), margin: 0, noWeightMargin: true, backgroundColor: new RColor("white"), antialiasing: false });
  var img = new QImage(path); var x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1, n = 0;
  for (var y = 0; y < img.height(); y++) for (var x = 0; x < img.width(); x++) if (img.pixelColor(x, y).value() < 120) { n++; x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
  shots[name] = { n: n, x1: x1, y1: y1, x2: x2, y2: y2 };
  print(name + ": n=" + n + " box=" + [x1, y1, x2, y2].join(","));
}
// within a pixel: float rounding can tip an edge pixel; the bug moved the map by tens
function sameAs(x, y) { return Math.abs(x.n - y.n) <= 2 && Math.abs(x.x1 - y.x1) <= 1 && Math.abs(x.y1 - y.y1) <= 1 && Math.abs(x.x2 - y.x2) <= 1 && Math.abs(x.y2 - y.y2) <= 1; }
var rots = [0, 35 * Math.PI / 180];
for (var r = 0; r < rots.length; r++) {
  var id = rectVp(rots[r]);
  shot("before" + r);
  // corners as the grips list them: NE, NW, SW, SE
  var drags = [[0.8, 0.6, 0.85, 0.65], [0.1, 0.6, 0.05, 0.62], [0.1, 0.1, 0.15, 0.12], [0.8, 0.1, 0.78, 0.07]];
  for (var k = 0; k < drags.length; k++) {
    var e = doc.queryEntity(id);
    var pts = e.getReferencePoints();
    var d = drags[k], moved = false;
    for (var p = 0; p < pts.length; p++) {
      if (Math.abs(pts[p].x - d[0]) < 1e-6 && Math.abs(pts[p].y - d[1]) < 1e-6) { moved = e.moveReferencePoint(pts[p], new RVector(d[2], d[3])); break; }
    }
    check(moved, "rot " + r + " corner " + k + " grip moved");
    di.applyOperation(new RModifyObjectOperation(e, false));
    shot("after" + r + "_" + k);
    check(sameAs(shots["before" + r], shots["after" + r + "_" + k]), "rot " + r + " corner " + k + ": map on the same pixels");
    // put the frame back so each corner is tested from the same start
    e = doc.queryEntity(id); e.setCenter(new RVector(0.45, 0.35)); e.setWidth(0.7); e.setHeight(0.5);
    e.setViewCenter(new RVector(50, 50)); di.applyOperation(new RModifyObjectOperation(e, false));
  }
  var g = doc.queryEntity(id); di.applyOperation(new RDeleteObjectOperation(g));
}
if (fails === 0) print("### VIEWPORT RECT VERTEX OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
