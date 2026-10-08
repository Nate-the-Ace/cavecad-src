// CsSymbolStore.js -- the symbol blocks themselves: where they live,
// how one is read out of the template, how one is copied into a
// drawing that has never seen it, and how a caver's own symbol is
// written back.
//
// Part of the Cave Survey Core library. QCAD context only -- everything
// here touches RDocument, RBlock or the file system.
//
// THE DIVISION OF LABOUR WITH CsSymbols. CsSymbols is the CATALOGUE:
// pure data naming the 28 symbols the suite ships, plus insert(), which
// places one. This file is the LIBRARY: it opens
// NSS_Cave_Template_PLAN.dxf, lists what is actually in there, copies a
// block definition between documents, and saves a new one. The panel
// never opens a file; this file never builds a widget.
//
// WHY THE TEMPLATE AND NOT A LIBRARY FOLDER. Nathan's call (2026-09-06):
// a custom symbol goes into the template, so every drawing started
// afterwards carries it, and there is exactly one place to look for the
// vocabulary of a cave map. The cost is stated plainly rather than
// engineered around -- tools/publish.sh copies templates/ into the Cave
// folder on every release, so a release can overwrite a customised
// template and take the custom symbols with it. Accepted; a caver who
// wants them back redraws them, and the built-in 28 are never at risk
// because they are code.
//
// HOW A CUSTOM SYMBOL DESCRIBES ITSELF. Not in a sidecar file and not
// in a table in this add-on -- inside the block. Each custom block
// definition carries one invisible marker point on CTRL-HIDDEN tagged
// with its display name, category and home layer (MARKER_TAGS below).
// So a block copied into a drawing that never saw the template arrives
// knowing which category it belongs to and which layer it goes on, and
// there is no second record to keep in step with the first.

var CsSymbolStore = {};

/** The template file name. One spelling, used by every lookup. */
CsSymbolStore.TEMPLATE_NAME = "NSS_Cave_Template_PLAN.dxf";

/**
 * This file's folder, captured AT INCLUDE TIME -- see CsHandbook.BASE.
 * includeBasePath read inside a function names whatever was included
 * last, so the shipped template beside the add-on was never found; only
 * the ~/Documents/Cave/templates fallback on a publish.sh machine hid it.
 */
CsSymbolStore.BASE = (typeof(includeBasePath) === "undefined") ?
    "" : String(includeBasePath);

/** Every symbol block name starts with this, custom ones included.
 *  It is what list() filters the template's block table by, so a symbol
 *  is recognisable as one without consulting any catalogue. */
CsSymbolStore.PREFIX = "SYM_";

/** Every area PATTERN block name starts with this -- CsArea.CATALOG's
 *  own scatter blocks (AREA_STIPPLE, AREA_PEBBLE, ...) already used it
 *  before a caver could draw one; Task 11 gives a custom pattern the
 *  same vocabulary. Kept apart from PREFIX/list() rather than folded
 *  into that filter: list() feeds the SYMBOL palette, and a widened
 *  filter there would show a scatter block like AREA_STIPPLE in that
 *  palette as an anonymous symbol the day this constant existed. See
 *  customAreaPatterns() for the area-pattern equivalent of list(). */
CsSymbolStore.AREA_PREFIX = "AREA_";

/**
 * True when `name` starts with `prefix`. The ONE primitive both
 * saveBlock's SYM_ refusal and saveAreaPattern's AREA_ refusal call --
 * not a single "accepts either" guard shared between them, which is
 * what Task 11 shipped first and which was wrong: it let an AREA_ name
 * through saveBlock, which then wrote SYMBOL marker tags onto it
 * (MARKER_TAGS, not AREA_MARKER_TAGS) and produced a block invisible to
 * BOTH list() (SYM_-only) and customAreaPatterns() (needs an
 * AreaCustom marker) -- an orphan neither palette could see, edit or
 * delete. Each save path checks its OWN prefix against this one
 * function instead, so there is exactly one implementation of "does
 * this name start with X" to get right, and a name matching neither
 * prefix -- or the WRONG one for the path it came through -- is always
 * refused.
 */
CsSymbolStore.hasPrefix = function(name, prefix) {
    return !isNull(name) && String(name).indexOf(prefix) === 0;
};

/** The layer the self-describing marker point sits on inside a block.
 *  CTRL-HIDDEN is off in every drawing (CsLayers.OFF), which is what
 *  keeps the marker from printing. */
CsSymbolStore.MARKER_LAYER = "CTRL-HIDDEN";

/** The tags the marker carries. Their own names, not the ones a placed
 *  symbol would use, because these describe the BLOCK DEFINITION and
 *  travel inside it -- a reference placed in the drawing carries none
 *  of them. */
CsSymbolStore.MARKER_TAGS = {
    nss: "SymbolNss",
    uis: "SymbolUis",
    category: "SymbolCategory",
    layer: "SymbolLayer",
    custom: "SymbolCustom"
};

/** The tags a CUSTOM AREA PATTERN's marker carries -- its own
 *  vocabulary, never MARKER_TAGS above. A symbol's marker and a
 *  pattern's marker are read back by two different callers
 *  (CsSymbolStore.list for the Symbol palette, CsArea.merged for the
 *  Areas palette) that must never mistake one block's description for
 *  the other's -- sharing a tag set would make that mistake free. */
CsSymbolStore.AREA_MARKER_TAGS = {
    name: "AreaName",
    layer: "AreaLayer",
    placement: "AreaPlacement",
    density: "AreaDensity",
    scaleMin: "AreaScaleMin",
    scaleMax: "AreaScaleMax",
    rotate: "AreaRotate",
    // The caver's own "what is it?" line -- optional (an empty tag is a
    // valid answer, not a missing one), and read back into the same
    // `help` field CsArea.CATALOG's built-ins carry, so a tile's
    // tooltip never has to know whether it is looking at a shipped
    // pattern or a caver's own.
    help: "AreaHelp",
    custom: "AreaCustom"
};

/** Where a custom symbol lands when its saved metadata names no
 *  category. Its own group rather than being scattered into an existing
 *  one: a symbol whose category was lost is easier to find under a
 *  heading that says so. */
CsSymbolStore.DEFAULT_CATEGORY = "Custom";

/** list() results, keyed by template path. Opening and parsing the
 *  template is a file read plus a full DXF import; the panel asks for
 *  this list on every rebuild. invalidate() drops it after a save. */
CsSymbolStore.cache = {};

/** How many times invalidate() has run this session. A counter and not
 *  a flag, so a caller comparing it against the value it last read
 *  cannot miss a save that happened between two of its own reads. */
CsSymbolStore.generation = 0;

/** Symbol radii, keyed by template path then block name, filled by
 *  list() while it already has the template open. Dragging a symbol
 *  out asks for one per placement, and reopening a DXF per mouse
 *  gesture is not a thing this tool is allowed to do. */
CsSymbolStore.radii = {};

/** customAreaPatterns() results, keyed by library path -- the AREA_
 *  equivalent of `cache` above, and cleared by the SAME invalidate()
 *  call. Kept in its own dict rather than folded into `cache`: the two
 *  hold differently-shaped entries (a symbol's {nss, uis, category,
 *  layer} against a pattern's {name, layer, placement, density, ...}),
 *  and CsArea.merged() must never read a stale copy of the customPath()
 *  file just because CsSymbolStore.list() happened to cache one for the
 *  Symbol palette first. */
CsSymbolStore.areaCache = {};

/**
 * The template file, or null when there is none.
 *
 * The same two-place lookup CaveTemplateApply uses, in the same order,
 * deliberately: a build carries the template beside the add-on, and a
 * repo checkout has only the published Cave folder. A third candidate
 * -- the CaveSurvey/TemplatePath setting -- sits between them so a
 * caver who has moved their templates is not overruled by a stale copy
 * inside an old build.
 */
