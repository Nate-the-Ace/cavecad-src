// CsScanPdf.js -- a PDF of field pages, split into one image per page.
//
// Part of the Cave Survey Core library. The naming and the "has this
// already been split" question are PURE and node-testable; the render
// itself needs QImageReader and says so.
//
// WHY THIS EXISTS. A scanner hands back one PDF per trip, not one file
// per page, and every tool in this suite works on a page: Sketch Scans
// insets one, Scan Trim crops one, the Notebook shows one beside the
// numbers coming off it. A PDF in scans/ is therefore a trip nobody can
// trace yet. It is also, confusingly, LISTED -- this build's
// QImageReader claims "pdf" among its supported formats, so a PDF lands
// in the scans tree looking like a page and previews as its first one.
//
// So: right-click it, split it, and the trip is a row of pages.
//
// WHAT THE ENGINE ACTUALLY GIVES US (probed against a real Truitt PDF,
// 2026-09-14): QImageReader reads PDFs natively -- `imageCount()` is
// the page count, `jumpToImage(i)` selects a page, and `size()` is the
// page in POINTS, so scaling it by dpi/72 and calling setScaledSize
// renders at that resolution rather than upscaling a thumbnail. A
// fresh reader per page, jump, then scale, then read: all five pages
// came out distinct and correct.
//
// THE SAVE TRAP. `image.save(path)` with no format argument returns
// FALSE and writes nothing, whatever the extension says. Every write
// here passes "PNG" explicitly.

var CsScanPdf = {};

/** Rendered at 300 dpi, PNG. Lossless because the page goes on to be
 *  cropped by Scan Trim and traced over -- a JPEG re-saved through
 *  that loses pencil on grey paper first, which is the whole content
 *  of a field page. Nathan chose this over JPEG and over 200 dpi,
 *  2026-09-14. */
CsScanPdf.DPI = 300;

/** What a page is written as. */
CsScanPdf.FORMAT = "PNG";
CsScanPdf.EXTENSION = ".png";

/** The marker every page name carries between the PDF's name and its
 *  number. Distinctive on purpose: `pagesOf` uses it to tell this
 *  suite's derivatives from a file that merely starts the same way. */
CsScanPdf.MARK = "-p";

/** True for a path this tool can split. */
CsScanPdf.isPdfPath = function(rel) {
    if (typeof rel !== "string" || rel === "") {
        return false;
    }
    return rel.toLowerCase().lastIndexOf(".pdf") === rel.length - 4;
};

/** A path without its extension. "a/b/c.pdf" -> "a/b/c". Pure. */
CsScanPdf.stem = function(rel) {
    var dot = String(rel).lastIndexOf(".");
    var slash = String(rel).lastIndexOf("/");
    if (dot <= slash) {
        return String(rel);
    }
    return String(rel).substring(0, dot);
};

/**
 * What page `index` (0-based) of `pdfRel` is called.
 *
 * ZERO-PADDED to the width of the page count, so the pages sort into
 * page order in every listing that sorts by name -- which is the scans
 * tree, the file manager, and the Drive web view. "p10" sorting before
 * "p2" is how a ten-page trip reads out of order forever.
 *
 * Pure.
 */
CsScanPdf.pageName = function(pdfRel, index, total) {
    var digits = String(Math.max(2, String(Math.max(1, total)).length));
    var n = String(index + 1);
    while (n.length < parseInt(digits, 10)) {
        n = "0" + n;
    }
    return CsScanPdf.stem(pdfRel) + CsScanPdf.MARK + n +
        CsScanPdf.EXTENSION;
};

/** Every page name a split of this PDF would write, in order. Pure. */
CsScanPdf.pageNames = function(pdfRel, total) {
    var out = [];
    for (var i = 0; i < total; i++) {
        out.push(CsScanPdf.pageName(pdfRel, i, total));
    }
    return out;
};

/**
 * How far along a split of `pdfRel` is, given every file in the folder.
 *
 *   "none"     -- no page of it has been written
 *   "partial"  -- some pages are there, not all
 *   "complete" -- every page is there
 *
 * WHY COMPLETENESS AND NOT A FLAG. Nothing is stored anywhere saying
 * "this PDF was split". The files on disk ARE the record: delete the
 * pages and the PDF comes back in the tree, ready to split again;
 * delete one page and it comes back too, which is the honest answer
 * because that trip is no longer whole. A flag would have to be kept
 * in step with a folder a caver edits in Finder and in Drive, and it
 * would be wrong the first time they did.
 *
 * `total` is the PDF's page count. Pure.
 */
