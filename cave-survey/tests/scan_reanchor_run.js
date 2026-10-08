// scan_reanchor_run.js -- aligned scans follow the survey when it moves.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/scan_reanchor_run.js "$PWD"
//
// Prints "### SCAN REANCHOR OK" / "### SCAN REANCHOR FAIL".
//
// WHY A REAL DOCUMENT. The whole mechanism turns on QCAD's own image
// mapping -- mapToImage to read a station's pixel out of a placed scan,
// mapFromImage to check where it lands afterwards. A stub of that
// mapping would only prove my arithmetic agrees with itself, which was
// never the thing in doubt.

if (typeof isNull === "undefined") {
    isNull = function(v) {
        if (v === undefined || v === null) { return true; }
        try { if (typeof v.isNull === "function") { return v.isNull(); } } catch (e) {}
        return false;
    };
}
if (typeof isImageEntity === "undefined") {
    isImageEntity = function(e) {
        return !isNull(e) && typeof e.getType === "function" &&
            e.getType() === RS.EntityImage;
    };
}

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];
function loadRepoScript(rel) {
    var f = new QFile(repoRoot + "/" + rel);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        throw new Error("cannot open " + rel);
    }
    var st = new QTextStream(f);
    var src = String(st.readAll());
    f.close();
    src = src.replace(/^\s*include\(.*\);\s*$/mg, "");
    (0, eval)(src);
}
["CsUuid", "CsUnits", "CsAngles", "CsModel", "CsTraverse", "CsNetwork",
 "CsLrud", "CsScanFit", "CsStore", "CsTags", "CsLayers", "CsStationOrder",
 "CsScanFrame", "CsScanReanchor"].forEach(function(m) {
    loadRepoScript("scripts/CaveSurvey/Core/" + m + ".js");
});

var failures = [], checks = 0;
function check(name, cond) {
    checks++;
    if (cond !== true) { failures.push(name); }
}
function checkClose(name, a, b, tol) {
    checks++;
    if (!(Math.abs(a - b) <= (tol === undefined ? 0.01 : tol))) {
        failures.push(name + " -- expected " + b + ", got " + a);
    }
}

var scanPath = repoRoot + "/scripts/CaveSurvey/SketchScans/SketchScans.svg";
var img = new QImage(scanPath);
var W = img.width(), H = img.height();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
CsLayers.ensure(doc, di, CsLayers.CTRL_STATIONS);
CsLayers.ensure(doc, di, CsLayers.CTRL_SCAN);

function putStation(name, x, y) {
    var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
    p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(p, "Station", name);
    di.applyOperation(new RAddObjectOperation(p, false));
    return p;
}
var a = putStation("A1", 100, 100);
var b = putStation("A2", 200, 140);

// two picks on the scan, in its own pixels
var pickA = { x: 10, y: 10 }, pickB = { x: W - 10, y: H - 10 };
var fit = CsScanFit.fit([
    { source: pickA, dest: { x: 100, y: 100 } },
    { source: pickB, dest: { x: 200, y: 140 } }
]);
var v = CsScanFit.imageVectors(fit.matrix);
var data = new RImageData(scanPath, new RVector(v.position.x, v.position.y),
    new RVector(v.u.x, v.u.y), new RVector(v.v.x, v.v.y), W, H, 0);
