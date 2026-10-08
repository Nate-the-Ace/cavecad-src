// LayoutViews.js -- Sheets from Views: make a sheet of any view in the drawing.
//
// Sheet Setup knows the cave's plan and one profile. A cave drawing holds more:
// several profile bands and any number of cross sections. This command lists
// every VIEW (CsViews: the cave's bounding box, each profile, each cross section),
// lets you tick the ones you want, and makes one sheet per view -- each framed on
// its own box, at the scale that fits it on the paper, with only its own layers
// showing (the other views' layers are frozen in its viewport).
//
// It uses the same generator as Sheet Setup (CsLayoutGen), so these are ordinary
// automatic sheets: Sheet Setup's title block, north arrow (plan only), scale bar,
// border; a sheet changed by hand is left alone the next time.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function LayoutViews(guiAction) {
    EAction.call(this, guiAction);
}

LayoutViews.prototype = new EAction();

/**
 * The scale (feet per inch) that fits a view on a sheet, as Sheet Setup picks one.
 * The sheet is turned (portrait) when only that fits.
 */
LayoutViews.fitView = function(view, sheet, perFoot) {
    var wFt = (view.box.maxX - view.box.minX) / perFoot;
    var hFt = (view.box.maxY - view.box.minY) / perFoot;
    return CsSheetSetup.fit(wFt, hFt, sheet, 0, undefined);
};

/** The views to make: [{ view, scale, turned }] for the ticked rows, or null when the dialog was cancelled. */
LayoutViews.ask = function(views, sheets) {
    var dlg = new QDialog(RMainWindowQt.getMainWindow());
    dlg.windowTitle = qsTr("Sheets from Views");
    var v = new QVBoxLayout();
    v.addWidget(new QLabel(qsTr("Make a sheet of:")), 0, 0);
    var list = new QListWidget();
    for (var i = 0; i < views.length; i++) {
        var item = new QListWidgetItem(views[i].label);
        item.setFlags(item.flags() | Qt.ItemIsUserCheckable);
        item.setCheckState(i === 0 ? Qt.Checked : Qt.Unchecked);
        list.addItem(item);
    }
    v.addWidget(list, 0, 0);
    v.addWidget(new QLabel(qsTr("Paper:")), 0, 0);
    var paper = new QComboBox();
    var def = 0;
    for (var s = 0; s < sheets.length; s++) {
        paper.addItem(sheets[s].name);
        if (sheets[s].name === "ANSI A -- 11 x 8.5") {
            def = s;
        }
    }
    paper.currentIndex = def;
    v.addWidget(paper, 0, 0);
    v.addWidget(new QLabel(qsTr("Each sheet is scaled to fit its view; the title block, scale bar and border follow Sheet Setup.")), 0, 0);
    var bb = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    bb.accepted.connect(function() { dlg.accept(); });
    bb.rejected.connect(function() { dlg.reject(); });
    v.addWidget(bb, 0, 0);
    dlg.setLayout(v);
    var accepted = (dlg.exec() === QDialog.Accepted);
    var chosen = [];
    for (var r = 0; r < views.length; r++) {
        if (list.item(r).checkState() === Qt.Checked) {
            chosen.push(views[r].id);
        }
    }
    var sheetName = String(paper.currentText);
    try {
        dlg.close();
        dlg.deleteLater();
    } catch (eClose) {
    }
    if (!accepted) {
        return null;
    }
    return { ids: chosen, sheet: sheetName };
};

LayoutViews.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    var doc = this.getDocument();
    var di = this.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        this.terminate();
        return;
    }
    // Sheet Setup is its own add-on, loaded at startup beside this one; its state reader is the single
    // place that knows how to measure the cave and read the survey for the title block.
    if (typeof SheetSetup === "undefined") {
        CsTell.warn(qsTr("Sheets from Views: needs Sheet Setup, which is not loaded."));
        this.terminate();
        return;
    }
    var state = SheetSetup.readState(doc);
    if (isNull(state) || state.ok !== true) {
        CsTell.warn(qsTr("Sheets from Views: ") + (isNull(state) ? "" : state.why));
        this.terminate();
        return;
    }
    var views = CsViews.read(doc, state.caveBox);
    if (views.length === 0) {
        CsTell.warn(qsTr("Sheets from Views: there is nothing to make a sheet of yet."));
        this.terminate();
        return;
    }
    var answer = LayoutViews.ask(views, CsSheetSetup.SHEETS);
    if (isNull(answer) || answer.ids.length === 0) {
        this.terminate();
        return;
    }
    var sheet = CsSheetSetup.sheetByName(answer.sheet);
    var perFoot = CsShapeLine.perFoot(doc);
    var picked = CsViews.pick(views, answer.ids);
    var wants = { border: true, bar: true, north: true, title: true };
    var cave = null, extra = [];
    var turned = false;
    for (var i = 0; i < picked.length; i++) {
        var fit = LayoutViews.fitView(picked[i], sheet, perFoot);
        if (picked[i].id === CsViews.CAVE_ID) {
            cave = picked[i];
            cave.scale = fit.scale;
            turned = fit.turned;
        }
        else {
            picked[i].scale = fit.scale;
            extra.push(picked[i]);
        }
    }
    var titleValues = SheetSetup.titleValues(doc, state.filled);
    var res;
    try {
        res = CsLayoutGen.generate(doc, di, {
            caveBox: state.caveBox, elevBox: null, sheet: sheet, turned: turned,
            scale: cave !== null ? cave.scale : picked[0].scale, perFoot: perFoot, wants: wants,
            titleValues: titleValues, reading: CsSheetSetup.latestDeclination(state.survey),
            tiles: null, elevation: false, shiftInches: { x: 0, y: 0 },
            skipPlan: cave === null, views: extra,
            extra: { offsets: {}, titleValues: titleValues } });
    }
    catch (eGen) {
        CsTell.warn(qsTr("Sheets from Views: building the sheets failed (") + eGen + ").");
        this.terminate();
        return;
    }
    var made = res.made.concat(res.rewritten);
    var said = made.length > 0 ? qsTr("Sheets from Views: made ") + made.join(", ") + "." : qsTr("Sheets from Views: nothing was made.");
    if (res.skipped.length > 0) {
        said += " " + qsTr("Left alone because they were edited by hand: ") + res.skipped.join(", ") + ".";
    }
    EAction.handleUserMessage(said);
    this.terminate();
};

LayoutViews.init = function(basePath) {
    var action = new RGuiAction(qsTr("Sheets from Views"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setScriptFile(basePath + "/LayoutViews.js");
    action.setIcon(basePath + "/LayoutViews.svg");
    action.setStatusTip(qsTr("Make a sheet of any view: the whole cave, each profile, each cross section"));
    action.setDefaultCommands(["layoutviews", "lyv"]);
    action.setGroupSortOrder(454);
    action.setSortOrder(74);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar", "LayoutMenu"]);
};
