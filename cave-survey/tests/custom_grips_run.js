/** CustomGrips registry + RotateViewport maths and undo (headless: no widgets, no view). */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Widgets/CustomGrips/CustomGrips.js");
include("scripts/Layouts/RotateViewport/RotateViewport.js");
include("scripts/Layouts/ViewportShape/ViewportShape.js");
include("scripts/Layouts/MoveVertex/MoveVertex.js");
var fails = 0;
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-9 : t); }
function check(c, m) { if (!c) { fails++; print("### CUSTOM GRIPS FAILED: " + m); } else print("ok: " + m); }

// ---- the registry ----------------------------------------------------------------
var shown = true;
CustomGrips.register({ id: "t1", shape: "hexagon", size: [20, 20], target: function(e) { return shown ? e.thing : undefined; },
    anchor: function(v, t) { return { x: 1, y: 2 }; }, onClick: function() {} });
CustomGrips.register({ id: "t2", shape: function(p, w, h) { }, size: [10, 10], target: function(e) { return undefined; },
    anchor: function(v, t) { return { x: 0, y: 0 }; } });
check(CustomGrips.list().join() === "t1,t2", "grips are listed in registration order");
check(CustomGrips.applicable({ thing: 7 }).length === 1 && CustomGrips.applicable({ thing: 7 })[0].id === "t1", "only grips whose target exists apply");
shown = false;
check(CustomGrips.applicable({ thing: 7 }).length === 0, "a grip hides when its target goes");
CustomGrips.register({ id: "t1", shape: "circle", size: [8, 8], target: function() { return 1; }, anchor: function() { return { x: 0, y: 0 }; } });
check(CustomGrips.list().length === 2 && CustomGrips.grips.t1.shape === "circle", "registering again replaces, never duplicates");
var threw = false;
try { CustomGrips.register({ id: "bad", shape: "no-such-shape", target: function() {}, anchor: function() {} }); } catch (e) { threw = true; }
check(threw, "an unknown shape is refused");
threw = false;
try { CustomGrips.register({ id: "bad2" }); } catch (e2) { threw = true; }
check(threw, "a grip with no target/anchor is refused");
CustomGrips.unregister("t1");
check(CustomGrips.list().join() === "t2", "unregister removes");
var names = ["diamond", "square", "circle", "triangle-up", "triangle-down", "triangle-left", "triangle-right", "hexagon", "cross"];
var all = true;
for (var i = 0; i < names.length; i++) { all = all && typeof CustomGrips.SHAPES[names[i]] === "function"; }
check(all, "the stock shapes are all there");
var thrower = function() { return CustomGrips.applicable({}); };
CustomGrips.register({ id: "t3", target: function() { throw new Error("x"); }, anchor: function() { return {}; } });
check(thrower().length === 0, "a target that throws just hides its grip");

// ---- RotateViewport -----------------------------------------------------------------
check(RotateViewport.stepFor(10) === 45 && RotateViewport.stepFor(100) === 15 && RotateViewport.stepFor(200) === 5 &&
      RotateViewport.stepFor(300) === 1 && RotateViewport.stepFor(900) === 0.5, "the farther from the centre, the finer the snap");
check(Math.abs(RotateViewport.degrees(Math.PI * 3 / 2) + 90) < 1e-9 && RotateViewport.degrees(Math.PI) === 180, "angles wrap into (-180, 180]");

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var info = Layouts.create(di, { name: "S", paper: "Letter" });
var vp = new RViewportEntity(doc, new RViewportData());
vp.setCenter(new RVector(0.4, 0.3)); vp.setWidth(0.5); vp.setHeight(0.4); vp.setScale(0.002);
vp.setBlockId(info.blockId); vp.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(vp, false));
var id = Layouts.viewports(doc, info)[0].getId();
var rot = function() { return Math.round(RotateViewport.degrees(doc.queryEntity(id).getRotation()) * 1e6) / 1e6; };
check(RotateViewport.start(di, id), "the tool starts on an unlocked viewport");
var a = RotateViewport.current;
a.rotation = 33 * Math.PI / 180; a.show();
check(rot() === 33, "the viewport turns live");
a.rotation = 70 * Math.PI / 180; a.show();
check(rot() === 70, "and keeps following");
a.commit();
check(rot() === 70, "commit keeps the angle");
di.undo();
check(rot() === 0, "ONE undo step returns to where it started (not through every live angle)");
di.redo();
check(rot() === 70, "redo brings it back");
RotateViewport.start(di, id); var b = RotateViewport.current;
b.rotation = 15 * Math.PI / 180; b.show(); b.escapeEvent();
check(rot() === 70, "cancel puts the starting angle back");
var k = function(t) { return { key: function() { return 0; }, text: function() { return t; }, accept: function() {}, ignore: function() {} }; };
RotateViewport.start(di, id); var c = RotateViewport.current;
c.keyPressEvent(k("-")); c.keyPressEvent(k("4")); c.keyPressEvent(k("5"));
check(rot() === -45, "typing an angle sets it exactly: " + rot());
c.commit();
Layouts.setLocked(di, Layouts.viewports(doc, info)[0], true);
check(RotateViewport.start(di, id) === false, "a locked viewport refuses to turn");
// ---- grips with many targets (a polygon's corners)
CustomGrips.register({ id: "many", shape: "square", size: [8, 8], targets: function(e) { return e.pts.map(function(p, i) { return { key: "p" + i, target: p }; }); },
    anchor: function(v, t) { return { x: t, y: t }; } });
