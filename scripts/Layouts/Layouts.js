/**
 * Layouts -- paper-space layouts of a drawing (CaveCAD viewport workflow).
 *
 * A LAYOUT is a named sheet of paper. It is stored as an RLayout object
 * (paper size, margins, units, custom properties) linked to an RBlock whose
 * entities are that sheet's PAPER SPACE: title block, text, and VIEWPORTS
 * (RViewportEntity) that show model space at a scale of their own.
 *
 *   Model            *Model_Space      the cave itself, always first tab
 *   Layout "A1"      *Paper_Space      paper space
 *   Layout "B2"      *Paper_Space1     paper space, ...
 *
 * UNITS. The paper size is stored in MILLIMETRES, oriented as it sits on the
 * desk (landscape = width > height). Paper-space COORDINATES are in the
 * DRAWING unit, exactly like model space (measured 2026-10-05: lineweights,
 * text heights, linetype patterns and Print's unit scale all convert through
 * the drawing unit, so paper coordinates in any other unit make lines 12x
 * too thin in a feet drawing). A cave in feet therefore has a Letter sheet
 * of 0.9167 x 0.7083 ft, and a viewport showing 1 in = 50 ft has
 * scale (1/12)/50 = 1/600. The layout's "paper units" (RLayout plot paper
 * units, 0 inches / 1 mm) is only the unit people TYPE and READ dimensions
 * in; use Layouts.toPaper / Layouts.fromPaper to cross over.
 *
 * Every mutating function takes the RDocumentInterface and is undoable.
 * Queries take the RDocument. Pure data in, plain objects out ("info").
 */

var Layouts = {};

/** RLayout plot paper units. */
Layouts.INCHES = 0;
Layouts.MILLIMETERS = 1;

/** Custom-property home of the auto / manual flag (see Layouts.getMode). */
Layouts.PROP_TITLE = "CaveCAD";
Layouts.PROP_MODE = "LayoutMode";

/** Name of the model tab. */
Layouts.MODEL = "Model";

/** Portrait sizes in millimetres. */
Layouts.PAPERS = [
    { name: "A4", w: 210, h: 297 },
    { name: "A3", w: 297, h: 420 },
    { name: "A2", w: 420, h: 594 },
    { name: "A1", w: 594, h: 841 },
    { name: "A0", w: 841, h: 1189 },
    { name: "Letter", w: 215.9, h: 279.4 },
    { name: "Legal", w: 215.9, h: 355.6 },
    { name: "Tabloid", w: 279.4, h: 431.8 },
    { name: "ANSI C", w: 431.8, h: 558.8 },
    { name: "ANSI D", w: 558.8, h: 863.6 },
    { name: "ANSI E", w: 863.6, h: 1117.6 },
    { name: "Arch A", w: 228.6, h: 304.8 },
    { name: "Arch B", w: 304.8, h: 457.2 },
    { name: "Arch C", w: 457.2, h: 609.6 },
    { name: "Arch D", w: 609.6, h: 914.4 },
    { name: "Arch E", w: 914.4, h: 1219.2 }
];

Layouts.DEFAULT_MARGIN_MM = 6.35;

/** Portrait [w, h] in mm of a named paper, or undefined. */
Layouts.paperByName = function(name) {
    for (var i = 0; i < Layouts.PAPERS.length; i++) {
        if (Layouts.PAPERS[i].name === name) {
            return Layouts.PAPERS[i];
        }
    }
    return undefined;
};

/** Name of the standard paper matching w x h mm in either orientation (1 mm tolerance), or "". */
Layouts.paperNameOf = function(wMM, hMM) {
    var a = Math.min(wMM, hMM), b = Math.max(wMM, hMM);
    for (var i = 0; i < Layouts.PAPERS.length; i++) {
        var p = Layouts.PAPERS[i];
        if (Math.abs(p.w - a) < 1 && Math.abs(p.h - b) < 1) {
            return p.name;
        }
    }
    return "";
};

/** Millimetres of paper -> paper-space coordinates (drawing units) of this document. */
Layouts.toPaper = function(doc, mm) {
    return RUnit.convert(mm, RS.Millimeter, doc.getUnit());
};

/** Paper-space coordinates (drawing units) -> millimetres of paper. */
Layouts.fromPaper = function(doc, coord) {
    return RUnit.convert(coord, doc.getUnit(), RS.Millimeter);
};

/** Paper size in PAPER-SPACE COORDINATES (drawing units): { w, h }. */
Layouts.paperSize = function(doc, info) {
    return { w: Layouts.toPaper(doc, info.paperMM.w), h: Layouts.toPaper(doc, info.paperMM.h) };
};

/** Margins in paper-space coordinates: { l, b, r, t }. */
Layouts.margins = function(doc, info) {
    return { l: Layouts.toPaper(doc, info.marginsMM.l), b: Layouts.toPaper(doc, info.marginsMM.b),
             r: Layouts.toPaper(doc, info.marginsMM.r), t: Layouts.toPaper(doc, info.marginsMM.t) };
};

