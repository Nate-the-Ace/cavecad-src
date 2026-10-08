// CsBackup.js -- keep previous versions of a drawing, so a bad save can
// be rolled back.
//
// Part of the Cave Survey Core library. Before a file is overwritten, a
// datestamped copy of it goes into the cave project's own backup/
// folder:
//
//   Pitfall Cave/backup/Pitfall Cave.dxf.2026-08-29_041200.bak
//
// Several generations deep (CsBackup.KEEP_DEFAULT, overridable per
// machine), oldest pruned first. The stamp sorts, so "which one was
// before lunch" is answerable by reading the folder, and QFile.copy
// preserves the source's modification time, so each backup's own mtime
// says when THAT version was written.
//
// A save that changes nothing costs no generation. This build's DXF
// writer is deterministic -- saving an unedited drawing produces
// byte-identical output (measured on Truitt Cave, 2026-08-29: two saves
// seconds apart wrote the same bytes) -- and mtime changes every time
// regardless, so the (path, size, mtime) fingerprint below cannot see
// it. The file is compared against the newest generation first: size
// settles it for free almost always, and the bytes are read only when
// two files are the same length.
//
// WHY THIS EXISTS. A Survey Notebook redraw is erase-then-draw across
// two separate operations. If the draw fails after the erase has landed,
// the drawing is left gutted -- and a save then writes that over the
// only copy. That happened: a real drawing went from 312 entities to
// 170, losing its whole survey, and there was nothing to go back to.
//
// The specific draw failure is a bug to fix on its own. This is the
// guard for the general case: any tool, any failure, any future bug of
// the same shape. A tool that can destroy a drawing must not also be the
// only thing standing between the user and losing it.
//
// WHAT CHANGED, 2026-08-29 (Nathan). It used to keep ONE generation, as
// "<name>.dxf.bak" beside the drawing, and to skip Google Drive
// entirely on the grounds that Drive keeps its own history and a .bak
// beside a synced drawing is clutter. Both halves are gone:
//
//   - Several generations in a folder, because "roll back" and "the one
//     immediately before" are not the same request. A second bad save
//     used to consume the only good copy.
//   - No Drive exemption. The clutter argument was about a file sitting
//     beside the drawing, and there is now a folder for it. What Drive's
//     own history offers instead is a manual rollback through a web UI,
//     bounded to 100 revisions or 30 days, covering only what actually
//     synced -- a backstop, not the guard.
//
// The cost of dropping the exemption is real and accepted: a synced cave
// now uploads one drawing-sized file per backup. KEEP bounds the total,
// not the traffic.
//
// WHAT THIS IS NOT. Not crash recovery: QCAD's own AutoSave covers that,
// and differently -- it snapshots the CURRENT state periodically, which
// would have captured the gutted drawing just as happily. This keeps
// PREVIOUS states, which is the thing that was missing.

var CsBackup = {};

/** Set once a "could not write the backup" warning has been shown, so a
 *  broken guard says so without nagging on every save. */
CsBackup.warnedThisSession = false;

/** The (path, size, modified) already backed up, so the same bytes are
 *  not copied twice. A single Notebook Draw runs BOTH destructive
 *  operations -- eraseStations and CsProfileDraw.erase -- so without
 *  this it copies the whole drawing twice per draw for no gain: the file
 *  on disk cannot have changed in between, because only a save changes
 *  it. On a multi-megabyte cave redrawn repeatedly that is real churn. */
CsBackup.lastBackedUp = null;

/** Appended to the drawing's own name, so the backup sits beside it and
 *  sorts next to it. Not a hidden file: a backup nobody can see is a
 *  backup nobody remembers to use. */
CsBackup.SUFFIX = ".bak";

/**
 * How many previous generations of one file to keep. Overridable per
 * machine through the setting.
 *
 * Five (Nathan, 2026-08-29). A cave drawing is most of a megabyte and
 * lives on a synced drive, so every generation is upload traffic as
 * well as disk; five covers "undo the last few sessions", which is what
 * rolling back is actually for, and duplicates no longer consume a slot
 * (see copyPrevious), so five real versions is what it means.
 */
CsBackup.KEEP_SETTING = "CaveSurvey/BackupKeep";
CsBackup.KEEP_DEFAULT = 5;

