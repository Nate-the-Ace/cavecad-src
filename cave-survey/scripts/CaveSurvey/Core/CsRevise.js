// CsRevise.js -- exact survey reconstruction from a drawing's tags.
//
// Part of the Cave Survey Core library. Pure ES5 at file scope (no
// R*/document API outside functions), so it loads under node; the
// document-scanning entry points are only callable where a document
// exists.
//
// CsTags.surveyFromDocument, the v1/v2 reader, GUESSES: it chains the
// stations in Seq order and infers each shot from drawn geometry.
// Tag schema v3 (written by CsDraw.survey) makes guessing obsolete --
// every leg line carries its shot's full data, trip anchors carry
// trip metadata, and the shots the drawing can't show as geometry
// ride the trip-0 anchor as serialized rows -- so this module reads
// the survey back EXACTLY, field for field. That exactness is what
// makes revision tooling safe: reconstruct, edit, redraw, and nothing
// silently drifts.
//
// Drawings older than v3 (tagged stations exist, but not one leg has
// a Distance tag) fall back to the legacy chain-guesser, flagged
// legacy:true so callers know the result is approximate.
//
// NOT reconstructed: GeoLat/GeoLon/GeoStation. CsModel's survey shape
// has no geo field to put them in; the georeference stays a
// drawing-level tag (see CsTags.js) rather than survey data. That
// means CsRevise.apply has to protect it by hand: its non-rigid path
// redraws every station from scratch, and a redraw would erase the
// anchor right along with the geometry it has no field to carry. So
// apply reads the anchor before the redraw and recommits it after --
// carried across, never reconstructed.
//
// Below the reconstruction entry points lives the REVISION MATH: the
// pure numeric half of the revision framework. reviseDeclination
// rotates one trip's azimuths to a re-measured declination, each shot
// off the declination it records having been computed with;
// similarityFit / classifyChange compare two resolve results and
// decide whether the whole plan moved RIGIDLY (rotation + uniform
// scale + translation -- redraw everything in place) or genuinely
// changed shape (stations moved relative to each other -- the caller
// must reconcile). All of it is engine-free and runs under node.
//
// THOSE TWO RESULTS MUST BE SOLVED THE SAME WAY. CsAdjust's return
// shape is a superset of CsNetwork.resolve's, so either kind goes in
// -- but adjust one side and not the other and the fit reads the
// adjustment itself as the revision, and a pure declination change
// stops classifying as rigid. CsRevise.apply solves both sides through
// CsAdjust.resolveAndAdjust with one options object, taken from the
// DRAWING's own record; see the comment at that call.

var CsRevise = {};

/**
 * One drawn leg (or splay) line back into a full CsModel shot, from
 * its v3 tags. Numeric fields that are never null in the model
 * (distance/azimuth/inclination) fall back to 0.0 when the tag is
 * missing; the backsight pair and the applied declination genuinely
 * can be absent and stay null.
 */
CsRevise.shotFromEntity = function(e) {
    var shot = CsModel.newShot();
    var num = function(key, fallback) {
        var n = CsTags.getNumber(e, key);
        return n === null ? fallback : n;
    };
    shot.from = CsTags.get(e, "From");
    shot.to = CsTags.get(e, "To");
    shot.distance = num("Distance", 0.0);
    shot.azimuth = num("Azimuth", 0.0);
    shot.inclination = num("Inclination", 0.0);
    shot.backAzimuth = CsTags.getNumber(e, "BackAzimuth");
    shot.backInclination = CsTags.getNumber(e, "BackInclination");
    var sides = [["left", "Left"], ["right", "Right"],
        ["up", "Up"], ["down", "Down"]];
    for (var i = 0; i < sides.length; i++) {
        var entry = CsModel.parseLrudEntry(CsTags.get(e, sides[i][1]));
        shot[sides[i][0]] = entry.value;
        shot[sides[i][0] + "All"] = entry.all;
        shot[sides[i][0] + "Open"] = entry.open;
    }
    CsModel.parseFlags(CsTags.get(e, "Flags"), shot);
    shot.notes = CsTags.get(e, "Note");
    shot.trip = num("Trip", 0);
    // The declination this shot's azimuth was computed with. No tag --
    // a drawing from before the field existed, or a shot that never
    // had its own -- stays null, which means "my trip's value" (see
    // CsModel.appliedDeclination), exactly what such a drawing implied
    // all along.
    shot.declination = CsTags.getNumber(e, "Declination");
    return shot;
};

/**
 * Rebuilds the survey a drawing was drawn FROM, exactly.
 *
 * One pass over every entity:
 *   station points   position; Elevation -> the recorded elevation;
 *                    Fixed -> survey.fixed; trip-anchor
 *                    tags -> trip records; the trip-0 anchor also
 *                    StartNote/StartLRUD, the legacy SurveyName
 *                    (which stored caveName||name -- the ambiguity is
 *                    accepted, it becomes caveName), and the
 *                    ExcludedShots/UnplacedShots row blobs
 *   leg lines        From + Distance tags -> a full shot each
 *   splay lines      Splay + Distance tags -> a splay shot each
 *
 * Legs, splays and serialized rows all carry (trip, shotSeq); merging
 * them sorted by that pair restores the original notebook order
 * within each trip, trips in id order.
 *
 * \return {
 *   survey      the reconstructed CsModel survey
 *   anchorName  the trip-0 anchor station's name ("" if none)
 *   anchorPos   its drawing position (null if none)
 *   anchorZ     the elevation that anchor station is RECORDED at (its
 *               Elevation tag). The drawing's vertical datum: a cave
 *               surveyed to an absolute one (entrance at 1250 ft, say)
 *               keeps it nowhere else unless the surveyor also declared
 *               a *fix. Always a number -- 0.0 when the tag is absent,
 *               blank or not numeric, never NaN
 *   adjustTags  {Adjustment, SigmaTape, SigmaAngle} exactly as the
 *               trip-0 anchor records them -- the loop-closure
 *               adjustment THIS drawing's geometry was solved with.
 *               Shaped for CsAdjust.optionsFromTags, the only thing
 *               that should interpret it: a drawing recording nothing
 *               reads back "" in every field and falls back there to
 *               the current settings. Always an object, never null, so
 *               a caller can hand it straight over
 *   legacy      true when the drawing predates schema v3 and the
 *               result came from CsTags.surveyFromDocument's
 *               chain-guessing instead
 * }
 */
CsRevise.surveyFromDocument = function(doc) {
    if (typeof CsStore !== "undefined") {
        CsStore.ensureLoaded(doc);
    }

    var stations = [];      // {name, seq, pos, elev}
    var tripRecs = {};      // trip id -> trip record from its anchor
    var maxTrip = -1;
    var fixed = {};
    var caveName = null;
    var anchorStation = null; // the trip-0 anchor's station record
    var exBlob = "", unBlob = "";
    var placed = [];        // {shot, trip, seq, ord} from legs + splays
    var ord = 0;            // scan-order tiebreaker (stable sort)

    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }

        var stName = CsTags.get(e, "Station");
        if (stName !== "" && typeof e.getPosition === "function") {
            // Elevation rides along in this one scan: CsDraw.survey
            // writes every station's resolved z there, so it is where
            // the drawing's vertical datum actually lives.
            // `entity` rides along for the same reason: the adjustment
            // record below is read off whichever of these turns out to
            // be the trip-0 anchor, and that is not known until the
            // scan finishes. Kept local -- nothing outside this
            // function sees these records.
            var st = { name: stName, seq: CsTags.getNumber(e, "Seq"),
                pos: e.getPosition(),
                elev: CsTags.getNumber(e, "Elevation"), entity: e };
            stations.push(st);
            var fx = CsTags.get(e, "Fixed");
            if (fx !== "") {
                var fp = fx.split(",");
                var fnum = function(v) {
                    var n = parseFloat(v);
                    return isNaN(n) ? 0.0 : n;
                };
                fixed[stName] = { x: fnum(fp[0]), y: fnum(fp[1]),
                    z: fnum(fp[2]) };
            }
            if (CsTags.get(e, "Trip") !== "" ||
                    CsTags.get(e, "TripDeclination") !== "") {
                var tid = CsTags.getNumber(e, "Trip");
                tid = tid === null ? 0 : tid;
                var trip = CsModel.newTrip();
                trip.name = CsTags.get(e, "TripName");
                trip.date = CsTags.get(e, "TripDate");
                trip.team = CsTags.get(e, "TripTeam");
                trip.instruments = CsTags.get(e, "TripInstruments");
                var td = CsTags.getNumber(e, "TripDeclination");
                trip.declination = td === null ? 0.0 : td;
                trip.declinationSource =
                    CsTags.get(e, "TripDeclinationSource");
                var tu = CsTags.get(e, "TripDistanceUnit");
                if (tu !== "") {
                    trip.distanceUnit = tu;
                }
                tripRecs[tid] = trip;
                if (tid > maxTrip) {
                    maxTrip = tid;
                }
                if (tid === 0) {
                    anchorStation = st;
                    trip.startNote = CsTags.get(e, "StartNote");
                    trip.startLrud =
                        CsModel.parseStartLrud(CsTags.get(e, "StartLRUD"));
                }
            }
            // legacy survey block: SurveyName stored caveName||name --
            // accept the ambiguity, it becomes caveName
            var sn = CsTags.get(e, "SurveyName");
            if (sn !== "" && caveName === null) {
                caveName = sn;
            }
            var ex = CsTags.get(e, "ExcludedShots");
            if (ex !== "") {
                exBlob = ex;
            }
            var un = CsTags.get(e, "UnplacedShots");
            if (un !== "") {
                unBlob = un;
            }
            continue;
        }

        // legs and splays: only v3 lines carry a Distance tag
        if (CsTags.get(e, "Distance") === "") {
            continue;
        }
        var splayTag = CsTags.get(e, "Splay");
        var fromTag = CsTags.get(e, "From");
        if (splayTag === "" && fromTag === "") {
            continue;
        }
        var shot = CsRevise.shotFromEntity(e);
        if (splayTag !== "") {
            shot.splay = true;
            shot.to = "";
            if (shot.from === "") {
                // pre-From splay: its base station is the Splay tag
                // ("A2.3") minus the trailing ".<n>" -- through
                // CsBind.splayBase, the ONE definition of that rule
                // (CsDraw.eraseStations and CsTags.collectSplays both
                // call it too), so a drawing's splays cannot be
                // reconstructed under one reading of their names and
                // erased under another
                shot.from = CsBind.splayBase(splayTag);
            }
        }
        if (shot.trip > maxTrip) {
            maxTrip = shot.trip;
        }
        placed.push({ shot: shot, trip: shot.trip,
            seq: CsTags.getNumber(e, "ShotSeq"), ord: ord++ });
    }

    // fallback anchor: the lowest-Seq station collected
    var first = null;
    for (i = 0; i < stations.length; i++) {
        if (first === null) {
            first = stations[i];
        } else if (stations[i].seq !== null &&
                (first.seq === null || stations[i].seq < first.seq)) {
            first = stations[i];
        }
    }
    if (anchorStation === null) {
        anchorStation = first;
    }
    var anchorName = anchorStation !== null ? anchorStation.name : "";
    var anchorPos = anchorStation !== null ? anchorStation.pos : null;
    // The datum every consumer inherits. Coerced to a number HERE,
    // once, rather than at each use: a junk tag reaching
    // CsNetwork.resolve as anchor.z = NaN would spread through every
    // station it places without a single complaint.
    var anchorZ = (anchorStation !== null &&
        typeof anchorStation.elev === "number" &&
        !isNaN(anchorStation.elev)) ? anchorStation.elev : 0.0;

    // WHAT THIS DRAWING WAS ADJUSTED WITH. Read off the same point
    // CsDraw.survey wrote it onto: the trip-0 anchor, or the fallback
    // chosen just above on a drawing that has no trip 0 -- the same
    // choice CsRevise.trip0Anchor makes, for the same reason. Read
    // through the shared helper so the tag names live in one place.
    var adjustTags = CsRevise.adjustTagsOn(
        anchorStation !== null ? anchorStation.entity : null);

    // pre-v3 drawing: stations, but not one Distance-tagged shot
    // anywhere -- hand it to the legacy chain-guesser, flagged
    if (stations.length > 0 && placed.length === 0 &&
            exBlob === "" && unBlob === "") {
        return { survey: CsTags.surveyFromDocument(doc),
            anchorName: anchorName, anchorPos: anchorPos,
            anchorZ: anchorZ, adjustTags: adjustTags, legacy: true };
    }

    // serialized rows: "tripId TAB shotSeq TAB shotRow" per line
    var addRows = function(blob) {
        if (blob === "") {
            return;
        }
        var lines = blob.split("\n");
        for (var r = 0; r < lines.length; r++) {
            if (lines[r] === "") {
                continue;
            }
            var f = lines[r].split("\t");
            var tid = parseInt(f[0], 10);
            if (isNaN(tid)) {
                tid = 0;
            }
            var seqN = parseInt(f[1], 10);
            var shot = CsModel.parseShotRow(f.slice(2).join("\t"));
            shot.trip = tid;
            if (tid > maxTrip) {
                maxTrip = tid;
            }
            placed.push({ shot: shot, trip: tid,
                seq: isNaN(seqN) ? null : seqN, ord: ord++ });
        }
    };
    addRows(exBlob);
    addRows(unBlob);

    // merge everything back into notebook order: trip asc, per-trip
    // shot sequence asc, scan order as the stable tiebreaker
    placed.sort(function(a, b) {
        if (a.trip !== b.trip) {
            return a.trip - b.trip;
        }
        var as = a.seq === null ? Infinity : a.seq;
        var bs = b.seq === null ? Infinity : b.seq;
        if (as !== bs) {
            return as - bs;
        }
        return a.ord - b.ord;
    });

    var survey = CsModel.newSurvey();
    for (i = 0; i < placed.length; i++) {
        survey.shots.push(placed[i].shot);
    }
    survey.fixed = fixed;
    if (caveName !== null) {
        survey.caveName = caveName;
    }
    if (maxTrip >= 0) {
        // trips indexed by id; ids with no anchor (all their shots
        // excluded/unplaced, say) get a neutral record
        survey.trips = [];
        for (i = 0; i <= maxTrip; i++) {
            survey.trips.push(tripRecs[i] !== undefined ?
                tripRecs[i] : CsModel.newTrip());
        }
    }
    CsModel.ensureTrips(survey);
    return { survey: survey, anchorName: anchorName,
        anchorPos: anchorPos, anchorZ: anchorZ, adjustTags: adjustTags,
        legacy: false };
};

