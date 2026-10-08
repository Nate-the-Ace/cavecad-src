// CsTitleBlock.js -- the title block as ONE block with a FIELD (block attribute) for each line.
//
// Part of the Cave Survey Core library. rows(), fieldText() and syncLines() are pure and unit-tested; the rest
// talks to the engine and falls back, on any failure, to the old loose text lines (CsLayoutGen.drawTitle), so a
// sheet can always be built.
//
// WHY A BLOCK. One object to select, move, copy to another sheet, or reuse. A block's definition holds the fixed
// parts (a wrapped field's continuation lines, the heading: "PLAN"); each field is an ATTRIBUTE on the block
// reference: ordinary text you double-click to edit, in the layout, tagged TBField=<field id> exactly like the old
// loose lines -- so Survey Stats, Check Map, the sheet checker and the layout templates read it unchanged.
//
// LINKED FIELDS (CsSheetLink). The fields the notebook knows (cave name, surveyed by, dates, length, depth, survey
// code) carry TBLink=auto and TBAuto=<the line last written>: sync() rewrites them when the notebook's value
// changes, and the moment a person edits one it becomes manual and is never overwritten again. The Sheet line is
// the layout's name (its Layout tab). Location is never linked.
//
// One block definition per sheet job (TITLE-BLOCK-<job id>), so a sheet drawn again redefines it in place.

var CsTitleBlock = {};

CsTitleBlock.PREFIX = "TITLE-BLOCK-";
CsTitleBlock.SETTING = "CaveSurvey/TitleBlockAsBlock";
CsTitleBlock.TAG_REF = "TitleBlockOf";

/** Whether new title blocks are made as blocks (default yes; switch off to get loose text lines). */
CsTitleBlock.enabled = function() {
    try {
        return RSettings.getBoolValue(CsTitleBlock.SETTING, true);
    }
    catch (e) {
        return true;
    }
};

CsTitleBlock.blockName = function(jobId) {
    return CsTitleBlock.PREFIX + String(jobId).replace(/[<>\/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
};

/**
 * Where each line goes, in INCHES below the block's insertion point (the first line). Pure.
 *
 * \param lines    CsSheetSetup.titleLines output: [{ text, inches, fieldId }]
 * \param spacing  the line spacing factor (CsSheetSetup.LINE_SPACING)
 * \return { rows: [{ y, inches, text, fieldId, field: true|false }], headingY, height }
 *         `field` is true for a line that carries a field id (it becomes an attribute); the rest are fixed text.
 */
CsTitleBlock.rows = function(lines, spacing) {
    var rows = [], y = 0;
    for (var i = 0; i < lines.length; i++) {
        rows.push({ y: y, inches: lines[i].inches, text: lines[i].text, fieldId: lines[i].fieldId,
            field: lines[i].fieldId !== "" });
        y -= lines[i].inches * spacing;
    }
    return { rows: rows, headingY: y, height: -y };
};

/** The words of a field's line as they are printed: the prefix and the value, in the sheet's capitals. */
CsTitleBlock.fieldText = function(field, value, caps) {
    var up = isNull(caps) ? function(t) { return String(t).toUpperCase(); } : caps;
    return up((isNull(field.prefix) ? "" : field.prefix) + String(value));
};

/**
 * The linked-field sync, PURE: for each attribute `items[i]` = { id, text, link, lastAuto, wrapped } and the
 * notebook's `filled` ({ field id: value }), says what to do. `fields` is CsSheet.FIELDS, `caps` the lettering.
 *
 * \return [{ index, action, text }] for the items that need something (action "set" | "mark" | "manual")
 */
CsTitleBlock.syncLines = function(items, filled, fields, caps) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!CsSheetLink.isNotebookField(it.id) || it.wrapped === true) {
            continue;           // not a notebook field, or the value runs over several lines (left as it is)
        }
        var field = null;
        for (var f = 0; f < fields.length; f++) {
            if (fields[f].id === it.id) { field = fields[f]; }
        }
        var have = filled.hasOwnProperty(it.id) && String(filled[it.id]).replace(/\s/g, "") !== "";
        var now = (field !== null && have) ? CsTitleBlock.fieldText(field, filled[it.id], caps) : null;
        var d = CsSheetLink.decide({ text: it.text, link: it.link, lastAuto: it.lastAuto }, now);
        if (d.action !== "none") {
            out.push({ index: i, action: d.action, text: d.text });
        }
    }
    return out;
};