/**
 * A sortable stamp, "YYYY-MM-DD_HHMMSS".
 *
 * From the script engine's own Date, NOT QDate: this bridge does not
 * define QDate at all (ReferenceError), and
 * QDateTime.currentDateTime().toString(format) ignores the format and
 * answers Qt's default text -- the same trap CsPackage.todayText
 * documents. Sortable to the second because pruning orders by this
 * string and nothing else; a save-per-second is the realistic ceiling
 * for a human at a keyboard.
 */
CsBackup.stampText = function(now) {
    var when = (now === undefined || now === null) ? new Date() : now;
    var p2 = function(n) { return (n < 10 ? "0" : "") + n; };
    return when.getFullYear() + "-" + p2(when.getMonth() + 1) + "-" +
        p2(when.getDate()) + "_" + p2(when.getHours()) +
        p2(when.getMinutes()) + p2(when.getSeconds());
};

/** The backup folder for a file: its own folder's backup/ subfolder. */
CsBackup.backupFolderFor = function(path) {
    if (isNull(path) || String(path).length === 0) {
        return null;
    }
    var p = String(path);
    var slash = p.lastIndexOf("/");
    if (slash <= 0) {
        return null;
    }
    var sub = (typeof CsCave !== "undefined" && CsCave.BACKUP) ?
        CsCave.BACKUP : "backup";
    return p.substring(0, slash) + "/" + sub;
};

/** The file name of one generation: "<original>.<stamp>.bak". */
CsBackup.backupNameFor = function(path, stamp) {
    var p = String(path);
    var slash = p.lastIndexOf("/");
    var base = slash === -1 ? p : p.substring(slash + 1);
    return base + "." + stamp + CsBackup.SUFFIX;
};

/**
 * True when `name` is a stamped backup OF `baseName`.
 *
 * Exact, not a prefix test. One cave folder holds "Cave.dxf" and
 * "Cave.cavecad", and a prefix test would let the shorter name claim
 * the longer one's history and prune it.
 */
CsBackup.isBackupOf = function(name, baseName) {
    if (isNull(name) || isNull(baseName)) {
        return false;
    }
    var n = String(name);
    var b = String(baseName);
    if (n.length <= b.length || n.substring(0, b.length + 1) !== b + ".") {
        return false;
    }
    var rest = n.substring(b.length + 1);
    return /^\d{4}-\d{2}-\d{2}_\d{6}\.bak$/.test(rest);
};

/**
 * Which of `names` to delete so that only the newest `keep` generations
 * of `baseName` remain. Oldest first.
 *
 * Ordered by the STAMP in the name, never by the order the filesystem
 * happened to list them in -- which is why the stamp is sortable.
 */
CsBackup.prunable = function(names, baseName, keep) {
    var out = [];
    if (Object.prototype.toString.call(names) !== "[object Array]") {
        return out;
    }
    var mine = [];
    for (var i = 0; i < names.length; i++) {
        if (CsBackup.isBackupOf(names[i], baseName)) {
            mine.push(String(names[i]));
        }
    }
    mine.sort();   // the stamp is the only varying part, and sorts by time
    var n = (typeof keep === "number" && keep >= 0) ? keep : CsBackup.KEEP_DEFAULT;
    var excess = mine.length - n;
    for (var e = 0; e < excess; e++) {
        out.push(mine[e]);
    }
    return out;
};

/**
 * Google Drive roots on this machine, canonical, only those that exist.
 *
 * Both spellings: the modern per-account mount under CloudStorage, and
 * the older ~/Google Drive, which is often a symlink to it -- hence
 * canonical paths, so the two do not read as different places.
 *
 * Discovered rather than hardcoded to one account: a machine can have
 * several, and a hardcoded address would silently stop matching the day
 * the account changes.
 */
