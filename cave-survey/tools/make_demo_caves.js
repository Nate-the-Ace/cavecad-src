// make_demo_caves.js -- a shelf full of caves, for screenshots and for
// exercising the tools without inventing survey data by hand.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tools/make_demo_caves.js "$PWD" [targetFolder]
//
// Writes six caves into ~/Documents/Cave/demo (or the folder given),
// each in a DIFFERENT state, so the cave shelf shows every case it can
// show: many trips and few, long and short, open ends and none, a cave
// with no drawing yet, and a cave whose only drawing is a DWG.
//
// EVERY CAVE HERE IS INVENTED. The names are not real caves, the
// coordinates are a plausible but arbitrary point in the southern
// Indiana karst, and nothing in this file came from anybody's survey.
// That is the point: real cave locations do not belong in test data
// (see the suite's own privacy rule), and a generated cave can be
// regenerated when the tools change.
//
// The surveys are drawn through CsDraw.survey, so the drawings carry
// real tag schema v3 -- trip anchors, per-leg shot data, LRUD -- and
// the shelf reads them back the same way it reads a cave somebody
// actually surveyed. Nothing is faked at the tag level.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
var targetRoot = QDir.homePath() + "/Documents/Cave/demo";
// second-to-last argument is an explicit target when one was given
if (args.length >= 2) {
    var maybe = String(args[args.length - 1]);
    var prev = String(args[args.length - 2]);
    if (prev.indexOf("make_demo_caves.js") === -1 && maybe.indexOf("/") === 0 &&
            prev.indexOf("/") === 0) {
        repoRoot = prev;
        targetRoot = maybe;
    }
}

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    (0, eval)(src);
}

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } }
        catch (e) { }
        return false;
    };
}
if (typeof isFunction === "undefined") {
    isFunction = function(v) { return typeof v === "function"; };
}
// A bare -autostart engine has no library.js, so the helpers the Core
// expects are not there. Same shims the test harnesses carry.
if (typeof destr === "undefined") {
    destr = function(o) {
        try { if (o !== null && o !== undefined && isFunction(o.destroy)) { o.destroy(); } }
        catch (e) { }
    };
}
if (typeof qsTr === "undefined") {
    qsTr = function(t) { return t; };
}
if (typeof writeTextFile === "undefined") {
    writeTextFile = function(path, text) {
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) { return false; }
        var ts = new QTextStream(f);
        ts.writeString(text);
        f.close();
        return true;
    };
}

var CORE = ["CsUuid", "CsUnits", "CsCave", "CsShelf", "CsPackage",
    "CsGeoProject", "CsAngles", "CsIgrfCoeffs", "CsGeomag", "CsModel",
    "CsFrontier", "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud",
    "CsProfile", "CsProfileDraw", "CsCallout", "CsElevation", "CsValidate",
    "CsStats", "CsGrade", "CsLayers", "CsLayerVariants", "CsBackup",
    "CsTrace", "CsStore", "CsTags", "CsBind", "CsDraw", "CsSheet",
    "CsSymbols", "CsRevise"];
for (var ci = 0; ci < CORE.length; ci++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[ci] + ".js");
}

// ---------------------------------------------------------------------
// A repeatable walk. Deterministic on purpose: regenerating the demo
// caves must not quietly change every number in yesterday's screenshot.
// ---------------------------------------------------------------------

var seed = 20260824;
function rnd() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
}
function between(lo, hi) { return lo + rnd() * (hi - lo); }
function round1(v) { return Math.round(v * 10) / 10; }

function shot(from, to, dist, az, inc, trip, lrud) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = round1(dist);
    s.azimuth = round1(az);
    s.inclination = round1(inc);
    s.trip = trip;
    if (lrud !== false) {
        s.left = round1(between(1, 9));
        s.right = round1(between(1, 9));
        s.up = round1(between(2, 25));
        s.down = round1(between(0, 4));
    }
    return s;
}

/**
 * Walks a passage: count shots from `start`, named <series>N, wandering
 * around a heading. Returns the last station's name.
 */
