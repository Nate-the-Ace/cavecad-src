// callout_sync.js -- CsCalloutSync against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon \
//       -no-gui -allow-multiple-instances -autostart \
//       tests/callout_sync.js "$PWD"
//
// Prints "### CALLOUT-SYNC OK <n>" or "### CALLOUT-SYNC FAIL".
//
// Separate from callout_write.js because it exercises a COMMAND's own
// logic (reflow-all, duplicate repair, refusal reporting) rather than
// the write layer beneath it.

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
    // INDIRECT eval: a direct eval() inside this function scopes every
    // Cs* global into it, and they vanish the moment it returns.
    (0, eval)(src);
}

// The bare -autostart engine does not preload library.js.
if (typeof isNull === "undefined") {
    isNull = function(v) {
        return v === undefined || v === null ||
            (typeof v.isNull === "function" && v.isNull());
    };
}
if (typeof qsTr === "undefined") {
    qsTr = function(s) { return s; };
}

var FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    "scripts/CaveSurvey/Core/CsLayers.js",
    "scripts/CaveSurvey/Core/CsModel.js",
    "scripts/CaveSurvey/Core/CsAngles.js",
    "scripts/CaveSurvey/Core/CsTraverse.js",
    "scripts/CaveSurvey/Core/CsNetwork.js",
    "scripts/CaveSurvey/Core/CsLrud.js",
    "scripts/CaveSurvey/Core/CsPitch.js",
    "scripts/CaveSurvey/Core/CsProfile.js",
    "scripts/CaveSurvey/Core/CsProject.js",
    "scripts/CaveSurvey/Core/CsChunk.js",
    "scripts/CaveSurvey/Core/CsDraw.js",
    "scripts/CaveSurvey/Core/CsCallout.js",
    "scripts/CaveSurvey/Core/CsElevation.js",
    "scripts/CaveSurvey/Callout/CalloutWrite.js"
];
for (var fi = 0; fi < FILES.length; fi++) {
    loadRepoScript(FILES[fi]);
}

// CsCalloutSync.js includes CalloutWrite.js itself (Core files normally
// don't reach outside Core, but this engine has no other way to get the
// QCAD-shaped writes it makes) -- the bare engine has no include(), and
// CalloutWrite is already loaded above via FILES, so strip that one line
// before eval rather than loading it a second time under a function that
// doesn't exist here.
(function() {
    var file = new QFile(repoRoot + "/scripts/CaveSurvey/Core/CsCalloutSync.js");
    if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open CsCalloutSync.js");
    }
    var stream = new QTextStream(file);
    var src = stream.readAll();
    file.close();
    src = src.replace(/^include\(.*$/gm, "");
    (0, eval)(src);
})();

// CalloutListener has no include()s and no EAction plumbing in its
// static half, so it loads directly. install() is NOT exercised here --
// it needs a real main window with a document open -- but reconcile()
// takes doc and di explicitly precisely so it can be driven from here.
loadRepoScript("scripts/CaveSurvey/Callout/CalloutListener.js");

var passed = 0;
var failures = [];
function ok(c, what) { if (c) { passed++; } else { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + b + ", got " + a + ")");
}
function near(a, b, tol, what) {
    ok(Math.abs(a - b) <= tol,
        what + " (expected " + b + " +/- " + tol + ", got " + a + ")");
}

var di = new RDocumentInterface(new RDocument(new RMemoryStorage(),
                                              new RSpatialIndexNavel()));
var doc = di.getDocument();
getDocument = function() { return doc; };
CsLayers.ensureCalloutLayers(doc, di);

// ---------------------------------------------------------------------
// Reflow after the text has moved -- the whole point of the command.
// ---------------------------------------------------------------------
var id = CalloutWrite.create(doc, di, {
    text: "moved note", position: { x: 100, y: 100 },
    tips: [{ x: 60, y: 90 }, { x: 70, y: 120 }],
    style: "hazard", kind: CsCallout.KIND_TEXT,
    height: CalloutWrite.textHeight(doc)
});

