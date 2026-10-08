// CsChunk.js -- the cave in PIECES, split where a caver would split it,
// so an elevation can be arranged rather than merely generated.
//
// Part of the Cave Survey Core library: pure functions.
//
// WHY NEITHER WHOLE-CAVE ELEVATION IS ENOUGH. Both existing modes take
// the whole cave and one rule, and both pay for it somewhere:
//
//   EXTENDED   unrolls, which needs one X axis per run, so the bands
//              are stacked down the page and DISPLACED off true
//              elevation to stop them overprinting. Every depth on the
//              page then needs arithmetic before it means anything.
//
//   PROJECTED  keeps true position, so nothing is displaced -- and
//              passages that really are on top of each other are drawn
//              on top of each other. On Plumbline Pit the window
//              passage and the Bell Hole cross, because underground
//              they very nearly do.
//
// The answer a cartographer has always used is neither: draw the cave
// in PIECES, each piece at its true depth, and lay the pieces out on
// the sheet so none of them collide. A pit map is a set of panels -- a
// drop, the passage at its foot, the next drop -- joined by tie lines.
// That is what this file produces.
//
// WHERE THE SPLITS GO: at the pitches. A drop is one chunk, rebelays
// included, exactly as CsPitch groups it; the passage between two
// drops is another. Derived from the survey rather than asked for, so
// it needs no input and follows the survey when the survey changes --
// and it matches how a pit cave is described out loud: "the 187, then
// the crawl, then the 92".
//
// DEPTH IS LOCKED. A chunk slides sideways and never up or down, so
// every chunk on the page reads at its real elevation and two of them
// side by side can be compared by eye. That is precisely what the
// extended elevation gives up when it displaces a band, and giving it
// up is what made the displaced bands need a caption explaining
// themselves.

var CsChunk = {};

CsChunk.KIND_PITCH = "pitch";
CsChunk.KIND_PASSAGE = "passage";

/** Horizontal room between two chunks on the sheet, as a fraction of a
 *  typical chunk width. Wide enough that the tie lines between chunks
 *  are readable as connections rather than as passage. */
CsChunk.GAP_FRACTION = 0.35;
/** ...and never less than this, in survey units, so a cave of narrow
 *  chunks does not end up with its pieces touching. */
CsChunk.GAP_MIN = 12.0;

/**
 * Splits a resolved survey into chunks at its pitches.
 *
 * A pitch chunk holds the drop's own stations and legs. A passage
 * chunk holds a connected piece of what is left once the pitch legs
 * are taken out.
 *
 * THE BOUNDARY STATIONS BELONG TO BOTH. A pitch's head is the last
 * station of the passage above it and the first of the drop; that is
 * not a conflict to be resolved, it is the JOIN, and having the
 * station in both chunks is what lets the drawing put a tie line
 * between two pieces that each know where it is. Nothing is drawn
 * twice: a station's marks come from the chunk that owns its legs, and
 * the tie is drawn once, by the layout.
 *
 * \param opts {minDrop} -- passed to CsPitch.find; a plumbed step too
 *             short to be a pitch is not a chunk boundary either, or a
 *             cave would shatter into pieces at every awkward step
 *
 * \return [{key, kind, stations: {name: true}, legs: {legKey: true},
 *           stationList, pitch, top, bottom, topZ, bottomZ}]
 *         deepest-topped first, so a reader laying them out left to
 *         right walks down the cave
 */
