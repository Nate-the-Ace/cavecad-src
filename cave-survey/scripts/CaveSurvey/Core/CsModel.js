// Model.js -- the survey value objects every tool works from.
//
// Part of the Cave Survey Core library: pure data, no GUI, no
// document access.
//
// One neutral shape, whatever the source (typed into the Notebook,
// parsed from Compass/Walls/Survex/CSV, or read back out of a
// drawing's entity tags):
//
//   Survey {
//     name            string, e.g. "Main Passage"
//     caveName        drawing-level cave name (Compass file line 1);
//                     distinct from name/trip.name, which are the trip
//                     designation. "" when the format has no such
//                     concept (Walls/Survex/CSV). NOT mirrored by
//                     ensureTrips.
//     date            "YYYY-MM-DD" or ""
//     team            string, free text
//     declination     degrees, positive east, already APPLIED to the
//                     azimuths below (the storage convention every
//                     supported format shares); recorded so it can be
//                     reported and un-applied
//     declinationSource  "file" | "user" | "igrf" | ""
//     distanceUnit    "ft" | "m" -- unit of every distance and LRUD
//     shots           [Shot]
//     fixed           { stationName: {x, y, z} } from #Fix / *fix
//     trips           [Trip] -- one drawing can hold shots from several
//                     survey trips (different date/team/declination
//                     each); trips[0] mirrors the top-level fields
//                     above for the common one-trip case, so old code
//                     that never heard of trips keeps working. See
//                     ensureTrips/tripOf/tripIdFor below.
//   }
//
//   Trip {
//     name, date, team, declination, declinationSource, distanceUnit,
//     startNote, startLrud   -- same meaning as the matching Survey
//                     field, but scoped to this one trip
//   }
//
//   Shot {
//     from, to        station names ("" for splays' missing end)
//     distance        tape length (slope distance unless tapeMode says
//                     otherwise -- see Traverse.js)
//     azimuth         degrees clockwise from north, TRUE bearing
//     inclination     degrees, positive up
//     left,right,up,down  LRUD at the TO station, facing travel;
//                     null = not measured (distinct from 0 = wall AT
//                     the station -- the wall passes through the
//                     survey point itself, still a real measurement)
//     leftOpen,rightOpen,upOpen,downOpen  boolean, true when that side
//                     was written "P" (open passage -- no wall that
//                     direction at all, not merely unmeasured). The
//                     paired value is null whenever its Open flag is
//                     true; a side can be a number, null-and-not-open
//                     (not measured), or null-and-open (P). See
//                     parseLrudEntry for how "5/P" (a ledge with the
//                     passage open beyond it) resolves.
//     splay           boolean: no named TO station, geometry only
//     excludeFromPlot boolean: position stations but draw nothing
//                     (Compass #|P#, Survex *flags surface)
//     excludeFromAll  boolean: ignore entirely (Compass #|X#)
//     excludeFromLength boolean: real geometry, but skip in length
//                     stats (Compass #|L#, Survex *flags duplicate)
//     noAdjust        boolean: hold fixed during loop closure
//                     (Compass #|C#)
//     notes           string
//     trip            index into survey.trips this shot belongs to;
//                     0 when the survey has never been split into
//                     trips
//     declination     the declination that was APPLIED to this shot's
//                     azimuth (and backAzimuth -- one frame, see
//                     below); null = no per-shot record, fall back to
//                     the shot's trip (CsModel.appliedDeclination)
//   }
//
// Per-shot declination -- provenance, not identity. A trip is one date
// and team (see tripFingerprint), so a file that declares two
// declinations for the same party on the same day merges into ONE
// trip whose record can hold only one of them. The shots keep the
// TRUE azimuths each declaration produced either way; recording the
// value each one was computed with is what lets a later revision
// un-apply exactly what that shot was given instead of the trip's
// one value. It is deliberately absent from tripFingerprint and from
// every writer's header decision except as the grouping key it has to
// be (see CsFormatCompass.write).
//
// The rule the field lives or dies by: whoever CHANGES an azimuth's
// declination must update it in the same breath, or it starts lying.
// CsRevise.reviseDeclination does. A tool that rebuilds shots from
// typed magnetic readings (the Survey Notebook) leaves it null on
// purpose -- the value it applied IS its trip's, which is exactly
// what null means.
//
// Backsight frame: backAzimuth/backInclination are UNREVERSED (a good
// backsight compass reads ~180 deg from azimuth, backInclination ~
// -inclination) but live in the SAME frame as azimuth: declination
// already applied by the parsers, removed again by the writers. That
// keeps Traverse's fore/back averaging inside one frame.
//
// LRUD nulls: parsers map "missing" markers (negative values in
// Compass, "--" in Walls, blank in CSV) to null, never to 0. "P"
// (open passage -- no wall that direction) is ALSO null, but with its
// side's Open flag set, so it stays distinguishable from a genuinely
// unmeasured side; a measured 0 (wall at the station) keeps the
// number 0 and its Open flag false. Compass/Walls/Survex/Therion have
// no native token for "open" -- their own grammars only have a
// number or "not measured" -- so a P written to one of those foreign
// formats degrades to "not measured" on export, same as any other
// null. CsModel's own row/tag encodings (shotRowText, CsTags,
// CsCsv) are not so constrained and round-trip P (and "5/P")
// exactly, because this Core controls their grammar.
//
// Trip identity: two trip records are "the same trip" when their
// fingerprint -- date + "|" + team -- is equal. A trip IS a party
// surveying on a day; declination is a measurement ABOUT that trip
// that gets corrected later, so it is deliberately NOT part of the
// identity -- with it in, correcting a trip's declination turned it
// into a DIFFERENT trip and forked a duplicate with conflicting legs.
// Name is out for the same reason it always was: it's a label, not
// identity. See tripFingerprint/tripIdFor.
//
// Parse findings: survey.parseFindings holds things noticed while a
// file was READ that no later inspection of the survey could
// rediscover (see addParseFinding) -- CsValidate.check hands them on
// so they reach the import summary with every other finding. Absent
// until something is recorded, and never persisted to a drawing. No
// parser records one at the moment: the only finding there ever was
// warned that a merged trip could not be revised exactly, which
// per-shot declination made false (see absorbDeclination).

