// CsClosure.js -- showing a caver WHERE the loop closure error went.
//
// Part of the Cave Survey Core library. Pure: it takes the adjustment's
// per-station shifts and answers arrows, colours and sentences.
//
// WHAT "CLOSES AT 2.4%" MEANS, AND WHY IT HAS TO BE DRAWN. Survey Stats
// prints a number and the Notebook flags the shots behind it, and a
// beginner reads "2.4%" as a grade they either passed or failed. It is
// neither: it is a statement that walking round the loop and coming
// back landed you 2.4% of the way you walked from where you started,
// and that the adjustment has since MOVED every station in that loop to
// share out the difference. Which stations moved, by how much, and in
// what direction is the whole story, and it is invisible on the map --
// the stations are drawn where the adjustment put them and nothing says
// they were ever anywhere else.
//
// So: an arrow at each station, from where the raw survey put it to
// where it sits now. That is the error, made of the same stuff as the
// map, at the places it actually happened.
//
// THE EXAGGERATION IS THE HONESTY PROBLEM. A tenth of a foot on a cave
// 1400 feet across is a hundredth of a pixel. Drawn true, the arrows
// are invisible and the tool is useless; drawn exaggerated, a caver can
// read a quarter-inch error as a room. Both are ways of lying, so:
// every arrow is scaled by ONE factor, the factor is chosen from the
// data rather than typed, and it is printed on the drawing beside the
// arrows in the same breath as the real numbers. An exaggeration nobody
// is told about is a falsified map.

var CsClosure = {};

/** How big the worst arrow should be, as a fraction of the cave's own
 *  longest side. Big enough to see at a glance, small enough that it
 *  cannot be mistaken for passage. */
CsClosure.TARGET_FRACTION = 0.04;

/** The exaggerations offered. Round numbers, so the caption reads
 *  "50x" rather than "63.4x" -- a reader is being asked to do
 *  arithmetic in their head and round numbers are the courtesy. */
CsClosure.FACTORS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000,
    5000];

/**
 * How much to exaggerate, given the worst shift and the cave's size.
 *
 * Never LESS than 1: shrinking a real error would be the one thing
 * worse than magnifying it. Never more than the largest factor offered,
 * because past that the arrows say more about the factor than the cave.
 */
CsClosure.factorFor = function(worstShiftFeet, caveSizeFeet) {
    if (isNull(worstShiftFeet) || !(worstShiftFeet > 0) ||
            isNull(caveSizeFeet) || !(caveSizeFeet > 0)) {
        return 1;
    }
    var wanted = (caveSizeFeet * CsClosure.TARGET_FRACTION) / worstShiftFeet;
    var best = 1;
    for (var i = 0; i < CsClosure.FACTORS.length; i++) {
        if (CsClosure.FACTORS[i] <= wanted) {
            best = CsClosure.FACTORS[i];
        }
    }
    return best;
};

/**
 * The severity bands an arrow is coloured by, in FEET of real shift.
 *
 * Absolute distances, not fractions of the loop: a station that moved
 * three feet moved three feet, and a reader deciding whether to
 * resurvey cares about the feet. The bands are deliberately generous at
 * the bottom -- a tenth of a foot is a good tape read, not a fault.
 */
CsClosure.BANDS = [
    { upTo: 0.5, colour: "green",
      says: "within a good tape read" },
    { upTo: 2.0, colour: "yellow",
      says: "worth a look" },
    { upTo: 6.0, colour: "orange",
      says: "a reading is probably wrong" },
    { upTo: null, colour: "red",
      says: "resurvey this loop" }
];

CsClosure.bandFor = function(shiftFeet) {
    var d = isNull(shiftFeet) ? 0 : Math.abs(shiftFeet);
    for (var i = 0; i < CsClosure.BANDS.length; i++) {
        if (CsClosure.BANDS[i].upTo === null || d <= CsClosure.BANDS[i].upTo) {
            return CsClosure.BANDS[i];
        }
    }
    return CsClosure.BANDS[CsClosure.BANDS.length - 1];
};

/**
 * One arrow per station that actually moved.
 *
 * `shifts` is CsAdjust's own { name: {dx, dy, dz, distance} }, and
 * `stations` the resolved { name: {x, y, z} } the drawing was made
 * from. Everything is in DRAWING units except the reported feet, which
 * is why perFoot is a parameter rather than an assumption.
 *
 * THE ARROW POINTS AT THE STATION. Its tail is where the raw survey
 * put that station and its head is where it sits on the map now, so a
 * reader follows the arrow to the thing they are looking at. Reversing
 * it -- from the map to the raw position -- was tried on paper and
 * reads as "the station is wrong and the truth is over there", which is
 * the opposite of what an adjustment means.
 *
 * `minFeet` drops the stations that barely moved: on a big cave every
 * station moves a little, and three hundred arrows a millimetre long
 * hide the six that matter.
 */
