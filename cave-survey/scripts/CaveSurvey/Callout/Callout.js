/**
 * CsCallout -- place a text note bound to one or more leader arrows.
 *
 * QCAD has no multileader; this is it. A callout is a linked pair: a
 * real RTextEntity plus one real RLeaderEntity per tip, joined by a
 * shared CalloutId in CsTags XDATA (see Core/CsCallout.js). The text
 * stays an ordinary text entity, so QCAD's native text editor, grips
 * and property editor keep working unchanged; CsCalloutSync (and later
 * CalloutListener) is what keeps the arrows glued to it afterwards.
 *
 * SHAPE: this file follows AlignImage.js, the suite's reference
 * interactive tool -- a State enum, initState() (not setState) for
 * prompts/cursor/click-mode, pickCoordinate(event, preview) for both
 * the real pick and the live preview, escapeEvent stepping back one
 * state. Deviating from that
 * shape is what makes a tool feel unlike the rest of the suite.
 *
 * NOTHING is added to the document until finish() succeeds. That is
 * why escapeEvent needs no cleanup at any state: unlike AlignImage
 * (which may have pre-selected entities to release) or QCAD's own
 * Leader tool (which adds its RLeaderEntity on the FIRST click and has
 * to delete it again on a same-state escape), a cancelled Callout
 * simply never wrote anything.
 */
include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");
include(includeBasePath + "/CalloutWrite.js");

function Callout(guiAction) {
    EAction.call(this, guiAction);
    this.tips = [];             // [{x,y}] one per branch, in pick order
    this.noteText = undefined;  // collected between the two picks
    this.leader = CsCallout.LEADER_DEFAULT;
    this.kind = CsCallout.KIND_TEXT;
    this.extraTags = null;
    this.previewPos = undefined;
    this.position = null;       // {x,y} chosen note position, or null
    this.previewPos = undefined; // last mouse position while picking it
    this.style = CsCallout.STYLE_DEFAULT;
    // Chosen by the source dialog in beginEvent, before the first pick:
    // true skips the typed-text dialog entirely and samples the floor
    // on the click instead -- this used to be a second command
    // (CalloutElev), folded in as Task 4 of the teachable consolidation.
    this.elevationMode = false;
}

Callout.prototype = new EAction();

Callout.State = {
    PickingTip: 0,
    PickingPosition: 1
};


Callout.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var doc = this.getDocument();
    if (isNull(doc)) {
        this.terminate();
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocks(doc, "Callout")) {
        this.terminate();
        return;
    }

    // Which source the note's text comes from. Two clicks either way --
    // this only decides whether the first click is a point to READ or a
    // place to PUT the note. Asked up front, before either pick, because
    // the elevation branch samples on the FIRST click (it needs the tip
    // to know what to read) while the typed branch asks after it (it
    // needs the tip to offer the arrow-sampled number as a fill-in) --
    // there is no single moment after the first pick where both branches
    // could still be offered this choice.
    var sourceDlg = new QDialog(getMainWindow());
    sourceDlg.windowTitle = qsTr("Callout");
    var v = new QVBoxLayout();
    var typed = new QRadioButton(qsTr("Type the note"));
    var elev = new QRadioButton(qsTr("Floor elevation here"));
    typed.checked = true;
    v.addWidget(typed, 0, 0);
    v.addWidget(elev, 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    // .accepted/.rejected are signals on the wrapper: connect, do not
    // assign -- assigning silently does nothing, and every dialog in
    // this suite that got that wrong shipped a Cancel button that
    // couldn't cancel.
    // CLOSURES, NOT SLOT NAMES. `signal.connect(dialog, "accept")` --
    // the Qt Script idiom this suite used everywhere -- THROWS in this
    // build: "Function.prototype.connect: target is not a function".
    // The engine's connect takes a function, or a receiver plus a
    // function, and never a slot name. It threw where the dialog was
    // built, so the tool died before the dialog was ever shown.
    // Measured against the running application, 2026-09-06.
    bb.accepted.connect(function() { sourceDlg.accept(); });
    bb.rejected.connect(function() { sourceDlg.reject(); });
    v.addWidget(bb, 0, 0);
    sourceDlg.setLayout(v);
    if (sourceDlg.exec() !== QDialog.Accepted) {
        // destroy() THROWS on every QDialog in this build --
        // "Invalid attempt to destroy() an indestructible object",
        // parented or not (measured 2026-09-06). The dialog is
        // closed and handed to Qt to delete instead, and even that
        // is guarded: tearing down a dialog must never cost the
        // answer the caver just gave it.
        try {
            sourceDlg.close();
            sourceDlg.deleteLater();
        } catch (eClose) {
        }
        this.terminate();
        return;
    }
    this.elevationMode = elev.checked;
    // destroy() THROWS on every QDialog in this build --
    // "Invalid attempt to destroy() an indestructible object",
    // parented or not (measured 2026-09-06). The dialog is
    // closed and handed to Qt to delete instead, and even that
    // is guarded: tearing down a dialog must never cost the
    // answer the caver just gave it.
    try {
        sourceDlg.close();
        sourceDlg.deleteLater();
    } catch (eClose) {
    }

    CsLayers.ensureCalloutLayers(doc, this.getDocumentInterface());
    this.setState(Callout.State.PickingTip);
};

