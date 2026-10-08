/**
 * Layouts and viewports survive a DXF round trip (viewport branch, V1).
 *
 * A viewport, its paper-space neighbours and the layout settings were all
 * dropped on every save before this: the exporter wrote empty
 * *Paper_Space blocks and the importer invented a stray *Paper_Space0.
 * This builds two layouts (one renamed default, one new) with viewports
 * carrying twist, scale, an absolute view centre and a frozen layer,
 * saves, reloads, and checks every field. It then reads QCAD's own
 * flange.dxf (a real four-viewport layout from another writer) so the
 * reader is not only tested against its own output.
 */
include("scripts/library.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### VIEWPORT LAYOUT FAILED: " + m); } else print("ok: " + m); }
function near(a, b) { return Math.abs(a - b) < 1e-6; }
function flangeChecks() {
    var repo = args[args.length - 1];
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    var di = new RDocumentInterface(doc);
    di.importFile(repo + "/testdata/viewport/flange.dxf", "", false);
    var vps = doc.queryAllEntities(false, true, RS.EntityViewport);
    check(vps.length == 6, "flange: 6 viewport entities read: " + vps.length);
    var scales = [];
    for (var i = 0; i < vps.length; i++) {
        var e = doc.queryEntity(vps[i]);
        if (!e.isOverall()) scales.push(Math.round(e.getScale() * 100) / 100);
    }
    scales.sort();
    check(scales.join(",") == "0.75,1,2,2", "flange: real viewport scales 0.75,1,2,2 (height / DXF view height): " + scales.join(","));
    var overall = 0;
    for (var j = 0; j < vps.length; j++) { if (doc.queryEntity(vps[j]).isOverall()) overall++; }
    check(overall == 2, "flange: the two paper-space (id 1) viewports are marked overall: " + overall);
}

