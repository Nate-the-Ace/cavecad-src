// CsXref.js -- external references: another drawing's visuals, brought into this one as a single
// unit that stays linked to its file.
//
// Part of the Cave Survey Core library.
//
// WHAT AN XREF IS HERE. One BLOCK in this drawing holds the other drawing's geometry, its layers named
// "<drawing>|<LAYER>" (so they can never clash with this drawing's own), and a block reference places it.
// The block carries, as CaveSurvey tags on the block DEFINITION:
//   XrefPath       where the file is (as the user chose to store it: absolute or relative)
//   XrefStyle      "overlay" | "attach"
//   XrefPathStyle  "absolute" | "relative"
//   XrefStamp      the file's modified time (ms) when it was last read -- the link: a newer file offers an update
//   XrefAuto       "1" when the user said "always update this one"
//
// ATTACHMENT STYLE (chosen per reference):
//   overlay  the other drawing's OWN geometry only. Whatever it has itself referenced does not come along.
//   attach   its geometry AND whatever it has referenced, to any depth, each reference's own style deciding
//            whether ITS references come too. An attach chain that leads back to this drawing is refused.
// PATH STYLE (chosen per reference): absolute (the full path) or relative (kept relative to this drawing's folder).
// DEFAULTS: what the user chose last (kept in settings); until then Overlay and Absolute.
//
// The first half of this file is PURE (paths, defaults, the nesting plan) and unit-tested; the second half talks
// to the engine through the paste operation the app already has (RPasteOperation: setBlockName,
// setLayerNamePrefix, setUseExistingBlock, setCreateBlockReference).

var CsXref = {};

CsXref.OVERLAY = "overlay";
CsXref.ATTACH = "attach";
CsXref.ABSOLUTE = "absolute";
CsXref.RELATIVE = "relative";

CsXref.KEY = { PATH: "XrefPath", STYLE: "XrefStyle", PATHSTYLE: "XrefPathStyle", STAMP: "XrefStamp", AUTO: "XrefAuto" };

CsXref.SETTING_STYLE = "CaveSurvey/Xref/Style";
CsXref.SETTING_PATHSTYLE = "CaveSurvey/Xref/PathStyle";
CsXref.DEFAULT_STYLE = CsXref.OVERLAY;
CsXref.DEFAULT_PATHSTYLE = CsXref.ABSOLUTE;

// ------------------------------------------------------------------ defaults

/** The remembered choices; `read(key, fallback)` defaults to the app's settings. */
CsXref.defaults = function(read) {
    var get = isNull(read) ? function(k, f) { return String(RSettings.getStringValue(k, f)); } : read;
    var style = get(CsXref.SETTING_STYLE, CsXref.DEFAULT_STYLE);
    var pathStyle = get(CsXref.SETTING_PATHSTYLE, CsXref.DEFAULT_PATHSTYLE);
    return {
        style: style === CsXref.ATTACH ? CsXref.ATTACH : CsXref.DEFAULT_STYLE,
        pathStyle: pathStyle === CsXref.RELATIVE ? CsXref.RELATIVE : CsXref.DEFAULT_PATHSTYLE
    };
};

/** Whatever the user picked becomes the default from now on. */
CsXref.remember = function(style, pathStyle, write) {
    var set = isNull(write) ? function(k, v) { RSettings.setValue(k, v); } : write;
    set(CsXref.SETTING_STYLE, style === CsXref.ATTACH ? CsXref.ATTACH : CsXref.OVERLAY);
    set(CsXref.SETTING_PATHSTYLE, pathStyle === CsXref.RELATIVE ? CsXref.RELATIVE : CsXref.ABSOLUTE);
};

// --------------------------------------------------------------------- paths

