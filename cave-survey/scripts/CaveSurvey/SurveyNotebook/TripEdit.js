// TripEdit.js
//
// The trip metadata editor: correct a trip's name, date, team and
// instruments after the trip has been drawn, or delete the trip
// outright. It lives inside Survey Notebook now, opened from the
// "..." menu's "Edit this trip..." entry -- it used to be its own
// menu tool, called Edit Trip, and this file is that tool moved
// wholesale rather than rewritten.
//
// It moved because of WHERE trip metadata is displayed, not because
// anything about the editing changed. Typed once in the Notebook
// header, these four fields were uncorrectable there: the path that
// looks like it should work forks the cave. "Load from drawing"
// replaces the trip whose FINGERPRINT (date | team) matches the page,
// so editing either field on the page means nothing matches on the
// next Draw and the page lands as a brand new trip beside the old
// one. This edits by TRIP ID instead, which is what makes a typo fix
// a typo fix rather than a duplicate. When the Notebook already has a
// trip loaded (TripEdit.open is called with its id), the edit lands
// on THAT trip with no picking step; called with nothing, it shows
// every trip in the drawing and the caver picks the row.
//
// It moves nothing. No geometry, elevation, LRUD, linework binding or
// profile depends on these fields, so there is no redraw, no resolve
// and no backup -- one modify operation over one point per trip.
//
// Declination is shown but not editable here. Changing it rotates every
// azimuth and moves the whole plan, and it already has an editor with
// the IGRF wiring: Survey Notebook's Declination dialog.
//
// Each row also carries a Delete button, and that one IS destructive:
// it removes the trip's shots, its drawn marks and its legs, renumbers
// every later trip (ids are array indices, stamped into XDATA), and
// redraws the cave without it. It asks first, by name, and it asks
// separately about any hand-traced linework bound to that trip --
// tracing is never thrown away on a default.

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

// The namespace, declared rather than inherited. This file used to be
// the Edit Trip TOOL, and the object below was created as a side effect
// of the `function EditTrip(guiAction)` constructor the menu entry
// needed. Folding the tool into Survey Notebook removed the
// constructor, which removed the object -- and then the very first
// `TripEdit.read = ...` threw a ReferenceError at load time, silently,
// taking the whole file with it. Nothing failed: the headless suite
// drives Core/CsTripEdit.js directly and never loads this file, so
// "Edit this trip..." simply did nothing in the running application.
var TripEdit = {};

/**
 * Reads the drawing's trips, or explains why it cannot.
 * \return {ok, rows, survey, error}
 */
TripEdit.read = function(doc) {
    var recon;
    try {
        recon = CsRevise.surveyFromDocument(doc);
    } catch (e) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: could not read this drawing's survey (" +
                e + ")." };
    }
    if (recon === null || recon === undefined ||
            recon.survey === null || recon.survey === undefined) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: no survey in this drawing." };
    }
    if (recon.legacy === true) {
        // A legacy drawing's trips are CHAIN-GUESSED, not read off
        // anchor tags -- there is nothing to write an edit onto, and
        // an edit that appeared to work and vanished on reopen would
        // be worse than a refusal.
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: this drawing predates the current tag " +
                "schema, so its trips are reconstructed rather than " +
                "recorded, and there is nowhere to store an edit. Run " +
                "Rebuild Survey Data first -- it upgrades the tags in " +
                "place -- then try again." };
    }
    var rows = CsTripEdit.rows(recon.survey);
    if (rows.length === 0) {
        return { ok: false, rows: [], survey: null,
            error: "Edit Trip: this drawing has no trips yet." };
    }
    return { ok: true, rows: rows, survey: recon.survey, error: "" };
};

/** Which trip ids actually have an anchor point to write onto. */
TripEdit.anchoredTrips = function(doc) {
    var out = {};
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e) || CsTags.get(e, "Station") === "" ||
                typeof e.getPosition !== "function") {
            continue;
        }
        var tid = CsTags.getNumber(e, "Trip");
        if (tid !== null) {
            out[tid] = true;
        }
    }
    return out;
};

/** Upper-cases as typed, the same as the Notebook's header fields --
 *  station names, teams and instruments are upper case throughout the
 *  suite, and a lower-case correction would stand out on the map. */
TripEdit.upperCase = function(edit) {
    try {
        edit.textEdited.connect(function() {
            var t = String(edit.text);
            var u = t.toUpperCase();
            if (u !== t) {
                var pos = edit.cursorPosition;
                edit.text = u;
                try {
                    edit.cursorPosition = pos;
                } catch (eCur) {
                    // cursor jumps to the end -- cosmetic
                }
            }
        });
    } catch (e) {
        // no auto-caps; typing still works
    }
    return edit;
};

