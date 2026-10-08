// Tags.js -- reading and writing survey data on entities.
//
// Part of the Cave Survey Core library. QCAD context only, but with
// no opinions about layers or geometry -- just custom properties.
//
// Everything rides under the property group "CaveSurvey":
//   Station      station name, on CTRL-STATIONS points
//   LRUDName     "A1.L" / "A1.R", on CTRL-LRUD tip points
//   Splay        "A1.2", on the CTRL-SPLAYS ray line -- which also
//                carries the same schema-v3 shot data as a leg line
//   SplayName    "A1.2", on the ray's tip point
//   SplayLabel   "A1.2", on the tip's text label (lettering, not data)
//   Seq          integer resolution order, on station points -- what
//                LRUDWalls sorts by instead of entity creation order
//   Inclination, Left, Right, Up, Down, Elevation   shot data
//   Azimuth      the azimuth of the shot that reached the station
//                (the LRUD direction reference)
//   SurveyName, SurveyDate, SurveyTeam, Declination, DeclinationSource,
//   DistanceUnit   survey-level metadata, on the anchor station point.
//                Declination ALSO appears on a leg or splay line,
//                where it means that one shot's applied declination
//                instead (see CsDraw's legTags)
//   BoundaryId   ScatterBreakdown's per-boundary ownership tag
//   GeoLat, GeoLon, GeoStation   the georeference anchor, stored as
//                data instead of destructively rescaling the drawing
//
// Custom properties are unavailable in some contexts, so every write
// degrades silently -- a missing tag costs a convenience later, never
// a crash now.

var CsTags = {};

CsTags.GROUP = "CaveSurvey";

/** Writes one tag; silently does nothing where unsupported. */
CsTags.set = function(entity, key, value) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (value === undefined || value === null || value === "") {
        return;
    }
    if (typeof entity.setCustomProperty !== "function") {
        return;
    }
    try {
        // newlines would break single-line carriers (DXF XDATA group
        // values); escape on write, unescape in CsTags.get
        var v = String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
        entity.setCustomProperty(CsTags.GROUP, key, v);
    } catch (e) {
        // not supported here -- non-critical
    }
};

/**
 * REMOVES a tag from an entity, script-side. Commit with a modify
 * operation the same way CsTags.commit does.
 *
 * Needed because CsTags.set CANNOT clear a tag: it returns early on
 * null/undefined/"" by design, so that a caller passing an absent
 * reading writes nothing rather than writing an empty string. That is
 * right for writing, and it means "set it to empty" is not a way to
 * unset. CalloutWrite.unlink tried exactly that and silently did
 * nothing -- a text that had lost its last leader kept its CalloutId
 * and stayed a half-callout no tool could see the other half of.
 *
 * entity.removeCustomProperty(group, key) is the real removal and was
 * probed present in this build.
 */
CsTags.remove = function(entity, key) {
    if (entity === undefined || entity === null) {
        return;
    }
    if (typeof entity.removeCustomProperty !== "function") {
        return;
    }
    try {
        entity.removeCustomProperty(CsTags.GROUP, key);
    } catch (e) {
        // not supported here -- non-critical, same posture as set()
    }
};

/**
 * Writes tags onto an entity ALREADY IN the document. Setting a
 * property on a queried entity mutates only the script-side copy;
 * committing it back needs a modify operation with addObject(e,
 * false) -- the false keeps the entity's layer untouched.
 */
