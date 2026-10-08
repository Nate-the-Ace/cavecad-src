// make_pit_cave.js -- builds the PLUMBLINE PIT test fixtures: a cave
// that is mostly AIR. 380 ft deep in about 140 ft of plan extent, four
// pitches, an aven, a shaft that is nearly a duplicate of its
// neighbour, and a control tie whose misclosure is almost entirely
// vertical.
//
//   node tools/make_pit_cave.js
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_pit_cave.js "$PWD"
//
// Writes into testdata/ and VERIFIES its own output, exactly as
// tools/make_test_cave.js does for Pitfall Cave. The two fixtures are
// deliberately different animals and neither replaces the other:
//
//   PITFALL CAVE     2400 ft long, 143 ft deep. A horizontal cave with
//                    one pit in it. Carries the parser, validator and
//                    network traps.
//   PLUMBLINE PIT     735 ft long, 380 ft deep. A vertical cave with
//                    a little passage in it. Carries the traps that
//                    only a pitch can spring.
//
// WHY A SECOND FIXTURE AT ALL. Every geometry rule in this suite that
// asks "which way does the passage run here" answers from a bearing,
// and on a pitch there is no bearing -- the needle is noise, the caver
// is on a rope, and the compass column holds a dash or a formality.
// Seven thousand assertions over a horizontal cave never asked the
// question, so a whole family of fabricated-direction bugs lived here
// undisturbed: a plumb leg's plan projection is cos(90 degrees), which
// is 6.1e-17 rather than 0, and that dust was being divided by itself
// and reported as a confident bearing of due north. Pit caves are not
// a niche -- most long horizontal caves have vertical in them -- and
// nothing in the suite could see any of it.
//
// PRIVACY: the cave is synthetic and so is its location. A1 sits at a
// plausible but arbitrary rural point on the Cumberland Plateau (see
// GEO below), which is pit country and so has the right terrain under
// it. It is not a cave, and no real entrance appears anywhere in these
// files. That matters more here than it did for Pitfall: a deep pit's
// coordinates are exactly the thing this project never publishes.

// ---------------------------------------------------------------------
// Environment shim -- same problem and same answer as
// tools/make_test_cave.js: the Core is pure ECMAScript, so this runs
// under node and under CaveCAD's own engine.
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

// ---------------------------------------------------------------------
// WHERE THE CAVE IS. An arbitrary rural point on the Cumberland
// Plateau in northwest Georgia -- pit country, so the terrain and the
// imagery under a georeferenced drawing are the right kind. It is NOT
// a cave.
//
// The entrance elevation, 1742.00 ft, is plateau-plausible and
// deliberately not zero: the datum trap is the reason the number
// exists. In a cave this deep it does double duty -- the floor of the
// final pit is at 1361.70 ft, and a tool that quietly rebases the
// survey on zero puts it 1361 ft UNDERGROUND relative to a surface
// model that still knows where it is.
// ---------------------------------------------------------------------

