// CsHandbook.js -- the handbook's index, and every lookup over it.
//
// Part of the Cave Survey Core library. Reads files and answers
// questions about them: no document, no widget, nothing drawn.
//
// WHY IT EXISTS. The suite has 27 tools and, until this, no explanation
// of any of them inside the application they live in -- a README a
// student never opens, and one-sentence status tips. The handbook is
// ~62 HTML pages shipped beside the add-on and read in a dock panel;
// this file is everything about them that is not a widget.
//
// THE PAGES ARE FILES, NOT STRINGS. Prose belongs in a file a person
// can edit and diff, not in a JavaScript literal, and QTextBrowser
// reads HTML off disk with working links, working Back and working
// <img> for free. The cost is that the handbook can be MISSING -- a
// half-copied install, a moved folder -- so every entry point here
// answers null rather than throwing, and the panel says so plainly.
//
// See docs/superpowers/specs/2026-09-13-handbook-design.md.

var CsHandbook = {};

/**
 * Where this file was included from, captured AT INCLUDE TIME.
 *
 * `includeBasePath` is a global that QCAD repoints for every include,
 * so by the time a button is pressed it is CaveCAD's own scripts folder
 * -- measured live, 2026-09-13: "/Applications/CaveCAD.app/Contents/
 * Resources/scripts". Reading it inside a function therefore finds the
 * handbook nowhere. The value is only true while this file is being
 * evaluated, which is here.
 */
CsHandbook.BASE = (typeof(includeBasePath) === "undefined") ?
    "" : String(includeBasePath);

/** The parsed index, or null before the first read. Cleared by
 *  CsHandbook.forget() so a session that edits pages can reread. */
CsHandbook.cache = null;

/** Lowercased page bodies, keyed by page id, filled lazily by search. */
CsHandbook.bodies = null;

/**
 * The handbook folder, or null when there is none.
 *
 * The same three-place lookup CsSymbolStore.templatePath() uses, in the
 * same order and for the same reasons: a build carries the handbook
 * beside the add-on, a caver who has moved it is not overruled by a
 * stale copy inside an old build, and a repository checkout -- where
 * the add-on is included from the source tree -- finds docs/handbook.
 */
CsHandbook.rootPath = function() {
    var candidates = [];
    if (CsHandbook.BASE !== "") {
        candidates.push(CsHandbook.BASE + "/../Handbook");
    }
    try {
        var setting = RSettings.getStringValue("CaveSurvey/HandbookPath", "");
        if (setting !== "") {
            candidates.push(setting);
        }
    } catch (eSet) {
    }
    if (CsHandbook.BASE !== "") {
        // a checkout: .../cave-survey/scripts/CaveSurvey/Core -> docs
        candidates.push(CsHandbook.BASE + "/../../../docs/handbook");
    }

    // A candidate counts only when its index.json is there. The FIRST
    // candidate is also the Handbook TOOL's own folder -- in a build
    // the pages are copied in beside Handbook.js, in a checkout that
    // folder holds only the tool -- so a test for the directory alone
    // would answer "installed" in the repo and then find no index.
    for (var i = 0; i < candidates.length; i++) {
        try {
            if (new QFileInfo(candidates[i] + "/index.json").exists()) {
                return new QFileInfo(candidates[i]).absoluteFilePath();
            }
        } catch (eTest) {
        }
    }
    return null;
};

/**
 * Every path rootPath() considered, for the panel's "not installed"
 * message. A student whose handbook is missing needs to be told WHERE
 * it was looked for, or the report they send back says only "broken".
 */
CsHandbook.searchedPaths = function() {
    if (CsHandbook.BASE === "") {
        return [];
    }
    return [CsHandbook.BASE + "/../Handbook",
        CsHandbook.BASE + "/../../../docs/handbook"];
};

/**
 * A file's text, as UTF-8, or null when it cannot be read.
 *
 * QFile.readAll() is not usable in this engine -- it hands back a
 * QByteArray whose size() is 0 (see CsBackup.readBytes) -- so this is
 * QTextStream, the one faithful read the bridge has.
 */
