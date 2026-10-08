// PackageCave.js
//
// QCAD add-on tool: assembles a cave project folder into one zip.
//
// TWO KINDS, AND THE DIFFERENCE IS THE ENTRANCE. A cave folder holds
// the location three ways: the drawing's GeoLat/GeoLon/GeoStation tags,
// the aerial photograph fetched beside it (which needs no tags to be
// read), and whatever is written on the hand sketches. The SANITIZED
// package -- the default -- leaves all three out. The FULL archive
// keeps them, is meant for the group's own storage and for handing a
// project to the next cartographer, and says so in its file name and
// its manifest.
//
// PHOTOGRAPHS ARE LOCATION DATA, like sketches and more so: an entrance
// photograph shows where the entrance is, and a phone writes the
// coordinates into the file besides. So images/ follows the same rule
// as scans/ -- a checkbox, off by default in a sanitized package, on in
// a full archive -- and the map preview this suite generates into that
// folder is skipped entirely, being a picture of the drawing that is
// already in the package.
//
// AND EVERY PHOTOGRAPH IS RE-ENCODED ON THE WAY IN, which is what
// removes the metadata: Qt writes no EXIF, so decoding the picture and
// writing it out again leaves the pixels and nothing else -- no GPS, no
// timestamp, no camera. The rotation EXIF used to carry is applied to
// the pixels first (setAutoTransform), or every portrait photograph
// would come out of the package on its side.
//
// A photograph that CANNOT be decoded is LEFT OUT, and the manifest
// says so. Copying it untouched would be the one outcome worse than
// either: a file nobody checked, carrying whatever it carries, inside a
// package labelled sanitized.
//
// PDFs SHIP AS THEY ARE, in both kinds. A map in the cave's PDF/ folder
// was plotted on purpose by somebody who decided what it shows, and
// nothing here second-guesses that. Nor does anything here PLOT one:
// the packager collects what it finds and never generates a sheet.
//
// THE ORIGINAL IS NEVER TOUCHED. Sanitizing happens on a copy imported
// into a memory document; the drawing on disk is not opened, not
// modified and not resaved. The staged folder is assembled in the
// system temp directory, zipped, and deleted.
//
// The zip itself is made by whatever ships with the platform (see
// CsPackage.zipCommand): there is no zip library in the script engine,
// and taking on a dependency to write one archive would be a poor
// trade.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

function PackageCave(guiAction) {
    EAction.call(this, guiAction);
}

PackageCave.prototype = new EAction();

// Seconds allowed for the zip. A big cave with scans can be hundreds of
// megabytes and the process has nothing to report meanwhile.
PackageCave.TIMEOUT_S = 300;

PackageCave.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    packageCaveRun();
    this.terminate();
};

