// CsProvenance.js -- how much a piece of this map is worth trusting.
//
// Part of the Cave Survey Core library: pure data and pure functions,
// no document and no GUI, so tests/js_unit.js runs all of it.
//
// UNTIL NOW THIS SUITE HAD ONE ANSWER: everything on the map came from
// measurements, and every tool was written on that footing. Survey
// Stats quotes a UIS grade, the title block states a length, Check Map
// audits linework against the stations it was drawn near, Build Legend
// distinguishes a surveyed wall from an inferred one. All of it rests
// on there having BEEN a survey.
//
// Inherited projects break that footing. A finished map from 1987 is
// real cartography and no survey this drawing can see; a field sketch
// with no scale bar is a shape somebody drew. Both are worth digitising
// and neither is measured.
//
// SO: A LADDER, not a flag. A piece of passage climbs it as evidence
// arrives, and what the suite may SAY about that passage is a function
// of which rung it stands on.
//
//   TRACED    ink traced off an old map or sketch. Its scale comes
//             from the source's own evidence -- a printed scale bar,
//             one remembered distance, several scribbled ones -- or
//             from nothing at all, in which case it has no scale and
//             no length may be quoted for it.
//   TIED      the same traced ink, anchored to the real world by two
//             or more known points, which fix scale, rotation AND
//             position. Still drawn by hand; externally checked.
//   SURVEYED  measured passage. What this suite has always assumed,
//             and still the only rung a UIS grade may be quoted for.
//
// SUPERSEDED IS NOT A RUNG. It is a retirement flag on traced ink that
// measured survey has since replaced. Both TRACED and TIED ink can be
// superseded, and superseding is not promotion: promotion is the same
// ink becoming better attested, supersession is different ink taking
// over. Modelling them as one scale would make "superseded" sound like
// an improvement on TIED, which is the opposite of what it means.
//
// PROMOTION TO SURVEYED DOES NOT EXIST, and that absence is
// deliberate. Traced ink never becomes measured ink; measured ink is
// NEW ink that supersedes it, piece by piece, over the years a
// resurvey actually takes. A promote-to-surveyed operation would be a
// button that turns a drawing into a claim nobody made.
//
// THE DEFAULT COSTS NOTHING. Anything with no provenance recorded is
// SURVEYED, so every drawing made before this file existed is already
// correct: no migration, no upgrade pass, and thirty caves on the shelf
// that do not change meaning the day this ships.

var CsProvenance = {};

CsProvenance.TRACED = "traced";
CsProvenance.TIED = "tied";
CsProvenance.SURVEYED = "surveyed";

// Rungs in order, lowest first. The order is the whole point: it is
// what lets a tool ask "is this at least TIED?" without knowing the
// vocabulary.
CsProvenance.LADDER = [CsProvenance.TRACED, CsProvenance.TIED,
    CsProvenance.SURVEYED];

CsProvenance.RUNGS = {
    "traced": {
        label: "Traced",
        // Shown wherever a reader meets this passage. Plain, and it
        // says what was actually done rather than grading it.
        sentence: "Traced from an existing map or sketch. Not surveyed.",
        // What may be claimed. Read by Survey Stats, the title block,
        // Build Legend and Check Map rather than each deciding again.
        measured: false,
        // A length MAY be quoted, as an estimate, but only when the
        // source carried scale evidence -- see CsProvenance.mayQuoteLength.
        quotesLength: "estimate",
        grade: false,
        // Real-world position is unknown: the ink sits where somebody
        // laid it down, at whatever rotation looked right.
        located: false
    },
    "tied": {
        label: "Tied",
        sentence: "Traced from an existing map, then anchored to " +
            "known real-world points. Not surveyed.",
        measured: false,
        quotesLength: "estimate",
        grade: false,
        located: true
    },
    "surveyed": {
        label: "Surveyed",
        sentence: "Surveyed with instruments.",
        measured: true,
        quotesLength: "measured",
        grade: true,
        located: true
    }
};

/** The retirement flag. Not a rung; see the header. */
CsProvenance.SUPERSEDED_KEY = "Superseded";

CsProvenance.KEY = {
    // Which source this entity was traced from. The one tag ordinary
    // traced ink carries -- everything else is read off the source.
    SOURCE: "SourceId",
    // An OVERRIDE, and only ever an override: an entity with no RUNG
    // tag inherits its source's. Written together with REASON and
    // never without it.
    RUNG: "Rung",
    REASON: "RungReason"
};

/**
 * Whether a word names a rung.
 */
