// CsProfileDraw.js -- putting a built extended elevation into a drawing.
//
// Part of the Cave Survey Core library. QCAD context only: every
// function here that touches a document takes the document and
// interface EXPLICITLY, because the profile lives in a sibling drawing
// that is usually not the current one -- getDocument() would draw the
// elevation on top of the plan. (CsProfileDraw.labelText and
// CsProfileDraw.labelY0 are the one exception: pure text/number
// helpers, no document involved, tested under node as well as CaveCAD.)
//
// TAG NAMESPACE. Profile geometry carries Profile* tags, a namespace of
// its own, so that plan-side scanners (CsDraw.eraseStations,
// CsRebuild, CsRevise) can never mistake an elevation for a
// plan even if the two drawings are one day merged. erase() keys on
// BOTH this namespace AND layer membership (CsProfileDraw.LAYERS()) --
// the tag alone is what THIS module writes, never a guarantee about
// what every entity in the drawing carries: a generated line promoted
// to a plain tracing layer (see erase()'s own docblock) keeps its tag
// through the move, and only the layer check is what then tells the
// two apart. That pairing is what makes regeneration replace the
// generator's own output and leave hand-drawn -- and hand-promoted --
// work alone.
//
//   ProfileRun         every entity of a band: its run key
//   ProfileStation     station point and its label
//   ProfileShot        centerline leg, "A1->A2"
//   ProfileSplay       a near-horizontal splay's flat tick
//   ProfileFloorRun    generated floor polyline
//   ProfileCeilingRun  generated ceiling polyline
//   ProfileBandLabel   the band's caption
//   ProfileChunkTie    the dashed join between two chunks, keyed to
//                      the station they share
//   ProfileChunk       on a chunk's caption: which chunk it is
//   ProfileChunkOffset ...and where on the sheet that chunk sits, so
//                      an arrangement survives a redraw
//   ProfileChunkKind   ...and whether it is a pitch or a passage
//   ProfilePitchLabel  a drop's depth, keyed to the station it hangs
//                      from -- the elevation's twin of the plan's
//                      PitchLabel
//   ProfileZOffset     on the caption: the datum shift, when displaced
//
// NO ProfileLrud TAG, DELIBERATELY. An earlier draft of this table
// carried one for a station's own U/D tick, but the acceptance
// criteria for this file are explicit that no such tick is drawn: the
// up/down measurement is already the first point of the ceiling/floor
// run it belongs to (CsProfile.bandWallRuns pushes it with `order: -1`
// so it sorts first), so a second, separate tick would just be the
// same evidence drawn twice. Keeping an unused tag name in this table
// would misdescribe what the code below actually does.

var CsProfileDraw = {};

CsProfileDraw.TAGS = ["ProfileRun", "ProfileStation", "ProfileShot",
    "ProfileSplay", "ProfileFloorRun", "ProfileCeilingRun",
    "ProfileBandLabel", "ProfileZOffset", "ProfileOrigin",
    "ProfileBox", "ProfileBoxLabel", "ProfilePitchLabel",
    "ProfileChunkTie", "ProfileChunk", "ProfileChunkOffset",
    "ProfileChunkKind"];

/** Layers the profile writes to, created if the drawing lacks them.
 *  CTRL-PROFILE-LRUD is NOT here -- see the TAGS docblock above;
 *  this module never draws a separate LRUD tick, so ensuring it would
 *  promise geometry that never lands on it. */
CsProfileDraw.LAYERS = function() {
    return [CsLayers.CTRL_PROFILE_SHOTS, CsLayers.CTRL_PROFILE_STATIONS,
        CsLayers.CTRL_PROFILE_STATION_LABELS, CsLayers.CTRL_PROFILE_SPLAYS,
        CsLayers.CTRL_PROFILE_FLOOR, CsLayers.CTRL_PROFILE_CEILING,
        CsLayers.CTRL_PROFILE_TEXT_LABELS, CsLayers.CTRL_PROFILE_BOX];
};

/**
 * The token a band's layers are segregated by, or null for none.
 *
 * ONE place decides, so run-only versus run-and-trip is a change here
 * and not a rewrite. Run only today: a run is stable structure -- the
 * elevation is literally drawn one band per run -- whereas a trip is
 * provenance, and provenance already rides on entities as
 * CsBind.TRIP_TAG. Splitting layers by trip as well would also fragment
 * a wall continued on a later trip, and CsTrace.nearestEnd only ties
 * within a layer, so the joins between those fragments could not close.
 */
CsProfileDraw.tokenFor = function(band) {
    if (isNull(band) || isNull(band.key)) {
        return null;
    }
    return band.key;
};

/**
 * The layer a band draws `base` to: the band's variant when it has a
 * token, else `base` itself. Ensures the layer exists. QCAD only.
 *
 * ensureProfile and not ensure: per-run segregation is a profile-frame
 * decision, and the restriction is enforced rather than remembered.
 */
CsProfileDraw.layerFor = function(doc, di, base, band) {
    var name = CsProfileDraw.bandLayer(base, band);
    if (name !== base) {
        CsLayerVariants.ensureProfile(doc, di, base,
            CsProfileDraw.tokenFor(band));
    }
    return name;
};

/**
 * Every survey run this drawing holds, sorted. QCAD only.
 *
 * Read from the SURVEY, not from drawn bands. A caver picks the run they
 * are working on and THEN picks a tool, so the run list has to exist
 * before any elevation has been generated -- deriving it from the band
 * layers made it empty until a profile had already been drawn, which is
 * the workflow backwards.
 *
 * Plan-frame stations are the source because that is where the survey
 * lives: the plan frame owns the horizontal truth permanently, and a
 * station is in the drawing from the moment a trip is entered.
 *
 * Unioned with tokens already present on profile variant layers, so a
 * run whose survey has since been deleted still appears while its
 * linework is still sitting there -- otherwise that work becomes
 * unreachable from the panel that made it.
 */
CsProfileDraw.runsIn = function(doc) {
    var seen = {};
    var i;

    try {
        var stations = CsBind.stationIndex(doc, "plan");
        for (i = 0; i < stations.length; i++) {
            var key = CsProfile.runKeyOf(stations[i].name);
            if (isNull(key) || String(key).length === 0) {
                continue;
            }
            var clean = CsLayerVariants.sanitize(key);
            if (clean !== null) {
                seen[clean] = true;
            }
        }
    } catch (e) {
        // no readable survey yet; the variant scan below still applies
    }

    try {
        var bases = CsProfileDraw.LAYERS();
        var ids = doc.queryAllLayers();
        for (i = 0; i < ids.length; i++) {
            var lay = doc.queryLayer(ids[i]);
            if (isNull(lay)) {
                continue;
            }
            var parts = CsLayerVariants.split(lay.getName());
            if (parts === null) {
                continue;
            }
            // Any profile-frame variant counts, traced or generated: the
            // point is that work exists for that run.
            if (CsLayers.frameOf(parts.base) === "profile") {
                seen[parts.token] = true;
            }
        }
    } catch (e2) {
        // layer table unreadable; return whatever the survey gave
    }

    var out = [];
    for (var k in seen) {
        if (seen.hasOwnProperty(k)) {
            out.push(k);
        }
    }
    out.sort(CsLayerVariants.compareTokens);
    return out;
};

/**
 * Every profile-frame VARIANT layer in the drawing, as
 * [{name, token}]. QCAD only.
 *
 * Both generated and traced: isolating a run means seeing its band AND
 * the work drawn on it, which are different layers with the same token.
 */
CsProfileDraw.profileVariantLayers = function(doc) {
    var out = [];
    var ids = doc.queryAllLayers();
    for (var i = 0; i < ids.length; i++) {
        var lay = doc.queryLayer(ids[i]);
        if (isNull(lay)) {
            continue;
        }
        var name = lay.getName();
        var parts = CsLayerVariants.split(name);
        if (parts === null) {
            continue;
        }
        if (CsLayers.frameOf(parts.base) !== "profile") {
            continue;
        }
        out.push({ name: name, token: parts.token });
    }
    return out;
};

