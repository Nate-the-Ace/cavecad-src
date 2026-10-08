// edit_trip_run.js -- Edit Trip against a real document.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/edit_trip_run.js "$PWD"
//
// Prints "### EDIT TRIP OK <n>" or "### EDIT TRIP FAIL".
//
// The pure half of CsTripEdit (normalizeDate, planEdits, applyToSurvey,
// tagPlan) is covered in tests/js_unit.js. What only a real
// RDocument can prove is the half that matters most here:
//
//   - the edit reaches the DRAWING -- the tags come back changed from
//     CsRevise.surveyFromDocument, which is the reader every other tool
//     in the suite uses,
//   - the trip COUNT does not change. This is the whole reason the tool
//     exists: Survey Notebook's own edit path matches trips by
//     fingerprint (date | team), so correcting a date forked the trip
//     into a duplicate and left the original standing,
//   - nothing MOVED. These four fields carry no geometry, and an edit
//     that quietly re-resolved the network would be a different and
//     much more dangerous tool,
//   - a cleared field is really cleared. CsTags.set returns early on
//     "" by design, so clearing needs CsTags.remove; getting this
//     wrong leaves the old value in place while the dialog says it is
//     gone,
//   - editing trip 0 also rewrites the legacy drawing-level mirror
//     (SurveyDate/SurveyTeam), which pre-trip readers still consult.

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

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");

includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

// ---------------------------------------------------------------------
// Assertion harness -- the shape every engine suite here uses.
// ---------------------------------------------------------------------

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) {
        passed++;
    } else {
        failures.push(what);
    }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

// ---------------------------------------------------------------------
// Fixture: a two-trip cave, drawn for real.
// ---------------------------------------------------------------------

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
getDocument = function() { return doc; };
getDocumentInterface = function() { return di; };

function shotOf(from, to, d, az, inc, trip) {
    var s = CsModel.newShot();
    s.from = from;
    s.to = to;
    s.distance = d;
    s.azimuth = az;
    s.inclination = inc || 0;
    s.trip = trip || 0;
    return s;
}

var survey = CsModel.newSurvey();
survey.caveName = "TRUITT CAVE";
survey.distanceUnit = "ft";
survey.trips = [CsModel.newTrip(), CsModel.newTrip()];
survey.trips[0].name = "ENTRANCE";
survey.trips[0].date = "2026-08-01";
survey.trips[0].team = "NDS, JB";
survey.trips[0].instruments = "SUUNTO";
survey.trips[0].declination = 3.5;
survey.trips[1].name = "";
survey.trips[1].date = "2026-08-08";     // the wrong date, on purpose
survey.trips[1].team = "NDS, RM";        // and the wrong team
survey.trips[1].instruments = "";
survey.trips[1].declination = 3.5;
survey.shots.push(shotOf("ENT", "A1", 30.0, 90.0, -5.0, 0));
survey.shots.push(shotOf("A1", "A2", 22.0, 45.0, 0.0, 0));
survey.shots.push(shotOf("A2", "B1", 18.5, 350.0, 3.0, 1));
survey.shots.push(shotOf("B1", "B2", 25.0, 20.0, -2.0, 1));

CsDraw.survey(survey, CsNetwork.resolve(survey, {}));

var before = CsRevise.surveyFromDocument(doc);
ok(before !== null && before.survey !== null,
    "the fixture drawing reconstructs");
eqs(before.survey.trips.length, 2, "the fixture drawing has two trips");
eqs(before.survey.trips[1].date, "2026-08-08",
    "the fixture drawing carries trip 1's date");
eqs(before.survey.shots.length, 4, "the fixture drawing has four shots");

/** Every station's drawn position, by name -- the "nothing moved"
 *  observable. */
function positions() {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.getPosition !== "function") {
            continue;
        }
        var name = CsTags.get(e, "Station");
        if (name !== "") {
            var p = e.getPosition();
            out[name] = { x: p.x, y: p.y };
        }
    }
    return out;
}
var posBefore = positions();
ok(posBefore.hasOwnProperty("B1"), "the fixture drew its stations");

// ---------------------------------------------------------------------
// The edit: trip 1's date and team were both wrong, and it never got a
// name. Exactly Nathan's Truitt Cave case.
// ---------------------------------------------------------------------

var plan = CsTripEdit.planEdits(before.survey, [
    { tripId: 1, name: "UPPER MAZE", date: "2026-08-15",
      team: "NDS, RM, KW", instruments: "DISTOX2" }
]);
ok(plan.error === undefined, "planEdits accepted the correction");
eqs(plan.changes.length, 1, "one trip to change");