CsTags.commit = function(di, entity, keyValues) {
    for (var k in keyValues) {
        if (keyValues.hasOwnProperty(k)) {
            CsTags.set(entity, k, keyValues[k]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.addObject(entity, false);
    di.applyOperation(op);
    if (typeof CsStore !== "undefined") {
        // custom properties persist natively (DXF XDATA); this only
        // converts a legacy drawing's store text, then deletes it
        CsStore.migrate(getDocument(), di);
    }
};

/** Reads one tag, "" if absent or unsupported. Falls back to the
 *  legacy survey data store (CsStore) for drawings saved by early
 *  builds, whose tags live only in the store text until a modifying
 *  tool migrates them onto the entities. */
/**
 * Tags renamed after drawings were already carrying the old name.
 *
 * canonical -> [older spellings, newest first]
 *
 * READ-ONLY COMPATIBILITY. Nothing here rewrites a drawing: the new
 * name is what gets WRITTEN from now on, and CsTags.get falls back
 * through this table so a cave surveyed under the old name keeps
 * answering. A rename that orphaned live XDATA would trade a tidy
 * vocabulary for somebody's survey, which is not a trade this suite
 * makes.
 *
 * StartLRUD: the acronym is LRUD everywhere else it appears -- LRUDLine,
 * LRUDName, LRUDNote -- and StartLrud was the one place it was title
 * case.
 */
CsTags.ALIASES = {
    "StartLRUD": ["StartLrud"]
};

CsTags.get = function(entity, key) {
    if (entity === undefined || entity === null) {
        return "";
    }
    var v = "";
    if (typeof entity.getCustomProperty === "function") {
        try {
            v = entity.getCustomProperty(CsTags.GROUP, key, "");
            v = (v === undefined || v === null) ? "" : String(v);
        } catch (e) {
            v = "";
        }
    }
    if (v === "" && typeof CsStore !== "undefined") {
        v = CsStore.lookup(entity, key);
    }
    // An older spelling of the same tag, for a drawing written before
    // the rename. Tried only when the canonical name found nothing, so
    // a drawing carrying both answers with the current one.
    if (v === "" && CsTags.ALIASES.hasOwnProperty(key)) {
        var older = CsTags.ALIASES[key];
        for (var i = 0; i < older.length && v === ""; i++) {
            if (typeof entity.getCustomProperty === "function") {
                try {
                    v = entity.getCustomProperty(CsTags.GROUP, older[i], "");
                    v = (v === undefined || v === null) ? "" : String(v);
                } catch (eOld) {
                    v = "";
                }
            }
            if (v === "" && typeof CsStore !== "undefined") {
                v = CsStore.lookup(entity, older[i]);
            }
        }
    }
    // undo the newline escaping applied in CsTags.set
    return v.replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
};

/** Reads a numeric tag; null if absent or not a number. */
CsTags.getNumber = function(entity, key) {
    var v = CsTags.get(entity, key);
    if (v === "") {
        return null;
    }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
};

/** Tags a station point with its full shot data. */
CsTags.tagStation = function(entity, data) {
    CsTags.set(entity, "Station", data.name);
    CsTags.set(entity, "Seq", data.seq);
    CsTags.set(entity, "Azimuth", data.azimuth);
    CsTags.set(entity, "Inclination", data.inclination);
    CsTags.set(entity, "Left",
        CsModel.lrudEntryText(data.left, data.leftAll, data.leftOpen));
    CsTags.set(entity, "Right",
        CsModel.lrudEntryText(data.right, data.rightAll, data.rightOpen));
    CsTags.set(entity, "Up",
        CsModel.lrudEntryText(data.up, data.upAll, data.upOpen));
    CsTags.set(entity, "Down",
        CsModel.lrudEntryText(data.down, data.downAll, data.downOpen));
    CsTags.set(entity, "Elevation", data.z);
    CsTags.set(entity, "Note", data.note);
};

/**
 * Collects every tagged station point in the document:
 * [{entity, name, seq, pos}] sorted by Seq where present, falling
 * back to entity order for drawings made by the old tools.
 */
CsTags.collectStations = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name === "") {
            continue;
        }
        var seq = CsTags.getNumber(e, "Seq");
        out.push({ entity: e, name: name, seq: seq, pos: e.getPosition() });
    }
    out.sort(function(a, b) {
        if (a.seq !== null && b.seq !== null) {
            return a.seq - b.seq;
        }
        if (a.seq !== null) {
            return -1;
        }
        if (b.seq !== null) {
            return 1;
        }
        return 0; // stable: keeps entity order for untagged legacy data
    });
    return out;
};

