// make_mixed_cave.js -- builds STAIRSTEP CAVE: a cave with both kinds
// of passage tangled together, which is what most caves actually are.
//
//   node tools/make_mixed_cave.js
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_mixed_cave.js "$PWD"
//
// The third fixture, and the one that exists because the first two are
// each only half a cave:
//
//   PITFALL CAVE     2400 ft long, 143 ft deep. Horizontal, with three
//                    drops in it almost incidentally.
//   PLUMBLINE PIT     700 ft long, 380 ft deep. Vertical, with a few
//                    crawls in it almost incidentally.
//   STAIRSTEP CAVE   both, interleaved, at the same scale -- a
//                    vertical entrance series into a long wandering
//                    upper level, a staircase of small drops down to a
//                    lower streamway wandering the other way beneath
//                    it, and avens climbing back up between the two.
//
// WHY A THIRD. Nothing in this suite declares what kind of cave it is
// looking at; the layout of an elevation is decided per PIECE, from
// that piece's own geometry (CsChunk.foldOf against CsChunk.FOLD_LIMIT).
// Two fixtures could only ever prove that rule answers correctly at
// its extremes -- Pitfall's trunk folds by 0.42 and unrolls, every
// piece of Plumbline folds by under 0.01 and does not. Neither of them
// puts a piece anywhere NEAR the line, and neither of them puts the
// two kinds in the same drawing where they have to coexist rather than
// merely both be handled.
//
// So this cave is built to be awkward on purpose:
//
//   * an upper trunk and a lower streamway that OVERLAP IN PLAN, which
//     is what a multi-level cave does and what a plan view cannot show;
//   * a staircase of four small drops separated by short passage --
//     chunk boundaries every few stations, where Plumbline's are
//     hundreds of feet apart;
//   * a piece deliberately shaped to fold NEAR the threshold, because
//     a limit tested only at 0.42 and 0.01 has never actually been
//     tested;
//   * a loop that runs down a pitch and back up an aven, so a closure
//     spans both kinds of passage and the adjustment has to weight a
//     plumbed leg and a compass leg in the same circuit;
//   * a GPS fix on a second entrance, as a control tie.
//
// PRIVACY: synthetic, like the others. The entrance sits at a
// plausible but arbitrary point in the Greenbrier karst of West
// Virginia -- long horizontal stream caves entered through vertical
// shafts, which is exactly the type this fixture is -- and it is not a
// cave. No real entrance appears anywhere in these files.

var IS_NODE = (typeof process !== "undefined" && process.versions &&
    process.versions.node !== undefined);

var repoRoot;
var readTextFile;
var writeTextFile;

if (IS_NODE) {
    var nodeFs = require("fs");
    var nodePath = require("path");
    repoRoot = nodePath.resolve(__dirname, "..");
    readTextFile = function(path) {
        return nodeFs.readFileSync(path, "utf8");
    };
    writeTextFile = function(path, content) {
        nodeFs.writeFileSync(path, content, "utf8");
    };
} else {
    var qargs = RSettings.getOriginalArguments();
    repoRoot = qargs[qargs.length - 1];
    readTextFile = function(path) {
        var file = new QFile(path);
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            throw new Error("cannot open " + path);
        }
        var stream = new QTextStream(file);
        var content = stream.readAll();
        file.close();
        return content;
    };
    writeTextFile = function(path, content) {
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate |
                QIODevice.Text)) {
            throw new Error("cannot write " + path);
        }
        var out = new QTextStream(file);
        out.writeString(content);
        file.close();
    };
}

var loaded = {};
function loadRepoScript(scriptPath) {
    if (loaded[scriptPath]) {
        return;
    }
    loaded[scriptPath] = true;
    var source = readTextFile(repoRoot + "/" + scriptPath);
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(source);
}

var CORE_FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsIgrfCoeffs.js",
    "scripts/CaveSurvey/Core/CsGeomag.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsAdjust.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
    "scripts/CaveSurvey/Core/CsProfile.js",
    "scripts/CaveSurvey/Core/CsValidate.js",
    "scripts/CaveSurvey/Core/CsStats.js",
    "scripts/CaveSurvey/Core/CsGrade.js",
    "scripts/CaveSurvey/Core/Format/CsCompass.js",
    "scripts/CaveSurvey/Core/Format/CsWalls.js",
    "scripts/CaveSurvey/Core/Format/CsSurvex.js",
    "scripts/CaveSurvey/Core/Format/CsCsv.js",
    "scripts/CaveSurvey/Core/Format/CsTherion.js",
    "scripts/CaveSurvey/Core/Format/CsRegistry.js"
];
for (var ci = 0; ci < CORE_FILES.length; ci++) {
    loadRepoScript(CORE_FILES[ci]);
}

// Deterministic: the splay rings run off a seeded LCG so the numbers
// in the manifest stay true across regenerations.
var SEED = 20260920;
function rnd() {
    SEED = (SEED * 1103515245 + 12345) % 2147483648;
    return SEED / 2147483648;
}
function between(lo, hi) {
    return lo + (hi - lo) * rnd();
}
function round(v, places) {
    var f = Math.pow(10, places);
    return Math.round(v * f) / f;
}

