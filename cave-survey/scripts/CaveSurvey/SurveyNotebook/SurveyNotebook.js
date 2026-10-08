// SurveyNotebook.js
//
// QCAD add-on tool: the Survey Notebook -- a docked panel laid out
// the way a cave survey NOTES PAGE is laid out. Stations run down the
// left with their LRUD beside them; each shot's tape/compass/clino
// (foresight AND backsight) sits on the line BETWEEN the two stations
// it connects, exactly where a hand would write it:
//
//   Station | Dist  Azm fs  Azm bs  Inc fs  Inc bs | L  R  U  D
//   A1      |                                      | 2  4  8  1
//           | 12.4   45.0   226.0    -3.0    +2.5  |
//   A2      |                                      | 3  3 12  0
//           | 18.1  112.5     --      1.5     --   |
//   A3      |                                      | ...
//
// Azimuth cells hold what the COMPASS read -- magnetic -- and the
// header's declination (typed, or IGRF-inferred) converts them to the
// true bearings the drawing uses. Editing the declination swings the
// whole survey on the next refresh or Draw.
//
// Backsights are optional; when present the shot is computed with the
// standard fs/bs correction (circular mean of foresight and reversed
// backsight) and a disagreement over 3 degrees is flagged beside the
// running stats. LRUD belongs to the station it is written beside;
// the first station's LRUD rides along as the survey's start LRUD.
//
// [+ Station] grows the page as the survey expands; totals, loop
// closures, the honest grade and any warnings update as you type.
// Draw plots the survey in ONE undo step. Import fills the page from
// any supported file; Export writes Compass/Walls/Survex/Therion/CSV.
//
// BRANCHES AND SPLAYS live on the ladder too -- there is no other
// mode, and the conventions are the paper ones. A BLANK station line
// is a separator: the chain breaks, and the next named line
// re-anchors it -- write an earlier station's name again and the
// shots after it branch from there. A station named <anchor>.<n>
// (A3.1, A3.2 while the chain stands at A3) is a SPLAY: azimuth and
// distance to a wall, no new station, chain stays at the anchor
// ("-" and ".." mean the same anonymously, the Survex way). Imports
// write these shapes automatically, so any file the suite reads
// lands on the page.
//
// THE PAGE IS ALSO THE REVISION UI. Load Drawing reconstructs the
// survey already drawn (CsRevise.surveyFromDocument, exact tag schema
// v3), asks which trip when there are several -- one page = ONE trip
// -- and fills the header and ladder from it, azimuths converted back
// to magnetic by stripping that trip's declination. Edit the shots
// and press Draw: when a trip with the same fingerprint (date |
// team, see CsModel.tripFingerprint) already exists in
// the drawing, the page's shots REPLACE that trip inside the full
// merged survey -- everything is erased by station name and the whole
// merged survey redraws once, so junctions with other trips stay
// consistent. No fingerprint match appends the page as a new trip.
// A drawing with no (or only legacy pre-v3) survey data draws exactly
// the way it always did: plain draw, trip 0.
//
// THE PAGE ALSO ANCHORS THE DRAWING. When Infer has to ASK where the
// cave is, it offers to keep that latitude/longitude as the drawing's
// geo anchor (GeoLat/GeoLon/GeoStation on one station point) -- the
// drawing's one tie to real-world coordinates, which aerial imagery
// aligns to, revisions pivot on, and exports derive from. Never
// without asking, and never on top of an anchor that already exists.
// See offerGeoAnchor. And once an anchor IS stored, the drawing's own
// trips get checked against IGRF for their dates at that location: any
// trip more than half a degree off is offered a revision on the spot,
// unasked, because a user who doesn't know their 1998 declination was
// wrong can't go looking for it. See offerIgrfTripRevisions.
//
// DECLINATION... revises the drawing's trips WITHOUT loading them: one
// row per trip, the recorded value beside an editable one, IGRF on tap
// from the drawing's own geo reference, and one CsRevise.apply that
// rotates the shots and logs the change. That is the corrective path;
// the header's Decl field is only what the page's own readings were
// taken under. The two are compared in full above tripDeclinationDialog.
//
// LINEWORK... is where hand-drawn work is tied to the trip it was
// traced against -- and it happens BY ITSELF. Nothing needs arming:
// every revision claims the untagged linework it can recognise first
// (CsBind.planAutoBind, against the stations as they were BEFORE the
// revision) and moves it with everything else, and the trip comes from
// the stations the tracing binds to rather than from whatever the page
// happens to be showing. This entry exists to SAY that, to switch it
// off for anyone who does not want tags written onto their own
// geometry, and to adopt linework early with a preview of what binds to
// what. See CsBind.
//
// The dock is a singleton; the engine stays alive, so a global
// holds it.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/TripEdit.js");

var csNotebookDock = csNotebookDock || undefined;

function SurveyNotebook(guiAction) {
    EAction.call(this, guiAction);
}

SurveyNotebook.prototype = new EAction();

/** Connects a signal, reporting rather than dying when absent. */
SurveyNotebook.safeConnect = function(signal, fn, what, problems) {
    try {
        signal.connect(fn);
        return true;
    } catch (e) {
        problems.push(what + " (" + e + ")");
        return false;
    }
};

// ---------------------------------------------------------------------
// Ladder <-> model
// ---------------------------------------------------------------------

/** Numeric cell: "" -> null, junk -> null, number -> number. */
SurveyNotebook.cellNumber = function(edit) {
    var v = String(edit.text).replace(/^\s+|\s+$/g, "");
    if (v === "" || v === "--") {
        return null;
    }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
};

/** Reads the whole panel into a CsModel survey. */
SurveyNotebook.sheetSurvey = function(w) {
    var survey = CsModel.newSurvey();
    survey.name = String(w.nameEdit.text);
    survey.date = String(w.dateEdit.text);
    survey.team = String(w.teamEdit.text);
    survey.instruments = String(w.instrEdit.text);
    survey.declination = parseFloat(w.declEdit.text) || 0.0;
    survey.declinationSource = w.declSource;
    survey.distanceUnit = w.unit;

    var num = SurveyNotebook.cellNumber;
    var rows = w.rows;

    // The page reads like paper notes:
    //   - a BLANK station line is a separator: the chain is broken,
    //     and the next named line RE-ANCHORS it -- write an earlier
    //     station's name again and the following shots branch from it
    //     (that line declares a station; its measurements are ignored)
    //   - a station named <anchor>.<digits> (A3.1, A3.2 while the
    //     chain stands at A3) is a SPLAY: azimuth+distance to a wall,
    //     no new station, and the chain stays at the anchor ("-" and
    //     ".." mean the same, anonymously)
    //   - anything else is the next station in the chain
    var lastStation = "";
    var pendingAnchor = true; // page start, and after every blank line
    var startCaptured = false;
    for (var i = 0; i < rows.length; i++) {
        var name = String(rows[i].name.text).replace(/^\s+|\s+$/g, "");
        if (name === "") {
            pendingAnchor = true;
            continue;
        }
        if (pendingAnchor) {
            lastStation = name;
            pendingAnchor = false;
            if (!startCaptured) {
                startCaptured = true;
                var s0L = CsModel.parseLrudEntry(rows[i].l.text);
                var s0R = CsModel.parseLrudEntry(rows[i].r.text);
                var s0U = CsModel.parseLrudEntry(rows[i].u.text);
                var s0D = CsModel.parseLrudEntry(rows[i].d.text);
                if (s0L.value !== null || s0R.value !== null ||
                    s0U.value !== null || s0D.value !== null ||
                    s0L.open || s0R.open || s0U.open || s0D.open) {
                    survey.startLrud = {
                        left: s0L.value, right: s0R.value,
                        up: s0U.value, down: s0D.value,
                        leftAll: s0L.all, rightAll: s0R.all,
                        upAll: s0U.all, downAll: s0D.all,
                        leftOpen: s0L.open, rightOpen: s0R.open,
                        upOpen: s0U.open, downOpen: s0D.open
                    };
                }
                survey.startNote = String(rows[i].notes.toPlainText())
                    .replace(/^\s+|\s+$/g, "");
            }
            continue;
        }
        var splay = (name === "-" || name === ".." ||
            (name.length > lastStation.length + 1 &&
             name.indexOf(lastStation + ".") === 0 &&
             /^\d+$/.test(name.substring(lastStation.length + 1))));
        var to = splay ? "" : name;
        var dist = num(rows[i].dist);
        var shot = CsModel.newShot();
        shot.from = lastStation;
        shot.to = to;
        shot.splay = splay;
        shot.distance = dist === null ? 0.0 : dist;
        // The page records what the COMPASS said (magnetic); the
        // header's declination converts to the true bearings the
        // model stores. Change the declination and the whole survey
        // swings on the next refresh/Draw -- as it should.
        var az = num(rows[i].az);
        shot.azimuth = az === null ? 0.0 :
            CsAngles.applyDeclination(az, survey.declination);
        var inc = num(rows[i].inc);
        shot.inclination = inc === null ? 0.0 : inc;
        // backsights live in the scanned notes, not on this page
        // LRUD cells speak notes shorthand: "0" = wall at the station,
        // "P" = open passage (no wall that way -- NOT the same as
        // "0"), "5/10" = both readings (both are drawn; the larger is
        // the wall). See CsModel.parseLrudEntry.
        var eL = CsModel.parseLrudEntry(rows[i].l.text);
        var eR = CsModel.parseLrudEntry(rows[i].r.text);
        var eU = CsModel.parseLrudEntry(rows[i].u.text);
        var eD = CsModel.parseLrudEntry(rows[i].d.text);
        shot.left = eL.value; shot.leftAll = eL.all; shot.leftOpen = eL.open;
        shot.right = eR.value; shot.rightAll = eR.all; shot.rightOpen = eR.open;
        shot.up = eU.value; shot.upAll = eU.all; shot.upOpen = eU.open;
        shot.down = eD.value; shot.downAll = eD.all; shot.downOpen = eD.open;
        shot.notes = String(rows[i].notes.toPlainText()).replace(/^\s+|\s+$/g, "");
        survey.shots.push(shot);
        if (!splay) {
            lastStation = name;
        }
    }
    return survey;
};

/** Fills the panel from a survey -- any survey: chains fill straight
 *  down; a branch gets a blank separator line and its origin station
 *  re-written as the new anchor; splays land as <anchor>.<n> rows. */
SurveyNotebook.setSurvey = function(w, survey) {
    // Nothing to drop here any more. Refilling the page used to have to
    // disarm linework binding, because the page's trip WAS the trip
    // strokes got tagged to; now the trip is read off the stations a
    // tracing binds to, so which trip this page is showing has no
    // bearing on it.
    w.loading = true;
    // A page refilled from anywhere is no longer a revision of a
    // particular trip -- loadFromDrawing re-sets this immediately
    // afterwards, and nothing else does.
    w.loadedTripId = null;
    w.nameEdit.text = survey.name;
    w.dateEdit.text = survey.date;
    w.teamEdit.text = survey.team;
    w.instrEdit.text = survey.instruments || "";
    w.declEdit.text = String(survey.declination || 0);
    w.declSource = survey.declinationSource || "user";
    w.unit = survey.distanceUnit;

    // rebuild the ladder rows, one per shot, in the file's own order
    SurveyNotebook.clearLadder(w);
    var put = function(edit, v) {
        edit.text = (v === null || v === undefined) ? "" : String(v);
    };

    if (survey.shots.length === 0) {
        var only = SurveyNotebook.addStationRow(w, "A1");
        only.notes.setPlainText(survey.startNote === undefined ||
            survey.startNote === null ? "" : String(survey.startNote));
        w.loading = false;
        SurveyNotebook.refresh(w);
        return;
    }

    // first row: the start station, carrying the survey's start LRUD
    var first = SurveyNotebook.addStationRow(w, survey.shots[0].from);
    if (survey.startLrud) {
        var sl0 = survey.startLrud;
        // Through lrudEntryText, not a raw put of the number: a "P"
        // side has value:null and would otherwise redisplay as a
        // blank cell, silently forgetting that it was ever open
        // passage rather than simply unmeasured.
        put(first.l, CsModel.lrudEntryText(sl0.left, sl0.leftAll, sl0.leftOpen));
        put(first.r, CsModel.lrudEntryText(sl0.right, sl0.rightAll, sl0.rightOpen));
        put(first.u, CsModel.lrudEntryText(sl0.up, sl0.upAll, sl0.upOpen));
        put(first.d, CsModel.lrudEntryText(sl0.down, sl0.downAll, sl0.downOpen));
    }
    first.notes.setPlainText(survey.startNote === undefined ||
        survey.startNote === null ? "" : String(survey.startNote));

    var lastStation = survey.shots[0].from;
    var splayCounts = {};
    for (var i = 0; i < survey.shots.length; i++) {
        var shot = survey.shots[i];
        // a shot leaving the chain: blank separator line, then the
        // origin station re-written as the new anchor -- paper-style
        if (shot.from !== lastStation) {
            SurveyNotebook.addStationRow(w, "");
            SurveyNotebook.addStationRow(w, shot.from);
            lastStation = shot.from;
        }
        var rowName;
        if (shot.splay) {
            splayCounts[shot.from] = (splayCounts[shot.from] || 0) + 1;
            rowName = shot.from + "." + splayCounts[shot.from];
        } else {
            rowName = shot.to;
        }
        var row = SurveyNotebook.addStationRow(w, rowName);
        put(row.dist, shot.distance);
        // cells hold compass readings: strip the declination the
        // model has applied, so round-trips never double-correct
        put(row.az, CsAngles.normalizeAzimuth(
            shot.azimuth - (survey.declination || 0)).toFixed(2));
        put(row.inc, shot.inclination);
        put(row.l, CsModel.lrudEntryText(shot.left, shot.leftAll, shot.leftOpen));
        put(row.r, CsModel.lrudEntryText(shot.right, shot.rightAll, shot.rightOpen));
        put(row.u, CsModel.lrudEntryText(shot.up, shot.upAll, shot.upOpen));
        put(row.d, CsModel.lrudEntryText(shot.down, shot.downAll, shot.downOpen));
        row.notes.setPlainText(shot.notes === undefined ||
            shot.notes === null ? "" : String(shot.notes));
        if (!shot.splay && shot.to !== "") {
            lastStation = shot.to;
        }
    }
    w.loading = false;
    SurveyNotebook.refresh(w);
};

// ---------------------------------------------------------------------
// Ladder construction
// ---------------------------------------------------------------------

SurveyNotebook.EDIT_WIDTH = 64;   // measurement cells

/** The objectName every ladder cell wears, so the focus listener can
 *  tell a cell from any other widget that takes focus. */
SurveyNotebook.CELL_NAME = "CaveSurveyNotebookCell";
SurveyNotebook.CELL_HEIGHT = 30;  // uniform input height
SurveyNotebook.FONT_SIZE = 14;    // readable at arm's length

/** Applies the page's font and height to an input widget. Resizes
 *  the widget's OWN font -- constructing QFont with an empty family
 *  yields an invalid font and garbles rendering. */
SurveyNotebook.styleCell = function(e, height) {
    try {
        var f = e.font;
        f.setPointSize(SurveyNotebook.FONT_SIZE);
        e.font = f;
    } catch (eF) {
        // font stays at default
    }
    e.minimumHeight = height || SurveyNotebook.CELL_HEIGHT;
    if (height === undefined) {
        e.maximumHeight = SurveyNotebook.CELL_HEIGHT;
    }
    return e;
};

/**
 * Makes an edit record in ALL CAPS as you type, the way a notes page
 * is written. textEdited fires only on user edits, so writing the
 * uppercased text back cannot loop; the cursor stays put.
 */
SurveyNotebook.upperCase = function(w, edit) {
    SurveyNotebook.safeConnect(edit.textEdited, function() {
        var t = String(edit.text);
        var u = t.toUpperCase();
        if (u !== t) {
            var pos = edit.cursorPosition;
            edit.text = u;
            try {
                edit.cursorPosition = pos;
            } catch (e) {
                // cursor jump to end -- cosmetic
            }
        }
    }, "caps", w.problems);
    return edit;
};

/**
 * Same ALL CAPS rule for a QPlainTextEdit (the notes boxes).
 * QPlainTextEdit has no textEdited, only textChanged -- which also
 * fires on the programmatic write-back, so the no-change early return
 * is what breaks the loop.
 */
SurveyNotebook.upperCasePlain = function(w, edit) {
    SurveyNotebook.safeConnect(edit.textChanged, function() {
        var t = String(edit.toPlainText());
        var u = t.toUpperCase();
        if (u === t) {
            return;
        }
        try {
            var cur = edit.textCursor();
            var pos = cur.position();
            edit.setPlainText(u);
            var back = edit.textCursor();
            back.setPosition(Math.min(pos, u.length));
            edit.setTextCursor(back);
        } catch (e) {
            // bridge without a workable QTextCursor: caps still land,
            // the cursor jump to the end is cosmetic
            edit.setPlainText(u);
        }
    }, "caps", w.problems);
    return edit;
};

/**
 * A small, flat button for the action row -- QToolButton with autoRaise,
 * so it reads as secondary beside the full-size Draw and New Trip and
 * takes about half the width of a QPushButton carrying the same word.
 *
 * The action row sets this dock's minimum width, and that width is map
 * space, so every full-size button in it has to earn its place.
 */
SurveyNotebook.smallButton = function(text, toolTip) {
    var b = new QToolButton();
    b.text = text;
    if (toolTip !== undefined && toolTip !== null && toolTip !== "") {
        b.toolTip = toolTip;
    }
    try {
        b.autoRaise = true;
    } catch (eRaise) {
        // a bridge without autoRaise gets an ordinary-looking button
    }
    try {
        // 2 = Qt::ToolButtonTextOnly. These carry no icon, and the
        // default style leaves room for one.
        b.toolButtonStyle = 2;
    } catch (eStyle) {
    }
    return b;
};

SurveyNotebook.makeCell = function(w, width) {
    var e = SurveyNotebook.styleCell(new QLineEdit());
    e.maximumWidth = width || SurveyNotebook.EDIT_WIDTH;
    e.minimumWidth = width || SurveyNotebook.EDIT_WIDTH;
    // NAMED SO THE PAGE CAN FOLLOW THE CURSOR. Tabbing down a long
    // ladder walked the focus off the bottom of the scroll area and
    // the view stayed where it was: the caver was typing into a cell
    // they could not see, which is exactly how a reading lands in the
    // wrong column. The focus listener scrolls to any widget wearing
    // this name -- see CELL_NAME's use in the focusChanged wiring.
    try {
        e.objectName = SurveyNotebook.CELL_NAME;
    } catch (eName) {
        // no objectName on this bridge: the cell still works, the
        // page simply will not follow it
    }
    SurveyNotebook.safeConnect(e.textEdited, function() {
        SurveyNotebook.refresh(w);
    }, "cell refresh", w.problems);
    return e;
};

/**
 * Appends one station to the page: a shot line (unless it is the
 * first station) then the station line, paper-style. Returns the row
 * record {name, dist, az, inc, l, r, u, d, notes}; the first
 * station's shot edits exist but stay hidden, so every record has
 * the same shape.
 */
SurveyNotebook.addStationRow = function(w, stationName) {
    var grid = w.grid;
    var row = {
        name: SurveyNotebook.upperCase(w, SurveyNotebook.makeCell(w, 84)),
        dist: SurveyNotebook.makeCell(w),
        az: SurveyNotebook.makeCell(w, 72),
        inc: SurveyNotebook.makeCell(w, 72),
        l: SurveyNotebook.makeCell(w, 48),
        r: SurveyNotebook.makeCell(w, 48),
        u: SurveyNotebook.makeCell(w, 48),
        d: SurveyNotebook.makeCell(w, 48),
        notes: SurveyNotebook.upperCasePlain(w, new QPlainTextEdit()),
        widgets: []
    };
    row.name.toolTip = "Station name. Blank line = separator: the " +
        "next named line re-anchors the chain (write an earlier " +
        "station to branch from it). <station>.<n> (A3.1) = splay " +
        "shot off the current station: azimuth + distance to a wall.";
    // Notes are INTENTIONAL: click to write one. ClickFocus keeps Tab
    // from ever landing here, so flying through measurements skips the
    // box -- but once you're IN a note, Tab moves on to the next
    // station's name (tabChangesFocus), or grows the page via the "+"
    // catcher when this is the last station. A small multiline box,
    // tall enough to actually read.
    SurveyNotebook.styleCell(row.notes, 48);
    try {
        row.notes.objectName = SurveyNotebook.CELL_NAME;
    } catch (eNoteName) {
    }
    row.notes.minimumWidth = 170;
    row.notes.maximumHeight = 48;
    try {
        row.notes.focusPolicy = Qt.ClickFocus;
    } catch (eFp) {
        // policy unsupported: it stays out of the setTabOrder chain
        // regardless, which covers the common path
    }
    try {
        row.notes.tabChangesFocus = true;
    } catch (eTc) {
        // older bridge: Tab keeps inserting a tab character here
    }
    row.notes.placeholderText = "note...";
    row.notes.toolTip = "Station note -- stored with the survey data " +
        "(and exported as the shot's comment). Click to edit; Tab " +
        "moves on to the next station.";
    SurveyNotebook.safeConnect(row.notes.textChanged, function() {
        SurveyNotebook.refresh(w);
    }, "note refresh", w.problems);
    row.name.text = stationName || "";

    var isFirst = (w.rows.length === 0);

    // the shot line, written between the previous station and this one
    if (!isFirst) {
        var shotRow = w.gridRow++;
        grid.addWidget(row.dist, shotRow, 1);
        grid.addWidget(row.az, shotRow, 2);
        grid.addWidget(row.inc, shotRow, 3);
        row.widgets.push(row.dist, row.az, row.inc);
    } else {
        row.dist.visible = false;
        row.az.visible = false;
        row.inc.visible = false;
    }

    // the station line: name on the left, LRUD on the right
    var stRow = w.gridRow++;
    grid.addWidget(row.name, stRow, 0);
    grid.addWidget(row.l, stRow, 4);
    grid.addWidget(row.r, stRow, 5);
    grid.addWidget(row.u, stRow, 6);
    grid.addWidget(row.d, stRow, 7);
    // one grid cell: the box's own height makes the station line
    // taller, which keeps it aligned with its row (a 2-row span put
    // the LAST station's note into the stretchy slack row and sent
    // it drifting down the panel)
    grid.addWidget(row.notes, stRow, 8);
    row.widgets.push(row.name, row.l, row.r, row.u, row.d, row.notes);

    // Pin the page to the TOP of the scroll area: all the vertical
    // slack lives in ONE stretchy empty row below the last station,
    // tracked explicitly -- the previous stretch row gets reused by
    // the next station's widgets, so its stretch must be cleared or
    // the slack lands mid-page (header at top, new rows at bottom).
    try {
        if (w.stretchRow !== undefined) {
            grid.setRowStretch(w.stretchRow, 0);
        }
        w.stretchRow = w.gridRow;
        grid.setRowStretch(w.stretchRow, 1);
    } catch (e) {
        // older bridge without setRowStretch: cosmetic only
    }

    w.rows.push(row);
    SurveyNotebook.applyTabOrder(w);
    return row;
};

