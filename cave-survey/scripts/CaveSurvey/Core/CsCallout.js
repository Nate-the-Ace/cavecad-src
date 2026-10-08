/**
 * CsCallout -- the pure engine behind the Cave Survey callout
 * (multileader) tools.
 *
 * QCAD has no multileader. Its RLeaderEntity is a polyline plus an
 * arrowHead flag with NO text member, so a callout here is a LINKED
 * PAIR: one RTextEntity and one RLeaderEntity per branch, joined by a
 * shared CalloutId in CsTags XDATA.
 *
 * THIS FILE IS PURE. It takes and returns plain {x, y} objects, never
 * RVector, and never touches a document -- which is what lets
 * tests/js_unit.js run it under node. Every QCAD-shaped write lives in
 * Callout/CalloutWrite.js. Do not import a QCAD symbol here.
 */
function CsCallout() {}

/**
 * XDATA keys, under the CsTags "CaveSurvey" group. Nothing outside
 * this table may hard-code a tag string: a typo in a literal is a
 * silent orphan, and an orphaned member is a leader that no longer
 * reflows.
 */
CsCallout.KEY = {
    ID: "CalloutId",
    ROLE: "CalloutRole",
    KIND: "CalloutKind",
    STYLE: "CalloutStyle",
    SIDE: "CalloutSide",
    LEADER: "CalloutLeader",
    ELEV_BASIS: "ElevBasis",
    ELEV_FROM: "ElevFrom",
    ELEV_TO: "ElevTo",
    ELEV_FRACTION: "ElevFraction",
    ELEV_VALUE: "ElevValue",
    ELEV_MULTI: "ElevMulti",
    // A cross section's provenance -- which leg it was cut on and how
    // far along it, so a Draw can re-derive the whole thing. The same
    // idea as ELEV_FROM/ELEV_TO/ELEV_FRACTION one kind over.
    SECTION_FROM: "SectionFrom",
    SECTION_TO: "SectionTo",
    SECTION_FRACTION: "SectionFraction",
    SECTION_SCALE: "SectionScale",
    SECTION_ANGLES: "SectionAngles",
    SECTION_NEAREST: "SectionNearest",
    // Set by the caver: this section's geometry is theirs now, and
    // regeneration must leave it alone. A regenerated BLOCK cannot be
    // compared against "what it would have drawn" the way a text label
    // can, so the hand-edit guard is explicit rather than inferred.
    SECTION_FROZEN: "SectionFrozen"
    ,
    // A section TRACED from a scan rather than computed from LRUD.
    // SOURCE is the regeneration gate: refreshSections must never
    // redraw over hand tracing. The other three are what it takes to
    // reopen the bay and carry on tracing -- the revision framework's
    // rule, one kind over: the drawing is reconstructible from what is
    // stored on it.
    SECTION_SOURCE: "SectionSource",
    SECTION_SCAN: "SectionScan",
    SECTION_FIT: "SectionBayFit",
    SECTION_STATION: "SectionStationRef"
};

CsCallout.ROLE_TEXT = "text";
CsCallout.ROLE_LEADER = "leader";
// A section's content is a BLOCK REFERENCE, not text: one definition
// per section so it can be edited individually and dragged as a unit.
CsCallout.ROLE_BLOCK = "block";
CsCallout.KIND_TEXT = "text";
CsCallout.KIND_ELEV = "elev";
CsCallout.KIND_SECTION = "section";
/** The value of SECTION_SOURCE for a traced section. Absent means
 *  computed, so every section drawn before this existed keeps
 *  regenerating exactly as it did. */
CsCallout.SOURCE_SKETCH = "sketch";
CsCallout.BASIS_FLOOR = "floor";
CsCallout.BASIS_LINE = "line";

/** Style name -> layer. A callout member goes on its STYLE's layer,
 *  never on the current layer: a note drawn onto WALLS-SURVEYED
 *  silently becomes wall linework on the next layer-driven operation. */
CsCallout.STYLES = {
    // FIRST in this table on purpose: object key order is insertion
    // order, and pickableStyles() walks it, so this is what leads the
    // dropdown. It is also STYLE_DEFAULT below -- the plain note a caver
    // reaches for most is the one that should need no choosing.
    "notes": "NOTES-GENERAL",
    "hazard": "NOTES-HAZARD",
    "dig": "NOTES-DIG",
    "equipment": "NOTES-EQUIPMENT",
    "name": "NOTES-NAME",
    "elevation": "NOTES-ELEVATION",
    "elevation-line": "NOTES-ELEVATION-LINE",
    // Generated note labels -- the ones the suite draws itself from a
    // station's Note, not ones a caver places by hand. Its own layer so
    // regenerating the map can clear and redraw them without touching a
    // single hand-placed callout, and so a caver can turn the whole
    // generated layer off in one click. Kept OUT of the style picker
    // (see GENERATED_STYLES): offering it by hand would put a note on
    // the layer the next regenerate is entitled to wipe.
    "annotation": "NOTES-ANNOTATION"
};

