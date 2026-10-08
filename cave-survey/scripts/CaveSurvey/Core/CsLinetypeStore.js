// CsLinetypeStore.js -- where Linetype Maker's linetypes live.
//
// A caver's own linetypes live in ONE .lin file beside their caves,
// ~/Documents/Cave/linetypes/CaveCustomLinetypes.lin: that folder syncs
// and is backed up, and no release touches it. NOT the template -- the
// Symbol Palette kept customs in the template until publish.sh replaced
// it and took a real symbol with it (2026-09-06).
//
// A drawing's linetypes are RLinetype objects in its document; this file
// is the only code that writes them, so the one trap below is handled once.

var CsLinetypeStore = {};

CsLinetypeStore.CUSTOM_NAME = "CaveCustomLinetypes.lin";

/** Tests point the library at a scratch file. */
CsLinetypeStore.pathOverride = null;

CsLinetypeStore.BUILT_IN = ["BYLAYER", "BYBLOCK", "CONTINUOUS"];

CsLinetypeStore.customPath = function() {
    if (CsLinetypeStore.pathOverride !== null) {
        return CsLinetypeStore.pathOverride;
    }
    try {
        var setting = RSettings.getStringValue("CaveSurvey/LinetypeLibrary", "");
        if (setting !== "") {
            return setting;
        }
    } catch (eSet) {
    }
    return QDir.homePath() + "/Documents/Cave/linetypes/" + CsLinetypeStore.CUSTOM_NAME;
};

CsLinetypeStore.readText = function(path) {
    var f = new QFile(path);
    if (!f.exists() || !f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var stream = new QTextStream(f);
    try {
        stream.setEncoding(QStringConverter.Utf8);
    } catch (eEnc) {
        // an older bridge reads in the locale's codec, UTF-8 everywhere
    }
    var text = String(stream.readAll());
    f.close();
    return text;
};

/** \return null on success, else a sentence saying what failed. */
CsLinetypeStore.writeText = function(path, text) {
    try {
        new QDir().mkpath(new QFileInfo(path).absolutePath());
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Truncate | QIODevice.Text)) {
            return "Could not write " + path + ".";
        }
        var stream = new QTextStream(f);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(text);
        stream.flush();
        f.close();
        return null;
    } catch (e) {
        return "Could not write " + path + " (" + e + ").";
    }
};

/** \return { linetypes, errors } -- empty when the file does not exist yet. */
CsLinetypeStore.loadCustom = function() {
    var text = CsLinetypeStore.readText(CsLinetypeStore.customPath());
    if (text === null) {
        return { linetypes: [], errors: [] };
    }
    return CsLinetype.parseLin(text);
};

CsLinetypeStore.indexOf = function(list, name) {
    var want = String(name).toUpperCase();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].name).toUpperCase() === want) {
            return i;
        }
    }
    return -1;
};

/** Adds or replaces (by name, any case). \return null or an error. */
CsLinetypeStore.saveCustom = function(model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, model.name);
    if (at >= 0) {
        list[at] = model;
    } else {
        list.push(model);
    }
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

CsLinetypeStore.removeCustom = function(name) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, name);
    if (at < 0) {
        return "No linetype called " + name + " in your library.";
    }
    list.splice(at, 1);
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

/**
 * Whether the drawing has a linetype of that name (any case).
 *
 * NOT isNull(doc.queryLinetype(name)): for a name the drawing does not
 * have, queryLinetype hands script a live-looking RLinetype wrapper whose
 * getId() answers undefined -- probed 2026-09-28. Treating that as "found"
 * modified a phantom and the new linetype never landed.
 */
CsLinetypeStore.hasLinetype = function(doc, name) {
    var want = String(name).toUpperCase();
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        if (String(names[i]).toUpperCase() === want) {
            return true;
        }
    }
    return false;
};

