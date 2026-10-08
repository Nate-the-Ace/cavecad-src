// CsProfile.js -- the extended elevation: unrolling a survey onto one
// horizontal axis, and the floor and ceiling lines that go with it.
//
// Part of the Cave Survey Core library: pure functions. Nothing here
// touches a document, so the whole module runs under plain node.
//
// AN EXTENDED ELEVATION IS NOT A PROJECTED PROFILE. The horizontal
// axis is distance travelled along the passage, so no passage hides
// behind another and every leg draws at its true length. A projected
// profile -- real coordinates flattened onto one vertical plane -- is
// a different tool and writes to a different layer.
//
// ONE BAND PER SURVEY RUN, and a run is decided by the STATION NAME,
// because that is where the surveyor's own intent already lives. Split
// a name into alternating letter and digit groups; the run key is
// every group but the last, the sequence within the run is the last:
//
//   A20       -> run A,        seq 20
//   A13a1     -> run A13a,     seq 1     (a spur, tying in at A13)
//   A13b1     -> run A13b,     seq 1     (a second spur off A13)
//   A13a2b1   -> run A13a2b,   seq 1     (a spur off a spur)
//   B1        -> run B,        seq 1
//
// A lowercase group means a spur, and dropping it gives the station it
// ties to. A spur long enough to deserve promotion becomes its own
// letter run (B1, B2, ...) -- the surveyor's decision, made by typing
// a name. THERE IS NO LENGTH THRESHOLD ANYWHERE IN THIS FILE.
//
// Names decide MEMBERSHIP; the shot GRAPH decides ORDER. A run's
// parent is the run owning the station its first leg ties to. That is
// what makes A13a1 and B1 behave identically -- A13a lands under A
// because its tie station is A13, not because its name looks nested.

var CsProfile = {};

/**
 * Splits a station name into {base, seq} on its trailing group of
 * like characters. Returns null for anything that is not a station
 * name: empty, null, or a splay (which carries a dot).
 *
 * A name with only one group (e.g. "A", "12") has no trailing group to
 * peel off, so the WHOLE name becomes the base and the sequence comes
 * back empty -- it still JOINS the run its base names ("A" joins run
 * "A" alongside "A1", "A2", ...), it does not become a separate run
 * of its own. It is that run's ORIGIN, though, not just another
 * member: seqOrder (below) sorts an empty sequence ahead of every
 * numeric one for exactly that reason, so "A" leads "A1, A2, A10"
 * instead of sorting after them.
 */
CsProfile.splitName = function(name) {
    if (name === undefined || name === null) {
        return null;
    }
    var s = String(name);
    if (s === "" || s.indexOf(".") >= 0) {
        return null;   // splays are named A3.1 and are not stations
    }
    // groups of digits, of lowercase, of uppercase, or of anything else
    var groups = s.match(/[0-9]+|[a-z]+|[A-Z]+|[^0-9a-zA-Z]+/g);
    if (groups === null || groups.length === 0) {
        return null;
    }
    if (groups.length === 1) {
        return { base: s, seq: "" };
    }
    var seq = groups[groups.length - 1];
    return { base: s.substring(0, s.length - seq.length), seq: seq };
};

/** The run a station belongs to, or null when the name is not one. */
CsProfile.runKeyOf = function(name) {
    var s = CsProfile.splitName(name);
    return (s === null) ? null : s.base;
};

/**
 * The station a run ties in at, read from its own key: drop a
 * trailing lowercase group. "A13a" -> "A13"; "A13a2b" -> "A13a2".
 * null for a letter run (B, A), which has no name-derived tie and
 * must get its parent from the graph.
 *
 * TAKES A RUN KEY, NOT A STATION NAME -- hence the name. Fed a station
 * name it returns null (no trailing lowercase group), which is the
 * same value that legitimately means "letter run, ask the graph", so
 * the mistake would look like an answer. Read call sites as
 * tieNameOfRun(runKeyOf(name)).
 */
CsProfile.tieNameOfRun = function(runKey) {
    if (runKey === undefined || runKey === null) {
        return null;
    }
    var s = String(runKey);
    var m = s.match(/[a-z]+$/);
    if (m === null) {
        return null;
    }
    var tie = s.substring(0, s.length - m[0].length);
    return (tie === "") ? null : tie;
};

/**
 * Total order for a run's members. NOT a style preference: CaveCAD's
 * own Array.prototype.sort is UNSTABLE (measured -- it scrambled 24
 * elements that an always-0 comparator called equal, where node's
 * stable sort left the same input alone), so two DISTINCT stations
 * this ever ranks as equal would come back in a different order in
 * each engine, and node's stability would hide the bug from
 * `node tests/js_unit.js` completely. Every branch below must
 * therefore end in a real order, never a tie between different inputs.
 *
 * An empty sequence -- the run's origin station, e.g. bare "A" beside
 * "A1", "A2" -- always sorts first. It is where the run starts, not
 * merely a string that happens to precede "1".
 *
 * Numeric sequences compare as numbers, so A10 follows A9. Two
 * sequences that parse to the same number but differ in text (A1 vs
 * A01 -- distinct stations, if a survey really has both) fall back to
 * a text compare instead of reporting them equal.
 *
 * Everything else compares as text.
 */
CsProfile.seqOrder = function(a, b) {
    if (a === "" || b === "") {
        return (a === b) ? 0 : ((a === "") ? -1 : 1);
    }
    var na = /^[0-9]+$/.test(a), nb = /^[0-9]+$/.test(b);
    if (na && nb) {
        var d = parseInt(a, 10) - parseInt(b, 10);
        // equal value, different text ("A1" vs "A01"): order by text, so a
        // zero-padded name and a bare one never depend on sort stability --
        // this engine's sort does not have any
        return (d !== 0) ? d : ((a < b) ? -1 : ((a > b) ? 1 : 0));
    }
    if (na !== nb) {
        return na ? -1 : 1;   // numbered stations before lettered ones
    }
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
};

/**
 * Groups a resolved survey's stations into runs.
 *
 * Every resolved station's .seq is REQUIRED, not optional --
 * CsNetwork.resolve assigns it and CsAdjust preserves it through
 * adjustment. Sorting by it below is not defensive extra credit: this
 * engine's `for...in` property order is not guaranteed to match
 * resolution order at all -- a purely-numeric station name (e.g. "9")
 * is a canonical array index by the language spec and enumerates
 * ahead of every non-numeric key regardless of when it was inserted,
 * even under node -- so skipping the sort silently reorders any run
 * whose stations happen to include one. If .seq were ever missing,
 * `undefined - undefined` is NaN, every comparison reads as "unchanged",
 * and CaveCAD's unstable sort (see seqOrder above) then scrambles run
 * order completely -- so this is written to depend on .seq existing,
 * not to tolerate its absence.
 *
 * \param resolved CsNetwork.resolve() result, or undefined/null for
 *                 no survey resolved yet
 * \return {
 *   runs:  {runKey: {key, stations: [name] in sequence order}},
 *   order: [runKey] in first-appearance order (resolution order),
 *   ungrouped: [name] station names CsProfile.splitName refuses --
 *              empty, null, or dotted (splay) names, NOT simply every
 *              name that looks unusual: "?", "A#", "A1-" all parse
 *              into a run just fine and never land here
 * }
 */
CsProfile.groupRuns = function(resolved) {
    var runs = {}, order = [], ungrouped = [];
    if (resolved === undefined || resolved === null ||
            resolved.stations === undefined || resolved.stations === null) {
        return { runs: runs, order: order, ungrouped: ungrouped };
    }

    var names = [];
    for (var n in resolved.stations) {
        if (resolved.stations.hasOwnProperty(n)) {
            names.push(n);
        }
    }
    // resolution order, so run order follows the survey rather than
    // whatever order the engine hands properties back in -- see the
    // docblock above for why this is not a no-op even when property
    // order happens to already agree
    names.sort(function(a, b) {
        return resolved.stations[a].seq - resolved.stations[b].seq;
    });

    for (var i = 0; i < names.length; i++) {
        var s = CsProfile.splitName(names[i]);
        if (s === null) {
            ungrouped.push(names[i]);
            continue;
        }
        if (!runs.hasOwnProperty(s.base)) {
            runs[s.base] = { key: s.base, stations: [] };
            order.push(s.base);
        }
        // carries the sequence splitName already parsed, so the sort
        // below doesn't re-split every name a second time
        runs[s.base].stations.push({ name: names[i], seq: s.seq });
    }

    for (var k = 0; k < order.length; k++) {
        var members = runs[order[k]].stations;
        members.sort(function(a, b) {
            return CsProfile.seqOrder(a.seq, b.seq);
        });
        var flat = [];
        for (var m = 0; m < members.length; m++) {
            flat.push(members[m].name);
        }
        // ordered by NAME (via its sequence), which is what makes a
        // later chain search and its omitted-station list deterministic.
        // This is NOT the band's unroll order -- a later task derives
        // that from the shot graph, not from how stations are named.
        runs[order[k]].stations = flat;
    }

    return { runs: runs, order: order, ungrouped: ungrouped };
};

/**
 * Station -> the legs that touch it, closures and splays excluded.
 * THE WALKED-CHAIN GRAPH: its consumer is the chain search that lays
 * out a band (CsProfile.longestChain), which resolves each step through
 * CsProfile.legBetween -- and that skips closures. Letting a closure in
 * here would let a chain include a step legBetween cannot resolve, and
 * the band would stop at it.
 *
 * INVARIANT: this function's kind filter (closures out, "new"/"tie" in)
 * and CsProfile.legBetween's kind filter (Task 3) MUST stay identical.
 * They are written to agree BY STATEMENT, not by luck (Task 2's review
 * flagged that the earlier draft only agreed incidentally) -- both
 * exclude exactly "closure" (and, belt-and-braces, a splay shot,
 * which resolve() never actually emits as a leg). If either filter
 * ever changes without the other, a chain step this graph offers
 * becomes one legBetween cannot resolve, and the band search stops
 * dead at it with no error, just a short band.
 *
 * THE STATED EXCEPTION: there is a THIRD leg lookup, CsProfile.
 * tieLegBetween, used for exactly one step per band -- the tie step,
 * where a run attaches to its parent. That step is never offered by
 * this graph at all (it is not an interior chain step), so it is not
 * bound by the invariant above; tieLegBetween deliberately admits a
 * closure there, because CsProfile.hierarchy (which chooses a run's
 * tie) admits them too. A reader who stops at "two functions, one
 * invariant" has not seen the whole picture -- see tieLegBetween's own
 * docblock for why the exception exists and what it costs.
 *
 * THE LEG INDEX DOES NOT MOVE ANY OF THIS. CsProfile.legIndex buckets
 * legs by unordered station pair so those two lookups stop scanning all
 * of resolved.legs, and it deliberately filters NOTHING -- there are
 * still exactly two kind filters in this file, in the two functions
 * named above, and the invariant is still between those two. See
 * CsProfile.legIndex for why a filtering index would have been a third
 * copy of the very thing this paragraph exists to keep singular.
 *
 * Run hierarchy does NOT use this graph; it builds its own from
 * resolved.legs, closures included, because a second contact through a
 * ring is exactly the thing it has to report. See hierarchy().
 *
 * \return {stationName: [{leg, other, seq}]} seq = leg index, so
 *         "which contact came first" is answerable
 */
CsProfile.adjacency = function(resolved) {
    var adj = {};
    if (resolved === undefined || resolved === null ||
            resolved.legs === undefined || resolved.legs === null) {
        return adj;   // same empty-input tolerance as groupRuns()
    }
    var add = function(at, other, leg, seq) {
        if (!adj.hasOwnProperty(at)) {
            adj[at] = [];
        }
        adj[at].push({ leg: leg, other: other, seq: seq });
    };
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        // Belt-and-braces: CsNetwork.resolve routes splay shots to
        // `skipped` and never emits a splay leg at all, so this branch
        // has no live case today. Kept so a future change to resolve()
        // can't silently let a splay leg into the walked-chain graph.
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        add(leg.from, leg.to, leg, i);
        add(leg.to, leg.from, leg, i);
    }
    return adj;
};

/**
 * Which run each run hangs off, where it ties in, and what order the
 * bands go in.
 *
 * TWO PHASES, not one ranked pass. Phase 1 assigns parents using ONLY
 * "new" legs (a measured placement fact -- the directional seq test is
 * safe here) and breaks any cycle it finds among them; a cycle in
 * phase 1 is genuine, because every edge involved really did place a
 * station. Phase 2 then lets a run still parentless after phase 1 use
 * its closure/tie contacts to fill the gap, but skips any candidate
 * that is already a descendant of this run -- an ordinary loop (a
 * spur closing a ring back onto its own trunk) is the everyday case
 * this guards: the spur already has the trunk as parent from phase 1,
 * so the trunk seeing the SAME closure from its own side must not
 * also claim the spur as ITS parent. A skipped candidate creates no
 * parent, no cycle, and no secondTie -- it is the same physical
 * junction the descendant already reported from its own side, and
 * reporting it twice would not be new information. This is why an
 * ordinary loop-closing survey reports an EMPTY `cycles` -- only a
 * loop made entirely of "new" legs (phase 1) is a real ambiguity;
 * every closure/tie ambiguity has an escape hatch (skip and let the
 * other side keep it) that a "new"-leg loop does not.
 *
 * The name-derived tie (CsProfile.tieNameOfRun) is used only as a
 * cross-check -- when the two disagree the graph wins, because it is
 * the measured fact, and the disagreement is reported as a likely
 * naming blunder. That check runs even when the graph found NO
 * contact at all, in either phase: a named spur with zero contacts
 * still had a name asserting a tie, and reporting nothing there would
 * hide the single most suspicious state this function can produce.
 *
 * \param grouped CsProfile.groupRuns() result
 * \param resolved CsNetwork.resolve() result
 * \return {
 *   parents:    {runKey: parentRunKey | null},
 *   ties:       {runKey: stationName | null} the station on the
 *               PARENT run's side of the tie -- NOT a station of
 *               runKey's own. "B's tie is A3" means B connects to A at
 *               A3, a station belonging to A, not to B,
 *   order:      [runKey] depth first, siblings by junction distance,
 *   secondTies: [{run, otherStation, otherRun}] further contacts run
 *               has beyond its own primary tie. otherStation and
 *               otherRun both describe the OTHER end -- the run
 *               actually touched, which is not necessarily run's
 *               parent (the parent can lie in a third run while a
 *               second contact lands in yet another),
 *   mismatches: [{run, expected, actual}] name vs graph; actual is null
 *               when the graph found no contact at all,
 *   orphans:    [runKey] runs PHYSICALLY DISCONNECTED from the primary
 *               root -- no leg of any kind, walked or not, reaches
 *               the root's own component (decided by a raw union-find
 *               over every leg in resolved.legs, independent of the
 *               kind-ranked parent forest above). THIS IS THE ONLY
 *               FIELD THAT TELLS A SURVEYOR TO GO SHOOT A CONNECTING
 *               LEG -- everything else in this run's data may be fine,
 *               but nothing ties it to the rest of the cave at all,
 *   strandedRoots: [runKey] parentless runs OTHER than the primary
 *               root that raw connectivity shows ARE part of the same
 *               physical cave -- phase 2's kind-ranked, descendant-
 *               avoiding search simply never found a way to attach
 *               them as anyone's child. THIS ASKS NOTHING OF A
 *               SURVEYOR: the data is fine and nothing needs shooting;
 *               it is purely a report of how this run ended up as its
 *               own band-tree root. A run in `orphans` is never ALSO
 *               here, and vice versa -- the two fields never share a
 *               member, by construction,
 *   cycles:     [[runKey, ...]] any loop found among phase-1 ("new"-leg)
 *               parents and broken -- see the phase-1 cycle-breaking
 *               pass below. Empty for an ordinary closure/tie loop,
 *               which phase 2 resolves without ever needing to detect
 *               a cycle at all
 * }
 */