CsChunk.split = function(survey, resolved, opts) {
    var o = opts || {};
    if (resolved === null || resolved === undefined || !resolved.legs) {
        return [];
    }
    var pitches = CsPitch.find(survey, resolved, o);

    // Which legs belong to a pitch, and which pitch.
    var pitchOfLeg = {};
    var i, k, seg;
    for (i = 0; i < pitches.length; i++) {
        for (k = 0; k < pitches[i].segments.length; k++) {
            seg = pitches[i].segments[k];
            pitchOfLeg[CsProject.legKey(seg.from, seg.to)] = i;
        }
    }

    var chunks = [];

    // ---- one chunk per pitch ---------------------------------------
    for (i = 0; i < pitches.length; i++) {
        var p = pitches[i];
        var pst = {}, plg = {};
        for (k = 0; k < p.stations.length; k++) {
            pst[p.stations[k]] = true;
        }
        for (k = 0; k < p.segments.length; k++) {
            plg[CsProject.legKey(p.segments[k].from, p.segments[k].to)] = true;
        }
        chunks.push({
            key: (p.aven ? "AVEN-" : "PITCH-") + p.top,
            kind: CsChunk.KIND_PITCH,
            stations: pst,
            stationList: p.stations.slice(0),
            legs: plg,
            pitch: p,
            top: p.top,
            bottom: p.bottom
        });
    }

    // ---- the rest, as connected pieces -----------------------------
    //
    // Union-find over the NON-pitch legs. A passage chunk is whatever
    // stays connected once the ropes are taken out of the graph, which
    // is exactly "the cave you can walk around without rigging".
    var parent = {};
    var find = function(a) {
        while (parent[a] !== a) {
            parent[a] = parent[parent[a]];
            a = parent[a];
        }
        return a;
    };
    var union = function(a, b) {
        if (parent[a] === undefined) { parent[a] = a; }
        if (parent[b] === undefined) { parent[b] = b; }
        var ra = find(a), rb = find(b);
        if (ra !== rb) { parent[ra] = rb; }
    };
    var walkLegs = [];
    for (i = 0; i < resolved.legs.length; i++) {
        var leg = resolved.legs[i];
        if (leg.shot.excludeFromAll || leg.shot.excludeFromPlot) {
            continue;
        }
        var lk = CsProject.legKey(leg.from, leg.to);
        if (pitchOfLeg.hasOwnProperty(lk)) {
            continue;
        }
        if (resolved.stations[leg.from] === undefined ||
                resolved.stations[leg.to] === undefined) {
            continue;
        }
        union(leg.from, leg.to);
        walkLegs.push({ leg: leg, key: lk });
    }

    var groups = {};
    for (i = 0; i < walkLegs.length; i++) {
        var root = find(walkLegs[i].leg.from);
        if (groups[root] === undefined) {
            groups[root] = { stations: {}, stationList: [], legs: {} };
        }
        var g = groups[root];
        g.legs[walkLegs[i].key] = true;
        var ends = [walkLegs[i].leg.from, walkLegs[i].leg.to];
        for (k = 0; k < 2; k++) {
            if (g.stations[ends[k]] !== true) {
                g.stations[ends[k]] = true;
                g.stationList.push(ends[k]);
            }
        }
    }
    for (var rootKey in groups) {
        if (!groups.hasOwnProperty(rootKey)) { continue; }
        chunks.push({
            key: "PASSAGE-" + CsChunk.shallowest(groups[rootKey].stationList,
                resolved),
            kind: CsChunk.KIND_PASSAGE,
            stations: groups[rootKey].stations,
            stationList: groups[rootKey].stationList,
            legs: groups[rootKey].legs,
            pitch: null,
            top: CsChunk.shallowest(groups[rootKey].stationList, resolved),
            bottom: CsChunk.deepest(groups[rootKey].stationList, resolved)
        });
    }

    for (i = 0; i < chunks.length; i++) {
        chunks[i].topZ = CsChunk.zOf(resolved, chunks[i].top);
        chunks[i].bottomZ = CsChunk.zOf(resolved, chunks[i].bottom);
    }

    // Highest-topped first: laid out left to right, a reader then
    // walks down the cave across the page, which is the order they
    // would walk it underground.
    chunks.sort(function(a, b) {
        if (a.topZ !== b.topZ) { return b.topZ - a.topZ; }
        return (a.key < b.key) ? -1 : ((a.key > b.key) ? 1 : 0);
    });
    return chunks;
};

CsChunk.zOf = function(resolved, name) {
    var st = resolved.stations[name];
    return (st === undefined || st === null) ? 0 : st.z;
};

CsChunk.shallowest = function(names, resolved) {
    var best = null, bestZ = null;
    for (var i = 0; i < names.length; i++) {
        var z = CsChunk.zOf(resolved, names[i]);
        if (bestZ === null || z > bestZ ||
                (z === bestZ && names[i] < best)) {
            bestZ = z; best = names[i];
        }
    }
    return best;
};

