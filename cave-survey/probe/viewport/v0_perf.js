// V0 spike c: cost of viewports against a big model. args: N entities, V viewports
include("scripts/library.js");
include("scripts/File/BitmapExport/BitmapExportWorker.js");
function main() {
    var out = args[args.length - 1];
    var nv = args[args.length - 2].split("x"); var N = parseInt(nv[0]), V = parseInt(nv[1]);
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Millimeter);
    var di = new RDocumentInterface(doc);
    var t0 = new Date().getTime();
    var op = new RAddObjectsOperation();
    var side = Math.ceil(Math.sqrt(N));
    for (var i = 0; i < N; i++) {
        var x = (i % side) * 2, y = Math.floor(i / side) * 2;
        op.addObject(new RLineEntity(doc, new RLineData(new RVector(x, y), new RVector(x + 1, y + 1))));
    }
    op.apply(doc);
    print("built " + N + " in " + (new Date().getTime() - t0) + " ms");
    var psId = doc.getBlockId("*Paper_Space");
    doc.setCurrentBlock(psId);
    var vops = new RAddObjectsOperation();
    for (var v = 0; v < V; v++) {
        var vp = new RViewportEntity(doc, new RViewportData());
        vp.setCenter(new RVector(60 + v * 110, 60)); vp.setWidth(100); vp.setHeight(100);
        vp.setScale(1.0); vp.setViewCenter(new RVector(50 + v * 120, 50)); vp.setViewTarget(new RVector(0, 0));
        vp.setBlockId(psId); vp.setLayerId(doc.getLayerId("0"));
        vops.addObject(vp, false);
    }
    vops.apply(doc);
    var scene = new RGraphicsSceneQt(di);
    var view = new RGraphicsViewImage();
    view.setScene(scene, false);
    var t1 = new Date().getTime();
    var ok = exportBitmap(doc, scene, out + "/perf_" + N + "_" + V + ".png", { width: 1000, height: 400, zoomAll: true, margin: 10, backgroundColor: new RColor("white") }, view);
    print("N=" + N + " V=" + V + " export ms=" + (new Date().getTime() - t1) + " ok=" + ok);
    QCoreApplication.exit(0);
}
main();