CsProvenance.isRung = function(rung) {
    return rung !== undefined && rung !== null &&
        CsProvenance.RUNGS.hasOwnProperty(rung);
};

/**
 * Where a rung sits on the ladder: 0 lowest, or -1 for a word that
 * names no rung.
 *
 * The comparison every caller wants is "at least this good", and that
 * is CsProvenance.atLeast rather than this -- but a tool sorting a
 * findings list by how much it trusts each row needs the number.
 */
CsProvenance.height = function(rung) {
    for (var i = 0; i < CsProvenance.LADDER.length; i++) {
        if (CsProvenance.LADDER[i] === rung) {
            return i;
        }
    }
    return -1;
};

/**
 * Whether `rung` is at least as well attested as `floor`.
 *
 * A rung this file does not know is never "at least" anything: an
 * unreadable value must not read as trustworthy by accident, which is
 * the direction that quietly puts a made-up length on a sheet.
 */
CsProvenance.atLeast = function(rung, floor) {
    var have = CsProvenance.height(rung);
    var want = CsProvenance.height(floor);
    if (have < 0 || want < 0) {
        return false;
    }
    return have >= want;
};

/**
 * What a piece of the drawing is worth, given its own tags and its
 * source's.
 *
 * THE INHERIT-AND-OVERRIDE RULE, in one place so nothing implements a
 * second version of it:
 *
 *   - an entity with a RUNG tag uses it, and that is an override;
 *   - an entity with a SourceId and no RUNG tag inherits the source's;
 *   - an entity with neither is SURVEYED, because that is what
 *     everything in every drawing made before this file was.
 *
 * AN OVERRIDE WITHOUT A REASON IS REFUSED, and falls back to the
 * source's rung with a finding. The failure mode of every
 * inherit-with-override scheme is a value nobody can explain; requiring
 * the reason is the cheapest prevention, and honouring a reasonless
 * override would make the requirement advice rather than a rule.
 *
 * \param entityTags {Rung, RungReason, SourceId} as read off the
 *        entity -- absent keys may be undefined, null or "".
 * \param source the source record this entity points at, or null.
 * \return {rung, from: "override"|"source"|"default", reason,
 *          finding} -- finding is null unless something was wrong.
 */
CsProvenance.resolve = function(entityTags, source) {
    var tags = (entityTags === undefined || entityTags === null) ? {} :
        entityTags;
    var sourceRung = (source === undefined || source === null ||
        !CsProvenance.isRung(source.rung)) ? null : source.rung;
    var fallback = sourceRung === null ? CsProvenance.SURVEYED : sourceRung;
    var fallbackFrom = sourceRung === null ? "default" : "source";

    var override = tags[CsProvenance.KEY.RUNG];
    if (override === undefined || override === null || override === "") {
        return { rung: fallback, from: fallbackFrom, reason: "",
            finding: null };
    }
    if (!CsProvenance.isRung(override)) {
        return { rung: fallback, from: fallbackFrom, reason: "",
            finding: "This linework claims a confidence (\"" + override +
                "\") that means nothing here. It is being read as " +
                fallback + "." };
    }
    var reason = tags[CsProvenance.KEY.REASON];
    if (reason === undefined || reason === null || reason === "") {
        return { rung: fallback, from: fallbackFrom, reason: "",
            finding: "This linework overrides its source's confidence " +
                "to \"" + override + "\" without saying why, so the " +
                "override is ignored. Give a reason or remove it." };
    }
    return { rung: override, from: "override", reason: String(reason),
        finding: null };
};

/**
 * Whether a length may be quoted for this passage, and how it must be
 * described.
 *
 * THE UNSCALED CASE IS THE POINT OF THIS FUNCTION. A traced source with
 * no scale evidence has no length, not a length of unknown accuracy:
 * the ink is a shape somebody drew at whatever size the paper was. A
 * tool that measured it would be reporting the size of a photocopy.
 *
 * \param rung the resolved rung.
 * \param source the source record, or null for surveyed passage.
 * \return {allowed, kind: "measured"|"estimate"|"none", why}
 */
CsProvenance.mayQuoteLength = function(rung, source) {
    if (!CsProvenance.isRung(rung)) {
        return { allowed: false, kind: "none",
            why: "its confidence is not one this drawing knows" };
    }
    var spec = CsProvenance.RUNGS[rung];
    if (spec.measured) {
        return { allowed: true, kind: "measured", why: "" };
    }
    if (source === undefined || source === null || !source.scaled) {
        return { allowed: false, kind: "none",
            why: "nothing scaled the map it was traced from, so its " +
                "size on the page means nothing" };
    }
    return { allowed: true, kind: "estimate", why: "" };
};