var CORE_FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsIgrfCoeffs.js",
    "scripts/CaveSurvey/Core/CsGeomag.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsAdjust.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
    "scripts/CaveSurvey/Core/CsPitch.js",
    "scripts/CaveSurvey/Core/CsProfile.js",
    "scripts/CaveSurvey/Core/CsProject.js",
    "scripts/CaveSurvey/Core/CsChunk.js",
    "scripts/CaveSurvey/Core/CsValidate.js",
    "scripts/CaveSurvey/Core/CsStats.js",
    "scripts/CaveSurvey/Core/CsGrade.js",
    "scripts/CaveSurvey/Core/Format/CsCompass.js",
    "scripts/CaveSurvey/Core/Format/CsWalls.js",
    "scripts/CaveSurvey/Core/Format/CsSurvex.js",
    "scripts/CaveSurvey/Core/Format/CsCsv.js",
    "scripts/CaveSurvey/Core/Format/CsTherion.js",
    "scripts/CaveSurvey/Core/Format/CsRegistry.js"
];
for (var ci = 0; ci < CORE_FILES.length; ci++) {
    loadRepoScript(CORE_FILES[ci]);
}

// Deterministic: the meanders run off a seeded LCG so the numbers in
// the manifest stay true across regenerations.
var SEED = 20260921;
function rnd() {
    SEED = (SEED * 1103515245 + 12345) % 2147483648;
    return SEED / 2147483648;
}
function between(lo, hi) {
    return lo + (hi - lo) * rnd();
}
function round(v, places) {
    var f = Math.pow(10, places);
    return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------
// WHERE THE CAVE IS. An arbitrary rural point in the Greenbrier
// Valley, West Virginia: a limestone belt whose caves are long
// horizontal stream passages entered down vertical shafts, which is
// the shape this fixture is. It is NOT a cave.
//
// Entrance elevation 2180.00 ft -- ridge-top plausible there, and
// deliberately not zero.
// ---------------------------------------------------------------------

var GEO = {
    station: "A1",
    lat: 37.8024,
    lon: -80.4517,
    elevationFt: 2180.00
};

/** The true IGRF-14 declination at the entrance on a YYYY-MM-DD. */
function declinationOn(dateText) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
    var field = CsGeomag.declination(GEO.lat, GEO.lon, {
        year: parseInt(m[1], 10),
        month: parseInt(m[2], 10),
        day: parseInt(m[3], 10)
    });
    if (field === null) {
        throw new Error("no IGRF coefficients for " + dateText);
    }
    return round(field.declination, 2);
}

function newBuilder(caveName, unit) {
    var survey = CsModel.newSurvey();
    survey.caveName = caveName;
    survey.distanceUnit = unit;
    survey.trips = [];

    var b = { survey: survey, pos: {}, trip: 0, heading: 0.0 };

    b.addTrip = function(name, date, team, declination, source) {
        var t = CsModel.newTrip();
        t.name = name;
        t.date = date;
        t.team = team;
        t.declination = declination;
        t.declinationSource = source || "IGRF-14";
        t.distanceUnit = unit;
        survey.trips.push(t);
        b.trip = survey.trips.length - 1;
        return b.trip;
    };

    b.useTrip = function(index) {
        b.trip = index;
    };

    b.fix = function(name, x, y, z) {
        survey.fixed[name] = { x: x, y: y, z: z };
        if (b.pos[name] === undefined) {
            b.pos[name] = { x: x, y: y, z: z };
        }
    };

    /**
     * One leg. opts:
     *   lrud            [l, r, u, d]; null entries are "not measured"
     *   open            [L, R, U, D] booleans; a true side was written
     *                   "P" -- looked at, found open. NEVER paired
     *                   with a number on the same side.
     *   azimuthOmitted  true when the notes carry a dash where the
     *                   compass reading goes
     *   backInclination, backAzimuth, notes, flags, place:false
     */
    b.leg = function(from, to, dist, az, inc, opts) {
        opts = opts || {};
        var s = CsModel.newShot();
        s.from = from;
        s.to = to;
        s.distance = round(dist, 2);
        s.azimuth = round(CsAngles.normalizeAzimuth(az), 2);
        s.inclination = round(inc, 2);
        s.trip = b.trip;
        s.azimuthOmitted = opts.azimuthOmitted === true;
        s.declination = opts.declination !== undefined ?
            opts.declination : survey.trips[b.trip].declination;
        if (opts.lrud !== undefined) {
            s.left = opts.lrud[0];
            s.right = opts.lrud[1];
            s.up = opts.lrud[2];
            s.down = opts.lrud[3];
        }
        if (opts.open !== undefined) {
            s.leftOpen = opts.open[0] === true;
            s.rightOpen = opts.open[1] === true;
            s.upOpen = opts.open[2] === true;
            s.downOpen = opts.open[3] === true;
        }
        if (opts.backAzimuth !== undefined) {
            s.backAzimuth = round(CsAngles.normalizeAzimuth(opts.backAzimuth), 2);
        }
        if (opts.backInclination !== undefined) {
            s.backInclination = round(opts.backInclination, 2);
        }
        if (opts.notes !== undefined) {
            s.notes = opts.notes;
        }
        s.excludeFromPlot = opts.excludeFromPlot === true;
        s.excludeFromAll = opts.excludeFromAll === true;
        s.excludeFromLength = opts.excludeFromLength === true;
        s.noAdjust = opts.noAdjust === true;
        survey.shots.push(s);

        if (opts.place !== false && b.pos[from] !== undefined &&
                b.pos[to] === undefined) {
            var off = CsTraverse.offset(s, CsTraverse.SLOPE);
            b.pos[to] = {
                x: b.pos[from].x + off.dx,
                y: b.pos[from].y + off.dy,
                z: b.pos[from].z + off.dz
            };
        }
        b.heading = s.azimuth;
        return s;
    };

    /** A wall shot: no TO station, splay flag set. */
    b.splay = function(from, dist, az, inc, notes) {
        var s = CsModel.newShot();
        s.from = from;
        s.to = "";
        s.splay = true;
        s.distance = round(dist, 2);
        s.azimuth = round(CsAngles.normalizeAzimuth(az), 2);
        s.inclination = round(inc, 2);
        s.trip = b.trip;
        s.declination = survey.trips[b.trip].declination;
        if (notes !== undefined) {
            s.notes = notes;
        }
        survey.shots.push(s);
        return s;
    };

    /** The exact leg between two placed stations, times distFactor. */
    b.closeLeg = function(from, to, distFactor, azError, opts) {
        var a = b.pos[from], c = b.pos[to];
        if (a === undefined || c === undefined) {
            throw new Error("closeLeg needs both stations placed: " +
                from + " -> " + to);
        }
        var dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z;
        var plan = Math.sqrt(dx * dx + dy * dy);
        var dist = Math.sqrt(plan * plan + dz * dz);
        var az = CsAngles.normalizeAzimuth(
            Math.atan2(dx, dy) * 180.0 / Math.PI);
        var inc = Math.atan2(dz, plan) * 180.0 / Math.PI;
        opts = opts || {};
        opts.place = false;
        return b.leg(from, to, dist * distFactor, az + azError, inc, opts);
    };

    /**
     * A ring of wall shots around a station. In a shaft these come out
     * STEEP -- the walls of a bell chamber flare away above the floor
     * and the party sights up at them -- which is the case the plan's
     * wall builder has no steepness filter for and the profile's
     * splay classifier does.
     */
    b.splayRing = function(station, opts) {
        opts = opts || {};
        var rays = opts.rays === undefined ? 8 : opts.rays;
        for (var r = 0; r < rays; r++) {
            var az = (360.0 / rays) * r + between(-6, 6);
            var dist = between(opts.minDist || 8, opts.maxDist || 26);
            var inc = between(opts.incLo === undefined ? -8 : opts.incLo,
                opts.incHi === undefined ? 8 : opts.incHi);
            b.splay(station, dist, az, inc);
        }
    };

    return b;
}


