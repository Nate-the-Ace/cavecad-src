// CsScanTrim.js -- which pixels of a scanned page actually get placed.
//
// Part of the Cave Survey Core library. Everything above the QCAD-only
// banner is PURE; the functions below it touch QImage and the disk and
// take the scans folder explicitly, the same split CsScanFrame.js uses.
//
// WHY A DERIVATIVE FILE AND NOT A CROP PROPERTY. RImageData carries a
// file name, an insertion point, u and v vectors, a pixel size and a
// fade -- and no clip boundary. DXF's IMAGE clipping is not implemented
// in this engine. So "place only this part of the page" can only mean
// "point the entity at a smaller file".
//
// WHY THE RECT LIVES IN THE FILENAME. It makes the derivative
// self-describing: the same box drawn twice on the same page resolves
// to a file that already exists, so nothing accumulates, and there is
// no sidecar index that can drift out of step with a folder the caver
// is free to delete.
//
// AN OUTLINE IS STILL A RECTANGLE. A traced outline crops to its own
// BOUNDING BOX and clears everything outside the line to transparent.
// That is what keeps the rest of the suite working untouched: the
// derivative has a width and a height and an origin on the page exactly
// as a boxed one does, so placement, the anchor mapping that walks a
// pick back to page pixels, the 3D drape's quad and the relink all go
// on reading the same x/y/w/h they always did. The outline only decides
// which pixels inside that box survive.
//
// Measured before building it: CaveCAD's 2D view honours PNG alpha
// (RImageData::load keeps ARGB, and the view draws it SourceOver), so a
// masked derivative shows the drawing through its transparent parts.
//
// THE OUTLINE CANNOT LIVE IN THE FILENAME -- hundreds of vertices do
// not fit one -- so the name carries a short hash of it instead, which
// keeps the same-outline-twice-is-the-same-file property. The vertices
// themselves go in XDATA beside the box, decimated to a budget: a DXF
// value line over 1023 characters used to take the rest of the file
// with it (fixed in CaveCAD 0.6.0.1, but a drawing written here still
// has to open in an older one).

var CsScanTrim = {};

/** The one subfolder derivatives live in, under the scans folder. */
CsScanTrim.FOLDER = "Trimmed";

/** The marker in every derivative's name, so a caver can find and
 *  delete them all without knowing anything about this suite. */
CsScanTrim.MARK = "TRIMMED";

/** Smaller than this on either side is a stray click, not a box. */
CsScanTrim.MIN_PX = 20;

/** The XDATA tag a trimmed placement carries: the box, in the ORIGINAL
 *  page's pixels. Absent means the whole page was placed. */
CsScanTrim.TAG = "ScanTrim";

/** The XDATA tag a traced outline is recorded under: the vertices, in
 *  the ORIGINAL page's pixels, as "x,y x,y x,y". Absent means the crop
 *  is the plain rectangle CsScanTrim.TAG already describes. */
CsScanTrim.OUTLINE_TAG = "ScanOutline";

/** How many vertices an outline is allowed to carry into the drawing.
 *
 *  A DXF value line longer than 1023 characters used to desync the
 *  reader and silently drop the rest of the file. CaveCAD 0.6.0.1 fixed
 *  that reader, but a drawing written here still has to open in older
 *  CaveCADs -- and on a caver's friend's machine that is exactly the
 *  version they have. At roughly eleven characters a vertex this leaves
 *  comfortable room under the old limit.
 *
 *  A traced outline that exceeds it is DECIMATED rather than refused:
 *  the caver drew a shape, and the shape is what matters, not the
 *  hundreds of near-collinear points a dragged stroke produces. */
CsScanTrim.MAX_OUTLINE_POINTS = 80;

/** Vertices closer than this to the line they sit on are dropped when
 *  an outline is decimated. Page pixels, and small: this is removing
 *  the jitter of a hand-dragged stroke, not simplifying the shape. */
CsScanTrim.DECIMATE_PX = 1.5;

