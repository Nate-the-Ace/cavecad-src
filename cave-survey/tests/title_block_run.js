/** The title block is ONE block with a field per line; linked fields follow the notebook, never over a person. */
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
function check(c, m) { if (!c) { fails++; print("### TITLE BLOCK FAILED: " + m); } else print("ok: " + m); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
var w = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
w.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
di.applyOperation(new RAddObjectOperation(w, false));

var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
var filled = { caveName: "Truitt Cave", surveyedBy: "A. Caver", length: "1,000 ft", depth: "40 ft" };
var values = { caveName: "Truitt Cave", surveyedBy: "A. Caver", length: "1,000 ft", depth: "40 ft" };
var res = CsLayoutGen.generate(doc, di, { caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 }, sheet: sheet, turned: false,
    scale: 20, perFoot: 1, wants: { border: true, bar: true, north: true, title: true }, titleValues: values, reading: null, tiles: null,
    extra: { titleValues: values, filled: filled } });
var info = Layouts.get(doc, res.made[0]);

function refs() {
    var out = [], ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && e.getType() === RS.EntityBlockRef && CsTags.get(e, CsTitleBlock.TAG_REF) !== "") { out.push(e); }
    }
    return out;
}
function field(id) {
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && CsSheet.isText(e) && CsTags.get(e, CsSheet.TAG) === id) { return e; }
    }
    return null;
}
check(refs().length === 1, "the title block is ONE block reference");
check(field("caveName") !== null && CsSheet.textOf(field("caveName")) === "TRUITT CAVE", "its cave name is a field: " + (field("caveName") ? CsSheet.textOf(field("caveName")) : "(none)"));
check(field("sheetNumber") !== null && CsSheet.textOf(field("sheetNumber")) === CsSheetLink.lineFor(info.name), "and so is the sheet number, which is the tab's name");
check(CsTags.get(field("length"), CsSheetLink.TAG_LINK) === "auto", "length follows the notebook");
check(CsTags.get(field("sheetNumber"), CsSheetLink.TAG_LINK) === "layout", "the sheet number follows the tab");
check(field("location") === null || CsTags.get(field("location"), CsSheetLink.TAG_LINK) === "", "location is never linked");

// the notebook moves on: an untouched linked field follows
var r = CsTitleBlock.sync(doc, di, { caveName: "Truitt Cave", surveyedBy: "A. Caver", length: "1,500 ft", depth: "40 ft" }, false);
check(CsLayoutGen.state(doc, info) === "auto", "the sheet is automatic before anyone touches it");
check(r.set === 1 && CsSheet.textOf(field("length")) === "LENGTH:  1,500 FT", "a changed notebook value is written to its field: " + CsSheet.textOf(field("length")));
check(CsLayoutGen.state(doc, info) === "auto", "a linked field following the notebook is not a hand edit: the sheet stays automatic");
check(CsTitleBlock.sync(doc, di, { caveName: "Truitt Cave", surveyedBy: "A. Caver", length: "1,500 ft", depth: "40 ft" }, false).set === 0, "a second sync writes nothing");

// a person types over a linked field: it becomes theirs
var edited = field("length");
edited.setText("LENGTH:  ABOUT 1.5 KFT");
di.applyOperation(new RModifyObjectOperation(edited));
r = CsTitleBlock.sync(doc, di, { caveName: "Truitt Cave", surveyedBy: "A. Caver", length: "2,000 ft", depth: "40 ft" }, false);
check(CsLayoutGen.state(doc, info) === "edited", "typing over a field IS a hand edit: the sheet is edited");
check(r.manual === 1 && CsSheet.textOf(field("length")) === "LENGTH:  ABOUT 1.5 KFT", "an edited field is left alone and turns manual");
check(CsTags.get(field("length"), CsSheetLink.TAG_LINK) === "manual", "and stays manual");
CsTitleBlock.sync(doc, di, { length: "2,000 ft" }, false);
check(CsSheet.textOf(field("length")) === "LENGTH:  ABOUT 1.5 KFT", "later syncs never overwrite it");

// linking it again brings it back to the notebook
check(CsTitleBlock.relink(doc, di, [field("length")]) === 1, "Link field to notebook");
CsTitleBlock.sync(doc, di, { length: "2,000 ft" }, false);
check(CsSheet.textOf(field("length")) === "LENGTH:  2,000 FT", "and it follows again");

// reverting the sheet to automatic redraws it: still ONE title block, and the sheet is automatic again
CsLayoutGen.revert(doc, di, info.name, { titleValues: values, filled: filled });
info = Layouts.get(doc, info.name);
check(refs().length === 1, "reverting leaves ONE title block");
check(CsLayoutGen.state(doc, info) === "auto", "and the sheet is automatic again");

if (fails === 0) print("### TITLE BLOCK OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
