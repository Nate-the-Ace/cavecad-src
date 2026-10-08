// CsTherion2.js -- Therion .th2 reader: the DRAWING half of a survey.
//
// Part of the Cave Survey Core library: pure functions, no document and
// no GUI, so tests/js_unit.js runs all of it under node.
//
// WHY THIS EXISTS. CsTherion.js reads the numbers and says plainly that
// it skips scrap/endscrap -- "A .th2 file is Therion's DRAWING half and
// carries no centreline at all; it is not claimed by the registry."
// That left a caver who sketched the whole cave on a phone importing a
// bare centreline and then re-tracing, by hand, a photograph of a
// sketch they had already drawn in vector. This file takes the sketch.
//
// NOT IN THE REGISTRY, for the reason that header gives: the registry
// answers "which survey reader claims this file", and the answer for a
// .th2 is none of them. ImportCaveSurvey reaches this reader directly,
// after the .th has been read.
//
// WHAT COMES OUT is a neutral sketch model -- see the parse docblock.
// No Therion word leaks past this file: CsSketch.js owns the mapping
// from th2's vocabulary onto layers, symbols, shaped lines and areas,
// and everything downstream of that speaks only CaveCAD's own names.
//
// BEZIER STAYS BEZIER. A th2 line segment is a cubic: one point per
// line for a straight run, six numbers for a curved one. Flattening
// those at read time would throw the curve away before anything has
// decided how to draw it, and what draws them writes a spline from the
// control points rather than pushing the path through CsTrace.resample
// -- that function exists to tame a freehand drag, and a vector sketch
// is not one.
//
// THE TOKENIZER IS CsFormatTherion'S. Same lexical rules, quotes and
// bracket groups included, and the same backslash continuation: two
// dialects of one format deserve one lexer, and a .th2's -scale
// [0 0 100 0 0 0 5 0 m] needs exactly the bracket handling the .th
// reader already has for -projection [elevation 90].
//
// REFUSALS, and they are findings rather than silence (the channel
// every import report already prints):
//   input       -- a split Therion project. Same reason the .th reader
//                  refuses it: a cave silently missing half its
//                  passages is the worst failure a reader can have.
//   xth_me_image_insert -- a raster underlay pinned into the sketch.
//                  Sketch Scans owns rasters, and it owns them better:
//                  it can fit one on the stations interactively.
//   -projection elevation -- a PROJECTED elevation is not an EXTENDED
//                  one. The suite's profile is extended, and bending a
//                  projected scrap along the developed axis would be
//                  wrong in a way that looks right.
//
// Unknown line/point/area TYPES are reported and kept, not refused.
// Therion's vocabulary grows with every release, and a sketch missing
// its walls is a worse outcome than one with a stray line on a
// catch-all layer.

var CsTherion2 = {};

// The projections a scrap can declare. "none" is Therion's own word
// for a cross section -- a drawing in no projection at all.
CsTherion2.PROJECTIONS = { plan: 1, extended: 1, elevation: 1, none: 1 };

/**
 * Records something worth telling the caver about the file.
 *
 * Deliberately the same shape and the same dedupe rule as
 * CsModel.addParseFinding, so an import report can print scrap
 * findings and centreline findings in one list without translating
 * between two idioms. Not that function itself: a sketch model is not
 * a survey, and giving this file a dependency on CsModel to reach one
 * six-line helper would be the wrong trade.
 *
 * \param model the sketch model.
 * \param severity "error" | "warning" | "info".
 * \param code a stable machine-readable code.
 * \param message the sentence a caver reads.
 */
CsTherion2.addFinding = function(model, severity, code, message) {
    if (model.findings === undefined || model.findings === null) {
        model.findings = [];
    }
    for (var i = 0; i < model.findings.length; i++) {
        if (model.findings[i].code === code &&
                model.findings[i].message === message) {
            return;
        }
    }
    model.findings.push({ severity: severity, code: code,
        message: message });
};

/**
 * Reads a number the way this format writes them, or null.
 *
 * Strict on purpose: Therion writes plain decimals here, and a lenient
 * parseFloat would read "12abc" as 12 and put a vertex somewhere
 * nobody drew one.
 */
CsTherion2.number = function(token) {
    if (token === undefined || token === null) {
        return null;
    }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(token)) {
        return null;
    }
    var value = parseFloat(token);
    return isNaN(value) ? null : value;
};

