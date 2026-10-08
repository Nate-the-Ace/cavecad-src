// CsRebuild.js
//
// Core engine: bring an OLD drawing up to the current tag schema, so
// every tool in the suite can read it.
//
// Was the whole of the Rebuild Survey Data menu entry; lifted into Core
// so CsRepair can run it as one pass of three (see CsRepair.js for why
// rebuild has to run first). RepairDrawing/RepairDrawing.js is now the
// only presenter over CsRebuild.rebuild.
//
// Three kinds of old drawing, handled in this order:
//
//   1. A LEGACY SURVEY DATA STORE (tags that lived in a text entity
//      before they persisted as entity XDATA) is migrated onto the
//      entities and deleted. Always first, so everything below reads
//      real properties.
//
//   2. PRE-v3 TAGGED DRAWINGS -- stations carry Station/Seq/Azimuth/
//      Inclination/Elevation/LRUD tags, but not one leg line carries
//      its shot data (CsRevise.surveyFromDocument flags these
//      legacy:true and hands back the chain-guesser's reconstruction).
//      The chain is reconstructed, its distances converted from PLAN to
//      SLOPE (the guesser measures 2D geometry, so an inclined shot's
//      length came back short by cos(inclination)), the legacy
//      survey-level metadata block becomes trip 0, and the whole survey
//      is erased and redrawn at its own coordinates -- which writes the
//      full v3 tag set: shot data on every leg, trip metadata on the
//      anchor. After one run the drawing reconstructs EXACTLY (see
//      CsRevise.js) and the revision tooling is safe on it.
//
//   3. UNTAGGED DRAWINGS -- ones drawn by builds that lost their tags
//      on save. Nothing but geometry to go on: POINT entities on
//      CTRL-STATIONS with a name label on CTRL-STATION-LABELS beside
//      them, LRUD tip points on CTRL-LRUD near their station. Each
//      station's name, order and LRUD names are re-derived and tagged
//      directly. This is the tool's original job and is unchanged.
//
// A v3 drawing is not left alone either: its reconstruction is redrawn
// in place, which HEALS a drawing whose entities were partly deleted by
// hand (a station point erased, a leg line gone) without touching the
// survey data itself. Running the tool twice is a no-op the second
// time -- same coordinates, same entity count.
//
// HONEST LIMITS: what the old drawing does not carry cannot be
// recovered. In case 2, distances are INFERRED from geometry
// (slope = plan / cos(inclination)) rather than read from the notes, so
// they are as good as the plot was; a shot standing within 1e-6 of
// vertical in cos has no plan length to scale, so its distance is left
// exactly as it was and the run reports how many. SPLAYS on that path
// come back from their tip positions alone (a pre-v3 ray carries only
// its name), which gives a bearing and a plan length but no
// inclination -- so the redraw cannot place them and the run reports
// how many were lost rather than losing them silently. Azimuths come from
// the station's Azimuth tag where one exists (the drawn geometry is
// used only where it does not), so a drawing whose tags disagreed with
// its plot follows the tags. In case 3, azimuth, inclination and
// numeric LRUD are gone for good -- positions remain, so plotting and
// tie-ins stay exact -- and station order (Seq) is estimated by walking
// the shot lines from the first point; branch order may differ from the
// original notes.
//
// Safe to re-run.
//
// USAGE:
//   Cave Survey > Repair Drawing   (or type "rep") -- the "Survey data"
//   pass, run first of three.

var CsRebuild = {};

// ============================================================
// Headless API.
//
// CsRebuild.rebuild(doc, di) does the whole job and returns a report;
// RepairDrawing/RepairDrawing.js is a thin presenter over it, and the
// unit tests drive it directly with no GUI at all.
// ============================================================

/**
 * |cos(inclination)| below this counts as VERTICAL: the drawn plan
 * length is zero, so there is nothing for slope = plan/cos to scale.
 * 1e-6 is within about 0.00006 degrees of straight up or down -- only
 * genuinely degenerate shots, never a steep-but-real one.
 */
CsRebuild.VERTICAL_COS_EPS = 1e-6;

