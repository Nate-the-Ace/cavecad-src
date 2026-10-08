// CsSaveProbe.js -- answers one question, on evidence: when the user
// saves in the GUI, does a Save.prototype wrapper installed from add-on
// init actually run?
//
// WHY THIS EXISTS. Core/CsBackup.js records a measurement: wrapping
// Save.prototype.save from add-on init "installs cleanly, reports
// success, and never runs", because QCAD builds its actions in a
// separate script context (RScriptHandlerJs::createActionDocumentLevel),
// so the prototype patched at init is not the prototype the action uses.
// It then says CsCave.installSaveHook "uses the same mechanism and is
// very likely just as inert" -- a suspicion, never confirmed. Everything
// that wants to run on save (the .cavecad companion, first of all)
// depends on which it is.
//
// Two attempts to settle it from disk failed and are worth recording so
// nobody repeats them:
//   - The thumbnail cache is NOT evidence. It looked like it: CsCave's
//     hook calls updateThumbnail() before the save, and its comment says
//     nothing else in the application does. But RDocumentInterface.cpp
//     :1435 calls updateThumbnail() itself at the end of exportFile, so
//     the cache fills either way.
//   - RSettings "Image/Path" is NOT evidence. CsCave.pointAtScans sets
//     it after a save, but QCAD's own Draw > Image writes the same key
//     when the user inserts a picture (Image.js:229), and a cave's
//     scans/ folder normally contains pictures.
//
// AND IT CANNOT BE ANSWERED HEADLESSLY. Instantiating Save from a script
// builds the action in THIS context, where the wrapper is installed and
// will fire -- proving nothing about the GUI path this is asking about.
// A human has to press Save once.
//
// DEV ONLY. Like CsMcpBridge, this refuses to start without its flag
// file, and must never ship in a release.
//
// USAGE
//   ./probe/install.sh          install + enable, then restart CaveCAD
//   ...open a drawing, press Cmd-S once...
//   ./probe/read.sh             what happened
//   ./probe/install.sh --remove

CsSaveProbe = {};

CsSaveProbe.VERSION = "0.1.0";
CsSaveProbe.FLAG = "CsSaveProbe.enabled";
CsSaveProbe.LOG = "CsSaveProbe.log";

CsSaveProbe.stateDir = null;

/** Timestamp for the log. JS Date, not QDate -- see CsBackup.stampText. */
CsSaveProbe.stamp = function() {
    var d = new Date();
    var p2 = function(n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" +
        p2(d.getDate()) + " " + p2(d.getHours()) + ":" +
        p2(d.getMinutes()) + ":" + p2(d.getSeconds());
};

/** Appends one line. Never throws: a probe that breaks a save is worse
 *  than no probe. */
CsSaveProbe.say = function(line) {
    try {
        if (CsSaveProbe.stateDir === null) {
            return;
        }
        var f = new QFile(CsSaveProbe.stateDir + "/" + CsSaveProbe.LOG);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Append |
                QIODevice.Text)) {
            return;
        }
        var out = new QTextStream(f);
        out.writeString(CsSaveProbe.stamp() + "  " + line + "\n");
        f.close();
    } catch (e) {
    }
};

/**
 * Wraps one prototype method and logs when it fires.
 *
 * The identity check is the real payload. At fire time the wrapper asks
 * whether the function currently on the prototype IS this wrapper. If a
 * save runs and this never fires, the action used a different prototype;
 * if it fires and the identity holds, add-on-installed wrappers reach
 * the GUI save path and CsBackup's suspicion is wrong.
 */
