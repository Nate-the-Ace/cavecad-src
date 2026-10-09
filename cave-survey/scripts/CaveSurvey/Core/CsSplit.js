// CsSplit.js -- split a whole-cave drawing into one file per trip, plus an overall file that shows each trip as an
// external reference (xref); and put them back together again.
//
// Part of the Cave Survey Core library. The first half is PURE (no R* classes outside functions; runs under node):
// which item belongs to which trip, what a trip's file is called. The second half is the engine: it copies the
// drawing in memory the way CsLayoutGen.writeCopies does, so the open drawing is never touched by a split.
//
// WHAT A FILE CONTAINS
//   trip file     the SHARED SET (every station point and its label, the control layers, the georeference and datum
//                 tags the station points carry, the layer / linetype / block tables) + that trip's own items
//                 (everything carrying its numeric "Trip" tag: leg and splay lines, traced features, placed symbols).
//                 No layouts. Same coordinates as the original, so it lines up at 0,0.
//   overall file  the original minus the split trips' own items, plus one Overlay xref per trip file attached at
//                 0,0. It keeps the shared set, the surface (aerial photo, contours, scans), the layouts, and every
//                 item that belongs to no trip. The xref's copies of the shared layers are frozen so nothing is drawn
//                 twice.
//   merge         the reverse: each trip file's own items are pasted back into the drawing, the xrefs and their
//                 prefixed layers are removed. Station copies are compared and any difference is reported, never
//                 silently resolved.
//
// WHAT IS NOT A TRIP'S: items with no Trip tag and not shared (hand-drawn lines, areas, callouts, cross sections,
// labels) stay in the overall file, and the dialog counts them.

var CsSplit = {};

/** Tag put on the xref block of a trip file made by a split: its value is the trip number. */
CsSplit.TAG = "SplitTrip";

/** The shared layers: control layers, except the surface (aerial photo, contours) and the scans, which are the
 *  overall file's alone. */
CsSplit.isSharedLayer = function(name) {
    var n = String(name);
    return /^CTRL-/.test(n) && !/AERIAL|CONTOUR|SCAN/.test(n);
};

/**
 * Which kind of item this is, PURE.
 *
 * \param info { tripTag: number|null, station: bool, layer: string }
 * \return { kind: "shared" | "trip" | "other", trip: number|null }
 *   shared  a station point (the trip anchors included: they carry the trips' names), or an item of a shared layer
 *           with no trip of its own
 *   trip    carries a numeric Trip tag
 *   other   everything else
 */
CsSplit.classify = function(info) {
    if (info.station === true) {
        return { kind: "shared", trip: null };
    }
    if (typeof info.tripTag === "number" && isFinite(info.tripTag)) {
        return { kind: "trip", trip: info.tripTag };
    }
    if (CsSplit.isSharedLayer(info.layer)) {
        return { kind: "shared", trip: null };
    }
    return { kind: "other", trip: null };
};

/**
 * Groups classified items, PURE.
 *
 * \param items [{ id, kind, trip }]
 * \return { trips: { "<n>": [id...] }, shared: [id...], other: [id...] }
 */
CsSplit.plan = function(items) {
    var out = { trips: {}, shared: [], other: [] };
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind === "trip") {
            var key = String(it.trip);
            if (!out.trips.hasOwnProperty(key)) { out.trips[key] = []; }
            out.trips[key].push(it.id);
        }
        else if (it.kind === "shared") {
            out.shared.push(it.id);
        }
        else {
            out.other.push(it.id);
        }
    }
    return out;
};

/**
 * The ids to remove from a copy that is to keep only the shared set and the trips in `keep`, PURE.
 * \param items [{ id, kind, trip }]
 * \param keep  [trip number]
 */
CsSplit.toDelete = function(items, keep) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.kind === "shared") { continue; }
        if (it.kind === "trip" && keep.indexOf(it.trip) >= 0) { continue; }
        out.push(it.id);
    }
    return out;
};

