// CsShapeLine.js -- Shaped Lines core: cave-map line symbology (ledge
// hachures, flowstone/rimstone scallops) generated as REAL entities
// along a spine curve, and regenerated whenever the spine changes.
//
// Part of the Cave Survey Core library. The geometry functions are
// pure JS (node-testable); everything that needs the engine is grouped
// at the bottom and guarded, following the Core convention.
//
// WHY REAL GEOMETRY AND NOT A SHAPED LINETYPE. The fork's engine can
// render complex linetypes (the machinery is GPL; only a Pro-plugin
// check gates the parser), but RDxfExporter::writeLinetype persists
// DASH LENGTHS ONLY -- a shaped linetype survives until the first
// save, then reopens as plain dashes. Cave maps live as DXF on Drive
// and get exchanged; symbology must survive the file's own life
// cycle. See docs/superpowers/specs/2026-08-28-shaped-lines-design.md.
//
// The NSS 1976 direction rule all five styles encode: ORNAMENT LIVES
// ON THE DOWN SIDE ("hachures point down"). Geometry cannot know which
// side is down, so side is a per-feature tag the caver can flip.

var CsShapeLine = {};

/**
 * Tag keys, all in the CaveSurvey custom-property group via CsTags.
 *
 * The spine carries STYLE/ID/SIDE/SCALE/SIG; every decoration entity
 * carries DECOR=<the spine's id>. Decor is DERIVED state: never edit
 * it, always rebuild it from the spine.
 */
CsShapeLine.KEY = {
    STYLE: "ShapeStyle",
    ID: "ShapeId",
    SIDE: "ShapeSide",
    SCALE: "ShapeScale",
    SIG: "ShapeSig",
    DECOR: "ShapeDecor",
    FRAME: "ShapeFrame",
    // "glyphs" only (2026-09-12). SEED is CsArea's own AreaSeed idea,
    // carried over verbatim: rolled once when a spine first gets this
    // style, then never touched again by a regeneration -- the same
    // rule that keeps a boulder pile from reshuffling under a caver who
    // has been looking at it for weeks. SYMBOL is which catalog block
    // the caver picked; empty means the style's own symbolDefault.
    SEED: "ShapeSeed",
    SYMBOL: "ShapeSymbol",
    // "this wall was dressed BY THE SWITCH, not by hand" (2026-09-12).
    // It decides two things: whether the side is recomputed per station
    // against the survey, and whether turning the switch off may remove
    // this decoration. A hand tool that edits an auto-dressed spine
    // clears it, because after that the caver owns the wall and a
    // toggle must not wipe their work.
    AUTO: "ShapeAuto"
};

/**
 * The profile-frame twin of every layer a style names. ONE mapping,
 * consulted by layersFor below -- the same buttons draw both views,
 * and which family a feature belongs to is decided by WHERE the stroke
 * landed (CsProfileBox), recorded on the spine as ShapeFrame so a
 * regeneration never re-litigates it from geometry that may since
 * have been dragged.
 */
CsShapeLine.PROFILE_TWIN = {};
CsShapeLine.PROFILE_TWIN[CsLayers.LEDGE_FLOOR] = CsLayers.PROFILE_LEDGE_FLOOR;
CsShapeLine.PROFILE_TWIN[CsLayers.LEDGE_CEILING] =
    CsLayers.PROFILE_LEDGE_CEILING;
CsShapeLine.PROFILE_TWIN[CsLayers.FLOWSTONE] = CsLayers.PROFILE_FLOWSTONE;
CsShapeLine.PROFILE_TWIN[CsLayers.RIMSTONE] = CsLayers.PROFILE_RIMSTONE;
CsShapeLine.PROFILE_TWIN[CsLayers.SLOPE] = CsLayers.PROFILE_SLOPE;
CsShapeLine.PROFILE_TWIN[CsLayers.CTRL_SHAPE_SPINE] =
    CsLayers.CTRL_PROFILE_SHAPE_SPINE;
CsShapeLine.PROFILE_TWIN[CsLayers.WALL_GLYPHS] = CsLayers.PROFILE_WALL_GLYPHS;

/**
 * The SECTION-frame twin of every layer a style names, exactly as
 * PROFILE_TWIN above and for the same reason.
 *
 * Missing until now, and that was the whole of the cross-section bug on
 * this side of the suite: with no section entry, layersFor fell through
 * to the plan family, so a ledge drawn inside a sketching bay landed on
 * LEDGE-FLOOR. It LOOKED right -- the ornament appeared under the
 * cursor -- while counting toward the plan's data window, and the
 * capture sweep is geometric, so the plan-layer linework was then
 * swept into the section block.
 */
CsShapeLine.SECTION_TWIN = {};
CsShapeLine.SECTION_TWIN[CsLayers.LEDGE_FLOOR] = CsLayers.SECTION_LEDGE_FLOOR;
CsShapeLine.SECTION_TWIN[CsLayers.LEDGE_CEILING] =
    CsLayers.SECTION_LEDGE_CEILING;
CsShapeLine.SECTION_TWIN[CsLayers.FLOWSTONE] = CsLayers.SECTION_FLOWSTONE;
CsShapeLine.SECTION_TWIN[CsLayers.RIMSTONE] = CsLayers.SECTION_RIMSTONE;
CsShapeLine.SECTION_TWIN[CsLayers.SLOPE] = CsLayers.SECTION_SLOPE;
CsShapeLine.SECTION_TWIN[CsLayers.CTRL_SHAPE_SPINE] =
    CsLayers.CTRL_SECTION_SHAPE_SPINE;
CsShapeLine.SECTION_TWIN[CsLayers.WALL_GLYPHS] = CsLayers.SECTION_WALL_GLYPHS;

/** A style's spine/decor layers for a frame: the STYLES entry's own
 *  layers in the plan, their PROFILE_TWIN in the elevation, their
 *  SECTION_TWIN in a cross section. */
CsShapeLine.layersFor = function(spec, frame) {
    var twin = null;
    if (frame === "profile") {
        twin = CsShapeLine.PROFILE_TWIN;
    } else if (frame === "section") {
        twin = CsShapeLine.SECTION_TWIN;
    }
    if (twin !== null) {
        return {
            spine: twin[spec.spineLayer] || spec.spineLayer,
            decor: twin[spec.decorLayer] || spec.decorLayer
        };
    }
    return { spine: spec.spineLayer, decor: spec.decorLayer };
};

/** The frame a spine was created in, off its ShapeFrame tag. A spine
 *  from before the tag existed answers "plan" -- exactly what every
 *  such spine is, because the draw tools refused profile strokes
 *  until the tag shipped.
 *
 *  This is what every REGENERATION routes through (buildDecor below),
 *  not just the first draw: a section spine whose tag collapsed back to
 *  "plan" here would have its ornament rebuilt onto the plan family the
 *  next time the caver dragged it, silently undoing a correct first
 *  draw. */
CsShapeLine.frameOfSpine = function(spine) {
    var tag = CsTags.get(spine, CsShapeLine.KEY.FRAME);
    if (tag === "profile" || tag === "section") {
        return tag;
    }
    return "plan";
};

/**
 * The five styles. Sizes are in FEET and converted per drawing unit at
 * decorate time (CsTrace.spacingFor), so one number means the same
 * thing in a foot drawing and a metre one -- the FeatureTrace
 * convention.
 *
 * kind "ticks":    perpendicular hachures every spacingFeet, sizeFeet
 *                  long, on the SIDE side of travel.
 * kind "scallops": one polyline of arc bulges, chord spacingFeet,
 *                  bowing to the SIDE side. The spine under a scallop
 *                  style is scaffolding, not map ink -- it lives on
 *                  CTRL-SHAPE-SPINE, which is created OFF.
 * kind "fans":     a splayed cluster of short lines every spacingFeet,
 *                  radiating to the SIDE side -- the NSS slope symbol
 *                  ("lines splay down"). The spine is the slope BREAK
 *                  (the top edge); like the scallop styles it is
 *                  scaffolding and hides on CTRL-SHAPE-SPINE.
 * kind "glyphs":   a catalog SYMBOL (default the UIS "Stone blocks"
 *                  block, SYM_BREAKDOWN) placed every spacingFeet,
 *                  offsetFeet out from the spine on the SIDE side,
 *                  rotated to the local tangent, with seeded jitter in
 *                  position/rotation/size (jitterPosFeet, jitterRotDeg,
 *                  jitterScaleFrac). Nathan's ask, 2026-09-12: "the
 *                  stone glyph on the outside of the cave walls at
 *                  regular intervals" -- a sixth shaped-line kind
 *                  rather than a new engine, because the spine-walk,
 *                  side flip and profile/section twins already exist
 *                  and a caver's wall is usually already traced. The
 *                  spine hides on CTRL-SHAPE-SPINE like the other two
 *                  scaffolding kinds; the glyphs themselves are the
 *                  only new layer, WALL-GLYPHS -- wall ornament, not
 *                  BREAKDOWN's floor bulk, so Feature Trace's
 *                  completeness badges and CheckMap's per-layer counts
 *                  cannot conflate the two.
 *
 * Every layer here must be a CsLayers constant, never a literal --
 * a unit test walks this table against the registry.
 */
