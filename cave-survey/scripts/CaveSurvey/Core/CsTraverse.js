// Traverse.js -- one shot to a coordinate offset. The shortest file in
// Core, and the one that fixes the suite's oldest bug.
//
// Part of the Cave Survey Core library: pure functions.
//
// Compass, Walls and Survex tape lengths are SLOPE distances -- the
// tape is stretched along the shot, not held level. So:
//
//   plan offset = distance * cos(inclination)
//   rise        = distance * sin(inclination)
//
// The previous generation of these tools treated the tape as already
// horizontal (plan = distance, rise = distance * tan(inclination)),
// which plots every inclined passage too long -- 15% too long at 30
// degrees -- and overstates the rise steeply. tapeMode "horizontal"
// preserves that interpretation for data genuinely recorded that way
// (some old US surveys with a level tape), but "slope" is what the
// file formats mean and is the default everywhere.

var CsTraverse = {};

CsTraverse.SLOPE = "slope";
CsTraverse.HORIZONTAL = "horizontal";

/**
 * Inclination magnitude (degrees) at and beyond which a shot IS a
 * pitch rather than a steep passage.
 *
 * THE ONE DEFINITION. Two modules had independently arrived at 85 and
 * said so in prose -- CsValidate's near-plumb warning and CsProfile's
 * passage-direction rule -- and a third question, unwritten until now,
 * has the same answer: whether this leg's COMPASS reading means
 * anything. A magnetic bearing sighted along a near-vertical shot is
 * noise; the needle swings, the caver is hanging on a rope, and the
 * number written down is a formality. Past this angle a bearing is not
 * evidence of a passage direction, and a good deal of geometry
 * downstream depends on agreeing about where that line is. It lives
 * here, in the lowest file in the Core, so the agreement is structural
 * rather than three comments promising each other.
 *
 * WHY 85 AND NOT 89. At 85 degrees a 100 ft shot still has 8.7 ft of
 * plan projection, which is a real horizontal offset and is plotted as
 * one -- "plumb" here does NOT mean "draw it straight down", it means
 * "do not read this leg's compass as a passage bearing". Nothing in
 * this codebase snaps geometry to vertical; the coordinates always
 * come from the numbers as recorded.
 */
CsTraverse.PLUMB_DEG = 85.0;

/**
 * True when a shot is a pitch by the rule above -- an aven (+) as much
 * as a drop (-). Reads the EFFECTIVE inclination, so a plumb recorded
 * with a backsight is still a plumb.
 *
 * An unusable inclination is NOT plumb: absent evidence is not
 * evidence of vertical, the same way `unusable` refuses to let an
 * absent reading act as a measured zero.
 */
CsTraverse.isPlumb = function(shot) {
    if (shot === null || shot === undefined) {
        return false;
    }
    var inc = CsTraverse.effectiveInclination(shot);
    if (CsTraverse.unusable(inc)) {
        return false;
    }
    return Math.abs(inc) >= CsTraverse.PLUMB_DEG;
};

/**
 * The azimuth a shot is computed with. With only a foresight, that
 * foresight; with a backsight too, the circular mean of the foresight
 * and the reversed backsight -- the standard fs/bs correction, worth
 * half the instrument error for free.
 */
CsTraverse.effectiveAzimuth = function(shot) {
    if (shot.backAzimuth === null || shot.backAzimuth === undefined) {
        return shot.azimuth;
    }
    var fs = shot.azimuth * Math.PI / 180.0;
    var bs = (shot.backAzimuth + 180.0) * Math.PI / 180.0;
    // circular mean, so 359/001 averages to 0, not 180:
    var x = Math.cos(fs) + Math.cos(bs);
    var y = Math.sin(fs) + Math.sin(bs);
    var mean = Math.atan2(y, x) * 180.0 / Math.PI;
    return ((mean % 360.0) + 360.0) % 360.0;
};

/** Same for inclination: backsight reads sign-flipped. */
CsTraverse.effectiveInclination = function(shot) {
    if (shot.backInclination === null || shot.backInclination === undefined) {
        return shot.inclination;
    }
    return (shot.inclination + (-shot.backInclination)) / 2.0;
};