/** Fewer than this is not an outline. Three points make a triangle. */
CsScanTrim.MIN_OUTLINE_POINTS = 3;

/**
 * Two points picked in the preview, as a rect on the page.
 *
 * The preview holds the scan at ONE DRAWING UNIT PER PIXEL with its
 * bottom-left at the origin (CsScanPreview.show), so a model point's x
 * is already a column -- but its y runs UP while an image's rows run
 * DOWN. That flip is the whole reason this function exists rather than
 * the caller doing it twice and getting it right once.
 *
 * \return a clamped integer rect, or null when nothing usable is left.
 */
CsScanTrim.rectFromPicks = function(a, b, pxW, pxH) {
    if (a === null || a === undefined || b === null || b === undefined) {
        return null;
    }
    var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    var yTop = Math.max(a.y, b.y), yBottom = Math.min(a.y, b.y);
    return CsScanTrim.normalise({
        x: x0,
        y: pxH - yTop,
        w: x1 - x0,
        h: yTop - yBottom
    }, pxW, pxH);
};

/**
 * A rect clamped to the page and rounded to whole pixels.
 *
 * \return the rect, or null when it falls off the page entirely or
 *         comes out under CsScanTrim.MIN_PX on either side.
 */
CsScanTrim.normalise = function(rect, pxW, pxH) {
    if (rect === null || rect === undefined) {
        return null;
    }
    var x0 = Math.round(rect.x), y0 = Math.round(rect.y);
    var x1 = Math.round(rect.x + rect.w), y1 = Math.round(rect.y + rect.h);
    var t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    x0 = Math.max(0, Math.min(x0, pxW));
    x1 = Math.max(0, Math.min(x1, pxW));
    y0 = Math.max(0, Math.min(y0, pxH));
    y1 = Math.max(0, Math.min(y1, pxH));
    var w = x1 - x0, h = y1 - y0;
    if (w < CsScanTrim.MIN_PX || h < CsScanTrim.MIN_PX) {
        return null;
    }
    return { x: x0, y: y0, w: w, h: h };
};

/**
 * Picked points on the preview, as an outline in page pixels.
 *
 * Same flip as rectFromPicks and for the same reason: the preview holds
 * the scan at one drawing unit per pixel with its bottom-left at the
 * origin, so a model point's x is already a column while its y runs UP
 * against an image's rows running DOWN.
 *
 * \return integer page points, clamped to the page, or null when what
 *         is left is not an outline
 */
CsScanTrim.outlineFromPicks = function(points, pxW, pxH) {
    if (points === null || points === undefined || points.length === undefined) {
        return null;
    }
    var out = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p === null || p === undefined) { continue; }
        var x = Math.round(p.x);
        var y = Math.round(pxH - p.y);
        if (!isFinite(x) || !isFinite(y)) { continue; }
        out.push({ x: Math.max(0, Math.min(x, pxW)),
                   y: Math.max(0, Math.min(y, pxH)) });
    }
    return CsScanTrim.tidyOutline(out);
};

/**
 * An outline with its repeated and redundant points removed.
 *
 * Drops consecutive duplicates (a double click, or a drag that stopped
 * moving), decimates to CsScanTrim.MAX_OUTLINE_POINTS, and refuses
 * anything left with fewer than three corners or no area worth cutting.
 *
 * \return the outline, or null when it is not one
 */
