// CsScanTree.js
//
// The folder tree Sketch Scans draws over CsCave.filesUnder's relative
// paths. Surveyors keep scans in per-trip subfolders, so the browse
// list shows folder rows that collapse -- but this bridge cannot
// construct a real QTreeWidget (wrapper-only stub; see CaveShelf.js),
// so the tree is SIMULATED on a one-column QTableWidget: this file is
// the pure model behind it -- rows, depths, collapse rules and the
// collapsed-state settings format. No Q* or R* symbols, so
// tests/js_unit.js exercises all of it under node.

var CsScanTree = {};

// The one settings key. Its value is a JSON object mapping a scans
// folder's ABSOLUTE path to the list of collapsed RELATIVE folder
// paths inside it -- per cave by construction, one key overall.
CsScanTree.SETTING = "CaveSurvey/SketchScansCollapsed";

// COMPLETE -- the scans a caver has finished with. Same storage shape,
// its own key: an absolute scans path mapping to the list of completed
// RELATIVE file paths inside it.
//
// The setting KEY still says Bookmarks. It was a bookmark first, and
// renaming the key would throw away every mark already made for the
// sake of a word nobody sees.
//
// THE FOUR FUNCTIONS BELOW ARE GENERIC, whatever their names say.
// parseCollapsed / serializeCollapsed / collapsedSetFor /
// recordCollapsed are a per-cave string-set store and nothing about
// them knows what a collapsed folder is; bookmarks use them as they
// are rather than growing a second copy that could drift. If a third
// use ever appears, that is the moment to rename them.
CsScanTree.SETTING_BOOKMARKS = "CaveSurvey/SketchScansBookmarks";

// THE SELECTED SCAN -- which page the caver was on when the panel was
// last built. Same per-cave shape as the two sets above, but ONE
// relative path per scans folder rather than a list: an absolute scans
// path maps to the rel of the scan that was selected there.
//
// Stored separately from the marks because it answers a different
// question: "Complete" says a page is finished, the selection says
// where the caver was. Landing on the first incomplete scan is only
// right the FIRST time a cave is opened; after that the page you were
// on beats any guess about the page you ought to be on.
CsScanTree.SETTING_SELECTED = "CaveSurvey/SketchScansSelected";

// Display rows for a list of relative file paths (sorted, the shape
// CsCave.filesUnder answers): {kind: "folder"|"file", rel, depth,
// label}. A folder row is emitted the first time any path passes
// through it, immediately before its content; depth counts ancestor
// folders; label is the last path segment.
CsScanTree.rowsOf = function(files) {
    var rows = [];
    var seen = {};
    if (files === null || files === undefined) { return rows; }
    for (var i = 0; i < files.length; i++) {
        var rel = String(files[i]);
        var ancestors = CsScanTree.ancestorsOf(rel);
        for (var a = 0; a < ancestors.length; a++) {
            if (seen[ancestors[a]] === true) { continue; }
            seen[ancestors[a]] = true;
            rows.push({
                kind: "folder",
                rel: ancestors[a],
                depth: a,
                label: ancestors[a].substring(
                    ancestors[a].lastIndexOf("/") + 1)
            });
        }
        rows.push({
            kind: "file",
            rel: rel,
            depth: ancestors.length,
            label: rel.substring(rel.lastIndexOf("/") + 1)
        });
    }
    return rows;
};

// The folder prefixes of a relative path, outermost first:
// "a/b/c.jpg" -> ["a", "a/b"]. A top-level name has none.
CsScanTree.ancestorsOf = function(rel) {
    var out = [];
    var from = 0;
    while (true) {
        var slash = rel.indexOf("/", from);
        if (slash === -1) { break; }
        out.push(rel.substring(0, slash));
        from = slash + 1;
    }
    return out;
};

// A row is hidden when ANY strict ancestor folder is collapsed. The
// row for a collapsed folder itself stays visible (that is where the
// expand click lands), and a still-collapsed subfolder keeps its own
// content hidden after its parent expands -- standard tree semantics,
// for free.
CsScanTree.isHidden = function(row, collapsedSet) {
    if (collapsedSet === null || collapsedSet === undefined) {
        return false;
    }
    var ancestors = CsScanTree.ancestorsOf(row.rel);
    for (var i = 0; i < ancestors.length; i++) {
        if (collapsedSet[ancestors[i]] === true) { return true; }
    }
    return false;
};

// True when EVERY scan beneath a folder is complete.
//
// Not "holds a completed one", which was the rule when this marked a
// bookmark and is nearly useless now: a trip folder of forty pages with
// one page done would wear the same tick as one that is finished. A
// collapsed folder should say "this trip is done", and that is only
// true when nothing inside it is outstanding. A folder with no scans in
// it at all is not complete -- there is nothing to have finished.
CsScanTree.folderComplete = function(folderRel, rows, complete) {
    if (rows === null || rows === undefined) {
        return false;
    }
    var prefix = folderRel + "/";
    var found = false;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file" || rows[i].rel.indexOf(prefix) !== 0) {
            continue;
        }
        found = true;
        if (complete === null || complete === undefined ||
                complete[rows[i].rel] !== true) {
            return false;
        }
    }
    return found;
};