CsSymbolStore.templatePath = function() {
    var candidates = [];
    try {
        candidates.push(CsSymbolStore.BASE + "/../Templates/" +
            CsSymbolStore.TEMPLATE_NAME);
    } catch (eBase) {
        // no includeBasePath in this context; the other two still work
    }
    try {
        var setting = RSettings.getStringValue("CaveSurvey/TemplatePath", "");
        if (setting !== "") {
            candidates.push(setting);
        }
    } catch (eSet) {
    }
    try {
        candidates.push(QDir.homePath() + "/Documents/Cave/templates/" +
            CsSymbolStore.TEMPLATE_NAME);
    } catch (eHome) {
    }

    for (var i = 0; i < candidates.length; i++) {
        try {
            if (new QFileInfo(candidates[i]).exists()) {
                return candidates[i];
            }
        } catch (eEx) {
        }
    }
    return null;
};

/**
 * The caver's OWN symbol library: the file their symbols live in.
 *
 * NOT THE TEMPLATE ANY MORE (Nathan's call, 2026-09-07). Symbols used
 * to be written into NSS_Cave_Template_PLAN.dxf, which every release
 * replaces wholesale -- a cost accepted on 2026-09-06 that destroyed a
 * drawn-and-saved symbol within the day, because a development machine
 * publishes many times an evening. publish.sh carries custom blocks
 * across now, but a file no installer touches is the honest answer: a
 * caver's own work should not depend on a merge step running.
 *
 * IN THE CAVE FOLDER, beside their caves, because that folder is the
 * one that syncs and gets backed up -- a symbol drawn on one machine
 * turns up on the next, and neither an upgrade nor a reinstall is a
 * risk to it.
 */
CsSymbolStore.CUSTOM_NAME = "CaveCustomSymbols.dxf";

CsSymbolStore.customPath = function() {
    try {
        var setting = RSettings.getStringValue("CaveSurvey/SymbolLibrary", "");
        if (setting !== "") {
            return setting;
        }
    } catch (eSet) {
    }
    try {
        return QDir.homePath() + "/Documents/Cave/symbols/" +
            CsSymbolStore.CUSTOM_NAME;
    } catch (eHome) {
        return null;
    }
};

/**
 * Makes sure the library file exists, creating an empty drawing the
 * first time a caver saves a symbol.
 *
 * \return the path, or null when it could not be made.
 */
CsSymbolStore.ensureCustomFile = function() {
    var path = CsSymbolStore.customPath();
    if (isNull(path)) {
        return null;
    }
    try {
        if (new QFileInfo(path).exists()) {
            return path;
        }
    } catch (eEx) {
        return null;
    }
    try {
        var dir = path.substring(0, path.lastIndexOf("/"));
        new QDir().mkpath(dir);
        var di = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), createSpatialIndex()));
        if (!CsSymbolStore.write(di, path)) {
            return null;
        }
    } catch (eMake) {
        return null;
    }
    return path;
};

/** Every place templatePath() looked, for an error message that tells
 *  the caver where to put the file rather than only that it is absent. */
CsSymbolStore.searchedPaths = function() {
    var out = [];
    try {
        out.push(CsSymbolStore.BASE + "/../Templates/" +
            CsSymbolStore.TEMPLATE_NAME);
    } catch (eBase) {
    }
    try {
        out.push(QDir.homePath() + "/Documents/Cave/templates/" +
            CsSymbolStore.TEMPLATE_NAME);
    } catch (eHome) {
    }
    return out;
};

/**
 * Opens a drawing into a throwaway in-memory document.
 *
 * \return the RDocumentInterface, or null when the file cannot be read.
 *         The caller owns it and must not hand it to the application.
 */
CsSymbolStore.openOffscreen = function(path) {
    var di = null;
    try {
        di = new RDocumentInterface(
            new RDocument(new RMemoryStorage(), createSpatialIndex()));
    } catch (eNew) {
        return null;
    }
    try {
        if (di.importFile(path, "", false) !==
                RDocumentInterface.IoErrorNoError) {
            return null;
        }
    } catch (eImp) {
        return null;
    }
    return di;
};

/**
 * Prepares an entity that came out of ANOTHER document for adding to
 * this one.
 *
 * THE ID IS THE TRAP. An entity queried out of a document carries that
 * document's object id, and RTransaction reads a set id as "this is an
 * edit to the object already stored under it" -- so adding one to a
 * second document fails with "original object not found in storage" and
 * the copy silently lands nothing. Measured 2026-09-06 against a real
 * engine; the fix is the storage's own setObjectId, which is what
 * QCAD's clipboard copy does in C++ for the same reason.
 *
 * Handles are cleared for the same reason one step further on: two
 * entities sharing a DXF handle is a file another program may refuse.
 */
CsSymbolStore.adopt = function(doc, entity) {
    entity.setDocument(doc);
    try {
        doc.getStorage().setObjectId(entity, RObject.INVALID_ID);
    } catch (eId) {
        // a build without setObjectId leaves the id alone, and the add
        // below fails loudly rather than corrupting anything
    }
    try {
        doc.getStorage().setObjectHandle(entity, RObject.INVALID_HANDLE);
    } catch (eHandle) {
    }
    return entity;
};

/**
 * The marker point inside a block definition, or null.
 *
 * By TAG and not by layer or by being the only point: a symbol is
 * free to be drawn out of points, and picking "the first point" would
 * make one of a caver's own dots the metadata carrier.
 */
CsSymbolStore.markerOf = function(doc, blockId) {
    var ids;
    try {
        ids = doc.queryBlockEntities(blockId);
    } catch (eQ) {
        return null;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = null;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eE) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsSymbolStore.MARKER_TAGS.custom) === "1") {
            return e;
        }
    }
    return null;
};

/**
 * Deletes every entity inside a block definition, whatever layer each
 * one sits on.
 *
 * WHY THIS IS NOT A BARE RDeleteObjectsOperation. A block being saved
 * over is emptied first and refilled, and one of the things inside it
 * is the MARKER -- the point on CTRL-HIDDEN carrying the symbol's name,
 * category and home layer. CTRL-HIDDEN is OFF in the registry, and this
 * build SILENTLY REFUSES a delete on an off, frozen or locked layer
 * exactly as it refuses an add (the same measurement that made saving a
 * new symbol wrap its add in withLayerOn, 2026-09-06).
 *
 * So the old marker survived the emptying, the new one was added beside
 * it, and the block ended up with TWO descriptions of itself. Whichever
 * one markerOf reached first is the one the palette showed -- storage
 * order, not the caver's edit -- which is why renaming a custom symbol
 * appeared to do nothing at all, intermittently.
 *
 * Every layer the old entities are on is turned on and unlocked for the
 * delete and put back afterwards, the marker's own layer included.
 *
 * \return the number of entities the block had. Safe on a block that
 *         is already empty.
 */