CsChunk.deepest = function(names, resolved) {
    var best = null, bestZ = null;
    for (var i = 0; i < names.length; i++) {
        var z = CsChunk.zOf(resolved, names[i]);
        if (bestZ === null || z < bestZ ||
                (z === bestZ && names[i] < best)) {
            bestZ = z; best = names[i];
        }
    }
    return best;
};

/**
 * Where two chunks join: the stations they share.
 *
 * \return [{station, a, b}] -- a and b are indices into `chunks`
 */
CsChunk.ties = function(chunks) {
    var out = [];
    for (var i = 0; i < chunks.length; i++) {
        for (var j = i + 1; j < chunks.length; j++) {
            for (var k = 0; k < chunks[i].stationList.length; k++) {
                var name = chunks[i].stationList[k];
                if (chunks[j].stations[name] === true) {
                    out.push({ station: name, a: i, b: j });
                }
            }
        }
    }
    return out;
};

/**
 * Each chunk drawn as its own small projected elevation, at TRUE
 * elevation, and offset sideways so the pieces do not collide.
 *
 * WHY PROJECTED WITHIN A CHUNK rather than unrolled: a passage chunk
 * can still branch and can still hold a loop, and unrolling needs one
 * path through it -- the very problem that makes the whole-cave
 * extended elevation displace its bands. A chunk is small enough that
 * a projection hides almost nothing, and it keeps loops closed. Each
 * chunk gets its OWN plane (its own longest direction), which is a
 * freedom the whole-cave projection does not have and is most of why
 * the pieces read better than the whole.
 *
 * \param offsets {chunkKey: x} -- positions a caver has already
 *        dragged to, which always win. A chunk with no remembered
 *        position is placed by the preset.
 *
 * \return [band] in CsProfile band shape, ready for CsProfileDraw
 */