CsTripEdit.applyToSurvey(before.survey, plan.changes);
var res = CsTripEdit.writeTags(doc, di, before.survey, plan.changes);
eqs(res.written, 1, "one anchor point was retagged");
eqs(res.missing.length, 0, "every changed trip had an anchor");

var after = CsRevise.surveyFromDocument(doc);

// The claim the tool exists for.
eqs(after.survey.trips.length, 2,
    "the drawing still has TWO trips -- the correction did not fork one");

eqs(after.survey.trips[1].date, "2026-08-15", "trip 1's date is corrected");
eqs(after.survey.trips[1].team, "NDS, RM, KW", "trip 1's team is corrected");
eqs(after.survey.trips[1].name, "UPPER MAZE", "trip 1 gained its name");
eqs(after.survey.trips[1].instruments, "DISTOX2",
    "trip 1 gained its instruments");

// Everything the edit must NOT touch.
eqs(after.survey.trips[0].date, "2026-08-01", "trip 0's date is untouched");
eqs(after.survey.trips[0].team, "NDS, JB", "trip 0's team is untouched");
near(after.survey.trips[1].declination, 3.5, 1e-9,
    "trip 1's declination is untouched");
eqs(after.survey.shots.length, 4, "no shot was added or lost");
var tripOfShot = {};
for (var si = 0; si < after.survey.shots.length; si++) {
    tripOfShot[after.survey.shots[si].from] = after.survey.shots[si].trip;
}
eqs(tripOfShot["A2"], 1, "trip 1 still owns its shots");
eqs(tripOfShot["ENT"], 0, "trip 0 still owns its shots");

var posAfter = positions();
var moved = 0;
for (var n in posBefore) {
    if (!posBefore.hasOwnProperty(n)) {
        continue;
    }
    if (!posAfter.hasOwnProperty(n)) {
        moved++;
        continue;
    }
    if (Math.abs(posAfter[n].x - posBefore[n].x) > 1e-12 ||
            Math.abs(posAfter[n].y - posBefore[n].y) > 1e-12) {
        moved++;
    }
}
eqs(moved, 0, "not one station moved");

// ---------------------------------------------------------------------
// Clearing a field really clears it (CsTags.set cannot, CsTags.remove
// must).
// ---------------------------------------------------------------------

var clearPlan = CsTripEdit.planEdits(after.survey, [
    { tripId: 1, name: "UPPER MAZE", date: "2026-08-15",
      team: "NDS, RM, KW", instruments: "" }
]);
ok(clearPlan.error === undefined, "planEdits accepted the clear");
eqs(clearPlan.changes.length, 1, "clearing instruments is a change");
CsTripEdit.applyToSurvey(after.survey, clearPlan.changes);
CsTripEdit.writeTags(doc, di, after.survey, clearPlan.changes);
var cleared = CsRevise.surveyFromDocument(doc);
eqs(cleared.survey.trips[1].instruments, "",
    "a cleared field is really gone from the drawing");
eqs(cleared.survey.trips[1].team, "NDS, RM, KW",
    "clearing one field left its neighbours alone");

// ---------------------------------------------------------------------
// Trip 0 also owns the legacy drawing-level mirror, which pre-trip
// readers still consult -- an edit that skipped it would leave the
// drawing contradicting itself.
// ---------------------------------------------------------------------

function anchorTagOf(key) {
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "") {
            continue;
        }
        if (CsTags.getNumber(e, "Trip") === 0) {
            return CsTags.get(e, key);
        }
    }
    return null;
}
eqs(anchorTagOf("SurveyDate"), "2026-08-01",
    "the legacy mirror starts where the fixture put it");

var plan0 = CsTripEdit.planEdits(cleared.survey, [
    { tripId: 0, name: "ENTRANCE", date: "2026-07-30", team: "NDS, JB, KW",
      instruments: "SUUNTO" }
]);
ok(plan0.error === undefined, "planEdits accepted the trip 0 correction");
CsTripEdit.applyToSurvey(cleared.survey, plan0.changes);
CsTripEdit.writeTags(doc, di, cleared.survey, plan0.changes);

var after0 = CsRevise.surveyFromDocument(doc);
eqs(after0.survey.trips[0].date, "2026-07-30", "trip 0's date is corrected");
eqs(after0.survey.trips.length, 2, "still two trips after the trip 0 edit");
eqs(anchorTagOf("SurveyDate"), "2026-07-30",
    "the legacy SurveyDate mirror followed trip 0");
