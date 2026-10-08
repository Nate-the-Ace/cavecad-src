// profile_draw_roundtrip.js -- draw a profile, sketch on it, draw again.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/profile_draw_roundtrip.js "$PWD"
//
// The two claims that matter for a file the user draws on:
//   1. regeneration replaces the generator's own output, not the
//      user's -- a hand-drawn wall is still there afterwards;
//   2. regeneration does not DOUBLE the generator's output.
//
// Plus three more, each a real bug class named in this feature's own
// brief and worth catching here rather than trusting the brief's own
// draft implementation:
//   3. every entity this module draws carries ProfileRun, not just its
//      own specific tag (an earlier draft left the station LABEL
//      without it);
//   4. a layer the USER switched off by hand -- not one that ships off
//      by default -- must not make erase()/render() silently do
//      nothing, the same failure mode CsDraw.eraseStations once had;
//   5. a band that stopped at its own very first station (no stations,
//      no legs, nothing to draw but a caption) must not crash, and must
//      not silently draw its caption as if the band sat at elevation 0.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) {
            return true;
        }
        try {
            if (typeof v.isNull === "function") {
                return v.isNull();
            }
        } catch (e) {
        }
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() {
        return new RSpatialIndexNavel();
    };
}
if (typeof destr === "undefined") {
    destr = function(obj) {
        if (RSettings.getQtVersion() >= 0x060000) {
            obj.destr();
        } else if (typeof obj.destroy === "function") {
            obj.destroy();
        }
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

function loadRepoScript(rel) {
    var file = new QFile(repoRoot + "/" + rel);
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    // Indirect eval: a direct eval() here would land every Cs* global in
    // THIS FUNCTION's scope, invisible the moment loadRepoScript()
    // returns -- same reason tests/js_unit.js's own loader uses this.
    (0, eval)(src);
}

var CORE = ["CsUnits", "CsCave", "CsGeoProject", "CsAngles", "CsIgrfCoeffs",
    "CsGeomag", "CsModel", "CsTraverse", "CsNetwork", "CsAdjust", "CsLrud",
    "CsValidate", "CsStats", "CsGrade", "CsTags", "CsStore", "CsLayers",
    "CsDraw",
    // CsPitch before CsProfile: build() attaches each band the drops
    // it draws whole, so the elevation and the plan cannot disagree
    // about how deep one is.
    "CsPitch", "CsProfile", "CsProject", "CsChunk", "CsProfileDraw",
    // CsWarp before CsRevise -- moveLinework's per-vertex dispatch
    // calls CsWarp.mlsSimilarity when it runs.
    "CsWarp",
    // CsRevise before CsBind -- CsBind's layer gate consults
    // CsRevise.isWorldFixedLayer when it is loaded.
    "CsRevise", "CsBind", "CsProfileBind",
    // CsReport last: needed only so this file can assert the WORDS
    // CsReport.profileSummary prints (Critical 1's own fix), not just
    // the counts object underneath them.
    "CsReport"];
for (var c = 0; c < CORE.length; c++) {
    loadRepoScript("scripts/CaveSurvey/Core/" + CORE[c] + ".js");
}

var failures = [];
function ok(cond, what) {
    if (!cond) { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}
/** map[key] if present, else a NaN placeholder -- lets a fixture that
 *  builds several sketches off a lookup table (fixtures 5e/5f below)
 *  keep going after a failed sanity check instead of dereferencing
 *  .x/.y on undefined and throwing a raw, uncaught TypeError that
 *  would kill this whole run BEFORE the failure list the sanity check
 *  just appended to ever gets printed -- three separate mutations were
 *  found to do exactly that. */
function entryOf(map, key) {
    return map.hasOwnProperty(key) ? map[key] : { x: NaN, y: NaN };
}

function shotOf(from, to, d, az, inc, u, dn) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0;
    s.up = (u === undefined) ? null : u;
    s.down = (dn === undefined) ? null : dn;
    return s;
}

// This file's OWN literal namespace list, kept deliberately separate
// from CsProfileDraw.TAGS: a scanner reading the constant it is meant
// to be testing would let a mutation that drops a tag from TAGS mutate
// the test right alongside the code, so every kill through that tag
// would prove nothing about erase()/render() at all. Kept in sync BY
// HAND with the table in CsProfileDraw.js's own file banner.
var KNOWN_PROFILE_TAGS = ["ProfileRun", "ProfileStation", "ProfileShot",
    "ProfileSplay", "ProfileFloorRun", "ProfileCeilingRun",
    "ProfileBandLabel", "ProfileZOffset",
    "ProfileBox", "ProfileBoxLabel", "ProfilePitchLabel",
    "ProfileChunkTie", "ProfileChunk", "ProfileChunkOffset",
    "ProfileChunkKind"];

/** Every Profile*-tagged entity in the doc, as
 *  {id, entity, layer, tags: {key: value}}. */
function scanProfileEntities(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var tags = {};
        var any = false;
        for (var t = 0; t < KNOWN_PROFILE_TAGS.length; t++) {
            var v = CsTags.get(e, KNOWN_PROFILE_TAGS[t]);
            if (v !== null && v !== "") {
                tags[KNOWN_PROFILE_TAGS[t]] = v;
                any = true;
            }
        }
        if (any) {
            var layerName = null;
            try {
                layerName = doc.getLayerName(e.getLayerId());
            } catch (eLayer) {
                layerName = null;
            }
            out.push({ id: ids[i], entity: e, layer: layerName, tags: tags });
        }
    }
    return out;
}

/** True if entity is a plain point (RS.EntityPoint), the same getType()
 *  idiom CsRebuild.js uses to tell entity kinds apart -- used
 *  below to separate a station's POINT from its text LABEL, since both
 *  carry the identical ProfileStation tag. */
function isPointEntity(entity) {
    return typeof entity.getType === "function" &&
        entity.getType() === RS.EntityPoint;
}

/**
 * Sweeps EVERY entity the generator produced in one document and
 * asserts none of it landed in the plan frame.
 *
 * The elevation shares one model space with the plan now, so a
 * generated entity on CTRL-SHOTS would be indistinguishable from a plan
 * centerline leg -- to the rebuild, to the linework binder, and to a
 * plan-wide warp. This looks at everything CsProfileBind calls profile
 * geometry rather than at the handful of entities the per-kind
 * assertions below name by hand.
 *
 * Must be called while the document is still alive: every fixture here
 * destr()s its RDocumentInterface when done with it.
 */
function assertGeneratedStaysInFrame(doc, where) {
    var ids = doc.queryAllEntities(false, false);
    var offenders = [], i, e, lname;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e) || !CsProfileBind.isProfileGeometry(e)) {
            continue;
        }
        lname = doc.getLayerName(e.getLayerId());
        if (CsLayers.frameOf(lname) !== "profile") {
            offenders.push(lname);
        }
    }
    eqs(offenders.join(","), "",
        "every entity the generator drew in " + where + " is on a " +
        "profile-frame layer");
}

/** How many scanned entities carry tagKey === tagValue. */
function countByTag(scanned, tagKey, tagValue) {
    var n = 0;
    for (var i = 0; i < scanned.length; i++) {
        if (scanned[i].tags[tagKey] === tagValue) { n++; }
    }
    return n;
}

// =======================================================================
// 1. The base fixture: two bands (A's trunk, and a one-station spur
//    A2a1 tying into A2). Proves the two properties that make this
//    feature usable at all.
// =======================================================================

var sv = CsModel.newSurvey();
sv.shots = [
    shotOf("A1", "A2", 10, 0, 0, 4, 2),
    shotOf("A2", "A3", 10, 0, -10, 4, 2),
    shotOf("A2", "A2a1", 6, 90, 0, 3, 1)
];
var resolved = CsNetwork.resolve(sv, {});
var profile = CsProfile.build(sv, resolved, {});

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);

var first = CsProfileDraw.render(doc, di, profile, {});
eqs(first.bandsDrawn, 2, "two bands drawn");
eqs(first.legsDrawn, 3, "three legs drawn");
var afterFirst = doc.queryAllEntities(false, false).length;
ok(afterFirst > 0, "the profile actually put entities in the document");

// the user sketches a wall on the plain, un-prefixed tracing layer --
// NOT the CTRL-PROFILE-CEILING pair the generator writes to
CsLayers.ensure(doc, di, "PROFILE-CEILING");
var op = new RAddObjectsOperation();
var sketch = new RLineEntity(doc,
    new RLineData(new RVector(0, 5), new RVector(20, 6)));
sketch.setLayerId(doc.getLayerId("PROFILE-CEILING"));
op.addObject(sketch, false);
di.applyOperation(op);
var sketchId = sketch.getId();
ok(sketchId > 0, "the sketch landed");

// regenerate
var second = CsProfileDraw.render(doc, di, profile, {});
eqs(second.bandsDrawn, 2, "redraw drew the same two bands");

ok(!isNull(doc.queryEntity(sketchId)),
    "THE SKETCH SURVIVED REGENERATION");

var afterSecond = doc.queryAllEntities(false, false).length;
eqs(afterSecond, afterFirst + 1,
    "redraw replaced its own output instead of doubling it (was " +
    afterFirst + " + 1 sketch)");

// property 3: EVERY entity this module drew carries ProfileRun, not
// just its own specific tag -- a draft of this file left the per-
// station LABEL (as opposed to the station POINT) without it.
var scanned1 = scanProfileEntities(doc);
ok(scanned1.length > 0, "sanity: something is tagged Profile*");
var missingRun = 0;
for (var mi = 0; mi < scanned1.length; mi++) {
    if (scanned1[mi].tags.ProfileRun === undefined) { missingRun++; }
}
eqs(missingRun, 0,
    "every Profile*-tagged entity also carries ProfileRun (" +
    missingRun + " of " + scanned1.length + " did not)");

// the station label specifically -- ProfileStation="A1" should appear
// on TWO entities (the point and its text label), and BOTH need
// ProfileRun -- this is the exact case an earlier draft missed, so
// name it rather than only checking the aggregate count above.
var a1Entities = [];
for (var ai = 0; ai < scanned1.length; ai++) {
    if (scanned1[ai].tags.ProfileStation === "A1") { a1Entities.push(scanned1[ai]); }
}
eqs(a1Entities.length, 2,
    "station A1 drew exactly a point and a label (got " +
    a1Entities.length + ")");
for (var a1i = 0; a1i < a1Entities.length; a1i++) {
    eqs(a1Entities[a1i].tags.ProfileRun, "A",
        "A1's entity #" + a1i + " (by ProfileStation) also carries ProfileRun");
}

// property: the layer split is the whole payload of Task 6 -- drawing
// every kind of entity onto the wrong (but still valid) layer would
// leave every count/tag assertion above green. Checked here for the
// three kinds this fixture produces; fixture 2 below covers the other
// three (ceiling/floor/flat all need real wall evidence to exist at
// all).
var a1Point = null, a1Label = null;
for (var a1j = 0; a1j < a1Entities.length; a1j++) {
    if (isPointEntity(a1Entities[a1j].entity)) {
        a1Point = a1Entities[a1j];
    } else {
        a1Label = a1Entities[a1j];
    }
}
ok(a1Point !== null && a1Label !== null,
    "sanity: A1's point and label were told apart");
if (a1Point !== null) {
    eqs(a1Point.layer, CsLayers.CTRL_PROFILE_STATIONS,
        "the station POINT lands on CTRL-PROFILE-STATIONS");
}
if (a1Label !== null) {
    eqs(a1Label.layer, CsLayers.CTRL_PROFILE_STATION_LABELS,
        "the station LABEL lands on CTRL-PROFILE-STATION-LABELS, a " +
        "different layer from its own point");
}
// minor: the label sits TEXT_HEIGHT*1.5 above its point -- a comment
// in CsProfileDraw.band cites this exact number as the reason a
// getType() filter is needed at all (section 3 below), so the number
// itself is worth pinning down, not just its consequence.
if (a1Point !== null && a1Label !== null) {
    near(a1Label.entity.getPosition().y - a1Point.entity.getPosition().y,
        CsDraw.TEXT_HEIGHT * 1.5, 1e-9,
        "the station label's Y offset above its point is exactly " +
        "TEXT_HEIGHT * 1.5");
}

var a1a2Leg = null, bandALabel = null;
for (var a1k = 0; a1k < scanned1.length; a1k++) {
    if (scanned1[a1k].tags.ProfileShot === "A1->A2") { a1a2Leg = scanned1[a1k]; }
    if (scanned1[a1k].tags.ProfileBandLabel === "A") { bandALabel = scanned1[a1k]; }
}
ok(a1a2Leg !== null, "sanity: found the A1->A2 leg");
if (a1a2Leg !== null) {
    eqs(a1a2Leg.layer, CsLayers.CTRL_PROFILE_SHOTS,
        "a centerline leg lands on CTRL-PROFILE-SHOTS");
}
ok(bandALabel !== null, "sanity: found band A's caption");
if (bandALabel !== null) {
    // CTRL-, not the caver's PROFILE-TEXT-LABELS. A generated caption on
    // the traced layer made erase() the owner of a layer in the user's
    // namespace, and made captions bindable linework as far as CsBind
    // was concerned -- and per-run variants turned that into a whole
    // family of generator-owned traced layers.
    eqs(bandALabel.layer, CsLayers.CTRL_PROFILE_TEXT_LABELS,
        "a band caption lands on CTRL-PROFILE-TEXT-LABELS");
    ok(bandALabel.layer !== CsLayers.PROFILE_TEXT_LABELS,
        "a band caption stays OUT of the caver's text layer");
    // minor: the caption sits TEXT_HEIGHT*4.0 above CsProfileDraw.
    // labelY0(band) (band A's own zOffset is 0, so no further shift).
    var bandA = null;
    for (var bak = 0; bak < profile.bands.length; bak++) {
        if (profile.bands[bak].key === "A") { bandA = profile.bands[bak]; }
    }
    if (bandA !== null) {
        near(bandALabel.entity.getPosition().y -
                (CsProfileDraw.labelY0(bandA) + (bandA.zOffset || 0.0)),
            CsDraw.TEXT_HEIGHT * 4.0, 1e-9,
            "the band caption's Y offset above the band's reference " +
            "height is exactly TEXT_HEIGHT * 4.0");
    }
}

// =======================================================================
// 1b. The band bounding boxes (Nathan, 2026-08-28): one locked frame
//     per band, name in the top-left corner, boxes disjoint, replaced
//     -- never stacked -- by a redraw. The redraw claims above already
//     proved the counts stay level ACROSS renders; these prove the
//     boxes themselves are right.
// =======================================================================

eqs(second.boxesDrawn, 2, "a box was drawn for each band");

var boxLayer = doc.queryLayer(CsLayers.CTRL_PROFILE_BOX);
ok(!isNull(boxLayer), "the box layer exists");
ok(boxLayer.isLocked() === true,
    "THE BOX LAYER IS LOCKED -- boxes are readable, never editable");

var boxRects = [], boxLabels = [];
var scannedBx = scanProfileEntities(doc);
for (var bxi = 0; bxi < scannedBx.length; bxi++) {
    if (scannedBx[bxi].tags.ProfileBox !== undefined) {
        boxRects.push(scannedBx[bxi]);
    }
    if (scannedBx[bxi].tags.ProfileBoxLabel !== undefined) {
        boxLabels.push(scannedBx[bxi]);
    }
}
eqs(boxRects.length, 2, "two box rectangles in the drawing");
eqs(boxLabels.length, 2, "two box name labels in the drawing");
for (var bxj = 0; bxj < boxRects.length; bxj++) {
    eqs(boxRects[bxj].layer, CsLayers.CTRL_PROFILE_BOX,
        "box rectangle lands on CTRL-PROFILE-BOX");
    ok(boxRects[bxj].tags.ProfileRun !== undefined,
        "box rectangle carries ProfileRun");
}

// every band's geometry sits INSIDE its own box, and the two boxes are
// disjoint -- the whole point of the frame is that location answers
// "which band", so an overlap would make the answer ambiguous.
function rectBoundsOf(scannedEntity) {
    scannedEntity.entity.update();
    var bb = scannedEntity.entity.getBoundingBox();
    return { minX: bb.getMinimum().x, minY: bb.getMinimum().y,
             maxX: bb.getMaximum().x, maxY: bb.getMaximum().y };
}
var rectA = null, rectSpur = null;
for (var bxk = 0; bxk < boxRects.length; bxk++) {
    if (boxRects[bxk].tags.ProfileBox === "A") {
        rectA = rectBoundsOf(boxRects[bxk]);
    } else {
        rectSpur = rectBoundsOf(boxRects[bxk]);
    }
}
ok(rectA !== null && rectSpur !== null,
    "both bands' boxes were told apart by their ProfileBox tag");
if (rectA !== null && rectSpur !== null) {
    var disjoint = rectA.minY >= rectSpur.maxY ||
        rectA.maxY <= rectSpur.minY ||
        rectA.minX >= rectSpur.maxX || rectA.maxX <= rectSpur.minX;
    ok(disjoint, "THE TWO BOXES ARE DISJOINT (A: y " +
        rectA.minY.toFixed(1) + ".." + rectA.maxY.toFixed(1) +
        ", spur: y " + rectSpur.minY.toFixed(1) + ".." +
        rectSpur.maxY.toFixed(1) + ")");
    // band A's own geometry inside band A's box
    var a1p = null;
    for (var bxm = 0; bxm < scannedBx.length; bxm++) {
        if (scannedBx[bxm].tags.ProfileStation === "A1" &&
                isPointEntity(scannedBx[bxm].entity)) {
            a1p = scannedBx[bxm].entity.getPosition();
        }
    }
    ok(a1p !== null && a1p.x > rectA.minX && a1p.x < rectA.maxX &&
        a1p.y > rectA.minY && a1p.y < rectA.maxY,
        "station A1 sits inside band A's box");
}

// the name text: top-left corner, inset one text height, saying the
// band's key so a reader knows which frame they are looking at
var labelA = null;
for (var bxl = 0; bxl < boxLabels.length; bxl++) {
    if (boxLabels[bxl].tags.ProfileBoxLabel === "A") {
        labelA = boxLabels[bxl];
    }
}
ok(labelA !== null, "band A's box has a name label");
if (labelA !== null && rectA !== null) {
    eqs(labelA.layer, CsLayers.CTRL_PROFILE_BOX,
        "the box name label lands on CTRL-PROFILE-BOX");
    var lp = labelA.entity.getPosition();
    near(lp.x, rectA.minX + CsDraw.TEXT_HEIGHT, 1e-6,
        "the name sits one text height in from the box's left edge");
    near(lp.y, rectA.maxY - CsDraw.TEXT_HEIGHT * 1.5, 1e-6,
        "the name sits just under the box's top edge");
}

assertGeneratedStaysInFrame(doc, "the base fixture");
destr(di);

// =======================================================================
// 2. A layer the USER switched off by hand, between two redraws. None
//    of CsProfileDraw's layers ship off by default -- CsLayers.OFF
//    never names any of them -- so this can only happen by a person's
//    own choice (e.g. hiding the generated ceiling to trace over it on
//    the plain PROFILE-CEILING layer instead). This build refuses BOTH
//    adds and deletes on an off layer with no error, so without
//    CsProfileDraw.withOwnLayersOn this redraw would silently do
//    nothing: the stale ceiling run would survive (off-screen) and the
//    fresh one would never land.
// =======================================================================

// C1-C2-C3, a plain unbranched chain so C2 and C3's LRUD forms one real
// 2-point ceiling run and one real 2-point floor run (a junction would
// flush and drop a lone point -- see CsProfile.bandWallRuns).
var svC = CsModel.newSurvey();
svC.shots = [
    shotOf("C1", "C2", 10, 0, 0, 3, 2),
    shotOf("C2", "C3", 10, 0, 0, 3, 2)
];
// A real near-horizontal SPLAY (not LRUD) at C2, inside the default
// +-10 degree dead zone -- CsProfile.classifySplay reads this as
// "flat", so bandWallRuns routes it to band.flat (a tick) rather than
// into the ceiling or floor run. This is the one piece of this file's
// acceptance criteria the C1-C2-C3 chain above does not otherwise
// exercise at all.
var flatSplay = CsModel.newShot();
flatSplay.from = "C2";
flatSplay.splay = true;
flatSplay.distance = 3;
flatSplay.azimuth = 90;
flatSplay.inclination = 0;
svC.shots.push(flatSplay);

var resolvedC = CsNetwork.resolve(svC, {});
var profileC = CsProfile.build(svC, resolvedC, {});
eqs(profileC.bands.length, 1, "sanity: the C fixture is one band");
eqs(profileC.bands[0].ceiling.length, 1,
    "sanity: the C fixture drew one ceiling run");
eqs(profileC.bands[0].floor.length, 1,
    "sanity: the C fixture drew one floor run");
eqs(profileC.bands[0].flat.length, 1,
    "sanity: the C fixture drew one flat splay tick");

var docC = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diC = new RDocumentInterface(docC);
var renderC1 = CsProfileDraw.render(docC, diC, profileC, {});
eqs(renderC1.flatTicks, 1, "render() drew the one flat splay tick");

var scannedC1 = scanProfileEntities(docC);
eqs(countByTag(scannedC1, "ProfileCeilingRun", "C.1"), 1,
    "exactly one ceiling run tagged C.1 after the first draw");
eqs(countByTag(scannedC1, "ProfileSplay", "C2.1"), 1,
    "the flat splay got its own tick, tagged with the splay's own name " +
    "(not folded into the ceiling/floor run, and not drawn a second " +
    "time as a ray out to the wall -- see the acceptance criteria)");
for (var fsi = 0; fsi < scannedC1.length; fsi++) {
    if (scannedC1[fsi].tags.ProfileSplay === "C2.1") {
        eqs(scannedC1[fsi].tags.ProfileRun, "C",
            "the flat tick also carries ProfileRun");
    }
}

