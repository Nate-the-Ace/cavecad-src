// CsShelf.js -- the caves this machine knows about.
//
// Part of the Cave Survey Core library. Split like CsCave: a pure half
// (the record shape, the JSON, and the ranking that decides which file
// in a folder is THE drawing) that tests/js_unit.js runs under node,
// and a runtime half that touches RSettings and QDir.
//
// WHY A REGISTRY AND NOT A SCAN. The obvious design walks the Google
// Drive folder looking for caves. It was rejected on purpose: Drive for
// Desktop streams placeholders, so a recursive walk stats network-backed
// files and the launcher opens slowly on exactly the machine that has
// the most caves. Worse, the folder layouts in the wild disagree --
// caves sit at the top of My Drive, inside a project folder (BIG Survey
// Group), or with the drawing buried one deeper in a CARTO subfolder --
// so a scanner is guessing anyway.
//
// So the shelf is an explicit list, kept in the setting CaveSurvey/Caves.
// Adding a cave scans ONE folder, two levels deep, which is cheap and
// certain. Saving a drawing under a drive root registers it silently.
// The cost, accepted with open eyes: a cave a teammate adds to the shared
// folder does not appear here until somebody adds it.
//
// A record is {name, folder, drawing}: the cave as people say it, the
// folder that is the cave project, and the plan drawing inside it. The
// drawing may be a DWG -- CaveCAD cannot open one, and the launcher says
// so rather than pretending the cave is not there.

var CsShelf = {};

CsShelf.SETTING = "CaveSurvey/Caves";

// How deep addCave looks for the drawing: the cave folder itself, then
// one level of subfolders (STUDABAKER CAVE/STUDABAKER CARTO/...).
CsShelf.SCAN_DEPTH = 2;

// ---------------------------------------------------------------------
// Pure half -- no Q* or R* globals.
// ---------------------------------------------------------------------

CsShelf.newRecord = function() {
    return { name: "", folder: "", drawing: "" };
};

/** Trims, and turns anything unusable into "". */
CsShelf.clean = function(value) {
    if (value === undefined || value === null) { return ""; }
    return String(value).replace(/^\s+|\s+$/g, "").replace(/\/+$/, "");
};

/**
 * A record with the fields it must have, or null. A record with no
 * folder is meaningless -- the folder IS the cave -- so that is the one
 * field whose absence rejects the whole record. A missing name falls
 * back to the folder's own basename, which is what the convention says
 * the cave is called anyway.
 */
CsShelf.normalize = function(record) {
    if (record === undefined || record === null ||
            typeof record !== "object") {
        return null;
    }
    var folder = CsShelf.clean(record.folder);
    if (folder === "") { return null; }

    var name = CsShelf.clean(record.name);
    if (name === "") { name = CsShelf.basename(folder); }

    return {
        name: name,
        folder: folder,
        drawing: CsShelf.clean(record.drawing),
        favorite: record.favorite === true
    };
};

/** The last path component, forward slashes only (Qt reports those). */
CsShelf.basename = function(path) {
    var p = CsShelf.clean(path);
    if (p === "") { return ""; }
    var slash = p.lastIndexOf("/");
    return slash === -1 ? p : p.substring(slash + 1);
};

/** The file name without its extension. */
CsShelf.stem = function(path) {
    var base = CsShelf.basename(path);
    var dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
};

/** Lower-cased extension without the dot ("dxf"), or "". */
CsShelf.extension = function(path) {
    var base = CsShelf.basename(path);
    var dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.substring(dot + 1).toLowerCase();
};

/**
 * Two folder paths meaning the same cave. Trailing slashes and case
 * differ harmlessly on the platforms this add-on targets (macOS and
 * Windows are both case-insensitive; a Linux user who keeps two cave
 * folders differing only in case has bigger problems).
 */
CsShelf.sameFolder = function(a, b) {
    var x = CsShelf.clean(a).toLowerCase();
    var y = CsShelf.clean(b).toLowerCase();
    return x !== "" && x === y;
};