/**
 * The elevation a reconstructed station is pinned at.
 *
 * Two records can carry a station's z and they are NOT equal in
 * authority. survey.fixed (a Fixed="x,y,z" tag, itself from an
 * explicit *fix/#Fix) is a coordinate the surveyor declared; an
 * Elevation tag is only what the last redraw computed. So the fix
 * wins, and the recorded datum -- recon.anchorZ -- stands in when
 * there is none. Reaching 0 means the drawing says nothing about
 * height anywhere, which is the ordinary case for a cave surveyed off
 * its own entrance.
 *
 * recon.anchorZ describes ONE station, so only that station may claim
 * it: handing the anchor's datum to some other pivot would shift every
 * elevation in the cave by the dz between the two.
 *
 * Always returns a number, never NaN -- see surveyFromDocument.
 *
 * \param recon CsRevise.surveyFromDocument(doc) result
 * \param name  the station to pin
 */
CsRevise.anchorZOf = function(recon, name) {
    var fx = recon.survey.fixed[name];
    if (fx !== undefined && fx !== null && typeof fx.z === "number" &&
            !isNaN(fx.z)) {
        return fx.z;
    }
    if (name === recon.anchorName && typeof recon.anchorZ === "number" &&
            !isNaN(recon.anchorZ)) {
        return recon.anchorZ;
    }
    return 0.0;
};

// ---------------------------------------------------------------------
// Revision math -- pure numeric helpers, no document access.
// ---------------------------------------------------------------------

/**
 * Re-applies one trip's declination: rotates EVERY azimuth belonging
 * to that trip (splays and flag-carrying/excluded shots included --
 * their geometry is just as magnetic as everyone else's) to newDecl,
 * then records newDecl on the trip AND on every shot it moved.
 *
 * Model azimuths are TRUE bearings with declination already applied
 * (see CsModel.js), so an azimuth computed with D moves by (D' - D).
 * The delta is therefore computed PER SHOT, against the declination
 * that shot actually records (CsModel.appliedDeclination: its own, or
 * the trip's when it has none) -- a trip whose shots came in under two
 * declinations is revised exactly, not uniformly-and-nearly. Every
 * shot ends up recording newDecl, because after this that IS the
 * declination its azimuth was computed with. backAzimuth lives in the
 * same frame (see the backsight-frame note in CsModel.js), so it
 * co-rotates whenever present.
 *
 * \param survey  the CsModel survey (mutated in place)
 * \param tripId  index into survey.trips
 * \param newDecl the re-measured declination, degrees east-positive
 * \param source  optional new declinationSource ("igrf"/"user"/...);
 *                the trip's existing source is kept when omitted
 * \return {
 *   delta     the trip-record delta, newDecl - the trip's old value:
 *             the degrees every shot WITHOUT its own recorded
 *             declination moved. It describes the whole trip only when
 *             mixed is false -- there is no single number that
 *             describes a mixed one, which is why the flag is here
 *             rather than a plausible-looking average
 *   diverged  how many shots carried a declination of their own that
 *             differed from the trip's, and so moved by their own
 *             delta instead
 *   mixed     diverged > 0, spelled out for callers that only need to
 *             know whether delta covers everything
 * }
 */
CsRevise.reviseDeclination = function(survey, tripId, newDecl, source) {
    CsModel.ensureTrips(survey);
    var trip = survey.trips[tripId];
    var tripOld = trip.declination;
    var delta = newDecl - tripOld;
    var diverged = 0;
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        if ((s.trip || 0) !== tripId) {
            continue;
        }
        var applied = CsModel.appliedDeclination(s, trip);
        // 4 decimals, the granularity every other declination
        // comparison in the Core uses (CsModel.absorbDeclination)
        if (Math.abs(applied - tripOld) >= 5e-5) {
            diverged++;
        }
        var d = newDecl - applied;
        s.azimuth = CsAngles.normalizeAzimuth(s.azimuth + d);
        if (s.backAzimuth !== null && s.backAzimuth !== undefined) {
            s.backAzimuth = CsAngles.normalizeAzimuth(s.backAzimuth + d);
        }
        // the shot's azimuth is now a newDecl azimuth: say so, or the
        // next revision would un-apply a value this one replaced
        s.declination = newDecl;
    }
    trip.declination = newDecl;
    if (source !== undefined && source !== null) {
        trip.declinationSource = source;
    }
    if (tripId === 0) {
        // trips[0] is the authority over the top-level mirror fields
        // (see CsModel.ensureTrips) -- re-mirror so survey.declination
        // reflects the revision immediately.
        CsModel.ensureTrips(survey);
    }
    return { delta: delta, diverged: diverged, mixed: diverged > 0 };
};

/**
 * Least-squares 2D similarity transform (rotation + uniform scale +
 * translation, NO reflection) mapping each pair's old point onto its
 * nu point -- the closed-form Procrustes solution:
 *
 *   centroids p-bar (old), q-bar (nu); over the centered points
 *   dp = old - p-bar, dq = nu - q-bar:
 *     a  = sum(dp.x*dq.x + dp.y*dq.y)
 *     b  = sum(dp.x*dq.y - dp.y*dq.x)
 *     s2 = sum(dp.x^2 + dp.y^2)
 *   theta = atan2(b, a),  scale = sqrt(a^2 + b^2) / s2
 *   (tx, ty) = q-bar - scale * R(theta) * p-bar
 *
 * theta is in RADIANS, counter-clockwise-positive in drawing
 * coordinates (x east, y north): R(theta) = [cos -sin; sin cos].
 * Note the suite-wide consequence: adding +d degrees to every azimuth
 * turns the plan CLOCKWISE, so a declination revision of +d yields
 * theta = -d * PI/180 here (verified numerically in the unit tests).
 *
 * Degenerate inputs, by choice (documented, tested):
 *   0 pairs   -> null (nothing to fit)
 *   1 pair    -> pure translation {theta 0, scale 1, maxResidual 0}
 *   s2 ~ 0    -> all old points coincide: rotation and scale are
 *                underdetermined, so {theta 0, scale 1, centroid
 *                translation, maxResidual Infinity} -- Infinity so a
 *                caller can never certify rigidity from a fit the
 *                data couldn't support
 *
 * \param pairs [{old: {x, y}, nu: {x, y}}]
 * \return { theta, scale, tx, ty, maxResidual } or null; maxResidual
 *         is the largest distance between a transformed old point and
 *         its nu point
 */
CsRevise.similarityFit = function(pairs) {
    if (pairs.length === 0) {
        return null;
    }
    var i;
    var px = 0.0, py = 0.0, qx = 0.0, qy = 0.0;
    for (i = 0; i < pairs.length; i++) {
        px += pairs[i].old.x;
        py += pairs[i].old.y;
        qx += pairs[i].nu.x;
        qy += pairs[i].nu.y;
    }
    px /= pairs.length;
    py /= pairs.length;
    qx /= pairs.length;
    qy /= pairs.length;

    var fit;
    if (pairs.length === 1) {
        fit = { theta: 0.0, scale: 1.0, tx: qx - px, ty: qy - py };
    } else {
        var a = 0.0, b = 0.0, s2 = 0.0;
        for (i = 0; i < pairs.length; i++) {
            var dpx = pairs[i].old.x - px;
            var dpy = pairs[i].old.y - py;
            var dqx = pairs[i].nu.x - qx;
            var dqy = pairs[i].nu.y - qy;
            a += dpx * dqx + dpy * dqy;
            b += dpx * dqy - dpy * dqx;
            s2 += dpx * dpx + dpy * dpy;
        }
        if (s2 <= 1e-20) {
            // coincident old points: rotation/scale underdetermined
            return { theta: 0.0, scale: 1.0, tx: qx - px, ty: qy - py,
                maxResidual: Infinity };
        }
        var theta = Math.atan2(b, a);
        var scale = Math.sqrt(a * a + b * b) / s2;
        fit = {
            theta: theta,
            scale: scale,
            tx: qx - scale * (Math.cos(theta) * px - Math.sin(theta) * py),
            ty: qy - scale * (Math.sin(theta) * px + Math.cos(theta) * py)
        };
    }

    var maxResidual = 0.0;
    for (i = 0; i < pairs.length; i++) {
        var t = CsRevise.applyFit(fit, pairs[i].old);
        var rx = t.x - pairs[i].nu.x;
        var ry = t.y - pairs[i].nu.y;
        var r = Math.sqrt(rx * rx + ry * ry);
        if (r > maxResidual) {
            maxResidual = r;
        }
    }
    fit.maxResidual = maxResidual;
    return fit;
};

/**
 * Applies a similarityFit transform to one {x, y} point:
 * scale * R(theta) * p + (tx, ty). The one place the rotation-matrix
 * convention lives, so tests and callers can't disagree with the fit.
 */
CsRevise.applyFit = function(fit, pt) {
    var c = Math.cos(fit.theta);
    var s = Math.sin(fit.theta);
    return {
        x: fit.scale * (c * pt.x - s * pt.y) + fit.tx,
        y: fit.scale * (s * pt.x + c * pt.y) + fit.ty
    };
};

/**
 * Compares two CsNetwork.resolve results and classifies the change:
 * RIGID (the whole plan moved as one body -- rotation + uniform scale
 * + translation in plan, plus one uniform z shift) or not.
 *
 * Pairs up every station name present in BOTH results, fits the plan
 * similarity over them, and checks the z deltas separately (the fit
 * is 2D; z rigidity just means every station rose/fell by the same
 * amount). eps scales with the drawing: 1e-6 * max(extent, 1).
 *
 * \param oldResolved CsNetwork.resolve output before the edit
 * \param newResolved CsNetwork.resolve output after the edit
 * \param extent      characteristic drawing size (e.g. bounding-box
 *                    diagonal) for the eps scale; anything
 *                    non-numeric counts as 0 (eps floor 1e-6)
 * \return {
 *   rigid        true when the fit exists, its maxResidual < eps,
 *                and the z change is uniform
 *   theta, scale, tx, ty, maxResidual   the fit (see similarityFit);
 *                theta 0 / scale 1 / maxResidual Infinity when no
 *                stations are shared (fit null -> never rigid)
 *   moved        [{name, dist}] 3D displacement of every shared
 *                station, sorted largest first
 * }
 */
CsRevise.classifyChange = function(oldResolved, newResolved, extent) {
    var e = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var eps = 1e-6 * Math.max(e, 1);

    var pairs = [];
    var moved = [];
    var dzMin = null, dzMax = null;
    for (var name in oldResolved.stations) {
        if (!oldResolved.stations.hasOwnProperty(name) ||
                !newResolved.stations.hasOwnProperty(name)) {
            continue;
        }
        var o = oldResolved.stations[name];
        var n = newResolved.stations[name];
        pairs.push({ old: { x: o.x, y: o.y }, nu: { x: n.x, y: n.y } });
        var dz = n.z - o.z;
        if (dzMin === null || dz < dzMin) {
            dzMin = dz;
        }
        if (dzMax === null || dz > dzMax) {
            dzMax = dz;
        }
        var dx = n.x - o.x;
        var dy = n.y - o.y;
        moved.push({ name: name,
            dist: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
    moved.sort(function(a, b) {
        return b.dist - a.dist;
    });

    var fit = CsRevise.similarityFit(pairs);
    var zUniform = dzMin === null || (dzMax - dzMin) <= eps;
    var rigid = fit !== null && fit.maxResidual < eps && zUniform;

    return {
        rigid: rigid,
        theta: fit !== null ? fit.theta : 0.0,
        scale: fit !== null ? fit.scale : 1.0,
        tx: fit !== null ? fit.tx : 0.0,
        ty: fit !== null ? fit.ty : 0.0,
        maxResidual: fit !== null ? fit.maxResidual : Infinity,
        moved: moved
    };
};

// ---------------------------------------------------------------------
// Per-trip revision UI decisions -- pure, no GUI, no document access.
//
// These live here rather than in whichever tool happens to show the
// dialog: every per-trip declination UI (the Survey Notebook's, and
// the standalone Declination tool's until it is retired) has to make
// the SAME calls about what a field displays and what counts as an
// edit. Two copies of the display-precision rule below would be two
// tools that disagree about whether a trip changed.
//
// tripsNeedingRevision came here for the same reason from the other
// direction: it decides which trips are WORTH offering a revision, and
// the tool that used to own that question (Geo Reference) is being
// retired into the notebook.
// ---------------------------------------------------------------------

/** "YYYY-MM-DD" -> {year, month, day}, or null. */
CsRevise.parseIsoDate = function(text) {
    if (text === undefined || text === null) {
        return null;
    }
    var s = String(text).replace(/^\s+|\s+$/g, "");
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m === null) {
        return null;
    }
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10) };
};

/** A declination as dialog text: "3.5", "0.0", "-4.25". */
CsRevise.declText = function(value) {
    var n = Number(value);
    if (isNaN(n)) {
        return "0.0";
    }
    var s = String(Math.round(n * 10000) / 10000);
    if (s.indexOf(".") < 0 && s.indexOf("e") < 0 && s.indexOf("E") < 0) {
        s += ".0";
    }
    return s;
};

/** 'Trip 1: ENTRANCE SERIES 2024-03-02 AB, CD' -- blanks drop out. */
CsRevise.tripLabel = function(tripId, trip) {
    var parts = ["Trip " + tripId + ":"];
    if (trip.name !== undefined && trip.name !== null && trip.name !== "") {
        parts.push(String(trip.name));
    }
    if (trip.date !== undefined && trip.date !== null && trip.date !== "") {
        parts.push(String(trip.date));
    }
    if (trip.team !== undefined && trip.team !== null && trip.team !== "") {
        parts.push(String(trip.team));
    }
    return parts.length === 1 ? "Trip " + tripId : parts.join(" ");
};

/** The recorded value + where it came from: "0.0 (file)". */
CsRevise.recordedText = function(trip) {
    var src = trip.declinationSource;
    if (src === undefined || src === null || src === "") {
        src = "unrecorded";
    }
    return CsRevise.declText(trip.declination) + " (" + src + ")";
};

/**
 * The revision decisions, from plain data snapshotted off the dialog.
 *
 * \param rows [{tripId, recorded, text, igrfText}] --
 *   recorded  the trip's recorded declination (number)
 *   text      the field's text on Apply
 *   igrfText  the exact string the IGRF button last filled ("" if never)
 * \return { changes: [{tripId, value, source}] } for every field whose
 *         text no longer reads as the prefilled declText(recorded) --
 *         source "igrf" when the text still exactly matches the IGRF
 *         fill, "user" otherwise -- OR { error: "..." } when any field
 *         holds something unparseable (a prefilled field always holds
 *         a valid number, so junk is always an edit gone wrong; the
 *         caller must apply NOTHING).
 */
