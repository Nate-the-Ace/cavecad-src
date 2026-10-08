// CsCheck.js -- the map's own proofreader: the faults a beginner's
// first cave map has, found in the drawing and explained in the words
// that say why they matter.
//
// Part of the Cave Survey Core library. Every CHECK is a pure function
// over a `scan` -- a plain object -- so the checks are testable without
// a document; CsCheck.scan is the one half that needs QCAD.
//
// WHERE THE LINE IS. CsValidate reads the SURVEY: bad numbers, flipped
// backsights, a loop that will not close. This file reads the MAP: a
// sheet with no scale bar, a symbol on the wrong layer, a wall that
// stops a foot short of the wall it was meant to meet. The two never
// overlap, and a beginner needs both -- the survey can be perfect and
// the map still unreadable.
//
// NOR IS THIS REPAIR. RepairDrawing FIXES things (rebuilds tags,
// restyles layers, reattaches callout arrows) and says little about
// why. This says why and fixes NOTHING: a fault it names might be
// deliberate, and a tool that silently "corrected" a cartographer's
// choice would be worse than one that never spoke. Every finding is
// advisory, the same promise CsValidate makes.
//
// THREE SEVERITIES, in the words a student can act on:
//
//   "error"    the map is WRONG or unusable as it stands -- a sheet
//              with no scale, a symbol claiming to be something it is
//              not. Fix before anyone else reads it.
//   "warning"  the map is probably not what you meant -- a wall that
//              nearly closes, linework nowhere near the survey.
//   "note"     polish. True of a finished map, survivable without.
//
// Each finding:
//
//   { code, severity, title, why, count, at, layer }
//
//   code     short machine tag, stable, used by tests
//   title    what is wrong, one line, no jargon
//   why      why it matters -- the half a beginner does not have, and
//            the reason this tool exists rather than a checklist in a
//            document nobody opens
//   count    how many of this fault (1 for the sheet-wide ones)
//   at       {x, y} to show the caver, or null for a whole-sheet fault
//   layer    the layer it was found on, or "" for a sheet fault

var CsCheck = {};

// ---------------------------------------------------------------------
// THRESHOLDS. Named, for the reason CsValidate names its own: a number
// inline in a comparison gets nudged in a hurry, and what a suite
// complains about is exactly what drifts without anyone deciding it
// should. Each is pinned at its boundary in tests/js_unit.js.
// ---------------------------------------------------------------------

/** Two wall ends this close are joined and not a gap. Below the one
 *  control point per foot Feature Trace samples at, so a stroke that
 *  ended ON another line's end never reads as a near miss. */
CsCheck.GAP_JOINED_FEET = 0.5;

/** A wall end with nothing joined to it, but another wall end within
 *  this far, is a GAP: near enough that the caver meant them to meet.
 *  An end with nothing at all within this distance is a passage that
 *  carries on -- an open end, not a fault, and never reported. */
CsCheck.GAP_NOTICE_FEET = 6.0;

/** Linework further than this from every station is a stroke drawn
 *  where no cave was surveyed. Generous on purpose: a big room's wall
 *  is legitimately far from the centerline it was surveyed off, and a
 *  false alarm on real work costs more than a missed stray. Raised
 *  from 60 after the first live run against Truitt Cave, whose big
 *  room has real, correct floor ledges 74 ft off the centerline. */
CsCheck.ORPHAN_FEET = 120.0;

/** How far a symbol may sit from the nearest station before it is
 *  called adrift. Tighter than ORPHAN_FEET: a symbol marks a THING at
 *  a place, where a wall is a boundary that runs away from one. */
CsCheck.SYMBOL_ADRIFT_FEET = 80.0;

/** A ledge is only called backwards when the two sides differ by more
 *  than this. A ledge with less drop than this either way is within
 *  the noise of reading floor levels off neighbouring stations, and
 *  guessing at it would teach a student to distrust the tool. */
CsCheck.LEDGE_DROP_FEET = 3.0;

/** The severities, worst first. Sort order and nothing more. */
CsCheck.ORDER = ["error", "warning", "note"];

/** What a severity is called on screen. The words are the point: a
 *  beginner does not know what "warning" is being weighed against. */
CsCheck.LABEL = {
    "error": "Fix before sharing",
    "warning": "Probably not what you meant",
    "note": "Polish"
};
/**
 * WHY EACH FAULT MATTERS. One paragraph per CODE, because the reason
 * is a property of the KIND of fault -- a beginner needs the same
 * explanation of what a scale bar is for whether the sheet is missing
 * one or eight walls have gaps.
 *
 * The TITLE is per finding and is built where the finding is made:
 * that half says which one this is.
 */