CsScanTrim.tidyOutline = function(points) {
    if (points === null || points === undefined || points.length === undefined) {
        return null;
    }
    var pts = [];
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (p === null || p === undefined) { continue; }
        if (typeof p.x !== "number" || typeof p.y !== "number") { continue; }
        if (!isFinite(p.x) || !isFinite(p.y)) { continue; }
        var q = { x: Math.round(p.x), y: Math.round(p.y) };
        if (pts.length > 0) {
            var last = pts[pts.length - 1];
            if (last.x === q.x && last.y === q.y) { continue; }
        }
        pts.push(q);
    }
    // A closing point the caver clicked back onto the start is implied
    // by the shape being closed, so it is not carried.
    while (pts.length > 1 &&
           pts[0].x === pts[pts.length - 1].x &&
           pts[0].y === pts[pts.length - 1].y) {
        pts.pop();
    }
    if (pts.length < CsScanTrim.MIN_OUTLINE_POINTS) {
        return null;
    }
    pts = CsScanTrim.decimate(pts, CsScanTrim.DECIMATE_PX);
    // Still too many after the gentle pass: tighten until it fits, so a
    // stroke traced with a mouse held down cannot blow the budget.
    var tol = CsScanTrim.DECIMATE_PX;
    while (pts.length > CsScanTrim.MAX_OUTLINE_POINTS && tol < 4096) {
        tol *= 2;
        pts = CsScanTrim.decimate(pts, tol);
    }
    if (pts.length > CsScanTrim.MAX_OUTLINE_POINTS) {
        pts = pts.slice(0, CsScanTrim.MAX_OUTLINE_POINTS);
    }
    if (pts.length < CsScanTrim.MIN_OUTLINE_POINTS) {
        return null;
    }
    var box = CsScanTrim.outlineBounds(pts);
    if (box === null || box.w < CsScanTrim.MIN_PX || box.h < CsScanTrim.MIN_PX) {
        return null;
    }
    return pts;
};

/**
 * Douglas-Peucker, on an OPEN run of points.
 *
 * The outline is closed, but the ends are real corners the caver put
 * there -- the first and last picks -- so they are kept rather than
 * being candidates for removal like every point between them.
 */
CsScanTrim.decimate = function(points, tolerance) {
    if (points === null || points === undefined || points.length < 3) {
        return points;
    }
    var tol = (typeof tolerance === "number" && tolerance > 0)
        ? tolerance : CsScanTrim.DECIMATE_PX;

    var keep = [];
    for (var k = 0; k < points.length; k++) { keep.push(false); }
    keep[0] = true;
    keep[points.length - 1] = true;

    // Iterative rather than recursive: a traced stroke can be thousands
    // of points long and this runs in a script engine.
    var stack = [[0, points.length - 1]];
    while (stack.length > 0) {
        var span = stack.pop();
        var first = span[0], last = span[1];
        if (last <= first + 1) { continue; }
        var a = points[first], b = points[last];
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        var worst = -1, worstAt = -1;
        for (var i = first + 1; i < last; i++) {
            var p = points[i];
            var d;
            if (len < 1e-9) {
                d = Math.sqrt((p.x - a.x) * (p.x - a.x) +
                              (p.y - a.y) * (p.y - a.y));
            } else {
                d = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
            }
            if (d > worst) { worst = d; worstAt = i; }
        }
        if (worst > tol && worstAt > first) {
            keep[worstAt] = true;
            stack.push([first, worstAt]);
            stack.push([worstAt, last]);
        }
    }
    var out = [];
    for (var j = 0; j < points.length; j++) {
        if (keep[j]) { out.push(points[j]); }
    }
    return out;
};