/** Styles the suite generates and a caver must not pick by hand. */
CsCallout.GENERATED_STYLES = { "annotation": true };

/** The styles a human may choose, in picker order. */
CsCallout.pickableStyles = function() {
    var out = [];
    for (var name in CsCallout.STYLES) {
        if (CsCallout.STYLES.hasOwnProperty(name) &&
                !CsCallout.GENERATED_STYLES.hasOwnProperty(name)) {
            out.push(name);
        }
    }
    return out;
};

CsCallout.STYLE_DEFAULT = "notes";

// Leader SHAPE, a separate axis from the content style above: a hazard
// note and a dig note can each be drawn straight or curved.
CsCallout.LEADER_STRAIGHT = "straight";
CsCallout.LEADER_CURVED = "curved";
CsCallout.LEADER_DEFAULT = CsCallout.LEADER_STRAIGHT;

// A curved leader is drawn as SHORT STRAIGHT SEGMENTS tracing the
// curve, not as an arc.
//
// It was an arc first, carried as a QCAD polyline bulge on the
// tip-to-elbow segment. That worked in memory and CORRUPTED THE LEADER
// ON SAVE. Measured: a leader (10,10,bulge 0.35) -> (20,10) -> (22,10)
// came back from a DXF round trip as (20,10) -> (22,10) -> (0,0). The
// DXF LEADER record has no bulge concept, so the exporter dropped the
// arc's START vertex -- which is the ARROW TIP -- shifted the rest down
// and padded with a phantom vertex at the origin. A straight leader
// round-trips perfectly, so many small straight segments are safe where
// one arc is not.
//
// CURVE_OFFSET is how far the curve bows off the straight chord, as a
// fraction of the chord's own length, so the bow stays proportionate at
// any scale. CURVE_SEGMENTS is how finely it is traced: 8 reads as a
// curve at plot scale and keeps the leader's vertex list short enough to
// stay legible in the DXF.
CsCallout.CURVE_OFFSET = 0.18;
CsCallout.CURVE_SEGMENTS = 8;

/**
 * A fresh CalloutId. Delegates to CsUuid, the suite's general identity
 * library -- more dynamically linked labels and objects are planned and
 * they should all draw from one place. See CsUuid's own docblock for
 * when an opaque id is the right key and when a survey-meaningful one
 * is (CsBind's integer trip id being the counter-example).
 */
CsCallout.newId = function() {
    return CsUuid.v4();
};

/**
 * The text of an elevation callout.
 *
 * A "line" basis label must be UNMISTAKABLE. It carries a survey-line
 * elevation standing in for a floor nobody measured, and on a plotted
 * map an unmarked one reads as surveyed fact. Hence both the tilde and
 * the word LINE, plus its own muted layer via elevStyle().
 *
 * `multi` means the governing D had more than one reading: this is the
 * WALKABLE floor and there is a pit below it. The reader gets told,
 * because "1234.5" over a shaft is a dangerous kind of tidy.
 */
CsCallout.elevLabel = function(sample, suffix) {
    if (sample === null || sample === undefined ||
            sample.z === null || sample.z === undefined) {
        return null;
    }
    var sfx = (suffix === null || suffix === undefined) ? "" : suffix;
    var n = (Math.round(sample.z * 10) / 10).toFixed(1);
    if (sample.basis === CsCallout.BASIS_LINE) {
        return "~" + n + sfx + " LINE";
    }
    return n + sfx + (sample.multi ? " (pit)" : "");
};

/**
 * The style an elevation sample should be drawn in.
 *
 * A line-basis sample is FORCED onto the fallback style regardless of
 * what the caver picked, because the distinction is not a preference --
 * it is the difference between a measurement and a stand-in, and a plot
 * must not blur it.
 */
CsCallout.elevStyle = function(sample) {
    return (sample && sample.basis === CsCallout.BASIS_LINE) ?
        "elevation-line" : "elevation";
};

/**
 * Which side of the note the leader leaves from: "left" or "right".
 *
 * Shared so that the two callers cannot drift. reflow() passes the text
 * box's CENTRE, because by then the text exists. create() passes the
 * caver's PICK POINT, because the text does not exist yet and its width
 * is unknown -- and that is also what decides the text's own alignment,
 * so the note grows AWAY from the arrow and its near edge lands exactly
 * on the pick.
 *
 * A tie resolves LEFT (`<=`), which is the only case where the choice is
 * arbitrary; pinned by test so a refactor cannot silently flip it.
 */
CsCallout.sideFor = function(tips, referenceX) {
    var list = tips || [];
    if (list.length === 0) {
        return "left";
    }
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
        sum += list[i].x;
    }
    return ((sum / list.length) <= referenceX) ? "left" : "right";
};

