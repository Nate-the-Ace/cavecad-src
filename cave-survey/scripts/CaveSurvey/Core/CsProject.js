// CsProject.js -- the PROJECTED elevation: the cave's real coordinates
// flattened onto one chosen vertical plane.
//
// Part of the Cave Survey Core library: pure functions.
//
// AN EXTENDED ELEVATION AND A PROJECTED ONE ANSWER DIFFERENT
// QUESTIONS, and a cave wants whichever one its shape deserves.
//
//   EXTENDED   X is distance travelled along the passage. No passage
//              hides behind another and every leg draws at its true
//              length, so a long horizontal cave that wanders can be
//              read end to end. What it cannot show is where anything
//              actually IS: two chambers a hundred feet apart in the
//              cave can end up side by side on the page.
//
//   PROJECTED  X is position along a chosen compass line. Passages DO
//              hide behind each other and a leg running across the
//              plane draws short -- and in exchange the drawing is the
//              cave, at true relative position and true depth. Two
//              shafts one above the other are drawn one above the
//              other.
//
// FOR A PIT CAVE THE PROJECTED ONE IS THE PRIMARY VIEW. Plumbline
// Pit's entrance drop, its rebelay ledge, the window passage leading
// off it and the shaft that parallels P2 nine feet away are all
// arranged vertically with respect to each other, and that arrangement
// IS the cave -- unroll it and you have thrown away the only thing
// worth drawing. This suite could not draw it at all until now:
// CsProfile's own header has said "a projected profile is a different
// tool" since it was written.
//
// IT IS A MODE, NOT A SECOND VIEW. A cave has one elevation. The
// projected one is built here, shaped exactly like a CsProfile band,
// and then drawn, framed, bound, erased and labelled by the same code
// that draws the extended one -- CsProfileDraw never learns there are
// two kinds. That is worth more than it sounds: the alternative was a
// fourth layer frame, its own erase, its own binding rules and its own
// tag namespace, all of which would then have to be kept in step with
// the profile's by hand.

var CsProject = {};

/** The band key a projected elevation draws under. One band, because
 *  a projection does not divide a cave into runs -- every station is
 *  on the same plane, which is the whole point. */
CsProject.BAND_KEY = "PROJ";

/** Settings: which elevation a drawing draws, and the plane it is
 *  projected onto when that is the projected one. */
CsProject.SETTING_MODE = "CaveSurvey/ProfileMode";
CsProject.MODE_EXTENDED = "extended";
CsProject.MODE_PROJECTED = "projected";
/** The cave cut into pieces at its pitches and arranged (CsChunk). */
CsProject.MODE_CHUNKED = "chunked";
/** Degrees, or "auto" for CsProject.principalAzimuth. */
CsProject.SETTING_AZIMUTH = "CaveSurvey/ProjectionAzimuth";
CsProject.AZIMUTH_AUTO = "auto";

CsProject.settings = function() {
    var mode = CsProject.MODE_EXTENDED;
    var azimuth = CsProject.AZIMUTH_AUTO;
    try {
        mode = String(RSettings.getValue(CsProject.SETTING_MODE,
            CsProject.MODE_EXTENDED));
        azimuth = String(RSettings.getValue(CsProject.SETTING_AZIMUTH,
            CsProject.AZIMUTH_AUTO));
    } catch (e) {
        // No RSettings (node, the test harness). The defaults ARE the
        // answer, so returning them is not a guess.
    }
    if (mode !== CsProject.MODE_PROJECTED &&
            mode !== CsProject.MODE_CHUNKED) {
        mode = CsProject.MODE_EXTENDED;
    }
    return { mode: mode, azimuth: azimuth };
};

/**
 * The azimuth the cave is longest along, in degrees.
 *
 * WHY THIS IS THE DEFAULT PLANE. A projection throws away whatever is
 * perpendicular to its plane, so the best plane is the one that throws
 * away least: the direction the stations are most spread out along.
 * That is the first principal axis of the station cloud in plan, which
 * for a cave following a joint is the joint, for a cave following a
 * stream is the stream, and for a pit is whatever little horizontal
 * passage it has -- which is exactly right, because in a pit it barely
 * matters and any plane shows the shafts stacked.
 *
 * Computed from the 2x2 covariance of the station positions in closed
 * form. The eigenvector of the larger eigenvalue is
 *
 *     theta = 0.5 * atan2(2*Sxy, Sxx - Syy)
 *
 * measured from the x (east) axis, which this turns into a compass
 * bearing. An axis has no direction, only a line, so the result is
 * folded into [0, 180): 040 and 220 are the same plane and a caller
 * comparing them must not see two answers.
 *
 * \return degrees in [0, 180), or null when there is nothing to
 *         measure -- fewer than two stations, or every station on one
 *         point (a cave that is all pitch, which is a real thing and
 *         has no preferred plane at all)
 */