CsRevise.parseTripEdits = function(rows) {
    var changes = [];
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var text = String(r.text === undefined || r.text === null ?
            "" : r.text).replace(/^\s+|\s+$/g, "");
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a number (degrees, east positive). " +
                "Nothing was changed." };
        }
        var value = parseFloat(text);
        if (!isFinite(value)) {
            return { error: "Trip " + r.tripId + ": \"" + text +
                "\" is not a usable number. Nothing was changed." };
        }
        // Unchanged means "still reads as what we prefilled", NOT
        // "equals the recorded double". The prefill is
        // declText(recorded) -- 4 decimals -- so a recorded
        // declination carrying more precision than that can never
        // round-trip a raw comparison: reopening this dialog and
        // pressing Apply with no edits would manufacture a ~1e-5 deg
        // "revision" and downgrade the trip's declinationSource from
        // igrf to user. Compare at
        // the precision the dialog actually shows -- both revision
        // tools apply IGRF at 2 decimals, well inside it.
        var shown = CsRevise.declText(r.recorded);
        if (text === shown || Math.abs(value - Number(shown)) <= 1e-9) {
            continue;
        }
        var source = (r.igrfText !== undefined && r.igrfText !== null &&
            r.igrfText !== "" && text === r.igrfText) ? "igrf" : "user";
        changes.push({ tripId: r.tripId, value: value, source: source });
    }
    return { changes: changes };
};

/**
 * Which trips deserve an IGRF declination-revision offer once an
 * anchor at (lat, lon) is known.
 *
 * A trip qualifies when ALL of:
 *   - its declinationSource is "" or "user" (a value already stamped
 *     "igrf", or read from a survey data file, is not second-guessed),
 *   - its date parses as YYYY-MM-DD (IGRF needs a real date),
 *   - the IGRF model covers that date (declination() non-null), and
 *   - the recorded declination differs from the IGRF estimate by
 *     more than 0.5 degrees.
 *
 * The returned igrf is already rounded to 2 decimals -- the value a
 * candidate carries is exactly what gets displayed AND, if accepted,
 * exactly what gets applied (see the rounding comment inline below).
 *
 * \param survey CsModel survey (e.g. CsRevise.surveyFromDocument().survey)
 * \param lat    anchor latitude, degrees, north positive
 * \param lon    anchor longitude, degrees, east positive
 * \return [{tripId, recorded, igrf, date, team}] in trip-id order,
 *         igrf rounded to 2 decimals
 */