/**
 * The legacy survey-level metadata block, written by pre-trip builds on
 * the anchor station point: SurveyName/SurveyDate/SurveyTeam/
 * Declination/DeclinationSource/DistanceUnit. First non-empty value
 * wins, so a drawing carrying the block on more than one point still
 * reads cleanly.
 *
 * \return {name, date, team, declination (null if absent),
 *          declinationSource, distanceUnit}
 */
CsRebuild.legacyMeta = function(doc) {
    var meta = { name: "", date: "", team: "", declination: null,
        declinationSource: "", distanceUnit: "" };
    var pairs = [["SurveyName", "name"], ["SurveyDate", "date"],
        ["SurveyTeam", "team"],
        ["DeclinationSource", "declinationSource"],
        ["DistanceUnit", "distanceUnit"]];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "") {
            continue;
        }
        for (var p = 0; p < pairs.length; p++) {
            if (meta[pairs[p][1]] === "") {
                var v = CsTags.get(e, pairs[p][0]);
                if (v !== "") {
                    meta[pairs[p][1]] = v;
                }
            }
        }
        if (meta.declination === null) {
            var d = CsTags.getNumber(e, "Declination");
            if (d !== null) {
                meta.declination = d;
            }
        }
    }
    return meta;
};

/**
 * Converts a chain reconstruction's PLAN distances into SLOPE
 * distances, in place: the legacy guesser measures the drawn 2D
 * geometry, and a shot inclined by i was drawn plan = slope * cos(i)
 * long, so slope = plan / cos(i).
 *
 * Shots at inclination 0 are already slope distances and are left
 * alone. A shot within VERTICAL_COS_EPS of vertical has no plan length
 * to scale -- its distance is left EXACTLY as it was (dividing would
 * amplify plot noise by millions) and it is counted so the run can say
 * so.
 *
 * A shot with NO USABLE INCLINATION AT ALL is left alone and counted as
 * neither. Reachable since CsTags.surveyFromDocument learned to rebuild
 * splays: a splay recovered from its tip's position alone comes back
 * with inclination null (a plan drawing records the horizontal
 * projection and nothing else), and `null * Math.PI / 180` is 0, so
 * `Math.cos(...)` is 1 and the loop below would divide the distance by
 * one and then report the shot as RESCALED -- claiming a plan-to-slope
 * conversion that never happened, on the one shot whose inclination
 * makes the conversion impossible. CsTraverse.unusable is the
 * established test for "cannot function as part of a real measurement"
 * (absent or non-finite, but never a real 0), reused here rather than
 * re-derived.
 *
 * \return {scaled, vertical, fromElevations} how many shots were
 *         rescaled, how many were left alone as near-vertical, and how
 *         many already carried a slope distance the reader took from
 *         the drawing's own station elevations
 */
CsRebuild.toSlopeDistances = function(survey) {
    var scaled = 0, vertical = 0, fromElevations = 0;
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        if (shot.distanceIsSlope === true) {
            fromElevations++;
            // Already a slope distance: CsTags.surveyFromDocument had
            // both stations' Elevation tags and took the hypotenuse
            // directly, which is better evidence than anything this
            // function can infer. Dividing it by cos(inclination) again
            // would lengthen every inclined leg by the same factor
            // twice -- 15% at 30 degrees, and without limit as the leg
            // approaches vertical, which is the case this whole family
            // of problems lives in.
            continue;
        }
        if (CsTraverse.unusable(shot.inclination)) {
            continue;
        }
        if (shot.inclination === 0) {
            continue;
        }
        var c = Math.cos(shot.inclination * Math.PI / 180.0);
        if (Math.abs(c) < CsRebuild.VERTICAL_COS_EPS) {
            vertical++;
            continue;
        }
        shot.distance = shot.distance / c;
        scaled++;
    }
    return { scaled: scaled, vertical: vertical,
             fromElevations: fromElevations };
};

