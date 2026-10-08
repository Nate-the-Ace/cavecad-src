// CsSheetSetup.js -- turning a drawn cave into a finished SHEET: the
// plot scale, the border, the scale bar's divisions, the text heights
// that will still be readable on paper, and the credits the map owes
// the people who surveyed it.
//
// Part of the Cave Survey Core library. Every function here is pure --
// it takes numbers and a survey and answers numbers and strings -- so
// the arithmetic that decides whether a map prints legibly is testable
// without a document.
//
// THE PROBLEM THIS SOLVES. A cave is drawn at 1 unit = 1 foot, and a
// sheet is measured in inches: the NSS template's border is 36 x 24,
// its title block text 0.14, its scale bar 3 long. Those are INCHES of
// paper sitting in the same model space as a cave 1400 feet across, and
// the template ships them as reference pieces for a cartographer to
// copy and scale by hand. A beginner does not know the plot scale is
// the number that reconciles the two, so the pieces stay in the corner
// of the template and the map goes out with no scale bar at all --
// which is exactly what Check Map finds on real drawings.
//
// So: pick a plot scale, and every sheet measurement is an inch of
// paper multiplied by it. 0.14 inch of title block text at 1" = 50 ft
// is 7 feet of drawing, and prints at 0.14 inch. That one multiplication
// is the whole idea, and it is why nothing here is measured in "units".

var CsSheetSetup = {};

/**
 * The plot scales a cave map is drawn at, in FEET PER INCH.
 *
 * Standard values, not whatever number makes the cave exactly fill the
 * paper. A reader who knows caves can look at "1 inch = 50 feet" and
 * estimate a passage without reading the bar at all, and a survey group
 * whose maps all use round scales can lay two of them side by side.
 */
/**
 * Every plot scale offered, imperial first and metric after.
 *
 * `feetPerInch` is the one number the rest of this file works in: feet
 * of cave per inch of paper. An imperial scale states it outright
 * ("1\" = 50 ft"); a metric one states a RATIO instead, because that
 * is how a metric map says it -- 1:500 means one of anything on paper
 * is five hundred of the same thing in the cave, and it is the same
 * scale whether the reader has a ruler in millimetres or inches. One
 * inch of paper at 1:500 is 500 inches of cave, which is 500/12 feet,
 * and that is the whole conversion.
 *
 * METRIC AT THE BOTTOM, for the reason the metric papers are: a list
 * is a statement about what you will probably want, and these caves
 * are surveyed in feet.
 */
CsSheetSetup.SCALE_ROWS = [
    { label: "1\" = 10 ft", feetPerInch: 10, metric: false },
    { label: "1\" = 20 ft", feetPerInch: 20, metric: false },
    { label: "1\" = 25 ft", feetPerInch: 25, metric: false },
    { label: "1\" = 30 ft", feetPerInch: 30, metric: false },
    { label: "1\" = 40 ft", feetPerInch: 40, metric: false },
    { label: "1\" = 50 ft", feetPerInch: 50, metric: false },
    { label: "1\" = 60 ft", feetPerInch: 60, metric: false },
    { label: "1\" = 80 ft", feetPerInch: 80, metric: false },
    { label: "1\" = 100 ft", feetPerInch: 100, metric: false },
    { label: "1\" = 150 ft", feetPerInch: 150, metric: false },
    { label: "1\" = 200 ft", feetPerInch: 200, metric: false },
    { label: "1\" = 300 ft", feetPerInch: 300, metric: false },
    { label: "1\" = 400 ft", feetPerInch: 400, metric: false },
    { label: "1\" = 500 ft", feetPerInch: 500, metric: false },
    { label: "1:100", feetPerInch: 100 / 12, metric: true },
    { label: "1:200", feetPerInch: 200 / 12, metric: true },
    { label: "1:250", feetPerInch: 250 / 12, metric: true },
    { label: "1:500", feetPerInch: 500 / 12, metric: true },
    { label: "1:1000", feetPerInch: 1000 / 12, metric: true },
    { label: "1:2000", feetPerInch: 2000 / 12, metric: true }
];

/** The scales as bare feet-per-inch, in the same order. Derived, so
 *  the two can never disagree about what is offered. */
CsSheetSetup.SCALES = (function() {
    var out = [];
    for (var i = 0; i < CsSheetSetup.SCALE_ROWS.length; i++) {
        out.push(CsSheetSetup.SCALE_ROWS[i].feetPerInch);
    }
    return out;
})();

/** The row one feet-per-inch belongs to, or null. */
CsSheetSetup.scaleRow = function(feetPerInch) {
    for (var i = 0; i < CsSheetSetup.SCALE_ROWS.length; i++) {
        if (Math.abs(CsSheetSetup.SCALE_ROWS[i].feetPerInch -
                feetPerInch) < 1e-9) {
            return CsSheetSetup.SCALE_ROWS[i];
        }
    }
    return null;
};

/** Is this scale a metric one? Decides whether the bar counts metres
 *  and whether the caption reads as a ratio. */
CsSheetSetup.isMetric = function(feetPerInch) {
    var row = CsSheetSetup.scaleRow(feetPerInch);
    return !isNull(row) && row.metric === true;
};

/** Metres in a foot, for the metric bar. */
CsSheetSetup.M_PER_FT = 0.3048;

/** Inches in a millimetre, for the metric papers below. */
CsSheetSetup.MM = 1 / 25.4;

/**
 * The sheets a cave map is plotted on. ALWAYS IN INCHES internally,
 * whatever the paper is called: the plot scale is feet per inch, and
 * one unit through the whole file beats two and a conversion at every
 * use.
 *
 * IMPERIAL FIRST, METRIC AFTER (Nathan, 2026-09-10). This suite's
 * caves are surveyed in feet and plotted on ARCH D; the ISO papers are
 * here because a cave map is not only a North American thing, and they
 * are at the bottom because a list is a statement about what you will
 * probably want. The metric names carry their MILLIMETRES, because
 * that is what a caver reaching for A1 recognises -- the inches are
 * this file's business, not theirs.
 */
CsSheetSetup.SHEETS = [
    { name: "ANSI A -- 11 x 8.5", w: 11, h: 8.5 },
    { name: "ANSI B -- 17 x 11", w: 17, h: 11 },
    { name: "ANSI C -- 22 x 17", w: 22, h: 17 },
    { name: "ARCH C -- 24 x 18", w: 24, h: 18 },
    { name: "ANSI D -- 34 x 22", w: 34, h: 22 },
    { name: "ARCH D -- 36 x 24", w: 36, h: 24 },
    { name: "ARCH E -- 48 x 36", w: 48, h: 36 },
    { name: "ISO A4 -- 297 x 210 mm",
        w: 297 * CsSheetSetup.MM, h: 210 * CsSheetSetup.MM },
    { name: "ISO A3 -- 420 x 297 mm",
        w: 420 * CsSheetSetup.MM, h: 297 * CsSheetSetup.MM },
    { name: "ISO A2 -- 594 x 420 mm",
        w: 594 * CsSheetSetup.MM, h: 420 * CsSheetSetup.MM },
    { name: "ISO A1 -- 841 x 594 mm",
        w: 841 * CsSheetSetup.MM, h: 594 * CsSheetSetup.MM },
    { name: "ISO A0 -- 1189 x 841 mm",
        w: 1189 * CsSheetSetup.MM, h: 841 * CsSheetSetup.MM }
];

/** The NSS template's own sheet, and so the default. */
CsSheetSetup.DEFAULT_SHEET = "ARCH D -- 36 x 24";

/**
 * How much of the sheet is kept clear at every edge, in INCHES of
 * paper. A map drawn to the paper's edge cannot be bound, trimmed or
 * held, and a plotter's own unprintable border is about this wide.
 *
 * HALF AN INCH, FLAT (Nathan, 2026-09-14). It used to be a twelfth of
 * the sheet's short side, which on ARCH D is nearly THREE inches all
 * round -- seven per cent of the paper's area given to white space, and
 * enough to cost a cave a whole scale step. A margin is a physical
 * allowance for the plotter and the binder; it does not get bigger
 * because the paper did.
 */
CsSheetSetup.MARGIN_INCHES = 0.5;

/**
 * How far inside its own border the extended elevation's bands are
 * parked, as a fraction of the sheet's width.
 *
 * A FRACTION and not inches, unlike the margin above, because the only
 * thing known where this is used is a border already drawn in a
 * drawing: CsProfileDraw finds the elevation sheet by its border and
 * has no paper size and no plot scale to turn inches into units with.
 * The same number is used everywhere the bands are placed OR previewed,
 * which is what matters -- the picture and the placement have to agree.
 *
 * SEVEN PERCENT, NOT THREE (2026-10). Three percent of a small or turned
 * sheet is under the half-inch margin -- 0.25 in on ANSI A -- so the
 * bands started OUTSIDE the margin the rest of the sheet is kept behind.
 * Seven percent of the narrowest sheet there is (8.27 in, A4 turned) is
 * still 0.58 in, clear of it; tests/js_unit.js holds every paper to that.
 */