var CsModel = {};

/** A fresh, empty survey. */
CsModel.newSurvey = function() {
    return {
        name: "",
        // drawing-level cave name (Compass file line 1, e.g. "FINGERPRINT
        // CAVE"), distinct from survey.name/trip.name which are the trip
        // designation (Compass "SURVEY NAME:", e.g. "ENT"). NOT mirrored
        // by ensureTrips -- it is not per-trip data, it belongs to the
        // whole drawing.
        caveName: "",
        date: "",
        team: "",
        // the instruments the readings were taken with ("SUUNTO KB-14,
        // FIBERGLASS TAPE", "DISTOX2 #4721") -- free text, per trip
        instruments: "",
        declination: 0.0,
        declinationSource: "",
        distanceUnit: "ft",
        shots: [],
        fixed: {},
        // note for the very first station (no arriving shot to carry it)
        startNote: "",
        // LRUD of the very first station, which no shot arrives at --
        // {left, right, up, down} or null. The paper notes page records
        // it beside the first station; the first shot's azimuth is its
        // direction reference when drawn.
        startLrud: null
    };
};

/** A shot with every field present and neutral. */
CsModel.newShot = function() {
    return {
        from: "",
        to: "",
        distance: 0.0,
        azimuth: 0.0,
        inclination: 0.0,
        backAzimuth: null,      // backsight compass, uncorrected (deg)
        backInclination: null,  // backsight clino, uncorrected (deg)
        // True when NO BEARING WAS SIGHTED on this leg -- the notes
        // carry a dash where the compass reading goes, which every
        // survey format allows on a plumbed pitch and which a caver
        // hanging on a rope writes because the needle is meaningless
        // there, not because they forgot. `azimuth` still holds a
        // number (0, plus whatever declination the trip applies) so
        // that every consumer of a shot can go on doing arithmetic
        // with it -- at a plumb that number is multiplied by a plan
        // projection of zero and moves nothing. What it must NEVER do
        // is act as evidence of a DIRECTION: it is not a bearing that
        // happens to read north, it is the absence of a bearing. The
        // rules that swing an LRUD tick or orient a cross section ask
        // this flag before they use `azimuth` (see
        // CsLrud.tickAzimuthAt).
        azimuthOmitted: false,
        left: null,
        right: null,
        up: null,
        down: null,
        // every reading when a side was written "5/10"; null otherwise
        leftAll: null,
        rightAll: null,
        upAll: null,
        downAll: null,
        // true when the side was written "P" (open passage) rather
        // than measured -- see the Shot shape comment at the top of
        // this file. Always false/false/false/false alongside a real
        // number; a side is never both.
        leftOpen: false,
        rightOpen: false,
        upOpen: false,
        downOpen: false,
        splay: false,
        excludeFromPlot: false,
        excludeFromAll: false,
        excludeFromLength: false,
        noAdjust: false,
        notes: "",
        // index into survey.trips; 0 until the survey is split into
        // trips (see ensureTrips)
        trip: 0,
        // The declination APPLIED to this shot's azimuth and
        // backAzimuth (they share one frame). null = nothing recorded
        // for this shot, so its trip's value stands in -- see
        // appliedDeclination and the per-shot declination note in the
        // file header, including the rule that whoever changes an
        // azimuth's declination must update this too.
        declination: null
    };
};

/** A fresh trip record, fields neutral -- see the Trip shape above. */
CsModel.newTrip = function() {
    return {
        name: "",
        date: "",
        team: "",
        instruments: "",
        declination: 0.0,
        declinationSource: "",
        distanceUnit: "ft",
        startNote: "",
        startLrud: null
    };
};

