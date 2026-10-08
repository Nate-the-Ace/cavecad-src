/** A TURNED polygon viewport: moving a corner must not move what the map shows -- measured on the RENDERED sheet, not on the maths. */
include("scripts/library.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### VIEWPORT VERTEX RENDER FAILED: " + m); } else print("ok: " + m); }
include("scripts/File/BitmapExport/BitmapExportWorker.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Layouts/ViewportShape/ViewportShape.js");
include("scripts/Layouts/MoveVertex/MoveVertex.js");
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
// polygon viewport, then turned
ViewportShape.createPolygon(di, [{x: 0.1, y: 0.1}, {x: 0.8, y: 0.1}, {x: 0.8, y: 0.6}, {x: 0.1, y: 0.6}]);
var vp = Layouts.viewports(doc, info)[0], id = vp.getId();
var e = doc.queryEntity(id);
e.setLayerId(lid); e.setScale(Layouts.scaleFor(doc, 5)); e.setViewCenter(new RVector(50, 50)); e.setRotation(35 * Math.PI / 180);
di.applyOperation(new RModifyObjectOperation(e, false));
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
shot("before");
// exportBitmap's throwaway view is gone but the interface still remembers it; terminate() would post to it
di.setLastKnownViewWithFocus(undefined);
MoveVertex.start(di, id, 0, 2);
var mv = MoveVertex.current;
var ev = function(x, y) { var p = new RVector(x, y); return { getModelPosition: function() { return p; }, getScreenPosition: function() { return p; }, button: function() { return Qt.LeftButton; } }; };
mv.mouseMoveEvent(ev(0.85, 0.75));
mv.mouseReleaseEvent(ev(0.85, 0.75));
shot("after");
var b = shots.before, a = shots.after;
check(b.n > 100, "the marker is drawn through the turned viewport");
check(b.x1 === a.x1 && b.y1 === a.y1 && b.x2 === a.x2 && b.y2 === a.y2 && b.n === a.n, "and is on exactly the same pixels after a corner was moved");
check(Math.abs(doc.queryEntity(id).getRotation() - 35 * Math.PI / 180) < 1e-9, "the contents are still turned 35 degrees");
if (fails === 0) print("### VIEWPORT VERTEX RENDER OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