PackageCave.init = function(basePath) {
    var action = new RGuiAction(qsTr("Package Cave Project..."),
        RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/PackageCave.js");
    action.setIcon(basePath + "/PackageCave.svg");
    action.setStatusTip(qsTr("Assemble a cave project into one zip: " +
        "sanitized to share, or a full archive to keep"));
    action.setDefaultCommands(["packagecave", "pc", "pkgcave"]);
    action.setGroupSortOrder(455);
    action.setSortOrder(20); // housekeeping, so: last
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};

// ---------------------------------------------------------------------
// Which cave
// ---------------------------------------------------------------------

/**
 * The cave to package: the one in front of the user if this drawing has
 * been saved, otherwise whichever they pick off the shelf.
 */
PackageCave.chooseCave = function(parent) {
    var doc = EAction.getDocument();
    if (!isNull(doc)) {
        var path = doc.getFileName();
        if (path !== "") {
            var folder = CsCave.folderOf(path);
            var known = CsShelf.find(folder);
            if (known !== null) { return known; }
            return CsShelf.normalize({ name: CsCave.nameOf(path),
                folder: folder, drawing: path });
        }
    }

    var shelf = CsShelf.list();
    if (shelf.length === 0) {
        EAction.handleUserWarning(qsTr("No cave to package: open a cave's " +
            "drawing, or add one in Cave Survey > Caves."));
        return null;
    }
    var names = [];
    for (var i = 0; i < shelf.length; i++) { names.push(shelf[i].name); }

    var chosen = QInputDialog.getItem(parent, qsTr("Package Cave Project"),
        qsTr("Which cave?"), names, 0, false);
    if (isNull(chosen) || String(chosen) === "") { return null; }
    for (var c = 0; c < shelf.length; c++) {
        if (shelf[c].name === String(chosen)) { return shelf[c]; }
    }
    return null;
};

// ---------------------------------------------------------------------
// What to include
// ---------------------------------------------------------------------

/**
 * Everything in a cave project that could go in a package, as a tree:
 * root entries first, then one group per project folder.
 *
 * Two of the entries are not files at all yet -- the manifest and the
 * interchange exports are written INTO the package as it is built --
 * and they sit in the same list because from the user's side they are
 * the same decision: is this in the zip or not.
 *
 * \return [{ key, label, detail, kind, path, forced, sanitized, full,
 *            sanitizedAllowed, children }]
 */
PackageCave.contentsOf = function(record) {
    var groups = [];
    var root = { key: "root", label: "", children: [] };

    var sizeOf = function(path) {
        try {
            var bytes = (new QFileInfo(path)).size();
            if (bytes < 1024) { return bytes + " B"; }
            if (bytes < 1024 * 1024) { return Math.round(bytes / 1024) + " KB"; }
            return (Math.round(bytes / 1024 / 102.4) / 10) + " MB";
        } catch (e) {
            return "";
        }
    };

    // ---- the drawing, and the things written beside it ---------------
    root.children.push({
        key: "drawing", kind: "drawing", path: record.drawing,
        label: CsShelf.basename(record.drawing),
        detail: qsTr("the survey drawing — %1").arg(sizeOf(record.drawing)),
        forced: true, sanitized: true, full: true, sanitizedAllowed: true
    });

    var aerial = CsGeoProject.imagePathFor(record.drawing);
    if (aerial !== null && (new QFileInfo(aerial)).exists()) {
        root.children.push({
            key: "aerial", kind: "aerial", path: aerial,
            label: CsShelf.basename(aerial),
            detail: qsTr("aerial basemap — SHOWS THE SURFACE LOCATION"),
            forced: false, sanitized: false, full: true,
            // Never in a sanitized package, whatever is ticked: the
            // photograph IS the location, and a package that says
            // sanitized cannot carry it.
            sanitizedAllowed: false
        });
    }

    // The elevation grid, same rule as the photograph: it names one
    // hillside in one county, and a sanitized package cannot carry it.
    var dem = CsGeoProject.demPathFor(record.drawing);
    if (dem !== null && (new QFileInfo(dem)).exists()) {
        root.children.push({
            key: "surface", kind: "surface", path: dem,
            label: CsShelf.basename(dem),
            detail: qsTr("surface elevation grid — SHOWS THE SURFACE LOCATION"),
            forced: false, sanitized: false, full: true,
            sanitizedAllowed: false
        });
    }

    root.children.push({
        key: "data", kind: "data", path: "",
        label: qsTr("data/ — Compass, Survex, CSV"),
        detail: qsTr("written from the survey as the package is built"),
        forced: false, sanitized: true, full: true, sanitizedAllowed: true
    });

    root.children.push({
        key: "manifest", kind: "manifest", path: "",
        label: "MANIFEST.txt",
        detail: qsTr("cave, trips, declinations, open ends — always included"),
        forced: true, sanitized: true, full: true, sanitizedAllowed: true
    });

    groups.push(root);

    // ---- a group per project folder ----------------------------------
    var folderGroup = function(key, label, files, kind, defaults, detailFor) {
        if (files.length === 0) { return; }
        var children = [];
        for (var i = 0; i < files.length; i++) {
            children.push({
                key: key + ":" + i, kind: kind, path: files[i],
                label: CsShelf.basename(files[i]),
                detail: detailFor(files[i], sizeOf(files[i])),
                forced: false,
                sanitized: defaults.sanitized,
                full: defaults.full,
                sanitizedAllowed: true
            });
        }
        groups.push({ key: key, label: label + "  (" + children.length + ")",
            children: children });
    };

    folderGroup("pdf", CsCave.PDF + "/", CsCave.pdfFiles(record.folder), "pdf",
        { sanitized: true, full: true },
        function(path, size) { return qsTr("a plotted map — %1").arg(size); });

    var scansFolder = CsCave.findSubfolder(record.folder, CsCave.SCANS);
    folderGroup("scan", CsCave.SCANS + "/",
        scansFolder === null ? [] : PackageCave.filesIn(scansFolder), "scan",
        { sanitized: false, full: true },
        function(path, size) {
            return qsTr("sketch — may carry access notes — %1").arg(size);
        });

    folderGroup("image", CsCave.IMAGES + "/",
        CsCave.imageFiles(record.folder), "image",
        { sanitized: false, full: true },
        function(path, size) {
            return qsTr("photograph — re-encoded, EXIF removed — %1").arg(size);
        });

    // A LiDAR capture is a metric record of one specific place, and the
    // file may carry GPS and capture metadata besides -- so it is out of
    // a sanitized package by default, exactly like a sketch or a
    // photograph, and goes in only when somebody ticks it by name.
    folderGroup("capture", CsCave.LIDAR + "/",
        CsCave.captureFiles(record.folder), "capture",
        { sanitized: false, full: true },
        function(path, size) {
            return qsTr("LiDAR capture — records the place itself — %1").arg(size);
        });

    return groups;
};

/**
 * Asks what kind of package this is, and exactly what goes in it.
 *
 * The list is a TREE of the cave's own files, not a row of categories:
 * "include the scans" is a decision somebody can make without looking,
 * but "include THIS photograph" is the decision they actually want when
 * a folder holds an entrance shot they would rather not hand out.
 *
 * Built from checkboxes in a scroll area rather than a QTreeWidget,
 * which this bridge generates as a wrapper-only class -- `new
 * QTreeWidget()` warns and hands back an object with nothing behind it
 * (see CaveShelf.js, where the same trap ate the cave list).
 *
 * The mode drives the defaults: switching to a full archive ticks the
 * sketches and photographs, switching back unticks them -- but only for
 * entries nobody has touched, because a person who ticked one
 * photograph on purpose should not have it silently untick.
 *
 * \return {full, destination, items: [entry]} or null.
 */
PackageCave.ask = function(parent, record) {
    var groups = PackageCave.contentsOf(record);

    var dialog = new QDialog(parent);
    dialog.windowTitle = qsTr("Package Cave Project");
    dialog.setMinimumSize(new QSize(620, 560));

    var layout = new QVBoxLayout();

    var heading = new QLabel(record.name);
    try {
        var font = heading.font;
        font.setBold(true);
        heading.font = font;
    } catch (eFont) {
    }
    layout.addWidget(heading, 0, 0);

    var kind = new QGroupBox(qsTr("Package"));
    var kindLayout = new QVBoxLayout();
    var sanitized = new QRadioButton(
        qsTr("Sanitized — no coordinates, no aerial photograph"));
    var full = new QRadioButton(
        qsTr("Full archive — includes the entrance location"));
    sanitized.checked = true;
    kindLayout.addWidget(sanitized, 0, 0);
    kindLayout.addWidget(full, 0, 0);
    kind.setLayout(kindLayout);
    layout.addWidget(kind, 0, 0);

    layout.addWidget(new QLabel(qsTr("Contents")), 0, 0);

    var host = new QWidget();
    var hostLayout = new QVBoxLayout();
    var area = new QScrollArea();
    area.widgetResizable = true;

    // Every checkbox, with the entry it stands for, so reading the
    // answer back is a walk over one list.
    var rows = [];
    var touched = {};
    var loading = { yes: true };

    var makeRow = function(entry, indent, parentBox) {
        var box = new QCheckBox(entry.label);
        box.toolTip = entry.detail;
        var line = new QHBoxLayout();
        line.setContentsMargins(indent, 0, 0, 0);
        line.addWidget(box, 0, 0);
        var detail = new QLabel(entry.detail);
        detail.enabled = false;
        line.addWidget(detail, 1, 0);
        hostLayout.addLayout(line, 0);

        var row = { entry: entry, box: box, parentBox: parentBox };
        rows.push(row);

        box.stateChanged.connect(function() {
            if (loading.yes === true) { return; }
            touched[entry.key] = true;
            if (parentBox !== null) { PackageCave.syncParent(rows, parentBox); }
        });
        return row;
    };

    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var groupBox = null;

        if (group.label !== "") {
            groupBox = new QCheckBox(group.label);
            groupBox.setTristate(true);
            var groupLine = new QHBoxLayout();
            groupLine.setContentsMargins(0, 8, 0, 0);
            groupLine.addWidget(groupBox, 1, 0);
            hostLayout.addLayout(groupLine, 0);

            (function(box, key) {
                box.clicked.connect(function() {
                    // A folder's own box is the blunt instrument: it sets
                    // every file under it, and that counts as touching
                    // each of them.
                    var want = box.checkState() !== Qt.Unchecked;
                    box.setCheckState(want ? Qt.Checked : Qt.Unchecked);
                    for (var r = 0; r < rows.length; r++) {
                        if (rows[r].parentBox !== box) { continue; }
                        if (!rows[r].box.enabled) { continue; }
                        rows[r].box.checked = want;
                        touched[rows[r].entry.key] = true;
                    }
                });
            }(groupBox, group.key));
        }

        for (var c = 0; c < group.children.length; c++) {
            makeRow(group.children[c], groupBox === null ? 0 : 22, groupBox);
        }
    }

    hostLayout.addStretch(1);
    host.setLayout(hostLayout);
    area.setWidget(host);
    layout.addWidget(area, 1, 0);

    // ---- defaults, and what the mode does to them ---------------------
    var applyDefaults = function() {
        loading.yes = true;
        var isFull = full.checked === true;
        for (var r = 0; r < rows.length; r++) {
            var entry = rows[r].entry;
            var box = rows[r].box;

            if (entry.forced === true) {
                box.checked = true;
                box.enabled = false;
                box.toolTip = qsTr("Always included.");
                continue;
            }
            if (!isFull && entry.sanitizedAllowed === false) {
                box.checked = false;
                box.enabled = false;
                box.toolTip = qsTr("Never in a sanitized package: this is " +
                    "the cave's location.");
                continue;
            }
            box.enabled = true;
            box.toolTip = entry.detail;
            if (touched[entry.key] !== true) {
                box.checked = isFull ? entry.full : entry.sanitized;
            }
        }
        loading.yes = false;
        PackageCave.syncAllParents(rows);
    };

    full.toggled.connect(applyDefaults);

    var destination = CsPackage.depotFor(QDir.homePath());
    var whereLabel = new QLabel("");
    whereLabel.wordWrap = true;
    var updateWhere = function() {
        whereLabel.text = qsTr("Writes to: ") + destination + "/" +
            CsPackage.archiveName(record.name, PackageCave.today(),
                full.checked === true);
    };
    full.toggled.connect(updateWhere);
    layout.addWidget(whereLabel, 0, 0);

    var buttons = new QHBoxLayout();
    var changeButton = new QPushButton(qsTr("Change Folder..."));
    var okButton = new QPushButton(qsTr("Package"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addWidget(changeButton, 0, 0);
    buttons.addStretch(1);
    buttons.addWidget(okButton, 0, 0);
    buttons.addWidget(cancelButton, 0, 0);
    layout.addLayout(buttons, 0);
    dialog.setLayout(layout);

    changeButton.clicked.connect(function() {
        var picked = CsFiles.directory(dialog,
            qsTr("Where should the package go?"), destination);
        if (!isNull(picked) && String(picked) !== "") {
            destination = String(picked).replace(/\\/g, "/")
                .replace(/\/+$/, "");
            updateWhere();
        }
    });
    okButton.clicked.connect(function() { dialog.accept(); });
    cancelButton.clicked.connect(function() { dialog.reject(); });

    applyDefaults();
    updateWhere();

    // Shown, raised and activated before it blocks: raised from the cave
    // shelf (itself modal), a dialog that just exec()s lands BEHIND it,
    // and the application then refuses input until somebody finds the
    // window they cannot see.
    try {
        dialog.show();
        dialog.raise();
        dialog.activateWindow();
    } catch (eRaise) {
    }
    var answer = dialog.exec();
    var options = null;
    if (answer !== 0) {
        var items = [];
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].box.checked === true) { items.push(rows[i].entry); }
        }
        options = {
            full: full.checked === true,
            destination: destination,
            items: items
        };
    }
    destrDialog(dialog);
    return options;
};