CsSaveProbe.wrap = function(holder, name, label) {
    try {
        if (typeof holder === "undefined" || holder === null ||
                !holder.prototype ||
                typeof holder.prototype[name] !== "function") {
            CsSaveProbe.say("INSTALL  " + label + ": not available to wrap");
            return false;
        }
        if (holder.prototype[name].csSaveProbe === true) {
            // Reached for SaveAs, whose prototype INHERITS save from
            // Save.prototype -- so wrapping Save already covered it.
            // Logged rather than returned silently: an unexplained gap
            // in this log is exactly the kind of thing that gets read
            // as "the wrap failed".
            CsSaveProbe.say("INSTALL  " + label +
                ": already wrapped (same function as one above)");
            return true;
        }
        var stock = holder.prototype[name];
        var wrapped = function() {
            CsSaveProbe.say("FIRED    " + label +
                "  identity=" + (holder.prototype[name] === wrapped ?
                    "same-prototype" : "DIFFERENT-prototype") +
                "  csCaveWrapped=" +
                (typeof Save !== "undefined" && Save.prototype &&
                 Save.prototype.save ?
                    (Save.prototype.save.csCaveWrapped === true) : "n/a") +
                "  args=" + arguments.length);
            return stock.apply(this, arguments);
        };
        wrapped.csSaveProbe = true;
        // Carry any marker the suite's own hook left, so wrapping order
        // cannot make CsCave's hook look absent.
        if (stock.csCaveWrapped === true) {
            wrapped.csCaveWrapped = true;
        }
        holder.prototype[name] = wrapped;
        CsSaveProbe.say("INSTALL  " + label + ": wrapped");
        return true;
    } catch (e) {
        CsSaveProbe.say("INSTALL  " + label + ": threw " + e);
        return false;
    }
};

/** Called by QCAD's add-on loader at startup. */
CsSaveProbe.init = function(basePath) {
    try {
        // <edition dir>/scripts/CsSaveProbe -> <edition dir>
        var dir = new QDir(basePath);
        dir.cdUp();
        dir.cdUp();
        CsSaveProbe.stateDir = dir.absolutePath();
    } catch (e) {
        return;
    }
    if (!(new QFileInfo(CsSaveProbe.stateDir + "/" +
            CsSaveProbe.FLAG)).exists()) {
        CsSaveProbe.stateDir = null;   // not enabled: stay silent and inert
        return;
    }

    CsSaveProbe.say("---- probe " + CsSaveProbe.VERSION + " starting ----");

    // The suite's own hook may or may not have installed by now; record
    // what is on the prototype before this probe touches it.
    try {
        if (typeof Save === "undefined") {
            include("scripts/File/Save/Save.js");
        }
        CsSaveProbe.say("BEFORE   Save.prototype.save exists=" +
            (typeof Save !== "undefined" && Save.prototype &&
             typeof Save.prototype.save === "function") +
            "  csCaveWrapped=" +
            (typeof Save !== "undefined" && Save.prototype &&
             Save.prototype.save ?
                (Save.prototype.save.csCaveWrapped === true) : "n/a"));
    } catch (eS) {
        CsSaveProbe.say("BEFORE   could not inspect Save: " + eS);
    }

    CsSaveProbe.wrap(typeof Save === "undefined" ? null : Save,
        "save", "Save.prototype.save");

    try {
        if (typeof SaveAs === "undefined") {
            include("scripts/File/SaveAs/SaveAs.js");
        }
    } catch (eSA) {
    }
    CsSaveProbe.wrap(typeof SaveAs === "undefined" ? null : SaveAs,
        "save", "SaveAs.prototype.save");

    // The C++ end of the same question. RDocumentInterface.exportFile is
    // what a save ultimately calls; wrapping its ECMA prototype tells us
    // whether the JS-visible binding is on the path at all, which
    // distinguishes "the wrapper is on the wrong prototype" from "the
    // save never goes through JS here".
    try {
        if (typeof RDocumentInterface !== "undefined" &&
                RDocumentInterface.prototype &&
                typeof RDocumentInterface.prototype.exportFile === "function" &&
                RDocumentInterface.prototype.exportFile.csSaveProbe !== true) {
            var stockExport = RDocumentInterface.prototype.exportFile;
            var wrappedExport = function() {
                CsSaveProbe.say("FIRED    RDocumentInterface.exportFile" +
                    "  args=" + arguments.length +
                    "  path=" + (arguments.length > 0 ? arguments[0] : "?"));
                return stockExport.apply(this, arguments);
            };
            wrappedExport.csSaveProbe = true;
            RDocumentInterface.prototype.exportFile = wrappedExport;
            CsSaveProbe.say("INSTALL  RDocumentInterface.exportFile: wrapped");
        }
    } catch (eE) {
        CsSaveProbe.say("INSTALL  RDocumentInterface.exportFile: threw " + eE);
    }

    CsSaveProbe.say("READY    open a drawing and press Save once, " +
        "then run probe/read.sh");
};
