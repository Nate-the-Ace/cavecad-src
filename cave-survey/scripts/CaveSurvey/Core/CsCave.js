// CsCave.js -- the cave folder on the shared drive, and nothing more.
//
// The survey group syncs cave folders through Google Drive, and Drive
// does the syncing. This file does NOT sync, version, lock, upload or
// authenticate. Its whole job is that the app knows the shape of a cave
// folder the moment a drawing is saved into one:
//
//     ALL DAY CAVE/            the cave, named the way people say it
//       All Day Cave.dxf       the drawing
//       All Day Cave-aerial.png  the basemap, when one was fetched
//       scans/                 scanned hand sketches
//       PDF/                   produced maps
//       images/                photographs, and the map's own preview
//       lidar/                 LiDAR captures
//
// PDF/ is where finished maps are kept, and nothing in the suite ever
// writes one: plotting a sheet is the cartographer's job, and Package
// Cave Project only COLLECTS what it finds there. Its name is matched
// case-insensitively -- "PDF", "pdf" and "Pdf" are all the same folder
// to a surveyor, and on Linux they are three different folders to
// QDir.
//
// That is the entire convention. No marker file, no index, no slug --
// a cave folder is simply the folder a cave drawing was saved in, which
// is what the group already does (BIG Survey Group holds ALL DAY CAVE,
// BC Pit, IU Show Cave, TRUITT CAVE exactly like this).
//
// WHAT IT ACTUALLY BUYS. QCAD's stock image insert opens wherever the
// setting "Image/Path" last pointed -- read at Draw/Image/Image.js:144,
// written back at :229. Point that at this cave's scans/ folder when a
// cave drawing is saved and Draw > Image opens on the sketches for the
// cave in front of you, with no dialog wrapped and no tool replaced.
//
// SCANS/ IS ONLY EVER CREATED UNDER A SHARED DRIVE. Making one beside
// every DXF anyone saves anywhere would litter directories that have
// nothing to do with caving; making one only under the drive folder
// means the empty folder that appears is always somewhere it belongs.

var CsCave = {};

CsCave.SCANS = "scans";
CsCave.PDF = "PDF";
CsCave.IMAGES = "images";

// The folders a cave project keeps beside its drawing.
// Where CsBackup keeps previous versions, datestamped. Part of the
// standard structure so a cave folder has one whether or not a backup
// has been taken yet -- an empty backup/ says the guard exists; a
// missing one says nothing.
CsCave.BACKUP = "backup";

// LiDAR captures -- Polycam and the like.
//
// CALLED CAPTURES, NEVER SCANS. A scan in this suite is a scanned
// notebook page: SketchScans, eleven CsScan* files, the shared browser
// widget, the scans/ folder. One word for both would make every
// sentence after this one ambiguous, so the phone's word loses and the
// surveyor's word keeps its meaning.
//
// A CAPTURE IS LOCATION DATA -- a metric record of one specific place,
// and the file may carry GPS and capture metadata besides. So lidar/ is
// treated exactly like scans/ and images/ when a project is packaged:
// left out of a sanitized package unless somebody asks for it by name.
// See PackageCave.js.
CsCave.LIDAR = "lidar";

CsCave.SUBFOLDERS = [CsCave.SCANS, CsCave.PDF, CsCave.IMAGES,
                     CsCave.BACKUP, CsCave.LIDAR];

// The map's own preview lives in images/ with the photographs, under a
// name derived from the drawing, so a person looking in that folder can
// tell the generated picture from the ones they put there.
CsCave.PREVIEW_SUFFIX = " preview.png";

// PHOTOGRAPHS OF A CAVE ARE LOCATION DATA. An entrance photograph shows
// where the entrance is, and a phone writes the coordinates into the
// file besides. Nothing here reads or strips EXIF, so images/ is
// treated exactly like scans/ when a project is packaged: left out of a
// sanitized package unless somebody asks for it by name. See
// PackageCave.js.

/** The images folder for a cave folder, as it exists, or null. */
CsCave.imagesFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.IMAGES);
};

