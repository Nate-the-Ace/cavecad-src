// format_fidelity.js -- what survives a round trip through each
// interchange format, and what does not.
//
//   node tools/format_fidelity.js            the table
//   node tools/format_fidelity.js --detail   plus every differing field
//
// WHY THIS EXISTS. Every writer in Core/Format is lossy in its own way,
// because the formats are: Compass has no fix directive, CSV has no
// backsight columns, Walls has no per-trip header. Those losses are
// documented one file at a time in each reader's own SCOPE note, which
// is the right place for a maintainer and the wrong place for a caver
// deciding which format to hand a colleague. This measures them
// instead of asserting them, against a survey that carries every trap
// at once.
//
// THE BASELINE IS NOT A FILE. tools/make_test_cave.js builds PITFALL
// CAVE as a CsModel survey and only then writes it out three ways, so
// this loads the generator and takes the survey straight from it. A
// baseline read back from PitfallCave.svx would already have lost
// whatever Survex cannot say, and every format would then score
// against a handicapped original.
//
// Not a test: nothing here passes or fails. It reports, and
// docs/format-fidelity.md is written from what it reports.

var IS_NODE = (typeof process !== "undefined" && process.versions &&
    process.versions.node !== undefined);

var repoRoot;
var readTextFile;

if (IS_NODE) {
    var nodeFs = require("fs");
    var nodePath = require("path");
    repoRoot = nodePath.resolve(__dirname, "..");
    readTextFile = function(path) {
        return nodeFs.readFileSync(path, "utf8");
    };
} else {
    var args = RSettings.getOriginalArguments();
    repoRoot = args[args.length - 1];
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
}

var DETAIL = IS_NODE && process.argv.indexOf("--detail") >= 0;

// ---------------------------------------------------------------------
// The generator, loaded for its survey.
//
// make_test_cave.js writes testdata/ as a side effect and prints its
// own verification report. Both are wanted nowhere near this output, so
// writeTextFile is stubbed to a no-op BEFORE the eval (the generator
// only assigns it inside its own IS_NODE branch, so the stub has to be
// re-applied after) and its printing is swallowed. The generator is
// deterministic and idempotent, so a run that did reach the disk would
// rewrite the same bytes.
// ---------------------------------------------------------------------

var generatorSource = readTextFile(repoRoot + "/tools/make_test_cave.js");

// Cut the generator off after it has BUILT the caves and before it
// writes or verifies anything: everything from the "---- build" banner
// is its own job, not this file's.
var buildMarker = "var main = buildPitfallCave();";
var cut = generatorSource.indexOf(buildMarker);
if (cut < 0) {
    throw new Error("make_test_cave.js no longer defines " + buildMarker +
        " -- format_fidelity.js reads its survey from there.");
}
generatorSource = generatorSource.substring(0, cut) + buildMarker + "\n";

// Indirect eval runs in GLOBAL scope, and node's require/__dirname are
// module-scoped -- the generator's own environment shim needs both, so
// they are published globally first.
if (IS_NODE) {
    globalThis.require = require;
    globalThis.__dirname = __dirname;
}

(0, eval)(generatorSource);

// The generator's builder wraps the survey (b.survey) rather than
// being one.
if (typeof main === "undefined" || main === null ||
        main.survey === undefined || main.survey === null) {
    throw new Error("the generator did not produce a survey");
}
var origin = main.survey;

// ---------------------------------------------------------------------
// Comparison.
// ---------------------------------------------------------------------

var TOL = 0.011;   // writers round to 2 decimals; anything inside that
                   // is the format's precision, not a loss of meaning

function isNum(v) {
    return typeof v === "number" && !isNaN(v);
}

function sameNumber(a, b) {
    if (a === null || a === undefined) {
        return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
        return false;
    }
    return Math.abs(a - b) <= TOL;
}

