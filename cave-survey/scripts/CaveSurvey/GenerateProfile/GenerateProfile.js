// GenerateProfile.js
//
// QCAD add-on tool: force a rebuild of the extended elevation and show
// what it could not draw.
//
// The profile normally rebuilds itself on every plan draw (CsDraw.profile,
// gated by CaveSurvey/ProfileAuto and CaveSurvey/ProfileAutoMaxStations --
// see CsDraw.js's own docblock). This tool exists for what that gate
// cannot cover: the setting is off, the survey's total station count is
// over the automatic size limit, or -- the more common reason to reach
// for it -- the user wants to SEE the report the automatic pass only ever
// writes silently into its own return value: every side lead left out,
// every spur whose name disagrees with its surveyed junction, every leg
// the profile could not draw, and every station with no resolved
// elevation. This command is never gated by ProfileAuto or
// ProfileAutoMaxStations -- forcing past both is the point of running it
// by hand.
//
// WHAT REBUILDING FROM THE DRAWING COSTS, AND WHAT IT NO LONGER COSTS:
// this tool rebuilds its survey from the DRAWING's own tags
// (CsTags.surveyFromDocument) rather than from a notebook that may not
// be open. Splays USED TO BE LOST that way -- that reader walked
// Station-tagged points only, and splay geometry is tagged Splay (on
// the ray) and SplayName (on the tip), so a cave whose floor and
// ceiling come from splays got a profile built from LRUD alone. It no
// longer does: CsTags.collectSplays rebuilds each splay from its ray's
// own schema-v3 shot tags, exactly, and falls back to the tip's
// position where a pre-v3 ray has no readings on it. So "floor and
// ceiling lines from LRUD and splays" is a claim this manual path
// earns too.
//
// TWO RESIDUAL GAPS, both reported rather than silent:
//   * a splay recovered from its TIP alone has no inclination on
//     record (a plan drawing shows only the horizontal projection), so
//     it places no floor or ceiling point -- counted in the profile
//     report's own "splay wall point(s) skipped" line;
//   * splay geometry whose base station is gone from the drawing has
//     nothing to hang on and is not recovered at all -- counted by
//     generateProfileSplayLossWarning below.
//
// USAGE:
//   Cave Survey > Generate Profile   (or type "gp")

include("scripts/EAction.js");
include("scripts/simple.js");
include(includeBasePath + "/../Core/CsAll.js");

/** One "Generate Profile: <reason>." warning, the one wording every
 *  refusal in this tool shares -- see the file's own review history for
 *  why this used to be three separately-worded warning() calls instead
 *  of one shared helper. `reason` carries no trailing period of its own. */
function generateProfileRefuse(reason) {
    CsTell.warn("Generate Profile: " + reason + ".");
}

/**
 * How many distinct splays the DRAWING itself still carries (one
 * SplayName-tagged tip point per splay -- CsDraw.survey's own shape),
 * regardless of whether this tool's own survey rebuild could recover
 * any of them. QCAD only.
 */
function generateProfileCountDrawnSplays(doc) {
    var seen = {};
    var count = 0;
    var ids = doc.queryAllEntities(false, false);
    for (var i = 0; i < ids.length; i++) {
        var e = doc.queryEntity(ids[i]);
        if (isNull(e)) {
            continue;
        }
        var name = CsTags.get(e, "SplayName");
        if (name === "" || seen.hasOwnProperty(name)) {
            continue;
        }
        seen[name] = true;
        count++;
    }
    return count;
}

/**
 * How many splay shots the rebuilt `survey` carries THAT CAN ACTUALLY
 * HANG ON A STATION. Pure.
 *
 * The station-exists filter is load-bearing: the exact reader
 * (CsRevise) recovers an orphaned splay's DATA from its own tags even
 * when its base station is gone from the survey -- recovered as a
 * record, still unplaceable as geometry. Counting it as "rebuilt"
 * would silence the loss warning below for exactly the case it exists
 * to report.
 */
function generateProfileCountRecoveredSplays(survey) {
    // LEG endpoints only -- CsModel.stationNames would count the
    // orphan splay's own From, naming its missing station into
    // existence and silencing the very warning this feeds
    var names = {};
    for (var si = 0; si < survey.shots.length; si++) {
        var sh = survey.shots[si];
        if (sh.splay || sh.excludeFromAll ||
                sh.from === "" || sh.to === "") {
            continue;
        }
        names[sh.from] = true;
        names[sh.to] = true;
    }
    var byStation = CsLrud.splaysByStation(survey);
    var count = 0;
    for (var k in byStation) {
        if (byStation.hasOwnProperty(k) && names[k] === true) {
            count += byStation[k].length;
        }
    }
    return count;
}

