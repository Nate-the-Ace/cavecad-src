// CsPeople.js -- the people directory: everyone who goes caving with you.
//
// Part of the Cave Survey Core library. People go on many trips, so
// their details are entered once, in people.json in CaveCAD's per-user
// data folder, and each trip remembers only WHO is going (by id and
// name, in stations.json settings.trip.party; see CsStationStore).
//
// PERSONAL DATA STAYS ON THIS COMPUTER. Medical notes, emergency
// contacts and skills live in people.json only, never in the cave folder
// (Google Drive syncs that). A teammate's copy of the drawing shows the
// party's names and needs their own directory for the details.
//
// A person: {id, name, role, squeeze (inches or null), medical,
// emergency, skills: [checklist ids, see SKILLS], skillsNote}.
//
// The pure half (parse, serialize, blank, resolveParty, partyOf,
// skillLabels, validate) has no file I/O and is unit-tested. The file
// half (path, load, save) needs QFile and runs only in the GUI engine. A people.json that will not
// parse is NEVER overwritten: save refuses until a person fixes it.
//
// See docs/superpowers/plans/2026-09-29-people-directory.md.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsPeople = {};

CsPeople.VERSION = 1;
CsPeople.FILE = "people.json";

/**
 * The skills checklist. Ids are stable (they are what people.json
 * stores); labels may be reworded. An id a file holds that is not here
 * is kept, never dropped, just not shown as a checkbox.
 */
CsPeople.SKILLS = [
    { id: "leader", label: "Trip leader", group: "leadership" },
    { id: "vertical", label: "Vertical (SRT / rope)", group: "vertical" },
    { id: "rigging", label: "Rigging and bolting", group: "vertical" },
    { id: "rescue", label: "Cave rescue trained", group: "rescue" },
    { id: "first_aid", label: "First aid trained", group: "rescue" },
    { id: "cpr", label: "CPR trained", group: "rescue" },
    { id: "wfr", label: "Wilderness first responder or higher", group: "rescue" },
    { id: "survey_lead", label: "Survey lead", group: "survey" },
    { id: "survey_instruments",
        label: "Survey instruments (compass, clinometer, tape or laser)", group: "survey" },
    { id: "survey_book", label: "Survey book / data recording", group: "survey" },
    { id: "sketching", label: "Cave sketching", group: "survey" },
    { id: "diving", label: "Sump / cave diving", group: "other" },
    { id: "radio", label: "Cave radio / comms", group: "leadership" },
    { id: "digging", label: "Digging", group: "other" }
];

/**
 * The popup's collapsible categories, in order. Presentation only: a
 * person still stores a flat list of skill ids, and the card and the
 * table list labels flat in SKILLS order.
 */
CsPeople.SKILL_GROUPS = [
    { id: "leadership", label: "Leadership and comms" },
    { id: "vertical", label: "Vertical" },
    { id: "rescue", label: "Rescue and medical" },
    { id: "survey", label: "Survey" },
    { id: "other", label: "Water and digging" }
];

/** [{id, label, skills: [{id, label, group}]}] in group order, skills in SKILLS order. */
CsPeople.skillsByGroup = function() {
    var out = [];
    for (var g = 0; g < CsPeople.SKILL_GROUPS.length; g++) {
        var grp = CsPeople.SKILL_GROUPS[g];
        var members = [];
        for (var i = 0; i < CsPeople.SKILLS.length; i++) {
            if (CsPeople.SKILLS[i].group === grp.id) { members.push(CsPeople.SKILLS[i]); }
        }
        out.push({ id: grp.id, label: grp.label, skills: members });
    }
    return out;
};

/** How many of a group's skills a person has ticked (unknown ids never count). */
CsPeople.groupCount = function(person, groupId) {
    if (person === null || typeof person !== "object" ||
            Object.prototype.toString.call(person.skills) !== "[object Array]") {
        return 0;
    }
    var have = {};
    for (var i = 0; i < person.skills.length; i++) { have["#" + String(person.skills[i])] = true; }
    var n = 0;
    for (var k = 0; k < CsPeople.SKILLS.length; k++) {
        if (CsPeople.SKILLS[k].group === groupId && have["#" + CsPeople.SKILLS[k].id] === true) {
            n++;
        }
    }
    return n;
};

var csPeopleStr = function(v) {
    return (v === undefined || v === null) ? "" : String(v);
};

