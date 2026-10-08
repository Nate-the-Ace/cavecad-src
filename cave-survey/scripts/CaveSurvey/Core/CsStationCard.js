// CsStationCard.js -- everything worth saying about one station.
//
// Part of the Cave Survey Core library: pure ECMAScript, no document,
// no GUI, no network, so the headless harness exercises all of it.
//
// A caver clicks a station in the 3D view and wants its numbers. Most
// of them are already computed for one colour mode or another and have
// nowhere to appear: a mode paints the whole cave by one fact at a
// time, and a station is the place where all of them meet.
//
// THE VIEW NEVER COMPUTES A ROW. RCave3dCard is handed finished
// strings, exactly as RCave3dLegend is, so every unit conversion,
// every trip name and every date format stays on this side of the
// bridge. A renderer that formatted a foot would be a second place
// that knows what a foot is.
//
// A MISSING FACT IS A MISSING ROW. An empty value beside a label reads
// as a measurement of nothing, which is not what an unadjusted survey
// or an unmeasured ceiling means.
//
// NO COORDINATES, EVER. Not latitude, not longitude, not the drawing
// point. This card is the obvious place someone would add them, and a
// cave's location does not leave the cave -- the same rule that keeps
// GeoLat/GeoLon out of a sanitized package. A test asserts it.
//
// The 'Cs' prefix is mandatory: CaveCAD's include() dedupes by
// basename, and the global must match the file name.

include(includeBasePath + "/CsMesh3d.js");
include(includeBasePath + "/CsLrud.js");

var CsStationCard = {};

/** A length as a caver would say it: one decimal, unit attached. */
CsStationCard.length = function(value, unit) {
    if (typeof value !== "number" || !isFinite(value)) {
        return null;
    }
    var u = (unit === "m") ? "m" : "ft";
    return (Math.round(value * 10) / 10) + " " + u;
};

/**
 * The four LRUD readings on one line, in the order everybody writes
 * them, with an unmeasured one as a dash rather than a zero. A zero
 * left wall is a wall against your shoulder; a missing one is nobody
 * having looked.
 */
CsStationCard.lrudText = function(lr, unit) {
    var u = (unit === "m") ? "m" : "ft";
    var one = function(v) {
        if (typeof v !== "number" || !isFinite(v)) {
            return "--";
        }
        return String(Math.round(v * 10) / 10);
    };
    // typeof FIRST. isFinite(null) is true -- null converts to 0 -- so
    // a station with no LRUD at all would answer "0 / 0 / 0 / 0",
    // which is a passage the width of a wire.
    var has = function(v) {
        return typeof v === "number" && isFinite(v);
    };
    if (!has(lr.left) && !has(lr.right) && !has(lr.up) && !has(lr.down)) {
        return null;
    }
    return one(lr.left) + " / " + one(lr.right) + " / " +
           one(lr.up) + " / " + one(lr.down) + "  " + u;
};

/**
 * The card for one station.
 *
 * \param survey   a Survey (CsModel)
 * \param resolved CsNetwork.resolve(survey)
 * \param name     the station clicked
 * \param opts     {unit:         "ft" | "m",
 *                  cover:        depth of cover in drawing units, or
 *                                null -- from CsCover.atStations,
 *                  ground:       ground elevation over it, in the
 *                                SURVEY's frame, or null,
 *                  datumOffset:  CsElevation offset in drawing units,
 *                                or null when the cave has no datum
 *                                anchor -- null means UNKNOWN, and the
 *                                absolute row is simply absent. A
 *                                caller substituting 0 here rebases
 *                                the cave to sea level,
 *                  anchorName:   what "distance in" measures from,
 *                  distances:    CsMesh3d.distancesFrom(...) if the
 *                                caller already has it}
 *
 * \return {title, rows: [[label, value], ...]} -- or null when there
 *         is no such resolved station.
 */
CsStationCard.build = function(survey, resolved, name, opts) {
    opts = opts || {};
    if (survey === null || survey === undefined ||
            resolved === null || resolved === undefined) {
        return null;
    }
    var st = resolved.stations ? resolved.stations[name] : undefined;
    if (st === undefined || st === null) {
        return null;
    }
    var unit = (opts.unit === "m") ? "m" : "ft";
    var rows = [];
    var push = function(label, value) {
        if (value === null || value === undefined || value === "") {
            return;
        }
        rows.push([label, String(value)]);
    };

    // --- who surveyed it ---
    var trip = CsMesh3d.tripAt(name, survey);
    push("Trip", CsMesh3d.tripLabel(survey, trip));
    var tripRec = (survey.trips || [])[trip];
    if (tripRec !== undefined && tripRec !== null &&
            typeof tripRec.date === "string" && tripRec.date !== "") {
        // Only when the label does not already carry it: tripLabel
        // falls back to the date for an unnamed trip, and a card
        // saying the same date twice reads as two facts.
        if (String(CsMesh3d.tripLabel(survey, trip)).indexOf(tripRec.date) < 0) {
            push("Date", tripRec.date);
        }
    }

    // --- where it sits ---
    push("Elevation", CsStationCard.length(st.z, unit));
    if (typeof opts.datumOffset === "number" && isFinite(opts.datumOffset)) {
        push("Elevation, absolute",
             CsStationCard.length(st.z + opts.datumOffset, unit));
    }

    // --- the rock over it ---
    //
    // THE GROUND ELEVATION COMES WITH IT. A cover figure alone cannot
    // be checked; the surface elevation it was taken from can be read
    // off a topo map in a second, and a wrong datum shows up here
    // before it shows up as a colour.
    var cover = opts.cover;
    if (typeof cover === "number" && isFinite(cover)) {
        push("Depth of cover", CsStationCard.length(cover, unit));
        if (cover < 0) {
            push("", "this station sits above the modelled ground");
        }
    }
    if (typeof opts.ground === "number" && isFinite(opts.ground)) {
        // IN THE SAME FRAME AS THE ELEVATION ABOVE IT. The ground
        // arrives in the survey's own vertical frame, which on a cave
        // whose datum IS known sits beside an absolute elevation and
        // reads as a second, contradictory answer. With the offset the
        // row becomes a real-world elevation a reader can check
        // against a topo map, which is the only reason it is here.
        if (typeof opts.datumOffset === "number" &&
                isFinite(opts.datumOffset)) {
            push("Surface elevation",
                 CsStationCard.length(opts.ground + opts.datumOffset, unit));
        } else {
            push("Surface above", CsStationCard.length(opts.ground, unit));
        }
    }

    // --- how far in ---
    var distances = opts.distances;
    if (distances === undefined || distances === null) {
        distances = CsMesh3d.distancesFrom(opts.anchorName, resolved);
    }
    push("Distance in", CsStationCard.length(distances[name], unit));

    // --- the passage there ---
    push("L / R / U / D",
         CsStationCard.lrudText(CsMesh3d.lrudAt(name, survey), unit));
    var splays = CsLrud.splaysByStation(survey);
    var n = (splays[name] || []).length;
    if (n > 0) {
        push("Splays", String(n));
    }

    // --- what the adjustment did to it ---
    //
    // Absent on an unadjusted survey rather than shown as zero: "did
    // not move" and "was never adjusted" are different answers and
    // only one of them is about the survey's quality.
    var shifts = resolved.shifts;
    if (shifts !== undefined && shifts !== null &&
            shifts.hasOwnProperty(name) && shifts[name] !== null &&
            shifts[name] !== undefined &&
            isFinite(shifts[name].distance)) {
        push("Closure shift",
             CsStationCard.length(shifts[name].distance, unit));
    }

    return { title: String(name), rows: rows };
};