var GEO = {
    station: "A1",
    lat: 34.9612,
    lon: -85.7433,
    elevationFt: 1742.00
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
// Survey builder. Same shape as make_test_cave.js's, plus the two
// things a vertical cave needs and a horizontal one never did:
// `azimuthOmitted` (the dash a caver writes in the compass column on a
// pitch) and per-side Open flags (the "P" they write for UP at the
// foot of a drop, where the ceiling is the pitch itself and there is
// nothing to measure).
// ---------------------------------------------------------------------

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
// PLUMBLINE PIT -- the main fixture.
//
//   A1  sinkhole rim, fixed on a real 1742.00 ft datum
//    |  16 ft to the floor, 12 ft down a handline to the lip
//   A3  LIP -- two bolts, a Y-hang
//    |  P1: 62 ft plumb to a rebelay at a window, then 125 ft of
//    |  free-fall. 187 ft in two legs, both with NO BEARING SIGHTED.
//   A4  the window ledge --------- B2 - B1 second entrance (daylight),
//    |                             a GPS fix on B1 makes a control tie
//    |                             whose misclosure is nearly all
//   A5  bell chamber floor         VERTICAL
//    |  breakdown, then a crawl
//   A7  a chamber with TWO ways down, 9 ft apart
//    |\
//    | \___ D1 - D2 ... the BELL HOLE, 43.5 ft, closing back on C3.
//    |                  A loop enclosing almost no plan area: the
//    |                  near-degenerate case for least squares.
//   C1  head of P2
//    |  22 ft at -85.00 and 21.5 ft at -84.50 -- one either side of
//    |  the near-plumb line, deliberately
//   C4  foot of P2 ---- C5 an AVEN, climbed on bolts (+90)
//    |  canyon, 38 degrees, climbable
//   C8  LIP of P3 -- no LRUD at all, hands full
//    |  35 ft to a ledge rebelay (C9, with a ledge traverse spur
//    |  C9a1 off it), then 57 ft of free-fall
//   C10 the floor -------- C11 sump pool, 1361.70 ft, 380.30 ft down
// ---------------------------------------------------------------------

function buildPlumblinePit() {
    var b = newBuilder("PLUMBLINE PIT (TEST)", "ft");

    var d0606 = declinationOn("2026-06-06");
    var d0627 = declinationOn("2026-06-27");
    var d0718 = declinationOn("2026-07-18");

    // Trips 0 and 1 share a DATE and differ only in TEAM -- two parties
    // in the hole the same day, one rigging the entrance drop and one
    // pushing the window. Same fingerprint rule as Pitfall Cave.
    var tEntrance = b.addTrip("ENTRANCE DROP", "2026-06-06",
        "N. SCHONEGG, R. WEBB", d0606);
    var tWindow = b.addTrip("WINDOW ENTRANCE", "2026-06-06",
        "K. AYERS, D. OTT", d0606);
    var tLower = b.addTrip("LOWER SHAFTS", "2026-06-27",
        "N. SCHONEGG, T. HALE", d0627);
    var tBell = b.addTrip("BELL HOLE", "2026-07-18",
        "R. WEBB, J. PARK", d0718);

    // ---- trip 0: the entrance drop ----------------------------------
    b.useTrip(tEntrance);
    b.fix("A1", 0.0, 0.0, GEO.elevationFt);

    // THE FIRST STATION'S WALLS. No shot arrives at A1, so its LRUD
    // lives in startLrud or it lives nowhere -- and at the rim of a
    // sinkhole "nowhere" means the entrance draws with no width at all.
    // UP is open: the sky is up there.
    survey_startLrud(b, { left: 8.0, right: 9.0, up: null, down: 0.0,
        upOpen: true });

    b.leg("A1", "A2", 16.00, 168.0, -22.0,
        { lrud: [6.0, 5.0, 12.0, 0.0], notes: "SINKHOLE FLOOR, LEAF FILL" });
    b.leg("A2", "A3", 12.00, 155.0, -58.0,
        { lrud: [2.0, 2.5, 6.0, 0.0],
          notes: "LIP OF THE ENTRANCE DROP; TWO BOLTS, Y-HANG" });

    // P1, in two legs because the rope is rebelayed at the window. No
    // bearing on either: the compass column in the notes holds a dash.
    b.leg("A3", "A4", 62.00, 0.0, -90.0,
        { azimuthOmitted: true,
          lrud: [3.0, 4.0, null, 0.0], open: [false, false, true, false],
          notes: "P1 UPPER; REBELAY AT THE WINDOW LEDGE" });
    // ...and this one plumbed both ways, foresight and backsight. The
    // backsight on a plumb reads +90 for a -90 foresight; getting the
    // sign of that wrong is the classic vertical blunder, so the
    // fixture carries one that is RIGHT for a checker to agree with.
    b.leg("A4", "A5", 125.00, 0.0, -90.0,
        { azimuthOmitted: true, backInclination: 90.0,
          lrud: [18.0, 22.0, null, 0.0], open: [false, false, true, false],
          notes: "P1 LOWER; FREE-FALL TO THE BELL FLOOR" });

    // The bell chamber flares: every wall shot from the floor sights
    // UP at a wall that is leaning away.
    b.splayRing("A5", { rays: 8, minDist: 16, maxDist: 34,
        incLo: 8, incHi: 46 });
    b.splay("A5", 61.0, 44.0, 78.0, "CEILING OF THE BELL, HIGH AND BLIND");

    b.leg("A5", "A6", 36.00, 244.0, -1.5,
        { lrud: [12.0, 9.0, 30.0, 0.5],
          notes: "BELL CHAMBER, BREAKDOWN FLOOR" });
    b.leg("A6", "A7", 28.00, 251.0, -3.0,
        { lrud: [4.0, 3.0, 5.0, 0.0], notes: "CRAWL TO THE SECOND DROP" });

    // ---- trip 1: the window entrance --------------------------------
    // Surveyed OUT from A4, the rebelay ledge 62 ft down P1, to a
    // second hole in the ground.
    b.useTrip(tWindow);
    b.leg("A4", "B2", 24.00, 310.0, 34.0,
        { lrud: [3.0, 3.0, 4.0, 1.0], notes: "OUT THE WINDOW, UP THE RUBBLE" });
    b.leg("B2", "B1", 30.00, 305.0, 52.0,
        { lrud: [4.0, 5.0, null, 0.0], open: [false, false, true, false],
          notes: "DAYLIGHT; SECOND ENTRANCE" });
    b.leg("B1", "B1DIG", 22.00, 40.0, 3.0,
        { excludeFromPlot: true, excludeFromLength: true,
          lrud: [null, null, null, null],
          notes: "SURFACE TAPE TO A THIRD SINK, NOT ENTERED" });

    // A HANDHELD GPS FIX ON THE SECOND ENTRANCE. Its plan agrees with
    // the survey to about a foot; its ELEVATION is out by 6.5 ft,
    // which is what a consumer GPS does and is the shape of control
    // misclosure a deep cave actually gets. A tie, not a loop.
    var walkedB1 = b.pos["B1"];
    b.fix("B1", round(walkedB1.x + 0.9, 2), round(walkedB1.y + 0.8, 2),
        round(walkedB1.z + 6.5, 2));

    // ---- trip 2: the lower shafts -----------------------------------
    b.useTrip(tLower);
    b.leg("A7", "C1", 14.00, 255.0, -6.0,
        { lrud: [4.0, 4.0, 6.0, 0.0], notes: "HEAD OF P2" });
    // The near-plumb line, straddled on purpose. -85.00 is a pitch by
    // CsTraverse.PLUMB_DEG and warns; -84.50 is steep passage and does
    // not. The two legs are otherwise identical.
    b.leg("C1", "C2", 22.00, 262.0, -85.00,
        { lrud: [2.0, 2.0, null, 0.0], open: [false, false, true, false],
          notes: "P2 UPPER; AT THE NEAR-PLUMB LINE" });
    b.leg("C2", "C3", 21.50, 262.0, -84.50,
        { lrud: [2.5, 2.0, null, 0.0], open: [false, false, true, false],
          notes: "P2 LOWER; JUST UNDER IT" });
    b.leg("C3", "C4", 26.00, 150.0, -2.0,
        { lrud: [7.0, 6.0, 20.0, 0.0], notes: "FOOT OF P2, RUBBLE FLOOR" });
    // An AVEN: a plumb going UP, bolt-climbed to a dead end. Sign is
    // the only thing separating it from a pitch, and a good deal of
    // code has only ever seen the negative one.
    b.leg("C4", "C5", 20.00, 0.0, 90.0,
        { azimuthOmitted: true,
          lrud: [3.0, 3.0, null, 0.0], open: [false, false, true, false],
          notes: "BOLT CLIMB UP THE AVEN; BLIND" });

    b.leg("C4", "C6", 34.00, 128.0, -38.0,
        { lrud: [5.0, 4.0, 12.0, 0.0], notes: "CANYON, CLIMBABLE" });
    b.leg("C6", "C7", 24.00, 133.0, -36.0,
        { lrud: [4.0, 4.0, 10.0, 0.0] });
    // NO LRUD AT ALL at the lip of the last pitch -- hands full, and
    // this is exactly the station a map most wants a width for.
    b.leg("C7", "C8", 12.00, 140.0, -5.0,
        { notes: "LIP OF P3; HANDS FULL, NO LRUD TAKEN" });
    // Sounding the drop: a tape dropped down the pitch from the lip.
    // A SPLAY WITH NO BEARING AND NOTHING BUT DEPTH.
    b.splay("C8", 91.0, 0.0, -90.0, "SOUNDED THE DROP FROM THE LIP");

    b.leg("C8", "C9", 35.00, 0.0, -90.0,
        { azimuthOmitted: true,
          lrud: [4.0, 6.0, null, 0.0], open: [false, false, true, false],
          notes: "P3 UPPER; REBELAY ON THE LEDGE" });
    // A SPUR OFF A PLUMB RUN. C9a1 ties in at C9 by its name, and its
    // parent run's own legs are vertical -- the profile groups runs by
    // station name and orders them by the shot graph, and this is the
    // case where the two could disagree.
    b.leg("C9", "C9a1", 11.00, 205.0, -2.0,
        { lrud: [2.0, 3.0, 8.0, 0.0],
          notes: "LEDGE TRAVERSE OFF THE REBELAY" });
    b.leg("C9", "C10", 57.00, 0.0, -90.0,
        { azimuthOmitted: true,
          lrud: [14.0, 16.0, null, 0.0], open: [false, false, true, false],
          notes: "P3 LOWER; FREE-FALL TO THE FLOOR" });
    b.splayRing("C10", { rays: 8, minDist: 11, maxDist: 24,
        incLo: 4, incHi: 38 });
    b.leg("C10", "C11", 18.00, 205.0, -3.0,
        { lrud: [8.0, 7.0, 22.0, 0.0], notes: "SUMP POOL; BOTTOM OF THE CAVE" });

    // ---- trip 3: the Bell Hole --------------------------------------
    // A second shaft 9 ft from the head of P2, dropping to the same
    // floor. The loop it makes with P2 encloses almost no plan area:
    // about 15 ft across, 44 ft tall. That is the near-degenerate
    // geometry a least-squares adjustment has to survive, and there is
    // no way to build one out of horizontal passage.
    b.useTrip(tBell);
    b.leg("A7", "D1", 9.00, 350.0, -1.0,
        { lrud: [3.0, 4.0, 6.0, 0.0],
          notes: "STEP ACROSS TO THE BELL HOLE" });
    b.leg("D1", "D2", 43.50, 262.0, -86.50,
        { lrud: [2.0, 2.0, null, 0.0], open: [false, false, true, false],
          notes: "BELL HOLE; BEARING TAKEN ON A DISTO" });
    b.closeLeg("D2", "C3", 1.05, 0.0,
        { lrud: [3.0, 3.0, 9.0, 0.0],
          notes: "CLOSES ON THE FOOT OF P2 UPPER" });

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
// The companion file: omissions a WRITER never emits, so they can only
// be hand-written. Every one of them is something a real vertical
// survey's notes contain.
// ---------------------------------------------------------------------

var VERTICAL_SVX = [
"; PLUMBLINE PIT -- vertical dialect traps, hand-written.",
"; None of these come out of any writer in this suite; they are what",
"; a caver's own notes and other people's files look like.",
"*units length feet",
"*data normal from to tape compass clino",
"*fix V1 0 0 1742.00",
"; 1. the dash: no bearing sighted on a plumb. LEGAL, and the leg must",
";    survive with the omission recorded rather than a bearing of 000.",
"V1\tV2\t62.00\t-\t-90",
"; 2. the same thing said with a keyword instead of a number.",
"V2\tV3\t40.00\t-\tDOWN",
"V3\tV4\t18.00\t-\t-V",
"; 3. an AVEN said the same way.",
"V4\tV5\t22.00\t-\tUP",
"; 4. a plumb with a backsight: the backsight of -90 is +90, and the",
";    sign of that is the classic vertical blunder.",
"*data normal from to tape compass clino backcompass backclino",
"V5\tV6\t35.00\t-\t-90\t-\t90",
"*data normal from to tape compass clino",
"; 5. THE REFUSAL. A bearing may not be omitted on a leg that is not",
";    plumb -- at -86.5 a 43 ft tape still swings 2.7 ft across the",
";    map, and there is no honest direction to swing it in. Survex",
";    refuses this too. What must NOT happen is the old behaviour:",
";    the leg silently vanishing and everything past it going",
";    unconnected with nothing said.",
"V6\tV7\t43.50\t-\t-86.5",
"; 6. ...so V7 onward is deliberately orphaned, and the reader has to",
";    say so rather than leaving a cave that just stops.",
"V7\tV8\t20.00\t145\t-4",
""
].join("\n");

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

function summarize(label, survey) {
    var resolved = CsNetwork.resolve(survey, {});
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
        "   shots " + survey.shots.length + " (splays " + splays + ")" +
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
            "   depth " + stats.depth.toFixed(1) +
            "   (" + stats.lowest + " at " +
            resolved.stations[stats.lowest].z.toFixed(2) + ")");
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
            ti.error.toFixed(2) + " off (h " + ti.horizontal.toFixed(2) +
            ", v " + ti.vertical.toFixed(2) + ")");
    }
    var keys = [];
    for (var c in codes) {
        if (codes.hasOwnProperty(c)) {
            keys.push(c);
        }
    }
    keys.sort();
    for (i = 0; i < keys.length; i++) {
        say("   finding " + keys[i] + " x" + codes[keys[i]]);
    }
    return { resolved: resolved, findings: findings, stats: stats,
             codes: codes, survey: survey };
}