CsSheetSetup.BAND_INSET_FRACTION = 0.07;

/** Printed text heights, in INCHES on the finished sheet. Everything
 *  drawn by this tool is one of these multiplied by the plot scale.
 *  The values are the NSS template's own, so a sheet this tool builds
 *  and one assembled by hand from the template's reference pieces come
 *  out the same size. */
CsSheetSetup.TEXT = {
    caveName: 0.42,
    heading: 0.18,
    body: 0.14,
    small: 0.11
};

/** The scale bar, in inches of paper. */
CsSheetSetup.BAR = {
    length: 3.0,      // how long the bar is drawn
    height: 0.16,     // the depth of the alternating blocks
    tick: 0.06        // how far the labels sit below it
};

CsSheetSetup.sheetByName = function(name) {
    for (var i = 0; i < CsSheetSetup.SHEETS.length; i++) {
        if (CsSheetSetup.SHEETS[i].name === name) {
            return CsSheetSetup.SHEETS[i];
        }
    }
    return null;
};

/**
 * The smallest standard scale that fits a cave of this size on this
 * sheet, or the largest scale there is when nothing fits.
 *
 * SMALLEST means most detail: 1" = 20 ft shows more than 1" = 100 ft,
 * so the answer is the first scale in the list that works rather than
 * the one that leaves the least white space.
 *
 * The cave is measured either way round -- a long thin cave on a
 * landscape sheet may only fit turned -- and the answer says whether it
 * had to be turned, because that is a decision a cartographer must make
 * knowingly rather than discover at the plotter.
 */
CsSheetSetup.fit = function(caveWidthFeet, caveHeightFeet, sheet,
        footerInches, forceTurned) {
    var margin = CsSheetSetup.MARGIN_INCHES;
    // The footer may depend on the paper's orientation (a turned sheet
    // is narrower, so the furniture wraps to more rows): a function of
    // `turned` is asked for each orientation in turn.
    var footerOf = function(turned) {
        var f = (typeof footerInches === "function") ?
            footerInches(turned) : footerInches;
        return (isNull(f) || !(f > 0)) ? 0 : f;
    };
    var footer = footerOf(false);
    var usableW = sheet.w - margin * 2;
    // The FOOTER is the band the title block, scale bar and north arrow
    // occupy. Counting it as usable is how a cave comes out overlapping
    // its own credits: Truitt Cave's title block is four inches tall
    // and the margin is under three, so the block rose into the map.
    var usableH = sheet.h - margin * 2 - footer;
    var usableHTurned = sheet.w - margin * 2 - footerOf(true);
    var usableWTurned = sheet.h - margin * 2;
    var w = Math.max(caveWidthFeet, 0.0001);
    var h = Math.max(caveHeightFeet, 0.0001);
    // THE PAPER IS WHATEVER WAY UP THE CAVER SET (Nathan, 2026-10-05: "it
    // seems to be switching sheet size; it should use the same size page
    // that I set"). With forceTurned true or false only that way up is
    // tried; left out, either is, and a turned answer says so.
    var landscapeOk = forceTurned !== true;
    var portraitOk = forceTurned !== false;
    for (var i = 0; i < CsSheetSetup.SCALES.length; i++) {
        var s = CsSheetSetup.SCALES[i];
        if (landscapeOk && w / s <= usableW && h / s <= usableH) {
            return { scale: s, turned: false, fits: true };
        }
        if (portraitOk && w / s <= usableWTurned && h / s <= usableHTurned) {
            return { scale: s, turned: true, fits: true };
        }
    }
    return {
        scale: CsSheetSetup.SCALES[CsSheetSetup.SCALES.length - 1],
        turned: forceTurned === true,
        fits: false
    };
};

/**
 * The scale bar's divisions: a round number of feet per block, and
 * enough blocks to fill the bar.
 *
 * ROUND FEET PER BLOCK, not a round bar length. A bar three inches long
 * at 1" = 30 ft is 90 feet, which divides into 6 blocks of 15 -- and 15
 * is a number a reader can count in their head. The alternative, a bar
 * of exactly 100 ft, comes out an odd length on the paper and buys
 * nothing.
 */
CsSheetSetup.barFor = function(scale) {
    // A METRIC SCALE COUNTS METRES. A bar under "1:500" marked off in
    // feet asks a reader to convert in their head, which is the one
    // thing a scale bar exists to spare them.
    var metric = CsSheetSetup.isMetric(scale);
    var perDisplay = metric ? CsSheetSetup.M_PER_FT : 1;   // display / ft
    var wanted = CsSheetSetup.BAR.length * scale * perDisplay;
    var steps = metric ?
        [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] :
        [1, 2, 5, 10, 15, 20, 25, 50, 100, 200, 250, 500, 1000];
    var best = null;
    for (var i = 0; i < steps.length; i++) {
        var blocks = Math.floor(wanted / steps[i]);
        if (blocks < 2) {
            continue;
        }
        // Four to eight blocks reads as a scale bar; two is a domino
        // and twenty is a ruler nobody counts.
        var score = Math.abs(blocks - 6);
        if (blocks > 10) {
            continue;
        }
        if (best === null || score < best.score) {
            best = { perBlock: steps[i], blocks: blocks, score: score };
        }
    }
    if (best === null) {
        best = { perBlock: Math.max(1, Math.round(wanted / 4)), blocks: 4 };
    }
    return {
        // What the LABELS say, in the display unit.
        perBlock: best.perBlock,
        blocks: best.blocks,
        unit: metric ? "M" : "FT",
        // And what the GEOMETRY is drawn from, always in feet: the
        // drawing is measured in feet whatever the sheet is captioned
        // in, and mixing the two is how a bar comes out the wrong
        // length while its numbers look right.
        perBlockFeet: best.perBlock / perDisplay,
        totalFeet: (best.perBlock * best.blocks) / perDisplay
    };
};

/**
 * The tag that carries a title block field's WHOLE value on the first
 * of its wrapped lines.
 *
 * Wrapping a field across several text entities means the drawing no
 * longer holds the value anywhere in one piece: CsSheet.readField finds
 * the first fragment and answers that, so a second run of Sheet Setup
 * read back "SURVEYED BY: JEANNE PARK, MATT LEWIS, TIM" and quietly
 * dropped eighteen of Truitt Cave's twenty-one surveyors. Caught by
 * tests/sheet_setup_run.js, which counted the sheet shrinking.
 *
 * So the full text rides along on the first line as its own tag, and a
 * re-run prefers it. CsSheet is left alone: it answers what is VISIBLE
 * on the sheet, which is what Survey Stats and the title block editor
 * want, and this is a fact about how the line was printed.
 */
CsSheetSetup.TAG_FULL = "TBFull";

/** How wide the title block column is, in inches of paper. */
// Six inches of a thirty-six inch sheet. Wider than it first was:
// at 4.2 inches Truitt Cave's twenty-one surveyors wrapped to six
// lines and the block grew taller than the margin it lives in.
CsSheetSetup.TITLE_INCHES = 6.0;

/** How far apart stacked lines sit, as a multiple of their own height. */
CsSheetSetup.LINE_SPACING = 1.9;

/**
 * How wide a character is, as a fraction of its height, in the sheet's
 * "standard" text font. MEASURED, not assumed (2026-10-04): a plotted
 * 76-character credit line at 0.14 in measured 7.9 in, 0.104 in a
 * character, 0.74 of the height. The wrap rule had used 0.55, so every
 * title line ran about a third wider than the 6 inches it was wrapped
 * to, and the furniture laid out beside it by those widths collided with
 * it.
 */
CsSheetSetup.CHAR_WIDTH = 0.74;

/**
 * How many characters of a given printed size fit across the title
 * block column.
 *
 * 0.55 of the height per character is the usual rule of thumb for a
 * plain stroke font, and it only has to be close: the cost of being a
 * little narrow is a line break one word early, and the cost of being
 * too wide is a name running off the paper.
 */
CsSheetSetup.charsPerLine = function(textInches) {
    if (isNull(textInches) || !(textInches > 0)) {
        return 40;
    }
    return Math.max(8,
        Math.floor(CsSheetSetup.TITLE_INCHES /
            (textInches * CsSheetSetup.CHAR_WIDTH)));
};

/**
 * THE TITLE BLOCK, LAID OUT AS LINES.
 *
 * Pure, and separate from the drawing, because this is where a title
 * block goes wrong: Truitt Cave credits twenty-one surveyors, and the
 * first version of this tool put all of them in ONE text entity, which
 * wrapped inside itself and printed over the six lines below it. Twenty
 * names is not an edge case for a cave map -- it is what a real survey
 * looks like -- so the wrapping is done here, one line at a time, and
 * the caller only has to walk the list.
 *
 * `values` is { fieldId: text }; a field with nothing in it is printed
 * anyway when it is REQUIRED (an empty line is an invitation to type
 * one) and skipped when it is not.
 *
 * Each line is { text, inches, fieldId }. Only the FIRST line of a
 * field carries the fieldId, so the tag that lets Survey Stats stamp a
 * value later lands once rather than on every wrapped fragment.
 */