CsBackup.driveRoots = function() {
    var out = [];
    var add = function(path) {
        try {
            var info = new QFileInfo(path);
            if (!info.exists() || !info.isDir()) {
                return;
            }
            var canon = info.canonicalFilePath();
            if (isNull(canon) || String(canon).length === 0) {
                canon = info.absoluteFilePath();
            }
            for (var i = 0; i < out.length; i++) {
                if (out[i] === String(canon)) {
                    return;
                }
            }
            out.push(String(canon));
        } catch (e) {
            // an unreadable candidate is simply not a root
        }
    };

    var home = QDir.homePath();
    try {
        var cloud = new QDir(home + "/Library/CloudStorage");
        if (cloud.exists()) {
            var names = cloud.entryList(makeQDirFilters(QDir.NoDotAndDotDot,
                QDir.Dirs), makeQDirSortFlags(QDir.NoSort));
            for (var i = 0; i < names.length; i++) {
                if (String(names[i]).indexOf("GoogleDrive") === 0) {
                    add(home + "/Library/CloudStorage/" + names[i]);
                }
            }
        }
    } catch (eCloud) {
        // no CloudStorage on this machine
    }
    add(home + "/Google Drive");
    return out;
};

/**
 * True when `path` sits inside a Google Drive folder.
 *
 * Drive keeps its own version history for files it syncs, so a local
 * .bak beside a synced drawing is redundant clutter -- the user's call,
 * and a fair one.
 *
 * What it costs, stated once: Drive's history is a manual rollback
 * through the web UI, bounded (100 revisions or 30 days by default), and
 * it only holds what actually synced. A local .bak is none of those
 * things. So this returning true is a decision to trust Drive, not proof
 * the file is recoverable.
 *
 * Compared on CANONICAL paths, so a symlinked route into Drive counts.
 * Anything unreadable answers false, which errs toward writing a
 * backup -- the safe direction when the question is whether data is
 * protected.
 */
CsBackup.inGoogleDrive = function(path) {
    if (isNull(path) || String(path).length === 0) {
        return false;
    }
    var canon;
    try {
        var info = new QFileInfo(String(path));
        canon = info.canonicalFilePath();
        if (isNull(canon) || String(canon).length === 0) {
            canon = info.absoluteFilePath();
        }
        canon = String(canon);
    } catch (e) {
        return false;
    }
    var roots = CsBackup.driveRoots();
    for (var i = 0; i < roots.length; i++) {
        if (canon === roots[i] || canon.indexOf(roots[i] + "/") === 0) {
            return true;
        }
    }
    return false;
};

/** True when `path` names a file that exists and holds something. An
 *  empty file is not worth preserving and would overwrite a good backup
 *  with nothing -- the one way this feature could itself lose data. */
CsBackup.worthKeeping = function(path) {
    if (isNull(path) || String(path).length === 0) {
        return false;
    }
    try {
        var info = new QFileInfo(path);
        return info.exists() && info.size() > 0;
    } catch (e) {
        return false;
    }
};

/**
 * A file's bytes as a LATIN1 string -- one byte per character -- or null
 * when it cannot be read. QCAD only.
 *
 * The one faithful, fast binary path this script bridge has, and the
 * same one CsContour reads elevation TIFFs through: QTextStream with
 * QStringConverter.Latin1 maps all 256 byte values 1:1 onto code points
 * and reads about 200 KB in 2 ms. QFile.readAll() is NOT usable here --
 * it hands this engine a QByteArray whose size() is 0 (the trap
 * tests/package_cave.js documents), and a byte search written that way
 * silently answers "found" for everything.
 */
CsBackup.readBytes = function(path) {
    try {
        var f = new QFile(String(path));
        if (!f.open(QIODevice.ReadOnly)) {
            return null;
        }
        var stream = new QTextStream(f);
        stream.setEncoding(QStringConverter.Latin1);
        var text = String(stream.readAll());
        f.close();
        return text;
    } catch (e) {
        return null;
    }
};

/**
 * How large a file this will read to compare. Beyond it, copying is
 * cheaper than being sure, and a wasted generation costs less than
 * holding two copies of a very large drawing in the engine at once.
 */
CsBackup.MAX_COMPARE_BYTES = 20 * 1024 * 1024;

/**
 * Whether two files hold the same bytes.
 *
 * \return true, false, or NULL when it could not be determined (a file
 * that will not open, or one too large to compare). Null is not false:
 * the caller must copy when it cannot tell, because the whole point is
 * never to skip a backup that was actually needed.
 *
 * Size is checked first and settles almost every call for free. The
 * read only happens when two files are the same length, which is the
 * one case a size check gets wrong.
 */