/** Sets a folder's box from the files under it: all, none, or some. */
PackageCave.syncParent = function(rows, parentBox) {
    var total = 0;
    var checked = 0;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].parentBox !== parentBox) { continue; }
        total++;
        if (rows[i].box.checked === true) { checked++; }
    }
    if (total === 0) { return; }
    parentBox.setCheckState(checked === 0 ? Qt.Unchecked :
        (checked === total ? Qt.Checked : Qt.PartiallyChecked));
};

PackageCave.syncAllParents = function(rows) {
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
        var box = rows[i].parentBox;
        if (box === null || seen.indexOf(box) !== -1) { continue; }
        seen.push(box);
        PackageCave.syncParent(rows, box);
    }
};

/** Today, as the file names and the manifest write it. */
PackageCave.today = function() {
    return CsPackage.todayText();
};

// ---------------------------------------------------------------------
// Building the package
// ---------------------------------------------------------------------

/** Files directly inside a folder, full paths, name-sorted. */
PackageCave.filesIn = function(folder) {
    var out = [];
    if (folder === null || folder === undefined) { return out; }
    try {
        var dir = new QDir(folder);
        if (!dir.exists()) { return out; }
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            out.push(folder + "/" + String(names[i]));
        }
    } catch (e) {
    }
    return out;
};

