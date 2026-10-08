// CsLayerVariants.js -- on-demand layers derived from a registry layer.
//
// Part of the Cave Survey Core library. A VARIANT is a registry layer
// plus a token: PROFILE-CEILING for survey run A becomes
// PROFILE-CEILING-A. The variant is created when it is first needed,
// inherits its base layer's appearance, and can be parsed back to the
// (base, token) it came from.
//
// WHY A LIBRARY. Per-run profile layers are the first use, but the shape
// is general: per-trip linework, per-sheet annotation, anything a tool
// wants to split by a name it only learns at run time. Every one of
// those otherwise re-invents the same four decisions -- how the name is
// built, where the colour comes from, how it is parsed back, and how you
// find all of them. Getting any of the four wrong is silent in this
// build.
//
// WHY ON DEMAND, when the template holds every other layer. The rule the
// suite learned the hard way is "UNIVERSAL layers belong in the
// template": CTRL-LRUD-WALL-LEFT/RIGHT were created on demand and
// exempted from the template test, so a fresh drawing's Layer list did
// not offer layers that every drawing needs. Variants are the opposite
// kind of thing -- CONDITIONAL. A cave with surveys A, B and C should
// have variant layers for A, B and C, not for twenty-three letters it
// will never use. Because variants are never registry entries, the
// registry-to-template tests do not see them and need no exemption:
// the invariant stays exactly as strong as it was.
//
// THE TOKEN GOES LAST, and that is load-bearing rather than cosmetic:
//   - CsLayers.frameOf keys off the PREFIX, so a variant keeps its base
//     layer's frame with no change to the one frame test.
//   - CsBind.NEVER_LINEWORK_PREFIXES keys off "CTRL-", so a variant of a
//     generated layer stays ineligible for binding, also for free.
//   - it works for every base, plan-frame ones included, where inserting
//     a token after the prefix would produce names frameOf cannot read.
// The cost is that a flat Layer list groups variants by FEATURE rather
// than by token, so one run's layers are not adjacent. That is what
// layersForToken below is for: isolating a run is a query, not a hunt
// through the list.

var CsLayerVariants = {};

/** Separator between the base name and the token. The same "-" the rest
 *  of the vocabulary uses, so variants read like layers and not like a
 *  second naming scheme. */
CsLayerVariants.SEP = "-";

/**
 * A token cleaned into something a DXF layer name can hold, or null if
 * nothing usable is left.
 *
 * Upper-cased because the whole layer vocabulary is, and because layer
 * names compare case-sensitively here -- a run recorded as "a" and one
 * as "A" would otherwise be two layers for one survey.
 *
 * The characters removed are the ones DXF forbids in a layer name
 * (< > / \ " : ; ? * | = and comma) plus the separator itself, which
 * would make the name unparseable. A token that is nothing but
 * punctuation returns null rather than an empty segment: a layer called
 * "PROFILE-CEILING-" is worse than a refusal.
 */