/** The lidar folder for a cave folder, as it exists, or null. */
CsCave.lidarFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.LIDAR);
};

// What a capture file looks like. Polycam's free export is glTF, which
// comes as either a .glb (one file, geometry and textures packed) or a
// .gltf beside its .bin and textures; the rest are here because a
// surveyor who paid for the other exports should not find their files
// invisible to the packager.
CsCave.CAPTURE_SUFFIXES = [".glb", ".gltf", ".obj", ".ply", ".stl",
                           ".las", ".laz", ".e57", ".xyz", ".pts"];

/** Whether a file name looks like a LiDAR capture. */
CsCave.isCaptureName = function(name) {
    var lower = String(name).toLowerCase();
    for (var i = 0; i < CsCave.CAPTURE_SUFFIXES.length; i++) {
        var suffix = CsCave.CAPTURE_SUFFIXES[i];
        if (lower.length >= suffix.length &&
            lower.lastIndexOf(suffix) === lower.length - suffix.length) {
            return true;
        }
    }
    return false;
};

/**
 * Where the map preview for a drawing belongs: inside the cave's own
 * images folder, named after the drawing.
 *
 * \return the path, or null when the drawing has no folder.
 */
CsCave.previewPathFor = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    var stem = docPath.substring(folder.length + 1);
    var dot = stem.lastIndexOf(".");
    if (dot > 0) { stem = stem.substring(0, dot); }
    if (stem === "") { return null; }
    var images = CsCave.imagesFolderOf(folder);
    if (images === null) { images = folder + "/" + CsCave.IMAGES; }
    return images + "/" + stem + CsCave.PREVIEW_SUFFIX;
};

/** True for the generated preview, as opposed to somebody's photograph. */
CsCave.isPreviewName = function(name) {
    if (typeof name !== "string") { return false; }
    return name.length > CsCave.PREVIEW_SUFFIX.length &&
        name.substring(name.length - CsCave.PREVIEW_SUFFIX.length) ===
            CsCave.PREVIEW_SUFFIX;
};

// An explicit drive folder, when the automatic answer is wrong -- a
// second account, a non-default mount, a group that keeps caves on
// Dropbox or a file server instead. Empty means "detect".
CsCave.SETTING_ROOT = "CaveSurvey/CaveRoot";

// ---------------------------------------------------------------------
// Pure half -- no Q* or R* globals, so tests/js_unit.js can reach it.
// ---------------------------------------------------------------------

// The folder a drawing lives in. Forward slashes only: Qt reports file
// paths with "/" on every platform this add-on targets, Windows too.
CsCave.folderOf = function(docPath) {
    if (typeof docPath !== "string" || docPath.length === 0) { return null; }
    var slash = docPath.lastIndexOf("/");
    if (slash <= 0) { return null; }
    return docPath.substring(0, slash);
};

// The cave's name, for messages: the folder's own name.
CsCave.nameOf = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    var slash = folder.lastIndexOf("/");
    var name = (slash === -1) ? folder : folder.substring(slash + 1);
    return name.length > 0 ? name : null;
};

CsCave.scansDir = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    return folder === null ? null : folder + "/" + CsCave.SCANS;
};

CsCave.pdfDir = function(docPath) {
    var folder = CsCave.folderOf(docPath);
    return folder === null ? null : folder + "/" + CsCave.PDF;
};

// Is this an absolute path? "/..." everywhere this add-on runs, plus
// "C:/..." and "C:\..." on Windows. Used to tell a path STORED in a
// drawing (relative to scans/, the suite's convention) from one an
// older build stored absolute.
CsCave.isAbsolutePath = function(p) {
    if (typeof p !== "string" || p.length === 0) { return false; }
    if (p.charAt(0) === "/" || p.charAt(0) === "\\") { return true; }
    return /^[A-Za-z]:[\/\\]/.test(p);
};