/**
 * The identity string two trip records are compared by: same date,
 * same team means "the same trip". Declination is NOT in it -- it is
 * revisable, and identity is not: the revision framework corrects a
 * trip's declination in place and the trip has to stay the same trip
 * across that correction. Missing fields read as "", so a half-built
 * record still fingerprints instead of throwing.
 */
CsModel.tripFingerprint = function(trip) {
    return (trip.date || "") + "|" + (trip.team || "");
};

/**
 * The declination that WAS applied to a shot's azimuth: its own
 * recorded value, or its trip's when it has none. The one place the
 * fallback rule lives, so every writer un-applying a declination and
 * every revision re-applying one agree by construction. Returns a
 * number, never null -- a shot with no provenance in a survey with no
 * trip record reads 0, the same neutral value newTrip starts at.
 *
 * \param shot the Shot
 * \param trip the shot's trip record (CsModel.tripOf), may be absent
 */
CsModel.appliedDeclination = function(shot, trip) {
    if (shot !== null && shot !== undefined &&
            shot.declination !== null && shot.declination !== undefined) {
        var d = Number(shot.declination);
        if (!isNaN(d)) {
            return d;
        }
    }
    if (trip === null || trip === undefined) {
        return 0.0;
    }
    var t = Number(trip.declination);
    return isNaN(t) ? 0.0 : t;
};

/**
 * Records something noticed while READING a file -- a fact the survey
 * itself no longer shows, so no later check could rediscover it (see
 * absorbDeclination). Rides the same findings list as CsValidate's
 * live checks: {severity, shotIndex, code, message}, shotIndex -1 for
 * survey-wide. An identical code+message is recorded once, because a
 * per-leg parser hits the same condition on every leg that follows.
 */
CsModel.addParseFinding = function(survey, severity, code, message) {
    if (survey.parseFindings === undefined ||
            survey.parseFindings === null) {
        survey.parseFindings = [];
    }
    for (var i = 0; i < survey.parseFindings.length; i++) {
        if (survey.parseFindings[i].code === code &&
                survey.parseFindings[i].message === message) {
            return;
        }
    }
    survey.parseFindings.push({ severity: severity, shotIndex: -1,
        code: code, message: message });
};

/**
 * The parse-time findings recorded on a survey, as a COPY -- callers
 * concatenate their own findings onto it, and must not grow the
 * survey's list by doing so.
 */
CsModel.parseFindings = function(survey) {
    if (survey.parseFindings === undefined ||
            survey.parseFindings === null) {
        return [];
    }
    return survey.parseFindings.slice(0);
};

/**
 * Folds an incoming trip record's declination into the trip it was
 * found to BE (same date and team). Nathan's rule: the new value takes
 * precedence, so the LAST one read governs the trip from then on --
 * that is a decision, not an accident of iteration order.
 *
 * Nothing is reported, because nothing is lost any more. This used to
 * warn that a merged trip could only be revised uniformly -- exact
 * for the shots read with the kept value, off by the difference for
 * the rest. That is no longer true: each shot records the declination
 * it was actually computed with (Shot.declination, set by the parser
 * that applied it), so a revision un-applies each shot's own value and
 * lands exact for all of them, and the Compass writer splits the
 * groups back into their own blocks. The trip record's single value is
 * now just the fallback for shots that carry no provenance of their
 * own -- a label to display and revise, not the only truth there is.
 */
CsModel.absorbDeclination = function(survey, tripIndex, incoming) {
    var existing = survey.trips[tripIndex];
    var was = Number(existing.declination);
    var now = Number(incoming.declination);
    if (isNaN(was)) {
        was = 0.0;
    }
    if (isNaN(now)) {
        now = 0.0;
    }
    // 4 decimals: finer than any compass, and the granularity trip
    // identity used to compare declinations at.
    if (Math.abs(was - now) < 5e-5) {
        return;
    }
    existing.declination = now;
    if (incoming.declinationSource) {
        existing.declinationSource = incoming.declinationSource;
    }
};

/**
 * Brings a survey's trips array into existence and keeps it in sync
 * with the top-level name/date/team/... fields every OLDER piece of
 * code still reads and writes. Two directions, both idempotent:
 *
 *   no trips yet  -- build trips[0] by copying the top-level fields
 *                    down, then stamp every shot missing a trip with
 *                    trip 0 (shots written before trips existed)
 *   trips already exist -- mirror trips[0] back UP to the top level,
 *                    so a caller that only reads survey.team still
 *                    sees trip 0's team after someone edited it
 *
 * Called at the top of every function (tripIdFor, writers, etc.) that
 * needs trips to exist, so nothing else has to remember to call it
 * first.
 *
 * WARNING -- once trips exists, trips[0] is the authority, not the
 * top-level fields: this function's second half OVERWRITES
 * survey.name/date/team/declination/... from trips[0] every time it
 * runs. A direct write like `survey.team = "x"` after trips already
 * exists looks like it worked, but is silently lost the next time
 * anything calls ensureTrips (directly, or via tripIdFor/writers that
 * call it first). Code that edits metadata once trips exist must
 * write survey.trips[i].<field> instead of the top-level field.
 */
