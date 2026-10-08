// sheet_setup_layouts_run.js -- Sheet Setup's panel logic against LAYOUTS:
// what it measures is model space whatever sheet is showing, and what a
// sheet says is read back from the sheet (never doubled, never lost).
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
function check(c, m) { if (!c) { fails++; print("### SHEET SETUP LAYOUTS FAILED: " + m); } else print("ok: " + m); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
EAction.handleUserMessage = function(text) { };
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };
getMainWindow = function() { return null; };
includeBasePath = repoRoot + "/scripts/CaveSurvey/SheetSetup";
include(includeBasePath + "/SheetSetup.js");

function seg(layer, x1, y1, x2, y2) {
    CsLayers.ensure(doc, di, layer);
    var e = new RLineEntity(doc, new RLineData(new RVector(x1, y1), new RVector(x2, y2)));
    e.setLayerId(doc.getLayerId(layer));
    var op = new RAddObjectsOperation();
    op.addObject(e, false);
    di.applyOperation(op);
}
seg(CsLayers.WALLS_SURVEYED, 500000, 3900000, 500100, 3900000);
seg(CsLayers.WALLS_SURVEYED, 500000, 3900050, 500100, 3900050);
seg(CsLayers.PROFILE_WALLS_SURVEYED, 500000, 3899000, 500300, 3899000);

var modelBox = SheetSetup.caveBox(doc);
check(modelBox !== null && Math.abs(modelBox.maxX - 500100) < 1e-6, "cave box measures the plan only");

var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
var values = { caveName: "Truitt Cave System", location: "Somewhere Hollow", surveyedBy: "A. Caver, B. Digger" };
var gen = function(titleValues) {
    return CsLayoutGen.generate(doc, di, { caveBox: modelBox, sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: { border: true, bar: true, north: false, title: true }, titleValues: titleValues, reading: null,
        tiles: null, extra: { titleValues: titleValues } });
};
check(gen(values).made.join() === "Plan", "sheet generated");

// the panel is opened from a SHEET: measuring must still be the cave
Layouts.activate(di, "Plan");
var fromSheet = SheetSetup.caveBox(doc);
check(fromSheet !== null && Math.abs(fromSheet.minX - modelBox.minX) < 1e-6 && Math.abs(fromSheet.maxX - modelBox.maxX) < 1e-6,
    "caveBox is MODEL space even while a layout is current (not the sheet's furniture)");
var occ = SheetSetup.occupancy(doc);
check(occ.length >= 2, "occupancy reads the model while a layout is current: " + occ.length);
var fbox = SheetSetup.frameBox(doc, "profile");
check(fbox !== null && fbox.maxX > 500250, "the profile frame box is read from model space too");

// what the sheet says comes back exactly
var back = SheetSetup.titleValues(doc, {});
check(back.caveName === values.caveName, "cave name read back: " + back.caveName);
check(back.location === values.location, "location read back WITHOUT its caption: [" + back.location + "]");
check(back.surveyedBy === values.surveyedBy, "surveyed-by read back whole: [" + back.surveyedBy + "]");

// regenerating from what the sheet says changes nothing (no doubled captions)
function titleTexts() {
    var info = Layouts.get(doc, "Plan"), ids = doc.queryBlockEntities(info.blockId), out = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!e.isUndone() && CsTags.get(e, CsSheet.TAG) !== "") out.push(String(e.getPlainText()));
    }
    out.sort();
    return out.join("|");
}
var first = titleTexts();
check(first.length > 0 && first.toUpperCase().indexOf("LOCATION:") >= 0, "the title block says something: " + first);
gen(SheetSetup.titleValues(doc, {}));
gen(SheetSetup.titleValues(doc, {}));
check(titleTexts() === first, "two rebuilds from the sheet's own words change nothing (no doubled captions): [" + titleTexts() + "] vs [" + first + "]");

// a person's wording survives a rebuild of a sheet that is still AUTO? an edit makes it manual; its words still feed the next build
var info = Layouts.get(doc, "Plan"), ids = doc.queryBlockEntities(info.blockId), loc;
for (var i = 0; i < ids.length; i++) {
    var e = doc.queryEntity(ids[i]);
    if (!e.isUndone() && CsTags.get(e, CsSheet.TAG) === "location") loc = e;
}
check(!isNull(loc), "found the location line");
if (!isNull(loc)) {
    var t = loc.getData ? null : null;
    CsTags.set(loc, CsSheetSetup.TAG_FULL, "Typed By Hand");
    di.applyOperation(new RModifyObjectOperation(loc));
    check(SheetSetup.titleValues(doc, {}).location === "Typed By Hand", "a typed-over value wins over the computed one");
}

// tile layout uses drawing units per inch (metric drawings)
var st = { caveBox: { minX: 0, minY: 0, maxX: 3000, maxY: 1000 }, perFoot: 0.3048, occupied: null };
var tl = SheetSetup.tileLayoutFor(st, sheet, 20, {}, { title: true, bar: true, north: true }, false);
check(tl === null || tl.tooMany === true || tl.tiles.length >= 1, "tileLayoutFor answers for a metric drawing without throwing");

if (fails === 0) print("### SHEET SETUP LAYOUTS OK");
// ---- the default layout becomes the default sheet ------------------------------------------------
(function() {
    var d2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    d2.setUnit(RS.Foot);
    var di2 = new RDocumentInterface(d2);
    getDocument = function() { return d2; };
    getDocumentInterface = function() { return di2; };
    CsLayers.ensure(d2, di2, CsLayers.WALLS_SURVEYED);
    var e = new RLineEntity(d2, new RLineData(new RVector(500000, 3900000), new RVector(500100, 3900060)));
    e.setLayerId(d2.getLayerId(CsLayers.WALLS_SURVEYED));
    var op = new RAddObjectsOperation(); op.addObject(e, false); di2.applyOperation(op);
    var mk = Layouts.create(di2, { name: "Layout", paper: "Letter" });
    check(!isNull(mk), "default layout created: " + JSON.stringify(Layouts.list(d2).map(function(l) { return [l.name, l.mode]; })));
    check(!isNull(CsLayoutGen.pristine(d2)), "an empty default Layout is pristine");
    var made = SheetSetup.starter(d2, di2);
    check(made !== "", "the default sheet is built when the default layout is opened: " + made);
    var names = Layouts.list(d2).map(function(l) { return l.name; });
    check(names.length === 1 && names[0] === made, "the empty Layout became the sheet, no stray tab: " + names);
    check(CsLayoutGen.state(d2, Layouts.get(d2, made)) === "auto", "and it is an automatic sheet Sheet Setup can rewrite");
    check(Layouts.viewports(d2, Layouts.get(d2, made)).length >= 1, "with a viewport on the cave");
    check(CsLayoutGen.pristine(d2) === undefined, "nothing pristine is left to adopt");
    // a hand-made layout is never adopted
    var d3 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di3 = new RDocumentInterface(d3);
    Layouts.create(di3, { name: "Mine", paper: "Letter" });
    check(CsLayoutGen.pristine(d3) === undefined, "only the default 'Layout' is adopted, never a layout of the caver's");
})();

QCoreApplication.exit(fails === 0 ? 0 : 1);