CsProject.principalAzimuth = function(resolved, only) {
    if (resolved === null || resolved === undefined || !resolved.stations) {
        return null;
    }
    var xs = [], ys = [], n = 0, name;
    for (name in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(name)) { continue; }
        if (only !== undefined && only !== null && only[name] !== true) {
            continue;
        }
        var st = resolved.stations[name];
        if (!isFinite(st.x) || !isFinite(st.y)) { continue; }
        xs.push(st.x); ys.push(st.y); n++;
    }
    if (n < 2) {
        return null;
    }
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) {
        var dx = xs[i] - mx, dy = ys[i] - my;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    // A cave with no horizontal extent at all -- every station on one
    // plan point, which is what a single shaft surveyed straight down
    // looks like. There is no direction it is longest along, and
    // answering 0 would be inventing one.
    if (sxx + syy < CsProject.MIN_SPREAD) {
        return null;
    }
    var theta = 0.5 * Math.atan2(2.0 * sxy, sxx - syy);   // from east
    var bearing = 90.0 - theta * 180.0 / Math.PI;         // to compass
    bearing = ((bearing % 180.0) + 180.0) % 180.0;
    return bearing;
};

/** Below this total spread (squared, in survey units) a cave has no
 *  preferred plane. Generous on purpose: a cave whose stations are a
 *  thousandth of a foot apart in plan is a shaft, and a principal axis
 *  fitted to that is fitted to rounding error. */
CsProject.MIN_SPREAD = 1e-6;

/** The plane a projection will actually use: the setting, or the
 *  cave's own principal axis, or due north when even that is
 *  undefined -- and the caller is told which, because "we picked it
 *  for you" and "you asked for 040" are different claims. */
CsProject.resolveAzimuth = function(resolved, want, only) {
    if (want !== undefined && want !== null &&
            String(want) !== CsProject.AZIMUTH_AUTO) {
        var v = parseFloat(want);
        if (isFinite(v)) {
            return { azimuth: ((v % 180.0) + 180.0) % 180.0, source: "asked" };
        }
    }
    var auto = CsProject.principalAzimuth(resolved, only);
    if (auto !== null) {
        return { azimuth: auto, source: "principal" };
    }
    // A cave with no horizontal extent: every plane shows the same
    // thing, so the arbitrary choice costs the reader nothing -- but
    // it is still arbitrary and still says so.
    return { azimuth: 0.0, source: "arbitrary" };
};

/** An undirected leg key, so a caller naming a set of legs need not
 *  know which way round the surveyor shot each one. */
CsProject.legKey = function(a, b) {
    return (a < b) ? (a + "\u0000" + b) : (b + "\u0000" + a);
};

/**
 * Where a plan position lands on the projection plane.
 *
 * \param azimuthDeg the plane's strike
 * \return the signed distance along the plane from the origin
 */
CsProject.along = function(x, y, azimuthDeg) {
    var rad = azimuthDeg * Math.PI / 180.0;
    return x * Math.sin(rad) + y * Math.cos(rad);
};

/**
 * The whole cave as ONE band, shaped exactly as CsProfile.unrollBand
 * shapes a run, with X the position along the projection plane and Y
 * the station's true elevation.
 *
 * NO STATION IS OMITTED AND NO CHAIN IS WALKED. An extended elevation
 * has to pick one path through a run because its X is cumulative --
 * walk two ways from a junction and the second one has nowhere to go.
 * A projection has no such problem: every station's X is a function of
 * where it is, so every station the resolver placed is drawn, every
 * drawn leg is drawn, and loops close on the page exactly as they
 * close in the cave.
 *
 * \param opts {azimuth} -- the plane; defaults to the cave's own
 *             principal axis
 */