/**
 * Erases every mark of the stations a survey resolves to and redraws
 * the survey in their place, pinned so its anchor station lands back on
 * its own drawn position -- the same coordinates, now carrying the full
 * v3 tag set.
 *
 * Only the stations the redraw will recreate are erased; anything the
 * network could not resolve keeps its old marks rather than
 * disappearing.
 *
 * anchorZ is the elevation the anchor is pinned at -- 0 (the drawing's
 * own arbitrary origin) unless the caller has a recorded datum to
 * preserve. Optional; defaults to 0, same as before this parameter
 * existed. Both callers here hand over CsRevise.anchorZOf, which is a
 * real recorded datum rather than a placeholder, so the default is
 * only reached by a caller that genuinely has nothing.
 *
 * adjustOpts is the loop-closure adjustment to solve under, as
 * CsAdjust.resolveAndAdjust takes it. Both callers pass THIS DRAWING's
 * own record (CsAdjust.optionsFromTags of recon.adjustTags), because
 * this function erases marks and redraws them: solving under today's
 * global setting instead would move every station of a drawing the
 * user only asked to REPAIR. Optional; omitted means the current
 * settings, which is right only for a caller with no drawing to
 * reproduce.
 *
 * \return {erased, drawn, resolved}
 */
CsRebuild.redraw = function(doc, di, survey, anchorName, anchorPos,
        anchorZ, adjustOpts) {
    if (anchorZ === undefined || anchorZ === null || isNaN(anchorZ)) {
        anchorZ = 0;
    }
    CsModel.ensureTrips(survey);
    var resolved = CsAdjust.resolveAndAdjust(survey, {
        anchor: { name: anchorName, x: anchorPos.x, y: anchorPos.y,
            z: anchorZ }
    }, adjustOpts);
    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    var erased = CsDraw.eraseStations(doc, names, di);
    var drawn = CsDraw.survey(survey, resolved, anchorName, anchorPos,
        undefined, { doc: doc, di: di });
    return { erased: erased, drawn: drawn, resolved: resolved };
};

/**
 * Total shots the drawing now carries as geometry or hidden legs.
 *
 * Control ties are counted: they are measured shots that drew a leg
 * line, and they only stopped being part of shotsDrawn when CsDraw gave
 * them their own counter -- leaving them out here would silently
 * under-report every two-entrance cave. ghostDrawn is deliberately NOT
 * counted: the CTRL-RAW ghost is a second picture of shots already
 * counted here, not more shots.
 */
CsRebuild.shotCount = function(drawn) {
    return drawn.shotsDrawn + drawn.closuresDrawn + (drawn.tiesDrawn || 0) +
        drawn.hiddenDrawn + drawn.splaysDrawn;
};

/**
 * The profile pass's own outcome, in the one sentence this tool's
 * report needs -- "" when the pass succeeded (silent on success, same
 * convention CsReport.drawSummary and CsReport.revisionSummary already
 * use: this is a "something you expected did not happen" channel, not
 * the full counts/findings report GenerateProfile gives).
 *
 * `drawn` is CsDraw.survey's own return value (CsRebuild.redraw
 * hands it straight back as `.drawn`), which has carried a `.profile`
 * field ({skipped, reason} or {path, created, counts, profile}) since
 * CsDraw.js's own profile-summary fix -- ImportCaveSurvey.js,
 * SurveyNotebook.js and CsRevise.js all surface it, but this tool's own
 * redraw() used to read only shotCount(drawn) from the identical return
 * value, so "Rebuild Survey Data" never told the user a profile was
 * skipped for size, for ProfileAuto being off, for an unsaved drawing,
 * or because the pass threw -- the same silent gap CsRevise.apply had,
 * fixed the same way, in the same words.
 *
 * \return a sentence with a LEADING SPACE (so it appends onto an
 *         existing message with one blank between sentences) and no
 *         trailing space, or "" when there is nothing to say
 */
CsRebuild.profileNote = function(drawn) {
    if (drawn === undefined || drawn === null ||
            drawn.profile === undefined || drawn.profile === null ||
            !drawn.profile.skipped) {
        return "";
    }
    return " Profile: not written -- " + drawn.profile.reason + ".";
};