CsShapeLine.STYLES = {
    "floorledge": {
        label: "Floor Ledge",
        kind: "ticks", spacingFeet: 3.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_FLOOR, decorLayer: CsLayers.LEDGE_FLOOR,
        close: false
    },
    "ceilingledge": {
        label: "Ceiling Ledge",
        kind: "ticks", spacingFeet: 5.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_CEILING, decorLayer: CsLayers.LEDGE_CEILING,
        close: false
    },
    "pit": {
        label: "Pit",
        kind: "ticks", spacingFeet: 3.0, sizeFeet: 2.0,
        spineLayer: CsLayers.LEDGE_FLOOR, decorLayer: CsLayers.LEDGE_FLOOR,
        close: true
    },
    "flowstone": {
        label: "Flowstone",
        kind: "scallops", spacingFeet: 3.0, bulge: 0.5,
        spineLayer: CsLayers.CTRL_SHAPE_SPINE, decorLayer: CsLayers.FLOWSTONE,
        close: false
    },
    "rimstone": {
        label: "Rimstone Dam",
        kind: "scallops", spacingFeet: 2.0, bulge: 0.62,
        spineLayer: CsLayers.CTRL_SHAPE_SPINE, decorLayer: CsLayers.RIMSTONE,
        close: false
    },
    "slope": {
        label: "Slope",
        kind: "fans", spacingFeet: 6.0, sizeFeet: 3.0,
        splayDeg: 22,
        spineLayer: CsLayers.CTRL_SHAPE_SPINE, decorLayer: CsLayers.SLOPE,
        close: false
    },
    // NUMBERS CHOSEN FOR A 1"=50' SHEET (2026-09-12). spacingFeet 8:
    // dense enough to read as a texture running the length of a wall,
    // loose enough that individual glyphs (a heavier mark than a tick)
    // do not merge into a smear the way flowstone's 3 ft scallops
    // would at this size. offsetFeet 1.2: clear of the wall line so
    // the glyph does not overlap it, close enough to still read as
    // "on the wall" rather than a separate floor scatter.
    // sizeScale, NOT sizeFeet: a symbol block is authored at roughly a
    // 1.0-unit (foot) radius of its own origin (see
    // tools/make_area_blocks.js), the same convention CsArea.CATALOG's
    // BLOCKS entry scales -- 1.0 here means "native size", matching
    // that entry's own scaleMin/scaleMax centre.
    // jitterPosFeet 0.4, jitterRotDeg 20, jitterScaleFrac 0.25: enough
    // that a run of glyphs does not look like one rubber stamp dragged
    // sideways, not so much that a caver cannot tell they are looking
    // at a regular pattern at all -- tighter than CsArea's free-
    // scattered BLOCKS (0.7-1.5x) because these sit in a visible row
    // along a wall rather than a loose pile on the floor.
    "glyphs": {
        label: "Wall Glyphs",
        kind: "glyphs", spacingFeet: 8.0, offsetFeet: 1.2, sizeScale: 1.0,
        jitterPosFeet: 0.4, jitterRotDeg: 20, jitterScaleFrac: 0.25,
        symbolDefault: "SYM_BREAKDOWN",
        spineLayer: CsLayers.CTRL_SHAPE_SPINE, decorLayer: CsLayers.WALL_GLYPHS,
        close: false
    }
};

// ---------------------------------------------------------------------
// Pure geometry. Points are plain {x, y}; paths are arrays of them.
// ---------------------------------------------------------------------

CsShapeLine.dist = function(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Cumulative arc length over a path. For a closed path the closing
 * segment (last point back to first) is INCLUDED as one extra entry,
 * so cum[cum.length-1] is always the total walkable length.
 */
CsShapeLine.cumulative = function(pts, closed) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + CsShapeLine.dist(pts[i - 1], pts[i]));
    }
    if (closed && pts.length > 1) {
        cum.push(cum[cum.length - 1] +
            CsShapeLine.dist(pts[pts.length - 1], pts[0]));
    }
    return cum;
};

/** The point at arc distance d, plus the unit tangent of the segment
 *  it falls on. Closed paths wrap through the closing segment. */
CsShapeLine.pointAt = function(pts, closed, cum, d) {
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
    }
    if (closed) {
        d = ((d % total) + total) % total;
    } else {
        d = Math.max(0, Math.min(d, total));
    }
    var i = 1;
    while (i < cum.length && cum[i] < d) {
        i++;
    }
    if (i >= cum.length) {
        i = cum.length - 1;
    }
    var a = pts[i - 1];
    var b = (i < pts.length) ? pts[i] : pts[0];   // closing segment
    var segLen = cum[i] - cum[i - 1];
    var t = (segLen > 0) ? (d - cum[i - 1]) / segLen : 0;
    var tx = b.x - a.x, ty = b.y - a.y;
    var n = Math.sqrt(tx * tx + ty * ty);
    if (n > 0) { tx /= n; ty /= n; }
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
             tx: tx, ty: ty };
};

/**
 * Decoration anchor stations: evenly spaced along the path, INSET half
 * a spacing from open ends (a tick exactly on an endpoint reads like a
 * pen slip), evenly DIVIDED around a closed path so the seam is clean.
 * Each station is {x, y, tx, ty}.
 */
CsShapeLine.stations = function(pts, closed, spacing) {
    if (pts.length < 2 || spacing <= 0) {
        return [];
    }
    var cum = CsShapeLine.cumulative(pts, closed);
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return [];
    }
    var out = [];
    var n, step, i;
    if (closed) {
        n = Math.max(4, Math.round(total / spacing));
        step = total / n;
        for (i = 0; i < n; i++) {
            out.push(CsShapeLine.pointAt(pts, closed, cum, step * (i + 0.5)));
        }
    } else {
        n = Math.max(1, Math.floor(total / spacing));
        step = total / n;
        for (i = 0; i < n; i++) {
            out.push(CsShapeLine.pointAt(pts, closed, cum, step * (i + 0.5)));
        }
    }
    return out;
};

/**
 * Hachure segments: one short line per station, from the spine out to
 * the SIDE side. side=+1 is the RIGHT of the direction of travel
 * (right normal of tangent (tx,ty) is (ty,-tx)); side=-1 the left.
 * Returns [[{x,y},{x,y}], ...].
 */
CsShapeLine.ticks = function(pts, closed, spacing, len, side) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var out = [];
    for (var i = 0; i < st.length; i++) {
        var nx = st[i].ty * side, ny = -st[i].tx * side;
        out.push([{ x: st[i].x, y: st[i].y },
                  { x: st[i].x + nx * len, y: st[i].y + ny * len }]);
    }
    return out;
};

/**
 * Slope fans: at every station, a splayed cluster of three short lines
 * radiating to the SIDE side -- the NSS slope symbol, whose one rule is
 * "lines splay down". The center line runs along the normal at full
 * length; the flanks rotate +/- splayDeg off it and run a touch
 * shorter, which is what makes the cluster read as a splay rather than
 * a comb. Lines start ON the spine (the slope break) and hang
 * downhill. Returns [[p,q], ...] like ticks.
 */
CsShapeLine.FAN_FLANK = 0.82;

