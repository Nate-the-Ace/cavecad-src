// V0 spike: does a viewport in *Paper_Space render model space, headless?
// run: CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart probe/viewport/v0_render.js "$PWD" OUTDIR
include("scripts/library.js");
include("scripts/File/BitmapExport/BitmapExportWorker.js");

function main() {
    var out = args[args.length - 1];
    var storage = new RMemoryStorage();
    var doc = new RDocument(storage, new RSpatialIndexSimple());
    doc.setUnit(RS.Millimeter);
    var di = new RDocumentInterface(doc);

    var names = ["current", "model", "paper"];
    print("blocks: " + doc.getBlockNames());
    print("paperSpaceId: " + doc.getBlockId("*Paper_Space"));
    print("modelId: " + doc.getModelSpaceBlockId());

    var op = new RAddObjectsOperation();
    var ox = 1000, oy = 2000;
    for (var i = 0; i <= 10; i++) {
        op.addObject(new RLineEntity(doc, new RLineData(new RVector(ox + i * 10, oy), new RVector(ox + i * 10, oy + 100))));
        op.addObject(new RLineEntity(doc, new RLineData(new RVector(ox, oy + i * 10), new RVector(ox + 100, oy + i * 10))));
    }
    op.addObject(new RCircleEntity(doc, new RCircleData(new RVector(ox + 50, oy + 50), 30)));
    op.apply(doc);

    var psId = doc.getBlockId("*Paper_Space");
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(100, 75));
    vp.setWidth(150);
    vp.setHeight(100);
    vp.setScale(0.8);
    vp.setViewCenter(new RVector(ox + 50, oy + 50));
    vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(psId);
    vp.setLayerId(doc.getLayerId("0"));
    var op2 = new RAddObjectOperation(vp, false);
    op2.setTransactionGroup && 0;
    di.applyOperation(op2);

    // paper-space frame
    var op3 = new RAddObjectsOperation();
    var fr = new RLineEntity(doc, new RLineData(new RVector(5, 5), new RVector(195, 5)));
    fr.setBlockId(psId);
    op3.addObject(fr);
    op3.apply(doc);

    var vids = doc.queryAllEntities(false, true, RS.EntityViewport);
    var ve = doc.queryEntity(vids[0]);
    print("viewport block: " + ve.getBlockId() + " (paper=" + psId + ")");
    print("viewport count: " + doc.queryAllEntities(false, true, RS.EntityViewport).length);
    print("paper block entities: " + doc.queryBlockEntities(psId).length);

    doc.setCurrentBlock(psId);
    var scene = new RGraphicsSceneQt(di);
    var view = new RGraphicsViewImage();
    view.setScene(scene, false);
    var ok = exportBitmap(doc, scene, out + "/paper.png", {
        width: 800, height: 600, zoomAll: true, margin: 10,
        backgroundColor: new RColor("white"), antialiasing: true
    }, view);
    print("export paper: " + ok);

    doc.setCurrentBlock(doc.getModelSpaceBlockId());
    var scene2 = new RGraphicsSceneQt(di);
    var view2 = new RGraphicsViewImage();
    view2.setScene(scene2, false);
    ok = exportBitmap(doc, scene2, out + "/model.png", {
        width: 800, height: 600, zoomAll: true, margin: 10,
        backgroundColor: new RColor("white")
    }, view2);
    print("export model: " + ok);
    QCoreApplication.exit(0);
}
main();