// Sets or clears the mark on every scan beneath a folder, IN PLACE.
//
// A TRIP AT A TIME, because that is how the pages arrive: a caver comes
// back with forty scanned pages, works through them, and the last thing
// they want is forty right-clicks to say so. folderComplete above
// already means "everything in here is done", so this is the way to say
// it directly.
//
// EVERYTHING BENEATH IT, however deep. A trip folder holding per-team
// subfolders is still one trip, and marking it done while its
// subfolders stayed outstanding would leave a folder saying finished
// over pages that are not.
//
// Returns how many scans actually changed, so a caller can write and
// announce only when something did.
CsScanTree.markFolder = function(complete, folderRel, rows, want) {
    if (complete === null || complete === undefined ||
            rows === null || rows === undefined ||
            typeof folderRel !== "string" || folderRel === "") {
        return 0;
    }
    // The trailing slash is what keeps "2025 Scans" from swallowing
    // "2025 Scans Old": a folder is a path SEGMENT, not a prefix.
    var prefix = folderRel + "/";
    var touched = 0;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file") { continue; }
        if (String(rows[i].rel).indexOf(prefix) !== 0) { continue; }
        if (want === true) {
            if (complete[rows[i].rel] !== true) { touched++; }
            complete[rows[i].rel] = true;
        } else {
            if (complete[rows[i].rel] === true) { touched++; }
            delete complete[rows[i].rel];
        }
    }
    return touched;
};

// The first visible scan NOT yet complete, or -1: where the panel puts
// the caver when it opens.
//
// The opposite of what this did as a bookmark, and deliberately. A mark
// meaning "finished" is not a place to return to -- returning to the
// last thing you finished is the one scan you have no more work on. The
// useful landing is the next one still to do.
//
// A row hidden inside a collapsed folder is not jumped to: expanding
// folders the caver collapsed would trade one remembered thing for
// another.
CsScanTree.firstIncompleteRow = function(rows, complete, collapsedSet) {
    if (rows === null || rows === undefined) {
        return -1;
    }
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file") {
            continue;
        }
        if (complete !== null && complete !== undefined &&
                complete[rows[i].rel] === true) {
            continue;
        }
        if (CsScanTree.isHidden(rows[i], collapsedSet)) {
            continue;
        }
        return i;
    }
    return -1;
};

// The stored JSON, parsed defensively: anything unreadable is an empty
// map, never a throw -- a corrupt setting must cost the memory of what
// was collapsed, not the tool.
CsScanTree.parseCollapsed = function(json) {
    if (typeof json !== "string" || json === "") { return {}; }
    try {
        var map = JSON.parse(json);
        if (map === null || typeof map !== "object" ||
                Object.prototype.toString.call(map) !== "[object Object]") {
            return {};
        }
        return map;
    } catch (e) {
        return {};
    }
};

CsScanTree.serializeCollapsed = function(map) {
    return JSON.stringify(map);
};

// The collapsed set for one cave's scans folder, as {rel: true}.
CsScanTree.collapsedSetFor = function(map, scansPath) {
    var set = {};
    var list = map === null || map === undefined ? null : map[scansPath];
    if (Object.prototype.toString.call(list) !== "[object Array]") {
        return set;
    }
    for (var i = 0; i < list.length; i++) {
        if (typeof list[i] === "string") { set[list[i]] = true; }
    }
    return set;
};

// Writes one cave's collapsed set back into the map, keeping only
// folders that still exist (validRels) -- deleted or renamed trip
// folders fall out of the setting instead of accreting -- and dropping
// the cave's entry entirely when nothing is collapsed.
CsScanTree.recordCollapsed = function(map, scansPath, set, validRels) {
    var keep = [];
    for (var i = 0; i < validRels.length; i++) {
        if (set[validRels[i]] === true) { keep.push(validRels[i]); }
    }
    if (keep.length === 0) {
        delete map[scansPath];
    } else {
        map[scansPath] = keep;
    }
    return map;
};

// The remembered scan for one cave's scans folder, or null. Anything
// that is not a string is no memory at all.
CsScanTree.selectedRelFor = function(map, scansPath) {
    var rel = map === null || map === undefined ? null : map[scansPath];
    return typeof rel === "string" && rel !== "" ? rel : null;
};

// Writes one cave's remembered scan back into the map. A rel that is
// not in validRels -- a scan since deleted, renamed or trimmed away --
// drops the cave's entry rather than storing a path the panel can no
// longer land on, and so does a null rel.
CsScanTree.recordSelected = function(map, scansPath, rel, validRels) {
    var ok = false;
    if (typeof rel === "string" && rel !== "") {
        for (var i = 0; i < validRels.length; i++) {
            if (validRels[i] === rel) { ok = true; break; }
        }
    }
    if (ok) {
        map[scansPath] = rel;
    } else {
        delete map[scansPath];
    }
    return map;
};