CsCheck.WHY = {
    "sheet.scalebar":
        "Without one, nothing on the map can be measured -- a reader " +
        "cannot tell a 20 ft crawl from a 200 ft passage. A printed " +
        "map is resized by every photocopier it meets, which is why " +
        "the bar is drawn on the sheet rather than written as '1 inch " +
        "= 50 feet'.",
    "sheet.north":
        "A cave map without one cannot be lined up with a compass, a " +
        "surface map or the next cave over. Say WHICH north it is -- " +
        "true or magnetic, with the declination used -- because a " +
        "reader who assumes the wrong one is out by degrees.",
    "sheet.titleblock":
        "A map nobody can attribute or date is a map nobody can " +
        "check, correct or build on. Who surveyed it and when is what " +
        "lets the next party tell your work from theirs -- and it is " +
        "the credit the people who carried the tape are owed.",
    "sheet.legend":
        "You know what every mark means today. A reader does not, and " +
        "neither will you in five years. Build Legend generates one " +
        "from the symbols this map actually uses, so it can never " +
        "explain a symbol the map does not have.",
    "layer.symbol":
        "Layers are how a cave map is read, printed and switched off: " +
        "a stalactite sitting on the water layer turns blue with the " +
        "streams and vanishes when someone hides them. Placing a " +
        "symbol from the Symbol Palette puts it on its own layer " +
        "every time -- this happens when one is copied, or dragged " +
        "from another drawing.",
    "layer.stray":
        "Everything the suite draws goes on a named layer, and the " +
        "layer decides how it prints and whether Restyle Layers can " +
        "reach it. Work on layer 0 -- what CAD gives you when nothing " +
        "is chosen -- is invisible to every tool here and will not " +
        "restyle, plot or export with the rest of the map.",
    "layer.hidden":
        "Work on a hidden layer is still in the drawing and still in " +
        "the file -- it just does not print, and you cannot see that " +
        "it is missing. This is worth a look before plotting: either " +
        "it belongs on the map, or it should be deleted rather than " +
        "left where the next person will find it.",
    "walls.gap":
        "A wall that stops just short of the next one leaves a hole " +
        "the reader's eye falls through, and any tool that fills or " +
        "measures an area will leak out of it. Continue the stroke " +
        "instead: a trace that carries on from an existing end GROWS " +
        "that line rather than starting a second one.",
    "walls.orphan":
        "Cave maps are drawn ON the survey: every wall is traced " +
        "beside the stations that measured it. Linework this far from " +
        "any station is either remembered rather than surveyed -- in " +
        "which case it belongs on Inferred Walls, dashed, so the map " +
        "says so -- or it was drawn in the wrong place entirely.",
    "boundary.open":
        "Scatter Breakdown fills CLOSED boundaries and skips open " +
        "ones without complaining, so an open outline is a rubble " +
        "field that silently never gets its blocks. Close the loop " +
        "back onto its own start.",
    "section.untied":
        "A section is a statement about ONE place in the cave. With " +
        "nothing tying it to a station, a reader cannot tell where " +
        "the cut was taken, and a revision cannot move it when that " +
        "part of the cave is resurveyed.",
    "shape.stale":
        "The hachures and scallops are generated along the line and " +
        "normally follow it. One that has drifted usually means the " +
        "line was edited while the suite was not watching -- Sync " +
        "Shaped Lines rebuilds them.",
    "ledge.uphill":
        "Hachures go on the LOW side -- the side you would fall to. " +
        "The floor levels nearest this one say the ornamented side is " +
        "the HIGHER one, which reads as a drop going up. Worth " +
        "looking at rather than trusting: this is judged from the " +
        "nearest stations, not measured. Flip Shaped Side mirrors it.",
    "survey.closure":
        "A loop that comes back to its start off by this much has a " +
        "reading in it that is wrong, and every wall traced off those " +
        "stations inherits the error. Survey Notebook flags the " +
        "suspect shots; fixing one bad backsight is worth more than " +
        "any amount of redrawing.",
    "check.more":
        "The list is capped so it stays a list rather than a wall of " +
        "text. Fix some of these and press Check Again -- the rest " +
        "will appear. Ignoring this row hides only the count, never " +
        "the findings themselves."
};

/**
 * ONE FINDING'S IDENTITY, and the reason ignoring works per entry.
 *
 * NOT the code. Ignoring by code would mean that deciding one wall gap
 * is deliberate silences every other gap on the map, including ones
 * drawn tomorrow -- the exact fault of a checker that gets switched
 * off wholesale, moved one level down.
 *
 * The identity is the code plus WHERE the fault is: the position
 * rounded to the foot, or the layer for a fault that belongs to a
 * layer rather than a point, or nothing at all for a sheet-wide fault
 * (of which there is only ever one).
 *
 * ROUNDED TO THE FOOT, deliberately. Re-checking after moving anything
 * else must give the same identity, or every ignore would evaporate on
 * the next Check Again; and a fault that MOVES more than a foot really
 * is a different fault, so it comes back and asks again. That is the
 * honest trade, and it is the one place ignoring can surprise someone.
 */
CsCheck.idOf = function(code, at, layer) {
    if (!isNull(at)) {
        // COLON, NOT COMMA, between the coordinates: the ignore list is
        // stored comma-separated, and an id holding a comma was split
        // in half on the way back out -- so ignoring one gap ignored
        // nothing at all. Caught by the unit test for exactly that.
        return code + "@" + Math.round(at.x) + ":" + Math.round(at.y);
    }
    if (!isNull(layer) && layer !== "") {
        return code + "@" + layer;
    }
    return code;
};

CsCheck.finding = function(code, severity, title, why, count, at, layer) {
    var place = (at === undefined) ? null : at;
    var on = (layer === undefined || layer === null) ? "" : layer;
    return {
        code: code,
        // What the ignore list stores. One entry, not one kind.
        id: CsCheck.idOf(code, place, on),
        severity: severity,
        title: title,
        why: isNull(why) ? (CsCheck.WHY[code] || "") : why,
        count: (count === undefined || count === null) ? 1 : count,
        at: place,
        layer: on
    };
};

/** Distances a caver reads: "3 ft", "74 ft". */
CsCheck.feet = function(value) {
    return Math.round(value) + " ft";
};

/**
 * Caps one check's findings, adding a row that says how many were left
 * out.
 *
 * A map with two hundred faults of one kind is a map whose panel would
 * be unusable, and scrolling past 200 identical rows to reach the next
 * KIND of fault is how a caver stops reading the list. The overflow row
 * carries no place -- it is about the list, not about the cave.
 */
CsCheck.MAX_PER_CHECK = 40;