// A scan's path AS A DRAWING SHOULD STORE IT: relative to the cave's
// scans/ folder.
//
// WHY RELATIVE. An absolute path is only true on the machine that wrote
// it. Cave projects live on a shared drive, get renamed, and get opened
// by whoever is on the trip -- an absolute path makes every reopen on
// any other machine report a missing scan. SketchScans already tags its
// own inserted images with the relative path for exactly this reason.
//
// A path that is NOT under this cave's scans/ (a scan the caver picked
// from somewhere else entirely, or a cave with no scans/ folder at all)
// comes back UNCHANGED, still absolute: a wrong relative path would
// resolve to a file that does not exist, which is worse than an honest
// absolute one. Case-insensitive, because real cave folders in the wild
// carry "Scans" as often as "scans" and macOS does not care which.
// Pure.
CsCave.relativeToScans = function(scansFolder, absPath) {
    if (typeof absPath !== "string" || absPath.length === 0) { return ""; }
    if (typeof scansFolder !== "string" || scansFolder.length === 0) {
        return absPath;
    }
    var prefix = scansFolder;
    if (prefix.charAt(prefix.length - 1) !== "/") { prefix = prefix + "/"; }
    if (absPath.length <= prefix.length) { return absPath; }
    if (absPath.substring(0, prefix.length).toLowerCase() !==
            prefix.toLowerCase()) {
        return absPath;
    }
    return absPath.substring(prefix.length);
};

// The other direction: what a stored scan path means on THIS machine.
// A relative one is joined onto the cave's scans/ folder; an absolute
// one (what builds before the relative convention wrote) is handed back
// as it stands, so a section captured by an older build still reopens.
// Pure.
CsCave.resolveUnderScans = function(scansFolder, stored) {
    if (typeof stored !== "string" || stored.length === 0) { return ""; }
    if (CsCave.isAbsolutePath(stored)) { return stored; }
    if (typeof scansFolder !== "string" || scansFolder.length === 0) {
        return stored;
    }
    var base = scansFolder;
    if (base.charAt(base.length - 1) === "/") {
        base = base.substring(0, base.length - 1);
    }
    return base + "/" + stored;
};

// Is this file name a PDF? Extension only, case-insensitive -- the
// packager trusts the folder, not the bytes.
CsCave.isPdfName = function(name) {
    if (typeof name !== "string") { return false; }
    return /\.pdf$/i.test(name);
};

// Is this drawing inside one of the drive folders?
//
// Prefix matching with a trailing separator, so "/x/GoogleDrive-me" does
// not swallow "/x/GoogleDrive-metoo". A path already inside a scans/
// folder still answers true -- it is under the drive either way, and
// deciding otherwise is scansDir's business, not this function's.
CsCave.isUnderDrive = function(docPath, roots) {
    if (typeof docPath !== "string" || docPath.length === 0) { return false; }
    if (Object.prototype.toString.call(roots) !== "[object Array]") {
        return false;
    }
    for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (typeof r !== "string" || r.length === 0) { continue; }
        var base = r.replace(/\/+$/, "");
        if (base.length === 0) { continue; }
        if (docPath.indexOf(base + "/") === 0) { return true; }
    }
    return false;
};

// ---------------------------------------------------------------------
// Runtime half -- Qt and settings. Every function here degrades to a
// no-op rather than throwing: a folder convenience may never be the
// reason a save or a startup fails.
// ---------------------------------------------------------------------

// Where Google Drive for Desktop mounts. On macOS the current client
// uses ~/Library/CloudStorage/GoogleDrive-<account>/, one per signed-in
// account, and older installs leave a ~/Google Drive. Both are listed
// when both exist, because a surveyor with two accounts has caves under
// whichever one the group shared with.
//
// An explicit CsCave.SETTING_ROOT wins outright -- if someone has said
// where the caves are, do not go looking somewhere else.
CsCave.driveRoots = function() {
    var roots = [];
    if (typeof RSettings === "undefined" || typeof QDir === "undefined") {
        return roots;
    }
    try {
        var set = RSettings.getStringValue(CsCave.SETTING_ROOT, "");
        if (typeof set === "string" && set.length > 0) {
            return [set.replace(/\/+$/, "")];
        }
    } catch (e) {
    }
    try {
        var home = QDir.homePath();
        var cloud = home + "/Library/CloudStorage";
        var dir = new QDir(cloud);
        if (dir.exists()) {
            var names = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
            for (var i = 0; i < names.length; i++) {
                var n = String(names[i]);
                if (n.indexOf("GoogleDrive") === 0) {
                    roots.push(cloud + "/" + n);
                }
            }
        }
        if ((new QDir(home + "/Google Drive")).exists()) {
            roots.push(home + "/Google Drive");
        }
    } catch (e2) {
    }
    return roots;
};