/** An outline's bounding box, as the rect the derivative is cut to. */
CsScanTrim.outlineBounds = function(points) {
    if (points === null || points === undefined || points.length === 0) {
        return null;
    }
    var minX = points[0].x, maxX = points[0].x;
    var minY = points[0].y, maxY = points[0].y;
    for (var i = 1; i < points.length; i++) {
        if (points[i].x < minX) { minX = points[i].x; }
        if (points[i].x > maxX) { maxX = points[i].x; }
        if (points[i].y < minY) { minY = points[i].y; }
        if (points[i].y > maxY) { maxY = points[i].y; }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/**
 * Is this page pixel inside the outline?
 *
 * Even-odd ray casting, the standard crossing count. Half-pixel centres
 * so a vertex sitting exactly on an integer row cannot make the ray
 * graze it and count a crossing twice.
 */
CsScanTrim.contains = function(points, x, y) {
    if (points === null || points === undefined || points.length < 3) {
        return false;
    }
    var px = x + 0.5, py = y + 0.5;
    var inside = false;
    var n = points.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = points[i].x, yi = points[i].y;
        var xj = points[j].x, yj = points[j].y;
        if ((yi > py) !== (yj > py)) {
            var t = (py - yi) / (yj - yi);
            if (px < xi + t * (xj - xi)) {
                inside = !inside;
            }
        }
    }
    return inside;
};

/** The outline's XDATA text: "x,y x,y x,y" in page pixels. */
CsScanTrim.serializeOutline = function(points) {
    if (points === null || points === undefined || points.length === 0) {
        return "";
    }
    var parts = [];
    for (var i = 0; i < points.length; i++) {
        parts.push(points[i].x + "," + points[i].y);
    }
    return parts.join(" ");
};

/** An outline back out of its XDATA text, or null. Never throws: this
 *  value comes off a drawing a user can edit. */
CsScanTrim.parseOutline = function(text) {
    if (text === null || text === undefined) {
        return null;
    }
    var words = String(text).replace(/^\s+|\s+$/g, "").split(/\s+/);
    var pts = [];
    for (var i = 0; i < words.length; i++) {
        if (words[i] === "") { continue; }
        var m = /^(-?\d+),(-?\d+)$/.exec(words[i]);
        if (m === null) { return null; }
        pts.push({ x: parseInt(m[1], 10), y: parseInt(m[2], 10) });
    }
    if (pts.length < CsScanTrim.MIN_OUTLINE_POINTS) {
        return null;
    }
    return pts;
};

/**
 * A short, stable tag for an outline, for the derivative's file name.
 *
 * NOT a cryptographic hash and does not need to be: it only has to make
 * two different outlines on the same page land on different files, and
 * the same outline land on the same one. Collisions cost a caver a crop
 * that looks wrong, which the preview shows them immediately.
 */
CsScanTrim.outlineHash = function(points) {
    var text = CsScanTrim.serializeOutline(points);
    // FNV-1a, 32 bit, kept in integer range by hand: JavaScript bitwise
    // operators are 32-bit signed, which is exactly what this wants.
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
        h = h ^ text.charCodeAt(i);
        // h * 16777619 without losing the low bits to float rounding
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
    }
    var unsigned = h >>> 0;
    var hex = unsigned.toString(16);
    while (hex.length < 8) { hex = "0" + hex; }
    return hex;
};

/** True when this rect covers the whole page, in which case there is
 *  nothing to trim and the original file should be placed. */
CsScanTrim.isWholePage = function(rect, pxW, pxH) {
    return rect !== null && rect !== undefined &&
        rect.x === 0 && rect.y === 0 && rect.w === pxW && rect.h === pxH;
};

/** A page's base name, with anything that could build a path replaced
 *  -- a derivative must never be able to escape the Trimmed folder. */
CsScanTrim.baseOf = function(pageRel) {
    var name = String(pageRel);
    name = name.substring(name.lastIndexOf("/") + 1);
    var dot = name.lastIndexOf(".");
    if (dot > 0) {
        name = name.substring(0, dot);
    }
    return name.replace(/[^A-Za-z0-9._-]/g, "_");
};

/** The derivative's file name for this page and box. Always .png:
 *  a trimmed sketch is about to be traced over, and re-encoding a JPG
 *  page as JPG a second time is not worth the bytes saved. */
CsScanTrim.fileName = function(pageRel, rect, outline) {
    var name = CsScanTrim.baseOf(pageRel) + "__" + CsScanTrim.MARK +
        "_x" + rect.x + "_y" + rect.y +
        "_w" + rect.w + "_h" + rect.h;
    if (outline !== null && outline !== undefined && outline.length >= 3) {
        // The vertices cannot go in a name, so a tag for them does --
        // which keeps the property that matters: the same outline cut
        // twice resolves to the file that is already there.
        name += "_p" + CsScanTrim.outlineHash(outline);
    }
    return name + ".png";
};