function sameAzimuth(a, b) {
    if (a === null || a === undefined) {
        return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
        return false;
    }
    return Math.abs(CsAngles.azimuthDifference(a, b)) <= TOL;
}

// Every property this report speaks about, and how to read it off a
// shot. Kept as data so the table and the --detail dump cannot drift
// apart.
var SHOT_FIELDS = [
    { key: "from", label: "station names", get: function(s) { return s.from; } },
    { key: "to", label: "station names", get: function(s) { return s.to; } },
    { key: "distance", label: "tape", get: function(s) { return s.distance; },
      num: true },
    { key: "azimuth", label: "azimuth", get: function(s) { return s.azimuth; },
      az: true },
    { key: "inclination", label: "inclination",
      get: function(s) { return s.inclination; }, num: true },
    { key: "backAzimuth", label: "backsight azimuth",
      get: function(s) { return s.backAzimuth; }, az: true },
    { key: "backInclination", label: "backsight inclination",
      get: function(s) { return s.backInclination; }, num: true },
    { key: "left", label: "LRUD", get: function(s) { return s.left; }, num: true },
    { key: "right", label: "LRUD", get: function(s) { return s.right; }, num: true },
    { key: "up", label: "LRUD", get: function(s) { return s.up; }, num: true },
    { key: "down", label: "LRUD", get: function(s) { return s.down; }, num: true },
    // The several readings behind one "5/10" LRUD entry. Only the
    // suite's own CSV dialect has anywhere to put a second number, so
    // this row is expected to be empty for four of the five -- but
    // expected is not measured, and it was not measured until now.
    { key: "leftAll", label: "LRUD all-readings",
      get: function(s) { return (s.leftAll || []).join("/"); } },
    { key: "rightAll", label: "LRUD all-readings",
      get: function(s) { return (s.rightAll || []).join("/"); } },
    { key: "upAll", label: "LRUD all-readings",
      get: function(s) { return (s.upAll || []).join("/"); } },
    { key: "downAll", label: "LRUD all-readings",
      get: function(s) { return (s.downAll || []).join("/"); } },
    { key: "splay", label: "splay flag", get: function(s) { return s.splay; } },
    { key: "excludeFromPlot", label: "surface flag",
      get: function(s) { return !!s.excludeFromPlot; } },
    { key: "excludeFromAll", label: "excluded flag",
      get: function(s) { return !!s.excludeFromAll; } },
    { key: "excludeFromLength", label: "duplicate flag",
      get: function(s) { return !!s.excludeFromLength; } },
    { key: "noAdjust", label: "held-fixed flag",
      get: function(s) { return !!s.noAdjust; } },
    { key: "notes", label: "shot notes",
      get: function(s) { return s.notes || ""; } },
    // The trip a shot belongs to, by IDENTITY rather than by index:
    // every writer emits trips in first-appearance order, so a survey
    // whose trips come back correct but renumbered would otherwise
    // report every shot as having changed trips.
    { key: "trip", label: "trip membership",
      get: function(s, survey) {
          var t = CsModel.tripOf(survey, s);
          return (t === null || t === undefined) ? "" :
              CsModel.tripFingerprint(t);
      } },
    { key: "declination", label: "per-shot declination",
      get: function(s) { return s.declination; }, num: true }
];

/**
 * A shot's identity, for matching one survey's shots against another's.
 *
 * NOT the index. A writer is free to reorder -- Compass groups legs
 * into per-trip blocks, and any format that splits one trip across two
 * headers reassembles them together -- and an index-wise comparison
 * reads a reordered survey as a corrupted one: every field of every
 * shot after the first move "differs". Identity is the station pair,
 * plus an ordinal for splays, which have no TO name to be identified
 * by and so are matched in the order they appear at their station.
 */