/**
 * The splay geometry the rebuild could not account for at all.
 *
 * CsTags.collectSplays recovers a splay from its ray's shot tags, or
 * from its tip's position, and this compares what it produced against
 * what the drawing still shows. On a drawing this suite drew the two
 * agree and this says nothing. It fires for the one case the reader
 * deliberately refuses: splay geometry whose base station is no longer
 * in the drawing (a station point erased by hand, its splays left
 * behind), which has no origin to measure a tip from and which
 * CsDraw.survey would not redraw either.
 *
 * NOT a "splays are never recovered" notice any more -- that is what
 * this used to be, when the comparison could only ever come back
 * "all of them." It was written as a genuine comparison rather than a
 * bare `drawn > 0` check precisely so that teaching the reader to
 * recover splays would leave it reporting the REMAINING gap instead of
 * a claim that had stopped being true; this is that.
 *
 * A splay recovered from its tip alone, with no inclination on record,
 * is NOT counted here: it came back as real data and the profile's own
 * report names it under "splay wall point(s) skipped."
 *
 * \return a warning line (leading blank line included) or "" when the
 *         counts agree (nothing to report, including the ordinary case
 *         of a survey with no splays drawn at all)
 */
function generateProfileSplayLossWarning(doc, survey) {
    var drawn = generateProfileCountDrawnSplays(doc);
    var recovered = generateProfileCountRecoveredSplays(survey);
    if (drawn === recovered) {
        return "";
    }
    return "\n\nWARNING -- " + drawn + " splay(s) tagged in the drawing, " +
        "but only " + recovered + " could be rebuilt from it: a splay " +
        "whose own station is no longer in the drawing has nothing to " +
        "hang on. The floor and ceiling lines above are missing that " +
        "many splays -- run Rebuild Survey Data to repair the drawing, " +
        "or Import Cave Survey or the Survey Notebook to draw it again " +
        "from the notes.";
}

/**
 * Asks which elevation to draw, and on what plane.
 *
 * \return {mode, azimuth} or null when cancelled.
 *
 * DIALOG MECHANICS, all of them the hard way round in this build and
 * all of them measured rather than assumed (see the suite's own notes
 * in SymbolPaletteEdit.askMeta): signals connect to CLOSURES, never to
 * slot names, and a QDialog is closed and handed to Qt rather than
 * destroyed. Getting either wrong throws where the dialog is BUILT, so
 * the command dies before anything is ever shown.
 */
function generateProfileAskMode() {
    var current = CsProject.settings();
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Generate Profile");
    var v = new QVBoxLayout();

    v.addWidget(new QLabel(qsTr("Which elevation?")), 0, 0);
    var modeCombo = new QComboBox();
    modeCombo.addItem(qsTr("Extended -- unrolled along the passage"));
    modeCombo.addItem(qsTr("Projected -- flattened onto one plane"));
    modeCombo.addItem(qsTr("Chunked -- cut at the pitches, arranged"));
    modeCombo.currentIndex =
        (current.mode === CsProject.MODE_PROJECTED) ? 1 :
        ((current.mode === CsProject.MODE_CHUNKED) ? 2 : 0);
    v.addWidget(modeCombo, 0, 0);

    v.addWidget(new QLabel(qsTr("Projection plane (degrees, or blank " +
        "for the cave's long axis)")), 0, 0);
    var azEdit = new QLineEdit(
        current.azimuth === CsProject.AZIMUTH_AUTO ? "" :
            String(current.azimuth));
    azEdit.toolTip = qsTr("The compass line the cave is flattened onto. " +
        "Left blank, the cave's own longest direction is used, which " +
        "is the plane that throws away least. Only used by the " +
        "projected elevation -- a chunked one gives every piece its " +
        "own plane, which is most of why the pieces read better than " +
        "the whole.");
    v.addWidget(azEdit, 0, 0);

    var bb = new QDialogButtonBox(QDialogButtonBox.Ok |
        QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);

    var accepted = (dlg.exec() === QDialog.Accepted);
    var mode = CsProject.MODE_EXTENDED;
    if (modeCombo.currentIndex === 1) {
        mode = CsProject.MODE_PROJECTED;
    } else if (modeCombo.currentIndex === 2) {
        mode = CsProject.MODE_CHUNKED;
    }
    var azText = String(azEdit.text).replace(/^\s+|\s+$/g, "");
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    if (!accepted) {
        return null;
    }
    var azimuth = (azText === "") ? CsProject.AZIMUTH_AUTO : azText;
    // REMEMBERED, so the automatic pass on every later draw keeps
    // drawing whichever kind was chosen here rather than reverting to
    // the default the next time the plan is redrawn.
    try {
        RSettings.setValue(CsProject.SETTING_MODE, mode);
        RSettings.setValue(CsProject.SETTING_AZIMUTH, azimuth);
    } catch (eSet) {
        // an unremembered choice still draws what was asked for now
    }
    return { mode: mode, azimuth: azimuth };
}

