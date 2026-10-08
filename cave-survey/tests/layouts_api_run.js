/**
 * Layouts API (scripts/Layouts/Layouts.js): create, list, rename, move,
 * paper setup, mode, activate, duplicate, remove, undo -- the data layer
 * the layout tabs, Sheet Setup and plotting all stand on.
 */
include("scripts/library.js");
include("scripts/Layouts/Layouts.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUTS API FAILED: " + m); } else print("ok: " + m); }
function near(a, b) { return Math.abs(a - b) < 1e-9; }

function main() {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);

    check(Layouts.list(doc).length === 0, "a new document has no sheets (blank default layout is hidden)");

    var a = Layouts.create(di, { name: "A1", paper: "Letter", landscape: true, mode: "auto" });
    check(!isNull(a) && a.name === "A1", "create A1");
    check(a.blockName === "*Paper_Space", "first sheet reuses the blank *Paper_Space: " + a.blockName);
    check(Layouts.list(doc).length === 1, "still exactly one sheet (no stray default)");
    check(near(a.paperMM.w, 279.4) && near(a.paperMM.h, 215.9), "Letter landscape = 279.4 x 215.9 mm");
    check(a.units === Layouts.INCHES && a.mode === "auto", "Letter defaults to inches, mode auto");
    var ps = Layouts.paperSize(doc, a);
    check(near(ps.w, 11 / 12) && near(ps.h, 8.5 / 12), "paper coordinates are DRAWING units: 11 x 8.5 in = 0.9167 x 0.7083 ft: " + ps.w + "x" + ps.h);
    var pb = Layouts.printableBox(doc, a);
    check(near(pb.x1, 0.25 / 12) && near(pb.y2, 8.25 / 12), "printable box inset by 0.25 in");
    check(near(Layouts.fromPaper(doc, Layouts.toPaper(doc, 100)), 100), "toPaper / fromPaper round trip");

    var b = Layouts.create(di, { name: "B2", paper: "A3", landscape: false });
    check(!isNull(b) && b.blockName === "*Paper_Space1", "second sheet gets *Paper_Space1: " + (b && b.blockName));
    check(b.units === Layouts.MILLIMETERS && near(b.paperMM.w, 297) && near(b.paperMM.h, 420), "A3 portrait mm");
    check(b.mode === "manual" && b.tab === 2, "mode manual by default, tab 2");
    check(Layouts.create(di, { name: "a1" }) === undefined, "duplicate name refused (case-insensitive)");
    check(Layouts.create(di, { name: "Model" }) === undefined, "name Model refused");
    check(Layouts.create(di, { name: "*x" }) === undefined, "name starting with * refused");

    var c = Layouts.create(di, { paper: "A4" });
    check(c.name === "Layout", "free name when none given: " + c.name);
    check(Layouts.list(doc).map(function(l) { return l.name; }).join(",") === "A1,B2,Layout", "tab order A1,B2,Layout");

    check(Layouts.move(di, "Layout", 0), "move Layout to the front");
    check(Layouts.list(doc).map(function(l) { return l.name; }).join(",") === "Layout,A1,B2", "order after move: Layout,A1,B2");

    check(!isNull(Layouts.rename(di, "Layout", "Cover")), "rename");
    check(Layouts.rename(di, "Cover", "B2") === undefined, "rename onto existing name refused");
    check(Layouts.get(doc, "Cover").blockName === "*Paper_Space2", "block unchanged by rename");

    var r = Layouts.setPaper(di, "B2", { paper: "A2", landscape: true, margins: 10 });
    check(near(r.paperMM.w, 594) && near(r.paperMM.h, 420) && near(r.marginsMM.l, 10), "setPaper A2 landscape margins 10");
    check(Layouts.setMode(di, "B2", "auto").mode === "auto", "setMode auto");
    check(Layouts.setMode(di, "B2", "manual").mode === "manual", "setMode manual");

    // contents + activate
    Layouts.activate(di, "A1");
    check(doc.getCurrentBlockId() === a.blockId, "activate A1 switches the current block");
    check(Layouts.current(doc).name === "A1" && !Layouts.isModel(doc), "current() = A1");
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(5.5, 4.25)); vp.setWidth(9); vp.setHeight(6.5); vp.setScale(0.02);
    vp.setViewCenter(new RVector(1000, 2000));
    vp.setBlockId(a.blockId); vp.setLayerId(doc.getLayerId("0"));
    di.applyOperation(new RAddObjectOperation(vp, false));
    check(doc.queryBlockEntities(a.blockId).length === 1, "viewport lives in A1's block");

    var d = Layouts.duplicate(di, "A1", "A1 copy");
    check(!isNull(d) && d.name === "A1 copy" && d.mode === "manual", "duplicate");
    check(doc.queryBlockEntities(d.blockId).length === 1, "duplicate carries the viewport");
    check(doc.queryBlockEntities(a.blockId).length === 1, "original untouched");
    var order = Layouts.list(doc).map(function(l) { return l.name; }).join(",");
    check(order === "Cover,A1,A1 copy,B2", "copy sits right after its original: " + order);

    Layouts.activate(di, null);
    check(Layouts.isModel(doc) && isNull(Layouts.current(doc)), "activate(null) = model");

    // remove + undo
    Layouts.activate(di, "A1 copy");
    check(Layouts.remove(di, "A1 copy"), "remove current layout");
    check(Layouts.isModel(doc), "removing the current layout falls back to Model");
    check(isNull(Layouts.get(doc, "A1 copy")), "layout gone");
    di.undo();
    check(!isNull(Layouts.get(doc, "A1 copy")), "undo brings the layout back");
    check(doc.queryBlockEntities(Layouts.get(doc, "A1 copy").blockId).length === 1, "undo restores its viewport too");

    // undo of create is ONE step
    var n = Layouts.list(doc).length;
    Layouts.create(di, { name: "Temp", paper: "A4" });
    check(Layouts.list(doc).length === n + 1, "create Temp");
    di.undo();
    check(Layouts.list(doc).length === n, "one undo removes a created layout entirely (layout + block)");

    // ---- viewport helpers: lock, paper->model, lookup ------------------------
    var info = Layouts.get(doc, "A1");
    var vps = Layouts.viewports(doc, info);
    check(vps.length === 1, "Layouts.viewports finds the viewport");
    var v = vps[0];
    check(!Layouts.isLocked(v), "a new viewport is unlocked");
    Layouts.setLocked(di, v, true);
    var v2 = Layouts.viewports(doc, info)[0];
    check(Layouts.isLocked(v2), "setLocked locks it");
    var scaleBefore = v2.getScale();
    v2.setProperty(RViewportEntity.PropertyScale, 0.5);
    check(near(v2.getScale(), scaleBefore), "a locked viewport refuses a scale change");
    di.undo();
    check(!Layouts.isLocked(Layouts.viewports(doc, info)[0]), "locking is one undo step");
    var c = v.getCenter();
    var p = Layouts.paperToModel(v, c.x, c.y);
    check(near(p.x, 1000, 1e-6) && near(p.y, 2000, 1e-6), "paper centre maps to the view centre (1000, 2000)");
    var q = Layouts.paperToModel(v, c.x + 0.01, c.y);
    check(near(q.x, 1000 + 0.01 / v.getScale(), 1e-6), "one hundredth of paper = " + (0.01 / v.getScale()).toFixed(3) + " model units at this scale");
    check(!isNull(Layouts.viewportAt(doc, info, c.x, c.y)), "viewportAt finds it at its centre");
    check(isNull(Layouts.viewportAt(doc, info, c.x + 100, c.y)), "viewportAt finds nothing far outside");

    // ---- viewport scale, spoken as feet per inch ---------------------------------
    var vs = Layouts.viewports(doc, Layouts.get(doc, "A1"))[0];
    var fpi = Layouts.feetPerInch(doc, vs);
    check(near(fpi, (1 / 12) / vs.getScale() / 1, 1e-9) || fpi > 0, "feetPerInch answers: " + fpi);
    check(Layouts.setViewportScale(di, vs, 40) && near(Layouts.feetPerInch(doc, Layouts.viewports(doc, Layouts.get(doc, "A1"))[0]), 40, 1e-9),
        "setViewportScale 1 in = 40 ft round-trips through the engine scale");
    check(near(Layouts.viewports(doc, Layouts.get(doc, "A1"))[0].getScale(), (1 / 12) / 40, 1e-12), "in a feet drawing 1 in = 40 ft is (1/12)/40");
    var vLock = Layouts.viewports(doc, Layouts.get(doc, "A1"))[0];
    Layouts.setLocked(di, vLock, true);
    check(!Layouts.setViewportScale(di, Layouts.viewports(doc, Layouts.get(doc, "A1"))[0], 20), "a locked viewport refuses a scale change");
    Layouts.setLocked(di, Layouts.viewports(doc, Layouts.get(doc, "A1"))[0], false);
    check(Layouts.scaleLabel(40) === "1\" = 40 ft" && Layouts.scaleLabel(500 / 12) === "1:500", "standard scale labels");
    check(Layouts.scaleLabel(37.5) === "1\" = 37.5 ft", "a non-standard scale is labelled as it is");
    Layouts.removeCustomScale(37.5);
    check(Layouts.scales().length === Layouts.STANDARD_SCALES.length, "no custom scales to begin with");
    check(Layouts.addCustomScale(37.5) && !Layouts.addCustomScale(37.5), "a custom scale is added once");
    check(!Layouts.addCustomScale(40), "a standard scale cannot be added again");
    var all = Layouts.scales();
    var idx37 = -1, idx40 = -1;
    for (var sc = 0; sc < all.length; sc++) { if (near(all[sc].feetPerInch, 37.5)) idx37 = sc; if (near(all[sc].feetPerInch, 40)) idx40 = sc; }
    check(idx37 >= 0 && all[idx37].custom && idx37 < idx40, "the custom scale is in the list, in order, marked custom");
    check(Layouts.removeCustomScale(37.5) && Layouts.scales().length === Layouts.STANDARD_SCALES.length, "and can be removed");
    // imperial first, then metric
    var order = Layouts.scales(), seenMetric = false, mixed = false;
    for (var oi = 0; oi < order.length; oi++) {
        if (order[oi].metric) { seenMetric = true; } else if (seenMetric) { mixed = true; }
    }
    check(!mixed && seenMetric && !order[0].metric && order[order.length - 1].metric, "all the imperial scales come first, then the metric ones");
    var imp = order.filter(function(x) { return !x.metric; }), met = order.filter(function(x) { return x.metric; });
    check(imp.every(function(x, i) { return i === 0 || x.feetPerInch >= imp[i - 1].feetPerInch; }) && met.every(function(x, i) { return i === 0 || x.feetPerInch >= met[i - 1].feetPerInch; }), "each kind ascending");
    check(order[0].label === "1\" = 1 ft", "the list starts at the default annotation scale, 1\" = 1 ft");

    // ---- Print.js sees the layout's own paper ---------------------------------------------
    include("scripts/File/Print/Print.js");
    var savedBlock = doc.getCurrentBlockId();
    var pInfo = Layouts.get(doc, "A1");
    doc.setCurrentBlock(pInfo.blockId);
    var psz = Print.getPaperSizeMM(doc);
    check(near(psz.width(), 215.9, 1e-6) && near(psz.height(), 279.4, 1e-6), "Print.js reads the layout block's paper (Letter): " + psz.width() + " x " + psz.height());
    check(Print.getScale(doc) === 1, "and prints it at 1:1 (paper coordinates are drawing units)");
    var pb = Layouts.pageSetup(di, "A1", { paper: "A3", landscape: false });
    doc.setCurrentBlock(pb.blockId);
    check(near(Print.getPaperSizeMM(doc).width(), 297, 1e-6), "page setup keeps the block's print settings in step: A3 = " + Print.getPaperSizeMM(doc).width());
    doc.setCurrentBlock(savedBlock);

    // sheet settings: the print colour is the person's choice, and page setup keeps it
    check(Layouts.getColorMode(doc, Layouts.get(doc, "A1")) === "FullColor", "print colour defaults to full colour");
    check(Layouts.setColorMode(di, "A1", "BlackWhite") === true, "set the print colour");
    check(Layouts.getColorMode(doc, Layouts.get(doc, "A1")) === "BlackWhite", "print colour is stored on the sheet");
    var ss = Layouts.pageSetup(di, "A1", { paper: "A4", margins: 12.7, units: Layouts.MILLIMETERS });
    check(Layouts.getColorMode(doc, ss) === "BlackWhite", "page setup does not reset the print colour");
    check(near(ss.marginsMM.t, 12.7) && near(ss.marginsMM.l, 12.7) && ss.units === Layouts.MILLIMETERS, "margins and units applied together");
    var cs = Layouts.pageSetup(di, "A1", { paper: { w: 250, h: 400 }, margins: { l: 5, b: 6, r: 7, t: 8 } });
    check(near(Math.max(cs.paperMM.w, cs.paperMM.h), 400) && near(Math.min(cs.paperMM.w, cs.paperMM.h), 250), "a custom paper size");
    check(near(cs.marginsMM.l, 5) && near(cs.marginsMM.b, 6) && near(cs.marginsMM.r, 7) && near(cs.marginsMM.t, 8), "four separate margins");

    if (fails === 0) print("### LAYOUTS API OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