function walk(survey, series, start, first, count, heading, trip, opts) {
    var options = opts || {};
    var prev = start;
    var az = heading;
    for (var i = 0; i < count; i++) {
        var name = series + (first + i);
        az += between(-28, 28);
        var inc = between(options.down === true ? -32 : -9,
            options.down === true ? -4 : 9);
        var last = (i === count - 1);
        survey.shots.push(shot(prev, name, between(18, 78), az, inc, trip,
            (last && options.noLrudAtEnd === true) ? false : true));
        prev = name;
    }
    return prev;
}

/** Ties a passage back into a station that already exists: no open end. */
function tieBack(survey, from, to, trip) {
    survey.shots.push(shot(from, to, between(12, 40), between(0, 359),
        between(-4, 4), trip));
}

// The invented location every demo cave shares: a plausible but
// arbitrary point in the southern Indiana karst. Not a cave.
var GEO = { lat: 38.42137, lon: -86.51884 };

/** IGRF declination at GEO for a "YYYY-MM-DD" date, or 0. */
function igrfAt(dateText) {
    var parts = CsShelf.dateParts(dateText);
    if (parts === null) { return 0; }
    var value = CsShelf.declinationValue(
        CsGeomag.declination(GEO.lat, GEO.lon, parts, 0.0));
    return value === null ? 0 : value;
}

function trip(name, date, team, decl, source) {
    var t = CsModel.newTrip();
    t.name = name;
    t.date = date;
    t.team = team;
    t.declination = decl;
    t.declinationSource = source || "user";
    t.distanceUnit = "ft";
    return t;
}

// ---------------------------------------------------------------------
// One cave, built to a spec. Every demo cave is this function with
// different numbers -- so a fix here fixes the whole shelf.
// ---------------------------------------------------------------------

var TEAMS = ["SCHONEGG, WELLER", "WELLER, POOLE", "SCHONEGG, DUVAL",
    "POOLE, HARMON", "DUVAL, WELLER, HARMON", "HARMON, SCHONEGG"];
var TRIP_NAMES = ["Entrance series", "Upper maze", "Sump lead", "Breakdown",
    "Wet crawl", "Grand gallery", "North extension", "Rope drop",
    "Canyon traverse", "Bone room", "Terminal sump"];

/**
 * \param spec {
 *   trips        how many trips to survey
 *   perTrip      shots per trip
 *   openEnds     how many passages are left open (the rest tie back)
 *   noLrudEnd    true: the newest open end has no wall measurements
 *   down         true: a vertical cave (steep inclinations)
 *   startDate    "YYYY-MM-DD" of trip 0; trips march forward from it
 * }
 */