function shotKeys(survey) {
    var keys = [];
    var seen = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        // The ordinal is not decoration. PITFALL CAVE carries a
        // deliberately DUPLICATED leg that disagrees with its twin (the
        // pitfall CsValidate.check exists to flag), and splays have no
        // TO name at all -- without an occurrence counter both collapse
        // onto one key, and every later duplicate gets compared against
        // the first, reporting the fixture's own intended disagreement
        // as a format's data loss.
        var base = (s.splay || s.to === "") ?
            "splay|" + s.from : "leg|" + s.from + "|" + s.to;
        var n = seen[base] || 0;
        seen[base] = n + 1;
        keys.push(base + "|" + n);
    }
    return keys;
}

function compareShots(origin, back) {
    var result = { counted: 0, unmatched: [], extra: 0, reordered: false,
        fields: {}, examples: {} };
    for (var f = 0; f < SHOT_FIELDS.length; f++) {
        result.fields[SHOT_FIELDS[f].key] = 0;
    }

    var originKeys = shotKeys(origin);
    var backKeys = shotKeys(back);
    var backBy = {};
    for (var bi = 0; bi < backKeys.length; bi++) {
        // First occurrence wins; a duplicated key means the format
        // merged two shots, which shows up as an unmatched original.
        if (!backBy.hasOwnProperty(backKeys[bi])) {
            backBy[backKeys[bi]] = bi;
        }
    }

    var lastIndex = -1;
    for (var i = 0; i < originKeys.length; i++) {
        var key = originKeys[i];
        if (!backBy.hasOwnProperty(key)) {
            result.unmatched.push(key);
            continue;
        }
        var j = backBy[key];
        if (j < lastIndex) {
            result.reordered = true;
        }
        lastIndex = j;
        result.counted++;

        var a = origin.shots[i];
        var b = back.shots[j];
        for (var fi = 0; fi < SHOT_FIELDS.length; fi++) {
            var spec = SHOT_FIELDS[fi];
            var av = spec.get(a, origin);
            var bv = spec.get(b, back);
            var same;
            if (spec.az) {
                same = sameAzimuth(av, bv);
            } else if (spec.num) {
                same = sameNumber(av, bv);
            } else {
                same = (av === bv);
            }
            if (!same) {
                result.fields[spec.key]++;
                if (!result.examples.hasOwnProperty(spec.key)) {
                    result.examples[spec.key] = a.from + "->" +
                        (a.to === "" ? "(splay)" : a.to) + ": " +
                        JSON.stringify(av) + " became " + JSON.stringify(bv);
                }
            }
        }
    }
    result.extra = backKeys.length - result.counted;
    return result;
}

/**
 * The claim that matters most: does the MAP survive?
 *
 * Both surveys are resolved and their stations compared in place. A
 * format can lose a note and still draw the same cave; one that moves a
 * station has lost the survey.
 */
function comparePositions(origin, back) {
    var ra = CsNetwork.resolve(origin);
    var rb = CsNetwork.resolve(back);
    var worst = 0;
    var worstName = "";
    var missing = 0;
    var compared = 0;
    for (var name in ra.stations) {
        if (!ra.stations.hasOwnProperty(name)) {
            continue;
        }
        if (!rb.stations.hasOwnProperty(name)) {
            missing++;
            continue;
        }
        compared++;
        var p = ra.stations[name];
        var q = rb.stations[name];
        var d = Math.sqrt((p.x - q.x) * (p.x - q.x) +
            (p.y - q.y) * (p.y - q.y) + (p.z - q.z) * (p.z - q.z));
        if (d > worst) {
            worst = d;
            worstName = name;
        }
    }
    return { worst: worst, worstName: worstName, missing: missing,
        compared: compared,
        loopsA: ra.loops.length, loopsB: rb.loops.length,
        unresolvedB: rb.unresolved.length };
}

function countFixed(survey) {
    var n = 0;
    for (var k in survey.fixed) {
        if (survey.fixed.hasOwnProperty(k)) {
            n++;
        }
    }
    return n;
}