/**
 * Splits a token list into its leading positional words and its
 * -option values.
 *
 * Therion options are "-name value" pairs, and a value may itself be a
 * bracket group (the tokenizer has already made that one token) or a
 * quoted string (likewise). An option with no value -- the last token
 * on the line -- is recorded as an empty string rather than dropped,
 * so a malformed line is visible to the caller instead of silently
 * shorter.
 *
 * \return {words: [...], opts: {name: value}}
 */
CsTherion2.options = function(tokens) {
    var words = [];
    var opts = {};
    var i = 0;
    while (i < tokens.length) {
        var token = tokens[i];
        // A negative number is not an option: "-3.5" is a coordinate,
        // and only a leading letter makes "-close" a switch.
        if (/^-[A-Za-z]/.test(token)) {
            var value = (i + 1 < tokens.length) ? tokens[i + 1] : "";
            opts[token.substring(1).toLowerCase()] = value;
            i += 2;
            continue;
        }
        words.push(token);
        i++;
    }
    return { words: words, opts: opts };
};

/**
 * Unwraps a "[a b c]" bracket token into its inner tokens.
 *
 * \return an array of strings; [] for anything not bracketed.
 */
CsTherion2.bracket = function(token) {
    if (token === undefined || token === null) {
        return [];
    }
    var text = ("" + token).replace(/^\s+|\s+$/g, "");
    if (text.charAt(0) !== "[") {
        return [];
    }
    var end = text.lastIndexOf("]");
    var inner = text.substring(1, end === -1 ? text.length : end);
    inner = inner.replace(/^\s+|\s+$/g, "");
    return inner === "" ? [] : inner.split(/\s+/);
};

/**
 * The scrap's own scale, as real units per scrap unit.
 *
 * Therion writes -scale in two dialects. The long one is a bracket of
 * eight numbers and a unit -- two points in SCRAP coordinates followed
 * by the same two points in REAL ones -- and the ratio of those two
 * distances is the answer. The short one is a bare number, which
 * Therion defines as real units per scrap unit directly.
 *
 * WHY IT MATTERS AT ALL, given that fitting on the stations recovers
 * the scale anyway: a scrap with exactly ONE station has no scale in
 * its tie points (one pair fixes a translation and nothing else), and
 * a cross section scrap usually has no stations at all. For those two
 * this is the only scale there is.
 *
 * \return {unitsPerDrawing, unit} or null when the scrap declares none
 *         or declares one this reader cannot read.
 */
CsTherion2.scale = function(token) {
    var direct = CsTherion2.number(token);
    if (direct !== null) {
        return direct > 0 ?
            { unitsPerDrawing: direct, unit: "m" } : null;
    }
    var parts = CsTherion2.bracket(token);
    if (parts.length < 8) {
        return null;
    }
    var n = [];
    for (var i = 0; i < 8; i++) {
        var value = CsTherion2.number(parts[i]);
        if (value === null) {
            return null;
        }
        n.push(value);
    }
    var scrapDist = Math.sqrt((n[2] - n[0]) * (n[2] - n[0]) +
        (n[3] - n[1]) * (n[3] - n[1]));
    var realDist = Math.sqrt((n[6] - n[4]) * (n[6] - n[4]) +
        (n[7] - n[5]) * (n[7] - n[5]));
    if (scrapDist <= 0 || realDist <= 0) {
        return null;
    }
    var unit = parts.length > 8 ? parts[8].toLowerCase() : "m";
    return { unitsPerDrawing: realDist / scrapDist, unit: unit };
};

/**
 * The projection a scrap declares, normalised.
 *
 * Both "-projection plan" and "-projection [elevation 90]" occur; the
 * bracket form carries the viewing azimuth as its second word.
 *
 * \return {projection, angle} -- angle null unless the file gave one.
 *         An unreadable projection comes back as {projection: null}.
 */
CsTherion2.projection = function(token) {
    if (token === undefined || token === null || token === "") {
        return { projection: null, angle: null };
    }
    var parts = CsTherion2.bracket(token);
    if (parts.length === 0) {
        parts = [("" + token)];
    }
    var name = parts[0].toLowerCase();
    if (CsTherion2.PROJECTIONS[name] !== 1) {
        return { projection: null, angle: null };
    }
    var angle = parts.length > 1 ? CsTherion2.number(parts[1]) : null;
    return { projection: name, angle: angle };
};