CsSymbolStore.emptyBlock = function(doc, di, blockId) {
    var oldIds;
    try {
        oldIds = doc.queryBlockEntities(blockId);
    } catch (eQuery) {
        return 0;
    }
    if (oldIds.length === 0) {
        return 0;
    }
    var delOp = new RDeleteObjectsOperation();
    var names = [CsSymbolStore.MARKER_LAYER];
    var seen = {};
    seen[CsSymbolStore.MARKER_LAYER] = true;
    var count = 0;
    for (var d = 0; d < oldIds.length; d++) {
        var old = doc.queryEntity(oldIds[d]);
        if (isNull(old)) {
            continue;
        }
        try {
            var lname = String(old.getLayerName());
            if (lname !== "" && seen[lname] !== true) {
                seen[lname] = true;
                names.push(lname);
            }
        } catch (eLayer) {
            // a layer we cannot name is one we cannot unlock; the
            // delete still goes in, and simply may not take
        }
        delOp.deleteObject(old);
        count++;
    }

    // withLayerUnlocked takes one name, so the list is nested one call
    // deep per layer -- each unlocks, and every one of them is locked
    // again on the way back out, exception or not.
    function unlockThen(i, fn) {
        if (i >= names.length) {
            fn();
            return;
        }
        CsLayers.withLayerUnlocked(doc, di, names[i], function() {
            unlockThen(i + 1, fn);
        });
    }
    try {
        CsLayers.withLayersOn(doc, di, names, function() {
            unlockThen(0, function() {
                di.applyOperation(delOp);
            });
        });
    } catch (eApply) {
        return 0;
    }
    return count;
};

/**
 * The catalogue entry a block definition describes, or null when it
 * carries no marker (i.e. it is one of the shipped set, whose metadata
 * is CsSymbols.CATALOG).
 */
CsSymbolStore.metaOf = function(doc, block) {
    var marker = CsSymbolStore.markerOf(doc, block.getId());
    if (marker === null) {
        return null;
    }
    var t = CsSymbolStore.MARKER_TAGS;
    var name = CsTags.get(marker, t.nss);
    var layer = CsTags.get(marker, t.layer);
    var category = CsTags.get(marker, t.category);
    return {
        block: block.getName(),
        nss: name === "" ? block.getName() : name,
        uis: CsTags.get(marker, t.uis),
        layer: layer === "" ? CsLayers.WALLS_SURVEYED : layer,
        category: category === "" ? CsSymbolStore.DEFAULT_CATEGORY : category,
        custom: true
    };
};

/**
 * The marker point inside a CUSTOM AREA PATTERN block, or null.
 *
 * The AREA_MARKER_TAGS sibling of markerOf above -- separate because a
 * pattern's marker carries AreaCustom, never SymbolCustom, and a block
 * that happens to carry the OTHER kind's marker must not read as this
 * kind's (a block can only ever be one caver-drawn thing).
 */
CsSymbolStore.areaMarkerOf = function(doc, blockId) {
    var ids;
    try {
        ids = doc.queryBlockEntities(blockId);
    } catch (eQ) {
        return null;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = null;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eE) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsSymbolStore.AREA_MARKER_TAGS.custom) === "1") {
            return e;
        }
    }
    return null;
};

/**
 * The area-pattern description a block definition carries, or null
 * when it has no AreaCustom marker -- either a block this tool never
 * wrote, or one of CsArea.CATALOG's own shipped AREA_ blocks (which
 * describe themselves in code, not in a marker point).
 */
CsSymbolStore.areaMetaOf = function(doc, block) {
    var marker = CsSymbolStore.areaMarkerOf(doc, block.getId());
    if (marker === null) {
        return null;
    }
    var t = CsSymbolStore.AREA_MARKER_TAGS;
    var name = CsTags.get(marker, t.name);
    var layer = CsTags.get(marker, t.layer);
    var placement = CsTags.get(marker, t.placement);
    var density = parseFloat(CsTags.get(marker, t.density));
    var scaleMin = parseFloat(CsTags.get(marker, t.scaleMin));
    var scaleMax = parseFloat(CsTags.get(marker, t.scaleMax));
    return {
        block: block.getName(),
        name: name === "" ? block.getName() : name,
        layer: layer === "" ? CsLayers.BREAKDOWN : layer,
        placement: placement === "tile" ? "tile" : "scatter",
        density: isNaN(density) ? 1.0 : density,
        scaleMin: isNaN(scaleMin) ? 0.8 : scaleMin,
        scaleMax: isNaN(scaleMax) ? 1.2 : scaleMax,
        rotate: CsTags.get(marker, t.rotate) === "1",
        // "" for a pattern saved before AreaHelp existed, or one whose
        // caver left the description blank -- both are a fine tooltip,
        // just a shorter one (CsPanel.tipHtml leaves an empty help out
        // rather than printing a blank line).
        help: CsTags.get(marker, t.help),
        custom: true
    };
};

/**
 * Every custom AREA PATTERN in one library-shaped file, as entries
 * areaMetaOf shapes.
 *
 * THE AREA_ SIBLING OF list(), reading the SAME kind of file but never
 * calling list() itself: list()'s own filter is SYM_-only on purpose
 * (see AREA_PREFIX's header) -- a widened list() would hand
 * CsArea.CATALOG's shipped AREA_STIPPLE/AREA_PEBBLE/... blocks back as
 * anonymous "symbols" the moment a template held them, which it always
 * does. So this walks the block table itself, filtering AREA_ and
 * requiring an AreaCustom marker -- a shipped AREA_ block with no
 * marker (every one of CsArea.CATALOG's) is silently skipped, not
 * listed as an anonymous pattern the way list()'s SYM_ fallback would.
 *
 * Cached the same way and cleared by the same invalidate() call, so a
 * caller (CsArea.merged, from inside a placement loop) never reopens
 * the library file per call -- only per save or delete.
 *
 * \return { ok, entries, error } -- entries always an array, even for
 *         a caver who has never saved a pattern (missing file is not
 *         an error: merged() then falls back to the built-ins alone).
 */
CsSymbolStore.customAreaPatterns = function(path) {
    if (isNull(path)) {
        path = CsSymbolStore.customPath();
    }
    if (isNull(path)) {
        return { ok: true, entries: [], error: "" };
    }
    if (CsSymbolStore.areaCache.hasOwnProperty(path)) {
        return CsSymbolStore.areaCache[path];
    }
    var result;
    try {
        if (!new QFileInfo(path).exists()) {
            result = { ok: true, entries: [], error: "" };
            CsSymbolStore.areaCache[path] = result;
            return result;
        }
    } catch (eEx) {
        return { ok: false, entries: [], error:
            "Your symbol library could not be checked: " + path };
    }

    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, entries: [], error:
            "Your symbol library could not be read: " + path };
    }

    result = { ok: true, entries: [], error: "" };
    try {
        var doc = di.getDocument();
        var names = doc.getBlockNames();
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]);
            if (name.indexOf(CsSymbolStore.AREA_PREFIX) !== 0) {
                continue;
            }
            var block = doc.queryBlock(name);
            if (isNull(block)) {
                continue;
            }
            var meta = CsSymbolStore.areaMetaOf(doc, block);
            if (meta === null) {
                continue;   // an AREA_ block with no marker: not a
            }                // pattern this tool ever wrote
            result.entries.push(meta);
        }
    } catch (eList) {
        result = { ok: false, entries: [], error:
            "Your symbol library's block table could not be read (" +
            eList + ")." };
    }

    CsSymbolStore.areaCache[path] = result;
    return result;
};

/**
 * Every SYM_ block in the template, as catalogue-shaped entries.
 *
 * A block the shipped catalogue already names answers with the
 * CATALOGUE's entry, not with anything read out of the file: the 28
 * built-ins are code, and a template that has been edited by hand must
 * not be able to quietly rename or re-layer one of them.
 *
 * \return { ok, entries, error } -- entries is always an array, so a
 *         caller can render a palette from a failure as easily as from
 *         a success.
 */