// The row index of one relative file path, or -1 when it is gone or
// sitting inside a collapsed folder. Hidden counts as gone for the
// same reason firstIncompleteRow skips hidden rows: expanding a folder
// the caver collapsed trades one remembered thing for another.
CsScanTree.rowOfRel = function(rows, rel, collapsedSet) {
    if (rows === null || rows === undefined ||
            typeof rel !== "string" || rel === "") {
        return -1;
    }
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].kind !== "file" || rows[i].rel !== rel) {
            continue;
        }
        return CsScanTree.isHidden(rows[i], collapsedSet) ? -1 : i;
    }
    return -1;
};

// ---------------------------------------------------------------------
// THE CASCADE.
//
// A flat list of every scanned page is the wrong control for a cave
// with two hundred of them: Truitt Cave's are "2024 Scans/4-6-24 Survey
// Scans/Team A/page 3.jpg", and a combo holding all of those is a combo
// nobody can find a page in (Nathan, 2026-09-11: "can you make it a few
// dropdowns based on the folders in the scans folder?").
//
// Surveyors already filed them the way they think about them -- year,
// trip, team -- so the folders ARE the question the chooser should ask,
// one level at a time. These are the pure answers behind that; the
// panel makes a combo per level.
// ---------------------------------------------------------------------

/** How many folder levels deep the scans go. 0 when every page sits
 *  directly in scans/, which is a cave with one combo. */
CsScanTree.depthOf = function(files) {
    var deepest = 0;
    for (var i = 0; i < files.length; i++) {
        var parts = String(files[i]).split("/");
        var folders = parts.length - 1;
        if (folders > deepest) {
            deepest = folders;
        }
    }
    return deepest;
};

/** True when `rel` sits under this folder path (a list of segments). */
CsScanTree.isUnder = function(rel, prefix) {
    var parts = String(rel).split("/");
    if (parts.length - 1 < prefix.length) {
        return false;
    }
    for (var i = 0; i < prefix.length; i++) {
        if (parts[i] !== prefix[i]) {
            return false;
        }
    }
    return true;
};

/**
 * The folder names one level below `prefix`, sorted the way a caver
 * reads them.
 *
 * Distinct, because a folder holding thirty pages is still one folder.
 */
CsScanTree.foldersAt = function(files, prefix) {
    var seen = {};
    var out = [];
    for (var i = 0; i < files.length; i++) {
        var rel = String(files[i]);
        if (!CsScanTree.isUnder(rel, prefix)) {
            continue;
        }
        var parts = rel.split("/");
        if (parts.length - 1 <= prefix.length) {
            continue;            // a file at this level, not a folder
        }
        var name = parts[prefix.length];
        if (seen[name] !== true) {
            seen[name] = true;
            out.push(name);
        }
    }
    out.sort(CsCave.compareNatural);
    return out;
};

/**
 * The pages sitting DIRECTLY in `prefix` -- not in its subfolders.
 *
 * Directly, because the level combos are how you reach a subfolder:
 * listing a folder's whole subtree here would put the same page in two
 * places and undo the cascade.
 */
CsScanTree.filesAt = function(files, prefix) {
    var out = [];
    for (var i = 0; i < files.length; i++) {
        var rel = String(files[i]);
        if (!CsScanTree.isUnder(rel, prefix)) {
            continue;
        }
        if (rel.split("/").length - 1 !== prefix.length) {
            continue;
        }
        out.push(rel);
    }
    out.sort(CsCave.compareNatural);
    return out;
};

/** The last segment of a relative path -- what a page is called. */
CsScanTree.nameOf = function(rel) {
    var text = String(isNull(rel) ? "" : rel);
    var at = text.lastIndexOf("/");
    return at < 0 ? text : text.substring(at + 1);
};

/**
 * Decides which of `rels` are pages a caver should see.
 *
 * HERE, IN THE PURE MODEL, and not beside the listing in CsScanList:
 * CsScanList is a QTableWidget renderer that the unit suite cannot
 * load at all, and a rule about which files are pages is exactly the
 * kind of thing that needs a test. CsScanList.scanFiles walks the
 * folder and hands the answer through this.
 *
 * Testable without a folder on disk:
 * `pageCountOf` is handed in, and a test passes a function that answers
 * from a table instead of opening a PDF.
 *
 * \param rels         relative paths, as CsCave.filesUnder answers them
 * \param pageCountOf  function(rel) -> page count of that PDF
 * 
eturn the kept paths, input order. Pure.
 */
CsScanTree.keepScans = function(rels, pageCountOf) {
    var out = [];
    for (var i = 0; i < rels.length; i++) {
        var rel = String(rels[i]);
        var base = rel.substring(rel.lastIndexOf("/") + 1);
        try {
            if (CsCave.isPreviewName && CsCave.isPreviewName(base)) {
                continue;
            }
        } catch (ePrev) {
        }
        try {
            if (CsScanTrim.isTrimPath(rel)) {
                continue;
            }
        } catch (eTrim) {
        }
        if (CsScanPdf.isPdfPath(rel)) {
            var pages = 0;
            try {
                pages = pageCountOf(rel);
            } catch (eCount) {
                pages = 0;
            }
            if (CsScanPdf.splitState(rel, rels, pages) === "complete") {
                continue;   // its pages are the trip now
            }
        }
        out.push(rel);
    }
    return out;
};
