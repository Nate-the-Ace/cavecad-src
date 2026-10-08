// CsPitch.js -- what the vertical in a cave IS, as a thing rather than
// as a list of legs, and the label a map puts beside it.
//
// Part of the Cave Survey Core library: pure functions. Nothing here
// touches a document.
//
// "P 187 FT" beside the entrance drop is the single most-read mark on
// a pit map. A caver looks at it before they pack a rope, and nothing
// else on the drawing answers the question -- the plan shows the pitch
// as a dot (a 187 ft free-fall has no plan extent at all; see
// CsLrud.COINCIDENT_PLAN) and the extended elevation draws it as a
// vertical line with no number on it.
//
// A PITCH IS NOT A LEG. Rope gets rebelayed, so a single drop arrives
// in the survey as a CHAIN of plumb legs: Plumbline Pit's entrance
// drop is 62 ft to a ledge and then 125 ft of free-fall, and a caver
// asked how deep it is says 187. Labelling the legs separately would
// put "P 62" and "P 125" on a map of a cave nobody has ever described
// that way, so a pitch here is the maximal chain of consecutive plumb
// legs going the same way, and the label carries the total with its
// segments named after it.
//
// A SIDE PASSAGE DOES NOT END A PITCH. Plumbline Pit's rebelay ledge
// has a window passage leading off it, so the station is a junction by
// every other rule in this suite -- and the drop is still 187 ft of
// air. The chain breaks on geometry (the next leg is not plumb, or it
// reverses direction) and never on how many other ways out a station
// has. What the junction changes is the ROPE, not the hole, and the
// rope is what the segment list is for.
//
// AN AVEN IS A PITCH GOING UP and is found by the same walk with the
// sign the other way round. It is labelled differently because a caver
// reads them differently -- one is a thing you rig down, the other is
// a thing above your head -- but nothing else about it differs, which
// is why the sign is a field and not a second function.

var CsPitch = {};

/** How the label names a drop and an aven. */
CsPitch.PITCH_PREFIX = "P";
CsPitch.AVEN_PREFIX = "AVEN";

/**
 * Below this drop, a plumb leg is not worth a label of its own.
 *
 * A 3 ft step down that happened to be shot plumb is not a pitch, and
 * a map with "P 3 FT" on every one of them is a map nobody can read.
 * Deliberately a length rather than a judgement about the leg: the
 * thing that makes a pitch a pitch, to the person reading the map, is
 * how far they are going to fall.
 *
 * In the survey's own distance unit, so a metric cave gets a metric
 * threshold. 10 ft / 10 m are both about "past this you want a rope",
 * which is the question the number is standing in for.
 */
CsPitch.MIN_DROP = 10.0;

/**
 * Every pitch and aven in a survey, deepest first.
 *
 * \param survey   the CsModel survey (read for nothing but its shots'
 *                 own flags -- the geometry comes from `resolved`)
 * \param resolved CsNetwork.resolve() result
 * \param opts     {minDrop} -- override CsPitch.MIN_DROP; 0 finds
 *                 every plumb leg however short
 *
 * \return [{
 *   top, bottom       station names, top always the higher one
 *   stations          every station on the chain, top to bottom
 *   drop              total vertical extent, always positive
 *   segments          [{from, to, drop}] top to bottom, one per leg
 *   rebelays          segments.length - 1
 *   aven              true when the chain was surveyed upward from its
 *                     lower end and nothing else touches its top --
 *                     see CsPitch.isAven for why that is the test
 *   topPoint, bottomPoint  {x, y, z} of the two ends
 * }]
 */