CsSymbolStore.list = function(path) {
    if (isNull(path)) {
        path = CsSymbolStore.templatePath();
    }
    if (isNull(path)) {
        return { ok: false, entries: [], error:
            "The cave template could not be found. Looked in:\n  " +
            CsSymbolStore.searchedPaths().join("\n  ") };
    }
    if (CsSymbolStore.cache.hasOwnProperty(path)) {
        return CsSymbolStore.cache[path];
    }

    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, entries: [], error:
            "The cave template could not be read: " + path };
    }

    var result = { ok: true, entries: [], error: "" };
    var radii = {};
    try {
        var doc = di.getDocument();
        var names = doc.getBlockNames();
        for (var i = 0; i < names.length; i++) {
            var name = String(names[i]);
            if (name.indexOf(CsSymbolStore.PREFIX) !== 0) {
                continue;
            }
            radii[name] = CsSymbolStore.radiusOfEntities(
                CsSymbolStore.geometryOf(doc, name));
            var known = CsSymbols.byBlock(name);
            if (known !== null) {
                result.entries.push(known);
                continue;
            }
            var block = doc.queryBlock(name);
            if (isNull(block)) {
                continue;
            }
            var meta = CsSymbolStore.metaOf(doc, block);
            if (meta === null) {
                // A SYM_ block with neither a catalogue row nor a
                // marker: something put it there that was not this
                // tool. It is still a symbol and still placeable; it
                // just has nothing to say about itself.
                meta = {
                    block: name, nss: name, uis: "",
                    layer: CsLayers.WALLS_SURVEYED,
                    category: CsSymbolStore.DEFAULT_CATEGORY,
                    custom: true
                };
            }
            result.entries.push(meta);
        }
    } catch (eList) {
        result = { ok: false, entries: [], error:
            "The cave template's block table could not be read (" +
            eList + ")." };
    }

    CsSymbolStore.cache[path] = result;
    CsSymbolStore.radii[path] = radii;
    return result;
};

/**
 * Every symbol the caver can place: the shipped catalogue's blocks from
 * the template, plus their own from the library.
 *
 * TWO FILES, ONE LIST. The template is the suite's vocabulary and is
 * replaced by every release; the library is the caver's own and is
 * touched by nothing but this tool. A symbol in both -- one drawn
 * before the library existed, and carried across upgrades since -- is
 * shown once, the LIBRARY's copy winning, because that is the one an
 * upgrade cannot reach.
 *
 * \return { ok, entries, error } with entries always an array.
 */
CsSymbolStore.listAll = function() {
    var out = { ok: true, entries: [], error: "" };
    var seen = {};
    var i;

    var custom = { ok: true, entries: [], error: "" };
    var customPath = CsSymbolStore.customPath();
    if (!isNull(customPath) && new QFileInfo(customPath).exists()) {
        custom = CsSymbolStore.list(customPath);
    }
    for (i = 0; i < custom.entries.length; i++) {
        seen[custom.entries[i].block] = true;
        out.entries.push(custom.entries[i]);
    }

    var tpl = CsSymbolStore.list(CsSymbolStore.templatePath());
    for (i = 0; i < tpl.entries.length; i++) {
        if (seen[tpl.entries[i].block] === true) {
            continue;
        }
        seen[tpl.entries[i].block] = true;
        out.entries.push(tpl.entries[i]);
    }

    // A failure in EITHER file is worth saying, but neither empties the
    // list: a caver with an unreadable template still has their own
    // symbols, and one with no library still has the shipped set.
    if (!tpl.ok) {
        out.ok = false;
        out.error = tpl.error;
    }
    if (!custom.ok) {
        out.ok = false;
        out.error = (out.error === "" ? "" : out.error + "\n") + custom.error;
    }
    return out;
};

/**
 * Moves any symbol still living in the template into the library.
 *
 * For the caver who drew symbols before the library existed -- and for
 * one whose template was carried across an upgrade with their blocks
 * still in it. Copies first, verifies the copy reads back, and only
 * then takes the template's copy away: a migration that loses work is
 * worse than one that never runs.
 *
 * \return { moved: [names], error } -- moved is empty when there was
 *         nothing to do, which is the ordinary case.
 */
CsSymbolStore.migrateFromTemplate = function() {
    var out = { moved: [], error: "" };
    var tplPath = CsSymbolStore.templatePath();
    if (isNull(tplPath)) {
        return out;
    }
    var tpl = CsSymbolStore.list(tplPath);
    var strays = [];
    for (var i = 0; i < tpl.entries.length; i++) {
        var entry = tpl.entries[i];
        if (CsSymbols.byBlock(entry.block) !== null) {
            continue;   // one of the shipped set: it belongs there
        }
        strays.push(entry);
    }
    if (strays.length === 0) {
        return out;
    }

    var customPath = CsSymbolStore.ensureCustomFile();
    if (isNull(customPath)) {
        out.error = "The symbol library could not be created.";
        return out;
    }
    var srcDi = CsSymbolStore.openOffscreen(tplPath);
    if (srcDi === null) {
        out.error = "The cave template could not be read.";
        return out;
    }
    var srcDoc = srcDi.getDocument();

    for (i = 0; i < strays.length; i++) {
        var name = strays[i].block;
        var already = CsSymbolStore.list(customPath);
        var have = false;
        for (var j = 0; j < already.entries.length; j++) {
            if (already.entries[j].block === name) {
                have = true;
            }
        }
        if (!have) {
            var entities = CsSymbolStore.geometryOf(srcDoc, name);
            if (entities.length === 0) {
                continue;
            }
            var meta = CsSymbolStore.metaOf(srcDoc, srcDoc.queryBlock(name));
            if (isNull(meta)) {
                meta = { nss: name, uis: "",
                    category: CsSymbolStore.DEFAULT_CATEGORY,
                    layer: CsLayers.WALLS_SURVEYED };
            }
            var res = CsSymbolStore.saveBlock(customPath, name, srcDoc,
                entities, meta);
            if (!res.ok) {
                out.error = res.error;
                continue;
            }
        }
        // Only now, with the library's copy on disk and readable, is
        // the template's copy removed.
        CsSymbolStore.invalidate();
        var check = CsSymbolStore.list(customPath);
        var landed = false;
        for (j = 0; j < check.entries.length; j++) {
            if (check.entries[j].block === name) {
                landed = true;
            }
        }
        if (!landed) {
            out.error = name + " could not be moved into the library.";
            continue;
        }
        CsSymbolStore.deleteBlock(tplPath, name);
        out.moved.push(name);
    }
    CsSymbolStore.invalidate();
    return out;
};

/** Forgets the cached listing, so the next list() reads the file again.
 *  Called after any write; called with no path, forgets everything. */
CsSymbolStore.invalidate = function(path) {
    // BUMPED ON EVERY INVALIDATION, whole-store or one file. A caller
    // that caches something DERIVED from these files (SymbolPalette's
    // rendered tile shapes) keeps the generation it read at and throws
    // its own cache away when this moves -- without having to know
    // which paths this store keeps or when a save touched them.
    CsSymbolStore.generation = (isNull(CsSymbolStore.generation) ? 0 :
        CsSymbolStore.generation) + 1;
    if (isNull(path)) {
        CsSymbolStore.cache = {};
        CsSymbolStore.radii = {};
        CsSymbolStore.areaCache = {};
        return;
    }
    if (CsSymbolStore.cache.hasOwnProperty(path)) {
        delete CsSymbolStore.cache[path];
    }
    if (CsSymbolStore.radii.hasOwnProperty(path)) {
        delete CsSymbolStore.radii[path];
    }
    if (CsSymbolStore.areaCache.hasOwnProperty(path)) {
        delete CsSymbolStore.areaCache[path];
    }
};

/**
 * The entities of one block definition, cloned out of a document.
 *
 * The marker point is left OUT: it is metadata, and every caller here
 * wants the drawing. Callers that want the metadata call metaOf.
 *
 * \return an array of entities belonging to `doc`. Empty when the block
 *         is missing or holds nothing.
 */
