// CsReset.js -- emptying a cave drawing completely.
//
// Part of the Cave Survey Core library. Pure ES5: no R*/Q* anywhere in
// this file, so tests/js_unit.js runs every line of it under node. The
// document work -- the walk, the delete, the layer table -- lives in
// ResetDrawing/ResetDrawing.js.
//
// WHAT A RESET IS FOR. Teaching a class means handing out the same
// starting point over and over, and testing wants the same: the cave
// FOLDER as it is -- its scans, its photographs, its lidar captures,
// its PDFs all still on disk -- and the drawing blank, so a lesson runs
// from "import the survey" through placing the scans to a finished map.
//
// NOTHING IN THE DRAWING SURVIVES. Not the survey, not the traced
// linework, not the symbols or the notes or the sections, and not the
// placed images either: a sketch scan and the aerial basemap are put
// there by tools a student is there to learn, so leaving them behind
// would skip those lessons exactly as leaving the stations behind would
// skip the first one. The georeference goes with them; it is declared
// again with Set Cave Location, which is itself one of the steps.
//
// THREE THINGS OUTSIDE THE DRAWING GO WITH IT, because a drawing is not
// the whole of what a class carries forward: the Complete marks on this
// cave's scans, the last-declared location that Set Cave Location
// offers as its default, and the map thumbnail the shelf card shows.
// Each would otherwise hand the next student somebody else's progress.
// The shelf entry stays, so the cave is still one click away and trips
// can be added to it straight afterwards. ResetDrawing.clearOutside
// does that work and says why for each.
//
// THE FILES ARE NOT TOUCHED. This empties a DRAWING, never a folder --
// scans/, images/, lidar/, PDF/ and backup/ are left exactly as they
// are, which is what makes the cave re-drawable afterwards. Teaching
// Cave (CsTeach) is the tool that resets a folder, from a pristine
// master; this one never writes outside the drawing and its backup.
//
// WHY IT IS STILL NOT "JUST MAKE A NEW DRAWING". A new drawing is a new
// file somewhere else, and a cave project is a folder whose drawing has
// a name, a backup history, a shelf entry and a path that every scan is
// stored relative to. The reset keeps all of that and empties what is
// inside it.

var CsReset = {};

/**
 * Does this entity survive the reset?
 *
 * Nothing does. The function exists so that the rule is written down in
 * one place with its reason attached, rather than being the absence of
 * a filter in the middle of the walk -- and so that the walk and the
 * count cannot drift apart if that ever changes.
 */
CsReset.keepsEntity = function(info) {
    return false;
};

/**
 * Which counted kind a doomed entity falls in: "survey" for the control
 * skeleton the importer draws, "image" for a placed scan or the aerial,
 * "drawn" for everything a caver put on the map by hand.
 *
 * The split is the CTRL- prefix plus the entity kind, deliberately,
 * rather than a table of every layer family. A count is there to tell
 * somebody what they are about to lose in the terms they think in, and
 * a finer tally would drift out of step with the layer registry the
 * first time a layer was added.
 *
 * Images are counted apart because they are the ones somebody will
 * doubt: a caver who has just spent an evening fitting forty-seven
 * sketch scans deserves to see that number before agreeing, not a
 * total that hides it.
 */
CsReset.countKind = function(info) {
    if (info !== null && info !== undefined && info.isImage === true) {
        return "image";
    }
    var layer = (info === null || info === undefined ||
        info.layer === null || info.layer === undefined) ? "" :
        String(info.layer);
    return layer.indexOf("CTRL-") === 0 ? "survey" : "drawn";
};

/**
 * Totals a walked drawing.
 *
 * \param infos array of {isImage, layer}
 * \return {total, survey, drawn, images}
 */
CsReset.tally = function(infos) {
    var out = { total: 0, survey: 0, drawn: 0, images: 0 };
    if (Object.prototype.toString.call(infos) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < infos.length; i++) {
        if (CsReset.keepsEntity(infos[i])) {
            continue;
        }
        out.total++;
        var kind = CsReset.countKind(infos[i]);
        if (kind === "image") {
            out.images++;
        } else {
            out[kind]++;
        }
    }
    return out;
};

/**
 * What a reset will do, decided before anything is touched -- the same
 * shape CsTeach.planReset answers in, and for the same reason: a
 * refusal has to come back as words somebody can act on, never as a
 * throw.
 *
 * \param state {hasDocument, docPath, inCaveFolder, isSheet, caveName,
 *               counts}
 * \return {can, reason, warning}
 */
CsReset.planReset = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    if (s.hasDocument !== true) {
        return { can: false, reason: "There is no drawing open to reset." };
    }
    if (s.isSheet === true) {
        return { can: false, reason: "That is a sheet, not a drawing to " +
            "work in -- it is rebuilt from the cave's record every time " +
            "Build Sheet is pressed. Reset the cave's drawing instead." };
    }
    var path = (s.docPath === null || s.docPath === undefined) ? "" :
        String(s.docPath);
    if (path === "") {
        // No file on disk means no backup, and no backup means no wipe.
        return { can: false, reason: "This drawing has never been saved, " +
            "so there is nothing to keep a copy of. Save it into its " +
            "cave folder first." };
    }
    if (s.inCaveFolder !== true) {
        return { can: false, reason: "This drawing is not in a cave " +
            "project folder. Reset only runs inside one, where a backup " +
            "has somewhere to go." };
    }
    var counts = (s.counts === null || s.counts === undefined) ?
        { total: 0 } : s.counts;
    if (counts.total === 0) {
        return { can: false, reason: "This drawing is already empty." };
    }
    return {
        can: true, reason: "",
        warning: "This empties the drawing completely. The cave's " +
            "folder is not touched."
    };
};