var scan = new RImageEntity(doc, data);
scan.setLayerId(doc.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(scan, "SketchScan", "test.jpg");
CsTags.set(scan, CsStationOrder.TAG,
    CsStationOrder.serializeAssigned(["A1", "A2"]));
CsTags.set(scan, "ScanAnchors", CsScanFit.serializeAnchors([
    { name: "A1", u: pickA.x, v: pickA.y },
    { name: "A2", u: pickB.x, v: pickB.y }
]));
di.applyOperation(new RAddObjectOperation(scan, false));

// ---- nothing has moved: the scan must be left alone ------------------
var first = CsScanReanchor.run(doc, di);
check("an unchanged survey leaves the scan alone", first.moved === 0);
check("and reports it as already in place", first.matched === 1);

// ---- a correction moves a station: the scan must follow --------------
var moved = doc.queryEntity(b.getId());
moved.move(new RVector(30, -25));          // A2 shifts, as a fixed azimuth would
var mop = new RModifyObjectsOperation();
mop.addObject(moved, false);
di.applyOperation(mop);

var after = CsScanReanchor.run(doc, di);
check("a moved station re-fits the scan", after.moved === 1);

var placed = doc.queryEntity(scan.getId()).getData();
var atA = placed.mapFromImage(new RVector(pickA.x, pickA.y));
var atB = placed.mapFromImage(new RVector(pickB.x, pickB.y));
checkClose("the scan's A1 pick still lands on A1 (x)", atA.x, 100);
checkClose("the scan's A1 pick still lands on A1 (y)", atA.y, 100);
checkClose("the scan's A2 pick follows A2 (x)", atB.x, 230);
checkClose("the scan's A2 pick follows A2 (y)", atB.y, 115);

// ---- and it settles: a second pass moves nothing ---------------------
var again = CsScanReanchor.run(doc, di);
check("a second pass moves nothing", again.moved === 0);
check("and says it is already in place", again.matched === 1);

// ---- a scan with names but no anchors gets them, from where it sits --
var legacy = doc.queryEntity(scan.getId());
CsTags.remove(legacy, "ScanAnchors");
var rop = new RModifyObjectsOperation();
rop.addObject(legacy, false);
di.applyOperation(rop);
check("the anchors really are gone",
    CsTags.get(doc.queryEntity(scan.getId()), "ScanAnchors") === "");

var filled = CsScanReanchor.backfill(doc, di);
check("a legacy scan is given anchors", filled === 1);
var recovered = CsScanFit.parseAnchors(
    CsTags.get(doc.queryEntity(scan.getId()), "ScanAnchors"));
check("both stations were recovered", recovered.length === 2);
// read back out of the placement, so they must be the pixels we picked
checkClose("the recovered A1 pixel is the one picked (x)",
    recovered[0].u, pickA.x, 0.5);
checkClose("the recovered A1 pixel is the one picked (y)",
    recovered[0].v, pickA.y, 0.5);

// ---- A PROFILE SCAN FOLLOWS ITS BAND, not the plan -------------------
// Same names, different places: the elevation carries ProfileStation
// points, and a profile scan must be re-fitted against those rather
// than against the plan stations of the same name.
CsLayers.ensure(doc, di, CsLayers.CTRL_PROFILE_SCAN);
function putProfileStation(name, run, x, y) {
    var p = new RPointEntity(doc, new RPointData(new RVector(x, y)));
    p.setLayerId(doc.getLayerId(CsLayers.CTRL_STATIONS));
    CsTags.set(p, "ProfileStation", name);
    CsTags.set(p, "ProfileRun", run);
    di.applyOperation(new RAddObjectOperation(p, false));
    return p;
}
putProfileStation("A1", "A", 1000, 50);
var pb = putProfileStation("A2", "A", 1100, 70);

var pfit = CsScanFit.fit([
    { source: pickA, dest: { x: 1000, y: 50 } },
    { source: pickB, dest: { x: 1100, y: 70 } }
]);
var pv = CsScanFit.imageVectors(pfit.matrix);
var pscan = new RImageEntity(doc, new RImageData(scanPath,
    new RVector(pv.position.x, pv.position.y),
    new RVector(pv.u.x, pv.u.y), new RVector(pv.v.x, pv.v.y), W, H, 0));
pscan.setLayerId(doc.getLayerId(CsLayers.CTRL_PROFILE_SCAN));
CsTags.set(pscan, "SketchScan", "profile.jpg");
CsTags.set(pscan, "ScanFrame", "profile");
CsTags.set(pscan, "ScanFrameKey", "A");
CsTags.set(pscan, "ScanAnchors", CsScanFit.serializeAnchors([
    { name: "A1", u: pickA.x, v: pickA.y },
    { name: "A2", u: pickB.x, v: pickB.y }
]));
di.applyOperation(new RAddObjectOperation(pscan, false));

// move the BAND's A2, leaving the plan's A2 alone
var movedP = doc.queryEntity(pb.getId());
movedP.move(new RVector(-40, 15));
var pop = new RModifyObjectsOperation();
pop.addObject(movedP, false);
di.applyOperation(pop);

var pafter = CsScanReanchor.run(doc, di);
check("the profile scan followed its band", pafter.moved === 1);
check("and the plan scan, already in place, did not move",
    pafter.matched >= 1);
var pplaced = doc.queryEntity(pscan.getId()).getData();
var pAtB = pplaced.mapFromImage(new RVector(pickB.x, pickB.y));
checkClose("the profile pick landed on the elevation's A2 (x)", pAtB.x, 1060);
checkClose("the profile pick landed on the elevation's A2 (y)", pAtB.y, 85);
// and it did NOT chase the plan station of the same name
check("it did not chase the plan station of the same name",
    Math.abs(pAtB.x - 230) > 1);

// ---- A SECTION SCAN IS CUT AT A PLAN STATION, not one of its own -----
// stationTagFor("section") names "SectionStation", a tag nothing in
// this suite writes -- so a section scan's anchors must be read and
// re-fit against PLAN stations, exactly like a plain plan scan's are.
// A1 is currently at (100,100); A2 was moved earlier to (230,115).
CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_SCAN);
var sfit = CsScanFit.fit([
    { source: pickA, dest: { x: 100, y: 100 } },
    { source: pickB, dest: { x: 230, y: 115 } }
]);
var sv = CsScanFit.imageVectors(sfit.matrix);
var sscan = new RImageEntity(doc, new RImageData(scanPath,
    new RVector(sv.position.x, sv.position.y),
    new RVector(sv.u.x, sv.u.y), new RVector(sv.v.x, sv.v.y), W, H, 0));