CsShapeLine.fans = function(pts, closed, spacing, len, side, splayDeg) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var splay = (splayDeg || 22) * Math.PI / 180;
    var out = [];
    for (var i = 0; i < st.length; i++) {
        var nx = st[i].ty * side, ny = -st[i].tx * side;
        var angles = [-splay, 0, splay];
        for (var a = 0; a < angles.length; a++) {
            var ca = Math.cos(angles[a]), sa = Math.sin(angles[a]);
            var dx = nx * ca - ny * sa, dy = nx * sa + ny * ca;
            var l = (angles[a] === 0) ? len : len * CsShapeLine.FAN_FLANK;
            out.push([{ x: st[i].x, y: st[i].y },
                      { x: st[i].x + dx * l, y: st[i].y + dy * l }]);
        }
    }
    return out;
};

/**
 * Glyph placements: one {x, y, angle, scaleMul} per station, offset
 * `offset` out from the spine on the SIDE side (the same normal ticks()
 * uses, so ShapedFlip's side toggle works on this kind unmodified),
 * rotated to the local tangent, with independent seeded jitter added to
 * position (along both the tangent and the normal), rotation and size.
 *
 * PURE, and `rand` is a caller-supplied () -> [0,1) generator rather
 * than a seed -- this file never rolls dice itself (CsArea.rng/newSeed
 * do that), so the same geometry is exercised under node with a
 * deterministic stub and in the engine with CsArea.rng(seed).
 *
 * DRAW ORDER OF THE THREE rand() CALLS PER STATION IS FIXED (tangent
 * jitter, normal jitter, rotation jitter, then scale jitter) so a given
 * seed always reproduces the same placements regardless of caller --
 * the same discipline CsArea.scatterPlacements documents for its own
 * draws.
 *
 * Returns [{x, y, angle, scaleMul}, ...].
 */
CsShapeLine.glyphPlacements = function(pts, closed, spacing, offset, side,
        jitterPos, jitterRotRad, jitterScaleFrac, rand) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var out = [];
    for (var i = 0; i < st.length; i++) {
        var nx = st[i].ty * side, ny = -st[i].tx * side;
        var bx = st[i].x + nx * offset, by = st[i].y + ny * offset;
        var jt = (rand() * 2 - 1) * jitterPos;
        var jn = (rand() * 2 - 1) * jitterPos;
        var jr = (rand() * 2 - 1) * jitterRotRad;
        var js = (rand() * 2 - 1) * jitterScaleFrac;
        out.push({
            x: bx + st[i].tx * jt + nx * jn,
            y: by + st[i].ty * jt + ny * jn,
            angle: Math.atan2(st[i].ty, st[i].tx) + jr,
            scaleMul: Math.max(0.05, 1 + js)
        });
    }
    return out;
};

// ---- automatic wall edging: which side is OUTSIDE --------------------
//
// Stone glyphs belong outside a cave wall, and the drawing already says
// where the cave is: the survey stations. So the side is not a guess, it
// is geometry -- the direction from a point on the wall to the nearest
// station IS the direction of the cave, and outside is the other way
// (Nathan, 2026-09-12: "can the stone glyphs just automatically appear
// near but outside the cave walls").
//
// DECIDED PER GLYPH, not per wall. One wall can run from open passage
// into a fin between two passages, and the answer differs along it.

/** How far off the wall's own tangent a station must sit before it can
 *  say which side the cave is on. A station nearly ALONG the wall --
 *  which is the normal case at the midpoint of a long shot -- says
 *  almost nothing about across, and taking its word produces a
 *  confident wrong answer. Sine of about 15 degrees. */
CsShapeLine.SIDE_CONFIDENCE = 0.25;

/** How much farther than the nearest station another one may be and
 *  still count as "there is cave over there too". Three times: a
 *  parallel passage much farther off than the one this wall belongs to
 *  is a different part of the cave, not the other side of this rock. */
CsShapeLine.BOTH_SIDES_RATIO = 3.0;

/** Nearest of `stations` to (x, y): {d, sx, sy} , or null when there
 *  are no stations at all (an undrawn survey, a scratch drawing). */
CsShapeLine.nearestStation = function(stations, x, y) {
    var best = null;
    for (var i = 0; i < stations.length; i++) {
        var dx = stations[i].x - x, dy = stations[i].y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (best === null || d < best.d) {
            best = { d: d, sx: stations[i].x, sy: stations[i].y };
        }
    }
    return best;
};

/**
 * For each glyph station along a spine: which side is outside, or skip.
 *
 * \return [{side: 1|-1, skip: bool, sure: bool}, ...] in station order.
 *
 * Three cases, and the middle one is the whole reason this is not a
 * one-liner:
 *
 *   CONFIDENT -- the nearest station sits across the wall, so the
 *   perpendicular part of the direction to it is a real fraction of the
 *   whole. Outside is the opposite side. Most of a cave is this.
 *
 *   AMBIGUOUS -- the nearest station lies roughly ALONG the wall, which
 *   happens in the middle of any long shot with no station between.
 *   Such a station cannot say which way is across, so this station gets
 *   no vote of its own and inherits the wall's own answer (below).
 *
 *   BOTH SIDES -- stepping outward gets CLOSER to some other station
 *   that is not much farther off than the near one. That is a fin or a
 *   pillar: rock with passage on either face, no outside at all, and
 *   the honest thing to draw is nothing. Glyphs pushed into the
 *   neighbouring passage would be a drafting error a reader believes.
 */
CsShapeLine.autoSides = function(pts, closed, spacing, stations, probe) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var out = [];
    var i;
    if (isNull(stations) || stations.length === 0) {
        for (i = 0; i < st.length; i++) {
            out.push({ side: 1, skip: false, sure: false });
        }
        return out;
    }
    var reach = probe > 0 ? probe : 1;
    for (i = 0; i < st.length; i++) {
        var px = st[i].x, py = st[i].y;
        // the +1 normal, matching glyphPlacements' own convention
        var nx = st[i].ty, ny = -st[i].tx;
        var near = CsShapeLine.nearestStation(stations, px, py);
        var vx = near.sx - px, vy = near.sy - py;
        var vlen = Math.sqrt(vx * vx + vy * vy);
        if (!(vlen > 0)) {
            out.push({ side: 1, skip: false, sure: false });
            continue;
        }
        var perp = (vx * nx + vy * ny) / vlen;     // -1 .. 1
        var sure = Math.abs(perp) >= CsShapeLine.SIDE_CONFIDENCE;
        // the cave is toward the station, so outside is away from it
        var side = perp > 0 ? -1 : 1;
        var skip = false;
        if (sure) {
            // is there cave on the OUTWARD side as well?
            var ox = px + nx * side * reach, oy = py + ny * side * reach;
            var far = CsShapeLine.nearestStation(stations, ox, oy);
            var backX = far.sx - px, backY = far.sy - py;
            var backLen = Math.sqrt(backX * backX + backY * backY);
            if (far.d < backLen &&
                    backLen <= near.d * CsShapeLine.BOTH_SIDES_RATIO) {
                skip = true;
            }
        }
        out.push({ side: side, skip: skip, sure: sure });
    }
    // THE NEAREST CONFIDENT NEIGHBOUR ALONG THE WALL fills in for the
    // stations that had no answer of their own.
    //
    // This used to be one vote for the WHOLE run, and that is wrong
    // wherever a run changes sides along its length -- a wall that
    // leaves open passage and becomes a fin between two passages is
    // one polyline with two different answers, and a majority vote
    // gives the losing half stone drawn into the passage next door.
    //
    // MEASURED, which is why it changed: over a cave with long
    // wandering passage a QUARTER of glyph stations come back unsure
    // (Stairstep Cave: 25%, against 11% on a horizontal cave), because
    // the nearest station to a wall's midpoint is usually ahead of it
    // or behind it rather than across it. A fallback that covers a
    // quarter of the drawing is not an edge case, and "the majority of
    // this polyline" is not a direction in the cave.
    //
    // Walking outward from each unsure station to the first confident
    // one on either side, and taking the closer, keeps a side change
    // local to where it actually happens. A run with NO confident
    // station anywhere still needs an answer, and there the old vote
    // is the honest one: +1, arbitrary, and no worse than it was.
    var lastSure = [];
    var seen = -1;
    for (i = 0; i < out.length; i++) {
        if (out[i].sure && !out[i].skip) { seen = i; }
        lastSure.push(seen);
    }
    var nextSure = [];
    seen = -1;
    for (i = out.length - 1; i >= 0; i--) {
        if (out[i].sure && !out[i].skip) { seen = i; }
        nextSure[i] = seen;
    }
    for (i = 0; i < out.length; i++) {
        if (out[i].sure) {
            continue;
        }
        var before = lastSure[i], after = nextSure[i];
        if (before < 0 && after < 0) {
            out[i].side = 1;    // nothing confident anywhere on this wall
        } else if (before < 0) {
            out[i].side = out[after].side;
        } else if (after < 0) {
            out[i].side = out[before].side;
        } else {
            out[i].side = ((i - before) <= (after - i)) ?
                out[before].side : out[after].side;
        }
    }
    return out;
};