/** The summary line after a successful edit. */
TripEdit.reportText = function(changes, res) {
    if (changes.length === 0) {
        return "Edit Trip: nothing changed.";
    }
    var msg = "Edit Trip: " + changes.length + " trip" +
        (changes.length === 1 ? "" : "s") + " updated (";
    var parts = [];
    for (var i = 0; i < changes.length; i++) {
        parts.push("trip " + changes[i].tripId);
    }
    msg += parts.join(", ") + "). Tags only -- nothing was moved or " +
        "redrawn.";
    if (res.missing.length > 0) {
        msg += " Trip " + res.missing.join(", trip ") + " has no " +
            "station in the drawing to carry its metadata, so that " +
            "edit could not be stored.";
    }
    if (CsTripEdit.dateChanged(changes)) {
        msg += " A changed date means the trip's declination was " +
            "estimated for the wrong day: check it in Survey " +
            "Notebook > Declination.";
    }
    return msg;
};

/**
 * The destructive half: confirm, ask about the tracing, delete.
 *
 * Two questions, never merged into one. The first is "is this the trip
 * you meant" -- named, dated, with its shot count, because a trip id is
 * not something anyone recognises. The second is only asked when there
 * IS hand-traced linework bound to it, and it has no default: keeping
 * hours of tracing or deleting it is the caver's call, not a checkbox
 * they might not have read.
 */
TripEdit.deleteTrip = function(doc, di, read, request) {
    var tripId = request.tripId;
    var recon;
    try {
        // Re-read: the dialog's survey has been through planEdits and
        // may carry uncommitted edits, and a delete must act on what
        // the DRAWING says.
        recon = CsRevise.surveyFromDocument(doc);
    } catch (eRe) {
        QMessageBox.warning(null, "Edit Trip",
            "Couldn't re-read the drawing (" + eRe + "). Nothing was " +
            "deleted.");
        return;
    }

    var bound = CsTripEdit.lineworkOfTrip(doc, tripId, {}).owned.length;
    var sure = QMessageBox.question(null, "Edit Trip",
        "Delete " + request.label + " from this drawing?\n\n" +
        "Its " + request.shots + " shot" +
        (request.shots === 1 ? "" : "s") + ", the stations only it " +
        "reaches and everything drawn for them go. Every trip after " +
        "it is renumbered. The cave redraws without it, and the " +
        "previous version of the drawing is kept beside it first.",
        QMessageBox.Yes | QMessageBox.No);
    if (sure !== QMessageBox.Yes) {
        return;
    }

    // No default. A caver who does not answer this keeps their tracing.
    var keepLinework = true;
    if (bound > 0) {
        var answer = QMessageBox.question(null, "Edit Trip",
            bound + " piece" + (bound === 1 ? "" : "s") + " of traced " +
            "linework " + (bound === 1 ? "is" : "are") + " bound to " +
            "this trip.\n\nKeep the tracing (it stays in the drawing, " +
            "no longer claimed by any trip), or delete it with the " +
            "trip?\n\nYes keeps it. No deletes it.",
            QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel);
        if (answer === QMessageBox.Cancel) {
            return;
        }
        keepLinework = (answer === QMessageBox.Yes);
    }

    var res = CsTripEdit.deleteTrip(doc, di, recon, tripId,
        { keepLinework: keepLinework });
    if (!res.ok) {
        QMessageBox.warning(null, "Edit Trip", res.error);
        return;
    }

    var msg = "Edit Trip: deleted " + request.label + " -- " +
        res.removedShots + " shot" + (res.removedShots === 1 ? "" : "s") +
        " gone, " + res.trips + " trip" + (res.trips === 1 ? "" : "s") +
        " left, renumbered from " + tripId + " on.";
    if (res.linework.unbound > 0) {
        msg += " " + res.linework.unbound + " traced item" +
            (res.linework.unbound === 1 ? "" : "s") + " kept and " +
            "unbound.";
    }
    if (res.linework.deleted > 0) {
        msg += " " + res.linework.deleted + " traced item" +
            (res.linework.deleted === 1 ? "" : "s") + " deleted with it.";
    }
    if (res.linework.renumbered > 0) {
        msg += " " + res.linework.renumbered + " re-keyed to " +
            "the trip's new id.";
    }
    if (res.moved > 0) {
        msg += " The delete re-solved the survey: " + res.moved +
            " station" + (res.moved === 1 ? "" : "s") + " moved, and " +
            "the tracing bound to them followed.";
    }
    EAction.handleUserMessage(msg);
    QMessageBox.information(null, "Edit Trip", msg);
};