CsChunk.bands = function(survey, resolved, chunks, opts) {
    var o = opts || {};
    var offsets = o.offsets || {};
    var i;

    var splaysByStation = CsLrud.splaysByStation(survey);
    var legCounts = CsLrud.legCounts(resolved.legs);
    var stationAxes = CsLrud.stationAxes(resolved);
    var wallPointsSkipped = 0;

    // Each chunk built WHOLE in its own local coordinates first --
    // walls included -- because the walls are what a chunk's width
    // actually is.
    //
    // MEASURED FROM THE DRAWN EXTENT, NOT THE CENTRELINE. The first
    // version of this laid the chunks out on their stations' spread
    // and the pieces overlapped: Plumbline's entrance drop is a rope
    // with a bell chamber at the bottom of it, so its centreline is a
    // line of zero width and its splay ring fans twenty-five feet
    // either side. A layout that does not look at the walls puts the
    // next chunk straight through that chamber.
    var raw = [];
    for (i = 0; i < chunks.length; i++) {
        // EACH PIECE DRAWN THE WAY ITS OWN SHAPE DESERVES. A piece
        // CsChunk.refine measured as folding back on itself is
        // unrolled, so it reads end to end; everything else is
        // projected, so it keeps true position. Neither is a property
        // of the cave and neither is a setting -- it is decided per
        // piece, from that piece's own geometry.
        var band = null;
        if (chunks[i].layout === CsChunk.LAYOUT_UNROLLED) {
            band = CsChunk.unrolledBand(survey, resolved, chunks[i], o);
            if (band !== null) {
                // An unrolled band carries no projection of its own.
                // The wall builder still needs ONE axis for the piece
                // -- see CsProfile.bandWallRuns' fixedAzimuth note --
                // and for an unrolled piece that axis is per station,
                // which is what bandWallRuns does by default. Null
                // here asks for exactly that.
                band.projection = null;
                band.datum = null;
            }
        }
        if (band === null) {
            band = CsProject.band(survey, resolved, {
                stations: chunks[i].stations,
                legs: chunks[i].legs,
                tapeMode: o.tapeMode
            });
            chunks[i].layout = CsChunk.LAYOUT_PROJECTED;
        }
        var walls = CsProfile.bandWallRuns(band, survey, resolved, {
            tapeMode: o.tapeMode,
            flatSplayDeg: o.flatSplayDeg,
            splaysByStation: splaysByStation,
            legCounts: legCounts,
            stationAxes: stationAxes,
            // One axis for a PROJECTED piece, the passage's own
            // direction per station for an UNROLLED one.
            fixedAzimuth: (band.projection === null ||
                band.projection === undefined) ? null :
                band.projection.azimuth
        });
        band.ceiling = walls.ceiling;
        band.floor = walls.floor;
        band.flat = walls.flat;
        band.parent = null;
        wallPointsSkipped += (walls.skipped || 0);
        var ext = CsChunk.extentOf(band);
        raw.push({ band: band, lo: ext.lo, hi: ext.hi });
    }

    // A PITCH IS A LINE AND STILL NEEDS ROOM. A drop with no chamber
    // at either end really is zero wide -- that is what a rope is --
    // so the gap either side of it is what keeps its label and its tie
    // lines off its neighbours.
    var widths = [];
    for (i = 0; i < raw.length; i++) {
        widths.push(raw[i].hi - raw[i].lo);
    }
    var gap = Math.max(CsChunk.GAP_MIN,
        CsChunk.median(widths) * CsChunk.GAP_FRACTION);

    var bands = [];
    var cursor = 0;
    for (i = 0; i < chunks.length; i++) {
        var width = raw[i].hi - raw[i].lo;
        var shift;
        if (offsets.hasOwnProperty(chunks[i].key)) {
            // A POSITION THE CAVER CHOSE, and it wins. The cursor still
            // advances past it so the chunks that follow are laid out
            // around the arrangement rather than through it.
            shift = offsets[chunks[i].key];
        } else {
            shift = cursor - raw[i].lo;
        }
        var placed = CsChunk.shiftBand(raw[i].band, shift);
        placed.key = chunks[i].key;
        placed.chunkKind = chunks[i].kind;
        placed.chunkLayout = chunks[i].layout;
        placed.chunkOffset = shift;
        // DEPTH IS LOCKED, and this is the line that locks it. Every
        // other elevation in this suite may set a zOffset to fit more
        // cave on a page; a chunk may not, because being able to
        // compare two chunks' depths by eye is the whole reason the
        // cave was cut up in the first place.
        placed.zOffset = 0.0;
        bands.push(placed);
        cursor = Math.max(cursor, raw[i].hi + shift) + gap;
    }
    bands.wallPointsSkipped = wallPointsSkipped;
    return bands;
};

/**
 * Past this much of a chunk folded back on itself, projecting it hides
 * more than unrolling it drops.
 *
 * A PROJECTION HIDES, AN UNROLLING DROPS, and neither is free. Flatten
 * a wandering trunk onto one plane and the parts of it that double
 * back land on top of the parts that came the other way; unroll it
 * instead and it reads end to end, at the price of one path through
 * every junction. Which cost is smaller is a fact about the piece of
 * cave, not about the cave as a whole -- which is the entire reason
 * this is decided per chunk.
 *
 * MEASURED, NOT GUESSED: a chunk's legs are walked and their
 * along-plane steps summed, then compared with the span the chunk
 * actually occupies on the page. Pitfall Cave's main trunk walks 1424
 * ft along its own plane and spans 825, so two fifths of it is
 * somewhere behind the rest of it. Plumbline Pit's pieces fold by
 * almost nothing, which is why the pit reads perfectly well projected
 * and the trunk does not.
 */
CsChunk.FOLD_LIMIT = 0.25;

/**
 * How much of a chunk is folded back behind itself when projected:
 * 0 for a piece that runs straight along its own plane, approaching 1
 * for one that doubles back on every leg.
 */