CsRevise.tripsNeedingRevision = function(survey, lat, lon) {
    var out = [];
    var trips = survey.trips || [];
    for (var t = 0; t < trips.length; t++) {
        var trip = trips[t];
        if (trip.declinationSource !== "" &&
                trip.declinationSource !== "user") {
            continue;
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trip.date);
        if (m === null) {
            continue;
        }
        var igrf = CsGeomag.declination(lat, lon, {
            year: parseInt(m[1], 10),
            month: parseInt(m[2], 10),
            day: parseInt(m[3], 10)
        });
        if (igrf === null) {
            continue;
        }
        // Round to 2 decimals HERE -- the one site that decides what
        // "the IGRF value" for this trip means. Everything downstream
        // (the question box's toFixed(2), and reviseDeclination if
        // accepted) uses this SAME rounded number, so what the user
        // is shown is exactly what gets stored. This also keeps the
        // convention shared with every other IGRF fill in the suite --
        // the per-trip dialog's IGRF buttons and the notebook header's
        // Infer apply at 2 decimals too (see their comments) -- so a
        // trip revised down one path round-trips through the other's
        // unchanged-detection instead of registering a phantom edit.
        var igrfRounded = Math.round(igrf.declination * 100) / 100;
        if (Math.abs(trip.declination - igrfRounded) > 0.5) {
            out.push({ tripId: t, recorded: trip.declination,
                igrf: igrfRounded, date: trip.date,
                team: trip.team });
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// Applying a revision to the open drawing. QCAD context only (the one
// part of this module that touches entities); everything above stays
// engine-free.
// ---------------------------------------------------------------------

/**
 * Layers whose entities are WORLD-FIXED: the rigid path transforms
 * every other entity in the drawing, and never one of these.
 *
 *   "TB_*"         title-block sheet furniture. It belongs to the
 *                  SHEET, not to the cave, so it must not travel when
 *                  the cave is re-oriented underneath it.
 *   "CTRL-AERIAL"  georeferenced aerial basemap imagery. It is pinned
 *                  to the GROUND. A declination revision re-orients
 *                  the survey relative to true north -- that is the
 *                  whole point of it -- so rotating the photo along
 *                  with the survey would destroy the photo's
 *                  georeferencing and silently misalign the imagery
 *                  under the cave.
 *   "NORTH-ARROW"  THE clearest case, and the one a future reader will
 *                  question, so it is spelled out: a declination
 *                  revision rotates the cave relative to TRUE NORTH.
 *                  An arrow that rotates with the cave keeps pointing
 *                  at the same passage instead of at north, and the
 *                  map then LIES about its own orientation -- the one
 *                  error a reader has no way to detect from the sheet.
 *                  The arrow stays put; the cave turns under it.
 *   "SCALE-BAR"    a scale bar is a statement about the SHEET. A rigid
 *                  revision may carry a uniform scale (a unit
 *                  re-interpretation), and scaling the bar along with
 *                  the drawing would leave it reading the old
 *                  distances forever.
 *   "TITLE-BLOCK"  the same furniture "TB_*" names, under the layer
 *   "LEGEND"       name the NSS plan template actually uses. Sheet
 *   "BORDER"       furniture belongs to the paper, not to the cave.
 *
 * This list is also the canonical answer for CsBind.isLineworkLayer,
 * which consults it: without the five sheet-furniture layers above, a
 * hand-drawn north arrow on NORTH-ARROW passed that gate as cave
 * linework and would have been bound to nearby stations and moved with
 * them. Fixing it here fixes the linework mover AND the adopt scan
 * from one list.
 *
 * Entries are matched as literal layer names, or as prefixes when they
 * end in "*". Deliberately spelled out here rather than pulled from
 * CsLayers: this module stays free of any dependency on constants that
 * file may not define yet.
 */
CsRevise.WORLD_FIXED_LAYERS = ["TB_*", "CTRL-AERIAL", "NORTH-ARROW",
    "SCALE-BAR", "TITLE-BLOCK", "LEGEND", "BORDER"];

/** True when entities on layerName must NOT move with the cave (see
 *  CsRevise.WORLD_FIXED_LAYERS). */
CsRevise.isWorldFixedLayer = function(layerName) {
    var name = (layerName === undefined || layerName === null) ? "" :
        String(layerName);
    for (var i = 0; i < CsRevise.WORLD_FIXED_LAYERS.length; i++) {
        var pat = CsRevise.WORLD_FIXED_LAYERS[i];
        if (pat.charAt(pat.length - 1) === "*") {
            if (name.indexOf(pat.substring(0, pat.length - 1)) === 0) {
                return true;
            }
        } else if (name === pat) {
            return true;
        }
    }
    return false;
};

// How far a linework fit's worst station may miss before the move is
// refused, as a fraction of the drawing's extent (the same relative
// basis classifyChange uses -- a cave in feet and the same cave in
// metres must decide identically).
//
// SCOPE, NARROWED: this only gates the entity types that have no
// per-vertex structure to warp AND have no single anchor point --
// hatches, images and the like. Polylines, lines, arcs, circles and
// splines warp per-vertex/per-center, and block references, text and
// callouts warp at their one anchor, all by CsWarp.mlsSimilarity (see
// moveLinework below), which always has a locally sensible answer and
// never refuses. For the remaining types, a residual of a tenth of a
// percent of the drawing diagonal is 0.5 mm on a 1:200 sheet of a
// 100 m cave -- thinner than the line itself. Above that, no single
// rigid move honestly describes what happened to a block/text
// reference's control points, and the entity is left alone and
// REPORTED rather than guessed at.
//
// A fit over exactly two stations always has residual 0 -- a plane
// similarity has four degrees of freedom and two points supply four
// equations -- so this threshold only ever bites at three or more.
// With two, the pair IS the definition of the rigid piece and the
// honest answer is to follow them.
CsRevise.LINEWORK_RESIDUAL_FRACTION = 1e-3;

/**
 * Is this entity DERIVED -- a shaped line's ornament or an area's tile,
 * regenerated from the spine or boundary it belongs to? Those follow
 * their parent and are never tied to a station of their own.
 */
CsRevise.isDerivedGeometry = function(entity) {
    return CsBind.isDerived(entity);
};

/**
 * Where a callout's tip belongs, read off the SURVEY it was cut on
 * rather than off its own geometry: a cross section's leg and fraction
 * (or the station a sketch is leadered to), or the leg and fraction an
 * elevation label was sampled at. Answers a {x, y} in the frame `pos`
 * describes, or null when the callout carries no provenance or a
 * station it names is not in `pos`.
 *
 * This is the exact answer where moveLinework's moving-least-squares
 * guess would only be a close one -- the tip IS a point on a leg, so it
 * goes where that leg's end stations took it.
 *
 * \param members [{entity, layer}] one callout's pieces
 * \param pos     {name: {x, y}}
 * \return {x, y, sketch} -- sketch is true for a traced section, whose
 *         leader CalloutWrite.refreshSections re-aims on its own
 */
CsRevise.calloutProvenance = function(members, pos) {
    if (typeof CsCallout === "undefined") {
        return null;
    }
    var K = CsCallout.KEY;
    var sketch = false;
    for (var i = 0; i < members.length; i++) {
        if (CsTags.get(members[i].entity, K.SECTION_SOURCE) ===
                CsCallout.SOURCE_SKETCH) {
            sketch = true;
        }
    }
    var legAt = function(a, b, t) {
        if (!pos.hasOwnProperty(a) || !pos.hasOwnProperty(b) || isNaN(t)) {
            return null;
        }
        return { x: pos[a].x + (pos[b].x - pos[a].x) * t,
            y: pos[a].y + (pos[b].y - pos[a].y) * t, sketch: sketch };
    };
    for (var m = 0; m < members.length; m++) {
        var e = members[m].entity;
        var st = CsTags.get(e, K.SECTION_STATION);
        if (st !== "") {
            return pos.hasOwnProperty(st) ?
                { x: pos[st].x, y: pos[st].y, sketch: sketch } : null;
        }
        var sf = CsTags.get(e, K.SECTION_FROM);
        if (sf !== "") {
            return legAt(sf, CsTags.get(e, K.SECTION_TO),
                parseFloat(CsTags.get(e, K.SECTION_FRACTION)));
        }
        var ef = CsTags.get(e, K.ELEV_FROM);
        if (ef !== "") {
            return legAt(ef, CsTags.get(e, K.ELEV_TO),
                parseFloat(CsTags.get(e, K.ELEV_FRACTION)));
        }
    }
    return null;
};

/**
 * Reconnects what a revision's move left apart: a traced section's
 * leader points at a STATION and its block is the caver's, so after the
 * block has followed the station the leader is re-aimed at both
 * (CalloutWrite.refreshSections does exactly that, idempotently). Soft
 * dependency -- a context without the callout tools just skips it.
 */
CsRevise.settleSections = function(doc, di) {
    try {
        if (typeof CalloutWrite !== "undefined" &&
                typeof CalloutWrite.refreshSectionsFromDocument ===
                    "function") {
            CalloutWrite.refreshSectionsFromDocument(doc, di);
        }
    } catch (eSettle) {
        // the sections moved either way; a leader left a little off is
        // visible and fixed by the next Draw
    }
};

/**
 * Moves hand-traced linework so it follows the stations it was traced
 * against. QCAD context only.
 *
 * Called by every path that erases the survey marks and redraws them
 * from revised data -- CsRevise.apply's non-rigid branch, the Survey
 * Notebook's Draw when the page revises a trip already in the drawing,
 * and CsProfileDraw.render for the profile side -- and by NO path that
 * transforms the drawing whole. The rigid branch of apply already
 * carries every traced entity along in its single whole-drawing
 * operation, so running this there would move the same entity twice.
 *
 * Every entity on a linework layer (CsBind.isLineworkLayer is the one
 * gate; it consults WORLD_FIXED_LAYERS above, so sheet furniture is
 * excluded from here for free) carrying either linework tag gets a
 * control-point set: its own bound stations' old -> new positions, per
 * the order of preference below. What happens with that set depends on
 * the entity's type:
 *
 *   Polyline / Spline   every vertex / control point warps
 *                        INDIVIDUALLY through CsWarp.mlsSimilarity, so
 *                        one entity can bend along its length. Bulges
 *                        are left as-is -- a documented approximation
 *                        when the two vertices either side of a bulge
 *                        warp by slightly different local
 *                        rotation/scale, not expected to be visible at
 *                        normal trace density.
 *   Line                 both endpoints warp individually, same as a
 *                        two-vertex polyline.
 *   Arc / Circle          the center warps through CsWarp.mlsSimilarity;
 *                        the radius scales by that call's local
 *                        `factor`; and the entity is then rotated about
 *                        its NEW center by that call's local `angle`,
 *                        so an arc's start/end angles follow the local
 *                        rotation and its endpoints stay on the walls
 *                        they were snapped to. (A circle is
 *                        rotationally symmetric, so the rotation is a
 *                        no-op for it -- this matters to arcs.)
 *   Block reference /    SYMBOLS AND NOTES. Anchored at one point -- the
 *   Text                  insertion point -- which warps through
 *                         CsWarp.mlsSimilarity like any vertex. A SYMBOL
 *                         is turned by that call's local `angle` about
 *                         its own position; TEXT only SLIDES and stays
 *                         upright, so a note is always read the right
 *                         way up. NEVER SCALED: a
 *                         symbol's size and a note's height are
 *                         plotting conventions, not survey data, and a
 *                         local `factor` of 1.04 must not make one
 *                         stalactite 4% fatter than its neighbour. The
 *                         old whole-entity rigid fit refused these the
 *                         moment three or more bound stations stopped
 *                         agreeing -- i.e. on every real adjustment --
 *                         so symbols and notes sat where they were
 *                         while the walls moved off them.
 *   Callout               A LINKED PAIR (text + leader[s], see
 *                         CsCallout), so it moves as ONE rigid unit: the
 *                         leader's tip (vertex 0, the arrow end) is the
 *                         anchor that warps, and every member -- text,
 *                         every leader -- takes that anchor's
 *                         translation (no turn: a callout is writing).
 *                         The tip stays on the feature
 *                         it points at, and the note keeps exactly the
 *                         layout it was given, rather than each member
 *                         warping separately and the leader tearing
 *                         away from its text.
 *   anything else         (hatches, images, ...) keeps the ORIGINAL
 *                         whole-entity rigid similarity fit,
 *                         residual-checked against
 *                         CsRevise.LINEWORK_RESIDUAL_FRACTION exactly as
 *                         before: a large entity has no single anchor
 *                         that describes it, so it is left and REPORTED
 *                         rather than guessed at.
 *
 * Its control-point set, in order of preference, per the original
 * binding spec:
 *
 *   its listed stations   LineworkStations, those still resolvable in
 *                         both frames. One station gives a pure
 *                         translation (CsWarp.mlsSimilarity's 1-pair
 *                         case, or similarityFit's for the fallback
 *                         path).
 *   its trip's stations   nothing listed survived -- fit over every
 *                         station of its LineworkTrip instead, so the
 *                         entity at least follows the passage it
 *                         belongs to.
 *   neither               left exactly where it is and REPORTED.
 *                         Never guessed at silently.
 *
 * An UNTAGGED entity is not this function's problem: both callers run
 * CsBind.planAutoBind before their erase and CsBind.commitAutoBind
 * before calling here, so by now anything bindable is bound. What is
 * still untagged when this runs is untagged on purpose -- it binds to
 * no station, or the user switched automatic binding off -- and is
 * left alone for the same reason it always was: we cannot know what it
 * belongs to, and inventing an answer moves the wrong geometry.
 *
 * \param doc, di       document and its interface
 * \param oldPos        {name: {x, y}} station positions BEFORE the
 *                      revision -- the frame the tracing was drawn in
 * \param newPos        {name: {x, y}} station positions AFTER it
 * \param tripStations  {tripId: [names]} for the fallback
 * \param extent        drawing extent for the fallback path's residual
 *                      threshold
 * \return { moved, warped, unmoved } -- moved and warped are counts
 *         (an entity is one or the other, never both), unmoved a list
 *         of "LAYER #id" labels for the report
 */
CsRevise.moveLinework = function(doc, di, oldPos, newPos, tripStations,
        extent) {
    var result = { moved: 0, warped: 0, unmoved: [], untied: [] };
    // Soft dependency, the mirror of CsBind's on this module: nothing
    // else in CsRevise needs CsBind, and a caller that loaded only
    // half the Core should get "no linework" rather than a throw.
    if (typeof CsBind === "undefined") {
        return result;
    }
    var ex = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var tol = CsRevise.LINEWORK_RESIDUAL_FRACTION * Math.max(ex, 1);

    /** old -> new pairs for the names resolvable in BOTH frames. */
    var pairsFor = function(names) {
        var pairs = [];
        var seen = {};
        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            if (nm === undefined || nm === null || nm === "" ||
                    seen[nm] === true) {
                continue;
            }
            seen[nm] = true;
            if (!oldPos.hasOwnProperty(nm) || !newPos.hasOwnProperty(nm)) {
                continue;
            }
            pairs.push({ old: { x: oldPos[nm].x, y: oldPos[nm].y },
                nu: { x: newPos[nm].x, y: newPos[nm].y } });
        }
        return pairs;
    };

    /** Every vertex a warpable entity type exposes, as plain RVector --
     *  the ORIGINAL (pre-warp) positions CsWarp.mlsSimilarity is
     *  evaluated at, one call per point, before any of them are written
     *  back (see the apply loop below for why: writing them back one at
     *  a time is unsafe).
     *  Polyline: real vertices only, NOT getReferencePoints() -- that
     *  also returns synthetic bulge-midpoint handles, and warping one of
     *  those would reshape the bulge instead of relocating a vertex
     *  (probed live: a 3-vertex polyline with one bulge answers 5
     *  reference points). Line and Spline: getReferencePoints() IS
     *  exactly their real points (2 endpoints; every control point
     *  respectively), no synthetic extras, probed live the same way. */
    var warpableVertices = function(ent) {
        if (ent instanceof RPolylineEntity) {
            var pts = [];
            for (var i = 0; i < ent.countVertices(); i++) {
                var v = ent.getVertexAt(i);
                pts.push(new RVector(v.x, v.y));
            }
            return pts;
        }
        if (ent instanceof RSplineEntity) {
            var spts = [];
            for (var j = 0; j < ent.countControlPoints(); j++) {
                var cp = ent.getControlPointAt(j);
                spts.push(new RVector(cp.x, cp.y));
            }
            return spts;
        }
        if (ent instanceof RLineEntity) {
            return ent.getReferencePoints();
        }
        return null;
    };

    var origin = new RVector(0, 0);
    var op = new RModifyObjectsOperation();
    op.setText("Move traced linework");
    // every op.addObject(ent, false) below: false keeps its own layer
    var anyMoved = false;
    var ids = doc.queryAllEntities(false, false);

    /** Turns an entity by `angle` about `about` and slides it by
     *  (dx, dy): a rotation-and-translation with no scale, which is what
     *  a symbol or a note is owed. */
    var carry = function(entity, about, angle, dx, dy) {
        if (Math.abs(angle) > 1e-12) {
            entity.rotate(angle, about);
        }
        entity.move(new RVector(dx, dy));
    };

    // ---- CALLOUTS, as units ---------------------------------------
    // A callout is a text and one or more leaders joined by a shared
    // CalloutId. They are bound one by one like anything else, but they
    // must MOVE together: see the docblock. Grouped first so the main
    // loop can leave their members alone.
    var handled = {};
    if (typeof CsCallout !== "undefined" && typeof CsTags !== "undefined") {
        var groups = {};
        var groupOrder = [];
        for (var gi = 0; gi < ids.length; gi++) {
            var ge = doc.queryEntity(ids[gi]);
            if (isNull(ge)) {
                continue;
            }
            var gid = CsTags.get(ge, CsCallout.KEY.ID);
            if (gid === "") {
                continue;
            }
            // A station note the Notebook drew (NoteLeader / NoteLabel)
            // is the suite's own output: Draw erases and redraws it at
            // the revised station, so it is not moved here.
            if (CsBind.isSuiteGeometry(ge)) {
                continue;
            }
            var glayer = CsBind.layerNameOf(doc, ge);
            if (!CsBind.isLineworkLayer(glayer)) {
                continue;
            }
            if (!groups.hasOwnProperty(gid)) {
                groups[gid] = [];
                groupOrder.push(gid);
            }
            groups[gid].push({ entity: ge, layer: glayer });
        }
        for (var go = 0; go < groupOrder.length; go++) {
            var members = groups[groupOrder[go]];
            // The anchor: the first leader's tip (vertex 0 is the arrow
            // end); with no leader, the text's own position.
            var anchor = null;
            var pairsForGroup = [];
            var tipOwner = -1;
            for (var mi = 0; mi < members.length && anchor === null; mi++) {
                if (members[mi].entity instanceof RLeaderEntity) {
                    var ld = members[mi].entity.getData();
                    if (ld.countVertices() > 0) {
                        var tp = ld.getVertexAt(0);
                        anchor = { x: tp.x, y: tp.y };
                        tipOwner = mi;
                    }
                }
            }
            if (anchor === null) {
                for (var ti2 = 0; ti2 < members.length && anchor === null;
                        ti2++) {
                    if (members[ti2].entity instanceof RTextEntity) {
                        var tpos = members[ti2].entity.getPosition();
                        anchor = { x: tpos.x, y: tpos.y };
                        tipOwner = ti2;
                    }
                }
            }
            if (anchor === null) {
                continue;
            }
            // The control stations: the tip's own member first, then
            // any other member's list, then the trip fallback.
            var tryOrder = [tipOwner];
            for (var oi = 0; oi < members.length; oi++) {
                if (oi !== tipOwner) { tryOrder.push(oi); }
            }
            for (var qi = 0; qi < tryOrder.length && pairsForGroup.length === 0;
                    qi++) {
                var qe = members[tryOrder[qi]].entity;
                pairsForGroup = pairsFor(CsBind.decodeStations(
                    CsTags.get(qe, CsBind.STATIONS_TAG)));
            }
            if (pairsForGroup.length === 0) {
                for (var ri = 0; ri < members.length &&
                        pairsForGroup.length === 0; ri++) {
                    var rt = CsTags.getNumber(members[ri].entity,
                        CsBind.TRIP_TAG);
                    if (rt !== null && tripStations !== undefined &&
                            tripStations !== null &&
                            tripStations.hasOwnProperty(rt)) {
                        pairsForGroup = pairsFor(tripStations[rt]);
                    }
                }
            }
            for (var hi = 0; hi < members.length; hi++) {
                handled[members[hi].entity.getId()] = true;
            }
            var glabel = members[0].layer + " callout #" +
                CsTags.get(members[0].entity, CsCallout.KEY.ID);
            // A CROSS SECTION OR AN ELEVATION LABEL IS CUT ON A LEG, and
            // says which in its own tags. Its tip goes where that leg's
            // stations went -- exact, and needing no station list of its
            // own. A traced section's LEADER is left out: it points at
            // a station, CalloutWrite.refreshSections has already
            // re-aimed it there, and moving it again would carry it a
            // second time. The block and any text move; settleSections
            // reconnects the leader afterwards.
            var wasAt = CsRevise.calloutProvenance(members, oldPos);
            var nowAt = CsRevise.calloutProvenance(members, newPos);
            if (wasAt !== null && nowAt !== null) {
                for (var pi = 0; pi < members.length; pi++) {
                    var pm = members[pi];
                    if (CsRevise.isWorldFixedLayer(pm.layer)) {
                        continue;
                    }
                    if (nowAt.sketch === true &&
                            pm.entity instanceof RLeaderEntity) {
                        continue;
                    }
                    carry(pm.entity, new RVector(wasAt.x, wasAt.y), 0,
                        nowAt.x - wasAt.x, nowAt.y - wasAt.y);
                    op.addObject(pm.entity, false);
                }
                anyMoved = true;
                result.moved++;
                continue;
            }
            if (pairsForGroup.length === 0) {
                result.unmoved.push(glabel);
                continue;
            }
            var gw = CsWarp.mlsSimilarity(anchor, pairsForGroup);
            if (!isFinite(gw.x) || !isFinite(gw.y) || !isFinite(gw.angle)) {
                result.unmoved.push(glabel);
                continue;
            }
            var about = new RVector(anchor.x, anchor.y);
            for (var ci = 0; ci < members.length; ci++) {
                var cm = members[ci].entity;
                // A world-fixed member stays; nothing about a callout
                // makes its sheet furniture part of the cave.
                if (CsRevise.isWorldFixedLayer(members[ci].layer)) {
                    continue;
                }
                // SLIDES, NEVER TURNS (Nathan, 2026-10-04: "keep notes
                // upright and only slide"). Writing is read the right
                // way up whatever the ground under it did.
                carry(cm, about, 0, gw.x - anchor.x, gw.y - anchor.y);
                op.addObject(cm, false);
            }
            anyMoved = true;
            result.moved++;
        }
    }

    for (var i = 0; i < ids.length; i++) {
        var ent = doc.queryEntity(ids[i]);
        if (isNull(ent)) {
            continue;
        }
        if (handled[ent.getId()] === true) {
            continue;
        }
        var layer = CsBind.layerNameOf(doc, ent);
        if (!CsBind.isLineworkLayer(layer)) {
            continue;
        }
        // EITHER tag, not just the station list: an entity bound with
        // source "trip" snapped to nothing and so carries only
        // LineworkTrip. Keying on LineworkStations alone would skip
        // exactly the entities that need the trip fallback.
        if (!CsBind.hasLineworkTags(ent)) {
            // Drawn on a plan feature layer and tied to NO station: it
            // cannot follow anything, and a revision that says nothing
            // about it leaves a surveyor to find out from the printout.
            // Counted here, named in the summary. Not our own output
            // (survey marks, ornaments, tiles), not a scan or the
            // aerial (they have their own anchoring), not the elevation.
            if (CsLayers.frameOf(layer) === "plan" &&
                    !CsBind.isSuiteGeometry(ent) &&
                    !(ent instanceof RImageEntity) &&
                    !CsRevise.isDerivedGeometry(ent)) {
                result.untied.push(layer + " #" + ent.getId());
            }
            continue;
        }
        // our own output, should it ever have picked up a linework tag:
        // the redraw just placed it, and moving it again would apply
        // the revision to it twice
        if (CsBind.isSuiteGeometry(ent)) {
            continue;
        }

        var label = layer + " #" + ent.getId();
        var pairs = pairsFor(CsBind.decodeStations(
            CsTags.get(ent, CsBind.STATIONS_TAG)));
        if (pairs.length === 0) {
            var trip = CsTags.getNumber(ent, CsBind.TRIP_TAG);
            trip = (trip === null) ? 0 : trip;
            if (tripStations !== undefined && tripStations !== null &&
                    tripStations.hasOwnProperty(trip)) {
                pairs = pairsFor(tripStations[trip]);
            }
        }
        if (pairs.length === 0) {
            result.unmoved.push(label);
            continue;
        }

        if (ent instanceof RArcEntity || ent instanceof RCircleEntity) {
            var oldCenter = ent.getCenter();
            var oldRadius = ent.getRadius();
            var cw = CsWarp.mlsSimilarity(
                { x: oldCenter.x, y: oldCenter.y }, pairs);
            // A non-finite factor, or one so close to zero the radius it
            // would produce is effectively zero, is mlsSimilarity's
            // honest answer when this control-point layout leaves the
            // local scale untrustworthy -- the same "no honest answer,
            // leave it and report" outcome the pairs.length === 0 case
            // above already uses, rather than collapsing (or
            // ballooning) the radius on a guess.
            if (!isFinite(cw.factor) ||
                    cw.factor * oldRadius <= 1e-6 * oldRadius) {
                result.unmoved.push(label);
                continue;
            }
            ent.move(new RVector(cw.x - oldCenter.x, cw.y - oldCenter.y));
            ent.setRadius(oldRadius * cw.factor);
            // The center is only two thirds of an arc: its ENDPOINTS
            // are where it meets the walls it was snapped to, and those
            // are start/end ANGLE, which neither move() nor setRadius()
            // touches. Without this, an arc under a locally-rotating
            // adjustment keeps its original absolute orientation while
            // its center slides -- endpoints off by 2r*sin(theta/2),
            // reported as a success. Rotating about the NEW center
            // (placed by the move above) turns the start/end angles by
            // the local rotation without disturbing that center. The
            // pre-warp code did this as ent.rotate(fit.theta, origin)
            // for every entity type; the per-vertex types below get the
            // same effect for free from moving their vertices
            // individually, but a center-plus-radius entity does not.
            // Harmless for a circle, which is rotationally symmetric.
            ent.rotate(cw.angle, new RVector(cw.x, cw.y));
            op.addObject(ent, false);
            anyMoved = true;
            result.moved++; // a single point has nothing to disagree with
            continue;
        }

        var verts = warpableVertices(ent);
        // An empty (but non-null) result is a fit-point-only spline
        // (countControlPoints() === 0, real for one authored by
        // clicking through points rather than via control points) --
        // no honest answer either, same as pairs.length === 0 above:
        // the rebuild loop below would run zero times and install a
        // fresh, EMPTY RSplineData via setShape, corrupting the
        // entity. Leave it and report instead of attempting a move.
        if (verts !== null && verts.length === 0) {
            result.unmoved.push(label);
            continue;
        }
        if (verts !== null) {
            var angles = [], factors = [], news = [];
            for (var vi = 0; vi < verts.length; vi++) {
                var oldV = verts[vi];
                var vw = CsWarp.mlsSimilarity({ x: oldV.x, y: oldV.y },
                    pairs);
                news.push(new RVector(vw.x, vw.y));
                angles.push(vw.angle);
                factors.push(vw.factor);
            }
            // Apply every new position in one pass, addressed by INDEX
            // or ROLE rather than by moveReferencePoint's VALUE search.
            // Confirmed against this engine's own source
            // (RLineData/RPolylineData/RSplineData::moveReferencePoint,
            // src/entity/*.cpp): each one moves EVERY current point
            // that fuzzy-equals the given old point, not just one. On a
            // real cave survey, stations are often evenly spaced, so a
            // warped vertex's NEW position routinely lands exactly on
            // another not-yet-warped vertex's OLD position -- probed
            // live with a straight two-station profile line (10 ft
            // spacing, uniform +10 ft shift): moving vertex 0 first
            // left it sitting on vertex 1's untouched old value, so the
            // second moveReferencePoint(oldV1, newV1) call matched BOTH
            // points and dragged vertex 0 along a second time,
            // collapsing the whole line onto vertex 1's new position.
            //
            // getData() returns a COPY in this engine's script binding
            // (probed live: mutating it through RPolylineData.setVertexAt
            // or RSplineData.setControlPoints never reaches the entity
            // actually in the document), so every replacement below goes
            // through an ENTITY-level method instead -- the same family
            // as the rotate/move/scale the fallback path already uses,
            // confirmed live to persist through a modify operation.
            if (ent instanceof RPolylineEntity) {
                // No entity-level setVertexAt in this build (only
                // RPolylineData has one, and getData() doesn't write
                // back -- see above), so rebuild wholesale: clear()
                // does not touch isClosed (probed live), and reading
                // each bulge before clearing and re-appending it keeps
                // bulges byte-identical, same as the old whole-entity
                // path never touched them at all.
                var bulges = [];
                for (var bi = 0; bi < news.length; bi++) {
                    bulges.push(ent.getBulgeAt(bi));
                }
                ent.clear();
                for (var ai = 0; ai < news.length; ai++) {
                    ent.appendVertex(news[ai], bulges[ai]);
                }
            } else if (ent instanceof RLineEntity) {
                ent.setStartPoint(news[0]);
                ent.setEndPoint(news[1]);
            } else if (ent instanceof RSplineEntity) {
                // Same getData()-doesn't-write-back trap as the
                // polyline above; setShape (confirmed live to persist)
                // takes a whole new shape, so build one and swap it in
                // rather than mutating in place. Scope matches this
                // feature's own: a control-point spline, degree and
                // periodic state preserved; a fit-point-only spline
                // (countControlPoints() === 0) never reaches this
                // branch as a real warp in the first place -- see
                // warpableVertices above.
                var newSpline = new RSplineData();
                for (var si = 0; si < news.length; si++) {
                    newSpline.appendControlPoint(news[si]);
                }
                newSpline.setDegree(ent.getDegree());
                if (ent.isPeriodic()) {
                    newSpline.setPeriodic(true);
                }
                newSpline.update();
                ent.setShape(newSpline);
            }
            op.addObject(ent, false);
            anyMoved = true;
            var minA = Math.min.apply(null, angles),
                maxA = Math.max.apply(null, angles);
            var minF = Math.min.apply(null, factors),
                maxF = Math.max.apply(null, factors);
            var bent = (maxA - minA > 1e-6) ||
                (Math.abs(maxF - minF) > 1e-6 * Math.max(1, maxF));
            if (bent) {
                result.warped++;
            } else {
                result.moved++;
            }
            continue;
        }

        // SYMBOLS AND NOTES: one anchor, warped like any vertex, turned
        // by the local rotation and never scaled -- see the docblock.
        //
        // NOT THE DERIVED ONES. A shaped line's ornament and an area's
        // tiles are block references too, but they are regenerated from
        // their spine or boundary -- which this very pass has just
        // warped -- and warping each glyph on its own as well would
        // fight the regeneration. They keep the path they always had.
        var derived = CsRevise.isDerivedGeometry(ent);
        var anchored = !derived && ((ent instanceof RBlockReferenceEntity) ||
            (ent instanceof RTextEntity) ||
            (typeof RLeaderEntity !== "undefined" &&
                ent instanceof RLeaderEntity));
        if (anchored) {
            var apos = (ent instanceof RLeaderEntity) ?
                ent.getData().getVertexAt(0) : ent.getPosition();
            var aw = CsWarp.mlsSimilarity({ x: apos.x, y: apos.y }, pairs);
            if (!isFinite(aw.x) || !isFinite(aw.y) || !isFinite(aw.angle)) {
                result.unmoved.push(label);
                continue;
            }
            // A symbol turns with the ground under it; writing does not.
            var turns = (ent instanceof RBlockReferenceEntity) ? aw.angle : 0;
            carry(ent, new RVector(apos.x, apos.y), turns,
                aw.x - apos.x, aw.y - apos.y);
            op.addObject(ent, false);
            anyMoved = true;
            result.moved++;
            continue;
        }

        // anything else (blocks, text, ...): unchanged whole-entity
        // rigid path, residual refusal included -- see this function's
        // docblock for why this boundary exists.
        var fit = CsRevise.similarityFit(pairs);
        // Infinity is similarityFit's honest answer when the old points
        // all coincide and the rotation is underdetermined -- exactly
        // the case where a fit must not be trusted.
        if (fit === null || !isFinite(fit.maxResidual) ||
                fit.maxResidual > tol) {
            result.unmoved.push(label);
            continue;
        }
        ent.rotate(fit.theta, origin);
        if (Math.abs(fit.scale - 1.0) > 1e-9) {
            ent.scale(fit.scale, origin);
        }
        ent.move(new RVector(fit.tx, fit.ty));
        op.addObject(ent, false);
        anyMoved = true;
        result.moved++;
    }
    if (anyMoved) {
        di.applyOperation(op);
    }
    return result;
};

// ---------------------------------------------------------------------
// Argument prep for moveLinework, and the words for its outcome.
//
// There are TWO ways to revise a trip in place -- apply's non-rigid
// branch below, and the Survey Notebook's erase-and-redraw Draw -- and
// both owe the traced linework the same treatment. Every scrap of prep
// they share lives here, so the second caller cannot quietly grow a
// copy that drifts from the first.
// ---------------------------------------------------------------------

/**
 * Runs fn with every OFF layer that holds movable entities switched
 * on, restoring each afterwards. QCAD context only.
 *
 * Exists because this build silently refuses adds, MODIFIES and
 * deletes for entities on a layer that is off (CsLayers.withLayerOn
 * has the empirical note): a pass that touches entities wherever they
 * happen to sit is simply lost on those layers without it. Layers are
 * nested one wrapper deep each, since withLayerOn handles one name.
 * World-fixed layers are skipped -- nothing on them is ever modified,
 * so toggling them would be a visible change for no reason.
 *
 * \return whatever fn returns
 */
CsRevise.withOffLayersOn = function(doc, di, fn) {
    var offLayers = [];
    var seen = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var ln = doc.getLayerName(e.getLayerId());
        if (seen[ln] === true || CsRevise.isWorldFixedLayer(ln)) {
            continue;
        }
        seen[ln] = true;
        try {
            var lay = doc.queryLayer(ln);
            // OFF **or FROZEN**. Frozen refuses operations exactly as off
            // does, and collecting only the off ones left a
            // frozen-but-visible-in-the-list layer unwrapped -- so its
            // DELETES were refused while CsLayers.withLayerOn (which
            // does clear frozen) let the matching ADDS through. The
            // as-surveyed ghost on a frozen CTRL-RAW then accumulated a
            // fresh copy on every redraw: five copies of the same
            // geometry in a real drawing before this was caught.
            if (CsLayers.refusesEdits(lay)) {
                offLayers.push(ln);
            }
        } catch (eOff) {
            // this bridge cannot toggle layers -- run anyway, the
            // operation may still land
        }
    }
    // ONE operation each way. The recursion this replaces cost two
    // applyOperation calls per off layer, and in the GUI each of those
    // refreshes the layer list and regenerates the view.
    return CsLayers.withLayersOn(doc, di, offLayers, fn);
};

/**
 * {name: {x, y}} for every tagged station point in the drawing.
 *
 * Both of moveLinework's frames come from here, because the drawing is
 * the truth about where a station actually sits -- and on the notebook
 * path it is the ONLY record of the old frame, so a caller must read
 * it BEFORE the erase that deletes the marks holding it.
 */
CsRevise.stationPositions = function(doc) {
    var out = {};
    var sts = CsTags.collectStations(doc);
    for (var i = 0; i < sts.length; i++) {
        out[sts[i].name] = { x: sts[i].pos.x, y: sts[i].pos.y };
    }
    return out;
};

/**
 * {tripId: [station names]} for moveLinework's trip fallback. Read
 * from the survey the drawing was reconstructed FROM: a LineworkTrip
 * tag names the trip as it stood when the tracing happened, so those
 * are the names it could have been bound to.
 */
CsRevise.tripStationNames = function(survey) {
    var out = {};
    if (survey === undefined || survey === null ||
            survey.shots === undefined) {
        return out;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        var key = sh.trip || 0;
        if (out[key] === undefined) {
            out[key] = [];
        }
        out[key].push(sh.from);
        out[key].push(sh.to);
    }
    return out;
};

/**
 * Bounding-box diagonal of a {name: {x, y[, z]}} map -- the
 * characteristic drawing size classifyChange and moveLinework both
 * scale their tolerances by, so that a cave in feet and the same cave
 * in metres decide identically. A map without z (positions read off
 * the drawing) measures in plan, which is the frame a linework fit
 * works in anyway.
 */
CsRevise.positionsExtent = function(positions) {
    var minX = null, minY = null, minZ = null;
    var maxX = null, maxY = null, maxZ = null;
    for (var n in positions) {
        if (!positions.hasOwnProperty(n)) {
            continue;
        }
        var p = positions[n];
        var z = (typeof p.z === "number" && isFinite(p.z)) ? p.z : 0;
        if (minX === null || p.x < minX) { minX = p.x; }
        if (maxX === null || p.x > maxX) { maxX = p.x; }
        if (minY === null || p.y < minY) { minY = p.y; }
        if (maxY === null || p.y > maxY) { maxY = p.y; }
        if (minZ === null || z < minZ) { minZ = z; }
        if (maxZ === null || z > maxZ) { maxZ = z; }
    }
    if (minX === null) {
        return 0.0;
    }
    var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * How many stations present in BOTH frames actually moved, at
 * classifyChange's own rigidity eps (1e-6 * max(extent, 1)) so the
 * two agree on what "changed at all" means.
 *
 * The notebook's Draw asks this before touching any linework: a page
 * that merely ADDS a trip disturbs no existing station, and moving
 * linework then would cost the user an undo step and a warning about
 * re-tracing for an event that did not happen.
 */
CsRevise.positionsMoved = function(oldPos, newPos, extent) {
    var e = (typeof extent === "number" && isFinite(extent)) ? extent : 0;
    var eps = 1e-6 * Math.max(e, 1);
    var n = 0;
    for (var name in oldPos) {
        if (!oldPos.hasOwnProperty(name) ||
                !newPos.hasOwnProperty(name)) {
            continue;
        }
        var dx = newPos[name].x - oldPos[name].x;
        var dy = newPos[name].y - oldPos[name].y;
        if (Math.sqrt(dx * dx + dy * dy) > eps) {
            n++;
        }
    }
    return n;
};

/**
 * The one sentence that owns up to an automatic claim: how many
 * previously untagged entities this revision bound to the survey by
 * itself. "" when it claimed nothing.
 *
 * Said out loud, always, because that is the price of automatic. The
 * suite just wrote tags onto geometry the surveyor drew, and decided on
 * their behalf that it belongs to a trip. A user who disagrees can only
 * disagree with something they were told about -- and the number is
 * deliberately separate from the moved count, so "12 moved" cannot hide
 * "and 9 of those I claimed just now".
 *
 * Shared by both revision paths, and by CsReport when it is next
 * opened, so there is one wording of this fact and not three.
 */
CsRevise.lineworkClaimLine = function(bound) {
    var b = (bound === undefined || bound === null) ? 0 : bound;
    if (b <= 0) {
        return "";
    }
    return "Of those, " + b + " " + (b === 1 ? "was" : "were") +
        " bound automatically just now -- untagged hand-drawn work " +
        "that this revision recognised, tied to the stations it was " +
        "drawn against, and moved. Undo twice to put the tags back.";
};

/**
 * The linework outcome in words -- the one place these sentences are
 * written. CsReport.revisionSummary calls it with the fields off
 * CsRevise.apply's report, the notebook's Draw calls it with the same
 * numbers loose, and CsReport.profileSummary calls it for the profile
 * side (see that function's own comment for why one vocabulary serves
 * all three), so every caller tells the user one story rather than two.
 *
 * Lives here rather than in CsReport because CsReport formats that
 * report OBJECT and the notebook's Draw has no such object to hand --
 * it has these numbers and nothing else. The unit tests assert both
 * callers agree word for word, so a drift fails the build.
 *
 * \param bound         optional -- entities this revision bound by
 *                       itself
 * \param warped        optional -- of the traced entities that followed
 *                       the revision at all, how many did so by bending
 *                       per-vertex rather than moving as one rigid piece
 *                       -- disjoint from `moved`, never both (an entity
 *                       is one or the other). Defaults to 0.
 * \param stationsMoved optional, defaults to true (every existing
 *                       caller reaches this function only after a real
 *                       change: CsRevise.apply's non-rigid branch only
 *                       runs when classifyChange already found the
 *                       survey's shape changed, and the notebook's Draw
 *                       only calls this at all when its own
 *                       positionsMoved gate passed -- see that call
 *                       site). Pass `false` when moved===0 because there
 *                       was nothing to move in the first place (a first-
 *                       ever draw, or an idempotent redraw) rather than
 *                       because bound linework failed to follow real
 *                       station movement: CsProfileDraw.render's own
 *                       positionsMoved guard runs BEFORE every draw,
 *                       automatic or manual, so it is the one caller
 *                       that reaches this function on the "nothing
 *                       moved at all" path routinely, not just on a
 *                       genuine refusal -- see CsReport.profileSummary.
 * \return array of lines
 */
CsRevise.lineworkSummary = function(moved, unmoved, bound, stationsMoved,
        warped, untied) {
    var n = (moved === undefined || moved === null) ? 0 : moved;
    var w = (warped === undefined || warped === null) ? 0 : warped;
    var list = (unmoved === undefined || unmoved === null) ? [] : unmoved;
    var didStationsMove = (stationsMoved === undefined ||
        stationsMoved === null) ? true : !!stationsMoved;
    var lines = [];
    lines.push("Traced linework moved with its stations: " + (n + w) +
        (w > 0 ? " (" + w + " warped to follow a bend)" : ""));
    var claim = CsRevise.lineworkClaimLine(bound);
    if (claim !== "") {
        lines.push(claim);
    }
    if (list.length > 0) {
        lines.push("");
        // Four distinct causes land an entity in `unmoved`, and only
        // the first is "no station": no resolvable station pairs at
        // all; an incoherent rigid fit on text/blocks (residual past
        // LINEWORK_RESIDUAL_FRACTION); a degenerate radius factor on an
        // arc/circle; and a fit-point-only spline with no control
        // points to warp. Three of the four DO have surviving stations,
        // so wording this as "no surviving station" alone told the user
        // something untrue about most refusals. The remedy is the same
        // in all four cases, which is why they share one warning.
        lines.push("WARNING -- " + list.length + " traced item" +
            (list.length === 1 ? "" : "s") + " had no surviving " +
            "station to follow, or could not be moved honestly, and " +
            "did NOT move; re-trace walls and detail there:");
        // capped: this is a summary a beginner reads, not a manifest.
        // Soft read of the cap so this module stays loadable without
        // CsReport (the whole Core is loaded as separate files).
        var shown = (typeof CsReport !== "undefined" &&
            typeof CsReport.UNMOVED_SHOWN === "number") ?
            CsReport.UNMOVED_SHOWN : 8;
        var cap = Math.min(list.length, shown);
        for (var u = 0; u < cap; u++) {
            lines.push("  " + list[u]);
        }
        if (list.length > cap) {
            lines.push("  ... and " + (list.length - cap) + " more");
        }
    }
    var loose = (untied === undefined || untied === null) ? [] : untied;
    if (loose.length > 0) {
        // Named by layer, with a count: a surveyor needs to know WHAT
        // was left behind (and so where to look), not a hundred ids.
        var byLayer = {};
        var order = [];
        for (var li = 0; li < loose.length; li++) {
            var ln = String(loose[li]).replace(/ #.*$/, "");
            if (!byLayer.hasOwnProperty(ln)) {
                byLayer[ln] = 0;
                order.push(ln);
            }
            byLayer[ln]++;
        }
        lines.push("");
        lines.push("WARNING -- " + loose.length + " drawn item" +
            (loose.length === 1 ? "" : "s") + " sit" +
            (loose.length === 1 ? "s" : "") + " too far from any " +
            "station to be tied to the survey, so " +
            (loose.length === 1 ? "it" : "they") + " did NOT move:");
        var shownLayers = Math.min(order.length, 8);
        for (var oi = 0; oi < shownLayers; oi++) {
            lines.push("  " + order[oi] + " x" + byLayer[order[oi]]);
        }
        if (order.length > shownLayers) {
            lines.push("  ... and " + (order.length - shownLayers) +
                " more layers");
        }
        lines.push("Move them near the survey or redraw them there, then " +
            "revise again.");
    }
    if (n === 0 && w === 0 && didStationsMove) {
        // Nothing was bound, so nothing could follow -- and an unbound
        // trace is invisible to us, which is why this stays a warning
        // even when the unmoved list above is empty. But this is only
        // true when something actually moved: on a first-ever draw (or
        // an idempotent redraw of an unchanged profile) moved===0
        // because there was NOTHING for a sketch to follow yet, not
        // because a sketch failed to follow it -- didStationsMove=false
        // says so, and the warning would otherwise fire on every clean
        // run of a feature that draws on every plan draw. A warped
        // entity followed the revision just as much as a rigidly-moved
        // one did -- moved===0 with warped>0 means everything that
        // could follow, did, just by bending rather than sliding as one
        // piece, so this warning must not fire on that case either.
        lines.push("");
        lines.push("WARNING -- hand-drawn linework that is not bound " +
            "to the survey did NOT move with it; re-trace walls and " +
            "detail near the moved stations, or bind it first " +
            "(Adopt linework) and revise again.");
    }
    return lines;
};

/**
 * The drawing's trip-0 anchor point, or null when the drawing has no
 * anchors at all -- the point the drawing-level tags (Declination
 * mirror, ExcludedShots/UnplacedShots, adjustment record) ride on.
 * Anchor points are the only entities
 * carrying BOTH a Station tag and a Trip tag -- legs carry Trip too,
 * but never Station -- and CsDraw tags exactly one per trip id, so the
 * scan below cannot be thrown off by the query order.
 *
 * Trip 0 when it is there: that is where the schema puts the
 * drawing-level tags, and a healthy drawing must not have them wander
 * between revisions.
 *
 * FALLBACK -- the LOWEST-numbered anchor present when there is no trip
 * 0. Drawings exist whose trips start at 1: CsModel.tripIdFor used to
 * append the first typed page past ensureTrips' blank placeholder
 * instead of occupying it, so every survey hand-entered in the
 * notebook before that was fixed came out with no trip 0 whatsoever.
 * Those drawings had no home for the drawing-level tags at all. The
 * lowest anchor is a stable one: it is the same point on every
 * revision, and it survives an erase-and-redraw the same way trip 0's
 * does.
 *
 * Newly built drawings should never reach the fallback --
 * CsModel.isPlaceholderTrip sees to it that a first page lands as trip
 * 0. It is here for the drawings already out in Nathan's cave files.
 *
 * Shared because more than one caller needs this same point (the
 * stats stamp, the declination revision's anchor bookkeeping). Two
 * hand-rolled copies of one scan is how one of them drifts.
 */
CsRevise.trip0Anchor = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var best = null;
    var bestTrip = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, "Station") === "" ||
                CsTags.get(e, "Trip") === "") {
            continue;
        }
        var trip = CsTags.getNumber(e, "Trip");
        if (trip === null || trip < 0) {
            continue; // an unreadable Trip tag is not a trip number
        }
        if (trip === 0) {
            return e;
        }
        if (best === null || trip < bestTrip) {
            best = e;
            bestTrip = trip;
        }
    }
    return best;
};