CsProfile.hierarchy = function(grouped, resolved) {
    if (grouped === undefined || grouped === null ||
            grouped.order === undefined || grouped.order === null ||
            resolved === undefined || resolved === null ||
            resolved.legs === undefined || resolved.legs === null ||
            resolved.stations === undefined || resolved.stations === null) {
        // Same empty-input tolerance as groupRuns(): a caller can hand
        // this an unresolved/empty survey and get the all-empty shape
        // back rather than a TypeError -- the first stage of this
        // pipeline (groupRuns) already tolerates that, and the next two
        // stages should not be the ones that crash on it.
        return { parents: {}, ties: {}, order: [], secondTies: [],
            mismatches: [], orphans: [], strandedRoots: [], cycles: [] };
    }

    var parents = {}, ties = {}, secondTies = [], mismatches = [];
    var orphans = [], strandedRoots = [];
    var runOf = {};
    var i, k;

    for (i = 0; i < grouped.order.length; i++) {
        var run = grouped.runs[grouped.order[i]];
        for (k = 0; k < run.stations.length; k++) {
            runOf[run.stations[k]] = run.key;
        }
    }

    // CONTACTS USE A DIFFERENT GRAPH FROM adjacency(), deliberately.
    // Closure and tie legs count here: a closure is a real surveyed
    // shot, and a run that touches its parent a second time through a
    // ring (B1-A4 closing B1-A3-A4) has to be able to report that
    // second contact -- excluded, secondTies can never populate at all.
    // adjacency() stays closure-free because ITS consumer is the chain
    // search, which resolves each step through CsProfile.legBetween --
    // and that skips closures too, so a chain routed through a leg
    // legBetween cannot find would truncate its own band.
    var contactLegs = [];
    for (i = 0; i < resolved.legs.length; i++) {
        var cl = resolved.legs[i];
        // Belt-and-braces, same as adjacency(): resolve() never emits a
        // splay leg, so this branch has no live case today.
        if (cl.shot !== undefined && cl.shot !== null && cl.shot.splay) {
            continue;
        }
        contactLegs.push({ from: cl.from, to: cl.to, kind: cl.kind, seq: i });
    }

    var seqOf = function(name) {
        var st = resolved.stations[name];
        return (st === undefined || st === null || st.seq === undefined ||
            st.seq === null) ? Number.MAX_VALUE : st.seq;
    };

    // The earliest (smallest-seq) station in each run -- used only to
    // break a cycle in the parent map, below. Computed once here
    // because it depends solely on run membership, not on contacts.
    var earliestSeqOfRun = {};
    for (i = 0; i < grouped.order.length; i++) {
        var erKey = grouped.order[i];
        var erStations = grouped.runs[erKey].stations;
        var erMin = Number.MAX_VALUE;
        for (k = 0; k < erStations.length; k++) {
            var erSeq = seqOf(erStations[k]);
            if (erSeq < erMin) {
                erMin = erSeq;
            }
        }
        earliestSeqOfRun[erKey] = erMin;
    }

    // Per run, split contacts into two lists by leg kind. Each list is
    // already in ascending seq (leg-index) order because contactLegs
    // itself is iterated in that order and entries are only ever
    // appended, never reordered -- but each is sorted explicitly below
    // anyway, so the guarantee does not quietly depend on that staying
    // true. seq is a leg's unique index and one leg contributes at most
    // one entry to a given run's list (both endpoints in this run is
    // skipped below), so within a list this can never tie for distinct
    // entries.
    var rank0ByRun = {}, rank1ByRun = {};
    for (i = 0; i < grouped.order.length; i++) {
        var key = grouped.order[i];
        var stations = grouped.runs[key].stations;
        var inRun = {};
        for (k = 0; k < stations.length; k++) {
            inRun[stations[k]] = true;
        }
        var r0 = [], r1 = [];
        for (k = 0; k < contactLegs.length; k++) {
            var cg = contactLegs[k];
            var mine = null, other = null;
            if (inRun[cg.from] === true) {
                mine = cg.from;
                other = cg.to;
            } else if (inRun[cg.to] === true) {
                mine = cg.to;
                other = cg.from;
            } else {
                continue;
            }
            var otherRun = runOf[other];
            if (otherRun === undefined || otherRun === key) {
                continue;
            }
            if (cg.kind === "new") {
                // A "new" leg's smaller-seq end genuinely is the parent
                // side -- that is also what makes a backwards-entered
                // spur (A2a1->A2) resolve correctly.
                if (seqOf(other) >= seqOf(mine)) {
                    continue;
                }
                r0.push({ station: other, otherRun: otherRun, seq: cg.seq });
            } else {
                // "closure"/"tie": both ends were already placed by the
                // time this leg was walked, so seq says nothing about
                // parentage -- and a *fix'ed station is SEEDED before
                // any traversal at all (CsNetwork.seedFixed), so its
                // seq can be artificially tiny despite the survey
                // reaching it, graph-wise, very late. Kept, unfiltered,
                // as a rank-1 candidate for phase 2 below -- never used
                // to assign a phase-1 parent.
                r1.push({ station: other, otherRun: otherRun, seq: cg.seq });
            }
        }
        r0.sort(function(a, b) { return a.seq - b.seq; });
        r1.sort(function(a, b) { return a.seq - b.seq; });
        rank0ByRun[key] = r0;
        rank1ByRun[key] = r1;
    }

    // ---- Phase 1: parents from "new" legs only ---------------------
    //
    // This is the only source of a PRIMARY tie: a "new" leg is the leg
    // that actually placed a station, so its direction is a measured
    // fact. Multiple qualifying "new" contacts for the same run are
    // rare but possible; the earliest becomes the tie, the rest become
    // ordinary secondTies.
    //
    // seenByRun[key] tracks every station already reported as a tie or
    // secondTie FOR THIS RUN, seeded here and REUSED (not reset) when
    // phase 2 looks at this same run's closure/tie contacts below --
    // one map spanning both phases, so a station a "new" leg already
    // reported cannot also be reported again by a later closure that
    // happens to land on the identical station.
    var seenByRun = {};
    for (i = 0; i < grouped.order.length; i++) {
        var p1Key = grouped.order[i];
        var p1r0 = rank0ByRun[p1Key];
        var seen1 = {};
        if (p1r0.length === 0) {
            parents[p1Key] = null;
            ties[p1Key] = null;
        } else {
            parents[p1Key] = p1r0[0].otherRun;
            ties[p1Key] = p1r0[0].station;
            seen1[p1r0[0].station] = true;
            for (k = 1; k < p1r0.length; k++) {
                var st0 = p1r0[k].station;
                if (seen1.hasOwnProperty(st0)) {
                    continue;   // same junction reached twice, not a second tie
                }
                seen1[st0] = true;
                secondTies.push({
                    run: p1Key,
                    otherStation: st0,
                    otherRun: p1r0[k].otherRun
                });
            }
        }
        seenByRun[p1Key] = seen1;
    }

    // ---- break any cycle among phase-1 (new-leg-only) parents -------
    //
    // Each run has at most one parent, so `parents` is a functional
    // graph: walking parent pointers from any run either reaches a
    // null-parent root, or loops back on itself. A loop here is genuine
    // -- every edge involved is a "new" leg, a measured placement fact
    // -- unlike a closure/tie edge, which phase 1 never sees at all. A
    // side passage renumbered back into the trunk (A1..A3, B1-B2,
    // A4-A5, every leg "new") is exactly this: each run's own contact
    // list independently and correctly picks a "new" edge to the
    // other, and only walking the parent chain afterward finds the
    // resulting cycle.
    //
    // The loop member whose EARLIEST station (by resolution .seq) is
    // smallest becomes the root: it is the one that was on the ground
    // first, so its claim to being upstream of the rest of the loop is
    // at least as good as any other member's. Its own discarded
    // parent/tie is not thrown away -- it becomes a secondTie, so the
    // graph fact it carried is demoted, not deleted. Pushed to
    // `cycleDemotions`, NOT `secondTies` directly: the discarded
    // parent is, by construction, always a descendant of the elected
    // root once the cycle is broken (that is what breaking the cycle
    // in the root's favour MEANS), so the general descendant-filter
    // phase 2 runs below (see M-2 in the review) would otherwise
    // delete this very entry as if it were an order-dependent
    // duplicate. It is not one -- it is required by design -- so it is
    // kept out of the array that filter inspects, and merged back in
    // once that filter has run.
    var cycles = [];
    var settled = {};
    var cycleDemotions = [];
    var breakCycle = function(members) {
        var electedRoot = members[0];
        var bestSeq = earliestSeqOfRun[electedRoot];
        for (var m = 1; m < members.length; m++) {
            var s = earliestSeqOfRun[members[m]];
            if (s < bestSeq) {
                bestSeq = s;
                electedRoot = members[m];
            }
        }
        var discardedParent = parents[electedRoot];
        var discardedTie = ties[electedRoot];
        if (discardedTie !== null && discardedTie !== undefined) {
            var already = false;
            for (var si = 0; si < cycleDemotions.length; si++) {
                if (cycleDemotions[si].run === electedRoot &&
                        cycleDemotions[si].otherStation === discardedTie) {
                    already = true;
                    break;
                }
            }
            if (!already) {
                cycleDemotions.push({
                    run: electedRoot,
                    otherStation: discardedTie,
                    otherRun: discardedParent
                });
            }
        }
        parents[electedRoot] = null;
        ties[electedRoot] = null;
    };

    for (i = 0; i < grouped.order.length; i++) {
        var startKey = grouped.order[i];
        if (settled.hasOwnProperty(startKey)) {
            continue;
        }
        var path = [], indexInPath = {};
        var cur = startKey;
        while (true) {
            if (settled.hasOwnProperty(cur)) {
                break;   // walks into an already-settled acyclic chain
            }
            if (indexInPath.hasOwnProperty(cur)) {
                var cycleMembers = path.slice(indexInPath[cur]);
                breakCycle(cycleMembers);
                cycles.push(cycleMembers);
                break;
            }
            indexInPath[cur] = path.length;
            path.push(cur);
            var p = parents[cur];
            if (p === null || p === undefined || !grouped.runs.hasOwnProperty(p)) {
                break;   // reached a root
            }
            cur = p;
        }
        for (var pi = 0; pi < path.length; pi++) {
            settled[path[pi]] = true;
        }
    }

    // ---- Phase 2: closure/tie legs fill remaining gaps only ---------
    //
    // A run still parentless after phase 1 gets ONE more chance: its
    // closure/tie contacts, in seq order, become candidate parents --
    // but a candidate is skipped when it is ALREADY a descendant of
    // this run, because that is the SAME physical junction the
    // descendant already reported from its own side (an ordinary
    // trunk-with-a-spur-that-closes-a-loop is the everyday case: the
    // spur's "new" leg already gives it the trunk as parent in phase 1,
    // so the trunk seeing the SAME closure from its own side must not
    // also claim the spur as ITS parent). A skipped candidate creates
    // no parent, no cycle, and no secondTie -- reporting it again would
    // describe one physical junction twice.
    //
    // A parentless run is the root of its own (so far unconnected)
    // tree, so a candidate that is NOT its descendant is necessarily in
    // a DIFFERENT tree -- adopting it only ever merges two trees into
    // one, and can never create a cycle, in ANY iteration order. This
    // is provable from that alone and was confirmed over thousands of
    // random surveys: iteration order changes which tree ends up on
    // top of which (see below), never whether the result has a cycle.
    //
    // Processed from the LATEST-anchored run back to the earliest --
    // the reverse of grouped.order, which is itself ordered by each
    // run's earliest station (see earliestSeqOfRun) -- purely to choose
    // a DIRECTION when two components' only connection is a single
    // closure/tie leg (e.g. two separately *fixed* components joined
    // by nothing else): the later-anchored one claims it as ITS parent
    // first, so the earlier, already-established one sees the later
    // one as its own descendant by the time it looks and correctly
    // does not also try to adopt it. Reversing this order still cannot
    // produce a cycle -- only a different (equally valid) tree shape.
    var isDescendant = function(ancestorKey, candidateKey) {
        var cur2 = candidateKey;
        var guard = 0;
        while (cur2 !== null && cur2 !== undefined && parents.hasOwnProperty(cur2)) {
            if (cur2 === ancestorKey) {
                return true;
            }
            cur2 = parents[cur2];
            guard++;
            if (guard > grouped.order.length + 1) {
                break;   // parents is acyclic by this point; belt-and-braces
            }
        }
        return false;
    };

    for (i = grouped.order.length - 1; i >= 0; i--) {
        var p2Key = grouped.order[i];
        var p2r1 = rank1ByRun[p2Key];
        var seen2 = seenByRun[p2Key];

        if (parents[p2Key] !== null) {
            // Already has a phase-1 parent: its closure/tie contacts
            // are ordinary secondTies, not primary-candidate material.
            // seen2 already carries this run's primary tie station (and
            // any phase-1 secondTie stations) from the block above, so
            // a closure landing on one of THOSE stations is correctly
            // recognised as the same junction, not a new one (M-3).
            for (k = 0; k < p2r1.length; k++) {
                var stHas = p2r1[k].station;
                if (seen2.hasOwnProperty(stHas)) {
                    continue;
                }
                seen2[stHas] = true;
                secondTies.push({
                    run: p2Key,
                    otherStation: stHas,
                    otherRun: p2r1[k].otherRun
                });
            }
            continue;
        }

        // Still parentless: look for the first closure/tie candidate
        // that is not already a descendant of this run.
        var chosen = null;
        var extras = [];
        for (k = 0; k < p2r1.length; k++) {
            if (isDescendant(p2Key, p2r1[k].otherRun)) {
                continue;
            }
            if (chosen === null) {
                chosen = p2r1[k];
            } else {
                extras.push(p2r1[k]);
            }
        }
        if (chosen !== null) {
            parents[p2Key] = chosen.otherRun;
            ties[p2Key] = chosen.station;
            seen2[chosen.station] = true;
            for (k = 0; k < extras.length; k++) {
                var stFill = extras[k].station;
                if (seen2.hasOwnProperty(stFill)) {
                    continue;
                }
                seen2[stFill] = true;
                secondTies.push({
                    run: p2Key,
                    otherStation: stFill,
                    otherRun: extras[k].otherRun
                });
            }
        }
    }

    // ---- final filter: one physical junction, reported once --------
    //
    // Phase 2 decides each run's OWN candidates using the parents map
    // AS IT STOOD AT THAT MOMENT, not the final one: a candidate that
    // looked like a legitimate second contact when THIS run was
    // examined can become this run's OWN descendant a little later in
    // the SAME pass, via that candidate's own separate phase-2
    // assignment -- at which point the entry describes exactly the
    // junction the descendant now reports as ITS primary tie, and
    // WHICH shot order happens to produce the duplicate depends only
    // on iteration order among runs with no other qualifying
    // candidate, not on anything physically different about the
    // survey (M-2). Re-checked here against the FULLY SETTLED parents
    // map, once, so the result no longer depends on that timing.
    // cycleDemotions is merged back in afterward, unfiltered -- see the
    // comment on it above for why it must not go through this check.
    var filteredSecondTies = [];
    for (i = 0; i < secondTies.length; i++) {
        if (isDescendant(secondTies[i].run, secondTies[i].otherRun)) {
            continue;
        }
        filteredSecondTies.push(secondTies[i]);
    }
    secondTies = filteredSecondTies.concat(cycleDemotions);

    // ---- primary root, orphans, and name/graph mismatches ----------
    //
    // grouped.order[0]'s own run need not itself be parentless -- a
    // phase-1 cycle can elect some OTHER member as root (breakCycle
    // picks the earliest STATION, not the earliest RUN), and phase 2
    // can equally leave grouped.order[0] with a parent while some
    // other run stays the tree's true root. Walking up from
    // grouped.order[0] once finds the actual root regardless of which
    // run that turns out to be; using array POSITION as a stand-in for
    // rootness was the I-1 bug (parents[grouped.order[0]] !== null yet
    // some other run wrongly reported as the disconnected one).
    var primaryRoot = grouped.order[0];
    if (primaryRoot !== undefined) {
        var rootGuard = 0;
        while (parents[primaryRoot] !== null && parents[primaryRoot] !== undefined &&
                grouped.runs.hasOwnProperty(parents[primaryRoot])) {
            primaryRoot = parents[primaryRoot];
            rootGuard++;
            if (rootGuard > grouped.order.length + 1) {
                break;   // acyclic by this point; belt-and-braces
            }
        }
    }

    // ---- raw physical connectivity: a plain union-find over EVERY --
    // leg in resolved.legs, regardless of kind. Deliberately
    // independent of the kind-ranked parent forest above: THIS
    // question is "does any leg, walked or not, connect these two
    // stations" -- what a surveyor means by "is this passage part of
    // the same cave" -- not "did phase 1/2's band-tree search manage
    // to attach it as someone's child". Built ONCE, over the legs, not
    // per run: O(legs) to build (with path compression/union-by-
    // attach, amortized near-constant per union), then an O(1)-ish
    // lookup per station afterward. A run that phase 2 could not
    // attach (a "second root") can still show up here as physically
    // connected -- that is exactly the distinction orphans vs
    // strandedRoots exists to make.
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
        if (!ufParent.hasOwnProperty(a)) {
            ufParent[a] = a;
        }
        if (!ufParent.hasOwnProperty(b)) {
            ufParent[b] = b;
        }
        var ra = ufFind(a), rb = ufFind(b);
        if (ra !== rb) {
            ufParent[ra] = rb;
        }
    };
    for (i = 0; i < resolved.legs.length; i++) {
        ufUnion(resolved.legs[i].from, resolved.legs[i].to);
    }

    // The set of raw-connectivity roots reachable from the PRIMARY
    // root's own stations -- computed once, so "is runKey physically
    // connected to the primary root" is a plain lookup per station,
    // not a fresh graph walk per run.
    var primaryRootUF = {};
    if (primaryRoot !== undefined && grouped.runs.hasOwnProperty(primaryRoot)) {
        var prStations = grouped.runs[primaryRoot].stations;
        for (k = 0; k < prStations.length; k++) {
            primaryRootUF[ufFind(prStations[k])] = true;
        }
    }
    var isPhysicallyConnectedToPrimary = function(runKey) {
        var stationsOfRun = grouped.runs[runKey].stations;
        for (var si = 0; si < stationsOfRun.length; si++) {
            if (primaryRootUF.hasOwnProperty(ufFind(stationsOfRun[si]))) {
                return true;
            }
        }
        return false;
    };

    for (i = 0; i < grouped.order.length; i++) {
        var fKey = grouped.order[i];
        if (parents[fKey] === null && fKey !== primaryRoot) {
            // Two different questions, two different fields, because
            // they demand two different actions from a surveyor.
            // orphans: no leg of any kind reaches the primary root's
            // component -- go shoot a connecting leg. strandedRoots:
            // raw connectivity says this run IS part of the same cave
            // -- the data is fine, phase 2's descendant-avoiding
            // search simply never found a way to attach it as anyone's
            // child. Never both: this branch chooses exactly one.
            if (isPhysicallyConnectedToPrimary(fKey)) {
                strandedRoots.push(fKey);
            } else {
                orphans.push(fKey);
            }
        }

        // Reachable regardless of whether a contact was found: a named
        // spur (expected !== null) that the graph ties nowhere at all
        // is exactly as much a mismatch as one the graph ties somewhere
        // else -- actual is null in that case, not silently skipped.
        var expected = CsProfile.tieNameOfRun(fKey);
        if (expected !== null && expected !== ties[fKey]) {
            mismatches.push({
                run: fKey,
                expected: expected,
                actual: ties[fKey]
            });
        }
    }

    return {
        parents: parents,
        ties: ties,
        order: CsProfile.bandOrder(grouped, parents, ties, resolved),
        secondTies: secondTies,
        mismatches: mismatches,
        orphans: orphans,
        strandedRoots: strandedRoots,
        cycles: cycles
    };
};