/** Text made safe for a file name. PURE. */
CsSplit.safe = function(text) {
    return String(text).replace(/[<>\/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
};

/** The label a trip is known by in a list: "Trip 2  2024-04-06  Team B (name)". PURE. */
CsSplit.tripLabel = function(row) {
    var parts = ["Trip " + row.trip];
    if (row.date) { parts.push(row.date); }
    if (row.team) { parts.push(row.team); }
    var label = parts.join("  ");
    return row.name ? label + "  (" + row.name + ")" : label;
};

/**
 * The file name of a trip's file, PURE: "<cave> - Trip 2 2024-04-06 Team B.dxf". Names that clash (two trips on
 * one date with one team) are told apart by the trip number, which is always there.
 */
CsSplit.fileNameFor = function(cave, row) {
    var bits = ["Trip " + row.trip];
    if (row.date) { bits.push(row.date); }
    if (row.team) { bits.push(row.team); }
    var name = CsSplit.safe(cave) + " - " + CsSplit.safe(bits.join(" "));
    if (name.length > 120) { name = name.substring(0, 120); }
    return name.replace(/[\s.]+$/g, "") + ".dxf";
};

/** The overall file's name. PURE. */
CsSplit.overallName = function(cave) {
    return CsSplit.safe(cave) + " - Overall.dxf";
};

/**
 * One row per trip, PURE: merges what the scan found.
 * \param counts  { "<n>": itemCount }
 * \param anchors { "<n>": { name, date, team } }
 * \return [{ trip, name, date, team, count }] in trip order
 */
CsSplit.rows = function(counts, anchors) {
    var out = [];
    for (var k in counts) {
        if (!counts.hasOwnProperty(k)) { continue; }
        var a = anchors.hasOwnProperty(k) ? anchors[k] : {};
        out.push({ trip: Number(k), name: a.name || "", date: a.date || "", team: a.team || "", count: counts[k] });
    }
    out.sort(function(x, y) { return x.trip - y.trip; });
    return out;
};

/**
 * What a merge found wrong with the stations of a trip file, PURE: names missing from the drawing, and names whose
 * position moved by more than `tol` in either direction.
 * \param main  { name: {x, y} }  the drawing's stations
 * \param trip  { name: {x, y} }  the trip file's copies
 * \return { missing: [name], moved: [name] }
 */
CsSplit.compareStations = function(main, trip, tol) {
    var out = { missing: [], moved: [] };
    for (var name in trip) {
        if (!trip.hasOwnProperty(name)) { continue; }
        if (!main.hasOwnProperty(name)) { out.missing.push(name); continue; }
        var dx = main[name].x - trip[name].x, dy = main[name].y - trip[name].y;
        if (Math.sqrt(dx * dx + dy * dy) > tol) { out.moved.push(name); }
    }
    return out;
};

// =====================================================================================================
// the engine half
// =====================================================================================================

/** The facts about one entity that classify needs. */
CsSplit.infoOf = function(doc, e) {
    return {
        tripTag: CsTags.getNumber(e, "Trip"),
        station: CsTags.get(e, "Station") !== "",
        layer: String(doc.getLayerName(e.getLayerId()))
    };
};

/**
 * Reads the drawing's model space.
 * \return { items: [{id, kind, trip}], counts, anchors, rows, shared, other }
 */
CsSplit.scan = function(doc) {
    var items = [], anchors = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var info = CsSplit.infoOf(doc, e);
        var c = CsSplit.classify(info);
        items.push({ id: ids[i], kind: c.kind, trip: c.trip });
        if (info.station && typeof info.tripTag === "number") {
            anchors[String(info.tripTag)] = { name: CsTags.get(e, "TripName"), date: CsTags.get(e, "TripDate"),
                team: CsTags.get(e, "TripTeam") };
        }
    }
    var plan = CsSplit.plan(items);
    var counts = {};
    for (var k in plan.trips) { if (plan.trips.hasOwnProperty(k)) { counts[k] = plan.trips[k].length; } }
    // a trip with an anchor but no items of its own still shows, as a row with 0 items
    for (var a in anchors) { if (anchors.hasOwnProperty(a) && !counts.hasOwnProperty(a)) { counts[a] = 0; } }
    return { items: items, counts: counts, anchors: anchors, rows: CsSplit.rows(counts, anchors),
        shared: plan.shared.length, other: plan.other.length };
};

/**
 * Runs `fn` with every layer of the copy on, thawed and unlocked (off, frozen and locked layers silently refuse edits),
 * and puts each layer's state back afterwards.
 */
CsSplit.allEditable = function(doc, di, fn) {
    var names = doc.getLayerNames(), saved = [], open = new RModifyObjectsOperation(false), any = false, i;
    for (i = 0; i < names.length; i++) {
        var lay = doc.queryLayer(String(names[i]));
        if (isNull(lay)) { continue; }
        var st = { name: String(names[i]), off: lay.isOff(), frozen: false, locked: lay.isLocked() };
        try { st.frozen = lay.isFrozen(); } catch (eF) { st.frozen = false; }
        saved.push(st);
        if (st.off || st.frozen || st.locked) {
            lay.setOff(false);
            try { lay.setFrozen(false); } catch (eF2) { }
            lay.setLocked(false);
            open.addObject(lay, false);
            any = true;
        }
    }
    if (any) { di.applyOperation(open); }
    var result, thrown = null, threw = false;
    try { result = fn(); } catch (e) { thrown = e; threw = true; }
    var back = new RModifyObjectsOperation(false), backAny = false;
    for (i = 0; i < saved.length; i++) {
        var s = saved[i];
        if (!(s.off || s.frozen || s.locked)) { continue; }
        var l2 = doc.queryLayer(s.name);
        if (isNull(l2)) { continue; }
        l2.setOff(s.off);
        try { l2.setFrozen(s.frozen); } catch (eF3) { }
        l2.setLocked(s.locked);
        back.addObject(l2, false);
        backAny = true;
    }
    if (backAny) { di.applyOperation(back); }
    if (threw) { throw thrown; }
    return result;
};

/** Deletes the given entity ids from a copy (not undoable: the copy is thrown away or written out). */
CsSplit.deleteIds = function(doc, di, ids) {
    if (ids.length === 0) { return 0; }
    var op = new RDeleteObjectsOperation(false), n = 0;
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (!isNull(e)) { op.deleteObject(e); n++; }
    }
    if (n > 0) { di.applyOperation(op); }
    return n;
};

