// CsStationSidecar.js -- stations.json on disk.
//
// Part of the Cave Survey Core library. The file plumbing Station Table
// (its marks) and Expedition Planner (settings.packing, settings.pace,
// settings.trip) share, so it exists once. The logic of what the file
// holds is CsStationStore; this file only reads and writes it.
//
// THE SIDECAR IS SHARED, SO EVERY WRITE RE-READS IT FIRST. Callers read
// with readSidecar, change only their own part of the store, and write
// the whole store back: unrelated settings pass through untouched. A
// file that will not parse comes back with an error and must never be
// overwritten.
//
// QFile/QTextStream: GUI engine only, so none of this is unit-tested
// headlessly. Loading the file defines functions and touches nothing.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsStationSidecar = {};

/** The open document, or null. Resolved fresh every time. */
CsStationSidecar.document = function() {
    try {
        var doc = EAction.getDocument();
        return isNull(doc) ? null : doc;
    } catch (e) {
        return null;
    }
};

/** The open document's file path, or "" (none open, or never saved). */
CsStationSidecar.pathOf = function(doc) {
    if (doc === null) {
        return "";
    }
    try {
        var name = doc.getFileName();
        return isNull(name) ? "" : String(name);
    } catch (e) {
        return "";
    }
};

/** Absolute path of stations.json beside the drawing, or "" when unsaved. */
CsStationSidecar.sidecarPath = function(docPath) {
    var folder = CsCave.folderOf(String(docPath === undefined ||
        docPath === null ? "" : docPath));
    return folder === null ? "" : folder + "/" + CsStationStore.FILE;
};

/** \return {store, error} -- never throws */
CsStationSidecar.readSidecar = function(path) {
    if (path === "") {
        return { store: CsStationStore.empty(), error: "" };
    }
    try {
        var file = new QFile(path);
        if (!file.exists()) {
            return { store: CsStationStore.empty(), error: "" };
        }
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return { store: CsStationStore.empty(),
                error: qsTr("stations.json exists but could not be opened") };
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
            // an older bridge reads in the locale's codec
        }
        var text = String(stream.readAll());
        file.close();
        return CsStationStore.parse(text);
    } catch (e) {
        return { store: CsStationStore.empty(),
            error: qsTr("stations.json could not be read") + " (" + e + ")" };
    }
};

/** Write text to a file as UTF-8, replacing it. \return true on success */
CsStationSidecar.writeText = function(path, text) {
    if (path === "") {
        return false;
    }
    try {
        var file = new QFile(path);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate |
                QIODevice.Text)) {
            return false;
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(text);
        stream.flush();
        file.close();
        return true;
    } catch (e) {
        return false;
    }
};

/** \return true on success */
CsStationSidecar.writeSidecar = function(path, store) {
    return CsStationSidecar.writeText(path, CsStationStore.serialize(store));
};

/**
 * The whole cave as the drawing carries it, resolved the way the drawing
 * was solved (anchor, datum and adjustment as recorded), so elevations
 * agree with the map. CsRevise.resolveAsDrawn is that recipe, shared.
 * Both panels derive their station list from this.
 *
 * \return {survey, resolved} or null when the drawing holds no survey
 */
CsStationSidecar.readDrawing = function(doc) {
    if (isNull(doc)) {
        return null;
    }
    var drawn = CsRevise.resolveAsDrawn(doc);
    if (drawn === null || drawn === undefined || isNull(drawn.survey)) {
        return null;
    }
    return drawn;
};