// =================================================================== the engine half

/** A block attribute definition at (xIn, yIn) inches, built the way env.text builds a text. */
CsTitleBlock.attributeDefinition = function(env, xIn, yIn, heightIn, text, tag, prompt) {
    var d = new RAttributeDefinitionData();
    var pos = new RVector(env.P(xIn), env.P(yIn));
    d.setPosition(pos);
    d.setAlignmentPoint(pos);           // both: a position alone renders at the origin (it shipped once)
    d.setTextHeight(env.P(heightIn));
    d.setTextWidth(env.P(CsSheetSetup.TITLE_INCHES * 4));
    d.setVAlign(RS.VAlignMiddle);
    d.setHAlign(RS.HAlignLeft);
    d.setDrawingDirection(RS.LeftToRight);
    d.setLineSpacingStyle(RS.Exact);
    d.setLineSpacingFactor(1.0);
    d.setFontName("standard");
    d.setBold(false);
    d.setItalic(false);
    d.setAngle(0.0);
    d.setSimple(false);
    d.setText(text);
    d.setTag(tag);
    d.setPrompt(prompt);
    return new RAttributeDefinitionEntity(env.doc, d);
};

/**
 * Draws the title block as one block reference with an attribute per field. Same job as CsLayoutGen.drawTitle and
 * the same return (the y it ended at). Throws on any engine failure; CsLayoutGen.drawTitleBlock catches that and
 * draws loose lines instead.
 *
 * \param opts { jobId, filled, generated } (filled = the notebook's values, to know which fields are linked;
 *        generated false = placed by a person, so the generator never rewrites it)
 */