// property 3, over THIS fixture: fixture 1's own sweep never produces
// a wall run at all, so it cannot see a ceiling/floor polyline missing
// ProfileRun -- only this fixture's ceiling/floor/flat entities can.
var missingRunC = 0;
for (var mci = 0; mci < scannedC1.length; mci++) {
    if (scannedC1[mci].tags.ProfileRun === undefined) { missingRunC++; }
}
eqs(missingRunC, 0,
    "every Profile*-tagged entity in the wall-run fixture also carries " +
    "ProfileRun (" + missingRunC + " of " + scannedC1.length +
    " did not)");

// property 2 (Task 6's whole payload): the ceiling/floor/flat layer
// split is otherwise unasserted anywhere in this file -- drawing every
// ceiling run onto CsLayers.CTRL_PROFILE_FLOOR instead would leave every
// count and tag assertion above green.
var ceilingEnt = null, floorEnt = null, flatEnt = null;
for (var lci = 0; lci < scannedC1.length; lci++) {
    if (scannedC1[lci].tags.ProfileCeilingRun === "C.1") { ceilingEnt = scannedC1[lci]; }
    if (scannedC1[lci].tags.ProfileFloorRun === "C.1") { floorEnt = scannedC1[lci]; }
    if (scannedC1[lci].tags.ProfileSplay === "C2.1") { flatEnt = scannedC1[lci]; }
}
ok(ceilingEnt !== null && floorEnt !== null && flatEnt !== null,
    "sanity: found the ceiling run, floor run, and flat tick");
if (ceilingEnt !== null) {
    eqs(ceilingEnt.layer, CsLayers.CTRL_PROFILE_CEILING,
        "the ceiling run lands on CTRL-PROFILE-CEILING");
}
if (floorEnt !== null) {
    eqs(floorEnt.layer, CsLayers.CTRL_PROFILE_FLOOR,
        "the floor run lands on CTRL-PROFILE-FLOOR, not the ceiling's " +
        "layer -- the whole point of Task 6's layer split");
}
if (flatEnt !== null) {
    eqs(flatEnt.layer, CsLayers.CTRL_PROFILE_SPLAYS,
        "the flat splay tick lands on CTRL-PROFILE-SPLAYS");
    // minor: the tick's own length. half = CsDraw.TEXT_HEIGHT, drawn
    // from (f.x, f.y-half) to (f.x, f.y+half), so its length is
    // exactly 2 * TEXT_HEIGHT regardless of where f itself sits.
    if (typeof flatEnt.entity.getStartPoint === "function" &&
            typeof flatEnt.entity.getEndPoint === "function") {
        var fp1 = flatEnt.entity.getStartPoint();
        var fp2 = flatEnt.entity.getEndPoint();
        var flatLen = Math.sqrt(
            (fp2.x - fp1.x) * (fp2.x - fp1.x) +
            (fp2.y - fp1.y) * (fp2.y - fp1.y));
        near(flatLen, CsDraw.TEXT_HEIGHT * 2.0, 1e-9,
            "the flat tick's own length is exactly 2 * TEXT_HEIGHT");
    }
}

var oldCeilingId = null;
for (var ci = 0; ci < scannedC1.length; ci++) {
    if (scannedC1[ci].tags.ProfileCeilingRun === "C.1") {
        oldCeilingId = scannedC1[ci].id;
    }
}
ok(oldCeilingId !== null, "sanity: found the ceiling run's id");

// the user turns CTRL-PROFILE-CEILING off by hand -- the exact
// low-level toggle CsLayers.withLayerOn itself uses, applied directly
// here so this test does not depend on the function under test to set
// up its own precondition.
var ceilingLayer = docC.queryLayer(CsLayers.CTRL_PROFILE_CEILING);
ok(!isNull(ceilingLayer), "sanity: CTRL-PROFILE-CEILING exists");
ceilingLayer.setOff(true);
var offOp = new RModifyObjectsOperation();
offOp.addObject(ceilingLayer, false);
diC.applyOperation(offOp);
ok(docC.queryLayer(CsLayers.CTRL_PROFILE_CEILING).isOff(),
    "sanity: CTRL-PROFILE-CEILING is now off");

CsProfileDraw.render(docC, diC, profileC, {});

// A deleted entity's id still answers queryEntity() in this bridge (it
// comes back as an UNDONE wrapper, not null -- confirmed by hand
// against CsBind.addedEntityIds' own isUndone() check, which exists for
// exactly this reason); isUndone() is the real signal, not isNull().
var oldCeilingAfter = docC.queryEntity(oldCeilingId);
ok(!isNull(oldCeilingAfter) &&
    typeof oldCeilingAfter.isUndone === "function" &&
    oldCeilingAfter.isUndone(),
    "erase() removed the OLD ceiling run even though its layer was off");
var scannedC2 = scanProfileEntities(docC);
eqs(countByTag(scannedC2, "ProfileCeilingRun", "C.1"), 1,
    "render() added exactly ONE new ceiling run even though its layer " +
    "was off -- not zero (silently dropped) and not two (doubled)");
eqs(countByTag(scannedC2, "ProfileFloorRun", "C.1"), 1,
    "the floor run (same off-layer situation would not apply to it, " +
    "but a shared code path bug could still double it) is also singular");
eqs(countByTag(scannedC2, "ProfileSplay", "C2.1"), 1,
    "the flat splay tick is singular too, not doubled by the redraw");

ok(docC.queryLayer(CsLayers.CTRL_PROFILE_CEILING).isOff(),
    "CsLayers.withLayerOn restored the user's own off choice afterward " +
    "-- the redraw did not leave their layer visible");

// =======================================================================
// 2b. THE PROMOTED-LINE CASE. A cartographer who likes a generated
//    ceiling run does not retrace it by hand -- they change ITS LAYER
//    from CTRL-PROFILE-CEILING to the plain PROFILE-CEILING tracing
//    layer and keep it. XDATA is per-entity and survives a layer
//    change, so the promoted line still carries ProfileCeilingRun/
//    ProfileRun afterward. erase()'s ORIGINAL tag-only scan destroyed
//    it on the very next redraw -- this is the review finding that
//    made erase() require BOTH tag AND layer membership; this is the
//    test that proves the fix actually holds.
// =======================================================================

var promoted = null;
for (var pci = 0; pci < scannedC2.length; pci++) {
    if (scannedC2[pci].tags.ProfileCeilingRun === "C.1") { promoted = scannedC2[pci]; }
}
ok(promoted !== null, "sanity: found the current ceiling run to promote");
if (promoted !== null) {
    var promotedId = promoted.id;
    var promotedEnt = docC.queryEntity(promotedId);
    // The plain PROFILE-CEILING tracing layer has never been created
    // in this fixture's document (nothing traced on it yet) -- ensure
    // it first, or getLayerId() below returns the default "0" layer's
    // id instead of failing loudly.
    CsLayers.ensure(docC, diC, "PROFILE-CEILING");
    // CTRL-PROFILE-CEILING is still off from section 2 above -- turn it
    // back on first, the ordinary way a person would before touching
    // anything on it, so this is a layer CHANGE, not another off-layer
    // scenario layered on top of the one already covered.
    CsLayers.withLayerOn(docC, diC, CsLayers.CTRL_PROFILE_CEILING, function() {
        var promoteOp = new RModifyObjectsOperation();
        promotedEnt.setLayerId(docC.getLayerId("PROFILE-CEILING"));
        promoteOp.addObject(promotedEnt, false);
        diC.applyOperation(promoteOp);
    });
    ok(docC.getLayerName(docC.queryEntity(promotedId).getLayerId()) ===
        "PROFILE-CEILING",
        "sanity: the ceiling run really did move to the plain tracing " +
        "layer");
    ok(CsTags.get(docC.queryEntity(promotedId), "ProfileCeilingRun") === "C.1",
        "sanity: XDATA survived the layer change -- the promoted line " +
        "still carries its own tag");

    CsProfileDraw.render(docC, diC, profileC, {});

    var promotedAfter = docC.queryEntity(promotedId);
    ok(!isNull(promotedAfter) &&
        !(typeof promotedAfter.isUndone === "function" &&
            promotedAfter.isUndone()),
        "THE PROMOTED LINE SURVIVED REGENERATION");
    if (!isNull(promotedAfter)) {
        eqs(docC.getLayerName(promotedAfter.getLayerId()), "PROFILE-CEILING",
            "the promoted line was not swept back onto CTRL-PROFILE-CEILING");
    }

    var scannedC3 = scanProfileEntities(docC);
    eqs(countByTag(scannedC3, "ProfileCeilingRun", "C.1"), 2,
        "TWO entities now carry ProfileCeilingRun=C.1: the promoted " +
        "line (kept, on the tracing layer) and a fresh one render() " +
        "drew beside it (on CTRL-PROFILE-CEILING) -- not one (the " +
        "promoted line eaten) and not merged into a single copy");
    var freshOnOwnLayer = 0;
    for (var pcj = 0; pcj < scannedC3.length; pcj++) {
        if (scannedC3[pcj].tags.ProfileCeilingRun === "C.1" &&
                scannedC3[pcj].layer === CsLayers.CTRL_PROFILE_CEILING) {
            freshOnOwnLayer++;
        }
    }
    eqs(freshOnOwnLayer, 1,
        "exactly one of the two C.1-tagged entities is the fresh copy " +
        "on CTRL-PROFILE-CEILING");
}

assertGeneratedStaysInFrame(docC, "the splay/ceiling fixture");
destr(diC);

// =======================================================================
// 3. zOffset must actually reach the drawn geometry, not just the
//    caption. Two disconnected, unconnected components anchored to the
//    SAME elevation (two *fix'ed roots, z=0 each) collide -- CsProfile.
//    layout pushes whichever band is placed second down by a gutter
//    (see its own docblock) and records that on band.zOffset. If
//    CsProfileDraw.band's `at()` closure ever stopped adding dz (e.g.
//    reverted to plain `new RVector(x, y)`), every OTHER assertion in
//    this file would still pass -- none of them look at an actual
//    drawn Y coordinate -- so this is tested directly rather than only
//    through CsProfileDraw.labelText's caption wording.
// =======================================================================

var svE = CsModel.newSurvey();
svE.fixed.Q1 = { x: 0, y: 0, z: 0 };
svE.fixed.R1 = { x: 100, y: 0, z: 0 };
svE.shots = [
    shotOf("Q1", "Q2", 10, 0, 0),
    shotOf("R1", "R2", 10, 0, 0)
];
var resolvedE = CsNetwork.resolve(svE, {});
var profileE = CsProfile.build(svE, resolvedE, {});
eqs(profileE.bands.length, 2, "sanity: two disconnected bands");
var bandQ = null, bandR = null;
for (var bei = 0; bei < profileE.bands.length; bei++) {
    if (profileE.bands[bei].key === "Q") { bandQ = profileE.bands[bei]; }
    if (profileE.bands[bei].key === "R") { bandR = profileE.bands[bei]; }
}
ok(bandQ !== null && bandR !== null, "sanity: found both Q and R bands");
if (bandQ !== null && bandR !== null) {
    eqs(bandQ.zOffset, 0.0,
        "sanity: the first-placed band (Q) keeps true elevation");
    ok(bandR.zOffset < -1e-9,
        "sanity: the colliding band (R) got pushed down (zOffset = " +
        bandR.zOffset + ")");

    var docE = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var diE = new RDocumentInterface(docE);
    CsProfileDraw.render(docE, diE, profileE, {});
    var scannedE = scanProfileEntities(docE);

    // Both the station POINT and its text LABEL carry ProfileStation --
    // that is what property 3 (every entity carries its own tag) above
    // already checks -- so this keeps only RS.EntityPoint (the same
    // getType() idiom CsRebuild.js already uses to tell entity
    // kinds apart) to compare the point's own, unadorned position; its
    // label sits TEXT_HEIGHT*1.5 above it on purpose and would throw
    // this comparison off by exactly that much.
    var q1Pos = null, r1Pos = null;
    for (var ei = 0; ei < scannedE.length; ei++) {
        var ent = scannedE[ei].entity;
        if (typeof ent.getType !== "function" ||
                ent.getType() !== RS.EntityPoint) {
            continue;
        }
        if (scannedE[ei].tags.ProfileStation === "Q1") {
            q1Pos = ent.getPosition();
        }
        if (scannedE[ei].tags.ProfileStation === "R1") {
            r1Pos = ent.getPosition();
        }
    }
    if (q1Pos !== null) {
        ok(Math.abs(q1Pos.y - 0.0) < 1e-9,
            "Q1 (zOffset 0) draws at its true elevation, y=0 (got " +
            q1Pos.y + ")");
    }
    if (r1Pos !== null) {
        ok(Math.abs(r1Pos.y - bandR.zOffset) < 1e-9,
            "R1 draws at bandR.zOffset (" + bandR.zOffset +
            "), not at its true elevation 0 (got " + r1Pos.y + ") -- " +
            "PROOF zOffset actually reaches drawn geometry, not just " +
            "the caption");
    }

    // ProfileZOffset itself is only ever asserted ABSENT (fixture 4,
    // zOffset === 0) elsewhere in this file -- the positive case, where
    // a real displacement actually gets tagged and captioned, was
    // unasserted even though bandR already has zOffset = -5 right here.
    var bandRLabel = null;
    for (var eri = 0; eri < scannedE.length; eri++) {
        if (scannedE[eri].tags.ProfileBandLabel === "R") { bandRLabel = scannedE[eri]; }
    }
    ok(bandRLabel !== null, "sanity: found band R's caption");
    if (bandRLabel !== null) {
        eqs(bandRLabel.tags.ProfileZOffset, String(bandR.zOffset),
            "the displaced band's caption is tagged with its own " +
            "zOffset, not merely captioned in prose");
        var expectedRText = CsDraw.caps(CsProfileDraw.labelText(bandR));
        if (typeof bandRLabel.entity.getPlainText === "function") {
            eqs(bandRLabel.entity.getPlainText(), expectedRText,
                "the displaced band's caption reads the real offset " +
                "(e.g. \"R SURVEY -- SHOWN 5.0 BELOW TRUE ELEVATION\")");
        }
    }
    destr(diE);
}

// =======================================================================
// 4. A band that stopped at its own first station: CsProfile.unrollBand
//    never resolved a Z for it at all, so `stations` is empty, `legs`
//    is empty, and `datum` is null (CsProfile.unrollBand: null, never a
//    fabricated 0, is what "no real elevation" looks like). render()
//    must not crash, and the label it draws must not read as if the
//    band existed at elevation 0.
// =======================================================================

var svD = CsModel.newSurvey();
svD.shots = [ shotOf("D1", "D2", 10, 0, 0) ];
// opts.anchor with no z, and D1 absent from survey.fixed, is the one
// documented path to a null resolved Z (CsNetwork.resolve's own
// anchorZUnknown handling) -- survey.fixed's own writers always default
// a missing z to 0.0 themselves, so that route can never reach this
// case (see CsNetwork.resolve's seedFixed comment).
var resolvedD = CsNetwork.resolve(svD, { anchor: { name: "D1", x: 0, y: 0 } });
ok(resolvedD.anchorZUnknown !== null,
    "sanity: this really is the null-anchor-Z path");
ok(resolvedD.stations.D1.z === null, "sanity: D1's resolved Z is null");

var profileD = CsProfile.build(svD, resolvedD, {});
eqs(profileD.bands.length, 1, "sanity: one band");
eqs(profileD.bands[0].stations.length, 0,
    "sanity: the band drew zero stations");
eqs(profileD.bands[0].stopped, "D1", "sanity: stopped at D1");
eqs(profileD.bands[0].stoppedReason, "no-z", "sanity: reason is no-z");
eqs(profileD.bands[0].datum, null,
    "sanity: datum is null, not a fabricated 0, for this band");

var docD = new RDocument(new RMemoryStorage(), createSpatialIndex());
var diD = new RDocumentInterface(docD);
var resD = CsProfileDraw.render(docD, diD, profileD, {});
eqs(resD.bandsDrawn, 1, "the zero-station band still counts as drawn");
eqs(resD.stationsDrawn, 0, "no stations drawn for it");
eqs(resD.legsDrawn, 0, "no legs drawn for it");

var scannedD = scanProfileEntities(docD);
var labelD = null;
for (var di2 = 0; di2 < scannedD.length; di2++) {
    if (scannedD[di2].tags.ProfileBandLabel === "D") { labelD = scannedD[di2]; }
}
ok(labelD !== null, "the band still gets a caption");
if (labelD !== null) {
    // getPlainText, not getText -- CsSheet.textOf's own precedent for
    // reading a text entity's content back in this bridge; getText()
    // is not actually implemented here (confirmed by hand: it comes
    // back undefined on both RPointEntity and RTextEntity alike), so a
    // getText()-based check would silently never run at all rather
    // than fail loudly, exactly the "decoration test" this feature's
    // brief warns against.
    var expectedText = CsDraw.caps(CsProfileDraw.labelText(profileD.bands[0]));
    ok(typeof labelD.entity.getPlainText === "function",
        "sanity: this bridge can read a text entity's content back");
    if (typeof labelD.entity.getPlainText === "function") {
        eqs(labelD.entity.getPlainText(), expectedText,
            "the caption names the real station and reason, not a bare " +
            "or fabricated-elevation label");
    }
    var pos = (typeof labelD.entity.getPosition === "function") ?
        labelD.entity.getPosition() : null;
    if (pos !== null) {
        ok(!isNaN(pos.y) && isFinite(pos.y),
            "the caption's Y is a real, finite number, not NaN (got " +
            pos.y + ")");
    }
    ok(labelD.tags.ProfileZOffset === undefined,
        "a band with no span gets no ProfileZOffset tag (zOffset is " +
        "0 -- CsProfile.layout's own default for a bandless span -- " +
        "not a number worth reporting)");
}

destr(diD);

// =======================================================================
// 5. THE SKETCH MUST MOVE, NOT MERELY SURVIVE -- Task 11. A line snapped
//    exactly onto the A2/A3 station points must follow those stations
//    when a revised shot slides them along the profile.
//
//    WHY EXACT COINCIDENCE, NOT A CEILING-HEIGHT OFFSET: CsProfileBind.
//    stationIndex is built strictly from ProfileStation-tagged POINTS
//    (see its acceptance criterion), not from ceiling/floor run
//    vertices -- CsProfile.bandWallRuns' points carry no station name at
//    all once collected (only `flat` splay ticks do), so there is no
//    tag to recover one from. A sketch traced at ceiling/floor HEIGHT
//    therefore never gets the exact-match binding CsBind's plan-side
//    LRUD tips give a wall snapped to them; it can only ever reach the
//    PROXIMITY fallback (see fixture 5d below), which is a real,
//    deliberate divergence from plan-view parity worth stating plainly
//    rather than leaving implicit. This fixture proves the exact-match
//    path and the mover cleanly, snapping directly onto the two
//    station points themselves.
// =======================================================================

(function() {
    var sv2 = CsModel.newSurvey();
    sv2.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res2 = CsNetwork.resolve(sv2, {});
    var built = CsProfile.build(sv2, res2, {});

    var d2 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i2 = new RDocumentInterface(d2);
    CsProfileDraw.render(d2, i2, built, {});

    var bandA = built.bands[0];
    var p2 = null, p3 = null;
    for (var i = 0; i < bandA.stations.length; i++) {
        if (bandA.stations[i].name === "A2") { p2 = bandA.stations[i]; }
        if (bandA.stations[i].name === "A3") { p3 = bandA.stations[i]; }
    }
    CsLayers.ensure(d2, i2, "PROFILE-CEILING");
    var op2 = new RAddObjectsOperation();
    var traced = new RLineEntity(d2, new RLineData(
        new RVector(p2.x, p2.y), new RVector(p3.x, p3.y)));
    traced.setLayerId(d2.getLayerId("PROFILE-CEILING"));
    op2.addObject(traced, false);
    i2.applyOperation(op2);
    var tracedId = traced.getId();

    // now the survey changes: the first leg was really 20 ft, so
    // everything downstream slides 10 ft along the profile
    sv2.shots[0].distance = 20;
    var res3 = CsNetwork.resolve(sv2, {});
    var rebuilt = CsProfile.build(sv2, res3, {});
    var counts = CsProfileDraw.render(d2, i2, rebuilt, {});

    var after = d2.queryEntity(tracedId);
    ok(!isNull(after), "the traced line still exists after regeneration");
    if (!isNull(after)) {
        var moved = after.getStartPoint();
        near(moved.x, p2.x + 10, 0.001,
            "THE TRACED LINE MOVED WITH ITS STATIONS (x " + moved.x +
            ", expected " + (p2.x + 10) + ")");
    }
    ok(counts.linework !== undefined, "sanity: counts.linework exists");
    eqs(counts.linework.moved, 1,
        "the move is reported (" + JSON.stringify(counts.linework) + ")");
    destr(i2);
}());

// =======================================================================
// 5b. THE TRAP: the tracing layer is HIDDEN when the revision runs --
//    exactly the workflow that motivated off-layer protection in the
//    first place (hiding the generated ceiling to trace over it on the
//    plain PROFILE-CEILING layer). This build refuses MODIFIES on an
//    off layer as silently as it refuses adds and deletes, and BOTH the
//    claim (tags the sketch) and the move (ent.rotate/scale/move plus
//    op.addObject) are MODIFIES. Without CsRevise.withOffLayersOn around
//    each, the sketch would be silently left behind while the survey
//    moves underneath it -- exactly the bug the user asked this task to
//    fix, reintroduced by the one workflow that needs it most.
// =======================================================================