/** A new memory drawing read from `path`, or null. */
CsSplit.openCopy = function(path) {
    var sdi = new RDocumentInterface(new RDocument(new RMemoryStorage(), createSpatialIndex()));
    try {
        sdi.setNotifyListeners(false);
    } catch (e) { }
    if (sdi.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
        try { destr(sdi); } catch (eD) { }
        return null;
    }
    return sdi;
};

CsSplit.removeLayouts = function(sdi) {
    var all = Layouts.list(sdi.getDocument());
    for (var i = 0; i < all.length; i++) { Layouts.remove(sdi, all[i].name); }
};

/** Writes one trip's file from the working copy at `tmp`. \return "" or the reason it failed */
CsSplit.writeTrip = function(tmp, trip, path, filter) {
    var sdi = CsSplit.openCopy(tmp);
    if (sdi === null) { return "could not read the working copy back"; }
    try {
        var sdoc = sdi.getDocument();
        CsSplit.allEditable(sdoc, sdi, function() {
            var scan = CsSplit.scan(sdoc);
            CsSplit.deleteIds(sdoc, sdi, CsSplit.toDelete(scan.items, [trip]));
        });
        CsSplit.removeLayouts(sdi);
        if (sdi.exportFile(path, filter) !== true) { return "could not write " + path; }
        return "";
    }
    finally {
        try { destr(sdi); } catch (eD) { }
    }
};