eqs(anchorTagOf("SurveyTeam"), "NDS, JB, KW",
    "the legacy SurveyTeam mirror followed trip 0");
eqs(anchorTagOf("SurveyName"), "TRUITT CAVE",
    "the cave name still owns SurveyName");

// ---------------------------------------------------------------------
// A trip with no anchor in the drawing is reported, not silently
// dropped.
// ---------------------------------------------------------------------

var ghost = CsTripEdit.writeTags(doc, di, after0.survey,
    [{ tripId: 7, before: { name: "", date: "", team: "", instruments: "" },
       after: { name: "GHOST", date: "", team: "", instruments: "" } }]);
eqs(ghost.written, 0, "a trip with no anchor writes nothing");
eqs(ghost.missing.length, 1, "and is reported as missing");
eqs(ghost.missing[0], 7, "by its trip id");

// ---------------------------------------------------------------------
// Deleting a trip.
//
// The dangerous part is not the removal, it is the RENUMBERING: trip
// ids are array indices, stamped into XDATA on legs, splays, trip
// anchors and the surveyor's own traced linework. Delete trip 1 of
// three and the old trip 2 must come back as trip 1, everywhere.
// ---------------------------------------------------------------------

var delDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var delDi = new RDocumentInterface(delDoc);
getDocument = function() { return delDoc; };
getDocumentInterface = function() { return delDi; };

var delSurvey = CsModel.newSurvey();
delSurvey.caveName = "DELETE TEST CAVE";
delSurvey.distanceUnit = "ft";
delSurvey.trips = [CsModel.newTrip(), CsModel.newTrip(), CsModel.newTrip()];
var delNames = ["FIRST", "MIDDLE", "LAST"];
for (var dt = 0; dt < 3; dt++) {
    delSurvey.trips[dt].name = delNames[dt];
    delSurvey.trips[dt].date = "2026-0" + (dt + 1) + "-05";
    delSurvey.trips[dt].team = "CREW " + dt;
    delSurvey.trips[dt].declination = 2.0;
}
// Trip 0 is the trunk; trips 1 and 2 each BRANCH off one of its
// stations, which is what a real cave looks like and what makes
// deleting a middle trip legal at all -- a trip nothing else stands on.
var delPrev = "ENT";
for (var ds = 0; ds < 3; ds++) {
    var dnm = "D0S" + ds;
    delSurvey.shots.push(shotOf(delPrev, dnm, 20, (ds * 20) % 360, 0, 0));
    delPrev = dnm;
}
for (dt = 1; dt < 3; dt++) {
    var branchFrom = "D0S" + dt;   // trip 1 off D0S1, trip 2 off D0S2
    for (ds = 0; ds < 3; ds++) {
        var bnm = "D" + dt + "S" + ds;
        delSurvey.shots.push(shotOf(branchFrom, bnm, 20,
            (dt * 50 + ds * 20) % 360, 0, dt));
        branchFrom = bnm;
    }
}
CsDraw.survey(delSurvey, CsNetwork.resolve(delSurvey, {}));

// A piece of "traced linework" on each of trips 1 and 2, tagged the way
// CsBind tags the real thing.
function fakeLinework(tripId, stationName, x, y) {
    var op = new RAddObjectsOperation();
    var line = new RLineEntity(delDoc,
        new RLineData(new RVector(x, y), new RVector(x + 5, y + 5)));
    CsTags.set(line, CsBind.TRIP_TAG, tripId);
    CsTags.set(line, CsBind.STATIONS_TAG, CsBind.encodeStations([stationName]));
    op.addObject(line, false);
    delDi.applyOperation(op);
}
fakeLinework(1, "D1S0", 500, 500);
fakeLinework(2, "D2S0", 600, 600);

var delRecon = CsRevise.surveyFromDocument(delDoc);
eqs(delRecon.survey.trips.length, 3, "the delete fixture has three trips");
eqs(delRecon.survey.shots.length, 9, "and nine shots");

var delRes = CsTripEdit.deleteTrip(delDoc, delDi, delRecon, 1,
    { keepLinework: true });
ok(delRes.ok === true, "deleteTrip reports success");
eqs(delRes.removedShots, 3, "trip 1's three shots were removed");