(function() {
    var sv4 = CsModel.newSurvey();
    sv4.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res4 = CsNetwork.resolve(sv4, {});
    var built4 = CsProfile.build(sv4, res4, {});

    var d4 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i4 = new RDocumentInterface(d4);
    CsProfileDraw.render(d4, i4, built4, {});

    var bandA4 = built4.bands[0];
    var q2 = null, q3 = null;
    for (var qi = 0; qi < bandA4.stations.length; qi++) {
        if (bandA4.stations[qi].name === "A2") { q2 = bandA4.stations[qi]; }
        if (bandA4.stations[qi].name === "A3") { q3 = bandA4.stations[qi]; }
    }
    CsLayers.ensure(d4, i4, "PROFILE-CEILING");
    var op4 = new RAddObjectsOperation();
    var traced4 = new RLineEntity(d4, new RLineData(
        new RVector(q2.x, q2.y), new RVector(q3.x, q3.y)));
    traced4.setLayerId(d4.getLayerId("PROFILE-CEILING"));
    op4.addObject(traced4, false);
    i4.applyOperation(op4);
    var traced4Id = traced4.getId();

    // the user hides their own tracing layer BEFORE the revision runs --
    // the everyday act of getting a busy sketch out of the way
    var tracingLayer = d4.queryLayer("PROFILE-CEILING");
    ok(!isNull(tracingLayer), "sanity: PROFILE-CEILING exists");
    tracingLayer.setOff(true);
    var offOp4 = new RModifyObjectsOperation();
    offOp4.addObject(tracingLayer, false);
    i4.applyOperation(offOp4);
    ok(d4.queryLayer("PROFILE-CEILING").isOff(),
        "sanity: PROFILE-CEILING is now off");

    sv4.shots[0].distance = 20;
    var res5 = CsNetwork.resolve(sv4, {});
    var rebuilt4 = CsProfile.build(sv4, res5, {});
    var counts4 = CsProfileDraw.render(d4, i4, rebuilt4, {});

    var after4 = d4.queryEntity(traced4Id);
    ok(!isNull(after4),
        "the traced line on the HIDDEN layer still exists after regen");
    if (!isNull(after4)) {
        var moved4 = after4.getStartPoint();
        near(moved4.x, q2.x + 10, 0.001,
            "THE TRACED LINE MOVED EVEN THOUGH ITS LAYER WAS HIDDEN (x " +
            moved4.x + ", expected " + (q2.x + 10) + ")");
    }
    ok(counts4.linework !== undefined, "sanity: counts4.linework exists");
    eqs(counts4.linework.moved, 1,
        "the move on a hidden layer is reported (" +
        JSON.stringify(counts4.linework) + ")");
    ok(d4.queryLayer("PROFILE-CEILING").isOff(),
        "the user's own off choice for PROFILE-CEILING was restored " +
        "afterward");
    destr(i4);
}());

// =======================================================================
// 5c. AN UNBOUND SKETCH -- drawn nowhere near any station -- is left
//    exactly where it is, and named in counts.linework.unmoved rather
//    than silently dropped or silently moved on a guess.
// =======================================================================

(function() {
    var sv6 = CsModel.newSurvey();
    sv6.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res6 = CsNetwork.resolve(sv6, {});
    var built6 = CsProfile.build(sv6, res6, {});

    var d6 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i6 = new RDocumentInterface(d6);
    CsProfileDraw.render(d6, i6, built6, {});

    // far from every station (the band spans x in [0, 20]) and far
    // outside marginFor's proximity box, so this cannot bind by either
    // exact coincidence or proximity
    CsLayers.ensure(d6, i6, "PROFILE-CEILING");
    var op6 = new RAddObjectsOperation();
    var stray = new RLineEntity(d6, new RLineData(
        new RVector(500, 500), new RVector(520, 500)));
    stray.setLayerId(d6.getLayerId("PROFILE-CEILING"));
    op6.addObject(stray, false);
    i6.applyOperation(op6);
    var strayId = stray.getId();

    sv6.shots[0].distance = 20;
    var res7 = CsNetwork.resolve(sv6, {});
    var rebuilt6 = CsProfile.build(sv6, res7, {});
    var counts6 = CsProfileDraw.render(d6, i6, rebuilt6, {});

    var strayAfter = d6.queryEntity(strayId);
    ok(!isNull(strayAfter), "the stray sketch still exists after regen");
    if (!isNull(strayAfter)) {
        var strayPos = strayAfter.getStartPoint();
        near(strayPos.x, 500, 1e-9,
            "THE UNBOUND SKETCH DID NOT MOVE (x " + strayPos.x + ")");
        near(strayPos.y, 500, 1e-9,
            "THE UNBOUND SKETCH DID NOT MOVE (y " + strayPos.y + ")");
    }
    ok(counts6.claimed !== undefined, "sanity: counts6.claimed exists");
    eqs(counts6.claimed.skipped, 1,
        "claim() names the stray sketch as skipped, not silently " +
        "dropped (" + JSON.stringify(counts6.claimed) + ")");
    ok(counts6.linework !== undefined, "sanity: counts6.linework exists");
    eqs(counts6.linework.unmoved.length, 1,
        "the unbound sketch is NAMED in counts.linework.unmoved -- " +
        "claim()'s own skippedLabels folded in, since an untagged " +
        "entity is invisible to moveLinework's own scan by design and " +
        "would otherwise be reported nowhere at all (" +
        JSON.stringify(counts6.linework) + ")");
    destr(i6);
}());

// =======================================================================
// 5d. THE PROXIMITY FALLBACK, exercised for real: a sketch traced NEAR
//    (not exactly onto) a run of stations that all shift by the same
//    amount. Six stations, corrected leg at the very start (A1->A2) --
//    A2 through A6 all slide by the same +10, so a sketch bound to
//    several of them by proximity is still one rigid move, and the
//    fallback this module falls back to is proven to actually work,
//    not just to exist unexercised.
// =======================================================================

(function() {
    var sv7 = CsModel.newSurvey();
    sv7.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        shotOf("A3", "A4", 10, 0, 0, 4, 2),
        shotOf("A4", "A5", 10, 0, 0, 4, 2),
        shotOf("A5", "A6", 10, 0, 0, 4, 2)
    ];
    var res8 = CsNetwork.resolve(sv7, {});
    var built7 = CsProfile.build(sv7, res8, {});

    var d7 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i7 = new RDocumentInterface(d7);
    CsProfileDraw.render(d7, i7, built7, {});

    var bandA7 = built7.bands[0];
    var p4 = null, p5 = null;
    for (var pi = 0; pi < bandA7.stations.length; pi++) {
        if (bandA7.stations[pi].name === "A4") { p4 = bandA7.stations[pi]; }
        if (bandA7.stations[pi].name === "A5") { p5 = bandA7.stations[pi]; }
    }
    // 1 unit above the centerline: near A4/A5, inside marginFor's
    // proximity box, but NOT exact coincidence -- stationsForPoints
    // must fail here for the box fallback to be the path under test
    CsLayers.ensure(d7, i7, "PROFILE-CEILING");
    var op7 = new RAddObjectsOperation();
    var traced7 = new RLineEntity(d7, new RLineData(
        new RVector(p4.x, p4.y + 1), new RVector(p5.x, p5.y + 1)));
    traced7.setLayerId(d7.getLayerId("PROFILE-CEILING"));
    op7.addObject(traced7, false);
    i7.applyOperation(op7);
    var traced7Id = traced7.getId();

    sv7.shots[0].distance = 20;
    var res9 = CsNetwork.resolve(sv7, {});
    var rebuilt7 = CsProfile.build(sv7, res9, {});
    var counts7 = CsProfileDraw.render(d7, i7, rebuilt7, {});

    var after7 = d7.queryEntity(traced7Id);
    ok(!isNull(after7),
        "the proximity-bound sketch still exists after regeneration");
    if (!isNull(after7)) {
        var moved7 = after7.getStartPoint();
        near(moved7.x, p4.x + 10, 0.001,
            "THE PROXIMITY-BOUND SKETCH MOVED WITH ITS NEARBY STATIONS " +
            "(x " + moved7.x + ", expected " + (p4.x + 10) + ")");
    }
    ok(counts7.linework !== undefined, "sanity: counts7.linework exists");
    eqs(counts7.linework.moved, 1,
        "the proximity-fallback move is reported (" +
        JSON.stringify(counts7.linework) + ")");
    destr(i7);
}());

// =======================================================================
// 5e. RUN-QUALIFICATION MATTERS FOR REAL, not just in the abstract: a
//    spur run B tying off A2 gives "A2" TWO drawn positions in the SAME
//    document -- its own place in band A, and band B's own X-origin
//    tie-in copy. Two sketches, each snapped exactly onto stations in
//    its OWN band, must each follow ONLY its own band's revision. If
//    CsProfileBind.key ever collapsed to the bare station name, the
//    two "A2" positions would collide in the before/after maps
//    (CsProfileBind.positions' "first writer wins" and
//    CsProfileDraw.positionsOf's later-band-overwrites-earlier would
//    almost certainly pick DIFFERENT survivors), corrupting whichever
//    sketch depends on the entry that lost -- proven here rather than
//    only argued, by reviving the everyday case: a distance correction
//    upstream in run A must not so much as twitch a spur tied off it.
// =======================================================================

(function() {
    var sv8 = CsModel.newSurvey();
    sv8.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        // a real elevation change on the tie leg, so band B's gutter
        // offset keeps its drawn "A2" tie-copy from landing exactly on
        // top of band A's own A1 (both would otherwise sit at (0,0))
        shotOf("A2", "B1", 10, 90, -30, 4, 2),
        shotOf("B1", "B2", 10, 0, 0, 4, 2)
    ];
    var res10 = CsNetwork.resolve(sv8, {});
    var built8 = CsProfile.build(sv8, res10, {});
    eqs(built8.bands.length, 2, "sanity: two bands, A and the B spur");

    var d8 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i8 = new RDocumentInterface(d8);
    CsProfileDraw.render(d8, i8, built8, {});

    var idx8 = CsProfileBind.stationIndex(d8);
    var drawn = {};
    for (var xi = 0; xi < idx8.length; xi++) { drawn[idx8[xi].name] = idx8[xi]; }
    ok(drawn["A/A2"] !== undefined && drawn["B/A2"] !== undefined,
        "sanity: \"A2\" is drawn TWICE under two DIFFERENT qualified keys");
    // entryOf(), not a direct dereference: a mutation that breaks the
    // sanity check above (drawn["A/A2"] or drawn["B/A2"] missing) must
    // fail a NAMED assertion, not crash this whole file on a raw
    // TypeError before the failure list above even gets printed.
    ok(Math.abs(entryOf(drawn, "A/A2").x - entryOf(drawn, "B/A2").x) > 1 ||
        Math.abs(entryOf(drawn, "A/A2").y - entryOf(drawn, "B/A2").y) > 1,
        "sanity: the two A2 copies sit at genuinely different drawn " +
        "positions (A/A2=" + JSON.stringify(drawn["A/A2"]) + ", B/A2=" +
        JSON.stringify(drawn["B/A2"]) + ")");

    // sketch bound entirely within band A: A2 -> A3, exact coincidence
    CsLayers.ensure(d8, i8, "PROFILE-CEILING");
    var opA = new RAddObjectsOperation();
    var sketchA = new RLineEntity(d8, new RLineData(
        new RVector(entryOf(drawn, "A/A2").x, entryOf(drawn, "A/A2").y),
        new RVector(entryOf(drawn, "A/A3").x, entryOf(drawn, "A/A3").y)));
    sketchA.setLayerId(d8.getLayerId("PROFILE-CEILING"));
    opA.addObject(sketchA, false);
    i8.applyOperation(opA);
    var sketchAId = sketchA.getId();

    // sketch bound entirely within band B: its OWN A2 tie-copy -> B1,
    // exact coincidence -- must never be confused with band A's A2
    var opB = new RAddObjectsOperation();
    var sketchB = new RLineEntity(d8, new RLineData(
        new RVector(entryOf(drawn, "B/A2").x, entryOf(drawn, "B/A2").y),
        new RVector(entryOf(drawn, "B/B1").x, entryOf(drawn, "B/B1").y)));
    sketchB.setLayerId(d8.getLayerId("PROFILE-CEILING"));
    opB.addObject(sketchB, false);
    i8.applyOperation(opB);
    var sketchBId = sketchB.getId();

    var expectA3x = entryOf(drawn, "A/A3").x,
        expectB1x = entryOf(drawn, "B/B1").x,
        expectB1y = entryOf(drawn, "B/B1").y;

    // revise ONLY the A1->A2 leg -- band B ties off A2 but restarts its
    // own X at 0 regardless, so nothing about band B should move at all
    sv8.shots[0].distance = 20;
    var res11 = CsNetwork.resolve(sv8, {});
    var rebuilt8 = CsProfile.build(sv8, res11, {});
    var counts8 = CsProfileDraw.render(d8, i8, rebuilt8, {});

    eqs(counts8.claimed.tagged, 2, "both sketches got claimed");
    eqs(counts8.linework.moved, 2,
        "both sketches' moves are reported (" +
        JSON.stringify(counts8.linework) + ")");

    var sketchAAfter = d8.queryEntity(sketchAId);
    var sketchBAfter = d8.queryEntity(sketchBId);
    ok(!isNull(sketchAAfter) && !isNull(sketchBAfter),
        "sanity: both sketches survived regeneration");
    if (!isNull(sketchAAfter)) {
        near(sketchAAfter.getEndPoint().x, expectA3x + 10, 0.001,
            "BAND A'S SKETCH FOLLOWED BAND A'S OWN REVISION (x " +
            sketchAAfter.getEndPoint().x + ", expected " +
            (expectA3x + 10) + ")");
    }
    if (!isNull(sketchBAfter)) {
        // band B is UNTOUCHED by a correction made entirely upstream in
        // band A -- this is the assertion a bare, unqualified "A2" key
        // would corrupt (see this fixture's own banner)
        near(sketchBAfter.getEndPoint().x, expectB1x, 0.001,
            "BAND B'S SKETCH DID NOT MOVE -- UNAFFECTED BY BAND A'S " +
            "REVISION (x " + sketchBAfter.getEndPoint().x +
            ", expected unchanged " + expectB1x + ")");
        near(sketchBAfter.getEndPoint().y, expectB1y, 0.001,
            "BAND B'S SKETCH Y IS ALSO UNCHANGED (y " +
            sketchBAfter.getEndPoint().y + ", expected " + expectB1y + ")");
    }
    destr(i8);
}());

// =======================================================================
// 5f. A SKETCH SPANNING TWO BANDS -- documented behaviour, not a defect.
//    CsRevise.similarityFit over exactly TWO points always finds a
//    zero-residual fit (two points fully determine a similarity
//    transform), so moveLinework accepts it even when the two points
//    come from bands that move independently of one another -- there is
//    no THIRD point here to expose the inconsistency the way fixture 5's
//    residual check would catch it for three or more. The result is a
//    real move, reported as such, that can reshape (rotate/scale) the
//    sketch to force both endpoints onto their respective targets. This
//    is CsRevise.moveLinework's own documented tradeoff for a 2-point
//    fit ("the pair IS the definition of the rigid piece"), inherited
//    unchanged per the user's explicit decision to reuse it as-is --
//    profile drawings just reach it more often, because a station name
//    recurring across bands is normal here, not an edge case.
// =======================================================================

(function() {
    var sv9 = CsModel.newSurvey();
    sv9.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2),
        shotOf("A2", "B1", 10, 90, -30, 4, 2),
        shotOf("B1", "B2", 10, 0, 0, 4, 2)
    ];
    var res12 = CsNetwork.resolve(sv9, {});
    var built9 = CsProfile.build(sv9, res12, {});

    var d9 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i9 = new RDocumentInterface(d9);
    CsProfileDraw.render(d9, i9, built9, {});

    var idx9 = CsProfileBind.stationIndex(d9);
    var drawn9 = {};
    for (var yi = 0; yi < idx9.length; yi++) { drawn9[idx9[yi].name] = idx9[yi]; }

    ok(drawn9["A/A2"] !== undefined && drawn9["B/B1"] !== undefined,
        "sanity: A/A2 and B/B1 are both in the stationIndex");

    CsLayers.ensure(d9, i9, "PROFILE-CEILING");
    var opC = new RAddObjectsOperation();
    // entryOf(), not a direct dereference -- see fixture 5e's own note
    // on why: a failed sanity check above must fail loudly, not crash
    // this file on a raw TypeError first.
    var cross = new RLineEntity(d9, new RLineData(
        new RVector(entryOf(drawn9, "A/A2").x, entryOf(drawn9, "A/A2").y),
        new RVector(entryOf(drawn9, "B/B1").x, entryOf(drawn9, "B/B1").y)));
    cross.setLayerId(d9.getLayerId("PROFILE-CEILING"));
    opC.addObject(cross, false);
    i9.applyOperation(opC);
    var crossId = cross.getId();

    sv9.shots[0].distance = 20;
    var res13 = CsNetwork.resolve(sv9, {});
    var rebuilt9 = CsProfile.build(sv9, res13, {});
    var counts9 = CsProfileDraw.render(d9, i9, rebuilt9, {});

    eqs(CsBind.decodeStations(CsTags.get(d9.queryEntity(crossId),
        CsBind.STATIONS_TAG)).join(","), "A/A2,B/B1",
        "the cross-band sketch is bound to BOTH stations, one per band");
    ok(counts9.linework !== undefined && counts9.linework.moved === 1,
        "a 2-point cross-band fit is accepted (residual is always 0 " +
        "for exactly two points), not refused -- documented behaviour, " +
        "inherited from CsRevise.moveLinework unchanged (" +
        JSON.stringify(counts9.linework) + ")");
    var crossAfter = d9.queryEntity(crossId);
    ok(!isNull(crossAfter), "sanity: the cross-band sketch still exists");
    if (!isNull(crossAfter)) {
        near(crossAfter.getStartPoint().x, entryOf(drawn9, "A/A2").x + 10,
            0.001, "one endpoint lands on A2's own new position");
        near(crossAfter.getEndPoint().x, entryOf(drawn9, "B/B1").x, 0.001,
            "the other endpoint stays on B1's unchanged position -- the " +
            "line was reshaped to hit both, not translated as a whole");
    }
    destr(i9);
}());

// =======================================================================
// 6. CRITICAL 3 -- a PROMOTED STATION POINT (not a ceiling run, which
//    fixture 2b already covers) must not create a permanently
//    corrupting duplicate index entry. The promoted point survives
//    erase() (same ownership test as 2b), and the next render() draws
//    a FRESH point at the recomputed position beside it -- now TWO
//    EntityPoints answer to the SAME run-qualified key (A/A2). Before
//    this fix, CsProfileBind.stationIndex indexed both (its own
//    comment used to claim a duplicate "would be a bug in the draw",
//    which this fixture disproves) and positions()' "first writer
//    wins" took WHICHEVER ONE queryAllEntities happened to list first
//    -- unspecified order per this repo's own convention -- so a
//    sketch bound to A/A2 could be moved by a bogus delta forever,
//    since the stale promoted point never moves again once it is off
//    CsProfileDraw's own layers.
// =======================================================================

(function() {
    var svP = CsModel.newSurvey();
    svP.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var resP = CsNetwork.resolve(svP, {});
    var builtP = CsProfile.build(svP, resP, {});

    var dP = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iP = new RDocumentInterface(dP);
    CsProfileDraw.render(dP, iP, builtP, {});

    // find A2's station POINT (not its label -- see isPointEntity above)
    var a2Id = null;
    var idsP0 = dP.queryAllEntities(false, false);
    for (var pi0 = 0; pi0 < idsP0.length; pi0++) {
        var eP0 = dP.queryEntity(idsP0[pi0]);
        if (isNull(eP0) || !isPointEntity(eP0)) { continue; }
        if (CsTags.get(eP0, "ProfileStation") === "A2" &&
                CsTags.get(eP0, "ProfileRun") === "A") {
            a2Id = idsP0[pi0];
        }
    }
    ok(a2Id !== null, "sanity: found A2's station point to promote");

    if (a2Id !== null) {
        // promote it: change ITS LAYER to the plain tracing layer,
        // exactly the cartographer move fixture 2b already covers for
        // a ceiling run -- XDATA (ProfileStation/ProfileRun) survives
        // with it
        CsLayers.ensure(dP, iP, "PROFILE-CEILING");
        var promoteOpP = new RModifyObjectsOperation();
        var a2Ent = dP.queryEntity(a2Id);
        var a2StalePos = a2Ent.getPosition();
        a2Ent.setLayerId(dP.getLayerId("PROFILE-CEILING"));
        promoteOpP.addObject(a2Ent, false);
        iP.applyOperation(promoteOpP);
        ok(dP.getLayerName(dP.queryEntity(a2Id).getLayerId()) ===
            "PROFILE-CEILING",
            "sanity: A2's point really did move to the plain tracing " +
            "layer");
        ok(CsTags.get(dP.queryEntity(a2Id), "ProfileStation") === "A2",
            "sanity: XDATA survived the layer change");

        // revise: A1->A2 grows by 10, so a FRESH A2 point lands 10 away
        // from the stale, promoted one
        svP.shots[0].distance = 20;
        var resP2 = CsNetwork.resolve(svP, {});
        var rebuiltP = CsProfile.build(svP, resP2, {});
        CsProfileDraw.render(dP, iP, rebuiltP, {});

        var idxP = CsProfileBind.stationIndex(dP);
        var a2Entries = [];
        for (var pi = 0; pi < idxP.length; pi++) {
            if (idxP[pi].name === "A/A2") { a2Entries.push(idxP[pi]); }
        }
        eqs(a2Entries.length, 1,
            "stationIndex() HAS EXACTLY ONE ENTRY FOR A/A2 -- the " +
            "promoted, stale point (now off CsProfileDraw's own " +
            "layers) must drop out of the index, not sit alongside " +
            "the fresh one (entries: " + JSON.stringify(a2Entries) + ")");
        if (a2Entries.length === 1) {
            near(a2Entries[0].x, a2StalePos.x + 10, 0.001,
                "the ONE indexed A/A2 position is the FRESH one, not " +
                "the stale promoted point left behind at its old " +
                "position (got " + a2Entries[0].x + ", expected " +
                (a2StalePos.x + 10) + ")");
        }

        // positions() is the exact function moveLinework's "before"
        // frame is built from -- the review's own reproduction measured
        // THIS function specifically
        var posP = CsProfileBind.positions(dP);
        ok(posP.hasOwnProperty("A/A2"), "positions() still has an A/A2 entry");
        if (posP.hasOwnProperty("A/A2")) {
            near(posP["A/A2"].x, a2StalePos.x + 10, 0.001,
                "positions()['A/A2'] READS THE FRESH POSITION, not the " +
                "stale promoted point's (got " + posP["A/A2"].x +
                ", stale was " + a2StalePos.x + ")");
        }
    }

    destr(iP);
}());