CsSymbolStore.geometryOf = function(doc, blockName) {
    var out = [];
    var block = null;
    try {
        block = doc.queryBlock(blockName);
    } catch (eB) {
        return out;
    }
    if (isNull(block)) {
        return out;
    }
    var ids;
    try {
        ids = doc.queryBlockEntities(block.getId());
    } catch (eQ) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        var e = null;
        try {
            e = doc.queryEntity(ids[i]);
        } catch (eE) {
            continue;
        }
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsSymbolStore.MARKER_TAGS.custom) === "1") {
            continue;
        }
        out.push(e);
    }
    return out;
};

/**
 * How big a symbol is at scale 1: half the larger side of its own
 * bounding box, in drawing units.
 *
 * WHAT IT IS FOR. Dragging a symbol out sets its SIZE as well as its
 * angle, and "size" has to mean something the caver can see -- the
 * distance from where they pressed to where the cursor is IS the
 * symbol's radius. That only works if each symbol knows how big it
 * draws itself: a stalactite half a unit across and a north arrow ten
 * units across must both end up the size the drag asked for.
 *
 * Zero for a block with no geometry, and callers treat zero as "no
 * answer" rather than dividing by it.
 */
CsSymbolStore.radiusOfEntities = function(entities) {
    var minX = null, minY = null, maxX = null, maxY = null;
    for (var i = 0; i < entities.length; i++) {
        var bb = null;
        try {
            entities[i].update();
            bb = entities[i].getBoundingBox();
        } catch (eBox) {
            continue;
        }
        if (isNull(bb)) {
            continue;
        }
        try {
            var lo = bb.getMinimum(), hi = bb.getMaximum();
            if (isNaN(lo.x) || isNaN(hi.x) || isNaN(lo.y) || isNaN(hi.y)) {
                continue;
            }
            if (minX === null || lo.x < minX) { minX = lo.x; }
            if (minY === null || lo.y < minY) { minY = lo.y; }
            if (maxX === null || hi.x > maxX) { maxX = hi.x; }
            if (maxY === null || hi.y > maxY) { maxY = hi.y; }
        } catch (eRead) {
        }
    }
    if (minX === null) {
        return 0;
    }
    var half = Math.max(maxX - minX, maxY - minY) / 2;
    return (isNaN(half) || half <= 0) ? 0 : half;
};

/**
 * The symbol's radius, from THIS drawing when it holds the block and
 * from the template's cached listing otherwise.
 *
 * The drawing first, deliberately: a caver who redefined a block in
 * their own drawing means the shape that is in front of them.
 */
CsSymbolStore.radiusOf = function(doc, blockName) {
    if (!isNull(doc)) {
        try {
            if (!isNull(doc.queryBlock(blockName))) {
                var here = CsSymbolStore.radiusOfEntities(
                    CsSymbolStore.geometryOf(doc, blockName));
                if (here > 0) {
                    return here;
                }
            }
        } catch (eDoc) {
        }
    }
    // Filled by list(), which already has the file open -- asking here
    // must never open one a second time per placement. Both files are
    // consulted, the caver's own first.
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[p]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        CsSymbolStore.list(places[p]);
        var byPath = CsSymbolStore.radii[places[p]];
        if (!isNull(byPath) && byPath.hasOwnProperty(blockName) &&
                byPath[blockName] > 0) {
            return byPath[blockName];
        }
    }
    return 0;
};

/**
 * Runs `fn` with every named layer switched on and unlocked, and puts
 * them all back afterwards.
 *
 * AN ADD ONTO AN OFF, FROZEN OR LOCKED LAYER IS DROPPED SILENTLY in
 * this build. A symbol's own geometry is on a visible feature layer, but
 * its marker point is on CTRL-HIDDEN, which the registry keeps off --
 * so copying a block one entity at a time quietly left the description
 * behind and the symbol arrived anonymous. Measured twice now: once
 * when saving, once when carrying symbols across a template upgrade.
 *
 * Nested rather than looped because CsLayers gives one layer at a time;
 * the recursion is at most as deep as a block has layers, which is one
 * or two.
 */
CsSymbolStore.withLayersWritable = function(doc, di, names, fn) {
    if (isNull(names) || names.length === 0) {
        return fn();
    }
    var head = names[0];
    var rest = names.slice(1);
    return CsLayers.withLayerOn(doc, di, head, function() {
        return CsLayers.withLayerUnlocked(doc, di, head, function() {
            return CsSymbolStore.withLayersWritable(doc, di, rest, fn);
        });
    });
};

/**
 * A symbol's geometry, from whichever file holds it.
 *
 * The caver's library first, then the template -- the same order every
 * other lookup uses, because a symbol in both is theirs.
 *
 * \return { entities, doc, path } (entities belong to doc, which the
 *         caller must keep alive while it uses them), or null.
 */