CsTitleBlock.draw = function(env, titleX, y, lines, values, kind, opts) {
    var doc = env.doc, di = env.di, v = isNull(values) ? {} : values;
    var o = isNull(opts) ? {} : opts;
    var layout = CsTitleBlock.rows(lines, CsSheetSetup.LINE_SPACING);
    var name = CsTitleBlock.blockName(isNull(o.jobId) ? "sheet" : o.jobId);

    // ---- the definition: fixed text and one attribute definition per field line
    var defId = doc.getBlockId(name);
    if (defId === RBlock.INVALID_ID || defId === undefined || defId === null || defId < 0) {
        di.applyOperation(new RAddObjectOperation(new RBlock(doc, name, new RVector(0, 0)), false));
        defId = doc.getBlockId(name);
    }
    if (defId === RBlock.INVALID_ID || defId === undefined || defId === null || defId < 0) {
        throw new Error("title block definition could not be made");
    }
    var denv = CsLayoutGen.envFor(doc, di, defId, qsTr("Title block"), "");
    var old = doc.queryBlockEntities(defId);
    for (var d = 0; d < old.length; d++) {
        var oe = doc.queryEntity(old[d]);
        if (!isNull(oe)) { denv.op.deleteObject(oe); }
    }
    var defs = [];
    for (var r = 0; r < layout.rows.length; r++) {
        var row = layout.rows[r];
        if (row.field) {
            var fld = CsSheet.fieldById(row.fieldId);
            var ad = CsTitleBlock.attributeDefinition(denv, 0, row.y, row.inches, CsDraw.caps(row.text), row.fieldId,
                isNull(fld) ? row.fieldId : fld.label);
            denv.add(ad, CsLayers.TITLE_BLOCK, "");
            defs.push({ row: row, entity: ad });
        }
        else {
            denv.text(0, row.y, row.inches, row.text, CsLayers.TITLE_BLOCK);
        }
    }
    denv.text(0, layout.headingY, CsSheetSetup.TEXT.heading,
        kind === "elevation" ? "EXTENDED ELEVATION" : (kind === "section" ? "CROSS SECTION" : "PLAN"), CsLayers.TITLE_BLOCK);
    di.applyOperation(denv.op);

    // ---- the reference, and an attribute for each field
    var ref = new RBlockReferenceEntity(doc, new RBlockReferenceData(defId,
        new RVector(env.P(titleX), env.P(y)), new RVector(1, 1), 0.0));
    ref.setBlockId(env.blockId);
    ref.setLayerId(doc.getLayerId(CsLayers.TITLE_BLOCK));
    // a title block the GENERATOR makes is rewritten with the sheet; one a person placed (opts.generated false) is theirs
    var gen = o.generated !== false;
    if (gen) {
        CsTags.set(ref, CsLayoutGen.TAG, "titleblock");
    }
    CsTags.set(ref, CsTitleBlock.TAG_REF, name);
    // the reference and its attributes go in ONE operation of their own, applied only when all of it was made:
    // if anything above threw, nothing of the reference exists and the caller draws loose lines instead
    var op = new RAddObjectsOperation();
    op.setText(qsTr("Title block"));
    op.addObject(ref, false);
    var refId = doc.getStorage().getMaxObjectId();
    var filled = isNull(o.filled) ? {} : o.filled;
    for (var k = 0; k < defs.length; k++) {
        var df = defs[k], id = df.row.fieldId;
        var text = CsDraw.caps(df.row.text);
        var att = new RAttributeEntity(doc, new RAttributeData(df.entity.getData(), refId, id));
        att.setBlockId(env.blockId);
        att.setLayerId(doc.getLayerId(CsLayers.TITLE_BLOCK));
        ref.applyTransformationTo(att);
        att.setText(text);
        if (gen) {
            CsTags.set(att, CsLayoutGen.TAG, "title");
        }
        CsTags.set(att, CsSheet.TAG, id);
        CsTags.set(att, CsSheetSetup.TAG_FULL, isNull(v[id]) ? "" : String(v[id]));
        // linked only when the value is KNOWN to be the notebook's own (never a guess over what a person typed)
        var fieldDef = CsSheet.fieldById(id);
        if (id === CsSheetLink.SHEET_FIELD) {
            CsTags.set(att, CsSheetLink.TAG_LINK, "layout");
        }
        else if (CsSheetLink.isNotebookField(id) && filled.hasOwnProperty(id) && !isNull(fieldDef) &&
                text === CsTitleBlock.fieldText(fieldDef, filled[id], CsDraw.caps)) {
            CsTags.set(att, CsSheetLink.TAG_LINK, CsSheetLink.AUTO);
            CsTags.set(att, CsSheetLink.TAG_AUTO, text);
        }
        else if (CsSheetLink.isNotebookField(id)) {
            CsTags.set(att, CsSheetLink.TAG_LINK, CsSheetLink.MANUAL);
        }
        op.addObject(att, false);
    }
    di.applyOperation(op);
    return y - layout.height;
};

/** Removes title block definitions nothing refers to any more (a sheet drawn under a new job id). Never fails the caller. */
CsTitleBlock.purgeUnused = function(doc, di) {
    var removed = 0;
    try {
        var ids = doc.queryAllBlocks();
        var op = new RDeleteObjectsOperation();
        op.setText(qsTr("Remove unused title block definitions"));
        for (var i = 0; i < ids.length; i++) {
            var block = doc.queryBlock(ids[i]);
            if (isNull(block) || String(block.getName()).indexOf(CsTitleBlock.PREFIX) !== 0) {
                continue;
            }
            if (doc.queryBlockReferences(ids[i]).length === 0) {
                op.deleteObject(block);
                removed++;
            }
        }
        if (removed > 0) {
            di.applyOperation(op);
        }
    }
    catch (e) {
        return 0;
    }
    return removed;
};

