// Grade.js -- the honest survey grade, computed from the data rather
// than asserted by the user.
//
// Part of the Cave Survey Core library: pure functions.
//
// Grades follow BCRA: centreline 1-6 (and X, which is theodolite work
// this suite will never see), passage detail a-d. The UIS composite is
// written "UISv2 <centreline>-<detail>".
//
// HONESTY RULES. The data can prove a grade DOWN but only support one
// UP: loop misclosure can demonstrate a survey is not grade 5, but a
// survey with no loops proves nothing, and instrument precision is
// not recorded in any of the file formats. So the result carries both
// the number and the reasoning, and the reasoning is always shown.
// Because these tools compute coordinates rather than plotting by
// protractor, the "drawn up by calculation" requirement of grade 5 is
// met automatically -- worth telling the user, so we do.

var CsGrade = {};

/**
 * \return {
 *   centreline: 2..5,
 *   centrelineText: e.g. "5 (supported by 2 loops closing under 1%)",
 *   detail: "a".."d",
 *   detailText: reasoning,
 *   uis: "UISv2 5-c",
 *   notes: [plain-language notes]
 * }
 */
CsGrade.compute = function(survey, resolved, stats) {
    var notes = [];

    // ---- centreline grade from loop closure ----------------------
    var centreline, centrelineText;
    if (resolved.loops.length === 0) {
        centreline = 3;
        centrelineText = "3 (no loops -- nothing to verify a higher grade against)";
        notes.push("No closed loops: closure cannot verify the survey, so the " +
            "defensible centreline grade stays at 3. Tie in a loop to support 5.");
    } else {
        var worst = 0.0;
        for (var i = 0; i < resolved.loops.length; i++) {
            if (resolved.loops[i].percent > worst) {
                worst = resolved.loops[i].percent;
            }
        }
        var loopWord = resolved.loops.length === 1 ?
            "1 loop" : resolved.loops.length + " loops";
        if (worst <= 1.0) {
            centreline = 5;
            centrelineText = "5 (" + loopWord + ", worst closure " +
                worst.toFixed(2) + "%)";
        } else if (worst <= 5.0) {
            centreline = 3;
            centrelineText = "3 (worst loop closure " + worst.toFixed(1) +
                "% -- grade 5 expects under 1%)";
        } else {
            centreline = 2;
            centrelineText = "2 (worst loop closure " + worst.toFixed(1) +
                "% -- likely a blunder; resurvey recommended)";
        }
    }
    notes.push("Coordinates are computed, not protractor-plotted, which " +
        "grade 5 requires -- that condition is met automatically here.");

    // ---- detail grade from LRUD coverage --------------------------
    var stationsWithLrud = 0;
    var stationNames = CsModel.stationNames(survey);
    for (i = 0; i < stationNames.length; i++) {
        if (CsModel.lrudForStation(survey, stationNames[i]) !== null) {
            stationsWithLrud++;
        }
    }
    var detail, detailText;
    var coverage = stationNames.length > 0 ?
        stationsWithLrud / stationNames.length : 0.0;
    // The first station of a traverse legitimately has no incoming
    // LRUD, so full coverage in practice is (n-1)/n.
    if (stationNames.length > 0 &&
        stationsWithLrud >= stationNames.length - 1) {
        detail = "c";
        detailText = "c (passage dimensions recorded at every station)";
        notes.push("Grade d additionally requires stations placed at every " +
            "significant passage change -- that is a judgment the data " +
            "cannot make for you.");
    } else if (coverage >= 0.5) {
        detail = "b";
        detailText = "b (LRUD at " + stationsWithLrud + " of " +
            stationNames.length + " stations -- grade c needs all of them)";
    } else if (stationsWithLrud > 0) {
        detail = "b";
        detailText = "b (LRUD at only " + stationsWithLrud + " of " +
            stationNames.length + " stations)";
    } else {
        detail = "a";
        detailText = "a (no passage dimensions recorded)";
    }

    return {
        centreline: centreline,
        centrelineText: centrelineText,
        detail: detail,
        detailText: detailText,
        uis: "UISv2 " + centreline + "-" + detail,
        notes: notes
    };
};