CsModel.ensureTrips = function(survey) {
    if (survey.trips === undefined || survey.trips === null ||
            survey.trips.length === 0) {
        var t = CsModel.newTrip();
        t.name = survey.name;
        t.date = survey.date;
        t.team = survey.team;
        t.instruments = survey.instruments || "";
        t.declination = survey.declination;
        t.declinationSource = survey.declinationSource;
        t.distanceUnit = survey.distanceUnit;
        t.startNote = survey.startNote || "";
        t.startLrud = survey.startLrud || null;
        survey.trips = [t];
        for (var i = 0; i < survey.shots.length; i++) {
            if (survey.shots[i].trip === undefined ||
                    survey.shots[i].trip === null) {
                survey.shots[i].trip = 0;
            }
        }
    }
    var t0 = survey.trips[0];
    survey.name = t0.name;
    survey.date = t0.date;
    survey.team = t0.team;
    survey.instruments = t0.instruments || "";
    survey.declination = t0.declination;
    survey.declinationSource = t0.declinationSource;
    survey.distanceUnit = t0.distanceUnit;
    survey.startNote = t0.startNote;
    // MIRRORS DOWN, BUT DOES NOT ERASE. Every other field here is
    // copied trip-0-to-survey unconditionally, which is right for a
    // label the trip owns. startLrud is different: it is the only one
    // a caller is likely to set on the SURVEY after the trips already
    // exist, and this line then threw it away -- silently, on the next
    // ensureTrips, which is the first thing every writer calls. The
    // entrance's own walls are what got thrown away: no shot arrives
    // at the first station, so startLrud is the only place they live
    // (see CsLrud.wallRuns' startLruds pass), and a sinkhole rim or a
    // pitch head would simply export with no width. Where trip 0 has
    // nothing and the survey does, the survey's value is ADOPTED
    // upward instead.
    if ((t0.startLrud === null || t0.startLrud === undefined) &&
            survey.startLrud !== null && survey.startLrud !== undefined) {
        t0.startLrud = survey.startLrud;
    } else {
        survey.startLrud = t0.startLrud;
    }
    return survey;
};

/**
 * Sets the first station's LRUD in BOTH places it has to live: on the
 * survey, where every consumer reads it, and on trip 0, which owns it.
 *
 * Use this rather than assigning `survey.startLrud` directly. The two
 * copies exist because a trip is the unit of revision and the survey
 * is the unit of drawing, and keeping them in step by hand is the kind
 * of thing that works until the day someone sets one of them after the
 * trips are built.
 */
CsModel.setStartLrud = function(survey, lrud) {
    survey.startLrud = lrud || null;
    if (survey.trips !== undefined && survey.trips !== null &&
            survey.trips.length > 0) {
        survey.trips[0].startLrud = survey.startLrud;
    }
};

/** The trip record a shot belongs to (trip 0 when unset). */
CsModel.tripOf = function(survey, shot) {
    return survey.trips[shot.trip || 0];
};

/**
 * True when survey.trips[index] is the empty slot ensureTrips builds
 * out of a survey that had no metadata at all -- not a trip, but the
 * ABSENCE of one, waiting to be filled.
 *
 * Both halves of the test are load-bearing. A blank fingerprint alone
 * is not enough: a real trip may legitimately have no date and no team
 * (an undated notebook page, an unattributed Compass block), and
 * handing its slot to some other party's page would silently merge two
 * different trips' work under one record. So the slot also has to be
 * unused -- no shot anywhere claims it. A trip nobody surveyed on and
 * nobody can name is a placeholder; a nameless trip with shots in it is
 * a trip.
 */
CsModel.isPlaceholderTrip = function(survey, index) {
    if (survey.trips === undefined || survey.trips === null ||
            survey.trips[index] === undefined) {
        return false;
    }
    if (CsModel.tripFingerprint(survey.trips[index]) !== "|") {
        return false;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        if ((survey.shots[i].trip || 0) === index) {
            return false;
        }
    }
    return true;
};

/**
 * Finds tripRecord's trip index within survey, matching by
 * fingerprint (see tripFingerprint) so re-importing the same trip
 * twice reuses one slot instead of piling up duplicates. Appends
 * tripRecord itself when no existing trip matches. Always calls
 * ensureTrips first, so this is safe to call on a survey that has
 * never seen a trip before.
 *
 * A match takes the incoming record's declination
 * (absorbDeclination) -- since declination left the fingerprint, two
 * blocks one date and team apart but a declination apart land here as
 * ONE trip, and each shot's own recorded declination is what keeps
 * that merge lossless.
 *
 * No match OCCUPIES a placeholder trip 0 (isPlaceholderTrip) rather
 * than appending past it. ensureTrips has to invent trips[0] out of the
 * top-level fields before anything can ask this question, and on a
 * survey with no metadata and no shots -- an empty drawing about to
 * receive its first typed page -- that invention is blank. Appending
 * past it left such drawings numbered from 1 with no trip 0 at all,
 * which reads as arbitrary to a user and leaves the drawing-level tags
 * (the Declination mirror, ExcludedShots/UnplacedShots, the adjustment
 * record) with no trip-0 anchor to live on.
 */