/**
 * Switches every profile-frame variant layer on or off so only `token`
 * shows. QCAD only.
 *
 * ONE operation for every layer, so isolating a run is one undo step
 * rather than a dozen a caver has to walk back individually.
 *
 * The SHARED profile layers are deliberately left alone. They hold
 * pre-segregation geometry that belongs to no run, and hiding work
 * whose owner cannot be named would be worse than showing it.
 *
 * Note the interaction this creates with tracing: an off layer refuses
 * adds, and CsTrace.emit only works through it because it wraps the add
 * in CsLayers.withLayerOn -- which restores the layer to off afterwards.
 * So a trace aimed at a HIDDEN run lands correctly and is then invisible.
 * That is why the panel isolates the run it has selected, keeping the
 * two in step by construction.
 *
 * \return number of layers whose visibility changed
 */
CsProfileDraw.isolateRun = function(doc, di, token) {
    var wanted = CsLayerVariants.sanitize(token);
    var layers = CsProfileDraw.profileVariantLayers(doc);
    var op = new RModifyObjectsOperation();
    op.setText(wanted === null ? "Show all profile runs"
        : "Isolate profile run " + wanted);
    var changed = 0;

    for (var i = 0; i < layers.length; i++) {
        var lay = doc.queryLayer(layers[i].name);
        if (isNull(lay)) {
            continue;
        }
        var shouldBeOff = (wanted !== null && layers[i].token !== wanted);
        var isOff = false;
        try {
            isOff = lay.isOff();
        } catch (e) {
            continue;
        }
        if (isOff === shouldBeOff) {
            continue;
        }
        lay.setOff(shouldBeOff);
        op.addObject(lay, false);
        changed++;
    }

    if (changed > 0) {
        di.applyOperation(op);
    }
    return changed;
};

/** Every profile run visible again. A null token to isolateRun means
 *  exactly this, so there is one implementation and not two. */
CsProfileDraw.showAllRuns = function(doc, di) {
    return CsProfileDraw.isolateRun(doc, di, null);
};

/** layerFor without the ensure: the NAME a band's `base` layer takes.
 *  Pure, so a caller with no document interface can still ask -- and so
 *  the name a band draws to and the name a scan looks for cannot
 *  disagree. */
CsProfileDraw.bandLayer = function(base, band) {
    var token = CsProfileDraw.tokenFor(band);
    if (token === null || typeof CsLayerVariants === "undefined") {
        return base;
    }
    if (CsLayers.frameOf(base) !== "profile") {
        return base;
    }
    var name = CsLayerVariants.nameFor(base, token);
    return (name === null) ? base : name;
};

/**
 * Every layer this module owns in THIS drawing: its base set, plus every
 * variant of those bases the drawing already holds. QCAD only.
 *
 * Both the ownership test and the off-layer wrapper need this. A
 * generated band on CTRL-PROFILE-SHOTS-A is ours just as much as one on
 * CTRL-PROFILE-SHOTS, and if either scan misses it then erase() leaves
 * it behind and the next render() draws a second copy beside it.
 */
CsProfileDraw.ownLayerNames = function(doc) {
    var out = CsProfileDraw.LAYERS().slice(0);
    if (typeof CsLayerVariants === "undefined") {
        return out;
    }
    var bases = {};
    for (var b = 0; b < out.length; b++) {
        bases[out[b]] = true;
    }
    var ids = doc.queryAllLayers();
    for (var i = 0; i < ids.length; i++) {
        var lay = doc.queryLayer(ids[i]);
        if (isNull(lay)) {
            continue;
        }
        var name = lay.getName();
        var parts = CsLayerVariants.split(name);
        if (parts !== null && bases[parts.base] === true) {
            out.push(name);
        }
    }
    return out;
};

/**
 * Runs fn with EVERY layer this module writes to switched on, then
 * restores each one's own previous on/off state after -- nested via
 * CsLayers.withLayerOn, the same closure-chaining CsDraw.eraseStations
 * uses for CTRL-HIDDEN/CTRL-RAW.
 *
 * None of CsProfileDraw.LAYERS() ships off by default, unlike
 * CTRL-HIDDEN/CTRL-RAW. But this build refuses adds AND deletes on an
 * off layer with no error at all, and a user can switch any layer off
 * by hand at any time -- turning off the generated CTRL-PROFILE-CEILING
 * to see past it while tracing on the plain PROFILE-CEILING layer is
 * exactly the workflow this feature exists for. Without this wrapper,
 * that ordinary act would silently break the NEXT redraw: erase()
 * would fail to remove the old ceiling run (it survives, off-screen but
 * present) and render() would fail to add the new one (also silently
 * dropped), so the redraw would appear to do nothing at all rather than
 * doubling or erroring -- the quietest possible failure.
 *
 * The layer SET is fixed and small (CsProfileDraw.LAYERS()), so this
 * wraps all of them unconditionally rather than detecting per-entity
 * which layers are actually touched (the way CsDraw.eraseStations does
 * for its much larger, open-ended set of layers) -- CsLayers.withLayerOn
 * itself is already a no-op but for one cheap queryLayer() call when a
 * layer is not off, so wrapping a layer that never needed it costs
 * nothing worth avoiding.
 *
 * \return whatever fn returns
 */
CsProfileDraw.withOwnLayersOn = function(doc, di, fn) {
    // ownLayerNames, not LAYERS(): a variant layer the caver switched
    // off refuses deletes as silently as a base one, and erase() failing
    // on it means the next render draws a duplicate beside the survivor.
    // ONE operation each way, not one per layer: a profile render
    // toggles dozens of run-variant layers, and in the GUI every
    // applyOperation refreshes the layer list and regenerates the view
    // (measured: 87 toggles in a single render of a 24-station cave).
    return CsLayers.withLayersOn(doc, di,
        CsProfileDraw.ownLayerNames(doc), fn);
};

/**
 * Erases every entity this module drew, and only those.
 *
 * BOTH a Profile* tag AND a layer in CsProfileDraw.LAYERS() are
 * required -- a tag alone is NOT proof of ownership. The obvious
 * cartographer move is to take a generated CTRL-PROFILE-CEILING
 * polyline worth keeping and change ITS LAYER to the plain,
 * un-prefixed PROFILE-CEILING tracing layer, rather than retracing it
 * by hand. XDATA is per-entity and survives a layer change, so that
 * promoted line still carries every Profile* tag it was drawn with --
 * a tag-only scan destroyed it on the very next redraw, exactly the
 * "regeneration must not eat MY work" property this whole module
 * exists to protect, on the one piece of kept work that happens to
 * still answer to our own tags. Checking the layer too costs nothing
 * against the generator's own output (render() never draws anywhere
 * else) and is what makes the promoted line survive: the scan still
 * finds it (it IS tagged), but its layer is not one of ours, so it is
 * left alone and a fresh copy is drawn beside it instead.
 *
 * Ordinary hand-drawn linework typically carries no Profile* tag at
 * all, which is most of why a plain sketch survives -- but that is a
 * fact about how people usually draw, not something this function can
 * safely rely on by itself; the layer check is what makes the
 * ownership test hold for every case, promoted lines included.
 *
 * The delete runs inside CsProfileDraw.withOwnLayersOn: off layers
 * refuse deletes as silently as they refuse adds in this build, so
 * without that wrapper a victim on a layer the user switched off would
 * survive, and the very next render() would draw a second copy beside
 * it -- the eraseStations bug this whole feature's brief calls out by
 * name, reproduced here if this wrapper is ever dropped.
 *
 * Pass `runKey` to erase ONE run's band and leave every other run's
 * alone -- the point of segregating layers by run in the first place.
 * Omit it to clear the whole elevation, as before.
 *
 * \return number of entities removed
 */