/** A path split into { root, parts }: root is "" (relative), "/" or "C:" (and "//host" for a network path). */
CsXref.split = function(path) {
    var p = String(path).replace(/\\/g, "/");
    var root = "";
    var m = /^([A-Za-z]:)(\/|$)/.exec(p);
    if (m) {
        root = m[1];
        p = p.substring(m[1].length);
    }
    else if (p.indexOf("//") === 0) {
        root = "//";
        p = p.substring(2);
    }
    else if (p.charAt(0) === "/") {
        root = "/";
    }
    var raw = p.split("/"), parts = [];
    for (var i = 0; i < raw.length; i++) {
        if (raw[i] === "" || raw[i] === ".") {
            continue;
        }
        if (raw[i] === "..") {
            if (parts.length > 0 && parts[parts.length - 1] !== "..") {
                parts.pop();
            }
            else if (root === "") {
                parts.push("..");
            }
            continue;
        }
        parts.push(raw[i]);
    }
    return { root: root, parts: parts };
};

CsXref.join = function(sp) {
    var body = sp.parts.join("/");
    if (sp.root === "") { return body === "" ? "." : body; }
    if (sp.root === "/" || sp.root === "//") { return sp.root + body; }
    return sp.root + "/" + body;      // a drive
};

CsXref.normalize = function(path) { return CsXref.join(CsXref.split(path)); };
CsXref.isAbsolute = function(path) { return CsXref.split(path).root !== ""; };
CsXref.basename = function(path) { var s = CsXref.split(path); return s.parts.length === 0 ? "" : s.parts[s.parts.length - 1]; };
CsXref.dirname = function(path) { var s = CsXref.split(path); s.parts.pop(); return CsXref.join(s); };

/** The file name without its extension: "Truitt Cave.dxf" -> "Truitt Cave". */
CsXref.stem = function(path) {
    var b = CsXref.basename(path), dot = b.lastIndexOf(".");
    return dot > 0 ? b.substring(0, dot) : b;
};

/** The same file, for comparing paths (case-insensitive: macOS and Windows drives). */
CsXref.key = function(path) { return CsXref.normalize(path).toLowerCase(); };

/** `target` as seen from the folder `fromDir`; stays absolute when they are on different roots. */
CsXref.relative = function(fromDir, target) {
    var a = CsXref.split(fromDir), b = CsXref.split(target);
    if (a.root.toLowerCase() !== b.root.toLowerCase() || b.root === "") {
        return CsXref.normalize(target);
    }
    var i = 0;
    while (i < a.parts.length && i < b.parts.length - 1 && a.parts[i].toLowerCase() === b.parts[i].toLowerCase()) {
        i++;
    }
    var out = [];
    for (var up = i; up < a.parts.length; up++) {
        out.push("..");
    }
    out = out.concat(b.parts.slice(i));
    return out.length === 0 ? "." : out.join("/");
};

/** The full path of a stored one. A relative one needs the folder it is relative to ("" = cannot be resolved). */
CsXref.fullPath = function(stored, baseDir) {
    if (CsXref.isAbsolute(stored)) {
        return CsXref.normalize(stored);
    }
    if (isNull(baseDir) || baseDir === "") {
        return "";
    }
    return CsXref.normalize(String(baseDir) + "/" + stored);
};

/** What to store for a full path: the full path (absolute) or its path from `baseDir` (relative). An unsaved drawing has no folder to be relative to, so it stores absolute. */
CsXref.toStored = function(full, pathStyle, baseDir) {
    if (pathStyle === CsXref.RELATIVE && !isNull(baseDir) && baseDir !== "") {
        return CsXref.relative(baseDir, full);
    }
    return CsXref.normalize(full);
};

// ------------------------------------------------------------ the nesting plan

/**
 * What a drawing sees through its references. PURE: `readRefs(path)` answers the references of the drawing at
 * `path` as [{ path (full), style }] ([] for none or unreadable).
 *
 * Every reference of the root is shown. A reference whose style is ATTACH brings the references of its target
 * along, each of those governed by its own style in turn; an OVERLAY brings its target's own geometry only.
 * An attach that leads back to the root, or round a ring of attaches, is a LOOP: it is reported and not followed.
 *
 * \return { include: [{ path, style, parent, depth }], loops: [{ from, to }] }; a file reachable twice is shown once.
 */