CsBackup.sameContents = function(a, b) {
    try {
        var ia = new QFileInfo(String(a));
        var ib = new QFileInfo(String(b));
        if (!ia.exists() || !ib.exists()) {
            return null;
        }
        var sa = ia.size();
        if (sa !== ib.size()) {
            return false;
        }
        if (sa > CsBackup.MAX_COMPARE_BYTES) {
            return null;
        }
        var ba = CsBackup.readBytes(a);
        var bb = CsBackup.readBytes(b);
        if (ba === null || bb === null) {
            return null;
        }
        return ba === bb;
    } catch (e) {
        return null;
    }
};

/** The backup file names present for `path`, newest last. QCAD only. */
CsBackup.generations = function(path) {
    var out = [];
    try {
        var folder = CsBackup.backupFolderFor(path);
        if (folder === null) { return out; }
        var dir = new QDir(folder);
        if (!dir.exists()) { return out; }
        var p = String(path);
        var slash = p.lastIndexOf("/");
        var base = slash === -1 ? p : p.substring(slash + 1);
        var names = dir.entryList(QDir.Files);
        for (var i = 0; i < names.length; i++) {
            if (CsBackup.isBackupOf(String(names[i]), base)) {
                out.push(String(names[i]));
            }
        }
        out.sort();
    } catch (e) {
        return out;
    }
    return out;
};

/** True when at least one backup of `path` is actually present. Checked
 *  alongside the fingerprint so a deleted backup is remade rather than
 *  skipped because we remember making it once. */
CsBackup.hasBackup = function(path) {
    return CsBackup.generations(path).length > 0;
};

/**
 * Keeps a datestamped copy of `path` in the cave's backup/ folder, and
 * prunes older generations past the keep count.
 *
 * Returns true only when a backup now exists holding the old bytes.
 * Every failure is a false, never a throw: this runs on the way into a
 * save, and a backup that cannot be written must not be the reason a
 * caver cannot save their work.
 *
 * Two saves inside one second collapse onto one stamp; the later one
 * replaces the earlier. A human at a keyboard does not produce two
 * meaningfully different saves a second apart, and a finer stamp would
 * buy that case at the cost of a name nobody can read.
 */
CsBackup.copyPrevious = function(path, now) {
    if (!CsBackup.worthKeeping(path)) {
        return false;   // nothing to preserve: a first save, or no file
    }
    var folder = CsBackup.backupFolderFor(path);
    if (folder === null) {
        return false;
    }
    try {
        if (!(new QDir(folder)).exists() && !(new QDir()).mkpath(folder)) {
            return false;
        }

        // Already have these exact bytes? Then the previous version IS
        // kept, and copying again would spend a generation on a
        // duplicate. This build's DXF writer is deterministic, so saving
        // an unedited drawing writes byte-identical output with a new
        // mtime -- which the (path, size, mtime) fingerprint in
        // beforeWrite cannot see through. Without this, twenty idle
        // saves would fill every generation with one version and push
        // out the ones worth going back to.
        //
        // Only the NEWEST generation is compared: backups are taken in
        // order, so an older duplicate means the content came back,
        // which is a real version worth keeping.
        var existing = CsBackup.generations(path);
        if (existing.length > 0) {
            var newest = folder + "/" + existing[existing.length - 1];
            if (CsBackup.sameContents(path, newest) === true) {
                return true;   // a backup holds these bytes: contract met
            }
        }

        var name = CsBackup.backupNameFor(path, CsBackup.stampText(now));
        var bak = folder + "/" + name;

        // QFile.copy refuses an existing target. Only reachable when two
        // saves share a second (see above).
        var existing = new QFile(bak);
        if (existing.exists() && !existing.remove()) {
            return false;
        }
        if (!new QFile(String(path)).copy(bak)) {
            return false;
        }
        CsBackup.prune(path);
        return true;
    } catch (e) {
        return false;
    }
};

/**
 * Deletes the oldest generations past the keep count. QCAD only.
 *
 * Never lets a pruning failure look like a backup failure: the copy has
 * already succeeded by the time this runs, and a folder that will not
 * give up an old file is not a reason to report the new one missing.
 */
