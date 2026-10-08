// CsViews.js -- the views a drawing can make a sheet of.
//
// Part of the Cave Survey Core library.
//
// A cave drawing holds several VIEWS: the plan (the cave's bounding box), each
// profile (elevation) band, and each cross section. A sheet is a frame on one of
// them. This file lists them, so the sheet builder can offer "make a sheet of..."
// from a list instead of knowing only the plan and one profile.
//
// A view is { id, kind, label, name, box, frame }:
//   id     stable key ("cave", "profile:<band key>", "section:<callout id>")
//   kind   "plan" | "profile" | "section"
//   label  what a person sees in the list
//   name   a safe layout name for its sheet
//   box    { minX, minY, maxX, maxY } in drawing units
//   frame  which layers belong to it, by CsLayers.frameOf ("plan" | "profile" | "section")
//
// build() is pure (the engine-free half, unit-tested); read() reads the document.

var CsViews = {};

CsViews.CAVE_ID = "cave";

/** A layout name safe to use as a tab: letters, digits, space, - and _ (anything else becomes a space). */
CsViews.safeName = function(label) {
    var s = String(label).replace(/[^A-Za-z0-9 _\-]+/g, " ").replace(/\s+/g, " ");
    s = s.replace(/^\s+|\s+$/g, "");
    return s === "" ? "View" : s;
};

CsViews.validBox = function(b) {
    return !isNull(b) && isFinite(b.minX) && isFinite(b.minY) && isFinite(b.maxX) && isFinite(b.maxY) &&
        b.maxX > b.minX && b.maxY > b.minY;
};

/**
 * The list, pure.
 *
 * \param parts.caveBox       the plan's box, or null
 * \param parts.profileBoxes  [{ key, minX, minY, maxX, maxY }]  (CsProfileBox.boxes)
 * \param parts.sections      [{ id, label, minX, minY, maxX, maxY }]
 * \return views in the order the list shows them: the cave first, then profiles, then cross sections.
 *         A view with no usable box is left out; a name clash is made unique.
 */
CsViews.build = function(parts) {
    var out = [];
    var used = {};
    var add = function(id, kind, label, box, frame) {
        if (!CsViews.validBox(box)) {
            return;
        }
        var base = CsViews.safeName(label), name = base, n = 2;
        while (used.hasOwnProperty(name.toLowerCase())) {
            name = base + " " + n;
            n++;
        }
        used[name.toLowerCase()] = true;
        out.push({ id: id, kind: kind, label: label, name: name, frame: frame,
            box: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY } });
    };
    if (!isNull(parts.caveBox)) {
        add(CsViews.CAVE_ID, "plan", "Cave plan (whole cave)", parts.caveBox, "plan");
    }
    var pb = isNull(parts.profileBoxes) ? [] : parts.profileBoxes;
    for (var i = 0; i < pb.length; i++) {
        add("profile:" + pb[i].key, "profile", "Profile " + pb[i].key, pb[i], "profile");
    }
    var sx = isNull(parts.sections) ? [] : parts.sections;
    for (var j = 0; j < sx.length; j++) {
        add("section:" + sx[j].id, "section", "Cross section " + (isNull(sx[j].label) || sx[j].label === "" ? sx[j].id : sx[j].label), sx[j], "section");
    }
    return out;
};

/** Which of `views` the ids name, in list order. */
CsViews.pick = function(views, ids) {
    var out = [];
    for (var i = 0; i < views.length; i++) {
        if (ids.indexOf(views[i].id) >= 0) {
            out.push(views[i]);
        }
    }
    return out;
};

/** Every placed cross section: [{ id, label, minX, minY, maxX, maxY }]. QCAD only. */
CsViews.sections = function(doc) {
    var out = [];
    if (isNull(doc) || typeof CsCallout === "undefined") {
        return out;
    }
    var ids = doc.queryAllEntities(false, false, RS.EntityBlockRef);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || e.isUndone()) {
            continue;
        }
        if (CsTags.get(e, CsCallout.KEY.KIND) !== CsCallout.KIND_SECTION || CsTags.get(e, CsCallout.KEY.ROLE) !== CsCallout.ROLE_BLOCK) {
            continue;
        }
        try {
            var bb = e.getBoundingBox();
            var mn = bb.getMinimum(), mx = bb.getMaximum();
            out.push({ id: CsTags.get(e, CsCallout.KEY.ID), label: "", minX: mn.x, minY: mn.y, maxX: mx.x, maxY: mx.y });
        }
        catch (eBox) {
            // an unreadable section is left out rather than wrongly framed
        }
    }
    return out;
};

/** The views of an open drawing. \param caveBox the plan's box (SheetSetup.caveBox). */
CsViews.read = function(doc, caveBox) {
    return CsViews.build({
        caveBox: caveBox,
        profileBoxes: CsProfileBox.boxes(doc),
        sections: CsViews.sections(doc) });
};