function buildCave(spec) {
    var survey = CsModel.newSurvey();
    survey.distanceUnit = "ft";
    survey.trips = [];

    var series = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L"];
    var ends = [];      // stations a trip stopped at, oldest first
    var anchors = ["A1"];

    for (var t = 0; t < spec.trips; t++) {
        var whenDate = new Date(Date.parse(spec.startDate + "T12:00:00Z") +
            t * 37 * 86400000);
        // Trips are surveyed under the declination that was actually
        // right for the day -- otherwise every trip in every demo cave
        // reads as an error, and a flag that fires on everything says
        // nothing. ONE trip is deliberately wrong, where the spec asks
        // for it, so the drift warning has something true to catch.
        var when = CsPackage.todayText(whenDate);
        var correct = round1(igrfAt(when));
        var recorded = (spec.driftTrip === t) ? round1(correct + 1.8) : correct;
        survey.trips.push(trip(TRIP_NAMES[t % TRIP_NAMES.length],
            when, TEAMS[t % TEAMS.length], recorded,
            (spec.driftTrip === t) ? "user" : "igrf"));

        // Trip 0 starts at the entrance; later trips carry on from an
        // end an earlier trip left, which is what makes the frontier
        // mean something.
        // Most trips carry on from where the last one stopped -- that is
        // what a frontier IS. Every third one branches off the entrance
        // series instead, which leaves the older end open and gives the
        // cave more than one lead, the way a real cave has.
        var from = (t === 0) ? "A1" :
            ((t % 3 === 0) ? "A2" :
                (ends.length > 0 ? ends[ends.length - 1] : anchors[0]));
        if (t === 0) {
            survey.shots.push(shot("A1", "A2", between(12, 30),
                between(0, 359), spec.down === true ? -35 : between(-6, 6),
                0));
            from = "A2";
        }
        var last = walk(survey, series[t % series.length], from,
            (t === 0) ? 3 : 1, spec.perTrip, between(0, 359), t,
            { down: spec.down === true,
              noLrudAtEnd: spec.noLrudEnd === true && t === spec.trips - 1 });
        ends.push(last);
    }

    // Passages beyond the wanted number of open ends get tied back into
    // the cave, which is what a surveyed-out lead looks like. Which
    // stations are still open is asked of CsFrontier rather than
    // tracked by hand -- the same answer the shelf will show -- and
    // re-asked after every tie, because a tie changes the answer.
    var keepOpen = spec.openEnds === undefined ? 1 : spec.openEnds;
    var guard = 0;
    while (guard++ < 40) {
        var open = CsFrontier.openEnds(survey);
        if (open.length <= keepOpen) { break; }
        // oldest first: the newest end is the one worth leaving open
        var oldest = open[open.length - 1];
        tieBack(survey, oldest.station, "A2", oldest.trip);
    }
    return survey;
}

/** Draws a survey into a fresh document and writes it to `path`. */
function writeDrawing(survey, path, geo) {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var di = new RDocumentInterface(doc);
    getDocument = function() { return doc; };
    getDocumentInterface = function() { return di; };

    // The NSS template first, so an opened demo drawing looks like a
    // real sheet and not bare linework.
    var template = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
    if ((new QFileInfo(template)).exists()) {
        var src = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), new RSpatialIndexNavel()));
        try {
            if (src.importFile(template, "", false) ===
                    RDocumentInterface.IoErrorNoError) {
                var paste = new RPasteOperation(src.getDocument());
                paste.setOffset(new RVector(0, 0));
                paste.setCopyAllLayers(true);
                paste.setCopyEmptyBlocks(true);
                di.applyOperation(paste);
            }
        } finally {
            destr(src);
        }
    }

    var resolved = CsNetwork.resolve(survey, {});
    CsDraw.survey(survey, resolved, undefined, undefined, 0);

    // The georeference, on the entrance station, exactly where the
    // suite puts it -- so Package Cave Project has something real to
    // strip when it sanitizes.
    if (geo === true) {
        var stations = CsTags.collectStations(doc);
        for (var s = 0; s < stations.length; s++) {
            if (stations[s].name !== "A1") { continue; }
            CsTags.commit(di, stations[s].entity, {
                GeoLat: "38.42137",
                GeoLon: "-86.51884",
                GeoStation: "A1"
            });
            break;
        }
    }

    var filter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        var label = String(filters[f]);
        if (label.indexOf("dxflib") !== -1 && label.indexOf("*.dxf") !== -1) {
            filter = filters[f];
            break;
        }
    }
    var ok = di.exportFile(path, filter);
    destr(di);
    return ok;
}

// ---------------------------------------------------------------------
// The shelf: one spec per cave. Six rows, each in a different state.
// ---------------------------------------------------------------------

