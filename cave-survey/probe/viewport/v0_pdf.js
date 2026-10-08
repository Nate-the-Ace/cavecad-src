// V0 spike d: print a paper-space layout to PDF through Print.js unchanged
include("scripts/library.js");
include("scripts/File/Print/Print.js");
function main() {
    var out = args[args.length - 1];
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Inch);
    var di = new RDocumentInterface(doc);
    var ox = 500000, oy = 3900000;
    var op = new RAddObjectsOperation();
    for (var i = 0; i <= 10; i++) {
        op.addObject(new RLineEntity(doc, new RLineData(new RVector(ox + i * 10, oy), new RVector(ox + i * 10, oy + 100))));
        op.addObject(new RLineEntity(doc, new RLineData(new RVector(ox, oy + i * 10), new RVector(ox + 100, oy + i * 10))));
    }
    op.apply(doc);
    var psId = doc.getBlockId("*Paper_Space");
    doc.setCurrentBlock(psId);
    // paper in INCHES on an 11x8.5 sheet; scale 1in = 20ft  => 0.05
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(5.5, 4.25)); vp.setWidth(9); vp.setHeight(6.5);
    vp.setScale(0.07); vp.setViewCenter(new RVector(ox + 50, oy + 50)); vp.setViewTarget(new RVector(0, 0));
    vp.setBlockId(psId); vp.setLayerId(doc.getLayerId("0"));
    di.applyOperation(new RAddObjectOperation(vp, false));

    var scene = new RGraphicsSceneQt(di);
    var view = new RGraphicsViewImage();
    view.setScene(scene);
    // paper settings: paper unit inch, letter landscape, 1:1, no offset
    doc.setVariable("PageSettings/PaperUnit", RS.Inch);
    doc.setVariable("PageSettings/PaperWidth", 8.5);
    doc.setVariable("PageSettings/PaperHeight", 11);
    doc.setVariable("PageSettings/PageOrientation", "Landscape");
    doc.setVariable("ColorSettings/ColorMode", "FullColor");
    doc.setVariable("ColorSettings/BackgroundColor", new RColor("white"));
    doc.setVariable("PageSettings/Scale", "1:1");
    doc.setVariable("PageSettings/OffsetX", 0);
    doc.setVariable("PageSettings/OffsetY", 0);
    doc.setVariable("MultiPageSettings/Rows", 1);
    doc.setVariable("MultiPageSettings/Columns", 1);
    doc.setVariable("MultiPageSettings/PrintCropMarks", false);
    doc.setVariable("PageTagSettings/EnablePageTags", false);
    var print_ = new Print(undefined, doc, view);
    print("unitScale=" + Print.getUnitScale(doc) + " scale=" + Print.getScale(doc));
    print_.print(out + "/layout.pdf");
    print("printed");
    QCoreApplication.exit(0);
}
main();