// ---------------------------------------------------------------------
// A MEANDERING RUN, which is what makes a piece FOLD.
//
// The fold measurement (CsChunk.foldOf) compares how far a piece walks
// along its own plane with how much of that plane it occupies. A
// passage that wanders doubles back over itself and folds; one that
// runs straight does not. So the turn range below is not decoration --
// it is the dial that decides whether a piece unrolls or projects, and
// this fixture sets it deliberately per run.
// ---------------------------------------------------------------------

function meander(b, fromName, prefix, firstIndex, count, opts) {
    opts = opts || {};
    var incLo = opts.incLo === undefined ? -3 : opts.incLo;
    var incHi = opts.incHi === undefined ? 3 : opts.incHi;
    var distLo = opts.distLo === undefined ? 18 : opts.distLo;
    var distHi = opts.distHi === undefined ? 44 : opts.distHi;
    var turn = opts.turn === undefined ? 34 : opts.turn;
    var prev = fromName, last = fromName;
    for (var i = 0; i < count; i++) {
        var name = prefix + (firstIndex + i);
        var az = b.heading + between(-turn, turn);
        if (opts.swing !== undefined) {
            // A deliberate back-and-forth on top of the wander: the
            // passage swings either side of its own trend, which is
            // what folds it onto itself once projected.
            az += opts.swing * Math.sin(i * (opts.swingRate || 0.8));
        }
        b.leg(prev, name, between(distLo, distHi), az,
            between(incLo, incHi), {
                lrud: [round(between(1.5, 8), 1), round(between(1.5, 8), 1),
                    round(between(2, 13), 1), round(between(0.2, 2.5), 1)],
                notes: opts.noteAt === i ? opts.note : undefined
            });
        prev = name;
        last = name;
    }
    return last;
}

// ---------------------------------------------------------------------
// STAIRSTEP CAVE
//
//   A1  sinkhole, 2180.00 ft
//    |  climb down to the lip
//   A3  P1, 40 ft
//   A4  short traverse
//   A5  P2, 65 ft in two pitches with a rebelay
//   A7  ------------------------------- the UPPER LEVEL starts here
//        |
//        B1..B34   UPPER TRUNK, wandering hard. Folds; unrolls.
//        |   \_ BB1..BB4  a side branch off the middle of it
//        |
//       C1..C14   THE STAIRSTEP: four small drops with short passage
//        |        between them, so chunk boundaries fall every few
//        |        stations instead of every few hundred feet
//        |
//       D1..D30   LOWER STREAMWAY, wandering the OTHER way, directly
//        |        under the upper trunk in plan. Folds; unrolls.
//        |        Ends at a sump.
//        |
//       E1..E4    an AVEN climbed from the streamway back up into the
//                 upper trunk, closing a loop that runs DOWN a pitch
//                 and back UP an aven
//
//   F1..F3        a second entrance, with a GPS fix on it: a control
//                 tie whose misclosure is mostly vertical
// ---------------------------------------------------------------------