CsPitch.find = function(survey, resolved, opts) {
    var o = opts || {};
    var minDrop = (o.minDrop === undefined || o.minDrop === null) ?
        CsPitch.MIN_DROP : o.minDrop;
    if (resolved === null || resolved === undefined || !resolved.legs) {
        return [];
    }

    // Plumb legs only, each oriented DOWNWARD so a chain can be walked
    // without caring which way the surveyor shot it. A leg with no
    // usable geometry is not a pitch; a leg that is plumb but whose
    // ends the resolver never placed cannot be measured and is not
    // one either.
    var down = [];          // {top, bottom, drop, shot}
    var byTop = {};         // station -> index into down
    var byBottom = {};
    var i, leg, a, b, top, bottom, drop;
    for (i = 0; i < resolved.legs.length; i++) {
        leg = resolved.legs[i];
        if (leg.shot.excludeFromAll || leg.shot.excludeFromPlot) {
            continue;
        }
        if (!CsTraverse.isPlumb(leg.shot)) {
            continue;
        }
        a = resolved.stations[leg.from];
        b = resolved.stations[leg.to];
        if (a === undefined || b === undefined) {
            continue;
        }
        if (a.z === b.z) {
            continue;   // plumb by its clino, going nowhere by its ends
        }
        if (a.z > b.z) {
            top = leg.from; bottom = leg.to;
        } else {
            top = leg.to; bottom = leg.from;
        }
        drop = Math.abs(a.z - b.z);
        // A station may only be the top of one chain and the bottom of
        // one chain. TWO pitches dropping from the same station is a
        // shaft that splits, and joining them into one chain would
        // report a depth no single rope ever spans. The first one
        // found keeps the station and the second starts its own chain,
        // which is what the drawing shows: two labels, two ropes.
        if (byTop.hasOwnProperty(top) || byBottom.hasOwnProperty(bottom)) {
            down.push({ top: top, bottom: bottom, drop: drop, orphan: true });
            continue;
        }
        byTop[top] = down.length;
        byBottom[bottom] = down.length;
        down.push({ top: top, bottom: bottom, drop: drop, orphan: false });
    }

    var out = [];
    var claimed = {};
    for (i = 0; i < down.length; i++) {
        if (claimed[i] === true) {
            continue;
        }
        var seg = down[i];
        if (seg.orphan) {
            // Its own one-leg pitch: it could not chain without
            // claiming a station another chain already owns.
            out.push(CsPitch.makePitch([seg], resolved, survey));
            continue;
        }
        // Walk UP to the head of the chain first, so the segments come
        // out top to bottom however the file was written.
        var head = i;
        while (byBottom.hasOwnProperty(down[head].top) &&
                claimed[byBottom[down[head].top]] !== true) {
            var up = byBottom[down[head].top];
            if (up === head) {
                break;      // a leg from a station to itself: refuse it
            }
            head = up;
        }
        var chain = [];
        var cur = head;
        while (true) {
            if (claimed[cur] === true) {
                break;
            }
            claimed[cur] = true;
            chain.push(down[cur]);
            if (!byTop.hasOwnProperty(down[cur].bottom)) {
                break;
            }
            cur = byTop[down[cur].bottom];
        }
        out.push(CsPitch.makePitch(chain, resolved, survey));
    }

    var kept = [];
    for (i = 0; i < out.length; i++) {
        if (out[i].drop >= minDrop) {
            kept.push(out[i]);
        }
    }
    kept.sort(function(p, q) { return q.drop - p.drop; });
    return kept;
};

/** One pitch record from a chain of downward segments, top first. */
CsPitch.makePitch = function(chain, resolved, survey) {
    var segments = [];
    var stations = [chain[0].top];
    var drop = 0.0;
    for (var i = 0; i < chain.length; i++) {
        segments.push({ from: chain[i].top, to: chain[i].bottom,
                        drop: chain[i].drop });
        stations.push(chain[i].bottom);
        drop += chain[i].drop;
    }
    var topName = chain[0].top;
    var bottomName = chain[chain.length - 1].bottom;
    return {
        top: topName,
        bottom: bottomName,
        stations: stations,
        drop: drop,
        segments: segments,
        rebelays: segments.length - 1,
        aven: CsPitch.isAven(topName, resolved),
        topPoint: CsPitch.pointOf(resolved, topName),
        bottomPoint: CsPitch.pointOf(resolved, bottomName)
    };
};

CsPitch.pointOf = function(resolved, name) {
    var s = resolved.stations[name];
    if (s === undefined || s === null) {
        return null;
    }
    return { x: s.x, y: s.y, z: s.z };
};

/**
 * Is this vertical thing an AVEN rather than a pitch?
 *
 * THE TEST IS WHETHER ANYTHING CARRIES ON AT THE TOP, not which way
 * the surveyor shot it. A caver who plumbs a 187 ft entrance drop from
 * the lip downward and a caver who shoots the same drop upward from
 * the floor have surveyed the same hole, and a label that flipped
 * between "P" and "AVEN" on that basis would be reporting the
 * notebook rather than the cave.
 *
 * What actually separates them is where the passage is. A pitch hangs
 * from passage you walked in along -- the top station has another leg.
 * An aven is a hole in the ceiling with nothing at the top of it,
 * because nobody has been up there: the top station is the end of the
 * line. That is a fact about the cave, it is the same fact whichever
 * end the tape started at, and it is exactly what a reader wants the
 * word for.
 *
 * A bolt-climbed aven that HAS been pushed into passage stops being an
 * aven by this test and becomes a pitch, which is right: once there is
 * cave up there, the thing is a drop from it.
 */
