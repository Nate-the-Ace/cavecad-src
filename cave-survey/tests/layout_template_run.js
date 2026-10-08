/** Layout templates: built-ins apply, a layout captures to a template that applies the same, files round trip. */
if (typeof isNull === "undefined") {
    isNull = function(v) { if (v === undefined || v === null) { return true; } try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { } return false; };
}
if (typeof createSpatialIndex === "undefined") { createSpatialIndex = function() { return new RSpatialIndexNavel(); }; }
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js"); include("scripts/simple.js"); include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT TEMPLATE FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (t === undefined ? 1e-6 : t); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
EAction.handleUserMessage = function() {};
getDocument = function() { return doc; }; getDocumentInterface = function() { return di; }; getMainWindow = function() { return null; };
includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup";
include(includeBasePath + "/SheetSetup.js");

var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
CsLayers.ensure(doc, di, CsLayers.PROFILE_WALLS_SURVEYED);
function seg(layer, x1, y1, x2, y2) {
    var e = new RLineEntity(doc, new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    di.applyOperation(new RAddObjectOperation(e, false));
}
seg(CsLayers.WALLS_SURVEYED, ox, oy, ox + 400, oy + 150);
seg(CsLayers.PROFILE_WALLS_SURVEYED, ox, oy - 600, ox + 400, oy - 500);

var all = CsLayoutTemplate.list(doc);
check(all.length >= 4 && all[0].source === "built-in", "the built-in templates are listed: " + all.map(function(t) { return t.name; }));

// ---- apply: plan sheet
var plan = all.filter(function(t) { return t.name === "Plan sheet - Letter"; })[0].def;
var name = CsLayoutTemplate.apply(doc, di, plan, "Plan 1");
check(name === "Plan 1", "a layout was made from the template");
var info = Layouts.get(doc, name);
var vps = Layouts.viewports(doc, info).filter(function(v) { return !v.isOverall(); });
check(vps.length === 1, "with its one viewport");
var ps = Layouts.paperSize(doc, info);
check(near(vps[0].getWidth(), 0.94 * ps.w, 1e-9) && near(vps[0].getCenter().x, 0.5 * ps.w, 1e-9), "placed by its fractions of the paper");
check(vps[0].getFrozenLayerIds().indexOf(doc.getLayerId(CsLayers.PROFILE_WALLS_SURVEYED)) >= 0, "the plan viewport hides the profile");
check(vps[0].getCustomProperty("CaveCAD", "NoRaster") === "1", "and carries no raster");
check(CsNorth.arrows(doc, info.blockId).length === 1, "a north arrow");
check(CsScaleBar.hasBar(doc, vps[0]), "a scale bar linked to the viewport");
var lines = 0, titles = 0, ids = doc.queryBlockEntities(info.blockId);
for (var i = 0; i < ids.length; i++) {
    var e = doc.queryEntity(ids[i]);
    if (e.isUndone()) continue;
    if (CsBind.layerNameOf(doc, e) === CsLayers.BORDER && e.getType() === RS.EntityLine) lines++;
    if (CsTags.get(e, CsSheet.TAG) !== "") titles++;
}
check(lines === 4, "a border of four lines");
check(titles > 0, "a title block");
check(near(Layouts.feetPerInch(doc, vps[0]), NewViewport.fitScale(doc, vps[0].getWidth(), vps[0].getHeight(), SheetSetup.caveBox(doc))), "its scale fits the cave");

// ---- apply: plan and elevation
var both = all.filter(function(t) { return t.name === "Plan and elevation - Tabloid"; })[0].def;
var n2 = CsLayoutTemplate.apply(doc, di, both, "Both");
var i2 = Layouts.get(doc, n2);
var byHeight = function(a, b) { return b.getHeight() - a.getHeight(); };
var v2 = Layouts.viewports(doc, i2).filter(function(v) { return !v.isOverall(); }).sort(byHeight);   // plan (tall) first
check(v2.length === 2, "plan and elevation make two viewports");
check(v2[1].getFrozenLayerIds().indexOf(doc.getLayerId(CsLayers.WALLS_SURVEYED)) >= 0 &&
      v2[0].getFrozenLayerIds().indexOf(doc.getLayerId(CsLayers.WALLS_SURVEYED)) < 0, "the elevation hides the plan, the plan does not");
check(CsScaleBar.hasBar(doc, v2[0]) && CsScaleBar.hasBar(doc, v2[1]), "each has its own scale bar");
check(CsNorth.arrows(doc, i2.blockId).length === 1, "one north arrow for the pair");

// ---- capture and re-apply
var def = CsLayoutTemplate.capture(doc, i2, "Mine");
check(def.viewports.length === 2 && def.viewports[0].view !== def.viewports[1].view, "capturing finds both viewports and what each shows: " + def.viewports.map(function(v) { return v.view; }));
check(def.furniture.filter(function(f) { return f.kind === "scalebar"; }).length === 2 &&
      def.furniture.filter(function(f) { return f.kind === "north"; }).length === 1 &&
      def.furniture.filter(function(f) { return f.kind === "title"; }).length === 1, "and the furniture: " + def.furniture.map(function(f) { return f.kind; }));
check(def.furniture.filter(function(f) { return f.kind === "border"; }).length === 1 && near(def.furniture[0].inset, 0.25, 1e-6), "a border is captured with its inset: " + JSON.stringify(def.furniture[0]));
var again = CsLayoutTemplate.apply(doc, di, def, "Again");
var borderLines = 0, bl = doc.queryBlockEntities(Layouts.get(doc, "Again").blockId);
for (var q = 0; q < bl.length; q++) { var be2 = doc.queryEntity(bl[q]); if (!be2.isUndone() && CsBind.layerNameOf(doc, be2) === CsLayers.BORDER) borderLines++; }
check(borderLines === 4, "and comes back as four lines");
var i3 = Layouts.get(doc, again);
var v3 = Layouts.viewports(doc, i3).filter(function(v) { return !v.isOverall(); }).sort(byHeight);
check(v3.length === 2 && near(v3[0].getCenter().x, v2[0].getCenter().x, 1e-6) && near(v3[1].getWidth(), v2[1].getWidth(), 1e-6), "a captured template lays the same sheet out again");
check(CsScaleBar.hasBar(doc, v3[0]) && CsScaleBar.hasBar(doc, v3[1]) && CsNorth.arrows(doc, i3.blockId).length === 1, "with its bars and arrow");

// ---- files
var folder = QDir.tempPath() + "/cs_layout_templates_" + (new Date()).getTime();
var path = CsLayoutTemplate.save(def, folder);
check(path !== "" && (new QFile(path)).exists(), "a template is written to a file: " + path);
var back = CsLayoutTemplate.parse(CsLayoutTemplate.readFile(path));
check(!isNull(back) && back.name === "Mine" && back.viewports.length === 2, "and read back");
check(CsLayoutTemplate.parse("not json") === null && CsLayoutTemplate.parse('{"x":1}') === null, "text that is not a template is refused");

// ---- shapes ride along
var shaped = { version: 1, name: "Round", paper: "Letter", landscape: true, margins: 12.7, furniture: [],
    viewports: [ { id: "a", box: { x: 0.1, y: 0.1, w: 0.5, h: 0.6 }, view: "cave", scale: "fit", rotation: 20, locked: true, freeze: [], hide: [],
        shape: [ (function() { var l = []; for (var k = 0; k < 64; k++) { var a = k / 64 * 2 * Math.PI; l.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]); } return l; })() ] } ] };
var n4 = CsLayoutTemplate.apply(doc, di, shaped, "Round");
var v4 = Layouts.viewports(doc, Layouts.get(doc, n4)).filter(function(v) { return !v.isOverall(); })[0];
check(Layouts.hasClip(v4) && Layouts.clipLoops(v4)[0].length === 64, "a shaped viewport comes out shaped");
check(Layouts.isLocked(v4) && near(v4.getRotation(), 20 * Math.PI / 180, 1e-9), "locked and turned as the template says");
var cap = CsLayoutTemplate.capture(doc, Layouts.get(doc, n4), "RoundAgain");
check(cap.viewports[0].shape !== null && cap.viewports[0].shape[0].length === 64 && near(cap.viewports[0].rotation, 20, 1e-6), "and capturing it keeps the shape and the turn");
if (fails === 0) print("### LAYOUT TEMPLATE OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