// A subfolder of `folder` whose name matches `name` however it was
// cased, or null. macOS does not care about the difference; Linux does,
// and a cave folder that came off somebody else's machine can hold
// "pdf" where this one would have made "PDF".
CsCave.findSubfolder = function(folder, name) {
    if (typeof QDir === "undefined") { return null; }
    if (typeof folder !== "string" || folder === "" ||
            typeof name !== "string" || name === "") {
        return null;
    }
    try {
        var dir = new QDir(folder);
        if (!dir.exists()) { return null; }
        var wanted = name.toLowerCase();
        var names = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, 0);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (n.toLowerCase() === wanted) { return folder + "/" + n; }
        }
    } catch (e) {
    }
    return null;
};

// The cave's PDF folder as it exists on disk, whatever its casing, or
// null when there is none. Read-only: this never creates anything.
CsCave.pdfFolderOf = function(folder) {
    return CsCave.findSubfolder(folder, CsCave.PDF);
};

// Natural, case-insensitive ordering: digit runs compare as NUMBERS,
// everything else as lowercased text. Surveyors name trip folders by
// date -- "4-6-24 Survey Scans" -- and scanners number pages --
// "Page_10.jpg" -- and a plain string sort puts November before April
// and page 10 before page 2. Ties on equal numbers ("03" vs "3") fall
// back to plain string order so the ordering stays total and
// deterministic.
CsCave.compareNatural = function(a, b) {
    var sa = String(a), sb = String(b);
    var la = sa.toLowerCase(), lb = sb.toLowerCase();
    var ia = 0, ib = 0;
    var digits = /[0-9]/;
    while (ia < la.length && ib < lb.length) {
        var ca = la.charAt(ia), cb = lb.charAt(ib);
        if (digits.test(ca) && digits.test(cb)) {
            var ja = ia, jb = ib;
            while (ja < la.length && digits.test(la.charAt(ja))) { ja++; }
            while (jb < lb.length && digits.test(lb.charAt(jb))) { jb++; }
            var na = parseInt(la.substring(ia, ja), 10);
            var nb = parseInt(lb.substring(ib, jb), 10);
            if (na !== nb) { return na < nb ? -1 : 1; }
            ia = ja; ib = jb;
            continue;
        }
        if (ca !== cb) { return ca < cb ? -1 : 1; }
        ia++; ib++;
    }
    // one ran out: the shorter (a prefix of the longer) comes first
    var restA = la.length - ia, restB = lb.length - ib;
    if (restA !== restB) { return restA < restB ? -1 : 1; }
    // numerically equal all the way through ("03" vs "3"): plain order
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
};

// Every file under `folder` matching the QDir name filters, as paths
// RELATIVE to `folder`, sorted naturally (dates and page numbers in
// human order -- see compareNatural). Recurses into
// subfolders down to `maxDepth` levels (0 = the folder itself only),
// skipping hidden ones. Surveyors keep scans in per-trip subfolders
// ("scans/2025 Scans/9-7-25 Survey Scans/..."), so a flat listing of
// scans/ itself sees nothing.
CsCave.filesUnder = function(folder, filters, maxDepth) {
    if (typeof QDir === "undefined") { return []; }
    if (typeof folder !== "string" || folder === "") { return []; }
    if (typeof maxDepth !== "number" || maxDepth < 0) { maxDepth = 4; }
    var out = [];
    var walk = function(abs, rel, depth) {
        var dir = new QDir(abs);
        if (!dir.exists()) { return; }
        var files = dir.entryList(filters, QDir.Files, QDir.Name);
        var i;
        for (i = 0; i < files.length; i++) {
            out.push(rel + String(files[i]));
        }
        if (depth >= maxDepth) { return; }
        var subs = dir.entryList([], QDir.Dirs | QDir.NoDotAndDotDot,
            QDir.Name);
        for (i = 0; i < subs.length; i++) {
            var name = String(subs[i]);
            if (name.charAt(0) === ".") { continue; }
            walk(abs + "/" + name, rel + name + "/", depth + 1);
        }
    };
    try {
        walk(folder, "", 0);
    } catch (e) {
        // an unreadable folder reads as empty
    }
    out.sort(CsCave.compareNatural);
    return out;
};