/**
 * Printable frame in paper coordinates: { x1, y1, x2, y2 } (paper origin at
 * the lower left corner of the sheet).
 */
Layouts.printableBox = function(doc, info) {
    var s = Layouts.paperSize(doc, info), m = Layouts.margins(doc, info);
    return { x1: m.l, y1: m.b, x2: s.w - m.r, y2: s.h - m.t };
};

Layouts.getMode = function(layout) {
    var v = layout.getCustomProperty(Layouts.PROP_TITLE, Layouts.PROP_MODE);
    return (v === "auto") ? "auto" : "manual";
};

function _layoutsInfoOf(doc, block) {
    var layout = doc.queryLayout(block.getLayoutId());
    if (isNull(layout)) {
        return undefined;
    }
    var size = layout.getPlotPaperSize();
    if (size.x <= 0 || size.y <= 0) {
        // the empty default layout every new document carries: not a sheet yet
        return undefined;
    }
    return {
        name: layout.getName(),
        blockId: block.getId(),
        blockName: block.getName(),
        layoutId: layout.getId(),
        tab: layout.getTabOrder(),
        paperMM: { w: size.x, h: size.y },
        units: layout.getPlotPaperUnits(),
        marginsMM: {
            l: layout.getPlotPaperMarginLeftMM(), b: layout.getPlotPaperMarginBottomMM(),
            r: layout.getPlotPaperMarginRightMM(), t: layout.getPlotPaperMarginTopMM()
        },
        mode: Layouts.getMode(layout)
    };
}

/** All paper layouts in tab order (Model is not included). */
Layouts.list = function(doc) {
    var ids = doc.queryAllLayoutBlocks(false);
    var ret = [];
    for (var i = 0; i < ids.length; i++) {
        var block = doc.queryBlock(ids[i]);
        if (isNull(block) || !block.hasLayout()) {
            continue;
        }
        var info = _layoutsInfoOf(doc, block);
        if (!isNull(info)) {
            ret.push(info);
        }
    }
    ret.sort(function(a, b) {
        if (a.tab !== b.tab) {
            return a.tab - b.tab;
        }
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return ret;
};

/** Info of the layout with the given name, or undefined. */
Layouts.get = function(doc, name) {
    var all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        if (all[i].name === name) {
            return all[i];
        }
    }
    return undefined;
};

/** Info of the layout owning the given block id, or undefined. */
Layouts.ofBlock = function(doc, blockId) {
    var all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        if (all[i].blockId === blockId) {
            return all[i];
        }
    }
    return undefined;
};

/** Info of the layout currently shown, or undefined while in model space. */
Layouts.current = function(doc) {
    return Layouts.ofBlock(doc, doc.getCurrentBlockId());
};

Layouts.isModel = function(doc) {
    return doc.getCurrentBlockId() === doc.getModelSpaceBlockId();
};

/** First name "Layout N" not in use. */
Layouts.freeName = function(doc, base) {
    base = isNull(base) ? "Layout" : base;
    var used = {};
    var all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        used[all[i].name.toLowerCase()] = true;
    }
    used[Layouts.MODEL.toLowerCase()] = true;
    if (!used[base.toLowerCase()]) {
        return base;
    }
    for (var n = 1; n < 100000; n++) {
        var candidate = base + " " + n;
        if (!used[candidate.toLowerCase()]) {
            return candidate;
        }
    }
    return base;
};

function _layoutsFreeBlockName(doc) {
    if (isNull(doc.queryBlock("*Paper_Space")) || doc.getBlockId("*Paper_Space") === RObject.INVALID_ID) {
        return "*Paper_Space";
    }
    for (var n = 1; n < 100000; n++) {
        var name = "*Paper_Space" + n;
        if (doc.getBlockId(name) === RObject.INVALID_ID) {
            return name;
        }
    }
    return "*Paper_Space";
}

/** True when `name` can be used for a (new or renamed) layout. */
Layouts.nameOk = function(doc, name, exceptName) {
    if (isNull(name)) {
        return false;
    }
    name = String(name).trim();
    if (name.length === 0 || name.charAt(0) === "*") {
        return false;
    }
    if (name.toLowerCase() === Layouts.MODEL.toLowerCase()) {
        return false;
    }
    var all = Layouts.list(doc);
    for (var i = 0; i < all.length; i++) {
        if (all[i].name.toLowerCase() === name.toLowerCase() &&
            (isNull(exceptName) || all[i].name !== exceptName)) {
            return false;
        }
    }
    return true;
};