/**
 * The drawing's survey, reconstructed EXACTLY and resolved IN THE
 * DRAWING'S OWN FRAME: anchored at the recorded trip-0 anchor position
 * and elevation, adjusted under the drawing's own recorded options --
 * so resolved coordinates agree with the drawn geometry, loop legs and
 * branches included, and the vertical datum is the drawing's own (the
 * elevation-datum rule).
 *
 * THE ONE READ PATH for every tool that reports on or samples an
 * existing drawing (Survey Stats, the elevation callouts, Generate
 * Profile). Each of these used CsTags.surveyFromDocument -- the
 * chain-guess reader -- whose fabricated topology gave Survey Stats
 * zero loops and an inflated length, offered the callouts phantom legs
 * to sample, and fed the profile a shot list with a fake leg across
 * every branch boundary (2026-08-28, from Truitt's F survey). A
 * pre-v3 drawing still falls back to the chain guess inside
 * surveyFromDocument, exactly as those tools behaved before.
 *
 * 
eturn {survey, resolved, legacy}, or null when the drawing holds
 *         no readable survey.
 */
CsRevise.resolveAsDrawn = function(doc) {
    var recon = CsRevise.surveyFromDocument(doc);
    var survey = recon.survey;
    if (survey === null || survey === undefined ||
            survey.shots.length === 0) {
        return null;
    }
    var resolveOpts = {};
    if (recon.anchorName !== "" && recon.anchorPos !== null &&
            recon.anchorPos !== undefined) {
        resolveOpts.anchor = { name: recon.anchorName,
            x: recon.anchorPos.x, y: recon.anchorPos.y,
            z: recon.anchorZ };
    }
    var resolved = CsAdjust.resolveAndAdjust(survey, resolveOpts,
        CsAdjust.optionsFromTags(recon.adjustTags));
    return { survey: survey, resolved: resolved, legacy: recon.legacy };
};

