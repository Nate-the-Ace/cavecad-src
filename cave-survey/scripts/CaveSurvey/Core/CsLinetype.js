// CsLinetype.js -- a linetype as data: the pure half of Linetype Maker.
//
// A linetype is a repeating list of SEGMENTS. A positive length draws a
// dash, a negative one leaves a gap, zero is a dot. Any segment may carry
// a TEXT (or, from phase 2, a SHAPE) that the engine draws at the END of
// that segment -- the same place RExporter puts it, which is why a text
// is modelled as a property of the segment it follows and not as a
// segment of its own: the engine indexes it that way, the .lin syntax
// writes it that way, and a model shaped differently would need a
// translation in both directions that could drift.
//
// No engine calls here: this file runs under node too (tests/js_unit.js).

var CsLinetype = {};

/** Serialised lines past this risk dxflib's 1023-character line limit. */
CsLinetype.MAX_LINE = 1000;

/** DXF symbol-table names: no spaces, nothing a .lin header would split. */
CsLinetype.NAME_RE = /^[A-Za-z0-9_\-$]+$/;

/** The engine reads embedded text as [^, ]* -- no spaces, no commas. */
CsLinetype.TEXT_RE = /^[^\s,"\[\]]+$/;

CsLinetype.segment = function(length) {
    return { length: Number(length), text: "", style: "", shape: false,
             scale: 1, rotation: 0, x: 0, y: 0, anchor: "" };
};

CsLinetype.kindOf = function(seg) {
    if (seg.text !== "") {
        return seg.shape ? "shape" : "text";
    }
    if (seg.length > 0) {
        return "dash";
    }
    if (seg.length < 0) {
        return "gap";
    }
    return "dot";
};

/** A number as .lin writes it: no float noise, no "-0". */
CsLinetype.num = function(v) {
    var r = Math.round(Number(v) * 1e6) / 1e6;
    if (r === 0) {
        r = 0;
    }
    return String(r);
};

CsLinetype.toPattern = function(model) {
    var parts = ["A"];
    for (var i = 0; i < model.segments.length; i++) {
        var seg = model.segments[i];
        parts.push(CsLinetype.num(seg.length));
        if (seg.text === "") {
            continue;
        }
        var g = (seg.shape ? seg.text : '"' + seg.text + '"') + "," + seg.style;
        g += ",S=" + CsLinetype.num(seg.scale);
        if (Number(seg.rotation) !== 0) {
            g += ",R=" + CsLinetype.num(seg.rotation);
        }
        if (Number(seg.x) !== 0) {
            g += ",X=" + CsLinetype.num(seg.x);
        }
        if (Number(seg.y) !== 0) {
            g += ",Y=" + CsLinetype.num(seg.y);
        }
        parts.push("[" + g + "]");
    }
    return parts.join(",");
};

/** Splits on commas outside brackets and quotes. */
CsLinetype.splitTop = function(text) {
    var out = [], cur = "", depth = 0, quoted = false;
    for (var i = 0; i < text.length; i++) {
        var c = text.charAt(i);
        if (c === '"') {
            quoted = !quoted;
        } else if (!quoted && c === "[") {
            depth++;
        } else if (!quoted && c === "]") {
            depth--;
        }
        if (c === "," && depth === 0 && !quoted) {
            out.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
};

/** \return { segments, errors } */
CsLinetype.fromPattern = function(text) {
    var segments = [], errors = [];
    var parts = CsLinetype.splitTop(String(text).trim());
    if (parts.length > 0 && /^[AS]$/i.test(parts[0].trim())) {
        parts.shift();
    }
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part === "") {
            continue;
        }
        if (part.charAt(0) !== "[") {
            var len = Number(part);
            if (!isFinite(len)) {
                errors.push("'" + part + "' is not a length");
                continue;
            }
            segments.push(CsLinetype.segment(len));
            continue;
        }
        if (segments.length === 0) {
            errors.push("'" + part + "' has no dash or gap before it");
            continue;
        }
        var inner = CsLinetype.splitTop(part.replace(/^\[/, "").replace(/\]$/, ""));
        var seg = segments[segments.length - 1];
        var name = (inner[0] || "").trim();
        seg.shape = name.charAt(0) !== '"';
        seg.text = name.replace(/^"/, "").replace(/"$/, "");
        seg.style = (inner[1] || "").trim();
        for (var k = 2; k < inner.length; k++) {
            var kv = /^\s*([SRAXY])[^=]*=\s*(.+?)\s*$/i.exec(inner[k]);
            if (kv === null) {
                continue;
            }
            var v = Number(kv[2]);
            switch (kv[1].toUpperCase()) {
            case "S": seg.scale = v; break;
            case "R": case "A": seg.rotation = v; break;
            case "X": seg.x = v; break;
            case "Y": seg.y = v; break;
            }
        }
    }
    return { segments: segments, errors: errors };
};

/**
 * A linetype's CATEGORY (how the Draw panel groups it) rides in the .lin
 * as a comment line just above its entry -- ";;@category Water" -- so the
 * file stays a valid .lin for AutoCAD, which skips it as a comment.
 */
CsLinetype.CATEGORY_TAG = ";;@category ";

/** \return { linetypes: [model], errors: [string] } */
CsLinetype.parseLin = function(text) {
    var lines = String(text).split(/\r?\n/);
    var linetypes = [], errors = [], cur = null, category = "";
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf(CsLinetype.CATEGORY_TAG) === 0) {
            category = line.substring(CsLinetype.CATEGORY_TAG.length).trim();
            continue;
        }
        if (line === "" || line.indexOf(";;") === 0) {
            continue;
        }
        if (line.charAt(0) === "*") {
            var header = line.substring(1);
            var comma = header.indexOf(",");
            cur = { name: (comma < 0 ? header : header.substring(0, comma)).trim(),
                    description: comma < 0 ? "" : header.substring(comma + 1).trim(),
                    category: category, segments: null };
            category = "";
            continue;
        }
        if (cur === null || cur.segments !== null) {
            errors.push("line " + (i + 1) + ": a pattern with no *NAME line above it");
            continue;
        }
        var r = CsLinetype.fromPattern(line);
        if (r.errors.length > 0) {
            errors.push(cur.name + ": " + r.errors.join("; "));
            cur = null;
            continue;
        }
        cur.segments = r.segments;
        linetypes.push(cur);
    }
    return { linetypes: linetypes, errors: errors };
};