function buildStairstepCave() {
    var b = newBuilder("STAIRSTEP CAVE (TEST)", "ft");

    var d0411 = declinationOn("2026-04-11");
    var d0502 = declinationOn("2026-05-02");
    var d0530 = declinationOn("2026-05-30");
    var d0620 = declinationOn("2026-06-20");
    var d0711 = declinationOn("2026-07-11");

    var tEntrance = b.addTrip("ENTRANCE SERIES", "2026-04-11",
        "N. SCHONEGG, R. WEBB", d0411);
    var tUpper = b.addTrip("UPPER TRUNK", "2026-05-02",
        "N. SCHONEGG, T. HALE", d0502);
    var tStair = b.addTrip("THE STAIRSTEP", "2026-05-30",
        "R. WEBB, K. AYERS", d0530);
    var tLower = b.addTrip("LOWER STREAMWAY", "2026-06-20",
        "K. AYERS, D. OTT", d0620);
    var tAven = b.addTrip("AVEN CONNECTION", "2026-07-11",
        "N. SCHONEGG, J. PARK", d0711);

    // ---- the vertical entrance ------------------------------------
    b.useTrip(tEntrance);
    b.fix("A1", 0.0, 0.0, GEO.elevationFt);
    survey_startLrud(b, { left: 7.0, right: 6.0, up: null, down: 0.0,
        upOpen: true });

    b.leg("A1", "A2", 14.00, 120.0, -18.0,
        { lrud: [5.0, 4.0, 10.0, 0.0], notes: "SINKHOLE FLOOR" });
    b.leg("A2", "A3", 10.00, 142.0, -46.0,
        { lrud: [2.5, 2.0, 7.0, 0.0], notes: "LIP OF P1; ONE BOLT AND A THREAD" });
    b.leg("A3", "A4", 40.00, 0.0, -90.0,
        { azimuthOmitted: true,
          lrud: [4.0, 5.0, null, 0.0], open: [false, false, true, false],
          notes: "P1, 40 FT" });
    b.leg("A4", "A5", 12.00, 88.0, -4.0,
        { lrud: [3.0, 4.0, 9.0, 0.0], notes: "TRAVERSE TO THE HEAD OF P2" });
    // P2 in two, with a rebelay: one pitch of 65 ft to every rule that
    // matters, and two rope sections to a rigging party.
    b.leg("A5", "A6", 25.00, 0.0, -90.0,
        { azimuthOmitted: true,
          lrud: [3.0, 3.0, null, 0.0], open: [false, false, true, false],
          notes: "P2 UPPER; REBELAY" });
    b.leg("A6", "A7", 40.00, 0.0, -90.0,
        { azimuthOmitted: true, backInclination: 90.0,
          lrud: [12.0, 14.0, null, 0.0], open: [false, false, true, false],
          notes: "P2 LOWER; LANDS IN THE UPPER LEVEL" });
    b.splayRing("A7", { rays: 8, minDist: 10, maxDist: 26,
        incLo: 4, incHi: 34 });

    // ---- the upper trunk: long, and wandering hard -----------------
    b.useTrip(tUpper);
    b.heading = 70.0;
    var upperEnd = meander(b, "A7", "B", 1, 40,
        { turn: 24, swing: 46, swingRate: 0.5, distLo: 30, distHi: 58,
          incLo: -2.5, incHi: 2.5, noteAt: 16, note: "BREAKDOWN PILE" });
    // A side branch off the middle of it: the thing an unrolling
    // cannot carry, and that therefore has to become its own piece.
    b.heading = 340.0;
    meander(b, "B17", "BB", 1, 4,
        { turn: 18, distLo: 20, distHi: 34, incLo: -2, incHi: 2 });

    // ---- the stairstep: drops every few stations -------------------
    b.useTrip(tStair);
    b.heading = 150.0;
    var stair = upperEnd;
    var stairDrops = [22.0, 18.0, 30.0, 16.0];
    var si;
    for (si = 0; si < stairDrops.length; si++) {
        var walkTo = "C" + (si * 2 + 1);
        var dropTo = "C" + (si * 2 + 2);
        b.leg(stair, walkTo, between(24, 38),
            b.heading + between(-20, 20), between(-4, -1),
            { lrud: [round(between(2, 6), 1), round(between(2, 6), 1),
                round(between(4, 11), 1), 0.0],
              notes: si === 0 ? "HEAD OF THE STAIRSTEP" : undefined });
        b.leg(walkTo, dropTo, stairDrops[si], 0.0, -90.0,
            { azimuthOmitted: true,
              lrud: [round(between(2, 5), 1), round(between(2, 5), 1),
                  null, 0.0], open: [false, false, true, false],
              notes: "STAIRSTEP DROP " + (si + 1) + ", " +
                  stairDrops[si].toFixed(0) + " FT" });
        stair = dropTo;
    }
    // ...and a short piece of passage at the foot, which is the piece
    // built to fold NEAR the threshold rather than far from it.
    b.heading = 200.0;
    var stairFoot = meander(b, stair, "C", 9, 6,
        { turn: 30, swing: 34, swingRate: 1.15, distLo: 16, distHi: 26 });

    // ---- the lower streamway: under the trunk, wandering back ------
    b.useTrip(tLower);
    b.heading = 250.0;
    var lowerEnd = meander(b, stairFoot, "D", 1, 36,
        { turn: 22, swing: 44, swingRate: 0.46, distLo: 28, distHi: 54,
          incLo: -2.0, incHi: 0.5, noteAt: 22, note: "STREAM SINKS INTO GRAVEL" });
    b.splayRing(lowerEnd, { rays: 8, minDist: 8, maxDist: 20,
        incLo: -6, incHi: 10 });
    b.leg(lowerEnd, "DSUMP", 22.00, 232.0, -2.0,
        { lrud: [9.0, 8.0, 6.0, 0.0], notes: "SUMP" });

    // ---- the aven: a loop that spans both kinds of passage ----------
    //
    // Down a pitch and back up an aven. The circuit contains plumbed
    // legs with no bearing AND ordinary compass legs, so the
    // adjustment has to weight both inside one loop -- which is the
    // case CsAdjust.PLUMB_SIGMA_ANGLE_DEG exists for and which neither
    // other fixture contains.
    b.useTrip(tAven);
    b.heading = 20.0;
    b.leg("D6", "E1", 26.00, 26.0, 2.0,
        { lrud: [4.0, 4.0, 14.0, 0.0], notes: "FOOT OF THE AVEN" });
    b.leg("E1", "E2", 34.00, 0.0, 90.0,
        { azimuthOmitted: true,
          lrud: [3.0, 3.0, null, 0.0], open: [false, false, true, false],
          notes: "AVEN, BOLT CLIMBED" });
    b.leg("E2", "E3", 18.00, 44.0, 6.0,
        { lrud: [3.0, 3.0, 8.0, 0.0], notes: "CRAWL AT THE TOP" });
    // ...closing on a station in the upper trunk. Taped 1.2% long, so
    // the loop closes to a known, small percentage.
    b.closeLeg("E3", "B26", 1.012, 0.0,
        { lrud: [4.0, 4.0, 9.0, 0.0],
          notes: "CONNECTS TO THE UPPER TRUNK" });

    // ---- a second entrance, with a GPS on it -----------------------
    b.useTrip(tEntrance);
    b.leg("B3", "F1", 30.00, 316.0, 16.0,
        { lrud: [3.0, 4.0, 7.0, 1.0], notes: "SIDE PASSAGE TOWARD DAYLIGHT" });
    b.leg("F1", "F2", 26.00, 322.0, 38.0,
        { lrud: [4.0, 4.0, null, 0.0], open: [false, false, true, false],
          notes: "STEEP CLIMB" });
    b.leg("F2", "F3", 18.00, 330.0, 52.0,
        { lrud: [5.0, 6.0, null, 0.0], open: [false, false, true, false],
          notes: "SECOND ENTRANCE" });
    b.leg("F3", "F3DIG", 20.00, 10.0, 4.0,
        { excludeFromPlot: true, excludeFromLength: true,
          lrud: [null, null, null, null],
          notes: "SURFACE TAPE TO A BLOWING CRACK" });
    var walkedF3 = b.pos["F3"];
    b.fix("F3", round(walkedF3.x + 1.1, 2), round(walkedF3.y - 0.7, 2),
        round(walkedF3.z + 5.8, 2));

    return b;
}