CsSheetSetup.titleLines = function(values, fields) {
    var out = [];
    var rows = isNull(fields) ? CsSheet.FIELDS : fields;
    var have = isNull(values) ? {} : values;
    for (var i = 0; i < rows.length; i++) {
        var field = rows[i];
        var value = have.hasOwnProperty(field.id) ?
            String(have[field.id]) : "";
        var blank = value.replace(/\s/g, "") === "";
        if (blank && field.required !== true) {
            continue;
        }
        var isName = (field.id === "caveName");
        var inches = isName ? CsSheetSetup.TEXT.caveName :
            CsSheetSetup.TEXT.body;
        var full = isName ? (blank ? "CAVE NAME" : value) :
            (field.prefix + value);
        var wrapped = CsSheetSetup.wrapText(full,
            CsSheetSetup.charsPerLine(inches));
        for (var w = 0; w < wrapped.length; w++) {
            out.push({
                text: wrapped[w],
                inches: inches,
                // The tag goes on the first line only: one field, one
                // taggged entity, however many lines it took to print.
                fieldId: (w === 0) ? field.id : ""
            });
        }
    }
    return out;
};

/** How tall a stack of title lines is, in inches of paper. */
CsSheetSetup.linesHeight = function(lines) {
    var total = 0;
    for (var i = 0; i < lines.length; i++) {
        total += lines[i].inches * CsSheetSetup.LINE_SPACING;
    }
    return total;
};

/** Greedy word wrap. A word longer than the budget keeps its own line
 *  rather than being cut in half -- a surname is not divisible. */
CsSheetSetup.wrapText = function(text, budget) {
    var words = String(isNull(text) ? "" : text).split(" ");
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") {
            continue;
        }
        if (line.length === 0) {
            line = words[i];
        } else if (line.length + 1 + words[i].length <= budget) {
            line += " " + words[i];
        } else {
            lines.push(line);
            line = words[i];
        }
    }
    if (line.length > 0) {
        lines.push(line);
    }
    return lines.length === 0 ? [""] : lines;
};

/** A printed height in inches, as drawing feet at this plot scale. */
CsSheetSetup.atScale = function(inches, scale) {
    return inches * scale;
};

/** What the bar is captioned with: "1" = 50 FT", or "1:500". */
CsSheetSetup.scaleText = function(scale) {
    var row = CsSheetSetup.scaleRow(scale);
    if (!isNull(row)) {
        return "SCALE:  " + row.label.toUpperCase();
    }
    return "SCALE:  1\" = " + scale + " FT";
};

/** How far apart two sheets sit in the drawing, in inches of paper.
 *  Wide enough that nobody mistakes one border for the other's edge,
 *  and that a plotter set to "window" cannot catch both. */
CsSheetSetup.SHEET_GUTTER = 2.0;

/**
 * Where the elevation sheet is drawn IN THE PREVIEW: the same paper, at
 * the same scale, beside the plan's.
 *
 * TWO SHEETS, NOT ONE BIGGER ONE. The elevation has to be drawn at the
 * plan's scale -- a map carrying two scales is a lie -- and a cave
 * whose plan fits ARCH D at 1" = 40 rarely has room left for eight
 * elevation bands at the same scale. The alternatives were a scale step
 * nobody asked for or paper nobody can print.
 *
 * THE PREVIEW ONLY. The two sheets are separate FILES, each holding one
 * sheet at its own origin; this places them side by side so the panel
 * can show both pages at once, which is how a cartographer thinks about
 * them even though no drawing ever holds both.
 */
CsSheetSetup.elevationSheetBox = function(planBox, scale) {
    var gutter = CsSheetSetup.SHEET_GUTTER * scale;
    // STACKED, NOT SIDE BY SIDE (Nathan, 2026-09-10). A dock is tall
    // and narrow; two landscape pages beside each other in it come out
    // as two postage stamps. One above the other fills the width, and
    // the width is what a landscape page needs.
    return {
        minX: planBox.minX,
        maxX: planBox.maxX,
        minY: planBox.minY - gutter - planBox.height,
        maxY: planBox.minY - gutter,
        width: planBox.width,
        height: planBox.height,
        footer: planBox.footer,
        margin: planBox.margin
    };
};

/**
 * The sheet's own rectangle in DRAWING coordinates, centred on the
 * cave.
 *
 * `turned` swaps the paper, not the cave: rotating a surveyed cave to
 * make it fit would rotate north with it, and a map whose north arrow
 * is a lie is worse than one that did not fit the paper.
 */
CsSheetSetup.borderBox = function(caveBox, sheet, scale, turned,
        footerInches, shiftInches) {
    var w = (turned === true ? sheet.h : sheet.w) * scale;
    var h = (turned === true ? sheet.w : sheet.h) * scale;
    var footer = ((isNull(footerInches) || !(footerInches > 0)) ? 0 :
        footerInches) * scale;
    // THE PAPER MOVES, NOT THE CAVE. A cartographer who drags the cave
    // across the preview is asking for the map to sit elsewhere on the
    // page -- and the cave's coordinates are survey data, so the only
    // thing that may move is the sheet under it. `shiftInches` is that
    // drag, negated by the caller: see SheetSetup.draw.
    var shift = CsSheetSetup.offsetOf({ sheet: shiftInches }, "sheet");
    var cx = (caveBox.minX + caveBox.maxX) / 2 + shift.x * scale;
    // Centred in the space ABOVE the footer, not in the whole sheet.
    // The SHEET drops by half the footer, which is the same thing as
    // the cave rising by half of it: the band the title block occupies
    // is reserved rather than shared, and the credits stop printing
    // over the passage.
    var cy = (caveBox.minY + caveBox.maxY) / 2 - footer / 2 +
        shift.y * scale;
    return {
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        width: w, height: h,
        footer: footer,
        margin: CsSheetSetup.MARGIN_INCHES * scale
    };
};

/**
 * The page settings QCAD's File > Print / Export to PDF reads, worked
 * out so the sheet's border lands exactly on the paper.
 *
 * WHY THIS EXISTS. The border is drawn in model space at plot scale,
 * and nothing told QCAD that: its page settings stayed at whatever the
 * template carried (A4, a 1:1 scale, the default printer's margins), so
 * a sheet printed as a postage stamp in the corner of the wrong paper.
 * These are the numbers that make "Print" mean "plot this sheet".
 *
 * Derived from the border's own geometry rather than from the nominal
 * scale, so the paper and the border can never disagree about what a
 * drawing unit is -- the print scale is whatever maps the border's
 * width onto the paper's width.
 *
 * \param box        a borderBox() result, in drawing units
 * \param sheet      the sheet (inches)
 * \param turned     the paper is turned (portrait)
 * \param unitMM     millimetres in one drawing unit
 * \return { paperWidthMM, paperHeightMM (UNORIENTED, portrait: width <
 *           height), orientation "Landscape"|"Portrait", scale (QCAD's
 *           own string, "1:N"), scaleRatio (the N), offsetX,
 *           offsetY (drawing units: where the paper's lower left sits) }
 */
CsSheetSetup.pageSettings = function(box, sheet, turned, unitMM) {
    var wIn = (turned === true ? sheet.h : sheet.w);
    var hIn = (turned === true ? sheet.w : sheet.h);
    var wMM = wIn * 25.4;
    var hMM = hIn * 25.4;
    var landscape = wMM >= hMM;
    return {
        paperWidthMM: landscape ? hMM : wMM,
        paperHeightMM: landscape ? wMM : hMM,
        orientation: landscape ? "Landscape" : "Portrait",
        // QCAD's print scale is PAPER per DRAWING ("1:480" is 1/480),
        // the inverse of the plot scale's feet-per-inch habit. Getting
        // it the other way up plots the whole cave as a dot.
        scaleRatio: (box.width * unitMM) / wMM,
        scale: "1:" + ((box.width * unitMM) / wMM),
        offsetX: box.minX,
        offsetY: box.minY
    };
};

/**
 * How far the north arrow reaches from its pin, in inches of paper, the
 * captions included: {left, right, down, up}.
 *
 * THE ARROW IS MORE THAN ITS SHAFT. Two caption lines hang below the pin
 * and run sideways -- "TRUE NORTH  (DECLINATION 4.0 APPLIED)" and
 * "MAGNETIC NORTH 4.0 E (2024-11-03)" -- and a magnetic arm and its "mN"
 * stand off to one side. The pin used to be set ON the right margin line,
 * which put roughly half of all that on the wrong side of it (Nathan,
 * 2026-10-04: "straddles the lower right margin and I'm tired of moving
 * it"). Placing the pin by the piece's real reach is what keeps the
 * whole thing inside the margin by default.
 *
 * Width of a caption is estimated at the same 0.55 of its height per
 * character that charsPerLine uses everywhere else on the sheet.
 *
 * \param reading  CsSheetSetup.latestDeclination's answer, or null
 */