CsModel.tripIdFor = function(survey, tripRecord) {
    CsModel.ensureTrips(survey);
    var fp = CsModel.tripFingerprint(tripRecord);
    for (var i = 0; i < survey.trips.length; i++) {
        if (CsModel.tripFingerprint(survey.trips[i]) === fp) {
            CsModel.absorbDeclination(survey, i, tripRecord);
            return i;
        }
    }
    if (CsModel.isPlaceholderTrip(survey, 0)) {
        survey.trips[0] = tripRecord;
        // trips[0] is the authority over the top-level mirror fields
        // (see ensureTrips' WARNING), and the mirror currently
        // describes the placeholder we just replaced -- re-mirror or
        // survey.date/team/declination keep reporting the empty slot.
        CsModel.ensureTrips(survey);
        return 0;
    }
    survey.trips.push(tripRecord);
    return survey.trips.length - 1;
};

/**
 * The LRUD recorded for a station, taken from the last non-splay shot
 * arriving at it (LRUD belongs to the TO station). Returns
 * {left, right, up, down, azimuth} or null if the station has none.
 * A survey's very first station can only get LRUD from a shot LEAVING
 * it, which callers handle explicitly.
 */
CsModel.lrudForStation = function(survey, stationName) {
    var found = null;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll || s.splay) {
            continue;
        }
        // "has evidence" has to include the Open flags, not just the
        // numeric sides -- a shot recorded "P P P P" (checked every
        // direction, found the passage open all around) is a real
        // reading and must not lose out to a stale earlier shot just
        // because none of its four sides is a number.
        if (s.to === stationName &&
            (s.left !== null || s.right !== null || s.up !== null || s.down !== null ||
             s.leftOpen || s.rightOpen || s.upOpen || s.downOpen)) {
            found = {
                left: s.left, right: s.right, up: s.up, down: s.down,
                leftAll: s.leftAll, rightAll: s.rightAll,
                upAll: s.upAll, downAll: s.downAll,
                leftOpen: !!s.leftOpen, rightOpen: !!s.rightOpen,
                upOpen: !!s.upOpen, downOpen: !!s.downOpen,
                // THE BEARING THE TAPES WERE PULLED ACROSS, or null
                // when there wasn't one. L and R are perpendicular to
                // the way the caver was facing, and on a pitch the
                // caver was facing nothing in particular: the shot has
                // no sighted bearing at all (`azimuthOmitted`), or it
                // has a number written in the compass column that is
                // a near-vertical sight and so is noise
                // (`CsTraverse.isPlumb`). Handing either on as though
                // it aimed the tapes puts both wall points at right
                // angles to an invention. Consumers take `null` to
                // mean "ask the passage instead" -- see
                // CsLrud.passageAzimuthAt and CsLrud.tickEnd, neither
                // of which will draw a wall in a direction nobody
                // sighted.
                azimuth: (s.azimuthOmitted || CsTraverse.isPlumb(s)) ?
                    null : s.azimuth
            };
        }
    }
    return found;
};

/** Every distinct station name, in first-appearance order. */
CsModel.stationNames = function(survey) {
    var seen = {};
    var names = [];
    var add = function(n) {
        if (n !== "" && !seen.hasOwnProperty(n)) {
            seen[n] = true;
            names.push(n);
        }
    };
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if (s.excludeFromAll) {
            continue;
        }
        add(s.from);
        if (!s.splay) {
            add(s.to);
        }
    }
    return names;
};

/**
 * Guesses the next station name from the previous one by incrementing
 * a trailing number ("A1" -> "A2", "A09" -> "A10", zero padding
 * preserved). "A1" from nothing; "<name>1" if there's no number.
 */
CsModel.nextStationName = function(prevName) {
    if (prevName === undefined || prevName === null || prevName === "") {
        return "A1";
    }
    var m = String(prevName).match(/^(.*?)(\d+)$/);
    if (m === null) {
        return prevName + "1";
    }
    var incremented = String(parseInt(m[2], 10) + 1);
    while (incremented.length < m[2].length) {
        incremented = "0" + incremented;
    }
    return m[1] + incremented;
};

/**
 * Parses one LRUD cell the way survey notes are written:
 *   "3.5"   one reading
 *   "0"     the station is ON the wall -- a real measurement, distinct
 *           from "P" below even though both are written short
 *   "P"     open passage -- no wall that way at all; NOT the same as
 *           "0" (wall at the station) and NOT the same as a blank
 *           cell (nobody looked). Returns value:null like a blank
 *           does -- so any caller that has not been taught about
 *           `open` degrades safely to "nothing measured" -- but sets
 *           `open` true so a caller that HAS been taught can tell the
 *           two apart.
 *   "5/P"   a ledge measured at 5, with the passage open beyond it --
 *           no true outer wall. `value` is the ledge (5, still a real
 *           measurement to draw), `open` is true (nothing closes past
 *           it). "P" contributes no number of its own either way.
 *   "5/10"  multiple readings (ledge + outer wall): ALL are drawn;
 *           the LARGEST is the primary value -- the outer wall is
 *           what wall runs, stats and native-format exports use
 *   ""      not measured
 *
 * \return { value: Number|null primary, all: [Number]|null every
 *          reading when more than one, raw: String as entered,
 *          open: Boolean true when any "P" was present }
 */