/** Removes the last station line (and its shot line) from the page. */
SurveyNotebook.removeLastStation = function(w) {
    if (w.rows.length <= 1) {
        return; // a page keeps at least its first station
    }
    var row = w.rows.pop();
    for (var i = 0; i < row.widgets.length; i++) {
        row.widgets[i].visible = false; // grid rows can't be removed
    }
    SurveyNotebook.applyTabOrder(w);
    SurveyNotebook.refresh(w);
};

/**
 * Tab order follows the ORDER OF TAKING READINGS, not the layout:
 * from a station, Tab goes to the shot's measurements (dist, azm
 * fs/bs, inc fs/bs), then to the NEW station's name, then that
 * station's LRUD -- because you measure the passage where you just
 * arrived -- then on down the page. The first station's LRUD (no
 * incoming shot) comes at the very end of the chain.
 */
SurveyNotebook.applyTabOrder = function(w) {
    var rows = w.rows;
    if (rows.length === 0) {
        return;
    }
    // Station name, the shot's measurements, then the LRUD of the
    // station you are LEAVING, then down the page: name, shot, that
    // station's LRUD, ... The last station's LRUD closes the chain.
    // First segment: both names, the shot, then BOTH stations' LRUD
    // (the start station's has no other home). Every later segment:
    // name, shot, then only the NEW station's LRUD -- the previous
    // station's was filled last cycle and is never revisited.
    // Each station's NOTE sits in the chain directly before the next
    // station's name. Normal traversal skips it (ClickFocus widgets are
    // never tabbed INTO), so the measurement flow is untouched -- but
    // Tab pressed INSIDE a note (tabChangesFocus) leaves for the next
    // thing in the chain: the next station's name, or the "+" catcher
    // after the last station, which grows the page like tabbing off
    // the last D does.
    // THE HEADER IS THE TOP OF THE CHAIN. A trip is written from the
    // top of the page down -- objective, date, team, declination,
    // instruments -- and then the shots. Tab off Instr used to leave
    // the panel for whatever the layout happened to hold next, with
    // nothing visibly focused: the caver's typing went nowhere and the
    // only way back into the ladder was the mouse. Instr now hands
    // over to the first station's name, which is the next thing
    // written on the paper page too.
    //
    // The header fields are only chained when they EXIST: this runs
    // from addStationRow, which the panel may call while it is still
    // being built.
    var order = [];
    var header = [w.nameEdit, w.dateEdit, w.teamEdit, w.declEdit,
                  w.instrEdit];
    for (var h = 0; h < header.length; h++) {
        if (header[h] !== null && header[h] !== undefined) {
            order.push(header[h]);
        }
    }
    order.push(rows[0].name);
    if (rows.length > 1) {
        var r1 = rows[1];
        order.push(rows[0].notes,
            r1.name, r1.dist, r1.az, r1.inc,
            rows[0].l, rows[0].r, rows[0].u, rows[0].d,
            r1.l, r1.r, r1.u, r1.d);
    }
    for (var i = 2; i < rows.length; i++) {
        var r = rows[i];
        order.push(rows[i - 1].notes,
            r.name, r.dist, r.az, r.inc,
            r.l, r.r, r.u, r.d);
    }
    order.push(rows[rows.length - 1].notes);
    if (w.sentinel !== undefined) {
        order.push(w.sentinel);
    }
    try {
        for (var k = 1; k < order.length; k++) {
            QWidget.setTabOrder(order[k - 1], order[k]);
        }
    } catch (e) {
        // older bridge without setTabOrder: keep default order
    }
};

/**
 * Scrolls the notes page so a cell that has just taken focus is on it.
 *
 * ensureWidgetVisible takes MARGINS, and they are what makes this
 * useful rather than merely correct: with none, a cell tabbed into
 * from below lands flush against the bottom edge with the next row --
 * the one about to be typed -- still hidden, so every Tab scrolls by
 * exactly one row and the page never gets ahead of the caver. A
 * row-and-a-bit of margin keeps what comes next in view.
 *
 * Silent on failure in every direction: no scroll area yet, a bridge
 * without ensureWidgetVisible, a widget whose C++ side has gone. None
 * of them is a reason to interrupt somebody typing.
 */
SurveyNotebook.followFocus = function(w, widget) {
    if (w === null || w === undefined || widget === null ||
            widget === undefined) {
        return;
    }
    if (w.ladderArea === null || w.ladderArea === undefined) {
        return;
    }
    try {
        w.ladderArea.ensureWidgetVisible(widget, 24,
            SurveyNotebook.FOLLOW_MARGIN);
    } catch (eScroll) {
    }
};

/** How much of the page to keep visible below a focused cell, in
 *  pixels -- about a station line and a shot line. */
SurveyNotebook.FOLLOW_MARGIN = 56;

/**
 * Tab off the last station's D and the page GROWS: focus landing on
 * the small "+" catcher adds the next station (name pre-incremented)
 * and moves focus into it, so continuous entry never needs the mouse.
 */
SurveyNotebook.autoAddStation = function(w) {
    var prevName = w.rows.length > 0 ?
        String(w.rows[w.rows.length - 1].name.text) : "";
    var row = SurveyNotebook.addStationRow(w,
        CsModel.nextStationName(prevName));
    try {
        row.name.setFocus();
    } catch (e) {
        // focus is a nicety
    }
    // a station added below the fold is scrolled into view -- its D
    // is the farthest-right, lowest thing the user is about to need
    try {
        w.ladderArea.ensureWidgetVisible(row.d);
    } catch (e2) {
        // scrolling is a nicety too
    }
    SurveyNotebook.refresh(w);
};

/** Hides every ladder row (rebuild path for imports). */
SurveyNotebook.clearLadder = function(w) {
    for (var i = 0; i < w.rows.length; i++) {
        for (var k = 0; k < w.rows[i].widgets.length; k++) {
            w.rows[i].widgets[k].visible = false;
        }
    }
    w.rows = [];
};

// ---------------------------------------------------------------------
// Live feedback
// ---------------------------------------------------------------------

SurveyNotebook.refresh = function(w) {
    if (w.loading) {
        return;
    }
    var bindLine = SurveyNotebook.autoBindStatusLine(w);
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        w.statusLabel.setPlainText(
            (bindLine !== "" ? bindLine + "\n\n" : "") +
            "No shots yet. Shots are written " +
            "between the stations they connect; azimuth clockwise from " +
            "north, distance along the tape, backsights optional. LRUD " +
            "sits beside its station.");
        // A page emptied back to nothing takes its ghost with it.
        SurveyNotebook.clearGhost();
        return;
    }
    // THE PAGE, DRAWN. Every keystroke already recomputes the survey
    // for the status line; this puts the same answer on the map.
    SurveyNotebook.ghostSoon(w);
    // The status line has to describe what Draw would PRODUCE, so it
    // resolves-and-adjusts under the current settings -- the same
    // options Draw itself will take for this page. (Loop errors printed
    // below stay as-surveyed either way: CsAdjust copies them through
    // untouched.)
    var resolved = CsAdjust.resolveAndAdjust(survey, {});
    var findings = CsValidate.check(survey, resolved);
    var stats = CsStats.compute(survey, resolved, CsTraverse.SLOPE);
    var grade = CsGrade.compute(survey, resolved, stats);

    var lines = [];
    if (bindLine !== "") {
        lines.push(bindLine);
    }
    lines.push("Length " + CsReport.length(stats.surveyedLength, w.unit) +
        "   Depth " + CsReport.length(stats.depth, w.unit) +
        "   Stations " + stats.stationCount +
        "   Grade " + grade.uis);
    for (var i = 0; i < resolved.loops.length; i++) {
        var loop = resolved.loops[i];
        lines.push("Loop " + loop.from + " to " + loop.to + ": " +
            loop.error.toFixed(2) + " over " + loop.traverseLength.toFixed(1) +
            " (" + loop.percent.toFixed(2) + "%)");
    }
    var shown = 0;
    for (i = 0; i < findings.length && shown < 4; i++) {
        lines.push(findings[i].severity.toUpperCase() + ": " +
            findings[i].message);
        shown++;
    }
    if (findings.length > shown) {
        lines.push("(" + (findings.length - shown) + " more -- see Draw's report)");
    }
    w.statusLabel.setPlainText(lines.join("\n"));
};

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

// The picked point's own elevation used to be re-queried here, in a
// SurveyNotebook.selectionElevation that returned 0 for "no Elevation
// tag". It is now `sel.elevation` on the object CsPick already builds
// from that same entity -- null when the drawing records none, because
// an explicit anchor z of 0 beats a *fix and rebases an
// absolute-datum cave to sea level. Import Cave Survey needed the same
// answer, and two readers of one tag are two readers that drift.

SurveyNotebook.drawSurvey = function(w, forceFull) {
    // THE GHOST COMES OFF FIRST. Draw is about to put the real thing
    // where the ghost is, and a preview left on top of its own result
    // is a set of doubled lines the caver has to work out the meaning
    // of. It comes back on the next keystroke, over the drawn survey,
    // which is exactly what it should show then: no difference.
    SurveyNotebook.clearGhost();
    // Any failure in here must be SEEN, not swallowed by the engine.
    try {
        SurveyNotebook.drawSurveyInner(w, forceFull === true);
    } catch (e) {
        QMessageBox.warning(null, "Survey Notebook",
            "Draw failed inside this build's bridge:\n\n" + e +
            "\n\n" + (e.stack ? String(e.stack).substring(0, 600) : "") +
            "\n\nPlease report this text.");
    }
};

/**
 * Where a page lands when the drawing has no v3 survey to merge with.
 *
 * LIFTED OUT OF Draw SO THE PREVIEW CAN ASK THE SAME QUESTION. The
 * ghost drawn while a caver types has to appear where Draw is going to
 * put the shots, and the only way to promise that is for both to run
 * this one function. A preview that decided its own anchor would be
 * wrong in exactly the case somebody is watching it for -- a page that
 * ties into an existing station.
 *
 * \return {anchor, tieIn} -- anchor undefined when the page floats
 *         free (nothing selected, first station unknown to the
 *         drawing), tieIn the station name when it tied into one.
 */
/**
 * The page as Draw would resolve it, WITHOUT touching the drawing.
 *
 * Runs the same branch Draw runs -- merge into the reconstructed cave
 * when the drawing holds v3 survey data, plain anchored resolve
 * otherwise -- through the same two plan functions, and stops at the
 * resolve. Nothing is erased, nothing is added, no tag is read that
 * Draw does not read.
 *
 * \return {survey, resolved, merged} or null when there is nothing to
 *         preview (no document, no shots, a sheet file).
 */
// ---------------------------------------------------------------------
// THE GHOST -- the page, drawn over the map, before Draw draws it.
// ---------------------------------------------------------------------
//
// A caver typing a trip in from a wet notebook is checking that they
// typed it right, and the status line's numbers are a poor way to do
// that: a transposed azimuth is a plausible bearing and a metric
// distance on a page of feet is a plausible distance. Both are obvious
// the moment the passage is drawn. So the page is drawn continuously,
// as preview shapes on the view -- and Draw stays the only thing that
// writes an entity.
//
// NOTHING HERE TOUCHES THE DOCUMENT. addShapeToPreview paints into the
// view's preview layer: no entity, no undo step, no modified flag, and
// gone the moment the preview is cleared. A drawing that has been
// previewed at is byte-identical to one that has not.

/** How the three kinds of ghost line are drawn. */
SurveyNotebook.GHOST_LEG = new RColor(255, 170, 0);
SurveyNotebook.GHOST_WALL = new RColor(140, 190, 255);
SurveyNotebook.GHOST_RAW = new RColor(150, 150, 150);

/**
 * Repaints the ghost from whatever is on the page right now.
 *
 * SILENT IN EVERY FAILURE DIRECTION. This runs on a keystroke, behind
 * somebody typing numbers: a bridge with no preview API, a page that
 * will not resolve, a document that went away between the keystroke
 * and the timer -- none of them is worth a message, and all of them
 * simply leave the view as it was.
 */
SurveyNotebook.showGhost = function(w) {
    if (isNull(w) || w.ghostOn === false) {
        return;
    }
    var di = getDocumentInterface();
    if (isNull(di) || typeof di.addShapeToPreview !== "function") {
        return;
    }
    var plan = null;
    try {
        plan = SurveyNotebook.previewPlan(w);
    } catch (ePlan) {
        plan = null;
    }
    var segs = null;
    if (plan !== null) {
        try {
            segs = CsGhost.segments(plan.survey, plan.resolved,
                { focus: plan.focus });
        } catch (eSeg) {
            segs = null;
        }
    }
    try {
        di.clearPreview();
        if (segs === null || CsGhost.isEmpty(segs)) {
            di.repaintViews();
            return;
        }
        di.beginPreview();
        var brush = new QBrush();
        var lw = RLineweight.Weight000;
        var paint = function(runs, color, style, dashes) {
            for (var i = 0; i < runs.length; i++) {
                var pts = runs[i];
                for (var p = 1; p < pts.length; p++) {
                    var line = new RLine(
                        new RVector(pts[p - 1].x, pts[p - 1].y),
                        new RVector(pts[p].x, pts[p].y));
                    di.addShapeToPreview(line, color, brush, lw,
                        style, dashes);
                }
            }
        };
        // AS-SURVEYED FIRST, so the adjusted line is drawn over it
        // rather than under: the adjusted one is where the shots are
        // going, and it is the one to read when they overlap.
        paint(segs.raw, SurveyNotebook.GHOST_RAW,
            Qt.CustomDashLine.valueOf(), [4, 4]);
        paint(segs.walls, SurveyNotebook.GHOST_WALL,
            Qt.CustomDashLine.valueOf(), [6, 3]);
        paint(segs.splays, SurveyNotebook.GHOST_WALL,
            Qt.CustomDashLine.valueOf(), [2, 3]);
        paint(segs.legs, SurveyNotebook.GHOST_LEG,
            Qt.SolidLine.valueOf(), []);
        // A CROSS ON EACH STATION, the size of the text the map uses,
        // so a station with no shot off it yet still shows somewhere.
        var tick = CsDraw.TEXT_HEIGHT * 0.5;
        for (var s = 0; s < segs.stations.length; s++) {
            var st = segs.stations[s];
            var h = new RLine(new RVector(st.x - tick, st.y),
                              new RVector(st.x + tick, st.y));
            var v = new RLine(new RVector(st.x, st.y - tick),
                              new RVector(st.x, st.y + tick));
            di.addShapeToPreview(h, SurveyNotebook.GHOST_LEG, brush, lw,
                Qt.SolidLine.valueOf(), []);
            di.addShapeToPreview(v, SurveyNotebook.GHOST_LEG, brush, lw,
                Qt.SolidLine.valueOf(), []);
        }
        di.endPreview();
        di.repaintViews();
    } catch (ePaint) {
        // A half-painted ghost is worse than none.
        try {
            di.clearPreview();
            di.repaintViews();
        } catch (eClear) {
        }
    }
};

/** Takes the ghost off the view. Called when the panel closes, when
 *  Draw commits (the real thing is there now), and when the page
 *  empties. */
SurveyNotebook.clearGhost = function() {
    var di = getDocumentInterface();
    if (isNull(di) || typeof di.clearPreview !== "function") {
        return;
    }
    try {
        di.clearPreview();
        di.repaintViews();
    } catch (e) {
    }
};

/**
 * Asks for a repaint shortly.
 *
 * COALESCED, because refresh() runs on every keystroke and a caver
 * types faster than a cave resolves. The timer restarts on each call,
 * so a burst of typing paints once at the end of it rather than once
 * per character -- and the pause is short enough that it reads as
 * live.
 */
SurveyNotebook.GHOST_DELAY = 150;

SurveyNotebook.ghostSoon = function(w) {
    if (isNull(w) || w.ghostOn === false) {
        return;
    }
    try {
        if (isNull(w.ghostTimer)) {
            w.ghostTimer = new QTimer(w.statusLabel);
            w.ghostTimer.singleShot = true;
            w.ghostTimer.timeout.connect(function() {
                SurveyNotebook.showGhost(w);
            });
        }
        w.ghostTimer.start(SurveyNotebook.GHOST_DELAY);
    } catch (eTimer) {
        // No timer on this bridge: paint immediately instead. Slower
        // under fast typing, still correct.
        SurveyNotebook.showGhost(w);
    }
};

SurveyNotebook.previewPlan = function(w) {
    var doc = getDocument();
    if (isNull(doc)) {
        return null;
    }
    // A sheet is not a drawing to work in, and Draw refuses it -- so a
    // ghost over one would be promising something that cannot happen.
    //
    // isSheet, NOT blocks: blocks() SAYS SO to the caver, which is
    // right when they pressed Draw and would be a warning per
    // keystroke here.
    try {
        if (CsModelSpace.onSheet(doc)) {
            return null;
        }
    } catch (eSheet) {
    }
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey === null || survey === undefined ||
            survey.shots.length === 0) {
        return null;
    }
    var recon = null;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRecon) {
        recon = null;
    }
    // THE STATIONS ON THIS PAGE, which is what the ghost draws. On the
    // merged path the survey handed to CsGhost is the WHOLE cave --
    // the only way the page's stations land where Draw will put them
    // -- and without this the preview would ghost every leg of the
    // cave over the ones already drawn.
    var focus = {};
    var pageNames = CsModel.stationNames(survey);
    for (var n = 0; n < pageNames.length; n++) {
        focus[pageNames[n]] = true;
    }

    if (recon !== null && recon.legacy !== true &&
            recon.survey.shots.length > 0) {
        var mplan = SurveyNotebook.mergedPlan(w, doc, survey, recon);
        return {
            survey: mplan.merged,
            resolved: CsAdjust.resolveAndAdjust(mplan.merged,
                { anchor: mplan.anchor }, mplan.adjustOpts),
            focus: focus,
            merged: true
        };
    }
    var plan = SurveyNotebook.plainAnchor(doc, survey);
    return {
        survey: survey,
        resolved: CsAdjust.resolveAndAdjust(survey,
            { anchor: plan.anchor }),
        focus: focus,
        merged: false
    };
};

SurveyNotebook.plainAnchor = function(doc, survey) {
    // Anchor priority: an explicitly selected station wins; otherwise,
    // if the page's FIRST station name already exists in the drawing,
    // the new survey ties into it automatically -- name the tie-in
    // station on the first line of the notes and the surveys connect,
    // position and elevation both.
    var anchor;
    var tieIn = null;
    var sel = CsPick.startPointFromSelection(doc, "Survey Notebook");
    if (sel !== undefined && survey.shots.length > 0) {
        // No reconstruction exists on this path (recon was null,
        // legacy, or empty above), so there is no recorded datum to
        // pull from CsRevise -- the picked point's own Elevation tag
        // is the only source, same as the tie-in branch just below.
        //
        // And when it has none, z stays NULL rather than becoming 0.
        // An explicit anchor z is an instruction, and it beats a
        // #Fix / *fix: a placeholder 0 handed over here rebased a cave
        // whose entrance is fixed at 1250 ft down onto the drawing's
        // origin, and then disagreed with every other fixed station by
        // the same 1250, manufacturing a vertical misclosure the real
        // survey does not have. Null lets CsNetwork.resolve fall back
        // to that station's own control elevation.
        anchor = { name: survey.shots[0].from, x: sel.pos.x, y: sel.pos.y,
            z: sel.elevation };
    } else if (survey.shots.length > 0) {
        var firstName = survey.shots[0].from;
        var existing = CsTags.collectStations(doc);
        for (var ei = 0; ei < existing.length; ei++) {
            if (existing[ei].name === firstName) {
                // same rule: a tie-in station with no recorded
                // elevation supplies no elevation, it does not supply
                // zero
                anchor = { name: firstName, x: existing[ei].pos.x,
                    y: existing[ei].pos.y,
                    z: CsTags.getNumber(existing[ei].entity, "Elevation") };
                tieIn = firstName;
                break;
            }
        }
    }

    return { anchor: anchor, tieIn: tieIn };
};

SurveyNotebook.drawSurveyInner = function(w, forceFull) {
    var doc = getDocument();
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Survey Notebook")) {
        return;
    }
    var di = getDocumentInterface();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "No shots to draw.");
        return;
    }

    // A drawing that already holds exact (v3) survey data makes Draw
    // TRIP-AWARE: the page's shots replace (or join) their trip inside
    // the full merged survey, and the whole thing redraws once.
    // Anything else -- empty drawing, untagged linework, legacy pre-v3
    // tags -- takes the plain path below, exactly as it always has.
    var recon = null;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRecon) {
        recon = null; // unreadable tags: treat as no existing survey
    }
    if (recon !== null && recon.legacy !== true &&
            recon.survey.shots.length > 0) {
        SurveyNotebook.drawMergedSurvey(w, doc, survey, recon,
            forceFull === true);
        return;
    }

    var plan = SurveyNotebook.plainAnchor(doc, survey);
    var anchor = plan.anchor;
    var tieIn = plan.tieIn;

    // A page drawn onto an empty or untagged drawing CREATES geometry,
    // so it takes the current settings; CsDraw.survey records them on
    // the trip-0 anchor for every later redraw to follow.
    var resolved = CsAdjust.resolveAndAdjust(survey, { anchor: anchor });
    var findings = CsValidate.check(survey, resolved);

    // Redrawing REPLACES: everything previously drawn for the stations
    // on THIS page -- points, labels, LRUD, and shots between page
    // stations -- is removed first, so Draw never stacks duplicates.
    // Older surveys' marks survive untouched (a tie-in shot from an
    // earlier trip keeps its line: only one of its ends is on this
    // page). The erase is its own undo step before the draw.
    var seqBase = CsTags.collectStations(doc).length;
    var pageNames = CsModel.stationNames(survey);
    var replaced = CsDraw.eraseStations(doc, pageNames, di);

    var drawn = CsDraw.survey(survey, resolved, undefined, undefined, seqBase,
        { doc: doc, di: di });
    CsDraw.zoomToSurvey(survey, resolved);
    // The trip now exists in the drawing, so it gets its group. Derived
    // from the DOCUMENT's survey, never this page's: a page numbers its
    // trips from 0 for itself.
    if (typeof CsLayerGroups !== "undefined") {
        CsLayerGroups.fileTripsQuietly(doc);
    }

    QMessageBox.information(null, "Survey Notebook",
        (tieIn !== null ? ("Tied into existing station " + tieIn +
            " -- the new survey continues from its position and " +
            "elevation.\n\n") : "") +
        (replaced > 0 ? ("Replaced " + replaced + " previously drawn " +
            "mark" + (replaced === 1 ? "" : "s") + " for this page's " +
            "stations (undo twice to restore them).\n\n") : "") +
        CsReport.drawSummary(survey, resolved, drawn, findings) +
        "\n\nDrawn as one undo step" +
        (replaced > 0 ? " after the replace" : "") + ".");
};

// ---------------------------------------------------------------------
// Drawing round-trip: the page as the shot-revision UI.
//
// The pure half first (no GUI, no document access -- testable
// headless): cloneShot / tripSurvey / mergeTripIntoSurvey /
// tripChoiceLabel. The document-touching half (loadFromDrawing,
// drawMergedSurvey) sits below them.
// ---------------------------------------------------------------------