CsScanPdf.splitState = function(pdfRel, rels, total) {
    if (!CsScanPdf.isPdfPath(pdfRel) || typeof total !== "number" ||
            total < 1) {
        return "none";
    }
    var have = {};
    for (var i = 0; i < rels.length; i++) {
        have[String(rels[i])] = true;
    }
    var wanted = CsScanPdf.pageNames(pdfRel, total);
    var found = 0;
    for (var p = 0; p < wanted.length; p++) {
        if (have[wanted[p]] === true) {
            found++;
        }
    }
    if (found === 0) {
        return "none";
    }
    return (found === wanted.length) ? "complete" : "partial";
};

// ---------------------------------------------------------------------
// The engine half.
// ---------------------------------------------------------------------

/**
 * How many pages a PDF has, or 0 when it cannot be read.
 *
 * Cheap -- the probe in front of this parsed a five-page scan
 * instantly -- but not free, so the scans lister calls it once per PDF
 * per refresh and nothing calls it per row.
 */
CsScanPdf.pageCount = function(absPath) {
    if (typeof QImageReader === "undefined") {
        return 0;
    }
    try {
        var reader = new QImageReader(absPath);
        if (!reader.canRead()) {
            return 0;
        }
        var n = reader.imageCount();
        return (typeof n === "number" && n > 0) ? n : 0;
    } catch (e) {
        return 0;
    }
};

/** Width or height off a QSize/QImage, whichever way this bridge
 *  exposes it -- on a QImage both are METHODS, on a widget they are
 *  properties, and the two look identical in code. */
CsScanPdf.dim = function(obj, which) {
    var v = obj[which];
    if (typeof v === "function") {
        return obj[which]();
    }
    return v;
};

/**
 * Splits one PDF into page images beside it.
 *
 * BESIDE IT, in the same trip folder, because that is where the rest
 * of the trip's pages already are: a subfolder would put half a trip
 * one fold deeper in the tree than the other half.
 *
 * Existing page files are OVERWRITTEN. A re-split is what a caver does
 * when the first one came out wrong, and leaving the old ones there
 * under the same names would mean the tree shows the bad render and
 * the good one has nowhere to go.
 *
 * \param absPath  the PDF, absolute
 * \param dpi      optional, defaults to CsScanPdf.DPI
 * \return { ok, written: [absolute paths], pages, error }
 */
CsScanPdf.split = function(absPath, dpi) {
    var out = { ok: false, written: [], pages: 0, error: "" };
    if (typeof QImageReader === "undefined") {
        out.error = "This build cannot read PDFs.";
        return out;
    }
    var resolution = (typeof dpi === "number" && dpi > 0) ? dpi :
        CsScanPdf.DPI;
    var pages = CsScanPdf.pageCount(absPath);
    if (pages < 1) {
        out.error = "That PDF could not be read.";
        return out;
    }
    out.pages = pages;
    for (var i = 0; i < pages; i++) {
        var target = CsScanPdf.pageName(absPath, i, pages);
        try {
            // A FRESH READER PER PAGE. Probed working as: construct,
            // jump, scale, read -- in that order. One reader walked
            // across pages reads them too, but a reader that has
            // already delivered an image is not one to re-scale.
            var reader = new QImageReader(absPath);
            if (i > 0 && !reader.jumpToImage(i)) {
                out.error = "Page " + (i + 1) + " could not be reached.";
                return out;
            }
            var size = reader.size();
            var factor = resolution / 72;
            reader.setScaledSize(new QSize(
                Math.round(CsScanPdf.dim(size, "width") * factor),
                Math.round(CsScanPdf.dim(size, "height") * factor)));
            var image = reader.read();
            if (isNull(image) || image.isNull()) {
                out.error = "Page " + (i + 1) + " came out empty.";
                return out;
            }
            // The format is passed EXPLICITLY: save(path) alone returns
            // false and writes nothing on this bridge, extension or no
            // extension (measured 2026-09-14).
            if (!image.save(target, CsScanPdf.FORMAT)) {
                out.error = "Page " + (i + 1) + " could not be written " +
                    "to " + target;
                return out;
            }
            out.written.push(target);
        } catch (e) {
            out.error = "Page " + (i + 1) + " failed (" + e + ")";
            return out;
        }
    }
    out.ok = true;
    return out;
};