CsModel.parseLrudEntry = function(text) {
    var raw = (text === undefined || text === null) ? "" :
        String(text).replace(/^\s+|\s+$/g, "");
    if (raw === "" || raw === "--") {
        return { value: null, all: null, raw: raw, open: false };
    }
    var parts = raw.split("/");
    var values = [];
    var open = false;
    for (var i = 0; i < parts.length; i++) {
        var pTrim = parts[i].replace(/^\s+|\s+$/g, "");
        if (pTrim === "") {
            continue;
        }
        if (/^[Pp]$/.test(pTrim)) {
            // Open passage carries no length of its own -- it is a
            // FLAG, not a value of 0 (see this function's docblock:
            // that conflation is the whole defect being fixed here).
            open = true;
            continue;
        }
        var n = parseFloat(pTrim);
        if (!isNaN(n)) {
            values.push(n);
        }
    }
    if (values.length === 0) {
        return { value: null, all: null, raw: raw, open: open };
    }
    var primary = values[0];
    for (i = 1; i < values.length; i++) {
        if (values[i] > primary) {
            primary = values[i];
        }
    }
    return {
        value: primary,
        all: values.length > 1 ? values : null,
        raw: raw,
        open: open
    };
};

/**
 * The cell text for a stored LRUD field ("5/10" round-trips, and so
 * does "P" / "5/P" -- `open` re-appends the "P" a caller's `all`/
 * `value` can no longer carry on their own now that it is not folded
 * into a fake 0).
 */
CsModel.lrudEntryText = function(value, all, open) {
    var numText;
    if (all !== null && all !== undefined && all.length > 1) {
        numText = all.join("/");
    } else {
        numText = (value === null || value === undefined) ? "" : String(value);
    }
    if (!open) {
        return numText;
    }
    return (numText === "") ? "P" : (numText + "/P");
};

// ---------------------------------------------------------------------
// Text serialization -- turns Shot/startLrud fields into compact
// strings and back, so they can be carried as DXF XDATA tag values
// (one tag value per shot, one shot per drawn segment) without QCAD
// ever needing to know the survey model shape. Tabs are the field
// separator used here, so they ARE stripped from free text below.
//
// The note field additionally escapes '\' and real newlines (see
// shotRowText/parseShotRow) so a single row stands on its own even
// when several rows get "\n"-joined into one multi-row blob (the
// ExcludedShots/UnplacedShots rows in CsDraw.js): without that, a
// note's own newline would be indistinguishable from the blob's row
// separator. That blob then goes through CsTags.set's OWN blob-level
// escaping (CsTags.js) as an outer layer, which is where this needs
// care: CsTags.set/get chain plain regex replaces rather than a real
// escaping state machine, so it is only a correct round-trip when the
// text it receives contains no backslash sequence that collides with
// its own escape target. This layer's marker is chosen accordingly
// (capital 'N' for newline, not 'n' -- see shotRowText) so nothing it
// writes can ever collide with CsTags' pass, and the two layers
// compose safely in practice, verified by the "multi-line note" unit
// test rather than assumed.
//
// Trip is deliberately NOT one of the row fields (see shotRowText):
// trip membership is context the row's CARRIER supplies, not
// something every row needs to repeat. A leg line's own tags already
// say which trip it belongs to; the ExcludedShots/UnplacedShots rows
// that live on the trip-0 anchor are stored PREFIXED with
// "tripId\t" ahead of the row text ("tripId\t" + shotRowText(shot)),
// one such prefixed line per shot, so a single row stays reusable in
// a plain single-trip context (no trip to prefix, nothing to strip)
// while still reconstructing correctly in a multi-trip drawing.
//
// Field order below is a load-bearing invariant: new fields APPEND at
// the end, never insert in the middle. parseShotRow reads positional
// fields, so inserting would shift every field after it and silently
// misread rows written by an older build; only appending keeps old
// rows parsing correctly forever. Appending past the note, which used
// to be the last field and is read greedily, works by field COUNT --
// see shotRowText.
// ---------------------------------------------------------------------

/**
 * The exclusion/hold flags as a compact letter code. The first four
 * letters are the same vocabulary Compass uses in "#|PCL#" flag
 * blocks: P excludeFromPlot, X excludeFromAll, L excludeFromLength,
 * C noAdjust. S (shot.splay) is this Core's own addition, appended
 * last -- Compass has no such letter. It exists only for SERIALIZED
 * rows (ExcludedShots/UnplacedShots): a splay drawn as an entity
 * already says so implicitly via its "Splay" tag key, but a row has
 * no such key, so without S an excluded splay would be indistinguishable
 * from an excluded leg once it's off the network. Letter order is
 * fixed on write but parseFlags reads them in any order.
 */