/**
 * Whether a UIS/BCRA grade may be quoted for this passage.
 *
 * Only ever for surveyed passage. A grade is a statement about
 * instruments and closure, and traced ink had neither -- quoting one
 * for a cave digitised off a 1987 drawing would be the single most
 * misleading number this suite could print, because a grade is exactly
 * what a reader uses to decide how far to trust a map.
 */
CsProvenance.mayQuoteGrade = function(rung) {
    return CsProvenance.isRung(rung) && CsProvenance.RUNGS[rung].grade;
};

/**
 * The sentence a reader gets, with the source's own words when it has
 * them.
 *
 * WHO DREW IT AND WHEN belongs in front of a reader, not in a record
 * nobody opens: "Traced from Truitt Cave, J. Webb, 1987" is the whole
 * provenance of a sheet in one line, and it is the line a legend or a
 * title block prints.
 */
CsProvenance.describe = function(rung, source) {
    if (!CsProvenance.isRung(rung)) {
        return "Confidence unknown.";
    }
    var spec = CsProvenance.RUNGS[rung];
    if (spec.measured || source === undefined || source === null) {
        return spec.sentence;
    }
    var credit = [];
    if (source.author !== undefined && source.author !== null &&
            source.author !== "") {
        credit.push(String(source.author));
    }
    if (source.year !== undefined && source.year !== null &&
            source.year !== "") {
        credit.push(String(source.year));
    }
    var what = (source.title !== undefined && source.title !== null &&
        source.title !== "") ? String(source.title) : "an existing map";

    var line = (rung === CsProvenance.TIED) ?
        "Traced from " + what : "Traced from " + what;
    if (credit.length > 0) {
        line += " (" + credit.join(", ") + ")";
    }
    if (rung === CsProvenance.TIED) {
        line += ", anchored to known points";
    }
    if (!source.scaled) {
        line += ". NOT TO SCALE";
    }
    return line + ". Not surveyed.";
};

/**
 * Whether this entity has been retired by measured survey.
 */
CsProvenance.isSuperseded = function(entityTags) {
    if (entityTags === undefined || entityTags === null) {
        return false;
    }
    var flag = entityTags[CsProvenance.SUPERSEDED_KEY];
    if (flag === undefined || flag === null || flag === "") {
        return false;
    }
    var text = String(flag).toLowerCase();
    return text !== "0" && text !== "false" && text !== "no";
};

/**
 * The rung a whole drawing may claim: the WORST of what it holds.
 *
 * A cave half resurveyed and half traced is not a surveyed cave. The
 * title block, the legend and anything else speaking for the map as a
 * whole take this answer, because a reader holding one sheet asks one
 * question -- how much of this do I trust -- and the honest answer is
 * set by the weakest passage on it, not the strongest.
 *
 * SUPERSEDED INK DOES NOT COUNT. It has been replaced by survey and is
 * on its way out of the drawing; letting it hold the whole map down
 * would mean a fully resurveyed cave still reported as traced until
 * somebody remembered to delete the old linework.
 *
 * \param rungs an array of {rung, superseded} as resolved per entity.
 * \return the lowest live rung, or SURVEYED for a drawing with nothing
 *         traced in it at all.
 */
CsProvenance.overall = function(rungs) {
    var worst = null;
    for (var i = 0; i < rungs.length; i++) {
        var row = rungs[i];
        if (row === null || row === undefined || row.superseded === true) {
            continue;
        }
        if (!CsProvenance.isRung(row.rung)) {
            continue;
        }
        if (worst === null ||
                CsProvenance.height(row.rung) < CsProvenance.height(worst)) {
            worst = row.rung;
        }
    }
    return worst === null ? CsProvenance.SURVEYED : worst;
};

/**
 * How much of a source's ink has been replaced by survey.
 *
 * The number that turns a pile of inherited projects into a work
 * queue: "62% of the 1987 map has been resurveyed, here is the rest".
 *
 * \param rows an array of {superseded} for one source's entities.
 * \return {total, superseded, fraction} -- fraction 0 for an empty
 *         source rather than a division by zero dressed as progress.
 */
CsProvenance.progress = function(rows) {
    var total = rows === null || rows === undefined ? 0 : rows.length;
    var done = 0;
    for (var i = 0; i < total; i++) {
        if (rows[i] !== null && rows[i] !== undefined &&
                rows[i].superseded === true) {
            done++;
        }
    }
    return { total: total, superseded: done,
        fraction: total === 0 ? 0 : done / total };
};