/**
 * Copies photographs, stripped of their metadata, into the staging
 * folder.
 *
 * \return {copied, skipped: [name]} -- skipped are the ones no image
 *         plugin could decode, which are deliberately not copied at all.
 */
PackageCave.copyPhotosStripped = function(paths, targetFolder) {
    var result = { copied: 0, skipped: [] };
    if (!(new QDir()).mkpath(targetFolder)) { return result; }

    for (var i = 0; i < paths.length; i++) {
        var source = paths[i];
        var name = CsShelf.basename(source);
        var image = null;
        try {
            var reader = new QImageReader(source);
            // Bake in the orientation before the tag that carried it is
            // dropped with everything else.
            reader.setAutoTransform(true);
            image = reader.read();
        } catch (eRead) {
            image = null;
        }
        if (isNull(image) || image.isNull()) {
            result.skipped.push(name);
            continue;
        }

        var target = targetFolder + "/" + name;
        var written = false;
        try {
            var format = CsShelf.extension(name);
            if (format === "jpg" || format === "jpeg" || format === "jfif") {
                // 92: re-encoding is the price of stripping, and this is
                // high enough that nobody looking at a cave photograph
                // can tell.
                written = image.save(target, "JPEG", 92) === true;
            } else {
                written = image.save(target) === true;
            }
        } catch (eWrite) {
            written = false;
        }

        if (written) { result.copied++; } else { result.skipped.push(name); }
    }
    return result;
};