function main() {
    var out = QDir.tempPath();
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    function add(e) { di.applyOperation(new RAddObjectOperation(e, false)); }

    var lyA = new RLayer(doc, "WALLS", false, false, new RColor(255, 0, 0), doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight025, false);
    var lyB = new RLayer(doc, "NOTES", false, false, new RColor(0, 0, 255), doc.getLinetypeId("CONTINUOUS"), RLineweight.Weight025, false);
    add(lyA); add(lyB);
    var idB = doc.getLayerId("NOTES");

    var ox = 500000, oy = 3900000;
    doc.setCurrentBlock(doc.getModelSpaceBlockId());
    add(new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 10, oy + 10))));

    // layout 1: existing *Paper_Space, rename + paper settings
    var ps1 = doc.getBlockId("*Paper_Space");
    var lay1 = doc.queryLayout(doc.queryBlock("*Paper_Space").getLayoutId());
    lay1.setName("A1");
    lay1.setPlotPaperSize(new RVector(11, 8.5));
    lay1.setPlotPaperUnits(0);
    lay1.setPlotRotation(1);
    lay1.setTabOrder(1);
    lay1.setCustomProperty("CaveSurvey", "mode", "auto");
    di.applyOperation(new RModifyObjectOperation(lay1));

    // layout 2: new block + layout
    var lay2 = new RLayout(doc, "B2");
    lay2.setPlotPaperSize(new RVector(297, 210)); lay2.setPlotPaperUnits(1); lay2.setTabOrder(2);
    add(lay2);
    var b2 = new RBlock(doc, "*Paper_Space1", new RVector());
    b2.setLayoutId(lay2.getId());
    add(b2);
    var ps2 = doc.getBlockId("*Paper_Space1");
    check(ps2 != RObject.INVALID_ID, "second layout block created: " + ps2);

    function vp(blockId, cx, cy, w, h, sc, rot, frozen) {
        doc.setCurrentBlock(blockId);
        var v = new RViewportEntity(doc, new RViewportData());
        v.setCenter(new RVector(cx, cy)); v.setWidth(w); v.setHeight(h); v.setScale(sc); v.setRotation(rot);
        v.setViewCenter(new RVector(ox + 5, oy + 5)); v.setViewTarget(new RVector(0, 0));
        v.setBlockId(blockId); v.setLayerId(doc.getLayerId("0"));
        if (frozen) v.setFrozenLayerIds(frozen);
        add(v);
    }
    vp(ps1, 5.5, 4.25, 9, 6.5, 0.05, 0.5, [idB]);
    // lock the first viewport (display lock): must survive the file
    var lockedId = doc.queryAllEntities(false, true, RS.EntityViewport)[0];
    var lockedVp = doc.queryEntity(lockedId);
    lockedVp.setStatus(lockedVp.getStatus() | 0x40000);
    di.applyOperation(new RModifyObjectOperation(lockedVp));
    vp(ps2, 148, 105, 250, 180, 1 / 50.0, 0, null);
    doc.setCurrentBlock(ps1);
    add(new RLineEntity(doc, new RLineData(new RVector(0.5, 0.5), new RVector(10.5, 0.5))));
    doc.setCurrentBlock(ps2);
    add(new RLineEntity(doc, new RLineData(new RVector(5, 5), new RVector(290, 5))));
    add(new RLineEntity(doc, new RLineData(new RVector(5, 6), new RVector(290, 6))));

    check(doc.queryAllEntities(false, true, RS.EntityViewport).length == 2, "2 viewports before");

    var filter = "";
    var fs = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < fs.length; i++) { if (String(fs[i]).indexOf("dxflib") >= 0 && String(fs[i]).indexOf("2000") >= 0) { filter = fs[i]; break; } }
    var path = out + "/cs_viewport_layout_rt.dxf";
    check(di.exportFile(path, filter, false), "export");

    var back = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    var bi = new RDocumentInterface(back);
    bi.importFile(path, "", false);

    var names = back.getBlockNames();
    print("blocks after: " + names);
    check(String(names).indexOf("*Paper_Space0") < 0, "no stray *Paper_Space0");
    var vps = back.queryAllEntities(false, true, RS.EntityViewport);
    check(vps.length == 2, "2 viewports after: " + vps.length);
    var pa = back.getBlockId("*Paper_Space"), pb = back.getBlockId("*Paper_Space1");
    check(pb != RObject.INVALID_ID, "*Paper_Space1 exists");
    check(back.queryBlockEntities(pa).length == 2, "layout1 block has viewport+line: " + back.queryBlockEntities(pa).length);
    check(back.queryBlockEntities(pb).length == 3, "layout2 block has viewport+2 lines: " + back.queryBlockEntities(pb).length);
    var found = 0;
    for (var k = 0; k < vps.length; k++) {
        var e = back.queryEntity(vps[k]);
        if (e.getBlockId() == pa) {
            found++;
            check(near(e.getScale(), 0.05), "vp1 scale " + e.getScale());
            check(near(e.getRotation(), 0.5), "vp1 twist " + e.getRotation());
            check(near(e.getWidth(), 9) && near(e.getHeight(), 6.5), "vp1 size");
            check(near(e.getViewCenter().x, ox + 5) && near(e.getViewCenter().y, oy + 5), "vp1 viewCenter absolute " + e.getViewCenter().x + "," + e.getViewCenter().y);
            var fz = e.getFrozenLayerIds();
            check(fz.length == 1 && back.getLayerName(fz[0]) == "NOTES", "vp1 frozen layer NOTES");
            check((e.getStatus() & 0x40000) !== 0, "vp1 display lock survives the file");
            // a locked viewport refuses to change what it shows
            var scaleBefore = e.getScale();
            e.setProperty(RViewportEntity.PropertyScale, 0.5);
            check(near(e.getScale(), scaleBefore), "locked: the property editor cannot change the scale");
            var vcBefore = e.getViewCenter().x;
            e.setProperty(RViewportEntity.PropertyViewCenterX, 1.0);
            check(near(e.getViewCenter().x, vcBefore), "locked: the property editor cannot move the contents");
        } else if (e.getBlockId() == pb) {
            found++;
            check(near(e.getScale(), 1 / 50.0), "vp2 scale " + e.getScale());
            check((e.getStatus() & 0x40000) === 0, "vp2 is not locked");
            var s2 = e.getScale();
            e.setProperty(RViewportEntity.PropertyScale, 0.04);
            check(near(e.getScale(), 0.04), "unlocked: the scale can be changed (" + e.getScale() + ")");
            check(e.getFrozenLayerIds().length == 0, "vp2 no frozen layers");
        }
    }
    check(found == 2, "both viewports landed in layout blocks");
    var l1 = back.queryLayout(back.queryBlock("*Paper_Space").getLayoutId());
    var l2 = back.queryLayout(back.queryBlock("*Paper_Space1").getLayoutId());
    check(l1.getName() == "A1", "layout1 name " + l1.getName());
    check(near(l1.getPlotPaperSize().x, 11) && near(l1.getPlotPaperSize().y, 8.5), "layout1 paper size");
    check(l1.getPlotPaperUnits() == 0, "layout1 units");
    check(l1.getPlotRotation() == 1, "layout1 rotation");
    check(l1.getCustomProperty("CaveSurvey", "mode") == "auto", "layout1 custom property mode=auto: " + l1.getCustomProperty("CaveSurvey", "mode"));
    check(l2.getName() == "B2" && near(l2.getPlotPaperSize().x, 297), "layout2 name/size " + l2.getName());
    check(l2.getTabOrder() == 2, "layout2 tab order");
    var leftover = back.getVariables().filter(function(v) { return String(v).indexOf("Layout|") == 0; });
    check(leftover.length == 0, "no Layout| variables left in document");
    var exportLeft = doc.getVariables().filter(function(v) { return String(v).indexOf("Layout|") == 0; });
    check(exportLeft.length == 0, "no Layout| variables left in exported doc");
    flangeChecks();
    if (fails == 0) print("### VIEWPORT LAYOUT OK");
    QCoreApplication.exit(fails == 0 ? 0 : 1);
}
main();