CsModel.flagsText = function(shot) {
    return (shot.excludeFromPlot ? "P" : "") +
        (shot.excludeFromAll ? "X" : "") +
        (shot.excludeFromLength ? "L" : "") +
        (shot.noAdjust ? "C" : "") +
        (shot.splay ? "S" : "");
};

/**
 * Reads a flagsText code back into shot's five booleans (order does
 * not matter, unknown letters are ignored, "" or null means all
 * false). Mutates shot in place and returns it, matching parseFlags'
 * cousins elsewhere in the Core (e.g. parseLrudEntry's callers).
 */
/**
 * The elevation of a fixed station, or null when it does not have one.
 *
 * EIGHTH DOOR in the elevation-datum-trap family (see CsTraverse.offset
 * and CsNetwork.seedFixed for the first seven). Every format writer
 * used to print `(f.z || 0).toFixed(2)`, which cannot tell a station
 * fixed AT elevation 0 from a station whose elevation is unknown --
 * and CsTags.surveyFromDocument hands back a real null for a station
 * with no (or a garbled) Elevation tag, so the second case is reachable
 * from any drawing. The exported file then carried 0.00 as though it
 * were surveyed: a cave on a 1200 m datum re-exported onto sea level,
 * silently, in a file another program will trust.
 *
 * A real 0 is a real elevation and survives untouched. Only absent or
 * non-finite z answers null -- the same "cannot function as part of a
 * real measurement" line CsTraverse.unusable draws. Lives here rather
 * than in CsTraverse because the format writers must not depend on the
 * traverse engine: several test harnesses load Format/ without it.
 */
CsModel.fixedZ = function(f) {
    if (f === null || f === undefined) {
        return null;
    }
    var z = f.z;
    if (z === null || z === undefined || typeof z !== "number" ||
        !isFinite(z)) {
        return null;
    }
    return z;
};

CsModel.parseFlags = function(text, shot) {
    var t = text || "";
    shot.excludeFromPlot = t.indexOf("P") >= 0;
    shot.excludeFromAll = t.indexOf("X") >= 0;
    shot.excludeFromLength = t.indexOf("L") >= 0;
    shot.noAdjust = t.indexOf("C") >= 0;
    shot.splay = t.indexOf("S") >= 0;
    return shot;
};

/**
 * One shot as a tab-separated row: from, to, distance, azimuth,
 * inclination, backAzimuth, backInclination, L, R, U, D, flags, note,
 * declination -- in that fixed order. Numeric fields that are null
 * (the backsight pair and the declination) write as "". LRUD fields
 * go through the existing lrudEntryText so "5/10" multi-readings keep
 * round-tripping the same way they do everywhere else in the Core.
 * Any tab the note contains is flattened to a space on the way out
 * (tabs are the separator here), and parseShotRow reads every field
 * from 12 up to the declination back into it so a note that somehow
 * still contains a tab doesn't get truncated.
 * After the tab swap the note is further escaped ('\' -> '\\', real
 * newline -> the two literal characters '\' 'N') so the row is
 * self-contained -- see the block comment above this section for why.
 * parseShotRow reverses both steps in the opposite order.
 *
 * The newline marker deliberately uses capital 'N', NOT lowercase 'n':
 * this row text gets embedded in a "\n"-joined multi-row blob that
 * CsTags.set ALSO escapes (its own '\' -> '\\', newline -> '\' 'n'
 * pass, see CsTags.js), and that outer pass doubles every backslash
 * blindly, including ones already written here. A lowercase 'n'
 * marker collides with CsTags' own escape target: once doubled, the
 * outer unescape's naive left-to-right "\n" scan pairs one backslash
 * with the 'n' and strands the other as a bare backslash beside a
 * spurious real newline -- verified to corrupt the row split (see the
 * "multi-line note" unit test). Capital 'N' can never match CsTags'
 * lowercase-only pattern, so this layer's escaping survives the outer
 * pass completely untouched and round-trips correctly.
 *
 * shot.trip is NOT a field here -- see the block comment above this
 * section for why (it's context the row's carrier supplies). Field
 * order is otherwise load-bearing: append new fields at the end,
 * never insert, or old rows parse wrong.
 *
 * The declination (field 13) is appended AFTER the note, honouring
 * that invariant, and the note's greedy read accounts for it: a row
 * this build writes always has exactly 14 fields, because the note
 * never contains a tab (they are flattened above) and a null
 * declination still writes its empty field. So more than 13 fields
 * means the LAST one is the declination; 13 or fewer is a row from an
 * older build, with no declination and the note greedy to the end.
 */