CsLinetype.writeLin = function(models) {
    var out = "";
    for (var i = 0; i < models.length; i++) {
        var cat = String(models[i].category || "").replace(/[\r\n]/g, " ").trim();
        if (cat !== "") {
            out += CsLinetype.CATEGORY_TAG + cat + "\n";
        }
        out += "*" + models[i].name + "," + (models[i].description || "") + "\n";
        out += CsLinetype.toPattern(models[i]) + "\n";
    }
    return out;
};

/**
 * A copy of the model with every length multiplied by f: dash and gap
 * lengths, text sizes and text offsets. Rotation is an angle and stays.
 * The same set RLinetypePattern::scale touches, so converting a model and
 * converting the engine's pattern agree.
 */
CsLinetype.scaled = function(model, f) {
    var out = { name: model.name, description: model.description,
                category: model.category, segments: [] };
    for (var i = 0; i < model.segments.length; i++) {
        var s = model.segments[i], c = {};
        for (var k in s) {
            if (s.hasOwnProperty(k)) {
                c[k] = s[k];
            }
        }
        c.length = s.length * f;
        c.scale = s.scale * f;
        c.x = s.x * f;
        c.y = s.y * f;
        if (s.fitWidth !== undefined) {
            c.fitWidth = s.fitWidth * f;
        }
        out.segments.push(c);
    }
    return out;
};

/** \return plain-language problems; empty means it can be saved. */
CsLinetype.validate = function(model) {
    var out = [];
    var name = String(model.name || "");
    if (name === "") {
        out.push("Give the linetype a name.");
    } else if (!CsLinetype.NAME_RE.test(name)) {
        out.push("A name may use letters, digits, _ - and $ only -- no spaces.");
    }
    var segs = model.segments || [];
    if (segs.length === 0) {
        out.push("Add at least one dash or gap.");
        return out;
    }
    var draws = false, period = 0;
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i], row = "Row " + (i + 1) + ": ";
        if (!isFinite(Number(s.length))) {
            out.push(row + "the length is not a number.");
            continue;
        }
        period += Math.abs(s.length);
        if (s.length >= 0 || s.text !== "") {
            draws = true;
        }
        if (s.text !== "") {
            if (!CsLinetype.TEXT_RE.test(s.text)) {
                out.push(row + "text cannot contain spaces, commas, quotes or brackets.");
            }
            if (String(s.style || "") === "") {
                out.push(row + "text needs a font.");
            }
            if (!(Number(s.scale) > 0)) {
                out.push(row + "the text size must be above zero.");
            }
        }
    }
    if (!draws) {
        out.push("A pattern of only gaps draws nothing.");
    }
    if (period === 0) {
        out.push("The pattern has no length.");
    }
    if (CsLinetype.toPattern(model).length > CsLinetype.MAX_LINE ||
            ("*" + name + "," + (model.description || "")).length > CsLinetype.MAX_LINE) {
        out.push("Too long to save safely -- shorten the texts or the description.");
    }
    return out;
};

