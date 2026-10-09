// SplitTrips.js -- split a whole-cave drawing into one file per trip plus an overall file, or put them back together.
//
// A drawing with no split trips shows the SPLIT window: the trips found, a tick for each, a folder. The open drawing is not
// changed; the files are written beside each other (one per trip, plus "<cave> - Overall.dxf" that shows each trip as an
// Overlay xref at 0,0 with a relative path).
// A drawing that has split trips attached shows the MERGE window instead: the trips are pasted back into this drawing and
// the xrefs removed. Either way the result is counted so a loss is visible.
// The logic is Core/CsSplit.js.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function SplitTrips(guiAction) {
    EAction.call(this, guiAction);
}

SplitTrips.prototype = new EAction();

SplitTrips.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || CsModelSpace.blocksWhole(doc, qsTr("Split into Trips"))) {
        this.terminate();
        return;
    }
    try {
        if (CsSplit.tripXrefs(doc).length > 0) {
            SplitTrips.showMerge(doc, di);
        }
        else {
            SplitTrips.showSplit(doc, di);
        }
    }
    catch (e) {
        CsTell.warn(qsTr("Split into Trips could not finish: %1").arg(String(e)));
    }
    this.terminate();
};

/** A table of rows with a tick box in the first column; rows[i] = [cells...]. \return the table */
SplitTrips.makeTable = function(headers, rows, ticked) {
    var table = new QTableWidget(0, headers.length);
    table.setHorizontalHeaderLabels(headers);
    table.setRowCount(rows.length);
    for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].length; c++) {
            var cell = new QTableWidgetItem(String(rows[r][c]));
            try {
                if (c === 0) {
                    cell.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable);
                    cell.setCheckState(ticked ? Qt.Checked : Qt.Unchecked);
                }
                else {
                    cell.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable);
                }
            } catch (eF) {
            }
            table.setItem(r, c, cell);
        }
    }
    try { table.setColumnWidth(0, 330); } catch (eW) { }
    return table;
};

SplitTrips.ticked = function(table, rowCount) {
    var out = [];
    for (var r = 0; r < rowCount; r++) {
        var it = table.item(r, 0);
        if (!isNull(it) && it.checkState() === Qt.Checked) { out.push(r); }
    }
    return out;
};

SplitTrips.caveNameOf = function(doc) {
    var f = "";
    try { f = String(doc.getFileName()); } catch (e) { f = ""; }
    var stem = f === "" ? "" : CsXref.stem(f);
    return stem === "" ? "Cave" : stem;
};