CsXref.plan = function(rootPath, readRefs) {
    var out = { include: [], loops: [] };
    var seen = {};
    var rootKey = CsXref.key(rootPath);
    var walk = function(path, chain, depth) {
        var refs = readRefs(path);
        for (var i = 0; i < refs.length; i++) {
            var r = refs[i], k = CsXref.key(r.path);
            if (k === rootKey || chain.indexOf(k) >= 0) {
                if (r.style === CsXref.ATTACH) {
                    out.loops.push({ from: path, to: r.path });
                }
                continue;                 // an overlay back to a drawing already in the chain adds nothing and is harmless
            }
            if (!seen.hasOwnProperty(k)) {
                seen[k] = true;
                out.include.push({ path: r.path, style: r.style, parent: path, depth: depth });
            }
            if (r.style === CsXref.ATTACH) {
                walk(r.path, chain.concat([k]), depth + 1);
            }
        }
    };
    walk(rootPath, [rootKey], 1);
    return out;
};

/** A block name that is safe and not taken: "XREF-Truitt Cave", "XREF-Truitt Cave-2"... (`taken(name)` says whether it exists). */
CsXref.blockNameFor = function(stem, taken) {
    var base = "XREF-" + String(stem).replace(/[<>\/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    var name = base, n = 2;
    while (taken(name)) {
        name = base + "-" + n;
        n++;
    }
    return name;
};

/** The layer prefix an xref's layers get: "Truitt Cave|". */
CsXref.layerPrefix = function(stem) {
    return String(stem).replace(/[<>\/\\":;?*|,=`]/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "") + "|";
};

// =================================================================== the engine half

/** The folder of a drawing ("" when it has not been saved). */
CsXref.baseDirOf = function(doc) {
    var f = "";
    try { f = String(doc.getFileName()); } catch (e) { f = ""; }
    return (f === "" || f === "undefined" || f === "null") ? "" : CsXref.dirname(f);
};

/** The file's modified time in ms, or 0 when it is not there. */
CsXref.stampOf = function(path) {
    try {
        var fi = new QFileInfo(path);
        return fi.exists() ? Number(fi.lastModified().toMSecsSinceEpoch()) : 0;
    }
    catch (e) {
        return 0;
    }
};

/** The tags of an xref block definition, or null when it is not an xref. */
CsXref.tagsOf = function(block) {
    var p = CsTags.get(block, CsXref.KEY.PATH);
    if (p === "") {
        return null;
    }
    var st = CsTags.get(block, CsXref.KEY.STYLE), ps = CsTags.get(block, CsXref.KEY.PATHSTYLE);
    var stamp = parseFloat(CsTags.get(block, CsXref.KEY.STAMP));
    return {
        path: p,
        style: st === CsXref.ATTACH ? CsXref.ATTACH : CsXref.OVERLAY,
        pathStyle: ps === CsXref.RELATIVE ? CsXref.RELATIVE : CsXref.ABSOLUTE,
        stamp: isNaN(stamp) ? 0 : stamp,
        auto: CsTags.get(block, CsXref.KEY.AUTO) === "1"
    };
};

/**
 * Every xref in a drawing: [{ blockId, name, stored, style, pathStyle, full, status, auto }].
 * status: "missing" (no file), "changed" (the file is newer than what was read), "ok", "unresolved" (a relative
 * path in a drawing that has no folder yet).
 */
CsXref.listIn = function(doc) {
    var out = [];
    var base = CsXref.baseDirOf(doc);
    var ids = doc.queryAllBlocks();
    for (var i = 0; i < ids.length; i++) {
        var block = doc.queryBlock(ids[i]);
        if (isNull(block)) {
            continue;
        }
        var t = CsXref.tagsOf(block);
        if (t === null) {
            continue;
        }
        var full = CsXref.fullPath(t.path, base);
        var now = full === "" ? 0 : CsXref.stampOf(full);
        var status = full === "" ? "unresolved" : (now === 0 ? "missing" : (now > t.stamp ? "changed" : "ok"));
        out.push({ blockId: ids[i], name: String(block.getName()), stored: t.path, style: t.style, pathStyle: t.pathStyle,
            full: full, stamp: t.stamp, now: now, status: status, auto: t.auto });
    }
    return out;
};

/** Opens a drawing file into a memory document, or null. */
CsXref.openSource = function(path) {
    try {
        var sdoc = new RDocument(new RMemoryStorage(), createSpatialIndex());
        var sdi = new RDocumentInterface(sdoc);
        sdi.setNotifyListeners(false);
        if (sdi.importFile(path, "", false) !== RDocumentInterface.IoErrorNoError) {
            return null;
        }
        return { doc: sdoc, di: sdi };
    }
    catch (e) {
        return null;
    }
};

/** The references a drawing in memory holds, as [{ path (full), style }], read from its xref blocks. */
CsXref.refsInDoc = function(sdoc, sourceFile) {
    var out = [];
    var base = CsXref.dirname(sourceFile);
    var ids = sdoc.queryAllBlocks();
    for (var i = 0; i < ids.length; i++) {
        var block = sdoc.queryBlock(ids[i]);
        var t = isNull(block) ? null : CsXref.tagsOf(block);
        if (t !== null) {
            var full = CsXref.fullPath(t.path, base);
            if (full !== "") {
                out.push({ path: full, style: t.style });
            }
        }
    }
    return out;
};

/** The references of the drawing FILE at `path` (opens it; cached for one planning). */
CsXref.refsOfFile = function(path, cache) {
    var k = CsXref.key(path);
    if (!isNull(cache) && cache.hasOwnProperty(k)) {
        return cache[k];
    }
    var src = CsXref.openSource(path);
    var refs = src === null ? [] : CsXref.refsInDoc(src.doc, path);
    if (!isNull(cache)) {
        cache[k] = refs;
    }
    return refs;
};

/**
 * Would attaching `source` in this drawing make a loop? (Only an attach can: an overlay brings nothing back.)
 * \return the loops found, [] for none
 */
CsXref.loopsIf = function(doc, source, style) {
    var thisFile = "";
    try { thisFile = String(doc.getFileName()); } catch (e) { thisFile = ""; }
    if (style !== CsXref.ATTACH || thisFile === "" || thisFile === "undefined") {
        return [];
    }
    var cache = {};
    var mine = [];
    var existing = CsXref.listIn(doc);
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].full !== "") {
            mine.push({ path: existing[i].full, style: existing[i].style });
        }
    }
    mine.push({ path: source, style: style });
    var reader = function(path) {
        return CsXref.key(path) === CsXref.key(thisFile) ? mine : CsXref.refsOfFile(path, cache);
    };
    return CsXref.plan(thisFile, reader).loops;
};

/** Overlay: take the xref blocks (and their references) OUT of the source in memory, so only its own geometry comes. */
CsXref.stripNested = function(src) {
    var ids = src.doc.queryAllBlocks();
    var del = new RDeleteObjectsOperation(false);
    var any = false;
    for (var i = 0; i < ids.length; i++) {
        var block = src.doc.queryBlock(ids[i]);
        if (isNull(block) || CsXref.tagsOf(block) === null) {
            continue;
        }
        var refs = src.doc.queryBlockReferences(ids[i]);
        for (var r = 0; r < refs.length; r++) {
            var ref = src.doc.queryEntity(refs[r]);
            if (!isNull(ref)) { del.deleteObject(ref); any = true; }
        }
        del.deleteObject(block);
        any = true;
    }
    if (any) {
        src.di.applyOperation(del);
    }
};

/** Writes the xref tags onto the block definition. */
CsXref.tagBlock = function(doc, di, name, info) {
    var block = doc.queryBlock(name);
    if (isNull(block)) {
        return false;
    }
    CsTags.set(block, CsXref.KEY.PATH, info.stored);
    CsTags.set(block, CsXref.KEY.STYLE, info.style);
    CsTags.set(block, CsXref.KEY.PATHSTYLE, info.pathStyle);
    CsTags.set(block, CsXref.KEY.STAMP, String(info.stamp));
    if (info.auto === true) { CsTags.set(block, CsXref.KEY.AUTO, "1"); }
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("External reference"));
    if (!isNull(info.group) && info.group >= 0) { op.setTransactionGroup(info.group); }
    op.addObject(block, false);
    di.applyOperation(op);
    return true;
};