/**
 * Creates a layout. opts:
 *   name       text (default: free "Layout N")
 *   paper      standard name ("A1", "Letter"...) or { w, h } in mm (default "Letter")
 *   landscape  boolean (default true)
 *   units      Layouts.INCHES | Layouts.MILLIMETERS: the unit dimensions are typed in (default INCHES for ANSI/Letter/Arch papers, else mm)
 *   margins    number mm applied to all sides, or { l, b, r, t } (default 6.35)
 *   mode       "auto" | "manual" (default "manual")
 *   tab        tab position (default: last)
 *
 * \return the info of the new layout, or undefined (name already used).
 */
Layouts.create = function(di, opts) {
    var doc = di.getDocument();
    opts = isNull(opts) ? {} : opts;
    var name = isNull(opts.name) ? Layouts.freeName(doc) : String(opts.name).trim();
    if (!Layouts.nameOk(doc, name)) {
        return undefined;
    }

    var paper = isNull(opts.paper) ? "Letter" : opts.paper;
    var wMM, hMM, defaultUnits = Layouts.MILLIMETERS;
    if (typeof paper === "string") {
        var p = Layouts.paperByName(paper);
        if (isNull(p)) {
            return undefined;
        }
        wMM = p.w;
        hMM = p.h;
        if (/^(Letter|Legal|Tabloid|ANSI|Arch)/.test(paper)) {
            defaultUnits = Layouts.INCHES;
        }
    }
    else {
        wMM = paper.w;
        hMM = paper.h;
    }
    var landscape = isNull(opts.landscape) ? true : opts.landscape;
    var wide = Math.max(wMM, hMM), tall = Math.min(wMM, hMM);
    var sizeW = landscape ? wide : tall;
    var sizeH = landscape ? tall : wide;
    var units = isNull(opts.units) ? defaultUnits : opts.units;

    var m = isNull(opts.margins) ? Layouts.DEFAULT_MARGIN_MM : opts.margins;
    if (typeof m === "number") {
        m = { l: m, b: m, r: m, t: m };
    }

    var all = Layouts.list(doc);
    var tab = isNull(opts.tab) ? (all.length === 0 ? 1 : all[all.length - 1].tab + 1) : opts.tab;

    var layout = new RLayout(doc, name);
    layout.setTabOrder(tab);
    layout.setPlotPaperSize(new RVector(sizeW, sizeH));
    layout.setPlotPaperUnits(units);
    layout.setPlotPaperMarginLeftMM(m.l);
    layout.setPlotPaperMarginBottomMM(m.b);
    layout.setPlotPaperMarginRightMM(m.r);
    layout.setPlotPaperMarginTopMM(m.t);
    layout.setCustomProperty(Layouts.PROP_TITLE, Layouts.PROP_MODE, opts.mode === "auto" ? "auto" : "manual");

    // The blank default layout ("Layout1" on *Paper_Space) every document
    // is born with becomes the first sheet instead of lingering unused.
    var blankBlockId = doc.getBlockId("*Paper_Space");
    if (blankBlockId !== RObject.INVALID_ID && isNull(Layouts.ofBlock(doc, blankBlockId))) {
        var blankBlock = doc.queryBlock(blankBlockId);
        if (!isNull(blankBlock) && blankBlock.hasLayout()) {
            var blank = doc.queryLayout(blankBlock.getLayoutId());
            if (!isNull(blank)) {
                blank.setName(name);
                blank.setTabOrder(tab);
                blank.setPlotPaperSize(new RVector(sizeW, sizeH));
                blank.setPlotPaperUnits(units);
                blank.setPlotPaperMarginLeftMM(m.l);
                blank.setPlotPaperMarginBottomMM(m.b);
                blank.setPlotPaperMarginRightMM(m.r);
                blank.setPlotPaperMarginTopMM(m.t);
                blank.setCustomProperty(Layouts.PROP_TITLE, Layouts.PROP_MODE, opts.mode === "auto" ? "auto" : "manual");
                var reuse = new RModifyObjectsOperation();
                reuse.setText(qsTr("Create layout"));
                reuse.addObject(blank, false);
                di.applyOperation(reuse);
                Layouts.applyPrintSettings(di, name);
                return Layouts.get(doc, name);
            }
        }
    }

    var blockName = _layoutsFreeBlockName(doc);

    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();

    var addLayout = new RAddObjectsOperation();
    addLayout.setText(qsTr("Create layout"));
    addLayout.setTransactionGroup(group);
    addLayout.addObject(layout, false);
    di.applyOperation(addLayout);

    var layoutId = doc.queryLayout(name).getId();
    var block = new RBlock(doc, blockName, new RVector(0, 0));
    block.setLayoutId(layoutId);
    var addBlock = new RAddObjectsOperation();
    addBlock.setText(qsTr("Create layout"));
    addBlock.setTransactionGroup(group);
    addBlock.addObject(block, false);
    di.applyOperation(addBlock);

    Layouts.applyPrintSettings(di, name, group);
    return Layouts.get(doc, name);
};

