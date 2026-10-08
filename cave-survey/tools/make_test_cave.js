// make_test_cave.js -- builds the PITFALL CAVE test fixtures: one long
// meandering synthetic cave carrying every trap this suite is meant to
// catch, written out in three formats, plus two smaller companion
// files (parser dialects, and the error-severity class on its own).
//
//   node tools/make_test_cave.js
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_test_cave.js "$PWD"
//
// Writes into testdata/ and then VERIFIES its own output: every file is
// parsed back through the real Core reader, resolved, validated, and
// checked against the pitfall inventory below. A fixture that stops
// tripping the check it was built to trip is worse than no fixture --
// it reads as "nothing wrong here".
//
// WHY GENERATED, NOT HAND-WRITTEN. The geometry has to be consistent:
// two loops that close to a KNOWN percentage (one clean, one blundered
// past CsValidate.CLOSURE_WARN_PERCENT), a control tie whose
// misclosure is a chosen number, and ~80 meandering stations whose
// coordinates nobody wants to compute by hand. Every closure leg here
// is computed from the walked positions and then perturbed by the
// error the fixture wants, so the expected numbers are the fixture's
// own arithmetic rather than a guess. The parser DIALECT traps (grads,
// percent clino, *calibrate sign, unit switches mid-file, plumb
// keywords, anonymous splays) cannot be generated this way at all --
// they only exist in file text a writer never emits -- so they live in
// a hand-written companion file, which this tool also verifies.
//
// PRIVACY: the cave is synthetic and so is its location. A1 sits at a
// plausible but arbitrary rural point in the southern Indiana karst
// (see GEO below) so aerial-basemap work has real imagery under it. It
// is not a cave, and no real entrance appears anywhere in these files.

// ---------------------------------------------------------------------
// Environment shim -- lifted from tests/js_unit.js, same problem: the
// Core is pure ECMAScript, so this runs under node and under CaveCAD's
// own engine, and "scripts/..." has to resolve against the checkout
// rather than QCAD's installed script folders.
// ---------------------------------------------------------------------

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
    // Core files include() each other with scripts/-rooted paths; those
    // lines are stripped and the dependency list below is explicit,
    // exactly as tests/js_unit.js does it. Indirect eval so the
    // definitions land in the GLOBAL scope in both engines.
    source = source.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(source);
}