/**
 * Depth-first band order. Siblings are ordered by how far along their
 * parent they tie in, measured by the tie station's resolution order
 * (seq) -- along-distance itself is not known until the parent has
 * been unrolled, and seq is monotone along a chain, so it gives the
 * same answer without the circular dependency.
 *
 * A run whose parent never gets placed (a disconnected component) is
 * appended at the end rather than dropped. hierarchy() breaks every
 * cycle in `parents` before calling this, so in normal use `seen`
 * below is belt-and-braces, not a load-bearing path -- but this
 * function is public and can be called directly with a hand-built
 * parents/ties map that DOES still carry an unbroken cycle, and in
 * that case `seen` is what stops the walk from recursing forever, and
 * the unreached-fallback loop is what stops a cyclic parents map from
 * silently emitting an empty order (a pure cycle has no null-parent
 * root, so `roots` alone would be empty and the walk would never run
 * at all).
 */
CsProfile.bandOrder = function(grouped, parents, ties, resolved) {
    var children = {}, roots = [];
    var i, key;

    for (i = 0; i < grouped.order.length; i++) {
        key = grouped.order[i];
        var p = parents[key];
        if (p === null || p === undefined || !grouped.runs.hasOwnProperty(p)) {
            roots.push(key);
            continue;
        }
        if (!children.hasOwnProperty(p)) {
            children[p] = [];
        }
        children[p].push(key);
    }

    var seqOfTie = function(runKey) {
        var t = ties[runKey];
        if (t === null || t === undefined ||
                !resolved.stations.hasOwnProperty(t)) {
            return Number.MAX_VALUE;
        }
        return resolved.stations[t].seq;
    };
    for (key in children) {
        if (children.hasOwnProperty(key)) {
            children[key].sort(function(a, b) {
                var d = seqOfTie(a) - seqOfTie(b);
                if (d !== 0) {
                    return d;
                }
                // two runs leaving the SAME station tie here, and this
                // engine's sort is unstable -- without a second key the
                // band order would differ between runs of the same
                // drawing. Run key is unique, so it ends the tie.
                return (a < b) ? -1 : ((a > b) ? 1 : 0);
            });
        }
    }

    var out = [], seen = {};
    var walk = function(runKey) {
        if (seen.hasOwnProperty(runKey)) {
            return;   // a cycle in the parent map cannot loop us forever
        }
        seen[runKey] = true;
        out.push(runKey);
        var kids = children[runKey] || [];
        for (var c = 0; c < kids.length; c++) {
            walk(kids[c]);
        }
    };
    for (i = 0; i < roots.length; i++) {
        walk(roots[i]);
    }
    // anything unreached (parent cycle, or parent in another component)
    for (i = 0; i < grouped.order.length; i++) {
        if (!seen.hasOwnProperty(grouped.order[i])) {
            walk(grouped.order[i]);
        }
    }
    return out;
};

/** The numeric value of a station's sequence, or a large number when
 *  it is not numeric -- so lettered sequences sort after numbered. */
CsProfile.seqNumOf = function(name) {
    var s = CsProfile.splitName(name);
    if (s === null || !/^[0-9]+$/.test(s.seq)) {
        return Number.MAX_VALUE;
    }
    return parseInt(s.seq, 10);
};

/**
 * Is `path` a better chain than `best`? Longer wins. Equal length is
 * broken by the LOWEST station sequence in the path, then by the
 * highest -- so A1-A2-A3-A4 beats A9-A2-A3-A4, and A13-A14-A15 beats
 * A13-A14-A99. Still tied (same multiset of sequence extremes), the
 * path's own text breaks it, so two genuinely distinct paths never
 * compare equal.
 *
 * WHY A TIE-BREAK IS REQUIRED, not a nicety: a spur one leg long off
 * an interior station produces an alternative path of EXACTLY the same
 * length as the main chain, so "longest wins" alone leaves the band's
 * contents decided by object iteration order. That is a band that
 * changes shape between runs for no reason the user did anything to.
 *
 * NOT fed to Array.prototype.sort (so CaveCAD's unstable sort is not
 * directly in play here), but the same discipline applies for the same
 * reason: this is called as a boolean "is path better" predicate while
 * walking a deterministic DFS order (run.stations is already sorted by
 * CsProfile.seqOrder, and adjacency lists are built in resolved.legs
 * order -- neither depends on this engine's sort), so as long as no two
 * DISTINCT paths ever both return false against each other here, the
 * winner is independent of which one the walk reaches first. The final
 * `path.join(" ") < best.join(" ")` branch is what guarantees that: two
 * different station lists never produce equal strings -- joined on a
 * space rather than a comma, because CsProfile.splitName's own
 * catch-all group admits arbitrary punctuation in a station name,
 * comma included, and a space costs nothing to prefer instead.
 */