/** Saves changed RLayout properties through the layout named `name`. */
function _layoutsModify(di, name, fn, text) {
    var doc = di.getDocument();
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return undefined;
    }
    var layout = doc.queryLayout(info.layoutId);
    fn(layout, info);
    var op = new RModifyObjectsOperation();
    op.setText(isNull(text) ? qsTr("Modify layout") : text);
    op.addObject(layout, false);
    di.applyOperation(op);
    return Layouts.get(doc, layout.getName());
}

Layouts.rename = function(di, name, newName) {
    var doc = di.getDocument();
    newName = isNull(newName) ? "" : String(newName).trim();
    if (!Layouts.nameOk(doc, newName, name)) {
        return undefined;
    }
    return _layoutsModify(di, name, function(layout) { layout.setName(newName); }, qsTr("Rename layout"));
};

/** Moves a layout to tab index `index` (0 = first paper tab, after Model). */
Layouts.move = function(di, name, index) {
    var doc = di.getDocument();
    var all = Layouts.list(doc);
    var from = -1;
    for (var i = 0; i < all.length; i++) {
        if (all[i].name === name) {
            from = i;
        }
    }
    if (from < 0) {
        return false;
    }
    index = Math.max(0, Math.min(all.length - 1, index));
    var moved = all.splice(from, 1)[0];
    all.splice(index, 0, moved);
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    for (var k = 0; k < all.length; k++) {
        if (all[k].tab === k + 1) {
            continue;
        }
        var layout = doc.queryLayout(all[k].layoutId);
        layout.setTabOrder(k + 1);
        var op = new RModifyObjectsOperation();
        op.setText(qsTr("Move layout"));
        op.setTransactionGroup(group);
        op.addObject(layout, false);
        di.applyOperation(op);
    }
    return true;
};

/**
 * Changes paper settings. changes: paper (name or {w,h} mm), landscape, units, margins.
 * Paper size changes do not move paper-space entities.
 */
Layouts.setPaper = function(di, name, changes) {
    return _layoutsModify(di, name, function(layout, info) {
        var wMM = info.paperMM.w, hMM = info.paperMM.h;
        if (!isNull(changes.paper)) {
            var p = (typeof changes.paper === "string") ? Layouts.paperByName(changes.paper) : changes.paper;
            if (!isNull(p)) {
                wMM = p.w;
                hMM = p.h;
            }
        }
        var landscape = isNull(changes.landscape) ? (info.paperMM.w >= info.paperMM.h) : changes.landscape;
        var wide = Math.max(wMM, hMM), tall = Math.min(wMM, hMM);
        layout.setPlotPaperSize(new RVector(landscape ? wide : tall, landscape ? tall : wide));
        if (!isNull(changes.units)) {
            layout.setPlotPaperUnits(changes.units);
        }
        if (!isNull(changes.margins)) {
            var m = changes.margins;
            if (typeof m === "number") {
                m = { l: m, b: m, r: m, t: m };
            }
            layout.setPlotPaperMarginLeftMM(m.l);
            layout.setPlotPaperMarginBottomMM(m.b);
            layout.setPlotPaperMarginRightMM(m.r);
            layout.setPlotPaperMarginTopMM(m.t);
        }
    }, qsTr("Page setup"));
};

/** Page setup that also keeps the block's print settings in step. */
Layouts.pageSetup = function(di, name, changes) {
    var info = Layouts.setPaper(di, name, changes);
    if (!isNull(info)) {
        Layouts.applyPrintSettings(di, info.name);
    }
    return Layouts.get(di.getDocument(), isNull(info) ? name : info.name);
};

/** Sets "auto" or "manual". */
Layouts.setMode = function(di, name, mode) {
    return _layoutsModify(di, name, function(layout) {
        layout.setCustomProperty(Layouts.PROP_TITLE, Layouts.PROP_MODE, mode === "auto" ? "auto" : "manual");
    }, qsTr("Layout mode"));
};

/** Shows a layout (or model space when name is null / "Model"). */
Layouts.activate = function(di, name) {
    var doc = di.getDocument();
    if (isNull(name) || name === Layouts.MODEL) {
        di.setCurrentBlock(doc.getModelSpaceBlockId());
        return true;
    }
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return false;
    }
    di.setCurrentBlock(info.blockId);
    return true;
};

/** Deletes a layout with everything on it. Model space is shown first when it was current. */
Layouts.remove = function(di, name) {
    var doc = di.getDocument();
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return false;
    }
    if (doc.getCurrentBlockId() === info.blockId) {
        di.setCurrentBlock(doc.getModelSpaceBlockId());
    }
    var block = doc.queryBlock(info.blockId);
    var layout = doc.queryLayout(info.layoutId);
    var op = new RDeleteObjectsOperation();
    op.setText(qsTr("Delete layout"));
    op.deleteObject(block);
    op.deleteObject(layout);
    di.applyOperation(op);
    return true;
};