CsSheetSetup.northExtent = function(reading) {
    var A = CsSheetSetup.NORTH;
    var small = CsSheetSetup.TEXT.small;
    var charW = small * CsSheetSetup.CHAR_WIDTH;
    var hasMag = !isNull(reading);
    var out = {
        left: 0.9,                       // captions start 0.9 in left of the pin
        right: A.headHalf + 0.1,
        down: 0.2 + small / 2,           // the "TRUE NORTH" line
        up: A.height + 0.28 + CsSheetSetup.TEXT.heading
    };
    var trueLen = "TRUE NORTH".length;
    if (hasMag && reading.declination !== 0) {
        trueLen += ("  (DECLINATION " +
            Number(reading.declination).toFixed(1) + "\u00b0 APPLIED)").length;
    }
    out.right = Math.max(out.right, -0.9 + trueLen * charW);
    if (hasMag) {
        var arm = CsSheetSetup.magneticUnit(reading.declination);
        var armX = arm.x * A.magneticHeight, armY = arm.y * A.magneticHeight;
        out.right = Math.max(out.right, armX + 0.12 + 0.2);
        out.left = Math.max(out.left, -(armX - 0.1));
        out.up = Math.max(out.up, armY + 0.18 + small);
        out.down = 0.2 + small * 2 + small / 2;     // the magnetic caption line
        out.right = Math.max(out.right, -0.9 +
            CsSheetSetup.magneticText(reading).length * charW);
    }
    return out;
};

/**
 * How far the scale bar's labels hang below its line, as a lift: the bar
 * is drawn this far above its piece's bottom edge so the numbers stay
 * on the right side of the margin. (They used to hang 0.18 in below it,
 * across the bottom margin line.)
 */
CsSheetSetup.BAR_LIFT = CsSheetSetup.BAR.tick * 2 + CsSheetSetup.TEXT.small / 2 + 0.02;

/**
 * Where the sheet's furniture goes BY DEFAULT: the title block, the
 * scale bar and the north arrow, each a box with a real size, packed
 * into the band under the map so that none is outside the margin and
 * none is on another.
 *
 * ONE ROW WHEN IT FITS, MORE WHEN IT DOES NOT. Title block (6 in), bar
 * (about 3.6 in) and north arrow (about 3 in with its captions) need
 * roughly 13 in side by side; an ARCH D sheet has 35, an ANSI A or an
 * A4 has under 11 and a turned one under 8. The old layout put the
 * pieces at fixed fractions of the width, which is how the arrow ended
 * up on the title block on a small sheet. Pieces now wrap onto a second
 * row, the band grows to hold it, and the map gives up that much paper.
 *
 * In a row the arrow is right-aligned to the margin, the title is left,
 * and the bar sits in the middle of what is left.
 *
 * \param o.widthInches  the paper's width in the orientation drawn
 * \param o.wants        {title, bar, north}
 * \param o.titleHeight  the title block's height in inches
 * \param o.reading      CsSheetSetup.latestDeclination's answer or null
 * \return {footer, usable, pieces: {kind: {x, y, w, h, [pinX, pinY]}}}
 *         x, y are INCHES from the margin box's lower left corner
 */
CsSheetSetup.furniture = function(o) {
    var gap = 0.3, vgap = 0.2, pad = 0.4;
    var usable = o.widthInches - CsSheetSetup.MARGIN_INCHES * 2;
    var wants = isNull(o.wants) ? {} : o.wants;
    var list = [];
    if (wants.title === true) {
        list.push({ kind: "title", w: CsSheetSetup.TITLE_INCHES,
            h: Math.max(0.5, isNull(o.titleHeight) ? 2 : o.titleHeight) });
    }
    if (wants.bar === true) {
        list.push({ kind: "bar", w: CsSheetSetup.BAR.length + 0.65,
            h: CsSheetSetup.BAR_LIFT + CsSheetSetup.BAR.height +
                CsSheetSetup.TEXT.body * 1.6 });
    }
    if (wants.north === true) {
        var ext = CsSheetSetup.northExtent(o.reading);
        list.push({ kind: "north", w: ext.left + ext.right,
            h: ext.up + ext.down, pinX: ext.left, pinY: ext.down });
    }
    var rows = [];
    for (var i = 0; i < list.length; i++) {
        var row = rows.length > 0 ? rows[rows.length - 1] : null;
        var need = (row !== null && row.items.length > 0 ? gap : 0) +
            list[i].w;
        if (row !== null && row.w + need <= usable + 1e-9) {
            row.items.push(list[i]);
            row.w += need;
            row.h = Math.max(row.h, list[i].h);
        } else {
            rows.push({ items: [list[i]], w: list[i].w, h: list[i].h });
        }
    }
    var pieces = {};
    var y = 0;
    for (var r = 0; r < rows.length; r++) {
        var items = rows[r].items;
        var x = 0;
        var k;
        for (k = 0; k < items.length; k++) {
            items[k].x = x;
            x += items[k].w + gap;
        }
        // the arrow goes to the right margin, and a bar left between the
        // title and it is centred in the room there is
        var last = items[items.length - 1];
        if (items.length > 1 && last.kind === "north") {
            last.x = Math.max(last.x, usable - last.w);
            if (items.length === 3) {
                var free = last.x - (items[0].x + items[0].w);
                items[1].x = items[0].x + items[0].w +
                    Math.max(gap, (free - items[1].w) / 2);
            }
        }
        for (k = 0; k < items.length; k++) {
            items[k].y = y;
            pieces[items[k].kind] = items[k];
        }
        y += rows[r].h + vgap;
    }
    var total = rows.length > 0 ? y - vgap : 0;
    return { footer: rows.length > 0 ? total + pad : 0, usable: usable,
        rows: rows.length, pieces: pieces };
};

/** The footer band for one orientation of one paper -- the number fit(),
 *  borderBox() and the tile layout all reserve. */
CsSheetSetup.footerFor = function(o) {
    var width = o.turned === true ? o.sheet.h : o.sheet.w;
    return CsSheetSetup.furniture({ widthInches: width, wants: o.wants,
        titleHeight: o.titleHeight, reading: o.reading }).footer;
};

// ---------------------------------------------------------------------
// MAGNETIC NORTH, BESIDE THE TRUE ONE.
//
// The suite rotates every azimuth by the trip's declination as it
// draws, so what is on the sheet is TRUE north -- and a caver standing
// in the cave is holding a compass that points somewhere else. A map
// that shows only true north is asking its reader to know the
// declination and do the arithmetic in the dark.
//
// So the arrow carries both: true north up, and a magnetic arm at the
// declination of the LATEST trip, labelled with that declination and
// the date it belongs to. Declination drifts -- a degree every few
// years in most of North America -- so "magnetic north" without a date
// is a number with a shelf life and no label on it.
//
// THE LATEST TRIP, not the first: a reader takes a map underground to
// use it, and the most recent survey is the closest thing the map has
// to the compass in their hand.
// ---------------------------------------------------------------------

/**
 * The declination to draw magnetic north at, and the date it came
 * from. Null when the survey cannot say.
 *
 * \return { declination, date } -- date "" when the trip has none.
 *
 * Dates are ISO ("2024-11-03"), so they sort as text; a trip with no
 * date cannot be the latest by date and is only fallen back on when
 * NOTHING in the survey is dated. Ties go to the trip further down the
 * list, which is the order the file was written in.
 *
 * A DECLINATION OF ZERO IS NOT AN ANSWER. It is the suite's own default
 * for a trip nobody has told, and this build cannot tell that apart
 * from a place where the needle really does point true: Truitt Cave's
 * eleven trips all read 0.0 with a source of "user" (measured live,
 * 2026-09-14). Drawing a magnetic arm there would put a second arrow
 * exactly on top of the true one and print "MAGNETIC NORTH 0.0°" on a
 * sheet, which is a claim about the world that nothing in the drawing
 * supports. So zero answers null: true north only, and the map says
 * nothing it cannot back up.
 */
CsSheetSetup.latestDeclination = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return null;
    }
    var best = null;
    var undated = null;
    for (var i = 0; i < survey.trips.length; i++) {
        var trip = survey.trips[i];
        if (isNull(trip)) {
            continue;
        }
        var d = trip.declination;
        if (isNull(d) || !isFinite(d) || Number(d) === 0) {
            continue;
        }
        var date = isNull(trip.date) ? "" : String(trip.date);
        if (date === "") {
            undated = { declination: Number(d), date: "" };
            continue;
        }
        if (best === null || date >= best.date) {
            best = { declination: Number(d), date: date };
        }
    }
    return best !== null ? best : undated;
};

/**
 * Which way magnetic north points on a sheet drawn in TRUE north.
 *
 * Declination is positive EAST (see Core/CsModel.js), and east is +x
 * on a drawing whose north is +y -- so a positive declination swings
 * the needle clockwise from up. A unit vector, so the caller decides
 * how long the arm is.
 */