Callout.prototype.initState = function() {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }

    this.setCrosshairCursor();
    di.setClickMode(RAction.PickCoordinate);

    switch (this.state) {
    case Callout.State.PickingTip:
        // Stepping back from PickingPosition (escapeEvent) leaves this
        // state's own pickCoordinate branch with nothing to say about
        // the preview -- it never calls updatePreview(), by design,
        // since there is nothing to preview while picking a tip. Clear
        // explicitly here rather than counting on the next mouse move
        // to implicitly replace it: a leftover leader-preview from the
        // position we just backed out of is exactly the kind of thing
        // that is invisible in every headless test and obvious the
        // moment a human tries it.
        di.clearPreview();
        di.repaintViews();

        var tipMsg = this.elevationMode ?
            qsTr("Pick the point to take the floor elevation at") :
            qsTr("Pick what the arrow points at");
        this.setCommandPrompt(tipMsg);
        this.setLeftMouseTip(tipMsg);
        // A single tip, so this state is always the FIRST step: the
        // right button cancels outright and never steps back.
        this.setRightMouseTip(EAction.trCancel);
        EAction.showSnapTools();
        break;

    case Callout.State.PickingPosition:
        this.setCommandPrompt(this.elevationMode ?
            qsTr("Pick where the elevation label goes") :
            qsTr("Pick where the note goes"));
        this.setLeftMouseTip(this.elevationMode ?
            qsTr("Position of the label") :
            qsTr("Position of the note"));
        this.setRightMouseTip(EAction.trBack);
        EAction.showSnapTools();
        break;
    }
};

Callout.prototype.escapeEvent = function() {
    switch (this.state) {
    case Callout.State.PickingPosition:
        this.previewPos = undefined;
        this.setState(Callout.State.PickingTip);
        break;

    case Callout.State.PickingTip:
        // The first step of a two-click gesture: nothing picked yet to
        // step back over, so escape cancels. Escape from
        // PickingPosition (above) is what re-picks the arrow.
        EAction.prototype.escapeEvent.call(this);
        break;

    default:
        EAction.prototype.escapeEvent.call(this);
        break;
    }
};

Callout.prototype.enterEvent = function() {
    // Nothing to confirm: the gesture is two clicks and each one
    // advances on its own. Enter keeps EAction's default meaning.
    EAction.prototype.enterEvent.call(this);
};

/**
 * Handles both the real pick and its live preview, for both states --
 * the same split AlignImage.js uses for its own two coordinate states.
 */