/**
 * True when a reading cannot function as part of a real measurement:
 * absent (`null`/`undefined`) or not finite (`NaN`, `+-Infinity`).
 * NOT true for `0` -- a zero distance/azimuth/inclination IS a
 * measurement (the wall is at the station; a dead-level or
 * due-north shot really is that), and must be treated exactly like
 * any other real number. This is the one-line reason the guard below
 * exists at all: in JavaScript, `null * Math.cos(x)` is `0` (a
 * fabricated coordinate wearing a real measurement's confidence) and
 * `undefined * Math.cos(x)` is `NaN` (a coordinate that poisons every
 * downstream computation with it). Neither is a measurement; `0` is.
 *
 * MUST be `typeof v !== "number"`, not a plain `!isFinite(v)` check:
 * global `isFinite` COERCES its argument first, and `isFinite("")` is
 * `true` (`""` coerces to `0`). A blank string is the commonest
 * textual encoding of "absent" (a blank spreadsheet cell, a blank
 * notebook field before this codebase's own parsers turn it into a
 * real value or a real absence) -- `unusable("")` must be `true`, and
 * with a bare `isFinite` it silently was not, admitting exactly the
 * fabrication this function exists to refuse. Every shot field is a
 * number by the time it reaches here (every parser `parseFloat`s), so
 * requiring `typeof v === "number"` costs nothing on real input.
 */
CsTraverse.unusable = function(v) {
    return typeof v !== "number" || !isFinite(v);
};

/**
 * The offset a shot moves, as {dx, dy, dz, plan}: drawing-plane x/y,
 * vertical rise, and the plan-projected length.
 *
 * Returns `null` -- not a coordinate -- when `distance` or the
 * EFFECTIVE (fs/bs-corrected) azimuth or inclination is absent or
 * non-finite. See `CsTraverse.unusable` for exactly why `null`/
 * `undefined` are refused here while `0` is not: this is the
 * distinction that keeps a splay with no distance from drawing AT its
 * station, and a splay with no inclination from drawing dead level,
 * as though either were a real reading. Every caller MUST check for
 * `null` and skip the shot -- never substitute a zero, which is
 * exactly the fabrication this guard exists to stop.
 *
 * \param shot {distance, azimuth, inclination} (degrees; azimuth
 *             clockwise from north)
 * \param tapeMode CsTraverse.SLOPE (default) or HORIZONTAL
 * \return {dx, dy, dz, plan} or `null`
 */
CsTraverse.offset = function(shot, tapeMode) {
    var az = CsTraverse.effectiveAzimuth(shot);
    var inc = CsTraverse.effectiveInclination(shot);
    if (CsTraverse.unusable(shot.distance) || CsTraverse.unusable(az) ||
            CsTraverse.unusable(inc)) {
        return null;
    }

    var azRad = az * Math.PI / 180.0;
    var incRad = inc * Math.PI / 180.0;

    var plan, dz;
    if (tapeMode === CsTraverse.HORIZONTAL) {
        // A HELD-LEVEL TAPE CANNOT MEASURE A PLUMB. Under the
        // horizontal convention the tape IS the plan distance and the
        // rise is plan * tan(inc), which at +/-90 is infinite: there is
        // no horizontal tape reading that gets you down a pitch. Left
        // ungated this returned {dx: Infinity, dy: NaN, dz: Infinity}
        // -- coordinates that pass every finite check downstream
        // because callers test for `null`, not for infinity, and then
        // poison a bounding box, a zoom extent or a least-squares
        // normal matrix somewhere far away. Refusing it is the same
        // contract `unusable` already sets: a reading that cannot be a
        // measurement is `null`, never a number.
        //
        // Unreachable from any importer today (the file formats all
        // mean slope distance, and SLOPE is the default everywhere),
        // but reachable the moment a user switches an old level-tape
        // survey to HORIZONTAL and it contains one plumbed pitch --
        // which is exactly what old US surveys of vertical caves look
        // like.
        if (Math.abs(inc) >= 90.0 - 1e-9) {
            return null;
        }
        plan = shot.distance;
        dz = shot.distance * Math.tan(incRad);
    } else {
        plan = shot.distance * Math.cos(incRad);
        dz = shot.distance * Math.sin(incRad);
    }

    return {
        dx: plan * Math.sin(azRad),
        dy: plan * Math.cos(azRad),
        dz: dz,
        plan: plan
    };
};

/**
 * The same shot walked backwards (for resolving against a known TO).
 * Passes a `null` offset straight through -- negating `undefined`
 * fields would itself fabricate NaN geometry, the exact failure mode
 * `offset` above exists to refuse.
 */
CsTraverse.reverseOffset = function(shot, tapeMode) {
    var o = CsTraverse.offset(shot, tapeMode);
    if (o === null) {
        return null;
    }
    return { dx: -o.dx, dy: -o.dy, dz: -o.dz, plan: o.plan };
};
