// CsStore.js -- LEGACY survey-store migration.
//
// Part of the Cave Survey Core library. QCAD context only.
//
// HISTORY: early builds appeared to never write custom properties to
// disk, so tags were serialized into one MTEXT entity ("CAVESURVEYDB")
// on the CTRL-DATA layer -- the "survey data store". That diagnosis no
// longer holds: the current build persists custom properties as DXF
// XDATA (1001 CaveSurvey groups) and reads them back on open, verified
// by a headless save/reopen round trip. Entity tags are now the single
// durable truth and nothing writes the store anymore.
//
// WHAT REMAINS here is the legacy path:
//   - lookup/ensureLoaded: read-only fallback so tools can still read
//     tags on an old drawing whose data lives only in its store text.
//   - migrate: copies a store's records onto their entities as real
//     custom properties, then deletes the store text (and the CTRL-DATA
//     layer once empty). Runs wherever tags are written, so any legacy
//     drawing is converted the first time a tool modifies it.
//
// Records are keyed by GEOMETRY (entity type + position), not by
// handle: the exporter renumbered handles on save, but a point's
// coordinates survive any round trip bit-for-bit close. Position is
// rounded to 1e-4 drawing units for matching.

var CsStore = {};

CsStore.LAYER = "CTRL-DATA";
CsStore.MARKER = "CAVESURVEYDB v3 ";
// Legacy record format (deliberately NOT JSON: MTEXT treats braces as
// formatting groups, and this build only exposes getPlainText):
//   <type>:<x>:<y>|key=encoded|key=encoded;;...
// with x/y printed to 4 decimals; values URI-encoded, so separators
// can never occur inside them.

CsStore.map = null; // geoKey -> {key: value}, for the loaded document
CsStore.mapEmpty = true; // cached alongside CsStore.map -- see setMap

/**
 * The geometry key of an entity: type + position to 4 decimals.
 * Points and texts use their position; lines their midpoint;
 * anything else its bounding-box middle.
 */
CsStore.geoKey = function(entity) {
    var p = null;
    try {
        if (typeof entity.getPosition === "function") {
            p = entity.getPosition();
        } else if (typeof entity.getStartPoint === "function" &&
                typeof entity.getEndPoint === "function") {
            var a = entity.getStartPoint();
            var b = entity.getEndPoint();
            p = new RVector((a.x + b.x) / 2.0, (a.y + b.y) / 2.0);
        } else if (typeof entity.getBoundingBox === "function") {
            p = entity.getBoundingBox().getCenter();
        }
    } catch (e) {
        p = null;
    }
    if (p === null) {
        return null;
    }
    return entity.getType() + ":" + p.x.toFixed(4) + ":" + p.y.toFixed(4);
};

/** Finds the legacy store text entity, or null. */
CsStore.findStoreEntity = function(doc) {
    if (!doc.hasLayer(CsStore.LAYER)) {
        return null;
    }
    var layerId = doc.getLayerId(CsStore.LAYER);
    var ids = doc.queryAllEntities(false, true); // include invisible/frozen
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.getLayerId() !== layerId) {
            continue;
        }
        if (typeof e.getPlainText === "function") {
            var t = String(e.getPlainText());
            // any version: migration must find stale stores too
            if (t.indexOf("CAVESURVEYDB ") === 0) {
                return e;
            }
        }
    }
    return null;
};

/**
 * Sets CsStore.map AND the cached emptiness flag CsStore.isEmpty()
 * reads, in the one place, so every assignment site (ensureLoaded,
 * migrate) can't drift out of sync with what isEmpty() reports -- see
 * isEmpty's own docblock for why the flag exists instead of a for-in
 * scan on every call.
 */
CsStore.setMap = function(map) {
    CsStore.map = map;
    var empty = true;
    if (map !== null && map !== undefined) {
        for (var k in map) {
            if (map.hasOwnProperty(k)) {
                empty = false;
                break;
            }
        }
    }
    CsStore.mapEmpty = empty;
};

/** Loads (always fresh) the legacy store map for this document. */
CsStore.ensureLoaded = function(doc) {
    CsStore.setMap({});
    var store = CsStore.findStoreEntity(doc);
    if (store === null) {
        return;
    }
    CsStore.setMap(CsStore.parse(String(store.getPlainText())));
};

/** Parses the record format; corrupt input parses to empty. */
CsStore.parse = function(text) {
    var map = {};
    if (text.indexOf(CsStore.MARKER) !== 0) {
        return map; // older store version: keys are meaningless now
    }
    try {
        var body = text.substring(CsStore.MARKER.length);
        var records = body.split(";;");
        for (var i = 0; i < records.length; i++) {
            var fields = records[i].split("|");
            if (fields.length < 2 || fields[0] === "") {
                continue;
            }
            var rec = {};
            for (var f = 1; f < fields.length; f++) {
                var eq = fields[f].indexOf("=");
                if (eq > 0) {
                    rec[fields[f].substring(0, eq)] =
                        decodeURIComponent(fields[f].substring(eq + 1));
                }
            }
            map[fields[0]] = rec;
        }
    } catch (e) {
        return {};
    }
    return map;
};

