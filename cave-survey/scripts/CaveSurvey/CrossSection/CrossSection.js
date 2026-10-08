/**
 * CrossSection -- a cross section, three ways.
 *
 * Opens on a choice: cut one from the survey (two clicks, no dialog
 * beyond this one), trace one from a scanned field-book page, or reopen
 * one already traced. Those three used to be four separate menu
 * entries -- Cross Section, Sketch Section, Capture Section, Edit
 * Sketch -- and a student met "Capture Section" long before they had
 * anything to capture, with no way to tell from the menu that three of
 * the four are one workflow wearing different names at different
 * moments. One entry now, asked once, up front.
 *
 * CUT: pick a point on the surveyed centreline, pick where the section
 * goes. A cut between two stations is LOFTED from their own measured
 * wall points -- LRUD and splays, in 3D (CsSectionCut). Nothing is
 * carried in from a neighbouring passage and nothing is smoothed.
 * Between stations it is an interpolation and says so: every section's
 * caption states how far the cut is from the nearer station that fed
 * it, so a reader can tell a near-measurement from a guess without
 * being told the difference is small. ONE BLOCK PER SECTION: the
 * section is a block reference on a leader, so it drags as a unit and
 * can be edited without touching any other section. Draw redefines the
 * block in place; it never moves the reference. A caver who wants to
 * keep hand edits freezes that section.
 *
 * TRACE: opens the same staging bay Sketch Section always did --
 * SectionBay.run, unchanged -- and shows SectionBayPanel the moment it
 * succeeds, so the bay has a visible way out (Capture, Cancel) rather
 * than a command (`skc`) the caver had to already know existed.
 *
 * REOPEN: calls SectionEdit.run(), unchanged -- select a traced
 * section first, then choose this route.
 *
 * USAGE:
 *   Cave Survey > Cross Section   (or "crosssection" / "cxs")
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/../Callout/CalloutWrite.js");
// Loaded here, at CrossSection.js's own top level, and in this order.
// Nothing includes CrossSection.js back, so unlike the old
// SketchSection/SectionCapture/SectionEdit trio (which each registered
// their own menu entry and had to defer including each other to dodge a
// circular include -- see SectionBay.js's header) this is a plain chain:
// SectionBay loads fully, then SectionCapture (whose own top-level
// include of SectionBay.js is now a no-op), then SectionEdit (ditto),
// then the panel, which needs both.
include(includeBasePath + "/SectionBay.js");
include(includeBasePath + "/SectionCapture.js");
include(includeBasePath + "/SectionEdit.js");
include(includeBasePath + "/SectionBayPanel.js");

function CrossSection(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];
    this.pick = null;        // {from, to, t} the cut, taken on click one
    this.cut = null;         // the CsSectionCut result for it
    this.position = null;
    this.previewPos = undefined;
    this.leader = CsCallout.LEADER_DEFAULT;
}

CrossSection.prototype = new EAction();

CrossSection.State = {
    PickingCut: 0,
    PickingPosition: 1
};

CrossSection.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocks(doc, "Cross Section")) {
        this.terminate();
        return;
    }

    // Three ways to get a section, asked once. The cut route is what a
    // caver reaches for most, so it is the default; the other two used
    // to be menu entries of their own, which put "Capture Section" in
    // front of a student who had nothing yet to capture.
    var routeDlg = new QDialog(getMainWindow());
    routeDlg.windowTitle = qsTr("Cross Section");
    var v = new QVBoxLayout();
    var cut = new QRadioButton(qsTr("Cut it from the survey"));
    var trace = new QRadioButton(qsTr("Trace a scanned section"));
    var reopen = new QRadioButton(qsTr("Reopen a section I already traced"));
    cut.checked = true;
    v.addWidget(cut, 0, 0);
    v.addWidget(trace, 0, 0);
    v.addWidget(reopen, 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    // CLOSURES, NOT SLOT NAMES. `signal.connect(dialog, "accept")` --
    // the Qt Script idiom this suite used everywhere -- THROWS in this
    // build: "Function.prototype.connect: target is not a function".
    // The engine's connect takes a function, or a receiver plus a
    // function, and never a slot name. It threw where the dialog was
    // built, so the tool died before the dialog was ever shown.
    // Measured against the running application, 2026-09-06.
    bb.accepted.connect(function() { routeDlg.accept(); });
    bb.rejected.connect(function() { routeDlg.reject(); });
    v.addWidget(bb, 0, 0);
    routeDlg.setLayout(v);
    if (routeDlg.exec() !== QDialog.Accepted) {
        // destroy() THROWS on every QDialog in this build --
        // "Invalid attempt to destroy() an indestructible object",
        // parented or not (measured 2026-09-06). The dialog is
        // closed and handed to Qt to delete instead, and even that
        // is guarded: tearing down a dialog must never cost the
        // answer the caver just gave it.
        try {
            routeDlg.close();
            routeDlg.deleteLater();
        } catch (eClose) {
        }
        this.terminate();
        return;
    }
    var route = cut.checked ? "cut" : (trace.checked ? "trace" : "reopen");
    // destroy() THROWS on every QDialog in this build --
    // "Invalid attempt to destroy() an indestructible object",
    // parented or not (measured 2026-09-06). The dialog is
    // closed and handed to Qt to delete instead, and even that
    // is guarded: tearing down a dialog must never cost the
    // answer the caver just gave it.
    try {
        routeDlg.close();
        routeDlg.deleteLater();
    } catch (eClose) {
    }

    if (route === "trace") {
        // Replaces the old "Sketch Section" command (`sketchsection`/
        // `sks`): SectionBay.run asks for the station itself when none
        // is given, exactly as that command's own beginEvent did.
        var bayId = SectionBay.run(null, null);
        if (bayId !== null) {
            var bay = SectionCapture.findBay(doc);
            if (bay !== null) {
                SectionBayPanel.show(doc, di, bay);
            }
        }
        this.terminate();
        return;
    }
    if (route === "reopen") {
        // Replaces the old "Edit Sketch" command (`sectionedit`/`ske`).
        SectionEdit.run();
        this.terminate();
        return;
    }

    CsLayers.ensure(doc, di, CsLayers.CTRL_SECTION_OUTLINE);
    this.setState(CrossSection.State.PickingCut);
};

CrossSection.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case CrossSection.State.PickingCut:
        di.clearPreview();
        di.repaintViews();
        this.setCommandPrompt(qsTr("Pick the point on the survey to cut " +
            "a section at"));
        this.setLeftMouseTip(qsTr("Point on the passage to cut at"));
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        break;

    case CrossSection.State.PickingPosition:
        this.setCommandPrompt(qsTr("Pick where the section goes"));
        this.setLeftMouseTip(qsTr("Position of the section"));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

CrossSection.prototype.escapeEvent = function() {
    switch (this.state) {
    case CrossSection.State.PickingPosition:
        this.previewPos = undefined;
        this.setState(CrossSection.State.PickingCut);
        break;
    default:
        EAction.prototype.escapeEvent.call(this);
        break;
    }
};

/** One "Cross Section: ..." message, however this build can show it. */
CrossSection.prototype.say = function(text) {
    try {
        QMessageBox.information(RMainWindowQt.getMainWindow(),
            qsTr("Cross Section"), text);
    } catch (e) {
        EAction.handleUserWarning(text);
    }
};