// =======================================================================
// 7. CRITICAL 2 -- claim() must respect CsBind.autoBindEnabled(). With
//    the switch OFF, CsBind.planAutoBind claims nothing on the plan
//    side (its own FIRST guard, documented "Empty when the switch is
//    off"); CsProfileBind.claim must refuse the identical way, or a
//    user who explicitly switched binding off still gets an
//    unauthorised write (LineworkStations) to their own drawing, and
//    the sketch moves out from under them anyway -- exactly what the
//    switch's own OFF tooltip promises will NOT happen ("revising a
//    trip will move the survey and leave your tracing behind").
// =======================================================================

(function() {
    var svS = CsModel.newSurvey();
    svS.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var resS = CsNetwork.resolve(svS, {});
    var builtS = CsProfile.build(svS, resS, {});

    var dS = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iS = new RDocumentInterface(dS);
    CsProfileDraw.render(dS, iS, builtS, {});

    var bandAS = builtS.bands[0];
    var s2 = null, s3 = null;
    for (var si = 0; si < bandAS.stations.length; si++) {
        if (bandAS.stations[si].name === "A2") { s2 = bandAS.stations[si]; }
        if (bandAS.stations[si].name === "A3") { s3 = bandAS.stations[si]; }
    }
    CsLayers.ensure(dS, iS, "PROFILE-CEILING");
    var opS = new RAddObjectsOperation();
    var tracedS = new RLineEntity(dS, new RLineData(
        new RVector(s2.x, s2.y), new RVector(s3.x, s3.y)));
    tracedS.setLayerId(dS.getLayerId("PROFILE-CEILING"));
    opS.addObject(tracedS, false);
    iS.applyOperation(opS);
    var tracedSId = tracedS.getId();

    var realOverrideOff = CsBind.autoBindOverride;
    try {
        CsBind.autoBindOverride = false; // the user's own explicit choice

        // a genuine move, so claim() is even REACHED at all -- see
        // CsProfileDraw.render's own "claim costs an undo step" guard,
        // which skips claim() entirely when nothing is going to move
        svS.shots[0].distance = 20;
        var resS2 = CsNetwork.resolve(svS, {});
        var rebuiltS = CsProfile.build(svS, resS2, {});
        var countsS = CsProfileDraw.render(dS, iS, rebuiltS, {});

        ok(countsS.linework.moved === 0, "sanity: the survey really did " +
            "change (a move was attempted; the switch, not a no-op, " +
            "is why nothing got claimed)");
        eqs(countsS.claimed.tagged, 0,
            "WITH THE SWITCH OFF, claim() TAGS NOTHING (got " +
            JSON.stringify(countsS.claimed) + ")");
        ok(CsBind.hasLineworkTags(dS.queryEntity(tracedSId)) === false,
            "the untagged sketch is STILL untagged -- no unauthorised " +
            "write to the user's own drawing");
        var afterS = dS.queryEntity(tracedSId).getStartPoint();
        near(afterS.x, s2.x, 1e-9,
            "OPT-OUT: THE NEVER-CLAIMED SKETCH DID NOT MOVE, exactly " +
            "the promise the OFF tooltip makes (\"leave your tracing " +
            "behind\")");
    } finally {
        CsBind.autoBindOverride = realOverrideOff;
    }
    destr(iS);
}());

// =======================================================================
// 7b. THE CONTRAST CASE, for the SAME code path: with the switch back
//    ON (its default), an identical untagged sketch IS claimed and DOES
//    move -- proving 7's refusal above is really the switch's doing,
//    not some other reason the fixture happens to skip claiming.
// =======================================================================

(function() {
    var svT = CsModel.newSurvey();
    svT.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var resT = CsNetwork.resolve(svT, {});
    var builtT = CsProfile.build(svT, resT, {});

    var dT = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iT = new RDocumentInterface(dT);
    CsProfileDraw.render(dT, iT, builtT, {});

    var bandAT = builtT.bands[0];
    var t2 = null, t3 = null;
    for (var ti = 0; ti < bandAT.stations.length; ti++) {
        if (bandAT.stations[ti].name === "A2") { t2 = bandAT.stations[ti]; }
        if (bandAT.stations[ti].name === "A3") { t3 = bandAT.stations[ti]; }
    }
    CsLayers.ensure(dT, iT, "PROFILE-CEILING");
    var opT = new RAddObjectsOperation();
    var tracedT = new RLineEntity(dT, new RLineData(
        new RVector(t2.x, t2.y), new RVector(t3.x, t3.y)));
    tracedT.setLayerId(dT.getLayerId("PROFILE-CEILING"));
    opT.addObject(tracedT, false);
    iT.applyOperation(opT);
    var tracedTId = tracedT.getId();

    var realOverrideOn = CsBind.autoBindOverride;
    try {
        CsBind.autoBindOverride = true; // explicitly ON, not just default

        svT.shots[0].distance = 20;
        var resT2 = CsNetwork.resolve(svT, {});
        var rebuiltT = CsProfile.build(svT, resT2, {});
        var countsT = CsProfileDraw.render(dT, iT, rebuiltT, {});

        eqs(countsT.claimed.tagged, 1,
            "WITH THE SWITCH ON, claim() DOES tag the sketch (got " +
            JSON.stringify(countsT.claimed) + ")");
        ok(CsBind.hasLineworkTags(dT.queryEntity(tracedTId)) === true,
            "the sketch is now tagged");
        eqs(countsT.linework.moved, 1, "and it moved");
        near(dT.queryEntity(tracedTId).getStartPoint().x, t2.x + 10, 0.001,
            "the claimed sketch actually followed its station");
    } finally {
        CsBind.autoBindOverride = realOverrideOn;
    }
    destr(iT);
}());

// =======================================================================
// 8. IMPORTANT #5a -- redrawing an UNCHANGED profile must not move (or
//    cost an undo step for) linework that never needed to move at all.
//    Without CsRevise.positionsMoved's own guard around the claim AND
//    the move calls, an idempotent redraw would still find an exact
//    (zero-distance) fit for an already-bound entity and dutifully
//    rotate/scale/move it by nothing, reporting a "move" that never had
//    to happen.
// =======================================================================

(function() {
    var svG = CsModel.newSurvey();
    svG.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var resG = CsNetwork.resolve(svG, {});
    var builtG = CsProfile.build(svG, resG, {});

    var dG = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iG = new RDocumentInterface(dG);
    CsProfileDraw.render(dG, iG, builtG, {});

    var bandAG = builtG.bands[0];
    var g2 = null, g3 = null;
    for (var gi = 0; gi < bandAG.stations.length; gi++) {
        if (bandAG.stations[gi].name === "A2") { g2 = bandAG.stations[gi]; }
        if (bandAG.stations[gi].name === "A3") { g3 = bandAG.stations[gi]; }
    }
    CsLayers.ensure(dG, iG, "PROFILE-CEILING");
    var opG = new RAddObjectsOperation();
    var tracedG = new RLineEntity(dG, new RLineData(
        new RVector(g2.x, g2.y), new RVector(g3.x, g3.y)));
    tracedG.setLayerId(dG.getLayerId("PROFILE-CEILING"));
    opG.addObject(tracedG, false);
    iG.applyOperation(opG);
    var tracedGId = tracedG.getId();

    // one real revision: claims and moves the sketch
    svG.shots[0].distance = 20;
    var resG2 = CsNetwork.resolve(svG, {});
    var rebuiltG = CsProfile.build(svG, resG2, {});
    var countsG1 = CsProfileDraw.render(dG, iG, rebuiltG, {});
    eqs(countsG1.linework.moved, 1,
        "sanity: the one real revision moved the sketch");
    ok(CsBind.hasLineworkTags(dG.queryEntity(tracedGId)) === true,
        "sanity: the sketch got tagged along the way");

    var posBeforeIdempotent = dG.queryEntity(tracedGId).getStartPoint();

    // redraw the SAME, unchanged profile again -- nothing moved, so the
    // already-tagged, already-in-place sketch must be reported as NOT
    // moved this time, not moved-by-zero
    var countsG2 = CsProfileDraw.render(dG, iG, rebuiltG, {});
    eqs(countsG2.linework.moved, 0,
        "AN UNCHANGED REDRAW REPORTS ZERO LINEWORK MOVES, not a " +
        "moved-by-nothing count (got " +
        JSON.stringify(countsG2.linework) + ")");
    var posAfterIdempotent = dG.queryEntity(tracedGId).getStartPoint();
    near(posAfterIdempotent.x, posBeforeIdempotent.x, 1e-9,
        "the sketch's position is unchanged after the idempotent redraw");

    destr(iG);
}());

// =======================================================================
// 9. IMPORTANT #5b -- WAS the residual-refusal tolerance, exercised for
//    real: a sketch spanning stations that move INCOHERENTLY (one stays
//    exactly still, two others share one nonzero shift -- no single
//    rigid transform describes both at once) used to be refused and
//    left EXACTLY where it was, named in counts.linework.unmoved --
//    CsRevise.moveLinework's old "refuse and report rather than mangle"
//    property for a whole-entity rigid fit, otherwise never exercised
//    for the profile side at all (every other fixture in this file that
//    moves a sketch keeps its bound stations moving as one rigid
//    piece).
//
//    That refusal was the OLD contract for a polyline specifically, and
//    this feature's approved design (see
//    docs/superpowers/specs/2026-08-28-linework-warp-design.md)
//    deliberately overturns it: CsRevise.moveLinework now warps a
//    polyline's vertices INDIVIDUALLY through CsWarp.mlsSimilarity
//    instead of fitting one whole-entity rigid transform, so there is
//    no "residual too large" outcome left for a polyline to hit at all
//    -- an incoherent bound-station set is exactly the case a per-vertex
//    warp exists for (the sketch BENDS along its length) rather than a
//    case to refuse. This fixture is kept (not deleted) as the one
//    place in this file that ever fed moveLinework a genuinely
//    non-rigid station set: it now proves the OTHER half of the same
//    contract change -- that the incoherent sketch WARPS, per vertex,
//    matching CsWarp.mlsSimilarity's own prediction for each vertex
//    exactly, and does NOT move as one rigid piece (the interior/end
//    vertices, sitting on stations that shared one nonzero shift, move
//    together; the first vertex, sitting on the station that did not
//    move at all, does not follow them).
// =======================================================================

(function() {
    var svH = CsModel.newSurvey();
    svH.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 20, 4, 2),
        shotOf("A3", "A4", 10, 0, -15, 4, 2),
        shotOf("A4", "A5", 10, 0, 25, 4, 2)
    ];
    var resH = CsNetwork.resolve(svH, {});
    var builtH = CsProfile.build(svH, resH, {});

    var dH = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iH = new RDocumentInterface(dH);
    CsProfileDraw.render(dH, iH, builtH, {});

    var bandAH = builtH.bands[0];
    var h1 = null, h3 = null, h5 = null;
    for (var hi = 0; hi < bandAH.stations.length; hi++) {
        if (bandAH.stations[hi].name === "A1") { h1 = bandAH.stations[hi]; }
        if (bandAH.stations[hi].name === "A3") { h3 = bandAH.stations[hi]; }
        if (bandAH.stations[hi].name === "A5") { h5 = bandAH.stations[hi]; }
    }
    ok(h1 !== null && h3 !== null && h5 !== null,
        "sanity: found A1, A3 and A5 in the built profile");

    if (h1 !== null && h3 !== null && h5 !== null) {
        // a 3-vertex polyline snapped EXACTLY onto A1, A3 and A5 -- three
        // points is enough to over-determine similarityFit (four degrees
        // of freedom, six equations), so a genuinely incoherent
        // movement among them cannot hide inside the fit
        CsLayers.ensure(dH, iH, "PROFILE-CEILING");
        var opH = new RAddObjectsOperation();
        var dataH = new RPolylineData();
        dataH.appendVertex(new RVector(h1.x, h1.y));
        dataH.appendVertex(new RVector(h3.x, h3.y));
        dataH.appendVertex(new RVector(h5.x, h5.y));
        var tracedH = new RPolylineEntity(dH, dataH);
        tracedH.setLayerId(dH.getLayerId("PROFILE-CEILING"));
        opH.addObject(tracedH, false);
        iH.applyOperation(opH);
        var tracedHId = tracedH.getId();
        var beforeVerts = [tracedH.getVertexAt(0), tracedH.getVertexAt(1),
            tracedH.getVertexAt(2)];

        // ONE interior leg grows: A1 stays exactly where it is; A3 and
        // A5 both shift by the SAME delta (the shift happens once, at
        // A2->A3, and then carries forward unchanged through A4 and
        // A5) -- so the bound set is A1 (shift zero) plus two points
        // sharing one nonzero shift, a shape no single
        // rotate+scale+translate can reproduce for a real passage. That
        // is no longer a problem for a polyline: it is precisely the
        // shape a per-vertex warp handles by bending, so this fixture
        // now checks for a bend instead of a refusal.
        svH.shots[1].distance = 20;
        var resH2 = CsNetwork.resolve(svH, {});
        var rebuiltH = CsProfile.build(svH, resH2, {});
        var countsH = CsProfileDraw.render(dH, iH, rebuiltH, {});

        ok(countsH.claimed.tagged >= 1, "sanity: the sketch got claimed");
        eqs(countsH.linework.unmoved.length, 0,
            "THE INCOHERENT SKETCH IS NO LONGER REFUSED -- a polyline " +
            "has no residual-too-large outcome left (got " +
            JSON.stringify(countsH.linework) + ")");
        eqs(countsH.linework.warped, 1,
            "the incoherent sketch WARPS (per-vertex MLS, not a single " +
            "rigid transform), got " + JSON.stringify(countsH.linework));
        eqs(countsH.linework.moved, 0,
            "and does not land in the plain 'moved' bucket, since its " +
            "vertices' local angle/factor genuinely differ, got " +
            JSON.stringify(countsH.linework));

        // the new station positions (A1 unmoved, A3/A5 sharing one
        // nonzero shift) -- the same control-point set moveLinework
        // itself built out of oldPos/newPos, reconstructed here so this
        // fixture can predict each vertex's warped position
        // independently via CsWarp.mlsSimilarity, the exact function
        // moveLinework calls
        var bandAH2 = rebuiltH.bands[0];
        var n1 = null, n3 = null, n5 = null;
        for (var ni = 0; ni < bandAH2.stations.length; ni++) {
            var stH2 = bandAH2.stations[ni];
            if (stH2.name === "A1") { n1 = stH2; }
            if (stH2.name === "A3") { n3 = stH2; }
            if (stH2.name === "A5") { n5 = stH2; }
        }
        ok(n1 !== null && n3 !== null && n5 !== null,
            "sanity: found A1, A3 and A5 in the REBUILT profile too");

        var afterH = dH.queryEntity(tracedHId);
        ok(!isNull(afterH), "the warped sketch still exists");
        if (!isNull(afterH) && n1 !== null && n3 !== null && n5 !== null) {
            var warpPairs = [
                { old: { x: h1.x, y: h1.y }, nu: { x: n1.x, y: n1.y } },
                { old: { x: h3.x, y: h3.y }, nu: { x: n3.x, y: n3.y } },
                { old: { x: h5.x, y: h5.y }, nu: { x: n5.x, y: n5.y } }
            ];
            for (var vi = 0; vi < 3; vi++) {
                var bv = beforeVerts[vi], av = afterH.getVertexAt(vi);
                var expect = CsWarp.mlsSimilarity(
                    { x: bv.x, y: bv.y }, warpPairs);
                near(av.x, expect.x, 1e-6,
                    "vertex " + vi + " x matches CsWarp.mlsSimilarity's " +
                    "own prediction for that vertex (got " + av.x +
                    ", expected " + expect.x + ")");
                near(av.y, expect.y, 1e-6,
                    "vertex " + vi + " y matches CsWarp.mlsSimilarity's " +
                    "own prediction for that vertex (got " + av.y +
                    ", expected " + expect.y + ")");
            }
            // and NOT a single whole-entity transform: vertex 0 sits
            // exactly on A1, which did not move at all, while vertex 1
            // sits exactly on A3, which shifted by a real, nonzero
            // amount -- a rigid fit would have moved both by the same
            // offset, so a big gap between how far each one actually
            // travelled proves the warp is genuinely per-vertex
            var av0 = afterH.getVertexAt(0), av1 = afterH.getVertexAt(1);
            var d0 = Math.sqrt(Math.pow(av0.x - beforeVerts[0].x, 2) +
                Math.pow(av0.y - beforeVerts[0].y, 2));
            var d1 = Math.sqrt(Math.pow(av1.x - beforeVerts[1].x, 2) +
                Math.pow(av1.y - beforeVerts[1].y, 2));
            ok(Math.abs(d1 - d0) > 5,
                "vertex 0 (on the unmoved station) and vertex 1 (on a " +
                "shifted station) travelled clearly different " +
                "distances, not the identical offset a rigid move " +
                "would have produced (got d0=" + d0 + " d1=" + d1 + ")");
        }
        destr(iH);
    }
}());

// =======================================================================
// 10. CRITICAL 1 -- the linework outcome (and any binding/move failure)
//    must reach the REPORT, not just the counts object.
//    CsProfileDraw.render already folds a caught exception from
//    claim()/positions() into counts.claimed.error, and one from
//    moveLinework into a "move failed:" entry in
//    counts.linework.unmoved -- both are silently dropped if
//    CsReport.profileSummary never reads them. This proves each path
//    end to end: force a failure, then check the PRINTED REPORT text
//    actually says so, not just that the counts object carries it.
// =======================================================================

(function() {
    var svR = CsModel.newSurvey();
    svR.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var resR = CsNetwork.resolve(svR, {});
    var builtR = CsProfile.build(svR, resR, {});

    var dR = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iR = new RDocumentInterface(dR);
    CsProfileDraw.render(dR, iR, builtR, {});

    var bandAR = builtR.bands[0];
    var r2 = null, r3 = null;
    for (var ri = 0; ri < bandAR.stations.length; ri++) {
        if (bandAR.stations[ri].name === "A2") { r2 = bandAR.stations[ri]; }
        if (bandAR.stations[ri].name === "A3") { r3 = bandAR.stations[ri]; }
    }
    CsLayers.ensure(dR, iR, "PROFILE-CEILING");
    var opR = new RAddObjectsOperation();
    var tracedR = new RLineEntity(dR, new RLineData(
        new RVector(r2.x, r2.y), new RVector(r3.x, r3.y)));
    tracedR.setLayerId(dR.getLayerId("PROFILE-CEILING"));
    opR.addObject(tracedR, false);
    iR.applyOperation(opR);

    // 10a. the ordinary, successful case: the PRINTED REPORT names the
    // move outcome -- CsRevise.lineworkSummary's own wording, so a
    // mutation deleting the CsReport.profileSummary call site fails a
    // NAMED assertion here, not just a JSON.stringify() on the counts.
    svR.shots[0].distance = 20;
    var resR2 = CsNetwork.resolve(svR, {});
    var rebuiltR = CsProfile.build(svR, resR2, {});
    var countsR = CsProfileDraw.render(dR, iR, rebuiltR, {});
    eqs(countsR.linework.moved, 1, "sanity: the sketch actually moved");
    var reportR = CsReport.profileSummary(rebuiltR,
        { path: "x.dxf", created: false, counts: countsR });
    ok(reportR.indexOf("Traced linework moved with its stations: " +
        countsR.linework.moved) >= 0,
        "THE REPORT NAMES THE LINEWORK MOVE OUTCOME, not just the " +
        "counts object nobody prints (report was:\n" + reportR + ")");

    // 10b. force a failure inside the CLAIM path -- the review's own
    // reproduction: an undefined/throwing CsProfileBind.claim looks,
    // from render()'s own try/catch, exactly like CsProfileBind never
    // having loaded at all.
    var realClaim = CsProfileBind.claim;
    CsProfileBind.claim = function() {
        throw new Error("forced claim failure");
    };
    var countsClaimFail, rebuiltR2;
    try {
        svR.shots[0].distance = 30;
        var resR3 = CsNetwork.resolve(svR, {});
        rebuiltR2 = CsProfile.build(svR, resR3, {});
        countsClaimFail = CsProfileDraw.render(dR, iR, rebuiltR2, {});
    } finally {
        CsProfileBind.claim = realClaim;
    }
    ok(countsClaimFail.claimed.error !== undefined,
        "sanity: the forced claim failure reached counts.claimed.error");
    var reportClaimFail = CsReport.profileSummary(rebuiltR2,
        { path: "x.dxf", created: false, counts: countsClaimFail });
    ok(reportClaimFail.indexOf("forced claim failure") >= 0,
        "A CLAIM-PATH EXCEPTION IS VISIBLE IN THE REPORT, not only in " +
        "the counts object nobody prints (report was:\n" +
        reportClaimFail + ")");
    ok(reportClaimFail.toUpperCase().indexOf("WARNING") >= 0,
        "the claim failure reads as a WARNING, not a line buried among " +
        "ordinary counts (report was:\n" + reportClaimFail + ")");

    // 10c. force a failure inside the MOVE path.
    var realMove = CsRevise.moveLinework;
    CsRevise.moveLinework = function() {
        throw new Error("forced move failure");
    };
    var countsMoveFail, rebuiltR3;
    try {
        svR.shots[0].distance = 40;
        var resR4 = CsNetwork.resolve(svR, {});
        rebuiltR3 = CsProfile.build(svR, resR4, {});
        countsMoveFail = CsProfileDraw.render(dR, iR, rebuiltR3, {});
    } finally {
        CsRevise.moveLinework = realMove;
    }
    ok(countsMoveFail.linework.unmoved.length >= 1 &&
        countsMoveFail.linework.unmoved[0].indexOf("move failed") >= 0,
        "sanity: the forced move failure reached counts.linework.unmoved" +
        " (" + JSON.stringify(countsMoveFail.linework) + ")");
    var reportMoveFail = CsReport.profileSummary(rebuiltR3,
        { path: "x.dxf", created: false, counts: countsMoveFail });
    ok(reportMoveFail.toUpperCase().indexOf("WARNING") >= 0,
        "A MOVE-PATH EXCEPTION SURFACES AS A VISIBLE WARNING IN THE " +
        "REPORT (report was:\n" + reportMoveFail + ")");
    ok(reportMoveFail.indexOf("move failed") >= 0,
        "the report names the actual failure, not merely a generic " +
        "warning banner (report was:\n" + reportMoveFail + ")");

    destr(iR);
}());