CsSymbolStore.geometryFor = function(blockName) {
    var places = [CsSymbolStore.customPath(), CsSymbolStore.templatePath()];
    for (var i = 0; i < places.length; i++) {
        if (isNull(places[i])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[i]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var di = CsSymbolStore.openOffscreen(places[i]);
        if (di === null) {
            continue;
        }
        var doc = di.getDocument();
        if (isNull(doc.queryBlock(blockName))) {
            continue;
        }
        var entities = CsSymbolStore.geometryOf(doc, blockName);
        if (entities.length === 0) {
            continue;
        }
        // The interface is returned with it: dropping it would take the
        // document -- and the entities -- with it.
        return { entities: entities, doc: doc, di: di, path: places[i] };
    }
    return null;
};

/**
 * Copies a block definition from one document into another.
 *
 * WHY BY HAND AND NOT BY PASTE. RPasteOperation takes a whole source
 * DOCUMENT, and the source here is the template -- pasting it would
 * bring the entire NSS sheet along with the one symbol. RDocument's
 * copyToDocument is commented out of the header and unavailable to
 * script. So the entities are cloned across one at a time, which is
 * fine because a symbol is a handful of lines.
 *
 * THE ID REMAP IS THE WHOLE JOB. An entity carries LAYER and BLOCK ids,
 * and an id means nothing outside the document that issued it. Layers
 * are re-resolved BY NAME and created where missing (through
 * CsLayers.ensure, so a layer this drawing has never had still arrives
 * with the registry's appearance rather than the white fallback), and
 * the block id is set to the freshly created block. Colour and
 * linetype in the template's symbols are ByLayer, which is an enum
 * rather than an id and needs no translation.
 *
 * \return { ok, error } -- and on success `doc` has the block.
 */
CsSymbolStore.copyBlock = function(srcDoc, doc, di, blockName) {
    var src = null;
    try {
        src = srcDoc.queryBlock(blockName);
    } catch (eS) {
        src = null;
    }
    if (isNull(src)) {
        return { ok: false, error: "The template has no block named " +
            blockName + "." };
    }

    var ids = [];
    try {
        ids = srcDoc.queryBlockEntities(src.getId());
    } catch (eQ) {
        return { ok: false, error: "The template's " + blockName +
            " could not be read." };
    }

    // The layers the definition's entities sit on. Ensured BEFORE the
    // block is created, in their own operation: CsLayers.ensure applies
    // its own operation, and interleaving that with the block's add
    // would split the block across two undo steps.
    var layerNames = {};
    var i, e;
    for (i = 0; i < ids.length; i++) {
        try {
            e = srcDoc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            layerNames[String(srcDoc.getLayerName(e.getLayerId()))] = true;
        } catch (eL) {
        }
    }
    for (var lname in layerNames) {
        if (!layerNames.hasOwnProperty(lname)) {
            continue;
        }
        try {
            CsLayers.ensure(doc, di, lname);
        } catch (eEnsure) {
            // a layer we cannot create leaves its entities on whatever
            // getLayerId answers below; the symbol still draws
        }
    }

    var blockId;
    try {
        var block = new RBlock(doc, blockName, new RVector(0, 0));
        var blockOp = new RAddObjectOperation(block);
        di.applyOperation(blockOp);
        blockId = doc.getBlockId(blockName);
    } catch (eAdd) {
        return { ok: false, error: "This drawing refused a block named " +
            blockName + " (" + eAdd + ")." };
    }
    if (isNull(blockId) || blockId === RObject.INVALID_ID) {
        return { ok: false, error: "This drawing refused a block named " +
            blockName + "." };
    }

    var op = new RAddObjectsOperation();
    var moved = 0;
    for (i = 0; i < ids.length; i++) {
        try {
            e = srcDoc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            var wantLayer = String(srcDoc.getLayerName(e.getLayerId()));
            // The order matters: adopt re-points the entity at the
            // target document and clears the id it carried out of the
            // source one, and every id set after it is then read
            // against the right table.
            CsSymbolStore.adopt(doc, e);
            e.setBlockId(blockId);
            var lid = doc.getLayerId(wantLayer);
            if (!isNull(lid) && lid !== RObject.INVALID_ID) {
                e.setLayerId(lid);
            }
            op.addObject(e, false);
            moved++;
        } catch (eCopy) {
            // one entity short is a symbol missing a line, which is
            // visible; refusing the whole copy over it is not better
        }
    }
    if (moved === 0) {
        return { ok: false, error: "The template's " + blockName +
            " holds no geometry to copy." };
    }
    // THROUGH EVERY LAYER THE BLOCK USES, on and unlocked. The marker
    // point lives on CTRL-HIDDEN, which is off in the registry, and an
    // add onto an off layer is dropped without a word -- so this used
    // to copy the drawing and leave the description behind, and the
    // symbol arrived in its new home anonymous.
    var involved = [];
    for (var lname2 in layerNames) {
        if (layerNames.hasOwnProperty(lname2)) {
            involved.push(lname2);
        }
    }
    try {
        CsSymbolStore.withLayersWritable(doc, di, involved, function() {
            di.applyOperation(op);
        });
    } catch (eApply) {
        return { ok: false, error: "This drawing refused " + blockName +
            "'s geometry (" + eApply + ")." };
    }
    return { ok: true, error: "" };
};

/**
 * Makes sure `doc` has the named symbol block, fetching it from the
 * template when it does not.
 *
 * This is what lets the palette work in a drawing that was never
 * started from the template -- and in one started from an older
 * template, which is every drawing made before a symbol was invented.
 *
 * \return { ok, imported, error }
 */
CsSymbolStore.ensureBlock = function(doc, di, blockName, path) {
    try {
        if (!isNull(doc.queryBlock(blockName))) {
            return { ok: true, imported: false, error: "" };
        }
    } catch (eHas) {
    }

    // EITHER FILE holds the answer: the caver's own library, or the
    // template the suite ships. The library is asked first -- a symbol
    // in both is theirs, and theirs is the copy an upgrade cannot
    // reach.
    var places = isNull(path) ?
        [CsSymbolStore.customPath(), CsSymbolStore.templatePath()] : [path];
    var lastError = "";
    for (var p = 0; p < places.length; p++) {
        if (isNull(places[p])) {
            continue;
        }
        try {
            if (!new QFileInfo(places[p]).exists()) {
                continue;
            }
        } catch (eEx) {
            continue;
        }
        var srcDi = CsSymbolStore.openOffscreen(places[p]);
        if (srcDi === null) {
            lastError = "Could not read " + places[p];
            continue;
        }
        if (isNull(srcDi.getDocument().queryBlock(blockName))) {
            continue;   // not in this one; try the next
        }
        var res = CsSymbolStore.copyBlock(srcDi.getDocument(), doc, di,
            blockName);
        if (res.ok) {
            return { ok: true, imported: true, error: "" };
        }
        lastError = res.error;
    }
    return { ok: false, imported: false, error: lastError !== "" ? lastError :
        "This drawing does not have the " + blockName + " symbol, and " +
        "neither your symbol library nor the cave template has it either." };
};

/**
 * A display name reduced to its BLOCK-NAME CORE: upper-cased, with
 * every run of non-alphanumerics turned into one underscore and
 * trimmed off the ends. Pure, and shared by blockNameFor (SYM_) and
 * AreaFillEdit's own AREA_ names -- one slugging rule for both, so
 * "Rimstone dam" always becomes RIMSTONE_DAM whichever prefix goes in
 * front of it.
 *
 * Also DOUBLES as CsArea.merged()'s catalogue key for a custom pattern
 * -- the same reason a caver's pattern named "Sand" collides with the
 * shipped SAND entry (and loses) rather than living beside it under a
 * different spelling of the same word.
 *
 * A name that reduces to nothing answers null rather than an empty
 * string, which would be a block or a key called after nothing.
 */
CsSymbolStore.slugFor = function(displayName) {
    if (isNull(displayName)) {
        return null;
    }
    var core = String(displayName).toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+/, "").replace(/_+$/, "");
    return core.length === 0 ? null : core;
};

/**
 * The block name a display name becomes: SYM_ plus its slug.
 *
 * Deliberately lossy in the same direction as the shipped names --
 * "Rimstone dam" is SYM_RIMSTONE_DAM. A name that reduces to nothing
 * answers null rather than SYM_, which would be a block called after
 * nothing.
 */
CsSymbolStore.blockNameFor = function(displayName) {
    var core = CsSymbolStore.slugFor(displayName);
    return core === null ? null : CsSymbolStore.PREFIX + core;
};

/**
 * Writes a symbol into the template: creates the block, or replaces the
 * geometry of one that is already there.
 *
 * `entities` belong to some OTHER document (the editor tab), and are
 * cloned across the same way copyBlock clones the other direction.
 * `meta` is {nss, uis, category, layer}.
 *
 * REFUSES TO TOUCH A SHIPPED SYMBOL. The 28 built-ins are named by
 * CsSymbols.CATALOG, which ships with the add-on; a divergent block in
 * the template under one of those names would be taken back silently by
 * the next release, and until then the legend and the catalogue would
 * describe geometry that is not there.
 *
 * \return { ok, error, replaced }
 */
