// tools/migrate_titleblock.js
//
// ONE-SHOT TEMPLATE MIGRATION: turns the title block's TB_* field
// blocks into ordinary, editable text.
//
// The old templates carried each title block line inside a one-off
// block definition, so editing "Cave name" meant editing a block --
// which is why a dedicated Title Block tool existed. This rewrites
// each field insert as a plain text entity at the same place, on the
// same layer, at the same height, tagged CaveSurvey/TBField with the
// field id so Survey Stats can still stamp length, depth and grade.
// Then the insert and the now-unused block definition are deleted.
//
// GRAPHIC blocks are left alone: the border, the bar scales and the
// north arrow are drawings, not text boxes.
//
// Run once per template; re-running is a no-op (nothing left to find).
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/migrate_titleblock.js <template.dxf> [...]

// Some -autostart engines don't preload library.js.
if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isBlockReferenceEntity === "undefined") {
    isBlockReferenceEntity = function(e) {
        return !isNull(e) && typeof e.getReferencedBlockId === "function";
    };
}
if (typeof isTextEntity === "undefined") {
    isTextEntity = function(e) {
        return !isNull(e) && typeof e.getPlainText === "function";
    };
}
if (typeof isTextBasedEntity === "undefined") {
    isTextBasedEntity = isTextEntity;
}

// Block name -> field id. Exactly the text fields; every other TB_*
// block (border, bar scales, north arrow) stays a block.
var FIELD_BLOCKS = {
    "TB_CAVE_NAME": "caveName",
    "TB_LOCATION": "location",
    "TB_SURVEYED_BY": "surveyedBy",
    "TB_CARTOGRAPHY_BY": "cartographyBy",
    "TB_DATE": "date",
    "TB_SURVEY_METHOD": "surveyMethod",
    "TB_LENGTH": "length",
    "TB_DEPTH": "depth",
    "TB_PERSONNEL": "personnel",
    "TB_SURVEY_CODE": "surveyCode",
    "TB_COPYRIGHT": "copyright",
    "TB_LEGEND_NOTE": "legendNote"
};

function migrate(path) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    if (di.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        print("FAIL  cannot read " + path);
        return false;
    }

    var op = new RAddObjectsOperation();
    var converted = 0;
    var missing = [];

    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var ref = doc.queryEntity(ids[i]);
        if (isNull(ref) || !isBlockReferenceEntity(ref)) {
            continue;
        }
        var blockName = "" + doc.getBlockName(ref.getReferencedBlockId());
        var fieldId = FIELD_BLOCKS[blockName];
        if (isNull(fieldId)) {
            continue;
        }

        // The block holds exactly one text entity, at the block
        // origin; the insert supplies the real position.
        var block = doc.queryBlock(blockName);
        var inner = doc.queryBlockEntities(block.getId());
        var src = null;
        for (var j = 0; j < inner.length; j++) {
            var e = doc.queryEntity(inner[j]);
            if (!isNull(e) && (isTextEntity(e) || isTextBasedEntity(e))) {
                src = e;
                break;
            }
        }
        if (src === null) {
            missing.push(blockName);
            continue;
        }

        var at = ref.getPosition();
        var scale = ref.getScaleFactors().x;
        var text = new RTextEntity(doc, new RTextData(
            new RVector(at.x + src.getPosition().x * scale,
                        at.y + src.getPosition().y * scale),
            new RVector(at.x + src.getPosition().x * scale,
                        at.y + src.getPosition().y * scale),
            src.getTextHeight() * scale,
            0.0,                                   // no width limit: one line
            src.getVAlign(), src.getHAlign(),
            RS.LeftToRight, RS.Exact,
            1.0,                                   // line spacing
            "" + src.getPlainText(),
            "" + src.getFontName(),
            false, false,                          // bold, italic
            src.getAngle() + ref.getRotation(),
            false));                               // not simple text
        text.setLayerId(doc.getLayerId("TITLE-BLOCK"));
        CsTags.set(text, CsSheet.TAG, fieldId);
        op.addObject(text, false);
        op.deleteObject(ref);
        converted++;
    }

    if (converted === 0) {
        print("skip  " + path + " -- no TB_* field inserts left");
        return true;
    }

    di.applyOperation(op);

    // The definitions are unreferenced now; drop them so the field
    // text cannot be resurrected as a block by a later paste.
    var drop = new RDeleteObjectsOperation();
    var dropped = 0;
    for (var name in FIELD_BLOCKS) {
        if (!FIELD_BLOCKS.hasOwnProperty(name)) { continue; }
        var b = doc.queryBlock(name);
        if (!isNull(b)) {
            drop.deleteObject(b);
            dropped++;
        }
    }
    if (dropped > 0) {
        di.applyOperation(drop);
    }

    if (di.exportFile(path, "DXF 2013") !== true) {
        print("FAIL  cannot write " + path);
        return false;
    }
    print("ok    " + path + " -- " + converted + " fields converted, " +
          dropped + " block definitions removed" +
          (missing.length > 0 ? " (no text in: " + missing.join(",") + ")" : ""));
    return true;
}

var args = RSettings.getOriginalArguments();
var addon = "";
var files = [];
for (var a = 0; a < args.length; a++) {
    var v = "" + args[a];
    if (v.indexOf(".dxf") > 0) {
        files.push(v);
    } else if (new QFileInfo(v + "/scripts/CaveSurvey/Core/CsAll.js").exists()) {
        addon = v + "/scripts/CaveSurvey/Core";
    }
}
if (addon === "") {
    print("### MIGRATE FAIL -- pass the repo root so Core can be loaded");
} else {
    includeBasePath = addon;
    include(addon + "/CsTags.js");
    include(addon + "/CsSheet.js");
    var allOk = files.length > 0;
    for (var f = 0; f < files.length; f++) {
        if (!migrate(files[f])) { allOk = false; }
    }
    print(allOk ? "### MIGRATE OK" : "### MIGRATE FAIL");
}