var csPeopleTrim = function(v) {
    return csPeopleStr(v).replace(/^\s+|\s+$/g, "");
};

/** A name as matching sees it: trimmed, runs of space as one, lower case. */
var csPeopleKey = function(name) {
    return csPeopleTrim(name).replace(/\s+/g, " ").toLowerCase();
};

/**
 * Skill ids as stored: known ids in checklist order, then unknown ones
 * in the order given. Non-strings, blanks and repeats are dropped.
 */
var csPeopleSkills = function(list) {
    var src = Object.prototype.toString.call(list) === "[object Array]" ? list : [];
    var have = {};
    var i;
    for (i = 0; i < src.length; i++) {
        if (typeof src[i] === "string" && csPeopleTrim(src[i]) !== "") {
            have["#" + csPeopleTrim(src[i])] = true;
        }
    }
    var out = [];
    var known = {};
    for (i = 0; i < CsPeople.SKILLS.length; i++) {
        known["#" + CsPeople.SKILLS[i].id] = true;
        if (have["#" + CsPeople.SKILLS[i].id] === true) { out.push(CsPeople.SKILLS[i].id); }
    }
    var extra = {};
    for (i = 0; i < src.length; i++) {
        if (typeof src[i] !== "string") { continue; }
        var id = csPeopleTrim(src[i]);
        if (id === "" || known["#" + id] === true || extra["#" + id] === true) { continue; }
        extra["#" + id] = true;
        out.push(id);
    }
    return out;
};

/**
 * One person from whatever a file or the panel held, fields in a fixed
 * order, or null when there is no name. The id is kept as given ("" when
 * missing); callers assign one. An old free-text `skills` string becomes
 * the note, so nothing typed is lost.
 */
var csPeopleClean = function(raw) {
    if (raw === null || typeof raw !== "object") { return null; }
    var name = csPeopleTrim(raw.name);
    if (name === "") { return null; }
    var sq = parseFloat(csPeopleStr(raw.squeeze));
    var note = csPeopleStr(raw.skillsNote);
    if (note === "" && typeof raw.skills === "string") { note = raw.skills; }
    return { id: csPeopleTrim(raw.id), name: name, role: csPeopleStr(raw.role),
        squeeze: (isFinite(sq) && sq > 0) ? sq : null,
        medical: csPeopleStr(raw.medical), emergency: csPeopleStr(raw.emergency),
        skills: csPeopleSkills(raw.skills), skillsNote: note };
};

/** The checklist labels a person has, in checklist order (unknown ids skipped). */
CsPeople.skillLabels = function(person) {
    var out = [];
    if (person === null || typeof person !== "object") { return out; }
    var have = {};
    var list = Object.prototype.toString.call(person.skills) === "[object Array]" ?
        person.skills : [];
    for (var i = 0; i < list.length; i++) { have["#" + csPeopleTrim(list[i])] = true; }
    for (var k = 0; k < CsPeople.SKILLS.length; k++) {
        if (have["#" + CsPeople.SKILLS[k].id] === true) { out.push(CsPeople.SKILLS[k].label); }
    }
    return out;
};

/**
 * What stops the Add/Edit person popup's OK, all at once: name, medical
 * notes and emergency contact are required (whitespace is blank; "None"
 * is an answer, a blank is not), and the squeeze limit is blank or a
 * number of inches above 0.
 *
 * \param fields {name, role, squeeze, medical, emergency, skills, skillsNote}
 * \return [problem strings], empty when fine
 */
CsPeople.validate = function(fields) {
    var f = (fields !== null && typeof fields === "object") ? fields : {};
    var out = [];
    if (csPeopleTrim(f.name) === "") { out.push("name"); }
    if (csPeopleTrim(f.medical) === "") { out.push("medical notes (type None if none)"); }
    if (csPeopleTrim(f.emergency) === "") { out.push("emergency contact"); }
    var sq = csPeopleTrim(f.squeeze);
    if (sq !== "") {
        var v = Number(sq);
        if (!isFinite(v) || v <= 0) {
            out.push("squeeze limit must be a number of inches above 0, or blank");
        }
    }
    return out;
};

/** A new empty person with a fresh id (the panel's Add person). */
CsPeople.blank = function() {
    return { id: CsUuid.v4(), name: "", role: "", squeeze: null, medical: "",
        emergency: "", skills: [], skillsNote: "" };
};