/** Names that are never the cave's plan drawing. */
CsShelf.isRejectedDrawing = function(path) {
    var base = CsShelf.basename(path).toLowerCase();
    if (base === "") { return true; }
    // The legacy sibling elevation, back when the profile was its own
    // file; the elevation is a region of the plan drawing now.
    if (/-?profile\./.test(base)) { return true; }
    // Editor and backup leftovers.
    if (/(~|\.bak|\.orig|backup)/.test(base)) { return true; }
    // QCAD's own template stock, if somebody copied one in.
    if (/template/.test(base)) { return true; }
    return false;
};

/**
 * Which file in a cave folder is THE drawing.
 *
 * Ranked rather than matched, because the folder conventions in the wild
 * disagree and every rule here loses to a stronger one:
 *   a DXF beats a DWG                        CaveCAD can open the DXF
 *   a name matching the folder beats one that does not
 *   a name saying PLAN beats one that does not
 *   shallower beats deeper                   the drawing beside the
 *                                            folder outranks one in a
 *                                            CARTO subfolder
 *   otherwise, alphabetical, so the answer is stable
 *
 * \param paths     candidate file paths
 * \param folder    the cave folder they were found under
 * \return the winning path, or null when nothing qualifies.
 */
CsShelf.pickDrawing = function(paths, folder) {
    if (Object.prototype.toString.call(paths) !== "[object Array]") {
        return null;
    }
    var folderName = CsShelf.basename(folder).toLowerCase().replace(/[\s_-]/g, "");
    var best = null;
    var bestScore = null;

    for (var i = 0; i < paths.length; i++) {
        var path = CsShelf.clean(paths[i]);
        if (path === "") { continue; }
        var ext = CsShelf.extension(path);
        if (ext !== "dxf" && ext !== "dwg") { continue; }
        if (CsShelf.isRejectedDrawing(path)) { continue; }

        var stem = CsShelf.stem(path).toLowerCase().replace(/[\s_-]/g, "");
        var depth = path.split("/").length;

        var score = [
            ext === "dxf" ? 1 : 0,
            (folderName !== "" && stem.indexOf(folderName) !== -1) ? 1 : 0,
            /plan/.test(stem) ? 1 : 0,
            -depth
        ];

        if (bestScore === null || CsShelf.scoreBeats(score, bestScore) ||
                (CsShelf.scoreTies(score, bestScore) && path < best)) {
            best = path;
            bestScore = score;
        }
    }
    return best;
};

/** Lexicographic comparison of the ranking tuples above. */
CsShelf.scoreBeats = function(a, b) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return a[i] > b[i]; }
    }
    return false;
};

CsShelf.scoreTies = function(a, b) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
};

/**
 * Records to the string kept in settings.
 *
 * One JSON array in one key, rather than a QStringList: a list value in
 * a QSettings ini splits on commas, and cave folders contain commas
 * ("Smith, J. Cave" is a real naming style) often enough to lose data.
 */
CsShelf.serialize = function(records) {
    var clean = [];
    if (Object.prototype.toString.call(records) === "[object Array]") {
        for (var i = 0; i < records.length; i++) {
            var record = CsShelf.normalize(records[i]);
            if (record !== null) { clean.push(record); }
        }
    }
    return JSON.stringify(clean);
};

/**
 * The stored string back to records. Tolerant on purpose -- a settings
 * file people edit by hand, and a QSettings that hands back a list where
 * a string went in, both have to degrade to "no caves registered"
 * instead of breaking the launcher.
 */
CsShelf.parse = function(text) {
    var out = [];
    if (text === undefined || text === null) { return out; }

    var raw = text;
    if (Object.prototype.toString.call(raw) === "[object Array]") {
        raw = raw.join(",");
    }
    raw = String(raw);
    if (CsShelf.clean(raw) === "") { return out; }

    var parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return out;
    }
    if (Object.prototype.toString.call(parsed) !== "[object Array]") {
        return out;
    }
    for (var i = 0; i < parsed.length; i++) {
        var record = CsShelf.normalize(parsed[i]);
        if (record === null) { continue; }
        if (CsShelf.indexOfFolder(out, record.folder) !== -1) { continue; }
        out.push(record);
    }
    return out;
};

