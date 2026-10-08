// V1: read QCAD's own flange.dxf (4 viewports on one layout) and render its paper space
include("scripts/library.js");
include("scripts/File/BitmapExport/BitmapExportWorker.js");
function main() {
    var out = args[args.length - 1];
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    print("import: " + di.importFile("/Users/nathanschonegg/Documents/github/cavecad-src/examples/flange.dxf", "", false));
    print("blocks: " + doc.getBlockNames());
    var vps = doc.queryAllEntities(false, true, RS.EntityViewport);
    print("viewports: " + vps.length);
    for (var i = 0; i < vps.length; i++) {
        var e = doc.queryEntity(vps[i]);
        print("  vp block=" + doc.getBlockName(e.getBlockId()) + " c=" + e.getCenter() + " w=" + e.getWidth() + " h=" + e.getHeight() + " scale=" + e.getScale() + " vc=" + e.getViewCenter());
    }
    var names = doc.getBlockNames();
    for (var n = 0; n < names.length; n++) {
        var bid = doc.getBlockId(names[n]);
        var cnt = doc.queryBlockEntities(bid).length;
        if (String(names[n]).indexOf("*Paper") == 0) {
            print("block " + names[n] + ": " + cnt + " entities");
            doc.setCurrentBlock(bid);
            var scene = new RGraphicsSceneQt(di);
            var view = new RGraphicsViewImage();
            view.setScene(scene, false);
            exportBitmap(doc, scene, out + "/flange_" + String(names[n]).replace("*", "") + ".png", { width: 1100, height: 800, zoomAll: true, margin: 10, backgroundColor: new RColor("white") }, view);
        }
    }
    QCoreApplication.exit(0);
}
main();
