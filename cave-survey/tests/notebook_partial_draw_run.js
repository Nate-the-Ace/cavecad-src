// notebook_partial_draw_run.js -- Survey Notebook's incremental Draw
// against real documents.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/notebook_partial_draw_run.js "$PWD"
//
// Prints "### PARTIAL DRAW OK <n>" or "### PARTIAL DRAW FAIL".
//
// The claim under test is an EQUIVALENCE, and it can only be made
// against real documents: adding a trip through the fast path must
// leave a drawing that reconstructs to the same survey, with the same
// stations in the same places, as adding it through the whole-cave path
// this tool has always used. Two identical fixture drawings are built,
// the same page is drawn into each -- one forced full, one left to the
// gate -- and the results are compared tag for tag.
//
// The second claim is the gate's: a page that MOVES the existing survey
// (a corrected declination on an earlier trip) must NOT take the fast
// path, because the linework mover has to run.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof createSpatialIndex === "undefined") {
    createSpatialIndex = function() { return new RSpatialIndexNavel(); };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/SurveyNotebook";
include(includeBasePath + "/SurveyNotebook.js");

// ---------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------

var passed = 0;
var failures = [];
function ok(condition, what) {
    if (condition) { passed++; } else { failures.push(what); }
}
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) +
        ", got " + JSON.stringify(a) + ")");
}

// The four GUI calls the draw path makes, silenced. handleUserMessage
// writes to a command line that does not exist headlessly; the message
// boxes would block forever.
var messages = [];
QMessageBox.information = function(parent, title, text) {
    messages.push(String(text));
    return 0;
};
QMessageBox.warning = function(parent, title, text) {
    messages.push("WARN: " + String(text));
    return 0;
};
EAction.handleUserMessage = function(text) { messages.push(String(text)); };

// ---------------------------------------------------------------------
// Fixture: a three-trip cave, and the page that adds a fourth.
// ---------------------------------------------------------------------

function shotOf(from, to, d, az, inc, trip) {
    var s = CsModel.newShot();
    s.from = from; s.to = to; s.distance = d; s.azimuth = az;
    s.inclination = inc || 0; s.trip = trip || 0;
    s.left = 3; s.right = 4; s.up = 6; s.down = 2;
    return s;
}

function fixtureSurvey() {
    var sv = CsModel.newSurvey();
    sv.caveName = "PARTIAL TEST CAVE";
    sv.distanceUnit = "ft";
    sv.trips = [];
    var prev = "ENT";
    for (var t = 0; t < 3; t++) {
        var tp = CsModel.newTrip();
        tp.name = "RUN " + t;
        tp.date = "2026-0" + (t + 1) + "-05";
        tp.team = "A, B";
        tp.declination = 2.0;
        sv.trips.push(tp);
        for (var i = 0; i < 5; i++) {
            var nm = "T" + t + "S" + i;
            sv.shots.push(shotOf(prev, nm, 20, (t * 40 + i * 15) % 360,
                i % 3 - 1, t));
            prev = nm;
        }
    }
    return sv;
}

/** The notebook page: five new shots hanging off an existing station. */
function pageSurvey(tieStation) {
    var page = CsModel.newSurvey();
    page.caveName = "PARTIAL TEST CAVE";
    page.date = "2026-06-20";
    page.team = "C, D";
    page.declination = 2.0;
    page.distanceUnit = "ft";
    var prev = tieStation;
    for (var i = 0; i < 5; i++) {
        var nm = "NEW" + i;
        page.shots.push(shotOf(prev, nm, 18, (i * 55) % 360, 0, 0));
        prev = nm;
    }
    return page;
}

/** A fresh document carrying the fixture, drawn for real. */
function freshDrawing() {
    var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
    var di = new RDocumentInterface(doc);
    getDocument = function() { return doc; };
    getDocumentInterface = function() { return di; };
    var sv = fixtureSurvey();
    CsDraw.survey(sv, CsAdjust.resolveAndAdjust(sv, {}));
    return { doc: doc, di: di };
}

/** {name: {x, y}} of every station point in a drawing. */
function positionsOf(doc) {
    var out = {};
    var stations = CsTags.collectStations(doc);
    for (var i = 0; i < stations.length; i++) {
        out[stations[i].name] = { x: stations[i].pos.x,
            y: stations[i].pos.y };
    }
    return out;
}