/**
 * Glyph placements with a per-station side, and stations skipped.
 *
 * THE DICE ARE ROLLED FOR EVERY STATION, skipped or not -- four draws
 * each, before the skip is applied. Rolling only for the ones that are
 * kept would make the jitter depend on how many were skipped, so
 * editing a wall at one end would reshuffle the glyphs at the other.
 * Same discipline as CsArea's scatter, and for the same reason.
 */
CsShapeLine.glyphPlacementsAuto = function(pts, closed, spacing, offset,
        sides, jitterPos, jitterRotRad, jitterScaleFrac, rand) {
    var st = CsShapeLine.stations(pts, closed, spacing);
    var out = [];
    for (var i = 0; i < st.length; i++) {
        var jt = (rand() * 2 - 1) * jitterPos;
        var jn = (rand() * 2 - 1) * jitterPos;
        var jr = (rand() * 2 - 1) * jitterRotRad;
        var js = (rand() * 2 - 1) * jitterScaleFrac;
        var pick = i < sides.length ? sides[i] : { side: 1, skip: false };
        if (pick.skip === true) {
            continue;
        }
        var nx = st[i].ty * pick.side, ny = -st[i].tx * pick.side;
        var bx = st[i].x + nx * offset, by = st[i].y + ny * offset;
        out.push({
            x: bx + st[i].tx * jt + nx * jn,
            y: by + st[i].ty * jt + ny * jn,
            angle: Math.atan2(st[i].ty, st[i].tx) + jr,
            scaleMul: Math.max(0.05, 1 + js)
        });
    }
    return out;
};

/**
 * Every survey station in the drawing, as plain points.
 *
 * PLAN ONLY, and that is a fact about the drawing rather than a choice:
 * CsDraw and CsRebuild are the only writers of the Station tag and both
 * draw the plan, so a profile band and a section bay contain no station
 * geometry to reason against. Automatic edging therefore answers for
 * plan walls; profile and section walls are dressed by hand with
 * Decorate Selection, which knows the side because a caver told it.
 *
 * Cached per document: the side test runs per GLYPH, and a wall is many
 * glyphs, so re-walking every entity each time would make the switch
 * quadratic on a real cave.
 */
CsShapeLine.planStations = function(doc, cache) {
    if (!isNull(cache) && !isNull(cache.stations)) {
        return cache.stations;
    }
    var out = [];
    try {
        var found = CsTags.collectStations(doc);
        for (var i = 0; i < found.length; i++) {
            // `pos`, which is what collectStations calls it. Reading a
            // field that is not there costs nothing loudly: every
            // station was dropped, the list came back empty, and every
            // wall quietly fell back to its default side (2026-09-12).
            var p = found[i].pos;
            if (!isNull(p) && !isNaN(p.x) && !isNaN(p.y)) {
                out.push({ x: p.x, y: p.y });
            }
        }
    } catch (e) {
        out = [];
    }
    if (!isNull(cache)) {
        cache.stations = out;
    }
    return out;
};

/**
 * The ELEVATION's station cloud, for a profile wall's side test.
 *
 * THE PREMISE THAT THIS IS IMPOSSIBLE IS STALE. WallEdging's own
 * header said plan walls only, "because CsDraw and CsRebuild are the
 * only writers of the Station tag and both draw the plan, so a profile
 * band holds no station geometry to reason against". That was true
 * when it was written. CsProfileDraw tags every station it draws with
 * ProfileStation, and has for as long as the elevation has been a
 * region of the plan drawing -- so the elevation has had exactly the
 * same evidence available all along.
 *
 * It matters more than it did: on a pit map the elevation is the
 * PRIMARY view, so "plan only" meant the main drawing of a vertical
 * cave got no rock outside its walls at all.
 *
 * SCOPED BY PROXIMITY, NOT BY BAND. A chunked elevation lays its
 * pieces out side by side with a gap between them, and the side test
 * only ever asks for the NEAREST station -- so a wall in one piece
 * finds its own piece's stations without anyone having to track which
 * band it belongs to. The one way that could go wrong is two bands
 * closer together than a wall is to its own stations, which the
 * layout's gap exists to prevent.
 */
CsShapeLine.profileStations = function(doc, cache) {
    if (!isNull(cache) && !isNull(cache.profileStations)) {
        return cache.profileStations;
    }
    var out = [];
    try {
        var ids = doc.queryAllEntities(false, true);
        for (var i = 0; i < ids.length; i++) {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) {
                continue;
            }
            if (CsTags.get(e, "ProfileStation") === "") {
                continue;
            }
            // The station POINT, not its label: both carry the tag,
            // and a label sits a couple of text heights above the
            // point it names. Taking both would put a phantom station
            // in the ceiling of every passage.
            if (!(e instanceof RPointEntity)) {
                continue;
            }
            var p = e.getPosition();
            if (!isNull(p) && !isNaN(p.x) && !isNaN(p.y)) {
                out.push({ x: p.x, y: p.y });
            }
        }
    } catch (eProf) {
        out = [];
    }
    if (!isNull(cache)) {
        cache.profileStations = out;
    }
    return out;
};

/**
 * The station cloud a spine's own frame should be measured against.
 *
 * A section is deliberately absent: a section bay is one station's
 * worth of cave seen end-on, so there is no cloud to reason against
 * and no "outside" that geometry can find. Those stay hand-dressed.
 */
CsShapeLine.stationsForFrame = function(doc, cache, frame) {
    if (frame === "profile") {
        return CsShapeLine.profileStations(doc, cache);
    }
    if (frame === "section") {
        return [];
    }
    return CsShapeLine.planStations(doc, cache);
};

/** Is this spine dressed by the switch rather than by hand? */
CsShapeLine.isAuto = function(spine) {
    return CsTags.get(spine, CsShapeLine.KEY.AUTO) === "1";
};

/** A rand() that never jitters -- prims' fallback when a caller asks
 *  for a glyphs style without handing in a seeded generator (the icon-
 *  free code paths that build primitives outside the real document, if
 *  any ever do). No jitter is a safer default than Math.random: a
 *  silently unseeded style would reshuffle a wall's glyphs on every
 *  regeneration, exactly the bug CsArea's own header warns about. */
CsShapeLine.noJitterRand = function() {
    return 0.5;
};

/**
 * Scallop chain: vertices along the path at (roughly) chord spacing,
 * every segment bulged toward SIDE. A POSITIVE DXF bulge bows RIGHT of
 * travel -- probed against RPolyline.getSegmentAt, whose +0.5 bulge
 * from (0,0) to (10,0) has its middle point at (5,-2.5) -- so side +1
 * (right) is the positive bulge.
 * Returns {points: [...], bulges: [...], closed: bool}; bulges[i]
 * belongs to the segment STARTING at points[i], QCAD's convention.
 */
CsShapeLine.scallops = function(pts, closed, chord, bulgeMag, side) {
    if (pts.length < 2 || chord <= 0) {
        return { points: [], bulges: [], closed: !!closed };
    }
    var cum = CsShapeLine.cumulative(pts, closed);
    var total = cum[cum.length - 1];
    if (total <= 0) {
        return { points: [], bulges: [], closed: !!closed };
    }
    var n = Math.max(closed ? 3 : 1, Math.round(total / chord));
    var step = total / n;
    var bulge = side * bulgeMag;
    var points = [], bulges = [];
    var count = closed ? n : n + 1;
    for (var i = 0; i < count; i++) {
        var p = CsShapeLine.pointAt(pts, closed, cum, step * i);
        points.push({ x: p.x, y: p.y });
        // the last vertex of an OPEN chain starts no segment
        bulges.push((!closed && i === count - 1) ? 0 : bulge);
    }
    return { points: points, bulges: bulges, closed: !!closed };
};