/** The rect back out of a derivative's name, or null when the name is
 *  not one of ours. */
CsScanTrim.parseName = function(name) {
    var m = /__TRIMMED_x(\d+)_y(\d+)_w(\d+)_h(\d+)(?:_p([0-9a-f]{8}))?\.png$/
        .exec(String(name));
    if (m === null) {
        return null;
    }
    var out = { x: parseInt(m[1], 10), y: parseInt(m[2], 10),
                w: parseInt(m[3], 10), h: parseInt(m[4], 10) };
    if (m[5] !== undefined) {
        // The shape itself is not recoverable from the name -- only the
        // fact that there was one, and which one.
        out.outlineHash = m[5];
    }
    return out;
};

/**
 * True when this scans-relative path is a derivative rather than a
 * page. Whole path SEGMENTS only: a caver's own "Trimmed_notes" folder
 * is a real folder and its scans belong in the shelf.
 */
CsScanTrim.isTrimPath = function(rel) {
    var parts = String(rel).split("/");
    for (var i = 0; i < parts.length - 1; i++) {
        if (parts[i] === CsScanTrim.FOLDER) {
            return true;
        }
    }
    return false;
};

/** The ScanTrim tag's text. */
CsScanTrim.serialize = function(rect) {
    if (rect === null || rect === undefined) {
        return "";
    }
    return rect.x + "," + rect.y + "," + rect.w + "," + rect.h;
};

/** A ScanTrim tag back to a rect, or null. Never throws: this value
 *  comes off a drawing a user can edit. */
CsScanTrim.parse = function(text) {
    if (text === null || text === undefined) {
        return null;
    }
    var m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(
        String(text));
    if (m === null) {
        return null;
    }
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10),
             w: parseInt(m[3], 10), h: parseInt(m[4], 10) };
};

// ----------------------------------------------------------- QCAD only
// Everything below touches QImage and the disk. It takes the scans
// folder explicitly and knows nothing about a document or a dock.

/** The folder derivatives live in, created on demand.
 *  \return the path, or null when it could not be made. */
CsScanTrim.folderIn = function(scansFolder) {
    var path = String(scansFolder) + "/" + CsScanTrim.FOLDER;
    try {
        if (new QFileInfo(path).exists()) {
            return path;
        }
        if (new QDir().mkpath(path)) {
            return path;
        }
    } catch (e) {
    }
    return null;
};

/**
 * Crops a page to a box and saves it as a PNG derivative.
 *
 * REUSES an existing derivative with the same name rather than writing
 * it again -- the rect is in the name, so a matching name IS a matching
 * crop.
 *
 * NEVER FALLS BACK to the whole page. A caver who drew a box asked for
 * the clutter to be gone; placing the page anyway would put it in the
 * drawing without saying so.
 *
 * \return { path: <absolute path>, error: null } on success,
 *         { path: null, error: <message> } on failure.
 */
/**
 * Everything outside the outline made transparent.
 *
 * SCANLINE SPANS, not a test per pixel. The crop of a survey page runs
 * to a million pixels and this is script: asking "is this inside?" of
 * each one walks every edge a million times. Crossing the polygon once
 * per ROW instead gives the spans that are inside, and only the pixels
 * OUTSIDE those spans are written.
 *
 * \param crop    the QImage already cut to `rect`
 * \param outline page-pixel vertices
 * \param rect    where `crop` sits on the page, so the outline can be
 *                read in the crop's own pixels
 * \return a new QImage, or null
 */