CsModel.shotRowText = function(shot) {
    var numText = function(v) {
        return (v === null || v === undefined) ? "" : String(v);
    };
    var note = (shot.notes || "").replace(/\t/g, " ")
        .replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\N");
    return [
        shot.from,
        shot.to,
        numText(shot.distance),
        numText(shot.azimuth),
        numText(shot.inclination),
        numText(shot.backAzimuth),
        numText(shot.backInclination),
        CsModel.lrudEntryText(shot.left, shot.leftAll, shot.leftOpen),
        CsModel.lrudEntryText(shot.right, shot.rightAll, shot.rightOpen),
        CsModel.lrudEntryText(shot.up, shot.upAll, shot.upOpen),
        CsModel.lrudEntryText(shot.down, shot.downAll, shot.downOpen),
        CsModel.flagsText(shot),
        note,
        numText(shot.declination)
    ].join("\t");
};

/** The inverse of shotRowText -- see that function for the layout. */
CsModel.parseShotRow = function(text) {
    var f = (text || "").split("\t");
    var shot = CsModel.newShot();
    // Distance/azimuth/inclination are never null in the model (a
    // shot always has SOME geometry), so an empty or unparseable
    // field falls back to 0.0 rather than null; the backsight pair
    // genuinely can be absent, so theirs falls back to null.
    var num = function(v, fallback) {
        if (v === undefined || v === "") {
            return fallback;
        }
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    };
    shot.from = f[0] || "";
    shot.to = f[1] || "";
    shot.distance = num(f[2], 0.0);
    shot.azimuth = num(f[3], 0.0);
    shot.inclination = num(f[4], 0.0);
    shot.backAzimuth = num(f[5], null);
    shot.backInclination = num(f[6], null);
    var sides = [["left", 7], ["right", 8], ["up", 9], ["down", 10]];
    for (var i = 0; i < sides.length; i++) {
        var e = CsModel.parseLrudEntry(f[sides[i][1]] || "");
        shot[sides[i][0]] = e.value;
        shot[sides[i][0] + "All"] = e.all;
        shot[sides[i][0] + "Open"] = e.open;
    }
    CsModel.parseFlags(f[11] || "", shot);
    // The note runs from field 12 to the last field the declination
    // does not claim: a row this build wrote has 14 fields with the
    // declination last (see shotRowText), a shorter one predates the
    // field and has no declination to read.
    var noteEnd = f.length;
    if (f.length > 13) {
        noteEnd = f.length - 1;
        shot.declination = num(f[f.length - 1], null);
    }
    // Reverse shotRowText's note escaping, in the opposite order it
    // was applied: unescape the '\' 'N' newline marker first, THEN
    // undo the backslash doubling (see shotRowText for why the marker
    // is capital 'N', not 'n' -- lowercase would collide with
    // CsTags.set's own escaping one layer up).
    shot.notes = f.slice(12, noteEnd).join("\t")
        .replace(/\\N/g, "\n").replace(/\\\\/g, "\\");
    return shot;
};

/**
 * A survey's or trip's startLrud as one comma-joined cell:
 * "L,R,U,D", each side through lrudEntryText so multi-readings keep
 * their "5/10" form, EXCEPT a null side writes "-" rather than ""
 * (an empty cell would be ambiguous with a merely-missing trailing
 * field on parse; "-" can't collide with a real reading because a
 * legitimate 0 always renders as the digit "0", never as "-"). A
 * null/undefined lrud -- no start station recorded at all -- writes
 * as "".
 */
CsModel.startLrudText = function(lrud) {
    if (lrud === null || lrud === undefined) {
        return "";
    }
    var side = function(value, all, open) {
        // "-" means "not measured"; a side that is null but Open (a
        // "P") is NOT that -- it is a real recorded reading, and
        // lrudEntryText already renders it as "P", which can never
        // collide with "-" or with a real 0 (see this function's own
        // docblock).
        if ((value === null || value === undefined) && !open) {
            return "-";
        }
        return CsModel.lrudEntryText(value, all, open);
    };
    return [
        side(lrud.left, lrud.leftAll, lrud.leftOpen),
        side(lrud.right, lrud.rightAll, lrud.rightOpen),
        side(lrud.up, lrud.upAll, lrud.upOpen),
        side(lrud.down, lrud.downAll, lrud.downOpen)
    ].join(",");
};

/** The inverse of startLrudText -- see that function for the layout. */
CsModel.parseStartLrud = function(text) {
    if (text === "" || text === null || text === undefined) {
        return null;
    }
    var f = text.split(",");
    var out = {
        left: null, right: null, up: null, down: null,
        leftAll: null, rightAll: null, upAll: null, downAll: null,
        leftOpen: false, rightOpen: false, upOpen: false, downOpen: false
    };
    var names = ["left", "right", "up", "down"];
    for (var i = 0; i < names.length; i++) {
        if (f[i] === undefined || f[i] === "-") {
            continue;
        }
        var e = CsModel.parseLrudEntry(f[i]);
        out[names[i]] = e.value;
        out[names[i] + "All"] = e.all;
        out[names[i] + "Open"] = e.open;
    }
    return out;
};
