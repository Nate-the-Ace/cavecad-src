// CsRestyle.js -- re-applies the layer palette to a drawing that already
// has the layers.
//
// Part of the Cave Survey Core library.
//
// WHY THIS EXISTS. CsLayers.ensure resolves colour, linetype and
// lineweight AT CREATION and never again, which is correct for a tool
// drawing into a layer but leaves a whole class of drawings wrong: every
// cave started before a palette change keeps the palette it was born
// with, and tools/sync_template_layers.js -- the thing that pushes the
// registry into the shipped template -- could only ever style layers it
// CREATED. That gap is why ENTRANCE shipped red/0.50 in the template and
// white/0.35 in the registry, why BREAKDOWN-BOUNDARY had three different
// appearances, and why the NOTES-ELEVATION / NOTES-ELEVATION-LINE pair
// could ship inverted with the test suite green.
//
// So: one function that walks a document's layers and makes each one
// look like CsLayers.styleOf says it should. The sync tool calls it on
// the template, the Restyle Layers command calls it on the drawing in
// front of the caver, and both get the same answer because there is
// still exactly one table.
//
// WHAT IT WILL NOT TOUCH. A layer with no registry style -- a caver's
// own layer, an imported one, anything CsLayers has never heard of --
// is left exactly as it is. Variant layers (PROFILE-CEILING-A) ARE
// restyled, through CsLayerVariants.baseOf inside styleOf, because a
// variant that stopped matching the layer it varies is the bug this
// library is built to prevent.
//
// QCAD context only: every function here touches a document.

var CsRestyle = {};

/**
 * The layers this document holds that CsLayers has a style for, sorted.
 *
 * \return array of layer names
 */
CsRestyle.styledLayersIn = function(doc) {
    var out = [];
    var ids = doc.queryAllLayers();
    for (var i = 0; i < ids.length; i++) {
        var lay = doc.queryLayer(ids[i]);
        if (isNull(lay)) {
            continue;
        }
        var name = lay.getName();
        if (!isNull(CsLayers.DEFAULTS[name])) {
            out.push(name);
            continue;
        }
        if (typeof CsLayerVariants !== "undefined" &&
            !isNull(CsLayerVariants.baseOf(name))) {
            out.push(name);
        }
    }
    out.sort();
    return out;
};

/**
 * Whether `lay` already looks the way `style` says, comparing all three
 * axes.
 *
 * Colour is compared by RESOLVED NAME -- RColor.name(), the "#rrggbb"
 * string -- and not by RColor.equals or by the component accessors:
 *
 *   - equals() distinguishes an ACI INDEX from the true colour denoting
 *     the same thing, and 42 of the shipped template's layers carry an
 *     index. Comparing that way reports every one of them as different
 *     forever, so every run rewrites every layer and the tool can never
 *     say "nothing to do".
 *   - the component accessors are red()/green()/blue() in this bridge,
 *     NOT getRed()/getGreen()/getBlue(). The get* spelling raises
 *     "Property 'getRed' of object RColor [JS] is not a function", which
 *     the catch below swallows into a false -- an always-restyle that
 *     looks exactly like a working tool. This function was written that
 *     way first and shipped a non-idempotent sync before the second run
 *     gave it away.
 *
 * Matching by name also leaves an ACI layer AS an ACI layer when its
 * colour is already right, rather than quietly converting the whole
 * template to true colour on the first sweep.
 *
 * Anything unreadable answers false -- rewrite it rather than silently
 * skip it.
 */
CsRestyle.matches = function(doc, lay, style) {
    try {
        if (lay.getColor().name() !== new RColor(style[0]).name()) {
            return false;
        }
        if (lay.getLineweight() !== RLineweight[style[2]]) {
            return false;
        }
        return lay.getLinetypeId() === CsLayers.linetypeIdFor(doc, style);
    } catch (e) {
        return false;
    }
};