/**
 * Attaches a drawing file: one block holding its visuals, its layers prefixed, and one reference placing it.
 *
 * \param opts { style, pathStyle, at (RVector), scale, rotation }
 * \return { ok, why, name }
 */
CsXref.attach = function(doc, di, sourceFile, opts) {
    var o = opts || {};
    var d = CsXref.defaults();
    var style = o.style || d.style, pathStyle = o.pathStyle || d.pathStyle;
    var full = CsXref.normalize(sourceFile);
    var loops = CsXref.loopsIf(doc, full, style);
    if (loops.length > 0) {
        return { ok: false, why: qsTr("%1 already refers to this drawing, so attaching it would go round in a circle. Use Overlay, or attach it from the other drawing.").arg(CsXref.basename(full)) };
    }
    var src = CsXref.openSource(full);
    if (src === null) {
        return { ok: false, why: qsTr("%1 could not be read.").arg(full) };
    }
    if (style === CsXref.OVERLAY) {
        CsXref.stripNested(src);
    }
    var stem = CsXref.stem(full);
    var name = CsXref.blockNameFor(stem, function(n) { return doc.hasBlock(n); });
    var base = CsXref.baseDirOf(doc);
    var stored = CsXref.toStored(full, pathStyle, base);
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    var op = new RPasteOperation(src.doc);
    op.setText(qsTr("Attach drawing"));
    op.setBlockName(name);
    op.setLayerNamePrefix(CsXref.layerPrefix(stem));
    op.setOverwriteBlocks(true);
    op.setOffset(isNull(o.at) ? new RVector(0, 0) : o.at);
    op.setScale(isNull(o.scale) ? 1.0 : o.scale);
    op.setRotation(isNull(o.rotation) ? 0.0 : o.rotation);
    op.setTransactionGroup(group);
    di.applyOperation(op);
    if (!doc.hasBlock(name)) {
        return { ok: false, why: qsTr("Attaching %1 did not make a block.").arg(stem) };
    }
    CsXref.tagBlock(doc, di, name, { stored: stored, style: style, pathStyle: pathStyle, stamp: CsXref.stampOf(full), group: group });
    CsXref.remember(style, pathStyle);
    return { ok: true, why: "", name: name };
};