CsChunk.foldOf = function(band) {
    var walked = 0.0;
    for (var i = 0; i < band.legs.length; i++) {
        walked += Math.abs(band.legs[i].toX - band.legs[i].fromX);
    }
    if (!(walked > 0)) {
        // A chunk with no along-plane extent at all -- a rope. Nothing
        // is folded behind anything, because there is nothing beside
        // it; the answer is 0 rather than a division by zero.
        return 0.0;
    }
    var ext = CsChunk.extentOf(band);
    var span = ext.hi - ext.lo;
    var fold = 1.0 - (span / walked);
    return (fold < 0) ? 0.0 : fold;
};

/**
 * One chunk UNROLLED instead of projected: X is distance walked along
 * the passage, exactly as the extended elevation does it, but for this
 * piece alone and at its own true elevation.
 *
 * Built through CsProfile.unrollBand, from a run made of the chunk's
 * own stations, so there is one implementation of unrolling in this
 * codebase and not two.
 *
 * \return a band, or null when the chunk cannot be unrolled at all
 */
CsChunk.unrolledBand = function(survey, resolved, chunk, opts) {
    var o = opts || {};
    var run = { key: chunk.key, stations: chunk.stationList.slice(0) };
    var band;
    try {
        band = CsProfile.unrollBand(run, null, resolved, null, {
            tapeMode: o.tapeMode,
            adjacency: o.adjacency,
            legIndex: o.legIndex
        });
    } catch (e) {
        return null;
    }
    if (band === null || band === undefined ||
            band.stations.length < 2) {
        return null;
    }
    return band;
};

/** How many refine passes a cave gets before the split is called
 *  final. Each pass can only ever make chunks SMALLER, so this is a
 *  guard against a pathological survey rather than a real limit. */
CsChunk.MAX_REFINE_PASSES = 6;

/**
 * Splits further where a projection would hide too much, and gives the
 * branches it costs their own chunks.
 *
 * THE PIECE THAT MADE THIS NECESSARY is Pitfall Cave's main trunk: 59
 * stations, 1424 ft walked along its own plane, 825 ft of page to do
 * it in. Two fifths of that passage is drawn behind the rest of
 * itself. Unrolling fixes it -- that is what an extended elevation is
 * for -- but unrolling needs ONE path through the piece, and this
 * trunk has branches, so eleven stations would simply be dropped.
 *
 * Neither loss is acceptable and neither has to be taken: a branch
 * that unrolling cannot carry becomes a chunk of its own, tied back at
 * the junction it leaves, at its own true depth. The trunk then reads
 * end to end and the branches are all still on the page. That is the
 * whole idea of chunks applied one level further down, and it is why
 * this is a refinement of the split rather than a choice between two
 * bad layouts.
 *
 * A MIXED CAVE IS THE NORMAL CASE, not a special one. Pitfall is 2400
 * ft of horizontal passage with three drops in it; Plumbline is 380 ft
 * of air with a few crawls. Both go through here and neither is
 * declared to be anything: the trunk unrolls because it measurably
 * folds, the ropes project because they measurably do not, and no
 * setting anywhere says which cave is which.
 */
CsChunk.refine = function(survey, resolved, chunks, opts) {
    var o = opts || {};
    var out = chunks.slice(0);
    for (var pass = 0; pass < CsChunk.MAX_REFINE_PASSES; pass++) {
        var changed = false;
        var next = [];
        for (var i = 0; i < out.length; i++) {
            var chunk = out[i];
            if (chunk.kind !== CsChunk.KIND_PASSAGE ||
                    chunk.layout === CsChunk.LAYOUT_UNROLLED) {
                next.push(chunk);
                continue;
            }
            var band = CsProject.band(survey, resolved, {
                stations: chunk.stations, legs: chunk.legs,
                tapeMode: o.tapeMode
            });
            if (CsChunk.foldOf(band) <= CsChunk.FOLD_LIMIT) {
                next.push(chunk);
                continue;
            }
            var unrolled = CsChunk.unrolledBand(survey, resolved, chunk, o);
            if (unrolled === null) {
                // Nothing better is available: a piece that cannot be
                // unrolled keeps the projection it has, folded and all.
                // Saying so beats silently pretending it is fine.
                chunk.foldedAnyway = true;
                next.push(chunk);
                continue;
            }
            chunk.layout = CsChunk.LAYOUT_UNROLLED;
            if (unrolled.omitted.length === 0) {
                next.push(chunk);
                continue;
            }
            var pieces = CsChunk.carveBranches(chunk, unrolled.omitted,
                resolved);
            next.push(pieces.trunk);
            for (var b = 0; b < pieces.branches.length; b++) {
                next.push(pieces.branches[b]);
            }
            changed = true;
        }
        out = next;
        if (!changed) {
            break;
        }
    }
    return out;
};