CsScanTrim.mask = function(crop, outline, rect) {
    var out;
    try {
        // ARGB32 or there is nowhere to put the transparency: a JPEG
        // page loads as RGB32 and silently ignores every alpha written
        // to it.
        out = crop.convertToFormat(QImage.Format_ARGB32);
    } catch (eConv) {
        out = null;
    }
    if (out === null || out.isNull()) {
        return null;
    }
    var w = out.width(), h = out.height();
    var clear = new QColor(0, 0, 0, 0);

    // The outline in the crop's own pixels.
    var poly = [];
    for (var i = 0; i < outline.length; i++) {
        poly.push({ x: outline[i].x - rect.x, y: outline[i].y - rect.y });
    }
    var n = poly.length;

    for (var y = 0; y < h; y++) {
        var scan = y + 0.5;
        // Where the row crosses the outline, left to right.
        var xs = [];
        for (var a = 0, b = n - 1; a < n; b = a++) {
            var ya = poly[a].y, yb = poly[b].y;
            if ((ya > scan) !== (yb > scan)) {
                var t = (scan - ya) / (yb - ya);
                xs.push(poly[a].x + t * (poly[b].x - poly[a].x));
            }
        }
        if (xs.length === 0) {
            // No crossing: the whole row is outside.
            for (var xf = 0; xf < w; xf++) { out.setPixelColor(xf, y, clear); }
            continue;
        }
        xs.sort(function(p, q) { return p - q; });
        // Even-odd: inside between the first and second crossing, the
        // third and fourth, and so on. Clear the gaps.
        var at = 0;
        for (var k = 0; k + 1 < xs.length; k += 2) {
            var from = Math.ceil(xs[k] - 0.5);
            var to = Math.ceil(xs[k + 1] - 0.5);
            if (from < 0) { from = 0; }
            if (to > w) { to = w; }
            for (var xc = at; xc < from; xc++) { out.setPixelColor(xc, y, clear); }
            if (to > at) { at = to; }
        }
        for (var xe = at; xe < w; xe++) { out.setPixelColor(xe, y, clear); }
    }
    return out;
};

CsScanTrim.write = function(scansFolder, pageRel, rect, outline) {
    var shape = (outline === null || outline === undefined) ? null
        : CsScanTrim.tidyOutline(outline);
    var name = CsScanTrim.fileName(pageRel, rect, shape);
    var folder = CsScanTrim.folderIn(scansFolder);
    if (folder === null) {
        return { path: null, error: "the " + CsScanTrim.FOLDER +
            " folder could not be created in " + scansFolder +
            " -- the scans folder may be read-only." };
    }
    var out = folder + "/" + name;
    try {
        if (new QFileInfo(out).exists()) {
            return { path: out, error: null };
        }
    } catch (eExists) {
    }

    var pagePath = String(scansFolder) + "/" + pageRel;
    var page;
    try {
        page = new QImage(pagePath);
    } catch (eLoad) {
        page = null;
    }
    if (page === null || page.isNull()) {
        return { path: null, error: pagePath +
            " could not be read as an image." };
    }
    var cropped;
    try {
        cropped = page.copy(new QRect(rect.x, rect.y, rect.w, rect.h));
    } catch (eCopy) {
        cropped = null;
    }
    if (cropped === null || cropped.isNull()) {
        return { path: null, error: "cropping " + pagePath +
            " to " + CsScanTrim.serialize(rect) + " failed -- the page " +
            "may be too large to hold in memory." };
    }
    if (shape !== null) {
        var masked = CsScanTrim.mask(cropped, shape, rect);
        if (masked === null) {
            return { path: null, error: "masking " + pagePath +
                " to the traced outline failed -- the crop may be too " +
                "large to hold in memory." };
        }
        cropped = masked;
    }
    var saved = false;
    try {
        saved = cropped.save(out, "PNG");
    } catch (eSave) {
        saved = false;
    }
    if (!saved) {
        return { path: null, error: "the trimmed image could not be " +
            "written to " + out + "." };
    }
    return { path: out, error: null };
};

