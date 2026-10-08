// callout_write.js -- CalloutWrite against a real document.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/callout_write.js "$PWD"
//
// Prints "### CALLOUT-WRITE OK <n>" or "### CALLOUT-WRITE FAIL".

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
    // returns -- see tests/profile_draw_roundtrip.js's own loader, which
    // hit exactly this and documents it. Confirmed by hand: the plan's
    // literal `eval(src)` throws "ReferenceError: CsLayers is not
    // defined" the moment the entry script tries to use it.
    (0, eval)(src);
}

// Some builds' -autostart engines don't preload library.js, where
// isNull normally lives -- same reason js_unit.js and
// profile_draw_roundtrip.js both carry this exact shim.
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

var FILES = [
    "scripts/CaveSurvey/Core/CsUuid.js",
    "scripts/CaveSurvey/Core/CsUnits.js",
    "scripts/CaveSurvey/Core/CsTags.js",
    "scripts/CaveSurvey/Core/CsStore.js",
    "scripts/CaveSurvey/Core/CsLayers.js",
    "scripts/CaveSurvey/Core/CsDraw.js",
    "scripts/CaveSurvey/Core/CsCallout.js",
    "scripts/CaveSurvey/Callout/CalloutWrite.js"
];
for (var fi = 0; fi < FILES.length; fi++) {
    loadRepoScript(FILES[fi]);
}

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
// CsTags.commit falls through to CsStore.migrate(getDocument(), di),
// and getDocument() is simple.js's global (populated by the GUI/tool
// context, not this bare -autostart script) -- same reassignment
// js_unit.js's own document-backed fixtures use.
getDocument = function() { return doc; };
CsLayers.ensureCalloutLayers(doc, di);

// --- an empty drawing has no ids -------------------------------------
eqs(CalloutWrite.existingIds(doc).length, 0,
    "existingIds on an empty drawing");

// --- textHeight: the suite's own label height, NOT the drawing's
// DIMTXT. Measured in a real cave drawing DIMTXT is 0.0833 with
// DIMSCALE 1, which drew a note 0.08 units tall across 200 feet of
// passage -- invisible. A note must come out the size of the station
// labels beside it. ------------------------------------------------
eqs(CalloutWrite.textHeight(doc), CsDraw.TEXT_HEIGHT,
    "textHeight is the same height every other label in the suite uses");
ok(CalloutWrite.textHeight(doc) > 0.2,
    "textHeight is a legible size, not a dimension-annotation size");

// --- suffixFor: follows the drawing's own unit, not a constant -------
doc.setUnit(RS.Meter);
eqs(CalloutWrite.suffixFor(doc), " m",
    "suffixFor: a metric drawing gets \" m\"");
doc.setUnit(RS.Foot);
eqs(CalloutWrite.suffixFor(doc), "'",
    "suffixFor: an imperial drawing gets an apostrophe");

// --- create ----------------------------------------------------------
var id = CalloutWrite.create(doc, di, {
    text: "bad air",
    position: { x: 100, y: 50 },
    tips: [{ x: 60, y: 40 }, { x: 55, y: 70 }],
    style: "hazard",
    kind: CsCallout.KIND_TEXT,
    height: 4.0
});
ok(id !== null && id !== undefined && String(id).length > 0,
    "create returns an id");
eqs(CalloutWrite.existingIds(doc).length, 1,
    "the drawing now reports exactly one callout id");

var m = CalloutWrite.members(doc, id);
ok(m.text !== null, "members finds the text");
eqs(m.leaders.length, 2, "members finds one leader per tip");
eqs(CsTags.get(m.text, CsCallout.KEY.ROLE), CsCallout.ROLE_TEXT,
    "the text carries role=text");
eqs(CsTags.get(m.text, CsCallout.KEY.STYLE), "hazard",
    "the text carries its style");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ROLE), CsCallout.ROLE_LEADER,
    "a leader carries role=leader");
eqs(CsTags.get(m.leaders[0], CsCallout.KEY.ID), String(id),
    "a leader carries the SAME id as its text");