/** Plan-view bounding box of the resolved stations. */
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

var main = buildPlumblinePit();

var OUT = repoRoot + "/testdata/";
var GEO_SVX_HEADER =
    "; GEOREFERENCE (for CaveCAD's Aerial Basemap / map picker):\n" +
    "; GEO " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "   ; WGS84 lat lon, Cumberland Plateau\n" +
    "; entrance elevation " + GEO.elevationFt.toFixed(2) + " ft\n" +
    "; synthetic location -- not a real entrance\n";
var GEO_CSV_HEADER =
    "# geo: " + GEO.station + " " + GEO.lat.toFixed(4) + " " +
        GEO.lon.toFixed(4) + "\n" +
    "# geonote: WGS84, Cumberland Plateau, synthetic -- not a real " +
        "entrance\n";

var svxText = GEO_SVX_HEADER + CsFormatSurvex.write(main.survey);
var datText = CsFormatCompass.write(main.survey);
var csvText = GEO_CSV_HEADER + CsFormatCsv.write(main.survey);

writeTextFile(OUT + "PlumblinePit.svx", svxText);
writeTextFile(OUT + "PlumblinePit.dat", datText);
writeTextFile(OUT + "PlumblinePit.csv", csvText);
writeTextFile(OUT + "PlumblinePit_Vertical.svx", VERTICAL_SVX);