// The photographs in a cave's images folder -- everything except the
// preview this suite generates. Name-sorted, full paths.
CsCave.imageFiles = function(folder, includePreview) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var images = CsCave.imagesFolderOf(folder);
    if (images === null) { return out; }
    try {
        var dir = new QDir(images);
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (n.indexOf(".") === 0) { continue; }
            if (includePreview !== true && CsCave.isPreviewName(n)) { continue; }
            out.push(images + "/" + n);
        }
    } catch (e) {
    }
    return out;
};

// Every capture in a cave's lidar folder, as full paths, name-sorted.
// A .gltf's companion .bin and textures are NOT listed separately: they
// are parts of the capture the .gltf names, and a packager that offered
// them as loose files would invite half a capture being copied.
CsCave.captureFiles = function(folder) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var lidar = CsCave.lidarFolderOf(folder);
    if (lidar === null) { return out; }
    try {
        var dir = new QDir(lidar);
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (n.indexOf(".") === 0) { continue; }
            if (!CsCave.isCaptureName(n)) { continue; }
            out.push(lidar + "/" + n);
        }
    } catch (e) {
    }
    return out;
};

// Every PDF in a cave's PDF folder, as full paths, name-sorted.
// An absent folder and an empty one both answer [] -- "no maps" is a
// normal state for a cave nobody has plotted yet, not an error.
CsCave.pdfFiles = function(folder) {
    var out = [];
    if (typeof QDir === "undefined") { return out; }
    var pdfDir = CsCave.pdfFolderOf(folder);
    if (pdfDir === null) { return out; }
    try {
        var dir = new QDir(pdfDir);
        var names = dir.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < names.length; i++) {
            var n = String(names[i]);
            if (CsCave.isPdfName(n)) { out.push(pdfDir + "/" + n); }
        }
    } catch (e) {
    }
    return out;
};

// Creates the folders a cave project keeps (scans/, PDF/) inside an
// EXISTING cave folder, skipping any that are already there under any
// casing.
//
// Same restraint as pointAtScans: only under a drive root, so the app
// never scatters empty folders through directories that have nothing to
// do with caving. `force` is for the launcher's own New Cave flow,
// where the user just said in so many words that this folder is a cave.
//
// \return the folders created (possibly empty), or null when there was
// nothing to do.
CsCave.ensureProjectFolders = function(folder, force) {
    if (typeof QDir === "undefined") { return null; }
    if (typeof folder !== "string" || folder === "") { return null; }
    if (force !== true && !CsCave.isUnderDrive(folder + "/x", CsCave.driveRoots())) {
        return null;
    }
    var made = [];
    try {
        if (!(new QDir(folder)).exists()) { return null; }
        for (var i = 0; i < CsCave.SUBFOLDERS.length; i++) {
            var sub = CsCave.SUBFOLDERS[i];
            if (CsCave.findSubfolder(folder, sub) !== null) { continue; }
            var path = folder + "/" + sub;
            if ((new QDir()).mkpath(path)) { made.push(path); }
        }
    } catch (e) {
        return made;
    }
    return made;
};

/**
 * Writes a drawing's preview picture into its cave project (images/),
 * and into the application's own thumbnail cache as well so the stock
 * recent-files list shows the same picture.
 *
 * \param image a QImage, normally RDocumentInterface.getThumbnail()
 * \return true if a picture landed somewhere.
 */