sscan.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
CsTags.set(sscan, "SketchScan", "section.jpg");
CsTags.set(sscan, "ScanFrame", "section");
CsTags.set(sscan, "ScanAnchors", CsScanFit.serializeAnchors([
    { name: "A1", u: pickA.x, v: pickA.y },
    { name: "A2", u: pickB.x, v: pickB.y }
]));
di.applyOperation(new RAddObjectOperation(sscan, false));

// move the PLAN's A1: the section scan is cut at it, so it must follow
var movedA1 = doc.queryEntity(a.getId());
movedA1.move(new RVector(15, 20));
var sop = new RModifyObjectsOperation();
sop.addObject(movedA1, false);
di.applyOperation(sop);

var safter = CsScanReanchor.run(doc, di);
check("a section scan is not reported stale when its plan station moves",
    safter.stale === 0);
check("a section scan's anchors are not reported missing",
    safter.missing.length === 0);
var splaced = doc.queryEntity(sscan.getId()).getData();
var sAtA = splaced.mapFromImage(new RVector(pickA.x, pickA.y));
checkClose("the section scan's pick followed the moved plan station (x)",
    sAtA.x, 115);
checkClose("the section scan's pick followed the moved plan station (y)",
    sAtA.y, 120);

// ---- and a LEGACY section scan backfills from plan stations too ------
// Same trap at the other call site (CsScanReanchor.backfill): a legacy
// scan with names but no anchors reads its pixels back through the
// stations it was named to -- which, for a section, are plan stations.
var lfit = CsScanFit.fit([
    { source: pickA, dest: { x: 115, y: 120 } },
    { source: pickB, dest: { x: 230, y: 115 } }
]);
var lv = CsScanFit.imageVectors(lfit.matrix);
var lscan = new RImageEntity(doc, new RImageData(scanPath,
    new RVector(lv.position.x, lv.position.y),
    new RVector(lv.u.x, lv.u.y), new RVector(lv.v.x, lv.v.y), W, H, 0));
lscan.setLayerId(doc.getLayerId(CsLayers.CTRL_SECTION_SCAN));
CsTags.set(lscan, "SketchScan", "section-legacy.jpg");
CsTags.set(lscan, "ScanFrame", "section");
CsTags.set(lscan, CsStationOrder.TAG,
    CsStationOrder.serializeAssigned(["A1", "A2"]));
di.applyOperation(new RAddObjectOperation(lscan, false));

var sectionFilled = CsScanReanchor.backfill(doc, di);
check("a legacy section scan is backfilled from plan stations, " +
    "not refused as basis-gone", sectionFilled === 1);
var lrecovered = CsScanFit.parseAnchors(
    CsTags.get(doc.queryEntity(lscan.getId()), "ScanAnchors"));
check("the legacy section scan recovered both anchors",
    lrecovered.length === 2);
// guarded: with the bug, nothing was recovered at all -- indexing a
// pixel out of an empty result would crash the run before it can
// print what else failed, which is not evidence of anything new.
if (lrecovered.length === 2) {
    checkClose("the recovered section A1 pixel is the one picked (x)",
        lrecovered[0].u, pickA.x, 0.5);
    checkClose("the recovered section A1 pixel is the one picked (y)",
        lrecovered[0].v, pickA.y, 0.5);
}

// ---- a scan whose stations are gone is left alone, not mangled -------
var gone = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var gdi = new RDocumentInterface(gone);
CsLayers.ensure(gone, gdi, CsLayers.CTRL_SCAN);
var orphan = new RImageEntity(gone, new RImageData(scanPath,
    new RVector(0, 0), new RVector(1, 0), new RVector(0, 1), W, H, 0));
orphan.setLayerId(gone.getLayerId(CsLayers.CTRL_SCAN));
CsTags.set(orphan, "SketchScan", "orphan.jpg");
CsTags.set(orphan, "ScanAnchors", "Z1@10,10;Z2@20,20");
gdi.applyOperation(new RAddObjectOperation(orphan, false));
var orphanRun = CsScanReanchor.run(gone, gdi);
check("a scan whose stations are gone is counted stale",
    orphanRun.stale === 1);
check("and is not moved", orphanRun.moved === 0);
check("and is still in the drawing",
    CsScanReanchor.scans(gone).length === 1);

if (failures.length === 0) {
    print("### SCAN REANCHOR OK " + checks);
} else {
    for (var f = 0; f < failures.length; f++) { print("FAIL: " + failures[f]); }
    print("### SCAN REANCHOR FAIL " + failures.length + " of " + checks);
}