CsHandbook.readText = function(path) {
    try {
        var f = new QFile(String(path));
        if (!f.open(QIODevice.ReadOnly)) {
            return null;
        }
        var stream = new QTextStream(f);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
            // an older bridge reads in the locale's codec, which is
            // UTF-8 everywhere this ships
        }
        var text = String(stream.readAll());
        f.close();
        return text;
    } catch (e) {
        return null;
    }
};

/**
 * The parsed index: { pages: [...] }, or null when the handbook is not
 * installed or its index will not parse.
 *
 * Read once and held. A malformed index is not a crash -- the panel
 * treats it exactly as a missing one.
 */
CsHandbook.index = function() {
    if (!isNull(CsHandbook.cache)) {
        return CsHandbook.cache;
    }
    var root = CsHandbook.rootPath();
    if (root === null) {
        return null;
    }
    var raw = CsHandbook.readText(root + "/index.json");
    if (raw === null) {
        return null;
    }
    var parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    if (isNull(parsed) || isNull(parsed.pages) ||
        parsed.pages.length === undefined) {
        return null;
    }
    parsed.root = root;
    CsHandbook.cache = parsed;
    return parsed;
};

/** Drop the cached index and page bodies. */
CsHandbook.forget = function() {
    CsHandbook.cache = null;
    CsHandbook.bodies = null;
};

/** Every page record, in reading order, or [] when there is no index. */
CsHandbook.pages = function() {
    var index = CsHandbook.index();
    if (index === null) {
        return [];
    }
    return index.pages;
};

/** One page record by id, or null. */
CsHandbook.page = function(id) {
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length; i++) {
        if (pages[i].id === String(id)) {
            return pages[i];
        }
    }
    return null;
};

/** The absolute path of a page's HTML file, or null. */
CsHandbook.filePath = function(id) {
    var page = CsHandbook.page(id);
    if (page === null) {
        return null;
    }
    return CsHandbook.index().root + "/pages/" + page.file;
};

/**
 * The page documenting a tool folder ("FeatureTrace"), or null.
 *
 * What the ? button on a panel asks. A tool with no page is not an
 * error here -- a parked tool has none by design -- so the caller
 * falls back to the contents.
 */
CsHandbook.forTool = function(folder) {
    var name = String(folder);
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length; i++) {
        var tools = pages[i].tools;
        if (isNull(tools)) {
            continue;
        }
        for (var t = 0; t < tools.length; t++) {
            if (tools[t] === name) {
                return pages[i].id;
            }
        }
    }
    return null;
};

/**
 * The id of the page after this one, or null at the end.
 *
 * Reading order is the order of the index array, deliberately: the
 * handbook is also a course, and the course's order is one editable
 * list rather than a next: field on every page that has to be kept in
 * step by hand.
 */
CsHandbook.next = function(id) {
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length - 1; i++) {
        if (pages[i].id === String(id)) {
            return pages[i + 1].id;
        }
    }
    return null;
};

/** The id of the page before this one, in reading order, or null. */
CsHandbook.previous = function(id) {
    var pages = CsHandbook.pages();
    for (var i = 1; i < pages.length; i++) {
        if (pages[i].id === String(id)) {
            return pages[i - 1].id;
        }
    }
    return null;
};

/**
 * The page bodies as lowercased plain text, keyed by id.
 *
 * Built on the first search and held. At ~62 short pages the whole
 * handbook is well under a megabyte, so a real index would cost more
 * to maintain than the scan costs to run.
 */
CsHandbook.loadBodies = function() {
    if (!isNull(CsHandbook.bodies)) {
        return CsHandbook.bodies;
    }
    var bodies = {};
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length; i++) {
        var text = CsHandbook.readText(CsHandbook.filePath(pages[i].id));
        if (text === null) {
            bodies[pages[i].id] = "";
            continue;
        }
        bodies[pages[i].id] = CsHandbook.plainText(text).toLowerCase();
    }
    CsHandbook.bodies = bodies;
    return bodies;
};