CsCave.writePreview = function(docPath, image) {
    var wrote = false;
    var usable = false;
    try {
        usable = image !== undefined && image !== null && !image.isNull();
    } catch (eNull) {
        usable = false;
    }

    // No picture in hand? The stock save has just handed one to
    // RSettings.addRecentFile, which wrote it to the application cache
    // -- so take it from there. The thumbnail on the document interface
    // is only refreshed from a graphics view WITH FOCUS, and a save that
    // happens while a dialog is up (importing a cave is exactly that)
    // finds no focused view and leaves it empty.
    if (!usable) {
        return CsCave.copyCachedPreview(docPath);
    }

    var put = function(target) {
        if (target === null || target === undefined) { return false; }
        try {
            var info = new QFileInfo(String(target));
            info.dir().mkpath(".");
            return image.save(String(target), "PNG") === true;
        } catch (e) {
            return false;
        }
    };

    if (put(CsCave.previewPathFor(docPath))) { wrote = true; }
    try {
        if (typeof RSettings !== "undefined" &&
                typeof RSettings.getThumbnailFilePath === "function") {
            if (put(RSettings.getThumbnailFilePath(docPath))) { wrote = true; }
        }
    } catch (eCache) {
    }
    return wrote;
};

/**
 * Copies the application's cached thumbnail for a drawing into the
 * cave's images/ folder. The fallback for a save with no focused view.
 *
 * \return true if a picture landed.
 */
CsCave.copyCachedPreview = function(docPath) {
    if (typeof RSettings === "undefined" ||
            typeof RSettings.getThumbnailFilePath !== "function") {
        return false;
    }
    try {
        var cached = String(RSettings.getThumbnailFilePath(docPath));
        var info = new QFileInfo(cached);
        if (!info.exists() || info.size() === 0) { return false; }

        var target = CsCave.previewPathFor(docPath);
        if (target === null) { return false; }
        (new QFileInfo(String(target))).dir().mkpath(".");
        if ((new QFileInfo(String(target))).exists()) {
            (new QFile(String(target))).remove();
        }
        return (new QFile(cached)).copy(String(target)) === true;
    } catch (e) {
        return false;
    }
};

// Makes sure this cave's scans/ folder exists, and points the stock
// image picker at it. Returns the folder, or null when there was
// nothing to do -- an unsaved drawing, or one outside every drive.
CsCave.pointAtScans = function(docPath) {
    if (typeof RSettings === "undefined" || typeof QDir === "undefined") {
        return null;
    }
    var folder = CsCave.folderOf(docPath);
    if (folder === null) { return null; }
    if (!CsCave.isUnderDrive(docPath, CsCave.driveRoots())) { return null; }

    // The folder as it EXISTS, whatever its casing -- real cave folders
    // in the wild carry "Scans" as often as "scans", and building the
    // path literally makes a second folder beside the first on any
    // case-sensitive filesystem.
    var scans = CsCave.findSubfolder(folder, CsCave.SCANS);
    if (scans === null) { scans = CsCave.scansDir(docPath); }
    if (scans === null) { return null; }
    try {
        if (!(new QDir(scans)).exists() && !(new QDir()).mkpath(scans)) {
            return null;
        }
        // The key QCAD's own image insert reads for its starting
        // directory (Draw/Image/Image.js:144) and writes back to (:229).
        RSettings.setValue("Image/Path", scans);
        return scans;
    } catch (e) {
        return null;
    }
};

/**
 * Keeps the version about to be overwritten.
 *
 * THE OTHER ENTRY POINT THE APPLICATION CALLS, from
 * scripts/File/Save/Save.js immediately before di.exportFile (fork
 * patch 0006). The moment matters and cannot be moved: once the export
 * has run, the previous version is gone, so an "after save" hook can
 * never take this backup. That is why the fork calls twice.
 *
 * CsBackup already fires before this suite's own destructive
 * operations, which covers a redraw that guts a drawing. It did NOT
 * cover an ordinary save, which is the other way a good drawing gets
 * overwritten by a bad one -- by hand, or by any tool that never
 * announced itself as destructive.
 *
 * \param path the file about to be written.
 * \return true when a backup now holds the previous version.
 */
