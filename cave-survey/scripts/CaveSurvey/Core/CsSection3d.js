// CsSection3d.js -- a captured cross section, standing in the 3D view.
//
// Part of the Cave Survey Core library. The half above the QCAD banner
// is PURE -- plain {x, y, z}, no RVector, no document -- and is the half
// worth testing. The half below reads block references out of a
// document and is QCAD-only, the same split CsBind and CsScanTrim use.
//
// WHAT A SECTION ALREADY KNOWS ABOUT ITSELF. Its block reference carries
// the station it belongs to, the scale it was drawn at, and (for a
// sketched one) the scan it was traced from. And the block is
// BLOCK-LOCAL about the ghost's centre, which is where the centreline of
// the passage was -- so block-local (0,0) IS the station, and nothing
// has to be registered. See SectionCapture.js's own header.
//
// THE FRAME IS NOT DERIVED HERE. CsSectionCut.frameForLeg already
// answers "which way is up and right at this station", and it carries
// theta from leg to leg so sections do not spin as you walk the passage.
// Deriving a second frame here would be a second answer to a settled
// question, and the first place the two would disagree is a PITCH --
// which is exactly where a spinning section is most obvious and least
// forgivable.
//
// WHY OFFSET AND NOT IN PLACE. A section drawn through the passage hides
// the passage. In 2D it is a callout parked to one side with a leader
// home, and which side is a decision the caver already made by dragging
// it; this reads that decision back rather than making a new one.

include(includeBasePath + "/CsSectionCut.js");

var CsSection3d = {};

// WHICH AXIS IS WHICH, because the names do not say it and getting it
// wrong rotates every section by ninety degrees.
//
// CsSectionCut.seedFrame projects world UP onto the plane perpendicular
// to the passage and calls the result `r`. So:
//
//     frame.r  is UP in the section's own plane
//     frame.s  is ACROSS the passage, horizontal
//
// A section drawing is the other way round -- its x runs across the
// passage and its y runs up the page -- so block x maps to s and block
// y maps to r. Read `r` as "right" and every section comes out on its
// side, and every offset pushes it into the ceiling instead of out to
// one side. Both were done here once.

/** Beyond this many passage widths from its station, a block's
 *  direction says nothing about which side the caver meant -- it is
 *  parked in a bay, or laid out on a sheet. */
CsSection3d.FAR_FACTOR = 12;

/** How far clear of the passage wall a section stands, as a fraction of
 *  the passage width at that station. */
CsSection3d.CLEARANCE = 0.6;

/**
 * Which side of the passage a section hangs on, as a unit vector.
 *
 * The caver already chose: SectionCapture marches the block to a spot
 * near its station and the caver may then have dragged it, so the plan
 * vector from station to block carries the answer. Only its SIGN along
 * the frame's ACROSS axis is used -- a section stands square to the
 * passage whichever way the block drifted.
 *
 * ALONG s, NOT r. `s` is the horizontal across-passage axis; `r` is up.
 * Offsetting along r pushes the section through the ceiling, which is
 * not a side.
 *
 * \param width the passage width at that station, for the far test
 * \return {x,y,z} unit vector, +s or -s
 */
CsSection3d.sideFor = function(blockPos, stationPos, frame, width) {
    var across = frame.s;
    var dx = blockPos.x - stationPos.x;
    var dy = blockPos.y - stationPos.y;
    var far = Math.max(width, 1) * CsSection3d.FAR_FACTOR;
    if (Math.sqrt(dx * dx + dy * dy) > far) {
        return { x: across.x, y: across.y, z: across.z };
    }
    var along = dx * across.x + dy * across.y;
    if (along < 0) {
        return { x: -across.x, y: -across.y, z: -across.z };
    }
    return { x: across.x, y: across.y, z: across.z };
};

/**
 * Block-local polylines placed into the world.
 *
 * \param polylines [[{x,y}, ...], ...] block-local, origin at the
 *                  passage centreline
 * \param opts      {station, frame, scale, side, offset}
 *
 * SCALE IS DRAWING UNITS PER REAL UNIT, SO IT DIVIDES. A section drawn
 * at two units to the foot is HALF the size of its own numbers, not
 * twice; inverted, every section comes out microscopic or the size of
 * the cave. This is the failure this module most expects, which is why
 * it has a test with a known value rather than an eyeball.
 *
 * \return [[{x,y,z}, ...], ...], empty when there is no usable frame
 */