CsSymbolStore.saveBlock = function(path, blockName, srcDoc, entities, meta) {
    if (isNull(path)) {
        // THE LIBRARY, not the template: a caver's own symbol goes in
        // the file no installer touches. Callers may still name a file
        // (the migration hands one in, and so do the tests).
        path = CsSymbolStore.ensureCustomFile();
    }
    if (isNull(path)) {
        return { ok: false, replaced: false, error:
            "Your symbol library could not be created at " +
            CsSymbolStore.customPath() + ", so there is nowhere to save " +
            "the symbol." };
    }
    if (!CsSymbolStore.hasPrefix(blockName, CsSymbolStore.PREFIX)) {
        return { ok: false, replaced: false, error:
            "A symbol's block name must start with " +
            CsSymbolStore.PREFIX + "." };
    }
    if (CsSymbols.byBlock(blockName) !== null) {
        return { ok: false, replaced: false, error:
            blockName + " is one of the symbols the suite ships. Give " +
            "yours a different name -- an edited copy of a shipped symbol " +
            "would be overwritten by the next CaveCAD update." };
    }
    if (isNull(entities) || entities.length === 0) {
        return { ok: false, replaced: false, error:
            "There is nothing to save: draw the symbol first." };
    }

    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, replaced: false, error:
            "The cave template could not be read: " + path };
    }
    var doc = di.getDocument();

    var replaced = false;
    var blockId;
    try {
        var existing = doc.queryBlock(blockName);
        if (!isNull(existing)) {
            replaced = true;
            blockId = existing.getId();
            CsSymbolStore.emptyBlock(doc, di, blockId);
        } else {
            var block = new RBlock(doc, blockName, new RVector(0, 0));
            di.applyOperation(new RAddObjectOperation(block));
            blockId = doc.getBlockId(blockName);
        }
    } catch (eBlock) {
        return { ok: false, replaced: false, error:
            "The template refused a block named " + blockName +
            " (" + eBlock + ")." };
    }
    if (isNull(blockId) || blockId === RObject.INVALID_ID) {
        return { ok: false, replaced: false, error:
            "The template refused a block named " + blockName + "." };
    }

    // The home layer has to EXIST in the template, or the geometry
    // lands on whatever getLayerId answers for a name that is not
    // there. ensure() gives it the registry's appearance.
    try {
        CsLayers.ensure(doc, di, meta.layer);
        CsLayers.ensure(doc, di, CsSymbolStore.MARKER_LAYER);
    } catch (eEnsure) {
    }

    var op = new RAddObjectsOperation();
    var copied = 0;
    for (var i = 0; i < entities.length; i++) {
        try {
            var e = entities[i];
            if (isNull(e)) {
                continue;
            }
            CsSymbolStore.adopt(doc, e);
            e.setBlockId(blockId);
            var lid = doc.getLayerId(meta.layer);
            if (!isNull(lid) && lid !== RObject.INVALID_ID) {
                e.setLayerId(lid);
            }
            op.addObject(e, false);
            copied++;
        } catch (eCopy) {
        }
    }
    if (copied === 0) {
        return { ok: false, replaced: replaced, error:
            "None of the symbol's geometry could be written into the " +
            "template." };
    }

    // The marker: the block's own record of what it is. Added in the
    // SAME operation as the geometry, so a block can never exist in a
    // state where the drawing is there and the metadata is not.
    try {
        var marker = new RPointEntity(doc,
            new RPointData(new RVector(0, 0)));
        marker.setBlockId(blockId);
        var mlid = doc.getLayerId(CsSymbolStore.MARKER_LAYER);
        if (!isNull(mlid) && mlid !== RObject.INVALID_ID) {
            marker.setLayerId(mlid);
        }
        var t = CsSymbolStore.MARKER_TAGS;
        CsTags.set(marker, t.custom, "1");
        CsTags.set(marker, t.nss, meta.nss);
        CsTags.set(marker, t.uis, meta.uis);
        CsTags.set(marker, t.category, meta.category);
        CsTags.set(marker, t.layer, meta.layer);
        op.addObject(marker, false);
    } catch (eMarker) {
        return { ok: false, replaced: replaced, error:
            "The symbol's own description could not be written (" +
            eMarker + "), so nothing was saved -- a symbol with no " +
            "category or layer would be unplaceable." };
    }

    // THE MARKER'S OWN LAYER REFUSES IT. CTRL-HIDDEN is off in the
    // registry (CsLayers.OFF) and this build silently drops an add onto
    // an off, frozen or locked layer -- measured 2026-09-06, when the
    // geometry landed and the marker did not, and every custom symbol
    // came back from the file anonymous. The whole operation goes
    // through withLayerOn/withLayerUnlocked so the block and its
    // description arrive together or not at all.
    try {
        CsLayers.withLayerOn(doc, di, CsSymbolStore.MARKER_LAYER,
            function() {
                CsLayers.withLayerUnlocked(doc, di,
                    CsSymbolStore.MARKER_LAYER, function() {
                        di.applyOperation(op);
                    });
            });
    } catch (eApply) {
        return { ok: false, replaced: replaced, error:
            "The template refused the symbol's geometry (" + eApply + ")." };
    }
    if (CsSymbolStore.markerOf(doc, blockId) === null) {
        return { ok: false, replaced: replaced, error:
            "The symbol was not saved: the template would not accept its " +
            "description, and a symbol with no category or layer cannot " +
            "be placed." };
    }

    if (!CsSymbolStore.write(di, path)) {
        return { ok: false, replaced: replaced, error:
            "The template could not be written: " + path + "\nCheck that " +
            "the file is not open elsewhere and that you can write to it." };
    }
    CsSymbolStore.invalidate(path);
    return { ok: true, replaced: replaced, error: "" };
};

/**
 * Writes a CUSTOM AREA PATTERN into the caver's library: creates the
 * block, or replaces the geometry of one that is already there, and
 * stamps it with the marker CsArea.merged() reads back.
 *
 * A SIBLING OF saveBlock, not a reuse of it -- deliberately, even
 * though the two bodies rhyme closely. A pattern's marker carries a
 * different vocabulary (AREA_MARKER_TAGS) than a symbol's, and always
 * goes to the LIBRARY, never the template: there is no "a pattern
 * drawn before the library existed" case the way there was for
 * symbols, since Area Fill did not exist until the library already did.
 *
 * `meta` is {name, layer, placement, density, scaleMin, scaleMax,
 * rotate, help} -- AreaFillEdit.savePattern's job, not this function's,
 * is making sure those eight fields are well-formed before they arrive
 * here. `help` is a caver's own "what is it?" line and may be "".
 *
 * \return { ok, error, replaced }
 */
