// CsScanRotate.js -- turning a scanned page the right way up, on disk.
//
// A page photographed sideways is not a placement problem, it is a
// FILE problem: every tool downstream (the preview, the trim box, the
// two-point fit, the section bay) reads the pixels as they sit on
// disk, so the fix belongs to the pixels. This writes the rotation
// back to the scan itself rather than carrying an angle alongside it.
//
// The pure half is here for tests/js_unit.js; everything under the
// "QCAD only" line touches QImage and the disk.

var CsScanRotate = {};

// JPEG re-encode quality. A rotation is a re-encode -- Qt has no
// lossless transform -- so this is deliberately high: a survey sketch
// is read at 400% zoom while it is traced, and the generation loss of
// one rotation at 95 is invisible there. Rotating the same page four
// times to get back where it started is still four encodes.
CsScanRotate.QUALITY = 95;

// The suffix a rotation is staged under, next to the scan. The swap is
// write-then-rename, so a save that dies half way through takes the
// STAGING file with it and leaves the scan untouched.
CsScanRotate.TEMP_SUFFIX = ".csrotate-tmp";

/** The lower-case extension of a path, without the dot ("" when none). */
CsScanRotate.extOf = function(rel) {
    var name = String(rel);
    name = name.substring(name.lastIndexOf("/") + 1);
    var dot = name.lastIndexOf(".");
    if (dot <= 0) {
        return "";
    }
    return name.substring(dot + 1).toLowerCase();
};

/**
 * The Qt format name to SAVE a scan back as, or null when this suite
 * will not rewrite the file.
 *
 * The format is taken from the NAME, not from what Qt managed to read:
 * a rotation must land back in the file it came from, under the name
 * every drawing already references. A HEIC page reads fine here and
 * cannot be written at all, which is exactly the case null exists for
 * -- better a message naming the file than a scan silently rewritten
 * as something else under an .heic name.
 */
CsScanRotate.formatOf = function(rel) {
    switch (CsScanRotate.extOf(rel)) {
    case "jpg":
    case "jpeg":
        return "JPEG";
    case "png":
        return "PNG";
    case "tif":
    case "tiff":
        return "TIFF";
    case "bmp":
        return "BMP";
    case "webp":
        return "WEBP";
    // HEIC IS WRITABLE IN THIS BUILD (probed 2026-09-05: QImageWriter
    // lists heic and heif), and a phone-shot sketch page arrives as one
    // often enough to matter.
    case "heic":
        return "HEIC";
    case "heif":
        return "HEIF";
    default:
        return null;
    }
};

/** True when Qt in this build can write that format. `supported` is
 *  QImageWriter.supportedImageFormats()' list, in any case. */
CsScanRotate.canWrite = function(format, supported) {
    if (format === null || format === undefined ||
            Object.prototype.toString.call(supported) !== "[object Array]") {
        return false;
    }
    var want = String(format).toLowerCase();
    for (var i = 0; i < supported.length; i++) {
        var got = String(supported[i]).toLowerCase();
        if (got === want || (want === "jpeg" && got === "jpg") ||
                (want === "tiff" && got === "tif")) {
            return true;
        }
    }
    return false;
};

/** A quarter turn swaps the page's sides. Pure, and the one thing every
 *  caller needs to know about the result before it exists. */
CsScanRotate.turnedSize = function(pxW, pxH) {
    return { w: pxH, h: pxW };
};

/**
 * The trim derivatives of one page, out of the names in the Trimmed
 * folder.
 *
 * A derivative's name CARRIES THE BOX IT WAS CUT AT, in the rotated-
 * away pixel coordinates -- so after a turn every one of them is a crop
 * of a page that no longer exists. They are regenerable by drawing the
 * box again, so the rotation deletes them rather than leaving crops
 * that quietly disagree with their page.
 */