CsSheetSetup.magneticUnit = function(declination) {
    var d = (isNull(declination) || !isFinite(declination)) ? 0 :
        Number(declination);
    var rad = d * Math.PI / 180;
    return { x: Math.sin(rad), y: Math.cos(rad) };
};

/** The arrow, in inches of paper. The magnetic arm is drawn shorter
 *  than the true one so the two cannot be mistaken for each other at a
 *  glance, and its head smaller for the same reason. */
CsSheetSetup.NORTH = {
    height: 1.4,
    headLength: 0.4,
    headHalf: 0.18,
    magneticHeight: 0.85,
    magneticHeadLength: 0.18,
    magneticHeadHalf: 0.075
};

/** The magnetic arm's grey. Secondary, the way a compass rose draws it:
 *  the true arrow is what the map is drawn in, and the arm is a fact
 *  about a needle. Dark enough to survive a plot and a photocopy. */
CsSheetSetup.MAGNETIC_GREY = [128, 128, 128];

/**
 * How the magnetic arm is captioned, under the true north line:
 * "MAGNETIC NORTH 3.2° E (2024-11-03)".
 *
 * THE DATE IS PART OF THE FACT. Declination drifts about a degree every
 * few years, so a magnetic north with no date on it is a number with a
 * shelf life and no label -- and the date this carries is the LATEST
 * trip's, which is the survey nearest the compass a reader is holding.
 */
CsSheetSetup.magneticText = function(reading) {
    if (isNull(reading)) {
        return "";
    }
    var d = reading.declination;
    var side = d > 0 ? "E" : (d < 0 ? "W" : "");
    var out = "MAGNETIC NORTH " + Math.abs(d).toFixed(1) + "°" +
        (side === "" ? "" : " " + side);
    if (!isNull(reading.date) && reading.date !== "") {
        out += " (" + reading.date + ")";
    }
    return out;
};

// ---------------------------------------------------------------------
// ARRANGING THE PAGE BY HAND.
//
// The layout this file computes is a sensible default, not a law: the
// title block goes bottom left, the bar at 45% across, the arrow at the
// right margin. A real map has a reason to break that -- a cave whose
// plan runs down the left of the sheet leaves the bar sitting on top of
// it, and the only cartographer who can see that is the one looking at
// the preview.
//
// So each piece carries an OFFSET, measured in INCHES OF PAPER from
// where the default put it. Inches and not drawing units because the
// scale is one of the two things the panel is for changing: a bar
// nudged two inches to the right stays two inches to the right when the
// scale steps, rather than leaping across the page.
//
// Everything below is pure -- boxes, offsets and hit tests -- so the
// arithmetic a drag depends on is testable without a mouse.
// ---------------------------------------------------------------------

/** The pieces a caver may drag. "cave" moves the PAPER under the cave;
 *  see CsSheetSetup.borderBox. */
CsSheetSetup.MOVABLE = ["cave", "title", "bar", "north"];

/** How near an edge has to come before it snaps to one, in INCHES of
 *  paper. A tenth of an inch is about a pen width on the finished
 *  sheet: near enough that nobody meant to be that close by accident,
 *  far enough that a hand on a mouse can hit it. */
CsSheetSetup.SNAP_INCHES = 0.1;

/** Is this a piece a caver may drag?
 *
 * A CHUNK BOX IS MOVABLE BY PREFIX, not by membership in MOVABLE: there
 * is one of it per chunk, and the count varies per cave, so it cannot
 * be a fixed array entry the way the four furniture pieces are. The
 * un-keyed literal "band" (an extended or projected sheet's single
 * elevation footprint) is deliberately NOT covered by this -- only the
 * per-chunk "band:<key>" form CsSheetSetup.preview emits for a chunked
 * Profile Sheet is. */
CsSheetSetup.isMovable = function(kind) {
    if (CsSheetSetup.MOVABLE.indexOf(kind) >= 0) {
        return true;
    }
    return typeof kind === "string" && kind.indexOf("band:") === 0;
};

/** One piece's offset, in inches of paper, defaulted to no move at
 *  all. Tolerates null, a missing entry and a half-written one. */
CsSheetSetup.offsetOf = function(offsets, kind) {
    var out = { x: 0, y: 0 };
    if (isNull(offsets) || isNull(offsets[kind])) {
        return out;
    }
    var off = offsets[kind];
    if (!isNull(off.x) && isFinite(off.x)) {
        out.x = off.x;
    }
    if (!isNull(off.y) && isFinite(off.y)) {
        out.y = off.y;
    }
    return out;
};

/** Has anything been moved at all? Decides whether the panel's Reset
 *  is worth offering. */
CsSheetSetup.anyMoved = function(offsets) {
    if (isNull(offsets)) {
        return false;
    }
    var k;
    for (k in offsets) {
        if (!offsets.hasOwnProperty(k) || !CsSheetSetup.isMovable(k)) {
            continue;
        }
        var off = CsSheetSetup.offsetOf(offsets, k);
        if (Math.abs(off.x) > 1e-9 || Math.abs(off.y) > 1e-9) {
            return true;
        }
    }
    return false;
};

/** `offsets` with one piece moved a further dx, dy INCHES. Answers a
 *  new object; the one passed in is never written to, so a drag in
 *  progress can be thrown away by forgetting its result. */
CsSheetSetup.withOffset = function(offsets, kind, dxInches, dyInches) {
    var out = {};
    var k;
    if (!isNull(offsets)) {
        for (k in offsets) {
            if (offsets.hasOwnProperty(k)) {
                out[k] = { x: CsSheetSetup.offsetOf(offsets, k).x,
                           y: CsSheetSetup.offsetOf(offsets, k).y };
            }
        }
    }
    var was = CsSheetSetup.offsetOf(offsets, kind);
    out[kind] = { x: was.x + dxInches, y: was.y + dyInches };
    return out;
};

/**
 * The margin rectangle inside one sheet: the line a map is kept inside
 * so it can be bound, trimmed and held.
 *
 * Drawn DASHED in the preview and never on the sheet itself -- it is a
 * guide, not furniture, which is why previewFits skips it.
 */
CsSheetSetup.marginBox = function(sheetBox) {
    var m = isNull(sheetBox.margin) ? 0 : sheetBox.margin;
    return { minX: sheetBox.minX + m, minY: sheetBox.minY + m,
             maxX: sheetBox.maxX - m, maxY: sheetBox.maxY - m };
};

/**
 * A rectangle cut into dashes, as [{x1, y1, x2, y2}].
 *
 * The preview document is built from scratch every repaint and holds no
 * linetype table worth the name, so the dashes are GEOMETRY. That also
 * makes the margin outline testable: a dashed line either has the right
 * segments or it does not.
 */
CsSheetSetup.dashRect = function(box, dashLength) {
    var out = [];
    var len = (isNull(dashLength) || !(dashLength > 0)) ? 1 : dashLength;
    var run = function(x1, y1, x2, y2) {
        var dx = x2 - x1, dy = y2 - y1;
        var total = Math.sqrt(dx * dx + dy * dy);
        if (!(total > 0)) {
            return;
        }
        var ux = dx / total, uy = dy / total;
        var at = 0;
        while (at < total) {
            var end = Math.min(at + len, total);
            out.push({ x1: x1 + ux * at, y1: y1 + uy * at,
                       x2: x1 + ux * end, y2: y1 + uy * end });
            at = end + len;   // one dash, one gap
        }
    };
    run(box.minX, box.minY, box.maxX, box.minY);
    run(box.maxX, box.minY, box.maxX, box.maxY);
    run(box.maxX, box.maxY, box.minX, box.maxY);
    run(box.minX, box.maxY, box.minX, box.minY);
    return out;
};

/**
 * Which piece is under a point, or null.
 *
 * TOPMOST FIRST, which is the order they were added in reverse: the
 * title block sits inside the cave's own footprint on nearly every map,
 * and a caver reaching for the title block is not reaching for the
 * thousand-foot rectangle behind it.
 *
 * `pad` widens the catch, in drawing units, so a north arrow four
 * tenths of an inch wide can still be grabbed.
 */
CsSheetSetup.pickAt = function(preview, x, y, pad) {
    if (isNull(preview) || isNull(preview.items)) {
        return null;
    }
    var grow = (isNull(pad) || !(pad > 0)) ? 0 : pad;
    for (var i = preview.items.length - 1; i >= 0; i--) {
        var item = preview.items[i];
        if (!CsSheetSetup.isMovable(item.kind)) {
            continue;
        }
        var b = item.box;
        if (x >= b.minX - grow && x <= b.maxX + grow &&
                y >= b.minY - grow && y <= b.maxY + grow) {
            return item;
        }
    }
    return null;
};

/**
 * The lines a dragged piece may snap to, in DRAWING units.
 *
 * The paper's own edges, the margin, and every other piece's edges and
 * middle -- which is what "line the bar up under the title block" and
 * "centre the arrow on the page" both mean. The piece being dragged is
 * left out: a box cannot snap to itself.
 */
