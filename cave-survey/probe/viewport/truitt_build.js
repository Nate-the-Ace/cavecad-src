// Times Sheet Setup's measure + build against a real cave copy. Arg: path to drawing.
if (typeof isNull === "undefined") { isNull = function(v) { return v === undefined || v === null || (typeof v.isNull === "function" && v.isNull()); }; }
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var path = args[args.length - 2];
include("scripts/EAction.js"); include("scripts/simple.js"); include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
var t = new Date().getTime();
function lap(m) { var n = new Date().getTime(); print("[" + (n - t) + " ms] " + m); t = n; }
print(path);
print("import " + di.importFile(path, "", false)); lap("imported, entities " + doc.queryAllEntities(false, true).length);
EAction.handleUserMessage = function() {};
getDocument = function() { return doc; }; getDocumentInterface = function() { return di; }; getMainWindow = function() { return null; };
includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup";
include(includeBasePath + "/SheetSetup.js");
var st = SheetSetup.readState(doc); lap("readState ok=" + st.ok + " why=" + st.why + " caveW=" + st.caveW + " H=" + st.caveH);
var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
var wants = { border: true, bar: true, north: true, title: true };
var scale = Number(String(args[args.length - 3]).replace(/\D/g, "")) || 100;
if (String(args[args.length - 3]).indexOf("b") >= 0) CsSheetTile.MAX_SHEETS = 1000;
var tiles = SheetSetup.tileLayoutFor(st, sheet, scale, {}, wants, false); lap("tiles " + (tiles ? (tiles.tooMany ? "TOO MANY " + tiles.count : tiles.cols + "x" + tiles.rows) : "none")); if (tiles && tiles.tooMany) { QCoreApplication.exit(0); throw "stop"; }
var res = CsLayoutGen.generate(doc, di, { caveBox: st.caveBox, elevBox: null, sheet: sheet, turned: tiles ? tiles.turned : false,
    scale: scale, perFoot: CsShapeLine.perFoot(doc), wants: wants, titleValues: SheetSetup.titleValues(doc, st.filled),
    reading: null, tiles: tiles, elevation: false, shiftInches: { x: 0, y: 0 }, extra: {} });
lap("generate made " + res.made.join());
var out = QDir.tempPath() + "/truitt_sheets_probe.dxf";
print("deliver " + CsLayoutGen.writeCopies(di, CsLayoutGen.jobsFor(1, res.made, QDir.tempPath() + "/truitt_probe")).ok); lap("writeCopies");
QCoreApplication.exit(0);