/** startLrud, with the Open flags the shape carries. */
function survey_startLrud(b, o) {
    CsModel.setStartLrud(b.survey, {
        left: o.left === undefined ? null : o.left,
        right: o.right === undefined ? null : o.right,
        up: o.up === undefined ? null : o.up,
        down: o.down === undefined ? null : o.down,
        leftAll: null, rightAll: null, upAll: null, downAll: null,
        leftOpen: o.leftOpen === true, rightOpen: o.rightOpen === true,
        upOpen: o.upOpen === true, downOpen: o.downOpen === true
    });
}

// ---------------------------------------------------------------------
// Build, write, verify.
// ---------------------------------------------------------------------

var out = [];
function say(line) {
    out.push(line);
    if (IS_NODE) {
        console.log(line);
    } else if (typeof qDebug !== "undefined") {
        qDebug(line);
    }
}

var failures = [];
function expect(cond, what) {
    if (!cond) {
        failures.push(what);
        say("  FAIL  " + what);
    } else {
        say("  ok    " + what);
    }
}

function codesOf(findings) {
    var o = {};
    for (var i = 0; i < findings.length; i++) {
        o[findings[i].code] = (o[findings[i].code] || 0) + 1;
    }
    return o;
}

function planExtent(resolved) {
    var minX = null, maxX = null, minY = null, maxY = null;
    for (var n in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(n)) { continue; }
        var s = resolved.stations[n];
        if (minX === null || s.x < minX) { minX = s.x; }
        if (maxX === null || s.x > maxX) { maxX = s.x; }
        if (minY === null || s.y < minY) { minY = s.y; }
        if (maxY === null || s.y > maxY) { maxY = s.y; }
    }
    return { width: maxX - minX, height: maxY - minY };
}

var main = buildStairstepCave();

var OUT = repoRoot + "/testdata/";
var GEO_SVX_HEADER =
    "; GEOREFERENCE (for CaveCAD's Aerial Basemap / map picker):\n" +
    "; GEO " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "   ; WGS84 lat lon, Greenbrier karst\n" +
    "; entrance elevation " + GEO.elevationFt.toFixed(2) + " ft\n" +
    "; synthetic location -- not a real entrance\n";
var GEO_CSV_HEADER =
    "# geo: " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "\n" +
    "# geonote: WGS84, Greenbrier karst, synthetic -- not a real " +
        "entrance\n";

var svxText = GEO_SVX_HEADER + CsFormatSurvex.write(main.survey);
var datText = CsFormatCompass.write(main.survey);
var csvText = GEO_CSV_HEADER + CsFormatCsv.write(main.survey);

writeTextFile(OUT + "StairstepCave.svx", svxText);
writeTextFile(OUT + "StairstepCave.dat", datText);
writeTextFile(OUT + "StairstepCave.csv", csvText);

say("STAIRSTEP CAVE written to testdata/");

var resolved = CsNetwork.resolve(main.survey, {});
var findings = CsValidate.check(main.survey, resolved);
var stats = CsStats.compute(main.survey, resolved, CsTraverse.SLOPE);
var codes = codesOf(findings);
var extent = planExtent(resolved);
var pitches = CsPitch.find(main.survey, resolved, {});

say("");
say("== as built");
say("   trips " + main.survey.trips.length +
    "   shots " + main.survey.shots.length +
    "   stations " + CsModel.stationNames(main.survey).length);
say("   resolved " + Object.keys(resolved.stations).length +
    "   loops " + resolved.loops.length +
    "   ties " + resolved.ties.length +
    "   unresolved " + resolved.unresolved.length);