CsScanRotate.staleTrims = function(pageRel, names) {
    var out = [];
    if (Object.prototype.toString.call(names) !== "[object Array]") {
        return out;
    }
    var prefix = CsScanTrim.baseOf(pageRel) + "__" + CsScanTrim.MARK + "_";
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        if (name.substring(0, prefix.length) === prefix &&
                CsScanTrim.parseName(name) !== null) {
            out.push(name);
        }
    }
    return out;
};

// ----------------------------------------------------------- QCAD only
// Everything below touches QImage, QTransform and the disk.

/** The formats QImageWriter can write here, lower-cased. [] when the
 *  class is not reachable -- canWrite then says no to everything, and
 *  the caller says so rather than writing a file Qt cannot encode. */
CsScanRotate.writableFormats = function() {
    var out = [];
    try {
        var list = QImageWriter.supportedImageFormats();
        for (var i = 0; i < list.length; i++) {
            out.push(String(list[i]).toLowerCase());
        }
    } catch (e) {
    }
    return out;
};

/**
 * One quarter turn CLOCKWISE, written back to the scan.
 *
 * QTransform HAS NO rotate() THROUGH THIS BRIDGE (probed 2026-09-05:
 * the generated wrapper exposes the 9-argument constructor and nothing
 * else), so the quarter turn is built as the matrix Qt's own
 * rotate(90) would produce. An image's rows run DOWN, so that matrix is
 * the clockwise one on screen.
 *
 * WRITE, THEN SWAP. The rotated page is saved beside the scan and only
 * renamed over it once the save reports success: a full disk or a
 * read-only Drive folder costs the caver a stray temp file, never the
 * only copy of a survey page.
 *
 * \return { ok: true, w, h } or { ok: false, error: <message> }.
 */
CsScanRotate.turn = function(scansFolder, pageRel) {
    // rotate(90) as a matrix: m11 0, m12 1, m21 -1, m22 0.
    return CsScanRotate.rewrite(scansFolder, pageRel,
        new QTransform(0, 1, 0,
                      -1, 0, 0,
                       0, 0, 1),
        "rotating");
};

/**
 * Mirrors a page and saves it back, the same way turn() rotates one.
 *
 * WHY A SCAN IS EVER MIRRORED. A page photographed through the back of
 * the sheet, a phone's front camera, a sketch traced onto tracing
 * paper and scanned from the wrong side -- the sketch is right, the
 * pixels are reversed, and every tool downstream reads the pixels.
 *
 * MIRRORING THE FILE, NOT THE PLACEMENT, for exactly the reasons the
 * top of this file gives for rotation: the preview, the trim box, the
 * two-point fit and the section bay all read the page off disk, and a
 * mirror carried beside the file would have to be honoured by each of
 * them separately or quietly ignored by one of them.
 *
 * \param axis "horizontal" to swap left and right (the usual one: it
 *             is the axis a page gets flipped about), "vertical" to
 *             swap top and bottom.
 */
CsScanRotate.flip = function(scansFolder, pageRel, axis) {
    var horizontal = (String(axis) !== "vertical");
    return CsScanRotate.rewrite(scansFolder, pageRel,
        horizontal ? new QTransform(-1, 0, 0,
                                     0, 1, 0,
                                     0, 0, 1)
                   : new QTransform(1,  0, 0,
                                    0, -1, 0,
                                    0,  0, 1),
        "flipping");
};

/**
 * Reads a page, applies one transform to its pixels, and writes it
 * back over itself.
 *
 * THE SHARED HALF of turn and flip, which differ only in the matrix.
 * Everything that is delicate about rewriting somebody's scan lives
 * here once: the format is taken from the NAME so the page lands back
 * under the name every drawing references, the new pixels are staged
 * beside the file so a save that dies half way through takes the
 * STAGING file with it, the original is removed before the rename
 * because QFile.rename will not overwrite, and the page's trimmed
 * crops are dropped because they are cut-outs of pixels that no longer
 * exist.
 *
 * \param verb what to call this in an error a caver reads
 * \return {ok, w, h, dropped} or {ok: false, error}
 */