var ap = CustomGrips.applicable({ pts: [1, 2, 3] }).filter(function(g) { return g.id === "many"; });
check(ap.length === 3 && ap[0].key === "many#p0" && ap[2].target === 3, "a grip kind can give one grip per target, each with its own key");
check(CustomGrips.applicable({ pts: [] }).filter(function(g) { return g.id === "many"; }).length === 0, "and none when it has no targets");

// ---- Move Vertex
var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc2.setUnit(RS.Foot);
var di2 = new RDocumentInterface(doc2);
var info2 = Layouts.create(di2, { name: "S", paper: "Letter" });
doc2.setCurrentBlock(info2.blockId);
ViewportShape.createPolygon(di2, [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.5 }, { x: 0.1, y: 0.5 }]);
var pv = Layouts.viewports(doc2, info2)[0], pid = pv.getId();
var corners = function() { return Layouts.clipLoops(doc2.queryEntity(pid))[0]; };
var model0 = Layouts.paperToModel(doc2.queryEntity(pid), 0.3, 0.3);
check(MoveVertex.start(di2, pid, 0, 2), "the tool starts on a corner of an unlocked polygon viewport");
var mv = MoveVertex.current;
var ev = function(x, y) { var p = new RVector(x, y); return { getModelPosition: function() { return p; }, button: function() { return Qt.LeftButton; } }; };
mv.mouseMoveEvent(ev(0.8, 0.7));
check(near(corners()[2].x, 0.6) && near(corners()[2].y, 0.5), "while the corner moves nothing in the drawing changes (an outline only: nothing to regenerate)");
mv.mouseReleaseEvent(ev(0.8, 0.7));
check(near(corners()[2].x, 0.8) && near(corners()[2].y, 0.7) && near(corners()[0].x, 0.1), "a click puts the corner down, the others stay");
var grown = doc2.queryEntity(pid);
check(near(grown.getWidth(), 0.7, 1e-9) && near(grown.getHeight(), 0.6, 1e-9), "and the viewport's box grows with it");
var model1 = Layouts.paperToModel(grown, 0.3, 0.3);
check(near(model0.x, model1.x, 1e-6) && near(model0.y, model1.y, 1e-6), "what the map shows at a fixed place on the paper does not slide");
di2.undo();
check(near(corners()[2].x, 0.6) && near(corners()[2].y, 0.5), "one undo puts it back where it was before the whole move");
di2.redo();
check(near(corners()[2].x, 0.8), "redo moves it again");
MoveVertex.start(di2, pid, 0, 0);
var mv2 = MoveVertex.current;
mv2.mouseMoveEvent(ev(0.0, 0.0));
mv2.escapeEvent();
check(near(corners()[0].x, 0.1) && near(corners()[0].y, 0.1), "Escape leaves the corner where it was");
// ---- a TURNED viewport: moving a corner must not move the map either
function forward(vp, mx, my) {     // where the engine puts a model point on the paper
    var c = vp.getCenter(), vc = vp.getViewCenter(), s = vp.getScale(), a = vp.getRotation();
    var dx = (mx - vc.x) * s, dy = (my - vc.y) * s;
    return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
var turned = doc2.queryEntity(pid);
turned.setRotation(35 * Math.PI / 180);
turned.setViewCenter(new RVector(12345, 6789));
di2.applyOperation(new RModifyObjectOperation(turned, false));
var probe = { x: 12350, y: 6795 };
var p0 = forward(doc2.queryEntity(pid), probe.x, probe.y);
MoveVertex.start(di2, pid, 0, 1);
var mv3 = MoveVertex.current;
mv3.mouseMoveEvent(ev(0.9, 0.05));
mv3.mouseReleaseEvent(ev(0.9, 0.05));
var p1 = forward(doc2.queryEntity(pid), probe.x, probe.y);
check(near(p0.x, p1.x, 1e-9) && near(p0.y, p1.y, 1e-9), "moving a corner of a TURNED viewport leaves every model point at the same place on the paper: (" + p0.x.toFixed(6) + "," + p0.y.toFixed(6) + ") vs (" + p1.x.toFixed(6) + "," + p1.y.toFixed(6) + ")");
var p2 = forward(doc2.queryEntity(pid), probe.x, probe.y);
check(near(p0.x, p2.x, 1e-9) && near(p0.y, p2.y, 1e-9), "and after it is put down");
Layouts.setLocked(di2, doc2.queryEntity(pid), true);
check(MoveVertex.start(di2, pid, 0, 1) === false, "a locked viewport's corners do not move");
if (fails === 0) print("### CUSTOM GRIPS OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