/**
 * Geometry signature: what the listener compares to know whether a
 * transaction actually MOVED the spine. Coordinates rounded to 0.001
 * drawing units -- looser and a grip nudge goes unnoticed, tighter and
 * float noise regenerates forever (the no-op-write freeze lesson).
 * FNV-1a over the rounded stream, plus count and closedness.
 */
CsShapeLine.signature = function(pts, closed) {
    var h = 2166136261;
    var mix = function(v) {
        h = h ^ (v & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 8) & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 16) & 0xff); h = (h * 16777619) >>> 0;
        h = h ^ ((v >> 24) & 0xff); h = (h * 16777619) >>> 0;
    };
    for (var i = 0; i < pts.length; i++) {
        mix(Math.round(pts[i].x * 1000) | 0);
        mix(Math.round(pts[i].y * 1000) | 0);
    }
    return (closed ? "c" : "o") + pts.length + "-" + h.toString(36);
};

/** Signed area of a closed path (shoelace). Positive = counter-
 *  clockwise. What the pit tool uses to aim its hachures inward:
 *  around a CCW loop the interior is LEFT of travel (side -1). */
CsShapeLine.signedArea = function(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
};

/** The side value that points INTO a closed path. */
CsShapeLine.inwardSide = function(pts) {
    return CsShapeLine.signedArea(pts) > 0 ? -1 : 1;
};

/**
 * Decoration primitives for one spine, as plain data.
 * spec: a CsShapeLine.STYLES value. spacing/size already in DRAWING
 * units (the caller applied perFoot and the feature's scale).
 * Returns {lines: [[p,q],...], polylines: [{points,bulges,closed}]}.
 */
/**
 * Which side of a path a point lies on: +1 (right of travel) or -1.
 *
 * THE POINT OF IT. The ornament's side used to be "right of the
 * direction you dragged", which a caver cannot see and can only fix by
 * flipping afterwards -- they know where the DROP is, not which way
 * they happened to draw. This answers the question they can answer:
 * point at the low side, and the side comes out of the geometry.
 *
 * The nearest sampled station wins, and the sign is the cross product
 * of that station's tangent with the vector to the point. Nearest and
 * not first: a hooked ledge doubles back, and the side is a local fact
 * about the piece of line the cursor is beside.
 *
 * A CLOSED path (the pit) ignores the cursor's side entirely and always
 * answers inward -- hachures on a pit point INTO the hole, and a caver
 * hovering outside the loop means the same pit either way.
 *
 * Answers null when it cannot tell (too few points, a degenerate
 * tangent, a point exactly on the line); callers keep whatever side
 * they already had rather than flipping on a rounding error.
 *
 * Pure.
 */
CsShapeLine.sideForPoint = function(pts, closed, point) {
    if (isNull(pts) || pts.length < 2 || isNull(point)) {
        return null;
    }
    if (closed === true) {
        return CsShapeLine.inwardSide(pts);
    }
    var best = null, bestD = null, i;
    var last = pts.length - 1;
    for (i = 0; i < last; i++) {
        var a = pts[i], b = pts[i + 1];
        var dx = b.x - a.x, dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;
        if (!(len2 > 0)) {
            continue;
        }
        // The nearest point ON THE SEGMENT, clamped to its ends, so a
        // cursor beyond either end of the line still measures against
        // the piece nearest it rather than against an infinite ray.
        var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
        if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
        var px = a.x + t * dx, py = a.y + t * dy;
        var d = (point.x - px) * (point.x - px) +
                (point.y - py) * (point.y - py);
        if (bestD === null || d < bestD) {
            bestD = d;
            best = { dx: dx, dy: dy, px: px, py: py };
        }
    }
    if (best === null) {
        return null;
    }
    // cross(tangent, toPoint): positive means the point is LEFT of
    // travel, and left of travel is side -1 -- ticks() takes the right
    // normal (ty, -tx) for side +1.
    var cross = best.dx * (point.y - best.py) - best.dy * (point.x - best.px);
    if (cross === 0 || isNaN(cross)) {
        return null;   // exactly on the line: no answer, keep the old one
    }
    return cross > 0 ? -1 : 1;
};

/**
 * `extra` carries the glyphs kind's own numbers -- offset, jitter
 * ranges and a seeded rand() -- rather than growing the positional
 * argument list a sixth time for the one kind that needs them. Every
 * other kind ignores it; a caller that omits it (every existing one)
 * behaves exactly as before.
 */
CsShapeLine.prims = function(pts, closed, spec, side, spacing, size, extra) {
    var out = { lines: [], polylines: [], glyphs: [] };
    if (spec.kind === "ticks") {
        out.lines = CsShapeLine.ticks(pts, closed, spacing, size, side);
    } else if (spec.kind === "fans") {
        out.lines = CsShapeLine.fans(pts, closed, spacing, size, side,
            spec.splayDeg);
    } else if (spec.kind === "scallops") {
        var s = CsShapeLine.scallops(pts, closed, spacing, spec.bulge, side);
        if (s.points.length >= 2) {
            out.polylines.push(s);
        }
    } else if (spec.kind === "glyphs") {
        extra = extra || {};
        if (!isNull(extra.sides)) {
            // automatic edging: the side is decided per station against
            // the survey, not once for the whole wall
            out.glyphs = CsShapeLine.glyphPlacementsAuto(pts, closed,
                spacing, extra.offset || 0, extra.sides,
                extra.jitterPos || 0, extra.jitterRotRad || 0,
                extra.jitterScaleFrac || 0,
                extra.rand || CsShapeLine.noJitterRand);
        } else {
            out.glyphs = CsShapeLine.glyphPlacements(pts, closed, spacing,
                extra.offset || 0, side, extra.jitterPos || 0,
                extra.jitterRotRad || 0, extra.jitterScaleFrac || 0,
                extra.rand || CsShapeLine.noJitterRand);
        }
    }
    return out;
};

/** How many decor ENTITIES prims produce -- the listener's cheap
 *  "is the decoration complete" count. */
CsShapeLine.primCount = function(prims) {
    return prims.lines.length + prims.polylines.length + prims.glyphs.length;
};

// ---------------------------------------------------------------------
// Engine adapter. Everything below needs QCAD types and is guarded so
// this file still evals under node for the pure tests above.
// ---------------------------------------------------------------------