(function() {
    var m = CalloutWrite.members(doc, id);
    var td = m.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 300, was.y + 200));
    td.setAlignmentPoint(new RVector(was.x + 300, was.y + 200));
    m.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(m.text, false);
    di.applyOperation(mop);

    var report = CsCalloutSync.run(doc, di);
    ok(report.indexOf("Reflowed 1") >= 0,
        "run() reports one callout reflowed (got: " +
        report.split("\n")[0] + ")");

    var after = CalloutWrite.members(doc, id);
    var box = CalloutWrite.boxOf(after.text);
    for (var i = 0; i < after.leaders.length; i++) {
        var d = after.leaders[i].getData();
        var last = d.getVertexAt(d.countVertices() - 1);
        ok(last.x >= box.x1 - 1e-6 && last.x <= box.x2 + 1e-6 &&
           last.y >= box.y1 - 1e-6 && last.y <= box.y2 + 1e-6,
            "leader " + i + " landed back on the MOVED note");
    }
    // Assert the SET of tips, not leaders[0]: members() reads through
    // queryAllEntities, which is not insertion-ordered, so "the first
    // leader" is whichever the query returned first.
    var tipX = [];
    for (var t = 0; t < after.leaders.length; t++) {
        tipX.push(after.leaders[t].getData().getVertexAt(0).x);
    }
    tipX.sort(function(a, b) { return a - b; });
    eqs(tipX.length, 2, "both arrows are still there");
    near(tipX[0], 60, 1e-6, "and neither TIP moved with the note (60)");
    near(tipX[1], 70, 1e-6, "nor the other (70)");
})();