/**
 * Makes every styled layer in the document match the registry.
 *
 * ONE undo step for the whole sweep: a restyle is a single decision and
 * a caver undoing it wants the drawing it had, not 150 undos.
 *
 * LOCKED LAYERS ARE RESTYLED, deliberately and unlike every other write
 * in the suite. The suite's own locks (CTRL-PROFILE-BOX,
 * CTRL-SECTION-BOX -- see CsLayers.LOCKED) exist to stop a caver
 * dragging bookkeeping geometry around; they were never meant to freeze
 * the box's colour against the palette that owns it. A lock is restored
 * immediately afterwards by CsLayers.withLayerUnlocked. Note this
 * changes only the LAYER record, never an entity.
 *
 * \return { changed: [names], total: number }
 */
CsRestyle.apply = function(doc, di) {
    var names = CsRestyle.styledLayersIn(doc);
    var changed = [];
    var op = new RModifyObjectsOperation();
    var pending = 0;
    var locked = [];
    var i;
    for (i = 0; i < names.length; i++) {
        var lay = doc.queryLayer(names[i]);
        if (isNull(lay)) {
            continue;
        }
        var style = CsLayers.styleOf(names[i]);
        if (CsRestyle.matches(doc, lay, style)) {
            continue;
        }
        var wasLocked = false;
        try {
            wasLocked = lay.isLocked() === true;
        } catch (eLock) {
            wasLocked = false;
        }
        if (wasLocked) {
            // A locked layer refuses modifies silently in this build,
            // so the write has to happen with the lock off. Collected
            // and handled one at a time after the bulk operation --
            // there are two of them, and mixing them into the batch
            // would mean unlocking everything before applying anything.
            locked.push(names[i]);
            continue;
        }
        lay.setColor(new RColor(style[0]));
        lay.setLinetypeId(CsLayers.linetypeIdFor(doc, style));
        lay.setLineweight(RLineweight[style[2]]);
        op.addObject(lay, false);
        changed.push(names[i]);
        pending++;
    }
    if (pending > 0) {
        di.applyOperation(op);
    }
    for (i = 0; i < locked.length; i++) {
        CsRestyle.restyleLocked(doc, di, locked[i]);
        changed.push(locked[i]);
    }
    changed.sort();
    return { changed: changed, total: names.length };
};

/** One locked layer, unlocked for the length of its own restyle and
 *  locked again after -- including when the write throws. */
CsRestyle.restyleLocked = function(doc, di, name) {
    CsLayers.withLayerUnlocked(doc, di, name, function() {
        var lay = doc.queryLayer(name);
        if (isNull(lay)) {
            return;
        }
        var style = CsLayers.styleOf(name);
        lay.setColor(new RColor(style[0]));
        lay.setLinetypeId(CsLayers.linetypeIdFor(doc, style));
        lay.setLineweight(RLineweight[style[2]]);
        var op = new RModifyObjectsOperation();
        op.addObject(lay, false);
        di.applyOperation(op);
    });
};

/**
 * Ensures every registry layer exists, then restyles the lot.
 *
 * The full repair: an old drawing is missing the layers added since it
 * was made AND is wearing the palette of the day it was made. Callers
 * that only want one half call CsLayers.ensure / CsRestyle.apply
 * directly.
 *
 * \return { added: number, changed: [names], total: number }
 */
CsRestyle.ensureAndApply = function(doc, di) {
    var added = 0, k, name;
    for (k in CsLayers) {
        if (!CsLayers.hasOwnProperty(k)) {
            continue;
        }
        name = CsLayers[k];
        // Constants only. CsLayers.DEFAULTS also carries CTRL-DATA, the
        // retired data-store layer, which no drawing should gain -- the
        // same exclusion tools/sync_template_layers.js makes, for the
        // same reason.
        if (typeof name !== "string" || isNull(CsLayers.DEFAULTS[name])) {
            continue;
        }
        if (!doc.hasLayer(name)) {
            CsLayers.ensure(doc, di, name);
            added++;
        }
    }
    var res = CsRestyle.apply(doc, di);
    res.added = added;
    return res;
};