CsBackup.prune = function(path) {
    try {
        var keep = CsBackup.KEEP_DEFAULT;
        if (typeof RSettings !== "undefined") {
            keep = RSettings.getIntValue(CsBackup.KEEP_SETTING,
                CsBackup.KEEP_DEFAULT);
        }
        var folder = CsBackup.backupFolderFor(path);
        if (folder === null) { return 0; }
        var p = String(path);
        var slash = p.lastIndexOf("/");
        var base = slash === -1 ? p : p.substring(slash + 1);
        var doomed = CsBackup.prunable(CsBackup.generations(path), base, keep);
        var removed = 0;
        for (var i = 0; i < doomed.length; i++) {
            if (new QFile(folder + "/" + doomed[i]).remove()) {
                removed++;
            }
        }
        return removed;
    } catch (e) {
        return 0;
    }
};

/**
 * WHY THERE IS NO "ON SAVE" HOOK, and there cannot be one from here.
 * Both candidates were tried and measured:
 *
 *   - Wrapping Save.prototype.save installs cleanly, reports success,
 *     and never runs. QCAD builds an action in its own script context
 *     (RScriptHandlerJs::createActionDocumentLevel), so the prototype
 *     patched from add-on init is not the prototype the action uses.
 *     CONFIRMED 2026-08-29 with probe/CsSaveProbe against a real GUI
 *     save of Truitt Cave: probe armed 08:15:43, drawing written
 *     08:15:56, and the probe log did not grow. Neither
 *     Save.prototype.save nor SaveAs.prototype.save nor even the JS
 *     binding RDocumentInterface.prototype.exportFile was traversed.
 *     CsCave.installSaveHook used the same mechanism and was inert
 *     for the same reason; it was removed 2026-08-31. Anything that
 *     must happen on save belongs in a fork patch to
 *     scripts/File/Save/Save.js -- which is where the work it wanted
 *     to do (pointAtScans, CsShelf.registerSaved, ensureProjectFolders,
 *     writePreview) now runs, as CsCave.afterSave, via patch 0006.
 *   - RExportListenerAdapter's preExport/postExport/endOfExport fire
 *     ZERO times for RDocumentInterface::exportFile, which is what a
 *     save actually calls. Those signals belong to the graphics-export
 *     framework, not the DXF writer. Counted: 0, 0, 0.
 *
 * So the backup is taken at the moment that actually matters instead --
 * immediately before this suite's own destructive operations, from
 * CsDraw.eraseStations and CsProfileDraw.erase. That is a better moment
 * than a save anyway: it snapshots the last saved good file BEFORE the
 * tool that might gut the drawing runs, which is exactly the sequence
 * that destroyed a real survey.
 *
 * What it does not cover: a drawing damaged by hand and saved. QCAD's
 * own AutoSave is the separate net for that, and it keeps the CURRENT
 * state rather than the previous one.
 */

/**
 * Keep the previous version of `path`, and say so if it was due and
 * failed. The one entry point both hooks call.
 */
CsBackup.beforeWrite = function(path) {
    if (!CsBackup.worthKeeping(path)) {
        return false;
    }

    // Already have this exact file? Then the backup on disk is the same
    // bytes and copying again buys nothing. Keyed on size AND modified
    // time, because only a save changes the file -- and a save changes
    // both.
    var stamp = null;
    try {
        var info = new QFileInfo(String(path));
        stamp = String(path) + "|" + info.size() + "|" +
            String(info.lastModified().toString());
    } catch (eStamp) {
        stamp = null;   // cannot fingerprint it: copy, do not guess
    }
    if (stamp !== null && CsBackup.lastBackedUp === stamp &&
            CsBackup.hasBackup(path)) {
        return true;
    }

    var made = CsBackup.copyPrevious(path);
    if (made && stamp !== null) {
        CsBackup.lastBackedUp = stamp;
    }
    if (!made && !CsBackup.warnedThisSession) {
        CsBackup.warnedThisSession = true;
        CsTell.warn("Cave Survey: could not keep a backup of " + path +
            " in " + CsBackup.backupFolderFor(path) + ". Saving anyway " +
            "-- but there is no previous version to fall back on, so " +
            "check the folder is writable.");
    }
    return made;
};