CsClosure.arrowsFor = function(shifts, stations, factor, perFoot, minFeet,
        pointsAtStation) {
    var out = [];
    if (isNull(shifts) || isNull(stations)) {
        return out;
    }
    var floor = (isNull(minFeet) || !(minFeet > 0)) ? 0 : minFeet;
    var scale = (isNull(factor) || !(factor > 0)) ? 1 : factor;
    var per = (isNull(perFoot) || !(perFoot > 0)) ? 1 : perFoot;
    for (var name in shifts) {
        if (!shifts.hasOwnProperty(name)) {
            continue;
        }
        var at = stations[name];
        var shift = shifts[name];
        if (isNull(at) || isNull(shift)) {
            continue;
        }
        var feet = shift.distance / per;
        if (!(feet > floor)) {
            continue;
        }
        // WHICH END IS AT THE STATION depends on what the drawing
        // shows. On an ADJUSTED map the station is drawn where the
        // adjustment put it, so the arrow arrives there from the raw
        // position. On an unadjusted one it is drawn raw, so the arrow
        // leaves it for where it would go. Same vector, opposite tense
        // -- and drawing the wrong one puts every arrow a full shift
        // away from the station it is about.
        var toward = (pointsAtStation !== false);
        var head = toward ? { x: at.x, y: at.y } :
            { x: at.x + shift.dx * scale, y: at.y + shift.dy * scale };
        var tail = toward ?
            { x: at.x - shift.dx * scale, y: at.y - shift.dy * scale } :
            { x: at.x, y: at.y };
        out.push({
            station: name,
            head: head,
            tail: tail,
            feet: feet,
            verticalFeet: shift.dz / per,
            band: CsClosure.bandFor(feet)
        });
    }
    out.sort(function(a, b) {
        return b.feet - a.feet;   // worst first: the list is a ranking
    });
    return out;
};

/** The two barbs of an arrow head, as points. Pure geometry, so the
 *  head is the same shape at every scale and in every drawing. */
CsClosure.headBarbs = function(tail, head, sizeDrawing) {
    var dx = head.x - tail.x, dy = head.y - tail.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) {
        return [];
    }
    var ux = dx / len, uy = dy / len;
    var back = sizeDrawing;
    var side = sizeDrawing * 0.4;
    return [
        { x: head.x - ux * back - uy * side,
          y: head.y - uy * back + ux * side },
        { x: head.x - ux * back + uy * side,
          y: head.y - uy * back - ux * side }
    ];
};

/**
 * The caption that has to sit beside the arrows.
 *
 * States the exaggeration FIRST, because that is the fact a reader
 * needs before they are allowed to believe anything else on the layer.
 */
CsClosure.caption = function(factor, worstFeet, worstStation, loopCount) {
    var lines = [];
    lines.push("LOOP CLOSURE ERROR -- ARROWS EXAGGERATED " +
        factor + "x");
    if (factor === 1) {
        lines[0] = "LOOP CLOSURE ERROR -- ARROWS AT TRUE SIZE";
    }
    lines.push("Each arrow runs from where the raw survey put a " +
        "station to where it is drawn.");
    if (!isNull(worstStation) && worstStation !== "") {
        lines.push("Worst: " + worstStation + " moved " +
            worstFeet.toFixed(2) + " ft (" +
            CsClosure.bandFor(worstFeet).says + ").");
    }
    if (!isNull(loopCount) && loopCount > 0) {
        lines.push(loopCount + " loop" + (loopCount === 1 ? "" : "s") +
            " in this survey.");
    }
    lines.push("This layer is a diagnostic. Switch it off before " +
        "plotting.");
    return lines;
};

/** One loop's own label: which ring, how badly it closed. */
CsClosure.loopLabel = function(loop) {
    if (isNull(loop)) {
        return "";
    }
    var pct = isNull(loop.percent) ? null : loop.percent;
    var text = loop.from + " to " + loop.to + ":  " +
        loop.error.toFixed(2) + " ft out of " +
        loop.traverseLength.toFixed(0) + " ft";
    if (pct !== null) {
        text += "  (" + pct.toFixed(1) + "%)";
    }
    return text;
};

/**
 * Did the DRAWING have the adjustment applied?
 *
 * The arrows mean two different things and a caver has to be told
 * which: on an adjusted drawing they show where each station was moved
 * FROM, and on an unadjusted one they show where it WOULD be moved to
 * if the adjustment were switched on. Same geometry, opposite tense.
 */
CsClosure.tenseFor = function(adjusted) {
    return adjusted === true ?
        "The map is adjusted: each arrow shows where that station was " +
            "moved from." :
        "The map is NOT adjusted: each arrow shows where that station " +
            "would move to if you switched adjustment on.";
};