/** A comparable digest of what a drawing's tags reconstruct to. */
function digestOf(doc) {
    var recon = CsRevise.surveyFromDocument(doc);
    var sv = recon.survey;
    var shots = [];
    for (var i = 0; i < sv.shots.length; i++) {
        var sh = sv.shots[i];
        shots.push((sh.trip || 0) + ":" + sh.from + ">" + sh.to + ":" +
            sh.distance + ":" + sh.azimuth);
    }
    shots.sort();
    var trips = [];
    for (var t = 0; t < sv.trips.length; t++) {
        trips.push(t + "|" + sv.trips[t].name + "|" + sv.trips[t].date +
            "|" + sv.trips[t].team + "|" + sv.trips[t].declination);
    }
    return { trips: trips.join(" ; "), shots: shots.join(" ; "),
        caveName: sv.caveName, tripCount: sv.trips.length,
        shotCount: sv.shots.length };
}

// ---------------------------------------------------------------------
// The equivalence: same page, both paths.
// ---------------------------------------------------------------------

var full = freshDrawing();
var fullBefore = positionsOf(full.doc);
var tie = "T2S4"; // the last station of the last trip
getDocument = function() { return full.doc; };
getDocumentInterface = function() { return full.di; };
SurveyNotebook.drawMergedSurvey(null, full.doc, pageSurvey(tie),
    CsRevise.surveyFromDocument(full.doc), true); // forced FULL

var fast = freshDrawing();
getDocument = function() { return fast.doc; };
getDocumentInterface = function() { return fast.di; };
messages = [];
SurveyNotebook.drawMergedSurvey(null, fast.doc, pageSurvey(tie),
    CsRevise.surveyFromDocument(fast.doc), false); // gated -- must go fast

var tookFastPath = false;
for (var mi = 0; mi < messages.length; mi++) {
    if (/only this trip was redrawn/.test(messages[mi])) {
        tookFastPath = true;
    }
}
ok(tookFastPath, "a page that adds a trip takes the fast path");

var dFull = digestOf(full.doc);
var dFast = digestOf(fast.doc);
eqs(dFast.tripCount, dFull.tripCount, "same trip count both ways");
eqs(dFast.shotCount, dFull.shotCount, "same shot count both ways");
eqs(dFast.trips, dFull.trips, "same trip records both ways");
eqs(dFast.shots, dFull.shots, "same shots both ways");
eqs(dFast.caveName, dFull.caveName, "same cave name both ways");
eqs(dFast.tripCount, 4, "the page really did add a fourth trip");

var pFull = positionsOf(full.doc);
var pFast = positionsOf(fast.doc);
var missing = [], moved = [];
for (var n in pFull) {
    if (!pFull.hasOwnProperty(n)) { continue; }
    if (!pFast.hasOwnProperty(n)) { missing.push(n); continue; }
    if (Math.abs(pFast[n].x - pFull[n].x) > 1e-9 ||
            Math.abs(pFast[n].y - pFull[n].y) > 1e-9) {
        moved.push(n);
    }
}
eqs(missing.length, 0, "the fast path drew every station the full path did");
eqs(moved.length, 0, "and put each one in the same place");
var extra = 0;
for (n in pFast) {
    if (pFast.hasOwnProperty(n) && !pFull.hasOwnProperty(n)) { extra++; }
}
eqs(extra, 0, "and drew no station the full path did not");

// The stations that were already there did not move under either path
// -- the premise the gate is built on.
var untouched = 0;
for (n in fullBefore) {
    if (!fullBefore.hasOwnProperty(n)) { continue; }
    if (pFast.hasOwnProperty(n) &&
            Math.abs(pFast[n].x - fullBefore[n].x) <= 1e-9 &&
            Math.abs(pFast[n].y - fullBefore[n].y) <= 1e-9) {
        untouched++;
    }
}
eqs(untouched, 16, "all 16 existing stations stayed exactly put");

// Exactly one anchor claims trip 0 -- the failure mode a partial draw
// invites, since it draws a page whose first station is not trip 0's.
function trip0Anchors(doc) {
    var n = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "") { continue; }
        if (CsTags.get(e, "SurveyName") !== "") { n++; }
    }
    return n;
}
eqs(trip0Anchors(fast.doc), 1,
    "the partial draw did not create a second drawing-level anchor");
eqs(trip0Anchors(full.doc), 1, "nor did the full redraw");

// ---------------------------------------------------------------------
// The gate refuses when the survey moves.
// ---------------------------------------------------------------------

var mover = freshDrawing();
getDocument = function() { return mover.doc; };
getDocumentInterface = function() { return mover.di; };
messages = [];
// A page that REPLACES trip 1 with the same shots read under a
// different declination: every station downstream of it turns.
var reconMover = CsRevise.surveyFromDocument(mover.doc);
var revision = CsModel.newSurvey();
revision.caveName = "PARTIAL TEST CAVE";
revision.date = reconMover.survey.trips[1].date;
revision.team = reconMover.survey.trips[1].team;
revision.declination = 9.0;
revision.distanceUnit = "ft";
for (var si = 0; si < reconMover.survey.shots.length; si++) {
    var s0 = reconMover.survey.shots[si];
    if ((s0.trip || 0) !== 1) { continue; }
    revision.shots.push(shotOf(s0.from, s0.to, s0.distance,
        s0.azimuth + 7.0, s0.inclination, 0));
}
ok(revision.shots.length === 5, "the revision page holds trip 1's shots");
SurveyNotebook.drawMergedSurvey(null, mover.doc, revision, reconMover,
    false);