SplitTrips.showSplit = function(doc, di) {
    var scan = CsSplit.scan(doc);
    if (scan.rows.length === 0) {
        CsTell.warn(qsTr("No trips were found in this drawing. Trips are made by Import Cave Survey / Draw."));
        return;
    }
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Split into Trips");
    try { dlg.resize(620, 460); } catch (eS) { }
    var v = new QVBoxLayout();
    v.addWidget(new QLabel(qsTr("Each ticked trip gets its own file with every station in it. The overall file shows each trip as an Overlay xref. This drawing is not changed.")), 0, 0);
    var rows = [];
    for (var i = 0; i < scan.rows.length; i++) {
        rows.push([CsSplit.tripLabel(scan.rows[i]), scan.rows[i].count]);
    }
    var table = SplitTrips.makeTable([qsTr("Trip"), qsTr("Items")], rows, true);
    v.addWidget(table, 0, 0);
    v.addWidget(new QLabel(qsTr("Stations and control layers in every file: %1 items. Staying in the overall file only (no trip): %2 items.").arg(scan.shared).arg(scan.other)), 0, 0);
    var folderRow = new QHBoxLayout();
    var base = CsXref.baseDirOf(doc);
    var folder = new QLineEdit(base === "" ? RSettings.getDocumentsLocation() : base);
    var bBrowse = new QPushButton(qsTr("Folder..."));
    folderRow.addWidget(new QLabel(qsTr("Write files to")), 0, 0);
    folderRow.addWidget(folder, 0, 0);
    folderRow.addWidget(bBrowse, 0, 0);
    v.addLayout(folderRow);
    var cave = new QLineEdit(SplitTrips.caveNameOf(doc));
    var nameRow = new QHBoxLayout();
    nameRow.addWidget(new QLabel(qsTr("Cave name for the file names")), 0, 0);
    nameRow.addWidget(cave, 0, 0);
    v.addLayout(nameRow);
    var relative = new QCheckBox(qsTr("Keep the trip files' paths relative (so the folder can be moved or shared)"));
    relative.checked = true;
    v.addWidget(relative, 0, 0);
    var note = new QLabel("");
    v.addWidget(note, 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);
    bBrowse.clicked.connect(function() {
        var p = CsFiles.directory(RMainWindowQt.getMainWindow(), qsTr("Folder for the split files"), folder.text);
        if (!isNull(p) && String(p) !== "") { folder.text = String(p); }
    });
    var accepted = (dlg.exec() === QDialog.Accepted);
    var chosen = SplitTrips.ticked(table, scan.rows.length).map(function(r) { return scan.rows[r].trip; });
    var opts = { cave: cave.text, folder: String(folder.text).replace(/[\\\/]+$/, ""), trips: chosen,
        pathStyle: relative.checked ? CsXref.RELATIVE : CsXref.ABSOLUTE };
    try { dlg.close(); dlg.deleteLater(); } catch (eC) { }
    if (!accepted) { return; }
    var res = CsSplit.split(doc, di, opts);
    if (!res.ok) {
        CsTell.warn(qsTr("The split did not finish: %1").arg(res.why));
        return;
    }
    var lines = [];
    for (var f = 0; f < res.files.length; f++) {
        lines.push(qsTr("Trip %1: %2 items -> %3").arg(res.files[f].trip).arg(res.counts[String(res.files[f].trip)]).arg(res.files[f].name));
    }
    lines.push(qsTr("Overall file: %1").arg(res.overall));
    lines.push(qsTr("Open the overall file to see the trips. To put them back into one drawing, open it and run Split into Trips again."));
    QMessageBox.information(RMainWindowQt.getMainWindow(), qsTr("Split into Trips"), lines.join("\n"));
};

SplitTrips.showMerge = function(doc, di) {
    var xrefs = CsSplit.tripXrefs(doc);
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Merge Trips Back");
    try { dlg.resize(760, 380); } catch (eS) { }
    var v = new QVBoxLayout();
    v.addWidget(new QLabel(qsTr("Each ticked trip's own items are brought back into this drawing and its xref is removed. The trip files are left as they are.")), 0, 0);
    var rows = [];
    for (var i = 0; i < xrefs.length; i++) {
        rows.push([qsTr("Trip %1").arg(xrefs[i].trip), xrefs[i].status === "missing" ? qsTr("MISSING") : qsTr("found"), xrefs[i].full]);
    }
    var table = SplitTrips.makeTable([qsTr("Trip"), qsTr("File"), qsTr("Path")], rows, true);
    try { table.setColumnWidth(0, 160); table.setColumnWidth(1, 90); table.setColumnWidth(2, 460); } catch (eW) { }
    v.addWidget(table, 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);
    var accepted = (dlg.exec() === QDialog.Accepted);
    var chosen = SplitTrips.ticked(table, xrefs.length).map(function(r) { return xrefs[r].trip; });
    try { dlg.close(); dlg.deleteLater(); } catch (eC) { }
    if (!accepted || chosen.length === 0) { return; }
    var res = CsSplit.merge(doc, di, { trips: chosen });
    if (!res.ok) {
        CsTell.warn(qsTr("The merge did not finish: %1").arg(res.why));
        return;
    }
    var lines = [];
    for (var m = 0; m < res.merged.length; m++) {
        var r = res.merged[m];
        lines.push(qsTr("Trip %1: %2 of %3 items brought back%4").arg(r.trip).arg(r.got).arg(r.expected).arg(r.got === r.expected ? "" : qsTr("  <- DIFFERENT, please check")));
    }
    for (var n = 0; n < res.notes.length; n++) { lines.push(res.notes[n]); }
    QMessageBox.information(RMainWindowQt.getMainWindow(), qsTr("Merge Trips Back"), lines.join("\n"));
};

SplitTrips.init = function(basePath) {
    var action = new RGuiAction(qsTr("Split into Trips"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/SplitTrips.js");
    action.setIcon(basePath + "/SplitTrips.svg");
    action.setStatusTip(qsTr("Split the cave into one file per trip plus an overall file that shows each trip as an xref, or put the trips back into one drawing"));
    action.setDefaultCommands(["splittrips", "spt"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(68);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