/**
 * Every linked title block field in the drawing, as the items syncLines wants:
 * [{ entity, id, text, link, lastAuto, wrapped }] (text entities and attributes alike: anything tagged TBField).
 */
CsTitleBlock.linkedFields = function(doc) {
    var out = [];
    var layouts = Layouts.list(doc);
    for (var l = 0; l < layouts.length; l++) {
        var ids = doc.queryBlockEntities(layouts[l].blockId);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.isUndone() || !CsSheet.isText(e)) { continue; }
            var id = CsTags.get(e, CsSheet.TAG);
            if (id === "" || CsTags.get(e, CsSheetLink.TAG_LINK) === "") { continue; }
            out.push({ entity: e, id: id, text: CsSheet.textOf(e), link: CsTags.get(e, CsSheetLink.TAG_LINK),
                lastAuto: CsTags.get(e, CsSheetLink.TAG_AUTO),
                wrapped: false });   // a value that runs over several lines is never linked (see draw)
        }
    }
    return out;
};

/**
 * Brings every linked field up to the notebook: `filled` is { field id: value } (CsSheetSetup.autoFill via
 * SheetSetup.readState). Writes only what changed; one undo step.
 *
 * \return { set, manual } how many fields were rewritten and how many turned out to have been edited by hand
 */
CsTitleBlock.sync = function(doc, di, filled, quiet) {
    var items = CsTitleBlock.linkedFields(doc);
    var todo = CsTitleBlock.syncLines(items, filled, CsSheet.FIELDS, CsDraw.caps);
    // the sheets that are automatic now stay automatic: the link writing the notebook's words is not a hand edit
    var wasAuto = {};
    var layouts = Layouts.list(doc);
    for (var la = 0; la < layouts.length; la++) {
        wasAuto[layouts[la].blockId] = (CsLayoutGen.state(doc, layouts[la]) === "auto");
    }
    var op = new RModifyObjectsOperation(quiet !== true);
    op.setText(qsTr("Title block follows the notebook"));
    var set = 0, manual = 0;
    for (var i = 0; i < todo.length; i++) {
        var item = items[todo[i].index], e = doc.queryEntity(item.entity.getId());
        if (isNull(e)) { continue; }
        if (todo[i].action === "set") {
            e.setText(todo[i].text);
            CsTags.set(e, CsSheetLink.TAG_AUTO, todo[i].text);
            set++;
        }
        else if (todo[i].action === "mark") {
            CsTags.set(e, CsSheetLink.TAG_AUTO, todo[i].text);
        }
        else {
            CsTags.set(e, CsSheetLink.TAG_LINK, CsSheetLink.MANUAL);
            manual++;
        }
        op.addObject(e, false);
    }
    if (todo.length > 0) {
        di.applyOperation(op);
        if (set > 0) {
            for (var lb = 0; lb < layouts.length; lb++) {
                if (wasAuto[layouts[lb].blockId] === true) {
                    CsLayoutGen.restamp(doc, di, layouts[lb].name, quiet);
                }
            }
        }
    }
    return { set: set, manual: manual };
};