CsProfileDraw.erase = function(doc, di, runKey) {
    // Same reason as CsDraw.eraseStations: back up the last saved file
    // before removing anything. See CsBackup.
    try {
        if (typeof CsBackup !== "undefined") {
            CsBackup.beforeWrite(doc.getFileName());
        }
    } catch (eBak) {
        // never a precondition for drawing
    }
    var ownLayers = {};
    var ownLayerNames = CsProfileDraw.ownLayerNames(doc);
    for (var ln = 0; ln < ownLayerNames.length; ln++) {
        ownLayers[ownLayerNames[ln]] = true;
    }
    var scoped = !isNull(runKey) && String(runKey).length > 0;

    var victims = [];
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var tagged = false;
        for (var t = 0; t < CsProfileDraw.TAGS.length; t++) {
            var v = CsTags.get(e, CsProfileDraw.TAGS[t]);
            if (v !== null && v !== "") {
                tagged = true;
                break;
            }
        }
        if (!tagged) {
            continue;
        }
        // Tagged is not enough on its own (see above): also require
        // the entity to still be sitting on one of OUR layers. A
        // promoted line's layer name is not in this set, so it never
        // reaches `victims` even though the tag loop just found it.
        var layerName;
        try {
            layerName = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;   // layer unreadable: not provably ours, leave it
        }
        if (ownLayers[layerName] !== true) {
            continue;
        }
        // Run-scoped erase reads the ProfileRun TAG rather than the
        // layer's variant token. The tag is on every band entity this
        // module has ever drawn, including geometry from before layers
        // were segregated -- scoping by layer name would silently skip
        // exactly that older output and leave it to double up.
        if (scoped && CsTags.get(e, "ProfileRun") !== String(runKey)) {
            continue;
        }
        victims.push(ids[i]);
    }
    if (victims.length === 0) {
        return 0;
    }
    var op = new RDeleteObjectsOperation();
    op.setText(scoped ? "Erase generated profile for " + runKey
        : "Erase generated profile");
    for (i = 0; i < victims.length; i++) {
        var ent = doc.queryEntity(victims[i]);
        if (!isNull(ent)) {
            op.deleteObject(ent);
        }
    }
    CsProfileDraw.withOwnLayersOn(doc, di, function() {
        // the box layer ships LOCKED, and locked refuses deletes as
        // silently as off does -- without this, stale boxes survive
        // every redraw and stack up
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_PROFILE_BOX,
            function() {
                di.applyOperation(op);
            });
    });
    return victims.length;
};

/**
 * The band's caption, as pure text -- no document, no RVector, so this
 * one function runs (and is unit-tested) under plain node as well as
 * CaveCAD. Everything about WHERE the caption goes lives in
 * CsProfileDraw.label() below; this is only WHAT it says.
 */
CsProfileDraw.labelText = function(band) {
    // A CHUNK names what it IS -- the drop, or the passage it starts
    // from -- because its key is bookkeeping and a reader should never
    // have to decode one. It has no run and no plane worth printing:
    // every chunk is projected on its own, and which plane a
    // twelve-foot crawl was flattened onto is not information.
    if (band.chunkKind !== undefined && band.chunkKind !== null) {
        return CsChunk.caption(band);
    }
    // A PROJECTED elevation names its PLANE, because a reader has to
    // be told which way they are looking or the drawing is a picture
    // of some cave rather than of this one. It has no run to name --
    // there is one band and it holds the whole cave.
    if (band.projection !== undefined && band.projection !== null) {
        var ptext = CsProject.caption(band.projection);
        if (band.stations.length === 0) {
            return ptext + " -- NOTHING PLACED";
        }
        return ptext;
    }
    var text = band.key + " SURVEY";
    if (band.tie !== null && band.tie !== undefined && band.tie !== "") {
        text += " (FROM " + band.tie + ")";
    }
    if (band.stations.length === 0) {
        // Nothing at all was drawn for this band: CsProfile.unrollBand
        // stopped it at its own first chain station (the only way
        // `stations` comes back empty -- see CsProfileDraw.labelY0's
        // docblock for why that also means `datum` is null, not 0).
        // Name the station and the reason instead of drawing a caption
        // that could read as if the band existed at some elevation.
        text += " -- STOPPED AT " + band.stopped +
            " (" + band.stoppedReason + ")";
        return text;
    }
    var dz = band.zOffset || 0.0;
    if (Math.abs(dz) > 1e-9) {
        // A displaced band that did not say so would misinform a
        // reader about depth -- the offset is written here precisely
        // because it is also tagged (CsProfileDraw.label), not merely
        // a decoration.
        text += " -- SHOWN " + Math.abs(dz).toFixed(1) +
            (dz < 0 ? " BELOW" : " ABOVE") + " TRUE ELEVATION";
    }
    return text;
};

/**
 * The caption's pre-offset Y -- band.zOffset is added separately by the
 * caller's own `at()`, exactly like every other coordinate a band
 * draws, so this returns the same TRUE-elevation value the band's own
 * geometry is built from, not a drawing-space one.
 *
 * band.stations[0].y when the band drew a first station: true
 * elevation -- unrollBand's own yOf, which is elevation plainly -- the
 * same height the leftmost centerline point sits at.
 *
 * 0.0, EXPLICITLY, when it did not (band.stations.length === 0). The
 * tempting shortcut -- `band.datum` -- is null in EXACTLY this case
 * (CsProfile.unrollBand: datum is null whenever the chain is empty or
 * its first member's Z never resolved, which is also the only way
 * `stations` itself comes back empty). NOT A BUG FIX, TO BE CLEAR:
 * `null + h` and `0.0 + h` are the same number in this language, so a
 * caller using `band.datum` directly would have drawn at exactly this
 * same height -- nothing was ever drawn wrong, and a mutation that
 * reverts this to `band.datum` is an EQUIVALENT mutant, not a covered
 * one. What this buys is that the code no longer DEPENDS on that
 * coercion to reach the right number by accident: reading `0.0` here
 * says plainly "no station, wall point, or leg is drawn at this height
 * for this band" rather than resting on `null`'s arithmetic behavior,
 * which is exactly the kind of implicit reliance the "never default a
 * missing Z to 0" convention exists to keep out of code that touches
 * real survey elevations -- even though, this one time, the coercion
 * and the explicit value happen to agree. CsProfileDraw.labelText's
 * caption for this same case names the real station and reason a
 * reader would otherwise have to guess at.
 */
CsProfileDraw.labelY0 = function(band) {
    if (band.stations.length > 0) {
        return band.stations[0].y;
    }
    return 0.0;
};

/**
 * The band's caption entity: its run, its tie, and -- when the band had
 * to be pushed off true elevation to clear another, or drew nothing at
 * all -- why. See CsProfileDraw.labelText for what it says.
 */
CsProfileDraw.label = function(doc, di, op, band, at) {
    var text = CsProfileDraw.labelText(band);
    var y = CsProfileDraw.labelY0(band);
    var label = CsDraw.addText(doc, op,
        CsProfileDraw.layerFor(doc, di, CsLayers.CTRL_PROFILE_TEXT_LABELS, band),
        text, at(0, y + CsDraw.TEXT_HEIGHT * 4.0), RS.HAlignLeft,
        "ProfileBandLabel", band.key);
    // CsDraw.addText already queued `label` into `op` via its own
    // op.addObject(entity, false) -- this second CsTags.set, applied to
    // the SAME entity reference before di.applyOperation(op) actually
    // commits it, is the identical pattern CsDraw.survey uses to add
    // Trip*/Survey* tags onto a station point well after that point's
    // own op.addObject call (see its anchor0/tripAnchor handling), not
    // a new or untested one.
    CsTags.set(label, "ProfileRun", band.key);
    var dz = band.zOffset || 0.0;
    if (Math.abs(dz) > 1e-9) {
        CsTags.set(label, "ProfileZOffset", String(dz));
    }
    // A CHUNK'S POSITION ON THE SHEET, written beside the thing it
    // positions. This is what makes the arrangement survive a redraw:
    // CsProfileDraw.chunkOffsets reads it back and CsChunk.bands
    // prefers it to the preset. Written for EVERY chunk, including the
    // ones still sitting where the preset put them -- an offset that
    // only appeared once a caver had dragged something would mean a
    // redraw between two drags re-flowed the pieces that had not
    // moved, around the one that had.
    if (band.chunkKind !== undefined && band.chunkKind !== null) {
        CsTags.set(label, "ProfileChunk", band.key);
        CsTags.set(label, "ProfileChunkOffset",
            String(band.chunkOffset || 0.0));
        CsTags.set(label, "ProfileChunkKind", band.chunkKind);
    }
};

/** One generated polyline (a ceiling or floor run). */
CsProfileDraw.run = function(doc, op, layerName, points, at, tagKey,
        tagValue, runKey) {
    if (points.length < 2) {
        return;   // CsProfile.bandWallRuns never emits a shorter run,
                  // but this stays defensive rather than assuming it
    }
    // vertices go into the DATA, then the data into the entity -- the
    // same order CsDraw's wall-run drawing uses (CsDraw.survey's
    // drawRuns); there is no appendVertex on the entity in this bridge.
    var data = new RPolylineData();
    for (var i = 0; i < points.length; i++) {
        data.appendVertex(at(points[i].x, points[i].y));
    }
    var pl = new RPolylineEntity(doc, data);
    pl.setLayerId(doc.getLayerId(layerName));
    CsTags.set(pl, tagKey, tagValue);
    CsTags.set(pl, "ProfileRun", runKey);
    op.addObject(pl, false);
};