var CORE_FILES = [
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsIgrfCoeffs.js",
    "scripts/CaveSurvey/Core/CsGeomag.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsAdjust.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
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

// ---------------------------------------------------------------------
// Deterministic meander. Math.random would make every regeneration a
// different cave, so the numbers in the manifest would rot on the next
// run -- a seeded LCG keeps the fixture reproducible byte for byte.
// ---------------------------------------------------------------------

var SEED = 20260823;
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
// WHERE THE CAVE IS. An arbitrary rural point in the southern Indiana
// karst (Orange County, a few miles from Paoli), chosen so aerial
// basemap work has real NAIP imagery and real karst terrain under it.
//
// It is NOT a cave. Nothing here corresponds to a known entrance, and
// nothing in this project ever publishes one -- the fixture needs a
// plausible place on the map, not a real hole in the ground.
//
// Two things follow from the location rather than being invented:
//   * the entrance elevation, 812.40 ft, is upland-plausible for that
//     county (the old placeholder 1284.50 was Appalachian, not
//     Hoosier). Still deliberately NOT zero -- the datum trap is the
//     reason this number exists at all.
//   * each trip's declination is the REAL IGRF-14 value for this point
//     on that trip's date, computed below, so the Declination tool can
//     be cross-checked against the fixture instead of against a made-up
//     number. Southern Indiana is WEST declination, so these come out
//     negative in the east-positive convention the model stores.
// ---------------------------------------------------------------------

var GEO = {
    station: "A1",
    lat: 38.4795,
    lon: -86.4381,
    elevationFt: 812.40
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

// ---------------------------------------------------------------------
// Survey builder -- walks positions as it adds legs, so any later leg
// can be computed BETWEEN two already-placed stations (that is what
// makes a loop close to a chosen percentage instead of to luck).
// ---------------------------------------------------------------------

function newBuilder(caveName, unit) {
    var survey = CsModel.newSurvey();
    survey.caveName = caveName;
    survey.distanceUnit = unit;
    survey.trips = [];

    var b = {
        survey: survey,
        pos: {},
        trip: 0,
        // running heading, so consecutive legs meander instead of
        // teleporting
        heading: 0.0
    };

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
     * One leg. opts carries anything else the Shot shape holds --
     * lrud [l,r,u,d] (null entries = not measured), lrudAll for
     * multi-reading sides, backAzimuth/backInclination, notes, flags,
     * declination override, and place:false for a leg whose TO must
     * NOT define the station's position (closure and duplicate legs).
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
        s.declination = opts.declination !== undefined ?
            opts.declination : survey.trips[b.trip].declination;
        if (opts.lrud !== undefined) {
            s.left = opts.lrud[0];
            s.right = opts.lrud[1];
            s.up = opts.lrud[2];
            s.down = opts.lrud[3];
        }
        if (opts.lrudAll !== undefined) {
            s.leftAll = opts.lrudAll[0] || null;
            s.rightAll = opts.lrudAll[1] || null;
            s.upAll = opts.lrudAll[2] || null;
            s.downAll = opts.lrudAll[3] || null;
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

    /**
     * The exact leg between two already-placed stations, perturbed by
     * a chosen error. distFactor scales the tape (1.0 = perfect),
     * azError swings the compass. This is how a loop is made to close
     * to a known percentage: walk both branches, then close with a
     * leg that is deliberately off by the amount the fixture wants.
     */
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

    /** A meandering run of ordinary legs, names <prefix><n>. */
    b.meander = function(fromName, prefix, firstIndex, count, opts) {
        opts = opts || {};
        var incLo = opts.incLo === undefined ? -6 : opts.incLo;
        var incHi = opts.incHi === undefined ? 4 : opts.incHi;
        var distLo = opts.distLo === undefined ? 14 : opts.distLo;
        var distHi = opts.distHi === undefined ? 46 : opts.distHi;
        var turn = opts.turn === undefined ? 32 : opts.turn;
        var prev = fromName;
        var last = fromName;
        for (var i = 0; i < count; i++) {
            var name = prefix + (firstIndex + i);
            var az = b.heading + between(-turn, turn);
            var inc = between(incLo, incHi);
            var dist = between(distLo, distHi);
            b.leg(prev, name, dist, az, inc, {
                lrud: [round(between(1.5, 9), 1), round(between(1.5, 9), 1),
                    round(between(2, 14), 1), round(between(0.3, 3), 1)]
            });
            prev = name;
            last = name;
        }
        return last;
    };

    /**
     * A splay-shot room: a ring of wall shots around each station.
     * withLrud:false leaves the room with NO tape-and-compass LRUD at
     * all, which is the case that proves splays alone can carry a
     * wall run (CsLrud.wallRuns).
     */
    b.splayRoom = function(stations, opts) {
        opts = opts || {};
        var rays = opts.rays === undefined ? 8 : opts.rays;
        for (var i = 0; i < stations.length; i++) {
            var st = stations[i];
            for (var r = 0; r < rays; r++) {
                var az = (360.0 / rays) * r + between(-6, 6);
                var dist = between(opts.minDist || 6, opts.maxDist || 34);
                var inc = between(-8, 8);
                b.splay(st, dist, az, inc);
            }
            if (opts.ceilingShot === true && i === 0) {
                // deliberately steep: there is NO steepness filter in
                // wallRuns, so this ceiling shot pulls its wall in
                // toward the station -- by design, and worth seeing
                b.splay(st, 22, 70, 71.0, "CEILING DOME");
            }
            if (opts.axialShot === true && i === 0) {
                // a splay straight down the passage belongs to neither
                // wall (rel 0/180 is the axial case)
                b.splay(st, 40, b.heading, 1.0, "DOWN-PASSAGE SIGHT");
            }
        }
    };

    return b;
}

// ---------------------------------------------------------------------
// PITFALL CAVE -- the main fixture.
//
// Layout, roughly:
//
//   A1 (entrance, fixed on a real 812.40 ft datum, georeferenced to
//       southern Indiana -- see GEO)
//     |  entrance series, dropping, one 42 ft near-plumb pit
//   A12 --- junction ------------------------------.
//     |                                            \
//   A13-A14  ...... loop A (spans trips 0 and 1) .. B1-B4
//                                                    |
//                                              main trunk, meandering,
//                                              BIG ROOM splay chamber,
//                                              duplicate/backsight/
//                                              flagged legs
//                                                    |
//                                        UPPERWESTMAZEJUNCTION
//                                                    |
//                                     west maze: loop B, BLUNDERED
//                                     (>2% -- the closure warning),
//                                     three-way junction at C10,
//                                     FLOWSTONE CHAMBER splay room
//                                                    |
//                                        sump passage: plumbed pit,
//                                        second fixed station (a
//                                        control TIE, not a loop),
//                                        mid-trip declination change
// ---------------------------------------------------------------------

function buildPitfallCave() {
    var b = newBuilder("PITFALL CAVE (TEST)", "ft");

    // Four trips. Trips 2 and 3 share a DATE and differ only in team:
    // that is the fingerprint (date|team) doing its job -- two parties
    // underground the same day stay separately revisable.
    var T_ENT = b.addTrip("ENTRANCE SERIES", "2026-03-14",
        "N. SCHONEGG, R. WEBB", declinationOn("2026-03-14"));
    var T_TRUNK = b.addTrip("MAIN TRUNK", "2026-04-11",
        "N. SCHONEGG, T. HALE", declinationOn("2026-04-11"));
    var T_MAZE = b.addTrip("WEST MAZE", "2026-05-02",
        "K. AYERS, D. OTT", declinationOn("2026-05-02"));
    var T_SUMP = b.addTrip("SUMP PASSAGE", "2026-05-02",
        "R. WEBB, J. PARK", declinationOn("2026-05-02"));

    // The datum. A real-ish entrance elevation, NOT zero: every tool
    // that defaults a z to 0 rebases this cave toward sea level, which
    // is the whole elevation-datum trap family. The fixture exists
    // partly so that bug cannot pass unnoticed again.
    b.fix("A1", 0.0, 0.0, GEO.elevationFt);
    b.survey.trips[T_ENT].startNote =
        "ENTRANCE UNDER LEDGE, GATE COMBINATION WITH LANDOWNER";
    b.survey.trips[T_ENT].startLrud =
        { left: 3.0, right: 4.5, up: 6.0, down: 0.0 };

    // ---- entrance series ------------------------------------------
    b.useTrip(T_ENT);
    b.heading = 205.0;
    b.leg("A1", "A2", 28.5, 205.0, -11.0,
        { lrud: [3.0, 4.0, 7.0, 1.0], notes: "STEEP MUD SLOPE" });
    b.leg("A2", "A3", 33.0, 218.5, -8.5, { lrud: [5.0, 6.5, 9.0, 1.5] });

    // near-plumb: 87.5 deg trips "near-plumb" without being a declared
    // plumb. Classic sign-flip/typo site, and a real 42 ft drop.
    b.leg("A3", "A4", 42.0, 224.0, -87.5,
        { lrud: [4.0, 4.0, 30.0, 2.0], notes: "PIT, 42 FT DROP, BOLT AT LIP" });

    b.leg("A4", "A5", 19.0, 196.0, -3.0, { lrud: [2.5, 2.5, 5.0, 0.5] });

    // LRUD ZERO means the wall is AT the station -- not the same thing
    // as "not measured" (null), and the pair below is the fixture for
    // that distinction.
    b.leg("A5", "A6", 24.5, 232.0, 1.5,
        { lrud: [0.0, 0.0, 3.0, 0.0], notes: "BODY-WIDTH CANYON" });
    b.leg("A6", "A7", 31.0, 244.0, -4.0,
        { lrud: [null, null, null, null], notes: "LRUD NOT TAKEN, HANDS FULL" });

    // foresight/backsight compass disagreement, 5.6 deg (over 3)
    b.leg("A7", "A8", 37.5, 251.0, -2.0, {
        lrud: [6.0, 5.0, 11.0, 1.0],
        backAzimuth: 251.0 + 180.0 - 5.6,
        backInclination: 2.0
    });
    // and clino disagreement, 4.2 deg (over 3)
    b.leg("A8", "A9", 29.0, 238.0, -6.5, {
        lrud: [4.0, 4.5, 8.0, 1.0],
        backAzimuth: 238.0 + 180.0 - 0.4,
        backInclination: 6.5 - 4.2
    });

    // notes carrying a comma AND a semicolon: the comma is the CSV
    // trap, the semicolon is the Survex comment trap
    b.leg("A9", "A10", 22.0, 224.0, -3.0, {
        lrud: [3.0, 3.0, 4.0, 0.5],
        notes: "TIGHT CRAWL, KNEE PADS; WATER 2 IN DEEP"
    });
    b.leg("A10", "A11", 26.5, 213.0, -1.5, { lrud: [5.0, 4.0, 7.5, 1.0] });

    // Station name longer than 8 characters: real Walls truncates
    // these. Nothing renames it -- the fixture's job is to make that
    // visible, on a leg that is also flagged SURFACE (so it is both
    // excluded from length and off the plot).
    b.leg("A11", "ENTRANCE-DIG-1", 18.0, 300.0, 12.0, {
        lrud: [2.0, 2.0, 4.0, 0.0],
        excludeFromPlot: true,
        excludeFromLength: true,
        notes: "SURFACE DIG, DAYLIGHT VISIBLE"
    });

    b.leg("A11", "A12", 34.0, 206.0, -5.0,
        { lrud: [7.0, 8.0, 14.0, 2.0], notes: "JUNCTION ROOM" });

    // loop A, first branch (stays in the entrance trip)
    b.leg("A12", "A13", 41.0, 158.0, -2.0, { lrud: [4.0, 5.0, 8.0, 1.0] });
    b.leg("A13", "A14", 38.0, 176.0, -3.5, { lrud: [3.5, 4.0, 6.0, 1.0] });

    // ---- main trunk -----------------------------------------------
    b.useTrip(T_TRUNK);
    b.heading = 246.0;
    b.leg("A12", "B1", 30.0, 246.0, -2.0, { lrud: [6.0, 6.0, 10.0, 1.5] });
    b.leg("B1", "B2", 44.0, 232.0, -4.0, { lrud: [8.0, 7.0, 13.0, 2.0] });
    b.leg("B2", "B3", 36.5, 214.0, -1.0, { lrud: [5.0, 9.0, 11.0, 1.0] });
    b.leg("B3", "B4", 33.0, 190.0, -2.5, { lrud: [7.0, 6.0, 9.0, 1.5] });

    // LOOP A closes here: A14 -> B4, 0.4% long. Both endpoints are
    // already placed, so this leg's numbers are the walked geometry
    // plus exactly the error asked for. Under the 2% warning
    // threshold on purpose: a loop that closes WELL still has to
    // appear in loops[], get a BCRA grade, and be adjusted.
    b.closeLeg("A14", "B4", 1.004, 0.6, {
        lrud: [4.0, 4.0, 7.0, 1.0],
        notes: "LOOP A TIE-IN TO TRUNK"
    });

    var last = b.meander("B4", "B", 5, 6, { turn: 30 });

    // duplicate readings of one pair that DISAGREE: 9 deg and 4 ft
    // apart. Two readings that agree are normal practice and say
    // nothing; these do not agree.
    var b10 = last;              // B10
    var b11 = "B11";
    var dupAz = CsAngles.normalizeAzimuth(b.heading + 8.0);
    b.leg(b10, b11, 31.0, dupAz, -1.0, { lrud: [5.0, 5.0, 8.0, 1.0] });
    b.leg(b10, b11, 27.0, dupAz + 9.0, -1.0, {
        place: false,
        notes: "RE-READ, TAPE SNAGGED"
    });

    // BIG ROOM: splay chamber. B12/B13 also carry LRUD (so walls have
    // both kinds of evidence at once); B14/B15 are splay-only.
    b.leg(b11, "B12", 40.0, b.heading - 14.0, 0.5,
        { lrud: [14.0, 18.0, 26.0, 2.0], notes: "BIG ROOM, EAST END" });
    b.leg("B12", "B13", 46.0, b.heading + 6.0, -1.0,
        { lrud: [21.0, 24.0, 31.0, 3.0] });
    b.leg("B13", "B14", 38.0, b.heading + 12.0, -2.0,
        { lrud: [null, null, null, null], notes: "BREAKDOWN, SPLAYS ONLY" });
    b.leg("B14", "B15", 30.0, b.heading - 8.0, -1.5,
        { lrud: [null, null, null, null] });
    b.splayRoom(["B12", "B13", "B14", "B15"],
        { rays: 8, minDist: 8, maxDist: 38, ceilingShot: true, axialShot: true });

    last = b.meander("B15", "B", 16, 2, { turn: 26 });   // B16, B17

    // a leg entered from the wrong end: B18 -> B17 reading the SAME
    // azimuth as B17 -> B18 (so ~180 from what it should read).
    var revAz = CsAngles.normalizeAzimuth(b.heading + 10.0);
    b.leg("B17", "B18", 35.0, revAz, -2.0, { lrud: [6.0, 5.0, 9.0, 1.0] });
    b.leg("B18", "B17", 35.0, revAz, 2.0, {
        place: false,
        notes: "BACKSIGHT WRITTEN IN THE FORESIGHT COLUMN"
    });

    last = b.meander("B18", "B", 19, 2, { turn: 24 });   // B19, B20

    // a leg the adjustment must NOT move (Compass #|C#): a surveyed
    // tie to a fixed reference the party trusts absolutely
    b.leg("B20", "B21", 28.0, b.heading + 4.0, -1.0, {
        lrud: [4.0, 4.0, 6.0, 1.0],
        noAdjust: true,
        notes: "TIED TO SURVEY NAIL, DO NOT ADJUST"
    });

    // a DUPLICATE-flagged leg: real geometry, excluded from length
    var dupFlagAz = CsAngles.normalizeAzimuth(b.heading - 12.0);
    b.leg("B21", "B22", 33.0, dupFlagAz, -1.5,
        { lrud: [5.0, 6.0, 8.0, 1.0] });
    // this pair AGREES (0.6 deg, 0.4 ft): an agreeing duplicate is
    // normal practice and must stay silent in the validator, while
    // still being excluded from the cave's length
    b.leg("B21", "B22", 33.4, dupFlagAz + 0.6, -1.5, {
        place: false,
        excludeFromLength: true,
        notes: "DUPLICATE SHOT, SECOND PARTY"
    });

    // a shot excluded from EVERYTHING: no plot, no length, no
    // network. Survex has no representation for this, so the .svx
    // round trip is expected to LOSE it -- that is a documented
    // fixture expectation, not a surprise.
    b.leg("B22", "B23", 24.0, b.heading + 16.0, -2.0,
        { lrud: [4.0, 4.0, 7.0, 1.0] });
    b.leg("B23", "B23X", 15.0, 95.0, 3.0, {
        place: false,
        excludeFromAll: true,
        notes: "VOID SHOT, STATION NEVER FOUND AGAIN"
    });

    // a station whose name collides with the splay naming convention
    // (<anchor>.<n>): a REAL station called B23.1, which splayBaseOf
    // would read as splay 1 of B23
    b.leg("B23", "B23.1", 21.0, 118.0, 4.5, {
        lrud: [2.0, 2.0, 5.0, 0.5],
        notes: "SIDE ALCOVE, NAMED LIKE A SPLAY ON PURPOSE"
    });

    last = b.meander("B23", "B", 24, 2, { turn: 28 });   // B24, B25

    // Station name longer than 12 characters: real Compass cannot hold
    // it. Also the junction the west maze hangs off.
    b.leg("B25", "UPPERWESTMAZEJUNCTION", 37.0, b.heading - 20.0, -1.0, {
        lrud: [9.0, 11.0, 15.0, 2.0],
        notes: "FOUR-WAY, WEST MAZE STARTS HERE"
    });

    // ---- west maze (loop B, blundered) ----------------------------
    b.useTrip(T_MAZE);
    b.heading = 288.0;
    b.leg("UPPERWESTMAZEJUNCTION", "C1", 26.0, 288.0, -2.0,
        { lrud: [3.0, 3.5, 6.0, 1.0] });
    b.leg("C1", "C2", 31.0, 302.0, -1.0, { lrud: [4.0, 3.0, 5.5, 1.0] });
    b.leg("C2", "C3", 28.5, 336.0, 1.5, { lrud: [3.0, 3.0, 5.0, 0.5] });
    b.leg("C3", "C4", 34.0, 12.0, 2.0, { lrud: [4.5, 4.0, 7.0, 1.0] });

    // multi-reading LRUD ("5/10" on the left: two readings written at
    // one station). Only some formats can carry every reading; the
    // fixture is here to show which.
    b.leg("C4", "C5", 29.0, 46.0, 0.5, {
        lrud: [5.0, 6.0, 9.0, 1.0],
        lrudAll: [[5.0, 10.0], null, null, null],
        notes: "LEDGE AT 5, TRUE WALL AT 10"
    });
    b.leg("C5", "C6", 33.5, 74.0, -1.0, { lrud: [4.0, 5.0, 8.0, 1.0] });
    b.leg("C6", "C7", 30.0, 108.0, -2.5, { lrud: [3.5, 4.0, 6.0, 1.0] });

    // negative LRUD -- some parties write -1 for "not measured", which
    // this suite reads as a warning rather than a silent zero
    b.leg("C7", "C8", 27.0, 142.0, -1.5, {
        lrud: [-1.0, 4.0, 7.0, 1.0],
        notes: "LEFT WALL UNREACHABLE, WROTE -1"
    });
    b.leg("C8", "C9", 32.0, 176.0, -2.0, { lrud: [4.0, 4.0, 6.5, 1.0] });

    // LOOP B closes back onto C1 -- and it is BLUNDERED: the tape on
    // the closing leg is 12% long, which drives the loop's closure
    // past CsValidate.CLOSURE_WARN_PERCENT (2%). A blunder inside a
    // loop is the single most important thing this suite catches, and
    // the fixture puts it on a named leg so the report can be checked
    // against a known answer.
    b.closeLeg("C9", "C1", 1.12, 1.5, {
        lrud: [3.0, 3.0, 5.0, 1.0],
        notes: "LOOP B CLOSING LEG -- BLUNDERED TAPE, 12 PERCENT LONG"
    });

    // three-way junction: C10 carries three legs, so wall runs must
    // BREAK here rather than running through
    b.leg("C5", "C10", 24.0, 20.0, 1.0,
        { lrud: [6.0, 6.0, 9.0, 1.0], notes: "THREE-WAY JUNCTION" });
    b.leg("C10", "C11", 22.0, 350.0, 2.0, { lrud: [3.0, 3.0, 5.0, 0.5] });

    // FLOWSTONE CHAMBER: splay-only room, no LRUD anywhere in it
    b.leg("C11", "C12", 26.0, 318.0, -1.0,
        { lrud: [null, null, null, null], notes: "FLOWSTONE CHAMBER" });
    b.leg("C12", "C13", 30.0, 300.0, -2.0, { lrud: [null, null, null, null] });
    b.leg("C13", "C14", 25.0, 276.0, -1.0, { lrud: [null, null, null, null] });
    b.splayRoom(["C12", "C13", "C14"],
        { rays: 10, minDist: 5, maxDist: 28, ceilingShot: true });

    // a station with NO wall evidence at all: no LRUD, no splays. Wall
    // runs have to break here, and nothing may invent a width for it.
    b.leg("C14", "C15", 28.0, 250.0, -1.5, { lrud: [null, null, null, null] });
    b.leg("C15", "C16", 31.0, 232.0, -2.0);
    b.leg("C16", "C17", 27.0, 214.0, -1.0, { lrud: [3.0, 3.0, 5.0, 1.0] });

    // ---- sump passage --------------------------------------------
    b.useTrip(T_SUMP);
    b.heading = 168.0;
    b.leg("C10", "D1", 33.0, 168.0, -4.0, { lrud: [5.0, 5.0, 8.0, 1.0] });
    b.leg("D1", "D2", 29.0, 152.0, -7.0, { lrud: [4.0, 4.0, 7.0, 1.0] });

    // a DECLARED plumb, straight down 63 ft, and the climb back out.
    // Exactly +-90 is the legal, expected case (unlike A3->A4's 87.5);
    // both still read as near-plumb, which is correct -- the check is
    // a nudge, not an accusation.
    b.leg("D2", "D3", 63.0, 0.0, -90.0, {
        lrud: [6.0, 6.0, 0.0, 4.0],
        notes: "PLUMBED PITCH, ROPE 80 FT"
    });
    b.leg("D3", "D4", 26.0, 140.0, -3.0, { lrud: [4.0, 5.0, 9.0, 1.0] });
    b.leg("D4", "D5", 24.0, 122.0, 90.0, {
        lrud: [3.0, 3.0, 12.0, 0.0],
        notes: "AVEN, PLUMBED UP"
    });

    // mid-trip declination change: the party re-derived declination
    // after D5 (0.15 deg off the IGRF figure they started with) and
    // reduced the rest of the trip with it. The trip is still ONE trip
    // -- declination is not in the fingerprint -- and each leg keeps
    // the value it was actually computed with.
    var declLate = round(declinationOn("2026-05-02") - 0.15, 2);
    b.leg("D5", "D6", 31.0, 104.0, -2.0,
        { lrud: [4.0, 4.0, 7.0, 1.0], declination: declLate });
    b.leg("D6", "D7", 28.0, 86.0, -3.0,
        { lrud: [3.5, 4.0, 6.0, 1.0], declination: declLate });
    b.leg("D7", "D8", 34.0, 68.0, -5.0,
        { lrud: [5.0, 5.0, 8.0, 1.0], declination: declLate });
    b.leg("D8", "D9", 30.0, 52.0, -4.0, {
        lrud: [6.0, 6.0, 10.0, 1.0],
        declination: declLate,
        notes: "SUMP POOL, DYE TRACE STATION"
    });

    // SECOND FIXED STATION -- a control TIE, not a loop. D9's control
    // coordinate disagrees with the walked survey by 2.4 ft in plan
    // and 1.5 ft vertically. Loop-vs-tie is decided by graph bridge
    // detection, and this is the shape that decides it: pull the leg
    // and D9's component is still anchored by its own control.
    var walked = b.pos["D9"];
    b.fix("D9", round(walked.x + 2.4, 3), round(walked.y - 0.9, 3),
        round(walked.z - 1.5, 3));

    b.leg("D9", "D10", 22.0, 38.0, -2.0,
        { lrud: [4.0, 4.0, 6.0, 1.0], declination: declLate });

    // ---- trip 1 resumes, later in the file ------------------------
    // Same date, same team as the MAIN TRUNK block above, so the same
    // fingerprint: the reader must fold these legs back into ONE trip
    // rather than inventing a fifth.
    b.useTrip(T_TRUNK);
    b.heading = 262.0;
    b.leg("B25", "B26", 26.0, 262.0, -1.0, {
        lrud: [5.0, 5.0, 8.0, 1.0],
        notes: "SECOND HALF OF THE TRUNK TRIP, SAME DAY, SAME PARTY"
    });
    b.leg("B26", "B27", 31.0, 248.0, -2.0, { lrud: [4.0, 6.0, 9.0, 1.5] });

    CsModel.ensureTrips(b.survey);
    return b;
}

// ---------------------------------------------------------------------
// The error-severity class, on its own.
//
// Kept OUT of the main fixture deliberately: an unconnected component
// and a zero-distance leg make the main cave partly unresolvable and
// every report noisy, which would bury the warning-class findings the
// main fixture exists to exercise. Here they are the whole point.
// ---------------------------------------------------------------------

function buildBrokenCave() {
    var b = newBuilder("PITFALL CAVE -- BROKEN DATA (TEST)", "ft");
    b.addTrip("BAD DATA", "2026-06-06", "N. SCHONEGG, R. WEBB",
        declinationOn("2026-06-06"));
    b.fix("X1", 0.0, 0.0, GEO.elevationFt);

    b.heading = 90.0;
    b.leg("X1", "X2", 30.0, 90.0, 0.0, { lrud: [3.0, 3.0, 6.0, 1.0] });

    // distance zero: not a shot at all
    b.leg("X2", "X3", 0.0, 120.0, 0.0,
        { notes: "TAPE NEVER READ, ZERO WRITTEN" });

    // a station shot to itself
    b.leg("X3", "X3", 18.0, 140.0, 0.0,
        { place: false, notes: "FROM AND TO THE SAME STATION" });

    // clino outside -90..+90 -- a transcription error, not a steep shot
    b.leg("X3", "X4", 25.0, 160.0, 95.0,
        { notes: "CLINO 95, WROTE THE COMPLEMENT" });

    // azimuth outside 0..360: wrapped on the way in, but the raw value
    // is what a notebook cell holds, so the check has to see it
    var wrapped = b.leg("X4", "X5", 22.0, 200.0, 0.0,
        { notes: "COMPASS WRITTEN 372" });
    wrapped.azimuth = 372.0;

    // a whole component that never joins the survey: two stations
    // nothing else mentions. Almost always a station-name typo.
    b.pos["Z1"] = { x: 500.0, y: 500.0, z: GEO.elevationFt };
    b.leg("Z1", "Z2", 40.0, 45.0, 0.0,
        { notes: "ORPHAN PAIR -- NAME TYPO SOMEWHERE" });

    CsModel.ensureTrips(b.survey);
    return b;
}

// ---------------------------------------------------------------------
// Hand-written dialect file. None of this is reachable from a writer:
// these are the shapes real .svx files in the wild carry, each one a
// place a reader can silently produce a WRONG survey rather than an
// error -- which is the worst failure mode in the whole suite.
// ---------------------------------------------------------------------

var DIALECT_SVX =
"; PitfallCave_Dialects.svx -- parser dialect traps, hand-written.\n" +
"; Generated fixtures cannot carry these: a writer never emits them.\n" +
"; Every block is annotated with what a reader gets WRONG if it\n" +
"; mishandles the directive. Geometry is deliberately trivial (round\n" +
"; bearings, whole numbers) so a wrong answer is obvious by eye.\n" +
";\n" +
"; The cave itself is nonsense -- this file is about the directives.\n" +
"; Note the SHAPE of the file: the unit and angle switches are FLAT\n" +
"; inside one *begin block, because in real Survex a nested block\n" +
"; renames its stations (prefix.name) and a leg written across the\n" +
"; boundary is two different stations, not a connection. The one\n" +
"; nested block below is deliberately a separate component with its\n" +
"; own *fix -- which is also the prefix-naming and flag-scope trap.\n" +
"\n" +
"*begin DIALECT\n" +
"*units length feet\n" +
"*units compass degrees\n" +
"*units clino degrees\n" +
"*fix E1 reference 0 0 812.40\n" +
"*date 2026-07-04\n" +
"*team \"N. SCHONEGG\" compass clino\n" +
"*team \"R. WEBB\" tape\n" +
"*data normal from to tape compass clino\n" +
"\n" +
"; --- 1. *calibrate declination is a ZERO ERROR. Survex computes\n" +
"; (reading - X), so the model declination is -X. A reader that ADDS\n" +
"; it rotates the whole survey by 2X -- 8.5 degrees here, invisible\n" +
"; unless something is georeferenced.\n" +
"*calibrate declination 4.25\n" +
"E1 E2 100.00 90.00 0.00\n" +
"\n" +
"; --- 2. the modern *declination has the CONVENTIONAL sign (added).\n" +
"; Same magnitude as above, opposite meaning: E2->E3 must end up 8.5\n" +
"; degrees away from E1->E2 in the model, not on top of it.\n" +
"*declination 4.25\n" +
"E2 E3 100.00 90.00 0.00\n" +
"\n" +
"; --- 3. plumbs. Compass omitted with \"-\" is legal on a plumbed leg;\n" +
"; UP/DOWN/U/D/+V/-V and LEVEL are keywords, not numbers. A reader\n" +
"; that parseFloats these gets 0 and flattens a pitch to level.\n" +
"E3 E4 40.00 - DOWN\n" +
"E4 E5 40.00 - UP\n" +
"E5 E6 25.00 - +V\n" +
"E6 E7 25.00 180.00 LEVEL\n" +
"\n" +
"; --- 4. anonymous stations are SPLAYS: \".\" \"..\" \"...\" and the\n" +
"; PocketTopo \"-\". A reader that treats these as real station names\n" +
"; builds a station called \"..\" that every later splay collides with.\n" +
"E7 .. 12.00 45.00 0.00\n" +
"E7 .. 14.00 135.00 0.00\n" +
"E7 . 9.00 225.00 -5.00\n" +
"E7 - 11.00 315.00 5.00\n" +
"\n" +
"; --- 5. *flags. duplicate excludes from LENGTH; surface excludes\n" +
"; from length AND plot; \"not\" clears; *flags splay makes a NAMED\n" +
"; station's shot a wall shot.\n" +
"*flags duplicate\n" +
"E7 E8 50.00 90.00 0.00\n" +
"*flags not duplicate\n" +
"*flags surface\n" +
"E8 E9 60.00 90.00 0.00\n" +
"*flags not surface\n" +
"*flags splay\n" +
"E9 E9S 15.00 0.00 0.00\n" +
"*flags not splay\n" +
"\n" +
"; --- 6. UNIT SWITCH MID-FILE. These legs are surveyed in METRES; the\n" +
"; survey's working unit is already feet, so every distance here must\n" +
"; be CONVERTED, not copied. A reader that copies refoots a metric\n" +
"; run and shrinks it by 3.28 -- the silent-refooting bug the CSV\n" +
"; rewrite existed to kill. 30.48 m is exactly 100 ft.\n" +
"*date 2026-07-05\n" +
"*team \"K. AYERS\" tape\n" +
"*units length metres\n" +
"E9 M1 30.48 90.00 0.00\n" +
"M1 M2 30.48 0.00 0.00\n" +
"*units length feet\n" +
"\n" +
"; --- 7. yards, and a unit FACTOR. 1 yd = 0.9144 m, so 33.33 yd is\n" +
"; ~100 ft; the factor form \"*units length 2 feet\" means every tape\n" +
"; reading counts double, so 50.00 is 100 ft.\n" +
"*units length yards\n" +
"M2 Y1 33.33 180.00 0.00\n" +
"*units length 2 feet\n" +
"Y1 Y2 50.00 180.00 0.00\n" +
"*units length feet\n" +
"\n" +
"; --- 8. grads and percent. 400 grads = 360 degrees; a clino in\n" +
"; percent is a TANGENT, not an angle (100 percent = 45 degrees).\n" +
"; Reading either as degrees is a wrong cave that still plots.\n" +
"*units compass grads\n" +
"Y2 G1 40.00 100.00 0.00\n" +
"*units compass degrees\n" +
"*units clino percent\n" +
"G1 G2 40.00 90.00 100.00\n" +
"*units clino degrees\n" +
"\n" +
"; --- 9. backsights, and the field-name aliases. length/bearing/\n" +
"; gradient are the long names for tape/compass/clino; backbearing\n" +
"; and backgradient carry the backsight. The first pair below\n" +
"; disagrees by 6 degrees in compass, the second by 4 in clino, and\n" +
"; both must reach the fs/bs check rather than being averaged away.\n" +
"*data normal from to length bearing gradient backbearing backgradient\n" +
"G2 K1 45.00 90.00 -5.00 276.00 5.00\n" +
"K1 K2 45.00 180.00 -5.00 0.00 -1.00\n" +
"*data normal from to tape compass clino\n" +
"\n" +
"; --- 10. *data passage LRUD is per STATION, associated with the TO\n" +
"; station, and \"-\" means NOT MEASURED (null), which is not zero.\n" +
"; The first station's reading has no arriving shot to carry it and\n" +
"; belongs in survey.startLrud.\n" +
"*data passage station left right up down\n" +
"E1 3.0 4.5 6.0 0.0\n" +
"E2 5.0 5.0 9.0 1.0\n" +
"E3 - - 12.0 -\n" +
"E4 0.0 0.0 30.0 2.0\n" +
"*data normal from to tape compass clino\n" +
"\n" +
"; --- 11. a NESTED block: its stations are renamed DIALECT.SIDE.*, so\n" +
"; a leg written to \"E9\" in here would NOT reach DIALECT.E9 -- it is a\n" +
"; separate component, which is why it carries its own *fix. The flag\n" +
"; set is saved at *begin and restored at *end: the surface flag below\n" +
"; must NOT leak out to the legs that follow this block, or real\n" +
"; passage silently drops out of the cave's total length.\n" +
"*begin SIDE\n" +
"*fix S1 300 300 1300\n" +
"*flags surface\n" +
"S1 S2 40.00 90.00 0.00\n" +
"*end SIDE\n" +
"\n" +
"; --- 12. two *date lines with NO leg between them, each with its own\n" +
"; *team. This used to credit T. FIRST with J. PARK's trip: the\n" +
"; previous crew was cleared only when a LEG had been recorded since\n" +
"; the last *date, and here there is none between them. A change of\n" +
"; DATE now clears the crew on its own, so the trip below must read\n" +
"; J. PARK alone. (The *team line between the two dates is what makes\n" +
"; this a real reproduction -- without it the earlier crew is already\n" +
"; cleared by the leg above and the trap never fires.)\n" +
"*date 2026-07-06\n" +
"*team \"T. FIRST\" notes\n" +
"*date 2026-07-07\n" +
"*team \"J. PARK\" notes\n" +
"K2 P1 20.00 270.00 0.00\n" +
"\n" +
"*end DIALECT\n";

// ---------------------------------------------------------------------
// Verification. Parse every file back through the real readers, then
// resolve and validate, and check the pitfall inventory. Prints a
// coverage table; exits non-zero (and prints the FAIL marker
// run_all.sh looks for) when a fixture stops carrying its trap.
// ---------------------------------------------------------------------

var failures = [];
var report = [];

function say(line) {
    report.push(line);
    if (IS_NODE) {
        console.log(line);
    } else {
        qDebug(line);
    }
}

function expect(cond, what) {
    if (!cond) {
        failures.push(what);
        say("  FAIL  " + what);
    } else {
        say("  ok    " + what);
    }
}

function codesOf(findings) {
    var out = {};
    for (var i = 0; i < findings.length; i++) {
        out[findings[i].code] = (out[findings[i].code] || 0) + 1;
    }
    return out;
}

function summarize(label, survey) {
    var resolved = CsNetwork.resolve(survey);
    var findings = CsValidate.check(survey, resolved);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var codes = codesOf(findings);
    var splays = 0, i;
    for (i = 0; i < survey.shots.length; i++) {
        if (survey.shots[i].splay) {
            splays++;
        }
    }
    say("");
    say("== " + label);
    say("   trips " + survey.trips.length +
        "   shots " + survey.shots.length +
        " (splays " + splays + ")" +
        "   stations " + CsModel.stationNames(survey).length +
        "   unit " + survey.distanceUnit);
    say("   resolved stations " + Object.keys(resolved.stations).length +
        "   loops " + resolved.loops.length +
        "   ties " + resolved.ties.length +
        "   anchors " + resolved.anchors.length +
        "   unresolved " + resolved.unresolved.length);
    if (stats !== null && stats !== undefined) {
        say("   surveyed " + stats.surveyedLength.toFixed(1) + " " +
            survey.distanceUnit +
            "   plan " + stats.planLength.toFixed(1) +
            "   depth " + stats.depth.toFixed(1));
    }
    for (i = 0; i < resolved.loops.length; i++) {
        var lp = resolved.loops[i];
        say("   loop " + lp.from + ".." + lp.to + "  " +
            lp.error.toFixed(2) + " off over " +
            lp.traverseLength.toFixed(1) + " = " + lp.percent.toFixed(2) + "%");
    }
    for (i = 0; i < resolved.ties.length; i++) {
        var ti = resolved.ties[i];
        say("   tie  " + ti.from + ".." + ti.to + "  " +
            ti.error.toFixed(2) + " off (h " +
            (ti.horizontal === undefined ? "?" : ti.horizontal.toFixed(2)) +
            ", v " + (ti.vertical === undefined ? "?" : ti.vertical.toFixed(2)) +
            ")");
    }
    var keys = Object.keys(codes).sort();
    for (i = 0; i < keys.length; i++) {
        say("   finding " + keys[i] + " x" + codes[keys[i]]);
    }
    return { resolved: resolved, findings: findings, codes: codes, stats: stats };
}

// ---- build ------------------------------------------------------------

var main = buildPitfallCave();
var broken = buildBrokenCave();

var OUT = repoRoot + "/testdata/";
// The georeference. Neither the model nor any survey format carries a
// lat/lon -- in a CaveCAD drawing it lives as GeoLat/GeoLon/GeoStation
// XDATA on the station point, written by Aerial Basemap or the map
// picker. So the coordinate rides these files as a HEADER the readers
// ignore (a Survex comment; an unknown "# key:" the CSV reader skips),
// purely so the number travels with the fixture instead of living in a
// note somewhere. Compass .dat gets none: its reader is column-strict,
// and Compass keeps fixed stations in the .mak anyway.
var GEO_SVX_HEADER =
    "; GEOREFERENCE (for CaveCAD's Aerial Basemap / map picker):\n" +
    "; GEO " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "   ; WGS84 lat lon, southern Indiana karst\n" +
    "; entrance elevation " + GEO.elevationFt.toFixed(2) + " ft\n" +
    "; synthetic location -- not a real entrance\n";
var GEO_CSV_HEADER =
    "# geo: " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "\n" +
    "# geonote: WGS84, southern Indiana karst, synthetic -- not a real " +
        "entrance\n";

var svxText = GEO_SVX_HEADER + CsFormatSurvex.write(main.survey);
var datText = CsFormatCompass.write(main.survey);
var csvText = GEO_CSV_HEADER + CsFormatCsv.write(main.survey);
var brokenSvx = CsFormatSurvex.write(broken.survey);
var brokenCsv = CsFormatCsv.write(broken.survey);

writeTextFile(OUT + "PitfallCave.svx", svxText);
writeTextFile(OUT + "PitfallCave.dat", datText);
writeTextFile(OUT + "PitfallCave.csv", csvText);
writeTextFile(OUT + "PitfallCave_Dialects.svx", DIALECT_SVX);
writeTextFile(OUT + "PitfallCave_Broken.svx", brokenSvx);
writeTextFile(OUT + "PitfallCave_Broken.csv", brokenCsv);

say("PITFALL CAVE fixtures written to testdata/");

// ---- the model as built -----------------------------------------------

var built = summarize("as built (model, before any file round trip)",
    main.survey);

expect(main.survey.trips.length === 4, "four trips (two share a date)");
expect(CsModel.tripFingerprint(main.survey.trips[2]) !==
    CsModel.tripFingerprint(main.survey.trips[3]),
    "same-date trips have different fingerprints (team is in it)");
expect(main.survey.fixed["A1"].z === GEO.elevationFt &&
    GEO.elevationFt !== 0.0,
    "entrance datum is " + GEO.elevationFt + " ft, not zero");
expect(main.survey.trips[0].declination < 0,
    "declination is WEST (negative, east-positive convention) as " +
    "southern Indiana really is -- trip 0 reads " +
    main.survey.trips[0].declination);
expect(Math.abs(main.survey.trips[0].declination) > 2.0 &&
    Math.abs(main.survey.trips[0].declination) < 8.0,
    "declination magnitude is the real IGRF-14 figure for the entrance, " +
    "not a placeholder");
expect(Object.keys(main.survey.fixed).length === 2,
    "two fixed stations (the second makes a control tie)");
expect(built.resolved.loops.length >= 2, "at least two loops resolved");
expect(built.resolved.ties.length >= 1, "at least one control tie");
expect(built.codes["loop-misclosure"] >= 1,
    "the blundered loop trips loop-misclosure");
expect(built.codes["near-plumb"] >= 3, "near-plumb legs flagged");
expect(built.codes["fsbs-azimuth-disagree"] >= 1,
    "foresight/backsight compass disagreement flagged");
expect(built.codes["fsbs-inclination-disagree"] >= 1,
    "foresight/backsight clino disagreement flagged");
expect(built.codes["duplicate-disagrees"] >= 1,
    "disagreeing duplicate readings flagged");
expect(built.codes["backsight-as-foresight"] >= 1,
    "backsight entered as foresight flagged");
expect(built.codes["negative-lrud"] >= 1, "negative LRUD flagged");
expect(built.codes["unconnected"] === undefined,
    "main fixture has no unconnected shots (they live in the broken file)");
expect(!CsValidate.checkHasErrors(built.findings),
    "main fixture carries WARNINGS only, so it still draws clean");

var cleanLoops = 0, blunderLoops = 0;
for (var li = 0; li < built.resolved.loops.length; li++) {
    if (built.resolved.loops[li].percent > CsValidate.CLOSURE_WARN_PERCENT) {
        blunderLoops++;
    } else {
        cleanLoops++;
    }
}
expect(cleanLoops >= 1, "one loop closes UNDER the 2% warning");
expect(blunderLoops >= 1, "one loop closes OVER it (the planted blunder)");

// PINNED OBSERVATION, not an endorsement: a re-read of one pair and a
// leg entered from the wrong end each become a TWO-STATION loop in
// resolve(), scored like any other closure. The reversed leg's 99.9%
// then sets the BCRA grade for the whole cave. That is arguably honest
// for a real blunder and arguably wrong for a duplicate reading the
// validator already reports on its own terms -- either way the fixture
// pins today's answer so a change shows up as a change.
var twoStationLoops = 0;
for (var tl = 0; tl < built.resolved.loops.length; tl++) {
    if (built.resolved.loops[tl].traverseLength < 100.0) {
        twoStationLoops++;
    }
}
expect(twoStationLoops === 3,
    "duplicate/reversed/duplicate-flagged pairs each score as their own " +
    "two-station loop (3 of the 5 loops; pinned behaviour)");

var grade = CsGrade.compute(main.survey, built.resolved, built.stats);
say("   BCRA grade " + (grade === null || grade === undefined ? "?" :
    (grade.uis + " -- " + grade.centrelineText)));

// the adjustment has to run on this fixture and leave the AS-SURVEYED
// closures alone (the load-bearing rule in CsAdjust)
var adjusted = CsAdjust.resolveAndAdjust(main.survey, {},
    { enabled: true, sigmaTape: 0.1, sigmaAngle: 1.5 });
expect(adjusted !== null && adjusted !== undefined &&
    adjusted.loops.length === built.resolved.loops.length,
    "least-squares adjustment runs and keeps the as-surveyed loops");
if (adjusted !== null && adjusted !== undefined &&
        adjusted.loops.length === built.resolved.loops.length &&
        built.resolved.loops.length > 0) {
    var samePercent = Math.abs(adjusted.loops[0].percent -
        built.resolved.loops[0].percent) < 1e-9;
    expect(samePercent,
        "adjusted report still shows the AS-SURVEYED closure percentage");
}

// splay-only stations must still produce wall runs (splays feed walls)
var wallRuns = CsLrud.wallRuns(main.survey, built.resolved);
expect(wallRuns !== null && wallRuns !== undefined &&
    ((wallRuns.left || []).length + (wallRuns.right || []).length) > 0,
    "wall runs generated (splay rooms carry walls with no LRUD)");

// ---- round trips ------------------------------------------------------

var reSvx = summarize("Survex round trip (PitfallCave.svx)",
    CsFormatSurvex.parse(svxText));
expect(reSvx.resolved.loops.length === built.resolved.loops.length,
    "Survex round trip keeps both loops");
expect(reSvx.codes["loop-misclosure"] >= 1,
    "Survex round trip keeps the blundered loop");
expect(reSvx.codes["fsbs-azimuth-disagree"] >= 1,
    "Survex round trip keeps backsights");

expect(svxText.indexOf("; GEO A1 38.4795 -86.4381") >= 0 &&
    csvText.indexOf("# geo: A1 38.4795 -86.4381") >= 0,
    "both files carry the entrance coordinate in a header the readers ignore");

var reSvxSurvey = CsFormatSurvex.parse(svxText);
expect(reSvxSurvey.shots.length === main.survey.shots.length - 1,
    "Survex round trip loses exactly the excludeFromAll shot (documented)");

var reDat = summarize("Compass round trip (PitfallCave.dat)",
    CsFormatCompass.parse(datText));
expect(reDat.resolved.loops.length === built.resolved.loops.length,
    "Compass round trip keeps every loop");
expect(reDat.resolved.ties.length === 0 && reDat.resolved.anchors.length === 1,
    "Compass round trip loses the SECOND fixed station, so the control " +
    "tie becomes an ordinary traverse (documented: Compass keeps fixed " +
    "stations in the .mak project file, not the .dat)");

var reCsvSurvey = CsFormatCsv.parse(csvText);
var reCsv = summarize("CSV round trip (PitfallCave.csv)", reCsvSurvey);
expect(reCsv.resolved.loops.length === built.resolved.loops.length,
    "CSV round trip keeps every loop");
expect(reCsvSurvey.shots.length === main.survey.shots.length,
    "CSV round trip keeps every shot, flags included");
expect(reCsvSurvey.trips.length === 1,
    "CSV round trip collapses FOUR trips to one (documented: the writer " +
    "emits a single header block)");

var reBroken = summarize("broken fixture (PitfallCave_Broken.svx)",
    broken.survey);
expect(reBroken.codes["self-loop"] >= 1, "broken: self-loop");
expect(reBroken.codes["bad-distance"] >= 1, "broken: zero distance");
expect(reBroken.codes["inclination-range"] >= 1, "broken: clino 95");
expect(reBroken.codes["azimuth-range"] >= 1, "broken: azimuth 372");
expect(reBroken.codes["unconnected"] >= 1, "broken: orphan component");
expect(CsValidate.checkHasErrors(reBroken.findings),
    "broken fixture reports ERROR severity");

// WHERE THE OUT-OF-RANGE AZIMUTH LIVES. Probed, not assumed: EVERY
// reader normalizes (CsFormatCsv.parse calls normalizeAzimuth; the
// Survex writer even un-applies declination and normalizes on the way
// OUT, so 372 leaves the .svx as 7.5). So `azimuth-range` is
// unreachable through an import and can only fire on data typed into
// the model -- a notebook cell. The fixture keeps the raw 372 in the
// CSV TEXT so that cell can be pasted, and pins both halves of the
// fact rather than pretending the import path covers it.
expect(brokenCsv.indexOf(",372,") >= 0,
    "broken CSV file text carries the raw 372 azimuth for pasting into " +
    "the notebook");
var brokenCsvBack = CsFormatCsv.parse(brokenCsv);
var brokenCsvCodes = codesOf(CsValidate.check(brokenCsvBack,
    CsNetwork.resolve(brokenCsvBack)));
expect(brokenCsvCodes["azimuth-range"] === undefined,
    "every reader normalizes, so azimuth-range is unreachable through " +
    "an import -- pitfall 45 is a NOTEBOOK-entry test only (pinned)");

var dialects = summarize("dialect fixture (PitfallCave_Dialects.svx)",
    CsFormatSurvex.parse(DIALECT_SVX));
expect(dialects.codes["near-plumb"] >= 3,
    "dialects: plumb keywords parsed as plumbs, not flattened to level");
expect(dialects.codes["fsbs-azimuth-disagree"] >= 1,
    "dialects: backsight aliases reach the fs/bs check");

// The dialect file's arithmetic is checkable by hand -- these are the
// conversions a reader gets silently WRONG.
var dsurvey = CsFormatSurvex.parse(DIALECT_SVX);
function shotBetween(survey, from, to) {
    for (var i = 0; i < survey.shots.length; i++) {
        if (survey.shots[i].from === from && survey.shots[i].to === to) {
            return survey.shots[i];
        }
    }
    return null;
}
var metric = shotBetween(dsurvey, "DIALECT.E9", "DIALECT.M1");
expect(metric !== null && Math.abs(metric.distance - 100.0) < 0.01,
    "dialects: 30.48 m converts to 100.00 ft (no silent refooting)");
var yard = shotBetween(dsurvey, "DIALECT.M2", "DIALECT.Y1");
expect(yard !== null && Math.abs(yard.distance - 99.99) < 0.1,
    "dialects: 33.33 yards converts to ~100 ft");
var factored = shotBetween(dsurvey, "DIALECT.Y1", "DIALECT.Y2");
expect(factored !== null && Math.abs(factored.distance - 100.0) < 0.01,
    "dialects: '*units length 2 feet' doubles a 50 ft reading");
var gradLeg = shotBetween(dsurvey, "DIALECT.Y2", "DIALECT.G1");
expect(gradLeg !== null && Math.abs(CsAngles.azimuthDifference(
    gradLeg.azimuth, 90.0 + gradLeg.declination)) < 0.01,
    "dialects: 100 grads reads as 90 degrees");
var pctLeg = shotBetween(dsurvey, "DIALECT.G1", "DIALECT.G2");
expect(pctLeg !== null && Math.abs(pctLeg.inclination - 45.0) < 0.01,
    "dialects: clino 100 percent reads as 45 degrees");
var calLeg = shotBetween(dsurvey, "DIALECT.E1", "DIALECT.E2");
var modLeg = shotBetween(dsurvey, "DIALECT.E2", "DIALECT.E3");
expect(calLeg !== null && Math.abs(calLeg.declination + 4.25) < 0.001,
    "dialects: *calibrate declination 4.25 means -4.25 in the model");
expect(modLeg !== null && Math.abs(modLeg.declination - 4.25) < 0.001,
    "dialects: *declination 4.25 means +4.25 in the model");

// ---- manifest ---------------------------------------------------------

var MANIFEST = [
"# PITFALL CAVE -- test fixture inventory",
"",
"Generated by `tools/make_test_cave.js` (`node tools/make_test_cave.js`).",
"Regenerating is deterministic: the meander runs off a seeded LCG, so the",
"numbers below stay true. Every coordinate is synthetic -- no real",
"entrance, and nothing here should ever be given a real lat/lon.",
"",
"## Files",
"",
"| File | What it is |",
"|---|---|",
"| `PitfallCave.svx` | the main cave, written by the Survex writer |",
"| `PitfallCave.dat` | same survey through the Compass writer |",
"| `PitfallCave.csv` | same survey through the CSV writer |",
"| `PitfallCave_Dialects.svx` | hand-written parser dialect traps |",
"| `PitfallCave_Broken.svx` | the error-severity class, on its own |",
"| `PitfallCave_Broken.csv` | same, for the CSV reader |",
"",
"## Where it is",
"",
"| | |",
"|---|---|",
"| Entrance station | `A1` (the project convention: A1 is always the georeference anchor) |",
"| Latitude / longitude | **38.4795, -86.4381** (WGS84) |",
"| Where that is | southern Indiana karst, Orange County, a few miles from Paoli |",
"| Entrance elevation | 812.40 ft (upland-plausible for that county, and deliberately not zero) |",
"| Declination | the REAL IGRF-14 value at that point on each trip's date -- WEST, so negative in the east-positive convention the model stores |",
"",
"The location is SYNTHETIC: an arbitrary rural point picked so aerial",
"basemap work has real NAIP imagery and real karst terrain under it. It is",
"not a cave and corresponds to no known entrance.",
"",
"No survey format carries a lat/lon, and neither does `CsModel` -- in a",
"drawing the georeference lives as `GeoLat`/`GeoLon`/`GeoStation` XDATA on",
"the station point, written by Aerial Basemap or the map picker. So the",
"coordinate rides `PitfallCave.svx` as a `; GEO ...` comment and",
"`PitfallCave.csv` as a `# geo:` line, both ignored by the readers. To use",
"it: File > New (the NSS template pours itself), Import Cave Survey, then",
"Aerial Basemap and give it `38.4795 -86.4381` -- or click the point in the",
"map picker. `AerialBasemap.findAnchor` looks for an existing",
"`GeoLat`/`GeoLon` first and falls back to the station named A1, which this",
"fixture has.",
"",
"## Shape of the main cave",
"",
"Four trips, ~80 stations, two loops, one control tie, two splay rooms:",
"",
"| Trip | Date | Team | Declination | Stations |",
"|---|---|---|---|---|",
"| ENTRANCE SERIES | 2026-03-14 | N. SCHONEGG, R. WEBB | " + main.survey.trips[0].declination + " | A1-A14, ENTRANCE-DIG-1 |",
"| MAIN TRUNK | 2026-04-11 | N. SCHONEGG, T. HALE | " + main.survey.trips[1].declination + " | B1-B27, B23.1, UPPERWESTMAZEJUNCTION |",
"| WEST MAZE | 2026-05-02 | K. AYERS, D. OTT | " + main.survey.trips[2].declination + " | C1-C17 |",
"| SUMP PASSAGE | 2026-05-02 | R. WEBB, J. PARK | " + main.survey.trips[3].declination + " (less 0.15 after D5) | D1-D10 |",
"",
"Trips 3 and 4 share a DATE and differ only in team: that is the",
"fingerprint (`date|team`) keeping two parties separately revisable. The",
"MAIN TRUNK trip appears in TWO blocks (its last two legs sit at the end",
"of the file) so the reader has to fold them back into one trip by",
"fingerprint rather than inventing a fifth.",
"",
"## Pitfall inventory",
"",
"| # | Pitfall | Where | Expected |",
"|---|---|---|---|",
"| 1 | absolute elevation datum | `*fix A1 ... 812.40` | any z defaulting to 0 rebases the cave |",
"| 2 | second fixed station | D9, 2.4 ft plan / 1.5 ft vertical off the walked position | classified as a control TIE, not a loop |",
"| 3 | clean loop | A12-A13-A14-B4-B3-B2-B1-A12, closing leg A14->B4 taped 0.4% long | closes 1.22 ft over 332 ft = 0.37%, UNDER the 2% warning |",
"| 4 | blundered loop | C1..C9 west maze, closing leg C9->C1 taped 12% long | closes 10.05 ft over 336 ft = 2.99%, `loop-misclosure` |",
"| 5 | loop spanning two trips | loop A crosses ENTRANCE SERIES and MAIN TRUNK | loop detection is not per-trip |",
"| 6 | near-plumb, undeclared | A3->A4, -87.5 deg, 42 ft | `near-plumb` warning |",
"| 7 | declared plumbs | D2->D3 (-90), D4->D5 (+90) | plumb geometry, still flagged near-plumb |",
"| 8 | fs/bs compass disagreement | A7->A8, 5.6 deg | `fsbs-azimuth-disagree` |",
"| 9 | fs/bs clino disagreement | A8->A9, 4.2 deg | `fsbs-inclination-disagree` |",
"| 10 | disagreeing duplicate | two readings of B10->B11 (9 deg, 4 ft apart) | `duplicate-disagrees` |",
"| 11 | backsight in the foresight column | B18->B17 | `backsight-as-foresight` |",
"| 12 | negative LRUD | C7->C8 left = -1 | `negative-lrud` |",
"| 13 | LRUD zero vs null | A6 (0,0 = wall at station) vs A7 (not measured) | zero is a measurement, null is not |",
"| 14 | multi-reading LRUD | C4->C5 left \"5/10\" | every reading kept, not just the first |",
"| 15 | splay room with LRUD | BIG ROOM, B12-B13 | walls from both kinds of evidence |",
"| 16 | splay-only rooms | BIG ROOM B14-B15, FLOWSTONE CHAMBER C12-C14 | walls from splays alone |",
"| 17 | steep ceiling splay | B12 and C12, +71 deg | no steepness filter: the wall is pulled in, by design |",
"| 18 | axial splay | B12, down-passage | belongs to neither wall |",
"| 19 | station with no wall evidence | C16 | wall run BREAKS; no width invented |",
"| 20 | three-way junction | C10 (C5->C10, C10->C11, C10->D1) | wall run breaks at the junction |",
"| 21 | duplicate flag | second B21->B22 leg | excluded from LENGTH, still plotted |",
"| 22 | surface flag | A11->ENTRANCE-DIG-1 | excluded from length AND plot |",
"| 23 | excluded from everything | B23->B23X | out of the network; Survex cannot carry it (documented loss) |",
"| 24 | no-adjust leg | B20->B21 | held by weight through the least-squares adjustment |",
"| 25 | station name > 8 chars | `ENTRANCE-DIG-1` | real Walls truncates it |",
"| 26 | station name > 12 chars | `UPPERWESTMAZEJUNCTION` | real Compass cannot hold it |",
"| 27 | station named like a splay | `B23.1` | `splayBaseOf` would read it as splay 1 of B23 |",
"| 28 | note with a comma and a semicolon | A9->A10 | CSV column safety, Survex comment safety |",
"| 29 | mid-trip declination change | D5 onward, the trip's IGRF value less 0.15 | one trip, two per-leg declinations |",
"| 30 | trip resumed later in the file | last two MAIN TRUNK legs | folded back by fingerprint |",
"| 31 | metric block in a feet survey | `PitfallCave_Dialects.svx` METRICRUN | 30.48 m -> 100.00 ft, no silent refooting |",
"| 32 | yards, and a unit factor | ODDUNITS | 33.33 yd and 2x50 ft both ~100 ft |",
"| 33 | grads and percent clino | ANGLEUNITS | 100 grads = 90 deg; 100% = 45 deg |",
"| 34 | `*calibrate declination` sign | dialects, E1->E2 | ZERO ERROR: model declination is its NEGATION |",
"| 35 | `*declination` sign | dialects, E2->E3 | conventional: added |",
"| 36 | plumb keywords | dialects, E3->E7 (`-` compass, UP/DOWN/+V/LEVEL) | not parsed as 0 |",
"| 37 | anonymous stations | dialects, E7 (`..`, `-`) | splays, not stations named \"..\" |",
"| 38 | flag scope across begin/end | dialects, *flags blocks | flags never leak past their block |",
"| 39 | `*fix ... reference` | dialects, E1 | the optional keyword sits AFTER the station name; skipped, coordinates still read |",
"| 40 | quoted `*team` with roles | dialects | member name kept, role words dropped |",
"| 41 | two `*date`s, no leg between, a `*team` on each | dialects, end of file | the date-B trip is `J. PARK` ALONE. Was a known gap (the previous crew leaked in, crediting someone with a trip they were not on); fixed 2026-08-31 -- a change of DATE clears the crew, while two `*date` lines carrying the SAME date still accumulate their `*team`s as one trip |",
"| 42 | self-loop | broken, X3->X3 | ERROR `self-loop` |",
"| 43 | zero distance | broken, X2->X3 | ERROR `bad-distance` |",
"| 44 | clino out of range | broken, X3->X4 (95) | ERROR `inclination-range` |",
"| 45 | azimuth out of range | broken, X4->X5 -- raw `372` in `PitfallCave_Broken.csv` line 12 | `azimuth-range` fires on MODEL data only: every reader normalizes, and the Survex writer even writes 372 back out as 7.5. Type or paste the cell into SurveyNotebook to exercise the check |",
"| 46 | unconnected component | broken, Z1->Z2 | ERROR `unconnected` |",
"",
"## Two-station loops (pinned behaviour, worth a decision)",
"",
"Three of the five loops resolve() reports are TWO-STATION loops made by",
"the duplicate and reversed legs, not passage loops:",
"",
"- `B10..B11` 10.43% -- the disagreeing re-read (pitfall 10)",
"- `B18..B17` 99.94% -- the leg entered from the wrong end (pitfall 11)",
"- `B21..B22` 0.80% -- the agreeing duplicate-flagged leg (pitfall 21)",
"",
"The 99.94% one sets the BCRA grade for the whole cave (grade 2). For a",
"real blunder that is honest; for a duplicate reading the validator",
"already reports on its own terms it inflates `loopCount` and feeds the",
"grade's \"supported by N loops\" claim with loops that are not",
"independent. The fixture pins today's answer rather than assuming it is",
"right.",
"",
"## Known format losses (expected, not bugs)",
"",
"- Survex has no representation for `excludeFromAll`, so pitfall 23 does",
"  not survive the `.svx` round trip -- it is written as a comment, and",
"  that comment carries only the station names and the tape (`; excluded",
"  shot: B23 B23X 15.00`), not the bearings.",
"- The CSV writer emits ONE header block, so a multi-trip survey collapses",
"  to trip 0's metadata: `PitfallCave.csv` keeps every shot but loses the",
"  four trips' separate dates, teams and declinations. Per-leg",
"  declinations are not a CSV column either.",
"- Compass keeps fixed stations in the `.mak` project file, not the",
"  `.dat`, so `PitfallCave.dat` loses the SECOND fixed station: the",
"  control tie at D9 (pitfall 2) comes back as an ordinary traverse with",
"  one anchor.",
"- Station names over 8 (Walls) and 12 (Compass) characters are written",
"  verbatim; the real applications truncate them. Pitfalls 25 and 26 exist",
"  to make that visible rather than to be fixed here.",
""
].join("\n");

// The measured numbers, written by the run that produced the files, so
// the manifest cannot drift from the fixture it describes.
var measured = ["", "## Measured on the last regeneration", "",
    "```", ""];
for (var mi = 0; mi < report.length; mi++) {
    if (report[mi].indexOf("  ok    ") !== 0 &&
            report[mi].indexOf("  FAIL  ") !== 0) {
        measured.push(report[mi]);
    }
}
measured.push("```");
measured.push("");
writeTextFile(OUT + "PitfallCave_MANIFEST.md",
    MANIFEST + measured.join("\n"));

say("");
if (failures.length === 0) {
    say("### TEST CAVE OK -- " + report.length +
        " lines, every pitfall still carried");
} else {
    say("### TEST CAVE FAIL -- " + failures.length + " check(s) failed:");
    for (var fi = 0; fi < failures.length; fi++) {
        say("   " + failures[fi]);
    }
}

if (IS_NODE) {
    process.exit(failures.length === 0 ? 0 : 1);
} else if (typeof QCoreApplication !== "undefined") {
    QCoreApplication.quit();
}
