// warp_anchors_run.js -- symbols and notes follow a non-rigid revision.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/warp_anchors_run.js "$PWD"
//
// CsRevise.moveLinework warped traced LINES per vertex but sent block
// references and text down the old whole-entity rigid path, which
// REFUSES once three or more bound stations stop agreeing -- every real
// adjustment. So the walls moved and the stalactites, labels and
// callouts stayed behind. This pins the repair: a symbol or a note
// warps at its one anchor, turns by the local rotation, and is never
// scaled; a callout moves as one unit on its leader's tip.

if (typeof isNull === "undefined") {
    isNull = function(v) { return v === undefined || v === null; };
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

var failures = [];
function ok(c, what) { if (!c) { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) + ", got " +
        JSON.stringify(a) + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol, what + " (expected " + b + " +/- " + tol +
        ", got " + a + ")");
}

var doc = new RDocument(new RMemoryStorage(), createSpatialIndex());
var di = new RDocumentInterface(doc);
CsLayers.ensureSurveyLayers(doc, di);
var tpl = repoRoot + "/templates/NSS_Cave_Template_PLAN.dxf";
ok(CsSymbolStore.ensureBlock(doc, di, "SYM_STALACTITE", tpl).ok === true,
    "fixture: the symbol block imports from the template");
CsLayers.ensure(doc, di, CsLayers.NOTES_GENERAL);
CsLayers.ensure(doc, di, CsLayers.NORTH_ARROW);

// A cave that shears and bends: not one rigid move explains it, so the
// old residual test fails for any entity bound to three stations.
var oldPos = { A: { x: 0, y: 0 }, B: { x: 50, y: 0 },
    C: { x: 100, y: 0 }, D: { x: 150, y: 0 } };
var newPos = { A: { x: 0, y: 0 }, B: { x: 50, y: 12 },
    C: { x: 100, y: 30 }, D: { x: 150, y: 25 } };
var pairsBCD = [
    { old: oldPos.B, nu: newPos.B }, { old: oldPos.C, nu: newPos.C },
    { old: oldPos.D, nu: newPos.D }];

var op = new RAddObjectsOperation();
function bind(entity, names) {
    CsTags.set(entity, CsBind.STATIONS_TAG, CsBind.encodeStations(names));
}
var block = doc.queryBlock("SYM_STALACTITE");

// 1. a symbol bound to three stations
var ref = new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
    new RVector(70, 5), new RVector(1, 1), 0.3, 1, 1, 1, 1));
ref.setLayerId(doc.getLayerId("FORMATIONS-DRIP"));
bind(ref, ["B", "C", "D"]);
op.addObject(ref, false);

// 2. a note bound to three stations
var txt = new RTextEntity(doc, new RTextData(new RVector(120, 8),
    new RVector(120, 8), 3, 50, RS.VAlignMiddle, RS.HAlignLeft,
    RS.LeftToRight, RS.Exact, 1.0, "NOTE", "standard", false, false, 0.0,
    false));
txt.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
bind(txt, ["B", "C", "D"]);
op.addObject(txt, false);

// 3. a callout: a leader whose tip is at (70, 5), a text at its far end
var pl = new RPolyline();
pl.appendVertex(new RVector(70, 5));
pl.appendVertex(new RVector(95, 25));
var leader = new RLeaderEntity(doc, new RLeaderData(pl, true));
leader.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
CsTags.set(leader, CsCallout.KEY.ID, "k1");
bind(leader, ["B", "C", "D"]);
op.addObject(leader, false);
var ctxt = new RTextEntity(doc, new RTextData(new RVector(95, 25),
    new RVector(95, 25), 3, 50, RS.VAlignMiddle, RS.HAlignLeft,
    RS.LeftToRight, RS.Exact, 1.0, "PIT", "standard", false, false, 0.0,
    false));
ctxt.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
CsTags.set(ctxt, CsCallout.KEY.ID, "k1");
// the text carries NO station tags: the group borrows the leader's
op.addObject(ctxt, false);

// 4. sheet furniture on a world-fixed layer must not move
var arrow = new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
    new RVector(70, 5), new RVector(1, 1), 0, 1, 1, 1, 1));
arrow.setLayerId(doc.getLayerId(CsLayers.NORTH_ARROW));
bind(arrow, ["B", "C", "D"]);
op.addObject(arrow, false);

// 5. a shaped line's ornament is DERIVED: regenerated from its warped
//    spine, so it is not warped on its own as well
var glyph = new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
    new RVector(60, 5), new RVector(1, 1), 0, 1, 1, 1, 1));