CrossSection.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = this.getDocument();
    var pos = event.getModelPosition();

    switch (this.state) {
    case CrossSection.State.PickingCut:
        if (!preview) {
            // Resolve NOW, on the click. This is the expensive call --
            // it rebuilds the survey from the drawing -- and it runs
            // once per placement, never once per mouse move.
            var asDrawn = null;
            try {
                asDrawn = CsRevise.resolveAsDrawn(doc);
            } catch (eRes) {
                asDrawn = null;
            }
            if (asDrawn === null || isNull(asDrawn.resolved)) {
                this.say(qsTr("This drawing has no survey to cut a " +
                    "section from."));
                this.terminate();
                return;
            }
            var leg = CsSectionCut.nearestLeg(asDrawn.resolved,
                { x: pos.x, y: pos.y });
            if (leg === null) {
                this.say(qsTr("No survey leg near that point, so there " +
                    "is no passage to cut through.\n\nClick on or beside " +
                    "the centreline."));
                this.terminate();
                return;
            }
            var cut = CsSectionCut.cut(asDrawn.survey, asDrawn.resolved,
                leg.from, leg.to, leg.t, {});
            if (cut.refused === true) {
                // Refused, with the reason -- never a section drawn from
                // two points and a hope.
                this.say(qsTr("No section could be cut there: ") +
                    cut.reason + ".");
                this.terminate();
                return;
            }
            this.pick = leg;
            this.cut = cut;
            this.survey = asDrawn.survey;
            this.tips = [{ x: pos.x, y: pos.y }];
            di.setRelativeZero(pos);
            EAction.handleUserMessage(
                qsTr("Cutting %1->%2 at %3% -- %4 from the nearest station")
                    .arg(leg.from).arg(leg.to)
                    .arg(Math.round(leg.t * 100))
                    .arg(CsSectionDraw.round1(cut.nearest)));
            this.setState(CrossSection.State.PickingPosition);
        }
        break;

    case CrossSection.State.PickingPosition:
        this.previewPos = { x: pos.x, y: pos.y };
        if (!preview) {
            this.position = { x: pos.x, y: pos.y };
            di.setRelativeZero(pos);
            this.finish();
        }
        break;
    }
};