/** Shallow copy of one shot (own enumerable fields; the leftAll-style
 *  arrays stay shared -- nothing downstream mutates them). Pure. */
SurveyNotebook.cloneShot = function(shot) {
    var out = {};
    for (var k in shot) {
        if (shot.hasOwnProperty(k)) {
            out[k] = shot[k];
        }
    }
    return out;
};

/**
 * Extracts ONE trip from a (possibly multi-trip) survey as a fresh
 * single-trip survey the ladder can hold: header fields from the trip
 * record, shots cloned and re-based to trip 0, notebook order
 * preserved. setSurvey then fills the page from it and strips the
 * trip's declination from the azimuth cells the same way it does for
 * imports. Pure -- no GUI, no document access.
 */
SurveyNotebook.tripSurvey = function(survey, tripId) {
    CsModel.ensureTrips(survey);
    var trip = survey.trips[tripId];
    var out = CsModel.newSurvey();
    out.name = trip.name;
    out.caveName = survey.caveName;
    out.date = trip.date;
    out.team = trip.team;
    out.instruments = trip.instruments || "";
    out.declination = trip.declination;
    out.declinationSource = trip.declinationSource;
    out.distanceUnit = trip.distanceUnit;
    out.startNote = trip.startNote || "";
    out.startLrud = trip.startLrud || null;
    for (var i = 0; i < survey.shots.length; i++) {
        if ((survey.shots[i].trip || 0) !== tripId) {
            continue;
        }
        var c = SurveyNotebook.cloneShot(survey.shots[i]);
        c.trip = 0;
        out.shots.push(c);
    }
    return out;
};

/**
 * Carries the fields the ladder has no cells for from a trip's OLD
 * shots onto the page's revised ones. The page holds station name,
 * distance, azimuth, inclination, LRUD and notes -- it has nowhere to
 * write a backsight or a Compass exclusion flag, so a page-blank value
 * must never be allowed to erase what the drawing was already
 * carrying. Without this, loading a trip and correcting one distance
 * would quietly throw away every backsight and flag in it.
 *
 * Matching is by identity of the leg, in notebook order: a normal shot
 * takes the next unconsumed old shot with the same (from, to) pair, a
 * splay takes the next unconsumed old splay off the same station. Each
 * old shot is consumed at most once, so duplicate legs and repeated
 * station pairs pair off one-for-one in the order they were written. A
 * page shot with no counterpart is a leg the user just typed: it keeps
 * its own blank values, which is correct, not a loss.
 *
 * Flags carry over unconditionally. A BACKSIGHT does not: it lives in
 * the same frame as azimuth (true, declination applied), so the moment
 * the user edits a shot's azimuth on the page the old backsight stops
 * describing that leg. A reading that silently disagrees with its
 * foresight is worse than no reading, so that shot's backAzimuth is
 * dropped and counted -- backInclination likewise against inclination.
 *
 * newShots are mutated in place; callers pass clones. oldShots are
 * only read. Pure -- no GUI, no document access.
 *
 * \return { backsights, droppedBacksights, flags } -- shot counts for
 *         the Draw report: shots that kept a carried-over backsight
 *         reading, shots whose backsight was dropped as edited, and
 *         shots that kept at least one carried-over exclusion flag.
 */
SurveyNotebook.carryHiddenFields = function(oldShots, newShots) {
    var EPS = 1e-9;
    var FLAGS = ["excludeFromPlot", "excludeFromAll",
        "excludeFromLength", "noAdjust"];
    // A splay has no "to", so its identity is its base station plus
    // its position among that station's splays -- hence one key for
    // all of them and the queue below does the ordering.
    // NUL joins the parts: a station name can contain a space, it
    // cannot contain a NUL, so the key can never collide with a name.
    var legKey = function(s) {
        return s.splay ? (s.from + "\0<splay>") :
            (s.from + "\0" + s.to);
    };
    var queues = {};    // leg identity -> old shots, notebook order
    var heads = {};     // leg identity -> how many are consumed
    var i;
    for (i = 0; i < oldShots.length; i++) {
        var k = legKey(oldShots[i]);
        if (queues[k] === undefined) {
            queues[k] = [];
        }
        queues[k].push(oldShots[i]);
    }

    var out = { backsights: 0, droppedBacksights: 0, flags: 0 };
    for (i = 0; i < newShots.length; i++) {
        var ns = newShots[i];
        var nk = legKey(ns);
        var q = queues[nk];
        var at = heads[nk] === undefined ? 0 : heads[nk];
        if (q === undefined || at >= q.length) {
            continue; // a genuinely new leg: there is nothing to carry
        }
        heads[nk] = at + 1;
        var os = q[at];

        var kept = false;
        var dropped = false;
        if (os.backAzimuth !== null && os.backAzimuth !== undefined) {
            if (Math.abs(ns.azimuth - os.azimuth) > EPS) {
                dropped = true; // page moved the foresight: stale
            } else {
                ns.backAzimuth = os.backAzimuth;
                kept = true;
            }
        }
        if (os.backInclination !== null && os.backInclination !== undefined) {
            if (Math.abs(ns.inclination - os.inclination) > EPS) {
                dropped = true;
            } else {
                ns.backInclination = os.backInclination;
                kept = true;
            }
        }
        if (kept) {
            out.backsights++;
        }
        if (dropped) {
            out.droppedBacksights++;
        }

        var flagged = false;
        for (var f = 0; f < FLAGS.length; f++) {
            if (os[FLAGS[f]] === true) {
                ns[FLAGS[f]] = true;
                flagged = true;
            }
        }
        if (flagged) {
            out.flags++;
        }
    }
    return out;
};

/**
 * The page's header as a trip record. This is what the page's identity
 * as a TRIP is: mergeTripIntoSurvey matches it against the drawing's
 * trips by fingerprint (date | team), and linework arming resolves the
 * page's current trip the same way, so both must read the header
 * identically. Pure -- no GUI, no document access.
 */
SurveyNotebook.tripRecordOf = function(survey) {
    var trip = CsModel.newTrip();
    trip.name = survey.name;
    trip.date = survey.date;
    trip.team = survey.team;
    trip.instruments = survey.instruments || "";
    trip.declination = survey.declination;
    trip.declinationSource = survey.declinationSource;
    trip.distanceUnit = survey.distanceUnit;
    trip.startNote = survey.startNote || "";
    trip.startLrud = survey.startLrud || null;
    return trip;
};

/**
 * The merge decision: given the RECONSTRUCTED survey (the whole
 * drawing), the page's trip record and the page's shots, builds the
 * merged survey the drawing should now hold.
 *
 * WHICH trip the page replaces is decided by IDENTITY when the page
 * knows it -- `loadedTripId`, set when Load from drawing filled the
 * page from that trip. Fingerprint matching is the fallback, for a page
 * that was typed rather than loaded.
 *
 * That distinction is the whole point of the parameter. Fingerprint
 * alone meant that correcting a loaded trip's date or team stopped it
 * matching anything, so the page landed as a NEW trip and the original
 * stayed behind with its old shots -- typing a fix forked the cave.
 * Reported live on Truitt Cave, 2026-09-05.
 *
 * A trip whose fingerprint
 * (date | team -- CsModel.tripFingerprint) matches the
 * page is REPLACED: its old shots drop out, the page's shots take its
 * trip id, and its trip record is overwritten by the page's (name and
 * start note/LRUD included -- the page is the revision authority).
 * No match OCCUPIES a blank placeholder trip 0 (CsModel.isPlaceholderTrip)
 * when there is one -- the same rule CsModel.tripIdFor applies -- so a
 * page typed into a drawing with no tagged survey anchors at trip 0
 * instead of leaving it empty; otherwise the page appends as a new trip.
 *
 * Pure -- no GUI, no document access. reconSurvey's shots and trip
 * records are not mutated (kept shots are shared by reference; the
 * page's shots are cloned before re-stamping their trip id), though
 * CsModel.ensureTrips normalizes reconSurvey in place, the suite-wide
 * idiom.
 *
 * \return {
 *   survey     the merged CsModel survey (fresh object; fixed copied
 *              so callers may add seed points freely)
 *   tripId     the trip id the page's shots now carry
 *   replaced   true when an existing trip was replaced (fingerprint
 *              matched), false when the page landed as a new trip
 *   droppedStationNames  station names touched by the replaced trip's
 *              OLD shots -- the erase set must include the ones the
 *              revision no longer uses, or their marks would linger
 *   carried    what the ladder-invisible fields did on the way in --
 *              see carryHiddenFields (all zeros for a new trip, which
 *              has no old shots to carry from)
 * }
 */
SurveyNotebook.mergeTripIntoSurvey = function(reconSurvey, tripRecord,
        shots, loadedTripId) {
    CsModel.ensureTrips(reconSurvey);
    var merged = CsModel.newSurvey();
    merged.caveName = reconSurvey.caveName;
    merged.fixed = {};
    for (var fn in reconSurvey.fixed) {
        if (reconSurvey.fixed.hasOwnProperty(fn)) {
            merged.fixed[fn] = reconSurvey.fixed[fn];
        }
    }
    merged.trips = reconSurvey.trips.slice();

    var fp = CsModel.tripFingerprint(tripRecord);
    var tripId = -1;
    // IDENTITY FIRST. A page loaded from trip 9 revises trip 9, whatever
    // its date and team now say -- that is what makes correcting them
    // possible at all. Guarded: a drawing edited since the load (a trip
    // deleted, say) may no longer have that slot, and the page then
    // falls back to matching like any typed page rather than writing
    // over whatever now sits at that index.
    if (typeof loadedTripId === "number" && loadedTripId >= 0 &&
            loadedTripId < merged.trips.length) {
        tripId = loadedTripId;
    }
    for (var t = 0; tripId < 0 && t < merged.trips.length; t++) {
        if (CsModel.tripFingerprint(merged.trips[t]) === fp) {
            tripId = t;
        }
    }
    var replaced = tripId >= 0;
    if (replaced) {
        // once trips exist they are the authority (see ensureTrips):
        // the revision writes the trip SLOT, never top-level fields
        merged.trips[tripId] = tripRecord;
    } else if (CsModel.isPlaceholderTrip(reconSurvey, 0)) {
        // trip 0 is an empty slot, not a trip to append past -- occupy
        // it the way CsModel.tripIdFor does, so a page typed into an
        // untagged drawing gets a trip-0 anchor for the drawing-level
        // tags instead of leaving trip 0 empty forever (checked against
        // reconSurvey,
        // not merged, because its shots are what isPlaceholderTrip
        // reads and merged.shots is still empty at this point)
        merged.trips[0] = tripRecord;
        tripId = 0;
    } else {
        merged.trips.push(tripRecord);
        tripId = merged.trips.length - 1;
    }

    var droppedSeen = {};
    var droppedStationNames = [];
    var dropName = function(n) {
        if (n !== "" && droppedSeen[n] !== true) {
            droppedSeen[n] = true;
            droppedStationNames.push(n);
        }
    };
    var oldTripShots = [];
    for (var i = 0; i < reconSurvey.shots.length; i++) {
        var s = reconSurvey.shots[i];
        if ((s.trip || 0) === tripId) {
            // replaced trip's old shot: dropped (never matches when
            // the page landed as a NEW trip -- no old shot has its id),
            // but kept aside first so what the page can't show survives
            oldTripShots.push(s);
            dropName(s.from);
            if (!s.splay) {
                dropName(s.to);
            }
            continue;
        }
        merged.shots.push(s);
    }
    var pageShots = [];
    for (i = 0; i < shots.length; i++) {
        var c = SurveyNotebook.cloneShot(shots[i]);
        c.trip = tripId;
        pageShots.push(c);
    }
    // The page is the authority on what it can express -- and only on
    // that. Backsights and exclusion flags have no cells, so they come
    // across from the shots this trip already had.
    var carried = SurveyNotebook.carryHiddenFields(oldTripShots, pageShots);
    for (i = 0; i < pageShots.length; i++) {
        merged.shots.push(pageShots[i]);
    }
    CsModel.ensureTrips(merged); // mirror trips[0] up to the top level
    return { survey: merged, tripId: tripId, replaced: replaced,
        droppedStationNames: droppedStationNames, carried: carried };
};

/** One trip as a chooser line: "Trip 0: ENT 1998-07-04 NS/JB decl -3.50
 *  (12 shots)". "Trip N:" matches the id the per-trip revision rows
 *  use (CsRevise.tripLabel), so the same trip reads
 *  the same way in both places -- and, since the id is unique per
 *  trip, it is what the caller resolves the user's pick back to a
 *  trip BY, rather than re-matching the whole label string. The
 *  THE LABEL IS THE STATION RANGE, at Nathan's asking: a caver picking
 *  a page thinks "the D15 to D22 trip", not "the one with Laura and
 *  Peter on it". Team, declination and the trip name are dropped.
 *
 *  Two resurveys of the same passage therefore read alike apart from
 *  their trip number -- which is a real cost, and not a functional one:
 *  the id prefix is unique and is what the pick resolves BY, so the
 *  wrong trip cannot be loaded, only the wrong one chosen by eye. The
 *  date comes back as the label when a trip has no ordinary shots to
 *  read a range from.
 *  "|" is getItem's separator, so it is flattened out of the free
 *  text. Pure. */
/**
 * The first and last station of one trip, in notebook order.
 *
 * SPLAYS ARE SKIPPED: a splay has no `to` station, and a trip that
 * happens to end on one would otherwise report its range as ending
 * nowhere. Pure.
 *
 * \return {from, to} -- either may be "" when the trip has no ordinary
 *         shots to read a range from.
 */
SurveyNotebook.tripStationRange = function(survey, tripId) {
    var out = { from: "", to: "" };
    if (survey === null || survey === undefined) {
        return out;
    }
    for (var i = 0; i < survey.shots.length; i++) {
        var sh = survey.shots[i];
        if ((sh.trip || 0) !== tripId || sh.splay) {
            continue;
        }
        var f = String(sh.from === undefined || sh.from === null ? "" : sh.from);
        var t = String(sh.to === undefined || sh.to === null ? "" : sh.to);
        if (out.from === "" && f !== "") {
            out.from = f;
        }
        if (t !== "") {
            out.to = t;
        }
    }
    return out;
};

SurveyNotebook.tripChoiceLabel = function(tripId, trip, shotCount, range) {
    var clean = function(v) {
        return String(v === undefined || v === null ? "" : v)
            .replace(/\|/g, "/").replace(/^\s+|\s+$/g, "");
    };
    var parts = ["Trip " + tripId + ":"];
    var f = clean(range === undefined || range === null ? "" : range.from);
    var t = clean(range === undefined || range === null ? "" : range.to);
    if (f !== "" && t !== "") {
        parts.push(f + " - " + t);
    } else if (f !== "" || t !== "") {
        parts.push(f !== "" ? f : t);
    } else if (clean(trip.date) !== "") {
        // no ordinary shots to read a range from: fall back to the one
        // field that still tells the trips apart
        parts.push(clean(trip.date));
    }
    parts.push("(" + shotCount + " shot" +
        (shotCount === 1 ? "" : "s") + ")");
    return parts.join(" ");
};

/**
 * Load Drawing: reconstructs the survey from the open drawing and
 * fills the page from ONE of its trips -- the ladder becomes that
 * trip's revision UI. Multi-trip drawings get a chooser; legacy
 * (pre-v3) drawings are pointed at Repair Drawing instead, since
 * a chain-guessed reconstruction is not safe to revise from.
 */
SurveyNotebook.loadFromDrawing = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't read the survey back from this drawing (" + eRe + ").");
        return;
    }
    if (recon.legacy === true) {
        QMessageBox.information(null, "Survey Notebook",
            "This drawing's survey predates the exact tag schema, so " +
            "its shots can't be loaded back faithfully.\n\n" +
            "Run Repair Drawing (command: rep) " +
            "first -- it upgrades the tags in place -- then Load " +
            "Drawing again.");
        return;
    }
    if (recon.survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No survey shots found in this drawing -- nothing to load.");
        return;
    }

    // one page = ONE trip: count shots per trip, choose when several
    var counts = {};
    for (var i = 0; i < recon.survey.shots.length; i++) {
        var tid = recon.survey.shots[i].trip || 0;
        counts[tid] = (counts[tid] || 0) + 1;
    }
    var withShots = [];
    for (var t = 0; t < recon.survey.trips.length; t++) {
        if ((counts[t] || 0) > 0) {
            withShots.push(t);
        }
    }
    if (withShots.length === 0) {
        // shots tagged with a trip id no trip record covers (a
        // hand-edited drawing): no header to load them under
        QMessageBox.warning(null, "Survey Notebook",
            "This drawing's shots don't belong to any trip recorded in " +
            "it, so there's no trip header to load them under.");
        return;
    }
    var tripId;
    if (withShots.length === 1) {
        tripId = withShots[0];
    } else {
        var labels = [];
        for (i = 0; i < withShots.length; i++) {
            labels.push(SurveyNotebook.tripChoiceLabel(withShots[i],
                recon.survey.trips[withShots[i]], counts[withShots[i]],
                SurveyNotebook.tripStationRange(recon.survey,
                    withShots[i])));
        }
        var choice = getItem("Survey Notebook",
            "This drawing holds " + withShots.length + " trips -- one " +
            "page is one trip. Load which?", labels.join("|"), 0, "|");
        if (choice === undefined) {
            return;
        }
        // getItem (simple_input.js) hands back dialog.textValue() --
        // the chosen label's TEXT, not its index -- so the pick has to
        // be resolved back to a trip by finding that text's POSITION
        // in the array the labels were built from, first match wins.
        // That is exact (not lucky) because every label is prefixed
        // with its trip id (see tripChoiceLabel), which is unique by
        // construction; the declination in the label just makes the
        // id-holding trip recognizable to the human doing the picking.
        var idx = -1;
        for (i = 0; i < labels.length; i++) {
            if (labels[i] === choice) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            return;
        }
        tripId = withShots[idx];
    }

    SurveyNotebook.setSurvey(w,
        SurveyNotebook.tripSurvey(recon.survey, tripId));
    // WHICH TRIP THIS PAGE IS. Set after setSurvey, which clears it:
    // from here until the page is cleared or a new trip is started,
    // Draw revises THIS trip -- by id, not by what the header says.
    // Without it, correcting the date or team you just loaded forked
    // the trip into a duplicate instead of revising it.
    w.loadedTripId = tripId;
    EAction.handleUserMessage("Survey Notebook: loaded trip " + tripId +
        " (" + counts[tripId] + " shot" +
        (counts[tripId] === 1 ? "" : "s") + ") from the drawing. Edit " +
        "the page and Draw to revise that trip in place. (Backsights " +
        "and Compass-style exclusion flags don't fit on this page, but " +
        "they are preserved through the redraw -- except that editing " +
        "a shot's azimuth drops that shot's backsight, since the two " +
        "would then disagree.)");
};

/**
 * Trip-aware Draw: merges the page into the reconstructed survey
 * (see mergeTripIntoSurvey), erases EVERY station the merged survey
 * owns -- plus any the replaced trip no longer uses -- and redraws
 * the whole merged survey once. Redrawing everything keeps junction
 * geometry between trips consistent instead of stitching pages.
 *
 * This is a REVISION path, not just a draw: a page loaded from the
 * drawing and drawn again with an edited header (Decl, say) moves the
 * survey. So it ends where CsRevise.apply's non-rigid branch ends --
 * bound linework follows the stations it was traced against
 * (CsRevise.moveLinework). It never reaches CsRevise.apply itself, so
 * nothing is moved twice.
 */
/**
 * Draw ONE trip into a drawing that already holds the rest of the cave.
 *
 * Reached only through CsDelta.decide: the merged solve has already
 * been shown to move nothing that is already drawn, so every station
 * outside this trip is exactly where the drawing has it and there is
 * nothing for a whole-cave redraw to do.
 *
 * What this skips, and why it is safe to skip:
 *
 *   CsBind.planAutoBind / CsRevise.moveLinework   both exist to carry
 *       traced linework along when the survey MOVES. Nothing moved.
 *   the second stationPositions pass               it exists to answer
 *       "did it move", which the gate has already answered.
 *   the whole-cave erase                           only this trip's own
 *       stations are erased, so every other trip's marks, wall runs and
 *       LRUD survive untouched.
 *
 * What it still does in full: the extended elevation, which is a
 * whole-cave product and is rebuilt from the merged survey (see
 * CsDraw.survey's `partial` option), and the geo anchor, which is
 * recommitted when -- and only when -- this trip's own erase took the
 * point it rides on.
 *
 * \param split CsDelta.pageStations(merged, tripId): page = the
 *              stations this trip owns and this draw replaces; tie =
 *              the stations its shots touch that another trip owns,
 *              needed for position and left alone otherwise
 */
SurveyNotebook.drawPartial = function(w, doc, di, merged, resolved,
        findings, merge, split) {
    var tripId = merge.tripId;
    var onPage = {};
    for (var i = 0; i < split.page.length; i++) {
        onPage[split.page[i]] = true;
    }

    // The geo anchor rides a station POINT. It is only at risk when
    // THIS trip's erase deletes that point -- which happens when the
    // page is a revision of a trip that owns the anchored station.
    var geoBefore = CsLocationPick.anchorRecord(doc);
    var geoAtRisk = geoBefore !== null && onPage[geoBefore.station] === true;
    // snapshot every anchor tag BEFORE the erase takes the point away
    var geoCarried = geoBefore !== null ?
        CsLocationPick.carriedTags(geoBefore.entity) : null;

    var replaced = CsLayers.withLayerOn(doc, di, CsLayers.CTRL_HIDDEN,
        function() {
            return CsDraw.eraseStations(doc, split.page, di);
        });

    var pageShots = [];
    for (i = 0; i < merged.shots.length; i++) {
        if ((merged.shots[i].trip || 0) === tripId) {
            pageShots.push(merged.shots[i]);
        }
    }
    var seqBase = CsTags.collectStations(doc).length;
    var pageSurvey = CsDelta.pageSurvey(merged, pageShots);
    var pageResolved = CsDelta.subsetResolved(resolved,
        split.page.concat(split.tie), tripId);

    var drawn = CsDraw.survey(pageSurvey, pageResolved, undefined,
        undefined, seqBase, {
            doc: doc,
            di: di,
            partial: true,
            omitStations: split.tie,
            // the elevation is a whole-cave product: never build it
            // from one page, or the other bands go with it
            profileSurvey: merged,
            profileResolved: resolved
        });
    CsDraw.zoomToSurvey(merged, resolved);
    if (typeof CsLayerGroups !== "undefined") {
        CsLayerGroups.fileTripsQuietly(doc);
    }

    var geoLine = "";
    if (geoAtRisk) {
        var geoHome = null;
        var redrawn = CsTags.collectStations(doc);
        for (var gi = 0; gi < redrawn.length; gi++) {
            if (redrawn[gi].name === geoBefore.station) {
                geoHome = redrawn[gi];
                break;
            }
        }
        if (geoHome !== null) {
            CsLocationPick.rehome(di, geoCarried, geoHome.entity);
        } else {
            geoLine = "\n\nThe geo anchor was on station " +
                geoBefore.station + ", which this page no longer " +
                "draws -- the georeference is LOST. Re-anchor before " +
                "fetching imagery again.";
        }
    }

    var fp = CsModel.tripFingerprint(merged.trips[tripId]);
    var tripLine = (merge.replaced ?
        ("Replaced trip " + tripId + " (" + fp + ") with this page's " +
            "shots.") :
        ("Added this page as new trip " + tripId + " (" + fp + ").")) +
        " Nothing else moved, so only this trip was redrawn -- use " +
        "Redraw All in the ... menu to redraw the whole cave.";

    EAction.handleUserMessage("Survey Notebook: " + tripLine + geoLine);
    QMessageBox.information(null, "Survey Notebook",
        tripLine + "\n\n" +
        (replaced > 0 ? ("Replaced " + replaced + " previously drawn " +
            "mark" + (replaced === 1 ? "" : "s") + " for this trip " +
            "(undo twice to restore them).\n\n") : "") +
        CsReport.drawSummary(merged, resolved, drawn, findings) + geoLine +
        "\n\nDrawn as one undo step" +
        (replaced > 0 ? " after the replace" : "") + ".");
};