function generateProfileRun() {
    var doc = getDocument();
    if (doc === undefined || doc === null) {
        generateProfileRefuse("no active drawing document");
        return;
    }
    // A SHEET IS NOT A DRAWING TO WORK IN. It is rebuilt from the
    // cave's record every time Build Sheet is pressed, so anything
    // drawn here goes with it -- silently, weeks later. See
    // Core/CsModelSpace.js.
    if (CsModelSpace.blocksWhole(doc, "Generate Profile")) {
        return;
    }

    // From the DRAWING, not a notebook that may not be open: the survey
    // model lives on the entities themselves, so a profile can be
    // rebuilt from any drawing the suite has ever drawn -- splays
    // included (CsTags.collectSplays). See this file's own header
    // comment for the two residual gaps that rebuilding from tags
    // still has, and where each one is reported.
    // CsRevise.resolveAsDrawn: the exact reconstruction (real branch
    // topology, closure legs included), resolved in the drawing's own
    // frame at the drawing's own datum, under its recorded adjustment.
    // The chain-guess reader this used to run handed the profile a
    // shot list with a FABRICATED leg across every branch boundary --
    // the bands drew a passage nobody surveyed -- and no closure leg
    // at all. Its geometry looked right only because that reader pins
    // every station into survey.fixed; the exact reconstruction gets
    // the same frame honestly, from the recorded anchor. A pre-v3
    // drawing still falls back to the chain guess inside
    // surveyFromDocument, as before.
    var asDrawn = CsRevise.resolveAsDrawn(doc);
    if (asDrawn === null) {
        generateProfileRefuse("no tagged survey stations found.\n" +
            "Run Azimuth Traverse, Import Cave Survey or the Survey " +
            "Notebook first");
        return;
    }
    var survey = asDrawn.survey;
    var resolved = asDrawn.resolved;

    // BOTH of CsDraw.profile's own gates (ProfileAuto, size) are bypassed
    // on purpose -- forcing past both is the entire point of a manual
    // command -- so this calls CsDraw.profileNow directly: the shared
    // post-gate sequence (build, draw) that CsDraw.profile itself calls
    // once its own two gates pass.
    //
    // NO REVEAL POLICY ANY MORE, and nothing lost with it: the
    // elevation used to be written to a sibling -PROFILE.dxf, so "show
    // me my profile now" meant opening a second drawing, and this
    // command had to ask for that explicitly (the automatic pass must
    // not, or it would steal focus on every plan draw). The elevation
    // is a region of THIS drawing now, below the plan -- it is already
    // on screen the moment it is drawn, for both callers.
    var settings = CsProfile.settings();

    // WHICH ELEVATION, asked rather than assumed.
    //
    // A cave has one elevation and two ways of drawing it, and which
    // one is right is a property of the cave: a long horizontal cave
    // wants the extended one (no passage hides behind another), a pit
    // wants the projected one (the arrangement of the shafts IS the
    // cave). This is the command a caver reaches for when they want to
    // look at it a different way, so it is the place to ask.
    //
    // The answer is REMEMBERED in the settings, so the automatic pass
    // on every draw keeps drawing whichever kind was last chosen here.
    // Cancelling changes nothing and draws nothing.
    var chosen = generateProfileAskMode();
    if (chosen === null) {
        return;
    }
    settings.mode = chosen.mode;
    settings.azimuth = chosen.azimuth;

    var outcome = CsDraw.profileNow(doc, getDocumentInterface(), survey,
        resolved, settings);
    if (outcome.skipped) {
        generateProfileRefuse(outcome.reason);
        return;
    }

    var text = CsReport.profileSummary(outcome.profile, outcome);
    text += generateProfileSplayLossWarning(doc, survey);

    // handleUserMessage CANNOT show this: RS.escape does not convert
    // newlines, so every one collapses to a space and a multi-line
    // report reads back as one run-on sentence parsed as rich text.
    // QMessageBox.information is what SurveyStats.js and
    // ImportCaveSurvey.js already use for exactly this reason. Wrapped
    // defensively per this feature's own rule that a failure must
    // degrade, not crash -- by this point the rebuild above already
    // drew real geometry into the drawing, so a dialog that fails to
    // open must not make the command look like it did nothing.
    try {
        QMessageBox.information(getMainWindow(), "Generate Profile", text);
    } catch (e) {
        try {
            EAction.handleUserMessage(text.replace(/\n/g, "  "));
        } catch (e2) {
            print(text);
        }
    }
}

// ============================================================
// Add-on wiring -- the standard pattern; see docs.
// ============================================================

function GenerateProfile(guiAction) {
    EAction.call(this, guiAction);
}

GenerateProfile.prototype = new EAction();

GenerateProfile.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    generateProfileRun();
    this.terminate();
};

GenerateProfile.init = function(basePath) {
    var action = new RGuiAction(qsTr("Generate Profile"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/GenerateProfile.js");
    action.setIcon(basePath + "/GenerateProfile.svg");
    action.setStatusTip(qsTr("Rebuild the elevation -- extended or projected -- and show what it could not draw"));
    action.setDefaultCommands(["generateprofile", "gp", "genprofile"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(20);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