CrossSection.prototype.finish = function() {
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di) || this.cut === null) {
        this.terminate();
        return;
    }
    try {
        var id = CalloutWrite.createSection(doc, di, {
            cut: this.cut,
            from: this.pick.from,
            to: this.pick.to,
            t: this.pick.t,
            position: this.position,
            tips: this.tips,
            leader: this.leader
        });
        if (id === null) {
            this.say(qsTr("The section could not be drawn -- its block " +
                "was refused by this drawing."));
        } else {
            var notes = [];
            if (this.cut.reentrant === true) {
                notes.push(qsTr("a re-entrant was simplified"));
            }
            if (this.cut.reseeded === true) {
                notes.push(qsTr("the section is rotated to keep a steady " +
                    "up on this pitch"));
            }
            EAction.handleUserMessage(
                qsTr("Section cut from %1 measured points at %2 and %3 " +
                    "at %4")
                    .arg(this.cut.measuredFrom + this.cut.measuredTo)
                    .arg(this.pick.from).arg(this.pick.to)
                    .arg(this.pick.from + "->" + this.pick.to) +
                (notes.length > 0 ? " -- " + notes.join(", ") : ""));
        }
    } catch (e) {
        // LOCKED and FROZEN layers refuse writes SILENTLY in this build,
        // so the alternative is a command that looks like it worked and
        // drew nothing.
        this.say(qsTr("The section could not be drawn.\n\n") + e);
    }
    this.terminate();
};

CrossSection.init = function(basePath) {
    var action = new RGuiAction(qsTr("Cross Section"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/CrossSection.js");
    action.setIcon(basePath + "/CrossSection.svg");
    action.setStatusTip(qsTr("Cut a rough cross section from the " +
        "survey, trace one from a scanned field-book page, or reopen " +
        "one already traced"));
    action.setDefaultCommands(["crosssection", "cxs"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);

    // The capture action, registered but deliberately given no menu
    // entry, no toolbar button and no command name -- it is reachable
    // only from the bay panel, which is on screen only while there is a
    // bay to capture. It still has to be a registered RGuiAction for
    // the interactive EAction to run.
    SectionCapture.init(basePath);

    // The bay panel is built HERE, in the application's script engine,
    // never from beginEvent -- which runs in the active tab's own engine
    // and would leave the panel's buttons wired to it after the tab
    // closed. See SectionBayPanel.js's header. Also before
    // restoreState(), which can only place a dock that already exists.
    try {
        SectionBayPanel.install();
    } catch (eDock) {
        warning("Cross Section: could not build the bay panel at " +
            "startup (" + eDock + ").");
    }
};