/**
 * The adjustment record carried by one entity -- the trip-0 anchor --
 * as {Adjustment, SigmaTape, SigmaAngle}, shaped for
 * CsAdjust.optionsFromTags. A null or untagged entity yields "" in
 * every field, which optionsFromTags reads as "not recorded" and falls
 * back to the current settings for.
 *
 * One function owns these three tag NAMES on the read side, because
 * two readers of one record are two readers that can drift: a tool
 * with a reconstruction already in hand passes
 * recon.adjustTags (built here, from its own scan), and a tool that
 * only has the document passes CsRevise.trip0Anchor(doc) straight in.
 * CsDraw.survey is the single writer.
 *
 * Deliberately NOT interpreted here: what a blank field MEANS is
 * CsAdjust.optionsFromTags' question, and a second opinion about it on
 * this side of the record is the same drift by another route.
 */
CsRevise.adjustTagsOn = function(entity) {
    var get = function(key) {
        return (entity === null || entity === undefined) ? "" :
            CsTags.get(entity, key);
    };
    return { Adjustment: get("Adjustment"), SigmaTape: get("SigmaTape"),
        SigmaAngle: get("SigmaAngle") };
};

/**
 * Applies a revised survey model to the drawing it was reconstructed
 * from.
 *
 * Both the old survey (recon.survey) and newSurvey resolve over the
 * SAME anchor, so old station coordinates equal drawing coordinates
 * and the two results are directly comparable. That anchor is the one
 * point the revision pivots on -- the one point it does NOT move --
 * chosen in this order:
 *
 *   1. georef  the station named by the drawing's GeoStation tag, at
 *              its CURRENT position. It is the drawing's single point
 *              of contact with the real world (a basemap aligns to it,
 *              an export derives coordinates from it), so a revision
 *              must never move it. Taken only when that point is still
 *              in the drawing and takes part in the resolved network.
 *   2. trip0   recon.anchorName -- the trip-0 anchor -- at its CURRENT
 *              position.
 *   3. stale   recon.anchorPos, when the anchor point is gone from the
 *              drawing altogether.
 *
 * "Current" is load-bearing: recon.anchorPos was captured whenever
 * surveyFromDocument ran, and the point may have been dragged (by the
 * user, or by any other tool) in between. Resolving against the stale
 * value would compute the rigid translation for a position the entity
 * no longer occupies and land the whole drawing offset by
 * (I - R(theta)) * (stalePos - realPos). So apply re-reads positions
 * from the document -- the drawing is the truth. A trip-0 anchor drag
 * beyond 1e-9 is surfaced as report.anchorMoved {dx, dy} (the only
 * position the reconstruction snapshotted, hence the only one there is
 * anything to compare against); a vanished anchor point sets
 * report.anchorMissing. report.anchorUsed says which point won.
 *
 * The pivot's HEIGHT matters just as much, because both paths below
 * rewrite every station's Elevation tag from the resolve: pinned at 0,
 * a revision would rebase a cave surveyed to an absolute datum onto
 * the drawing's arbitrary origin and silently destroy that datum. So
 * the pivot resolves at the elevation the drawing records for it (see
 * CsRevise.anchorZOf) -- or, when the georeferenced station wins, at
 * the elevation the reconstruction gives THAT station on the same
 * datum.
 *
 * classifyChange then decides the strategy:
 *
 *   RIGID   the whole plan moved as one body (a declination revision,
 *           say). ONE modify operation transforms EVERY entity in the
 *           document -- survey marks AND hand-drawn linework -- by the
 *           fitted similarity, except entities on a world-fixed layer
 *           (see CsRevise.WORLD_FIXED_LAYERS). The same operation
 *           rewrites every tag the revision touched:
 *             leg/splay   Distance, Azimuth, BackAzimuth (when
 *                         present) and the four LRUD lengths, all from
 *                         the matching newSurvey shot
 *                         (matched by Trip + ShotSeq) and formatted
 *                         exactly as CsDraw's legTags would, so a
 *                         rewritten tag is byte-identical to a freshly
 *                         drawn one. Lengths matter because a rigid
 *                         revision can carry a uniform SCALE (a unit
 *                         re-interpretation): scaling the geometry and
 *                         leaving Distance/LRUD alone would make
 *                         surveyFromDocument faithfully reconstruct the
 *                         WRONG distances.
 *             station     Elevation (the resolved z, which a scale
 *                         changes) and, where newSurvey still fixes the
 *                         station, its Fixed "x,y,z" triple
 *             trip anchor TripDeclination/TripDeclinationSource/
 *                         TripDistanceUnit, plus on the trip-0 anchor
 *                         the legacy Declination/DeclinationSource/
 *                         DistanceUnit mirror, the regenerated
 *                         ExcludedShots/UnplacedShots row blobs (their
 *                         rows carry revised distances and azimuths of
 *                         their own). A stale RevisionLog from an older
 *                         build is stripped in passing.
 *           Station-point Azimuth and LRUD tags stay as-is (accepted
 *           stale -- the leg tags are canonical, and no reader takes
 *           shot data off a station point on a v3 drawing).
 *
 *   NOT     the survey genuinely changed shape: erase every station's
 *           marks (CsDraw.eraseStations) and redraw the revised survey
 *           in place (CsDraw.survey), which rewrites all v3 tags (and
 *           writes no RevisionLog -- the tag is retired; a stale one
 *           dies with the erased anchor). The GeoLat/GeoLon/
 *           GeoStation georeference anchor gets the same treatment --
 *           read off its station before the erase (CsDraw.survey has
 *           no field for it; see the module header) and recommitted
 *           after onto whichever point now carries that same Station
 *           name. When that station did not survive the revision (the
 *           leg it sat on got deleted), nothing is invented to carry
 *           it: report.geoAnchorLost names the lost station instead.
 *           Traced linework then follows the stations it was traced
 *           against, entity by entity (CsRevise.moveLinework): a wall
 *           over a corrected shot moves, one far away barely does.
 *           Anything with no surviving station to follow -- or that
 *           moveLinework can find no honest answer for; see its own
 *           docblock for the other three causes -- is left alone and
 *           named in report.lineworkUnmoved, and the re-trace warning
 *           is now that honest fallback rather than the default.
 *           UNTAGGED linework is bound first (CsBind.planAutoBind,
 *           before the erase, while the station index is still the
 *           frame it was drawn in) and moves with the rest, so a
 *           drawing that never heard of binding is revised correctly on
 *           its first revision. report.lineworkBound counts what that
 *           claimed.
 *
 * OFF-layer caveat, probed empirically in this build: add, MODIFY and
 * DELETE operations are all silently refused for entities on a layer
 * that is off. Any off layer holding survey entities (CTRL-HIDDEN's
 * legs) is therefore toggled on around the work via
 * CsLayers.withLayerOn and restored after.
 *
 * \param doc        the document
 * \param di         its document interface
 * \param recon      CsRevise.surveyFromDocument(doc) result the
 *                   revision started from
 * \param newSurvey  the revised CsModel survey
 * \return {
 *   rigid           which path ran
 *   moved           [{name, dist}] per shared station, largest first
 *   stationsChanged how many stations moved more than the rigidity eps
 *   loopsBefore     [{from, to, error, percent}] loop closures before.
 *                   AS-SURVEYED either side, even when the resolve was
 *                   adjusted -- see CsAdjust's honesty rule; adjusted
 *                   closures are ~0 by construction and reporting them
 *                   would launder every bad loop in the cave
 *   loopsAfter      the same loops after the revision
 *   anchorMoved     {dx, dy} when the PIVOT point (whichever won
 *                   below) had been
 *                   dragged since the reconstruction (null when it had
 *                   not); the revision used the CURRENT position
 *   anchorMissing   true when no point carrying the trip-0 anchor's
 *                   Station tag is left in the drawing, so
 *                   recon.anchorPos had to stand in
 *   anchorUsed      {name, source} the point the revision pivoted on;
 *                   source is "georef", "trip0" or "stale"
 *   lineworkMoved   how many traced entities followed their own
 *                   stations. 0 on the rigid path, where the single
 *                   whole-drawing transform carried them all already
 *   lineworkWarped  of the traced entities that followed the revision
 *                   on the non-rigid path, how many did so by bending
 *                   per-vertex rather than moving as one rigid piece --
 *                   disjoint from lineworkMoved, never both. Always 0
 *                   on the rigid path
 *   lineworkUntied  ["LAYER #id"] drawn plan items tied to no station
 *                   (too far from every one), which therefore cannot
 *                   follow a revision. Named in the report.
 *   lineworkUnmoved ["LAYER #id"] the traced entities that had no
 *                   surviving station to follow, or whose stations
 *                   moved too incoherently for one rigid move to
 *                   describe. Left exactly where they were
 *   lineworkBound   how many previously UNTAGGED entities this
 *                   revision bound to the survey itself, and so now
 *                   owns. A subset of lineworkMoved, reported apart
 *                   from it: see CsRevise.lineworkClaimLine
 *   geoAnchorLost   present (the lost station's name) only when a
 *                   non-rigid revision had a GeoLat/GeoLon/GeoStation
 *                   anchor to carry across the redraw but the station
 *                   it lived on is gone from the revised survey.
 *                   Absent entirely when there was no anchor to carry,
 *                   or it carried across fine -- so existing callers
 *                   that never check for it see no behavior change.
 * }
 */
