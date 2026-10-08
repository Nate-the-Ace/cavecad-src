// CsTeach.js -- the teaching cave: where it lives, and what resetting
// it means.
//
// Part of the Cave Survey Core library. The path arithmetic and the
// plan of what to copy are PURE and are what tests/js_unit.js pins; the
// file work is in CsTeach.apply, which needs a filesystem.
//
// WHY A REAL CAVE. The suite used to teach on an invented one -- Lesson
// Cave, generated, deterministic, with made-up coordinates -- and the
// reason was the suite's first rule: real cave entrances do not go in
// test data. That was the right answer for a FIXTURE and the wrong one
// for a CURRICULUM. An invented cave closes perfectly because nobody
// walked it; it has no trip that overlaps another, no sketch anybody
// argued about, no loop that misses by five feet because a backsight
// was read wrong in a wet crawl. A student who learns on it has never
// met the thing the tools exist for.
//
// So the teaching cave is a real one, and the first rule is kept the
// other way: the copy a student works on is SANITIZED (CsSanitize),
// carrying the cave's shape, its trips, its teams and its linework, and
// not its location.
//
// THREE FOLDERS, and the distinction between them is the whole design:
//
//   the ORIGINAL   wherever the surveyor keeps it -- usually a shared
//                  drive. This code opens it to read, once, and never
//                  writes to it. A student cannot reach it at all.
//   the MASTER     ~/Documents/Cave/teaching/master/<Cave>/
//                  the pristine sanitized copy. Made once; reset
//                  copies FROM here and never to here.
//   the WORKING    ~/Documents/Cave/teaching/<Cave>/
//                  what a student opens, edits, and ruins. Reset
//                  throws it away and lays down a fresh copy.
//
// A teaching cave that resets to something a student has been editing
// is not a teaching cave; that is why the master exists as a separate
// folder rather than as "the backup" or "the zip we made once".

var CsTeach = {};

/** Where the Cave folder sits under a home directory. The same root
 *  CsPackage.DEPOT hangs off, spelled once. */
CsTeach.CAVE_ROOT = "Documents/Cave";

/** Under the Cave root: everything teaching lives here. */
CsTeach.FOLDER = "teaching";

/** The Cave root for a home path, e.g. ~/Documents/Cave. */
CsTeach.caveRootFor = function(homePath) {
    var home = isNull(homePath) ? "" : String(homePath).replace(/\/+$/, "");
    return home === "" ? CsTeach.CAVE_ROOT :
        (home + "/" + CsTeach.CAVE_ROOT);
};

/** Under that: the pristine copies. */
CsTeach.MASTER = "master";

/** The teaching root, e.g. ~/Documents/Cave/teaching. */
CsTeach.rootFor = function(caveRoot) {
    var root = isNull(caveRoot) ? "" : String(caveRoot).replace(/\/+$/, "");
    return root === "" ? CsTeach.FOLDER : (root + "/" + CsTeach.FOLDER);
};

/** Where the pristine copy of one cave lives. */
CsTeach.masterFor = function(caveRoot, caveName) {
    return CsTeach.rootFor(caveRoot) + "/" + CsTeach.MASTER + "/" +
        CsPackage.safeName(caveName);
};

/** Where the student's copy of one cave lives. */
CsTeach.workingFor = function(caveRoot, caveName) {
    return CsTeach.rootFor(caveRoot) + "/" + CsPackage.safeName(caveName);
};

/** The drawing inside either of those, by the cave's name. */
CsTeach.drawingIn = function(folder, caveName) {
    return folder + "/" + CsPackage.safeName(caveName) + ".dxf";
};

/**
 * Is this path inside the teaching area?
 *
 * Used to refuse to make a master OF a teaching copy: sanitizing an
 * already-sanitized student folder would quietly enshrine whatever that
 * student had done to it as the thing everyone resets to.
 */
CsTeach.isTeaching = function(caveRoot, path) {
    if (isNull(path)) {
        return false;
    }
    var root = CsTeach.rootFor(caveRoot);
    return String(path).indexOf(root) === 0;
};

/**
 * What a reset will do, decided before anything is touched.
 *
 * \param state {masterExists, workingExists, caveName}
 * \return { can, verb, warning, reason }
 *
 * `can` false means the tool refuses and `reason` says why in words a
 * student can act on. `warning` is what has to be agreed to first: a
 * reset DELETES work, and the one thing this must never do is take
 * somebody's evening away without asking.
 */
CsTeach.planReset = function(state) {
    var name = isNull(state) || isNull(state.caveName) ? "the teaching cave" :
        state.caveName;
    if (isNull(state) || state.masterExists !== true) {
        return {
            can: false, verb: "", warning: "",
            reason: "There is no pristine copy of " + name + " to reset " +
                "to yet. Set one up first -- that is the step that takes " +
                "a real cave, removes its location, and puts the result " +
                "somewhere a student can safely ruin."
        };
    }
    if (state.workingExists !== true) {
        return {
            can: true, verb: "create", reason: "",
            warning: ""   // nothing to lose: this is the first hand-out
        };
    }
    return {
        can: true, verb: "replace", reason: "",
        warning: "This throws away everything in the teaching copy of " +
            name + " and lays down a fresh one. Any drawing a student " +
            "has done there is gone. The original cave is not touched."
    };
};

/**
 * What making a master will do.
 *
 * \param state {sourceDrawing, caveName, masterExists, sourceIsTeaching}
 */
CsTeach.planMaster = function(state) {
    if (isNull(state) || isNull(state.sourceDrawing) ||
            String(state.sourceDrawing) === "") {
        return { can: false, verb: "", warning: "",
            reason: "Pick the cave to teach from first." };
    }
    if (state.sourceIsTeaching === true) {
        // Sanitizing a student folder back into the master would
        // enshrine whatever that student had done as the thing everyone
        // resets to -- silently, and only noticed weeks later.
        return { can: false, verb: "", warning: "",
            reason: "That IS a teaching copy. A master has to be made " +
                "from the real cave, or every reset after this one " +
                "would restore somebody's homework." };
    }
    if (state.masterExists === true) {
        return { can: true, verb: "refresh", reason: "",
            warning: "This replaces the pristine copy of " +
                state.caveName + " that resets go back to. Do it when " +
                "the real cave has been surveyed further." };
    }
    return { can: true, verb: "create", reason: "", warning: "" };
};

/**
 * What a student is told once the reset is done. Says where the copy
 * is and, deliberately, that its location was removed -- so nobody
 * teaches from it believing it is the whole cave record.
 */
CsTeach.doneText = function(caveName, workingFolder, verb) {
    return "Teaching Cave: " + caveName +
        (verb === "create" ? " set up at " : " reset to the pristine copy at ") +
        workingFolder + ". The cave's location is not in this copy -- " +
        "it is a teaching drawing, not the cave's record.";
};