if (typeof RVector !== "undefined") {

/** Sample step for a style, in drawing units: fine enough that the
 *  walk cannot cut a corner a tick would visibly miss. */
CsShapeLine.sampleStep = function(spacingDrawing) {
    return Math.max(spacingDrawing / 6, 1e-6);
};

CsShapeLine.sampleLineSeg = function(a, b, step, out) {
    var d = CsShapeLine.dist(a, b);
    var n = Math.max(1, Math.ceil(d / step));
    for (var i = 1; i <= n; i++) {
        out.push({ x: a.x + (b.x - a.x) * i / n,
                   y: a.y + (b.y - a.y) * i / n });
    }
};

/** Sample a bulge segment (DXF bulge = tan(theta/4)). Calibrated
 *  against the engine, not convention lore: RPolyline.getSegmentAt on
 *  a +0.5 bulge from (0,0) to (10,0) answers center (5, 3.75) and
 *  middle point (5, -2.5) -- a positive bulge bows RIGHT of travel and
 *  its center sits on the LEFT. Emits everything AFTER the start
 *  point. */
CsShapeLine.sampleBulgeSeg = function(a, b, bulge, step, out) {
    if (Math.abs(bulge) < 1e-12) {
        CsShapeLine.sampleLineSeg(a, b, step, out);
        return;
    }
    var theta = 4 * Math.atan(bulge);           // signed CCW sweep
    var chord = CsShapeLine.dist(a, b);
    if (chord < 1e-12) {
        return;
    }
    var r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
    var h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
    // left normal of travel
    var lx = -uy, ly = ux;
    // positive bulge: center LEFT of the chord (arc bows right); the
    // major arc (|theta| > PI) puts it on the other side
    var s = (Math.abs(theta) > Math.PI) ? -1 : 1;
    var sgn = (bulge > 0) ? 1 : -1;
    var cx = mx + lx * h * s * sgn, cy = my + ly * h * s * sgn;
    var a1 = Math.atan2(a.y - cy, a.x - cx);
    var arcLen = Math.abs(theta) * r;
    var n = Math.max(2, Math.ceil(arcLen / step));
    for (var i = 1; i <= n; i++) {
        var ang = a1 + theta * i / n;
        out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
    }
};

/**
 * Any supported entity -> {points, closed}, or null for a type the
 * tool does not understand. Line, arc and circle are closed-form;
 * polylines walk their vertices+bulges (getPointsWithDistanceToEnd on
 * a polyline returns points from BOTH ends -- probed -- so it is
 * useless for a directed walk); splines go through the engine, the
 * one type where that API behaves (probed: one point, FromStart
 * honored).
 */
CsShapeLine.sampleEntity = function(entity, step) {
    if (isNull(entity)) {
        return null;
    }
    var type;
    try {
        type = entity.getType();
    } catch (e) {
        return null;
    }
    var out = [];
    var data;

    if (type === RS.EntityLine) {
        data = entity.getData();
        var s = data.getStartPoint(), e2 = data.getEndPoint();
        out.push({ x: s.x, y: s.y });
        CsShapeLine.sampleLineSeg({ x: s.x, y: s.y }, { x: e2.x, y: e2.y },
            step, out);
        return { points: out, closed: false };
    }

    if (type === RS.EntityArc) {
        data = entity.getData();
        var c = data.getCenter(), r = data.getRadius();
        var a1 = data.getStartAngle(), a2 = data.getEndAngle();
        var rev = data.isReversed();
        var sweep = rev ? a1 - a2 : a2 - a1;
        // normalise into (0, 2*PI]
        while (sweep <= 0) { sweep += 2 * Math.PI; }
        while (sweep > 2 * Math.PI) { sweep -= 2 * Math.PI; }
        var dir = rev ? -1 : 1;
        var n = Math.max(2, Math.ceil((sweep * r) / step));
        for (var i = 0; i <= n; i++) {
            var ang = a1 + dir * sweep * i / n;
            out.push({ x: c.x + r * Math.cos(ang),
                       y: c.y + r * Math.sin(ang) });
        }
        return { points: out, closed: false };
    }

    if (type === RS.EntityCircle) {
        data = entity.getData();
        var cc = data.getCenter(), cr = data.getRadius();
        var cn = Math.max(8, Math.ceil((2 * Math.PI * cr) / step));
        for (var k = 0; k < cn; k++) {
            var ca = 2 * Math.PI * k / cn;
            out.push({ x: cc.x + cr * Math.cos(ca),
                       y: cc.y + cr * Math.sin(ca) });
        }
        return { points: out, closed: true };
    }

    if (type === RS.EntityPolyline) {
        data = entity.getData();
        var count = data.countVertices();
        if (count < 2) {
            return null;
        }
        var closed = false;
        try { closed = data.isClosed(); } catch (eC) {}
        var v0 = data.getVertexAt(0);
        out.push({ x: v0.x, y: v0.y });
        var segs = closed ? count : count - 1;
        for (var si = 0; si < segs; si++) {
            var pa = data.getVertexAt(si);
            var pb = data.getVertexAt((si + 1) % count);
            var bu = 0;
            try { bu = data.getBulgeAt(si); } catch (eB) { bu = 0; }
            CsShapeLine.sampleBulgeSeg({ x: pa.x, y: pa.y },
                { x: pb.x, y: pb.y }, bu, step, out);
        }
        if (closed) {
            out.pop();   // the walk re-emits the first point; drop it
        }
        return { points: out, closed: closed };
    }

    if (type === RS.EntitySpline) {
        // NOT getShapes(): on a spline that has never been added to a
        // document the shape it returns reports getLength() as NaN --
        // and update() does not cure it (probed 2026-08-28). The draw
        // tool samples its spine BEFORE adding it, so that path must
        // work. getData().castToShape() returns a live RSpline with a
        // real length in both the un-added and the queried case.
        var sh = null;
        try { sh = entity.getData().castToShape(); } catch (eS) { sh = null; }
        if (isNull(sh)) {
            try {
                var shapes = entity.getShapes();
                sh = (shapes.length > 0) ? shapes[0] : null;
            } catch (eS2) { sh = null; }
        }
        if (isNull(sh)) {
            return null;
        }
        // The FIRST getLength() on a freshly cast, never-added spline
        // answers NaN and the SECOND answers the real length (lazy
        // internal update; probed 2026-08-28, twice, because it is that
        // hard to believe). Ask again before giving up.
        var L = sh.getLength();
        if (!(L > 0)) {
            L = sh.getLength();
        }
        if (!(L > 0)) {
            return null;
        }
        var sn = Math.max(2, Math.ceil(L / step));
        for (var d = 0; d <= sn; d++) {
            var pts = sh.getPointsWithDistanceToEnd(L * d / sn, RS.FromStart);
            if (pts.length > 0) {
                out.push({ x: pts[0].x, y: pts[0].y });
            }
        }
        if (out.length < 2) {
            return null;
        }
        var spClosed = false;
        try { spClosed = sh.isClosed(); } catch (eSc) {}
        return { points: out, closed: spClosed };
    }

    return null;
};

/** True for a type sampleEntity understands -- what Decorate
 *  Selection filters on. */
CsShapeLine.isSupported = function(entity) {
    var t;
    try { t = entity.getType(); } catch (e) { return false; }
    return t === RS.EntityLine || t === RS.EntityArc ||
        t === RS.EntityCircle || t === RS.EntityPolyline ||
        t === RS.EntitySpline;
};

/** Drawing units per foot for this document. */
CsShapeLine.perFoot = function(doc) {
    var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    return CsTrace.spacingFor(unit);
};

/** Every spine in the drawing: [{entity, id}]. Full scan -- manual
 *  sync and startup only, never the listener's gate. */
CsShapeLine.spines = function(doc) {
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid !== "" && CsTags.get(e, CsShapeLine.KEY.STYLE) !== "") {
            out.push({ entity: e, id: sid });
        }
    }
    return out;
};

/** The spine tagged with this id, or null. */
CsShapeLine.spineOf = function(doc, id) {
    var want = String(id);
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.ID) === want) {
            return e;
        }
    }
    return null;
};

/** Every decoration entity carrying DECOR=<id>, in ENTITY-ID order.
 *
 * queryAllEntities walks the document's spatial index (RSpatialIndexNavel),
 * not creation order -- measured 2026-09-12 building Wall Glyphs: a
 * five-glyph regeneration came back in a different scramble before and
 * after the spine moved, even though decorate() always builds and adds
 * entities.lines[]/glyphs[] in the same left-to-right station order.
 * Ticks and scallops never noticed because nothing compared decor[0]'s
 * OWN coordinates across a regeneration -- only counts and layers.
 * Glyphs' seed-reproducibility contract does exactly that ("moving the
 * spine regenerates them" must land the SAME station's glyph in the
 * same relative spot), so this needs a stable order. Entity ids are
 * assigned sequentially as buildDecor's entities are added -- sorting
 * by id recovers the creation order the spatial index scrambled.
 */
CsShapeLine.decorOf = function(doc, id) {
    var want = String(id);
    var out = [];
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        if (CsTags.get(e, CsShapeLine.KEY.DECOR) === want) {
            out.push(e);
        }
    }
    out.sort(function(a, b) { return a.getId() - b.getId(); });
    return out;
};

/** The distinct ShapeIds the current selection names -- a caver clicks
 *  the ticks as often as the spine under them, so decor resolves to
 *  its spine's id too. Shared by Flip and Sync so "what does this
 *  selection name" has one definition, not two. */
CsShapeLine.selectionIds = function(doc) {
    var seen = {};
    var out = [];
    var ids = doc.querySelectedEntities();
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var sid = CsTags.get(e, CsShapeLine.KEY.ID);
        if (sid === "") {
            sid = CsTags.get(e, CsShapeLine.KEY.DECOR);
        }
        if (sid !== "" && !seen[sid]) {
            seen[sid] = true;
            out.push(sid);
        }
    }
    return out;
};

/** Side/scale read off a spine, with defaults. */
CsShapeLine.sideOf = function(spine) {
    var v = parseInt(CsTags.get(spine, CsShapeLine.KEY.SIDE), 10);
    return (v === -1) ? -1 : 1;
};