/**
 * Reads the file again into an existing xref block. The block's references keep their place.
 * \param opts { style } to change the attachment style while reloading
 */
CsXref.reload = function(doc, di, blockId, opts) {
    var o = opts || {};
    var block = doc.queryBlock(blockId);
    var t = isNull(block) ? null : CsXref.tagsOf(block);
    if (t === null) {
        return { ok: false, why: qsTr("That is not an external reference.") };
    }
    var full = CsXref.fullPath(t.path, CsXref.baseDirOf(doc));
    if (full === "" || CsXref.stampOf(full) === 0) {
        return { ok: false, why: qsTr("The file is missing; the picture is kept as it was: %1").arg(full === "" ? t.path : full) };
    }
    var style = o.style || t.style;
    var loops = CsXref.loopsIf(doc, full, style);
    if (loops.length > 0) {
        return { ok: false, why: qsTr("Attaching that would go round in a circle.") };
    }
    var src = CsXref.openSource(full);
    if (src === null) {
        return { ok: false, why: qsTr("%1 could not be read; the picture is kept as it was.").arg(full) };
    }
    if (style === CsXref.OVERLAY) {
        CsXref.stripNested(src);
    }
    var name = String(block.getName());
    var stem = CsXref.stem(full);
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    // empty the block, then read the file into it: one undo step
    var del = new RDeleteObjectsOperation();
    del.setText(qsTr("Update external reference"));
    del.setTransactionGroup(group);
    var old = doc.queryBlockEntities(blockId);
    for (var i = 0; i < old.length; i++) {
        var e = doc.queryEntity(old[i]);
        if (!isNull(e)) { del.deleteObject(e); }
    }
    di.applyOperation(del);
    var op = new RPasteOperation(src.doc);
    op.setText(qsTr("Update external reference"));
    op.setBlockName(name);
    op.setUseExistingBlock(true);
    op.setCreateBlockReference(false);
    op.setLayerNamePrefix(CsXref.layerPrefix(stem));
    op.setOverwriteBlocks(true);
    op.setTransactionGroup(group);
    di.applyOperation(op);
    CsXref.tagBlock(doc, di, name, { stored: t.path, style: style, pathStyle: t.pathStyle, stamp: CsXref.stampOf(full), auto: t.auto, group: group });
    return { ok: true, why: "", name: name };
};