var saidFast = false;
for (mi = 0; mi < messages.length; mi++) {
    if (/only this trip was redrawn/.test(messages[mi])) { saidFast = true; }
}
ok(!saidFast, "a page that turns the survey does NOT take the fast path");
eqs(digestOf(mover.doc).tripCount, 3,
    "and the revision replaced its trip rather than adding one");

// ---------------------------------------------------------------------
// A LOADED trip is revised by identity, not by fingerprint.
//
// The fork this closes, reported live on Truitt Cave: load trip 2,
// correct its date and team on the page, press Draw -- and the page no
// longer matched any trip's fingerprint, so it landed as a NEW trip
// while the original stayed behind with its old shots.
// ---------------------------------------------------------------------

var revise = freshDrawing();
getDocument = function() { return revise.doc; };
getDocumentInterface = function() { return revise.di; };
messages = [];

var reconRevise = CsRevise.surveyFromDocument(revise.doc);
eqs(reconRevise.survey.trips.length, 3, "the fixture has three trips");

// The page, as Load from drawing would fill it -- then edited: a new
// date, a new team, and one shot's distance changed.
var loaded = SurveyNotebook.tripSurvey(reconRevise.survey, 1);
loaded.date = "2026-11-11";
loaded.team = "CORRECTED CREW";
loaded.shots[0].distance = 33.3;
var pageW = { loadedTripId: 1 };

SurveyNotebook.drawMergedSurvey(pageW, revise.doc, loaded, reconRevise,
    true);

var afterRevise = CsRevise.surveyFromDocument(revise.doc);
eqs(afterRevise.survey.trips.length, 3,
    "correcting a loaded trip's date and team does NOT fork it");
eqs(afterRevise.survey.trips[1].date, "2026-11-11",
    "trip 1 carries the corrected date");
eqs(afterRevise.survey.trips[1].team, "CORRECTED CREW",
    "trip 1 carries the corrected team");
var reviseCount = 0;
for (var ri = 0; ri < afterRevise.survey.shots.length; ri++) {
    if ((afterRevise.survey.shots[ri].trip || 0) === 1) { reviseCount++; }
}
eqs(reviseCount, 5, "trip 1 still holds its own five shots, not ten");

// The same page WITHOUT the loaded id -- a typed page -- appends,
// which is the behaviour a page nobody loaded should still have.
var typed = freshDrawing();
getDocument = function() { return typed.doc; };
getDocumentInterface = function() { return typed.di; };
var reconTyped = CsRevise.surveyFromDocument(typed.doc);
var typedPage = SurveyNotebook.tripSurvey(reconTyped.survey, 1);
typedPage.date = "2026-11-11";
typedPage.team = "CORRECTED CREW";
SurveyNotebook.drawMergedSurvey({}, typed.doc, typedPage, reconTyped, true);
eqs(CsRevise.surveyFromDocument(typed.doc).survey.trips.length, 4,
    "a page nobody loaded still appends as a new trip");

// ---------------------------------------------------------------------
// THE GHOST LANDS WHERE DRAW LANDS.
// ---------------------------------------------------------------------
//
// The preview drawn while a caver types is only worth anything if it
// is in the same place the shots are about to go. Both now run the
// same two plan functions, and this is what says so: the preview's
// resolved positions are compared, station by station, against the
// positions Draw actually wrote into the drawing.
//
// BOTH PATHS, because they decide their anchor completely differently
// -- the plain one ties into a station by name or floats free, the
// merged one holds the existing drawing where it stands -- and a
// preview that matched only one of them would be wrong exactly half
// the time.

/** A fake panel whose page is this survey. */
function pageWidget(page) {
    return {
        loadedTripId: null,
        _page: page
    };
}
var realSheetSurvey = SurveyNotebook.sheetSurvey;
SurveyNotebook.sheetSurvey = function(w) {
    if (w !== null && w !== undefined && w._page !== undefined) {
        return w._page;
    }
    return realSheetSurvey(w);
};

// --- the merged path: a page added to a drawing that has survey ------
var ghostDoc = freshDrawing();
getDocument = function() { return ghostDoc.doc; };
getDocumentInterface = function() { return ghostDoc.di; };
var ghostPage = pageSurvey("T2S4");
var ghostPlan = SurveyNotebook.previewPlan(pageWidget(ghostPage));
ok(ghostPlan !== null, "ghost: a page over a real drawing has a plan");
ok(ghostPlan.merged === true,
    "ghost: and it takes the merged path, as Draw does");