say("PLUMBLINE PIT fixtures written to testdata/");

var built = summarize("as built (model, before any file round trip)",
    main.survey);
var extent = planExtent(built.resolved);
say("   plan extent " + extent.width.toFixed(1) + " x " +
    extent.height.toFixed(1) + " " + main.survey.distanceUnit +
    "   depth/extent " +
    (built.stats.depth / Math.max(extent.width, extent.height)).toFixed(2));

// ---- what makes this fixture a PIT ------------------------------------

expect(main.survey.fixed["A1"].z === GEO.elevationFt &&
    GEO.elevationFt !== 0.0,
    "entrance datum is " + GEO.elevationFt + " ft, not zero");
expect(built.stats.depth > 350,
    "the cave is over 350 ft deep (" + built.stats.depth.toFixed(1) + ")");
expect(built.stats.depth > Math.max(extent.width, extent.height) * 2.0,
    "and DEEPER THAN IT IS WIDE, by more than 2x -- the aspect ratio a " +
    "plan view cannot show and an extended elevation collapses on");
expect(built.stats.planLength < built.stats.surveyedLength * 0.72,
    "under 72% of the tape is horizontal (" +
    (100 * built.stats.planLength / built.stats.surveyedLength).toFixed(0) +
    "%) -- in Pitfall Cave it is 95%");

// ---- plumb legs, and what must not happen to them ---------------------

var plumbLegs = 0, omitted = 0, avens = 0;
for (var si = 0; si < main.survey.shots.length; si++) {
    var sh = main.survey.shots[si];
    if (sh.splay) { continue; }
    if (CsTraverse.isPlumb(sh)) { plumbLegs++; }
    if (sh.azimuthOmitted) { omitted++; }
    if (CsTraverse.isPlumb(sh) && CsTraverse.effectiveInclination(sh) > 0) {
        avens++;
    }
}
expect(plumbLegs >= 7, "seven or more legs are pitches (" + plumbLegs + ")");
expect(omitted >= 5, "five or more carry NO SIGHTED BEARING (" + omitted + ")");
expect(avens >= 1, "at least one of them goes UP (an aven)");

// A pitch contributes no way out in plan. Before CsLrud.COINCIDENT_PLAN
// every one of them contributed a bearing of due north at both ends.
var axes = CsLrud.stationAxes(built.resolved);
expect(axes["A4"] !== undefined && axes["A4"].dirs.length <= 2,
    "the rebelay ledge A4 -- pitch above, pitch below, window passage " +
    "out -- has at most 2 ways out, not 4");
expect(!CsLrud.isJunction(axes, "A5"),
    "the foot of P1 is not a junction: the rope it hangs on is not a " +
    "passage");
expect(axes["C10"] !== undefined && axes["C10"].dirs.length === 1,
    "the floor of P3 has exactly ONE way out (the sump passage)");

