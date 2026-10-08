// Network.js -- resolves a survey's shots into station coordinates,
// finds loops, and measures how well they close.
//
// Part of the Cave Survey Core library: pure functions.
//
// Resolution is by repeated passes over the shot list until nothing
// more resolves, so shots may appear in any order, branches and
// resumed traverses work, and a shot whose TO is already known
// becomes a closure rather than a duplicate station. Both directions
// resolve: a shot can also fix its FROM station from a known TO.
//
// Anchors, in priority order: an explicit anchor passed by the caller
// (e.g. a selected station in the drawing), then any #Fix / *fix
// stations, then the first usable shot's FROM at (0,0,0). If fixed
// points exist for several disconnected components, each component
// anchors on its own fixed point.
//
// An explicit anchor and #Fix/*fix control live in two different
// coordinate frames -- a DRAWING position the caller chose (e.g. a
// point already on the sheet) versus a WORLD control coordinate the
// surveyor recorded -- and nothing says they share an origin. When the
// anchored station is ITSELF a fixed station, the translation between
// the two frames is a known fact (the caller's own anchor position
// minus that station's own control), and every OTHER fixed station in
// the same shot-graph component gets moved by that same translation
// before being pinned, so a real disagreement in the control network
// still surfaces as a tie or loop misclosure -- see the long comment
// above seedFixed for why this is safe and what "same component"
// means here.

var CsNetwork = {};

/**
 * \param survey the CsModel survey
 * \param opts {
 *   tapeMode: CsTraverse mode (default slope),
 *   anchor: {name, x, y, z} to pin one station explicitly
 * }
 *
 * \return {
 *   stations:   {name: {x, y, z, seq}}  seq = resolution order, the
 *               survey order LRUDWalls and labels rely on
 *   legs:       [{shot, from, to, kind}] kind "new" | "closure" | "tie",
 *               in resolution order -- what the drawing draws
 *   closures:   [{shot, atStation, dx, dy, dz, horizontal, vertical,
 *               distance, kind}] misclosure of each closure leg:
 *               computed minus already-known; kind "loop" | "tie"
 *               matches which of the two lists below it landed in
 *   loops:      [{from, to, path, traverseLength, error, horizontal,
 *               vertical, percent, viaControl}] one per closure ring.
 *               path is station names from the closure shot's own
 *               `from` end to its `to` end. When both ends' ancestor
 *               chains share a common root (the ordinary case), path
 *               is a real walk: every consecutive pair in it is
 *               joined by an actual surveyed leg. When they don't --
 *               two different FIXED stations on the SAME ring, each
 *               rooting its own half -- path is instead fromChain ++
 *               reverse(toChain) (e.g. [RB, RA, RC]): the station at
 *               the JOIN of those two halves is NOT surveyed-adjacent
 *               to its neighbor there, only connected to it through
 *               the shared control network, not through any leg a
 *               surveyor shot. viaControl is true exactly in that
 *               second case, so a consumer can detect a
 *               control-joined path by a flag instead of re-deriving
 *               it from path's contents.
 *   ties:       the same shape, for legs that join two separately
 *               anchored components -- control ties, not rings, so
 *               they carry no meaningful percent (always null here --
 *               see the field's own "no meaningful percent" reasoning
 *               above; no consumer should format a tie's percent).
 *               path is just the tying shot's own two endpoints (a
 *               real surveyed leg, never fabricated), so viaControl
 *               is always false for a tie
 *   anchors:    [name] stations placed with no parent, in placement
 *               order: the explicit anchor, the #Fix / *fix seeds, or
 *               the first usable shot's FROM. CsAdjust pins these.
 *   controlFrame: null when there was nothing to reconcile (no
 *               explicit anchor, or 0-1 fixed stations); otherwise
 *               {
 *                 offset: {dx, dy, dz} applied to move fixed control
 *                     into the anchor's frame, or null when no offset
 *                     could be computed (the anchor's own station has
 *                     no control of its own),
 *                 applied: [name] fixed stations (sharing the
 *                     anchor's shot-graph component) that were pinned
 *                     at control + offset,
 *                 notHonored: [name] fixed stations in the anchor's
 *                     component that were left for ordinary traversal
 *                     instead of pinned, because there was no offset
 *                     to place them with,
 *                 reason: why, in words, when notHonored is non-empty;
 *                     null otherwise
 *               }
 *               A fixed station with no shot path to the anchor at
 *               all (a separate cave passage) is not named here: it
 *               was never in contention with this anchor, and anchors
 *               itself exactly as it always has.
 *   unresolved: [shot] shots whose stations never connected
 *   skipped:    [shot] excluded / splay shots not resolved
 *   anchorZUnknown: null when the anchor got a real elevation (or
 *               there was no explicit anchor at all); otherwise
 *               {name, reason} -- the anchor was placed anyway (x/y
 *               matter to plan view even without a z), but at z =
 *               null rather than a fabricated 0. See the "SIXTH DOOR"
 *               comment above `anchorEffectiveZ` for why null, not 0,
 *               and what still does not know about it.
 *   fixedZUnknown: [name] -- every *fix'ed/#Fix'ed station seedFixed()
 *               placed with no usable z (survey.fixed[name].z absent or
 *               non-finite): still placed at its real x/y, but z =
 *               null rather than a fabricated 0. [] when every fixed
 *               station had a real elevation, which is every fixture
 *               and every shipped writer today except a drawing whose
 *               own Elevation tag is missing or garbled -- see
 *               CsTags.surveyFromDocument's own "SEVENTH DOOR" comment
 *               and seedFixed's comment just above it in this file.
 *
 *               NEITHER FIELD HAS A PRODUCTION READER TODAY, AND THAT IS
 *               DELIBERATE, NOT AN OVERSIGHT LEFT FOR LATER. Both are
 *               diagnostic/test-only: CsAdjust.resolveAndAdjust (the
 *               path every shipped caller actually uses) rebuilds a NEW
 *               result object in both CsAdjust.unadjusted and CsAdjust.
 *               adjust, and neither copies these two fields across -- so
 *               even a future reader sitting downstream of an adjustment
 *               pass could not see them no matter how it is wired. This
 *               is not a silent gap for the null-z case itself: a
 *               station placed with anchorZUnknown/fixedZUnknown set
 *               still carries a real, honestly-null z, and CsProfile.
 *               build's own unrollBand already refuses to draw a band
 *               past a null-z station and names it in findings.stopped
 *               with reason "no-z" (see CsReport.profileSummary's own
 *               wording for that case) -- that is the channel a user
 *               actually learns of a null z through today. If a direct
 *               report of WHICH *fix/anchor line lacked an elevation
 *               tag (as opposed to which STATION downstream of it ran
 *               out of resolved z) is ever wanted, these two fields are
 *               where that information already lives -- it would need
 *               to be plumbed through CsAdjust's own return objects
 *               first, not merely read here, since resolveAndAdjust is
 *               what every production caller actually sees.
 * }
 */
