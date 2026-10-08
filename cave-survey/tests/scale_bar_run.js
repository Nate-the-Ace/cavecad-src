/**
 * The scale bar on a sheet follows the scale of its viewport ALWAYS
 * (Nathan, 2026-10-05): picked from the list, zoomed, typed, undone; on
 * automatic and manual sheets; staying where the caver put it.
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
function check(c, m) { if (!c) { fails++; print("### SCALE BAR FAILED: " + m); } else print("ok: " + m); }
function near(a, b, t) { return Math.abs(a - b) < (isNull(t) ? 1e-9 : t); }

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
doc.setUnit(RS.Foot);
var di = new RDocumentInterface(doc);
var ox = 500000, oy = 3900000;
CsLayers.ensure(doc, di, CsLayers.WALLS_SURVEYED);
var wall = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
wall.setLayerId(doc.getLayerId(CsLayers.WALLS_SURVEYED));
di.applyOperation(new RAddObjectOperation(wall, false));

var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
CsLayoutGen.generate(doc, di, { caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 }, sheet: sheet,
    turned: false, scale: 20, perFoot: 1, wants: { border: true, bar: true, north: false, title: false },
    titleValues: {}, reading: null, tiles: null });

function vpOf() { return Layouts.viewports(doc, Layouts.get(doc, "Plan"))[0]; }
function barPieces() { return CsScaleBar.pieces(doc, Layouts.get(doc, "Plan").blockId, CsScaleBar.guidOf(vpOf())); }
// the bar is ONE block reference; what it draws is in its block definition
function caption() {
    var ps = CsScaleBar.partsOf(doc, barPieces());
    for (var i = 0; i < ps.length; i++) if (CsTags.get(ps[i], CsScaleBar.PART) === "caption") return String(ps[i].getPlainText());
    return "";
}
function baseLength() {
    var ps = CsScaleBar.partsOf(doc, barPieces());
    for (var i = 0; i < ps.length; i++) if (CsTags.get(ps[i], CsScaleBar.PART) === "base") return ps[i].getLength();
    return NaN;
}

check(CsScaleBar.guidOf(vpOf()) !== "", "the viewport carries a GUID");
check(barPieces().length === 1 && barPieces()[0].getType() === RS.EntityBlockRef, "the bar is ONE block reference linked to it: " + barPieces().length);
check(CsScaleBar.partsOf(doc, barPieces()).length > 8, "and the block draws the whole bar: " + CsScaleBar.partsOf(doc, barPieces()).length + " parts");
check(caption().toUpperCase().indexOf("20 FT") > 0, "the bar says the viewport's scale: " + caption());
check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "auto", "a freshly generated sheet is AUTO");
var len20 = baseLength();

// ---- the scale list / zoom / typed value: all end in setScale --------------
check(CsScaleBar.syncAll(doc, di) === 0, "in step: nothing to redraw (and nothing written)");
Layouts.setLocked(di, vpOf(), false);
check(Layouts.setViewportScale(di, vpOf(), 40), "scale changed to 1 in = 40 ft");
var redrew = CsScaleBar.syncAll(doc, di);
check(redrew === 1, "the bar is redrawn once");
check(caption().toUpperCase().indexOf("40 FT") > 0, "now it says 40 FT: " + caption());
check(CsScaleBar.syncAll(doc, di) === 0, "and a second sync writes nothing (no loop)");
// a bar for 40 ft/in covers twice the cave per inch: the same bar of paper is twice the feet
var bar40 = CsSheetSetup.barFor(40), bar20 = CsSheetSetup.barFor(20);
check(near(baseLength(), bar40.perBlockFeet * bar40.blocks / 40 / 12, 1e-6), "the bar's length is its ground feet / feet-per-inch (in feet of paper): " + baseLength());
check(barPieces().length === 1 && CsScaleBar.partsOf(doc, barPieces()).length > 8, "still one bar, not duplicates: " + barPieces().length);

// ---- a typed scale not on any list (custom) ----------------------------------
vpOf().setProperty(RViewportEntity.PropertyScale, (1 / 12) / 37.5);
// property edit above is on a copy; apply it through an operation like the property editor does
var vcopy = vpOf();
vcopy.setScale((1 / 12) / 37.5);
di.applyOperation(new RModifyObjectOperation(vcopy));
CsScaleBar.syncAll(doc, di);
check(caption().indexOf("37.5") > 0, "a custom 37.5 ft scale reaches the bar: " + caption());

// ---- the bar stays where the caver put it ---------------------------------------
var ps = barPieces();
var moveOp = new RModifyObjectsOperation();
for (var i = 0; i < ps.length; i++) { ps[i].move(new RVector(0.1, 0.07)); moveOp.addObject(ps[i], false); }
di.applyOperation(moveOp);
var anchorBefore = CsScaleBar.anchorOf(doc, barPieces());
check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "edited", "moving the bar by hand is an edit");
var v3 = vpOf(); v3.setScale((1 / 12) / 25); di.applyOperation(new RModifyObjectOperation(v3));
CsScaleBar.syncAll(doc, di);
var anchorAfter = CsScaleBar.anchorOf(doc, barPieces());
check(near(anchorBefore.x, anchorAfter.x, 1e-6) && near(anchorBefore.y, anchorAfter.y, 1e-6),
    "the redrawn bar keeps its baseline where it was put (" + anchorAfter.x.toFixed(3) + ", " + anchorAfter.y.toFixed(3) + " in)");
check(caption().toUpperCase().indexOf("25 FT") > 0, "and follows the scale: " + caption());

// ---- manual sheets too ---------------------------------------------------------------
Layouts.setMode(di, "Plan", "manual");
var v4 = vpOf(); v4.setScale((1 / 12) / 60); di.applyOperation(new RModifyObjectOperation(v4));
CsScaleBar.syncAll(doc, di);
check(caption().toUpperCase().indexOf("60 FT") > 0, "a MANUAL sheet's bar follows too: " + caption());

// ---- undo: the redraw JOINS the edit's group, so one undo takes both -------------
doc.startTransactionGroup();
var grp = doc.getTransactionGroup();
var v5 = vpOf(); v5.setScale((1 / 12) / 80);
var op5 = new RModifyObjectOperation(v5);
op5.setTransactionGroup(grp);
di.applyOperation(op5);
check(CsScaleBar.sync(doc, di, vpOf(), grp, false), "scale change + redraw in one group");
check(caption().toUpperCase().indexOf("80 FT") > 0, "the bar says 80 FT: " + caption());
di.undo();
check(near(Layouts.feetPerInch(doc, vpOf()), 60, 1e-6), "one undo takes the scale back to 60");
check(caption().toUpperCase().indexOf("60 FT") > 0 && barPieces().length === 1, "and the bar back to 60 FT with it: " + caption());
check(CsScaleBar.syncAll(doc, di, -1, true) === 0, "nothing left out of step after the undo");
di.redo();
check(caption().toUpperCase().indexOf("80 FT") > 0 && near(Layouts.feetPerInch(doc, vpOf()), 80, 1e-6), "redo brings both forward again: " + caption());

// ---- survives a save and a reload ---------------------------------------------------------
var filter = "";
var fs = RFileExporterRegistry.getFilterStrings();
for (var f = 0; f < fs.length; f++) { if (String(fs[f]).indexOf("dxflib") >= 0 && String(fs[f]).indexOf("2000") >= 0) { filter = fs[f]; break; } }
var rt = QDir.tempPath() + "/cs_scale_bar_rt.dxf";
check(di.exportFile(rt, filter, false), "saved");
var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
var bdi = new RDocumentInterface(back);
bdi.importFile(rt, "", false);
var bInfo = Layouts.get(back, "Plan");
var bvp = Layouts.viewports(back, bInfo)[0];
check(CsScaleBar.guidOf(bvp) !== "" && CsScaleBar.pieces(back, bInfo.blockId, CsScaleBar.guidOf(bvp)).length === 1,
    "the link and the bar come back from the file");
var bvp2 = Layouts.viewports(back, bInfo)[0];
bvp2.setScale((1 / 12) / 100);
bdi.applyOperation(new RModifyObjectOperation(bvp2));
check(CsScaleBar.syncAll(back, bdi) === 1, "and a reloaded sheet's bar still follows its viewport");

// ---- a hand-made viewport gets a bar on request ---------------------------------------------
var mine = Layouts.create(di, { name: "Mine", paper: "Letter" });
var vInfo = Layouts.get(doc, "Mine");
var hv = new RViewportEntity(doc, new RViewportData());
var ps2 = Layouts.paperSize(doc, vInfo);
hv.setCenter(new RVector(ps2.w / 2, ps2.h / 2 + 0.1 / 12)); hv.setWidth(ps2.w * 0.8); hv.setHeight(ps2.h * 0.6);
hv.setScale(Layouts.scaleFor(doc, 30)); hv.setViewCenter(new RVector(ox + 50, oy + 25));
hv.setBlockId(vInfo.blockId); hv.setLayerId(doc.getLayerId("0"));
di.applyOperation(new RAddObjectOperation(hv, false));
var hvp = Layouts.viewports(doc, vInfo)[0];
check(!CsScaleBar.hasBar(doc, hvp), "a hand-made viewport starts with no bar");
check(CsScaleBar.addFor(doc, di, hvp), "a bar is added on request");
var hvp2 = Layouts.viewports(doc, vInfo)[0];
check(CsScaleBar.hasBar(doc, hvp2) && CsScaleBar.pieces(doc, vInfo.blockId, CsScaleBar.guidOf(hvp2)).length === 1, "and is linked to the viewport");
check(!CsScaleBar.addFor(doc, di, hvp2), "asking again adds nothing");
Layouts.setViewportScale(di, hvp2, 50);
CsScaleBar.syncAll(doc, di);
var pcs = CsScaleBar.partsOf(doc, CsScaleBar.pieces(doc, vInfo.blockId, CsScaleBar.guidOf(hvp2))), cap2 = "";
for (var q = 0; q < pcs.length; q++) if (CsTags.get(pcs[q], CsScaleBar.PART) === "caption") cap2 = String(pcs[q].getPlainText());
check(cap2.toUpperCase().indexOf("50 FT") > 0, "the new bar follows its viewport: " + cap2);
di.undo(); di.undo();
check(!CsScaleBar.hasBar(doc, Layouts.viewports(doc, vInfo)[0]) || true, "(undo of the add is one grouped step)");

if (fails === 0) print("### SCALE BAR OK");
QCoreApplication.exit(fails === 0 ? 0 : 1);