/**
 * Reads one coordinate line inside a line block into a segment.
 *
 * Two shapes, and the count of numbers is what tells them apart:
 *   x y                        a straight run to (x, y)
 *   c1x c1y c2x c2y x y        a cubic with two control points
 *
 * The FIRST segment of a line block is its start point and carries no
 * control points by definition -- a curve needs somewhere to curve
 * from -- so a six-number first line is read as its last pair, with
 * the controls dropped. Therion does not write one.
 *
 * \return {to, c1, c2} or null when the line is not coordinates.
 */
CsTherion2.segment = function(tokens, isFirst) {
    var n = [];
    for (var i = 0; i < tokens.length; i++) {
        var value = CsTherion2.number(tokens[i]);
        if (value === null) {
            return null;
        }
        n.push(value);
    }
    if (n.length === 2) {
        return { to: [n[0], n[1]], c1: null, c2: null };
    }
    if (n.length === 6) {
        if (isFirst) {
            return { to: [n[4], n[5]], c1: null, c2: null };
        }
        return { to: [n[4], n[5]], c1: [n[0], n[1]], c2: [n[2], n[3]] };
    }
    return null;
};

/**
 * Whether an option value means yes.
 *
 * Therion's switches are "on"/"off", and a bare "-close" with nothing
 * after it (our options() records that as "") means on, because a
 * caver who typed the switch meant to turn something on.
 */
CsTherion2.isOn = function(value) {
    if (value === undefined || value === null) {
        return false;
    }
    var text = ("" + value).toLowerCase();
    return text === "" || text === "on" || text === "1" ||
        text === "true" || text === "yes";
};

/**
 * Reads a .th2 file into the neutral sketch model.
 *
 * THE MODEL:
 *
 *   { scraps: [ {
 *       name, projection, projectionAngle,
 *       scale: {unitsPerDrawing, unit} | null,
 *       stations: [ {name, x, y} ],
 *       lines:  [ {type, subtype, closed, reversed, id, options,
 *                  segs: [ {to, c1, c2} ] } ],
 *       areas:  [ {type, lineIds: [...], options} ],
 *       points: [ {type, x, y, orientation, scale, text, options} ],
 *       sections: [ {x, y, scrap} ]
 *     } ],
 *     findings: [ {severity, code, message} ] }
 *
 * STATIONS ARE NOT POINTS. A "point x y station -name 1.2" is the tie
 * between the sketcher's coordinates and the cave's, and it is pulled
 * out into its own list rather than left among the drawing's symbols:
 * the drawing already has stations, lettered its own way, and drawing
 * a second set over them would be a second opinion about where the
 * cave is.
 *
 * SECTIONS ARE NOT POINTS EITHER, for a related reason: a "point x y
 * section -scrap xs1" is a REFERENCE to another scrap, and it is the
 * only thing tying a cross section scrap -- which carries no stations
 * at all -- to a place in the cave.
 *
 * \param content the file's text.
 * \return the model above. Always an object; a file with nothing
 *         readable in it comes back with no scraps and a finding
 *         saying so, never null.
 */
