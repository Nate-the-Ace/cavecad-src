// Drives every headless crumb source once. The test reads the log.
var tmp = QDir.tempPath() + "/cc-crumbs";
(new QDir(tmp)).removeRecursively();
(new QDir()).mkpath(tmp);

var a = new RGuiAction("Crumb &Probe", null);
a.slotTrigger();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di = new RDocumentInterface(doc);
di.applyOperation(new RAddObjectOperation(
    new RLineEntity(doc, new RLineData(new RVector(0, 0), new RVector(1, 1))), false));
di.exportFile(tmp + "/saved.dxf", "", true);
di.exportFile(tmp + "/copy.dxf", "", false);
di.undo();
di.redo();

var doc2 = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
var di2 = new RDocumentInterface(doc2);
di2.importFile(tmp + "/saved.dxf");
print("CRUMBS DONE");