/** Index of the record for a folder, or -1. */
CsShelf.indexOfFolder = function(records, folder) {
    if (Object.prototype.toString.call(records) !== "[object Array]") {
        return -1;
    }
    for (var i = 0; i < records.length; i++) {
        if (records[i] !== null && records[i] !== undefined &&
                CsShelf.sameFolder(records[i].folder, folder)) {
            return i;
        }
    }
    return -1;
};

/**
 * Adds or updates a record in a list, in place, and returns the list.
 * Registering a cave twice is not an error -- it is what saving a
 * drawing into an already-registered folder does on every save -- so
 * the second registration refreshes the record instead of duplicating
 * it. A refresh never blanks a field: an update carrying no drawing
 * keeps the drawing already known.
 */
CsShelf.put = function(records, record) {
    var list = (Object.prototype.toString.call(records) === "[object Array]") ?
        records : [];
    var incoming = CsShelf.normalize(record);
    if (incoming === null) { return list; }

    var at = CsShelf.indexOfFolder(list, incoming.folder);
    if (at === -1) {
        list.push(incoming);
        return list;
    }
    var existing = list[at];
    list[at] = {
        name: incoming.name !== "" ? incoming.name : existing.name,
        folder: incoming.folder,
        drawing: incoming.drawing !== "" ? incoming.drawing : existing.drawing,
        // a refresh never unstars: unfavoriting is setFavorite's job
        favorite: incoming.favorite === true || existing.favorite === true
    };
    return list;
};

/** Removes the record for a folder, in place; true if one went. */
CsShelf.remove = function(records, folder) {
    var at = CsShelf.indexOfFolder(records, folder);
    if (at === -1) { return false; }
    records.splice(at, 1);
    return true;
};

/**
 * Records sorted the way the launcher lists them: favorites first,
 * by cave name within each group.
 */
CsShelf.sorted = function(records) {
    var list = [];
    if (Object.prototype.toString.call(records) === "[object Array]") {
        for (var i = 0; i < records.length; i++) { list.push(records[i]); }
    }
    list.sort(function(a, b) {
        var fa = a.favorite === true, fb = b.favorite === true;
        if (fa !== fb) { return fa ? -1 : 1; }
        var x = CsShelf.clean(a.name).toLowerCase();
        var y = CsShelf.clean(b.name).toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
    });
    return list;
};

// ---------------------------------------------------------------------
// Runtime half -- RSettings and QDir. Every function degrades to an
// empty answer rather than throwing: the launcher must open even when
// the shelf is unreadable.
// ---------------------------------------------------------------------

/** Every registered cave, name-sorted. */
CsShelf.list = function() {
    if (typeof RSettings === "undefined") { return []; }
    var raw = "";
    try {
        raw = RSettings.getStringValue(CsShelf.SETTING, "");
    } catch (e) {
        return [];
    }
    return CsShelf.sorted(CsShelf.parse(raw));
};

/** Writes the whole shelf back. */
CsShelf.save = function(records) {
    if (typeof RSettings === "undefined") { return false; }
    try {
        RSettings.setValue(CsShelf.SETTING, CsShelf.serialize(records));
        return true;
    } catch (e) {
        return false;
    }
};

/** Registers (or refreshes) one cave. */
CsShelf.register = function(record) {
    var list = CsShelf.list();
    CsShelf.put(list, record);
    return CsShelf.save(list);
};

/** Stars or unstars one cave. True if the record was found and saved. */
CsShelf.setFavorite = function(folder, on) {
    var list = CsShelf.list();
    var at = CsShelf.indexOfFolder(list, folder);
    if (at === -1) { return false; }
    list[at].favorite = on === true;
    return CsShelf.save(list);
};

/** Forgets one cave. The folder on disk is never touched. */
CsShelf.forget = function(folder) {
    var list = CsShelf.list();
    if (!CsShelf.remove(list, folder)) { return false; }
    return CsShelf.save(list);
};