CsShapeLine.scaleOf = function(spine) {
    var v = parseFloat(CsTags.get(spine, CsShapeLine.KEY.SCALE));
    return (!isNaN(v) && v > 0) ? v : 1;
};

/**
 * Build the decoration ENTITIES for a spine's current geometry --
 * shared by the first draw (before the spine is even added) and every
 * regeneration. Returns {entities, sig, count, seed} or null when the
 * spine cannot be decorated (unknown style, degenerate geometry).
 *
 * `di` is optional and used only by the "glyphs" kind, to import a
 * missing symbol block on demand (CsSymbolStore.ensureBlock, the same
 * path the Symbol Palette and Area Fill already use). Every existing
 * caller omits it and gets the old behaviour for the five kinds that
 * never touch a block; a caller building glyphs with no `di` (a
 * preview, or CsCheck's read-only proofreading pass) simply gets no
 * glyph entities for a block this drawing does not already have,
 * rather than an exception.
 */
CsShapeLine.buildDecor = function(doc, spine, sample, di, cache) {
    var styleKey = CsTags.get(spine, CsShapeLine.KEY.STYLE);
    var spec = CsShapeLine.STYLES[styleKey];
    if (isNull(spec)) {
        return null;
    }
    var side = CsShapeLine.sideOf(spine);
    var scale = CsShapeLine.scaleOf(spine);
    var perFoot = CsShapeLine.perFoot(doc);
    var spacing = spec.spacingFeet * perFoot * scale;
    var size = (spec.sizeFeet || 0) * perFoot * scale;

    // THE SAMPLE MAY BE HANDED IN. Walking the spine is most of what
    // this function costs -- 20 ms on a 400 ft ledge, against 2 ms for
    // everything else -- and the live side pick rebuilds the ornament
    // on the same spine over and over as the cursor moves. A caller
    // that already knows the spine has not changed passes the sample it
    // took the first time. Nothing else about the answer changes: the
    // ornament still comes out of the same maths on the same points.
    if (isNull(sample)) {
        sample = CsShapeLine.sampleEntity(spine,
            CsShapeLine.sampleStep(spacing));
    }
    if (isNull(sample) || sample.points.length < 2) {
        return null;
    }

    // The seed is READ here, never rolled-and-forgotten, and only for
    // the one kind that spends it: a spine with no ShapeSeed tag yet
    // (its first decoration) gets a fresh one, but buildDecor never
    // WRITES it back -- that is decorate()'s and every other caller's
    // job, the same split CsArea's SEED_KEY draws between "roll if
    // missing" and "persist" (see AreaSync.js). A build() that both
    // minted and forgot the seed would look identical to one that
    // persisted it right up until the NEXT regeneration reshuffled
    // everything.
    var seed = null;
    var extra;
    if (spec.kind === "glyphs") {
        var seedTag = parseFloat(CsTags.get(spine, CsShapeLine.KEY.SEED));
        seed = (!isNaN(seedTag) && seedTag > 0) ? seedTag : CsArea.newSeed();
        extra = {
            offset: (spec.offsetFeet || 0) * perFoot * scale,
            jitterPos: (spec.jitterPosFeet || 0) * perFoot * scale,
            jitterRotRad: (spec.jitterRotDeg || 0) * Math.PI / 180,
            jitterScaleFrac: spec.jitterScaleFrac || 0,
            rand: CsArea.rng(seed)
        };
        // AUTOMATIC EDGING decides the side per station against the
        // survey instead of taking the spine's one ShapeSide tag. A
        // hand-dressed wall keeps its tag and this whole branch is
        // skipped, so Decorate Selection and ShapedFlip behave exactly
        // as they did.
        var spineFrame = CsShapeLine.frameOfSpine(spine);
        if (CsShapeLine.isAuto(spine) && spineFrame !== "section") {
            extra.sides = CsShapeLine.autoSides(sample.points,
                sample.closed, spacing,
                CsShapeLine.stationsForFrame(doc, cache, spineFrame),
                extra.offset > 0 ? extra.offset : spacing);
        }
    }

    var prims = CsShapeLine.prims(sample.points, sample.closed, spec,
        side, spacing, size, extra);
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    var decorLayer = CsShapeLine.layersFor(spec,
        CsShapeLine.frameOfSpine(spine)).decor;
    var layerId = doc.getLayerId(decorLayer);

    var entities = [];
    var i;
    for (i = 0; i < prims.lines.length; i++) {
        var seg = prims.lines[i];
        var le = new RLineEntity(doc, new RLineData(
            new RVector(seg[0].x, seg[0].y),
            new RVector(seg[1].x, seg[1].y)));
        le.setLayerId(layerId);
        CsTags.set(le, CsShapeLine.KEY.DECOR, sid);
        entities.push(le);
    }
    for (i = 0; i < prims.polylines.length; i++) {
        var pd = prims.polylines[i];
        var pl = new RPolyline();
        for (var v = 0; v < pd.points.length; v++) {
            pl.appendVertex(new RVector(pd.points[v].x, pd.points[v].y),
                pd.bulges[v] || 0.0);
        }
        if (pd.closed) {
            pl.setClosed(true);
        }
        var pe = new RPolylineEntity(doc, new RPolylineData(pl));
        pe.setLayerId(layerId);
        CsTags.set(pe, CsShapeLine.KEY.DECOR, sid);
        entities.push(pe);
    }
    if (prims.glyphs.length > 0) {
        // Which catalog block: the spine's own choice, or the style's
        // default (SYM_BREAKDOWN, the UIS "Stone blocks" symbol) --
        // never a literal, so a caver's custom-library symbol works the
        // same way a shipped one does.
        var symKey = CsTags.get(spine, CsShapeLine.KEY.SYMBOL);
        if (symKey === "") {
            symKey = spec.symbolDefault;
        }
        var symEntry = CsSymbols.byBlock(symKey);
        if (isNull(symEntry) && symKey !== spec.symbolDefault) {
            symEntry = CsSymbols.byBlock(spec.symbolDefault);
        }
        if (!isNull(symEntry)) {
            // A DRAWING MISSING THE BLOCK GETS IT IMPORTED, not refused
            // -- the same CsSymbolStore.ensureBlock path the Symbol
            // Palette and Area Fill's custom patterns already use. Only
            // attempted when a `di` was handed in: a preview or a
            // read-only proofreading pass (CsCheck) must not mutate the
            // document just to draw or count what it is looking at.
            if (isNull(doc.queryBlock(symEntry.block)) && !isNull(di)) {
                CsSymbolStore.ensureBlock(doc, di, symEntry.block);
            }
            // The absolute scale a placement gets: the block's own
            // native-size baseline (spec.sizeScale, see the STYLES
            // comment on why this is a multiplier and not sizeFeet),
            // times the feature's own "Size scale" dialog field (the
            // same `scale` every other kind's spacing/size already
            // honours), times this ONE glyph's seeded jitter.
            var baseScale = (spec.sizeScale || 1) * scale;
            for (i = 0; i < prims.glyphs.length; i++) {
                var g = prims.glyphs[i];
                var ref = CsSymbols.insert(doc, symEntry,
                    new RVector(g.x, g.y), baseScale * g.scaleMul, g.angle,
                    decorLayer, di);
                if (!isNull(ref)) {
                    CsTags.set(ref, CsShapeLine.KEY.DECOR, sid);
                    entities.push(ref);
                }
            }
        }
    }

    return {
        entities: entities,
        sig: CsShapeLine.signature(sample.points, sample.closed),
        count: entities.length,
        decorLayer: decorLayer,
        seed: seed
    };
};

/**
 * Regenerate one shaped line in place: delete its decor, rebuild from
 * the spine's CURRENT geometry, restamp ShapeSig. `group` joins every
 * write to the caller's transaction group (the listener passes the
 * triggering edit's, so one Ctrl+Z takes both).
 *
 * NOTHING TO DO IS NOT A WRITE (the CalloutWrite freeze lesson): when
 * the signature matches the stamp and the decor count is right, this
 * returns without a single operation.
 *
 * Returns "unchanged" | "decorated" | "failed".
 */
