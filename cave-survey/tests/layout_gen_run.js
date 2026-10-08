/**
 * Sheet Setup as layouts: CsLayoutGen writes a viewport + furniture per
 * sheet into the live drawing, leaves manual layouts alone, rewrites auto
 * ones without piling up copies, and tiles a big cave into numbered sheets
 * whose viewports show exactly the tile's map.
 */
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) { }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}
var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
include("scripts/EAction.js");
include("scripts/simple.js");
include("scripts/File/Print/Print.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### LAYOUT GEN FAILED: " + m); } else print("ok: " + m); }
function near(a, b, tol) { return Math.abs(a - b) < (isNull(tol) ? 1e-6 : tol); }

function countBy(doc, blockId, tag) {
    var ids = doc.queryBlockEntities(blockId), n = 0, kinds = {};
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) continue;
        var t = CsTags.get(e, CsLayoutGen.TAG);
        if (t !== "") { n++; kinds[t] = (kinds[t] || 0) + 1; }
    }
    return { n: n, kinds: kinds };
}

function main() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    var ox = 500000, oy = 3900000;
    var model0;

    // cave: a 100 x 50 ft passage plus a profile-frame line the plan sheet must not show
    CsLayers.ensure(doc, di, "WALL-SURVEYED");
    CsLayers.ensure(doc, di, "PROFILE-WALL");
    var op = new RAddObjectsOperation();
    var wall = new RLineEntity(doc, new RLineData(new RVector(ox, oy), new RVector(ox + 100, oy + 50)));
    wall.setLayerId(doc.getLayerId("WALL-SURVEYED"));
    op.addObject(wall, false);
    var prof = new RLineEntity(doc, new RLineData(new RVector(ox, oy - 80), new RVector(ox + 100, oy - 60)));
    prof.setLayerId(doc.getLayerId("PROFILE-WALL"));
    op.addObject(prof, false);
    di.applyOperation(op);
    model0 = doc.queryBlockEntities(doc.getModelSpaceBlockId()).length;

    var sheet = CsSheetSetup.sheetByName("ANSI A -- 11 x 8.5");
    var base = {
        caveBox: { minX: ox, minY: oy, maxX: ox + 100, maxY: oy + 50 },
        sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: { border: true, bar: true, north: true, title: true },
        titleValues: { caveName: "Test Cave" }, reading: { declination: 4.0, date: "2024-11-03" },
        tiles: null, elevation: false
    };

    // ---- one sheet -----------------------------------------------------
    var res = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: base.scale, perFoot: 1, wants: base.wants, titleValues: base.titleValues,
        reading: base.reading, tiles: null, extra: { titleValues: base.titleValues } });
    check(res.made.join() === "Plan" && res.rewritten.length === 0, "first run creates layout Plan: " + res.made);
    var info = Layouts.get(doc, "Plan");
    check(!isNull(info) && info.mode === "auto", "Plan is an AUTO layout");
    check(near(info.paperMM.w, 279.4) && near(info.paperMM.h, 215.9), "paper is ANSI A landscape");
    check(doc.queryBlockEntities(doc.getModelSpaceBlockId()).length === model0, "nothing was written into model space");
    var c1 = countBy(doc, info.blockId);
    check(c1.kinds.viewport === 1, "one viewport");
    check(c1.kinds.SCALE_BAR > 0 || c1.kinds["SCALE-BAR"] > 0, "a scale bar was drawn");
    check(c1.kinds["NORTH-ARROW"] > 0 && c1.kinds["TITLE-BLOCK"] > 0, "north arrow and title block drawn");
    check(c1.kinds.BORDER > 0, "margin border drawn (a sheet with a footer band)");

    var vpId = 0;
    var ids = doc.queryBlockEntities(info.blockId);
    var vp;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (e.getType() === RS.EntityViewport) { vp = e; }
    }
    check(!isNull(vp), "viewport entity found");
    check(near(vp.getScale(), (1 / 12) / 20, 1e-9), "viewport scale is 1 in = 20 ft in feet-per-feet: " + vp.getScale());
    check(near(vp.getWidth(), 10 / 12, 1e-9), "viewport width = sheet minus two 0.5in margins (10in)");
    check(near(vp.getViewCenter().x, ox + 50, 1e-6), "view centre is a real model coordinate");
    var frozen = vp.getFrozenLayerIds().map(function(id) { return doc.getLayerName(id); });
    check(frozen.indexOf("PROFILE-WALL") >= 0 && frozen.indexOf("WALL-SURVEYED") < 0 &&
          frozen.indexOf("0") < 0 && frozen.indexOf("BORDER") < 0,
          "profile layers frozen in the plan viewport; plan and shared sheet layers (0, BORDER) are not: " + frozen.join());
    check(String(vp.getCustomProperty("CaveCAD", "NoRaster")) === "1", "the viewport says: no raster images");

    // ---- AUTO / EDITED / REVERT ------------------------------------------
    info = Layouts.get(doc, "Plan");
    check(CsLayoutGen.state(doc, info) === "auto", "a freshly generated sheet is AUTO");
    check(Layouts.isLocked(vp), "the generated viewport is locked");
    // hand edit 1: move a piece of furniture
    var ids1 = doc.queryBlockEntities(info.blockId);
    var victim;
    for (var vi = 0; vi < ids1.length; vi++) {
        var ve = doc.queryEntity(ids1[vi]);
        if (CsTags.get(ve, CsLayoutGen.TAG) === "NORTH-ARROW" && ve.getType() === RS.EntityLine) { victim = ve; break; }
    }
    check(!isNull(victim), "found a north arrow line to edit");
    var moveOp = new RModifyObjectsOperation();
    victim.move(new RVector(0.05, 0));
    moveOp.addObject(victim, false);
    di.applyOperation(moveOp);
    check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "edited", "moving one line turns the sheet EDITED");
    var skipRes = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: 20, perFoot: 1, wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: null });
    check(skipRes.skipped.join() === "Plan", "an EDITED sheet is skipped by the generator, like a manual one");
    di.undo();
    check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "auto", "undoing the edit makes it AUTO again, by itself");
    // hand edit 2: add a note
    var note = new RTextEntity(doc, new RTextData(new RVector(0.05, 0.05), new RVector(0.05, 0.05), 0.01, 0.5,
        RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact, 1.0, "hand note", "standard", false, false, 0.0, false));
    note.setBlockId(info.blockId);
    note.setLayerId(doc.getLayerId("0"));
    di.applyOperation(new RAddObjectOperation(note, false));
    check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "edited", "adding a note turns it EDITED");
    check(CsLayoutGen.canRevert(doc, Layouts.get(doc, "Plan")), "a generated sheet can be reverted");
    check(CsLayoutGen.revert(doc, di, "Plan"), "revert");
    var afterRevert = Layouts.get(doc, "Plan");
    check(CsLayoutGen.state(doc, afterRevert) === "auto", "revert puts the sheet back to AUTO");
    var noteLeft = false;
    var ids2 = doc.queryBlockEntities(afterRevert.blockId);
    for (var ri = 0; ri < ids2.length; ri++) {
        var re = doc.queryEntity(ids2[ri]);
        if (!re.isUndone() && re.getType() === RS.EntityText && String(re.getPlainText()) === "HAND NOTE" || (!re.isUndone() && re.getType() === RS.EntityText && String(re.getPlainText()).toLowerCase() === "hand note")) noteLeft = true;
    }
    check(!noteLeft, "revert removed the hand-made note");
    di.undo();
    check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "edited", "reverting is ONE undo step (the note is back)");
    di.redo();
    // hand edit 3: unlock the viewport
    var vpNow = Layouts.viewports(doc, Layouts.get(doc, "Plan"))[0];
    Layouts.setLocked(di, vpNow, false);
    check(CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "edited", "unlocking the viewport turns it EDITED");
    check(CsLayoutGen.revert(doc, di, "Plan"), "revert again");
    check(Layouts.isLocked(Layouts.viewports(doc, Layouts.get(doc, "Plan"))[0]) &&
          CsLayoutGen.state(doc, Layouts.get(doc, "Plan")) === "auto", "revert re-locks the viewport and the sheet is AUTO");
    // a hand-made layout is manual from the start and cannot be reverted
    var mine = Layouts.create(di, { name: "Mine", paper: "A4" });
    check(CsLayoutGen.state(doc, mine) === "manual" && !CsLayoutGen.canRevert(doc, mine), "a layout the person made is MANUAL and has nothing to revert to");
    Layouts.remove(di, "Mine");

    // ---- re-run: auto layout rewritten in place, no copies -------------
    var res2 = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: 25, perFoot: 1, wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: null });
    check(res2.rewritten.join() === "Plan" && res2.made.length === 0, "second run rewrites, creates nothing new");
    var c2 = countBy(doc, info.blockId);
    check(c2.kinds.viewport === 1, "still ONE viewport after the rewrite");
    check(Layouts.list(doc).length === 1, "still one layout");

    // ---- manual layouts are left alone ----------------------------------
    Layouts.setMode(di, "Plan", "manual");
    var before = countBy(doc, info.blockId).n;
    var res3 = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, sheet: base.sheet, turned: false,
        scale: 10, perFoot: 1, wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: null });
    check(res3.skipped.join() === "Plan" && countBy(doc, info.blockId).n === before, "a MANUAL layout is skipped and untouched");
    Layouts.setMode(di, "Plan", "auto");

    // ---- a big cave: tiles ------------------------------------------------
    var big = { minX: ox, minY: oy, maxX: ox + 900, maxY: oy + 400 };
    var tiles = CsSheetTile.layout({ caveBox: big, sheet: sheet, scale: 20, footerInches: 0,
        turned: false, occupied: [big], shiftInches: { x: 0, y: 0 } });
    check(tiles.tiled === true && tiles.tiles.length >= 4, "the big cave tiles: " + tiles.tiles.length + " sheets");
    var res4 = CsLayoutGen.generate(doc, di, { caveBox: big, sheet: sheet, turned: false, scale: 20, perFoot: 1,
        wants: base.wants, titleValues: base.titleValues, reading: base.reading, tiles: tiles });
    check(res4.made.length === tiles.tiles.length, "one layout per tile: " + res4.made.join());
    var nTitle = 0, allShow = true;
    for (var t = 0; t < tiles.tiles.length; t++) {
        var tile = tiles.tiles[t];
        var inf = Layouts.get(doc, tile.id);
        var kinds = countBy(doc, inf.blockId).kinds;
        if (kinds["TITLE-BLOCK"] > 0) nTitle++;
        var tvp;
        var tids = doc.queryBlockEntities(inf.blockId);
        for (var q = 0; q < tids.length; q++) {
            var te = doc.queryEntity(tids[q]);
            if (te.getType() === RS.EntityViewport) tvp = te;
        }
        // the model rectangle the viewport shows: view centre +- half the frame / scale
        var halfW = tvp.getWidth() / 2 / tvp.getScale(), halfH = tvp.getHeight() / 2 / tvp.getScale();
        var ok = near(tvp.getViewCenter().x - halfW, tile.map.minX, 1e-4) &&
                 near(tvp.getViewCenter().x + halfW, tile.map.maxX, 1e-4) &&
                 near(tvp.getViewCenter().y - halfH, tile.map.minY, 1e-4) &&
                 near(tvp.getViewCenter().y + halfH, tile.map.maxY, 1e-4);
        if (!ok) { allShow = false; print("  tile " + tile.id + " shows the wrong area"); }
        check(kinds.matchline > 0 || tiles.tiles.length === 1, "tile " + tile.id + " has match lines");
    }
    check(allShow, "every tile's viewport shows exactly the tile's map rectangle");
    check(nTitle === 1, "exactly one sheet carries the title block: " + nTitle);
    check(Layouts.get(doc, "A1") !== undefined, "tiles are named by grid place (A1 exists)");

    // ---- the elevation sheet: a viewport onto the profile region ------------------
    var profBox = { minX: ox, minY: oy - 80, maxX: ox + 100, maxY: oy - 60 };
    var resE = CsLayoutGen.generate(doc, di, { caveBox: base.caveBox, elevBox: profBox, sheet: sheet, turned: false,
        scale: 20, perFoot: 1, wants: { border: true, bar: true, north: true, title: false }, titleValues: {}, reading: null,
        tiles: null, elevation: true });
    check(resE.made.indexOf("Elevation") >= 0, "an Elevation sheet is made when there is a profile frame: " + resE.made.join());
    var eInfo = Layouts.get(doc, "Elevation");
    var evp = Layouts.viewports(doc, eInfo)[0];
    var eFrozen = evp.getFrozenLayerIds().map(function(id) { return doc.getLayerName(id); });
    check(eFrozen.indexOf("WALL-SURVEYED") >= 0 && eFrozen.indexOf("PROFILE-WALL") < 0, "the elevation viewport hides the PLAN layers and shows the profile ones: " + eFrozen.join());
    check(evp.getViewCenter().y < oy - 50 && evp.getViewCenter().y > oy - 90, "its view is centred on the profile region, not the plan: y=" + evp.getViewCenter().y);
    var eKinds = countBy(doc, eInfo.blockId).kinds;
    check(!eKinds["NORTH-ARROW"], "an elevation has no north arrow");
    check(eKinds["SCALE-BAR"] > 0, "but it has a scale bar");

    // ---- the file: generated sheets keep their state across save / reload ----
    var filter = "";
    var fs = RFileExporterRegistry.getFilterStrings();
    for (var fi = 0; fi < fs.length; fi++) { if (String(fs[fi]).indexOf("dxflib") >= 0 && String(fs[fi]).indexOf("2000") >= 0) { filter = fs[fi]; break; } }
    var rt = QDir.tempPath() + "/cs_layout_gen_rt.dxf";
    check(di.exportFile(rt, filter, false), "saved");
    var back = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var bdi = new RDocumentInterface(back);
    bdi.importFile(rt, "", false);
    check(Layouts.list(back).length === Layouts.list(doc).length, "all sheets came back: " + Layouts.list(back).length);
    var bInfo = Layouts.get(back, "A1");
    check(!isNull(bInfo) && CsLayoutGen.state(back, bInfo) === "auto", "a reloaded generated sheet is still AUTO (signature survives the file)");
    check(CsLayoutGen.canRevert(back, bInfo), "and can still be reverted (the job survived: it is a long string)");
    check(CsLayoutGen.revert(back, bdi, "A1") && CsLayoutGen.state(back, Layouts.get(back, "A1")) === "auto", "revert works on the reloaded drawing");

    // ---- where the sheets go: one new file, or a file each --------------------------------------
    var names = Layouts.list(doc).map(function(l) { return l.name; });
    check(names.length >= 2, "there are several sheets to deliver: " + names.length);
    var base = QDir.tempPath() + "/cs_where_" + (new Date()).getTime();
    var one = CsLayoutGen.writeCopies(di, CsLayoutGen.jobsFor(CsLayoutGen.WHERE_ONE, names, base));
    check(one.ok && one.paths.length === 1, "one file for all sheets: " + one.error);
    var d1 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i1 = new RDocumentInterface(d1);
    i1.importFile(one.paths[0], "", false);
    check(Layouts.list(d1).length === names.length, "it holds every sheet");
    check(d1.queryBlockEntities(d1.getModelSpaceBlockId()).length >= model0, "and the model they look at");
    var each = CsLayoutGen.writeCopies(di, CsLayoutGen.jobsFor(CsLayoutGen.WHERE_EACH, names, base));
    check(each.ok && each.paths.length === names.length, "a file per sheet: " + each.error);
    var d2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i2 = new RDocumentInterface(d2);
    i2.importFile(each.paths[0], "", false);
    var kept = Layouts.list(d2);
    check(kept.length === 1 && kept[0].name === names[0], "each file holds only its own sheet: " + kept.map(function(l) { return l.name; }));
    check(d2.queryBlockEntities(d2.getModelSpaceBlockId()).length >= model0, "and still the model");
    check(Layouts.list(doc).length === names.length, "the open drawing is untouched by copying");
    check(CsLayoutGen.fileSafe("A/1: x") === "A-1- x", "sheet names make safe file names: " + CsLayoutGen.fileSafe("A/1: x"));

    if (fails === 0) print("### LAYOUT GEN OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