/** The record for a folder, or null. */
CsShelf.find = function(folder) {
    var list = CsShelf.list();
    var at = CsShelf.indexOfFolder(list, folder);
    return at === -1 ? null : list[at];
};

/**
 * Drawing files in a cave folder: the folder itself, then one level of
 * subfolders. scans/ and PDF/ are skipped -- a DXF in either is not the
 * cave's map.
 */
CsShelf.drawingsIn = function(folder) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var root = CsShelf.clean(folder);
    if (root === "") { return out; }

    var filesIn = function(path) {
        var found = [];
        try {
            var dir = new QDir(path);
            if (!dir.exists()) { return found; }
            var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot,
                QDir.Name);
            for (var i = 0; i < names.length; i++) {
                var n = String(names[i]);
                var ext = CsShelf.extension(n);
                if (ext === "dxf" || ext === "dwg") {
                    found.push(path + "/" + n);
                }
            }
        } catch (e) {
        }
        return found;
    };

    out = out.concat(filesIn(root));

    try {
        var dir = new QDir(root);
        if (dir.exists()) {
            var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
            for (var i = 0; i < subs.length; i++) {
                var sub = String(subs[i]);
                var lower = sub.toLowerCase();
                if (lower === CsShelf.clean(CsCave.SCANS).toLowerCase() ||
                        lower === CsShelf.clean(CsCave.PDF).toLowerCase()) {
                    continue;
                }
                out = out.concat(filesIn(root + "/" + sub));
            }
        }
    } catch (e2) {
    }
    return out;
};

/**
 * Builds the record for a folder by looking inside it: the cave's name
 * is the folder's own name, the drawing is whichever file wins
 * pickDrawing. A folder with no drawing at all still yields a record --
 * a cave somebody registered before the first survey exists, and the
 * launcher shows it as having no drawing yet rather than refusing it.
 */
CsShelf.recordFor = function(folder) {
    var root = CsShelf.clean(folder);
    if (root === "") { return null; }
    var drawing = CsShelf.pickDrawing(CsShelf.drawingsIn(root), root);
    return CsShelf.normalize({
        name: CsShelf.basename(root),
        folder: root,
        drawing: drawing === null ? "" : drawing
    });
};

/**
 * Registers the cave a drawing was just saved into, so the shelf fills
 * itself from ordinary work instead of from the Import Cave button.
 *
 * Only under a drive root, matching CsCave.pointAtScans: a DXF saved to
 * the desktop is not a cave project, and a launcher that accumulated
 * every scratch drawing anybody ever saved would be useless within a
 * week.
 */
CsShelf.registerSaved = function(docPath) {
    if (typeof CsCave === "undefined") { return false; }
    var path = CsShelf.clean(docPath);
    if (path === "") { return false; }
    if (!CsCave.isUnderDrive(path, CsCave.driveRoots())) { return false; }

    var folder = CsCave.folderOf(path);
    if (folder === null) { return false; }

    return CsShelf.register({
        name: CsCave.nameOf(path),
        folder: folder,
        drawing: path
    });
};

// ---------------------------------------------------------------------
// What the shelf SAYS about a cave -- pure, so tests/js_unit.js can
// pin the wording and the thresholds without a document.
//
// The point of these is triage. A shelf that only lists caves is a
// worse file browser; a shelf that says WHICH cave needs attention,
// before anything is opened, is the thing a file browser cannot be.
// ---------------------------------------------------------------------

/**
 * The one-line survey health summary under the trip table.
 *
 * \param stats  a CsStats.compute result (or null)
 * \param grade  a CsGrade.compute result (or null)
 * \param unit   "ft" / "m"
 */
CsShelf.healthText = function(stats, grade, unit) {
    if (stats === null || stats === undefined) { return ""; }
    var parts = [];
    var u = (unit === undefined || unit === null) ? "" : unit;

    if (typeof stats.depth === "number" && stats.depth > 0) {
        parts.push("depth " + Math.round(stats.depth) + " " + u);
    }
    if (typeof stats.stationCount === "number") {
        parts.push(stats.stationCount + " station" +
            (stats.stationCount === 1 ? "" : "s"));
    }
    if (typeof stats.loopCount === "number" && stats.loopCount > 0) {
        parts.push(stats.loopCount + " loop" +
            (stats.loopCount === 1 ? "" : "s"));
    }
    if (grade !== null && grade !== undefined && grade.uis) {
        parts.push(grade.uis);
    }
    return parts.join("  ·  ");
};