/**
 * The trailing index of a splay name: "A3.2" -> 2. -1 when the name
 * carries none (an older drawing tagged the bare station). Pure.
 *
 * The companion of CsBind.splayBase, which answers the other half of
 * the same name ("A3.2" -> "A3"), and DERIVED FROM IT rather than
 * matching the suffix a second time: there is exactly one definition
 * in this codebase of what a splay suffix is, and it lives there.
 */
CsTags.splayIndex = function(tagged) {
    var s = (tagged === undefined || tagged === null) ? "" : String(tagged);
    var base = CsBind.splayBase(s);
    if (base === s) {
        return -1; // no ".<n>" suffix at all
    }
    var n = parseInt(s.substring(base.length + 1), 10);
    return isNaN(n) ? -1 : n;
};

/**
 * Every splay the drawing still carries, rebuilt as CsModel shots:
 * `splay` true, `to` "", `from` the station its own name names.
 *
 * WHERE A SPLAY LIVES IN A DRAWING (CsDraw.survey's own shape): a ray
 * line on CTRL-SPLAYS tagged `Splay` = "<station>.<n>", a tip POINT at
 * its far end tagged `SplayName` with that same name, and a text label
 * tagged `SplayLabel`. The label is lettering, not data, and is never
 * read here.
 *
 * TWO WAYS BACK, best first:
 *
 *   1. THE RAY'S OWN SHOT TAGS. CsDraw.survey writes a splay ray the
 *      SAME schema-v3 tag set it writes onto a leg line (Distance,
 *      Azimuth, Inclination, the backsight pair, LRUD, Flags, Trip,
 *      ShotSeq, Note, Declination) -- see its `legTags(sp)` call. Read
 *      through CsRevise.shotFromEntity, the one reader for that tag
 *      set, so a field added there is not silently missing here. This
 *      path is EXACT: the splay comes back field for field and redraws
 *      to the coordinates it was drawn at.
 *
 *   2. THE TIP'S POSITION, relative to its station -- for a ray that
 *      predates v3 (no Distance tag), or whose ray was deleted by
 *      hand. A plan drawing shows a splay's HORIZONTAL projection and
 *      nothing else, so azimuth and plan distance come back and
 *      INCLINATION DOES NOT: it comes back null, never 0. Fabricating
 *      a 0 here would assert a dead-level shot nobody measured -- the
 *      exact case CsTraverse.unusable's own docblock names ("a splay
 *      with no inclination from drawing dead level, as though either
 *      were a real reading") -- and would plant a phantom wall point
 *      at centerline elevation, which CsProfile.bandWallRuns refuses
 *      to do on purpose. Such a splay is still recovered as DATA: it
 *      is a real splay at a real bearing, and both CsDraw.survey
 *      (`splaysSkipped`) and CsProfile.build (`wallPointsSkipped`)
 *      count it as unplaceable and say so in their reports, which is
 *      strictly more than the nothing it used to come back as.
 *
 * NOT RECOVERED: splay geometry whose base station is no longer in the
 * drawing. There is no station to hang it on and no origin to measure
 * its tip from, and CsDraw.survey would skip it anyway (it draws only
 * splays whose `from` actually resolved). A caller that needs to know
 * counts SplayName tips itself and compares -- see GenerateProfile.js.
 *
 * ORDER: by station (the Seq order `stations` is already in), then by
 * the splay's own trailing index, then by name. A TOTAL order, never 0
 * for two distinct splays, because CaveCAD's Array.prototype.sort is
 * unstable where node's is stable (tests/README.md) and a comparator
 * that can return 0 produces different geometry in each engine. That
 * ordering restores each station's splays in the order CsDraw.survey
 * numbered them, so a redraw hands out the same names. ONE exception,
 * inherent rather than fixable: where the original survey had an
 * unmeasurable splay, CsDraw left a GAP in the numbering (D2.1, D2.3
 * with D2.2 never drawn), and a gap cannot come back from a drawing
 * that never showed it -- the two surviving splays redraw as D2.1 and
 * D2.2, at their original coordinates.
 *
 * QCAD only.
 *
 * \param doc      the document
 * \param stations CsTags.collectStations(doc) result -- already sorted,
 *                 and the only source of station positions here
 * \return [shot] -- possibly empty
 */