CsNetwork.resolve = function(survey, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var stations = {};
    var legs = [];
    var closures = [];
    var loops = [];
    var ties = [];
    var anchors = [];
    var skipped = [];
    var seq = 0;

    // parent links for loop path recovery: station -> {prev, shot}
    var parent = {};

    var place = function(name, x, y, z, from) {
        stations[name] = { x: x, y: y, z: z, seq: seq++ };
        parent[name] = from; // null for anchors
        if (from === null || from === undefined) {
            anchors.push(name);
        }
    };

    // ---- pick anchors --------------------------------------------
    var usable = [];
    for (var i = 0; i < survey.shots.length; i++) {
        var s = survey.shots[i];
        // from === to is skipped, never scored: a self-loop shot
        // resolving as a closure would misclassify as a bridge-free
        // "loop" with the two ends' misclosure equal to the shot's
        // own full distance -- percent 100, tripping the blunder
        // warning for data that need not be a blunder at all. This is
        // NOT the Compass zero-length LRUD carrier idiom: that carrier
        // never becomes a shot with from === to in the first place --
        // CsFormatCompass's reader filters it out during parsing (see
        // its isCarrier check) before it ever reaches survey.shots,
        // and even when written it targets a distinct synthetic
        // station name (from + "_L"), not the FROM station itself. Any
        // from === to shot that reaches here is something else (a
        // stray data-entry duplicate, most likely) and CsValidate
        // already flags it on its own terms ("self-loop", independent
        // of resolve()). Skipping it here does not lose LRUD: any LRUD
        // fields riding on such a shot are still found by
        // CsModel.lrudForStation, which scans survey.shots directly by
        // station name and does not consult resolve()'s
        // usable/skipped split at all.
        if (s.excludeFromAll || s.splay || s.from === "" || s.to === "" ||
                s.from === s.to) {
            skipped.push(s);
        } else {
            usable.push(s);
        }
    }

    // The anchor's own z is very often not supplied at all -- most
    // callers only know a plan position (a point clicked in the
    // drawing). If the anchor's OWN station happens to be a fixed
    // control point, defaulting an absent z to 0 would silently
    // rebase an absolute-datum cave (an entrance surveyed at 1250 ft,
    // say) down toward sea level -- and, worse, it would then disagree
    // with every OTHER fixed station's real elevation by exactly that
    // rebasing, manufacturing a fake vertical tie/loop misclosure
    // where the real survey has none. Falling back to the anchor's
    // own control z (when it has one) instead of 0 keeps it on its
    // true datum, for the same reason CsRevise.anchorZOf exists
    // elsewhere in this codebase. An EXPLICIT z -- including an
    // explicit 0 -- always wins; this fallback only fires when the
    // caller supplied none at all.
    //
    // SIXTH DOOR in the elevation-datum-trap family (see CsTraverse.
    // offset's own docblock for the first five): `.z || 0.0` treats an
    // absent z exactly like a real zero, same disease as `null * cos`.
    // CsTraverse.unusable is the established, already-reviewed test
    // for "cannot function as part of a real measurement" (absent or
    // non-finite, but never a real 0) -- reused here rather than
    // re-deriving the same distinction a second way. CsSurvex/CsWalls/
    // CsCsv default an omitted #Fix/*fix elevation to 0.0 themselves
    // (a real, if arbitrary, decision those parsers make on purpose,
    // not a gap), and SurveyNotebook's own anchor-building already
    // passes a real null through untouched (see its own "z stays NULL"
    // comments) -- so THIS particular fallback, on the explicit-anchor
    // path, was already guarding a contract no current caller could
    // violate.
    //
    // seedFixed(), a few dozen lines below, is a DIFFERENT story: it
    // had the IDENTICAL `f.z || 0.0` fabrication on survey.fixed's OWN
    // entries, and until the SEVENTH DOOR closed (CsTags.
    // surveyFromDocument, which used to write `getNumber(...) || 0.0`
    // into survey.fixed directly) that really was unreachable, for the
    // same "every current writer sets a real z" reason. It is not
    // unreachable any more -- surveyFromDocument now hands back a real
    // null for a station with no (or a garbled) Elevation tag, so
    // seedFixed has its own null-tolerant fix now too (see its own
    // comment) rather than silently re-fabricating the exact 0 this
    // file's OWN docblock spent a paragraph refusing to invent for the
    // anchor.
    //
    // What absent should DO: anchor WITHOUT an elevation (z = null,
    // not refused) and report it, rather than declining to place the
    // anchor at all. Refusing would also discard the anchor's x/y --
    // the very case the comment above calls the COMMON one ("most
    // callers only know a plan position") -- so plan view, which does
    // not read station.z at all, would silently stop resolving
    // anything for the ordinary "I don't know this point's elevation
    // yet" caller. `null` is also not a new vocabulary word: it is
    // exactly what CsProfile.zOf already treats as "no resolved Z" and
    // reports rather than fabricates (see its own docblock). A null
    // anchor z DOES still reach ordinary `+`/`-` arithmetic further
    // down this file and in CsAdjust (`fs.z + of.dz`, etc.), where
    // JavaScript's `null + n` is `n` -- so a descendant station's
    // elevation would be computed as though the anchor sat at 0. That
    // is the SAME class of gap this file's callers of CsTraverse.
    // offset were audited and left with (see Task 5b's commit): making
    // every `.z` arithmetic site in resolve()/CsAdjust null-tolerant is
    // a different, larger task, not this one, and -- like those
    // callers -- unreachable today because no current writer ever
    // hands this file a null z. `anchorZUnknown` names the gap so a
    // future caller/report can see it instead of it vanishing into an
    // ordinary-looking 0.
    var anchorEffectiveZ;
    var anchorZUnknown = null;
    // Parallel to anchorZUnknown, but plural: any *fix'ed/#Fix'ed
    // station seedFixed() places with no usable z (see that function's
    // own comment). Populated as seedFixed runs, potentially across
    // several calls (it is re-invoked whenever the pass loop gets
    // stuck), so this is declared here rather than inside it.
    var fixedZUnknown = [];
    if (opts.anchor !== undefined && opts.anchor !== null) {
        if (!CsTraverse.unusable(opts.anchor.z)) {
            anchorEffectiveZ = opts.anchor.z;
        } else if (survey.fixed.hasOwnProperty(opts.anchor.name) &&
                !CsTraverse.unusable(survey.fixed[opts.anchor.name].z)) {
            anchorEffectiveZ = survey.fixed[opts.anchor.name].z;
        } else {
            anchorEffectiveZ = null;
            anchorZUnknown = { name: opts.anchor.name,
                reason: "no elevation given for the anchor, and none " +
                    "on record for its control point" };
        }
        place(opts.anchor.name, opts.anchor.x, opts.anchor.y,
            anchorEffectiveZ, null);
    }

    var fixedNames = [];
    for (var fname in survey.fixed) {
        if (survey.fixed.hasOwnProperty(fname)) {
            fixedNames.push(fname);
        }
    }
    // Fixed stations anchor whatever the explicit anchor doesn't.
    // If an explicit anchor exists, fixed stations in ITS component
    // would fight it -- see the frame-aware seeding block below -- so
    // this only seeds stations not yet placed.
    //
    // It seeds EVERY not-yet-placed fixed station, not just one:
    // seeding them one-per-call used to leave every fixed point but
    // the first to be discovered lazily, only once the pass loop got
    // stuck. That is too late when a shot ties two fixed components
    // together -- such a leg can be processed in the very first pass
    // (its FROM end resolves and its TO end is reached in the same
    // pass), before the loop ever gets stuck, so the second fixed
    // point would be reached first as an ordinary "new" station and
    // its known coordinate silently discarded, along with the
    // misclosure against it. Seeding every fixed station up front
    // means a tying leg always finds both ends already known, so it
    // is honestly reported as a closure or tie (see below) instead of
    // quietly overwriting a control point. Re-called (again seeding
    // everything still unplaced) if the pass loop still gets stuck --
    // e.g. when an explicit opts.anchor left some fixed stations
    // un-seeded (see below) and one of them turns out to root a
    // component the anchor's traversal never reaches.
    var seedFixed = function() {
        var used = false;
        for (var k = 0; k < fixedNames.length; k++) {
            var fn = fixedNames[k];
            if (!stations.hasOwnProperty(fn)) {
                var f = survey.fixed[fn];
                // SIXTH DOOR, same fix, second site: `f.z || 0.0` is the
                // identical fabrication anchorEffectiveZ's own comment
                // (above) already refused for the explicit anchor --
                // this is where a *fix'ed/#Fix'ed station with no
                // elevation on record gets exactly the same treatment,
                // now that CsTags.surveyFromDocument (the "already-named
                // sibling bug" the old comment here pointed at) actually
                // hands this file a null z instead of a fabricated one.
                // x/y still place the station -- plan view and every
                // consumer that never reads .z are unaffected -- but z
                // stays null rather than silently rebasing an
                // absolute-datum cave toward sea level. CsTraverse.
                // unusable()'s test (not a bare `!== null`) also catches
                // a NaN from a corrupted numeric field the same way.
                var fz = CsTraverse.unusable(f.z) ? null : f.z;
                if (fz === null) {
                    fixedZUnknown.push(fn);
                }
                place(fn, f.x, f.y, fz, null);
                used = true;
            }
        }
        return used;
    };

    // Which station names share a shot-graph component, ignoring
    // coordinates entirely -- ordinary graph reachability over every
    // USABLE shot (unlike the per-shot bridge test below, which asks
    // "minus this one shot", this is the plain whole-graph answer).
    // Used just below to tell "a fixed station the anchor's traversal
    // would actually reach, and so would fight" from "an unrelated
    // fixed passage that anchors itself regardless of what this
    // anchor does" -- the anchor's frame offset must only ever touch
    // the former.
    var wholeGraphParent = {};
    var wgFind = function(x) {
        var root = x;
        while (wholeGraphParent.hasOwnProperty(root) &&
                wholeGraphParent[root] !== root) {
            root = wholeGraphParent[root];
        }
        while (wholeGraphParent.hasOwnProperty(x) &&
                wholeGraphParent[x] !== root) {
            var next = wholeGraphParent[x];
            wholeGraphParent[x] = root;
            x = next;
        }
        return root;
    };
    var wgUnion = function(a, b) {
        var ra = wgFind(a), rb = wgFind(b);
        if (ra !== rb) {
            wholeGraphParent[ra] = rb;
        }
    };
    for (i = 0; i < usable.length; i++) {
        wgUnion(usable[i].from, usable[i].to);
    }

    // ---- frame-aware seeding under an explicit anchor -------------
    //
    // opts.anchor pins one station at a DRAWING position the caller
    // chose (e.g. a point already on the sheet); survey.fixed pins
    // stations at WORLD control coordinates from #Fix / *fix records.
    // These are two different coordinate frames and nothing says they
    // share an origin or orientation. Pinning both verbatim would let
    // the offset BETWEEN the frames show up as a large fake
    // misclosure on whichever leg happens to tie them together --
    // that is the "fixed stations fighting an explicit anchor"
    // problem, and it is real: seeding both without translating one
    // of them is worse than not seeding at all.
    //
    // There is exactly one case where the frames can be honestly
    // reconciled: when the anchored station is ITSELF a fixed
    // station. Then the translation between its own control
    // coordinate and the position the caller anchored it at is not a
    // guess -- it is a fact handed to us by the caller's own anchor.
    // Applying that SAME translation to every other fixed station in
    // the anchor's own shot-graph component moves them into the
    // anchor's frame without inventing anything, and a real
    // disagreement in the control network still surfaces (as a tie or
    // loop misclosure) because a pure translation cannot erase a
    // measured discrepancy -- it only relocates where it shows up.
    // Fixed stations OUTSIDE the anchor's component are a different
    // cave passage entirely: they were never fighting this anchor, so
    // they are left alone here and anchor themselves via seedFixed,
    // exactly as they always have.
    //
    // When the anchored station has no control of its own, there is
    // no fact to compute a translation from -- nothing pins the
    // anchor's frame to the control frame at all. This falls back to
    // the pre-existing behavior: the fixed stations in the anchor's
    // component are left for ordinary traversal, same as before this
    // frame-aware seeding existed. That is still a silent discard of
    // real survey control, so it is named in controlFrame.notHonored
    // rather than buried a second time.
    var controlFrame = null;
    if (opts.anchor === undefined || opts.anchor === null) {
        if (!seedFixed() && usable.length > 0) {
            place(usable[0].from, 0.0, 0.0, 0.0, null);
        }
    } else if (survey.fixed.hasOwnProperty(opts.anchor.name)) {
        var anchorControl = survey.fixed[opts.anchor.name];
        // anchorEffectiveZ (computed above, where the anchor was
        // placed) already IS the right z to offset from: when the
        // caller gave an explicit z, that is it; when they didn't,
        // it already fell back to this very station's own control z,
        // which makes dz exactly 0 here -- no separate case needed.
        var offset = {
            dx: opts.anchor.x - anchorControl.x,
            dy: opts.anchor.y - anchorControl.y,
            dz: anchorEffectiveZ - (anchorControl.z || 0.0)
        };
        var appliedNames = [];
        for (var ofk = 0; ofk < fixedNames.length; ofk++) {
            var ofn = fixedNames[ofk];
            if (ofn === opts.anchor.name) {
                continue; // already placed as the anchor itself, above
            }
            if (wgFind(ofn) !== wgFind(opts.anchor.name)) {
                continue; // unrelated passage -- seedFixed anchors it
            }
            var ofc = survey.fixed[ofn];
            place(ofn, ofc.x + offset.dx, ofc.y + offset.dy,
                (ofc.z || 0.0) + offset.dz, null);
            appliedNames.push(ofn);
        }
        controlFrame = { offset: offset, applied: appliedNames,
            notHonored: [], reason: null };
    } else {
        var notHonoredNames = [];
        for (var nhk = 0; nhk < fixedNames.length; nhk++) {
            if (wgFind(fixedNames[nhk]) === wgFind(opts.anchor.name)) {
                notHonoredNames.push(fixedNames[nhk]);
            }
        }
        if (notHonoredNames.length > 0) {
            controlFrame = { offset: null, applied: [],
                notHonored: notHonoredNames,
                reason: "anchor station \"" + opts.anchor.name +
                    "\" has no fixed control of its own, so there is " +
                    "no known translation between its drawing " +
                    "position and the fixed stations' world " +
                    "coordinates -- they were left for ordinary " +
                    "traversal instead of being pinned" };
        }
    }

    // ---- classify a shot as a bridge or a cycle edge, lazily ------
    //
    // A closure (both ends already known when the pass loop reaches
    // it) is a genuine LOOP when some path other than the shot itself
    // already connects its two ends -- removing it leaves the survey
    // just as connected. It is a control TIE only when it is the one
    // and only connection between its ends: a graph bridge. This is a
    // property of the raw shot graph alone, computed from ALL usable
    // shots, so it never depends on which order shots resolve in or
    // which station ends up which spanning-tree root. That
    // independence matters: two fixed stations on the SAME ring
    // anchor at two different roots (the pass loop treats each as its
    // own tree), even though the ring is one component throughout, so
    // "did the parent chains meet" is the wrong question -- it is a
    // spanning-forest-root test, not a connectivity test, and the two
    // coincide only when a component has at most one anchor.
    //
    // A whole-graph union-find does not distinguish them either: it
    // would need to include the very shot being asked about, which
    // trivially unions its own endpoints and calls every leg a loop,
    // including a real tie's one connecting shot. The question that
    // actually distinguishes a tie from a loop is "excluding just
    // this shot, are its ends still connected via the others" -- a
    // bridge test, not a reachability test.
    //
    // A 2026-08 code-quality review measured this rebuilding a
    // union-find from ALL usable shots for EVERY usable shot,
    // regardless of whether that shot ever resolves as a closure at
    // all (an ordinary "new" leg was tested too, pointlessly -- by
    // definition nothing else yet connects its ends when it resolves,
    // so it can never be anything but a bridge). That is one O(m)
    // rebuild per usable shot, O(m^2) overall, and it showed:
    // 32ms/96ms/366ms/1501ms at 500/1000/2000/4000 shots under node
    // (quadratic doubling), which crosses the ~100ms perceptible
    // threshold well under 1,000 shots on QCAD's older, non-JIT
    // engine, where resolve() runs on every redraw.
    //
    // Only a closure shot ever needs this question answered, and
    // closures are a small minority of usable shots in real survey
    // data -- cave surveys are overwhelmingly tree-like (passages
    // branch; closed loops are comparatively rare and prized), so k
    // (closure count) is normally small relative to m (usable shot
    // count). Testing lazily -- once per closure, the first time it is
    // asked, cached after that so a repeated query is free -- turns
    // the O(m^2) above into O(k*m): a 10,000-shot cave with 50 loops
    // is 500k union operations, not 100M.
    //
    // A single-pass Tarjan low-link bridge finder would be O(n+m) and
    // asymptotically better still, but it is a materially different,
    // unverified algorithm: it has to track edge IDs rather than
    // parent vertices to avoid mistaking a parallel leg (two shots
    // between the same pair of stations -- ordinary in real survey
    // data, e.g. a there-and-back) for a back edge. This union-find
    // test is already verified correct against four topologies
    // (square, tie, there-and-back, two-fixed ring) plus the Task 1b
    // control-frame fixtures; making it lazy removes the quadratic
    // without trading a verified classifier for an unverified one.
    // Revisit only if a real survey shows k large enough that O(k*m)
    // itself becomes the bottleneck.
    var bridgeCache = [];
    var shotIsBridge = function(i) {
        if (bridgeCache[i] !== undefined) {
            return bridgeCache[i];
        }
        var ufParent = {};
        var ufFind = function(x) {
            var root = x;
            while (ufParent.hasOwnProperty(root) && ufParent[root] !== root) {
                root = ufParent[root];
            }
            while (ufParent.hasOwnProperty(x) && ufParent[x] !== root) {
                var next = ufParent[x];
                ufParent[x] = root;
                x = next;
            }
            return root;
        };
        var ufUnion = function(a, b) {
            var ra = ufFind(a), rb = ufFind(b);
            if (ra !== rb) {
                ufParent[ra] = rb;
            }
        };
        for (var bj = 0; bj < usable.length; bj++) {
            if (bj === i) {
                continue;
            }
            ufUnion(usable[bj].from, usable[bj].to);
        }
        var result = ufFind(usable[i].from) !== ufFind(usable[i].to);
        bridgeCache[i] = result;
        return result;
    };

    // ---- resolve by repeated passes ------------------------------
    var resolvedFlags = [];
    for (i = 0; i < usable.length; i++) {
        resolvedFlags.push(false);
    }

    var progress = true;
    while (progress) {
        progress = false;
        for (i = 0; i < usable.length; i++) {
            if (resolvedFlags[i]) {
                continue;
            }
            var shot = usable[i];
            var haveFrom = stations.hasOwnProperty(shot.from);
            var haveTo = stations.hasOwnProperty(shot.to);

            if (!haveFrom && !haveTo) {
                continue;
            }

            resolvedFlags[i] = true;
            progress = true;

            if (haveFrom && haveTo) {
                // closure: both ends already known
                var o = CsTraverse.offset(shot, tapeMode);
                var fromSt = stations[shot.from];
                var toSt = stations[shot.to];
                var mis = {
                    shot: shot,
                    atStation: shot.to,
                    dx: fromSt.x + o.dx - toSt.x,
                    dy: fromSt.y + o.dy - toSt.y,
                    dz: fromSt.z + o.dz - toSt.z
                };
                mis.horizontal = Math.sqrt(mis.dx * mis.dx + mis.dy * mis.dy);
                mis.vertical = Math.abs(mis.dz);
                mis.distance = Math.sqrt(mis.horizontal * mis.horizontal +
                    mis.dz * mis.dz);

                // A loop closes a ring: some other path already joins
                // its ends, so this shot is not the only connection
                // between them (shotIsBridge(i) false). A control TIE
                // is the opposite -- this shot is the one and only
                // link between two otherwise separate components, the
                // everyday case being a cave with two *fix'ed
                // entrances. A tie has no ring, so a "percent of
                // traverse length" computed for it is meaningless and
                // used to make CsValidate cry blunder over nothing.
                // This is the only place the bridge test is asked --
                // exactly the closure shots, never the "new" ones --
                // see the comment above shotIsBridge for why that
                // restriction is what removes the quadratic.
                var sameComponent = !shotIsBridge(i);
                mis.kind = sameComponent ? "loop" : "tie";
                closures.push(mis);

                var described = CsNetwork.describeLoop(shot, mis, parent,
                    tapeMode, sameComponent);
                if (sameComponent) {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "closure" });
                    loops.push(described);
                } else {
                    legs.push({ shot: shot, from: shot.from, to: shot.to,
                        kind: "tie" });
                    ties.push(described);
                }
            } else if (haveFrom) {
                var of = CsTraverse.offset(shot, tapeMode);
                var fs = stations[shot.from];
                place(shot.to, fs.x + of.dx, fs.y + of.dy, fs.z + of.dz,
                    { prev: shot.from, shot: shot });
                legs.push({ shot: shot, from: shot.from, to: shot.to,
                    kind: "new" });
            } else {
                // know TO only: walk the shot backwards
                var ob = CsTraverse.reverseOffset(shot, tapeMode);
                var ts = stations[shot.to];
                place(shot.from, ts.x + ob.dx, ts.y + ob.dy, ts.z + ob.dz,
                    { prev: shot.to, shot: shot });
                legs.push({ shot: shot, from: shot.from, to: shot.to,
                    kind: "new" });
            }
        }

        // a disconnected component with its own fixed point?
        if (!progress) {
            var remaining = false;
            for (i = 0; i < usable.length; i++) {
                if (!resolvedFlags[i]) {
                    remaining = true;
                    break;
                }
            }
            if (remaining && seedFixed()) {
                progress = true;
            }
        }
    }

    var unresolved = [];
    for (i = 0; i < usable.length; i++) {
        if (!resolvedFlags[i]) {
            unresolved.push(usable[i]);
        }
    }

    return {
        stations: stations,
        legs: legs,
        closures: closures,
        loops: loops,
        ties: ties,
        anchors: anchors,
        controlFrame: controlFrame,
        unresolved: unresolved,
        skipped: skipped,
        anchorZUnknown: anchorZUnknown,
        fixedZUnknown: fixedZUnknown
    };
};

