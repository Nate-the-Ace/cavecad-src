/** Polygon viewports and trimming: the shape API, hit testing, and the DXF round trip. */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Layouts/ViewportShape/ViewportShape.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### VIEWPORT SHAPE FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-9 : t); }

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
di.applyOperation(new RAddObjectOperation(new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 480, oy + 150))), false));
var info = Layouts.create(di, { name: "S", paper: "Letter" });
doc.setCurrentBlock(info.blockId);

var loop = [{ x: 0.15, y: 0.12 }, { x: 0.75, y: 0.10 }, { x: 0.82, y: 0.40 }, { x: 0.55, y: 0.62 }, { x: 0.12, y: 0.50 }];
check(ViewportShape.createPolygon(di, loop), "a polygon makes a viewport");
var vp = Layouts.viewports(doc, info)[0];
check(Layouts.hasClip(vp) && Layouts.clipLoops(vp).length === 1 && Layouts.clipLoops(vp)[0].length === 5, "it carries its five corners");
check(near(vp.getCenter().x, (0.12 + 0.82) / 2) && near(vp.getWidth(), 0.70) && near(vp.getHeight(), 0.52), "its box is the outline's bounding box");
check(Layouts.shapeContains(vp, 0.45, 0.35) && !Layouts.shapeContains(vp, 0.05, 0.05) && !Layouts.shapeContains(vp, 0.80, 0.60),
    "inside the polygon hits, the box corners outside it do not");
check(vp.getCustomProperty("CaveCAD", "NoRaster") === "1", "a polygon viewport leaves rasters out like any other");
var found = Layouts.viewportAt(doc, info, 0.80, 0.60);
check(isNull(found), "a click in the corner of the box but outside the shape finds no viewport");

// contents stay put on the paper when the box moves to the outline's centre
var model = Layouts.paperToModel(vp, 0.45, 0.35);
check(isFinite(model.x) && isFinite(model.y), "contents map to a model point through the shape's centre");

// a piece cut out
check(Layouts.cutOut(di, vp, [{ x: 0.35, y: 0.25 }, { x: 0.55, y: 0.25 }, { x: 0.55, y: 0.42 }, { x: 0.35, y: 0.42 }]), "a piece can be cut out");
vp = Layouts.viewports(doc, info)[0];
check(Layouts.clipLoops(vp).length === 2, "the cut is a second loop");
check(!Layouts.shapeContains(vp, 0.45, 0.33) && Layouts.shapeContains(vp, 0.7, 0.3), "the hole is not in the viewport, the rest still is");
// undo takes the cut away in one step
di.undo();
vp = Layouts.viewports(doc, info)[0];
check(Layouts.clipLoops(vp).length === 1, "one undo puts the cut back");
di.redo();
vp = Layouts.viewports(doc, info)[0];

// rectangle viewport cut: a plain viewport becomes outline + hole
var plain = new RViewportEntity(doc, new RViewportData());
plain.setCenter(new RVector(0.45, 0.35)); plain.setWidth(0.3); plain.setHeight(0.2); plain.setScale(0.002);
plain.setBlockId(info.blockId); plain.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(plain, false));
var plainId = plain.getId();
var byId = function() { var l = Layouts.viewports(doc, info); for (var q = 0; q < l.length; q++) { if (l[q].getId() === plainId) return l[q]; } return undefined; };
var pl = byId();
check(!isNull(pl) && !Layouts.hasClip(pl), "a rectangle has no shape");
check(Layouts.cutOut(di, pl, [{ x: 0.40, y: 0.30 }, { x: 0.48, y: 0.30 }, { x: 0.44, y: 0.40 }]), "cutting a rectangle makes it a shape");
pl = byId();
check(Layouts.clipLoops(pl).length === 2 && Layouts.clipLoops(pl)[0].length === 4, "its outline is its four corners");
check(Layouts.setClip(di, pl, [], "x") && !Layouts.hasClip(byId()), "an empty shape puts the rectangle back");