glyph.setLayerId(doc.getLayerId("FORMATIONS-DRIP"));
CsTags.set(glyph, CsShapeLine.KEY.DECOR, "spine-1");
bind(glyph, ["B", "C", "D"]);
op.addObject(glyph, false);
di.applyOperation(op);

var result = CsRevise.moveLinework(doc, di, oldPos, newPos, {}, 150);
eqs(result.unmoved.length, 1, "only the derived glyph is left to its " +
    "regeneration (" + JSON.stringify(result) + ")");
ok(result.unmoved[0].indexOf("#" + glyph.getId()) >= 0,
    "and it is the one named");
near(doc.queryEntity(glyph.getId()).getPosition().x, 60, 1e-9,
    "an ornament glyph is not warped on its own");
eqs(result.moved, 3, "the symbol, the note and the callout each moved " +
    "(" + JSON.stringify(result) + ")");

// -- the symbol -------------------------------------------------------
var want = CsWarp.mlsSimilarity({ x: 70, y: 5 }, pairsBCD);
var sym = doc.queryEntity(ref.getId());
near(sym.getPosition().x, want.x, 1e-6, "symbol: x is the warp's own");
near(sym.getPosition().y, want.y, 1e-6, "symbol: y is the warp's own");
near(sym.getRotation(), 0.3 + want.angle, 1e-9,
    "symbol: turned by the local rotation, so it keeps its bearing to " +
    "the passage");
near(sym.getScaleFactors().x, 1.0, 1e-12,
    "symbol: NEVER scaled -- its size is a plotting convention (got " +
    sym.getScaleFactors().x + ", the local factor was " + want.factor + ")");
ok(Math.abs(want.angle) > 1e-3 && Math.abs(want.x - 70) > 1,
    "sanity: this revision genuinely bends the cave here (angle " +
    want.angle + ", shift " + (want.x - 70) + ")");

// -- the note ---------------------------------------------------------
var wantT = CsWarp.mlsSimilarity({ x: 120, y: 8 }, pairsBCD);
var note = doc.queryEntity(txt.getId());
near(note.getPosition().x, wantT.x, 1e-6, "note: x is the warp's own");
near(note.getPosition().y, wantT.y, 1e-6, "note: y is the warp's own");
near(note.getHeight(), 3, 1e-9, "note: its height is untouched");
near(note.getAngle(), 0, 1e-12,
    "note: stays UPRIGHT -- writing slides with the ground and never " +
    "turns, however far the ground turned (the local turn here was " +
    wantT.angle + " rad)");
ok(Math.abs(wantT.angle) > 1e-3, "sanity: and the ground really did turn there");

// -- the callout, as one unit ------------------------------------------
var wantTip = CsWarp.mlsSimilarity({ x: 70, y: 5 }, pairsBCD);
var lead = doc.queryEntity(leader.getId());
var tipNow = lead.getData().getVertexAt(0);
near(tipNow.x, wantTip.x, 1e-6, "callout: the tip lands where the " +
    "feature it points at went (x)");
near(tipNow.y, wantTip.y, 1e-6, "callout: and (y)");
var tail = lead.getData().getVertexAt(1);
var tnow = doc.queryEntity(ctxt.getId()).getPosition();
near(tnow.x, tail.x, 1e-6,
    "callout: the text still sits on the leader's far end (x) -- the " +
    "pair did not tear apart");
near(tnow.y, tail.y, 1e-6, "callout: and (y)");
near(tail.x - tipNow.x, 25, 1e-9,
    "callout: the leader keeps its exact direction (x) -- the pair " +
    "slid, it did not turn");
near(tail.y - tipNow.y, 20, 1e-9, "callout: and (y)");
near(doc.queryEntity(ctxt.getId()).getAngle(), 0, 1e-12,
    "callout: its text stays upright too");

// -- world-fixed furniture ----------------------------------------------
var arrowNow = doc.queryEntity(arrow.getId()).getPosition();
near(arrowNow.x, 70, 1e-9, "sheet furniture: not moved (x)");
near(arrowNow.y, 5, 1e-9, "sheet furniture: not moved (y)");

// -- an unbound callout is reported, not guessed --------------------------
var op2 = new RAddObjectsOperation();
var lone = new RTextEntity(doc, new RTextData(new RVector(10, 10),
    new RVector(10, 10), 3, 50, RS.VAlignMiddle, RS.HAlignLeft,
    RS.LeftToRight, RS.Exact, 1.0, "LOST", "standard", false, false, 0.0,
    false));