// --- WHERE THE TEXT ACTUALLY LANDED ----------------------------------
// Assert the BOUNDING BOX, not getPosition(). setPosition() reads back
// whatever you gave it even when the text renders at the origin,
// because the entity draws at its ALIGNMENT point -- so a getPosition()
// assertion passes while the caver sees the note at 0,0. That is
// exactly how this shipped, and got caught by hand instead of here.
(function() {
    var box = CalloutWrite.boxOf(m.text);
    near(box.x1, 100, 1e-6, "the text's box starts at the requested x");
    // VAlignMiddle: the pick point is the note's vertical MIDDLE, which
    // is also where reflow attaches the landing -- so the arrow leaves
    // at exactly the height the caver clicked.
    near((box.y1 + box.y2) / 2.0, 50, 1e-6,
        "the text's box is centred vertically ON the requested y");
    ok(box.x2 > box.x1, "the text's box has real width");
    ok(box.y2 > box.y1, "the text's box has real height");
    ok(!(Math.abs(box.x1) < 1e-9 && Math.abs(box.y2) < 1e-9),
        "the text did NOT snap to the origin");

    // And the leaders must land ON that box, not near the origin --
    // boxOf feeds reflow, so a mislocated text silently mislocates
    // every arrow too.
    for (var i = 0; i < m.leaders.length; i++) {
        var d = m.leaders[i].getData();
        var last = d.getVertexAt(d.countVertices() - 1);
        ok(last.x >= box.x1 - 1e-6 && last.x <= box.x2 + 1e-6,
            "leader " + i + " lands on the text's box in x, not at the origin");
        ok(last.y >= box.y1 - 1e-6 && last.y <= box.y2 + 1e-6,
            "leader " + i + " lands within the text's box in y");
    }
})();

// --- layer discipline: never the current layer ------------------------
eqs(doc.getLayerName(m.text.getLayerId()), CsLayers.NOTES_HAZARD,
    "the text landed on its STYLE's layer");
eqs(doc.getLayerName(m.leaders[0].getLayerId()), CsLayers.NOTES_HAZARD,
    "the leader landed on its style's layer too");

// --- entity count actually changed (an op can 'succeed' and add nothing)
var onLayer = doc.queryLayerEntities(
    doc.getLayerId(CsLayers.NOTES_HAZARD), true);
eqs(onLayer.length, 3, "three entities on the hazard layer: 1 text + 2 leaders");

// --- applyReflow rewrites leaders and leaves the text alone -----------
var textBefore = CsTags.get(m.text, CsCallout.KEY.ID);
CalloutWrite.applyReflow(doc, di, id, null);
var m2 = CalloutWrite.members(doc, id);
eqs(m2.leaders.length, 2, "reflow kept one leader per branch");
eqs(CsTags.get(m2.text, CsCallout.KEY.ID), textBefore,
    "reflow did not disturb the text's tags");

// --- undo grouping passes through -------------------------------------
// The scenario the listener creates: a caver's edit and the reflow it
// triggers share a transaction group, so ONE undo takes both.
//
// This deliberately MOVES the note first. A reflow of an unchanged
// callout now writes nothing at all (that is what stopped CaveCAD
// freezing), so it produces no undo step -- and an undo test built on
// no-op reflows would silently undo whatever came before instead.
(function() {
    var g = 4242;
    var m0 = CalloutWrite.members(doc, id);
    var leadersBeforeGroup = m0.leaders.length;

    var td = m0.text.getData();
    var was = td.getAlignmentPoint();
    td.setPosition(new RVector(was.x + 120, was.y + 40));
    td.setAlignmentPoint(new RVector(was.x + 120, was.y + 40));
    m0.text.setData(td);
    var mop = new RModifyObjectsOperation();
    mop.addObject(m0.text, false);
    mop.setTransactionGroup(g);
    di.applyOperation(mop);

    // the reflow that edit would trigger, in the SAME group
    CalloutWrite.applyReflow(doc, di, id, g);

    var movedBox = CalloutWrite.boxOf(CalloutWrite.members(doc, id).text);
    near(movedBox.x1, was.x + 120, 1e-6,
        "fixture: the note really did move (and boxOf sees it)");

    di.undo();

    var back = CalloutWrite.members(doc, id);
    eqs(back.leaders.length, leadersBeforeGroup,
        "after ONE undo, members() still finds the original number of " +
        "leaders BY TAG -- not merely the same entity count");
    var backBox = CalloutWrite.boxOf(back.text);
    near(backBox.x1, was.x, 1e-6,
        "and the note is back where it started, so the single undo took " +
        "the edit AND its reflow together");
})();