CsSymbolStore.saveAreaPattern = function(path, blockName, srcDoc, entities,
        meta) {
    if (isNull(path)) {
        path = CsSymbolStore.ensureCustomFile();
    }
    if (isNull(path)) {
        return { ok: false, replaced: false, error:
            "Your symbol library could not be created at " +
            CsSymbolStore.customPath() + ", so there is nowhere to save " +
            "the pattern." };
    }
    if (!CsSymbolStore.hasPrefix(blockName, CsSymbolStore.AREA_PREFIX)) {
        return { ok: false, replaced: false, error:
            "A pattern's block name must start with " +
            CsSymbolStore.AREA_PREFIX + "." };
    }
    if (isNull(entities) || entities.length === 0) {
        return { ok: false, replaced: false, error:
            "There is nothing to save: draw the pattern first." };
    }

    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, replaced: false, error:
            "Your symbol library could not be read: " + path };
    }
    var doc = di.getDocument();

    var replaced = false;
    var blockId;
    try {
        var existing = doc.queryBlock(blockName);
        if (!isNull(existing)) {
            replaced = true;
            blockId = existing.getId();
            CsSymbolStore.emptyBlock(doc, di, blockId);
        } else {
            var block = new RBlock(doc, blockName, new RVector(0, 0));
            di.applyOperation(new RAddObjectOperation(block));
            blockId = doc.getBlockId(blockName);
        }
    } catch (eBlock) {
        return { ok: false, replaced: false, error:
            "Your symbol library refused a block named " + blockName +
            " (" + eBlock + ")." };
    }
    if (isNull(blockId) || blockId === RObject.INVALID_ID) {
        return { ok: false, replaced: false, error:
            "Your symbol library refused a block named " + blockName + "." };
    }

    try {
        CsLayers.ensure(doc, di, meta.layer);
        CsLayers.ensure(doc, di, CsSymbolStore.MARKER_LAYER);
    } catch (eEnsure) {
    }

    var op = new RAddObjectsOperation();
    var copied = 0;
    for (var i = 0; i < entities.length; i++) {
        try {
            var e = entities[i];
            if (isNull(e)) {
                continue;
            }
            CsSymbolStore.adopt(doc, e);
            e.setBlockId(blockId);
            var lid = doc.getLayerId(meta.layer);
            if (!isNull(lid) && lid !== RObject.INVALID_ID) {
                e.setLayerId(lid);
            }
            op.addObject(e, false);
            copied++;
        } catch (eCopy) {
        }
    }
    if (copied === 0) {
        return { ok: false, replaced: replaced, error:
            "None of the pattern's geometry could be written into your " +
            "symbol library." };
    }

    // The marker: AREA_MARKER_TAGS, not MARKER_TAGS -- see this file's
    // own header on why the two never share a vocabulary. Added in the
    // SAME operation as the geometry, so a pattern can never exist half
    // saved: drawing there and description missing, or the reverse.
    try {
        var marker = new RPointEntity(doc,
            new RPointData(new RVector(0, 0)));
        marker.setBlockId(blockId);
        var mlid = doc.getLayerId(CsSymbolStore.MARKER_LAYER);
        if (!isNull(mlid) && mlid !== RObject.INVALID_ID) {
            marker.setLayerId(mlid);
        }
        var t = CsSymbolStore.AREA_MARKER_TAGS;
        CsTags.set(marker, t.custom, "1");
        CsTags.set(marker, t.name, meta.name);
        CsTags.set(marker, t.layer, meta.layer);
        CsTags.set(marker, t.placement, meta.placement);
        CsTags.set(marker, t.density, String(meta.density));
        CsTags.set(marker, t.scaleMin, String(meta.scaleMin));
        CsTags.set(marker, t.scaleMax, String(meta.scaleMax));
        CsTags.set(marker, t.rotate, meta.rotate === true ? "1" : "0");
        CsTags.set(marker, t.help, isNull(meta.help) ? "" : meta.help);
        op.addObject(marker, false);
    } catch (eMarker) {
        return { ok: false, replaced: replaced, error:
            "The pattern's own description could not be written (" +
            eMarker + "), so nothing was saved -- a pattern with no " +
            "layer or placement rule would be unplaceable." };
    }

    // THE MARKER'S OWN LAYER REFUSES IT -- the same CTRL-HIDDEN trap
    // saveBlock's own header describes, measured against the same
    // build. withLayerOn/withLayerUnlocked so the block and its
    // description arrive together or not at all.
    try {
        CsLayers.withLayerOn(doc, di, CsSymbolStore.MARKER_LAYER,
            function() {
                CsLayers.withLayerUnlocked(doc, di,
                    CsSymbolStore.MARKER_LAYER, function() {
                        di.applyOperation(op);
                    });
            });
    } catch (eApply) {
        return { ok: false, replaced: replaced, error:
            "Your symbol library refused the pattern's geometry (" +
            eApply + ")." };
    }
    if (CsSymbolStore.areaMarkerOf(doc, blockId) === null) {
        return { ok: false, replaced: replaced, error:
            "The pattern was not saved: your symbol library would not " +
            "accept its description, and a pattern with no layer or " +
            "placement rule cannot be placed." };
    }

    if (!CsSymbolStore.write(di, path)) {
        return { ok: false, replaced: replaced, error:
            "Your symbol library could not be written: " + path +
            "\nCheck that the file is not open elsewhere and that you " +
            "can write to it." };
    }
    CsSymbolStore.invalidate(path);
    return { ok: true, replaced: replaced, error: "" };
};

/**
 * Deletes a custom area pattern from the caver's library.
 *
 * LIBRARY ONLY -- a pattern never lived in the template the way an old
 * symbol could, so there is no second file to check the way
 * deleteBlock's own null-path branch does for symbols.
 *
 * \return { ok, error }
 */
CsSymbolStore.deleteAreaPattern = function(path, blockName) {
    if (isNull(path)) {
        path = CsSymbolStore.customPath();
    }
    if (isNull(path)) {
        return { ok: false, error: "There is nowhere to delete " +
            blockName + " from." };
    }
    try {
        if (!new QFileInfo(path).exists()) {
            return { ok: true, error: "" };   // no library, nothing saved
        }
    } catch (eEx) {
        return { ok: false, error: "Your symbol library could not be " +
            "checked: " + path };
    }
    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, error:
            "Your symbol library could not be read: " + path };
    }
    var doc = di.getDocument();
    var block = null;
    try {
        block = doc.queryBlock(blockName);
    } catch (eQ) {
    }
    if (isNull(block)) {
        CsSymbolStore.invalidate(path);
        return { ok: true, error: "" };   // already gone
    }
    try {
        var op = new RDeleteObjectsOperation();
        var ids = doc.queryBlockEntities(block.getId());
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (!isNull(e)) {
                op.deleteObject(e);
            }
        }
        op.deleteObject(block);
        di.applyOperation(op);
    } catch (eDel) {
        return { ok: false, error: "Your symbol library refused to give " +
            "up " + blockName + " (" + eDel + ")." };
    }
    if (!CsSymbolStore.write(di, path)) {
        return { ok: false, error:
            "Your symbol library could not be written: " + path };
    }
    CsSymbolStore.invalidate(path);
    return { ok: true, error: "" };
};

/**
 * Deletes a symbol from the template.
 *
 * Refuses the shipped set for the same reason saveBlock does: the
 * catalogue would go on naming a block that is not there, and the next
 * release would put it back.
 */
CsSymbolStore.deleteBlock = function(path, blockName) {
    if (isNull(path)) {
        // A symbol can live in either file: the library, or -- for one
        // drawn before the library existed -- the template. Delete
        // wherever it actually is, and from BOTH when it is in both, so
        // a deleted symbol cannot come back on the next listing.
        var done = false, trouble = "";
        var places = [CsSymbolStore.customPath(),
            CsSymbolStore.templatePath()];
        for (var i = 0; i < places.length; i++) {
            if (isNull(places[i]) ||
                    !new QFileInfo(places[i]).exists()) {
                continue;
            }
            var res = CsSymbolStore.deleteBlock(places[i], blockName);
            if (res.ok) {
                done = true;
            } else {
                trouble = res.error;
            }
        }
        return done ? { ok: true, error: "" } :
            { ok: false, error: trouble === "" ?
                "There is nowhere to delete " + blockName + " from." :
                trouble };
    }
    if (CsSymbols.byBlock(blockName) !== null) {
        return { ok: false, error: blockName + " is one of the symbols the " +
            "suite ships and cannot be deleted." };
    }
    var di = CsSymbolStore.openOffscreen(path);
    if (di === null) {
        return { ok: false, error:
            "The cave template could not be read: " + path };
    }
    var doc = di.getDocument();
    var block = null;
    try {
        block = doc.queryBlock(blockName);
    } catch (eQ) {
    }
    if (isNull(block)) {
        CsSymbolStore.invalidate(path);
        return { ok: true, error: "" };   // already gone
    }
    try {
        var op = new RDeleteObjectsOperation();
        var ids = doc.queryBlockEntities(block.getId());
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (!isNull(e)) {
                op.deleteObject(e);
            }
        }
        op.deleteObject(block);
        di.applyOperation(op);
    } catch (eDel) {
        return { ok: false, error: "The template refused to give up " +
            blockName + " (" + eDel + ")." };
    }
    if (!CsSymbolStore.write(di, path)) {
        return { ok: false, error:
            "The template could not be written: " + path };
    }
    CsSymbolStore.invalidate(path);
    return { ok: true, error: "" };
};

/**
 * The DXF exporter that persists custom properties as XDATA.
 *
 * The same choice PackageCave.dxfFilter makes and for the same reason:
 * any other writer drops the CaveSurvey property groups, and the marker
 * point IS a property group. A template written by the wrong exporter
 * would come back with every custom symbol anonymous.
 */
CsSymbolStore.dxfFilter = function() {
    try {
        var filters = RFileExporterRegistry.getFilterStrings();
        for (var i = 0; i < filters.length; i++) {
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

/** Writes the offscreen document back over the template. */
CsSymbolStore.write = function(di, path) {
    try {
        return di.exportFile(path, CsSymbolStore.dxfFilter()) === true;
    } catch (e) {
        return false;
    }
};