CsProfile.betterChain = function(path, best) {
    if (path.length !== best.length) {
        return path.length > best.length;
    }
    if (path.length === 0) {
        return false;
    }
    var stat = function(list) {
        var lo = Number.MAX_VALUE, hi = -1;
        for (var i = 0; i < list.length; i++) {
            var v = CsProfile.seqNumOf(list[i]);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        return { lo: lo, hi: hi };
    };
    var a = stat(path), b = stat(best);
    if (a.lo !== b.lo) {
        return a.lo < b.lo;
    }
    if (a.hi !== b.hi) {
        return a.hi < b.hi;
    }
    // Still tied: decide on the station names themselves rather than on
    // which one the walk happened to reach first. Search order is not a
    // property a band's contents should depend on.
    return path.join(" ") < best.join(" ");
};

/**
 * The longest simple path through one run's own stations.
 *
 * COMPLEXITY IS QUADRATIC IN RUN LENGTH, not "cheap in practice" --
 * n DFS starts, each an O(n) walk, is Theta(n^2) for a chain-shaped
 * run, and WORSE with branching (a run gerrymandered into a balanced
 * binary tree instead of a chain -- not how real spurs get named or
 * promoted, see the file banner). The mitigation actually in this
 * function is starting the search only from LEAF stations (in-run
 * degree <= 1, see `starts` below): exact for a chain or a tree,
 * because a tree's longest simple path always ends at two leaves, so a
 * chain needs only 2 starts instead of n. This is a LARGE
 * CONSTANT-FACTOR WIN, measured below at roughly 9-10x on an ordinary
 * chain -- NOT a change of complexity class. The remaining cost, even
 * from just 2 starts, is `best = path.slice(0)` on every improving
 * step of a single deep walk, which is itself O(k) at path length k --
 * for a plain chain that fires on almost every step, so the walk still
 * lands somewhere between linear and quadratic in practice. Fixing
 * that is a further, NOT-YET-DONE optimization; what shipped is the
 * fewer-starts win only.
 *
 * MEASURED (both engines this runs in; CaveCAD is the authoritative
 * one -- every draw runs there, not under node -- and consistently
 * far slower, which is why both are quoted rather than node alone):
 *
 *   shape                        node      CaveCAD   CaveCAD, pre-fix
 *   --------------------------   -------   -------   ----------------
 *   300-station chain            ~2ms      ~6ms      (not measured)
 *   1000-station chain           ~3ms      ~52ms     ~473ms  (~9x)
 *   2000-station chain           ~8ms      ~200ms    ~1993ms (~10x)
 *   511-station balanced tree    ~87ms     ~1.4s     (not measured)
 *   2047-station balanced tree   ~1.7s     ~27s      (not measured)
 *
 * "pre-fix" is this same CaveCAD engine's own timing before the
 * leaf-only start selection existed, from the review that found this
 * cost -- kept beside the current numbers because the ~9-10x drop IS
 * the constant-factor win claimed above, not an assumption.
 *
 * A real survey run does not take the balanced-tree shape; if one ever
 * does, this is where to look first. One good result worth keeping:
 * CaveCAD's engine walked a 5000-station chain -- a single DFS
 * recursing 5000 stack frames deep -- in ~1.4s with no stack-depth
 * failure, so that risk is cleared by measurement, not left as a
 * worry. (The balanced tree's own longest single walk is much
 * shallower than its station count -- about 2*depth -- so it is the
 * chain figures above, not the tree ones, that actually test recursion
 * depth.)
 *
 * THE TABLE ABOVE IS THIS FUNCTION ALONE, and it is NOT re-derived
 * here: the leg index (CsProfile.legIndex) changed nothing about this
 * search, whose own comparison count barely moves. What the index DID
 * change is this function's SHARE of a build, and that is worth stating
 * because the old answer was "not the dominant cost, CsProfile.
 * legBetween is". Measured on CaveCAD after the index, per function
 * within one CsProfile.build:
 *
 *   one 4500-station run:  build 1221ms, of which this 222ms (18%)
 *   thirty 150-station runs: build 1099ms, of which this 40ms (4%)
 *   one 3000-station run:  build 566ms, of which this 70ms (12%)
 *
 * So this is now the SECOND cost in a build, not the first and not a
 * rounding error. The first is CsProfile.bandWallRuns, at 78-92% across
 * those same shapes -- see CsProfile.settings' own docblock for what is
 * quadratic there and the scratch measurement of fixing it. A separate
 * measurement attempt for this table's own rows produced figures
 * several times LOWER than the ones above it on a differently-shaped
 * fixture, which is why they were left alone rather than overwritten:
 * two numbers measured different ways do not belong in one column.
 *
 * Cost is bounded by the run's own size, not the survey's, because the
 * walk only ever crosses edges into stations `inRun`. Pass a prebuilt
 * `adj` (CsProfile.adjacency(resolved)) when laying out many bands from
 * the same resolved survey -- rebuilding the whole-survey graph once
 * per run, instead of once per band, is most of the cost above a few
 * hundred runs; CsProfile.unrollBand accepts the same graph via
 * `opts.adjacency` and forwards it here. CsProfile.legIndex gets the
 * same once-per-build treatment for the same reason, one layer down in
 * CsProfile.unrollBand.
 *
 * \param adj optional, CsProfile.adjacency(resolved) already built;
 *            built fresh from `resolved` when omitted
 * \return {chain: [name], omitted: [name]} omitted = run members not
 *         on the chain, in sequence order
 */
CsProfile.longestChain = function(run, resolved, adj) {
    adj = adj || CsProfile.adjacency(resolved);
    var inRun = {};
    var i;
    for (i = 0; i < run.stations.length; i++) {
        inRun[run.stations[i]] = true;
    }

    // In-run degree, so the search can start only from a LEAF (degree
    // <= 1) instead of from every station -- see the docblock above.
    // Falls back to every station when the run graph has no leaf at
    // all: a genuine cycle through "new"/"tie" edges only, which the
    // ordinary case (see CsProfile.adjacency) says should not happen,
    // but which must not silently return an empty chain if it ever did.
    var degree = function(name) {
        var links = adj[name] || [];
        var d = 0;
        for (var li = 0; li < links.length; li++) {
            if (inRun[links[li].other]) {
                d++;
            }
        }
        return d;
    };
    var starts = [];
    for (i = 0; i < run.stations.length; i++) {
        if (degree(run.stations[i]) <= 1) {
            starts.push(run.stations[i]);
        }
    }
    if (starts.length === 0) {
        starts = run.stations.slice(0);
    }

    var best = [];
    var walk = function(at, visited, path) {
        path.push(at);
        if (CsProfile.betterChain(path, best)) {
            best = path.slice(0);
        }
        var links = adj[at] || [];
        for (var k = 0; k < links.length; k++) {
            var nxt = links[k].other;
            if (!inRun[nxt] || visited[nxt]) {
                continue;
            }
            visited[nxt] = true;
            walk(nxt, visited, path);
            visited[nxt] = false;
        }
        path.pop();
    };
    for (i = 0; i < starts.length; i++) {
        var visited = {};
        visited[starts[i]] = true;
        walk(starts[i], visited, []);
    }

    var onChain = {};
    for (i = 0; i < best.length; i++) {
        onChain[best[i]] = true;
    }
    var omitted = [];
    for (i = 0; i < run.stations.length; i++) {
        if (!onChain[run.stations[i]]) {
            omitted.push(run.stations[i]);
        }
    }

    // orient the chain by sequence: a survey reads from its low
    // numbers outward, so the band should too
    if (best.length >= 2) {
        var a = CsProfile.splitName(best[0]);
        var b = CsProfile.splitName(best[best.length - 1]);
        if (a !== null && b !== null &&
                CsProfile.seqOrder(a.seq, b.seq) > 0) {
            best.reverse();
        }
    }

    return { chain: best, omitted: omitted };
};

/**
 * Separator inside a CsProfile.pairKey. A NUL is used because it is the
 * one character a station name cannot carry: names come from a survey
 * file's text, and every reader in Core/Format splits on whitespace or
 * a delimiter long before a NUL could survive into one. A printable
 * separator would not do -- "A B" paired with "C" and "A" paired with
 * "B C" would collide on a space, and the collision would be SILENT
 * (two unrelated pairs sharing one bucket, first-match-wins handing
 * back the wrong leg). CsProfile.build's own `drawnLeg` map further
 * down still keys on a space, deliberately: it only ever asks "is this
 * exact leg drawn", never "give me the leg for this pair", so a
 * collision there costs a misreported finding, not wrong geometry.
 */
CsProfile.PAIR_SEP = "\u0000";

/**
 * The unordered-pair key for two station names: pairKey(a, b) and
 * pairKey(b, a) are the same string. Sorted, not concatenated in the
 * order given, because a leg's own from/to direction is exactly what a
 * lookup by pair must NOT care about.
 *
 * Also why the key can never be "__proto__" or any other Object.prototype
 * member name: every key this returns contains a CsProfile.PAIR_SEP, and
 * no builtin name does. Plain [] access on a CsProfile.legIndex is
 * therefore safe.
 */
CsProfile.pairKey = function(a, b) {
    return (a < b) ? (a + CsProfile.PAIR_SEP + b)
                   : (b + CsProfile.PAIR_SEP + a);
};

/**
 * Unordered station pair -> the legs joining it, IN resolved.legs ORDER.
 * Built once per CsProfile.build and handed to CsProfile.legBetween and
 * CsProfile.tieLegBetween, which without it scan all of resolved.legs on
 * every single chain step -- O(total stations x total legs) over the
 * whole survey, and the measured dominant cost of a build before this
 * existed (see CsProfile.settings' own docblock for the before/after
 * table).
 *
 * IT FILTERS NOTHING. Every leg resolved.legs holds goes into a bucket,
 * closures and (hypothetical) splay legs included. That is the whole
 * safety argument for the change: this index decides only WHICH legs a
 * lookup LOOKS AT, never which ones PASS. The legs it keeps out of a
 * given bucket are exactly the ones whose endpoints do not match, which
 * every lookup's own endpoint test would have rejected anyway -- so
 * CsProfile.legBetween's and CsProfile.tieLegBetween's kind filters stay
 * where they have always been, in those two functions, unchanged and
 * still stated to agree with CsProfile.adjacency's. An index that
 * pre-filtered by kind would have quietly become a THIRD copy of that
 * filter, and a third copy is precisely what those docblocks' invariant
 * exists to prevent.
 *
 * ORDER IS PRESERVED, AND THAT IS LOAD-BEARING, NOT INCIDENTAL. Two
 * legs CAN join the same two stations, and both lookups take the FIRST
 * match. A bucket lists a pair's legs in the same relative order
 * resolved.legs does, so first-match-wins picks the identical leg it
 * picked before this index existed -- the equivalence is structural and
 * holds whatever order CsNetwork.resolve emits legs in.
 *
 * WHAT THAT ORDER ACTUALLY IS, since the tie step's kind lookup depends
 * on it: CsNetwork.resolve classifies a shot as "closure" (or a control
 * "tie") only when BOTH its ends are already placed, and as "new" when
 * it is the shot that places one of them. So for any pair carrying two
 * legs, a "new" leg -- if the pair has one at all -- is always emitted
 * BEFORE any closure on that same pair: once the "new" leg has run,
 * both ends are known, which is precisely what makes every later leg on
 * the pair a closure. A pair whose ends were both already reachable by
 * other routes carries closures only, in emission order. Consequence:
 * CsProfile.legBetween (closures out) returns a pair's placing leg, and
 * CsProfile.tieLegBetween (closures in) returns that same placing leg
 * when there is one and the earliest closure otherwise. This paragraph
 * is a statement ABOUT CsNetwork.resolve, pinned by its own named test,
 * not an assumption this index makes -- see above: the index is
 * order-preserving, so it cannot change the answer even if resolve()
 * ever stopped behaving this way.
 *
 * NEVER ACCEPTED FROM A CALLER, same as the adjacency graph -- see the
 * C1 paragraph on CsProfile.build for the measured failure that rule
 * comes from. CsProfile.build constructs one from THIS call's
 * `resolved`, every call, and nothing writes it back onto the caller's
 * own `opts` object.
 *
 * \return {pairKey: [leg]} -- absent (undefined) for a pair with no leg
 */
CsProfile.legIndex = function(resolved) {
    var index = {};
    if (resolved === undefined || resolved === null ||
            resolved.legs === undefined || resolved.legs === null) {
        return index;   // same empty-input tolerance as adjacency()
    }
    for (var i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        var key = CsProfile.pairKey(leg.from, leg.to);
        if (!index.hasOwnProperty(key)) {
            index[key] = [];
        }
        index[key].push(leg);
    }
    return index;
};

/**
 * The leg joining two named stations, or null. FOR INTERIOR CHAIN
 * STEPS ONLY -- see CsProfile.tieLegBetween for the one step (a run's
 * tie into its parent) that this deliberately does not cover.
 *
 * INVARIANT (see CsProfile.adjacency's own docblock): this function's
 * kind filter and adjacency's MUST stay identical, both excluding
 * exactly "closure" (and, belt-and-braces, a splay shot -- resolve()
 * never actually emits one as a leg). The chain walk finds candidate
 * steps through adjacency and resolves each one through this function;
 * if the two filters ever disagreed, a step adjacency offers could
 * become one this cannot resolve, and unrollBand would silently stop
 * the band there instead of erroring.
 *
 * THIS USED TO BE THE DOMINANT COST IN CsProfile.build, MEASURED --
 * CsProfile.unrollBand calls it once per interior station in every
 * band, and without `index` each call is a LINEAR SCAN of resolved.legs,
 * O(total stations x total legs) over the whole survey. Pass `index`
 * (CsProfile.legIndex(resolved)) and the same call reads one small
 * bucket instead: a 4500-station build went from ~20.2 million leg
 * comparisons to ~13 thousand, and from ~2.2s to ~0.4s on CaveCAD. See
 * CsProfile.settings' own docblock for the full before/after table.
 * `index` is OPTIONAL and changes no answer: a bucket holds exactly the
 * legs on this pair, in resolved.legs order, so the first match is the
 * same leg the full scan found -- see CsProfile.legIndex for why that
 * equivalence is structural rather than a property of any one survey.
 * The filter below is one statement either way, run over whichever
 * candidate list it was handed, so an indexed and an unindexed lookup
 * cannot drift apart from each other any more than either can drift
 * from CsProfile.adjacency.
 *
 * \param index optional, CsProfile.legIndex(resolved) already built;
 *              all of resolved.legs is scanned when omitted
 */
CsProfile.legBetween = function(a, b, resolved, index) {
    var legs = (index === undefined || index === null)
        ? resolved.legs
        : (index[CsProfile.pairKey(a, b)] || []);
    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        if (leg.kind === "closure") {
            continue;
        }
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        if ((leg.from === a && leg.to === b) ||
                (leg.from === b && leg.to === a)) {
            return leg;
        }
    }
    return null;
};

/**
 * The leg joining two named stations, closures included -- the TIE
 * STEP's lookup, and deliberately not the same one CsProfile.legBetween
 * gives interior chain steps.
 *
 * WHY THIS IS A DIFFERENT FUNCTION, not a flag on legBetween: a flag
 * that quietly widens a filter is exactly how two filters that are
 * supposed to agree drift apart again -- see the INVARIANT on
 * CsProfile.adjacency and CsProfile.legBetween, which this function is
 * explicitly NOT bound by, and says so by having its own name.
 *
 * legBetween excludes "closure" because ITS caller is the interior
 * chain walk: CsProfile.adjacency only ever OFFERS a step across a
 * "new"/"tie" edge in the first place, so legBetween refusing a closure
 * is resolving a graph that already never proposed one -- there is
 * nothing to disagree about.
 *
 * A run's TIE is not a step the chain walk ever proposes; it comes from
 * CsProfile.hierarchy, which deliberately DOES consider closure and tie
 * legs when deciding where a run attaches -- a run whose only surveyed
 * contact anywhere is a ring-closing shot still has to attach
 * somewhere, and hierarchy's phase 2 exists to let it. Resolving that
 * same edge against a lookup that refuses closures would be the actual
 * inconsistency: the edge was chosen by a graph that admits closures,
 * so it must be resolved by one that does too, or the result is a band
 * that silently stops one station in -- exactly the failure the
 * legBetween/adjacency invariant exists to prevent, just relocated to
 * the one edge that invariant was never about.
 *
 * Geometrically this is sound, not merely permitted: a closure leg is
 * a real surveyed shot, and its two endpoints are already resolved
 * coordinates -- X cumulative along the band, Y each station's own
 * resolved Z -- so admitting it draws SOMETHING real, not a
 * fabrication. It is NOT, though, drawn at the shot's own tape length:
 * the leg's own measured rise need not match the difference between
 * its two endpoints' independently-resolved Z (that gap IS the
 * misclosure), so the segment as drawn can come out short or long of
 * the tape reading. Measured: a closure tie leg surveyed as 5.00 ft at
 * +30 degrees, whose two endpoints happen to resolve to the same Y,
 * draws at 4.3301 ft -- 13% short of the tape, because the drawn
 * length is plan-advance-plus-resolved-Y-difference, not the shot's
 * own slope distance. See CsProfile.unrollBand's own docblock for the
 * ordinary (non-closure) case, which does not have this gap.
 *
 * TAKES THE SAME OPTIONAL `index` AS CsProfile.legBetween, for the same
 * reason and with the same guarantee -- and it matters more here than
 * there, because CsProfile.unrollBand asks this one question once per
 * chain station while hunting for where the tie attaches, not once per
 * band. A pair carrying two legs is where the two functions visibly
 * differ (this one can return a closure the other skips), and a bucket
 * lists a pair's legs in resolved.legs order, so BOTH still return
 * exactly the leg they returned before the index existed. See
 * CsProfile.legIndex, whose docblock also states which of a duplicate
 * pair's legs CsNetwork.resolve emits first, and why.
 *
 * \param index optional, CsProfile.legIndex(resolved) already built;
 *              all of resolved.legs is scanned when omitted
 */
CsProfile.tieLegBetween = function(a, b, resolved, index) {
    var legs = (index === undefined || index === null)
        ? resolved.legs
        : (index[CsProfile.pairKey(a, b)] || []);
    for (var i = 0; i < legs.length; i++) {
        var leg = legs[i];
        if (leg.shot !== undefined && leg.shot !== null && leg.shot.splay) {
            continue;
        }
        if ((leg.from === a && leg.to === b) ||
                (leg.from === b && leg.to === a)) {
            return leg;
        }
    }
    return null;
};

/**
 * Unrolls one run into a band.
 *
 * X advances by each leg's PLAN distance (d * cos inc) and Y is the
 * station's resolved Z. X only ever increases: a passage that doubles
 * back in plan does not double back here, which is what "extended"
 * means. For an ORDINARY (non-closure) leg this also means the drawn
 * length equals its own slope distance exactly, up to whatever residual
 * CsAdjust left behind redistributing an ordinary loop's misclosure --
 * on the order of 0.0028 ft on a 100 ft leg in this repo's own
 * adjustment fixtures, not something to raise an alarm over. The ONE
 * exception is the tie step when it is a closure: see
 * CsProfile.tieLegBetween's own docblock for why that leg can draw
 * short (or long) of its own tape reading, measurably so.
 *
 * The band OPENS AT ITS TIE STATION, at X = 0, so the leg joining the
 * run to its parent is drawn inside this band. Without that, the tie
 * leg belongs to no band at all and vanishes from the profile.
 *
 * THE TIE NEED NOT BE AN ENDPOINT OF THE RUN'S OWN LONGEST CHAIN. An
 * ordinary "entered at a junction, surveyed both ways" run (A3 ties in
 * at B1, then B1-B2-B3-B4 one direction and B1-B5-B6-B7 the other) has
 * its longest internal chain running THROUGH that junction, end to end
 * (B4..B1..B7) -- the tie station attaches in the MIDDLE of it, not at
 * either end. A single band can only extend one direction from its
 * tie, so this scans the whole chain for where the tie actually
 * attaches (via CsProfile.tieLegBetween, which may be a closure -- see
 * that function), then keeps the LONGER of the two arms on that
 * station and demotes the shorter arm's stations to `omitted`. Equal
 * arms fall back to CsProfile.betterChain's own tie-break, applied to
 * the two candidate arms (each including the shared attach station, so
 * they compare as ordinary chains). What this must never do is what it
 * used to: assume the tie only ever meets an ENDPOINT, unshift blindly,
 * and let an unrelated interior junction discard the entire run down to
 * one point.
 *
 * NEVER DEFAULTS A MISSING Z TO 0. A station with no resolved Z ends
 * the band right there (`stopped`, `stoppedReason` "no-z"), including
 * the tie station itself or the chain's very first member -- `datum`
 * in that case comes back null, not 0, because a fabricated sea-level
 * datum for a cave surveyed to an unrelated absolute datum is exactly
 * the bug class this codebase keeps finding and closing doors on. A
 * chain step with a perfectly good Z but no leg to resolve it with
 * (`stoppedReason` "no-leg") is a different failure and reported as one
 * -- Tasks 5-11 have to explain this to a user, and "somewhere has no
 * elevation" and "somewhere isn't actually connected" are not the same
 * sentence. A THIRD failure, distinct from both: the leg exists and
 * both ends have a good Z, but the leg's own shot has no usable
 * distance/azimuth/inclination (`CsTraverse.offset` returned null;
 * `stoppedReason` "unmeasurable") -- X cannot be computed without
 * fabricating it, so the band stops rather than collapsing the next
 * station onto this one (a null distance's `plan` would be 0) or
 * poisoning every X after it with NaN (an undefined distance's would).
 *
 * \param run      one grouped run {key, stations}
 * \param tie      the tie station name, or null for the root run
 * \param resolved CsNetwork.resolve() result
 * \param hier     CsProfile.hierarchy() result (unused today; passed so
 *                 callers need not special-case, and so a future
 *                 orientation rule has it to hand)
 * \param opts     {tapeMode,
 *                  adjacency: CsProfile.adjacency(resolved) already
 *                  built -- forwarded to CsProfile.longestChain so
 *                  laying out many bands from the same resolved survey
 *                  need not rebuild the whole-survey graph per band,
 *                  legIndex: CsProfile.legIndex(resolved) already
 *                  built -- handed to every CsProfile.legBetween and
 *                  CsProfile.tieLegBetween call below, including the
 *                  attach-point scan, which asks one question per chain
 *                  station and was a full resolved.legs scan each time.
 *                  Both are OPTIONAL: omit either and this rebuilds
 *                  nothing, it simply pays the unindexed cost}
 *
 * \return {
 *   key, tie, datum,
 *   tapeMode: the SAME value `opts` was called with (defaulted),
 *             carried on the band itself rather than left for a caller
 *             to remember and repeat -- CsProfile.bandWallRuns reads it
 *             from here, not from its own `opts`. See the review note
 *             on bandWallRuns for the bug that closes: the two used to
 *             have to agree by caller discipline alone.
 *   stations: [{name, x, y, z}],
 *   legs:     [{shot, from, to, kind, fromX, fromY, toX, toY}] -- kind
 *             is the same "new" | "closure" | "tie" CsNetwork.resolve()
 *             put on the underlying leg, carried through so a caller
 *             (CsProfile.bandWallRuns's closure break, for one) does not
 *             have to look it back up by station-name pair, which is
 *             right only so long as no two legs on this run's own chain
 *             ever join the same two station names -- true today, but a
 *             lookup by name is a promise this shape no longer needs to
 *             keep,
 *   omitted:  [name] run members off the chain -- never on the chain to
 *             begin with, OR the shorter arm at an interior tie,
 *   stopped:  name | null -- station that ended the band early,
 *   stoppedReason: "no-z" | "no-leg" | "unmeasurable" | null -- which
 *             one; see above. null exactly when `stopped` is null.
 * }
 */