/**
 * Builds the human-facing description of one loop or tie from a
 * closure shot: the path of stations around it, its surveyed length,
 * and the misclosure as a distance and a percentage of that length.
 *
 * \param sameComponent true when the caller's bridge test found this
 *        shot is not the only connection between its ends (a loop);
 *        false for a genuine control tie (a bridge).
 *
 * \return {from, to, path, traverseLength, error, horizontal,
 *         vertical, percent, viaControl} -- see CsNetwork.resolve's
 *         own \return block for path's join semantics (a real walk
 *         when the ancestor chains share a root, fromChain ++
 *         reverse(toChain) when they don't) and what viaControl
 *         flags. percent is null for a tie (sameComponent false):
 *         there is no ring, so no traverse length a misclosure is a
 *         meaningful fraction of.
 */
CsNetwork.describeLoop = function(shot, misclosure, parent, tapeMode,
        sameComponent) {
    // Walk both ends' ancestor chains back to their common root, which
    // closes the loop path. Chains are short (a survey's depth), so
    // the simple quadratic meet-finder is fine.
    var chain = function(name) {
        var out = [name];
        var p = parent[name];
        var guard = 0;
        while (p !== null && p !== undefined && guard++ < 100000) {
            out.push(p.prev);
            p = parent[p.prev];
        }
        return out;
    };
    var fromChain = chain(shot.from);
    var toChain = chain(shot.to);

    var toSet = {};
    for (var i = 0; i < toChain.length; i++) {
        toSet[toChain[i]] = i;
    }
    var meet = -1, meetTo = -1;
    for (i = 0; i < fromChain.length; i++) {
        if (toSet.hasOwnProperty(fromChain[i])) {
            meet = i;
            meetTo = toSet[fromChain[i]];
            break;
        }
    }

    // sum leg distances along a chain, up to (not including) index
    // "upto" -- the shared helper for both branches below
    var walk = function(chainArr, upto) {
        var sum = 0.0;
        for (var k = 0; k < upto; k++) {
            var p = parent[chainArr[k]];
            if (p !== null && p !== undefined) {
                sum += p.shot.distance;
            }
        }
        return sum;
    };

    var path = [];
    var traverseLength = shot.distance;
    var viaControl = false;
    if (meet >= 0) {
        // The chains share a root: a plain single-anchor ring. Walk
        // out from each end only as far as the meeting point. Every
        // consecutive pair here is a real surveyed adjacency.
        for (i = 0; i <= meet; i++) {
            path.push(fromChain[i]);
        }
        for (i = meetTo - 1; i >= 0; i--) {
            path.push(toChain[i]);
        }
        traverseLength += walk(fromChain, meet) + walk(toChain, meetTo);
    } else if (sameComponent) {
        // The chains never meet, yet the bridge test says this shot
        // is not the only link between its ends -- two different
        // fixed stations on the SAME ring, each rooting its own half.
        // The ring still closes; it closes THROUGH the two controls,
        // so the circuit is this shot plus both full chains out to
        // their own anchors. path is fromChain ++ reverse(toChain),
        // e.g. [RB, RA, RC] -- the pair straddling the join (RA, RC
        // here) is NOT a surveyed adjacency, only a shared-control
        // one, so viaControl names that fact for any consumer that
        // would otherwise read consecutive path entries as legs.
        path = fromChain.concat(toChain.slice().reverse());
        traverseLength += walk(fromChain, fromChain.length) +
            walk(toChain, toChain.length);
        viaControl = true;
    } else {
        // Genuinely separate components: no ring, report the two
        // endpoints only -- the tying shot's own from/to, which IS a
        // real surveyed leg, so viaControl stays false here.
        path = [shot.from, shot.to];
    }

    // A tie has no ring, so there is no traverse length a misclosure
    // is a meaningful fraction of -- percent is null, matching
    // CsNetwork.resolve's own "ties carry no meaningful percent"
    // documentation. Every consumer that formats a percent (CsReport,
    // CsValidate, CsStats, CsRevise) reads it only from resolved.loops,
    // never resolved.ties, so this null is never handed to a
    // .toFixed() call.
    var percent = sameComponent ?
        (traverseLength > 0 ?
            (misclosure.distance / traverseLength) * 100.0 : 0.0) :
        null;

    return {
        from: shot.from,
        to: shot.to,
        path: path,
        traverseLength: traverseLength,
        error: misclosure.distance,
        horizontal: misclosure.horizontal,
        vertical: misclosure.vertical,
        percent: percent,
        viaControl: viaControl
    };
};
