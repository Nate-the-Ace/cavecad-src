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
 * layout's paper unit (inches or millimetres -- RLayout plot paper units
 * 0 / 1), independent of the drawing unit, so a cave drawn in feet at
 * 1 in = 50 ft has a viewport scale of 1/50 and a sheet of 11 x 8.5
 * coordinates. Rendering is unit-blind; only plotting and scale text care.
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

/** Millimetres per paper-space coordinate unit of an info. */
Layouts.unitFactor = function(info) {
    return info.units === Layouts.INCHES ? 25.4 : 1.0;
};

/** Paper size in PAPER-SPACE COORDINATES: { w, h }. */
Layouts.paperSize = function(info) {
    var f = Layouts.unitFactor(info);
    return { w: info.paperMM.w / f, h: info.paperMM.h / f };
};

/** Margins in paper-space coordinates: { l, b, r, t }. */
Layouts.margins = function(info) {
    var f = Layouts.unitFactor(info);
    return { l: info.marginsMM.l / f, b: info.marginsMM.b / f,
             r: info.marginsMM.r / f, t: info.marginsMM.t / f };
};

/**
 * Printable frame in paper coordinates: { x1, y1, x2, y2 } (paper origin at
 * the lower left corner of the sheet).
 */
Layouts.printableBox = function(info) {
    var s = Layouts.paperSize(info), m = Layouts.margins(info);
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
 *   units      Layouts.INCHES | Layouts.MILLIMETERS (default INCHES for ANSI/Letter/Arch papers, else mm)
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
 * Paper-space entities are NOT rescaled when the unit changes: that is the
 * caller's decision (a generator rebuilds; a person rarely changes units).
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
