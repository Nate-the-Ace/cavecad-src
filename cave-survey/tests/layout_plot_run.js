/**
 * Layout PDF plot: two layouts of different paper sizes go into ONE pdf,
 * one page each at the right size; the document is left as it was found.
 */
include("scripts/library.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Layouts/LayoutPlot.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT PLOT FAILED: " + m); } else print("ok: " + m); }

function readText(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly)) return "";
    var ts = new QTextStream(f);
    var s = ts.readAll();
    f.close();
    return s;
}

function main() {
    var out = QDir.tempPath() + "/cs_layout_plot.pdf";
    QFile.remove(out);
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    var ox = 500000, oy = 3900000;
    var op = new RAddObjectsOperation();
    op.addObject(new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50))), false);
    op.apply(doc);

    var a = Layouts.create(di, { name: "A1", paper: "Letter", landscape: true });
    var b = Layouts.create(di, { name: "B2", paper: "A3", landscape: false });
    function vp(info, w, h, scale) {
        var s = Layouts.paperSize(doc, info);
        doc.setCurrentBlock(info.blockId);
        var v = new RViewportEntity(doc, new RViewportData());
        v.setCenter(new RVector(s.w / 2, s.h / 2)); v.setWidth(w); v.setHeight(h); v.setScale(scale);
        v.setViewCenter(new RVector(ox + 50, oy + 25)); v.setBlockId(info.blockId); v.setLayerId(doc.getLayerId("0"));
        di.applyOperation(new RAddObjectOperation(v, false));
    }
    vp(a, Layouts.toPaper(doc, 250), Layouts.toPaper(doc, 180), (1 / 12) / 50);
    vp(b, Layouts.toPaper(doc, 250), Layouts.toPaper(doc, 380), (1 / 12) / 25);
    doc.setCurrentBlock(doc.getModelSpaceBlockId());

    doc.setVariable("PageSettings/Scale", "1:50");
    doc.setVariable("PageSettings/OffsetX", 123);
    var res = LayoutPlot.exportPdf(di, null, out);
    check(res.ok, "export ok " + res.error);
    check(res.pages === 2 && res.names.join(",") === "A1,B2", "two pages in tab order: " + res.names.join(","));
    check(doc.getCurrentBlockId() === doc.getModelSpaceBlockId(), "current block put back");
    check(doc.getVariable("PageSettings/Scale") === "1:50" && doc.getVariable("PageSettings/OffsetX") === 123, "the document's own page variables are back as they were");

    var data = readText(out);
    check(data.length > 500 && data.indexOf("%PDF") === 0, "a PDF was written: " + data.length + " bytes");
    var boxes = data.match(/\/MediaBox\s*\[[^\]]*\]/g) || [];
    check(boxes.length === 2, "two page boxes: " + boxes.length);
    function dims(box) {
        var nums = box.replace(/[^0-9. \-]/g, " ").trim().split(/\s+/).map(Number);
        return { w: (nums[2] - nums[0]) / 72 * 25.4, h: (nums[3] - nums[1]) / 72 * 25.4 };
    }
    if (boxes.length === 2) {
        var d1 = dims(boxes[0]), d2 = dims(boxes[1]);
        check(Math.abs(d1.w - 279.4) < 1.5 && Math.abs(d1.h - 215.9) < 1.5, "page 1 is Letter landscape: " + d1.w.toFixed(1) + " x " + d1.h.toFixed(1));
        check(Math.abs(d2.w - 297) < 1.5 && Math.abs(d2.h - 420) < 1.5, "page 2 is A3 portrait: " + d2.w.toFixed(1) + " x " + d2.h.toFixed(1));
    }
    check(!LayoutPlot.exportPdf(di, ["nope"], out).ok, "unknown layout name plots nothing");

    if (fails === 0) print("### LAYOUT PLOT OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