CsTags.collectSplays = function(doc, stations) {
    var posOf = {}, rankOf = {};
    var i;
    for (i = 0; i < stations.length; i++) {
        posOf[stations[i].name] = stations[i].pos;
        rankOf[stations[i].name] = i;
    }

    // one pass, gathering the ray and the tip of each named splay
    var parts = {}, names = [];
    var ids = doc.queryAllEntities(false, false);
    for (i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var rayName = CsTags.get(e, "Splay");
        var tipName = rayName === "" ? CsTags.get(e, "SplayName") : "";
        var name = rayName !== "" ? rayName : tipName;
        if (name === "") {
            continue;
        }
        if (!parts.hasOwnProperty(name)) {
            parts[name] = { ray: null, tip: null };
            names.push(name);
        }
        if (rayName !== "") {
            parts[name].ray = e;
        } else if (typeof e.getPosition === "function") {
            parts[name].tip = e;
        }
    }

    var rows = [];
    for (i = 0; i < names.length; i++) {
        var station = CsBind.splayBase(names[i]);
        if (!posOf.hasOwnProperty(station)) {
            continue; // orphaned geometry -- see the docblock
        }
        var shot = CsTags.splayShot(parts[names[i]].ray,
            parts[names[i]].tip, posOf[station]);
        if (shot === null) {
            continue;
        }
        shot.from = station;
        shot.to = "";
        shot.splay = true;
        rows.push({ shot: shot, rank: rankOf[station],
            index: CsTags.splayIndex(names[i]), name: names[i] });
    }
    rows.sort(function(a, b) {
        if (a.rank !== b.rank) {
            return a.rank - b.rank;
        }
        if (a.index !== b.index) {
            return a.index - b.index;
        }
        return a.name < b.name ? -1 : 1; // names are unique: never 0
    });

    var out = [];
    for (i = 0; i < rows.length; i++) {
        out.push(rows[i].shot);
    }
    return out;
};

/**
 * One splay's readings, from its ray's shot tags where it has them and
 * from its tip's position where it does not. `from`/`to`/`splay` are
 * the caller's to set (CsTags.collectSplays does). Returns null when
 * neither carrier says anything usable.
 *
 * The Distance tag is the test for "this ray carries shot data" --
 * exactly the test CsRevise.surveyFromDocument uses for the same
 * question, and it matters: CsRevise.shotFromEntity defaults an absent
 * Distance to 0.0, so handing it a pre-v3 ray would invent a splay
 * with a real, surveyed length of zero.
 *
 * \param ray        the CTRL-SPLAYS line, or null
 * \param tip        its tip point, or null
 * \param stationPos the base station's drawn position
 */
CsTags.splayShot = function(ray, tip, stationPos) {
    if (ray !== null && CsTags.get(ray, "Distance") !== "") {
        return CsRevise.shotFromEntity(ray);
    }
    if (tip === null) {
        return null; // a ray with no readings and no tip says nothing
    }
    var shot = CsModel.newShot();
    var p = tip.getPosition();
    var dx = p.x - stationPos.x;
    var dy = p.y - stationPos.y;
    shot.distance = Math.sqrt(dx * dx + dy * dy);
    shot.azimuth = CsAngles.normalizeAzimuth(
        Math.atan2(dx, dy) * 180.0 / Math.PI);
    shot.inclination = null; // NOT 0.0 -- see collectSplays' docblock
    return shot;
};