/** Copies into an existing staging folder; returns how many landed. */
PackageCave.copyInto = function(paths, targetFolder) {
    var copied = 0;
    if (!(new QDir()).mkpath(targetFolder)) { return 0; }
    for (var i = 0; i < paths.length; i++) {
        var name = CsShelf.basename(paths[i]);
        try {
            if ((new QFile(paths[i])).copy(targetFolder + "/" + name)) {
                copied++;
            }
        } catch (e) {
        }
    }
    return copied;
};

/**
 * Writes the drawing into the staging folder.
 *
 * Full: a byte copy. Sanitized: the drawing is imported into a MEMORY
 * document, the geographic anchor tags are removed from whichever
 * station carries them, any aerial basemap image is deleted, and that
 * document is exported. The file on disk is never opened for writing.
 *
 * \return {ok, stripped, basemaps, error}
 */
PackageCave.stageDrawing = function(record, stagingFolder, full) {
    var target = stagingFolder + "/" + CsShelf.basename(record.drawing);

    if (full === true) {
        var copied = false;
        try {
            copied = (new QFile(record.drawing)).copy(target);
        } catch (eCopy) {
            copied = false;
        }
        return { ok: copied, stripped: 0, basemaps: 0,
            error: copied ? "" : "Could not copy the drawing." };
    }

    // ONE SANITIZER, in Core. This was the only copy of it while
    // packaging was the only thing that shared a cave; the teaching
    // cave shares one too, and two implementations of the suite's first
    // rule is one that will be updated and one that will not.
    return CsSanitize.writeCopy(record.drawing, target);
};