// ---------------------------------------------------------------------
// The save journal -- dogfooding instrumentation, off unless asked for.
// ---------------------------------------------------------------------

// The flag file that turns the journal on, and the log it appends to:
// the SAME pair probe/CsSaveProbe uses, so probe/read.sh shows one
// story rather than two.
CsCave.JOURNAL_FLAG = "CsSaveProbe.enabled";
CsCave.JOURNAL_LOG = "CsSaveProbe.log";

/**
 * The edition directory -- the folder holding the per-user "scripts"
 * folder, e.g. ~/Library/Application Support/QCAD/CaveCAD.
 *
 * Derived from the add-on's own recorded path (CaveSurvey/AddOnPath,
 * written by CaveSurvey.init) rather than guessed: this runs in a
 * DOCUMENT's script engine, where includeBasePath is whatever last
 * included something and the add-on's own basePath was never in scope.
 *
 * \return the folder, or null when the setting is missing.
 */
CsCave.editionDir = function() {
    try {
        if (typeof RSettings === "undefined") {
            return null;
        }
        var addOn = String(RSettings.getStringValue("CaveSurvey/AddOnPath", ""));
        if (addOn === "") {
            return null;
        }
        // <edition>/scripts/CaveSurvey -> <edition>
        var dir = new QDir(addOn);
        dir.cdUp();
        dir.cdUp();
        return String(dir.absolutePath());
    } catch (e) {
        return null;
    }
};

/**
 * Appends one line to the save journal, if the journal is switched on.
 *
 * Silent and cheap when off -- one settings read and one file-exists
 * check, both of which a save already affords. Never throws: this is
 * instrumentation, and instrumentation that can break a save is worse
 * than no instrumentation.
 */
CsCave.journal = function(line) {
    try {
        var dir = CsCave.editionDir();
        if (dir === null) {
            return false;
        }
        if (!(new QFileInfo(dir + "/" + CsCave.JOURNAL_FLAG)).exists()) {
            return false;
        }
        var f = new QFile(dir + "/" + CsCave.JOURNAL_LOG);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Append | QIODevice.Text)) {
            return false;
        }
        var d = new Date();
        var p2 = function(n) { return (n < 10 ? "0" : "") + n; };
        var stamp = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" +
            p2(d.getDate()) + " " + p2(d.getHours()) + ":" +
            p2(d.getMinutes()) + ":" + p2(d.getSeconds());
        var out = new QTextStream(f);
        out.writeString(stamp + "  " + line + "\n");
        f.close();
        return true;
    } catch (e) {
        return false;
    }
};

/** The file's own name, for a journal line that stays readable. */
CsCave.shortName = function(path) {
    var p = String(path);
    var slash = p.lastIndexOf("/");
    return slash === -1 ? p : p.substring(slash + 1);
};

CsCave.beforeSave = function(path) {
    try {
        if (typeof CsBackup === "undefined" || typeof path !== "string" ||
                path === "") {
            return false;
        }
        var before = CsBackup.generations(path).length;
        var kept = CsBackup.beforeWrite(path);
        var after = CsBackup.generations(path).length;
        CsCave.journal("SAVE     " + CsCave.shortName(path) +
            "  backup=" + (kept ? (after > before ? "new generation" :
                "already current") : "none") +
            "  generations=" + after);
        return kept;
    } catch (e) {
        return false;   // never the reason a save does not happen
    }
};

/**
 * Everything this suite wants to happen after a drawing is saved.
 *
 * THE ONE ENTRY POINT THE APPLICATION CALLS. CaveCAD's own
 * scripts/File/Save/Save.js calls this after a successful export (fork
 * patch 0006), because an add-on cannot reach a save any other way --
 * see the "no save hook here" note below for the measurement that
 * proves it.
 *
 * Everything here is a convenience. Every one of them is wrapped, and a
 * failure in any of them is swallowed: a caver's save must never fail
 * because a folder could not be made or a thumbnail could not be drawn.
 *
 * \param savedPath the file that was just written.
 * \param di the document interface, for the preview. Optional.
 * \return a short list of what was done, for tests and for the probe.
 */