/**
 * The whole job, headless.
 *
 * \return {
 *   mode      "upgrade" (pre-v3 tags converted), "heal" (v3 tags
 *             redrawn in place), "geometry" (untagged drawing recovered
 *             from its geometry), "nothing" (nothing to do)
 *   stations, shots   what the drawing now carries
 *   scaled, vertical  distance conversions done / left alone (upgrade)
 *   splaysUnplaceable  splays the redraw could NOT put back, because
 *             nothing on record says where they point (see the note
 *             below on the upgrade path's splay loss). 0 on every path
 *             that redraws nothing
 *   inferred  true when the distances came from geometry, not notes
 *   erased    entities removed before the redraw
 *   tagsWritten, lrudNamed   the geometry path's recoveries
 *   hadStore  a legacy survey data store was migrated and dropped
 *   message   what to tell the user (EAction.handleUserMessage)
 *   dialog    a longer report better suited to a message box ("" if none)
 *   warning   why nothing could be done ("" if all well)
 * }
 */
CsRebuild.rebuild = function(doc, di) {
    var report = { mode: "nothing", stations: 0, shots: 0, scaled: 0,
        vertical: 0, fromElevations: 0,
        splaysUnplaceable: 0, inferred: false, erased: 0,
        tagsWritten: 0, lrudNamed: 0, hadStore: false, message: "",
        dialog: "", warning: "" };

    // A legacy survey data store becomes entity tags FIRST, so
    // everything below reads real properties -- and so the store text
    // disappears even when there is nothing else to do.
    report.hadStore = CsStore.findStoreEntity(doc) !== null;
    CsStore.migrate(doc, di);

    var recon = CsRevise.surveyFromDocument(doc);
    var haveAnchor = recon.anchorName !== "" && recon.anchorPos !== null &&
        recon.anchorPos !== undefined;

    if (recon.legacy === true && haveAnchor) {
        // ---- pre-v3 tagged drawing: convert, then redraw as v3 ------
        var survey = recon.survey;
        var meta = CsRebuild.legacyMeta(doc);
        // SurveyName held caveName||name; CsRevise reads it back as the
        // cave name, so put it there (see CsRevise.surveyFromDocument).
        if (meta.name !== "") {
            survey.caveName = meta.name;
        }
        survey.date = meta.date;
        survey.team = meta.team;
        survey.declination = meta.declination === null ? 0.0 :
            meta.declination;
        survey.declinationSource = meta.declinationSource;
        if (meta.distanceUnit !== "") {
            survey.distanceUnit = meta.distanceUnit;
        }

        var conv = CsRebuild.toSlopeDistances(survey);
        report.scaled = conv.scaled;
        report.vertical = conv.vertical;
        report.fromElevations = conv.fromElevations;
        report.inferred = true;

        // one trip, from the legacy metadata block
        CsModel.ensureTrips(survey);

        // The anchor's RECORDED elevation, not 0 -- a cave surveyed to
        // an absolute datum (entrance at, say, 1250 ft) carries that
        // datum in the anchor's Elevation tag, and pinning the redraw
        // at 0 instead would rewrite every one of those tags onto the
        // drawing's arbitrary origin. A drawing whose elevations were
        // already zero-based is unaffected: its recorded z IS zero.
        // One answer for both paths -- CsRevise.anchorZOf, which
        // prefers an explicit *fix over the tag and is guaranteed
        // numeric, so no junk value can reach CsNetwork.resolve as a
        // NaN anchor.z and propagate silently through the redraw.
        var anchorZ = CsRevise.anchorZOf(recon, recon.anchorName);

        var up = CsRebuild.redraw(doc, di, survey,
            recon.anchorName, recon.anchorPos, anchorZ,
            CsAdjust.optionsFromTags(recon.adjustTags || {}));
        report.mode = "upgrade";
        report.erased = up.erased;
        report.stations = up.drawn.stationsDrawn;
        report.shots = CsRebuild.shotCount(up.drawn);
        // SPLAY LOSS ON THIS PATH, NAMED RATHER THAN SILENT. A pre-v3
        // splay ray carries only its name, so CsTags.collectSplays
        // recovers it from its TIP's position -- which gives a bearing
        // and a plan length but no inclination, and CsDraw.survey will
        // not draw a ray it cannot place (nor should it: that is the
        // dead-level fabrication CsTraverse.unusable exists to refuse).
        // The redraw has already ERASED the old ray by then, exactly as
        // it erases every other mark of the stations it replaces, so
        // those splays are genuinely gone from the drawing -- as they
        // were before the reader could see them at all, only now the
        // run can say how many instead of the loss being invisible.
        report.splaysUnplaceable = up.drawn.splaysSkipped || 0;
        report.message = "Rebuild Survey Data: upgraded this drawing to " +
            "tag schema v3 -- " + report.stations + " station" +
            (report.stations === 1 ? "" : "s") + " and " + report.shots +
            " shot" + (report.shots === 1 ? "" : "s") + " now carry " +
            "their own data. " +
            // WHICH KIND OF INFERENCE, because they are not equally
            // good and the difference is largest exactly where it
            // matters most. A drawing that recorded an elevation per
            // station says what the vertical really was, and the tape
            // is then the hypotenuse -- exact, and it works on a pitch.
            // A drawing without them leaves only the drawn plan length
            // and an inclination tag to divide it by, which cannot
            // recover a plumb at all (there is no plan length to
            // scale). Saying "slope = plan/cos(inclination)" for a run
            // that did neither would be a report of work not done.
            (report.fromElevations > 0 ?
                "Distances taken from the drawing's own station " +
                "elevations (" + report.fromElevations + " shot" +
                (report.fromElevations === 1 ? "" : "s") + ")." :
                "Distances inferred from geometry " +
                "(slope = plan/cos(inclination)).") +
            (report.fromElevations > 0 && report.scaled > 0 ?
                " " + report.scaled + " shot" +
                (report.scaled === 1 ? "" : "s") + " had no elevation on " +
                "record and were inferred from geometry instead " +
                "(slope = plan/cos(inclination))." : "") +
            (anchorZ !== 0 ? " Elevations kept on the recorded datum -- " +
                recon.anchorName + " at " +
                CsReport.length(anchorZ, survey.distanceUnit) + "." : "") +
            (report.vertical > 0 ? " " + report.vertical + " near-" +
                "vertical shot" + (report.vertical === 1 ? "" : "s") +
                " had no plan length to scale; distance left as drawn." :
                "") +
            (report.splaysUnplaceable > 0 ? " " +
                report.splaysUnplaceable + " splay" +
                (report.splaysUnplaceable === 1 ? "" : "s") +
                " had no inclination on record and could not be redrawn." :
                "") +
            CsRebuild.profileNote(up.drawn);
        return report;
    }

    if (recon.survey.shots.length > 0 && haveAnchor) {
        // ---- already v3: redraw the reconstruction in place ---------
        // Nothing is inferred here -- the tags ARE the survey. The
        // redraw restores marks deleted by hand and is a no-op
        // otherwise -- but only if it is pinned at the same HEIGHT it
        // was drawn at. A v3 drawing keeps its datum in the Elevation
        // tags and nowhere else (a *fix is the exception, not the
        // rule), and the redraw rewrites those tags, so healing at 0
        // would flatten the whole cave onto the drawing's origin -- the
        // same loss the upgrade path above guards against, through the
        // same one answer.
        var healZ = CsRevise.anchorZOf(recon, recon.anchorName);
        var heal = CsRebuild.redraw(doc, di, recon.survey,
            recon.anchorName, recon.anchorPos, healZ,
            CsAdjust.optionsFromTags(recon.adjustTags || {}));
        report.mode = "heal";
        report.erased = heal.erased;
        report.stations = heal.drawn.stationsDrawn;
        report.shots = CsRebuild.shotCount(heal.drawn);
        report.splaysUnplaceable = heal.drawn.splaysSkipped || 0;
        report.message = "Rebuild Survey Data: redrew " + report.stations +
            " station" + (report.stations === 1 ? "" : "s") + " and " +
            report.shots + " shot" + (report.shots === 1 ? "" : "s") +
            " from the drawing's own survey data -- already tag schema " +
            "v3, nothing inferred." +
            (healZ !== 0 ? " Elevations kept on the recorded datum -- " +
                recon.anchorName + " at " +
                CsReport.length(healZ, recon.survey.distanceUnit) + "." : "") +
            (report.splaysUnplaceable > 0 ? " " +
                report.splaysUnplaceable + " splay" +
                (report.splaysUnplaceable === 1 ? "" : "s") +
                " had no inclination on record and could not be redrawn." :
                "") +
            CsRebuild.profileNote(heal.drawn);
        return report;
    }

    // ---- no survey data at all: recover what the geometry carries ---
    return CsRebuild.fromGeometry(doc, di, report);
};