/**
 * What Draw would merge this page into, and where that merge lands.
 *
 * THE OTHER HALF OF plainAnchor, for the path a drawing with real
 * survey data in it takes: the page's trip is merged into the whole
 * reconstructed cave, and the result is anchored so the drawing stays
 * exactly where it stands. Extracted for the same reason -- the ghost
 * has to be drawn where Draw will put it, and one function is the only
 * way to be sure of that.
 *
 * READ-ONLY. It reads the document's stations and tags and changes
 * nothing, so the preview can call it on every keystroke.
 *
 * \return {merged, anchor, adjustOpts, merge}
 */
SurveyNotebook.mergedPlan = function(w, doc, survey, recon) {
    var tripRecord = SurveyNotebook.tripRecordOf(survey);
    var loadedTripId = (w !== null && w !== undefined &&
        typeof w.loadedTripId === "number") ? w.loadedTripId : null;
    var merge = SurveyNotebook.mergeTripIntoSurvey(recon.survey,
        tripRecord, survey.shots, loadedTripId);
    var merged = merge.survey;

    // Anchor: hold the drawing WHERE IT STANDS. The reconstruction's
    // trip-0 anchor at its drawn position when its station survives
    // the merge; otherwise any drawn station the merged survey still
    // names. Only a page that renamed every station falls through --
    // then the merged data anchors at the old anchor's position so the
    // drawing at least stays in its own neighborhood.
    var mergedNames = CsModel.stationNames(merged);
    var inMerged = {};
    for (var i = 0; i < mergedNames.length; i++) {
        inMerged[mergedNames[i]] = true;
    }
    var anchor = null;
    var existing = CsTags.collectStations(doc);
    for (i = 0; i < existing.length; i++) {
        if (inMerged[existing[i].name] !== true) {
            continue;
        }
        var isRecAnchor = (existing[i].name === recon.anchorName);
        if (anchor === null || isRecAnchor) {
            // z stays NULL when this station records no elevation: an
            // explicit anchor z beats a *fix, so a placeholder 0 would
            // rebase an absolute-datum cave onto the drawing's origin.
            // Null lets CsNetwork.resolve fall back to the station's
            // own control elevation instead.
            anchor = { name: existing[i].name, x: existing[i].pos.x,
                y: existing[i].pos.y,
                z: CsTags.getNumber(existing[i].entity, "Elevation") };
            if (isRecAnchor) {
                break;
            }
        }
    }
    if (anchor === null) {
        var firstFrom = "";
        for (i = 0; i < merged.shots.length; i++) {
            var fs = merged.shots[i];
            if (!fs.excludeFromAll && !fs.splay &&
                    fs.from !== "" && fs.to !== "") {
                firstFrom = fs.from;
                break;
            }
        }
        // x/y already fall back to the OLD anchor's drawn position --
        // firstFrom is just a new name riding along on it -- so z has
        // to match that same station, not firstFrom (a name recon has
        // never seen, which would resolve anchorZOf to 0 every time).
        anchor = { name: firstFrom,
            x: recon.anchorPos !== null ? recon.anchorPos.x : 0.0,
            y: recon.anchorPos !== null ? recon.anchorPos.y : 0.0,
            z: CsRevise.anchorZOf(recon, recon.anchorName) };
    }

    // An explicitly selected start point seeds the PAGE's first
    // station as a fixed point -- CsNetwork only consults fixed seeds
    // for stations the anchored component never reaches, so this
    // places a genuinely NEW, disconnected trip where the user asked
    // and changes nothing when the page ties into the existing survey.
    var sel = CsPick.startPointFromSelection(doc, "Survey Notebook");
    if (sel !== undefined && survey.shots.length > 0) {
        var firstPage = survey.shots[0].from;
        if (firstPage !== "" && firstPage !== anchor.name &&
                merged.fixed[firstPage] === undefined) {
            // firstPage is a brand-new station recon has never seen
            // (that's what "merged.fixed[firstPage] === undefined"
            // means here), so its datum can't come from the
            // reconstruction either -- the picked point's own tag is
            // the only source.
            //
            // Coerced to a NUMBER here, unlike the anchors above, and
            // that difference is deliberate: this is a survey.fixed
            // CONTROL coordinate, which has no "unspecified" state to
            // fall back to -- resolve reads its z directly. A picked
            // point with no elevation means nothing is known about this
            // new trip's height, and 0 is the honest reading of that
            // for a passage disconnected from every existing datum
            // (which is the only case resolve honours a fixed seed in).
            merged.fixed[firstPage] = { x: sel.pos.x, y: sel.pos.y,
                z: (sel.elevation === null || sel.elevation === undefined) ?
                    0.0 : sel.elevation };
        }
    }

    // This path REDRAWS an existing drawing -- it erases every station
    // the merged survey owns and puts them back -- so it must solve
    // the way the drawing was solved, not the way today's setting says.
    // Otherwise flipping the switch and pressing Draw moves the whole
    // cave under linework that was traced against it, and calls it a
    // revision. The record comes off the trip-0 anchor, which recon
    // read before any of this began.
    return { merged: merged, anchor: anchor, merge: merge,
             adjustOpts: CsAdjust.optionsFromTags(recon.adjustTags || {}) };
};

SurveyNotebook.drawMergedSurvey = function(w, doc, survey, recon,
        forceFull) {
    var plan = SurveyNotebook.mergedPlan(w, doc, survey, recon);
    var merge = plan.merge;
    var merged = plan.merged;
    var anchor = plan.anchor;
    var mergedNames = CsModel.stationNames(merged);
    var inMerged = {};
    for (var i = 0; i < mergedNames.length; i++) {
        inMerged[mergedNames[i]] = true;
    }

    var resolved = CsAdjust.resolveAndAdjust(merged, { anchor: anchor },
        plan.adjustOpts);
    var findings = CsValidate.check(merged, resolved);

    // Erase by station name: everything the merged survey owns, plus
    // the stations the replaced trip's revision dropped. CTRL-HIDDEN
    // is toggled on around the erase -- this build silently refuses
    // deletes on an off layer, and excluded legs live there.
    var eraseNames = mergedNames.slice();
    for (i = 0; i < merge.droppedStationNames.length; i++) {
        if (inMerged[merge.droppedStationNames[i]] !== true) {
            eraseNames.push(merge.droppedStationNames[i]);
        }
    }
    var di = getDocumentInterface();

    // The frame the user's tracing was drawn in. Captured HERE because
    // this is the last moment it exists: the erase below deletes the
    // very marks that hold these coordinates, and nothing else in the
    // drawing records where they were. (CsRevise.apply reads its old
    // frame off the pre-revision resolve instead; this path has no
    // such resolve, so the drawing is both the source and the truth.)
    var oldPos = CsRevise.stationPositions(doc);

    // -- CAN THIS DRAW SKIP THE REST OF THE CAVE? ---------------------
    //
    // Adding a trip that ties into one station and closes no new loop
    // leaves every existing station exactly where it already is, and
    // the whole-cave erase-and-redraw below is then pure cost -- ~6 s
    // on an 800-station cave, headless, before any repaint. The gate
    // (CsDelta.decide) takes the fast path ONLY when the merged solve
    // moves nothing already drawn; everything else -- a corrected
    // declination, a re-closed loop, a dropped station, a page that
    // redraws the trip-0 anchor -- falls through to the path this tool
    // has always taken. "Redraw All" in the ... menu forces that path
    // on demand, which is also how the two documented cosmetic
    // divergences get reconciled (see CsDelta's header and the design
    // note).
    var lwExtentEarly = CsRevise.positionsExtent(oldPos);
    var split = CsDelta.pageStations(merged, merge.tripId);
    var gate = forceFull === true ?
        { fast: false, reason: "Redraw All" } :
        CsDelta.decide({ drawn: oldPos, stations: resolved.stations,
            extent: lwExtentEarly, pageNames: split.page,
            dropped: merge.droppedStationNames,
            anchorName: recon.anchorName });

    if (gate.fast) {
        SurveyNotebook.drawPartial(w, doc, di, merged, resolved, findings,
            merge, split);
        return;
    }

    // The same moment is the last moment to work out what the user's
    // UNTAGGED linework was drawn against, and for the same reason:
    // CsBind.stationIndex reads the marks the erase deletes -- station
    // points, LRUD tips, splay tips -- and after the redraw those points
    // say where the stations ENDED UP, not where the tracing was drawn
    // against them. Read-only here; the tags go on after the redraw, and
    // only if the redraw really moved something.
    var tripNames = CsRevise.tripStationNames(recon.survey);
    var bindPlan = CsBind.planAutoBind(doc, tripNames);

    // The geo anchor rides a station POINT the erase below deletes.
    // CsRevise.apply already snapshots and recommits it; this path
    // did not, so a plain notebook Draw silently destroyed the
    // drawing's georeference -- found live on Truitt Cave
    // (2026-08-27), whose contours were anchored and whose anchor
    // was gone.
    var geoBefore = CsLocationPick.anchorRecord(doc);
    // snapshot every anchor tag BEFORE the erase takes the point away
    var geoCarried = geoBefore !== null ?
        CsLocationPick.carriedTags(geoBefore.entity) : null;

    var replaced = CsLayers.withLayerOn(doc, di, CsLayers.CTRL_HIDDEN,
        function() {
            return CsDraw.eraseStations(doc, eraseNames, di);
        });

    // fresh Seq numbering continues after whatever survived the erase
    var seqBase = CsTags.collectStations(doc).length;
    var drawn = CsDraw.survey(merged, resolved, undefined, undefined, seqBase,
        { doc: doc, di: di });
    CsDraw.zoomToSurvey(merged, resolved);
    if (typeof CsLayerGroups !== "undefined") {
        CsLayerGroups.fileTripsQuietly(doc);
    }

    // -- traced linework follows its own stations ---------------------
    // This is the second way to revise a trip in place, and it owes the
    // surveyor's tracing exactly what CsRevise.apply's non-rigid branch
    // owes it: the marks the wall was drawn against have just been
    // erased and redrawn somewhere else, so anything bound to them has
    // to come along or it is silently left behind. Editing the header
    // Decl and pressing Draw is the ordinary way to reach this.
    //
    // Skipped outright when no station actually moved -- a page that
    // merely ADDS a trip disturbs nothing, and a no-op move would cost
    // an undo step and a re-tracing warning for an event that did not
    // happen.
    var newPos = CsRevise.stationPositions(doc);
    var lwExtent = CsRevise.positionsExtent(oldPos);
    // asked once and kept: the single answer to "did this Draw move
    // the survey"
    var stationsMoved = CsRevise.positionsMoved(oldPos, newPos, lwExtent);
    var lw = null;
    var lwBound = 0;
    if (stationsMoved > 0) {
        // The plan becomes tags now: an entity has to be tagged before
        // the mover can see it, and waiting until here means a Draw that
        // moved nothing writes nothing onto the user's own geometry.
        lwBound = CsBind.commitAutoBind(doc, di, bindPlan);
        lw = CsRevise.withOffLayersOn(doc, di, function() {
            return CsRevise.moveLinework(doc, di, oldPos, newPos,
                tripNames, lwExtent);
        });
        CsRevise.settleSections(doc, di);
    }
    var lwLine = lw === null ? "" :
        ("\n\n" + CsRevise.lineworkSummary(lw.moved, lw.unmoved,
            lwBound, true, lw.warped, lw.untied).join("\n"));

    // -- the georeference survives the redraw --------------------------
    // Recommitted onto whichever point now carries the anchored station
    // name, re-PINNED at its redrawn position (the survey moved, the
    // world coordinate did not -- same rule CsRevise.apply follows).
    var geoLine = "";
    if (geoBefore !== null) {
        var geoHome = null;
        var redrawnStations = CsTags.collectStations(doc);
        for (var gi = 0; gi < redrawnStations.length; gi++) {
            if (redrawnStations[gi].name === geoBefore.station) {
                geoHome = redrawnStations[gi];
                break;
            }
        }
        if (geoHome !== null) {
            CsLocationPick.rehome(di, geoCarried, geoHome.entity);
        } else {
            geoLine = "\n\nThe geo anchor was on station " +
                geoBefore.station + ", which this page no longer " +
                "draws -- the georeference is LOST. Re-anchor before " +
                "fetching imagery again.";
        }
    }

    var fp = CsModel.tripFingerprint(merged.trips[merge.tripId]);
    var tripLine = merge.replaced ?
        ("Replaced trip " + merge.tripId + " (" + fp + ") with this " +
            "page's shots; the whole survey redrew as one merged model.") :
        ("Added this page as new trip " + merge.tripId + " (" + fp +
            ") alongside the drawing's existing trips.");

    // No RevisionLog anymore (Nathan, 2026-08-27): Drive's version
    // history is the record, and the unbounded tag line is what bricked
    // Truitt Cave's reopen (dxflib reads at most 1024 chars per line).
    // The erase above already deleted any stale one with its anchor.

    // What the page couldn't show, said out loud: the user has to be
    // able to tell preserved data from lost data without opening tags.
    var carried = merge.carried;
    var carryBits = [];
    var shotWord = function(n) {
        return n + " shot" + (n === 1 ? "" : "s");
    };
    if (carried.backsights > 0) {
        carryBits.push("kept the backsight readings on " +
            shotWord(carried.backsights));
    }
    if (carried.flags > 0) {
        carryBits.push("kept the exclusion flags on " +
            shotWord(carried.flags));
    }
    if (carried.droppedBacksights > 0) {
        carryBits.push("dropped the backsight on " +
            shotWord(carried.droppedBacksights) + " whose azimuth or " +
            "inclination the page changed, since it would no longer " +
            "agree with the foresight");
    }
    var carryLine = carryBits.length === 0 ? "" :
        (" Backsights and exclusion flags have no cells on the page, " +
            "so they carried over from the shots the drawing already " +
            "held: " + carryBits.join("; ") + ".");

    EAction.handleUserMessage("Survey Notebook: " + tripLine + carryLine +
        lwLine + geoLine);
    QMessageBox.information(null, "Survey Notebook",
        tripLine + carryLine + "\n\n" +
        (replaced > 0 ? ("Replaced " + replaced + " previously drawn " +
            "mark" + (replaced === 1 ? "" : "s") + " (undo twice to " +
            "restore them).\n\n") : "") +
        CsReport.drawSummary(merged, resolved, drawn, findings) + lwLine +
        geoLine +
        "\n\nDrawn as one undo step" +
        (replaced > 0 ? " after the replace" : "") +
        // said out loud because it changes what one undo does: the
        // linework move is its own operation, exactly as it is on
        // CsRevise.apply's path -- and the automatic binding is another
        // one in front of it, which is why the count is named here
        (lwBound > 0 ? "; binding " + lwBound + " untagged item" +
            (lwBound === 1 ? "" : "s") + " was a further one" : "") +
        (lw !== null && (lw.moved > 0 || lw.warped > 0) ?
            "; the linework move is a further one" : "") +
        // and the log write is the last one, for the same reason: a
        // user undoing back past the redraw needs to know how many
        // steps that is. Named for the write, not for the new entry --
        // it is an operation either way, since even a Draw that appends
        // nothing has to carry the existing log across the erase

        ".");
};

SurveyNotebook.importFile = function(w) {
    var fileName = CsFiles.openFile(null,
        "Import survey file", "", CsFormatRegistry.combinedFileFilter());
    if (isNull(fileName) || String(fileName) === "") {
        return;
    }
    var f = new QFile(fileName);
    if (!f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not open " + fileName);
        return;
    }
    var content = new QTextStream(f).readAll();
    f.close();

    var format = CsFormatRegistry.detect(fileName, content);
    if (format === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't detect the format of that file.");
        return;
    }
    var survey = format.parse(content, CsFormatRegistry.optionsFor(fileName));
    if (survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No shots parsed (format tried: " + format.label + ").");
        return;
    }
    SurveyNotebook.setSurvey(w, survey);
};

SurveyNotebook.exportFile = function(w) {
    var survey = SurveyNotebook.sheetSurvey(w);
    if (survey.shots.length === 0) {
        QMessageBox.information(null, "Survey Notebook", "Nothing to export.");
        return;
    }
    var labels = [];
    for (var i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        labels.push(CsFormatRegistry.FORMATS[i].label);
    }
    var choice = getItem("Survey Notebook", "Export as which format?",
        labels.join("|"), 0, "|");
    if (choice === undefined) {
        return;
    }
    var format = null;
    for (i = 0; i < CsFormatRegistry.FORMATS.length; i++) {
        if (CsFormatRegistry.FORMATS[i].label === choice) {
            format = CsFormatRegistry.FORMATS[i];
        }
    }
    var fileName = CsFiles.saveFile(null,
        "Export " + format.label, "", format.fileFilter);
    if (isNull(fileName) || String(fileName) === "") {
        return;
    }
    var content = format.write(survey);
    var f = new QFile(fileName);
    if (!f.open(QIODevice.WriteOnly | QIODevice.Text)) {
        QMessageBox.warning(null, "Survey Notebook",
            "Could not write " + fileName);
        return;
    }
    var stream = new QTextStream(f);
    stream.writeString(content);
    f.close();
    EAction.handleUserMessage("Survey Notebook: exported " +
        survey.shots.length + " shots to " + fileName);
};

/**
 * Offers to keep a PROMPTED location as the drawing's geo anchor --
 * GeoLat/GeoLon/GeoStation on one station point.
 *
 * This is where the Geo Reference tool's actual job lives now. The
 * anchor is the drawing's one tie to real-world coordinates, and three
 * separate things read it: the aerial basemap places imagery by it,
 * CsRevise.apply PIVOTS every revision on the station that carries it
 * (so it decides what "the drawing rotated" even means), and any
 * real-world export derives coordinates from it. Without this, asking
 * the user where the cave is -- which the Infer path already does --
 * would throw that answer away, and the only remaining way to
 * establish an anchor would be inserting an aerial photo.
 *
 * Four rules, all of them about not surprising anyone:
 *
 *   ASK        being prompted for a location is not consent to modify
 *              the drawing. Declining leaves the drawing untouched and
 *              the estimate is still made.
 *   NEVER MOVE an existing anchor. Re-anchoring is a deliberate act,
 *              and silently relocating it would move a revision's
 *              rotation centre out from under the user.
 *   NAME IT    the confirmation says which station will carry it, so
 *              the choice is never a silent guess.
 *   NO CARRIER, NO OFFER. A blank page with nothing drawn has no
 *              station to tag, and inventing an entity to hold the
 *              anchor would put the pivot somewhere arbitrary.
 *
 * The carrier is the single SELECTED station point when there is one,
 * otherwise the survey's first station (trip 0's anchor -- the
 * entrance, customarily, which is also where the revision pivot
 * already sits).
 *
 * Note that only PROMPTED locations get here. The per-trip declination
 * dialog's IGRF fills read the anchor and never ask for a location, so
 * they have nothing to offer to store.
 *
 * \return {station} when the anchor was written, null otherwise
 *         (no document, already anchored, no carrier, declined, or
 *         this bridge refused the question or the write)
 */
SurveyNotebook.offerGeoAnchor = function(doc, coord) {
    if (doc === undefined || doc === null || coord === null ||
            coord === undefined) {
        return null;
    }
    // Already anchored: leave it exactly where it is. getShared reports
    // source "anchor" only for a GeoLat/GeoLon pair found in THIS
    // drawing (a remembered app-level location is "last").
    var known = CsLocationPick.getShared(doc);
    if (known !== null && known.source === "anchor") {
        return null;
    }

    // ---- who carries it --------------------------------------------
    var carrier = null;
    try {
        if (doc.hasSelection()) {
            var sids = doc.querySelectedEntities();
            if (sids.length === 1) {
                var se = doc.queryEntity(sids[0]);
                if (!isNull(se) && typeof se.getPosition === "function" &&
                        CsTags.get(se, "Station") !== "") {
                    carrier = se;
                }
            }
        }
    } catch (eSel) {
        carrier = null; // no selection to read: fall through to trip 0
    }
    if (carrier === null) {
        var wanted = "";
        try {
            wanted = CsRevise.surveyFromDocument(doc).anchorName;
        } catch (eRe) {
            wanted = "";
        }
        if (wanted === "" || wanted === null || wanted === undefined) {
            return null; // nothing drawn: no station to tag
        }
        var stations = CsTags.collectStations(doc);
        for (var i = 0; i < stations.length; i++) {
            if (stations[i].name === wanted) {
                carrier = stations[i].entity;
                break;
            }
        }
        if (carrier === null) {
            return null;
        }
    }

    var stationName = CsTags.get(carrier, "Station");
    var shown = stationName !== "" ? ("station " + stationName) :
        "the selected point";

    var answer;
    try {
        answer = QMessageBox.question(null, "Survey Notebook",
            "Store " + coord.lat.toFixed(6) + ", " + coord.lon.toFixed(6) +
            " as this drawing's geo anchor, on " + shown + "?\n\n" +
            "The anchor is the drawing's tie to real-world coordinates: " +
            "aerial imagery aligns to it, revisions pivot on it, and " +
            "exports derive coordinates from it. The drawing's geometry " +
            "is NOT changed.\n\n" +
            "No just uses the location for this estimate.",
            QMessageBox.Yes | QMessageBox.No);
    } catch (eQ) {
        return null; // no question, no write -- the estimate stands alone
    }
    if (answer !== QMessageBox.Yes) {
        return null;
    }

    try {
        // A MODIFY OPERATION is what actually persists tags on an
        // entity already in the document -- transaction-wrapped
        // property writes fail silently in this bridge, which is why
        // CsTags.commit exists. Same three tags, same mechanism as
        // GeoReference.js used, so every existing reader finds it.
        var geoTags = {
            GeoLat: coord.lat,
            GeoLon: coord.lon,
            GeoStation: stationName !== "" ? stationName : "anchor"
        };
        // pin WHERE the coordinate was declared -- what lets the
        // ground-window tools detect a later deliberate move of the
        // station over imagery (CsLocationPick.resolveMovedAnchor)
        if (typeof carrier.getPosition === "function") {
            var cpos = carrier.getPosition();
            geoTags.GeoDrawX = cpos.x;
            geoTags.GeoDrawY = cpos.y;
        }
        CsTags.commit(getDocumentInterface(), carrier, geoTags);
        CsLocationPick.remember(coord);
    } catch (eW) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't store the geo anchor (" + eW +
            "). The estimate above still stands.");
        return null;
    }
    return { station: stationName !== "" ? stationName : "anchor" };
};