CsProfile.unrollBand = function(run, tie, resolved, hier, opts) {
    opts = opts || {};
    var tapeMode = opts.tapeMode || CsTraverse.SLOPE;

    var found = CsProfile.longestChain(run, resolved, opts.adjacency);
    var chain = found.chain.slice(0);
    // tied marks whether index 0 (once unshift below runs) really is a
    // DRAWN tie station, so the main loop knows its one step -- to
    // index 1 -- is the tie step and must resolve through
    // tieLegBetween, not legBetween: that step's edge came from
    // CsProfile.hierarchy, which admits closures, not from the interior
    // chain walk, which doesn't. Also what `tie` in the return value
    // reports: a tie name the caller passed but that was never actually
    // incorporated (absent from resolved.stations) must not come back
    // as if it were drawn -- Task 5 stacks siblings by junction and has
    // no other way to tell the two apart.
    var tied = false;
    if (tie !== null && tie !== undefined &&
            resolved.stations.hasOwnProperty(tie)) {
        // WHERE does the tie attach? Not assumed to be an endpoint --
        // scanned for, because an ordinary "entered at a junction,
        // surveyed both ways" run has its longest internal chain
        // passing THROUGH the tie's contact station, not ending on it.
        // tieLegBetween, not legBetween: the tie edge itself may be a
        // closure (see CsProfile.tieLegBetween), and asking legBetween
        // here would misjudge -- or fail to find -- that very edge.
        var attachIdx = -1;
        for (var ai = 0; ai < chain.length; ai++) {
            if (CsProfile.tieLegBetween(tie, chain[ai], resolved,
                    opts.legIndex) !== null) {
                attachIdx = ai;
                break;
            }
        }
        if (attachIdx === -1) {
            // The tie has no resolvable contact anywhere on the run's
            // OWN longest chain (its one contact touches a station this
            // chain omitted). Prefix anyway (below, with the rest);
            // the main loop reports an honest `stopped`/"no-leg" rather
            // than fabricating a link that was never surveyed.
        } else {
            // Split the chain at the attach point into its two arms
            // (excluding the attach station itself, which both keep),
            // then keep the longer arm -- attach station leading, so it
            // sits next to the tie once unshifted -- and demote the
            // shorter arm's own stations to `omitted`. An endpoint
            // attach (attachIdx 0 or chain.length-1) is the same
            // computation with one arm naturally empty, so this
            // replaces the old endpoint-only reversal check entirely
            // rather than sitting beside it.
            var leftOnly = chain.slice(0, attachIdx);
            var rightOnly = chain.slice(attachIdx + 1);
            var leftKept = chain.slice(0, attachIdx + 1).reverse();
            var rightKept = chain.slice(attachIdx);
            var keepRight;
            if (leftOnly.length !== rightOnly.length) {
                keepRight = rightOnly.length > leftOnly.length;
            } else {
                // Equal arms -- an ordinary symmetric junction. Reuse
                // CsProfile.betterChain's own already-total-order
                // tie-break (lowest sequence, then highest, then text)
                // on the two candidate arms rather than inventing a
                // second rule: both arms include the shared attach
                // station, so they compare as ordinary chains.
                keepRight = CsProfile.betterChain(rightKept, leftKept);
            }
            // the demoted (shorter, or tie-broken-away) arm needs no
            // bookkeeping of its own here: `omitted` below is recomputed
            // fresh from final chain membership, so cutting it from
            // `chain` is the only step that matters.
            chain = keepRight ? rightKept : leftKept;
        }
        chain.unshift(tie);
        tied = true;
    }

    var zOf = function(name) {
        var st = resolved.stations[name];
        if (st === undefined || st.z === undefined || st.z === null) {
            return null;   // NEVER 0: that would rebase an absolute datum
        }
        return st.z;
    };

    // null, not 0, when the chain is empty OR its first member's Z is
    // unresolved -- either way there is no real elevation to report,
    // and the main loop below stops at chain[0] itself in the second
    // case, so no station ever gets drawn against a fabricated datum.
    var datum = (chain.length > 0) ? zOf(chain[0]) : null;
    // A BAND'S Y IS SIMPLY ELEVATION. It stays a function rather than
    // becoming a bare `z` at every call site because that is the one
    // place a vertical scale would ever go again, and because every
    // caller already reads as "the y for this z".
    var yOf = function(z) {
        return z;
    };

    var stations = [], legs = [], stopped = null, stoppedReason = null;
    var x = 0.0;
    for (var i = 0; i < chain.length; i++) {
        var name = chain[i];
        var z = zOf(name);
        if (z === null) {
            stopped = name;
            stoppedReason = "no-z";
            break;
        }
        if (i > 0) {
            // only the tie step (index 0 -> 1, and only when a tie was
            // actually unshifted on) may resolve through a closure --
            // every interior step keeps legBetween's stricter filter
            var leg = (tied && i === 1)
                ? CsProfile.tieLegBetween(chain[i - 1], name, resolved,
                    opts.legIndex)
                : CsProfile.legBetween(chain[i - 1], name, resolved,
                    opts.legIndex);
            if (leg === null) {
                stopped = name;   // chain broken: stop, do not invent a link
                stoppedReason = "no-leg";
                break;
            }
            var o = CsTraverse.offset(leg.shot, tapeMode);
            if (o === null) {
                // the leg exists but its shot has no usable distance/
                // azimuth/inclination: X cannot be computed without
                // either fabricating it (null distance: plan collapses
                // to 0, landing this station on top of the last one)
                // or poisoning it with NaN (undefined distance). Same
                // honesty as no-z/no-leg -- stop here, name why, never
                // invent a coordinate.
                stopped = name;
                stoppedReason = "unmeasurable";
                break;
            }
            x += Math.abs(o.plan);
            legs.push({
                shot: leg.shot,
                from: chain[i - 1],
                to: name,
                kind: leg.kind,
                fromX: stations[stations.length - 1].x,
                fromY: stations[stations.length - 1].y,
                toX: x,
                toY: yOf(z)
            });
        }
        stations.push({ name: name, x: x, y: yOf(z), z: z });
    }

    // Recomputed fresh from final chain membership, rather than reusing
    // found.omitted directly, so a demoted arm (see above) is folded in
    // uniformly with whatever longestChain itself already excluded --
    // one list, run.stations' own sequence order preserved either way.
    var onChain = {};
    for (var oc = 0; oc < chain.length; oc++) {
        onChain[chain[oc]] = true;
    }
    var omitted = [];
    for (var os = 0; os < run.stations.length; os++) {
        if (!onChain[run.stations[os]]) {
            omitted.push(run.stations[os]);
        }
    }

    return {
        key: run.key,
        tie: tied ? tie : null,
        datum: datum,
        tapeMode: tapeMode,
        stations: stations,
        legs: legs,
        omitted: omitted,
        stopped: stopped,
        stoppedReason: stoppedReason
    };
};

/** Default half-width of the near-horizontal dead zone, in degrees. */
CsProfile.FLAT_SPLAY_DEG = 10.0;

/**
 * Default station count above which CsDraw.profile skips the AUTOMATIC
 * pass (the manual GenerateProfile command, Task 10, is never gated).
 * See CsProfile.settings' own docblock for what this counts and why.
 */
CsProfile.AUTO_MAX_STATIONS_DEFAULT = 3000;

/**
 * Inclination magnitude (degrees) at and beyond which a leg is treated
 * as PLUMB for passage-direction purposes: a shot that steep is a
 * pitch, and a magnetic compass's reading on a near-vertical shot is
 * noise, not a passage bearing -- CsValidate already flags a shot past
 * this same angle as "near-plumb" for exactly that reason (see its own
 * near-plumb warning). Both now read the single definition in
 * CsTraverse.PLUMB_DEG rather than each carrying its own copy of the
 * number and a comment promising the copies agree. See bandWallRuns
 * for what "treated as plumb" means here.
 */
CsProfile.PLUMB_INCLINATION_DEG = CsTraverse.PLUMB_DEG;

/**
 * Which line a splay belongs to: "ceiling", "floor", or "flat".
 *
 * WHY THE DEAD ZONE EXISTS, when the plan walls (CsLrud) have no
 * steepness filter at all: in plan every splay has a real horizontal
 * projection, so every splay is a real wall hit. In elevation a
 * near-horizontal splay is STILL a real wall hit, but it says nothing
 * about where the floor or the ceiling is -- letting a 2-degree,
 * 30-foot splay into either line would drag that line to almost
 * centerline level. It is drawn as its own tick instead (see
 * bandWallRuns' `flat` output), so the evidence stays visible without
 * bending a line it does not describe. DO NOT "fix" this to match
 * plan's no-filter rule -- the two are asymmetric on purpose.
 *
 * The boundary itself (exactly +-deadDeg) reads as flat, not as
 * ceiling/floor: `<=` on the absolute value, not `<`.
 *
 * A splay with NO inclination on record also reads as "flat" here --
 * this function has only three answers to give and "unmeasured" isn't
 * one of them. That is fine for classification, but NOT license to
 * plot a phantom tick from it: CsProfile.bandWallRuns skips a
 * no-inclination splay outright, before it ever reaches this function,
 * rather than trusting "flat" to mean "draw it at centerline."
 */
CsProfile.classifySplay = function(shot, deadDeg) {
    var dead = (deadDeg === undefined || deadDeg === null) ?
        CsProfile.FLAT_SPLAY_DEG : deadDeg;
    var inc = CsTraverse.effectiveInclination(shot);
    if (inc === null || inc === undefined) {
        return "flat";   // no inclination on record: nothing to classify
    }
    if (Math.abs(inc) <= dead) {
        return "flat";
    }
    return (inc > 0) ? "ceiling" : "floor";
};

/**
 * Floor and ceiling polylines for one unrolled band, plus the flat
 * splay ticks that join neither.
 *
 * Per station: the LRUD point (ceiling at z+U, floor at z-D; null
 * draws nothing -- not measured -- and 0 draws a point at the station
 * itself: the wall IS the station) and every splay that classifies
 * onto that line (see classifySplay). Only `up`/`down` are read, never
 * `upAll`/`downAll` -- a station with a multi-reading LRUD ("5/10" for
 * a ledge) still contributes exactly one ceiling and one floor point
 * from `up`/`down`, same as any other station; the extra readings are
 * for a report to explain, not for this previsualization to guess at.
 * A splay with NO inclination on record contributes NOTHING -- not
 * even a flat tick -- rather than plotting a coordinate at exactly
 * centerline elevation for a measurement that was never taken; that
 * spot is precisely where the dead-zone rationale above says a real
 * reading is already meaningless, so a fabricated one plotted there is
 * the worst place to invent one.
 *
 * A splay's X is its station's X plus the along-passage projection of
 * its plan offset, and points within a line are ordered by that
 * projection with the LRUD point at 0 leading its ties -- the SAME
 * ORDERING rule CsLrud.stationWallPoints uses for the plan walls
 * (there it disambiguates within one SIDE; here within one LINE), so
 * plan and profile order wall evidence identically. As in CsLrud, the
 * `order` field (-1 for the LRUD point, the splay's own index
 * otherwise) is what makes the comparator a TOTAL order: CaveCAD's own
 * Array.sort is unstable, so a comparator that could return 0 for two
 * distinct entries would place them differently between engines, and
 * node's stability would hide it. Here every entry in one station's
 * list has a distinct `order`, so no two distinct entries can ever tie.
 *
 * DIVERGENCE FROM CsLrud, DOCUMENTED (the ORDERING rule is shared, the
 * ADMISSION rule is not): CsLrud.stationWallPoints excludes a splay
 * lying exactly along the passage axis -- on the centerline, it says,
 * so neither wall. That exclusion is a PLAN-ONLY rule and is
 * deliberately NOT mirrored here: an along-axis splay's horizontal
 * projection may be zero, but its vertical component is still a real
 * measurement of where the ceiling or floor is, regardless of which
 * way the caver was facing. So this function never excludes a splay by
 * azimuth, only by classifySplay's inclination test.
 *
 * Breaks: a junction station (three or more legs touch it, counted
 * globally over the whole resolved survey -- exactly CsLrud's own
 * junction rule, since a junction is a property of the STATION, not
 * of which band happens to pass through it), a closure leg, and a
 * station with no vertical evidence at all (neither an LRUD tick nor
 * a splay on either line). Each break starts a new polyline rather
 * than inventing a connection across it.
 *
 * CLOSURE DETECTION reads `kind` straight off band.legs (unrollBand
 * carries it from the resolved leg now), and, exactly like
 * CsLrud.wallRuns, a closure-landing station contributes NOTHING at
 * all here, not even its own LRUD tick or splays: the prior run is
 * flushed BEFORE that station is looked at, and the walk resumes fresh
 * on the station after it. Its own evidence is not lost -- a real
 * physical station is drawn again as an ordinary interior station in
 * ITS OWN home run's band -- it simply does not ALSO get drawn here,
 * spanning a leg whose drawn length is not its own tape reading (see
 * CsProfile.tieLegBetween's own docblock): hanging wall detail across
 * a leg nobody measured that length of would misrepresent the passage,
 * the same reasoning the file banner already gives for never curving
 * between measured points.
 *
 * PASSAGE AZIMUTH for a station's splay projection is the azimuth of
 * the leg that ARRIVES there within this band, same source CsLrud
 * uses -- except when there is nothing usable to read it from, in
 * which case a splay's along-passage projection is 0, not a guess:
 *   - the band's own opening station has no arriving leg WITHIN the
 *     band at all (its arrival, if any, belongs to the parent band),
 *     so it falls back to the band's own first outgoing leg where one
 *     exists, and to "no direction" where it does not (a one-station
 *     band);
 *   - a PLUMB leg (see PLUMB_INCLINATION_DEG) is excluded from that
 *     lookup entirely, arriving OR outgoing: its compass reading is
 *     noise, and projecting a splay against a noise azimuth is worse
 *     than not projecting it at all. Measured: without this, a
 *     backward splay at the bottom of a pitch could land before the
 *     pitch-top station's own points -- X is supposed to be
 *     monotonically non-decreasing along a wall run (that IS what
 *     "extended elevation" means), and a splay projected against a
 *     bearing nobody could actually read broke that.
 * Either way, "no usable direction" means every splay at that station
 * sits at exactly its station's X, same as the LRUD tick -- honest
 * about not knowing WHERE along the passage it belongs, rather than
 * placing it somewhere a fabricated bearing picked. This azimuth
 * lookup, direction or absence of one, never marks a station as a
 * closure break; only `kind === "closure"` on the leg landing there
 * does that.
 *
 * \param band     CsProfile.unrollBand() result
 * \param survey   the CsModel survey (for LRUD and splay lookup)
 * \param resolved CsNetwork.resolve() result
 * \param opts     {flatSplayDeg: number (default FLAT_SPLAY_DEG),
 *                  splaysByStation: CsLrud.splaysByStation(survey)
 *                  already built, stationAxes: CsLrud.stationAxes(
 *                  resolved) already built, legCounts: CsLrud.legCounts(resolved.
 *                  legs) already built -- both optional, computed fresh
 *                  when absent; CsProfile.build hoists them once for
 *                  the whole profile (see I2) and hands them down here} --
 *                  tapeMode is NOT read from here:
 *                  they come off `band` itself (set by the
 *                  CsProfile.unrollBand() call that produced it), so
 *                  this can never scale its wall points against a
 *                  different Y than the band's own stations use
 *
 * \return {ceiling: [[{x,y}]], floor: [[{x,y}]],
 *          flat: [{x, y, station, name}], skipped: n} -- runs shorter
 *          than 2 points are dropped, same RULE as CsLrud.wallRuns.
 *          THE SHAPE IS NOT THE SAME, THOUGH, and calling
 *          CsLrud.wallRuns "the reference implementation" for a rule
 *          stopped meaning "and therefore the same return shape" as of
 *          the commit that gave each of ITS runs their own station
 *          list (14af1ca, "a wall run carries its own stations, not
 *          the whole survey's"): that function now returns
 *          {points: [{x,y}], stations: [name]} per run, not a bare
 *          point array. ceiling/floor here are still bare [[{x,y}]] --
 *          bandWallRuns has no per-run station list of its own yet. A
 *          future task that adds one (the profile side is the obvious
 *          next consumer of per-run stations) has to build the same
 *          {points, stations} pairing itself; it must not assume this
 *          array already carries it just because the RULE citations
 *          below and in this function's body point at CsLrud.wallRuns.
 *          `skipped` counts splays with no usable distance/azimuth/
 *          inclination (CsTraverse.offset returned null for them) --
 *          they contribute no ceiling/floor point and no flat tick
 */