/**
 * Text of people.json -> {people, error}. Never throws. Empty text is an
 * empty directory with no error; damaged text is an empty directory WITH
 * an error, so the caller can refuse to overwrite it. A missing id is
 * assigned; of two rows sharing an id, the later gets a new one. Rows
 * with no name are skipped.
 */
CsPeople.parse = function(text) {
    var people = [];
    if (text === undefined || text === null ||
            String(text).replace(/\s+/g, "") === "") {
        return { people: people, error: "" };
    }
    var data;
    try {
        data = JSON.parse(String(text));
    } catch (e) {
        return { people: people, error: "people.json could not be read: " + e };
    }
    if (data === null || typeof data !== "object" ||
            Object.prototype.toString.call(data) === "[object Array]") {
        return { people: people, error: "people.json is not a people file" };
    }
    if (data.people === undefined || data.people === null) {
        return { people: people, error: "" };
    }
    if (Object.prototype.toString.call(data.people) !== "[object Array]") {
        return { people: people, error: "people.json has no list of people" };
    }
    var seen = {};
    for (var i = 0; i < data.people.length; i++) {
        var p = csPeopleClean(data.people[i]);
        if (p === null) { continue; }
        if (p.id === "" || seen["#" + p.id] === true) {
            p.id = CsUuid.v4();
        }
        seen["#" + p.id] = true;
        people.push(p);
    }
    return { people: people, error: "" };
};

/**
 * The directory as file text: sorted by name (natural, case-blind), ties
 * by id, pretty-printed so a manual diff stays small. Rows with no name
 * are dropped; a row with no id gets one.
 */