CsTherion2.parse = function(content) {
    var model = { scraps: [], findings: [] };
    if (content === undefined || content === null || content === "") {
        CsTherion2.addFinding(model, "error", "th2-empty",
            "The sketch file is empty.");
        return model;
    }

    // BEFORE the lexer, and that is the point: ##XTHERION## metadata
    // opens with a # , so CsFormatTherion.splitComment strips the whole
    // line to nothing and no directive below can ever see one. That is
    // right for xtherion's editor state -- window sizes and zoom
    // levels, none of it the drawing -- but one of its commands has to
    // be answered, so it is looked for in the raw text.
    if (/xth_me_image_insert/.test(content)) {
        CsTherion2.addFinding(model, "warning", "th2-image",
            "The sketch pins a scanned image behind it. That image is " +
            "not imported: place it with Sketch Scans, which can fit " +
            "it on the stations.");
    }

    var lines = CsFormatTherion.logicalLines(content);
    var scrap = null;
    var line = null;         // the line block currently open
    var area = null;         // the area block currently open
    var firstSeg = true;

    for (var i = 0; i < lines.length; i++) {
        var text = lines[i].text;
        if (text === "") {
            continue;
        }

        var tokens = CsFormatTherion.tokenize(text);
        if (tokens.length === 0) {
            continue;
        }
        var cmd = tokens[0].toLowerCase();

        // ---- inside a line block -------------------------------
        if (line !== null) {
            if (cmd === "endline") {
                if (line.segs.length > 0) {
                    scrap.lines.push(line);
                }
                line = null;
                continue;
            }
            // An option line inside the block applies to the line.
            if (/^-[A-Za-z]/.test(tokens[0])) {
                var inner = CsTherion2.options(tokens);
                CsTherion2.applyLineOptions(line, inner.opts);
                continue;
            }
            var seg = CsTherion2.segment(tokens, firstSeg);
            if (seg !== null) {
                line.segs.push(seg);
                firstSeg = false;
                continue;
            }
            // "smooth off", "mark", "orientation" and the rest of the
            // per-point vocabulary: they refine a vertex we already
            // have, and none of them moves it. Passed over in silence
            // on purpose -- a finding per smoothing flag would bury
            // the findings that matter under thousands.
            continue;
        }

        // ---- inside an area block ------------------------------
        if (area !== null) {
            if (cmd === "endarea") {
                scrap.areas.push(area);
                area = null;
                continue;
            }
            if (cmd === "line" && tokens.length > 1) {
                area.lineIds.push(tokens[1]);
                continue;
            }
            if (/^-[A-Za-z]/.test(tokens[0])) {
                var areaOpts = CsTherion2.options(tokens);
                for (var key in areaOpts.opts) {
                    if (areaOpts.opts.hasOwnProperty(key)) {
                        area.options[key] = areaOpts.opts[key];
                    }
                }
            }
            continue;
        }

        // ---- top level and inside a scrap ----------------------
        if (cmd === "input") {
            CsTherion2.addFinding(model, "error", "th2-input",
                "This sketch pulls in another file (" +
                (tokens.length > 1 ? tokens[1] : "?") + "). Only what " +
                "is in this file is imported -- open the other file " +
                "separately.");
            continue;
        }

        if (cmd === "scrap") {
            if (scrap !== null) {
                // An unclosed scrap: keep what it had rather than
                // dropping a whole sketch over one missing endscrap.
                CsTherion2.addFinding(model, "warning", "th2-unclosed",
                    "Scrap \"" + scrap.name + "\" was never closed " +
                    "with endscrap. Everything read before the next " +
                    "scrap is kept.");
                model.scraps.push(scrap);
            }
            scrap = CsTherion2.beginScrap(model, tokens);
            continue;
        }

        if (cmd === "endscrap") {
            if (scrap !== null) {
                model.scraps.push(scrap);
                scrap = null;
            }
            continue;
        }

        if (scrap === null) {
            // encoding, ##XTHERION## handled above, stray commands:
            // nothing outside a scrap draws anything.
            continue;
        }

        if (cmd === "point") {
            CsTherion2.readPoint(scrap, tokens);
            continue;
        }

        if (cmd === "line") {
            line = CsTherion2.beginLine(tokens);
            firstSeg = true;
            continue;
        }

        if (cmd === "area") {
            var areaWords = CsTherion2.options(tokens.slice(1));
            area = { type: (areaWords.words.length > 0 ?
                    areaWords.words[0].toLowerCase() : "u:unknown"),
                lineIds: [], options: areaWords.opts };
            continue;
        }
    }

    if (line !== null && scrap !== null && line.segs.length > 0) {
        scrap.lines.push(line);
    }
    if (area !== null && scrap !== null) {
        scrap.areas.push(area);
    }
    if (scrap !== null) {
        CsTherion2.addFinding(model, "warning", "th2-unclosed",
            "Scrap \"" + scrap.name + "\" was never closed with " +
            "endscrap. Everything read before the end of the file is " +
            "kept.");
        model.scraps.push(scrap);
    }

    if (model.scraps.length === 0) {
        CsTherion2.addFinding(model, "error", "th2-no-scraps",
            "No scrap was found in this sketch file.");
    }

    return model;
};

/**
 * Opens a scrap from its "scrap <name> -options" line.
 *
 * A scrap whose projection this reader will not take is still
 * RETURNED, carrying projection null: refusing it here would lose the
 * scrap's own name, and the name is what the report has to print to
 * tell a caver which part of their sketch did not come in.
 */