/** Freezes the layers an xref brought that are the shared set again (already drawn by the overall file itself). */
CsSplit.freezeSharedOf = function(doc, di, prefix) {
    var names = doc.getLayerNames(), op = new RModifyObjectsOperation(false), any = false;
    for (var i = 0; i < names.length; i++) {
        var n = String(names[i]);
        if (n.indexOf(prefix) !== 0 || !CsSplit.isSharedLayer(n.substring(prefix.length))) { continue; }
        var lay = doc.queryLayer(n);
        if (isNull(lay)) { continue; }
        try { lay.setFrozen(true); } catch (eF) { lay.setOff(true); }
        op.addObject(lay, false);
        any = true;
    }
    if (any) { di.applyOperation(op); }
};

/** Marks an attached trip file's xref block with its trip number. */
CsSplit.markBlock = function(doc, di, blockName, trip) {
    var block = doc.queryBlock(blockName);
    if (isNull(block)) { return; }
    CsTags.set(block, CsSplit.TAG, String(trip));
    var op = new RModifyObjectsOperation(false);
    op.addObject(block, false);
    di.applyOperation(op);
};

/**
 * Splits the drawing. The open drawing is not changed: its content is written to a working copy, and each file is made
 * from that copy.
 *
 * \param opts { cave: string, folder: string, trips: [trip number], pathStyle: "absolute"|"relative" }
 * \return { ok, why, files: [{trip, path, name}], overall: path, counts: { "<n>": items }, other: n, shared: n }
 */
CsSplit.split = function(doc, di, opts) {
    var out = { ok: false, why: "", files: [], overall: "", counts: {}, other: 0, shared: 0 };
    var scan = CsSplit.scan(doc);
    out.other = scan.other;
    out.shared = scan.shared;
    if (opts.trips.length === 0) { out.why = "no trip was chosen"; return out; }
    var dir = new QDir(opts.folder);
    if (!dir.exists() && !dir.mkpath(opts.folder)) { out.why = "could not make the folder " + opts.folder; return out; }
    var filter = CsSanitize.dxfFilter();
    var tmp = QDir.tempPath() + "/cavecad-split-" + (new Date()).getTime() + ".dxf";
    if (di.exportFile(tmp, filter) !== true) { out.why = "could not write a working copy of the drawing"; return out; }
    try {
        var used = {};
        var rowOf = {};
        for (var r = 0; r < scan.rows.length; r++) { rowOf[scan.rows[r].trip] = scan.rows[r]; }
        for (var t = 0; t < opts.trips.length; t++) {
            var n = opts.trips[t];
            var row = rowOf[n] || { trip: n, name: "", date: "", team: "" };
            var file = CsSplit.fileNameFor(opts.cave, row);
            while (used.hasOwnProperty(file.toLowerCase())) { file = file.replace(/\.dxf$/, " (" + n + ").dxf"); }
            used[file.toLowerCase()] = true;
            var path = opts.folder + "/" + file;
            var why = CsSplit.writeTrip(tmp, n, path, filter);
            if (why !== "") { out.why = "trip " + n + ": " + why; return out; }
            out.files.push({ trip: n, path: path, name: file });
            out.counts[String(n)] = scan.counts.hasOwnProperty(String(n)) ? scan.counts[String(n)] : 0;
        }
        var why2 = CsSplit.writeOverall(tmp, opts, out, filter);
        if (why2 !== "") { out.why = "overall file: " + why2; return out; }
        out.ok = true;
        return out;
    }
    finally {
        try { (new QFile(tmp)).remove(); } catch (eR) { }
    }
};