/**
 * Drawing units per pattern unit. A Linetype Maker length is in DRAWING
 * units -- 0.5 on a feet map is half a foot -- but the engine reads a
 * stored pattern in inches (imperial) or mm (metric) and converts it to
 * the drawing's unit when it draws (RExporter::getLineTypePatternScale).
 * Stored = model / factor; model = stored * factor. The call mirrors the
 * engine's exactly, unit None included, so the two cannot disagree.
 *
 * Found on Truitt (feet): a 0.5 dash was stored as half an INCH, and a
 * 580 ft wall needed ~9000 repeats -- past the engine's DashThreshold of
 * 1000 -- so it drew solid and the linetype looked broken.
 */
CsLinetypeStore.unitFactor = function(doc) {
    var f = RUnit.convert(1.0, doc.isMetric() ? RS.Millimeter : RS.Inch, doc.getUnit());
    return f > 0 && isFinite(f) ? f : 1.0;
};

/** Every linetype in a drawing as a model, built-ins left out. */
CsLinetypeStore.fromDocument = function(doc) {
    var out = [];
    var factor = CsLinetypeStore.unitFactor(doc);
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        if (CsLinetypeStore.BUILT_IN.indexOf(name.toUpperCase()) >= 0) {
            continue;
        }
        var lt = doc.queryLinetype(name);
        var r = CsLinetype.fromPattern(String(lt.getPatternString()));
        if (r.errors.length > 0 || r.segments.length === 0) {
            continue;
        }
        out.push(CsLinetype.scaled({ name: name, description: String(lt.getDescription()),
                                     segments: r.segments }, factor));
    }
    return out;
};

/**
 * Adds the linetype to the drawing, or replaces the pattern of the one
 * already there under that name.
 *
 * RAddObjectOperation's second argument is FALSE on purpose: true (the
 * default) stamps the current attributes over the object -- the trap the
 * Symbol Palette found moving blocks between documents.
 *
 * \return null on success, else a sentence.
 */
CsLinetypeStore.applyToDocument = function(doc, di, model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var stored = CsLinetype.toPattern(
        CsLinetype.scaled(model, 1.0 / CsLinetypeStore.unitFactor(doc)));
    var pat = new RLinetypePattern(doc.isMetric(), model.name, model.description || "");
    if (!pat.setPatternString(stored)) {
        return "CaveCAD refused the pattern " + stored + ".";
    }
    var lt;
    if (CsLinetypeStore.hasLinetype(doc, model.name)) {
        lt = doc.queryLinetype(model.name);
        lt.setPattern(pat);
    } else {
        lt = new RLinetype(doc, pat);
    }
    di.applyOperation(new RAddObjectOperation(lt, false));

    if (!CsLinetypeStore.hasLinetype(doc, model.name)) {
        return "The linetype did not land in the drawing.";
    }
    return null;
};

/**
 * The fonts a text linetype can use: every font CaveCAD has, less the
 * shape fonts (their glyphs are named shapes, not letters).
 */
CsLinetypeStore.fontNames = function() {
    var out = [];
    var names = RFontList.getNames();
    for (var i = 0; i < names.length; i++) {
        var n = String(names[i]);
        if (/shp$/i.test(n)) {
            continue;
        }
        out.push(n);
    }
    return out;
};

/**
 * The engine's own glyph paths for a text at zero offset -- the exact
 * strokes CaveCAD draws and prints. [] when the engine will not draw it.
 */
CsLinetypeStore.textPaths = function(text, style, scale, rotation) {
    try {
        var p = new RLinetypePattern(true, "CS_MEASURE", "");
        var seg = CsLinetype.segment(1);
        seg.text = String(text);
        seg.style = String(style);
        seg.scale = Number(scale) > 0 ? Number(scale) : 1;
        seg.rotation = Number(rotation) || 0;
        if (!p.setPatternString(CsLinetype.toPattern({ segments: [seg, CsLinetype.segment(-1)] }))) {
            return [];
        }
        var paths = p.getShapeAt(0);
        return paths.length > 0 ? paths : [];
    } catch (e) {
        return [];
    }
};