/** One band, into an operation already open. */
CsProfileDraw.band = function(doc, di, op, band, counts, origin) {
    // Every layer this band draws to is resolved through layerFor, which
    // returns the band's own run variant and creates it on demand. Not
    // pre-created for every run up front: a band that draws no splays
    // should not leave an empty splay layer behind for its run.
    var lyShots = CsProfileDraw.layerFor(doc, di, CsLayers.CTRL_PROFILE_SHOTS, band);
    var lyStations = CsProfileDraw.layerFor(doc, di,
        CsLayers.CTRL_PROFILE_STATIONS, band);
    var lyLabels = CsProfileDraw.layerFor(doc, di,
        CsLayers.CTRL_PROFILE_STATION_LABELS, band);
    var lyCeiling = CsProfileDraw.layerFor(doc, di,
        CsLayers.CTRL_PROFILE_CEILING, band);
    var lyFloor = CsProfileDraw.layerFor(doc, di, CsLayers.CTRL_PROFILE_FLOOR, band);
    var lySplays = CsProfileDraw.layerFor(doc, di,
        CsLayers.CTRL_PROFILE_SPLAYS, band);
    var dz = band.zOffset || 0.0;
    // TWO offsets, and they are not the same thing. dz is the band's
    // own displacement, part of what the elevation SAYS (a spur shown
    // below true elevation so it does not overprint the trunk, and
    // labelled as such). The origin is where the whole region was
    // placed in the drawing, which says nothing about the cave at all.
    var ox = (origin === undefined || origin === null) ? 0 : origin.x;
    var oy = (origin === undefined || origin === null) ? 0 : origin.y;
    var at = function(x, y) {
        return new RVector(ox + x, oy + y + dz);
    };
    var runTag = { ProfileRun: band.key };
    var i;

    for (i = 0; i < band.legs.length; i++) {
        var leg = band.legs[i];
        CsDraw.addLine(doc, op, lyShots,
            at(leg.fromX, leg.fromY), at(leg.toX, leg.toY),
            "ProfileShot", leg.from + "->" + leg.to, runTag);
        counts.legsDrawn++;
    }

    for (i = 0; i < band.stations.length; i++) {
        var st = band.stations[i];
        var pt = CsDraw.addPoint(doc, op, lyStations,
            at(st.x, st.y));
        CsTags.set(pt, "ProfileStation", st.name);
        CsTags.set(pt, "ProfileRun", band.key);
        op.addObject(pt, false);
        counts.stationsDrawn++;

        var label = CsDraw.addText(doc, op, lyLabels,
            st.name, at(st.x, st.y + CsDraw.TEXT_HEIGHT * 1.5),
            RS.HAlignCenter, "ProfileStation", st.name);
        // Same after-the-fact tagging as CsProfileDraw.label above:
        // CsDraw.addText's own single tagKey/tagValue slot already
        // wrote ProfileStation; ProfileRun rides on afterward so the
        // label entity carries BOTH -- every entity this module draws
        // must carry ProfileRun (the acceptance criterion this fixes:
        // an earlier draft left the station label as the one entity
        // missing it).
        CsTags.set(label, "ProfileRun", band.key);
    }

    for (i = 0; i < band.ceiling.length; i++) {
        CsProfileDraw.run(doc, op, lyCeiling,
            band.ceiling[i], at, "ProfileCeilingRun",
            band.key + "." + (i + 1), band.key);
        counts.ceilingRuns++;
    }
    for (i = 0; i < band.floor.length; i++) {
        CsProfileDraw.run(doc, op, lyFloor,
            band.floor[i], at, "ProfileFloorRun",
            band.key + "." + (i + 1), band.key);
        counts.floorRuns++;
    }

    // Flat (near-horizontal) splays get a short tick, same shape an
    // LRUD tip takes -- they are NOT part of any ceiling/floor run
    // (CsProfile.bandWallRuns routes them to band.flat, not
    // ceiling/floor, for exactly this reason), so this is their only
    // appearance in the drawing; a "ray to the wall" would double them
    // with the along-passage point that already exists nowhere else.
    for (i = 0; i < band.flat.length; i++) {
        var f = band.flat[i];
        var half = CsDraw.TEXT_HEIGHT;
        CsDraw.addLine(doc, op, lySplays,
            at(f.x, f.y - half), at(f.x, f.y + half),
            "ProfileSplay", f.name, runTag);
        counts.flatTicks++;
    }

    CsProfileDraw.pitchLabels(doc, di, op, band, at, counts);

    CsProfileDraw.label(doc, di, op, band, at);
};

/**
 * "P 187 FT" beside the drop, in the ELEVATION -- the view where a
 * pitch actually looks like a pitch.
 *
 * WHY IT IS NEEDED HERE TOO, when the plan already has one. The plan's
 * label exists because a pitch has no plan extent at all: the drawing
 * shows a dot, and the number is the only thing that says how far it
 * falls. The elevation has the opposite problem. Here the drop is the
 * most prominent thing on the page -- a bare vertical line, a hundred
 * feet of it -- and it is the one line with NO scale cue of its own:
 * no walls to either side, no bends, nothing but two station points at
 * its ends. A reader can see there is a pitch and cannot see how big
 * it is without measuring it off the frame.
 *
 * ONLY WHERE THE WHOLE PITCH IS IN THIS BAND. A drop whose top is in
 * one band and whose bottom is in another is not drawn as one line
 * anywhere, and a number beside half of it would be a claim about
 * geometry the reader cannot see. Those are left to the plan's label,
 * which is always whole because the plan never splits a cave into
 * bands.
 *
 * The label sits beside the MIDDLE of the drop rather than at its top,
 * because in this view the middle is where the empty space is, and
 * hugs the line closely -- an extended elevation's X axis is distance
 * travelled, so horizontal room beside a pitch belongs to whatever
 * passage comes next.
 */
CsProfileDraw.pitchLabels = function(doc, di, op, band, at, counts) {
    var pitches = band.pitches || [];
    if (pitches.length === 0) {
        return;
    }
    // THE GENERATOR'S OWN TEXT LAYER, not the NOTES twin.
    //
    // PROFILE-NOTES-ANNOTATION is where this belongs by meaning -- it
    // is a mark for the reader, and it would survive a caver turning
    // the control layers off to print. It is the wrong answer anyway,
    // and the rule that says so is load-bearing: everything
    // CsProfileDraw.erase owns must be CTRL-, or the generator owns a
    // layer in the traced vocabulary and CsBind starts treating
    // generated captions as the caver's own linework. The band caption
    // is the same kind of thing and lives here for the same reason.
    var layer = CsProfileDraw.layerFor(doc, di,
        CsLayers.CTRL_PROFILE_TEXT_LABELS, band);
    var byName = {};
    for (var i = 0; i < band.stations.length; i++) {
        byName[band.stations[i].name] = band.stations[i];
    }
    for (i = 0; i < pitches.length; i++) {
        var pitch = pitches[i];
        var topSt = byName[pitch.top];
        var bottomSt = byName[pitch.bottom];
        if (topSt === undefined || bottomSt === undefined) {
            continue;   // not wholly in this band -- see the docblock
        }
        var midY = (topSt.y + bottomSt.y) / 2.0;
        var midX = (topSt.x + bottomSt.x) / 2.0;
        var text = CsDraw.addText(doc, op, layer,
            CsDraw.caps(pitch.text),
            at(midX + CsDraw.TEXT_HEIGHT * 0.8, midY),
            RS.HAlignLeft, "ProfilePitchLabel", pitch.top);
        CsTags.set(text, "ProfileRun", band.key);
        if (counts !== undefined && counts !== null) {
            counts.pitchLabels = (counts.pitchLabels || 0) + 1;
        }
    }
};

/**
 * Where every station WILL be once this profile is drawn, keyed the way
 * CsProfileBind keys them: moveLinework's "after" frame.
 */