/**
 * Copies a layout and everything on it under a new name (manual mode).
 * Viewports are cloned as they are.
 */
Layouts.duplicate = function(di, name, newName) {
    var doc = di.getDocument();
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return undefined;
    }
    newName = isNull(newName) ? Layouts.freeName(doc, name + " copy") : String(newName).trim();
    if (!Layouts.nameOk(doc, newName)) {
        return undefined;
    }
    var created = Layouts.create(di, {
        name: newName,
        paper: { w: info.paperMM.w, h: info.paperMM.h },
        landscape: info.paperMM.w >= info.paperMM.h,
        units: info.units,
        margins: info.marginsMM,
        mode: "manual",
        tab: info.tab + 1
    });
    if (isNull(created)) {
        return undefined;
    }
    var ids = doc.queryBlockEntities(info.blockId);
    if (ids.length > 0) {
        var op = new RAddObjectsOperation();
        op.setText(qsTr("Duplicate layout"));
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.isUndone()) {
                continue;
            }
            var copy = e.clone();
            copy.setBlockId(created.blockId);
            op.addObject(copy, false, true);
        }
        di.applyOperation(op);
    }
    Layouts.move(di, newName, Layouts.list(doc).map(function(l) { return l.name; }).indexOf(name) + 1);
    return Layouts.get(doc, newName);
};


// ---------------------------------------------------------------------------
// Viewports
// ---------------------------------------------------------------------------

/** Status bit of a viewport's display lock (RViewportData::Locked). */
Layouts.LOCK_BIT = 0x40000;

/** The viewports (RViewportEntity) of a layout, in drawing order. */
Layouts.viewports = function(doc, info) {
    var out = [];
    var ids = doc.queryBlockEntities(info.blockId);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e) && !e.isUndone() && e.getType() === RS.EntityViewport && !e.isOverall()) {
            out.push(e);
        }
    }
    return out;
};

Layouts.isLocked = function(vp) {
    return (vp.getStatus() & Layouts.LOCK_BIT) !== 0;
};

/** Locks / unlocks a viewport (undoable). Locked: scale and contents cannot change. */
Layouts.setLocked = function(di, vp, locked) {
    var status = vp.getStatus();
    vp.setStatus(locked ? (status | Layouts.LOCK_BIT) : (status & ~Layouts.LOCK_BIT));
    var op = new RModifyObjectOperation(vp);
    op.setText(locked ? qsTr("Lock viewport") : qsTr("Unlock viewport"));
    di.applyOperation(op);
};

/** True when the viewport is twisted (its contents are rotated on the sheet). */
Layouts.isTwisted = function(vp) {
    return Math.abs(vp.getRotation()) > 1e-9;
};

/** Model-space point shown at paper point (x, y) of an UNTWISTED viewport. */
Layouts.paperToModel = function(vp, x, y) {
    var c = vp.getCenter(), vc = vp.getViewCenter(), vt = vp.getViewTarget(), s = vp.getScale();
    return new RVector((x - c.x) / s + vc.x + vt.x, (y - c.y) / s + vc.y + vt.y);
};

/**
 * Like paperToModel, but for a viewport whose contents are TURNED (rotation):
 * the model point shown at paper (x, y), turning the viewport's contents about
 * its centre as the engine does. paperToModel ignores the turn (the click-through
 * edit view shows a turned viewport untwisted and relies on that).
 */
Layouts.paperToModelTurned = function(vp, x, y) {
    var c = vp.getCenter(), vc = vp.getViewCenter(), vt = vp.getViewTarget(), s = vp.getScale();
    var a = -vp.getRotation(), ca = Math.cos(a), sa = Math.sin(a);
    var dx = (x - c.x) / s, dy = (y - c.y) / s;
    return new RVector(dx * ca - dy * sa + vc.x + vt.x, dx * sa + dy * ca + vc.y + vt.y);
};

/** The viewport of the layout under paper point (x, y), the topmost first, or undefined. */
Layouts.viewportAt = function(doc, info, x, y) {
    var all = Layouts.viewports(doc, info);
    for (var i = all.length - 1; i >= 0; i--) {
        var vp = all[i];
        if (vp.isOff()) {
            continue;
        }
        if (Layouts.shapeContains(vp, x, y)) {
            return vp;
        }
    }
    return undefined;
};


// ---------------------------------------------------------------------------
// Viewport scale
//
// A viewport's scale is stored the way the engine needs it -- paper units per
// model unit -- and SPOKEN the way a cave map is: feet of cave per inch of
// paper ("1\" = 40 ft"), or a ratio for metric work. The list below is the
// standard set; a person's own scales are added to it (and kept between runs)
// with Layouts.addCustomScale.
// ---------------------------------------------------------------------------