var ghostSegs = CsGhost.segments(ghostPlan.survey, ghostPlan.resolved);
ok(ghostSegs.legs.length > 0, "ghost: the merged page draws legs");
ok(ghostSegs.walls.length > 0, "ghost: and walls from its LRUD");

// Draw it for real, and compare.
messages = [];
SurveyNotebook.drawMergedSurvey(pageWidget(ghostPage), ghostDoc.doc,
    ghostPage, CsRevise.surveyFromDocument(ghostDoc.doc), true);
var drawnAt = positionsOf(ghostDoc.doc);
var worst = 0;
var checked = 0;
for (var gn in ghostPlan.resolved.stations) {
    if (!ghostPlan.resolved.stations.hasOwnProperty(gn)) { continue; }
    if (drawnAt[gn] === undefined) { continue; }
    var pr = ghostPlan.resolved.stations[gn];
    var dx = Math.abs(pr.x - drawnAt[gn].x);
    var dy = Math.abs(pr.y - drawnAt[gn].y);
    if (dx > worst) { worst = dx; }
    if (dy > worst) { worst = dy; }
    checked++;
}
ok(checked >= 5, "ghost: enough stations to compare (" + checked + ")");
ok(worst < 1e-6,
    "ghost: every previewed station is where Draw put it, to within " +
    worst + " -- the merged path");

// --- the plain path: a page onto an empty drawing --------------------
var emptyDoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var emptyDi = new RDocumentInterface(emptyDoc);
getDocument = function() { return emptyDoc; };
getDocumentInterface = function() { return emptyDi; };
var firstPage = pageSurvey("A1");
var firstPlan = SurveyNotebook.previewPlan(pageWidget(firstPage));
ok(firstPlan !== null, "ghost: a page over an empty drawing has a plan");
eqs(firstPlan.merged, false, "ghost: and takes the plain path");

messages = [];
SurveyNotebook.drawSurvey(pageWidget(firstPage));
var firstDrawn = positionsOf(emptyDoc);
var worstPlain = 0;
var checkedPlain = 0;
for (var fn2 in firstPlan.resolved.stations) {
    if (!firstPlan.resolved.stations.hasOwnProperty(fn2)) { continue; }
    if (firstDrawn[fn2] === undefined) { continue; }
    var fp = firstPlan.resolved.stations[fn2];
    var fdx = Math.abs(fp.x - firstDrawn[fn2].x);
    var fdy = Math.abs(fp.y - firstDrawn[fn2].y);
    if (fdx > worstPlain) { worstPlain = fdx; }
    if (fdy > worstPlain) { worstPlain = fdy; }
    checkedPlain++;
}
ok(checkedPlain >= 5,
    "ghost: enough stations to compare on the plain path (" +
    checkedPlain + ")");
ok(worstPlain < 1e-6,
    "ghost: every previewed station is where Draw put it, to within " +
    worstPlain + " -- the plain path");

// --- and it changes nothing ------------------------------------------
//
// The whole promise of the preview is that Draw is the only thing that
// commits. previewPlan is the half that touches the document, so it is
// the half that has to be provably read-only.
var quietDoc = freshDrawing();
getDocument = function() { return quietDoc.doc; };
getDocumentInterface = function() { return quietDoc.di; };
var beforeDigest = digestOf(quietDoc.doc);
var beforeCount = CsTags.collectStations(quietDoc.doc).length;
for (var rep = 0; rep < 5; rep++) {
    SurveyNotebook.previewPlan(pageWidget(pageSurvey("T2S4")));
}
var afterDigest = digestOf(quietDoc.doc);
eqs(CsTags.collectStations(quietDoc.doc).length, beforeCount,
    "ghost: previewing adds no station to the drawing");
eqs(afterDigest.shots, beforeDigest.shots,
    "ghost: and no shot -- a drawing previewed at five times "
    + "reconstructs to exactly what it did before");
eqs(afterDigest.tripCount, beforeDigest.tripCount,
    "ghost: and no trip");

// An empty page previews nothing rather than throwing.
ok(SurveyNotebook.previewPlan(pageWidget(CsModel.newSurvey())) === null,
    "ghost: a page with no shots has nothing to preview");

SurveyNotebook.sheetSurvey = realSheetSurvey;

// ---------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------

var out;
if (failures.length === 0) {
    out = "### PARTIAL DRAW OK " + passed + " assertions";
} else {
    out = "### PARTIAL DRAW FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var fi = 0; fi < failures.length; fi++) {
        out += "  FAIL: " + failures[fi] + "\n";
    }
}
print(out);