CsSection3d.place = function(polylines, opts) {
    var out = [];
    if (polylines === undefined || polylines === null ||
            opts === undefined || opts === null) {
        return out;
    }
    var frame = opts.frame;
    if (frame === null || frame === undefined ||
            frame.r === undefined || frame.s === undefined) {
        return out;
    }
    var scale = opts.scale;
    if (typeof scale !== "number" || !isFinite(scale) ||
            Math.abs(scale) < 1e-9) {
        scale = 1;
    }
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;

    var ox = st.x + side.x * offset;
    var oy = st.y + side.y * offset;
    var oz = st.z + side.z * offset;

    for (var i = 0; i < polylines.length; i++) {
        var line = polylines[i];
        var made = [];
        for (var j = 0; j < line.length; j++) {
            var u = line[j].x / scale;
            var v = line[j].y / scale;
            if (!isFinite(u) || !isFinite(v)) {
                continue;
            }
            // Block x runs ACROSS the passage (frame.s) and block y
            // runs UP it (frame.r). Swapping these rotates every
            // section ninety degrees; see the axis note at the top.
            made.push({
                x: ox + frame.s.x * u + frame.r.x * v,
                y: oy + frame.s.y * u + frame.r.y * v,
                z: oz + frame.s.z * u + frame.r.z * v
            });
        }
        if (made.length >= 2) {
            out.push(made);
        }
    }
    return out;
};

/** The leader: from where the section stands, home to its station. */
CsSection3d.leaderFor = function(opts) {
    var st = opts.station;
    var side = opts.side;
    var offset = (typeof opts.offset === "number" && isFinite(opts.offset))
        ? opts.offset : 0;
    return [
        { x: st.x + side.x * offset,
          y: st.y + side.y * offset,
          z: st.z + side.z * offset },
        { x: st.x, y: st.y, z: st.z }
    ];
};

// =====================================================================
// QCAD context below this line. Everything above runs under node.
//
// CsTags and CsCallout are NOT included here, deliberately. CsAll loads
// them AFTER this file, and pulling them earlier would reorder their own
// dependencies. Nothing below touches them at file scope -- only inside
// functions, by which time CsAll has loaded everything.
// =====================================================================

/**
 * Every captured section in a drawing.
 *
 * THE BLOCK REFERENCE'S 2D ROTATION IS IGNORED ON PURPOSE. It is a
 * sheet-layout choice -- which way the section was turned to sit beside
 * the plan -- and says nothing about the passage. In three dimensions
 * the section is squared to the passage by its frame, so honouring a
 * sheet rotation would tilt it off the passage for the sake of a
 * decision about paper.
 *
 * NEVER THROWS. A block this bridge cannot read yields no section, the
 * same discipline as CsBind.pointsOf: one unreadable block must not take
 * the whole 3D view down with it.
 *
 * \return [{station, scale, blockPos: {x, y}, polylines}]
 */
CsSection3d.readAll = function(doc, wallsOnly) {
    var out = [];
    if (isNull(doc)) {
        return out;
    }
    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (e) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        try {
            var ref = doc.queryEntity(ids[i]);
            if (isNull(ref)) { continue; }
            if (CsTags.get(ref, CsCallout.KEY.KIND) !==
                    CsCallout.KIND_SECTION) {
                continue;
            }
            if (CsTags.get(ref, CsCallout.KEY.ROLE) !==
                    CsCallout.ROLE_BLOCK) {
                continue;
            }
            var station = CsTags.get(ref, CsCallout.KEY.SECTION_STATION);
            if (typeof station !== "string" || station === "") {
                // A section that does not say which station it belongs
                // to cannot be placed, and guessing the nearest one
                // would stand somebody's drawing somewhere they did not
                // draw it.
                continue;
            }
            var scale = parseFloat(
                CsTags.get(ref, CsCallout.KEY.SECTION_SCALE));
            if (!isFinite(scale) || Math.abs(scale) < 1e-9) {
                scale = 1;
            }
            var pos = ref.getPosition();
            if (isNull(pos)) { continue; }
            var polylines = CsSection3d.blockGeometry(doc, ref,
                wallsOnly === true);
            if (polylines.length === 0) { continue; }
            out.push({ station: station, scale: scale,
                       blockPos: { x: pos.x, y: pos.y },
                       polylines: polylines });
        } catch (eRead) {
            continue;
        }
    }
    return out;
};