CsSheetSetup.snapLines = function(preview, kind) {
    var out = { xs: [], ys: [], xMid: [], yMid: [] };
    if (isNull(preview) || isNull(preview.items)) {
        return out;
    }
    var push = function(list, v) {
        if (list.indexOf(v) === -1) { list.push(v); }
    };
    for (var i = 0; i < preview.items.length; i++) {
        var item = preview.items[i];
        if (item.kind === kind) {
            continue;
        }
        // The viewport lines up with the sheets (their map areas and the
        // match lines); the furniture does not line up with the OTHER
        // sheets, which carry their own copies of it.
        if (kind !== "cave" && (item.kind === "tile" ||
                item.kind === "tile-margin" || item.kind === "matchline")) {
            continue;
        }
        var b = item.box;
        push(out.xs, b.minX);
        push(out.xs, b.maxX);
        push(out.ys, b.minY);
        push(out.ys, b.maxY);
        // MIDLINES ARE KEPT APART from the edges, and `xs`/`ys` carry
        // them too so an EDGE may still land on one. The separate list
        // is what lets a centring snap win a tie: see snapMove.
        push(out.xMid, (b.minX + b.maxX) / 2);
        push(out.yMid, (b.minY + b.maxY) / 2);
        push(out.xs, (b.minX + b.maxX) / 2);
        push(out.ys, (b.minY + b.maxY) / 2);
    }
    return out;
};

/**
 * A drag, pulled onto the nearest edge it nearly hit.
 *
 * Each axis is decided on its own -- an edge that lines up vertically
 * should not have to give up its horizontal place to say so -- and what
 * comes back names the line it took, so the preview can draw it and the
 * caver can see WHY the piece stopped where it did.
 *
 * \param box   where the piece sits now, before this drag
 * \param dx,dy the drag, in drawing units
 * \param lines from CsSheetSetup.snapLines
 * \param tol   how near counts, in drawing units
 * \return {dx, dy, guideX, guideY, centredX, centredY} -- the guides
 *         null when nothing was near enough, and the centred flags true
 *         when the piece was pulled onto a MIDLINE rather than an edge,
 *         so the panel can say so and draw the guide differently.
 */
CsSheetSetup.snapMove = function(box, dx, dy, lines, tol) {
    var out = { dx: dx, dy: dy, guideX: null, guideY: null,
        centredX: false, centredY: false };
    if (isNull(lines) || !(tol > 0)) {
        return out;
    }
    var midX = (box.minX + box.maxX) / 2 + dx;
    var midY = (box.minY + box.maxY) / 2 + dy;
    var best = function(edges, candidates) {
        var pick = null;
        if (isNull(candidates)) {
            return null;
        }
        for (var e = 0; e < edges.length; e++) {
            for (var c = 0; c < candidates.length; c++) {
                var gap = candidates[c] - edges[e];
                if (Math.abs(gap) > tol) {
                    continue;
                }
                if (pick === null || Math.abs(gap) < Math.abs(pick.gap)) {
                    pick = { gap: gap, line: candidates[c] };
                }
            }
        }
        return pick;
    };
    // CENTRING WINS A TIE (Nathan, 2026-09-14). "Put the scale bar in
    // the middle of the page" is the snap a cartographer most wants and
    // the one hardest to hit by hand -- and a page's midline usually
    // has another piece's edge somewhere near it, which would otherwise
    // grab the drag first and leave the bar a hair off centre. So the
    // MIDDLE of the dragged box is offered the midlines on their own
    // before everything is considered together.
    var axis = function(edges, mid, mids, all) {
        var centred = best([mid], mids);
        if (centred !== null) {
            return { gap: centred.gap, line: centred.line, centred: true };
        }
        var any = best(edges, all);
        if (any === null) {
            return null;
        }
        return { gap: any.gap, line: any.line, centred: false };
    };
    var x = axis([box.minX + dx, box.maxX + dx, midX], midX,
        lines.xMid, lines.xs);
    if (x !== null) {
        out.dx = dx + x.gap;
        out.guideX = x.line;
        out.centredX = x.centred;
    }
    var y = axis([box.minY + dy, box.maxY + dy, midY], midY,
        lines.yMid, lines.ys);
    if (y !== null) {
        out.dy = dy + y.gap;
        out.guideY = y.line;
        out.centredY = y.centred;
    }
    return out;
};

// ---------------------------------------------------------------------
// THE PREVIEW.
//
// Pure: it answers rectangles, and the panel paints them. A caver
// choosing paper and scale is answering "will this fit, and where will
// everything sit", and answering that by building the file and looking
// is a slow way to find out you wanted the next size up.
//
// ROUGH ON PURPOSE. The boxes are where things go, not what they look
// like: a title block is a block, the cave is its own footprint, the
// elevation is its bands. A preview that tried to be the drawing would
// be the drawing, slowly.
// ---------------------------------------------------------------------

/**
 * Every rectangle a sheet layout puts on the paper, in DRAWING units.
 *
 * \param state {
 *   caveBox      the plan's own extents
 *   sheet        a row from CsSheetSetup.SHEETS
 *   scale        feet per inch
 *   turned       paper turned?
 *   footerInches how tall the furniture band is
 *   wants        {border, bar, north, title}
 *   offsets      {kind: {x, y}} -- hand-arranged moves, in INCHES of
 *                paper, for the pieces in CsSheetSetup.MOVABLE
 *   declination  the latest trip's declination, so the north box
 *                covers the magnetic arm the sheet will draw
 *   elevation    true to include the second sheet
 *   bands        [{minX, minY, maxX, maxY}] the elevation's own boxes
 * }
 *
 * \return { bounds: {minX, minY, maxX, maxY}, items: [{kind, box}] }
 *
 * `kind` is one of "sheet", "elevation-sheet", "margin", "cave",
 * "title", "bar", "north", "band" -- the panel colours by it and the
 * tests read it.
 */