Callout.prototype.pickCoordinate = function(event, preview) {
    var di = this.getDocumentInterface();
    if (isNull(di)) {
        return;
    }
    var doc = this.getDocument();
    var pos = event.getModelPosition();

    switch (this.state) {
    case Callout.State.PickingTip:
        if (!preview) {
            // Ask for the note HERE, between the two picks, so the
            // position pick can preview the real thing. That is the whole
            // reason the dialog moved: a preview of a placeholder box is
            // a guess, and a guess that disagrees with what lands is
            // worse than no preview at all.
            // ONE arrow, then straight on to the text position. The
            // repeatable multi-tip pick (and its Enter-to-continue) was
            // the caver's own call to drop: picking one target and then
            // saying where the note goes is the whole gesture, and an
            // Enter step in the middle of it is a step to forget.
            //
            // The write layer still takes an ARRAY of tips and still
            // places one leader per tip -- that is how arrows get added
            // to an EXISTING callout later. It is only this command's
            // gesture that is single-shot.
            this.tips = [{ x: pos.x, y: pos.y }];
            di.setRelativeZero(pos);

            if (this.elevationMode) {
                // Reproduces CalloutElev exactly: sample the floor NOW,
                // on the click, so the second pick can preview the real
                // label -- and skip the typed-text dialog altogether,
                // because there is nothing to type. The number IS the
                // note.
                var got = CalloutWrite.sampleElevationAt(doc, this.tips[0]);
                if (got === null) {
                    // No leg near enough for an honest answer. Say why
                    // and stop rather than inventing a number or
                    // dropping an empty label -- the caver can still
                    // re-run the command and choose "Type the note" if
                    // they want a note there anyway.
                    try {
                        QMessageBox.information(RMainWindowQt.getMainWindow(),
                            qsTr("Callout"),
                            qsTr("No survey leg near that point, so no " +
                                "floor elevation could be worked out." +
                                "\n\nRun Callout again and choose " +
                                "\"Type the note\" if you want to place " +
                                "a note there anyway."));
                    } catch (e) {
                        EAction.handleUserWarning(
                            qsTr("No survey leg near that point."));
                    }
                    this.terminate();
                    return;
                }
                this.noteText = got.label;
                // The style follows the BASIS, never a preference: a
                // survey-line stand-in goes on the muted fallback layer
                // so a plot cannot pass it off as a measurement.
                this.style = CsCallout.elevStyle(got.sample);
                this.kind = CsCallout.KIND_ELEV;
                this.extraTags = CalloutWrite.elevTags(got.sample);
            } else {
                var asked = Callout.askForNote(this.style, this.leader,
                    this.noteText, Callout.elevProviderFor(doc, this.tips));
                if (asked === null) {
                    // cancelled at the dialog: nothing was ever added
                    this.terminate();
                    return;
                }
                this.noteText = asked.text;
                this.style = asked.style;
                this.leader = asked.leader;
                this.kind = asked.kind || CsCallout.KIND_TEXT;
                this.extraTags = asked.tags || null;
            }

            this.setState(Callout.State.PickingPosition);
        }
        break;

    case Callout.State.PickingPosition:
        this.previewPos = { x: pos.x, y: pos.y };
        if (preview) {
            this.updatePreview();
        } else {
            this.position = { x: pos.x, y: pos.y };
            di.setRelativeZero(pos);
            this.finish();
        }
        break;
    }
};

/**
 * The live placement preview: the leader(s) that WOULD be drawn if the
 * note landed at the mouse's current position, using CsCallout.reflow
 * against a placeholder box centred there.
 *
 * This is exactly what reflow's `side` and `landing` are for -- code
 * review on Task 2 flagged them as unread outside CsCallout.js, and
 * this preview is where they earn their place: the caver sees, before
 * committing, which side of the note the arrows will leave from and
 * roughly where they will land, rather than finding out only after
 * placing the text and running CsCalloutSync. `side` is not drawn as its
 * own shape -- it is implicit in which edge of the placeholder box the
 * landing (and therefore every branch's last segment) sits on -- but
 * without reflow returning it there would be no principled way to
 * decide which edge that is; recomputing the auto-side rule a second
 * time here, differently, is exactly the kind of drift a single
 * pure function is supposed to prevent.
 *
 * Returns undefined (no preview) rather than throwing on any failure:
 * this runs on every mouse move, and a broken preview must degrade to
 * no preview, never abort the pick.
 */
/**
 * The live preview, and it is the REAL callout.
 *
 * EAction.updatePreview() calls getOperation(true) and hands the result
 * to di.previewOperation(), so returning the very operation that would
 * be applied means the caver sees the actual note -- real text, real
 * font, real size, real leader, curved or straight -- moving with the
 * cursor. Not a placeholder rectangle that then disagrees with what
 * lands.
 *
 * Returns undefined for the non-preview call on purpose. The real write
 * goes through CalloutWrite.create, which ensures the layer, wraps the
 * write in withLayerOn and VERIFIES the entities actually landed. An op
 * applied straight from here would skip all three, and a locked layer
 * would swallow the callout in silence.
 */