CsScanRotate.rewrite = function(scansFolder, pageRel, transform, verb) {
    var path = String(scansFolder) + "/" + pageRel;
    var format = CsScanRotate.formatOf(pageRel);
    if (format === null) {
        return { ok: false, error: pageRel + " is a ." +
            CsScanRotate.extOf(pageRel) + " page, which this suite " +
            "will not rewrite. Change it in an image editor, or save " +
            "it as JPEG or PNG first." };
    }
    if (!CsScanRotate.canWrite(format, CsScanRotate.writableFormats())) {
        return { ok: false, error: "this build of CaveCAD cannot write " +
            format + " images, so " + pageRel + " cannot be changed " +
            "in place." };
    }

    var image;
    try {
        image = new QImage(path);
    } catch (eLoad) {
        image = null;
    }
    if (image === null || image.isNull()) {
        return { ok: false, error: path + " could not be read as an " +
            "image." };
    }

    var turned;
    try {
        turned = image.transformed(transform);
    } catch (eTurn) {
        turned = null;
    }
    if (turned === null || turned.isNull()) {
        return { ok: false, error: verb + " " + pageRel + " failed -- " +
            "the page may be too large to hold in memory." };
    }

    var temp = path + CsScanRotate.TEMP_SUFFIX;
    var saved = false;
    try {
        saved = turned.save(temp, format, CsScanRotate.QUALITY);
    } catch (eSave) {
        saved = false;
    }
    if (!saved) {
        try { QFile.remove(temp); } catch (eRm) { }
        return { ok: false, error: "the changed page could not be " +
            "written beside " + path + " -- the scans folder may be " +
            "read-only." };
    }

    // The original has to go before the rename: QFile.rename does not
    // overwrite.
    try {
        if (!QFile.remove(path)) {
            QFile.remove(temp);
            return { ok: false, error: path + " could not be replaced " +
                "-- it may be open in another program. The scan is " +
                "unchanged." };
        }
    } catch (eDel) {
        try { QFile.remove(temp); } catch (eRm2) { }
        return { ok: false, error: path + " could not be replaced. The " +
            "scan is unchanged." };
    }
    var moved = false;
    try {
        moved = QFile.rename(temp, path);
    } catch (eMove) {
        moved = false;
    }
    if (!moved) {
        // The worst case this file has: the page is gone from its own
        // name and the new pixels are sitting beside it. Say exactly
        // where they are rather than pretending nothing happened.
        return { ok: false, error: "the changed page was written to " +
            temp + " but could not be renamed over " + path +
            ". Rename it by hand -- that file is the changed scan." };
    }
    // THE CROPS GO WITH THE OLD PIXELS, and they go HERE rather than
    // at the caller: a rewrite that left them behind would leave the
    // folder holding crops of a page that no longer exists, whichever
    // tool did the rewriting.
    return { ok: true, w: turned.width(), h: turned.height(),
             dropped: CsScanRotate.dropStaleTrims(scansFolder, pageRel) };
};

/** Deletes this page's now-meaningless trim derivatives.
 *  \return how many went. */
CsScanRotate.dropStaleTrims = function(scansFolder, pageRel) {
    var gone = 0;
    try {
        var folder = String(scansFolder) + "/" + CsScanTrim.FOLDER;
        var dir = new QDir(folder);
        if (!dir.exists()) {
            return 0;
        }
        var names = dir.entryList(QDir.Files);
        var list = [];
        for (var i = 0; i < names.length; i++) {
            list.push(String(names[i]));
        }
        var stale = CsScanRotate.staleTrims(pageRel, list);
        for (var s = 0; s < stale.length; s++) {
            if (QFile.remove(folder + "/" + stale[s])) {
                gone++;
            }
        }
    } catch (e) {
        // a derivative that could not be deleted is a stale crop the
        // caver can redraw over; never worth failing the rotation for
    }
    return gone;
};
