if (typeof isNull === "undefined") { isNull = function(v) { return v === undefined || v === null || (typeof v.isNull === "function" && v.isNull()); }; }
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1], path = args[args.length - 2];
var SC = Number(String(args[args.length - 3]).replace(/\D/g, ""));
include("scripts/EAction.js"); include("scripts/simple.js"); include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core"; include(includeBasePath + "/CsAll.js");
var doc = new RDocument(new RMemoryStorage(), createSpatialIndex()); var di = new RDocumentInterface(doc);
di.importFile(path, "", false);
getDocument = function() { return doc; }; getDocumentInterface = function() { return di; }; getMainWindow = function() { return null; }; EAction.handleUserMessage = function() {};
includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup"; include(includeBasePath + "/SheetSetup.js");
var st = SheetSetup.readState(doc);
var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
var wants = { title: true, bar: true, north: true };
var fit = CsSheetSetup.fit(st.caveW, st.caveH, sheet, SheetSetup.footerFn(st, sheet, wants), false);
print("scale=" + SC + " perFoot=" + st.perFoot + " footer=" + st.footerInches + " title=" + st.titleHeight); print("cave " + Math.round(st.caveW) + "x" + Math.round(st.caveH) + " fits-at " + fit.scale + " turned " + fit.turned);
var rows = [];
[[-1.6,0],[-1.4,0],[-1.2,0],[-1,0],[0,0],[1,0],[1.2,0],[1.4,0],[1.6,0],[2,0],[2.5,0],[0,-1.2],[0,-1.4],[0,-1.6],[0,1.0],[0,1.2],[0,1.4],[0,1.6],[0,2]].forEach(function(d) {
  var offsets = { cave: { x: d[0], y: d[1] } };
  var tiles = SheetSetup.tileLayoutFor(st, sheet, SC, offsets, wants, fit.turned);
  var pv = CsSheetSetup.preview({ caveBox: st.caveBox, sheet: sheet, scale: SC, tileLayout: tiles, turned: fit.turned,
      footerInches: st.footerInches, titleHeight: st.titleHeight, declinationDate: st.declinationDate,
      wants: { border: true, bar: true, north: true, title: true }, elevation: false, bands: st.bands, chunked: false, offsets: offsets, declination: st.declination });
  var sheetB = null, caveB = null;
  pv.items.forEach(function(it) { if (it.kind === "sheet") sheetB = it.box; if (it.kind === "cave") caveB = it.box; });
  print("drag " + d + "  tiles " + (tiles ? tiles.tiles.length : 1) + "  cave rel sheet (units): dx=" + Math.round(caveB.minX - sheetB.minX) + " dy=" + Math.round(caveB.maxY - sheetB.maxY) + "  sheet w=" + Math.round(sheetB.maxX - sheetB.minX) + " h=" + Math.round(sheetB.maxY - sheetB.minY));
});
QCoreApplication.exit(0);
