// survey-notebook.js -- Survey Notebook: a trip's header, then shots, LRUD
// readings and station notes typed into the ladder while the status box
// reports on them.
//
// The Notebook's page is the user's own unsaved typing. setup REFUSES to
// film over a page with anything on it, and teardown puts the page back
// to the empty state setup found (same row count, every cell blank), so a
// take never costs anyone a half-typed trip. Draw is not pressed: it
// would write a trip into the drawing and can raise dialogs.
//
// Cells are filled with setText, which does not fire textEdited, so each
// step calls refresh() the way a keystroke would.
CsDemoScenario = {
    gif: "survey-notebook-demo.gif",
    size: [800, 900],
    width: 640,
    fps: 12,
    rows0: 0,
    names0: [],
    statusWas: true,
    cells: ["name", "dist", "az", "inc", "l", "r", "u", "d"],
    dock: function() {
        return SurveyNotebook.ensureDock();
    },
    wipe: function() {
        var w = SurveyNotebook.page;
        w.nameEdit.setText("");
        w.dateEdit.setText("");
        w.teamEdit.setText("");
        for (var i = 0; i < w.rows.length; i++) {
            for (var c = 0; c < CsDemoScenario.cells.length; c++) {
                w.rows[i][CsDemoScenario.cells[c]].setText("");
            }
            w.rows[i].notes.setPlainText("");
            // a fresh page comes with its first stations already named
            if (i < CsDemoScenario.names0.length) {
                w.rows[i].name.setText(CsDemoScenario.names0[i]);
            }
        }
        SurveyNotebook.refresh(w);
    },
    setup: function() {
        var w = SurveyNotebook.page;
        var used = String(w.nameEdit.text) + String(w.dateEdit.text) +
            String(w.teamEdit.text);
        CsDemoScenario.names0 = [];
        for (var i = 0; i < w.rows.length; i++) {
            CsDemoScenario.names0.push(String(w.rows[i].name.text));
            // station names do not count: a fresh page names its first
            // stations itself, and they are put back as found
            for (var c = 1; c < CsDemoScenario.cells.length; c++) {
                used += String(w.rows[i][CsDemoScenario.cells[c]].text);
            }
            used += String(w.rows[i].notes.plainText);
        }
        if (used !== "") {
            throw new Error("the Notebook page has typing on it; " +
                "refusing to film over it");
        }
        CsDemoScenario.rows0 = w.rows.length;
        // the Status button's state is a remembered setting: note it and
        // hand it back
        CsDemoScenario.statusWas = (w.statusLabel.visible === true);
        SurveyNotebook.refresh(w);
    },
    teardown: function() {
        var w = SurveyNotebook.page;
        while (w.rows.length > CsDemoScenario.rows0) {
            SurveyNotebook.removeLastStation(w);
        }
        CsDemoScenario.wipe();
        if ((w.statusLabel.visible === true) !== CsDemoScenario.statusWas) {
            w.statusButton.click();
        }
    },
    steps: function() {
        var w = SurveyNotebook.page;
        function field(edit, text, per) {
            return [
                { click: { widget: edit }, ms: 650,
                  run: function() { edit.setFocus(); }, hold: 120 },
                { style: "ibeam" },
                { type: text, per: per || 95, hold: 350,
                  set: function(t) {
                      edit.setText(t);
                      SurveyNotebook.refresh(w);
                  } },
                { style: "arrow" }
            ];
        }
        // a ladder cell, found at the time the cursor sets off
        function cell(row, name) {
            return function() { return w.rows[row][name]; };
        }
        function ladder(row, name, text) {
            var edit = function() { return w.rows[row][name]; };
            return [
                { click: { lazy: function() { return { widget: edit() }; } },
                  ms: 500, run: function() { edit().setFocus(); }, hold: 100 },
                { style: "ibeam" },
                { type: text, per: 100, hold: 250,
                  set: function(t) {
                      edit().setText(t);
                      SurveyNotebook.refresh(w);
                  } },
                { style: "arrow" }
            ];
        }
        // a station's note is a multi-line box, not a QLineEdit
        function note(row, text) {
            var box = function() { return w.rows[row].notes; };
            return [
                { click: { lazy: function() { return { widget: box(), at: [0.3, 0.4] }; } },
                  ms: 550, run: function() { box().setFocus(); }, hold: 100 },
                { style: "ibeam" },
                { type: text, per: 85, hold: 450,
                  set: function(t) {
                      box().setPlainText(t);
                      SurveyNotebook.refresh(w);
                  } },
                { style: "arrow" }
            ];
        }
        function lrud(row, l, r, u, d) {
            return ladder(row, "l", l).concat(ladder(row, "r", r),
                ladder(row, "u", u), ladder(row, "d", d));
        }
        var steps = [{ wait: 1000 }];
        steps = steps.concat(field(w.nameEdit, "SURVEY THE MAIN PASSAGE"));
        steps = steps.concat(field(w.dateEdit, "2026-10-04"));
        steps = steps.concat(field(w.teamEdit, "NS, AB"));
        // the status box is where closures, stats and warnings appear
        steps.push({ click: { widget: w.statusButton }, ms: 700,
            run: function() {
                if (w.statusLabel.visible !== true) {
                    w.statusButton.click();
                }
            }, hold: 900 });
        // the first shot goes in first: with a second station and no
        // distance the status line rightly complains, and a clip that
        // opens on an error teaches the wrong thing
        steps = steps.concat(ladder(1, "dist", "42.5"));
        steps = steps.concat(ladder(1, "az", "135"));
        steps = steps.concat(ladder(1, "inc", "-4"));
        // the walls at each end of it, and a note at the first station
        steps = steps.concat(lrud(0, "3", "4", "6", "2"));
        steps = steps.concat(note(0, "ENTRANCE"));
        steps = steps.concat(lrud(1, "2", "5", "4", "3"));
        steps.push({ click: { widget: w.addRowButton }, ms: 650,
            run: function() { w.addRowButton.click(); }, hold: 700 });
        steps = steps.concat(ladder(2, "dist", "38"));
        steps = steps.concat(ladder(2, "az", "112"));
        steps = steps.concat(ladder(2, "inc", "2"));
        steps = steps.concat(lrud(2, "4", "3", "5", "2"));
        steps = steps.concat(note(2, "DRAFT FROM LEFT WALL"));
        steps.push({ wait: 2000 });
        return steps;
    }
};
