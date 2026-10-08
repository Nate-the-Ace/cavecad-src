// Registry.js -- "ask for a file, not for a format".
//
// Part of the Cave Survey Core library: pure functions.
//
// Detection is by extension first, then by content, and only reports
// ambiguity when both genuinely fail -- the caller decides whether to
// ask the user. Every entry exposes the same parse/write pair over
// the CsModel survey shape.

var CsFormatRegistry = {};

CsFormatRegistry.FORMATS = [
    {
        id: "compass",
        label: "Compass (.dat)",
        extensions: ["dat"],
        fileFilter: "Compass Data Files (*.dat)",
        parse: function(c) { return CsFormatCompass.parse(c); },
        write: function(s) { return CsFormatCompass.write(s); }
    },
    {
        id: "walls",
        label: "Walls (.srv)",
        extensions: ["srv"],
        fileFilter: "Walls Survey Files (*.srv)",
        parse: function(c) { return CsFormatWalls.parse(c); },
        write: function(s) { return CsFormatWalls.write(s); }
    },
    {
        id: "survex",
        label: "Survex (.svx)",
        extensions: ["svx"],
        fileFilter: "Survex Files (*.svx)",
        parse: function(c) { return CsFormatSurvex.parse(c); },
        write: function(s) { return CsFormatSurvex.write(s); }
    },
    {
        id: "therion",
        label: "Therion (.th)",
        extensions: ["th"],
        fileFilter: "Therion Files (*.th)",
        parse: function(c, opts) { return CsFormatTherion.parse(c, opts); },
        write: function(s) { return CsFormatTherion.write(s); }
    },
    {
        id: "csv",
        label: "CSV (.csv)",
        extensions: ["csv", "txt"],
        fileFilter: "CSV Files (*.csv *.txt)",
        parse: function(c) { return CsFormatCsv.parse(c); },
        write: function(s) { return CsFormatCsv.write(s); }
    }
];

/**
 * What a reader needs to follow a file's own references (Therion's
 * `input`): where the file is and a way to read a sibling. QCAD only --
 * a caller with no file system passes nothing and the readers behave as
 * they always did. Formats that have no use for it ignore it.
 */
CsFormatRegistry.optionsFor = function(path) {
    if (path === undefined || path === null || String(path) === "" ||
            typeof QFile === "undefined") {
        return undefined;
    }
    return {
        path: String(path),
        readFile: function(p) {
            var f = new QFile(p);
            if (!f.exists() || !f.open(QIODevice.ReadOnly | QIODevice.Text)) {
                return null;
            }
            var text = new QTextStream(f).readAll();
            f.close();
            return String(text);
        }
    };
};

CsFormatRegistry.byId = function(id) {
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        if (CsFormatRegistry.FORMATS[i].id === id) {
            return CsFormatRegistry.FORMATS[i];
        }
    }
    return null;
};

/** One combined file dialog filter string for all formats. */
CsFormatRegistry.combinedFileFilter = function() {
    var all = "Cave Survey Files (*.dat *.srv *.svx *.th *.csv)";
    var parts = [all];
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        parts.push(CsFormatRegistry.FORMATS[i].fileFilter);
    }
    parts.push("All Files (*)");
    return parts.join(";;");
};

/**
 * Detects the format of a file.
 *
 * \param fileName used only for its extension; may be "".
 * \param content the file's text.
 * \return the format entry, or null when genuinely ambiguous.
 */
CsFormatRegistry.detect = function(fileName, content) {
    var extMatch = /\.([A-Za-z0-9]+)$/.exec(fileName || "");
    var ext = extMatch ? extMatch[1].toLowerCase() : "";

    // Content votes -- each format's unmistakable markers.
    var byContent = CsFormatRegistry.detectByContent(content);

    // An extension whose content vote agrees, or that has no content
    // veto, wins outright.
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        var f = CsFormatRegistry.FORMATS[i];
        if (f.extensions.indexOf(ext) >= 0) {
            if (byContent === null || byContent.id === f.id ||
                (f.id === "csv" && byContent === null)) {
                return f;
            }
            // extension and content disagree: trust the content
            return byContent;
        }
    }
    return byContent;
};

/** Detection by content alone; null if nothing is unmistakable. */
CsFormatRegistry.detectByContent = function(content) {
    if (content === undefined || content === null) {
        return null;
    }
    var head = content.substring(0, 4000);

    // Survex: star directives at line starts.
    if (/^\s*\*(begin|data|units|fix|calibrate|declination|flags|alias|date|team)/im.test(head)) {
        return CsFormatRegistry.byId("survex");
    }
    // Walls: hash directives at line starts.
    if (/^\s*#(units|prefix|fix|date|segment)/im.test(head)) {
        return CsFormatRegistry.byId("walls");
    }
    // Compass: the header trio is always present.
    if (/SURVEY NAME:/i.test(head) && /DECLINATION:/i.test(head)) {
        return CsFormatRegistry.byId("compass");
    }
    // Therion: its block keywords, which carry no leading * or #.
    // Checked after Survex and Walls -- a .th holds no star or hash
    // directives, so nothing above can claim one -- and before CSV,
    // whose own marker is a header row this cannot resemble.
    if (/^\s*(survey|centreline|centerline)\s+\S/im.test(head) ||
            /^\s*encoding\s+\S/im.test(head)) {
        return CsFormatRegistry.byId("therion");
    }
    // CSV with our header row.
    if (/^\s*from\s*,\s*to\s*,\s*distance/im.test(head)) {
        return CsFormatRegistry.byId("csv");
    }
    return null;
};