/**
 * The PROACTIVE half of the anchor workflow: with a real location
 * finally known, VOLUNTEER the trips whose recorded declination
 * disagrees with the IGRF estimate for their own dates at that spot --
 * "your 1998 trips are 2.5 deg off" -- instead of waiting for someone
 * to open the Declination... dialog and notice. This was the Geo
 * Reference tool's other job, and it is the half a user can't ask for
 * because they don't yet know there is anything to ask about.
 *
 * Only ever after offerGeoAnchor actually WROTE an anchor. A declined
 * offer must not be turned into a revision campaign, and an anchor
 * that already existed is not news -- without a freshly stored,
 * authoritative location there is nothing new to compare against.
 *
 * Everything here is a BONUS on top of an anchor that is ALREADY
 * COMMITTED and already reported, so every call is wrapped: a throw
 * must fall through quietly, never turn a stored anchor into an error.
 * And when nothing qualifies, NOTHING is shown -- a proactive offer
 * that interrupts with "no changes needed" is just noise.
 *
 * \param doc   the drawing the anchor was just written to
 * \param coord the stored anchor coordinate {lat, lon}
 */
SurveyNotebook.offerIgrfTripRevisions = function(doc, coord) {
    if (doc === undefined || doc === null || coord === null ||
            coord === undefined) {
        return;
    }
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        return; // unreadable tags: the anchor above still stands
    }
    // NEVER offer on a legacy (pre-v3) reconstruction. Those trips'
    // declination records are themselves part of the chain-guess the
    // legacy reader had to make, so revising them is revising a guess
    // -- which is exactly how drawings drift. Same refusal the
    // Declination... dialog makes out loud; here it stays silent,
    // because nobody asked for this offer. A drawing with no shots has
    // nothing to revise either.
    if (recon.legacy === true || recon.survey.shots.length === 0) {
        return;
    }

    var candidates;
    try {
        candidates = CsRevise.tripsNeedingRevision(recon.survey,
            coord.lat, coord.lon);
    } catch (eCa) {
        return;
    }
    if (candidates.length === 0) {
        return; // nothing disagrees: no dialogs at all
    }

    var marked = [];
    for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci];
        var answer;
        try {
            // IGRF is shown at 2 decimals here because that's the
            // precision reviseDeclination is actually handed below --
            // see the rounding comment in CsRevise.tripsNeedingRevision.
            answer = QMessageBox.question(null, "Survey Notebook",
                "Trip " + c.tripId + " (" + c.date +
                (c.team !== "" ? ", " + c.team : "") + "): recorded " +
                c.recorded.toFixed(2) + " deg, IGRF estimates " +
                c.igrf.toFixed(2) + " deg here. " +
                "Revise this trip's azimuths?",
                QMessageBox.Yes | QMessageBox.No);
        } catch (eQ) {
            // This bridge refused the question. Asking about the rest
            // would fail the same way, and applying what was accepted
            // so far would revise trips off a half-asked question --
            // so drop the whole offer.
            return;
        }
        if (answer === QMessageBox.Yes) {
            marked.push(c);
        }
    }
    if (marked.length === 0) {
        return; // everything declined: silent, exactly as asked
    }

    // CsRevise.apply's contract: recon stays the PRISTINE
    // reconstruction; the revision mutates a SECOND reconstruction of
    // the same drawing (the document is untouched since the first scan,
    // so the two start identical). One apply covers every accepted trip.
    var revised;
    try {
        revised = CsRevise.surveyFromDocument(doc).survey;
        for (var mi = 0; mi < marked.length; mi++) {
            CsRevise.reviseDeclination(revised, marked[mi].tripId,
                marked[mi].igrf, "igrf");
        }
    } catch (eRv) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't prepare the declination revision (" + eRv +
            "). Nothing further was changed; the geo anchor was still " +
            "stored.");
        return;
    }

    var report;
    try {
        report = CsRevise.apply(doc, getDocumentInterface(), recon, revised);
    } catch (eAp) {
        QMessageBox.warning(null, "Survey Notebook",
            "Applying the declination revision failed (" + eAp +
            "). If the drawing looks half-moved, undo restores it. The " +
            "geo anchor was still stored.");
        return;
    }
    EAction.handleUserMessage(CsReport.revisionSummary(report));
};

/**
 * Infer: the estimate for THIS PAGE's own header, from the header's
 * date and the cave's location. It fills a text field and touches
 * nothing else -- except that a location it had to ASK for is offered
 * to the drawing as its geo anchor (see offerGeoAnchor).
 *
 * Do NOT "unify" this with the Declination... button below. They do
 * different jobs on different data: Infer estimates a declination for
 * the trip the page is about to draw (the page's magnetic azimuth
 * cells are converted with it on the next Draw), while Declination...
 * REVISES trips already stored in the drawing -- rotating their
 * recorded shots and logging the change. Merging them would mean
 * either an estimate that silently rewrites the drawing, or a
 * revision that can't be used until the page holds the trip.
 */
SurveyNotebook.inferDeclination = function(w) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(w.dateEdit.text));
    if (m === null) {
        QMessageBox.information(null, "Survey Notebook",
            "Enter the survey date (YYYY-MM-DD) in the header first -- " +
            "declination drifts over the years, so the date matters.");
        return;
    }

    // the drawing's anchor is authoritative and skips the prompt;
    // otherwise ask, prefilled with the last declared location
    var coord = null;
    var prompted = false;
    var shared = CsLocationPick.getShared(getDocument());
    if (shared !== null && shared.source === "anchor") {
        coord = shared;
    } else {
        coord = CsLocationPick.ask("Survey Notebook", "");
        if (coord === null) {
            return;
        }
        prompted = true;
    }

    var result = CsGeomag.declination(coord.lat, coord.lon, {
        year: parseInt(m[1], 10), month: parseInt(m[2], 10),
        day: parseInt(m[3], 10)
    });
    if (result === null) {
        QMessageBox.warning(null, "Survey Notebook",
            "That date is before 1900 -- outside the IGRF model.");
        return;
    }
    w.declEdit.text = result.declination.toFixed(2);
    w.declSource = "igrf";

    // A location the user just typed is worth more than one estimate:
    // offered to the drawing as its geo anchor, since nothing else in
    // the notebook establishes one. Only for a PROMPTED coordinate --
    // one read off the drawing's own anchor is already stored.
    var anchored = prompted ?
        SurveyNotebook.offerGeoAnchor(getDocument(), coord) : null;
    var anchorLine = anchored === null ? "" :
        ("\n\nGeo anchor stored on station " + anchored.station +
            " -- this drawing's tie to real-world coordinates. Aerial " +
            "imagery aligns to it and revisions pivot on it; the " +
            "geometry was not changed.");
    if (anchored !== null) {
        EAction.handleUserMessage("Survey Notebook: geo anchor stored on " +
            "station " + anchored.station + " at " +
            coord.lat.toFixed(6) + ", " + coord.lon.toFixed(6) + ".");
    }

    QMessageBox.information(null, "Survey Notebook",
        CsReport.igrfLine(result, coord.lat, coord.lon, String(w.dateEdit.text)) +
        "\n\nFilled into the header -- edit it freely; it stays your call." +
        anchorLine);

    // A freshly WRITTEN anchor is the first authoritative location this
    // drawing has had, so it is also the moment to volunteer the trips
    // already in the drawing whose recorded declination disagrees with
    // IGRF for their own dates here. Only on a write: 'anchored' is
    // null when the user declined, when an anchor already existed, and
    // when there was no station to carry one. Asked AFTER the estimate
    // is delivered above, so the anchor-stored news lands before any
    // follow-up question -- not interleaved with it.
    if (anchored !== null) {
        SurveyNotebook.offerIgrfTripRevisions(getDocument(), coord);
    }
};

// ---------------------------------------------------------------------
// Per-trip declination revision: the drawing's OWN trips, corrected in
// place. This is the revision framework's whole point -- drop in the
// declination a trip should have had and the drawing adjusts -- and it
// works on trips the page never has to hold.
//
// HOW THIS RELATES TO THE HEADER'S Decl FIELD. Both can change a
// trip's declination, and they do not do the same thing:
//
//   header Decl + Draw   The page's azimuth cells are magnetic, so
//                        re-drawing with a different Decl produces
//                        exactly the same TRUE azimuths this dialog
//                        would (cell + D' == old_true - D + D'), and
//                        since declination came OUT of the fingerprint
//                        the page still matches the trip it was loaded
//                        from: it REPLACES that trip rather than
//                        forking a duplicate beside it. Backsights and
//                        exclusion flags carry over as usual.
//   this dialog          Rotates the trip's stored azimuths (and its
//                        backsights) by the difference and keeps the
//                        trip where it is. One CsRevise.apply.
//
// So both paths land the same geometry on the same trip
// instead of the dialog. What still differs is REACH and MEANING: the
// dialog corrects any trip in the drawing without the page having to
// hold it, and what it writes is a correction ("this trip's
// declination was wrong"), where the header field is a reading
// condition ("this is the declination these cells were taken under").
// Prefer the dialog for "the declination was wrong".
// ---------------------------------------------------------------------

/**
 * Declination... : the guard rail in front of the dialog. A drawing
 * whose reconstruction is a guess (legacy pre-v3 tags) must not be
 * revised -- revising a guess is how drawings drift -- so it is sent
 * to Repair Drawing instead.
 */
SurveyNotebook.reviseDeclinations = function(w) {
    // Any failure in here must be SEEN, not swallowed by the engine.
    try {
        SurveyNotebook.reviseDeclinationsInner(w);
    } catch (e) {
        QMessageBox.warning(null, "Survey Notebook",
            "Declination revision failed inside this build's bridge:\n\n" +
            e + "\n\n" +
            (e.stack ? String(e.stack).substring(0, 600) : "") +
            "\n\nPlease report this text.");
    }
};

SurveyNotebook.reviseDeclinationsInner = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't read the survey back from this drawing (" + eRe + ").");
        return;
    }
    if (recon.legacy === true) {
        QMessageBox.information(null, "Survey Notebook",
            "This drawing's survey predates the exact tag schema, so " +
            "its shots can't be revised safely from what's stored.\n\n" +
            "Run Repair Drawing (command: rep) " +
            "first -- it upgrades the tags in place -- then revise the " +
            "declination per trip.");
        return;
    }
    if (recon.survey.shots.length === 0) {
        QMessageBox.warning(null, "Survey Notebook",
            "No survey shots found in this drawing -- there is no trip " +
            "declination to revise. Use Infer beside the header's Decl " +
            "for the page you are about to draw.");
        return;
    }
    SurveyNotebook.tripDeclinationDialog(doc, recon);
};

/**
 * The per-trip revision dialog over a v3-tagged survey: one row per
 * trip (label, recorded value and source, editable field, per-trip
 * IGRF), applied through CsRevise in one operation.
 *
 * GUI only: every decision (what changed, what source, what's
 * invalid) is made by CsRevise.parseTripEdits over plain data
 * snapshotted from the widgets, so the logic stays headlessly
 * testable. Built from QLabel/QLineEdit in a QGridLayout because this
 * bridge has no QTableWidget, and every construction step is wrapped:
 * a refused widget must report itself, not kill the dock.
 */
SurveyNotebook.tripDeclinationDialog = function(doc, recon) {
    CsModel.ensureTrips(recon.survey);
    var trips = recon.survey.trips;

    // IGRF fills only from the DRAWING'S OWN geo reference -- a
    // remembered location from some other cave would be silently
    // wrong here. CsLocationPick.getShared scans the entities for
    // GeoLat/GeoLon and labels a hit source:"anchor".
    var geo = CsLocationPick.getShared(doc);
    if (geo !== null && geo.source !== "anchor") {
        geo = null;
    }

    // one connect failure on a critical control = unusable dialog
    var connectOk = function(signal, fn) {
        try {
            signal.connect(fn);
            return true;
        } catch (e) {
            return false;
        }
    };

    var state = { accepted: false, rowsData: null };
    var rows = []; // {tripId, recorded, edit, igrfText}
    var dlg;

    try {
        dlg = new QDialog(getMainWindow());
        dlg.windowTitle = "Declination";
        var layout = new QVBoxLayout();

        var intro = new QLabel(
            "Trips already in this drawing. Drop in the correct\n" +
            "declination per trip (degrees, east positive) and the\n" +
            "drawing adjusts: azimuths rotate by the difference and\n" +
            "the change is logged. This is the place to correct a\n" +
            "declination -- the page's own Decl field is the value\n" +
            "the page's readings were taken under.\n" +
            "IGRF fills the estimate for a trip's date -- it needs a\n" +
            "geo-referenced station in the drawing and a YYYY-MM-DD\n" +
            "trip date.");
        layout.addWidget(intro, 0, 0);

        var grid = new QGridLayout();
        grid.addWidget(new QLabel("Trip"), 0, 0);
        grid.addWidget(new QLabel("Recorded"), 0, 1);
        grid.addWidget(new QLabel("New declination"), 0, 2);

        for (var t = 0; t < trips.length; t++) {
            var trip = trips[t];
            var gridRow = t + 1;
            grid.addWidget(new QLabel(CsRevise.tripLabel(t, trip)),
                gridRow, 0);
            grid.addWidget(new QLabel(CsRevise.recordedText(trip)),
                gridRow, 1);

            var edit = new QLineEdit();
            edit.text = CsRevise.declText(trip.declination);
            grid.addWidget(edit, gridRow, 2);

            var igrfBtn = new QPushButton("IGRF");
            var tripDate = CsRevise.parseIsoDate(trip.date);

            var row = { tripId: t, recorded: trip.declination,
                edit: edit, igrfText: "", date: tripDate,
                tripDateText: trip.date };
            rows.push(row);

            // The handler re-checks every precondition itself, on the
            // live 'geo'/'tripDate' values, and is wired UNCONDITIONALLY
            // -- not only when the preconditions currently hold. That
            // way the disabling below is purely cosmetic: if this
            // bridge ever rejects the 'enabled = false' write (caught
            // below), the button stays clickable but is never wired to
            // nothing -- clicking it always either fills the field or
            // says exactly why it can't. Said in a message box, not on
            // the command line: this dialog is modal, so a command-line
            // warning would go unread behind it.
            // closure per row -- capture row, date and trip now
            (function(r, d, tr) {
                connectOk(igrfBtn.clicked, function() {
                    if (geo === null) {
                        QMessageBox.warning(null, "Survey Notebook",
                            "No geo reference in this drawing -- pin a " +
                            "station to a latitude/longitude first, then " +
                            "IGRF can fill from it.");
                        return;
                    }
                    if (d === null) {
                        QMessageBox.warning(null, "Survey Notebook",
                            "Trip " + r.tripId + "'s date (\"" + tr.date +
                            "\") isn't YYYY-MM-DD, so IGRF can't be " +
                            "evaluated for it -- give the trip a date in " +
                            "that form.");
                        return;
                    }
                    var res = CsGeomag.declination(geo.lat, geo.lon, d);
                    if (res === null) {
                        QMessageBox.warning(null, "Survey Notebook",
                            d.year + " is before 1900, outside the IGRF " +
                            "model.");
                        return;
                    }
                    // 2 decimals is the suite-wide IGRF-apply
                    // convention -- the header's Infer button rounds to
                    // the same precision, and parseTripEdits judges
                    // "unchanged" at 4. Keeping every IGRF fill at 2
                    // decimals means a trip revised in one place reads
                    // back as unchanged in the other.
                    var txt = res.declination.toFixed(2);
                    r.edit.text = txt;
                    r.igrfText = txt;
                });
            })(row, tripDate, trip);

            if (geo !== null && tripDate !== null) {
                igrfBtn.toolTip = "Fill the IGRF estimate for " +
                    trip.date + " at the drawing's geo reference.";
            } else {
                igrfBtn.toolTip = geo === null ?
                    "No geo reference in this drawing -- pin a station " +
                    "to a latitude/longitude to enable IGRF fills." :
                    "This trip's date isn't YYYY-MM-DD, so IGRF " +
                    "can't be evaluated for it.";
                try {
                    igrfBtn.enabled = false;
                } catch (eDis) {
                    // stays enabled -- the click handler above re-checks
                    // and explains itself, so this is cosmetic only
                }
            }
            grid.addWidget(igrfBtn, gridRow, 3);
        }
        layout.addLayout(grid, 0);

        var buttons = new QHBoxLayout();
        // The whole cave in one pass: every trip's estimate from the
        // drawing's geo reference and that trip's own date. Only FILLS
        // the fields -- the recorded-vs-estimate rows stay reviewable,
        // and nothing rotates until Apply.
        var igrfAllBtn = new QPushButton("IGRF All");
        igrfAllBtn.toolTip = "Fill every trip's declination estimate " +
            "from the drawing's geo reference and each trip's own " +
            "date. Review the rows, then Apply revises them together.";
        buttons.addWidget(igrfAllBtn, 0, 0);
        buttons.addStretch(1);
        var applyBtn = new QPushButton("Apply");
        var cancelBtn = new QPushButton("Cancel");
        buttons.addWidget(applyBtn, 0, 0);
        buttons.addWidget(cancelBtn, 0, 0);
        layout.addLayout(buttons, 0);

        connectOk(igrfAllBtn.clicked, function() {
            if (geo === null) {
                QMessageBox.warning(null, "Survey Notebook",
                    "No geo reference in this drawing -- pin a station " +
                    "to a latitude/longitude first, then IGRF can fill " +
                    "from it.");
                return;
            }
            var filled = 0;
            var skipped = [];
            for (var fi = 0; fi < rows.length; fi++) {
                var fr = rows[fi];
                if (fr.date === null) {
                    skipped.push("Trip " + fr.tripId + ": date \"" +
                        fr.tripDateText + "\" isn't YYYY-MM-DD");
                    continue;
                }
                var res = CsGeomag.declination(geo.lat, geo.lon, fr.date);
                if (res === null) {
                    skipped.push("Trip " + fr.tripId + ": " +
                        fr.date.year + " is before 1900, outside IGRF");
                    continue;
                }
                // same 2-decimal convention as the per-row button and
                // the header's Infer
                var txt = res.declination.toFixed(2);
                fr.edit.text = txt;
                fr.igrfText = txt;
                filled++;
            }
            if (skipped.length > 0) {
                QMessageBox.warning(null, "Survey Notebook",
                    filled + " of " + rows.length + " trips filled " +
                    "from IGRF. Not filled:\n\n" + skipped.join("\n") +
                    "\n\nThose rows keep their recorded value; fix the " +
                    "trip date and run IGRF All again, or type a value.");
            }
        });

        dlg.setLayout(layout);

        var wired = connectOk(applyBtn.clicked, function() {
            // snapshot the widgets into plain data HERE, while they
            // are certainly alive; decisions happen after exec()
            var data = [];
            for (var i = 0; i < rows.length; i++) {
                data.push({ tripId: rows[i].tripId,
                    recorded: rows[i].recorded,
                    text: String(rows[i].edit.text),
                    igrfText: rows[i].igrfText });
            }
            state.rowsData = data;
            state.accepted = true;
            dlg.accept();
        });
        wired = connectOk(cancelBtn.clicked, function() {
            dlg.reject();
        }) && wired;
        if (!wired) {
            QMessageBox.warning(null, "Survey Notebook",
                "This build's script bridge couldn't wire the dialog " +
                "buttons. Nothing was changed.");
            return;
        }

        dlg.exec();
    } catch (eDlg) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't build the revision dialog (" + eDlg +
            "). Nothing was changed.");
        return;
    }

    if (!state.accepted || state.rowsData === null) {
        return; // cancelled
    }

    // ---- decide (pure) ------------------------------------------------
    var decision = CsRevise.parseTripEdits(state.rowsData);
    if (decision.error !== undefined) {
        QMessageBox.warning(null, "Survey Notebook", decision.error);
        return;
    }
    if (decision.changes.length === 0) {
        QMessageBox.information(null, "Survey Notebook",
            "No declination changes.");
        return;
    }

    // ---- apply ----------------------------------------------------------
    // CsRevise.apply diffs the OLD model against the NEW: it needs a
    // PRISTINE reconstruction for its recon argument. reviseDeclination
    // mutates in place, so reconstruct a second time (the document is
    // untouched since the first scan -- the two are identical) and
    // mutate only the copy the dialog was built from.
    var pristine;
    try {
        pristine = CsRevise.surveyFromDocument(doc);
    } catch (ePr) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't re-read the survey (" + ePr +
            "). Nothing was changed.");
        return;
    }

    for (var c = 0; c < decision.changes.length; c++) {
        var ch = decision.changes[c];
        CsRevise.reviseDeclination(recon.survey, ch.tripId, ch.value,
            ch.source);
    }

    var report;
    try {
        report = CsRevise.apply(doc, getDocumentInterface(), pristine,
            recon.survey);
    } catch (eAp) {
        QMessageBox.warning(null, "Survey Notebook",
            "Applying the revision failed (" + eAp +
            "). If the drawing looks half-moved, undo restores it.");
        return;
    }

    // Name the trips out loud: revisionSummary reports stations, loops
    // and the anchor, but never which trip moved -- and the whole point
    // of the dialog was picking one.
    var tripBits = [];
    for (c = 0; c < decision.changes.length; c++) {
        tripBits.push("trip " + decision.changes[c].tripId + " -> " +
            CsRevise.declText(decision.changes[c].value) +
            " (" + decision.changes[c].source + ")");
    }
    var summary = "Declination revised: " + tripBits.join(", ") + "\n\n" +
        CsReport.revisionSummary(report);
    EAction.handleUserMessage(summary);
    QMessageBox.information(null, "Survey Notebook", summary);
};

// ---------------------------------------------------------------------
// Linework binding: automatic, and one entry that says so
//
// The feature needs no button to work. Every revision binds what it can
// recognise and moves it (CsBind.planAutoBind, CsRevise.moveLinework),
// so the ordinary user never comes here at all. What is left for this
// entry is the part a user is entitled to control and to understand:
//
//   the SWITCH   automatic binding writes tags onto geometry the
//                surveyor drew. Nothing else in the suite does that, so
//                it can be turned off -- and the off state is the
//                interesting one, which is why the button itself shows
//                "Linework: auto OFF" and the live status box carries a
//                line while it lasts. On is the default and needs no
//                announcement.
//   ADOPT        claim linework NOW, with a count of what binds to what
//                before it commits. Mostly redundant since a revision
//                would claim the same entities anyway, but it is the
//                only way to SEE the answer before it is written -- and
//                the only way to bind a stroke that binds to no station
//                at all, which the automatic passes refuse to guess at.
//
// What used to live here was ARMING, and it is gone. It made the user
// responsible for remembering, and it was less correct than inference:
// the trip now comes from the stations a tracing binds to, so a wall
// traced against trip 2 is tagged trip 2 even while this page shows
// trip 1 -- which the armed version got wrong, silently, and only
// revealed by moving the wrong passage months later.
// ---------------------------------------------------------------------