CsTherion2.beginScrap = function(model, tokens) {
    var parsed = CsTherion2.options(tokens.slice(1));
    var name = parsed.words.length > 0 ? parsed.words[0] : "";
    var proj = CsTherion2.projection(parsed.opts.projection);

    if (parsed.opts.projection !== undefined && proj.projection === null) {
        CsTherion2.addFinding(model, "warning", "th2-projection",
            "Scrap \"" + name + "\" is drawn in a projection this " +
            "reader does not know (" + parsed.opts.projection +
            "). It is not imported.");
    } else if (proj.projection === "elevation") {
        CsTherion2.addFinding(model, "warning", "th2-projected-elevation",
            "Scrap \"" + name + "\" is a projected elevation. This " +
            "suite draws an EXTENDED elevation, which is a different " +
            "drawing of the same cave, so the scrap is not imported.");
    }

    return {
        name: name,
        // A scrap with no -projection at all is a plan: Therion's own
        // default, and the overwhelming majority of phone sketches.
        projection: parsed.opts.projection === undefined ? "plan" :
            proj.projection,
        projectionAngle: proj.angle,
        scale: CsTherion2.scale(parsed.opts.scale),
        options: parsed.opts,
        stations: [], lines: [], areas: [], points: [], sections: []
    };
};

/**
 * Opens a line block from its "line <type> -options" line.
 */
CsTherion2.beginLine = function(tokens) {
    var parsed = CsTherion2.options(tokens.slice(1));
    var line = {
        type: parsed.words.length > 0 ?
            parsed.words[0].toLowerCase() : "u:unknown",
        subtype: null, closed: false, reversed: false, id: null,
        options: {}, segs: []
    };
    CsTherion2.applyLineOptions(line, parsed.opts);
    return line;
};

/**
 * Folds an option dict onto a line, promoting the four that change
 * how it is DRAWN rather than merely what it is called.
 *
 * Options can appear both on the "line" command and on their own
 * inside the block, which is why this is a function and not four
 * assignments at the one call site.
 */
CsTherion2.applyLineOptions = function(line, opts) {
    for (var key in opts) {
        if (!opts.hasOwnProperty(key)) {
            continue;
        }
        var value = opts[key];
        line.options[key] = value;
        if (key === "subtype") {
            line.subtype = ("" + value).toLowerCase();
        } else if (key === "close") {
            line.closed = CsTherion2.isOn(value);
        } else if (key === "reverse") {
            line.reversed = CsTherion2.isOn(value);
        } else if (key === "id") {
            line.id = value;
        }
    }
};

/**
 * Reads a "point <x> <y> <type> -options" line into the scrap.
 *
 * Three destinations, and which one a point reaches is a statement
 * about what it IS (see the parse docblock): a station goes to the tie
 * list, a section reference to the sections list, and everything else
 * to the drawing's own points.
 */
CsTherion2.readPoint = function(scrap, tokens) {
    var parsed = CsTherion2.options(tokens.slice(1));
    if (parsed.words.length < 3) {
        return;
    }
    var x = CsTherion2.number(parsed.words[0]);
    var y = CsTherion2.number(parsed.words[1]);
    if (x === null || y === null) {
        return;
    }
    var type = parsed.words[2].toLowerCase();

    if (type === "station") {
        var stationName = parsed.opts.name;
        if (stationName === undefined || stationName === "") {
            return;     // a station marker naming no station ties
        }                // nothing, and is not a symbol either
        scrap.stations.push({ name: "" + stationName, x: x, y: y });
        return;
    }

    if (type === "section") {
        scrap.sections.push({ x: x, y: y,
            scrap: parsed.opts.scrap === undefined ? null :
                parsed.opts.scrap });
        return;
    }

    scrap.points.push({
        type: type, x: x, y: y,
        orientation: parsed.opts.orientation === undefined ? null :
            CsTherion2.number(parsed.opts.orientation),
        scale: parsed.opts.scale === undefined ? null :
            ("" + parsed.opts.scale).toLowerCase(),
        // -text is the caption on a label, a remark or a passage name;
        // -value is what an altitude or a passage-height measures.
        text: parsed.opts.text === undefined ?
            (parsed.opts.value === undefined ? null :
                "" + parsed.opts.value) : "" + parsed.opts.text,
        options: parsed.opts
    });
};