/**
 * The original tool: an UNTAGGED drawing, walked as geometry. Station
 * points are named from the nearest name label, ordered by walking the
 * shot lines from the first point, and LRUD tips credited to their
 * nearest named station. Tags are written straight onto the entities.
 *
 * Unchanged behaviour, moved here so rebuild() can fall through to it.
 */
CsRebuild.fromGeometry = function(doc, di, report) {
    var LABEL_RADIUS = CsDraw.TEXT_HEIGHT * 6;   // label sits ~0.75 from point
    var LRUD_RADIUS = 1000000;                    // tips matched to NEAREST station

    if (!doc.hasLayer(CsLayers.CTRL_STATIONS)) {
        report.warning = "Rebuild Survey Data: no " + CsLayers.CTRL_STATIONS +
            " layer -- nothing to recover.";
        return report;
    }

    // ---- gather geometry -------------------------------------------
    var stationPts = [];   // {entity, pos, tagged}
    var labels = [];       // {pos, text}
    var lrudTips = [];     // {entity, pos, tagged}
    var shotLines = [];    // {a, b}

    var stLayer = doc.getLayerId(CsLayers.CTRL_STATIONS);
    var lbLayer = doc.hasLayer(CsLayers.CTRL_STATION_LABELS) ?
        doc.getLayerId(CsLayers.CTRL_STATION_LABELS) : -1;
    var lrLayer = doc.hasLayer(CsLayers.CTRL_LRUD) ?
        doc.getLayerId(CsLayers.CTRL_LRUD) : -1;
    var shLayer = doc.hasLayer(CsLayers.CTRL_SHOTS) ?
        doc.getLayerId(CsLayers.CTRL_SHOTS) : -1;

    var i, k;
    var ids = doc.queryAllEntities(false, true);
    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var lid = e.getLayerId();
        if (lid === stLayer && typeof e.getPosition === "function") {
            stationPts.push({ entity: e, pos: e.getPosition(),
                tagged: CsTags.get(e, "Station") !== "" });
        } else if (lid === lbLayer && typeof e.getPlainText === "function" &&
                typeof e.getPosition === "function") {
            var t = String(e.getPlainText());
            if (t.indexOf("U") === 0 && t.indexOf(" D") > 0) {
                continue; // a U/D note, not a name
            }
            labels.push({ pos: e.getPosition(),
                text: t.replace(/\s*\(Z[^)]*\)\s*$/, "") });
        } else if (lid === lrLayer && typeof e.getPosition === "function" &&
                e.getType() === RS.EntityPoint) {
            lrudTips.push({ entity: e, pos: e.getPosition(),
                tagged: CsTags.get(e, "LRUDName") !== "" });
        } else if (lid === shLayer &&
                typeof e.getStartPoint === "function" &&
                typeof e.getEndPoint === "function") {
            shotLines.push({ a: e.getStartPoint(), b: e.getEndPoint(),
                entity: e });
        }
    }

    if (stationPts.length === 0) {
        report.warning = "Rebuild Survey Data: no station points found on " +
            CsLayers.CTRL_STATIONS + ".";
        return report;
    }

    var dist = function(p, q) {
        var dx = p.x - q.x, dy = p.y - q.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    // ---- name each untagged station from its nearest label ----------
    var renamed = 0;
    for (i = 0; i < stationPts.length; i++) {
        var sp = stationPts[i];
        if (sp.tagged) {
            sp.name = CsTags.get(sp.entity, "Station");
            continue;
        }
        var best = null, bestD = LABEL_RADIUS;
        for (k = 0; k < labels.length; k++) {
            var d = dist(sp.pos, labels[k].pos);
            if (d < bestD) {
                bestD = d;
                best = labels[k];
            }
        }
        if (best !== null) {
            sp.name = best.text;
            renamed++;
        } else {
            sp.name = "";
        }
    }

    // ---- order: walk the shot lines from the first station ----------
    // seed order = existing Seq tags first, then walk connectivity
    var seq = 0;
    var placed = {};
    for (i = 0; i < stationPts.length; i++) {
        if (stationPts[i].tagged) {
            seq = Math.max(seq,
                (CsTags.getNumber(stationPts[i].entity, "Seq") || 0) + 1);
        }
    }
    var nearStation = function(p) {
        for (var s = 0; s < stationPts.length; s++) {
            if (dist(stationPts[s].pos, p) < 1e-4) {
                return s;
            }
        }
        return -1;
    };
    // breadth-first over shot lines starting at the first unplaced pt
    var queue = [];
    for (i = 0; i < stationPts.length; i++) {
        if (!stationPts[i].tagged && stationPts[i].name !== "" &&
            placed[i] === undefined) {
            queue.push(i);
            while (queue.length > 0) {
                var cur = queue.shift();
                if (placed[cur] !== undefined) {
                    continue;
                }
                placed[cur] = seq++;
                for (var L = 0; L < shotLines.length; L++) {
                    var na = nearStation(shotLines[L].a);
                    var nb = nearStation(shotLines[L].b);
                    if (na === cur && nb >= 0 && placed[nb] === undefined) {
                        queue.push(nb);
                    }
                    if (nb === cur && na >= 0 && placed[na] === undefined) {
                        queue.push(na);
                    }
                }
            }
        }
    }

    // ---- commit station tags -----------------------------------------
    var op = new RModifyObjectsOperation();
    op.setText("Rebuild survey data");
    var tagsWritten = 0;
    for (i = 0; i < stationPts.length; i++) {
        var st = stationPts[i];
        if (st.tagged || st.name === "") {
            continue;
        }
        CsTags.set(st.entity, "Station", st.name);
        CsTags.set(st.entity, "Seq", placed[i] !== undefined ? placed[i] : seq++);
        op.addObject(st.entity, false);
        tagsWritten++;
    }

    // ---- LRUD tips: nearest named station gets the credit -------------
    var lrudNamed = 0;
    for (i = 0; i < lrudTips.length; i++) {
        var tip = lrudTips[i];
        if (tip.tagged) {
            continue;
        }
        var bestS = null, bestSD = LRUD_RADIUS;
        for (k = 0; k < stationPts.length; k++) {
            if (stationPts[k].name === "") {
                continue;
            }
            var d2 = dist(tip.pos, stationPts[k].pos);
            if (d2 < bestSD) {
                bestSD = d2;
                bestS = stationPts[k];
            }
        }
        if (bestS !== null && bestSD > 1e-6) {
            // side: which side of the incoming direction? Unknowable
            // without the shot azimuth -- record as L/R by x-offset
            // sign relative to the station as a stable convention.
            var side = (tip.pos.x < bestS.pos.x) ? "L" : "R";
            CsTags.set(tip.entity, "LRUDName", bestS.name + "." + side);
            op.addObject(tip.entity, false);
            lrudNamed++;
        }
    }

    report.tagsWritten = tagsWritten;
    report.lrudNamed = lrudNamed;
    report.stations = stationPts.length;

    if (tagsWritten === 0 && lrudNamed === 0) {
        report.mode = "nothing";
        report.message = "Rebuild Survey Data: " +
            (report.hadStore ? "migrated the survey data store onto the " +
                "entities and removed it; nothing else to do." :
                "nothing to do -- every station already carries its " +
                "data.");
        return report;
    }

    di.applyOperation(op);
    CsStore.migrate(doc, di);

    report.mode = "geometry";
    report.message = "Rebuild Survey Data: recovered " + tagsWritten +
        " station" + (tagsWritten === 1 ? "" : "s") + " and " +
        lrudNamed + " LRUD point" + (lrudNamed === 1 ? "" : "s") +
        " from the drawing's geometry.";
    report.dialog = "Recovered " + tagsWritten + " station" +
        (tagsWritten === 1 ? "" : "s") + " and " + lrudNamed +
        " LRUD point" + (lrudNamed === 1 ? "" : "s") +
        " from the drawing's geometry and tagged the entities " +
        "directly.\n\nTie-ins, redraw-replace, LRUD Walls and Survey " +
        "Stats now work on this drawing. What geometry doesn't carry " +
        "-- legacy azimuth/inclination readings and numeric LRUD -- " +
        "could not be recovered; positions are exact.\n\nRun the tool " +
        "again to lift the recovered data to tag schema v3.";
    return report;
};