/** Standard scales, feet of cave per inch of paper. Metric ratios 1:N are N/12 ft per inch. */
Layouts.STANDARD_SCALES = [
    { label: "1\" = 10 ft", feetPerInch: 10 }, { label: "1\" = 20 ft", feetPerInch: 20 },
    { label: "1\" = 25 ft", feetPerInch: 25 }, { label: "1\" = 30 ft", feetPerInch: 30 },
    { label: "1\" = 40 ft", feetPerInch: 40 }, { label: "1\" = 50 ft", feetPerInch: 50 },
    { label: "1\" = 60 ft", feetPerInch: 60 }, { label: "1\" = 80 ft", feetPerInch: 80 },
    { label: "1\" = 100 ft", feetPerInch: 100 }, { label: "1\" = 150 ft", feetPerInch: 150 },
    { label: "1\" = 200 ft", feetPerInch: 200 }, { label: "1\" = 300 ft", feetPerInch: 300 },
    { label: "1\" = 400 ft", feetPerInch: 400 }, { label: "1\" = 500 ft", feetPerInch: 500 },
    { label: "1:100", feetPerInch: 100 / 12 }, { label: "1:200", feetPerInch: 200 / 12 },
    { label: "1:250", feetPerInch: 250 / 12 }, { label: "1:500", feetPerInch: 500 / 12 },
    { label: "1:1000", feetPerInch: 1000 / 12 }, { label: "1:2000", feetPerInch: 2000 / 12 }
];

Layouts.CUSTOM_SCALES_KEY = "Layouts/CustomScales";

/** The person's own scales (feet per inch), ascending. */
Layouts.customScales = function() {
    var text = "";
    try {
        text = String(RSettings.getStringValue(Layouts.CUSTOM_SCALES_KEY, ""));
    } catch (e) {
        text = "";
    }
    var out = [];
    var parts = text.split(",");
    for (var i = 0; i < parts.length; i++) {
        var v = parseFloat(parts[i]);
        if (isFinite(v) && v > 0) {
            out.push(v);
        }
    }
    out.sort(function(a, b) { return a - b; });
    return out;
};

Layouts.sameScale = function(a, b) {
    return Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b));
};

/** Label of a scale: the standard one's own, else "1\" = N ft (custom)". */
Layouts.scaleLabel = function(feetPerInch) {
    for (var i = 0; i < Layouts.STANDARD_SCALES.length; i++) {
        if (Layouts.sameScale(Layouts.STANDARD_SCALES[i].feetPerInch, feetPerInch)) {
            return Layouts.STANDARD_SCALES[i].label;
        }
    }
    return "1\" = " + (Math.round(feetPerInch * 1000) / 1000) + " ft";
};

/** Standard + custom scales, ascending: [{label, feetPerInch, custom}]. */
Layouts.scales = function() {
    var list = [];
    var i;
    for (i = 0; i < Layouts.STANDARD_SCALES.length; i++) {
        list.push({ label: Layouts.STANDARD_SCALES[i].label,
            feetPerInch: Layouts.STANDARD_SCALES[i].feetPerInch, custom: false });
    }
    var mine = Layouts.customScales();
    for (i = 0; i < mine.length; i++) {
        var present = false;
        for (var k = 0; k < list.length; k++) {
            if (Layouts.sameScale(list[k].feetPerInch, mine[i])) {
                present = true;
            }
        }
        if (!present) {
            list.push({ label: Layouts.scaleLabel(mine[i]), feetPerInch: mine[i], custom: true });
        }
    }
    list.sort(function(a, b) { return a.feetPerInch - b.feetPerInch; });
    return list;
};

/** Adds a scale to the person's list (kept between runs). \return false when invalid or already listed. */
Layouts.addCustomScale = function(feetPerInch) {
    if (!isFinite(feetPerInch) || !(feetPerInch > 0)) {
        return false;
    }
    var all = Layouts.scales();
    for (var i = 0; i < all.length; i++) {
        if (Layouts.sameScale(all[i].feetPerInch, feetPerInch)) {
            return false;
        }
    }
    var mine = Layouts.customScales();
    mine.push(feetPerInch);
    RSettings.setValue(Layouts.CUSTOM_SCALES_KEY, mine.join(","));
    return true;
};

/** Removes one of the person's own scales (the standard ones stay). */
Layouts.removeCustomScale = function(feetPerInch) {
    var mine = Layouts.customScales();
    var keep = [];
    for (var i = 0; i < mine.length; i++) {
        if (!Layouts.sameScale(mine[i], feetPerInch)) {
            keep.push(mine[i]);
        }
    }
    RSettings.setValue(Layouts.CUSTOM_SCALES_KEY, keep.join(","));
    return keep.length !== mine.length;
};

/** Drawing units in one inch of paper / in one foot of ground. */
Layouts.paperInch = function(doc) {
    return RUnit.convert(1, RS.Inch, doc.getUnit());
};
Layouts.groundFoot = function(doc) {
    return RUnit.convert(1, RS.Foot, doc.getUnit());
};