say("   surveyed " + stats.surveyedLength.toFixed(1) + " ft" +
    "   plan " + stats.planLength.toFixed(1) +
    "   depth " + stats.depth.toFixed(1));
say("   plan extent " + extent.width.toFixed(0) + " x " +
    extent.height.toFixed(0) + " ft");
say("   pitches " + pitches.length + ": " +
    pitches.map(function(p) {
        return CsPitch.label(p, "ft");
    }).join(", "));
for (var li = 0; li < resolved.loops.length; li++) {
    var lp = resolved.loops[li];
    say("   loop " + lp.from + ".." + lp.to + "  " +
        lp.error.toFixed(2) + " off over " + lp.traverseLength.toFixed(1) +
        " = " + lp.percent.toFixed(2) + "%");
}
for (li = 0; li < resolved.ties.length; li++) {
    var ti = resolved.ties[li];
    say("   tie  " + ti.from + ".." + ti.to + "  " + ti.error.toFixed(2) +
        " off (h " + ti.horizontal.toFixed(2) + ", v " +
        ti.vertical.toFixed(2) + ")");
}
var ck = [];
for (var c in codes) {
    if (codes.hasOwnProperty(c)) { ck.push(c + " x" + codes[c]); }
}
ck.sort();
say("   findings " + (ck.length ? ck.join(", ") : "(none)"));

// ---- it really is BOTH kinds of cave ---------------------------------

expect(main.survey.fixed["A1"].z === GEO.elevationFt,
    "entrance datum is " + GEO.elevationFt + " ft, not zero");
expect(stats.surveyedLength > 2000,
    "over 2000 ft of passage (" + stats.surveyedLength.toFixed(0) + ")");
expect(stats.depth > 200,
    "over 200 ft deep (" + stats.depth.toFixed(0) + ")");
expect(Math.max(extent.width, extent.height) > 500,
    "and over 500 ft across (" + Math.max(extent.width,
        extent.height).toFixed(0) + ") -- BOTH, which is the point");
expect(pitches.length >= 7,
    "seven or more drops, spread through the cave (" + pitches.length + ")");
expect(!CsValidate.checkHasErrors(findings),
    "warnings only, so the fixture draws clean");
expect(resolved.unresolved.length === 0, "every station resolves");
expect(resolved.loops.length >= 1,
    "at least one loop (" + resolved.loops.length + ")");
expect(resolved.ties.length === 1,
    "the GPS on the second entrance is a control tie");

// THE LOOP SPANS BOTH KINDS OF PASSAGE. Down a pitch, along the
// streamway, up an aven, back along the trunk: a circuit containing
// plumbed legs with no bearing AND ordinary compass legs, which is the
// case CsAdjust has to weight two different ways at once.
var mixedLoop = false;
for (li = 0; li < resolved.loops.length; li++) {
    var hasPlumb = false, hasCompass = false;
    var path = resolved.loops[li].path;
    for (var pi = 0; pi < resolved.legs.length; pi++) {
        var leg = resolved.legs[pi];
        if (path.indexOf(leg.from) < 0 || path.indexOf(leg.to) < 0) {
            continue;
        }
        if (CsTraverse.isPlumb(leg.shot)) { hasPlumb = true; }
        else { hasCompass = true; }
    }
    if (hasPlumb && hasCompass) { mixedLoop = true; }
}
expect(mixedLoop,
    "a loop runs DOWN a pitch and back UP an aven, so one circuit " +
    "holds both a plumbed leg and a compass leg");

// ---- and the elevation engine tells the two apart, per piece ---------

var chunked = CsProfile.build(main.survey, resolved,
    { mode: CsProject.MODE_CHUNKED });

// THE FOLD IS MEASURED BEFORE THE DECISION, NOT AFTER IT. An unrolled
// piece folds by nothing BECAUSE it was unrolled -- that is what
// unrolling does -- so reading the fold off the drawn band reports 0
// for every piece and says nothing about why any of them was chosen.
// The number that matters is what the piece would have folded by if it
// had been projected, which is the number the rule actually looked at.
var chunkList = CsChunk.refine(main.survey, resolved,
    CsChunk.split(main.survey, resolved, {}), {});
var foldBefore = {};
for (var fj = 0; fj < chunkList.length; fj++) {
    foldBefore[chunkList[fj].key] = CsChunk.foldOf(
        CsProject.band(main.survey, resolved, {
            stations: chunkList[fj].stations,
            legs: chunkList[fj].legs
        }));
}

var unrolled = 0, projected = 0, folds = [];
for (var bi = 0; bi < chunked.bands.length; bi++) {
    var band = chunked.bands[bi];
    if (band.chunkLayout === CsChunk.LAYOUT_UNROLLED) { unrolled++; }
    else { projected++; }
    folds.push({ key: band.key,
                 fold: (foldBefore[band.key] === undefined) ?
                     CsChunk.foldOf(band) : foldBefore[band.key],
                 kind: band.chunkKind, layout: band.chunkLayout,
                 n: band.stations.length });
}
say("");
say("== chunked elevation: " + chunked.bands.length + " pieces, " +
    unrolled + " unrolled, " + projected + " projected");
say("   (fold is what the piece WOULD have folded by if projected --" +
    " the number the rule looked at)");
folds.sort(function(a, z) { return z.fold - a.fold; });
for (bi = 0; bi < folds.length; bi++) {
    say("   " + folds[bi].key + "  " + folds[bi].kind +
        "  " + folds[bi].layout + "  fold " + folds[bi].fold.toFixed(2) +
        "  n=" + folds[bi].n);
}

expect(unrolled >= 1,
    "at least one piece FOLDS enough to be unrolled (" + unrolled + ")");
