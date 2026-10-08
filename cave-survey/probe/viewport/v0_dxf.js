// V0 spike e: baseline - what survives DXF save/reload today
include("scripts/library.js");
function main() {
    var out = args[args.length - 1];
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Millimeter);
    var di = new RDocumentInterface(doc);
    di.applyOperation(new RAddObjectOperation(new RLineEntity(doc, new RLineData(new RVector(0, 0), new RVector(10, 10))), false));
    var psId = doc.getBlockId("*Paper_Space");
    doc.setCurrentBlock(psId);
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(100, 75)); vp.setWidth(150); vp.setHeight(100); vp.setScale(2);
    vp.setViewCenter(new RVector(5, 5)); vp.setBlockId(psId); vp.setLayerId(doc.getLayerId("0"));
    di.applyOperation(new RAddObjectOperation(vp, false));
    di.applyOperation(new RAddObjectOperation(new RLineEntity(doc, new RLineData(new RVector(5, 5), new RVector(195, 5))), false));
    print("before: viewports=" + doc.queryAllEntities(false, true, RS.EntityViewport).length +
          " paperEnts=" + doc.queryBlockEntities(psId).length + " layouts? blockLayout=" + doc.queryBlock("*Paper_Space").getLayoutName());
    var filter = "";
    var fs = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < fs.length; i++) { if (String(fs[i]).indexOf("dxflib") >= 0 && String(fs[i]).indexOf("2000") >= 0) { filter = fs[i]; break; } }
    var path = out + "/baseline.dxf";
    print("export: " + di.exportFile(path, filter, false));
    var back = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    var bi = new RDocumentInterface(back);
    print("import: " + bi.importFile(path, "", false));
    var bps = back.getBlockId("*Paper_Space");
    print("after: viewports=" + back.queryAllEntities(false, true, RS.EntityViewport).length +
          " paperEnts=" + back.queryBlockEntities(bps).length + " blocks=" + back.getBlockNames());
    QCoreApplication.exit(0);
}
main();
