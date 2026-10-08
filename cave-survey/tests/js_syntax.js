// tests/js_syntax.js
//
// Syntax-checks every script in the CaveSurvey add-on using QCAD's own
// ECMAScript engine -- the same engine that will run them, so this catches
// anything that engine won't accept, not just anything a different parser
// wouldn't.
//
// Only the differential test actually exercises ImportNativeCaveSurvey's
// parsers; the rest are interactive or GUI-bound and can't be run headless at
// all. A syntax error in one of those otherwise shows up as a tool silently
// missing from the menu, which is a miserable thing to debug.
//
// Each file is wrapped in a function expression and eval'd. That parses the
// whole source without executing any of it, so no dialog opens and nothing
// touches RMainWindowQt.
//
// The tool list is read off disk rather than hardcoded, so a newly added tool
// is checked without anyone remembering to list it here -- and so this can be
// pointed at a staged package, where AlignImage (a separate project, copied in
// at build time) sits alongside the rest and gets checked too.
//
//   /Applications/CaveCAD.app/Contents/MacOS/CaveCAD \
//       -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/js_syntax.js <repo-root-or-addon-dir>

// Some builds' -autostart engines don't preload library.js, where
// makeQDirFilters lives; QDir filter enums OR together numerically.
if (typeof makeQDirFilters === "undefined") {
    makeQDirFilters = function() {
        var v = 0;
        for (var i = 0; i < arguments.length; i++) {
            v |= Number(arguments[i]);
        }
        return v;
    };
}

function readWhole(path) {
    var f = new QFile(path);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var text = new QTextStream(f).readAll();
    f.close();
    return text;
}

// Accepts either a repo root (which holds scripts/CaveSurvey/) or the add-on
// folder itself, so the same test serves the repo and a staged package.
function findAddon() {
    var args = RSettings.getOriginalArguments();
    for (var i = args.length - 1; i >= 0; i--) {
        var dir = ("" + args[i]).replace(/\/+$/, "") + "/";
        var candidates = [dir + "scripts/CaveSurvey/", dir];
        for (var c = 0; c < candidates.length; c++) {
            if (new QFileInfo(candidates[c] + "CaveSurvey.js").exists()) {
                return new QFileInfo(candidates[c]).absoluteFilePath().replace(/\/+$/, "") + "/";
            }
        }
    }
    return null;
}

// Every .js in the add-on, recursively: the menu builder, every tool,
// and the whole Core library (including Core/Format/).
function collectScripts(addon) {
    var scripts = ["CaveSurvey.js"];
    var walk = function(rel) {
        var dir = new QDir(addon + rel);
        var files = dir.entryInfoList(
            ["*.js"], makeQDirFilters(QDir.NoDotAndDotDot, QDir.Files), QDir.Name);
        for (var f = 0; f < files.length; f++) {
            scripts.push(rel + files[f].fileName());
        }
        var subdirs = dir.entryInfoList(
            ["*"], makeQDirFilters(QDir.NoDotAndDotDot, QDir.Dirs), QDir.Name);
        for (var d = 0; d < subdirs.length; d++) {
            walk(rel + subdirs[d].fileName() + "/");
        }
    };
    var dirs = new QDir(addon).entryInfoList(
        ["*"], makeQDirFilters(QDir.NoDotAndDotDot, QDir.Dirs), QDir.Name);
    for (var i = 0; i < dirs.length; i++) {
        walk(dirs[i].fileName() + "/");
    }
    return scripts;
}

var addon = findAddon();
if (addon === null) {
    print("### ERROR add-on not found -- pass the repo root, or the "
          + "CaveSurvey folder itself, as the last argument");
} else {
    print("add-on: " + addon);
    var TOOLS = collectScripts(addon);
    var failures = 0;
    for (var i = 0; i < TOOLS.length; i++) {
        var src = readWhole(addon + TOOLS[i]);
        if (src === null) {
            print("FAIL  " + TOOLS[i] + " -- cannot read");
            failures++;
            continue;
        }
        try {
            // Parses without running. The wrapper is never called.
            eval("(function(){" + src + "\n})");
            print("ok    " + TOOLS[i]);
        } catch (e) {
            print("FAIL  " + TOOLS[i] + " -- " + e);
            failures++;
        }
    }
    print("### " + (TOOLS.length - failures) + "/" + TOOLS.length + " parsed");

    // CALLED BUT NEVER WRITTEN.
    //
    // Parsing does not catch a function that is called and does not
    // exist -- it is a ReferenceError at RUN time, and in a signal
    // handler or a guarded init that error is swallowed whole. That is
    // exactly what happened to Cave3D.connectOnce: an edit removed it,
    // everything still parsed, and every button on the 3D panel quietly
    // stopped being connected to anything for an afternoon.
    //
    // So: for each file, every Thing.method() called on an object that
    // file also DEFINES must have a "Thing.method = function"
    // somewhere in the add-on.
    var missing = 0;
    var defined = {};
    var calls = {};
    for (var d = 0; d < TOOLS.length; d++) {
        var text = readWhole(addon + TOOLS[d]);
        if (text === null) { continue; }
        // ANY assignment counts as defining it, not just "= function":
        // a constant, or a function assigned from a local (which is how
        // SketchScans hands its inner functions out), is just as
        // defined as one written inline.
        var def = /\b(Cs[A-Za-z0-9]*|Cave3D|SketchScans|SurveyNotebook)\.([A-Za-z0-9_]+)\s*=/g;
        var m;
        while ((m = def.exec(text)) !== null) {
            defined[m[1] + "." + m[2]] = true;
        }
        var use = /\b(Cs[A-Za-z0-9]*|Cave3D|SketchScans|SurveyNotebook)\.([A-Za-z0-9_]+)\s*\(/g;
        while ((m = use.exec(text)) !== null) {
            var key = m[1] + "." + m[2];
            if (!calls.hasOwnProperty(key)) { calls[key] = TOOLS[d]; }
        }
    }
    for (var key in calls) {
        if (!calls.hasOwnProperty(key)) { continue; }
        if (defined[key] === true) { continue; }
        // Things every object has.
        var BUILT_IN = " hasOwnProperty toString valueOf constructor "
            + "isPrototypeOf propertyIsEnumerable call apply bind ";
        if (BUILT_IN.indexOf(" " + key.split(".")[1] + " ") >= 0) {
            continue;
        }
        // Only complain about objects this add-on actually defines
        // something on: a call to a Qt or QCAD object is not ours.
        var owner = key.split(".")[0];
        var ownsAny = false;
        for (var known in defined) {
            if (defined.hasOwnProperty(known) &&
                    known.split(".")[0] === owner) { ownsAny = true; break; }
        }
        if (!ownsAny) { continue; }
        print("FAIL  " + key + "() is called (" + calls[key] +
              ") and never defined");
        missing++;
    }
    if (missing > 0) {
        print("### " + missing + " call(s) with nothing behind them");
    }

    print((failures === 0 && missing === 0)
        ? "### SYNTAX OK" : "### SYNTAX FAILURES");
}