CsChunk.LAYOUT_PROJECTED = "projected";
CsChunk.LAYOUT_UNROLLED = "unrolled";

/**
 * Takes the stations an unrolling could not carry out of a chunk and
 * makes them chunks of their own.
 *
 * EACH BRANCH KEEPS ITS JUNCTION. The station a branch leaves from
 * stays in the trunk AND joins the branch, exactly as a pitch's head
 * belongs to the passage above it and to the drop -- that shared
 * station is the tie, and it is what lets the drawing join two pieces
 * that each know where it is.
 */
CsChunk.carveBranches = function(chunk, omitted, resolved) {
    var isOmitted = {};
    var i;
    for (i = 0; i < omitted.length; i++) {
        isOmitted[omitted[i]] = true;
    }

    // Legs with an omitted end leave the trunk; the rest stay.
    var branchLegs = [], trunkLegs = {};
    for (var key in chunk.legs) {
        if (!chunk.legs.hasOwnProperty(key)) { continue; }
        var ends = String(key).split("\u0000");
        if (isOmitted[ends[0]] === true || isOmitted[ends[1]] === true) {
            branchLegs.push({ key: key, a: ends[0], b: ends[1] });
        } else {
            trunkLegs[key] = true;
        }
    }

    // Connected components over the branch legs.
    var parent = {};
    var find = function(x) {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    };
    var union = function(x, y) {
        if (parent[x] === undefined) { parent[x] = x; }
        if (parent[y] === undefined) { parent[y] = y; }
        var rx = find(x), ry = find(y);
        if (rx !== ry) { parent[rx] = ry; }
    };
    for (i = 0; i < branchLegs.length; i++) {
        union(branchLegs[i].a, branchLegs[i].b);
    }
    var groups = {};
    for (i = 0; i < branchLegs.length; i++) {
        var root = find(branchLegs[i].a);
        if (groups[root] === undefined) {
            groups[root] = { stations: {}, stationList: [], legs: {} };
        }
        var g = groups[root];
        g.legs[branchLegs[i].key] = true;
        var pair = [branchLegs[i].a, branchLegs[i].b];
        for (var k = 0; k < 2; k++) {
            if (g.stations[pair[k]] !== true) {
                g.stations[pair[k]] = true;
                g.stationList.push(pair[k]);
            }
        }
    }

    var trunkStations = {}, trunkList = [];
    for (i = 0; i < chunk.stationList.length; i++) {
        var name = chunk.stationList[i];
        if (isOmitted[name] === true) { continue; }
        trunkStations[name] = true;
        trunkList.push(name);
    }
    var trunk = {
        key: chunk.key, kind: CsChunk.KIND_PASSAGE,
        stations: trunkStations, stationList: trunkList,
        legs: trunkLegs, pitch: null,
        layout: CsChunk.LAYOUT_UNROLLED,
        top: CsChunk.shallowest(trunkList, resolved),
        bottom: CsChunk.deepest(trunkList, resolved)
    };
    trunk.topZ = CsChunk.zOf(resolved, trunk.top);
    trunk.bottomZ = CsChunk.zOf(resolved, trunk.bottom);

    var branches = [];
    for (var rootKey in groups) {
        if (!groups.hasOwnProperty(rootKey)) { continue; }
        var gg = groups[rootKey];
        var head = CsChunk.shallowest(gg.stationList, resolved);
        var branch = {
            key: "BRANCH-" + head, kind: CsChunk.KIND_PASSAGE,
            stations: gg.stations, stationList: gg.stationList,
            legs: gg.legs, pitch: null,
            layout: null,
            top: head,
            bottom: CsChunk.deepest(gg.stationList, resolved)
        };
        branch.topZ = CsChunk.zOf(resolved, branch.top);
        branch.bottomZ = CsChunk.zOf(resolved, branch.bottom);
        branches.push(branch);
    }
    return { trunk: trunk, branches: branches };
};