/**
 * Every station that has a traced section, as the tube wants it:
 * {stationName: {scale, polylines}} with the WALL outline only.
 *
 * A station with two sections drawn on it keeps the LAST one read --
 * the same "last reading wins" the rest of the suite uses, and a
 * choice nobody has asked to make differently yet.
 */
CsSection3d.wallRingsByStation = function(doc) {
    var out = {};
    var all = CsSection3d.readAll(doc, true);
    for (var i = 0; i < all.length; i++) {
        out[all[i].station] = { scale: all[i].scale,
                                polylines: all[i].polylines };
    }
    return out;
};

/**
 * A block reference's own geometry, block-local, as polylines.
 *
 * THROUGH CsArea.vertsOf, WHICH IS NOT AN ARBITRARY CHOICE. That
 * function already encodes the spline proxy trap: getPointCloud() on an
 * RSpline delegates to a proxy plugin that a `-no-gui -autostart` run
 * never loads, so it measures EMPTY headlessly while returning real
 * points inside the GUI. A flattener written fresh here would give
 * sections that looked right live and vanished from the test suite --
 * which is the one failure a test run cannot tell you about.
 */
/**
 * The layers a section's PASSAGE OUTLINE is drawn on.
 *
 * The walls trace tool and nothing else. A captured section also holds
 * floor detail, breakdown and ceiling lines -- a caver draws the rocks
 * with the same hand as the walls -- and those are drawings of things
 * INSIDE the passage. Building a tube out of them pulls its surface in
 * to wrap a boulder (Nathan, 2026-09-20: "sometimes wall is used to
 * draw rocks and things").
 *
 * INFERRED WALLS COUNT. A dashed wall is still the caver saying where
 * the passage edge runs; the dashes say how sure they are, which is a
 * question for the map and not for the shape of a tube.
 */
CsSection3d.WALL_LAYERS = [
    "SECTION-WALLS-SURVEYED",
    "SECTION-WALLS-INFERRED"
];

/** True for an entity on one of the section wall layers. */
CsSection3d.isWallEntity = function(entity) {
    if (isNull(entity)) {
        return false;
    }
    var layer = "";
    try {
        layer = String(entity.getLayerName());
    } catch (e) {
        return false;
    }
    for (var i = 0; i < CsSection3d.WALL_LAYERS.length; i++) {
        if (layer === CsSection3d.WALL_LAYERS[i]) {
            return true;
        }
    }
    return false;
};

/**
 * A section's WALL geometry only, block-local, as polylines.
 *
 * blockGeometry's sibling, and deliberately not a flag on it: what the
 * Sections overlay stands beside the passage is the caver's whole
 * drawing, floor and all, because that is what they drew. What the
 * TUBE is built from is the outline alone.
 */
CsSection3d.wallGeometry = function(doc, ref) {
    return CsSection3d.blockGeometry(doc, ref, true);
};

CsSection3d.blockGeometry = function(doc, ref, wallsOnly) {
    var out = [];
    var blockId;
    try {
        blockId = ref.getReferencedBlockId();
    } catch (e) {
        return out;
    }
    if (isNull(blockId) || blockId === RBlock.INVALID_ID) {
        return out;
    }
    var ids;
    try {
        ids = doc.queryBlockEntities(blockId);
    } catch (eq) {
        return out;
    }
    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e)) { continue; }
            if (wallsOnly === true && !CsSection3d.isWallEntity(e)) {
                continue;
            }
            var verts = CsArea.vertsOf(e);
            if (verts.length >= 2) {
                out.push(verts);
            }
        } catch (eEnt) {
            continue;
        }
    }
    return out;
};