// =======================================================================
// 11. CRITICAL 1 -- THIS FEATURE'S OWN FIX. render()'s positionsMoved
//    guard (fixture 8's own subject) exists to recognise "nothing moved,
//    so there was nothing for bound linework to follow" -- but before
//    this fix, CsReport.profileSummary routed EVERY moved===0 outcome
//    through CsRevise.lineworkSummary's unconditional "your tracing did
//    NOT move with the survey, re-trace or bind it" warning, which is
//    exactly backwards on a first-ever draw or an idempotent redraw:
//    nothing moved because there was nothing TO move, not because a
//    sketch failed to follow something that did. Pinned here as three
//    exact-line checks against the real production call
//    (CsProfileDraw.render -> CsReport.profileSummary, not a hand-built
//    counts object): a brand-new profile (11a) and an idempotent redraw
//    of an already-bound sketch (11b) must print NO warning; a genuine
//    refusal where stations truly moved (11c, same shape as fixture 9's
//    incoherent-movement case) must still print it -- the fix must
//    suppress the FALSE warning without suppressing the true one.
// =======================================================================

var ABANDONED_TRACING_WARNING =
    "  WARNING -- hand-drawn linework that is not bound " +
    "to the survey did NOT move with it; re-trace walls and " +
    "detail near the moved stations, or bind it first " +
    "(Adopt linework) and revise again.";

// -- 11a. a brand-new profile, no tracing at all -----------------------
(function() {
    var sv11a = CsModel.newSurvey();
    sv11a.shots = [ shotOf("A1", "A2", 10, 0, 0, 4, 2) ];
    var res11a = CsNetwork.resolve(sv11a, {});
    var built11a = CsProfile.build(sv11a, res11a, {});

    var d11a = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i11a = new RDocumentInterface(d11a);
    var counts11a = CsProfileDraw.render(d11a, i11a, built11a, {});

    eqs(counts11a.linework.moved, 0,
        "sanity: nothing moved on a brand-new profile's first draw");
    ok(counts11a.stationsMoved === false,
        "sanity: render() itself recognises nothing moved -- " +
        "stationsMoved is false");

    var report11a = CsReport.profileSummary(built11a,
        { path: "x.dxf", created: true, counts: counts11a });
    var lines11a = report11a.split("\n");
    ok(lines11a.indexOf(
        "  Traced linework moved with its stations: 0") >= 0,
        "the moved-count line still prints on a clean first draw, got:\n" +
        report11a);
    ok(lines11a.indexOf(ABANDONED_TRACING_WARNING) < 0,
        "CRITICAL 1's OWN FIX: a brand-new profile with no tracing at " +
        "all prints NO abandoned-tracing warning -- nothing existed to " +
        "move, so there was nothing for a sketch to follow (report " +
        "was:\n" + report11a + ")");
    destr(i11a);
}());

// -- 11b. an idempotent redraw of an ALREADY-BOUND sketch --------------
(function() {
    var sv11b = CsModel.newSurvey();
    sv11b.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 0, 4, 2)
    ];
    var res11b = CsNetwork.resolve(sv11b, {});
    var built11b = CsProfile.build(sv11b, res11b, {});

    var d11b = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i11b = new RDocumentInterface(d11b);
    CsProfileDraw.render(d11b, i11b, built11b, {});

    var bandA11b = built11b.bands[0];
    var b2 = null, b3 = null;
    for (var bi = 0; bi < bandA11b.stations.length; bi++) {
        if (bandA11b.stations[bi].name === "A2") { b2 = bandA11b.stations[bi]; }
        if (bandA11b.stations[bi].name === "A3") { b3 = bandA11b.stations[bi]; }
    }
    CsLayers.ensure(d11b, i11b, "PROFILE-CEILING");
    var op11b = new RAddObjectsOperation();
    var traced11b = new RLineEntity(d11b, new RLineData(
        new RVector(b2.x, b2.y), new RVector(b3.x, b3.y)));
    traced11b.setLayerId(d11b.getLayerId("PROFILE-CEILING"));
    op11b.addObject(traced11b, false);
    i11b.applyOperation(op11b);

    // one real revision: claims and moves the sketch, same shape as
    // fixture 8's own IMPORTANT #5a case
    sv11b.shots[0].distance = 20;
    var res11b2 = CsNetwork.resolve(sv11b, {});
    var rebuilt11b = CsProfile.build(sv11b, res11b2, {});
    var counts11bMove = CsProfileDraw.render(d11b, i11b, rebuilt11b, {});
    eqs(counts11bMove.linework.moved, 1,
        "sanity: the sketch really did move once, for real, before the " +
        "idempotent redraw below");

    // redraw the SAME, unchanged profile again -- nothing moves this
    // time, including the already-bound sketch
    var counts11bIdle = CsProfileDraw.render(d11b, i11b, rebuilt11b, {});
    eqs(counts11bIdle.linework.moved, 0,
        "sanity: an idempotent redraw reports zero linework moves");
    ok(counts11bIdle.stationsMoved === false,
        "sanity: render() recognises no station actually moved this time");

    var report11b = CsReport.profileSummary(rebuilt11b,
        { path: "x.dxf", created: false, counts: counts11bIdle });
    var lines11b = report11b.split("\n");
    ok(lines11b.indexOf(ABANDONED_TRACING_WARNING) < 0,
        "CRITICAL 1's OWN FIX: an idempotent redraw -- nothing moved, " +
        "not even the already-bound sketch from a moment ago -- prints " +
        "NO abandoned-tracing warning either, got:\n" + report11b);
    destr(i11b);
}());

// -- 11c. THE CONTRAST CASE: stations genuinely moved and a bound
//    sketch genuinely failed to follow (same shape as fixture 9's
//    incoherent-movement refusal) -- the warning MUST still fire, or
//    11a/11b's fix has been over-applied into silence.
//
//    Task 3 note: this used to trace a POLYLINE onto A1/A3/A5, the same
//    shape fixture 9 above builds. Task 2 (commit 52a4905) made
//    polylines warp per-vertex instead of refusing on an incoherent
//    bound-station set -- fixture 9 was updated for that (it now
//    proves the warp), but this fixture's whole POINT is the OTHER
//    half of the contract: proving the warning still fires when
//    something genuinely does NOT follow. A polyline can no longer
//    reach that outcome (moved 0 there now means "bent", not
//    "refused"), so this fixture traces an REllipseEntity instead -- a
//    type moveLinework's docblock explicitly keeps on the old
//    rigid-fit-with-refusal path (it used to be an RTextEntity, but
//    text now warps at its anchor like a symbol -- see
//    tests/warp_anchors_run.js) -- tagged directly with the same
//    incoherent A1/A3/A5 station set fixture 9 uses, bypassing
//    CsProfileBind.claim's proximity search (a single text anchor
//    point cannot bind to three stations by distance the way a
//    3-vertex polyline can).
(function() {
    var svI = CsModel.newSurvey();
    svI.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, 20, 4, 2),
        shotOf("A3", "A4", 10, 0, -15, 4, 2),
        shotOf("A4", "A5", 10, 0, 25, 4, 2)
    ];
    var resI = CsNetwork.resolve(svI, {});
    var builtI = CsProfile.build(svI, resI, {});

    var dI = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iI = new RDocumentInterface(dI);
    CsProfileDraw.render(dI, iI, builtI, {});

    var bandAI = builtI.bands[0];
    var i1 = null, i3 = null, i5 = null;
    for (var ii = 0; ii < bandAI.stations.length; ii++) {
        if (bandAI.stations[ii].name === "A1") { i1 = bandAI.stations[ii]; }
        if (bandAI.stations[ii].name === "A3") { i3 = bandAI.stations[ii]; }
        if (bandAI.stations[ii].name === "A5") { i5 = bandAI.stations[ii]; }
    }
    ok(i1 !== null && i3 !== null && i5 !== null,
        "sanity: found A1, A3 and A5 in the built profile");

    if (i1 !== null && i3 !== null && i5 !== null) {
        CsLayers.ensure(dI, iI, "PROFILE-CEILING");
        var opI = new RAddObjectsOperation();
        var at = new RVector(i3.x, i3.y);
        var tracedI = new REllipseEntity(dI, new REllipseData(at,
            new RVector(5, 0), 0.5, 0.0, 2.0 * Math.PI, false));
        tracedI.setLayerId(dI.getLayerId("PROFILE-CEILING"));
        CsTags.set(tracedI, CsBind.STATIONS_TAG,
            CsBind.encodeStations(["A1", "A3", "A5"]));
        opI.addObject(tracedI, false);
        iI.applyOperation(opI);

        svI.shots[1].distance = 20;
        var resI2 = CsNetwork.resolve(svI, {});
        var rebuiltI = CsProfile.build(svI, resI2, {});
        var countsI = CsProfileDraw.render(dI, iI, rebuiltI, {});

        eqs(countsI.linework.moved, 0,
            "sanity: the incoherent sketch is refused (moved 0), same as " +
            "fixture 9 above");
        eqs(countsI.linework.warped, 0,
            "sanity: an ellipse has no per-vertex structure to warp " +
            "-- it is refused outright, not bent, got " +
            JSON.stringify(countsI.linework));
        eqs(countsI.linework.unmoved.length, 1,
            "sanity: the ellipse itself is the one refusal, got " +
            JSON.stringify(countsI.linework));
        ok(countsI.stationsMoved === true,
            "sanity: render() recognises that stations DID genuinely " +
            "move this time -- the refusal below is real, not a no-op " +
            "redraw wearing a refusal's clothes");

        var reportI = CsReport.profileSummary(rebuiltI,
            { path: "x.dxf", created: false, counts: countsI });
        var linesI = reportI.split("\n");
        ok(linesI.indexOf(ABANDONED_TRACING_WARNING) >= 0,
            "CRITICAL 1's FIX DOES NOT OVER-SUPPRESS: stations genuinely " +
            "moved and the bound sketch genuinely failed to follow them, " +
            "so the abandoned-tracing warning still fires (report was:\n" +
            reportI + ")");
        destr(iI);
    }
}());

// =======================================================================
// 12. Task 2 code-quality review, IMPORTANT #1 -- CsRevise.moveLinework's
//    arc/circle branch scales its radius by CsWarp.mlsSimilarity's
//    `factor` with no bound. `factor` is never negative by construction,
//    but a control-point layout that puts the fit's numerator near zero
//    against a non-degenerate denominator can still collapse the radius
//    toward zero silently. These two fixtures call
//    CsRevise.moveLinework DIRECTLY -- not through CsProfileDraw.render
//    -- against a hand-tagged entity, the same shape as the FRAME
//    CROSSING fixture below builds its stations, so each one controls
//    its own oldPos/newPos pairs exactly rather than depending on
//    auto-bind's proximity/snap rules to land on the right ones.
//
//    12a proves the new guard does NOT fire on an ordinary, non-
//    degenerate warp: the radius scales by the SAME factor
//    CsWarp.mlsSimilarity independently computes for that center.
//    12b constructs the guard's own trigger cheaply: two bound
//    stations whose NEW positions coincide exactly, which zeroes
//    mlsSimilarity's fit numerator (a and b both 0, since the two
//    "new" points collapse to one weighted centroid) against a
//    denominator that is nowhere near CsWarp's own existing
//    s2 <= 1e-20 full-degeneracy threshold -- exactly the gap the
//    review flagged. The entity must come out UNTOUCHED and reported,
//    not shrunk to a near-zero radius.
// =======================================================================