var CAVES = [
    {
        name: "Whippoorwill Cave",
        trips: 6, perTrip: 9, openEnds: 2, noLrudEnd: true, driftTrip: 3,
        startDate: "2026-02-14", geo: true,
        scans: 4, pdfs: 2, photos: 3, aerial: true
    },
    {
        name: "Lantern Cave",
        trips: 11, perTrip: 11, openEnds: 0,
        startDate: "2024-09-07", geo: true,
        scans: 6, pdfs: 1, photos: 1
    },
    {
        name: "Copperhead Pit",
        trips: 2, perTrip: 5, openEnds: 1, down: true,
        startDate: "2026-06-19",
        scans: 2, pdfs: 0
    },
    {
        name: "Bat Roost Sink",
        trips: 1, perTrip: 4, openEnds: 1,
        startDate: "2026-08-02",
        scans: 1, pdfs: 0
    },
    {
        // Registered before it has a drawing: sketches from the trip
        // are in the folder, the survey has not been typed in yet.
        name: "Slaughter Hollow Cave",
        drawing: false, scans: 3, pdfs: 0
    },
    {
        // A cave whose only drawing came from somebody else's CAD.
        name: "Old Quarry Cave",
        drawing: "dwg", scans: 0, pdfs: 1
    }
];

function mkpath(p) { return (new QDir()).mkpath(p); }

function writeBytesFile(path, text) {
    return writeTextFileHere(path, text);
}

function writeTextFileHere(path, text) {
    var f = new QFile(path);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) { return false; }
    var ts = new QTextStream(f);
    ts.writeString(text);
    f.close();
    return true;
}

var made = [];
var problems = [];

mkpath(targetRoot);

for (var c = 0; c < CAVES.length; c++) {
    var spec = CAVES[c];
    var folder = targetRoot + "/" + spec.name.toUpperCase();
    mkpath(folder);
    mkpath(folder + "/scans");
    mkpath(folder + "/PDF");
    mkpath(folder + "/images");

    // sketches: named the way a scanned notes page gets named
    for (var s = 0; s < (spec.scans || 0); s++) {
        writeTextFileHere(folder + "/scans/trip" + (s + 1) + "-p1.txt",
            spec.name + " -- scanned notes page stand-in.\n" +
            "A real cave folder holds JPEGs of the survey book here.\n");
    }

    var drawingPath = "";
    if (spec.drawing === false) {
        // nothing to draw: this cave is waiting for its first trip
    }
    else if (spec.drawing === "dwg") {
        drawingPath = folder + "/" + spec.name + ".dwg";
        writeTextFileHere(drawingPath,
            "Not a real DWG -- a stand-in, so the shelf can show what it " +
            "does with a drawing CaveCAD cannot open.\n");
    }
    else {
        drawingPath = folder + "/" + spec.name + ".dxf";
        var survey = buildCave(spec);
        survey.caveName = spec.name.toUpperCase();
        if (!writeDrawing(survey, drawingPath, spec.geo === true)) {
            problems.push("could not write " + drawingPath);
            drawingPath = "";
        }
        if (spec.aerial === true) {
            // A stand-in for the NAIP basemap the aerial tool fetches:
            // its presence is what a full archive carries and a
            // sanitized package leaves behind.
            writeTextFileHere(CsGeoProject.imagePathFor(drawingPath),
                "aerial basemap stand-in\n");
        }
    }

    for (var im = 0; im < (spec.photos || 0); im++) {
        writeTextFileHere(folder + "/images/" +
            (im === 0 ? "entrance" : "passage-" + im) + ".jpg",
            "photograph stand-in for " + spec.name + ".\n" +
            "A real one would be a JPEG, and would carry the coordinates " +
            "the camera wrote into it.\n");
    }

    for (var p = 0; p < (spec.pdfs || 0); p++) {
        writeTextFileHere(folder + "/PDF/" + spec.name +
            (p === 0 ? " plan" : " profile") + ".pdf",
            "%PDF-1.4 stand-in for a plotted map of " + spec.name + "\n");
    }

    made.push({ name: spec.name, folder: folder, drawing: drawingPath });
}

// The shelf entries, ready to paste into CaveSurvey/Caves.
print("### DEMO CAVES " + made.length);
for (var m = 0; m < made.length; m++) {
    print("  " + made[m].name + "  ->  " +
        (made[m].drawing === "" ? "(no drawing)" : made[m].drawing));
}
print("### SHELF " + JSON.stringify(made));
for (var pr = 0; pr < problems.length; pr++) {
    print("### PROBLEM " + problems[pr]);
}