CsSheetSetup.preview = function(state) {
    var out = { bounds: null, items: [] };
    if (isNull(state) || isNull(state.caveBox) || isNull(state.sheet)) {
        return out;
    }
    var scale = state.scale;
    var wants = isNull(state.wants) ? {} : state.wants;
    // TILED: the cave overflows one sheet, so it is laid over a grid
    // (CsSheetTile). The furniture is shown once, on the first sheet --
    // every sheet gets the same arrangement, so one is the picture of all.
    var tl = state.tileLayout;
    var tiled = !isNull(tl) && tl.tooMany !== true && tl.tiles.length > 0;
    // THE FURNITURE'S OWN LAYOUT (see CsSheetSetup.furniture): sized
    // boxes packed under the map, none outside the margin and none on
    // another. When the caller knows the title block's height the band
    // under the map is whatever that layout needs; older callers that
    // only know a footer keep theirs.
    var paperTurned = tiled ? tl.turned === true : state.turned === true;
    var reading = isNull(state.declination) ? null :
        { declination: state.declination,
            date: isNull(state.declinationDate) ? "" : state.declinationDate };
    var titleHeight = !isNull(state.titleHeight) ? state.titleHeight :
        Math.max(0.5, (isNull(state.footerInches) ? 2 :
            state.footerInches) - 0.2);
    var fur = CsSheetSetup.furniture({
        widthInches: paperTurned ? state.sheet.h : state.sheet.w,
        wants: wants, titleHeight: titleHeight, reading: reading });
    var footerUsed = isNull(state.titleHeight) ? state.footerInches :
        fur.footer;
    // THE VIEWPORT IS WHAT MOVES. The sheet the cartographer placed stays
    // where it is on the screen and the cave -- the blue box -- slides
    // over it; sheets are created beside it wherever the cave spills past
    // its margin. The layout was worked out in the cave's own frame (the
    // paper slid the other way by the drag), so it is shifted back here
    // to keep that sheet still.
    var drag = CsSheetSetup.offsetOf(state.offsets, "cave");
    var tx = tiled ? drag.x * scale : 0, ty = tiled ? drag.y * scale : 0;
    var moved = function(b) {
        var r = {};
        for (var key in b) {
            if (b.hasOwnProperty(key)) { r[key] = b[key]; }
        }
        r.minX = b.minX + tx; r.maxX = b.maxX + tx;
        r.minY = b.minY + ty; r.maxY = b.maxY + ty;
        return r;
    };
    // The paper shown, with the furniture on it, is the TITLE sheet's (A1,
    // the north-west one): it is the only sheet with the whole set, and
    // the others carry just a scale bar and a north arrow in the same
    // places.
    var primary = null;
    if (tiled) {
        primary = tl.tiles[0];
        for (var pk = 0; pk < tl.tiles.length; pk++) {
            if (tl.tiles[pk].title === true) { primary = tl.tiles[pk]; }
        }
    }
    // the paper drawn is the viewport's own cell, so it stands still while the cave is dragged
    var box = tiled ? moved(isNull(tl.origin) ? primary.paper : tl.origin.paper) :
        CsSheetSetup.borderBox(state.caveBox, state.sheet, scale,
            state.turned === true, footerUsed);

    // EVERY MOVABLE PIECE IS ADDED THROUGH ITS OWN OFFSET. A drag is
    // remembered in inches of paper, so it survives a scale step and a
    // paper change -- and the drawn sheet reads the same numbers, which
    // is what makes the preview a preview rather than a picture.
    var add = function(kind, minX, minY, maxX, maxY) {
        var off = CsSheetSetup.offsetOf(state.offsets, kind);
        var dx = off.x * scale, dy = off.y * scale;
        out.items.push({ kind: kind,
            box: { minX: minX + dx, minY: minY + dy,
                   maxX: maxX + dx, maxY: maxY + dy } });
    };

    add("sheet", box.minX, box.minY, box.maxX, box.maxY);
    // THE MARGIN, DASHED. The band a map is kept out of so it can be
    // bound and trimmed -- invisible until now, which is why furniture
    // dragged by hand had nothing to be square with.
    var planMargin = CsSheetSetup.marginBox(box);
    add("margin", planMargin.minX, planMargin.minY,
        planMargin.maxX, planMargin.maxY);
    add("cave", state.caveBox.minX, state.caveBox.minY,
        state.caveBox.maxX, state.caveBox.maxY);
    if (tiled) {
        // EVERY SHEET'S MAP AREA, named by its place in the grid. Only the
        // title sheet is drawn as paper (with the furniture on it): the
        // papers overlap by their footers, so drawing all of them buries
        // each sheet's name under the next one's furniture.
        for (var ti = 0; ti < tl.tiles.length; ti++) {
            var mp = moved(tl.tiles[ti].map);
            add("tile", mp.minX, mp.minY, mp.maxX, mp.maxY);
            if (tl.tiled === true) {
                out.items[out.items.length - 1].label = tl.tiles[ti].id;
            }
        }
        var ml = Math.max(scale * 0.03, 1e-6);
        for (var mi = 0; mi < tl.matchLines.length; mi++) {
            var line = tl.matchLines[mi];
            add("matchline", Math.min(line.x1, line.x2) + tx - ml,
                Math.min(line.y1, line.y2) + ty - ml,
                Math.max(line.x1, line.x2) + tx + ml,
                Math.max(line.y1, line.y2) + ty + ml);
        }
        out.tiled = true;
        var unionBox = { minX: Infinity, minY: Infinity, maxX: -Infinity,
            maxY: -Infinity };
        for (var ui = 0; ui < tl.tiles.length; ui++) {
            var um = tl.tiles[ui].map;
            unionBox.minX = Math.min(unionBox.minX, um.minX + tx);
            unionBox.minY = Math.min(unionBox.minY, um.minY + ty);
            unionBox.maxX = Math.max(unionBox.maxX, um.maxX + tx);
            unionBox.maxY = Math.max(unionBox.maxY, um.maxY + ty);
        }
        out.tileUnion = unionBox;
    }

    var inch = function(v) { return v * scale; };
    // Each piece is a box at a place in inches from the margin box's
    // lower left corner -- the same numbers the drawn sheet reads.
    var fx = box.minX + box.margin, fy = box.minY + box.margin;
    var piece = function(kind) {
        var p = fur.pieces[kind];
        if (isNull(p)) { return; }
        add(kind, fx + inch(p.x), fy + inch(p.y),
            fx + inch(p.x + p.w), fy + inch(p.y + p.h));
    };
    if (wants.title === true) { piece("title"); }
    if (wants.bar === true) { piece("bar"); }
    if (wants.north === true) { piece("north"); }

    if (state.elevation === true) {
        var planFor = box;
        if (tiled) {
            // below the WHOLE grid, one sheet in size
            planFor = { minX: tl.span.minX + tx, maxX: tl.span.minX + tx + box.width,
                minY: tl.span.minY + ty, maxY: tl.span.minY + ty + box.height,
                width: box.width, height: box.height, footer: box.footer,
                margin: box.margin };
        }
        var second = CsSheetSetup.elevationSheetBox(planFor, scale);
        add("elevation-sheet", second.minX, second.minY,
            second.maxX, second.maxY);
        var elevMargin = CsSheetSetup.marginBox(second);
        add("margin", elevMargin.minX, elevMargin.minY,
            elevMargin.maxX, elevMargin.maxY);
        var bands = isNull(state.bands) ? [] : state.bands;
        if (bands.length > 0) {
            // The bands as they will land: the region keeps its own
            // stacking and is slid into the sheet's top-left inset,
            // which is exactly what SheetSetup.moveElevation does.
            var bMinX = null, bMaxY = null;
            for (var i = 0; i < bands.length; i++) {
                if (bMinX === null || bands[i].minX < bMinX) {
                    bMinX = bands[i].minX;
                }
                if (bMaxY === null || bands[i].maxY > bMaxY) {
                    bMaxY = bands[i].maxY;
                }
            }
            var inset = (second.maxX - second.minX) *
                CsSheetSetup.BAND_INSET_FRACTION;
            var dx = (second.minX + inset) - bMinX;
            var dy = (second.maxY - inset) - bMaxY;
            for (i = 0; i < bands.length; i++) {
                // A CHUNK GETS ITS OWN KIND, so its own entry in
                // state.offsets and its own drag: `add()` above already
                // looks up CsSheetSetup.offsetOf(state.offsets, kind)
                // per kind, so a unique "band:<key>" per chunk is the
                // whole mechanism -- see CsSheetSetup.isMovable. A
                // non-chunked elevation (extended/projected) keeps the
                // single shared "band" kind it has always had.
                var bandKind = (state.chunked === true &&
                    !isNull(bands[i].key)) ?
                    ("band:" + bands[i].key) : "band";
                add(bandKind, bands[i].minX + dx, bands[i].minY + dy,
                    bands[i].maxX + dx, bands[i].maxY + dy);
                if (bandKind !== "band" && !isNull(bands[i].label)) {
                    out.items[out.items.length - 1].label = bands[i].label;
                }
            }
        }
    }

    for (var k = 0; k < out.items.length; k++) {
        var b = out.items[k].box;
        if (out.bounds === null) {
            out.bounds = { minX: b.minX, minY: b.minY,
                maxX: b.maxX, maxY: b.maxY };
        } else {
            out.bounds.minX = Math.min(out.bounds.minX, b.minX);
            out.bounds.minY = Math.min(out.bounds.minY, b.minY);
            out.bounds.maxX = Math.max(out.bounds.maxX, b.maxX);
            out.bounds.maxY = Math.max(out.bounds.maxY, b.maxY);
        }
    }
    return out;
};

/**
 * Does everything the preview holds actually sit on its own paper?
 *
 * The one question a preview exists to answer before a file is built.
 * A band hanging off the elevation sheet is the common way to be wrong:
 * the elevation is drawn at the plan's scale and does not shrink to
 * fit, so a long cave overruns and the answer is bigger paper.
 */