/** Engine scale (paper units per model unit) for "1 inch of paper = feetPerInch feet of cave". */
Layouts.scaleFor = function(doc, feetPerInch) {
    return Layouts.paperInch(doc) / (feetPerInch * Layouts.groundFoot(doc));
};

/** A viewport's scale as feet of cave per inch of paper. */
Layouts.feetPerInch = function(doc, vp) {
    return (Layouts.paperInch(doc) / vp.getScale()) / Layouts.groundFoot(doc);
};

/**
 * Sets a viewport's scale about the point it is already showing (undoable).
 * \return false when the viewport is locked (nothing changes).
 */
Layouts.setViewportScale = function(di, vp, feetPerInch) {
    if (Layouts.isLocked(vp) || !isFinite(feetPerInch) || !(feetPerInch > 0)) {
        return false;
    }
    var doc = di.getDocument();
    vp.setScale(Layouts.scaleFor(doc, feetPerInch));
    var op = new RModifyObjectOperation(vp);
    op.setText(qsTr("Viewport scale"));
    di.applyOperation(op);
    return true;
};


// ---------------------------------------------------------------------------
// Viewport shape: polygon outline and cut-outs
//
// A viewport is a rectangle until it is given a SHAPE: an outline polygon and
// any number of pieces cut out of it. The shape is stored in the viewport's
// custom properties CaveCAD/Clip0, Clip1, ... (long text is cut in pieces: a
// file keeps strings only ~1000 characters) as
//     loop|loop|...        loop = x,y;x,y;...   paper units from the centre
// the first loop the outline, the others cut out of it. The engine clips and
// outlines to it (RViewportEntity::getClipShape). The viewport's centre,
// width and height stay the outline's bounding box, so everything that works
// with a rectangle (scale, lock, the rotation grip, snaps to the box) goes on
// working.
// ---------------------------------------------------------------------------

Layouts.CLIP_PIECE = 700;

/** The loops of a viewport's shape as absolute paper points: [[{x,y},...], ...] (outline first), or [] for a rectangle. */
Layouts.clipLoops = function(vp) {
    var text = "";
    for (var i = 0; i < 64; i++) {
        var piece = vp.getCustomProperty("CaveCAD", "Clip" + i, "");
        if (isNull(piece) || String(piece) === "") {
            break;
        }
        text += String(piece);
    }
    var c = vp.getCenter(), out = [];
    var loops = text.split("|");
    for (var l = 0; l < loops.length; l++) {
        if (loops[l] === "") {
            continue;
        }
        var pts = [], parts = loops[l].split(";");
        for (var k = 0; k < parts.length; k++) {
            var xy = parts[k].split(",");
            if (xy.length === 2) {
                pts.push({ x: c.x + parseFloat(xy[0]), y: c.y + parseFloat(xy[1]) });
            }
        }
        if (pts.length >= 3) {
            out.push(pts);
        }
    }
    return out;
};

Layouts.hasClip = function(vp) {
    return Layouts.clipLoops(vp).length > 0;
};

/** Writes loops (absolute paper points, outline first) into the entity; no operation applied. */
Layouts._writeClip = function(vp, loops) {
    for (var i = 0; i < 64; i++) {
        var old = vp.getCustomProperty("CaveCAD", "Clip" + i, "");
        if (isNull(old) || String(old) === "") {
            break;
        }
        vp.removeCustomProperty("CaveCAD", "Clip" + i);
    }
    if (loops.length === 0) {
        return;
    }
    // the outline's bounding box becomes the viewport's box; contents stay where they are on the paper
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (var p = 0; p < loops[0].length; p++) {
        x1 = Math.min(x1, loops[0][p].x); x2 = Math.max(x2, loops[0][p].x);
        y1 = Math.min(y1, loops[0][p].y); y2 = Math.max(y2, loops[0][p].y);
    }
    var nc = new RVector((x1 + x2) / 2, (y1 + y2) / 2);
    // the model point now at the new centre stays there: what the map shows at any place on the
    // paper does not move when the outline changes (rotation included)
    var keep = Layouts.paperToModelTurned(vp, nc.x, nc.y);
    vp.setViewCenter(new RVector(keep.x - vp.getViewTarget().x, keep.y - vp.getViewTarget().y));
    vp.setCenter(nc);
    vp.setWidth(x2 - x1);
    vp.setHeight(y2 - y1);
    var text = [];
    for (var l = 0; l < loops.length; l++) {
        var pts = [];
        for (var k = 0; k < loops[l].length; k++) {
            pts.push((loops[l][k].x - nc.x) + "," + (loops[l][k].y - nc.y));
        }
        text.push(pts.join(";"));
    }
    var all = text.join("|");
    for (var n = 0; n * Layouts.CLIP_PIECE < all.length; n++) {
        vp.setCustomProperty("CaveCAD", "Clip" + n, all.substr(n * Layouts.CLIP_PIECE, Layouts.CLIP_PIECE));
    }
};