/** The worst loop's closure as a percentage, or null when there are none. */
CsShelf.worstClosure = function(stats) {
    if (stats === null || stats === undefined ||
            stats.worstLoop === null || stats.worstLoop === undefined) {
        return null;
    }
    var percent = stats.worstLoop.percent;
    return (typeof percent === "number" && isFinite(percent)) ? percent : null;
};

/**
 * The chips shown beside a cave's name.
 *
 * Every one of these is a condition somebody would want to act on, and
 * every one is derived from what the drawing already records -- nothing
 * here is a preference or a guess. Warnings come first, because the
 * whole reason to look at a shelf is to find the cave that needs work.
 *
 * \param info {
 *   legacy          drawing predates tag schema v3
 *   unbound         count of linework strokes no trip owns
 *   openEndNoLrud   an open end with no wall measurements
 *   pdfs            how many maps are in PDF/
 *   geo             the drawing carries a georeference anchor
 *   elevation       an extended elevation has been drawn
 *   closure         worst loop closure, percent (null: no loops)
 *   closureWarnAt   the percentage that counts as too much
 *   driftedTrips    trips whose declination disagrees with IGRF
 *   errors          count of CsValidate findings of severity "error"
 * }
 * \return [{key, label, warn}]
 */
CsShelf.badges = function(info) {
    var i = (info === undefined || info === null) ? {} : info;
    var out = [];
    var add = function(key, label, warn) {
        out.push({ key: key, label: label, warn: warn === true });
    };

    if (typeof i.errors === "number" && i.errors > 0) {
        add("errors", i.errors + " survey error" + (i.errors === 1 ? "" : "s"),
            true);
    }
    if (typeof i.closure === "number" && typeof i.closureWarnAt === "number" &&
            i.closure > i.closureWarnAt) {
        add("closure", "closes " + (Math.round(i.closure * 10) / 10) + "%", true);
    }
    if (typeof i.driftedTrips === "number" && i.driftedTrips > 0) {
        add("declination", i.driftedTrips + " trip" +
            (i.driftedTrips === 1 ? "" : "s") + " off IGRF", true);
    }
    if (i.legacy === true) {
        add("legacy", "legacy tags", true);
    }
    if (typeof i.unbound === "number" && i.unbound > 0) {
        add("unbound", i.unbound + " stroke" + (i.unbound === 1 ? "" : "s") +
            " unbound", true);
    }
    if (i.openEndNoLrud === true) {
        add("lrud", "open end without LRUD", true);
    }

    if (i.geo === true) { add("geo", "georeferenced", false); }
    if (i.elevation === true) { add("elevation", "has elevation", false); }
    if (typeof i.pdfs === "number" && i.pdfs === 0) {
        add("nomap", "no map plotted", false);
    }
    return out;
};

/** The chips as one line of text. */
CsShelf.badgeLine = function(badges) {
    if (Object.prototype.toString.call(badges) !== "[object Array]" ||
            badges.length === 0) {
        return "";
    }
    var parts = [];
    for (var i = 0; i < badges.length; i++) {
        parts.push((badges[i].warn ? "⚠ " : "") + badges[i].label);
    }
    return parts.join("   ");
};

/**
 * Trips whose recorded declination disagrees with IGRF for their own
 * date at the cave's location.
 *
 * Half a degree is the threshold the notebook's own revision offer uses:
 * below that the difference is not worth a redraw, above it the drawing
 * is turned by an angle somebody can measure on the map.
 *
 * \param trips   [{id, date, declination}]
 * \param igrfFor function(dateText) -> declination degrees, or null
 * \return [{id, recorded, igrf, delta}]
 */