CsSheetSetup.previewFits = function(preview) {
    var sheets = [];
    var i, item;
    for (i = 0; i < preview.items.length; i++) {
        item = preview.items[i];
        if (item.kind === "sheet" || item.kind === "elevation-sheet" ||
                item.kind === "tile") {
            sheets.push(item.box);
        }
    }
    var out = { fits: true, spilling: [] };
    for (i = 0; i < preview.items.length; i++) {
        item = preview.items[i];
        if (item.kind === "sheet" || item.kind === "elevation-sheet" ||
                item.kind === "margin" || item.kind === "tile" ||
                item.kind === "tile-margin" || item.kind === "matchline") {
            // A MARGIN IS A GUIDE, NOT A PIECE. It is drawn inside its
            // own sheet by construction, and counting it would make the
            // answer "everything fits" say nothing.
            continue;
        }
        var inside = false;
        // A TILED CAVE SPANS SHEETS BY DESIGN: it only has to lie
        // within the grid, not within any one sheet.
        if (item.kind === "cave" && !isNull(preview.tileUnion) &&
                item.box.minX >= preview.tileUnion.minX - 0.001 &&
                item.box.maxX <= preview.tileUnion.maxX + 0.001 &&
                item.box.minY >= preview.tileUnion.minY - 0.001 &&
                item.box.maxY <= preview.tileUnion.maxY + 0.001) {
            inside = true;
        }
        for (var s = 0; s < sheets.length; s++) {
            if (item.box.minX >= sheets[s].minX - 0.001 &&
                    item.box.maxX <= sheets[s].maxX + 0.001 &&
                    item.box.minY >= sheets[s].minY - 0.001 &&
                    item.box.maxY <= sheets[s].maxY + 0.001) {
                inside = true;
            }
        }
        if (!inside) {
            out.fits = false;
            if (out.spilling.indexOf(item.kind) === -1) {
                out.spilling.push(item.kind);
            }
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// WHAT THE TITLE BLOCK CAN BE TOLD WITHOUT ASKING.
//
// Everything below reads the survey the drawing already holds. Nothing
// is invented, and one field is deliberately never filled in at all --
// see locationFor.
// ---------------------------------------------------------------------

/** "2024-04-06 to 2024-11-03", or the one date, or "". */
CsSheetSetup.datesFor = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return "";
    }
    var seen = [];
    for (var i = 0; i < survey.trips.length; i++) {
        var d = survey.trips[i].date;
        if (isNull(d) || String(d) === "") {
            continue;
        }
        if (seen.indexOf(String(d)) === -1) {
            seen.push(String(d));
        }
    }
    if (seen.length === 0) {
        return "";
    }
    seen.sort();
    return seen.length === 1 ? seen[0] :
        (seen[0] + " to " + seen[seen.length - 1]);
};

/**
 * Everyone who appears on a trip team, in the order they first
 * surveyed, comma separated.
 *
 * EVERY name, never a count and never "and others". The people who
 * carried the tape are the reason the map exists, and a map that
 * credits three of nine is a map that has picked favourites. A team
 * field too long for the title block is a layout problem, and layout
 * problems are the cartographer's to solve.
 */
CsSheetSetup.surveyedByFor = function(survey) {
    if (isNull(survey) || isNull(survey.trips)) {
        return "";
    }
    var names = [];
    for (var i = 0; i < survey.trips.length; i++) {
        var team = survey.trips[i].team;
        if (isNull(team) || String(team) === "") {
            continue;
        }
        var parts = String(team).split(",");
        for (var p = 0; p < parts.length; p++) {
            var name = parts[p].replace(/^\s+|\s+$/g, "");
            if (name !== "") {
                names.push(name);
            }
        }
    }
    return CsSheetSetup.dedupeNames(names).join(", ");
};

/**
 * A crew list with each person once.
 *
 * Eleven trips list their parties by hand, so one caver turns up as
 * "Nathan Schonegg", "NATHAN SCHONEGG", and sometimes just "Nathan" -- and
 * a credit line reading "..., RHONDA, ADAM, RHONDA MATTESON, ADAM
 * STANICH, NATHAN SCHONEGG" credits three people twice (Nathan, 2026-10-04:
 * "you need to dedupe the names in the list").
 *
 * TWO NAMES ARE THE SAME PERSON when they match ignoring case, spacing and
 * full stops, OR when the shorter is a first name (or "Nathan S.") that
 * fits exactly ONE longer name in the list. If two longer names fit -- two
 * Adams -- the short one is left alone: guessing which Adam is how a
 * surveyor is credited with someone else's work. Different spellings
 * ("Jeanna" and "Jeanne") are never merged; that is a person's call.
 *
 * The first spelling seen is the one kept, and the order is the order
 * names first appeared.
 */
CsSheetSetup.dedupeNames = function(names) {
    var key = function(n) {
        return String(n).replace(/\./g, " ").replace(/\s+/g, " ")
            .replace(/^\s+|\s+$/g, "").toLowerCase();
    };
    // exact duplicates first, first spelling wins
    var seen = {};
    var unique = [];
    for (var i = 0; i < names.length; i++) {
        var k = key(names[i]);
        if (k === "" || seen.hasOwnProperty(k)) { continue; }
        seen[k] = true;
        unique.push({ name: String(names[i]).replace(/\s+/g, " ")
            .replace(/^\s+|\s+$/g, ""),
            tokens: k.split(" ") });
    }
    // does the shorter name fit inside the longer one, token for token in
    // order, a one-letter token standing for any name that starts with it?
    var fits = function(shortT, longT) {
        if (shortT.length > longT.length || (shortT.length === longT.length &&
                shortT.join(" ") === longT.join(" "))) {
            return false;
        }
        var at = 0;
        for (var s = 0; s < shortT.length; s++) {
            var found = false;
            while (at < longT.length) {
                var t = longT[at++];
                if (t === shortT[s] ||
                        (shortT[s].length === 1 && t.charAt(0) === shortT[s])) {
                    found = true;
                    break;
                }
            }
            if (!found) { return false; }
        }
        // the first token must match too: "Adam" is Adam Stanich, not
        // somebody whose SECOND name happens to be Adam
        return longT[0] === shortT[0] ||
            (shortT[0].length === 1 && longT[0].charAt(0) === shortT[0]);
    };
    var gone = {};
    for (var a = 0; a < unique.length; a++) {
        var candidates = 0;
        for (var b = 0; b < unique.length; b++) {
            if (a !== b && !gone[b] && fits(unique[a].tokens, unique[b].tokens)) {
                candidates++;
            }
        }
        if (candidates === 1) { gone[a] = true; }
    }
    var out = [];
    for (var o = 0; o < unique.length; o++) {
        if (!gone[o]) { out.push(unique[o].name); }
    }
    return out;
};

/**
 * THE LOCATION FIELD IS NEVER FILLED IN BY THIS TOOL. It answers the
 * empty string, always, and the tool prints the field with nothing in
 * it for a human to complete.
 *
 * This is the suite's first rule, in the one place most likely to break
 * it: the drawing usually knows exactly where the cave is (the geo
 * anchor, the aerial imagery it fetched), and the title block asks for
 * a location. Filling it automatically would put an entrance's
 * coordinates on every sheet anybody plotted, forever, without one
 * decision being made by a person.
 *
 * A cartographer who wants "SMITH COUNTY, TENNESSEE" on the sheet types
 * it. That is one sentence of work and a deliberate act.
 */
CsSheetSetup.locationFor = function() {
    return "";
};

/** What this tool can fill in, as { fieldId: value }. Fields it has no
 *  answer for are absent rather than blank, so a value already typed
 *  into the drawing is never overwritten with nothing. */
CsSheetSetup.autoFill = function(survey, stats, grade) {
    var out = {};
    if (!isNull(survey)) {
        var name = survey.caveName || survey.name || "";
        if (String(name) !== "") {
            out.caveName = String(name);
        }
        var by = CsSheetSetup.surveyedByFor(survey);
        if (by !== "") {
            out.surveyedBy = by;
        }
        var dates = CsSheetSetup.datesFor(survey);
        if (dates !== "") {
            out.date = dates;
        }
    }
    if (!isNull(stats) && !isNull(survey)) {
        var unit = survey.distanceUnit || "ft";
        out.length = CsReport.length(stats.surveyedLength, unit);
        out.depth = CsReport.length(stats.depth, unit);
    }
    if (!isNull(grade) && !isNull(grade.uis) && String(grade.uis) !== "") {
        out.surveyCode = String(grade.uis);
    }
    return out;
};

/**
 * Is the middle button STILL down, given the buttons mask a move event
 * reported?
 *
 * WHY A PAN NEEDS ASKING. The middle-drag pan lives in a field
 * (`panFrom` on the view) that only mouseReleaseEvent clears, and a
 * release that never arrives leaves that field set: the preview then
 * keeps following the mouse with no button held at all, and the only
 * way out is another middle click. Releases DO go missing here -- the
 * middle press is deliberately not chained to the base handler (the
 * navigation action would pan a second time on the same drag), so the
 * view is never the one Qt considers to be dragging, and a release
 * delivered to another widget, or eaten by the window manager on a
 * middle-drag, never reaches the override.
 *
 * So every move re-checks the buttons it was handed instead of trusting
 * the field. Pure arithmetic on a mask so it can be tested without a
 * live view: a bridge that cannot report buttons hands in null, and
 * that case has to stay true or the pan would stop on its first step.
 *
 * \param mask   Qt buttons mask off the move event, or null/undefined
 *               when this bridge cannot report one.
 * \param button The button the gesture is held with -- Qt.MidButton for
 *               the pan, Qt.LeftButton for a piece drag. Passed in so
 *               the test does not need Qt loaded; defaults to 4, which
 *               is Qt.MidButton everywhere this runs.
 */
CsSheetSetup.panHeld = function(mask, button) {
    if (mask === null || mask === undefined || isNaN(mask)) {
        return true;
    }
    var bit = (button === null || button === undefined || isNaN(button)) ?
        4 : button;
    return (mask & bit) !== 0;
};

/**
 * The identity of one frame of a drag: what the preview would draw.
 *
 * WHY A DRAG NEEDS ONE. Every reported move redraws the whole layout,
 * and a SNAPPED move reports a position that does not change: the piece
 * is pinned to the guide while the mouse wanders inside the snap
 * tolerance. Those frames used to redraw anyway -- the same picture,
 * tens of times a second, each one rebuilding the scratch document --
 * which is exactly when the panel beachballed, right as a piece "wanted
 * to" snap. Comparing this key first throws that work away.
 *
 * The rounding is deliberate: the offset is carried in inches of paper
 * and nothing in the preview can show a ten-thousandth of an inch, so
 * two positions that round together ARE the same picture.
 */
CsSheetSetup.dragKey = function(kind, snapped) {
    if (isNull(snapped)) {
        return null;
    }
    var r = function(v) {
        if (v === null || v === undefined || isNaN(v)) {
            return "-";
        }
        return Math.round(v * 10000) / 10000;
    };
    return [String(kind), r(snapped.dx), r(snapped.dy),
        r(snapped.guideX), r(snapped.guideY),
        snapped.centredX === true, snapped.centredY === true].join("|");
};