/** Gives the viewport a shape (undoable). `loops`: absolute paper points, outline first; [] restores the rectangle. */
Layouts.setClip = function(di, vp, loops, text) {
    var doc = di.getDocument();
    var fresh = doc.queryEntity(vp.getId());
    if (isNull(fresh)) {
        return false;
    }
    if (loops.length > 0 && loops[0].length < 3) {
        return false;
    }
    if (loops.length === 0) {
        // back to the rectangle that bounds the shape now
        Layouts._writeClip(fresh, []);
    }
    else {
        Layouts._writeClip(fresh, loops);
    }
    var op = new RModifyObjectOperation(fresh);
    op.setText(isNull(text) ? qsTr("Viewport shape") : text);
    di.applyOperation(op);
    return true;
};

/** Cuts a polygon (absolute paper points) out of the viewport's shape (undoable). */
Layouts.cutOut = function(di, vp, loop) {
    if (loop.length < 3) {
        return false;
    }
    var loops = Layouts.clipLoops(vp);
    if (loops.length === 0) {
        var c = vp.getCenter(), hw = vp.getWidth() / 2, hh = vp.getHeight() / 2;
        loops = [[{ x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh }]];
    }
    loops.push(loop);
    return Layouts.setClip(di, vp, loops, qsTr("Trim viewport"));
};

/** True when paper point (x, y) is inside the viewport's shape. */
Layouts.shapeContains = function(vp, x, y) {
    var loops = Layouts.clipLoops(vp);
    if (loops.length === 0) {
        var c = vp.getCenter();
        return Math.abs(x - c.x) <= vp.getWidth() / 2 && Math.abs(y - c.y) <= vp.getHeight() / 2;
    }
    var inside = function(pts) {
        var hit = false;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            if (((pts[i].y > y) !== (pts[j].y > y)) &&
                (x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) {
                hit = !hit;
            }
        }
        return hit;
    };
    if (!inside(loops[0])) {
        return false;
    }
    for (var l = 1; l < loops.length; l++) {
        if (inside(loops[l])) {
            return false;
        }
    }
    return true;
};


// ---------------------------------------------------------------------------
// Print settings on the layout's block
//
// Print.js reads the page settings of a LAYOUT block from the block's own
// custom properties (title "QCAD", the same keys as the document variables,
// see Print.getValue) and falls back on the document's. So File > Print and
// Print Preview on a layout tab are WYSIWYG once the block carries its
// sheet's paper: millimetre paper, 1:1 (paper coordinates are drawing units,
// see the header), no offset, one page, no margins of its own.
// ---------------------------------------------------------------------------

/** The Print.js keys and values for a layout. */
Layouts.printSettings = function(info) {
    var shorter = Math.min(info.paperMM.w, info.paperMM.h);
    var longer = Math.max(info.paperMM.w, info.paperMM.h);
    var s = {};
    s["UnitSettings/PaperUnit"] = RS.Millimeter;
    s["PageSettings/PaperWidth"] = shorter;
    s["PageSettings/PaperHeight"] = longer;
    s["PageSettings/PageOrientation"] = info.paperMM.w >= info.paperMM.h ? "Landscape" : "Portrait";
    s["PageSettings/Scale"] = "1:1";
    s["PageSettings/OffsetX"] = 0;
    s["PageSettings/OffsetY"] = 0;
    s["MultiPageSettings/Rows"] = 1;
    s["MultiPageSettings/Columns"] = 1;
    s["MultiPageSettings/GlueMarginsLeft"] = 0;
    s["MultiPageSettings/GlueMarginsTop"] = 0;
    s["MultiPageSettings/GlueMarginsRight"] = 0;
    s["MultiPageSettings/GlueMarginsBottom"] = 0;
    s["MultiPageSettings/PrintCropMarks"] = false;
    s["PageTagSettings/EnablePageTags"] = false;
    s["ColorSettings/ColorMode"] = "FullColor";
    return s;
};

/** Writes a layout's print settings onto its block (one undoable step with whatever called it). */
Layouts.applyPrintSettings = function(di, name, group) {
    var doc = di.getDocument();
    var info = Layouts.get(doc, name);
    if (isNull(info)) {
        return false;
    }
    var block = doc.queryBlock(info.blockId);
    var settings = Layouts.printSettings(info);
    for (var key in settings) {
        if (settings.hasOwnProperty(key)) {
            block.setCustomProperty("QCAD", key, settings[key]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Layout print settings"));
    if (!isNull(group)) {
        op.setTransactionGroup(group);
    }
    op.addObject(block, false);
    di.applyOperation(op);
    return true;
};