/** The page's trip identity: date | team, the same fingerprint
 *  mergeTripIntoSurvey matches on. Read straight off the two header
 *  cells -- no document access, so refresh() can call it per keystroke. */
SurveyNotebook.pageFingerprint = function(w) {
    return CsModel.tripFingerprint({ date: String(w.dateEdit.text),
        team: String(w.teamEdit.text) });
};

/**
 * Which trip in the DRAWING this page currently is: the one whose
 * fingerprint matches the header. Adopt needs it as the FALLBACK trip
 * for entities that bind to no station of their own -- everything that
 * does bind gets its trip inferred from those stations instead (see
 * tripStations below), so the page's identity is now the answer of last
 * resort rather than the answer.
 *
 * \return {tripId, label, fingerprint, doc, tripStations} or {error} --
 *         the error is already phrased for a message box.
 */
SurveyNotebook.pageTrip = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        return { error: "No drawing is open." };
    }
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        return { error: "Couldn't read the survey back from this " +
            "drawing (" + eRe + ")." };
    }
    if (recon.legacy === true) {
        return { error: "This drawing's survey predates the exact tag " +
            "schema, so its trips can't be identified reliably -- and " +
            "linework has to be tied to a trip id.\n\nRun Repair " +
            "Drawing (command: rep) first." };
    }
    if (recon.survey.shots.length === 0) {
        return { error: "Nothing is drawn in this drawing yet. Draw " +
            "this page first -- linework binds to a trip that exists." };
    }
    CsModel.ensureTrips(recon.survey);
    var fp = SurveyNotebook.pageFingerprint(w);
    // Which trip owns which station, for the inference. Read from the
    // reconstruction, the same source both revision paths read it from,
    // so Adopt and a revision cannot attribute one stroke differently.
    var tripStations = CsRevise.tripStationNames(recon.survey);
    for (var t = 0; t < recon.survey.trips.length; t++) {
        if (CsModel.tripFingerprint(recon.survey.trips[t]) === fp) {
            return { tripId: t, fingerprint: fp, doc: doc,
                tripStations: tripStations,
                label: CsRevise.tripLabel(t, recon.survey.trips[t]) };
        }
    }
    return { error: "This page's trip (" + fp + ") isn't in the " +
        "drawing yet, so there is no trip id to bind linework to.\n\n" +
        "Draw the page first, or Load from drawing to work on a trip " +
        "that is already there." };
};

/**
 * The status-box line about binding: "" while it is ON.
 *
 * Deliberately silent in the default state. A permanent banner saying
 * the suite is doing its job is noise a surveyor learns to stop
 * reading, and then the ONE state worth noticing -- switched off, so
 * nothing will follow the survey -- reads as more of the same. So only
 * OFF speaks.
 */
SurveyNotebook.autoBindStatusLine = function(w) {
    if (CsBind.autoBindEnabled()) {
        return "";
    }
    return "AUTOMATIC LINEWORK BINDING IS OFF -- hand-drawn walls and " +
        "detail will NOT follow the survey when a trip is revised " +
        "unless you bind them yourself (Linework... > Adopt).";
};

/** Shows the switch on the button. Only the OFF state is worth a label:
 *  see autoBindStatusLine. CsBind owns the state; this displays it. */
SurveyNotebook.updateLineworkButton = function(w) {
    if (w.lineworkButton === undefined) {
        return;
    }
    var on = CsBind.autoBindEnabled();
    try {
        w.lineworkButton.text = on ? "Linework..." : "Linework: auto OFF";
    } catch (eT) {
        // a button that won't be renamed still reports state in the
        // status box and in its own dialog
    }
    try {
        // pressed = the non-default state, matching the label
        w.lineworkButton.checked = !on;
    } catch (eC) {
        // no checkable buttons in this bridge: the label carries it
    }
    try {
        w.lineworkButton.toolTip = on ?
            ("Hand-drawn linework binds itself: a revision works out " +
                "which stations your walls and detail were drawn " +
                "against, tags them, and moves them with the passage. " +
                "Click to see what that means, to adopt linework now, " +
                "or to switch it off.") :
            ("Automatic linework binding is OFF: revising a trip will " +
                "move the survey and leave your tracing behind. Click " +
                "to switch it back on, or to adopt linework by hand.");
    } catch (eTt) {
        // tooltip is a nicety
    }
};

/** Throws the switch, says so, and leaves the panel telling the truth. */
SurveyNotebook.setAutoBind = function(w, on) {
    // snapshotted so only a failure OF THIS CALL is reported: lastError
    // may be holding some older tagging problem, and blaming the switch
    // for it would send the user looking in the wrong place
    var wasError = CsBind.lastError;
    var now = CsBind.setAutoBindEnabled(on);
    SurveyNotebook.updateLineworkButton(w);
    SurveyNotebook.refresh(w);
    var said = now ?
        ("Survey Notebook: automatic linework binding is ON. Revisions " +
            "will bind and move hand-drawn work that they can tie to " +
            "the survey, and say how much they claimed.") :
        ("Survey Notebook: automatic linework binding is OFF. Nothing " +
            "will be tagged for you; linework already bound still " +
            "moves with its stations.");
    if (CsBind.lastError !== wasError && CsBind.lastError !== "") {
        said += " (" + CsBind.lastError + ")";
    }
    EAction.handleUserMessage(said);
};

/**
 * Adopt: tag what is ALREADY drawn, NOW. Previews the counts by binding
 * source before it commits, so the user sees which of their strokes
 * actually found stations instead of a silent sweep.
 *
 * Kept even though a revision would claim the same entities by itself,
 * for the two things only it does: it SHOWS the answer before writing
 * it, and it will claim an entity that binds to no station at all --
 * which the automatic passes refuse, since with no station there is no
 * trip to infer and no stations to follow. Here the user names the trip
 * and sees the count, so "follow trip N as a whole" is their decision.
 */
SurveyNotebook.adoptLinework = function(w) {
    var pt = SurveyNotebook.pageTrip(w);
    if (pt.error !== undefined) {
        QMessageBox.warning(null, "Survey Notebook", pt.error);
        return;
    }
    var items;
    try {
        // The page's trip is the FALLBACK; each entity that binds to
        // stations takes the trip those stations belong to, exactly as
        // a revision would work it out.
        items = CsBind.adoptable(pt.doc, pt.tripId, pt.tripStations);
    } catch (eAd) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't scan this drawing for linework (" + eAd +
            "). Nothing was changed.");
        return;
    }
    var c = CsBind.countBySource(items);
    if (c.total === 0) {
        QMessageBox.information(null, "Survey Notebook",
            "Nothing to adopt: every entity on a linework layer in " +
            "this drawing is either already bound or is the suite's " +
            "own geometry.");
        return;
    }
    var bound = c.snap + c.proximity + c.far;
    var answer = QMessageBox.question(null, "Survey Notebook",
        "Bind " + c.total + " untagged entit" +
        (c.total === 1 ? "y" : "ies") + "?\n\n" +
        bound + " will bind to stations (" + c.snap +
        " snapped exactly to station, LRUD or splay points, " +
        c.proximity + " by proximity, " + c.far + " far from every " +
        "station and tied to the nearest few), each to the trip those stations " +
        "belong to\n" +
        c.trip + " found no station and will follow " + pt.label +
        " as a whole -- only this action will claim those; a revision " +
        "leaves them alone rather than guess\n\n" +
        "Nothing moves now: this writes the tags, in one undo step. " +
        "When a trip is next revised, each bound entity moves with " +
        "its OWN stations.",
        QMessageBox.Yes | QMessageBox.No);
    if (answer !== QMessageBox.Yes) {
        return;
    }

    var entries = [];
    for (var i = 0; i < items.length; i++) {
        entries.push({ entity: items[i].entity, trip: items[i].trip,
            stations: items[i].stations });
    }
    var tagged;
    try {
        // Suppressed: the tagging operation is itself a transaction,
        // and the listener would otherwise walk in behind us.
        tagged = CsBind.withSuppressed(function() {
            return CsBind.tagEntities(pt.doc, getDocumentInterface(),
                entries);
        });
    } catch (eTag) {
        QMessageBox.warning(null, "Survey Notebook",
            "Couldn't write the linework tags (" + eTag +
            "). Undo restores the drawing if anything was half-written.");
        return;
    }
    var summary = "Bound " + tagged + " entit" +
        (tagged === 1 ? "y" : "ies") + ": " + bound +
        " to their own stations, " + c.trip + " to " + pt.label +
        " as a whole. One undo step.";
    EAction.handleUserMessage("Survey Notebook: " + summary);
    QMessageBox.information(null, "Survey Notebook", summary);
};

/**
 * The Linework... entry: says what automatic binding does, offers the
 * switch that turns it off, and adopts what is already drawn.
 *
 * Built from QLabel/QPushButton like tripDeclinationDialog, and like it
 * the work happens AFTER exec() returns -- the adopt path opens its own
 * preview, which must not stack on top of a modal dialog. A bridge that
 * refuses the dialog falls back to a plain question box, so the SWITCH
 * at least stays reachable: it is the half that cannot be reached any
 * other way, and the half a user who does not want tags on their own
 * geometry needs most.
 */
SurveyNotebook.lineworkDialog = function(w) {
    var on = CsBind.autoBindEnabled();
    var pt = SurveyNotebook.pageTrip(w);
    var canAdopt = (pt.error === undefined);

    var stateText = (on ?
        "Automatic binding is ON (the default)." :
        "Automatic binding is OFF -- nothing is tagged for you.") +
        (canAdopt ? (" This page is " + pt.label + ".") :
            ("\nAdopt isn't available: " + pt.error));
    if (CsBind.autoTagged > 0) {
        stateText += "\n" + CsBind.autoTagged + " entit" +
            (CsBind.autoTagged === 1 ? "y has" : "ies have") +
            " been tagged as you drew this session.";
    }
    if (CsBind.lastError !== "") {
        stateText += "\nLast tagging problem: " + CsBind.lastError;
    }

    var outcome = "";
    var dlg = null;
    try {
        dlg = new QDialog(getMainWindow());
        dlg.windowTitle = "Linework";
        var layout = new QVBoxLayout();
        layout.addWidget(new QLabel(
            "Hand-drawn linework -- traced walls, sketched detail,\n" +
            "inserted symbols -- follows the survey by itself. You do\n" +
            "not have to switch anything on first.\n" +
            "\n" +
            "When a trip is revised, every untagged entity that can be\n" +
            "tied to the survey is tied to it and moved with it:\n" +
            "vertices that snapped to a station, LRUD tip or splay tip\n" +
            "bind to those stations exactly, the rest bind by\n" +
            "proximity, and the TRIP is worked out from the stations\n" +
            "themselves -- not from whichever trip this page happens to\n" +
            "be showing. It happens against the stations as they stood\n" +
            "BEFORE the revision, which is the frame you drew in.\n" +
            "\n" +
            "What is never claimed: anything on a CTRL-* or TB_* layer\n" +
            "or on the sheet furniture, anything the suite drew itself,\n" +
            "anything already bound (your own adoption always wins),\n" +
            "and anything too far from the survey to bind to a single\n" +
            "station -- a construction line across the sheet is left\n" +
            "alone rather than guessed at. Each revision says how many\n" +
            "items it claimed.\n" +
            "\n" +
            "ADOPT binds what is already drawn NOW, with a count of\n" +
            "what binds to what before it commits -- and it is the only\n" +
            "way to claim a sketch that binds to no station, since it\n" +
            "is the only place you can say which trip that belongs to."),
            0, 0);
        layout.addWidget(new QLabel(stateText), 0, 0);

        var buttons = new QHBoxLayout();
        var switchBtn = new QPushButton(on ?
            "Turn automatic binding OFF" : "Turn automatic binding ON");
        var adoptBtn = new QPushButton("Adopt existing linework...");
        if (!canAdopt) {
            try {
                adoptBtn.enabled = false;
            } catch (eEn) {
                // stays clickable; adoptLinework re-checks and explains
            }
        }
        var closeBtn = new QPushButton("Close");
        buttons.addWidget(switchBtn, 0, 0);
        buttons.addWidget(adoptBtn, 0, 0);
        buttons.addStretch(1);
        buttons.addWidget(closeBtn, 0, 0);
        layout.addLayout(buttons, 0);
        dlg.setLayout(layout);

        var wire = function(signal, what) {
            signal.connect(function() {
                outcome = what;
                dlg.accept();
            });
        };
        wire(switchBtn.clicked, on ? "off" : "on");
        wire(adoptBtn.clicked, "adopt");
        closeBtn.clicked.connect(function() {
            dlg.reject();
        });
        dlg.exec();
    } catch (eDlg) {
        // No dialog in this bridge: the switch is the half that can't be
        // done any other way, so offer that much as a question.
        var q;
        try {
            q = QMessageBox.question(null, "Survey Notebook",
                stateText + "\n\n" + (on ?
                    "Turn automatic linework binding OFF? Revising a " +
                    "trip will then move the survey and leave your " +
                    "tracing where it is." :
                    "Turn automatic linework binding back ON? " +
                    "Revisions will tag hand-drawn work they can tie " +
                    "to the survey, and move it.") +
                "\n\n(This build refused the Linework dialog, so Adopt " +
                "isn't reachable here: " + eDlg + ")",
                QMessageBox.Yes | QMessageBox.No);
        } catch (eQ) {
            return;
        }
        outcome = (q === QMessageBox.Yes) ? (on ? "off" : "on") : "";
    }

    if (outcome === "on" || outcome === "off") {
        SurveyNotebook.setAutoBind(w, outcome === "on");
    } else if (outcome === "adopt") {
        SurveyNotebook.adoptLinework(w);
    }
    // the button always ends up showing the truth, whatever happened
    SurveyNotebook.updateLineworkButton(w);
};

// ---------------------------------------------------------------------
// Widget construction
// ---------------------------------------------------------------------

/**
 * Reads this cave's scans folder into the browser.
 *
 * The cave folder comes from the OPEN DRAWING, the same way Sketch
 * Scans finds it: a notebook page belongs to a cave, and the scans it
 * is typed off are that cave's. A drawing with no folder -- an unsaved
 * one, a drawing outside a cave project -- gets an empty list and a
 * line saying why, rather than a list of somebody else's pages.
 *
 * THE COLLAPSED FOLDERS AND THE TICKS ARE THE ONES SKETCH SCANS KEEPS.
 * Same settings, same keys, read through CsScanTree: a page ticked
 * there is ticked here, and a trip folded there opens folded here.
 * That is the whole reason this is the same list.
 */
/**
 * Fills the scan pane when it is wanted and what it shows no longer
 * matches the drawing in front of the caver.
 *
 * THE PANE'S CONTENT DEPENDS ON THE DOCUMENT, not on visibility. Every
 * earlier attempt at this bug hung off the pane being SHOWN, and each
 * missed the same case: the dock is built during add-on init, before
 * any document exists, and restoreState can bring it back ALREADY
 * VISIBLE -- which is not a change, so no visibility signal, so no
 * fill, so an empty pane the caver has to toggle off and on.
 *
 * Asking "is this listing of the drawing I am looking at" answers that
 * case AND the one nobody had reached yet: opening a second cave leaves
 * the first cave's pages sitting there, full and wrong.
 */
/** How many times the startup fill asks for a drawing before giving up.
 *  At 600ms each this waits about half a minute, which covers a large
 *  drawing opening off a shared drive. */
SurveyNotebook.SCAN_FILL_TRIES = 50;

SurveyNotebook.refillIfStale = function(w) {
    if (isNull(w) || w.scanWanted !== true) {
        return false;
    }
    var now = null;
    try {
        now = String(EAction.getDocument().getFileName());
    } catch (eNow) {
        now = null;
    }
    if (now === null || now === "") {
        // Still no drawing. Nothing to list, and nothing to be stale
        // against -- the next call will catch it.
        return false;
    }
    if (w.scansForDoc === now && w.scanRows !== undefined &&
            w.scanRows !== null && w.scanRows.length > 0) {
        return false;
    }
    SurveyNotebook.fillScans(w);
    return true;
};

SurveyNotebook.fillScans = function(w) {
    if (isNull(w) || isNull(w.scanList)) {
        return;
    }
    // REGISTERED FIRST, before any of the ways this can give up. While
    // Sketch Scans is open it is marking the same pages, and a panel
    // that listened only after a successful listing would sit there
    // showing ticks that had moved. ONE SLOT per panel, so refilling
    // replaces this rather than stacking another closure on old rows.
    CsScanList.watch("SurveyNotebook", function(changed) {
        SurveyNotebook.marksChanged(w, changed);
    });
    // AND WHICH PAGE. Sketch Scans browses the same folder beside
    // this, and the two used to sit on different pages in it -- while
    // tracing, this pane holds the page being read and that one holds
    // the page being placed, which are the same page.
    CsScanList.watchSelection("SurveyNotebook", function(folder, rel) {
        SurveyNotebook.selectionElsewhere(w, folder, rel);
    });
    var folder = null;
    try {
        folder = CsCave.scansDir(String(
            EAction.getDocument().getFileName()));
    } catch (eFolder) {
        folder = null;
    }
    w.scansFolder = folder;
    w.scanRows = [];
    // WHICH DRAWING THIS LISTING IS OF. The pane's contents depend on
    // the DOCUMENT, not on whether the pane is visible, so this is what
    // says a listing has gone stale -- see refillIfStale.
    try {
        w.scansForDoc = String(EAction.getDocument().getFileName());
    } catch (eForDoc) {
        w.scansForDoc = null;
    }
    if (isNull(folder) || folder === "") {
        SurveyNotebook.sayNoScans(w, "(save this drawing in a cave folder)");
        return;
    }

    // The scans TREE, not CsCave.imageFiles -- that reads the cave's
    // images/ folder, which is photographs. Scans live under scans/,
    // usually one folder per trip, which is why this walks.
    //
    // THROUGH CORE, not a listing of its own. This panel used to call
    // CsCave.filesUnder directly and keep everything it answered, so
    // every crop Scan Trim had ever written showed up here as a page
    // (Nathan, 2026-09-14) while Sketch Scans, filtering its own copy,
    // showed none of them. CsScanList.scanFiles is the one answer both
    // panels now draw.
    var relative = [];
    try {
        relative = CsScanList.scanFiles(folder, 4);
    } catch (eList) {
        relative = [];
    }
    if (relative.length === 0) {
        SurveyNotebook.sayNoScans(w, "(no scans in " + CsCave.SCANS + ")");
        return;
    }

    w.scanRows = CsScanTree.rowsOf(relative);
    w.scanCollapsed = CsScanTree.collapsedSetFor(
        CsScanTree.parseCollapsed(RSettings.getStringValue(
            CsScanTree.SETTING, "")), folder);
    w.scanComplete = CsScanList.loadComplete(folder);
    // THE REFILL IS NOT A MOVE. Clearing the rows fires the selection
    // signal with nothing selected; recording that would tell the
    // other panel the caver had navigated away from the page they are
    // still on.
    w.scanFilling = true;
    try {
        CsScanList.fill(w.scanList, w.scanRows,
            { folder: folder, collapsed: w.scanCollapsed,
              complete: w.scanComplete }, {});
        // Land on the page the cave was left on, whichever panel left
        // it there -- this tree used to open on row 0 every time.
        var landing = CsScanTree.rowOfRel(w.scanRows,
            CsScanList.landingPage(EAction.getDocument(), folder),
            w.scanCollapsed);
        if (landing >= 0) {
            try {
                w.scanList.setCurrentCell(landing, 0);
            } catch (eLand) {
            }
        }
    } finally {
        w.scanFilling = false;
    }
    SurveyNotebook.showScan(w);
};

/** The other panel marked a page: take the store's word for it and
 *  redraw. Every row, because a trip is ticked when everything in it
 *  is done -- a page finished elsewhere can tick a folder here. */
SurveyNotebook.marksChanged = function(w, folder) {
    if (isNull(w) || isNull(w.scanList) || isNull(w.scanRows) ||
            isNull(w.scansFolder) || w.scansFolder !== folder) {
        return;
    }
    w.scanComplete = CsScanList.loadComplete(folder);
    var keep = -1;
    try {
        keep = w.scanList.currentRow();
    } catch (eRow) {
    }
    w.scanFilling = true;
    try {
        CsScanList.fill(w.scanList, w.scanRows,
            { folder: folder, collapsed: w.scanCollapsed,
              complete: w.scanComplete }, {});
        try {
            if (keep >= 0) {
                w.scanList.setCurrentCell(keep, 0);
            }
        } catch (eSel) {
        }
    } finally {
        w.scanFilling = false;
    }
};

/**
 * This panel moved to another page: remember it and tell the others.
 *
 * Not while the list is being refilled -- clearing the rows fires the
 * selection signal with nothing selected, which would record "no page"
 * over the page the refill is about to land on. That is the same guard
 * Sketch Scans keeps as w.building, under this panel's own name.
 */
SurveyNotebook.selectionMoved = function(w) {
    if (isNull(w) || w.scanFilling === true ||
            isNull(w.scanRows) || isNull(w.scansFolder)) {
        return;
    }
    var rel = SurveyNotebook.selectedScanRel(w);
    if (rel === null) {
        return;                 // a folder row is not a page
    }
    CsScanList.selectionMoved(w.scansFolder, rel, w.scanRows,
        "SurveyNotebook");
};

/** The page selected in this panel's tree, or null for a folder row
 *  or no selection at all. */
SurveyNotebook.selectedScanRel = function(w) {
    var row = -1;
    try {
        row = w.scanList.currentRow();
    } catch (eRow) {
        return null;
    }
    if (row < 0 || isNull(w.scanRows) || row >= w.scanRows.length) {
        return null;
    }
    return w.scanRows[row].kind === "file" ? w.scanRows[row].rel : null;
};

/**
 * Sketch Scans moved to another page: follow it.
 *
 * This cave's folder only, and only to a row that is really there and
 * not folded away -- opening a folder the caver collapsed to show them
 * a page they did not ask for is a worse fix than not following.
 */
SurveyNotebook.selectionElsewhere = function(w, folder, rel) {
    if (isNull(w) || isNull(w.scanList) || isNull(w.scanRows) ||
            isNull(w.scansFolder) || w.scansFolder !== folder) {
        return;
    }
    if (rel === null || rel === undefined || rel === "") {
        return;
    }
    if (SurveyNotebook.selectedScanRel(w) === rel) {
        return;
    }
    var row = CsScanTree.rowOfRel(w.scanRows, rel, w.scanCollapsed);
    if (row < 0) {
        return;
    }
    var was = w.scanFilling;
    w.scanFilling = true;       // our own move must not echo back
    try {
        w.scanList.setCurrentCell(row, 0);
    } catch (eSel) {
    }
    w.scanFilling = was;
};

/** One row saying why the browser is empty. */
SurveyNotebook.sayNoScans = function(w, why) {
    try {
        w.scanList.setRowCount(0);
        w.scanList.setRowCount(1);
        w.scanList.setItem(0, 0, new QTableWidgetItem(why));
    } catch (eSay) {
    }
};