CsPitch.isAven = function(topName, resolved) {
    var touching = 0;
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.from === topName || leg.to === topName) {
            touching++;
        }
    }
    return touching <= 1;
};

/**
 * The label a map puts beside a pitch.
 *
 * Upper case is left to the drawing (CsDraw.caps), as it is for every
 * other generated label, so this stays readable in a report and in a
 * test failure.
 *
 * THE SEGMENTS ARE NAMED WHEN THERE IS MORE THAN ONE, because the
 * total and the rope are different questions and a rigging party needs
 * both: 187 ft of air, rigged as 62 then 125. A single-segment pitch
 * says nothing extra -- there is nothing to add.
 *
 * \param pitch a CsPitch.find record
 * \param unit  the survey's distance unit
 */
CsPitch.label = function(pitch, unit) {
    if (pitch === null || pitch === undefined) {
        return "";
    }
    var u = (unit === null || unit === undefined || unit === "") ? "" :
        (" " + unit);
    var prefix = pitch.aven ? CsPitch.AVEN_PREFIX : CsPitch.PITCH_PREFIX;
    var text = prefix + " " + CsPitch.round(pitch.drop) + u;
    if (pitch.segments.length > 1) {
        var parts = [];
        for (var i = 0; i < pitch.segments.length; i++) {
            parts.push(CsPitch.round(pitch.segments[i].drop));
        }
        text += " (" + parts.join(" + ") + ")";
    }
    return text;
};

/**
 * A drop, rounded the way a caver says it.
 *
 * Whole units past 10, one decimal below. Nobody describes a pitch as
 * 186.7 ft -- the tape is not that certain over that distance and the
 * number is being used to choose a rope -- but a 6.5 ft step is
 * genuinely 6.5.
 */
CsPitch.round = function(value) {
    if (!isFinite(value)) {
        return "?";
    }
    if (value >= 10.0) {
        return String(Math.round(value));
    }
    return String(Math.round(value * 10) / 10);
};

/**
 * The rope a pitch wants, as a caver would order it: the drop plus
 * enough for the rigging at the top and a tail at the bottom, rounded
 * UP to the next ten.
 *
 * ADVISORY, and the label never carries it. A rope length depends on
 * how the pitch is rigged, what it is tied to and how far back the
 * anchors are -- none of which is in a survey -- so a number derived
 * from the drop alone must never appear on a map where it would read
 * as surveyed fact. It is here for a rigging LIST, which is a
 * different document and says where its numbers come from.
 */
CsPitch.ropeAdvice = function(pitch, unit) {
    if (pitch === null || pitch === undefined || !isFinite(pitch.drop)) {
        return null;
    }
    var slack = (unit === "m") ? 5.0 : 15.0;
    var want = pitch.drop + slack;
    var step = (unit === "m") ? 5.0 : 10.0;
    return Math.ceil(want / step) * step;
};

/** Total vertical rigged in a survey: the sum of every pitch's drop. */
CsPitch.totalVertical = function(pitches) {
    var sum = 0.0;
    for (var i = 0; i < pitches.length; i++) {
        sum += pitches[i].drop;
    }
    return sum;
};

/** Whether a draw labels the pitches it finds (CaveSurvey/PitchLabels,
 *  default ON). A cave with no pitch in it gains nothing either way;
 *  a pit map without its labels is missing the mark a caver reads
 *  first, so the default is on and the switch exists for a caver who
 *  is lettering the map by hand. */
CsPitch.SETTING_LABELS = "CaveSurvey/PitchLabels";

CsPitch.labelsEnabled = function() {
    try {
        return RSettings.getBoolValue(CsPitch.SETTING_LABELS, true);
    } catch (e) {
        // Pure-ECMAScript callers (node, the test harness) have no
        // RSettings. The feature is on by default, so answering true
        // is answering with the default rather than guessing.
        return true;
    }
};