CsProfileDraw.positionsOf = function(profile, origin) {
    var out = {};
    // The region's own placement in the drawing. Omitted means (0, 0):
    // the band coordinates themselves, which is what a caller comparing
    // one BUILD against another wants. render() passes the real origin,
    // because what it compares against is what is on the paper.
    var ox = (origin === undefined || origin === null) ? 0 : origin.x;
    var oy = (origin === undefined || origin === null) ? 0 : origin.y;
    var bands = (profile && profile.bands) ? profile.bands : [];
    for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        var dz = band.zOffset || 0.0;
        for (var i = 0; i < band.stations.length; i++) {
            var st = band.stations[i];
            out[CsProfileBind.key(band.key, st.name)] =
                { x: ox + st.x, y: oy + st.y + dz };
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// THE REGION: where the elevation is placed in the plan drawing.
// ---------------------------------------------------------------------

/** Blank drawing units between the plan's southern edge and the top of
 *  the elevation. Sixty label heights at CsDraw.TEXT_HEIGHT's 0.5 --
 *  enough that the plan's own bottom labels and the elevation's top band
 *  caption cannot collide at any zoom, and that the plan has visible
 *  room beneath it rather than the elevation crowding its southern edge.
 *  Raised from 20.0 on the drawing evidence: at twenty the two views
 *  read as one crowded block.
 *
 *  In DRAWING units, so it scales with the survey's own units the way
 *  every other spacing in this suite does -- 30 feet on a survey in
 *  feet, 30 metres on one in metres. That is deliberate: a metric cave
 *  is physically larger per unit and wants proportionally more air.
 *
 *  (The previous docblock called 20.0 "twenty label heights". It was
 *  forty: TEXT_HEIGHT is 0.5, not 1.0.) */
CsProfileDraw.REGION_GUTTER = 30.0;

/**
 * The bounding box of everything in ONE frame -- "plan", "profile" or
 * "sheet" -- as {minX, minY, maxX, maxY}, or null when the drawing
 * holds no geometry in that frame at all. QCAD only.
 *
 * Frame-scoped rather than doc.getBoundingBox(): the elevation is IN
 * this drawing, so the document's own extents already include the
 * region being placed. Feeding that back in would push the region
 * further down on every single redraw -- a drawing that walks south
 * forever, one gutter at a time.
 *
 * The frame is a PARAMETER because Feature Trace needs the same union
 * for the profile frame, to decide which view a point falls in. This
 * shipped as planExtents with "plan" written into the middle of it; a
 * second copy with one string changed is how the two would come to
 * disagree about what counts as inside a frame. The frame itself is
 * still answered only by CsLayers.frameOf.
 */
CsProfileDraw.frameExtents = function(doc, frame) {
    var ids = doc.queryAllEntities(false, false);
    var out = null, i, e, box, lname;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        try {
            lname = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;
        }
        if (CsLayers.frameOf(lname) !== frame) {
            continue;
        }
        try {
            box = e.getBoundingBox();
        } catch (eBox) {
            continue;
        }
        if (isNull(box)) {
            continue;
        }
        var c1 = box.getCorner1(), c2 = box.getCorner2();
        if (out === null) {
            out = { minX: Math.min(c1.x, c2.x), minY: Math.min(c1.y, c2.y),
                maxX: Math.max(c1.x, c2.x), maxY: Math.max(c1.y, c2.y) };
        } else {
            out.minX = Math.min(out.minX, c1.x, c2.x);
            out.minY = Math.min(out.minY, c1.y, c2.y);
            out.maxX = Math.max(out.maxX, c1.x, c2.x);
            out.maxY = Math.max(out.maxY, c1.y, c2.y);
        }
    }
    return out;
};

/** frameExtents for the plan frame. Kept as its own name because every
 *  existing caller reads better for it, and because the plan frame is
 *  the one the drawing's origin belongs to. */
CsProfileDraw.planExtents = function(doc) {
    return CsProfileDraw.frameExtents(doc, "plan");
};

/**
 * The bounding box of a BUILT profile's own coordinates (band X from
 * zero, Y at true elevation, each band's zOffset included), as
 * {minX, minY, maxX, maxY}, or null for a profile with nothing in it.
 * Pure -- no document.
 *
 * Stations and legs only. Wall runs hang off the stations they belong
 * to by at most the passage's own height, which the gutter already
 * covers, and scanning them would double this function's cost on the
 * one code path that is already quadratic in the survey total.
 */
CsProfileDraw.regionBounds = function(profile) {
    var bands = (profile && profile.bands) ? profile.bands : [];
    var out = null, b, i, dz;
    var see = function(x, y) {
        if (out === null) {
            out = { minX: x, minY: y, maxX: x, maxY: y };
            return;
        }
        out.minX = Math.min(out.minX, x);
        out.minY = Math.min(out.minY, y);
        out.maxX = Math.max(out.maxX, x);
        out.maxY = Math.max(out.maxY, y);
    };
    for (b = 0; b < bands.length; b++) {
        dz = bands[b].zOffset || 0.0;
        for (i = 0; i < bands[b].stations.length; i++) {
            see(bands[b].stations[i].x, bands[b].stations[i].y + dz);
        }
        for (i = 0; i < bands[b].legs.length; i++) {
            see(bands[b].legs[i].fromX, bands[b].legs[i].fromY + dz);
            see(bands[b].legs[i].toX, bands[b].legs[i].toY + dz);
        }
    }
    return out;
};

/** The box margin around a band's content, in FEET -- converted per
 *  drawing unit at draw time so it means the same thing in a metre
 *  drawing (the suite convention). */
CsProfileDraw.BOX_MARGIN_FEET = 5.0;

/**
 * One band's content bounds, {minX, minY, maxX, maxY} or null -- the
 * band's OWN coordinates plus its zOffset, exactly what at() draws
 * minus the region origin. Pure.
 *
 * Unlike regionBounds this DOES walk the wall runs and flat ticks: a
 * bounding box that a ceiling line pokes out of is not a bounding box.
 * It also covers the two text entities the band draws -- the caption
 * (labelText at labelY0 + 4 text heights, extending right) and the
 * station name labels (1.5 text heights above each station) -- using
 * the same width estimate the rest of the suite draws by: about 0.8
 * text heights per character at CsDraw.TEXT_HEIGHT.
 */
CsProfileDraw.bandBox = function(band) {
    var dz = band.zOffset || 0.0;
    var th = CsDraw.TEXT_HEIGHT;
    var out = null;
    var see = function(x, y) {
        if (out === null) {
            out = { minX: x, minY: y, maxX: x, maxY: y };
            return;
        }
        out.minX = Math.min(out.minX, x);
        out.minY = Math.min(out.minY, y);
        out.maxX = Math.max(out.maxX, x);
        out.maxY = Math.max(out.maxY, y);
    };
    var i, k, run;
    for (i = 0; i < band.stations.length; i++) {
        see(band.stations[i].x, band.stations[i].y + dz);
        // the station's name label floats 1.5 text heights above the
        // point, half a height tall either side of its middle
        see(band.stations[i].x, band.stations[i].y + dz + th * 2.0);
    }
    for (i = 0; i < band.legs.length; i++) {
        see(band.legs[i].fromX, band.legs[i].fromY + dz);
        see(band.legs[i].toX, band.legs[i].toY + dz);
    }
    for (i = 0; i < band.ceiling.length; i++) {
        run = band.ceiling[i];
        for (k = 0; k < run.length; k++) {
            see(run[k].x, run[k].y + dz);
        }
    }
    for (i = 0; i < band.floor.length; i++) {
        run = band.floor[i];
        for (k = 0; k < run.length; k++) {
            see(run[k].x, run[k].y + dz);
        }
    }
    for (i = 0; i < band.flat.length; i++) {
        see(band.flat[i].x, band.flat[i].y + dz - th);
        see(band.flat[i].x, band.flat[i].y + dz + th);
    }
    if (out === null) {
        return null;   // the band drew nothing boxable
    }
    // the caption: HAlignLeft from x=0, VAlignMiddle at y0 + 4 heights
    var y0 = CsProfileDraw.labelY0(band) + dz;
    var caption = CsProfileDraw.labelText(band);
    see(0, y0 + th * 3.0);
    see(caption.length * th * 0.8, y0 + th * 5.0);
    return out;
};

/**
 * The bounding box drawn around every band: content bounds plus the
 * margin, SEPARATED where two margined boxes would meet. Pure; band
 * coordinates (the caller adds the region origin when drawing).
 *
 * Separation never moves a band -- a displaced band no longer reads at
 * true elevation, the one property the layout above refuses to spend
 * (see CsProfile.layout). Instead the BOXES give ground: where two
 * margined boxes overlap vertically, the shared edge is pulled back to
 * the midline of the gap between the two bands' CONTENT, less a tenth
 * of that gap each side so the boxes stay visibly apart. Two bands
 * whose content itself interleaves (possible at true elevation) keep
 * overlapping boxes -- there is no honest line between them, and
 * cutting through a band's own geometry to pretend otherwise would be
 * worse.
 *
 * Returns [{key, minX, minY, maxX, maxY}], top band first.
 */
CsProfileDraw.boxesFor = function(profile, margin) {
    var bands = (profile && profile.bands) ? profile.bands : [];
    var m = (margin === undefined || margin === null) ? 0 : margin;
    var boxes = [];
    var i;
    for (i = 0; i < bands.length; i++) {
        var content = CsProfileDraw.bandBox(bands[i]);
        if (content === null) {
            continue;
        }
        boxes.push({
            key: bands[i].key,
            content: content,
            minX: content.minX - m, minY: content.minY - m,
            maxX: content.maxX + m, maxY: content.maxY + m
        });
    }
    // top first: bands stack downward, so sorting by content top gives
    // the adjacency the separation pass below walks
    boxes.sort(function(a, b) { return b.content.maxY - a.content.maxY; });
    for (i = 0; i + 1 < boxes.length; i++) {
        var a = boxes[i], b = boxes[i + 1];   // a above b
        if (a.minY >= b.maxY) {
            continue;   // already separated
        }
        if (a.content.minY <= b.content.maxY) {
            continue;   // contents interleave: no honest line to draw
        }
        var gap = a.content.minY - b.content.maxY;
        var mid = (a.content.minY + b.content.maxY) / 2;
        a.minY = mid + gap * 0.1;
        b.maxY = mid - gap * 0.1;
    }
    // the working copies leaked content for the separation pass; strip
    // it so the return shape is exactly what a drawer needs
    var out = [];
    for (i = 0; i < boxes.length; i++) {
        out.push({ key: boxes[i].key,
            minX: boxes[i].minX, minY: boxes[i].minY,
            maxX: boxes[i].maxX, maxY: boxes[i].maxY });
    }
    return out;
};

/**
 * Where to put the region THIS time: the offset added to every band
 * coordinate so the elevation lands below the plan, left edges lined
 * up. QCAD only.
 *
 * RECOMPUTED EVERY DRAW rather than stored once and kept. A stored
 * anchor would go stale the moment the survey grew southward -- the
 * elevation would end up overlapping the plan it is supposed to sit
 * under, and no redraw would ever fix it. The cost of recomputing is
 * that the region MOVES, which is why CsProfileDraw.translateRegion
 * exists: the user's own tracing has to travel with it.
 *
 * A drawing with no plan geometry (the elevation drawn first, or drawn
 * alone) has nothing to sit below, so the region stays at the origin
 * and the band coordinates are the drawing's coordinates.
 */
CsProfileDraw.computeOrigin = function(doc, profile) {
    var bounds = CsProfileDraw.regionBounds(profile);

    // CsDraw.planDataBox, NOT planExtents: the frame union counts the
    // aerial basemap and the surface contours, which are deliberately
    // bigger than the survey -- placing against them would walk the
    // region south on every imagery re-run, the same feedback
    // frameExtents' own docblock warns about for the region itself.
    var plan = CsDraw.planDataBox(doc);
    if (plan === null || bounds === null) {
        return new RVector(0, 0);
    }
    return new RVector(plan.minX - bounds.minX,
        plan.minY - CsProfileDraw.groundWindowPad(doc, plan) -
            CsProfileDraw.REGION_GUTTER - bounds.maxY);
};

/**
 * How far the ground-window tools' fetch area (Aerial Basemap, Surface
 * Contours) overhangs the plan's SOUTH edge, in drawing units -- the
 * same window math CsGeoProject.groundExtent runs for the fetch,
 * answered from the same plan-data box, so the profile region lands
 * BELOW the imagery instead of inside its margin (Nathan, 2026-08-27:
 * profiles were getting crowded out). Computed whether or not a
 * basemap is drawn yet: the space is reserved so fetching one later
 * never lands on the region.
 *
 * 0 when the conversion cannot be made (an unknown drawing unit, an
 * engine without doc.getUnit) -- the region then sits one plain gutter
 * down, exactly as before this existed.
 */
CsProfileDraw.groundWindowPad = function(doc, plan) {
    try {
        var unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        var hU = plan.maxY - plan.minY;
        var extent = CsGeoProject.groundExtent(
            { width: plan.maxX - plan.minX, height: hU }, unit,
            CsGeoProject.MARGIN, CsGeoProject.FLOOR_M);
        var hM = CsUnits.convert(hU, unit, CsUnits.METERS);
        var padM = Math.max(0, (extent.height - hM) / 2.0);
        return CsUnits.convert(padM, CsUnits.METERS, unit);
    } catch (e) {
        return 0;
    }
};

/**
 * Where the region was put LAST time, as {x, y}, or null when this
 * drawing has no elevation in it yet. QCAD only.
 *
 * Read from a marker point the draw itself leaves behind, tagged
 * ProfileOrigin -- the drawing is the record, the same principle the
 * rest of this suite works on. The marker is generator-owned (its tag
 * is in CsProfileDraw.TAGS) so erase() clears it and the next draw
 * writes a fresh one; a user who deletes it gets a drawing that reads
 * as "no region yet", which costs one un-translated redraw and nothing
 * worse.
 */
CsProfileDraw.regionOrigin = function(doc) {
    var ids = doc.queryAllEntities(false, false);
    var i, e, v;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        v = CsTags.get(e, "ProfileOrigin");
        if (v === null || v === "") {
            continue;
        }
        var parts = String(v).split(",");
        if (parts.length !== 2) {
            continue;
        }
        var x = parseFloat(parts[0]), y = parseFloat(parts[1]);
        if (isNaN(x) || isNaN(y)) {
            // A marker that cannot be read is not a position: a
            // fabricated one would translate the whole region by a
            // wrong delta, which is worse than redrawing it in place.
            continue;
        }
        return { x: x, y: y };
    }
    return null;
};

