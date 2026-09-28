// FeedbackPackage.js -- stages one report's files and zips them. Never
// writes to the user's drawing or cave folder; copies only.
// Requires FeedbackCore.js, FeedbackCommands.js, CcUpdateCommands.js, CcUpdateRun.js.

var FeedbackPackage = {};

FeedbackPackage.dataDir = function() { return String(RSettings.getDataLocation()).replace(/[\\\/]+$/, ""); };
FeedbackPackage.logDir = function() {
    var o = String(QProcessEnvironment.systemEnvironment().value("CAVECAD_LOG_DIR", ""));
    return o !== "" ? o : FeedbackPackage.dataDir() + "/logs";
};
FeedbackPackage.stagingBase = function() { return FeedbackPackage.dataDir() + "/feedback/staging"; };

/** The two newest session logs, newest first (names sort by time). */
FeedbackPackage.latestLogs = function(dir) {
    var names = new QDir(dir).entryList(["session-*.log"], QDir.Files, QDir.Name);
    var out = [];
    for (var i = names.length - 1; i >= 0 && out.length < 2; i--) { out.push(dir + "/" + names[i]); }
    return out;
};

/** Files behind the document's image entities: absolute, existing, unique. */
FeedbackPackage.usedScans = function(doc, docDir) {
    var ids = doc.queryAllEntities(false, true), seen = {}, out = [];
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getType() !== RS.EntityImage) { continue; }
        var f = String(e.getProperty(RImageEntity.PropertyFileName)[0]);
        if (f === "") { continue; }
        if (new QFileInfo(f).isRelative()) { f = docDir + "/" + f; }
        var abs = String(new QFileInfo(f).absoluteFilePath());
        if (!seen[abs] && new QFileInfo(abs).isFile()) { seen[abs] = true; out.push(abs); }
    }
    return out;
};

/** Relative paths of every file under dir, skipping dot-folders and dotfiles. */
FeedbackPackage.listFiles = function(dir) {
    var out = [];
    (function walk(rel) {
        var d = new QDir(dir + (rel === "" ? "" : "/" + rel));
        var files = d.entryList([], QDir.Files | QDir.NoDotAndDotDot, QDir.Name);
        for (var i = 0; i < files.length; i++) {
            if (String(files[i]).charAt(0) !== ".") { out.push((rel === "" ? "" : rel + "/") + files[i]); }
        }
        var dirs = d.entryList([], QDir.Dirs | QDir.NoDotAndDotDot, QDir.Name);
        for (var j = 0; j < dirs.length; j++) {
            if (String(dirs[j]).charAt(0) !== ".") { walk((rel === "" ? "" : rel + "/") + dirs[j]); }
        }
    })("");
    return out;
};

/** A DXF copy of the in-memory drawing; the document keeps its name and modified flag. */
FeedbackPackage.copyDrawing = function(di, path) {
    var doc = di.getDocument();
    var modified = doc.isModified();
    var ok = di.exportFile(path, "", false);
    doc.setModified(modified);
    return ok === true;
};

FeedbackPackage.copyInto = function(src, dest) {
    (new QDir()).mkpath(String(dest).replace(/\/[^\/]*$/, ""));
    QFile.remove(dest);
    return QFile.copy(src, dest);
};

/**
 * opts: {base, id, fields, meta, logs[], screenshot|null, drawing|null,
 * caveDir|null, surveyFiles[] (relative to caveDir), scans[] (absolute),
 * scanMode "none"|"used"|"chosen"}. Returns {dir, bytes, scanBytes}.
 */
FeedbackPackage.stage = function(o) {
    var dir = o.base + "/" + o.id;
    (new QDir(dir)).removeRecursively();
    (new QDir()).mkpath(dir);
    var att = [], bytes = 0, scanBytes = 0;
    function add(src, rel, isScan) {
        if (!FeedbackPackage.copyInto(src, dir + "/" + rel)) { return; }
        var n = new QFileInfo(dir + "/" + rel).size();
        att.push({ path: rel, bytes: n });
        bytes += n;
        if (isScan) { scanBytes += n; }
    }
    for (var i = 0; i < o.logs.length; i++) { add(o.logs[i], "logs/" + String(o.logs[i]).replace(/^.*[\/\\]/, ""), false); }
    if (o.screenshot) { add(o.screenshot, "screenshot.png", false); }
    if (o.drawing) { add(o.drawing, "drawing.dxf", false); }
    var cave = String(o.caveDir || "").replace(/[\\\/]+$/, "");
    for (var s = 0; s < o.surveyFiles.length; s++) { add(cave + "/" + o.surveyFiles[s], "cave/" + o.surveyFiles[s], false); }
    for (var k = 0; k < o.scans.length; k++) {
        var abs = String(o.scans[k]);
        var rel = cave !== "" && abs.indexOf(cave + "/") === 0 ? abs.substring(cave.length + 1) : "scans/" + abs.replace(/^.*[\/\\]/, "");
        add(abs, "cave/" + rel, true);
    }
    var m = o.meta, f = o.fields;
    var report = FeedbackCore.report({
        id: o.id, type: f.type, summary: f.summary, description: f.description, email: f.email,
        version: m.version, commit: m.commit, caveSurvey: m.caveSurvey, os: m.os,
        activeTool: m.activeTool, documents: m.documents, attachments: att,
        consent: { drawing: !!o.drawing, surveyFiles: o.surveyFiles.length > 0, scans: o.scanMode },
        created: m.created
    });
    var rf = new QFile(dir + "/report.json");
    if (rf.open(QIODevice.WriteOnly)) { rf.write(JSON.stringify(report, null, 2)); rf.close(); }
    return { dir: dir, bytes: bytes, scanBytes: scanBytes };
};

FeedbackPackage.zip = function(dir, out, done) {
    QFile.remove(out);
    UpdateRun.run(FeedbackCommands.zip(RS.getSystemId(), dir, out), 300, done);
};