// The pit-foot walls come off the onward passage, not off north.
var lrudA5 = CsModel.lrudForStation(main.survey, "A5");
expect(lrudA5 !== null && lrudA5.azimuth === null,
    "LRUD at the foot of P1 carries no bearing -- the compass column " +
    "on a plumb is a formality, not a sight");
var wallsA5 = CsLrud.stationWallPoints(built.resolved.stations["A5"],
    CsLrud.passageAzimuthAt(axes, "A5", null), lrudA5, null, "L");
expect(wallsA5.length === 1,
    "...and the wall point is still drawn, off the passage direction");

// Two stations at the same plan position, 125 ft apart vertically.
var pA4 = built.resolved.stations["A4"], pA5 = built.resolved.stations["A5"];
var coincident = Math.sqrt((pA4.x - pA5.x) * (pA4.x - pA5.x) +
    (pA4.y - pA5.y) * (pA4.y - pA5.y));
expect(coincident < 0.001 && Math.abs(pA4.z - pA5.z) > 120,
    "A4 sits directly above A5 -- same point in plan, 125 ft apart in " +
    "elevation (" + coincident.toFixed(6) + " ft / " +
    Math.abs(pA4.z - pA5.z).toFixed(1) + " ft)");

// ---- the near-plumb line, straddled -----------------------------------

function flagsLeg(findings, survey, code, from, to) {
    for (var i = 0; i < findings.length; i++) {
        if (findings[i].code !== code) { continue; }
        var s = survey.shots[findings[i].shotIndex];
        if (s && s.from === from && s.to === to) { return true; }
    }
    return false;
}
expect(flagsLeg(built.findings, main.survey, "near-plumb", "C1", "C2"),
    "C1-C2 at -85.00 IS near-plumb (the boundary angle is inside)");
expect(!flagsLeg(built.findings, main.survey, "near-plumb", "C2", "C3"),
    "C2-C3 at -84.50 is not -- half a degree either side of the line, " +
    "and the line is CsTraverse.PLUMB_DEG for every rule that asks");

// ---- the control tie, and the loop that is nearly flat ---------------

expect(built.resolved.ties.length === 1,
    "the GPS fix on the second entrance is a control TIE, not a loop");
if (built.resolved.ties.length === 1) {
    var tie = built.resolved.ties[0];
    expect(tie.vertical > tie.horizontal * 3.0,
        "and its misclosure is nearly all VERTICAL (v " +
        tie.vertical.toFixed(2) + " vs h " + tie.horizontal.toFixed(2) +
        ") -- what a handheld GPS actually does to a deep cave");
}

expect(built.resolved.loops.length === 1,
    "one loop: the Bell Hole against P2");
if (built.resolved.loops.length === 1) {
    var loop = built.resolved.loops[0];
    expect(loop.percent < CsValidate.CLOSURE_WARN_PERCENT,
        "it closes UNDER the warning (" + loop.percent.toFixed(2) + "%)");
}

// The adjustment has to survive a loop with almost no plan area, and
// must not lean the ropes over while it does.
var adjusted = CsAdjust.resolveAndAdjust(main.survey, {},
    { enabled: true, sigmaTape: 0.1, sigmaAngle: 1.5 });
expect(adjusted !== null && adjusted !== undefined &&
    adjusted.loops.length === built.resolved.loops.length,
    "least-squares adjustment runs on a loop enclosing ~150 sq ft of " +
    "plan and 44 ft of air");
if (adjusted !== null && adjusted !== undefined) {
    // HOW FAR THE ADJUSTMENT LEANED A ROPE. Measured as a CHANGE from
    // the as-surveyed attitude, not as an absolute angle off vertical
    // -- a leg recorded at -85 is already 5 degrees off vertical
    // because the caver wrote -85, and calling that a lean would
    // report the survey's own numbers as an error of the adjustment.
    var worstLean = 0.0, worstLeg = "";
    for (var ai = 0; ai < adjusted.legs.length; ai++) {
        var lg = adjusted.legs[ai];
        if (lg.kind === "closure") { continue; }
        if (!CsTraverse.isPlumb(lg.shot)) { continue; }
        var a = adjusted.stations[lg.from], c = adjusted.stations[lg.to];
        var a0 = built.resolved.stations[lg.from];
        var c0 = built.resolved.stations[lg.to];
        if (!a || !c || !a0 || !c0) { continue; }
        var leanOf = function(p, q) {
            var dp = Math.sqrt((q.x - p.x) * (q.x - p.x) +
                (q.y - p.y) * (q.y - p.y));
            var dv = Math.abs(q.z - p.z);
            return (dv === 0) ? 90.0 : Math.atan2(dp, dv) * 180.0 / Math.PI;
        };
        var moved = Math.abs(leanOf(a, c) - leanOf(a0, c0));
        if (moved > worstLean) {
            worstLean = moved;
            worstLeg = lg.from + "-" + lg.to;
        }
    }
    say("   worst pitch lean INTRODUCED by the adjustment: " +
        worstLean.toFixed(3) + " deg (" + worstLeg + ")");
    // PINNED, NOT ENDORSED. Nothing in CsAdjust knows that a rope
    // hangs straight: a leg's variance is one scalar (see its VERTICAL
    // SIMPLIFICATION note), so a pitch is modelled as horizontally
    // uncertain by distance * sigmaAngle exactly like a level passage,
    // and misclosure flows into it accordingly. On this fixture the
    // effect is small. The number is recorded so that a change in the
    // adjustment shows up as a change in a rope that used to hang
    // straight -- which is a thing a reader of a pit map can see.
    expect(worstLean < 1.0,
        "and the adjustment moves no pitch more than a degree off the " +
        "attitude it was surveyed at (pinned: nothing in CsAdjust knows " +
        "a rope hangs straight)");

    // A DECLARED plumb -- one the caver recorded with no bearing at
    // all -- should be the STIFFEST leg in a loop, not the softest:
    // there was no compass involved, so there is no compass error to
    // distribute into it. CsAdjust.legVariance now says so.
    var vPlumb = CsAdjust.legVariance(
        { distance: 100, azimuthOmitted: true, inclination: -90 }, 0.1, 1.5);
    var vNormal = CsAdjust.legVariance(
        { distance: 100, azimuthOmitted: false, inclination: -3 }, 0.1, 1.5);
    expect(vPlumb < vNormal / 5.0,
        "a plumbed leg carries far less variance than a compass leg of " +
        "the same length (" + vPlumb.toFixed(4) + " vs " +
        vNormal.toFixed(4) + ") -- no compass was used, so there is no " +
        "compass error to hand it");
}