// -- 12a. ordinary warp: factor guard must not fire --------------------
(function() {
    var d12a = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i12a = new RDocumentInterface(d12a);
    CsLayers.ensure(d12a, i12a, CsLayers.PROFILE_CEILING);

    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var op = new RAddObjectsOperation();
    var oldCenter = new RVector(100, 50), oldRadius = 8;
    var circ = new RCircleEntity(d12a,
        new RCircleData(oldCenter, oldRadius));
    circ.setLayerId(d12a.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(circ, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(circ, false);
    i12a.applyOperation(op);
    var circId = circ.getId();

    var pairs = [
        { old: oldPos.P1, nu: newPos.P1 },
        { old: oldPos.P3, nu: newPos.P3 },
        { old: oldPos.P5, nu: newPos.P5 }
    ];
    var expect = CsWarp.mlsSimilarity(
        { x: oldCenter.x, y: oldCenter.y }, pairs);
    ok(expect.factor > 1e-3 && isFinite(expect.factor),
        "sanity: this scenario's own factor is a normal, non-degenerate " +
        "number (got " + expect.factor + "), so 12a actually exercises " +
        "the guard's PASS-THROUGH path");

    var counts = CsRevise.moveLinework(d12a, i12a, oldPos, newPos, {}, 100);
    eqs(counts.unmoved.length, 0,
        "12a: an ordinary warp does not get refused (" +
        JSON.stringify(counts) + ")");
    eqs(counts.moved, 1,
        "12a: lands in moved -- a single center point has nothing to " +
        "disagree with (" + JSON.stringify(counts) + ")");

    var after = d12a.queryEntity(circId);
    ok(!isNull(after), "12a: the circle still exists");
    if (!isNull(after)) {
        var c = after.getCenter();
        near(c.x, expect.x, 1e-6,
            "12a: center x matches CsWarp.mlsSimilarity's own " +
            "prediction for this center");
        near(c.y, expect.y, 1e-6,
            "12a: center y matches CsWarp.mlsSimilarity's own " +
            "prediction for this center");
        near(after.getRadius(), oldRadius * expect.factor, 1e-6,
            "12a: radius scaled by the SAME local factor " +
            "mlsSimilarity independently computes (got " +
            after.getRadius() + ", expected " +
            (oldRadius * expect.factor) + ")");
    }
    destr(i12a);
}());

// -- 12b. degenerate factor: two bound stations' NEW positions coincide,
//    zeroing the fit numerator against a non-degenerate denominator --
//    the exact gap the review found in the old unbounded
//    `ent.setRadius(ent.getRadius() * cw.factor)` -----------------------
(function() {
    var d12b = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i12b = new RDocumentInterface(d12b);
    CsLayers.ensure(d12b, i12b, CsLayers.PROFILE_CEILING);

    // Q1 and Q2 start 100 units apart (s2 is nowhere near
    // CsWarp.EPS-scale zero -- the OLD guard's own degeneracy test
    // would not catch this), but Q2 lands exactly on top of Q1: the
    // fit's new-side spread collapses to a single point, zeroing the
    // numerator (a === 0, b === 0) while the denominator stays
    // ordinary. mlsSimilarity's honest answer is factor === 0.
    var oldPos = { Q1: { x: 0, y: 0 }, Q2: { x: 100, y: 0 } };
    var newPos = { Q1: { x: 0, y: 0 }, Q2: { x: 0, y: 0 } };

    var op = new RAddObjectsOperation();
    var oldCenter = new RVector(100, 50), oldRadius = 8;
    var circ = new RCircleEntity(d12b,
        new RCircleData(oldCenter, oldRadius));
    circ.setLayerId(d12b.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(circ, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["Q1", "Q2"]));
    op.addObject(circ, false);
    i12b.applyOperation(op);
    var circId = circ.getId();

    var pairs = [
        { old: oldPos.Q1, nu: newPos.Q1 },
        { old: oldPos.Q2, nu: newPos.Q2 }
    ];
    var expect = CsWarp.mlsSimilarity(
        { x: oldCenter.x, y: oldCenter.y }, pairs);
    eqs(expect.factor, 0,
        "sanity: this scenario's own factor really is (effectively) " +
        "zero, so 12b actually exercises the guard's REFUSAL path, " +
        "got " + expect.factor);

    var counts = CsRevise.moveLinework(d12b, i12b, oldPos, newPos, {}, 100);
    eqs(counts.moved, 0,
        "12b: a near-zero factor does NOT land in moved (" +
        JSON.stringify(counts) + ")");
    eqs(counts.unmoved.length, 1,
        "12b: FIX #2's OWN CASE -- the degenerate factor is refused " +
        "and reported instead of collapsing the radius (" +
        JSON.stringify(counts) + ")");

    var after = d12b.queryEntity(circId);
    ok(!isNull(after), "12b: the circle still exists");
    if (!isNull(after)) {
        var c = after.getCenter();
        eqs(c.x, oldCenter.x, "12b: center x UNTOUCHED, not moved on a " +
            "guess");
        eqs(c.y, oldCenter.y, "12b: center y UNTOUCHED, not moved on a " +
            "guess");
        eqs(after.getRadius(), oldRadius,
            "12b: radius UNTOUCHED -- not collapsed toward zero (got " +
            after.getRadius() + ")");
    }
    destr(i12b);
}());

// =======================================================================
// 13. Task 2 code-quality review -- MISSING LIVE COVERAGE. A control-
//    point RSplineEntity has zero live coverage through
//    CsRevise.moveLinework before this fixture: every control point
//    must warp INDIVIDUALLY, the same property fixture 9 proves for a
//    polyline's vertices, through the entity actually installed by
//    ent.setShape() (not just the RSplineData this function builds in
//    memory -- see moveLinework's own "getData() doesn't write back"
//    trap documented at its RSplineEntity branch).
// =======================================================================

(function() {
    var d13 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i13 = new RDocumentInterface(d13);
    CsLayers.ensure(d13, i13, CsLayers.PROFILE_CEILING);

    // same incoherent station shape as fixture 9: P1 stays exactly
    // where it is, P3 and P5 share one common nonzero shift -- no
    // single rigid transform describes it, so each control point's
    // local fit genuinely differs from the others'.
    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var origCps = [
        { x: 0, y: 5 }, { x: 30, y: -5 }, { x: 60, y: 20 }
    ];
    var sd = new RSplineData();
    for (var pi = 0; pi < origCps.length; pi++) {
        sd.appendControlPoint(new RVector(origCps[pi].x, origCps[pi].y));
    }
    sd.setDegree(2); // 3 control points: CsTrace's own degreeFor(3)
    sd.update();

    var op = new RAddObjectsOperation();
    var spl = new RSplineEntity(d13, sd);
    spl.setLayerId(d13.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(spl, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(spl, false);
    i13.applyOperation(op);
    var splId = spl.getId();

    var counts = CsRevise.moveLinework(d13, i13, oldPos, newPos, {}, 100);
    eqs(counts.unmoved.length, 0,
        "13: the spline is not refused (" + JSON.stringify(counts) + ")");
    eqs(counts.warped, 1,
        "13: THIS INCOHERENT STATION SET BENDS THE SPLINE, per control " +
        "point, same shape as fixture 9's polyline (" +
        JSON.stringify(counts) + ")");

    var after = d13.queryEntity(splId);
    ok(!isNull(after), "13: the spline still exists");
    if (!isNull(after)) {
        eqs(after.countControlPoints(), 3,
            "13: still exactly 3 control points -- setShape rebuilt " +
            "the same count, not more or fewer");
        eqs(after.getDegree(), 2, "13: degree preserved across rebuild");
        var pairs = [
            { old: oldPos.P1, nu: newPos.P1 },
            { old: oldPos.P3, nu: newPos.P3 },
            { old: oldPos.P5, nu: newPos.P5 }
        ];
        for (var vi = 0; vi < 3; vi++) {
            var cp = after.getControlPointAt(vi);
            var expect = CsWarp.mlsSimilarity(origCps[vi], pairs);
            near(cp.x, expect.x, 1e-6,
                "13: control point " + vi + " x matches " +
                "CsWarp.mlsSimilarity's own prediction for that point " +
                "(got " + cp.x + ", expected " + expect.x + ")");
            near(cp.y, expect.y, 1e-6,
                "13: control point " + vi + " y matches " +
                "CsWarp.mlsSimilarity's own prediction for that point " +
                "(got " + cp.y + ", expected " + expect.y + ")");
        }
    }
    destr(i13);
}());

// =======================================================================
// 14. Task 2 code-quality review -- MISSING LIVE COVERAGE. Every
//    polyline fixture that reaches moveLinework live so far (fixture 9
//    included) uses all-zero-bulge vertices, so the "read every bulge
//    BEFORE clear(), re-append after" order of operations that keeps
//    bulges byte-identical (see moveLinework's own RPolylineEntity
//    branch comment) has never been proven against a REAL nonzero
//    value -- a bug that flips or drops a bulge would read as zero
//    either way and pass silently. This fixture pins one nonzero bulge
//    through a genuine (non-rigid, warped) move.
// =======================================================================

(function() {
    var d14 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i14 = new RDocumentInterface(d14);
    CsLayers.ensure(d14, i14, CsLayers.PROFILE_CEILING);

    // same incoherent shape as fixture 13, so this move genuinely
    // warps (lands in counts.warped) rather than moving as one rigid
    // piece -- the bulge must survive a REAL per-vertex warp, not
    // merely a translate.
    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var pd = new RPolylineData();
    pd.appendVertex(new RVector(0, 5), 0.53125); // nonzero, exact in fp2
    pd.appendVertex(new RVector(30, -5), 0);
    pd.appendVertex(new RVector(60, 20), 0);

    var op = new RAddObjectsOperation();
    var poly = new RPolylineEntity(d14, pd);
    poly.setLayerId(d14.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(poly, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(poly, false);
    i14.applyOperation(op);
    var polyId = poly.getId();

    eqs(poly.getBulgeAt(0), 0.53125, "sanity: the traced bulge is real " +
        "before any move at all");

    var counts = CsRevise.moveLinework(d14, i14, oldPos, newPos, {}, 100);
    eqs(counts.unmoved.length, 0,
        "14: the polyline is not refused (" + JSON.stringify(counts) +
        ")");
    eqs(counts.warped, 1,
        "14: THIS IS A GENUINE WARP, not a rigid move -- the bulge " +
        "round trip below is exercised through the real per-vertex " +
        "rebuild path (" + JSON.stringify(counts) + ")");

    var after = d14.queryEntity(polyId);
    ok(!isNull(after), "14: the polyline still exists");
    if (!isNull(after)) {
        eqs(after.getBulgeAt(0), 0.53125,
            "14: FIX/PROOF -- the nonzero bulge is BYTE-IDENTICAL after " +
            "a genuine warp (got " + after.getBulgeAt(0) + ")");
        eqs(after.getBulgeAt(1), 0,
            "14: the untouched second segment's bulge is still exactly " +
            "0 (got " + after.getBulgeAt(1) + ")");
    }
    destr(i14);
}());

// =======================================================================
// 15. Task 2 code-quality review, IMPORTANT #1 -- a fit-point-only
//    RSplineEntity (countControlPoints() === 0: this build has no
//    interpolation engine to turn fit points into control points --
//    see CsTrace.fitSpline's own docblock) used to slip past
//    warpableVertices' "verts !== null" dispatch guard as an empty
//    ARRAY, not null, reach the RSplineEntity rebuild branch, run its
//    control-point loop zero times, and install a fresh, EMPTY
//    RSplineData via ent.setShape() -- corrupting the entity's actual
//    geometry (its fit points) in place. The fix routes this case to
//    the same "no honest answer, leave it and report" outcome
//    pairs.length === 0 already uses.
//
//    Tagged directly (CsBind.STATIONS_TAG set by hand) rather than
//    relying on CsBind's auto-bind: probed live, a fit-point-only
//    spline's getStartPoint()/getEndPoint() both come back invalid
//    (RVector.valid === false), so CsBind.pointsOf finds nothing to
//    snap or box-proximity against and auto-bind would never even
//    reach moveLinework's dispatch -- it would land in "unmoved" for
//    an unrelated reason (no bound stations at all) instead of
//    exercising THIS guard specifically.
// =======================================================================

(function() {
    var d15 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i15 = new RDocumentInterface(d15);
    CsLayers.ensure(d15, i15, CsLayers.PROFILE_CEILING);

    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var fp = new RSplineData();
    fp.appendFitPoint(new RVector(0, 0));
    fp.appendFitPoint(new RVector(10, 5));
    fp.appendFitPoint(new RVector(20, 0));

    var op = new RAddObjectsOperation();
    var spl = new RSplineEntity(d15, fp);
    spl.setLayerId(d15.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(spl, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(spl, false);
    i15.applyOperation(op);
    var splId = spl.getId();

    eqs(spl.countControlPoints(), 0,
        "sanity: this build never turns fit points into control " +
        "points, so this is a real 0-control-point spline before any " +
        "move at all");
    eqs(spl.countFitPoints(), 3, "sanity: its 3 fit points are real");

    var counts = CsRevise.moveLinework(d15, i15, oldPos, newPos, {}, 100);
    eqs(counts.moved, 0,
        "15: FIX #1's OWN CASE -- a 0-control-point spline does not " +
        "land in moved (" + JSON.stringify(counts) + ")");
    eqs(counts.warped, 0,
        "15: nor in warped (" + JSON.stringify(counts) + ")");
    eqs(counts.unmoved.length, 1,
        "15: it is refused and reported instead (" +
        JSON.stringify(counts) + ")");

    var after = d15.queryEntity(splId);
    ok(!isNull(after), "15: the spline still exists");
    if (!isNull(after)) {
        eqs(after.countControlPoints(), 0,
            "15: still 0 control points -- no empty RSplineData was " +
            "installed over it");
        eqs(after.countFitPoints(), 3,
            "15: its fit points are UNCHANGED, not wiped out by a " +
            "corrupting setShape() (got " + after.countFitPoints() +
            ")");
    }
    destr(i15);
}());

// =======================================================================
// 16. Task 4 (revised) -- ONE moveLinework CALL, THREE ENTITY TYPES, ONE
//    COHERENT PIPELINE. Every fixture above proves one entity type
//    against one outcome at a time: 9/13/14 a polyline/spline warps,
//    12a a circle moves, 11c/15 something is refused. This fixture
//    proves all three outcomes happen TOGETHER, from a SINGLE
//    CsRevise.moveLinework call against the same revision -- Task 2's
//    per-type dispatch and Task 3's report threading, exercised as one
//    system instead of as separately-tested pieces. (The plan's
//    original Task 4 asked for a whole new tests/linework_warp.js
//    engine-only file duplicating this coverage from scratch; by the
//    time Task 2/3's own code-quality review cycles landed, fixtures
//    9/11c/12/13/14/15 already covered every individual entity type
//    live in this file, so a second file would only have restated them
//    -- this one fixture, added here, is what was actually still
//    missing: proof that the pieces cooperate.)
//
//    Reuses the same incoherent P1/P3/P5 station shape fixtures 12-15
//    already established (P1 stays exactly still, P3 and P5 share one
//    common +10y shift -- confirmed by fixture 12a's own sanity check
//    to be non-degenerate for a center warp, and hand-verified against
//    CsRevise.similarityFit's unweighted centroid formula to carry a
//    maxResidual of exactly 3.333333 (theta 0.244979, scale 1.030776)
//    -- 33x CsRevise.LINEWORK_RESIDUAL_FRACTION's tol of 0.1 at extent
//    100, so the rigid-fallback entity below is genuinely refused, not
//    coincidentally so), bound to three entities that each take a
//    different branch of moveLinework's dispatch:
//
//      polyline   per-vertex warp (WARPS: same vertex layout as
//                 fixture 14's proven-warping case, so its own
//                 vertices' local angle/factor genuinely disagree)
//      circle     per-center warp (MOVES: a single point has nothing
//                 to disagree with -- see moveLinework's own comment
//                 at its arc/circle branch; same center fixture 12a
//                 already proved gives a non-degenerate factor)
//      text       no per-vertex structure at all -- the OLD rigid-fit
//                 path, same type fixture 11c already proves goes
//                 through it, refused because the fit is computed from
//                 the STATION pairs alone (not the entity's own
//                 position), and those pairs are the incoherent set
//                 above regardless of where the text sits
//
//    Then CsRevise.lineworkSummary is called with the REAL counts this
//    one call returned (not hand-typed numbers). What that proves, and
//    what it does NOT, is worth being exact about:
//
//      PROVES Task 3's fix end to end -- the headline number is
//      moved+warped against a genuine moveLinework result, not a
//      hand-typed pair. Revert the headline to `n` alone and this
//      fixture reports 1 where it must report 2, and fails.
//
//      Does NOT isolate Task 3 -- the "did NOT move with it" assertion
//      below is a guard on the abandoned-tracing warning staying quiet
//      on a MIXED result, which is worth having, but it is not
//      sensitive to Task 3: the suppression condition is
//      n === 0 && w === 0 && stationsMoved, and this fixture has
//      moved === 1 (the circle), so moved alone already suppresses the
//      warning and the assertion still passes with Task 3's w === 0
//      clause reverted. The isolating case -- moved === 0 with
//      warped > 0, where ONLY the new clause suppresses the warning --
//      lives in tests/js_unit.js, at the
//      CsRevise.lineworkSummary(0, [], 0, true, 3) assertions.
// =======================================================================

(function() {
    var d16 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i16 = new RDocumentInterface(d16);
    CsLayers.ensure(d16, i16, CsLayers.PROFILE_CEILING);

    // same incoherent station shape as fixtures 12-15: P1 stays exactly
    // where it is, P3 and P5 share one common nonzero shift -- no
    // single rigid transform describes it.
    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var op = new RAddObjectsOperation();

    // -- the entity that WARPS: a 3-vertex polyline, the exact vertex
    // layout fixture 14 already proves lands in warped for this same
    // station shape -----------------------------------------------------
    var pd16 = new RPolylineData();
    pd16.appendVertex(new RVector(0, 5));
    pd16.appendVertex(new RVector(30, -5));
    pd16.appendVertex(new RVector(60, 20));
    var poly16 = new RPolylineEntity(d16, pd16);
    poly16.setLayerId(d16.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(poly16, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(poly16, false);

    // -- the entity that MOVES: a circle, bound to the SAME three
    // stations, the exact center fixture 12a already proves gives a
    // non-degenerate factor -- its single center point has nothing to
    // disagree with, so it always lands in moved regardless of how
    // incoherent its bound stations are (see moveLinework's own
    // arc/circle branch comment) -----------------------------------------
    var oldCenter16 = new RVector(100, 50), oldRadius16 = 8;
    var circ16 = new RCircleEntity(d16,
        new RCircleData(oldCenter16, oldRadius16));
    circ16.setLayerId(d16.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(circ16, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(circ16, false);

    // -- the entity that is REFUSED: an ellipse, the same "no
    // per-vertex structure, no single anchor" type fixture 11c already
    // proves goes through the OLD rigid-fit-with-refusal path -- this station
    // shape's residual is far past CsRevise.LINEWORK_RESIDUAL_FRACTION,
    // and that refusal depends only on the station pairs, not on where
    // this text happens to sit --------------------------------------------
    var textAt16 = new RVector(20, 8);
    var text16 = new REllipseEntity(d16, new REllipseData(textAt16,
        new RVector(5, 0), 0.5, 0.0, 2.0 * Math.PI, false));
    text16.setLayerId(d16.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(text16, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(text16, false);

    i16.applyOperation(op);
    var polyId16 = poly16.getId(), circId16 = circ16.getId(),
        textId16 = text16.getId();

    // -- ONE call, three entities, three different dispatch outcomes --
    var counts16 = CsRevise.moveLinework(d16, i16, oldPos, newPos, {}, 100);

    eqs(counts16.warped, 1, "16: exactly the polyline warps (" +
        JSON.stringify(counts16) + ")");
    eqs(counts16.moved, 1, "16: exactly the circle moves rigidly (" +
        JSON.stringify(counts16) + ")");
    eqs(counts16.unmoved.length, 1, "16: exactly the ellipse is refused (" +
        JSON.stringify(counts16) + ")");
    ok(counts16.unmoved[0].indexOf("#" + textId16) >= 0,
        "16: the refused entity is the ellipse, got " +
        counts16.unmoved[0]);

    var afterPoly16 = d16.queryEntity(polyId16);
    var afterCirc16 = d16.queryEntity(circId16);
    var afterText16 = d16.queryEntity(textId16);
    ok(!isNull(afterPoly16) && !isNull(afterCirc16) && !isNull(afterText16),
        "16: all three entities still exist");
    if (!isNull(afterCirc16)) {
        ok(Math.abs(afterCirc16.getRadius() - oldRadius16) > 1e-9,
            "16: the circle's radius actually changed (a real warp " +
            "happened, not a no-op), before=" + oldRadius16 + " after=" +
            afterCirc16.getRadius());
    }
    if (!isNull(afterText16)) {
        var tp16 = afterText16.getCenter();
        eqs(tp16.x, textAt16.x, "16: the refused ellipse's position is " +
            "UNTOUCHED (x)");
        eqs(tp16.y, textAt16.y, "16: the refused ellipse's position is " +
            "UNTOUCHED (y)");
    }

    // -- the pipeline's OTHER half: the report text, built from the
    // REAL counts this call returned, not hand-typed numbers ----------
    var summary16 = CsRevise.lineworkSummary(counts16.moved,
        counts16.unmoved, 0, true, counts16.warped).join("\n");
    ok(summary16.indexOf("warped") >= 0,
        "16: the summary text mentions the warp, got:\n" + summary16);
    // NOT a Task 3 guard: moved === 1 here, and the suppression
    // condition is n === 0 && w === 0 && stationsMoved, so moved alone
    // already keeps this warning quiet -- this passes with Task 3's
    // w === 0 clause reverted. The isolating moved === 0, warped > 0
    // case is in tests/js_unit.js's lineworkSummary(0, [], 0, true, 3)
    // assertions. What this DOES guard is the mixed result: one
    // entity really was refused, and that must not be reported as the
    // whole tracing having been abandoned.
    ok(summary16.indexOf("did NOT move with it") < 0,
        "16: the abandoned-tracing warning does not fire on a mixed " +
        "moved/warped/refused result -- something plainly DID move " +
        "(the circle) and warp (the polyline), so the false " +
        "'abandoned tracing' warning must not fire even though one " +
        "entity really was refused, got:\n" + summary16);
    // THIS is the Task 3 guard: revert the headline to `n` alone and
    // it reads 1 where it must read 2, and this assertion fails.
    ok(summary16.indexOf(
        "Traced linework moved with its stations: " +
        (counts16.moved + counts16.warped)) === 0,
        "16: TASK 3'S FIX, PROVEN END TO END -- the headline number is " +
        "moved+warped (" + (counts16.moved + counts16.warped) + "), " +
        "not moved alone, against a genuine moveLinework result rather " +
        "than hand-typed counts, got:\n" + summary16);

    destr(i16);
}());

// =======================================================================
// 17. FINAL WHOLE-FEATURE REVIEW, IMPORTANT #1 -- an arc has a SWEEP,
//    and until this fixture nothing exercised RArcEntity through
//    CsRevise.moveLinework at all. That gap hid a real regression:
//    the arc/circle branch consumed CsWarp.mlsSimilarity's `x`, `y` and
//    `factor` and DISCARDED its `angle`. Neither RArcEntity.move() nor
//    setRadius() touches startAngle/endAngle, so an arc under a
//    locally-rotating adjustment had its center placed correctly and
//    then kept its original ABSOLUTE orientation -- endpoints off by
//    2r*sin(theta/2), detached from the walls they were snapped to, and
//    counted as `moved` with no warning. The pre-warp code got this
//    right for free (ent.rotate(fit.theta, origin) applied to every
//    entity type); the per-vertex types keep getting it right for free
//    by moving their vertices individually; a center-plus-radius entity
//    is the one shape that needs the rotation applied explicitly.
//    Circles are immune -- rotationally symmetric -- which is exactly
//    why fixture 12a's circle coverage did not catch this.
//
//    17a uses a PURE RIGID ROTATION of the station set rather than the
//    incoherent P1/P3/P5 shape fixtures 12-16 share, deliberately: MLS
//    similarity reproduces an exact similarity transform exactly, so
//    the rigid-correct answer for every point is computable by hand
//    from the rotation alone, and the assertions below can be written
//    against that instead of against the same warp code under test.
//
//    17b closes the other missing-coverage half the same review found:
//    every existing RLineEntity fixture moves rigidly, so the NEW warp
//    branch's news[0]/news[1] indexing -- which assumes
//    getReferencePoints() returns exactly the two endpoints in start,
//    end order -- has never been exercised live.
// =======================================================================

// -- 17a. an arc under a pure rigid rotation: center, START POINT and
//    END POINT must all land where the rotation puts them --------------
(function() {
    var d17 = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i17 = new RDocumentInterface(d17);
    CsLayers.ensure(d17, i17, CsLayers.PROFILE_CEILING);

    // 30 degrees about the drawing origin, no translation, no scale.
    var THETA = Math.PI / 6;
    var rot = function(x, y) {
        return new RVector(x * Math.cos(THETA) - y * Math.sin(THETA),
                           x * Math.sin(THETA) + y * Math.cos(THETA));
    };

    // P1 (0,0) -> (0,0); P3 (20,0) -> (17.320508, 10);
    // P5 (40,0) -> (34.641016, 20). One rigid rotation describes the
    // whole set exactly -- unlike fixtures 12-16, nothing here is
    // incoherent, on purpose.
    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var r3 = rot(20, 0), r5 = rot(40, 0);
    var newPos = {
        P1: { x: 0, y: 0 },
        P3: { x: r3.x, y: r3.y },
        P5: { x: r5.x, y: r5.y }
    };

    var op = new RAddObjectsOperation();
    // center (10,10), radius 5, a quarter sweep from angle 0 to PI/2:
    // start point (15,10), end point (10,15).
    var oldCenter17 = new RVector(10, 10), oldRadius17 = 5;
    var arc17 = new RArcEntity(d17, new RArcData(
        oldCenter17, oldRadius17, 0.0, Math.PI / 2, false));
    arc17.setLayerId(d17.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(arc17, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(arc17, false);
    i17.applyOperation(op);
    var arcId17 = arc17.getId();

    // The rigid-correct answers, computed from the ROTATION directly --
    // never from CsWarp, which is the code under test:
    //   center      rot(10,10) = ( 3.660254, 13.660254)
    //   start point rot(15,10) = ( 7.990381, 16.160254)
    //   end point   rot(10,15) = ( 1.160254, 17.990381)
    var wantCenter17 = rot(10, 10);
    var wantStart17 = rot(15, 10);
    var wantEnd17 = rot(10, 15);

    var pairs17 = [
        { old: oldPos.P1, nu: newPos.P1 },
        { old: oldPos.P3, nu: newPos.P3 },
        { old: oldPos.P5, nu: newPos.P5 }
    ];
    var cw17 = CsWarp.mlsSimilarity(
        { x: oldCenter17.x, y: oldCenter17.y }, pairs17);
    near(cw17.angle, THETA, 1e-9,
        "sanity: this scenario's own local angle at the arc's center " +
        "really is the full 30-degree rotation (" + cw17.angle + "), " +
        "so 17a genuinely exercises the branch's use of `angle` -- a " +
        "scenario with angle 0 would pass with or without the fix");
    near(cw17.factor, 1.0, 1e-9,
        "sanity: the rotation is RIGID -- local factor is 1 (" +
        cw17.factor + "), so any radius change below would be a bug, " +
        "not the scenario");
    // The buggy answer, stated explicitly: center placed correctly but
    // startAngle left at 0, putting the start point at center + (r, 0).
    // If this were within tolerance of the right answer the fixture
    // would be worthless, so assert the two really are far apart --
    // 2r*sin(theta/2) = 10*sin(15deg) = 2.588190 units.
    var naiveStart17 = new RVector(wantCenter17.x + oldRadius17,
        wantCenter17.y);
    ok(naiveStart17.getDistanceTo(wantStart17) > 2.5,
        "sanity: discarding `angle` would put the start point " +
        naiveStart17.getDistanceTo(wantStart17) + " units from the " +
        "rigid-correct one, so the start/end assertions below have " +
        "real teeth");

    var counts17 = CsRevise.moveLinework(d17, i17, oldPos, newPos, {}, 100);
    eqs(counts17.unmoved.length, 0,
        "17a: a clean rigid rotation refuses nothing (" +
        JSON.stringify(counts17) + ")");
    eqs(counts17.moved, 1,
        "17a: the arc lands in moved -- a single center point has " +
        "nothing to disagree with (" + JSON.stringify(counts17) + ")");

    var after17 = d17.queryEntity(arcId17);
    ok(!isNull(after17), "17a: the arc still exists");
    if (!isNull(after17)) {
        var c17 = after17.getCenter();
        near(c17.x, wantCenter17.x, 1e-6,
            "17a: center x is where the rotation puts it (expected " +
            wantCenter17.x + ", got " + c17.x + ")");
        near(c17.y, wantCenter17.y, 1e-6,
            "17a: center y is where the rotation puts it (expected " +
            wantCenter17.y + ", got " + c17.y + ")");
        near(after17.getRadius(), oldRadius17, 1e-6,
            "17a: radius unchanged under a rigid rotation (expected " +
            oldRadius17 + ", got " + after17.getRadius() + ")");

        // THE ASSERTIONS THAT CATCH THE BUG. An arc's endpoints are
        // where it meets the walls it was traced against, and they live
        // in start/end ANGLE, which move() and setRadius() do not
        // touch. Without the rotate() the center below is still right
        // and these two are ~2.59 units out.
        var sp17 = after17.getStartPoint();
        var ep17 = after17.getEndPoint();
        near(sp17.x, wantStart17.x, 1e-6,
            "17a: THE ARC'S SWEEP FOLLOWS THE ROTATION -- start point " +
            "x (expected " + wantStart17.x + ", got " + sp17.x + "); " +
            "this fails if the branch discards CsWarp's `angle`");
        near(sp17.y, wantStart17.y, 1e-6,
            "17a: THE ARC'S SWEEP FOLLOWS THE ROTATION -- start point " +
            "y (expected " + wantStart17.y + ", got " + sp17.y + ")");
        near(ep17.x, wantEnd17.x, 1e-6,
            "17a: THE ARC'S SWEEP FOLLOWS THE ROTATION -- end point " +
            "x (expected " + wantEnd17.x + ", got " + ep17.x + ")");
        near(ep17.y, wantEnd17.y, 1e-6,
            "17a: THE ARC'S SWEEP FOLLOWS THE ROTATION -- end point " +
            "y (expected " + wantEnd17.y + ", got " + ep17.y + ")");
    }
    destr(i17);
}());

// -- 17b. a LINE through the new per-vertex warp branch: both endpoints
//    warp INDIVIDUALLY, and news[0]/news[1] really are start/end -------
(function() {
    var d17b = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var i17b = new RDocumentInterface(d17b);
    CsLayers.ensure(d17b, i17b, CsLayers.PROFILE_CEILING);

    // back to the incoherent P1/P3/P5 shape fixtures 12-16 share: a
    // line only takes the WARP path when its two ends see genuinely
    // different local transforms, which a rigid station set can never
    // produce.
    var oldPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 0 }, P5: { x: 40, y: 0 }
    };
    var newPos = {
        P1: { x: 0, y: 0 }, P3: { x: 20, y: 10 }, P5: { x: 40, y: 10 }
    };

    var op = new RAddObjectsOperation();
    var oldStart17b = new RVector(0, 5), oldEnd17b = new RVector(60, 20);
    var line17b = new RLineEntity(d17b,
        new RLineData(oldStart17b, oldEnd17b));
    line17b.setLayerId(d17b.getLayerId(CsLayers.PROFILE_CEILING));
    CsTags.set(line17b, CsBind.STATIONS_TAG,
        CsBind.encodeStations(["P1", "P3", "P5"]));
    op.addObject(line17b, false);
    i17b.applyOperation(op);
    var lineId17b = line17b.getId();

    var pairs17b = [
        { old: oldPos.P1, nu: newPos.P1 },
        { old: oldPos.P3, nu: newPos.P3 },
        { old: oldPos.P5, nu: newPos.P5 }
    ];
    var wantS = CsWarp.mlsSimilarity(
        { x: oldStart17b.x, y: oldStart17b.y }, pairs17b);
    var wantE = CsWarp.mlsSimilarity(
        { x: oldEnd17b.x, y: oldEnd17b.y }, pairs17b);
    ok(Math.abs(wantS.angle - wantE.angle) > 1e-6,
        "sanity: the two endpoints' local angles genuinely disagree (" +
        wantS.angle + " vs " + wantE.angle + "), so this line really " +
        "takes the WARP branch and not the everything-agrees rigid one");
    ok(Math.abs(wantS.x - wantE.x) > 1 || Math.abs(wantS.y - wantE.y) > 1,
        "sanity: the two warped endpoints are far apart, so swapping " +
        "news[0]/news[1] would be caught by the assertions below");

    var counts17b = CsRevise.moveLinework(d17b, i17b, oldPos, newPos,
        {}, 100);
    eqs(counts17b.warped, 1,
        "17b: the line lands in warped, not moved -- its two ends saw " +
        "different local transforms (" + JSON.stringify(counts17b) + ")");
    eqs(counts17b.unmoved.length, 0,
        "17b: nothing is refused (" + JSON.stringify(counts17b) + ")");

    var after17b = d17b.queryEntity(lineId17b);
    ok(!isNull(after17b), "17b: the line still exists");
    if (!isNull(after17b)) {
        var sp = after17b.getStartPoint(), ep = after17b.getEndPoint();
        near(sp.x, wantS.x, 1e-6,
            "17b: START point got the warp CsWarp computes for the " +
            "START point -- news[0] really is getReferencePoints()[0] " +
            "(x)");
        near(sp.y, wantS.y, 1e-6,
            "17b: START point got its own warp (y)");
        near(ep.x, wantE.x, 1e-6,
            "17b: END point got the warp CsWarp computes for the END " +
            "point -- news[1] really is getReferencePoints()[1] (x)");
        near(ep.y, wantE.y, 1e-6,
            "17b: END point got its own warp (y)");
    }
    destr(i17b);
}());

// =======================================================================
// FRAME CROSSING: the hazard sharing one drawing introduces.
//
// A plan station and a profile station three units apart in ABSOLUTE
// coordinates, with a line traced beside each -- close enough that each
// line's proximity box holds BOTH stations. stationsInBox and marginFor
// match by absolute proximity alone, so nothing but the frame can tell
// these two apart, and the elevation sits directly below the plan, so
// the frames really are neighbours at their boundary.
//
// Deliberately NOT a snap fixture: a traced endpoint landing exactly on
// a station point is decided by coincidence, never by proximity, so a
// snapped line would bind correctly even with no frame filter at all
// and would prove nothing. Every line here is traced NEAR the stations
// and none coincides with one.
// =======================================================================

(function() {
    var dF = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iF = new RDocumentInterface(dF);
    var op = new RAddObjectsOperation();

    CsLayers.ensure(dF, iF, CsLayers.CTRL_STATIONS);
    CsLayers.ensure(dF, iF, CsLayers.CTRL_PROFILE_STATIONS);
    CsLayers.ensure(dF, iF, CsLayers.WALLS_SURVEYED);
    CsLayers.ensure(dF, iF, CsLayers.PROFILE_CEILING);

    var planPt = CsDraw.addPoint(dF, op, CsLayers.CTRL_STATIONS,
        new RVector(100, 100));
    CsTags.set(planPt, "Station", "P1");
    op.addObject(planPt, false);
    var planPt2 = CsDraw.addPoint(dF, op, CsLayers.CTRL_STATIONS,
        new RVector(112, 106));
    CsTags.set(planPt2, "Station", "P2");
    op.addObject(planPt2, false);

    var profPt = CsDraw.addPoint(dF, op, CsLayers.CTRL_PROFILE_STATIONS,
        new RVector(103, 100));
    CsTags.set(profPt, "ProfileStation", "Q1");
    CsTags.set(profPt, "ProfileRun", "Q");
    op.addObject(profPt, false);

    // A point on a PROFILE-frame layer carrying the PLAN's own Station
    // tag. Ordinary copy-paste produces this: a user duplicates a plan
    // station into the elevation region to line something up, and the
    // copy keeps every tag it had. Its coordinates mean along-passage
    // distance now, so the plan index must not contain it -- the tag
    // says plan, the layer says profile, and the LAYER is what decides.
    var strayPt = CsDraw.addPoint(dF, op, CsLayers.CTRL_PROFILE_STATIONS,
        new RVector(104, 101));
    CsTags.set(strayPt, "Station", "P9");
    op.addObject(strayPt, false);

    // both boxes below hold BOTH frames' stations
    var planLine = new RLineEntity(dF, new RLineData(
        new RVector(99, 99), new RVector(110, 104)));
    planLine.setLayerId(dF.getLayerId(CsLayers.WALLS_SURVEYED));
    op.addObject(planLine, false);

    var profLine = new RLineEntity(dF, new RLineData(
        new RVector(99, 99.5), new RVector(110, 104.5)));
    profLine.setLayerId(dF.getLayerId(CsLayers.PROFILE_CEILING));
    op.addObject(profLine, false);
    iF.applyOperation(op);

    var planIdx = CsBind.stationIndex(dF, "plan");
    var profIdx = CsProfileBind.stationIndex(dF);

    var planNames = [], profNames = [], i;
    for (i = 0; i < planIdx.length; i++) { planNames.push(planIdx[i].name); }
    for (i = 0; i < profIdx.length; i++) { profNames.push(profIdx[i].name); }

    eqs(planNames.sort().join(","), "P1,P2",
        "the plan index holds ONLY the plan stations");
    eqs(profNames.join(","), "Q/Q1",
        "the profile index holds ONLY the profile station, run-qualified");

    // the default frame is plan, so every caller written before frames
    // existed keeps the behaviour it had
    var defaultNames = [], defaultIdx = CsBind.stationIndex(dF);
    for (i = 0; i < defaultIdx.length; i++) {
        defaultNames.push(defaultIdx[i].name);
    }
    eqs(defaultNames.sort().join(","), "P1,P2",
        "stationIndex() with no frame is the PLAN frame");

    // sanity: each line's box really does hold the OTHER frame's
    // station too, so the assertions below are about the frame filter
    // and not about the boxes missing each other
    var eps = CsBind.epsilonFor(dF);
    var mixed = planIdx.concat(profIdx);
    var boxNames = CsBind.stationsInBox(
        CsBind.boxOf(dF.queryEntity(profLine.getId())), mixed,
        CsBind.marginFor(mixed));
    ok(boxNames.length > 1,
        "sanity: the traced profile line's proximity box holds BOTH " +
        "frames' stations (got " + boxNames.join(",") + ")");

    /** An entity's LineworkStations tag, decoded and sorted. */
    var boundNames = function(doc, entity) {
        return CsBind.decodeStations(
            CsTags.get(doc.queryEntity(entity.getId()),
                CsBind.STATIONS_TAG)).sort().join(",");
    };

    var wasAuto = CsBind.autoBindOverride;
    CsBind.autoBindOverride = true;
    try {
        // The PROFILE pass runs FIRST, while the plan wall is still
        // untagged. Order matters: this pass skips anything already
        // carrying a linework tag, so binding the plan wall first would
        // hide a missing frame gate behind that skip rather than
        // testing it.
        CsProfileBind.claim(dF, iF);
        eqs(boundNames(dF, profLine), "Q/Q1",
            "the profile-frame line bound to Q/Q1 and NOT to the plan " +
            "stations beside it");
        // the reverse crossing, which is the live one: the profile
        // claim pass walks EVERY linework layer, so without a frame
        // test it tags an untagged plan wall with a profile station
        eqs(boundNames(dF, planLine), "",
            "THE PROFILE CLAIM PASS DID NOT TOUCH THE UNTAGGED PLAN " +
            "WALL -- it never reaches across the frame");

        CsBind.commitAutoBind(dF, iF, CsBind.planAutoBind(dF, {}));
        // decoded and SORTED, never compared as one encoded string:
        // the order two equally-valid stations come back in is the
        // document's query order, which this engine does not promise
        // to repeat between runs -- pinning "P1|P2" fails at random.
        eqs(boundNames(dF, planLine), "P1,P2",
            "the plan-frame line bound to the plan stations and NOT to " +
            "the profile station beside them");
    } finally {
        CsBind.autoBindOverride = wasAuto;
    }

    // bindEntity refuses across frames even when HANDED a mixed index:
    // the guarantee must not rest on every caller passing the right one
    eqs(String(mixed.length), "3", "sanity: the mixed index holds both frames");
    var crossed = CsBind.bindEntity(dF, dF.queryEntity(profLine.getId()),
        null, mixed, eps);
    eqs(crossed.stations.join(","), "Q/Q1",
        "handed BOTH frames' stations, a profile-frame line still binds " +
        "only to the profile station");
    var crossedPlan = CsBind.bindEntity(dF, dF.queryEntity(planLine.getId()),
        null, mixed, eps);
    eqs(crossedPlan.stations.sort().join(","), "P1,P2",
        "and a plan-frame line still binds only to the plan stations");

    destr(iF);
}());

// =======================================================================
// THE REBUILD AND THE ERASE BOTH IGNORE THE PROFILE FRAME.
//
// Neither needed a production change, and that is exactly why both are
// pinned here. CsRebuild recovers stations by the "Station"
// tag; CsDraw.eraseStations kills by "Station"/"LRUDName"/"SplayName".
// Profile geometry carries the Profile* namespace on profile-frame
// layers, so both walk past it -- for free, by naming, not by code. A
// later change that converged either namespace would break both
// silently. These assertions are the alarm.
// =======================================================================

/** How many entities in doc sit on a profile-frame layer. */
function countProfileFrameEntities(doc) {
    var ids = doc.queryAllEntities(false, false);
    var n = 0, i, e;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsLayers.frameOf(doc.getLayerName(e.getLayerId())) === "profile") {
            n++;
        }
    }
    return n;
}

/**
 * Draws a plan survey the way CsDraw.survey does -- station points and
 * labels tagged Station/StationLabel with Seq, legs tagged Shot -- but
 * without CsDraw.survey itself, which reads the ACTIVE document through
 * getDocument()/getDocumentInterface() and so cannot run headless.
 * Only the tags the rebuild actually reads are written.
 */
function drawPlanSurvey(doc, di, resolved, names) {
    var op = new RAddObjectsOperation();
    CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_STATION_LABELS);
    CsLayers.ensure(doc, di, CsLayers.CTRL_SHOTS);
    var i, st, pt, label, prev = null;
    for (i = 0; i < names.length; i++) {
        st = resolved.stations[names[i]];
        pt = CsDraw.addPoint(doc, op, CsLayers.CTRL_STATIONS,
            new RVector(st.x, st.y));
        CsTags.set(pt, "Station", names[i]);
        CsTags.set(pt, "Seq", i);
        op.addObject(pt, false);
        label = CsDraw.addText(doc, op, CsLayers.CTRL_STATION_LABELS, names[i],
            new RVector(st.x + 1, st.y + 1));
        CsTags.set(label, "StationLabel", names[i]);
        op.addObject(label, false);
        if (prev !== null) {
            CsDraw.addLine(doc, op, CsLayers.CTRL_SHOTS,
                new RVector(prev.x, prev.y), new RVector(st.x, st.y),
                "Shot", names[i - 1] + "->" + names[i]);
        }
        prev = st;
    }
    di.applyOperation(op);
}

(function() {
    var svR = CsModel.newSurvey();
    svR.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 90, -10, 4, 2)
    ];
    var resR = CsNetwork.resolve(svR, {});
    var namesR = ["A1", "A2", "A3"];

    // two documents, identical but for the drawn elevation
    var dPlan = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iPlan = new RDocumentInterface(dPlan);
    drawPlanSurvey(dPlan, iPlan, resR, namesR);

    var dBoth = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iBoth = new RDocumentInterface(dBoth);
    drawPlanSurvey(dBoth, iBoth, resR, namesR);
    CsProfileDraw.render(dBoth, iBoth, CsProfile.build(svR, resR, {}), {});
    ok(countProfileFrameEntities(dBoth) > 0,
        "sanity: the elevation really was drawn into the second drawing");

    var planOnly = CsTags.surveyFromDocument(dPlan);
    var withProfile = CsTags.surveyFromDocument(dBoth);

    eqs(String(withProfile.shots.length), String(planOnly.shots.length),
        "a drawn elevation adds NO shots to what the rebuild recovers");
    eqs(CsModel.stationNames(withProfile).join(","),
        CsModel.stationNames(planOnly).join(","),
        "and no stations -- the elevation's own labels carry the SAME " +
        "station names at entirely different coordinates, which is the " +
        "trap");

    // erasing a PLAN station leaves the elevation alone
    // CsDraw.eraseStations reaches for the ACTIVE document's interface
    // through QCAD's global getDocumentInterface() to apply its delete.
    // Headless there is no active document, so this stands one in --
    // the same shim the tool would find in the application, pointed at
    // the fixture. Restored after, so nothing later in this file sees a
    // stale interface.
    var hadGDI = (typeof getDocumentInterface === "undefined") ?
        null : getDocumentInterface;
    getDocumentInterface = function() { return iBoth; };

    var beforeProfile = countProfileFrameEntities(dBoth);
    var removed = CsDraw.eraseStations(dBoth, ["A2"]);
    eqs(String(removed > 0), "true",
        "the plan station's own geometry was removed (" + removed + ")");
    eqs(String(countProfileFrameEntities(dBoth)), String(beforeProfile),
        "EVERY profile-frame entity survived erasing a PLAN station");

    if (hadGDI === null) {
        getDocumentInterface = undefined;
    } else {
        getDocumentInterface = hadGDI;
    }

    destr(iPlan);
    destr(iBoth);
}());

// =======================================================================
// THE REGION MOVES, AND THE SKETCH MOVES WITH IT.
//
// The elevation is drawn into the plan drawing at a region below the
// plan's own extents, and that origin is RECOMPUTED on every draw. When
// the survey grows southward the plan's extents grow with it, the
// region slides down, and everything in the profile frame -- the
// generated geometry and the user's own tracing alike -- has to travel
// with it or the tracing is left describing empty space.
// =======================================================================

(function() {
    var svO = CsModel.newSurvey();
    svO.shots = [
        shotOf("A1", "A2", 10, 0, 0, 4, 2),
        shotOf("A2", "A3", 10, 0, -5, 4, 2)
    ];
    var resO = CsNetwork.resolve(svO, {});

    var dO = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iO = new RDocumentInterface(dO);
    drawPlanSurvey(dO, iO, resO, ["A1", "A2", "A3"]);
    CsProfileDraw.render(dO, iO, CsProfile.build(svO, resO, {}), {});

    var originBefore = CsProfileDraw.regionOrigin(dO);
    ok(originBefore !== null,
        "the drawing records where the profile region was put");

    // THE GUTTER PLUS THE GROUND-WINDOW PAD. The elevation's TOP edge
    // must sit exactly REGION_GUTTER below the SOUTH edge of the
    // imagery window the basemap/contour tools would fetch -- which is
    // groundWindowPad below the plan itself -- so imagery fetched
    // later never lands on the region (Nathan, 2026-08-27). The pad is
    // asserted against the same window math the fetch runs, and must
    // be REAL here: this small fixture is floor-dominated, so the
    // window overhangs the plan on every side.
    var planX = CsDraw.planDataBox(dO);
    var regionB = CsProfileDraw.regionBounds(CsProfile.build(svO, resO, {}));
    ok(planX !== null && regionB !== null,
        "the fixture has both plan geometry and a region to place");
    var padUnit = CsUnits.fromDrawingUnit(dO.getUnit(), RS);
    var pad = CsProfileDraw.groundWindowPad(dO, planX);
    var expectedPadM = Math.max(0, (CsGeoProject.groundExtent(
        { width: planX.maxX - planX.minX,
          height: planX.maxY - planX.minY }, padUnit).height -
        CsUnits.convert(planX.maxY - planX.minY, padUnit,
            CsUnits.METERS)) / 2.0);
    near(pad, CsUnits.convert(expectedPadM, CsUnits.METERS, padUnit), 1e-9,
        "the pad is the fetch window's own south overhang");
    ok(pad > 0,
        "the pad is real on this fixture, so the assertion below cannot "
        + "collapse into the plain-gutter case");
    near(planX.minY - (originBefore.y + regionB.maxY),
        CsProfileDraw.REGION_GUTTER + pad, 1e-9,
        "the elevation's top edge sits REGION_GUTTER below the imagery "
        + "window's south edge, not merely below the plan");
    ok(CsProfileDraw.REGION_GUTTER >= 30.0,
        "the gutter is at least 30 drawing units -- raised from 20 on the "
        + "drawing evidence that the two views read as one crowded block");

    // a sketch traced on the elevation, in the region's own coordinates
    CsLayers.ensure(dO, iO, CsLayers.PROFILE_CEILING);
    var opO = new RAddObjectsOperation();
    var sketch = new RLineEntity(dO, new RLineData(
        new RVector(originBefore.x + 5, originBefore.y + 3),
        new RVector(originBefore.x + 15, originBefore.y + 4)));
    sketch.setLayerId(dO.getLayerId(CsLayers.PROFILE_CEILING));
    opO.addObject(sketch, false);
    iO.applyOperation(opO);
    var sketchId = sketch.getId();
    var startBefore = dO.queryEntity(sketchId).getStartPoint();
    var sx = startBefore.x, sy = startBefore.y;

    // A SECOND sketch, drawn in the region but nowhere near a station:
    // a note about a passage the survey does not reach, an outline
    // sketched ahead of the next trip. It binds to NOTHING, so
    // moveLinework can never carry it -- the region translation is the
    // only thing that can, and without one it would be left behind
    // while everything around it moved.
    var opFar = new RAddObjectsOperation();
    var farSketch = new RLineEntity(dO, new RLineData(
        new RVector(originBefore.x + 900, originBefore.y + 700),
        new RVector(originBefore.x + 910, originBefore.y + 701)));
    farSketch.setLayerId(dO.getLayerId(CsLayers.PROFILE_CEILING));
    opFar.addObject(farSketch, false);
    iO.applyOperation(opFar);
    var farId = farSketch.getId();
    var farBefore = dO.queryEntity(farId).getStartPoint();
    var fx = farBefore.x, fy = farBefore.y;

    // AND THE TRACING LAYER IS SWITCHED OFF for the redraw -- the
    // ordinary thing a caver does to sketch undisturbed, and the case
    // this build punishes silently: a modify on an off layer is dropped
    // with no error at all, so a translation that runs outside
    // CsRevise.withOffLayersOn leaves every hidden sketch behind while
    // moving everything visible.
    var tracingLayer = dO.queryLayer(CsLayers.PROFILE_CEILING);
    ok(!isNull(tracingLayer), "sanity: the tracing layer exists to hide");
    if (!isNull(tracingLayer)) {
        tracingLayer.setOff(true);
        var opOff = new RModifyObjectsOperation();
        opOff.addObject(tracingLayer, false);
        iO.applyOperation(opOff);
        ok(dO.queryLayer(CsLayers.PROFILE_CEILING).isOff(),
            "sanity: the tracing layer really is off for the redraw");
    }

    // the survey grows southward, so the PLAN's extents grow and the
    // region below them has to move
    svO.shots.push(shotOf("A3", "A4", 200, 180, 0, 4, 2));
    var resO2 = CsNetwork.resolve(svO, {});
    drawPlanSurvey(dO, iO, resO2, ["A4"]);
    CsProfileDraw.render(dO, iO, CsProfile.build(svO, resO2, {}), {});

    var originAfter = CsProfileDraw.regionOrigin(dO);
    ok(originAfter !== null, "and still records it after the redraw");
    var dx = originAfter.x - originBefore.x;
    var dy = originAfter.y - originBefore.y;
    ok(Math.abs(dy) > 1e-9, "the origin really did move (dy " + dy + ")");

    var farAfter = dO.queryEntity(farId).getStartPoint();
    near(farAfter.x - fx, dx, 1e-9,
        "THE UNBOUND SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN X -- " +
        "nothing but the region translation can carry it");
    near(farAfter.y - fy, dy, 1e-9,
        "THE UNBOUND SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN Y");

    var startAfter = dO.queryEntity(sketchId).getStartPoint();
    near(startAfter.x - sx, dx, 1e-9,
        "THE SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN X");
    near(startAfter.y - sy, dy, 1e-9,
        "THE SKETCH MOVED BY EXACTLY THE ORIGIN DELTA IN Y");

    // and the drawn coordinates really are origin + band coordinate:
    // asserted against the built profile's own numbers, not merely
    // "it moved"
    var built2 = CsProfile.build(svO, resO2, {});
    var wanted = CsProfileDraw.positionsOf(built2, originAfter);
    var drawn = CsProfileBind.positions(dO);
    var checked = 0, k;
    for (k in wanted) {
        if (!wanted.hasOwnProperty(k) || !drawn.hasOwnProperty(k)) {
            continue;
        }
        near(drawn[k].x, wanted[k].x, 1e-9,
            k + " was drawn at origin + its band x");
        near(drawn[k].y, wanted[k].y, 1e-9,
            k + " was drawn at origin + its band y (zOffset included)");
        checked++;
    }
    ok(checked > 0, "sanity: some station was checked against the origin");

    // the region sits BELOW the plan, which is the whole placement rule
    var planBox = CsProfileDraw.planExtents(dO);
    ok(planBox !== null, "sanity: the plan has extents to sit below");
    ok(originAfter.y < planBox.minY,
        "the region's origin is below the plan's own extents (origin y " +
        originAfter.y + ", plan minY " + planBox.minY + ")");

    destr(iO);
}());
// =======================================================================
// A DROP IS LABELLED IN THE ELEVATION TOO, and only when this band
// draws the whole of it.
//
// The plan's label exists because a pitch has no plan extent -- the
// drawing is a dot. Here the drop is the most prominent thing on the
// page and the one line with no scale cue of its own: no walls either
// side, no bends, nothing but two station points at its ends.
// =======================================================================
(function() {
    var svP = CsModel.newSurvey();
    svP.shots = [
        shotOf("A1", "A2", 30, 90, 0),
        shotOf("A2", "A3", 62, 0, -90),
        shotOf("A3", "A4", 125, 0, -90),
        shotOf("A4", "A5", 40, 90, 0)
    ];
    var resP = CsNetwork.resolve(svP, {});
    var profP = CsProfile.build(svP, resP, {});

    var bandA = null;
    for (var b = 0; b < profP.bands.length; b++) {
        if (profP.bands[b].key === "A") { bandA = profP.bands[b]; }
    }
    ok(bandA !== null, "pitch-label: the fixture builds a band A");
    if (bandA !== null) {
        eqs(bandA.pitches.length, 1,
            "pitch-label: band A holds the one drop, whole");
        eqs(bandA.pitches[0].text, "P 187 ft (62 + 125)",
            "pitch-label: and carries the SAME text the plan draws -- " +
            "one answer, so the two views cannot disagree about a depth");
    }

    var dP = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iP = new RDocumentInterface(dP);
    CsLayers.ensureSurveyLayers(dP, iP);
    CsProfileDraw.render(dP, iP, profP, {});

    var labels = [];
    var ids = dP.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = dP.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        if (CsTags.get(e, "ProfilePitchLabel") === "") { continue; }
        labels.push(e);
    }
    eqs(labels.length, 1, "pitch-label: exactly one drawn");
    if (labels.length === 1) {
        eqs(String(CsTags.get(labels[0], "ProfilePitchLabel")), "A2",
            "pitch-label: keyed to the station the drop hangs from");
        ok(String(CsTags.get(labels[0], "ProfileRun")) === "A",
            "pitch-label: and carries its band's run, as every entity " +
            "this module draws must");
        // The generator may own nothing in the caver's namespace --
        // see CsProfileDraw.LAYERS and the ownership test above.
        ok(String(dP.queryLayer(labels[0].getLayerId()).getName())
                .indexOf("CTRL-") === 0,
            "pitch-label: on a CTRL- layer, so erase() owns it and " +
            "CsBind does not mistake it for traced linework");
        // Beside the MIDDLE of the drop, which is where the empty
        // space in this view is.
        var midY = null, topY = null, botY = null;
        for (i = 0; i < bandA.stations.length; i++) {
            if (bandA.stations[i].name === "A2") { topY = bandA.stations[i].y; }
            if (bandA.stations[i].name === "A4") { botY = bandA.stations[i].y; }
        }
        midY = (topY + botY) / 2.0;
        var origin = CsProfileDraw.regionOrigin(dP);
        var oy = (origin === null) ? 0 : origin.y;
        near(labels[0].getPosition().y, oy + midY + (bandA.zOffset || 0),
            1e-6, "pitch-label: level with the middle of the drop");
    }

    // A DROP INTO A NEW RUN IS STILL WHOLE. A band opens at its TIE
    // station, so the leg joining the run to its parent is drawn
    // inside it -- and a pitch hanging off a passage into a new
    // lettered series is therefore one line in one band, with both
    // its ends on it.
    var svQ = CsModel.newSurvey();
    svQ.shots = [
        shotOf("A1", "A2", 30, 90, 0),
        shotOf("A2", "B1", 80, 0, -90)
    ];
    var profQ = CsProfile.build(svQ, CsNetwork.resolve(svQ, {}), {});
    var whole = 0;
    for (b = 0; b < profQ.bands.length; b++) {
        whole += profQ.bands[b].pitches.length;
    }
    eqs(profQ.pitches.length, 1, "pitch-label: the cave has one drop");
    eqs(whole, 1,
        "pitch-label: and the band that opens at its top draws it " +
        "whole, so it is labelled");

    // ...but a drop onto a station the band DEMOTED is not. A run with
    // two arms keeps the longer one; a pitch down the shorter arm has
    // its bottom nowhere on the page, and half a line with a depth
    // beside it is a claim about geometry the reader cannot see.
    var svR = CsModel.newSurvey();
    svR.shots = [
        shotOf("C1", "C2", 30, 90, 0),
        shotOf("C2", "C3", 30, 90, 0),
        shotOf("C3", "C4", 30, 90, 0),
        shotOf("C4", "C6", 30, 90, 0),
        shotOf("C6", "C7", 30, 90, 0),
        shotOf("C4", "C5", 40, 0, 90)
    ];
    var profR = CsProfile.build(svR, CsNetwork.resolve(svR, {}), {});
    var wholeR = 0;
    for (b = 0; b < profR.bands.length; b++) {
        wholeR += profR.bands[b].pitches.length;
    }
    eqs(profR.pitches.length, 1,
        "pitch-label: the cave still HAS the aven off the demoted arm");
    eqs(wholeR, 0,
        "pitch-label: but no band draws it whole, so no band puts a " +
        "number beside half of it");

    destr(iP);
}());

// =======================================================================
// A BAND THAT IS ENTIRELY PITCH still has a frame.
//
// Zero width by construction -- an extended elevation's X is distance
// travelled and a rope travels none -- so the one thing that could go
// wrong is a bounding box of zero width, which is a line rather than a
// frame. The caption is what saves it, and that is worth pinning
// because it is a side effect rather than a decision anyone wrote down.
// =======================================================================
(function() {
    var svV = CsModel.newSurvey();
    svV.shots = [
        shotOf("A1", "A2", 30, 90, 0),
        shotOf("A2", "B1", 40, 0, -90),
        shotOf("B1", "B2", 50, 0, -90)
    ];
    var profV = CsProfile.build(svV, CsNetwork.resolve(svV, {}),
        { mode: "extended" });
    var bandV = null;
    for (var i = 0; i < profV.bands.length; i++) {
        if (profV.bands[i].key === "B") { bandV = profV.bands[i]; }
    }
    ok(bandV !== null, "all-pitch: the shaft gets its own band");
    if (bandV !== null) {
        var box = CsProfileDraw.bandBox(bandV);
        ok(box !== null, "all-pitch: a zero-width band is still boxable");
        ok(box.maxX - box.minX > 0,
            "all-pitch: and its box has width, from the caption -- a " +
            "frame of zero width would be a line, not a frame");
        ok(box.maxY - box.minY > 80,
            "all-pitch: and the height of the shaft, got " +
            (box.maxY - box.minY).toFixed(1));
    }
}());

// =======================================================================
// THE PROJECTED ELEVATION renders through the SAME code as the
// extended one -- which is the whole architectural claim, and the
// reason it is worth a fixture rather than a reading.
// =======================================================================
(function() {
    var svX = CsModel.newSurvey();
    svX.shots = [
        shotOf("A1", "A2", 40, 90, 0, 3, 2),
        shotOf("A2", "A3", 60, 0, -90, 2, 0),
        shotOf("A3", "A4", 40, 90, 0, 4, 1),
        // A loop back: a projection draws this whole, where an
        // extended elevation has to pick one way round.
        shotOf("A4", "A5", 40, 180, 0, 3, 1),
        shotOf("A5", "A6", 40, 270, 0, 3, 1)
    ];
    var resX = CsNetwork.resolve(svX, {});

    var profX = CsProfile.build(svX, resX, { mode: "projected" });
    eqs(profX.bands.length, 1,
        "projected: ONE band -- a projection does not divide a cave " +
        "into runs, every station is on the same plane");
    var bandX = profX.bands[0];
    eqs(bandX.key, "PROJ", "projected: under its own band key");
    eqs(bandX.stations.length, 6,
        "projected: EVERY placed station is drawn, none omitted");
    eqs(bandX.legs.length, resX.legs.length,
        "projected: and every drawn leg, loops included");
    eqs(bandX.omitted.length, 0,
        "projected: nothing is demoted -- there is no chain to pick");

    // True elevation, not unrolled distance.
    var lo = null, hi = null;
    for (var i = 0; i < bandX.stations.length; i++) {
        var y = bandX.stations[i].y;
        if (lo === null || y < lo) { lo = y; }
        if (hi === null || y > hi) { hi = y; }
    }
    near(hi - lo, 60, 1e-6,
        "projected: the drawing is 60 ft tall, which is the cave");

    // The caption names the plane. A reader who is not told which way
    // they are looking is holding a picture of some cave.
    var cap = CsProfileDraw.labelText(bandX);
    ok(cap.indexOf("PROJECTED") === 0,
        "projected: the caption says so, got '" + cap + "'");
    ok(cap.indexOf("LONG AXIS") >= 0,
        "projected: and says the plane was chosen FOR the caver when " +
        "it was, got '" + cap + "'");
    var asked = CsProfile.build(svX, resX,
        { mode: "projected", azimuth: 40 });
    eqs(asked.projection.source, "asked",
        "projected: an azimuth the caver gave is not reported as chosen");
    ok(CsProfileDraw.labelText(asked.bands[0]).indexOf("LONG AXIS") < 0,
        "projected: ...and the caption does not claim otherwise");

    // An axis has no direction, only a line.
    var a40 = CsProfile.build(svX, resX, { mode: "projected", azimuth: 40 });
    var a220 = CsProfile.build(svX, resX, { mode: "projected", azimuth: 220 });
    near(a40.projection.azimuth, a220.projection.azimuth, 1e-9,
        "projected: 040 and 220 are the same plane");

    // ...and it goes through the real renderer, onto real layers, with
    // every entity carrying its run like any other band's.
    var dX = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iX = new RDocumentInterface(dX);
    CsLayers.ensureSurveyLayers(dX, iX);
    var out = CsProfileDraw.render(dX, iX, profX, {});
    ok(out.stationsDrawn === 6,
        "projected: the renderer drew every station, got " +
        out.stationsDrawn);
    ok(out.legsDrawn === resX.legs.length,
        "projected: and every leg, got " + out.legsDrawn);
    ok(out.pitchLabels >= 1,
        "projected: the 60 ft drop is labelled, got " + out.pitchLabels);

    var scanned = scanProfileEntities(dX);
    ok(scanned.length > 0, "projected: it left tagged entities behind");
    var untagged = 0, offCtrl = 0;
    for (i = 0; i < scanned.length; i++) {
        if (!scanned[i].tags.hasOwnProperty("ProfileRun")) { untagged++; }
        if (String(scanned[i].layer).indexOf("CTRL-") !== 0) { offCtrl++; }
    }
    eqs(untagged, 0,
        "projected: every entity carries ProfileRun, so a scoped erase " +
        "reaches it exactly as it reaches an extended band's");
    eqs(offCtrl, 0,
        "projected: and all of it is on CTRL- layers, so the generator " +
        "still owns nothing in the caver's namespace");

    // ERASE, which is the claim that matters most: the projected
    // elevation is not a second view that the extended one would leave
    // behind when it redrew.
    var removed = CsProfileDraw.erase(dX, iX);
    ok(removed > 0, "projected: erase() removes it, got " + removed);
    eqs(scanProfileEntities(dX).length, 0,
        "projected: ...all of it");

    destr(iX);
}());

// =======================================================================
// THE CHUNKED ELEVATION: the cave cut at its pitches, arranged, and
// the arrangement surviving a redraw.
//
// That last claim is the whole feature. A caver spends an afternoon
// placing the pieces; a redraw that reflowed them into the preset's
// row every time the survey gained a station would make the mode
// useless, and would do it silently.
// =======================================================================
(function() {
    var svK = CsModel.newSurvey();
    svK.shots = [
        shotOf("A1", "A2", 30, 90, 0, 3, 2),
        shotOf("A2", "A3", 60, 0, -90, 2, 0),    // a drop
        shotOf("A3", "A4", 40, 90, 0, 4, 1),
        shotOf("A4", "A5", 50, 0, -90, 2, 0),    // and another
        shotOf("A5", "A6", 30, 90, 0, 3, 1)
    ];
    var resK = CsNetwork.resolve(svK, {});
    var profK = CsProfile.build(svK, resK, { mode: "chunked" });

    eqs(profK.chunks.length, 5,
        "chunked: three passages and two drops, got " +
        profK.chunks.length);
    var kinds = { pitch: 0, passage: 0 };
    for (var c = 0; c < profK.chunks.length; c++) {
        kinds[profK.chunks[c].kind]++;
    }
    eqs(kinds.pitch, 2, "chunked: two pitch chunks");
    eqs(kinds.passage, 3, "chunked: three passage chunks");
    eqs(profK.bands.length, 5, "chunked: one band per chunk");

    // DEPTH IS LOCKED. Every other elevation may displace a band to
    // fit more cave on a page; this one may not, because comparing two
    // chunks' depths by eye is the whole reason the cave was cut up.
    var displaced = 0;
    for (c = 0; c < profK.bands.length; c++) {
        if (Math.abs(profK.bands[c].zOffset || 0) > 1e-9) { displaced++; }
    }
    eqs(displaced, 0, "chunked: NOTHING is displaced off true elevation");

    // Pieces do not collide: the layout measures a chunk's DRAWN
    // extent, walls included, not just its centreline.
    var boxes = [];
    for (c = 0; c < profK.bands.length; c++) {
        boxes.push(CsChunk.extentOf(profK.bands[c]));
    }
    boxes.sort(function(a, b) { return a.lo - b.lo; });
    var overlaps = 0;
    for (c = 1; c < boxes.length; c++) {
        if (boxes[c].lo < boxes[c - 1].hi) { overlaps++; }
    }
    eqs(overlaps, 0,
        "chunked: no two pieces overlap -- the layout measures the " +
        "walls, and a pitch with a chamber at its foot is much wider " +
        "than the rope down the middle of it");

    // The joins are real correspondences: the same station in two
    // pieces.
    ok(profK.ties.length >= 4,
        "chunked: the pieces are tied back together, got " +
        profK.ties.length);
    for (c = 0; c < profK.ties.length; c++) {
        var tie = profK.ties[c];
        ok(profK.chunks[tie.a].stations[tie.station] === true &&
            profK.chunks[tie.b].stations[tie.station] === true,
            "chunked: tie at " + tie.station + " is a station BOTH " +
            "pieces hold");
    }

    // ---- drawn, then re-drawn, with a chunk moved in between -------
    var dK = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var iK = new RDocumentInterface(dK);
    CsLayers.ensureSurveyLayers(dK, iK);
    var outK = CsProfileDraw.render(dK, iK, profK, {});
    ok(outK.tiesDrawn >= 4,
        "chunked: the joins are DRAWN, got " + outK.tiesDrawn);

    var readBack = CsProfileDraw.chunkOffsets(dK);
    var keyCount = 0;
    for (var k in readBack) {
        if (readBack.hasOwnProperty(k)) { keyCount++; }
    }
    eqs(keyCount, 5,
        "chunked: every chunk's position is written onto the drawing, " +
        "not only the ones a caver has moved -- otherwise a redraw " +
        "between two drags reflows the pieces that did not move");

    // A caver drags one piece a long way off.
    var moved = profK.bands[1].key;
    readBack[moved] = 400.0;
    var profK2 = CsProfile.build(svK, resK,
        { mode: "chunked", offsets: readBack });
    var placedAt = null;
    for (c = 0; c < profK2.bands.length; c++) {
        if (profK2.bands[c].key === moved) {
            placedAt = profK2.bands[c].chunkOffset;
        }
    }
    near(placedAt, 400.0, 1e-9,
        "chunked: a redraw puts the moved piece back where the caver " +
        "put it, not where the preset would");
    // ...and the pieces that were NOT moved stay put.
    var before = {}, after = {};
    for (c = 0; c < profK.bands.length; c++) {
        before[profK.bands[c].key] = profK.bands[c].chunkOffset;
    }
    for (c = 0; c < profK2.bands.length; c++) {
        after[profK2.bands[c].key] = profK2.bands[c].chunkOffset;
    }
    var drifted = 0;
    for (k in before) {
        if (!before.hasOwnProperty(k) || k === moved) { continue; }
        if (Math.abs(before[k] - after[k]) > 1e-9) { drifted++; }
    }
    eqs(drifted, 0,
        "chunked: and every other piece is exactly where it was");

    destr(iK);
}());

// =======================================================================
// A MIXED CAVE, which is the normal case.
//
// Most long horizontal caves have vertical in them and most pits have
// a crawl at the bottom. Nothing declares which kind a cave is, so the
// engine has to decide PER PIECE, from that piece's own geometry --
// and get opposite answers inside one cave without being told.
// =======================================================================
(function() {
    var svM = CsModel.newSurvey();
    // A trunk that wanders back and forth (so a projection folds it),
    // with a branch off the middle, and a drop at the end.
    svM.shots = [
        shotOf("T1", "T2", 60, 90, 0, 4, 2),
        shotOf("T2", "T3", 60, 180, 0, 4, 2),
        shotOf("T3", "T4", 60, 270, 0, 4, 2),
        shotOf("T4", "T5", 60, 180, 0, 4, 2),
        shotOf("T5", "T6", 60, 90, 0, 4, 2),
        shotOf("T3", "S1", 40, 0, 0, 3, 1),      // a branch
        shotOf("S1", "S2", 40, 0, 0, 3, 1),
        shotOf("T6", "P1", 80, 0, -90, 2, 0)     // and a drop
    ];
    var resM = CsNetwork.resolve(svM, {});
    var profM = CsProfile.build(svM, resM, { mode: "chunked" });

    var unrolled = 0, projected = 0, pitchPieces = 0;
    for (var i = 0; i < profM.bands.length; i++) {
        if (profM.bands[i].chunkLayout === "unrolled") { unrolled++; }
        if (profM.bands[i].chunkLayout === "projected") { projected++; }
        if (profM.bands[i].chunkKind === "pitch") { pitchPieces++; }
    }
    ok(unrolled >= 1,
        "mixed: the wandering trunk is UNROLLED, because projecting it " +
        "folds it back behind itself");
    ok(projected >= 1,
        "mixed: and the rest is PROJECTED, because it does not");
    eqs(pitchPieces, 1, "mixed: the drop is its own piece");
    ok(profM.bands.length >= 3,
        "mixed: trunk, branch and drop -- the drop lands on a dead end, " +
        "so there is no passage chunk at its foot, got " +
        profM.bands.length);

    // NOTHING IS LOST TO THE CHOICE. Unrolling needs one path through
    // a piece, so a branch would be dropped -- unless the branch
    // becomes a piece of its own, which is what refine() does.
    var drawn = {};
    for (i = 0; i < profM.bands.length; i++) {
        for (var k = 0; k < profM.bands[i].stations.length; k++) {
            drawn[profM.bands[i].stations[k].name] = true;
        }
    }
    var missing = [];
    for (var name in resM.stations) {
        if (!resM.stations.hasOwnProperty(name)) { continue; }
        if (drawn[name] !== true) { missing.push(name); }
    }
    eqs(missing.length, 0,
        "mixed: every station is on the page -- the branch unrolling " +
        "could not carry became its own piece rather than being " +
        "dropped (missing: " + missing.join(",") + ")");

    // Still at true depth, still not colliding.
    var displaced = 0;
    for (i = 0; i < profM.bands.length; i++) {
        if (Math.abs(profM.bands[i].zOffset || 0) > 1e-9) { displaced++; }
    }
    eqs(displaced, 0, "mixed: nothing is displaced off true elevation");
    var spans = [];
    for (i = 0; i < profM.bands.length; i++) {
        spans.push(CsChunk.extentOf(profM.bands[i]));
    }
    spans.sort(function(a, b) { return a.lo - b.lo; });
    var over = 0;
    for (i = 1; i < spans.length; i++) {
        if (spans[i].lo < spans[i - 1].hi - 1e-9) { over++; }
    }
    eqs(over, 0, "mixed: and no two pieces overlap");

    // A PIECE THAT DOES NOT FOLD IS LEFT ALONE. The fold measurement
    // is what decides, so a straight piece keeps true position.
    var svS = CsModel.newSurvey();
    svS.shots = [
        shotOf("A1", "A2", 60, 90, 0, 4, 2),
        shotOf("A2", "A3", 60, 90, 0, 4, 2),
        shotOf("A3", "A4", 60, 90, 0, 4, 2)
    ];
    var profS = CsProfile.build(svS, CsNetwork.resolve(svS, {}),
        { mode: "chunked" });
    eqs(profS.bands.length, 1, "straight: one piece");
    eqs(profS.bands[0].chunkLayout, "projected",
        "straight: a passage that runs along its own plane is left " +
        "projected, at true position");
    near(CsChunk.foldOf(profS.bands[0]), 0, 1e-9,
        "straight: nothing folded behind anything");

    destr(new RDocumentInterface(new RDocument(new RMemoryStorage(),
        createSpatialIndex())));
}());

// =======================================================================
// Report.
// =======================================================================

if (failures.length === 0) {
    print("### PROFILE DRAW OK");
} else {
    for (var i2 = 0; i2 < failures.length; i2++) {
        print("FAIL  " + failures[i2]);
    }
    print("### PROFILE DRAW FAIL");
}