// --- ONE GESTURE, ONE UNDO ------------------------------------------
// create() builds text and every leader into a SINGLE operation, so a
// freshly placed callout comes back out on one Ctrl+Z. The previous
// version applied the text in its own operation and then each leader in
// another, which took as many presses as the callout had arrows.
(function() {
    var before = doc.queryAllEntities(false, true).length;
    var uid = CalloutWrite.create(doc, di, {
        text: "one undo", position: { x: 500, y: 500 },
        tips: [{ x: 460, y: 490 }, { x: 470, y: 520 }, { x: 480, y: 470 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    eqs(doc.queryAllEntities(false, true).length, before + 4,
        "a 3-arrow callout adds 4 entities: one text and three leaders");
    ok(CalloutWrite.members(doc, uid).text !== null, "and it is findable");

    di.undo();
    eqs(doc.queryAllEntities(false, true).length, before,
        "ONE undo removes the text AND all three leaders together");
    eqs(CalloutWrite.members(doc, uid).text, null,
        "nothing of the callout is left behind by that single undo");
})();

// --- THE FLIP: the note grows AWAY from the arrow -------------------
// An arrow to the RIGHT of the pick must push the text LEFT, so the
// text's near edge is on the pick and the leader never crosses its own
// letters. Without the flip both cases produce a box extending right,
// and the right-hand case draws its shoulder straight through the note.
(function() {
    var rid = CalloutWrite.create(doc, di, {
        text: "flip me", position: { x: 300, y: 300 },
        tips: [{ x: 340, y: 290 }],          // arrow to the RIGHT
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var rm = CalloutWrite.members(doc, rid);
    var rb = CalloutWrite.boxOf(rm.text);
    ok(rb.x2 <= 300 + 1e-6,
        "arrow on the right: the note extends LEFT of the pick (box ends at " +
        rb.x2.toFixed(3) + ")");
    near(rb.x2, 300, 1e-6, "and its near edge sits exactly on the pick");

    var rd = rm.leaders[0].getData();
    var rlast = rd.getVertexAt(rd.countVertices() - 1);
    near(rlast.x, 300, 1e-6,
        "the landing attaches at that near edge, not across the text");

    // and the mirror case still behaves
    var lid = CalloutWrite.create(doc, di, {
        text: "flip me", position: { x: 300, y: 260 },
        tips: [{ x: 260, y: 250 }],          // arrow to the LEFT
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var lb = CalloutWrite.boxOf(CalloutWrite.members(doc, lid).text);
    ok(lb.x1 >= 300 - 1e-6,
        "arrow on the left: the note extends RIGHT of the pick");
    near(lb.x1, 300, 1e-6, "near edge on the pick again, mirrored");
})();

// --- CURVED leaders -------------------------------------------------
(function() {
    var cid = CalloutWrite.create(doc, di, {
        text: "curvy", position: { x: 400, y: 400 },
        tips: [{ x: 360, y: 380 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        leader: CsCallout.LEADER_CURVED,
        height: CalloutWrite.textHeight(doc)
    });
    var cm = CalloutWrite.members(doc, cid);
    eqs(CsTags.get(cm.text, CsCallout.KEY.LEADER), CsCallout.LEADER_CURVED,
        "the leader SHAPE is recorded on the text, so a reflow can keep it");

    var cd = cm.leaders[0].getData();
    ok(cd.countVertices() > 3,
        "a curved leader is traced in SEGMENTS, not one arc (got " +
        cd.countVertices() + " vertices)");
    // NO BULGES ANYWHERE. An arc carried as a bulge corrupts the leader
    // on save: the DXF LEADER record has no bulge concept, so the
    // exporter drops the arc's START vertex -- the ARROW TIP -- shifts
    // the rest down and pads with a phantom vertex at the origin.
    // Measured: (10,10,b0.35) -> (20,10) -> (22,10) came back as
    // (20,10) -> (22,10) -> (0,0).
    var anyBulge = false;
    for (var bi = 0; bi < cd.countVertices(); bi++) {
        if (Math.abs(cd.getBulgeAt(bi)) > 1e-9) { anyBulge = true; }
    }
    eqs(anyBulge, false,
        "and carries NO bulge -- an arc does not survive a DXF save");

    // it must actually bow: some interior vertex off the straight chord
    var v0 = cd.getVertexAt(0);
    var vN = cd.getVertexAt(cd.countVertices() - 1);
    var bowed = false;
    for (var ci = 1; ci < cd.countVertices() - 1; ci++) {
        var vi = cd.getVertexAt(ci);
        // distance from the chord v0->vN
        var ax = vN.x - v0.x, ay = vN.y - v0.y;
        var len = Math.sqrt(ax * ax + ay * ay);
        if (len < 1e-9) { continue; }
        var dist = Math.abs((vi.x - v0.x) * ay - (vi.y - v0.y) * ax) / len;
        if (dist > 1e-6) { bowed = true; }
    }
    ok(bowed, "and it genuinely bows off the straight line");

    // the curve must survive a reflow, or moving the text straightens it
    CalloutWrite.applyReflow(doc, di, cid, null);
    ok(CalloutWrite.members(doc, cid).leaders[0].getData()
        .countVertices() > 3,
        "the curve SURVIVES a reflow, read back off the text's own tag");

    // and a straight one stays straight
    var sid = CalloutWrite.create(doc, di, {
        text: "straight", position: { x: 400, y: 360 },
        tips: [{ x: 360, y: 340 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        height: CalloutWrite.textHeight(doc)
    });
    var sd = CalloutWrite.members(doc, sid).leaders[0].getData();
    eqs(sd.countVertices(), 3,
        "the default leader is straight: tip, elbow, landing and no more");
})();

// --- THE DXF ROUND TRIP -----------------------------------------------
// The single most load-bearing test in this file. A callout is a LINKED
// PAIR and the link is XDATA -- there is no side table and no registry
// object in the drawing. If CalloutId does not survive export/import,
// then every callout in every saved file silently decays into an
// unrelated text and some loose arrows the moment it is reopened, and
// nothing else in this suite would notice: the in-memory tests all pass
// against a document that was never written to disk.
(function() {
    var rtPath = repoRoot + "/tests/.callout-roundtrip.dxf";

    // Find the dxflib filter the same way the rest of the suite does.
    var rtFilter = "";
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var f = 0; f < filters.length; f++) {
        if (String(filters[f]).indexOf("dxflib") >= 0) {
            rtFilter = filters[f];
            break;
        }
    }

    ok(di.exportFile(rtPath, rtFilter, false),
        "round trip: the drawing with a callout in it exports");

    var rtDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var rtDi = new RDocumentInterface(rtDoc);
    eqs(rtDi.importFile(rtPath, "", false),
        RDocumentInterface.IoErrorNoError,
        "round trip: the file reads back");

    // The id must come back, or the pair is not a pair any more. Assert
    // that THIS callout's id survived, not a count -- other callouts in
    // the fixture are none of this test's business, and a count makes it
    // break every time one is added.
    var ids = CalloutWrite.existingIds(rtDoc);
    var found = false;
    for (var q = 0; q < ids.length; q++) {
        if (String(ids[q]) === String(id)) {
            found = true;
        }
    }
    ok(found, "round trip: this callout's own id survives the save, " +
        "unchanged and not regenerated");

    var rt = CalloutWrite.members(rtDoc, id);
    ok(rt.text !== null, "round trip: the text is still found BY ITS TAG");
    eqs(rt.leaders.length, 2,
        "round trip: both leaders are still found by the same tag");

    // Roles must survive too: without them members() cannot tell which
    // entity is the text, and reflow would have nothing to attach to.
    eqs(CsTags.get(rt.text, CsCallout.KEY.ROLE), CsCallout.ROLE_TEXT,
        "round trip: the text's role tag survives");
    eqs(CsTags.get(rt.leaders[0], CsCallout.KEY.ROLE), CsCallout.ROLE_LEADER,
        "round trip: a leader's role tag survives");
    eqs(CsTags.get(rt.text, CsCallout.KEY.STYLE), "hazard",
        "round trip: the style survives, so a reflow still knows its layer");

    // And the reopened callout must still be reflowable -- the whole
    // point of persisting the link.
    CalloutWrite.applyReflow(rtDoc, rtDi, id, null);
    eqs(CalloutWrite.members(rtDoc, id).leaders.length, 2,
        "round trip: the REOPENED callout still reflows to two leaders");

    // GEOMETRY, not just tags. The original round-trip test checked ids,
    // roles and style and passed while a curved leader was being
    // CORRUPTED on save -- the arrow tip dropped and a phantom vertex
    // added at the origin. Tags surviving is not geometry surviving.
    var rtLeaders = rt.leaders;
    for (var gi = 0; gi < rtLeaders.length; gi++) {
        var gd = rtLeaders[gi].getData();
        var gn = gd.countVertices();
        eqs(gn, 3, "round trip: leader " + gi +
            " keeps exactly its three vertices");
        var v = gd.getVertexAt(0);
        ok(!(Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9),
            "round trip: leader " + gi + "'s first vertex is the arrow " +
            "TIP, not a phantom (0,0) the exporter invented");
    }

    // and the same for a CURVED one, which is where it actually broke
    var cRt = CalloutWrite.create(doc, di, {
        text: "curve rt", position: { x: 700, y: 700 },
        tips: [{ x: 660, y: 690 }],
        style: "name", kind: CsCallout.KIND_TEXT,
        leader: CsCallout.LEADER_CURVED,
        height: CalloutWrite.textHeight(doc)
    });
    var cBefore = CalloutWrite.members(doc, cRt).leaders[0]
        .getData().countVertices();
    var cPath = repoRoot + "/tests/.callout-curve-rt.dxf";
    ok(di.exportFile(cPath, rtFilter, false),
        "round trip: a curved callout exports");
    var cDoc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var cDi = new RDocumentInterface(cDoc);
    eqs(cDi.importFile(cPath, "", false),
        RDocumentInterface.IoErrorNoError,
        "round trip: and reads back");
    var cm2 = CalloutWrite.members(cDoc, cRt);
    ok(cm2.text !== null, "round trip: the curved callout's note survives");
    eqs(cm2.leaders.length, 1, "and its leader");
    eqs(cm2.leaders[0].getData().countVertices(), cBefore,
        "round trip: the CURVED leader keeps every vertex (" + cBefore +
        ") -- an arc lost one and gained a phantom origin");
    var cv0 = cm2.leaders[0].getData().getVertexAt(0);
    ok(!(Math.abs(cv0.x) < 1e-9 && Math.abs(cv0.y) < 1e-9),
        "round trip: and its arrow TIP is still the first vertex");
    new QFile(cPath).remove();

    new QFile(rtPath).remove();
})();

// ---------------------------------------------------------------------
// A GENERATED note label is a real callout.
//
// CsDraw.noteLeader is what the suite draws from a station's Note. It
// used to emit a text plus a bare two-point leader, so the suite drew
// something a caver could not adjust: move the label and the arrow
// stayed. It now carries the same CalloutId link a hand-placed callout
// does, on its own layer.
// ---------------------------------------------------------------------
(function() {
    CsLayers.ensure(doc, di, CsCallout.STYLES["annotation"]);

    var before = CalloutWrite.idSet(doc);
    var op = new RAddObjectsOperation();
    CsDraw.noteLeader(doc, op, { x: 6000, y: 6000 }, "A7",
        "bad air below here", 90.0, { left: 3, right: 4 });
    di.applyOperation(op);
    var added = CalloutWrite.newIds(doc, before);
    eqs(added.length, 2,
        "a generated note label is TWO entities: the note and its arrow");

    // find the callout it created
    var genId = null;
    var textEnt = null, leaderEnt = null;
    for (var i = 0; i < added.length; i++) {
        var e = doc.queryEntity(added[i]);
        var role = CsTags.get(e, CsCallout.KEY.ROLE);
        if (role === CsCallout.ROLE_TEXT) {
            textEnt = e;
            genId = CsTags.get(e, CsCallout.KEY.ID);
        } else if (role === CsCallout.ROLE_LEADER) {
            leaderEnt = e;
        }
    }
    ok(genId !== null && CsUuid.isValid(genId),
        "the generated label carries a real CalloutId");
    ok(textEnt !== null && leaderEnt !== null,
        "with a text role and a leader role");
    eqs(CsTags.get(leaderEnt, CsCallout.KEY.ID), genId,
        "and both share it, so the arrow is bound to the note");

    eqs(CsTags.get(textEnt, CsCallout.KEY.STYLE), "annotation",
        "its style is the generated one");
    eqs(doc.getLayerName(textEnt.getLayerId()),
        CsCallout.STYLES["annotation"],
        "and it is on the generated-notes layer, not with hand-placed notes");
    eqs(doc.getLayerName(leaderEnt.getLayerId()),
        CsCallout.STYLES["annotation"], "arrow too");

    // THE OLD TAGS MUST SURVIVE. eraseStations finds these by TAG, not by
    // layer, so dropping them would make every redraw pile up duplicates
    // instead of replacing. CsBind also reads them to know this is the
    // suite's own output and not a caver's linework to claim.
    eqs(CsTags.get(textEnt, "NoteLabel"), "A7",
        "the note keeps its NoteLabel tag, so a redraw still erases it");
    eqs(CsTags.get(leaderEnt, "NoteLeader"), "A7",
        "and the arrow keeps NoteLeader");

    // it is a MANAGEABLE callout: found by members, attached, reflowable
    var gm = CalloutWrite.members(doc, genId);
    ok(gm.text !== null && gm.leaders.length === 1,
        "members() sees it as a callout, so sync and the listener manage it");
    var gbox = CalloutWrite.boxOf(gm.text);
    var gd = gm.leaders[0].getData();
    eqs(gd.countVertices(), 3,
        "its arrow is a real leader: tip, elbow, landing");
    var gend = gd.getVertexAt(2);
    ok(gend.x >= gbox.x1 - 1e-6 && gend.x <= gbox.x2 + 1e-6,
        "and it lands ON the note, like a hand-placed one");

    // The layer must EXIST before noteLeader runs. A drawing that never
    // saw the template has no NOTES-ANNOTATION, and getLayerId would
    // hand back an invalid id -- entities landing on nothing, silently.
    // CsDraw's own caller ensures it; this pins that the layer name
    // noteLeader uses is one CsLayers actually knows how to create.
    ok(CsLayers.DEFAULTS.hasOwnProperty(CsCallout.STYLES["annotation"]),
        "CsLayers can create the generated-notes layer from scratch");

    // move the generated label; a reflow must bring its arrow along
    var gtd = gm.text.getData();
    var gwas = gtd.getAlignmentPoint();
    gtd.setPosition(new RVector(gwas.x + 40, gwas.y + 15));
    gtd.setAlignmentPoint(new RVector(gwas.x + 40, gwas.y + 15));
    gm.text.setData(gtd);
    var gmop = new RModifyObjectsOperation();
    gmop.addObject(gm.text, false);
    di.applyOperation(gmop);

    CalloutWrite.applyReflow(doc, di, genId, null);
    var g2 = CalloutWrite.members(doc, genId);
    var g2box = CalloutWrite.boxOf(g2.text);
    var g2end = g2.leaders[0].getData().getVertexAt(2);
    ok(g2end.x >= g2box.x1 - 1e-6 && g2end.x <= g2box.x2 + 1e-6,
        "MOVING a generated label brings its arrow with it -- the whole " +
        "point of making these real callouts");
})();

// ---------------------------------------------------------------------
// An ELEVATION callout is an ordinary callout carrying its provenance.
//
// There is no separate elevation command: the callout tool picks the
// arrow point before its dialog opens, so the tip is known and the
// number is simply offered in the text field. What makes it an elevation
// callout is the kind and the tags that let CsCalloutSync re-derive it.
// ---------------------------------------------------------------------
(function() {
    CsLayers.ensure(doc, di, CsCallout.STYLES["elevation"]);
    CsLayers.ensure(doc, di, CsCallout.STYLES["elevation-line"]);

    // a measured floor
    var floorSample = { z: 1234.51, basis: CsCallout.BASIS_FLOOR,
        from: "A2", to: "A3", fraction: 0.5, multi: false };
    var label = CsCallout.elevLabel(floorSample, "'");
    eqs(label, "1234.5'", "the label is the formatted floor elevation");

    var tags = {};
    tags[CsCallout.KEY.ELEV_BASIS] = floorSample.basis;
    tags[CsCallout.KEY.ELEV_FROM] = floorSample.from;
    tags[CsCallout.KEY.ELEV_TO] = floorSample.to;
    tags[CsCallout.KEY.ELEV_FRACTION] = String(floorSample.fraction);
    tags[CsCallout.KEY.ELEV_VALUE] = String(floorSample.z);

    var eid = CalloutWrite.create(doc, di, {
        text: label, position: { x: 7000, y: 7000 },
        tips: [{ x: 6960, y: 6990 }],
        style: CsCallout.elevStyle(floorSample),
        kind: CsCallout.KIND_ELEV,
        tags: tags,
        height: CalloutWrite.textHeight(doc)
    });
    var em = CalloutWrite.members(doc, eid);
    eqs(CsTags.get(em.text, CsCallout.KEY.KIND), CsCallout.KIND_ELEV,
        "it is marked as an elevation callout");
    eqs(doc.getLayerName(em.text.getLayerId()),
        CsCallout.STYLES["elevation"], "on the elevation layer");
    eqs(CsTags.get(em.text, CsCallout.KEY.ELEV_BASIS), "floor",
        "and carries the basis it was derived from");
    eqs(CsTags.get(em.text, CsCallout.KEY.ELEV_FROM), "A2",
        "and the leg it was sampled on -- which is how sync re-derives it");
    eqs(CsTags.get(em.text, CsCallout.KEY.ELEV_TO), "A3", "both ends");
    eqs(CsTags.get(em.text, CsCallout.KEY.ELEV_FRACTION), "0.5",
        "and where along that leg");

    // it is a NORMAL callout in every other respect
    eqs(em.leaders.length, 1, "it has its arrow");
    var eb = CalloutWrite.boxOf(em.text);
    var eend = em.leaders[0].getData().getVertexAt(2);
    ok(eend.x >= eb.x1 - 1e-6 && eend.x <= eb.x2 + 1e-6,
        "attached like any other callout, so the listener manages it too");

    // --- a LINE-basis sample is forced onto the muted style ----------
    var lineSample = { z: 1005.0, basis: CsCallout.BASIS_LINE,
        from: "A2", to: "A3", fraction: 0.5, multi: false };
    eqs(CsCallout.elevLabel(lineSample, "'"), "~1005.0' LINE",
        "a stand-in label says LINE on its face");
    eqs(CsCallout.elevStyle(lineSample), "elevation-line",
        "and is forced onto the fallback style");

    var lTags = {};
    lTags[CsCallout.KEY.ELEV_BASIS] = lineSample.basis;
    var lid = CalloutWrite.create(doc, di, {
        text: CsCallout.elevLabel(lineSample, "'"),
        position: { x: 7000, y: 6900 },
        tips: [{ x: 6960, y: 6890 }],
        style: CsCallout.elevStyle(lineSample),
        kind: CsCallout.KIND_ELEV, tags: lTags,
        height: CalloutWrite.textHeight(doc)
    });
    var lm = CalloutWrite.members(doc, lid);
    eqs(doc.getLayerName(lm.text.getLayerId()),
        CsCallout.STYLES["elevation-line"],
        "a stand-in lands on the MUTED layer, so a plot cannot pass it " +
        "off as a measurement");
    ok(CsCallout.STYLES["elevation-line"] !== CsCallout.STYLES["elevation"],
        "which is a different layer from a real reading");
})();

var out;
if (failures.length === 0) {
    out = "### CALLOUT-WRITE OK " + passed;
} else {
    out = "### CALLOUT-WRITE FAIL " + failures.length + " of " +
        (passed + failures.length) + "\n";
    for (var k = 0; k < failures.length; k++) {
        out += "  FAIL: " + failures[k] + "\n";
    }
}
print(out);
