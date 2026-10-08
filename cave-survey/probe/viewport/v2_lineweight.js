// lineweight behaviour inside a viewport: does a 0.5 mm line stay 0.5 mm at viewport scale 1/50?
include("scripts/library.js");
include("scripts/File/Print/Print.js");
function main() {
    var out = args[args.length - 1];
    var unitName = args[args.length - 2];   // "inch" or "foot"
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(unitName == "foot" ? RS.Foot : RS.Inch);
    var di = new RDocumentInterface(doc);
    var k = unitName == "foot" ? 1 : 12;                  // model units per foot->inch: model is in drawing units
    // model: horizontal line 100 ft long, lineweight 0.5mm (Weight050)
    var lenModel = unitName == "foot" ? 100 : 1200;
    var ln = new RLineEntity(doc, new RLineData(new RVector(0, 0), new RVector(lenModel, 0)));
    ln.setLineweight(RLineweight.Weight050);
    di.applyOperation(new RAddObjectOperation(ln, false));
    var psId = doc.getBlockId("*Paper_Space");
    doc.setCurrentBlock(psId);
    // paper coords: in drawing units (so inch doc -> inches; foot doc -> FEET)
    var pw = unitName == "foot" ? 11 / 12 : 11, ph = unitName == "foot" ? 8.5 / 12 : 8.5;
    var inch = unitName == "foot" ? 1 / 12 : 1;
    var vp = new RViewportEntity(doc, new RViewportData());
    vp.setCenter(new RVector(pw / 2, ph / 2)); vp.setWidth(9 * inch); vp.setHeight(6.5 * inch);
    // 1 in = 50 ft: model 100ft -> 2 in; scale = paper-drawing-units per model-drawing-unit = (1 inch)/(50 ft)
    var scale = unitName == "foot" ? (1 / 12) / 50 : 1 / 600;
    vp.setScale(scale); vp.setViewCenter(new RVector(lenModel / 2, 0)); vp.setBlockId(psId); vp.setLayerId(doc.getLayerId("0"));
    di.applyOperation(new RAddObjectOperation(vp, false));
    // a reference paper-space line, same lineweight, 2 in long
    var ref = new RLineEntity(doc, new RLineData(new RVector(2 * inch, 1 * inch), new RVector(4 * inch, 1 * inch)));
    ref.setLineweight(RLineweight.Weight050);
    di.applyOperation(new RAddObjectOperation(ref, false));
    var scene = new RGraphicsSceneQt(di);
    var view = new RGraphicsViewImage();
    view.setScene(scene);
    doc.setVariable("PageSettings/PaperUnit", RS.Inch);
    doc.setVariable("PageSettings/PaperWidth", 8.5); doc.setVariable("PageSettings/PaperHeight", 11);
    doc.setVariable("PageSettings/PageOrientation", "Landscape");
    doc.setVariable("ColorSettings/ColorMode", "FullColor");
    doc.setVariable("ColorSettings/BackgroundColor", new RColor("white"));
    doc.setVariable("PageSettings/Scale", "1:1");
    doc.setVariable("PageSettings/OffsetX", 0); doc.setVariable("PageSettings/OffsetY", 0);
    doc.setVariable("MultiPageSettings/Rows", 1); doc.setVariable("MultiPageSettings/Columns", 1);
    doc.setVariable("MultiPageSettings/PrintCropMarks", false); doc.setVariable("PageTagSettings/EnablePageTags", false);
    var p = new Print(undefined, doc, view);
    print("unitScale=" + Print.getUnitScale(doc));
    p.print(out + "/lw_" + unitName + ".pdf");
    QCoreApplication.exit(0);
}
main();