// ---------------------------------------------------------------------
// FLUSHING THE CROPS -- the folder grows, and nothing ever emptied it.
// ---------------------------------------------------------------------
//
// Every trim writes a new file, and the name carries the box, so moving
// the box by one pixel writes another. A cave traced over a season ends
// up with hundreds of them, all of them fat PNGs, none of them ever
// deleted -- the folder is a scratch pad the suite never cleared up
// after itself.
//
// A CROP IS REGENERABLE, which is what makes deleting one safe: the
// drawing keeps the page it was cut from (SketchScan) and the box it
// was cut to (ScanTrim), and CsScanRelink cuts it again from those two
// when the file is not there. That is not a reason to delete one that
// is in use, though: the image in the open drawing points at the FILE,
// and pulling it out from under a drawing somebody is working in blanks
// the underlay until they run the repair. So the ones a drawing is
// holding stay, and only the strays go.

/** Every derivative in the cave's Trimmed folder, as
 *  {rel, abs, bytes}. Empty when there is no such folder. */
CsScanTrim.crops = function(scans) {
    var out = [];
    if (typeof QDir === "undefined" || typeof scans !== "string" ||
            scans === "") {
        return out;
    }
    var rels = CsCave.filesUnder(scans, [], 4);
    for (var i = 0; i < rels.length; i++) {
        var rel = String(rels[i]);
        if (!CsScanTrim.isTrimPath(rel)) {
            continue;
        }
        var abs = scans + "/" + rel;
        var bytes = 0;
        try {
            bytes = Number(new QFileInfo(abs).size());
        } catch (eSize) {
            bytes = 0;
        }
        out.push({ rel: rel, abs: abs, bytes: bytes });
    }
    return out;
};

/**
 * The crop files a document is holding open, as {absolutePath: true}.
 *
 * READ OFF THE IMAGE ENTITIES, not off the tags: the tags say what a
 * crop WOULD be cut from, and the file name says what is on screen
 * right now. It is the second one that goes blank if the file is
 * deleted under it.
 */
CsScanTrim.cropsInUse = function(doc) {
    var out = {};
    if (isNull(doc) || typeof RImageEntity === "undefined") {
        return out;
    }
    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (eQuery) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) {
                continue;
            }
            // getProperty answers a LIST here, value first -- the same
            // read CsScanRelink does two files over.
            var f = String(e.getProperty(RImageEntity.PropertyFileName)[0]);
            if (f !== "" && f !== "undefined") {
                out[f] = true;
            }
        } catch (eOne) {
            // an image we cannot read the path of is one we must assume
            // is in use -- but we cannot name it, so the crop it holds
            // is protected only by being named by another image. This
            // is why flush reports what it deleted.
            continue;
        }
    }
    return out;
};

/**
 * Deletes the crops nothing is holding.
 *
 * \param scans the cave's scans folder
 * \param inUse {absolutePath: true} from cropsInUse, or null for "the
 *              drawing holds nothing", which is true of a cave that is
 *              not open
 * \return {deleted, kept, freed, failed} -- freed in bytes.
 */
CsScanTrim.flush = function(scans, inUse) {
    var out = { deleted: 0, kept: 0, freed: 0, failed: 0 };
    var held = (inUse === null || inUse === undefined) ? {} : inUse;
    var crops = CsScanTrim.crops(scans);
    for (var i = 0; i < crops.length; i++) {
        if (held[crops[i].abs] === true) {
            out.kept++;
            continue;
        }
        var gone = false;
        try {
            gone = new QFile(crops[i].abs).remove();
        } catch (eRemove) {
            gone = false;
        }
        if (gone) {
            out.deleted++;
            out.freed += crops[i].bytes;
        } else {
            out.failed++;
        }
    }
    return out;
};

/** Bytes as a caver would say them -- "12.4 MB". */
CsScanTrim.sizeText = function(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) {
        return "0 KB";
    }
    if (n < 1024 * 1024) {
        return (Math.round(n / 1024 * 10) / 10) + " KB";
    }
    return (Math.round(n / (1024 * 1024) * 10) / 10) + " MB";
};