/** A segment's text box at zero offset: {minX,minY,maxX,maxY}, or null. */
CsLinetypeStore.textBox = function(seg) {
    var paths = CsLinetypeStore.textPaths(seg.text, seg.style, seg.scale, seg.rotation);
    var box = null;
    for (var i = 0; i < paths.length; i++) {
        var b = paths[i].getBoundingBox();
        var lo = b.getMinimum(), hi = b.getMaximum();
        if (box === null) {
            box = { minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y };
        } else {
            box.minX = Math.min(box.minX, lo.x);
            box.minY = Math.min(box.minY, lo.y);
            box.maxX = Math.max(box.maxX, hi.x);
            box.maxY = Math.max(box.maxY, hi.y);
        }
    }
    return box;
};

/** Sets x/y from the segment's anchor. No-op for plain rows and "custom". */
CsLinetypeStore.anchorize = function(seg) {
    if (seg.text === "" || seg.shape || CsLinetype.ANCHORS.indexOf(seg.anchor) < 0) {
        return;
    }
    var box = CsLinetypeStore.textBox(seg);
    if (box === null) {
        return;
    }
    var o = CsLinetype.anchorOffset(seg.anchor, box, seg.length);
    seg.x = o.x;
    seg.y = o.y;
};

/**
 * Sizes a text row's gap to its text (CsLinetype.fitTextRow), from the
 * engine's measured width. seg.fitWidth remembers the width it was fitted
 * at, so the next change grows or shrinks the gap by the difference; it
 * is never written to a .lin or DXF.
 */
CsLinetypeStore.fitText = function(seg) {
    if (seg.text === "" || seg.shape) {
        return;
    }
    var box = CsLinetypeStore.textBox(seg);
    if (box === null) {
        return;
    }
    var width = box.maxX - box.minX;
    CsLinetype.fitTextRow(seg, width, seg.fitWidth);
    seg.fitWidth = width;
};

/** Fills every text row's anchor from its offsets (loaded linetypes). */
CsLinetypeStore.deriveAnchors = function(model) {
    for (var i = 0; i < model.segments.length; i++) {
        var seg = model.segments[i];
        if (seg.text === "" || seg.shape) {
            seg.anchor = "";
            continue;
        }
        var box = CsLinetypeStore.textBox(seg);
        seg.anchor = box === null ? "custom" : CsLinetype.anchorOf(seg, box);
        // the width it arrived at: the next edit resizes from here, and
        // opening a linetype never changes it by itself
        seg.fitWidth = box === null ? undefined : box.maxX - box.minX;
    }
    return model;
};

/**
 * Linetypes from a file a caver picked: a .lin read as text, anything
 * else opened as a drawing offscreen and its linetypes read back.
 * \return { linetypes, errors }
 */
CsLinetypeStore.readImport = function(path) {
    var p = String(path);
    if (/\.lin$/i.test(p)) {
        var text = CsLinetypeStore.readText(p);
        if (text === null) {
            return { linetypes: [], errors: ["Could not read " + p + "."] };
        }
        return CsLinetype.parseLin(text);
    }
    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), new RSpatialIndexNavel()));
    try {
        if (di.importFile(p, "", false) !== RDocumentInterface.IoErrorNoError) {
            return { linetypes: [], errors: ["CaveCAD could not open " + p + "."] };
        }
        return { linetypes: CsLinetypeStore.fromDocument(di.getDocument()), errors: [] };
    } finally {
        if (typeof destr === "function") {
            destr(di);
        }
    }
};

/**
 * The template pour's step: every custom linetype into a new drawing.
 * \return the names that could not be added.
 */
CsLinetypeStore.applyAll = function(doc, di) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var failed = [];
    for (var i = 0; i < list.length; i++) {
        if (CsLinetypeStore.applyToDocument(doc, di, list[i]) !== null) {
            failed.push(list[i].name);
        }
    }
    return failed;
};