CsLayerVariants.sanitize = function(token) {
    if (isNull(token)) {
        return null;
    }
    var out = String(token).toUpperCase()
        .replace(/[<>\/\\":;?*|=,]/g, "")
        .replace(/\s+/g, "_")
        .replace(/-/g, "_");
    if (out.length === 0) {
        return null;
    }
    return out;
};

/**
 * The variant layer name for `base` and `token`, or null.
 *
 * Refuses a base the registry does not define. A variant of an invented
 * layer has no appearance to inherit, and would take the fallback
 * colour and weight silently -- exactly the trap this library exists to
 * close.
 */
CsLayerVariants.nameFor = function(base, token) {
    if (isNull(base) || isNull(CsLayers.DEFAULTS[base])) {
        return null;
    }
    var clean = CsLayerVariants.sanitize(token);
    if (clean === null) {
        return null;
    }
    return base + CsLayerVariants.SEP + clean;
};

/**
 * {base, token} for a variant name, or null when the name is not one.
 *
 * Parsed by TESTING the remainder against the registry rather than by
 * guessing where the token starts. PROFILE-WALLS-INFERRED would
 * otherwise read as base PROFILE-WALLS with token INFERRED -- it splits
 * cleanly and means something entirely different. Only a remainder the
 * registry actually defines is accepted, which makes this exact instead
 * of nearly right.
 *
 * A REGISTRY LAYER IS NEVER A VARIANT, whatever it splits into. Thirteen
 * of them are a registry layer plus one more segment that is also a
 * registry layer -- CEILING-HEIGHT over CEILING, FLOOR-SLOPE over FLOOR,
 * and the profile and section twins of both. Without this test they
 * parse as run HEIGHT of CEILING, and warnUnclaimedProfile then reads
 * the shared PROFILE-CEILING-HEIGHT as a run's own layer and says
 * nothing -- which is the one case it exists to speak up about.
 */
CsLayerVariants.split = function(name) {
    if (isNull(name)) {
        return null;
    }
    var s = String(name);
    if (!isNull(CsLayers.DEFAULTS[s])) {
        return null;   // a registry layer in its own right
    }
    var cut = s.lastIndexOf(CsLayerVariants.SEP);
    if (cut <= 0 || cut === s.length - 1) {
        return null;
    }
    var base = s.substring(0, cut);
    if (isNull(CsLayers.DEFAULTS[base])) {
        return null;   // not a variant: the remainder is not a real layer
    }
    return { base: base, token: s.substring(cut + 1) };
};

/** The registry layer a name draws its appearance from: itself when it
 *  is a registry layer, its base when it is a variant, else null. */
CsLayerVariants.baseOf = function(name) {
    if (!isNull(CsLayers.DEFAULTS[name])) {
        return name;
    }
    var parts = CsLayerVariants.split(name);
    return (parts === null) ? null : parts.base;
};

/**
 * Ensures the variant exists and returns its name, or null if it could
 * not be named. QCAD context only.
 *
 * The creation itself goes through CsLayers.ensure, which resolves
 * appearance through baseOf above -- so a variant looks exactly like the
 * layer it varies, and there is still only one place that decides what
 * PROFILE-CEILING looks like.
 */
CsLayerVariants.ensure = function(doc, di, base, token) {
    var name = CsLayerVariants.nameFor(base, token);
    if (name === null) {
        return null;
    }
    CsLayers.ensure(doc, di, name);
    return name;
};

/**
 * ensure(), restricted to the PROFILE frame. Returns null for anything
 * else. QCAD context only.
 *
 * A deliberate scoping decision, not a limitation of the mechanism:
 * segregating by survey run is wanted for the elevation and NOT for the
 * plan. The plan is one continuous map -- a caver reads a passage across
 * survey boundaries and traces walls straight through them, so splitting
 * plan walls per run would fragment one wall into several layers and
 * (because CsTrace.nearestEnd only ties within a layer) refuse to close
 * the joins between them. The elevation is already drawn as one BAND PER
 * RUN, so per-run layers follow a division that is really there.
 *
 * Every profile-drawing caller goes through this rather than ensure(),
 * so the decision lives in code instead of in whoever remembers it. The
 * general ensure() stays general on purpose: the library exists for
 * other tools too, and a future per-trip or per-sheet use has no reason
 * to inherit this restriction.
 */
CsLayerVariants.ensureProfile = function(doc, di, base, token) {
    if (isNull(base) || CsLayers.frameOf(base) !== "profile") {
        return null;
    }
    return CsLayerVariants.ensure(doc, di, base, token);
};

/**
 * Every token this drawing already has a variant of `base` for, sorted.
 * QCAD context only.
 *
 * Reads the drawing rather than the survey model on purpose: the
 * question this answers is "what is in front of me", which includes a
 * run whose survey has since been deleted and whose linework is still
 * sitting there.
 */
CsLayerVariants.tokensIn = function(doc, base) {
    var out = [];
    var ids = doc.queryAllLayers();
    for (var i = 0; i < ids.length; i++) {
        var lay = doc.queryLayer(ids[i]);
        if (isNull(lay)) {
            continue;
        }
        var parts = CsLayerVariants.split(lay.getName());
        if (parts !== null && parts.base === base) {
            out.push(parts.token);
        }
    }
    out.sort(CsLayerVariants.compareTokens);
    return out;
};

/**
 * Every variant layer name in the drawing carrying `token`, sorted.
 * QCAD context only.
 *
 * This is what makes the token-last naming affordable: isolating one
 * survey run is one call, not a scroll through a flat Layer list
 * hunting for entries that are nowhere near each other.
 */
CsLayerVariants.layersForToken = function(doc, token) {
    var clean = CsLayerVariants.sanitize(token);
    var out = [];
    if (clean === null) {
        return out;
    }
    var ids = doc.queryAllLayers();
    for (var i = 0; i < ids.length; i++) {
        var lay = doc.queryLayer(ids[i]);
        if (isNull(lay)) {
            continue;
        }
        var name = lay.getName();
        var parts = CsLayerVariants.split(name);
        if (parts !== null && parts.token === clean) {
            out.push(name);
        }
    }
    out.sort(CsLayerVariants.compareNames);
    return out;
};

/** Total order over tokens. Total, not merely consistent: this engine's
 *  Array.prototype.sort is UNSTABLE, so a comparator returning 0 for two
 *  distinct tokens diverges between engines invisibly. */
CsLayerVariants.compareTokens = function(a, b) {
    if (a === b) {
        return 0;
    }
    return (String(a) < String(b)) ? -1 : 1;
};

/** Total order over layer names, for the same reason. */
CsLayerVariants.compareNames = function(a, b) {
    if (a === b) {
        return 0;
    }
    return (String(a) < String(b)) ? -1 : 1;
};