CsCave.afterSave = function(savedPath, di) {
    var did = [];
    if (typeof savedPath !== "string" || savedPath === "") {
        return did;
    }
    try {
        if (CsCave.pointAtScans(savedPath) !== null) {
            did.push("scans");
        }
    } catch (e1) {
    }
    try {
        // A cave saved under a drive root puts itself on the launcher's
        // shelf, so the list fills from ordinary work rather than from
        // the Add Cave button.
        if (typeof CsShelf !== "undefined" &&
                CsShelf.registerSaved(savedPath)) {
            did.push("shelf");
        }
    } catch (e2) {
    }
    try {
        var made = CsCave.ensureProjectFolders(CsCave.folderOf(savedPath));
        if (made !== null && made.length > 0) {
            did.push("folders:" + made.length);
        }
    } catch (e3) {
    }
    try {
        // The stock save hands di.getThumbnail() to
        // RSettings.addRecentFile; keeping the same picture in the
        // cave's own images/ folder is what the shelf reads.
        if (!isNull(di) && isFunction(di.updateThumbnail) &&
                isFunction(di.getThumbnail)) {
            di.updateThumbnail();
            if (CsCave.writePreview(savedPath, di.getThumbnail())) {
                did.push("preview");
            }
        }
    } catch (e4) {
    }
    CsCave.journal("AFTER    " + CsCave.shortName(savedPath) + "  did=" +
        (did.length === 0 ? "(nothing)" : did.join(",")));
    return did;
};

// Runs pointAtScans after every successful save -- OR IT WOULD, IF IT
// RAN AT ALL.
//
// MEASURED INERT, 2026-08-29. probe/CsSaveProbe wrapped this same
// prototype on top of this hook and watched a real GUI save of Truitt
// Cave: armed 08:15:43, drawing written 08:15:56, nothing fired. QCAD
// builds its actions in their own script context
// (RScriptHandlerJs::createActionDocumentLevel), so the prototype
// patched here is not the prototype the Save action uses -- exactly what
// CsBackup predicted and left unconfirmed. So NONE of the work below has
// ever happened on a save: the scans folder is not pointed at, the cave
// is not registered on the shelf, the project folders (including
// backup/) are not created, and no preview is written from here. The
// preview that does exist comes from CaveShelf.captureThumbnailSoon,
// which is on its own timer and unrelated.
//
// Left installed rather than deleted, because deleting it would also
// delete the record of what should happen on save -- and that list is
// the specification for the fork patch that will do it properly. Do not
// add anything new here expecting it to run.
//
// Wrapping the prototype rather than asking each caller to opt in: a
// hook you have to remember to call is a hook that is off on the
// machine that needed it. Idempotent by marker, because init() can run
// more than once and a wrapper that wraps itself does its work twice.
/**
 * THERE IS DELIBERATELY NO SAVE HOOK HERE. Do not add one back.
 *
 * Wrapping Save.prototype.save from add-on init installs cleanly,
 * reports success, and never runs: QCAD builds actions in their own
 * script context (RScriptHandlerJs::createActionDocumentLevel), so the
 * patched prototype is not the one the action uses.
 *
 * MEASURED, not inferred (2026-08-29, probe/CsSaveProbe, against a real
 * GUI save of Truitt Cave): probe armed 08:15:43, drawing written
 * 08:15:56, probe log never grew. Save.prototype.save,
 * SaveAs.prototype.save and even the JS binding
 * RDocumentInterface.prototype.exportFile were all untraversed. The
 * wrapper that used to live here (CsCave.installSaveHook, removed
 * 2026-08-31) therefore never ran once in its whole life, while
 * reporting true to its caller -- which is why it survived so long.
 *
 * The working mechanism is CsCave.afterSave above, called directly by
 * the fork's own scripts/File/Save/Save.js (patch 0006).
 * TestAddonDoesNotPatchStockPrototypes in tests/test_addon.py keeps the
 * inert shape from coming back.
 */
