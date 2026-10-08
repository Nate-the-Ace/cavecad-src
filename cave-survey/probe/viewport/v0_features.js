// V0 spike b: clip, twist, two viewports w/ different frozen layers, text, hatch, dashed linetype
include("scripts/library.js");
include("scripts/File/BitmapExport/BitmapExportWorker.js");

function add(doc, di, e) {
    var op = new RAddObjectOperation(e, false);
    di.applyOperation(op);
}

function main() {
    var out = args[args.length - 1];
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Millimeter);
    var di = new RDocumentInterface(doc);

    // layers
    var lyA = new RLayer(doc, "WALLS", false, false, new RColor(255, 0, 0), doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight025, false);
    var lyB = new RLayer(doc, "NOTES", false, false, new RColor(0, 0, 255), doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight025, false);
    di.applyOperation(new RAddObjectOperation(lyA, false));
    di.applyOperation(new RAddObjectOperation(lyB, false));
    var idA = doc.getLayerId("WALLS"), idB = doc.getLayerId("NOTES");
    print("layers: " + idA + " " + idB);

    // model content, big coordinates
    doc.setCurrentBlock(doc.getModelSpaceBlockId());
    var ox = 500000, oy = 3900000;
    var pl = new RPolyline();
    pl.appendVertex(new RVector(ox, oy)); pl.appendVertex(new RVector(ox + 60, oy + 10));
    pl.appendVertex(new RVector(ox + 90, oy + 70)); pl.appendVertex(new RVector(ox + 20, oy + 90));
    pl.setClosed(true);
    var e1 = new RPolylineEntity(doc, new RPolylineData(pl)); e1.setLayerId(idA); add(doc, di, e1);
    var t1 = new RTextEntity(doc, new RTextData(new RVector(ox + 10, oy + 40), new RVector(ox + 10, oy + 40), 8, 1, RS.VAlignBase, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1, "ROOM", "Standard", false, false, 0, false));
    t1.setLayerId(idB); add(doc, di, t1);
    var c = new RCircleEntity(doc, new RCircleData(new RVector(ox + 45, oy + 45), 60)); c.setLayerId(idA); add(doc, di, c);

    var psId = doc.getBlockId("*Paper_Space");
    doc.setCurrentBlock(psId);
    function viewport(cx, cy, w, h, scale, rot, frozen) {
        var vp = new RViewportEntity(doc, new RViewportData());
        vp.setCenter(new RVector(cx, cy)); vp.setWidth(w); vp.setHeight(h);
        vp.setScale(scale); vp.setRotation(rot);
        vp.setViewCenter(new RVector(ox + 45, oy + 45)); vp.setViewTarget(new RVector(0, 0));
        vp.setBlockId(psId); vp.setLayerId(doc.getLayerId("0"));
        if (frozen) vp.setFrozenLayerIds(frozen);
        add(doc, di, vp);
        return vp;
    }
    viewport(60, 60, 100, 100, 1.0, 0, null);              // clipped: circle r=60 overflows 100 box? scale1 -> r60 vs half 50
    viewport(190, 60, 100, 100, 0.8, Math.PI / 6, [idB]);  // twisted 30deg, NOTES frozen
    var fr = new RLineEntity(doc, new RLineData(new RVector(5, 5), new RVector(245, 5)));
    add(doc, di, fr);
    var tt = new RTextEntity(doc, new RTextData(new RVector(10, 8), new RVector(10, 8), 5, 1, RS.VAlignBase, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1, "PAPER TITLE", "Standard", false, false, 0, false));
    add(doc, di, tt);

    print("paper entities: " + doc.queryBlockEntities(psId).length);
    print("model entities: " + doc.queryBlockEntities(doc.getModelSpaceBlockId()).length);
    var scene = new RGraphicsSceneQt(di);
    var view = new RGraphicsViewImage();
    view.setScene(scene, false);
    var ok = exportBitmap(doc, scene, out + "/features.png", {
        width: 1000, height: 500, zoomAll: true, margin: 10, backgroundColor: new RColor("white")
    }, view);
    print("export: " + ok);
    QCoreApplication.exit(0);
}
main();