/**
 * Rebuilds a CsModel survey from a drawing's tags -- the property
 * that lets any tool run on any drawing the suite (or the previous
 * generation of it) produced. The CENTERLINE is guessed: the stations
 * are chained in Seq order and each leg is inferred from the drawn
 * geometry plus that station's own azimuth/inclination/LRUD tags (see
 * CsRevise.surveyFromDocument, which reads a schema-v3 drawing back
 * exactly instead). The SPLAYS are not guessed -- they come back from
 * their own tagged geometry through CsTags.collectSplays, exactly
 * where their readings are on record and as honest data with no
 * inclination where they are not.
 *
 * Splays are appended AFTER every leg, station by station. Nothing
 * downstream reads splays positionally -- CsLrud.splaysByStation keys
 * them by `from`, CsNetwork.resolve routes every one of them to
 * `skipped` and emits no leg, CsStats/CsModel.lrudForStation/
 * CsValidate all filter them out -- so a survey that gains splays here
 * resolves to EXACTLY the geometry it resolved to before, and only the
 * floor/ceiling and wall passes see anything new. What survey.shots
 * order does decide is the numbering a redraw hands out (CsDraw.survey
 * counts 1..n per station in this order), which is why collectSplays
 * sorts rather than returns scan order.
 *
 * SEVENTH DOOR in the elevation-datum-trap family (CsTraverse.offset's
 * own docblock names the first five; CsNetwork.resolve's anchorEffectiveZ
 * comment names the sixth and is the direct model for this one): every
 * station this function reconstructs is written into survey.fixed with
 * a REAL x/y/z, whether or not the drawing's own Elevation tag actually
 * had a number in it -- `CsTags.getNumber(...) || 0.0` used to treat "no
 * tag" and "unparseable tag" exactly like a real, surveyed 0.0, the same
 * disease as every other door in this family. UNREACHABLE TODAY: nothing
 * this suite ships ever writes a station without an Elevation tag, and
 * every current writer of that tag parses to a real number -- but this
 * function's own docblock advertises reading foreign and hand-edited
 * drawings, and a drawing edited by hand (or written by a future format
 * reader) is exactly where a missing or garbled Elevation tag would
 * first appear. WHAT ABSENT SHOULD DO: report it as null, not invent a
 * sea-level datum for a cave that may be surveyed to an unrelated
 * absolute one -- the same answer CsNetwork.resolve's anchor path
 * already gives for the identical question, and CsTraverse.unusable /
 * CsProfile.zOf already treat null as "no resolved elevation" rather
 * than crashing on it. CsNetwork.resolve's own seedFixed had the exact
 * same `f.z || 0.0` fabrication one frame downstream of survey.fixed
 * (see its own comment, which used to say this exact station-tag path
 * was the reason that line could never actually see a null) -- fixed in
 * the same change, or this fix would only have made the OBJECT more
 * honest without changing what actually gets resolved and drawn.
 */