lone.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
CsTags.set(lone, CsCallout.KEY.ID, "k2");
op2.addObject(lone, false);
di.applyOperation(op2);
var floating = new RTextEntity(doc, new RTextData(new RVector(900, 900),
    new RVector(900, 900), 3, 50, RS.VAlignMiddle, RS.HAlignLeft,
    RS.LeftToRight, RS.Exact, 1.0, "ADRIFT", "standard", false, false, 0.0,
    false));
floating.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
var op3 = new RAddObjectsOperation();
op3.addObject(floating, false);
di.applyOperation(op3);
var again = CsRevise.moveLinework(doc, di, oldPos, newPos, {}, 150);
ok(again.untied.length === 1 && again.untied[0].indexOf("#" + floating.getId()) >= 0,
    "a plan item tied to no station is NAMED as untied, not skipped in " +
    "silence (" + JSON.stringify(again.untied) + ")");
var said = CsRevise.lineworkSummary(5, [], 0, true, 0, again.untied).join("\n");
ok(said.indexOf("NOTES-GENERAL x1") >= 0 && said.indexOf("did NOT move") >= 0,
    "and the summary says which layer and how many:\n" + said);
ok(again.unmoved.length >= 1 &&
    again.unmoved[0].indexOf("callout") >= 0,
    "a callout bound to nothing is left and reported by name (" +
    JSON.stringify(again) + ")");


// -- the far tier: a symbol in the middle of a wide room -----------------
// Found on Truitt Cave: floor-slope symbols 20-37 ft from the nearest
// station bound to nothing and sat still through every revision.
var farIdx = [{ name: "S1", x: 0, y: 0 }, { name: "S2", x: 10, y: 0 },
    { name: "S3", x: 20, y: 0 }, { name: "S4", x: 30, y: 0 }];
var margin = CsBind.marginFor(farIdx);
var roomY = margin * 3;   // well outside the margin, well inside the reach
var op4 = new RAddObjectsOperation();
var roomSym = new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
    new RVector(15, roomY), new RVector(1, 1), 0, 1, 1, 1, 1));
roomSym.setLayerId(doc.getLayerId("FORMATIONS-DRIP"));
op4.addObject(roomSym, false);
var lostSym = new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
    new RVector(15, margin * (CsBind.FAR_FACTOR + 2)), new RVector(1, 1), 0, 1, 1, 1, 1));
lostSym.setLayerId(doc.getLayerId("FORMATIONS-DRIP"));
op4.addObject(lostSym, false);
di.applyOperation(op4);
var roomBind = CsBind.bindEntity(doc, doc.queryEntity(roomSym.getId()), null,
    farIdx, 0.001, null);
eqs(roomBind.source, "far", "far: a symbol past the margin binds by the nearest stations");
eqs(roomBind.stations.length, CsBind.FAR_COUNT,
    "far: to the nearest " + CsBind.FAR_COUNT);
ok(roomBind.stations.indexOf("S2") >= 0 && roomBind.stations.indexOf("S3") >= 0,
    "far: the stations it binds to are the ones nearest it (" +
    JSON.stringify(roomBind.stations) + ")");
var lostBind = CsBind.bindEntity(doc, doc.queryEntity(lostSym.getId()), null,
    farIdx, 0.001, null);
eqs(lostBind.stations.length, 0,
    "far: past the reach it is left unbound -- and the revision report names it");

// -- a station note the Notebook drew is the suite's own output ----------
var opN = new RAddObjectsOperation();
var noteLeader = new RLeaderEntity(doc, new RLeaderData(function() {
    var q = new RPolyline(); q.appendVertex(new RVector(10, 10));
    q.appendVertex(new RVector(20, 20)); return q; }(), true));
noteLeader.setLayerId(doc.getLayerId(CsLayers.NOTES_GENERAL));
CsTags.set(noteLeader, CsCallout.KEY.ID, "suite-note");
CsTags.set(noteLeader, "NoteLeader", "A1");
opN.addObject(noteLeader, false);
di.applyOperation(opN);
var noteRun = CsRevise.moveLinework(doc, di, oldPos, newPos, {}, 150);
ok(JSON.stringify(noteRun.unmoved).indexOf("suite-note") < 0,
    "a Notebook station note is redrawn by Draw, so it is not reported " +
    "as an unmoved callout (" + JSON.stringify(noteRun.unmoved) + ")");