/**
 * Where each chunk sits on the sheet, read back off the drawing.
 *
 * A CHUNKED ELEVATION IS ARRANGED, NOT JUST GENERATED. The preset puts
 * the pieces in a row; a caver then drags them where the map wants
 * them, and a redraw that ignored that would undo an afternoon's
 * layout every time the survey gained a station. Each chunk's caption
 * carries its own offset, so the arrangement lives on the drawing --
 * beside the thing it positions, and inside the file rather than in a
 * setting that belongs to the application.
 *
 * THE OFFSET IS READ FROM THE TAG, NOT FROM WHERE THE CAPTION ENDED
 * UP. The tag is what CsProfileDraw wrote; deriving the position from
 * the caption's current coordinates instead would let an accidental
 * nudge of one text entity silently redefine where a whole piece of
 * cave belongs.
 *
 * \return {chunkKey: x}; empty when the drawing holds no chunked
 *         elevation, which is what a first draw sees
 */
CsProfileDraw.chunkOffsets = function(doc) {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var key = CsTags.get(e, "ProfileChunk");
        if (key === null || key === "") {
            continue;
        }
        var v = parseFloat(CsTags.get(e, "ProfileChunkOffset"));
        if (isNaN(v)) {
            // Unreadable is not zero. A chunk whose offset cannot be
            // read is left to the preset, which puts it somewhere
            // sensible; snapping it to the origin would pile it on top
            // of the first piece of the cave.
            continue;
        }
        out[String(key)] = v;
    }
    return out;
};

/**
 * Moves EVERY entity in the profile frame by one vector. QCAD only.
 * \return the number of entities moved
 *
 * ONE VECTOR OVER A FRAME-SCOPED SELECTION -- not a per-entity
 * similarity fit. The cross-file version of this feature needed a fit
 * (CsRevise.similarityFit) because the stations themselves had moved
 * relative to each other; here nothing has changed shape at all, only
 * where the region was placed, so there is nothing to fit, no residual
 * to report and no refusal to make. Every entity moves by the same
 * delta or the region is not rigid.
 *
 * Generated geometry is moved too, even though the redraw that follows
 * replaces it at the new origin anyway: the cost is one translation of
 * geometry about to be erased, and the benefit is that this function
 * has ONE rule -- everything in the frame moves -- rather than a
 * carve-out that a later reader would have to re-derive.
 *
 * Runs inside CsRevise.withOffLayersOn: this MODIFIES user linework,
 * which may well sit on a layer the user switched off to sketch
 * undisturbed, and this build drops a modify on an off layer as
 * silently as it drops an add.
 */