/**
 * "a", "a and b", "a, b and c" -- the Oxford-less join a sentence of
 * cleared things reads best in.
 */
CsReset.listText = function(items) {
    if (Object.prototype.toString.call(items) !== "[object Array]" ||
            items.length === 0) {
        return "";
    }
    if (items.length === 1) {
        return String(items[0]);
    }
    var head = [];
    for (var i = 0; i < items.length - 1; i++) {
        head.push(String(items[i]));
    }
    return head.join(", ") + " and " + String(items[items.length - 1]);
};

/** A number with thousands separators, so 1830 reads as 1,830. */
CsReset.groupNumber = function(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) {
        return "0";
    }
    var text = String(Math.abs(v));
    var out = "";
    while (text.length > 3) {
        out = "," + text.substring(text.length - 3) + out;
        text = text.substring(0, text.length - 3);
    }
    return (v < 0 ? "-" : "") + text + out;
};

/**
 * What each counted kind is called while it is being removed. The
 * dialog counts in three numbers and the progress window names the same
 * three, so somebody watching it recognises what they agreed to.
 */
CsReset.KIND_LABELS = {
    survey: "survey data",
    drawn: "drawn linework, symbols and notes",
    image: "placed images"
};

/**
 * One line of progress: what is going, and how far in.
 *
 * "Removing survey data -- 400 of 890". A bar alone says a wait is
 * happening; this says what the wait IS, which is the difference
 * between a slow tool and one a caver believes has crashed.
 */
CsReset.phaseText = function(kind, done, total) {
    var label = CsReset.KIND_LABELS[kind];
    if (label === undefined) {
        label = "entities";
    }
    return "Removing " + label + " -- " + CsReset.groupNumber(done) +
        " of " + CsReset.groupNumber(total);
};

/**
 * The dialog's body, as lines: what goes -- with the images counted
 * separately, because they are the part somebody will want to be sure
 * about -- what is NOT touched, where the copy went, and, where the
 * drawing is modified, that the copy is of the file on disk and not of
 * the unsaved edits in front of them.
 *
 * \param state {caveName, counts, backupPath, modified}
 */
CsReset.summaryText = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    var c = (s.counts === null || s.counts === undefined) ? {} : s.counts;
    var num = CsReset.groupNumber;
    var name = (s.caveName === null || s.caveName === undefined ||
        String(s.caveName) === "") ? "this cave" : String(s.caveName);
    var lines = [];
    lines.push("Empties the drawing of " + name + " completely.");
    lines.push("");
    lines.push("Deletes all " + num(c.total || 0) + " entities: " +
        num(c.survey || 0) + " survey (stations, legs, LRUD), " +
        num(c.drawn || 0) + " drawn (linework, symbols, notes) and " +
        num(c.images || 0) +
        ((c.images === 1) ? " placed image" : " placed images") +
        " (sketch scans and the aerial basemap).");
    lines.push("The cave's location goes with them -- declare it again " +
        "with Set Cave Location.");
    lines.push("");
    lines.push("Also cleared: the Complete marks on this cave's scans, " +
        "the last-declared location Set Cave Location offers, and the " +
        "map thumbnail on the shelf. The cave stays on the shelf.");
    lines.push("");
    lines.push("The cave's FOLDER is not touched: every scan, " +
        "photograph, capture and PDF stays on disk, ready to be placed " +
        "again.");
    lines.push("");
    if (s.backupPath !== null && s.backupPath !== undefined &&
            String(s.backupPath) !== "") {
        lines.push("A copy of the saved drawing is at " +
            String(s.backupPath) + ".");
    }
    if (s.modified === true) {
        // Said plainly rather than implied: the backup is a file copy,
        // and edits that were never written are in neither place once
        // this runs.
        lines.push("Unsaved changes in the open drawing are NOT in that " +
            "copy and will be lost.");
    }
    lines.push("");
    lines.push("Type the cave's name to confirm.");
    return lines;
};

/**
 * Does the typed confirmation match? Trimmed and case-insensitive: the
 * box is there to stop a stray Return in front of a class, not to test
 * anybody's typing.
 */
CsReset.matchesName = function(typed, caveName) {
    var a = (typed === null || typed === undefined) ? "" :
        String(typed).replace(/^\s+|\s+$/g, "").toLowerCase();
    var b = (caveName === null || caveName === undefined) ? "" :
        String(caveName).replace(/^\s+|\s+$/g, "").toLowerCase();
    return b !== "" && a === b;
};

/** What is said once it is done. Names the backup, because the one
 *  question after a reset anybody regrets is where the old one went. */
CsReset.doneText = function(state) {
    var s = (state === null || state === undefined) ? {} : state;
    var c = (s.counts === null || s.counts === undefined) ? {} : s.counts;
    var num = CsReset.groupNumber;
    var lines = [];
    lines.push("Reset: " + num(c.total || 0) + " entities deleted, " +
        num(c.images || 0) + " of them placed images. The drawing is " +
        "empty.");
    lines.push("The cave's folder is untouched -- the scans and the " +
        "imagery are still there to place again.");
    var cleared = (s.cleared === null || s.cleared === undefined) ?
        {} : s.cleared;
    var also = [];
    if (cleared.marks === true) { also.push("the Complete marks on its scans"); }
    if (cleared.location === true) { also.push("the last-declared location"); }
    if (cleared.preview === true) { also.push("the map thumbnail"); }
    if (also.length > 0) {
        lines.push("Cleared with it: " + CsReset.listText(also) + ".");
    }
    if (s.backupPath !== null && s.backupPath !== undefined &&
            String(s.backupPath) !== "") {
        lines.push("The drawing as it was: " + String(s.backupPath));
    }
    lines.push("Nothing has been saved yet -- close without saving to " +
        "undo all of this.");
    return lines;
};