function tripSummary(survey) {
    var dates = 0, teams = 0, decls = 0;
    for (var i = 0; i < survey.trips.length; i++) {
        if (survey.trips[i].date) { dates++; }
        if (survey.trips[i].team) { teams++; }
        if (isNum(survey.trips[i].declination) &&
                survey.trips[i].declination !== 0) { decls++; }
    }
    return { count: survey.trips.length, dates: dates, teams: teams,
        decls: decls };
}

// ---------------------------------------------------------------------
// Run it.
// ---------------------------------------------------------------------

var out = [];
function say(line) {
    out.push(line === undefined ? "" : line);
}

CsModel.ensureTrips(origin);
var originTrips = tripSummary(origin);
var originSplays = 0;
for (var oi = 0; oi < origin.shots.length; oi++) {
    if (origin.shots[oi].splay) { originSplays++; }
}

say("PITFALL CAVE through every writer and back");
say("");
say("Baseline (the generator's own CsModel survey, no file involved):");
say("  shots " + origin.shots.length + " (splays " + originSplays + ")" +
    "   stations " + CsModel.stationNames(origin).length +
    "   trips " + originTrips.count +
    "   fixed " + countFixed(origin) +
    "   unit " + origin.distanceUnit);
say("");

var rows = [];
for (var fi = 0; fi < CsFormatRegistry.FORMATS.length; fi++) {
    var format = CsFormatRegistry.FORMATS[fi];
    var row = { id: format.id, label: format.label };
    var text;
    try {
        text = format.write(origin);
    } catch (eW) {
        row.error = "write threw: " + eW;
        rows.push(row);
        continue;
    }
    row.bytes = text.length;
    var back;
    try {
        back = format.parse(text);
    } catch (eP) {
        row.error = "parse threw: " + eP;
        rows.push(row);
        continue;
    }
    CsModel.ensureTrips(back);

    row.shots = back.shots.length;
    row.splays = 0;
    for (var bi = 0; bi < back.shots.length; bi++) {
        if (back.shots[bi].splay) { row.splays++; }
    }
    row.stations = CsModel.stationNames(back).length;
    row.fixed = countFixed(back);
    row.unit = back.distanceUnit;
    row.caveName = back.caveName;
    row.trips = tripSummary(back);
    row.startLrud = back.startLrud !== null && back.startLrud !== undefined;
    row.declination = back.declination;
    row.shotDiff = compareShots(origin, back);
    row.positions = comparePositions(origin, back);
    rows.push(row);
}

// ---- the table --------------------------------------------------------

function pad(text, width) {
    var s = String(text);
    while (s.length < width) { s += " "; }
    return s;
}
function padLeft(text, width) {
    var s = String(text);
    while (s.length < width) { s = " " + s; }
    return s;
}

say(pad("", 10) + padLeft("shots", 7) + padLeft("splays", 7) +
    padLeft("stns", 6) + padLeft("trips", 6) + padLeft("dates", 6) +
    padLeft("teams", 6) + padLeft("fixed", 6) + padLeft("worst move", 12));
say(pad("baseline", 10) + padLeft(origin.shots.length, 7) +
    padLeft(originSplays, 7) + padLeft(CsModel.stationNames(origin).length, 6) +
    padLeft(originTrips.count, 6) + padLeft(originTrips.dates, 6) +
    padLeft(originTrips.teams, 6) + padLeft(countFixed(origin), 6) +
    padLeft("--", 12));
for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    if (r.error) {
        say(pad(r.id, 10) + "  " + r.error);
        continue;
    }
    say(pad(r.id, 10) + padLeft(r.shots, 7) + padLeft(r.splays, 7) +
        padLeft(r.stations, 6) + padLeft(r.trips.count, 6) +
        padLeft(r.trips.dates, 6) + padLeft(r.trips.teams, 6) +
        padLeft(r.fixed, 6) +
        padLeft(r.positions.worst.toFixed(3) + " " + origin.distanceUnit, 12));
}
say("");

// ---- what changed, per format ----------------------------------------