// a long shape survives a file (strings are cut in pieces)
var big = [];
for (var i = 0; i < 160; i++) { var a = i / 160 * 2 * Math.PI; big.push({ x: 0.45 + 0.25 * Math.cos(a), y: 0.35 + 0.18 * Math.sin(a) }); }
var longVp = new RViewportEntity(doc, new RViewportData());
longVp.setCenter(new RVector(0.45, 0.35)); longVp.setWidth(0.5); longVp.setHeight(0.36); longVp.setScale(0.002);
longVp.setBlockId(info.blockId); longVp.setLayerId(doc.getLayerId("0"));
Layouts._writeClip(longVp, [big]);
di.applyOperation(new RAddObjectOperation(longVp, false));
var rt = QDir.tempPath() + "/cs_shape_rt.dxf";
var filter = "";
var fl = RFileExporterRegistry.getFilterStrings();
for (var f = 0; f < fl.length; f++) { if (String(fl[f]).indexOf("dxflib") !== -1 && String(fl[f]).indexOf("*.dxf") !== -1) { filter = fl[f]; break; } }
check(di.exportFile(rt, filter, false), "saved");
var back = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var bdi = new RDocumentInterface(back);
bdi.importFile(rt, "", false);
var binfo = Layouts.get(back, "S");
var bvps = Layouts.viewports(back, binfo), withClip = bvps.filter(function(v) { return Layouts.hasClip(v); });
check(withClip.length === 2, "both shaped viewports came back from the file: " + withClip.length);
var sizes = withClip.map(function(v) { return Layouts.clipLoops(v)[0].length; }).sort(function(a, b) { return a - b; });
check(sizes[0] === 5 && sizes[1] === 160, "with every corner, even the 160-corner one: " + sizes);
var withHole = withClip.filter(function(v) { return Layouts.clipLoops(v).length === 2; });
check(withHole.length === 1 && !Layouts.shapeContains(withHole[0], 0.45, 0.33), "and the cut-out is still cut out");
// ---- circles are shapes too (a many-sided loop) ----------------------------------------------------
var ring = ViewportShape.circleLoop(0.45, 0.35, 0.2);
check(ring.length === ViewportShape.CIRCLE_SIDES && near(ring[0].x, 0.65) && near(ring[0].y, 0.35), "a circle is a closed loop of " + ring.length + " points");
check(ViewportShape.createPolygon(di, ring), "a circle makes a viewport");
var circ = Layouts.viewports(doc, info).filter(function(v) { return Layouts.hasClip(v) && Layouts.clipLoops(v)[0].length === ViewportShape.CIRCLE_SIDES; })[0];
check(!isNull(circ) && near(circ.getWidth(), 0.4, 1e-6) && near(circ.getHeight(), 0.4, 1e-3), "its box is the circle's bounding square");
check(Layouts.shapeContains(circ, 0.45, 0.35) && !Layouts.shapeContains(circ, 0.45 + 0.2 * 0.9, 0.35 + 0.2 * 0.9), "inside the circle hits, the corner of its box does not");
check(Layouts.cutOut(di, circ, ViewportShape.circleLoop(0.45, 0.35, 0.05)), "a circle can be cut out of it");
circ = Layouts.viewports(doc, info).filter(function(v) { return Layouts.clipLoops(v).length === 2 && Layouts.clipLoops(v)[0].length === ViewportShape.CIRCLE_SIDES; })[0];
check(!isNull(circ) && !Layouts.shapeContains(circ, 0.45, 0.35) && Layouts.shapeContains(circ, 0.45, 0.5), "the round hole is a hole, the ring around it is not");
di.exportFile(rt, filter, false);
var back2 = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var bdi2 = new RDocumentInterface(back2);
bdi2.importFile(rt, "", false);
var rounds = Layouts.viewports(back2, Layouts.get(back2, "S")).filter(function(v) { return Layouts.clipLoops(v).length === 2 && Layouts.clipLoops(v)[1].length === ViewportShape.CIRCLE_SIDES; });
check(rounds.length === 1, "a ring-shaped viewport survives the file");
if (fails === 0) print("### VIEWPORT SHAPE OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