/**
 * The exporter that persists custom properties as XDATA -- the same one
 * Save picks for a DXF with no format of its own. A package written by
 * any other writer would arrive with the survey data missing, which is
 * the one thing the drawing is for.
 */
PackageCave.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
            // String.contains is a library.js extension: present in the
            // application, absent in a bare -autostart engine.
            var label = String(filters[i]);
            if (label.indexOf("dxflib") !== -1 &&
                    label.indexOf("*.dxf") !== -1) {
                return filters[i];
            }
        }
    } catch (e) {
    }
    return "";
};

/** Removes the geographic anchor from every entity carrying it.
 *
 *  Kept as a name because callers and tests know it; the work moved to
 *  Core/CsSanitize.js when the teaching cave needed the same rule. */
PackageCave.stripGeoTags = function(doc, di) {
    return CsSanitize.stripGeoTags(doc, di);
};

/**
 * Writes the survey out in every interchange format, into data/.
 *
 * Sanitized unless the archive is full: survey.fixed is the imported
 * #Fix / *fix control, three of the four writers emit it, and on the
 * ordinary import those coordinates ARE the entrance. See
 * CsPackage.sanitizeSurvey -- this is the third route the location
 * takes out of a drawing, beside the geo tags and the aerial
 * photograph, and the only one that used to travel in a package
 * whose MANIFEST said it did not.
 */
PackageCave.stageData = function(survey, stagingFolder, caveName, full) {
    var written = [];
    if (survey === null || survey === undefined) { return written; }
    if (full !== true) {
        survey = CsPackage.sanitizeSurvey(survey);
    }
    var folder = stagingFolder + "/data";
    if (!(new QDir()).mkpath(folder)) { return written; }

    var stem = CsPackage.safeName(caveName).replace(/\s+/g, "-").toLowerCase();
    if (stem === "") { stem = "survey"; }

    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        var format = CsFormatRegistry.FORMATS[i];
        try {
            var text = format.write(survey);
            if (text === null || text === undefined || text === "") { continue; }
            var name = stem + "." + format.extensions[0];
            if (writeTextFile(folder + "/" + name, text) !== false) {
                written.push(name);
            }
        } catch (e) {
            // One format refusing a survey it cannot express is not a
            // reason to lose the other three.
        }
    }
    return written;
};

/**
 * Assembles, zips, and cleans up.
 */
