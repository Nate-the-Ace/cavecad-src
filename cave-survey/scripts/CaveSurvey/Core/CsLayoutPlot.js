// CsLayoutPlot.js -- plotting layouts to PDF from the Layout menu.
//
// Part of the Cave Survey Core library.
//
// The engine plots (LayoutPlot.exportPdf); this adds what a CAVE needs around
// it: where the file goes, one layout or all of them, and the privacy check --
// a viewport that would print raster images (an aerial photograph is the
// cave's location baked into a picture; a scan is somebody's field book) is
// found and offered a fix BEFORE it is printed.

var CsLayoutPlot = {};

/** The viewports on the named layouts that would print images: [{layout, viewport}]. */
CsLayoutPlot.rasterViewports = function(doc, names) {
    var out = [];
    for (var n = 0; n < names.length; n++) {
        var info = Layouts.get(doc, names[n]);
        if (isNull(info)) {
            continue;
        }
        var vps = Layouts.viewports(doc, info);
        for (var i = 0; i < vps.length; i++) {
            if (vps[i].isOverall() || vps[i].isOff()) {
                continue;
            }
            if (String(vps[i].getCustomProperty("CaveCAD", "NoRaster", "")) !== "1") {
                out.push({ layout: names[n], viewport: vps[i] });
            }
        }
    }
    return out;
};

/** Sets NoRaster on viewports (one undo step). */
CsLayoutPlot.leaveRastersOut = function(doc, di, found) {
    doc.startTransactionGroup();
    var group = doc.getTransactionGroup();
    for (var i = 0; i < found.length; i++) {
        var fresh = doc.queryEntity(found[i].viewport.getId());
        fresh.setCustomProperty("CaveCAD", "NoRaster", "1");
        var op = new RModifyObjectOperation(fresh);
        op.setText(qsTr("Leave rasters out of the plot"));
        op.setTransactionGroup(group);
        di.applyOperation(op);
    }
};

/** Where the PDF goes: "<cave folder>/PDF/<Cave> - <what>.pdf", or "" when the drawing has no folder yet. */
CsLayoutPlot.pathFor = function(doc, what) {
    var here = "";
    try {
        here = String(doc.getFileName());
    } catch (e) {
        here = "";
    }
    var folder = CsCave.pdfDir(here), cave = CsCave.nameOf(here);
    if (folder === null || cave === null) {
        return "";
    }
    try {
        (new QDir("/")).mkpath(folder);
    } catch (eDir) {
    }
    return folder + "/" + cave + " - " + CsLayoutGen.fileSafe(what) + ".pdf";
};

/**
 * Plots with the checks. \param which "this" | "all"
 * \return the path written, or ""
 */
CsLayoutPlot.run = function(di, which) {
    var doc = di.getDocument();
    var appWin = RMainWindowQt.getMainWindow();
    var names = [], label;
    if (which === "this") {
        var cur = Layouts.current(doc);
        if (isNull(cur)) {
            CsTell.warn(qsTr("Plot Layout: click a layout tab first."));
            return "";
        }
        names = [cur.name];
        label = cur.name;
    }
    else {
        var all = Layouts.list(doc);
        for (var i = 0; i < all.length; i++) { names.push(all[i].name); }
        label = "Sheets";
    }
    if (names.length === 0) {
        CsTell.warn(qsTr("Plot Layout: there is nothing to plot yet."));
        return "";
    }
    var found = CsLayoutPlot.rasterViewports(doc, names);
    if (found.length > 0) {
        var answer = QMessageBox.question(appWin, qsTr("Plot Layout"),
            qsTr("%1 viewport(s) would print images (an aerial photograph or a scan). Those show where the cave is. Leave images out of the plot?").arg(found.length),
            QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel);
        if (answer === QMessageBox.Cancel) {
            return "";
        }
        if (answer === QMessageBox.Yes) {
            CsLayoutPlot.leaveRastersOut(doc, di, found);
        }
    }
    var path = CsLayoutPlot.pathFor(doc, label);
    if (path === "") {
        path = CsFiles.saveFile(appWin, qsTr("Plot to PDF"), QDir.homePath() + "/" + CsLayoutGen.fileSafe(label) + ".pdf", "PDF (*.pdf)");
        if (path === "") {
            return "";
        }
    }
    var back = LayoutPlot.exportPdf(di, names, path);
    if (back.ok !== true) {
        CsTell.warn(qsTr("Plot Layout: the PDF failed -- ") + back.error);
        return "";
    }
    try {
        QDesktopServices.openUrl(QUrl.fromLocalFile(path));
    } catch (eOpen) {
    }
    EAction.handleUserMessage(qsTr("Plotted %1 (%2 page(s)).").arg(path).arg(back.pages));
    return path;
};