/** A band's DRAWN horizontal extent: stations, legs and walls. */
CsChunk.extentOf = function(band) {
    var lo = null, hi = null;
    var see = function(x) {
        if (!isFinite(x)) { return; }
        if (lo === null || x < lo) { lo = x; }
        if (hi === null || x > hi) { hi = x; }
    };
    var i, k;
    for (i = 0; i < band.stations.length; i++) { see(band.stations[i].x); }
    for (i = 0; i < band.legs.length; i++) {
        see(band.legs[i].fromX); see(band.legs[i].toX);
    }
    var runs = (band.ceiling || []).concat(band.floor || []);
    for (i = 0; i < runs.length; i++) {
        for (k = 0; k < runs[i].length; k++) { see(runs[i][k].x); }
    }
    for (i = 0; i < (band.flat || []).length; i++) { see(band.flat[i].x); }
    if (lo === null) { return { lo: 0, hi: 0 }; }
    return { lo: lo, hi: hi };
};

/** Slides a band's geometry sideways, in place. */
CsChunk.shiftBand = function(band, dx) {
    var i, k;
    for (i = 0; i < band.stations.length; i++) {
        band.stations[i].x += dx;
    }
    for (i = 0; i < band.legs.length; i++) {
        band.legs[i].fromX += dx;
        band.legs[i].toX += dx;
    }
    var runs = (band.ceiling || []).concat(band.floor || []);
    for (i = 0; i < runs.length; i++) {
        for (k = 0; k < runs[i].length; k++) {
            runs[i][k].x += dx;
        }
    }
    for (i = 0; i < (band.flat || []).length; i++) {
        band.flat[i].x += dx;
    }
    return band;
};

CsChunk.median = function(values) {
    if (values.length === 0) {
        return 0;
    }
    var s = values.slice(0).sort(function(a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return (s.length % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2.0;
};

/**
 * A chunked elevation in CsProfile.build's own shape.
 *
 * One band per chunk, so CsProfileDraw draws, frames, tags, binds and
 * erases them exactly as it does the bands of an extended elevation --
 * the same reuse CsProject gets, for the same reason.
 */
CsChunk.build = function(survey, resolved, opts) {
    var o = opts || {};
    var chunks = CsChunk.refine(survey, resolved,
        CsChunk.split(survey, resolved, o), o);
    var bands = CsChunk.bands(survey, resolved, chunks, o);

    var pitches = CsPitch.find(survey, resolved, o);
    for (var i = 0; i < bands.length; i++) {
        bands[i].pitches = [];
        var inBand = {};
        for (var s = 0; s < bands[i].stations.length; s++) {
            inBand[bands[i].stations[s].name] = true;
        }
        for (var pj = 0; pj < pitches.length; pj++) {
            if (inBand[pitches[pj].top] === true &&
                    inBand[pitches[pj].bottom] === true) {
                bands[i].pitches.push({
                    top: pitches[pj].top,
                    bottom: pitches[pj].bottom,
                    drop: pitches[pj].drop,
                    aven: pitches[pj].aven,
                    text: CsPitch.label(pitches[pj], survey.distanceUnit)
                });
            }
        }
    }

    return {
        bands: bands,
        chunks: chunks,
        ties: CsChunk.ties(chunks),
        pitches: pitches,
        findings: {
            omitted: [], mismatches: [], secondTies: [], orphans: [],
            strandedRoots: [], stopped: [], ungrouped: [], undrawn: [],
            wallPointsSkipped: bands.wallPointsSkipped || 0
        }
    };
};

/** How a chunk names itself on the page. */
CsChunk.caption = function(band) {
    if (band.chunkKind === CsChunk.KIND_PITCH) {
        if (band.pitches && band.pitches.length > 0) {
            return band.pitches[0].text.toUpperCase();
        }
        return String(band.key).replace(/-/g, " ");
    }
    return String(band.key).replace("PASSAGE-", "FROM ");
};