expect(projected >= 4,
    "and several do not (" + projected + ")");

// EVERY STATION IS STILL ON THE PAGE. Unrolling a piece costs the
// branches it cannot carry, unless those branches become pieces --
// which is the thing worth proving on a cave with real branches.
var drawnSet = {};
for (bi = 0; bi < chunked.bands.length; bi++) {
    for (var sj = 0; sj < chunked.bands[bi].stations.length; sj++) {
        drawnSet[chunked.bands[bi].stations[sj].name] = true;
    }
}
var missing = [];
for (var nm in resolved.stations) {
    if (!resolved.stations.hasOwnProperty(nm)) { continue; }
    if (drawnSet[nm] !== true) { missing.push(nm); }
}
// F3DIG is on a surface leg, which is excluded from the plot by
// definition and so is not a gap.
var realMissing = [];
for (bi = 0; bi < missing.length; bi++) {
    if (missing[bi] !== "F3DIG") { realMissing.push(missing[bi]); }
}
expect(realMissing.length === 0,
    "every drawn station is on the page (" +
    (realMissing.length ? realMissing.join(",") : "none missing") + ")");

var displaced = 0, over = 0;
var spans = [];
for (bi = 0; bi < chunked.bands.length; bi++) {
    if (Math.abs(chunked.bands[bi].zOffset || 0) > 1e-9) { displaced++; }
    spans.push(CsChunk.extentOf(chunked.bands[bi]));
}
spans.sort(function(a, z) { return a.lo - z.lo; });
for (bi = 1; bi < spans.length; bi++) {
    if (spans[bi].lo < spans[bi - 1].hi - 1e-9) { over++; }
}
expect(displaced === 0, "nothing is displaced off true elevation");
expect(over === 0, "and no two pieces overlap (" + over + ")");

var labelled = 0;
for (bi = 0; bi < chunked.bands.length; bi++) {
    labelled += chunked.bands[bi].pitches.length;
}
expect(labelled === pitches.length,
    "every drop is labelled (" + labelled + " of " + pitches.length + ")");

// A PIECE NEAR THE THRESHOLD, which is the thing neither other fixture
// has. Reported rather than asserted at a value: the number is what
// this fixture exists to put in front of a human, and pinning it would
// make a tuning change look like a regression.
var nearest = null;
for (bi = 0; bi < folds.length; bi++) {
    if (folds[bi].kind !== "passage") { continue; }
    var d = Math.abs(folds[bi].fold - CsChunk.FOLD_LIMIT);
    if (nearest === null || d < nearest.d) {
        nearest = { d: d, f: folds[bi] };
    }
}
if (nearest !== null) {
    say("");
    say("   closest piece to the fold limit (" +
        CsChunk.FOLD_LIMIT.toFixed(2) + "): " + nearest.f.key +
        " at " + nearest.f.fold.toFixed(2) + " -- " + nearest.f.layout);
}

// ---- the two levels really do overlap in plan ------------------------
//
// An upper trunk and a lower streamway stacked on each other is what a
// multi-level cave IS, and it is the thing a plan view cannot show.
var upperBox = null, lowerBox = null;
var grow = function(box, st) {
    if (box === null) {
        return { minX: st.x, maxX: st.x, minY: st.y, maxY: st.y };
    }
    box.minX = Math.min(box.minX, st.x); box.maxX = Math.max(box.maxX, st.x);
    box.minY = Math.min(box.minY, st.y); box.maxY = Math.max(box.maxY, st.y);
    return box;
};
for (nm in resolved.stations) {
    if (!resolved.stations.hasOwnProperty(nm)) { continue; }
    if (nm.charAt(0) === "B" && nm.charAt(1) !== "B") {
        upperBox = grow(upperBox, resolved.stations[nm]);
    } else if (nm.charAt(0) === "D" && nm !== "DSUMP") {
        lowerBox = grow(lowerBox, resolved.stations[nm]);
    }
}
var overlapX = Math.min(upperBox.maxX, lowerBox.maxX) -
    Math.max(upperBox.minX, lowerBox.minX);
var overlapY = Math.min(upperBox.maxY, lowerBox.maxY) -
    Math.max(upperBox.minY, lowerBox.minY);
say("");
say("   upper trunk / lower streamway plan overlap: " +
    overlapX.toFixed(0) + " x " + overlapY.toFixed(0) + " ft");
expect(overlapX > 50 && overlapY > 50,
    "the two levels OVERLAP in plan, which is what a multi-level cave " +
    "does and what a plan view cannot show");

// ---- round trips ------------------------------------------------------

var reSvx = CsFormatSurvex.parse(svxText);
var reSvxRes = CsNetwork.resolve(reSvx, {});
var reSvxStats = CsStats.compute(reSvx, reSvxRes, CsTraverse.SLOPE);
expect(Math.abs(reSvxStats.depth - stats.depth) < 0.05,
    "Survex round trip keeps the depth");
expect(CsPitch.find(reSvx, reSvxRes, {}).length === pitches.length,
    "...and every pitch");
var reCsv = CsFormatCsv.parse(csvText);
var reCsvRes = CsNetwork.resolve(reCsv, {});
expect(Math.abs(CsStats.compute(reCsv, reCsvRes,
    CsTraverse.SLOPE).depth - stats.depth) < 0.05,
    "CSV round trip keeps the depth");
var reDat = CsFormatCompass.parse(datText);
expect(Math.abs(CsStats.compute(reDat, CsNetwork.resolve(reDat, {}),
    CsTraverse.SLOPE).depth - stats.depth) < 0.05,
    "Compass round trip keeps the depth");

// ---------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------