// ---- round trips ------------------------------------------------------

var reSvx = summarize("Survex round trip (PlumblinePit.svx)",
    CsFormatSurvex.parse(svxText));
expect(reSvx.resolved.loops.length === built.resolved.loops.length,
    "Survex round trip keeps the loop");
expect(Math.abs(reSvx.stats.depth - built.stats.depth) < 0.05,
    "Survex round trip keeps the depth to 0.05 ft");
var reSvxSurvey = CsFormatSurvex.parse(svxText);
var reOmitted = 0;
for (si = 0; si < reSvxSurvey.shots.length; si++) {
    if (reSvxSurvey.shots[si].azimuthOmitted) { reOmitted++; }
}
expect(reOmitted === omitted,
    "and every omitted bearing comes back an OMISSION (" + reOmitted +
    "), not a bearing of north -- the writer puts the dash back");
expect(svxText.indexOf("\t-\t-90.00") >= 0,
    "the .svx really does carry a dash in the compass column");

var reDat = summarize("Compass round trip (PlumblinePit.dat)",
    CsFormatCompass.parse(datText));
expect(Math.abs(reDat.stats.depth - built.stats.depth) < 0.05,
    "Compass round trip keeps the depth");

var reCsvSurvey = CsFormatCsv.parse(csvText);
var reCsv = summarize("CSV round trip (PlumblinePit.csv)", reCsvSurvey);
expect(Math.abs(reCsv.stats.depth - built.stats.depth) < 0.05,
    "CSV round trip keeps the depth");
var csvOmitted = 0;
for (si = 0; si < reCsvSurvey.shots.length; si++) {
    if (reCsvSurvey.shots[si].azimuthOmitted) { csvOmitted++; }
}
expect(csvOmitted === omitted,
    "CSV carries the omitted bearings too (" + csvOmitted + ")");

// ---- the hand-written dialect file ------------------------------------

var vert = CsFormatSurvex.parse(VERTICAL_SVX);
var vertFindings = CsModel.parseFindings(vert);
var vertResolved = CsNetwork.resolve(vert, {});
var vertCodes = codesOf(CsValidate.check(vert, vertResolved));
say("");
say("== vertical dialects (PlumblinePit_Vertical.svx)");
say("   shots " + vert.shots.length + "   parse findings " +
    vertFindings.length);
expect(vert.shots.length === 6,
    "six of the seven legs read (V1-V6); the seventh is refused");
var allOmitted = true;
for (si = 0; si < 5; si++) {
    if (!vert.shots[si].azimuthOmitted) { allOmitted = false; }
}
expect(allOmitted,
    "a dash, DOWN, -V and UP all record an ABSENT bearing, not zero");
expect(Math.abs(vert.shots[1].inclination + 90) < 0.01,
    "the DOWN keyword is -90, not a flattened 0");
expect(Math.abs(vert.shots[3].inclination - 90) < 0.01,
    "and UP is +90");
expect(vert.shots[4].backInclination === 90,
    "a plumb's backsight of +90 survives beside its -90 foresight");
expect(Math.abs(CsTraverse.effectiveInclination(vert.shots[4]) + 90) < 0.01,
    "...and the two average to -90, not to 0");
var refused = false;
for (si = 0; si < vertFindings.length; si++) {
    if (vertFindings[si].code === "bearing-omitted-not-plumb") {
        refused = true;
    }
}
expect(refused,
    "the bearingless -86.5 leg is refused AND REPORTED -- it used to " +
    "vanish, taking the rest of the cave with it and saying nothing");
expect(vertCodes["unconnected"] >= 1,
    "so V7 onward is unconnected, which the validator also says");

// ---- the extended elevation, which is where a pit cave hurts ----------