var afterDel = CsRevise.surveyFromDocument(delDoc);
eqs(afterDel.survey.trips.length, 2, "two trips are left");
eqs(afterDel.survey.shots.length, 6, "six shots are left");
eqs(afterDel.survey.trips[0].name, "FIRST", "trip 0 is untouched");
eqs(afterDel.survey.trips[1].name, "LAST",
    "the old trip 2 came back as trip 1");
eqs(afterDel.survey.trips[1].team, "CREW 2",
    "and kept its own team, not the deleted trip's");

// Its SHOTS were renumbered with it -- the failure that would leave a
// trip record and its shots pointing at different ids.
var lastTripShots = 0;
for (var dsi = 0; dsi < afterDel.survey.shots.length; dsi++) {
    if ((afterDel.survey.shots[dsi].trip || 0) === 1) { lastTripShots++; }
}
eqs(lastTripShots, 3, "the surviving trip's shots carry its new id");

// Nothing the deleted trip drew is left behind -- including the tie-in
// leg from trip 0's last station, whose far end is now gone.
var strayNames = 0, strayLegs = 0;
var delIds = delDoc.queryAllEntities(false, false);
for (var di2 = 0; di2 < delIds.length; di2++) {
    var de = delDoc.queryEntity(delIds[di2]);
    if (isNull(de)) { continue; }
    var dn = CsTags.get(de, "Station");
    if (dn !== "" && /^D1S/.test(dn)) { strayNames++; }
    var dsh = CsTags.get(de, "Shot");
    if (dsh !== "" && /D1S/.test(dsh)) { strayLegs++; }
}
eqs(strayNames, 0, "no station of the deleted trip survives");
eqs(strayLegs, 0, "and no leg of it either, tie-in leg included");

// The linework: the deleted trip's is KEPT and unbound; the later
// trip's is re-keyed from 2 to 1.
var kept = 0, rekeyed = 0, stillTrip2 = 0;
for (di2 = 0; di2 < delIds.length; di2++) {
    de = delDoc.queryEntity(delIds[di2]);
    if (isNull(de) || !/RLineEntity/.test(String(de))) { continue; }
    var lt = CsTags.getNumber(de, CsBind.TRIP_TAG);
    var ls = CsTags.get(de, CsBind.STATIONS_TAG);
    if (lt === null && ls === "" &&
            Math.abs(de.getStartPoint().x - 500) < 1e-6) {
        kept++;
    }
    if (lt === 1 && Math.abs(de.getStartPoint().x - 600) < 1e-6) {
        rekeyed++;
    }
    if (lt === 2) { stillTrip2++; }
}
eqs(kept, 1, "the deleted trip's tracing is kept, and unbound");
eqs(rekeyed, 1, "the later trip's tracing was re-keyed to its new id");
eqs(stillTrip2, 0, "nothing still claims the old trip id 2");

// A trip another trip STANDS ON cannot be deleted out from under it:
// the dependent's shots would survive pointing at a station that is
// gone, and a whole trip would quietly leave the map.
var chain = CsModel.newSurvey();
chain.trips = [CsModel.newTrip(), CsModel.newTrip()];
chain.shots = [shotOf("A1", "A2", 10, 0, 0, 0),
    shotOf("A2", "B1", 10, 90, 0, 1)];
var standing = CsTripEdit.tripsStandingOn(chain, 0);
eqs(standing.length, 1, "trip 1 is seen standing on trip 0");
eqs(standing[0].tripId, 1, "and is named");
eqs(CsTripEdit.tripsStandingOn(chain, 1).length, 0,
    "nothing stands on the last trip in a chain");
var blocked = CsTripEdit.deleteTrip(delDoc, delDi,
    { survey: chain, anchorName: "", adjustTags: {} }, 0, {});
ok(blocked.ok === false && /tie/.test(blocked.error),
    "deleting a trip another trip ties into is refused, by name");

// Refusals.
var lastOne = CsModel.newSurvey();
lastOne.trips = [CsModel.newTrip()];
lastOne.shots = [shotOf("A1", "A2", 10, 0, 0, 0)];
var refuse = CsTripEdit.deleteTrip(delDoc, delDi,
    { survey: lastOne, anchorName: "", adjustTags: {} }, 0, {});
ok(refuse.ok === false && /only one trip/.test(refuse.error),
    "deleting the last trip in a drawing is refused");

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

var out;
if (failures.length === 0) {
    out = "### EDIT TRIP OK " + passed + " assertions";
} else {
    out = "### EDIT TRIP FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