PackageCave.build = function(record, options) {
    var caveFolder = record.folder;
    var stagingRoot = QDir.tempPath() + "/CaveCADPackage";
    var folderName = CsPackage.safeName(record.name);
    if (folderName === "") { folderName = "Cave"; }
    var staging = stagingRoot + "/" + folderName;

    try {
        var old = new QDir(staging);
        if (old.exists()) { old.removeRecursively(); }
    } catch (eClean) {
    }
    if (!(new QDir()).mkpath(staging)) {
        EAction.handleUserWarning(qsTr("Could not prepare a staging folder " +
            "in ") + stagingRoot);
        return false;
    }

    var contents = [];

    // ---- the drawing --------------------------------------------------
    var drawing = PackageCave.stageDrawing(record, staging, options.full);
    if (!drawing.ok) {
        EAction.handleUserWarning(qsTr("Package failed: ") + drawing.error);
        return false;
    }
    contents.push({ path: CsShelf.basename(record.drawing),
        note: options.full ? "the drawing, complete" :
            "the drawing, geographic anchor removed" });

    // ---- the survey, read once and used twice -------------------------
    var read = CaveShelfReadForPackage(record);

    // ---- whatever was ticked, by kind ---------------------------------
    var chosen = function(kind) {
        var out = [];
        var items = (Object.prototype.toString.call(options.items) ===
            "[object Array]") ? options.items : [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === kind && items[i].path !== "") {
                out.push(items[i].path);
            }
        }
        return out;
    };
    var wants = function(kind) {
        var items = (Object.prototype.toString.call(options.items) ===
            "[object Array]") ? options.items : [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === kind) { return true; }
        }
        return false;
    };

    var pdfs = chosen("pdf");
    if (pdfs.length > 0) {
        var pdfCount = PackageCave.copyInto(pdfs, staging + "/" + CsCave.PDF);
        if (pdfCount > 0) {
            contents.push({ path: CsCave.PDF + "/ (" + pdfCount + ")",
                note: "maps, exactly as they were plotted" });
        }
    }

    var scans = chosen("scan");
    if (scans.length > 0) {
        var scanCount = PackageCave.copyInto(scans,
            staging + "/" + CsCave.SCANS);
        if (scanCount > 0) {
            contents.push({ path: CsCave.SCANS + "/ (" + scanCount + ")",
                note: "hand sketches" });
        }
    }

    var captures = chosen("capture");
    if (captures.length > 0) {
        var captureCount = PackageCave.copyInto(captures,
            staging + "/" + CsCave.LIDAR);
        if (captureCount > 0) {
            contents.push({ path: CsCave.LIDAR + "/ (" + captureCount + ")",
                note: "LiDAR captures, copied as they are — nothing here " +
                    "reads or strips their metadata" });
        }
    }

    var photos = chosen("image");
    if (photos.length > 0) {
        var photoResult = PackageCave.copyPhotosStripped(photos,
            staging + "/" + CsCave.IMAGES);
        if (photoResult.copied > 0) {
            contents.push({ path: CsCave.IMAGES + "/ (" + photoResult.copied + ")",
                note: "photographs, re-encoded — no EXIF, no GPS" });
        }
        if (photoResult.skipped.length > 0) {
            contents.push({ path: "(left out)",
                note: photoResult.skipped.length + " photograph(s) no image " +
                    "plugin could read, so their metadata could not be " +
                    "removed: " + photoResult.skipped.join(", ") });
            EAction.handleUserWarning(qsTr("%1 photograph(s) were left out " +
                "of the package: nothing here can decode them, so their " +
                "metadata could not be stripped.")
                .arg(photoResult.skipped.length));
        }
    }

    // The aerial photograph can only have been ticked in a full archive
    // -- the dialog refuses it otherwise -- but check the mode here too,
    // because this function is callable without that dialog.
    var aerials = chosen("aerial");
    if (options.full && aerials.length > 0) {
        for (var a = 0; a < aerials.length; a++) {
            if ((new QFile(aerials[a])).copy(staging + "/" +
                    CsShelf.basename(aerials[a]))) {
                contents.push({ path: CsShelf.basename(aerials[a]),
                    note: "aerial basemap — SHOWS THE SURFACE LOCATION" });
            }
        }
    }

    // The elevation grid travels under the same rule as the photograph.
    var grids = chosen("surface");
    if (options.full && grids.length > 0) {
        for (var g = 0; g < grids.length; g++) {
            if ((new QFile(grids[g])).copy(staging + "/" +
                    CsShelf.basename(grids[g]))) {
                contents.push({ path: CsShelf.basename(grids[g]),
                    note: "surface elevation grid — SHOWS THE SURFACE LOCATION" });
            }
        }
    }

    // ---- interchange formats -------------------------------------------
    if (wants("data") && read !== null && read.survey !== null) {
        var written = PackageCave.stageData(read.survey, staging, record.name,
            options.full);
        if (written.length > 0) {
            contents.push({ path: "data/ (" + written.length + ")",
                note: written.join(", ") +
                    (options.full ? " — includes the survey's fixed control" :
                        " — no fixed station coordinates") });
        }
    }

    // ---- the manifest ---------------------------------------------------
    contents.push({ path: "MANIFEST.txt", note: "this file" });
    var manifest = CsPackage.manifest({
        caveName: record.name,
        date: PackageCave.today(),
        full: options.full,
        generator: PackageCave.generator(),
        length: read === null ? 0 : read.length,
        unit: read === null ? "ft" : read.unit,
        trips: PackageCave.tripsForManifest(read),
        ends: read === null ? [] : read.ends,
        contents: contents
    });
    writeTextFile(staging + "/MANIFEST.txt", manifest);

    // ---- zip -------------------------------------------------------------
    if (!(new QDir()).mkpath(options.destination)) {
        EAction.handleUserWarning(qsTr("Could not create ") +
            options.destination);
        return false;
    }
    var zipPath = options.destination + "/" +
        CsPackage.archiveName(record.name, PackageCave.today(), options.full);
    try {
        if ((new QFile(zipPath)).exists()) { (new QFile(zipPath)).remove(); }
    } catch (eRm) {
    }

    var command = CsPackage.zipCommand(RS.getSystemId(), stagingRoot,
        folderName, zipPath);
    var zipped = PackageCave.runZip(command);

    try {
        (new QDir(staging)).removeRecursively();
    } catch (eClean2) {
    }

    if (!zipped.ok) {
        EAction.handleUserWarning(qsTr("The package was assembled but not " +
            "zipped: ") + zipped.error);
        return false;
    }

    EAction.handleUserMessage(qsTr("%1 packaged: %2").arg(record.name)
        .arg(zipPath));
    QMessageBox.information(RMainWindowQt.getMainWindow(),
        qsTr("Package Cave Project"),
        (options.full ?
            qsTr("Full archive written — it carries the entrance location.\n\n") :
            qsTr("Sanitized package written — no coordinates, no aerial.\n\n")) +
        zipPath);
    return true;
};