CsProfile.bandWallRuns = function(band, survey, resolved, opts) {
    opts = opts || {};
    var dead = (opts.flatSplayDeg === undefined ||
        opts.flatSplayDeg === null) ?
        CsProfile.FLAT_SPLAY_DEG : opts.flatSplayDeg;
    // read off the band, not off `opts` -- see the docblock above and
    // the I4 review note: two independently-defaulted opts objects
    // agreeing was a caller-discipline promise, not a guarantee
    var tapeMode = band.tapeMode || CsTraverse.SLOPE;

    // I2: CsProfile.build hoists both of these once for the whole
    // profile and hands them down here through `opts`, the same
    // pattern opts.adjacency already established for CsProfile.
    // longestChain -- measured at 45% of a 276ms build (401 runs,
    // 10,024 shots) when each was instead recomputed once PER BAND.
    // Standalone callers (this file's own tests among them) get a
    // fresh computation, so bandWallRuns is never wrong on its own.
    var splays = (opts.splaysByStation !== undefined &&
        opts.splaysByStation !== null) ?
        opts.splaysByStation : CsLrud.splaysByStation(survey);
    var counts = (opts.legCounts !== undefined && opts.legCounts !== null) ?
        opts.legCounts : CsLrud.legCounts(resolved.legs);
    // Ways out per station, clustered by DIRECTION. Same reason as
    // CsLrud.wallRuns: a loop tie-in has three legs and two ways out,
    // and ending the ceiling and floor runs at it leaves a hole in the
    // profile at exactly the station a loop was closed on.
    var axes = (opts.stationAxes !== undefined &&
        opts.stationAxes !== null) ?
        opts.stationAxes : CsLrud.stationAxes(resolved);
    var isJunctionAt = function(n) {
        if (axes.hasOwnProperty(n)) {
            return CsLrud.isJunction(axes, n);
        }
        return counts[n] > 2;
    };

    var datum = band.datum;
    // Elevation, plainly -- see unrollBand's yOf.
    var yOf = function(z) {
        return z;
    };

    var ceilingRuns = [], floorRuns = [], flat = [];
    var ceiling = [], floor = [];
    var skipped = 0;

    // PER SIDE, for the same reason CsLrud.wallRuns splits its own:
    // a "P" up with a pitch climbing out of the station is the mouth
    // of a lead, and bridging the ceiling across it would roof the
    // pitch over -- while the floor under the same station carries
    // straight on. flush() (both at once) is still what a junction, a
    // closure leg and a station with no evidence at all use.
    var flushCeiling = function() {
        if (ceiling.length >= 2) {
            ceilingRuns.push(ceiling);
        }
        ceiling = [];
    };
    var flushFloor = function() {
        if (floor.length >= 2) {
            floorRuns.push(floor);
        }
        floor = [];
    };
    var flush = function() {
        flushCeiling();
        flushFloor();
    };

    // Which stations a PLUMB leg lands on, computed FIRST and kept
    // separate from the azimuth pass below: a plumb-arrival station
    // must end up with NO passage direction at all, even though it is
    // very often ALSO the `from` end of the very next (perfectly
    // ordinary) leg -- without this pass done first, that next leg's
    // own opening-station fallback (see below) would quietly hand the
    // pitch-bottom station the OUTGOING leg's azimuth instead, which is
    // exactly the noise-bearing substitution this whole rule exists to
    // refuse. A caver's own sense of direction at the bottom of a pitch
    // is not rescued by which way the passage happens to continue.
    var plumbArrival = {};
    var li, bl, inc;
    for (li = 0; li < band.legs.length; li++) {
        bl = band.legs[li];
        inc = CsTraverse.effectiveInclination(bl.shot);
        if (inc !== null && inc !== undefined &&
                Math.abs(inc) >= CsProfile.PLUMB_INCLINATION_DEG) {
            plumbArrival[bl.to] = true;
        }
    }

    // WHICH STATIONS HAVE A PITCH LEAVING THEM, and which way. This is
    // the profile's answer to the sealing hazard: a "P" up or down
    // means "no ceiling / no floor within reach that way", and the run
    // bridges straight across it -- UNLESS a surveyed passage leaves
    // vertically there, in which case bridging would roof the pitch
    // over or floor the aven in. Read from resolved.legs, not
    // band.legs: a lead off the band is exactly the leg the band does
    // not contain, and it is the one that matters here.
    var leadsUp = {}, leadsDown = {};
    var noteLead = function(map, name, other) {
        if (!map.hasOwnProperty(name)) {
            map[name] = [];
        }
        map[name].push(other);
    };
    var rlegs = resolved.legs || [];
    for (li = 0; li < rlegs.length; li++) {
        var rl = rlegs[li];
        inc = CsTraverse.effectiveInclination(rl.shot);
        if (inc === null || inc === undefined || !isFinite(inc) ||
                Math.abs(inc) < CsProfile.PLUMB_INCLINATION_DEG) {
            continue;
        }
        // From the `from` end the leg leaves the way it is inclined;
        // from the `to` end the way OUT is back the other way.
        noteLead(inc > 0 ? leadsUp : leadsDown, rl.from, rl.to);
        noteLead(inc > 0 ? leadsDown : leadsUp, rl.to, rl.from);
    }
    // A pitch the band itself walks through is the PASSAGE, not a lead
    // off it: the leg a caver arrived on and the one they carry
    // on down are the passage, not leads off it.
    var hasLead = function(map, name, prevName, nextName) {
        var list = map[name];
        if (list === undefined) {
            return false;
        }
        for (var q = 0; q < list.length; q++) {
            if (list[q] !== prevName && list[q] !== nextName) {
                return true;
            }
        }
        return false;
    };

    // Passage azimuth per station (with the opening-station fallback
    // described above, withheld for a PLUMB leg's own landing station)
    // and, separately and with NO such fallback, which stations are
    // landed on by a closure leg.
    var azAt = {}, closureAt = {};
    var az, plumb;
    // A PROJECTED elevation has ONE axis for the whole cave, not one
    // per station.
    //
    // Everything below asks "which way does the passage run here"
    // because an EXTENDED elevation's X is distance travelled along
    // it, so a splay's contribution to X is its along-passage
    // component. A projected elevation flattens real coordinates onto
    // one chosen vertical plane, so the same question has one answer
    // everywhere: the plane's own strike. Handing that in as every
    // station's direction is not a hack -- it is the same projection,
    // stated once instead of derived per station -- and it keeps one
    // implementation of the wall builder rather than two that would
    // drift.
    var fixedAz = (opts && opts.fixedAzimuth !== undefined &&
        opts.fixedAzimuth !== null && isFinite(opts.fixedAzimuth)) ?
        opts.fixedAzimuth : null;
    for (li = 0; li < band.legs.length; li++) {
        bl = band.legs[li];
        if (bl.kind === "closure") {
            closureAt[bl.to] = true;
        }
        inc = CsTraverse.effectiveInclination(bl.shot);
        plumb = (inc !== null && inc !== undefined &&
            Math.abs(inc) >= CsProfile.PLUMB_INCLINATION_DEG);
        if (plumb) {
            continue;   // a noise bearing is worse than none: skip it
        }
        az = CsTraverse.effectiveAzimuth(bl.shot);
        azAt[bl.to] = az;
        if (azAt[bl.from] === undefined && !plumbArrival[bl.from]) {
            azAt[bl.from] = az;
        }
    }
    if (fixedAz !== null) {
        // Every station, including the ones the walk above withheld a
        // direction from: on a projected plane a plumb leg's landing
        // station has an X axis like any other, because the axis was
        // never its passage's to begin with.
        for (li = 0; li < band.stations.length; li++) {
            azAt[band.stations[li].name] = fixedAz;
        }
    }

    // The survey's very first station, for the startLrud substitution
    // below: the from end of the first drawn non-splay shot.
    var firstStationName = null;
    for (var fi = 0; fi < survey.shots.length; fi++) {
        var fsh = survey.shots[fi];
        if (!fsh.splay && !fsh.excludeFromAll) {
            firstStationName = fsh.from;
            break;
        }
    }

    for (var i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];

        // I1: exactly CsLrud.wallRuns' own closure handling (the RULE,
        // not the return SHAPE -- see this function's own return
        // docblock above) -- flush whatever the run had BEFORE looking
        // at this station, then skip it completely. Its own evidence
        // is not lost; see the docblock's CLOSURE DETECTION paragraph
        // for where it surfaces instead.
        if (closureAt[st.name] === true) {
            flush();
            continue;
        }

        var lrud = CsModel.lrudForStation(survey, st.name);
        if ((lrud === null || lrud === undefined) &&
                st.name === firstStationName &&
                survey.startLrud !== null &&
                survey.startLrud !== undefined) {
            // the survey's first station: no shot arrives at it, so
            // lrudForStation cannot see it -- its U/D live in
            // survey.startLrud (same substitution CsDraw.survey and
            // CsLrud.wallRuns make)
            lrud = survey.startLrud;
        }
        var hasDir = (azAt[st.name] !== undefined);
        var alongX = 0.0, alongY = 0.0;
        if (hasDir) {
            var azRad = azAt[st.name] * Math.PI / 180.0;
            alongX = Math.sin(azRad);
            alongY = Math.cos(azRad);
        }

        var cEntries = [], fEntries = [];

        if (lrud !== null && lrud !== undefined) {
            if (lrud.up !== null && lrud.up !== undefined) {
                cEntries.push({ p: { x: st.x, y: yOf(st.z + lrud.up) },
                    t: 0.0, order: -1 });
            }
            if (lrud.down !== null && lrud.down !== undefined) {
                fEntries.push({ p: { x: st.x, y: yOf(st.z - lrud.down) },
                    t: 0.0, order: -1 });
            }
        }

        var sps = splays[st.name] || [];
        for (var k = 0; k < sps.length; k++) {
            var sp = sps[k];
            var o = CsTraverse.offset(sp, tapeMode);
            if (o === null) {
                // m2, folded into the one guard rather than kept as
                // its own pre-check (review I2): CsTraverse.unusable
                // already refuses null/undefined/NaN/+-Infinity on
                // distance, azimuth AND inclination, a strict superset
                // of "no inclination on record" -- so a separate
                // early `continue` on inclination alone was dead
                // weight that ALSO under-counted: it dropped a
                // no-inclination splay without ever reaching this
                // counter, so `skipped` (the COUNT -- this is not a
                // shape claim, see this function's own return
                // docblock above for how the shapes diverge) disagreed
                // with CsLrud.wallRuns' on the very same fixture.
                // classifySplay is never
                // reached for anything unusable now, on any of its
                // three inputs -- no ceiling/floor point, no flat tick
                // (falling through to "flat" would plot a phantom
                // point at exactly the station, the fabrication this
                // whole guard exists to stop), and no undercount.
                skipped++;
                continue;
            }
            // I2: no measured direction means no along-passage claim --
            // the splay sits at its station's own X, same as the LRUD
            // point, rather than being projected against a fallback
            // bearing nobody surveyed
            var t = hasDir ? (o.dx * alongX + o.dy * alongY) : 0.0;
            var point = { x: st.x + t, y: yOf(st.z + o.dz) };
            var side = CsProfile.classifySplay(sp, dead);
            if (side === "ceiling") {
                cEntries.push({ p: point, t: t, order: k });
            } else if (side === "floor") {
                fEntries.push({ p: point, t: t, order: k });
            } else {
                flat.push({ x: point.x, y: point.y, station: st.name,
                    name: st.name + "." + (k + 1) });
            }
        }

        // total order: `order` is -1 (the LRUD point, at most one per
        // list) or a splay's own index (unique within this station's
        // splay list), so no two distinct entries here ever tie
        var byAlong = function(a, b) {
            if (a.t < b.t) { return -1; }
            if (a.t > b.t) { return 1; }
            return a.order - b.order;
        };
        cEntries.sort(byAlong);
        fEntries.sort(byAlong);

        var isJunction = isJunctionAt(st.name);
        // A "P" up or down is a READING -- the party looked and found
        // no ceiling / no floor that way -- not a blank cell. It plots
        // no point, because there is nothing to plot one on, but the
        // run carries through the station and joins the last measured
        // point to the next. Same rule, same reason, as
        // CsLrud.hasPlanEvidence on the plan side.
        var openUp = (lrud !== null && lrud !== undefined &&
            lrud.upOpen === true);
        var openDown = (lrud !== null && lrud !== undefined &&
            lrud.downOpen === true);
        var noEvidence = (cEntries.length === 0 && fEntries.length === 0 &&
            !openUp && !openDown);

        for (k = 0; k < cEntries.length; k++) {
            ceiling.push(cEntries[k].p);
        }
        for (k = 0; k < fEntries.length; k++) {
            floor.push(fEntries[k].p);
        }

        // a junction station's own points still terminate the run
        // they end (same RULE as CsLrud.wallRuns -- again, not the
        // same return shape, see this function's own return docblock
        // above), rather than being silently dropped from it
        //
        // PROBED FOR CsLrud.wallRuns' OWN CONTINUITY GAP (review
        // minor) AND FOUND IMMUNE: CsLrud.wallRuns walks resolved.legs
        // in RESOLUTION order, so a junction whose two branches both
        // carry wall evidence starting at the very next station could
        // (before its own continuity fix) glue both branches into one
        // polyline -- resolution order can place a whole branch, then
        // a second branch off the SAME junction station, with nothing
        // to say the second one's `from` doesn't continue the first
        // one's `to`. This loop cannot have that failure mode: it
        // walks `band.stations`, which unrollBand builds by resolving
        // each step through CsProfile.legBetween/tieLegBetween, so
        // band.stations[i] and band.stations[i+1] are ALWAYS joined by
        // a real leg or the band stops there instead (band.stopped).
        // Concretely, on a T-junction fixture matching the one that
        // exposed CsLrud.wallRuns' bug (a run "J1,J2,L1,L2,R1,R2" with
        // LRUD on both branches immediately past the junction J2),
        // CsProfile.longestChain picks the single longest REAL path --
        // here L2-L1-J2-R1-R2, a walk of actual surveyed edges straight
        // through the junction -- and this isJunction check still
        // correctly splits it into two runs at J2. There is no station
        // list this loop could ever see where two entries are NOT
        // leg-adjacent, so there is nothing here for a continuity check
        // to catch.
        if (isJunction || noEvidence) {
            flush();
            continue;
        }

        // ...but do not bridge across the mouth of a pitch or an aven.
        var prevName = (i > 0) ? band.stations[i - 1].name : null;
        var nextName = (i + 1 < band.stations.length) ?
            band.stations[i + 1].name : null;
        if (openUp && hasLead(leadsUp, st.name, prevName, nextName)) {
            flushCeiling();
        }
        if (openDown && hasLead(leadsDown, st.name, prevName, nextName)) {
            flushFloor();
        }
    }
    flush();

    return { ceiling: ceilingRuns, floor: floorRuns, flat: flat,
        skipped: skipped };
};