// ---------------------------------------------------------------------
// A curved leader must still be curved after a sync.
// ---------------------------------------------------------------------
(function() {
    var cid = CalloutWrite.create(doc, di, {
        text: "curvy", position: { x: 500, y: 100 },
        tips: [{ x: 460, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        leader: CsCallout.LEADER_CURVED,
        height: CalloutWrite.textHeight(doc)
    });
    var vBefore = CalloutWrite.members(doc, cid).leaders[0]
        .getData().countVertices();
    CsCalloutSync.run(doc, di);
    var d = CalloutWrite.members(doc, cid).leaders[0].getData();
    // Curves are traced as SEGMENTS, not carried as a bulge: an arc is
    // destroyed by a DXF save (the exporter drops the arc's start vertex,
    // which is the arrow tip). So "still curved" means "still has its
    // extra vertices", not "still has a bulge".
    ok(d.countVertices() > 3,
        "a curved leader is STILL curved after a sync, not straightened " +
        "(got " + d.countVertices() + " vertices)");
    eqs(d.countVertices(), vBefore,
        "and traced at the same resolution as when it was placed");
})();

// ---------------------------------------------------------------------
// Duplicate ids -- what copy/paste does, and what no id scheme prevents.
// ---------------------------------------------------------------------
(function() {
    var aId = CalloutWrite.create(doc, di, {
        text: "twin", position: { x: 900, y: 900 },
        tips: [{ x: 860, y: 890 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });

    // Forge the collision the way a paste produces it: a second text and
    // leader carrying the SAME id, well away from the first.
    var op = new RAddObjectsOperation();
    var at = new RVector(1200, 1200);
    var td = new RTextData(at, at, CalloutWrite.textHeight(doc), 100.0,
        RS.VAlignMiddle, RS.HAlignLeft, RS.LeftToRight, RS.Exact,
        1.0, "twin", "standard", false, false, 0.0, false);
    var t2 = new RTextEntity(doc, td);
    t2.setLayerId(doc.getLayerId(CsLayers.NOTES_NAME));
    CsTags.set(t2, CsCallout.KEY.ID, aId);
    CsTags.set(t2, CsCallout.KEY.ROLE, CsCallout.ROLE_TEXT);
    CsTags.set(t2, CsCallout.KEY.STYLE, "name");
    CsTags.set(t2, CsCallout.KEY.LEADER, CsCallout.LEADER_STRAIGHT);
    op.addObject(t2, false);

    var pl = new RPolyline();
    pl.appendVertex(new RVector(1160, 1190), 0.0);
    pl.appendVertex(new RVector(1198, 1200), 0.0);
    pl.appendVertex(new RVector(1200, 1200), 0.0);
    var l2 = new RLeaderEntity(doc, new RLeaderData(pl, true));
    l2.setLayerId(doc.getLayerId(CsLayers.NOTES_NAME));
    CsTags.set(l2, CsCallout.KEY.ID, aId);
    CsTags.set(l2, CsCallout.KEY.ROLE, CsCallout.ROLE_LEADER);
    op.addObject(l2, false);
    di.applyOperation(op);

    eqs(CsCalloutSync.textsById(doc)[aId].length, 2,
        "the forged paste really does leave two texts on one id");

    var rekeyed = CsCalloutSync.rekeyDuplicates(doc, di);
    eqs(rekeyed, 1, "rekeyDuplicates repairs exactly one of the pair");

    var byId = CsCalloutSync.textsById(doc);
    eqs(byId[aId].length, 1,
        "the ORIGINAL id is now held by exactly one text");

    // Find the copy through the DOCUMENT, not through the t2 handle.
    // t2 is the pre-add script-side object: its entity id was never set
    // and its tags do not follow a later modify, so reading it back
    // would test the handle rather than the drawing. (This is also why
    // rekeyDuplicates sorts live entities by getId() and not these.)
    var copyId = null;
    var allIds = doc.queryAllEntities(false, true);
    for (var z = 0; z < allIds.length; z++) {
        var ez = doc.queryEntity(allIds[z]);
        if (isNull(ez) ||
                CsTags.get(ez, CsCallout.KEY.ROLE) !== CsCallout.ROLE_TEXT) {
            continue;
        }
        var bz = CalloutWrite.boxOf(ez);
        if (bz.x1 > 1100 && bz.y2 > 1100) {     // the forged copy
            copyId = CsTags.get(ez, CsCallout.KEY.ID);
        }
    }
    ok(copyId !== null, "the copy is findable in the drawing");
    ok(CsUuid.isValid(copyId), "the copy got a valid fresh id");
    ok(copyId !== aId,
        "which is NOT the original's -- the ORIGINAL keeps its id, " +
        "because rekeyDuplicates sorts by entity id and the paste is " +
        "younger");
    eqs(CalloutWrite.members(doc, copyId).leaders.length, 1,
        "and the arrow NEAREST the copy went with it, not with the original");
    eqs(CalloutWrite.members(doc, aId).leaders.length, 1,
        "the original kept its own arrow");
})();

// ---------------------------------------------------------------------
// A locked layer must be REPORTED, never silently skipped.
// ---------------------------------------------------------------------
(function() {
    var lay = doc.queryLayer(CsLayers.NOTES_HAZARD);
    if (isNull(lay)) {
        return;
    }
    lay.setLocked(true);
    var lop = new RModifyObjectsOperation();
    lop.addObject(lay, false);
    di.applyOperation(lop);

    var report = CsCalloutSync.run(doc, di);
    ok(report.indexOf("Could not update") >= 0,
        "a locked layer is named in the report, not silently skipped");
    ok(report.indexOf("LOCKED") >= 0,
        "and the reason names the LOCK specifically, so the caver knows " +
        "what to unlock");

    lay.setLocked(false);
    var uop = new RModifyObjectsOperation();
    uop.addObject(lay, false);
    di.applyOperation(uop);
})();

// ---------------------------------------------------------------------
// CalloutListener.reconcile -- the live-glue decisions.
//
// install() and the transaction handler need a main window with a
// document open and cannot run here. reconcile() is the part that
// decides what happens, and it takes doc/di explicitly so it can.
// ---------------------------------------------------------------------

// --- a moved note: reflow, in the caller's undo group ----------------
(function() {
    var rid = CalloutWrite.create(doc, di, {
        text: "listener reflow", position: { x: 2000, y: 100 },
        tips: [{ x: 1960, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, rid);
    var td = m.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 200, was.y + 150));
    td.setAlignmentPoint(new RVector(was.x + 200, was.y + 150));
    m.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(m.text, false);
    di.applyOperation(mop);

    eqs(CalloutListener.reconcile(doc, di, rid, -1), "reflowed",
        "reconcile reflows a callout whose note moved");
    var after = CalloutWrite.members(doc, rid);
    var box = CalloutWrite.boxOf(after.text);
    var last = after.leaders[0].getData();
    var end = last.getVertexAt(last.countVertices() - 1);
    ok(end.x >= box.x1 - 1e-6 && end.x <= box.x2 + 1e-6,
        "and the arrow landed back on the moved note");
})();

// --- the note deleted: its orphaned arrows go with it ----------------
(function() {
    var oid = CalloutWrite.create(doc, di, {
        text: "doomed", position: { x: 2500, y: 100 },
        tips: [{ x: 2460, y: 90 }, { x: 2470, y: 130 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, oid);
    var del = new RDeleteObjectsOperation();
    del.deleteObject(m.text);
    di.applyOperation(del);

    eqs(CalloutWrite.members(doc, oid).leaders.length, 2,
        "fixture: deleting the note leaves both arrows orphaned");
    eqs(CalloutListener.reconcile(doc, di, oid, -1), "orphans-removed",
        "reconcile removes arrows that point at nothing");
    eqs(CalloutWrite.members(doc, oid).leaders.length, 0,
        "and they are actually gone");
})();

// --- the LAST arrow deleted: the note SURVIVES -----------------------
// Asymmetric with the case above, on purpose. A note without an arrow is
// still a note; deleting a caver's words because they deleted an arrow
// would destroy work they never asked to lose.
(function() {
    var kid = CalloutWrite.create(doc, di, {
        text: "keep my words", position: { x: 3000, y: 100 },
        tips: [{ x: 2960, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var m = CalloutWrite.members(doc, kid);
    var textId = m.text.getId();
    var del = new RDeleteObjectsOperation();
    del.deleteObject(m.leaders[0]);
    di.applyOperation(del);

    eqs(CalloutListener.reconcile(doc, di, kid, -1), "unlinked",
        "reconcile unlinks a note whose last arrow was deleted");

    var survivor = doc.queryEntity(textId);
    ok(!isNull(survivor),
        "THE NOTE SURVIVES -- it is not deleted along with its arrow");
    eqs(CsTags.get(survivor, CsCallout.KEY.ID), "",
        "and its callout tags are stripped, so it is ordinary text now");
    eqs(CalloutWrite.members(doc, kid).text, null,
        "so the callout no longer exists as a callout");
})();

// --- the gate: a transaction touching no callout is a no-op ---------
(function() {
    var before = doc.queryAllEntities(false, true).length;
    var lid = CalloutWrite.create(doc, di, {
        text: "bystander", position: { x: 3500, y: 100 },
        tips: [{ x: 3460, y: 90 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    // an id nothing carries
// --- a SECTION's content is a BLOCK, not text ------------------------
// The regression this file exists to keep closed. reconcile used to ask
// "is m.text null?" to decide whether the leaders were orphans. A cross
// section has no text -- its content is a block reference -- so every
// sketched section read as a note whose words had been deleted, and the
// listener removed the leader Capture had just written. Silently:
// section placed, leader gone, no message. Found in a caver's drawing,
// where the section block still carried its CalloutId and nothing else
// in the file did.
(function() {
    var sid = CsUuid.v4();
    var blockName = "CS_" + sid;
    var block = new RBlock(doc, blockName, new RVector(0, 0));
    di.applyOperation(new RAddObjectOperation(block, false));
    var blockId = doc.getBlockId(blockName);

    var op = new RAddObjectsOperation();
    var ref = new RBlockReferenceEntity(doc,
        new RBlockReferenceData(blockId, new RVector(2800, 100),
            new RVector(1, 1), 0));
    CsTags.set(ref, CsCallout.KEY.ID, sid);
    CsTags.set(ref, CsCallout.KEY.ROLE, CsCallout.ROLE_BLOCK);
    CsTags.set(ref, CsCallout.KEY.KIND, CsCallout.KIND_SECTION);
    CsTags.set(ref, CsCallout.KEY.STYLE, "annotation");
    CsTags.set(ref, CsCallout.KEY.SECTION_SOURCE, CsCallout.SOURCE_SKETCH);
    CsTags.set(ref, CsCallout.KEY.SECTION_STATION, "A4");
    op.addObject(ref, false);
    CalloutWrite.oneLeader(doc, op, sid,
        { x: 2760, y: 90 }, { x: 2800, y: 100 }, "annotation",
        CsCallout.STYLES["annotation"]);
    di.applyOperation(op);

    var sm = CalloutWrite.members(doc, sid);
    eqs(sm.text, null, "fixture: a section callout has no text member");
    ok(sm.block !== null, "fixture: it has a block member");
    eqs(sm.leaders.length, 1, "fixture: and one leader");

    eqs(CalloutListener.reconcile(doc, di, sid, -1), "reflowed",
        "reconcile treats a section's block as its content");
    eqs(CalloutWrite.members(doc, sid).leaders.length, 1,
        "and the section's leader SURVIVES -- it is not an orphan");

    // The other half of the asymmetry: a section whose last leader is
    // deleted keeps its tags. Unlinking it would strip SectionSource
    // and SectionStation, which Edit Sketch and regeneration read.
    var sm2 = CalloutWrite.members(doc, sid);
    var del2 = new RDeleteObjectsOperation();
    del2.deleteObject(sm2.leaders[0]);
    di.applyOperation(del2);
    eqs(CalloutListener.reconcile(doc, di, sid, -1), "nothing",
        "a section with no leader is left alone, not unlinked");
    eqs(CsTags.get(CalloutWrite.members(doc, sid).block,
        CsCallout.KEY.SECTION_SOURCE), CsCallout.SOURCE_SKETCH,
        "and it keeps the provenance regeneration needs");
})();

    eqs(CalloutListener.reconcile(doc, di, CsUuid.v4(), -1), "nothing",
        "reconcile on an id no entity carries does nothing at all");
    ok(CalloutWrite.members(doc, lid).text !== null,
        "and the real callout beside it is untouched");
})();

// ---------------------------------------------------------------------
// A REFLOW THAT CHANGES NOTHING MUST WRITE NOTHING.
//
// This is the regression guard for a FREEZE. writeLeaders used to delete
// and re-add every leader unconditionally, so an unchanged callout still
// produced transactions -- and CalloutListener hears every transaction,
// so each pointless rewrite fired it again. Committing a label locked up
// CaveCAD. The busy flag only guards a synchronous re-entry; a queued
// signal arrives after it is cleared.
// ---------------------------------------------------------------------
(function() {
    var iid = CalloutWrite.create(doc, di, {
        text: "no-op reflow", position: { x: 4000, y: 100 },
        tips: [{ x: 3960, y: 90 }, { x: 3970, y: 130 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });

    function leaderIdSig() {
        var mm = CalloutWrite.members(doc, iid);
        var out = [];
        for (var i = 0; i < mm.leaders.length; i++) {
            out.push(mm.leaders[i].getId());
        }
        out.sort(function(a, b) { return a - b; });
        return out.join(",");
    }

    var sig0 = leaderIdSig();
    CalloutWrite.applyReflow(doc, di, iid, null);
    var sig1 = leaderIdSig();
    CalloutWrite.applyReflow(doc, di, iid, null);
    var sig2 = leaderIdSig();

    eqs(sig1, sig0,
        "reflowing an UNCHANGED callout replaces no entities (ids " +
        sig0 + " -> " + sig1 + ")");
    eqs(sig2, sig0, "and again, so the cycle cannot run away");

    // ...but a reflow that SHOULD write still does. Without this, the
    // fix above could be "never write" and the guard would still pass.
    var mm = CalloutWrite.members(doc, iid);
    var td = mm.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 250, was.y));
    td.setAlignmentPoint(new RVector(was.x + 250, was.y));
    mm.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(mm.text, false);
    di.applyOperation(mop);

    CalloutWrite.applyReflow(doc, di, iid, null);
    ok(leaderIdSig() !== sig0,
        "a reflow that IS needed still rewrites the leaders");

    var box = CalloutWrite.boxOf(CalloutWrite.members(doc, iid).text);
    var after = CalloutWrite.members(doc, iid).leaders;
    for (var k = 0; k < after.length; k++) {
        var d = after[k].getData();
        var end = d.getVertexAt(d.countVertices() - 1);
        ok(end.x >= box.x1 - 1e-6 && end.x <= box.x2 + 1e-6,
            "and leader " + k + " landed on the moved note");
    }
})();

// ---------------------------------------------------------------------
// ELEVATION LABELS TRACK A REVISION.
//
// A label is a snapshot of the floor at one point at one moment. Correct
// a reading or add a D that was missing and the number on the map is a
// lie still looking authoritative. Every draw re-derives them from the
// leg and fraction each one stores; so does CsCalloutSync.run.
// ---------------------------------------------------------------------
(function() {
    function shotOf(from, to, d, az, inc) {
        var sh = CsModel.newShot();
        sh.from = from; sh.to = to;
        sh.distance = d; sh.azimuth = az;
        sh.inclination = inc || 0;
        return sh;
    }
    // A1 --100--> A2 --100--> A3. `withD` decides whether A3 has a floor
    // reading at all, which is what an upgrade turns on.
    function build(withD) {
        var sv = CsModel.newSurvey();
        var s1 = shotOf("A1", "A2", 100, 90, 0);
        s1.down = withD ? 5 : null;
        var s2 = shotOf("A2", "A3", 100, 90, 0);
        s2.down = withD ? 3 : null;
        sv.shots.push(s1); sv.shots.push(s2);
        var res = CsNetwork.resolve(sv,
            { anchor: { name: "A1", x: 0, y: 0, z: 1000 } });
        return { survey: sv, resolved: res };
    }

    var noD = build(false);
    var a2 = noD.resolved.stations["A2"], a3 = noD.resolved.stations["A3"];
    var mid = { x: (a2.x + a3.x) / 2.0, y: (a2.y + a3.y) / 2.0 };

    // sample with NO D: a survey-line stand-in
    var lineSample = CsElevation.sampleFloor(noD.survey, noD.resolved,
                                             mid, {});
    eqs(lineSample.basis, "line",
        "fixture: with no D the sample is a survey-line stand-in");

    var eid = CalloutWrite.create(doc, di, {
        text: CsCallout.elevLabel(lineSample, "'"),
        position: { x: mid.x + 20, y: mid.y + 20 },
        tips: [{ x: mid.x, y: mid.y }],
        style: CsCallout.elevStyle(lineSample),
        kind: CsCallout.KIND_ELEV,
        tags: CalloutWrite.elevTags(lineSample),
        height: CalloutWrite.textHeight(doc)
    });
    var em = CalloutWrite.members(doc, eid);
    ok(em.text.getData().getText().indexOf("LINE") >= 0,
        "it starts as a LINE stand-in, and says so");
    eqs(doc.getLayerName(em.text.getLayerId()),
        CsCallout.STYLES["elevation-line"], "on the muted fallback layer");

    // NOW the D exists -- the revision a caver just entered
    var withD = build(true);
    var r1 = CalloutWrite.refreshElevations(doc, di, withD.survey,
                                            withD.resolved);
    eqs(r1.upgraded, 1,
        "refresh UPGRADES the stand-in to a measured floor");

    var after = CalloutWrite.members(doc, eid);
    var newText = after.text.getData().getText();
    ok(newText.indexOf("LINE") < 0,
        "the LINE warning is gone from the label (now " +
        JSON.stringify(newText) + ")");
    eqs(CsTags.get(after.text, CsCallout.KEY.ELEV_BASIS), "floor",
        "and its recorded basis is now floor");
    eqs(doc.getLayerName(after.text.getLayerId()),
        CsCallout.STYLES["elevation"],
        "and it MOVED to the measured layer -- left on the muted one it " +
        "would keep telling the reader it was a guess");

    // the arrows must have followed the new text
    var abox = CalloutWrite.boxOf(after.text);
    var aend = after.leaders[0].getData();
    var alast = aend.getVertexAt(aend.countVertices() - 1);
    ok(alast.x >= abox.x1 - 1e-6 && alast.x <= abox.x2 + 1e-6,
        "and the arrow re-attached to the relabelled note");

    // idempotent: refreshing again changes nothing
    var r2 = CalloutWrite.refreshElevations(doc, di, withD.survey,
                                            withD.resolved);
    eqs(r2.upgraded, 0, "refreshing again upgrades nothing");
    eqs(r2.unchanged, 1, "it reports the label as unchanged");

    // --- A HAND-EDITED LABEL IS NEVER OVERWRITTEN -------------------
    var mine = "1234.5' I MEASURED THIS";
    var htd = after.text.getData();
    htd.setText(mine);
    after.text.setData(htd);
    var hop = new RModifyObjectsOperation();
    hop.addObject(after.text, false);
    di.applyOperation(hop);

    var r3 = CalloutWrite.refreshElevations(doc, di, withD.survey,
                                            withD.resolved);
    eqs(r3.updated + r3.upgraded + r3.downgraded, 0,
        "a hand-edited label is not rewritten");
    eqs(CalloutWrite.members(doc, eid).text.getData().getText(), mine,
        "the caver's own words survive -- they were standing in the " +
        "passage and the computed number was not");

    // --- THE PARTIAL-SURVEY TRAP -----------------------------------
    // SurveyNotebook draws ONE PAGE at a time, so a draw hook holding
    // that page's survey sees only its stations. Refreshing against it
    // reported every label on another page as "lost" and re-derived this
    // page's against a partial network, where a boundary label can lose
    // its D and spuriously downgrade. This pins the mechanism: the same
    // label, refreshed against a survey that does not contain its leg,
    // is reported lost -- which is why the draw hook must read the whole
    // drawing instead.
    (function() {
        // A FRESH label, not the hand-edited one above: hand-edit
        // protection is checked before the leg lookup, so a protected
        // label would report "unchanged" and never exercise this.
        var freshSample = CsElevation.sampleFloor(withD.survey,
            withD.resolved, mid, {});
        var pid = CalloutWrite.create(doc, di, {
            text: CsCallout.elevLabel(freshSample, "'"),
            position: { x: mid.x + 60, y: mid.y + 60 },
            tips: [{ x: mid.x, y: mid.y }],
            style: CsCallout.elevStyle(freshSample),
            kind: CsCallout.KIND_ELEV,
            tags: CalloutWrite.elevTags(freshSample),
            height: CalloutWrite.textHeight(doc)
        });
        var wasText = CalloutWrite.members(doc, pid).text.getData().getText();

        var other = CsModel.newSurvey();
        var o1 = shotOf("Z1", "Z2", 50, 0, 0);
        o1.down = 2;
        other.shots.push(o1);
        var oRes = CsNetwork.resolve(other,
            { anchor: { name: "Z1", x: 5000, y: 5000, z: 500 } });

        var partial = CalloutWrite.refreshElevations(doc, di, other, oRes);
        ok(partial.lost >= 1,
            "refreshed against a survey WITHOUT the label's leg, the " +
            "label is reported LOST -- the exact mis-report a page-only " +
            "draw hook produced (lost=" + partial.lost + ")");
        eqs(partial.updated, 0,
            "and nothing is re-derived from a network that does not " +
            "contain the leg");
        eqs(CalloutWrite.members(doc, pid).text.getData().getText(), wasText,
            "and a mis-report never rewrites the label");

        // against the FULL survey the same label re-derives normally
        var full = CalloutWrite.refreshElevations(doc, di, withD.survey,
                                                  withD.resolved);
        eqs(full.lost, 0,
            "against the whole survey nothing is lost -- which is why " +
            "the draw hook reads the drawing rather than the page");
    })();

    // --- a label whose leg is GONE is reported, not guessed ----------
    var orphanTags = CalloutWrite.elevTags({
        z: 999, basis: CsCallout.BASIS_FLOOR,
        from: "ZZ9", to: "ZZ10", fraction: 0.5, multi: false
    });
    var oid = CalloutWrite.create(doc, di, {
        text: CsCallout.elevLabel({ z: 999, basis: "floor", multi: false }, "'"),
        position: { x: 8000, y: 8000 },
        tips: [{ x: 7960, y: 7990 }],
        style: "elevation", kind: CsCallout.KIND_ELEV,
        tags: orphanTags, height: CalloutWrite.textHeight(doc)
    });
    var r4 = CalloutWrite.refreshElevations(doc, di, withD.survey,
                                            withD.resolved);
    ok(r4.lost >= 1,
        "a label whose leg has left the survey is COUNTED as lost");
    eqs(CalloutWrite.members(doc, oid).text.getData().getText(), "999.0'",
        "and left exactly as it was -- a number whose basis vanished is " +
        "something to tell the caver, not to silently delete");
})();

var out;
if (failures.length === 0) {
    out = "### CALLOUT-SYNC OK " + passed;
} else {
    out = "### CALLOUT-SYNC FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