/** Changes how the path is stored (absolute <-> relative) without reading the file again. */
CsXref.setPathStyle = function(doc, di, blockId, pathStyle) {
    var block = doc.queryBlock(blockId);
    var t = isNull(block) ? null : CsXref.tagsOf(block);
    if (t === null) {
        return { ok: false, why: qsTr("That is not an external reference.") };
    }
    var base = CsXref.baseDirOf(doc);
    if (pathStyle === CsXref.RELATIVE && base === "") {
        return { ok: false, why: qsTr("Save this drawing first: a relative path is relative to its folder.") };
    }
    var full = CsXref.fullPath(t.path, base);
    if (full === "") {
        return { ok: false, why: qsTr("The path cannot be worked out until this drawing is saved.") };
    }
    CsXref.tagBlock(doc, di, String(block.getName()), { stored: CsXref.toStored(full, pathStyle, base), style: t.style,
        pathStyle: pathStyle, stamp: t.stamp, auto: t.auto });
    CsXref.remember(t.style, pathStyle);
    return { ok: true, why: "" };
};

/** Makes the xref an ordinary block: the link is dropped, the picture stays (Bind). */
CsXref.detach = function(doc, di, blockId) {
    var block = doc.queryBlock(blockId);
    if (isNull(block) || CsXref.tagsOf(block) === null) {
        return { ok: false, why: qsTr("That is not an external reference.") };
    }
    for (var k in CsXref.KEY) {
        if (CsXref.KEY.hasOwnProperty(k)) {
            CsTags.remove(block, CsXref.KEY[k]);
        }
    }
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("Bind external reference"));
    op.addObject(block, false);
    di.applyOperation(op);
    return { ok: true, why: "" };
};

/** Sets or clears "always update this one". */
CsXref.setAuto = function(doc, di, blockId, on) {
    var block = doc.queryBlock(blockId);
    var t = isNull(block) ? null : CsXref.tagsOf(block);
    if (t === null) {
        return { ok: false, why: qsTr("That is not an external reference.") };
    }
    if (on) { CsTags.set(block, CsXref.KEY.AUTO, "1"); } else { CsTags.remove(block, CsXref.KEY.AUTO); }
    var op = new RModifyObjectsOperation();
    op.setText(qsTr("External reference"));
    op.addObject(block, false);
    di.applyOperation(op);
    return { ok: true, why: "" };
};

/** The xref block a block reference points to, as { blockId, name } or null. */
CsXref.xrefOfReference = function(doc, ref) {
    try {
        if (ref.getType() !== RS.EntityBlockRef) { return null; }
        var block = doc.queryBlock(ref.getReferencedBlockId());
        return (isNull(block) || CsXref.tagsOf(block) === null) ? null : { blockId: block.getId(), name: String(block.getName()) };
    }
    catch (e) {
        return null;
    }
};