// -- cross sections and elevation labels are cut on a LEG ------------------
// They say which in their own tags, and follow that leg's stations
// exactly -- a sketch's block follows its station, and its leader (which
// CalloutWrite.refreshSections has already re-aimed there) is not
// carried a second time.
CsLayers.ensure(doc, di, CsLayers.NOTES_ANNOTATION);
var opS = new RAddObjectsOperation();
function member(entity, id, role, kind, extra) {
    entity.setLayerId(doc.getLayerId(CsLayers.NOTES_ANNOTATION));
    CsTags.set(entity, CsCallout.KEY.ID, id);
    CsTags.set(entity, CsCallout.KEY.ROLE, role);
    if (kind !== "") { CsTags.set(entity, CsCallout.KEY.KIND, kind); }
    for (var k in extra) { if (extra.hasOwnProperty(k)) { CsTags.set(entity, k, extra[k]); } }
    opS.addObject(entity, false);
    return entity;
}
function leaderOf(x1, y1, x2, y2) {
    var q = new RPolyline(); q.appendVertex(new RVector(x1, y1)); q.appendVertex(new RVector(x2, y2));
    return new RLeaderEntity(doc, new RLeaderData(q, true));
}
function blockAt(x, y) {
    return new RBlockReferenceEntity(doc, new RBlockReferenceData(block.getId(),
        new RVector(x, y), new RVector(1, 1), 0, 1, 1, 1, 1));
}
// computed section: cut half way along B-C
var secBlock = member(blockAt(75, 40), "sec1", CsCallout.ROLE_BLOCK, CsCallout.KIND_SECTION,
    { SectionFrom: "B", SectionTo: "C", SectionFraction: "0.5" });
var secLead = member(leaderOf(75, 0, 75, 40), "sec1", CsCallout.ROLE_LEADER, "", {});
// traced section: leadered to station C; its leader tip ALREADY re-aimed at C's new place
var skBlock = member(blockAt(100, 60), "sec2", CsCallout.ROLE_BLOCK, CsCallout.KIND_SECTION,
    { SectionStationRef: "C", SectionSource: CsCallout.SOURCE_SKETCH });
var skLead = member(leaderOf(100, 30, 100, 60), "sec2", CsCallout.ROLE_LEADER, "", {});
// elevation label sampled a quarter of the way along C-D
var elText = member(new RTextEntity(doc, new RTextData(new RVector(112.5, 20),
    new RVector(112.5, 20), 3, 50, RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight,
    RS.Exact, 1.0, "+4 FT", "standard", false, false, 0.0, false)),
    "elev1", CsCallout.ROLE_TEXT, CsCallout.KIND_ELEV,
    { ElevFrom: "C", ElevTo: "D", ElevFraction: "0.25" });
var elLead = member(leaderOf(112.5, 0, 112.5, 18), "elev1", CsCallout.ROLE_LEADER, "", {});
di.applyOperation(opS);
var legRun = CsRevise.moveLinework(doc, di, oldPos, newPos, {}, 150);
eqs(legRun.moved >= 3, true, "the three leg-cut callouts all moved (" + JSON.stringify(legRun) + ")");
function at(e) { return doc.queryEntity(e.getId()).getPosition(); }
function tipOf(e) { return doc.queryEntity(e.getId()).getData().getVertexAt(0); }
// computed section: lerp(B,C,.5) went (75,0) -> (75,21)
near(at(secBlock).x, 75, 1e-9, "section: block x is the cut point's");
near(at(secBlock).y, 40 + 21, 1e-9, "section: block slid exactly as far as the cut point (21)");
near(tipOf(secLead).y, 21, 1e-9, "section: its leader tip is on the new cut point");
// traced section: C moved (100,0) -> (100,30), so the block goes up 30; the leader stays
near(at(skBlock).y, 60 + 30, 1e-9, "traced section: the block follows its station (30)");
near(tipOf(skLead).y, 30, 1e-9,
    "traced section: its leader is NOT carried a second time (refreshSections owns it)");
// elevation label: lerp(C,D,.25) went (112.5,0) -> (112.5,28.75)
near(at(elText).y, 20 + 28.75, 1e-9, "elevation label: slid with its leg (28.75)");
near(tipOf(elLead).y, 28.75, 1e-9, "elevation label: and its leader tip with it");
near(doc.queryEntity(elText.getId()).getAngle(), 0, 1e-12, "elevation label: upright");

if (failures.length === 0) {
    print("### WARP ANCHORS OK");
} else {
    print("### WARP ANCHORS FAIL " + failures.length);
    for (var i = 0; i < failures.length; i++) {
        print("  FAIL: " + failures[i]);
    }
}