CsPeople.serialize = function(people) {
    var list = [];
    var src = Object.prototype.toString.call(people) === "[object Array]" ? people : [];
    for (var i = 0; i < src.length; i++) {
        var p = csPeopleClean(src[i]);
        if (p === null) { continue; }
        if (p.id === "") { p.id = CsUuid.v4(); }
        list.push(p);
    }
    list.sort(function(a, b) {
        var d = CsStationTable.compareNatural(a.name.toLowerCase(),
            b.name.toLowerCase());
        if (d !== 0) { return d; }
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return JSON.stringify({ version: CsPeople.VERSION, people: list }, null, 2) + "\n";
};

/**
 * The trip party as the card prints it, in party order. Each entry is
 * matched by id first, then by name (case and whitespace blind). A
 * person matched twice is listed once. No match prints the name with
 * known:false and every detail blank.
 *
 * \param party [{id, name}] (settings.trip.party)
 * \param people the directory
 * \return [{id, name, role, squeeze, medical, emergency, skills,
 *   skillsNote, known}]
 */
CsPeople.resolveParty = function(party, people) {
    var out = [];
    var list = Object.prototype.toString.call(party) === "[object Array]" ? party : [];
    var dir = Object.prototype.toString.call(people) === "[object Array]" ? people : [];
    var byId = {};
    var byName = {};
    for (var i = 0; i < dir.length; i++) {
        var d = dir[i];
        if (d === null || typeof d !== "object" || csPeopleTrim(d.name) === "") {
            continue;
        }
        var id = csPeopleTrim(d.id);
        if (id !== "" && byId["#" + id] === undefined) { byId["#" + id] = d; }
        var key = csPeopleKey(d.name);
        if (byName["#" + key] === undefined) { byName["#" + key] = d; }
    }
    var listed = {};
    for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (e === null || typeof e !== "object") { continue; }
        var name = csPeopleTrim(e.name);
        var eid = csPeopleTrim(e.id);
        var hit = (eid !== "" && byId["#" + eid] !== undefined) ? byId["#" + eid] :
            (name !== "" ? byName["#" + csPeopleKey(name)] : undefined);
        if (hit !== undefined) {
            var hid = csPeopleTrim(hit.id);
            if (listed["#" + hid] === true) { continue; }
            listed["#" + hid] = true;
            var sq = parseFloat(csPeopleStr(hit.squeeze));
            out.push({ id: hid, name: csPeopleTrim(hit.name), role: csPeopleStr(hit.role),
                squeeze: (isFinite(sq) && sq > 0) ? sq : null,
                medical: csPeopleStr(hit.medical), emergency: csPeopleStr(hit.emergency),
                skills: csPeopleSkills(hit.skills), skillsNote: csPeopleStr(hit.skillsNote),
                known: true });
        } else if (name !== "") {
            out.push({ id: eid, name: name, role: "", squeeze: null, medical: "",
                emergency: "", skills: [], skillsNote: "", known: false });
        }
    }
    return out;
};

/**
 * The party to save for the ticked people: id and name only, in
 * directory order.
 * \param goingIds [id]
 */
CsPeople.partyOf = function(people, goingIds) {
    var going = {};
    var ids = Object.prototype.toString.call(goingIds) === "[object Array]" ? goingIds : [];
    for (var i = 0; i < ids.length; i++) { going["#" + csPeopleTrim(ids[i])] = true; }
    var out = [];
    var dir = Object.prototype.toString.call(people) === "[object Array]" ? people : [];
    for (var k = 0; k < dir.length; k++) {
        var p = dir[k];
        if (p === null || typeof p !== "object") { continue; }
        var id = csPeopleTrim(p.id);
        if (id !== "" && going["#" + id] === true) {
            out.push({ id: id, name: csPeopleTrim(p.name) });
        }
    }
    return out;
};

// ---------------------------------------------------------------------
// The file (GUI engine only: QFile. Never called by pure code or tests.)
// ---------------------------------------------------------------------

/** people.json in CaveCAD's per-user data folder, or "" when unknown. */
CsPeople.path = function() {
    try {
        var dir = String(RSettings.getDataLocation()).replace(/[\\\/]+$/, "");
        return dir === "" ? "" : dir + "/" + CsPeople.FILE;
    } catch (e) {
        return "";
    }
};

/** The folder people.json lives in, or "". */
CsPeople.folder = function() {
    var p = CsPeople.path();
    return p === "" ? "" : p.slice(0, p.lastIndexOf("/"));
};

/** The file's text: {text, exists, error}. Never throws. */
var csPeopleReadFile = function(path) {
    try {
        var file = new QFile(path);
        if (!file.exists()) { return { text: "", exists: false, error: "" }; }
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return { text: "", exists: true,
                error: qsTr("people.json exists but could not be opened") };
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        var text = String(stream.readAll());
        file.close();
        return { text: text, exists: true, error: "" };
    } catch (e) {
        return { text: "", exists: true,
            error: qsTr("people.json could not be read") + " (" + e + ")" };
    }
};

/** \return {people, error} -- never throws; no file is an empty directory */
CsPeople.load = function() {
    var path = CsPeople.path();
    if (path === "") {
        return { people: [], error: qsTr("the per-user data folder is unknown") };
    }
    var got = csPeopleReadFile(path);
    if (got.error !== "") { return { people: [], error: got.error }; }
    return CsPeople.parse(got.text);
};

/**
 * Write the directory. Re-reads the file first: a people.json that is
 * there but will not parse is never overwritten (same rule as
 * stations.json), so this refuses until a person has fixed it. Writes a
 * temporary file beside it, then swaps it in.
 * \return "" when saved, else why not
 */
CsPeople.save = function(people) {
    var path = CsPeople.path();
    if (path === "") { return qsTr("the per-user data folder is unknown"); }
    var got = csPeopleReadFile(path);
    if (got.error !== "") { return got.error; }
    if (got.exists) {
        var check = CsPeople.parse(got.text);
        if (check.error !== "") {
            return qsTr("people.json is damaged, so it was not overwritten; " +
                "fix or move it (Show file)") + " (" + check.error + ")";
        }
    }
    var text = CsPeople.serialize(people);
    var tmp = path + ".tmp";
    try {
        try {
            (new QDir()).mkpath(CsPeople.folder());
        } catch (eDir) {
        }
        var file = new QFile(tmp);
        if (!file.open(QIODevice.WriteOnly | QIODevice.Truncate | QIODevice.Text)) {
            return qsTr("could not write people.json");
        }
        var stream = new QTextStream(file);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(text);
        stream.flush();
        file.close();
        if (got.exists && !QFile.remove(path)) {
            QFile.remove(tmp);
            return qsTr("could not replace people.json");
        }
        if (!file.rename(path)) {
            return qsTr("could not rename the new people.json into place; " +
                "it is saved as %1").arg(tmp);
        }
        return "";
    } catch (e) {
        return qsTr("could not write people.json") + " (" + e + ")";
    }
};