CsProfileDraw.translateRegion = function(doc, di, dx, dy) {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
        return 0;   // the region did not move
    }
    var offset = new RVector(dx, dy);
    var ids = doc.queryAllEntities(false, false);
    var op = new RModifyObjectsOperation();
    op.setText("Move the elevation region");
    var moved = 0, i, e, lname;
    for (i = 0; i < ids.length; i++) {
        e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        try {
            lname = doc.getLayerName(e.getLayerId());
        } catch (eLayer) {
            continue;
        }
        if (CsLayers.frameOf(lname) !== "profile") {
            continue;
        }
        e.move(offset);
        op.addObject(e, false);
        moved++;
    }
    if (moved > 0) {
        CsRevise.withOffLayersOn(doc, di, function() {
            // the band boxes live on the LOCKED box layer and must
            // travel with the region like everything else here
            CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_PROFILE_BOX,
                function() {
                    di.applyOperation(op);
                });
        });
    }
    return moved;
};

/**
 * Draws a whole built profile into (doc, di).
 *
 * \param profile CsProfile.build() result
 * \param opts    reserved for future options; currently unused (a
 *                 labelBands suppress-the-caption switch was dropped --
 *                 no caller ever set it, Task 10's tool has no reason
 *                 to suppress a band's label, and a dead option left in
 *                 place only accumulates). Kept as a parameter, not
 *                 removed outright, so a real future option does not
 *                 have to change this function's call signature.
 * \return {bandsDrawn, legsDrawn, stationsDrawn, ceilingRuns,
 *          floorRuns, flatTicks, erased, claimed, linework,
 *          stationsMoved} --
 *          claimed and linework are CsProfileBind.claim's own result
 *          and CsRevise.moveLinework's own result (or this function's
 *          {error: ...} / {moved: 0, warped: 0,
 *          unmoved: ["move failed: ..."]}
 *          stand-ins when either step threw); CsReport.profileSummary
 *          is what turns both into the words a user actually reads --
 *          see that function for why neither may be dropped silently.
 *          stationsMoved is true only when CsRevise.positionsMoved found
 *          at least one profile station that actually shifted between
 *          the pre-erase drawing and this redraw -- false on a brand
 *          new profile (nothing existed to compare against) and on an
 *          idempotent redraw of an unchanged one. CsReport.profileSummary
 *          reads it to tell "nothing moved, so there was nothing for a
 *          sketch to follow" apart from "stations moved but a sketch
 *          failed to follow them" -- moved===0 means something very
 *          different in each case, and only one of them is worth a
 *          warning (see CRITICAL 1 in this feature's review history).
 *          `erased` (how many stale generator-owned entities this call
 *          deleted before redrawing -- CsProfileDraw.erase's own return
 *          value) is DELIBERATELY internal-only, not merely dropped:
 *          it counts THIS module's own prior output being replaced, not
 *          anything the surveyor did or needs to act on -- there is no
 *          "warning" or "check this" reading of it the way there is for
 *          claimed/linework/stationsMoved above. It exists so a caller
 *          debugging a doubled- or dropped-entity regression (the two
 *          failure modes this file's own tests, e.g. tests/profile_draw
 *          _roundtrip.js's off-layer fixture, exist to catch) has a
 *          number to compare against bandsDrawn/legsDrawn without
 *          re-deriving it from a queryAllEntities() scan by hand.
 */