/**
 * A closure the dialog can call LAZILY. The work itself lives on
 * CalloutWrite, shared with the dedicated elevation tool.
 */
Callout.elevProviderFor = function(doc, tips) {
    return function() {
        if (tips.length === 0) {
            return null;
        }
        return CalloutWrite.sampleElevationAt(doc, tips[0]);
    };
};

Callout.prototype.getOperation = function(preview) {
    if (!preview) {
        return undefined;
    }
    var doc = this.getDocument();
    if (isNull(doc) || this.tips.length === 0 ||
            this.noteText === undefined || this.noteText === null ||
            this.previewPos === undefined || this.previewPos === null) {
        return undefined;
    }
    var built;
    try {
        built = CalloutWrite.buildOp(doc, {
            text: this.noteText,
            position: this.previewPos,
            tips: this.tips,
            style: this.style,
            leader: this.leader,
            kind: this.kind || CsCallout.KIND_TEXT,
            tags: this.extraTags,
            height: CalloutWrite.textHeight(doc)
        });
    } catch (e) {
        // A preview must never take the tool down with it.
        return undefined;
    }
    return built.op;
};

/** Ask for the note text and the style, then write the callout. */
Callout.prototype.finish = function() {
    var di = this.getDocumentInterface();
    var doc = this.getDocument();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }

    // The note was collected between the two picks, so there is nothing
    // to ask here -- just write what the caver has been looking at.
    try {
        CalloutWrite.create(doc, di, {
            text: this.noteText,
            position: this.position,
            tips: this.tips,
            style: this.style,
            leader: this.leader,
            kind: this.kind || CsCallout.KIND_TEXT,
            tags: this.extraTags,
            height: CalloutWrite.textHeight(doc)
        });
    } catch (e) {
        // create() throws when the target layer refused the write --
        // LOCKED and FROZEN layers refuse SILENTLY in this build, so the
        // alternative is a command that appears to work and draws
        // nothing. QMessageBox because handleUserMessage cannot show
        // multi-line text.
        try {
            QMessageBox.information(RMainWindowQt.getMainWindow(),
                qsTr("Callout"),
                qsTr("The callout could not be drawn.\n\n") + e);
        } catch (eMsg) {
            EAction.handleUserWarning(String(e));
        }
    }
    this.terminate();
};

/**
 * The note text and style. Returns {text, style} or null if cancelled
 * (including "no dialog available and nothing usable was typed").
 *
 * QDialog + exec() works in this bridge (SurveyNotebook's dialogs are
 * the precedent, and this task's own probe confirmed QDialog, QLabel,
 * QLineEdit, QPushButton, QVBoxLayout and QHBoxLayout all construct).
 * QTableWidget does not exist and QTreeWidget/QListWidget are NOT
 * constructible -- `new QTreeWidget()` returns a convincing stub whose
 * every real method is undefined -- so this stays QLineEdit / QLabel /
 * QPushButton only, the same shape SurveyNotebook uses for the same
 * reason. Every construction and connect is wrapped: a bridge without
 * QDialog must degrade to a single-line prompt, not crash.
 *
 * Note the addWidget(w, 0, 0) / addLayout(l, 0) arity -- this bridge
 * wants the extra arguments.
 */
