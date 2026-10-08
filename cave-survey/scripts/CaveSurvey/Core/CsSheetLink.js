// CsSheetLink.js -- the title block's LINKED fields, and the sheet number that is the Layout tab's name.
//
// Part of the Cave Survey Core library. Everything here is PURE (no document, no GUI) and unit-tested; the
// parts that touch the drawing are in CsLayoutGen (names), CsTitleBlock (the block) and the listeners.
//
// SHEET NUMBER = LAYOUT NAME, BOTH WAYS. The title block's "Sheet:" field shows the name of the layout (the tab).
// Rename the tab and the field follows; edit the field and the tab is renamed. The pure half is here: the text
// of the line, reading a name back from a line, and finding which layout a generated sheet is.
//
// LINKED FIELDS. A few title block fields follow the notebook (cave name, surveyed by, dates, length, depth,
// survey code: CsSheetSetup.autoFill). Each carries a link state:
//   TBLink  "auto"    follows the notebook
//           "manual"  a person typed over it: never overwritten again until they ask to relink
//   TBAuto  the line the link last wrote. If the line's text is no longer this, a person has edited it, and the
//           field becomes manual on its own.
// The suite's rule stands: a value a person typed is never replaced by a guess or by nothing, and the Location
// field is never linked at all.

var CsSheetLink = {};

CsSheetLink.TAG_LINK = "TBLink";
CsSheetLink.TAG_AUTO = "TBAuto";
CsSheetLink.AUTO = "auto";
CsSheetLink.MANUAL = "manual";
CsSheetLink.SHEET_FIELD = "sheetNumber";
CsSheetLink.PREFIX = "Sheet:  ";

/** Field ids that follow the notebook. (Location is deliberately absent: a person types it.) */
CsSheetLink.NOTEBOOK_FIELDS = ["caveName", "surveyedBy", "date", "length", "depth", "surveyCode"];

CsSheetLink.isNotebookField = function(id) {
    return CsSheetLink.NOTEBOOK_FIELDS.indexOf(String(id)) >= 0;
};

CsSheetLink.caps = function(text) {
    return (typeof CsDraw !== "undefined" && typeof CsDraw.caps === "function") ? CsDraw.caps(text) : String(text).toUpperCase();
};

/** The sheet-number line for a layout name, as it is printed: "SHEET:  A1". */
CsSheetLink.lineFor = function(name) {
    return CsSheetLink.caps(CsSheetLink.PREFIX + String(name));
};

/** The layout name a sheet-number line asks for ("SHEET:  A1" -> "A1"; a bare "A1" works too). */
CsSheetLink.nameFromLine = function(text) {
    var s = String(isNull(text) ? "" : text).replace(/\s+/g, " ");
    s = s.replace(/^\s*sheet\s*:\s*/i, "");
    return s.replace(/^\s+|\s+$/g, "");
};

/** The corner label of a tiled sheet: "SHEET A1". */
CsSheetLink.cornerFor = function(name) {
    return "SHEET " + String(name);
};

/**
 * Which layout is the sheet a job made? `layouts` is [{ name, jobId }] (jobId "" when never generated).
 * By the job's id first (so a renamed tab is still that sheet); then, only for a layout that was never
 * generated, by name. A layout generated as another job is never taken by name.
 *
 * \return the matching candidate, or null
 */
CsSheetLink.pickSheet = function(layouts, jobId, jobName) {
    var byId = null, byName = null;
    for (var i = 0; i < layouts.length; i++) {
        var l = layouts[i];
        if (String(jobId) !== "" && l.jobId === String(jobId)) {
            if (l.name === jobName) {
                return l;                 // a duplicated sheet shares the id: the one still called by the job's name wins
            }
            if (byId === null) {
                byId = l;
            }
        }
        else if (byName === null && l.name === jobName && (l.jobId === "" || isNull(l.jobId))) {
            byName = l;
        }
    }
    return byId !== null ? byId : byName;
};

/**
 * What to do with a linked field's text when the notebook is read.
 *
 * \param state    { text, link: "auto" | "manual" | "", lastAuto: string | "" | undefined }
 * \param newLine  the full line the notebook now gives (prefix included), or null when it has no answer
 * \return { action: "none" | "set" | "mark" | "manual", text }
 *         set     rewrite the field to text (and record it as the last auto value)
 *         mark    the text is already right: only record it as the last auto value
 *         manual  a person edited it: switch the field to manual and leave the text alone
 */
CsSheetLink.decide = function(state, newLine) {
    if (state.link === CsSheetLink.MANUAL || state.link !== CsSheetLink.AUTO) {
        return { action: "none" };            // manual, or never linked (an older title block)
    }
    var last = isNull(state.lastAuto) ? "" : String(state.lastAuto);
    if (last !== "" && String(state.text) !== last) {
        return { action: "manual" };          // the text is not what the link wrote: somebody edited it
    }
    if (isNull(newLine)) {
        return { action: "none" };            // the notebook has no answer: never blank out what is there
    }
    if (String(newLine) === String(state.text)) {
        return last === String(newLine) ? { action: "none" } : { action: "mark", text: String(newLine) };
    }
    return { action: "set", text: String(newLine) };
};