CsCheck.capped = function(code, findings) {
    if (findings.length <= CsCheck.MAX_PER_CHECK) {
        return findings;
    }
    var out = findings.slice(0, CsCheck.MAX_PER_CHECK);
    var rest = findings.length - CsCheck.MAX_PER_CHECK;
    out.push(CsCheck.finding("check.more", findings[0].severity,
        "and " + rest + " more like the " + CsCheck.MAX_PER_CHECK +
            " above", null, rest, null, code));
    return out;
};

// ---------------------------------------------------------------------
// THE CHECKS. Each takes the scan and answers an array of findings --
// empty when there is nothing to say, which is the ordinary case on a
// finished map.
//
// ONE ROW PER FAULT, not one row per kind (Nathan, 2026-09-10: "do not
// hide by kind, hide individual entries"). Eight wall gaps are eight
// findings, each with its own place and its own ignore, so deciding
// that the gap at the entrance is deliberate says nothing about the
// seven others.
//
// The one deliberate exception is layer.stray, which is one row per
// LAYER rather than one per entity: 232 identical rows saying "a line
// on layer 0" is not a list, and "everything I left on layer 0" is the
// decision a caver actually makes. Every other check is per occurrence.
//
// One check, one entry in CsCheck.CHECKS. Adding a check is adding a
// function and a row; nothing else in the file knows how many there
// are.
// ---------------------------------------------------------------------

/** A sheet with no scale bar is a picture, not a map. */
CsCheck.checkScaleBar = function(scan) {
    if (CsCheck.contentOn(scan, "SCALE-BAR") > 0) {
        return [];
    }
    return [CsCheck.finding("sheet.scalebar", "error",
        "No scale bar on the sheet", null, 1, null, "SCALE-BAR")];
};

/** And no north arrow is a map that cannot be walked with. */
CsCheck.checkNorthArrow = function(scan) {
    if (CsCheck.contentOn(scan, "NORTH-ARROW") > 0) {
        return [];
    }
    return [CsCheck.finding("sheet.north", "error",
        "No north arrow on the sheet", null, 1, null, "NORTH-ARROW")];
};

/**
 * The title block fields a judged map is required to carry.
 *
 * ONE ROW PER FIELD. They are filled in one at a time and a caver may
 * genuinely not have one of them -- a sketch with no cartographer yet
 * -- so each is its own decision, and a single row would make ignoring
 * the missing date also ignore the missing cave name.
 */
CsCheck.checkTitleBlock = function(scan) {
    var out = [];
    for (var i = 0; i < scan.requiredFields.length; i++) {
        var field = scan.requiredFields[i];
        var value = scan.titleBlock[field.id];
        if (isNull(value) || String(value).replace(/\s/g, "") === "") {
            out.push(CsCheck.finding("sheet.titleblock", "error",
                "The title block does not say: " + field.label,
                null, 1, null, "TITLE-BLOCK:" + field.id));
        }
    }
    return out;
};

/** Symbols on the map and no legend explaining them. */
CsCheck.checkLegend = function(scan) {
    if (scan.symbolCount === 0 || CsCheck.contentOn(scan, "LEGEND") > 0) {
        return [];
    }
    return [CsCheck.finding("sheet.legend", "warning",
        "Symbols are used but there is no legend",
        null, scan.symbolCount, null, "LEGEND")];
};

/** A symbol placed on a layer that is not its own -- one row each. */
CsCheck.checkSymbolLayers = function(scan) {
    var out = [];
    for (var i = 0; i < scan.symbols.length; i++) {
        var sym = scan.symbols[i];
        if (sym.atHome !== false) {
            continue;
        }
        var name = isNull(sym.name) || sym.name === "" ? sym.block : sym.name;
        out.push(CsCheck.finding("layer.symbol", "error",
            "A " + name + " is on " + sym.layer + ", not " + sym.home,
            null, 1, sym.at, sym.layer));
    }
    return CsCheck.capped("layer.symbol", out);
};

/**
 * Drawing on layer 0, or on a layer the suite does not know.
 *
 * PER LAYER, not per entity -- see the note at the top of this section.
 */
CsCheck.checkStrayLayers = function(scan) {
    var strays = {};
    var where = {};
    var order = [];
    for (var i = 0; i < scan.entities.length; i++) {
        var e = scan.entities[i];
        if (e.registered === true) {
            continue;
        }
        if (!strays.hasOwnProperty(e.layer)) {
            strays[e.layer] = 0;
            where[e.layer] = e.at;
            order.push(e.layer);
        }
        strays[e.layer] += 1;
        if (isNull(where[e.layer])) {
            where[e.layer] = e.at;
        }
    }
    var out = [];
    for (var n = 0; n < order.length; n++) {
        var layer = order[n];
        var count = strays[layer];
        out.push(CsCheck.finding("layer.stray", "warning",
            count + " thing" + (count === 1 ? "" : "s") + " drawn on " +
                (layer === "0" ? "0 (the default layer)" : layer),
            null, count, where[layer], layer));
    }
    return CsCheck.capped("layer.stray", out);
};

/** Content on a layer that is switched off or frozen -- one row each. */
CsCheck.checkHiddenContent = function(scan) {
    var out = [];
    for (var i = 0; i < scan.layers.length; i++) {
        var lay = scan.layers[i];
        if (lay.count === 0 || lay.visible === true || lay.control === true) {
            continue;
        }
        out.push(CsCheck.finding("layer.hidden", "warning",
            lay.count + " thing" + (lay.count === 1 ? "" : "s") +
                " on " + lay.name + ", which is switched off",
            null, lay.count, null, lay.name));
    }
    return CsCheck.capped("layer.hidden", out);
};

/**
 * Wall ends that nearly meet -- one row per HOLE.
 *
 * A gap is seen from both its ends. Reporting it twice would ask a
 * caver to ignore the same hole twice, so the end that reports it is
 * the one nearer the drawing origin -- an arbitrary rule, but a stable
 * one, which is what matters when the identity has to survive a
 * re-check.
 */