var profile = CsProfile.build(main.survey, built.resolved, {});
say("");
say("== extended elevation");
say("   bands " + (profile === null ? "(none)" : profile.bands.length));
if (profile !== null && profile !== undefined) {
    var narrow = 0;
    for (var bi = 0; bi < profile.bands.length; bi++) {
        var band = profile.bands[bi];
        var w = 0.0;
        for (var pi = 0; pi < band.stations.length; pi++) {
            if (band.stations[pi].x > w) { w = band.stations[pi].x; }
        }
        var span = CsProfile.bandSpan(band);
        say("   band " + band.key + "  stations " + band.stations.length +
            "  width " + w.toFixed(2) +
            "  height " + (span === null ? "?" :
                (span.hi - span.lo).toFixed(2)) +
            " " + main.survey.distanceUnit);
        if (w < 5.0 && band.stations.length > 1) { narrow++; }
    }
    // PINNED OBSERVATION, and the reason B4 exists. An extended
    // elevation's X axis advances by PLAN distance, so a run that is
    // all pitch advances it by nothing: every station in the band
    // lands on one vertical line, labels stack on each other, and the
    // band's bounding box has no width for a frame or a drape to use.
    // This is CORRECT for the pitch itself -- a rope IS a vertical
    // line -- and wrong for everything that has to lay the band out.
    say("   bands narrower than 5 ft with more than one station: " +
        narrow);
}

// ---------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------