/**
 * The vertical span a band occupies, walls included, before any
 * offset. Returns null when the band drew nothing at all.
 *
 * ORDERING COUPLING, DEFENDED HERE RATHER THAN LEFT IMPLICIT: band.
 * ceiling/floor/flat only exist because CsProfile.build assigns them
 * (from CsProfile.bandWallRuns) before ever calling CsProfile.layout --
 * a raw CsProfile.unrollBand() result has none of the three. Rather
 * than require every caller to remember that ordering, a missing array
 * here is simply treated as empty: a band with no walls computed yet
 * still gets a well-defined (if smaller) span from its stations alone,
 * instead of a TypeError two call frames away from the actual mistake.
 */
CsProfile.bandSpan = function(band) {
    var lo = null, hi = null;
    var note = function(y) {
        if (lo === null || y < lo) { lo = y; }
        if (hi === null || y > hi) { hi = y; }
    };
    var ceiling = band.ceiling || [];
    var floor = band.floor || [];
    var flat = band.flat || [];
    var i, k;
    for (i = 0; i < band.stations.length; i++) {
        note(band.stations[i].y);
    }
    for (i = 0; i < ceiling.length; i++) {
        for (k = 0; k < ceiling[i].length; k++) {
            note(ceiling[i][k].y);
        }
    }
    for (i = 0; i < floor.length; i++) {
        for (k = 0; k < floor[i].length; k++) {
            note(floor[i][k].y);
        }
    }
    for (i = 0; i < flat.length; i++) {
        note(flat[i].y);
    }
    return (lo === null) ? null : { lo: lo, hi: hi };
};

/**
 * Assigns each band its zOffset in place.
 *
 * A band whose span clears every band already placed keeps offset 0
 * and reads at TRUE elevation. A band that would collide is pushed
 * below the lowest placed band, by a GUTTER, and records the offset so
 * the drawing can label it -- a displaced band that did not say so
 * would misinform a reader about depth.
 *
 * THE GUTTER IS A SEPARATION, NOT A GEOMETRIC QUANTITY OF THE BAND
 * BEING MOVED. The first cut of this rule set it to the colliding
 * band's OWN height, and that fails exactly where it matters: a band
 * ten times taller than everything else then gets a gutter ten times
 * bigger than everything else's, so one outsized band shoves every
 * band below it far down the page. A big band deserves more ROOM to
 * draw in -- that is what its own height already buys it -- not more
 * EMPTY SPACE wrapped around it. Rejected for exactly that reason.
 *
 * What the gutter should track instead is the profile's TYPICAL band,
 * so it reads as "a little more than a normal gap" everywhere, rather
 * than scaling with whichever band happens to be enormous.
 *
 * THE SECOND CUT OF THIS RULE USED HALF THE MEDIAN HEIGHT, AND THAT
 * ALSO FAILED -- at small band counts, which is the COMMONEST shape a
 * real cave survey takes, not an edge case. With only two bands
 * (heights 4 and 2000) the median of the two IS 1002, so the gutter
 * came out to 501: a 4-unit band still got a blank gutter 125x its own
 * height, merely 4x smaller than the height-based rule it replaced.
 * Same failure at four bands ([4,4,2000,2000]): the median sits
 * squarely between the two groups and inherits half the outlier's
 * scale. The median-of-the-whole-profile framing was only ever true
 * once tall bands are a strict MINORITY of a reasonably large
 * profile -- a two-run survey does not qualify, and it is the most
 * common shape there is.
 *
 * What actually holds at small n is a LOW ORDER STATISTIC: the
 * smallest height at or above the bottom quarter of the sorted list
 * (nearest-rank, index ceil(0.25n)-1 into heights sorted ascending),
 * not an interpolated quantile and not the median. At n=2 this
 * resolves to the SMALLER of the two heights (index 0), so [4, 2000]
 * gives 4, not 1002 -- the separation follows the small band even
 * though it is outnumbered one-to-one. At n=5 with four small bands
 * and one huge one it still resolves to a small value, same as the
 * median did, so nothing already working regresses. Floored at
 * GUTTER_MIN so a profile of uniformly flat, near-zero-height passages
 * still gets a visible separation instead of one derived from ~0.
 *
 * This is not claimed to be right for every distribution -- a profile
 * where EVERY band happens to be enormous simply gets a large (if
 * proportionate) gutter, correctly, because there is no small band to
 * anchor to. What it fixes is specifically the common case this
 * docblock got wrong the first two times: a handful of runs, one of
 * them a deep pit, the rest ordinary passage.
 *
 * Computed ONCE, from the spans this function already has to compute
 * to place every band -- not per band, and not by asking bandSpan for
 * the same band's span twice. A band with no span (drew nothing at
 * all) contributes NO entry to the height list -- it is excluded, not
 * counted as a phantom zero, which would otherwise pull a small-n
 * quantile toward zero for a reason that has nothing to do with any
 * band's actual size.
 *
 * `placedHi` is only ever raised by a band that CLEARS the stack above
 * it; a band pushed below never raises it, because it did not add
 * anything above the existing top -- it only extends the stack
 * downward. That is why a run of several colliding bands each land the
 * same constant gutter below the previous one rather than drifting
 * further every time: `placedLo` alone tracks the bottom of the stack
 * so far, and each new collision measures from there.
 *
 * A DISCONTINUITY AT THE COLLISION BOUNDARY, OBSERVED AND LEFT AS IS:
 * a span that touches the placed range EXACTLY (`clears` uses strict
 * `>`/`<`) collides and pays the full gutter, while a span a
 * vanishingly small epsilon further away clears and pays none --
 * fuzzed over 20,000 random surveys, two bands were once found sitting
 * 1.76e-5 apart at true elevation on either side of exactly this line.
 * That is not wrong: both bands are exactly where their own resolved
 * elevations put them, and "just barely touches" and "just barely
 * clears" are genuinely different physical facts about the cave. It is
 * simply a sharp edge in the rule worth knowing about before reading
 * two bands' near-equal spacing as a bug.
 */
CsProfile.GUTTER_MIN = 20.0;

/** The fraction of the sorted height list the gutter is anchored to --
 *  see the docblock above for why the low end, not the middle. */
CsProfile.GUTTER_QUANTILE = 0.25;

/** How many typical band heights of clear space between bands.
 *
 *  Was 0.5, which read as "they do not overlap" rather than "there is
 *  room here". A caver annotates the elevation in the space BETWEEN
 *  bands -- notes, cross sections -- so the gap has to be usable, not
 *  merely non-zero. Raise this and every band spreads further apart;
 *  lower it and the region gets shorter and tighter. */
CsProfile.GUTTER_FACTOR = 1.0;

CsProfile.layout = function(bands) {
    var i;

    // One pass to get every band's span (or null), so the statistic
    // below is computed from data already in hand -- bandSpan is never
    // asked to recompute the same band's span a second time in the
    // loop that follows.
    var spans = [];
    for (i = 0; i < bands.length; i++) {
        spans.push(CsProfile.bandSpan(bands[i]));
    }

    var heights = [];
    for (i = 0; i < spans.length; i++) {
        if (spans[i] !== null) {
            heights.push(spans[i].hi - spans[i].lo);
        }
    }
    // A plain numeric sort. CaveCAD's own Array.prototype.sort is
    // UNSTABLE for a comparator that calls two DISTINCT elements equal
    // (see this file's other sorts) -- but that concern is about which
    // of two equal-ranked ITEMS ends up first, and there is no
    // per-band identity here to lose: two bands of the same height
    // contribute the same number to this array either way, so any
    // reordering among equal heights produces the identical sorted
    // array of numbers, on both engines.
    heights.sort(function(a, b) { return a - b; });
    var low = 0.0;
    if (heights.length > 0) {
        // Nearest-rank, not interpolated: nearest-rank is biased
        // toward the SMALLER of two straddling samples rather than
        // averaging them, which is exactly what keeps a 2-band profile
        // anchored to its small band instead of splitting the
        // difference with the outlier (see the docblock above).
        var idx = Math.ceil(CsProfile.GUTTER_QUANTILE * heights.length) - 1;
        if (idx < 0) { idx = 0; }
        if (idx > heights.length - 1) { idx = heights.length - 1; }
        low = heights[idx];
    }
    // A FULL typical band height of space, not half. Half left no room
    // to write in: a caver annotates the elevation between the bands --
    // notes, cross sections -- and those need somewhere to sit.
    var gutter = Math.max(CsProfile.GUTTER_MIN, CsProfile.GUTTER_FACTOR * low);

    var placedLo = null, placedHi = null;
    for (i = 0; i < bands.length; i++) {
        var span = spans[i];
        if (span === null) {
            bands[i].zOffset = 0.0;
            continue;
        }
        if (placedLo === null) {
            bands[i].zOffset = 0.0;
            placedLo = span.lo;
            placedHi = span.hi;
            continue;
        }
        // Mere non-overlap, deliberately. Requiring a full gutter of
        // separation here would displace bands that are genuinely clear,
        // and a displaced band no longer reads at true elevation -- the
        // one property an elevation exists to carry. Raising the gutter
        // (GUTTER_FACTOR) gives room where bands actually collide
        // without spending that.
        var clears = (span.lo > placedHi) || (span.hi < placedLo);
        if (clears) {
            bands[i].zOffset = 0.0;
            placedLo = Math.min(placedLo, span.lo);
            placedHi = Math.max(placedHi, span.hi);
            continue;
        }
        bands[i].zOffset = (placedLo - gutter) - span.hi;
        placedLo = span.lo + bands[i].zOffset;
    }
    return bands;
};

/**
 * The whole profile: every band, laid out, with its walls and the
 * findings a report should print.
 *
 * THE ADJACENCY GRAPH IS BUILT EXACTLY ONCE for the whole profile, not
 * once per band. CsProfile.longestChain (reached through CsProfile.
 * unrollBand's own opts.adjacency) rebuilds the whole-survey graph
 * itself whenever it is not handed one; doing that per band is
 * O(runs x legs) and was measured at 60% of total build time on a
 * 401-run survey.
 *
 * C1: THIS GRAPH IS NEVER ACCEPTED FROM THE CALLER, ON PURPOSE -- an
 * earlier version honored an `opts.adjacency` a caller could pass in,
 * reasoning that a caller who already had a graph for this same
 * `resolved` could hand it in and save a rebuild. Measured
 * consequence: a graph built from a DIFFERENT `resolved` -- handed in
 * by mistake, or surviving in a variable across two calls -- silently
 * produces a WRONG profile with no error and no finding. A two-run,
 * six-station survey whose correct bands are a 3-station A and a
 * 4-station B (the tie station is drawn twice, once in each band)
 * collapsed to a 1-station A and a 2-station B under a graph built
 * from an unrelated two-station survey: every lookup in the stale
 * graph simply came back empty, so CsProfile.longestChain's own walk
 * never left its starting station. Nothing in scripts/ ever needed
 * this override -- only this file's own tests exercised it -- so the
 * override itself was the defect. The alternative (stamp a token on
 * the graph CsProfile.adjacency returns, refuse one whose token
 * disagrees with `resolved`) was considered and rejected: a token
 * still lets a future caller pass a matching-but-irrelevant graph, or
 * simply route around the check by constructing one by hand, and
 * every one of those failure modes is silent by nature -- removing
 * the parameter removes the whole failure CLASS rather than adding a
 * guard a later change could quietly bypass.
 *
 * I2: CsLrud.splaysByStation(survey) and CsLrud.legCounts(resolved.
 * legs) get the SAME once-per-profile treatment as the adjacency graph
 * above, for the same reason -- CsProfile.bandWallRuns rebuilding
 * either per band measured at 22.8% and 21.7% of build time
 * respectively (401 runs, 10,024 shots; 45% of build combined,
 * matching the 60% adjacency measurement in scale). Both are built
 * fresh from THIS call's `survey`/`resolved`, every time, same as the
 * adjacency graph -- there is no caller override to reopen the C1 trap
 * for either.
 *
 * AND SO DOES THE LEG INDEX. CsProfile.legIndex(resolved) is built here
 * exactly once and handed down through the same `bandOpts` object,
 * because CsProfile.legBetween and CsProfile.tieLegBetween without it
 * scan all of resolved.legs on EVERY chain step -- 20.2 million leg
 * comparisons on a 4500-station survey, 226 million on a 15,000-station
 * one, and the measured dominant cost of a build. Indexed, those become
 * roughly one comparison per station and the build runs 40-46% faster;
 * see CsProfile.settings' own docblock for the whole before/after table
 * and for what is STILL quadratic afterwards. It is bound by C1 above
 * as strictly as the adjacency graph: no caller override, built from
 * THIS call's `resolved`, and never written onto `opts`.
 *
 * The fields CsProfile.unrollBand reads (tapeMode,
 * adjacency, legIndex) plus the three CsProfile.bandWallRuns reads directly
 * (flatSplayDeg, splaysByStation, legCounts -- it reads tapeMode
 * and tapeMode off the BAND itself instead, set by the unrollBand call
 * that produced it; see bandWallRuns' own docblock for why) are copied
 * into one small fixed-shape object built ONCE here and handed to
 * every band. `opts` itself is never written to -- CsDraw.survey will
 * call this again on every redraw once it is wired up (Task 8), and if
 * it reuses one `opts` object across draws, a graph or map built for
 * an earlier `resolved` must never survive on that object to silently
 * answer for a later one.
 *
 * C2: FINDINGS.UNDRAWN -- every leg CsNetwork.resolve() produced is
 * either drawn in exactly one band above, or reported here with WHY it
 * was not. Not drawing a closure, an extra cross-run contact, a
 * demoted arm, or a leg past a stop is each independently correct (see
 * their own call sites) -- but a survey with a real, surveyed shot
 * that appears in NO band and NO finding is a leg that silently
 * vanished, and the plan's whole findings doctrine exists to prevent
 * exactly that. Reasons:
 *   "closure"        -- kind === "closure"; Task 4 established these
 *                        draw nothing (a closure's own docblock, on
 *                        CsProfile.tieLegBetween, covers why one of
 *                        them still gets used for a TIE step),
 *   "cross-run tie"   -- connects two different runs and is not the
 *                        one tie leg its child run actually drew --
 *                        every hierarchy secondTie is exactly this,
 *                        plus any cross-run "new" contact hierarchy's
 *                        phase 1 ranked below the one it kept,
 *   "demoted arm"     -- both ends in the SAME run, and at least one
 *                        touches a station that run's own band reports
 *                        in `omitted` -- covers both an interior-tie
 *                        split's shorter arm and a station simply off
 *                        the run's own longest chain to begin with;
 *                        unrollBand's `omitted` does not distinguish
 *                        the two causes, so neither does this,
 *   "after-stop"      -- both ends in the same run, NEITHER omitted,
 *                        yet at least one was never actually placed
 *                        into that band's `stations` -- the station
 *                        the walk stopped AT, or anything downstream
 *                        of it, that unrollBand's own `stopped` field
 *                        names only the FIRST of. Computed as run
 *                        membership minus what the band actually drew
 *                        minus what it reports omitted -- the leftover
 *                        is exactly this,
 *   "other"           -- same run, neither end omitted, both ends
 *                        actually drawn, not a closure -- an undrawn
 *                        second contact within one run's own graph.
 *                        No fixture in this suite reaches it (a real
 *                        same-run reconnection is classified "closure"
 *                        by CsNetwork.resolve before it gets here), but
 *                        an unclassified leg must never be silently
 *                        omitted from `undrawn` altogether, so it is
 *                        the fallback, not a missing case.
 *
 * \param opts {flatSplayDeg, tapeMode}
 * \return {
 *   bands: [band] in band order, each an unrollBand result plus
 *          {ceiling, floor, flat, zOffset, pitches},
 *   pitches: every drop and aven in the cave (CsPitch.find), whole,
 *            whether or not any single band draws it whole,
 *   findings: {omitted, mismatches, secondTies, orphans, strandedRoots,
 *              stopped: [{run, station, reason}], ungrouped,
 *              undrawn: [{from, to, kind, reason}],
 *              wallPointsSkipped: n -- review I3: CsProfile.bandWallRuns
 *                  already counts splays it could not place (no usable
 *                  distance/azimuth/inclination); this is the sum of
 *                  that count over every band, so a profile report can
 *                  name the gap the same way CsDraw already does for
 *                  plan view instead of it dying at this, the only
 *                  entry point Tasks 8-11 call}
 * }
 */
