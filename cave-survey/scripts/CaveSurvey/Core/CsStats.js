// Stats.js -- the numbers the title block wants.
//
// Part of the Cave Survey Core library: pure functions.

var CsStats = {};

/**
 * \param survey the CsModel survey
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   surveyedLength   sum of tape lengths of the shots that count for
 *                    length -- see CsStats.countsForLength, which
 *                    excludes duplicates and surface legs as well as
 *                    splays
 *   planLength       same shots projected to plan
 *   stationCount
 *   shotCount
 *   loopCount
 *   depth            vertical range over resolved stations
 *   highest, lowest  station names at the extremes
 *   worstLoop        the loop with the largest percent error, or null
 * } -- lengths in survey.distanceUnit.
 */
/**
 * True when a shot's tape belongs in the cave's LENGTH.
 *
 * THE ONE RULE, so CsStats and CsContrib cannot disagree in front of a
 * reader looking at a title block and a contributions window side by
 * side.
 *
 * excludeFromLength is what makes this more than a copy of "is it
 * drawn": a duplicate leg (Compass L, Survex *flags duplicate, CSV
 * flag L) and a surface leg are both PLOTTED and both out of the
 * length, which is exactly the distinction a caver means by re-shooting
 * a passage. Counting them inflates the one number a cave is quoted by
 * -- Pitfall Cave over-reported by 51.40 ft in 2457.71, and nothing in
 * the suite noticed until the fixture's own manifest was made
 * executable (tests/pitfall_audit.js, pitfalls 21 and 22).
 *
 * A splay has no length of its own, a shot with no far end never
 * happened, and excludeFromAll is out of the survey entirely.
 */
CsStats.countsForLength = function(shot) {
    return !(shot.excludeFromAll || shot.excludeFromLength || shot.splay ||
        shot.from === "" || shot.to === "");
};

CsStats.compute = function(survey, resolved, tapeMode) {
    var surveyed = 0.0;
    var plan = 0.0;
    var shotCount = 0;

    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (!CsStats.countsForLength(s)) {
            continue;
        }
        shotCount++;
        surveyed += s.distance;
        plan += CsTraverse.offset(s, tapeMode).plan;
    }

    var minZ = null, maxZ = null, highest = "", lowest = "";
    var stationCount = 0;
    for (var name in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(name)) {
            continue;
        }
        stationCount++;
        var z = resolved.stations[name].z;
        if (minZ === null || z < minZ) {
            minZ = z;
            lowest = name;
        }
        if (maxZ === null || z > maxZ) {
            maxZ = z;
            highest = name;
        }
    }

    var worstLoop = null;
    for (i = 0; i < resolved.loops.length; i++) {
        if (worstLoop === null || resolved.loops[i].percent > worstLoop.percent) {
            worstLoop = resolved.loops[i];
        }
    }

    return {
        surveyedLength: surveyed,
        planLength: plan,
        stationCount: stationCount,
        shotCount: shotCount,
        loopCount: resolved.loops.length,
        depth: (minZ === null) ? 0.0 : (maxZ - minZ),
        highest: highest,
        lowest: lowest,
        worstLoop: worstLoop
    };
};