Callout.askForNote = function(currentStyle, currentLeader, currentText,
        elevProvider) {
    // Only what a human may choose: the generated-note style is not on
    // offer, because the next map regenerate is entitled to clear its
    // layer and a hand-placed note there would go with it.
    var styleNames = CsCallout.pickableStyles();

    var edit = null;
    var combo = null;
    var shapeCombo = null;

    try {
        var dlg = new QDialog(getMainWindow());
        dlg.windowTitle = qsTr("Callout");
        var layout = new QVBoxLayout();

        layout.addWidget(new QLabel(qsTr(
            "Note text. It stays an ordinary text entity, so you can " +
            "edit it later by double-clicking it.")), 0, 0);

        edit = new QLineEdit();
        if (currentText !== undefined && currentText !== null) {
            // Escaping back to re-pick the arrow must not cost the caver
            // their typing.
            try {
                edit.text = String(currentText);
                edit.selectAll();
            } catch (eTxt) {
                // an un-prefilled field is a nuisance, not a failure
            }
        }
        layout.addWidget(edit, 0, 0);

        // A COMBO BOX, not a row of checkable buttons.
        //
        // The buttons were a real defect, not a styling preference. The
        // chosen style was accumulated in a clicked handler, so a style
        // the caver never clicked stayed at the default -- and because
        // Qt gives dialog buttons autoDefault, pressing Enter after
        // typing the note accepted the dialog before any style was
        // picked at all. Three callouts in a caver's drawing came out
        // "name" when one was meant to be an elevation, with nothing to
        // show anything had gone wrong.
        //
        // A combo cannot be in that state: it always HAS a value, that
        // value is visible, and it is read off the widget after exec()
        // rather than reconstructed from events. If no signal ever
        // fires, currentText is still right. QComboBox was probed
        // constructible and functional in this bridge (addItem,
        // currentText, currentIndexChanged) before being used here --
        // unlike QTreeWidget/QListWidget, which return convincing stubs.
        layout.addWidget(new QLabel(qsTr("Style:")), 0, 0);
        combo = new QComboBox();
        var wanted = currentStyle || CsCallout.STYLE_DEFAULT;
        for (var i = 0; i < styleNames.length; i++) {
            combo.addItem(styleNames[i]);
            if (styleNames[i] === wanted) {
                try {
                    combo.currentIndex = i;
                } catch (eIdx) {
                    // cosmetic: the caver can still pick from the list
                }
            }
        }
        layout.addWidget(combo, 0, 0);

        // Picking an elevation style FILLS THE TEXT with the sampled
        // floor elevation. There is no separate elevation command: this
        // tool already picks the arrow point before the dialog opens, so
        // the tip is known by now and the number can simply be offered --
        // and the elevation callout then inherits the flip, the curve, the
        // live preview, CsCalloutSync and the listener for free.
        //
        // Sampled LAZILY, only when the style is chosen: it needs the
        // whole survey resolved, which is real work on a big cave and
        // must not be paid for by every ordinary note.
        //
        // The provider closes over the document. That is safe HERE and
        // only here: this dialog is modal and short-lived, so the closure
        // cannot outlive the call. A freed RDocument segfaults rather than
        // throwing, so a long-lived closure over one is never acceptable.
        var elevState = { sample: null, asked: false };
        if (typeof elevProvider === "function") {
            try {
                combo.currentIndexChanged.connect(function() {
                    var picked = String(combo.currentText);
                    if (picked !== "elevation" &&
                            picked !== "elevation-line") {
                        return;
                    }
                    if (!elevState.asked) {
                        elevState.asked = true;
                        elevState.sample = elevProvider();
                    }
                    if (elevState.sample === null) {
                        // No floor could be sampled. Say so once and let
                        // the caver type whatever they know -- refusing
                        // the whole command would be worse than offering
                        // no number.
                        try {
                            QMessageBox.information(getMainWindow(),
                                qsTr("Callout"),
                                qsTr("No survey leg near that arrow " +
                                    "point, so no floor elevation could " +
                                    "be worked out. Type a value if you " +
                                    "know one."));
                        } catch (eNo) {
                            // no dialog: the empty field says it too
                        }
                        return;
                    }
                    try {
                        edit.text = elevState.sample.label;
                        edit.selectAll();
                    } catch (eFill) {
                        // the caver can still type it
                    }
                });
            } catch (eCon) {
                // no signal: the elevation styles still place a note,
                // just without the number filled in
            }
        }

        // Leader SHAPE: a separate axis from the style above. Same combo
        // reasoning -- it always has a value and it is read off the
        // widget after exec(), never accumulated from click events.
        layout.addWidget(new QLabel(qsTr("Leader:")), 0, 0);
        shapeCombo = new QComboBox();
        shapeCombo.addItem(CsCallout.LEADER_STRAIGHT);
        shapeCombo.addItem(CsCallout.LEADER_CURVED);
        var wantShape = currentLeader || CsCallout.LEADER_DEFAULT;
        if (wantShape === CsCallout.LEADER_CURVED) {
            try {
                shapeCombo.currentIndex = 1;
            } catch (eSh) {
                // cosmetic: the caver can still pick from the list
            }
        }
        layout.addWidget(shapeCombo, 0, 0);

        var bar = new QHBoxLayout();
        var okBtn = new QPushButton(qsTr("Place"));
        var cancelBtn = new QPushButton(qsTr("Cancel"));
        // Enter must mean Place, and must not be captured by anything
        // else in the dialog. Both probed settable in this bridge.
        try {
            okBtn.autoDefault = true;
            okBtn["default"] = true;
            cancelBtn.autoDefault = false;
        } catch (eDef) {
            // Enter may then do nothing; the buttons still click
        }
        bar.addStretch(1);
        bar.addWidget(okBtn, 0, 0);
        bar.addWidget(cancelBtn, 0, 0);
        layout.addLayout(bar, 0);
        dlg.setLayout(layout);

        var wired = true;
        try {
            okBtn.clicked.connect(function() { dlg.accept(); });
            cancelBtn.clicked.connect(function() { dlg.reject(); });
        } catch (eCon) {
            wired = false;
        }
        if (!wired) {
            // Without a working Place button the dialog cannot be
            // completed, so do not show a trap -- fall through to the
            // prompt below.
            throw new Error("callout dialog buttons could not be wired");
        }

        // Everything is read AFTER exec() returns, while the widgets are
        // certainly still alive and before anything can free them.
        if (dlg.exec() === 0) {
            return null;
        }
        var typed = edit.text;
        if (typed === null || typed === undefined ||
                String(typed).length === 0) {
            return null;
        }
        var style = String(combo.currentText);
        if (!CsCallout.STYLES.hasOwnProperty(style) ||
                CsCallout.GENERATED_STYLES.hasOwnProperty(style)) {
            style = CsCallout.STYLE_DEFAULT;
        }
        var shape = String(shapeCombo.currentText);
        if (shape !== CsCallout.LEADER_CURVED) {
            shape = CsCallout.LEADER_STRAIGHT;
        }

        var out = { text: String(typed), style: style, leader: shape };

        // An elevation callout carries where its number came from, so
        // CsCalloutSync can re-derive it later -- which is how a "LINE"
        // stand-in UPGRADES itself to a real floor reading once somebody
        // enters D on a later trip.
        //
        // And the style is FORCED from the basis: a stand-in goes on the
        // muted fallback layer whichever of the two the caver picked,
        // because that distinction is not a preference.
        if ((style === "elevation" || style === "elevation-line") &&
                elevState.sample !== null) {
            var smp = elevState.sample.sample;
            out.style = CsCallout.elevStyle(smp);
            out.kind = CsCallout.KIND_ELEV;
            out.tags = CalloutWrite.elevTags(smp);
        }
        return out;
    } catch (eDlg) {
        // No usable dialog in this bridge. The text is the half that
        // cannot be done any other way, so ask for that much and take
        // the style the caller came in with.
        try {
            var typed2 = QInputDialog.getText(null, qsTr("Callout"),
                qsTr("Note text:"), QLineEdit.Normal,
                (currentText === undefined || currentText === null) ?
                    "" : String(currentText));
            if (typed2 !== null && typed2 !== undefined &&
                    String(typed2).length > 0) {
                return { text: String(typed2),
                         style: currentStyle || CsCallout.STYLE_DEFAULT,
                         leader: currentLeader || CsCallout.LEADER_DEFAULT };
            }
        } catch (eIn) {
            // nothing available: place nothing rather than place junk
        }
        return null;
    }
};

// Called once by QCAD at startup to register the menu item / button.
Callout.init = function(basePath) {
    var action = new RGuiAction(qsTr("Callout"),
                                RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/Callout.js");
    action.setIcon(basePath + "/Callout.svg");
    action.setStatusTip(qsTr("A note bound to one or more arrows -- " +
        "typed, or a floor elevation read off the survey -- which " +
        "stays bound when you edit or move the text"));
    action.setDefaultCommands(["callout", "cal", "cscallout", "cscal"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(40);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
