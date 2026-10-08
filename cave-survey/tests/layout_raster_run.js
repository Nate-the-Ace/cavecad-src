/**
 * PRIVACY: a plotted layout carries no raster. An aerial photograph or a
 * scanned field-book page in model space must not reach the PDF of a
 * generated sheet, whatever layer it is on; a viewport that is NOT told to
 * leave rasters out still draws them (so the test can fail).
 */
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT RASTER FAILED: " + m); } else print("ok: " + m); }

function pdfHasImage(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly)) return false;
    var s = new QTextStream(f).readAll();
    f.close();
    return s.indexOf("/Subtype /Image") >= 0 || s.indexOf("/Subtype/Image") >= 0;
}

function main() {
    var tmp = QDir.tempPath();
    var png = tmp + "/cs_raster_probe.png";
    QFile.remove(png);
    check(QFile.copy(autoPath("scripts/cavecad_icon.png"), png), "test PNG written");

    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    var ox = 500000, oy = 3900000;
    // the image sits on layer 0 (the case that slipped past the old layer-based rule)
    var data = new RImageData(png, new RVector(ox + 10, oy + 10), new RVector(1, 0), new RVector(0, 1), 50, 50, 0);
    var ent = new RImageEntity(doc, data);
    di.applyOperation(new RAddObjectOperation(ent, false));
    var line = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
    di.applyOperation(new RAddObjectOperation(line, false));
    check(doc.queryAllEntities(false, true, RS.EntityImage).length === 1, "an image is in model space");

    var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
    var res = CsLayoutGen.generate(doc, di, { caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 },
        sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: { border: true, bar: true, north: false, title: false }, titleValues: {}, reading: null, tiles: null });
    check(res.made.join() === "Plan", "sheet generated");

    var out1 = tmp + "/cs_raster_off.pdf";
    var r1 = LayoutPlot.exportPdf(di, null, out1);
    check(r1.ok, "plotted: " + r1.error);
    check(!pdfHasImage(out1), "the plotted sheet carries NO image");

    // control: the same viewport without the property DOES draw the image
    var info = Layouts.get(doc, "Plan");
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (e.getType() === RS.EntityViewport) {
            e.setCustomProperty("CaveCAD", "NoRaster", "0");
            di.applyOperation(new RModifyObjectOperation(e));
        }
    }
    var out2 = tmp + "/cs_raster_on.pdf";
    var r2 = LayoutPlot.exportPdf(di, null, out2);
    check(r2.ok && pdfHasImage(out2), "control: without the property the image IS plotted (so the check above can fail)");

    if (fails === 0) print("### LAYOUT RASTER OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
