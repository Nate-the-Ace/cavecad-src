// CsGuide.js -- the six lessons as a checklist, and what a student has
// already done.
//
// Part of the Cave Survey Core library. Reads the handbook's own lesson
// pages and the settings: no document, no widget.
//
// ONE SOURCE OF TEXT. A guided first run that carried its own copy of
// the lessons would be a second set of words to keep in step with the
// handbook, and the pair would disagree within a month -- the suite has
// lost that argument before, which is why the legend prints CsHelp's
// sentences rather than its own. So the steps a student ticks off ARE
// the numbered steps on the lesson page, lifted out of its first <ol>.
// Rewriting a lesson rewrites the checklist.
//
// WHAT IS TICKED IS WHAT THE STUDENT SAYS. Nothing here reads the
// drawing. Detecting "this student has traced a wall" is a real feature
// and a much larger one -- every check is a judgement about what counts
// -- and a guide that ticked a step the student had not understood
// would be worse than one that asks. See the design doc.
//
// See docs/superpowers/specs/2026-09-13-handbook-design.md.

var CsGuide = {};

/** Where progress is kept. One key per lesson, holding the step
 *  numbers ticked, comma separated. */
CsGuide.SETTING = "CaveSurvey/StartHere";

/**
 * The lessons, in reading order: the handbook's `process` pages minus
 * the welcome page, which is a page to read rather than a lesson to do.
 */
CsGuide.lessons = function() {
    var out = [];
    var pages = CsHandbook.ofClass("process");
    for (var i = 0; i < pages.length; i++) {
        if (pages[i].id === "start-here") {
            continue;
        }
        out.push(pages[i]);
    }
    return out;
};

/**
 * The numbered steps of a lesson, as plain text, from the FIRST <ol> on
 * its page.
 *
 * Deliberately the first: a lesson page's other lists are its "if it
 * goes wrong" notes, which are things to read when something breaks
 * rather than things to do in order.
 *
 * \return an array of strings, empty when the page has no ordered list
 */
CsGuide.stepsOf = function(pageId) {
    var path = CsHandbook.filePath(pageId);
    if (path === null) {
        return [];
    }
    var html = CsHandbook.readText(path);
    if (html === null) {
        return [];
    }
    var start = html.indexOf("<ol>");
    if (start < 0) {
        return [];
    }
    var end = html.indexOf("</ol>", start);
    if (end < 0) {
        return [];
    }
    var block = html.substring(start + 4, end);
    var out = [];
    var parts = block.split("<li>");
    for (var i = 1; i < parts.length; i++) {
        var item = parts[i];
        var close = item.indexOf("</li>");
        if (close >= 0) {
            item = item.substring(0, close);
        }
        item = CsHandbook.plainText(item);
        // plainText puts a space where a tag was, so a step that ends
        // on <b>Caves</b>. comes out as "Caves ." -- right for a search
        // haystack, wrong for a sentence a student reads.
        item = item.replace(/\s+([.,;:!?])/g, "$1");
        item = item.replace(/^\s+/, "").replace(/\s+$/, "");
        if (item !== "") {
            out.push(item);
        }
    }
    return out;
};

/** The step numbers ticked for a lesson, as an object keyed by index. */
CsGuide.done = function(pageId) {
    var raw = "";
    try {
        raw = RSettings.getStringValue(CsGuide.SETTING + "/" +
            String(pageId), "");
    } catch (e) {
        return {};
    }
    var out = {};
    if (raw === "") {
        return out;
    }
    var parts = String(raw).split(",");
    for (var i = 0; i < parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (!isNaN(n)) {
            out[n] = true;
        }
    }
    return out;
};

/** Tick or untick one step. */
CsGuide.setDone = function(pageId, index, done) {
    var current = CsGuide.done(pageId);
    if (done) {
        current[index] = true;
    } else {
        delete current[index];
    }
    var kept = [];
    for (var k in current) {
        kept.push(k);
    }
    kept.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    try {
        RSettings.setValue(CsGuide.SETTING + "/" + String(pageId),
            kept.join(","));
    } catch (e) {
    }
};

/** Forget a lesson's progress, or every lesson's when given nothing. */
CsGuide.forget = function(pageId) {
    if (!isNull(pageId)) {
        try {
            RSettings.setValue(CsGuide.SETTING + "/" + String(pageId), "");
        } catch (e) {
        }
        return;
    }
    var lessons = CsGuide.lessons();
    for (var i = 0; i < lessons.length; i++) {
        CsGuide.forget(lessons[i].id);
    }
};

/** How far through a lesson: { done, total }. */
CsGuide.progress = function(pageId) {
    var steps = CsGuide.stepsOf(pageId);
    var ticked = CsGuide.done(pageId);
    var n = 0;
    for (var i = 0; i < steps.length; i++) {
        if (ticked[i] === true) {
            n++;
        }
    }
    return { done: n, total: steps.length };
};

/**
 * The lesson to open on: the first one not finished, or the last one
 * when every lesson is done.
 *
 * A student who closes CaveCAD halfway through lesson three should not
 * have to remember that they were on lesson three.
 */
CsGuide.resumeAt = function() {
    var lessons = CsGuide.lessons();
    if (lessons.length === 0) {
        return null;
    }
    for (var i = 0; i < lessons.length; i++) {
        var p = CsGuide.progress(lessons[i].id);
        if (p.total === 0 || p.done < p.total) {
            return lessons[i].id;
        }
    }
    return lessons[lessons.length - 1].id;
};