CsProject.band = function(survey, resolved, opts) {
    var o = opts || {};
    var picked = CsProject.resolveAzimuth(resolved,
        o.azimuth === undefined ? null : o.azimuth, o.stations || null);
    var az = picked.azimuth;

    // A SUBSET, when the caller has one. CsChunk projects one piece of
    // a cave at a time onto that piece's own plane, which is the same
    // operation over fewer stations -- not a different one, and not
    // worth a second implementation.
    var only = o.stations || null;

    var stations = [];
    var placed = {};
    var name, st;
    for (name in resolved.stations) {
        if (!resolved.stations.hasOwnProperty(name)) { continue; }
        if (only !== null && only[name] !== true) { continue; }
        st = resolved.stations[name];
        if (!isFinite(st.x) || !isFinite(st.y) || !isFinite(st.z)) {
            // NEVER DEFAULTS A MISSING COORDINATE. Same rule as
            // CsProfile.unrollBand's: a station with no resolved
            // position is not drawn at the origin, it is not drawn.
            continue;
        }
        var entry = { name: name, x: CsProject.along(st.x, st.y, az),
                      y: st.z, z: st.z };
        placed[name] = entry;
        stations.push(entry);
    }
    // Left to right, so a reader following the page follows the plane.
    stations.sort(function(a, b) {
        if (a.x < b.x) { return -1; }
        if (a.x > b.x) { return 1; }
        return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0);
    });

    var legs = [];
    var skipped = 0;
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (o.legs !== undefined && o.legs !== null &&
                o.legs[CsProject.legKey(leg.from, leg.to)] !== true) {
            continue;   // not this chunk's leg
        }
        var a = placed[leg.from], b = placed[leg.to];
        if (a === undefined || b === undefined) {
            skipped++;
            continue;
        }
        legs.push({ shot: leg.shot, from: leg.from, to: leg.to,
                    kind: leg.kind,
                    fromX: a.x, fromY: a.y, toX: b.x, toY: b.y });
    }

    var datum = null;
    for (i = 0; i < stations.length; i++) {
        if (datum === null || stations[i].z < datum) {
            datum = stations[i].z;
        }
    }

    return {
        key: CsProject.BAND_KEY,
        tie: null,
        datum: datum,
        tapeMode: o.tapeMode || CsTraverse.SLOPE,
        stations: stations,
        legs: legs,
        omitted: [],
        stopped: null,
        stoppedReason: null,
        // What the drawing needs to say about itself. A reader looking
        // at a projected elevation has to be told which way they are
        // looking, or the drawing is a picture of a cave that could be
        // any cave.
        projection: { azimuth: az, source: picked.source },
        undrawnLegs: skipped
    };
};

/**
 * A projected elevation in the shape CsProfile.build returns, so every
 * caller downstream -- the renderer, the box, the binder, the report --
 * takes it without knowing which kind of elevation it has.
 */
CsProject.build = function(survey, resolved, opts) {
    var o = opts || {};
    var band = CsProject.band(survey, resolved, o);
    var walls = CsProfile.bandWallRuns(band, survey, resolved, {
        tapeMode: o.tapeMode,
        flatSplayDeg: o.flatSplayDeg,
        splaysByStation: CsLrud.splaysByStation(survey),
        legCounts: CsLrud.legCounts(resolved.legs),
        stationAxes: CsLrud.stationAxes(resolved),
        // THE WHOLE REUSE, in one option. See bandWallRuns' own note:
        // a projected plane has one axis for the entire cave, so the
        // question every station is asked has one answer.
        fixedAzimuth: band.projection.azimuth
    });
    band.ceiling = walls.ceiling;
    band.floor = walls.floor;
    band.flat = walls.flat;
    band.zOffset = 0.0;
    band.parent = null;

    band.pitches = [];
    var pitches = CsPitch.find(survey, resolved, {});
    var inBand = {};
    for (var si = 0; si < band.stations.length; si++) {
        inBand[band.stations[si].name] = true;
    }
    for (var pi = 0; pi < pitches.length; pi++) {
        // A PROJECTION DRAWS EVERY STATION, so a pitch is whole here
        // whenever the cave has it whole -- the band-splitting that
        // silences some of the extended elevation's labels cannot
        // happen. The membership test stays anyway: a station the
        // resolver never placed is still not on the page.
        if (inBand[pitches[pi].top] === true &&
                inBand[pitches[pi].bottom] === true) {
            band.pitches.push({
                top: pitches[pi].top,
                bottom: pitches[pi].bottom,
                drop: pitches[pi].drop,
                aven: pitches[pi].aven,
                text: CsPitch.label(pitches[pi], survey.distanceUnit)
            });
        }
    }

    return {
        bands: [band],
        pitches: pitches,
        projection: band.projection,
        findings: {
            omitted: [],
            mismatches: [],
            secondTies: [],
            orphans: [],
            strandedRoots: [],
            stopped: [],
            ungrouped: [],
            undrawn: [],
            wallPointsSkipped: walls.skipped || 0
        }
    };
};

/**
 * How a projected elevation names itself on the page.
 *
 * A reader has to be told which way they are looking. "PROJECTED 040"
 * is the difference between a drawing of a cave and a drawing of some
 * cave, and when the plane was chosen FOR them rather than by them,
 * the caption says that too -- a number a caver did not pick, printed
 * as though they had, is the sort of thing that gets copied into a
 * report and quoted back.
 */
CsProject.caption = function(projection) {
    if (projection === null || projection === undefined) {
        return "PROJECTED";
    }
    var deg = Math.round(projection.azimuth);
    var text = "PROJECTED " + (deg < 100 ? (deg < 10 ? "00" : "0") : "") + deg;
    if (projection.source === "principal") {
        text += " (LONG AXIS)";
    } else if (projection.source === "arbitrary") {
        text += " (NO PREFERRED PLANE)";
    }
    return text;
};