CsCheck.checkWallGaps = function(scan) {
    var ends = scan.wallEnds;
    var out = [];
    for (var i = 0; i < ends.length; i++) {
        var nearest = null, partner = null;
        for (var j = 0; j < ends.length; j++) {
            if (i === j || ends[i].entity === ends[j].entity) {
                continue;
            }
            var d = CsCheck.distance(ends[i].at, ends[j].at);
            if (nearest === null || d < nearest) {
                nearest = d;
                partner = ends[j];
            }
        }
        if (nearest === null) {
            continue;
        }
        // The ends are in DRAWING units (they are drawing coordinates,
        // and Show Me needs them that way); the thresholds are in feet,
        // so the comparison happens in feet.
        var feet = nearest / scan.perFoot;
        if (feet <= CsCheck.GAP_JOINED_FEET || feet > CsCheck.GAP_NOTICE_FEET) {
            continue;
        }
        // Only the end nearer the origin speaks for the hole.
        var mine = ends[i].at.x * ends[i].at.x + ends[i].at.y * ends[i].at.y;
        var theirs = partner.at.x * partner.at.x + partner.at.y * partner.at.y;
        if (theirs < mine) {
            continue;
        }
        out.push(CsCheck.finding("walls.gap", "warning",
            "Two wall lines stop " + CsCheck.feet(feet) + " apart",
            null, 1, ends[i].at, ends[i].layer));
    }
    return CsCheck.capped("walls.gap", out);
};

/** Linework drawn where no survey reached -- one row per line. */
CsCheck.checkOrphanLinework = function(scan) {
    var out = [];
    for (var i = 0; i < scan.linework.length; i++) {
        var item = scan.linework[i];
        if (item.nearestStation !== null &&
                item.nearestStation <= CsCheck.ORPHAN_FEET) {
            continue;
        }
        out.push(CsCheck.finding("walls.orphan", "warning",
            item.nearestStation === null ?
                ("A line on " + item.layer + " with no station anywhere " +
                    "in the drawing") :
                ("A line on " + item.layer + " is " +
                    CsCheck.feet(item.nearestStation) +
                    " from the nearest station"),
            null, 1, item.at, item.layer));
    }
    return CsCheck.capped("walls.orphan", out);
};

/** A breakdown boundary left open -- one row each. */
CsCheck.checkOpenBoundaries = function(scan) {
    var out = [];
    for (var i = 0; i < scan.boundaries.length; i++) {
        if (scan.boundaries[i].closed === true) {
            continue;
        }
        out.push(CsCheck.finding("boundary.open", "warning",
            "A breakdown boundary is not closed",
            null, 1, scan.boundaries[i].at, scan.boundaries[i].layer));
    }
    return CsCheck.capped("boundary.open", out);
};

/** A cross section nobody can find on the plan -- one row each. */
CsCheck.checkSectionTies = function(scan) {
    var out = [];
    for (var i = 0; i < scan.sections.length; i++) {
        if (scan.sections[i].station !== "") {
            continue;
        }
        out.push(CsCheck.finding("section.untied", "warning",
            "A cross section is tied to no station",
            null, 1, scan.sections[i].at, scan.sections[i].layer));
    }
    return CsCheck.capped("section.untied", out);
};

/** A shaped line whose ornament no longer matches its spine. */
CsCheck.checkStaleShapes = function(scan) {
    var out = [];
    for (var i = 0; i < scan.shapes.length; i++) {
        if (scan.shapes[i].inSync === true) {
            continue;
        }
        out.push(CsCheck.finding("shape.stale", "note",
            "A shaped line's ornament is out of step with its line",
            null, 1, scan.shapes[i].at, scan.shapes[i].layer));
    }
    return CsCheck.capped("shape.stale", out);
};

/** A ledge whose hachures point at the HIGH side. */
CsCheck.checkLedgeSides = function(scan) {
    var out = [];
    for (var i = 0; i < scan.ledges.length; i++) {
        var ledge = scan.ledges[i];
        if (ledge.drop === null || !isFinite(ledge.drop) ||
                ledge.drop <= CsCheck.LEDGE_DROP_FEET) {
            continue;
        }
        out.push(CsCheck.finding("ledge.uphill", "note",
            "A ledge's hachures may be on the high side -- the " +
                "ornamented side reads " + CsCheck.feet(ledge.drop) +
                " higher",
            null, 1, ledge.at, ledge.layer));
    }
    return CsCheck.capped("ledge.uphill", out);
};

/** The loop closure, said in the drawing rather than in a stats box. */
CsCheck.checkClosure = function(scan) {
    if (scan.closurePercent === null ||
            scan.closurePercent <= scan.closureLimit) {
        return [];
    }
    return [CsCheck.finding("survey.closure", "warning",
        "The survey closes at " + scan.closurePercent.toFixed(1) +
            "%, over the " + scan.closureLimit.toFixed(1) + "% worth " +
            "questioning",
        null, 1, null, "")];
};

/**
 * Every check, in the order a caver should meet them: the sheet first
 * (cheap to fix, and what a reader notices), then what is on it.
 */
CsCheck.CHECKS = [
    { code: "sheet.scalebar", run: CsCheck.checkScaleBar },
    { code: "sheet.north", run: CsCheck.checkNorthArrow },
    { code: "sheet.titleblock", run: CsCheck.checkTitleBlock },
    { code: "sheet.legend", run: CsCheck.checkLegend },
    { code: "layer.symbol", run: CsCheck.checkSymbolLayers },
    { code: "layer.stray", run: CsCheck.checkStrayLayers },
    { code: "layer.hidden", run: CsCheck.checkHiddenContent },
    { code: "walls.gap", run: CsCheck.checkWallGaps },
    { code: "walls.orphan", run: CsCheck.checkOrphanLinework },
    { code: "boundary.open", run: CsCheck.checkOpenBoundaries },
    { code: "section.untied", run: CsCheck.checkSectionTies },
    { code: "shape.stale", run: CsCheck.checkStaleShapes },
    { code: "ledge.uphill", run: CsCheck.checkLedgeSides },
    { code: "survey.closure", run: CsCheck.checkClosure }
];

