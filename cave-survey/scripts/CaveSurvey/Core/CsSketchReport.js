// CsSketchReport.js -- what to tell a caver after importing a sketch.
//
// Part of the Cave Survey Core library: pure string building, no
// document and no GUI, so tests/js_unit.js runs all of it. Separate
// from CsSketchDraw for that reason alone -- the words a caver reads
// are worth testing, and they cannot be while they are welded to the
// code that writes entities.
//
// THE SENTENCE THIS EXISTS TO GET RIGHT is the one about what did NOT
// come in. A count of what landed is easy and nearly useless: a caver
// reads "412 pieces of linework" and closes the dialog. What they need
// to know is that three scraps were skipped, that four types were not
// recognised and are sitting on the annotation layer, and that one
// page tied to a station this drawing has never heard of. Every one of
// those is a thing to go and look at.
//
// NO SCRAP IS SUMMARISED AWAY. A sketch that did not come in is named,
// with the reason, every time -- even in a run where forty others
// succeeded. The alternative is a caver discovering the missing page
// weeks later with no idea which it was.

var CsSketchReport = {};

/**
 * "1 wall" / "12 walls" -- the count and the word that fits it.
 */
CsSketchReport.plural = function(count, one, many) {
    return count + " " + (count === 1 ? one : many);
};

/**
 * The counts from one report, as a single readable clause.
 *
 * Only what is non-zero: a line reading "0 areas, 0 symbols, 0 texts"
 * is noise in front of the number that matters.
 */
CsSketchReport.counts = function(report) {
    var parts = [];
    if (report.lines > 0) {
        parts.push(CsSketchReport.plural(report.lines, "line", "lines"));
    }
    if (report.shapes > 0) {
        parts.push(CsSketchReport.plural(report.shapes,
            "shaped line", "shaped lines"));
    }
    if (report.areas > 0) {
        parts.push(CsSketchReport.plural(report.areas, "area", "areas"));
    }
    if (report.symbols > 0) {
        parts.push(CsSketchReport.plural(report.symbols,
            "symbol", "symbols"));
    }
    if (report.texts > 0) {
        parts.push(CsSketchReport.plural(report.texts, "note", "notes"));
    }
    if (report.callouts > 0) {
        parts.push(CsSketchReport.plural(report.callouts,
            "callout", "callouts"));
    }
    if (report.marks > 0) {
        parts.push(CsSketchReport.plural(report.marks, "mark", "marks"));
    }
    if (parts.length === 0) {
        return "nothing";
    }
    return parts.join(", ");
};

/**
 * How well a scrap sat on the survey, in the words a caver can act on.
 *
 * THE NUMBER QUOTED IS THE PRE-WARP ONE -- see CsSketchPlace's header.
 * It is the only honest measure of whether the sketch and the survey
 * agree, and a caver reading a large one should go and look at that
 * page rather than trust the walls on it.
 *
 * \param solution the answer from CsSketchPlace.solve.
 * \param unitName the drawing's unit, for the number.
 */
CsSketchReport.fit = function(solution, unitName) {
    if (solution === null || solution === undefined || !solution.ok) {
        return "not placed";
    }
    var unit = (unitName === undefined || unitName === null) ? "" :
        " " + unitName;
    if (solution.kind === "translation") {
        return "placed on its single station marker, at the scale the " +
            "sketch declares";
    }
    var worst = solution.residual === null ? 0 : solution.residual.worst;
    var how = "fitted on " + CsSketchReport.plural(solution.used,
        "station", "stations");
    if (solution.warp !== null) {
        how += " and bent onto them";
    }
    // Two decimals: a tenth of a foot is the scale at which a caver
    // starts caring, and three would imply a precision a hand sketch
    // has never had.
    return how + "; before bending, the worst station was out by " +
        worst.toFixed(2) + unit;
};

/**
 * One file's worth of report.
 *
 * \param name the file's own name.
 * \param result the answer from CsSketchDraw.fromFile.
 */
CsSketchReport.forFile = function(name, result) {
    var lines = [name + ":"];
    if (result === null || result === undefined) {
        lines.push("    could not be read");
        return lines.join("\n");
    }
    for (var i = 0; i < result.findings.length; i++) {
        lines.push("    " + result.findings[i].message);
    }
    for (i = 0; i < result.scraps.length; i++) {
        var scrap = result.scraps[i];
        if (scrap.placed) {
            lines.push("    " + scrap.name + ": " +
                CsSketchReport.counts(scrap.report));
        } else {
            lines.push("    " + scrap.name + ": not imported -- " +
                scrap.reason);
        }
    }
    if (result.cancelled) {
        lines.push("    stopped here at your request");
    }
    return lines.join("\n");
};

/**
 * The whole run: the per-file blocks, then what to go and look at.
 */
CsSketchReport.summary = function(totals, fileBlocks) {
    var lines = ["SKETCH:"];
    for (var i = 0; i < fileBlocks.length; i++) {
        lines.push(fileBlocks[i]);
    }
    lines.push("");
    lines.push("In all: " + CsSketchReport.counts(totals) + ".");

    if (totals.unknown.length > 0) {
        // NAMED, not counted. "4 unrecognised types" tells a caver
        // nothing they can do; the names tell them what to look for on
        // the annotation layer, and tell us what to add to the mapping.
        lines.push("");
        lines.push("Not recognised, and left on the annotation layer: " +
            totals.unknown.join(", ") + ". They are drawn where the " +
            "sketch put them -- move or delete them as you like.");
    }
    if (totals.failed > 0) {
        lines.push("");
        lines.push(CsSketchReport.plural(totals.failed,
            "piece of the sketch", "pieces of the sketch") +
            " could not be drawn at all.");
    }
    if (totals.warnings.length > 0) {
        lines.push("");
        for (i = 0; i < totals.warnings.length; i++) {
            lines.push("- " + totals.warnings[i]);
        }
    }
    return lines.join("\n");
};
