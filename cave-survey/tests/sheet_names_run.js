/** The sheet number is the Layout tab's name, both ways; a renamed sheet is still the sheet its job made. */
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
function check(c, m) { if (!c) { fails++; print("### SHEET NAMES FAILED: " + m); } else print("ok: " + m); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
var w = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
w.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
di.applyOperation(new RAddObjectOperation(w, false));

var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
function generate() {
    return CsLayoutGen.generate(doc, di, { caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 }, sheet: sheet, turned: false,
        scale: 20, perFoot: 1, wants: { border: true, bar: true, north: true, title: true }, titleValues: {}, reading: null, tiles: null, extra: {} });
}
function sheetTexts(info, field) {
    var out = [], ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && CsSheet.isText(e) && CsTags.get(e, CsSheet.TAG) === field) { out.push(e); }
    }
    return out;
}
var res = generate();
var info = Layouts.get(doc, res.made[0]);
var first = info.name;
var line = sheetTexts(info, CsSheetLink.SHEET_FIELD);
check(line.length === 1 && CsSheet.textOf(line[0]) === CsSheetLink.lineFor(first), "the title block says which sheet it is: " + (line.length ? CsSheet.textOf(line[0]) : "(no line)"));
check(CsLayoutGen.jobIdOf(doc, info) !== "", "the sheet remembers which job made it");

// TAB -> SHEET: rename the tab; the sheet number follows
Layouts.rename(di, first, "Sheet 7");
CsLayoutGen.refreshNames(doc, di, -1, false);
info = Layouts.get(doc, "Sheet 7");
check(!isNull(info), "the tab is renamed");
line = sheetTexts(info, CsSheetLink.SHEET_FIELD);
check(line.length === 1 && CsSheet.textOf(line[0]) === CsSheetLink.lineFor("Sheet 7"), "and the sheet number follows the tab");
check(CsLayoutGen.refreshNames(doc, di, -1, false) === 0, "a second refresh writes nothing");

check(CsLayoutGen.state(doc, info) === "auto", "renaming a sheet is not a hand edit: it is still automatic");

// a renamed sheet is still the sheet its job made: building again rewrites it, it does not make another
var again = generate();
check(again.made.length === 0 && again.rewritten.length + again.skipped.length === 1 && Layouts.list(doc).length === 1,
    "building again finds the renamed sheet (made " + again.made.length + ", sheets " + Layouts.list(doc).length + ")");
check(!isNull(Layouts.get(doc, "Sheet 7")) && isNull(Layouts.get(doc, first)), "and it keeps its new name");

// SHEET -> TAB: edit the sheet number; the tab is renamed
info = Layouts.get(doc, "Sheet 7");
line = sheetTexts(info, CsSheetLink.SHEET_FIELD);
line[0].setText("SHEET:  A9");
di.applyOperation(new RModifyObjectOperation(line[0]));
SheetNameListener.fromSheet(doc, di, doc.queryEntity(line[0].getId()), -1);
CsLayoutGen.refreshNames(doc, di, -1, false);
check(!isNull(Layouts.get(doc, "A9")) && isNull(Layouts.get(doc, "Sheet 7")), "editing the sheet number renames the tab");

// a name that cannot be used is refused and the line is put back
var extra = Layouts.create(di, { name: "Other", paper: { w: 279.4, h: 215.9 }, landscape: true, units: Layouts.INCHES, margins: 12.7, mode: "manual" });
info = Layouts.get(doc, "A9");
line = sheetTexts(info, CsSheetLink.SHEET_FIELD);
line[0].setText("SHEET:  OTHER");
di.applyOperation(new RModifyObjectOperation(line[0]));
SheetNameListener.fromSheet(doc, di, doc.queryEntity(line[0].getId()), -1);
CsLayoutGen.refreshNames(doc, di, -1, false);
info = Layouts.get(doc, "A9");
line = sheetTexts(info, CsSheetLink.SHEET_FIELD);
check(!isNull(info) && line.length === 1 && CsSheet.textOf(line[0]) === CsSheetLink.lineFor("A9"), "a name already used is refused and the line is put back");

if (fails === 0) print("### SHEET NAMES OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