/** Writes the overall file: the original without the split trips' items, with each trip file attached as an xref. */
CsSplit.writeOverall = function(tmp, opts, out, filter) {
    var sdi = CsSplit.openCopy(tmp);
    if (sdi === null) { return "could not read the working copy back"; }
    try {
        var sdoc = sdi.getDocument();
        var overallPath = opts.folder + "/" + CsSplit.overallName(opts.cave);
        var chosen = [];
        for (var i = 0; i < out.files.length; i++) { chosen.push(out.files[i].trip); }
        CsSplit.allEditable(sdoc, sdi, function() {
            var scan = CsSplit.scan(sdoc), drop = [];
            for (var k = 0; k < scan.items.length; k++) {
                if (scan.items[k].kind === "trip" && chosen.indexOf(scan.items[k].trip) >= 0) { drop.push(scan.items[k].id); }
            }
            CsSplit.deleteIds(sdoc, sdi, drop);
        });
        // a name for the copy, so a RELATIVE path to each trip file can be worked out
        try { sdoc.setFileName(overallPath); } catch (eN) { }
        for (var f = 0; f < out.files.length; f++) {
            var res = CsXref.attach(sdoc, sdi, out.files[f].path, { style: CsXref.OVERLAY, pathStyle: opts.pathStyle,
                at: new RVector(0, 0), });
            if (!res.ok) { return "could not attach " + out.files[f].name + ": " + res.why; }
            CsSplit.markBlock(sdoc, sdi, res.name, out.files[f].trip);
            CsSplit.freezeSharedOf(sdoc, sdi, CsXref.layerPrefix(CsXref.stem(out.files[f].path)));
        }
        if (sdi.exportFile(overallPath, filter) !== true) { return "could not write " + overallPath; }
        out.overall = overallPath;
        return "";
    }
    finally {
        try { destr(sdi); } catch (eD) { }
    }
};

/** The trip xrefs a drawing has: [{ blockId, trip, name, stored }]. */
CsSplit.tripXrefs = function(doc) {
    var out = [], list = CsXref.listIn(doc);
    for (var i = 0; i < list.length; i++) {
        var block = doc.queryBlock(list[i].blockId);
        if (isNull(block)) { continue; }
        var tag = CsTags.get(block, CsSplit.TAG);
        if (tag === "") { continue; }
        out.push({ blockId: list[i].blockId, trip: Number(tag), name: String(block.getName()), stored: list[i].stored,
            full: list[i].full, status: list[i].status });
    }
    out.sort(function(a, b) { return a.trip - b.trip; });
    return out;
};

/** { name: {x, y} } of a drawing's station points. */
CsSplit.stationsOf = function(doc) {
    var out = {}, ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) { continue; }
        var name = CsTags.get(e, "Station");
        if (name === "" || typeof e.getPosition !== "function") { continue; }
        var p = e.getPosition();
        out[name] = { x: p.x, y: p.y };
    }
    return out;
};

/**
 * Puts the trip files' own items back into the drawing and removes the xrefs. The trip files are left in place.
 *
 * \param opts { trips: [trip number] or null for all }
 * \return { ok, why, merged: [{trip, expected, got}], notes: [text] }
 */