/**
 * Opens the trip metadata editor.
 *
 * \param tripId The trip the Notebook already has loaded
 *     (w.loadedTripId), or null/undefined when it has none. Given a
 *     tripId, only that trip's row is shown and there is no picking
 *     step -- the page on screen IS the trip being corrected. Given
 *     nothing, every trip in the drawing is listed and the caver picks
 *     the row, exactly as this dialog worked when it was its own menu
 *     entry.
 */
TripEdit.open = function(tripId) {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        CsTell.warn("Survey Notebook: no active drawing document.");
        return;
    }
    var di = getDocumentInterface();

    var read = TripEdit.read(doc);
    if (!read.ok) {
        EAction.handleUserMessage(read.error);
        return;
    }
    var anchored = TripEdit.anchoredTrips(doc);

    // planEdits still needs read.survey WHOLE -- its fingerprint
    // collision check has to see every trip, edited or not -- so only
    // the ROWS SHOWN narrow to the one trip; nothing about what the
    // edit is validated against changes.
    var rows = read.rows;
    var single = (typeof tripId === "number" && tripId >= 0);
    if (single) {
        rows = [];
        for (var ri = 0; ri < read.rows.length; ri++) {
            if (read.rows[ri].tripId === tripId) {
                rows.push(read.rows[ri]);
                break;
            }
        }
        if (rows.length === 0) {
            EAction.handleUserMessage("Survey Notebook: trip " + tripId +
                " is no longer in the drawing.");
            return;
        }
    }

    var dlg = new QDialog(getMainWindow());
    dlg.windowTitle = "Edit Trip";
    var layout = new QVBoxLayout();

    layout.addWidget(new QLabel(single ?
        ("Correct this trip's name, date, team or instrument list --\n" +
        "the edit lands on the trip you loaded, not on a new copy of\n" +
        "it, and nothing is moved or redrawn. Declination is not\n" +
        "edited here: changing it rotates the plan, so it lives in\n" +
        "Survey Notebook > Declination.") :
        ("The trips in this drawing. Correct a name, date, team or\n" +
        "instrument list here -- the edit lands on the trip you edit,\n" +
        "not on a new copy of it, and nothing is moved or redrawn.\n" +
        "Declination is not edited here: changing it rotates the plan,\n" +
        "so it lives in Survey Notebook > Declination.")), 0, 0);

    var host = new QWidget();
    var grid = new QGridLayout();
    var head = ["Trip", "Shots", "Declination", "Name", "Date (YYYY-MM-DD)",
        "Team", "Instruments", ""];
    for (var h = 0; h < head.length; h++) {
        grid.addWidget(new QLabel(head[h]), 0, h);
    }

    var fields = []; // {tripId, name, date, team, instruments}
    // Set by a row's Delete button, which then closes the dialog: the
    // delete runs after exec() returns, never inside a row handler
    // while the dialog it belongs to is still on screen.
    var deleteRequest = { tripId: -1, label: "", shots: 0 };
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var g = r + 1;
        grid.addWidget(new QLabel(row.label), g, 0);
        grid.addWidget(new QLabel(String(row.shots)), g, 1);
        grid.addWidget(new QLabel(CsRevise.declText(row.declination)),
            g, 2);

        var editable = anchored[row.tripId] === true;
        // Explicit widths: without them the grid shrinks every field to
        // its neighbours' size and a team reads ")S, JB" -- measured in
        // the real dialog, where the columns collapsed to a few
        // characters each.
        var mk = function(text, caps, width) {
            var e = new QLineEdit();
            e.text = text;
            try {
                e.setMinimumWidth(width);
                // A long team list fills the field and shows its TAIL
                // ("...NEGG, TIM HARRIS"), which reads as the wrong
                // name until you click into it. Show the start.
                e.setCursorPosition(0);
            } catch (eW) {
                // the field is still usable, just narrow
            }
            if (!editable) {
                try {
                    e.readOnly = true;
                    e.enabled = false;
                } catch (eRo) {
                    // cosmetic only; the write is gated below anyway
                }
            } else if (caps) {
                TripEdit.upperCase(e);
            }
            return e;
        };
        var nameEdit = mk(row.name, true, 150);
        var dateEdit = mk(row.date, false, 120);
        var teamEdit = mk(row.team, true, 240);
        var instrEdit = mk(row.instruments, true, 150);
        grid.addWidget(nameEdit, g, 3);
        grid.addWidget(dateEdit, g, 4);
        grid.addWidget(teamEdit, g, 5);
        grid.addWidget(instrEdit, g, 6);

        if (editable) {
            fields.push({ tripId: row.tripId, name: nameEdit,
                date: dateEdit, team: teamEdit, instruments: instrEdit });
        } else {
            var why = new QLabel("no station in the drawing carries " +
                "this trip's tags");
            why.enabled = false;
            grid.addWidget(why, g, 8);
        }

        // Delete lives on the row so it is unambiguous WHICH trip goes.
        // It closes the dialog: the trip list it is showing stops being
        // true the moment a delete renumbers everything after it.
        var delButton = new QPushButton(qsTr("Delete..."));
        delButton.toolTip = qsTr("Remove this trip from the drawing: " +
            "its shots, its marks and its legs, with every later trip " +
            "renumbered.");
        grid.addWidget(delButton, g, 7);
        (function(target) {
            try {
                delButton.clicked.connect(function() {
                    deleteRequest.tripId = target.tripId;
                    deleteRequest.label = target.label;
                    deleteRequest.shots = target.shots;
                    dlg.accept();
                });
            } catch (eDel) {
                delButton.enabled = false;
            }
        })(row);
    }
    host.setLayout(grid);

    var area = new QScrollArea();
    area.widgetResizable = true;
    area.setWidget(host);
    layout.addWidget(area, 1, 0);

    var buttons = new QHBoxLayout();
    var okButton = new QPushButton(qsTr("Apply"));
    var cancelButton = new QPushButton(qsTr("Cancel"));
    buttons.addStretch(1);
    buttons.addWidget(okButton, 0, 0);
    buttons.addWidget(cancelButton, 0, 0);
    layout.addLayout(buttons, 0);
    dlg.setLayout(layout);

    // The scroll area will happily scroll a table nobody can read: a
    // dialog sized to its own layout hint comes up ~600px wide and cuts
    // Team and Instruments off entirely (measured in the real dialog).
    // Open it wide enough to show every column, and let the scroll area
    // take over from there -- vertically for a cave with many trips,
    // horizontally on a small screen.
    try {
        dlg.resize(1180, Math.min(620, 220 + rows.length * 46));
    } catch (eSize) {
        // the layout's own size stands; the columns scroll
    }

    // Applied INSIDE the accept handler, not after exec(), so a
    // refusal can leave the dialog open with the caver's typing still
    // in it -- retyping four fields because one date had a typo is the
    // kind of thing that stops a tool being used. The widget text is
    // snapshotted here too, while the widgets are certainly alive.
    var applied = { done: false, changes: [], res: null };
    var onOk = function() {
        var inputs = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            inputs.push({ tripId: f.tripId, name: String(f.name.text),
                date: String(f.date.text), team: String(f.team.text),
                instruments: String(f.instruments.text) });
        }
        // THE SHARED SEQUENCE. plan -> apply -> write lives in
        // CsTripEdit.commit, because the Cave Shelf's trip table edits
        // the same four fields and must land them the same way.
        var done = CsTripEdit.commit(doc, di, read.survey, inputs);
        if (done.error !== undefined) {
            QMessageBox.warning(null, "Edit Trip", done.error);
            return; // dialog stays open, typing intact
        }
        applied.res = done.res;
        applied.changes = done.changes;
        applied.done = true;
        dlg.accept();
    };

    // One failed connect on either button is an unusable dialog -- an
    // Apply that does nothing, or a Cancel that cannot close. Say so
    // rather than showing it.
    var wired = true;
    try {
        okButton.clicked.connect(onOk);
    } catch (eOk) {
        wired = false;
    }
    try {
        cancelButton.clicked.connect(function() { dlg.reject(); });
    } catch (eCancel) {
        wired = false;
    }
    if (!wired) {
        QMessageBox.warning(null, "Edit Trip",
            "This build's script bridge couldn't wire the dialog " +
            "buttons. Nothing was changed.");
        return;
    }

    dlg.exec();

    if (deleteRequest.tripId >= 0) {
        TripEdit.deleteTrip(doc, di, read, deleteRequest);
        return;
    }
    if (!applied.done) {
        return; // cancelled
    }
    if (applied.res === null) {
        EAction.handleUserMessage("Edit Trip: nothing changed.");
        return;
    }
    EAction.handleUserMessage(
        TripEdit.reportText(applied.changes, applied.res));
};