/** A click on a folder row folds it; a click on a page shows it. */
SurveyNotebook.scanRowClicked = function(w, row) {
    if (isNull(w) || isNull(w.scanRows) || row < 0 ||
            row >= w.scanRows.length) {
        return;
    }
    if (w.scanRows[row].kind === "folder") {
        var rel = w.scanRows[row].rel;
        w.scanCollapsed[rel] = (w.scanCollapsed[rel] !== true);
        // Remembered in the SAME setting Sketch Scans uses, so a trip
        // folded in one panel is folded in the other.
        try {
            var map = CsScanTree.parseCollapsed(
                RSettings.getStringValue(CsScanTree.SETTING, ""));
            var rels = [];
            for (var i = 0; i < w.scanRows.length; i++) {
                if (w.scanRows[i].kind === "folder") {
                    rels.push(w.scanRows[i].rel);
                }
            }
            CsScanTree.recordCollapsed(map, w.scansFolder,
                w.scanCollapsed, rels);
            RSettings.setValue(CsScanTree.SETTING,
                CsScanTree.serializeCollapsed(map));
        } catch (eSave) {
        }
        CsScanList.refreshRow(w.scanList, w.scanRows,
            { collapsed: w.scanCollapsed, complete: w.scanComplete },
            row);
        CsScanList.applyHidden(w.scanList, w.scanRows, w.scanCollapsed);
        return;
    }
    SurveyNotebook.showScan(w);
};

/**
 * Marks the selected page finished with, or unmarks it.
 *
 * THE SAME MARK SKETCH SCANS KEEPS, in the same setting. Typing a page
 * into this notebook is one of the two ways a page gets finished with
 * -- the other is tracing it -- and a tick that only one of them could
 * set would be a record of half the work.
 */
/**
 * Marks every page under a folder complete, or unmarks them all.
 *
 * A TRIP AT A TIME: forty pages come back from one trip and saying so
 * should not cost forty right-clicks. Sketch Scans offers the same
 * thing on the same tree, through the same Core call, because the two
 * panels show one list and a mark made in either belongs in both.
 */
SurveyNotebook.markScanFolder = function(w, row, want) {
    if (isNull(w) || isNull(w.scanRows) || row < 0 ||
            row >= w.scanRows.length || w.scanRows[row].kind !== "folder") {
        return;
    }
    var rels = [];
    for (var i = 0; i < w.scanRows.length; i++) {
        if (w.scanRows[i].kind === "file") {
            rels.push(w.scanRows[i].rel);
        }
    }
    w.scanComplete = CsScanList.setFolderComplete(w.scansFolder,
        w.scanRows[row].rel, w.scanRows, want, rels);
    CsScanList.fill(w.scanList, w.scanRows,
        { folder: w.scansFolder, collapsed: w.scanCollapsed,
          complete: w.scanComplete }, {});
    try {
        w.scanList.setCurrentCell(row, 0);
    } catch (eSel) {
    }
};

SurveyNotebook.toggleScanComplete = function(w, row) {
    if (isNull(w) || isNull(w.scanRows) || row < 0 ||
            row >= w.scanRows.length || w.scanRows[row].kind !== "file") {
        return;
    }
    var rel = w.scanRows[row].rel;
    var rels = [];
    for (var i = 0; i < w.scanRows.length; i++) {
        if (w.scanRows[i].kind === "file") {
            rels.push(w.scanRows[i].rel);
        }
    }
    // READ-MODIFY-WRITE through the shared store, and draw from what
    // comes back: Sketch Scans is marking the same pages, and writing
    // this panel's whole copy back is how the two undid each other.
    w.scanComplete = CsScanList.toggleComplete(w.scansFolder, rel, rels);
    // The page's own row, and every folder above it: a trip is ticked
    // when everything in it is done, so finishing the last page of one
    // changes a row the caver may not be looking at.
    CsScanList.fill(w.scanList, w.scanRows,
        { folder: w.scansFolder, collapsed: w.scanCollapsed,
          complete: w.scanComplete }, {});
    try {
        w.scanList.setCurrentCell(row, 0);
    } catch (eSel) {
    }
};

/** Puts the selected page in the pane. */
SurveyNotebook.showScan = function(w) {
    if (isNull(w) || w.scanPreview === null || isNull(w.scanRows)) {
        return;
    }
    var rel = CsScanList.selectedRel(w.scanList, w.scanRows);
    if (rel === null || isNull(w.scansFolder)) {
        return;
    }
    try {
        CsScanPreview.show(w.scanPreview, w.scansFolder + "/" + rel);
    } catch (eShow) {
    }
};