var MANIFEST = [
"# STAIRSTEP CAVE -- the mixed fixture",
"",
"Generated by `tools/make_mixed_cave.js` (`node tools/make_mixed_cave.js`).",
"Deterministic: the meanders run off a seeded LCG, so the numbers below",
"stay true across regenerations. Synthetic -- no real entrance.",
"",
"## Why a third fixture",
"",
"| | Pitfall Cave | Plumbline Pit | Stairstep Cave |",
"|---|---|---|---|",
"| Shape | horizontal, three drops in it | vertical, a few crawls in it | both, interleaved |",
"| Length | 2400 ft | 700 ft | " + stats.surveyedLength.toFixed(0) + " ft |",
"| Depth | 143 ft | 380 ft | " + stats.depth.toFixed(0) + " ft |",
"| Plan extent | most of the cave | 148 ft | " +
    Math.max(extent.width, extent.height).toFixed(0) + " ft |",
"| Drops | 3 | 5 | " + pitches.length + " |",
"",
"Nothing in this suite declares what kind of cave it is looking at: the",
"layout of an elevation is decided per PIECE, from that piece's own",
"geometry (`CsChunk.foldOf` against `CsChunk.FOLD_LIMIT`). Two fixtures",
"could only prove that rule answers correctly at its extremes --",
"Pitfall's trunk folds by 0.42, every piece of Plumbline by under 0.01.",
"Neither puts a piece near the line, and neither puts both kinds of",
"passage in one drawing where they have to coexist.",
"",
"## Shape of the cave",
"",
"```",
"  A1  sinkhole, " + GEO.elevationFt.toFixed(2) + " ft",
"   |  climb down to the lip",
"  A3  P1, 40 ft",
"  A4  short traverse",
"  A5  P2, 65 ft with a rebelay (25 + 40)",
"  A7  ---- the UPPER LEVEL ----------------------------------",
"       |",
"      B1..B34   UPPER TRUNK, wandering hard. Folds; unrolls.",
"       |  \\_ BB1..BB4   a side branch off the middle of it",
"       |",
"      C1..C14   THE STAIRSTEP: four drops with short passage",
"       |        between them -- chunk boundaries every few stations",
"       |",
"      D1..D30   LOWER STREAMWAY, wandering the other way, directly",
"       |        under the upper trunk in plan. Ends at a sump.",
"       |",
"      E1..E3    an AVEN back up into the upper trunk, closing a loop",
"                that runs DOWN a pitch and back UP an aven",
"",
"  F1..F3        second entrance, GPS fixed: a control tie",
"```",
"",
"## What it is built to stress",
"",
"| # | Trap | Where | Expected |",
"|---|---|---|---|",
"| M1 | both kinds at one scale | " + stats.surveyedLength.toFixed(0) +
    " ft long, " + stats.depth.toFixed(0) + " ft deep | neither half is incidental |",
"| M2 | two levels overlapping in plan | upper trunk over lower streamway, " +
    overlapX.toFixed(0) + " x " + overlapY.toFixed(0) + " ft | the thing a plan view cannot show |",
"| M3 | chunk boundaries every few stations | the stairstep, four drops | Plumbline's are hundreds of feet apart |",
"| M4 | TWO pieces astride the fold threshold | upper trunk and lower streamway | they are the same KIND of passage and get opposite answers -- see below |",
"| M5 | a loop spanning both kinds | down a pitch, up an aven | one circuit holds a plumbed leg and a compass leg |",
"| M6 | a branch off an unrolled piece | BB1-BB4 off the trunk | becomes its own chunk rather than being dropped |",
"| M7 | a control tie, mostly vertical | GPS on F3 | a TIE, not a loop |",
"| M8 | a rebelayed pitch | P2, 25 + 40 | ONE 65 ft pitch |",
"| M9 | an aven climbed into passage | E1-E2 | not an aven any more: passage carries on at the top |",
"| M10 | a surface leg | F3-F3DIG | out of the length and out of the plot |",
"",
"## The threshold, straddled",
"",
"The upper trunk and the lower streamway are the same kind of passage:",
"long, wandering, forty-odd stations each. They fold by almost the same",
"amount and land on OPPOSITE sides of `CsChunk.FOLD_LIMIT`, so one is",
"unrolled and the other is projected. That is not a flaw in the fixture,",
"it is the point of it: the limit was chosen against two caves whose",
"pieces folded by 0.42 and by under 0.01, with nothing anywhere near the",
"line, and a threshold nothing has ever tested at its own value is a",
"guess that has not been checked.",
"",
"Look at the two side by side in the drawing. If the projected one",
"should have been unrolled -- or the unrolled one reads worse than it",
"would have projected -- the number is wrong and this is the cave that",
"says so.",
"",
"## Measured on the last regeneration",
"",
"```",
""
];

var measured = [];
for (var mi = 0; mi < out.length; mi++) {
    if (out[mi].indexOf("  ok    ") !== 0 && out[mi].indexOf("  FAIL  ") !== 0) {
        measured.push(out[mi]);
    }
}
measured.push("```");
measured.push("");
writeTextFile(OUT + "StairstepCave_MANIFEST.md",
    MANIFEST.join("\n") + measured.join("\n"));

say("");
if (failures.length === 0) {
    say("### MIXED CAVE OK");
} else {
    say("### MIXED CAVE FAIL -- " + failures.length + " check(s):");
    for (var fi = 0; fi < failures.length; fi++) {
        say("   " + failures[fi]);
    }
}

if (IS_NODE) {
    process.exit(failures.length === 0 ? 0 : 1);
} else if (typeof QCoreApplication !== "undefined") {
    QCoreApplication.quit();
}