/** Runs the platform's zip program and waits for it. */
PackageCave.runZip = function(command) {
    try {
        var process = new QProcess();
        process.setWorkingDirectory(command.workingDirectory);
        process.start(command.program, command.args);
        if (!process.waitForStarted(10000)) {
            return { ok: false, error: command.program + " would not start." };
        }
        if (!process.waitForFinished(PackageCave.TIMEOUT_S * 1000)) {
            process.kill();
            return { ok: false, error: "zipping timed out." };
        }
        if (process.exitCode() !== 0) {
            return { ok: false, error: command.program + " exited " +
                process.exitCode() + ": " +
                String(process.readAllStandardError()) };
        }
        return { ok: true, error: "" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
};

/** The suite's version, for the manifest. */
PackageCave.generator = function() {
    var version = (typeof CaveSurvey !== "undefined") ?
        CaveSurvey.version : undefined;
    return "CaveCAD Cave Survey" + (isNull(version) ? "" : " " + version);
};

/** Trip rows for the manifest, with each trip's declination. */
PackageCave.tripsForManifest = function(read) {
    if (read === null || read === undefined ||
            Object.prototype.toString.call(read.trips) !== "[object Array]") {
        return [];
    }
    var survey = read.survey;
    var records = (survey !== null && survey !== undefined &&
        Object.prototype.toString.call(survey.trips) === "[object Array]") ?
        survey.trips : [];

    var out = [];
    for (var i = 0; i < read.trips.length; i++) {
        var trip = read.trips[i];
        var record = records[trip.id];
        out.push({
            id: trip.id,
            name: trip.name,
            date: trip.date,
            team: trip.team,
            shots: trip.shots,
            declination: record === undefined || record === null ? undefined :
                record.declination,
            declinationSource: record === undefined || record === null ? "" :
                record.declinationSource
        });
    }
    return out;
};

/**
 * The survey behind the package, read the same way the cave shelf reads
 * it -- one import, cached against the file's timestamp, so packaging a
 * cave just looked at costs nothing.
 */
function CaveShelfReadForPackage(record) {
    if (typeof CaveShelf === "undefined") { return null; }
    var read = CaveShelf.readCave(record);
    return read.ok ? read : null;
}

/**
 * Packages one cave, start to finish: counts what is there, asks, and
 * builds. Public because the cave shelf packages the cave it already
 * has selected rather than asking again which cave is meant.
 *
 * \return true if an archive was written.
 */
PackageCave.forRecord = function(record, parent) {
    if (record === null || record === undefined) { return false; }
    if (CsShelf.clean(record.drawing) === "" ||
            !(new QFileInfo(record.drawing)).exists()) {
        EAction.handleUserWarning(qsTr("This cave has no drawing to " +
            "package yet."));
        return false;
    }

    var options = PackageCave.ask(
        isNull(parent) ? RMainWindowQt.getMainWindow() : parent, record);
    if (options === null) { return false; }

    return PackageCave.build(record, options);
};

function packageCaveRun() {
    var record = PackageCave.chooseCave(RMainWindowQt.getMainWindow());
    if (record === null) { return; }
    PackageCave.forRecord(record);
}