// ---------------------------------------------------------------------
// Text anchoring.
//
// A .lin or DXF linetype stores only an X/Y offset for its text, measured
// from the END of the row the text belongs to. An anchor is the caver's
// way of saying where the text should sit instead: horizontally in its
// own row (Left = starts at the row's start, Center = centred in the row,
// Right = ends at the row's end) and vertically on the line (Top = hangs
// below it, Middle = centred on it, Bottom = sits on it). The offsets are
// computed from the text's measured box, and read back the same way: a
// linetype whose offsets match an anchor shows that anchor; anything else
// is "custom". Nothing extra is stored, so it survives any .lin or DXF.
// ---------------------------------------------------------------------

CsLinetype.ANCHORS = ["TL", "TC", "TR", "ML", "MC", "MR", "BL", "BC", "BR"];
CsLinetype.DEFAULT_ANCHOR = "MC";
CsLinetype.ANCHOR_LABELS = {
    TL: "Top left", TC: "Top center", TR: "Top right",
    ML: "Middle left", MC: "Middle center", MR: "Middle right",
    BL: "Bottom left", BC: "Bottom center", BR: "Bottom right",
    custom: "Custom (X/Y)"
};

/**
 * The X/Y offset that puts text with this box at this anchor.
 * box: the text's extent at zero offset, rotation applied
 *      ({minX, minY, maxX, maxY}, relative to its insertion point).
 */
CsLinetype.anchorOffset = function(anchor, box, rowLength) {
    var span = Math.abs(Number(rowLength) || 0);
    var v = anchor.charAt(0), h = anchor.charAt(1);
    var refX = h === "L" ? -span : (h === "C" ? -span / 2 : 0);
    var boxX = h === "L" ? box.minX : (h === "C" ? (box.minX + box.maxX) / 2 : box.maxX);
    var boxY = v === "T" ? box.maxY : (v === "M" ? (box.minY + box.maxY) / 2 : box.minY);
    return { x: refX - boxX, y: -boxY };
};

/** Clearance each side of a text, as a fraction of its height. */
CsLinetype.TEXT_PAD = 0.25;

/**
 * Makes a text row the gap its text needs. The row keeps the clearance it
 * had: when the text gets wider (size, font, wording, rotation) the row
 * grows by the same amount, and narrower shrinks it. It never goes below
 * the text's width plus TEXT_PAD x height each side, and it is always a
 * gap -- a text drawn over a dash is unreadable.
 *
 * width: the text's measured width now; prevWidth: at the last fit, or
 * undefined the first time (then only the minimum applies).
 */
CsLinetype.fitTextRow = function(seg, width, prevWidth) {
    var len = Math.abs(Number(seg.length) || 0);
    if (typeof prevWidth === "number" && isFinite(prevWidth)) {
        len += width - prevWidth;
    }
    var minimum = width + 2 * CsLinetype.TEXT_PAD * (Number(seg.scale) || 0);
    seg.length = -Math.max(len, minimum);
};

/** Which anchor a segment's offsets match, or "custom". */
CsLinetype.anchorOf = function(seg, box) {
    var tol = 1e-4 * Math.max(1, Math.abs(box.maxX - box.minX), Math.abs(seg.length));
    for (var i = 0; i < CsLinetype.ANCHORS.length; i++) {
        var o = CsLinetype.anchorOffset(CsLinetype.ANCHORS[i], box, seg.length);
        if (Math.abs(o.x - seg.x) <= tol && Math.abs(o.y - seg.y) <= tol) {
            return CsLinetype.ANCHORS[i];
        }
    }
    return "custom";
};

/**
 * The pattern walked along a straight line of `length`, the way the engine
 * walks it: dashes as [from, to], dots as positions, and each text at the
 * END of the segment it belongs to.
 */
CsLinetype.layout = function(model, length) {
    var out = { dashes: [], dots: [], glyphs: [] };
    var segs = model.segments || [];
    var period = 0;
    for (var p = 0; p < segs.length; p++) {
        period += Math.abs(Number(segs[p].length) || 0);
    }
    if (segs.length === 0 || period <= 0) {
        return out;
    }
    var cursor = 0, i = 0, guard = 0;
    while (cursor < length && guard < 10000) {
        var seg = segs[i];
        var len = Math.abs(Number(seg.length) || 0);
        if (seg.length > 0) {
            out.dashes.push([cursor, Math.min(cursor + len, length)]);
        } else if (seg.length === 0) {
            out.dots.push(cursor);
        }
        cursor += len;
        if (seg.text !== "" && cursor <= length) {
            out.glyphs.push({ at: cursor, index: i });
        }
        i = (i + 1) % segs.length;
        guard++;
    }
    return out;
};