CsProfile.build = function(survey, resolved, opts) {
    opts = opts || {};
    // WHICH ELEVATION THIS DRAWING DRAWS.
    //
    // Dispatched here, at the one entry point every caller already
    // uses, rather than at each of them: the renderer, the box, the
    // binder and the report all take a profile-shaped result and none
    // of them should have to know there are two kinds. A projected
    // elevation IS a profile result -- one band, shaped exactly as
    // unrollBand shapes a run -- which is what makes that possible.
    //
    // `opts.mode` wins over the setting so a caller can ask for one
    // explicitly (a test, or a command that offers both); absent, the
    // setting decides, and its default is the extended elevation this
    // suite has always drawn.
    var mode = opts.mode;
    var wantAz = opts.azimuth;
    if (mode === undefined || mode === null) {
        var cfg = CsProject.settings();
        mode = cfg.mode;
        if (wantAz === undefined || wantAz === null) {
            wantAz = cfg.azimuth;
        }
    }
    if (mode === CsProject.MODE_PROJECTED) {
        return CsProject.build(survey, resolved, {
            azimuth: wantAz,
            tapeMode: opts.tapeMode,
            flatSplayDeg: opts.flatSplayDeg
        });
    }
    if (mode === CsProject.MODE_CHUNKED) {
        return CsChunk.build(survey, resolved, {
            tapeMode: opts.tapeMode,
            flatSplayDeg: opts.flatSplayDeg,
            minDrop: opts.minDrop,
            // POSITIONS THE CAVER ALREADY DRAGGED TO. Read off the
            // drawing by the caller (CsDraw.profileNow), because this
            // function is pure and a drawing is not something it can
            // see. Absent, every chunk is placed by the preset, which
            // is what a first draw wants.
            offsets: opts.offsets
        });
    }
    var grouped = CsProfile.groupRuns(resolved);
    var hier = CsProfile.hierarchy(grouped, resolved);

    // C1/I2: always fresh, from THIS resolved/survey, never taken from
    // the caller -- see the docblock above.
    var bandOpts = {
        tapeMode: opts.tapeMode,
        flatSplayDeg: opts.flatSplayDeg,
        adjacency: CsProfile.adjacency(resolved),
        legIndex: CsProfile.legIndex(resolved),
        splaysByStation: CsLrud.splaysByStation(survey),
        legCounts: CsLrud.legCounts(resolved.legs),
        stationAxes: CsLrud.stationAxes(resolved)
    };

    // station name -> its run key, for classifying an undrawn leg as
    // same-run or cross-run below. Built once, over every grouped
    // station, independent of which runs hier.order actually visits.
    var runOf = {};
    var ri, rs;
    for (ri = 0; ri < grouped.order.length; ri++) {
        var roStations = grouped.runs[grouped.order[ri]].stations;
        for (rs = 0; rs < roStations.length; rs++) {
            runOf[roStations[rs]] = grouped.order[ri];
        }
    }

    var bands = [];
    var omitted = [], stopped = [];
    var omittedOf = {};      // stationName -> true, any run's omitted list
    var drawnStationOf = {}; // stationName -> true, appeared in some band.stations
    var drawnLeg = {};       // "from to" AND "to from" -> true
    var wallPointsSkipped = 0; // review I3: summed across every band

    for (var i = 0; i < hier.order.length; i++) {
        var key = hier.order[i];
        var run = grouped.runs[key];
        if (run === undefined) {
            continue;
        }
        var band = CsProfile.unrollBand(run, hier.ties[key], resolved,
            hier, bandOpts);
        var walls = CsProfile.bandWallRuns(band, survey, resolved, bandOpts);
        band.ceiling = walls.ceiling;
        band.floor = walls.floor;
        band.flat = walls.flat;
        band.parent = hier.parents[key];
        // THE DROPS THIS BAND DRAWS WHOLE. A pitch is a property of
        // the cave, not of the elevation, so it is found once
        // (CsPitch) and then attached to whichever band draws both of
        // its ends -- the drawing layer should not be re-deriving what
        // a pitch is, and a band that holds only half a drop must not
        // put a number beside half a line. `text` is carried rather
        // than the unit, so the label a reader sees in the plan and
        // the one they see in the elevation cannot disagree.
        band.pitches = [];
        wallPointsSkipped += walls.skipped;
        bands.push(band);

        for (var k = 0; k < band.omitted.length; k++) {
            omitted.push(band.omitted[k]);
            omittedOf[band.omitted[k]] = true;
        }
        for (var si = 0; si < band.stations.length; si++) {
            drawnStationOf[band.stations[si].name] = true;
        }
        for (var li = 0; li < band.legs.length; li++) {
            var bl = band.legs[li];
            drawnLeg[bl.from + " " + bl.to] = true;
            drawnLeg[bl.to + " " + bl.from] = true;
        }
        if (band.stopped !== null) {
            // The station alone says WHERE a band ended; the reason
            // says WHY, and "a bad Z" versus "a missing leg" ask a
            // surveyor to do two different things (see unrollBand's
            // own docblock) -- flattening both into one bare name here
            // would erase that distinction one call frame before the
            // report that needs it.
            stopped.push({
                run: key,
                station: band.stopped,
                reason: band.stoppedReason
            });
        }
    }

    CsProfile.layout(bands);

    // C2: see the docblock above for what each reason means.
    var undrawn = [];
    for (var li2 = 0; li2 < resolved.legs.length; li2++) {
        var leg = resolved.legs[li2];
        if (drawnLeg.hasOwnProperty(leg.from + " " + leg.to)) {
            continue;
        }
        var reason;
        if (leg.kind === "closure") {
            reason = "closure";
        } else if (runOf[leg.from] !== runOf[leg.to]) {
            reason = "cross-run tie";
        } else if (drawnStationOf[leg.from] !== true ||
                drawnStationOf[leg.to] !== true) {
            reason = (omittedOf[leg.from] === true ||
                omittedOf[leg.to] === true) ? "demoted arm" : "after-stop";
        } else {
            reason = "other";
        }
        undrawn.push({ from: leg.from, to: leg.to, kind: leg.kind,
            reason: reason });
    }

    // ---- pitches, attached to the band that draws them whole -------
    //
    // Found once over the whole cave and then handed to bands, rather
    // than each band deciding for itself what a pitch is: the plan and
    // the elevation must not be able to disagree about how deep a drop
    // is, and the only way to guarantee that is for there to be one
    // answer. A band takes a pitch only when BOTH its ends are in that
    // band -- see CsProfileDraw.pitchLabels for why half a drop gets
    // no number.
    var pitches = CsPitch.find(survey, resolved, {});
    var unitForLabel = survey.distanceUnit;
    for (i = 0; i < bands.length; i++) {
        var bandStations = {};
        for (rs = 0; rs < bands[i].stations.length; rs++) {
            bandStations[bands[i].stations[rs].name] = true;
        }
        for (var pj = 0; pj < pitches.length; pj++) {
            if (bandStations[pitches[pj].top] === true &&
                    bandStations[pitches[pj].bottom] === true) {
                bands[i].pitches.push({
                    top: pitches[pj].top,
                    bottom: pitches[pj].bottom,
                    drop: pitches[pj].drop,
                    aven: pitches[pj].aven,
                    text: CsPitch.label(pitches[pj], unitForLabel)
                });
            }
        }
    }

    return {
        bands: bands,
        pitches: pitches,
        findings: {
            omitted: omitted,
            mismatches: hier.mismatches,
            secondTies: hier.secondTies,
            orphans: hier.orphans,
            strandedRoots: hier.strandedRoots,
            stopped: stopped,
            ungrouped: grouped.ungrouped,
            undrawn: undrawn,
            wallPointsSkipped: wallPointsSkipped
        }
    };
};

/**
 * The settings in force. Reads RSettings when there is one and falls
 * back to the defaults under node, so the pure tests can call it.
 *
 * ProfileAuto defaults TRUE: the user asked for the profile to be a
 * product of drawing, not a command to remember.
 *
 * maxStations: CsDraw.profile's own gate on the AUTOMATIC pass, read
 * from CaveSurvey/ProfileAutoMaxStations. Compared against the survey's
 * TOTAL STATION COUNT; the LARGEST SINGLE RUN is also computed there and
 * named in the skip reason for diagnostic value, but is not itself a
 * separate condition -- see CsDraw.profile for where both figures are
 * computed (a plain CsProfile.groupRuns() pass, cheap relative to what a
 * skip avoids) and the comment on its comparison for why one number,
 * not two, decides the outcome.
 *
 * THIS USED TO CHECK THE LARGEST RUN ALONE, ON A THEORY THAT MEASURED
 * FALSE. The reasoning at the time was that CsProfile.longestChain's
 * chain search is quadratic in ONE run's length (true, see that
 * function's own docblock), so a cave chopped into many small named
 * runs should cost "nothing like" one run holding all the same
 * stations. Measured on CaveCAD (this engine -- the only one a real
 * draw ever runs in; node is roughly 15-25x faster on this same pure
 * code and would understate every number below), best of three runs,
 * one shape per process so the engine's own GC pauses cannot smear one
 * shape's cost onto the next:
 *
 *   shape                                BEFORE the leg index      AFTER it
 *                                           ms   comparisons      ms  comparisons
 *   ----------------------------------   -----  ------------   -----  -----------
 *   one 1000-station run                   112       998,001      67          999
 *   one 1200-station run                   158     1,437,601      94        1,199
 *   eight 150-station runs (1200)          153     1,445,994      88        1,206
 *   one 2400-station run                   601     5,755,201     355        2,399
 *   sixteen 150-station runs (2400)        579     5,791,186     323        2,414
 *   one 3000-station run                   933     8,994,001     539        2,999
 *   twenty 150-station runs (3000)         905     9,050,982     505        3,018
 *   one 4500-station run                  2095    20,241,001    1252        4,499
 *   thirty 150-station runs (4500)        1918    20,371,472    1088        4,528
 *   one 4800-station run                  2449    23,030,401    1442        4,799
 *   thirty-two 150-station runs (4800)    2189    23,179,170    1229        4,830
 *   one 8000-station run                  7197    63,984,001    4267        7,999
 *   fifty 150-station runs (7500)         5381    56,602,452    2935        7,548
 *   a hundred 150-station runs (15000)   21190   226,454,902   11563       15,098
 *
 * TWO SEPARATE FACTS LIVE IN THAT TABLE. First, the "costs nothing
 * like" claim was false and still is: at every size, one big run and
 * many small runs summing to the same TOTAL cost within a few percent
 * of each other. A largest-run-only gate measured a quantity that does
 * not govern the cost it existed to bound -- it let the many-small-runs
 * shape through while doing nothing extra to catch the one shape it was
 * actually built for. THAT is why the condition checks the total.
 *
 * Second, the leg comparison column: CsProfile.legBetween used to scan
 * all of resolved.legs on every chain step, so the comparison count
 * grew as O(total stations x total legs) -- 226 MILLION comparisons on a
 * 15,000-station survey. CsProfile.legIndex (built once per build, see
 * CsProfile.build) makes each of those a one-bucket lookup and the
 * column collapses to roughly one comparison per station. Build time
 * fell 40-46% across the whole table.
 *
 * WHAT IS STILL QUADRATIC, AND WHERE IT MOVED TO. Build time did NOT
 * become linear, and the table above shows it plainly: 3000 stations at
 * ~0.5s, 4500 at ~1.25s, 8000 at ~4.3s. Measured per function on
 * CaveCAD after the index, the dominant term is now CsProfile.
 * bandWallRuns -- 452ms of a 566ms build at one 3000-station run,
 * 1014ms of a 1099ms build at thirty 150-station runs (78-92% across
 * these sizes), against CsProfile.longestChain's 222ms of 1221ms at a
 * single 4500-station run and 40ms of 1099ms spread over thirty runs.
 * The cause is the same SHAPE one function over: CsModel.lrudForStation
 * is a full linear scan of survey.shots, it never early-exits, and
 * CsProfile.bandWallRuns calls it once per station in every band --
 * O(total stations x total shots), exactly what CsProfile.legBetween
 * was. Scratch-measured (a hoisted station -> LRUD map, NOT part of
 * this change): one 4500-station run 1276ms -> 248ms, thirty
 * 150-station runs 1132ms -> 69ms, one 3000-station run 562ms -> 102ms,
 * a hundred 150-station runs 11837ms -> 1780ms. That is the change that
 * would earn a higher ceiling here; it belongs to CsModel or to a third
 * hoisted map beside splaysByStation and legCounts, and has its own
 * review surface.
 *
 * WHY THE DEFAULT STAYS AT 3000. The gate exists because this runs on
 * EVERY plan draw (CsDraw.profile), and a draw that silently takes
 * seconds longer is worse than one that says why it declined. At 3000
 * the automatic pass now costs about half a second on CaveCAD instead
 * of about nine tenths -- the same ceiling, bought with twice the
 * margin. Raising it was considered and rejected on the numbers above:
 * 4500 would put a ~1.25s stall on every draw and 8000 a ~4.3s one, and
 * because the remaining term is still quadratic in the TOTAL, every
 * step up the ceiling costs more than the last. A faster legBetween
 * makes the 3000 default comfortable; it does not make a bigger number
 * safe. The honest unlock is the lrudForStation index above, measured
 * at ~0.1s for 3000 and ~1.8s for 15,000 -- with that in, raising this
 * default (or dropping the gate) becomes a decision about the largest
 * cave anyone draws, not about the engine.
 *
 * A run that is branchy rather than chain-shaped can still cost far
 * more than its station count suggests independent of either number
 * here -- a balanced-binary-tree-shaped 511-station run measures
 * seconds on CaveCAD against a few milliseconds for an ordinary
 * 511-station chain, and that cost is almost entirely CsProfile.
 * longestChain's own O(n^2) search over many leaf starts, untouched by
 * the leg index (its comparison count barely moves). Neither the
 * largest-run nor the total check catches this when the run itself
 * stays under the threshold -- see CsProfile.longestChain's own
 * docblock, which already says a real survey run does not take this
 * shape and names it as the place to look first if one ever does.
 */
CsProfile.settings = function() {
    var auto = true, dead = CsProfile.FLAT_SPLAY_DEG;
    var maxStations = CsProfile.AUTO_MAX_STATIONS_DEFAULT;
    try {
        auto = RSettings.getBoolValue("CaveSurvey/ProfileAuto", true);
        dead = RSettings.getDoubleValue("CaveSurvey/ProfileFlatSplayDeg",
            CsProfile.FLAT_SPLAY_DEG);
        maxStations = RSettings.getIntValue(
            "CaveSurvey/ProfileAutoMaxStations",
            CsProfile.AUTO_MAX_STATIONS_DEFAULT);
    } catch (e) {
        // no RSettings (node): the defaults above stand
    }
    if (!(dead >= 0)) {
        dead = CsProfile.FLAT_SPLAY_DEG;
    }
    if (!(maxStations > 0)) {
        // Guards a corrupted/hand-edited ini value the same way dead
        // does above -- NOT defensive filler. A NaN (a
        // non-numeric string in the ini file) fails every ">"/">="
        // comparison, so an unguarded gate would silently never fire
        // (every survey looks "under the limit"), and a zero or
        // negative value would silently ALWAYS fire (every survey looks
        // "over" it) -- both are the opposite of "the user's setting is
        // honored", so both fall back to the shipped default instead.
        maxStations = CsProfile.AUTO_MAX_STATIONS_DEFAULT;
    }
    return { auto: auto, flatSplayDeg: dead,
        maxStations: maxStations };
};