CsSplit.merge = function(doc, di, opts) {
    var out = { ok: false, why: "", merged: [], notes: [] };
    if (doc.getCurrentBlockId() !== doc.getModelSpaceBlockId()) {
        out.why = "the model space is not the drawing being edited (leave the block or the layout first)";
        return out;
    }
    var xrefs = CsSplit.tripXrefs(doc), mainStations = CsSplit.stationsOf(doc);
    var pick = [];
    for (var i = 0; i < xrefs.length; i++) {
        if (isNull(opts.trips) || opts.trips.indexOf(xrefs[i].trip) >= 0) { pick.push(xrefs[i]); }
    }
    if (pick.length === 0) { out.why = "this drawing has no trip files attached by a split"; return out; }
    for (var p = 0; p < pick.length; p++) {
        var x = pick[p];
        if (x.status === "missing" || CsXref.stampOf(x.full) === 0) {
            out.why = "the file of trip " + x.trip + " is missing: " + x.full;
            return out;
        }
    }
    for (var q = 0; q < pick.length; q++) {
        var m = pick[q];
        var src = CsXref.openSource(m.full);
        if (src === null) { out.why = "could not read " + m.full; return out; }
        try {
            var sdoc = src.doc, expected = 0;
            // the trip file's station copies are compared with the drawing's, and only its own items are brought back
            var cmp = CsSplit.compareStations(mainStations, CsSplit.stationsOf(sdoc), 1e-6);
            if (cmp.missing.length > 0) { out.notes.push("Trip " + m.trip + ": " + cmp.missing.length + " station(s) are not in the drawing: " + cmp.missing.slice(0, 5).join(", ")); }
            if (cmp.moved.length > 0) { out.notes.push("Trip " + m.trip + ": " + cmp.moved.length + " station(s) sit somewhere else than in the drawing: " + cmp.moved.slice(0, 5).join(", ") + " (the drawing's positions were kept)"); }
            CsSplit.allEditable(sdoc, src.di, function() {
                var scan = CsSplit.scan(sdoc);
                CsSplit.deleteIds(sdoc, src.di, CsSplit.toDelete(scan.items, [m.trip]).concat(
                    scan.items.filter(function(it) { return it.kind === "shared"; }).map(function(it) { return it.id; })));
                expected = scan.counts.hasOwnProperty(String(m.trip)) ? scan.counts[String(m.trip)] : 0;
            });
            var before = CsSplit.scan(doc).counts, had = before.hasOwnProperty(String(m.trip)) ? before[String(m.trip)] : 0;
            doc.startTransactionGroup();
            var group = doc.getTransactionGroup();
            var paste = new RPasteOperation(sdoc);
            paste.setText("Merge trip " + m.trip);
            paste.setOffset(new RVector(0, 0));
            paste.setTransactionGroup(group);
            di.applyOperation(paste);
            var after = CsSplit.scan(doc).counts, now = after.hasOwnProperty(String(m.trip)) ? after[String(m.trip)] : 0;
            out.merged.push({ trip: m.trip, expected: expected, got: now - had });
            CsSplit.removeXref(doc, di, m, group);
        }
        finally {
            try { destr(src.di); } catch (eD) { }
        }
    }
    out.ok = true;
    return out;
};

/** Removes a trip's xref: its references, its block, and the layers it brought (when nothing is on them). */
CsSplit.removeXref = function(doc, di, x, group) {
    var prefix = CsXref.layerPrefix(CsXref.stem(x.full));
    var op = new RDeleteObjectsOperation();
    op.setText("Remove trip xref");
    if (!isNull(group) && group >= 0) { op.setTransactionGroup(group); }
    var refs = doc.queryBlockReferences(x.blockId);
    for (var i = 0; i < refs.length; i++) {
        var r = doc.queryEntity(refs[i]);
        if (!isNull(r)) { op.deleteObject(r); }
    }
    var inside = doc.queryBlockEntities(x.blockId);
    for (var k = 0; k < inside.length; k++) {
        var ie = doc.queryEntity(inside[k]);
        if (!isNull(ie)) { op.deleteObject(ie); }
    }
    var block = doc.queryBlock(x.blockId);
    if (!isNull(block)) { op.deleteObject(block); }
    di.applyOperation(op);
    var names = doc.getLayerNames(), lop = new RDeleteObjectsOperation(), any = false;
    lop.setText("Remove trip xref layers");
    if (!isNull(group) && group >= 0) { lop.setTransactionGroup(group); }
    for (var n = 0; n < names.length; n++) {
        var nm = String(names[n]);
        if (nm.indexOf(prefix) !== 0) { continue; }
        var lay = doc.queryLayer(nm);
        if (!isNull(lay)) { lop.deleteObject(lay); any = true; }
    }
    if (any) {
        try { di.applyOperation(lop); } catch (eL) { }
    }
};