SurveyNotebook.buildDock = function(appWin) {
    var dock = new QDockWidget("Survey Notebook", appWin);
    dock.objectName = "CaveSurveyNotebookDock";

    var w = {};
    w.loading = false;
    w.declSource = "user";
    w.unit = "ft";
    w.problems = [];
    w.rows = [];
    w.gridRow = 1; // row 0 is the header line
    var doc = getDocument();
    if (doc !== undefined && doc !== null) {
        w.unit = CsUnits.fromDrawingUnit(doc.getUnit(), RS);
    }

    var body = new QWidget(dock);
    var layout = new QVBoxLayout();

    // ---- trip header ------------------------------------------------
    var head1 = new QHBoxLayout();
    // "TRIP OBJECTIVE", NOT "SURVEY". Every trip in a drawing belongs to
    // the cave that drawing is of, so a field labelled "Survey" invites
    // the cave's name -- typed again on every trip, which names nothing.
    // What earns a field is what made THIS trip different: where the
    // party went and what they meant to do. That is also what the 3D
    // view's trip legend shows, and a legend reading the cave's name
    // nine times has told the reader nothing.
    head1.addWidget(new QLabel("Trip Objective"), 0, 0);
    w.nameEdit = SurveyNotebook.upperCase(w, new QLineEdit());
    w.nameEdit.placeholderText = "what this trip set out to do";
    w.nameEdit.toolTip = "What made this trip its own -- the lead " +
        "pushed, the area mapped. Not the cave's name: every trip here " +
        "is already in this cave.";
    head1.addWidget(w.nameEdit, 1, 0);
    head1.addWidget(new QLabel("Date"), 0, 0);
    w.dateEdit = new QLineEdit();
    w.dateEdit.placeholderText = "YYYY-MM-DD";
    w.dateEdit.maximumWidth = 110;
    head1.addWidget(w.dateEdit, 0, 0);
    layout.addLayout(head1, 0);

    var head2 = new QHBoxLayout();
    head2.addWidget(new QLabel("Team"), 0, 0);
    w.teamEdit = SurveyNotebook.upperCase(w, new QLineEdit());
    head2.addWidget(w.teamEdit, 1, 0);
    head2.addWidget(new QLabel("Decl"), 0, 0);
    w.declEdit = new QLineEdit();
    w.declEdit.placeholderText = "0.0 (E+)";
    w.declEdit.maximumWidth = 80;
    // Says which of the two declination paths this field is, because
    // the other one is three buttons away (see the per-trip revision
    // section above).
    w.declEdit.toolTip = "The declination THIS PAGE's compass readings " +
        "were taken under (east positive): the azimuth cells are " +
        "magnetic, this converts them to true when you Draw.\n" +
        "To CORRECT the declination of a trip already in the drawing, " +
        "use Declination... instead -- that rotates the stored shots " +
        "and logs the revision.";
    head2.addWidget(w.declEdit, 0, 0);
    w.inferButton = new QPushButton("Infer");
    var head3 = new QHBoxLayout();
    head3.addWidget(new QLabel("Instr"), 0, 0);
    w.instrEdit = SurveyNotebook.upperCase(w, new QLineEdit());
    w.instrEdit.placeholderText = "COMPASS, TAPE, CLINO...";
    w.instrEdit.toolTip = "The instruments this page's readings were " +
        "taken with (model, serial -- free text). Stored with the trip.";
    w.inferButton.toolTip =
        "Estimate declination from the survey date and the cave's " +
        "location (IGRF model, 1900 to present). Always editable.\n" +
        "If it has to ask where the cave is, it offers to keep that " +
        "location as the drawing's geo anchor.";
    head2.addWidget(w.inferButton, 0, 0);
    layout.addLayout(head2, 0);
    head3.addWidget(w.instrEdit, 1, 0);
    layout.addLayout(head3, 0);

    var columnHelp =
        "The notes page: shots are written between the stations they " +
        "connect.\n" +
        "Azm: what the COMPASS reads (magnetic, clockwise from north);\n" +
        "the header's Decl converts to true for the drawing.\n" +
        "Dist: along the tape. Inc: + up, - down.\n" +
        "L/R face the direction of travel; LRUD sits beside its station.\n" +
        "Blank = not measured; 0 = wall at the station; P = passage " +
        "(no wall, recorded 0); 5/10 = two readings, both drawn.\n" +
        "Blank station line = separator; the next named line " +
        "re-anchors the chain (branching, paper-style).\n" +
        "Station A3.1 while the chain stands at A3 = splay: azimuth + " +
        "distance to a wall, no new station.";

    // ---- the notes page (ladder) --------------------------------------
    {
        var inner = new QWidget();
        w.grid = new QGridLayout();
        try {
            w.grid.setHorizontalSpacing(4);
            w.grid.setVerticalSpacing(2);
            w.grid.setContentsMargins(4, 4, 4, 4);
        } catch (eSp) {
            // spacing stays at defaults
        }

        var headers = ["Station", "Dist", "Azm", "Inc",
            "L", "R", "U", "D", "Notes"];
        for (var h = 0; h < headers.length; h++) {
            var hd = new QLabel(headers[h]);
            try {
                var hf = hd.font;
                hf.setPointSize(SurveyNotebook.FONT_SIZE);
                hd.font = hf;
                hd.alignment = Qt.AlignCenter;
            } catch (eHf) {
            }
            w.grid.addWidget(hd, 0, h);
        }
        // scrollbar appears when the page outgrows the panel; the
        // stretch row (maintained in addStationRow) keeps everything
        // pinned to the top rather than centered
        try {
            w.grid.setColumnStretch(headers.length, 1);
            // the Notes column soaks up spare width
            w.grid.setColumnStretch(8, 1);
        } catch (e) {
            // cosmetic only
        }

        inner.setLayout(w.grid);
        inner.toolTip = columnHelp;

        w.ladderArea = new QScrollArea();
        w.ladderArea.widgetResizable = true;
        w.ladderArea.setWidget(inner);
        // added to the splitter below, beside the status box

        var rowBar = new QWidget();
        var rowButtons = new QHBoxLayout();
        // The "+" catcher: tabbing off the last station's D lands here,
        // which adds the next station automatically (see focusChanged
        // wiring below). A LINE EDIT, not a button: macOS excludes
        // buttons from Tab navigation unless the system-wide "full
        // keyboard access" setting is on, which would break the whole
        // point. Read-only so nothing can be typed into it.
        w.sentinel = new QLineEdit();
        w.sentinel.text = "+";
        w.sentinel.readOnly = true;
        w.sentinel.objectName = "CaveSurveyNotebookAutoAdd";
        w.sentinel.maximumWidth = 32;
        w.sentinel.alignment = Qt.AlignCenter;
        w.sentinel.toolTip = "Next station: Tab lands here from the " +
            "last D and adds it automatically";
        w.addRowButton = new QPushButton("+ Station");
        w.delRowButton = new QPushButton("- Station");
        rowButtons.addWidget(w.sentinel, 0, 0);
        rowButtons.addWidget(w.addRowButton, 0, 0);
        rowButtons.addWidget(w.delRowButton, 0, 0);
        rowButtons.addStretch(1);
        rowBar.setLayout(rowButtons);
        w.rowButtonBar = rowBar;
        // added after the splitter below, so it sits under the page
    }

    // ---- live status -----------------------------------------------
    // The status box shares a vertical SPLITTER with the notes page:
    // drag the handle to give either more room; the button rows below
    // never move. Read-only, NoFocus, and toggleable via the Status
    // button in the action row (visibility remembered).
    w.statusLabel = new QPlainTextEdit();
    w.statusLabel.readOnly = true;
    w.statusLabel.minimumHeight = 40;
    try {
        w.statusLabel.focusPolicy = Qt.NoFocus;
    } catch (eFp) {
        // cosmetic
    }

    {
        w.splitter = new QSplitter(Qt.Vertical);
        w.splitter.addWidget(w.ladderArea);
        w.splitter.addWidget(w.statusLabel);
        try {
            w.splitter.setStretchFactor(0, 4); // the page gets the growth
            w.splitter.setStretchFactor(1, 1);
        } catch (eSf) {
            // cosmetic
        }
        // the page/status split is part of the layout the user set up:
        // restore it, and remember every drag of the handle
        try {
            var savedSplit = RSettings.getStringValue(
                "CaveSurvey/NotebookSplitterSizes", "");
            if (savedSplit.length > 0) {
                var splitParts = savedSplit.split(",");
                var splitSizes = [];
                for (var si = 0; si < splitParts.length; si++) {
                    splitSizes.push(parseInt(splitParts[si], 10));
                }
                // ONLY IF IT STILL FITS. The splitter gained the scan
                // pane between the ladder and the status box, so a
                // two-number split saved before that would leave the
                // new pane with nothing -- and a caver who pressed
                // Scan would see an empty strip and conclude it was
                // broken.
                if (splitSizes.length === w.splitter.count() &&
                        !isNaN(splitSizes[0])) {
                    w.splitter.setSizes(splitSizes);
                }
            } else {
                // no saved split yet: the status box starts small --
                // about two lines of text -- with the page taking the
                // rest; drag the handle for more and it is remembered
                w.splitter.setSizes([10000, 56]);
            }
            w.splitter.splitterMoved.connect(function() {
                RSettings.setValue("CaveSurvey/NotebookSplitterSizes",
                    w.splitter.sizes().join(","));
            });
        } catch (eSplit) {
            // bridge without sizes()/setSizes(): stretch factors stand
        }
        // ---- the scans, under the shots -------------------------------
        //
        // THE NUMBERS COME OFF THE PAGE (Nathan, 2026-09-11). Typing a
        // trip into this notebook means reading a scanned field book
        // -- distance, azimuth, inclination, LRUD, the note in the
        // margin -- and the scan was in another panel. Every shot was a
        // look away and a look back, and a wrong row is what that
        // costs.
        //
        // UNDER THE LADDER, not beside it. A shot row is wide -- name,
        // seven numbers and a note -- and taking width from it to put
        // a page alongside squeezed the thing being typed into. The
        // ladder keeps the dock's width and the page takes the height
        // below it, on the splitter that already divides this panel.
        //
        // THE SAME VIEWER Sketch Scans uses (Core/CsScanView.js), not a
        // second one: an embedded CAD view with real zoom, pan and
        // rotate, every one of which was a trap somebody had to find
        // once.
        w.scanPane = new QWidget();
        var scanLayout = new QVBoxLayout();
        try {
            scanLayout.setContentsMargins(0, 0, 0, 0);
        } catch (eMargins) {
        }

        // THE TREE AND THE PAGE BESIDE IT, from Core (CsScanBrowser):
        // the same widget Sketch Scans builds, not a second assembly
        // of the same parts. The cave's scans folder as a tree that
        // folds, with a tick on every page finished with and on every
        // trip whose pages are all done, and the page itself beside
        // it -- a scanned page is taller than it is wide, so stacking
        // them makes a letterbox of the thing being read.
        //
        // Two browsers over one folder would be two answers to "which
        // have I done", and they would drift -- which is what happened
        // when the layout changed in one panel and not the other
        // (Nathan, 2026-09-11).
        var browser = CsScanBrowser.build(w.scanPane, {
            settingKey: "CaveSurvey/NotebookScanSplitWidths",
            zoom: function(label, tip) {
                return SurveyNotebook.smallButton(label, tip);
            }
        });
        w.scanList = browser.list;
        w.scanPreview = browser.preview;
        w.scanFitButton = browser.fitButton;
        w.scanInButton = browser.zoomInButton;
        w.scanOutButton = browser.zoomOutButton;
        CsScanBrowser.rememberSizes(browser.splitter,
            "CaveSurvey/NotebookScanSplitWidths", null);
        try {
            w.scanList.minimumHeight = 90;
        } catch (eListH) {
        }
        if (w.scanPreview === null) {
            // No embedded view on this bridge: say so rather than
            // leaving an empty strip that looks broken.
            w.scanFallback = new QLabel("This build cannot show a scan " +
                "here. Use Sketch Scans.");
            w.scanFallback.wordWrap = true;
            browser.previewLayout.addWidget(w.scanFallback, 1, 0);
        }
        scanLayout.addWidget(browser.splitter, 1, 0);
        w.scanPane.setLayout(scanLayout);

        // Between the ladder and the status box: the ladder is what is
        // being typed into and keeps the top, the status box is two
        // lines and keeps the bottom.
        try {
            w.splitter.insertWidget(1, w.scanPane);
        } catch (eInsert) {
            w.splitter.addWidget(w.scanPane);
        }
        try {
            w.splitter.setStretchFactor(1, 3);
        } catch (eScanSf) {
        }
        // WANTED, not `.visible`. The dock is built hidden (add-on
        // init runs before restoreState), and a child of a hidden
        // parent reads visible=false however it was set -- so asking
        // the WIDGET whether the caver wants this pane answers no,
        // every time, until the dock is on screen. The intent lives
        // here instead, and the widget follows it.
        try {
            w.scanWanted = RSettings.getBoolValue(
                "CaveSurvey/NotebookScanVisible", false);
        } catch (eScanVis) {
            w.scanWanted = false;
        }
        w.scanPane.visible = w.scanWanted;

        layout.addWidget(w.splitter, 1, 0);
        layout.addWidget(w.rowButtonBar, 0, 0);
    }
    w.statusLabel.visible =
        RSettings.getBoolValue("CaveSurvey/NotebookStatusVisible", true);

    // ---- actions ------------------------------------------------------
    var actions = new QHBoxLayout();
    w.drawButton = new QPushButton("Draw");
    w.drawButton.toolTip = "Draw the survey into the drawing, one undo step.";
    w.newTripButton = new QPushButton("New Trip");
    w.newTripButton.toolTip = "Start the next trip's page: pick the " +
        "station it ties into (open ends suggested), header prefilled " +
        "from the drawing. The drawing is not touched.";
    // THE ACTION ROW SETS THIS DOCK'S MINIMUM WIDTH, and the dock's
    // width is map space the caver does not get. Nine full buttons
    // wanted roughly 1000px; the two pressed every session stay full,
    // the two that report STATE stay visible as small toggles, and the
    // five that are occasional errands live under a menu. The floor is
    // then the shot ladder (name + 7 x EDIT_WIDTH + notes), which is
    // the next thing to shrink if more room is wanted.
    w.statusButton = SurveyNotebook.smallButton("Status",
        "Show/hide the live status box (drag the bar above it to " +
        "resize).");
    try {
        w.statusButton.checkable = true;
        w.statusButton.checked = w.statusLabel.visible;
    } catch (eStatusChk) {
        // not checkable here: the box's own visibility is the state
    }
    // THE GHOST'S OWN SWITCH. On by default -- it is the answer to
    // "did I type that right" and a caver should not have to know it
    // exists to get it -- but a page being typed over a dense part of
    // a finished map is a real reason to want the map to itself.
    w.ghostButton = SurveyNotebook.smallButton("Preview",
        "Draw this page over the map as you type it: shot lines, the " +
        "walls the LRUD makes, and a dashed line where loop closure " +
        "moved things. Nothing is added to the drawing until Draw.");
    try {
        w.ghostButton.checkable = true;
        w.ghostOn = RSettings.getBoolValue(
            "CaveSurvey/NotebookGhost", true);
        w.ghostButton.checked = w.ghostOn;
    } catch (eGhostChk) {
        w.ghostOn = true;
    }
    w.scanButton = SurveyNotebook.smallButton("Scan",
        "Show/hide the scanned page beside the shots -- the page you " +
        "are typing off. Drag the bar between them to resize.");
    try {
        w.scanButton.checkable = true;
        w.scanButton.checked = RSettings.getBoolValue(
            "CaveSurvey/NotebookScanVisible", false);
    } catch (eScanChk) {
    }
    w.moreButton = new QToolButton();
    w.moreButton.text = "\u22ef";
    w.moreButton.toolTip = "Import, export, clear the page, load a trip " +
        "from the drawing, revise declinations, edit or delete a trip.";
    try {
        w.moreButton.autoRaise = true;
    } catch (eRaise) {
    }
    w.moreMenu = new QMenu();
    w.importAction = w.moreMenu.addAction("Import File...");
    w.exportAction = w.moreMenu.addAction("Export File...");
    w.moreMenu.addSeparator();
    w.loadDrawingAction = w.moreMenu.addAction("Load from drawing");
    w.loadDrawingAction.toolTip = "Fill the page from a trip already in " +
        "the drawing, so this page becomes that trip's revision sheet. " +
        "Edit and Draw to replace it in place.";
    w.redrawAllAction = w.moreMenu.addAction("Redraw All");
    w.redrawAllAction.toolTip = "Redraw the WHOLE cave from the drawing's " +
        "own data, not just this page's trip. Draw normally redraws only " +
        "the trip you typed when nothing else moved; this forces the full " +
        "redraw, which is what re-splits a wall run at a new junction and " +
        "re-orients a tie-in station's LRUD.";
    w.declReviseAction = w.moreMenu.addAction("Declination...");
    w.declReviseAction.toolTip = "Correct the declination of the trips " +
        "already in the drawing: one row per trip, IGRF on tap, and the " +
        "drawing turns by the difference. Not the same as the header's " +
        "Decl, which is what this page's own readings were taken under.";
    w.editTripAction = w.moreMenu.addAction("Edit this trip...");
    w.editTripAction.toolTip = "Correct the loaded trip's name, date, " +
        "team or instruments -- edits land on the trip itself, not a " +
        "new copy of it, and nothing is moved or redrawn. With no trip " +
        "loaded, every trip in the drawing is listed to pick from. " +
        "Also where a trip is deleted outright.";
    w.moreMenu.addSeparator();
    // The tracing itself lives in Feature Trace now, but the BINDING
    // SWITCH does not: this entry is still the only way to turn
    // automatic linework binding off, and the only way to reach Adopt.
    // Checkable so the menu shows a mark when binding is switched off
    // -- state that used to be a pressed button in the row.
    w.lineworkButton = w.moreMenu.addAction("Linework...");
    try {
        w.lineworkButton.checkable = true;
    } catch (eChk) {
        // not checkable here: the label carries the state on its own
    }
    w.moreMenu.addSeparator();
    w.clearAction = w.moreMenu.addAction("Clear");
    w.clearAction.toolTip = "Empty the page for the next survey. The " +
        "team clears too; the rest of the header (name, date, " +
        "declination, instruments) is kept. Nothing in the drawing is " +
        "touched.";
    w.moreButton.setMenu(w.moreMenu);
    // 2 = QToolButton::InstantPopup, WRITTEN AS A NUMBER ON PURPOSE.
    // QToolButton.InstantPopup is UNDEFINED in this bridge (probed
    // 2026-08-29), so the named form assigns undefined and silently
    // leaves the mode at 0 -- press-and-hold, which reads as a menu
    // that does not open.
    try {
        w.moreButton.popupMode = 2;
    } catch (ePopup) {
        // a bridge without popupMode still opens the menu on a hold
    }

    actions.addWidget(w.drawButton, 0, 0);
    actions.addWidget(w.newTripButton, 0, 0);
    actions.addStretch(1);
    actions.addWidget(w.ghostButton, 0, 0);
    actions.addWidget(w.statusButton, 0, 0);
    actions.addWidget(w.scanButton, 0, 0);
    actions.addWidget(w.moreButton, 0, 0);
    layout.addLayout(actions, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    CsPanel.attachHelp(dock, "SurveyNotebook", qsTr("Survey Notebook"));

    // ---- wiring ----------------------------------------------------
    {
        SurveyNotebook.safeConnect(w.addRowButton.clicked, function() {
            var prevName = w.rows.length > 0 ?
                String(w.rows[w.rows.length - 1].name.text) : "";
            SurveyNotebook.addStationRow(w,
                CsModel.nextStationName(prevName));
        }, "+ Station button", w.problems);
        SurveyNotebook.safeConnect(w.delRowButton.clicked, function() {
            SurveyNotebook.removeLastStation(w);
        }, "- Station button", w.problems);
        // Focus landing on the "+" catcher = grow the page. Identity
        // is compared by objectName: the bridge wraps the same widget
        // in a fresh object per signal emission. The application
        // object is reached however this build exposes it.
        w.focusAddWired = false;
        var app = null;
        try {
            if (typeof qApp !== "undefined") {
                app = qApp;
            } else if (typeof QApplication !== "undefined" &&
                       typeof QApplication.instance === "function") {
                app = QApplication.instance();
            } else if (typeof QCoreApplication !== "undefined" &&
                       typeof QCoreApplication.instance === "function") {
                app = QCoreApplication.instance();
            }
        } catch (eApp) {
            app = null;
        }
        if (app !== null) {
            try {
                app.focusChanged.connect(function(oldW, newW) {
                    // Reading objectName off a widget whose C++ side is
                    // already gone prints "wrapped is NULL" and a stack
                    // trace -- which every modal dialog in the suite
                    // triggers as it closes, the cave launcher included.
                    // Focus moving somewhere this listener does not care
                    // about is the normal case, not an error.
                    var focused = "";
                    try {
                        focused = (newW === null || newW === undefined) ? "" :
                            String(newW.objectName);
                    } catch (eGone) {
                        return;
                    }
                    if (focused === "CaveSurveyNotebookAutoAdd") {
                        // consume the click that may follow this focus
                        // change, so the click path can't double-add
                        w.sentinelFocusAdd = true;
                        SurveyNotebook.autoAddStation(w);
                        return;
                    }
                    // THE PAGE FOLLOWS THE CURSOR. Tab walks down a
                    // ladder that is taller than the panel, and the
                    // scroll area does not move on its own: past a
                    // dozen stations the caver was typing readings
                    // into cells below the bottom edge, which is how a
                    // number ends up in the wrong column. Scrolling to
                    // the focused cell with a margin keeps the row
                    // being typed, and the one after it, on screen.
                    if (focused === SurveyNotebook.CELL_NAME) {
                        SurveyNotebook.followFocus(w, newW);
                    }
                });
                w.focusAddWired = true;
            } catch (eSig) {
                // fall through to the click path
            }
        }
        // Enter on "+" always works, focus signal or not (clicking it
        // focuses it, which the focus path already handles). The flag
        // guards against a focus-add and an Enter-add stacking.
        SurveyNotebook.safeConnect(w.sentinel.returnPressed, function() {
            if (w.sentinelFocusAdd === true) {
                w.sentinelFocusAdd = false;
                return;
            }
            SurveyNotebook.autoAddStation(w);
        }, "+ catcher Enter", w.problems);
        if (!w.focusAddWired) {
            w.sentinel.toolTip = "Next station: Tab here from the last " +
                "D, then press Enter (this build's bridge has no focus " +
                "signal, so the extra keypress is needed)";
        }
    }
    SurveyNotebook.safeConnect(w.drawButton.clicked, function() {
        SurveyNotebook.drawSurvey(w);
    }, "Draw button", w.problems);
    SurveyNotebook.safeConnect(w.importAction.triggered, function() {
        SurveyNotebook.importFile(w);
    }, "Import button", w.problems);
    SurveyNotebook.safeConnect(w.exportAction.triggered, function() {
        SurveyNotebook.exportFile(w);
    }, "Export button", w.problems);
    SurveyNotebook.safeConnect(w.inferButton.clicked, function() {
        SurveyNotebook.inferDeclination(w);
    }, "Infer button", w.problems);
    SurveyNotebook.safeConnect(w.ghostButton.clicked, function() {
        w.ghostOn = (w.ghostOn === false);
        RSettings.setValue("CaveSurvey/NotebookGhost", w.ghostOn);
        try {
            w.ghostButton.checked = w.ghostOn;
        } catch (eGhostSync) {
        }
        if (w.ghostOn) {
            SurveyNotebook.showGhost(w);
        } else {
            SurveyNotebook.clearGhost();
        }
    }, "Preview button", w.problems);
    SurveyNotebook.safeConnect(w.statusButton.clicked, function() {
        w.statusLabel.visible = !w.statusLabel.visible;
        RSettings.setValue("CaveSurvey/NotebookStatusVisible",
            w.statusLabel.visible);
        try {
            // A checkable button toggles ITSELF on click, so this only
            // re-asserts the truth -- and keeps the two in step on a
            // bridge where the click did not toggle it.
            w.statusButton.checked = w.statusLabel.visible;
        } catch (eStatusSync) {
        }
    }, "Status button", w.problems);
    SurveyNotebook.safeConnect(w.scanButton.clicked, function() {
        w.scanWanted = (w.scanWanted !== true);
        w.scanPane.visible = w.scanWanted;
        RSettings.setValue("CaveSurvey/NotebookScanVisible", w.scanWanted);
        try {
            w.scanButton.checked = w.scanWanted;
        } catch (eScanSync) {
        }
        // FILLED WHEN IT IS FIRST SHOWN, not at startup: listing a
        // cave's scans folder is a directory walk, and a caver who
        // never opens this pane should never pay for it.
        if (w.scanWanted === true) {
            SurveyNotebook.fillScans(w);
        }
    }, "Scan button", w.problems);
    SurveyNotebook.safeConnect(w.scanList.cellClicked,
        function(row, col) {
            SurveyNotebook.scanRowClicked(w, row);
        }, "Scan list", w.problems);
    SurveyNotebook.safeConnect(w.scanList.itemSelectionChanged,
        function() {
            SurveyNotebook.showScan(w);
            SurveyNotebook.selectionMoved(w);
        }, "Scan selection", w.problems);
    try {
        w.scanList.contextMenuPolicy = Qt.CustomContextMenu;
        w.scanList.customContextMenuRequested.connect(function(pos) {
            var row = -1;
            try {
                row = w.scanList.rowAt(pos.y());
                if (row >= 0) {
                    w.scanList.selectRow(row);
                }
            } catch (eRow) {
            }
            if (row < 0 || isNull(w.scanRows[row])) {
                return;
            }
            var menu = new QMenu(w.scanList);
            if (w.scanRows[row].kind === "folder") {
                var fDone = CsScanTree.folderComplete(w.scanRows[row].rel,
                    w.scanRows, w.scanComplete);
                var fAct = menu.addAction(
                    qsTr(CsScanList.folderMarkLabel(fDone)));
                try {
                    fAct.checkable = true;
                    fAct.checked = fDone;
                } catch (eFChk) {
                }
                fAct.triggered.connect(function() {
                    SurveyNotebook.markScanFolder(w, row, !fDone);
                });
                try {
                    CsScanList.addRevealAction(menu, w.scansFolder,
                        w.scanRows[row].rel, true);
                } catch (eRevealF) {
                }
                try {
                    CsScanList.addFlushTrimmedAction(menu, w.scansFolder,
                        function() { SurveyNotebook.fillScans(w); });
                } catch (eFlushF) {
                }
            } else {
                var done = w.scanComplete[w.scanRows[row].rel] === true;
                var act = menu.addAction(qsTr(CsScanList.markLabel(done)));
                try {
                    act.checkable = true;
                    act.checked = done;
                } catch (eChk) {
                }
                act.triggered.connect(function() {
                    SurveyNotebook.toggleScanComplete(w, row);
                });
                // The same entry Sketch Scans offers on the same tree,
                // from the same place in Core: a PDF of a whole trip
                // becomes one image per page. Adds itself only for a
                // PDF row.
                try {
                    CsScanList.addSplitAction(menu, w.scansFolder,
                        w.scanRows[row].rel,
                        function() { SurveyNotebook.fillScans(w); });
                } catch (eSplit) {
                }
                try {
                    CsScanList.addRevealAction(menu, w.scansFolder,
                        w.scanRows[row].rel, false);
                } catch (eReveal) {
                }
                try {
                    CsScanList.addFlushTrimmedAction(menu, w.scansFolder,
                        function() { SurveyNotebook.fillScans(w); });
                } catch (eFlush) {
                }
            }
            menu.exec(QCursor.pos());
            try {
                menu.deleteLater();
            } catch (eDel) {
            }
        });
    } catch (eMenu) {
        // no context menu on this bridge: the tick is still read here
        // and set from Sketch Scans
    }
    // Fit / + / - are wired by CsScanBrowser, once, for both panels.
    // Connecting them again here would zoom twice per click.
    SurveyNotebook.safeConnect(w.newTripButton.clicked, function() {
        SurveyNotebook.newTrip(w);
    }, "New Trip button", w.problems);
    SurveyNotebook.safeConnect(w.clearAction.triggered, function() {
        var sure = QMessageBox.question(null, "Survey Notebook",
            "Clear the page? The team clears with it; the rest of the " +
            "header stays and the drawing is not touched.",
            QMessageBox.Yes | QMessageBox.No);
        if (sure !== QMessageBox.Yes) {
            return;
        }
        // The team clears with the page: the next page is usually a
        // different crew, and a stale team quietly becomes a wrong trip
        // fingerprint. Name/date/decl/instruments stay -- same cave,
        // same field, and date is usually today's either way.
        w.teamEdit.text = "";
        // and it stops being a revision of whatever trip it was loaded
        // from: the next Draw appends, it does not overwrite trip 9
        // with a blank page.
        w.loadedTripId = null;
        SurveyNotebook.clearLadder(w);
        SurveyNotebook.addStationRow(w, "A1");
        SurveyNotebook.addStationRow(w, "A2");
        SurveyNotebook.refresh(w);
    }, "Clear button", w.problems);
    SurveyNotebook.safeConnect(w.loadDrawingAction.triggered, function() {
        SurveyNotebook.loadFromDrawing(w);
    }, "Load from drawing button", w.problems);
    SurveyNotebook.safeConnect(w.redrawAllAction.triggered, function() {
        SurveyNotebook.drawSurvey(w, true);
    }, "Redraw All button", w.problems);
    SurveyNotebook.safeConnect(w.declReviseAction.triggered, function() {
        SurveyNotebook.reviseDeclinations(w);
    }, "Declination button", w.problems);
    SurveyNotebook.safeConnect(w.editTripAction.triggered, function() {
        TripEdit.open(w.loadedTripId);
    }, "Edit this trip button", w.problems);
    SurveyNotebook.safeConnect(w.lineworkButton.triggered, function() {
        // Any failure in here must be SEEN, not swallowed -- and a
        // checkable button that toggled itself must not be left
        // showing a state the switch is not in.
        try {
            SurveyNotebook.lineworkDialog(w);
        } catch (e) {
            SurveyNotebook.updateLineworkButton(w);
            QMessageBox.warning(null, "Survey Notebook",
                "Linework binding failed inside this build's bridge:" +
                "\n\n" + e + "\n\n" +
                (e.stack ? String(e.stack).substring(0, 600) : "") +
                "\n\nPlease report this text.");
        }
    }, "Linework button", w.problems);
    // Draw-time tagging, installed here because this is the earliest
    // point in the session where a main window certainly exists. A
    // BONUS only: it puts the tags on as strokes are drawn, which is
    // auditable, but every revision binds what is still untagged anyway,
    // so a build that refuses the listener loses nothing but the timing.
    // Hence no message and no problems entry when it says no -- there is
    // nothing for the user to do about it.
    CsBind.installListener();
    SurveyNotebook.updateLineworkButton(w);

    // a fresh sheet starts with its first two stations
    SurveyNotebook.addStationRow(w, "A1");
    SurveyNotebook.addStationRow(w, "A2");

    if (w.problems.length > 0) {
        EAction.handleUserWarning("Survey Notebook: this build's script " +
            "bridge refused: " + w.problems.join("; ") +
            " -- those controls are inert; the rest of the panel works.");
    }

    SurveyNotebook.refresh(w);

    // The page model is otherwise reachable only through the closures
    // the dock's own controls hold. The launcher needs it to open a
    // trip on a chosen station (startTripAt below), so the last dock
    // built publishes it here -- the dock is a singleton, so "last" and
    // "the" are the same thing.
    SurveyNotebook.page = w;

    // THE DOCK RESTORED ALREADY VISIBLE never sends a visibility change,
    // so nothing above ever fires for it, and the pane sits empty until
    // the caver toggles it off and on.
    //
    // IT RETRIES RATHER THAN GUESSING A DELAY. A single shot was tried
    // at 1200ms and missed: this drawing lives on a shared drive and
    // was not open yet when it fired, so the fill found no document,
    // returned, and never came back -- measured, the pane still empty
    // with scansForDoc never set. There is no signal here for "a
    // drawing is now open", so the pane asks until there is one.
    //
    // It stops the moment it succeeds, so the cost is a handful of
    // null checks on a normal start, and it gives up rather than
    // polling forever on a session where no drawing is ever opened.
    try {
        var tries = 0;
        var firstFill = new QTimer();
        firstFill.interval = 600;
        firstFill.timeout.connect(function() {
            tries++;
            var page = SurveyNotebook.page;
            var filled = (!isNull(page) && page.scansForDoc !== undefined &&
                page.scansForDoc !== null);
            if (filled || tries > SurveyNotebook.SCAN_FILL_TRIES) {
                firstFill.stop();
                return;
            }
            SurveyNotebook.refillIfStale(page);
        });
        firstFill.start();
    } catch (eFirst) {
        w.problems.push("scan pane first fill (" + eFirst + ")");
    }

    // A RE-SHOWN DOCK RE-READS THE SCANS, the way Sketch Scans already
    // does with the same signal. Filling only from the menu action's
    // beginEvent was not enough (Nathan, 2026-09-12: "I have to turn it
    // off and on again to get it to work"): restoreState can bring this
    // dock back ALREADY VISIBLE at startup, which is not a toggle and so
    // never ran the fill -- and the fill it did run was guarded on the
    // list being empty, so a page left over from another drawing stayed
    // put. Showing the dock is the moment the caver is about to look, so
    // that is when the folder is read.
    //
    // Wrapped: not every bridge has the signal, and without it the panel
    // behaves as it did before rather than failing to build.
    try {
        dock.visibilityChanged.connect(function(shown) {
            if (shown !== true) {
                // THE GHOST BELONGS TO THE OPEN PANEL. A preview of a
                // page nobody can see is a set of lines over the map
                // with nothing to explain them, and no way to make
                // them go away.
                SurveyNotebook.clearGhost();
                return;
            }
            SurveyNotebook.refillIfStale(SurveyNotebook.page);
            // Back on show: the page is still there, so its ghost
            // should be too.
            SurveyNotebook.ghostSoon(SurveyNotebook.page);
        });
    } catch (eVis) {
        w.problems.push("scan pane refresh on show (" + eVis + ")");
    }
    return dock;
};

// ---------------------------------------------------------------------
// Tool entry: the dock is created at startup (init), the action just
// toggles it.
// ---------------------------------------------------------------------

/** Builds the dock and hands it to the main window. Idempotent. */
SurveyNotebook.ensureDock = function() {
    if (csNotebookDock !== undefined && csNotebookDock !== null) {
        return csNotebookDock;
    }
    var appWin = RMainWindowQt.getMainWindow();
    csNotebookDock = SurveyNotebook.buildDock(appWin);
    appWin.addDockWidget(Qt.RightDockWidgetArea, csNotebookDock);
    return csNotebookDock;
};

/**
 * Opens the notebook on a blank trip that starts AT a named station --
 * "carry on where trip 6 stopped", from the cave launcher.
 *
 * The page is a fresh trip, not a reconstruction: the shots are the
 * ones about to be measured. Only the tie-in station is filled in, and
 * a blank row beneath it for the first new station, because that is
 * exactly what a paper page looks like at the start of a trip.
 *
 * Deliberately NOT setSurvey: an empty survey makes that function open
 * a page on "A1", which is right for a new cave and wrong for every
 * continuation.
 *
 * \param station the station the new trip ties into.
 * \return true if the page was seeded.
 */
/**
 * What the open drawing already knows about the NEXT trip: the last
 * trip's team and declination (the crew and the field the new page
 * most likely shares), and the cave's open ends, newest trip first.
 * Everything stays editable -- these are prefills, not facts about
 * the page. Empty-handed (never throwing) for a legacy or absent
 * drawing.
 */
SurveyNotebook.tripDefaults = function() {
    var out = { team: "", instruments: "", declination: null, ends: [] };
    try {
        var doc = getDocument();
        if (doc === undefined || doc === null) { return out; }
        var recon = CsRevise.surveyFromDocument(doc);
        if (recon.legacy === true) { return out; }
        var sv = recon.survey;
        if (sv.trips !== undefined && sv.trips !== null &&
                sv.trips.length > 0) {
            var t = sv.trips[sv.trips.length - 1];
            out.team = t.team || "";
            out.instruments = t.instruments || "";
            out.declination = (t.declination === undefined ||
                t.declination === null) ? null : t.declination;
        } else {
            out.team = sv.team || "";
            out.instruments = sv.instruments || "";
            out.declination = sv.declination;
        }
        var ends = CsFrontier.openEnds(sv, {});
        for (var i = 0; i < ends.length; i++) {
            out.ends.push(ends[i].station);
        }
    } catch (e) {
        // nothing to prefill is a fine answer
    }
    return out;
};

SurveyNotebook.startTripAt = function(station) {
    var w = SurveyNotebook.page;
    if (w === undefined || w === null) { return false; }

    var name = (station === undefined || station === null) ? "" : String(station);
    if (name === "") { return false; }

    try {
        w.loading = true;
        // A NEW trip, so the page stops being a revision of the trip it
        // may have been loaded from -- otherwise Draw would overwrite
        // that trip with this new one's shots.
        w.loadedTripId = null;
        w.nameEdit.text = "";
        if (typeof CsPackage !== "undefined") {
            // CsPackage.todayText, not QDate: this bridge has no QDate.
            w.dateEdit.text = CsPackage.todayText();
        }
        // the drawing already knows the crew and the declination the
        // last trip ran under -- prefill, keep editable
        var defaults = SurveyNotebook.tripDefaults();
        w.teamEdit.text = defaults.team;
        w.instrEdit.text = defaults.instruments;
        if (defaults.declination !== null) {
            w.declEdit.text = (typeof CsRevise !== "undefined" &&
                typeof CsRevise.declText === "function") ?
                CsRevise.declText(defaults.declination) :
                String(defaults.declination);
        }
        SurveyNotebook.clearLadder(w);
        // The tie-in, then the row its first shot arrives at.
        SurveyNotebook.addStationRow(w, name);
        SurveyNotebook.addStationRow(w, "");
        w.loading = false;
        SurveyNotebook.refresh(w);
        return true;
    } catch (e) {
        w.loading = false;
        return false;
    }
};

/**
 * The notebook's own way into the next trip: pick the tie-in station
 * (prefilled with the newest open end), then seed a fresh page on it
 * -- the same page the Cave Shelf's New Trip seeds, without leaving
 * the notebook.
 */
SurveyNotebook.newTrip = function(w) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        QMessageBox.warning(null, "Survey Notebook", "No drawing is open.");
        return;
    }

    // a page with measurements on it is about to be replaced
    var dirty = false;
    for (var i = 0; i < w.rows.length; i++) {
        if (String(w.rows[i].dist.text) !== "" ||
                String(w.rows[i].az.text) !== "") {
            dirty = true;
            break;
        }
    }
    if (dirty) {
        var sure = QMessageBox.question(null, "Survey Notebook",
            "Start a new trip? This page's entries are cleared; the " +
            "drawing is not touched.", QMessageBox.Yes | QMessageBox.No);
        if (sure !== QMessageBox.Yes) {
            return;
        }
    }

    var defaults = SurveyNotebook.tripDefaults();
    var label = "Tie the new trip into station:";
    if (defaults.ends.length > 0) {
        var shown = defaults.ends.slice(0, 6).join(", ");
        if (defaults.ends.length > 6) { shown += ", ..."; }
        label += "\nOpen ends: " + shown;
    }
    var dialog = new QInputDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = "New Trip";
    dialog.setInputMode(QInputDialog.TextInput);
    dialog.setLabelText(label);
    dialog.setTextValue(defaults.ends.length > 0 ? defaults.ends[0] : "A1");
    var answer = dialog.exec();
    var typed = (answer === 0) ? null : String(dialog.textValue());
    destrDialog(dialog);
    if (typed === null) { return; }
    typed = typed.replace(/^\s+|\s+$/g, "").toUpperCase();
    if (typed === "") { return; }
    SurveyNotebook.startTripAt(typed);
};

SurveyNotebook.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    try {
        var existed = (csNotebookDock !== undefined && csNotebookDock !== null);
        var dock = SurveyNotebook.ensureDock();
        dock.visible = existed ? !dock.visible : true;
        // The scans pane can have been built with no drawing open --
        // the dock is built during add-on init, before any document --
        // so a pane restored open had nothing to list. Fill it now, on
        // the way to being looked at.
        // NOT "only if the list is empty" any more. A list left over
        // from another drawing is full and wrong, which is the case
        // most worth refilling; and on a bridge without
        // visibilityChanged this is the only fill there is.
        if (dock.visible === true) {
            SurveyNotebook.refillIfStale(SurveyNotebook.page);
        }
    } catch (e) {
        csNotebookDock = undefined;
        CsTell.warn("Survey Notebook: this QCAD build refused the docked " +
            "panel (" + e + "). Azimuth Traverse and Import Cave Survey " +
            "cover the same work meanwhile -- please report this.");
    }

    this.terminate();
};

SurveyNotebook.init = function(basePath) {
    var action = new RGuiAction(qsTr("Survey Notebook"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/SurveyNotebook.js");
    action.setIcon(basePath + "/SurveyNotebook.svg");
    action.setStatusTip(qsTr("A docked survey notes page: stations down the side, shots between them, closures live"));
    action.setDefaultCommands(["surveynotebook", "snb"]);
    action.setGroupSortOrder(451);
    action.setSortOrder(10);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // Build the dock NOW, during add-on init: the main window's
    // readSettings()/restoreState() runs after init and can only place
    // (and re-show) a dock that already exists. Created hidden; the
    // saved window state decides whether it opens, exactly like QCAD's
    // own docks. First-ever run: stays hidden until the action shows it.
    try {
        var dock = SurveyNotebook.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        // no dock at startup: the action's beginEvent will retry and
        // report if it still fails
        csNotebookDock = undefined;
    }
};