CsCheck.distance = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/** How many things sit on one layer, by name. */
CsCheck.contentOn = function(scan, layerName) {
    for (var i = 0; i < scan.layers.length; i++) {
        if (scan.layers[i].name === layerName) {
            return scan.layers[i].count;
        }
    }
    return 0;
};

/**
 * Runs every check over one scan.
 *
 * A check that THROWS is reported as a check that could not run, and
 * the rest still run: a lint tool that dies on the one drawing that
 * needed it most is worse than no lint tool. The failure is visible --
 * silently swallowing it would let a check rot unnoticed for months.
 */
CsCheck.review = function(scan) {
    var findings = [];
    var failed = [];
    for (var i = 0; i < CsCheck.CHECKS.length; i++) {
        try {
            var got = CsCheck.CHECKS[i].run(scan);
            for (var j = 0; j < got.length; j++) {
                findings.push(got[j]);
            }
        } catch (e) {
            failed.push(CsCheck.CHECKS[i].code);
        }
    }
    findings.sort(function(a, b) {
        var d = CsCheck.ORDER.indexOf(a.severity) -
            CsCheck.ORDER.indexOf(b.severity);
        if (d !== 0) {
            return d;
        }
        // By ID rather than by code: several findings now share a code,
        // and rows that swap places between two runs would move an
        // ignore under the caver's cursor.
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return {
        findings: findings,
        failed: failed,
        checked: CsCheck.CHECKS.length,
        clean: findings.length === 0 && failed.length === 0
    };
};

// ---------------------------------------------------------------------
// IGNORING A FINDING.
//
// Not every finding is a fault. A sketch map of one passage may have no
// title block on purpose; a working copy may keep notes on layer 0
// deliberately; a cave whose loop closes at 2.4% may have been argued
// over and accepted. A checker that cannot be told "yes, I know" is one
// that gets read once and then ignored wholesale -- which loses the
// findings that did matter along with the ones that did not.
//
// BY ENTRY, PER DRAWING. Ignoring hides the ONE finding right-clicked
// and nothing else: deciding that the wall gap at the entrance is
// deliberate says nothing about the seven other gaps on the map. What
// is stored is the finding's id (CsCheck.idOf) -- its code and where it
// is, rounded to the foot -- so the decision survives the next Check
// Again, and a fault that has genuinely MOVED comes back and asks.
//
// It was by code for one commit, and that was wrong for exactly the
// reason the whole feature exists: an ignore that silences a kind is
// how the findings that mattered get lost with the ones that did not.
//
// The list is kept in SETTINGS rather than in the drawing, which is a
// real trade: this tool promises to change nothing, and writing an
// ignore list into the file would break that promise, dirty the
// document and put a save between a caver and a right-click. The cost
// is that the decision does not travel with the file -- a colleague
// opening the same cave sees the finding again, which is arguably the
// right answer anyway: it is YOUR judgement that this does not matter,
// not the map's.
// ---------------------------------------------------------------------

CsCheck.IGNORE_SETTING = "CaveSurvey/CheckMap/Ignored";

/**
 * A settings-safe token for one drawing's path.
 *
 * QSettings reads "/" as a group separator, so a raw path would nest a
 * folder per directory and never be found again. Everything outside
 * [A-Za-z0-9._-] becomes "_", and a checksum of the ORIGINAL path is
 * appended so two caves whose names flatten to the same token -- "Bat
 * Cave" and "Bat/Cave" -- do not share an ignore list.
 */
CsCheck.pathToken = function(path) {
    var text = String(isNull(path) ? "" : path);
    var sum = 0;
    for (var i = 0; i < text.length; i++) {
        // A plain rolling sum, mod a large prime. Not cryptography --
        // it only has to separate two paths a caver has open at once.
        sum = (sum * 31 + text.charCodeAt(i)) % 1000000007;
    }
    var flat = text.replace(/[^A-Za-z0-9._-]/g, "_");
    // Long paths make unreadable keys and settings files; the tail is
    // the useful half (the cave's own folder and file name).
    if (flat.length > 48) {
        flat = flat.substring(flat.length - 48);
    }
    return flat + "-" + sum;
};

/** The stored ignore list as a set. Empty for anything unreadable: a
 *  corrupt setting must never be the reason a fault goes unreported. */
CsCheck.parseIgnored = function(text) {
    var set = {};
    if (isNull(text) || String(text) === "") {
        return set;
    }
    var parts = String(text).split(",");
    for (var i = 0; i < parts.length; i++) {
        var code = parts[i].replace(/\s/g, "");
        if (code !== "") {
            set[code] = true;
        }
    }
    return set;
};

/** True when a code can survive the round trip through the stored
 *  list. A comma would be split back out as two ids -- see idOf. */
CsCheck.storableId = function(id) {
    return !isNull(id) && String(id) !== "" && String(id).indexOf(",") === -1;
};

/** The set back as one storable string, in a stable order. */
CsCheck.serializeIgnored = function(set) {
    var codes = [];
    for (var code in set) {
        if (set.hasOwnProperty(code) && set[code] === true) {
            codes.push(code);
        }
    }
    codes.sort();
    return codes.join(",");
};

/** Turns one FINDING's ignore on or off, answering the changed set.
 *  Takes the finding's id -- see CsCheck.idOf. */
CsCheck.setIgnored = function(set, code, on) {
    var out = {};
    for (var key in set) {
        if (set.hasOwnProperty(key) && set[key] === true && key !== code) {
            out[key] = true;
        }
    }
    if (on === true && CsCheck.storableId(code)) {
        out[String(code)] = true;
    }
    return out;
};

/**
 * Splits findings into the ones to show and the ones being ignored.
 *
 * BOTH ARE RETURNED, and the panel says how many were held back. An
 * ignore list that becomes invisible is one nobody remembers setting,
 * and the first time it hides something that mattered it will look
 * like the checker missed it.
 */
CsCheck.splitIgnored = function(findings, set) {
    var shown = [], ignored = [];
    for (var i = 0; i < findings.length; i++) {
        // BY ID, not by code: one entry, not one kind. See CsCheck.idOf.
        if (!isNull(set) && set[findings[i].id] === true) {
            ignored.push(findings[i]);
        } else {
            shown.push(findings[i]);
        }
    }
    return { shown: shown, ignored: ignored };
};

/** How many findings of one severity. */
CsCheck.countOf = function(result, severity) {
    var n = 0;
    for (var i = 0; i < result.findings.length; i++) {
        if (result.findings[i].severity === severity) {
            n += 1;
        }
    }
    return n;
};

/** One line for the command line, in the suite's own voice.
 *
 *  `ignoredCount` is optional and is SAID OUT LOUD when it is not
 *  zero -- see CsCheck.splitIgnored on why a silent ignore list is
 *  worse than none. */
CsCheck.summary = function(result, ignoredCount) {
    if (result.clean) {
        var clean = "Check Map: nothing to fix -- all " + result.checked +
            " checks pass.";
        if (!isNull(ignoredCount) && ignoredCount > 0) {
            clean += " " + ignoredCount + " ignored.";
        }
        return clean;
    }
    var parts = [];
    for (var i = 0; i < CsCheck.ORDER.length; i++) {
        var n = CsCheck.countOf(result, CsCheck.ORDER[i]);
        if (n > 0) {
            parts.push(n + " " + CsCheck.LABEL[CsCheck.ORDER[i]].toLowerCase());
        }
    }
    var text = "Check Map: " + parts.join(", ") + ".";
    if (!isNull(ignoredCount) && ignoredCount > 0) {
        text += " " + ignoredCount + " ignored.";
    }
    if (result.failed.length > 0) {
        text += " (" + result.failed.length + " check could not run: " +
            result.failed.join(", ") + ")";
    }
    return text;
};

// ---------------------------------------------------------------------
// THE SCAN -- the one half of this file that needs a document.
//
// Everything above works on the object this builds, so a check can be
// tested by handing it a literal. The split is not decoration: the
// expensive, fiddly, QCAD-shaped work (walking entities, resolving the
// survey) happens ONCE here, and thirteen checks then read plain
// arrays.
//
// QCAD only.
// ---------------------------------------------------------------------

/** Layers whose being switched off is the DESIGN, not a mistake: the
 *  generated control layers, which a finished map hides on purpose. */
CsCheck.isControlLayer = function(name) {
    return String(name).indexOf("CTRL-") === 0 ||
        String(name).indexOf("-CTRL-") >= 0;
};

/** A layer the suite knows -- registry name, or one of its per-view
 *  twins. Anything else is somewhere a caver has wandered. */
CsCheck.isRegisteredLayer = function(name) {
    if (isNull(name) || name === "") {
        return false;
    }
    if (typeof CsLayers === "undefined" || isNull(CsLayers.DEFAULTS)) {
        return true;   // no registry loaded: never accuse
    }
    if (CsLayers.DEFAULTS.hasOwnProperty(String(name))) {
        return true;
    }
    // A VARIANT layer -- CTRL-PROFILE-STATIONS-G, one per survey run --
    // is generated by the suite and is nowhere in DEFAULTS, because
    // there is one per run and the runs are not known until a cave is
    // drawn. Truitt Cave has 48 of them, and the first live run of this
    // tool accused every one. A variant is registered when its BASE is.
    if (typeof CsLayerVariants !== "undefined" &&
            typeof CsLayerVariants.baseOf === "function") {
        try {
            var base = CsLayerVariants.baseOf(String(name));
            if (base !== "" && base !== String(name) &&
                    CsLayers.DEFAULTS.hasOwnProperty(base)) {
                return true;
            }
        } catch (e) {
        }
    }
    return false;
};

/**
 * True when a symbol sits on its own layer, allowing for the profile
 * and section twins -- a stalactite dropped in the elevation lands on
 * PROFILE-FORMATIONS-DRIP and is exactly where it belongs.
 */
CsCheck.symbolAtHome = function(layerName, homeLayer) {
    if (layerName === homeLayer) {
        return true;
    }
    if (typeof CsLayers === "undefined" ||
            typeof CsLayers.planBaseOf !== "function") {
        return false;
    }
    try {
        return CsLayers.planBaseOf(layerName) === homeLayer;
    } catch (e) {
        return false;
    }
};

/**
 * A note, not a place. Callout text and its leaders are positioned
 * where they can be READ -- out in the margin, away from the linework
 * they point at -- so measuring them against the stations asks the
 * wrong question. Truitt Cave's notes sit at the sheet origin, 343 ft
 * from the nearest station, and were reported as strays on this tool's
 * first live run.
 */
CsCheck.isAnnotation = function(layerName) {
    return String(layerName).indexOf("NOTES-") === 0 ||
        String(layerName).indexOf("TEXT-") === 0;
};

/**
 * A shaped line's ORNAMENT rather than its line: the hachures, the
 * scallops, the slope fans. Generated along the spine and owned by it,
 * so a ledge is one traced feature and not thirty. Counting each tick
 * separately reported one correct ledge as a dozen faults.
 *
 * Decoration carries DECOR=<id>; the spine carries STYLE. QCAD only.
 */
CsCheck.isOrnament = function(entity) {
    if (typeof CsShapeLine === "undefined" || isNull(entity)) {
        return false;
    }
    try {
        return CsTags.get(entity, CsShapeLine.KEY.DECOR) !== "";
    } catch (e) {
        return false;
    }
};

/** The endpoints of one path: first and last, and nothing when the
 *  path closes on itself (a closed outline has no ends to leave open). */
CsCheck.endsOf = function(points, closed) {
    if (isNull(points) || points.length < 2 || closed === true) {
        return [];
    }
    return [points[0], points[points.length - 1]];
};

/** The station nearest a set of points, with its distance and height,
 *  or null. Walks a prepared index rather than the document. */
CsCheck.nearestIn = function(index, points) {
    var best = null;
    for (var i = 0; i < index.length; i++) {
        for (var p = 0; p < points.length; p++) {
            var d = CsCheck.distance(points[p], index[i]);
            if (best === null || d < best.distance) {
                best = { distance: d, z: index[i].z, name: index[i].name };
            }
        }
    }
    return best;
};

/**
 * How much HIGHER the ornamented side of a ledge is than the other --
 * positive means the hachures are pointing uphill, which is the ledge
 * drawn backwards.
 *
 * Judged from the floor heights of the nearest station on each side,
 * which is why checkLedgeSides reports it as worth a look rather than
 * as a fault. Null whenever either side has no station near enough to
 * say anything -- silence beats a guess.
 */
CsCheck.ledgeDrop = function(points, side, index, reach) {
    if (isNull(points) || points.length < 2 || isNull(side) || side === 0) {
        return null;
    }
    var mid = Math.floor(points.length / 2);
    var a = points[Math.max(0, mid - 1)];
    var b = points[Math.min(points.length - 1, mid + 1)];
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
        return null;
    }
    // The perpendicular, times the recorded side: +1 and -1 are the two
    // sides of the stroke exactly as CsShapeLine writes them.
    var nx = (-dy / len) * side, ny = (dx / len) * side;
    var at = points[mid];
    var step = reach;
    var ornament = CsCheck.nearestIn(index,
        [{ x: at.x + nx * step, y: at.y + ny * step }]);
    var other = CsCheck.nearestIn(index,
        [{ x: at.x - nx * step, y: at.y - ny * step }]);
    if (ornament === null || other === null ||
            ornament.z === null || other.z === null ||
            ornament.distance > reach * 4 || other.distance > reach * 4 ||
            ornament.name === other.name) {
        return null;
    }
    return ornament.z - other.z;
};

/**
 * Reads one drawing into the object the checks run on.
 *
 * EVERY SECTION IS GUARDED. A drawing old enough, or broken enough, to
 * make one of these throw is precisely the drawing someone is running
 * Check Map on; losing the other twelve checks to it would be the
 * worst possible trade. A section that fails leaves its array empty,
 * and the check over that array simply finds nothing.
 */
CsCheck.scan = function(doc) {
    var scan = {
        layers: [], entities: [], symbols: [], linework: [],
        wallEnds: [], boundaries: [], sections: [], shapes: [],
        ledges: [], titleBlock: {}, requiredFields: [],
        symbolCount: 0, closurePercent: null,
        // Drawing units per foot of cave. Every threshold in this file
        // is in FEET so it means the same thing in a metric drawing;
        // the coordinates are in drawing units because Show Me frames
        // the view with them. This is the one number that reconciles
        // the two, and a scan that could not read it says 1.0 -- which
        // is right for a foot drawing and the commonest case.
        perFoot: 1.0,
        closureLimit: (typeof CsValidate === "undefined") ? 2.0 :
            CsValidate.CLOSURE_WARN_PERCENT
    };
    if (isNull(doc)) {
        return scan;
    }
    try {
        var per = CsShapeLine.perFoot(doc);
        if (isFinite(per) && per > 0) {
            scan.perFoot = per;
        }
    } catch (ePer) {
        scan.perFoot = 1.0;
    }

    // ---- stations, with their heights ------------------------------
    var index = [];
    try {
        var stations = CsTags.collectStations(doc);
        for (var s = 0; s < stations.length; s++) {
            // `pos`, not `position` -- CsTags.collectStations names it
            // that, and reading the wrong one threw INSIDE the guard
            // below, which left the index empty and reported every
            // line in the cave as drawn away from the survey. Caught
            // by tests/check_map_run.js against a real document; no
            // unit test over a literal scan could have seen it.
            var st = stations[s];
            index.push({
                name: st.name,
                x: st.pos.x, y: st.pos.y,
                z: (st.pos.z === undefined) ? null : st.pos.z
            });
        }
    } catch (eStations) {
        index = [];
    }

    // ---- the survey's worst loop -----------------------------------
    try {
        var asDrawn = CsRevise.resolveAsDrawn(doc);
        if (!isNull(asDrawn)) {
            var stats = CsStats.compute(asDrawn.survey, asDrawn.resolved,
                CsTraverse.SLOPE);
            if (!isNull(stats.worstLoop)) {
                scan.closurePercent = stats.worstLoop.percent;
            }
        }
    } catch (eSurvey) {
        scan.closurePercent = null;
    }

    // ---- the title block -------------------------------------------
    try {
        for (var f = 0; f < CsSheet.FIELDS.length; f++) {
            var field = CsSheet.FIELDS[f];
            if (field.required === true) {
                scan.requiredFields.push(
                    { id: field.id, label: field.label });
            }
            scan.titleBlock[field.id] = CsSheet.readField(doc, field);
        }
    } catch (eSheet) {
        scan.requiredFields = [];
    }

    // ---- layers, and whether they can be seen ----------------------
    var counts = {};
    try {
        var layerIds = doc.queryAllLayers();
        for (var l = 0; l < layerIds.length; l++) {
            var lay = doc.queryLayer(layerIds[l]);
            if (isNull(lay)) {
                continue;
            }
            var lname = String(lay.getName());
            counts[lname] = 0;
            scan.layers.push({
                name: lname,
                count: 0,
                visible: !CsLayers.refusesEdits(lay),
                control: CsCheck.isControlLayer(lname)
            });
        }
    } catch (eLayers) {
        scan.layers = [];
    }

    // ---- everything drawn ------------------------------------------
    try {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var layer = CsBind.layerNameOf(doc, e);
            if (counts.hasOwnProperty(layer)) {
                counts[layer] += 1;
            }
            var points = [];
            try {
                points = CsBind.pointsOf(e) || [];
            } catch (ePoints) {
                points = [];
            }
            var at = points.length > 0 ? points[0] : null;
            var registered = CsCheck.isRegisteredLayer(layer);
            scan.entities.push({ layer: layer, at: at,
                registered: registered });

            // A symbol: is it on its own layer, and is it near the cave?
            if (e.getType() === RS.EntityBlockRef) {
                var entry = null;
                try {
                    var block = doc.queryBlock(e.getReferencedBlockId());
                    entry = isNull(block) ? null :
                        CsSymbols.byBlock(String(block.getName()));
                } catch (eBlock) {
                    entry = null;
                }
                if (!isNull(entry)) {
                    scan.symbolCount += 1;
                    var pos = e.getPosition();
                    scan.symbols.push({
                        block: entry.block, layer: layer,
                        // The NSS name, so a finding can say "A
                        // stalactite is on WATER-FLOW-ARROWS" rather
                        // than naming a block nobody has seen.
                        name: entry.nss,
                        home: entry.layer,
                        atHome: CsCheck.symbolAtHome(layer, entry.layer),
                        at: { x: pos.x, y: pos.y }
                    });
                }
                var tie = CsTags.get(e, CsCallout.KEY.SECTION_STATION);
                if (CsTags.get(e, CsSectionDraw.TAG) !== "" || tie !== "") {
                    var sp = e.getPosition();
                    scan.sections.push({ station: tie, layer: layer,
                        at: { x: sp.x, y: sp.y } });
                }
            }

            if (points.length === 0) {
                continue;
            }
            var closed = false;
            try {
                closed = (typeof e.isClosed === "function") ?
                    e.isClosed() : false;
            } catch (eClosed) {
                closed = false;
            }

            // Hand-traced linework: is it anywhere near the survey?
            //
            // THE PLAN FRAME ONLY. The extended elevation is drawn
            // BELOW the plan and a section bay is parked clear of it,
            // so profile and section linework is legitimately hundreds
            // of feet from every plan station -- measuring it against
            // them called all 13 of Truitt's elevation lines strays on
            // this tool's first live run. Those frames have their own
            // stations and their own answer to "is this near the
            // survey"; until this check can ask that question per
            // frame, it asks it only where it is sound.
            if (CsBind.isLineworkLayer(layer) &&
                    CsLayers.frameOf(layer) === "plan" &&
                    !CsCheck.isAnnotation(layer) &&
                    !CsCheck.isOrnament(e)) {
                var near = CsCheck.nearestIn(index, points);
                scan.linework.push({ layer: layer, at: at,
                    nearestStation: near === null ? null :
                        (near.distance / scan.perFoot) });
            }
            if (layer === CsLayers.WALLS_SURVEYED ||
                    layer === CsLayers.WALLS_INFERRED) {
                var ends = CsCheck.endsOf(points, closed);
                for (var q = 0; q < ends.length; q++) {
                    scan.wallEnds.push({ at: ends[q], layer: layer,
                        entity: String(ids[i]) });
                }
            }
            if (layer === CsLayers.BREAKDOWN_BOUNDARY) {
                scan.boundaries.push({ layer: layer, at: at,
                    closed: closed });
            }
        }
    } catch (eEntities) {
        // whatever was gathered before the failure still gets checked
    }

    for (var c = 0; c < scan.layers.length; c++) {
        scan.layers[c].count = counts[scan.layers[c].name] || 0;
    }

    // ---- shaped lines: ornament in step, and on the low side -------
    try {
        var spines = CsShapeLine.spines(doc);
        var reach = CsShapeLine.perFoot(doc) * 5.0;
        for (var sp2 = 0; sp2 < spines.length; sp2++) {
            var spine = spines[sp2];
            var id = CsTags.get(spine, CsShapeLine.KEY.ID);
            var style = CsTags.get(spine, CsShapeLine.KEY.STYLE);
            var sampled = CsShapeLine.sampleEntity(spine,
                CsShapeLine.sampleStep(reach));
            var built = CsShapeLine.buildDecor(doc, spine, sampled);
            var slayer = CsBind.layerNameOf(doc, spine);
            var sat = (sampled.length > 0) ? sampled[0] : null;
            scan.shapes.push({ layer: slayer, at: sat,
                inSync: isNull(built) ? true :
                    (built.sig === CsTags.get(spine, CsShapeLine.KEY.SIG)) });
            if (style === "floorledge") {
                var rise = CsCheck.ledgeDrop(sampled,
                    CsShapeLine.sideOf(spine), index, scan.perFoot * 5.0);
                scan.ledges.push({ layer: slayer, at: sat,
                    drop: (rise === null) ? null : (rise / scan.perFoot) });
            }
        }
    } catch (eShapes) {
        scan.shapes = [];
        scan.ledges = [];
    }

    return scan;
};

/** Scan and review in one call -- what the tool runs. QCAD only. */
CsCheck.run = function(doc) {
    return CsCheck.review(CsCheck.scan(doc));
};