/**
 * Solve the leader geometry for one callout.
 *
 * \param box  the text's bounding box as {x1, y1, x2, y2}, x1 < x2 and
 *             y1 < y2 -- plain numbers, NOT an RBox (this file is pure)
 * \param tips [{x, y}] one arrow tip per branch, possibly empty
 * \param opts {side: "auto"|"left"|"right",
 *              dimasz: number|null, dimscale: number|null}
 * \return {side, landing: {x, y}, branches: [[{x,y},{x,y},{x,y}]]}
 *
 * WHY THE LANDING ATTACHES AT THE VERTICAL MIDDLE and not at the first
 * line's baseline (which is the more AutoCAD-ish choice): these notes
 * get EDITED. A caver adds a second line to "bad air" and a
 * baseline-attached landing jumps by a full line height, so every arrow
 * in the callout visibly swings. Middle attachment moves by half a line
 * instead, and moves the same amount whichever end the line was added
 * to. The cost is that a tall multi-line note's arrow leaves from the
 * middle of the block rather than beside its first line; that reads
 * fine on a map and does not move when the note is reworded.
 */
CsCallout.reflow = function(box, tips, opts) {
    var o = opts || {};
    var list = tips || [];

    var height = Math.abs(box.y2 - box.y1);
    var centerX = (box.x1 + box.x2) / 2.0;
    var midY = (box.y1 + box.y2) / 2.0;

    // Landing length. dimasz x dimscale is the arrow size the drawing's
    // dimension style already uses, so a callout matches the sheet's
    // other annotation. Absent either, half the text height: a fixed
    // number would be wrong at every scale but one, and this drawing's
    // text height IS its scale, expressed.
    var landingLen;
    if (o.dimasz !== null && o.dimasz !== undefined &&
            o.dimscale !== null && o.dimscale !== undefined &&
            o.dimasz > 0 && o.dimscale > 0) {
        landingLen = o.dimasz * o.dimscale;
    } else {
        landingLen = height * 0.5;
    }

    // Side. "auto" compares the mean tip x against the box centre: the
    // landing should leave the text TOWARD the thing being pointed at,
    // or the leader crosses its own text.
    var side = o.side;
    if (side !== "left" && side !== "right") {
        side = CsCallout.sideFor(list, centerX);
    }

    var landing = {
        x: (side === "left") ? box.x1 : box.x2,
        y: midY
    };
    var elbowX = (side === "left") ?
        (landing.x - landingLen) : (landing.x + landingLen);

    // A curved leader bows the TIP-TO-ELBOW segment only. The shoulder
    // stays straight, because that is the segment the text sits against
    // and a curved landing reads as a mistake rather than a style.
    //
    // The curve is a quadratic Bezier from tip to elbow, sampled into
    // CURVE_SEGMENTS straight pieces. Its control point sits off the
    // midpoint of the chord, perpendicular to it, on the side that bows
    // AWAY from the note -- so a left-hand and a right-hand leader are
    // mirror images rather than one of them curling back over itself.
    var curved = (o.leader === CsCallout.LEADER_CURVED);

    var branches = [];
    for (var k = 0; k < list.length; k++) {
        var tip = { x: list[k].x, y: list[k].y };
        var elbow = { x: elbowX, y: landing.y };
        var pts = [];

        if (!curved) {
            pts.push({ x: tip.x, y: tip.y, bulge: 0.0 });
        } else {
            var dx = elbow.x - tip.x;
            var dy = elbow.y - tip.y;
            var chord = Math.sqrt(dx * dx + dy * dy);
            if (chord < 1e-9) {
                // tip and elbow coincide: there is no chord to bow off,
                // and inventing one would draw a loop out of nothing
                pts.push({ x: tip.x, y: tip.y, bulge: 0.0 });
            } else {
                // perpendicular, pointing away from the note
                var sign = (side === "left") ? 1.0 : -1.0;
                var px = -dy / chord * chord * CsCallout.CURVE_OFFSET * sign;
                var py = dx / chord * chord * CsCallout.CURVE_OFFSET * sign;
                var ctrl = {
                    x: (tip.x + elbow.x) / 2.0 + px,
                    y: (tip.y + elbow.y) / 2.0 + py
                };
                for (var sIdx = 0; sIdx < CsCallout.CURVE_SEGMENTS; sIdx++) {
                    var t = sIdx / CsCallout.CURVE_SEGMENTS;
                    var mt = 1.0 - t;
                    pts.push({
                        x: mt * mt * tip.x + 2 * mt * t * ctrl.x +
                            t * t * elbow.x,
                        y: mt * mt * tip.y + 2 * mt * t * ctrl.y +
                            t * t * elbow.y,
                        bulge: 0.0
                    });
                }
            }
        }

        pts.push({ x: elbow.x, y: elbow.y, bulge: 0.0 });
        pts.push({ x: landing.x, y: landing.y, bulge: 0.0 });
        branches.push(pts);
    }

    return { side: side, landing: landing, branches: branches,
             leader: curved ? CsCallout.LEADER_CURVED :
                              CsCallout.LEADER_STRAIGHT };
};