CsShapeLine.decorate = function(doc, di, spine, group, cache) {
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    if (sid === "") {
        return "failed";
    }
    var built = CsShapeLine.buildDecor(doc, spine, null, di, cache);
    if (isNull(built)) {
        return "failed";
    }

    var existing = CsShapeLine.decorOf(doc, sid);
    if (built.sig === CsTags.get(spine, CsShapeLine.KEY.SIG) &&
            existing.length === built.count) {
        return "unchanged";
    }

    CsLayers.ensure(doc, di, built.decorLayer);
    var grouped = function(op) {
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    };

    CsLayers.withLayerOn(doc, di, built.decorLayer, function() {
        if (existing.length > 0) {
            var del = new RDeleteObjectsOperation();
            for (var d = 0; d < existing.length; d++) {
                del.deleteObject(existing[d]);
            }
            grouped(del);
        }
        var add = new RAddObjectsOperation();
        for (var a = 0; a < built.entities.length; a++) {
            add.addObject(built.entities[a], false);
        }
        grouped(add);
    });

    // restamp the signature on the spine, same group -- and, for a
    // "glyphs" spine (built.seed is null for every other kind), the
    // seed buildDecor minted or read. This only runs on an actual
    // regeneration (the "unchanged" branch above already returned), so
    // a spine's FIRST decoration persists the seed it was built with
    // and every later one persists that same value right back --
    // buildDecor reads whatever is already on the tag before minting a
    // fresh one, so this never rerolls a spine that already has one.
    CsTags.set(spine, CsShapeLine.KEY.SIG, built.sig);
    if (built.seed !== null && built.seed !== undefined) {
        CsTags.set(spine, CsShapeLine.KEY.SEED, String(built.seed));
    }
    var mod = new RModifyObjectsOperation();
    mod.addObject(spine, false);
    grouped(mod);

    return "decorated";
};

/**
 * Bring one shaped line back to a consistent state -- the listener's
 * verb, CalloutListener.reconcile's shape. The deletion cases are
 * asymmetric ON PURPOSE, mirroring callouts:
 *
 *   spine gone      -> decor is orphaned. Delete it; ticks around
 *                      nothing are not information.
 *   ALL decor gone  -> the SPINE SURVIVES as an ordinary curve, its
 *                      Shape* tags stripped. The caver deleted the
 *                      ornament, not their line -- forgetting the
 *                      feature is the respectful reading.
 *   anything else   -> regenerate (decorate() self-guards against
 *                      no-op writes).
 */
/**
 * Strips the decoration and the shaped-line tags from a spine, leaving
 * the line itself exactly as it was.
 *
 * THE SEED SURVIVES. Everything else goes, but ShapeSeed stays on the
 * line, so switching wall edging off and on again reproduces the same
 * jitter rather than reshuffling every glyph on a wall the caver has
 * been looking at. That rule is the whole reason the seed is persisted
 * in the first place; a toggle is not a reason to break it.
 *
 * \return true when something was removed.
 */
CsShapeLine.undress = function(doc, di, spine, group) {
    var sid = CsTags.get(spine, CsShapeLine.KEY.ID);
    if (sid === "") {
        return false;
    }
    var grouped = function(op) {
        if (group !== null && group !== undefined && group >= 0) {
            op.setTransactionGroup(group);
        }
        di.applyOperation(op);
    };
    var existing = CsShapeLine.decorOf(doc, sid);
    if (existing.length > 0) {
        var del = new RDeleteObjectsOperation();
        for (var d = 0; d < existing.length; d++) {
            del.deleteObject(existing[d]);
        }
        grouped(del);
    }
    var fresh = doc.queryEntity(spine.getId());
    if (isNull(fresh)) {
        return existing.length > 0;
    }
    var mod = new RModifyObjectsOperation();
    CsTags.remove(fresh, CsShapeLine.KEY.STYLE);
    CsTags.remove(fresh, CsShapeLine.KEY.ID);
    CsTags.remove(fresh, CsShapeLine.KEY.SIG);
    CsTags.remove(fresh, CsShapeLine.KEY.AUTO);
    CsTags.remove(fresh, CsShapeLine.KEY.SYMBOL);
    mod.addObject(fresh, false);
    grouped(mod);
    return true;
};

CsShapeLine.reconcile = function(doc, di, id, group, cache) {
    var spine = CsShapeLine.spineOf(doc, id);
    var decor = CsShapeLine.decorOf(doc, id);

    if (isNull(spine)) {
        if (decor.length === 0) {
            return "nothing";
        }
        var del = new RDeleteObjectsOperation();
        for (var i = 0; i < decor.length; i++) {
            del.deleteObject(decor[i]);
        }
        if (group !== null && group !== undefined && group >= 0) {
            del.setTransactionGroup(group);
        }
        di.applyOperation(del);
        return "orphans-removed";
    }

    if (decor.length === 0 &&
            CsTags.get(spine, CsShapeLine.KEY.SIG) !== "") {
        CsTags.remove(spine, CsShapeLine.KEY.STYLE);
        CsTags.remove(spine, CsShapeLine.KEY.ID);
        CsTags.remove(spine, CsShapeLine.KEY.SIDE);
        CsTags.remove(spine, CsShapeLine.KEY.SCALE);
        CsTags.remove(spine, CsShapeLine.KEY.SIG);
        var mod = new RModifyObjectsOperation();
        mod.addObject(spine, false);
        if (group !== null && group !== undefined && group >= 0) {
            mod.setTransactionGroup(group);
        }
        di.applyOperation(mod);
        return "unlinked";
    }

    var r = CsShapeLine.decorate(doc, di, spine, group, cache);
    return (r === "unchanged") ? "unchanged" : "reflowed";
};

}

// ---------------------------------------------------------------------
// Dressing an existing entity.
// ---------------------------------------------------------------------

/**
 * Dress one existing entity as a shaped line: tag it as a spine and
 * decorate. The entity STAYS on its own layer -- relocating a caver's
 * geometry is not this tool's call; only the decoration lands on the
 * style's decor layer. Closed geometry with a ticks style aims the
 * ornament inward, the pit rule.
 */
CsShapeLine.dress = function(doc, di, entity, opts, group) {
    var spec = CsShapeLine.STYLES[opts.styleKey];
    if (isNull(spec)) {
        return false;
    }

    var side = opts.side;
    var perFoot = CsShapeLine.perFoot(doc);
    var probe = CsShapeLine.sampleEntity(entity,
        CsShapeLine.sampleStep(spec.spacingFeet * perFoot * opts.scale));
    if (isNull(probe) || probe.points.length < 2) {
        return false;
    }
    if (probe.closed && spec.kind !== "scallops") {
        side = CsShapeLine.inwardSide(probe.points) * (opts.side === -1 ? -1 : 1);
    }

    // Which FRAME the entity's geometry sits in decides which layer
    // family the decoration joins -- the caver's entity itself stays
    // where it is, so its layer name proves nothing (a profile sketch
    // on layer "0" is ordinary). Location is the evidence: an open
    // section bay first, then the band boxes, then the derived region
    // as the fallback (opts.region and opts.bays are the caller's
    // cached CsTrace.profileRegion and CsTrace.sectionBays).
    var mid = probe.points[Math.floor(probe.points.length / 2)];
    var frame = CsProfileBox.frameAt(doc, opts.region || null, mid,
        opts.bays || []);

    CsTags.set(entity, CsShapeLine.KEY.ID, CsUuid.v4());
    CsTags.set(entity, CsShapeLine.KEY.STYLE, opts.styleKey);
    CsTags.set(entity, CsShapeLine.KEY.SIDE, String(side));
    CsTags.set(entity, CsShapeLine.KEY.SCALE, String(opts.scale));
    CsTags.set(entity, CsShapeLine.KEY.FRAME, frame);
    // "glyphs" only reads this tag (buildDecor falls back to the
    // style's symbolDefault for every other kind, or when it is
    // empty), so setting it unconditionally for the other five kinds
    // costs nothing and keeps this one write site simple.
    if (!isNull(opts.symbol) && opts.symbol !== "") {
        CsTags.set(entity, CsShapeLine.KEY.SYMBOL, opts.symbol);
    }
    var mod = new RModifyObjectsOperation();
    mod.addObject(entity, false);
    if (group >= 0) {
        mod.setTransactionGroup(group);
    }
    di.applyOperation(mod);

    return CsShapeLine.decorate(doc, di, entity, group) === "decorated";
};