CsRevise.apply = function(doc, di, recon, newSurvey) {
    CsModel.ensureTrips(recon.survey);
    CsModel.ensureTrips(newSurvey);

    // -- 0. the point this revision pivots on ------------------------
    // Read live, never from the reconstruction's snapshot: a revision
    // must land where its anchor actually IS. Both resolves (and the
    // non-rigid redraw) use the one choice made here.

    /** The current position of the point tagged Station = name, or
     *  null when the drawing has no such point any more. */
    var livePosOf = function(name) {
        if (name === "" || name === null || name === undefined) {
            return null;
        }
        var lids = doc.queryAllEntities(false, false);
        for (var lidx = 0; lidx < lids.length; lidx++) {
            var le = doc.queryEntity(lids[lidx]);
            if (isNull(le) || typeof le.getPosition !== "function") {
                continue;
            }
            if (CsTags.get(le, "Station") === name) {
                return le.getPosition();
            }
        }
        return null;
    };

    // The drawing's georeferenced station, read straight off the tags:
    // surveyFromDocument drops GeoLat/GeoLon/GeoStation (CsModel has no
    // geo field to put them in), so this module looks them up itself.
    var geoName = "";
    // Snapshotted here, before either revision path runs, so the
    // non-rigid path below can recommit it after CsDraw.survey redraws
    // the station it rides on out from under it (see the module
    // header). null when the drawing carries no geo anchor at all --
    // then there is nothing to carry and nothing to report.
    var geoAnchor = null;
    var gids = doc.queryAllEntities(false, false);
    for (var gi = 0; gi < gids.length; gi++) {
        var ge = doc.queryEntity(gids[gi]);
        if (isNull(ge)) {
            continue;
        }
        var gs = CsTags.get(ge, "GeoStation");
        if (gs !== "") {
            geoName = gs;
            geoAnchor = { station: gs, lat: CsTags.get(ge, "GeoLat"),
                lon: CsTags.get(ge, "GeoLon"),
                carried: CsLocationPick.carriedTags(ge) };
            break;
        }
    }

    var anchorName = recon.anchorName;
    var anchorPos = recon.anchorPos;
    var anchorSource = "stale";
    var anchorMoved = null;
    var anchorMissing = false;

    // trip-0 anchor, re-read (the drag Defect 2 was about)
    var trip0Live = livePosOf(recon.anchorName);
    if (recon.anchorName !== "" && recon.anchorName !== null &&
            recon.anchorName !== undefined) {
        if (trip0Live === null) {
            anchorMissing = true;
        } else {
            if (recon.anchorPos !== null && recon.anchorPos !== undefined) {
                var adx = trip0Live.x - recon.anchorPos.x;
                var ady = trip0Live.y - recon.anchorPos.y;
                if (Math.sqrt(adx * adx + ady * ady) > 1e-9) {
                    anchorMoved = { dx: adx, dy: ady };
                }
            }
            anchorPos = trip0Live;
            anchorSource = "trip0";
        }
    }

    // The pivot's HEIGHT, kept beside its position because both
    // resolves and the rigid path's Elevation rewrite hang off it: get
    // it wrong and the revision rebases the whole cave vertically.
    // Left null until something knows better than CsRevise.anchorZOf.
    var pivotZ = null;
    var anchorAt = function(name, pos, z) {
        return { name: name,
            x: pos !== null && pos !== undefined ? pos.x : 0.0,
            y: pos !== null && pos !== undefined ? pos.y : 0.0,
            z: (typeof z === "number" && !isNaN(z)) ? z :
                CsRevise.anchorZOf(recon, name) };
    };

    // The georeferenced station WINS. It is the drawing's one point of
    // contact with the real world -- pinned to a physical spot on the
    // ground, and what a basemap or a KML export derives real-world
    // coordinates from. Pivoting anywhere else moves it, silently
    // breaking every such derivation. It is only the trip-0 anchor by
    // coincidence, whenever the surveyor happens to georeference the
    // station the survey also starts at. Taken only when the point is
    // still in the drawing AND takes part in the resolved network
    // (probed with the trip-0 anchor, which is also the fallback
    // choice) -- a name that resolves to nothing would anchor the
    // revision to a phantom.
    if (geoName !== "" && geoName === anchorName && anchorSource === "trip0") {
        anchorSource = "georef"; // the same point, world-pinned as well
    } else if (geoName !== "" && geoName !== anchorName) {
        var geoLive = livePosOf(geoName);
        if (geoLive !== null) {
            // Probed in the RECONSTRUCTION frame (trip 0 where the
            // survey was read from, not where it sits now), because
            // this probe answers two questions and the second one only
            // makes sense in that frame: does the name resolve at all,
            // and where did the georeferenced point sit when we read
            // the drawing. Resolvability ignores the anchor position
            // entirely -- only connectivity decides it -- so anchoring
            // the probe this way costs nothing and keeps the drag
            // measurement honest.
            var probe = CsNetwork.resolve(recon.survey,
                { anchor: anchorAt(recon.anchorName, recon.anchorPos) });
            if (probe.stations.hasOwnProperty(geoName)) {
                // The pivot moves to the georeferenced point, so the
                // drag worth reporting moves with it: trip 0's offset
                // describes a station we no longer pivot on. Diff the
                // georeferenced point's live position against where
                // the reconstruction frame put it.
                var geoWas = probe.stations[geoName];
                var gdx = geoLive.x - geoWas.x;
                var gdy = geoLive.y - geoWas.y;
                anchorMoved = (Math.sqrt(gdx * gdx + gdy * gdy) > 1e-9) ?
                    { dx: gdx, dy: gdy } : null;
                anchorName = geoName;
                anchorPos = geoLive;
                anchorSource = "georef";
                // The pivot's z comes from the probe, not from the
                // anchor's datum: the probe already resolved the whole
                // network ON that datum, so geoWas.z IS this station's
                // datum-consistent elevation. Pinning it at the
                // anchor's own z instead would lift or drop every
                // elevation in the cave by the dz between the two.
                pivotZ = geoWas.z;
            }
        }
    }

    // -- 1. old and new resolved over the identical anchor -----------
    // BOTH SIDES, IDENTICALLY ADJUSTED. Adjust one and not the other
    // and similarityFit reads the adjustment itself as part of the
    // revision: a pure declination change stops classifying as rigid,
    // the drawing gets erased and redrawn, and untagged hand-traced
    // walls go with it. Both sides UNADJUSTED is no safer once the
    // drawing itself was drawn adjusted -- the rigid path rewrites
    // every station's Elevation tag from newResolved, so an unadjusted
    // resolve would snap the whole cave back to its as-surveyed
    // heights on a revision that cannot change an elevation at all.
    //
    // The options come from the DRAWING's own record rather than
    // today's settings, for exactly the reason a redraw does: this
    // revision has to describe the geometry that is actually on the
    // screen. optionsFromTags falls back to the settings for anything
    // the drawing does not record.
    var adjustOpts = CsAdjust.optionsFromTags(recon.adjustTags || {});
    if (geoName !== "" && geoName !== null && geoName !== undefined) {
        // The georeferenced station is the drawing's one point of
        // contact with the real world, and the revision already pivots
        // about it (see the anchor block above). PIN it, so least
        // squares cannot drift the one coordinate a basemap or a KML
        // export derives from. Harmless when it is also the anchor --
        // CsAdjust.adjust pins by name into a set.
        adjustOpts.pinned = [geoName];
    }
    var anchor = anchorAt(anchorName, anchorPos, pivotZ);
    var oldResolved = CsAdjust.resolveAndAdjust(recon.survey,
        { anchor: anchor }, adjustOpts);
    var newResolved = CsAdjust.resolveAndAdjust(newSurvey,
        { anchor: anchor }, adjustOpts);

    // -- 2. drawing extent = old stations' bounding-box diagonal -----
    var extent = CsRevise.positionsExtent(oldResolved.stations);

    // -- 3. classify ---------------------------------------------------
    var cls = CsRevise.classifyChange(oldResolved, newResolved, extent);
    var eps = 1e-6 * Math.max(extent, 1);
    var stationsChanged = 0;
    for (var mi = 0; mi < cls.moved.length; mi++) {
        if (cls.moved[mi].dist > eps) {
            stationsChanged++;
        }
    }

    // No RevisionLog is kept anymore (Nathan, 2026-08-27): the tag was
    // one unbounded XDATA line, dxflib's reader dies at 1024 characters
    // on a line (Truitt Cave reopened as ONE entity of 682 over it),
    // and Drive's version history is the actual record. The rigid path
    // below STRIPS a stale tag when it meets one, so drawings written
    // by older builds shed theirs on their next revision; the non-rigid
    // path's erase-and-redraw drops it by construction.

    // the redrawn point carrying Station = name, or null -- same
    // lookup livePosOf uses above, but returning the entity itself
    // since the geo anchor tags below get COMMITTED onto it, not just
    // read
    var findStationEntity = function(name) {
        var ids = doc.queryAllEntities(false, false);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "Station") === name) {
                return e;
            }
        }
        return null;
    };
    // set only on the non-rigid path, only when the geo anchor existed
    // but its station did not survive the revision -- see below
    var geoAnchorLost = null;

    // Traced-linework outcome, filled in by the non-rigid path only.
    // Left at 0/[] on the rigid path, where the one whole-drawing
    // transform already carried every traced entity with it and there
    // is nothing per-entity to count.
    var lineworkMoved = 0;
    var lineworkWarped = 0;
    var lineworkUnmoved = [];
    var lineworkUntied = [];
    var lineworkBound = 0;

    // The profile pass's own outcome (CsDraw.survey's return value has
    // carried a `profile` field, {skipped, reason} or {path, created,
    // counts, profile}, since CsDraw.js's own profile-summary fix --
    // ImportCaveSurvey.js, SurveyNotebook.js and CsRebuild.js
    // all surface it, but this function used to call CsDraw.survey below
    // and DISCARD the return value outright, so "Revise a trip" -- the
    // flagship workflow this whole feature was built for -- was
    // completely silent about a profile skipped for size, skipped
    // because ProfileAuto is off, skipped for an unsaved drawing, or
    // skipped because the pass threw. null on the rigid path, where
    // CsDraw.survey is never called at all (the whole-drawing transform
    // moves everything, profile included, without a redraw).
    var profileOutcome = null;

    // -- OFF layers holding entities: ops there are silently refused --
    // CsRevise.withOffLayersOn scans per call rather than once up
    // front, so the linework pass AFTER the redraw sees the layers the
    // redraw itself populated.
    var withOffLayersOn = function(fn) {
        return CsRevise.withOffLayersOn(doc, di, fn);
    };

    if (cls.rigid) {
        // -- 4. RIGID: one modify operation over the whole drawing ---
        // Geometry idiom proven empirically in this bridge's doc tests:
        // queried entities support .rotate(rad, RVector), .scale(factor,
        // RVector) and .move(RVector), and the mutation commits through
        // RModifyObjectsOperation.addObject(e, false). The sequence
        // rotate-about-origin, scale-about-origin, move(tx, ty) is
        // exactly applyFit: scale * R(theta) * p + (tx, ty).
        var fit = { theta: cls.theta, scale: cls.scale,
            tx: cls.tx, ty: cls.ty };
        var origin = new RVector(0, 0);
        var doScale = Math.abs(fit.scale - 1.0) > 1e-9;

        // newSurvey shots by (trip, per-trip seq) -- the same counters
        // CsDraw stamps as ShotSeq, so drawn legs/splays match exactly
        var newShotByKey = {};
        var newSeqOf = [];      // shot index -> its per-trip ShotSeq
        var seqCounters = {};
        for (var ni = 0; ni < newSurvey.shots.length; ni++) {
            var nTrip = newSurvey.shots[ni].trip || 0;
            var nSeq = seqCounters[nTrip] || 0;
            seqCounters[nTrip] = nSeq + 1;
            newShotByKey[nTrip + ":" + nSeq] = newSurvey.shots[ni];
            newSeqOf[ni] = nSeq;
        }

        // The shots the drawing can't show as geometry ride the trip-0
        // anchor as serialized rows -- and those rows carry their own
        // distances, LRUD and azimuths, every one of which the revision
        // may have changed. Regenerate them exactly as CsDraw does
        // (excluded shots in shot order, then the unresolved ones in
        // resolve order) so the reconstruction reads back the REVISED
        // rows. Note the one gap CsTags leaves: a blob that becomes
        // empty cannot be cleared, only overwritten, so a shot that
        // stops being excluded keeps a stale row until the next redraw.
        var exRows = [], unRows = [];
        for (ni = 0; ni < newSurvey.shots.length; ni++) {
            if (newSurvey.shots[ni].excludeFromAll) {
                exRows.push((newSurvey.shots[ni].trip || 0) + "\t" +
                    newSeqOf[ni] + "\t" +
                    CsModel.shotRowText(newSurvey.shots[ni]));
            }
        }
        for (var ui = 0; ui < newResolved.unresolved.length; ui++) {
            var ush = newResolved.unresolved[ui];
            var uSeq = null;
            for (ni = 0; ni < newSurvey.shots.length; ni++) {
                if (newSurvey.shots[ni] === ush) {
                    uSeq = newSeqOf[ni];
                    break;
                }
            }
            unRows.push((ush.trip || 0) + "\t" +
                (uSeq === null ? 0 : uSeq) + "\t" +
                CsModel.shotRowText(ush));
        }

        withOffLayersOn(function() {
            var op = new RModifyObjectsOperation();
            op.setText("Apply survey revision");
            var ids = doc.queryAllEntities(false, false);
            for (var i = 0; i < ids.length; i++) {
                var e = doc.queryEntity(ids[i]);
                if (isNull(e)) {
                    continue;
                }
                if (CsRevise.isWorldFixedLayer(
                        doc.getLayerName(e.getLayerId()))) {
                    continue; // sheet furniture and ground-pinned imagery
                }
                e.rotate(fit.theta, origin);
                if (doScale) {
                    e.scale(fit.scale, origin);
                }
                e.move(new RVector(fit.tx, fit.ty));

                // legs and splays: every revised reading from the
                // matching newSurvey shot. The LENGTHS come along --
                // Distance and the four LRUD sides -- because a rigid
                // fit may carry a uniform scale, and geometry scaled
                // under tags that still claim the old lengths is
                // exactly the silent drift this module exists to
                // prevent. Written unconditionally: for a pure
                // declination revision the values are identical, so
                // this is a no-op there. Formatting matches CsDraw's
                // legTags field for field, so a rewritten tag is
                // byte-identical to a freshly drawn one.
                if (CsTags.get(e, "Distance") !== "" &&
                        (CsTags.get(e, "From") !== "" ||
                         CsTags.get(e, "Splay") !== "")) {
                    var eTrip = CsTags.getNumber(e, "Trip");
                    var eSeq = CsTags.getNumber(e, "ShotSeq");
                    var match = eSeq === null ? undefined :
                        newShotByKey[(eTrip === null ? 0 : eTrip) +
                            ":" + eSeq];
                    if (match !== undefined) {
                        CsTags.set(e, "Distance", match.distance);
                        CsTags.set(e, "Azimuth", match.azimuth);
                        if (match.backAzimuth !== null &&
                                match.backAzimuth !== undefined) {
                            CsTags.set(e, "BackAzimuth", match.backAzimuth);
                        }
                        // the rewritten Azimuth was computed with the
                        // revised declination: its provenance has to
                        // move with it, or the next revision un-applies
                        // a value this one already replaced. Same
                        // limitation as BackAzimuth above -- CsTags
                        // cannot clear a tag, so a shot that somehow
                        // LOST its declination keeps the old one until
                        // a full redraw.
                        if (match.declination !== null &&
                                match.declination !== undefined) {
                            CsTags.set(e, "Declination", match.declination);
                        }
                        CsTags.set(e, "Left",
                            CsModel.lrudEntryText(match.left, match.leftAll,
                                match.leftOpen));
                        CsTags.set(e, "Right",
                            CsModel.lrudEntryText(match.right,
                                match.rightAll, match.rightOpen));
                        CsTags.set(e, "Up",
                            CsModel.lrudEntryText(match.up, match.upAll,
                                match.upOpen));
                        CsTags.set(e, "Down",
                            CsModel.lrudEntryText(match.down, match.downAll,
                                match.downOpen));
                    }
                }

                // station points: the two tags that carry a LENGTH and
                // therefore go stale under a scale -- the resolved
                // Elevation, and the Fixed "x,y,z" triple (which the
                // v3 reader really does read back into survey.fixed).
                // Azimuth/LRUD on station points stay as-is, accepted
                // stale: the leg tags are canonical.
                var stName = CsTags.get(e, "Station");
                if (stName !== "") {
                    var nSt = newResolved.stations[stName];
                    if (nSt !== undefined && nSt !== null) {
                        CsTags.set(e, "Elevation", nSt.z);
                    }
                    if (CsTags.get(e, "Fixed") !== "" &&
                            newSurvey.fixed.hasOwnProperty(stName)) {
                        var nfx = newSurvey.fixed[stName];
                        CsTags.set(e, "Fixed", nfx.x + "," + nfx.y + "," +
                            (nfx.z === undefined || nfx.z === null ?
                                0 : nfx.z));
                    }
                }

                // trip anchor points: revised trip metadata; the trip-0
                // anchor also the legacy mirror and the serialized rows.
                if (stName !== "" && CsTags.get(e, "Trip") !== "") {
                    var aTrip = CsTags.getNumber(e, "Trip");
                    aTrip = aTrip === null ? 0 : aTrip;
                    if (newSurvey.trips[aTrip] !== undefined) {
                        CsTags.set(e, "TripDeclination",
                            newSurvey.trips[aTrip].declination);
                        CsTags.set(e, "TripDeclinationSource",
                            newSurvey.trips[aTrip].declinationSource);
                        // a unit re-interpretation is what a scale IS
                        CsTags.set(e, "TripDistanceUnit",
                            newSurvey.trips[aTrip].distanceUnit);
                    }
                    if (aTrip === 0) {
                        CsTags.set(e, "Declination", newSurvey.declination);
                        CsTags.set(e, "DeclinationSource",
                            newSurvey.declinationSource);
                        CsTags.set(e, "DistanceUnit",
                            newSurvey.distanceUnit);
                        CsTags.set(e, "ExcludedShots", exRows.join("\n"));
                        CsTags.set(e, "UnplacedShots", unRows.join("\n"));
                    }
                }
                // Strip a stale RevisionLog written by an older build:
                // the tag is gone from the schema (see the note where
                // the log used to be composed, above), and an unbounded
                // one is what bricked Truitt Cave's reopen.
                if (CsTags.get(e, "RevisionLog") !== "") {
                    CsTags.remove(e, "RevisionLog");
                }

                // The geo anchor's PIN follows the station the rigid
                // transform just moved -- its real-world coordinate did
                // not change, so without this the ground-window tools
                // would read the revision as "the entrance was dragged
                // over the imagery" and offer a bogus recompute. The
                // script-side entity already carries its transformed
                // position here.
                if (CsTags.get(e, "GeoLat") !== "" &&
                        typeof e.getPosition === "function") {
                    var gpin = e.getPosition();
                    CsTags.set(e, "GeoDrawX", gpin.x);
                    CsTags.set(e, "GeoDrawY", gpin.y);
                }

                op.addObject(e, false);
            }
            di.applyOperation(op);
        });
        if (typeof CsStore !== "undefined") {
            // no-op unless a legacy store text exists
            CsStore.migrate(doc, di);
        }
    } else {
        // -- 5. NOT rigid: erase the old marks, redraw the revision --
        var oldNames = [];
        for (var on in oldResolved.stations) {
            if (oldResolved.stations.hasOwnProperty(on)) {
                oldNames.push(on);
            }
        }

        // -- 5a. claim the UNTAGGED linework, BEFORE the erase ---------
        // The order is the correctness argument. Hand-drawn work was
        // drawn against the stations WHERE THEY WERE, and the only
        // record of where they were is the geometry the next two lines
        // delete. So the binding is worked out here, from
        // CsBind.stationIndex reading the OLD marks (station points,
        // LRUD tips, splay tips -- all still in place), and only the
        // WRITING waits for the redraw. Bind afterwards and every
        // entity would be measured against stations that had already
        // moved out from under it, which is a plausible-looking wrong
        // answer -- the worst kind.
        //
        // The trip each entity gets is inferred from its own stations
        // via this same tripStations map, so a wall traced against
        // trip 2 is claimed for trip 2 whatever the revision is about.
        var tripNames = CsRevise.tripStationNames(recon.survey);
        var bindPlan = (typeof CsBind === "undefined") ? [] :
            CsBind.planAutoBind(doc, tripNames);

        withOffLayersOn(function() {
            CsDraw.eraseStations(doc, oldNames, di);
        });
        profileOutcome = CsDraw.survey(newSurvey, newResolved, anchorName,
            anchorPos, undefined, { doc: doc, di: di }).profile;
        // (No RevisionLog to carry across: the erase deleted the point
        // any stale one lived on, and the redraw writes none -- which
        // is the removal working, not history being lost.)
        // Same problem, same shape: GeoLat/GeoLon/GeoStation rode on a
        // station point that eraseStations just erased, and
        // CsDraw.survey has no field to have put it back into (see the
        // module header) -- so recommit the tags snapshotted above
        // onto whichever point now carries that same Station name.
        if (geoAnchor !== null) {
            var newGeoEntity = findStationEntity(geoAnchor.station);
            if (newGeoEntity !== null) {
                // Every anchor tag (GeoElev, SurfaceBbox too), re-pinned
                // at the redrawn position -- see CsLocationPick.rehome.
                CsLocationPick.rehome(di, geoAnchor.carried, newGeoEntity);
            } else {
                // the anchored station didn't survive this revision --
                // the user deleted that leg. There is no honest
                // carrier for the anchor left in the drawing, so
                // report it rather than silently dropping it or
                // inventing a new home for it.
                geoAnchorLost = geoAnchor.station;
            }
        }

        // -- 5b. traced linework follows its OWN stations -------------
        // Which frame each side comes from, because getting it backwards
        // would move every traced line by the inverse of the revision:
        //   OLD  oldResolved.stations, the pre-revision resolve over
        //        this same anchor. Those coordinates ARE the drawing
        //        coordinates the user traced against -- read before the
        //        erase, and the only record of them left, since the
        //        marks that held them have just been deleted.
        //   NEW  read back off the drawing the redraw above has just
        //        written. Deliberately not newResolved: the two agree
        //        mathematically, but the drawing is the truth about
        //        where the stations actually ended up.
        var oldPos = {};
        for (var lp in oldResolved.stations) {
            if (oldResolved.stations.hasOwnProperty(lp)) {
                oldPos[lp] = { x: oldResolved.stations[lp].x,
                    y: oldResolved.stations[lp].y };
            }
        }
        var newPos = CsRevise.stationPositions(doc);
        // The tags go on now, not back at 5a: an entity has to be tagged
        // before the mover below can see it, and writing them here means
        // a revision that fell over between the erase and the redraw
        // never wrote tags onto the user's geometry for a move that did
        // not happen.
        if (typeof CsBind !== "undefined") {
            lineworkBound = CsBind.commitAutoBind(doc, di, bindPlan);
        }
        withOffLayersOn(function() {
            var lw = CsRevise.moveLinework(doc, di, oldPos, newPos,
                tripNames, extent);
            lineworkMoved = lw.moved;
            lineworkWarped = lw.warped;
            lineworkUnmoved = lw.unmoved;
            lineworkUntied = lw.untied;
        });
        CsRevise.settleSections(doc, di);
    }

    // -- 6. report -----------------------------------------------------
    var loopBrief = function(resolved) {
        var out = [];
        for (var li = 0; li < resolved.loops.length; li++) {
            out.push({
                from: resolved.loops[li].from,
                to: resolved.loops[li].to,
                error: resolved.loops[li].error,
                percent: resolved.loops[li].percent
            });
        }
        return out;
    };
    var report = {
        rigid: cls.rigid,
        moved: cls.moved,
        stationsChanged: stationsChanged,
        loopsBefore: loopBrief(oldResolved),
        loopsAfter: loopBrief(newResolved),
        anchorMoved: anchorMoved,
        anchorMissing: anchorMissing,
        anchorUsed: { name: anchorName, source: anchorSource },
        lineworkMoved: lineworkMoved,
        lineworkWarped: lineworkWarped,
        lineworkUnmoved: lineworkUnmoved,
        lineworkUntied: lineworkUntied,
        lineworkBound: lineworkBound
    };
    if (geoAnchorLost !== null) {
        // absent entirely rather than null when nothing was lost, so a
        // caller that never checks for it sees no shape change
        report.geoAnchorLost = geoAnchorLost;
    }
    if (profileOutcome !== null) {
        // absent on the rigid path (CsDraw.survey is never called
        // there), present on the non-rigid path whether the profile
        // pass succeeded or was skipped -- CsReport.revisionSummary
        // reads it to surface a skip the same way CsReport.drawSummary
        // already does for every OTHER caller of CsDraw.survey (see
        // this var's own declaration above for why that used to be
        // silent here specifically).
        report.profile = profileOutcome;
    }
    return report;
};
