// CsScanRelink.js -- putting a scan's file reference back.
//
// Part of the Cave Survey Core library. QCAD context throughout: every
// function here takes a real document.
//
// WHAT BREAKS. A placed scan is an IMAGE entity pointing at a file, and
// the pointer lives in the DXF's IMAGEDEF. That path can be lost -- a
// round trip through another program, a cave folder that moved, a Drive
// path that changed -- and when it goes the image is still there, still
// the right size and still in the right place, pointing at nothing.
// Truitt Cave had all forty-seven of its images in exactly that state:
// every IMAGEDEF carrying an empty path, nothing drawn in the 2D view,
// and no error anywhere to say so.
//
// WHY IT IS RECOVERABLE. This suite tags every scan it places with the
// page it came from -- SketchScan for plan and profile, SectionScan for
// a section's own -- relative to the cave's scans folder. That tag is
// XDATA on the entity and survives what the IMAGEDEF does not. So the
// drawing still knows which file each image WAS, even when it no longer
// knows where to find it.
//
// THE PAGE IS NOT WHAT WAS PLACED. A scan goes into the drawing trimmed
// to the box the caver drew on it, as a derivative file under scans'
// Trimmed folder (CsScanTrim). The box is its own XDATA tag, ScanTrim,
// so it survives too -- and it has to be honoured here. Relinking to
// the page named by SketchScan puts the whole untrimmed sheet back on
// the map, which is not the image that was lost. Where the derivative
// itself has been deleted, CsScanTrim.write cuts it again from the
// page; the name carries the box, so a box cut twice is the same file.
//
// IT SURVIVES A SAVE, SINCE CaveCAD 0.6.0.1. It did not before, and
// the reason was not the exporter. dxflib read lines into a fixed
// buffer and an over-long one left its tail, newline and all, in the
// stream: every group code and value pair after it came back a line out
// of step and the rest of the file was dropped in silence. Our own
// AreaFillSig XDATA crosses that length, so any drawing with an area
// fill lost the whole OBJECTS section that follows -- every IMAGEDEF in
// it. The export had been correct all along, writing 47 IMAGEDEFs with
// matching handles and real paths; nothing was ever reading them back.
//
// Measured on Truitt, on the fixed reader: relinked 46 of 47, saved,
// reloaded -- 46 of 47, with all 46 files found on disk. Against an
// older CaveCAD the repair still only lasts the session.
//
// WHAT IT WILL NOT DO. It never guesses. An image with no tag is left
// alone, and a tag naming a file that is not on disk is REPORTED rather
// than quietly repointed at something nearby: an image silently showing
// the wrong page is worse than one showing nothing, because nothing is
// obviously nothing.

var CsScanRelink = {};

/** The XDATA keys a scan's own page is recorded under. Plan and profile
 *  scans use the first; a section's scan uses the second. */
CsScanRelink.TAGS = ["SketchScan", "SectionScan"];

/**
 * Re-points every image whose file reference has been lost.
 *
 * \return {relinked, missing: [name], untagged, alreadyLinked,
 *          retrimmed} -- retrimmed counts those put back to the box the
 *          caver drew rather than to the whole page.
 */
CsScanRelink.run = function(doc, di) {
    var out = { relinked: 0, missing: [], untagged: 0, alreadyLinked: 0,
                retrimmed: 0 };
    if (isNull(doc) || isNull(di)) {
        return out;
    }
    var scans = CsCave.scansDir(doc.getFileName());
    if (scans === null) {
        // Not saved in a cave folder, so a relative tag has nothing to
        // be relative TO.
        return out;
    }

    var ids;
    try {
        ids = doc.queryAllEntities(false, true);
    } catch (e) {
        return out;
    }

    var op = new RModifyObjectsOperation();
    var any = false;

    for (var i = 0; i < ids.length; i++) {
        try {
            var e = doc.queryEntity(ids[i]);
            if (isNull(e) || e.getType() !== RS.EntityImage) {
                continue;
            }
            var current = String(
                e.getProperty(RImageEntity.PropertyFileName)[0]);
            if (current !== "") {
                out.alreadyLinked++;
                continue;
            }
            var stored = "";
            for (var t = 0; t < CsScanRelink.TAGS.length; t++) {
                var got = CsTags.get(e, CsScanRelink.TAGS[t]);
                if (typeof got === "string" && got !== "") {
                    stored = got;
                    break;
                }
            }
            if (stored === "") {
                // No record of what it was. Guessing from position or
                // from what else is in the folder would be inventing a
                // provenance the drawing never had.
                out.untagged++;
                continue;
            }
            // THE PAGE IS NOT WHAT WAS PLACED. SketchScan names the
            // whole scanned page; what went into the drawing was the
            // box the caver drew on it, as a derivative file. Relinking
            // to the page puts the untrimmed sheet back on the map and
            // buries it. The box is its own tag, so honour it.
            var trim = CsScanTrim.parse(CsTags.get(e, CsScanTrim.TAG));
            // A crop masked to a traced outline needs the outline too,
            // or cutting it again gives back the whole box with all the
            // clutter the caver drew around.
            var shape = CsScanTrim.parseOutline(
                CsTags.get(e, CsScanTrim.OUTLINE_TAG));
            var abs = null;
            if (trim !== null && !CsCave.isAbsolutePath(stored)) {
                var made = CsScanTrim.write(scans, stored, trim, shape);
                if (made.path === null) {
                    // The derivative is gone and the page it was cut
                    // from cannot be read, so there is nothing to cut
                    // again. Say so rather than placing the whole page:
                    // a sheet covering the map is worse than a gap.
                    out.missing.push(stored);
                    continue;
                }
                abs = made.path;
                out.retrimmed++;
            } else {
                abs = CsCave.isAbsolutePath(stored)
                    ? stored : CsCave.resolveUnderScans(scans, stored);
            }
            if (abs === null || !(new QFileInfo(abs)).exists()) {
                out.missing.push(stored);
                continue;
            }
            e.setProperty(RImageEntity.PropertyFileName, abs);
            op.addObject(e, false);
            any = true;
            out.relinked++;
        } catch (eOne) {
            // One unreadable image must not stop the rest being fixed.
            continue;
        }
    }

    if (any) {
        di.applyOperation(op);
    }
    return out;
};

/** One line for a report. */
CsScanRelink.summary = function(r) {
    if (r.relinked === 0 && r.missing.length === 0 && r.untagged === 0) {
        return qsTr("Scan images: all %1 still point at their files.")
            .arg(r.alreadyLinked);
    }
    // SAYS TO SAVE. The repair is only in the drawing until it is
    // written out, and a caver who closes without saving does the whole
    // thing again next time.
    var parts = [];
    if (r.relinked > 0) {
        parts.push(qsTr("%1 relinked").arg(r.relinked));
    }
    if (r.missing.length > 0) {
        // NAMED, not counted. "3 missing" sends a caver hunting; the
        // names say which pages to go and find.
        parts.push(qsTr("%1 still missing (%2)")
            .arg(r.missing.length).arg(r.missing.join(", ")));
    }
    if (r.untagged > 0) {
        parts.push(qsTr("%1 with no record of their page").arg(r.untagged));
    }
    if (r.retrimmed > 0) {
        // WORTH SAYING. Otherwise a caver who sees "46 relinked" and a
        // tidy map has no way to know the trims came back too.
        parts.push(qsTr("%1 back to their trim box").arg(r.retrimmed));
    }
    var text = qsTr("Scan images: ") + parts.join(", ") + ".";
    if (r.relinked > 0) {
        text += qsTr(" Save the drawing to keep it.");
    }
    return text;
};