/** True when the loaded store holds no records at all -- which is
 *  essentially every real drawing, since ensureLoaded sets `map` to
 *  {} even when there is no legacy store text to find at all. Checked
 *  BEFORE computing a geometry key, which is the expensive part of a
 *  miss (a getPosition, or a getStartPoint + getEndPoint, plus two
 *  toFixed(4) calls and a string concat) and was being paid on every
 *  CsTags.get miss -- up to 16 times per entity, and a full 16 times
 *  for every UNTAGGED entity, which is most of them. Measured in the
 *  real engine over CsFocus.stationsOf across 7,000 entities: 725ms
 *  with CsStore.map non-null (this fallback engaged on every miss)
 *  vs. 94ms with it null (before CsStore.ensureLoaded had ever run) --
 *  a 7.7x cost paid to serve drawings that predate the current tag
 *  schema and, this same measurement shows, on nearly every drawing
 *  whether it needs the fallback or not.
 *
 *  REVIEW MINOR, FIXED HERE: this used to re-walk CsStore.map with a
 *  for-in on every single call -- the short-circuit above removed the
 *  geometry-key cost on a miss, but paid an O(map size) scan in its
 *  place on the one path (a POPULATED legacy store) where the
 *  short-circuit can never actually help. Measured: a populated
 *  5,000-record store sweep across 5,500 entities went 648ms -> 684ms
 *  purely from this scan; a cached boolean measured 2ms per 100,000
 *  calls against 27-29ms for the for-in. CsStore.setMap now computes
 *  this ONCE, at the point CsStore.map is actually assigned
 *  (ensureLoaded, migrate), so isEmpty() itself is just a cached read
 *  -- same public behaviour, including null -> true and {k:{}} -> false
 *  (a for-in sees the OWN KEY "k" regardless of what {} is), just paid
 *  once per load instead of once per lookup. */
CsStore.isEmpty = function() {
    return CsStore.mapEmpty;
};

/** Read-only fallback lookup for CsTags.get on unmigrated drawings. */
CsStore.lookup = function(entity, key) {
    if (CsStore.isEmpty()) {
        return "";
    }
    var gk = CsStore.geoKey(entity);
    if (gk === null) {
        return "";
    }
    var rec = CsStore.map[gk];
    if (rec === undefined || rec[key] === undefined) {
        return "";
    }
    return String(rec[key]);
};

/**
 * Migrates a legacy store into entity custom properties and deletes
 * the store text. No-op (returns 0) when the document has no store.
 *
 * Store values are kept in the escaped form CsTags.set wrote them in
 * (backslashes doubled, newlines as \n), so they are written back RAW
 * with setCustomProperty -- passing them through CsTags.set again
 * would double-escape; CsTags.get undoes exactly one level.
 *
 * An entity's own non-empty tag always wins over the store record --
 * the store was only ever the fallback for tags a reopen erased.
 *
 * \return number of entities that received migrated tags
 */
CsStore.migrate = function(doc, di) {
    var storeEntity = CsStore.findStoreEntity(doc);
    if (storeEntity === null) {
        CsStore.setMap({});
        return 0;
    }
    var records = CsStore.parse(String(storeEntity.getPlainText()));

    var op = new RModifyObjectsOperation();
    op.setText("Migrate survey data to entity tags");
    var migrated = 0;
    var ids = doc.queryAllEntities(false, true);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || typeof e.setCustomProperty !== "function") {
            continue;
        }
        var gk = CsStore.geoKey(e);
        if (gk === null || records[gk] === undefined) {
            continue;
        }
        var rec = records[gk];
        var changed = false;
        for (var k in rec) {
            if (!rec.hasOwnProperty(k) || rec[k] === "") {
                continue;
            }
            var existing = "";
            try {
                existing = e.getCustomProperty(CsTags.GROUP, k, "");
                existing = (existing === undefined || existing === null) ?
                    "" : String(existing);
            } catch (e2) {
                existing = "";
            }
            if (existing !== "") {
                continue;
            }
            try {
                e.setCustomProperty(CsTags.GROUP, k, rec[k]);
                changed = true;
            } catch (e3) {
                // not supported here -- the store text stays as backup
                CsStore.setMap(records);
                return 0;
            }
        }
        if (changed) {
            op.addObject(e, false);
            migrated++;
        }
    }

    op.deleteObject(storeEntity);
    di.applyOperation(op);

    // the store was CTRL-DATA's only tenant; drop the layer once empty
    if (doc.hasLayer(CsStore.LAYER)) {
        var layerId = doc.getLayerId(CsStore.LAYER);
        var remaining = doc.queryLayerEntities(layerId, true);
        if (remaining.length === 0) {
            var opLayer = new RDeleteObjectsOperation();
            opLayer.deleteObject(doc.queryLayer(CsStore.LAYER));
            di.applyOperation(opLayer);
        }
    }

    CsStore.setMap({});
    return migrated;
};