/**
 * "YYYY-MM-DD" to the {year, month, day} shape CsGeomag.decimalYear
 * wants -- NOT a JS Date, which that function reads as NaN and turns
 * silently into a declination of NaN, i.e. no comparison at all.
 *
 * \return {year, month, day}, or null when the text is not a date.
 */
CsShelf.dateParts = function(text) {
    if (typeof text !== "string") { return null; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(CsShelf.clean(text));
    if (m === null) { return null; }
    var month = parseInt(m[2], 10);
    var day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) { return null; }
    return { year: parseInt(m[1], 10), month: month, day: day };
};

/**
 * The declination out of a CsGeomag.declination result.
 *
 * That function answers an OBJECT ({declination, inclinationMag,
 * horizontalNt, totalNt, year}), not a number. Using the result
 * directly in arithmetic yields NaN, every comparison against it is
 * false, and a drift check built that way reports "nothing wrong"
 * forever -- which is precisely what it did until this existed.
 *
 * \return degrees east-positive, or null.
 */
CsShelf.declinationValue = function(result) {
    if (result === null || result === undefined) { return null; }
    if (typeof result === "number") {
        return isFinite(result) ? result : null;
    }
    var value = result.declination;
    return (typeof value === "number" && isFinite(value)) ? value : null;
};

/**
 * A trip's declination, as the shelf's own column says it.
 *
 * WHY THE COLUMN EXISTS (Nathan, 2026-09-15). Every one of Truitt
 * Cave's eleven trips records 0.0, which is this suite's DEFAULT for a
 * trip nobody has told rather than a measurement -- and nothing on
 * screen said so. A drawing carries on quietly being a magnetic survey
 * that calls itself true: the azimuths were never corrected, the sheet
 * can draw no magnetic north, and the map is out by however many
 * degrees the place is out by.
 *
 * So zero and missing both read "not set", in the column a caver looks
 * at before a trip. A real declination reads as a compass says it:
 * "3.2\u00b0 E", "1.4\u00b0 W".
 *
 * \return the cell's text, never empty.
 */
/**
 * The first and last station of one trip, in the order it was surveyed.
 *
 * FOR REFERENCE, which is exactly what a caver wants from a trip list:
 * where that day's survey tied in, and where it stopped. Neither is the
 * same as the "Ends at" column, which lists the trip's OPEN ends -- a
 * trip can finish at a station it tied back into, leaving no open end
 * at all, and it still started and ended somewhere.
 *
 * LEGS ONLY. A splay is a measurement of the passage wall, not a step
 * along the survey, and a trip whose first record happens to be a splay
 * off the tie-in station did not "start" at that wall. CsFrontier.isLeg
 * is the suite's own definition and is reused rather than restated.
 *
 * FILE ORDER IS SURVEY ORDER. Shots are stored in the order they were
 * read from the notebook, which is the order they were walked; nothing
 * is sorted here, because any sort would be inventing an order the cave
 * does not have.
 *
 * \param shots  a survey's shots
 * \param tripId which trip
 * \return {start, end} -- "" for a trip with no legs in it yet
 */
CsShelf.tripSpan = function(shots, tripId) {
    var out = { start: "", end: "" };
    if (Object.prototype.toString.call(shots) !== "[object Array]") {
        return out;
    }
    var wanted = (typeof tripId === "number") ? tripId : 0;
    for (var i = 0; i < shots.length; i++) {
        var shot = shots[i];
        if (shot === null || shot === undefined) {
            continue;
        }
        var id = (typeof shot.trip === "number") ? shot.trip : 0;
        if (id !== wanted) {
            continue;
        }
        var leg = (typeof CsFrontier !== "undefined" &&
            typeof CsFrontier.isLeg === "function") ?
            CsFrontier.isLeg(shot) :
            (CsShelf.clean(shot.from) !== "" && CsShelf.clean(shot.to) !== "");
        if (!leg) {
            continue;
        }
        if (out.start === "") {
            out.start = CsShelf.clean(shot.from);
        }
        out.end = CsShelf.clean(shot.to);
    }
    return out;
};

