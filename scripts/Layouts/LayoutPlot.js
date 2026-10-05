/**
 * LayoutPlot -- layouts to PDF, one page per layout, in ONE file.
 *
 * Reuses Print.js untouched: paper-space coordinates are drawing units
 * (see Layouts.js), so printing a layout is "print the current block at
 * scale 1:1 with no offset, on a page of the layout's size". Viewports are
 * clipped and scaled by the engine; nothing is cut or masked here.
 *
 * Nothing the person sees is disturbed: a private scene and view are used,
 * the document's current block is put back afterwards, and no listener hears
 * about the temporary switches (document-level setCurrentBlock, not the
 * document interface's).
 */
include("scripts/library.js");
include("scripts/File/Print/Print.js");
include("scripts/Layouts/Layouts.js");

var LayoutPlot = {};

/** Sets the Print.js page variables for one layout (millimetre paper, 1:1, no offset, one page). */
LayoutPlot.setPageVariables = function(doc, info) {
    var shorter = Math.min(info.paperMM.w, info.paperMM.h);
    var longer = Math.max(info.paperMM.w, info.paperMM.h);
    doc.setVariable("UnitSettings/PaperUnit", RS.Millimeter);
    doc.setVariable("PageSettings/PaperWidth", shorter);
    doc.setVariable("PageSettings/PaperHeight", longer);
    doc.setVariable("PageSettings/PageOrientation", info.paperMM.w >= info.paperMM.h ? "Landscape" : "Portrait");
    doc.setVariable("PageSettings/Scale", "1:1");
    doc.setVariable("PageSettings/OffsetX", 0);
    doc.setVariable("PageSettings/OffsetY", 0);
    doc.setVariable("ColorSettings/ColorMode", "FullColor");
    doc.setVariable("ColorSettings/BackgroundColor", new RColor("white"));
    doc.setVariable("MultiPageSettings/Rows", 1);
    doc.setVariable("MultiPageSettings/Columns", 1);
    doc.setVariable("MultiPageSettings/PrintCropMarks", false);
    doc.setVariable("PageTagSettings/EnablePageTags", false);
    doc.setVariable("MultiPageSettings/GlueMarginsLeft", 0);
    doc.setVariable("MultiPageSettings/GlueMarginsTop", 0);
    doc.setVariable("MultiPageSettings/GlueMarginsRight", 0);
    doc.setVariable("MultiPageSettings/GlueMarginsBottom", 0);
    doc.setVariable("FooterSettings/Footer", "");
};

/**
 * Plots the named layouts (all, in tab order, when `names` is null/empty)
 * into one PDF.
 *
 * \return { ok, pages, names, error }
 */
LayoutPlot.exportPdf = function(di, names, pdfPath, opts) {
    var doc = di.getDocument();
    var all = Layouts.list(doc);
    var chosen = [];
    if (isNull(names) || names.length === 0) {
        chosen = all;
    }
    else {
        for (var i = 0; i < names.length; i++) {
            var info = Layouts.get(doc, names[i]);
            if (!isNull(info)) {
                chosen.push(info);
            }
        }
    }
    if (chosen.length === 0) {
        return { ok: false, pages: 0, names: [], error: "no layouts to plot" };
    }

    // the page variables are scratch: remember and restore the ones we touch
    var keys = ["UnitSettings/PaperUnit", "PageSettings/PaperWidth", "PageSettings/PaperHeight",
        "PageSettings/PageOrientation", "PageSettings/Scale", "PageSettings/OffsetX",
        "PageSettings/OffsetY", "ColorSettings/ColorMode", "ColorSettings/BackgroundColor",
        "MultiPageSettings/Rows", "MultiPageSettings/Columns", "MultiPageSettings/PrintCropMarks",
        "PageTagSettings/EnablePageTags", "MultiPageSettings/GlueMarginsLeft",
        "MultiPageSettings/GlueMarginsTop", "MultiPageSettings/GlueMarginsRight",
        "MultiPageSettings/GlueMarginsBottom", "FooterSettings/Footer"];
    var savedVars = {};
    for (var k = 0; k < keys.length; k++) {
        savedVars[keys[k]] = doc.hasVariable(keys[k]) ? doc.getVariable(keys[k]) : undefined;
    }
    var savedBlock = doc.getCurrentBlockId();

    var result = { ok: false, pages: 0, names: [], error: "" };
    var printer, painter;
    try {
        var scene = new RGraphicsSceneQt(di);
        var view = new RGraphicsViewImage();
        view.setScene(scene, false);
        view.setNumThreads(1);

        LayoutPlot.setPageVariables(doc, chosen[0]);
        doc.setCurrentBlock(chosen[0].blockId);
        var print_ = new Print(undefined, doc, view);
        printer = print_.createPrinter(pdfPath);
        if (isNull(printer)) {
            result.error = "could not create the PDF writer";
            return result;
        }
        painter = new QPainter();
        if (!painter.begin(printer)) {
            result.error = "could not start the PDF writer for " + pdfPath;
            return result;
        }

        for (var n = 0; n < chosen.length; n++) {
            var info = chosen[n];
            LayoutPlot.setPageVariables(doc, info);
            doc.setCurrentBlock(info.blockId);
            if (n > 0) {
                // new page, new size: the page size must be in place before newPage()
                Print.applyPageSize(printer, doc);
                printer.newPage();
            }
            print_.printCurrentBlock(printer, painter);
            result.pages++;
            result.names.push(info.name);
        }
        result.ok = true;
    }
    catch (e) {
        result.error = String(e);
    }
    finally {
        if (!isNull(painter)) {
            painter.end();
        }
        if (!isNull(printer)) {
            destr(printer);
        }
        doc.setCurrentBlock(savedBlock);
        for (var r = 0; r < keys.length; r++) {
            if (isNull(savedVars[keys[r]])) {
                doc.removeVariable(keys[r]);
            }
            else {
                doc.setVariable(keys[r], savedVars[keys[r]]);
            }
        }
    }
    return result;
};
