// CsSheet.js -- the map sheet's title block text.
//
// Part of the Cave Survey Core library. FIELDS is pure data; the
// readers and writers need a document.
//
// THE TITLE BLOCK IS PLAIN TEXT. Each field is one ordinary text
// entity on the TITLE-BLOCK layer, tagged CaveSurvey/TBField with the
// field id. Double-click to edit it, drag it anywhere, delete the
// ones this map doesn't use -- it is a text box, not a form. The tag
// is only there so Survey Stats can stamp computed length, depth and
// grade into the right lines without asking.
//
// A field that carries no tag is still a perfectly good title block
// line; it just won't be auto-filled.
//
// LEGACY DRAWINGS: builds before this one kept every field inside a
// one-off TB_* block definition, which is why editing one needed a
// dedicated tool. Those drawings still read and write correctly --
// every lookup tries the tagged text first and falls back to the
// block.

var CsSheet = {};

// The tag that marks a text entity as a title block field.
CsSheet.TAG = "TBField";

// The layer new title block text belongs on.
CsSheet.LAYER = "TITLE-BLOCK";

// id, block (legacy carrier), label, prefix printed ahead of the
// value, required, hint
CsSheet.FIELDS = [
    { id: "caveName", block: "TB_CAVE_NAME", label: "Cave name",
        prefix: "", required: true,
        hint: "Unabbreviated, most prominent text on the sheet." },
    { id: "location", block: "TB_LOCATION", label: "Geographic location",
        prefix: "Location:  ", required: true,
        hint: "State and county at minimum. Coordinates must name their system, units and datum." },
    { id: "surveyedBy", block: "TB_SURVEYED_BY", label: "Surveyed by",
        prefix: "Surveyed by:  ", required: true,
        hint: "Who held the instruments." },
    { id: "cartographyBy", block: "TB_CARTOGRAPHY_BY", label: "Cartography by",
        prefix: "Cartography by:  ", required: true,
        hint: "Who drew the map, with the year." },
    { id: "date", block: "TB_DATE", label: "Survey date(s)",
        prefix: "Date surveyed:  ", required: true,
        hint: "The date range of the fieldwork, not the drafting." },
    { id: "surveyMethod", block: "TB_SURVEY_METHOD", label: "Survey method",
        prefix: "Survey method:  ", required: false,
        hint: "Instruments used (e.g. Suunto and tape, DistoX) or the survey grade." },
    { id: "length", block: "TB_LENGTH", label: "Surveyed length",
        prefix: "Length:  ", required: false,
        hint: "Total surveyed length -- Survey Stats computes this." },
    { id: "depth", block: "TB_DEPTH", label: "Vertical extent",
        prefix: "Depth:  ", required: false,
        hint: "Total vertical range -- Survey Stats computes this." },
    { id: "personnel", block: "TB_PERSONNEL", label: "Personnel",
        prefix: "Personnel:  ", required: false,
        hint: "Full crew list, if different from Surveyed by." },
    { id: "surveyCode", block: "TB_SURVEY_CODE", label: "Survey grade",
        prefix: "Survey code:  ", required: false,
        hint: "e.g. UISv2 5-c. Survey Stats derives the defensible one." },
    { id: "copyright", block: "TB_COPYRIGHT", label: "Copyright",
        prefix: "©  ", required: false,
        hint: "If present, must carry a year." },
    { id: "legendNote", block: "TB_LEGEND_NOTE", label: "Legend note",
        prefix: "", required: false,
        hint: "Which symbol standard the map follows." }
];

CsSheet.fieldById = function(id) {
    for (var i = 0; i < CsSheet.FIELDS.length; i++) {
        if (CsSheet.FIELDS[i].id === id) {
            return CsSheet.FIELDS[i];
        }
    }
    return null;
};

// ---------------------------------------------------------------------
// Finding a field. Tagged text first, legacy TB_* block second.
// ---------------------------------------------------------------------