CsProfileDraw.render = function(doc, di, profile, opts) {
    opts = opts || {};   // accepted, currently unread -- see \param opts
    var layers = CsProfileDraw.LAYERS();
    for (var l = 0; l < layers.length; l++) {
        CsLayers.ensure(doc, di, layers[l]);
    }

    // Re-place the box layer's lock. ensure() only creates; a DROPPED
    // lock arrives with every reopened drawing, because a layer's lock
    // state does not survive a DXF round trip in this build (same loss
    // as the off state -- see CaveTemplateApply's post-pour pass). The
    // profile redraw is the natural healing point: it runs on every
    // notebook Draw, so the bookkeeping never stays editable for long.
    try {
        var boxLay = doc.queryLayer(CsLayers.CTRL_PROFILE_BOX);
        if (!isNull(boxLay) && boxLay.isLocked() === false) {
            boxLay.setLocked(true);
            var lockOp = new RModifyObjectsOperation();
            lockOp.addObject(boxLay, false);
            di.applyOperation(lockOp);
        }
    } catch (eLock) {
        // an unlocked bookkeeping layer is a nuisance, not a failure
    }

    // WHERE THE REGION GOES THIS TIME, and the move that gets the
    // drawing there. Both happen BEFORE `before` is read below: the
    // translation shifts the old generated geometry AND the user's
    // tracing by the same vector, so reading positions afterward
    // compares like with like. Read them first and moveLinework would
    // see the region delta as a station movement and apply it to the
    // sketch a SECOND time.
    var origin = CsProfileDraw.computeOrigin(doc, profile);
    var previous = CsProfileDraw.regionOrigin(doc);
    if (previous !== null) {
        CsProfileDraw.translateRegion(doc, di, origin.x - previous.x,
            origin.y - previous.y);
    }

    // ORDER MATTERS, and each step is only correct in this position:
    //   before  read FIRST -- claim() only writes TAGS, it never moves
    //           a station point, so reading old positions ahead of it
    //           sees exactly the same drawing claim() itself would
    //   claim   untagged sketch is bound while the OLD geometry it was
    //           traced against is still in the drawing to match
    //           against -- but ONLY when this redraw will actually move
    //           something (the positionsMoved check right below): an
    //           add-only first draw, or a re-render of an unchanged
    //           profile, has no old/new position mismatch anywhere, so
    //           claiming now would cost the user an undo step
    //           (RModifyObjectsOperation) for a tag a LATER, real
    //           revision will still write when it actually matters,
    //           against whatever is on the ground at that time
    //   erase   only now can the generator's own output go
    //   draw    the new geometry lands
    //   move    the sketch is carried to the new positions
    var claimed = { tagged: 0, skipped: 0 };
    var before = {};
    try {
        before = CsProfileBind.positions(doc);
        // A PREVIEW only, purely to decide whether claim() below is
        // worth running at all: positionsOf(profile) is a pure function
        // of the already-built profile object, no document access
        // needed, so computing it here costs nothing ahead of the real
        // move's own after/extent further down (which recompute the
        // identical values -- `profile` does not change across this
        // call, so there is nothing to gain by threading one copy
        // through both places instead of asking for it twice).
        var previewAfter = CsProfileDraw.positionsOf(profile, origin);
        var previewExtent = CsRevise.positionsExtent(previewAfter);
        if (CsRevise.positionsMoved(before, previewAfter,
                previewExtent) > 0) {
            claimed = CsProfileBind.claim(doc, di);
        }
    } catch (eBind) {
        // binding is an improvement on leaving the sketch behind, not a
        // precondition for drawing a profile at all
        claimed = { tagged: 0, skipped: 0, error: String(eBind) };
    }

    var erased = CsProfileDraw.erase(doc, di);

    var counts = { bandsDrawn: 0, legsDrawn: 0, stationsDrawn: 0,
        ceilingRuns: 0, floorRuns: 0, flatTicks: 0, pitchLabels: 0,
        tiesDrawn: 0, erased: erased };

    var op = new RAddObjectsOperation();
    op.setText("Draw extended elevation");

    var bands = (profile && profile.bands) ? profile.bands : [];
    for (var b = 0; b < bands.length; b++) {
        CsProfileDraw.band(doc, di, op, bands[b], counts, origin);
        counts.bandsDrawn++;
    }

    // THE JOINS BETWEEN CHUNKS. A chunked elevation is the cave cut
    // up, and a cut with nothing drawn across it is a cave that stops:
    // the reader has no way to tell which piece continues into which.
    // The tie is drawn from the shared station in one chunk to the
    // SAME shared station in the other -- a real correspondence, not a
    // decorative arrow -- and it is dashed, because it is the only
    // line on the drawing that is not passage.
    counts.tiesDrawn = 0;
    if (profile && profile.ties && profile.ties.length > 0) {
        var placedAt = {};
        for (b = 0; b < bands.length; b++) {
            for (var si = 0; si < bands[b].stations.length; si++) {
                var bst = bands[b].stations[si];
                placedAt[bands[b].key + "\u0000" + bst.name] =
                    { x: bst.x, y: bst.y + (bands[b].zOffset || 0.0) };
            }
        }
        var tieLayer = CsLayers.CTRL_PROFILE_SHOTS;
        CsLayers.ensure(doc, di, tieLayer);
        var ox2 = (origin === undefined || origin === null) ? 0 : origin.x;
        var oy2 = (origin === undefined || origin === null) ? 0 : origin.y;
        for (var ti = 0; ti < profile.ties.length; ti++) {
            var tie = profile.ties[ti];
            var ka = bands[tie.a] ? bands[tie.a].key : null;
            var kb = bands[tie.b] ? bands[tie.b].key : null;
            if (ka === null || kb === null) { continue; }
            var pa = placedAt[ka + "\u0000" + tie.station];
            var pb = placedAt[kb + "\u0000" + tie.station];
            if (pa === undefined || pb === undefined) { continue; }
            var tl = CsDraw.addLine(doc, op, tieLayer,
                new RVector(ox2 + pa.x, oy2 + pa.y),
                new RVector(ox2 + pb.x, oy2 + pb.y),
                "ProfileChunkTie", tie.station);
            // ProfileRun as well, so a scoped erase reaches it exactly
            // as it reaches everything else this module draws. The tie
            // belongs to BOTH chunks; it is filed under the first, and
            // erasing either redraws both anyway.
            CsTags.set(tl, "ProfileRun", ka);
            counts.tiesDrawn++;
        }
    }

    // The bounding box around each band, with the band's name in its
    // top-left corner -- Nathan's frame bookkeeping (2026-08-28): a
    // future drawing tool can decide which band a stroke belongs to by
    // WHERE it lands instead of by which per-frame button was pressed.
    // Locked layer (CsLayers.LOCKED), so the boxes are readable but
    // never editable; the apply below runs inside withLayerUnlocked.
    var boxMargin;
    try {
        var boxUnit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
        boxMargin = CsUnits.convert(CsProfileDraw.BOX_MARGIN_FEET,
            CsUnits.FEET, boxUnit);
    } catch (eMargin) {
        boxMargin = CsProfileDraw.BOX_MARGIN_FEET;
    }
    var boxes = CsProfileDraw.boxesFor(profile, boxMargin);
    counts.boxesDrawn = 0;
    for (var bx = 0; bx < boxes.length; bx++) {
        var box = boxes[bx];
        var rect = new RPolyline();
        rect.appendVertex(new RVector(origin.x + box.minX,
            origin.y + box.minY), 0.0);
        rect.appendVertex(new RVector(origin.x + box.maxX,
            origin.y + box.minY), 0.0);
        rect.appendVertex(new RVector(origin.x + box.maxX,
            origin.y + box.maxY), 0.0);
        rect.appendVertex(new RVector(origin.x + box.minX,
            origin.y + box.maxY), 0.0);
        rect.setClosed(true);
        var rectEnt = new RPolylineEntity(doc, new RPolylineData(rect));
        rectEnt.setLayerId(doc.getLayerId(CsLayers.CTRL_PROFILE_BOX));
        CsTags.set(rectEnt, "ProfileBox", box.key);
        CsTags.set(rectEnt, "ProfileRun", box.key);
        op.addObject(rectEnt, false);

        // the name, top-left corner, inset one text height -- so a
        // reader knows which band's frame they are looking at
        var boxLabel = CsDraw.addText(doc, op, CsLayers.CTRL_PROFILE_BOX,
            box.key,
            new RVector(origin.x + box.minX + CsDraw.TEXT_HEIGHT,
                origin.y + box.maxY - CsDraw.TEXT_HEIGHT * 1.5),
            RS.HAlignLeft, "ProfileBoxLabel", box.key);
        CsTags.set(boxLabel, "ProfileRun", box.key);
        counts.boxesDrawn++;
    }

    // The marker that lets the NEXT draw know where this one put the
    // region, so it can translate the user's tracing by the difference.
    // Written last, into the same operation as the geometry it belongs
    // with, and erased by the next erase() like every other tagged
    // thing this module owns.
    var marker = CsDraw.addPoint(doc, op, CsLayers.CTRL_PROFILE_STATIONS,
        new RVector(origin.x, origin.y));
    CsTags.set(marker, "ProfileOrigin", origin.x + "," + origin.y);
    op.addObject(marker, false);
    counts.origin = { x: origin.x, y: origin.y };

    // Wrapped exactly like erase()'s delete, and for the identical
    // reason: any layer in CsProfileDraw.LAYERS() may be off by the
    // time this runs (a user's own choice, not a template default --
    // see CsProfileDraw.withOwnLayersOn), and this build drops adds to
    // an off layer with no error at all. The box layer additionally
    // ships LOCKED, and locked refuses adds just as silently.
    CsProfileDraw.withOwnLayersOn(doc, di, function() {
        CsLayers.withLayerUnlocked(doc, di, CsLayers.CTRL_PROFILE_BOX,
            function() {
                di.applyOperation(op);
            });
    });

    counts.claimed = claimed;
    counts.linework = { moved: 0, warped: 0, unmoved: [] };
    // Recorded BEFORE moveLinework runs (and kept even if moveLinework
    // then throws, below): CsReport.profileSummary needs to tell "no
    // station moved, so there was nothing for a sketch to follow" apart
    // from "a station moved but the sketch didn't follow it" -- both
    // read as counts.linework.moved === 0, and only the second is worth
    // a warning. See this function's own \return docblock and CRITICAL 1
    // in this feature's review history.
    counts.stationsMoved = false;
    try {
        var after = CsProfileDraw.positionsOf(profile, origin);
        // the tolerance basis and the "did anything actually move"
        // question both already have one tested answer in CsRevise --
        // a second spelling here is how a cave in feet and the same
        // cave in metres start deciding differently
        var extent = CsRevise.positionsExtent(after);
        if (CsRevise.positionsMoved(before, after, extent) > 0) {
            counts.stationsMoved = true;
            // moveLinework MODIFIES entities (tag rewrite aside, the
            // rotate/scale/move themselves are modifies): the tracing
            // layer a user hid to sketch on undisturbed is not in
            // CsProfileDraw.LAYERS() and so is untouched by
            // withOwnLayersOn above -- exactly the layer this move
            // needs to reach. CsRevise.withOffLayersOn sweeps every
            // off layer in the document holding entities, this one
            // included, and restores each afterward.
            CsRevise.withOffLayersOn(doc, di, function() {
                // {} for tripStations, still: the plan's fallback is
                // "this sketch's TRIP's other stations", and a trip's
                // stations really are scattered across however many
                // bands it touches, at unrelated X/Y -- that is why keys
                // are run-qualified in the first place. So there is no
                // trip-shaped set to offer here.
                //
                // The profile's equivalent lives one step earlier now.
                // Since bands draw to per-run layers, a traced line's
                // LAYER names its run, and CsProfileBind.claim falls
                // back to that run's whole band when no station matches
                // by distance. A run IS one coherent position set, which
                // a trip is not. So a line traced well above its
                // stations gets a station list there rather than
                // arriving here with nothing -- which is what used to
                // leave it silently unmoved forever.
                counts.linework = CsRevise.moveLinework(doc, di, before,
                    after, {}, extent);
            });
        }
    } catch (eMove) {
        counts.linework = { moved: 0, warped: 0,
            unmoved: ["move failed: " + eMove] };
    }

    // An entity claim() could bind to NO station at all never gets a
    // tag, so moveLinework never sees it and never names it -- by
    // CsRevise's own explicit design, an untagged entity is not that
    // function's problem. Folding claim()'s own skipped labels in here
    // is what makes "drawn nowhere near the survey" show up SOMEWHERE
    // in the one list the caller reads for "what didn't move and why",
    // rather than only as a bare count with no entity behind it.
    if (claimed.skippedLabels && claimed.skippedLabels.length > 0) {
        counts.linework.unmoved =
            counts.linework.unmoved.concat(claimed.skippedLabels);
    }

    return counts;
};