/** Sets the given field entities back to following the notebook (the next sync rewrites them). */
CsTitleBlock.relink = function(doc, di, entities) {
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Link title block field to the notebook"));
    var n = 0;
    for (var i = 0; i < entities.length; i++) {
        var e = doc.queryEntity(entities[i].getId());
        if (isNull(e) || !CsSheetLink.isNotebookField(CsTags.get(e, CsSheet.TAG))) { continue; }
        CsTags.set(e, CsSheetLink.TAG_LINK, CsSheetLink.AUTO);
        CsTags.remove(e, CsSheetLink.TAG_AUTO);
        op.addObject(e, false);
        n++;
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/**
 * Turns a LOOSE-text title block already on a layout (one an older build drew, or a sheet that has not been rebuilt since)
 * into the block with fields, in place: the same words, the same top-left corner, linked fields linked only where the
 * notebook agrees with what is printed. One undo step. Only title lines the generator or the field tags can identify are
 * taken (a wrapped field's continuation lines are the generator's: tag LayoutGen=TITLE-BLOCK).
 *
 * \param filled  the notebook's values ({ field id: value }) so the right fields can be linked; {} links none
 * \return { ok, why, fields }
 */
CsTitleBlock.convert = function(doc, di, info, filled) {
    var ids = doc.queryBlockEntities(info.blockId);
    var loose = [], hasBlock = false;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) { continue; }
        if (e.getType() === RS.EntityBlockRef && CsTags.get(e, CsTitleBlock.TAG_REF) !== "") { hasBlock = true; }
        if (!CsSheet.isText(e) || e.getType() === RS.EntityAttribute) { continue; }
        var tagged = CsTags.get(e, CsSheet.TAG) !== "";
        var generated = CsTags.get(e, CsLayoutGen.TAG) === "TITLE-BLOCK" && CsBind.layerNameOf(doc, e) === CsLayers.TITLE_BLOCK;
        if (tagged || generated) { loose.push(e); }
    }
    if (hasBlock) {
        return { ok: false, why: qsTr("This sheet's title block is already a block."), fields: 0 };
    }
    if (loose.length === 0) {
        return { ok: false, why: qsTr("There is no loose-text title block on this sheet to convert."), fields: 0 };
    }
    // top to bottom; the heading ("PLAN"...) is the generator's last line
    loose.sort(function(a, b) { return b.getPosition().y - a.getPosition().y; });
    var x = Infinity, kind = "plan", values = {}, lines = [], dropped = [];
    for (var k = 0; k < loose.length; k++) {
        var t = loose[k], id = CsTags.get(t, CsSheet.TAG), text = CsSheet.textOf(t);
        x = Math.min(x, t.getPosition().x);
        if (id === "" && (text === "PLAN" || text === "EXTENDED ELEVATION" || text === "CROSS SECTION")) {
            kind = text === "PLAN" ? "plan" : (text === "CROSS SECTION" ? "section" : "elevation");
            dropped.push(t);
            continue;
        }
        var inches = t.getTextHeight() / Layouts.toPaper(doc, 25.4);
        if (id !== "") {
            var whole = CsTags.get(t, CsSheetSetup.TAG_FULL);
            values[id] = whole !== "" ? whole : CsSheetLink.nameFromLine(text);
        }
        lines.push({ text: text, inches: inches, fieldId: id });
        dropped.push(t);
    }
    values.sheetNumber = info.name;
    var hasSheet = false;
    for (var n = 0; n < lines.length; n++) { if (lines[n].fieldId === CsSheetLink.SHEET_FIELD) { hasSheet = true; } }
    if (!hasSheet) {
        // the older block had no Sheet line: add it first, as a new build would
        lines.unshift({ text: CsSheetLink.lineFor(info.name), inches: CsSheetSetup.TEXT.body, fieldId: CsSheetLink.SHEET_FIELD });
    }
    var inch = Layouts.toPaper(doc, 25.4);
    var topY = loose[0].getPosition().y / inch;
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var del = new RDeleteObjectsOperation();
    del.setText(qsTr("Make title block a block"));
    del.setTransactionGroup(group);
    for (var d = 0; d < dropped.length; d++) { del.deleteObject(dropped[d]); }
    di.applyOperation(del);
    var env = CsLayoutGen.envFor(doc, di, info.blockId, qsTr("Make title block a block"), "");
    env.op.setTransactionGroup(group);
    CsTitleBlock.draw(env, x / inch, topY, lines, values, kind,
        { jobId: "converted-" + info.name + "-" + String(new Date().getTime()), filled: isNull(filled) ? {} : filled, generated: true });
    di.applyOperation(env.op);
    return { ok: true, why: "", fields: lines.length };
};