/**
 * Where an edit typed into the shelf's trip table should land.
 *
 * THE OPEN TAB WINS, ALWAYS. A cave open in the application is the
 * authority on its own contents: writing its file behind it would be
 * overwritten by the caver's next save, and the tab would sit there
 * showing the old trip list with no sign anything had happened. So an
 * open cave is edited THROUGH its own document -- one undo step, the
 * tab true, the caver saving when they are ready.
 *
 * A cave that is NOT open is edited IN THE FILE: imported, changed,
 * written back. That was not always safe. Until 2026-09-15 a DXF round
 * trip through this build lost a layer's OFF state -- measured: off
 * went in, on came out, while FROZEN and LOCKED survived -- because the
 * exporter negated the layer colour to mean "off" and dxflib negated it
 * again, and the importer folded off into frozen on the way back. Both
 * are fixed in the application itself (RDxfExporter::writeLayer,
 * RDxfImporter::addLayer), and the round trip is now exact on a real
 * cave: 1953 entities, 72 blocks, 46 images, 153 layers, 171 tagged
 * entities, 11 trips, all identical.
 *
 * \param path     the cave's drawing
 * \param openDocs [{path, modified}] -- the open tabs
 * \return {mode: "live", at: <index into openDocs>} or {mode: "file"}
 */
CsShelf.editTarget = function(path, openDocs) {
    var want = CsShelf.clean(path);
    var docs = (Object.prototype.toString.call(openDocs) ===
        "[object Array]") ? openDocs : [];
    if (want !== "") {
        for (var i = 0; i < docs.length; i++) {
            if (docs[i] === null || docs[i] === undefined) {
                continue;
            }
            if (CsShelf.clean(docs[i].path) === want) {
                return { mode: "live", at: i };
            }
        }
    }
    return { mode: "file" };
};

/**
 * What a shelf edit is worth saying afterwards.
 *
 * The one thing a caver cannot see from the table is that the change
 * is not on disk yet -- the cave's tab is now modified, exactly as if
 * they had drawn in it, and closing without saving would take the edit
 * with it.
 */
CsShelf.editReport = function(caveName, field, value, saved) {
    var what = CsShelf.clean(value) === "" ?
        (field + " cleared") : (field + " is now \"" +
            CsShelf.clean(value) + "\"");
    return caveName + ": " + what + "." +
        (saved === true ? "" :
            " The cave is open with unsaved changes -- save it to keep this.");
};

CsShelf.NOT_SET = "not set";

CsShelf.declinationText = function(declination) {
    if (typeof declination !== "number" || !isFinite(declination) ||
            declination === 0) {
        return CsShelf.NOT_SET;
    }
    return Math.abs(declination).toFixed(1) + "\u00b0 " +
        (declination > 0 ? "E" : "W");
};

/** Is this trip's declination one the tools can use? The column greys
 *  the ones that are not, and the sheet draws no magnetic north for
 *  them. */
CsShelf.hasDeclination = function(declination) {
    return CsShelf.declinationText(declination) !== CsShelf.NOT_SET;
};

CsShelf.DRIFT_DEGREES = 0.5;

CsShelf.declinationDrift = function(trips, igrfFor) {
    var out = [];
    if (Object.prototype.toString.call(trips) !== "[object Array]" ||
            typeof igrfFor !== "function") {
        return out;
    }
    for (var i = 0; i < trips.length; i++) {
        var trip = trips[i];
        if (trip === null || trip === undefined) { continue; }
        var recorded = trip.declination;
        if (typeof recorded !== "number") { continue; }
        var igrf = null;
        try {
            igrf = igrfFor(trip.date);
        } catch (e) {
            igrf = null;
        }
        if (typeof igrf !== "number" || !isFinite(igrf)) { continue; }
        var delta = igrf - recorded;
        if (Math.abs(delta) < CsShelf.DRIFT_DEGREES) { continue; }
        out.push({ id: trip.id === undefined ? i : trip.id,
            recorded: recorded, igrf: igrf, delta: delta });
    }
    return out;
};
