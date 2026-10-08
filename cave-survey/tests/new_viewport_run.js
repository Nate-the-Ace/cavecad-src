/** New Viewport: the viewport that comes out of two clicks (headless: the arithmetic and the operation). */
include("scripts/library.js");
include("scripts/EAction.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Layouts/NewViewport/NewViewport.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### NEW VIEWPORT FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-9 : t); }

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
var wall = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 480, oy + 150)));
di.applyOperation(new RAddObjectOperation(wall, false));
var info = Layouts.create(di, { name: "Manual", paper: "Tabloid", landscape: true });
doc.setCurrentBlock(info.blockId);

var ext = NewViewport.modelExtents(doc);
check(ext !== undefined && near(ext.maxX - ext.minX, 480, 1e-6), "model extents are read from model space only");

// a 14 x 8 inch viewport on a cave 480 x 150 ft
var inch = Layouts.paperInch(doc);
var fpi = NewViewport.fitScale(doc, 14 * inch, 8 * inch, ext);
check(fpi === 40, "480 ft across 14 in * 0.95 needs 36.1 ft/in: the next standard scale is 1 in = 40 ft (got " + fpi + ")");
check(NewViewport.fitScale(doc, 14 * inch, 8 * inch, undefined) === 40, "an empty model opens at 1 in = 40 ft");
check(NewViewport.fitScale(doc, 1 * inch, 1 * inch, ext) === 500 || NewViewport.fitScale(doc, 1 * inch, 1 * inch, ext) > 400, "a tiny viewport takes the coarsest standard scale that fits");

var stub = {
    getCorners: function() { return [new RVector(1, 1), new RVector(1 + 14 * inch, 1), new RVector(1 + 14 * inch, 1 + 8 * inch), new RVector(1, 1 + 8 * inch)]; },
    getDocument: function() { return doc; },
    getToolTitle: function() { return "New Viewport"; }
};
var op = NewViewport.prototype.getOperation.call(stub, false);
check(!isNull(op), "two corners make an operation");
di.applyOperation(op);
var made = Layouts.viewports(doc, Layouts.get(doc, "Manual"));
check(made.length === 1, "one viewport on the layout");
var v = made[0];
check(near(v.getWidth(), 14 * inch, 1e-9) && near(v.getHeight(), 8 * inch, 1e-9), "its size is the rectangle's");
check(near(Layouts.feetPerInch(doc, v), 40, 1e-9), "opens at 1 in = 40 ft");
check(near(v.getViewCenter().x, ox + 240, 1e-6) && near(v.getViewCenter().y, oy + 75, 1e-6), "centred on the model's extents (absolute coordinates)");
check(String(v.getCustomProperty("CaveCAD", "NoRaster")) === "1", "no raster images by default (privacy)");
check(!Layouts.isLocked(v), "a hand-made viewport starts unlocked");
check(v.getBlockId() === info.blockId, "it is on the layout, not in model space");

var prev = NewViewport.prototype.getOperation.call(stub, true);
check(!isNull(prev), "a preview operation exists too (a rectangle outline)");
var zero = { getCorners: function() { return [new RVector(0, 0), new RVector(0, 0), new RVector(0, 0), new RVector(0, 0)]; }, getDocument: stub.getDocument, getToolTitle: stub.getToolTitle };
check(isNull(NewViewport.prototype.getOperation.call(zero, false)), "a zero-size rectangle makes nothing");
if (fails === 0) print("### NEW VIEWPORT OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