CsTags.surveyFromDocument = function(doc) {
    var survey = CsModel.newSurvey();
    var stations = CsTags.collectStations(doc);
    var prev = null;
    for (var i = 0; i < stations.length; i++) {
        var st = stations[i];
        if (prev !== null) {
            var shot = CsModel.newShot();
            shot.from = prev.name;
            shot.to = st.name;
            var az = CsTags.getNumber(st.entity, "Azimuth");
            var dx = st.pos.x - prev.pos.x;
            var dy = st.pos.y - prev.pos.y;
            var plan = Math.sqrt(dx * dx + dy * dy);

            // THE DRAWING IS NOT FLAT AND NEITHER IS WHAT COMES BACK
            // OUT OF IT.
            //
            // This used to read `distance = plan` and take the
            // inclination from an "Inclination" tag that NOTHING in
            // this suite has ever written (CsDraw.station's data object
            // has no such field, so CsTags.tagStation sets it to
            // undefined and it never lands). So every reconstructed leg
            // came back LEVEL, with the tape reading its own plan
            // projection. In a horizontal cave that is a fraction of a
            // percent and invisible. In a vertical one it is the whole
            // cave: a 187 ft free-fall reconstructs as a leg 1.1e-14 ft
            // long at 0 degrees -- which trips `bad-distance`, drops
            // out of the surveyed length, and stops being a pitch to
            // every rule that asks.
            //
            // The elevations were on the drawing the entire time, one
            // per station, and the pair of them says exactly what the
            // tags could not: dz is a subtraction, the tape is the
            // hypotenuse, and the inclination is the angle between.
            // Nothing is invented and no tag has to be added.
            //
            // The resolved GEOMETRY never depended on any of this --
            // every station here is written into survey.fixed with its
            // own coordinate below, so resolve() places them all from
            // control regardless. What depended on it was everything
            // that reads the SHOTS: the cave's length, its depth
            // profile, the validator, and whether a rope is a rope.
            var zPrev = CsTags.getNumber(prev.entity, "Elevation");
            var zHere = CsTags.getNumber(st.entity, "Elevation");
            if (zPrev !== null && zHere !== null) {
                var dz = zHere - zPrev;
                shot.distance = Math.sqrt(plan * plan + dz * dz);
                shot.inclination = (plan === 0.0 && dz === 0.0) ? 0.0 :
                    Math.atan2(dz, plan) * 180.0 / Math.PI;
                // A READER ANNOTATION, not a model field: this shot's
                // distance is ALREADY a slope distance.
                // CsRebuild.toSlopeDistances exists to turn a chain
                // reconstruction's plan distances into slope ones by
                // dividing by cos(inclination), and running that over a
                // distance that is already the hypotenuse divides by
                // the same cosine twice. It skips anything carrying
                // this. Deliberately absent (rather than `false`) on
                // every other shot in the suite, so that every existing
                // caller of that function keeps the behaviour it had.
                shot.distanceIsSlope = true;
            } else {
                // One of the two stations has no elevation on the
                // drawing at all. There is then nothing truthful to say
                // about the vertical, so this keeps the old answer --
                // the plan distance, level -- rather than inventing a
                // datum for it. See this function's own SEVENTH DOOR
                // note: absent is not zero, and the honest cost of that
                // is a leg that reads as level because nobody said
                // otherwise.
                shot.distance = plan;
                var incTag = CsTags.getNumber(st.entity, "Inclination");
                shot.inclination = incTag !== null ? incTag : 0.0;
            }

            // A PITCH HAS NO BEARING TO RECONSTRUCT. Below
            // CsLrud.COINCIDENT_PLAN the two stations are the same
            // point in plan and `atan2` would be dividing rounding
            // error by rounding error -- the same fabrication
            // CsLrud.planBearing refuses. The Azimuth tag, where the
            // drawing has one, is the bearing the LRUD was recorded on
            // and is used as before; where there is neither, the leg
            // comes back saying so.
            if (az !== null) {
                shot.azimuth = az;
            } else if (plan > CsLrud.COINCIDENT_PLAN) {
                shot.azimuth = CsAngles.normalizeAzimuth(
                    Math.atan2(dx, dy) * 180.0 / Math.PI);
            } else {
                shot.azimuth = 0.0;
                shot.azimuthOmitted = true;
            }
            var lrudTag = function(key) {
                return CsModel.parseLrudEntry(CsTags.get(st.entity, key));
            };
            var eL = lrudTag("Left"), eR = lrudTag("Right");
            var eU = lrudTag("Up"), eD = lrudTag("Down");
            shot.left = eL.value; shot.leftAll = eL.all; shot.leftOpen = eL.open;
            shot.right = eR.value; shot.rightAll = eR.all; shot.rightOpen = eR.open;
            shot.up = eU.value; shot.upAll = eU.all; shot.upOpen = eU.open;
            shot.down = eD.value; shot.downAll = eD.all; shot.downOpen = eD.open;
            shot.notes = CsTags.get(st.entity, "Note");
            survey.shots.push(shot);
        }
        if (prev === null) {
            survey.startNote = CsTags.get(st.entity, "Note");
        }
        survey.fixed[st.name] = { x: st.pos.x, y: st.pos.y,
            z: CsTags.getNumber(st.entity, "Elevation") };
        prev = st;
    }
    var splays = CsTags.collectSplays(doc, stations);
    for (var sp = 0; sp < splays.length; sp++) {
        survey.shots.push(splays[sp]);
    }
    return survey;
};