var MANIFEST = [
"# PLUMBLINE PIT -- test fixture inventory",
"",
"Generated by `tools/make_pit_cave.js` (`node tools/make_pit_cave.js`).",
"Regenerating is deterministic: the splay rings run off a seeded LCG, so",
"the numbers below stay true. Every coordinate is synthetic -- no real",
"entrance, and nothing here should ever be given a real lat/lon.",
"",
"## Why there are two fixtures",
"",
"| | Pitfall Cave | Plumbline Pit |",
"|---|---|---|",
"| Shape | 2400 ft long, 143 ft deep | " +
    main.survey.shots.length + " shots, " +
    built.stats.surveyedLength.toFixed(0) + " ft long, " +
    built.stats.depth.toFixed(0) + " ft deep |",
"| Plan extent | most of the cave | " + extent.width.toFixed(0) + " x " +
    extent.height.toFixed(0) + " ft |",
"| Horizontal share of the tape | 95% | " +
    (100 * built.stats.planLength / built.stats.surveyedLength).toFixed(0) +
    "% |",
"| Carries | parser, validator and network traps | the traps only a " +
    "PITCH can spring |",
"",
"Every geometry rule in this suite that asks *which way does the passage",
"run here* answers from a bearing. On a pitch there is no bearing: the",
"needle is noise, the caver is on a rope, and the compass column holds a",
"dash or a formality. Seven thousand assertions over a horizontal cave",
"never asked, so a family of fabricated-direction bugs lived here",
"undisturbed -- a plumb leg's plan projection is `cos(90 degrees)`, which",
"is 6.1e-17 rather than 0, and that dust was being divided by itself and",
"reported as a confident bearing of due north.",
"",
"## Where it is",
"",
"| | |",
"|---|---|",
"| Entrance station | `A1` (the project convention: A1 is the georeference anchor) |",
"| Latitude / longitude | **34.9612, -85.7433** (WGS84) |",
"| Where that is | Cumberland Plateau, northwest Georgia -- pit country |",
"| Entrance elevation | 1742.00 ft, and deliberately not zero |",
"| Floor of the last pitch | " +
    built.resolved.stations["C11"].z.toFixed(2) + " ft |",
"| Declination | the REAL IGRF-14 value at that point on each trip's date |",
"",
"The location is SYNTHETIC: an arbitrary rural point picked so aerial",
"basemap work has real imagery and real karst terrain under it. It is not",
"a cave and corresponds to no known entrance. That matters more here than",
"it does for Pitfall Cave -- a deep pit's coordinates are exactly the",
"thing this project never publishes.",
"",
"## Shape of the cave",
"",
"| Trip | Date | Team | Declination | Stations |",
"|---|---|---|---|---|",
"| ENTRANCE DROP | 2026-06-06 | N. SCHONEGG, R. WEBB | " +
    main.survey.trips[0].declination + " | A1-A7 |",
"| WINDOW ENTRANCE | 2026-06-06 | K. AYERS, D. OTT | " +
    main.survey.trips[1].declination + " | B1, B2, B1DIG |",
"| LOWER SHAFTS | 2026-06-27 | N. SCHONEGG, T. HALE | " +
    main.survey.trips[2].declination + " | C1-C11, C9a1 |",
"| BELL HOLE | 2026-07-18 | R. WEBB, J. PARK | " +
    main.survey.trips[3].declination + " | D1, D2 |",
"",
"Trips 1 and 2 share a DATE and differ only in team: two parties in the",
"hole the same day, one rigging the entrance drop and one pushing the",
"window. Same fingerprint rule as Pitfall Cave.",
"",
"```",
"  A1  sinkhole rim, fixed on a real 1742.00 ft datum",
"   |  16 ft to the floor, 12 ft down a handline to the lip",
"  A3  LIP -- two bolts, a Y-hang",
"   |  P1: 62 ft plumb to a rebelay at a window, then 125 ft of",
"   |  free-fall. 187 ft in two legs, both with NO BEARING SIGHTED.",
"  A4  the window ledge ---- B2 - B1  second entrance (daylight); a GPS",
"   |                                 fix on B1 makes a control tie whose",
"  A5  bell chamber floor            misclosure is nearly all VERTICAL",
"   |  breakdown, then a crawl",
"  A7  a chamber with TWO ways down, 9 ft apart",
"   |\\",
"   | \\__ D1 - D2  the BELL HOLE, 43.5 ft, closing back on C3. A loop",
"   |              enclosing almost no plan area: the near-degenerate",
"   |              case for least squares.",
"  C1  head of P2",
"   |  22 ft at -85.00 and 21.5 ft at -84.50 -- one either side of the",
"   |  near-plumb line, deliberately",
"  C4  foot of P2 ---- C5  an AVEN, bolt-climbed (+90), blind",
"   |  canyon, 38 degrees, climbable",
"  C8  LIP of P3 -- no LRUD at all, hands full",
"   |  35 ft to a ledge rebelay (C9, with a ledge traverse spur C9a1",
"   |  off it), then 57 ft of free-fall",
"  C10 the floor ---- C11  sump pool, the bottom of the cave",
"```",
"",
"## Pitfall inventory",
"",
"Numbered V1.. so they never collide with Pitfall Cave's 1-46.",
"",
"| # | Pitfall | Where | Expected |",
"|---|---|---|---|",
"| V1 | absolute elevation datum, 1742 ft | `*fix A1` | any z defaulting to 0 rebases a cave whose floor is at " +
    built.resolved.stations["C11"].z.toFixed(0) + " ft |",
"| V2 | depth greater than plan extent | " +
    built.stats.depth.toFixed(0) + " ft deep, " +
    Math.max(extent.width, extent.height).toFixed(0) +
    " ft across | the aspect ratio a plan view cannot show |",
"| V3 | no bearing sighted on a pitch | A3-A4, A4-A5, C4-C5, C8-C9, C9-C10 | `Shot.azimuthOmitted`; written back out as a dash, never as 000 |",
"| V4 | a plumb leg's plan projection | every pitch | `cos(90)` is 6.1e-17, not 0: it must NOT become a bearing (`CsLrud.COINCIDENT_PLAN`) |",
"| V5 | a pit foot is not a junction | A5, C10 | the rope is not a way out; wall runs do not break there |",
"| V6 | LRUD with no bearing to swing on | A5, C10 | the tick comes off the ONWARD passage, never off north |",
"| V7 | UP written \"P\" at every pit foot | A4, A5, C2, C3, C5, C9, C10, D2 | the ceiling IS the pitch; open, not unmeasured |",
"| V8 | the near-plumb line, straddled | C1-C2 at -85.00, C2-C3 at -84.50 | one warns, one does not, and both agree with the geometry |",
"| V9 | an AVEN (a plumb going UP) | C4-C5, +90 | sign is all that separates it from a pitch |",
"| V10 | a plumb with a backsight | A4-A5, fore -90 back +90 | they average to -90, not to 0 |",
"| V11 | two stations on one plan point | A4 above A5, 125 ft apart | the plan view's blind spot, stated |",
"| V12 | a loop enclosing no plan area | Bell Hole against P2: ~15 ft across, 44 ft tall | least squares survives it; the ropes stay vertical |",
"| V13 | a control tie that is nearly all vertical | GPS fix on B1, 6.5 ft high, 1.2 ft out in plan | a TIE, not a loop -- and what a handheld GPS really does |",
"| V14 | a pitch lip with NO LRUD | C7-C8 | hands full; the station a map most wants a width for has none |",
"| V15 | sounding the drop | splay from C8, 91 ft at -90 | a splay with no bearing and nothing but depth |",
"| V16 | first station LRUD at a sinkhole rim | `startLrud` on A1, UP open | no shot arrives at A1; without this the entrance has no width |",
"| V17 | a spur off a PLUMB run | C9a1, a ledge traverse off the rebelay | run grouping is by name, order is by the shot graph |",
"| V18 | a run that is entirely pitch | C8-C9-C10 | the extended elevation's X axis advances by PLAN distance, so the band has no width |",
"| V19 | steep splays in a bell chamber | ring at A5, +8 to +46 degrees | the plan has no steepness filter and the profile does |",
"| V20 | a surface leg from the second entrance | B1-B1DIG | excluded from length AND plot |",
"| V21 | a bearing omitted where it may NOT be | `PlumblinePit_Vertical.svx`, V6-V7 at -86.5 | REFUSED and reported -- it used to vanish silently and orphan the cave |",
"| V22 | plumb keywords | same file: DOWN, UP, -V | not flattened to 0, and each records an absent bearing |",
"",
"## Known format losses (expected, not bugs)",
"",
"- Survex has no way to say *looked at, found open*: a passage record",
"  carries a number or a dash, and a dash means NOT MEASURED. So the",
"  \"P\" written for UP at every pit foot (V7) does not survive a `.svx`",
"  round trip -- it comes back as an absence, which is a different",
"  claim. `PlumblinePit.csv` does carry it, and the audit checks it",
"  there.",
"- Compass keeps fixed stations in the `.mak` project file, so",
"  `PlumblinePit.dat` loses the GPS fix on B1: the control tie (V13)",
"  comes back as an ordinary traverse with one anchor.",
"- The CSV writer emits ONE header block, so the four trips collapse to",
"  trip 0's metadata. Every shot survives, including the omitted",
"  bearings, which ride an EMPTY azimuth cell.",
"- Walls (`.srv`) is not written for this fixture at all.",
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
writeTextFile(OUT + "PlumblinePit_MANIFEST.md",
    MANIFEST.join("\n") + measured.join("\n"));

say("");
if (failures.length === 0) {
    say("### PIT CAVE OK -- every vertical pitfall still carried");
} else {
    say("### PIT CAVE FAIL -- " + failures.length + " check(s) failed:");
    for (var fi = 0; fi < failures.length; fi++) {
        say("   " + failures[fi]);
    }
}

if (IS_NODE) {
    process.exit(failures.length === 0 ? 0 : 1);
} else if (typeof QCoreApplication !== "undefined") {
    QCoreApplication.quit();
}