/**
 * HTML reduced to the words in it.
 *
 * Deliberately crude -- tags out, entities for the five characters that
 * matter back in. A search box is not a renderer, and a stray attribute
 * value surviving into the haystack costs a beginner nothing.
 */
CsHandbook.plainText = function(html) {
    var text = String(html);
    text = text.replace(/<[^>]*>/g, " ");
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, "\"");
    text = text.replace(/\s+/g, " ");
    return text;
};

/**
 * Page ids matching a search, title hits first.
 *
 * Substring, case-insensitive, no ranking beyond that one rule: a
 * student typing "scan" wants the page CALLED Sketch Scans above the
 * eleven that mention scanning.
 */
CsHandbook.search = function(text) {
    var needle = String(text).toLowerCase().trim();
    if (needle === "") {
        return [];
    }
    var pages = CsHandbook.pages();
    var titles = [];
    var bodies = [];
    var haystacks = CsHandbook.loadBodies();
    for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        if (String(page.title).toLowerCase().indexOf(needle) >= 0) {
            titles.push(page.id);
        } else if (haystacks[page.id].indexOf(needle) >= 0) {
            bodies.push(page.id);
        }
    }
    return titles.concat(bodies);
};

/** The pages of one class ("tool", "task", "concept", "process"). */
CsHandbook.ofClass = function(cls) {
    var out = [];
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length; i++) {
        if (pages[i]["class"] === String(cls)) {
            out.push(pages[i]);
        }
    }
    return out;
};

/**
 * The menu stages, in order, as
 * [{ stage: 450, title: "Start here", pages: [...] }].
 *
 * Tool pages only: the contents lists them under the same six stages
 * the Cave Survey menu is sectioned into, so the handbook and the menu
 * are the same shape and a student learns one structure, not two.
 */
CsHandbook.STAGES = {
    450: "Start here",
    451: "Survey data",
    452: "Draw the map",
    453: "Put a reference under the map",
    454: "Finish the sheet",
    455: "Fix and share"
};

CsHandbook.stages = function() {
    var out = [];
    var order = [450, 451, 452, 453, 454, 455];
    for (var s = 0; s < order.length; s++) {
        var stage = order[s];
        var pages = [];
        var all = CsHandbook.ofClass("tool");
        for (var i = 0; i < all.length; i++) {
            if (all[i].stage === stage) {
                pages.push(all[i]);
            }
        }
        if (pages.length > 0) {
            out.push({ stage: stage, title: CsHandbook.STAGES[stage],
                pages: pages });
        }
    }
    return out;
};

/**
 * Every screenshot in the index, flattened, as
 * [{ page, image, depicts, hash }].
 *
 * What tests/handbook_shots.py walks to find shots taken of a panel
 * that has since changed.
 */
CsHandbook.shots = function() {
    var out = [];
    var pages = CsHandbook.pages();
    for (var i = 0; i < pages.length; i++) {
        var shots = pages[i].shots;
        if (isNull(shots)) {
            continue;
        }
        for (var s = 0; s < shots.length; s++) {
            out.push({ page: pages[i].id, image: shots[s].image,
                depicts: shots[s].depicts, hash: shots[s].hash });
        }
    }
    return out;
};

/**
 * The animated images a page asks for: each distinct <img src="x.gif">,
 * in the order they appear, as bare file names.
 *
 * A page names a clip exactly as it names a screenshot -- a plain
 * <img> -- so a build that cannot animate still shows the clip's first
 * frame. Only the panel knows how to play one; this is the part of
 * "which images move" that needs no widget.
 */
CsHandbook.clipNames = function(html) {
    var out = [];
    var re = /<img\b[^>]*\bsrc\s*=\s*"([^"]+\.gif)"/gi;
    var m;
    while ((m = re.exec(String(html))) !== null) {
        if (out.indexOf(m[1]) < 0) {
            out.push(m[1]);
        }
    }
    return out;
};