for (ri = 0; ri < rows.length; ri++) {
    r = rows[ri];
    if (r.error) {
        continue;
    }
    say("== " + r.label);
    say("   " + r.bytes + " bytes,  " +
        r.positions.compared + " stations compared, " +
        r.positions.missing + " missing,  worst move " +
        r.positions.worst.toFixed(4) + " " + origin.distanceUnit +
        (r.positions.worstName === "" ? "" : " at " + r.positions.worstName));
    say("   loops found: baseline " + r.positions.loopsA +
        ", after round trip " + r.positions.loopsB +
        ";  unresolved shots after: " + r.positions.unresolvedB);
    if (r.shots !== origin.shots.length) {
        say("   SHOT COUNT CHANGED: " + origin.shots.length + " -> " + r.shots);
    }
    say("   shots matched by station pair: " + r.shotDiff.counted +
        " of " + origin.shots.length +
        (r.shotDiff.unmatched.length > 0 ?
            ";  NOT FOUND AFTER THE ROUND TRIP: " +
            r.shotDiff.unmatched.length : "") +
        (r.shotDiff.extra > 0 ? ";  unaccounted-for extras: " +
            r.shotDiff.extra : ""));
    if (r.shotDiff.unmatched.length > 0) {
        var show = r.shotDiff.unmatched.slice(0, DETAIL ? 20 : 4);
        say("     " + show.join(", ") +
            (r.shotDiff.unmatched.length > show.length ? ", ..." : ""));
    }
    if (r.shotDiff.reordered) {
        say("   shot ORDER changed (harmless on its own -- the survey is a " +
            "graph, not a list -- but the notebook's row order is gone)");
    }
    if (r.caveName !== origin.caveName) {
        say("   cave name: " + JSON.stringify(origin.caveName) + " -> " +
            JSON.stringify(r.caveName));
    }
    if (r.unit !== origin.distanceUnit) {
        say("   unit: " + origin.distanceUnit + " -> " + r.unit);
    }
    if (!sameNumber(r.declination, origin.declination)) {
        say("   survey declination: " + origin.declination + " -> " +
            r.declination);
    }
    if (r.trips.count !== originTrips.count) {
        say("   TRIPS: " + originTrips.count + " -> " + r.trips.count);
    }
    if (r.trips.dates !== originTrips.dates) {
        say("   trip dates kept: " + r.trips.dates + " of " + originTrips.dates);
    }
    if (r.trips.teams !== originTrips.teams) {
        say("   trip teams kept: " + r.trips.teams + " of " + originTrips.teams);
    }
    if (r.fixed !== countFixed(origin)) {
        say("   fixed stations: " + countFixed(origin) + " -> " + r.fixed);
    }

    // Fields, grouped by the label they share, so LRUD reports once.
    var byLabel = {};
    for (var sf = 0; sf < SHOT_FIELDS.length; sf++) {
        var spec2 = SHOT_FIELDS[sf];
        var count = r.shotDiff.fields[spec2.key];
        if (count === 0) {
            continue;
        }
        if (!byLabel.hasOwnProperty(spec2.label)) {
            byLabel[spec2.label] = { count: 0, example: null };
        }
        byLabel[spec2.label].count += count;
        if (byLabel[spec2.label].example === null) {
            byLabel[spec2.label].example = r.shotDiff.examples[spec2.key];
        }
    }
    var labels = Object.keys(byLabel).sort();
    if (labels.length === 0) {
        say("   every compared shot field survived");
    }
    for (var lb = 0; lb < labels.length; lb++) {
        say("   " + pad(labels[lb], 22) + padLeft(byLabel[labels[lb]].count, 5) +
            " differing values" +
            (DETAIL ? "\n        e.g. " + byLabel[labels[lb]].example : ""));
    }
    say("");
}

var text = out.join("\n");
if (IS_NODE) {
    console.log(text);
} else {
    print(text);
}