/**
 * Is this entity a text? library.js's isTextEntity is not loaded in
 * every context this Core runs in (the headless test engine and the
 * one-shot migration scripts have no library.js), so fall back to
 * duck-typing rather than throwing where the helper is absent.
 */
CsSheet.isText = function(entity) {
    if (isNull(entity)) {
        return false;
    }
    if (typeof isTextEntity === "function" &&
        typeof isTextBasedEntity === "function") {
        return isTextEntity(entity) || isTextBasedEntity(entity);
    }
    return typeof entity.getPlainText === "function";
};

/** Reads an entity's text however this bridge allows. */
CsSheet.textOf = function(entity) {
    if (typeof entity.getPlainText === "function") {
        return String(entity.getPlainText());
    }
    if (typeof entity.getText === "function") {
        return String(entity.getText());
    }
    return "";
};

/**
 * Every text entity in the drawing tagged as this field: [entity].
 * More than one is legal -- a map may print its cave name twice --
 * and all of them are kept in step by a write.
 */
CsSheet.taggedTexts = function(doc, field) {
    var out = [];
    if (isNull(field) || typeof CsTags === "undefined") {
        return out;
    }
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (!CsSheet.isText(e)) {
            continue;
        }
        if (CsTags.get(e, CsSheet.TAG) === field.id) {
            out.push(e);
        }
    }
    return out;
};

/** LEGACY: text entities inside a named block definition: [entity]. */
CsSheet.textEntitiesInBlock = function(doc, blockName) {
    var block = doc.queryBlock(blockName);
    if (isNull(block)) {
        return [];
    }
    var out = [];
    var ids = doc.queryBlockEntities(block.getId());
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsSheet.isText(e)) {
            out.push(e);
        }
    }
    return out;
};

/**
 * The entities carrying this field, whichever way the drawing holds
 * it. Tagged text wins; a drawing from an older template falls back
 * to its TB_* block.
 */
CsSheet.fieldEntities = function(doc, field) {
    var texts = CsSheet.taggedTexts(doc, field);
    if (texts.length > 0) {
        return texts;
    }
    return CsSheet.textEntitiesInBlock(doc, field.block);
};

// ---------------------------------------------------------------------
// Reading and writing.
// ---------------------------------------------------------------------

/** The current text of a field, "" when absent/empty. */
CsSheet.readField = function(doc, field) {
    var texts = CsSheet.fieldEntities(doc, field);
    var parts = [];
    for (var i = 0; i < texts.length; i++) {
        var t = CsSheet.textOf(texts[i]);
        if (t !== "") {
            parts.push(t);
        }
    }
    return parts.join(" ");
};

/**
 * Writes a field's value, keeping the printed label ahead of it and
 * capitalising the line, so a stamped length reads
 * "LENGTH:  1,234 FT" and not a bare number.
 *
 * Tagged text: every entity carrying the tag is set. Legacy block:
 * the LAST text entity in the block is replaced (earlier ones are
 * usually the printed label).
 *
 * Caller owns the transaction. Returns false when the drawing has
 * nowhere to put this field -- the line was deleted, which is a
 * legitimate choice and never an error.
 */
CsSheet.writeField = function(doc, op, field, value) {
    if (isNull(field)) {
        return false;
    }
    // lettering, like everything else drawn on the sheet (CsDraw.caps)
    var text = (isNull(field.prefix) ? "" : field.prefix) + value;
    text = (typeof CsDraw !== "undefined") ? CsDraw.caps(text) :
        String(text).toUpperCase();

    var tagged = CsSheet.taggedTexts(doc, field);
    if (tagged.length > 0) {
        for (var i = 0; i < tagged.length; i++) {
            tagged[i].setText(text);
            op.addObject(tagged[i], false);
        }
        return true;
    }

    var texts = CsSheet.textEntitiesInBlock(doc, field.block);
    if (texts.length === 0) {
        return false;
    }
    var target = texts[texts.length - 1];
    target.setText(text);
    op.addObject(target, false);
    return true;
};
